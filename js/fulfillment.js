/* Groovy Operations — fulfillment.js
   Daily Performance (Dispatch & Returns) tracker + analytics.

   Plain global CLASSIC script (NO import/export) — same convention as every
   other /js/*.js file. Firebase globals (db, collection, doc, getDocs,
   setDoc, query, orderBy, limit, …) are bridged onto window by the bootstrap
   module in index.html before this runs. Shared utils (showToast,
   logActivity, session, currentPage, gvSkeleton) live in shared.js and are
   visible here through the single shared global lexical scope.

   Data model — one Firestore doc per calendar day:
     collection: fulfillment_reports
     doc id:     'YYYY-MM-DD'  (= the report date)
     {
       date, dispatched:[{brand,courier,shipments,amount}, …],
       returns:[{brand,courier,shipments,amount}, …],
       dispatchedTotal:{shipments,amount}, returnsTotal:{shipments,amount},
       enteredBy, enteredByU, enteredAt, updatedAt
     }
   This mirrors the two daily reports Umair (fulfilment) posts — a Dispatched
   sheet and a Returns sheet, both keyed to the same date. */

// ── Fixed brand/courier row templates (match Umair's report layout) ──
const FULFILL_DISPATCH_ROWS=[
  {brand:'GROOVY',            courier:'POST-EX'},
  {brand:'AGAINST',           courier:'POST-EX'},
  {brand:'Cultured Legacy',   courier:'BLUE-EX'},
  {brand:'Groovy/Against/Culture', courier:'TCS'},
];
const FULFILL_RETURN_ROWS=[
  {brand:'GROOVY',          courier:'POST-EX'},
  {brand:'AGAINST',         courier:'POST-EX'},
  {brand:'Cultured Legacy', courier:'BLUE-EX'},
  {brand:'Groovy',          courier:'BLUE-EX'},
  {brand:'Groovy/Culture',  courier:'TCS'},
];

// ── Module state ──
let fulfillReports=[];          // cached docs, newest first
let fulfillReportsLoaded=false;
let _fulfillTab='analytics';    // 'analytics' | 'entry'
let _fulfillPeriod=30;          // analytics window in days; 0 = all-time
let _fulfillEntryDate=null;     // ISO date currently in the entry form

// ── Small helpers ──
function _fnum(n){return Number(n||0).toLocaleString('en-US');}
function _fRs(n){return 'Rs '+_fnum(Math.round(Number(n||0)));}
function _fulfillToday(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _fulfillFmtDate(iso){
  if(!iso)return '—';
  const d=new Date(iso+'T00:00:00');
  return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'});
}
function _fulfillCutoff(days){
  const d=new Date();d.setDate(d.getDate()-(days-1));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Owners, managers, and the dedicated fulfilment account (Umair) may view
// and record daily performance.
function _canViewFulfillment(){return session&&(session.role==='owner'||session.role==='manager'||session.role==='fulfillment');}
function _canEditFulfillment(){return _canViewFulfillment();}

// Jump straight to a tab (used by Umair's mobile nav).
window.showFulfillTab=function(tab){_fulfillTab=(['entry','log'].includes(tab)?tab:'analytics');window.showPage('fulfillment');};

// ── Data loading ──
async function loadFulfillmentData(){
  try{
    const q=query(collection(db,'fulfillment_reports'),orderBy('date','desc'),limit(400));
    const snap=await getDocs(q);
    fulfillReports=snap.docs.map(d=>({id:d.id,...d.data()}));
    fulfillReportsLoaded=true;
  }catch(e){
    console.warn('[fulfillment] load failed',e);
    fulfillReports=[];fulfillReportsLoaded=true;
  }
}

// ── Page shell + tab switch ──
function _fulfillBody(){
  return _fulfillTab==='entry'?_renderFulfillEntry()
        :_fulfillTab==='log'?_renderFulfillLog()
        :_renderFulfillAnalytics();
}

function renderFulfillmentPage(){
  if(!_canViewFulfillment())
    return '<div class="empty">Daily Performance is restricted to owners and managers.</div>';
  const tab=(id,label)=>`<button class="tab-btn${_fulfillTab===id?' active':''}" onclick="window.switchFulfillTab('${id}')">${label}</button>`;
  return `<div class="page-head">
    <div class="page-title">Daily Performance</div>
    <div class="page-sub">Dispatch &amp; returns — recorded per day, analysed over time</div>
  </div>
  <div class="tab-bar">
    ${tab('analytics','Analytics')}${tab('entry','Record Day')}${tab('log','Log')}
  </div>
  <div id="fulfill-body">${_fulfillBody()}</div>`;
}

window.switchFulfillTab=function(tab){
  _fulfillTab=tab;
  const body=document.getElementById('fulfill-body');
  document.querySelectorAll('#main-content .tab-bar .tab-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.querySelector(`#main-content .tab-bar .tab-btn[onclick*="'${tab}'"]`);
  if(btn)btn.classList.add('active');
  if(!body)return;
  body.innerHTML=_fulfillBody();
  if(tab==='entry')window._fulfillRecalc();
};

// ══════════════════════════════════════════════════════════════════════
//  ENTRY — record / edit a single day
// ══════════════════════════════════════════════════════════════════════
function _renderFulfillEntry(){
  if(!_canEditFulfillment())
    return '<div class="empty">Recording is restricted to owners and managers.</div>';
  const date=_fulfillEntryDate||_fulfillToday();
  _fulfillEntryDate=date;
  const existing=fulfillReports.find(r=>r.date===date);

  const rowInputs=(rows,section,saved)=>rows.map((r,i)=>{
    const s=(saved&&saved[i])||{};
    return `<tr>
      <td style="padding:7px 8px;font-size:12px;font-weight:600">${r.brand}</td>
      <td style="padding:7px 8px;font-size:11px;color:var(--muted)">${r.courier}</td>
      <td style="padding:5px 6px"><input type="number" min="0" inputmode="numeric" id="fd-${section}-${i}-ship"
        value="${s.shipments!=null?s.shipments:''}" placeholder="0" oninput="window._fulfillRecalc()"
        style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;text-align:right;background:#FAFAFA;font-family:inherit;outline:none"></td>
      <td style="padding:5px 6px"><input type="number" min="0" inputmode="numeric" id="fd-${section}-${i}-amt"
        value="${s.amount!=null?s.amount:''}" placeholder="0" oninput="window._fulfillRecalc()"
        style="width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;text-align:right;background:#FAFAFA;font-family:inherit;outline:none"></td>
    </tr>`;
  }).join('');

  const tbl=(title,rows,section,saved,accent)=>`<div class="card" style="margin-bottom:12px">
    <div class="card-title" style="border-bottom:none;margin-bottom:6px;color:${accent}">${title}</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:340px">
      <thead><tr style="text-align:left">
        <th style="padding:6px 8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Brand</th>
        <th style="padding:6px 8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Courier</th>
        <th style="padding:6px 8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right">Shipments</th>
        <th style="padding:6px 8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right">Amount (Rs)</th>
      </tr></thead>
      <tbody>${rowInputs(rows,section,saved)}</tbody>
      <tfoot><tr style="border-top:2px solid var(--border)">
        <td colspan="2" style="padding:8px;font-size:12px;font-weight:700">GRAND TOTAL</td>
        <td id="fd-${section}-tot-ship" style="padding:8px;font-size:14px;font-weight:700;text-align:right">0</td>
        <td id="fd-${section}-tot-amt" style="padding:8px;font-size:14px;font-weight:700;text-align:right">Rs 0</td>
      </tr></tfoot>
    </table></div>
  </div>`;

  return `<div class="card" style="margin-bottom:12px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:180px">
        <label>Report date</label>
        <input type="date" id="fd-date" value="${date}" max="${_fulfillToday()}" onchange="window.loadFulfillDate()">
      </div>
      <div style="font-size:12px;color:${existing?'var(--accent-warning)':'var(--muted)'};padding-bottom:10px">
        ${existing?`✎ Editing existing record for ${_fulfillFmtDate(date)}`:`New record for ${_fulfillFmtDate(date)}`}
      </div>
    </div>
    ${tbl('DISPATCHED',FULFILL_DISPATCH_ROWS,'d',existing&&existing.dispatched,'var(--accent-success)')}
    ${tbl('RETURNS',FULFILL_RETURN_ROWS,'r',existing&&existing.returns,'var(--accent-urgent)')}
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-primary" id="fd-save-btn" style="flex:1;min-width:160px" onclick="window.saveFulfillReport()">${existing?'Update record':'Save record'}</button>
      <button class="btn-outline" style="flex:1;min-width:160px;font-size:14px;font-weight:600" onclick="window.saveFulfillReport(true)">${existing?'Update':'Save'} &amp; download PDF</button>
    </div>`;
}

window.loadFulfillDate=function(){
  const el=document.getElementById('fd-date');
  if(!el||!el.value)return;
  _fulfillEntryDate=el.value;
  const body=document.getElementById('fulfill-body');
  if(body){body.innerHTML=_renderFulfillEntry();window._fulfillRecalc();}
};

function _fulfillReadSection(section,rows){
  const out=[];
  let tShip=0,tAmt=0;
  for(let i=0;i<rows.length;i++){
    const ship=parseInt((document.getElementById(`fd-${section}-${i}-ship`)||{}).value)||0;
    const amt=parseFloat((document.getElementById(`fd-${section}-${i}-amt`)||{}).value)||0;
    out.push({brand:rows[i].brand,courier:rows[i].courier,shipments:ship,amount:amt});
    tShip+=ship;tAmt+=amt;
  }
  return {rows:out,totShip:tShip,totAmt:tAmt};
}

window._fulfillRecalc=function(){
  const d=_fulfillReadSection('d',FULFILL_DISPATCH_ROWS);
  const r=_fulfillReadSection('r',FULFILL_RETURN_ROWS);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('fd-d-tot-ship',_fnum(d.totShip));set('fd-d-tot-amt',_fRs(d.totAmt));
  set('fd-r-tot-ship',_fnum(r.totShip));set('fd-r-tot-amt',_fRs(r.totAmt));
};

window.saveFulfillReport=async function(alsoPdf){
  if(!_canEditFulfillment())return showToast('Not allowed.',true);
  const date=(document.getElementById('fd-date')||{}).value;
  if(!date)return showToast('Pick a date first.',true);
  const d=_fulfillReadSection('d',FULFILL_DISPATCH_ROWS);
  const r=_fulfillReadSection('r',FULFILL_RETURN_ROWS);
  if(d.totShip===0&&d.totAmt===0&&r.totShip===0&&r.totAmt===0)
    return showToast('Enter at least one shipment or amount.',true);

  const btn=document.getElementById('fd-save-btn');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const existing=fulfillReports.find(x=>x.date===date);
  const payload={
    date,
    dispatched:d.rows, returns:r.rows,
    dispatchedTotal:{shipments:d.totShip,amount:d.totAmt},
    returnsTotal:{shipments:r.totShip,amount:r.totAmt},
    updatedAt:Date.now(),
    updatedBy:session.name, updatedByU:session.u,
  };
  if(!existing){payload.enteredBy=session.name;payload.enteredByU=session.u;payload.enteredAt=Date.now();}
  else{payload.enteredBy=existing.enteredBy||session.name;payload.enteredByU=existing.enteredByU||session.u;payload.enteredAt=existing.enteredAt||Date.now();}

  try{
    await setDoc(doc(db,'fulfillment_reports',date),payload);
    // Upsert into cache (keep newest-first order)
    const rec={id:date,...payload};
    const idx=fulfillReports.findIndex(x=>x.date===date);
    if(idx>-1)fulfillReports[idx]=rec;else fulfillReports.push(rec);
    fulfillReports.sort((a,b)=>b.date.localeCompare(a.date));
    logActivity('Fulfilment report',`${existing?'Updated':'Recorded'} ${date} — ${_fnum(d.totShip)} dispatched / ${_fnum(r.totShip)} returned`);
    showToast(`Saved ${_fulfillFmtDate(date)} ✓`);
    if(alsoPdf===true)window.fulfillPdf(date);
    _fulfillTab='log';
    const m=document.getElementById('main-content');
    if(m)m.innerHTML=renderFulfillmentPage();
  }catch(e){
    console.warn('[fulfillment] save failed',e);
    showToast('Save failed: '+(e.message||'permission denied'),true);
    if(btn){btn.disabled=false;btn.textContent=existing?'Update record':'Save record';}
  }
};

// ══════════════════════════════════════════════════════════════════════
//  ANALYTICS
// ══════════════════════════════════════════════════════════════════════
window.setFulfillPeriod=function(days){
  _fulfillPeriod=days;
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};

function _renderFulfillAnalytics(){
  if(!fulfillReports.length)
    return `<div class="empty">No daily reports yet.<br><br>
      <button class="btn-outline" onclick="window.switchFulfillTab('entry')">Record the first day</button></div>`;

  const cutoff=_fulfillPeriod?_fulfillCutoff(_fulfillPeriod):'0000-00-00';
  const reps=fulfillReports.filter(r=>r.date>=cutoff);
  if(!reps.length)
    return `<div>${_fulfillPeriodChips()}<div class="empty">No reports in this window.</div></div>`;

  // Aggregate totals
  let dShip=0,dAmt=0,rShip=0,rAmt=0;
  const brandMap={},courierMap={};
  for(const rep of reps){
    for(const row of (rep.dispatched||[])){
      dShip+=row.shipments||0;dAmt+=row.amount||0;
      const b=brandMap[row.brand]||(brandMap[row.brand]={dShip:0,dAmt:0,rShip:0,rAmt:0});
      b.dShip+=row.shipments||0;b.dAmt+=row.amount||0;
      const c=courierMap[row.courier]||(courierMap[row.courier]={dShip:0,dAmt:0,rShip:0,rAmt:0});
      c.dShip+=row.shipments||0;c.dAmt+=row.amount||0;
    }
    for(const row of (rep.returns||[])){
      rShip+=row.shipments||0;rAmt+=row.amount||0;
      const b=brandMap[row.brand]||(brandMap[row.brand]={dShip:0,dAmt:0,rShip:0,rAmt:0});
      b.rShip+=row.shipments||0;b.rAmt+=row.amount||0;
      const c=courierMap[row.courier]||(courierMap[row.courier]={dShip:0,dAmt:0,rShip:0,rAmt:0});
      c.rShip+=row.shipments||0;c.rAmt+=row.amount||0;
    }
  }
  const days=reps.length;
  const retRate=dShip?(100*rShip/dShip):0;
  const avgPerDay=days?Math.round(dShip/days):0;
  const repsAsc=[...reps].sort((a,b)=>a.date.localeCompare(b.date));
  const best=repsAsc.reduce((m,r)=>((r.dispatchedTotal&&r.dispatchedTotal.shipments||0)>(m.val)?{val:r.dispatchedTotal.shipments,date:r.date}:m),{val:0,date:null});

  const kpi=(label,val,sub,color='var(--dark)')=>`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${label}</div>
    <div style="font-size:22px;font-weight:700;color:${color}">${val}</div>
    ${sub?`<div style="font-size:10px;color:var(--muted);margin-top:2px">${sub}</div>`:''}
  </div>`;
  const sec=(title,body)=>`<div class="card" style="margin-bottom:14px"><div class="card-title">${title}</div>${body}</div>`;

  // Daily trend (last 30 within window), plus a bar chart of last 14 days
  const trend=repsAsc.slice(-30);
  const chart=repsAsc.slice(-14);
  const maxShip=Math.max(1,...chart.map(r=>(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0));
  const bars=chart.map(r=>{
    const v=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    const rv=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    const h=Math.round(6+(v/maxShip)*104);
    const dd=new Date(r.date+'T00:00:00');
    return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px" title="${_fulfillFmtDate(r.date)} — ${v} dispatched, ${rv} returned">
      <div style="font-size:9px;color:var(--muted)">${v}</div>
      <div style="width:70%;max-width:26px;background:var(--dark);border-radius:4px 4px 0 0;height:${h}px"></div>
      <div style="font-size:8px;color:var(--muted);white-space:nowrap">${isNaN(dd)?'':dd.getDate()+'/'+(dd.getMonth()+1)}</div>
    </div>`;
  }).join('');

  const trendRows=[...trend].reverse().map(r=>{
    const ds=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    const da=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
    const rs=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    const rr=ds?Math.round(100*rs/ds):0;
    return `<tr style="border-bottom:1px solid #f5f5f5">
      <td style="padding:6px 4px;font-weight:600;white-space:nowrap">${_fulfillFmtDate(r.date)}</td>
      <td style="padding:6px 4px;text-align:right">${_fnum(ds)}</td>
      <td style="padding:6px 4px;text-align:right;color:var(--muted)">${_fRs(da)}</td>
      <td style="padding:6px 4px;text-align:right">${_fnum(rs)}</td>
      <td style="padding:6px 4px;text-align:right;font-weight:600;color:${rr>=15?'var(--accent-urgent)':rr>=8?'var(--accent-warning)':'var(--accent-success)'}">${rr}%</td>
    </tr>`;
  }).join('');

  const brandRows=Object.entries(brandMap).sort((a,b)=>b[1].dShip-a[1].dShip).map(([name,v])=>{
    const rr=v.dShip?Math.round(100*v.rShip/v.dShip):0;
    return `<tr style="border-bottom:1px solid #f5f5f5">
      <td style="padding:6px 4px;font-weight:600">${name}</td>
      <td style="padding:6px 4px;text-align:right">${_fnum(v.dShip)}</td>
      <td style="padding:6px 4px;text-align:right;color:var(--muted)">${_fRs(v.dAmt)}</td>
      <td style="padding:6px 4px;text-align:right">${_fnum(v.rShip)}</td>
      <td style="padding:6px 4px;text-align:right;font-weight:600">${rr}%</td>
    </tr>`;
  }).join('');

  const courierRows=Object.entries(courierMap).sort((a,b)=>b[1].dShip-a[1].dShip).map(([name,v])=>`<tr style="border-bottom:1px solid #f5f5f5">
      <td style="padding:6px 4px;font-weight:600">${name}</td>
      <td style="padding:6px 4px;text-align:right">${_fnum(v.dShip)}</td>
      <td style="padding:6px 4px;text-align:right;color:var(--muted)">${_fRs(v.dAmt)}</td>
      <td style="padding:6px 4px;text-align:right">${_fnum(v.rShip)}</td>
    </tr>`).join('');

  const th=(t,align)=>`<th style="padding:6px 4px;border-bottom:2px solid var(--border);font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;text-align:${align||'left'}">${t}</th>`;

  return `${_fulfillPeriodChips()}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">
    ${kpi('Dispatched',_fnum(dShip),_fRs(dAmt)+' value','var(--accent-success)')}
    ${kpi('Returns',_fnum(rShip),_fRs(rAmt)+' value','var(--accent-urgent)')}
    ${kpi('Return rate',retRate.toFixed(1)+'%','returns ÷ dispatched',retRate>=15?'var(--accent-urgent)':retRate>=8?'var(--accent-warning)':'var(--accent-success)')}
    ${kpi('Avg / day',_fnum(avgPerDay),days+' day'+(days===1?'':'s')+' recorded')}
    ${kpi('Best day',_fnum(best.val),best.date?_fulfillFmtDate(best.date):'—')}
  </div>

  ${sec('Dispatched — last '+chart.length+' recorded days',
    `<div style="display:flex;align-items:flex-end;gap:4px;height:150px;padding-top:6px">${bars}</div>`)}

  ${sec('Daily breakdown',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:420px">
    <thead><tr>${th('Date')}${th('Dispatched','right')}${th('Value','right')}${th('Returns','right')}${th('Ret %','right')}</tr></thead>
    <tbody>${trendRows}</tbody></table></div>`)}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
    ${sec('By brand',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:300px">
      <thead><tr>${th('Brand')}${th('Disp','right')}${th('Value','right')}${th('Ret','right')}${th('Ret %','right')}</tr></thead>
      <tbody>${brandRows}</tbody></table></div>`)}
    ${sec('By courier',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:280px">
      <thead><tr>${th('Courier')}${th('Disp','right')}${th('Value','right')}${th('Ret','right')}</tr></thead>
      <tbody>${courierRows}</tbody></table></div>`)}
  </div>`;
}

function _fulfillPeriodChips(){
  const opts=[[7,'7d'],[30,'30d'],[90,'90d'],[0,'All']];
  return `<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
    ${opts.map(([d,l])=>`<button class="filter-chip${_fulfillPeriod===d?' active':''}" onclick="window.setFulfillPeriod(${d})">${l}</button>`).join('')}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════
//  LOG — date-wise list of every saved report, with PDF + edit
// ══════════════════════════════════════════════════════════════════════
function _renderFulfillLog(){
  if(!fulfillReports.length)
    return `<div class="empty">No days recorded yet.<br><br>
      <button class="btn-outline" onclick="window.switchFulfillTab('entry')">Record the first day</button></div>`;

  const rows=[...fulfillReports].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>{
    const ds=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    const da=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
    const rs=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    const ra=(r.returnsTotal&&r.returnsTotal.amount)||0;
    const rr=ds?Math.round(100*rs/ds):0;
    const who=r.enteredBy||r.updatedBy||'—';
    return `<div class="po-row" style="cursor:default">
      <div class="po-info">
        <div class="po-num">${_fulfillFmtDate(r.date)}</div>
        <div class="po-name">${_fnum(ds)} dispatched · ${_fRs(da)}</div>
        <div class="po-meta">Returns ${_fnum(rs)} · ${_fRs(ra)} · Ret ${rr}% · by ${who}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-pdf" onclick="window.fulfillPdf('${r.date}')">PDF</button>
        <button class="btn-outline" onclick="window.fulfillEditDate('${r.date}')">Edit</button>
      </div>
    </div>`;
  }).join('');

  return `<div style="font-size:12px;color:var(--muted);margin-bottom:10px">${fulfillReports.length} day${fulfillReports.length===1?'':'s'} recorded · newest first. Tap PDF to open/print or download any day.</div>
    ${rows}`;
}

window.fulfillEditDate=function(date){
  _fulfillEntryDate=date;
  _fulfillTab='entry';
  const m=document.getElementById('main-content');
  if(m){m.innerHTML=renderFulfillmentPage();window._fulfillRecalc();}
};

// Generate (open + download) the one-day PDF via the shared print engine.
window.fulfillPdf=function(date){
  const r=fulfillReports.find(x=>x.date===date);
  if(!r)return showToast('Report not found.',true);
  if(typeof printDocument!=='function')return showToast('Print engine not loaded yet — retry in a moment.',true);
  printDocument({
    type:'daily-performance',
    filename:`daily-performance-${date}.pdf`,
    data:{
      documentType:'Daily Performance',
      id:date,
      date:date,
      dateLabel:_fulfillFmtDate(date),
      issuedDate:_fulfillFmtDate(date),
      issuedBy:r.enteredBy||r.updatedBy||'—',
      dispatched:r.dispatched||[],
      returns:r.returns||[],
      dispatchedTotal:r.dispatchedTotal||{shipments:0,amount:0},
      returnsTotal:r.returnsTotal||{shipments:0,amount:0},
      urduLevel:'minimal'
    }
  });
};

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
  {brand:'GROOVY',          courier:'BLUE-EX'},
  {brand:'Groovy/Culture',  courier:'TCS'},
];
// The brand/courier rows currently rendered in the entry form — the fixed
// template for a new day, or a saved record's own rows when editing (imported
// days can carry a different return layout). Recalc + save read from here so
// the labels shown always match what gets written.
let _fulfillActiveRows={d:FULFILL_DISPATCH_ROWS,r:FULFILL_RETURN_ROWS};

// ── Module state ──
let fulfillReports=[];          // cached docs, newest first
let fulfillReportsLoaded=false;
let _fulfillTab='analytics';    // 'analytics' | 'entry'
let _fulfillRangeKey='30d';     // active range preset key (or 'custom')
let _fulfillFrom=null;          // custom-range start (ISO) — used when key==='custom'
let _fulfillTo=null;            // custom-range end   (ISO)
let _fulfillTrend='daily';      // trend bucket: 'daily' | 'weekly' | 'monthly'
let _fulfillMetric='shipments'; // chart metric: 'shipments' | 'value'
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
function _fulfillISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function _fulfillAddDays(iso,n){const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return _fulfillISO(d);}
function _fulfillDaysBetween(a,b){return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000)+1;}
// Resolve a preset key → {from,to} (inclusive ISO bounds; null = open/all-time).
function _fulfillPreset(key){
  const today=_fulfillToday();
  const now=new Date(today+'T00:00:00');
  switch(key){
    case 'today':     return {from:today,to:today};
    case 'yesterday': {const y=_fulfillAddDays(today,-1);return {from:y,to:y};}
    case '7d':        return {from:_fulfillAddDays(today,-6),to:today};
    case '30d':       return {from:_fulfillAddDays(today,-29),to:today};
    case '90d':       return {from:_fulfillAddDays(today,-89),to:today};
    case 'thismonth': return {from:_fulfillISO(new Date(now.getFullYear(),now.getMonth(),1)),to:today};
    case 'lastmonth': return {from:_fulfillISO(new Date(now.getFullYear(),now.getMonth()-1,1)),to:_fulfillISO(new Date(now.getFullYear(),now.getMonth(),0))};
    case 'all':       return {from:null,to:null};
    default:          return null;
  }
}
// The active [from,to] for the current selection.
function _fulfillRange(){
  if(_fulfillRangeKey==='custom')return {from:_fulfillFrom,to:_fulfillTo};
  return _fulfillPreset(_fulfillRangeKey)||_fulfillPreset('30d');
}
function _fulfillDayName(iso,long){
  const d=new Date(iso+'T00:00:00');
  return isNaN(d)?'':d.toLocaleDateString('en-GB',{weekday:long?'long':'short'});
}
function _fulfillFmtDateShort(iso){
  const d=new Date(iso+'T00:00:00');
  return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}
// Monday (ISO week start) of the week containing `iso`, as YYYY-MM-DD.
function _fulfillMonday(iso){
  const d=new Date(iso+'T00:00:00');
  const off=(d.getDay()+6)%7; // 0=Mon … 6=Sun
  d.setDate(d.getDate()-off);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _niceCeil(v){
  if(v<=5)return 5;
  const p=Math.pow(10,Math.floor(Math.log10(v)));
  const n=v/p;const m=n<=1?1:n<=2?2:n<=5?5:10;
  return m*p;
}
// Aggregate a list of daily reports into totals + per-brand / per-courier maps.
function _sumFulfill(list){
  let dShip=0,dAmt=0,rShip=0,rAmt=0;const brand={},courier={};
  const bump=(map,key,f)=>{const o=map[key]||(map[key]={dShip:0,dAmt:0,rShip:0,rAmt:0});f(o);};
  for(const rep of list){
    for(const row of (rep.dispatched||[])){
      dShip+=row.shipments||0;dAmt+=row.amount||0;
      bump(brand,row.brand,o=>{o.dShip+=row.shipments||0;o.dAmt+=row.amount||0;});
      bump(courier,row.courier,o=>{o.dShip+=row.shipments||0;o.dAmt+=row.amount||0;});
    }
    for(const row of (rep.returns||[])){
      rShip+=row.shipments||0;rAmt+=row.amount||0;
      bump(brand,row.brand,o=>{o.rShip+=row.shipments||0;o.rAmt+=row.amount||0;});
      bump(courier,row.courier,o=>{o.rShip+=row.shipments||0;o.rAmt+=row.amount||0;});
    }
  }
  return {dShip,dAmt,rShip,rAmt,brand,courier};
}
// Group daily reports into ISO weeks (Mon start), sorted oldest first.
function _fulfillWeekly(reps){
  const map={};
  for(const r of reps){
    const wk=_fulfillMonday(r.date);
    const m=map[wk]||(map[wk]={week:wk,dShip:0,dAmt:0,rShip:0,rAmt:0,days:0});
    m.dShip+=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    m.dAmt+=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
    m.rShip+=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    m.rAmt+=(r.returnsTotal&&r.returnsTotal.amount)||0;
    m.days++;
  }
  return Object.values(map).sort((a,b)=>a.week.localeCompare(b.week));
}
// Group daily reports into calendar months, sorted oldest first.
function _fulfillMonthly(reps){
  const map={};
  for(const r of reps){
    const k=r.date.slice(0,7); // YYYY-MM
    const m=map[k]||(map[k]={month:k,dShip:0,dAmt:0,rShip:0,rAmt:0,days:0});
    m.dShip+=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    m.dAmt+=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
    m.rShip+=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    m.rAmt+=(r.returnsTotal&&r.returnsTotal.amount)||0;
    m.days++;
  }
  return Object.values(map).sort((a,b)=>a.month.localeCompare(b.month));
}
function _fulfillMonthLabel(ym){
  const d=new Date(ym+'-01T00:00:00');
  return isNaN(d)?ym:d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'});
}
// Small ▲/▼ % change chip. invert=true → "up" is bad (returns, return-rate).
function _deltaChip(cur,prev,invert){
  if(prev==null)return '';
  if(prev===0)return cur>0?'<span style="font-size:12px;color:var(--muted)"> · new</span>':'';
  const pct=Math.round(100*(cur-prev)/prev);
  const arrow=pct>0?'▲':pct<0?'▼':'▬';
  const good=pct===0?null:(invert?pct<0:pct>0);
  const color=good===null?'var(--muted)':(good?'var(--accent-success)':'var(--accent-urgent)');
  return `<span style="font-size:12px;font-weight:600;color:${color}"> ${arrow} ${Math.abs(pct)}%</span>`;
}
// Inline SVG two-line chart: Dispatched (dark) vs Returns (red). points:[{label,d,r}].
function _fulfillLineChart(points){
  const W=960,H=250,padL=48,padR=18,padT=20,padB=46;
  const n=points.length;
  const maxV=Math.max(1,...points.map(p=>Math.max(p.d||0,p.r||0)));
  const top=_niceCeil(maxV);
  const X=i=>n<=1?padL+(W-padL-padR)/2:padL+(i*(W-padL-padR)/(n-1));
  const Y=v=>H-padB-((v/top)*(H-padT-padB));
  let grid='';
  for(let t=0;t<=4;t++){const gv=top*t/4,gy=Y(gv);
    grid+=`<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W-padR}" y2="${gy.toFixed(1)}" stroke="#ececec" stroke-width="1"/>`
        +`<text x="${padL-8}" y="${(gy+4).toFixed(1)}" text-anchor="end" font-size="12" fill="#999">${_fnum(Math.round(gv))}</text>`;}
  const poly=key=>points.map((p,i)=>`${X(i).toFixed(1)},${Y(p[key]||0).toFixed(1)}`).join(' ');
  const dots=(key,color)=>points.map((p,i)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(p[key]||0).toFixed(1)}" r="${n<=16?4:2.5}" fill="${color}"/>`).join('');
  const step=Math.max(1,Math.ceil(n/12));
  let xlab='';points.forEach((p,i)=>{if(i%step!==0&&i!==n-1)return;xlab+=`<text x="${X(i).toFixed(1)}" y="${H-padB+18}" text-anchor="middle" font-size="12" fill="#777">${p.label}</text>`;});
  const dLine=n>1?`<polyline points="${poly('d')}" fill="none" stroke="#111" stroke-width="2.5"/>`:'';
  const rLine=n>1?`<polyline points="${poly('r')}" fill="none" stroke="#7B1F2A" stroke-width="2"/>`:'';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="height:${H}px;display:block;max-width:100%">
      ${grid}${dLine}${rLine}${dots('d','#111')}${dots('r','#7B1F2A')}${xlab}
    </svg>
    <div style="display:flex;gap:20px;justify-content:center;margin-top:8px;font-size:13px">
      <span style="display:inline-flex;align-items:center;gap:7px"><span style="width:18px;height:3px;background:#111;display:inline-block;border-radius:2px"></span>Dispatched</span>
      <span style="display:inline-flex;align-items:center;gap:7px"><span style="width:18px;height:3px;background:#7B1F2A;display:inline-block;border-radius:2px"></span>Returns</span>
    </div>`;
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
  // Editing a saved day reuses its own brand/courier layout (imported days can
  // differ from the default template); a new day uses the fixed template.
  _fulfillActiveRows={
    d:(existing&&existing.dispatched&&existing.dispatched.length)?existing.dispatched:FULFILL_DISPATCH_ROWS,
    r:(existing&&existing.returns&&existing.returns.length)?existing.returns:FULFILL_RETURN_ROWS
  };

  // Clear a lone "0" on focus and select the contents so the first keystroke
  // overwrites — no more deleting the placeholder zero before typing.
  const _focusJS="this.value==='0'&&(this.value='');this.select()";
  const rowInputs=(rows,section,saved)=>rows.map((r,i)=>{
    const s=(saved&&saved[i])||{};
    return `<tr>
      <td style="padding:9px 8px;font-size:14px;font-weight:600">${r.brand}</td>
      <td style="padding:9px 8px;font-size:13px;color:var(--muted)">${r.courier}</td>
      <td style="padding:5px 6px"><input type="number" min="0" inputmode="numeric" id="fd-${section}-${i}-ship"
        value="${s.shipments!=null?s.shipments:''}" placeholder="0" oninput="window._fulfillRecalc()" onfocus="${_focusJS}"
        style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;font-size:15px;text-align:right;background:#FAFAFA;font-family:inherit;outline:none"></td>
      <td style="padding:5px 6px"><input type="number" min="0" inputmode="numeric" id="fd-${section}-${i}-amt"
        value="${s.amount!=null?s.amount:''}" placeholder="0" oninput="window._fulfillRecalc()" onfocus="${_focusJS}"
        style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;font-size:15px;text-align:right;background:#FAFAFA;font-family:inherit;outline:none"></td>
    </tr>`;
  }).join('');

  const tbl=(title,rows,section,saved,accent)=>`<div class="card" style="margin-bottom:12px">
    <div class="card-title" style="border-bottom:none;margin-bottom:6px;color:${accent};font-size:13px">${title}</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:340px">
      <thead><tr style="text-align:left">
        <th style="padding:6px 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Brand</th>
        <th style="padding:6px 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Courier</th>
        <th style="padding:6px 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right">Shipments</th>
        <th style="padding:6px 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right">Amount (Rs)</th>
      </tr></thead>
      <tbody>${rowInputs(rows,section,saved)}</tbody>
      <tfoot><tr style="border-top:2px solid var(--border)">
        <td colspan="2" style="padding:9px;font-size:14px;font-weight:700">GRAND TOTAL</td>
        <td id="fd-${section}-tot-ship" style="padding:9px;font-size:16px;font-weight:700;text-align:right">0</td>
        <td id="fd-${section}-tot-amt" style="padding:9px;font-size:16px;font-weight:700;text-align:right">Rs 0</td>
      </tr></tfoot>
    </table></div>
  </div>`;

  return `<div class="card" style="margin-bottom:12px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:180px">
        <label>Report date</label>
        <input type="date" id="fd-date" value="${date}" max="${_fulfillToday()}" onchange="window.loadFulfillDate()">
      </div>
      <div style="font-size:14px;font-weight:600;color:${existing?'var(--accent-warning)':'var(--text)'};padding-bottom:10px">
        ${existing?'✎ Editing ':''}${_fulfillDayName(date,true)}, ${_fulfillFmtDate(date)}
      </div>
    </div>
    ${tbl('DISPATCHED',_fulfillActiveRows.d,'d',existing&&existing.dispatched,'var(--accent-success)')}
    ${tbl('RETURNS',_fulfillActiveRows.r,'r',existing&&existing.returns,'var(--accent-urgent)')}
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
  const d=_fulfillReadSection('d',_fulfillActiveRows.d);
  const r=_fulfillReadSection('r',_fulfillActiveRows.r);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('fd-d-tot-ship',_fnum(d.totShip));set('fd-d-tot-amt',_fRs(d.totAmt));
  set('fd-r-tot-ship',_fnum(r.totShip));set('fd-r-tot-amt',_fRs(r.totAmt));
};

window.saveFulfillReport=async function(alsoPdf){
  if(!_canEditFulfillment())return showToast('Not allowed.',true);
  const date=(document.getElementById('fd-date')||{}).value;
  if(!date)return showToast('Pick a date first.',true);
  const d=_fulfillReadSection('d',_fulfillActiveRows.d);
  const r=_fulfillReadSection('r',_fulfillActiveRows.r);
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
window.setFulfillRange=function(key){
  _fulfillRangeKey=key;
  if(key!=='custom'){const p=_fulfillPreset(key);if(p){_fulfillFrom=p.from;_fulfillTo=p.to;}}
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};
window.applyFulfillCustom=function(){
  let f=(document.getElementById('fr-from')||{}).value;
  let t=(document.getElementById('fr-to')||{}).value;
  if(!f||!t)return showToast('Pick both a From and To date.',true);
  if(f>t){const tmp=f;f=t;t=tmp;}
  _fulfillRangeKey='custom';_fulfillFrom=f;_fulfillTo=t;
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};
window.setFulfillTrend=function(mode){
  _fulfillTrend=(['weekly','monthly'].includes(mode)?mode:'daily');
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};
window.setFulfillMetric=function(m){
  _fulfillMetric=(m==='value'?'value':'shipments');
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};

function _renderFulfillAnalytics(){
  if(!fulfillReports.length)
    return `<div class="empty">No daily reports yet.<br><br>
      <button class="btn-outline" onclick="window.switchFulfillTab('entry')">Record the first day</button></div>`;

  const rng=_fulfillRange();const from=rng.from,to=rng.to;
  const reps=fulfillReports.filter(r=>(from==null||r.date>=from)&&(to==null||r.date<=to));
  if(!reps.length)
    return `${_fulfillRangeBar(from,to)}<div class="empty">No reports in this date range.</div>`;

  const repsAsc=[...reps].sort((a,b)=>a.date.localeCompare(b.date));
  const cur=_sumFulfill(reps);
  const days=reps.length;
  const retRate=cur.dShip?(100*cur.rShip/cur.dShip):0;
  const avgPerDay=days?Math.round(cur.dShip/days):0;
  const best=repsAsc.reduce((m,r)=>{const v=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;return v>m.val?{val:v,date:r.date}:m;},{val:0,date:null});

  // ── Compare: the immediately-preceding window of equal length ──
  let prev=null,prevRate=null,prevFrom=null,prevTo=null;
  if(from&&to){
    const len=_fulfillDaysBetween(from,to);
    prevTo=_fulfillAddDays(from,-1);
    prevFrom=_fulfillAddDays(prevTo,-(len-1));
    const prevReps=fulfillReports.filter(r=>r.date>=prevFrom&&r.date<=prevTo);
    if(prevReps.length){prev=_sumFulfill(prevReps);prevRate=prev.dShip?100*prev.rShip/prev.dShip:0;}
  }

  const kpi=(label,val,sub,color)=>`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px 14px;text-align:center">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">${label}</div>
    <div style="font-size:26px;font-weight:800;color:${color||'var(--text)'}">${val}</div>
    ${sub?`<div style="font-size:12px;color:var(--muted);margin-top:3px">${sub}</div>`:''}
  </div>`;
  const sec=(title,body,extra)=>`<div class="card" style="margin-bottom:14px"><div class="card-title" style="font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px">${title}${extra||''}</div>${body}</div>`;
  const th=(t,align)=>`<th style="padding:8px 6px;border-bottom:2px solid var(--border);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;text-align:${align||'left'}">${t}</th>`;
  const td=(v,align,extra)=>`<td style="padding:9px 6px;text-align:${align||'left'};${extra||''}">${v}</td>`;
  const rrColor=rr=>rr>=15?'var(--accent-urgent)':rr>=8?'var(--accent-warning)':'var(--accent-success)';

  // ── Trend chart + breakdown (daily / weekly / monthly) ──
  const mode=_fulfillTrend;
  const isValue=_fulfillMetric==='value';
  // Normalise the chosen mode into a common bucket shape.
  let buckets,firstCol,firstColHdr,daily=false;
  if(mode==='weekly'){
    buckets=_fulfillWeekly(repsAsc).map(w=>({...w,label:'Wk of '+_fulfillFmtDateShort(w.week),chart:_fulfillFmtDateShort(w.week)}));
    firstColHdr=th('Week of');firstCol=b=>td(b.label,'left','font-weight:600;white-space:nowrap');
  }else if(mode==='monthly'){
    buckets=_fulfillMonthly(repsAsc).map(m=>({...m,label:_fulfillMonthLabel(m.month),chart:_fulfillMonthLabel(m.month)}));
    firstColHdr=th('Month');firstCol=b=>td(b.label,'left','font-weight:600;white-space:nowrap');
  }else{
    daily=true;
    buckets=repsAsc.slice(-31).map(r=>({
      date:r.date,label:_fulfillFmtDate(r.date),chart:_fulfillFmtDateShort(r.date),days:1,
      dShip:(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0,dAmt:(r.dispatchedTotal&&r.dispatchedTotal.amount)||0,
      rShip:(r.returnsTotal&&r.returnsTotal.shipments)||0,rAmt:(r.returnsTotal&&r.returnsTotal.amount)||0
    }));
    firstColHdr=th('Date')+th('Day');firstCol=b=>td(_fulfillFmtDate(b.date),'left','font-weight:600;white-space:nowrap')+td(_fulfillDayName(b.date),'left','color:var(--muted)');
  }
  const unit=buckets.length+' '+(mode==='weekly'?'week':mode==='monthly'?'month':'day')+(buckets.length===1?'':'s');
  const trendLabel=(daily?'last ':'')+unit;

  // Chart points — metric toggle plots shipment counts or Rs value (value =
  // net-revenue trend: gap between the two lines is the net).
  const points=buckets.map(b=>({label:b.chart,d:isValue?b.dAmt:b.dShip,r:isValue?b.rAmt:b.rShip}));

  const breakdownHead=`${firstColHdr}${th('Days','right')}${th('Dispatched','right')}${th('Value','right')}${th('Returns','right')}${th('Net','right')}${th('Ret %','right')}${th('vs prev','right')}`;
  const cmpKey=isValue?'dAmt':'dShip';
  const breakdownRows=buckets.map((b,i)=>({b,prev:i>0?buckets[i-1][cmpKey]:null})).reverse().map(({b,prev})=>{
    const rr=b.dShip?Math.round(100*b.rShip/b.dShip):0;
    const net=b.dAmt-b.rAmt;
    return `<tr style="border-bottom:1px solid #f5f5f5;font-size:14px">
      ${firstCol(b)}
      ${td(b.days,'right','color:var(--muted)')}
      ${td(_fnum(b.dShip),'right','font-weight:600')}
      ${td(_fRs(b.dAmt),'right','color:var(--muted)')}
      ${td(_fnum(b.rShip),'right')}
      ${td(_fRs(net),'right','font-weight:600')}
      ${td(rr+'%','right','font-weight:600;color:'+rrColor(rr))}
      ${td(_deltaChip(b[cmpKey],prev,false)||'<span style="color:var(--muted)">—</span>','right')}
    </tr>`;
  }).join('');

  const tBtn=(m,l)=>`<button class="filter-chip${mode===m?' active':''}" style="padding:4px 11px" onclick="window.setFulfillTrend('${m}')">${l}</button>`;
  const mBtn=(m,l)=>`<button class="filter-chip${_fulfillMetric===m?' active':''}" style="padding:4px 11px" onclick="window.setFulfillMetric('${m}')">${l}</button>`;
  const trendToggle=`<span style="display:inline-flex;gap:10px;flex-wrap:wrap">
    <span style="display:inline-flex;gap:4px">${tBtn('daily','Daily')}${tBtn('weekly','Weekly')}${tBtn('monthly','Monthly')}</span>
    <span style="display:inline-flex;gap:4px">${mBtn('shipments','Shipments')}${mBtn('value','Value')}</span>
  </span>`;

  const brandRows=Object.entries(cur.brand).sort((a,b)=>b[1].dShip-a[1].dShip).map(([name,v])=>{
    const rr=v.dShip?Math.round(100*v.rShip/v.dShip):0;
    return `<tr style="border-bottom:1px solid #f5f5f5;font-size:14px">
      ${td(name,'left','font-weight:600')}${td(_fnum(v.dShip),'right')}${td(_fRs(v.dAmt),'right','color:var(--muted)')}${td(_fnum(v.rShip),'right')}${td(rr+'%','right','font-weight:600')}
    </tr>`;
  }).join('');
  const courierRows=Object.entries(cur.courier).sort((a,b)=>b[1].dShip-a[1].dShip).map(([name,v])=>{
    const rr=v.dShip?Math.round(100*v.rShip/v.dShip):0;
    return `<tr style="border-bottom:1px solid #f5f5f5;font-size:14px">
      ${td(name,'left','font-weight:600')}${td(_fnum(v.dShip),'right')}${td(_fRs(v.dAmt),'right','color:var(--muted)')}${td(_fnum(v.rShip),'right')}${td(rr+'%','right','font-weight:600')}
    </tr>`;
  }).join('');

  const rateSub=prevRate!=null
    ? `${(retRate-prevRate>=0?'+':'')}${(retRate-prevRate).toFixed(1)}pp vs prev`
    : 'returns ÷ dispatched';
  const cmpNote=prev
    ? `<span style="font-size:12px;color:var(--muted);font-weight:500">▲▼ vs ${_fulfillFmtDate(prevFrom)} → ${_fulfillFmtDate(prevTo)}</span>`
    : '';
  const netVal=cur.dAmt-cur.rAmt;
  const modeCap=mode.charAt(0).toUpperCase()+mode.slice(1);

  return `${_fulfillRangeBar(from,to)}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
    ${kpi('Dispatched',_fnum(cur.dShip),_fRs(cur.dAmt)+' value'+(prev?_deltaChip(cur.dShip,prev.dShip,false):''),'var(--accent-success)')}
    ${kpi('Returns',_fnum(cur.rShip),_fRs(cur.rAmt)+' value'+(prev?_deltaChip(cur.rShip,prev.rShip,true):''),'var(--accent-urgent)')}
    ${kpi('Net value',_fRs(netVal),(prev?_deltaChip(netVal,prev.dAmt-prev.rAmt,false)+' ':'')+'after returns','var(--text)')}
    ${kpi('Return rate',retRate.toFixed(1)+'%',rateSub,rrColor(retRate))}
    ${kpi('Avg / day',_fnum(avgPerDay),days+' day'+(days===1?'':'s')+' recorded')}
    ${kpi('Best day',_fnum(best.val),best.date?_fulfillFmtDate(best.date):'—')}
  </div>

  ${sec(modeCap+' trend — '+trendLabel+(isValue?' · value (Rs)':''),_fulfillLineChart(points),trendToggle)}

  ${sec(modeCap+' breakdown',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:580px">
    <thead><tr>${breakdownHead}</tr></thead><tbody>${breakdownRows}</tbody></table></div>`,cmpNote)}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
    ${sec('By brand',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:320px">
      <thead><tr>${th('Brand')}${th('Disp','right')}${th('Value','right')}${th('Ret','right')}${th('Ret %','right')}</tr></thead>
      <tbody>${brandRows}</tbody></table></div>`)}
    ${sec('By courier',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:320px">
      <thead><tr>${th('Courier')}${th('Disp','right')}${th('Value','right')}${th('Ret','right')}${th('Ret %','right')}</tr></thead>
      <tbody>${courierRows}</tbody></table></div>`)}
  </div>`;
}

// Date-range control: preset chips + a From/To calendar for a custom range,
// an Excel export button, and a label showing the active range and the
// comparison window (the equal-length period immediately before it).
function _fulfillRangeBar(from,to){
  const presets=[['today','Today'],['yesterday','Yesterday'],['7d','Last 7 Days'],['30d','Last 30 Days'],['90d','Last 90 Days'],['thismonth','This Month'],['lastmonth','Last Month'],['all','All']];
  const chips=presets.map(([k,l])=>`<button class="filter-chip${_fulfillRangeKey===k?' active':''}" onclick="window.setFulfillRange('${k}')">${l}</button>`).join('');
  const today=_fulfillToday();
  let label,cmp='';
  if(from&&to){
    label=`${_fulfillFmtDate(from)} → ${_fulfillFmtDate(to)} · ${_fulfillDaysBetween(from,to)} days`;
    const len=_fulfillDaysBetween(from,to);
    const pTo=_fulfillAddDays(from,-1),pFrom=_fulfillAddDays(pTo,-(len-1));
    cmp=`<span style="color:var(--muted)"> · vs ${_fulfillFmtDate(pFrom)} → ${_fulfillFmtDate(pTo)}</span>`;
  }else{
    label='All time';
  }
  return `<div style="margin-bottom:14px">
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chips}</div>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="width:150px"><label>From</label><input type="date" id="fr-from" value="${from||''}" max="${today}"></div>
      <div class="field" style="width:150px"><label>To</label><input type="date" id="fr-to" value="${to||''}" max="${today}"></div>
      <button class="btn-outline" onclick="window.applyFulfillCustom()">Apply range</button>
      <button class="btn-pdf" onclick="window.fulfillExport()" title="Export all days to Excel" style="margin-left:auto">⤓ Excel</button>
    </div>
    <div style="font-size:12px;color:var(--text);font-weight:600;margin-top:8px">${label}${cmp}</div>
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
        <div class="po-num" style="font-size:13px">${_fulfillDayName(r.date,true)}, ${_fulfillFmtDate(r.date)}</div>
        <div class="po-name" style="font-size:15px">${_fnum(ds)} dispatched · ${_fRs(da)}</div>
        <div class="po-meta" style="font-size:13px">Returns ${_fnum(rs)} · ${_fRs(ra)} · Ret ${rr}% · by ${who}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-pdf" onclick="window.fulfillPdf('${r.date}')">PDF</button>
        <button class="btn-outline" onclick="window.fulfillEditDate('${r.date}')">Edit</button>
      </div>
    </div>`;
  }).join('');

  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <div style="font-size:13px;color:var(--muted)">${fulfillReports.length} day${fulfillReports.length===1?'':'s'} recorded · newest first. Tap PDF to open/print or download any day.</div>
      <button class="btn-pdf" onclick="window.fulfillExport()" title="Export all days to Excel">⤓ Export Excel</button>
    </div>
    ${rows}`;
}

window.fulfillEditDate=function(date){
  _fulfillEntryDate=date;
  _fulfillTab='entry';
  const m=document.getElementById('main-content');
  if(m){m.innerHTML=renderFulfillmentPage();window._fulfillRecalc();}
};

// Export every recorded day to an Excel workbook (SheetJS, loaded globally).
// Two sheets: a per-day summary and a per-line-item detail.
window.fulfillExport=function(){
  if(typeof XLSX==='undefined')return showToast('Excel library not loaded — retry in a moment.',true);
  const reps=[...fulfillReports].sort((a,b)=>a.date.localeCompare(b.date));
  if(!reps.length)return showToast('Nothing to export yet.',true);
  const summary=reps.map(r=>{
    const ds=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    const da=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
    const rs=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    const ra=(r.returnsTotal&&r.returnsTotal.amount)||0;
    return {
      Date:r.date, Day:_fulfillDayName(r.date,true),
      'Dispatched Shipments':ds, 'Dispatched Value':da,
      'Returns Shipments':rs, 'Returns Value':ra,
      'Net Value':da-ra, 'Return %':ds?Math.round(100*rs/ds):0,
      'Entered By':r.enteredBy||r.updatedBy||''
    };
  });
  const detail=[];
  for(const r of reps){
    (r.dispatched||[]).forEach(row=>detail.push({Date:r.date,Day:_fulfillDayName(r.date,true),Type:'Dispatched',Brand:row.brand,Courier:row.courier,Shipments:row.shipments||0,Amount:row.amount||0}));
    (r.returns||[]).forEach(row=>detail.push({Date:r.date,Day:_fulfillDayName(r.date,true),Type:'Return',Brand:row.brand,Courier:row.courier,Shipments:row.shipments||0,Amount:row.amount||0}));
  }
  try{
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),'Daily Summary');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),'Detail');
    XLSX.writeFile(wb,`daily-performance-${_fulfillToday()}.xlsx`);
    showToast(`Exported ${reps.length} day${reps.length===1?'':'s'} ✓`);
  }catch(e){
    console.warn('[fulfillment] export failed',e);
    showToast('Export failed: '+(e.message||'unknown'),true);
  }
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

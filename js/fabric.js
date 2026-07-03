// ===== Fabric Inventory module =====
// Top-level "Fabric Inventory" page (owners + managers). One home for the whole
// fabric lifecycle: Stock · Fabric In · Issue · Returns · Reports.
// Classic global script — loaded AFTER gatepass.js so it can reuse _gpEsc,
// _fabInvKey, _fabInvUpsert, allFabricInventory/Movements (declared in shared.js).
// See FABRIC_INVENTORY_PLAN.md for the full acceptance spec.
//
// Phase 1: Stock tab is fully functional (moved verbatim from store.js). The
// other sub-tabs render a phased placeholder until their phase lands.

let fabActiveTab='stock';
let _fabInvCatFilter='all';   // category (fabType) filter for the Stock tab
let _fabInvView='vendor';     // 'vendor' | 'fabric' — By Vendor is default
let _fabInvCollapsed=new Set(); // vendor names currently collapsed
let _fabInListPage=0;          // current page in Fabric In arrivals list (0-indexed)
let _fabBusy=false;           // re-entrancy guard: blocks double-submit/dupes

// Animated busy overlay shown during any time-taking fabric write. The full-
// screen overlay also blocks clicks, so a second tap can't fire the same save
// twice (the #1 cause of duplicate entries). Used by every mutating handler.
function _fabShowBusy(on,label){
  let el=document.getElementById('fab-busy');
  if(on){
    if(!document.getElementById('fab-busy-style')){
      const st=document.createElement('style');st.id='fab-busy-style';
      st.textContent='@keyframes fabspin{to{transform:rotate(360deg)}}';document.head.appendChild(st);
    }
    if(!el){
      el=document.createElement('div');el.id='fab-busy';
      el.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.55)';
      el.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;gap:10px;background:#111;color:#fff;padding:16px 24px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25)">
        <svg width="26" height="26" viewBox="0 0 50 50" style="animation:fabspin .8s linear infinite"><circle cx="25" cy="25" r="20" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="80 50"/></svg>
        <span id="fab-busy-label" style="font-size:12px;letter-spacing:.02em">Working…</span></div>`;
      document.body.appendChild(el);
    }
    const lbl=document.getElementById('fab-busy-label');if(lbl)lbl.textContent=label||'Working…';
    el.style.display='flex';
  }else if(el){el.style.display='none';}
}
let _fabBusyTimer=null;
function _fabBusyStart(label){
  if(_fabBusy)return false;
  _fabBusy=true;_fabShowBusy(true,label);
  // Safety net: if a write/refresh ever stalls (e.g. network), force-clear the
  // overlay so it can never permanently block the whole UI.
  clearTimeout(_fabBusyTimer);
  _fabBusyTimer=setTimeout(()=>{_fabBusy=false;_fabShowBusy(false);},25000);
  return true;
}
function _fabBusyEnd(){_fabBusy=false;clearTimeout(_fabBusyTimer);_fabShowBusy(false);}

function renderFabricPage(){
  return`<div class="page-head"><div class="page-title">Fabric Inventory</div></div>
  <div class="gp-tabs">
    <button class="gp-tab" id="fabtab-stock" onclick="window.switchFabTab('stock')">Stock</button>
    <button class="gp-tab" id="fabtab-fabricin" onclick="window.switchFabTab('fabricin')">Fabric In</button>
    <button class="gp-tab" id="fabtab-issue" onclick="window.switchFabTab('issue')">Issue</button>
    <button class="gp-tab" id="fabtab-registry" onclick="window.switchFabTab('registry')">Issue Registry</button>
    <button class="gp-tab" id="fabtab-returns" onclick="window.switchFabTab('returns')">Returns</button>
    <button class="gp-tab" id="fabtab-reports" onclick="window.switchFabTab('reports')">Reports</button>
    <button class="gp-tab" id="fabtab-log" onclick="window.switchFabTab('log')">Log</button>
  </div>
  <div id="fab-tab-content"></div>`;
}

window.switchFabTab=function(tab){
  fabActiveTab=tab;
  ['stock','fabricin','issue','registry','returns','reports','log'].forEach(t=>{
    const b=document.getElementById('fabtab-'+t);
    if(b)b.classList.toggle('active',t===tab);
  });
  const el=document.getElementById('fab-tab-content');
  if(!el)return;
  if(tab==='stock'){_fabInvDrillKey=null;el.innerHTML=renderFabricInventory();}
  else if(tab==='fabricin'){
    fabRollIdx=0;_fabInListPage=0;
    el.innerHTML=renderFabricInTab();
    window.addFabRoll();
    renderFabricInList();
  }
  else if(tab==='issue'){
    _fabIssueRolls=[];_fabIssueKey=null;_fabIssueSizes=[{size:'',perBundle:'',bundles:''}];
    el.innerHTML=renderFabricIssueTab();
    _fabIssueRenderSizes();
    if(_fabIssuePreselectKey){
      const sel=document.getElementById('fab-iss-stock');
      if(sel){sel.value=_fabIssuePreselectKey;window.fabIssuePickStock();}
      _fabIssuePreselectKey='';
    }
    _fabFocusScan('fab-iss-scan');
  }
  else if(tab==='registry'){
    el.innerHTML=renderFabricIssueRegistry();
  }
  else if(tab==='returns'){
    el.innerHTML=renderFabricReturnsTab();
    _fabFocusScan('fab-sret-scan');
  }
  else if(tab==='reports'){
    el.innerHTML=renderFabricReportsTab();
  }
  else if(tab==='log'){
    el.innerHTML=renderFabricLogTab();
  }
  else el.innerHTML=_fabPlaceholder(tab);
};

function _fabPlaceholder(tab){
  return`<div class="card" style="padding:28px;text-align:center">
    <div class="card-title" style="justify-content:center">Coming soon</div>
  </div>`;
}

// ── Stock alerts (Phase 6): 3 thresholds per fabric, colour-coded ──
function _fabAlertCfg(s){
  const t=(s&&s.thresholds)||{};
  return{t1:Number(t.t1)||50,t2:Number(t.t2)||25,t3:Number(t.t3)||10};
}
function _fabAlertLevel(s){
  const w=(s&&s.totalWeight)||0;const{t1,t2,t3}=_fabAlertCfg(s);
  if(w<=0)return{label:'Out of stock',color:'#6b7280',dot:'#9ca3af'};
  if(w<=t3)return{label:'Critical',color:'#dc2626',dot:'#dc2626'};
  if(w<=t2)return{label:'Very low',color:'#ea580c',dot:'#ea580c'};
  if(w<=t1)return{label:'Low',color:'#b45309',dot:'#f59e0b'};
  return{label:'OK',color:'#16a34a',dot:'#16a34a'};
}
window.fabSaveAlerts=async function(key){
  const s=allFabricInventory.find(x=>x._id===key);if(!s)return;
  const t1=parseFloat(document.getElementById('fab-th1')?.value)||0;
  const t2=parseFloat(document.getElementById('fab-th2')?.value)||0;
  const t3=parseFloat(document.getElementById('fab-th3')?.value)||0;
  try{
    await setDoc(doc(db,'fabric_inventory',key),{thresholds:{t1,t2,t3}},{merge:true});
    s.thresholds={t1,t2,t3};
    showToast('Alert levels saved ✓');
    if(_fabInvDrillKey)window.fabInvDrill(key);   // re-render drill AND redraw barcodes
    else{const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricInventory();}
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Stock tab ──
function renderFabricInventory(){
  if(_fabInvDrillKey){return _renderFabInvDrill(_fabInvDrillKey);}
  const agg=allFabricInventory.filter(s=>s);
  const totalKg=agg.filter(s=>(s.unit||'kg')==='kg').reduce((a,s)=>a+(s.totalWeight||0),0);
  const totalM=agg.filter(s=>(s.unit||'kg')==='meters'||(s.unit||'kg')==='m').reduce((a,s)=>a+(s.totalWeight||0),0);
  const totalRolls=agg.reduce((a,s)=>a+(s.rollsCount||0),0);
  const totalReservedKg=agg.reduce((a,s)=>a+(s.reservedWeight||0),0);
  const alertCount=agg.filter(s=>(s.totalWeight||0)>0&&_fabAlertLevel(s).label!=='OK').length;
  const outCount=agg.filter(s=>!(s.totalWeight>0)).length;
  const cats=[...new Set(agg.map(s=>(s.fabType||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  if(_fabInvCatFilter!=='all'&&!cats.includes(_fabInvCatFilter))_fabInvCatFilter='all';

  // Vendor map — built from active (in_stock + reserved) rolls
  const vMap={};
  for(const s of agg){
    for(const r of (s.rolls||[])){
      if(!['in_stock','reserved'].includes(r.status||'in_stock'))continue;
      const rcpt=allFabricIn.find(x=>x.id===r.sourceFabId);
      const sup=(rcpt?.supplier||'').trim()||'Unknown';
      if(!vMap[sup])vMap[sup]={totalWeight:0,rollsCount:0,fabricIds:new Set()};
      vMap[sup].totalWeight+=(r.weight||0);
      vMap[sup].rollsCount++;
      vMap[sup].fabricIds.add(s._id);
    }
  }
  const vendorNames=Object.keys(vMap).sort((a,b)=>vMap[b].totalWeight-vMap[a].totalWeight);

  // Filtered list for By Fabric view
  const filtered=agg.filter(s=>{
    if(_fabInvFilter==='in_stock'&&!(s.totalWeight>0))return false;
    if(_fabInvFilter==='empty'&&(s.totalWeight>0))return false;
    if(_fabInvCatFilter!=='all'&&(s.fabType||'').trim()!==_fabInvCatFilter)return false;
    if(_fabInvSearchQ){const q=_fabInvSearchQ.toLowerCase();if(!`${s.fabType||''} ${s.color||''} ${s.gsm||''}`.toLowerCase().includes(q))return false;}
    return true;
  }).sort((a,b)=>(a.fabType||'').localeCompare(b.fabType||'')||(a.color||'').localeCompare(b.color||'')||(a.gsm||0)-(b.gsm||0));

  // KPI strip values
  const kpiStock=totalKg.toFixed(1)+' kg'+(totalM?`<div style="font-size:11px;font-weight:500;color:var(--muted)">+ ${totalM.toFixed(1)} m</div>`:'');
  const kpiAlerts=alertCount+(outCount?`<div style="font-size:11px;font-weight:500;color:var(--muted)">${outCount} empty</div>`:'');

  let h=`<div class="page-head"><div class="page-title">Fabric Inventory</div></div>`;
  h+=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:14px">
    ${_fabKpiTile('Total Stock',kpiStock,'#2563eb')}
    ${_fabKpiTile('Rolls',totalRolls,'#7c3aed')}
    ${_fabKpiTile('Vendors',vendorNames.length,'#0891b2')}
    ${_fabKpiTile('Alerts',kpiAlerts,alertCount?'#dc2626':'#16a34a')}
    ${_fabKpiTile('Categories',cats.length,'#d97706')}
    ${_fabKpiTile('Reserved',totalReservedKg>0?totalReservedKg.toFixed(1)+' kg':'—',totalReservedKg?'#d97706':'#d1d5db')}
  </div>`;
  h+=`<div class="card" style="margin-bottom:14px;padding:12px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:8px;overflow:hidden;flex-shrink:0">
        <button onclick="window.fabInvSetView('vendor')" style="padding:6px 14px;border:none;border-right:1px solid var(--border);background:${_fabInvView==='vendor'?'var(--dark)':'#fff'};color:${_fabInvView==='vendor'?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit">By Vendor</button>
        <button onclick="window.fabInvSetView('fabric')" style="padding:6px 14px;border:none;background:${_fabInvView==='fabric'?'var(--dark)':'#fff'};color:${_fabInvView==='fabric'?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit">By Fabric</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${[['in_stock','In stock'],['empty','Out of stock'],['all','All']].map(([k,l])=>`<button onclick="window.fabInvSetFilter('${k}')" style="padding:6px 12px;border:1px solid ${_fabInvFilter===k?'var(--dark)':'var(--border)'};border-radius:999px;background:${_fabInvFilter===k?'var(--dark)':'#fff'};color:${_fabInvFilter===k?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit">${l}</button>`).join('')}
      </div>
      <input id="finv-search" placeholder="Search fabric…" value="${_fabInvSearchQ.replace(/"/g,'&quot;')}" oninput="window.fabInvSetSearch(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;outline:none;flex:1;min-width:160px">
    </div>
    ${cats.length?`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-right:2px">Category</span>
      ${[['all','All'],...cats.map(c=>[c,c])].map(([k,l])=>`<button onclick="window.fabInvSetCat('${_gpEsc(k).replace(/'/g,"\\'")}')" style="padding:5px 11px;border:1px solid ${_fabInvCatFilter===k?'var(--dark)':'var(--border)'};border-radius:999px;background:${_fabInvCatFilter===k?'var(--dark)':'#fff'};color:${_fabInvCatFilter===k?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit">${_gpEsc(l)}</button>`).join('')}
    </div>`:''}
  </div>`;
  h+=(_fabInvView==='vendor'?_renderFabByVendor(vendorNames,vMap,agg):_renderFabByFabric(filtered,vMap));
  return h+'<div style="height:80px"></div>';
}

// KPI tile — colored top border, label + large value
function _fabKpiTile(label,value,accent){
  return`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;border-top:3px solid ${accent}">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;font-weight:600">${label}</div>
    <div style="font-size:20px;font-weight:800;color:var(--text);line-height:1;letter-spacing:-.01em">${value}</div>
  </div>`;
}

// Mini stock-level bar scaled to 2× the "Low" threshold
function _fabStockBar(s){
  const w=s.totalWeight||0;
  if(!w)return'';
  const t1=_fabAlertCfg(s).t1||50;
  const pct=Math.min(100,w/(t1*2)*100);
  return`<div style="width:72px;height:3px;background:#e5e7eb;border-radius:2px;margin-top:5px;overflow:hidden"><div style="height:100%;width:${pct.toFixed(0)}%;background:${_fabAlertLevel(s).dot};border-radius:2px"></div></div>`;
}

// By Vendor view — vendor groups, each collapsible
function _renderFabByVendor(vendorNames,vMap,agg){
  if(!vendorNames.length)return`<div class="empty" style="padding:32px;text-align:center">No vendor data yet. Record fabric arrivals (Fabric In tab) to see vendor breakdown.</div>`;
  let h='';
  for(const sup of vendorNames){
    const v=vMap[sup];
    const expanded=!_fabInvCollapsed.has(sup);
    const fabrics=[...v.fabricIds].map(id=>agg.find(s=>s._id===id)).filter(Boolean).filter(s=>{
      if(_fabInvFilter==='in_stock'&&!(s.totalWeight>0))return false;
      if(_fabInvFilter==='empty'&&(s.totalWeight>0))return false;
      if(_fabInvCatFilter!=='all'&&(s.fabType||'').trim()!==_fabInvCatFilter)return false;
      if(_fabInvSearchQ){const q=_fabInvSearchQ.toLowerCase();if(!`${s.fabType||''} ${s.color||''} ${s.gsm||''}`.toLowerCase().includes(q))return false;}
      return true;
    }).sort((a,b)=>(a.fabType||'').localeCompare(b.fabType||'')||(a.color||'').localeCompare(b.color||'')||(a.gsm||0)-(b.gsm||0));
    if(!fabrics.length)continue;
    const alerts=fabrics.filter(s=>(s.totalWeight||0)>0&&_fabAlertLevel(s).label!=='OK').length;
    h+=`<div class="card" style="margin-bottom:10px;padding:0;overflow:hidden">
      <div onclick="window.fabInvToggleVendor('${_gpEsc(sup).replace(/'/g,"\\'")}')" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;user-select:none;border-bottom:${expanded?'1px solid var(--border)':'none'};background:#fafafa">
        <span style="font-size:10px;color:var(--muted);display:inline-block;transform:rotate(${expanded?'90deg':'0deg'});transition:transform .15s">▶</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_gpEsc(sup)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${v.totalWeight.toFixed(1)} kg · ${v.rollsCount} rolls · ${fabrics.length} fabric${fabrics.length!==1?'s':''}</div>
        </div>
        ${alerts?`<span style="background:#fef2f2;color:#dc2626;font-size:10px;font-weight:700;padding:3px 7px;border-radius:5px;flex-shrink:0">⚠ ${alerts} alert${alerts>1?'s':''}</span>`:''}
      </div>
      ${expanded?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#fff;border-bottom:1px solid var(--border)">
          <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Fabric</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">GSM</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Color</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Stock</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Rolls</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Status</th>
          <th></th>
        </tr></thead>
        <tbody>${fabrics.map(s=>{
          const empty=!(s.totalWeight>0);const lvl=_fabAlertLevel(s);
          return`<tr style="border-bottom:1px solid #f5f5f5${empty?';opacity:.6':''}">
            <td style="padding:10px;font-weight:600"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${lvl.dot};margin-right:6px;vertical-align:middle"></span>${_gpEsc(s.fabType||'—')}</td>
            <td style="padding:10px">${s.gsm||'—'}</td>
            <td style="padding:10px">${_gpEsc(s.color||'—')}</td>
            <td style="padding:10px;text-align:right;font-weight:700;color:${empty?'#dc2626':'var(--text)'}">${(s.totalWeight||0).toFixed(2)} ${s.unit||'kg'}${s.reservedCount?`<div style="font-size:10px;color:#d97706;font-weight:500">+${(s.reservedWeight||0).toFixed(2)} resv</div>`:''}</td>
            <td style="padding:10px;text-align:right;font-weight:600">${s.rollsCount||0}${s.reservedCount?`<div style="font-size:10px;color:#d97706">+${s.reservedCount}</div>`:''}</td>
            <td style="padding:10px"><span style="font-size:11px;font-weight:600;color:${lvl.color}">${lvl.label}</span>${_fabStockBar(s)}</td>
            <td style="padding:10px;text-align:right"><button onclick="window.fabInvDrill('${s._id}')" style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Open</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`:''}
    </div>`;
  }
  return h||`<div class="empty" style="padding:24px;text-align:center">No fabric inventory rows match.</div>`;
}

// By Fabric view — flat table with vendor chips per row
function _renderFabByFabric(filtered,vMap){
  if(!filtered.length)return`<div class="empty" style="padding:24px;text-align:center">No fabric inventory rows match.</div>`;
  const fabVendors={};
  for(const[sup,v] of Object.entries(vMap)){
    for(const id of v.fabricIds){
      if(!fabVendors[id])fabVendors[id]=[];
      if(!fabVendors[id].includes(sup))fabVendors[id].push(sup);
    }
  }
  return`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff">
    <thead><tr style="background:#fafafa;border-bottom:1px solid var(--border)">
      <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Fabric</th>
      <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">GSM</th>
      <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Color</th>
      <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Vendor</th>
      <th style="padding:10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Stock</th>
      <th style="padding:10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Rolls</th>
      <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Status</th>
      <th></th>
    </tr></thead>
    <tbody>${filtered.map(s=>{
      const empty=!(s.totalWeight>0);const lvl=_fabAlertLevel(s);
      const vendors=fabVendors[s._id]||[];
      return`<tr style="border-bottom:1px solid #f5f5f5${empty?';opacity:.6':''}">
        <td style="padding:10px;font-weight:600"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${lvl.dot};margin-right:6px;vertical-align:middle"></span>${_gpEsc(s.fabType||'—')}</td>
        <td style="padding:10px">${s.gsm||'—'}</td>
        <td style="padding:10px">${_gpEsc(s.color||'—')}</td>
        <td style="padding:10px">${vendors.slice(0,2).map(v=>`<span style="display:inline-block;padding:2px 7px;background:#f3f4f6;border-radius:4px;margin:1px 2px 1px 0;white-space:nowrap;font-size:10px">${_gpEsc(v)}</span>`).join('')}${vendors.length>2?`<span style="font-size:11px;color:var(--muted)">+${vendors.length-2}</span>`:''}</td>
        <td style="padding:10px;text-align:right;font-weight:700;color:${empty?'#dc2626':'var(--text)'}">${(s.totalWeight||0).toFixed(2)} ${s.unit||'kg'}${s.reservedCount?`<div style="font-size:10px;color:#d97706;font-weight:500">+${(s.reservedWeight||0).toFixed(2)} resv</div>`:''}</td>
        <td style="padding:10px;text-align:right;font-weight:600">${s.rollsCount||0}${s.reservedCount?`<div style="font-size:10px;color:#d97706">+${s.reservedCount}</div>`:''}</td>
        <td style="padding:10px"><span style="font-size:11px;font-weight:600;color:${lvl.color}">${lvl.label}</span>${_fabStockBar(s)}</td>
        <td style="padding:10px;text-align:right"><button onclick="window.fabInvDrill('${s._id}')" style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Open</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function _renderFabInvDrill(key){
  const s=allFabricInventory.find(x=>x._id===key);
  if(!s){return`<div class="page-head"><div class="page-title">Not found</div></div><button class="btn-outline" onclick="window.fabInvDrill(null)">← Back</button>`;}
  const movements=allFabricMovements.filter(m=>_fabInvKey(m.fabType,m.gsm,m.color)===key).slice(0,80);
  const rolls=(s.rolls||[]).slice().sort((a,b)=>(a.status==='in_stock'?-1:1)-(b.status==='in_stock'?-1:1));
  const cfg=_fabAlertCfg(s),lvl=_fabAlertLevel(s);
  return`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><div class="page-title">${_gpEsc(s.fabType||'—')} · ${s.gsm||0}gsm · ${_gpEsc(s.color||'—')}</div>
      <div class="page-sub"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${lvl.dot};margin-right:5px"></span><span style="color:${lvl.color};font-weight:600">${lvl.label}</span> · ${(s.totalWeight||0).toFixed(2)} ${s.unit||'kg'} available · ${s.rollsCount||0} rolls${s.reservedCount?` · ${(s.reservedWeight||0).toFixed(2)} ${s.unit||'kg'} (${s.reservedCount}) reserved`:''} · ${rolls.length} total rolls ever received</div></div>
    <button class="btn-outline" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.fabInvDrill(null)">← Back to Fabric Inventory</button>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
    <button onclick="window.fabDrillJump('issue','${key}')" style="padding:7px 13px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--text);font-size:12px;cursor:pointer;font-family:inherit">Issue this fabric →</button>
    <button onclick="window.fabDrillJump('returns','${key}')" style="padding:7px 13px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--text);font-size:12px;cursor:pointer;font-family:inherit">Returns →</button>
    <button onclick="window.fabDrillJump('fabricin','${key}')" style="padding:7px 13px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--text);font-size:12px;cursor:pointer;font-family:inherit">Record arrival →</button>
    <button onclick="window.fabDrillJump('reports','${key}')" style="padding:7px 13px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--text);font-size:12px;cursor:pointer;font-family:inherit">Reports →</button>
  </div>
  <div class="card" style="margin-bottom:14px"><div class="card-title">Stock alerts <span style="font-weight:400;color:var(--muted);font-size:11px">3 levels (${s.unit||'kg'}) · weight at/below each level raises the flag</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>🟠 Low ≤</label><input id="fab-th1" type="number" min="0" step="0.1" value="${cfg.t1}" style="width:96px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-family:inherit"></div>
      <div class="field" style="margin:0"><label>🟧 Very low ≤</label><input id="fab-th2" type="number" min="0" step="0.1" value="${cfg.t2}" style="width:96px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-family:inherit"></div>
      <div class="field" style="margin:0"><label>🔴 Critical ≤</label><input id="fab-th3" type="number" min="0" step="0.1" value="${cfg.t3}" style="width:96px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-family:inherit"></div>
      <button class="btn-outline" style="width:auto;padding:8px 16px;margin:0" onclick="window.fabSaveAlerts('${key}')">Save levels</button>
    </div>
  </div>
  <div class="card" style="margin-bottom:14px"><div class="card-title">Rolls <span style="font-weight:400;color:var(--muted);font-size:11px">${rolls.length} total · scan barcode, reprint, history${_fabCanDelete()?', edit & delete':''} per roll</span></div>
    ${rolls.length?`<div style="display:flex;align-items:center;gap:10px;padding:0 2px 8px;border-bottom:1px solid #eee;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer"><input type="checkbox" id="fab-drill-chk-all" onclick="window.toggleAllDrillChk(this)" style="cursor:pointer;width:15px;height:15px">Select all</label>
      <button id="fab-drill-print-sel" onclick="window.printSelectedDrillBarcodes()" disabled style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit;opacity:.5">🖨 Print selected</button>
    </div>`:''}
    ${rolls.length?rolls.map(r=>{
      const st=r.status||'in_stock';
      const stColor=st==='in_stock'?'var(--green)':st==='issued'?'#dc2626':st==='reserved'?'#d97706':st==='returned_supplier'?'#9ca3af':st==='consumed'?'#92400e':'var(--muted)';
      const rcpt=allFabricIn.find(x=>x.id===r.sourceFabId);
      const supplier=rcpt?.supplier||'';
      const wt=`${r.weight||0} ${r.unit||s.unit||'kg'}`;
      const canAct=_fabCanDelete()&&st==='in_stock';
      return`<div style="padding:8px 2px;border-bottom:1px solid #f5f5f5;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <input type="checkbox" class="fab-drill-chk" data-rc="${_gpEsc(r.rollCode||'')}" data-weight="${_gpEsc(wt)}" data-supplier="${_gpEsc(supplier)}" data-gsm="${r.gsm||rcpt?.gsm||s.gsm||''}" data-color="${_gpEsc(r.color||rcpt?.color||s.color||'')}" data-fabtype="${_gpEsc(s.fabType||'')}" onclick="window.updateDrillPrintCount()" style="cursor:pointer;width:15px;height:15px;flex-shrink:0">
          <span style="font-weight:700;letter-spacing:.04em;min-width:120px">${_gpEsc(r.rollCode||'—')}${r.remnant?' <span style="font-size:9px;color:#d97706">remnant</span>':''}</span>
          <span style="flex:1;min-width:70px">${wt}${r.consumedWeight?` · used ${r.consumedWeight}`:''}</span>
          <span style="color:${stColor};font-weight:600;text-transform:capitalize;font-size:11px">${st.replace('_',' ')}</span>
          <button onclick="window.printRollBarcode('${_gpEsc(r.rollCode||'')}','${_gpEsc(s.fabType||'')}','${r.gsm||s.gsm||0}','${_gpEsc(s.color||'')}','${_gpEsc(wt)}','${_gpEsc(supplier)}')" style="padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:10px;cursor:pointer;font-family:inherit">🖨 Print</button>
          ${canAct?`<button onclick="window.editFabricRoll('${_gpEsc(r.sourceFabId||'')}','${_gpEsc(r.rollCode||'')}')" style="padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:10px;cursor:pointer;font-family:inherit">Edit</button>
          <button onclick="window.deleteFabricRoll('${_gpEsc(r.sourceFabId||'')}','${_gpEsc(r.rollCode||'')}')" title="Delete this roll" style="padding:3px 8px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:10px;cursor:pointer;font-family:inherit">✕</button>`:''}
        </div>
        <div style="font-size:11px;color:var(--muted)">${_fabRollDetail(r)}</div>
        <svg class="fab-drill-bc" data-rc="${_gpEsc(r.rollCode||'')}" style="display:block;height:34px"></svg>
      </div>`;
    }).join(''):'<div class="empty" style="padding:16px;text-align:center">No rolls yet.</div>'}
  </div>
  <div class="card"><div class="card-title">Movements (${movements.length})</div>
    ${movements.length?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">When</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Type</th><th style="padding:8px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Qty</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Rolls</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Source</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">By</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Note</th></tr></thead>
      <tbody>${movements.map(m=>{
        // Return-to-supplier rows are shown in PURPLE across the whole line.
        const isRet=m.subtype==='return_out';
        const tColor=isRet?'#7c3aed':m.type==='in'?'var(--green)':m.type==='out'?'#dc2626':m.type==='consume'?'#92400e':'var(--muted)';
        const noteCol=isRet?'#7c3aed':'var(--muted)';
        return`<tr style="border-bottom:1px solid #f5f5f5">
          <td style="padding:8px;color:${isRet?'#7c3aed':'inherit'}">${new Date(m.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
          <td style="padding:8px;color:${tColor};font-weight:700;text-transform:uppercase">${isRet?'↩ RETURN':m.type==='in'?'+ IN':m.type==='out'?'− OUT':m.type==='consume'?'− CONSUME':m.type==='return'?'+ RETURN':m.type}</td>
          <td style="padding:8px;text-align:right;font-weight:600;color:${isRet?'#7c3aed':'inherit'}">${(m.qty||0).toFixed(2)} ${m.unit||'kg'}</td>
          <td style="padding:8px;font-size:11px;letter-spacing:.04em;color:${isRet?'#7c3aed':'inherit'}">${(m.rollCodes||[]).slice(0,3).map(_gpEsc).join(', ')}${(m.rollCodes||[]).length>3?` +${m.rollCodes.length-3}`:''}</td>
          <td style="padding:8px;font-size:11px;color:${noteCol}">${_gpEsc(m.sourceCollection||'')}/${_gpEsc(m.sourceId||'')}</td>
          <td style="padding:8px;font-size:11px;color:${noteCol}">${_gpEsc(m.by||'')}</td>
          <td style="padding:8px;font-size:11px;color:${noteCol}">${_gpEsc(m.note||'')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`:'<div class="empty" style="padding:16px">No movements logged for this fabric yet.</div>'}
  </div>
  <div style="height:80px"></div>`;
}

// Stock handlers re-render into the tab content div so the sub-tabs persist.
window.fabInvSetFilter=function(f){_fabInvFilter=f;const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricInventory();};
window.fabInvSetCat=function(c){_fabInvCatFilter=c;const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricInventory();};
window.fabInvSetSearch=function(v){
  _fabInvSearchQ=v||'';
  clearTimeout(window._fabInvSearchTo);
  window._fabInvSearchTo=setTimeout(()=>{
    const m=document.getElementById('fab-tab-content');if(m){m.innerHTML=renderFabricInventory();const i=document.getElementById('finv-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}}
  },180);
};
window.fabInvDrill=function(key){_fabInvDrillKey=key;const m=document.getElementById('fab-tab-content');if(m){m.innerHTML=renderFabricInventory();if(key)_fabRenderDrillBarcodes();}};
window.fabInvSetView=function(v){_fabInvView=v;const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricInventory();};
window.fabInvToggleVendor=function(sup){if(_fabInvCollapsed.has(sup))_fabInvCollapsed.delete(sup);else _fabInvCollapsed.add(sup);const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricInventory();};

// Draw the scannable barcode into each roll's <svg> after the drill renders.
function _fabRenderDrillBarcodes(){
  document.querySelectorAll('svg.fab-drill-bc').forEach(svg=>{
    const rc=svg.getAttribute('data-rc')||'';
    if(rc&&!svg.childNodes.length)_renderRollBarcode(svg,rc);
  });
}

// Per-roll usage history line: where it came from and where it went, with
// PO / vendor / reason / timestamps — the "clear reason where it was used".
function _fabRollDetail(r){
  const d=ts=>ts?new Date(ts).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
  const st=r.status||'in_stock';
  const bits=[];
  if(r.sourceFabId)bits.push(`From ${_gpEsc(r.sourceFabId)}`);
  if(r.addedAt)bits.push(`received ${d(r.addedAt)}`);
  if(st==='reserved')bits.push(`Reserved for ${_gpEsc(r.reservedPO||'—')}${r.reservedAt?` · ${d(r.reservedAt)}`:''}`);
  if(st==='issued')bits.push(`Issued${r.issuedPO?` for PO ${_gpEsc(r.issuedPO)}`:''}${r.issuedTo?` to ${_gpEsc(r.issuedTo)}`:''}${r.issuedAt?` · ${d(r.issuedAt)}`:''}${r.issuedBy?` · by ${_gpEsc(r.issuedBy)}`:''}`);
  if(st==='returned_supplier'){const sup=_fabRollSupplier(r);bits.push(`Returned to ${sup?_gpEsc(sup):'supplier'}${r.returnReason?` — ${_gpEsc(r.returnReason)}`:''}${r.returnedToSupplierAt?` · ${d(r.returnedToSupplierAt)}`:''}`);}
  if(st==='in_stock'&&r.returnedAt)bits.push(`Returned to stock ${d(r.returnedAt)}`);
  if(r.remnant&&r.parentRollCode)bits.push(`Remnant of ${_gpEsc(r.parentRollCode)}`);
  return bits.join(' · ')||'In stock';
}

// Jump from the Stock drill into another fabric tab, pre-selecting this fabric
// where the tab supports it — the "linked to fabric in / issue / returns".
window.fabDrillJump=function(tab,key){
  if(tab==='issue')_fabIssuePreselectKey=key||'';   // applied when the Issue tab renders
  window.switchFabTab(tab);
};

// ── Stock-drill barcode multi-print (mirrors the Fabric In select-to-print) ──
window.toggleAllDrillChk=function(master){
  document.querySelectorAll('.fab-drill-chk').forEach(c=>{c.checked=master.checked;});
  window.updateDrillPrintCount();
};
window.updateDrillPrintCount=function(){
  const boxes=[...document.querySelectorAll('.fab-drill-chk')];
  const n=boxes.filter(c=>c.checked).length;
  const btn=document.getElementById('fab-drill-print-sel');
  if(btn){btn.textContent='🖨 Print selected'+(n?` (${n})`:'');btn.disabled=!n;btn.style.opacity=n?'1':'.5';}
  const master=document.getElementById('fab-drill-chk-all');
  if(master)master.checked=n>0&&n===boxes.length;
};
window.printSelectedDrillBarcodes=function(){
  const checked=[...document.querySelectorAll('.fab-drill-chk:checked')];
  if(!checked.length){showToast('Select at least one roll to print.',true);return;}
  _openRollLabelsPrint(checked.map(c=>({rollCode:c.getAttribute('data-rc'),weight:c.getAttribute('data-weight'),supplier:c.getAttribute('data-supplier'),gsm:c.getAttribute('data-gsm')||'',color:c.getAttribute('data-color')||'',fabType:c.getAttribute('data-fabtype')||''})));
};

// ════════════════════════════════════════════════════════════════════════
//  Fabric In (Phase 2) — receiving + barcoding, moved here from gatepass.js
//  New code scheme: COLOR + TYPE + GSM - LOT, rolls -Rnn
//  e.g. Black Terry 220gsm, 1st delivery, roll 3  →  BLKTRY220-01-R03
// ════════════════════════════════════════════════════════════════════════

// ── Fabric type → 3-letter code (override-friendly map) ──
const FABRIC_TYPE_MAP=[
  [/sublimation/i,'SUB'],
  [/jersey/i,'JRS'],
  [/terry/i,'TRY'],
  [/twill/i,'TWL'],
  [/burbury/i,'BRB'],
  [/drill/i,'DRL'],
  [/denim/i,'DEN'],
  [/fleece/i,'FLC'],
  [/pfgd/i,'PFG'],
  [/cora/i,'COR']
];
function _fabTypeCode(fabType){
  if(!fabType)return'FAB';
  for(const[re,p]of FABRIC_TYPE_MAP){if(re.test(fabType))return p;}
  return(fabType.replace(/[^a-z]/gi,'').slice(0,3).toUpperCase()||'FAB');
}
// ── Colour → 3-letter code (override-friendly map) ──
const FABRIC_COLOR_MAP=[
  [/^black$|jet ?black/i,'BLK'],[/^white$|off ?white|optic/i,'WHT'],[/grey|gray|silver/i,'GRY'],
  [/navy/i,'NVY'],[/royal/i,'ROY'],[/sky/i,'SKY'],[/blue/i,'BLU'],
  [/mocha|coffee|tan|camel/i,'MOC'],[/brown|choco/i,'BRN'],[/beige|cream|ivory|sand/i,'BEG'],
  [/red|crimson|scarlet/i,'RED'],[/maroon|wine|burgundy/i,'MRN'],[/pink|rose|fuchsia/i,'PNK'],
  [/orange/i,'ORG'],[/yellow|mustard|lemon/i,'YEL'],[/gold/i,'GLD'],
  [/green|olive|lime|mint|sage/i,'GRN'],[/teal|turquoise/i,'TEL'],[/purple|violet|lilac/i,'PRP']
];
function _fabColorCode(color){
  if(!color)return'XXX';
  const c=String(color).trim();
  for(const[re,p]of FABRIC_COLOR_MAP){if(re.test(c))return p;}
  return(c.replace(/[^a-z]/gi,'').slice(0,3).toUpperCase()||'XXX');
}
// Base code for a Color+Type+GSM combo, e.g. BLKTRY220
function _fabBaseCode(fabType,gsm,color){
  return `${_fabColorCode(color)}${_fabTypeCode(fabType)}${parseInt(gsm,10)||0}`;
}
// Next 2-digit lot for a base code (running per Color+Type+GSM combo)
function _nextFabLot(baseCode){
  const re=new RegExp('^'+baseCode+'-(\\d+)','i');
  let max=0;
  for(const f of allFabricIn){const m=(f.fabCode||'').match(re);if(m){const n=parseInt(m[1],10);if(n>max)max=n;}}
  return String(max+1).padStart(2,'0');
}
// Full fabric code for this receipt, e.g. BLKTRY220-01 (preview only).
function _nextFabCode(fabType,gsm,color){
  const base=_fabBaseCode(fabType,gsm,color);
  return `${base}-${_nextFabLot(base)}`;
}
// Atomic lot allocation at save time — a transaction on counters/main keyed by
// the base code, seeded from the highest lot already loaded. Guarantees two
// receipts of the same fabric (even simultaneous) get distinct lots, so roll
// codes can never collide. Returns a zero-padded lot string.
async function _allocFabLot(baseCode){
  const field='fablot_'+baseCode.toLowerCase();
  const ref=doc(db,'counters','main');
  const esc=baseCode.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp('^'+esc+'-(\\d+)','i');
  let localMax=0;
  for(const f of allFabricIn){const m=(f.fabCode||'').match(re);if(m){const n=parseInt(m[1],10);if(n>localMax)localMax=n;}}
  let lot=localMax+1;
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const stored=snap.exists()?(snap.data()[field]||0):0;
    lot=Math.max(stored,localMax)+1;
    if(snap.exists())tx.update(ref,{[field]:lot});else tx.set(ref,{[field]:lot});
  });
  return String(lot).padStart(2,'0');
}
function _fabUnitForSupplier(supplier){
  return(supplier||'').toLowerCase().includes('daniyal twill')?'m':'kg';
}

function renderFabricInTab(){
  const today=new Date().toISOString().split('T')[0];
  const fabTypes=['100% Poly Sublimation Jersey','Jersey Heavy','Terry Stock','Terry Fresh','Twill','Burbury 100% Cotton','Drill','Denim','Fleece','100% Cotton Cora Jersey','100% Cotton Terry Cora','PFGD Rigid','PFGD Lycra'];
  const suppliers=['Gul Enterprises','JR Trader','Akhlaq Sublimation','Khursheed Enterprise','Daniyal Twill'];
  return`<div class="card"><div class="card-title">Record fabric arrival</div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Supplier *</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
          ${suppliers.map(s=>`<button type="button" class="dest-chip" onclick="window.setFabSupplier('${s}')">${s}</button>`).join('')}
        </div>
        <input id="fab-supplier" placeholder="Or type supplier name…" oninput="window.updateFabUnit()">
      </div>
      <div class="field"><label>Date</label><input id="fab-date" type="date" value="${today}"></div>
      <div class="field"><label>Fabric Type *</label>
        <select id="fab-type" onchange="window.refreshFabCode()"><option value="">Select type…</option>${fabTypes.map(t=>`<option value="${t}">${t}</option>`).join('')}</select>
      </div>
      <div class="field"><label>GSM *</label><input id="fab-gsm" type="number" min="0" placeholder="e.g. 220" onchange="window.refreshFabCode()"></div>
      <div class="field"><label>Fabric Color *</label><input id="fab-color" placeholder="e.g. Black, White, Royal Blue" onchange="window.refreshFabCode()"></div>
      <div class="field"><label>Received By</label><input value="${session.name}" readonly style="background:#f0f0f0;cursor:default"></div>
      <div class="field"><label>Auto fabric code</label>
        <input id="fab-code" readonly placeholder="Pick type + GSM + color to generate" style="background:#eef2ff;color:#1e3a8a;font-weight:700;letter-spacing:.04em">
        <div style="font-size:10px;color:var(--muted);margin-top:3px">COLOR+TYPE+GSM-LOT. Each roll tagged <span id="fab-code-roll-hint">CODE-R01</span>, <span id="fab-code-roll-hint-2">CODE-R02</span>…</div>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Notes</label><textarea id="fab-notes" rows="2" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#FAFAFA;color:var(--text);font-family:inherit;outline:none;width:100%;resize:vertical" placeholder="Optional notes"></textarea></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Fabric rolls <span id="fab-unit-label" style="font-weight:400;color:var(--muted);font-size:11px">(kg)</span></div>
    <div id="fab-rolls-body"></div>
    <button onclick="window.addFabRoll()" style="width:100%;padding:9px;background:none;border:none;font-size:12px;color:var(--muted);cursor:pointer;border-top:1px solid var(--border);font-family:inherit;margin-top:4px">+ Add roll</button>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding:10px 14px;background:var(--dark);border-radius:8px">
      <span style="font-size:11px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.06em">Total weight</span>
      <span id="fab-total-weight" style="font-size:18px;font-weight:700;color:#fff">0.00 kg</span>
    </div>
  </div>
  <button class="btn-primary" onclick="window.submitFabricIn()">Save Fabric Entry</button>
  <div class="card" style="margin-top:12px"><div class="card-title">Fabric arrivals</div>
    <div id="fab-list-body"></div>
  </div>
  <div style="height:80px"></div>`;
}

window.setFabSupplier=function(v){
  document.getElementById('fab-supplier').value=v;
  window.updateFabUnit();
};

window.updateFabUnit=function(){
  const supplier=(document.getElementById('fab-supplier')?.value||'').trim();
  const isDaniyal=supplier.toLowerCase().includes('daniyal twill');
  const unit=isDaniyal?'m':'kg';
  const lbl=document.getElementById('fab-unit-label');
  if(lbl)lbl.textContent=isDaniyal?'(meters)':'(kg)';
  document.querySelectorAll('.fab-roll-unit').forEach(el=>el.textContent=unit);
  window.fabRecalc();
};

window.refreshFabCode=function(){
  const fabType=document.getElementById('fab-type')?.value||'';
  const gsm=document.getElementById('fab-gsm')?.value||'';
  const color=document.getElementById('fab-color')?.value||'';
  const codeEl=document.getElementById('fab-code');
  if(!codeEl)return;
  if(!fabType||!gsm||!color){codeEl.value='';
    const h1=document.getElementById('fab-code-roll-hint');if(h1)h1.textContent='CODE-R01';
    const h2=document.getElementById('fab-code-roll-hint-2');if(h2)h2.textContent='CODE-R02';
    return;
  }
  const code=_nextFabCode(fabType,gsm,color);
  codeEl.value=code;
  const h1=document.getElementById('fab-code-roll-hint');if(h1)h1.textContent=code+'-R01';
  const h2=document.getElementById('fab-code-roll-hint-2');if(h2)h2.textContent=code+'-R02';
  // Re-label any existing roll rows and re-render their barcodes
  let i=0;
  document.querySelectorAll('#fab-rolls-body .roll-row').forEach(row=>{
    i++;
    const rollCode=`${code}-R${String(i).padStart(2,'0')}`;
    const lbl=row.querySelector('.fab-roll-code');
    if(lbl)lbl.textContent=rollCode;
    // Backfill empty per-roll GSM from the form GSM (rolls added before GSM was set).
    const gsmInp=row.querySelector('.fab-roll-gsm');
    if(gsmInp&&!gsmInp.value)gsmInp.value=parseInt(gsm)||'';
    const qcCb=row.querySelector('input[type=checkbox]');
    if(qcCb)qcCb.setAttribute('onchange',`window.onFabRollQC(this,'${rollCode}')`);
    const bc=row.querySelector('.fab-roll-barcode');
    if(bc)_renderRollBarcode(bc,rollCode);
  });
};

window.addFabRoll=function(){
  fabRollIdx++;
  const fabCode=document.getElementById('fab-code')?.value||'';
  const i=document.querySelectorAll('#fab-rolls-body .roll-row').length+1;
  const rollCode=fabCode?`${fabCode}-R${String(i).padStart(2,'0')}`:`R-${String(fabRollIdx).padStart(3,'0')}`;
  const supplier=(document.getElementById('fab-supplier')?.value||'').trim();
  const unit=_fabUnitForSupplier(supplier);
  const defaultGsm=parseInt(document.getElementById('fab-gsm')?.value)||'';
  const id='fabroll-'+fabRollIdx;
  const body=document.getElementById('fab-rolls-body');
  if(!body)return;
  const div=document.createElement('div');
  div.id=id;div.className='roll-row';
  div.style.flexDirection='column';div.style.alignItems='stretch';
  div.innerHTML=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="fab-roll-code" style="font-size:11px;font-weight:700;color:var(--dark);min-width:108px;letter-spacing:.04em">${rollCode}</span>
      <input type="number" class="fab-roll-weight" min="0" step="0.01" placeholder="0" style="width:88px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:#fff;outline:none;font-family:inherit" oninput="window.fabRecalc()">
      <span class="fab-roll-unit" style="font-size:12px;color:var(--muted);min-width:24px">${unit}</span>
      <input type="number" class="fab-roll-gsm" min="0" step="1" placeholder="GSM" value="${defaultGsm}" title="GSM for this roll" style="width:72px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:#fff;outline:none;font-family:inherit">
      <span style="font-size:11px;color:var(--muted)">gsm</span>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;flex-shrink:0;white-space:nowrap">
        <input type="checkbox" onchange="window.onFabRollQC(this,'${rollCode}')"> QC ✓
      </label>
      <button onclick="document.getElementById('${id}').remove();window.fabRecalc()" style="background:none;border:none;color:#ccc;font-size:16px;cursor:pointer;padding:2px 6px;flex-shrink:0">×</button>
    </div>
    <svg class="fab-roll-barcode" style="display:block;height:36px;margin:4px 0 0 108px"></svg>`;
  body.appendChild(div);
  _renderRollBarcode(div.querySelector('.fab-roll-barcode'),rollCode);
  window.fabRecalc();
};

function _renderRollBarcode(svgEl,value){
  if(!svgEl||!value)return;
  try{
    if(typeof JsBarcode==='function'){
      JsBarcode(svgEl,value,{format:'CODE128',displayValue:true,fontSize:10,height:28,margin:0,width:1.4});
    }else{
      svgEl.outerHTML=`<span style="font-size:10px;color:var(--muted);margin-left:108px">${value}</span>`;
    }
  }catch(e){
    svgEl.outerHTML=`<span style="font-size:10px;color:#dc2626;margin-left:108px">Barcode error: ${e.message}</span>`;
  }
}

window.fabRecalc=function(){
  let total=0;
  document.querySelectorAll('#fab-rolls-body .roll-row').forEach(row=>{
    const inp=row.querySelector('input[type=number]');
    total+=parseFloat(inp?.value)||0;
  });
  const supplier=(document.getElementById('fab-supplier')?.value||'').trim();
  const isDaniyal=supplier.toLowerCase().includes('daniyal twill');
  const unit=isDaniyal?'m':'kg';
  const el=document.getElementById('fab-total-weight');
  if(el)el.textContent=total.toFixed(2)+' '+unit;
};

window.onFabRollQC=function(checkbox){
  const row=checkbox.closest('.roll-row');
  if(row)row.style.background=checkbox.checked?'#f0fdf4':'';
};

window.submitFabricIn=async function(){
  const supplier=(document.getElementById('fab-supplier')?.value||'').trim();
  const date=document.getElementById('fab-date')?.value||'';
  const fabType=document.getElementById('fab-type')?.value||'';
  const gsm=parseInt(document.getElementById('fab-gsm')?.value)||0;
  const color=(document.getElementById('fab-color')?.value||'').trim();
  const notes=(document.getElementById('fab-notes')?.value||'').trim();
  if(!supplier||!fabType||!gsm||!color){showToast('Supplier, fabric type, GSM and color are required.',true);return;}
  const unit=_fabUnitForSupplier(supplier);
  // Collect rows first (weight/gsm/qc). Roll CODES are assigned AFTER the atomic
  // lot is reserved, so they always match the final fabCode and never collide.
  const rows=[...document.querySelectorAll('#fab-rolls-body .roll-row')].map(row=>({
    weight:parseFloat(row.querySelector('.fab-roll-weight')?.value)||0,
    gsm:parseInt(row.querySelector('.fab-roll-gsm')?.value)||gsm,
    qcPassed:row.querySelector('input[type=checkbox]')?.checked||false
  }));
  if(!rows.length){showToast('Add at least one roll.',true);return;}
  if(rows.some(r=>!r.weight)){showToast('Every roll needs a weight.',true);return;}
  if(rows.some(r=>!r.gsm)){showToast('Every roll needs a GSM.',true);return;}
  if(!_fabBusyStart('Saving fabric entry…'))return;
  try{
    const baseCode=_fabBaseCode(fabType,gsm,color);
    let lot=await _allocFabLot(baseCode);                // atomic + unique
    let fabCode=`${baseCode}-${lot}`;
    // Defensive: guarantee the code is unused even against loaded data.
    let guard=0;
    while(allFabricIn.some(f=>f.fabCode===fabCode)&&guard++<5){lot=await _allocFabLot(baseCode);fabCode=`${baseCode}-${lot}`;}
    const rolls=rows.map((r,i)=>{
      const rollCode=`${fabCode}-R${String(i+1).padStart(2,'0')}`;
      return{rollCode,rollNumber:rollCode,weight:r.weight,gsm:r.gsm,unit,qcPassed:r.qcPassed,qcBy:r.qcPassed?session.name:'',qcAt:r.qcPassed?Date.now():null};
    });
    const totalWeight=parseFloat(rolls.reduce((s,r)=>s+r.weight,0).toFixed(2));
    const next=await getNextId('fabricin');
    const fabId='FAB-'+String(next).padStart(3,'0');
    const payload={id:fabId,fabCode,ts:Date.now(),supplier,date,fabType,gsm,color,receivedBy:session.name,notes,unit,totalWeight,rollsCount:rolls.length,rolls};
    // Receipt doc + inventory + movement commit in ONE transaction.
    await _fabInvUpsert({fabType,gsm,color,unit,addRolls:rolls.map(r=>({rollCode:r.rollCode,weight:r.weight,gsm:r.gsm,unit:r.unit,sourceFabId:fabId})),sourceCol:'fabricin',sourceId:fabId,note:`Receipt from ${supplier}`,extraWrites:[{ref:doc(db,'fabricin',fabId),data:payload}]});
    allFabricIn.unshift(payload);
    await logActivity('Fabric In',`${fabId} (${fabCode}) — ${supplier} · ${fabType} ${gsm}gsm · ${color} · ${rolls.length} rolls · ${totalWeight} ${unit}`);
    showToast(`${fabCode} saved ✓ · added to inventory`);
    window.switchFabTab('fabricin');
  }catch(e){showToast('Error: '+e.message,true);}
  finally{_fabBusyEnd();}
};

function renderFabricInList(){
  const body=document.getElementById('fab-list-body');
  if(!body)return;
  if(!allFabricIn.length){body.innerHTML='<div class="empty">No fabric entries yet.</div>';return;}
  const _PG=10;
  const totalPages=Math.ceil(allFabricIn.length/_PG);
  if(_fabInListPage>=totalPages)_fabInListPage=totalPages-1;
  const page=allFabricIn.slice(_fabInListPage*_PG,(_fabInListPage+1)*_PG);
  body.innerHTML=page.map(f=>{
    const rolls=f.rolls||[];
    const qcDone=rolls.filter(r=>r.qcPassed).length;
    const total=rolls.length;
    const allQC=total>0&&qcDone===total;
    const pend=_gpPendingFor('fabric',f.id);
    const pendBadge=pend?`<span title="${pend.action==='delete'?'Delete':'Edit'} pending approval" style="display:inline-block;background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px">${pend.action==='delete'?'Delete':'Edit'} pending</span>`:'';
    return`<div>
      <div class="fab-entry-header" onclick="window.toggleFabEntry('${f.id}')">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-weight:700;color:var(--red);font-size:11px">${f.id}</span>
            ${f.fabCode?`<span style="font-weight:700;color:#1e3a8a;font-size:11px;background:#eef2ff;padding:1px 6px;border-radius:4px;letter-spacing:.04em">${f.fabCode}</span>`:''}
            <span style="font-size:11px;color:var(--muted)">${f.date||''}</span>
            ${pendBadge}
          </div>
          <div style="font-size:13px;font-weight:500;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.supplier} · ${f.fabType||'—'}${f.gsm?` · ${f.gsm}gsm`:''}</div>
          <div style="font-size:11px;color:var(--muted)">${f.color||'—'} · ${f.totalWeight||0} ${f.unit||'kg'} · ${total} rolls · <span style="color:${allQC?'var(--green)':'var(--amber)'};font-weight:600">${qcDone}/${total} QC ✓</span></div>
        </div>
        <span id="fab-chev-${f.id}" style="color:var(--muted);font-size:18px;margin-left:8px;flex-shrink:0">›</span>
      </div>
      <div id="fab-rolls-${f.id}" style="display:none;padding:4px 0 8px">
        ${total?`<div style="display:flex;align-items:center;gap:10px;padding:4px 4px 8px;border-bottom:1px solid #eee;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer"><input type="checkbox" id="fab-chk-all-${f.id}" onclick="event.stopPropagation();window.toggleAllRollChk('${f.id}',this)" style="cursor:pointer;width:15px;height:15px">Select all</label>
          <button id="fab-print-sel-${f.id}" onclick="event.stopPropagation();window.printSelectedRollBarcodes('${f.id}')" disabled style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit;opacity:.5">🖨 Print selected</button>
        </div>`:''}
        ${rolls.map(r=>{
          const rc=r.rollCode||r.rollNumber||'';
          const rGsm=r.gsm||f.gsm||0;
          const wt=`${r.weight} ${r.unit||'kg'}`;
          // Live status pulled from the Stock inventory so Fabric In stays 100%
          // in sync with the Stock tab (issued / reserved / returned / in stock).
          const live=_fabFindRoll(rc);
          const liveSt=live?(live.roll.status||'in_stock'):'in_stock';
          const stCol=liveSt==='in_stock'?'var(--green)':liveSt==='issued'?'#dc2626':liveSt==='reserved'?'#d97706':liveSt==='returned_supplier'?'#9ca3af':'var(--muted)';
          return`<div style="display:flex;flex-direction:column;padding:8px 4px;border-bottom:1px solid #f9f9f9;font-size:12px;gap:6px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap">
              <input type="checkbox" class="fab-roll-chk" data-rc="${_gpEsc(rc)}" data-weight="${_gpEsc(wt)}" data-supplier="${_gpEsc(f.supplier||'')}" data-gsm="${rGsm}" data-color="${_gpEsc(f.color||'')}" data-fabtype="${_gpEsc(f.fabType||'')}" onclick="event.stopPropagation();window.updateRollPrintCount('${f.id}')" style="cursor:pointer;width:15px;height:15px;flex-shrink:0">
              <span style="font-weight:600;min-width:120px;letter-spacing:.04em">${rc}</span>
              <span style="flex:1;min-width:80px">${wt} · ${rGsm}gsm</span>
              <span style="color:${stCol};font-weight:600;text-transform:capitalize;font-size:11px">${liveSt.replace('_',' ')}</span>
              <span style="${r.qcPassed?'color:var(--green);font-weight:600':'color:var(--muted)'}">${r.qcPassed?'QC ✓':'Pending QC'}</span>
              ${r.qcPassed&&r.qcBy?`<span style="font-size:10px;color:var(--muted)">${r.qcBy}</span>`:''}
              <button onclick="event.stopPropagation();window.printRollBarcode('${_gpEsc(rc)}','${_gpEsc(f.fabType||'')}','${rGsm}','${_gpEsc(f.color||'')}','${_gpEsc(wt)}','${_gpEsc(f.supplier||'')}')" style="padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:10px;cursor:pointer;font-family:inherit">🖨 Print</button>
              ${_fabCanDelete()&&liveSt==='in_stock'?`<button onclick="event.stopPropagation();window.editFabricRoll('${f.id}','${_gpEsc(rc)}')" title="Edit this roll (owners only)" style="padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:10px;cursor:pointer;font-family:inherit">Edit</button>
              <button onclick="event.stopPropagation();window.deleteFabricRoll('${f.id}','${_gpEsc(rc)}')" title="Delete just this roll (owners only)" style="padding:3px 8px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:10px;cursor:pointer;font-family:inherit">✕ Roll</button>`:''}
            </div>
            <svg class="fab-roll-barcode-view" data-rc="${_gpEsc(rc)}" style="display:block;height:38px;margin-left:0"></svg>
          </div>`;
        }).join('')||'<div style="font-size:12px;color:var(--muted);padding:6px">No rolls recorded.</div>'}
        <div style="display:flex;gap:6px;justify-content:flex-end;padding:8px 4px 0">
          <button onclick="event.stopPropagation();window.editFabricIn('${f.id}')" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Edit</button>
          <button onclick="event.stopPropagation();window.requestDeleteFabricIn('${f.id}')" title="Delete the whole receipt (all rolls)" style="padding:4px 10px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:11px;cursor:pointer;font-family:inherit">Delete entry</button>
        </div>
      </div>
    </div>`;
  }).join('');
  if(totalPages>1){
    const p=_fabInListPage;
    body.innerHTML+=`<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 0 4px;border-top:1px solid var(--border);margin-top:4px">
      <button onclick="window.fabInListGoPage(${p-1})" ${p===0?'disabled':''}
        style="padding:5px 14px;border:1px solid var(--border);border-radius:7px;background:${p===0?'#f9fafb':'#fff'};color:${p===0?'var(--muted)':'var(--text)'};font-size:12px;cursor:${p===0?'default':'pointer'};font-family:inherit">← Prev</button>
      <span style="font-size:12px;color:var(--muted)">Page <strong style="color:var(--text)">${p+1}</strong> of ${totalPages} · ${allFabricIn.length} entries</span>
      <button onclick="window.fabInListGoPage(${p+1})" ${p===totalPages-1?'disabled':''}
        style="padding:5px 14px;border:1px solid var(--border);border-radius:7px;background:${p===totalPages-1?'#f9fafb':'#fff'};color:${p===totalPages-1?'var(--muted)':'var(--text)'};font-size:12px;cursor:${p===totalPages-1?'default':'pointer'};font-family:inherit">Next →</button>
    </div>`;
  }
}

window.fabInListGoPage=function(n){
  _fabInListPage=n;
  renderFabricInList();
  const card=document.querySelector('#fab-list-body');
  if(card)card.scrollIntoView({behavior:'smooth',block:'start'});
};

window.toggleFabEntry=function(id){
  const rolls=document.getElementById('fab-rolls-'+id);
  const chev=document.getElementById('fab-chev-'+id);
  if(!rolls)return;
  const isOpen=rolls.style.display!=='none';
  rolls.style.display=isOpen?'none':'block';
  if(chev)chev.textContent=isOpen?'›':'⌄';
  if(!isOpen){
    rolls.querySelectorAll('svg.fab-roll-barcode-view').forEach(svg=>{
      const rc=svg.getAttribute('data-rc')||'';
      if(rc&&!svg.childNodes.length)_renderRollBarcode(svg,rc);
    });
  }
};

// 48×25mm roll label(s) on 2-across stock. The physical row holds two 48mm
// labels with a 2mm gutter → a 98mm-wide row. Multi-select pairs labels two
// per row (left, right, then the next row down); an odd count leaves the last
// right cell blank. A single label keeps the proven 48mm-wide page so the
// per-roll Print button is byte-for-byte unchanged. Accepts an array of
// {rollCode, weight, supplier}.
function _openRollLabelsPrint(labels){
  labels=(labels||[]).filter(l=>l&&l.rollCode);
  if(!labels.length){showToast('Nothing to print.',true);return;}
  const w=window.open('','_blank','width=820,height=540');
  if(!w){showToast('Allow popups to print barcodes.',true);return;}
  // Persisted settings — key namespace bumped to groovy_rl4_* so the larger
  // 100×48mm fabric-roll label defaults take effect (old rl_* values ignored).
  const defW   =parseFloat(localStorage.getItem('groovy_rl4_w')   ||'100');   // 10 cm wide
  const defH   =parseFloat(localStorage.getItem('groovy_rl4_h')   ||'48');    // 4.8 cm tall
  const defCols=parseInt  (localStorage.getItem('groovy_rl4_cols')||'1');     // 1 per row
  const defGap =parseFloat(localStorage.getItem('groovy_rl4_gap') ||'0');
  // Die-cut label printers position each label by their own gap sensor, so the
  // page height should equal the LABEL height (48mm). Default V-gap 0. Raise it
  // only for continuous (non-die-cut) roll stock where CSS must draw the gap.
  const defVgap=parseFloat(localStorage.getItem('groovy_rl4_vgap')||'0');
  const defPad =parseFloat(localStorage.getItem('groovy_rl4_pad') ||'3');
  const defRgap=parseFloat(localStorage.getItem('groovy_rl4_rgap')||'1');
  const defBcH =parseInt  (localStorage.getItem('groovy_rl4_bch') ||'80');
  const defBcW =parseFloat(localStorage.getItem('groovy_rl4_bcw') ||'2.2');
  const pageW  =defCols*defW+(defCols-1)*defGap;
  const defPitch=defH+defVgap;   // page height per label = label + inter-label gap
  const title  =labels.length===1?labels[0].rollCode:`${labels.length} labels`;
  // Embed label data safely as JSON for live rebuild
  const labelsJson=JSON.stringify(labels.map(l=>({
    rollCode:l.rollCode||'',supplier:l.supplier||'',fabType:l.fabType||'',
    gsm:l.gsm||'',color:l.color||'',weight:l.weight||''
  }))).replace(/<\/script>/gi,'<\\/script>');
  w.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#000}
      .hdr{display:flex;align-items:baseline;justify-content:space-between;gap:4px;border-bottom:1.6px solid #000;padding-bottom:1mm;flex-shrink:0}
      .brand{font-size:15pt;font-weight:800;letter-spacing:.5px;line-height:1}
      .htype{font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:1.5px}
      .hsup{font-size:9.5pt;font-weight:700;max-width:46mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
      .info{display:flex;flex-direction:column;gap:.8mm;flex-shrink:0}
      .irow{display:flex;gap:5mm;align-items:flex-end;width:100%}
      .cell{min-width:0;overflow:hidden}
      .k{font-size:6.5pt;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.5px;line-height:1.1}
      .v{font-size:11pt;font-weight:800;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .v.big{font-size:13pt}
      svg.bc{display:block;width:100%;flex:1;min-height:0}
      .rc{font-size:12pt;font-weight:700;letter-spacing:1.5px;text-align:center;line-height:1;flex-shrink:0}
      .row{display:flex;page-break-after:always;break-after:page}
      .row:last-child{page-break-after:auto;break-after:auto}
      .pc{padding:9px 12px;background:#f5f5f5;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .grp{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .gt{font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;margin-right:1px}
      .pc label{display:flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap}
      .pc input[type=number]{width:46px;padding:3px 4px;border:1px solid #bbb;border-radius:5px;font-size:11px;font-family:inherit;text-align:center}
      .pc input[type=range]{width:66px;cursor:pointer}
      .sep{width:1px;height:26px;background:#ccc;flex-shrink:0}
      .btn{padding:6px 13px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:600}
      @media print{.pc{display:none}}
    </style>
    <style id="dp">
      @page{size:${pageW}mm ${defPitch}mm;margin:0}
      html,body{width:${pageW}mm}
      .row{width:${pageW}mm;height:${defPitch}mm}
      .label{width:${defW}mm;height:${defH}mm;padding:${defPad}mm ${defPad*1.5}mm;display:flex;flex-direction:column;gap:${defRgap}mm;overflow:hidden}
      .label+.label{margin-left:${defGap}mm}
    </style>
    </head><body>
    <div class="pc">
      <div class="grp">
        <span class="gt">Label</span>
        <label>W <input type="number" id="lw" value="${defW}" min="20" max="200" step="0.5"> mm</label>
        <label>H <input type="number" id="lh" value="${defH}" min="15" max="150" step="0.5"> mm</label>
      </div>
      <div class="sep"></div>
      <div class="grp">
        <span class="gt">Layout</span>
        <label>Cols <input type="number" id="lcols" value="${defCols}" min="1" max="8" step="1"></label>
        <label>Gap <input type="number" id="lgap" value="${defGap}" min="0" max="20" step="0.5"> mm</label>
        <label>V-gap <input type="number" id="lvgap" value="${defVgap}" min="0" max="20" step="0.1"> mm</label>
        <label>Pad <input type="number" id="lpad" value="${defPad}" min="0" max="12" step="0.1"> mm</label>
        <label>Row-gap <input type="number" id="lrgap" value="${defRgap}" min="0" max="8" step="0.1"> mm</label>
      </div>
      <div class="sep"></div>
      <div class="grp">
        <span class="gt">Barcode</span>
        <label>H <b id="hv">${defBcH}</b>px
          <input type="range" id="bc-h" min="20" max="160" value="${defBcH}" step="1" oninput="document.getElementById('hv').textContent=this.value;_rbc()">
        </label>
        <label>Bar <b id="wv">${defBcW.toFixed(1)}</b>
          <input type="range" id="bc-w" min="0.8" max="4" value="${defBcW}" step="0.1" oninput="document.getElementById('wv').textContent=parseFloat(this.value).toFixed(1);_rbc()">
        </label>
      </div>
      <div class="sep"></div>
      <button class="btn" style="background:#333;color:#fff" onclick="_applyAll()">Apply ↺</button>
      <button class="btn" style="background:#000;color:#fff" onclick="window.print()">🖨 Print</button>
    </div>
    <div id="labels-out"></div>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
    <script>
      var _D=${labelsJson};
      function _rbc(){
        var h=parseInt(document.getElementById('bc-h').value)||26;
        var bw=parseFloat(document.getElementById('bc-w').value)||1;
        document.querySelectorAll('svg.bc').forEach(function(el){
          try{while(el.firstChild)el.removeChild(el.firstChild);
            JsBarcode(el,el.getAttribute('data-val'),{format:'CODE128',displayValue:false,height:h,margin:0,width:bw});
          }catch(e){}
        });
      }
      function _cell(k,v,big){
        var c=document.createElement('div');c.className='cell';
        var kk=document.createElement('div');kk.className='k';kk.textContent=k;
        var vv=document.createElement('div');vv.className='v'+(big?' big':'');vv.textContent=v||'—';
        c.appendChild(kk);c.appendChild(vv);return c;
      }
      function _buildRows(cols){
        var out=document.getElementById('labels-out');
        out.innerHTML='';
        for(var i=0;i<_D.length;i+=cols){
          var row=document.createElement('div');row.className='row';
          _D.slice(i,i+cols).forEach(function(l){
            var d=document.createElement('div');d.className='label';
            // Header: brand + type badge + supplier
            var hdr=document.createElement('div');hdr.className='hdr';
            var brand=document.createElement('span');brand.className='brand';brand.textContent='GROOVY';
            var htype=document.createElement('span');htype.className='htype';htype.textContent='FABRIC ROLL';
            var hsup=document.createElement('span');hsup.className='hsup';hsup.textContent=l.supplier||'';
            hdr.appendChild(brand);hdr.appendChild(htype);hdr.appendChild(hsup);
            // Info: Fabric on its own full-width row (can be long), then
            // GSM / Color / Weight sharing the second row — nothing truncates.
            var info=document.createElement('div');info.className='info';
            var r1=document.createElement('div');r1.className='irow';
            var f=_cell('Fabric',l.fabType||'');f.style.flex='1';
            r1.appendChild(f);
            var r2=document.createElement('div');r2.className='irow';
            var g=_cell('GSM',l.gsm?String(l.gsm):'');g.style.flex='0.7';
            var c=_cell('Color',l.color||'');c.style.flex='1.4';
            var w=_cell('Weight',l.weight||'',true);w.style.flex='1';w.style.textAlign='right';
            r2.appendChild(g);r2.appendChild(c);r2.appendChild(w);
            info.appendChild(r1);info.appendChild(r2);
            // Barcode fills remaining height
            var bc=document.createElementNS('http://www.w3.org/2000/svg','svg');bc.setAttribute('class','bc');bc.setAttribute('data-val',l.rollCode||'');
            // Roll code text under the barcode
            var rc=document.createElement('div');rc.className='rc';rc.textContent=l.rollCode||'';
            d.appendChild(hdr);d.appendChild(info);d.appendChild(bc);d.appendChild(rc);
            row.appendChild(d);
          });
          out.appendChild(row);
        }
      }
      function _applyAll(){
        var lw  =parseFloat(document.getElementById('lw').value)   ||100;
        var lh  =parseFloat(document.getElementById('lh').value)   ||48;
        var cols=Math.max(1,parseInt(document.getElementById('lcols').value)||1);
        var gap =parseFloat(document.getElementById('lgap').value) ||0;
        var vgap=parseFloat(document.getElementById('lvgap').value)||0;
        var pad =parseFloat(document.getElementById('lpad').value) ||3;
        var rgap=parseFloat(document.getElementById('lrgap').value)||1;
        var pw  =cols*lw+(cols-1)*gap;
        var pitch=lh+vgap;
        document.getElementById('dp').textContent=
          '@page{size:'+pw+'mm '+pitch+'mm;margin:0}'+
          'html,body{width:'+pw+'mm}'+
          '.row{width:'+pw+'mm;height:'+pitch+'mm}'+
          '.label{width:'+lw+'mm;height:'+lh+'mm;padding:'+pad+'mm '+(pad*1.5)+'mm;display:flex;flex-direction:column;gap:'+rgap+'mm;overflow:hidden}'+
          '.label+.label{margin-left:'+gap+'mm}';
        document.documentElement.style.width=pw+'mm';
        document.body.style.width=pw+'mm';
        _buildRows(cols);
        _rbc();
        try{
          localStorage.setItem('groovy_rl4_w',lw);
          localStorage.setItem('groovy_rl4_h',lh);
          localStorage.setItem('groovy_rl4_cols',cols);
          localStorage.setItem('groovy_rl4_gap',gap);
          localStorage.setItem('groovy_rl4_vgap',vgap);
          localStorage.setItem('groovy_rl4_pad',pad);
          localStorage.setItem('groovy_rl4_rgap',rgap);
          localStorage.setItem('groovy_rl4_bch',document.getElementById('bc-h').value);
          localStorage.setItem('groovy_rl4_bcw',document.getElementById('bc-w').value);
        }catch(e){}
      }
      window.addEventListener('load',function(){_buildRows(${defCols});_rbc();});
    <\/script>
    </body></html>`);
  w.document.close();
}

window.printRollBarcode=function(rollCode,fabType,gsm,color,weight,supplier){
  _openRollLabelsPrint([{rollCode,weight,supplier,gsm,color,fabType}]);
};

// Print every checked roll in one entry's expanded list as a single job.
window.printSelectedRollBarcodes=function(fabId){
  const cont=document.getElementById('fab-rolls-'+fabId);
  if(!cont)return;
  const checked=[...cont.querySelectorAll('.fab-roll-chk:checked')];
  if(!checked.length){showToast('Select at least one roll to print.',true);return;}
  _openRollLabelsPrint(checked.map(c=>({
    rollCode:c.getAttribute('data-rc'),
    weight:c.getAttribute('data-weight'),
    supplier:c.getAttribute('data-supplier'),
    gsm:c.getAttribute('data-gsm')||'',
    color:c.getAttribute('data-color')||'',
    fabType:c.getAttribute('data-fabtype')||''
  })));
};

window.toggleAllRollChk=function(fabId,master){
  const cont=document.getElementById('fab-rolls-'+fabId);
  if(!cont)return;
  cont.querySelectorAll('.fab-roll-chk').forEach(c=>{c.checked=master.checked;});
  window.updateRollPrintCount(fabId);
};

// Refresh the "Print selected (n)" button label/enabled state + the
// select-all box after any individual checkbox change.
window.updateRollPrintCount=function(fabId){
  const cont=document.getElementById('fab-rolls-'+fabId);
  if(!cont)return;
  const boxes=[...cont.querySelectorAll('.fab-roll-chk')];
  const n=boxes.filter(c=>c.checked).length;
  const btn=document.getElementById('fab-print-sel-'+fabId);
  if(btn){btn.textContent='🖨 Print selected'+(n?` (${n})`:'');btn.disabled=!n;btn.style.opacity=n?'1':'.5';}
  const master=document.getElementById('fab-chk-all-'+fabId);
  if(master)master.checked=n>0&&n===boxes.length;
};

// ── Edit / Delete fabric receipts (reuses gatepass approval globals) ──
function _fabRefreshList(){
  if(typeof currentPage!=='undefined'&&currentPage==='fabric-inventory'&&fabActiveTab==='fabricin'){
    renderFabricInList();
  }
}

window.editFabricIn=function(fabId){
  const f=allFabricIn.find(x=>x.id===fabId);
  if(!f)return showToast('Fabric entry not found.',true);
  if(_gpPendingFor('fabric',fabId))return showToast('An edit/delete is already pending for '+fabId,true);
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='hrm-modal-back';
  back.onclick=ev=>{if(ev.target===back)window.hrmCloseModal();};
  const banner=_gpCanApprove()
    ?`<div style="background:#ecfdf5;color:#065f46;border:1px solid #bbf7d0;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px">Owner/Manager: changes apply immediately.</div>`
    :`<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px">Your changes will be sent to owners/managers for approval.</div>`;
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h3>Edit Fabric Entry</h3><div class="sub">${f.id} · ${_gpEsc(f.supplier||'')}</div></div>
      <button onclick="window.hrmCloseModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--muted);line-height:1">×</button>
    </div>
    ${banner}
    <div class="hrm-grid-2">
      <div class="field"><label>Supplier *</label><input id="fabe-supplier" value="${_gpEsc(f.supplier||'')}"></div>
      <div class="field"><label>Date</label><input id="fabe-date" type="date" value="${_gpEsc(f.date||'')}"></div>
      <div class="field"><label>Fabric Type 🔒</label><input value="${_gpEsc(f.fabType||'')}" readonly style="background:#f0f0f0;cursor:not-allowed;color:var(--muted)"></div>
      <div class="field"><label>Color 🔒</label><input value="${_gpEsc(f.color||'')}" readonly style="background:#f0f0f0;cursor:not-allowed;color:var(--muted)"></div>
      <div class="field"><label>GSM 🔒</label><input value="${f.gsm||0}" readonly style="background:#f0f0f0;cursor:not-allowed;color:var(--muted)"></div>
      <div class="field"><label>Total Weight 🔒</label><input value="${(f.totalWeight||0)} ${_gpEsc(f.unit||'kg')}" readonly style="background:#f0f0f0;cursor:not-allowed;color:var(--muted)"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Notes</label><textarea id="fabe-notes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px">${_gpEsc(f.notes||'')}</textarea></div>
    <div style="background:#fafafa;padding:8px 12px;border-radius:8px;margin-top:8px;font-size:12px;color:var(--muted)">🔒 Fabric type, colour, GSM, unit and weight are derived from the rolls and define this fabric's stock bucket — they can't be edited here (it would orphan stock). To fix one of those, delete a roll (or the whole receipt) and re-add it. Only supplier, date and notes are editable.</div>
    ${!_gpCanApprove()?`<div class="field" style="margin-top:12px"><label>Reason for change *</label><textarea id="fabe-reason" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px" placeholder="Required so the approver understands why."></textarea></div>`:''}
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.submitFabricEdit('${fabId}')">${_gpCanApprove()?'Save Changes':'Send for Approval'}</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

function _collectFabricEditPayload(){
  const v=k=>document.getElementById(k)?.value?.trim()||'';
  // Only the safe metadata fields — type/color/gsm/unit/weight are locked
  // (they key the inventory bucket / are derived from rolls).
  return{
    supplier:v('fabe-supplier'),
    date:v('fabe-date'),
    notes:v('fabe-notes')
  };
}

window.submitFabricEdit=async function(fabId){
  const f=allFabricIn.find(x=>x.id===fabId);
  if(!f)return showToast('Fabric entry not found.',true);
  const proposed=_collectFabricEditPayload();
  if(!proposed.supplier)return showToast('Supplier is required.',true);
  try{
    if(_gpCanApprove()){
      await updateDoc(doc(db,'fabricin',fabId),{...proposed,updatedAt:Date.now(),updatedBy:session.name});
      Object.assign(f,proposed);
      await logActivity('Fabric In edited',`${fabId} by ${session.name}`);
      showToast(fabId+' updated ✓');
    }else{
      const reason=(document.getElementById('fabe-reason')?.value||'').trim();
      if(!reason)return showToast('Reason for change is required.',true);
      const currentData={supplier:f.supplier,date:f.date,notes:f.notes};
      await _gpSubmitEditRequest({type:'fabric',targetId:fabId,action:'edit',proposedData:proposed,currentData,reason});
      showToast('Edit request sent for approval ✓');
    }
    window.hrmCloseModal();
    _fabRefreshList();
  }catch(e){showToast('Save failed: '+e.message,true);}
};

// Deleting a fabric receipt is owners-only (Afnan, Ammar) — even managers go
// through the approval request flow, and the Firestore rules enforce the same
// (delete: if isOwner()).
function _fabCanDelete(){return !!(session&&session.role==='owner');}

// Shared receipt deletion used by BOTH the owner immediate path and the
// approval-execution path. Removes the receipt's rolls from inventory AND
// deletes the receipt doc in ONE transaction (no more orphaned stock), and
// refuses if any roll has left stock (issued/reserved/returned) — those must
// be returned first or the stock numbers would corrupt. Throws on problems so
// callers can surface the message.
window._fabDeleteReceipt=async function(fabId){
  const f=allFabricIn.find(x=>x.id===fabId);
  if(!f)throw new Error('Fabric entry '+fabId+' not found.');
  const codes=(f.rolls||[]).map(r=>r.rollCode||r.rollNumber).filter(Boolean);
  for(const rc of codes){
    const inv=_fabFindRoll(rc);
    const st=inv?.roll?.status||'in_stock';
    if(inv&&st!=='in_stock')throw new Error(`${rc} is ${st.replace('_',' ')} — return it to stock before deleting ${fabId}.`);
  }
  await _fabInvUpsert({fabType:f.fabType,gsm:f.gsm,color:f.color,unit:f.unit||'kg',deleteRollCodes:codes,note:`Receipt ${fabId} deleted`,sourceCol:'fabricin',sourceId:fabId,extraDeletes:[doc(db,'fabricin',fabId)]});
  allFabricIn=allFabricIn.filter(x=>x.id!==fabId);
};

window.requestDeleteFabricIn=async function(fabId){
  const f=allFabricIn.find(x=>x.id===fabId);
  if(!f)return showToast('Fabric entry not found.',true);
  if(_gpPendingFor('fabric',fabId))return showToast('A request is already pending for '+fabId,true);
  if(_fabCanDelete()){
    if(!confirm(`Delete ${fabId} and all its rolls from stock? This cannot be undone.`))return;
    if(!_fabBusyStart('Deleting receipt…'))return;
    try{
      await window._fabDeleteReceipt(fabId);
      await logActivity('Fabric In deleted',`${fabId} deleted by ${session.name}`);
      showToast(`${fabId} deleted`);
      _fabRefreshList();
    }catch(e){showToast(e.message||('Error: '+e),true);}
    finally{_fabBusyEnd();}
    return;
  }
  const reason=prompt(`Request to delete ${fabId}. Reason:`,'');
  if(!reason||!reason.trim())return;
  try{
    await _gpSubmitEditRequest({type:'fabric',targetId:fabId,action:'delete',currentData:f,reason:reason.trim()});
    showToast('Delete request sent for approval');
    _fabRefreshList();
  }catch(e){showToast('Request failed: '+e.message,true);}
};

// Re-render whichever fabric view is on screen after a per-roll change, so the
// roll actions work identically from the Fabric In list and the Stock drill.
function _fabAfterRollChange(fabId){
  if(fabActiveTab==='stock'&&_fabInvDrillKey){
    window.fabInvDrill(_fabInvDrillKey);            // re-render drill + barcodes
  }else{
    renderFabricInList();
    if(fabId)window.toggleFabEntry(fabId);          // keep the entry expanded
  }
}

// Delete a SINGLE roll (owners only) — for a roll entered by mistake, without
// nuking the whole entry. Only in-stock rolls qualify (issued/reserved ones are
// in use → use Returns first). A receipt roll is spliced from its receipt AND
// inventory atomically (and the receipt is removed if it was the last roll); a
// remnant / inventory-only roll is removed from inventory only. Works from both
// the Fabric In list and the Stock drill.
window.deleteFabricRoll=async function(fabId,rollCode){
  if(!_fabCanDelete())return showToast('Only owners (Afnan, Ammar) can delete rolls.',true);
  const inv=_fabFindRoll(rollCode);
  if(!inv)return showToast('Roll '+rollCode+' not found.',true);
  const invStatus=inv.roll.status||'in_stock';
  if(invStatus!=='in_stock')
    return showToast(`${rollCode} is ${invStatus.replace('_',' ')} — can't delete a roll that's in use. Use Returns first.`,true);
  const f=allFabricIn.find(x=>x.id===fabId);
  const idx=f?(f.rolls||[]).findIndex(r=>(r.rollCode||r.rollNumber)===rollCode):-1;
  if(f&&idx<0&&_gpPendingFor('fabric',fabId))return showToast('A delete/edit is already pending for '+fabId,true);
  if(!confirm(`Delete roll ${rollCode}? This removes just this one roll and cannot be undone.`))return;
  if(!_fabBusyStart('Deleting roll…'))return;
  try{
    if(f&&idx>=0){
      const lastOne=f.rolls.length===1;
      const newRolls=f.rolls.filter((_,i)=>i!==idx);
      const newTotal=parseFloat(newRolls.reduce((s,r)=>s+(Number(r.weight)||0),0).toFixed(2));
      const fabRef=doc(db,'fabricin',fabId);
      const extra=lastOne
        ?{extraDeletes:[fabRef]}
        :{extraWrites:[{ref:fabRef,data:{rolls:newRolls,rollsCount:newRolls.length,totalWeight:newTotal,updatedAt:Date.now(),updatedBy:session.name},merge:true}]};
      await _fabInvUpsert({fabType:f.fabType,gsm:f.gsm,color:f.color,unit:f.unit||inv.roll.unit||'kg',deleteRollCodes:[rollCode],note:`Roll ${rollCode} deleted from ${fabId}`,sourceCol:'fabricin',sourceId:fabId,...extra});
      if(lastOne)allFabricIn=allFabricIn.filter(x=>x.id!==fabId);
      else{f.rolls=newRolls;f.rollsCount=newRolls.length;f.totalWeight=newTotal;}
      await logActivity('Fabric roll deleted',`${rollCode} removed from ${fabId} by ${session.name}${lastOne?' (entry emptied & removed)':''}`);
      showToast(lastOne?`${rollCode} deleted · ${fabId} had no rolls left and was removed`:`${rollCode} deleted ✓`);
      _fabAfterRollChange(lastOne?null:fabId);
    }else{
      // Remnant / inventory-only roll — no receipt to touch.
      const st=inv.stock;
      await _fabInvUpsert({fabType:st.fabType,gsm:st.gsm,color:st.color,unit:st.unit||inv.roll.unit||'kg',deleteRollCodes:[rollCode],note:`Roll ${rollCode} deleted`,sourceCol:'fabric_inventory',sourceId:st._id});
      await logActivity('Fabric roll deleted',`${rollCode} removed by ${session.name}`);
      showToast(`${rollCode} deleted ✓`);
      _fabAfterRollChange(null);
    }
  }catch(e){showToast('Delete failed: '+e.message,true);}
  finally{_fabBusyEnd();}
};

// Edit a SINGLE in-stock roll's weight / GSM / QC (owners only). Updates the
// receipt roll (if any) AND the inventory roll in one transaction.
window.editFabricRoll=function(fabId,rollCode){
  if(!_fabCanDelete())return showToast('Only owners (Afnan, Ammar) can edit rolls.',true);
  const inv=_fabFindRoll(rollCode);
  if(!inv)return showToast('Roll '+rollCode+' not found.',true);
  if((inv.roll.status||'in_stock')!=='in_stock')return showToast(`${rollCode} is in use — only in-stock rolls can be edited.`,true);
  const r=inv.roll,unit=r.unit||inv.stock.unit||'kg';
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='hrm-modal-back';
  back.onclick=ev=>{if(ev.target===back)window.hrmCloseModal();};
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h3>Edit roll</h3><div class="sub">${_gpEsc(rollCode)}</div></div>
      <button onclick="window.hrmCloseModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--muted);line-height:1">×</button>
    </div>
    <div class="hrm-grid-2">
      <div class="field"><label>Weight (${_gpEsc(unit)})</label><input id="fer-weight" type="number" min="0" step="0.01" value="${r.weight||0}"></div>
      <div class="field"><label>GSM</label><input id="fer-gsm" type="number" min="0" step="1" value="${r.gsm||inv.stock.gsm||0}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;cursor:pointer"><input type="checkbox" id="fer-qc" ${r.qcPassed?'checked':''}> QC passed</label>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.saveFabricRoll('${_gpEsc(fabId)}','${_gpEsc(rollCode)}')">Save</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window.saveFabricRoll=async function(fabId,rollCode){
  if(!_fabCanDelete())return showToast('Only owners can edit rolls.',true);
  const weight=parseFloat(document.getElementById('fer-weight')?.value);
  const gsm=parseInt(document.getElementById('fer-gsm')?.value);
  const qc=document.getElementById('fer-qc')?.checked||false;
  if(isNaN(weight)||weight<=0)return showToast('Enter a valid weight.',true);
  if(isNaN(gsm)||gsm<=0)return showToast('Enter a valid GSM.',true);
  const inv=_fabFindRoll(rollCode);
  if(!inv)return showToast('Roll not found.',true);
  if((inv.roll.status||'in_stock')!=='in_stock')return showToast(`${rollCode} is in use — can't edit.`,true);
  const st=inv.stock,f=allFabricIn.find(x=>x.id===fabId);
  if(!_fabBusyStart('Saving roll…'))return;
  try{
    let extra={},pending=null;
    if(f){
      const idx=(f.rolls||[]).findIndex(r=>(r.rollCode||r.rollNumber)===rollCode);
      if(idx>=0){
        const newRolls=f.rolls.map((r,i)=>i===idx?{...r,weight,gsm,qcPassed:qc,qcBy:qc?session.name:'',qcAt:qc?Date.now():null}:r);
        const newTotal=parseFloat(newRolls.reduce((a,r)=>a+(Number(r.weight)||0),0).toFixed(2));
        extra={extraWrites:[{ref:doc(db,'fabricin',fabId),data:{rolls:newRolls,totalWeight:newTotal,updatedAt:Date.now(),updatedBy:session.name},merge:true}]};
        pending={newRolls,newTotal};
      }
    }
    await _fabInvUpsert({fabType:st.fabType,gsm:st.gsm,color:st.color,unit:st.unit||inv.roll.unit||'kg',editRolls:[{rollCode,weight,gsm,qcPassed:qc}],note:`Roll ${rollCode} edited`,sourceCol:'fabricin',sourceId:fabId,...extra});
    if(f&&pending){f.rolls=pending.newRolls;f.totalWeight=pending.newTotal;}
    await logActivity('Fabric roll edited',`${rollCode} by ${session.name}`);
    showToast(`${rollCode} updated ✓`);
    window.hrmCloseModal();
    _fabAfterRollChange(f?fabId:null);
  }catch(e){showToast('Save failed: '+e.message,true);}
  finally{_fabBusyEnd();}
};

// ════════════════════════════════════════════════════════════════════════
//  Issue (Phase 3) — scanner-first roll issuing to a vendor, PO required.
//  All rolls in one issue must belong to a single fabric stock.
// ════════════════════════════════════════════════════════════════════════
const FAB_DESTINATIONS=['FebKnit','Al-Hamd','Al-Nisa','Aqib Sublimation','JR Traders','Rahim Gul Enterprise','Khursheed Enterprise'];
let _fabIssueRolls=[],_fabIssueKey=null,_fabIssuePreselectKey='';
// Production planning rows for the Issue form: size → pcs/bundle × bundles.
let _fabIssueSizes=[{size:'',perBundle:'',bundles:''}];

// Roll codes are stored uppercase (e.g. GRYJRS200-01-R01). Handheld scanners
// can emit a different case (Caps-Lock state / config) or stray whitespace, so
// every scan/lookup compares on this normalized form instead of a brittle
// exact, case-sensitive match.
function _normRoll(s){return String(s||'').trim().toUpperCase().replace(/\s+/g,'');}

// Drop the cursor into a scan box right after its tab renders, so a keyboard-
// wedge scanner (the usual handheld) types straight into it with no click —
// the point-and-scan behaviour every other ERP/courier app gives. The rAF +
// timeout lets the freshly-set innerHTML mount before we focus.
function _fabFocusScan(id){
  requestAnimationFrame(()=>setTimeout(()=>{
    const el=document.getElementById(id);
    if(el){el.focus();try{el.select();}catch(_){}}
  },60));
}

function _fabFindRoll(rollCode){
  const t=_normRoll(rollCode);
  for(const s of allFabricInventory){const r=(s.rolls||[]).find(x=>_normRoll(x.rollCode)===t);if(r)return{stock:s,roll:r};}
  return null;
}

// ── Fabric Issue Registry ──
// Every fabric issue against a PO, with the cut (size breakdown / planned qty),
// bundles, fabric and weight. Source = gate passes with gpType 'fabric'.
let _fabRegPage=0,_fabRegQ='';
const FAB_REG_PG=12;
function _fabIssueRecords(){
  return (typeof allPasses!=='undefined'&&allPasses||[])
    .filter(g=>g.gpType==='fabric')
    .sort((a,b)=>(b.ts||0)-(a.ts||0));
}
function _fabRegFiltered(){
  const f=_fabRegQ.toLowerCase();
  return _fabIssueRecords().filter(g=>!f||[g.poId,g.articleName,g.articleCode,g.fabricType,g.fabricColor,g.id].some(v=>String(v||'').toLowerCase().includes(f)));
}
function _fabRegRows(issues){
  return issues.map(g=>{
    const sizes=(g.sizeBreakdown||[]).filter(s=>s.qty).map(s=>`${_gpEsc(s.size||'?')}: ${s.qty} (${s.perBundle||0}×${s.bundles||0})`).join(' · ');
    return`<div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
        <div style="font-size:15px"><span style="font-weight:800;color:#dc2626">PO ${_gpEsc(g.poId||'—')}</span> <span style="font-weight:600;color:var(--muted);font-size:13px">${_gpEsc(g.articleName||'')}${g.articleCode?' · '+_gpEsc(g.articleCode):''}</span></div>
        <div style="font-size:11px;color:var(--muted)">${_gpEsc(g.id||'')} · ${_gpEsc(g.date||'')}</div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px">${_gpEsc(g.fabricType||'')} ${g.fabricGsm||0}gsm ${_gpEsc(g.fabricColor||'')}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:14px">
        <span><strong>${(g.plannedQty||0).toLocaleString()}</strong> pcs cut</span>
        <span><strong>${g.totalBundles||0}</strong> bundles</span>
        <span><strong>${(g.fabricQty||0).toFixed(2)}</strong> ${_gpEsc(g.fabricUnit||'kg')}</span>
        <span style="color:var(--muted)">${g.rollsCount||0} rolls</span>
      </div>
      ${sizes?`<div style="font-size:12px;color:var(--muted);margin-top:7px">Cut by size: ${sizes}</div>`:''}
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Issued by ${_gpEsc(g.issuer||g.name||'')}</div>
    </div>`;
  }).join('');
}
function _fabRegListHTML(){
  const all=_fabRegFiltered();
  if(!all.length)return '<div class="empty" style="padding:24px;text-align:center">No fabric issues found.</div>';
  const pages=Math.ceil(all.length/FAB_REG_PG);
  if(_fabRegPage>=pages)_fabRegPage=Math.max(0,pages-1);
  const slice=all.slice(_fabRegPage*FAB_REG_PG,(_fabRegPage+1)*FAB_REG_PG);
  let pager='';
  if(pages>1){
    pager=`<div style="display:flex;gap:8px;align-items:center;justify-content:center;padding:12px 0 4px;border-top:1px solid var(--border);margin-top:6px">
      <button onclick="window.fabRegPage(${_fabRegPage-1})" ${_fabRegPage===0?'disabled':''} class="btn-outline" style="padding:6px 14px;font-size:12px">← Prev</button>
      <span style="font-size:12px;color:var(--muted)">Page <strong>${_fabRegPage+1}</strong>/${pages} · ${all.length} issues</span>
      <button onclick="window.fabRegPage(${_fabRegPage+1})" ${_fabRegPage>=pages-1?'disabled':''} class="btn-outline" style="padding:6px 14px;font-size:12px">Next →</button>
    </div>`;
  }
  return _fabRegRows(slice)+pager;
}
function renderFabricIssueRegistry(){
  _fabRegPage=0;_fabRegQ='';
  const issues=_fabIssueRecords();
  const totalWeight=issues.reduce((s,g)=>s+(g.fabricQty||0),0);
  const totalPcs=issues.reduce((s,g)=>s+(g.plannedQty||0),0);
  const totalBundles=issues.reduce((s,g)=>s+(g.totalBundles||0),0);
  return`<div class="card"><div class="card-title" style="display:flex;justify-content:space-between;align-items:center">Fabric Issue Registry <span style="font-weight:400;color:var(--muted);font-size:11px">${issues.length} issue${issues.length===1?'':'s'}</span></div>
    ${issues.length?`<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn-outline" style="font-size:12px;padding:6px 14px" onclick="window.fabExportIssueRegistry()">⬇ Export Excel</button>
      ${['owner','manager'].includes(session.role)?`<button class="btn-outline" style="font-size:12px;padding:6px 14px;color:#dc2626;border-color:#fca5a5" onclick="window.fabRegDeleteAll()">🗑 Delete all</button>`:''}
    </div>`:''}
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <div style="flex:1;background:#f4f4f6;border-radius:8px;padding:9px;text-align:center"><div style="font-size:10px;color:var(--muted)">Cut planned</div><div style="font-size:18px;font-weight:800">${totalPcs.toLocaleString()} pcs</div></div>
      <div style="flex:1;background:#f4f4f6;border-radius:8px;padding:9px;text-align:center"><div style="font-size:10px;color:var(--muted)">Bundles</div><div style="font-size:18px;font-weight:800">${totalBundles.toLocaleString()}</div></div>
      <div style="flex:1;background:#f4f4f6;border-radius:8px;padding:9px;text-align:center"><div style="font-size:10px;color:var(--muted)">Fabric out</div><div style="font-size:18px;font-weight:800">${totalWeight.toFixed(1)}</div></div>
    </div>
    <input id="fab-reg-search" placeholder="Search PO, article, fabric…" oninput="window.fabRegFilter(this.value)" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:10px">
    <div id="fab-reg-list">${_fabRegListHTML()}</div>
  </div>
  <div style="height:60px"></div>`;
}
window.fabRegPage=function(n){_fabRegPage=n;const el=document.getElementById('fab-reg-list');if(el){el.innerHTML=_fabRegListHTML();el.scrollIntoView({behavior:'smooth',block:'start'});}};
window.fabRegFilter=function(q){_fabRegQ=q||'';_fabRegPage=0;const el=document.getElementById('fab-reg-list');if(el)el.innerHTML=_fabRegListHTML();};
window.fabRegDeleteAll=async function(){
  if(!['owner','manager'].includes(session.role)){showToast('Owners/managers only.',true);return;}
  const issues=_fabIssueRecords();
  if(!issues.length){showToast('Nothing to delete.');return;}
  if(!confirm(`Delete ALL ${issues.length} fabric issue record(s)? This clears the issue log only — fabric inventory is NOT restored. Cannot be undone.`))return;
  if(!_fabBusyStart('Deleting…'))return;
  let n=0;
  for(const g of issues){
    const key=g.id||g._id;
    if(!key)continue;
    try{await deleteDoc(doc(db,'gatepasses',key));n++;}catch(e){console.warn('[fabric] delete issue failed',key,e);}
  }
  await logActivity('Fabric issues cleared',`${n} fabric issue record(s) deleted by ${session.name}`).catch(()=>{});
  _fabBusyEnd();
  showToast(`${n} fabric issue(s) deleted ✓`);
  if(typeof loadData==='function')await loadData();
  window.switchFabTab('registry');
};
window.fabExportIssueRegistry=function(){
  const issues=_fabIssueRecords();
  if(!issues.length){showToast('Nothing to export.',true);return;}
  const header=['Date','GP','PO','Article','Code','Fabric','GSM','Color','Pcs cut','Bundles','Weight','Unit','Rolls','Avg/unit','Fabric req.','Cut by size','Issued by'];
  const rows=issues.map(g=>[
    g.date||'',g.id||'',g.poId||'',g.articleName||'',g.articleCode||'',
    g.fabricType||'',g.fabricGsm||0,g.fabricColor||'',
    g.plannedQty||0,g.totalBundles||0,g.fabricQty||0,g.fabricUnit||'',g.rollsCount||0,
    g.avgConsumption||0,g.fabricRequired||0,
    (g.sizeBreakdown||[]).filter(s=>s.qty).map(s=>`${s.size||'?'}:${s.qty}(${s.perBundle||0}x${s.bundles||0})`).join(' | '),
    g.issuer||g.name||''
  ]);
  // totals row
  const tot=['TOTAL','','','','','','','',
    issues.reduce((n,g)=>n+(g.plannedQty||0),0),
    issues.reduce((n,g)=>n+(g.totalBundles||0),0),
    issues.reduce((n,g)=>n+(g.fabricQty||0),0),'','','','','',''];
  _fabXlsx([header,...rows,[],tot],'Fabric Issues','fabric-issue-registry');
  showToast('Exported ✓');
};

function renderFabricIssueTab(){
  const stocks=allFabricInventory.filter(s=>(s.rolls||[]).some(r=>['in_stock','reserved'].includes(r.status||'in_stock')));
  const pos=(typeof allPOs!=='undefined'&&allPOs)||[];
  return`<div class="card"><div class="card-title">Issue fabric to production</div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Production Order (PO) *</label>
        <input id="fab-iss-po" list="fab-iss-po-list" placeholder="Type or pick a PO number…" autocomplete="off" onchange="window.fabIssuePoChange()" oninput="window.fabIssuePoChange()">
        <datalist id="fab-iss-po-list">${pos.map(p=>`<option value="${_gpEsc(p.id)}">${_gpEsc(p.name||'')}${p.code?` · ${_gpEsc(p.code)}`:''}${p.fabric?` · ${_gpEsc(p.fabric)}`:''}</option>`).join('')}</datalist>
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Fabric is issued to the factory against this PO. Issuer, date &amp; time are recorded automatically.</div>
      </div>
      <div class="field" style="position:relative"><label>Article name *</label>
        <input id="fab-iss-article" placeholder="Type to search product name or code…" autocomplete="off"
          oninput="window.fabIssueProdSearch(this.value)" onfocus="window.fabIssueProdSearch(this.value)" onblur="setTimeout(()=>window.fabIssueProdHide(),200)">
        <div id="fab-iss-prod-drop" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:300;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.13);max-height:240px;overflow-y:auto;margin-top:3px"></div>
      </div>
      <div class="field"><label>Article code *</label>
        <input id="fab-iss-code" placeholder="Auto-filled from product (editable)" autocomplete="off"></div>
    </div>
  </div>
  <div class="card"><div class="card-title">Cutting plan <span style="font-weight:400;color:var(--muted);font-size:11px">size cut · pcs per bundle · bundles</span></div>
    <div id="fab-iss-sizes"></div>
    <button type="button" class="btn-outline" style="font-size:12px;padding:6px 12px;margin-top:8px" onclick="window.fabIssueAddSize()">+ Add size</button>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
      <div class="field" style="flex:1;min-width:150px;margin:0"><label>Avg fabric consumption / unit</label>
        <div style="display:flex;gap:6px">
          <input id="fab-iss-consumption" type="number" min="0" step="0.001" inputmode="decimal" placeholder="e.g. 0.25" oninput="window.fabIssueRecalc()" style="flex:1;font-size:15px;padding:9px 10px">
          <select id="fab-iss-cons-unit" onchange="window.fabIssueRecalc()" style="width:96px;font-size:15px;padding:9px 8px">
            <option value="kg">kg</option><option value="meters">meters</option>
          </select>
        </div>
      </div>
      <div class="field" style="flex:1;min-width:150px;margin:0"><label>Total quantity</label>
        <div id="fab-iss-totalqty" style="font-size:20px;font-weight:800;padding:8px 0">0 pcs</div></div>
      <div class="field" style="flex:1;min-width:150px;margin:0"><label>Fabric required (calc)</label>
        <div id="fab-iss-fabreq" style="font-size:20px;font-weight:800;padding:8px 0">—</div></div>
    </div>
    <div id="fab-iss-compare" style="margin-top:4px"></div>
  </div>
  <div class="card"><div class="card-title">Pick rolls <span style="font-weight:400;color:var(--muted);font-size:11px">scan or select — all from one fabric</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="flex:1;min-width:200px;margin:0"><label>Scan roll barcode</label>
        <input id="fab-iss-scan" placeholder="Scan or type roll code, press Enter" autocomplete="off" onkeydown="if(event.key==='Enter'||(event.key==='Tab'&&this.value.trim())){event.preventDefault();window.fabIssueScan();}">
      </div>
      <div class="field" style="flex:1;min-width:200px;margin:0"><label>…or pick a fabric</label>
        <select id="fab-iss-stock" onchange="window.fabIssuePickStock()">
          <option value="">Select fabric…</option>
          ${stocks.map(s=>`<option value="${s._id}">${_gpEsc(s.fabType)} · ${s.gsm||0}gsm · ${_gpEsc(s.color)} — ${s.rollsCount||0} avail${s.reservedCount?` · ${s.reservedCount} reserved`:''}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="fab-iss-checklist"></div>
    <div id="fab-iss-selected" style="margin-top:10px"></div>
  </div>
  <button class="btn-primary" onclick="window.submitFabricIssue()">Issue Fabric</button>
  <div style="height:80px"></div>`;
}

// Type-to-search the product catalog (same source as New PO) → fills article
// name + code. Free text is still allowed for one-offs not in the catalog.
window.fabIssueProdSearch=function(q){
  const dd=document.getElementById('fab-iss-prod-drop');if(!dd)return;
  const cat=(typeof PRODUCT_CATALOG!=='undefined'&&PRODUCT_CATALOG)||[];
  q=(q||'').toLowerCase().trim();
  if(!q){dd.style.display='none';return;}
  const hits=cat.filter(p=>(p.code||'').toLowerCase().includes(q)||(p.name||'').toLowerCase().includes(q)).slice(0,18);
  if(!hits.length){dd.innerHTML='<div style="padding:10px 12px;font-size:12px;color:var(--muted)">No catalog match — you can still type any name/code to use as-is</div>';dd.style.display='block';return;}
  dd.innerHTML=hits.map(p=>`<div class="prod-opt" data-code="${_gpEsc(p.code||'')}" data-name="${_gpEsc(p.name||'')}" style="padding:10px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f3f4f6;display:flex;gap:10px;align-items:baseline"><span style="font-weight:700;color:var(--dark);min-width:84px;font-size:12px">${_gpEsc(p.code||'')}</span><span style="color:var(--text)">${_gpEsc(p.name||'')}</span></div>`).join('');
  dd.style.display='block';
  dd.querySelectorAll('.prod-opt').forEach(el=>el.addEventListener('mousedown',e=>{
    e.preventDefault();
    const a=document.getElementById('fab-iss-article');if(a)a.value=el.getAttribute('data-name')||'';
    const c=document.getElementById('fab-iss-code');if(c)c.value=el.getAttribute('data-code')||'';
    dd.style.display='none';
  }));
};
window.fabIssueProdHide=function(){const dd=document.getElementById('fab-iss-prod-drop');if(dd)dd.style.display='none';};

// Prefill article name/code from the chosen PO (only when there is a match).
window.fabIssuePoChange=function(){
  const po=(document.getElementById('fab-iss-po')?.value||'').trim();
  const p=(typeof allPOs!=='undefined'&&allPOs||[]).find(x=>String(x.id)===po);
  if(!p)return;
  const nm=document.getElementById('fab-iss-article'); if(nm)nm.value=p.name||nm.value;
  const cd=document.getElementById('fab-iss-code');    if(cd)cd.value=p.code||cd.value;
};

// ── Cutting-plan size rows ──
function _fabIssueSyncSizesFromDOM(){
  const rows=document.querySelectorAll('#fab-iss-sizes .fis-row');
  if(!rows.length)return;
  _fabIssueSizes=Array.from(rows).map(r=>({
    size:r.querySelector('.fis-size')?.value||'',
    perBundle:r.querySelector('.fis-pb')?.value||'',
    bundles:r.querySelector('.fis-bd')?.value||''
  }));
}
function _fabIssueRenderSizes(){
  const el=document.getElementById('fab-iss-sizes'); if(!el)return;
  if(!_fabIssueSizes.length)_fabIssueSizes=[{size:'',perBundle:'',bundles:''}];
  el.innerHTML=`<div style="display:grid;grid-template-columns:1.3fr 1fr 1fr .9fr 28px;gap:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:0 2px 6px">
      <span>Size</span><span>Pcs / bundle</span><span>Bundles</span><span style="text-align:right">Qty</span><span></span>
    </div>`+
    _fabIssueSizes.map((s,i)=>{
      const q=(parseInt(s.perBundle)||0)*(parseInt(s.bundles)||0);
      return`<div class="fis-row" style="display:grid;grid-template-columns:1.3fr 1fr 1fr .9fr 28px;gap:8px;align-items:center;margin-bottom:8px">
        <input class="fis-size" value="${_gpEsc(s.size)}" placeholder="e.g. M" oninput="window.fabIssueRecalc()" style="margin:0;font-size:15px;padding:9px 10px">
        <input class="fis-pb" type="number" min="0" inputmode="numeric" value="${_gpEsc(s.perBundle)}" placeholder="0" oninput="window.fabIssueRecalc()" style="margin:0;font-size:15px;padding:9px 10px">
        <input class="fis-bd" type="number" min="0" inputmode="numeric" value="${_gpEsc(s.bundles)}" placeholder="0" oninput="window.fabIssueRecalc()" style="margin:0;font-size:15px;padding:9px 10px">
        <span class="fis-qty" style="text-align:right;font-weight:800;font-size:16px">${q?q.toLocaleString():'—'}</span>
        <button type="button" onclick="window.fabIssueRemoveSize(${i})" title="Remove" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:20px;padding:0;line-height:1">×</button>
      </div>`;
    }).join('');
  window.fabIssueRecalc();
}
window.fabIssueAddSize=function(){_fabIssueSyncSizesFromDOM();_fabIssueSizes.push({size:'',perBundle:'',bundles:''});_fabIssueRenderSizes();};
window.fabIssueRemoveSize=function(i){_fabIssueSyncSizesFromDOM();_fabIssueSizes.splice(i,1);if(!_fabIssueSizes.length)_fabIssueSizes=[{size:'',perBundle:'',bundles:''}];_fabIssueRenderSizes();};

// Recompute per-row qty, total quantity, and required fabric (no re-render → keeps focus).
window.fabIssueRecalc=function(){
  let total=0;
  document.querySelectorAll('#fab-iss-sizes .fis-row').forEach(r=>{
    const pb=parseInt(r.querySelector('.fis-pb')?.value)||0;
    const bd=parseInt(r.querySelector('.fis-bd')?.value)||0;
    const q=pb*bd; total+=q;
    const cell=r.querySelector('.fis-qty'); if(cell)cell.textContent=q?q.toLocaleString():'—';
  });
  const av=parseFloat(document.getElementById('fab-iss-consumption')?.value)||0;
  const unit=document.getElementById('fab-iss-cons-unit')?.value||'kg';
  const req=total*av;
  const tq=document.getElementById('fab-iss-totalqty'); if(tq)tq.textContent=total.toLocaleString()+' pcs';
  const fr=document.getElementById('fab-iss-fabreq');   if(fr)fr.textContent=req?req.toFixed(2)+' '+unit:'—';
  _fabIssueUpdateCompare(req,unit);
};
function _fabIssueUpdateCompare(req,unit){
  const el=document.getElementById('fab-iss-compare'); if(!el)return;
  if(!req||!_fabIssueRolls.length){el.innerHTML='';return;}
  const stock=allFabricInventory.find(s=>s._id===_fabIssueKey);
  const selUnit=stock?.unit||'kg';
  const sel=_fabIssueRolls.reduce((s,r)=>s+(r.weight||0),0);
  if(selUnit!==unit){
    el.innerHTML=`<div style="font-size:11px;color:var(--muted)">Selected rolls: <strong>${sel.toFixed(2)} ${selUnit}</strong> · required in ${unit} — units differ, compare manually.</div>`;
    return;
  }
  const diff=sel-req;
  const col=diff<0?'#dc2626':'#16a34a';
  const lbl=diff<0?`Short by ${Math.abs(diff).toFixed(2)} ${unit}`:`${diff.toFixed(2)} ${unit} over requirement`;
  el.innerHTML=`<div style="font-size:12px;color:${col};font-weight:600">Selected ${sel.toFixed(2)} ${unit} vs required ${req.toFixed(2)} ${unit} — ${lbl}</div>`;
}

window.fabIssueScan=function(){
  const inp=document.getElementById('fab-iss-scan');
  const code=(inp?.value||'').trim();
  if(!code)return;
  _fabIssueAdd(code);
  if(inp){inp.value='';inp.focus();}
};

function _fabIssueAdd(code){
  const found=_fabFindRoll(code);
  if(!found){showToast('Roll '+code+' not found.',true);return;}
  const{stock,roll}=found;
  const rc=roll.rollCode;   // canonical stored code — ignore scanned-in case/spacing
  const st=roll.status||'in_stock';
  if(st==='issued'){showToast(rc+' is already issued.',true);return;}
  if(st==='returned_supplier'){showToast(rc+' was returned to supplier.',true);return;}
  if(_fabIssueRolls.some(r=>r.rollCode===rc)){showToast(rc+' already selected.',true);return;}
  if(_fabIssueKey&&_fabIssueKey!==stock._id){showToast('All rolls must be from the same fabric. Clear selection to switch.',true);return;}
  const po=document.getElementById('fab-iss-po')?.value||'';
  // Hard gates (must explicitly confirm) instead of silent "issuing anyway".
  if(st==='reserved'&&roll.reservedPO&&po&&roll.reservedPO!==po){
    if(!confirm(`${rc} is reserved for ${roll.reservedPO}, not ${po}. Issue it anyway?`))return;
  }
  if(!roll.qcPassed){
    if(!confirm(`${rc} has NOT passed QC. Issue it anyway?`))return;
  }
  _fabIssueKey=stock._id;
  _fabIssueRolls.push({rollCode:rc,weight:roll.weight||0,status:st});
  _fabIssueRenderSelected();_fabIssueSyncChecklist();
}

window.fabIssuePickStock=function(){
  const key=document.getElementById('fab-iss-stock')?.value||'';
  const wrap=document.getElementById('fab-iss-checklist');
  if(!wrap)return;
  if(!key){wrap.innerHTML='';return;}
  if(_fabIssueKey&&_fabIssueKey!==key){wrap.innerHTML='<div style="font-size:12px;color:#dc2626;padding:6px">Clear current selection to pick a different fabric.</div>';return;}
  const stock=allFabricInventory.find(s=>s._id===key);
  const pickable=(stock?.rolls||[]).filter(r=>['in_stock','reserved'].includes(r.status||'in_stock'));
  if(!pickable.length){wrap.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px">No available rolls.</div>';return;}
  wrap.innerHTML=`<label style="font-size:11px;color:var(--muted)">${pickable.length} available rolls</label>
    <div style="display:grid;gap:4px;margin-top:4px">${pickable.map(r=>{
      const sel=_fabIssueRolls.some(x=>x.rollCode===r.rollCode);
      const resv=r.status==='reserved';
      return`<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px;cursor:pointer">
        <input type="checkbox" data-roll="${_gpEsc(r.rollCode)}" ${sel?'checked':''} onchange="window.fabIssueToggle(this)">
        <span style="font-weight:700;letter-spacing:.04em">${_gpEsc(r.rollCode)}</span>
        <span style="color:var(--muted)">${r.weight||0} ${r.unit||stock.unit||'kg'}</span>
        ${resv?`<span style="color:var(--amber);font-size:10px">reserved ${_gpEsc(r.reservedPO||'')}</span>`:''}
        ${r.qcPassed?'<span style="color:var(--green);font-size:10px">QC ✓</span>':'<span style="color:var(--muted);font-size:10px">no QC</span>'}
      </label>`;
    }).join('')}</div>`;
};

function _fabIssueSyncChecklist(){if(document.getElementById('fab-iss-stock')?.value)window.fabIssuePickStock();}

window.fabIssueToggle=function(cb){
  const code=cb.dataset.roll;
  if(cb.checked)_fabIssueAdd(code);else window.fabIssueRemove(code);
};

window.fabIssueRemove=function(code){
  _fabIssueRolls=_fabIssueRolls.filter(r=>r.rollCode!==code);
  if(!_fabIssueRolls.length)_fabIssueKey=null;
  _fabIssueRenderSelected();_fabIssueSyncChecklist();
};

function _fabIssueRenderSelected(){
  const el=document.getElementById('fab-iss-selected');if(!el)return;
  if(!_fabIssueRolls.length){el.innerHTML='<div class="empty" style="padding:10px">No rolls selected yet.</div>';return;}
  const stock=allFabricInventory.find(s=>s._id===_fabIssueKey);
  const total=_fabIssueRolls.reduce((s,r)=>s+(r.weight||0),0);
  el.innerHTML=`<div style="font-size:11px;color:var(--muted);margin-bottom:4px">${stock?`${_gpEsc(stock.fabType)} · ${stock.gsm}gsm · ${_gpEsc(stock.color)}`:''}</div>
    ${_fabIssueRolls.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-bottom:1px solid #f5f5f5;font-size:12px">
      <span style="font-weight:700;letter-spacing:.04em">${_gpEsc(r.rollCode)}${r.status==='reserved'?' <span style="color:var(--amber);font-weight:400;font-size:10px">(reserved)</span>':''}</span>
      <span style="display:flex;gap:10px;align-items:center"><span>${r.weight||0} ${stock?.unit||'kg'}</span>
      <button onclick="window.fabIssueRemove('${_gpEsc(r.rollCode)}')" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px">×</button></span>
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;padding:8px;margin-top:6px;background:var(--dark);border-radius:8px;color:#fff;font-size:13px"><span>${_fabIssueRolls.length} rolls</span><span style="font-weight:700">${total.toFixed(2)} ${stock?.unit||'kg'}</span></div>`;
  if(typeof window.fabIssueRecalc==='function')window.fabIssueRecalc();   // refresh required-vs-selected compare
}

window.submitFabricIssue=async function(){
  const po=(document.getElementById('fab-iss-po')?.value||'').trim();
  const articleName=(document.getElementById('fab-iss-article')?.value||'').trim();
  const articleCode=(document.getElementById('fab-iss-code')?.value||'').trim();
  const dest='Factory';                                  // issued to production, not a vendor
  const date=new Date().toISOString().split('T')[0];     // auto date
  if(!po){showToast('Enter or pick a PO (required).',true);return;}
  if(!articleName){showToast('Enter the article name.',true);return;}
  if(!articleCode){showToast('Enter the article code.',true);return;}
  if(!_fabIssueRolls.length){showToast('Select at least one roll.',true);return;}
  const stock=allFabricInventory.find(s=>s._id===_fabIssueKey);
  if(!stock){showToast('Fabric stock not found.',true);return;}
  // Cutting plan (size cut · pcs/bundle · bundles → auto qty)
  _fabIssueSyncSizesFromDOM();
  const sizeBreakdown=_fabIssueSizes
    .map(s=>({size:(s.size||'').trim(),perBundle:parseInt(s.perBundle)||0,bundles:parseInt(s.bundles)||0}))
    .filter(s=>s.size||s.perBundle||s.bundles)
    .map(s=>({...s,qty:s.perBundle*s.bundles}));
  const plannedQty=sizeBreakdown.reduce((n,s)=>n+s.qty,0);
  const totalBundles=sizeBreakdown.reduce((n,s)=>n+(s.bundles||0),0);
  const avgConsumption=parseFloat(document.getElementById('fab-iss-consumption')?.value)||0;
  const consumptionUnit=document.getElementById('fab-iss-cons-unit')?.value||'kg';
  const fabricRequired=parseFloat((plannedQty*avgConsumption).toFixed(3));
  if(!plannedQty){ if(!confirm('No cutting-plan quantities entered. Issue anyway?'))return; }
  const rollCodes=_fabIssueRolls.map(r=>r.rollCode);
  const fabUnit=stock.unit||'kg';
  const fabQty=parseFloat(_fabIssueRolls.reduce((s,r)=>s+(r.weight||0),0).toFixed(2));
  if(!_fabBusyStart('Issuing fabric…'))return;
  try{
    const next=await getNextId('gatepasses');
    const gpId='GP-'+String(next).padStart(3,'0');
    const article=`${stock.fabType} ${stock.gsm||0}gsm ${stock.color}`;
    // The gate pass IS the fabric-issue registry record: PO, article, the cut
    // (size breakdown + planned qty), bundles, fabric and weight all live here.
    const payload={id:gpId,ts:Date.now(),name:session.name,issuer:session.name,article,articleName,articleCode,spec:`PO ${po} · ${articleCode||articleName} · ${rollCodes.length} rolls`,dest,date,gpType:'fabric',poId:po,fabricUnit:fabUnit,fabricQty:fabQty,rollsCount:rollCodes.length,rollCodes,fabricType:stock.fabType,fabricGsm:stock.gsm,fabricColor:stock.color,inventoryKey:stock._id,sizeBreakdown,plannedQty,totalBundles,avgConsumption,consumptionUnit,fabricRequired,boras:'0',items:[],totalUnits:plannedQty,totalWeight:fabUnit==='kg'?fabQty:0,totalLength:fabUnit==='meters'?fabQty:0};
    // Gate pass + inventory decrement commit in ONE transaction.
    await _fabInvUpsert({fabType:stock.fabType,gsm:stock.gsm,color:stock.color,unit:fabUnit,removeRollCodes:rollCodes,reservePO:po,note:`Issued to factory for ${po} by ${session.name}`,sourceCol:'gatepasses',sourceId:gpId,extraWrites:[{ref:doc(db,'gatepasses',gpId),data:payload}]});
    await logActivity('Fabric issued',`${gpId} — ${rollCodes.length} rolls of ${article} to factory for ${po}${plannedQty?` · cut ${plannedQty} pcs / ${totalBundles} bundles`:''} by ${session.name}`);
    showToast(`${gpId} issued ✓ · ${rollCodes.length} rolls`);
    _fabIssueRolls=[];_fabIssueKey=null;_fabIssueSizes=[{size:'',perBundle:'',bundles:''}];
    _fabBusyEnd();   // drop the overlay before the (slower) refresh so the UI never stays blocked
    if(typeof loadData==='function')await loadData();
    window.switchFabTab('issue');
  }catch(e){showToast('Error: '+e.message,true);}
  finally{_fabBusyEnd();}
};

// ════════════════════════════════════════════════════════════════════════
//  Returns (Phase 4) — two modes:
//   • Vendor → Stock: issued rolls come back; whole or partial (mints remnant)
//   • To Supplier: in-stock rolls leave permanently with a reason
// ════════════════════════════════════════════════════════════════════════
const FAB_RETURN_REASONS=['Defective','Wrong color','Wrong GSM','Excess','Shade variation','Other'];
let _fabSRetFilterKey='';   // optional "pick a fabric" filter for the returns list

function renderFabricReturnsTab(){
  return renderFabRetSupplier();
}

// Collect rolls in a given status across all stocks → [{key,stock,roll}]
function _fabRollsByStatus(status){
  const out=[];
  allFabricInventory.forEach(s=>(s.rolls||[]).forEach(r=>{if((r.status||'in_stock')===status)out.push({key:s._id,stock:s,roll:r});}));
  return out;
}

// Origin supplier of a roll, auto-derived from the Fabric In receipt it came
// from — so a return is always sent back to the supplier it arrived from.
function _fabRollSupplier(roll){
  const rcpt=allFabricIn.find(x=>x.id===roll.sourceFabId);
  return rcpt?.supplier||'';
}

// ── To Supplier ──
function renderFabRetSupplier(){
  let inStock=_fabRollsByStatus('in_stock');
  if(!inStock.length)return'<div class="empty" style="padding:24px;text-align:center">No in-stock rolls to return to a supplier.</div>';
  // Distinct fabrics present (for the optional "pick a fabric" filter).
  const fabs=[...new Map(inStock.map(x=>[x.key,x.stock])).values()].sort((a,b)=>(a.fabType||'').localeCompare(b.fabType||''));
  if(_fabSRetFilterKey&&!fabs.some(s=>s._id===_fabSRetFilterKey))_fabSRetFilterKey='';
  const shown=_fabSRetFilterKey?inStock.filter(x=>x.key===_fabSRetFilterKey):inStock;
  return`<div class="card"><div class="card-title">Return to supplier <span style="font-weight:400;color:var(--muted);font-size:11px">to the supplier each roll came from — auto-picked</span></div>
    <div class="form-grid" style="margin-bottom:8px">
      <div class="field"><label>Reason *</label>
        <select id="fab-sret-reason"><option value="">Select reason…</option>${FAB_RETURN_REASONS.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Note</label><input id="fab-sret-note" placeholder="Optional detail"></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="flex:1;min-width:200px;margin:0"><label>Scan roll to select</label>
        <input id="fab-sret-scan" placeholder="Scan or type roll code, press Enter" autocomplete="off" onkeydown="if(event.key==='Enter'||(event.key==='Tab'&&this.value.trim())){event.preventDefault();window.fabSRetScan();}">
      </div>
      <div class="field" style="flex:1;min-width:200px;margin:0"><label>…or pick a fabric</label>
        <select id="fab-sret-fabric" onchange="window.fabSRetFilter(this.value)">
          <option value="">All fabrics</option>
          ${fabs.map(s=>`<option value="${s._id}" ${_fabSRetFilterKey===s._id?'selected':''}>${_gpEsc(s.fabType)} · ${s.gsm||0}gsm · ${_gpEsc(s.color)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#fafafa"><th style="padding:6px"></th><th style="padding:6px;text-align:left">Roll</th><th style="padding:6px;text-align:left">Fabric</th><th style="padding:6px;text-align:left">Supplier (origin)</th><th style="padding:6px;text-align:right">Weight</th></tr></thead>
      <tbody>${shown.map(x=>{const sup=_fabRollSupplier(x.roll);return`<tr style="border-bottom:1px solid #f5f5f5">
        <td style="padding:6px;text-align:center"><input type="checkbox" class="fab-sret-cb" data-key="${x.key}" data-roll="${_gpEsc(x.roll.rollCode)}" data-supplier="${_gpEsc(sup)}"></td>
        <td style="padding:6px;font-weight:700;letter-spacing:.04em">${_gpEsc(x.roll.rollCode)}${x.roll.remnant?' <span style="color:var(--amber);font-size:9px">remnant</span>':''}</td>
        <td style="padding:6px;color:var(--muted)">${_gpEsc(x.stock.fabType)} ${x.stock.gsm}g ${_gpEsc(x.stock.color)}</td>
        <td style="padding:6px;font-weight:600;color:${sup?'var(--text)':'#dc2626'}">${sup?_gpEsc(sup):'unknown'}</td>
        <td style="padding:6px;text-align:right">${x.roll.weight||0} ${x.stock.unit||'kg'}</td>
      </tr>`;}).join('')}</tbody>
    </table></div>
    <button class="btn-primary" style="margin-top:12px" onclick="window.submitFabRetSupplier()">Return selected to supplier</button>
  </div><div style="height:80px"></div>`;
}

window.fabSRetFilter=function(key){
  _fabSRetFilterKey=key||'';
  const el=document.getElementById('fab-tab-content');
  if(el){el.innerHTML=renderFabricReturnsTab();_fabFocusScan('fab-sret-scan');}
};

window.fabSRetScan=function(){
  const inp=document.getElementById('fab-sret-scan');
  const code=(inp?.value||'').trim();
  if(!code)return;
  const t=_normRoll(code);
  const cb=[...document.querySelectorAll('.fab-sret-cb')].find(c=>_normRoll(c.dataset.roll)===t);
  if(!cb)showToast(code+' is not an in-stock roll.',true);else cb.checked=true;
  if(inp){inp.value='';inp.focus();}
};

window.submitFabRetSupplier=async function(){
  const reason=document.getElementById('fab-sret-reason')?.value||'';
  const note=(document.getElementById('fab-sret-note')?.value||'').trim();
  if(!reason){showToast('Select a reason.',true);return;}
  const rows=[...document.querySelectorAll('.fab-sret-cb:checked')];
  if(!rows.length){showToast('Tick at least one roll.',true);return;}
  const fullReason=note?`${reason} — ${note}`:reason;
  // Group by inventory key; track the auto-picked origin supplier(s) per group
  // so the stock log records "returned to {supplier} — {reason}".
  const byKey={};
  rows.forEach(cb=>{
    const k=cb.dataset.key;
    byKey[k]=byKey[k]||{codes:[],suppliers:new Set()};
    byKey[k].codes.push(cb.dataset.roll);
    if(cb.dataset.supplier)byKey[k].suppliers.add(cb.dataset.supplier);
  });
  if(!_fabBusyStart('Returning to supplier…'))return;
  try{
    for(const key of Object.keys(byKey)){
      const s=allFabricInventory.find(x=>x._id===key);if(!s)continue;
      const sup=[...byKey[key].suppliers].join(', ')||'unknown supplier';
      await _fabInvUpsert({fabType:s.fabType,gsm:s.gsm,color:s.color,unit:s.unit||'kg',supplierReturnRollCodes:byKey[key].codes,reason:fullReason,note:`Returned to ${sup} — ${fullReason} · by ${session.name}`,sourceCol:'fabric_returns',sourceId:'supplier-return'});
    }
    await logActivity('Fabric returned to supplier',`${rows.length} roll(s) — ${fullReason} by ${session.name}`);
    showToast(`${rows.length} roll(s) returned to supplier ✓`);
    _fabSRetFilterKey='';
    _fabBusyEnd();   // drop the overlay before the (slower) refresh
    if(typeof loadData==='function')await loadData();
    window.switchFabTab('returns');
  }catch(e){showToast('Error: '+e.message,true);}
  finally{_fabBusyEnd();}
};

// ════════════════════════════════════════════════════════════════════════
//  Reservation (Phase 5) — called from the New PO tab (pos.js).
//  Pick a fabric + rolls → reserved to the PO; rolls stay in stock until issued.
// ════════════════════════════════════════════════════════════════════════
let _poReserveRolls=[],_poReserveKey=null;

window.fabPoReserveCard=function(){
  _poReserveKey=null;_poReserveRolls=[];
  const stocks=(typeof allFabricInventory!=='undefined'?allFabricInventory:[]).filter(s=>(s.rolls||[]).some(r=>(r.status||'in_stock')==='in_stock'));
  return`<div class="card"><div class="card-title">Reserve fabric rolls <span style="font-weight:400;color:var(--muted);font-size:11px">optional · holds rolls in stock for this PO</span></div>
    <div class="field"><label>Fabric</label>
      <select id="po-resv-stock" onchange="window.fabPoReservePick()">
        <option value="">Select fabric…</option>
        ${stocks.map(s=>`<option value="${s._id}">${_gpEsc(s.fabType)} · ${s.gsm||0}gsm · ${_gpEsc(s.color)} — ${s.rollsCount||0} available</option>`).join('')}
      </select>
    </div>
    <div id="po-resv-rolls" style="margin-top:8px"></div>
  </div>`;
};

window.fabPoReservePick=function(){
  const key=document.getElementById('po-resv-stock')?.value||'';
  _poReserveKey=key;_poReserveRolls=[];
  const wrap=document.getElementById('po-resv-rolls');if(!wrap)return;
  if(!key){wrap.innerHTML='';return;}
  const s=allFabricInventory.find(x=>x._id===key);
  const avail=(s?.rolls||[]).filter(r=>(r.status||'in_stock')==='in_stock');
  if(!avail.length){wrap.innerHTML='<div style="font-size:12px;color:var(--muted)">No available rolls.</div>';return;}
  wrap.innerHTML=`<label style="font-size:11px;color:var(--muted)">${avail.length} available — tick to reserve</label>
    <div style="display:grid;gap:4px;margin-top:4px">${avail.map(r=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px;cursor:pointer">
      <input type="checkbox" data-roll="${_gpEsc(r.rollCode)}" onchange="window.fabPoReserveToggle(this)">
      <span style="font-weight:700;letter-spacing:.04em">${_gpEsc(r.rollCode)}</span>
      <span style="color:var(--muted)">${r.weight||0} ${r.unit||s.unit||'kg'}</span>
    </label>`).join('')}</div>`;
};

window.fabPoReserveToggle=function(cb){
  const rc=cb.dataset.roll;
  if(cb.checked){if(!_poReserveRolls.includes(rc))_poReserveRolls.push(rc);}
  else _poReserveRolls=_poReserveRolls.filter(x=>x!==rc);
};

window.fabPoReserveReset=function(){_poReserveKey=null;_poReserveRolls=[];};

// Commit reservations after a PO doc is created. No-op if nothing picked.
window.fabPoReserveCommit=async function(poId){
  if(!_poReserveKey||!_poReserveRolls.length)return;
  const s=allFabricInventory.find(x=>x._id===_poReserveKey);if(!s)return;
  await _fabInvUpsert({fabType:s.fabType,gsm:s.gsm,color:s.color,unit:s.unit||'kg',reserveRollCodes:_poReserveRolls.slice(),reservePO:poId,note:`Reserved for ${poId}`,sourceCol:'pos',sourceId:poId});
  await logActivity('Fabric reserved',`${_poReserveRolls.length} roll(s) reserved for ${poId}`);
  window.fabPoReserveReset();
};

// ════════════════════════════════════════════════════════════════════════
//  Reports (Phase 6) — stock-on-hand, movements, per-PO wastage.
//  Excel via SheetJS; PDF via a print-friendly window (browser print).
// ════════════════════════════════════════════════════════════════════════
function _fabWastageData(){
  const byPO={};
  allFabricInventory.forEach(s=>(s.rolls||[]).forEach(r=>{
    const po=r.issuedPO||r.reservedPO;
    if(!po)return;
    if((r.status||'')==='issued'||r.consumedWeight){
      byPO[po]=byPO[po]||{po,issued:0,consumed:0};
      byPO[po].issued+=r.weight||0;
      byPO[po].consumed+=r.consumedWeight||0;
    }
  }));
  return Object.values(byPO).map(x=>({...x,returned:Math.max(0,x.issued-x.consumed),wastagePct:x.issued?(x.consumed/x.issued*100):0}))
    .sort((a,b)=>b.wastagePct-a.wastagePct);
}

// ── Reporting period (day / week / month / specific date / all) ──
let _fabRptPeriod='today',_fabRptDate='';
let _fabLogQ='',_fabLogAction='all';

function _fabPeriodRange(){
  const now=new Date();
  const sod=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x.getTime();};
  const eod=d=>{const x=new Date(d);x.setHours(23,59,59,999);return x.getTime();};
  switch(_fabRptPeriod){
    case 'today':return{from:sod(now),to:eod(now),label:'Today · '+now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})};
    case '7d':return{from:sod(new Date(now.getTime()-6*864e5)),to:eod(now),label:'Last 7 days'};
    case 'month':return{from:new Date(now.getFullYear(),now.getMonth(),1).getTime(),to:eod(now),label:now.toLocaleDateString('en-GB',{month:'long',year:'numeric'})};
    case 'custom':{const d=_fabRptDate?new Date(_fabRptDate):now;return{from:sod(d),to:eod(d),label:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})};}
    default:return{from:0,to:Date.now()+864e5,label:'All time'};
  }
}

// Display label + colour per movement subtype (returns are purple).
function _fabActionMeta(m){
  const s=m.subtype||'';
  if(s==='receipt')return{label:'Received',color:'#16a34a',sign:'+'};
  if(s==='issue')return{label:'Issued to factory',color:'#dc2626',sign:'−'};
  if(s==='return_out')return{label:'Returned to supplier',color:'#7c3aed',sign:'−'};
  if(s==='return_in')return{label:'Returned to stock',color:'#16a34a',sign:'+'};
  if(s==='reserve')return{label:'Reserved',color:'#d97706',sign:''};
  if(s==='release')return{label:'Released',color:'#0891b2',sign:''};
  if(s==='delete')return{label:'Deleted',color:'#6b7280',sign:'−'};
  if(s==='edit')return{label:'Edited',color:'#2563eb',sign:''};
  return{label:(m.type||'move').toUpperCase(),color:'var(--muted)',sign:''};
}
function _fabParsePO(note){const m=/for\s+(\S+)\s+by/i.exec(note||'');return m?m[1]:'';}
function _fabFmtDT(ts){return new Date(ts).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'});}

function renderFabricReportsTab(){
  const{from,to,label}=_fabPeriodRange();
  const movs=allFabricMovements.filter(m=>m.ts>=from&&m.ts<=to).sort((a,b)=>b.ts-a.ts);
  const agg=arr=>arr.reduce((o,m)=>{o.count++;o.qty+=m.qty||0;o.rolls+=(m.rollCodes||[]).length;return o;},{count:0,qty:0,rolls:0});
  const sub=s=>movs.filter(m=>m.subtype===s);
  const received=agg(sub('receipt')),issued=agg(sub('issue')),returned=agg(sub('return_out')),edited=agg(sub('edit')),deleted=agg(sub('delete'));
  const fabrics=allFabricInventory.length;
  const rollsNow=allFabricInventory.reduce((a,s)=>a+(s.rollsCount||0),0);
  const kg=allFabricInventory.filter(s=>(s.unit||'kg')==='kg').reduce((a,s)=>a+(s.totalWeight||0),0);
  const lvls=allFabricInventory.map(_fabAlertLevel);
  const crit=lvls.filter(l=>l.label==='Critical'||l.label==='Out of stock').length;
  const low=lvls.filter(l=>l.label==='Low'||l.label==='Very low').length;
  const gpById={};(typeof allPasses!=='undefined'&&allPasses?allPasses:[]).forEach(g=>{gpById[g.id]=g;});
  const byPO={};
  sub('issue').forEach(m=>{const g=gpById[m.sourceId];const po=(g&&g.poId)||_fabParsePO(m.note)||'—';(byPO[po]=byPO[po]||{po,qty:0,rolls:0,count:0});byPO[po].qty+=m.qty||0;byPO[po].rolls+=(m.rollCodes||[]).length;byPO[po].count++;});
  const poRows=Object.values(byPO).sort((a,b)=>b.qty-a.qty);
  const rets=sub('return_out');
  const byUser={};movs.forEach(m=>{const u=m.by||'—';(byUser[u]=byUser[u]||{u,n:0});byUser[u].n++;});
  const userRows=Object.values(byUser).sort((a,b)=>b.n-a.n);

  const periods=[['today','Today'],['7d','Week'],['month','Month'],['custom','Specific date'],['all','All time']];
  const chip=(k,l)=>`<button onclick="window.fabRptSetPeriod('${k}')" style="padding:6px 13px;border:1px solid ${_fabRptPeriod===k?'var(--dark)':'var(--border)'};border-radius:999px;background:${_fabRptPeriod===k?'var(--dark)':'#fff'};color:${_fabRptPeriod===k?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit">${l}</button>`;
  const card=(title,c,a)=>`<div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px 14px">
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${title}</div>
    <div style="font-size:22px;font-weight:800;color:${c};margin-top:3px">${a.qty.toFixed(1)}<span style="font-size:12px;font-weight:600;color:var(--muted)"> kg/m</span></div>
    <div style="font-size:11px;color:var(--muted)">${a.count} events · ${a.rolls} rolls</div>
  </div>`;
  const btn=(l,fn)=>`<button class="btn-outline" style="width:auto;padding:9px 16px;margin:0" onclick="window.${fn}()">${l}</button>`;
  const waste=_fabWastageData();

  return`<div class="card"><div class="card-title">Fabric report <span style="font-weight:400;color:var(--muted);font-size:11px">${label}</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:${_fabRptPeriod==='custom'?'8':'0'}px">
      ${periods.map(([k,l])=>chip(k,l)).join('')}
    </div>
    ${_fabRptPeriod==='custom'?`<input type="date" value="${_fabRptDate||new Date().toISOString().slice(0,10)}" onchange="window.fabRptSetDate(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px">`:''}
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    ${card('Received','#16a34a',received)}
    ${card('Issued','#dc2626',issued)}
    ${card('Returned','#7c3aed',returned)}
    <div style="flex:1;min-width:150px;background:var(--dark);border-radius:12px;padding:12px 14px;color:#fff">
      <div style="font-size:11px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.04em">Stock now</div>
      <div style="font-size:22px;font-weight:800;margin-top:3px">${kg.toFixed(1)}<span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.6)"> kg</span></div>
      <div style="font-size:11px;color:rgba(255,255,255,.6)">${fabrics} fabrics · ${rollsNow} rolls${crit?` · <span style="color:#fca5a5">${crit} critical</span>`:''}${low?` · <span style="color:#fde68a">${low} low</span>`:''}</div>
    </div>
  </div>
  <div class="card"><div class="card-title">Issued against PO <span style="font-weight:400;color:var(--muted);font-size:11px">${label}</span></div>
    ${poRows.length?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left">PO</th><th style="padding:8px;text-align:right">Issues</th><th style="padding:8px;text-align:right">Rolls</th><th style="padding:8px;text-align:right">Qty</th></tr></thead>
      <tbody>${poRows.map(p=>`<tr style="border-bottom:1px solid #f5f5f5"><td style="padding:8px;font-weight:700">${_gpEsc(p.po)}</td><td style="padding:8px;text-align:right">${p.count}</td><td style="padding:8px;text-align:right">${p.rolls}</td><td style="padding:8px;text-align:right;font-weight:600">${p.qty.toFixed(2)}</td></tr>`).join('')}</tbody>
    </table></div>`:'<div class="empty" style="padding:14px">No fabric issued in this period.</div>'}
  </div>
  <div class="card"><div class="card-title" style="color:#7c3aed">Returned to supplier <span style="font-weight:400;color:var(--muted);font-size:11px">${label}</span></div>
    ${rets.length?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#faf5ff"><th style="padding:8px;text-align:left">When</th><th style="padding:8px;text-align:left">Fabric</th><th style="padding:8px;text-align:right">Rolls</th><th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:left">Detail</th></tr></thead>
      <tbody>${rets.map(m=>`<tr style="border-bottom:1px solid #f5f5f5;color:#7c3aed"><td style="padding:8px">${_fabFmtDT(m.ts)}</td><td style="padding:8px">${_gpEsc(m.fabType)} ${m.gsm}g ${_gpEsc(m.color)}</td><td style="padding:8px;text-align:right">${(m.rollCodes||[]).length}</td><td style="padding:8px;text-align:right;font-weight:600">${(m.qty||0).toFixed(2)}</td><td style="padding:8px;font-size:11px">${_gpEsc(m.note||'')}</td></tr>`).join('')}</tbody>
    </table></div>`:'<div class="empty" style="padding:14px">No supplier returns in this period.</div>'}
  </div>
  <div class="card"><div class="card-title">Activity by person <span style="font-weight:400;color:var(--muted);font-size:11px">${label} · ${movs.length} events</span></div>
    ${userRows.length?`<div style="display:flex;gap:8px;flex-wrap:wrap">${userRows.map(u=>`<div style="background:#f7f7f7;border-radius:8px;padding:8px 12px;font-size:12px"><span style="font-weight:700">${_gpEsc(u.u)}</span> · ${u.n} actions</div>`).join('')}</div>`:'<div class="empty" style="padding:14px">No activity in this period.</div>'}
    <div style="font-size:11px;color:var(--muted);margin-top:10px">Received ${received.count} · Issued ${issued.count} · Returned ${returned.count} · Edited ${edited.count} · Deleted ${deleted.count} — every event is in the immutable <b>Log</b> tab with name, date &amp; time.</div>
  </div>
  <div class="card"><div class="card-title">Per-PO wastage <span style="font-weight:400;color:var(--muted);font-size:11px">all-time</span></div>
    ${waste.length?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left">PO</th><th style="padding:8px;text-align:right">Issued</th><th style="padding:8px;text-align:right">Consumed</th><th style="padding:8px;text-align:right">Returned</th><th style="padding:8px;text-align:right">Wastage %</th></tr></thead>
      <tbody>${waste.map(w=>`<tr style="border-bottom:1px solid #f5f5f5"><td style="padding:8px;font-weight:700">${_gpEsc(w.po)}</td><td style="padding:8px;text-align:right">${w.issued.toFixed(2)}</td><td style="padding:8px;text-align:right">${w.consumed.toFixed(2)}</td><td style="padding:8px;text-align:right">${w.returned.toFixed(2)}</td><td style="padding:8px;text-align:right;font-weight:600;color:${w.wastagePct>15?'#dc2626':w.wastagePct>5?'#b45309':'#16a34a'}">${w.wastagePct.toFixed(1)}%</td></tr>`).join('')}</tbody>
    </table></div>`:'<div class="empty" style="padding:14px">No issued fabric yet.</div>'}
  </div>
  <div class="card"><div class="card-title">Exports</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${btn('⬇ Stock on hand (Excel)','fabExportStock')}
      ${btn('⬇ Full audit log (Excel)','fabExportMovements')}
      ${btn('⬇ Per-PO wastage (Excel)','fabExportWastage')}
      ${btn('🖨 Print report (PDF)','fabPrintReport')}
    </div>
  </div><div style="height:80px"></div>`;
}

window.fabRptSetPeriod=function(p){_fabRptPeriod=p;const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricReportsTab();};
window.fabRptSetDate=function(v){_fabRptDate=v;const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricReportsTab();};

// ── Log tab — full, append-only, immutable audit of every fabric event ──
function renderFabricLogTab(){
  const q=_fabLogQ.toLowerCase();
  let movs=allFabricMovements.slice().sort((a,b)=>b.ts-a.ts);
  if(_fabLogAction!=='all')movs=movs.filter(m=>(m.subtype||'')===_fabLogAction);
  if(q)movs=movs.filter(m=>`${m.fabType||''} ${m.gsm||''} ${m.color||''} ${(m.rollCodes||[]).join(' ')} ${m.by||''} ${m.note||''}`.toLowerCase().includes(q));
  const total=movs.length;
  const rows=movs.slice(0,400);
  const acts=[['all','All'],['receipt','Received'],['issue','Issued'],['return_out','Returned'],['reserve','Reserved'],['edit','Edited'],['delete','Deleted']];
  const chip=(k,l)=>`<button onclick="window.fabLogSetAction('${k}')" style="padding:5px 11px;border:1px solid ${_fabLogAction===k?'var(--dark)':'var(--border)'};border-radius:999px;background:${_fabLogAction===k?'var(--dark)':'#fff'};color:${_fabLogAction===k?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit">${l}</button>`;
  return`<div class="card"><div class="card-title">Audit log <span style="font-weight:400;color:var(--muted);font-size:11px">append-only · every fabric event · cannot be edited or deleted</span></div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#065f46;font-size:11px;padding:7px 11px;border-radius:8px;margin-bottom:10px">🔒 Permanent record — who did what to which fabric, with date &amp; time. Entries can never be altered or removed.</div>
    <input id="fab-log-search" value="${_fabLogQ.replace(/"/g,'&quot;')}" oninput="window.fabLogSearch(this.value)" placeholder="Search fabric, roll, PO, person, note…" style="width:100%;padding:8px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;outline:none;margin-bottom:10px">
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${acts.map(([k,l])=>chip(k,l)).join('')}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${total} event${total===1?'':'s'}${total>400?' · showing latest 400 (refine with search)':''}</div>
    ${rows.length?rows.map(m=>{
      const a=_fabActionMeta(m);
      return`<div style="display:flex;flex-direction:column;gap:2px;padding:8px 2px;border-bottom:1px solid #f5f5f5">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--muted);min-width:118px">${_fabFmtDT(m.ts)}</span>
          <span style="font-weight:700;color:${a.color};font-size:12px;min-width:130px">${a.sign} ${a.label}</span>
          <span style="flex:1;min-width:140px;font-size:12px">${_gpEsc(m.fabType||'—')} ${m.gsm||0}g ${_gpEsc(m.color||'')}</span>
          <span style="font-size:11px;font-weight:600">${(m.qty||0).toFixed(2)} ${m.unit||'kg'}</span>
          <span style="font-size:11px;color:var(--muted)">by ${_gpEsc(m.by||'—')}</span>
        </div>
        ${(m.rollCodes||[]).length?`<div style="font-size:10px;color:var(--muted);letter-spacing:.03em">${(m.rollCodes||[]).slice(0,6).map(_gpEsc).join(', ')}${m.rollCodes.length>6?` +${m.rollCodes.length-6}`:''}</div>`:''}
        ${m.note?`<div style="font-size:11px;color:${a.color}">${_gpEsc(m.note)}</div>`:''}
      </div>`;
    }).join(''):'<div class="empty" style="padding:20px;text-align:center">No matching events.</div>'}
  </div><div style="height:80px"></div>`;
}

window.fabLogSetAction=function(a){_fabLogAction=a;const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricLogTab();};
window.fabLogSearch=function(v){
  _fabLogQ=v||'';
  clearTimeout(window._fabLogTo);
  window._fabLogTo=setTimeout(()=>{const m=document.getElementById('fab-tab-content');if(m){m.innerHTML=renderFabricLogTab();const i=document.getElementById('fab-log-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}}},180);
};

function _fabXlsx(aoa,sheetName,fileBase){
  if(typeof XLSX==='undefined'){showToast('Excel library not loaded.',true);return;}
  const ws=XLSX.utils.aoa_to_sheet(aoa);const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,sheetName);
  XLSX.writeFile(wb,`${fileBase}-${new Date().toISOString().slice(0,10)}.xlsx`);
}

window.fabExportStock=function(){
  const rows=[['Fabric','GSM','Color','Roll Code','Status','Weight','Unit','Source','PO','Remnant']];
  allFabricInventory.forEach(s=>(s.rolls||[]).forEach(r=>{
    rows.push([s.fabType,s.gsm,s.color,r.rollCode,r.status||'in_stock',r.weight||0,r.unit||s.unit||'kg',r.sourceFabId||'',r.issuedPO||r.reservedPO||'',r.remnant?'yes':'']);
  }));
  _fabXlsx(rows,'Stock','Groovy-Fabric-Stock');
};

window.fabExportMovements=function(){
  const rows=[['When','Type','Subtype','Fabric','GSM','Color','Qty','Unit','Rolls','By','Note']];
  allFabricMovements.forEach(m=>{
    rows.push([new Date(m.ts).toLocaleString('en-GB'),m.type,m.subtype||'',m.fabType,m.gsm,m.color,m.qty||0,m.unit||'kg',(m.rollCodes||[]).join(' '),m.by||'',m.note||'']);
  });
  _fabXlsx(rows,'Movements','Groovy-Fabric-Movements');
};

window.fabExportWastage=function(){
  const rows=[['PO','Issued','Consumed','Returned','Wastage %']];
  _fabWastageData().forEach(w=>rows.push([w.po,w.issued.toFixed(2),w.consumed.toFixed(2),w.returned.toFixed(2),w.wastagePct.toFixed(1)]));
  _fabXlsx(rows,'Wastage','Groovy-Fabric-Wastage');
};

window.fabPrintReport=function(){
  const w=window.open('','_blank');if(!w){showToast('Allow popups to print.',true);return;}
  const stockRows=allFabricInventory.map(s=>{const l=_fabAlertLevel(s);return`<tr><td>${_gpEsc(s.fabType)} ${s.gsm}g ${_gpEsc(s.color)}</td><td style="text-align:right">${(s.totalWeight||0).toFixed(2)} ${s.unit||'kg'}</td><td style="text-align:right">${s.rollsCount||0}</td><td style="color:${l.color}">${l.label}</td></tr>`;}).join('');
  const waste=_fabWastageData().map(x=>`<tr><td>${_gpEsc(x.po)}</td><td style="text-align:right">${x.issued.toFixed(2)}</td><td style="text-align:right">${x.consumed.toFixed(2)}</td><td style="text-align:right">${x.wastagePct.toFixed(1)}%</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><title>Fabric Inventory Report</title><style>
    body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}
    h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px}
    .sub{font-size:11px;color:#666;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left}
    th{background:#f3f3f3}
    @media print{body{padding:0}}
  </style></head><body>
    <h1>Groovy — Fabric Inventory Report</h1>
    <div class="sub">Generated ${new Date().toLocaleString('en-GB')}</div>
    <h2>Stock on hand</h2>
    <table><thead><tr><th>Fabric</th><th style="text-align:right">Stock</th><th style="text-align:right">Rolls</th><th>Alert</th></tr></thead><tbody>${stockRows||'<tr><td colspan="4">No stock</td></tr>'}</tbody></table>
    <h2>Per-PO wastage</h2>
    <table><thead><tr><th>PO</th><th style="text-align:right">Issued</th><th style="text-align:right">Consumed</th><th style="text-align:right">Wastage %</th></tr></thead><tbody>${waste||'<tr><td colspan="4">No issued fabric</td></tr>'}</tbody></table>
    <script>window.addEventListener('load',function(){setTimeout(function(){window.print();},250);});<\/script>
  </body></html>`);
  w.document.close();
};

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

function renderFabricPage(){
  return`<div class="page-head"><div class="page-title">Fabric Inventory</div></div>
  <div class="gp-tabs">
    <button class="gp-tab" id="fabtab-stock" onclick="window.switchFabTab('stock')">Stock</button>
    <button class="gp-tab" id="fabtab-fabricin" onclick="window.switchFabTab('fabricin')">Fabric In</button>
    <button class="gp-tab" id="fabtab-issue" onclick="window.switchFabTab('issue')">Issue</button>
    <button class="gp-tab" id="fabtab-returns" onclick="window.switchFabTab('returns')">Returns</button>
    <button class="gp-tab" id="fabtab-reports" onclick="window.switchFabTab('reports')">Reports</button>
  </div>
  <div id="fab-tab-content"></div>`;
}

window.switchFabTab=function(tab){
  fabActiveTab=tab;
  ['stock','fabricin','issue','returns','reports'].forEach(t=>{
    const b=document.getElementById('fabtab-'+t);
    if(b)b.classList.toggle('active',t===tab);
  });
  const el=document.getElementById('fab-tab-content');
  if(!el)return;
  if(tab==='stock'){_fabInvDrillKey=null;el.innerHTML=renderFabricInventory();}
  else el.innerHTML=_fabPlaceholder(tab);
};

function _fabPlaceholder(tab){
  const map={
    fabricin:['Fabric In','Receiving + roll barcoding moves here in Phase 2. For now use Gate Pass → Fabric In.'],
    issue:['Issue','Scanner-first roll issuing (PO required) lands in Phase 3. For now use Gate Pass → Outward.'],
    returns:['Returns','Vendor→Stock and To-Supplier returns land in Phase 4.'],
    reports:['Reports','Stock / movement / wastage exports (Excel + PDF) land in Phase 6.']
  };
  const [title,msg]=map[tab]||['Coming soon',''];
  return`<div class="card" style="padding:28px;text-align:center">
    <div class="card-title" style="justify-content:center">${title}</div>
    <div class="empty" style="padding:8px 0 0">${msg}</div>
  </div>`;
}

// ── Stock tab (moved from store.js — behaviour unchanged) ──
function renderFabricInventory(){
  if(_fabInvDrillKey){return _renderFabInvDrill(_fabInvDrillKey);}
  const aggregates=allFabricInventory.filter(s=>s);
  const totalKg=aggregates.filter(s=>(s.unit||'kg')==='kg').reduce((a,s)=>a+(s.totalWeight||0),0);
  const totalM=aggregates.filter(s=>(s.unit||'kg')==='meters'||(s.unit||'kg')==='m').reduce((a,s)=>a+(s.totalWeight||0),0);
  const totalRolls=aggregates.reduce((a,s)=>a+(s.rollsCount||0),0);
  const filtered=aggregates.filter(s=>{
    if(_fabInvFilter==='in_stock'&&!(s.totalWeight>0))return false;
    if(_fabInvFilter==='empty'&&(s.totalWeight>0))return false;
    if(_fabInvSearchQ){
      const q=_fabInvSearchQ.toLowerCase();
      const hay=`${s.fabType||''} ${s.color||''} ${s.gsm||''}`.toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  }).sort((a,b)=>(b.lastMovementAt||0)-(a.lastMovementAt||0));
  let h=`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><div class="page-title">Fabric Inventory</div><div class="page-sub">${aggregates.length} stock rows · ${totalRolls} rolls · ${totalKg.toFixed(1)} kg${totalM?' · '+totalM.toFixed(1)+' m':''}</div></div>
  </div>`;
  h+=`<div class="card" style="margin-bottom:14px;padding:12px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${[['in_stock','In stock'],['empty','Out of stock'],['all','All']].map(([k,l])=>`<button onclick="window.fabInvSetFilter('${k}')" style="padding:6px 12px;border:1px solid ${_fabInvFilter===k?'var(--dark)':'var(--border)'};border-radius:999px;background:${_fabInvFilter===k?'var(--dark)':'#fff'};color:${_fabInvFilter===k?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit">${l}</button>`).join('')}
      </div>
      <input id="finv-search" placeholder="Search fabric type / color / GSM…" value="${_fabInvSearchQ.replace(/"/g,'&quot;')}" oninput="window.fabInvSetSearch(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;outline:none;flex:1;min-width:200px">
    </div>
  </div>`;
  if(!filtered.length){
    h+=`<div class="empty" style="padding:24px;text-align:center">No fabric inventory rows match.</div>`;
  }else{
    h+=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff">
      <thead><tr style="background:#fafafa;border-bottom:1px solid var(--border)">
        <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Fabric</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">GSM</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Color</th>
        <th style="padding:10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Stock</th>
        <th style="padding:10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Rolls</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Last move</th>
        <th></th>
      </tr></thead>
      <tbody>${filtered.map(s=>{
        const empty=!(s.totalWeight>0);
        return`<tr style="border-bottom:1px solid #f5f5f5${empty?';opacity:.55':''}">
          <td style="padding:10px;font-weight:600">${_gpEsc(s.fabType||'—')}</td>
          <td style="padding:10px">${s.gsm||'—'}</td>
          <td style="padding:10px">${_gpEsc(s.color||'—')}</td>
          <td style="padding:10px;text-align:right;font-weight:700;color:${empty?'#dc2626':'var(--text)'}">${(s.totalWeight||0).toFixed(2)} ${s.unit||'kg'}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${s.rollsCount||0}</td>
          <td style="padding:10px;font-size:11px;color:var(--muted)">${s.lastMovementAt?new Date(s.lastMovementAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}):'—'}</td>
          <td style="padding:10px;text-align:right"><button onclick="window.fabInvDrill('${s._id}')" style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Open</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }
  return h+'<div style="height:80px"></div>';
}

function _renderFabInvDrill(key){
  const s=allFabricInventory.find(x=>x._id===key);
  if(!s){return`<div class="page-head"><div class="page-title">Not found</div></div><button class="btn-outline" onclick="window.fabInvDrill(null)">← Back</button>`;}
  const movements=allFabricMovements.filter(m=>_fabInvKey(m.fabType,m.gsm,m.color)===key).slice(0,80);
  const rolls=(s.rolls||[]).slice().sort((a,b)=>(a.status==='in_stock'?-1:1)-(b.status==='in_stock'?-1:1));
  return`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><div class="page-title">${_gpEsc(s.fabType||'—')} · ${s.gsm||0}gsm · ${_gpEsc(s.color||'—')}</div>
      <div class="page-sub">${(s.totalWeight||0).toFixed(2)} ${s.unit||'kg'} in stock · ${s.rollsCount||0} rolls · ${rolls.length} total rolls ever received</div></div>
    <button class="btn-outline" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.fabInvDrill(null)">← Back to Fabric Inventory</button>
  </div>
  <div class="card" style="margin-bottom:14px"><div class="card-title">Rolls</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Roll Code</th><th style="padding:8px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Weight</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Status</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Source</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Issued to / used by</th></tr></thead>
      <tbody>${rolls.length?rolls.map(r=>{
        const stColor=r.status==='in_stock'?'var(--green)':r.status==='issued'?'#dc2626':r.status==='consumed'?'#92400e':'var(--muted)';
        return`<tr style="border-bottom:1px solid #f5f5f5"><td style="padding:8px;font-weight:700;letter-spacing:.04em">${_gpEsc(r.rollCode||'—')}</td><td style="padding:8px;text-align:right">${r.weight||0} ${r.unit||s.unit||'kg'}</td><td style="padding:8px;color:${stColor};font-weight:600;text-transform:capitalize">${(r.status||'in_stock').replace('_',' ')}</td><td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(r.sourceFabId||'—')}</td><td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(r.issuedTo||r.consumedBy||'—')}</td></tr>`;
      }).join(''):'<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--muted)">No rolls yet.</td></tr>'}</tbody>
    </table></div>
  </div>
  <div class="card"><div class="card-title">Movements (${movements.length})</div>
    ${movements.length?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">When</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Type</th><th style="padding:8px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Qty</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Rolls</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Source</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">By</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Note</th></tr></thead>
      <tbody>${movements.map(m=>{
        const tColor=m.type==='in'?'var(--green)':m.type==='out'?'#dc2626':m.type==='consume'?'#92400e':'var(--muted)';
        return`<tr style="border-bottom:1px solid #f5f5f5">
          <td style="padding:8px">${new Date(m.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
          <td style="padding:8px;color:${tColor};font-weight:700;text-transform:uppercase">${m.type==='in'?'+ IN':m.type==='out'?'− OUT':m.type==='consume'?'− CONSUME':m.type==='return'?'+ RETURN':m.type}</td>
          <td style="padding:8px;text-align:right;font-weight:600">${(m.qty||0).toFixed(2)} ${m.unit||'kg'}</td>
          <td style="padding:8px;font-size:11px;letter-spacing:.04em">${(m.rollCodes||[]).slice(0,3).map(_gpEsc).join(', ')}${(m.rollCodes||[]).length>3?` +${m.rollCodes.length-3}`:''}</td>
          <td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(m.sourceCollection||'')}/${_gpEsc(m.sourceId||'')}</td>
          <td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(m.by||'')}</td>
          <td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(m.note||'')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`:'<div class="empty" style="padding:16px">No movements logged for this fabric yet.</div>'}
  </div>
  <div style="height:80px"></div>`;
}

// Stock handlers re-render into the tab content div so the sub-tabs persist.
window.fabInvSetFilter=function(f){_fabInvFilter=f;const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricInventory();};
window.fabInvSetSearch=function(v){
  _fabInvSearchQ=v||'';
  clearTimeout(window._fabInvSearchTo);
  window._fabInvSearchTo=setTimeout(()=>{
    const m=document.getElementById('fab-tab-content');if(m){m.innerHTML=renderFabricInventory();const i=document.getElementById('finv-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}}
  },180);
};
window.fabInvDrill=function(key){_fabInvDrillKey=key;const m=document.getElementById('fab-tab-content');if(m)m.innerHTML=renderFabricInventory();};

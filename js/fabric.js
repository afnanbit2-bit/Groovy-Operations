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
  else if(tab==='fabricin'){
    fabRollIdx=0;
    el.innerHTML=renderFabricInTab();
    window.addFabRoll();
    renderFabricInList();
  }
  else if(tab==='issue'){
    _fabIssueRolls=[];_fabIssueKey=null;
    el.innerHTML=renderFabricIssueTab();
  }
  else el.innerHTML=_fabPlaceholder(tab);
};

function _fabPlaceholder(tab){
  const map={
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
// Full fabric code for this receipt, e.g. BLKTRY220-01
function _nextFabCode(fabType,gsm,color){
  const base=_fabBaseCode(fabType,gsm,color);
  return `${base}-${_nextFabLot(base)}`;
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
  const fabCode=document.getElementById('fab-code')?.value||_nextFabCode(fabType,gsm,color);
  const rolls=[];
  document.querySelectorAll('#fab-rolls-body .roll-row').forEach(row=>{
    const codeEl=row.querySelector('.fab-roll-code');
    const rollCode=codeEl?.textContent?.trim()||'';
    const weightEl=row.querySelector('.fab-roll-weight');
    const gsmEl=row.querySelector('.fab-roll-gsm');
    const qcEl=row.querySelector('input[type=checkbox]');
    const weight=parseFloat(weightEl?.value)||0;
    const rollGsm=parseInt(gsmEl?.value)||gsm;
    const qcPassed=qcEl?.checked||false;
    if(rollCode)rolls.push({rollCode,rollNumber:rollCode,weight,gsm:rollGsm,unit,qcPassed,qcBy:qcPassed?session.name:'',qcAt:qcPassed?Date.now():null});
  });
  if(!rolls.length){showToast('Add at least one roll.',true);return;}
  if(rolls.some(r=>!r.weight)){showToast('Every roll needs a weight.',true);return;}
  if(rolls.some(r=>!r.gsm)){showToast('Every roll needs a GSM.',true);return;}
  const totalWeight=parseFloat(rolls.reduce((s,r)=>s+r.weight,0).toFixed(2));
  try{
    const next=await getNextId('fabricin');
    const fabId='FAB-'+String(next).padStart(3,'0');
    const payload={id:fabId,fabCode,ts:Date.now(),supplier,date,fabType,gsm,color,receivedBy:session.name,notes,unit,totalWeight,rollsCount:rolls.length,rolls};
    await setDoc(doc(db,'fabricin',fabId),payload);
    allFabricIn.unshift(payload);
    await _fabInvUpsert({fabType,gsm,color,unit,addRolls:rolls.map(r=>({rollCode:r.rollCode,weight:r.weight,gsm:r.gsm,unit:r.unit,sourceFabId:fabId})),sourceCol:'fabricin',sourceId:fabId,note:`Receipt from ${supplier}`});
    await logActivity('Fabric In',`${fabId} (${fabCode}) — ${supplier} · ${fabType} ${gsm}gsm · ${color} · ${rolls.length} rolls · ${totalWeight} ${unit}`);
    showToast(`${fabCode} saved ✓ · added to inventory`);
    window.switchFabTab('fabricin');
  }catch(e){showToast('Error: '+e.message,true);}
};

function renderFabricInList(){
  const body=document.getElementById('fab-list-body');
  if(!body)return;
  if(!allFabricIn.length){body.innerHTML='<div class="empty">No fabric entries yet.</div>';return;}
  body.innerHTML=allFabricIn.map(f=>{
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
        ${rolls.map(r=>{
          const rc=r.rollCode||r.rollNumber||'';
          const rGsm=r.gsm||f.gsm||0;
          return`<div style="display:flex;flex-direction:column;padding:8px 4px;border-bottom:1px solid #f9f9f9;font-size:12px;gap:6px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap">
              <span style="font-weight:600;min-width:128px;letter-spacing:.04em">${rc}</span>
              <span style="flex:1;min-width:80px">${r.weight} ${r.unit||'kg'} · ${rGsm}gsm</span>
              <span style="${r.qcPassed?'color:var(--green);font-weight:600':'color:var(--muted)'}">${r.qcPassed?'QC Passed ✓':'Pending QC'}</span>
              ${r.qcPassed&&r.qcBy?`<span style="font-size:10px;color:var(--muted)">${r.qcBy}</span>`:''}
              <button onclick="event.stopPropagation();window.printRollBarcode('${_gpEsc(rc)}','${_gpEsc(f.fabType||'')}','${rGsm}','${_gpEsc(f.color||'')}','${r.weight} ${r.unit||'kg'}','${_gpEsc(f.supplier||'')}')" style="padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:10px;cursor:pointer;font-family:inherit">🖨 Print</button>
            </div>
            <svg class="fab-roll-barcode-view" data-rc="${_gpEsc(rc)}" style="display:block;height:38px;margin-left:0"></svg>
          </div>`;
        }).join('')||'<div style="font-size:12px;color:var(--muted);padding:6px">No rolls recorded.</div>'}
        <div style="display:flex;gap:6px;justify-content:flex-end;padding:8px 4px 0">
          <button onclick="event.stopPropagation();window.editFabricIn('${f.id}')" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Edit</button>
          <button onclick="event.stopPropagation();window.requestDeleteFabricIn('${f.id}')" style="padding:4px 10px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:11px;cursor:pointer;font-family:inherit">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');}

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

window.printRollBarcode=function(rollCode,fabType,gsm,color,weight,supplier){
  const w=window.open('','_blank','width=400,height=300');
  if(!w){showToast('Allow popups to print barcodes.',true);return;}
  w.document.write(`<!doctype html><html><head><title>${rollCode}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
      body{padding:14px}
      .label{border:1px solid #000;padding:10px 12px;width:280px}
      .row{display:flex;justify-content:space-between;font-size:11px;margin:2px 0}
      .code{font-size:14px;font-weight:700;letter-spacing:.05em;text-align:center;margin-bottom:6px}
      .supplier{font-size:10px;color:#444;text-align:center;margin-bottom:4px}
      svg{display:block;margin:4px auto;width:100%}
      @media print{body{padding:0}.label{border:none}}
    </style></head><body>
    <div class="label">
      <div class="supplier">${supplier||''}</div>
      <div class="code">${rollCode}</div>
      <svg id="bc"></svg>
      <div class="row"><span>Fabric:</span><strong>${fabType||''}</strong></div>
      <div class="row"><span>Color:</span><strong>${color||''}</strong></div>
      <div class="row"><span>GSM:</span><strong>${gsm||''}</strong></div>
      <div class="row"><span>Weight:</span><strong>${weight||''}</strong></div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
    <script>
      window.addEventListener('load',function(){
        try{JsBarcode('#bc','${rollCode}',{format:'CODE128',displayValue:true,fontSize:11,height:40,margin:4,width:1.6});}catch(e){}
        setTimeout(function(){window.print();},300);
      });
    <\/script>
    </body></html>`);
  w.document.close();
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
      <div class="field"><label>Fabric Type *</label><input id="fabe-type" value="${_gpEsc(f.fabType||'')}"></div>
      <div class="field"><label>Color *</label><input id="fabe-color" value="${_gpEsc(f.color||'')}"></div>
      <div class="field"><label>Total Weight</label><input id="fabe-totweight" type="number" min="0" step="0.01" value="${f.totalWeight||0}"></div>
      <div class="field"><label>Unit</label><input id="fabe-unit" value="${_gpEsc(f.unit||'kg')}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Notes</label><textarea id="fabe-notes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px">${_gpEsc(f.notes||'')}</textarea></div>
    <div style="background:#fafafa;padding:8px 12px;border-radius:8px;margin-top:8px;font-size:12px;color:var(--muted)">Note: Roll-level edits aren't supported here. Only header fields can be changed.</div>
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
  return{
    supplier:v('fabe-supplier'),
    date:v('fabe-date'),
    fabType:v('fabe-type'),
    color:v('fabe-color'),
    totalWeight:parseFloat(document.getElementById('fabe-totweight')?.value)||0,
    unit:v('fabe-unit')||'kg',
    notes:v('fabe-notes')
  };
}

window.submitFabricEdit=async function(fabId){
  const f=allFabricIn.find(x=>x.id===fabId);
  if(!f)return showToast('Fabric entry not found.',true);
  const proposed=_collectFabricEditPayload();
  if(!proposed.supplier||!proposed.fabType||!proposed.color)return showToast('Supplier, fabric type and color are required.',true);
  try{
    if(_gpCanApprove()){
      await updateDoc(doc(db,'fabricin',fabId),{...proposed,updatedAt:Date.now(),updatedBy:session.name});
      Object.assign(f,proposed);
      await logActivity('Fabric In edited',`${fabId} by ${session.name}`);
      showToast(fabId+' updated ✓');
    }else{
      const reason=(document.getElementById('fabe-reason')?.value||'').trim();
      if(!reason)return showToast('Reason for change is required.',true);
      const currentData={supplier:f.supplier,date:f.date,fabType:f.fabType,color:f.color,totalWeight:f.totalWeight,unit:f.unit,notes:f.notes};
      await _gpSubmitEditRequest({type:'fabric',targetId:fabId,action:'edit',proposedData:proposed,currentData,reason});
      showToast('Edit request sent for approval ✓');
    }
    window.hrmCloseModal();
    _fabRefreshList();
  }catch(e){showToast('Save failed: '+e.message,true);}
};

window.requestDeleteFabricIn=async function(fabId){
  const f=allFabricIn.find(x=>x.id===fabId);
  if(!f)return showToast('Fabric entry not found.',true);
  if(_gpPendingFor('fabric',fabId))return showToast('A request is already pending for '+fabId,true);
  if(_gpCanApprove()){
    if(!confirm(`Delete ${fabId}? This cannot be undone.`))return;
    try{
      await deleteDoc(doc(db,'fabricin',fabId));
      await logActivity('Fabric In deleted',`${fabId} deleted by ${session.name}`);
      allFabricIn=allFabricIn.filter(x=>x.id!==fabId);
      showToast(`${fabId} deleted`);
      _fabRefreshList();
    }catch(e){showToast('Error: '+e.message,true);}
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

// ════════════════════════════════════════════════════════════════════════
//  Issue (Phase 3) — scanner-first roll issuing to a vendor, PO required.
//  All rolls in one issue must belong to a single fabric stock.
// ════════════════════════════════════════════════════════════════════════
const FAB_DESTINATIONS=['FebKnit','Al-Hamd','Al-Nisa','Aqib Sublimation','JR Traders','Rahim Gul Enterprise','Khursheed Enterprise'];
let _fabIssueRolls=[],_fabIssueKey=null;

function _fabFindRoll(rollCode){
  for(const s of allFabricInventory){const r=(s.rolls||[]).find(x=>x.rollCode===rollCode);if(r)return{stock:s,roll:r};}
  return null;
}

function renderFabricIssueTab(){
  const today=new Date().toISOString().split('T')[0];
  const stocks=allFabricInventory.filter(s=>(s.rolls||[]).some(r=>['in_stock','reserved'].includes(r.status||'in_stock')));
  const pos=(typeof allPOs!=='undefined'&&allPOs)||[];
  return`<div class="card"><div class="card-title">Issue fabric to vendor</div>
    <div class="form-grid">
      <div class="field"><label>Production Order (PO) *</label>
        <select id="fab-iss-po">
          <option value="">Select PO…</option>
          ${pos.map(p=>`<option value="${_gpEsc(p.id)}">${_gpEsc(p.id)} — ${_gpEsc(p.name||'')}${p.fabric?` · ${_gpEsc(p.fabric)}`:''}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Date</label><input id="fab-iss-date" type="date" value="${today}"></div>
      <div class="field" style="grid-column:1/-1"><label>Destination / Vendor *</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
          ${FAB_DESTINATIONS.map(d=>`<button type="button" class="dest-chip" onclick="document.getElementById('fab-iss-dest').value='${d}'">${d}</button>`).join('')}
        </div>
        <input id="fab-iss-dest" placeholder="Vendor name…">
      </div>
    </div>
  </div>
  <div class="card"><div class="card-title">Pick rolls <span style="font-weight:400;color:var(--muted);font-size:11px">scan or select — all from one fabric</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="flex:1;min-width:200px;margin:0"><label>Scan roll barcode</label>
        <input id="fab-iss-scan" placeholder="Scan or type roll code, press Enter" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();window.fabIssueScan();}">
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
  const st=roll.status||'in_stock';
  if(st==='issued'){showToast(code+' is already issued.',true);return;}
  if(st==='returned_supplier'){showToast(code+' was returned to supplier.',true);return;}
  if(_fabIssueRolls.some(r=>r.rollCode===code)){showToast(code+' already selected.',true);return;}
  if(_fabIssueKey&&_fabIssueKey!==stock._id){showToast('All rolls must be from the same fabric. Clear selection to switch.',true);return;}
  const po=document.getElementById('fab-iss-po')?.value||'';
  if(st==='reserved'&&roll.reservedPO&&po&&roll.reservedPO!==po)showToast(code+' is reserved for '+roll.reservedPO+' (issuing anyway).',false);
  if(!roll.qcPassed)showToast(code+' has not passed QC (issuing anyway).',false);
  _fabIssueKey=stock._id;
  _fabIssueRolls.push({rollCode:code,weight:roll.weight||0,status:st});
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
}

window.submitFabricIssue=async function(){
  const po=document.getElementById('fab-iss-po')?.value||'';
  const dest=(document.getElementById('fab-iss-dest')?.value||'').trim();
  const date=document.getElementById('fab-iss-date')?.value||'';
  if(!po){showToast('Select a PO (required).',true);return;}
  if(!dest){showToast('Destination/vendor is required.',true);return;}
  if(!_fabIssueRolls.length){showToast('Select at least one roll.',true);return;}
  const stock=allFabricInventory.find(s=>s._id===_fabIssueKey);
  if(!stock){showToast('Fabric stock not found.',true);return;}
  const rollCodes=_fabIssueRolls.map(r=>r.rollCode);
  const fabUnit=stock.unit||'kg';
  const fabQty=parseFloat(_fabIssueRolls.reduce((s,r)=>s+(r.weight||0),0).toFixed(2));
  try{
    const next=await getNextId('gatepasses');
    const gpId='GP-'+String(next).padStart(3,'0');
    const article=`${stock.fabType} ${stock.gsm||0}gsm ${stock.color}`;
    const payload={id:gpId,ts:Date.now(),name:session.name,issuer:session.name,article,spec:`PO ${po} · ${rollCodes.length} rolls`,dest,date,gpType:'fabric',poId:po,fabricUnit:fabUnit,fabricQty:fabQty,rollsCount:rollCodes.length,rollCodes,fabricType:stock.fabType,fabricGsm:stock.gsm,fabricColor:stock.color,inventoryKey:stock._id,boras:'0',items:[],totalUnits:0,totalWeight:fabUnit==='kg'?fabQty:0,totalLength:fabUnit==='meters'?fabQty:0};
    await setDoc(doc(db,'gatepasses',gpId),payload);
    await _fabInvUpsert({fabType:stock.fabType,gsm:stock.gsm,color:stock.color,unit:fabUnit,removeRollCodes:rollCodes,reservePO:po,note:`Issued to ${dest} for ${po}`,sourceCol:'gatepasses',sourceId:gpId});
    await logActivity('Fabric issued',`${gpId} — ${rollCodes.length} rolls of ${article} to ${dest} for ${po}`);
    showToast(`${gpId} issued ✓ · ${rollCodes.length} rolls`);
    _fabIssueRolls=[];_fabIssueKey=null;
    if(typeof loadData==='function')await loadData();
    window.switchFabTab('issue');
  }catch(e){showToast('Error: '+e.message,true);}
};

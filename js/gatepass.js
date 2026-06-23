/* Groovy Operations — gatepass.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */


window.filterGPArticle=function(q){
  const dd=document.getElementById('gp-article-dd');if(!dd)return;
  q=(q||'').toLowerCase().trim();
  if(!q){dd.style.display='none';return;}
  const hits=PRODUCT_CATALOG.filter(p=>p.code.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)).slice(0,18);
  if(!hits.length){dd.innerHTML='<div style="padding:10px 12px;font-size:12px;color:var(--muted)">No matches found</div>';dd.style.display='block';return;}
  dd.innerHTML=hits.map(p=>`<div class="prod-opt" data-code="${p.code}" data-name="${p.name.replace(/"/g,'&quot;')}" style="padding:10px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f3f4f6;display:flex;gap:10px;align-items:baseline"><span style="font-weight:700;color:var(--dark);min-width:80px;font-size:12px">${p.code}</span><span style="color:var(--text)">${p.name}</span></div>`).join('');
  dd.style.display='block';
  dd.querySelectorAll('.prod-opt').forEach(el=>el.addEventListener('mousedown',e=>{
    e.preventDefault();
    document.getElementById('gp-article').value=el.dataset.code+' — '+el.dataset.name;
    dd.style.display='none';
  }));
};

function renderGatePass(){
  return`<div class="page-head"><div class="page-title">Gate Pass</div></div>
  <div id="gp-pending-approvals">${_renderGPPendingApprovals()}</div>
  <div class="gp-tabs">
    <button class="gp-tab" id="gptab-outward" onclick="window.switchGPTab('outward')">Outward</button>
    <button class="gp-tab" id="gptab-returns" onclick="window.switchGPTab('returns')">Returns</button>
  </div>
  <div id="gp-tab-content"></div>`;
}

function renderOutward(){
  return`<div class="card"><div class="card-title">Issue new pass</div>
    <div class="form-grid">
      <div class="field"><label>Person name</label><input id="gp-name" value="${session.name}" readonly style="background:#f0f0f0;cursor:default"></div>
      <div class="field"><label>Date</label><input id="gp-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="field"><label>Pass type *</label>
        <select id="gp-type" onchange="window.onGPTypeChange()" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#FAFAFA;color:var(--text);font-family:inherit;outline:none;width:100%">
          <option value="garments">Garments — by units (pcs)</option>
        </select>
      </div>
      <div class="field" style="position:relative"><label>Article name *</label>
        <input id="gp-article" placeholder="Type to search e.g. GH001 or Black Hoodie…" autocomplete="off" oninput="window.filterGPArticle(this.value)" onfocus="window.filterGPArticle(this.value)">
        <div id="gp-article-dd" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:300;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.13);max-height:220px;overflow-y:auto;margin-top:3px"></div>
      </div>
      <div class="field"><label>Specification *</label>
        <input id="gp-spec" placeholder="e.g. color / GSM / lot / variant — required">
      </div>
      <div class="field"><label>Destination *</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
          <button type="button" class="dest-chip" onclick="window.setDest('FebKnit')">FebKnit</button>
          <button type="button" class="dest-chip" onclick="window.setDest('Al-Hamd')">Al-Hamd</button>
          <button type="button" class="dest-chip" onclick="window.setDest('Al-Nisa')">Al-Nisa</button>
          <button type="button" class="dest-chip" onclick="window.setDest('Aqib Sublimation')">Aqib Sublimation</button>
          <button type="button" class="dest-chip" onclick="window.setDest('JR Traders')">JR Traders</button>
          <button type="button" class="dest-chip" onclick="window.setDest('Rahim Gul Enterprise')">Rahim Gul Enterprise</button>
          <button type="button" class="dest-chip" onclick="window.setDest('Khursheed Enterprise')">Khursheed Enterprise</button>
        </div>
        <input id="gp-dest" placeholder="Or type destination…">
      </div>
      <div class="field"><label>Purpose</label><input id="gp-purpose" placeholder="Reason for dispatch"></div>
      <div class="field"><label>Time</label><input id="gp-time" type="time" value="${new Date().toTimeString().slice(0,5)}"></div>
    </div>
  </div>
  <div class="card" id="gp-garments-card"><div class="card-title">Units by size</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:300px">
      <thead><tr style="background:var(--dark)"><th style="width:28px;padding:8px 4px"></th><th style="padding:8px 10px;text-align:left;color:rgba(255,255,255,.55);font-size:10px;font-weight:500;text-transform:uppercase">Size</th><th style="padding:8px 10px;text-align:left;color:rgba(255,255,255,.55);font-size:10px;font-weight:500;text-transform:uppercase">Units (pcs)</th><th style="padding:8px 10px;text-align:left;color:rgba(255,255,255,.55);font-size:10px;font-weight:500;text-transform:uppercase">Weight (kg)</th><th style="width:36px"></th></tr></thead>
      <tbody id="gp-body"></tbody>
    </table></div>
    <div style="display:flex;align-items:center;border-top:1px solid var(--border)">
      <button onclick="window.addGPRow()" style="flex:1;padding:9px;background:none;border:none;font-size:12px;color:var(--muted);cursor:pointer;font-family:inherit">+ Add size</button>
      <button onclick="window._gpDeleteSelectedSizeRows()" style="padding:9px 14px;background:none;border:none;border-left:1px solid var(--border);font-size:12px;color:#dc2626;cursor:pointer;font-family:inherit">✕ Delete selected</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px">
      <div style="background:var(--dark);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.06em">Total units</div><div id="gp-t-units" style="font-size:18px;font-weight:700;color:#fff">0 pcs</div></div>
      <div style="background:var(--dark);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.06em">Total weight</div><div id="gp-t-weight" style="font-size:18px;font-weight:700;color:#fff">0 kg</div></div>
      <div style="background:var(--red);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.06em">Total boras</div><div><input id="gp-boras" type="number" min="0" placeholder="0" style="background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,.35);color:#fff;font-size:18px;font-weight:700;width:60px;text-align:center;padding:0;border-radius:0;outline:none"></div></div>
    </div>
  </div>
  <div class="card" id="gp-fabric-card" style="display:none"><div class="card-title">Fabric details</div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Pick from fabric stock *</label>
        <select id="gp-fab-stock" onchange="window.onGPFabStockPick()" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#FAFAFA;color:var(--text);font-family:inherit;outline:none;width:100%">
          <option value="">— pick a fabric in stock —</option>
        </select>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Choose specific rolls below to deduct from inventory.</div>
      </div>
      <div class="field" style="grid-column:1/-1" id="gp-fab-rolls-pick-wrap"></div>
      <div class="field"><label>Total <span id="gp-fab-unit-label">weight (kg)</span> *</label>
        <input id="gp-fab-qty" type="number" min="0" step="0.01" placeholder="0" readonly style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#eef2ff;color:var(--text);font-family:inherit;outline:none;width:100%;font-weight:700">
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Auto-summed from selected rolls.</div>
      </div>
      <div class="field"><label>Roll count</label>
        <input id="gp-fab-rolls" type="number" min="0" placeholder="0" readonly style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#eef2ff;color:var(--text);font-family:inherit;outline:none;width:100%;font-weight:700">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
      <div style="background:var(--dark);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.06em">Total <span id="gp-fab-tot-label">weight</span></div><div id="gp-fab-tot-display" style="font-size:18px;font-weight:700;color:#fff">0 kg</div></div>
      <div style="background:var(--dark);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.06em">Rolls</div><div id="gp-fab-rolls-display" style="font-size:18px;font-weight:700;color:#fff">0</div></div>
    </div>
  </div>
  <button class="btn-primary" onclick="window.submitGP()">Submit gate pass</button>
  <div class="card" style="margin-top:12px"><div class="card-title">Gate passes <span id="gp-count-lbl" style="font-weight:400;color:var(--muted);font-size:12px"></span></div>
    <div id="gp-list-body"></div>
    <div id="gp-pagination" style="display:flex;align-items:center;justify-content:center;gap:10px;padding-top:10px;border-top:1px solid #f5f5f5;margin-top:4px"></div>
  </div><div style="height:80px"></div>`;
}

function renderReturnsTab(){
  const today=new Date().toISOString().split('T')[0];
  return`<div class="card"><div class="card-title">Record return</div>
    <div class="form-grid">
      <div class="field"><label>Original GP Number *</label>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <input id="ret-gp-num" placeholder="e.g. GP-001" style="flex:1" oninput="window.lookupReturnGP()">
          <span id="ret-gp-status" style="font-size:11px;padding-bottom:10px;white-space:nowrap;flex-shrink:0"></span>
        </div>
      </div>
      <div class="field"><label>Return Date</label><input id="ret-date" type="date" value="${today}"></div>
      <div class="field" style="grid-column:1/-1"><label>Vendor *</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
          <button type="button" class="dest-chip" onclick="window.setRetVendor('Febknit')">Febknit</button>
          <button type="button" class="dest-chip" onclick="window.setRetVendor('Al Hamd')">Al Hamd</button>
          <button type="button" class="dest-chip" onclick="window.setRetVendor('Al Nisa')">Al Nisa</button>
        </div>
        <input id="ret-vendor" placeholder="Or type vendor name…">
      </div>
      <div class="field"><label>Article Name</label><input id="ret-article" placeholder="Auto-filled or enter manually"></div>
      <div class="field"><label>Sent Qty (pcs)</label><input id="ret-sent-qty" type="number" min="0" placeholder="Auto-filled or enter" oninput="window.calcReturnStatus()"></div>
      <div class="field"><label>Returned Qty (pcs) *</label><input id="ret-qty" type="number" min="0" placeholder="0" oninput="window.calcReturnStatus()"></div>
      <div class="field"><label>Received By</label><input value="${session.name}" readonly style="background:#f0f0f0;cursor:default"></div>
    </div>
    <div id="ret-status-preview" style="margin:10px 0"></div>
    <div id="ret-reason-wrap" style="display:none;margin-bottom:8px" class="field"><label>Reason for shortage *</label><input id="ret-reason" placeholder="Required for incomplete returns"></div>
    <div class="field" style="margin-top:4px"><label>Notes</label><textarea id="ret-notes" rows="2" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#FAFAFA;color:var(--text);font-family:inherit;outline:none;width:100%;resize:vertical" placeholder="Optional notes"></textarea></div>
    <button class="btn-primary" style="margin-top:10px" onclick="window.submitReturn()">Save Return</button>
  </div>
  <div class="card" style="margin-top:12px"><div class="card-title">Returns history</div>
    <div id="ret-list-body"></div>
  </div>
  <div style="height:80px"></div>`;
}

function renderGPPage(){
  const PER=15;
  const total=allPasses.length;
  const pages=Math.max(1,Math.ceil(total/PER));
  if(gpPage>pages)gpPage=pages;
  const slice=allPasses.slice((gpPage-1)*PER,gpPage*PER);
  const body=document.getElementById('gp-list-body');
  const pg=document.getElementById('gp-pagination');
  const lbl=document.getElementById('gp-count-lbl');
  if(!body)return;
  if(lbl)lbl.textContent=total?`(${total} total)`:'';
  body.innerHTML=slice.map(p=>{
    const pend=_gpPendingFor('gp',p.id);
    const pendBadge=pend?`<span title="${pend.action==='delete'?'Delete':'Edit'} pending approval" style="display:inline-block;background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;margin-left:6px">${pend.action==='delete'?'Delete':'Edit'} pending</span>`:'';
    const isFab=p.gpType==='fabric';
    const fabBadge=isFab?`<span style="display:inline-block;background:#dbeafe;color:#1e40af;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;margin-left:6px">Fabric</span>`:'';
    const qtyLabel=isFab?`${p.fabricQty||0} ${p.fabricUnit||'kg'}${p.rollsCount?` · ${p.rollsCount} rolls`:''}`:`${p.totalUnits||0} pcs`;
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f5f5f5;flex-wrap:wrap;gap:8px">
    <div><div style="font-weight:700;color:var(--red);font-size:11px">${p.id}${fabBadge}${pendBadge}</div><div style="font-size:13px;font-weight:500">${p.article||'—'}${p.spec?` <span style="font-weight:400;color:var(--muted)">· ${_gpEsc(p.spec)}</span>`:''}</div><div style="font-size:11px;color:var(--muted)">${p.name||'—'} · ${p.date||''} · ${p.dest||'—'}</div></div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><div style="text-align:right;font-size:12px;color:var(--muted);font-weight:500">${qtyLabel}</div>
    <button class="btn-pdf" onclick="window.generateGPPdf('${p.id}')">⬇ PDF</button>
    <button onclick="window.editGP('${p.id}')" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Edit</button>
    <button onclick="window.requestDeleteGP('${p.id}')" style="padding:4px 10px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:11px;cursor:pointer;font-family:inherit">Delete</button>
    </div>
  </div>`;}).join('')||'<div class="empty" style="padding:1rem">No gate passes yet.</div>';
  if(pg){
    if(pages<=1){pg.innerHTML='';return;}
    pg.innerHTML=`
      <button onclick="window.gpGotoPage(${gpPage-1})" ${gpPage===1?'disabled':''} style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit;color:var(--text)">← Prev</button>
      <span style="font-size:12px;color:var(--muted)">Page ${gpPage} of ${pages}</span>
      <button onclick="window.gpGotoPage(${gpPage+1})" ${gpPage===pages?'disabled':''} style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit;color:var(--text)">Next →</button>`;
  }
}
window.gpGotoPage=function(n){gpPage=n;renderGPPage();};
window.setDest=function(v){document.getElementById('gp-dest').value=v;};
window.addGPRow=function(size='',units='',weight=''){
  gpRowIdx++;const id='gpr'+gpRowIdx;const tr=document.createElement('tr');tr.id=id;tr.style.borderBottom='1px solid #f5f5f5';
  tr.innerHTML=`<td style="padding:4px 6px;width:28px"><input type="checkbox" class="gp-size-chk" style="cursor:pointer;width:15px;height:15px"></td><td style="padding:4px 6px"><input type="text" value="${size}" placeholder="e.g. M" style="width:68px;border:none;border-bottom:1px solid var(--border);padding:5px 4px;font-size:13px;background:transparent;color:var(--text);outline:none" onchange="window.gpRecalc()"></td><td style="padding:4px 6px"><input type="number" data-role="units" value="${units}" min="0" placeholder="0" style="width:68px;border:none;border-bottom:1px solid var(--border);padding:5px 4px;font-size:13px;background:transparent;color:var(--text);outline:none" oninput="window.gpRecalc()"></td><td style="padding:4px 6px"><input type="number" data-role="weight" value="${weight}" min="0" step="0.1" placeholder="0" style="width:68px;border:none;border-bottom:1px solid var(--border);padding:5px 4px;font-size:13px;background:transparent;color:var(--text);outline:none" oninput="window.gpRecalc()"></td><td><button onclick="document.getElementById('${id}').remove();window.gpRecalc()" style="background:none;border:none;color:#ccc;font-size:16px;cursor:pointer;padding:2px 6px">×</button></td>`;
  document.getElementById('gp-body')?.appendChild(tr);window.gpRecalc();
};
window.gpRecalc=function(){let u=0,w=0;document.querySelectorAll('#gp-body tr').forEach(r=>{const ui=r.querySelector('input[data-role="units"]');const wi=r.querySelector('input[data-role="weight"]');u+=parseFloat(ui?.value)||0;w+=parseFloat(wi?.value)||0;});document.getElementById('gp-t-units').textContent=Math.round(u)+' pcs';document.getElementById('gp-t-weight').textContent=w.toFixed(1)+' kg';};
window._gpDeleteSelectedSizeRows=function(){
  const checked=[...document.querySelectorAll('#gp-body .gp-size-chk:checked')];
  if(!checked.length)return showToast('No rows selected — check a row first.',true);
  if(!confirm(`Delete ${checked.length} row${checked.length>1?'s':''}?`))return;
  checked.forEach(cb=>cb.closest('tr').remove());
  window.gpRecalc();
};

window.onGPTypeChange=function(){
  const t=document.getElementById('gp-type')?.value||'garments';
  const garmCard=document.getElementById('gp-garments-card');
  const fabCard=document.getElementById('gp-fabric-card');
  const isFab=t==='fabric_kg'||t==='fabric_m';
  if(garmCard)garmCard.style.display=isFab?'none':'block';
  if(fabCard)fabCard.style.display=isFab?'block':'none';
  if(isFab){
    const unit=t==='fabric_kg'?'kg':'meters';
    const labelTxt=t==='fabric_kg'?'weight (kg)':'length (meters)';
    const totLbl=t==='fabric_kg'?'weight':'length';
    const lblEl=document.getElementById('gp-fab-unit-label');if(lblEl)lblEl.textContent=labelTxt;
    const totLblEl=document.getElementById('gp-fab-tot-label');if(totLblEl)totLblEl.textContent=totLbl;
    _populateFabStockSelect(unit);
    _gpOutwardFabRolls=[];
    document.getElementById('gp-fab-rolls-pick-wrap').innerHTML='';
    window.gpFabRecalc();
  }
};

function _populateFabStockSelect(unit){
  const sel=document.getElementById('gp-fab-stock');
  if(!sel)return;
  const stocks=allFabricInventory.filter(s=>(s.unit||'kg')===unit&&(s.totalWeight||0)>0);
  sel.innerHTML=`<option value="">— pick a fabric in stock —</option>`+
    stocks.map(s=>`<option value="${s._id}">${s.fabType} · ${s.gsm||0}gsm · ${s.color} — ${s.totalWeight} ${s.unit||'kg'} · ${s.rollsCount||0} rolls</option>`).join('');
  if(!stocks.length){sel.innerHTML+=`<option disabled>No fabric in stock for this unit</option>`;}
}

window.onGPFabStockPick=function(){
  const key=document.getElementById('gp-fab-stock')?.value||'';
  const wrap=document.getElementById('gp-fab-rolls-pick-wrap');
  _gpOutwardFabRolls=[];
  if(!key||!wrap){if(wrap)wrap.innerHTML='';window.gpFabRecalc();return;}
  const stock=allFabricInventory.find(s=>s._id===key);
  if(!stock){wrap.innerHTML='';window.gpFabRecalc();return;}
  const inStock=(stock.rolls||[]).filter(r=>r.status==='in_stock');
  if(!inStock.length){wrap.innerHTML='<div style="font-size:12px;color:var(--muted);padding:8px">No in-stock rolls.</div>';window.gpFabRecalc();return;}
  wrap.innerHTML=`<label>Select rolls to issue (${inStock.length} in stock)</label>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;max-height:240px;overflow-y:auto;padding:8px;background:#fafafa;border:1px solid var(--border);border-radius:8px">
      ${inStock.map(r=>`<label style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer">
        <input type="checkbox" data-roll="${_gpEsc(r.rollCode)}" data-weight="${r.weight||0}" onchange="window.onGPFabRollToggle()" style="margin:0">
        <span style="font-weight:700;letter-spacing:.04em">${r.rollCode}</span>
        <span style="color:var(--muted)">${r.weight||0} ${stock.unit||'kg'}</span>
      </label>`).join('')}
    </div>
    <div style="margin-top:6px;display:flex;gap:6px">
      <button type="button" onclick="window.gpFabRollSelectAll(true)" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-family:inherit">Select all</button>
      <button type="button" onclick="window.gpFabRollSelectAll(false)" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-family:inherit">Clear</button>
    </div>`;
  window.gpFabRecalc();
};

window.gpFabRollSelectAll=function(check){
  document.querySelectorAll('#gp-fab-rolls-pick-wrap input[type=checkbox]').forEach(cb=>{cb.checked=!!check;});
  window.onGPFabRollToggle();
};

window.onGPFabRollToggle=function(){
  _gpOutwardFabRolls=[];
  let totQty=0;
  document.querySelectorAll('#gp-fab-rolls-pick-wrap input[type=checkbox]:checked').forEach(cb=>{
    const code=cb.dataset.roll;const w=parseFloat(cb.dataset.weight)||0;
    _gpOutwardFabRolls.push({rollCode:code,weight:w});totQty+=w;
  });
  const qtyInp=document.getElementById('gp-fab-qty');if(qtyInp)qtyInp.value=totQty.toFixed(2);
  const rollsInp=document.getElementById('gp-fab-rolls');if(rollsInp)rollsInp.value=_gpOutwardFabRolls.length;
  window.gpFabRecalc();
};

window.gpFabRecalc=function(){
  const t=document.getElementById('gp-type')?.value||'garments';
  const unit=t==='fabric_m'?'meters':'kg';
  const qty=parseFloat(document.getElementById('gp-fab-qty')?.value)||0;
  const rolls=parseInt(document.getElementById('gp-fab-rolls')?.value)||0;
  const tot=document.getElementById('gp-fab-tot-display');
  const rollsDisp=document.getElementById('gp-fab-rolls-display');
  if(tot)tot.textContent=qty.toFixed(2)+' '+unit;
  if(rollsDisp)rollsDisp.textContent=String(rolls);
};

window.submitGP=async function(){
  const article=document.getElementById('gp-article')?.value.trim(),dest=document.getElementById('gp-dest')?.value.trim();
  const spec=document.getElementById('gp-spec')?.value.trim()||'';
  if(!article||!dest){showToast('Article and destination required.',true);return;}
  if(!spec){showToast('Specification is required.',true);return;}
  const gpType=document.getElementById('gp-type')?.value||'garments';
  const isFabric=gpType==='fabric_kg'||gpType==='fabric_m';
  let payload;
  let inventoryUpdate=null;
  try{
    const next=await getNextId('gatepasses');
    const gpId='GP-'+String(next).padStart(3,'0');
    const base={id:gpId,ts:Date.now(),name:session.name,issuer:session.name,article,spec,dest,date:document.getElementById('gp-date')?.value,time:document.getElementById('gp-time')?.value,purpose:document.getElementById('gp-purpose')?.value?.trim()||''};
    if(isFabric){
      const fabUnit=gpType==='fabric_m'?'meters':'kg';
      const stockKey=document.getElementById('gp-fab-stock')?.value||'';
      if(!stockKey){showToast('Pick a fabric stock row.',true);return;}
      if(!_gpOutwardFabRolls.length){showToast('Select at least one roll to issue.',true);return;}
      const stock=allFabricInventory.find(s=>s._id===stockKey);
      if(!stock){showToast('Fabric stock not found.',true);return;}
      const fabQty=parseFloat(document.getElementById('gp-fab-qty')?.value)||0;
      const rollsCount=_gpOutwardFabRolls.length;
      const rollCodes=_gpOutwardFabRolls.map(r=>r.rollCode);
      payload={...base,gpType:'fabric',fabricUnit:fabUnit,fabricQty:fabQty,rollsCount,rollCodes,fabricType:stock.fabType,fabricGsm:stock.gsm,fabricColor:stock.color,inventoryKey:stockKey,boras:'0',items:[],totalUnits:0,totalWeight:fabUnit==='kg'?fabQty:0,totalLength:fabUnit==='meters'?fabQty:0};
      inventoryUpdate={fabType:stock.fabType,gsm:stock.gsm,color:stock.color,unit:stock.unit||fabUnit,removeRollCodes:rollCodes,note:`Outward to ${dest}`,sourceCol:'gatepasses',sourceId:gpId};
    }else{
      const items=[];document.querySelectorAll('#gp-body tr').forEach(r=>{const i=r.querySelectorAll('input'),sz=i[0]?.value.trim();if(sz)items.push({size:sz,units:parseFloat(i[1]?.value)||0,weight:parseFloat(i[2]?.value)||0});});
      if(!items.length){showToast('Add at least one size row.',true);return;}
      payload={...base,gpType:'garments',boras:document.getElementById('gp-boras')?.value||'0',totalUnits:items.reduce((s,r)=>s+r.units,0),totalWeight:items.reduce((s,r)=>s+r.weight,0).toFixed(1),items};
    }
    await setDoc(doc(db,'gatepasses',gpId),payload);
    if(inventoryUpdate){
      await _fabInvUpsert(inventoryUpdate);
    }
    await logActivity('Gate pass issued',`${gpId} — ${article} to ${dest}${isFabric?' (fabric · '+_gpOutwardFabRolls.length+' rolls)':''}`);
    showToast(gpId+' issued ✓');await loadData();window.showPage('gatepass');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Gate Pass tab switcher ──
window.switchGPTab=function(tab){
  gpActiveTab=tab;
  document.querySelectorAll('.gp-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('gptab-'+tab)?.classList.add('active');
  const el=document.getElementById('gp-tab-content');
  if(!el)return;
  if(tab==='outward'){
    gpRowIdx=0;
    el.innerHTML=renderOutward();
    ['XS','S','M','L','XL','2XL'].forEach(s=>window.addGPRow(s,'',''));
    renderGPPage();
  }else if(tab==='returns'){
    el.innerHTML=renderReturnsTab();
    renderReturnsList();
  }
};

// ── Returns ──
window.setRetVendor=function(v){document.getElementById('ret-vendor').value=v;};

window.lookupReturnGP=function(){
  const gpNum=(document.getElementById('ret-gp-num')?.value||'').trim().toUpperCase();
  const statusEl=document.getElementById('ret-gp-status');
  if(!gpNum){if(statusEl)statusEl.textContent='';return;}
  const gp=allPasses.find(p=>p.id===gpNum);
  if(gp){
    const artEl=document.getElementById('ret-article');
    const sentEl=document.getElementById('ret-sent-qty');
    if(artEl&&!artEl.value)artEl.value=gp.article||'';
    if(sentEl&&!sentEl.value)sentEl.value=gp.totalUnits||'';
    if(statusEl){statusEl.textContent='✓ Found';statusEl.style.color='var(--green)';}
    window.calcReturnStatus();
  }else{
    if(statusEl){statusEl.textContent='Not found';statusEl.style.color='var(--muted)';}
  }
};

window.calcReturnStatus=function(){
  const sent=parseFloat(document.getElementById('ret-sent-qty')?.value)||0;
  const returned=parseFloat(document.getElementById('ret-qty')?.value)||0;
  const preview=document.getElementById('ret-status-preview');
  const reasonWrap=document.getElementById('ret-reason-wrap');
  if(!preview)return;
  if(!sent||!returned){preview.innerHTML='';if(reasonWrap)reasonWrap.style.display='none';return;}
  const tolerance=Math.ceil(sent*0.01);
  if(returned>sent){
    preview.innerHTML=`<div style="background:#fee2e2;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px"><span class="ret-badge ret-overage">Overage 🔴</span><span style="font-size:12px;color:#991b1b">Returned ${returned-sent} more than sent. Please verify.</span></div>`;
    if(reasonWrap)reasonWrap.style.display='none';
  }else if(returned>=sent-tolerance){
    preview.innerHTML=`<div style="background:#EFEFEF;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px"><span class="ret-badge ret-complete">Complete ✅</span><span style="font-size:12px;color:#111">Return complete. Tolerance ±${tolerance} pcs.</span></div>`;
    if(reasonWrap)reasonWrap.style.display='none';
  }else{
    const shortage=sent-returned;
    preview.innerHTML=`<div style="background:#fee2e2;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px"><span class="ret-badge ret-incomplete">Incomplete Lot 🔴</span><span style="font-size:12px;color:#991b1b">Short by ${shortage} pcs. Reason required.</span></div>`;
    if(reasonWrap)reasonWrap.style.display='block';
  }
};

window.submitReturn=async function(){
  const gpNum=(document.getElementById('ret-gp-num')?.value||'').trim().toUpperCase();
  const vendor=(document.getElementById('ret-vendor')?.value||'').trim();
  const article=(document.getElementById('ret-article')?.value||'').trim();
  const sentQty=parseFloat(document.getElementById('ret-sent-qty')?.value)||0;
  const returnedQty=parseFloat(document.getElementById('ret-qty')?.value)||0;
  const date=document.getElementById('ret-date')?.value||'';
  const notes=(document.getElementById('ret-notes')?.value||'').trim();
  const reason=(document.getElementById('ret-reason')?.value||'').trim();
  if(!gpNum||!vendor||!returnedQty){showToast('GP number, vendor, and returned qty are required.',true);return;}
  const tolerance=Math.ceil(sentQty*0.01);
  let status,shortage=0;
  if(returnedQty>sentQty){status='Overage';}
  else if(returnedQty>=sentQty-tolerance){status='Complete';}
  else{
    status='Incomplete Lot';shortage=sentQty-returnedQty;
    if(!reason){showToast('Reason is required for incomplete returns.',true);return;}
  }
  try{
    const next=await getNextId('returns');
    const retId='RET-'+String(next).padStart(3,'0');
    const payload={id:retId,ts:Date.now(),gpNum,vendor,article,sentQty,returnedQty,shortage,status,reason:status==='Incomplete Lot'?reason:'',date,receivedBy:session.name,notes};
    await setDoc(doc(db,'returns',retId),payload);
    await logActivity('Return recorded',`${retId} — ${vendor} returned ${returnedQty}/${sentQty} pcs for ${gpNum}`);
    showToast(retId+' saved ✓');
    const snap=await getDocs(query(collection(db,'returns'),orderBy('ts','desc')));
    allReturns=snap.docs.map(d=>d.data());
    window.switchGPTab('returns');
  }catch(e){showToast('Error: '+e.message,true);}
};

function renderReturnsList(){
  const body=document.getElementById('ret-list-body');
  if(!body)return;
  if(!allReturns.length){body.innerHTML='<div class="empty">No returns yet.</div>';return;}
  const sorted=[...allReturns.filter(r=>r.status==='Incomplete Lot'),...allReturns.filter(r=>r.status!=='Incomplete Lot')];
  body.innerHTML=sorted.map(r=>{
    const bc=r.status==='Complete'?'ret-complete':r.status==='Overage'?'ret-overage':'ret-incomplete';
    const icon=r.status==='Complete'?'✅':'🔴';
    const pend=_gpPendingFor('return',r.id);
    const pendBadge=pend?`<span title="${pend.action==='delete'?'Delete':'Edit'} pending approval" style="display:inline-block;background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px">${pend.action==='delete'?'Delete':'Edit'} pending</span>`:'';
    return`<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f5f5f5;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:700;color:var(--red);font-size:11px">${r.id}</span>
          <span class="ret-badge ${bc}">${r.status} ${icon}</span>
          ${pendBadge}
        </div>
        <div style="font-size:13px;font-weight:500;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.vendor} · ${r.article||'—'}</div>
        <div style="font-size:11px;color:var(--muted)">${r.gpNum||'—'} · ${r.date||''} · ${r.receivedBy||'—'}</div>
        ${r.reason?`<div style="font-size:11px;color:#dc2626;margin-top:2px">Reason: ${r.reason}</div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        <div style="text-align:right;font-size:12px;color:var(--muted)">
          <div style="font-weight:600">${r.returnedQty||0} / ${r.sentQty||0} pcs</div>
          ${r.shortage?`<div style="font-size:10px;color:#dc2626">Short: ${r.shortage}</div>`:''}
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="window.editReturn('${r.id}')" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Edit</button>
          <button onclick="window.requestDeleteReturn('${r.id}')" style="padding:4px 10px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:11px;cursor:pointer;font-family:inherit">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');}

// Fabric inventory engine — one operation per call. Recomputes totals from the
// roll array (self-correcting). Operations: addRolls (receipt) · removeRollCodes
// (issue) · deleteRollCodes (hard remove) · reserveRollCodes (+reservePO) ·
// releaseRollCodes · returnRollCodes (whole vendor return) · returnPartial
// [{parentRollCode,weight}] (mint remnant + log consumed) ·
// supplierReturnRollCodes (+reason). Runs in a Firestore transaction; callers
// can pass extraWrites:[{ref,data,merge}] and extraDeletes:[ref] to commit the
// receipt / gate-pass doc in the SAME atomic unit. See FABRIC_INVENTORY_PLAN.
async function _fabInvUpsert({fabType,gsm,color,unit,addRolls,removeRollCodes,deleteRollCodes,editRolls,reserveRollCodes,reservePO,releaseRollCodes,returnRollCodes,returnPartial,supplierReturnRollCodes,reason,note,sourceCol,sourceId,extraWrites,extraDeletes}){
  const key=_fabInvKey(fabType,gsm,color);
  const invRef=doc(db,'fabric_inventory',key);
  const movRef=doc(collection(db,'fabric_movements'));  // stable id across tx retries
  let outPayload=null,outMov=null;
  // One Firestore transaction: read the LIVE inventory fresh (not stale local
  // memory) so concurrent receive/issue/return can't clobber each other
  // (last-write-wins), and commit the aggregate + movement + any caller docs
  // (receipt / gate pass) or deletes together so a mid-operation failure can't
  // split the books.
  await runTransaction(db,async tx=>{
    const snap=await tx.get(invRef);
    const rolls=Array.isArray(snap.data()?.rolls)?snap.data().rolls.map(r=>({...r})):[];
    let movType='out',movSub='',movQty=0;const movCodes=[];
    const findRoll=(rc,statuses)=>rolls.find(r=>r.rollCode===rc&&statuses.includes(r.status||'in_stock'));
    if(Array.isArray(addRolls)){
      for(const r of addRolls){rolls.push({rollCode:r.rollCode,weight:r.weight,gsm:r.gsm||gsm||0,unit:r.unit||unit,status:'in_stock',sourceFabId:r.sourceFabId||sourceId,addedAt:Date.now(),addedBy:session.name});movQty+=r.weight||0;movCodes.push(r.rollCode);}
      movType='in';movSub='receipt';
    }else if(Array.isArray(removeRollCodes)){
      for(const rc of removeRollCodes){const r=findRoll(rc,['in_stock','reserved']);if(r){r.status='issued';r.issuedAt=Date.now();r.issuedBy=session.name;r.issuedTo=sourceId;r.issuedPO=reservePO||r.reservedPO||'';delete r.reservedPO;movQty+=r.weight||0;movCodes.push(rc);}}
      movType='out';movSub='issue';
    }else if(Array.isArray(deleteRollCodes)){
      // Hard-remove an in-stock roll entered by mistake — physically splices it
      // out of inventory (NOT an issue/return). Only in_stock rolls qualify.
      for(const rc of deleteRollCodes){const i=rolls.findIndex(r=>r.rollCode===rc&&(r.status||'in_stock')==='in_stock');if(i>=0){movQty+=rolls[i].weight||0;movCodes.push(rc);rolls.splice(i,1);}}
      movType='out';movSub='delete';
    }else if(Array.isArray(editRolls)){
      // Correct an in-stock roll's weight/gsm/QC in place (owner roll edit).
      for(const e of editRolls){const r=findRoll(e.rollCode,['in_stock']);if(r){if(e.weight!=null)r.weight=Number(e.weight)||0;if(e.gsm!=null)r.gsm=Number(e.gsm)||r.gsm;if(e.qcPassed!=null){r.qcPassed=!!e.qcPassed;r.qcBy=e.qcPassed?session.name:'';r.qcAt=e.qcPassed?Date.now():null;}movQty+=r.weight||0;movCodes.push(e.rollCode);}}
      movType='adjust';movSub='edit';
    }else if(Array.isArray(reserveRollCodes)){
      for(const rc of reserveRollCodes){const r=findRoll(rc,['in_stock']);if(r){r.status='reserved';r.reservedPO=reservePO||'';r.reservedAt=Date.now();r.reservedBy=session.name;movQty+=r.weight||0;movCodes.push(rc);}}
      movType='reserve';movSub='reserve';
    }else if(Array.isArray(releaseRollCodes)){
      for(const rc of releaseRollCodes){const r=findRoll(rc,['reserved']);if(r){r.status='in_stock';delete r.reservedPO;r.releasedAt=Date.now();movQty+=r.weight||0;movCodes.push(rc);}}
      movType='release';movSub='release';
    }else if(Array.isArray(returnRollCodes)){
      for(const rc of returnRollCodes){const r=findRoll(rc,['issued']);if(r){r.status='in_stock';r.returnedAt=Date.now();r.returnedBy=session.name;delete r.issuedTo;movQty+=r.weight||0;movCodes.push(rc);}}
      movType='in';movSub='return_in';
    }else if(Array.isArray(returnPartial)){
      for(const p of returnPartial){
        const parent=findRoll(p.parentRollCode,['issued']);
        if(parent){
          const remCode=_nextRemnantCode(rolls,p.parentRollCode);
          const w=parseFloat(p.weight)||0;
          rolls.push({rollCode:remCode,weight:w,gsm:parent.gsm||gsm||0,unit:parent.unit||unit,status:'in_stock',remnant:true,parentRollCode:p.parentRollCode,sourceFabId:parent.sourceFabId,addedAt:Date.now(),addedBy:session.name});
          parent.consumedWeight=(parent.consumedWeight||0)+Math.max(0,(parent.weight||0)-w);
          parent.returnedRemnant=remCode;
          movQty+=w;movCodes.push(remCode);
        }
      }
      movType='in';movSub='return_in';
    }else if(Array.isArray(supplierReturnRollCodes)){
      for(const rc of supplierReturnRollCodes){const r=findRoll(rc,['in_stock']);if(r){r.status='returned_supplier';r.returnedToSupplierAt=Date.now();r.returnReason=reason||'';movQty+=r.weight||0;movCodes.push(rc);}}
      movType='out';movSub='return_out';
    }
    // Aggregate: "stock" = AVAILABLE (in_stock) only, for BOTH weight and count,
    // so the two never disagree; reserved is tracked separately (it's spoken for).
    const inStock=rolls.filter(r=>(r.status||'in_stock')==='in_stock');
    const reserved=rolls.filter(r=>r.status==='reserved');
    const totalWeight=parseFloat(inStock.reduce((s,r)=>s+(r.weight||0),0).toFixed(2));
    const reservedWeight=parseFloat(reserved.reduce((s,r)=>s+(r.weight||0),0).toFixed(2));
    const payload={key,fabType,gsm:Number(gsm)||0,color,unit:unit||'kg',rolls,totalWeight,reservedWeight,rollsCount:inStock.length,reservedCount:reserved.length,lastMovementAt:Date.now()};
    const movDoc={id:movRef.id,ts:Date.now(),type:movType,subtype:movSub,fabType,gsm:Number(gsm)||0,color,unit:unit||'kg',qty:parseFloat(movQty.toFixed(2)),rollCodes:movCodes,sourceCollection:sourceCol||'',sourceId:sourceId||'',by:session.name,note:note||''};
    tx.set(invRef,payload,{merge:true});
    tx.set(movRef,movDoc);
    if(Array.isArray(extraWrites))for(const w of extraWrites){if(w&&w.ref&&w.data){if(w.merge)tx.set(w.ref,w.data,{merge:true});else tx.set(w.ref,w.data);}}
    if(Array.isArray(extraDeletes))for(const dref of extraDeletes){if(dref)tx.delete(dref);}
    outPayload=payload;outMov=movDoc;
  });
  // Sync in-memory caches to the committed state.
  const existing=allFabricInventory.find(x=>x._id===key);
  if(existing)Object.assign(existing,outPayload);else allFabricInventory.push({...outPayload,_id:key});
  allFabricMovements.unshift({...outMov,_id:movRef.id});
  return{movCodes:outMov.rollCodes,movQty:outMov.qty};
}
// Next free remnant suffix (-A,-B,…) for a parent roll code.
function _nextRemnantCode(rolls,parentCode){
  const used=new Set(rolls.map(r=>r.rollCode));
  for(let i=0;i<26;i++){const c=`${parentCode}-${String.fromCharCode(65+i)}`;if(!used.has(c))return c;}
  return `${parentCode}-${Date.now().toString(36).toUpperCase()}`;
}

// ── Gate Pass / Returns / Fabric In: Edit & Delete with approval ──
function _gpCanApprove(){return session&&['owner','manager'].includes(session.role);}
function _gpPendingFor(type,targetId){
  return allGPEditRequests.find(r=>r&&r.status==='pending'&&r.type===type&&r.targetId===targetId);
}
function _gpEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function _fabInvKey(fabType,gsm,color){
  const t=(fabType||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const c=(color||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  return `${t}__${gsm||0}gsm__${c}`;
}
function _gpRefreshActiveTab(){
  if(gpActiveTab==='outward')renderGPPage();
  else if(gpActiveTab==='returns')renderReturnsList();
  const p=document.getElementById('gp-pending-approvals');
  if(p)p.innerHTML=_renderGPPendingApprovals();
}

async function _gpSubmitEditRequest({type,targetId,action,proposedData,currentData,reason}){
  const ref=doc(collection(db,'gatepass_edit_requests'));
  const payload={
    id:ref.id,
    ts:Date.now(),
    type,targetId,action,
    proposedData:proposedData||null,
    currentData:currentData||null,
    requestedBy:session?.u||'',
    requestedByName:session?.name||'',
    requestedByRole:session?.role||'',
    status:'pending',
    reason:reason||'',
    reviewedBy:'',reviewedByName:'',reviewedAt:0,reviewNote:''
  };
  await setDoc(ref,payload);
  allGPEditRequests.unshift(payload);
  const labelMap={gp:'Gate pass',return:'Return',fabric:'Fabric in'};
  const verb=action==='delete'?'delete':'edit';
  if(typeof _hrmNotify==='function'){
    await _hrmNotify({
      type:'gp_'+verb+'_request',
      title:`${labelMap[type]} ${verb} request: ${targetId}`,
      message:`${session?.name||'A user'} requested to ${verb} ${targetId}. Open the Gate Pass page to approve or reject.`,
      forRole:'owner_manager',
      relatedTo:ref.id,
      priority:'high',
      actionRequired:true,
      actionUrl:'gatepass'
    });
  }
  await logActivity(`${labelMap[type]} ${verb} requested`,`${targetId} by ${session?.name||'unknown'}`);
  return payload;
}

// ── Edit: Gate Pass (Outward) ──
window.editGP=function(gpId){
  const gp=allPasses.find(p=>p.id===gpId);
  if(!gp)return showToast('Gate pass not found.',true);
  if(_gpPendingFor('gp',gpId))return showToast('An edit/delete is already pending approval for '+gpId,true);
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='hrm-modal-back';
  back.onclick=ev=>{if(ev.target===back)window.hrmCloseModal();};
  const items=Array.isArray(gp.items)?gp.items:[];
  _gpEditRowIdx=0;
  const rowsHTML=items.map(it=>{
    _gpEditRowIdx++;
    const id='gpe-row-'+_gpEditRowIdx;
    return`<tr id="${id}" style="border-bottom:1px solid #f5f5f5">
      <td style="padding:4px 6px"><input value="${_gpEsc(it.size||'')}" style="width:70px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"></td>
      <td style="padding:4px 6px"><input type="number" min="0" value="${it.units||0}" style="width:80px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"></td>
      <td style="padding:4px 6px"><input type="number" min="0" step="0.1" value="${it.weight||0}" style="width:80px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"></td>
      <td><button onclick="document.getElementById('${id}').remove()" style="background:none;border:none;color:#ccc;font-size:16px;cursor:pointer;padding:2px 6px">×</button></td>
    </tr>`;
  }).join('');
  const banner=_gpCanApprove()
    ?`<div style="background:#ecfdf5;color:#065f46;border:1px solid #bbf7d0;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px">Owner/Manager: changes apply immediately.</div>`
    :`<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px">Your changes will be sent to owners/managers for approval.</div>`;
  const isFab=gp.gpType==='fabric';
  const fabUnit=gp.fabricUnit||'kg';
  const sectionHTML=isFab
    ?`<div style="margin-top:12px;font-weight:600;font-size:13px">Fabric details (${fabUnit})</div>
      <div class="hrm-grid-2" style="margin-top:6px">
        <div class="field"><label>Total ${fabUnit==='meters'?'length (meters)':'weight (kg)'} *</label><input id="gpe-fab-qty" type="number" min="0" step="0.01" value="${gp.fabricQty||0}"></div>
        <div class="field"><label>Roll count</label><input id="gpe-fab-rolls" type="number" min="0" value="${gp.rollsCount||0}"></div>
      </div>
      <input type="hidden" id="gpe-fab-unit" value="${fabUnit}">`
    :`<div style="margin-top:12px;font-weight:600;font-size:13px">Units by size</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px">
        <thead><tr style="background:#fafafa"><th style="padding:6px;text-align:left;font-weight:600">Size</th><th style="padding:6px;text-align:left;font-weight:600">Units</th><th style="padding:6px;text-align:left;font-weight:600">Weight (kg)</th><th></th></tr></thead>
        <tbody id="gpe-rows-body">${rowsHTML}</tbody>
      </table>
      <button onclick="window.gpEditAddRow()" style="margin-top:6px;padding:6px 12px;background:none;border:1px dashed var(--border);border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;color:var(--muted)">+ Add size</button>`;
  const borasField=isFab?'':`<div class="field"><label>Boras</label><input id="gpe-boras" type="number" min="0" value="${gp.boras||0}"></div>`;
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h3>Edit Gate Pass${isFab?' (Fabric)':''}</h3><div class="sub">${gp.id} · ${_gpEsc(gp.article||'')}</div></div>
      <button onclick="window.hrmCloseModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--muted);line-height:1">×</button>
    </div>
    ${banner}
    <div class="hrm-grid-2">
      <div class="field"><label>Article *</label><input id="gpe-article" value="${_gpEsc(gp.article||'')}"></div>
      <div class="field"><label>Specification *</label><input id="gpe-spec" value="${_gpEsc(gp.spec||'')}"></div>
      <div class="field"><label>Destination *</label><input id="gpe-dest" value="${_gpEsc(gp.dest||'')}"></div>
      <div class="field"><label>Date</label><input id="gpe-date" type="date" value="${_gpEsc(gp.date||'')}"></div>
      <div class="field"><label>Time</label><input id="gpe-time" type="time" value="${_gpEsc(gp.time||'')}"></div>
      <div class="field"><label>Person</label><input id="gpe-name" value="${_gpEsc(gp.name||'')}"></div>
      ${borasField}
    </div>
    <div class="field" style="margin-top:8px"><label>Purpose</label><input id="gpe-purpose" value="${_gpEsc(gp.purpose||'')}"></div>
    <input type="hidden" id="gpe-type" value="${isFab?'fabric':'garments'}">
    ${sectionHTML}
    ${!_gpCanApprove()?`<div class="field" style="margin-top:12px"><label>Reason for change *</label><textarea id="gpe-reason" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px" placeholder="Required so the approver understands why."></textarea></div>`:''}
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.submitGPEdit('${gpId}')">${_gpCanApprove()?'Save Changes':'Send for Approval'}</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window.gpEditAddRow=function(){
  _gpEditRowIdx++;
  const id='gpe-row-'+_gpEditRowIdx;
  const tbody=document.getElementById('gpe-rows-body');
  if(!tbody)return;
  const tr=document.createElement('tr');
  tr.id=id;tr.style.borderBottom='1px solid #f5f5f5';
  tr.innerHTML=`<td style="padding:4px 6px"><input placeholder="e.g. M" style="width:70px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"></td>
    <td style="padding:4px 6px"><input type="number" min="0" placeholder="0" style="width:80px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"></td>
    <td style="padding:4px 6px"><input type="number" min="0" step="0.1" placeholder="0" style="width:80px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"></td>
    <td><button onclick="document.getElementById('${id}').remove()" style="background:none;border:none;color:#ccc;font-size:16px;cursor:pointer;padding:2px 6px">×</button></td>`;
  tbody.appendChild(tr);
};

function _collectGPEditPayload(){
  const v=k=>document.getElementById(k)?.value?.trim()||'';
  const isFab=v('gpe-type')==='fabric';
  const base={
    article:v('gpe-article'),
    spec:v('gpe-spec'),
    dest:v('gpe-dest'),
    date:v('gpe-date'),
    time:v('gpe-time'),
    name:v('gpe-name'),
    purpose:v('gpe-purpose')
  };
  if(isFab){
    const fabUnit=v('gpe-fab-unit')||'kg';
    const fabQty=parseFloat(document.getElementById('gpe-fab-qty')?.value)||0;
    const rollsCount=parseInt(document.getElementById('gpe-fab-rolls')?.value)||0;
    return{...base,gpType:'fabric',fabricUnit:fabUnit,fabricQty:fabQty,rollsCount,boras:'0',items:[],totalUnits:0,totalWeight:fabUnit==='kg'?fabQty:0,totalLength:fabUnit==='meters'?fabQty:0};
  }
  const items=[];
  document.querySelectorAll('#gpe-rows-body tr').forEach(tr=>{
    const ins=tr.querySelectorAll('input');
    const sz=ins[0]?.value.trim();
    if(!sz)return;
    items.push({size:sz,units:parseFloat(ins[1]?.value)||0,weight:parseFloat(ins[2]?.value)||0});
  });
  return{...base,gpType:'garments',boras:v('gpe-boras')||'0',items,totalUnits:items.reduce((s,r)=>s+r.units,0),totalWeight:items.reduce((s,r)=>s+r.weight,0).toFixed(1)};
}

window.submitGPEdit=async function(gpId){
  const gp=allPasses.find(p=>p.id===gpId);
  if(!gp)return showToast('Gate pass not found.',true);
  const proposed=_collectGPEditPayload();
  if(!proposed.article||!proposed.dest)return showToast('Article and destination required.',true);
  if(!proposed.spec)return showToast('Specification is required.',true);
  if(proposed.gpType==='fabric'&&!proposed.fabricQty)return showToast('Enter total fabric qty.',true);
  if(proposed.gpType==='garments'&&!proposed.items.length)return showToast('Add at least one size row.',true);
  try{
    if(_gpCanApprove()){
      await updateDoc(doc(db,'gatepasses',gpId),{...proposed,updatedAt:Date.now(),updatedBy:session.name});
      Object.assign(gp,proposed);
      await logActivity('Gate pass edited',`${gpId} by ${session.name}`);
      showToast(gpId+' updated ✓');
    }else{
      const reason=(document.getElementById('gpe-reason')?.value||'').trim();
      if(!reason)return showToast('Reason for change is required.',true);
      const currentData={article:gp.article,dest:gp.dest,date:gp.date,time:gp.time,name:gp.name,boras:gp.boras,purpose:gp.purpose,items:gp.items||[],totalUnits:gp.totalUnits,totalWeight:gp.totalWeight,gpType:gp.gpType||'garments',fabricUnit:gp.fabricUnit,fabricQty:gp.fabricQty,rollsCount:gp.rollsCount};
      await _gpSubmitEditRequest({type:'gp',targetId:gpId,action:'edit',proposedData:proposed,currentData,reason});
      showToast('Edit request sent for approval ✓');
    }
    window.hrmCloseModal();
    _gpRefreshActiveTab();
  }catch(e){showToast('Save failed: '+e.message,true);}
};

window.requestDeleteGP=async function(gpId){
  const gp=allPasses.find(p=>p.id===gpId);
  if(!gp)return showToast('Gate pass not found.',true);
  if(_gpPendingFor('gp',gpId))return showToast('A request is already pending for '+gpId,true);
  if(_gpCanApprove()){
    if(!confirm(`Delete ${gpId}? This cannot be undone.`))return;
    try{
      await deleteDoc(doc(db,'gatepasses',gpId));
      await logActivity('Gate pass deleted',`${gpId} deleted by ${session.name}`);
      allPasses=allPasses.filter(p=>p.id!==gpId);
      showToast(`${gpId} deleted`);
      _gpRefreshActiveTab();
    }catch(e){showToast('Error: '+e.message,true);}
    return;
  }
  const reason=prompt(`Request to delete ${gpId}. Reason for deletion:`,'');
  if(!reason||!reason.trim())return;
  try{
    await _gpSubmitEditRequest({type:'gp',targetId:gpId,action:'delete',currentData:gp,reason:reason.trim()});
    showToast('Delete request sent for approval');
    _gpRefreshActiveTab();
  }catch(e){showToast('Request failed: '+e.message,true);}
};

// ── Edit: Returns ──
window.editReturn=function(retId){
  const r=allReturns.find(x=>x.id===retId);
  if(!r)return showToast('Return not found.',true);
  if(_gpPendingFor('return',retId))return showToast('An edit/delete is already pending for '+retId,true);
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='hrm-modal-back';
  back.onclick=ev=>{if(ev.target===back)window.hrmCloseModal();};
  const banner=_gpCanApprove()
    ?`<div style="background:#ecfdf5;color:#065f46;border:1px solid #bbf7d0;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px">Owner/Manager: changes apply immediately.</div>`
    :`<div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px">Your changes will be sent to owners/managers for approval.</div>`;
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h3>Edit Return</h3><div class="sub">${r.id} · ${_gpEsc(r.vendor||'')} · ${_gpEsc(r.article||'')}</div></div>
      <button onclick="window.hrmCloseModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--muted);line-height:1">×</button>
    </div>
    ${banner}
    <div class="hrm-grid-2">
      <div class="field"><label>Original GP *</label><input id="rete-gp" value="${_gpEsc(r.gpNum||'')}"></div>
      <div class="field"><label>Vendor *</label><input id="rete-vendor" value="${_gpEsc(r.vendor||'')}"></div>
      <div class="field"><label>Article</label><input id="rete-article" value="${_gpEsc(r.article||'')}"></div>
      <div class="field"><label>Date</label><input id="rete-date" type="date" value="${_gpEsc(r.date||'')}"></div>
      <div class="field"><label>Sent Qty (pcs)</label><input id="rete-sent" type="number" min="0" value="${r.sentQty||0}"></div>
      <div class="field"><label>Returned Qty (pcs) *</label><input id="rete-ret" type="number" min="0" value="${r.returnedQty||0}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Reason (if incomplete)</label><input id="rete-shortreason" value="${_gpEsc(r.reason||'')}"></div>
    <div class="field"><label>Notes</label><textarea id="rete-notes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px">${_gpEsc(r.notes||'')}</textarea></div>
    ${!_gpCanApprove()?`<div class="field" style="margin-top:12px"><label>Reason for change *</label><textarea id="rete-reason" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px" placeholder="Required so the approver understands why."></textarea></div>`:''}
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.submitReturnEdit('${retId}')">${_gpCanApprove()?'Save Changes':'Send for Approval'}</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

function _collectReturnEditPayload(){
  const v=k=>document.getElementById(k)?.value?.trim()||'';
  const sent=parseFloat(document.getElementById('rete-sent')?.value)||0;
  const ret=parseFloat(document.getElementById('rete-ret')?.value)||0;
  const tolerance=Math.ceil(sent*0.01);
  let status,shortage=0;
  if(ret>sent){status='Overage';}
  else if(ret>=sent-tolerance){status='Complete';}
  else{status='Incomplete Lot';shortage=sent-ret;}
  return{
    gpNum:v('rete-gp').toUpperCase(),
    vendor:v('rete-vendor'),
    article:v('rete-article'),
    date:v('rete-date'),
    sentQty:sent,
    returnedQty:ret,
    shortage,
    status,
    reason:status==='Incomplete Lot'?v('rete-shortreason'):'',
    notes:v('rete-notes')
  };
}

window.submitReturnEdit=async function(retId){
  const r=allReturns.find(x=>x.id===retId);
  if(!r)return showToast('Return not found.',true);
  const proposed=_collectReturnEditPayload();
  if(!proposed.gpNum||!proposed.vendor||!proposed.returnedQty)return showToast('GP, vendor and returned qty are required.',true);
  if(proposed.status==='Incomplete Lot'&&!proposed.reason)return showToast('Shortage reason is required for incomplete lots.',true);
  try{
    if(_gpCanApprove()){
      await updateDoc(doc(db,'returns',retId),{...proposed,updatedAt:Date.now(),updatedBy:session.name});
      Object.assign(r,proposed);
      await logActivity('Return edited',`${retId} by ${session.name}`);
      showToast(retId+' updated ✓');
    }else{
      const reason=(document.getElementById('rete-reason')?.value||'').trim();
      if(!reason)return showToast('Reason for change is required.',true);
      const currentData={gpNum:r.gpNum,vendor:r.vendor,article:r.article,date:r.date,sentQty:r.sentQty,returnedQty:r.returnedQty,shortage:r.shortage,status:r.status,reason:r.reason,notes:r.notes};
      await _gpSubmitEditRequest({type:'return',targetId:retId,action:'edit',proposedData:proposed,currentData,reason});
      showToast('Edit request sent for approval ✓');
    }
    window.hrmCloseModal();
    _gpRefreshActiveTab();
  }catch(e){showToast('Save failed: '+e.message,true);}
};

window.requestDeleteReturn=async function(retId){
  const r=allReturns.find(x=>x.id===retId);
  if(!r)return showToast('Return not found.',true);
  if(_gpPendingFor('return',retId))return showToast('A request is already pending for '+retId,true);
  if(_gpCanApprove()){
    if(!confirm(`Delete ${retId}? This cannot be undone.`))return;
    try{
      await deleteDoc(doc(db,'returns',retId));
      await logActivity('Return deleted',`${retId} deleted by ${session.name}`);
      allReturns=allReturns.filter(x=>x.id!==retId);
      showToast(`${retId} deleted`);
      _gpRefreshActiveTab();
    }catch(e){showToast('Error: '+e.message,true);}
    return;
  }
  const reason=prompt(`Request to delete ${retId}. Reason:`,'');
  if(!reason||!reason.trim())return;
  try{
    await _gpSubmitEditRequest({type:'return',targetId:retId,action:'delete',currentData:r,reason:reason.trim()});
    showToast('Delete request sent for approval');
    _gpRefreshActiveTab();
  }catch(e){showToast('Request failed: '+e.message,true);}
};


// ── Pending Approvals UI (owners/managers only) ──
function _renderGPPendingApprovals(){
  if(!_gpCanApprove())return'';
  const pending=allGPEditRequests.filter(r=>r&&r.status==='pending');
  if(!pending.length)return'';
  const labelMap={gp:'Gate Pass',return:'Return',fabric:'Fabric In'};
  return`<div class="card" style="margin-bottom:14px;border:1px solid #fde68a;background:#fffbeb">
    <div class="card-title" style="color:#92400e">Pending approvals · ${pending.length}</div>
    ${pending.map(r=>{
      const verb=r.action==='delete'?'Delete':'Edit';
      const diffHTML=r.action==='edit'?_renderGPEditDiff(r):'';
      return`<div style="padding:10px 0;border-bottom:1px solid #fef3c7">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
          <div style="min-width:0;flex:1">
            <div style="font-weight:700;font-size:13px">${verb} · ${labelMap[r.type]||r.type} · <span style="color:var(--red)">${_gpEsc(r.targetId)}</span></div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">Requested by ${_gpEsc(r.requestedByName||r.requestedBy||'—')} · ${new Date(r.ts).toLocaleString()}</div>
            ${r.reason?`<div style="font-size:12px;color:#444;margin-top:4px"><b>Reason:</b> ${_gpEsc(r.reason)}</div>`:''}
            ${diffHTML}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button onclick="window.gpApproveRequest('${r.id}')" style="padding:6px 12px;border:1px solid #16a34a;border-radius:6px;background:#16a34a;color:#fff;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600">Approve</button>
            <button onclick="window.gpRejectRequest('${r.id}')" style="padding:6px 12px;border:1px solid #dc2626;border-radius:6px;background:#fff;color:#dc2626;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600">Reject</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function _renderGPEditDiff(req){
  const cur=req.currentData||{},nu=req.proposedData||{};
  const keys=Array.from(new Set([...Object.keys(cur),...Object.keys(nu)]));
  const rows=keys.map(k=>{
    const a=cur[k],b=nu[k];
    const sa=typeof a==='object'?JSON.stringify(a):String(a==null?'':a);
    const sb=typeof b==='object'?JSON.stringify(b):String(b==null?'':b);
    if(sa===sb)return'';
    return`<tr><td style="padding:3px 6px;color:var(--muted);font-weight:600;vertical-align:top">${_gpEsc(k)}</td><td style="padding:3px 6px;color:#dc2626;text-decoration:line-through;vertical-align:top;word-break:break-word">${_gpEsc(sa.length>120?sa.slice(0,120)+'…':sa)}</td><td style="padding:3px 6px;color:#16a34a;vertical-align:top;word-break:break-word">${_gpEsc(sb.length>120?sb.slice(0,120)+'…':sb)}</td></tr>`;
  }).filter(Boolean).join('');
  if(!rows)return'<div style="font-size:11px;color:var(--muted);margin-top:4px">No effective changes detected.</div>';
  return`<div style="margin-top:6px;background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#fafafa"><th style="padding:4px 6px;text-align:left;font-weight:600">Field</th><th style="padding:4px 6px;text-align:left;font-weight:600;color:#dc2626">Current</th><th style="padding:4px 6px;text-align:left;font-weight:600;color:#16a34a">Proposed</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

window.gpApproveRequest=async function(reqId){
  if(!_gpCanApprove())return showToast('Owners/managers only.',true);
  const r=allGPEditRequests.find(x=>x.id===reqId);
  if(!r||r.status!=='pending')return;
  // Fabric deletions are owners-only — managers can approve gate-pass/return
  // requests but not delete fabric (matches firestore.rules delete: isOwner()).
  if(r.type==='fabric'&&r.action==='delete'&&!(session&&session.role==='owner'))
    return showToast('Only owners (Afnan, Ammar) can approve fabric deletions.',true);
  const collMap={gp:'gatepasses',return:'returns',fabric:'fabricin'};
  const arrMap={gp:allPasses,return:allReturns,fabric:allFabricIn};
  const collName=collMap[r.type];
  const arr=arrMap[r.type];
  if(!collName||!arr)return showToast('Unknown request type.',true);
  try{
    if(r.action==='delete'){
      if(r.type==='fabric'){
        // Use the shared receipt-delete so inventory rolls are removed too
        // (and it blocks if any roll has left stock). It also splices allFabricIn.
        await window._fabDeleteReceipt(r.targetId);
      }else{
        await deleteDoc(doc(db,collName,r.targetId));
        const i=arr.findIndex(x=>x.id===r.targetId);
        if(i>=0)arr.splice(i,1);
      }
    }else{
      await updateDoc(doc(db,collName,r.targetId),{...r.proposedData,updatedAt:Date.now(),updatedBy:session.name});
      const i=arr.findIndex(x=>x.id===r.targetId);
      if(i>=0)Object.assign(arr[i],r.proposedData);
    }
    const update={status:'approved',reviewedBy:session.u,reviewedByName:session.name,reviewedAt:Date.now()};
    await updateDoc(doc(db,'gatepass_edit_requests',reqId),update);
    Object.assign(r,update);
    if(typeof _hrmNotify==='function'&&r.requestedBy){
      await _hrmNotify({
        type:'gp_request_approved',
        title:`${r.action==='delete'?'Delete':'Edit'} approved: ${r.targetId}`,
        message:`Your ${r.action} request for ${r.targetId} was approved by ${session.name}.`,
        forUser:r.requestedBy,
        relatedTo:reqId,
        priority:'normal'
      });
    }
    await logActivity('GP request approved',`${r.action} ${r.targetId} approved by ${session.name}`);
    showToast('Approved ✓');
    _gpRefreshActiveTab();
  }catch(e){showToast('Approve failed: '+e.message,true);}
};

window.gpRejectRequest=async function(reqId){
  if(!_gpCanApprove())return showToast('Owners/managers only.',true);
  const r=allGPEditRequests.find(x=>x.id===reqId);
  if(!r||r.status!=='pending')return;
  const note=prompt('Reason for rejection (optional):','');
  try{
    const update={status:'rejected',reviewedBy:session.u,reviewedByName:session.name,reviewedAt:Date.now(),reviewNote:(note||'').trim()};
    await updateDoc(doc(db,'gatepass_edit_requests',reqId),update);
    Object.assign(r,update);
    if(typeof _hrmNotify==='function'&&r.requestedBy){
      await _hrmNotify({
        type:'gp_request_rejected',
        title:`${r.action==='delete'?'Delete':'Edit'} rejected: ${r.targetId}`,
        message:`Your ${r.action} request for ${r.targetId} was rejected by ${session.name}.${update.reviewNote?' Reason: '+update.reviewNote:''}`,
        forUser:r.requestedBy,
        relatedTo:reqId,
        priority:'high'
      });
    }
    await logActivity('GP request rejected',`${r.action} ${r.targetId} rejected by ${session.name}`);
    showToast('Rejected.');
    _gpRefreshActiveTab();
  }catch(e){showToast('Reject failed: '+e.message,true);}
};

// ── PDF: PO ──
window.generateGPPdf=function(gpId){
  const gp=allPasses.find(p=>p.id===gpId);if(!gp){showToast('Gate pass not found.',true);return;}
  if(window.__usePrintEngine&&typeof window.printDocument==='function'){
    return window.printDocument({type:'gate-pass',data:Object.assign({},gp,{
      documentType:'Gate Pass',documentNumber:gp.id,id:gp.id,
      issuedBy:gp.issuer||gp.name||'',
      person:gp.name,destination:gp.dest,
      gpType:(gp.gpType==='fabric'?'fabric-in':'outward'),
      urduLevel:'full'
    })});
  }
  const{jsPDF}=window.jspdf;const pdf=new jsPDF({unit:'mm',format:'a4'});
  const W=210,M=14;let y=18;
  // Header
  pdf.setFillColor(26,26,46);pdf.rect(0,0,W,28,'F');
  pdf.setTextColor(255,255,255);pdf.setFontSize(16);pdf.setFont(undefined,'bold');pdf.text('Groovy Studio',M,12);
  pdf.setFontSize(10);pdf.setFont(undefined,'normal');pdf.setTextColor(200,200,200);pdf.text('Gate Pass',M,20);
  pdf.setFontSize(18);pdf.setFont(undefined,'bold');pdf.setTextColor(233,69,96);pdf.text(gp.id,W-M,12,{align:'right'});
  pdf.setFontSize(9);pdf.setFont(undefined,'normal');pdf.setTextColor(200,200,200);pdf.text(`${gp.date||'—'} · ${gp.time||'—'}`,W-M,20,{align:'right'});
  y=36;pdf.setTextColor(26,26,46);

  // Info
  pdf.setFontSize(10);pdf.setFont(undefined,'normal');
  const rows=[[`Person: ${gp.name||'—'}`,`Issued by: ${gp.issuer||gp.name||'—'}`],[`Article: ${gp.article||'—'}`,`Specification: ${gp.spec||'—'}`],[`Destination: ${gp.dest||'—'}`,`Purpose: ${gp.purpose||'—'}`]];
  rows.forEach(row=>{pdf.text(row[0],M,y);if(row[1])pdf.text(row[1],W/2,y);y+=7;});
  y+=4;

  const isFabric=gp.gpType==='fabric';
  if(isFabric){
    // Fabric type label
    pdf.setFillColor(26,26,46);pdf.rect(M,y,W-M*2,10,'F');
    pdf.setTextColor(255,255,255);pdf.setFontSize(11);pdf.setFont(undefined,'bold');
    pdf.text(`Fabric Pass · ${gp.fabricUnit||'kg'}`,M+4,y+7);
    y+=14;
  }else{
    // Size table header
    pdf.setFillColor(26,26,46);pdf.rect(M,y,W-M*2,8,'F');
    pdf.setTextColor(255,255,255);pdf.setFontSize(9);pdf.setFont(undefined,'bold');
    pdf.text('Size',M+4,y+5);pdf.text('Units (pcs)',M+40,y+5);pdf.text('Weight (kg)',M+90,y+5);
    y+=8;pdf.setDrawColor(229,229,231);pdf.setLineWidth(0.3);
    (gp.items||[]).forEach(item=>{
      pdf.setTextColor(26,26,46);pdf.setFont(undefined,'normal');pdf.setFontSize(10);
      pdf.text(item.size||'—',M+4,y+5);pdf.text(String(item.units||0),M+40,y+5);pdf.text(String(item.weight||0),M+90,y+5);
      pdf.line(M,y+8,W-M,y+8);y+=10;if(y>260){pdf.addPage();y=20;}
    });
  }

  // Totals
  y+=4;pdf.setFillColor(242,242,244);pdf.rect(M,y,W-M*2,24,'F');
  const bw=(W-M*2)/3;
  const tots=isFabric
    ?[[gp.fabricUnit==='meters'?'Total Length':'Total Weight',`${gp.fabricQty||0} ${gp.fabricUnit||'kg'}`],['Rolls',`${gp.rollsCount||0}`],['Type',`Fabric`]]
    :[['Total Units',`${gp.totalUnits||0} pcs`],['Total Weight',`${gp.totalWeight||0} kg`],['Total Boras',`${gp.boras||0}`]];
  tots.forEach(([lbl,val],i)=>{
    pdf.setTextColor(107,114,128);pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.text(lbl,M+bw*i+bw/2,y+8,{align:'center'});
    pdf.setTextColor(26,26,46);pdf.setFontSize(14);pdf.text(val,M+bw*i+bw/2,y+18,{align:'center'});
  });
  y+=32;

  // Signatures
  if(y>240){pdf.addPage();y=20;}
  y+=10;const sw=(W-M*2)/3;
  ['Issued By','Received By','Security Guard'].forEach((lbl,i)=>{
    const x=M+sw*i;pdf.setDrawColor(150,150,150);pdf.setLineWidth(0.3);pdf.line(x+4,y+20,x+sw-4,y+20);
    pdf.setTextColor(107,114,128);pdf.setFontSize(8);pdf.setFont(undefined,'normal');pdf.text(lbl,x+sw/2,y+26,{align:'center'});
  });

  pdf.save(`${gp.id}.pdf`);showToast('PDF downloaded ✓');
};

// ── PDF: Vendor Job Sheet (embroidery / sublimation outsourced jobs) ──
window.generateJobSheetPDF=function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId);
  if(!j){showToast('Job not found.',true);return;}
  const recipe=allRecipes.find(r=>r._id===j.recipeId);
  const jt=inferJobType(j);
  const meta=JOB_TYPES[jt]||JOB_TYPES.printing;
  if(window.__usePrintEngine&&typeof window.printDocument==='function'){
    return window.printDocument({type:'generic',data:{
      documentType:'Vendor Job Sheet — '+meta.label,documentNumber:j.poNumber||'—',id:j.poNumber||j._id,
      title:'Vendor Job Sheet — '+meta.label,
      subtitle:[j.articleCode,j.articleName].filter(Boolean).join(' · '),
      bodyHtml:`<p>Article: ${j.articleCode||'—'} ${j.articleName||''}</p><p>Job Type: ${meta.label}</p><p>Total Qty: ${j.totalQty||0} pcs</p><p>Tier: ${j.complexityTier||'—'}</p><p>Vendor: ${j.vendorName||'—'}</p><p>Priority: ${(j.priority||'normal').toUpperCase()}</p>`
    }});
  }
  const{jsPDF}=window.jspdf;const pdf=new jsPDF({unit:'mm',format:'a4'});
  const W=210,M=14;let y=18;
  // Header
  pdf.setFillColor(17,17,17);pdf.rect(0,0,W,28,'F');
  pdf.setTextColor(255,255,255);pdf.setFontSize(16);pdf.setFont(undefined,'bold');pdf.text('Groovy Operations',M,12);
  pdf.setFontSize(10);pdf.setFont(undefined,'normal');pdf.setTextColor(200,200,200);pdf.text('Vendor Job Sheet — '+meta.label,M,20);
  pdf.setFontSize(14);pdf.setFont(undefined,'bold');pdf.setTextColor(255,255,255);pdf.text(j.poNumber||'—',W-M,12,{align:'right'});
  pdf.setFontSize(9);pdf.setFont(undefined,'normal');pdf.setTextColor(200,200,200);pdf.text(`Issued: ${new Date().toLocaleDateString('en-GB')}`,W-M,20,{align:'right'});
  y=36;pdf.setTextColor(17,17,17);
  // Job details
  pdf.setFillColor(240,240,240);pdf.rect(M,y,W-M*2,7,'F');
  pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('JOB DETAILS',M+2,y+5);
  y+=10;pdf.setTextColor(17,17,17);pdf.setFontSize(10);
  const rows=[
    [`Article Code: ${j.articleCode||'—'}`,                       `Article Name: ${j.articleName||'—'}`],
    [`Job Type: ${meta.icon} ${meta.label}`,                      `Process: ${(PROCESS_TYPES[j.processType]||{}).label||j.processType||'—'}`],
    [`Total Qty: ${j.totalQty||0} pcs`,                            `Tier: ${j.complexityTier||'—'} · Priority: ${(j.priority||'normal').toUpperCase()}`],
    [`Vendor: ${j.vendorName||'—'}`,                               `Recipe: ${recipe?recipe.articleCode+(recipe.status==='locked'?' (Locked)':' (Draft)'):'—'}`],
    [`Job Created: ${j.createdAt?new Date(j.createdAt).toLocaleDateString('en-GB'):'—'}`, `Created by: ${j.createdBy||'—'}`]
  ];
  rows.forEach(row=>{pdf.setFont(undefined,'normal');pdf.text(row[0],M,y);if(row[1])pdf.text(row[1],W/2,y);y+=6;});
  // Size breakdown
  y+=4;pdf.setFillColor(240,240,240);pdf.rect(M,y,W-M*2,7,'F');
  pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('SIZE BREAKDOWN',M+2,y+5);
  y+=10;
  const szs=['XS','S','M','L','XL','2XL'];const colW=(W-M*2)/szs.length;
  pdf.setFillColor(17,17,17);pdf.rect(M,y,W-M*2,8,'F');
  szs.forEach((sz,i)=>{pdf.setTextColor(255,255,255);pdf.setFontSize(9);pdf.setFont(undefined,'bold');pdf.text(sz,M+colW*i+colW/2,y+5,{align:'center'});});
  y+=8;
  szs.forEach((sz,i)=>{pdf.setTextColor(17,17,17);pdf.setFont(undefined,'normal');pdf.setFontSize(12);pdf.text(String((j.sizeBreakdown||{})[sz]||0),M+colW*i+colW/2,y+7,{align:'center'});});
  y+=14;
  // Bundle / instructions
  if(j.bundleDetails){
    pdf.setFillColor(240,240,240);pdf.rect(M,y,W-M*2,7,'F');
    pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('BUNDLE DETAILS / NOTES',M+2,y+5);
    y+=10;pdf.setTextColor(17,17,17);pdf.setFont(undefined,'normal');pdf.setFontSize(10);
    const lines=pdf.splitTextToSize(String(j.bundleDetails),W-M*2);
    pdf.text(lines,M,y);y+=lines.length*5+4;
  }
  // Recipe summary (if available)
  if(recipe&&recipe.printing){
    if(y>230){pdf.addPage();y=20;}
    pdf.setFillColor(240,240,240);pdf.rect(M,y,W-M*2,7,'F');
    pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('RECIPE SUMMARY',M+2,y+5);
    y+=10;pdf.setTextColor(17,17,17);pdf.setFont(undefined,'normal');pdf.setFontSize(10);
    const pt=recipe.printing;
    const placements=(pt.placements||[]).map(p=>p.placementName||p.placementId||'').filter(Boolean).join(', ')||'—';
    pdf.text(`Placements: ${placements}`,M,y);y+=6;
    pdf.text(`Tier: ${pt.complexityTier||'—'} · Rate/pc: Rs.${pt.ratePerPiece||'—'}`,M,y);y+=6;
  }
  // Signature block
  if(y>240){pdf.addPage();y=20;}
  y+=10;const sw=(W-M*2)/2;
  ['Issued By (Groovy)','Received By (Vendor)'].forEach((lbl,i)=>{
    const x=M+sw*i;pdf.setDrawColor(150,150,150);pdf.setLineWidth(0.3);pdf.line(x+4,y+20,x+sw-4,y+20);
    pdf.setTextColor(107,114,128);pdf.setFontSize(8);pdf.setFont(undefined,'normal');pdf.text(lbl,x+sw/2,y+26,{align:'center'});
    pdf.text('Date / Signature',x+sw/2,y+31,{align:'center'});
  });
  // Footer
  pdf.setTextColor(107,114,128);pdf.setFontSize(8);pdf.setFont(undefined,'normal');
  pdf.text(`Groovy Operations · Job Sheet · ${j.poNumber||''} · Generated ${new Date().toLocaleDateString('en-GB')}`,W/2,288,{align:'center'});
  pdf.save(`JobSheet-${j.poNumber||j._id}.pdf`);showToast('Job sheet downloaded ✓');
};

// ── Activity log ──

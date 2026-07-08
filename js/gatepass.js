/* Groovy Operations — gatepass.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

// ════════════════════════════════════════════════════════════════════════
//  Gate Pass v2 — a pass is defined by WHAT leaves (type) × WHY (reason).
//  Everything here is ADDITIVE: legacy passes (gpType 'garments'/'fabric',
//  no gpReason) keep rendering + reconciling exactly as before. New optional
//  fields: gpReason, expectReturn, expectedBack, sourceVendor, assetItems[],
//  sale{}, returnedQty, returnStatus, closedAt.
// ════════════════════════════════════════════════════════════════════════
const GP_TYPE_OPTS=[['garments','Garments — by units (pcs)'],['fabric_kg','Fabric — by weight (kg)'],['item','Item / asset']];
const GP_REASON_OPTS={
  garments:[['process','For process — expect return'],['sale','Sale'],['other','Other / permanent out']],
  fabric_kg:[['process','For process (wash / dye) — expect return'],['return_vendor','Return to vendor'],['sale','Sale — walk-in'],['other','Other']],
  item:[['process','Sent out (repair) — expect return'],['other','Permanent out']]
};
const GP_REASON_LABEL={process:'For process',return_vendor:'Return to vendor',sale:'Sale',other:'Other'};
const GP_RET_TOL={kg:0.02,pcs:0.01,qty:0};   // ±2% wash/dye · ±1% garments · exact items
let _gpType='garments',_gpReason='other',_gpItemIdx=0,_gpRetSelGp=null;
function _gpTypeKind(t){return (t==='fabric_kg'||t==='fabric_m')?'fabric':(t==='item'?'item':'garments');}
function _gpUnitForPass(p){return p.gpType==='fabric'?(p.fabricUnit||'kg'):(p.gpType==='item'?'qty':'pcs');}
function _gpRetUnitKey(p){return p.gpType==='fabric'?'kg':(p.gpType==='item'?'qty':'pcs');}
function _gpSentQtyForPass(p){
  if(p.gpType==='fabric')return parseFloat(p.fabricQty)||0;
  if(p.gpType==='item')return (p.assetItems||[]).filter(i=>i.returnable).reduce((s,i)=>s+(parseFloat(i.qty)||0),0);
  return parseFloat(p.totalUnits)||0;
}
function _gpTolFor(p){const s=_gpSentQtyForPass(p);return +(s*(GP_RET_TOL[_gpRetUnitKey(p)]||0)).toFixed(2);}
function _gpReturnedSoFar(gpId){return allReturns.filter(r=>r.gpNum===gpId).reduce((s,r)=>s+(parseFloat(r.returnedQty)||0),0);}
function _gpDaysOut(p){const t=p.ts||0;if(!t)return 0;return Math.floor((Date.now()-t)/86400000);}
function _gpIsOverdue(p){if(!p.expectedBack)return false;const d=new Date(p.expectedBack+'T23:59:59');return Date.now()>d.getTime();}
// A pass is "outstanding" when it expects a return and isn't fully back yet.
function _gpIsOutstanding(p){
  if(!p.expectReturn)return false;
  const sent=_gpSentQtyForPass(p);if(sent<=0)return false;
  return _gpReturnedSoFar(p.id) < sent - _gpTolFor(p);
}
function _gpReturnStatus(p){
  const sent=_gpSentQtyForPass(p),back=_gpReturnedSoFar(p.id),tol=_gpTolFor(p);
  if(back>sent+tol)return'Overage';
  if(back>=sent-tol)return'Complete';
  if(_gpIsOverdue(p))return'Overdue';
  if(back>0)return'Partial';
  return'Open';
}

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
    <button class="gp-tab" id="gptab-registry" onclick="window.switchGPTab('registry')">Registry</button>
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
          ${GP_TYPE_OPTS.map(([v,l])=>`<option value="${v}"${v===_gpType?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Reason *</label>
        <div id="gp-reason-chips" style="display:flex;gap:6px;flex-wrap:wrap"></div>
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
      <div class="field" id="gp-vendor-field" style="display:none;grid-column:1/-1"><label>Purchased from — vendor to return to *</label><input id="gp-src-vendor" placeholder="Auto-suggested from the fabric's receipt — e.g. Gul Enterprises"></div>
      <div class="field" id="gp-expback-field" style="display:none"><label>Expected back by</label><input id="gp-exp-back" type="date">
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Flags the pass overdue if it hasn't fully returned by this date.</div></div>
    </div>
  </div>
  <div class="card" id="gp-garments-card"><div class="card-title">Units by size <span style="font-weight:400;color:var(--muted);font-size:11px">by bundle · one number per bundle (e.g. 9-8-6-7) · multiple bundles per size</span></div>
    <div id="gp-sizes"></div>
    <button type="button" class="btn-outline" style="font-size:12px;padding:6px 12px;margin-top:8px" onclick="window.gpAddSize()">+ Add size</button>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px">
      <div style="background:var(--dark);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.06em">Total units</div><div id="gp-t-units" style="font-size:18px;font-weight:700;color:#fff">0 pcs</div></div>
      <div style="background:var(--dark);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.06em">Total bundles</div><div id="gp-t-bundles" style="font-size:18px;font-weight:700;color:#fff">0</div></div>
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
  <div class="card" id="gp-item-card" style="display:none"><div class="card-title">Items / assets</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:300px">
      <thead><tr style="background:var(--dark)"><th style="padding:8px 10px;text-align:left;color:rgba(255,255,255,.55);font-size:10px;font-weight:500;text-transform:uppercase">Item</th><th style="padding:8px 10px;text-align:left;color:rgba(255,255,255,.55);font-size:10px;font-weight:500;text-transform:uppercase">Qty</th><th style="padding:8px 10px;text-align:center;color:rgba(255,255,255,.55);font-size:10px;font-weight:500;text-transform:uppercase">Returnable</th><th style="width:36px"></th></tr></thead>
      <tbody id="gp-item-body"></tbody>
    </table></div>
    <button onclick="window.addGPItemRow()" style="width:100%;padding:9px;background:none;border:none;border-top:1px solid var(--border);font-size:12px;color:var(--muted);cursor:pointer;font-family:inherit">+ Add item</button>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">Tick <b>Returnable</b> for anything that must come back (e.g. a machine sent for repair) — it becomes an outstanding line in Returns. One-way items don't.</div>
  </div>
  <div class="card" id="gp-sale-card" style="display:none"><div class="card-title">Sale — walk-in customer</div>
    <div class="form-grid">
      <div class="field"><label>Customer name *</label><input id="gp-sale-cust" placeholder="Walk-in customer name"></div>
      <div class="field"><label>Phone</label><input id="gp-sale-phone" placeholder="Optional"></div>
      <div class="field"><label>Rate (Rs per <span id="gp-sale-unit">kg</span>) *</label><input id="gp-sale-rate" type="number" min="0" step="0.01" placeholder="0" oninput="window.gpSaleRecalc()"></div>
      <div class="field"><label>Payment received into *</label><select id="gp-sale-acc" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#FAFAFA;color:var(--text);font-family:inherit;outline:none;width:100%"></select></div>
    </div>
    <div style="background:var(--dark);border-radius:9px;padding:12px;margin-top:12px;display:flex;justify-content:space-between;align-items:center;color:#fff">
      <div style="font-size:11px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.05em">Bill total</div>
      <div id="gp-sale-total" style="font-size:20px;font-weight:800">Rs 0</div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">On submit: prints the bill, deducts the picked rolls, and posts the amount as income to the Store Cash Ledger under “Fabric sale”.</div>
  </div>
  <button class="btn-primary" onclick="window.submitGP()" id="gp-submit-btn">Submit gate pass</button>
  <div class="card" style="margin-top:12px"><div class="card-title">Gate passes <span id="gp-count-lbl" style="font-weight:400;color:var(--muted);font-size:12px"></span></div>
    <div id="gp-list-body"></div>
    <div id="gp-pagination" style="display:flex;align-items:center;justify-content:center;gap:10px;padding-top:10px;border-top:1px solid #f5f5f5;margin-top:4px"></div>
  </div><div style="height:80px"></div>`;
}

function renderReturnsTab(){
  return`<div class="card"><div class="card-title">Outstanding · awaiting return</div>
    <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:12px">A pass sent <b>For process</b> (wash / dye / stitch) or a returnable item stays open until it's fully back — it can return in <b>several partial loads across days</b>. Tap one to record a load.</div>
    <div class="field" style="margin-bottom:12px"><label>Find by GP number</label><input id="ret-gp-find" placeholder="e.g. GP-124" oninput="window.gpFindReturn(this.value)"></div>
    <div id="gp-outstanding"></div>
  </div>
  <div class="card" id="gp-ret-form-card" style="display:none"></div>
  <div class="card"><div class="card-title">Returns history</div><div id="ret-list-body"></div></div>
  <div style="height:80px"></div>`;
}
function _gpRenderOutstanding(){
  const host=document.getElementById('gp-outstanding');if(!host)return;
  const open=allPasses.filter(_gpIsOutstanding).sort((a,b)=>(a.ts||0)-(b.ts||0));
  if(!open.length){host.innerHTML='<div class="empty" style="padding:16px;text-align:center">Nothing outstanding — every process pass is back. ✅</div>';return;}
  host.innerHTML=open.map(p=>{
    const unit=_gpRetUnitKey(p),sent=_gpSentQtyForPass(p),back=_gpReturnedSoFar(p.id),bal=+(sent-back).toFixed(2);
    const st=_gpReturnStatus(p);
    const stColor=st==='Overdue'?'#dc2626':(st==='Partial'?'#92400e':'#6b7280');
    const stBg=st==='Overdue'?'#fee2e2':(st==='Partial'?'#fef3c7':'#f3f4f6');
    const age=_gpIsOverdue(p)?'<span style="color:#dc2626;font-weight:700">overdue</span>':`<span style="color:var(--muted)">${_gpDaysOut(p)}d out</span>`;
    const pct=sent>0?Math.min(100,Math.round(back/sent*100)):0;
    const uL=unit==='qty'?'':(' '+unit);
    return`<div onclick="window.gpPickReturn('${p.id}')" style="border:1px solid ${_gpRetSelGp===p.id?'#111':'var(--border)'};border-radius:11px;padding:11px 13px;margin-bottom:9px;cursor:pointer">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div><span style="font-weight:700;color:var(--red);font-size:12px">${p.id}</span> <span style="font-size:13px;font-weight:500">${_gpEsc(p.article||'')}</span><div style="font-size:11px;color:var(--muted);margin-top:1px">${_gpEsc(p.dest||'')} · ${GP_REASON_LABEL[p.gpReason]||''}</div></div>
        <div style="text-align:right"><span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:7px;background:${stBg};color:${stColor}">${st}</span><div style="font-size:11px;margin-top:3px">${age}</div></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:9px;color:var(--muted)">
        <span>sent <b style="color:var(--text)">${sent}${uL}</b></span><span>back <b style="color:var(--text)">${back}${uL}</b></span><span>still out <b style="color:#dc2626">${bal}${uL}</b></span>
      </div>
      <div style="height:7px;border-radius:5px;background:#f0f0f0;overflow:hidden;margin-top:8px"><div style="height:100%;width:${pct}%;background:#16a34a"></div></div>
    </div>`;
  }).join('');
}
window.gpFindReturn=function(v){const gp=(v||'').trim().toUpperCase();const p=allPasses.find(x=>x.id===gp);if(p&&_gpIsOutstanding(p))window.gpPickReturn(p.id);};
window.gpPickReturn=function(gpId){
  const p=allPasses.find(x=>x.id===gpId);if(!p){showToast('Pass not found.',true);return;}
  if(!p.expectReturn){showToast('This pass does not expect a return.',true);return;}
  _gpRetSelGp=gpId;_gpRenderOutstanding();
  const unit=_gpRetUnitKey(p),sent=_gpSentQtyForPass(p),back=_gpReturnedSoFar(gpId),bal=+(sent-back).toFixed(2),tol=_gpTolFor(p);
  const uL=unit==='qty'?'units':unit;
  const hist=allReturns.filter(r=>r.gpNum===gpId).sort((a,b)=>(b.ts||0)-(a.ts||0));
  const histHtml=hist.length?`<div style="margin-top:12px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:5px">Return loads</div>${hist.map(h=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid #f5f5f5"><span style="color:var(--muted)">${h.date||''} · ${_gpEsc(h.receivedBy||'')}</span><span style="font-weight:700;color:#16a34a">+${h.returnedQty} ${uL}</span></div>`).join('')}</div>`:'';
  const card=document.getElementById('gp-ret-form-card');if(!card)return;
  card.style.display='block';
  card.innerHTML=`<div class="card-title">Record return · ${p.id}</div>
    <div style="background:#f7f7f8;border-radius:9px;padding:11px 13px;font-size:12.5px;margin-bottom:12px">Sent <b>${sent} ${uL}</b> · already back <b>${back} ${uL}</b> · <b style="color:#dc2626">${bal} ${uL}</b> still out. Tolerance ±${tol} ${uL}.</div>
    <div class="form-grid">
      <div class="field"><label>Return date</label><input id="ret2-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="field"><label>This load (${uL}) *</label><input id="ret2-qty" type="number" min="0" step="0.01" placeholder="0" oninput="window.gpRetPreview()"></div>
    </div>
    <div id="ret2-preview" style="margin:8px 0"></div>
    <div class="field"><label>Notes</label><input id="ret2-notes" placeholder="Optional — e.g. first wash lot"></div>
    <button class="btn-primary" style="margin-top:10px" onclick="window.submitReturn()">Add return</button>
    ${histHtml}`;
  card.scrollIntoView({behavior:'smooth',block:'nearest'});
};
window.gpRetPreview=function(){
  const p=allPasses.find(x=>x.id===_gpRetSelGp);if(!p)return;
  const q=parseFloat(document.getElementById('ret2-qty')?.value)||0;
  const sent=_gpSentQtyForPass(p),back=_gpReturnedSoFar(p.id),tol=_gpTolFor(p),unit=_gpRetUnitKey(p);
  const uL=unit==='qty'?'units':unit;const el=document.getElementById('ret2-preview');if(!el)return;
  if(!q){el.innerHTML='';return;}
  const nb=back+q;
  if(nb>sent+tol)el.innerHTML=`<div style="background:#fee2e2;border-radius:8px;padding:9px 11px;font-size:12px;color:#991b1b"><b>Overage</b> — ${(nb-sent).toFixed(2)} ${uL} more than sent. Verify.</div>`;
  else if(nb>=sent-tol)el.innerHTML=`<div style="background:#dcfce7;border-radius:8px;padding:9px 11px;font-size:12px;color:#166534"><b>Will complete</b> — ${nb.toFixed(2)}/${sent} ${uL} back, pass closes.</div>`;
  else el.innerHTML=`<div style="background:#fef3c7;border-radius:8px;padding:9px 11px;font-size:12px;color:#92400e"><b>Stays open</b> — ${(sent-nb).toFixed(2)} ${uL} still out after this load.</div>`;
};

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
  body.innerHTML=slice.map(_gpPassRowHtml).join('')||'<div class="empty" style="padding:1rem">No gate passes yet.</div>';
  if(pg){
    if(pages<=1){pg.innerHTML='';return;}
    pg.innerHTML=`
      <button onclick="window.gpGotoPage(${gpPage-1})" ${gpPage===1?'disabled':''} style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit;color:var(--text)">← Prev</button>
      <span style="font-size:12px;color:var(--muted)">Page ${gpPage} of ${pages}</span>
      <button onclick="window.gpGotoPage(${gpPage+1})" ${gpPage===pages?'disabled':''} style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit;color:var(--text)">Next →</button>`;
  }
}
window.gpGotoPage=function(n){gpPage=n;renderGPPage();};

// Shared pass-row markup, reused by the Outward list and the Registry.
function _gpPassRowHtml(p){
  const pend=_gpPendingFor('gp',p.id);
  const pendBadge=pend?`<span title="${pend.action==='delete'?'Delete':'Edit'} pending approval" style="display:inline-block;background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;margin-left:6px">${pend.action==='delete'?'Delete':'Edit'} pending</span>`:'';
  const isFab=p.gpType==='fabric',isItem=p.gpType==='item';
  const typeBadge=isFab?`<span style="display:inline-block;background:#dbeafe;color:#1e40af;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;margin-left:6px">Fabric</span>`:(isItem?`<span style="display:inline-block;background:#ede9fe;color:#5b21b6;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;margin-left:6px">Item</span>`:'');
  const reasonBadge=p.gpReason&&p.gpReason!=='other'?`<span style="display:inline-block;background:#f3f4f6;color:#374151;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;margin-left:6px">${GP_REASON_LABEL[p.gpReason]||p.gpReason}</span>`:'';
  const retBadge=p.expectReturn?(()=>{const st=_gpReturnStatus(p);const c=st==='Overdue'?'#dc2626':(st==='Partial'?'#92400e':'#6b7280');const b=st==='Overdue'?'#fee2e2':(st==='Partial'?'#fef3c7':'#f3f4f6');return `<span style="display:inline-block;background:${b};color:${c};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px">${st}</span>`;})():(p.returnStatus==='Complete'?`<span style="display:inline-block;background:#dcfce7;color:#166534;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px">Returned</span>`:'');
  const qtyLabel=isFab?`${p.fabricQty||0} ${p.fabricUnit||'kg'}${p.rollsCount?` · ${p.rollsCount} rolls`:''}`:(isItem?`${(p.assetItems||[]).length} item${(p.assetItems||[]).length===1?'':'s'}`:`${p.totalUnits||0} pcs`);
  return`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f5f5f5;flex-wrap:wrap;gap:8px">
    <div><div style="font-weight:700;color:var(--red);font-size:11px">${p.id}${typeBadge}${reasonBadge}${retBadge}${pendBadge}</div><div style="font-size:13px;font-weight:500">${p.article||'—'}${p.spec?` <span style="font-weight:400;color:var(--muted)">· ${_gpEsc(p.spec)}</span>`:''}</div><div style="font-size:11px;color:var(--muted)">${p.name||'—'} · ${p.date||''}${p.time?' '+p.time:''} · ${p.dest||'—'}</div></div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><div style="text-align:right;font-size:12px;color:var(--muted);font-weight:500">${qtyLabel}</div>
    <button class="btn-pdf" onclick="window.generateGPPdf('${p.id}')">⬇ PDF</button>
    <button onclick="window.editGP('${p.id}')" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Edit</button>
    <button onclick="window.requestDeleteGP('${p.id}')" style="padding:4px 10px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:11px;cursor:pointer;font-family:inherit">Delete</button>
    </div>
  </div>`;
}

// ── Registry: every pass in one searchable, filterable, exportable place ──
let _gpRegQ='',_gpRegType='all',_gpRegReason='all',_gpRegIssuer='all',_gpRegFrom='',_gpRegTo='',_gpRegPage=1,_gpRegPer=25;
function renderGPRegistry(){
  const issuers=[...new Set(allPasses.map(p=>p.issuer||p.name).filter(Boolean))].sort();
  return`<div class="card"><div class="card-title">Gate pass registry <span id="gp-reg-count" style="font-weight:400;color:var(--muted);font-size:12px"></span></div>
    <input id="gp-reg-search" value="${_gpRegQ.replace(/"/g,'&quot;')}" oninput="window.gpRegSearch(this.value)" placeholder="Search GP #, article, spec, PO, destination, person…" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;outline:none;margin-bottom:10px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div class="field" style="margin:0;min-width:130px"><label>Type</label>
        <select onchange="window.gpRegSet('type',this.value)" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#FAFAFA;color:var(--text);font-family:inherit;width:100%">
          ${[['all','All types'],['fabric','Fabric'],['garments','Garments'],['item','Item / asset']].map(([v,l])=>`<option value="${v}"${_gpRegType===v?' selected':''}>${l}</option>`).join('')}
        </select></div>
      <div class="field" style="margin:0;min-width:150px"><label>Reason</label>
        <select onchange="window.gpRegSet('reason',this.value)" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#FAFAFA;color:var(--text);font-family:inherit;width:100%">
          ${[['all','All reasons'],['process','For process'],['return_vendor','Return to vendor'],['sale','Sale'],['other','Other']].map(([v,l])=>`<option value="${v}"${_gpRegReason===v?' selected':''}>${l}</option>`).join('')}
        </select></div>
      <div class="field" style="margin:0;min-width:150px"><label>Issued by</label>
        <select onchange="window.gpRegSet('issuer',this.value)" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#FAFAFA;color:var(--text);font-family:inherit;width:100%">
          <option value="all"${_gpRegIssuer==='all'?' selected':''}>Everyone</option>
          ${issuers.map(i=>`<option value="${_gpEsc(i)}"${_gpRegIssuer===i?' selected':''}>${_gpEsc(i)}</option>`).join('')}
        </select></div>
      <div class="field" style="margin:0;min-width:130px"><label>From date</label><input type="date" value="${_gpRegFrom}" onchange="window.gpRegSet('from',this.value)" style="padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#FAFAFA;color:var(--text);font-family:inherit;width:100%"></div>
      <div class="field" style="margin:0;min-width:130px"><label>To date</label><input type="date" value="${_gpRegTo}" onchange="window.gpRegSet('to',this.value)" style="padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#FAFAFA;color:var(--text);font-family:inherit;width:100%"></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-outline" style="font-size:12px;padding:6px 12px" onclick="window.gpRegClear()">Clear filters</button>
        <label style="font-size:11px;color:var(--muted)">Per page
          <select onchange="window.gpRegSet('per',this.value)" style="margin-left:4px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit">
            ${[25,50,100,200].map(n=>`<option value="${n}"${_gpRegPer===n?' selected':''}>${n}</option>`).join('')}
          </select></label>
      </div>
      <button class="btn-outline" style="font-size:12px;padding:6px 14px" onclick="window.gpRegExport()">⬇ Export Excel</button>
    </div>
    <div id="gp-reg-body"></div>
    <div id="gp-reg-pager" style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;padding-top:10px;border-top:1px solid #f5f5f5;margin-top:4px"></div>
  </div><div style="height:80px"></div>`;
}
function _gpRegFiltered(){
  const q=_gpRegQ.toLowerCase().trim();
  return allPasses.filter(p=>{
    if(_gpRegType!=='all'&&(p.gpType||'garments')!==_gpRegType)return false;
    if(_gpRegReason!=='all'&&(p.gpReason||'other')!==_gpRegReason)return false;
    if(_gpRegIssuer!=='all'&&(p.issuer||p.name)!==_gpRegIssuer)return false;
    if(_gpRegFrom&&(p.date||'')<_gpRegFrom)return false;
    if(_gpRegTo&&(p.date||'')>_gpRegTo)return false;
    if(q){const hay=`${p.id||''} ${p.article||''} ${p.spec||''} ${p.dest||''} ${p.name||''} ${p.issuer||''} ${p.poId||''} ${p.sourceVendor||''} ${GP_REASON_LABEL[p.gpReason]||''} ${p.gpType||''}`.toLowerCase();if(!hay.includes(q))return false;}
    return true;
  }).sort((a,b)=>(b.ts||0)-(a.ts||0));
}
function _gpRegRender(){
  const body=document.getElementById('gp-reg-body');if(!body)return;
  const all=_gpRegFiltered();
  const total=all.length;
  const pages=Math.max(1,Math.ceil(total/_gpRegPer));
  if(_gpRegPage>pages)_gpRegPage=pages;
  const slice=all.slice((_gpRegPage-1)*_gpRegPer,_gpRegPage*_gpRegPer);
  const cnt=document.getElementById('gp-reg-count');if(cnt)cnt.textContent=`(${total} match${total===1?'':'es'} of ${allPasses.length})`;
  body.innerHTML=slice.map(_gpPassRowHtml).join('')||'<div class="empty" style="padding:20px;text-align:center">No passes match these filters.</div>';
  const pg=document.getElementById('gp-reg-pager');if(!pg)return;
  if(pages<=1){pg.innerHTML='';return;}
  const btn=(n,l,dis,cur)=>`<button onclick="window.gpRegGoto(${n})" ${dis?'disabled':''} style="padding:5px 11px;border:1px solid ${cur?'#111':'var(--border)'};border-radius:6px;background:${cur?'#111':'#fff'};color:${cur?'#fff':'var(--text)'};cursor:pointer;font-size:12px;font-family:inherit">${l}</button>`;
  let nums='';const from=Math.max(1,_gpRegPage-2),to=Math.min(pages,_gpRegPage+2);
  if(from>1)nums+=btn(1,'1',false,false)+(from>2?'<span style="color:var(--muted)">…</span>':'');
  for(let n=from;n<=to;n++)nums+=btn(n,String(n),false,n===_gpRegPage);
  if(to<pages)nums+=(to<pages-1?'<span style="color:var(--muted)">…</span>':'')+btn(pages,String(pages),false,false);
  pg.innerHTML=`${btn(_gpRegPage-1,'← Prev',_gpRegPage===1,false)}${nums}${btn(_gpRegPage+1,'Next →',_gpRegPage===pages,false)}
    <span style="font-size:12px;color:var(--muted);margin-left:6px">go to <input type="number" min="1" max="${pages}" value="${_gpRegPage}" onchange="window.gpRegGoto(parseInt(this.value)||1)" style="width:52px;padding:4px;border:1px solid var(--border);border-radius:6px;font-size:12px;text-align:center;font-family:inherit"></span>`;
}
let _gpRegTo2=null;
window.gpRegSearch=function(v){_gpRegQ=v||'';_gpRegPage=1;clearTimeout(_gpRegTo2);_gpRegTo2=setTimeout(()=>{_gpRegRender();const i=document.getElementById('gp-reg-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}},160);};
window.gpRegSet=function(k,v){if(k==='type')_gpRegType=v;else if(k==='reason')_gpRegReason=v;else if(k==='issuer')_gpRegIssuer=v;else if(k==='from')_gpRegFrom=v;else if(k==='to')_gpRegTo=v;else if(k==='per')_gpRegPer=parseInt(v)||25;_gpRegPage=1;_gpRegRender();};
window.gpRegGoto=function(n){_gpRegPage=Math.max(1,n);_gpRegRender();};
window.gpRegClear=function(){_gpRegQ='';_gpRegType='all';_gpRegReason='all';_gpRegIssuer='all';_gpRegFrom='';_gpRegTo='';_gpRegPage=1;const el=document.getElementById('gp-tab-content');if(el){el.innerHTML=renderGPRegistry();_gpRegRender();}};
window.gpRegExport=function(){
  const rows=_gpRegFiltered();
  if(!rows.length){showToast('Nothing to export.',true);return;}
  const header=['Date','Time','GP','Type','Reason','Article','Spec','PO','Destination','Qty','Unit','Rolls','Boras','Expected back','Return status','Issued by'];
  const aoa=[header,...rows.map(p=>{
    const isFab=p.gpType==='fabric',isItem=p.gpType==='item';
    const qty=isFab?(p.fabricQty||0):(isItem?(p.totalUnits||0):(p.totalUnits||0));
    const unit=isFab?(p.fabricUnit||'kg'):(isItem?'qty':'pcs');
    const retSt=p.expectReturn?_gpReturnStatus(p):(p.returnStatus||'');
    return [p.date||'',p.time||'',p.id||'',p.gpType||'garments',GP_REASON_LABEL[p.gpReason]||p.gpReason||'',p.article||'',p.spec||'',p.poId||'',p.dest||'',qty,unit,p.rollsCount||'',p.boras||'',p.expectedBack||'',retSt,p.issuer||p.name||''];
  })];
  if(typeof _fabXlsx==='function')_fabXlsx(aoa,'Gate Passes','gate-pass-registry');
  else{const ws=XLSX.utils.aoa_to_sheet(aoa);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Gate Passes');XLSX.writeFile(wb,'gate-pass-registry.xlsx');}
  showToast('Exported ✓');
};
window.setDest=function(v){document.getElementById('gp-dest').value=v;};
// Garments go out in BUNDLES (like cutting): per size, one number per bundle
// e.g. "9-8-6-7" → 4 bundles, 30 pcs. Same model as the fabric Issue.
let _gpSizes=[{size:'',bundles:''}];
function _gpParseBundles(str){return typeof _fabParseBundles==='function'?_fabParseBundles(str):String(str==null?'':str).split(/[^0-9.]+/).map(x=>parseFloat(x)).filter(x=>!isNaN(x)&&x>0);}
function _gpSyncSizesFromDOM(){
  const rows=document.querySelectorAll('#gp-sizes .gps-row');
  if(!rows.length)return;
  _gpSizes=Array.from(rows).map(r=>({size:r.querySelector('.gps-size')?.value||'',bundles:r.querySelector('.gps-bundles')?.value||''}));
}
function _gpRenderSizes(){
  const el=document.getElementById('gp-sizes');if(!el)return;
  if(!_gpSizes.length)_gpSizes=[{size:'',bundles:''}];
  el.innerHTML=`<div style="display:grid;grid-template-columns:1fr 2.2fr .8fr .9fr 28px;gap:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:0 2px 6px"><span>Size</span><span>Bundles (e.g. 9-8-6-7)</span><span style="text-align:center"># Bundles</span><span style="text-align:right">Qty</span><span></span></div>`+
    _gpSizes.map((s,i)=>{const arr=_gpParseBundles(s.bundles);const q=arr.reduce((a,b)=>a+b,0);
      return`<div class="gps-row" style="display:grid;grid-template-columns:1fr 2.2fr .8fr .9fr 28px;gap:8px;align-items:center;margin-bottom:8px">
        <input class="gps-size" value="${_gpEsc(s.size)}" placeholder="e.g. M" oninput="window.gpRecalc()" style="margin:0;font-size:15px;padding:9px 10px;border:1px solid var(--border);border-radius:8px;box-sizing:border-box">
        <input class="gps-bundles" value="${_gpEsc(s.bundles)}" placeholder="9-8-6-7" oninput="window.gpRecalc()" style="margin:0;font-size:15px;padding:9px 10px;border:1px solid var(--border);border-radius:8px;box-sizing:border-box">
        <span class="gps-nb" style="text-align:center;font-weight:700;font-size:14px;color:var(--muted)">${arr.length||'—'}</span>
        <span class="gps-qty" style="text-align:right;font-weight:800;font-size:16px">${q?q.toLocaleString():'—'}</span>
        <button type="button" onclick="window.gpRemoveSize(${i})" title="Remove" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:20px;padding:0;line-height:1">×</button>
      </div>`;}).join('');
  window.gpRecalc();
}
window.gpAddSize=function(){_gpSyncSizesFromDOM();_gpSizes.push({size:'',bundles:''});_gpRenderSizes();};
window.gpRemoveSize=function(i){_gpSyncSizesFromDOM();_gpSizes.splice(i,1);if(!_gpSizes.length)_gpSizes=[{size:'',bundles:''}];_gpRenderSizes();};
window.gpRecalc=function(){
  let tot=0,tb=0;
  document.querySelectorAll('#gp-sizes .gps-row').forEach(r=>{
    const arr=_gpParseBundles(r.querySelector('.gps-bundles')?.value);const q=arr.reduce((a,b)=>a+b,0);
    tot+=q;tb+=arr.length;
    const nc=r.querySelector('.gps-nb');if(nc)nc.textContent=arr.length||'—';
    const qc=r.querySelector('.gps-qty');if(qc)qc.textContent=q?q.toLocaleString():'—';
  });
  const tu=document.getElementById('gp-t-units');if(tu)tu.textContent=tot.toLocaleString()+' pcs';
  const tbd=document.getElementById('gp-t-bundles');if(tbd)tbd.textContent=tb.toLocaleString();
  if(window.gpSaleRecalc)window.gpSaleRecalc();
};

window.onGPTypeChange=function(){
  const t=document.getElementById('gp-type')?.value||'garments';
  _gpType=t;const kind=_gpTypeKind(t);
  const garmCard=document.getElementById('gp-garments-card');
  const fabCard=document.getElementById('gp-fabric-card');
  const itemCard=document.getElementById('gp-item-card');
  if(garmCard)garmCard.style.display=(kind==='garments')?'block':'none';
  if(fabCard)fabCard.style.display=(kind==='fabric')?'block':'none';
  if(itemCard)itemCard.style.display=(kind==='item')?'block':'none';
  if(kind==='fabric'){
    const unit=t==='fabric_m'?'meters':'kg';
    const lblEl=document.getElementById('gp-fab-unit-label');if(lblEl)lblEl.textContent=unit==='kg'?'weight (kg)':'length (meters)';
    const totLblEl=document.getElementById('gp-fab-tot-label');if(totLblEl)totLblEl.textContent=unit==='kg'?'weight':'length';
    _populateFabStockSelect(unit);
    _gpOutwardFabRolls=[];
    const w=document.getElementById('gp-fab-rolls-pick-wrap');if(w)w.innerHTML='';
    window.gpFabRecalc();
  }
  if(kind==='item'){const b=document.getElementById('gp-item-body');if(b&&!b.children.length){window.addGPItemRow();window.addGPItemRow();}}
  const opts=GP_REASON_OPTS[t]||GP_REASON_OPTS.garments;
  if(!opts.some(o=>o[0]===_gpReason))_gpReason=opts[0][0];
  _gpRenderReasonChips();_gpApplyReasonFields();
};

function _gpRenderReasonChips(){
  const host=document.getElementById('gp-reason-chips');if(!host)return;
  const opts=GP_REASON_OPTS[_gpType]||GP_REASON_OPTS.garments;
  host.innerHTML=opts.map(([v,l])=>`<button type="button" onclick="window.gpSetReason('${v}')" style="border:1px solid ${_gpReason===v?'#111':'var(--border)'};background:${_gpReason===v?'#111':'#fff'};color:${_gpReason===v?'#fff':'var(--text)'};border-radius:999px;padding:6px 13px;font-size:12px;cursor:pointer;font-family:inherit">${l}</button>`).join('');
}
window.gpSetReason=function(r){_gpReason=r;_gpRenderReasonChips();_gpApplyReasonFields();};

function _gpApplyReasonFields(){
  const kind=_gpTypeKind(_gpType);
  const vend=document.getElementById('gp-vendor-field');
  const exp=document.getElementById('gp-expback-field');
  const sale=document.getElementById('gp-sale-card');
  if(vend)vend.style.display=(_gpReason==='return_vendor'&&kind==='fabric')?'block':'none';
  if(exp){
    exp.style.display=(_gpReason==='process')?'block':'none';
    const inp=document.getElementById('gp-exp-back');
    if(inp&&_gpReason==='process'&&!inp.value){const d=new Date();d.setDate(d.getDate()+7);inp.value=d.toISOString().split('T')[0];}
  }
  const showSale=(_gpReason==='sale');
  if(sale){sale.style.display=showSale?'block':'none';if(showSale)_gpPopulateSaleAccounts();}
  const unitEl=document.getElementById('gp-sale-unit');if(unitEl)unitEl.textContent=(kind==='fabric')?(_gpType==='fabric_m'?'meter':'kg'):(kind==='item'?'item':'pc');
  const btn=document.getElementById('gp-submit-btn');if(btn)btn.textContent=showSale?'Submit pass + print bill':'Submit gate pass';
  if(window.gpSaleRecalc)window.gpSaleRecalc();
}

window.addGPItemRow=function(name='',qty='',returnable=false){
  _gpItemIdx++;const id='gpi'+_gpItemIdx;const tb=document.getElementById('gp-item-body');if(!tb)return;
  const tr=document.createElement('tr');tr.id=id;tr.style.borderBottom='1px solid #f5f5f5';
  tr.innerHTML=`<td style="padding:4px 8px"><input type="text" value="${_gpEsc(name)}" placeholder="e.g. Office table" style="width:100%;border:none;border-bottom:1px solid var(--border);padding:5px 4px;font-size:13px;background:transparent;color:var(--text);outline:none" oninput="window.gpSaleRecalc&&window.gpSaleRecalc()"></td>
    <td style="padding:4px 8px"><input type="number" min="0" value="${qty}" placeholder="1" style="width:70px;border:none;border-bottom:1px solid var(--border);padding:5px 4px;font-size:13px;background:transparent;color:var(--text);outline:none" oninput="window.gpSaleRecalc&&window.gpSaleRecalc()"></td>
    <td style="padding:4px 8px;text-align:center"><input type="checkbox" class="gp-item-ret" ${returnable?'checked':''} style="width:15px;height:15px;cursor:pointer"></td>
    <td><button onclick="document.getElementById('${id}').remove()" style="background:none;border:none;color:#ccc;font-size:16px;cursor:pointer;padding:2px 6px">×</button></td>`;
  tb.appendChild(tr);
};

function _gpPopulateSaleAccounts(){
  const sel=document.getElementById('gp-sale-acc');if(!sel||sel.dataset.filled)return;
  let accs=(typeof allCashAccounts!=='undefined'&&allCashAccounts&&allCashAccounts.length)?allCashAccounts:[];
  if(!accs.length&&typeof CASH_ACCOUNTS!=='undefined')accs=CASH_ACCOUNTS.map(a=>({_id:a.key,label:a.label}));
  sel.innerHTML=(accs.length?accs:[{_id:'cash',label:'Cash drawer'}]).map(a=>`<option value="${a._id||a.key}">${_gpEsc(a.label||a.key)}</option>`).join('');
  sel.dataset.filled='1';
}

window.gpSaleRecalc=function(){
  const kind=_gpTypeKind(_gpType);let qty=0;
  if(kind==='fabric')qty=parseFloat(document.getElementById('gp-fab-qty')?.value)||0;
  else if(kind==='garments')document.querySelectorAll('#gp-sizes .gps-row').forEach(r=>{qty+=_gpParseBundles(r.querySelector('.gps-bundles')?.value).reduce((a,b)=>a+b,0);});
  else document.querySelectorAll('#gp-item-body tr').forEach(r=>{const i=r.querySelectorAll('input');qty+=parseFloat(i[1]?.value)||0;});
  const rate=parseFloat(document.getElementById('gp-sale-rate')?.value)||0;
  const tot=Math.round(qty*rate);
  const el=document.getElementById('gp-sale-total');if(el)el.textContent='Rs '+tot.toLocaleString('en-US');
  return tot;
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
  window.gpFabRecalc();if(window.gpSaleRecalc)window.gpSaleRecalc();
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
  const type=document.getElementById('gp-type')?.value||'garments';
  const kind=_gpTypeKind(type);
  const reason=_gpReason;
  const isSale=reason==='sale';
  const cust=document.getElementById('gp-sale-cust')?.value.trim()||'';
  if(!article){showToast('Article / description required.',true);return;}
  if(isSale){if(!cust){showToast('Customer name required for a sale.',true);return;}}
  else if(!dest){showToast('Destination required.',true);return;}
  if(kind!=='item'&&!spec){showToast('Specification is required.',true);return;}
  if(reason==='return_vendor'&&kind==='fabric'&&!(document.getElementById('gp-src-vendor')?.value.trim())){showToast('Enter the vendor to return to.',true);return;}
  let payload,inventoryUpdate=null,saleObj=null;
  try{
    const next=await getNextId('gatepasses');
    const gpId='GP-'+String(next).padStart(3,'0');
    const expectedBack=(reason==='process')?(document.getElementById('gp-exp-back')?.value||''):'';
    const destFinal=isSale?(cust||dest):dest;
    const base={id:gpId,ts:Date.now(),name:session.name,issuer:session.name,article,spec,dest:destFinal,date:document.getElementById('gp-date')?.value,time:document.getElementById('gp-time')?.value,purpose:document.getElementById('gp-purpose')?.value?.trim()||'',gpReason:reason,expectedBack};
    if(kind==='fabric'){
      const fabUnit=type==='fabric_m'?'meters':'kg';
      const stockKey=document.getElementById('gp-fab-stock')?.value||'';
      if(!stockKey){showToast('Pick a fabric stock row.',true);return;}
      if(!_gpOutwardFabRolls.length){showToast('Select at least one roll.',true);return;}
      const stock=allFabricInventory.find(s=>s._id===stockKey);
      if(!stock){showToast('Fabric stock not found.',true);return;}
      const fabQty=parseFloat(document.getElementById('gp-fab-qty')?.value)||0;
      const rollCodes=_gpOutwardFabRolls.map(r=>r.rollCode);
      payload={...base,gpType:'fabric',fabricUnit:fabUnit,fabricQty:fabQty,rollsCount:rollCodes.length,rollCodes,fabricType:stock.fabType,fabricGsm:stock.gsm,fabricColor:stock.color,inventoryKey:stockKey,boras:'0',items:[],totalUnits:0,totalWeight:fabUnit==='kg'?fabQty:0,totalLength:fabUnit==='meters'?fabQty:0,expectReturn:reason==='process'};
      if(reason==='return_vendor')payload.sourceVendor=document.getElementById('gp-src-vendor')?.value.trim()||'';
      inventoryUpdate={fabType:stock.fabType,gsm:stock.gsm,color:stock.color,unit:stock.unit||fabUnit,removeRollCodes:rollCodes,reason,note:`GP ${gpId} · ${GP_REASON_LABEL[reason]||reason} → ${destFinal}`,sourceCol:'gatepasses',sourceId:gpId};
    }else if(kind==='item'){
      const assetItems=[];document.querySelectorAll('#gp-item-body tr').forEach(r=>{const i=r.querySelectorAll('input');const nm=i[0]?.value.trim();if(nm)assetItems.push({name:nm,qty:parseFloat(i[1]?.value)||0,returnable:!!r.querySelector('.gp-item-ret')?.checked});});
      if(!assetItems.length){showToast('Add at least one item.',true);return;}
      const anyRet=assetItems.some(i=>i.returnable);
      payload={...base,gpType:'item',assetItems,boras:'0',items:[],totalUnits:assetItems.reduce((s,i)=>s+(i.qty||0),0),totalWeight:0,expectReturn:reason==='process'&&anyRet};
    }else{
      _gpSyncSizesFromDOM();
      const items=_gpSizes.map(s=>({size:(s.size||'').trim(),bundles:_gpParseBundles(s.bundles)}))
        .filter(s=>s.size&&s.bundles.length)
        .map(s=>({...s,bundleCount:s.bundles.length,units:s.bundles.reduce((a,b)=>a+b,0)}));
      if(!items.length){showToast('Add at least one size with bundles.',true);return;}
      const totalBundles=items.reduce((s,r)=>s+r.bundleCount,0);
      payload={...base,gpType:'garments',boras:document.getElementById('gp-boras')?.value||'0',totalUnits:items.reduce((s,r)=>s+r.units,0),totalBundles,totalWeight:0,items,expectReturn:reason==='process'};
    }
    if(isSale){
      const rate=parseFloat(document.getElementById('gp-sale-rate')?.value)||0;
      if(rate<=0){showToast('Enter a sale rate.',true);return;}
      const qtyForSale=(kind==='fabric')?(payload.fabricQty||0):(payload.totalUnits||0);
      saleObj={customer:cust,phone:document.getElementById('gp-sale-phone')?.value.trim()||'',rate,amount:Math.round(qtyForSale*rate),account:document.getElementById('gp-sale-acc')?.value||'',unit:(kind==='fabric')?(payload.fabricUnit||'kg'):'pcs'};
      payload.sale=saleObj;payload.expectReturn=false;
    }
    await setDoc(doc(db,'gatepasses',gpId),payload);
    if(inventoryUpdate)await _fabInvUpsert(inventoryUpdate);
    if(isSale&&saleObj&&saleObj.amount>0){
      try{
        if(typeof loadStoreCashData==='function'&&typeof cashDataLoaded!=='undefined'&&!cashDataLoaded)await loadStoreCashData();
        if(typeof _cashPost==='function'){
          const row=await _cashPost({kind:'income',account:saleObj.account,amount:saleObj.amount,category:'Fabric sale',note:`${gpId} · ${saleObj.customer} · ${article}`,ref:gpId,by:session.name,ts:Date.now(),date:base.date||(typeof todayStr==='function'?todayStr():'')});
          if(row&&row._id)await updateDoc(doc(db,'gatepasses',gpId),{cashLedgerId:row._id});
        }
      }catch(e){showToast('Pass saved, but cash post failed: '+e.message,true);}
    }
    await logActivity('Gate pass issued',`${gpId} — ${article} · ${GP_REASON_LABEL[reason]||reason} → ${destFinal}${kind==='fabric'?' (fabric · '+_gpOutwardFabRolls.length+' rolls)':''}${isSale?' · sale Rs '+(saleObj?saleObj.amount:0):''}`);
    await loadData();
    if(isSale&&typeof window.generateGPPdf==='function'){showToast(gpId+' issued ✓ · printing bill');window.generateGPPdf(gpId);}
    else showToast(gpId+' issued ✓');
    window.showPage('gatepass');
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
    _gpSizes=['XS','S','M','L','XL','2XL'].map(s=>({size:s,bundles:''}));_gpRenderSizes();
    window.onGPTypeChange();
    renderGPPage();
  }else if(tab==='returns'){
    _gpRetSelGp=null;
    el.innerHTML=renderReturnsTab();
    _gpRenderOutstanding();
    renderReturnsList();
  }else if(tab==='registry'){
    el.innerHTML=renderGPRegistry();
    _gpRegRender();
  }
};

// ── Returns — cumulative, multi-day, unit-aware ──
window.submitReturn=async function(){
  const p=allPasses.find(x=>x.id===_gpRetSelGp);
  if(!p){showToast('Pick an outstanding pass first.',true);return;}
  const qty=parseFloat(document.getElementById('ret2-qty')?.value)||0;
  if(qty<=0){showToast('Enter the returned quantity.',true);return;}
  const date=document.getElementById('ret2-date')?.value||'';
  const notes=(document.getElementById('ret2-notes')?.value||'').trim();
  const unit=_gpRetUnitKey(p),sent=_gpSentQtyForPass(p),tol=_gpTolFor(p);
  const prevBack=_gpReturnedSoFar(p.id),newBack=+(prevBack+qty).toFixed(2);
  const status=newBack>sent+tol?'Overage':(newBack>=sent-tol?'Complete':'Partial');
  const closed=(status==='Complete'||status==='Overage');
  try{
    const next=await getNextId('returns');
    const retId='RET-'+String(next).padStart(3,'0');
    const rec={id:retId,ts:Date.now(),gpNum:p.id,vendor:p.dest||'',article:p.article||'',unit,sentQty:sent,returnedQty:qty,cumulative:newBack,shortage:Math.max(0,+(sent-newBack).toFixed(2)),status,date,receivedBy:session.name,notes};
    await setDoc(doc(db,'returns',retId),rec);
    await updateDoc(doc(db,'gatepasses',p.id),{returnedQty:newBack,returnStatus:status,expectReturn:closed?false:true,closedAt:closed?Date.now():null});
    // Fabric sent for a process → re-add this load's weight to inventory.
    if(p.gpType==='fabric'&&p.fabricType&&p.gpReason==='process'){
      try{
        const rc=`RET-${p.id}-R${allReturns.filter(r=>r.gpNum===p.id).length+1}`;
        await _fabInvUpsert({fabType:p.fabricType,gsm:p.fabricGsm,color:p.fabricColor,unit:p.fabricUnit||'kg',addRolls:[{rollCode:rc,weight:qty,gsm:p.fabricGsm}],note:`Returned from ${p.dest||'process'} · ${p.id}`,sourceCol:'gatepasses',sourceId:p.id});
      }catch(e){showToast('Return saved, but stock re-add failed: '+e.message,true);}
    }
    await logActivity('Return recorded',`${retId} — ${p.id} +${qty} ${unit} (${newBack}/${sent}) ${status} by ${session.name}`);
    showToast(`${retId} saved ✓ · ${status}`);
    await loadData();
    try{const snap=await getDocs(query(collection(db,'returns'),orderBy('ts','desc')));allReturns=snap.docs.map(d=>d.data());}catch(e){}
    _gpRenderOutstanding();renderReturnsList();
    if(closed){_gpRetSelGp=null;const c=document.getElementById('gp-ret-form-card');if(c)c.style.display='none';}
    else window.gpPickReturn(p.id);
  }catch(e){showToast('Error: '+e.message,true);}
};

function renderReturnsList(){
  const body=document.getElementById('ret-list-body');
  if(!body)return;
  if(!allReturns.length){body.innerHTML='<div class="empty">No returns yet.</div>';return;}
  const sorted=[...allReturns].sort((a,b)=>(b.ts||0)-(a.ts||0));
  body.innerHTML=sorted.map(r=>{
    const st=r.status||'';
    const color=st==='Complete'?'#166534':(st==='Overage'?'#991b1b':(st==='Partial'?'#92400e':(st==='Incomplete Lot'?'#991b1b':'#6b7280')));
    const bg=st==='Complete'?'#dcfce7':(st==='Overage'?'#fee2e2':(st==='Partial'?'#fef3c7':(st==='Incomplete Lot'?'#fee2e2':'#f3f4f6')));
    const uL=r.unit==='qty'?'':(' '+(r.unit||'pcs'));
    const pend=_gpPendingFor('return',r.id);
    const pendBadge=pend?`<span title="${pend.action==='delete'?'Delete':'Edit'} pending approval" style="display:inline-block;background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px">${pend.action==='delete'?'Delete':'Edit'} pending</span>`:'';
    const cum=r.cumulative!=null?`${r.cumulative}/${r.sentQty||0}${uL}`:`${r.returnedQty||0}/${r.sentQty||0}${uL}`;
    return`<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f5f5f5;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:700;color:var(--red);font-size:11px">${r.id}</span>
          <span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;background:${bg};color:${color}">${st}</span>
          ${pendBadge}
        </div>
        <div style="font-size:13px;font-weight:500;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_gpEsc(r.vendor||'')} · ${_gpEsc(r.article||'—')}</div>
        <div style="font-size:11px;color:var(--muted)">${r.gpNum||'—'} · ${r.date||''} · ${_gpEsc(r.receivedBy||'—')}</div>
        ${r.reason?`<div style="font-size:11px;color:#dc2626;margin-top:2px">Reason: ${_gpEsc(r.reason)}</div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
        <div style="text-align:right;font-size:12px;color:var(--muted)">
          <div style="font-weight:700;color:#16a34a">+${r.returnedQty||0}${uL}</div>
          <div style="font-size:10px">${cum}</div>
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
// (issue; optional partialUse:{rollCode:weightUsed} mints a remnant for the
// unused balance) · deleteRollCodes (hard remove) · reserveRollCodes (+reservePO) ·
// releaseRollCodes · returnRollCodes (whole vendor return) · returnPartial
// [{parentRollCode,weight}] (mint remnant + log consumed) ·
// supplierReturnRollCodes (+reason). Runs in a Firestore transaction; callers
// can pass extraWrites:[{ref,data,merge}] and extraDeletes:[ref] to commit the
// receipt / gate-pass doc in the SAME atomic unit. See FABRIC_INVENTORY_PLAN.
async function _fabInvUpsert({fabType,gsm,color,unit,addRolls,removeRollCodes,partialUse,deleteRollCodes,editRolls,reserveRollCodes,reservePO,releaseRollCodes,returnRollCodes,returnPartial,supplierReturnRollCodes,reason,note,sourceCol,sourceId,extraWrites,extraDeletes}){
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
      for(const rc of removeRollCodes){
        const r=findRoll(rc,['in_stock','reserved']);
        if(!r)continue;
        // Partial usage: `partialUse[rc]` (when < the roll's weight) is what
        // production actually consumed; the balance is minted back into stock as
        // a remnant roll (same fabric, own barcode, inherits QC + parent link) —
        // the same mechanism the Returns flow uses. Absent / >= weight → the
        // whole roll is issued exactly as before. Callers gate tiny scraps out,
        // so any positive leftover here is a real remnant worth keeping.
        const full=r.weight||0;
        let use=full;
        if(partialUse&&partialUse[rc]!=null){const v=parseFloat(partialUse[rc]);if(!isNaN(v))use=Math.max(0,Math.min(v,full));}
        const leftover=parseFloat((full-use).toFixed(2));
        if(leftover>0){
          const remCode=_nextRemnantCode(rolls,rc);
          rolls.push({rollCode:remCode,weight:leftover,gsm:r.gsm||gsm||0,unit:r.unit||unit,status:'in_stock',remnant:true,parentRollCode:rc,sourceFabId:r.sourceFabId,qcPassed:r.qcPassed||false,qcBy:r.qcBy||'',qcAt:r.qcAt||null,addedAt:Date.now(),addedBy:session.name});
          r.originalWeight=full;r.weight=use;r.remnantRollCode=remCode;
        }
        r.status='issued';r.issuedAt=Date.now();r.issuedBy=session.name;r.issuedTo=sourceId;r.issuedPO=reservePO||r.reservedPO||'';delete r.reservedPO;
        movQty+=use;movCodes.push(rc);
      }
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

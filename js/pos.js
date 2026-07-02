/* Groovy Operations — pos.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

async function loadData(){
  try{
    const[posSnap,gpSnap,retSnap,fabSnap,editSnap,fInvSnap,fMovSnap]=await Promise.all([
      getDocs(query(collection(db,'pos'),orderBy('ts','desc'))),
      getDocs(query(collection(db,'gatepasses'),orderBy('ts','desc'))),
      getDocs(query(collection(db,'returns'),orderBy('ts','desc'))),
      getDocs(query(collection(db,'fabricin'),orderBy('ts','desc'))),
      getDocs(query(collection(db,'gatepass_edit_requests'),orderBy('ts','desc'))).catch(()=>({docs:[]})),
      getDocs(collection(db,'fabric_inventory')).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'fabric_movements'),orderBy('ts','desc'))).catch(()=>({docs:[]}))
    ]);
    allPOs=posSnap.docs.map(d=>({...d.data(),fbKey:d.id}));
    allPasses=gpSnap.docs.map(d=>d.data());
    allReturns=retSnap.docs.map(d=>d.data());
    allFabricIn=fabSnap.docs.map(d=>d.data());
    allGPEditRequests=editSnap.docs.map(d=>d.data());
    allFabricInventory=fInvSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allFabricMovements=fMovSnap.docs.map(d=>({...d.data(),_id:d.id}));
    if(currentPage)renderPage(currentPage);
    if(typeof _maybeLoadPrintingData==='function')_maybeLoadPrintingData();
    if(typeof loadHRMData==='function')loadHRMData().then(()=>{ if(currentPage==='dashboard'||currentPage==='hrm-employees'){const m=document.getElementById('main-content');if(m&&typeof renderPage==='function')renderPage(currentPage);} });
  }catch(e){
    if((e.code==='permission-denied'||e.message.includes('permissions'))&&auth.currentUser){
      try{
        await auth.currentUser.getIdToken(true);
        const[posSnap,gpSnap,retSnap,fabSnap,editSnap,fInvSnap,fMovSnap]=await Promise.all([
          getDocs(query(collection(db,'pos'),orderBy('ts','desc'))),
          getDocs(query(collection(db,'gatepasses'),orderBy('ts','desc'))),
          getDocs(query(collection(db,'returns'),orderBy('ts','desc'))),
          getDocs(query(collection(db,'fabricin'),orderBy('ts','desc'))),
          getDocs(query(collection(db,'gatepass_edit_requests'),orderBy('ts','desc'))).catch(()=>({docs:[]})),
          getDocs(collection(db,'fabric_inventory')).catch(()=>({docs:[]})),
          getDocs(query(collection(db,'fabric_movements'),orderBy('ts','desc'))).catch(()=>({docs:[]}))
        ]);
        allPOs=posSnap.docs.map(d=>({...d.data(),fbKey:d.id}));
        allPasses=gpSnap.docs.map(d=>d.data());
        allReturns=retSnap.docs.map(d=>d.data());
        allFabricIn=fabSnap.docs.map(d=>d.data());
        allGPEditRequests=editSnap.docs.map(d=>d.data());
        allFabricInventory=fInvSnap.docs.map(d=>({...d.data(),_id:d.id}));
        allFabricMovements=fMovSnap.docs.map(d=>({...d.data(),_id:d.id}));
        if(currentPage)renderPage(currentPage);
        if(typeof _maybeLoadPrintingData==='function')_maybeLoadPrintingData();
        return;
      }catch(e2){showToast('Data load error: '+e2.message,true);}
    }else{showToast('Data load error: '+e.message,true);}
  }
}

async function loadBundles(poId){
  try{
    const snap=await getDocs(query(collection(db,'bundles'),where('poId','==',poId)));
    currentBundles=snap.docs.map(d=>d.data()).sort((a,b)=>a.bundleNumber-b.bundleNumber);
  }catch(e){currentBundles=[];}
}

// ── HRM: seed data, policies, loaders ─────────────────────────
window.filterProducts=function(q){
  const dd=document.getElementById('po-dropdown');
  if(!dd)return;
  q=(q||'').toLowerCase().trim();
  if(!q){dd.style.display='none';return;}
  const hits=PRODUCT_CATALOG.filter(p=>p.code.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)).slice(0,18);
  if(!hits.length){dd.innerHTML='<div style="padding:10px 12px;font-size:12px;color:var(--muted)">No matches found</div>';dd.style.display='block';return;}
  dd.innerHTML=hits.map((p,i)=>`<div class="prod-opt" data-i="${PRODUCT_CATALOG.indexOf(p)}" style="padding:10px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f3f4f6;display:flex;gap:10px;align-items:baseline"><span style="font-weight:700;color:var(--dark);min-width:80px;font-size:12px">${p.code}</span><span style="color:var(--text)">${p.name}</span></div>`).join('');
  dd.style.display='block';
  dd.querySelectorAll('.prod-opt').forEach(el=>el.addEventListener('mousedown',e=>{
    e.preventDefault();
    const p=PRODUCT_CATALOG[+el.dataset.i];
    document.getElementById('po-search').value=p.code+' — '+p.name;
    document.getElementById('po-name').value=p.name;
    document.getElementById('po-code').value=p.code;
    dd.style.display='none';
    window._checkEmbRecipe(p.code,p.name);
  }));
};
function poRowHTML(p){
  const stage=STAGES.find(s=>s.key===p.currentStage)||{label:'Completed',color:'#111111'};
  const isCompleted=p.currentStage==='completed';
  return`<div class="po-row" onclick="window.openPODetail('${p.fbKey}')">
    <div class="po-img">${p.imgFront?`<img src="${p.imgFront}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`:'<span style="font-size:9px;color:#ccc">No img</span>'}</div>
    <div class="po-info">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="po-num">${p.id}</span>
        <span class="stage-badge" style="background:${isCompleted?'#EFEFEF':'#f0f0f0'};color:#111">${isCompleted?'Completed':stage.label}</span>${p.damageFlagged?`<span style="padding:2px 6px;background:#fee2e2;color:#dc2626;border-radius:6px;font-size:10px;font-weight:700">⚠ Loss</span>`:''}</div>
      <div class="po-name">${p.name||'—'}</div>
      <div class="po-meta">${p.qty||'?'} pcs · ${p.fabric||''} · ${p.createdBy||'—'} · ${p.createdAt||''}</div>
    </div><div class="po-arrow">›</div></div>`;
}

// ── Registry ──
function renderRegistry(){
  return`<div class="page-head"><div class="page-title">PO Registry</div><div class="page-sub">${allPOs.length} production orders</div></div>
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <input placeholder="Search name, code, fabric…" oninput="window.filterPOs(this.value)" style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
    <select onchange="window.filterStage(this.value)" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
      <option value="">All stages</option>${STAGES.map(s=>`<option value="${s.key}">${s.label}</option>`).join('')}<option value="completed">Completed</option>
    </select>
  </div>
  <div id="po-list-wrap">${allPOs.length?allPOs.map(p=>poRowHTML(p)).join(''):'<div class="empty">No POs yet.</div>'}</div>`;
}
window.filterPOs=function(q){const f=allPOs.filter(p=>!q||[p.name,p.id,p.code,p.fabric].some(v=>(v||'').toLowerCase().includes(q.toLowerCase())));document.getElementById('po-list-wrap').innerHTML=f.length?f.map(p=>poRowHTML(p)).join(''):'<div class="empty">No results.</div>';};
window.filterStage=function(s){const f=s?allPOs.filter(p=>p.currentStage===s):allPOs;document.getElementById('po-list-wrap').innerHTML=f.length?f.map(p=>poRowHTML(p)).join(''):'<div class="empty">No results.</div>';};

// ── My Work — defined in Chunk 5 (printing module) to support all roles ──

window.openStageWork=async function(fbKey,stage){
  stageWorkPO=fbKey;stageWorkStage=stage;currentPage='stage-work';
  document.querySelectorAll('.nav-item,.mob-nav-item').forEach(n=>n.classList.remove('on'));
  if(['bundling','stitching','qc'].includes(stage)){
    const po=allPOs.find(p=>p.fbKey===fbKey);
    if(po){await loadBundles(po.id);}
  }
  if(stage==='cutting'){
    const po=allPOs.find(p=>p.fbKey===fbKey);
    if(po){cutState={poId:fbKey,actualQty:{...po.cutQty||{XS:0,S:0,M:0,L:0,XL:0,'2XL':0}},pendingBundles:[]};}
  }
  renderPage('stage-work');
};

// ── PO Detail ──
window.openPODetail=function(fbKey){viewingPO=fbKey;currentPage='po-detail';document.querySelectorAll('.nav-item,.mob-nav-item').forEach(n=>n.classList.remove('on'));renderDetailPage();};

function renderDetailPage(){
  const po=allPOs.find(p=>p.fbKey===viewingPO);
  if(!po){window.showPage('po-registry');return;}
  const m=document.getElementById('main-content');
  const isOwner=['owner','manager'].includes(session.role);
  const stagesHTML=STAGES.map(s=>{
    const sd=po.stages?.[s.key]||{};const isDone=!!sd.done;const isCurrent=po.currentStage===s.key;
    const canUpdate=session.stages?.includes(s.key)&&isCurrent;
    return`<div class="stage-item">
      <div class="stage-dot ${isDone?'dot-done':isCurrent?'dot-active':'dot-pending'}"></div>
      <div class="stage-content" style="flex:1">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div>
            <div class="stage-label" style="color:${isDone?'var(--green)':isCurrent?'var(--red)':'var(--text)'}">${s.label}</div>
            ${isDone?`<div class="stage-meta">✓ Done by ${sd.doneBy||'?'} · ${sd.doneAt?new Date(sd.doneAt).toLocaleDateString('en-GB'):''}</div>`:''}
            ${isCurrent&&!isDone?`<div class="stage-meta" style="color:var(--red)">In progress — ${s.owner}'s turn</div>`:''}
            ${!isDone&&!isCurrent?`<div class="stage-meta">Waiting · ${s.owner}</div>`:''}
            ${sd.notes?`<div class="stage-meta" style="font-style:italic">"${sd.notes}"</div>`:''}
            ${sd.dueDate?`<div class="stage-meta">Due: ${sd.dueDate}</div>`:''}
          </div>
          <div style="flex-shrink:0;display:flex;gap:6px">
            ${canUpdate?`<button class="mark-done-btn" style="width:auto;padding:8px 14px;font-size:12px" onclick="window.openStageWork('${po.fbKey}','${s.key}')">Go to stage</button>`:''}
            ${isOwner&&isCurrent&&!canUpdate?`<button class="btn-sm" onclick="window.ownerAdvance('${po.fbKey}','${s.key}')">Force advance</button>`:''}
          </div>
        </div>
      </div>
    </div><div class="stage-connector"></div>`;
  }).join('');

  m.innerHTML=`<button class="back-btn" onclick="window.showPage('po-registry')">← Back to registry</button>
  <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><div class="page-title">PO ${po.id}</div><div class="page-sub">By ${po.createdBy||'—'} · ${po.createdAt||''}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-pdf" onclick="window.generatePOPdf('${po.fbKey}')">⬇ PDF</button>
      ${session.role==='owner'?`<button class="btn-outline" style="font-size:12px" onclick="window.deletePO('${po.fbKey}','${po.id}')">Delete PO</button>`:''}
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
    <div class="card" style="margin-bottom:0"><div class="card-title">Product</div>
      <div class="info-row"><span class="info-label">Name</span><span style="font-weight:500">${po.name||'—'}</span></div>
      <div class="info-row"><span class="info-label">Code</span><span>${po.code||'—'}</span></div>
      <div class="info-row"><span class="info-label">Pattern</span><span>${po.pattern||'—'}</span></div>
      <div class="info-row"><span class="info-label">Total qty</span><span>${po.qty||'—'} pcs</span></div>
      <div class="info-row"><span class="info-label">Ratio</span><span>${po.ratio||'—'}</span></div>
    </div>
    <div class="card" style="margin-bottom:0"><div class="card-title">Fabric & supply</div>
      <div class="info-row"><span class="info-label">Fabric</span><span>${po.fabric||'—'}</span></div>
      <div class="info-row"><span class="info-label">Code</span><span>${po.fabricCode||'—'}</span></div>
      <div class="info-row"><span class="info-label">Store</span><span>${po.store||'—'}</span></div>
      <div class="info-row"><span class="info-label">Rolls</span><span>${po.totalRoll||'—'}</span></div>
      <div class="info-row"><span class="info-label">Weight</span><span>${po.totalWeight||'—'}</span></div>
    </div>
  </div>
  <div class="card"><div class="card-title">Size breakdown</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">
      ${['XS','S','M','L','XL','2XL'].map(sz=>`<div style="text-align:center;padding:8px 4px;background:#f4f4f6;border-radius:6px"><div style="font-size:10px;color:var(--muted)">${sz}</div><div style="font-size:18px;font-weight:700">${po.sizes?.[sz]||0}</div>${po.cutQty?.[sz]!=null?`<div style="font-size:10px;color:var(--green)">Cut:${po.cutQty[sz]}</div>`:''}</div>`).join('')}
    </div>
  </div>
  ${po.cuttingPlan?(()=>{const cp=po.cuttingPlan,u=cp.consumptionUnit||'kg';return`<div class="card"><div class="card-title">Cutting plan <span style="font-weight:400;color:var(--muted);font-size:11px">from fabric issue${cp.updatedBy?` · ${po.cuttingPlan.updatedBy}`:''}</span></div>
    ${(cp.sizeBreakdown||[]).length?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em"><th style="text-align:left;padding:4px 6px">Size</th><th style="text-align:left;padding:4px 6px">Pcs/bundle</th><th style="text-align:left;padding:4px 6px">Bundles</th><th style="text-align:right;padding:4px 6px">Qty</th></tr></thead>
      <tbody>${cp.sizeBreakdown.map(s=>`<tr style="border-top:1px solid #f0f0f0"><td style="padding:5px 6px;font-weight:600">${s.size||'—'}</td><td style="padding:5px 6px">${s.perBundle||0}</td><td style="padding:5px 6px">${s.bundles||0}</td><td style="padding:5px 6px;text-align:right;font-weight:700">${(s.qty||0).toLocaleString()}</td></tr>`).join('')}</tbody>
    </table></div>`:''}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px">
      <div style="text-align:center;padding:8px 4px;background:#f4f4f6;border-radius:6px"><div style="font-size:10px;color:var(--muted)">Planned qty</div><div style="font-size:16px;font-weight:800">${(cp.plannedQty||0).toLocaleString()}</div></div>
      <div style="text-align:center;padding:8px 4px;background:#f4f4f6;border-radius:6px"><div style="font-size:10px;color:var(--muted)">Avg / unit</div><div style="font-size:16px;font-weight:800">${cp.avgConsumption||0} ${u}</div></div>
      <div style="text-align:center;padding:8px 4px;background:#f4f4f6;border-radius:6px"><div style="font-size:10px;color:var(--muted)">Fabric req.</div><div style="font-size:16px;font-weight:800">${cp.fabricRequired||0} ${u}</div></div>
    </div>
    ${Array.isArray(po.fabricIssued)&&po.fabricIssued.length?`<div style="margin-top:12px"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:700;margin-bottom:4px">Fabric issued</div>
      ${po.fabricIssued.map(fi=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid #f5f5f5"><span>${fi.gpId||''} · ${fi.fabType||''} ${fi.gsm||0}gsm ${fi.color||''} · ${fi.rolls||0} rolls</span><span style="font-weight:700">${fi.qty||0} ${fi.unit||'kg'}</span></div>`).join('')}
    </div>`:''}
  </div>`;})():''}
  ${po.damageFlagged||po.damageSummary?`<div class="card" style="border:1px solid #fca5a5"><div class="card-title" style="color:#dc2626">⚠ Damage report</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">
      <div style="text-align:center;padding:8px 4px;background:#fef2f2;border-radius:6px"><div style="font-size:10px;color:var(--muted)">Cut</div><div style="font-size:16px;font-weight:700">${po.damageSummary?.cutTotal||0}</div></div>
      <div style="text-align:center;padding:8px 4px;background:#fee2e2;border-radius:6px"><div style="font-size:10px;color:#dc2626">Damaged</div><div style="font-size:16px;font-weight:700;color:#dc2626">${po.damageSummary?.total||0}</div></div>
      <div style="text-align:center;padding:8px 4px;background:#EFEFEF;border-radius:6px"><div style="font-size:10px;color:var(--muted)">Usable</div><div style="font-size:16px;font-weight:700;color:#111">${po.damageSummary?.usable||0}</div></div>
      <div style="text-align:center;padding:8px 4px;background:${(po.damagePercent||0)>1.5?'#fee2e2':'#fef9e7'};border-radius:6px"><div style="font-size:10px;color:var(--muted)">Rate</div><div style="font-size:16px;font-weight:700;color:${(po.damagePercent||0)>1.5?'#dc2626':'var(--amber)'}">${(po.damagePercent||0).toFixed(2)}%</div></div>
    </div>
    ${po.damageSummary?.bySize?`<div style="font-size:11px;color:var(--muted)">By size: ${Object.entries(po.damageSummary.bySize).filter(([,v])=>v>0).map(([k,v])=>`${k}: ${v}`).join(' · ')||'None'}</div>`:''}
  </div>`:''}
  ${po.imgFront||po.imgBack?`<div class="card"><div class="card-title">Product images</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${po.imgFront?`<div><div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:500">FRONT</div><img src="${po.imgFront}" style="width:100%;border-radius:8px;max-height:320px;object-fit:cover"></div>`:''}
      ${po.imgBack?`<div><div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:500">BACK</div><img src="${po.imgBack}" style="width:100%;border-radius:8px;max-height:320px;object-fit:cover"></div>`:''}
    </div></div>`:''}
  <div class="card"><div class="card-title">Production timeline</div>
    ${stagesHTML}
    ${po.currentStage==='completed'?`<div class="stage-item"><div class="stage-dot dot-done"></div><div class="stage-content"><div class="stage-label" style="color:var(--green)">Completed ✓</div><div class="stage-meta">All stages done</div></div></div>`:''}
  </div><div style="height:80px"></div>`;
}

window.ownerAdvance=async function(fbKey,stageKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po)return;
  if(!['owner','manager'].includes(session.role)){showToast('Not authorized.',true);return;}
  const stage=STAGES.find(s=>s.key===stageKey);
  if(!confirm(`Force-advance "${stage?.label}" for PO ${po.id}?`))return;
  const nextIdx=STAGE_KEYS.indexOf(stageKey)+1;
  const nextStage=nextIdx<STAGE_KEYS.length?STAGE_KEYS[nextIdx]:'completed';
  try{
    await updateDoc(doc(db,'pos',fbKey),{currentStage:nextStage,[`stages.${stageKey}.done`]:true,[`stages.${stageKey}.doneAt`]:new Date().toISOString(),[`stages.${stageKey}.doneBy`]:session.name+' (override)'});
    await logActivity('Stage override',`PO ${po.id} · ${stage?.label} force-advanced`);
    showToast('Advanced ✓');await loadData();renderDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};
window.deletePO=async function(fbKey,poId){
  if(session.role!=='owner'){showToast('Owners only.',true);return;}
  if(!confirm(`Delete PO ${poId}? Cannot be undone.`))return;
  try{await deleteDoc(doc(db,'pos',fbKey));await logActivity('PO deleted',`PO ${poId} deleted`);showToast(`PO ${poId} deleted`);await loadData();window.showPage('po-registry');}
  catch(e){showToast('Error: '+e.message,true);}
};

// ── PO Create ──
function renderPOCreate(){
  if(!session.canPO)return'<div class="empty">Not authorized to create POs.</div>';
  return`<div class="page-head"><div class="page-title">New Production Order</div><div class="page-sub">Fields marked * required</div></div>
  <div class="card"><div class="card-title">Product details</div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1;position:relative">
        <label>Product (search by name or code) *</label>
        <input id="po-search" placeholder="Type to search e.g. GH001 or Black Hoodie…" autocomplete="off" oninput="window.filterProducts(this.value)" onfocus="window.filterProducts(this.value)">
        <div id="po-dropdown" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:300;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.13);max-height:240px;overflow-y:auto;margin-top:3px"></div>
        <input type="hidden" id="po-name">
        <input type="hidden" id="po-code">
      </div>
      <div class="field"><label>Pattern</label><input id="po-pattern" placeholder="Pattern number"></div>
      <div class="field"><label>Total qty (pcs) *</label><input id="po-qty" type="number" min="0" placeholder="0"></div>
    </div>
  </div>
  <div class="card" id="emb-recipe-card">
    <div class="card-title">Embellishment Recipe / پرنٹنگ ریسیپی</div>
    <div id="emb-recipe-status" style="font-size:12px;color:var(--muted)">Select a product above to auto-detect its embellishment recipe.</div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="emb-not-required" onchange="window._toggleEmbRequired(this.checked)" style="width:15px;height:15px;accent-color:var(--dark);cursor:pointer">
      <label for="emb-not-required" style="font-size:12px;color:var(--muted);cursor:pointer">No embellishment required for this PO</label>
    </div>
  </div>
  <div class="card"><div class="card-title">Size breakdown *</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
      ${['XS','S','M','L','XL','2XL'].map(sz=>`<div class="field"><label>${sz}</label><input id="sz-${sz}" type="number" min="0" value="0" onfocus="if(this.value==='0')this.value=''" onblur="if(this.value==='')this.value='0'" oninput="window.updateRatio()"></div>`).join('')}
    </div>
    <div style="margin-top:8px;font-size:12px;color:var(--muted)">Ratio: <span id="ratio-disp" style="font-weight:600;color:var(--text)">—</span></div>
  </div>
  <div class="card"><div class="card-title">Fabric & supply *</div>
    <div class="form-grid">
      <div class="field"><label>Fabric type *</label><input id="po-fabric" placeholder="e.g. Terry, Fleece"></div>
      <div class="field"><label>Fabric code</label><input id="po-fabriccode" placeholder="e.g. TRY-200GSM"></div>
      <div class="field"><label>Supply store</label><input id="po-store" placeholder="Store/supplier"></div>
      <div class="field"><label>Total rolls</label><input id="po-rolls" placeholder="e.g. 12"></div>
    </div>
  </div>
  <div class="card"><div class="card-title">Bundling instructions <span style="font-size:11px;font-weight:400;color:var(--muted)">optional</span></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Define garment parts and where they go after bundling. Default: Full Garment → Warehouse.</div>
    <div id="bp-rows"></div>
    <button type="button" onclick="window.addBundlePart()" style="width:100%;padding:8px;background:none;border:1px dashed var(--border);border-radius:8px;font-size:12px;color:var(--muted);cursor:pointer;font-family:inherit;margin-top:4px">+ Add part</button>
  </div>
  <div class="card"><div class="card-title">Due dates per stage</div>
    <div style="display:grid;gap:8px">${STAGES.map(s=>`<div style="display:flex;align-items:center;gap:12px"><span style="font-size:12px;font-weight:500;min-width:110px;color:var(--muted)">${s.label}</span><input type="date" id="due-${s.key}" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;background:#fafafa;outline:none"></div>`).join('')}</div>
  </div>
  <div class="card"><div class="card-title">Product images</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600">FRONT VIEW *</div>
        <div class="img-upload-box" id="img-front-box" onclick="document.getElementById('inp-front').click()">
          <img id="img-front-prev" style="display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:9px">
          <div id="img-front-ph" style="text-align:center"><div style="font-size:24px;color:#ddd;margin-bottom:4px">+</div><div>Tap to upload front</div></div>
        </div>
        <input type="file" id="inp-front" accept="image/*" class="hidden" onchange="window.handleImg(this,'front')">
        <button onclick="window.clearImg('front')" style="font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;margin-top:4px;font-family:inherit">Remove</button>
      </div>
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600">BACK VIEW</div>
        <div class="img-upload-box" id="img-back-box" onclick="document.getElementById('inp-back').click()">
          <img id="img-back-prev" style="display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:9px">
          <div id="img-back-ph" style="text-align:center"><div style="font-size:24px;color:#ddd;margin-bottom:4px">+</div><div>Tap to upload back</div></div>
        </div>
        <input type="file" id="inp-back" accept="image/*" class="hidden" onchange="window.handleImg(this,'back')">
        <button onclick="window.clearImg('back')" style="font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;margin-top:4px;font-family:inherit">Remove</button>
      </div>
    </div>
  </div>
  ${typeof fabPoReserveCard==='function'?fabPoReserveCard():''}
  <button class="btn-primary" id="po-submit-btn" onclick="window.submitPO()">Create Production Order</button>
  <div style="height:80px"></div>`;
}

window._checkEmbRecipe=async function(code,name){
  const statusDiv=document.getElementById('emb-recipe-status');
  if(!statusDiv)return;
  const notReq=document.getElementById('emb-not-required');
  if(notReq?.checked)return;
  _poEmbellishment=null;
  statusDiv.innerHTML='<div style="font-size:12px;color:var(--muted)">Checking recipe…</div>';
  if(!printingDataLoaded){try{await loadPrintingData();}catch(e){statusDiv.innerHTML='<div style="font-size:12px;color:var(--red)">Could not load recipes.</div>';return;}}
  let r=allRecipes.find(x=>(x.articleCode||'').toLowerCase()===(code||'').toLowerCase());
  if(!r&&name)r=allRecipes.find(x=>(x.articleName||'').toLowerCase()===(name||'').toLowerCase());
  if(!r){
    const rm=_lookupRate(code);
    _poEmbellishment={required:true,recipeId:null,articleCode:code,articleName:name,recipeStatus:'missing',recipeRequiredBefore:'pp_approval',rateMasterPreview:rm?{complexityTier:rm.complexityTier,ratePerPiece:rm.ratePerPiece}:null};
    if(rm){
      const tierLabel=TIER_INFO[rm.complexityTier]?.label||('Tier '+rm.complexityTier);
      statusDiv.innerHTML=`<div style="background:#f5f5f5;border-radius:8px;padding:10px 12px;border:1px solid #D9D9D9"><div style="font-size:12px;font-weight:700;color:#111">Recipe Missing — Rate List Preview</div><div style="font-size:11px;color:var(--muted);margin-top:3px">No recipe yet. Rate List suggests: <strong>${tierLabel}</strong> · Rs. ${rm.ratePerPiece}/pc. Recipe must be created and locked before PP approval.</div></div>`;
    }else{
      statusDiv.innerHTML=`<div style="background:#f5f5f5;border-radius:8px;padding:10px 12px;border:1px solid #D9D9D9"><div style="font-size:12px;font-weight:700;color:#111">Recipe Missing</div><div style="font-size:11px;color:var(--muted);margin-top:3px">PO can be created. Recipe must be locked before PP approval — Ammar will be notified.</div></div>`;
    }
  }else if(r.status!=='locked'){
    _poEmbellishment={required:true,recipeId:r._id,articleCode:code,articleName:r.articleName||name,recipeStatus:'draft',recipeRequiredBefore:'pp_approval'};
    const pt=(r.printing?.processTypes||[]).map(k=>PROCESS_TYPES[k]?.label||k).join(', ')||'—';
    statusDiv.innerHTML=`<div style="background:#f5f5f5;border-radius:8px;padding:10px 12px;border:1px solid #D9D9D9"><div style="font-size:12px;font-weight:700;color:#111">Recipe Draft — Not Locked</div><div style="font-size:11px;color:var(--muted);margin-top:3px">Recipe exists (${pt} · Tier ${r.printing?.complexityTier||'?'}) but must be locked by Ammar before PP approval.</div></div>`;
  }else{
    _poEmbellishment={required:true,recipeId:r._id,articleCode:code,articleName:r.articleName||name,processType:(r.printing?.processTypes||[])[0]||'',complexityTier:r.printing?.complexityTier||1,ratePerPiece:r.printing?.ratePerPiece||0,recipeStatus:'locked',recipeRequiredBefore:'pp_approval'};
    const pt=(r.printing?.processTypes||[]).map(k=>PROCESS_TYPES[k]?.label||k).join(', ')||'—';
    const places=(r.printing?.placements||[]).map(pl=>pl.name).filter(Boolean).join(', ')||'—';
    statusDiv.innerHTML=`<div style="background:#EFEFEF;border-radius:8px;padding:10px 12px;border:1px solid #D9D9D9"><div style="font-size:12px;font-weight:700;color:#111">Recipe Found — Locked</div><div style="font-size:11px;color:var(--muted);margin-top:4px">${pt} · Tier ${r.printing?.complexityTier||'?'} · Rs.${r.printing?.ratePerPiece||0}/pc</div><div style="font-size:11px;color:var(--muted)">Placements: ${places}</div></div>`;
  }
};
window._toggleEmbRequired=function(notRequired){
  const statusDiv=document.getElementById('emb-recipe-status');
  if(notRequired){
    _poEmbellishment={required:false};
    if(statusDiv)statusDiv.innerHTML='<div style="font-size:12px;color:var(--muted)">No embellishment required for this PO.</div>';
  }else{
    const code=document.getElementById('po-code')?.value;
    const name=document.getElementById('po-name')?.value;
    if(code)window._checkEmbRecipe(code,name);
    else{_poEmbellishment=null;if(statusDiv)statusDiv.innerHTML='<div style="font-size:12px;color:var(--muted)">Select a product above to auto-detect its embellishment recipe.</div>';}
  }
};
window.updateRatio=function(){
  const vals=['XS','S','M','L','XL','2XL'].map(sz=>parseInt(document.getElementById('sz-'+sz)?.value)||0);
  const nonZero=vals.filter(v=>v>0);if(!nonZero.length){document.getElementById('ratio-disp').textContent='—';return;}
  const min=Math.min(...nonZero);document.getElementById('ratio-disp').textContent=vals.map(v=>v?Math.round(v/min):0).join(':');
};
window.handleImg=function(input,side){
  const file=input.files[0];if(!file)return;
  // Local preview only — upload happens on submit
  const reader=new FileReader();
  reader.onload=e=>{
    poImages[side]=file; // store File object for upload
    document.getElementById(`img-${side}-prev`).src=e.target.result;
    document.getElementById(`img-${side}-prev`).style.display='block';
    document.getElementById(`img-${side}-ph`).style.display='none';
  };
  reader.readAsDataURL(file);
};
window.addBundlePart=function(name='',notes='',dest='Warehouse'){
  bundlePartIdx++;
  const id='bp-'+bundlePartIdx;
  const wrap=document.getElementById('bp-rows');if(!wrap)return;
  const div=document.createElement('div');
  div.id=id;div.style.cssText='display:grid;grid-template-columns:1fr 1fr auto auto;gap:6px;align-items:center;margin-bottom:8px';
  const parts=['Front','Back','Sleeves','Collar','Body','Panels','Full Garment'];
  div.innerHTML=`<select style="padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;background:#fafafa;outline:none;font-family:inherit">
    ${parts.map(p=>`<option value="${p}" ${p===name?'selected':''}>${p}</option>`).join('')}
  </select>
  <input placeholder="Notes (optional)" value="${notes}" style="padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;background:#fafafa;outline:none;font-family:inherit">
  <div style="display:flex;gap:4px">
    <button type="button" onclick="window.setBPDest('${id}','Printing')" id="${id}-print" style="padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid;${dest==='Printing'?'background:#EFEFEF;color:#111;border-color:#111':'background:#fff;color:var(--muted);border-color:var(--border)'}">→ Printing</button>
    <button type="button" onclick="window.setBPDest('${id}','Warehouse')" id="${id}-wh" style="padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid;${dest==='Warehouse'?'background:#EFEFEF;color:#111;border-color:#111':'background:#fff;color:var(--muted);border-color:var(--border)'}">→ Warehouse</button>
  </div>
  <button type="button" onclick="document.getElementById('${id}').remove()" style="background:none;border:none;color:#ccc;font-size:18px;cursor:pointer;padding:2px 6px">×</button>`;
  wrap.appendChild(div);
};
window.setBPDest=function(rowId,dest){
  const row=document.getElementById(rowId);if(!row)return;
  row.dataset.dest=dest;
  const pBtn=document.getElementById(rowId+'-print'),wBtn=document.getElementById(rowId+'-wh');
  if(pBtn){pBtn.style.cssText=pBtn.style.cssText.replace(/background:[^;]+;color:[^;]+;border-color:[^;]+/,dest==='Printing'?'background:#EFEFEF;color:#111;border-color:#111':'background:#fff;color:var(--muted);border-color:var(--border)');}
  if(wBtn){wBtn.style.cssText=wBtn.style.cssText.replace(/background:[^;]+;color:[^;]+;border-color:[^;]+/,dest==='Warehouse'?'background:#EFEFEF;color:#111;border-color:#111':'background:#fff;color:var(--muted);border-color:var(--border)');}
};
window.getBundleParts=function(){
  const rows=document.querySelectorAll('#bp-rows > div');
  if(!rows.length)return[{name:'Full Garment',notes:'',dest:'Warehouse'}];
  return Array.from(rows).map(row=>{
    const sel=row.querySelector('select'),inp=row.querySelector('input');
    const id=row.id;
    const pBtn=document.getElementById(id+'-print');
    const dest=row.dataset.dest||(pBtn&&pBtn.style.borderColor==='rgb(17, 17, 17)'?'Printing':'Warehouse');
    return{name:sel?.value||'Full Garment',notes:inp?.value?.trim()||'',dest};
  });
};
window.clearImg=function(side){
  poImages[side]=null;document.getElementById(`img-${side}-prev`).style.display='none';document.getElementById(`img-${side}-ph`).style.display='flex';document.getElementById(`inp-${side}`).value='';
};
window.submitPO=async function(){
  if(!session.canPO){showToast('Not authorized.',true);return;}
  const name=document.getElementById('po-name')?.value.trim(),code=document.getElementById('po-code')?.value.trim(),qty=parseInt(document.getElementById('po-qty')?.value)||0,fabric=document.getElementById('po-fabric')?.value.trim();
  if(!name||!code){showToast('Select a product from the search dropdown.',true);document.getElementById('po-search')?.focus();return;}
  if(!qty){showToast('Quantity required.',true);return;}
  if(!fabric){showToast('Fabric type required.',true);return;}
  if(!poImages.front){showToast('Front image required.',true);return;}
  const btn=document.getElementById('po-submit-btn');if(btn){btn.disabled=true;btn.textContent='Uploading image…';}
  try{
    const imgFrontUrl=await uploadToCloudinary(poImages.front);
    const imgBackUrl=poImages.back?await uploadToCloudinary(poImages.back):'';
    if(btn)btn.textContent='Creating…';
    const nextNum=await getNextId('pos');
    const poId='PO-'+String(nextNum).padStart(3,'0');
    const sizes={};['XS','S','M','L','XL','2XL'].forEach(sz=>sizes[sz]=parseInt(document.getElementById('sz-'+sz)?.value)||0);
    const stages={};STAGE_KEYS.forEach(k=>stages[k]={done:false,doneAt:null,doneBy:null,dueDate:document.getElementById('due-'+k)?.value||'',notes:''});
    const bundlingParts=window.getBundleParts();
    const embellishment=_poEmbellishment||{required:false};
    const payload={id:poId,ts:Date.now(),name,code,pattern:document.getElementById('po-pattern')?.value.trim()||'',qty,sizes,ratio:document.getElementById('ratio-disp')?.textContent||'',fabric,fabricCode:document.getElementById('po-fabriccode')?.value.trim()||'',store:document.getElementById('po-store')?.value.trim()||'',totalRoll:document.getElementById('po-rolls')?.value.trim()||'',imgFront:imgFrontUrl,imgBack:imgBackUrl,currentStage:'cutting',stages,bundlingParts,embellishment,createdBy:session.name,createdAt:new Date().toISOString().slice(0,10)};
    await setDoc(doc(db,'pos',poId),payload);
    await logActivity('PO created',`${poId} — ${name} (${qty} pcs)`);
    if(typeof fabPoReserveCommit==='function'){try{await fabPoReserveCommit(poId);}catch(_re){showToast('PO saved, but fabric reservation failed: '+_re.message,true);}}
    if(embellishment.required&&embellishment.recipeStatus==='missing')await logActivity('Recipe Missing',`${poId} — ${embellishment.articleCode||code}: Recipe required before PP approval. Ammar notified.`).catch(()=>{});
    if(embellishment.required&&embellishment.recipeStatus==='draft')await logActivity('Recipe Needs Lock',`${poId} — ${embellishment.articleCode||code}: Recipe exists but not locked by Ammar.`).catch(()=>{});
    _poEmbellishment=null;
    let _trimNote='';
    try{
      const _tplSnap=await getDocs(query(collection(db,'trim_templates'),where('productCode','==',code)));
      if(!_tplSnap.empty){
        const _tplData={..._tplSnap.docs[0].data(),_id:_tplSnap.docs[0].id};
        if(typeof _createPoIssueRequest==='function'){
          await _createPoIssueRequest({id:poId,name,code,qty},_tplData);
          _trimNote=' — Trim issue request created ✓';
        }
      }
    }catch(_te){_trimNote=' (trim request failed: '+_te.message+')';}
    showToast(`${poId} created ✓${_trimNote}`);poImages={front:null,back:null};await loadData();window.showPage('po-registry');
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent='Create Production Order';}}
};

// ── Stage Work Page ──
function renderStageWorkPage(){
  const po=allPOs.find(p=>p.fbKey===stageWorkPO);
  if(!po){window.showPage('my-work');return;}
  const m=document.getElementById('main-content');
  if(stageWorkStage==='cutting')m.innerHTML=renderCuttingWork(po);
  else if(stageWorkStage==='bundling')m.innerHTML=renderBundlingWork(po);
  else if(stageWorkStage==='stitching')m.innerHTML=renderBundleStageWork(po,'stitching','stitchingDone','stitchingAt','Stitched','printing');
  else if(stageWorkStage==='printing')m.innerHTML=renderLotStageWork(po,'printing','Printing QC','washing');
  else if(stageWorkStage==='washing')m.innerHTML=renderLotStageWork(po,'washing','Washing','qc');
  else if(stageWorkStage==='qc')m.innerHTML=renderQCWork(po);
  else m.innerHTML=`<div class="empty">Unknown stage.</div>`;
}

// ── Cutting stage ──
function renderCuttingWork(po){
  const szs=['XS','S','M','L','XL','2XL'];
  const target=po.qty||0;
  const actualTotal=szs.reduce((a,s)=>a+(parseInt(cutState.actualQty[s])||0),0);
  const min=Math.ceil(target*0.8),max=Math.floor(target*1.2);
  const rangeOk=actualTotal>=min&&actualTotal<=max;
  return`<button class="back-btn" onclick="window.showPage('my-work')">← Back to My Work</button>
  <div class="page-head"><div class="page-title">PO ${po.id} — Cutting</div><div class="page-sub">${po.name||'—'}</div></div>
  <div class="card"><div class="card-title">Actual cut quantities</div>
    <table class="cut-table"><thead><tr><th>Size</th><th>Target</th><th>Actual Cut</th><th>Variance</th></tr></thead>
    <tbody id="cut-tbody">
      ${szs.map(sz=>{
        const tgt=po.sizes?.[sz]||0,act=parseInt(cutState.actualQty[sz])||0,diff=act-tgt;
        const cls=diff===0?'var-ok':Math.abs(diff)<=Math.ceil(tgt*0.1)?'var-warn':'var-bad';
        return`<tr><td style="font-weight:600">${sz}</td><td>${tgt}</td><td><input type="number" min="0" value="${act}" style="width:80px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;outline:none" onfocus="if(this.value==='0')this.value=''" onblur="if(this.value==='')this.value='0'" onchange="window.setCutQty('${sz}',this.value)"></td><td id="var-${sz}" class="${cls}">${act>0?diff>=0?'+'+diff:diff:'—'}</td></tr>`;
      }).join('')}
    </tbody></table>
    <div id="cut-total-row" style="margin-top:10px;font-size:13px">
      Total: <strong>${actualTotal}</strong> actual / <strong>${target}</strong> target &nbsp;
      <span style="font-size:11px;color:var(--muted)">Allowed: ${min}–${max} pcs (80–120%)</span>
      <span style="margin-left:8px;font-weight:600;color:${rangeOk?'var(--green)':'#dc2626'}">${rangeOk?'✓ In range':'✗ Out of range'}</span>
    </div>
  </div>
  <div class="card"><div class="card-title">Fabric used</div>
    <div class="field" style="margin-bottom:10px">
      <label>Consume from fabric stock <span style="font-weight:400;color:var(--muted)">(optional — picks rolls to deduct from inventory)</span></label>
      <select id="cut-fab-stock" onchange="window.onCutFabStockPick()" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#FAFAFA;color:var(--text);font-family:inherit;outline:none;width:100%">
        <option value="">— don't deduct from fabric inventory —</option>
        ${allFabricInventory.filter(s=>(s.totalWeight||0)>0).map(s=>`<option value="${s._id}">${_gpEsc(s.fabType||'')} · ${s.gsm||0}gsm · ${_gpEsc(s.color||'')} — ${s.totalWeight} ${s.unit||'kg'} · ${s.rollsCount||0} rolls</option>`).join('')}
      </select>
    </div>
    <div id="cut-fab-rolls-pick" style="margin-bottom:10px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Total weight (kg) *</label><input id="cut-weight" type="number" min="0" step="0.1" placeholder="e.g. 100" style="width:100%" oninput="window.calcCutAvg()"></div>
      <div class="field"><label>Total rolls</label><input id="cut-rolls" type="number" min="0" placeholder="e.g. 12" style="width:100%"></div>
    </div>
    <div id="cut-avg-display" style="margin-top:6px;font-size:13px;color:var(--muted)">Enter weight to auto-calculate avg per unit</div>
  </div>
  <div class="card"><div class="card-title">Bundle entry</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <select id="bundle-size-sel" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">${szs.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
      <input type="number" id="bundle-units-inp" min="1" placeholder="Units" style="width:100px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <button onclick="window.addCutBundle()" class="btn-sm" style="padding:9px 16px">+ Add Bundle</button>
    </div>
    <div id="cut-bundle-list">${renderCutBundleList()}</div>
    <div id="cut-bundle-summary" style="margin-top:10px;font-size:12px">${renderCutBundleSummary(po)}</div>
  </div>
  <button class="mark-done-btn" id="cut-done-btn" onclick="window.markCuttingDone('${po.fbKey}')" ${cutValidationOk(po)?'':'disabled'}>Mark Cutting Done ✓</button>
  <div style="height:80px"></div>`;
}

function renderCutBundleList(){
  if(!cutState.pendingBundles.length)return'<div style="color:var(--muted);font-size:12px;padding:8px 0">No bundles added yet.</div>';
  return cutState.pendingBundles.map((b,i)=>`<div class="bundle-item">
    <span class="bundle-num">B-${String(i+1).padStart(4,'0')}*</span>
    <span class="bundle-size-tag">${b.size}</span>
    <span class="bundle-units">${b.units} pcs</span>
    <button onclick="window.removeCutBundle(${b.tempId})" style="background:none;border:none;color:#ccc;font-size:18px;cursor:pointer;padding:0 4px">×</button>
  </div>`).join('');
}

function renderCutBundleSummary(po){
  const szs=['XS','S','M','L','XL','2XL'];
  return szs.map(sz=>{
    const actual=parseInt(cutState.actualQty[sz])||0;if(!actual)return'';
    const bundled=cutState.pendingBundles.filter(b=>b.size===sz).reduce((a,b)=>a+b.units,0);
    const ok=bundled===actual;
    return`<div style="color:${ok?'var(--green)':'#dc2626'};font-weight:500">${ok?'✓':'✗'} ${sz}: ${bundled}/${actual} bundles</div>`;
  }).join('');
}

function cutValidationOk(po){
  const szs=['XS','S','M','L','XL','2XL'];
  const target=po.qty||0;const actualTotal=szs.reduce((a,s)=>a+(parseInt(cutState.actualQty[s])||0),0);
  const min=Math.ceil(target*0.8),max=Math.floor(target*1.2);
  if(actualTotal<min||actualTotal>max)return false;
  for(const sz of szs){
    const actual=parseInt(cutState.actualQty[sz])||0;if(!actual)continue;
    const bundled=cutState.pendingBundles.filter(b=>b.size===sz).reduce((a,b)=>a+b.units,0);
    if(bundled!==actual)return false;
  }
  return cutState.pendingBundles.length>0;
}

function refreshCutPartial(po){
  const szs=['XS','S','M','L','XL','2XL'];
  const target=po.qty||0;
  const actualTotal=szs.reduce((a,s)=>a+(parseInt(cutState.actualQty[s])||0),0);
  const min=Math.ceil(target*0.8),max=Math.floor(target*1.2);
  const rangeOk=actualTotal>=min&&actualTotal<=max;
  // Update variance cells
  szs.forEach(sz=>{
    const tgt=po.sizes?.[sz]||0,act=parseInt(cutState.actualQty[sz])||0,diff=act-tgt;
    const cls=diff===0?'var-ok':Math.abs(diff)<=Math.ceil(tgt*0.1)?'var-warn':'var-bad';
    const cell=document.getElementById('var-'+sz);
    if(cell){cell.className=cls;cell.textContent=act>0?(diff>=0?'+'+diff:diff):'—';}
  });
  // Update total row
  const tot=document.getElementById('cut-total-row');
  if(tot)tot.innerHTML=`Total: <strong>${actualTotal}</strong> actual / <strong>${target}</strong> target &nbsp;<span style="font-size:11px;color:var(--muted)">Allowed: ${min}–${max} pcs (80–120%)</span><span style="margin-left:8px;font-weight:600;color:${rangeOk?'var(--green)':'#dc2626'}">${rangeOk?'✓ In range':'✗ Out of range'}</span>`;
  // Update bundle list & summary
  const bl=document.getElementById('cut-bundle-list');if(bl)bl.innerHTML=renderCutBundleList();
  const bs=document.getElementById('cut-bundle-summary');if(bs)bs.innerHTML=renderCutBundleSummary(po);
  // Update done button
  const btn=document.getElementById('cut-done-btn');if(btn)btn.disabled=!cutValidationOk(po);
}

window.setCutQty=function(sz,val){
  cutState.actualQty[sz]=parseInt(val)||0;
  const po=allPOs.find(p=>p.fbKey===stageWorkPO);if(po)refreshCutPartial(po);
  window.calcCutAvg();
};
window.calcCutAvg=function(){
  const wt=parseFloat(document.getElementById('cut-weight')?.value)||0;
  const szs=['XS','S','M','L','XL','2XL'];
  const units=szs.reduce((a,s)=>a+(parseInt(cutState.actualQty[s])||0),0);
  const el=document.getElementById('cut-avg-display');if(!el)return;
  if(wt>0&&units>0){
    const avg=Math.round(wt*1000/units);
    el.innerHTML=`<strong style="color:var(--dark)">Avg per unit: ${avg}g</strong> <span style="color:var(--muted)">(${wt}kg ÷ ${units} pcs)</span>`;
  }else{
    el.textContent='Enter weight to auto-calculate avg per unit';
  }
};
window.addCutBundle=function(){
  const sel=document.getElementById('bundle-size-sel');
  const size=sel.value;
  const unitsInp=document.getElementById('bundle-units-inp');
  const units=parseInt(unitsInp.value)||0;
  if(!units){showToast('Enter unit count.',true);return;}
  cutState.pendingBundles.push({tempId:Date.now()+Math.random(),size,units});
  unitsInp.value='';unitsInp.focus();  // clear units, keep size, focus for next entry
  const po=allPOs.find(p=>p.fbKey===stageWorkPO);if(po)refreshCutPartial(po);
};
window.removeCutBundle=function(tempId){
  cutState.pendingBundles=cutState.pendingBundles.filter(b=>b.tempId!==tempId);
  const po=allPOs.find(p=>p.fbKey===stageWorkPO);if(po)refreshCutPartial(po);
};

let _cutFabRolls=[];
window.onCutFabStockPick=function(){
  const key=document.getElementById('cut-fab-stock')?.value||'';
  const wrap=document.getElementById('cut-fab-rolls-pick');
  _cutFabRolls=[];
  if(!key||!wrap){if(wrap)wrap.innerHTML='';return;}
  const stock=allFabricInventory.find(s=>s._id===key);
  if(!stock){wrap.innerHTML='';return;}
  const inStock=(stock.rolls||[]).filter(r=>r.status==='in_stock');
  if(!inStock.length){wrap.innerHTML='<div style="font-size:12px;color:var(--muted);padding:8px">No in-stock rolls.</div>';return;}
  wrap.innerHTML=`<label style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Select rolls to consume (${inStock.length} in stock)</label>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;max-height:240px;overflow-y:auto;padding:8px;background:#fafafa;border:1px solid var(--border);border-radius:8px">
      ${inStock.map(r=>`<label style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer">
        <input type="checkbox" data-roll="${_gpEsc(r.rollCode)}" data-weight="${r.weight||0}" onchange="window.onCutFabRollToggle()" style="margin:0">
        <span style="font-weight:700;letter-spacing:.04em">${r.rollCode}</span>
        <span style="color:var(--muted)">${r.weight||0} ${stock.unit||'kg'}</span>
      </label>`).join('')}
    </div>`;
};
window.onCutFabRollToggle=function(){
  _cutFabRolls=[];let totQty=0;
  document.querySelectorAll('#cut-fab-rolls-pick input[type=checkbox]:checked').forEach(cb=>{
    _cutFabRolls.push({rollCode:cb.dataset.roll,weight:parseFloat(cb.dataset.weight)||0});
    totQty+=parseFloat(cb.dataset.weight)||0;
  });
  const wt=document.getElementById('cut-weight');if(wt&&_cutFabRolls.length)wt.value=totQty.toFixed(2);
  const rolls=document.getElementById('cut-rolls');if(rolls&&_cutFabRolls.length)rolls.value=_cutFabRolls.length;
  if(typeof window.calcCutAvg==='function')window.calcCutAvg();
};

window.markCuttingDone=async function(fbKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po)return;
  if(!cutValidationOk(po)){showToast('Validation failed — check quantities.',true);return;}
  const btn=document.getElementById('cut-done-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const batch=writeBatch(db);
    const bundleIds=[];
    const bundleStart=await reserveBundleIds(cutState.pendingBundles.length);
    for(let i=0;i<cutState.pendingBundles.length;i++){
      const b=cutState.pendingBundles[i];
      const num=bundleStart+i;
      const bid='B-'+String(num).padStart(4,'0');
      bundleIds.push(bid);
      batch.set(doc(db,'bundles',bid),{bundleId:bid,bundleNumber:num,poId:po.id,size:b.size,units:b.units,stage:'cutting',bundlingDone:false,stitchingDone:false,qcStatus:null,qcReason:'',createdBy:session.name,createdAt:new Date().toISOString().slice(0,10),ts:Date.now()});
    }
    await batch.commit();
    const cutWt=parseFloat(document.getElementById('cut-weight')?.value)||0;
    const cutRolls=document.getElementById('cut-rolls')?.value.trim()||'';
    const cutUnits=['XS','S','M','L','XL','2XL'].reduce((a,s)=>a+(parseInt(cutState.actualQty[s])||0),0);
    const cutAvg=cutWt>0&&cutUnits>0?Math.round(cutWt*1000/cutUnits)+'g':'';
    // Fabric inventory consumption (optional)
    const stockKey=document.getElementById('cut-fab-stock')?.value||'';
    let consumedFromInv=null;
    if(stockKey&&_cutFabRolls.length){
      const stock=allFabricInventory.find(s=>s._id===stockKey);
      if(stock){
        const rollCodes=_cutFabRolls.map(r=>r.rollCode);
        await _fabInvUpsert({fabType:stock.fabType,gsm:stock.gsm,color:stock.color,unit:stock.unit||'kg',removeRollCodes:rollCodes,note:`Consumed for PO ${po.id} cutting`,sourceCol:'pos',sourceId:po.id});
        consumedFromInv={fabType:stock.fabType,gsm:stock.gsm,color:stock.color,rollCodes,qty:_cutFabRolls.reduce((s,r)=>s+r.weight,0)};
      }
    }
    const poUpdate={currentStage:'bundling',cutQty:{...cutState.actualQty},bundleIds,totalWeight:cutWt||'',totalRoll:cutRolls,avgPerUnit:cutAvg,[`stages.cutting.done`]:true,[`stages.cutting.doneAt`]:new Date().toISOString(),[`stages.cutting.doneBy`]:session.name};
    if(consumedFromInv)poUpdate.fabricConsumed=consumedFromInv;
    await updateDoc(doc(db,'pos',fbKey),poUpdate);
    await logActivity('Stage done',`PO ${po.id} · Cutting done — ${cutState.pendingBundles.length} bundles${consumedFromInv?` · consumed ${consumedFromInv.rollCodes.length} rolls`:''}`);
    if(po.embellishment?.required)await autoCreateEmbJob({...po,cutQty:{...cutState.actualQty},bundleIds}).catch(()=>{});
    showToast(`Cutting done ✓ — ${cutState.pendingBundles.length} bundles${consumedFromInv?' · fabric deducted':''}`);await loadData();window.showPage('my-work');
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent='Mark Cutting Done ✓';}}
};

// ── Bundling stage (damage tracking + destination split) ──
function renderBundlingWork(po){
  const bundles=currentBundles;
  if(!bundles.length){
    const isOwner=['owner','manager'].includes(session.role);
    return`<button class="back-btn" onclick="window.showPage('my-work')">← Back to My Work</button>
    <div class="page-head"><div class="page-title">PO ${po.id} — Bundling</div><div class="page-sub">${po.name||'—'}</div></div>
    <div class="card"><div class="card-title">No bundles found</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px">Cutting stage has not created bundles for this PO yet.</div>
      ${isOwner?`<button class="mark-done-btn" onclick="window.bundlingOverride('${po.fbKey}')">Owner override — skip to stitching</button>`:'<div style="font-size:12px;color:var(--muted)">Contact the owner to proceed.</div>'}
    </div><div style="height:80px"></div>`;
  }
  const parts=po.bundlingParts&&po.bundlingParts.length?po.bundlingParts:[{name:'Full Garment',notes:'',dest:'Warehouse'}];
  const uniqueDests=[...new Set(parts.map(p=>p.dest))];
  // Auto-init bundleDamage for bundles already marked done (e.g. after page reload)
  bundles.forEach(b=>{
    if(b.bundlingDone&&!bundleDamage[b.bundleId]){
      bundleDamage[b.bundleId]={dmg:0,entered:true,dest:b.bundlingDest||parts[0]?.dest||'Warehouse'};
    }
  });
  // Group bundles by destination — each bundle's dest stored in bundleDamage[id]?.dest or defaults to first part's dest
  const destGroups={};
  uniqueDests.forEach(d=>{destGroups[d]=[];});
  bundles.forEach(b=>{
    const savedDest=bundleDamage[b.bundleId]?.dest;
    const dest=savedDest||(parts[0]?.dest||'Warehouse');
    if(!destGroups[dest])destGroups[dest]=[];
    destGroups[dest].push(b);
  });
  // Damage summary calc
  const cutTotal=['XS','S','M','L','XL','2XL'].reduce((a,s)=>a+(po.cutQty?.[s]||0),0)||po.qty||0;
  const totalDamage=bundles.reduce((a,b)=>a+(bundleDamage[b.bundleId]?.dmg||0),0);
  const usable=cutTotal-totalDamage;
  const pct=cutTotal>0?totalDamage/cutTotal*100:0;
  const pctColor=pct>1.5?'#dc2626':pct>1?'var(--amber)':'var(--green)';
  const allBundled=bundles.every(b=>b.bundlingDone);
  const allDamageEntered=bundles.every(b=>b.bundlingDone&&bundleDamage[b.bundleId]?.entered);
  const canComplete=allBundled&&allDamageEntered;
  const doneCount=bundles.filter(b=>b.bundlingDone).length;

  const partsCard=parts.length>1||parts[0]?.name!=='Full Garment'?`<div class="card"><div class="card-title">Bundling instructions</div>
    ${parts.map(p=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:13px">
      <span style="font-weight:500">${p.name}</span>
      <div style="display:flex;align-items:center;gap:8px">
        ${p.notes?`<span style="font-size:11px;color:var(--muted)">${p.notes}</span>`:''}
        <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#f0f0f0;color:#111">→ ${p.dest}</span>
      </div>
    </div>`).join('')}
  </div>`:'';

  const destSections=uniqueDests.map(dest=>{
    const dBundles=destGroups[dest]||[];
    const dDone=dBundles.filter(b=>b.bundlingDone).length;
    const bySz={};dBundles.forEach(b=>{if(!bySz[b.size])bySz[b.size]=[];bySz[b.size].push(b);});
    return`<div style="margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:13px;font-weight:700">→ ${dest}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#f0f0f0;color:#111">${dDone}/${dBundles.length} bundled</span>
        ${uniqueDests.length>1?`<div class="progress-strip" style="flex:1;max-width:120px"><div class="progress-fill" style="width:${dBundles.length?Math.round(dDone/dBundles.length*100):0}%"></div></div>`:''}
      </div>
      ${Object.entries(bySz).map(([sz,bList])=>`<div class="card" style="margin-bottom:8px"><div class="card-title">${sz} — ${bList.length} bundle${bList.length!==1?'s':''}</div>
        ${bList.map(b=>{
          const dmgVal=bundleDamage[b.bundleId]?.dmg??'';
          const dmgEntered=bundleDamage[b.bundleId]?.entered;
          return`<div class="bundle-item" id="bi-${b.bundleId}" style="flex-wrap:wrap;gap:8px;${b.bundlingDone?'background:#f0fdf4;border-radius:8px;padding:8px':''}">
            <span class="bundle-num">${b.bundleId}</span>
            <span class="bundle-size-tag">${b.size}</span>
            <span class="bundle-units ${b.bundlingDone?'bundle-done':''}">${b.units} pcs</span>
            <span style="flex:1"></span>
            ${b.bundlingDone
              ?`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                  <span style="color:var(--green);font-weight:600;font-size:12px">✓ Bundled</span>
                  <div style="display:flex;align-items:center;gap:4px">
                    <input type="number" min="0" max="${b.units}" placeholder="0" value="${dmgVal===0?'':dmgVal}" style="width:56px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none;font-family:inherit" oninput="window.saveBundleDamage('${b.bundleId}',this.value||'0','${dest}','${po.fbKey}')">
                    <span style="font-size:11px;color:var(--muted)">dmg</span>
                  </div>
                </div>`
              :`<button class="qc-pass-btn" onclick="window.markBundlingDone('${b.bundleId}','${dest}','${po.fbKey}')">Mark Bundled ✓</button>`}
          </div>`;
        }).join('')}
      </div>`).join('')}
    </div>`;
  }).join('');

  return`<button class="back-btn" onclick="window.showPage('my-work')">← Back to My Work</button>
  <div class="page-head"><div class="page-title">PO ${po.id} — Bundling</div><div class="page-sub">${po.name||'—'}</div></div>
  <div class="card"><div class="card-title">Bundle progress</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="font-size:22px;font-weight:700;color:${allBundled?'var(--green)':'var(--dark)'}">${doneCount}/${bundles.length}</span>
      <span style="font-size:12px;color:var(--muted)">bundles bundled</span>
    </div>
    <div class="progress-strip"><div class="progress-fill" style="width:${bundles.length?Math.round(doneCount/bundles.length*100):0}%"></div></div>
    <div style="margin-top:10px;padding:10px 12px;background:#f8f8f8;border-radius:8px;font-size:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center">
      <div><div style="font-size:10px;color:var(--muted)">PO Qty</div><div style="font-weight:700">${po.qty||0}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">Cut</div><div style="font-weight:700">${cutTotal}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">Damaged</div><div style="font-weight:700;color:${pctColor}">${totalDamage}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">Usable</div><div style="font-weight:700;color:var(--green)">${usable}</div></div>
    </div>
    ${cutTotal>0?`<div style="margin-top:6px;font-size:11px;text-align:center;font-weight:600;color:${pctColor}">${pct.toFixed(2)}% damage rate ${pct>1.5?'⚠ Will be flagged':pct>1?'⚠ Near threshold':''}</div>`:''}
  </div>
  ${partsCard}
  ${destSections}
  ${pct>1.5?`<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px 14px;margin-bottom:10px">
    <div style="font-weight:700;color:#dc2626;font-size:13px;margin-bottom:4px">⚠ Damage Alert / نقصان کا انتباہ</div>
    <div style="font-size:12px;color:#991b1b;margin-bottom:6px">This bundling record will be flagged for excess loss of quantity (${pct.toFixed(2)}%). A manager will be notified.</div>
    <div style="font-size:12px;color:#991b1b;direction:rtl;text-align:right;font-family:serif">یہ بنڈلنگ ریکارڈ مقدار میں زیادہ نقصان (${pct.toFixed(2)}%) کی وجہ سے فلیگ کیا جائے گا۔ مینیجر کو اطلاع دی جائے گی۔</div>
  </div>`:''}
  <button class="mark-done-btn" id="bundling-done-btn" onclick="window.completeBundling('${po.fbKey}')" ${allBundled?'':'disabled'} style="margin-top:4px">Complete Bundling ✓</button>
  ${!allBundled?'<div style="font-size:11px;color:var(--muted);text-align:center;margin-top:6px">Mark all bundles done first — damage defaults to 0 if none</div>':''}
  <div style="height:80px"></div>`;
}

window.markBundlingDone=async function(bundleId,dest,poFbKey){
  const btn=document.querySelector(`#bi-${bundleId} button`);
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'bundles',bundleId),{bundlingDone:true,bundlingAt:new Date().toISOString(),bundlingAtBy:session.name,bundlingDest:dest});
    const idx=currentBundles.findIndex(b=>b.bundleId===bundleId);
    if(idx>=0)currentBundles[idx]={...currentBundles[idx],bundlingDone:true,bundlingDest:dest};
    if(!bundleDamage[bundleId])bundleDamage[bundleId]={dmg:0,entered:true,dest};
    const po=allPOs.find(p=>p.fbKey===poFbKey);if(po)document.getElementById('main-content').innerHTML=renderBundlingWork(po);
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent='Mark Bundled ✓';}}
};

window.saveBundleDamage=function(bundleId,val,dest,poFbKey){
  const dmg=parseInt(val)||0;
  bundleDamage[bundleId]={...(bundleDamage[bundleId]||{}),dmg,entered:true,dest};
  const po=allPOs.find(p=>p.fbKey===poFbKey);if(po)document.getElementById('main-content').innerHTML=renderBundlingWork(po);
};

window.bundlingOverride=async function(fbKey){
  if(!['owner','manager'].includes(session.role)){showToast('Not authorized.',true);return;}
  if(!confirm('Skip bundling stage and advance to stitching?'))return;
  try{
    await updateDoc(doc(db,'pos',fbKey),{currentStage:'stitching',[`stages.bundling.done`]:true,[`stages.bundling.doneAt`]:new Date().toISOString(),[`stages.bundling.doneBy`]:session.name+' (override)',[`stages.bundling.notes`]:'Skipped — no bundles'});
    await logActivity('Stage override',`PO bundling skipped by ${session.name}`);
    showToast('Advanced to stitching ✓');await loadData();window.showPage('my-work');
  }catch(e){showToast('Error: '+e.message,true);}
};

window.completeBundling=async function(fbKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po)return;
  const bundles=currentBundles;
  const allBundled=bundles.every(b=>b.bundlingDone);
  if(!allBundled){showToast('Mark all bundles as bundled first.',true);return;}
  const btn=document.getElementById('bundling-done-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const cutTotal=['XS','S','M','L','XL','2XL'].reduce((a,s)=>a+(po.cutQty?.[s]||0),0)||po.qty||0;
    const bySize={};
    bundles.forEach(b=>{
      const dmg=bundleDamage[b.bundleId]?.dmg||0;
      bySize[b.size]=(bySize[b.size]||0)+dmg;
    });
    const totalDamage=Object.values(bySize).reduce((a,v)=>a+v,0);
    const byBundle={};
    bundles.forEach(b=>{byBundle[b.bundleId]=bundleDamage[b.bundleId]?.dmg||0;});
    const pct=cutTotal>0?totalDamage/cutTotal*100:0;
    const flagged=pct>1.5;
    const damageSummary={total:totalDamage,bySize,byBundle,cutTotal,usable:cutTotal-totalDamage,pct:parseFloat(pct.toFixed(2))};
    const batch=writeBatch(db);
    bundles.forEach(b=>{
      batch.update(doc(db,'bundles',b.bundleId),{bundlingDest:bundleDamage[b.bundleId]?.dest||'Warehouse',damageQty:bundleDamage[b.bundleId]?.dmg||0});
    });
    await batch.commit();
    const poUpdate={currentStage:'stitching',[`stages.bundling.done`]:true,[`stages.bundling.doneAt`]:new Date().toISOString(),[`stages.bundling.doneBy`]:session.name,[`stages.bundling.notes`]:`${bundles.length} bundles · ${totalDamage} damaged · ${(cutTotal-totalDamage)} usable`,damageSummary,damagePercent:parseFloat(pct.toFixed(2))};
    if(flagged)Object.assign(poUpdate,{damageFlagged:true});
    await updateDoc(doc(db,'pos',fbKey),poUpdate);
    await logActivity('Stage done',`PO ${po.id} · Bundling complete — ${cutTotal-totalDamage} usable, ${totalDamage} damaged${flagged?' ⚠ FLAGGED':''}`);
    bundleDamage={};
    showToast(`Bundling complete ✓ — ${cutTotal-totalDamage} usable, ${totalDamage} damaged${flagged?' ⚠ Damage flagged':''}`,flagged);
    await loadData();window.showPage('my-work');
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent='Complete Bundling ✓';}}
};

// ── Stitching (individual bundle marking) ──
function renderBundleStageWork(po,stage,doneField,doneAtField,doneLabel,nextStage){
  const bundles=currentBundles;
  const doneCount=bundles.filter(b=>b[doneField]).length;
  const allDone=doneCount===bundles.length&&bundles.length>0;
  const bySz={};bundles.forEach(b=>{if(!bySz[b.size])bySz[b.size]=[];bySz[b.size].push(b);});
  const stageMeta=STAGES.find(s=>s.key===stage)||{};
  return`<button class="back-btn" onclick="window.showPage('my-work')">← Back to My Work</button>
  <div class="page-head"><div class="page-title">PO ${po.id} — ${stageMeta.label||stage}</div><div class="page-sub">${po.name||'—'}</div></div>
  <div class="card"><div class="card-title">Bundle progress</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px;font-weight:700;color:${allDone?'var(--green)':'var(--dark)'}">${doneCount}/${bundles.length}</span><span style="font-size:12px;color:var(--muted)">bundles ${doneLabel.toLowerCase()}</span></div>
    <div class="progress-strip"><div class="progress-fill" style="width:${bundles.length?Math.round(doneCount/bundles.length*100):0}%"></div></div>
  </div>
  ${Object.entries(bySz).map(([sz,bList])=>`<div class="card"><div class="card-title">${sz} — ${bList.length} bundle${bList.length!==1?'s':''}</div>
    ${bList.map(b=>`<div class="bundle-item" id="bi-${b.bundleId}">
      <span class="bundle-num">${b.bundleId}</span>
      <span class="bundle-size-tag">${b.size}</span>
      <span class="bundle-units ${b[doneField]?'bundle-done':''}">${b.units} pcs</span>
      <span style="flex:1"></span>
      ${b[doneField]?`<span style="color:var(--green);font-weight:600;font-size:12px">✓ ${doneLabel}</span>`:`<button class="qc-pass-btn" onclick="window.markBundleStage('${b.bundleId}','${stage}','${doneField}','${doneAtField}','${doneLabel}','${po.fbKey}','${nextStage}')">Mark ${doneLabel} ✓</button>`}
    </div>`).join('')}
  </div>`).join('')}
  ${!bundles.length?'<div class="empty">No bundles found for this PO.</div>':''}
  ${doneCount<bundles.length&&bundles.length>0?`<div style="font-size:11px;color:var(--muted);text-align:center;margin-bottom:6px">${bundles.length-doneCount} bundle${bundles.length-doneCount!==1?'s':''} remaining — you can still complete the stage</div>`:''}
  <button class="mark-done-btn" id="stage-done-btn" onclick="window.completeStage('${po.fbKey}','${stage}','${nextStage}')" ${bundles.length>0?'':'disabled'}>Complete ${stageMeta.label||stage} ✓</button>
  <div style="height:80px"></div>`;
}

window.markBundleStage=async function(bundleId,stage,doneField,doneAtField,doneLabel,poFbKey,nextStage){
  const btn=document.querySelector(`#bi-${bundleId} button`);if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'bundles',bundleId),{[doneField]:true,[doneAtField]:new Date().toISOString(),[doneAtField+'By']:session.name});
    const idx=currentBundles.findIndex(b=>b.bundleId===bundleId);
    if(idx>=0){currentBundles[idx]={...currentBundles[idx],[doneField]:true};}
    const po=allPOs.find(p=>p.fbKey===poFbKey);if(po)renderPage('stage-work');
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent=`Mark ${doneLabel} ✓`;}}
};

window.completeStage=async function(fbKey,stage,nextStage){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po)return;
  const stageMeta=STAGES.find(s=>s.key===stage);
  const notes=prompt(`Complete "${stageMeta?.label}" for PO ${po.id}?\n\nNotes (optional):`);
  if(notes===null)return;
  const btn=document.getElementById('stage-done-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'pos',fbKey),{currentStage:nextStage,[`stages.${stage}.done`]:true,[`stages.${stage}.doneAt`]:new Date().toISOString(),[`stages.${stage}.doneBy`]:session.name,[`stages.${stage}.notes`]:notes||''});
    await logActivity('Stage done',`PO ${po.id} · ${stageMeta?.label} completed`);
    showToast(`${stageMeta?.label} complete ✓`);await loadData();window.showPage('my-work');
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;}}
};

// ── Printing QC / Washing (lot-level) ──
function renderLotStageWork(po,stage,stageTitle,nextStage){
  const bundles=currentBundles;
  return`<button class="back-btn" onclick="window.showPage('my-work')">← Back to My Work</button>
  <div class="page-head"><div class="page-title">PO ${po.id} — ${stageTitle}</div><div class="page-sub">${po.name||'—'} · ${po.qty||'?'} pcs</div></div>
  <div class="card"><div class="card-title">Bundle reference</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">
      ${bundles.map(b=>`<div style="padding:5px 10px;background:#f4f4f6;border-radius:8px;font-size:12px;font-weight:600">${b.bundleId} <span style="color:var(--muted);font-weight:400">${b.size} · ${b.units}pcs</span></div>`).join('')||'<div style="color:var(--muted);font-size:12px">No bundles on record.</div>'}
    </div>
  </div>
  <div class="card"><div class="card-title">Completion</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px">Mark the entire lot as complete to advance to the next stage.</div>
    <button class="mark-done-btn" onclick="window.completeStage('${po.fbKey}','${stage}','${nextStage}')">Mark ${stageTitle} Complete ✓</button>
  </div><div style="height:80px"></div>`;
}

// ── Final QC ──
function renderQCWork(po){
  const bundles=currentBundles;
  const passed=bundles.filter(b=>b.qcStatus==='pass').length;
  const failed=bundles.filter(b=>b.qcStatus==='fail').length;
  const pending=bundles.filter(b=>!b.qcStatus).length;
  const canComplete=pending===0&&bundles.length>0;
  return`<button class="back-btn" onclick="window.showPage('my-work')">← Back to My Work</button>
  <div class="page-head"><div class="page-title">PO ${po.id} — Final QC</div><div class="page-sub">${po.name||'—'}</div></div>
  <div class="card"><div class="card-title">QC summary</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      <div style="text-align:center;padding:10px;background:#f4f4f6;border-radius:8px"><div style="font-size:20px;font-weight:700;color:var(--muted)">${pending}</div><div style="font-size:10px;color:var(--muted)">Pending</div></div>
      <div style="text-align:center;padding:10px;background:#EFEFEF;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#111">${passed}</div><div style="font-size:10px;color:var(--muted)">Passed</div></div>
      <div style="text-align:center;padding:10px;background:#fef2f2;border-radius:8px"><div style="font-size:20px;font-weight:700;color:#dc2626">${failed}</div><div style="font-size:10px;color:#dc2626">Failed</div></div>
    </div>
  </div>
  ${bundles.map(b=>`<div class="bundle-item" id="qci-${b.bundleId}" style="background:${b.qcStatus==='pass'?'#f0fdf4':b.qcStatus==='fail'?'#fef2f2':'#f8f8f8'}">
    <span class="bundle-num">${b.bundleId}</span>
    <span class="bundle-size-tag">${b.size}</span>
    <span class="bundle-units" style="flex:1">${b.units} pcs</span>
    ${b.qcStatus==='pass'?'<span style="color:var(--green);font-weight:700">✓ Pass</span>':b.qcStatus==='fail'?`<span style="color:#dc2626;font-weight:700">✗ Fail</span><span style="font-size:11px;color:#dc2626;margin-left:6px">${b.qcReason||''}</span>`:`<button class="qc-pass-btn" onclick="window.setQC('${b.bundleId}','pass','')">Pass ✓</button><button class="qc-fail-btn" style="margin-left:6px" onclick="window.setQCFail('${b.bundleId}')">Fail ✗</button>`}
  </div>`).join('')||'<div class="empty">No bundles found.</div>'}
  <button class="mark-done-btn" id="qc-done-btn" onclick="window.completeQC('${po.fbKey}')" ${canComplete?'':'disabled'} style="margin-top:10px">Complete QC${failed>0?` (${failed} failed)`:' ✓'}</button>
  <div style="height:80px"></div>`;
}

window.setQC=async function(bundleId,status,reason){
  try{
    await updateDoc(doc(db,'bundles',bundleId),{qcStatus:status,qcReason:reason,qcAt:new Date().toISOString(),qcBy:session.name});
    const idx=currentBundles.findIndex(b=>b.bundleId===bundleId);
    if(idx>=0){currentBundles[idx]={...currentBundles[idx],qcStatus:status,qcReason:reason};}
    const po=allPOs.find(p=>p.fbKey===stageWorkPO);if(po)document.getElementById('main-content').innerHTML=renderQCWork(po);
  }catch(e){showToast('Error: '+e.message,true);}
};
window.setQCFail=function(bundleId){
  const reason=prompt('Reason for failure:');if(reason===null)return;
  window.setQC(bundleId,'fail',reason||'No reason given');
};
window.completeQC=async function(fbKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po)return;
  const failed=currentBundles.filter(b=>b.qcStatus==='fail').length;
  const msg=failed>0?`Complete QC with ${failed} failed bundle${failed!==1?'s':''}?`:'Mark Final QC complete?';
  if(!confirm(msg))return;
  const btn=document.getElementById('qc-done-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'pos',fbKey),{currentStage:'completed',[`stages.qc.done`]:true,[`stages.qc.doneAt`]:new Date().toISOString(),[`stages.qc.doneBy`]:session.name,[`stages.qc.notes`]:failed>0?`${failed} bundles failed QC`:''});
    await logActivity('Stage done',`PO ${po.id} · Final QC complete — ${currentBundles.filter(b=>b.qcStatus==='pass').length} passed, ${failed} failed`);
    showToast(`QC complete ✓`);await loadData();window.showPage('my-work');
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;}}
};

// ── Gate Pass ──
window.generatePOPdf=function(fbKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po){showToast('PO not found.',true);return;}
  if(window.__usePrintEngine&&typeof window.printDocument==='function'){
    return window.printDocument({type:'generic',data:{
      documentType:'Production Order',documentNumber:po.id,id:po.id,
      title:`Production Order ${po.id}`,
      subtitle:[po.name,po.code].filter(Boolean).join(' · '),
      bodyHtml:`<p>Product: ${po.name||'—'} (${po.code||'—'})</p><p>Pattern: ${po.pattern||'—'}</p><p>Total Qty: ${po.qty||'—'} pcs</p><p>Ratio: ${po.ratio||'—'}</p><p>Fabric: ${po.fabric||'—'} (${po.fabricCode||'—'})</p><p>Store: ${po.store||'—'}</p><p>Current Stage: ${po.currentStage||'—'}</p><p>Created: ${po.createdAt||'—'} by ${po.createdBy||'—'}</p>`
    }});
  }
  const{jsPDF}=window.jspdf;const pdf=new jsPDF({unit:'mm',format:'a4'});
  const W=210,M=14;let y=18;
  // Header
  pdf.setFillColor(26,26,46);pdf.rect(0,0,W,28,'F');
  pdf.setTextColor(255,255,255);pdf.setFontSize(16);pdf.setFont(undefined,'bold');pdf.text('Groovy Operations',M,12);
  pdf.setFontSize(10);pdf.setFont(undefined,'normal');pdf.setTextColor(200,200,200);pdf.text('Production Order',M,20);
  pdf.setFontSize(18);pdf.setFont(undefined,'bold');pdf.setTextColor(233,69,96);pdf.text(po.id,W-M,12,{align:'right'});
  pdf.setFontSize(9);pdf.setFont(undefined,'normal');pdf.setTextColor(200,200,200);pdf.text(`Created: ${po.createdAt||'—'} by ${po.createdBy||'—'}`,W-M,20,{align:'right'});
  y=36;pdf.setTextColor(26,26,46);

  // Product details
  pdf.setFillColor(242,242,244);pdf.rect(M,y,W-M*2,7,'F');
  pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('PRODUCT DETAILS',M+2,y+5);
  y+=10;pdf.setTextColor(26,26,46);
  const details=[[`Name: ${po.name||'—'}`,`Code: ${po.code||'—'}`],[`Pattern: ${po.pattern||'—'}`,`Total Qty: ${po.qty||'—'} pcs`],[`Ratio: ${po.ratio||'—'}`,``]];
  pdf.setFontSize(10);details.forEach(row=>{pdf.setFont(undefined,'normal');pdf.text(row[0],M,y);if(row[1])pdf.text(row[1],W/2,y);y+=6;});

  // Fabric & supply
  y+=4;pdf.setFillColor(242,242,244);pdf.rect(M,y,W-M*2,7,'F');
  pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('FABRIC & SUPPLY',M+2,y+5);
  y+=10;pdf.setTextColor(26,26,46);pdf.setFontSize(10);pdf.setFont(undefined,'normal');
  const fab=[[`Fabric: ${po.fabric||'—'}`,`Code: ${po.fabricCode||'—'}`],[`Store: ${po.store||'—'}`,`Rolls: ${po.totalRoll||'—'}`],[`Weight: ${po.totalWeight||'—'}`,`Avg/unit: ${po.avgPerUnit||'—'}`]];
  fab.forEach(row=>{pdf.text(row[0],M,y);if(row[1])pdf.text(row[1],W/2,y);y+=6;});

  // Size breakdown table
  y+=6;pdf.setFillColor(242,242,244);pdf.rect(M,y,W-M*2,7,'F');
  pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('SIZE BREAKDOWN',M+2,y+5);
  y+=10;
  const szs=['XS','S','M','L','XL','2XL'];const colW=(W-M*2)/szs.length;
  pdf.setFillColor(26,26,46);pdf.rect(M,y,W-M*2,8,'F');
  szs.forEach((sz,i)=>{pdf.setTextColor(255,255,255);pdf.setFontSize(9);pdf.setFont(undefined,'bold');pdf.text(sz,M+colW*i+colW/2,y+5,{align:'center'});});
  y+=8;pdf.setDrawColor(229,229,231);pdf.setLineWidth(0.3);
  szs.forEach((sz,i)=>{pdf.setTextColor(26,26,46);pdf.setFont(undefined,'normal');pdf.setFontSize(12);pdf.text(String(po.sizes?.[sz]||0),M+colW*i+colW/2,y+7,{align:'center'});});
  y+=14;
  if(po.cutQty){
    pdf.setFontSize(8);pdf.setTextColor(107,114,128);
    szs.forEach((sz,i)=>{pdf.text(`Cut:${po.cutQty[sz]||0}`,M+colW*i+colW/2,y,{align:'center'});});
    y+=6;
  }

  // Stage timeline
  y+=4;pdf.setFillColor(242,242,244);pdf.rect(M,y,W-M*2,7,'F');
  pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('PRODUCTION TIMELINE',M+2,y+5);
  y+=10;pdf.setFontSize(9);
  STAGES.forEach(s=>{
    const sd=po.stages?.[s.key]||{};const isDone=!!sd.done,isCurrent=po.currentStage===s.key;
    pdf.setTextColor(isDone?29:isCurrent?233:107,isDone?158:isCurrent?69:114,isDone?117:isCurrent?96:128);
    pdf.setFont(undefined,'bold');pdf.text(s.label,M,y);
    pdf.setFont(undefined,'normal');
    if(isDone)pdf.text(`✓ Done by ${sd.doneBy||'?'} on ${sd.doneAt?new Date(sd.doneAt).toLocaleDateString('en-GB'):'—'}`,M+40,y);
    else if(isCurrent)pdf.text('In progress',M+40,y);
    else pdf.text('Pending',M+40,y);
    if(sd.dueDate)pdf.text(`Due: ${sd.dueDate}`,W-M-30,y);
    y+=6;if(y>270){pdf.addPage();y=20;}
  });

  // Front image
  if(po.imgFront){
    try{
      if(y>200){pdf.addPage();y=20;}
      y+=4;pdf.setFontSize(8);pdf.setTextColor(107,114,128);pdf.setFont(undefined,'bold');pdf.text('FRONT IMAGE',M,y);y+=4;
      pdf.addImage(po.imgFront,'JPEG',M,y,50,65);y+=70;
    }catch(e){}
  }

  // Footer
  pdf.setTextColor(107,114,128);pdf.setFontSize(8);pdf.setFont(undefined,'normal');
  pdf.text(`Groovy Operations · PO ${po.id} · Generated ${new Date().toLocaleDateString('en-GB')}`,W/2,288,{align:'center'});
  pdf.save(`${po.id}.pdf`);showToast('PDF downloaded ✓');
};

// ── PDF: Gate Pass ──

/* Groovy Operations — pos.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

/* The app's oldest and most-used loader, and until Sept 2026 the one that
   still had the failure mode CLAUDE.md records under "Loading must never
   hang" — four of its seven queries sat un-caught inside a Promise.all, so
   ONE rejected read threw away all seven results. The dashboard then showed
   zeros everywhere (0 POs, 0 gate passes, empty stage overview) and a single
   red toast that named no collection, which is exactly what a
   "Missing or insufficient permissions" report looks like from the outside:
   total failure, no clue which read was refused.

   Now every query settles independently. Whatever succeeded is shown,
   whatever failed is NAMED, and a permission error is retried once behind a
   forced token refresh — but only for the queries that actually failed,
   rather than re-running all seven.

   The three that were already `.catch()`-ed stay optional: a denial there is
   expected for some roles and must not raise anything. */
const _POS_LOADS=[
  {name:'pos',                    run:()=>getDocs(query(collection(db,'pos'),orderBy('ts','desc'))),
    apply:s=>{allPOs=s.docs.map(d=>({...d.data(),fbKey:d.id}));}},
  {name:'gatepasses',             run:()=>getDocs(query(collection(db,'gatepasses'),orderBy('ts','desc'))),
    apply:s=>{allPasses=s.docs.map(d=>d.data());}},
  {name:'returns',                run:()=>getDocs(query(collection(db,'returns'),orderBy('ts','desc'))),
    apply:s=>{allReturns=s.docs.map(d=>d.data());}},
  {name:'fabricin',               run:()=>getDocs(query(collection(db,'fabricin'),orderBy('ts','desc'))),
    apply:s=>{allFabricIn=s.docs.map(d=>d.data());}},
  {name:'gatepass_edit_requests', optional:true,
    run:()=>getDocs(query(collection(db,'gatepass_edit_requests'),orderBy('ts','desc'))),
    apply:s=>{allGPEditRequests=s.docs.map(d=>d.data());}},
  {name:'fabric_inventory',       optional:true,
    run:()=>getDocs(collection(db,'fabric_inventory')),
    apply:s=>{allFabricInventory=s.docs.map(d=>({...d.data(),_id:d.id}));}},
  {name:'fabric_movements',       optional:true,
    run:()=>getDocs(query(collection(db,'fabric_movements'),orderBy('ts','desc'))),
    apply:s=>{allFabricMovements=s.docs.map(d=>({...d.data(),_id:d.id}));}}
];
// Which hard reads failed on the last loadData() (null = never loaded) and when it finished. The PO Registry
// (js/po-registry.js) reads them so a failed pos read draws an error card, never an empty list.
let _posLoadFailed=null,_posLoadAt=null;
function _posIsPermission(e){
  return !!e&&(e.code==='permission-denied'||String(e.message||'').indexOf('permissions')>-1);
}
// Runs the given jobs, applies whatever came back, and returns the ones that
// did not. Never throws.
async function _posRunLoads(jobs){
  const settled=await Promise.allSettled(jobs.map(j=>j.run()));
  const failed=[];
  settled.forEach((r,i)=>{
    if(r.status==='fulfilled'){
      try{jobs[i].apply(r.value);}catch(e){console.warn('[loadData] could not apply '+jobs[i].name+':',e);}
    }else{
      failed.push({job:jobs[i],err:r.reason});
      console.warn('[loadData] '+jobs[i].name+' failed:',(r.reason&&(r.reason.code||r.reason.message))||r.reason);
    }
  });
  return failed;
}
async function loadData(){
  let failed=await _posRunLoads(_POS_LOADS);
  // One retry behind a forced token refresh, for the permission failures
  // only. A stale ID token is the one cause this can actually fix; retrying
  // the reads that already succeeded would just double the cost.
  const retry=failed.filter(f=>_posIsPermission(f.err)).map(f=>f.job);
  if(retry.length&&auth.currentUser){
    try{
      await auth.currentUser.getIdToken(true);
      const still=await _posRunLoads(retry);
      const stillIds=new Set(still.map(f=>f.job.name));
      failed=failed.filter(f=>stillIds.has(f.job.name)||!retry.some(j=>j.name===f.job.name));
    }catch(e){console.warn('[loadData] token refresh failed:',e);}
  }
  _posLoadFailed=failed.filter(f=>!f.job.optional).map(f=>f.job.name);_posLoadAt=Date.now();
  // Whatever loaded is rendered either way — a dashboard showing six of
  // seven datasets beats a dashboard showing zeros.
  if(currentPage&&typeof renderPage==='function')renderPage(currentPage);
  if(typeof phSettingsEnsure==='function')phSettingsEnsure();   // WP1: the cut gate (one bounded read, never rejects)
  if(typeof _maybeLoadPrintingData==='function')_maybeLoadPrintingData();
  if(typeof loadProducts==='function')loadProducts();
  if(typeof loadHRMData==='function')loadHRMData().then(()=>{ if(currentPage==='dashboard'||currentPage==='hrm-employees'){const m=document.getElementById('main-content');if(m&&typeof renderPage==='function')renderPage(currentPage);} });

  const hard=failed.filter(f=>!f.job.optional);
  if(hard.length){
    // NAME the collections. "Missing or insufficient permissions" on its own
    // is unreportable — it is the same message whichever read was refused,
    // and the next person to see it has nothing to act on.
    const names=hard.map(f=>f.job.name).join(', ');
    const why=_posIsPermission(hard[0].err)
      ?'permission denied — check the firestore.rules block for '+(hard.length===1?'that collection':'those collections')+' and that the published rules match the repo'
      :((hard[0].err&&hard[0].err.message)||'unknown error');
    showToast('Could not load: '+names+' ('+why+')',true);
    console.warn('[loadData] gave up on:',names,hard.map(f=>f.err));
  }
}

async function loadBundles(poId){
  try{
    const snap=await getDocs(query(collection(db,'bundles'),where('poId','==',poId)));
    currentBundles=snap.docs.map(d=>d.data()).sort((a,b)=>a.bundleNumber-b.bundleNumber);
  }catch(e){currentBundles=[];}
}

// ── HRM: seed data, policies, loaders ─────────────────────────

// Load runtime-created products from Firestore `products` into
// allCustomProducts. These are merged with the static PRODUCT_CATALOG so
// new products added via the "New PO" form persist and are searchable
// across sessions/users. Safe no-op on permission errors (falls back to
// the static catalog).
async function loadProducts(){
  try{
    const snap=await getDocs(collection(db,'products'));
    allCustomProducts=snap.docs.map(d=>({...d.data(),code:d.data().code||d.id}));
    _productsLoaded=true;
  }catch(e){/* keep static catalog only */}
}

// Merged, de-duplicated product list: static PRODUCT_CATALOG + custom
// products (custom wins on code collision). This is the single source the
// PO search reads from.
function getProductCatalog(){
  const byCode={};
  PRODUCT_CATALOG.forEach(p=>{byCode[p.code.toUpperCase()]={code:p.code,name:p.name};});
  (allCustomProducts||[]).forEach(p=>{if(p&&p.code)byCode[String(p.code).toUpperCase()]={code:p.code,name:p.name,custom:true};});
  return Object.values(byCode);
}

// Distinct code prefixes (leading letters) with usage counts + an example,
// derived dynamically from the merged catalog — no hardcoded category list.
function _productPrefixes(){
  const map={};
  getProductCatalog().forEach(p=>{
    const m=String(p.code||'').match(/^([A-Za-z]+)/);
    if(!m)return;
    const pre=m[1].toUpperCase();
    if(!map[pre])map[pre]={prefix:pre,count:0,example:p.name};
    map[pre].count++;
  });
  return Object.values(map).sort((a,b)=>b.count-a.count||a.prefix.localeCompare(b.prefix));
}

// Compute the next unused code for a given prefix by scanning the merged
// catalog: max numeric suffix + 1, zero-padded to the widest existing
// suffix (min 3 digits). Prefix with no existing codes → PREFIX001.
function _nextProductCode(prefix){
  prefix=String(prefix||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!prefix)return'';
  let max=0,width=3;
  getProductCatalog().forEach(p=>{
    const m=String(p.code||'').toUpperCase().match(new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\d+)$'));
    if(m){const n=parseInt(m[1],10);if(n>max)max=n;width=Math.max(width,m[1].length);}
  });
  return prefix+String(max+1).padStart(width,'0');
}

window.filterProducts=function(q){
  const dd=document.getElementById('po-dropdown');
  if(!dd)return;
  const raw=(q||'').trim();
  q=raw.toLowerCase();
  const catalog=getProductCatalog();
  const hits=q?catalog.filter(p=>p.code.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)).slice(0,18):[];
  const addRow=`<div class="prod-add" style="padding:11px 12px;cursor:pointer;font-size:14px;font-weight:600;color:var(--dark);display:flex;gap:8px;align-items:center;background:var(--surface-2)"><span style="font-size:17px;line-height:1">+</span><span>Add new product${raw?` “${raw.replace(/"/g,'&quot;').slice(0,40)}”`:''}</span></div>`;
  if(!q){
    // Empty query: offer only the add-new action.
    dd.innerHTML=addRow;
  }else if(!hits.length){
    dd.innerHTML='<div style="padding:10px 12px;font-size:13px;color:var(--muted)">No matches found</div>'+addRow;
  }else{
    dd.innerHTML=hits.map((p,i)=>`<div class="prod-opt" data-i="${catalog.indexOf(p)}" style="padding:10px 12px;cursor:pointer;font-size:14px;border-bottom:1px solid #f3f4f6;display:flex;gap:10px;align-items:baseline"><span style="font-weight:700;color:var(--dark);min-width:80px;font-size:13px">${p.code}</span><span style="color:var(--text)">${p.name}</span></div>`).join('')+addRow;
  }
  dd.style.display='block';
  dd.querySelectorAll('.prod-opt').forEach(el=>el.addEventListener('mousedown',e=>{
    e.preventDefault();
    const p=catalog[+el.dataset.i];
    window._selectProduct(p.code,p.name);
  }));
  const addEl=dd.querySelector('.prod-add');
  if(addEl)addEl.addEventListener('mousedown',e=>{e.preventDefault();dd.style.display='none';window._openAddProductModal(raw);});
};

// Fill the PO form's hidden inputs from a chosen product + auto-detect recipe.
window._selectProduct=function(code,name){
  const s=document.getElementById('po-search'),n=document.getElementById('po-name'),c=document.getElementById('po-code'),dd=document.getElementById('po-dropdown');
  if(s)s.value=code+' — '+name;
  if(n)n.value=name;
  if(c)c.value=code;
  if(dd)dd.style.display='none';
  window._checkEmbRecipe(code,name);
};

// ── Add-new-product modal ──
window._openAddProductModal=function(prefill){
  // If the typed query looks like an existing/desired code prefix, preselect it.
  let container=document.getElementById('addprod-modal-container');
  if(!container){container=document.createElement('div');container.id='addprod-modal-container';document.body.appendChild(container);}
  const prefixes=_productPrefixes();
  // Guess a name from the prefill (unless it's clearly just a code).
  const looksLikeCode=/^[A-Za-z]{1,4}\d*$/.test((prefill||'').replace(/\s/g,''));
  const nameVal=(prefill&&!looksLikeCode)?prefill.replace(/"/g,'&quot;'):'';
  const opts=prefixes.map(p=>`<option value="${p.prefix}">${p.prefix} — ${p.count} item${p.count===1?'':'s'} (e.g. ${String(p.example||'').replace(/"/g,'&quot;').slice(0,28)})</option>`).join('');
  const firstPrefix=prefixes.length?prefixes[0].prefix:'GB';
  container.innerHTML='<div id="addprod-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target.id===\'addprod-overlay\')window._closeAddProductModal()">'+
    '<div style="background:var(--surface,#fff);width:100%;max-width:460px;border-radius:16px;padding:20px;max-height:calc(100vh - 32px);overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.35)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'+
        '<div style="font-size:17px;font-weight:700">Add New Product</div>'+
        '<button onclick="window._closeAddProductModal()" style="background:none;border:none;font-size:23px;cursor:pointer;color:var(--muted)">×</button>'+
      '</div>'+
      '<div style="font-size:12px;color:var(--muted);margin-bottom:14px">Creates a product and assigns it a code. It is saved for future POs and searchable everywhere.</div>'+
      '<div class="field" style="margin-bottom:12px"><label>Product name *</label><input id="np-name" value="'+nameVal+'" placeholder="e.g. Olive Green Hoodie" autocomplete="off"></div>'+
      '<div class="field" style="margin-bottom:12px"><label>Category / code prefix</label>'+
        '<select id="np-prefix" onchange="window._npPrefixChanged()" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none;background:var(--surface,#fff)">'+
          opts+'<option value="__custom__">＋ Create new prefix…</option>'+
        '</select>'+
        '<div id="np-prefix-custom-wrap" style="display:none;margin-top:8px">'+
          '<input id="np-prefix-custom" oninput="window._npCustomInput()" placeholder="New prefix e.g. GX" maxlength="6" autocomplete="off" style="width:100%;font-weight:700;letter-spacing:.5px;text-transform:uppercase">'+
          '<div id="np-prefix-preview" style="font-size:12px;color:var(--muted);margin-top:5px">Letters/numbers only. A new prefix is created the moment you save this product.</div>'+
        '</div>'+
      '</div>'+
      '<div class="field" style="margin-bottom:6px"><label>Assigned code</label>'+
        '<div style="display:flex;gap:8px;align-items:center">'+
          '<input id="np-code" oninput="window._npCodeEdited=true" style="flex:1;font-weight:700;letter-spacing:.5px" autocomplete="off">'+
          '<button type="button" onclick="window._npCodeEdited=false;window._npUpdateCode()" class="btn-outline" style="white-space:nowrap;padding:8px 12px">Auto</button>'+
        '</div>'+
        '<div id="np-code-hint" style="font-size:12px;color:var(--muted);margin-top:5px">Auto-assigned. Edit if you need a specific code.</div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-top:18px">'+
        '<button class="btn-outline" onclick="window._closeAddProductModal()" style="flex:1">Cancel</button>'+
        '<button class="btn-primary" id="np-save-btn" style="flex:1" onclick="window._saveNewProduct()">Save Product</button>'+
      '</div>'+
    '</div>'+
  '</div>';
  window._npCodeEdited=false;
  const sel=document.getElementById('np-prefix');if(sel)sel.value=firstPrefix;
  window._npUpdateCode();
  setTimeout(()=>{const nEl=document.getElementById('np-name');if(nEl&&!nameVal)nEl.focus();},30);
};
window._closeAddProductModal=function(){const el=document.getElementById('addprod-modal-container');if(el)el.innerHTML='';};
window._npPrefixChanged=function(){
  const sel=document.getElementById('np-prefix'),wrap=document.getElementById('np-prefix-custom-wrap'),custom=document.getElementById('np-prefix-custom');
  if(!sel)return;
  if(sel.value==='__custom__'){if(wrap)wrap.style.display='block';if(custom)custom.focus();}
  else if(wrap){wrap.style.display='none';}
  window._npUpdateCode();
};
// New-prefix input: normalise to A–Z/0–9 in place, then re-derive the code + preview.
window._npCustomInput=function(){
  const custom=document.getElementById('np-prefix-custom');
  if(custom){const clean=custom.value.toUpperCase().replace(/[^A-Z0-9]/g,'');if(clean!==custom.value)custom.value=clean;}
  window._npCodeEdited=false; // creating a new prefix always re-auto the code
  window._npUpdateCode();
  const pv=document.getElementById('np-prefix-preview'),pre=window._npCurrentPrefix();
  if(pv)pv.textContent=pre?('New product will be coded '+_nextProductCode(pre)+' (and '+pre+' becomes a reusable prefix).'):'Letters/numbers only. A new prefix is created the moment you save this product.';
};
window._npCurrentPrefix=function(){
  const sel=document.getElementById('np-prefix');
  if(!sel)return'';
  if(sel.value==='__custom__')return(document.getElementById('np-prefix-custom')?.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  return sel.value;
};
window._npUpdateCode=function(){
  if(window._npCodeEdited)return; // don't clobber a manual edit
  const code=_nextProductCode(window._npCurrentPrefix());
  const cEl=document.getElementById('np-code');if(cEl)cEl.value=code;
};
window._saveNewProduct=async function(){
  const nameEl=document.getElementById('np-name'),codeEl=document.getElementById('np-code'),btn=document.getElementById('np-save-btn'),hint=document.getElementById('np-code-hint');
  const name=(nameEl?.value||'').trim();
  let code=(codeEl?.value||'').trim().toUpperCase().replace(/\s+/g,'');
  if(!name){showToast('Product name required.',true);nameEl?.focus();return;}
  if(!/^[A-Z0-9-]{2,}$/.test(code)){showToast('Enter a valid code (letters/numbers, e.g. GH018).',true);codeEl?.focus();return;}
  // Uniqueness check against the merged catalog.
  const clash=getProductCatalog().find(p=>String(p.code).toUpperCase()===code);
  if(clash){if(hint){hint.textContent='Code '+code+' already exists ('+clash.name+'). Pick another or press Auto.';hint.style.color='var(--red,#dc2626)';}return;}
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const payload={code,name,createdBy:session?.name||'',createdAt:new Date().toISOString().slice(0,10),ts:Date.now()};
    await setDoc(doc(db,'products',code),payload);
    // Update in-memory catalog immediately so it's searchable without a reload.
    const idx=allCustomProducts.findIndex(p=>String(p.code).toUpperCase()===code);
    if(idx>=0)allCustomProducts[idx]=payload;else allCustomProducts.push(payload);
    await logActivity('Product added',`${code} — ${name}`).catch(()=>{});
    window._closeAddProductModal();
    showToast(`Product ${code} added ✓`);
    window._selectProduct(code,name); // auto-select it in the PO form
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='Save Product';}
    showToast('Could not save product: '+e.message,true);
  }
};
function poRowHTML(p){
  if(typeof porRowForPO==='function'){try{return porRowForPO(p);}catch(e){console.warn('[pos] the PO Registry row failed, drawing the old one:',e);}}   // RG5: one row everywhere
  const st=poStatusOf(p);
  const isReserved=st===PO_STATUS.RESERVED;
  const isCancelled=st===_PO_CANCELLED; // a cancelled PO has no stage; without this it would read "Completed"
  const isCompleted=st===PO_STATUS.COMPLETE||p.currentStage==='completed';
  const stage=STAGES.find(s=>s.key===p.currentStage)||{label:isReserved?'Reserved':'Completed',color:'#111111'};
  const badgeLabel=isCancelled?'Cancelled':isReserved?'Reserved':isCompleted?'Completed':stage.label;
  const badgeBg=isCancelled?'var(--accent-urgent-soft)':isReserved?'#fef3c7':isCompleted?'#EFEFEF':'#f0f0f0';
  const badgeColor=isCancelled?'var(--accent-urgent)':isReserved?'#b45309':'#111';
  return`<div class="po-row" onclick="window.openPODetail('${p.fbKey}')">
    <div class="po-img">${p.imgFront?`<img src="${p.imgFront}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`:'<span style="font-size:11px;color:var(--muted)">No img</span>'}</div>
    <div class="po-info">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="po-num">${p.id}</span>
        <span class="stage-badge" style="background:${badgeBg};color:${badgeColor}">${badgeLabel}</span>${p.damageFlagged?`<span style="padding:2px 6px;background:var(--accent-urgent-soft);color:var(--accent-urgent);border-radius:6px;font-size:11px;font-weight:700">⚠ Loss</span>`:''}</div>
      <div class="po-name">${p.name||'—'}</div>
      <div class="po-meta">${[(p.qty||'?')+' pcs',p.fabric,p.createdBy||'—',p.createdAt].filter(Boolean).join(' · ')}</div>
    </div><div class="po-arrow">›</div></div>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  PO production-flow model (see PO_PRODUCTION_FLOW_PLAN.md)
//  Pure helpers only — NO UI, NO writes. Shared by the reserve → cutting →
//  packing → QC → transfer spine. Every helper tolerates legacy PO docs that
//  predate the new fields, so nothing already in the registry regresses.
// ═══════════════════════════════════════════════════════════════════════
const PO_STATUS={RESERVED:'reserved',IN_PRODUCTION:'in_production',COMPLETE:'complete'};
const PO_FLOW_SIZES=['XS','S','M','L','XL','2XL'];

// Effective status, tolerant of legacy docs with no poStatus. A legacy PO with
// a live stage is treated as in_production (never regressed to "reserved"); a
// completed one as complete.
function poStatusOf(po){
  if(!po)return PO_STATUS.RESERVED;
  if(po.poStatus)return po.poStatus;
  if(po.currentStage==='completed')return PO_STATUS.COMPLETE;
  return po.currentStage?PO_STATUS.IN_PRODUCTION:PO_STATUS.RESERVED;
}

// Sum an append-only per-size ledger (packingReceipts / stockTransfers) into a
// {size:qty} map. Each entry: {size, qty, ...}. Tolerates an absent array.
function _poSumBySize(entries){
  const out={};
  (entries||[]).forEach(e=>{ if(!e||!e.size)return; out[e.size]=(out[e.size]||0)+(Number(e.qty)||0); });
  return out;
}
// Cut pieces per size — Uzaib's actual cut count (the anchor). Prefer the
// explicit cutBySize, then the cutting stage's cutQty (what markCuttingDone
// already records), then the PO's planned size breakdown for legacy docs.
function poCutBySize(po){
  if(po&&po.cutBySize&&typeof po.cutBySize==='object')return {...po.cutBySize};
  if(po&&po.cutQty&&typeof po.cutQty==='object')return {...po.cutQty};
  return (po&&po.sizes)?{...po.sizes}:{};
}
function poReceivedBySize(po){ return _poSumBySize(po&&po.packingReceipts); }
function poTransferredBySize(po){ return _poSumBySize(po&&po.stockTransfers); }
function _poSumMap(m){ return Object.values(m||{}).reduce((a,n)=>a+(Number(n)||0),0); }
function poCutTotal(po){ return _poSumMap(poCutBySize(po)); }
function poReceivedTotal(po){ return _poSumMap(poReceivedBySize(po)); }
function poTransferredTotal(po){ return _poSumMap(poTransferredBySize(po)); }
// Balance still owed against the anchor cut, per size (never negative).
function poBalanceBySize(po){
  const cut=poCutBySize(po),tr=poTransferredBySize(po),out={};
  PO_FLOW_SIZES.forEach(sz=>{ if(cut[sz]||tr[sz])out[sz]=Math.max(0,(cut[sz]||0)-(tr[sz]||0)); });
  return out;
}
// Fully received when every cut size has been received in at least its cut qty.
function poFullyReceived(po){
  const cut=poCutBySize(po),rec=poReceivedBySize(po);
  const keys=Object.keys(cut).filter(sz=>cut[sz]>0);
  return keys.length?keys.every(sz=>(rec[sz]||0)>=(cut[sz]||0)):false;
}

// ── Registry ──
// One-time cleanup: remove POs that an earlier build auto-created from fabric
// issues (flagged autoCreatedFrom). Fabric issues now live in their own
// Fabric Issue Registry, not the PO registry.
let _poJunkCleanupDone=false;
function _cleanupAutoFabricPOs(){
  if(_poJunkCleanupDone)return;
  const junk=allPOs.filter(p=>p.autoCreatedFrom&&String(p.autoCreatedFrom).startsWith('fabric-issue'));
  if(!junk.length){_poJunkCleanupDone=true;return;}
  if(session.role!=='owner'&&session.role!=='manager')return; // only privileged users can delete
  _poJunkCleanupDone=true;
  (async()=>{
    for(const p of junk){try{await deleteDoc(doc(db,'pos',p.fbKey));}catch(e){console.warn('[pos] junk PO delete failed',p.id,e);}}
    await logActivity('PO cleanup',`${junk.length} auto-created fabric PO(s) removed`).catch(()=>{});
    await loadData();if(currentPage==='po-registry')renderPage('po-registry');
  })();
}
let _poRegTab='orders';
function renderRegistry(){
  // The rebuilt Orders body (js/po-registry.js) never deletes on open; the old list still runs the junk cleanup.
  if(!(_poRegTab==='orders'&&typeof porRegistryHTML==='function'))_cleanupAutoFabricPOs();
  const reservedCount=allPOs.filter(p=>poStatusOf(p)===PO_STATUS.RESERVED).length;
  // A cancelled PO stays in the list (with its chip) but is not a live order,
  // so it is counted apart from the pipeline figure.
  const cancelledCount=allPOs.filter(p=>poStatusOf(p)===_PO_CANCELLED).length;
  const liveCount=allPOs.length-cancelledCount;
  const sub=`${liveCount} production order${liveCount!==1?'s':''}${reservedCount?` · <span style="color:var(--accent-warning);font-weight:600">${reservedCount} reserved</span>`:''}${cancelledCount?` · <span style="color:var(--accent-urgent);font-weight:600">${cancelledCount} cancelled</span>`:''}`;
  return`<div class="page-head"><div class="page-title">PO Registry</div><div class="page-sub">${sub}</div></div>
  <div class="gp-tabs">
    <button class="gp-tab${_poRegTab==='orders'?' active':''}" onclick="window.switchPoRegTab('orders')">Orders</button>
    <button class="gp-tab${_poRegTab==='cutting'?' active':''}" onclick="window.switchPoRegTab('cutting')">Cutting / Issue Registry</button>
  </div>
  <div id="po-reg-tab-content">${_poRegTabContent()}</div>`;
}
// Tab body: the Orders list, or a live mirror of the Fabric Issue Registry
// (issue-to-production records, with the same overview + tags). See
// PO_PRODUCTION_FLOW_PLAN.md §4.3.
function _poRegTabContent(){
  if(_poRegTab==='cutting')return typeof renderFabricIssueRegistry==='function'?renderFabricIssueRegistry():'<div class="empty" style="padding:24px">Fabric Issue Registry unavailable.</div>';
  if(typeof porRegistryHTML==='function'){try{return porRegistryHTML();}catch(e){console.warn('[pos] the PO Registry body failed, drawing the old list:',e);}}
  return _poRegOrdersHTML();
}
function _poRegOrdersHTML(){
  const reservedCount=allPOs.filter(p=>poStatusOf(p)===PO_STATUS.RESERVED).length;
  const cancelledCount=allPOs.filter(p=>poStatusOf(p)===_PO_CANCELLED).length;
  return`<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <input placeholder="Search name, code, fabric…" oninput="window.filterPOs(this.value)" style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);outline:none">
    <select onchange="window.filterStage(this.value)" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);outline:none">
      <option value="">All stages</option><option value="reserved">🟡 Reserved${reservedCount?` (${reservedCount})`:''}</option>${STAGES.map(s=>`<option value="${s.key}">${s.label}</option>`).join('')}<option value="completed">Completed</option>${cancelledCount?`<option value="cancelled">Cancelled (${cancelledCount})</option>`:''}
    </select>
  </div>
  <div id="po-list-wrap">${allPOs.length?allPOs.map(p=>poRowHTML(p)).join(''):'<div class="empty">No POs yet.</div>'}</div>`;
}
window.switchPoRegTab=function(tab){_poRegTab=tab;const m=document.getElementById('main-content');if(m)m.innerHTML=renderRegistry();};
window.filterPOs=function(q){const f=allPOs.filter(p=>!q||[p.name,p.id,p.code,p.fabric].some(v=>(v||'').toLowerCase().includes(q.toLowerCase())));document.getElementById('po-list-wrap').innerHTML=f.length?f.map(p=>poRowHTML(p)).join(''):'<div class="empty">No results.</div>';};
window.filterStage=function(s){const f=!s?allPOs:(s==='reserved'?allPOs.filter(p=>poStatusOf(p)===PO_STATUS.RESERVED):s==='cancelled'?allPOs.filter(p=>poStatusOf(p)===_PO_CANCELLED):allPOs.filter(p=>p.currentStage===s));document.getElementById('po-list-wrap').innerHTML=f.length?f.map(p=>poRowHTML(p)).join(''):'<div class="empty">No results.</div>';};

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

// Fabric currently RESERVED for a PO (rolls + weight), read from the live
// fabric inventory. Used for the reserve-order coverage hint / release warning.
function _poReservedFabric(poId){
  let rolls=0,weight=0;
  (typeof allFabricInventory!=='undefined'&&Array.isArray(allFabricInventory)?allFabricInventory:[]).forEach(s=>{
    (s.rolls||[]).forEach(r=>{ if((r.status||'')==='reserved'&&r.reservedPO===poId){rolls++;weight+=(Number(r.weight)||0);} });
  });
  return{rolls,weight};
}
function _poReserveSummary(po){
  const f=_poReservedFabric(po.id);
  if(!f.rolls)return'No fabric reserved yet — you can still release (fabric can be issued at cutting).';
  return`${f.rolls} roll${f.rolls!==1?'s':''} · ${f.weight.toFixed(1)} kg reserved for this PO.`;
}

// Release a RESERVED reserve order into production. Manager-only. Fabric
// coverage is optional (warn-only): if nothing is reserved, confirm first.
// Sets poStatus → in_production and currentStage → cutting (Uzaib's queue).
window.releaseToProduction=async function(fbKey){
  if(!['owner','manager'].includes(session.role)){showToast('Only managers can release a PO to production.',true);return;}
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po){showToast('PO not found.',true);return;}
  if(poStatusOf(po)!==PO_STATUS.RESERVED){showToast('This PO is already in production.',true);return;}
  const f=_poReservedFabric(po.id);
  if(!f.rolls&&!confirm(`No fabric is reserved for ${po.id}. Release to production anyway?\n\nFabric can still be issued at the cutting stage.`))return;
  try{
    await updateDoc(doc(db,'pos',fbKey),{poStatus:PO_STATUS.IN_PRODUCTION,currentStage:'cutting',releasedBy:session.name,releasedAt:new Date().toISOString()});
    await logActivity('PO released',`${po.id} released to production by ${session.name}`).catch(()=>{});
    showToast(`${po.id} released to production ✓`);
    await loadData();
    if(currentPage==='po-detail')renderDetailPage();else if(currentPage==='po-registry')renderPage('po-registry');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Job copies (embroidery / printing / washing) on the PO detail page ──
// ONE rule for which buttons show: po.jobCopies?.[kind]===true. A PO with no jobCopies field
// (every PO created before the field existed) shows all three so older POs keep working.
const _PO_JOB_KINDS=[
  {key:'embroidery',label:'Embroidery job',fn:'generateEmbroideryJobPdf'},
  {key:'printing',label:'Printing job',fn:'generatePrintingJobPdf'},
  {key:'washing',label:'Washing job',fn:'generateWashingJobPdf'}
];
function _poJobCopyKinds(po){
  const jc=po&&po.jobCopies;
  if(jc==null||typeof jc!=='object')return _PO_JOB_KINDS.map(k=>k.key);
  return _PO_JOB_KINDS.filter(k=>jc[k.key]===true).map(k=>k.key);
}
function _poJobCopiesHTML(po){
  const kinds=_poJobCopyKinds(po);
  if(!kinds.length)return'';
  const fb=String(po.fbKey||'').replace(/[^A-Za-z0-9_-]/g,'');
  const btns=kinds.map(k=>{
    const d=_PO_JOB_KINDS.find(x=>x.key===k);
    return`<button class="btn-pdf" style="min-height:34px" data-jobcopy="${k}" onclick="window.poJobCopyPrint('${fb}','${k}')">⬇ ${d.label}</button>`;
  }).join('');
  const all=kinds.length>1?`<button class="btn-pdf" style="min-height:34px" data-jobcopy="all" onclick="window.poJobCopyPrintAll('${fb}')">⬇ Print all selected</button>`:'';
  return`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px"><span class="info-label" style="font-size:13px">Job copies</span>${btns}${all}</div>`;
}
async function _poJobCopyRun(po,kind){
  const d=_PO_JOB_KINDS.find(x=>x.key===kind);
  try{
    if(!d||typeof window[d.fn]!=='function'){showToast('Job copy not available.',true);return false;}
    await window[d.fn](po);
    return true;
  }catch(e){showToast((d?d.label:'Job copy')+' failed: '+(e&&e.message||e),true);return false;}
}
window.poJobCopyPrint=function(fbKey,kind){
  const po=allPOs.find(p=>p.fbKey===fbKey);
  if(!po){showToast('PO not found.',true);return Promise.resolve(false);}
  return _poJobCopyRun(po,kind);
};
window.poJobCopyPrintAll=async function(fbKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);
  if(!po){showToast('PO not found.',true);return;}
  for(const k of _poJobCopyKinds(po)){await _poJobCopyRun(po,k);}
};

function renderDetailPage(){
  const po=allPOs.find(p=>p.fbKey===viewingPO);
  if(!po){window.showPage('po-registry');return;}
  const m=document.getElementById('main-content');
  const isOwner=['owner','manager'].includes(session.role);
  const _isReserved=poStatusOf(po)===PO_STATUS.RESERVED;
  const _reservedBanner=_isReserved?`<div class="card" style="border:2px solid var(--accent-warning);background:var(--accent-warning-soft);margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-size:19px">🟡</span>
      <div style="flex:1;min-width:180px">
        <div style="font-weight:800;color:var(--accent-warning);font-size:15px;letter-spacing:.01em">Reserve order — not yet in production</div>
        <div style="font-size:13px;color:var(--accent-warning);margin-top:2px">${_poReserveSummary(po)}</div>
      </div>
      ${isOwner?`<button class="mark-done-btn" style="width:auto;padding:9px 18px" onclick="window.releaseToProduction('${po.fbKey}')">Release to production →</button>`:'<span style="font-size:13px;color:var(--accent-warning)">A manager must release this PO.</span>'}
    </div></div>`:'';
  // A cancelled PO keeps its whole record; this says so, and who/why (the
  // reason is typed by a person, so it goes through _gpEsc).
  const _isCancelled=poStatusOf(po)===_PO_CANCELLED;
  const _cancelledBanner=_isCancelled?`<div class="card" style="border:2px solid var(--accent-urgent);background:var(--accent-urgent-soft);margin-bottom:12px">
    <div style="font-weight:800;color:var(--accent-urgent);font-size:15px">Cancelled — nothing was removed</div>
    <div style="font-size:13px;color:var(--accent-urgent);margin-top:2px">By ${_gpEsc(po.cancelledBy||'—')}${po.cancelledAt?' · '+new Date(po.cancelledAt).toLocaleDateString('en-GB'):''}${po.cancelledReason?' — '+_gpEsc(po.cancelledReason):''}</div>
  </div>`:'';
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
            ${canUpdate?`<button class="mark-done-btn" style="width:auto;padding:8px 14px;font-size:13px" onclick="window.openStageWork('${po.fbKey}','${s.key}')">Go to stage</button>`:''}
            ${isOwner&&isCurrent&&!canUpdate?`<button class="btn-sm" onclick="window.ownerAdvance('${po.fbKey}','${s.key}')">Force advance</button>`:''}
            ${s.key==='cutting'&&isCurrent&&!isDone&&_poCutCanOverride()?`<button class="btn-sm" onclick="window.poCutOverride('${po.fbKey}')">${po.cutOverride&&po.cutOverride.by?'Cut variance approved ✓':'Approve cut variance'}</button>`:''}
          </div>
        </div>
      </div>
    </div><div class="stage-connector"></div>`;
  }).join('');

  // The body below the header: the PO Registry's timeline (js/po-registry.js, RG4) when it is loaded; the old cards if not, or if it throws.
  let _porBody=null;
  if(typeof porDetailBodyHTML==='function'){try{_porBody=porDetailBodyHTML(po);}catch(e){_porBody=null;console.warn('[pos] the PO detail body failed, drawing the old one:',e);}}
  m.innerHTML=`<button class="back-btn" onclick="window.showPage('po-registry')">← Back to registry</button>
  <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><div class="page-title">${/^PO-/.test(String(po.id||''))?'':'PO '}${po.id}</div><div class="page-sub">By ${po.createdBy||'—'} · ${po.createdAt||''}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${typeof window.poPrintButtonHTML==='function'?window.poPrintButtonHTML(po,_isCancelled):`<button class="btn-pdf" onclick="window.generatePOPdf('${po.fbKey}')">⬇ PDF</button>`}
      ${_poCanEdit()?`<button class="btn-outline" style="font-size:13px" onclick="window.openPOEdit('${po.fbKey}')">Edit PO</button>`:''}
      ${_poCanDelete()?`<button class="btn-outline" style="font-size:13px" onclick="window.deletePO('${po.fbKey}','${po.id}')">Delete PO</button>`:''}
      ${_poCanCancel()&&!_isCancelled&&po.currentStage!=='completed'?`<button class="btn-outline" style="font-size:13px" onclick="window.cancelPO('${po.fbKey}','${po.id}')">Cancel PO</button>`:''}
    </div>
  </div>
  ${typeof window.poPrintInfoHTML==='function'?window.poPrintInfoHTML(po):''}
  ${_poJobCopiesHTML(po)}
  ${_reservedBanner}
  ${_cancelledBanner}
  ${typeof window.ptnPoBannerSlot==='function'?window.ptnPoBannerSlot(po):''}
  ${typeof window.phPoInstructionsSlot==='function'?window.phPoInstructionsSlot(po):''}
  ${typeof window.phPoDetailCardSlot==='function'?window.phPoDetailCardSlot(po):''}
  ${typeof window.phPoQcCardSlot==='function'?window.phPoQcCardSlot(po):''}
  ${_porBody!==null?_porBody+'<div style="height:80px"></div>':`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
    <div class="card" style="margin-bottom:0"><div class="card-title">Product</div>
      <div class="info-row"><span class="info-label">Name</span><span style="font-weight:500">${po.name||'—'}</span></div>
      <div class="info-row"><span class="info-label">Code</span><span>${po.code||'—'}</span></div>
      <div class="info-row"><span class="info-label">Pattern</span><span>${(typeof window.ptnPoPatternRow==='function'?window.ptnPoPatternRow(po):'')||po.pattern||'—'}</span></div>
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
      ${['XS','S','M','L','XL','2XL'].map(sz=>`<div style="text-align:center;padding:8px 4px;background:var(--surface-2);border-radius:6px"><div style="font-size:11px;color:var(--muted)">${sz}</div><div style="font-size:19px;font-weight:700">${po.sizes?.[sz]||0}</div>${po.cutQty?.[sz]!=null?`<div style="font-size:11px;color:var(--green)">Cut:${po.cutQty[sz]}</div>`:''}</div>`).join('')}
    </div>
  </div>
  ${po.notes?`<div class="card"><div class="card-title">Notes</div>
    <div style="color:var(--accent-urgent);font-weight:600;font-size:14px;white-space:pre-wrap">${_gpEsc(po.notes)}</div>
  </div>`:''}
  ${po.damageFlagged||po.damageSummary?`<div class="card" style="border:1px solid var(--accent-urgent)"><div class="card-title" style="color:var(--accent-urgent)">⚠ Damage report</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">
      <div style="text-align:center;padding:8px 4px;background:var(--accent-urgent-soft);border-radius:6px"><div style="font-size:11px;color:var(--muted)">Cut</div><div style="font-size:17px;font-weight:700">${po.damageSummary?.cutTotal||0}</div></div>
      <div style="text-align:center;padding:8px 4px;background:var(--accent-urgent-soft);border-radius:6px"><div style="font-size:11px;color:var(--accent-urgent)">Damaged</div><div style="font-size:17px;font-weight:700;color:var(--accent-urgent)">${po.damageSummary?.total||0}</div></div>
      <div style="text-align:center;padding:8px 4px;background:var(--soft);border-radius:6px"><div style="font-size:11px;color:var(--muted)">Usable</div><div style="font-size:17px;font-weight:700;color:var(--text)">${po.damageSummary?.usable||0}</div></div>
      <div style="text-align:center;padding:8px 4px;background:${(po.damagePercent||0)>1.5?'#fee2e2':'#fef9e7'};border-radius:6px"><div style="font-size:11px;color:var(--muted)">Rate</div><div style="font-size:17px;font-weight:700;color:${(po.damagePercent||0)>1.5?'#dc2626':'var(--amber)'}">${(po.damagePercent||0).toFixed(2)}%</div></div>
    </div>
    ${po.damageSummary?.bySize?`<div style="font-size:12px;color:var(--muted)">By size: ${Object.entries(po.damageSummary.bySize).filter(([,v])=>v>0).map(([k,v])=>`${k}: ${v}`).join(' · ')||'None'}</div>`:''}
  </div>`:''}
  ${po.imgFront||po.imgBack?`<div class="card"><div class="card-title">Product images</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${po.imgFront?`<div><div style="font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:500">FRONT</div><img src="${po.imgFront}" style="width:100%;border-radius:8px;max-height:320px;object-fit:cover"></div>`:''}
      ${po.imgBack?`<div><div style="font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:500">BACK</div><img src="${po.imgBack}" style="width:100%;border-radius:8px;max-height:320px;object-fit:cover"></div>`:''}
    </div></div>`:''}
  <div class="card"><div class="card-title">Production timeline</div>
    ${stagesHTML}
    ${po.currentStage==='completed'?`<div class="stage-item"><div class="stage-dot dot-done"></div><div class="stage-content"><div class="stage-label" style="color:var(--green)">Completed ✓</div><div class="stage-meta">All stages done</div></div></div>`:''}
  </div><div style="height:80px"></div>`}`;
  if(typeof window.phPoDetailCardFill==='function')window.phPoDetailCardFill(po);
  if(typeof window.phPoQcCardFill==='function')window.phPoQcCardFill(po);   // QC9: read-only QC reconciliation card (js/ph-mod-afloat.js)
  if(_porBody!==null&&typeof porDetailAfter==='function')porDetailAfter(po);  // RG4: reads this PO's bundles once, then repaints the timeline
}

// PO edit/delete (Sept 2026 grant) — owners, + Mustafa by username. Same
// isMustafa()-style per-person pattern as the other Sept 2026 grants
// (fabric delete/edit, loans, payslips) — deliberately not role-wide, so
// Arfat (also role='manager') does not get it too.
function _poCanEdit(){return !!(session&&(session.role==='owner'||session.u==='mustafa'));}
function _poCanDelete(){return !!(session&&(session.role==='owner'||session.u==='mustafa'));}

// ── The REAL production flow (Oct 2026) ──────────────────────────────────
// shared.js STAGES (so STAGE_KEYS) lists cutting, printing, bundling,
// stitching, washing, qc — a DISPLAY order that predates the flow the floor
// actually runs: cutting → bundling → stitching → printing → washing → qc →
// completed (markCuttingDone → 'bundling', completeBundling → 'stitching',
// renderStageWorkPage's nextStage arguments, completeQC → 'completed').
// Anything that needs "the stage after this one" reads THIS list and never
// STAGE_KEYS — ownerAdvance used to, and force-advancing cutting skipped
// bundling and stitching, stitching skipped printing, and printing went
// BACKWARDS to bundling. shared.js is deliberately left as it is.
const PO_REAL_STAGE_ORDER=['cutting','bundling','stitching','printing','washing','qc'];
function poRealNextStage(stageKey){
  const i=PO_REAL_STAGE_ORDER.indexOf(stageKey);
  if(i<0)return null;
  return i+1<PO_REAL_STAGE_ORDER.length?PO_REAL_STAGE_ORDER[i+1]:'completed';
}
function _poStageLabel(key){
  const s=(typeof STAGES!=='undefined'&&Array.isArray(STAGES))?STAGES.find(x=>x.key===key):null;
  return s&&s.label?s.label:key;
}
// PURE. May the owner force `stageKey` of this PO forward? One decision, used
// by the click (so the confirm only appears for a move that can happen) and
// again on the LIVE document inside the write's transaction.
//   → {ok:false,msg} | {ok:true,from,to}
// Only ever acts on the stage the PO is AT, so it can never move a PO
// backwards or skip a stage; a reserve order, a completed PO or a stage the PO
// has already left are refused. Cutting is refused: its side effects (the
// bundles and the per-size cut that embOnCuttingDone tops the embellishment job
// up with) need quantities that only the cutting screen collects, and a PO
// forced past cutting would read its ORDERED sizes as "cut" everywhere
// (poCutBySize falls back to po.sizes).
function poForceAdvancePlan(po,stageKey){
  if(!po)return{ok:false,msg:'PO not found.'};
  if(PO_REAL_STAGE_ORDER.indexOf(stageKey)<0)return{ok:false,msg:`"${stageKey}" is not a production stage.`};
  if(poStatusOf(po)===PO_STATUS.RESERVED)return{ok:false,msg:`${po.id} is still a reserve order — release it to production first.`};
  if(po.currentStage!==stageKey){
    const at=po.currentStage==='completed'?'already complete':po.currentStage?`at ${_poStageLabel(po.currentStage)}`:'not in production';
    return{ok:false,msg:`${po.id} is ${at}, not at ${_poStageLabel(stageKey)} — force-advance only acts on the stage the PO is at. Reload and check where it is now.`};
  }
  if(stageKey==='cutting')return{ok:false,msg:'Cutting cannot be forced: the bundles and the actual cut per size are created when cutting is recorded on the cutting screen (Uzaib\'s queue). Have the cut entered there — if it lands outside '+poCutPct(poCutGateNow())+' an owner or Mustafa can approve it from this page.'};
  return{ok:true,from:stageKey,to:poRealNextStage(stageKey)};
}
window.ownerAdvance=async function(fbKey,stageKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po)return;
  if(!['owner','manager'].includes(session.role)){showToast('Not authorized.',true);return;}
  const plan=poForceAdvancePlan(po,stageKey);
  if(!plan.ok){showToast(plan.msg,true);return;}
  if(!confirm(`Force-advance "${_poStageLabel(stageKey)}" for PO ${po.id} to ${plan.to==='completed'?'Completed':_poStageLabel(plan.to)}?`))return;
  let committed=false;
  try{
    const poRef=doc(db,'pos',fbKey);
    const at=new Date().toISOString();
    // A transaction, because the screen this click came from can be hours
    // stale: the stage worker may have finished the stage since, and a plain
    // update would drag the PO BACK to the stage after this one. The plan is
    // judged again on the document as it is NOW.
    const out=await runTransaction(db,async tx=>{
      const snap=await tx.get(poRef);
      const live=snap.exists()?snap.data():null;
      const lp=poForceAdvancePlan(live,stageKey);
      if(!lp.ok)return{refused:lp.msg};
      tx.update(poRef,{
        currentStage:lp.to,
        [`stages.${stageKey}.done`]:true,
        [`stages.${stageKey}.doneAt`]:at,
        [`stages.${stageKey}.doneBy`]:session.name+' (override)',
        // Who forced it, as data rather than only as the text above — additive.
        [`stages.${stageKey}.forcedBy`]:session.u,
        [`stages.${stageKey}.forcedAt`]:at,
        [`stages.${stageKey}.forcedFrom`]:lp.from,
        [`stages.${stageKey}.forcedTo`]:lp.to
      });
      return{to:lp.to};
    });
    if(out.refused){
      showToast(out.refused,true);
      try{await loadData();renderDetailPage();}catch(_e){}
      return;
    }
    committed=true;
    await logActivity('Stage override',`PO ${po.id} · ${_poStageLabel(stageKey)} force-advanced → ${out.to==='completed'?'Completed':_poStageLabel(out.to)}`);
    showToast('Advanced ✓');await loadData();renderDetailPage();
  }catch(e){showToast(committed?'Advanced, but the screen could not refresh — reload the page. ('+e.message+')':'Error: '+e.message,true);}
};
window.deletePO=async function(fbKey,poId){
  if(!_poCanDelete()){showToast('Not authorized.',true);return;}
  const po=(typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[]).find(p=>p.fbKey===fbKey)||{id:poId,fbKey};
  // Look BEFORE anything is changed — not even the fabric restock below runs
  // for a PO that is about to be refused.
  const res=await _poLinkedRecords(po);
  if(res.failed.length){
    showToast(`PO ${poId} was NOT deleted: could not read ${res.failed.join(', ')} from the server (offline or refused), so it cannot be shown to have no linked records. Nothing was changed.`,true);
    return;
  }
  if(res.total>0){
    const msg=`PO ${poId} cannot be deleted: it has ${_poLinkSummary(res)}. Deleting it would leave those records pointing at a PO that no longer exists. Nothing was changed.`;
    showToast(msg,true);
    if(_poCanCancel()&&poStatusOf(po)!==_PO_CANCELLED&&confirm(`${msg}\n\nCancel PO ${poId} instead? It stays in the registry marked Cancelled and leaves the pipeline. Nothing is removed.`)){
      return window.cancelPO(fbKey,poId);
    }
    return;
  }
  if(!confirm(`Delete PO ${poId}? Cannot be undone.`))return;
  try{
    // Restock any fabric rolls still reserved for this PO before it's gone.
    let restockNote='';
    if(typeof fabReleaseForPO==='function'){
      try{const n=await fabReleaseForPO(poId);if(n)restockNote=` · ${n} fabric roll(s) restocked`;}
      catch(_re){restockNote=' · fabric restock failed: '+_re.message;}
    }
    await deleteDoc(doc(db,'pos',fbKey));await logActivity('PO deleted',`PO ${poId} deleted`);showToast(`PO ${poId} deleted${restockNote}`);await loadData();window.showPage('po-registry');
  }
  catch(e){showToast('Error: '+e.message,true);}
};
// ── Delete is refused once anything points at the PO; Cancel is the way out ──
// (B14, Oct 2026.) deletePO used to remove only the PO document, so every
// bundle, embellishment job, fabric-issue gate pass, transfer and trim
// request that named it was left behind, and the registry and Observer
// screens kept drawing records for a PO that no longer existed. Nothing in
// the app can put that data back, so the delete now looks first and REFUSES
// when anything is linked. Cancel is the non-destructive route: the PO
// document stays, marked cancelled, and drops out of the pipeline.
const _PO_CANCELLED='cancelled';
// Every place that carries a PO's id. [singular, plural] for the message.
const _PO_LINKS=[
  {key:'issue', words:['fabric issue / gate pass','fabric issues / gate passes'],col:'gatepasses',       field:'poId'},
  {key:'bundle',words:['bundle','bundles'],                                     col:'bundles',          field:'poId'},
  {key:'job',   words:['embellishment job','embellishment jobs'],               col:'printing_jobs',    field:'poNumber'},
  {key:'xfer',  words:['stock transfer','stock transfers'],                     col:'stock_transfers',  field:'poId'},
  {key:'bstock',words:['B-stock item','B-stock items'],                         col:'bstock_items',     field:'poId'},
  {key:'trim',  words:['trim issue request','trim issue requests'],             col:'po_issue_requests',field:'poId'},
  // Production Ops (14 Oct 2026): a cut job is keyed by the PO id and carries it as poId; a draft that was issued as this PO
  // names it in poId (the field js/ph-issue.js writes when it issues the draft).
  {key:'cutjob',words:['Production Ops cut job','Production Ops cut jobs'],       col:'po_cut_jobs',      field:'poId'},
  {key:'draft', words:['Production Ops draft','Production Ops drafts'],           col:'po_drafts',        field:'poId'},
  // QC reconciliation (QC2, 15 Oct 2026): the QC record of a PO (po_qc_recon/{PO-nnn}) and the lots QC received (po_qc_lots),
  // both carrying the PO id as poId. A PO with either cannot be deleted (cancel it instead).
  {key:'qcrec', words:['QC reconciliation','QC reconciliations'],               col:'po_qc_recon',      field:'poId'},
  {key:'qclot', words:['QC lot','QC lots'],                                     col:'po_qc_lots',       field:'poId'}
];
// What the app already holds in memory for each link, as a second witness
// beside the query. Guarded: embellishments.js / store.js may not be loaded.
function _poLinkMemory(key){
  try{
    if(key==='issue'&&typeof allPasses!=='undefined'&&Array.isArray(allPasses))return allPasses;
    if(key==='job'&&typeof allPrintingJobs!=='undefined'&&Array.isArray(allPrintingJobs))return allPrintingJobs;
    if(key==='trim'&&typeof allPoIssueRequests!=='undefined'&&Array.isArray(allPoIssueRequests))return allPoIssueRequests;
  }catch(e){}
  return [];
}
// The two spellings a record may use for this PO: its id and its document key.
function _poLinkValues(po){
  const out=[];[po&&po.id,po&&po.fbKey].forEach(v=>{v=String(v==null?'':v).trim();if(v&&out.indexOf(v)<0)out.push(v);});
  return out;
}
// A free-text 'po-12' on a gate pass is the same PO as 'PO-012'. Compare the
// numbers when both read as PO numbers, else the trimmed text. Erring towards
// "linked" only ever REFUSES a delete, never allows one.
function _poSamePO(a,b){
  const na=_poNumberOf(a),nb=_poNumberOf(b);
  if(na!=null&&nb!=null)return na===nb;
  const sa=String(a==null?'':a).trim().toUpperCase(),sb=String(b==null?'':b).trim().toUpperCase();
  return sa!==''&&sa===sb;
}
// Production already written INTO the PO document itself (a delete takes it
// with the document): a finished stage, the cut, bundle ids, packing receipts,
// stock transfers.
function _poOwnRecords(po){
  if(!po)return 0;
  let n=0;
  Object.keys(po.stages||{}).forEach(k=>{if(po.stages[k]&&po.stages[k].done)n++;});
  const nonEmpty=o=>!!o&&typeof o==='object'&&Object.keys(o).some(k=>Number(o[k])>0);
  if(nonEmpty(po.cutQty)||nonEmpty(po.cutBySize))n++;
  ['bundleIds','packingReceipts','stockTransfers'].forEach(k=>{if(Array.isArray(po[k])&&po[k].length)n+=po[k].length;});
  return n;
}
// Counts of everything linked to a PO. NEVER rejects: a lookup that fails is
// named in `failed`, and the caller treats that as "cannot prove it is safe".
// `counts[key]` is max(rows the server returned, rows already in memory) —
// each is a lower bound of the truth, so the max is too.
async function _poLinkedRecords(po){
  const vals=_poLinkValues(po),counts={},failed=[];
  const jobs=[];
  _PO_LINKS.forEach(l=>vals.forEach(v=>jobs.push({l,v})));
  const settled=await Promise.allSettled(jobs.map(j=>getDocs(query(collection(db,j.l.col),where(j.l.field,'==',j.v)))));
  const server={};
  settled.forEach((r,i)=>{
    const l=jobs[i].l;
    // An answer that came from the offline cache is not an answer: a cache
    // that never held this PO's bundles says "none". Treated as a failed read.
    const cached=r.status==='fulfilled'&&!!r.value&&!!r.value.metadata&&r.value.metadata.fromCache===true;
    if(r.status==='fulfilled'&&!cached){const n=(r.value&&r.value.docs&&r.value.docs.length)||0;server[l.key]=(server[l.key]||0)+n;}
    else if(failed.indexOf(l.col)<0)failed.push(l.col);
  });
  let total=0;
  _PO_LINKS.forEach(l=>{
    const mem=_poLinkMemory(l.key).filter(r=>r&&vals.some(v=>_poSamePO(r[l.field],v))).length;
    counts[l.key]=Math.max(server[l.key]||0,mem);
    total+=counts[l.key];
  });
  const own=_poOwnRecords(po);
  return{counts,total:total+own,own,failed};
}
function _poLinkSummary(res){
  const parts=_PO_LINKS.filter(l=>res.counts[l.key]>0).map(l=>res.counts[l.key]+' '+l.words[res.counts[l.key]===1?0:1]);
  if(res.own>0)parts.push('production already recorded on the PO itself ('+res.own+' item'+(res.own===1?'':'s')+')');
  return parts.join(', ');
}
function _poCanCancel(){return !!(session&&(session.role==='owner'||session.u==='mustafa'));}
// Cancel a PO without removing anything. Only NEW fields are added, and the
// two values it overwrites are kept beside them (cancelledFromStatus /
// cancelledFromStage), so a cancel can always be read back and undone by
// hand. currentStage is cleared because every pipeline count and worker queue
// in the app keys off it; poStatus 'cancelled' keeps it out of the reserved /
// in-production lists. Fabric rolls reserved for the PO are NOT touched here
// (that is an inventory write the cancel does not own) — the toast says so.
// ── Cancel also closes the PO's embellishment jobs (Oct 2026) ─────────────
// WAS: a cancelled PO's printing_jobs stayed open and live on the printing
// floor, the Observer tower and the SLA clocks. NOW: the cancel and the jobs'
// cancel land in ONE transaction, and every write only ADDS fields:
//   cancelled:true, cancelledAt, cancelledBy, cancelledReason,
//   cancelledFromStage (the stage the job was at), cancelledByPO
// Nothing is deleted; currentStage, stageHistory and updatedAt are untouched,
// so a cancel can be read back and undone by hand. js/embellishments.js keeps
// the cancelled ones out of its job lists (loadPrintingData).
// A job already closed (finished work) or already cancelled is left alone.
// A transaction cannot run a query, so the job ids are looked up first and each
// is READ inside the transaction: one that vanished, was closed or was
// cancelled meanwhile is judged on its live state. A job created between that
// lookup and the commit is caught by one sweep right after (_poCancelSweep);
// the gap left is a job created after the sweep (see CLAUDE.md).
// PURE. The fields a job gets, or null when it must not be touched.
function poCancelJobPatch(job,po,cancel){
  if(!job||typeof job!=='object')return null;
  if(job.cancelled===true)return null;
  if(job.currentStage==='closed')return null;
  if(!_poLinkValues(po).some(v=>_poSamePO(job.poNumber,v)))return null;   // never touch a job that is not this PO's
  return{cancelled:true,cancelledAt:cancel.at,cancelledBy:cancel.by,cancelledReason:cancel.reason,cancelledFromStage:job.currentStage||null,cancelledByPO:po.id};
}
// Ids of this PO's embellishment jobs: the server query (every spelling of the
// PO's id) plus what the app already holds in memory. NEVER rejects; an answer
// from the offline cache is not an answer (it counts as failed).
async function _poFindJobIds(po){
  const vals=_poLinkValues(po),ids=[];let failed=false;
  const add=id=>{if(id&&ids.indexOf(id)<0)ids.push(id);};
  const settled=await Promise.allSettled(vals.map(v=>getDocs(query(collection(db,'printing_jobs'),where('poNumber','==',v)))));
  settled.forEach(r=>{
    const cached=r.status==='fulfilled'&&!!r.value&&!!r.value.metadata&&r.value.metadata.fromCache===true;
    if(r.status==='fulfilled'&&!cached)((r.value&&r.value.docs)||[]).forEach(d=>add(d.id));
    else failed=true;
  });
  try{
    const mem=(typeof allPrintingJobs!=='undefined'&&Array.isArray(allPrintingJobs))?allPrintingJobs:[];
    mem.forEach(j=>{if(j&&vals.some(v=>_poSamePO(j.poNumber,v)))add(j._id);});
  }catch(e){}
  return{ids,failed};
}
// After the commit: look once more and cancel any job the first lookup missed.
// Best effort — a failure is reported, never allowed to undo the cancel.
async function _poCancelSweep(po,cancel,done){
  const found=await _poFindJobIds(po);
  const swept=[];let failed=found.failed;
  for(const id of found.ids){
    if(done.indexOf(id)>-1)continue;
    try{
      const ref=doc(db,'printing_jobs',id),snap=await getDoc(ref);
      const patch=poCancelJobPatch(snap&&snap.exists()?snap.data():null,po,cancel);
      if(!patch)continue;
      await updateDoc(ref,patch);swept.push({id,patch});
    }catch(e){failed=true;}
  }
  return{swept,failed};
}
window.cancelPO=async function(fbKey,poId){
  if(!_poCanCancel()){showToast('Not authorized.',true);return;}
  const po=(typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[]).find(p=>p.fbKey===fbKey);
  if(!po){showToast('PO not found.',true);return;}
  const id=po.id||poId;
  const st=poStatusOf(po);
  if(st===_PO_CANCELLED){showToast(`${id} is already cancelled.`,true);return;}
  if(st===PO_STATUS.COMPLETE||po.currentStage==='completed'){showToast(`${id} is completed and cannot be cancelled.`,true);return;}
  const reason=String(prompt(`Why is ${id} being cancelled? (Required — it is kept on the PO.)`,'')||'').trim();
  if(!reason){showToast(`${id} was NOT cancelled: a reason is required. Nothing was changed.`,true);return;}
  try{
    const cancel={at:new Date().toISOString(),by:session.name,reason};
    const found=await _poFindJobIds(po);
    const poRef=doc(db,'pos',fbKey);
    const out=await runTransaction(db,async tx=>{
      // Every read first (a transaction refuses a read after a write).
      const ps=await tx.get(poRef);
      const lv=ps.exists()?ps.data():null;
      const jobSnaps=[];
      for(const jid of found.ids){const ref=doc(db,'printing_jobs',jid);jobSnaps.push({id:jid,ref,snap:await tx.get(ref)});}
      if(!lv)return{blocked:'gone'};
      // Judged on the LIVE document: a second owner who got there first must
      // not overwrite the first cancel's cancelledFrom* record.
      const lst=poStatusOf(lv);
      if(lst===_PO_CANCELLED)return{blocked:'already'};
      if(lst===PO_STATUS.COMPLETE||lv.currentStage==='completed')return{blocked:'complete'};
      const patch={
        poStatus:_PO_CANCELLED,currentStage:null,
        cancelledAt:cancel.at,cancelledBy:cancel.by,cancelledReason:cancel.reason,
        cancelledFromStatus:lv.poStatus||lst,cancelledFromStage:lv.currentStage||null
      };
      const jobs=[];
      for(const j of jobSnaps){
        const jd=j.snap&&j.snap.exists()?j.snap.data():null;
        const jp=poCancelJobPatch(jd,po,cancel);
        if(jp)jobs.push({id:j.id,ref:j.ref,patch:jp});
      }
      tx.update(poRef,patch);
      jobs.forEach(j=>tx.update(j.ref,j.patch));
      return{jobs:jobs.map(j=>({id:j.id,patch:j.patch}))};
    });
    if(out.blocked){
      showToast(out.blocked==='gone'?'PO not found.':out.blocked==='already'?`${id} is already cancelled.`:`${id} is completed and cannot be cancelled.`,true);
      await loadData();
      return;
    }
    let jobsDone=out.jobs.slice();
    const sweep=await _poCancelSweep(po,cancel,jobsDone.map(j=>j.id)).catch(()=>({swept:[],failed:true}));
    jobsDone=jobsDone.concat(sweep.swept);
    if(typeof embMarkJobsCancelled==='function'&&jobsDone.length){try{embMarkJobsCancelled(jobsDone);}catch(e){}}
    await logActivity('PO cancelled',`${id} cancelled by ${session.name} — ${reason}${jobsDone.length?` · ${jobsDone.length} embellishment job${jobsDone.length===1?'':'s'} cancelled with it`:''}`);
    const held=_poReservedFabric(id);
    const unchecked=found.failed&&sweep.failed;
    showToast(`${id} cancelled ✓ — it stays in the registry.${jobsDone.length?` ${jobsDone.length} embellishment job${jobsDone.length===1?'':'s'} cancelled with it.`:''}${unchecked?' Its embellishment jobs could NOT be checked — look for open jobs on this PO in Embellishment Jobs.':''}${held.rolls?` ${held.rolls} fabric roll(s) are still reserved for it — release them in Fabric Inventory.`:''}`,unchecked);
    await loadData();
    if(currentPage==='po-detail')renderDetailPage();else if(currentPage==='po-registry')renderPage('po-registry');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── PO Create ──
// ── Job copies (Oct 2026) — which of the Embroidery / Printing / Washing job
// sheets this PO will have printed. Stored as po.jobCopies, ALWAYS all three
// keys as real booleans; a PO with no field (older POs) reads as all false.
const _PO_JOBCOPY_KEYS=['embroidery','printing','washing'];
const _PO_JOBCOPY_LABELS={embroidery:'Embroidery',printing:'Printing',washing:'Washing'};
function _poJobCopiesOf(po){
  const j=(po&&po.jobCopies&&typeof po.jobCopies==='object')?po.jobCopies:{};
  const out={};_PO_JOBCOPY_KEYS.forEach(k=>{out[k]=j[k]===true;});return out;
}
function _poJobCopiesRead(){
  const out={};_PO_JOBCOPY_KEYS.forEach(k=>{out[k]=!!(document.getElementById('po-jc-'+k)||{}).checked;});return out;
}
function _poJobCopiesCardHTML(po){
  const cur=_poJobCopiesOf(po);
  return`<div class="card" id="po-jobcopies-card"><div class="card-title">Job copies to print</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:8px">Tick the job sheets this PO needs. They print separately from the PO (outside its 2-page limit). Leave all unticked for none.</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
    ${_PO_JOBCOPY_KEYS.map(k=>`<label for="po-jc-${k}" style="display:flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;color:var(--text);cursor:pointer"><input type="checkbox" id="po-jc-${k}" ${cur[k]?'checked ':''}style="width:18px;height:18px;accent-color:var(--dark);cursor:pointer">${_PO_JOBCOPY_LABELS[k]}</label>`).join('')}
    </div></div>`;
}
function renderPOCreate(){
  if(!session.canPO)return'<div class="empty">Not authorized to create POs.</div>';
  return`<div class="page-head"><div class="page-title">New Production Order</div><div class="page-sub">Fields marked * required</div></div>
  <div class="card"><div class="card-title">Product details</div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1;position:relative">
        <label>Product (search by name or code) *</label>
        <input id="po-search" placeholder="Type to search e.g. GH001 or Black Hoodie…" autocomplete="off" oninput="window.filterProducts(this.value)" onfocus="window.filterProducts(this.value)">
        <div id="po-dropdown" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:300;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.13);max-height:240px;overflow-y:auto;margin-top:3px"></div>
        <input type="hidden" id="po-name">
        <input type="hidden" id="po-code">
      </div>
      <div class="field"><label>Pattern</label><input id="po-pattern" placeholder="Pattern number"></div>
      <div class="field"><label>Total qty (pcs) *</label><input id="po-qty" type="number" min="0" placeholder="0"></div>
    </div>
  </div>
  <div class="card" id="emb-recipe-card">
    <div class="card-title">Embellishment Recipe / پرنٹنگ ریسیپی</div>
    <div id="emb-recipe-status" style="font-size:13px;color:var(--muted)">Select a product above to auto-detect its embellishment recipe.</div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="emb-not-required" onchange="window._toggleEmbRequired(this.checked)" style="width:15px;height:15px;accent-color:var(--dark);cursor:pointer">
      <label for="emb-not-required" style="font-size:13px;color:var(--muted);cursor:pointer">No embellishment required for this PO</label>
    </div>
  </div>
  ${_poJobCopiesCardHTML(null)}
  <div class="card"><div class="card-title">Size breakdown *</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
      ${['XS','S','M','L','XL','2XL'].map(sz=>`<div class="field"><label>${sz}</label><input id="sz-${sz}" type="number" min="0" value="0" onfocus="if(this.value==='0')this.value=''" onblur="if(this.value==='')this.value='0'" oninput="window.updateRatio()"></div>`).join('')}
    </div>
    <div style="margin-top:8px;font-size:13px;color:var(--muted)">Ratio: <span id="ratio-disp" style="font-weight:600;color:var(--text)">—</span></div>
  </div>
  ${typeof fabPoFabricCard==='function'?fabPoFabricCard():'<div class="card"><div class="card-title">Fabric & supply *</div><div class="form-grid"><div class="field"><label>Fabric type *</label><input id="po-fabric" placeholder="e.g. Terry, Fleece"></div><div class="field"><label>Fabric code</label><input id="po-fabriccode" placeholder="e.g. BLKTRY220"></div><div class="field"><label>Supply store</label><input id="po-store" placeholder="Store/supplier"></div><div class="field"><label>Total rolls</label><input id="po-rolls" placeholder="e.g. 12"></div></div></div>'}
  <div class="card"><div class="card-title">Product images</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:600">FRONT VIEW *</div>
        <div class="img-upload-box" id="img-front-box" onclick="document.getElementById('inp-front').click()">
          <img id="img-front-prev" style="display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:9px">
          <div id="img-front-ph" style="text-align:center"><div style="font-size:25px;color:var(--muted);margin-bottom:4px">+</div><div>Tap to upload front</div></div>
        </div>
        <input type="file" id="inp-front" accept="image/*" class="hidden" onchange="window.handleImg(this,'front')">
        <button onclick="window.clearImg('front')" style="font-size:12px;color:var(--muted);background:none;border:none;cursor:pointer;margin-top:4px;font-family:inherit">Remove</button>
      </div>
      <div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:600">BACK VIEW</div>
        <div class="img-upload-box" id="img-back-box" onclick="document.getElementById('inp-back').click()">
          <img id="img-back-prev" style="display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:9px">
          <div id="img-back-ph" style="text-align:center"><div style="font-size:25px;color:var(--muted);margin-bottom:4px">+</div><div>Tap to upload back</div></div>
        </div>
        <input type="file" id="inp-back" accept="image/*" class="hidden" onchange="window.handleImg(this,'back')">
        <button onclick="window.clearImg('back')" style="font-size:12px;color:var(--muted);background:none;border:none;cursor:pointer;margin-top:4px;font-family:inherit">Remove</button>
      </div>
    </div>
  </div>
  <div class="card"><div class="card-title">Notes</div>
    <div class="field">
      <label>Notes for this PO (optional) — printed in <span style="color:var(--accent-urgent);font-weight:700">red</span> on the PO copy</label>
      <textarea id="po-notes" rows="3" placeholder="e.g. special instructions, buyer remarks…" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface-2);color:var(--accent-urgent);font-family:inherit;outline:none;resize:vertical"></textarea>
    </div>
  </div>
  <button class="btn-primary" id="po-submit-btn" onclick="window.submitPO()">Create Production Order</button>
  <div style="height:80px"></div>`;
}

window._checkEmbRecipe=async function(code,name){
  const statusDiv=document.getElementById('emb-recipe-status');
  if(!statusDiv)return;
  const notReq=document.getElementById('emb-not-required');
  if(notReq?.checked)return;
  _poEmbellishment=null;
  statusDiv.innerHTML='<div style="font-size:13px;color:var(--muted)">Checking recipe…</div>';
  if(!printingDataLoaded){try{await loadPrintingData();}catch(e){statusDiv.innerHTML='<div style="font-size:13px;color:var(--red)">Could not load recipes.</div>';return;}}
  let r=allRecipes.find(x=>(x.articleCode||'').toLowerCase()===(code||'').toLowerCase());
  if(!r&&name)r=allRecipes.find(x=>(x.articleName||'').toLowerCase()===(name||'').toLowerCase());
  if(!r){
    const rm=_lookupRate(code);
    _poEmbellishment={required:true,recipeId:null,articleCode:code,articleName:name,recipeStatus:'missing',recipeRequiredBefore:'pp_approval',rateMasterPreview:rm?{complexityTier:rm.complexityTier,ratePerPiece:rm.ratePerPiece}:null};
    if(rm){
      const tierLabel=TIER_INFO[rm.complexityTier]?.label||('Tier '+rm.complexityTier);
      statusDiv.innerHTML=`<div style="background:var(--surface-2);border-radius:8px;padding:10px 12px;border:1px solid var(--border)"><div style="font-size:13px;font-weight:700;color:var(--text)">Recipe Missing — Rate List Preview</div><div style="font-size:12px;color:var(--muted);margin-top:3px">No recipe yet. Rate List suggests: <strong>${tierLabel}</strong> · Rs. ${rm.ratePerPiece}/pc. Recipe must be created and locked before PP approval.</div></div>`;
    }else{
      statusDiv.innerHTML=`<div style="background:var(--surface-2);border-radius:8px;padding:10px 12px;border:1px solid var(--border)"><div style="font-size:13px;font-weight:700;color:var(--text)">Recipe Missing</div><div style="font-size:12px;color:var(--muted);margin-top:3px">PO can be created. Recipe must be locked before PP approval — Ammar will be notified.</div></div>`;
    }
  }else if(r.status!=='locked'){
    _poEmbellishment={required:true,recipeId:r._id,articleCode:code,articleName:r.articleName||name,recipeStatus:'draft',recipeRequiredBefore:'pp_approval'};
    const pt=(r.printing?.processTypes||[]).map(k=>PROCESS_TYPES[k]?.label||k).join(', ')||'—';
    statusDiv.innerHTML=`<div style="background:var(--surface-2);border-radius:8px;padding:10px 12px;border:1px solid var(--border)"><div style="font-size:13px;font-weight:700;color:var(--text)">Recipe Draft — Not Locked</div><div style="font-size:12px;color:var(--muted);margin-top:3px">Recipe exists (${pt} · Tier ${r.printing?.complexityTier||'?'}) but must be locked by Ammar before PP approval.</div></div>`;
  }else{
    _poEmbellishment={required:true,recipeId:r._id,articleCode:code,articleName:r.articleName||name,processType:(r.printing?.processTypes||[])[0]||'',complexityTier:r.printing?.complexityTier||1,ratePerPiece:r.printing?.ratePerPiece||0,recipeStatus:'locked',recipeRequiredBefore:'pp_approval'};
    const pt=(r.printing?.processTypes||[]).map(k=>PROCESS_TYPES[k]?.label||k).join(', ')||'—';
    const places=(r.printing?.placements||[]).map(pl=>pl.name).filter(Boolean).join(', ')||'—';
    statusDiv.innerHTML=`<div style="background:var(--soft);border-radius:8px;padding:10px 12px;border:1px solid var(--border)"><div style="font-size:13px;font-weight:700;color:var(--text)">Recipe Found — Locked</div><div style="font-size:12px;color:var(--muted);margin-top:4px">${pt} · Tier ${r.printing?.complexityTier||'?'} · Rs.${r.printing?.ratePerPiece||0}/pc</div><div style="font-size:12px;color:var(--muted)">Placements: ${places}</div></div>`;
  }
};
window._toggleEmbRequired=function(notRequired){
  const statusDiv=document.getElementById('emb-recipe-status');
  if(notRequired){
    _poEmbellishment={required:false};
    if(statusDiv)statusDiv.innerHTML='<div style="font-size:13px;color:var(--muted)">No embellishment required for this PO.</div>';
  }else{
    const code=document.getElementById('po-code')?.value;
    const name=document.getElementById('po-name')?.value;
    if(code)window._checkEmbRecipe(code,name);
    else{_poEmbellishment=null;if(statusDiv)statusDiv.innerHTML='<div style="font-size:13px;color:var(--muted)">Select a product above to auto-detect its embellishment recipe.</div>';}
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
  div.innerHTML=`<select style="padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--surface-2);outline:none;font-family:inherit">
    ${parts.map(p=>`<option value="${p}" ${p===name?'selected':''}>${p}</option>`).join('')}
  </select>
  <input placeholder="Notes (optional)" value="${notes}" style="padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--surface-2);outline:none;font-family:inherit">
  <div style="display:flex;gap:4px">
    <button type="button" onclick="window.setBPDest('${id}','Printing')" id="${id}-print" style="padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid;${dest==='Printing'?'background:var(--soft);color:var(--text);border-color:var(--line)':'background:var(--surface);color:var(--muted);border-color:var(--muted)'}">→ Printing</button>
    <button type="button" onclick="window.setBPDest('${id}','Warehouse')" id="${id}-wh" style="padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid;${dest==='Warehouse'?'background:var(--soft);color:var(--text);border-color:var(--line)':'background:var(--surface);color:var(--muted);border-color:var(--muted)'}">→ Warehouse</button>
  </div>
  <button type="button" onclick="document.getElementById('${id}').remove()" style="background:none;border:none;color:var(--muted);font-size:19px;cursor:pointer;padding:2px 6px">×</button>`;
  wrap.appendChild(div);
};
window.setBPDest=function(rowId,dest){
  const row=document.getElementById(rowId);if(!row)return;
  row.dataset.dest=dest;
  const pBtn=document.getElementById(rowId+'-print'),wBtn=document.getElementById(rowId+'-wh');
  if(pBtn){pBtn.style.cssText=pBtn.style.cssText.replace(/background:[^;]+;color:[^;]+;border-color:[^;]+/,dest==='Printing'?'background:var(--soft);color:#111;border-color:#111':'background:#fff;color:var(--muted);border-color:var(--muted)');}
  if(wBtn){wBtn.style.cssText=wBtn.style.cssText.replace(/background:[^;]+;color:[^;]+;border-color:[^;]+/,dest==='Warehouse'?'background:var(--soft);color:#111;border-color:#111':'background:#fff;color:var(--muted);border-color:var(--muted)');}
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
// PKT calendar day (UTC+5, no DST) of a timestamp, by ms arithmetic so the
// browser's own timezone never shifts it. toISOString().slice(0,10) is the UTC
// day, which in Pakistan is the PREVIOUS day between midnight and 05:00 — a PO
// made at 02:00 PKT used to carry yesterday's createdAt.
function _poPktDay(ms){
  const d=new Date((Number.isFinite(ms)?ms:Date.now())+5*3600000),p=n=>String(n).padStart(2,'0');
  return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate());
}
// The number inside a PO id ('PO-012' -> 12); null for anything that is not one.
function _poNumberOf(id){const m=/^PO-0*(\d+)$/i.exec(String(id==null?'':id).trim());return m?parseInt(m[1],10):null;}
function _poIdFor(n){return 'PO-'+String(n).padStart(3,'0');}
// Highest PO number among the POs already loaded (by id and by document key,
// retired or not). The mint is floored here so a counter that was reset can
// never hand out a number a loaded PO already holds.
function _poNumberFloor(){
  let max=0;
  (typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[]).forEach(p=>{
    [p&&p.id,p&&p.fbKey].forEach(v=>{const n=_poNumberOf(v);if(n&&n>max)max=n;});
  });
  return max;
}
// The floor to mint above. With the PO list loaded it is the highest number in
// it. With NO list loaded (a failed or never-run loadData) a floor of 0 plus a
// reset counter would aim at an existing PO and be refused on every press
// without ever advancing — so read the PO ids from the server once instead,
// and if that cannot be trusted either, refuse and say to reload first.
async function _poFloorNow(){
  const loaded=typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[];
  if(loaded.length)return _poNumberFloor();
  let snap=null;
  try{snap=await getDocs(collection(db,'pos'));}catch(e){snap=null;}
  if(!snap||(snap.metadata&&snap.metadata.fromCache===true)){
    throw new Error('The PO list did not load, so the next PO number cannot be checked. Reload the page first. Nothing was created.');
  }
  let max=0;
  (snap.docs||[]).forEach(d=>{[d.id,(d.data()||{}).id].forEach(v=>{const n=_poNumberOf(v);if(n&&n>max)max=n;});});
  return max;
}
window.submitPO=async function(){
  if(!session.canPO){showToast('Not authorized.',true);return;}
  const name=document.getElementById('po-name')?.value.trim(),code=document.getElementById('po-code')?.value.trim(),qty=parseInt(document.getElementById('po-qty')?.value)||0,fabric=document.getElementById('po-fabric')?.value.trim();
  if(!name||!code){showToast('Select a product from the search dropdown.',true);document.getElementById('po-search')?.focus();return;}
  if(!qty){showToast('Quantity required.',true);return;}
  if(!fabric){showToast('Fabric type required.',true);return;}
  if(!poImages.front){showToast('Front image required.',true);return;}
  const btn=document.getElementById('po-submit-btn');if(btn){btn.disabled=true;btn.textContent='Uploading image…';}
  let _createdId='';
  try{
    const imgFrontUrl=await uploadToCloudinary(poImages.front);
    const imgBackUrl=poImages.back?await uploadToCloudinary(poImages.back):'';
    if(btn)btn.textContent='Creating…';
    const sizes={};['XS','S','M','L','XL','2XL'].forEach(sz=>sizes[sz]=parseInt(document.getElementById('sz-'+sz)?.value)||0);
    const stages={};STAGE_KEYS.forEach(k=>stages[k]={done:false,doneAt:null,doneBy:null,dueDate:document.getElementById('due-'+k)?.value||'',notes:''});
    const bundlingParts=window.getBundleParts();
    const embellishment=_poEmbellishment||{required:false};
    // Pattern Hub (M6): stamp the block this article is cut from, and where
    // it hangs, onto the PO. Guarded — no Pattern Hub, no change; the
    // free-text `pattern` box below is never touched. See js/patterns.js.
    const _ptnFields=(typeof window.ptnPoFieldsFor==='function'?await window.ptnPoFieldsFor(code).catch(()=>({})):{});
    const payload={ts:Date.now(),name,code,pattern:document.getElementById('po-pattern')?.value.trim()||'',qty,sizes,ratio:document.getElementById('ratio-disp')?.textContent||'',fabric,fabricCode:document.getElementById('po-fabriccode')?.value.trim()||'',store:document.getElementById('po-store')?.value.trim()||'',totalRoll:document.getElementById('po-rolls')?.value.trim()||'',fabrics:[],imgFront:imgFrontUrl,imgBack:imgBackUrl,poStatus:PO_STATUS.IN_PRODUCTION,currentStage:'cutting',stages,bundlingParts,embellishment,jobCopies:_poJobCopiesRead(),notes:document.getElementById('po-notes')?.value.trim()||'',createdBy:session.name,createdAt:_poPktDay(Date.now()),releasedAt:Date.now()};   // releasedAt (ms): a new PO is born released, so lead time counts from now (existing POs are never rewritten)
    Object.assign(payload,_ptnFields);
    // B12/B13: the number is minted INSIDE the transaction that writes the PO.
    // It used to come from getNextId('pos') — its own transaction, committed
    // before the PO was written — so a refused or offline write spent a number
    // (PO-007, then PO-009), and a counter that had been reset restarted at 1
    // and setDoc silently OVERWROTE PO-001. Now the counter read, the
    // "does this id already exist?" check and both writes are one transaction:
    // a write that does not land never moves the counter, an existing PO is
    // never replaced, and the number is floored at the highest PO already
    // loaded. See createWithNextId in js/shared.js.
    const made=await createWithNextId({field:'pos',collection:'pos',floor:await _poFloorNow(),idFor:_poIdFor,build:(n,id)=>Object.assign({},payload,{id})});
    const poId=made.id;_createdId=poId;
    await logActivity('PO created',`${poId} — ${name} (${qty} pcs)`);
    // Reserve removal (Oct 2026): a new PO starts at cutting, so no fabric roll is reserved for it (fabPoReserveCommit is no longer called);
    // the rolls stay in stock until the fabric issue takes them. Only the picker's selection state is cleared.
    if(typeof fabPoReserveReset==='function'){try{fabPoReserveReset();}catch(_re){}}
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
  }catch(e){
    // A transaction cannot use the offline cache, so with no signal it fails
    // outright. Say so plainly; the form (and the uploaded images) stay as they
    // are and nothing was created.
    const offline=!_createdId&&((typeof navigator!=='undefined'&&navigator.onLine===false)||/unavailable|offline|network/i.test(String(e&&e.code||'')+' '+String(e&&e.message||'')));
    showToast(offline?'Needs a connection; nothing was created. Check your signal and press Create again — your form is kept.':'Error: '+e.message,true);
    if(btn){btn.disabled=false;btn.textContent='Create Production Order';}
  }
};

// ── PO Edit (Sept 2026) — a correction tool for clerical fields on an
// already-created PO. Deliberately scoped: product name/code (tied to
// embellishment recipe lookups), images and the stage timeline are NOT
// editable here — this is not a re-run of PO creation. Fabric roll
// reservation is untouched too; Fabric Inventory is where rolls actually
// move. Gated by _poCanEdit() (owners + Mustafa by username).
window.openPOEdit=function(fbKey){
  if(!_poCanEdit()){showToast('Not authorized.',true);return;}
  editingPO=fbKey;currentPage='po-edit';
  document.querySelectorAll('.nav-item,.mob-nav-item').forEach(n=>n.classList.remove('on'));
  renderPage('po-edit');
};
function renderPOEditPage(){
  const po=allPOs.find(p=>p.fbKey===editingPO);
  if(!po){window.showPage('po-registry');return'';}
  if(!_poCanEdit())return'<div class="empty">Not authorized to edit POs.</div>';
  return`<button class="back-btn" onclick="window.openPODetail('${po.fbKey}')">← Back to PO</button>
  <div class="page-head"><div class="page-title">Edit PO ${po.id}</div><div class="page-sub">${_gpEsc(po.name||'—')} · ${_gpEsc(po.code||'—')} — name/code, images and the stage timeline are not editable here</div></div>
  <div class="card"><div class="card-title">Product details</div>
    <div class="form-grid">
      <div class="field"><label>Pattern</label><input id="po-pattern" value="${_gpEsc(po.pattern||'')}" placeholder="Pattern number"></div>
      <div class="field"><label>Total qty (pcs) *</label><input id="po-qty" type="number" min="0" value="${po.qty||0}"></div>
    </div>
  </div>
  <div class="card"><div class="card-title">Size breakdown *</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
      ${['XS','S','M','L','XL','2XL'].map(sz=>`<div class="field"><label>${sz}</label><input id="sz-${sz}" type="number" min="0" value="${po.sizes?.[sz]||0}" onfocus="if(this.value==='0')this.value=''" onblur="if(this.value==='')this.value='0'" oninput="window.updateRatio()"></div>`).join('')}
    </div>
    <div style="margin-top:8px;font-size:13px;color:var(--muted)">Ratio: <span id="ratio-disp" style="font-weight:600;color:var(--text)">${po.ratio||'—'}</span></div>
  </div>
  <div class="card"><div class="card-title">Fabric & supply *</div>
    <div class="form-grid">
      <div class="field"><label>Fabric type *</label><input id="po-fabric" value="${_gpEsc(po.fabric||'')}" placeholder="e.g. Terry, Fleece"></div>
      <div class="field"><label>Fabric code</label><input id="po-fabriccode" value="${_gpEsc(po.fabricCode||'')}" placeholder="e.g. BLKTRY220"></div>
      <div class="field"><label>Supply store</label><input id="po-store" value="${_gpEsc(po.store||'')}" placeholder="Store/supplier"></div>
      <div class="field"><label>Total rolls</label><input id="po-rolls" value="${_gpEsc(po.totalRoll||'')}" placeholder="e.g. 12"></div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:6px">Corrects the record only — does not release or re-reserve fabric rolls. Use Fabric Inventory for that.</div>
  </div>
  ${_poJobCopiesCardHTML(po)}
  <div class="card"><div class="card-title">Notes</div>
    <div class="field">
      <label>Notes for this PO (optional) — printed in <span style="color:var(--accent-urgent);font-weight:700">red</span> on the PO copy</label>
      <textarea id="po-notes" rows="3" placeholder="e.g. special instructions, buyer remarks…" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface-2);color:var(--accent-urgent);font-family:inherit;outline:none;resize:vertical">${_gpEsc(po.notes||'')}</textarea>
    </div>
  </div>
  <button class="btn-primary" id="po-edit-save-btn" onclick="window.savePOEdit('${po.fbKey}')">Save Changes</button>
  <button class="btn-outline" style="margin-top:8px" onclick="window.openPODetail('${po.fbKey}')">Cancel</button>
  <div style="height:80px"></div>`;
}
window.savePOEdit=async function(fbKey){
  if(!_poCanEdit()){showToast('Not authorized.',true);return;}
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po){showToast('PO not found.',true);return;}
  const qty=parseInt(document.getElementById('po-qty')?.value)||0;
  const fabric=document.getElementById('po-fabric')?.value.trim();
  if(!qty){showToast('Quantity required.',true);return;}
  if(!fabric){showToast('Fabric type required.',true);return;}
  const sizes={};['XS','S','M','L','XL','2XL'].forEach(sz=>sizes[sz]=parseInt(document.getElementById('sz-'+sz)?.value)||0);
  const updates={
    pattern:document.getElementById('po-pattern')?.value.trim()||'',
    qty,sizes,ratio:document.getElementById('ratio-disp')?.textContent||'',
    fabric,fabricCode:document.getElementById('po-fabriccode')?.value.trim()||'',
    store:document.getElementById('po-store')?.value.trim()||'',
    totalRoll:document.getElementById('po-rolls')?.value.trim()||'',
    notes:document.getElementById('po-notes')?.value.trim()||'',
    jobCopies:_poJobCopiesRead(),
    editedBy:session.name,editedAt:new Date().toISOString()
  };
  // Pattern Hub (M6): re-stamp on edit — the article code can change.
  if(typeof window.ptnPoFieldsFor==='function'){
    try{Object.assign(updates,await window.ptnPoFieldsFor(document.getElementById('po-code')?.value||po.code));}catch(e){}
  }
  const btn=document.getElementById('po-edit-save-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'pos',fbKey),updates);
    await logActivity('PO edited',`${po.id} — fields updated by ${session.name}`);
    showToast(`${po.id} updated ✓`);
    await loadData();
    window.openPODetail(fbKey);
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent='Save Changes';}}
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
  const gate=poCutGateFor(po),{min,max}=poCutRange(target,gate);
  const rangeOk=actualTotal>=min&&actualTotal<=max;
  return`<button class="back-btn" onclick="window.showPage('my-work')">← Back to My Work</button>
  ${typeof window.ptnPoBannerSlot==='function'?window.ptnPoBannerSlot(po):''}
  <div class="page-head"><div class="page-title">PO ${po.id} — Cutting</div><div class="page-sub">${po.name||'—'}</div></div>
  <div class="card"><div class="card-title">Actual cut quantities</div>
    <table class="cut-table"><thead><tr><th>Size</th><th>Target</th><th>Actual Cut</th><th>Variance</th></tr></thead>
    <tbody id="cut-tbody">
      ${szs.map(sz=>{
        const tgt=po.sizes?.[sz]||0,act=parseInt(cutState.actualQty[sz])||0,diff=act-tgt;
        const cls=diff===0?'var-ok':Math.abs(diff)<=Math.ceil(tgt*0.1)?'var-warn':'var-bad';
        return`<tr><td style="font-weight:600">${sz}</td><td>${tgt}</td><td><input type="number" min="0" value="${act}" style="width:80px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px;outline:none" onfocus="if(this.value==='0')this.value=''" onblur="if(this.value==='')this.value='0'" onchange="window.setCutQty('${sz}',this.value)"></td><td id="var-${sz}" class="${cls}">${act>0?diff>=0?'+'+diff:diff:'—'}</td></tr>`;
      }).join('')}
    </tbody></table>
    <div id="cut-total-row" style="margin-top:10px;font-size:14px">
      Total: <strong>${actualTotal}</strong> actual / <strong>${target}</strong> target &nbsp;
      <span style="font-size:12px;color:var(--muted)">${poCutRangeText(min,max,gate)}</span>
      <span style="margin-left:8px;font-weight:600;color:${rangeOk?'var(--green)':'#dc2626'}">${rangeOk?'✓ In range':'✗ Out of range'}</span>
      ${_poCutOverrideNote(po)}
    </div>
  </div>
  <div class="card"><div class="card-title">Fabric used</div>
    <div class="field" style="margin-bottom:10px">
      <label>Consume from fabric stock <span style="font-weight:400;color:var(--muted)">(optional — picks rolls to deduct from inventory)</span></label>
      <select id="cut-fab-stock" onchange="window.onCutFabStockPick()" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface-2);color:var(--text);font-family:inherit;outline:none;width:100%">
        <option value="">— don't deduct from fabric inventory —</option>
        ${allFabricInventory.filter(s=>(s.totalWeight||0)>0).map(s=>`<option value="${s._id}">${_gpEsc(s.fabType||'')} · ${s.gsm||0}gsm · ${_gpEsc(s.color||'')} — ${s.totalWeight} ${s.unit||'kg'} · ${s.rollsCount||0} rolls</option>`).join('')}
      </select>
    </div>
    <div id="cut-fab-rolls-pick" style="margin-bottom:10px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Total weight (kg) *</label><input id="cut-weight" type="number" min="0" step="0.1" placeholder="e.g. 100" style="width:100%" oninput="window.calcCutAvg()"></div>
      <div class="field"><label>Total rolls</label><input id="cut-rolls" type="number" min="0" placeholder="e.g. 12" style="width:100%"></div>
    </div>
    <div id="cut-avg-display" style="margin-top:6px;font-size:14px;color:var(--muted)">Enter weight to auto-calculate avg per unit</div>
  </div>
  <div class="card"><div class="card-title">Bundle entry</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <select id="bundle-size-sel" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface);outline:none">${szs.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
      <input type="number" id="bundle-units-inp" min="1" placeholder="Units" style="width:100px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none">
      <button onclick="window.addCutBundle()" class="btn-sm" style="padding:9px 16px">+ Add Bundle</button>
    </div>
    <div id="cut-bundle-list">${renderCutBundleList()}</div>
    <div id="cut-bundle-summary" style="margin-top:10px;font-size:13px">${renderCutBundleSummary(po)}</div>
  </div>
  <button class="mark-done-btn" id="cut-done-btn" onclick="window.markCuttingDone('${po.fbKey}')" ${cutValidationOk(po)?'':'disabled'}>Mark Cutting Done ✓</button>
  <div style="height:80px"></div>`;
}

function renderCutBundleList(){
  if(!cutState.pendingBundles.length)return'<div style="color:var(--muted);font-size:13px;padding:8px 0">No bundles added yet.</div>';
  return cutState.pendingBundles.map((b,i)=>`<div class="bundle-item">
    <span class="bundle-num">B-${String(i+1).padStart(4,'0')}*</span>
    <span class="bundle-size-tag">${b.size}</span>
    <span class="bundle-units">${b.units} pcs</span>
    <button onclick="window.removeCutBundle(${b.tempId})" style="background:none;border:none;color:var(--muted);font-size:19px;cursor:pointer;padding:0 4px">×</button>
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

// ── Cutting tolerance + owner override (Oct 2026) ─────────────────────────
// How far the ACTUAL cut may sit from the ORDERED quantity, as a share of it.
// 70–130% is the everyday gate (owner decision, Oct 2026; it was 80–120% typed
// inline in four places). Beyond it a cut needs an OWNER OVERRIDE
// (poCutOverride below): any quantity, with a reason, no outer limit — the
// override is recorded on the PO with the ordered quantity, the actual total
// and the percentage. One edit here moves every place that reads it.
const PO_CUT_GATE={min:0.7,max:1.3};
// What a PO with an approved override is held to: no window at all.
const PO_CUT_GATE_OPEN={open:true};
// The window a PO is held to: open once an owner has approved a variance on it
// (po.cutOverride, written by poCutOverride), the everyday one otherwise.
// WP1 (Oct 2026): the everyday window is the Production Ops Settings cut gate
// (ph_settings/main.cutGate, whole percent) WHEN that document was read from the
// server; otherwise this file's fixed 70–130 (PO_CUT_GATE) and the screen says
// "default gate (settings not read)". poCutGateFrom(raw): raw is the settings
// document's data ({} = read, nothing saved), or null = not read.
function poCutGateFrom(raw){
  if(raw==null||typeof phSettings!=='function')return PO_CUT_GATE;
  const g=phSettings(raw).cutGate;
  if(!Array.isArray(g)||g.length!==2)return PO_CUT_GATE;
  if(g[0]===70&&g[1]===130)return PO_CUT_GATE;
  return{min:g[0]/100,max:g[1]/100};
}
// The settings document as the data layer last READ it: its data, or null.
function _poCutSettingsRaw(){
  if(typeof phSettingsInfo!=='function')return null;
  try{const i=phSettingsInfo();return i&&i.known?(i.raw||{}):null;}catch(e){return null;}
}
function poCutSettingsRead(){return _poCutSettingsRaw()!==null;}
function poCutGateNow(){return poCutGateFrom(_poCutSettingsRaw());}
// rawOverride: the settings data read INSIDE a transaction ({} or data), or null when that read failed.
function poCutGateFor(po,rawOverride){
  if(po&&po.cutOverride&&po.cutOverride.by)return PO_CUT_GATE_OPEN;
  return rawOverride===undefined?poCutGateNow():poCutGateFrom(rawOverride);
}
// Allowed pieces for an ordered quantity. Same arithmetic the gate always used:
// the lower bound rounds UP, the upper bound DOWN.
function poCutRange(target,gate){const g=gate||PO_CUT_GATE;if(g.open)return{min:0,max:Infinity};return{min:Math.ceil(target*g.min),max:Math.floor(target*g.max)};}
function poCutPct(gate){const g=gate||PO_CUT_GATE;if(g.open)return'any quantity';return Math.round(g.min*100)+'–'+Math.round(g.max*100)+'%';}
// "Allowed: 70–130 pcs (70–130%)" / "Allowed: any quantity (owner override)".
function poCutRangeText(min,max,gate){return(gate&&gate.open)?'Allowed: any quantity (owner override)':`Allowed: ${min}–${max} pcs (${poCutPct(gate)})${poCutSettingsRead()?'':' — default gate (settings not read)'}`;}
function _poCutEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// PKT (UTC+5, no daylight saving) calendar day, YYYY-MM-DD. NEVER
// toISOString().slice(0,10): that is the UTC day, and in PKT it names the
// PREVIOUS day between 00:00 and 05:00. A fixed offset rather than the device's
// own timezone, so the business day is the same whoever's phone saves it.
function _poCutPktDay(ms){
  const d=new Date((ms==null?Date.now():ms)+5*3600*1000);
  const p=n=>String(n).padStart(2,'0');
  return`${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;
}
// Who may widen a cut: owners, and Mustafa by username (the Sept 2026 grant
// shape — never role-wide, which would hand it to Arfat as well).
function _poCutCanOverride(){return!!(session&&(session.role==='owner'||session.u==='mustafa'));}
// What the cutting screen says about an approved variance. Everything that was
// typed by someone is escaped: this goes into innerHTML.
function _poCutOverrideNote(po){
  const o=po&&po.cutOverride;if(!o||!o.by)return'';
  return`<div style="margin-top:6px;font-size:12px;color:var(--accent-warning);font-weight:600">Owner override: any quantity allowed — approved by ${_poCutEsc(o.byName||o.by)}${o.reason?` (${_poCutEsc(o.reason)})`:''}</div>`;
}
// PURE. May cutting be recorded against this PO document as it is NOW?
//   {state:'ok'} | {state:'done'|'reserved'|'wrongStage'|'gone'}
// 'done' is the one that matters for B1: the PO's own record that cutting has
// happened — a second tap, a second device or a retry after a lost reply all
// land here instead of minting a second set of bundles.
function poCutLiveCheck(live){
  if(!live)return{state:'gone'};
  if(live.stages&&live.stages.cutting&&live.stages.cutting.done)return{state:'done'};
  if(poStatusOf(live)===PO_STATUS.RESERVED)return{state:'reserved'};
  if(live.currentStage!=='cutting')return{state:'wrongStage',at:live.currentStage};
  return{state:'ok'};
}
// OWNER OVERRIDE of the cutting tolerance — the hook (Oct 2026). Owners and
// Mustafa only. Approves a cut OUTSIDE PO_CUT_GATE (any quantity) of the ordered
// quantity on ONE PO: records who, when and why on the PO (po.cutOverride), and
// puts a row in Mustafa's notification bell — in the SAME transaction, so an
// override nobody was told about cannot exist. The cutting screen then gates on
// the wider window (poCutGateFor), and markCuttingDone stamps the override as
// used. Mustafa overriding himself is recorded but not notified (he is the
// one who would have been told). `reasonArg` skips the prompt (tests, callers).
// The bell prints title and message RAW (_hrmNotifCardHTML), so both are
// escaped here; the reason is stored as typed and escaped wherever it is drawn.
window.poCutOverride=async function(fbKey,reasonArg){
  if(!_poCutCanOverride()){showToast('Only an owner or Mustafa can approve a cut outside '+poCutPct(poCutGateNow())+'.',true);return;}
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po){showToast('PO not found.',true);return;}
  if(po.cutOverride&&po.cutOverride.by){showToast(`A variance is already approved on ${po.id} (by ${po.cutOverride.byName||po.cutOverride.by}).`);return;}
  const pre=poCutLiveCheck(po);
  if(pre.state!=='ok'){showToast(`${po.id} is not waiting to be cut — there is nothing to approve.`,true);return;}
  let reason=reasonArg;
  if(reason===undefined){
    reason=prompt(`Approve a cut outside ${poCutPct(poCutGateNow())} of the ${po.qty||'?'} pcs ordered for ${po.id} (any quantity)?\n\nReason (required) — Mustafa will be told:`);
    if(reason===null)return;
  }
  reason=String(reason||'').trim().slice(0,300);
  if(reason.length<3){showToast('A reason is required to approve a cut variance.',true);return;}
  try{
    const poRef=doc(db,'pos',fbKey);
    const nowMs=Date.now();
    const rec={by:session.u,byName:session.name,at:new Date(nowMs).toISOString(),reason,gateMin:poCutGateNow().min,gateMax:poCutGateNow().max,ordered:po.qty||0};
    const nid='po_cutov_'+fbKey+'_'+nowMs;
    const notifRef=doc(db,'hrm_notifications',nid);
    const out=await runTransaction(db,async tx=>{
      const snap=await tx.get(poRef);
      const live=snap.exists()?snap.data():null;
      if(live&&live.cutOverride&&live.cutOverride.by)return{already:live.cutOverride};
      if(poCutLiveCheck(live).state!=='ok')return{blocked:true};
      tx.update(poRef,{cutOverride:rec});
      if(session.u!=='mustafa'){
        const clip=(s,n)=>String(s).slice(0,n);
        // Same row shape as _hrmNotify (js/hrm.js), written here instead so it
        // commits WITH the override. Escaped once, after the length cut.
        tx.set(notifRef,{
          id:nid,type:'po_cut_override',source:'po_cutting',
          title:_poCutEsc(clip(`Cut variance approved: ${po.id}`,80)),
          message:_poCutEsc(clip(`${session.name} approved a cut beyond ${poCutPct(poCutGateNow())} (any quantity) of the ${po.qty||'?'} pcs ordered on ${po.id}${po.name?' ('+po.name+')':''}. Reason: ${reason}`,300)),
          forUser:'mustafa',forRole:'',relatedTo:fbKey,createdAt:nowMs,readBy:[],
          priority:'high',actionRequired:false,actionUrl:'po-registry'
        });
      }
      return{ok:true};
    });
    if(out.already){showToast(`A variance is already approved on ${po.id} (by ${out.already.byName||out.already.by}).`);}
    else if(out.blocked){showToast(`${po.id} is no longer waiting to be cut — nothing was approved.`,true);}
    else{
      await logActivity('Cut variance approved',`PO ${po.id} · cut beyond ${poCutPct(poCutGateNow())} approved by ${session.name} — ${reason}`);
      showToast(`Cut variance approved on ${po.id} ✓${session.u!=='mustafa'?' — Mustafa has been told':''}`);
    }
    await loadData();
    if(currentPage==='po-detail')renderDetailPage();
  }catch(e){showToast('Error: '+e.message+' (approving a variance needs a connection)',true);}
};

// PURE. What is wrong with the raw numbers typed on the cutting screen, in
// words that name the size or bundle at fault — or null when they are sound.
// Size inputs and bundle units are typed numbers (min is only advisory in the
// browser), so a minus sign, a decimal or a blank can arrive; the open gate of
// an owner override (any quantity) must not let them through, because a
// negative bundle would cancel a positive one and save a cut of nothing.
//   · every size quantity: a whole number, 0 or more
//   · every bundle: a known size and a whole number of units ABOVE 0
//   · the total cut: above 0 (the 70–130% gate is judged separately, and only
//     ever narrows this)
// Used by cutValidationOk (the button) and again INSIDE markCuttingDone's
// transaction, which is the authority.
function poCutInputProblem(actualQty,bundles){
  const SZ=['XS','S','M','L','XL','2XL'];
  const q=actualQty||{};
  const shown=v=>(typeof v==='number'&&!isFinite(v))?String(v):JSON.stringify(v);
  let total=0;
  for(const sz of SZ){
    const v=q[sz];
    if(v===undefined||v===null)continue;
    if(typeof v!=='number'||!isFinite(v)||Math.floor(v)!==v||v<0)return`Size ${sz}: the cut quantity must be a whole number, 0 or more (got ${shown(v)}).`;
    total+=v;
  }
  const list=Array.isArray(bundles)?bundles:[];
  for(let i=0;i<list.length;i++){
    const b=list[i]||{};
    if(SZ.indexOf(b.size)<0)return`Bundle ${i+1}: "${b.size}" is not a size that can be cut.`;
    const u=b.units;
    if(typeof u!=='number'||!isFinite(u)||Math.floor(u)!==u||u<=0)return`Bundle ${i+1} (${b.size}): the units must be a whole number above 0 (got ${shown(u)}).`;
  }
  if(!(total>0))return'The total cut must be above 0.';
  // B16 (Oct 2026): the bundles must account for the cut EXACTLY, size by size
  // (so also in total). This used to be judged on the button only; the
  // transaction trusted whatever arrived. And a size that was not cut (0 or
  // blank) gets no bundles at all — an empty size must not mint a bundle
  // number or a bundle document.
  const per={},cnt={};
  for(const b of list){per[b.size]=(per[b.size]||0)+b.units;cnt[b.size]=(cnt[b.size]||0)+1;}
  for(const sz of SZ){
    const cut=(typeof q[sz]==='number')?q[sz]:0,bundled=per[sz]||0;
    if(cut===0&&bundled>0)return`Size ${sz}: nothing was cut (0), but ${cnt[sz]} bundle${cnt[sz]===1?'':'s'} (${bundled} units) ${cnt[sz]===1?'was':'were'} entered for it — a size that was not cut gets no bundles.`;
    if(bundled!==cut)return`Size ${sz}: the bundles add up to ${bundled} but ${cut} were cut — they must match exactly.`;
  }
  return null;
}
function cutValidationOk(po){
  if(poCutInputProblem(cutState.actualQty,cutState.pendingBundles))return false;
  const szs=['XS','S','M','L','XL','2XL'];
  const target=po.qty||0;const actualTotal=szs.reduce((a,s)=>a+(parseInt(cutState.actualQty[s])||0),0);
  const {min,max}=poCutRange(target,poCutGateFor(po));
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
  const gate=poCutGateFor(po),{min,max}=poCutRange(target,gate);
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
  if(tot)tot.innerHTML=`Total: <strong>${actualTotal}</strong> actual / <strong>${target}</strong> target &nbsp;<span style="font-size:12px;color:var(--muted)">${poCutRangeText(min,max,gate)}</span><span style="margin-left:8px;font-weight:600;color:${rangeOk?'var(--green)':'#dc2626'}">${rangeOk?'✓ In range':'✗ Out of range'}</span>${_poCutOverrideNote(po)}`;
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
  if(!inStock.length){wrap.innerHTML='<div style="font-size:13px;color:var(--muted);padding:8px">No in-stock rolls.</div>';return;}
  wrap.innerHTML=`<label style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Select rolls to consume (${inStock.length} in stock)</label>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;max-height:240px;overflow-y:auto;padding:8px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px">
      ${inStock.map(r=>`<label style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;cursor:pointer">
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

// ── Cutting done — idempotent and atomic (B1, Oct 2026) ────────────────────
// WAS: the bundles were committed in one batch, THEN the fabric was deducted
// and the PO updated in a second write. Anything failing after the first
// commit left bundles behind a PO still at cutting, and the retry minted a
// second full set; a second tap or a second device did the same, because
// nothing ever asked whether cutting had already happened.
// NOW:
//  · the PO's own record is the guard (stages.cutting.done), read on the LIVE
//    document — early (so nothing is deducted for a cut that already
//    happened) and again INSIDE the write;
//  · the bundles, the bundle counter and the PO update are ONE transaction:
//    all land or none do, so a failed save leaves nothing behind and spends no
//    numbers, and a retry just runs it again;
//  · the ids come from the counter inside that transaction and every
//    candidate is probed first, so a counter that has fallen behind (reset,
//    hand-edited) steps over ids that exist instead of overwriting a bundle
//    that is in use;
//  · bundles already on file for this PO — debris from a save that died under
//    the old code — are REUSED when they match what was entered, and refused
//    (never duplicated, never overwritten) when they do not;
//  · a second tap while a save is in flight is ignored.
// Fabric is the one thing NOT inside the transaction: _fabInvUpsert runs its
// own and cannot also mint bundle ids. It runs after every check that can
// refuse, and is remembered per PO, so a retry after a failed save does not
// deduct the rolls twice.
let _poCutBusy={};       // fbKey → true while a save is in flight
let _poCutFabDone={};    // fbKey → {sig,consumed}: rolls already deducted this session
const _PO_CUT_PROBE_MAX=500;   // how many taken bundle ids one save will step over before giving up
function _poCutBundleSig(list){return list.map(b=>b.size+':'+b.units).sort().join('|');}
// PURE. The words for a cut the live document refuses. error:false is not a
// failure — it means the work is already done.
function _poCutBlocked(po,c,live){
  if(c.state==='done'){
    const by=live&&live.stages&&live.stages.cutting&&live.stages.cutting.doneBy;
    return{error:false,msg:`Cutting for ${po.id} was already recorded${by?' by '+by:''} — nothing was changed.`};
  }
  if(c.state==='reserved')return{error:true,msg:`${po.id} is still a reserve order — release it to production before it is cut. Nothing was saved.`};
  if(c.state==='wrongStage')return{error:true,msg:`${po.id} is no longer at cutting (${c.at?'it is at '+_poStageLabel(c.at):'it is not in production'}) — nothing was saved.`};
  if(c.state==='input')return{error:true,msg:c.msg+' Nothing was saved.'};
  if(c.state==='range')return{error:true,msg:`${c.total} pcs is outside the ${c.rng.min}–${c.rng.max} allowed for ${c.qty} ordered (${poCutPct(c.gate)}). An owner or Mustafa can approve a variance from the PO page. Nothing was saved.`};
  return{error:true,msg:`${po.id} could not be found — nothing was saved.`};
}
window.markCuttingDone=async function(fbKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po)return;
  if(_poCutBusy[fbKey])return;   // second tap / second call while the first is still saving
  const bad0=poCutInputProblem(cutState.actualQty,cutState.pendingBundles);
  if(bad0){showToast(bad0+' Nothing was saved.',true);return;}
  if(!cutValidationOk(po)){showToast('Validation failed — check quantities.',true);return;}
  _poCutBusy[fbKey]=true;
  const btn=document.getElementById('cut-done-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  let committed=false;
  try{
    // The fixed alpha set, as everywhere on the cutting screen (PO_FLOW_SIZES).
    // Denim WAIST sizes (28–40) cannot be cut on a PO yet — a later milestone
    // (audit B17); until then a size outside this set is not counted.
    const SZ=['XS','S','M','L','XL','2XL'];
    // Everything the save needs is copied NOW: the screen can change while the
    // awaits below are in flight.
    const actual={...cutState.actualQty};
    const pend=cutState.pendingBundles.map(b=>({size:b.size,units:b.units}));
    const poRef=doc(db,'pos',fbKey);
    // 1. The PO as it is NOW — allPOs can be hours old on a second device.
    const liveSnap=await getDoc(poRef);
    const live=liveSnap&&liveSnap.exists()?liveSnap.data():null;
    const pre=poCutLiveCheck(live);
    if(pre.state!=='ok'){
      const b=_poCutBlocked(po,pre,live);
      showToast(b.msg,b.error);
      await loadData();if(!b.error)window.showPage('my-work');
      return;
    }
    // 1b. The gate on the LIVE quantity and override, BEFORE anything is
    // deducted: a stale screen (quantity or override changed since it loaded)
    // must not deduct rolls and then save nothing. The check inside the
    // transaction below stays the authority.
    {
      const tot0=SZ.reduce((a,s)=>a+(parseInt(actual[s])||0),0);
      const g0=poCutGateFor(live),r0=poCutRange(live.qty||0,g0);
      if(tot0<r0.min||tot0>r0.max){
        const b=_poCutBlocked(po,{state:'range',rng:r0,gate:g0,total:tot0,qty:live.qty||0},live);
        showToast(b.msg,b.error);
        return;
      }
    }
    // 2. Bundles already on file for this PO (a save that died under the old code).
    const bsnap=await getDocs(query(collection(db,'bundles'),where('poId','==',po.id)));
    const existing=bsnap.docs.map(d=>d.data()).filter(b=>b&&b.bundleId).sort((a,b)=>(a.bundleNumber||0)-(b.bundleNumber||0));
    let reuse=null;
    if(existing.length){
      if(_poCutBundleSig(existing)!==_poCutBundleSig(pend)){
        const ids=existing.map(b=>b.bundleId),shown=ids.slice(0,10).join(', ');
        showToast(`${po.id} already has ${existing.length} bundle${existing.length!==1?'s':''} on file from an earlier save that did not finish (${shown}${ids.length>10?` and ${ids.length-10} more`:''}), and they do not match what you entered. Nothing was saved. An owner must review these bundles in the bundles collection before cutting can be recorded.`,true);
        return;
      }
      reuse=existing.map(b=>b.bundleId);
    }
    const cutWt=parseFloat(document.getElementById('cut-weight')?.value)||0;
    const cutRolls=document.getElementById('cut-rolls')?.value.trim()||'';
    const cutUnits=SZ.reduce((a,s)=>a+(parseInt(actual[s])||0),0);
    const cutAvg=cutWt>0&&cutUnits>0?Math.round(cutWt*1000/cutUnits)+'g':'';
    // 3. Fabric inventory consumption (optional) — once per PO and roll set.
    const stockKey=document.getElementById('cut-fab-stock')?.value||'';
    let consumedFromInv=null,fabricFail=null;
    if(stockKey&&_cutFabRolls.length){
      const stock=allFabricInventory.find(s=>s._id===stockKey);
      if(stock){
        const rollCodes=_cutFabRolls.map(r=>r.rollCode);
        const sig=stockKey+'|'+rollCodes.slice().sort().join(',');
        const prior=_poCutFabDone[fbKey];
        if(prior&&prior.sig===sig){consumedFromInv=prior.consumed;fabricFail=prior.fail;}   // a retry — already deducted
        else{
          // OPTIONAL, and never allowed to block or corrupt cutting-done: a roll
          // that is no longer issuable is reported and recorded on the PO, and the
          // cut is saved regardless. tolerateMissing keeps the engine's old
          // skip-a-missing-roll behaviour (the engine may abort by default);
          // the catch covers an engine that throws anyway. Nothing has been
          // written to the bundles or the PO at this point, so a failure here
          // can neither leave bundles behind nor make a retry duplicate them.
          try{
            const res=await _fabInvUpsert({fabType:stock.fabType,gsm:stock.gsm,color:stock.color,unit:stock.unit||'kg',removeRollCodes:rollCodes,note:`Consumed for PO ${po.id} cutting`,sourceCol:'pos',sourceId:po.id,tolerateMissing:true});
            // With tolerateMissing the engine reports the rolls it did NOT take in
            // res.skipped. Only the rolls really deducted are recorded as consumed;
            // the skipped ones are reported and recorded as a failure.
            const skipped=((res&&res.skipped)||[]).map(x=>typeof x==='string'?x:String((x&&(x.rollCode||x.code))||x));
            const taken=_cutFabRolls.filter(r=>skipped.indexOf(r.rollCode)<0);
            if(taken.length)consumedFromInv={fabType:stock.fabType,gsm:stock.gsm,color:stock.color,rollCodes:taken.map(r=>r.rollCode),qty:taken.reduce((s,r)=>s+r.weight,0)};
            if(skipped.length)fabricFail={rollCodes:skipped,partial:taken.length>0,error:`${skipped.length} roll${skipped.length!==1?'s':''} not deducted (${skipped.join(', ')}) — no longer issuable`,code:'fabric/rolls-skipped'};
            _poCutFabDone[fbKey]={sig,consumed:consumedFromInv,fail:fabricFail};
          }catch(fe){
            fabricFail={rollCodes,error:String((fe&&fe.message)||fe).slice(0,200),code:String((fe&&fe.code)||'')};
          }
        }
      }
    }
    // 4. ONE transaction: the bundles, the counter and the PO.
    const nowMs=Date.now(),nowISO=new Date(nowMs).toISOString(),day=_poCutPktDay(nowMs);
    const ctrRef=doc(db,'counters','main');
    const bidOf=n=>'B-'+String(n).padStart(4,'0');
    const out=await runTransaction(db,async tx=>{
      // Every read first (a transaction refuses a read after a write).
      const ps=await tx.get(poRef);
      const lv=ps.exists()?ps.data():null;
      // WP1: the Settings cut gate, read live here (reads before writes). A failed read = null = the fixed default.
      let sraw=null;
      try{const ss=await tx.get(doc(db,'ph_settings','main'));sraw=ss.exists()?(ss.data()||{}):{};}catch(e){sraw=null;}
      const c=poCutLiveCheck(lv);
      if(c.state!=='ok')return{blocked:c,live:lv};
      // The typed numbers, again, here: this is the authority (an override opens
      // the 70–130% window, never this).
      const bad=poCutInputProblem(actual,pend);
      if(bad)return{blocked:{state:'input',msg:bad},live:lv};
      // The gate is judged on the LIVE order quantity and the LIVE override.
      const total=SZ.reduce((a,s)=>a+(parseInt(actual[s])||0),0);
      const gate=poCutGateFor(lv,sraw),rng=poCutRange(lv.qty||0,gate),std=poCutRange(lv.qty||0,poCutGateFrom(sraw));
      if(total<rng.min||total>rng.max)return{blocked:{state:'range',rng,gate,total,qty:lv.qty||0},live:lv};
      const usedOverride=total<std.min||total>std.max;
      let ids,nums=[],cs=null,cur=0;
      if(reuse){ids=reuse.slice();}
      else{
        cs=await tx.get(ctrRef);
        cur=cs.exists()?(Number(cs.data().bundles)||0):0;
        let n=cur,probes=0;
        while(nums.length<pend.length){
          n++;
          if(++probes>pend.length+_PO_CUT_PROBE_MAX)throw new Error('No free bundle numbers after B-'+String(cur).padStart(4,'0')+' — the bundle counter needs an owner\'s attention. Nothing was saved.');
          const bs=await tx.get(doc(db,'bundles',bidOf(n)));
          if(!bs.exists())nums.push(n);
        }
        ids=nums.map(bidOf);
      }
      // Then every write.
      if(!reuse){
        pend.forEach((b,i)=>tx.set(doc(db,'bundles',ids[i]),{bundleId:ids[i],bundleNumber:nums[i],poId:po.id,size:b.size,units:b.units,stage:'cutting',bundlingDone:false,stitchingDone:false,qcStatus:null,qcReason:'',createdBy:session.name,createdAt:day,ts:nowMs}));
        const last=nums[nums.length-1];
        if(cs.exists())tx.update(ctrRef,{bundles:Math.max(cur,last)});else tx.set(ctrRef,{bundles:last},{merge:true});
      }
      const poUpdate={currentStage:poRealNextStage('cutting'),cutQty:{...actual},cutBySize:{...actual},cutBy:session.name,cutAt:nowISO,cutDate:day,bundleIds:ids,totalWeight:cutWt||'',avgPerUnit:cutAvg,[`stages.cutting.done`]:true,[`stages.cutting.doneAt`]:nowISO,[`stages.cutting.doneBy`]:session.name};
      // The rolls the cutter counted replace the PO's rolls figure — but a BLANK
      // box must not erase the figure the PO was created with (it prints on the
      // traveler and shows on the PO page).
      if(cutRolls!=='')poUpdate.totalRoll=cutRolls;
      if(consumedFromInv)poUpdate.fabricConsumed=consumedFromInv;
      if(fabricFail)poUpdate.fabricConsumeFailed={...fabricFail,at:nowISO,by:session.name};
      // A cut that only fits the widened window says so on the override record.
      if(usedOverride){poUpdate['cutOverride.usedAt']=nowISO;poUpdate['cutOverride.actualTotal']=total;poUpdate['cutOverride.pct']=lv.qty?Math.round(total/lv.qty*1000)/10:null;}
      tx.update(poRef,poUpdate);
      return{ids,usedOverride,total};
    });
    if(out.blocked){
      const b=_poCutBlocked(po,out.blocked,out.live);
      showToast(b.msg,b.error);
      await loadData();if(!b.error)window.showPage('my-work');
      return;
    }
    committed=true;
    delete _poCutFabDone[fbKey];
    await logActivity('Stage done',`PO ${po.id} · Cutting done — ${pend.length} bundles${consumedFromInv?` · consumed ${consumedFromInv.rollCodes.length} rolls`:''}${out.usedOverride?` · ${out.total} pcs inside an owner-approved variance`:''}`);
    // Tops up the embellishment job the fabric issue created with what was
    // ACTUALLY cut per size (and creates one if no issue ever did). Guarded —
    // no embellishments module, no change. See js/embellishments.js.
    if(typeof embOnCuttingDone==='function')await embOnCuttingDone({...po,bundleIds:out.ids},{...actual}).catch(e=>console.warn('[pos] embellishment top-up failed:',e&&e.message));
    showToast(fabricFail
      ?`Cutting done ✓ — ${pend.length} bundles. Fabric was ${fabricFail.partial?'only PARTLY deducted':'NOT deducted'} (${fabricFail.error}) — deduct ${fabricFail.partial?'the skipped':'those'} rolls from Fabric Inventory by hand.`
      :`Cutting done ✓ — ${pend.length} bundles${consumedFromInv?' · fabric deducted':''}`,!!fabricFail);await loadData();window.showPage('my-work');
  }catch(e){
    showToast(committed
      ?'Cutting was saved, but the screen could not refresh — reload the page. ('+e.message+')'
      :'Error: '+e.message+(_poCutFabDone[fbKey]?' — the fabric deduction already went through: press Mark Cutting Done again and do not pick the rolls again.':''),true);
  }finally{
    delete _poCutBusy[fbKey];
    if(!committed&&btn){btn.disabled=false;btn.textContent='Mark Cutting Done ✓';}
  }
};

// ── Bundling stage (damage tracking + destination split) ──
function renderBundlingWork(po){
  const bundles=currentBundles;
  if(!bundles.length){
    const isOwner=['owner','manager'].includes(session.role);
    return`<button class="back-btn" onclick="window.showPage('my-work')">← Back to My Work</button>
    <div class="page-head"><div class="page-title">PO ${po.id} — Bundling</div><div class="page-sub">${po.name||'—'}</div></div>
    <div class="card"><div class="card-title">No bundles found</div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:12px">Cutting stage has not created bundles for this PO yet.</div>
      ${isOwner?`<button class="mark-done-btn" onclick="window.bundlingOverride('${po.fbKey}')">Owner override — skip to stitching</button>`:'<div style="font-size:13px;color:var(--muted)">Contact the owner to proceed.</div>'}
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
    ${parts.map(p=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:14px">
      <span style="font-weight:500">${p.name}</span>
      <div style="display:flex;align-items:center;gap:8px">
        ${p.notes?`<span style="font-size:12px;color:var(--muted)">${p.notes}</span>`:''}
        <span style="padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;background:var(--soft);color:var(--text)">→ ${p.dest}</span>
      </div>
    </div>`).join('')}
  </div>`:'';

  const destSections=uniqueDests.map(dest=>{
    const dBundles=destGroups[dest]||[];
    const dDone=dBundles.filter(b=>b.bundlingDone).length;
    const bySz={};dBundles.forEach(b=>{if(!bySz[b.size])bySz[b.size]=[];bySz[b.size].push(b);});
    return`<div style="margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:14px;font-weight:700">→ ${dest}</span>
        <span style="font-size:12px;padding:2px 8px;border-radius:10px;background:var(--soft);color:var(--text)">${dDone}/${dBundles.length} bundled</span>
        ${uniqueDests.length>1?`<div class="progress-strip" style="flex:1;max-width:120px"><div class="progress-fill" style="width:${dBundles.length?Math.round(dDone/dBundles.length*100):0}%"></div></div>`:''}
      </div>
      ${Object.entries(bySz).map(([sz,bList])=>`<div class="card" style="margin-bottom:8px"><div class="card-title">${sz} — ${bList.length} bundle${bList.length!==1?'s':''}</div>
        ${bList.map(b=>{
          const dmgVal=bundleDamage[b.bundleId]?.dmg??'';
          const dmgEntered=bundleDamage[b.bundleId]?.entered;
          return`<div class="bundle-item" id="bi-${b.bundleId}" style="flex-wrap:wrap;gap:8px;${b.bundlingDone?'background:var(--accent-success-soft);border-radius:8px;padding:8px':''}">
            <span class="bundle-num">${b.bundleId}</span>
            <span class="bundle-size-tag">${b.size}</span>
            <span class="bundle-units ${b.bundlingDone?'bundle-done':''}">${b.units} pcs</span>
            <span style="flex:1"></span>
            ${b.bundlingDone
              ?`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                  <span style="color:var(--green);font-weight:600;font-size:13px">✓ Bundled</span>
                  <div style="display:flex;align-items:center;gap:4px">
                    <input type="number" min="0" max="${b.units}" placeholder="0" value="${dmgVal===0?'':dmgVal}" style="width:56px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:13px;outline:none;font-family:inherit" oninput="window.saveBundleDamage('${b.bundleId}',this.value||'0','${dest}','${po.fbKey}')">
                    <span style="font-size:12px;color:var(--muted)">dmg</span>
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
      <span style="font-size:23px;font-weight:700;color:${allBundled?'var(--green)':'var(--dark)'}">${doneCount}/${bundles.length}</span>
      <span style="font-size:13px;color:var(--muted)">bundles bundled</span>
    </div>
    <div class="progress-strip"><div class="progress-fill" style="width:${bundles.length?Math.round(doneCount/bundles.length*100):0}%"></div></div>
    <div style="margin-top:10px;padding:10px 12px;background:var(--surface-2);border-radius:8px;font-size:13px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center">
      <div><div style="font-size:11px;color:var(--muted)">PO Qty</div><div style="font-weight:700">${po.qty||0}</div></div>
      <div><div style="font-size:11px;color:var(--muted)">Cut</div><div style="font-weight:700">${cutTotal}</div></div>
      <div><div style="font-size:11px;color:var(--muted)">Damaged</div><div style="font-weight:700;color:${pctColor}">${totalDamage}</div></div>
      <div><div style="font-size:11px;color:var(--muted)">Usable</div><div style="font-weight:700;color:var(--green)">${usable}</div></div>
    </div>
    ${cutTotal>0?`<div style="margin-top:6px;font-size:12px;text-align:center;font-weight:600;color:${pctColor}">${pct.toFixed(2)}% damage rate ${pct>1.5?'⚠ Will be flagged':pct>1?'⚠ Near threshold':''}</div>`:''}
  </div>
  ${partsCard}
  ${destSections}
  ${pct>1.5?`<div style="background:var(--accent-urgent-soft);border:1px solid var(--accent-urgent);border-radius:10px;padding:12px 14px;margin-bottom:10px">
    <div style="font-weight:700;color:var(--accent-urgent);font-size:14px;margin-bottom:4px">⚠ Damage Alert / نقصان کا انتباہ</div>
    <div style="font-size:13px;color:var(--accent-urgent);margin-bottom:6px">This bundling record will be flagged for excess loss of quantity (${pct.toFixed(2)}%). A manager will be notified.</div>
    <div style="font-size:13px;color:var(--accent-urgent);direction:rtl;text-align:right;font-family:serif">یہ بنڈلنگ ریکارڈ مقدار میں زیادہ نقصان (${pct.toFixed(2)}%) کی وجہ سے فلیگ کیا جائے گا۔ مینیجر کو اطلاع دی جائے گی۔</div>
  </div>`:''}
  <button class="mark-done-btn" id="bundling-done-btn" onclick="window.completeBundling('${po.fbKey}')" ${allBundled?'':'disabled'} style="margin-top:4px">Complete Bundling ✓</button>
  ${!allBundled?'<div style="font-size:12px;color:var(--muted);text-align:center;margin-top:6px">Mark all bundles done first — damage defaults to 0 if none</div>':''}
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
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:23px;font-weight:700;color:${allDone?'var(--green)':'var(--dark)'}">${doneCount}/${bundles.length}</span><span style="font-size:13px;color:var(--muted)">bundles ${doneLabel.toLowerCase()}</span></div>
    <div class="progress-strip"><div class="progress-fill" style="width:${bundles.length?Math.round(doneCount/bundles.length*100):0}%"></div></div>
  </div>
  ${Object.entries(bySz).map(([sz,bList])=>`<div class="card"><div class="card-title">${sz} — ${bList.length} bundle${bList.length!==1?'s':''}</div>
    ${bList.map(b=>`<div class="bundle-item" id="bi-${b.bundleId}">
      <span class="bundle-num">${b.bundleId}</span>
      <span class="bundle-size-tag">${b.size}</span>
      <span class="bundle-units ${b[doneField]?'bundle-done':''}">${b.units} pcs</span>
      <span style="flex:1"></span>
      ${b[doneField]?`<span style="color:var(--green);font-weight:600;font-size:13px">✓ ${doneLabel}</span>`:`<button class="qc-pass-btn" onclick="window.markBundleStage('${b.bundleId}','${stage}','${doneField}','${doneAtField}','${doneLabel}','${po.fbKey}','${nextStage}')">Mark ${doneLabel} ✓</button>`}
    </div>`).join('')}
  </div>`).join('')}
  ${!bundles.length?'<div class="empty">No bundles found for this PO.</div>':''}
  ${doneCount<bundles.length&&bundles.length>0?`<div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:6px">${bundles.length-doneCount} bundle${bundles.length-doneCount!==1?'s':''} remaining — you can still complete the stage</div>`:''}
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
      ${bundles.map(b=>`<div style="padding:5px 10px;background:var(--surface-2);border-radius:8px;font-size:13px;font-weight:600">${b.bundleId} <span style="color:var(--muted);font-weight:400">${b.size} · ${b.units}pcs</span></div>`).join('')||'<div style="color:var(--muted);font-size:13px">No bundles on record.</div>'}
    </div>
  </div>
  <div class="card"><div class="card-title">Completion</div>
    <div style="font-size:14px;color:var(--muted);margin-bottom:12px">Mark the entire lot as complete to advance to the next stage.</div>
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
      <div style="text-align:center;padding:10px;background:var(--surface-2);border-radius:8px"><div style="font-size:21px;font-weight:700;color:var(--muted)">${pending}</div><div style="font-size:11px;color:var(--muted)">Pending</div></div>
      <div style="text-align:center;padding:10px;background:var(--soft);border-radius:8px"><div style="font-size:21px;font-weight:700;color:var(--text)">${passed}</div><div style="font-size:11px;color:var(--muted)">Passed</div></div>
      <div style="text-align:center;padding:10px;background:var(--accent-urgent-soft);border-radius:8px"><div style="font-size:21px;font-weight:700;color:var(--accent-urgent)">${failed}</div><div style="font-size:11px;color:var(--accent-urgent)">Failed</div></div>
    </div>
  </div>
  ${bundles.map(b=>`<div class="bundle-item" id="qci-${b.bundleId}" style="background:${b.qcStatus==='pass'?'#f0fdf4':b.qcStatus==='fail'?'#fef2f2':'#f8f8f8'}">
    <span class="bundle-num">${b.bundleId}</span>
    <span class="bundle-size-tag">${b.size}</span>
    <span class="bundle-units" style="flex:1">${b.units} pcs</span>
    ${b.qcStatus==='pass'?'<span style="color:var(--green);font-weight:700">✓ Pass</span>':b.qcStatus==='fail'?`<span style="color:var(--accent-urgent);font-weight:700">✗ Fail</span><span style="font-size:12px;color:var(--accent-urgent);margin-left:6px">${b.qcReason||''}</span>`:`<button class="qc-pass-btn" onclick="window.setQC('${b.bundleId}','pass','')">Pass ✓</button><button class="qc-fail-btn" style="margin-left:6px" onclick="window.setQCFail('${b.bundleId}')">Fail ✗</button>`}
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
// poStatus is deliberately NOT set to 'complete' here. A PO whose Final QC is
// done is still `in_production` as far as Packing is concerned: js/production.js
// (_packOpenPOs, line 37; the barcode list, line 363) selects POs by
// poStatusOf(p)===IN_PRODUCTION && cut>0 && not fully received — flipping the
// status at QC would drop every finished PO out of Receiving and Ready to
// Barcode. currentStage:'completed' is what says QC is done.
window.completeQC=async function(fbKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po)return;
  // Only the stage the PO is AT can be completed: a stale screen or a second
  // tap must not overwrite who finished QC and when.
  if(po.currentStage!=='qc'){showToast(po.currentStage==='completed'?`${po.id} has already completed Final QC.`:`${po.id} is not at Final QC — nothing to complete.`,true);return;}
  if(typeof phqcCloseBlock==='function'){const qb=await phqcCloseBlock(po);if(qb){showToast(qb,true);return;}}   // QC6: refused while a QC reconciliation is open (js/ph-mod-afloat.js)
  const qw=typeof phqcCloseSkippedWarn==='function'?phqcCloseSkippedWarn(po):'';if(qw)showToast(qw,true);   // wave 2: a skipped QC check is said out loud
  const failed=currentBundles.filter(b=>b.qcStatus==='fail').length;
  const msg=(qw?qw+'\n\n':'')+(failed>0?`Complete QC with ${failed} failed bundle${failed!==1?'s':''}?`:'Mark Final QC complete?');
  if(!confirm(msg))return;
  const btn=document.getElementById('qc-done-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'pos',fbKey),{currentStage:'completed',[`stages.qc.done`]:true,[`stages.qc.doneAt`]:new Date().toISOString(),[`stages.qc.doneBy`]:session.name,[`stages.qc.notes`]:failed>0?`${failed} bundles failed QC`:''});
    await logActivity('Stage done',`PO ${po.id} · Final QC complete — ${currentBundles.filter(b=>b.qcStatus==='pass').length} passed, ${failed} failed`);
    showToast(qw?`QC complete ✓ — but the QC reconciliation check was skipped (po_qc_recon unreadable; republish firestore.rules)`:`QC complete ✓`,!!qw);await loadData();window.showPage('my-work');
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;}}
};

// WP3c: the PO's instructions snapshot (from the PO document itself) for the typed boxes. Absent snapshot = {} so the
// printed data is exactly what it was before; the engine ignores anything that is not a list of maps.
function _jobInstrData(po){
  const i=po&&po.instructions;
  return(i&&typeof i==='object'&&!Array.isArray(i))?{instructions:i}:{};
}
// Embroidery job copy: single A4 page, outside the PO's two-page limit. Console-callable
// (no UI yet). Accepts a PO object or its fbKey.
window.generateEmbroideryJobPdf=function(poOrKey){
  const po=(typeof poOrKey==='string')?allPOs.find(p=>p.fbKey===poOrKey):poOrKey;
  if(!po){showToast('PO not found.',true);return;}
  if(typeof window.printDocument!=='function'){showToast('Print engine not loaded.',true);return;}
  return window.printDocument({type:'embroidery-job',filename:`${po.id}-embroidery-job.pdf`,data:{
    documentType:'Embroidery Job',documentNumber:po.id,id:po.id,poNumber:po.id,
    articleName:po.name||'',articleCode:po.code||'',productImage:po.imgFront||''
  ,..._jobInstrData(po)}});
};

// Printing job copy (step 2 of 3): same mapping as the embroidery copy; console-callable, no UI.
window.generatePrintingJobPdf=function(poOrKey){
  const po=(typeof poOrKey==='string')?allPOs.find(p=>p.fbKey===poOrKey):poOrKey;
  if(!po){showToast('PO not found.',true);return;}
  if(typeof window.printDocument!=='function'){showToast('Print engine not loaded.',true);return;}
  return window.printDocument({type:'printing-job',filename:`${po.id}-printing-job.pdf`,data:{
    documentType:'Printing Job',documentNumber:po.id,id:po.id,poNumber:po.id,
    articleName:po.name||'',articleCode:po.code||'',productImage:po.imgFront||''
  ,..._jobInstrData(po)}});
};

// Washing job copy (step 3 of 3). Urdu cannot go through jsPDF (see CLAUDE.md, Print design
// system > Fonts), so each Urdu line is rasterised HERE with the browser's own shaping (a 2D
// canvas + the self-hosted Jameel Noori Nastaleeq @font-face) and handed to the engine as a PNG.
// Any failure (no canvas, font not loaded) returns null and the sheet prints English only.
const _WASH_URDU={
  note:'کٹنگ سے پہلے مکمل کریں',
  fabric:'کپڑا \u2066100%\u2069 کاٹن ہے؟',
  rib:'ریب \u2066100%\u2069 کاٹن ہے؟',
  shrink:'کپڑے کی شرنکیج (سکڑنا) مکمل ہو چکی ہے؟'
};
const _WASH_URDU_PX=72;
async function _washRasterUrdu(text,px){
  try{
    if(typeof document==='undefined'||!document.createElement)return null;
    px=px||_WASH_URDU_PX;
    const spec='400 '+px+'px "Jameel Noori Nastaleeq"';
    if(document.fonts&&document.fonts.load){await document.fonts.load(spec,text);}
    if(!(document.fonts&&document.fonts.check&&document.fonts.check(spec,text)))return null;
    const cv=document.createElement('canvas'),cx=cv.getContext&&cv.getContext('2d');
    if(!cx)return null;
    cx.font=spec;cx.direction='rtl';cx.textAlign='right';cx.textBaseline='alphabetic';
    const m=cx.measureText(text);
    const asc=Math.ceil(m.actualBoundingBoxAscent||px),desc=Math.ceil(m.actualBoundingBoxDescent||px*.4);
    const left=Math.ceil(m.actualBoundingBoxLeft||0),right=Math.ceil(m.actualBoundingBoxRight||0);
    const pad=Math.ceil(px*.08);
    const w=Math.max(8,Math.max(left+right,Math.ceil(m.width))+2*pad),h=asc+desc+2*pad;
    if(!(w>8&&h>8&&w<6000&&h<2000))return null;
    cv.width=w;cv.height=h;
    cx.font=spec;cx.direction='rtl';cx.textAlign='right';cx.textBaseline='alphabetic';
    cx.fillStyle='#262626';
    cx.fillText(text,pad+Math.max(left,Math.ceil(m.width)),pad+asc);
    return {dataUrl:cv.toDataURL('image/png'),w:w,h:h,fontPx:px};
  }catch(e){return null;}
}
window.generateWashingJobPdf=async function(poOrKey){
  const po=(typeof poOrKey==='string')?allPOs.find(p=>p.fbKey===poOrKey):poOrKey;
  if(!po){showToast('PO not found.',true);return;}
  if(typeof window.printDocument!=='function'){showToast('Print engine not loaded.',true);return;}
  const urduImages={};
  for(const k of Object.keys(_WASH_URDU)){const im=await _washRasterUrdu(_WASH_URDU[k]);if(im)urduImages[k]=im;}
  return window.printDocument({type:'washing-job',filename:`${po.id}-washing-job.pdf`,data:{
    documentType:'Washing Job',documentNumber:po.id,id:po.id,poNumber:po.id,
    articleName:po.name||'',articleCode:po.code||'',productImage:po.imgFront||'',urduImages:urduImages
  }});
};

// The data the PO traveler is printed from (the ORDERED values). Shared by generatePOPdf and js/po-print.js.
function _poPdfData(po){
  const sizeOrder=['XS','S','M','L','XL','2XL'];
  const activeSizes=sizeOrder.filter(sz=>(po.sizes?.[sz]||0)>0);
  const sizesStr=(activeSizes.length?activeSizes:sizeOrder).join('-');
  return{
    documentType:'Production Order',documentNumber:po.id,id:po.id,
    poNumber:po.id,startDate:po.startDate||'',pattern:(typeof window.ptnPoTravelerPattern==='function'?window.ptnPoTravelerPattern(po):'')||po.pattern||'',
    articleName:po.name||'',articleCode:po.code||'',sizes:sizesStr,
    fabricName:po.fabric||'',fabricCode:po.fabricCode||'',
    totalQty:po.qty!=null?String(po.qty):'',ratio:po.ratio||'',
    issuedBy:po.createdBy||'',issuedDate:po.createdAt||'',
    totalWeight:po.totalWeight||'',avgPerUnit:po.avgPerUnit||'',
    productImage:po.imgFront||'',notes:po.notes||''
  };
}
// ── Gate Pass ──
window.generatePOPdf=function(fbKey){
  const po=allPOs.find(p=>p.fbKey===fbKey);if(!po){showToast('PO not found.',true);return;}
  if(window.__usePrintEngine&&typeof window.printDocument==='function'){
    // WP6: js/po-print.js decides ordered vs actual cut, reads the bundles and records the print.
    if(typeof window.poPrintRun==='function')return window.poPrintRun(po,_poPdfData(po));
    return window.printDocument({type:'po',filename:`${po.id}.pdf`,data:_poPdfData(po)});
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

  // Notes — always red, never the default text color
  if(po.notes){
    y+=4;pdf.setFillColor(242,242,244);pdf.rect(M,y,W-M*2,7,'F');
    pdf.setFontSize(8);pdf.setFont(undefined,'bold');pdf.setTextColor(107,114,128);pdf.text('NOTES',M+2,y+5);
    y+=10;pdf.setTextColor(220,38,38);pdf.setFont(undefined,'bold');pdf.setFontSize(10);
    const notesLines=pdf.splitTextToSize(po.notes,W-M*2);
    notesLines.forEach(line=>{if(y>270){pdf.addPage();y=20;}pdf.text(line,M,y);y+=6;});
  }

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

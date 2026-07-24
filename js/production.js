/* Groovy Operations — production.js
   Plain global JS (NO modules). Loaded via <script src> AFTER fabric.js and
   BEFORE the bootstrap module. Shares the one global lexical scope with the
   other /js/*.js files (uses window-bridged Firebase globals db/doc/updateDoc/…
   and pos.js helpers poStatusOf/poCutBySize/etc).

   The new production spine (see PO_PRODUCTION_FLOW_PLAN.md):
     Phase 3 (this file, initial): Packing — Faizan receives finished pieces
     against a PO in batches (per size, dated, signed), reconciled against
     Uzaib's actual cut. A PO cannot complete until every size is fully
     received. Later phases add QC disposition, B-stock and stock transfers. */

// ── Packing (Faizan) ──────────────────────────────────────────────────────
let _packTab='receiving'; // 'receiving' | 'barcode'
let _packSel=null;   // fbKey of the PO being received into, or null for the list
let _packQ='';       // search query on the receiving list
let _bcSel=null;     // fbKey of the PO being barcoded/transferred, or null
let _bcQ='';         // search query on the ready-to-barcode list

// Reusable cut / transferred / balance bar (shared with Umair's pickup view).
function poTransferBar(po){
  const cut=poCutTotal(po),tr=poTransferredTotal(po),bal=Math.max(0,cut-tr);
  const pct=cut?Math.min(100,Math.round(tr/cut*100)):0;
  return`<div style="margin-top:8px">
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:3px">
      <span>cut <b style="color:var(--text)">${cut}</b> · transferred <b style="color:#2563eb">${tr}</b></span>
      <span>${bal?`<b style="color:#b45309">${bal}</b> balance`:'<b style="color:#16a34a">complete</b>'}</span>
    </div>
    <div style="height:6px;background:#eef0f2;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${bal?'#2563eb':'#16a34a'};border-radius:4px"></div></div>
  </div>`;
}

// POs eligible for packing: released to production, actually cut, and not yet
// fully received. Tolerates legacy in-production POs that carry a cut breakdown.
function _packOpenPOs(){
  return (typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[]).filter(p=>
    poStatusOf(p)===PO_STATUS.IN_PRODUCTION && poCutTotal(p)>0 && !poFullyReceived(p)
  );
}

// Reusable cut / received / pending bar (shared by QC + managers in later phases).
function poReceiveBar(po){
  const cut=poCutTotal(po),rec=poReceivedTotal(po),pend=Math.max(0,cut-rec);
  const pct=cut?Math.min(100,Math.round(rec/cut*100)):0;
  return`<div style="margin-top:8px">
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:3px">
      <span>cut <b style="color:var(--text)">${cut}</b> · received <b style="color:#2563eb">${rec}</b></span>
      <span>${pend?`<b style="color:#b45309">${pend}</b> to receive`:'<b style="color:#16a34a">complete</b>'}</span>
    </div>
    <div style="height:6px;background:#eef0f2;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${pend?'#2563eb':'#16a34a'};border-radius:4px;transition:width .2s"></div></div>
  </div>`;
}

function renderPacking(){
  if(_packSel){const po=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>p.fbKey===_packSel);if(po)return _renderPackDetail(po);_packSel=null;}
  if(_bcSel){const po=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>p.fbKey===_bcSel);if(po)return _renderBarcodeDetail(po);_bcSel=null;}
  const recCount=_packOpenPOs().length;
  const bcCount=_bcOpenPOs().length;
  return`<div class="page-head"><div class="page-title">Packing</div><div class="page-sub">Receive finished pieces &amp; book stock transfers</div></div>
  <div class="gp-tabs">
    <button class="gp-tab${_packTab==='receiving'?' active':''}" onclick="window.packTab('receiving')">Receiving${recCount?` (${recCount})`:''}</button>
    <button class="gp-tab${_packTab==='barcode'?' active':''}" onclick="window.packTab('barcode')">Ready to Barcode${bcCount?` (${bcCount})`:''}</button>
  </div>
  <div id="pack-tab-content">${_packTab==='barcode'?_barcodeListHTML():_receivingListHTML()}</div>`;
}
window.packTab=function(tab){_packTab=tab;const m=document.getElementById('main-content');if(m&&currentPage==='packing')m.innerHTML=renderPacking();};

function _receivingListHTML(){
  const all=_packOpenPOs();
  const q=_packQ.trim().toLowerCase();
  const list=q?all.filter(p=>[p.id,p.name,p.code,p.fabric].some(v=>(v||'').toLowerCase().includes(q))):all;
  const totalPend=all.reduce((a,p)=>a+Math.max(0,poCutTotal(p)-poReceivedTotal(p)),0);
  return`<div style="font-size:12px;color:var(--muted);margin-bottom:10px">${all.length} PO${all.length!==1?'s':''} awaiting receipt · ${totalPend} pcs to receive</div>
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <input id="pack-search" placeholder="Search PO number, article, fabric…" value="${_gpEsc(_packQ)}" oninput="window.packSetSearch(this.value)" style="flex:1;min-width:180px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;outline:none">
  </div>
  ${list.length?list.map(p=>_packListCard(p)).join(''):`<div class="empty" style="padding:28px;text-align:center">${all.length?'No POs match your search.':'Nothing to receive right now. Cut lots appear here once a PO is released and cut.'}</div>`}
  <div style="height:80px"></div>`;
}

function _packListCard(p){
  return`<div class="po-row" onclick="window.packOpen('${p.fbKey}')" style="align-items:stretch">
    <div class="po-img">${p.imgFront?`<img src="${p.imgFront}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`:'<span style="font-size:9px;color:#ccc">No img</span>'}</div>
    <div class="po-info" style="flex:1">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="po-num">${p.id}</span><span style="font-size:11px;color:var(--muted)">${_gpEsc(p.code||'')}</span></div>
      <div class="po-name">${_gpEsc(p.name||'—')}</div>
      ${poReceiveBar(p)}
    </div>
    <div class="po-arrow">›</div>
  </div>`;
}

// Detail: per-size receive table + append-only batch history.
function _renderPackDetail(po){
  const cut=poCutBySize(po),rec=poReceivedBySize(po);
  const sizes=PO_FLOW_SIZES.filter(sz=>(cut[sz]||0)>0||(rec[sz]||0)>0);
  const rows=sizes.map(sz=>{
    const c=cut[sz]||0,r=rec[sz]||0,pend=Math.max(0,c-r);
    return`<tr style="border-bottom:1px solid #f5f5f5">
      <td style="padding:9px 8px;font-weight:700">${sz}</td>
      <td style="padding:9px 8px;text-align:center">${c}</td>
      <td style="padding:9px 8px;text-align:center;color:#2563eb;font-weight:600">${r}</td>
      <td style="padding:9px 8px;text-align:center;font-weight:700;color:${pend?'#b45309':'#16a34a'}">${pend||'✓'}</td>
      <td style="padding:9px 8px;text-align:center"><input id="pack-in-${sz}" type="number" min="0" ${pend?`max="${pend}"`:''} placeholder="0" ${pend?'':'disabled'} style="width:72px;padding:7px 8px;border:1px solid var(--border);border-radius:7px;font-size:14px;text-align:center;font-family:inherit"></td>
    </tr>`;
  }).join('');
  const receipts=(po.packingReceipts||[]).slice();
  const groups={};
  receipts.forEach(e=>{(groups[e.receiptId]=groups[e.receiptId]||{ts:e.ts,by:e.by,items:[]}).items.push(e);});
  const history=Object.keys(groups).sort((a,b)=>(groups[b].ts||'').localeCompare(groups[a].ts||'')).map(rid=>{
    const g=groups[rid];const tot=g.items.reduce((a,e)=>a+(Number(e.qty)||0),0);
    const when=g.ts?new Date(g.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
    return`<div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:#fafafa">
      <div style="display:flex;justify-content:space-between;font-size:12px"><span style="font-weight:700">${tot} pcs</span><span style="color:var(--muted)">${when} · ${_gpEsc(g.by||'')}</span></div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px">${g.items.map(e=>`${_gpEsc(e.size)}×${e.qty}`).join(' · ')}</div>
    </div>`;
  }).join('');
  const fully=poFullyReceived(po);
  return`<button class="back-btn" onclick="window.packBack()">← Back to receiving</button>
  <div class="page-head"><div class="page-title">${po.id} — Receive</div><div class="page-sub">${_gpEsc(po.name||'—')} · ${_gpEsc(po.code||'')}</div></div>
  <div class="card">${poReceiveBar(po)}</div>
  <div class="card"><div class="card-title">Received quantity by size ${fully?'<span style="color:#16a34a;font-weight:700;font-size:12px">· fully received</span>':''}</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#fafafa">
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--muted)">Size</th>
        <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">Cut</th>
        <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">Received</th>
        <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">Pending</th>
        <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">Receive now</th>
      </tr></thead><tbody>${rows||'<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--muted)">No cut data on this PO.</td></tr>'}</tbody>
    </table></div>
    ${fully?'':`<button class="mark-done-btn" id="pack-record-btn" style="margin-top:12px" onclick="window.packRecord('${po.fbKey}')">Record receipt ✓</button>`}
  </div>
  <div class="card"><div class="card-title">Batch history <span style="font-weight:400;color:var(--muted);font-size:11px">${receipts.length} entr${receipts.length===1?'y':'ies'}</span></div>
    ${history||'<div class="empty" style="padding:14px;text-align:center">No receipts yet.</div>'}
  </div>
  <div style="height:80px"></div>`;
}

// ── Handlers ──
window.packSetSearch=function(v){
  _packQ=v||'';
  clearTimeout(window._packSearchTo);
  window._packSearchTo=setTimeout(()=>{
    const m=document.getElementById('main-content');
    if(m&&currentPage==='packing'){m.innerHTML=renderPacking();const i=document.getElementById('pack-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}}
  },160);
};
window.packOpen=function(fbKey){_packSel=fbKey;const m=document.getElementById('main-content');if(m)m.innerHTML=renderPacking();};
window.packBack=function(){_packSel=null;const m=document.getElementById('main-content');if(m)m.innerHTML=renderPacking();};

// Append a received batch (one entry per non-zero size, sharing a receiptId,
// stamped with time + who). Read-modify-write from the in-memory PO — packing
// is a single-desk operation, so there's no concurrent-writer risk.
window.packRecord=async function(fbKey){
  const po=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>p.fbKey===fbKey);
  if(!po){showToast('PO not found.',true);return;}
  const cut=poCutBySize(po),rec=poReceivedBySize(po);
  const entries=[];let over=false;
  PO_FLOW_SIZES.forEach(sz=>{
    const el=document.getElementById('pack-in-'+sz);if(!el)return;
    const q=parseInt(el.value)||0;if(q<=0)return;
    if(q>Math.max(0,(cut[sz]||0)-(rec[sz]||0)))over=true;
    entries.push({size:sz,qty:q});
  });
  if(!entries.length){showToast('Enter at least one received quantity.',true);return;}
  if(over&&!confirm('One or more sizes exceed the pending quantity. Record anyway?'))return;
  const btn=document.getElementById('pack-record-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const ts=new Date().toISOString();
    const receiptId='RCV-'+Date.now();
    const newEntries=entries.map(e=>({id:receiptId+'-'+e.size,receiptId,size:e.size,qty:e.qty,ts,by:session.name}));
    const merged=(po.packingReceipts||[]).concat(newEntries);
    await updateDoc(doc(db,'pos',fbKey),{packingReceipts:merged});
    await logActivity('Packing receipt',`${po.id} — ${entries.map(e=>e.size+'×'+e.qty).join(', ')} received by ${session.name}`).catch(()=>{});
    showToast(`Receipt recorded ✓ — ${entries.reduce((a,e)=>a+e.qty,0)} pcs`);
    await loadData();
    if(currentPage==='packing'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderPacking();}
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent='Record receipt ✓';}}
};

// ── Ready to Barcode / Stock Transfer (Faizan) ────────────────────────────
// QC-passed (barcode-ready) pieces are scanned/counted and booked into a Stock
// Transfer receipt (PDF). transferred is tracked per size on the PO so the
// cut→transferred balance closes out. See PO_PRODUCTION_FLOW_PLAN.md §4.7.
function poToBarcodeBySize(po){
  const ready=qcBarcodeReadyBySize(po),tr=poTransferredBySize(po),out={};
  PO_FLOW_SIZES.forEach(sz=>{const v=Math.max(0,(ready[sz]||0)-(tr[sz]||0));if(v)out[sz]=v;});
  return out;
}
function _bcOpenPOs(){
  return (typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[]).filter(p=>_mapTotal(poToBarcodeBySize(p))>0);
}
function _barcodeListHTML(){
  const all=_bcOpenPOs();
  const q=_bcQ.trim().toLowerCase();
  const list=q?all.filter(p=>[p.id,p.name,p.code,p.fabric].some(v=>(v||'').toLowerCase().includes(q))):all;
  const totalRdy=all.reduce((a,p)=>a+_mapTotal(poToBarcodeBySize(p)),0);
  return`<div style="font-size:12px;color:var(--muted);margin-bottom:10px">${all.length} PO${all.length!==1?'s':''} · ${totalRdy} pcs ready to barcode &amp; transfer</div>
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <input id="bc-search" placeholder="Search PO number, article…" value="${_gpEsc(_bcQ)}" oninput="window.bcSetSearch(this.value)" style="flex:1;min-width:180px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;outline:none">
  </div>
  ${list.length?list.map(p=>_barcodeListCard(p)).join(''):`<div class="empty" style="padding:28px;text-align:center">${all.length?'No POs match your search.':'Nothing ready to transfer. QC-passed pieces appear here.'}</div>`}
  <div style="height:80px"></div>`;
}
function _barcodeListCard(p){
  const rdy=_mapTotal(poToBarcodeBySize(p));
  return`<div class="po-row" onclick="window.bcOpen('${p.fbKey}')" style="align-items:stretch">
    <div class="po-img">${p.imgFront?`<img src="${p.imgFront}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`:'<span style="font-size:9px;color:#ccc">No img</span>'}</div>
    <div class="po-info" style="flex:1">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="po-num">${p.id}</span><span style="font-size:11px;color:var(--muted)">${_gpEsc(p.code||'')}</span></div>
      <div class="po-name">${_gpEsc(p.name||'—')}</div>
      <div style="margin-top:6px"><span style="font-size:11px;font-weight:700;color:#16a34a;background:#dcfce7;padding:2px 8px;border-radius:6px">${rdy} ready</span></div>
    </div>
    <div class="po-arrow">›</div>
  </div>`;
}
function _renderBarcodeDetail(po){
  const ready=qcBarcodeReadyBySize(po),tr=poTransferredBySize(po),avail=poToBarcodeBySize(po);
  const sizes=PO_FLOW_SIZES.filter(sz=>(ready[sz]||0)>0||(tr[sz]||0)>0);
  const rows=sizes.map(sz=>{
    const rd=ready[sz]||0,t=tr[sz]||0,a=avail[sz]||0;
    return`<tr style="border-bottom:1px solid #f5f5f5">
      <td style="padding:9px 8px;font-weight:700">${sz}</td>
      <td style="padding:9px 8px;text-align:center">${rd}</td>
      <td style="padding:9px 8px;text-align:center;color:#2563eb;font-weight:600">${t}</td>
      <td style="padding:9px 8px;text-align:center;font-weight:700;color:${a?'#16a34a':'var(--muted)'}">${a||'✓'}</td>
      <td style="padding:9px 8px;text-align:center"><input id="bc-in-${sz}" type="number" min="0" ${a?`max="${a}"`:''} placeholder="0" ${a?'':'disabled'} style="width:72px;padding:7px 8px;border:1px solid var(--border);border-radius:7px;font-size:14px;text-align:center;font-family:inherit"></td>
    </tr>`;
  }).join('');
  const totalAvail=_mapTotal(avail);
  const transfers=(po.stockTransfers||[]);
  const tGroups={};
  transfers.forEach(e=>{(tGroups[e.transferId]=tGroups[e.transferId]||{ts:e.ts,by:e.by,items:[]}).items.push(e);});
  const history=Object.keys(tGroups).sort((a,b)=>(tGroups[b].ts||'').localeCompare(tGroups[a].ts||'')).map(tid=>{
    const g=tGroups[tid];const tot=g.items.reduce((a,e)=>a+(Number(e.qty)||0),0);
    const when=g.ts?new Date(g.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
    return`<div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:#fafafa">
      <div style="display:flex;justify-content:space-between;font-size:12px"><span style="font-weight:700">${_gpEsc(tid)} · ${tot} pcs</span><span style="color:var(--muted)">${when} · ${_gpEsc(g.by||'')}</span></div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px">${g.items.map(e=>`${_gpEsc(e.size)}×${e.qty}`).join(' · ')}</div>
    </div>`;
  }).join('');
  return`<button class="back-btn" onclick="window.bcBack()">← Back to Ready to Barcode</button>
  <div class="page-head"><div class="page-title">${po.id} — Transfer</div><div class="page-sub">${_gpEsc(po.name||'—')} · ${_gpEsc(po.code||'')}</div></div>
  <div class="card">${poTransferBar(po)}</div>
  <div class="card"><div style="font-size:12px;color:var(--muted)">Scan the already-barcoded pieces (ERP / SKU) and enter the counted quantity per size, then book the stock transfer.</div></div>
  <div class="card"><div class="card-title">Ready to barcode ${totalAvail?'':'<span style="color:#16a34a;font-weight:700;font-size:12px">· all transferred</span>'}</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#fafafa">
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--muted)">Size</th>
        <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">Ready</th>
        <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">Transferred</th>
        <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">To transfer</th>
        <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">Scan qty</th>
      </tr></thead><tbody>${rows||'<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--muted)">Nothing to transfer.</td></tr>'}</tbody>
    </table></div>
    ${totalAvail?`<button class="mark-done-btn" id="bc-book-btn" style="margin-top:12px" onclick="window.bookTransfer('${po.fbKey}')">Book stock transfer &amp; print ✓</button>`:''}
  </div>
  <div class="card"><div class="card-title">Transfer history <span style="font-weight:400;color:var(--muted);font-size:11px">${Object.keys(tGroups).length} transfer(s)</span></div>
    ${history||'<div class="empty" style="padding:14px;text-align:center">No transfers booked yet.</div>'}
  </div>
  <div style="height:80px"></div>`;
}
window.bcSetSearch=function(v){
  _bcQ=v||'';
  clearTimeout(window._bcSearchTo);
  window._bcSearchTo=setTimeout(()=>{
    const m=document.getElementById('main-content');
    if(m&&currentPage==='packing'){m.innerHTML=renderPacking();const i=document.getElementById('bc-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}}
  },160);
};
window.bcOpen=function(fbKey){_bcSel=fbKey;const m=document.getElementById('main-content');if(m)m.innerHTML=renderPacking();};
window.bcBack=function(){_bcSel=null;const m=document.getElementById('main-content');if(m)m.innerHTML=renderPacking();};
window.bookTransfer=async function(fbKey){
  const po=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>p.fbKey===fbKey);
  if(!po){showToast('PO not found.',true);return;}
  const avail=poToBarcodeBySize(po);
  const entries=[];let over=false;
  PO_FLOW_SIZES.forEach(sz=>{const el=document.getElementById('bc-in-'+sz);if(!el)return;const q=parseInt(el.value)||0;if(q<=0)return;if(q>(avail[sz]||0))over=true;entries.push({size:sz,qty:q});});
  if(!entries.length){showToast('Enter at least one quantity.',true);return;}
  if(over){showToast('A size exceeds the available ready quantity.',true);return;}
  const btn=document.getElementById('bc-book-btn');if(btn){btn.disabled=true;btn.textContent='Booking…';}
  try{
    const n=await getNextId('stock_transfer');
    const transferId='STN-'+String(n).padStart(3,'0');
    const ts=new Date().toISOString();
    const newEntries=entries.map(e=>({id:transferId+'-'+e.size,transferId,size:e.size,qty:e.qty,ts,by:session.name}));
    const merged=((po.stockTransfers)||[]).concat(newEntries);
    const total=entries.reduce((a,e)=>a+e.qty,0);
    await updateDoc(doc(db,'pos',fbKey),{stockTransfers:merged});
    await setDoc(doc(db,'stock_transfers',transferId),{id:transferId,poId:po.id,poName:po.name||'',productCode:po.code||'',items:entries,total,by:session.name,ts,status:'booked'});
    await logActivity('Stock transfer',`${transferId} — ${po.id} ${entries.map(e=>e.size+'×'+e.qty).join(', ')} by ${session.name}`).catch(()=>{});
    if(typeof printDocument==='function'){
      try{printDocument({type:'stock-transfer',data:{id:transferId,documentNumber:transferId,poId:po.id,poName:po.name||'',productCode:po.code||'',items:entries,total,fromLabel:'Packing (Faizan)',toLabel:'Warehouse',issuedBy:session.name},filename:`stock-transfer-${transferId}.pdf`});}catch(_pe){console.warn('[production] transfer print failed',_pe);}
    }
    // Umair notification is wired in Phase 7.
    showToast(`${transferId} booked ✓ — ${total} pcs`);
    await loadData();
    if(currentPage==='packing'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderPacking();}
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent='Book stock transfer & print ✓';}}
};

// ── QC Disposition (Haris) ────────────────────────────────────────────────
// Every received piece is accounted for. Initial disposition splits pending
// pieces into passed / rafu / washing / alteration / bstock (conservation:
// the split can never exceed what's still pending QC). rafu/washing/alteration
// are rework buckets that later resolve to Barcode (fixed) or B-stock (fails).
// Two terminal pools per size: barcode-ready (= passed + rework→barcode) and
// bstock (= bstock + rework→bstock). See PO_PRODUCTION_FLOW_PLAN.md §4.5.
const QC_BUCKETS=[
  {key:'passed',    label:'QC Passed', color:'#16a34a'},
  {key:'rafu',      label:'Rafu',      color:'#d97706'},
  {key:'washing',   label:'Washing',   color:'#0891b2'},
  {key:'alteration',label:'Alteration',color:'#7c3aed'},
  {key:'bstock',    label:'B-stock',   color:'#dc2626'},
];
let _qcSel=null;   // fbKey of the PO being dispositioned, or null for the list
let _qcQ='';       // search on the QC list
let _qcSize='';    // selected size for the disposition form
let _qcRwSize='';  // selected size for the rework-resolution form

function _qcSum(po){
  const m={};
  ((po&&po.qcDispositions)||[]).forEach(e=>{
    if(!e||!e.size||!e.kind)return;
    (m[e.size]=m[e.size]||{})[e.kind]=(m[e.size][e.kind]||0)+(Number(e.qty)||0);
  });
  return m;
}
function _qz(m,size,kind){return (m[size]&&m[size][kind])||0;}
// QC'd (initial disposition) per size = passed+rafu+washing+alteration+bstock.
function qcDoneBySize(po){
  const m=_qcSum(po),out={};
  PO_FLOW_SIZES.forEach(sz=>{const v=_qz(m,sz,'passed')+_qz(m,sz,'rafu')+_qz(m,sz,'washing')+_qz(m,sz,'alteration')+_qz(m,sz,'bstock');if(v)out[sz]=v;});
  return out;
}
function qcPendingBySize(po){
  const rec=poReceivedBySize(po),done=qcDoneBySize(po),out={};
  PO_FLOW_SIZES.forEach(sz=>{const v=Math.max(0,(rec[sz]||0)-(done[sz]||0));if(v)out[sz]=v;});
  return out;
}
function qcInReworkBySize(po){
  const m=_qcSum(po),out={};
  PO_FLOW_SIZES.forEach(sz=>{const init=_qz(m,sz,'rafu')+_qz(m,sz,'washing')+_qz(m,sz,'alteration');const res=_qz(m,sz,'rework_to_barcode')+_qz(m,sz,'rework_to_bstock');const v=Math.max(0,init-res);if(v)out[sz]=v;});
  return out;
}
// Barcode-ready pool per size = passed + rework→barcode (Phase 6 nets off transfers).
function qcBarcodeReadyBySize(po){
  const m=_qcSum(po),out={};
  PO_FLOW_SIZES.forEach(sz=>{const v=_qz(m,sz,'passed')+_qz(m,sz,'rework_to_barcode');if(v)out[sz]=v;});
  return out;
}
// B-stock generated per size = bstock + rework→bstock (Phase 5 assigns cartons).
function qcBstockBySize(po){
  const m=_qcSum(po),out={};
  PO_FLOW_SIZES.forEach(sz=>{const v=_qz(m,sz,'bstock')+_qz(m,sz,'rework_to_bstock');if(v)out[sz]=v;});
  return out;
}
function _mapTotal(m){return Object.values(m||{}).reduce((a,n)=>a+(Number(n)||0),0);}

function _qcOpenPOs(){
  return (typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[]).filter(p=>
    poStatusOf(p)===PO_STATUS.IN_PRODUCTION && poReceivedTotal(p)>0 &&
    (_mapTotal(qcPendingBySize(p))>0 || _mapTotal(qcInReworkBySize(p))>0)
  );
}

function renderQCDisposition(){
  if(_qcSel){const po=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>p.fbKey===_qcSel);if(po)return _renderQCDetail(po);_qcSel=null;}
  return _renderQCList();
}
function _renderQCList(){
  const all=_qcOpenPOs();
  const q=_qcQ.trim().toLowerCase();
  const list=q?all.filter(p=>[p.id,p.name,p.code,p.fabric].some(v=>(v||'').toLowerCase().includes(q))):all;
  const totalPend=all.reduce((a,p)=>a+_mapTotal(qcPendingBySize(p)),0);
  const totalRw=all.reduce((a,p)=>a+_mapTotal(qcInReworkBySize(p)),0);
  return`<div class="page-head"><div class="page-title">QC — Disposition</div><div class="page-sub">${all.length} PO${all.length!==1?'s':''} · ${totalPend} pending QC${totalRw?` · ${totalRw} in rework`:''}</div></div>
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <input id="qc-search" placeholder="Search PO number, article, fabric…" value="${_gpEsc(_qcQ)}" oninput="window.qcSetSearch(this.value)" style="flex:1;min-width:180px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;outline:none">
  </div>
  ${list.length?list.map(p=>_qcListCard(p)).join(''):`<div class="empty" style="padding:28px;text-align:center">${all.length?'No POs match your search.':'Nothing awaiting QC. Received pieces from Packing appear here.'}</div>`}
  <div style="height:80px"></div>`;
}
function _qcListCard(p){
  const pend=_mapTotal(qcPendingBySize(p)),rw=_mapTotal(qcInReworkBySize(p));
  return`<div class="po-row" onclick="window.qcOpen('${p.fbKey}')" style="align-items:stretch">
    <div class="po-img">${p.imgFront?`<img src="${p.imgFront}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`:'<span style="font-size:9px;color:#ccc">No img</span>'}</div>
    <div class="po-info" style="flex:1">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="po-num">${p.id}</span><span style="font-size:11px;color:var(--muted)">${_gpEsc(p.code||'')}</span></div>
      <div class="po-name">${_gpEsc(p.name||'—')}</div>
      <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
        ${pend?`<span style="font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;padding:2px 8px;border-radius:6px">${pend} to QC</span>`:''}
        ${rw?`<span style="font-size:11px;font-weight:700;color:#0891b2;background:#ecfeff;padding:2px 8px;border-radius:6px">${rw} in rework</span>`:''}
      </div>
    </div>
    <div class="po-arrow">›</div>
  </div>`;
}
function _renderQCDetail(po){
  const rec=poReceivedBySize(po),pend=qcPendingBySize(po),rw=qcInReworkBySize(po);
  const bc=qcBarcodeReadyBySize(po),bs=qcBstockBySize(po);
  const sizes=PO_FLOW_SIZES.filter(sz=>(rec[sz]||0)>0);
  // Reconciliation table
  const recRows=sizes.map(sz=>`<tr style="border-bottom:1px solid #f5f5f5">
    <td style="padding:8px;font-weight:700">${sz}</td>
    <td style="padding:8px;text-align:center">${rec[sz]||0}</td>
    <td style="padding:8px;text-align:center;font-weight:700;color:${(pend[sz]||0)?'#b45309':'#16a34a'}">${pend[sz]||'✓'}</td>
    <td style="padding:8px;text-align:center;color:#0891b2">${(rw[sz]||0)||'—'}</td>
    <td style="padding:8px;text-align:center;color:#16a34a;font-weight:600">${bc[sz]||0}</td>
    <td style="padding:8px;text-align:center;color:#dc2626;font-weight:600">${bs[sz]||0}</td>
  </tr>`).join('');
  // Disposition form (selected size)
  const pendSizes=PO_FLOW_SIZES.filter(sz=>(pend[sz]||0)>0);
  if(_qcSize&&!pendSizes.includes(_qcSize))_qcSize='';
  if(!_qcSize&&pendSizes.length)_qcSize=pendSizes[0];
  const dispPend=_qcSize?(pend[_qcSize]||0):0;
  const dispForm=pendSizes.length?`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <label style="font-size:12px;color:var(--muted)">Size</label>
      <select id="qc-size" onchange="window.qcPickSize(this.value)" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px">
        ${pendSizes.map(sz=>`<option value="${sz}"${sz===_qcSize?' selected':''}>${sz} — ${pend[sz]} pending</option>`).join('')}
      </select>
      <span style="font-size:12px;color:var(--muted)">Pending: <b style="color:#b45309">${dispPend}</b></span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px">
      ${QC_BUCKETS.map(b=>`<div>
        <label style="font-size:11px;font-weight:600;color:${b.color};display:block;margin-bottom:3px">${b.label}</label>
        <input id="qc-in-${b.key}" type="number" min="0" max="${dispPend}" placeholder="0" oninput="window.qcCalcRemain(${dispPend})" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:7px;font-size:14px;text-align:center;font-family:inherit;box-sizing:border-box">
      </div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--muted)">Unassigned: <b id="qc-remain" style="color:#b45309">${dispPend}</b></span>
      <button class="mark-done-btn" id="qc-record-btn" style="width:auto;padding:9px 18px" onclick="window.qcRecord('${po.fbKey}')">Record disposition ✓</button>
    </div>`:'<div class="empty" style="padding:12px;text-align:center">All received pieces have been QC-dispositioned.</div>';
  // Rework-resolution form
  const rwSizes=PO_FLOW_SIZES.filter(sz=>(rw[sz]||0)>0);
  if(_qcRwSize&&!rwSizes.includes(_qcRwSize))_qcRwSize='';
  if(!_qcRwSize&&rwSizes.length)_qcRwSize=rwSizes[0];
  const rwPend=_qcRwSize?(rw[_qcRwSize]||0):0;
  const rwForm=rwSizes.length?`
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label style="font-size:12px;color:var(--muted)">Size</label>
      <select id="qc-rw-size" onchange="window.qcPickRwSize(this.value)" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px">
        ${rwSizes.map(sz=>`<option value="${sz}"${sz===_qcRwSize?' selected':''}>${sz} — ${rw[sz]} in rework</option>`).join('')}
      </select>
      <input id="qc-rw-qty" type="number" min="0" max="${rwPend}" placeholder="qty" style="width:80px;padding:8px;border:1px solid var(--border);border-radius:7px;font-size:14px;text-align:center;font-family:inherit">
      <button class="btn-outline" style="width:auto;padding:8px 14px;margin:0;color:#16a34a;border-color:#86efac" onclick="window.qcResolveRework('${po.fbKey}','barcode')">→ Barcode (fixed)</button>
      <button class="btn-outline" style="width:auto;padding:8px 14px;margin:0;color:#dc2626;border-color:#fca5a5" onclick="window.qcResolveRework('${po.fbKey}','bstock')">→ B-stock</button>
    </div>`:'<div class="empty" style="padding:12px;text-align:center">No pieces in rework.</div>';

  return`<button class="back-btn" onclick="window.qcBack()">← Back to QC list</button>
  <div class="page-head"><div class="page-title">${po.id} — QC</div><div class="page-sub">${_gpEsc(po.name||'—')} · ${_gpEsc(po.code||'')}</div></div>
  <div class="card">${poReceiveBar(po)}</div>
  <div class="card"><div class="card-title">Reconciliation by size</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr style="background:#fafafa">
        <th style="padding:8px;text-align:left;font-size:10.5px;text-transform:uppercase;color:var(--muted)">Size</th>
        <th style="padding:8px;text-align:center;font-size:10.5px;text-transform:uppercase;color:var(--muted)">Recv</th>
        <th style="padding:8px;text-align:center;font-size:10.5px;text-transform:uppercase;color:var(--muted)">Pend QC</th>
        <th style="padding:8px;text-align:center;font-size:10.5px;text-transform:uppercase;color:var(--muted)">Rework</th>
        <th style="padding:8px;text-align:center;font-size:10.5px;text-transform:uppercase;color:var(--muted)">Barcode</th>
        <th style="padding:8px;text-align:center;font-size:10.5px;text-transform:uppercase;color:var(--muted)">B-stock</th>
      </tr></thead><tbody>${recRows}</tbody>
    </table></div>
  </div>
  <div class="card"><div class="card-title">Disposition <span style="font-weight:400;color:var(--muted);font-size:11px">split pending pieces — total can't exceed pending</span></div>${dispForm}</div>
  <div class="card"><div class="card-title">Resolve rework <span style="font-weight:400;color:var(--muted);font-size:11px">rafu / washing / alteration → fixed or B-stock</span></div>${rwForm}</div>
  <div style="height:80px"></div>`;
}

// ── QC handlers ──
window.qcSetSearch=function(v){
  _qcQ=v||'';
  clearTimeout(window._qcSearchTo);
  window._qcSearchTo=setTimeout(()=>{
    const m=document.getElementById('main-content');
    if(m&&currentPage==='qc-disposition'){m.innerHTML=renderQCDisposition();const i=document.getElementById('qc-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}}
  },160);
};
window.qcOpen=function(fbKey){_qcSel=fbKey;_qcSize='';_qcRwSize='';const m=document.getElementById('main-content');if(m)m.innerHTML=renderQCDisposition();};
window.qcBack=function(){_qcSel=null;const m=document.getElementById('main-content');if(m)m.innerHTML=renderQCDisposition();};
window.qcPickSize=function(sz){_qcSize=sz;const m=document.getElementById('main-content');if(m)m.innerHTML=renderQCDisposition();};
window.qcPickRwSize=function(sz){_qcRwSize=sz;const m=document.getElementById('main-content');if(m)m.innerHTML=renderQCDisposition();};
window.qcCalcRemain=function(pending){
  let sum=0;QC_BUCKETS.forEach(b=>{sum+=parseInt(document.getElementById('qc-in-'+b.key)?.value)||0;});
  const el=document.getElementById('qc-remain');const btn=document.getElementById('qc-record-btn');
  const rem=pending-sum;
  if(el){el.textContent=rem;el.style.color=rem<0?'#dc2626':rem===0?'#16a34a':'#b45309';}
  if(btn){btn.disabled=(sum<=0||rem<0);btn.style.opacity=(sum<=0||rem<0)?'.5':'1';}
};
window.qcRecord=async function(fbKey){
  const po=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>p.fbKey===fbKey);
  if(!po){showToast('PO not found.',true);return;}
  const size=_qcSize;if(!size){showToast('Pick a size.',true);return;}
  const pend=qcPendingBySize(po)[size]||0;
  const entries=[];let sum=0;
  QC_BUCKETS.forEach(b=>{const q=parseInt(document.getElementById('qc-in-'+b.key)?.value)||0;if(q>0){entries.push({kind:b.key,qty:q});sum+=q;}});
  if(!sum){showToast('Enter at least one quantity.',true);return;}
  if(sum>pend){showToast(`Total ${sum} exceeds pending ${pend}.`,true);return;}
  const btn=document.getElementById('qc-record-btn');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const ts=new Date().toISOString();const dispId='QCD-'+Date.now();
    const newEntries=entries.map(e=>({id:dispId+'-'+e.kind,dispId,size,kind:e.kind,qty:e.qty,ts,by:session.name}));
    const merged=((po.qcDispositions)||[]).concat(newEntries);
    await updateDoc(doc(db,'pos',fbKey),{qcDispositions:merged});
    await logActivity('QC disposition',`${po.id} ${size} — ${entries.map(e=>e.kind+'×'+e.qty).join(', ')} by ${session.name}`).catch(()=>{});
    showToast(`Disposition recorded ✓ — ${sum} pcs`);
    await loadData();
    if(currentPage==='qc-disposition'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderQCDisposition();}
  }catch(e){showToast('Error: '+e.message,true);if(btn){btn.disabled=false;btn.textContent='Record disposition ✓';}}
};
window.qcResolveRework=async function(fbKey,dest){
  const po=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>p.fbKey===fbKey);
  if(!po){showToast('PO not found.',true);return;}
  const size=_qcRwSize;if(!size){showToast('Pick a size.',true);return;}
  const avail=qcInReworkBySize(po)[size]||0;
  const qty=parseInt(document.getElementById('qc-rw-qty')?.value)||0;
  if(qty<=0){showToast('Enter a quantity.',true);return;}
  if(qty>avail){showToast(`Only ${avail} in rework for ${size}.`,true);return;}
  try{
    const ts=new Date().toISOString();const kind=dest==='barcode'?'rework_to_barcode':'rework_to_bstock';
    const rwrId='RWR-'+Date.now();
    const entry={id:rwrId,dispId:rwrId,size,kind,qty,ts,by:session.name};
    const merged=((po.qcDispositions)||[]).concat([entry]);
    await updateDoc(doc(db,'pos',fbKey),{qcDispositions:merged});
    await logActivity('QC rework resolved',`${po.id} ${size} — ${qty} → ${dest} by ${session.name}`).catch(()=>{});
    showToast(`${qty} ${size} resolved → ${dest==='barcode'?'Barcode':'B-stock'} ✓`);
    await loadData();
    if(currentPage==='qc-disposition'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderQCDisposition();}
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── B-stock carton inventory (Faizan / managers) ──────────────────────────
// The bstock pool generated at QC (qcBstockBySize) is boxed into numbered
// cartons, tagged PO · product · size, and later transferred out. Own
// collections (lazy-loaded): bstock_items (one doc per assignment) +
// bstock_cartons (carton meta + status). See PO_PRODUCTION_FLOW_PLAN.md §4.6.
let allBstockItems=[];
let allBstockCartons=[];
let _bstockLoaded=false;
let _bstockTab='unassigned';
async function loadBstockData(){
  try{
    const[iSnap,cSnap]=await Promise.all([
      getDocs(collection(db,'bstock_items')).catch(()=>({docs:[]})),
      getDocs(collection(db,'bstock_cartons')).catch(()=>({docs:[]}))
    ]);
    allBstockItems=iSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allBstockCartons=cSnap.docs.map(d=>({...d.data(),_id:d.id}));
    _bstockLoaded=true;
  }catch(e){console.warn('[production] bstock load failed',e);}
}
function bstockAssignedBySize(po){
  const out={};
  (allBstockItems||[]).forEach(it=>{if(it.poId===po.id&&it.size)out[it.size]=(out[it.size]||0)+(Number(it.qty)||0);});
  return out;
}
function bstockUnassignedBySize(po){
  const gen=qcBstockBySize(po),asn=bstockAssignedBySize(po),out={};
  PO_FLOW_SIZES.forEach(sz=>{const v=Math.max(0,(gen[sz]||0)-(asn[sz]||0));if(v)out[sz]=v;});
  return out;
}
function _bstockOpenPOs(){
  return (typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:[]).filter(p=>_mapTotal(bstockUnassignedBySize(p))>0);
}

function renderBstock(){
  const openCartons=allBstockCartons.filter(c=>c.status!=='transferred');
  const totalPcs=allBstockItems.reduce((a,it)=>a+(Number(it.qty)||0),0);
  const unas=_bstockOpenPOs().reduce((a,p)=>a+_mapTotal(bstockUnassignedBySize(p)),0);
  return`<div class="page-head"><div class="page-title">B-Stock Inventory</div><div class="page-sub">${totalPcs} pcs boxed · ${allBstockCartons.length} carton${allBstockCartons.length!==1?'s':''} · ${unas} unassigned</div></div>
  <div class="gp-tabs">
    <button class="gp-tab${_bstockTab==='unassigned'?' active':''}" onclick="window.bstockTab('unassigned')">Unassigned${unas?` (${unas})`:''}</button>
    <button class="gp-tab${_bstockTab==='cartons'?' active':''}" onclick="window.bstockTab('cartons')">Cartons${openCartons.length?` (${openCartons.length})`:''}</button>
  </div>
  <div id="bstock-tab-content">${_bstockTab==='cartons'?_bstockCartonsHTML():_bstockUnassignedHTML()}</div>
  <div style="height:80px"></div>`;
}
function _bstockCartonOptions(){
  const open=allBstockCartons.filter(c=>c.status!=='transferred').sort((a,b)=>(b.no||0)-(a.no||0));
  return`<option value="">Carton…</option>${open.map(c=>`<option value="${_gpEsc(c._id)}">${_gpEsc(c.id)}</option>`).join('')}<option value="__new__">+ New carton</option>`;
}
function _bstockUnassignedHTML(){
  const pos=_bstockOpenPOs();
  if(!pos.length)return'<div class="empty" style="padding:28px;text-align:center">No unassigned B-stock. Pieces marked B-stock at QC appear here to box.</div>';
  const canAssign=isPacking()||['owner','manager'].includes(session.role);
  return pos.map(po=>{
    const un=bstockUnassignedBySize(po);
    const rows=PO_FLOW_SIZES.filter(sz=>(un[sz]||0)>0).map(sz=>`<tr style="border-bottom:1px solid #f5f5f5">
      <td style="padding:8px;font-weight:700">${sz}</td>
      <td style="padding:8px;text-align:center;color:#dc2626;font-weight:700">${un[sz]}</td>
      ${canAssign?`<td style="padding:8px;text-align:right">
        <div style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <input id="bs-qty-${po.fbKey}-${sz}" type="number" min="1" max="${un[sz]}" placeholder="qty" style="width:64px;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:13px;text-align:center;font-family:inherit">
          <select id="bs-carton-${po.fbKey}-${sz}" style="padding:6px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit">${_bstockCartonOptions()}</select>
          <button class="btn-outline" style="width:auto;padding:6px 12px;margin:0" onclick="window.bstockAssign('${po.fbKey}','${sz}')">Box</button>
        </div></td>`:'<td></td>'}
    </tr>`).join('');
    return`<div class="card"><div class="card-title">${po.id} <span style="font-weight:400;color:var(--muted);font-size:12px">${_gpEsc(po.name||'')} · ${_gpEsc(po.code||'')}</span></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--muted)">Size</th><th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--muted)">Unassigned</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>`;
  }).join('');
}
function _bstockCartonsHTML(){
  if(!allBstockCartons.length)return'<div class="empty" style="padding:28px;text-align:center">No cartons yet. Box some B-stock from the Unassigned tab.</div>';
  const canTransfer=isPacking()||['owner','manager'].includes(session.role);
  const cartons=allBstockCartons.slice().sort((a,b)=>(b.no||0)-(a.no||0));
  return cartons.map(c=>{
    const items=allBstockItems.filter(it=>it.cartonId===c._id);
    const tot=items.reduce((a,it)=>a+(Number(it.qty)||0),0);
    const transferred=c.status==='transferred';
    return`<div class="card" style="${transferred?'opacity:.75':''}">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>${_gpEsc(c.id)} <span style="font-weight:400;color:var(--muted);font-size:12px">${tot} pcs · ${items.length} line${items.length!==1?'s':''}</span></span>
        <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;background:${transferred?'#f0f0f0':'#dcfce7'};color:${transferred?'var(--muted)':'#16a34a'}">${transferred?'Transferred':'Open'}</span>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="background:#fafafa"><th style="padding:7px;text-align:left;font-size:10.5px;text-transform:uppercase;color:var(--muted)">PO</th><th style="padding:7px;text-align:left;font-size:10.5px;text-transform:uppercase;color:var(--muted)">Article</th><th style="padding:7px;text-align:center;font-size:10.5px;text-transform:uppercase;color:var(--muted)">Size</th><th style="padding:7px;text-align:center;font-size:10.5px;text-transform:uppercase;color:var(--muted)">Qty</th><th style="padding:7px;text-align:left;font-size:10.5px;text-transform:uppercase;color:var(--muted)">By</th></tr></thead>
        <tbody>${items.map(it=>`<tr style="border-bottom:1px solid #f5f5f5"><td style="padding:7px;font-weight:600">${_gpEsc(it.poId||'')}</td><td style="padding:7px">${_gpEsc(it.productCode||it.article||'')}</td><td style="padding:7px;text-align:center;font-weight:700">${_gpEsc(it.size||'')}</td><td style="padding:7px;text-align:center;color:#dc2626;font-weight:700">${it.qty||0}</td><td style="padding:7px;color:var(--muted)">${_gpEsc(it.assignedBy||'')}</td></tr>`).join('')||'<tr><td colspan="5" style="padding:10px;text-align:center;color:var(--muted)">Empty carton</td></tr>'}</tbody>
      </table></div>
      ${(!transferred&&canTransfer&&items.length)?`<button class="mark-done-btn" style="width:auto;padding:8px 16px;margin-top:10px" onclick="window.bstockTransferCarton('${_gpEsc(c._id)}')">Transfer carton out →</button>`:''}
    </div>`;
  }).join('');
}

// ── B-stock handlers ──
window.bstockTab=function(tab){_bstockTab=tab;const m=document.getElementById('main-content');if(m&&currentPage==='bstock')m.innerHTML=renderBstock();};
window.bstockAssign=async function(fbKey,size){
  const po=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>p.fbKey===fbKey);if(!po){showToast('PO not found.',true);return;}
  const qty=parseInt(document.getElementById(`bs-qty-${fbKey}-${size}`)?.value)||0;
  const cartonSel=document.getElementById(`bs-carton-${fbKey}-${size}`)?.value||'';
  const unas=bstockUnassignedBySize(po)[size]||0;
  if(qty<=0){showToast('Enter a quantity.',true);return;}
  if(qty>unas){showToast(`Only ${unas} unassigned for ${size}.`,true);return;}
  if(!cartonSel){showToast('Choose or create a carton.',true);return;}
  try{
    let cartonId=cartonSel,cartonNo;
    if(cartonSel==='__new__'){
      const n=await getNextId('bstock_carton');
      cartonNo='CTN-'+String(n).padStart(3,'0');cartonId=cartonNo;
      await setDoc(doc(db,'bstock_cartons',cartonId),{id:cartonId,no:n,status:'open',createdBy:session.name,createdAt:new Date().toISOString(),ts:Date.now()});
    }else{const c=allBstockCartons.find(x=>x._id===cartonSel);cartonNo=c?c.id:cartonSel;}
    const itemId='BSI-'+Date.now();
    await setDoc(doc(db,'bstock_items',itemId),{id:itemId,poId:po.id,poName:po.name||'',productCode:po.code||'',article:po.code||'',size,qty,cartonId,cartonNo,assignedBy:session.name,assignedAt:new Date().toISOString(),transferred:false,ts:Date.now()});
    await logActivity('B-stock boxed',`${po.id} ${size}×${qty} → ${cartonNo} by ${session.name}`).catch(()=>{});
    showToast(`${qty} ${size} → ${cartonNo} ✓`);
    await loadBstockData();
    const m=document.getElementById('main-content');if(m&&currentPage==='bstock')m.innerHTML=renderBstock();
  }catch(e){showToast('Error: '+e.message,true);}
};
window.bstockTransferCarton=async function(cartonId){
  if(!confirm('Mark this carton as transferred out? This closes it.'))return;
  try{
    const items=allBstockItems.filter(it=>it.cartonId===cartonId&&!it.transferred);
    await updateDoc(doc(db,'bstock_cartons',cartonId),{status:'transferred',transferredAt:new Date().toISOString(),transferBy:session.name});
    for(const it of items){await updateDoc(doc(db,'bstock_items',it._id),{transferred:true,transferredAt:new Date().toISOString()});}
    await logActivity('B-stock carton transferred',`${cartonId} — ${items.length} line(s) by ${session.name}`).catch(()=>{});
    showToast(`${cartonId} transferred ✓`);
    await loadBstockData();
    const m=document.getElementById('main-content');if(m&&currentPage==='bstock')m.innerHTML=renderBstock();
  }catch(e){showToast('Error: '+e.message,true);}
};

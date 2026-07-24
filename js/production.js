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
let _packSel=null;   // fbKey of the PO being received into, or null for the list
let _packQ='';       // search query on the receiving list

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
  return _renderPackList();
}

function _renderPackList(){
  const all=_packOpenPOs();
  const q=_packQ.trim().toLowerCase();
  const list=q?all.filter(p=>[p.id,p.name,p.code,p.fabric].some(v=>(v||'').toLowerCase().includes(q))):all;
  const totalPend=all.reduce((a,p)=>a+Math.max(0,poCutTotal(p)-poReceivedTotal(p)),0);
  return`<div class="page-head"><div class="page-title">Packing — Receiving</div><div class="page-sub">${all.length} PO${all.length!==1?'s':''} awaiting receipt · ${totalPend} pcs to receive</div></div>
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

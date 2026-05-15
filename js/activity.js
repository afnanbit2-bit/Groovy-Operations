/* Groovy Operations — activity.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

async function loadActivity(){
  const m=document.getElementById('main-content');
  m.innerHTML='<div class="page-head"><div class="page-title">Activity Log</div></div><div class="empty">Loading…</div>';
  try{
    const snap=await getDocs(query(collection(db,'activity'),orderBy('ts','desc'),limit(150)));
    const items=snap.docs.map(d=>d.data());
    m.innerHTML=`<div class="page-head"><div class="page-title">Activity Log</div><div class="page-sub">${items.length} recent actions</div></div>
    <div class="card">${items.length?items.map(a=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #f5f5f5">
      <div style="width:28px;height:28px;border-radius:50%;background:var(--dark);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${(a.user||'?')[0].toUpperCase()}</div>
      <div style="flex:1"><div style="font-size:13px"><strong>${a.user||'?'}</strong> <span style="color:var(--muted)">— ${a.action||''}</span></div>
        <div style="font-size:11px;color:var(--muted)">${a.detail||''}</div>
        <div style="font-size:10px;color:#aaa;margin-top:1px">${a.ts?new Date(a.ts).toLocaleString('en-GB'):a.date||''}</div>
      </div></div>`).join(''):'<div class="empty">No activity yet.</div>'}
    </div><div style="height:80px"></div>`;
  }catch(e){m.innerHTML=`<div class="empty">Error: ${e.message}</div>`;}
}

// ── Users page ──

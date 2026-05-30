/* ═══════════════════════════════════════════════════════════════════════
   Shopify Inventory Intelligence — client-side dashboard
   Read-only: queries shopify_* Firestore collections, never writes.
   ═══════════════════════════════════════════════════════════════════════ */

let _siLoaded=false;
let _siProducts=[],_siOrders=[],_siLineItems=[],_siWeeklyCloses=[],_siSnapshot=null,_siPrevSnapshot=null,_siSyncMeta={};
let _siSkuSearch='',_siSkuSort='sold7d',_siSkuDir=-1,_siSection='overview';
let _siSkuLimit=200;        // SKU table page size; grows by 200 via Load more
let _siSeason='all';        // global season filter: 'all' | 'winter' | 'summer'
let _siSeasonMapCache=null; // { sku: 'winter'|'summer'|'all-season' }, rebuilt on data load
let _siLoadError=null;      // last load failure message; non-null → render error state, never zeros
let _siCollectionsLoaded=false; // collections fetched OK once → skip re-download on snapshot-only retry

// ── Data loader ─────────────────────────────────────────────────────
async function loadShopifyData(){
  _siLoadError=null;
  // Critical collection reads — fetch once, then skip on snapshot-only retries.
  if(!_siCollectionsLoaded){
    try{
      const [pSnap,oSnap,liSnap,wcSnap]=await Promise.all([
        getDocs(collection(db,'shopify_products')),
        getDocs(collection(db,'shopify_orders')),
        getDocs(collection(db,'shopify_line_items')),
        getDocs(query(collection(db,'shopify_weekly_closes'),orderBy('week_ending','desc'))),
      ]);
      _siProducts=[];pSnap.forEach(d=>{const o=d.data();o._id=d.id;_siProducts.push(o);});
      _siOrders=[];oSnap.forEach(d=>{const o=d.data();o._id=d.id;_siOrders.push(o);});
      _siLineItems=[];liSnap.forEach(d=>{const o=d.data();o._id=d.id;_siLineItems.push(o);});
      _siWeeklyCloses=[];wcSnap.forEach(d=>{const o=d.data();o._id=d.id;_siWeeklyCloses.push(o);});
      _siSeasonMapCache=null; // catalog changed → rebuild SKU→season map lazily
      _siCollectionsLoaded=true;
    }catch(err){
      _siLoadError=(err.message||String(err));
      return; // do NOT set _siLoaded — next visit retries
    }
  }

  const today=_siPktDate(0);
  const yesterday=_siPktDate(-1);
  const lastWeek=_siPktDate(-7);
  try{
    let snap=await getDoc(doc(db,'shopify_inventory_snapshots',today));
    if(!snap.exists())snap=await getDoc(doc(db,'shopify_inventory_snapshots',yesterday));
    if(snap.exists())_siSnapshot=snap.data();
  }catch(err){
    _siLoadError=(err.message||String(err));
    return; // snapshot read threw → surface error, retry next visit
  }
  try{
    const snap=await getDoc(doc(db,'shopify_inventory_snapshots',lastWeek));
    if(snap.exists())_siPrevSnapshot=snap.data();
  }catch(_){}

  if(!_siSnapshot){
    _siLoadError='Inventory snapshot unavailable (no snapshot for today or yesterday).';
    return; // do NOT set _siLoaded — next visit retries
  }

  try{
    const s1=await getDoc(doc(db,'shopify_sync_meta','catalog_sync'));
    const s2=await getDoc(doc(db,'shopify_sync_meta','order_backfill'));
    const s3=await getDoc(doc(db,'shopify_sync_meta','inventory_sync'));
    _siSyncMeta={catalog:s1.exists()?s1.data():{},orders:s2.exists()?s2.data():{},inventory:s3.exists()?s3.data():{}};
  }catch(_){}

  _siLoaded=true; // only when collections loaded AND snapshot present
}

// ── Helpers ──────────────────────────────────────────────────────────
function _siPktDate(off){const d=new Date(Date.now()+5*3600000);d.setDate(d.getDate()+(off||0));return d.toISOString().split('T')[0];}
function _siFmt(n){if(n==null)return'—';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return n.toLocaleString();}
function _siPKR(n){if(n==null)return'—';return'PKR '+n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0});}
function _siPct(n){if(n==null||isNaN(n))return'—';return(n*100).toFixed(1)+'%';}
function _siDaysAgo(iso){if(!iso)return null;const d=new Date(iso);const now=new Date();return Math.floor((now-d)/86400000);}

// ── Season tagging ───────────────────────────────────────────────────
// Products carry Shopify tags 'season:winter' / 'season:summer'. Anything
// with neither is year-round ('all-season') and shows in every view.
function _siSeasonOfTags(tags){
  if(!Array.isArray(tags))return'all-season';
  const lower=tags.map(t=>String(t).toLowerCase().trim());
  if(lower.includes('season:winter'))return'winter';
  if(lower.includes('season:summer'))return'summer';
  return'all-season';
}
// Does an item's season pass the active filter? Winter/Summer views always
// include year-round (untagged) items; 'all' includes everything.
function _siMatchSeason(season){
  if(_siSeason==='all')return true;
  if(season==='all-season')return true;
  return season===_siSeason;
}
// SKU → season map from the live catalog (cached per data load).
function _siSeasonMap(){
  if(_siSeasonMapCache)return _siSeasonMapCache;
  const m={};
  _siProducts.forEach(p=>{if(p.sku&&m[p.sku]===undefined)m[p.sku]=_siSeasonOfTags(p.tags);});
  _siSeasonMapCache=m;
  return m;
}
// Resolve a line item's season via the catalog (no SKU / unknown → year-round).
function _siItemSeason(li){const m=_siSeasonMap();return(li.sku&&m[li.sku])||'all-season';}

function _siLast7(){
  const d=new Date(Date.now()+5*3600000);d.setDate(d.getDate()-7);return d.toISOString().split('T')[0];
}
function _siLast30(){
  const d=new Date(Date.now()+5*3600000);d.setDate(d.getDate()-30);return d.toISOString().split('T')[0];
}

function _siRecentItems(days){
  const cutoff=_siPktDate(-days);
  return _siLineItems.filter(li=>li.order_created_at>=cutoff&&li.financial_status!=='refunded'&&_siMatchSeason(_siItemSeason(li)));
}

// ── Computed metrics ────────────────────────────────────────────────
function _siComputeMetrics(){
  const items7=_siRecentItems(7);
  const items30=_siRecentItems(30);
  const unitsSold7=items7.reduce((s,li)=>s+(li.quantity||0),0);
  const unitsSold30=items30.reduce((s,li)=>s+(li.quantity||0),0);
  const revenue7=items7.reduce((s,li)=>s+(li.quantity||0)*(li.price||0),0);

  let totalOnHand=0,totalValue=0;
  if(_siSnapshot&&_siSnapshot.items){
    const items=_siSnapshot.items;
    for(const invId in items){
      const vid=items[invId].variant_id;
      const prod=vid?_siProducts.find(p=>p._id===vid):null;
      // year-round when no catalog match, so unmatched stock still counts
      if(!_siMatchSeason(prod?_siSeasonOfTags(prod.tags):'all-season'))continue;
      const av=items[invId].available||0;
      totalOnHand+=av;
      if(prod)totalValue+=av*(prod.price||0);
    }
  }

  const sellThrough7=totalOnHand>0?(unitsSold7/(totalOnHand+unitsSold7)):null;
  const avgDailySales=unitsSold30/30;

  return{unitsSold7,unitsSold30,revenue7,totalOnHand,totalValue,sellThrough7,avgDailySales};
}

// ── SKU-level analytics ─────────────────────────────────────────────
function _siComputeSkuTable(){
  const items7=_siRecentItems(7);
  const items30=_siRecentItems(30);
  const allNonRefunded=_siLineItems.filter(li=>li.financial_status!=='refunded');

  const sold7Map={},sold30Map={},firstSold={},lastSold={},totalSoldMap={},refundMap={};

  allNonRefunded.forEach(li=>{
    const k=li.sku||'NO-SKU';
    totalSoldMap[k]=(totalSoldMap[k]||0)+(li.quantity||0);
    if(!firstSold[k]||li.order_created_at<firstSold[k])firstSold[k]=li.order_created_at;
    if(!lastSold[k]||li.order_created_at>lastSold[k])lastSold[k]=li.order_created_at;
  });

  _siLineItems.filter(li=>li.financial_status==='refunded').forEach(li=>{
    const k=li.sku||'NO-SKU';
    refundMap[k]=(refundMap[k]||0)+(li.quantity||0);
  });

  items7.forEach(li=>{const k=li.sku||'NO-SKU';sold7Map[k]=(sold7Map[k]||0)+(li.quantity||0);});
  items30.forEach(li=>{const k=li.sku||'NO-SKU';sold30Map[k]=(sold30Map[k]||0)+(li.quantity||0);});

  const invMap={};
  if(_siSnapshot&&_siSnapshot.items){
    for(const invId in _siSnapshot.items){
      const it=_siSnapshot.items[invId];
      if(it.sku)invMap[it.sku]=(invMap[it.sku]||0)+(it.available||0);
    }
  }
  const prevInvMap={};
  if(_siPrevSnapshot&&_siPrevSnapshot.items){
    for(const invId in _siPrevSnapshot.items){
      const it=_siPrevSnapshot.items[invId];
      if(it.sku)prevInvMap[it.sku]=(prevInvMap[it.sku]||0)+(it.available||0);
    }
  }

  const prodMap={};
  _siProducts.forEach(p=>{if(p.sku&&!prodMap[p.sku])prodMap[p.sku]=p;});

  const allSkus=new Set();
  Object.keys(sold7Map).forEach(k=>allSkus.add(k));
  Object.keys(sold30Map).forEach(k=>allSkus.add(k));
  Object.keys(invMap).forEach(k=>allSkus.add(k));
  _siProducts.forEach(p=>{if(p.sku)allSkus.add(p.sku);});

  const rows=[];
  allSkus.forEach(sku=>{
    const prod=prodMap[sku]||{};
    const onHand=invMap[sku]||0;
    const prevOnHand=prevInvMap[sku]||0;
    const s7=sold7Map[sku]||0;
    const s30=sold30Map[sku]||0;
    const dailyRate=s30/30;
    const daysLeft=dailyRate>0?Math.round(onHand/dailyRate):onHand>0?999:0;
    const sellThrough=onHand+s7>0?s7/(onHand+s7):null;
    const weeklyDelta=onHand-prevOnHand;
    const fs=firstSold[sku]||null;
    const ls=lastSold[sku]||null;
    const daysSinceLastSale=_siDaysAgo(ls);
    const refunds=refundMap[sku]||0;
    const reorderPoint=Math.ceil(dailyRate*14);
    const suggestedQty=dailyRate>0?Math.max(0,Math.ceil(dailyRate*30)-onHand):0;

    rows.push({
      sku,title:prod.product_title||'',color:prod.color||'',size:prod.size||'',
      productType:prod.product_type||'',needsReview:!!prod.needs_review,status:prod.status||'',
      tags:prod.tags||[],season:_siSeasonOfTags(prod.tags),
      onHand,prevOnHand,weeklyDelta,s7,s30,dailyRate,daysLeft,sellThrough,
      firstSold:fs,lastSold:ls,daysSinceLastSale,refunds,totalSold:totalSoldMap[sku]||0,
      price:prod.price||0,reorderPoint,suggestedQty,created_at:prod.created_at||''
    });
  });

  // Global season filter: drop off-season SKUs so every downstream view
  // (Needs Attention, Advanced, SKU table, size curve) is season-aware.
  return rows.filter(r=>_siMatchSeason(r.season));
}

// ── Needs Attention cards ───────────────────────────────────────────
function _siNeedsAttention(rows){
  const lowStock=rows.filter(r=>r.onHand>0&&r.daysLeft<=14&&r.daysLeft>0&&r.dailyRate>0.1).sort((a,b)=>a.daysLeft-b.daysLeft).slice(0,8);
  const deadStock=rows.filter(r=>r.onHand>5&&(r.daysSinceLastSale===null||r.daysSinceLastSale>60)).sort((a,b)=>(b.onHand*b.price)-(a.onHand*a.price)).slice(0,8);
  const highSellThrough=rows.filter(r=>r.sellThrough!==null&&r.sellThrough>0.4&&r.s7>=3).sort((a,b)=>b.sellThrough-a.sellThrough).slice(0,8);
  const promote=rows.filter(r=>r.onHand>20&&r.s7===0&&r.s30>0&&r.price>0).sort((a,b)=>(b.onHand*b.price)-(a.onHand*a.price)).slice(0,8);
  return{lowStock,deadStock,highSellThrough,promote};
}

// ── Selling pattern aggregators ─────────────────────────────────────
function _siByDimension(items,dim){
  const map={};
  items.forEach(li=>{
    let k=li[dim]||'Unknown';
    if(!k.trim())k='Unknown';
    map[k]=(map[k]||0)+(li.quantity||0);
  });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}

// ── By category, resolved against the CURRENT catalog ───────────────
// Line items store a product_type snapshot frozen at order-sync time, so
// historical sales collapse into 'Unknown'. Re-resolve each line item's
// category from the live catalog by SKU (fallback: the frozen line-item
// value, then 'Unknown'). Pure read — no data is mutated.
function _siByCategoryLive(items){
  const skuType={};
  _siProducts.forEach(p=>{ if(p.sku && skuType[p.sku]===undefined) skuType[p.sku]=p.product_type||''; });
  const map={};
  items.forEach(li=>{
    let k=(li.sku&&skuType[li.sku])||li.product_type||'Unknown';
    if(typeof k!=='string'||!k.trim())k='Unknown';
    map[k]=(map[k]||0)+(li.quantity||0);
  });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}

// ── Bar chart (pure CSS) ────────────────────────────────────────────
function _siBarChart(data,maxBars){
  const d=data.slice(0,maxBars||15);
  if(!d.length)return'<div class="empty">No data</div>';
  const max=Math.max(...d.map(x=>x[1]),1);
  return d.map(([label,val])=>{
    const pct=Math.round(val/max*100);
    return`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <div style="width:90px;font-size:11px;text-align:right;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${label}">${label}</div>
      <div style="flex:1;height:18px;background:#f0f0f0;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--text);border-radius:4px;transition:width .3s"></div>
      </div>
      <div style="width:45px;font-size:11px;font-weight:600;text-align:right">${_siFmt(val)}</div>
    </div>`;
  }).join('');
}

// ── Size curve per style ────────────────────────────────────────────
function _siSizeCurve(rows){
  const styles={};
  rows.forEach(r=>{
    if(!r.title||r.needsReview)return;
    const base=r.title.replace(/\s*[\|\/\-]\s*.*/,'').trim();
    if(!base)return;
    if(!styles[base])styles[base]={sizes:{},total:0};
    styles[base].sizes[r.size||'?']=(styles[base].sizes[r.size||'?']||0)+r.s7;
    styles[base].total+=r.s7;
  });
  const sorted=Object.entries(styles).filter(([_,v])=>v.total>0).sort((a,b)=>b[1].total-a[1].total).slice(0,10);
  if(!sorted.length)return'<div class="empty">No size-curve data yet</div>';
  return sorted.map(([style,data])=>{
    const max=Math.max(...Object.values(data.sizes),1);
    const bars=Object.entries(data.sizes).sort((a,b)=>b[1]-a[1]).map(([sz,qty])=>{
      const pct=Math.round(qty/max*100);
      return`<span style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;min-width:32px">
        <span style="height:40px;width:20px;background:#f0f0f0;border-radius:3px;position:relative;display:flex;align-items:flex-end">
          <span style="width:100%;height:${pct}%;background:var(--text);border-radius:3px"></span>
        </span>
        <span style="font-size:9px;color:var(--muted)">${sz}</span>
        <span style="font-size:9px;font-weight:600">${qty}</span>
      </span>`;
    }).join('');
    return`<div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">${style} <span style="color:var(--muted);font-weight:400">(${data.total} sold)</span></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${bars}</div>
    </div>`;
  }).join('');
}

// ── Weeks of supply by category ─────────────────────────────────────
function _siWeeksOfSupply(rows){
  const cats={};
  rows.forEach(r=>{
    if(r.status==='archived')return; // archived products carry no product_type; keep them out of the 'Unknown' bucket
    const c=r.productType||'Unknown';
    if(!cats[c])cats[c]={onHand:0,weeklyRate:0};
    cats[c].onHand+=r.onHand;
    cats[c].weeklyRate+=r.s7;
  });
  return Object.entries(cats).map(([cat,d])=>{
    const wos=d.weeklyRate>0?(d.onHand/d.weeklyRate).toFixed(1):'∞';
    const cls=d.weeklyRate>0&&d.onHand/d.weeklyRate<3?'color:#dc2626;font-weight:700':'';
    return{cat,onHand:d.onHand,weeklyRate:d.weeklyRate,wos,cls};
  }).sort((a,b)=>(parseFloat(a.wos)||999)-(parseFloat(b.wos)||999));
}

// ── Markdown candidates ─────────────────────────────────────────────
function _siMarkdownCandidates(rows){
  return rows.filter(r=>r.onHand>10&&r.daysSinceLastSale!==null&&r.daysSinceLastSale>45&&r.price>0)
    .map(r=>({...r,cashTied:r.onHand*r.price}))
    .sort((a,b)=>b.cashTied-a.cashTied).slice(0,15);
}

// ── Daily movement log ──────────────────────────────────────────────
function _siDailyMovement(){
  const days={};
  const cutoff=_siPktDate(-14);
  _siLineItems.filter(li=>li.order_created_at>=cutoff&&li.financial_status!=='refunded'&&_siMatchSeason(_siItemSeason(li))).forEach(li=>{
    const day=(li.order_created_at||'').slice(0,10);
    if(!day)return;
    if(!days[day])days[day]={units:0,revenue:0,orders:new Set()};
    days[day].units+=(li.quantity||0);
    days[day].revenue+=(li.quantity||0)*(li.price||0);
    days[day].orders.add(li.order_id);
  });
  return Object.entries(days).sort((a,b)=>b[0].localeCompare(a[0])).map(([day,d])=>({day,units:d.units,revenue:d.revenue,orders:d.orders.size}));
}

// ═══════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════
function renderShopifyDashboard(){
  if(_siLoadError)return'<div class="page-head"><div class="page-title">Inventory Intelligence</div></div><div class="empty">⚠ Could not load inventory data: '+_siLoadError+'<br><button class="btn-primary" onclick="window._siRetry()" style="margin-top:10px">Retry</button></div>';
  if(!_siLoaded)return'<div class="empty">Loading Shopify data...</div>';

  const m=_siComputeMetrics();
  const skuRows=_siComputeSkuTable();
  const attn=_siNeedsAttention(skuRows);
  const items7=_siRecentItems(7);

  return`<div class="page-head">
    <div class="page-title">Inventory Intelligence</div>
    <div class="page-sub">Shopify sales + inventory — read-only, updated every 4 hours</div>
  </div>

  ${_siSeasonBar()}
  ${_siTabBar()}
  <div id="si-content">${_siRenderSection(m,skuRows,attn,items7)}</div>
  <div style="height:80px"></div>`;
}

function _siSeasonBar(){
  const opts=[{id:'all',label:'All Seasons'},{id:'winter',label:'❄ Winter'},{id:'summer',label:'☀ Summer'}];
  return`<div id="si-season-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <span style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase">Season</span>
    <div class="gp-tabs" style="margin:0">${opts.map(o=>
      `<button class="gp-tab${_siSeason===o.id?' active':''}" onclick="window._siSetSeason('${o.id}')">${o.label}</button>`
    ).join('')}</div>
    <span style="font-size:10px;color:var(--muted)">${_siSeason==='all'?'showing all items':'in-season + year-round (untagged) items only'}</span>
  </div>`;
}
window._siSetSeason=function(s){
  _siSeason=s;
  _siSkuLimit=200;          // restart SKU list at the top when season changes
  const bar=document.getElementById('si-season-bar');
  if(bar)bar.outerHTML=_siSeasonBar(); // re-render so the active chip + caption stay in sync
  _siRefreshContent();
};

window._siRetry=function(){
  _siLoaded=false;_siLoadError=null;
  if(typeof window.showPage==='function')window.showPage('shopify-intel');
};

function _siTabBar(){
  const tabs=[
    {id:'overview',label:'Overview'},
    {id:'attention',label:'Needs Attention'},
    {id:'patterns',label:'Selling Patterns'},
    {id:'skutable',label:'SKU Table'},
    {id:'weekly',label:'Weekly Close'},
    {id:'advanced',label:'Advanced'},
  ];
  return`<div class="gp-tabs" id="si-tab-bar" style="margin-bottom:14px">${tabs.map(t=>
    `<button class="gp-tab${_siSection===t.id?' active':''}" onclick="window._siSwitchTab('${t.id}')">${t.label}</button>`
  ).join('')}</div>`;
}

window._siSwitchTab=function(id){
  _siSection=id;
  const m=_siComputeMetrics();
  const skuRows=_siComputeSkuTable();
  const attn=_siNeedsAttention(skuRows);
  const items7=_siRecentItems(7);
  const bar=document.getElementById('si-tab-bar');
  if(bar)bar.outerHTML=_siTabBar();
  const el=document.getElementById('si-content');
  if(el)el.innerHTML=_siRenderSection(m,skuRows,attn,items7);
};

function _siRenderSection(m,skuRows,attn,items7){
  if(_siSection==='overview')return _siOverview(m,skuRows);
  if(_siSection==='attention')return _siAttentionSection(attn,skuRows);
  if(_siSection==='patterns')return _siPatternsSection(items7,skuRows);
  if(_siSection==='skutable')return _siSkuTableSection(skuRows);
  if(_siSection==='weekly')return _siWeeklySection();
  if(_siSection==='advanced')return _siAdvancedSection(skuRows);
  return'';
}

// ── Overview ────────────────────────────────────────────────────────
function _siOverview(m,skuRows){
  const attn=_siNeedsAttention(skuRows);
  const lowCount=attn.lowStock.length;
  const deadCount=attn.deadStock.length;

  return`<div class="stats-row">
    <div class="stat-card">
      <div class="stat-label">Inventory Value</div>
      <div class="stat-val" style="font-size:18px">${_siPKR(m.totalValue)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Units On Hand</div>
      <div class="stat-val">${_siFmt(m.totalOnHand)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Sell-Through 7d</div>
      <div class="stat-val" style="font-size:18px">${_siPct(m.sellThrough7)}</div>
      <div style="font-size:9px;color:var(--muted);margin-top:2px">est. based on recent pace</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Units Sold 7d</div>
      <div class="stat-val">${_siFmt(m.unitsSold7)}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
    <div class="card${lowCount?' style="border-left:3px solid #dc2626"':''}">
      <div class="card-title">Low Stock Alert</div>
      <div style="font-size:28px;font-weight:700;${lowCount?'color:#dc2626':''}">${lowCount}</div>
      <div style="font-size:11px;color:var(--muted)">SKUs with &lt; 14 days left</div>
    </div>
    <div class="card${deadCount?' style="border-left:3px solid var(--accent-warning)"':''}">
      <div class="card-title">Dead / Slow Stock</div>
      <div style="font-size:28px;font-weight:700;${deadCount?'color:var(--accent-warning)':''}">${deadCount}</div>
      <div style="font-size:11px;color:var(--muted)">No sale in 60+ days</div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Daily Movement (14 days)</div>
    ${_siDailyMovementTable()}
  </div>

  <div class="card">
    <div class="card-title">Sync Status</div>
    <div style="font-size:12px;color:var(--muted);line-height:2">
      Products: <strong>${_siProducts.length}</strong> variants
      · Orders: <strong>${_siOrders.length}</strong>
      · Line items: <strong>${_siLineItems.length}</strong>
      · Snapshots: ${_siSnapshot?'latest '+(_siSnapshot.date||'—'):'none yet'}
    </div>
  </div>`;
}

function _siDailyMovementTable(){
  const days=_siDailyMovement();
  if(!days.length)return'<div class="empty">No movement data</div>';
  return`<div style="overflow-x:auto"><table class="cut-table" style="min-width:400px">
    <thead><tr><th>Date</th><th>Orders</th><th>Units</th><th>Revenue</th></tr></thead>
    <tbody>${days.map(d=>`<tr>
      <td style="font-weight:600">${d.day}</td>
      <td>${d.orders}</td>
      <td>${d.units}</td>
      <td>${_siPKR(d.revenue)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ── Needs Attention ─────────────────────────────────────────────────
function _siAttentionSection(attn,skuRows){
  const md=_siMarkdownCandidates(skuRows);
  return`
  <div class="card" style="border-left:3px solid #dc2626">
    <div class="card-title">Low Stock / About to Sell Out</div>
    ${attn.lowStock.length?attn.lowStock.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:12px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:11px;color:var(--muted)">${r.color} / ${r.size}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;color:#dc2626">${r.daysLeft}d left</div>
        <div style="font-size:10px;color:var(--muted)">est. · ${r.onHand} on hand · ${r.s7} sold/7d</div>
      </div>
    </div>`).join(''):'<div class="empty">Nothing critically low</div>'}
  </div>

  <div class="card" style="border-left:3px solid var(--accent-warning)">
    <div class="card-title">High Sell-Through (Committed Pressure)</div>
    ${attn.highSellThrough.length?attn.highSellThrough.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:12px">${r.sku}</div>
        <div style="font-size:11px;color:var(--muted)">${r.color} / ${r.size}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">${_siPct(r.sellThrough)}</div>
        <div style="font-size:10px;color:var(--muted)">sell-through 7d est.</div>
      </div>
    </div>`).join(''):'<div class="empty">No pressure</div>'}
  </div>

  <div class="card">
    <div class="card-title">Dead / Slow Stock (60+ days no sale)</div>
    ${attn.deadStock.length?attn.deadStock.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:12px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:11px;color:var(--muted)">${r.daysSinceLastSale!=null?r.daysSinceLastSale+'d since last sale':'Never sold'} · ${r.onHand} on hand</div>
      </div>
      <div style="text-align:right;font-size:12px;font-weight:600">${_siPKR(r.onHand*r.price)}</div>
    </div>`).join(''):'<div class="empty">No dead stock</div>'}
  </div>

  <div class="card">
    <div class="card-title">Promote / Restock Candidates</div>
    ${attn.promote.length?attn.promote.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:12px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:11px;color:var(--muted)">${r.onHand} on hand · ${r.s30} sold last 30d · zero this week</div>
      </div>
      <div style="text-align:right;font-size:12px;font-weight:600">${_siPKR(r.onHand*r.price)}</div>
    </div>`).join(''):'<div class="empty">None</div>'}
  </div>

  ${md.length?`<div class="card">
    <div class="card-title">Markdown Candidates (cash-freed estimate)</div>
    ${md.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:12px">${r.sku}</div>
        <div style="font-size:11px;color:var(--muted)">${r.daysSinceLastSale}d no sale · ${r.onHand} units</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">${_siPKR(r.cashTied)}</div>
        <div style="font-size:10px;color:var(--muted)">tied up at retail</div>
      </div>
    </div>`).join('')}
  </div>`:''}`;
}

// ── Selling Patterns ────────────────────────────────────────────────
function _siPatternsSection(items7,skuRows){
  const bySize=_siByDimension(items7,'size');
  const byColor=_siByDimension(items7,'color');
  const byCat=_siByCategoryLive(items7);

  return`
  <div class="card">
    <div class="card-title">By Category (7d) <span style="font-size:11px;font-weight:400;color:var(--muted)">— current catalog</span></div>
    ${_siBarChart(byCat,12)}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" class="no-stack">
    <div class="card">
      <div class="card-title">By Size (7d)</div>
      ${_siBarChart(bySize,10)}
    </div>
    <div class="card">
      <div class="card-title">By Color (7d)</div>
      ${_siBarChart(byColor,10)}
    </div>
  </div>
  <div class="card">
    <div class="card-title">Size Curve per Style (7d sales)</div>
    ${_siSizeCurve(skuRows)}
  </div>`;
}

// ── SKU Table ───────────────────────────────────────────────────────
// Shared column definitions + head builder so the sort handler can rebuild
// the <thead> arrows without repainting (and thus recreating) the search input.
const _SI_SKU_COLS=[
  {key:'sku',label:'SKU'},{key:'title',label:'Product'},{key:'color',label:'Color'},{key:'size',label:'Size'},
  {key:'onHand',label:'On Hand'},{key:'s7',label:'Sold 7d'},{key:'s30',label:'Sold 30d'},
  {key:'daysLeft',label:'Days Left'},{key:'sellThrough',label:'Sell-Thru 7d'},
  {key:'reorderPoint',label:'Reorder Pt'},{key:'suggestedQty',label:'Suggested'},
  {key:'refunds',label:'Returns'},
];
function _siSkuHeadCells(){
  const arrow=k=>_siSkuSort===k?(_siSkuDir>0?' ▲':' ▼'):'';
  return _SI_SKU_COLS.map(c=>`<th style="cursor:pointer;white-space:nowrap" onclick="window._siSortSku('${c.key}')">${c.label}${arrow(c.key)}</th>`).join('');
}

// Filter + sort (reused by the shell render and the tbody-only repaint).
function _siSkuFiltered(rows){
  let filtered=rows;
  if(_siSkuSearch){
    const q=_siSkuSearch.toLowerCase();
    filtered=rows.filter(r=>(r.sku+' '+r.title+' '+r.color+' '+r.size+' '+r.productType).toLowerCase().includes(q));
  }
  const dir=_siSkuDir;
  const key=_siSkuSort;
  filtered.sort((a,b)=>{
    let va=a[key],vb=b[key];
    if(typeof va==='string')return dir*va.localeCompare(vb);
    return dir*((va||0)-(vb||0));
  });
  return filtered;
}

// Just the <tr> rows for the current page (uses _siSkuLimit, not a hardcoded 200).
function _siSkuRowsHtml(rows){
  const filtered=_siSkuFiltered(rows);
  const page=filtered.slice(0,_siSkuLimit);
  return page.map(r=>{
    const daysClass=r.daysLeft<=7&&r.daysLeft>0?'color:#dc2626;font-weight:700':r.daysLeft<=14&&r.daysLeft>0?'color:var(--accent-warning);font-weight:600':'';
    const reviewBadge=r.needsReview?'<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:9px;padding:1px 5px;border-radius:4px;margin-left:4px">review</span>':'';
    return`<tr>
      <td style="font-weight:600;font-size:11px;white-space:nowrap">${r.sku}${reviewBadge}</td>
      <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.title}">${r.title}</td>
      <td style="font-size:11px">${r.color}</td>
      <td style="font-size:11px">${r.size}</td>
      <td style="font-weight:600">${r.onHand}</td>
      <td>${r.s7}</td>
      <td>${r.s30}</td>
      <td style="${daysClass}">${r.daysLeft===999?'∞':r.daysLeft===0?'—':r.daysLeft+'d'}</td>
      <td>${r.sellThrough!=null?_siPct(r.sellThrough):'—'}</td>
      <td>${r.reorderPoint||'—'}</td>
      <td>${r.suggestedQty||'—'}</td>
      <td>${r.refunds||'—'}</td>
    </tr>`;
  }).join('');
}

// "Load more" button markup (empty string when nothing more to show).
function _siSkuMoreHtml(filteredLen){
  return filteredLen>_siSkuLimit
    ? '<button class="btn-primary" onclick="window._siSkuLoadMore()">Load more (showing '+Math.min(_siSkuLimit,filteredLen)+' of '+filteredLen+')</button>'
    : '';
}

function _siSkuTableSection(rows){
  const filtered=_siSkuFiltered(rows);
  // The search <input> and <thead> are the STATIC shell — they live outside
  // #si-sku-tbody, so tbody-only repaints (typing / load-more) never recreate
  // the input and never drop focus.
  return`<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">
    <input placeholder="Search SKU, product, color…" value="${_siSkuSearch}" oninput="window._siFilterSku(this.value)"
      style="flex:1;min-width:200px;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#FAFAFA;outline:none;font-family:inherit">
    <div id="si-sku-count" style="font-size:11px;color:var(--muted);align-self:center">${filtered.length} SKUs${_siSkuLimit<filtered.length?' (showing '+_siSkuLimit+')':''}</div>
  </div>
  <div style="font-size:9px;color:var(--muted);margin-bottom:6px">Days Left and Sell-Through are estimates based on 30-day / 7-day pace. Refunded orders excluded from sales.</div>
  <div style="overflow-x:auto"><table class="cut-table" style="min-width:900px">
    <thead><tr id="si-sku-head">${_siSkuHeadCells()}</tr></thead>
    <tbody id="si-sku-tbody">${_siSkuRowsHtml(rows)}</tbody>
  </table></div>
  <div id="si-sku-more" style="margin-top:10px;text-align:center">${_siSkuMoreHtml(filtered.length)}</div>`;
}

window._siFilterSku=function(v){
  _siSkuSearch=v; _siSkuLimit=200;          // reset paging on new search
  clearTimeout(window._siSkuDebounce);
  window._siSkuDebounce=setTimeout(_siRefreshSkuBody,120);  // tbody-only, input untouched → focus kept
};
window._siSortSku=function(k){
  if(_siSkuSort===k)_siSkuDir*=-1;
  else{_siSkuSort=k;_siSkuDir=-1;}
  const head=document.getElementById('si-sku-head');
  if(head)head.innerHTML=_siSkuHeadCells();  // refresh arrows without touching the input
  _siRefreshSkuBody();
};
window._siSkuLoadMore=function(){ _siSkuLimit+=200; _siRefreshSkuBody(); };

function _siRefreshContent(){
  const m=_siComputeMetrics();
  const skuRows=_siComputeSkuTable();
  const attn=_siNeedsAttention(skuRows);
  const items7=_siRecentItems(7);
  const el=document.getElementById('si-content');
  if(el)el.innerHTML=_siRenderSection(m,skuRows,attn,items7);
}

// Repaint ONLY the SKU table body + count + load-more — never the search input.
function _siRefreshSkuBody(){
  const rows=_siComputeSkuTable();
  const filtered=_siSkuFiltered(rows);
  const tb=document.getElementById('si-sku-tbody');
  if(tb)tb.innerHTML=_siSkuRowsHtml(rows);
  const cnt=document.getElementById('si-sku-count');
  if(cnt)cnt.textContent=filtered.length+' SKUs'+(_siSkuLimit<filtered.length?' (showing '+_siSkuLimit+')':'');
  const more=document.getElementById('si-sku-more');
  if(more)more.innerHTML=_siSkuMoreHtml(filtered.length);
}

// ── Weekly Close ────────────────────────────────────────────────────
function _siWeeklySection(){
  if(!_siWeeklyCloses.length)return'<div class="empty">No weekly close data yet. First close runs Saturday 7am PKT.</div>';
  return _siWeeklyCloses.map(wc=>{
    return`<div class="card">
      <div class="card-title">Week ending ${wc.week_ending} <span style="font-weight:400;text-transform:none">(${wc.week_starting} — ${wc.week_ending})</span></div>
      <div class="stats-row" style="margin-bottom:10px">
        <div class="stat-card">
          <div class="stat-label">Units Sold</div>
          <div class="stat-val">${_siFmt(wc.units_sold)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Units Added</div>
          <div class="stat-val">${wc.units_added!=null?_siFmt(wc.units_added):'—'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Net Change</div>
          <div class="stat-val" style="${wc.net_change<0?'color:#dc2626':''}">${wc.net_change!=null?(wc.net_change>0?'+':'')+_siFmt(wc.net_change):'—'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Line Items</div>
          <div class="stat-val">${_siFmt(wc.line_items_counted)}</div>
        </div>
      </div>
      ${wc.top_sku?`<div style="font-size:12px;margin-bottom:4px">Top SKU: <strong>${wc.top_sku.sku}</strong> (${wc.top_sku.quantity} units)</div>`:''}
      ${wc.top_category?`<div style="font-size:12px;margin-bottom:8px">Top Category: <strong>${wc.top_category.category}</strong> (${wc.top_category.quantity} units)</div>`:''}
      ${wc.by_category?`<div style="margin-top:8px"><div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px">By Category</div>${_siBarChart(Object.entries(wc.by_category).sort((a,b)=>b[1]-a[1]),8)}</div>`:''}
    </div>`;
  }).join('');
}

// ── Advanced (9 features) ───────────────────────────────────────────
function _siAdvancedSection(skuRows){
  const wos=_siWeeksOfSupply(skuRows);
  const md=_siMarkdownCandidates(skuRows);
  const stockouts=skuRows.filter(r=>r.onHand===0&&r.s30>0).sort((a,b)=>b.s30-a.s30).slice(0,15);
  const items7=_siRecentItems(7);
  const dropPerf=_siDropPerformance(skuRows);

  return`
  <div class="card">
    <div class="card-title">Weeks of Supply by Category</div>
    ${wos.length?`<div style="overflow-x:auto"><table class="cut-table">
      <thead><tr><th>Category</th><th>On Hand</th><th>Sold/Week</th><th>Weeks of Supply</th></tr></thead>
      <tbody>${wos.map(w=>`<tr>
        <td style="font-weight:600">${w.cat}</td>
        <td>${_siFmt(w.onHand)}</td>
        <td>${_siFmt(w.weeklyRate)}</td>
        <td style="${w.cls}">${w.wos}${w.wos!=='∞'?' wks':''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`:'<div class="empty">No data</div>'}
  </div>

  <div class="card" style="border-left:3px solid #dc2626">
    <div class="card-title">Lost Sales / Stockout Detection</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px">SKUs with zero inventory but recent (30d) sales — potential lost revenue</div>
    ${stockouts.length?stockouts.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:12px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:11px;color:var(--muted)">${r.color} / ${r.size} · sold ${r.s30} in 30d</div>
      </div>
      <div style="text-align:right;font-weight:700;color:#dc2626">OUT</div>
    </div>`).join(''):'<div class="empty">No stockouts with recent demand</div>'}
  </div>

  <div class="card">
    <div class="card-title">Variant Aging (first / last sold)</div>
    <div style="overflow-x:auto"><table class="cut-table" style="min-width:600px">
      <thead><tr><th>SKU</th><th>Product</th><th>First Sold</th><th>Last Sold</th><th>Days Since</th><th>Total Sold</th></tr></thead>
      <tbody>${skuRows.filter(r=>r.firstSold).sort((a,b)=>(b.daysSinceLastSale||0)-(a.daysSinceLastSale||0)).slice(0,20).map(r=>`<tr>
        <td style="font-weight:600;font-size:11px">${r.sku}</td>
        <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}</td>
        <td style="font-size:11px">${(r.firstSold||'').slice(0,10)}</td>
        <td style="font-size:11px">${(r.lastSold||'').slice(0,10)}</td>
        <td style="${r.daysSinceLastSale>30?'color:#dc2626;font-weight:600':''}">${r.daysSinceLastSale!=null?r.daysSinceLastSale+'d':'—'}</td>
        <td>${r.totalSold}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="card">
    <div class="card-title">Reorder Points + Suggested Qty</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px">Based on 30d daily rate. Reorder point = 14 days cover. Suggested qty = 30 days cover minus on hand.</div>
    <div style="overflow-x:auto"><table class="cut-table" style="min-width:600px">
      <thead><tr><th>SKU</th><th>Daily Rate</th><th>On Hand</th><th>Reorder Pt</th><th>Suggested Qty</th></tr></thead>
      <tbody>${skuRows.filter(r=>r.suggestedQty>0).sort((a,b)=>b.suggestedQty-a.suggestedQty).slice(0,20).map(r=>`<tr>
        <td style="font-weight:600;font-size:11px">${r.sku}</td>
        <td>${r.dailyRate.toFixed(1)}/day</td>
        <td>${r.onHand}</td>
        <td>${r.reorderPoint}</td>
        <td style="font-weight:700">${r.suggestedQty}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>

  ${dropPerf.length?`<div class="card">
    <div class="card-title">Drop Performance Tracker</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px">Products created in the last 30 days — early sell-through signal</div>
    ${dropPerf.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:12px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:11px;color:var(--muted)">Launched ${(r.created_at||'').slice(0,10)} · ${r.daysLive}d live</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">${r.totalSold} sold</div>
        <div style="font-size:10px;color:var(--muted)">${r.dailyRate.toFixed(1)}/day · ${r.onHand} left</div>
      </div>
    </div>`).join('')}
  </div>`:''}

  <div class="card">
    <div class="card-title">Returns Signal per SKU</div>
    ${_siReturnsTable(skuRows)}
  </div>

  ${md.length?`<div class="card">
    <div class="card-title">Markdown Candidates (cash-freed estimate)</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px">45+ days no sale, 10+ units. Markdown at 30% off frees the estimated cash below.</div>
    <div style="overflow-x:auto"><table class="cut-table">
      <thead><tr><th>SKU</th><th>On Hand</th><th>Days No Sale</th><th>Cash Tied (retail)</th><th>Cash Freed (30% off)</th></tr></thead>
      <tbody>${md.map(r=>`<tr>
        <td style="font-weight:600;font-size:11px">${r.sku}</td>
        <td>${r.onHand}</td>
        <td>${r.daysSinceLastSale}d</td>
        <td>${_siPKR(r.cashTied)}</td>
        <td style="font-weight:700">${_siPKR(Math.round(r.cashTied*0.7))}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`:''}
  `;
}

function _siDropPerformance(skuRows){
  const cutoff30=_siPktDate(-30);
  return skuRows.filter(r=>r.created_at&&r.created_at>=cutoff30&&r.totalSold>0)
    .map(r=>{
      const daysLive=Math.max(1,_siDaysAgo(r.created_at)||1);
      return{...r,daysLive,dailyRate:r.totalSold/daysLive};
    })
    .sort((a,b)=>b.totalSold-a.totalSold).slice(0,15);
}

function _siReturnsTable(skuRows){
  const withReturns=skuRows.filter(r=>r.refunds>0).sort((a,b)=>{
    const ra=a.totalSold>0?a.refunds/a.totalSold:0;
    const rb=b.totalSold>0?b.refunds/b.totalSold:0;
    return rb-ra;
  }).slice(0,15);
  if(!withReturns.length)return'<div class="empty">No returns recorded</div>';
  return`<div style="overflow-x:auto"><table class="cut-table">
    <thead><tr><th>SKU</th><th>Product</th><th>Returns</th><th>Total Sold</th><th>Return Rate</th></tr></thead>
    <tbody>${withReturns.map(r=>{
      const rate=r.totalSold>0?(r.refunds/r.totalSold*100).toFixed(1)+'%':'—';
      return`<tr>
        <td style="font-weight:600;font-size:11px">${r.sku}</td>
        <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}</td>
        <td style="font-weight:600;color:#dc2626">${r.refunds}</td>
        <td>${r.totalSold}</td>
        <td style="${parseFloat(rate)>10?'color:#dc2626;font-weight:600':''}">${rate}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

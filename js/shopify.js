/* ═══════════════════════════════════════════════════════════════════════
   Shopify Inventory Intelligence — client-side dashboard
   Read-only: queries shopify_* Firestore collections, never writes.
   ═══════════════════════════════════════════════════════════════════════ */

let _siLoaded=false;
let _siProducts=[],_siOrders=[],_siLineItems=[],_siWeeklyCloses=[],_siSnapshot=null,_siPrevSnapshot=null,_siSyncMeta={};
let _siSkuSearch='',_siSkuSort='s7',_siSkuDir=-1,_siSection='overview';
let _siSkuLimit=200;        // SKU table page size; grows by 200 via Load more
let _siSeason='all';        // global season filter: 'all' | 'winter' | 'summer'
let _siSeasonMapCache=null; // { sku: 'winter'|'summer'|'all-season' }, rebuilt on data load
let _siLoadError=null;      // last load failure message; non-null → render error state, never zeros
let _siCollectionsLoaded=false; // collections fetched OK once → skip re-download on snapshot-only retry
let _siSkuCatFilter='';         // active category filter in SKU table
let _siSkuTypeFilter='';        // 'top'|'bottom'|'' garment type filter
let _siSkuSelected=new Set();   // SKUs checked for labeling
let _siCustomCats=null;         // lazy-loaded from localStorage: { sku → custom category }
let _siCustomSeasons=null;      // lazy-loaded from localStorage: { sku → 'winter'|'summer'|'all-season' }
let _siCustomTypes=null;        // lazy-loaded from localStorage: { sku → 'top'|'bottom' }
let _siProdMapCache=null;       // sku → product doc map, rebuilt lazily, cleared on catalog reload
let _siSkuExpanded=new Set();   // group keys currently expanded in the SKU table

// ── Skeleton loader ──────────────────────────────────────────────────
function _siLoadingSkeleton(){
  const statCard=()=>`<div class="stat-card">
    <div class="si-skel" style="height:11px;width:68%;margin:0 auto 10px"></div>
    <div class="si-skel" style="height:28px;width:52%;margin:0 auto 6px"></div>
    <div class="si-skel" style="height:9px;width:44%;margin:0 auto"></div>
  </div>`;
  const widths=[88,72,95,80,65];
  const tableRows=widths.map(w=>`<div style="display:flex;gap:10px;margin-bottom:9px">
    <div class="si-skel" style="height:16px;width:90px;flex-shrink:0"></div>
    <div class="si-skel" style="height:16px;flex:1;max-width:${w}%"></div>
    <div class="si-skel" style="height:16px;width:60px;flex-shrink:0"></div>
    <div class="si-skel" style="height:16px;width:70px;flex-shrink:0"></div>
  </div>`).join('');
  return`<div class="page-head">
    <div class="page-title">Inventory Intelligence</div>
    <div class="page-sub">Shopify sales + inventory — read-only, updated every 4 hours</div>
  </div>
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <div class="si-skel" style="width:50px;height:14px"></div>
    <div class="si-skel" style="width:218px;height:34px;border-radius:10px"></div>
  </div>
  <div class="si-skel" style="height:36px;border-radius:10px;margin-bottom:14px"></div>
  <div class="stats-row" style="margin-bottom:16px">${[0,0,0,0].map(statCard).join('')}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
    ${[0,0].map(()=>`<div class="card">
      <div class="si-skel" style="height:11px;width:52%;margin-bottom:14px"></div>
      <div class="si-skel" style="height:34px;width:36%;margin-bottom:8px"></div>
      <div class="si-skel" style="height:10px;width:70%"></div>
    </div>`).join('')}
  </div>
  <div class="card">
    <div class="si-skel" style="height:11px;width:34%;margin-bottom:16px"></div>
    ${tableRows}
  </div>
  <div class="card">
    <div class="si-skel" style="height:11px;width:20%;margin-bottom:12px"></div>
    <div class="si-skel" style="height:13px;width:76%"></div>
  </div>`;
}

// ── Product lookup ───────────────────────────────────────────────────
function _siGetProd(sku){
  if(!_siProdMapCache){_siProdMapCache={};_siProducts.forEach(p=>{if(p.sku&&!_siProdMapCache[p.sku])_siProdMapCache[p.sku]=p;});}
  return _siProdMapCache[sku]||{};
}

// ── Custom category persistence (localStorage) ───────────────────────
function _siGetCustomCats(){
  if(!_siCustomCats){try{_siCustomCats=JSON.parse(localStorage.getItem('_siCustomCats')||'{}');}catch(_){_siCustomCats={};}}
  return _siCustomCats;
}
function _siSaveCustomCats(){localStorage.setItem('_siCustomCats',JSON.stringify(_siCustomCats||{}));}
function _siGetCustomSeasons(){
  if(!_siCustomSeasons){try{_siCustomSeasons=JSON.parse(localStorage.getItem('_siCustomSeasons')||'{}');}catch(_){_siCustomSeasons={};}}
  return _siCustomSeasons;
}
function _siSaveCustomSeasons(){localStorage.setItem('_siCustomSeasons',JSON.stringify(_siCustomSeasons||{}));}
function _siGetCustomTypes(){
  if(!_siCustomTypes){try{_siCustomTypes=JSON.parse(localStorage.getItem('_siCustomTypes')||'{}');}catch(_){_siCustomTypes={};}}
  return _siCustomTypes;
}
function _siSaveCustomTypes(){localStorage.setItem('_siCustomTypes',JSON.stringify(_siCustomTypes||{}));}

// ── Size/color normalization (fixes products with swapped option1/option2) ──
const _SI_KNOWN_SIZES=new Set(['XXS','XXXS','XS','S','M','L','XL','2XL','XXL','3XL','XXXL','4XL','5XL','ONE SIZE','OS','FREE SIZE','ONESIZE']);
function _siEsc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function _siNormSize(li){
  const s=(li.size||'').trim().toUpperCase();
  const c=(li.color||'').trim().toUpperCase();
  if(s&&_SI_KNOWN_SIZES.has(s))return li.size.trim();
  if(c&&_SI_KNOWN_SIZES.has(c))return li.color.trim(); // options were swapped — color field actually has the size
  return li.size||'Unknown';
}
function _siNormColor(li){
  const s=(li.size||'').trim().toUpperCase();
  const c=(li.color||'').trim().toUpperCase();
  if(c&&!_SI_KNOWN_SIZES.has(c))return li.color.trim()||'Unknown';
  if(s&&!_SI_KNOWN_SIZES.has(s))return li.size.trim()||'Unknown'; // size field actually has the color
  return li.color||'Unknown';
}
function _siByNormDim(items,dim){
  const map={};
  items.forEach(li=>{
    let k=dim==='size'?_siNormSize(li):_siNormColor(li);
    if(!k||!k.trim())k='Unknown';
    map[k]=(map[k]||0)+(li.quantity||0);
  });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}

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
      _siProdMapCache=null;   // catalog changed → rebuild product lookup lazily
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
  const customSeasons=_siGetCustomSeasons();
  _siProducts.forEach(p=>{if(p.sku&&m[p.sku]===undefined)m[p.sku]=customSeasons[p.sku]||_siSeasonOfTags(p.tags);});
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

    // Normalize swapped options: some products have size in color field and vice versa
    const _rc=(prod.color||'').trim(),_rs=(prod.size||'').trim();
    const _normColor=_SI_KNOWN_SIZES.has(_rc.toUpperCase())?_rs:_rc;
    const _normSize=_SI_KNOWN_SIZES.has(_rc.toUpperCase())?_rc:_rs;

    rows.push({
      sku,title:prod.product_title||'',color:_normColor,size:_normSize,
      productType:_siGetCustomCats()[sku]||prod.product_type||'',needsReview:!!prod.needs_review,status:prod.status||'',
      tags:prod.tags||[],season:_siGetCustomSeasons()[sku]||_siSeasonOfTags(prod.tags),
      garmentType:_siGetCustomTypes()[sku]||'',
      onHand,prevOnHand,weeklyDelta,s7,s30,dailyRate,daysLeft,sellThrough,
      firstSold:fs,lastSold:ls,daysSinceLastSale,refunds,totalSold:totalSoldMap[sku]||0,
      price:prod.price||0,reorderPoint,suggestedQty,created_at:prod.created_at||'',
      liveAt:prod.published_at||prod.created_at||''
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
      <div style="width:90px;font-size:12px;text-align:right;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${label}">${label}</div>
      <div style="flex:1;height:18px;background:var(--soft);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--text);border-radius:4px;transition:width .3s"></div>
      </div>
      <div style="width:45px;font-size:12px;font-weight:600;text-align:right">${_siFmt(val)}</div>
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
        <span style="height:40px;width:20px;background:var(--soft);border-radius:3px;position:relative;display:flex;align-items:flex-end">
          <span style="width:100%;height:${pct}%;background:var(--text);border-radius:3px"></span>
        </span>
        <span style="font-size:11px;color:var(--muted)">${sz}</span>
        <span style="font-size:11px;font-weight:600">${qty}</span>
      </span>`;
    }).join('');
    return`<div style="margin-bottom:12px">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">${style} <span style="color:var(--muted);font-weight:400">(${data.total} sold)</span></div>
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
    const cls=d.weeklyRate>0&&d.onHand/d.weeklyRate<3?'color:var(--accent-urgent);font-weight:700':'';
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
    <span style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase">Season</span>
    <div class="gp-tabs" style="margin:0">${opts.map(o=>
      `<button class="gp-tab${_siSeason===o.id?' active':''}" onclick="window._siSetSeason('${o.id}')">${o.label}</button>`
    ).join('')}</div>
    <span style="font-size:11px;color:var(--muted)">${_siSeason==='all'?'showing all items':'in-season + year-round (untagged) items only'}</span>
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
    {id:'explorer',label:'Article Explorer'},
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
  if(_siSection==='explorer')return _siArticleExplorerSection();
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
      <div class="stat-val" style="font-size:19px">${_siPKR(m.totalValue)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Units On Hand</div>
      <div class="stat-val">${_siFmt(m.totalOnHand)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Sell-Through 7d</div>
      <div class="stat-val" style="font-size:19px">${_siPct(m.sellThrough7)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">est. based on recent pace</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Units Sold 7d</div>
      <div class="stat-val">${_siFmt(m.unitsSold7)}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
    <div class="card${lowCount?' style="border-left:3px solid var(--accent-urgent)"':''}">
      <div class="card-title">Low Stock Alert</div>
      <div style="font-size:29px;font-weight:700;${lowCount?'color:var(--accent-urgent)':''}">${lowCount}</div>
      <div style="font-size:12px;color:var(--muted)">SKUs with &lt; 14 days left</div>
    </div>
    <div class="card${deadCount?' style="border-left:3px solid var(--accent-warning)"':''}">
      <div class="card-title">Dead / Slow Stock</div>
      <div style="font-size:29px;font-weight:700;${deadCount?'color:var(--accent-warning)':''}">${deadCount}</div>
      <div style="font-size:12px;color:var(--muted)">No sale in 60+ days</div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Daily Movement (14 days)</div>
    ${_siDailyMovementTable()}
  </div>

  <div class="card">
    <div class="card-title">Sync Status</div>
    <div style="font-size:13px;color:var(--muted);line-height:2">
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
  <div class="card" style="border-left:3px solid var(--accent-urgent)">
    <div class="card-title">Low Stock / About to Sell Out</div>
    ${attn.lowStock.length?attn.lowStock.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:13px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:12px;color:var(--muted)">${r.color} / ${r.size}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;color:var(--accent-urgent)">${r.daysLeft}d left</div>
        <div style="font-size:11px;color:var(--muted)">est. · ${r.onHand} on hand · ${r.s7} sold/7d</div>
      </div>
    </div>`).join(''):'<div class="empty">Nothing critically low</div>'}
  </div>

  <div class="card" style="border-left:3px solid var(--accent-warning)">
    <div class="card-title">High Sell-Through (Committed Pressure)</div>
    ${attn.highSellThrough.length?attn.highSellThrough.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:13px">${r.sku}</div>
        <div style="font-size:12px;color:var(--muted)">${r.color} / ${r.size}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">${_siPct(r.sellThrough)}</div>
        <div style="font-size:11px;color:var(--muted)">sell-through 7d est.</div>
      </div>
    </div>`).join(''):'<div class="empty">No pressure</div>'}
  </div>

  <div class="card">
    <div class="card-title">Dead / Slow Stock (60+ days no sale)</div>
    ${attn.deadStock.length?attn.deadStock.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:13px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:12px;color:var(--muted)">${r.daysSinceLastSale!=null?r.daysSinceLastSale+'d since last sale':'Never sold'} · ${r.onHand} on hand</div>
      </div>
      <div style="text-align:right;font-size:13px;font-weight:600">${_siPKR(r.onHand*r.price)}</div>
    </div>`).join(''):'<div class="empty">No dead stock</div>'}
  </div>

  <div class="card">
    <div class="card-title">Promote / Restock Candidates</div>
    ${attn.promote.length?attn.promote.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:13px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:12px;color:var(--muted)">${r.onHand} on hand · ${r.s30} sold last 30d · zero this week</div>
      </div>
      <div style="text-align:right;font-size:13px;font-weight:600">${_siPKR(r.onHand*r.price)}</div>
    </div>`).join(''):'<div class="empty">None</div>'}
  </div>

  ${md.length?`<div class="card">
    <div class="card-title">Markdown Candidates (cash-freed estimate)</div>
    ${md.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:13px">${r.sku}</div>
        <div style="font-size:12px;color:var(--muted)">${r.daysSinceLastSale}d no sale · ${r.onHand} units</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">${_siPKR(r.cashTied)}</div>
        <div style="font-size:11px;color:var(--muted)">tied up at retail</div>
      </div>
    </div>`).join('')}
  </div>`:''}`;
}

// ── Selling Patterns ────────────────────────────────────────────────
function _siPatternsSection(items7,skuRows){
  const bySize=_siByNormDim(items7,'size');
  const byColor=_siByNormDim(items7,'color');
  const byCat=_siByCategoryLive(items7);

  return`
  <div class="card">
    <div class="card-title">By Category (7d) <span style="font-size:12px;font-weight:400;color:var(--muted)">— current catalog</span></div>
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
  {key:'productType',label:'Category'},
  {key:'onHand',label:'On Hand'},{key:'s7',label:'Sold 7d'},{key:'s30',label:'Sold 30d'},
  {key:'daysLeft',label:'Days Left'},{key:'sellThrough',label:'Sell-Thru 7d'},
  {key:'reorderPoint',label:'Reorder Pt'},{key:'suggestedQty',label:'Suggested'},
  {key:'refunds',label:'Returns'},
];
function _siSkuHeadCells(){
  const arrow=k=>_siSkuSort===k?(_siSkuDir>0?' ▲':' ▼'):'';
  const sortable=[
    {key:'title',label:'Product'},{key:'color',label:'Color'},{key:'productType',label:'Category'},
  ];
  const rest=[
    {key:'onHand',label:'On Hand'},{key:'s7',label:'Sold 7d'},{key:'s30',label:'Sold 30d'},{key:'totalSold',label:'Sold since live'},
    {key:'daysLeft',label:'Days Left'},{key:'sellThrough',label:'Sell-Thru'},
    {key:'reorderPoint',label:'Reorder Pt'},{key:'suggestedQty',label:'Suggested'},
  ];
  return`<th style="width:28px;padding:4px 8px"><input type="checkbox" onchange="window._siSelectAllSku(this.checked)" title="Select all visible"></th>`+
    sortable.map(c=>`<th style="cursor:pointer;white-space:nowrap" onclick="window._siSortSku('${c.key}')">${c.label}${arrow(c.key)}</th>`).join('')+
    `<th>Sizes</th>`+
    rest.map(c=>`<th style="cursor:pointer;white-space:nowrap" onclick="window._siSortSku('${c.key}')">${c.label}${arrow(c.key)}</th>`).join('');
}

// Filter + sort (reused by the shell render and the tbody-only repaint).
function _siSkuFiltered(rows){
  let filtered=rows;
  if(_siSkuSearch){
    const q=_siSkuSearch.toLowerCase();
    filtered=rows.filter(r=>(r.sku+' '+r.title+' '+r.color+' '+r.size+' '+r.productType).toLowerCase().includes(q));
  }
  if(_siSkuCatFilter)filtered=filtered.filter(r=>r.productType===_siSkuCatFilter);
  if(_siSkuTypeFilter)filtered=filtered.filter(r=>r.garmentType===_siSkuTypeFilter);
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
    const daysClass=r.daysLeft<=7&&r.daysLeft>0?'color:var(--accent-urgent);font-weight:700':r.daysLeft<=14&&r.daysLeft>0?'color:var(--accent-warning);font-weight:600':'';
    const reviewBadge=r.needsReview?'<span style="display:inline-block;background:var(--accent-warning-soft);color:var(--accent-warning);font-size:11px;padding:1px 5px;border-radius:4px;margin-left:4px">review</span>':'';
    return`<tr>
      <td style="padding:4px 8px"><input type="checkbox" value="${r.sku}" ${_siSkuSelected.has(r.sku)?'checked':''} onchange="window._siToggleSku('${r.sku}',this.checked)"></td>
      <td style="font-weight:600;font-size:12px;white-space:nowrap">${r.sku}${reviewBadge}</td>
      <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.title}">${r.title}</td>
      <td style="font-size:12px">${r.color}</td>
      <td style="font-size:12px">${r.size}</td>
      <td style="font-size:12px">${r.productType||'—'}</td>
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

// ── Product-grouped SKU table helpers ───────────────────────────────
const _SI_SIZE_ORDER=['XXS','XS','S','M','L','XL','2XL','XXL','3XL','XXXL','4XL','5XL'];

function _siGroupRows(rows){
  const groups={};
  rows.forEach(r=>{
    const key=r.title+'|||'+r.color;
    if(!groups[key])groups[key]={title:r.title,color:r.color,productType:r.productType,variants:[]};
    groups[key].variants.push(r);
  });
  Object.values(groups).forEach(g=>{
    g.variants.sort((a,b)=>{
      const ai=_SI_SIZE_ORDER.indexOf((a.size||'').toUpperCase());
      const bi=_SI_SIZE_ORDER.indexOf((b.size||'').toUpperCase());
      if(ai>=0&&bi>=0)return ai-bi;
      if(ai>=0)return-1;if(bi>=0)return 1;
      return(a.size||'').localeCompare(b.size||'');
    });
  });
  return groups;
}

function _siSizeChips(variants){
  return variants.map(v=>{
    const soldOut=v.onHand<=0;
    const low=!soldOut&&v.daysLeft>0&&v.daysLeft<=14&&v.dailyRate>0.05;
    const bg=soldOut?'var(--accent-urgent-soft)':low?'var(--accent-warning-soft)':'var(--soft)';
    const clr=soldOut?'var(--accent-urgent)':low?'var(--accent-warning)':'var(--text)';
    return`<span style="padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;background:${bg};color:${clr}">${_siEsc(v.size||'?')}</span>`;
  }).join(' ');
}

// "Sold since live": lifetime units (non-refunded line items, same rule as
// Sold 7d/30d) with how long the product has been live underneath. Live age
// is "—" when the catalog carries no date; it is never invented.
function _siGroupLiveAt(variants){
  let best='';
  variants.forEach(v=>{if(v.liveAt&&(!best||v.liveAt<best))best=v.liveAt;});
  return best;
}
function _siSoldSinceLiveCell(units,liveAt){
  const d=liveAt?_siDaysAgo(liveAt):null;
  const age=d!==null&&!isNaN(d)&&d>=0?'live '+d+'d':'live —';
  return`<span style="font-weight:600">${units||0}</span><div style="font-size:11px;color:var(--muted);white-space:nowrap">${age}</div>`;
}
function _siEarliestOrderDate(){
  let m='';
  _siLineItems.forEach(li=>{const t=li.order_created_at;if(t&&(!m||t<m))m=t;});
  return m?String(m).slice(0,10):'';
}

function _siGroupedBodyHtml(filteredRows){
  const groups=_siGroupRows(filteredRows);
  const dir=_siSkuDir;const key=_siSkuSort;
  const getGroupVal=g=>{
    const tot=f=>g.variants.reduce((s,r)=>s+(r[f]||0),0);
    const minDays=Math.min(...g.variants.filter(r=>r.dailyRate>0.05).map(r=>r.daysLeft).concat([9999]));
    const m={title:g.title,color:g.color,productType:g.productType,
      onHand:tot('onHand'),s7:tot('s7'),s30:tot('s30'),totalSold:tot('totalSold'),daysLeft:minDays};
    return m[key]!==undefined?m[key]:tot('onHand');
  };
  const page=Object.entries(groups).sort((a,b)=>{
    const va=getGroupVal(a[1]),vb=getGroupVal(b[1]);
    if(typeof va==='string')return dir*va.localeCompare(vb||'');
    return dir*((va||0)-(vb||0));
  }).slice(0,_siSkuLimit);
  return page.map(([gkey,g])=>{
    const expanded=_siSkuExpanded.has(gkey);
    const tot=g.variants.reduce((s,r)=>s+(r.onHand||0),0);
    const anySoldOut=g.variants.some(r=>r.onHand<=0);
    const allInStock=g.variants.every(r=>r.onHand>0);
    const totColor=allInStock?'var(--accent-success)':anySoldOut?'var(--accent-urgent)':'inherit';
    const totS7=g.variants.reduce((s,r)=>s+(r.s7||0),0);
    const totS30=g.variants.reduce((s,r)=>s+(r.s30||0),0);
    const minDays=Math.min(...g.variants.filter(r=>r.dailyRate>0.05).map(r=>r.daysLeft).concat([9999]));
    const minDaysStr=minDays<9999?(minDays<=7?`<span style="color:var(--accent-urgent);font-weight:700">${minDays}d</span>`:minDays<=14?`<span style="color:var(--accent-warning)">${minDays}d</span>`:`${minDays}d`):'—';
    const groupAllSel=g.variants.every(r=>_siSkuSelected.has(r.sku));
    const gkeyEsc=_siEsc(gkey);
    const gSeason=g.variants.find(v=>v.season!=='all-season')?.season||g.variants[0]?.season||'all-season';
    const gType=g.variants.find(v=>v.garmentType)?.garmentType||'';
    const seasonIcon=gSeason==='summer'?'<span title="Summer" style="font-size:12px;margin-right:3px">☀</span>':gSeason==='winter'?'<span title="Winter" style="font-size:12px;margin-right:3px">❄</span>':'';
    const typeChip=gType?`<span style="background:var(--soft);color:var(--cat-notes);border-radius:3px;padding:1px 5px;font-size:11px;font-weight:700;margin-left:5px;vertical-align:middle">${_siEsc(gType.toUpperCase())}</span>`:'';
    const parent=`<tr style="cursor:pointer" data-gkey="${gkeyEsc}" onclick="window._siToggleGroup(this.dataset.gkey)">
      <td style="padding:4px 8px" onclick="event.stopPropagation()"><input type="checkbox" ${groupAllSel?'checked':''} data-gkey="${gkeyEsc}" onchange="window._siToggleGroupSel(this.dataset.gkey,this.checked)" onclick="event.stopPropagation()"></td>
      <td style="font-weight:600;font-size:13px;padding:10px 8px;white-space:nowrap"><span style="display:inline-block;width:14px;font-size:11px;color:var(--muted)">${expanded?'▼':'▶'}</span>${seasonIcon}${_siEsc(g.title)}${typeChip}</td>
      <td style="font-size:12px;color:var(--muted)">${_siEsc(g.color)}</td>
      <td style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_siEsc(g.productType||'')}">${_siEsc(g.productType)||'—'}</td>
      <td style="white-space:nowrap">${_siSizeChips(g.variants)}</td>
      <td style="font-weight:700;color:${totColor}">${tot}</td>
      <td style="font-weight:600">${totS7}</td>
      <td>${totS30}</td>
      <td>${_siSoldSinceLiveCell(g.variants.reduce((s,r)=>s+(r.totalSold||0),0),_siGroupLiveAt(g.variants))}</td>
      <td>${minDaysStr}</td>
      <td style="color:var(--muted)">—</td><td style="color:var(--muted)">—</td><td style="color:var(--muted)">—</td>
    </tr>`;
    const children=!expanded?'':g.variants.map(r=>{
      const soldOut=r.onHand<=0;
      const daysClass=r.daysLeft<=7&&r.daysLeft>0?'color:var(--accent-urgent);font-weight:700':r.daysLeft<=14&&r.daysLeft>0?'color:var(--accent-warning);font-weight:600':'';
      const daysStr=r.daysLeft===999?'∞':r.daysLeft===0?'—':`${r.daysLeft}d`;
      return`<tr style="background:var(--surface-2)">
        <td style="padding:4px 8px"><input type="checkbox" ${_siSkuSelected.has(r.sku)?'checked':''} data-sku="${_siEsc(r.sku)}" onchange="window._siToggleSku(this.dataset.sku,this.checked)"></td>
        <td style="font-size:11px;color:var(--muted);padding:7px 8px 7px 22px">${_siEsc(r.sku)}</td>
        <td></td><td></td>
        <td style="font-weight:700;font-size:13px">${_siEsc(r.size||'?')}</td>
        <td style="font-weight:${soldOut?'700':'600'};color:${soldOut?'var(--accent-urgent)':'inherit'}">${r.onHand}</td>
        <td>${r.s7}</td><td>${r.s30}</td>
        <td>${_siSoldSinceLiveCell(r.totalSold||0,r.liveAt)}</td>
        <td style="${daysClass}">${daysStr}</td>
        <td style="font-size:12px">${r.sellThrough!=null?_siPct(r.sellThrough):'—'}</td>
        <td style="font-size:12px">${r.reorderPoint||'—'}</td>
        <td style="font-size:12px;font-weight:${r.suggestedQty?'700':''}">${r.suggestedQty||'—'}</td>
      </tr>`;
    }).join('');
    return parent+children;
  }).join('');
}

function _siFixIndeterminate(){
  const rows=_siComputeSkuTable();
  const groups=_siGroupRows(_siSkuFiltered(rows));
  document.querySelectorAll('input[data-gkey]').forEach(cb=>{
    const g=groups[cb.dataset.gkey];if(!g)return;
    const nSel=g.variants.filter(r=>_siSkuSelected.has(r.sku)).length;
    cb.checked=nSel===g.variants.length&&g.variants.length>0;
    cb.indeterminate=nSel>0&&nSel<g.variants.length;
  });
}

function _siCatSelBar(){
  if(!_siSkuSelected.size)return'<div id="si-cat-bar"></div>';
  const n=_siSkuSelected.size;
  const btnSm='padding:5px 10px;font-size:12px;border-radius:6px;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:600';
  return`<div id="si-cat-bar" style="background:var(--soft);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span style="font-size:13px;font-weight:700;flex-shrink:0">${n} variant${n===1?'':'s'} selected</span>
    <div style="display:flex;gap:6px;align-items:center">
      <input id="si-cat-input" placeholder="Category name…" onkeydown="if(event.key==='Enter')window._siApplyCat()" style="padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;outline:none;min-width:150px;background:var(--surface)">
      <button class="btn-primary" style="padding:7px 12px;font-size:13px;width:auto" onclick="window._siApplyCat()">Apply Category</button>
    </div>
    <div style="display:flex;gap:4px;align-items:center">
      <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap">Season</span>
      <button style="${btnSm}" onclick="window._siApplySeason('summer')">☀ Summer</button>
      <button style="${btnSm}" onclick="window._siApplySeason('winter')">❄ Winter</button>
      <button style="${btnSm}" onclick="window._siApplySeason('all-season')">◯ Year-Round</button>
    </div>
    <div style="display:flex;gap:4px;align-items:center">
      <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;white-space:nowrap">Type</span>
      <button style="${btnSm}" onclick="window._siApplyType('top')">Top</button>
      <button style="${btnSm}" onclick="window._siApplyType('bottom')">Bottom</button>
      <button style="${btnSm}" onclick="window._siApplyType('')">—</button>
    </div>
    <button style="padding:5px 10px;font-size:12px;border-radius:6px;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:var(--surface);font-weight:600;margin-left:auto" onclick="window._siExportSelectedCsv()">↓ Export CSV</button>
    <button class="btn-outline" style="padding:5px 10px;font-size:12px" onclick="window._siClearSel()">Clear selection</button>
  </div>`;
}
function _siSkuTableSection(rows){
  const filtered=_siSkuFiltered(rows);
  const groups=_siGroupRows(filtered);
  const totalGroups=Object.keys(groups).length;
  const cats=[...new Set(rows.map(r=>r.productType).filter(t=>t&&t.trim()))].sort();
  const countStr=totalGroups+' products · '+filtered.length+' variants'+(totalGroups>_siSkuLimit?' (showing '+_siSkuLimit+')':'');
  const moreHtml=totalGroups>_siSkuLimit?`<button class="btn-primary" onclick="window._siSkuLoadMore()">Load more (showing ${Math.min(_siSkuLimit,totalGroups)} of ${totalGroups} products)</button>`:'';
  const typeTab=t=>t===_siSkuTypeFilter;
  return`${_siCatSelBar()}
  <div style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap">
    <input placeholder="Search SKU, product, color, category…" value="${_siEsc(_siSkuSearch)}" oninput="window._siFilterSku(this.value)"
      style="flex:1;min-width:200px;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface-2);outline:none;font-family:inherit">
    <select onchange="window._siFilterCat(this.value)" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface-2);color:var(--text);font-family:inherit;cursor:pointer;outline:none">
      <option value="">All Categories</option>
      ${cats.map(c=>`<option value="${_siEsc(c)}"${_siSkuCatFilter===c?' selected':''}>${_siEsc(c)}</option>`).join('')}
    </select>
  </div>
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
    <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase">Type</span>
    <button class="gp-tab${typeTab('')?' active':''}" onclick="window._siFilterType('')">All</button>
    <button class="gp-tab${typeTab('top')?' active':''}" onclick="window._siFilterType('top')">Top</button>
    <button class="gp-tab${typeTab('bottom')?' active':''}" onclick="window._siFilterType('bottom')">Bottom</button>
    <span style="margin-left:auto;font-size:12px;color:var(--muted)" id="si-sku-count">${countStr}</span>
  </div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Click a row to expand sizes. ☀ = Summer · ❄ = Winter · <span style="background:var(--soft);color:var(--cat-notes);border-radius:3px;padding:1px 4px;font-size:11px;font-weight:700">TOP</span> / <span style="background:var(--soft);color:var(--cat-notes);border-radius:3px;padding:1px 4px;font-size:11px;font-weight:700">BOTTOM</span> badges from your labels. Green = all sizes in stock · Red = any sold out.</div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Sold since live counts non-refunded orders synced from ${_siEsc(_siEarliestOrderDate()||'—')} onward, so it understates products that launched earlier. "live Nd" comes from the catalog's published/created date ("—" until the catalog sync has stored it).</div>
  <div style="overflow-x:auto"><table class="cut-table" style="min-width:1040px">
    <thead><tr id="si-sku-head">${_siSkuHeadCells()}</tr></thead>
    <tbody id="si-sku-tbody">${_siGroupedBodyHtml(filtered)||(totalGroups===0?`<tr><td colspan="13" style="text-align:center;padding:32px;color:var(--muted);font-size:14px">No products match your filters</td></tr>`:'')}</tbody>
  </table></div>
  <div id="si-sku-more" style="margin-top:10px;text-align:center">${moreHtml}</div>`;
}

window._siFilterSku=function(v){
  _siSkuSearch=v;_siSkuLimit=200;_siSkuExpanded.clear();
  clearTimeout(window._siSkuDebounce);
  window._siSkuDebounce=setTimeout(_siRefreshSkuBody,120);
};
window._siSortSku=function(k){
  if(_siSkuSort===k){_siSkuDir*=-1;}
  else{
    _siSkuSort=k;
    // text columns + daysLeft: first click ascending (A→Z / lowest = most urgent)
    _siSkuDir=new Set(['title','color','productType','daysLeft']).has(k)?1:-1;
  }
  _siSkuExpanded.clear();
  const head=document.getElementById('si-sku-head');
  if(head)head.innerHTML=_siSkuHeadCells();
  _siRefreshSkuBody();
};
window._siSkuLoadMore=function(){_siSkuLimit+=200;_siRefreshSkuBody();};
window._siFilterCat=function(v){_siSkuCatFilter=v;_siSkuLimit=200;_siSkuExpanded.clear();_siRefreshSkuBody();};
window._siToggleSku=function(sku,checked){
  if(checked)_siSkuSelected.add(sku);else _siSkuSelected.delete(sku);
  const bar=document.getElementById('si-cat-bar');if(bar)bar.outerHTML=_siCatSelBar();
  _siFixIndeterminate();
};
window._siSelectAllSku=function(checked){
  const rows=_siComputeSkuTable();
  const filtered=_siSkuFiltered(rows);
  const groups=_siGroupRows(filtered);
  Object.values(groups).slice(0,_siSkuLimit).forEach(g=>g.variants.forEach(r=>checked?_siSkuSelected.add(r.sku):_siSkuSelected.delete(r.sku)));
  const tb=document.getElementById('si-sku-tbody');
  if(tb){tb.innerHTML=_siGroupedBodyHtml(filtered);_siFixIndeterminate();}
  const bar=document.getElementById('si-cat-bar');if(bar)bar.outerHTML=_siCatSelBar();
};
window._siApplyCat=function(){
  const input=document.getElementById('si-cat-input');
  const cat=(input&&input.value.trim())||'';if(!cat)return;
  if(!_siCustomCats)_siCustomCats={};
  _siSkuSelected.forEach(sku=>{_siCustomCats[sku]=cat;});
  _siSaveCustomCats();_siProdMapCache=null;_siSeasonMapCache=null;
  _siSkuSelected.clear();_siSkuCatFilter=''; // clear filter so the new category is immediately visible
  const rows=_siComputeSkuTable();
  const el=document.getElementById('si-content');
  if(el)el.innerHTML=_siSkuTableSection(rows); // full re-render so new cat appears in dropdown
};
window._siApplySeason=function(season){
  if(!_siCustomSeasons)_siCustomSeasons={};
  _siSkuSelected.forEach(sku=>{_siCustomSeasons[sku]=season;});
  _siSaveCustomSeasons();_siSeasonMapCache=null;
  _siSkuSelected.clear();
  const rows=_siComputeSkuTable();
  const el=document.getElementById('si-content');
  if(el)el.innerHTML=_siSkuTableSection(rows);
};
window._siApplyType=function(type){
  if(!_siCustomTypes)_siCustomTypes={};
  _siSkuSelected.forEach(sku=>{_siCustomTypes[sku]=type||undefined;if(!type)delete _siCustomTypes[sku];});
  _siSaveCustomTypes();
  _siSkuSelected.clear();
  const rows=_siComputeSkuTable();
  const el=document.getElementById('si-content');
  if(el)el.innerHTML=_siSkuTableSection(rows);
};
window._siFilterType=function(v){_siSkuTypeFilter=v;_siSkuLimit=200;_siSkuExpanded.clear();
  const rows=_siComputeSkuTable();
  const el=document.getElementById('si-content');
  if(el)el.innerHTML=_siSkuTableSection(rows);
};
window._siClearSel=function(){
  _siSkuSelected.clear();
  const bar=document.getElementById('si-cat-bar');if(bar)bar.outerHTML=_siCatSelBar();
  const rows=_siComputeSkuTable();
  const filtered=_siSkuFiltered(rows);
  const tb=document.getElementById('si-sku-tbody');
  if(tb){tb.innerHTML=_siGroupedBodyHtml(filtered);_siFixIndeterminate();}
};
window._siExportSelectedCsv=function(){
  if(!_siSkuSelected.size)return showToast('Nothing selected.',true);
  const rows=_siComputeSkuTable();
  const sel=rows.filter(r=>_siSkuSelected.has(r.sku));
  const cats=_siCustomCats||{};const seasons=_siCustomSeasons||{};const types=_siCustomTypes||{};
  const esc=s=>'"'+(String(s||'').replace(/"/g,'""'))+'"';
  const lines=['SKU,Product,Color,Size,On Hand,Sold 7d,Sold 30d,Weeks of Supply,Category,Season,Garment Type,Product Type'];
  for(const r of sel){
    const wos=r.dailyRate>0.05?(r.onHand/r.dailyRate/7).toFixed(1):'∞';
    lines.push([esc(r.sku),esc(r.title),esc(r.color),esc(r.size||'?'),r.onHand,r.s7||0,r.s30||0,wos,esc(cats[r.sku]||r.productType||''),esc(seasons[r.sku]||''),esc(types[r.sku]||''),esc(r.productType||'')].join(','));
  }
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`groovy-sku-${new Date().toISOString().slice(0,10)}.csv`;a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${sel.length} SKU${sel.length>1?'s':''} to CSV ✓`);
};
window._siToggleGroup=function(key){
  if(_siSkuExpanded.has(key))_siSkuExpanded.delete(key);else _siSkuExpanded.add(key);
  const rows=_siComputeSkuTable();
  const filtered=_siSkuFiltered(rows);
  const tb=document.getElementById('si-sku-tbody');
  if(tb){tb.innerHTML=_siGroupedBodyHtml(filtered);_siFixIndeterminate();}
};
window._siToggleGroupSel=function(key,checked){
  const rows=_siComputeSkuTable();
  const groups=_siGroupRows(_siSkuFiltered(rows));
  const g=groups[key];if(!g)return;
  g.variants.forEach(r=>checked?_siSkuSelected.add(r.sku):_siSkuSelected.delete(r.sku));
  const bar=document.getElementById('si-cat-bar');if(bar)bar.outerHTML=_siCatSelBar();
  const filtered=_siSkuFiltered(rows);
  const tb=document.getElementById('si-sku-tbody');
  if(tb){tb.innerHTML=_siGroupedBodyHtml(filtered);_siFixIndeterminate();}
};

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
  const groups=_siGroupRows(filtered);
  const totalGroups=Object.keys(groups).length;
  const tb=document.getElementById('si-sku-tbody');
  if(tb){
    tb.innerHTML=_siGroupedBodyHtml(filtered)||(totalGroups===0?`<tr><td colspan="13" style="text-align:center;padding:32px;color:var(--muted);font-size:14px">No products match your filters</td></tr>`:'');
    _siFixIndeterminate();
  }
  const cnt=document.getElementById('si-sku-count');
  if(cnt)cnt.textContent=totalGroups+' products · '+filtered.length+' variants'+(totalGroups>_siSkuLimit?' (showing '+_siSkuLimit+')':'');
  const more=document.getElementById('si-sku-more');
  if(more)more.innerHTML=totalGroups>_siSkuLimit?`<button class="btn-primary" onclick="window._siSkuLoadMore()">Load more (showing ${Math.min(_siSkuLimit,totalGroups)} of ${totalGroups} products)</button>`:'';
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
          <div class="stat-val" style="${wc.net_change<0?'color:var(--accent-urgent)':''}">${wc.net_change!=null?(wc.net_change>0?'+':'')+_siFmt(wc.net_change):'—'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Line Items</div>
          <div class="stat-val">${_siFmt(wc.line_items_counted)}</div>
        </div>
      </div>
      ${wc.top_sku?`<div style="font-size:13px;margin-bottom:4px">Top SKU: <strong>${wc.top_sku.sku}</strong>${_siGetProd(wc.top_sku.sku).product_title?` — ${_siGetProd(wc.top_sku.sku).product_title}`:''} (${wc.top_sku.quantity} units)</div>`:''}
      ${wc.top_category?`<div style="font-size:13px;margin-bottom:8px">Top Category: <strong>${wc.top_category.category}</strong> (${wc.top_category.quantity} units)</div>`:''}
      ${wc.by_category?`<div style="margin-top:8px"><div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px">By Category</div>${_siBarChart(Object.entries(wc.by_category).sort((a,b)=>b[1]-a[1]),8)}</div>`:''}
    </div>`;
  }).join('');
}

// ── Advanced (9 features) ───────────────────────────────────────────
function _siAdvancedSection(skuRows){
  const wos=_siWeeksOfSupply(skuRows);
  const md=_siMarkdownCandidates(skuRows);
  const stockouts=skuRows.filter(r=>r.onHand<=0&&r.s30>0).sort((a,b)=>b.s30-a.s30).slice(0,15);
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

  <div class="card" style="border-left:3px solid var(--accent-urgent)">
    <div class="card-title">Lost Sales / Stockout Detection</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">SKUs with zero inventory but recent (30d) sales — potential lost revenue</div>
    ${stockouts.length?stockouts.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:13px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:12px;color:var(--muted)">${r.color} / ${r.size} · sold ${r.s30} in 30d</div>
      </div>
      <div style="text-align:right;font-weight:700;color:var(--accent-urgent)">OUT</div>
    </div>`).join(''):'<div class="empty">No stockouts with recent demand</div>'}
  </div>

  <div class="card">
    <div class="card-title">Variant Aging (first / last sold)</div>
    <div style="overflow-x:auto"><table class="cut-table" style="min-width:600px">
      <thead><tr><th>SKU</th><th>Product</th><th>First Sold</th><th>Last Sold</th><th>Days Since</th><th>Total Sold</th></tr></thead>
      <tbody>${skuRows.filter(r=>r.firstSold).sort((a,b)=>(b.daysSinceLastSale||0)-(a.daysSinceLastSale||0)).slice(0,20).map(r=>`<tr>
        <td style="font-weight:600;font-size:12px">${r.sku}</td>
        <td style="font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}</td>
        <td style="font-size:12px">${(r.firstSold||'').slice(0,10)}</td>
        <td style="font-size:12px">${(r.lastSold||'').slice(0,10)}</td>
        <td style="${r.daysSinceLastSale>30?'color:var(--accent-urgent);font-weight:600':''}">${r.daysSinceLastSale!=null?r.daysSinceLastSale+'d':'—'}</td>
        <td>${r.totalSold}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="card">
    <div class="card-title">Reorder Points + Suggested Qty</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Based on 30d daily rate. Reorder point = 14 days cover. Suggested qty = 30 days cover minus on hand.</div>
    <div style="overflow-x:auto"><table class="cut-table" style="min-width:600px">
      <thead><tr><th>SKU</th><th>Product</th><th>Daily Rate</th><th>On Hand</th><th>Reorder Pt</th><th>Suggested Qty</th></tr></thead>
      <tbody>${skuRows.filter(r=>r.suggestedQty>0).sort((a,b)=>b.suggestedQty-a.suggestedQty).slice(0,20).map(r=>`<tr>
        <td style="font-weight:600;font-size:12px">${r.sku}</td>
        <td style="font-size:12px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}</td>
        <td>${r.dailyRate.toFixed(1)}/day</td>
        <td>${r.onHand}</td>
        <td>${r.reorderPoint}</td>
        <td style="font-weight:700">${r.suggestedQty}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>

  ${dropPerf.length?`<div class="card">
    <div class="card-title">Drop Performance Tracker</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Products created in the last 30 days — early sell-through signal</div>
    ${dropPerf.map(r=>`<div class="info-row">
      <div>
        <div style="font-weight:600;font-size:13px">${r.sku} <span style="color:var(--muted);font-weight:400">${r.title}</span></div>
        <div style="font-size:12px;color:var(--muted)">Launched ${(r.created_at||'').slice(0,10)} · ${r.daysLive}d live</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">${r.totalSold} sold</div>
        <div style="font-size:11px;color:var(--muted)">${r.dailyRate.toFixed(1)}/day · ${r.onHand} left</div>
      </div>
    </div>`).join('')}
  </div>`:''}

  <div class="card">
    <div class="card-title">Returns Signal per SKU</div>
    ${_siReturnsTable(skuRows)}
  </div>

  ${md.length?`<div class="card">
    <div class="card-title">Markdown Candidates (cash-freed estimate)</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">45+ days no sale, 10+ units. Markdown at 30% off frees the estimated cash below.</div>
    <div style="overflow-x:auto"><table class="cut-table">
      <thead><tr><th>SKU</th><th>On Hand</th><th>Days No Sale</th><th>Cash Tied (retail)</th><th>Cash Freed (30% off)</th></tr></thead>
      <tbody>${md.map(r=>`<tr>
        <td style="font-weight:600;font-size:12px">${r.sku}</td>
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
        <td style="font-weight:600;font-size:12px">${r.sku}</td>
        <td style="font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}</td>
        <td style="font-weight:600;color:var(--accent-urgent)">${r.refunds}</td>
        <td>${r.totalSold}</td>
        <td style="${parseFloat(rate)>10?'color:var(--accent-urgent);font-weight:600':''}">${rate}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════
   Article Explorer (Sept 2026) — Search one article, or Compare up to 5.
   Reads ONLY what the dashboard already loaded (_siLineItems, _siProducts,
   _siSnapshot, _siWeeklyCloses): no new Firestore reads. Refunded line items
   are excluded exactly as in "Sold since live". Days are the first 10
   characters of Shopify's offset timestamp (store-local) and all calendar
   arithmetic is on those strings via UTC day numbers — never a Date built
   from local time, never toISOString().slice(0,10).
   Chart text is HTML and colours are --si-s0..s4 tokens (see the CSS).
   ═══════════════════════════════════════════════════════════════════════ */
const _SI_AX_MAX=5;
const _SI_AX_DASH=['none','7 4','2 4','9 3 2 3','14 4'];
const _SI_AX_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Metrics OFFERED. Stock over time is deliberately absent: loadShopifyData reads
// only two snapshot documents (today and a week ago), not a history.
const _SI_AX_METRICS={
  units_week:{label:'Units sold per week',bucket:'week',field:'u'},
  units_month:{label:'Units sold per month',bucket:'month',field:'u'},
  revenue_week:{label:'Revenue per week',bucket:'week',field:'r',money:true},
  revenue_month:{label:'Revenue per month',bucket:'month',field:'r',money:true},
  cum_week:{label:'Cumulative units since live',bucket:'week',field:'u',cum:true},
  // Exposure-aware series (docs/UNITS_METRICS.md). They use ONLY the counted window
  // (from max(live date, first synced order)); a bucket is divided by the live days
  // actually counted in it, so a partial first or last week is not understated.
  rate_day:{label:'Rate of sale — units per live day',bucket:'week',kind:'rate',dec:2},
  roll4:{label:'4-week rolling rate — units per week',bucket:'week',kind:'roll',dec:1},
  st_build:{label:'Sell-through build — cumulative units ÷ (units + on hand now)',bucket:'week',kind:'st',pct:true}
};
let _siAxModeSel='search',_siAxQuery='',_siAxSel='',_siAxCmp=[],_siAxMetric='units_week',_siAxBasis='calendar',_siAxBucket='week',_siAxMsg='';
let _siAxCache=null,_siAxHov=null;

// Refunded AND voided orders are left out of every Explorer figure. (Other Inventory Intel
// tables exclude refunded only, so totals can differ from them by the voided orders.)
function _siAxCode(sku){return _siCleanCode(_siCleanSku(sku));} // one SKU/code rule: the _siClean one
function _siAxDayOf(iso){const s=String(iso||'').slice(0,10);return/^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';}
function _siAxDayNum(day){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day||'');return m?Math.floor(Date.UTC(+m[1],+m[2]-1,+m[3])/86400000):null;}
function _siAxDayStr(n){const d=new Date(n*86400000);return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');}
function _siAxBucketStart(day,bucket){
  if(bucket==='month')return String(day).slice(0,7)+'-01';
  const n=_siAxDayNum(day);return n==null?'':_siAxDayStr(n-((n+3)%7)); // Monday start; epoch day 0 was a Thursday
}
function _siAxBucketNext(start,bucket){
  const n=_siAxDayNum(start);if(n==null)return'';
  if(bucket==='month'){const y=+start.slice(0,4),m=+start.slice(5,7);return _siAxDayStr(Math.floor(Date.UTC(y,m,1)/86400000));}
  return _siAxDayStr(n+7);
}
function _siAxBucketEnd(start,bucket){const nx=_siAxBucketNext(start,bucket);const n=_siAxDayNum(nx);return n==null?'':_siAxDayStr(n-1);}
function _siAxFmtDay(d,short){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d||'');if(!m)return'—';return(+m[3])+' '+_SI_AX_MONTHS[+m[2]-1]+(short?'':' '+m[1]);}
function _siAxFmtBucket(start,bucket,tick){
  const m=/^(\d{4})-(\d{2})/.exec(start||'');if(!m)return'—';
  if(bucket==='month')return _SI_AX_MONTHS[+m[2]-1]+' '+(tick?m[1].slice(2):m[1]);
  return _siAxFmtDay(start,tick);
}
function _siAxSizeOf(sku,li){
  const p=_siCleanProd(sku);let s=(p.size||'').trim();const c=(p.color||'').trim();
  if(_SI_KNOWN_SIZES.has(c.toUpperCase()))s=c; // options swapped on some products
  if(!s&&li&&li.size)s=String(li.size).trim();
  return s?s.toUpperCase():'Unknown';
}
function _siAxSizeSort(a,b){
  const ai=_SI_SIZE_ORDER.indexOf(a),bi=_SI_SIZE_ORDER.indexOf(b);
  if(ai>=0&&bi>=0)return ai-bi;if(ai>=0)return-1;if(bi>=0)return 1;
  return String(a).localeCompare(String(b),undefined,{numeric:true});
}

// ═══ _siClean — Article Explorer data cleaning (one block; pure; run once per data load) ═══
// Takes the already-loaded arrays (NO new reads) and returns the rows the Explorer
// should count plus a `quality` object of counts per rule, so nothing is dropped silently.
// It never mutates its input and never changes the 7D/30D/season columns elsewhere in this file.
let _siCleanLast=null;
function _siCleanSku(s){const v=String(s==null?'':s).replace(/\s+/g,'').toUpperCase();return v==='NO-SKU'?'':v;}
function _siCleanCode(nsku){return nsku?nsku.split('-')[0]:'';}
function _siCleanCatKey(t){return String(t==null?'':t).replace(/\s+/g,' ').trim().toLowerCase();}
function _siCleanCatText(t){return String(t==null?'':t).replace(/\s+/g,' ').trim();}
// Category groups: case/whitespace-insensitive key -> most common spelling (ties: A-Z). Blank -> 'Unknown'.
function _siCleanCategories(rows){
  const tally=new Map();
  rows.forEach(t=>{const k=_siCleanCatKey(t);if(!k)return;let m=tally.get(k);if(!m){m=new Map();tally.set(k,m);}const sp=_siCleanCatText(t);m.set(sp,(m.get(sp)||0)+1);});
  const label=new Map();let merged=0;
  tally.forEach((m,k)=>{const best=[...m.entries()].sort((a,b)=>(b[1]-a[1])||(a[0]<b[0]?-1:1))[0][0];label.set(k,best);merged+=m.size-1;});
  return{label,merged,groups:tally.size};
}
function _siCleanIsRefunded(li){return String(li&&li.financial_status||'').trim().toLowerCase()==='refunded';}
// Voided: Shopify's financial_status 'voided' on the line item (copied from the order at sync time),
// or the order's own cancelled_at (joined via order_id; line items carry no cancelled_at themselves).
function _siCleanIsVoided(li){return String(li&&li.financial_status||'').trim().toLowerCase()==='voided';}
function _siClean(src){
  const products=(src&&src.products)||[],lineItems=(src&&src.lineItems)||[],orders=(src&&src.orders)||[],snap=src&&src.snapshot;
  const q={
    lineItems:{total:lineItems.length,used:0,refunded:0,voided:0,cancelledOrder:0,noSku:0,badDate:0,duplicateId:0,voidedStillInExisting7d30d:0},
    products:{total:products.length,noSku:0,duplicateSkuRows:0,used:0},
    snapshot:{entries:0,noSku:0,negativeClamped:0,duplicateSkus:0,duplicateEntries:0,used:0},
    skuNormalised:0,
    categories:{groups:0,spellingsMerged:0,blankProducts:0}
  };
  const normCount=raw=>{if(raw!=null&&String(raw)!==''&&_siCleanSku(raw)!==String(raw))q.skuNormalised++;};
  // categories (products + line items share one vocabulary)
  const cats=_siCleanCategories(products.map(p=>p.product_type).concat(lineItems.map(l=>l.product_type)));
  q.categories.groups=cats.groups;q.categories.spellingsMerged=cats.merged;
  const catOf=t=>{const k=_siCleanCatKey(t);return k?cats.label.get(k):'Unknown';};
  // products
  const prodBySku=new Map(),prods=[];
  products.forEach(p=>{
    if(_siCleanCatKey(p.product_type)==='')q.categories.blankProducts++;
    const n=_siCleanSku(p.sku);
    if(!n){q.products.noSku++;return;}
    normCount(p.sku);
    if(prodBySku.has(n)){q.products.duplicateSkuRows++;return;}
    const r=Object.assign({},p,{_nsku:n,_code:_siCleanCode(n),_cat:catOf(p.product_type)});
    prodBySku.set(n,r);prods.push(r);q.products.used++;
  });
  // line items
  const cancelled=new Set();orders.forEach(o=>{if(o&&o.cancelled_at)cancelled.add(String(o._id!=null?o._id:o.order_id));});
  const seen=new Set(),lis=[];
  lineItems.forEach(li=>{
    if(_siCleanIsRefunded(li)){q.lineItems.refunded++;return;}
    if(_siCleanIsVoided(li)){q.lineItems.voided++;q.lineItems.voidedStillInExisting7d30d++;return;}
    if(li.order_id!=null&&cancelled.has(String(li.order_id))){q.lineItems.cancelledOrder++;return;}
    if(li.order_id!=null&&li.line_item_id!=null){
      const k=li.order_id+'_'+li.line_item_id;
      if(seen.has(k)){q.lineItems.duplicateId++;return;}
      seen.add(k);
    }
    const n=_siCleanSku(li.sku);
    if(!n){q.lineItems.noSku++;return;}
    normCount(li.sku);
    const day=String(li.order_created_at||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)){q.lineItems.badDate++;return;}
    const qty=Number(li.quantity),pr=Number(li.price);
    lis.push({li,nsku:n,code:_siCleanCode(n),day,qty:isFinite(qty)?qty:0,price:isFinite(pr)?pr:0,cat:catOf(li.product_type)});
    q.lineItems.used++;
  });
  // stock: clamp negatives to 0, skip no-SKU, sum duplicate SKUs
  const stockBy=new Map();
  if(snap&&snap.items){
    for(const id in snap.items){
      const it=snap.items[id]||{};q.snapshot.entries++;
      const n=_siCleanSku(it.sku);
      if(!n){q.snapshot.noSku++;continue;}
      normCount(it.sku);
      let av=Number(it.available);if(!isFinite(av))av=0;
      if(av<0){q.snapshot.negativeClamped++;av=0;}
      const s=stockBy.get(n);
      if(s){if(s.entries===1)q.snapshot.duplicateSkus++;s.entries++;q.snapshot.duplicateEntries++;s.available+=av;}
      else stockBy.set(n,{nsku:n,code:_siCleanCode(n),sku:it.sku,available:av,entries:1});
    }
  }
  q.snapshot.used=stockBy.size;
  return{products:prods,prodBySku,lineItems:lis,stock:[...stockBy.values()],quality:q};
}
function _siCleanProd(sku){const m=_siCleanLast&&_siCleanLast.prodBySku;return(m&&m.get(_siCleanSku(sku)))||_siGetProd(sku);}
function _siCleanQualityHtml(q){
  if(!q)return'';
  const L=q.lineItems,P=q.products,S=q.snapshot;
  const skipped=L.refunded+L.voided+L.cancelledOrder+L.noSku+L.badDate+L.duplicateId;
  const row=(n,t)=>n?`<li><strong>${n}</strong> ${t}</li>`:'';
  const items=[
    row(L.refunded,'refunded line items left out'),
    row(L.voided,'voided line items left out'),
    row(L.cancelledOrder,'line items of cancelled orders left out'),
    row(L.noSku,'line items with no SKU skipped'),
    row(L.badDate,'line items with no usable date skipped'),
    row(L.duplicateId,'repeated line items (same order + line id) counted once'),
    row(P.noSku,'catalog products with an empty SKU skipped'),
    row(P.duplicateSkuRows,'catalog rows repeating a SKU ignored (first kept)'),
    row(S.noSku,'stock entries with no SKU skipped'),
    row(S.negativeClamped,'negative stock figures counted as 0'),
    row(S.duplicateSkus,'SKUs listed more than once in the stock snapshot, summed ('+S.duplicateEntries+' extra entries)'),
    row(q.skuNormalised,'SKUs tidied (case / spaces)'),
    row(q.categories.spellingsMerged,'category spellings merged into one label')
  ].join('');
  const warn=L.voidedStillInExisting7d30d?`<div style="margin-top:4px">Note: the Sold 7d / 30d columns elsewhere on this page still count the ${L.voidedStillInExisting7d30d} voided line items; this tab leaves them out.</div>`:'';
  return`<details class="si-ax-note" id="si-ax-quality"><summary>Data quality — ${L.used} of ${L.total} line items counted, ${skipped} left out</summary><ul style="margin:4px 0 0 18px;padding:0">${items||'<li>Nothing needed cleaning.</li>'}</ul>${warn}</details>`;
}
// ═══ end _siClean ═══

// Per-article index, built once per data load (keyed on the loaded arrays).
function _siAxIndex(){
  const c=_siAxCache;
  if(c&&c.li===_siLineItems&&c.n===_siLineItems.length&&c.pr===_siProducts&&c.sn===_siSnapshot&&c.pv===_siPrevSnapshot&&c.hv===_siHist)return c;
  const cl=_siClean({products:_siProducts,lineItems:_siLineItems,orders:_siOrders,snapshot:_siSnapshot});
  _siCleanLast=cl;
  const arts=new Map();
  const get=code=>{
    let a=arts.get(code);
    if(!a){a={code,title:'',color:'',category:'',skus:new Set(),liveAt:'',daily:new Map(),sizes:{},units:0,rev:0,hasPrice:false,firstDay:'',lastDay:'',stock:{},onHand:0,hasStock:false,prevStock:{},prevOnHand:0,hasPrev:false,sdaily:{}};arts.set(code,a);}
    return a;
  };
  cl.products.forEach(p=>{
    const a=get(p._code);a.skus.add(p._nsku);
    if(!a.title&&p.product_title)a.title=p.product_title;
    if(!a.color){const rc=(p.color||'').trim();a.color=_SI_KNOWN_SIZES.has(rc.toUpperCase())?(p.size||'').trim():rc;}
    if(!a.category&&p._cat&&p._cat!=='Unknown')a.category=p._cat;
    // Publish date only. created_at is Shopify's creation date (2021+), not a launch date, so it is never used as one.
    const live=p.published_at||'';
    if(live&&(!a.liveAt||live<a.liveAt))a.liveAt=live;
  });
  cl.lineItems.forEach(r=>{
    const li=r.li,day=r.day;
    const a=get(r.code);a.skus.add(r.nsku);
    if(!a.title&&li.product_title)a.title=li.product_title;
    if(!a.color&&li.color)a.color=li.color;
    const q=r.qty,pr=r.qty*r.price;
    let d=a.daily.get(day);if(!d){d={u:0,r:0};a.daily.set(day,d);}
    d.u+=q;d.r+=pr;a.units+=q;a.rev+=pr;if(r.price)a.hasPrice=true;
    const sz=_siAxSizeOf(li.sku,li);a.sizes[sz]=(a.sizes[sz]||0)+q;
    const sd=a.sdaily[sz]||(a.sdaily[sz]=new Map());sd.set(day,(sd.get(day)||0)+q);
    if(!a.firstDay||day<a.firstDay)a.firstDay=day;
    if(!a.lastDay||day>a.lastDay)a.lastDay=day;
    if(!a.category&&r.cat&&r.cat!=='Unknown')a.category=r.cat;
  });
  cl.stock.forEach(it=>{
    if(!arts.has(it.code))return;
    const a=arts.get(it.code),av=it.available,sz=_siAxSizeOf(it.sku,null);
    a.stock[sz]=(a.stock[sz]||0)+av;a.onHand+=av;a.hasStock=true;
  });
  if(_siPrevSnapshot&&_siPrevSnapshot.items){
    // same cleaning rules as today's stock (one implementation); its counts are not reported
    _siClean({snapshot:_siPrevSnapshot}).stock.forEach(it=>{
      if(!arts.has(it.code))return;
      const a=arts.get(it.code),av=it.available,sz=_siAxSizeOf(it.sku,null);
      a.prevStock[sz]=(a.prevStock[sz]||0)+av;a.prevOnHand+=av;a.hasPrev=true;
    });
  }
  const list=[...arts.values()];
  const catUnits=new Map();
  list.forEach(a=>{if(a.category)catUnits.set(a.category,(catUnits.get(a.category)||0)+a.units);});
  list.forEach(a=>{
    a.liveDay=_siAxDayOf(a.liveAt);
    a.name=a.title||a.code;
    a.text=[a.code,a.title,a.color,a.category,[...a.skus].join(' ')].join(' ').toLowerCase();
  });
  list.sort((x,y)=>(y.units-x.units)||String(x.name).localeCompare(String(y.name)));
  _siAxCache={li:_siLineItems,n:_siLineItems.length,pr:_siProducts,sn:_siSnapshot,pv:_siPrevSnapshot,hv:_siHist,list,map:arts,catUnits,cov:_siEarliestOrderDate(),quality:cl.quality};
  return _siAxCache;
}
function _siAxLabel(a){return a.name+(a.color?' — '+a.color:'');}

// Search: every word must appear in code / title / colour / category / SKUs.
function _siAxSearch(q,limit){
  const toks=String(q||'').toLowerCase().split(/\s+/).filter(Boolean);
  const list=_siAxIndex().list;
  const out=toks.length?list.filter(a=>toks.every(t=>a.text.includes(t))):list;
  return{hits:out.slice(0,limit||12),total:out.length};
}
function _siAxUnitsSince(a,days){
  const cut=_siPktDate(-days);let u=0,r=0;
  a.daily.forEach((d,day)=>{if(day>=cut){u+=d.u;r+=d.r;}});
  return{u,r};
}
// Weekly / monthly totals per article, cached on the article.
function _siAxBuckets(a,bucket){
  const k='_b_'+bucket;if(a[k])return a[k];
  const m=new Map();
  a.daily.forEach((d,day)=>{const b=_siAxBucketStart(day,bucket);let x=m.get(b);if(!x){x={u:0,r:0};m.set(b,x);}x.u+=d.u;x.r+=d.r;});
  a[k]=m;return m;
}


// ── Stock history: ONE bounded read, cached for the session ─────────
// shopify_inventory_snapshots holds one document per store-local day (written by
// netlify/functions/shopify-inventory-snapshot.js, about 22:00 PKT, overwriting
// the 10:00 run). Loaded only when the Explorer opens, never rejects, and each
// document is folded into a per-article on-hand map at once so the big `items`
// objects are not kept. A day whose snapshot has far fewer items than usual
// (a truncated run) is dropped rather than read as stock-outs.
const _SI_HIST_MAX=150;          // newest N daily documents = at most N reads per session
const _SI_HIST_MIN_SHARE=0.8;    // a snapshot below 80% of the median item count is treated as incomplete
const _SI_HIST_TIMEOUT=90000;
const _SI_RECV_MIN=5,_SI_RECV_SHARE=0.10; // a receipt counts only when the unexplained increase is at least max(5, 10% of the opening stock)
let _siHist=null,_siHistState='idle',_siHistError='',_siHistPromise=null;
function _siAxBuildHistory(docs){
  const good=(docs||[]).filter(d=>d&&d.date&&d.items&&typeof d.items==='object'&&/^\d{4}-\d{2}-\d{2}$/.test(String(d.date)));
  const counts=good.map(d=>Object.keys(d.items).length).sort((x,y)=>x-y);
  const med=counts.length?counts[Math.floor(counts.length/2)]:0;
  const byCode=new Map(),dates=[],dropped=[];
  good.sort((x,y)=>String(x.date).localeCompare(String(y.date)));
  good.forEach(d=>{
    const n=Object.keys(d.items).length;
    if(med&&n<med*_SI_HIST_MIN_SHARE){dropped.push(d.date);return;}
    if(dates.length&&dates[dates.length-1]===d.date)return;
    dates.push(d.date);
    const sums=new Map();
    for(const id in d.items){const it=d.items[id];const code=_siAxCode(it&&it.sku);if(!code)continue;sums.set(code,(sums.get(code)||0)+Math.max(0,it.available||0));}
    sums.forEach((v,code)=>{let m=byCode.get(code);if(!m){m=new Map();byCode.set(code,m);}m.set(d.date,v);});
  });
  return{dates,byCode,dropped,from:dates[0]||'',to:dates[dates.length-1]||'',docs:good.length};
}
function _siAxEnsureHistory(force){
  if(_siHistPromise)return _siHistPromise;
  if(!force&&(_siHistState==='ok'||_siHistState==='error'))return Promise.resolve();
  _siHistState='loading';_siHistError='';
  const rd=(async()=>{
    const snap=await getDocs(query(collection(db,'shopify_inventory_snapshots'),orderBy('date','desc'),limit(_SI_HIST_MAX)));
    const docs=[];snap.forEach(d=>docs.push(d.data()));
    return _siAxBuildHistory(docs);
  })();
  const to=new Promise((_,rej)=>setTimeout(()=>rej(new Error('timed out after '+(_SI_HIST_TIMEOUT/1000)+'s')),_SI_HIST_TIMEOUT));
  _siHistPromise=Promise.race([rd,to]).then(h=>{_siHist=h;_siHistState='ok';}).catch(e=>{_siHist=null;_siHistState='error';_siHistError=(e&&e.message)||String(e);}).then(()=>{
    _siHistPromise=null;_siAxCache=null;
    if(typeof document!=='undefined'&&document.getElementById&&document.getElementById('si-ax-body'))_siAxRepaintBody();
  });
  return _siHistPromise;
}
window._siAxRetryHistory=function(){_siAxEnsureHistory(true);_siAxRepaintBody();};

// ── Measures (docs/UNITS_METRICS.md) ────────────────────────────────
// Everything here reads data already loaded. The counted window starts at
// max(live date, first synced order) — or at the first counted sale when the
// catalog has no live date — so articles of different ages are compared over
// days we can actually see. Missing inputs are null, shown as "—", never 0.
// With a publish date: its later of publish date and first synced order. Without one (every
// product today: published_at is not stored yet): an article that sold within a week of the
// first synced order is treated as already live at the data start; one that first sold later is
// treated as launched on its first sale. Both are proxies and are labelled "first sale".
const _SI_AX_EARLY_DAYS=7;
function _siAxCountedStart(a,cov){
  if(a.liveDay)return cov&&a.liveDay<cov?cov:a.liveDay;
  if(!a.firstDay)return'';
  if(cov&&_siAxDayNum(a.firstDay)-_siAxDayNum(cov)<=_SI_AX_EARLY_DAYS)return cov;
  return a.firstDay;
}
function _siAxUnitsBetween(a,s,e){
  let u=0;a.daily.forEach((d,day)=>{if(day>=s&&day<=e)u+=d.u;});return u;
}
function _siAxSizeUnitsBetween(a,sz,s,e){
  const m=a.sdaily&&a.sdaily[sz];let u=0;if(m)m.forEach((q,day)=>{if(day>=s&&day<=e)u+=q;});return u;
}
function _siAxDayAdd(day,n){const k=_siAxDayNum(day);return k==null?'':_siAxDayStr(k+n);}
// In-stock exposure from the loaded history. A day D is MEASURABLE when the
// snapshots of D-1 and D both exist for the article; it is an IN-STOCK day when
// stock was above 0 at the end of D-1 or of D, and a STOCK-OUT day when both
// were 0. Days without two snapshots are left out of numerator and denominator.
function _siAxExposure(a,from,to){
  const H=_siHist,r={measured:0,inStock:0,out:0,units:0,unitsIn:0,run:null};
  if(!H||!H.byCode)return r;
  const h=H.byCode.get(a.code);if(!h)return r;
  const fn=_siAxDayNum(from),tn=_siAxDayNum(to);if(fn==null||tn==null)return r;
  let run=null;
  for(let k=fn;k<=tn;k++){
    const D=_siAxDayStr(k),P=_siAxDayStr(k-1);
    const x=h.get(D),y=h.get(P);
    if(x==null||y==null){run=null;continue;}
    const sold=(a.daily.get(D)||{u:0}).u;
    r.measured++;
    if(x>0||y>0){r.inStock++;r.unitsIn+=sold;}else r.out++;
    if(!run)run={from:D,opening:y,sold:0,received:0,days:0};
    const resid=x-y+sold;run.sold+=sold;if(resid>=Math.max(_SI_RECV_MIN,_SI_RECV_SHARE*y))run.received+=resid; // small residuals are noise, not receipts
    run.days++;run.to=D;run.closing=x;
    r.run=run.days>=(r.run?r.run.days:0)?Object.assign({},run):r.run; // keep the contiguous run that reaches furthest
  }
  return r;
}
function _siAxStats(a){
  const idx=_siAxIndex();
  if(!idx.statsMap)idx.statsMap=new Map();
  const hit=idx.statsMap.get(a.code);if(hit)return hit;
  const o=_siAxStatsCalc(a,idx);idx.statsMap.set(a.code,o);return o;
}
function _siAxStatsCalc(a,idx){
  const today=_siPktDate(0),cov=idx.cov||'';
  const E=_siAxCountedStart(a,cov);
  const o={E,today,cov,noLive:!a.liveDay,partial:!!(a.liveDay&&cov&&a.liveDay<cov),days:null,units:null,units28:null,
    rateWeek:null,pace28:null,pace28Days:null,momentum:null,cover:null,coverDays:null,coverBasis:'',
    sellingWeeks:null,blocks:0,peak:null,first4:null,catShare:null,catUnits:null,asp:null,
    st:null,received:null,sizesNow:null,sizesPrev:null,risk:[],sizeRows:[],
    inRate:null,inDays:null,outDays:null,measured:null,perInDay:null,histState:_siHistState};
  const Tn=_siAxDayNum(today),En=E?_siAxDayNum(E):null;
  if(En!=null&&En<=Tn){
    const days=Tn-En+1;o.days=days;
    const u=_siAxUnitsBetween(a,E,today);o.units=u;
    if(days>=7)o.rateWeek=u/days*7;
    const s28=Math.max(En,Tn-27),d28=Tn-s28+1;o.pace28Days=d28;
    o.units28=_siAxUnitsBetween(a,_siAxDayStr(s28),today);
    if(d28>=7)o.pace28=o.units28/d28*7;
    if(days>=56){
      const last=_siAxUnitsBetween(a,_siAxDayStr(Tn-27),today),prev=_siAxUnitsBetween(a,_siAxDayStr(Tn-55),_siAxDayStr(Tn-28));
      if(prev>0)o.momentum=last/prev-1;
    }
    const nB=Math.floor(days/7);o.blocks=nB;
    if(nB>=1){
      let sell=0,best=0,bestK=-1;
      for(let k=0;k<nB;k++){
        const bu=_siAxUnitsBetween(a,_siAxDayStr(En+7*k),_siAxDayStr(En+7*k+6));
        if(bu>0)sell++;if(bu>best){best=bu;bestK=k;}
      }
      if(nB>=2)o.sellingWeeks=sell;
      if(best>0)o.peak={u:best,start:_siAxDayStr(En+7*bestK)};
    }
    if(!o.noLive&&!o.partial&&E===a.liveDay&&days>=28)o.first4=_siAxUnitsBetween(a,E,_siAxDayStr(En+27));
    if(a.hasPrice&&u>0){
      let r=0;a.daily.forEach((d,day)=>{if(day>=E&&day<=today)r+=d.r;});o.asp=r/u;
    }
    // exposure (needs the loaded snapshot history)
    const ex=_siAxExposure(a,E,today);
    if(ex.measured>=7){
      o.measured=ex.measured;o.inDays=ex.inStock;o.outDays=ex.out;o.inRate=ex.inStock/ex.measured;
      if(ex.inStock>=7)o.perInDay=ex.unitsIn/ex.inStock;
    }
    if(ex.run&&ex.run.days>=7&&(ex.run.opening+ex.run.received)>0){
      o.st={value:ex.run.sold/(ex.run.opening+ex.run.received),from:ex.run.from,to:ex.run.to,days:ex.run.days,sold:ex.run.sold,opening:ex.run.opening,received:ex.run.received,src:'history'};
      o.received=ex.run.received;
    }
    // weeks of cover: in-stock pace of the last 28 days when measured, else the plain 28-day pace
    if(a.hasStock){
      const ex28=_siAxExposure(a,_siAxDayStr(s28),today);
      if(ex28.inStock>=7){const p=ex28.unitsIn/ex28.inStock*7;if(p>0){o.cover=a.onHand/p;o.coverBasis='in-stock pace';}}
      else if(o.pace28!=null&&o.pace28>0){o.cover=a.onHand/o.pace28;o.coverBasis='28-day pace';}
      if(o.cover!=null)o.coverDays=o.cover*7;
    }
  }
  if(a.category){const cu=idx.catUnits.get(a.category)||0;o.catUnits=cu;if(cu>0)o.catShare=a.units/cu;}
  // two loaded snapshots (today's and a week ago) — the fallback when history is not loaded
  const curDate=(_siSnapshot&&_siSnapshot.date)||today,prevDate=_siPrevSnapshot&&_siPrevSnapshot.date;
  if(!o.st&&a.hasStock&&a.hasPrev&&prevDate&&_siAxDayNum(prevDate)!=null&&_siAxDayNum(prevDate)<_siAxDayNum(curDate)){
    const sold=_siAxUnitsBetween(a,_siAxDayAdd(prevDate,1),curDate);
    const resid=a.onHand-a.prevOnHand+sold;const recv=resid>=Math.max(_SI_RECV_MIN,_SI_RECV_SHARE*a.prevOnHand)?resid:0;
    if(a.prevOnHand+recv>0){o.st={value:sold/(a.prevOnHand+recv),from:prevDate,to:curDate,days:_siAxDayNum(curDate)-_siAxDayNum(prevDate),sold,opening:a.prevOnHand,received:recv,src:'two snapshots'};o.received=recv;}
  }
  const sizes=[...new Set(Object.keys(a.sizes).concat(Object.keys(a.stock),Object.keys(a.prevStock)))].sort(_siAxSizeSort);
  const cut28=_siAxDayStr(Tn-27);
  sizes.forEach(sz=>{
    const sold=a.sizes[sz]||0,st=a.hasStock&&(sz in a.stock)?a.stock[sz]:null;
    const pv=a.hasPrev&&(sz in a.prevStock)?a.prevStock[sz]:null;
    const r={size:sz,sold,stock:st,prev:pv,sellThrough:(st!=null&&sold+st>0)?sold/(sold+st):null,recent:_siAxSizeUnitsBetween(a,sz,cut28,today)};
    r.risk=st===0&&r.recent>0;
    if(r.risk)o.risk.push({size:sz,units:r.recent});
    o.sizeRows.push(r);
  });
  if(a.hasStock){const carried=o.sizeRows.filter(r=>r.stock!=null);if(carried.length)o.sizesNow={n:carried.filter(r=>r.stock>0).length,of:carried.length};}
  if(a.hasPrev){const carried=o.sizeRows.filter(r=>r.prev!=null);if(carried.length)o.sizesPrev={n:carried.filter(r=>r.prev>0).length,of:carried.length};}
  return o;
}
// Why a history-based figure is "—": say it, never leave a bare dash unexplained.
function _siAxHistWhy(m){
  if(_siHistState==='loading'||_siHistState==='idle')return'loading stock history…';
  if(_siHistState==='error')return'stock history could not be read';
  if(m.days==null)return'no counted days';
  return'needs 7+ measured days of stock history';
}

// ── Scorecard ───────────────────────────────────────────────────────
// DEFAULT thresholds — conventions for a first read derived from this store's own
// distributions (docs/UNITS_METRICS.md), NOT facts about the business. They are printed on
// screen beside the chart. First matching rule wins, in this order:
// Too early · Dead stock · Stock-constrained · Winner · Healthy · Slow.
const _SI_AX_SCORE={minDays:28,deadNoSaleDays:28,deadSellThrough:0.05,constrainedInStock:0.60,constrainedPerDay:0.55,winnerSellThrough:0.60,winnerInStock:0.80,healthySellThrough:0.20,overCoverWeeks:26};
const _SI_AX_CLASSES={
  early:{label:'Too early',act:'Not classed: wait for more counted days.'},
  unrated:{label:'Not rated',act:'Not classed: stock data is missing.'},
  dead:{label:'Dead stock',act:'Markdown, bundle or clear; do not reorder or re-cut.',shape:'cross'},
  constrained:{label:'Stock-constrained',act:'Demand is ahead of supply: restock or re-cut.',shape:'tri'},
  winner:{label:'Winner',act:'Protect stock, reorder early, consider more colourways.',shape:'star'},
  healthy:{label:'Healthy',act:'Hold and watch cover.',shape:'circle'},
  slow:{label:'Slow',act:'Review price or promotion; do not reorder; consider stopping production.',shape:'square'}
};
// Returns {cls,label,act,rule,unverified,skipped}. The rule is built from computed values only.
// A clause whose metric is "—" is skipped, never passed by default; if any clause was skipped
// while deciding, the row is flagged unverified.
function _siAxClassify(a){
  const m=_siAxStats(a),T=_SI_AX_SCORE,f=v=>_siAxNum(v),pc=v=>_siAxPct(v);
  const skipped=[];
  const out=(cls,rule)=>({cls,label:_SI_AX_CLASSES[cls].label,act:_SI_AX_CLASSES[cls].act,rule,unverified:skipped.length>0,skipped:skipped.slice()});
  if(m.days==null||m.days<T.minDays)return out('early','Only '+(m.days==null?0:m.days)+' counted day'+(m.days===1?'':'s')+'; classes start at '+T.minDays+'.');
  if(!a.hasStock&&!m.st)return out('unrated','No stock data for this article in the snapshots.');
  // clause: {name, val, test(val), say(val)}  — val null = unknown
  const evalRule=(clauses)=>{
    const ok=[],bad=[],miss=[];
    clauses.forEach(c=>{
      if(c.val==null){miss.push(c.name);return;}
      (c.test(c.val)?ok:bad).push(c.say(c.val));
    });
    return{ok,bad,miss};
  };
  const tryRule=(cls,clauses,any)=>{
    const r=evalRule(clauses);
    const hit=any?r.ok.length>0:(r.bad.length===0&&r.ok.length>0);
    if(!hit){r.miss.forEach(n=>{if(!skipped.includes(n))skipped.push(n);});return null;}
    const res=out(cls,r.ok.join(any?' or ':' and ')+'.');
    r.miss.forEach(n=>{if(!res.skipped.includes(n))res.skipped.push(n);});
    res.unverified=res.skipped.length>0;
    if(res.unverified)res.rule=res.rule.replace(/\.$/,'')+' ('+res.skipped.join(', ')+' unknown, clause skipped).';
    return res;
  };
  const noSale=a.hasStock&&m.pace28Days>=T.deadNoSaleDays?(m.units28===0&&a.onHand>0?0:1):null;
  let r=tryRule('dead',[
    {name:'sales in the last 28 days',val:noSale,test:v=>v===0,say:()=>'no sale in the last '+m.pace28Days+' counted days with '+a.onHand+' on hand'},
    {name:'sell-through',val:m.st?m.st.value:null,test:v=>v<T.deadSellThrough,say:v=>'sell-through '+pc(v)+' is below '+pc(T.deadSellThrough)}
  ],true);
  if(r)return r;
  r=tryRule('constrained',[
    {name:'in-stock rate',val:m.inRate,test:v=>v<T.constrainedInStock,say:v=>'in stock on '+pc(v)+' of '+m.measured+' measured days (below '+pc(T.constrainedInStock)+')'},
    {name:'units per in-stock day',val:m.perInDay,test:v=>v>=T.constrainedPerDay,say:v=>f(v)+' units per in-stock day (at least '+T.constrainedPerDay+')'}
  ]);
  if(r)return r;
  r=tryRule('winner',[
    {name:'sell-through',val:m.st?m.st.value:null,test:v=>v>=T.winnerSellThrough,say:v=>'sell-through '+pc(v)+' (at least '+pc(T.winnerSellThrough)+')'},
    {name:'in-stock rate',val:m.inRate,test:v=>v>=T.winnerInStock,say:v=>'in stock on '+pc(v)+' of measured days (at least '+pc(T.winnerInStock)+')'}
  ]);
  if(r)return r;
  r=tryRule('healthy',[
    {name:'sell-through',val:m.st?m.st.value:null,test:v=>v>=T.healthySellThrough,say:v=>'sell-through '+pc(v)+' (at least '+pc(T.healthySellThrough)+')'},
    {name:'weeks of cover',val:m.cover,test:v=>v<=T.overCoverWeeks,say:v=>f(v)+' weeks of cover (at most '+T.overCoverWeeks+')'}
  ]);
  if(r)return r;
  const why=[];
  if(m.st)why.push('sell-through '+pc(m.st.value));
  if(m.cover!=null&&m.cover>T.overCoverWeeks)why.push(f(m.cover)+' weeks of cover is above '+T.overCoverWeeks);
  const res=out('slow',(why.length?why.join(' and ')+': none of the earlier rules matched':'none of the earlier rules matched')+'.');
  return res;
}
function _siAxClassCounts(){
  const idx=_siAxIndex();if(idx.classCounts)return idx.classCounts;
  const c={};Object.keys(_SI_AX_CLASSES).forEach(k=>{c[k]=0;});
  idx.list.forEach(a=>{if(a.units>0||a.hasStock)c[_siAxClassify(a).cls]++;});
  idx.classCounts=c;return c;
}
// Plain-words definitions: one registry feeds the tooltips, the "How these are
// measured" list and docs/UNITS_METRICS.md. Keys 'net'..'curve' are the ten headline
// metrics; the rest are supporting figures.
const _SI_AX_DEFS=[
  {k:'net',label:'Net units',how:'units on non-refunded lines in the counted window',use:'Volume: what actually moved. Always read it with the counted days beside it.',read:'Low can simply mean few live days; high can simply mean long exposure.',cav:'Orders refunded when synced are left out; later refunds and cancellations are not seen.'},
  {k:'rate',label:'Units per live week',how:'net units ÷ counted days × 7',use:'Compare products of different ages; decide what to reorder or stop.',read:'Low: slow or under-exposed. High: strong demand. Compare to the peer lines, not to zero.',cav:'Counted window only (later of live date and first synced order). Needs 7+ counted days.'},
  {k:'st',label:'Sell-through %',how:'units sold ÷ (opening stock + estimated received) over the measured span',use:'Reorder or mark down: how much of what was available has gone.',read:'Low: stock is not moving (markdown, stop). High: nearly everything gone (restock, or you were short).',cav:'Span shown on screen. “Received” is inferred from stock changes plus sales, not recorded; needs 7+ contiguous snapshot days.'},
  {k:'inrate',label:'In-stock rate',how:'days in stock ÷ measured days (a day is out only when stock was 0 at the end of the day before and of that day)',use:'Separate “not selling” from “not available”.',read:'Low: sales are capped by availability, so velocity is understated. High: velocity is fair.',cav:'Only days with two snapshots are measured; article level (any size in stock counts).'},
  {k:'perday',label:'Units per in-stock day',how:'units sold on in-stock days ÷ in-stock days',use:'True demand rate; compare launches and size up a reorder.',read:'Well above units per live week: the article was often out of stock.',cav:'Needs 7+ in-stock measured days. Sales on out-of-stock days are excluded.'},
  {k:'out',label:'Stock-out days',how:'measured days with no stock (of measured days)',use:'Restock decisions and lost-sales review.',read:'High: availability, not demand, is the limit.',cav:'A count of measured days, never extrapolated to unmeasured ones.'},
  {k:'cover',label:'Weeks of cover',how:'on hand now ÷ weekly pace (in-stock pace of the last 28 days when measured, else the 28-day pace)',use:'When to reorder, and what is overstocked.',read:'Below ~2 weeks: reorder now. Above ~26 weeks: overstock, markdown or hold.',cav:'Assumes the pace continues; basis is printed beside the figure. Sensitive to the August peak (cause unverified).'},
  {k:'mom',label:'Momentum',how:'last 28 days’ pace ÷ the 28 days before − 1',use:'Is demand rising or fading: scale up, hold or exit.',read:'Negative: fading (watch before reordering). Positive: building.',cav:'Needs 56 counted days and sales in the earlier period. August units were over twice a normal month (cause unverified), so momentum swings with it.'},
  {k:'share',label:'Share of category',how:'net units ÷ all counted units of the same product type',use:'Range planning: which products carry a category.',read:'High: a pillar of the category. Low: a niche or a newcomer.',cav:'Mixes products of different ages; new articles start low.'},
  {k:'curve',label:'Age-normalised curve',how:'cumulative units by weeks since each article’s live date (Compare ▸ Since launch ▸ Cumulative units), plus units in the first 28 days',use:'Compare launches fairly and set the opening buy for the next one.',read:'Steeper early curve: a stronger launch. Flattening: demand decaying.',cav:'Only weeks after the first synced order are drawn; the first-28-days figure needs the launch inside the data.'},
  {k:'pace',label:'Last 28 days / week',how:'units in the last 28 counted days ÷ those days × 7',use:'Current pace for reorder quantity.',read:'Compare with units per live week: higher means speeding up.',cav:'Needs 7+ counted days.'},
  {k:'recv',label:'Received (est.)',how:'sum over the span of max(0, stock change + units sold) per day',use:'Checks restocks and returns landing.',read:'Zero while stock rose little: nothing was received.',cav:'Net of returns, adjustments and transfers.'},
  {k:'avl',label:'Sizes in stock',how:'sizes with stock above 0 ÷ sizes carried, now and a week ago',use:'Size-run health: broken runs lose sales.',read:'Falling count: the run is breaking.',cav:'Two points in time.'},
  {k:'risk',label:'Lost-sales risk',how:'sizes with 0 on hand that sold in the last 28 days',use:'Which sizes to restock first.',read:'Any size listed is demand being turned away.',cav:'A flag, not a quantity of lost sales.'},
  {k:'sell',label:'Selling weeks',how:'7-day blocks with a sale ÷ complete blocks',use:'Steady seller versus one-off spike.',read:'Low share: sales came in bursts.',cav:'Needs 2+ complete blocks.'},
  {k:'first4',label:'First 4 weeks',how:'units in the first 28 days after the live date',use:'Launch benchmark between products.',read:'Compare across launches only.',cav:'Only when the launch is inside the counted data.'},
  {k:'peak',label:'Peak week',how:'the best complete 7-day block and its start date',use:'Spot campaign or season effects.',read:'Peak long ago: demand faded.',cav:'Blocks start on the counted start, not a Monday.'},
  {k:'asp',label:'Average unit price',how:'revenue ÷ units',use:'Sanity check of price position.',read:'Falling over time can mean discounting, but discounts are not recorded.',cav:'List price at order time, before discounts.'}
];
function _siAxDef(k){return _SI_AX_DEFS.find(d=>d.k===k)||{label:k,how:'',use:'',read:'',cav:''};}
function _siAxTip(k){const d=_siAxDef(k);return _siEsc(d.label+' = '+d.how+'. Use it for: '+d.use+' '+d.cav);}
function _siAxNum(v,dec){if(v==null||!isFinite(v))return'—';const m=Math.pow(10,dec==null?1:dec);return String(Math.round(v*m)/m);}
function _siAxPct(v,signed){if(v==null||!isFinite(v))return'—';const r=Math.round(v*1000)/10;return(signed&&r>0?'+':'')+r+'%';}

// The series for a set of articles. Returns {xLabels,xTicks,series:[{code,values}],notes}.
// A null value means "not live yet / not in the synced data" — never a zero.
function _siAxSeries(arts,metric,basis){
  const M=_SI_AX_METRICS[metric]||_SI_AX_METRICS.units_week;
  const bucket=M.bucket,idx=_siAxIndex(),today=_siPktDate(0);
  const cov=idx.cov||today,notes=[];
  const val=(a,b)=>{const x=_siAxBuckets(a,bucket).get(b);return x?x[M.field]:0;};
  const fin=vals=>{if(!M.cum)return vals;let s=0;return vals.map(v=>v==null?null:(s+=v));};
  // Exposure-aware kinds: the value of one span of days, clipped to the counted window.
  const kv=(a,s,e)=>{
    const E=_siAxCountedStart(a,idx.cov||'');if(!E||!s||!e)return null;
    const cs=s>E?s:E,ce=e<today?e:today;if(cs>ce)return null;
    const n=_siAxDayNum(ce)-_siAxDayNum(cs)+1;
    if(M.kind==='rate')return _siAxUnitsBetween(a,cs,ce)/n;
    if(M.kind==='roll'){const ws=_siAxDayStr(Math.max(_siAxDayNum(E),_siAxDayNum(ce)-27));const d=_siAxDayNum(ce)-_siAxDayNum(ws)+1;return d>=7?_siAxUnitsBetween(a,ws,ce)/d*7:null;}
    if(M.kind==='st'){if(!a.hasStock)return null;const den=_siAxUnitsBetween(a,E,today)+a.onHand;return den>0?_siAxUnitsBetween(a,E,ce)/den:null;}
    return null;
  };
  let xLabels=[],series=[],calKeys=[];
  if(basis==='launch'){
    let maxK=-1;
    const per=arts.map(a=>{
      const L=a.liveDay||a.firstDay;
      if(!L){notes.push(_siAxLabel(a)+': no live date and no sales, so it cannot be aligned.');return{code:a.code,L:'',vals:[]};}
      if(!a.liveDay)notes.push(_siAxLabel(a)+': no live date in the catalog — aligned to its first counted sale instead.');
      const Ln=_siAxDayNum(L),Tn=_siAxDayNum(today),ly=+L.slice(0,4),lm=+L.slice(5,7);
      const kOf=day=>{
        if(bucket==='month'){return Math.max(0,(+day.slice(0,4)*12+ +day.slice(5,7))-(ly*12+lm));}
        return Math.max(0,Math.floor((_siAxDayNum(day)-Ln)/7));
      };
      const last=kOf(today);
      if(M.kind){
        const vals=[];for(let k=0;k<=last;k++)vals.push(kv(a,_siAxDayStr(Ln+7*k),_siAxDayStr(Ln+7*k+6)));
        if(maxK<last)maxK=last;
        return{code:a.code,L,vals};
      }
      const sums=new Array(last+1).fill(0);
      a.daily.forEach((d,day)=>{const k=kOf(day);if(k<=last)sums[k]+=d[M.field];});
      const vals=sums.map((s,k)=>{
        let end;
        if(bucket==='month'){const st=_siAxDayStr(Math.floor(Date.UTC(ly,lm-1+k,1)/86400000));end=_siAxBucketEnd(st,'month');}
        else end=_siAxDayStr(Ln+7*k+6);
        return end<cov?null:s;
      });
      if(maxK<last)maxK=last;
      return{code:a.code,L,vals};
    });
    for(let k=0;k<=maxK;k++)xLabels.push((bucket==='month'?'month ':'week ')+k);
    series=per.map(p=>{const v=p.vals.slice();while(v.length<=maxK)v.push(null);return{code:p.code,values:fin(v)};});
    if(per.some(p=>p.vals.some(v=>v===null)&&p.vals.length))notes.push('Gaps at the start of a line are weeks before the first synced order — unknown, not zero.');
  }else{
    const curStart=_siAxBucketStart(today,bucket),covB=_siAxBucketStart(cov,bucket);
    let start='';
    arts.forEach(a=>{const L=a.liveDay&&a.liveDay>cov?a.liveDay:(a.firstDay||a.liveDay);if(!L)return;let b=_siAxBucketStart(L,bucket);if(b<covB)b=covB;if(!start||b<start)start=b;});
    const keys=[];
    if(start){for(let b=start,g=0;b&&b<=curStart&&g<1200;b=_siAxBucketNext(b,bucket),g++)keys.push(b);}
    calKeys=keys;
    xLabels=keys.map(b=>_siAxFmtBucket(b,bucket,false));
    series=arts.map(a=>{
      const L=a.liveDay||a.firstDay||'';
      const vals=keys.map(b=>{
        if(!L)return null;
        if(_siAxBucketEnd(b,bucket)<L)return null; // not live yet
        if(M.kind)return kv(a,b,_siAxBucketEnd(b,bucket));
        return val(a,b);
      });
      return{code:a.code,values:fin(vals)};
    });
    if(keys.length&&keys[0]===covB&&cov>covB&&!M.kind)notes.push('The first bucket starts before the first synced order, so it may be understated.');
  }
  if(M.kind)notes.push('Counted window only: each bucket is divided by the live days counted in it, and days before the first synced order are left out (gaps, not zeros).');
  const n=xLabels.length,ticks=[];
  if(n){
    const maxT=(typeof window!=='undefined'&&window.innerWidth&&window.innerWidth<600)?4:6;
    const want=Math.min(n,n>maxT?maxT:n);
    const seen=new Set();
    for(let t=0;t<want;t++){const i=want===1?0:Math.round(t*(n-1)/(want-1));if(!seen.has(i)){seen.add(i);ticks.push(i);}}
  }
  const tickLabel=i=>basis==='launch'?xLabels[i]:_siAxFmtBucket(calKeys[i],bucket,true);
  return{xLabels,xTicks:ticks.map(i=>({i,label:tickLabel(i)})),series,notes,bucket,metric,basis,metricDef:M};
}
// ── Chart math ──────────────────────────────────────────────────────
// Axis: ported from mktChartScale/mktAxisScale (js/marketing.js) so this tab
// does not depend on the Marketing file. The step is chosen first, so ticks
// cannot repeat; the formatter is checked too and a whole-number scale is
// used if it would print two ticks alike.
function _siAxScaleRaw(values,integer){
  const m=Math.max(0,...(values||[]).map(v=>Number(v)||0));
  if(m<=0)return{max:1,step:1,count:1};
  const ladder=integer?[1,2,5,10]:[1,2,2.5,5,10];
  let mag=Math.pow(10,Math.floor(Math.log10(m/5)));
  if(integer)mag=Math.max(1,mag);
  for(let pass=0;pass<4;pass++){
    for(const n of ladder){
      const step=n*mag;if(integer&&step<1)continue;
      const count=Math.ceil(m/step);
      if(count>=1&&count<=6)return{max:step*count,step,count};
    }
    mag*=10;
  }
  return{max:m,step:m,count:1};
}
function _siAxTick(n){const v=Number(n)||0,a=Math.abs(v);if(a>=1e6)return(Math.round(v/1e5)/10)+'m';if(a>=1e3)return(Math.round(v/100)/10)+'k';return String(Math.round(v*10)/10);}
function _siAxScale(values,integer,fmt){
  const f=fmt||_siAxTick;
  const distinct=sc=>{const seen=new Set();for(let i=0;i<=sc.count;i++){const k=String(f(sc.step*i));if(seen.has(k))return false;seen.add(k);}return true;};
  const first=_siAxScaleRaw(values,!!integer);
  if(distinct(first))return first;
  const whole=_siAxScaleRaw(values,true);
  return distinct(whole)?whole:{max:first.max,step:first.max,count:1};
}
// Monotone cubic (Fritsch–Carlson) through points [{x,y}], as an SVG path.
// Never overshoots, so a count curve cannot dip below zero between points.
function _siAxCurve(pts){
  const p=(pts||[]).filter(q=>q&&isFinite(q.x)&&isFinite(q.y));
  const f=v=>(Math.round(v*100)/100);
  if(p.length<2)return'';
  if(p.length===2)return'M'+f(p[0].x)+' '+f(p[0].y)+'L'+f(p[1].x)+' '+f(p[1].y);
  const n=p.length,dx=[],dy=[],m=[],t=new Array(n);
  for(let i=0;i<n-1;i++){dx[i]=p[i+1].x-p[i].x;dy[i]=p[i+1].y-p[i].y;m[i]=dx[i]===0?0:dy[i]/dx[i];}
  t[0]=m[0];t[n-1]=m[n-2];
  for(let i=1;i<n-1;i++)t[i]=(m[i-1]*m[i]<=0)?0:(m[i-1]+m[i])/2;
  for(let i=0;i<n-1;i++){
    if(m[i]===0){t[i]=0;t[i+1]=0;continue;}
    const a=t[i]/m[i],b=t[i+1]/m[i],h=a*a+b*b;
    if(h>9){const s=3/Math.sqrt(h);t[i]=s*a*m[i];t[i+1]=s*b*m[i];}
  }
  let d='M'+f(p[0].x)+' '+f(p[0].y);
  for(let i=0;i<n-1;i++){
    const h=dx[i]/3;
    d+='C'+f(p[i].x+h)+' '+f(p[i].y+t[i]*h)+' '+f(p[i+1].x-h)+' '+f(p[i+1].y-t[i+1]*h)+' '+f(p[i+1].x)+' '+f(p[i+1].y);
  }
  return d;
}

function _siAxChartHtml(cfg){
  const W=1000,H=300;
  const all=[];cfg.series.forEach(s=>s.values.forEach(v=>{if(v!=null&&isFinite(v))all.push(v);}));
  if(!all.length||Math.max.apply(null,all)<=0)return`<div class="si-ax-empty">${_siEsc(cfg.empty||'Nothing sold in the synced data for this selection, so there is no line to draw.')}</div>`;
  const fmt=cfg.fmt||_siAxTick;
  const sc=_siAxScale(all,cfg.integer,fmt);
  const n=cfg.xLabels.length;
  const X=i=>n<=1?W/2:i/(n-1)*W,Y=v=>H-(v/sc.max)*H;
  let paths='',ends='',dots='';
  cfg.series.forEach((s,si)=>{
    let seg=[],lastIdx=-1;
    const flush=()=>{
      if(seg.length>=2)paths+=`<path class="si-ax-line s${si}" style="stroke-dasharray:${_SI_AX_DASH[si%5]}" d="${_siAxCurve(seg)}"/>`;
      else if(seg.length===1)dots+=`<i class="si-ax-end si-ax-badge si-ax-b${si}" style="left:${(seg[0].x/W*100).toFixed(2)}%;bottom:${(100-seg[0].y/H*100).toFixed(2)}%;width:8px;height:8px"></i>`;
      seg=[];
    };
    s.values.forEach((v,i)=>{
      if(v==null||!isFinite(v)){flush();return;}
      seg.push({x:X(i),y:Y(v)});lastIdx=i;
    });
    flush();
    if(lastIdx>=0){
      const v=s.values[lastIdx];
      ends+=`<span class="si-ax-end si-ax-badge si-ax-b${si}" style="left:${(X(lastIdx)/W*100).toFixed(2)}%;bottom:${(100-Y(v)/H*100).toFixed(2)}%">${si+1}</span>`;
    }
  });
  const ticks=[];for(let i=0;i<=sc.count;i++)ticks.push({pct:i/sc.count*100,v:sc.step*i});
  const yl=ticks.map(t=>`<span class="si-ax-tick" style="bottom:${t.pct}%">${_siEsc(fmt(t.v))}</span>`).join('');
  const gl=ticks.map(t=>`<i class="si-ax-grid" style="bottom:${t.pct}%"></i>`).join('');
  const xl=cfg.xTicks.map((t,k)=>{
    const cls=cfg.xTicks.length>1&&k===0?' first':(k===cfg.xTicks.length-1&&cfg.xTicks.length>1?' last':'');
    return`<span class="si-ax-xtick${cls}" style="left:${(X(t.i)/W*100).toFixed(2)}%">${_siEsc(t.label)}</span>`;
  }).join('');
  const legend=cfg.series.map((s,si)=>`<span><svg viewBox="0 0 26 8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--si-s${si})" stroke-dasharray="${_SI_AX_DASH[si%5]}"/></svg><i class="si-ax-badge si-ax-b${si}">${si+1}</i>${_siEsc(s.name||s.code)}</span>`).join('');
  _siAxHov={labels:cfg.xLabels,series:cfg.series,money:!!cfg.money,fmt:cfg.fmt||null,n};
  return`<div class="si-ax-legend">${legend}</div>
  <div class="si-ax-wrap">
    <div class="si-ax-yaxis">${yl}</div>
    <div class="si-ax-plot" role="img" aria-label="${_siEsc(cfg.aria||'Line chart')}" onpointermove="window._siAxHover(event,this)" onpointerdown="window._siAxHover(event,this)" onpointerleave="window._siAxLeave(this)">
      ${gl}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>${dots}${ends}
      <div class="si-ax-cursor"></div><div class="si-ax-tip"></div>
    </div>
    <div class="si-ax-xaxis">${xl}</div>
  </div>`;
}
window._siAxHover=function(ev,el){
  const h=_siAxHov;if(!h||!h.n)return;
  const r=el.getBoundingClientRect();if(!r.width)return;
  const fr=Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width));
  const i=h.n<=1?0:Math.round(fr*(h.n-1));
  const pct=h.n<=1?50:i/(h.n-1)*100;
  const cur=el.querySelector('.si-ax-cursor'),tip=el.querySelector('.si-ax-tip');
  if(cur){cur.style.display='block';cur.style.left=pct+'%';}
  if(tip){
    tip.innerHTML=`<b>${_siEsc(h.labels[i]||'')}</b>`+h.series.map((s,si)=>{
      const v=s.values[i];
      const t=v==null?'—':(h.fmt?h.fmt(v):(h.money?_siPKR(Math.round(v)):String(Math.round(v*10)/10)));
      return`<div class="r"><span><i class="si-ax-badge si-ax-b${si}">${si+1}</i> ${_siEsc(s.name||s.code)}</span><strong>${_siEsc(t)}</strong></div>`;
    }).join('');
    tip.style.display='block';
    if(pct>55){tip.style.left='auto';tip.style.right=(100-pct+1)+'%';}else{tip.style.right='auto';tip.style.left=(pct+1)+'%';}
  }
};
window._siAxLeave=function(el){
  const cur=el.querySelector('.si-ax-cursor'),tip=el.querySelector('.si-ax-tip');
  if(cur)cur.style.display='none';if(tip)tip.style.display='none';
};

// ── Coverage honesty ────────────────────────────────────────────────
function _siAxCoverage(arts){
  const cov=_siAxIndex().cov;
  let h=`<div class="si-ax-note">Data counted from <strong>${_siEsc(cov?_siAxFmtDay(cov):'—')}</strong> — line items only cover orders synced so far (refunded orders excluded; revenue = unit price × quantity before discounts). Nothing is estimated for earlier dates.`;
  const early=(arts||[]).filter(a=>cov&&a.liveDay&&a.liveDay<cov);
  early.forEach(a=>{h+=`<br>⚠ ${_siEsc(_siAxLabel(a))} went live ${_siEsc(_siAxFmtDay(a.liveDay))}, before that date — its earlier sales are not in this data.`;});
  return h+'</div>';
}
function _siAxAgeText(a){
  if(!a.liveDay){return a.firstDay?'first sale '+_siAxDaysSince(a.firstDay)+'d ago':'live —';}
  const d=_siDaysAgo(a.liveAt);
  return d!==null&&!isNaN(d)&&d>=0?'live '+d+'d':'live —';
}
function _siAxDaysSince(day){const n=_siAxDayNum(day),t=_siAxDayNum(_siPktDate(0));return n==null?0:Math.max(0,t-n);}
// The date shown in a "Live" cell: the publish date when the catalog has one, else the first counted sale, labelled.
function _siAxLiveText(a){
  if(a.liveDay)return _siAxFmtDay(a.liveDay);
  return a.firstDay?_siAxFmtDay(a.firstDay)+' (first sale)':'—';
}

// ── Section shell ───────────────────────────────────────────────────
function _siArticleExplorerSection(){
  _siAxEnsureHistory(); // one bounded read per session; repaints the body when it lands
  const idx=_siAxIndex();
  const modeBtn=(id,l)=>`<button class="si-ax-btn${_siAxModeSel===id?' on':''}" onclick="window._siAxSetMode('${id}')">${l}</button>`;
  return`<div class="si-ax-bar">${modeBtn('search','Search')}${modeBtn('compare','Compare')}
    <span class="si-ax-lab" style="margin-left:auto">${idx.list.length} articles · ignores the season filter</span></div>
  <div class="si-ax-bar"><input id="si-ax-input" class="si-ax-input" autocomplete="off" placeholder="${_siAxModeSel==='compare'?'Add an article to compare — title, colour, code (GST073), category…':'Search any article — title, colour, code (GST073), category…'}" value="${_siEsc(_siAxQuery)}" oninput="window._siAxOnInput(this.value)"></div>
  <div id="si-ax-results">${_siAxResultsHtml()}</div>
  <div id="si-ax-body">${_siAxModeSel==='compare'?_siAxCompareBody():_siAxSearchBody()}</div>${_siCleanQualityHtml(idx.quality)}`;
}
function _siAxResultsHtml(){
  const q=_siAxQuery.trim();
  if(!q&&(_siAxSel||(_siAxModeSel==='compare'&&_siAxCmp.length)))return'';
  const r=_siAxSearch(q,q?12:8);
  if(!r.hits.length)return`<div class="si-ax-empty">No article matches “${_siEsc(q)}”.</div>`;
  const add=_siAxModeSel==='compare';
  return`<div class="si-ax-note" style="margin-bottom:4px">${q?r.total+' match'+(r.total===1?'':'es')+(r.total>r.hits.length?' — showing '+r.hits.length+', refine to narrow':''):'Top sellers (type to search all '+r.total+' articles)'}</div>
  <div class="si-ax-results">${r.hits.map(a=>`<button class="si-ax-hit" data-code="${_siEsc(a.code)}" onclick="window._siAx${add?'Add':'Pick'}(this.dataset.code)"><span class="t">${_siEsc(a.name)}<div class="m">${_siEsc(a.color||'—')} · ${_siEsc(a.code)} · ${_siEsc(a.category||'no category')}</div></span><span class="n">${a.units} sold</span>${add?'<span class="si-ax-btn" style="pointer-events:none">+ Add</span>':''}</button>`).join('')}</div>`;
}
window._siAxSetMode=function(m){_siAxModeSel=m==='compare'?'compare':'search';_siAxQuery='';_siAxMsg='';_siAxRepaintAll();};
window._siAxOnInput=function(v){
  _siAxQuery=v;
  clearTimeout(window._siAxDebounce);
  window._siAxDebounce=setTimeout(()=>{const el=document.getElementById('si-ax-results');if(el)el.innerHTML=_siAxResultsHtml();},150);
};
function _siAxRepaintAll(){
  const el=document.getElementById('si-content');
  if(el){el.innerHTML=_siArticleExplorerSection();const i=document.getElementById('si-ax-input');if(i&&_siAxQuery){i.focus();try{i.setSelectionRange(i.value.length,i.value.length);}catch(_){}}}
}
function _siAxRepaintBody(){
  const r=document.getElementById('si-ax-results'),b=document.getElementById('si-ax-body'),i=document.getElementById('si-ax-input');
  if(i)i.value=_siAxQuery;
  if(r)r.innerHTML=_siAxResultsHtml();
  if(b)b.innerHTML=_siAxModeSel==='compare'?_siAxCompareBody():_siAxSearchBody();
}
window._siAxPick=function(code){_siAxSel=code;_siAxQuery='';_siAxRepaintBody();};
// Returns {ok,msg} so callers and tests see why an add was refused.
function _siAxTryAdd(code){
  code=String(code||'').toUpperCase();
  if(!_siAxIndex().map.has(code))return{ok:false,msg:'Unknown article.'};
  if(_siAxCmp.includes(code))return{ok:false,msg:'That article is already in the comparison.'};
  if(_siAxCmp.length>=_SI_AX_MAX)return{ok:false,msg:'You can compare at most '+_SI_AX_MAX+' articles — remove one first.'};
  _siAxCmp.push(code);return{ok:true,msg:''};
}
window._siAxAdd=function(code){
  const r=_siAxTryAdd(code);_siAxMsg=r.msg;
  if(!r.ok&&typeof showToast==='function')showToast(r.msg,true);
  if(r.ok)_siAxQuery='';
  _siAxRepaintBody();
  if(r.ok){const i=document.getElementById('si-ax-input');if(i)i.focus();}
};
window._siAxRemove=function(code){_siAxCmp=_siAxCmp.filter(c=>c!==code);_siAxMsg='';_siAxRepaintBody();};
window._siAxClear=function(){_siAxSel='';_siAxQuery='';_siAxRepaintBody();};
window._siAxSetMetric=function(v){if(_SI_AX_METRICS[v])_siAxMetric=v;_siAxRepaintBody();};
window._siAxCurvePreset=function(){_siAxMetric='cum_week';_siAxBasis='launch';_siAxRepaintBody();};
window._siAxSetBasis=function(v){_siAxBasis=v==='launch'?'launch':'calendar';_siAxRepaintBody();};
window._siAxSetBucket=function(v){_siAxBucket=v==='month'?'month':'week';_siAxRepaintBody();};



function _siAxHistBanner(){
  const st=_siHistState;
  if(st==='loading'||st==='idle')return`<div class="si-ax-note" role="status">Loading stock history — one read of up to ${_SI_HIST_MAX} daily snapshots, kept for this session. In-stock figures show “—” until it lands.</div>`;
  if(st==='error')return`<div class="si-ax-note" role="alert" style="color:var(--accent-urgent);font-weight:600">Stock history could not be read (${_siEsc(_siHistError)}). In-stock rate, stock-out days, units per in-stock day and sell-through show “—”. <button class="si-ax-btn" onclick="window._siAxRetryHistory()">Retry</button></div>`;
  const H=_siHist,cov=_siAxIndex().cov;
  const short=H.dates.length<8?` <strong>Only ${H.dates.length} snapshot day${H.dates.length===1?'':'s'} exist, too few for in-stock figures (they need 7+ measured days).</strong>`:'';
  return`<div class="si-ax-note">Stock history: <strong>${H.dates.length}</strong> daily snapshots, ${_siEsc(_siAxFmtDay(H.from))} to ${_siEsc(_siAxFmtDay(H.to))}${cov&&H.from>cov?` — sales data starts earlier (${_siEsc(_siAxFmtDay(cov))}), so in-stock figures cover the snapshot window only`:''}. Negative stock counts as 0; items with no SKU are skipped; duplicate SKUs are summed; received stock is inferred from stock increases of at least max(5, 10% of opening).${H.dropped.length?' Incomplete snapshot(s) ignored: '+_siEsc(H.dropped.join(', '))+'.':''}${short}</div>`;
}
function _siAxReadClass(a,c){
  const m=_siAxStats(a),n=_siAxLabel(a);
  if(c.cls==='early')return n+' has '+(m.days||0)+' counted day'+(m.days===1?'':'s')+', so it is not classed yet.';
  const parts=[n+' is classed '+c.label+': sold '+m.units+' over a counted window of '+m.days+' days'+(m.rateWeek!=null?' ('+_siAxNum(m.rateWeek)+' a week)':'')+(m.st?' and '+_siAxPct(m.st.value)+' of the units available have sold':'')+'.'];
  if(m.inRate!=null)parts.push('In stock on about '+_siAxPct(m.inRate)+' of '+m.measured+' measured days ('+m.outDays+' out).');
  if(m.perInDay!=null)parts.push(_siAxNum(m.perInDay*7)+' units a week while in stock.');
  if(m.cover!=null)parts.push('Cover '+_siAxNum(m.cover)+' weeks.');
  if(c.unverified)parts.push('Partly unverified: '+c.skipped.join(', ')+' unknown.');
  return parts.join(' ');
}
function _siAxScorecardHtml(arts){
  const rows=(arts||[]).map(a=>({a,m:_siAxStats(a),c:_siAxClassify(a)}));
  if(!rows.length)return'';
  const T=_SI_AX_SCORE;
  const pts=[],unplotted=[];
  rows.forEach((r,i)=>{
    const x=r.m.perInDay!=null?r.m.perInDay*7:null,y=r.m.st?r.m.st.value:null;
    if(x==null||y==null||r.c.cls==='early'||r.c.cls==='unrated'){unplotted.push({r,i,why:r.c.cls==='early'?'too early ('+(r.m.days||0)+' counted days)':(x==null&&y==null?'no in-stock pace or sell-through':(x==null?'units per in-stock week is —':'sell-through is —'))});return;}
    pts.push({r,i,x,y:Math.min(1,y)});
  });
  const maxX=pts.length?Math.max(...pts.map(p=>p.x)):0;
  const xs=_siAxScaleRaw([Math.max(maxX*1.08,T.constrainedPerDay*7*1.6)],false);
  const X=v=>Math.min(100,v/xs.max*100),Y=v=>Math.min(100,v*100);
  const dot=(p,k)=>`<button class="si-pc-pt cls-${p.r.c.cls}" style="left:calc(${X(p.x).toFixed(2)}% + ${k*16}px);bottom:${Y(p.y).toFixed(2)}%" aria-label="${_siEsc((p.i+1)+'. '+_siAxLabel(p.r.a)+': '+p.r.c.label+', '+_siAxNum(p.x)+' units per in-stock week, sell-through '+_siAxPct(p.y))}" title="${_siEsc(_siAxLabel(p.r.a)+' — '+p.r.c.label+' · '+_siAxNum(p.x)+'/in-stock wk · sell-through '+_siAxPct(p.y))}"><i>${p.i+1}</i></button>`;
  // points that would sit on top of each other are nudged sideways
  const seen=[];
  const dots=pts.map(p=>{let k=0;seen.forEach(q=>{if(Math.abs(X(q.x)-X(p.x))<4&&Math.abs(Y(q.y)-Y(p.y))<6)k++;});seen.push(p);return dot(p,k);}).join('');
  const gy=[{v:T.winnerSellThrough,l:'Winner '+_siAxPct(T.winnerSellThrough)},{v:T.healthySellThrough,l:'Healthy '+_siAxPct(T.healthySellThrough)},{v:T.deadSellThrough,l:'Dead <'+_siAxPct(T.deadSellThrough)}];
  const guides=gy.map(g=>`<i class="si-pc-gy" style="bottom:${Y(g.v)}%"><span>${_siEsc(g.l)}</span></i>`).join('')+`<i class="si-pc-gx" style="left:${X(T.constrainedPerDay*7).toFixed(2)}%"><span>${T.constrainedPerDay}/day</span></i>`;
  const yt=[0,0.25,0.5,0.75,1].map(v=>`<span class="si-ax-tick" style="bottom:${v*100}%">${Math.round(v*100)}%</span>`).join('');
  const xt=[];for(let i=0;i<=xs.count;i++)xt.push(`<span class="si-ax-xtick${i===0?' first':(i===xs.count?' last':'')}" style="left:${(i/xs.count*100).toFixed(2)}%">${_siEsc(_siAxTick(xs.step*i))}</span>`);
  const legend=['winner','healthy','constrained','slow','dead'].map(k=>`<span><i class="si-pc-key cls-${k}"></i>${_siEsc(_SI_AX_CLASSES[k].label)}</span>`).join('');
  const chart=pts.length?`<div class="si-ax-legend">${legend}</div>
   <div class="si-pc-wrap"><div class="si-ax-yaxis">${yt}</div>
    <div class="si-pc-plot" role="group" aria-label="Performance scorecard: sell-through against units per in-stock week">${guides}${dots}</div>
    <div class="si-ax-xaxis" style="grid-column:2">${xt.join('')}</div></div>
   <div class="si-ax-note" style="text-align:center">x: units per in-stock week · y: sell-through · dashed lines are the default class thresholds</div>`
   :`<div class="si-ax-empty">No article here has both an in-stock pace and a sell-through yet (${_siEsc(_siAxHistWhy(rows[0].m))}), so there is nothing to plot.</div>`;
  const notPlot=unplotted.length?`<div class="si-ax-note">Not plotted: ${unplotted.map(u=>_siEsc((u.i+1)+'. '+_siAxLabel(u.r.a)+' — '+u.why)).join('; ')}.</div>`:'';
  const shapeChip=c=>`<span class="si-pc-chip cls-${c.cls}"><i class="si-pc-key cls-${c.cls}"></i>${_siEsc(c.label)}</span>`;
  const tbl=`<div style="overflow-x:auto"><table class="cut-table" style="min-width:780px"><thead><tr><th>#</th><th>Article</th><th>Class</th><th>Net units</th><th>Per live week</th><th>Sell-through</th><th>In-stock</th><th>Cover</th><th>Rule that matched</th><th>Use it for</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><i class="si-ax-badge si-ax-b${i}">${i+1}</i></td><td style="font-weight:600">${_siEsc(_siAxLabel(r.a))}<div class="si-ax-note" style="margin:0">${_siEsc(r.a.code)}</div></td><td>${shapeChip(r.c)}${r.c.unverified?'<div class="si-ax-note" style="margin:0">partly unverified</div>':''}</td><td>${r.m.units==null?'—':r.m.units}</td><td>${_siAxNum(r.m.rateWeek)}</td><td>${_siAxPct(r.m.st&&r.m.st.value)}</td><td>${_siAxPct(r.m.inRate)}</td><td>${r.m.cover!=null?_siAxNum(r.m.cover)+'w':'—'}</td><td style="min-width:200px">${_siEsc(r.c.rule)}</td><td style="min-width:160px">${_siEsc(r.c.act)}</td></tr>`).join('')}</tbody></table></div>`;
  const read=rows.map(r=>`<li>${_siEsc(_siAxReadClass(r.a,r.c))}</li>`).join('');
  const thr=`<details class="si-ax-defs"><summary class="si-ax-lab" style="cursor:pointer">Default thresholds — defaults, not facts</summary>
   <div class="si-ax-note">Derived from this store’s own distributions (about 18 weeks of stock history); editable constants in <em>js/shopify.js</em>. First match wins, in this order.</div>
   <table class="cut-table" style="min-width:420px"><tbody>
   <tr><td>Too early</td><td>fewer than ${T.minDays} counted days — not classed</td></tr>
   <tr><td>Dead stock</td><td>no sale in the last ${T.deadNoSaleDays} counted days while stock is on hand, or sell-through below ${_siAxPct(T.deadSellThrough)}</td></tr>
   <tr><td>Stock-constrained</td><td>in stock on less than ${_siAxPct(T.constrainedInStock)} of measured days and at least ${T.constrainedPerDay} units per in-stock day</td></tr>
   <tr><td>Winner</td><td>sell-through at least ${_siAxPct(T.winnerSellThrough)} and in stock on at least ${_siAxPct(T.winnerInStock)} of measured days</td></tr>
   <tr><td>Healthy</td><td>sell-through at least ${_siAxPct(T.healthySellThrough)} and weeks of cover at most ${T.overCoverWeeks}</td></tr>
   <tr><td>Slow</td><td>any other classed article (sell-through ${_siAxPct(T.deadSellThrough)}–${_siAxPct(T.healthySellThrough)}, or cover above ${T.overCoverWeeks} weeks)</td></tr></tbody></table>
   <div class="si-ax-note">A clause whose metric is “—” is skipped (never passed) and the row says “partly unverified”. These are vendor-style conventions, not validated with the business. August units were over twice a normal month (cause unverified), so sell-through, momentum and cover are sensitive to that period.</div></details>`;
  let counts='';
  if(_siHistState==='ok'){const c=_siAxClassCounts();counts=`<div class="si-ax-note">All ${Object.keys(c).reduce((t,k)=>t+c[k],0)} articles with sales or stock: ${['winner','healthy','constrained','slow','dead','early','unrated'].filter(k=>c[k]).map(k=>c[k]+' '+_SI_AX_CLASSES[k].label).join(' · ')}.</div>`;}
  return`<div class="card"><div class="card-title">Performance scorecard <span class="si-ax-note">(default thresholds — not facts)</span></div>
   ${chart}${notPlot}${tbl}<div class="card-title" style="margin-top:10px;font-size:14px">Read this</div><ul class="si-ax-read">${read}</ul>${counts}${thr}</div>`;
}

function _siAxNeedsHistoryNote(){
  return`In-stock figures use the loaded stock snapshots only (see the stock history note above); where fewer than 7 days are measured they show “—”.`;
}
function _siAxDefsHtml(){
  return`<details class="card si-ax-defs"><summary class="card-title" style="cursor:pointer">How these are measured — and what to use them for</summary>${_SI_AX_DEFS.map(d=>`<div class="si-ax-def"><strong>${_siEsc(d.label)}</strong> = ${_siEsc(d.how)}.<div class="si-ax-note" style="margin:0"><b>Use it for:</b> ${_siEsc(d.use)}</div><div class="si-ax-note" style="margin:0"><b>Low / high:</b> ${_siEsc(d.read)}</div><div class="si-ax-note" style="margin:0"><b>Limit:</b> ${_siEsc(d.cav)}</div></div>`).join('')}</details>`;
}

// ── Search mode: one article ────────────────────────────────────────
function _siAxSearchBody(){
  const idx=_siAxIndex(),a=idx.map.get(_siAxSel);
  if(!a)return`<div class="si-ax-empty">Pick an article above to see its sales, stock, size mix and trend.</div>`+_siAxCoverage([]);
  const s7=_siAxUnitsSince(a,7),s30=_siAxUnitsSince(a,30),s90=_siAxUnitsSince(a,90);
  const m=_siAxStats(a);
  const kpi=(l,v,sub,tip)=>`<div class="si-ax-kpi"${tip?` title="${_siAxTip(tip)}"`:''}><div class="l">${_siEsc(l)}${tip?' <span class="si-ax-i" aria-hidden="true">i</span>':''}</div><div class="v">${v}</div><div class="s">${sub||'&nbsp;'}</div>${tip?`<div class="u"><b>Use it for:</b> ${_siEsc(_siAxDef(tip).use)}</div>`:''}</div>`;
  const why=_siAxHistWhy(m);
  const win=m.days!=null?'counted window · '+m.days+' day'+(m.days===1?'':'s')+(m.partial?' (from first synced order)':''):'no counted days';
  const metric=_siAxBucket==='month'?'units_month':'units_week';
  const ser=_siAxSeries([a],metric,'calendar');
  ser.series[0].name=_siAxLabel(a);
  const chart=_siAxChartHtml({series:ser.series,xLabels:ser.xLabels,xTicks:ser.xTicks,integer:true,empty:'No sales in the synced data for this article, so there is no line to draw.',aria:'Units sold per '+_siAxBucket+' for '+_siAxLabel(a)});
  const toggle=['week','month'].map(b=>`<button class="si-ax-btn${_siAxBucket===b?' on':''}" onclick="window._siAxSetBucket('${b}')">Per ${b}</button>`).join('');
  // size mix
  const sizes=[...new Set(Object.keys(a.sizes).concat(Object.keys(a.stock)))].sort(_siAxSizeSort);
  const tot=a.units||0,maxQ=Math.max(1,...sizes.map(s=>a.sizes[s]||0));
  const mix=sizes.length?sizes.map(s=>{const q=a.sizes[s]||0;return`<div class="si-ax-mix"><span class="sz">${_siEsc(s)}</span><span class="bar"><i style="width:${(q/maxQ*100).toFixed(1)}%"></i></span><span class="q">${q} sold${tot?' · '+Math.round(q/tot*100)+'%':''}</span></div>`;}).join(''):'<div class="si-ax-note">No sizes recorded.</div>';
  const stockRows=m.sizeRows.map(r=>`<tr><td>${_siEsc(r.size)}${r.risk?' <span class="si-ax-flag" title="Out of stock now, sold in the last 28 days">at risk</span>':''}</td><td>${r.sold}</td><td>${r.stock!=null?r.stock:'—'}</td><td>${r.prev!=null?r.prev:'—'}</td><td>${_siAxPct(r.sellThrough)}</td></tr>`).join('');
  // weekly close
  const closes=_siWeeklyCloses.filter(wc=>wc.top_sku&&_siAxCode(wc.top_sku.sku)===a.code);
  const closeHtml=closes.length?`<table class="cut-table" style="min-width:320px"><thead><tr><th>Week ending</th><th>Top SKU</th><th>Units</th></tr></thead><tbody>${closes.map(wc=>`<tr><td>${_siEsc(wc.week_ending)}</td><td>${_siEsc(wc.top_sku.sku)}</td><td>${_siEsc(wc.top_sku.quantity)}</td></tr>`).join('')}</tbody></table>`
    :`<div class="si-ax-note">No weekly close lists this article as its top SKU. (A weekly close stores only its top SKU, top category and category totals, so nothing more per article exists to show.)</div>`;
  // per-bucket table
  const bk=_siAxBuckets(a,_siAxBucket);
  const rows=[...bk.entries()].sort((x,y)=>y[0].localeCompare(x[0]));
  const bucketTable=rows.length?`<div style="max-height:260px;overflow:auto"><table class="cut-table" style="min-width:320px"><thead><tr><th>${_siAxBucket==='month'?'Month':'Week starting'}</th><th>Units</th><th>Revenue</th></tr></thead><tbody>${rows.map(([b,x])=>`<tr><td>${_siEsc(_siAxFmtBucket(b,_siAxBucket,false))}</td><td>${x.u}</td><td>${a.hasPrice?_siEsc(_siPKR(Math.round(x.r))):'—'}</td></tr>`).join('')}</tbody></table></div>`:'';
  const cat=_siEsc(a.category||'no category');
  return`<div class="card"><div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:700">${_siEsc(a.name)}</div><div class="si-ax-note" style="margin:2px 0 0">${_siEsc(a.color||'—')} · ${_siEsc(a.code)} · ${cat} · ${a.skus.size} SKU${a.skus.size===1?'':'s'}</div></div>
    <button class="si-ax-btn" onclick="window._siAxClear()">Pick another</button></div></div>
  ${_siAxCoverage([a])}${_siAxHistBanner()}
  ${_siAxScorecardHtml([a])}
  <div class="si-ax-kpis">
    ${kpi('Live',_siEsc(_siAxLiveText(a)),_siEsc(_siAxAgeText(a)))}
    ${kpi('Sold since live',a.units,'counted from '+_siEsc(idx.cov?_siAxFmtDay(idx.cov):'—'))}
    ${kpi('Sold 7d / 30d / 90d',s7.u+' / '+s30.u+' / '+s90.u,'')}
    ${kpi('Revenue (counted)',a.hasPrice?_siEsc(_siPKR(Math.round(a.rev))):'—','30d: '+(a.hasPrice?_siEsc(_siPKR(Math.round(s30.r))):'—'))}
    ${kpi('On hand',a.hasStock?a.onHand:'—',a.hasStock?'today\'s snapshot':'not in snapshot')}
    ${kpi('Units per live week',_siAxNum(m.rateWeek),m.rateWeek!=null?_siEsc(win):'needs 7+ counted days','rate')}
    ${kpi('Sell-through %',m.st?_siAxPct(m.st.value):'—',m.st?'sold '+m.st.sold+' of '+m.st.opening+' opening + ~'+m.st.received+' received · '+_siEsc(_siAxFmtDay(m.st.from,true))+' to '+_siEsc(_siAxFmtDay(m.st.to,true))+(m.st.src==='two snapshots'?' (two snapshots)':''):_siEsc(why),'st')}
    ${kpi('In-stock rate',_siAxPct(m.inRate),m.inRate!=null?m.inDays+' of '+m.measured+' measured days in stock':_siEsc(why),'inrate')}
    ${kpi('Units per in-stock day',_siAxNum(m.perInDay,2),m.perInDay!=null?'vs '+_siAxNum(m.rateWeek!=null?m.rateWeek/7:null,2)+' per live day':_siEsc(why),'perday')}
    ${kpi('Stock-out days',m.outDays!=null?m.outDays:'—',m.outDays!=null?'of '+m.measured+' measured days':_siEsc(why),'out')}
    ${kpi('Weeks of cover',m.cover!=null?_siAxNum(m.cover)+'w':'—',m.cover!=null?'≈ '+Math.round(m.coverDays)+' days · '+_siEsc(m.coverBasis):(!a.hasStock?'no stock data':'no pace to divide by'),'cover')}
    ${kpi('Momentum',_siAxPct(m.momentum,true),m.momentum!=null?'last 28 d vs the 28 d before':'needs 56 counted days','mom')}
    ${kpi('Share of category',_siAxPct(m.catShare),a.category?'of '+_siEsc(a.category)+' units (counted)':'no category','share')}
    ${kpi('First 4 weeks',m.first4!=null?m.first4:'—',m.first4!=null?'units, first 28 days live':'launch not in counted data','first4')}
    ${kpi('Last 28 days / week',_siAxNum(m.pace28),m.pace28!=null?'last '+m.pace28Days+' counted days':'needs 7+ counted days','pace')}
    ${kpi('Received (est.)',m.received!=null?'~'+m.received:'—',m.st?'inferred over the same span':_siEsc(why),'recv')}
    ${kpi('Sizes in stock',m.sizesNow?m.sizesNow.n+' of '+m.sizesNow.of:'—',m.sizesPrev?'a week ago: '+m.sizesPrev.n+' of '+m.sizesPrev.of:'','avl')}
    ${kpi('Lost-sales risk',m.risk.length?m.risk.length+' size'+(m.risk.length===1?'':'s'):(a.hasStock?'none':'—'),m.risk.length?_siEsc(m.risk.map(r=>r.size+' ('+r.units+' sold 28d)').join(', ')):(a.hasStock?'no out-of-stock size sold in 28 d':'no stock data'),'risk')}
    ${kpi('Selling weeks',m.sellingWeeks!=null?m.sellingWeeks+' of '+m.blocks:'—',m.sellingWeeks!=null?'7-day blocks with a sale':'needs 2+ complete weeks','sell')}
    ${kpi('Peak week',m.peak?m.peak.u+' units':'—',m.peak?'week of '+_siEsc(_siAxFmtDay(m.peak.start)):'','peak')}
    ${kpi('Average unit price',m.asp!=null?_siEsc(_siPKR(Math.round(m.asp))):'—','before discounts','asp')}
  </div>
  <div class="card"><div class="card-title">Sales over time</div>
    <div class="si-ax-bar">${toggle}</div>${chart}
    <div class="si-ax-note">Latest ${_siAxBucket} is still running. ${_siEsc(ser.notes.join(' '))}</div>
    ${bucketTable}</div>
  <div class="card"><div class="card-title">Size mix (units sold) and stock</div>${mix}
    <div style="overflow-x:auto;margin-top:8px"><table class="cut-table" style="min-width:320px"><thead><tr><th>Size</th><th>Sold (counted)</th><th>On hand</th><th>A week ago</th><th title="sold ÷ (sold + on hand)">Sell-through</th></tr></thead><tbody>${stockRows}</tbody></table></div>\n    <div class="si-ax-note" style="margin-top:8px">${_siAxNeedsHistoryNote()}</div></div>
  ${_siAxDefsHtml()}
  <div class="card"><div class="card-title">Weekly close</div>${closeHtml}</div>`;
}

// ── Compare mode ────────────────────────────────────────────────────
function _siAxMetricFmt(M){
  if(M.money)return v=>_siPKR(Math.round(v));
  if(M.pct)return v=>_siAxPct(v);
  const d=M.dec==null?1:M.dec;return v=>_siAxNum(v,d);
}
function _siAxCompareData(){
  const idx=_siAxIndex();
  const arts=_siAxCmp.map(c=>idx.map.get(c)).filter(Boolean);
  const ser=_siAxSeries(arts,_siAxMetric,_siAxBasis);
  ser.series.forEach((s,i)=>{s.name=_siAxLabel(arts[i]);});
  const M=ser.metricDef;
  const rows=arts.map((a,i)=>{
    const vals=ser.series[i].values;let total=0,peak=null,peakAt=-1,latest=null;
    vals.forEach((v,k)=>{if(v==null)return;if(!M.cum&&!M.kind)total+=v;if(peak===null||v>peak){peak=v;peakAt=k;}latest=v;});
    if(M.cum){for(let k=vals.length-1;k>=0;k--)if(vals[k]!=null){total=vals[k];break;}}
    if(M.kind)total=latest;
    return{art:a,total,peak,peakLabel:peakAt>=0?ser.xLabels[peakAt]:'',u7:_siAxUnitsSince(a,7).u,u30:_siAxUnitsSince(a,30).u,m:_siAxStats(a)};
  });
  return{arts,ser,rows,M};
}
// "Read this": sentences built only from computed numbers. A sentence is
// omitted when any input it needs is missing.
function _siAxReadThis(rows){
  const out=[];
  const name=r=>_siAxLabel(r.art);
  const rated=rows.filter(r=>r.m.rateWeek!=null);
  if(rated.length>=2){
    const hi=rated.reduce((x,y)=>y.m.rateWeek>x.m.rateWeek?y:x),lo=rated.reduce((x,y)=>y.m.rateWeek<x.m.rateWeek?y:x);
    if(hi!==lo){
      if(lo.m.rateWeek>0)out.push(name(hi)+' sells '+_siAxNum(hi.m.rateWeek/lo.m.rateWeek)+'× faster per live week than '+name(lo)+' ('+_siAxNum(hi.m.rateWeek)+' vs '+_siAxNum(lo.m.rateWeek)+' units a week, counted window).');
      else out.push(name(hi)+' sells '+_siAxNum(hi.m.rateWeek)+' units per live week; '+name(lo)+' sold none in its counted window.');
    }
    const w=new Set(rated.map(r=>r.m.days));
    if(w.size>1)out.push('Counted windows differ: '+rated.map(r=>name(r)+' '+r.m.days+' days').join(', ')+' — rates are per live week so they stay comparable.');
  }
  rows.forEach(r=>{
    const m=r.m;
    if(m.cover!=null)out.push(name(r)+' has '+_siAxNum(m.cover)+' weeks of cover left at its last-28-day pace.');
    else if(r.art.hasStock&&r.art.onHand===0&&m.pace28!=null&&m.pace28>0)out.push(name(r)+' has no stock on hand and was selling '+_siAxNum(m.pace28)+' units a week.');
    if(m.momentum!=null)out.push(name(r)+'’s last 4 weeks are '+(m.momentum>=0?'up ':'down ')+_siAxPct(Math.abs(m.momentum))+' on the 4 weeks before.');
    if(m.risk.length)out.push(name(r)+' is out of stock in size'+(m.risk.length===1?' ':'s ')+m.risk.map(x=>x.size).join(', ')+' and sold '+m.risk.reduce((t,x)=>t+x.units,0)+' units in those sizes in the last 28 days.');
  });
  return out;
}
function _siAxCompareBody(){
  const chips=_siAxCmp.map((c,i)=>{const a=_siAxIndex().map.get(c);return a?`<span class="si-ax-chip"><i class="si-ax-badge si-ax-b${i}">${i+1}</i>${_siEsc(_siAxLabel(a))}<button aria-label="Remove ${_siEsc(_siAxLabel(a))}" data-code="${_siEsc(c)}" onclick="window._siAxRemove(this.dataset.code)">×</button></span>`:'';}).join('');
  const sel=`<div class="si-ax-bar"><span class="si-ax-lab">Metric</span><select class="si-ax-select" onchange="window._siAxSetMetric(this.value)">${Object.keys(_SI_AX_METRICS).map(k=>`<option value="${k}"${_siAxMetric===k?' selected':''}>${_siEsc(_SI_AX_METRICS[k].label)}</option>`).join('')}</select>
    <span class="si-ax-lab" style="margin-left:8px">Time basis</span>
    <button class="si-ax-btn${_siAxBasis==='calendar'?' on':''}" onclick="window._siAxSetBasis('calendar')">Calendar</button>
    <button class="si-ax-btn${_siAxBasis==='launch'?' on':''}" onclick="window._siAxSetBasis('launch')">Since launch</button>
    <button class="si-ax-btn" title="${_siAxTip('curve')}" onclick="window._siAxCurvePreset()">Age-normalised curve</button></div>`;
  const head=`<div class="si-ax-chips">${chips||'<span class="si-ax-note">Add 2–5 articles with the search box above.</span>'}</div>${_siAxMsg?`<div class="si-ax-note" style="color:var(--accent-urgent);font-weight:600" role="alert">${_siEsc(_siAxMsg)}</div>`:''}<div class="si-ax-note">${_siAxCmp.length} of ${_SI_AX_MAX} articles.</div>`;
  if(!_siAxCmp.length)return head+sel+_siAxCoverage([])+`<div class="si-ax-empty">Nothing to compare yet.</div>`;
  const d=_siAxCompareData();
  const fmtv=_siAxMetricFmt(d.M);
  const chart=_siAxChartHtml({series:d.ser.series,xLabels:d.ser.xLabels,xTicks:d.ser.xTicks,integer:!d.M.money&&!d.M.kind,money:!!d.M.money,fmt:d.M.kind?fmtv:undefined,empty:'None of the selected articles has sales in the synced data for this view, so there is no line to draw.',aria:d.M.label+' — '+d.ser.basis+' basis'});
  const cell=v=>v==null?'—':_siEsc(fmtv(v));
  const totalHead=d.M.cum?'Cumulative at end':(d.M.kind?'Latest':d.M.label+' — total');
  const tbl=`<div style="overflow-x:auto"><table class="cut-table" style="min-width:720px"><thead><tr><th>#</th><th>Article</th><th>Live</th><th>Units (counted)</th><th>Revenue (counted)</th><th>7d / 30d</th><th>${_siEsc(totalHead)}</th><th>Peak</th></tr></thead><tbody>${d.rows.map((r,i)=>`<tr><td><i class="si-ax-badge si-ax-b${i}">${i+1}</i></td><td style="font-weight:600">${_siEsc(_siAxLabel(r.art))}<div class="si-ax-note" style="margin:0">${_siEsc(r.art.code)}</div></td><td>${_siEsc(_siAxLiveText(r.art))}<div class="si-ax-note" style="margin:0">${_siEsc(_siAxAgeText(r.art))}</div></td><td>${r.art.units}</td><td>${r.art.hasPrice?_siEsc(_siPKR(Math.round(r.art.rev))):'—'}</td><td>${r.u7} / ${r.u30}</td><td>${cell(r.total)}</td><td>${cell(r.peak)} <span class="si-ax-note">${_siEsc(r.peakLabel)}</span></td></tr>`).join('')}</tbody></table></div>`;
  const th=(l,k)=>`<th title="${_siAxTip(k)}">${_siEsc(l)}</th>`;
  const badge=(i,r)=>`<td><i class="si-ax-badge si-ax-b${i}">${i+1}</i></td><td style="font-weight:600">${_siEsc(_siAxLabel(r.art))}<div class="si-ax-note" style="margin:0">${_siEsc(r.art.code)}</div></td>`;
  const dash=v=>v==null?'—':_siEsc(String(v));
  const pace=`<div style="overflow-x:auto"><table class="cut-table" style="min-width:980px"><thead><tr><th>#</th><th>Article</th><th title="Counted days: from the later of the live date and the first synced order, to today">Counted days</th>${th('Units / live week','rate')}${th('Last 28 d / week','pace')}${th('Momentum','mom')}${th('Weeks of cover','cover')}${th('Sell-through','st')}${th('In-stock rate','inrate')}${th('Units / in-stock day','perday')}${th('Stock-out days','out')}${th('Sizes in stock','avl')}</tr></thead><tbody>${d.rows.map((r,i)=>{const m=r.m;return`<tr>${badge(i,r)}<td>${dash(m.days)}${m.partial?'<div class="si-ax-note" style="margin:0">from first order</div>':''}</td><td>${_siAxNum(m.rateWeek)}</td><td>${_siAxNum(m.pace28)}</td><td>${_siAxPct(m.momentum,true)}</td><td>${m.cover!=null?_siAxNum(m.cover)+'w':'—'}${m.cover!=null?'<div class="si-ax-note" style="margin:0">'+_siEsc(m.coverBasis)+'</div>':''}</td><td>${_siAxPct(m.st&&m.st.value)}${m.st?'<div class="si-ax-note" style="margin:0">'+_siEsc(_siAxFmtDay(m.st.from,true)+' – '+_siAxFmtDay(m.st.to,true))+'</div>':''}</td><td>${_siAxPct(m.inRate)}</td><td>${_siAxNum(m.perInDay,2)}</td><td>${m.outDays!=null?m.outDays+'<div class="si-ax-note" style="margin:0">of '+m.measured+'</div>':'—'}</td><td>${m.sizesNow?m.sizesNow.n+' of '+m.sizesNow.of:'—'}${m.risk.length?'<div class="si-ax-note" style="margin:0"><span class="si-ax-flag">at risk</span> '+_siEsc(m.risk.map(x=>x.size).join(', '))+'</div>':''}</td></tr>`;}).join('')}</tbody></table></div>`;
  const shape=`<div style="overflow-x:auto"><table class="cut-table" style="min-width:640px"><thead><tr><th>#</th><th>Article</th>${th('Selling weeks','sell')}${th('Peak week','peak')}${th('First 4 weeks','first4')}${th('Share of category','share')}${th('Avg unit price','asp')}</tr></thead><tbody>${d.rows.map((r,i)=>{const m=r.m;return`<tr>${badge(i,r)}<td>${m.sellingWeeks!=null?m.sellingWeeks+' of '+m.blocks:'—'}</td><td>${m.peak?m.peak.u+' units<div class="si-ax-note" style="margin:0">'+_siEsc(_siAxFmtDay(m.peak.start,true))+'</div>':'—'}</td><td>${dash(m.first4)}${m.first4==null&&r.art.liveDay&&m.partial?'<div class="si-ax-note" style="margin:0">launch before data</div>':''}</td><td>${_siAxPct(m.catShare)}</td><td>${m.asp!=null?_siEsc(_siPKR(Math.round(m.asp))):'—'}</td></tr>`;}).join('')}</tbody></table></div>`;
  const read=_siAxReadThis(d.rows);
  const readHtml=read.length?`<div class="card"><div class="card-title">Read this — pace, cover and momentum</div><ul class="si-ax-read">${read.map(t=>`<li>${_siEsc(t)}</li>`).join('')}</ul><div class="si-ax-note">Every sentence is computed from the tables below; it is left out when its inputs are missing.</div></div>`:'';
  const basisNote=d.ser.basis==='launch'?'Since launch: x-axis is weeks (or months) since each article\'s live date, so products from different years line up at the same age.':'Calendar: the same dates on the x-axis; a line starts when the article went live.';
  return head+sel+_siAxCoverage(d.arts)+_siAxHistBanner()+_siAxScorecardHtml(d.arts)+readHtml+`<div class="card"><div class="card-title">${_siEsc(d.M.label)}</div>${chart}<div class="si-ax-note">${_siEsc(basisNote)} The latest bucket is still running. ${_siEsc(d.ser.notes.join(' '))}</div></div>
  <div class="card"><div class="card-title">Comparison table</div>${tbl}</div>
  <div class="card"><div class="card-title">Pace and stock <span class="si-ax-note">(counted window; in-stock figures: snapshot window)</span></div>${pace}<div class="si-ax-note" style="margin-top:8px">${_siAxNeedsHistoryNote()}</div></div>
  <div class="card"><div class="card-title">Shape and context</div>${shape}</div>
  ${_siAxDefsHtml()}`;
}

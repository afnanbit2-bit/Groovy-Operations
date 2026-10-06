/* ═══════════════════════════════════════════════════════════════════════
   Shopify Inventory Intelligence — client-side dashboard
   Reads shopify_* Firestore collections. The ONLY write is the shared Ignore list (inventory_article_meta, see the Ignore block).
   ═══════════════════════════════════════════════════════════════════════ */

let _siLoaded=false;
let _siLinesScope='none',_siLinesCut='';
let _siProducts=[],_siOrders=[],_siLineItems=[],_siWeeklyCloses=[],_siSnapshot=null,_siPrevSnapshot=null,_siSyncMeta={};
let _siSkuSearch='',_siSkuSort='s7',_siSkuDir=-1,_siSection='today',_siSub='',_siSecTouched=false,_siLandDone=false;
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
let _siMeta=new Map(),_siMetaState='idle',_siMetaPromise=null,_siIgVer=0; // shared Ignore list: code → doc (see the Ignore block)

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
  <div class="si-ld-wrap"><div id="si-load-host"></div>
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
  </div></div>`;
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

// ═══ Loading, honest percentage and retry (Oct 2026) ═══════════════════════
// The page's first read is ~55k documents and used to be a shimmer with no number and ONE button that re-read all of
// it. Now: seven stages with fixed weights (a stage counts only when its read really returned — no timer, no creep, never
// past 99 until _siLoaded), an overlay INSIDE the page (never position:fixed, so the sidebar and Back stay clickable) that
// appears only if the load is still running at 300ms and stays at least 500ms once shown, and a retry that re-reads ONLY
// the stages that failed. Every read is its own promise (an allSettled shape), so one refusal no longer throws away the rest.
// Weights are the share of bytes/work (a hypothesis from the dump sizes — retune from real timings).
const _SI_STAGES=[
  {id:'products',w:4, critical:true, label:'Catalog',        verb:'Reading the catalog',     noun:'reading the catalog'},
  {id:'orders',  w:10,critical:true, label:'Orders',         verb:'Reading orders',          noun:'reading orders'},
  {id:'lines',   w:50,critical:true, label:'Line items',     verb:'Reading line items',      noun:'reading line items'},
  {id:'closes',  w:1, critical:true, label:'Weekly closes',  verb:'Reading weekly closes',   noun:'reading weekly closes'},
  {id:'snap',    w:14,critical:true, label:'Stock snapshot', verb:'Checking stock',          noun:'checking stock'},
  {id:'meta',    w:3, critical:false,label:'Sync status',    verb:'Checking sync status',    noun:'checking sync status'},
  {id:'build',   w:18,critical:false,label:'Counting the stock',verb:'Counting the stock',   noun:'counting the stock'},
];
const _SI_LOAD_SHOW_MS=300,_SI_LOAD_MIN_MS=500,_SI_LOAD_SLOW_MS=20000,_SI_LOAD_TIMEOUT_MS=90000,_SI_LOAD_SETTLE_MS=400,_SI_LOAD_MAX_ATTEMPTS=3,_SI_QUOTA_WAIT_MS=10000;
const _siColl={products:false,orders:false,lines:false,closes:false}; // which collections were read OK (kept across retries)
// Pure: the percentage of a state map. Capped at 99 — 100 belongs to _siLoaded alone.
function siProgress(stages,state){
  let w=0,t=0;
  for(const s of stages){t+=s.w;if(state[s.id]==='done')w+=s.w;}
  return t?Math.min(99,Math.floor(100*w/t)):0;
}
function siProgressNext(prev,raw){return Math.max(prev,raw);} // never backwards, even if a stage finishes out of order or a retry re-marks
function _siNow(){return Date.now();}
function _siRand(){return Math.random();}
let _siLoad=_siLoadFresh();
const _siRetryCtl={timer:null,tick:null,timer2:null,auto:null,running:{},proms:{},gen:0};
function _siLoadFresh(){
  return{state:{},pct:0,startedAt:0,shownAt:0,shown:false,slow:false,final:false,finishing:false,done:false,resolved:false,resume:false,
    complete:false,attempts:{},fails:{},tok:{},quotaRetried:{},wait:null,promise:null,resolve:null,showT:null,slowT:null,toT:null,live:''};
}
// siMark(id,state): the ONE place progress moves.
function siMark(id,st,now){
  const L=_siLoad;L.state[id]=st;
  L.pct=siProgressNext(L.pct,siProgress(_SI_STAGES,L.state));
  siPaintLoad(now);
}
function _siStage(id){return _SI_STAGES.find(s=>s.id===id)||{id,label:id,verb:id,noun:id,w:0};}
function _siLoadAlive(){return typeof currentPage==='undefined'||currentPage==='shopify-intel';}
function _siHave(id){return _siCollectionsLoaded||!!_siColl[id];}
function _siFmtN(n){return Number(n).toLocaleString('en-US');}
// Classify a failure: permission (never retried), quota (one slow retry), timeout (never auto-retried), network/other.
function _siLoadErr(e){
  const msg=String((e&&e.message)||e||'Unknown error'),code=String((e&&e.code)||'');
  let cls='other';
  if(/permission-denied/i.test(code)||/insufficient permissions|permission[- ]denied/i.test(msg))cls='permission';
  else if((e&&e.quota)||/resource-exhausted/i.test(code)||/\b429\b|quota/i.test(msg))cls='quota';
  else if(/unavailable|network|offline|failed to fetch/i.test(code+' '+msg))cls='network';
  return{msg,code,cls,at:_siNow()};
}
// ── The reads. Each assigns its own result the moment it returns, so a later failure keeps it. ──
function _siColRunner(id,col,q){
  return async function(){
    const stamps=await _siFrStampsPre(); // captured BEFORE the read, so a sync landing mid-read can only make us under-claim
    const s=await getDocs(q?q():collection(db,col));
    const a=[];s.forEach(d=>{const o=d.data();o._id=d.id;a.push(o);});
    if(id==='products'){_siProducts=a;_siSeasonMapCache=null;_siProdMapCache=null;}
    else if(id==='orders')_siOrders=a;
    else if(id==='lines')_siLineItems=a;
    else _siWeeklyCloses=a;
    _siColl[id]=true;_siFrNote(id,stamps);
    if(_siColl.products&&_siColl.orders&&_siColl.lines&&_siColl.closes)_siCollectionsLoaded=true;
  };
}
const _siRunners={
  products:_siColRunner('products','shopify_products'),
  orders:_siColRunner('orders','shopify_orders'),
  // PHASE 1 of the line-item read: only the last _SI_WIN_DAYS days (single-field range on order_created_at, no composite index).
  // fresh=true is the freshness refresh (a moved order sync): it ALWAYS re-reads the window, with the SAME cut as before so the window and the
  // phase-2 read stay disjoint; if the whole history was loaded, it goes back to 'window' and phase 2 is marked as needing a reload
  // (_siFull idle) — the older rows are dropped, never mixed with a newer window without being re-read. A phase-2 read still IN FLIGHT is left
  // alone: it is disjoint from the window and concatenates onto whatever _siLineItems is when it lands.
  lines:async function(fresh){
    if(_siLinesScope==='full'&&!fresh)return;
    const stamps=await _siFrStampsPre(); // captured BEFORE the read, so a sync landing mid-read can only make us under-claim
    const t0=_siNow();
    // INCREMENTAL (Oct 2026): a freshness refresh between two full re-reads reads ONLY the trailing days and merges them by line id into
    // what is already loaded (older lines and a loaded full history are kept, not dropped and re-read). See the block "Line-item reads:
    // full at 00:00 and 12:00 PKT, incremental in between".
    if(fresh&&_siLinesCanIncr()&&!siLinesFullDue(_siLinesFullAt,t0,_siLinesForceFull)){
      const start=siLinesIncStart(_siLinesLastReadAt,_siLinesScope==='window'?_siLinesCut:'');
      if(start){
        const s=await getDocs(query(collection(db,'shopify_line_items'),where('order_created_at','>=',start)));
        const a=[];s.forEach(d=>{const o=d.data();o._id=d.id;a.push(o);});
        _siLineItems=siMergeLines(_siLineItems,a); // a NEW array: every cache keyed on array identity rebuilds
        _siLinesLastReadAt=t0;_siLinesMode='incremental';_siLinesIncN=a.length;_siLinesIncFrom=start;
        _siFrNote('lines',stamps);
        return;
      }
    }
    const cut=(fresh&&_siLinesCut)?_siLinesCut:_siPktDate(-_SI_WIN_DAYS);
    const s=await getDocs(query(collection(db,'shopify_line_items'),where('order_created_at','>=',cut)));
    const a=[];s.forEach(d=>{const o=d.data();o._id=d.id;a.push(o);});
    if(_siLinesScope==='full'||_siFull.st==='done'){_siFull.st='idle';_siFull.err=null;_siFull.n=0;_siFull.tok++;} // checked AFTER the await: a phase 2 that landed meanwhile counts
    _siLineItems=a;_siLinesScope='window';_siLinesCut=cut;
    _siLinesFullAt=t0;_siLinesLastReadAt=t0;_siLinesForceFull=false;_siLinesMode='full';_siLinesIncN=0;_siLinesIncFrom='';
    _siFrNote('lines',stamps);
    _siColl.lines=true;
    if(_siColl.products&&_siColl.orders&&_siColl.lines&&_siColl.closes)_siCollectionsLoaded=true;
  },
  closes:_siColRunner('closes','shopify_weekly_closes',()=>query(collection(db,'shopify_weekly_closes'),orderBy('week_ending','desc'))),
  snap:async function(){
    const stamps=await _siFrStampsPre();
    const today=_siPktDate(0),yesterday=_siPktDate(-1);
    let snap=await getDoc(doc(db,'shopify_inventory_snapshots',today));
    if(!snap.exists())snap=await getDoc(doc(db,'shopify_inventory_snapshots',yesterday));
    if(snap.exists())_siSnapshot=snap.data();
    if(!_siSnapshot)throw new Error('Inventory snapshot unavailable (no snapshot for today or yesterday).');
    _siFrNote('snap',stamps);
  },
  meta:async function(){ // never fatal: the page says "unknown" for what is missing
    try{const snap=await getDoc(doc(db,'shopify_inventory_snapshots',_siPktDate(-7)));if(snap.exists())_siPrevSnapshot=snap.data();_siFr.prevDay=_siPktDate(-7);}catch(_){}
    try{
      const r=await Promise.all([getDoc(doc(db,'shopify_sync_meta','catalog_sync')),getDoc(doc(db,'shopify_sync_meta','order_backfill')),getDoc(doc(db,'shopify_sync_meta','inventory_sync'))]);
      _siSyncMeta={catalog:r[0].exists()?r[0].data():{},orders:r[1].exists()?r[1].data():{},inventory:r[2].exists()?r[2].data():{}};
    }catch(_){}
    // the 4-hourly order sync's own status doc (the 'orders' entry above is the backfill's); missing = "unknown" on screen
    try{const s4=await getDoc(doc(db,'shopify_sync_meta','order_sync'));_siSyncMeta.orderSync=s4.exists()?s4.data():null;}catch(_){}
  },
  build:async function(){ // the first index over the loaded rows — real CPU the first render would otherwise pay for after the bar said 100
    if(_siLoad.shown)await new Promise(r=>setTimeout(r,16)); // let the "Counting the stock" paint before the thread is busy
    try{if(typeof _siAxIndex==='function')_siAxIndex();}catch(_){}
  },
};
function _siStageNeeds(id){
  if(id==='snap')return!_siSnapshot;
  if(id==='meta')return true;
  if(id==='build')return false; // runs after the critical stages, from _siLoadSettle
  return!_siHave(id);
}
// ── The controller ──
function siRetryClearTimers(){
  const C=_siRetryCtl;
  if(C.timer){clearTimeout(C.timer);C.timer=null;}
  if(C.tick){clearInterval(C.tick);C.tick=null;}
  if(C.timer2){clearTimeout(C.timer2);C.timer2=null;}
  if(C.auto){clearInterval(C.auto);C.auto=null;}
}
function siRetryCancel(){siRetryClearTimers();_siRetryCtl.gen++;}
function _siLoadClearWatch(){
  const L=_siLoad;
  [ 'showT','slowT','toT' ].forEach(k=>{if(L[k]){clearTimeout(L[k]);L[k]=null;}});
}
function _siLoadResolveOnce(){const L=_siLoad;if(!L.resolved&&L.resolve){L.resolved=true;L.resolve();}}
// Leaving the page: nothing may keep running that could write to a page nobody is on.
function _siLoadLeave(){
  const L=_siLoad;
  siRetryCancel();_siLoadClearWatch();
  if(L.finishing){L.finishing=false;L.final=true;L.done=false;_siLoadResolveOnce();return;}
  if(!L.final&&L.promise&&!L.resolved){
    L.wait=null;L.final=true;
    const f=_siLoadFailedIds();
    _siLoadError=f.length?_siLoadErrorText(f):null;
    _siLoadResolveOnce();
  }
}
function _siLoadFailedIds(){return _SI_STAGES.filter(s=>s.critical&&_siLoad.state[s.id]==='failed'&&_siLoad.fails[s.id]).map(s=>s.id);}
function _siLoadErrorText(ids){return ids.map(id=>_siStage(id).label+': '+_siLoad.fails[id].msg).join('; ');}
function siLoadBegin(){
  const L0=_siLoad,C=_siRetryCtl;
  siRetryCancel();_siLoadClearWatch();
  const L=_siLoad=_siLoadFresh();
  // keep the stages already running or held; everything else restarts for this visit
  _SI_STAGES.forEach(s=>{
    const held=s.id==='snap'?!!_siSnapshot:s.id==='meta'||s.id==='build'?false:_siHave(s.id);
    L.state[s.id]=C.running[s.id]?'active':held?'done':'pending';
    L.attempts[s.id]=C.running[s.id]?(L0.attempts[s.id]||1):0;
    L.tok[s.id]=L0.tok[s.id]||0;
  });
  L.pct=siProgress(_SI_STAGES,L.state);
  L.promise=new Promise(r=>{L.resolve=r;});
  if(L0.resolve&&!L0.resolved){L0.resolved=true;L0.resolve(L.promise);} // a page left mid-load: its waiter follows this load
  L.startedAt=_siNow();
  if(_siLoadAlive())L.showT=setTimeout(()=>{L.showT=null;if(!L.final&&!L.shown&&_siLoad===L)_siLoadShow();},_SI_LOAD_SHOW_MS);
  _siLoadArmWatch();
}
function _siLoadArmWatch(){
  const L=_siLoad;
  if(L.slowT)clearTimeout(L.slowT);if(L.toT)clearTimeout(L.toT);
  L.slow=false;
  L.slowT=setTimeout(()=>{L.slowT=null;L.slow=true;siPaintLoad();},_SI_LOAD_SLOW_MS);
  L.toT=setTimeout(()=>{L.toT=null;_siLoadTimeout();},_SI_LOAD_TIMEOUT_MS);
}
function _siLoadTimeout(){
  const L=_siLoad,C=_siRetryCtl;
  const act=_SI_STAGES.filter(s=>L.state[s.id]==='active');
  if(!act.length)return;
  act.forEach(s=>{L.tok[s.id]++;C.running[s.id]=false;L.fails[s.id]={msg:'Timed out after '+(_SI_LOAD_TIMEOUT_MS/1000)+'s while '+s.noun,code:'timeout',cls:'timeout',at:_siNow()};siMark(s.id,'failed');});
  _siLoadSettle();
}
function _siLoadShow(force){
  const L=_siLoad;
  if(!_siLoadAlive()||typeof document==='undefined'||!document.getElementById)return;
  if(L.shown&&!force)return;
  const host=document.getElementById('si-load-host');
  if(host&&String(host.innerHTML||'').indexOf('id="si-load"')<0)host.innerHTML=_siLoaderHTML(true);
  if(!L.shown){L.shown=true;L.shownAt=_siNow();}
  siPaintLoad();
}
function _siLoadRunStages(ids){
  const L=_siLoad,C=_siRetryCtl,gen=C.gen;
  ids.forEach(id=>{
    const after=()=>{if(C.gen===gen)_siLoadSettle();};
    if(C.running[id]){if(C.proms[id])C.proms[id].then(after);return;} // already in flight (page re-entered): follow it, never read twice
    C.running[id]=true;
    L.attempts[id]=(L.attempts[id]||0)+1;
    const tok=L.tok[id]=(L.tok[id]||0)+1;
    siMark(id,'active');
    let p;try{p=Promise.resolve(_siRunners[id]());}catch(e){p=Promise.reject(e);}
    C.proms[id]=p.then(()=>{
      if(L.tok[id]===tok)C.running[id]=false;
      if(L.state[id]!=='done'){delete L.fails[id];siMark(id,'done');} // a late success after a timeout still counts
    },e=>{
      if(L.tok[id]===tok){C.running[id]=false;if(L.state[id]!=='done'){L.fails[id]=_siLoadErr(e);siMark(id,'failed');}}
    });
    C.proms[id].then(after);
  });
  _siLoadArmWatch();
}
function _siLoadAutoPlan(failedIds){
  const L=_siLoad;let delay=0,k=0;
  for(const id of failedIds){
    const f=L.fails[id],n=L.attempts[id]||1;
    if(!f||f.cls==='permission'||f.cls==='timeout'||n>=_SI_LOAD_MAX_ATTEMPTS)return null;
    if(f.cls==='quota'&&(L.quotaRetried[id]||0)>=1)return null; // a quota problem gets ONE slow retry, then the button
    const base=f.cls==='quota'?_SI_QUOTA_WAIT_MS:(n===1?2000:5000);
    delay=Math.max(delay,base*(f.cls==='quota'?1+0.2*_siRand():0.8+0.4*_siRand()));
    k=Math.max(k,n+1);
  }
  return failedIds.length?{ids:failedIds.slice(),delay:Math.round(delay),k}:null;
}
function _siLoadWait(plan){
  const L=_siLoad,C=_siRetryCtl,gen=C.gen;
  siRetryClearTimers();
  L.wait={until:_siNow()+plan.delay,total:plan.delay,ids:plan.ids,k:plan.k};
  _siLoadShow(true);
  C.timer=setTimeout(()=>{
    C.timer=null;if(C.tick){clearInterval(C.tick);C.tick=null;}
    if(C.gen!==gen)return;
    _siLoadGoRetry(plan.ids);
  },plan.delay);
  C.tick=setInterval(()=>{if(C.gen!==gen)return;if(!_siLoadAlive()){_siLoadLeave();return;}siPaintLoad();},1000);
  siPaintLoad();
}
function _siLoadGoRetry(ids){
  const L=_siLoad;
  L.wait=null;L.resume=true;L.final=false;
  ids.forEach(id=>{const f=L.fails[id];if(f&&f.cls==='quota')L.quotaRetried[id]=(L.quotaRetried[id]||0)+1;});
  _siLoadRunStages(ids);
}
function _siLoadSettle(){
  const L=_siLoad,C=_siRetryCtl,st=id=>L.state[id];
  if(L.finishing||L.complete||C.timer)return;
  if(_SI_STAGES.some(s=>st(s.id)==='active'))return;
  const crit=_SI_STAGES.filter(s=>s.critical);
  const failed=crit.filter(s=>st(s.id)==='failed').map(s=>s.id);
  if(failed.length){
    if(L.final)return;
    if(_siLoadAlive()){const plan=_siLoadAutoPlan(failed);if(plan){_siLoadWait(plan);return;}}
    _siLoadFinalFail();return;
  }
  if(crit.some(s=>st(s.id)!=='done'))return;
  if(st('build')!=='done'){if(!C.running.build)_siLoadRunStages(['build']);return;}
  _siLoadSucceed();
}
function _siLoadFinalFail(){
  const L=_siLoad;
  L.final=true;L.wait=null;_siLoadClearWatch();siRetryClearTimers();
  const ids=_siLoadFailedIds();
  _siLoadError=_siLoadErrorText(ids)||'Load failed';
  if(L.resolved)siPaintLoad();else{_siLoadShow(true);_siLoadResolveOnce();}
}
function _siLoadReduced(){try{return!!(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}}
function _siLoadSucceed(){
  const L=_siLoad,C=_siRetryCtl,gen=C.gen;
  _siLoaded=true;_siLoadError=null;L.wait=null;_siLoadClearWatch();siRetryClearTimers();
  const late=L.resolved; // the page's waiter already resolved: a retry in place, so we repaint the page ourselves
  const finish=()=>{
    L.finishing=false;L.final=true;L.complete=true;
    _siFrStart(false);
    if(late){if(_siLoadAlive()&&typeof document!=='undefined'&&document.getElementById){const m=document.getElementById('main-content');if(m)m.innerHTML=renderShopifyDashboard();}}
    else _siLoadResolveOnce();
  };
  if(!L.shown){finish();return;}
  L.finishing=true;siPaintLoad(); // the view reads 100 once _siLoaded is true
  const hold=Math.max(0,L.shownAt+_SI_LOAD_MIN_MS-_siNow());
  C.timer2=setTimeout(()=>{
    C.timer2=null;if(C.gen!==gen)return;
    L.done=true;siPaintLoad();
    C.timer2=setTimeout(()=>{C.timer2=null;if(C.gen!==gen)return;finish();},_siLoadReduced()?0:_SI_LOAD_SETTLE_MS);
  },hold);
}
// ── Retry actions (single controller; a busy stage ignores a second press) ──
window._siRetryStage=function(id){
  const L=_siLoad,C=_siRetryCtl;
  if(!_SI_STAGES.some(s=>s.id===id)||C.running[id]||L.state[id]!=='failed'||!_siLoadAlive())return;
  siRetryClearTimers();L.wait=null;
  if(id==='lines')_siLinesForceFull=true; // a manual Retry of the line items is always a full read
  L.attempts[id]=0;L.quotaRetried[id]=0;_siLoadError=null;L.final=false;L.resume=true;
  const f=L.fails[id];
  if(f&&f.cls==='quota'){const rem=f.at+_SI_QUOTA_WAIT_MS-_siNow();if(rem>0){_siLoadWait({ids:[id],delay:rem,k:1});return;}}
  _siLoadShow(true);
  _siLoadRunStages([id]);
};
window._siRetryNow=function(){ // skip the countdown
  const L=_siLoad;
  if(!L.wait||!_siLoadAlive())return;
  const ids=L.wait.ids;siRetryClearTimers();_siLoadGoRetry(ids);
};
window._siRetryAll=function(){
  const L=_siLoad;
  const ids=_siLoadFailedIds().filter(id=>!_siRetryCtl.running[id]);
  if(!ids.length||!_siLoadAlive())return;
  siRetryCancel();L.wait=null;L.final=false;L.resume=true;_siLoadError=null;
  ids.forEach(id=>{L.attempts[id]=0;L.quotaRetried[id]=0;});
  _siLoadShow(true);
  _siLoadRunStages(ids);
};
window._siLdRetry=function(id){if(_siLoad.wait)window._siRetryNow();else window._siRetryStage(id);};
function _siLoadDetailsText(){
  const L=_siLoad,lines=['Inventory Intelligence load details'];
  lines.push('Time: '+new Date(_siNow()).toISOString());
  lines.push('Online: '+(typeof navigator!=='undefined'&&navigator.onLine===false?'no':'yes'));
  let b='unknown';try{const s=document.querySelector('script[src*="shopify.js"]');if(s&&s.getAttribute)b=(s.getAttribute('src')||'').split('?v=')[1]||'unknown';}catch(_){}
  lines.push('Build: '+b);
  lines.push('Percent when stopped: '+_siLoadView().pct);
  const ids=_SI_STAGES.filter(s=>L.fails[s.id]).map(s=>s.id);
  if(!ids.length)lines.push('No failed stage recorded'+(_siLoadError?' ('+_siLoadError+')':''));
  ids.forEach(id=>{const f=L.fails[id];lines.push('Stage: '+_siStage(id).label+' ('+id+')','  Code: '+(f.code||'none'),'  Message: '+f.msg,'  Attempts: '+(L.attempts[id]||0)+' of '+_SI_LOAD_MAX_ATTEMPTS);});
  return lines.join('\n');
}
window._siCopyDetails=function(btn){
  const txt=_siLoadDetailsText();
  const fb=()=>{try{const ta=document.createElement('textarea');ta.value=txt;ta.setAttribute('style','position:fixed;left:-9999px');document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();if(btn)btn.textContent='Copied';}catch(e){if(btn)btn.textContent='Could not copy';}};
  try{navigator.clipboard.writeText(txt).then(()=>{if(btn)btn.textContent='Copied';},fb);}catch(e){fb();}
  return txt;
};
// ── The view (pure of the DOM) ──
function _siLoadView(){
  const L=_siLoad,fails=_siLoadFailedIds();
  const act=_SI_STAGES.filter(s=>L.state[s.id]==='active').sort((a,b)=>b.w-a.w);
  const pct=_siLoaded?100:Math.min(99,L.pct);
  let mode='load';
  if(L.done)mode='done';else if(L.wait)mode='wait';else if((fails.length||_siLoadError)&&!act.length)mode='fail';
  const failed=mode==='wait'?L.wait.ids:fails;
  let stage,detail='',cd='';
  if(mode==='done')stage='Ready';
  else if(mode==='load'){
    const a=act[0];
    stage=a?(L.slow?'Still '+a.noun+' — slow connection':a.verb+'…'):'Starting…';
    if(!a&&L.state.build==='done')stage='Finishing…';
  }else{
    stage='Stopped while '+(failed.length===1?_siStage(failed[0]).noun:failed.length?'loading '+failed.map(id=>_siStage(id).label.toLowerCase()).join(' and '):'loading');
    detail=failed.map(id=>{const f=L.fails[id];if(!f)return'';return _siStage(id).label+': '+f.msg+' — attempt '+(L.attempts[id]||1)+' of '+_SI_LOAD_MAX_ATTEMPTS+(f.cls==='quota'?'\nThis is a Firestore read quota problem, not a bug here — check Firebase Console → Usage.':f.cls==='permission'?'\nPermission refused: firestore.rules may need republishing.':'');}).filter(Boolean).join('\n');
    if(!detail&&_siLoadError)detail=String(_siLoadError);
    if(mode==='wait'){
      const s=Math.max(0,Math.ceil((L.wait.until-_siNow())/1000));
      cd=failed.map(id=>_siStage(id).label).join(' and ')+' failed — retrying in '+s+'s… (attempt '+L.wait.k+' of '+_SI_LOAD_MAX_ATTEMPTS+')';
    }
  }
  const parts=[];
  if(_siColl.products||_siCollectionsLoaded)parts.push(_siFmtN(_siProducts.length)+' catalog entries');
  if(_siColl.lines||_siCollectionsLoaded)parts.push(_siFmtN(_siLineItems.length)+' line items'+(_siLinesPartial()?' (last '+_SI_WIN_DAYS+' days)':''));
  const retryable=mode==='fail'?fails:[];
  return{pct,mode,stage,sub:parts.join(' · '),detail,cd,failed,retryable,
    bucket:Math.floor(pct/25),text:stage+', '+pct+' percent',frac:pct/100,
    total:L.wait?L.wait.total:0,multi:fails.length>=2};
}
const _SI_GARMENTS=[
  'M-9 10L-30 24L-26 52L-16 50L-14 34V74H14V34L16 50L26 52L30 24L9 10Q0 24-9 10Z',
  'M-8 10L-28 20L-22 32L-14 28V72H14V28L22 32L28 20L8 10Q0 17-8 10Z',
  'M-14 10H14L17 76H4L0 36L-4 76H-17Z'];
function _siLoaderHTML(overlay){
  const v=_siLoadView();
  let g='';
  for(let i=0;i<8;i++){
    const x=40+i*45,k=i%3,cls=(i===3?' hot':'')+(i===5?' gap':i>5?' late':'');
    g+='<g transform="translate('+x+' 0)"><g class="gm'+cls+'" style="--i:'+i+'"><path class="hk" d="M0 10V5a4 4 0 1 0-4-4"/><path class="b" d="'+_SI_GARMENTS[k]+'"/></g></g>';
  }
  const fail=v.mode==='wait'||v.mode==='fail';
  return'<div class="si-ld-card'+(overlay?' over':' flow')+(fail?' fail':'')+(_siLoadReduced()?' rm':'')+'" id="si-load" data-mode="'+v.mode+'">'
   +'<div class="si-ld-stage"><svg viewBox="0 -8 400 96" aria-hidden="true"><path class="rail" d="M10 0H390"/>'+g+'</svg></div>'
   +'<div class="si-ld-prog" role="progressbar" aria-label="Loading inventory data" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+v.pct+'" aria-valuetext="'+_siEsc(v.text)+'">'
   +'<div class="si-ld-num"><span id="si-ld-n">'+v.pct+'</span><small>%</small></div>'
   +'<div class="si-ld-stg" id="si-ld-stg">'+_siEsc(v.stage)+'</div>'
   +'<div class="si-ld-sub" id="si-ld-sub">'+_siEsc(v.sub)+'</div>'
   +'<div class="si-ld-bar"><i id="si-ld-bar" style="--p:'+v.frac+'"></i></div></div>'
   +'<div class="si-ld-err"><div class="si-ld-cd" id="si-ld-cd" role="timer">'+_siEsc(v.cd)+'</div><div class="si-ld-cdb" id="si-ld-cdb">'+(v.mode==='wait'?'<i style="animation-duration:'+v.total+'ms"></i>':'')+'</div>'
   +'<div class="si-ld-detail" id="si-ld-detail" role="alert">'+_siEsc(v.detail)+'</div>'
   +'<div class="si-ld-btns" id="si-ld-btns">'+_siLoaderBtns(v)+'</div></div>'
   +'<div class="si-ld-live" id="si-ld-live" aria-live="polite"></div></div>';
}
function _siLoaderBtns(v){
  if(v.mode==='wait')return'<button type="button" class="si-ld-rt" onclick="window._siLdRetry()">Retry now</button>';
  if(v.mode!=='fail')return'';
  let h=v.retryable.length?'':'<button type="button" class="si-ld-rt" onclick="window._siRetry()">Retry</button>';
  h+=v.retryable.map(id=>'<button type="button" class="si-ld-rt" onclick="window._siRetryStage(\''+id+'\')">'+(v.retryable.length>1?'Retry '+_siEsc(_siStage(id).label.toLowerCase()):'Retry this stage')+'</button>').join('');
  if(v.multi)h+='<button type="button" class="si-ld-alt" onclick="window._siRetryAll()">Retry everything</button>';
  return h+'<button type="button" class="si-ld-alt" onclick="window._siCopyDetails(this)">Copy details</button>';
}
let _siLdPainted={mode:'',bucket:-1,stage:''};
function siPaintLoad(){
  if(typeof document==='undefined'||!document.getElementById)return;
  const card=document.getElementById('si-load');if(!card)return;
  const v=_siLoadView(),L=_siLoad,set=(id,t)=>{const e=document.getElementById(id);if(e&&e.textContent!==t)e.textContent=t;};
  const cls=(e,n,on)=>{if(e&&e.classList){if(on)e.classList.add(n);else e.classList.remove(n);}};
  const fail=v.mode==='wait'||v.mode==='fail';
  cls(card,'fail',fail);cls(card,'done',v.mode==='done');cls(card,'resume',!!L.resume&&!fail);
  if(card.setAttribute)card.setAttribute('data-mode',v.mode);
  set('si-ld-n',String(v.pct));set('si-ld-stg',v.stage);set('si-ld-sub',v.sub);set('si-ld-cd',v.cd);set('si-ld-detail',v.detail);
  const bar=document.getElementById('si-ld-bar');if(bar&&bar.style&&bar.style.setProperty)bar.style.setProperty('--p',String(v.frac));
  const pg=card.querySelector&&card.querySelector('.si-ld-prog');
  if(pg&&pg.setAttribute){pg.setAttribute('aria-valuenow',String(v.pct));pg.setAttribute('aria-valuetext',v.text);}
  if(_siLdPainted.mode!==v.mode||_siLdPainted.bucket!==v.bucket||_siLdPainted.stage!==v.stage&&v.mode!=='load'){
    // the live region speaks on a quarter-bucket or a mode change only — a screen reader hears a handful of messages, not a hundred
    const live=document.getElementById('si-ld-live');if(live)live.textContent=v.text;
  }
  _siLdPainted={mode:v.mode,bucket:v.bucket,stage:v.stage};
  const btns=document.getElementById('si-ld-btns');if(btns){const h=_siLoaderBtns(v);if(btns._h!==h){btns.innerHTML=h;btns._h=h;}}
  const cdb=document.getElementById('si-ld-cdb');if(cdb){const h=v.mode==='wait'?'<i style="animation-duration:'+v.total+'ms"></i>':'';if(cdb._h!==h){cdb.innerHTML=h;cdb._h=h;}}
}
(function(){ // leaving the page cancels every timer and pending retry
  if(typeof window!=='undefined'&&typeof window.showPage==='function'&&!window.showPage.__si){
    const o=window.showPage;
    const w=function(id){if(id!=='shopify-intel')_siLoadLeave();const r=o.apply(this,arguments);if(id==='shopify-intel'&&_siLoaded)_siFrStart(true);return r;};
    w.__si=true;window.showPage=w;
  }
})();

// ═══ Line-item reads: full at 00:00 and 12:00 PKT, incremental in between (Oct 2026) ══════════════════════════════════════
// shopify_line_items is ~51k documents and Firestore bills per document read. Owner's rule: re-read the (window of) line items in full
// only at 00:00 and 12:00 Pakistan time (PKT = UTC+5, no DST); a refresh in between reads ONLY the trailing days and merges them.
// WHAT IDENTIFIES NEW/CHANGED LINES (read from the functions, not guessed): shopify-order-sync.js writes a line once, with order_created_at
//   (the order's created_at) and synced_at (a server timestamp, never rewritten); it looks back 48 h and skips orders it holds.
//   netlify/lib/shopify-order-refresh.js updates only status fields in place and stamps status_synced_at, on lines of recent orders.
//   So a NEW line has order_created_at within about 48 h of the sync that wrote it, and a status change lands on a line of a recent order.
//   synced_at / status_synced_at are the exact "changed since" fields, but they are Firestore Timestamps and this page has no Timestamp
//   constructor bridged (index.html is cross-track), so a range on them cannot be built here. The safe alternative used instead: a
//   single-field range on order_created_at (the same automatic index the window read uses) starting 72 h before the previous read, floored
//   to a PKT day. 72 h > the 48 h sync look-back, so every line written since the last read is inside it, and status changes to lines of
//   those recent orders are picked up too (same id replaces).
// HONEST LIMIT: a refund, void or cancellation applied to a line of an order OLDER than that trailing window stays stale until the next
//   full read (the refund job's own window can reach back much further). A full read is forced by: no earlier full read in memory, the
//   boundary passing, the returns-refresh button, and a manual Retry of the line-item stage.
// The decision uses MEMORY, not localStorage: what is in memory is what defines "already loaded"; a reload starts empty and reads in full.
const _SI_INC_BACK_MS=72*3600000,_SI_PKT_OFFSET_MS=5*3600000,_SI_HALF_DAY_MS=12*3600000;
let _siLinesFullAt=null,_siLinesLastReadAt=null,_siLinesForceFull=false,_siLinesMode='',_siLinesIncN=0,_siLinesIncFrom='';
// Pure: the most recent 00:00 or 12:00 PKT at or before nowMs, as epoch ms.
function siFullBoundary(nowMs){return Math.floor((nowMs+_SI_PKT_OFFSET_MS)/_SI_HALF_DAY_MS)*_SI_HALF_DAY_MS-_SI_PKT_OFFSET_MS;}
// Pure: is a full re-read due? No earlier full read, a forced one, or the last full read is before the latest boundary.
function siLinesFullDue(lastFullMs,nowMs,force){
  if(force||lastFullMs==null||!isFinite(lastFullMs))return true;
  return lastFullMs<siFullBoundary(nowMs);
}
// Pure: the first PKT day (YYYY-MM-DD) an incremental read must cover; null when there is no previous read to build on.
function siLinesIncStart(lastReadMs,floorDay){
  if(lastReadMs==null||!isFinite(lastReadMs))return null;
  const d=new Date(lastReadMs-_SI_INC_BACK_MS+_SI_PKT_OFFSET_MS).toISOString().slice(0,10);
  return floorDay&&floorDay>d?floorDay:d; // never below the window's cut: the older rows belong to phase 2 and must stay disjoint
}
// Pure: merge by line id. Same id: the incoming copy replaces it in place (newest wins; a later duplicate inside incoming wins too);
// new ids are appended. Always returns a NEW array; a document is never duplicated.
function siMergeLines(existing,incoming){
  const out=(existing||[]).slice(),at=new Map();
  out.forEach((o,i)=>{if(o&&o._id!=null)at.set(o._id,i);});
  (incoming||[]).forEach(o=>{
    if(o&&o._id!=null&&at.has(o._id))out[at.get(o._id)]=o;
    else{if(o&&o._id!=null)at.set(o._id,out.length);out.push(o);}
  });
  return out;
}
function _siLinesCanIncr(){return!!_siColl.lines&&(_siLinesScope==='window'||_siLinesScope==='full')&&_siLinesLastReadAt!=null;}
// Pure text for the freshness card: when the last full read was, and whether the data now is that read or merged on top of it.
function siLinesFreshText(fullAt,mode,incN,incFrom){
  if(fullAt==null||!mode)return'';
  const t='Last full refresh: '+_siFrFmt(fullAt)+'.';
  const m=mode==='incremental'?' Line items since then: incremental (read from '+incFrom+', '+incN+' lines merged in).':' Line items: this is the full read.';
  return t+m+' Later refunds and voids on older lines show at the next full refresh (00:00 or 12:00 PKT).';
}

// ═══ Line items in two phases (Oct 2026, load-time stage 2) ═════════════════════════════════════════════════════════════
// Phase 1 (the 'lines' stage above, inside the percentage) reads only the last _SI_WIN_DAYS days of shopify_line_items:
//   where('order_created_at','>=',<PKT day>) — one field, so Firestore's automatic single-field index serves it (firestore.indexes.json
//   has no fieldOverrides that exempt it). order_created_at is Shopify's offset timestamp string; 'YYYY-MM-DD' compares correctly against it.
// Phase 2 (this block) reads ONLY THE REST, where('order_created_at','<',<same day>) — disjoint from phase 1, so the two together cost
//   exactly what the old single read cost and nothing is read twice. It runs only when a view that needs the whole history is opened
//   (_SI_FULL_SECTIONS) or when the person presses "Load full history". It is outside the percentage: its size is not known in advance, so
//   it shows an indeterminate bar and never a made-up number. It has its own state, a timeout and a manual Retry.
// A figure that needs the whole history is never shown from the window as if it were complete: it says "needs full history".
const _SI_WIN_DAYS=90,_SI_FULL_TIMEOUT_MS=120000;
// Section / sub-view ids (the four-section model: _SI_SECTIONS + _SI_SUBVIEWS) that need the whole history. Articles covers its Explorer AND its Type & season sub-view.
const _SI_FULL_SECTIONS=['attention','articles','ignored'];
const _siFull={st:'idle',err:null,tries:0,n:0,tok:0};
function _siFullHist(){return _siLinesScope!=='window';} // 'none' = line items were not read through the window (nothing loaded yet, or data placed directly): never gate it
function _siLinesPartial(){return _siLinesScope==='window';}
// Which gated id is on screen: an open sub-view first (Ignored), else its section; '' when this view works from the window.
function _siFullKey(){
  const r=_siSecResolve(_siSection);
  if(_siSub&&_SI_FULL_SECTIONS.indexOf(_siSub)>=0)return _siSub;
  return _SI_FULL_SECTIONS.indexOf(r.sec)>=0?r.sec:'';
}
function _siFullLabel(){return({attention:'Needs Attention',articles:_siSub==='typeseason'?'Type & season':'The Article Explorer',ignored:'The Ignored list'})[_siFullKey()]||'This view';}
// start (or, manual, restart after a failure) the read of the older line items. Never reads twice; returns nothing.
function _siFullStart(manual){
  const F=_siFull;
  if(!_siLinesPartial()||F.st==='loading'||F.st==='done')return;
  if(F.st==='failed'&&!manual)return;
  if(typeof getDocs!=='function'||typeof where!=='function'){F.st='failed';F.err={msg:'The Firestore query helpers are not available on this build.',code:'',cls:'other',at:_siNow()};return;}
  F.st='loading';F.err=null;F.tries++;
  const t=++F.tok,cut=_siLinesCut;
  const guard=setTimeout(()=>{if(F.tok===t&&F.st==='loading'){F.st='failed';F.err={msg:'Timed out after '+(_SI_FULL_TIMEOUT_MS/1000)+'s while reading older line items',code:'timeout',cls:'timeout',at:_siNow()};_siFullPaint();}},_SI_FULL_TIMEOUT_MS);
  let p;try{p=Promise.resolve(getDocs(query(collection(db,'shopify_line_items'),where('order_created_at','<',cut))));}catch(e){p=Promise.reject(e);}
  p.then(s=>{
    clearTimeout(guard); // a read that lands after the timeout is still good data: accept it
    if(!_siLinesPartial()||_siLinesCut!==cut)return;
    const a=[];s.forEach(d=>{const o=d.data();o._id=d.id;a.push(o);});
    _siLineItems=siMergeLines(_siLineItems,a); // a new array (every cache keyed on it rebuilds); by id, so a line an incremental read already brought is never doubled
    _siLinesScope='full';F.st='done';F.err=null;F.n=a.length;
    _siFullPaint();
  },e=>{
    clearTimeout(guard);
    if(F.tok!==t||_siFullHist())return;
    F.st='failed';F.err=_siLoadErr(e);_siFullPaint();
  });
}
window._siFullLoad=function(){_siFullStart(true);_siFullPaint();};
function _siFullErrText(){
  const e=_siFull.err;if(!e)return'';
  return e.msg+(e.cls==='quota'?' — this is a Firestore read quota problem, not a bug here (Firebase Console → Usage).':e.cls==='permission'?' — permission refused: firestore.rules may need republishing.':'');
}
function _siFullBtn(label){return'<button type="button" class="si-full-btn" onclick="window._siFullLoad()">'+label+'</button>';}
// The card that REPLACES a view that cannot be shown from the window. Starting the read is the caller's job (_siRenderSection).
function _siFullGateHtml(label){
  const F=_siFull;
  const head='<div class="card-title">'+_siEsc(label||_siFullLabel())+' needs the full sales history</div>';
  if(F.st==='failed')return'<div class="card si-full-card fail" id="si-full-gate" data-st="failed" role="alert">'+head+'<div class="si-full-txt">Could not read the older line items. '+_siEsc(_siFullErrText())+'</div><div>'+_siFullBtn('Retry')+'</div></div>';
  return'<div class="card si-full-card" id="si-full-gate" data-st="'+F.st+'" role="status">'+head+'<div class="si-full-txt">It works from every order line since the store opened, and only the last '+_SI_WIN_DAYS+' days are loaded so far. Reading the older line items…</div><div class="si-full-bar"><i></i></div><div class="si-full-note">The size of this read is not known in advance, so no percentage is shown.</div></div>';
}
// The strip above a view that is correct from the window for most of its figures.
function _siFullStripHtml(){
  if(!_siLinesPartial())return'';
  const F=_siFull;
  const cut=_siEsc(_siLinesCut);
  if(F.st==='loading')return'<div class="si-full-strip" id="si-full-strip" data-st="loading" role="status"><span>Reading the older line items…</span><span class="si-full-bar sm"><i></i></span></div>';
  if(F.st==='failed')return'<div class="si-full-strip fail" id="si-full-strip" data-st="failed" role="alert"><span>Could not read the older line items. '+_siEsc(_siFullErrText())+'</span>'+_siFullBtn('Retry')+'</div>';
  return'<div class="si-full-strip" id="si-full-strip" data-st="idle"><span>Showing the last '+_SI_WIN_DAYS+' days of sales (from '+cut+'). Figures that need the whole history say “needs full history”.</span>'+_siFullBtn('Load full history')+'</div>';
}
function _siFullNeedsCell(){return'<span class="si-full-need">needs full history</span>';}
function _siFullPaint(){
  if(typeof document==='undefined'||!document.getElementById||!_siLoaded||!_siLoadAlive())return;
  try{
    if(_siFullHist()){const bar=document.getElementById('si-tab-bar');if(bar)bar.outerHTML=_siTabBar();_siRefreshContent();return;}
    const g=document.getElementById('si-full-gate');if(g)g.outerHTML=_siFullGateHtml(_siFullLabel());
    const s=document.getElementById('si-full-strip');if(s)s.outerHTML=_siFullStripHtml();
  }catch(_){}
}

// ── Data loader ─────────────────────────────────────────────────────
// Resolves when the load has SETTLED (loaded, or failed for good after its automatic retries); _siLoaded says which.
async function loadShopifyData(){
  _siLoadError=null;
  siLoadBegin();
  const C=_siRetryCtl;
  const ids=_SI_STAGES.filter(s=>s.id!=='build'&&(C.running[s.id]||_siStageNeeds(s.id))).map(s=>s.id);
  // A warm per-device history cache makes the stock-history read tiny (the newest days only), so it starts WITH the load and is
  // usually landed by the first paint. A cold one is a full read of up to 150 snapshots: it starts after the first paint as
  // before, so it does not compete with the line items for bandwidth. Either way it stays outside the percentage.
  if(_siHistState==='idle'&&typeof getDocs==='function'&&_siHistCacheRead())_siAxEnsureHistory();
  if(_siMetaState==='idle')_siMetaLoad(); // the shared ignore list: tiny, in parallel, outside the percentage; a failed read hides nothing
  if(ids.length)_siLoadRunStages(ids);else _siLoadSettle();
  return _siLoad.promise;
}

// ═══ Freshness: "Data as of", a cheap Refresh and a 10-minute meta-gated auto-refresh ═══
// What is on screen was read at some moment. This block says WHEN (per source, from the stamps the sync functions write into
// shopify_sync_meta), flags a source older than twice its schedule IN WORDS, and re-reads only what moved:
//   1. read the small meta docs (catalog_sync, order_sync, order_refresh[+_now], inventory_sync) — never a big collection;
//   2. compare each source's last_success_at with the stamp captured BEFORE this page's last read of the collections it feeds;
//   3. re-read exactly the collections whose source moved. Nothing moved = zero big reads (the Store 429 read-quota lesson).
// The stamp stored for a collection is the one captured BEFORE its read began, so a sync landing mid-read can only make the page
// UNDER-claim freshness (one extra read next time), never over-claim it. A failed check or read leaves the old data AND the old
// stamp, so the line keeps saying how old it really is. Closes have no sync doc (weekly job): re-read when 24h old.
// Auto-refresh: ONE interval (held in _siRetryCtl, so leaving the page clears it with every other timer), a no-op while the tab is
// hidden, a catch-up when it becomes visible or the page is re-entered. New data is applied through the section's own repaint, and
// DEFERRED (a "Show new data" button) while an input has focus or a situation drawer / lead-time editor is open — never destroying them.
const _SI_FR_SOURCES=[ // intervalH = hours between scheduled runs (netlify.toml): catalog 0 4 * * *, orders 0 */4 * * *, refresh 20 */4 * * *, snapshot 0 5,17 * * *
  {id:'catalog',  label:'Catalog',              noun:'The catalog',          intervalH:24},
  {id:'orders',   label:'Orders and line items',noun:'Orders and line items',intervalH:4},
  {id:'refresh',  label:'Order status refresh', noun:'The order status refresh',intervalH:4},
  {id:'inventory',label:'Stock snapshot',       noun:'The stock snapshot',   intervalH:12},
];
const _SI_FR_DOCS={catalog:['catalog_sync'],orders:['order_sync'],refresh:['order_refresh','order_refresh_now'],inventory:['inventory_sync']};
const _SI_FR_GATE={products:['catalog'],orders:['orders','refresh'],lines:['orders','refresh'],snap:['inventory']};
const _SI_FR_AUTO_MS=600000,_SI_FR_TICK_MS=60000,_SI_FR_CLOSES_MS=86400000,_SI_FR_STALE_X=2,_SI_FR_META_MS=8000,_SI_FR_READ_MS=90000;
const _siFr={seen:{},readAt:{},checkedAt:0,busy:false,pin:null,pre:null,state:{},stages:[],pct:0,fails:{},check:null,last:null,docs:null,
  pending:false,detOpen:false,prevDay:'',histFail:'',wired:false};
function _siFrAge(ms){
  if(ms==null||!isFinite(ms))return'';
  if(ms<60000)return'under a minute';
  const m=Math.round(ms/60000);if(m<60)return m+(m===1?' minute':' minutes');
  const h=Math.round(ms/3600000);if(h<48)return h+(h===1?' hour':' hours');
  const d=Math.round(ms/86400000);return d+' days';
}
function _siFrFmt(ms){
  if(ms==null)return'';
  const d=new Date(ms+5*3600000),M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],p=n=>(n<10?'0':'')+n;
  return d.getUTCDate()+' '+M[d.getUTCMonth()]+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes())+' PKT';
}
function _siFrClock(ms){const d=new Date(ms+5*3600000),p=n=>(n<10?'0':'')+n;return p(d.getUTCHours())+':'+p(d.getUTCMinutes());}
// Read the small meta docs. Rejects if ANY read fails (a partial answer cannot prove "nothing moved").
async function _siFrReadMeta(){
  const keys=Object.keys(_SI_FR_DOCS),jobs=[];
  keys.forEach(k=>_SI_FR_DOCS[k].forEach(n=>jobs.push([k,n])));
  const r=await Promise.all(jobs.map(j=>getDoc(doc(db,'shopify_sync_meta',j[1]))));
  const docs={},stamps={};
  keys.forEach(k=>{docs[k]=null;stamps[k]=null;});
  jobs.forEach((j,i)=>{
    const d=r[i]&&r[i].exists()?r[i].data():null,ms=d?_siAxSnapMs(d.last_success_at):null,k=j[0];
    if(d&&(docs[k]==null||(ms!=null&&(stamps[k]==null||ms>=stamps[k]))))docs[k]=d;
    if(ms!=null&&(stamps[k]==null||ms>stamps[k]))stamps[k]=ms;
  });
  return{docs,stamps,at:_siNow()};
}
// The stamps a collection read is filed under: the pinned ones during a refresh, else one shared, bounded read made now.
// Failure or a slow answer = null (the age is then shown as unknown, never guessed) and the collection read goes ahead.
function _siFrStampsPre(){
  if(_siFr.pin)return Promise.resolve(_siFr.pin);
  if(_siFr.pre)return _siFr.pre;
  let t=null;
  const p=Promise.race([_siFrReadMeta().then(m=>{_siFr.docs=m.docs;return m.stamps;}),new Promise(r=>{t=setTimeout(()=>r(null),_SI_FR_META_MS);})]).catch(()=>null).then(v=>{clearTimeout(t);_siFr.pre=null;return v;});
  return _siFr.pre=p;
}
function _siFrNote(id,stamps){_siFr.seen[id]=stamps||null;_siFr.readAt[id]=_siNow();}
// Pure: which collections need a re-read, given the stamps just read. A source whose stamp is missing now cannot be judged (kept);
// a collection with NO recorded stamp cannot be proven fresh (re-read).
function _siFrMoved(stamps,seen,readAt,now,free){
  const out=[];
  Object.keys(_SI_FR_GATE).forEach(id=>{
    if(free&&!free(id))return;
    const was=seen[id];let moved=false;
    _SI_FR_GATE[id].forEach(k=>{const n=stamps?stamps[k]:null;if(n==null)return;const o=was?was[k]:null;if(o==null||n>o)moved=true;});
    if(moved)out.push(id);
  });
  if((!free||free('closes'))&&(!readAt.closes||now-readAt.closes>=_SI_FR_CLOSES_MS))out.push('closes');
  return out;
}
// Pure: the model the strip draws; `now` is passed in so any moment can be tested.
function _siFrView(now){
  const F=_siFr,docs=F.docs||{},meta=_siSyncMeta||{};
  const min2=(a,b)=>a==null||b==null?null:Math.min(a,b);
  const ms={
    catalog:F.seen.products?F.seen.products.catalog:null,
    orders:F.seen.orders&&F.seen.lines?min2(F.seen.orders.orders,F.seen.lines.orders):null,
    refresh:F.seen.orders&&F.seen.lines?min2(F.seen.orders.refresh,F.seen.lines.refresh):null,
    inventory:F.seen.snap?F.seen.snap.inventory:null,
  };
  const snapMs=_siSnapshot?_siAxSnapMs(_siSnapshot.snapshot_at):null;
  if(snapMs!=null)ms.inventory=ms.inventory==null?snapMs:Math.min(ms.inventory,snapMs); // the snapshot's own time is the truest stock timestamp
  const sources=_SI_FR_SOURCES.map(s=>{
    const t=ms[s.id],age=t==null?null:Math.max(0,now-t),limit=s.intervalH*_SI_FR_STALE_X*3600000;
    const d=docs[s.id]||(s.id==='catalog'?meta.catalog:s.id==='inventory'?meta.inventory:s.id==='orders'?meta.orderSync:null);
    let state='ok',words='';
    if(t==null){state=s.id==='refresh'?'quiet':'unknown';words=s.id==='refresh'?'':s.noun+': age unknown — the sync stamp could not be read.';}
    else if(age>limit){state='stale';words=s.noun+' '+(s.id==='orders'?'are':'is')+' '+_siFrAge(age)+' old — more than twice the '+s.intervalH+'-hour schedule, so the sync may have stopped.';}
    if(d&&d.last_status==='error'&&state!=='stale'){state='failed';words='The last run of '+s.noun.toLowerCase()+' failed'+(d.last_error?' ('+String(d.last_error)+')':'')+'; the data shown is from the run before.';}
    return{id:s.id,label:s.label,ms:t,ageMs:age,intervalH:s.intervalH,state,words};
  });
  const core=sources.filter(s=>s.id!=='refresh'),known=core.filter(s=>s.ms!=null);
  let oldest=null;known.forEach(s=>{if(!oldest||s.ms<oldest.ms)oldest=s;});
  const unknownAny=core.some(s=>s.ms==null);
  let line;
  if(oldest)line='Data as of '+_siFrFmt(oldest.ms)+' — oldest source: '+oldest.label.toLowerCase()+', '+_siFrAge(now-oldest.ms)+' ago'+(unknownAny?'; another source’s age is unknown':'');
  else line='Data age unknown — the sync stamps could not be read';
  let status='',statusKind='';
  const fl=Object.keys(F.fails);
  if(F.busy){status='Refreshing'+(F.stages.length>1?' '+F.stages.filter(s=>s.id!=='meta').map(s=>_siStage(s.id).label.toLowerCase()).join(', '):' — checking what changed')+'… '+F.pct+'%';statusKind='busy';}
  else if(F.check&&!F.check.ok){status='Could not check for new data ('+F.check.err+'). Still showing data from '+(oldest?_siFrFmt(oldest.ms):'an unknown time')+'.';statusKind='err';}
  else if(fl.length){status='Could not refresh '+fl.map(id=>_siStage(id).label.toLowerCase()).join(', ')+' ('+F.fails[fl[0]].msg+'). Still showing the earlier data.';statusKind='err';}
  else if(F.histFail){status='Stock history was not refreshed ('+F.histFail+'); its figures are from the earlier read.';statusKind='err';}
  else if(F.last)status=F.last.read.length?'Updated '+F.last.read.map(id=>_siStage(id).label.toLowerCase()).join(', ')+' at '+_siFrClock(F.last.at)+'.':'Checked '+_siFrClock(F.last.at)+' — nothing new.';
  if(F.pending&&!F.busy&&statusKind!=='err'){status='New data is loaded but not shown yet, so nothing you are working on moves.';statusKind='pending';}
  const bad=sources.filter(s=>s.words&&s.state!=='quiet');
  return{line,oldest,sources,closesAt:F.readAt.closes||null,status,statusKind,busy:F.busy,pct:F.pct,pending:F.pending,
    stale:sources.some(s=>s.state==='stale'),warnings:bad.map(s=>s.words)};
}
function _siFrHtml(){
  const now=_siNow(),v=_siFrView(now);
  const tagOf={ok:'on schedule',stale:'stale',failed:'last run failed',unknown:'unknown',quiet:''};
  const rows=v.sources.map(s=>'<li class="si-fr-src '+s.state+'"><b>'+_siEsc(s.label)+'</b> — '+(s.ms==null?_siEsc(s.state==='quiet'?'not recorded yet':'age unknown'):_siEsc(_siFrFmt(s.ms)+' ('+_siFrAge(s.ageMs)+' ago)'))+' <span class="si-fr-tag">'+_siEsc(tagOf[s.state])+'</span> <span class="si-fr-sch">runs about every '+s.intervalH+' h</span></li>').join('')
    +'<li class="si-fr-src"><b>Weekly closes</b> — '+(v.closesAt?_siEsc('read '+_siFrFmt(v.closesAt)):'not read yet')+' <span class="si-fr-sch">re-read daily</span></li>';
  const tip=v.sources.filter(s=>s.ms!=null).map(s=>s.label+': '+_siFrAge(s.ageMs)+' old').join('\n');
  const warn=v.warnings.length?'<div class="si-fr-warn" role="status"><b>'+(v.stale?'Stale data.':'Check the sync.')+'</b> '+_siEsc(v.warnings.join(' '))+'</div>':'';
  return'<div class="si-fr-row"><span class="si-fr-line" title="'+_siEsc(tip)+'">'+_siEsc(v.line)+'</span>'
    +'<button type="button" id="si-fr-btn" class="si-fr-btn" aria-disabled="'+(v.busy?'true':'false')+'" onclick="window._siFrRefresh()">'+(v.busy?'Refreshing…':'Refresh')+'</button>'
    +(v.pending?'<button type="button" class="si-fr-btn" onclick="window._siFrShow()">Show new data</button>':'')+'</div>'
    +(v.busy?'<div class="si-fr-bar" aria-hidden="true"><i style="width:'+v.pct+'%"></i></div>':'')
    +(v.status?'<div class="si-fr-st '+v.statusKind+'" id="si-fr-st" role="'+(v.statusKind==='err'?'alert':'status')+'">'+_siEsc(v.status)+'</div>':'')
    +warn
    +(function(){const t=siLinesFreshText(_siLinesFullAt,_siLinesMode,_siLinesIncN,_siLinesIncFrom);return t?'<div class="si-fr-sch" id="si-fr-lines" title="'+_siEsc(t)+'">'+_siEsc(t)+'</div>':'';})()
    +'<details class="si-fr-det" id="si-fr-det"'+(_siFr.detOpen?' open':'')+' ontoggle="window._siFrDet(this.open)"><summary>Each source</summary><ul>'+rows+'</ul></details>';
}
window._siFrDet=function(o){_siFr.detOpen=!!o;};
function _siFrPaint(){
  if(typeof document==='undefined'||!document.getElementById)return;
  const el=document.getElementById('si-fr');if(!el)return;
  const had=document.activeElement&&document.activeElement.id==='si-fr-btn';
  el.innerHTML=_siFrHtml();
  if(had){const b=document.getElementById('si-fr-btn');if(b&&b.focus)try{b.focus();}catch(_){}}
}
// Is anything on the page in the middle of being used? Then new data waits behind a button instead of repainting over it.
function _siFrUiBusy(){
  if(_siNaSel||_siAxOvSit||_siAxLtEdit)return true;
  try{
    const a=typeof document!=='undefined'?document.activeElement:null;
    if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName||'')&&a.id!=='si-fr-btn')return true;
    if(a&&a.isContentEditable)return true;
  }catch(_){}
  return false;
}
function _siFrRepaintData(){
  let y=0,top=0,m=null;
  try{y=window.scrollY||0;m=document.getElementById('main-content');top=m?m.scrollTop:0;}catch(_){}
  _siIgRepaint();
  try{if(m&&top)m.scrollTop=top;if(y&&typeof window.scrollTo==='function')window.scrollTo(0,y);}catch(_){}
}
function _siFrApply(force){
  if(!_siLoaded||!_siLoadAlive())return;
  if(!force&&_siFrUiBusy()){_siFr.pending=true;return;}
  _siFr.pending=false;_siFrRepaintData();
}
window._siFrShow=function(){_siFrApply(true);_siFrPaint();};
function _siFrIsHidden(){try{return typeof document!=='undefined'&&(document.hidden===true||document.visibilityState==='hidden');}catch(_){return false;}}
// ── The refresh ──
async function siRefresh(o){
  const F=_siFr,C=_siRetryCtl;
  if(!_siLoaded||!_siLoadAlive())return{skipped:'not-ready'};
  if(F.busy)return{skipped:'busy'};
  const gen=C.gen;
  F.busy=true;F.fails={};F.check=null;F.histFail='';F.stages=[{id:'meta',w:3}];F.state={meta:'active'};F.pct=0;
  _siFrPaint();
  const finish=()=>{F.busy=false;F.pin=null;};
  let meta;
  try{meta=await _siFrReadMeta();}
  catch(e){finish();F.checkedAt=_siNow();F.check={ok:false,err:_siLoadErr(e).msg,at:_siNow()};_siFrPaint();return{error:'meta'};}
  if(C.gen!==gen){finish();return{cancelled:true};}
  F.checkedAt=_siNow();F.docs=meta.docs;
  if(meta.docs.catalog)_siSyncMeta.catalog=meta.docs.catalog;
  if(meta.docs.inventory)_siSyncMeta.inventory=meta.docs.inventory;
  if(meta.docs.orders)_siSyncMeta.orderSync=meta.docs.orders;
  F.state.meta='done';
  const ids=_siFrMoved(meta.stamps,F.seen,F.readAt,_siNow(),id=>!C.running[id]);
  if(!ids.length){finish();F.last={at:_siNow(),read:[]};F.pct=100;_siFrPaint();return{read:[]};}
  F.pin=meta.stamps;
  ids.forEach(id=>{F.stages.push({id,w:_siStage(id).w});F.state[id]='active';});
  F.pct=siProgressNext(0,siProgress(F.stages,F.state));_siFrPaint();
  const done=[];
  await Promise.all(ids.map(async id=>{
    C.running[id]=true;
    let tm=null;
    try{
      await Promise.race([Promise.resolve().then(()=>_siRunners[id](true)),new Promise((_,rej)=>{tm=setTimeout(()=>rej(Object.assign(new Error('timed out after '+(_SI_FR_READ_MS/1000)+'s'),{code:'timeout'})),_SI_FR_READ_MS);})]);
      _siFrNote(id,meta.stamps);F.state[id]='done';done.push(id);
    }catch(e){F.state[id]='failed';F.fails[id]=_siLoadErr(e);}
    finally{clearTimeout(tm);C.running[id]=false;}
    F.pct=siProgressNext(F.pct,siProgress(F.stages,F.state));if(C.gen===gen)_siFrPaint();
  }));
  if(C.gen!==gen){finish();return{cancelled:true,read:done};}
  if(done.indexOf('snap')>=0){
    const day=_siPktDate(-7);
    if(F.prevDay!==day){try{const s=await getDoc(doc(db,'shopify_inventory_snapshots',day));if(s.exists())_siPrevSnapshot=s.data();F.prevDay=day;}catch(_){}}
    if(_siHistState==='ok'&&!_siHistPromise){ // only the days newer than the cached ones (warm cache); never the shared "loading" state, so nothing blanks
      try{const r=await _siAxReadFolds(false);_siHist=_siAxHistoryFromFolds(r.folds);_siHistLast={read:r.read,warm:r.warm};_siHistCacheWrite(r.folds,r.fullAt);_siAxCache=null;}
      catch(e){F.histFail=_siLoadErr(e).msg;}
    }
    if(C.gen!==gen){finish();return{cancelled:true,read:done};}
  }
  finish();
  F.last={at:_siNow(),read:done.slice()};if(!Object.keys(F.fails).length)F.pct=100;
  if(done.length)_siFrApply(false);
  _siFrPaint();
  return{read:done,failed:Object.keys(F.fails)};
}
window._siFrRefresh=function(){if(_siFr.busy)return;return siRefresh();};
// ── The 10-minute timer: one interval, held in the controller, so leaving the page clears it with every other timer ──
function _siFrTick(){
  const F=_siFr;
  if(!_siLoaded||!_siLoadAlive()){siRetryClearTimers();return;}
  if(_siFrIsHidden())return;               // paused while the tab is hidden; the catch-up on becoming visible does the check
  _siFrPaint();                             // the ages move every minute
  if(!F.busy&&_siNow()-F.checkedAt>=_SI_FR_AUTO_MS)siRefresh();
}
function _siFrStart(catchUp){
  const C=_siRetryCtl,F=_siFr;
  if(C.auto){clearInterval(C.auto);C.auto=null;}   // never two timers
  if(!F.checkedAt)F.checkedAt=_siNow();
  C.auto=setInterval(_siFrTick,_SI_FR_TICK_MS);
  if(!F.wired&&typeof document!=='undefined'&&document.addEventListener){
    F.wired=true;document.addEventListener('visibilitychange',()=>{if(!_siFrIsHidden()&&_siLoaded&&_siLoadAlive()&&_siRetryCtl.auto)_siFrTick();});
  }
  if(catchUp)_siFrTick();
}

// ── Helpers ──────────────────────────────────────────────────────────
function _siPktDate(off){const d=new Date(Date.now()+5*3600000);d.setDate(d.getDate()+(off||0));return d.toISOString().split('T')[0];}
function _siFmt(n){if(n==null)return'—';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return n.toLocaleString();}
function _siPKR(n){if(n==null)return'—';return'PKR '+n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0});}
function _siPct(n){if(n==null||isNaN(n))return'—';return(n*100).toFixed(1)+'%';}
function _siDaysAgo(iso){if(!iso)return null;const d=new Date(iso);const now=new Date();return Math.floor((now-d)/86400000);}


// ═══ Ignore — a SHARED per-article list (inventory_article_meta/{CODE}) ═══
// Anyone who can open Inventory Intel may ignore an article for a chosen time, or for good, and everyone sees the same lists.
// ONE predicate (_siIgnored) decides; every list, count, pill and rollup reads _siAxLive() (the articles that are NOT ignored).
// Search, Compare and the Ignored tab read the full index, so an ignored article can always be found and restored.
// Expiry is derived on read (ignoredUntil is a PKT day, ignored through the END of it); nothing is written when it passes.
const _SI_META_COL='inventory_article_meta';
const _SI_META_FIELDS=['code','type','season','ignoredUntil','ignoreForever','ignoredAt','ignoredBy','updatedAt','updatedBy']; // = the rules' allow-list
const _SI_IG_PERIODS=[{k:'1w',l:'1 week'},{k:'2w',l:'2 weeks'},{k:'1m',l:'1 month'},{k:'3m',l:'3 months'},{k:'6m',l:'6 months'}];
const _SI_IG_DAY=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const _SI_IG_CODE=/^[A-Z0-9][A-Z0-9._-]{1,39}$/;
// today (YYYY-MM-DD, PKT) + a period → the LAST day the article stays ignored. Months clamp to the month end (31 Jan + 1 month = 28/29 Feb).
function _siIgUntil(today,k){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today));if(!m)return null;
  const y=+m[1],mo=+m[2]-1,d=+m[3],pad=n=>String(n).padStart(2,'0');
  const fmt=t=>t.getUTCFullYear()+'-'+pad(t.getUTCMonth()+1)+'-'+pad(t.getUTCDate());
  if(k==='1w'||k==='2w')return fmt(new Date(Date.UTC(y,mo,d+(k==='1w'?7:14))));
  const add={'1m':1,'3m':3,'6m':6}[k];if(!add)return null;
  const tm=mo+add,ty=y+Math.floor(tm/12),tmo=((tm%12)+12)%12,last=new Date(Date.UTC(ty,tmo+1,0)).getUTCDate();
  return ty+'-'+pad(tmo+1)+'-'+pad(Math.min(d,last));
}
function _siIgNextDay(day){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));if(!m)return'';const t=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+1)),p=n=>String(n).padStart(2,'0');return t.getUTCFullYear()+'-'+p(t.getUTCMonth()+1)+'-'+p(t.getUTCDate());}
function _siIgEnd(day){return Date.parse(day+'T23:59:59.999+05:00');}
// THE predicate. Forever, or still inside the last ignored PKT day (client clock).
function _siIgnored(code){
  const m=_siMeta.get(code);if(!m)return false;
  if(m.ignoreForever===true)return true;
  if(typeof m.ignoredUntil==='string'&&_SI_IG_DAY.test(m.ignoredUntil))return _siNow()<=_siIgEnd(m.ignoredUntil);
  return false;
}
function _siIgKey(){return _siIgVer+'|'+_siPktDate(0);} // changes on every ignore/restore and at each PKT midnight (an expiry)
// The articles that are NOT ignored: what every list, count, pill and rollup reads. Search/Compare/the Ignored tab use idx.list.
function _siAxLive(){
  const idx=_siAxIndex(),k=_siIgKey();
  if(idx._lvK!==k){idx._lv=idx.list.filter(a=>!_siIgnored(a.code));idx._lvK=k;idx.classCounts=null;}
  return idx._lv;
}
function _siIgUntilText(code){
  const m=_siMeta.get(code);if(!m)return'';
  if(m.ignoreForever===true)return'never';
  return typeof m.ignoredUntil==='string'?_siIgNextDay(m.ignoredUntil):'';
}
function _siIgChipText(code){
  const m=_siMeta.get(code);
  return m&&m.ignoreForever===true?'Ignored for good':'Ignored until '+_siAxFmtDay(m.ignoredUntil);
}
function _siIgChipHtml(code){return _siIgnored(code)?`<span class="si-ig-chip">${_siEsc(_siIgChipText(code))}</span>`:'';}
function _siIgBtnHtml(code,cls){
  const on=_siIgnored(code);
  return`<button type="button" class="si-ax-btn si-ig-btn${cls?' '+cls:''}" data-code="${_siEsc(code)}" onclick="window.${on?'_siIgRestore':'_siIgOpen'}(this.dataset.code)">${on?'Restore':'Ignore'}</button>`;
}
function _siIgList(){ // active ignores, soonest return first, "never" last
  const out=[];
  _siMeta.forEach((m,code)=>{if(_siIgnored(code))out.push({code,m});});
  out.sort((x,y)=>{
    const fx=x.m.ignoreForever===true,fy=y.m.ignoreForever===true;
    if(fx!==fy)return fx?1:-1;
    const dx=fx?'':x.m.ignoredUntil,dy=fy?'':y.m.ignoredUntil;
    return dx<dy?-1:dx>dy?1:(x.code<y.code?-1:x.code>y.code?1:0);
  });
  return out;
}
// A stored document is read field by field: only well-formed values survive (it is somebody else's data).
function _siMetaClean(id,d){
  d=d&&typeof d==='object'?d:{};
  return{code:id,
    ignoreForever:d.ignoreForever===true,
    ignoredUntil:typeof d.ignoredUntil==='string'&&_SI_IG_DAY.test(d.ignoredUntil)?d.ignoredUntil:null,
    ignoredAt:typeof d.ignoredAt==='number'?d.ignoredAt:null,
    ignoredBy:typeof d.ignoredBy==='string'?d.ignoredBy.slice(0,40):null,
    type:['top','bottom','other'].includes(d.type)?d.type:null,
    season:['winter','summer','all'].includes(d.season)?d.season:null,
    updatedAt:typeof d.updatedAt==='number'?d.updatedAt:null,updatedBy:typeof d.updatedBy==='string'?d.updatedBy.slice(0,40):null};
}
// ONE bounded read per page load. Never rejects, never blocks the loader or its percentage, never hides what it could not read.
function _siMetaLoad(force){
  if(_siMetaPromise&&!force)return _siMetaPromise;
  if(typeof getDocs!=='function'||typeof collection!=='function'){_siMetaState='error';return Promise.resolve();}
  _siMetaState='loading';
  _siMetaPromise=(async()=>{
    try{
      const s=await getDocs(collection(db,_SI_META_COL));
      const m=new Map();s.forEach(d=>{if(_SI_IG_CODE.test(d.id))m.set(d.id,_siMetaClean(d.id,d.data()));});
      _siMeta=m;_siMetaState='ok';
    }catch(_){_siMetaState='error';}
    _siIgVer++;_siIgRepaint();
  })();
  return _siMetaPromise;
}
function _siMetaNote(){ // quiet, and only when the read failed
  return _siMetaState==='error'?`<div class="si-hist-pend err" id="si-meta-note" role="status">Ignore list could not be read — every article is shown. <button type="button" class="si-ax-btn" onclick="window._siMetaRetry()">Retry</button></div>`:'';
}
window._siMetaRetry=function(){_siMetaLoad(true);};
// Repaint whatever is on screen after the list changed (a write, a restore, the read landing). Closes an open situation whose article just left.
function _siIgRepaint(){
  try{
    if(typeof document==='undefined'||!document.getElementById||!_siLoaded||!_siLoadAlive())return;
    if(_siNaSel&&_siIgnored(_siNaSel))_siNaSel='';
    if(_siAxOvSit&&_siIgnored(_siAxOvSit))_siAxOvSit='';
    const bar=document.getElementById('si-tab-bar');if(bar)bar.outerHTML=_siTabBar();
    if(_siSection==='attention'&&typeof window._siNaRepaint==='function')window._siNaRepaint();
    else if(_siSection==='articles'&&_siSub==='typeseason')_siTsRepaint();
    else if(_siSection==='articles')_siAxRepaintAll();
    else _siRefreshContent();
  }catch(_){}
}
function _siIgUser(){return typeof session!=='undefined'&&session&&session.u?String(session.u):'';}
// The ONE writer. Optimistic: memory first, then a merge write of the allowed fields only; a refusal puts memory back and says so.
async function _siIgWrite(code,fields,okMsg,verb,what){
  if(!_SI_IG_CODE.test(code)){if(typeof showToast==='function')showToast('This article code cannot be saved to the ignore list.',true);return false;}
  const u=_siIgUser();
  if(!u){if(typeof showToast==='function')showToast('Sign in again to change the ignore list.',true);return false;}
  const now=_siNow(),prev=_siMeta.get(code),had=_siMeta.has(code);
  const doc0=Object.assign({code,updatedAt:now,updatedBy:u},fields);
  const next=_siMetaClean(code,Object.assign({},prev||{},doc0));
  _siMeta.set(code,next);_siIgVer++;_siIgRepaint();
  let stop=()=>{};
  if(typeof window!=='undefined'&&typeof window._gvSilentSaveStart==='function'){window._gvSilentSaveStart();let done=false;const t=setTimeout(()=>fin(),4000);const fin=()=>{if(done)return;done=true;clearTimeout(t);window._gvSilentSaveStop();};stop=fin;}
  try{
    const p=setDoc(doc(db,_SI_META_COL,code),doc0,{merge:true});
    if(typeof navigator!=='undefined'&&navigator.onLine===false&&typeof showToast==='function')showToast('Saved on this device — will sync when you are back online.');
    else if(okMsg&&typeof showToast==='function')showToast(okMsg);
    await p;stop();
    if(typeof logActivity==='function')logActivity(verb,code+(fields.ignoreForever?' — never remind':fields.ignoredUntil?' — until '+fields.ignoredUntil:'')+(fields.type!==undefined?' — type '+(fields.type||'cleared'):'')+(fields.season!==undefined?' — season '+(fields.season||'cleared'):''));
    return true;
  }catch(e){
    stop();
    if(had)_siMeta.set(code,prev);else _siMeta.delete(code);
    _siIgVer++;_siIgRepaint();
    if(typeof showToast==='function')showToast('Could not save '+(what||'the ignore list')+' — nothing was changed.'+(e&&/permission/i.test(String(e.code||e.message))?' (firestore.rules may not be published yet.)':''),true);
    return false;
  }
}
// What each choice writes (pure): a period → the last ignored PKT day; "never" → forever; Restore clears every ignore field.
function _siIgFields(choice,today,by,now){
  if(choice==='restore')return{ignoredUntil:null,ignoreForever:false,ignoredAt:null,ignoredBy:null};
  if(choice==='never')return{ignoredUntil:null,ignoreForever:true,ignoredAt:now,ignoredBy:by};
  const until=_siIgUntil(today,choice);
  return until?{ignoredUntil:until,ignoreForever:false,ignoredAt:now,ignoredBy:by}:null;
}
window._siIgApply=function(code,choice){
  code=String(code||'').toUpperCase();
  const f=_siIgFields(choice,_siPktDate(0),_siIgUser(),_siNow());
  if(!f)return Promise.resolve(false);
  return _siIgWrite(code,f,choice==='never'?'Ignored — you will not be reminded.':'Ignored until '+_siAxFmtDay(f.ignoredUntil)+'.','Article ignored');
};
window._siIgRestore=function(code){
  code=String(code||'').toUpperCase();
  return _siIgWrite(code,_siIgFields('restore'),'Restored — it is back in the lists.','Article restored');
};
// The one question, in a small dialog. Markup is a string with every dynamic value escaped (an article name is somebody's text).
let _siIgDlg=null;
function _siIgClose(){if(_siIgDlg&&_siIgDlg.parentNode)_siIgDlg.parentNode.removeChild(_siIgDlg);_siIgDlg=null;}
function _siIgDlgHtml(code,name){
  return`<div class="si-ig-box"><div class="si-ig-h" id="si-ig-h">Ignore ${_siEsc(name||code)}</div>
    <div class="si-ig-sub">It leaves the lists and counts for everyone until the time is up.</div>
    <div class="si-ig-q">Remind me in…</div>
    <div class="si-ig-opts" id="si-ig-opts" role="radiogroup" aria-label="Remind me in">${_SI_IG_PERIODS.map(pd=>`<label class="si-ig-opt"><input type="radio" name="si-ig-p" value="${pd.k}"${pd.k==='1m'?' checked':''}><span>${_siEsc(pd.l)}</span></label>`).join('')}</div>
    <label class="si-ig-never"><input type="checkbox" id="si-ig-never" onchange="window._siIgNever(this.checked)"><span>Never remind me</span></label>
    <div class="si-ig-btns"><button type="button" class="si-ax-btn" onclick="window._siIgCancel()">Cancel</button><button type="button" class="si-ax-btn si-ig-ok" data-code="${_siEsc(code)}" onclick="window._siIgGo(this.dataset.code)">Ignore</button></div></div>`;
}
window._siIgCancel=_siIgClose;
window._siIgNever=function(on){
  const g=document.getElementById('si-ig-opts');if(!g)return;
  if(g.classList)g.classList.toggle('off',!!on);
  if(g.querySelectorAll)g.querySelectorAll('input').forEach(i=>{i.disabled=!!on;});
};
window._siIgGo=function(code){
  const nv=document.getElementById('si-ig-never'),sel=document.querySelector&&document.querySelector('input[name="si-ig-p"]:checked');
  const choice=nv&&nv.checked?'never':((sel&&sel.value)||'1m');
  _siIgClose();return window._siIgApply(code,choice);
};
window._siIgOpen=function(code){
  code=String(code||'').toUpperCase();
  if(typeof document==='undefined'||!document.createElement)return false;
  _siIgClose();
  let a=null;try{a=_siAxIndex().map.get(code)||null;}catch(_){}
  const ov=document.createElement('div');ov.className='si-ig-ov';ov.id='si-ig-dlg';
  ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-labelledby','si-ig-h');
  ov.innerHTML=_siIgDlgHtml(code,a?a.name:code);
  ov.addEventListener('click',e=>{if(e.target===ov)_siIgClose();});
  ov.addEventListener('keydown',e=>{if(e.key==='Escape')_siIgClose();else if(e.key==='Enter'&&e.target&&e.target.tagName!=='BUTTON'){if(e.preventDefault)e.preventDefault();window._siIgGo(code);}});
  document.body.appendChild(ov);_siIgDlg=ov;
  const f=ov.querySelector&&ov.querySelector('input:checked');if(f&&f.focus)f.focus();
  return true;
};
// The Ignored tab.
function _siIgnoredSectionHtml(){
  if(!_siFullHist()){_siFullStart(false);return _siFullGateHtml('The Ignored list');}
  const list=_siIgList();
  const note=_siMetaNote();
  if(_siMetaState==='loading'||_siMetaState==='idle')return`<div class="si-ax-empty">Reading the ignore list…</div>`;
  if(!list.length)return note+`<div class="card"><div class="card-title">Ignored</div><div class="si-ax-empty">Nothing is ignored. Use Ignore on an article you do not want in the lists for a while.</div></div>`;
  let idx=null;try{idx=_siAxIndex();}catch(_){}
  const row=e=>{
    const a=idx&&idx.map&&idx.map.get(e.code),back=_siIgUntilText(e.code);
    const nm=a?a.name:e.code,cls=a&&(a.units>0||a.hasStock)?(_siAxClassify(a).label||''):'';
    const by=e.m.ignoredBy?(' · by '+e.m.ignoredBy):'';
    return`<div class="si-ig-row"><div class="nm">${_siAxThumb(e.code,48,nm)}<div class="tx"><strong>${_siEsc(nm)}</strong><div class="si-ax-note" style="margin:0">${_siEsc(e.code)}${cls?' · <span class="si-ig-cls">'+_siEsc(cls)+'</span>':''}</div></div></div>
      <div class="rt"><div class="k">Returns</div><div class="v">${back==='never'?'never':_siEsc(_siAxFmtDay(back))}</div><div class="si-ax-note" style="margin:0">${_siEsc(('ignored '+(e.m.ignoredAt?_siAxFmtDay(_siPktDayOf(e.m.ignoredAt)):'')+by).trim())}</div></div>
      <div class="btns"><button type="button" class="si-ax-btn" data-code="${_siEsc(e.code)}" onclick="window._siIgOpenInExplorer(this.dataset.code)">Open</button><button type="button" class="si-ax-btn si-ig-btn" data-code="${_siEsc(e.code)}" onclick="window._siIgRestore(this.dataset.code)">Restore</button></div></div>`;
  };
  return note+`<div class="card"><div class="card-title">Ignored — ${list.length} article${list.length===1?'':'s'}</div>
    <div class="si-ax-note" style="margin:0 0 6px">Shared: everyone sees the same list. An article comes back by itself on the date shown; nothing needs to be done.</div>
    ${list.map(row).join('')}</div>`;
}
window._siIgOpenInExplorer=function(code){
  code=String(code||'').toUpperCase();
  _siSection='articles';_siSub='';_siSecTouched=true;_siAxModeSel='search';_siAxSel=code;_siAxQuery='';_siAxMsg='';
  const bar=document.getElementById('si-tab-bar');if(bar)bar.outerHTML=_siTabBar();
  _siRefreshContent();
  if(typeof window.scrollTo==='function')try{window.scrollTo(0,0);}catch(_){}
};
function _siPktDayOf(ms){return new Date(ms+5*3600000).toISOString().slice(0,10);}

// ═══ Type & season — a fill queue over the same shared list (inventory_article_meta/{CODE}.type / .season) ═══
// Sub-phase 2 of the product-data work. Staff press a button to give each live article a TYPE and a SEASON; nothing is ever written
// without a press (the suggestions are buttons). The values are the ones firestore.rules already allows (held equal by
// tests/shopify-typeseason.test.js): that is why the vocab is short. ONE place: _SI_TYPES / _SI_SEASONS. The writer is the Ignore writer.
// Sub-phase 3 reads _siMetaOf(code); nothing here feeds the Explorer filter, Portfolio or Needs Attention yet.
const _SI_TYPES=[{k:'top',l:'Top'},{k:'bottom',l:'Bottom'},{k:'other',l:'Other'}];
const _SI_SEASONS=[{k:'winter',l:'Winter'},{k:'summer',l:'Summer'},{k:'all',l:'All-season'}];
const _SI_TS_CUBES=20,_SI_TS_MILESTONES=[25,50,75,100],_SI_TS_PAGE=20;
// Word stems (a trailing s is dropped) that name a garment. "short sleeve" is removed first: a short-sleeve tee is not shorts.
const _SI_TS_TOP=['tee','tshirt','shirt','hoodie','sweatshirt','jacket','top','polo','tank','sweater','vest','coat','shacket','bomber','crewneck','pullover','zipper','kurta'];
const _SI_TS_BOTTOM=['pant','jean','denim','short','jort','trouser','jogger','cargo','skirt','legging','bottom','sweatpant','trackpant','flare','chino'];
let _siTsFilter='all',_siTsLimit=_SI_TS_PAGE,_siTsPrev=-1;
function _siMetaOf(code){ // what sub-phase 3 reads: the saved type and season of one article (null = not set)
  const m=_siMeta.get(String(code||'').toUpperCase());
  return{type:m&&m.type?m.type:null,season:m&&m.season?m.season:null};
}
function _siTsStems(text){
  const t=String(text||'').toLowerCase().replace(/short[\s-]*sleeve[d]?/g,' ').replace(/t[\s-]*shirt/g,' tshirt ');
  const out=new Set();(t.match(/[a-z]+/g)||[]).forEach(w=>out.add(w.length>3?w.replace(/s$/,''):w));return out;
}
function _siTsHit(stems,list){return list.some(w=>stems.has(w));}
// Type from the Shopify product_type first, then the title. Both a top word and a bottom word in the SAME text is a set: no suggestion.
function _siTsSuggestType(category,title){
  const pick=(txt,src)=>{const s=_siTsStems(txt),t=_siTsHit(s,_SI_TS_TOP),b=_siTsHit(s,_SI_TS_BOTTOM);
    if(t&&!b)return{k:'top',why:src};if(b&&!t)return{k:'bottom',why:src};return null;};
  return(category&&pick(category,'from its Shopify type "'+String(category).slice(0,40)+'"'))||(title&&pick(title,'from its name'))||null;
}
function _siTsWinterDay(day){const m=/^\d{4}-(\d{2})-\d{2}/.exec(String(day||''));if(!m)return null;const mo=+m[1];return mo>=10||mo<=2;} // Oct..Feb, the Explorer's winter
// Suggestions are a list of {k,why}: one from the date, one from siblings (the other articles of the same type that already have a season).
function _siTsSuggestSeason(day,typeLabel,siblingSeasons){
  const out=[];
  const w=_siTsWinterDay(day);
  if(w!==null)out.push({k:w?'winter':'summer',why:'by its first date, '+_siAxFmtDay(day)});
  const sib=Array.isArray(siblingSeasons)?siblingSeasons:[];
  if(typeLabel&&sib.length>=3){
    const c={};sib.forEach(s=>{c[s]=(c[s]||0)+1;});
    const top=Object.keys(c).sort((x,y)=>c[y]-c[x]||(x<y?-1:1))[0];
    if(c[top]/sib.length>=0.6&&!out.some(s=>s.k===top))out.push({k:top,why:c[top]+' of '+sib.length+' other '+typeLabel.toLowerCase()+' articles'});
  }
  return out;
}
// Progress: both type and season, of the live (not ignored) articles. A meta list that was not read gives NO number (never 0% read as done or empty).
function _siTsProgress(live,metaMap,state){
  if(state!=='ok')return{ok:false,state};
  let done=0,noType=0,noSeason=0;
  live.forEach(a=>{const m=metaMap.get(a.code),t=m&&m.type,s=m&&m.season;if(t&&s)done++;if(!t)noType++;if(!s)noSeason++;});
  const total=live.length;
  return{ok:true,total,done,noType,noSeason,pct:total?Math.floor(done*100/total):0,filled:total?Math.floor(done*_SI_TS_CUBES/total):0};
}
function _siTsNextMilestone(p){
  if(!p||!p.ok||!p.total)return null;
  const m=_SI_TS_MILESTONES.find(x=>x>p.pct);if(!m)return null;
  return{pct:m,more:Math.max(1,Math.ceil(p.total*m/100)-p.done)};
}
function _siTsQueue(live,metaMap,filter){ // articles still missing something, most-sold first (they matter most)
  return live.filter(a=>{const m=metaMap.get(a.code),t=m&&m.type,s=m&&m.season;
    return filter==='type'?!t:filter==='season'?!s:(!t||!s);})
    .sort((x,y)=>(y.units||0)-(x.units||0)||(x.code<y.code?-1:x.code>y.code?1:0));
}
function _siTsBarHtml(p){
  if(!p.ok){
    return`<div class="si-ts-prog" role="status"><div class="si-ts-bar na" aria-hidden="true">${Array(_SI_TS_CUBES).fill('<span class="si-ts-cube"></span>').join('')}</div><span class="si-ts-pct" id="si-ts-pct">—</span></div>`;
  }
  const prev=_siTsPrev;
  const cubes=[];for(let i=0;i<_SI_TS_CUBES;i++)cubes.push(`<span class="si-ts-cube${i<p.filled?' on':''}${prev>=0&&i>=prev&&i<p.filled?' pop':''}"></span>`);
  _siTsPrev=p.filled;
  return`<div class="si-ts-prog"><div class="si-ts-bar" role="progressbar" aria-label="Articles with a type and a season" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-valuetext="${p.pct} percent: ${p.done} of ${p.total} articles done">${cubes.join('')}</div><span class="si-ts-pct" id="si-ts-pct">${p.pct}%</span></div>`;
}
function _siTsRowHtml(a,live){
  const m=_siMeta.get(a.code)||{},curT=m.type||null,curS=m.season||null;
  const sugT=curT?null:_siTsSuggestType(a.category,a.title);
  const typeLabel=curT?(_SI_TYPES.find(t=>t.k===curT)||{}).l:(sugT?(_SI_TYPES.find(t=>t.k===sugT.k)||{}).l:'');
  const sibs=[];if(!curS&&(curT||sugT)){const tk=curT||sugT.k;live.forEach(o=>{if(o.code===a.code)return;const om=_siMeta.get(o.code);if(om&&om.type===tk&&om.season)sibs.push(om.season);});}
  const sugS=curS?[]:_siTsSuggestSeason(_siAxLiveDay(a)||a.firstDay,typeLabel,sibs);
  const opt=(f,v,cur,sug)=>`<button type="button" class="si-ax-btn si-ts-opt${cur===v.k?' on':''}${sug&&sug.k===v.k&&!cur?' sug':''}" aria-pressed="${cur===v.k?'true':'false'}" data-code="${_siEsc(a.code)}" data-f="${f}" data-k="${v.k}" onclick="window._siTsSet(this.dataset.code,this.dataset.f,this.dataset.k)">${_siEsc(v.l)}</button>`;
  const sugBtn=(f,s,list)=>s?`<button type="button" class="si-ax-btn si-ts-sug" data-code="${_siEsc(a.code)}" data-f="${f}" data-k="${s.k}" onclick="window._siTsSet(this.dataset.code,this.dataset.f,this.dataset.k)">Use ${_siEsc((list.find(x=>x.k===s.k)||{}).l||s.k)} <span class="why">${_siEsc(s.why)}</span></button>`:'';
  const hint=a.category?` · Shopify type: ${_siEsc(a.category)}`:'';
  return`<div class="si-ts-row" data-code="${_siEsc(a.code)}"><div class="nm">${_siAxThumb(a.code,48,a.name)}<div class="tx"><strong>${_siEsc(a.name)}</strong><div class="si-ax-note" style="margin:0">${_siEsc(a.code)}${hint}</div></div></div>
    <div class="grp" role="group" aria-label="Type for ${_siEsc(a.name)}"><span class="lab">Type</span>${_SI_TYPES.map(v=>opt('type',v,curT,sugT)).join('')}${sugBtn('type',sugT,_SI_TYPES)}</div>
    <div class="grp" role="group" aria-label="Season for ${_siEsc(a.name)}"><span class="lab">Season</span>${_SI_SEASONS.map(v=>opt('season',v,curS,sugS[0])).join('')}${sugS.map(s=>sugBtn('season',s,_SI_SEASONS)).join('')}</div></div>`;
}
function _siTsBodyHtml(){
  if(_siMetaState==='loading'||_siMetaState==='idle')return`<div class="si-ax-empty">Reading the saved types and seasons…</div>`;
  const live=_siAxLive(),p=_siTsProgress(live,_siMeta,_siMetaState);
  if(!p.ok)return`<div class="si-hist-pend err" id="si-meta-note" role="status">The saved types and seasons could not be read, so progress is not shown and nothing can be saved safely. <button type="button" class="si-ax-btn" onclick="window._siMetaRetry()">Retry</button></div>${_siTsBarHtml(p)}`;
  const q=_siTsQueue(live,_siMeta,_siTsFilter),shown=q.slice(0,_siTsLimit),ms=_siTsNextMilestone(p);
  const chip=(k,l,n)=>`<button type="button" class="si-ax-btn si-ts-f${_siTsFilter===k?' on':''}" aria-pressed="${_siTsFilter===k?'true':'false'}" onclick="window._siTsFilterSet('${k}')">${l} <b>${n}</b></button>`;
  const summary=p.total===0?'No live articles yet.':`${p.done} of ${p.total} live articles have both a type and a season.`+(ms?` Next milestone ${ms.pct}%: ${ms.more} more.`:' Every live article is done.');
  return`${_siTsBarHtml(p)}<div class="si-ax-note" id="si-ts-sum" style="margin:6px 0 10px">${_siEsc(summary)}</div>
    <div class="si-ax-bar" id="si-ts-filters">${chip('all','Missing either',_siTsQueue(live,_siMeta,'all').length)}${chip('type','No type',p.noType)}${chip('season','No season',p.noSeason)}</div>
    ${q.length?shown.map(a=>_siTsRowHtml(a,live)).join('')+(q.length>shown.length?`<div style="padding:10px 0"><button type="button" class="si-ax-btn" onclick="window._siTsMore()">Show ${Math.min(_SI_TS_PAGE,q.length-shown.length)} more (${q.length-shown.length} left)</button></div>`:''):`<div class="si-ax-empty">${p.total?'Nothing is missing in this view.':'Nothing to fill yet.'}</div>`}`;
}
function _siTsSectionHtml(){
  return`<div class="card" id="si-ts-wrap"><div class="card-title">Type &amp; season</div>
    <div class="si-ax-note" style="margin:0 0 8px">Give each article a type and a season. A suggestion is only a button: nothing is saved until you press one. Everyone sees the same list.</div>
    <div id="si-ts-body">${_siTsBodyHtml()}</div></div>`;
}
function _siTsRepaint(){ // only the body, so the scroll position and the tab stay put; the bar updates with every save
  const el=document.getElementById&&document.getElementById('si-ts-body');
  if(el)el.innerHTML=_siTsBodyHtml();else if(typeof _siRefreshContent==='function')_siRefreshContent();
}
window._siTsFilterSet=function(f){_siTsFilter=(f==='type'||f==='season')?f:'all';_siTsLimit=_SI_TS_PAGE;_siTsRepaint();};
window._siTsMore=function(){_siTsLimit+=_SI_TS_PAGE;_siTsRepaint();};
// Press = save. Pressing the value an article already has clears it. Refused write: the Ignore writer puts it back and says so.
window._siTsSet=function(code,field,k){
  code=String(code||'').toUpperCase();
  const vocab=field==='type'?_SI_TYPES:field==='season'?_SI_SEASONS:null;
  if(!vocab||!vocab.some(v=>v.k===k))return Promise.resolve(false);
  const cur=_siMetaOf(code)[field],val=cur===k?null:k;
  return _siIgWrite(code,{[field]:val},null,field==='type'?'Article type set':'Article season set','the type and season list');
};
// ═══ end Ignore ═══

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
      liveAt:prod.published_at||prod.created_at||'',
      // complete only if the product went live inside the window (or the whole history is loaded); otherwise the window undercounts it
      totalSoldPartial:_siLinesPartial()&&!((prod.published_at||prod.created_at||'').slice(0,10)>=_siLinesCut&&(prod.published_at||prod.created_at||'')!=='')
    });
  });

  // Global season filter: drop off-season SKUs so every downstream view
  // (Needs Attention, Advanced, SKU table, size curve) is season-aware.
  return rows.filter(r=>_siMatchSeason(r.season));
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
  if(_siLoadError)return'<div class="page-head"><div class="page-title">Inventory Intelligence</div></div><div class="si-ld-lede">⚠ Could not load inventory data</div>'+_siLoaderHTML(false);
  if(!_siLoaded)return'<div class="page-head"><div class="page-title">Inventory Intelligence</div></div>'+_siLoaderHTML(false);

  _siLandingApply();
  {const r=_siSecResolve(_siSection);_siSection=r.sec;if(r.sub)_siSub=r.sub;}   // a stale or removed section id lands on Today, never a blank page
  // the stock history feeds the Needs Attention counts (tab pill, Overview tiles): one bounded read, repaints when it lands
  if(_siHistState==='idle'&&typeof getDocs==='function')_siAxEnsureHistory();
  const m=_siComputeMetrics();
  const skuRows=_siComputeSkuTable();

  return`<div class="page-head">
    <div class="page-title">Inventory Intelligence</div>
    <div class="page-sub">Shopify sales + inventory — read-only, updated every 4 hours</div>
  </div>

  <div class="si-fr" id="si-fr">${_siFrHtml()}</div>
  ${_siSeasonBar()}
  ${_siTabBar()}
  <div id="si-content">${_siRenderSection(m,skuRows)}</div>
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

// The old whole-page Retry: the stage flags keep what loaded, so loadShopifyData (re-entered through showPage) re-reads ONLY what is missing.
window._siRetry=function(){
  _siLoaded=false;_siLoadError=null;
  if(typeof window.showPage==='function')window.showPage('shopify-intel');
};

// ONE section list: id, label, render fn. The four top-level sections (a side bar or freshness line plugs in by reading this).
// Weekly Close, Ignored and Advanced are not sections; they are sub-views of Today (_siSub), reached from the small bar under the tabs.
const _SI_SECTIONS=[
  {id:'today',label:'Today',render:(m)=>_siOverview(m)},
  {id:'attention',label:'Needs Attention',badge:true,render:()=>_siNaSectionHtml()},
  {id:'articles',label:'Articles',render:()=>_siArticleExplorerSection()},
  {id:'skutable',label:'SKU Table',render:(m,rows)=>_siSkuTableSection(rows)},
];
// Each sub-view names its parent section. Type & season is a sub-view of Articles (it is about articles: fill their type and season).
const _SI_SUBVIEWS=[
  {id:'weekly',parent:'today',label:'Weekly Close',render:()=>_siWeeklySection()},
  {id:'ignored',parent:'today',label:'Ignored',count:true,render:()=>_siIgnoredSectionHtml()},
  {id:'advanced',parent:'today',label:'Advanced',render:(m,rows)=>_siAdvancedSection(rows)},
  {id:'typeseason',parent:'articles',label:'Type &amp; season',render:()=>_siTsSectionHtml()},
];
// Old ids from before the restructure still resolve (stale deep links, saved state): overview->today, explorer->articles, the three extras -> Today's sub-views.
const _SI_LEGACY_IDS={overview:'today',explorer:'articles'};
function _siSecResolve(id){
  id=_SI_LEGACY_IDS[id]||id;
  if(_SI_SECTIONS.some(x=>x.id===id))return{sec:id,sub:''};
  {const v=_SI_SUBVIEWS.find(x=>x.id===id);if(v)return{sec:v.parent,sub:id};}
  return{sec:'today',sub:''};
}
function _siSecId(id){return _siSecResolve(id).sec;}
// Which section a person lands on the first time they open the page this session. Landing only, NOT a permission gate.
const _SI_LANDING={raees:'attention',afnan:'today',mustafa:'today',daniyal:'articles',sami:'articles'};
const _SI_LANDING_DEFAULT='today';
function _siLandingFor(u){return Object.prototype.hasOwnProperty.call(_SI_LANDING,u)?_SI_LANDING[u]:_SI_LANDING_DEFAULT;}
function _siLandingApply(){
  if(_siLandDone)return;_siLandDone=true;
  if(_siSecTouched)return;   // an explicit deep link or tab press wins
  const u=(typeof session!=='undefined'&&session)?session.u:'';
  const r=_siSecResolve(_siLandingFor(u));_siSection=r.sec;_siSub=r.sub;
}
// THE section list for NAVIGATION: the tab bar and the takeover's left rail both read this, and it is derived from _SI_SECTIONS
// (the one list), so a restructure edits _SI_SECTIONS only. `short` is the rail's collapsed monogram; absent, the label's first letters.
// Sub-views (Weekly Close, Ignored, Advanced under Today; Type & season under Articles) are reached from the sub-bar under the tabs.
function _siNavItems(){return _SI_SECTIONS.map(t=>({id:t.id,label:t.label,badge:!!t.badge,short:t.short}));}
// The id a deep link / address bar carries: the sub-view when one is open, else the section.
function _siSecKey(){return _siSub||_siSection;}
function _siTabBar(){
  const n=_siNaBadge();
  if(typeof _siTkPaintSoon==='function')_siTkPaintSoon();   // every repaint of the tab bar (switch, badge, history landing) repaints the takeover rail too
  const svs=_SI_SUBVIEWS.filter(v=>v.parent===_siSection);
  const sub=svs.length?`<div class="si-sub-bar" id="si-sub-bar" style="display:flex;gap:8px;flex-wrap:wrap;margin:-6px 0 12px">${svs.map(v=>{const c=v.count?_siIgList().length:0;return`<button type="button" class="si-ax-btn" style="${_siSub===v.id?'background:var(--dark);color:var(--on-dark)':''}" aria-pressed="${_siSub===v.id}" onclick="window._siSwitchTab('${_siSub===v.id?_siSection:v.id}')">${v.label}${c?` (${c})`:''}</button>`;}).join('')}</div>`:'';
  return`<div id="si-tab-bar"><div class="gp-tabs" style="margin-bottom:14px">${_siNavItems().map(t=>
    `<button class="gp-tab${_siSection===t.id?' active':''}" onclick="window._siSwitchTab('${t.id}')">${t.label}${t.badge&&n?`<span class="si-na-pill" role="img" aria-label="${n} article${n===1?'':'s'} need action">${n>99?'99+':n}</span>`:''}</button>`
  ).join('')}</div>${sub}</div>`;
}

window._siSwitchTab=function(id){
  _siSecTouched=true;
  const r=_siSecResolve(id);id=r.sec;
  if(id!=='attention')_siNaSel='';
  if(id!=='articles')_siAxOvSit='';   // leaving the tab closes an open situation; the list's own state (filter, expanded bands) is kept
  _siSection=id;_siSub=r.sub;
  const m=_siComputeMetrics();
  const skuRows=_siComputeSkuTable();
  const bar=document.getElementById('si-tab-bar');
  if(bar)bar.outerHTML=_siTabBar();
  const el=document.getElementById('si-content');
  if(el)el.innerHTML=_siRenderSection(m,skuRows);
  if(id==='skutable'&&_siSkuReturnY>0){const y=_siSkuReturnY;_siSkuReturnY=0;if(typeof window.scrollTo==='function')try{window.scrollTo(0,y);}catch(_){}}
};


// ═══════════════════════════════════════════════════════════════════
// Full-view takeover + left rail (Oct 2026)
// ═══════════════════════════════════════════════════════════════════
// While currentPage==='shopify-intel' the page is a position:fixed full-viewport view (js/boards.js' canvas rules: z-index 120 sits above
// .topbar 100 and .cash-action-bar 115 and below #bug-report-fab 500 and the toasts; 100dvh with a 100vh fallback; html/body carry
// .si-fullscreen so nothing behind scrolls). The bar (Exit) and the rail live in <body>, NOT in #main-content, because renderPage replaces
// #main-content's innerHTML on every load and retry: the way out must never be something a render can remove. Leaving by ANY route goes
// through the showPage wrap below, so the class cannot outlive the page. Deep links: #inventory/<section>, replaceState only.
const _SI_TK_HASH=/^#inventory(?:\/([A-Za-z0-9_-]*))?$/;
const _SI_TK_RAIL_KEY='groovy-si-rail';
let _siTkOn=false,_siTkPaintT=null,_siTkMin=false;
function _siTkAllowed(){   // the Inventory Intel audience: owners + mustafa (nav), the CSR lead and the Marketing lead (their role scopes grant the page)
  try{return typeof session!=='undefined'&&!!session&&(session.role==='owner'||session.u==='mustafa'||session.role==='csr_lead'||session.role==='creator_content_ops_lead');}catch(e){return false;}
}
function _siTkRailHtml(){
  const n=_siNaBadge();
  return _siNavItems().map(t=>{
    const on=_siSection===t.id;
    const mono=String(t.short||t.label||'?').slice(0,2);
    return`<button type="button" class="si-tk-item${on?' on':''}" data-sec="${t.id}"${on?' aria-current="page"':''} title="${t.label}" onclick="window._siTkGo('${t.id}')">`
      +`<span class="si-tk-mono" aria-hidden="true">${mono}</span><span class="si-tk-label">${t.label}</span>`
      +(t.badge&&n?`<span class="si-na-pill" role="img" aria-label="${n} article${n===1?'':'s'} need action">${n>99?'99+':n}</span>`:'')
      +(t.count?`<span class="si-ig-n" role="img" aria-label="${t.count} ignored">${t.count}</span>`:'')
      +`</button>`;
  }).join('');
}
function _siTkChromeHtml(){
  return`<div class="si-tk-bar" id="si-tk-bar"><button type="button" class="si-tk-exit" id="si-tk-exit" onclick="window._siTkExit()">&larr; Exit</button>`
    +`<div class="si-tk-title">Inventory Intelligence</div>`
    +`<button type="button" class="si-tk-toggle" id="si-tk-toggle" aria-expanded="${_siTkMin?'false':'true'}" aria-controls="si-tk-rail" onclick="window._siTkToggleRail()">${_siTkMin?'Show menu':'Hide menu'}</button></div>`
    +`<nav class="si-tk-rail" id="si-tk-rail" aria-label="Inventory Intelligence sections">${_siTkRailHtml()}</nav>`;
}
function _siTkMount(){
  if(typeof document==='undefined'||!document.body)return;
  if(document.getElementById('si-tk-bar')&&document.getElementById('si-tk-rail'))return;
  // two direct children of <body>, so each is a fixed element of the root stacking context
  document.body.insertAdjacentHTML('beforeend',_siTkChromeHtml());
}
function _siTkSetHash(sec){
  try{
    const base=location.pathname+(location.search||''),want=sec?'#inventory/'+sec:'';
    if(sec){if(String(location.hash||'')!==want)history.replaceState(null,'',base+want);}
    else if(_SI_TK_HASH.test(String(location.hash||'')))history.replaceState(null,'',base);
  }catch(e){}
}
function _siTkApplyClasses(on){
  try{
    const b=document.body,h=document.documentElement,m=document.getElementById('main-content');
    b.classList.toggle('si-fullscreen',!!on);h.classList.toggle('si-fullscreen',!!on);
    b.classList.toggle('si-rail-min',!!on&&_siTkMin);
    if(m)m.classList.toggle('si-takeover',!!on);
  }catch(e){}
}
function _siTkSync(){   // repaint the rail from the one list, keep the address bar naming the section
  if(!_siTkOn||typeof document==='undefined')return;
  const rail=document.getElementById('si-tk-rail');
  if(rail){const h=_siTkRailHtml();if(rail._h!==h){rail.innerHTML=h;rail._h=h;}}
  _siTkSetHash(_siSecKey());
}
function _siTkPaintSoon(){
  if(!_siTkOn||_siTkPaintT)return;
  _siTkPaintT=setTimeout(()=>{_siTkPaintT=null;try{_siTkSync();}catch(e){}},0);
}
let _siTkKeyWired=false;
function _siTkEnter(){
  if(_siTkOn)return;
  try{
    if(!_siTkKeyWired&&typeof document!=='undefined'&&document.addEventListener){document.addEventListener('keydown',_siTkKey);_siTkKeyWired=true;}   // once, on first open: not at load
    try{_siTkMin=localStorage.getItem(_SI_TK_RAIL_KEY)==='min';}catch(e){_siTkMin=false;}
    _siTkMount();_siTkOn=true;_siTkApplyClasses(true);_siTkSync();
  }catch(e){_siTkOn=true;_siTkLeave();console.warn('[inventory] takeover failed, left:',e);}
}
function _siTkLeave(){
  const was=_siTkOn;_siTkOn=false;
  if(_siTkPaintT){clearTimeout(_siTkPaintT);_siTkPaintT=null;}
  _siTkApplyClasses(false);
  if(was)_siTkSetHash('');
}
function _siTkOnPage(){   // called after every showPage: the page decides, never a flag set elsewhere
  const want=typeof currentPage!=='undefined'&&currentPage==='shopify-intel';
  if(want&&!_siTkOn)_siTkEnter();else if(!want&&_siTkOn)_siTkLeave();else if(want)_siTkSync();
}
window._siTkGo=function(id){window._siSwitchTab(id);_siTkSync();};
window._siTkToggleRail=function(){
  _siTkMin=!_siTkMin;
  try{localStorage.setItem(_SI_TK_RAIL_KEY,_siTkMin?'min':'full');}catch(e){}
  _siTkApplyClasses(_siTkOn);
  const t=document.getElementById('si-tk-toggle');
  if(t){t.textContent=_siTkMin?'Show menu':'Hide menu';t.setAttribute('aria-expanded',_siTkMin?'false':'true');}
};
window._siTkExit=function(){   // never strands: the takeover is taken down FIRST, then the navigation is attempted
  _siTkLeave();
  try{if(typeof window.showPage==='function')window.showPage('dashboard');}catch(e){console.warn('[inventory] exit navigation failed:',e);}
};
function _siTkParseHash(){const m=_SI_TK_HASH.exec(String(typeof location!=='undefined'?location.hash||'':''));if(!m)return null;const r=_siSecResolve(m[1]||'today');return{section:r.sec,sub:r.sub};}
function _siTkConsumeHash(){
  const link=_siTkParseHash();
  if(!link||typeof session==='undefined'||!session||!_siTkAllowed())return false;   // fail closed: no session or not on the audience, nothing opens
  if(currentPage==='shopify-intel'&&_siLoaded&&typeof window._siSwitchTab==='function'){
    if(_siSection!==link.section||_siSub!==link.sub)window._siSwitchTab(link.sub||link.section);
    _siTkOnPage();return true;
  }
  _siSection=link.section;_siSub=link.sub;_siSecTouched=true;   // a deep link wins over the role landing
  if(typeof window.showPage==='function')window.showPage('shopify-intel');
  return true;
}
function _siTkKey(e){
  if(!_siTkOn||!e)return;
  const k=e.key,rail=document.getElementById('si-tk-rail');
  if(k==='Escape'){
    const t=e.target,tag=t&&t.tagName?String(t.tagName).toUpperCase():'';
    if(e.defaultPrevented||tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.isContentEditable))return;
    if(typeof _siNaSel!=='undefined'&&_siNaSel)return;       // an open situation view closes itself on Escape first
    if(typeof _siAxOvSit!=='undefined'&&_siAxOvSit)return;
    window._siTkExit();return;
  }
  if(rail&&e.target&&e.target.closest&&e.target.closest('#si-tk-rail')&&(k==='ArrowDown'||k==='ArrowUp'||k==='ArrowLeft'||k==='ArrowRight'||k==='Home'||k==='End')){
    const items=Array.prototype.slice.call(rail.querySelectorAll('.si-tk-item'));
    const i=items.indexOf(e.target.closest('.si-tk-item'));if(i<0)return;
    const next=k==='Home'?0:k==='End'?items.length-1:(k==='ArrowDown'||k==='ArrowRight')?(i+1)%items.length:(i-1+items.length)%items.length;
    items[next].focus();if(e.preventDefault)e.preventDefault();
  }
}
(function(){   // wired once at load, like boards.js: every route out of the page passes through showPage
  if(typeof window==='undefined')return;
  if(typeof window.showPage==='function'&&!window.showPage.__siTk){
    const o=window.showPage;
    const w=function(){const r=o.apply(this,arguments);try{_siTkOnPage();}catch(e){}
      try{Promise.resolve(r).then(()=>{try{_siTkOnPage();}catch(e){}},()=>{try{_siTkOnPage();}catch(e){}});}catch(e){}
      return r;};
    w.__siTk=true;window.showPage=w;
  }
  if(window.addEventListener)window.addEventListener('hashchange',()=>{try{_siTkConsumeHash();}catch(e){}});
})();
// startApp is wrapped (boards.js' pattern, not an edit to js/auth.js): the original runs, then a cold #inventory link is consumed.
const _siTkOrigStartApp=window.startApp;
if(typeof _siTkOrigStartApp==='function'){
  window.startApp=async function(){
    const out=await _siTkOrigStartApp.apply(this,arguments);
    try{_siTkConsumeHash();}catch(e){console.warn('[inventory] deep link failed:',e);}
    return out;
  };
}

function _siRenderSection(m,skuRows){
  const r=_siSecResolve(_siSection);
  if(_siFullKey()&&!_siFullHist()){_siFullStart(false);return _siFullGateHtml(_siFullLabel());}
  const sv=_siSub?_SI_SUBVIEWS.find(x=>x.id===_siSub&&x.parent===r.sec):null;
  const d=sv||_SI_SECTIONS.find(x=>x.id===r.sec);
  return d.render(m,skuRows);
}

// ── Overview ────────────────────────────────────────────────────────
function _siOverview(m){
  return _siFullStripHtml()+`<div class="stats-row">
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

  ${_siOverviewAttnTiles()}

  <div class="card">
    <div class="card-title">Daily Movement (14 days)</div>
    ${_siDailyMovementTable()}
  </div>

  <div class="card">
    <div class="card-title">Sync Status</div>
    <div style="font-size:13px;color:var(--muted);line-height:2">
      Products: <strong>${_siProducts.length}</strong> variants
      · Orders: <strong>${_siOrders.length}</strong>
      · Line items: <strong>${_siLineItems.length}</strong>${_siLinesPartial()?' (last '+_SI_WIN_DAYS+' days)':''}
      · Snapshots: ${_siSnapshot?'latest '+(_siSnapshot.date||'—'):'none yet'}
    </div>
  </div>`;
}

// The two Overview tiles read the SAME article-level counts as the Needs Attention tab (one computation, uncapped).
// The quiet "Stock history: loading…" line (and, on a failed read, its Retry). Empty once the history has landed.
function _siHistStrip(){return _siMetaNote()+_siHistStrip0();}
function _siHistStrip0(){
  if(_siHistState==='loading'||_siHistState==='idle')return'<div class="si-hist-pend" id="si-hist-pend" role="status">Stock history: loading…<span> the counts below show … until it lands</span></div>';
  if(_siHistState==='error')return`<div class="si-hist-pend err" id="si-hist-pend" role="alert">Stock history could not be read (${_siEsc(_siHistError)}); the counts below are rougher without it. <button type="button" class="si-ax-btn" onclick="window._siHistRetry()">Retry</button></div>`;
  return'';
}
window._siHistRetry=function(){_siAxEnsureHistory(true);if(typeof _siNaOnHistory==='function')_siNaOnHistory();};
function _siOverviewAttnTiles(){
  if(!_siFullHist())return _siHistStrip()+`<div class="si-na-tiles"><div class="card si-na-tile"><div class="card-title">Needs attention</div><div class="num">—</div><div class="sub">${_siFullNeedsCell()}</div></div><div class="card si-na-tile"><div class="card-title">Overstocked / dead stock</div><div class="num">—</div><div class="sub">${_siFullNeedsCell()}</div></div></div>`;
  const n=_siNaBadge();
  if(n==null)return _siHistStrip()+`<div class="si-na-tiles"><div class="card si-na-tile"><div class="card-title">Needs attention</div><div class="num">…</div><div class="sub">reading the stock history</div></div><div class="card si-na-tile"><div class="card-title">Overstocked / dead stock</div><div class="num">…</div><div class="sub">reading the stock history</div></div></div>`;
  const c=_siNaState().counts;
  const strip=_siHistStrip();
  const cashSub=c.byGroup.cash?(c.cashValue?_siPKR(Math.round(c.cashValue))+' at selling price'+(c.cashNoValue?' (+'+c.cashNoValue+' with no price)':''):'no price to value it at'):'nothing stuck';
  return strip+`<div class="si-na-tiles">
    <button type="button" class="card si-na-tile${c.action?' hot':''}" onclick="window._siNaGo('all')"><div class="card-title">Needs attention</div><div class="num">${c.action}</div><div class="sub">${c.critical} critical · ${c.act} this week · ${c.watch} to watch (articles)</div></button>
    <button type="button" class="card si-na-tile${c.byGroup.cash?' warm':''}" onclick="window._siNaGo('cash')"><div class="card-title">Overstocked / dead stock</div><div class="num">${c.byGroup.cash}</div><div class="sub">${_siEsc(cashSub)}</div></button>
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
      <td${_siLinesPartial()?` title="last ${_SI_WIN_DAYS} days only"`:''}>${r.refunds||'—'}</td>
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
    g.variants.sort((a,b)=>_siSortCmpSize(a.size,b.size));
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
function _siSoldSinceLiveCell(units,liveAt,partial){
  if(partial)return`${_siFullNeedsCell()}<div style="font-size:11px;color:var(--muted);white-space:nowrap">${(()=>{const d=liveAt?_siDaysAgo(liveAt):null;return d!==null&&!isNaN(d)&&d>=0?'live '+d+'d':'live —';})()}</div>`;
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
    const oh=tot('onHand'),s7=tot('s7');
    const m={title:g.title,color:g.color,productType:g.productType,
      onHand:oh,s7,s30:tot('s30'),totalSold:tot('totalSold'),daysLeft:minDays<9999?minDays:null,
      sellThrough:oh+s7>0?s7/(oh+s7):null,reorderPoint:tot('reorderPoint'),suggestedQty:tot('suggestedQty')};
    return m[key]!==undefined?m[key]:tot('onHand');
  };
  const page=_siSortRows(Object.entries(groups),[{key,type:(key==='title'||key==='color'||key==='productType')?'text':'num',get:e=>getGroupVal(e[1])}],key,dir).slice(0,_siSkuLimit);
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
    const gcode=_siSkuArticleCode(g.variants);
    const parent=`<tr class="si-sku-open" style="cursor:pointer" data-gkey="${gkeyEsc}" data-code="${_siEsc(gcode)}" title="Open ${_siEsc(g.title)} in the Article Explorer" onclick="window._siSkuOpen(this.dataset.code)">
      <td style="padding:4px 8px" onclick="event.stopPropagation()"><input type="checkbox" ${groupAllSel?'checked':''} data-gkey="${gkeyEsc}" onchange="window._siToggleGroupSel(this.dataset.gkey,this.checked)" onclick="event.stopPropagation()"></td>
      <td style="font-weight:600;font-size:13px;padding:10px 8px;white-space:nowrap"><button type="button" class="si-sku-chev" aria-expanded="${expanded}" aria-label="${expanded?'Hide':'Show'} sizes of ${_siEsc(g.title)}" data-gkey="${gkeyEsc}" onclick="event.stopPropagation();window._siToggleGroup(this.dataset.gkey)">${expanded?'▼':'▶'}</button>${seasonIcon}${_siEsc(g.title)}${typeChip}</td>
      <td style="font-size:12px;color:var(--muted)">${_siEsc(g.color)}</td>
      <td style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_siEsc(g.productType||'')}">${_siEsc(g.productType)||'—'}</td>
      <td style="white-space:nowrap">${_siSizeChips(g.variants)}</td>
      <td style="font-weight:700;color:${totColor}">${tot}</td>
      <td style="font-weight:600">${totS7}</td>
      <td>${totS30}</td>
      <td>${_siSoldSinceLiveCell(g.variants.reduce((s,r)=>s+(r.totalSold||0),0),_siGroupLiveAt(g.variants),g.variants.some(r=>r.totalSoldPartial))}</td>
      <td>${minDaysStr}</td>
      <td style="color:var(--muted)">—</td><td style="color:var(--muted)">—</td><td style="color:var(--muted)">—</td>
    </tr>`;
    const children=!expanded?'':g.variants.map(r=>{
      const soldOut=r.onHand<=0;
      const daysClass=r.daysLeft<=7&&r.daysLeft>0?'color:var(--accent-urgent);font-weight:700':r.daysLeft<=14&&r.daysLeft>0?'color:var(--accent-warning);font-weight:600':'';
      const daysStr=r.daysLeft===999?'∞':r.daysLeft===0?'—':`${r.daysLeft}d`;
      return`<tr class="si-sku-open" style="background:var(--surface-2);cursor:pointer" data-code="${_siEsc(_siAxCode(r.sku))}" onclick="window._siSkuOpen(this.dataset.code)">
        <td style="padding:4px 8px" onclick="event.stopPropagation()"><input type="checkbox" ${_siSkuSelected.has(r.sku)?'checked':''} data-sku="${_siEsc(r.sku)}" onchange="window._siToggleSku(this.dataset.sku,this.checked)"></td>
        <td style="font-size:11px;color:var(--muted);padding:7px 8px 7px 22px">${_siEsc(r.sku)}</td>
        <td></td><td></td>
        <td style="font-weight:700;font-size:13px">${_siEsc(r.size||'?')}</td>
        <td style="font-weight:${soldOut?'700':'600'};color:${soldOut?'var(--accent-urgent)':'inherit'}">${r.onHand}</td>
        <td>${r.s7}</td><td>${r.s30}</td>
        <td>${_siSoldSinceLiveCell(r.totalSold||0,r.liveAt,r.totalSoldPartial)}</td>
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
  <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Click a product to open it in the Article Explorer; the ▶ arrow shows its sizes. ☀ = Summer · ❄ = Winter · <span style="background:var(--soft);color:var(--cat-notes);border-radius:3px;padding:1px 4px;font-size:11px;font-weight:700">TOP</span> / <span style="background:var(--soft);color:var(--cat-notes);border-radius:3px;padding:1px 4px;font-size:11px;font-weight:700">BOTTOM</span> badges from your labels. Green = all sizes in stock · Red = any sold out.</div>
  ${_siFullStripHtml()}
  <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${_siLinesPartial()?`Sold since live is shown only for products that went live inside the loaded ${_SI_WIN_DAYS} days; the others say “needs full history” until it is loaded.`:`Sold since live counts non-refunded orders synced from ${_siEsc(_siEarliestOrderDate()||'—')} onward, so it understates products that launched earlier.`} "live Nd" comes from the catalog's published/created date ("—" until the catalog sync has stored it).</div>
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
// ── SKU table → Article Explorer ────────────────────────────────────
// The article code of a table row: the ONE SKU-prefix rule (_siAxCode, the same one the Explorer indexes by),
// taken from the first variant that has one.
function _siSkuArticleCode(variants){
  for(const v of (variants||[])){const c=_siAxCode(v&&v.sku);if(c)return c;}
  return'';
}
let _siSkuReturnY=0;
// Opens the article page in the Explorer with a short fade-and-rise of the content. The SKU table's own state
// (search, category, type, sort, expanded groups, page size) lives in module variables, so coming back restores it.
window._siSkuOpen=function(code){
  code=String(code||'').toUpperCase();
  if(!code||(!_siLinesPartial()&&!_siAxIndex().map.has(code))){ // from the window alone, "not in the index" cannot be told from "not sold in the last 90 days"
    if(typeof showToast==='function')showToast(code?code+' has no sales or stock rows, so the Article Explorer has nothing to show for it.':'This row has no article code.',true);
    return false;
  }
  _siSkuReturnY=(typeof window.scrollY==='number'?window.scrollY:0)||0;
  _siAxModeSel='search';_siAxSel=code;_siAxQuery='';_siAxMsg='';
  window._siSwitchTab('articles');
  _siAxEnter();
  if(typeof window.scrollTo==='function')try{window.scrollTo(0,0);}catch(_){}
  return true;
};
// The 250ms entrance: a class on the content host that CSS animates; under reduced motion CSS makes it a no-op.
function _siAxEnter(){
  const el=document.getElementById('si-content');if(!el)return false;
  el.classList.add('si-ax-enter');
  const done=()=>{try{el.classList.remove('si-ax-enter');}catch(_){}};
  el.addEventListener&&el.addEventListener('animationend',done,{once:true});
  setTimeout(done,420);
  return true;
}
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
  const el=document.getElementById('si-content');
  if(el)el.innerHTML=_siRenderSection(m,skuRows);
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
      ${wc.by_category?`<div style="margin-top:8px"><div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px">By Category</div>${_siBarChart(Object.entries(wc.by_category).sort(_siSortEntries),8)}</div>`:''}
    </div>`;
  }).join('');
}

// ── Advanced (9 features) ───────────────────────────────────────────
function _siAdvancedSection(skuRows){
  const wos=_siWeeksOfSupply(skuRows);
  const md=_siMarkdownCandidates(skuRows);
  const stockouts=skuRows.filter(r=>r.onHand<=0&&r.s30>0).sort((a,b)=>b.s30-a.s30).slice(0,15);
  const dropPerf=_siDropPerformance(skuRows);
  const part=_siLinesPartial();
  const needCard=t=>`<div class="card si-full-need-card"><div class="card-title">${t}</div><div style="font-size:13px;color:var(--muted)">${_siFullNeedsCell()} — it reads each product's first sale, last sale or lifetime total, which the loaded ${_SI_WIN_DAYS} days cannot give.</div></div>`;

  return`
  ${_siFullStripHtml()}
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

  ${part?needCard('Variant Aging (first / last sold)'):`<div class="card">
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
  </div>`}

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

  ${part?needCard('Returns Signal per SKU'):`<div class="card">
    <div class="card-title">Returns Signal per SKU</div>
    ${_siReturnsTable(skuRows)}
  </div>`}

  ${part?needCard('Markdown Candidates (cash-freed estimate)'):''}${!part&&md.length?`<div class="card">
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
let _siAxMonShift=0;const _SI_AX_MONTHS_MAX=12;
let _siAxModeSel='overview',_siAxOvTile='reorder',_siAxOvCat='',_siAxOvAll=false,_siAxQuery='',_siAxSel='',_siAxCmp=[],_siAxMetric='units_week',_siAxBasis='calendar',_siAxBucket='week',_siAxMsg='';
// Compare-tab extras: calendar window ('all' | 'winter' | 'months'), the chosen winter (start year, null = latest), the previous-year overlay,
// and whether Compare was opened yet in this visit (the attention pulse stops once it has).
let _siAxWin='all',_siAxWinYear=null,_siAxPrev=false,_siAxCmpSeen=false;
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
// ── Calendar helpers: months, years, winters (pure) ─────────────────
// Winter = October to the end of February. It straddles New Year, so a winter is named by the year its October falls in.
const _SI_AX_WINTER_MONTHS=[10,11,12,1,2];
function _siAxIsWinterMonth(m){return _SI_AX_WINTER_MONTHS.indexOf(+m)>=0;}
function _siAxLeap(y){return(y%4===0&&y%100!==0)||y%400===0;}
function _siAxMonthLen(y,m){return[31,_siAxLeap(y)?29:28,31,30,31,30,31,31,30,31,30,31][m-1];}
// day string + n months, the day of month kept or clipped to the month's length (Mar 31 + 1 month = Apr 30).
function _siAxAddMonths(day,n){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day||'');if(!m)return'';
  const t=(+m[1])*12+(+m[2]-1)+n,y=Math.floor(t/12),mo=t%12+1,d=Math.min(+m[3],_siAxMonthLen(y,mo));
  return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}
function _siAxAddYears(day,n){return _siAxAddMonths(day,12*n);} // Feb 29 + 1 year = Feb 28
// The winter that starts in October of startYear: Oct 1 .. last day of February (28 or 29).
function _siAxWinterWindow(startYear){
  const y=+startYear,e=y+1;
  return{startYear:y,from:y+'-10-01',to:e+'-02-'+String(_siAxMonthLen(e,2)).padStart(2,'0'),label:'Winter '+y+'–'+String(e).slice(2)};
}
// The winter a day belongs to; a day from March to September has no winter of its own, so the LATEST one that has ended.
function _siAxWinterOf(day){
  const m=/^(\d{4})-(\d{2})/.exec(day||'');if(!m)return null;
  return(+m[2]>=10)?+m[1]:+m[1]-1;
}
function _siAxSizeOf(sku,li){
  const p=_siCleanProd(sku);let s=(p.size||'').trim();const c=(p.color||'').trim();
  if(_SI_KNOWN_SIZES.has(c.toUpperCase()))s=c; // options swapped on some products
  if(!s&&li&&li.size)s=String(li.size).trim();
  return s?s.toUpperCase():'Unknown';
}
function _siAxSizeSort(a,b){
  return _siSortCmpSize(a,b);
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
    lineItems:{total:lineItems.length,used:0,refunded:0,voided:0,cancelledOrder:0,noSku:0,badDate:0,duplicateId:0,nonMerch:0,voidedStillInExisting7d30d:0},
    nonMerch:{articles:0,examples:[]},
    products:{total:products.length,noSku:0,duplicateSkuRows:0,used:0},
    snapshot:{entries:0,noSku:0,negativeClamped:0,duplicateSkus:0,duplicateEntries:0,used:0},
    skuNormalised:0,
    categories:{groups:0,spellingsMerged:0,blankProducts:0},
    // Later returns: per-line refunded_quantity / status_synced_at exist only once the returns sync has run.
    // A line without them is UNSYNCED (never assumed clean). synced = 95%+ of the last 60 days' lines carry the stamp.
    returns:{stamped:0,recentTotal:0,recentStamped:0,units:0,lines:0,synced:false}
  };
  const retCut=_siPktDate(-60);
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
  const seen=new Set(),lis=[],out=[];
  lineItems.forEach(li=>{
    const ref=_siCleanIsRefunded(li),voi=!ref&&_siCleanIsVoided(li);
    if(ref||voi){
      // kept aside (never counted as sold) so the Explorer can report voided / refunded units per article
      const xn=_siCleanSku(li.sku),xd=String(li.order_created_at||'').slice(0,10),xq=Number(li.quantity);
      if(xn&&/^\d{4}-\d{2}-\d{2}$/.test(xd)&&isFinite(xq))out.push({code:_siCleanCode(xn),day:xd,qty:xq,kind:ref?'refunded':'voided'});
      if(ref){q.lineItems.refunded++;return;}
      q.lineItems.voided++;q.lineItems.voidedStillInExisting7d30d++;return;
    }
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
    let qty=Number(li.quantity);const pr=Number(li.price);
    const stamped=!!li.status_synced_at;
    if(stamped)q.returns.stamped++;
    if(day>=retCut){q.returns.recentTotal++;if(stamped)q.returns.recentStamped++;}
    const rq=Number(li.refunded_quantity);
    if(isFinite(qty)&&isFinite(rq)&&rq>0){
      // units already returned after the sale: taken off net units, counted as refunded
      const cut=Math.min(rq,qty);qty-=cut;q.returns.units+=cut;
      out.push({code:_siCleanCode(n),day,qty:cut,kind:'refunded'});
      if(qty<=0){q.returns.lines++;q.lineItems.refunded++;return;}
    }
    lis.push({li,nsku:n,code:_siCleanCode(n),day,qty:isFinite(qty)?qty:0,price:isFinite(pr)?pr:0,cat:catOf(li.product_type)});
    q.lineItems.used++;
  });
  // non-merchandise: a code whose every counted sale (and catalog price) is under Rs 1 is not a garment
  // (seen in the data: TIPQUIK-TG "Tip/Gratuity", one line of 11,000 units at Rs 0.01). Decided by the data, not by name.
  const maxPrice=new Map(),catPrices=new Map();
  lis.forEach(r=>{if(r.li.price==null||r.li.price===''||!isFinite(Number(r.li.price)))return; // unknown price is not evidence
    const v=maxPrice.get(r.code);if(v==null||r.price>v)maxPrice.set(r.code,r.price);});
  prods.forEach(p=>{const n=Number(p.price);if(!catPrices.has(p._code))catPrices.set(p._code,[]);catPrices.get(p._code).push(isFinite(n)&&p.price!=null&&p.price!==''?n:NaN);});
  const nonMerch=new Set();
  maxPrice.forEach((v,c)=>{if(v<1)nonMerch.add(c);});
  catPrices.forEach((a,c)=>{if(!maxPrice.has(c)&&a.length&&a.every(v=>v<1))nonMerch.add(c);});
  let lisKept=lis;
  if(nonMerch.size){
    const ex=new Map();
    lisKept=lis.filter(r=>{if(!nonMerch.has(r.code))return true;q.lineItems.nonMerch++;q.lineItems.used--;if(r.li.product_title)ex.set(r.code,r.li.product_title);return false;});
    prods.forEach(p=>{if(nonMerch.has(p._code)&&!ex.has(p._code)&&p.product_title)ex.set(p._code,p.product_title);});
    q.nonMerch.articles=nonMerch.size;q.nonMerch.examples=[...ex.values()].slice(0,3);
  }
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
  q.returns.synced=q.returns.recentTotal>0&&q.returns.recentStamped/q.returns.recentTotal>=_SI_AX_CFG.returnsSyncedShare;
  const stockKept=[...stockBy.values()].filter(x=>!nonMerch.has(x.code));
  return{products:prods.filter(p=>!nonMerch.has(p._code)),prodBySku,lineItems:lisKept,stock:stockKept,excluded:out.filter(x=>!nonMerch.has(x.code)),quality:q};
}
function _siCleanProd(sku){const m=_siCleanLast&&_siCleanLast.prodBySku;return(m&&m.get(_siCleanSku(sku)))||_siGetProd(sku);}
function _siCleanQualityHtml(q){
  if(!q)return'';
  const L=q.lineItems,P=q.products,S=q.snapshot;
  const skipped=L.refunded+L.voided+L.cancelledOrder+L.noSku+L.badDate+L.duplicateId+L.nonMerch;
  const row=(n,t)=>n?`<li><strong>${n}</strong> ${t}</li>`:'';
  const items=[
    (q.returns&&!q.returns.synced)?'<li class="si-ax-quiet">Returns not yet synced: recent units and revenue are before later returns and cancellations, so treat them as an upper limit.</li>':'',
    row(L.refunded,'refunded line items left out'),
    row(L.voided,'voided line items left out'),
    row(L.cancelledOrder,'line items of cancelled orders left out'),
    row(L.noSku,'line items with no SKU skipped'),
    row(L.nonMerch,'non-merchandise line items left out (every sale priced under Rs 1; '+q.nonMerch.articles+' code'+(q.nonMerch.articles===1?'':'s')+(q.nonMerch.examples.length?', e.g. '+q.nonMerch.examples.map(_siEsc).join(', '):'')+')'),
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
    if(!a.img&&_siAxImgOk(p.image_url))a.img=p.image_url;
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
  cl.excluded.forEach(x=>{
    const a=arts.get(x.code);if(!a)return; // only articles that have a catalog row or counted sales
    const m=a.xdaily||(a.xdaily=new Map());let d=m.get(x.day);if(!d){d={v:0,r:0};m.set(x.day,d);}
    if(x.kind==='voided')d.v+=x.qty;else d.r+=x.qty;
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
  const catUnits28=new Map();
  list.forEach(a=>{if(a.category)catUnits28.set(a.category,(catUnits28.get(a.category)||0)+_siAxUnitsSince(a,27).u);});
  list.forEach(a=>{
    a.liveDay=_siAxDayOf(a.liveAt);
    a.name=a.title||a.code;
    a.text=[a.code,a.title,a.color,a.category,[...a.skus].join(' ')].join(' ').toLowerCase();
  });
  list.sort(_siSortArticles);
  // A comparison can hold codes the reloaded data no longer has; they must not count toward the cap.
  _siAxCmp=_siAxCmp.filter(c=>arts.has(c));
  _siAxCache={li:_siLineItems,n:_siLineItems.length,pr:_siProducts,sn:_siSnapshot,pv:_siPrevSnapshot,hv:_siHist,list,map:arts,catUnits,catUnits28,cov:_siEarliestOrderDate(),quality:cl.quality};
  return _siAxCache;
}
// The catalog live date, unless a counted sale predates it (published_at can be
// reset after launch): such sales must stay on the calendar chart, not be nulled.
function _siAxLiveDay(a){return a.liveDay&&a.firstDay&&a.firstDay<a.liveDay?a.firstDay:a.liveDay;}
function _siAxLabel(a){return a.name+(a.color?' — '+a.color:'');}

// ── Article pictures ────────────────────────────────────────────────────────
// The catalog sync stores the product's image_url on every variant, and the page already loads shopify_products, so
// this costs no read. Only an https URL on Shopify's CDN is accepted (it goes into an <img src>); anything else is
// ignored and the neutral code tile shows. The URL is used exactly as stored: the width parameter of Shopify's CDN could
// not be tried from the build sandbox, so no resized URL is constructed.
const _SI_AX_IMG_RE=/^https:\/\/cdn\.shopify\.com\/[^\s"'<>\\]+$/;
function _siAxImgOk(u){return typeof u==='string'&&u.length<2000&&_SI_AX_IMG_RE.test(u);}
// ONE rule: the first variant (in catalog order) with a usable URL.
function _siAxImage(code){const a=_siAxIndex().map.get(code);return a&&a.img?a.img:'';}
// A fixed square, so a picture can never move the row; the code tile is what is there when there is no picture or it fails.
function _siAxThumb(code,px,title){
  const a=_siAxIndex().map.get(code),u=_siAxImage(code),t=title||(a&&a.name)||code;
  const inner=u?`<img src="${_siEsc(u)}" alt="${_siEsc(t)}" width="${px}" height="${px}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="window._siAxImgFail(this)">`:`<b class="si-th-c">${_siEsc(code)}</b>`;
  return`<span class="si-th" style="width:${px}px;height:${px}px" data-th="${_siEsc(code)}">${inner}</span>`;
}
window._siAxImgFail=function(img){
  const sp=img&&img.parentNode;if(!sp)return;
  const b=document.createElement('b');b.className='si-th-c';b.textContent=sp.getAttribute('data-th')||'';
  sp.removeChild(img);sp.appendChild(b);
};

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
// Snapshot time in ms from whatever the read gave back: ISO string, Date, Firestore Timestamp or {seconds}.
function _siAxSnapMs(v){
  if(v==null||v==='')return null;
  if(typeof v==='string'){const t=Date.parse(v);return isNaN(t)?null:t;}
  if(v instanceof Date)return isNaN(v.getTime())?null:v.getTime();
  if(typeof v.toDate==='function'){try{return _siAxSnapMs(v.toDate());}catch(_){return null;}}
  const sec=v.seconds!=null?v.seconds:v._seconds;if(sec!=null&&isFinite(sec))return Number(sec)*1000;
  return null;
}
// The store-local day a snapshot is the CLOSE of. A snapshot taken before 18:00 PKT is still the previous day's
// close (the 22:00 run is the real close; the old 06:00 and the 10:00 runs are not). Without a usable snapshot_at
// the document's own date is used unchanged.
function _siAxSnapKeyOf(date,ms){
  if(ms==null)return String(date);
  const p=new Date(ms+5*3600000),day=_siAxDayNum(p.getUTCFullYear()+'-'+String(p.getUTCMonth()+1).padStart(2,'0')+'-'+String(p.getUTCDate()).padStart(2,'0'));
  return _siAxDayStr(p.getUTCHours()<_SI_AX_CFG.snapshotDayCutoffHour?day-1:day);
}
function _siAxSnapKey(d){return _siAxSnapKeyOf(d.date,_siAxSnapMs(d&&d.snapshot_at));}
// One snapshot document folded to what the history needs and nothing else: its date, snapshot time (ms), item count, locations
// seen, per-code stock sums (negatives counted as 0) and per-code oversold counts. This small record is what is cached between
// visits (see _siAxReadFolds); _siAxHistoryFromFolds is the ONLY thing that turns folds into the history, so a cached fold and a
// freshly read one cannot give different figures.
function _siAxFoldDoc(d){
  if(!(d&&d.date&&d.items&&typeof d.items==='object'&&/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))))return null;
  const sums=new Map(),neg=new Map();let n=0;
  for(const id in d.items){n++;const it=d.items[id];const code=_siAxCode(it&&it.sku);if(!code)continue;sums.set(code,(sums.get(code)||0)+Math.max(0,it.available||0));
    if((it.available||0)<0)neg.set(code,(neg.get(code)||0)+1);}
  // locations_seen is written only by snapshots taken after stock was summed across every location; older ones lack it
  const ls=Number(d.locations_seen);
  return{date:d.date,sms:_siAxSnapMs(d.snapshot_at),n,loc:(d.locations_seen!=null&&d.locations_seen!==''&&isFinite(ls))?ls:null,sums:[...sums],neg:[...neg]};
}
function _siAxHistoryFromFolds(folds){
  const good=(folds||[]).filter(Boolean);
  const counts=good.map(f=>f.n).sort((x,y)=>x-y);
  const med=counts.length?counts[Math.floor(counts.length/2)]:0;
  const byCode=new Map(),dates=[],dropped=[],rekeyed=[],neg=new Map(),locs=new Map();
  // one document per closing day: two documents that map to the same day keep the EARLIER snapshot (the one closer to that day's end)
  const byKey=new Map();
  good.forEach(f=>{
    if(med&&f.n<med*_SI_HIST_MIN_SHARE){dropped.push(f.date);return;}
    const key=_siAxSnapKeyOf(f.date,f.sms);if(key!==String(f.date))rekeyed.push(f.date);
    const prev=byKey.get(key);
    if(!prev||(f.sms||0)<(prev.sms||0))byKey.set(key,f);
  });
  [...byKey.keys()].sort().forEach(key=>{
    const f=byKey.get(key);
    dates.push(key);
    locs.set(key,f.loc);
    // oversold variants are counted as 0 in the sum and kept only as a per-day count
    f.neg.forEach(([code,c])=>{let nm=neg.get(code);if(!nm){nm=new Map();neg.set(code,nm);}nm.set(key,c);});
    f.sums.forEach(([code,v])=>{let m=byCode.get(code);if(!m){m=new Map();byCode.set(code,m);}m.set(key,v);});
  });
  const locVals=[...locs.values()].filter(v=>v!=null);
  const loc={max:locVals.length?Math.max.apply(null,locVals):null,missing:[...locs.values()].filter(v=>v==null).length,firstSeen:[...locs.keys()].sort().find(k=>locs.get(k)!=null)||''};
  return{dates,byCode,dropped,rekeyed,neg,loc,from:dates[0]||'',to:dates[dates.length-1]||'',docs:good.length};
}
function _siAxBuildHistory(docs){return _siAxHistoryFromFolds((docs||[]).map(_siAxFoldDoc));}
// ── The read, and the per-device cache of folded days ──
// A snapshot day is FINAL once that day is over (the 22:00 run overwrites the 10:00 one, nothing writes an older day), so folds
// of days up to two days ago are kept in localStorage. A warm visit reads only the days newer than the newest cached one (about
// 3 documents instead of up to 150) and rebuilds the SAME history from cached + new folds. The cache is dropped after 7 days
// (a full read again, which bounds how long a retroactively edited old snapshot could go unseen), on Retry, on a different
// format version, or if anything in it is unreadable. localStorage missing or full means a full read every visit (the old behaviour).
const _SI_HIST_CACHE_KEY='groovy-si-histfold',_SI_HIST_CACHE_VER=1,_SI_HIST_CACHE_MAX_DAYS=7,_SI_HIST_FINAL_LAG=2;
function _siHistCacheRead(){
  try{
    const raw=localStorage.getItem(_SI_HIST_CACHE_KEY);if(!raw)return null;
    const c=JSON.parse(raw);
    if(!c||c.v!==_SI_HIST_CACHE_VER||!Array.isArray(c.folds)||!c.folds.length||!(Date.now()-c.full<_SI_HIST_CACHE_MAX_DAYS*86400000))return null;
    for(const f of c.folds){if(!f||typeof f.date!=='string'||!Array.isArray(f.sums)||!Array.isArray(f.neg)||typeof f.n!=='number')return null;}
    return c;
  }catch(_){return null;}
}
function _siHistCacheWrite(folds,fullAt){
  try{
    const lim=_siPktDate(-_SI_HIST_FINAL_LAG);
    const keep=folds.filter(f=>String(f.date)<=lim);
    if(!keep.length){localStorage.removeItem(_SI_HIST_CACHE_KEY);return;}
    localStorage.setItem(_SI_HIST_CACHE_KEY,JSON.stringify({v:_SI_HIST_CACHE_VER,full:fullAt,folds:keep}));
  }catch(_){}
}
function _siHistCacheClear(){try{localStorage.removeItem(_SI_HIST_CACHE_KEY);}catch(_){}}
// Returns the folds of the newest _SI_HIST_MAX days: from the cache plus only the newer documents when the cache is warm.
async function _siAxReadFolds(force){
  const col=collection(db,'shopify_inventory_snapshots');
  const cache=force?null:_siHistCacheRead();
  let last='';if(cache)cache.folds.forEach(f=>{if(String(f.date)>last)last=String(f.date);});
  const q=cache?query(col,where('date','>',last),orderBy('date','desc'),limit(_SI_HIST_MAX)):query(col,orderBy('date','desc'),limit(_SI_HIST_MAX));
  const snap=await getDocs(q);
  const fresh=[];snap.forEach(d=>{const f=_siAxFoldDoc(d.data());if(f)fresh.push(f);});
  let all=fresh;
  if(cache){
    const m=new Map();cache.folds.forEach(f=>m.set(String(f.date),f));fresh.forEach(f=>m.set(String(f.date),f)); // a re-read day replaces its cached copy
    all=[...m.values()];
  }
  all.sort((x,y)=>String(y.date)<String(x.date)?-1:String(y.date)>String(x.date)?1:0);
  all=all.slice(0,_SI_HIST_MAX);
  return{folds:all,fullAt:cache?cache.full:Date.now(),read:fresh.length,warm:!!cache};
}
let _siHistLast=null; // what the last read did: {read, warm} (documents read, cache used) — for the page note and the tests
function _siAxEnsureHistory(force){
  if(_siHistPromise)return _siHistPromise;
  if(!force&&(_siHistState==='ok'||_siHistState==='error'))return Promise.resolve();
  _siHistState='loading';_siHistError='';
  const rd=(async()=>{
    const r=await _siAxReadFolds(!!force);
    const h=_siAxHistoryFromFolds(r.folds);
    _siHistLast={read:r.read,warm:r.warm};
    _siHistCacheWrite(r.folds,r.fullAt);
    return h;
  })();
  let tmr=null;const to=new Promise((_,rej)=>{tmr=setTimeout(()=>rej(new Error('timed out after '+(_SI_HIST_TIMEOUT/1000)+'s')),_SI_HIST_TIMEOUT);});
  _siHistPromise=Promise.race([rd,to]).then(h=>{_siHist=h;_siHistState='ok';}).catch(e=>{_siHist=null;_siHistState='error';_siHistError=(e&&e.message)||String(e);}).then(()=>{
    clearTimeout(tmr);_siHistPromise=null;_siAxCache=null;
    if(typeof document!=='undefined'&&document.getElementById&&document.getElementById('si-ax-body'))_siAxRepaintBody();
    if(typeof _siNaOnHistory==='function')_siNaOnHistory();
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
  // The sell-through run may step over ONE missing snapshot day (re-keying by snapshot_at leaves a single-day gap where the
  // schedule changed): sales of the missing day(s) are added to the span, nothing else is invented.
  let run=null,prevVal=h.get(_siAxDayStr(fn-1)),gap=0,gapSold=0;
  for(let k=fn;k<=tn;k++){
    const D=_siAxDayStr(k),P=_siAxDayStr(k-1);
    const x=h.get(D),y=h.get(P);
    const sold=(a.daily.get(D)||{u:0}).u;
    if(x==null){
      if(prevVal!=null){gap++;gapSold+=sold;if(gap>_SI_AX_CFG.snapshotBridgeDays){run=null;prevVal=null;gap=0;gapSold=0;}}
      continue;
    }
    if(y!=null){
      r.measured++;
      if(x>0||y>0){r.inStock++;r.unitsIn+=sold;}else r.out++;
    }
    if(prevVal!=null){
      const sd=sold+gapSold;
      if(!run)run={from:D,opening:prevVal,sold:0,received:0,days:0};
      const resid=x-prevVal+sd;run.sold+=sd;if(resid>=Math.max(_SI_RECV_MIN,_SI_RECV_SHARE*prevVal))run.received+=resid; // small residuals are noise, not receipts
      run.days+=1+gap;run.to=D;run.closing=x;
      r.run=run.days>=(r.run?r.run.days:0)?Object.assign({},run):r.run; // keep the contiguous run that reaches furthest
    }
    prevVal=x;gap=0;gapSold=0;
  }
  return r;
}
// Recent demand while the article could be bought: per 7-day window (newest first, up to 12), units sold on in-stock days
// and the in-stock days behind them, weighted 0.5^(age in weeks / half-life 4). pace = weighted units / weighted in-stock
// days x 7, so a week the article was out of stock adds no days and cannot drag the pace down, and old weeks count less.
// Returns null when fewer than 7 in-stock days exist in the window (the caller falls back to the plain 28-day pace).
function _siAxPaceEwma(a,E,today){
  const C=_SI_AX_CFG,Tn=_siAxDayNum(today),En=_siAxDayNum(E);
  if(Tn==null||En==null)return null;
  let num=0,den=0,units=0,days=0;
  for(let k=0;k<C.ewmaWeeks;k++){
    const to=Tn-7*k,from=Math.max(En,to-6);if(to<En)break;
    const ex=_siAxExposure(a,_siAxDayStr(from),_siAxDayStr(to));
    if(!ex.inStock)continue;
    const w=Math.pow(0.5,k/C.ewmaHalfLife);
    num+=w*ex.unitsIn;den+=w*ex.inStock;units+=ex.unitsIn;days+=ex.inStock;
  }
  if(days<7||den<=0)return null;
  return{pace:num/den*7,units,days};
}
// Weeks of cover as a range: point = on hand / pace; the range scales the pace by the 95% Poisson interval of the units behind it.
// Top end capped at coverCapWeeks. Returns {point,lo,hi,over}: over = even the low end is above the cap ("more than 26 weeks").
function _siAxCoverRange(onHand,pace,units){
  if(onHand==null||pace==null||!(pace>0))return null;
  const C=_SI_AX_CFG,point=onHand/pace;
  let lo=point,hi=point;
  if(units>0){const pz=_siAxPoisson(units);lo=onHand/(pace*pz.hi/units);hi=pz.lo>0?onHand/(pace*pz.lo/units):Infinity;}
  return{point,lo:Math.min(lo,point),hi:Math.max(hi,point),over:lo>C.coverCapWeeks,fewUnits:units<C.lowUnits};
}
// Cover in words: "9–19 weeks", "9–26+ weeks", "more than 26 weeks"; with few sales behind it the text says so.
function _siAxCoverText(m){
  if(!m||m.cover==null)return'—';
  const C=_SI_AX_CFG,r=m.coverRange;
  if(m.cover===0)return'none left';
  if(!r)return _siAxNum(m.cover)+' weeks';
  if(r.over)return'more than '+C.coverCapWeeks+' weeks';
  if(r.hi<=2){const lo=Math.max(1,Math.floor(r.lo*7)),hi=Math.max(1,Math.ceil(r.hi*7));return lo===hi?'about '+hi+' day'+(hi===1?'':'s'):lo+'–'+hi+' days';}
  const lo=Math.max(0,Math.floor(r.lo)),hi=r.hi>C.coverCapWeeks?C.coverCapWeeks+'+':String(Math.ceil(r.hi));
  return(String(lo)===hi?hi:lo+'–'+hi)+' weeks';
}
function _siAxCoverNote(m){
  if(!m||m.cover==null)return'';
  const r=m.coverRange;
  return(r&&r.fewUnits?'few sales behind it, so rough · ':'')+m.coverBasis;
}
// Momentum in words. Never a bare percentage: the percentage is a detail line, and only when the words are earned.
function _siAxMomText(m){
  if(!m||m.days==null||m.days<56)return'needs 56 counted days';
  if(m.momWord)return m.momWord;
  return m.momNote||'too few sales to tell';
}
// Sell-through = sold ÷ (sold + stock left at the end of the span): the standard retail definition. It needs no
// receipt inference and cannot exceed 100% (stock is never negative). Equivalent to sold ÷ (opening + everything
// that arrived net of losses) because closing = opening + arrivals - sold. The inferred `received` (and the opening
// stock) are kept only as supporting figures. Replaces sold ÷ (opening + received-past-the-noise-floor), which
// exceeded 100% for 65 of 339 articles because stock increases under max(5, 10% of opening) were left out of the supply.
function _siAxStMake(sold,closing,opening,received,from,to,days,src){
  return{value:sold/(sold+closing),from,to,days,sold,closing,opening,received,src};
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
    st:null,received:null,sizesNow:null,sizesPrev:null,risk:[],sizeRows:[],voided:null,refunded:null,voidRate:null,refundRate:null,
    inRate:null,inDays:null,outDays:null,measured:null,perInDay:null,histState:_siHistState,
    paceHead:null,paceHeadBasis:'',coverRange:null,coverUnits:null,momWord:null,momNote:'',momUnits:null,catShare28:null,catUnits28:null,units28Share:null,histState2:''};
  const Tn=_siAxDayNum(today),En=E?_siAxDayNum(E):null;
  if(En!=null&&En<=Tn){
    const days=Tn-En+1;o.days=days;
    const u=_siAxUnitsBetween(a,E,today);o.units=u;
    // voided / refunded units in the same counted window; they never enter net units, rates, sell-through or cover
    let vu=0,ru=0;if(a.xdaily)a.xdaily.forEach((d,day)=>{if(day>=E&&day<=today){vu+=d.v;ru+=d.r;}});
    o.voided=vu;o.refunded=ru;
    if(u+vu+ru>0){o.voidRate=vu/(u+vu+ru);o.refundRate=ru/(u+vu+ru);}
    if(days>=7)o.rateWeek=u/days*7;
    const s28=Math.max(En,Tn-27),d28=Tn-s28+1;o.pace28Days=d28;
    o.units28=_siAxUnitsBetween(a,_siAxDayStr(s28),today);
    if(d28>=7)o.pace28=o.units28/d28*7;
    if(days>=56){
      const last=_siAxUnitsBetween(a,_siAxDayStr(Tn-27),today),prev=_siAxUnitsBetween(a,_siAxDayStr(Tn-55),_siAxDayStr(Tn-28));
      if(prev>0)o.momentum=last/prev-1;
      // Rising / Steady / Fading only with 20+ units across both periods AND a gap bigger than chance (two-sided, 95%):
      // conditional binomial, z = (|last - prev| - 1) / sqrt(last + prev). Otherwise: too few sales to tell.
      const N=last+prev;o.momUnits=N;
      if(N<_SI_AX_CFG.momentumMinUnits)o.momNote='too few sales to tell';
      else{
        const z=(Math.abs(last-prev)-1)/Math.sqrt(N);
        if(z>_SI_AX_CFG.momentumZ){o.momWord=last>prev?'Rising':'Fading';}else o.momWord='Steady';
      }
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
    // headline pace: the plain counted-window rate, or (when the article was out of stock more than 10% of measured days)
    // the in-stock pace, with its plain footnote
    if(o.rateWeek!=null)o.paceHead=o.rateWeek;
    if(o.paceHead!=null)o.paceHeadBasis='counted days';
    if(o.inRate!=null&&o.inRate<0.90&&o.perInDay!=null){o.paceHead=o.perInDay*7;o.paceHeadBasis='in stock';}
    if(ex.run&&ex.run.days>=7&&(ex.run.sold+ex.run.closing)>0){
      o.st=_siAxStMake(ex.run.sold,ex.run.closing,ex.run.opening,ex.run.received,ex.run.from,ex.run.to,ex.run.days,'history');
      o.received=ex.run.received;
    }
    // weeks of cover: recency-weighted in-stock pace over up to 12 weeks (see _siAxPaceEwma); when there are fewer than 7
    // in-stock days, the plain 28-day pace. Shown as a range, capped at "more than 26 weeks".
    if(a.hasStock){
      const ew=_siAxPaceEwma(a,E,today);
      if(ew&&ew.pace>0){o.cover=a.onHand/ew.pace;o.coverBasis='recent in-stock pace';o.coverRange=_siAxCoverRange(a.onHand,ew.pace,ew.units);o.coverUnits=ew.units;}
      else if(!ew&&o.pace28!=null&&o.pace28>0){o.cover=a.onHand/o.pace28;o.coverBasis='28-day pace';o.coverRange=_siAxCoverRange(a.onHand,o.pace28,o.units28);o.coverUnits=o.units28;}
      if(o.cover!=null)o.coverDays=o.cover*7;
    }
  }
  if(a.category){const cu=idx.catUnits.get(a.category)||0;o.catUnits=cu;if(cu>0)o.catShare=a.units/cu;
    // share of the category over the LAST 28 days (same window for everyone), so a new article is not diluted by its age
    const c28=idx.catUnits28.get(a.category)||0;o.catUnits28=c28;if(c28>0)o.catShare28=_siAxUnitsSince(a,27).u/c28;}
  // two loaded snapshots (today's and a week ago) — the fallback when history is not loaded
  const curDate=(_siSnapshot&&_siSnapshot.date)||today,prevDate=_siPrevSnapshot&&_siPrevSnapshot.date;
  if(!o.st&&a.hasStock&&a.hasPrev&&prevDate&&_siAxDayNum(prevDate)!=null&&_siAxDayNum(prevDate)<_siAxDayNum(curDate)){
    const sold=_siAxUnitsBetween(a,_siAxDayAdd(prevDate,1),curDate);
    const resid=a.onHand-a.prevOnHand+sold;const recv=resid>=Math.max(_SI_RECV_MIN,_SI_RECV_SHARE*a.prevOnHand)?resid:0;
    if(sold+a.onHand>0){o.st=_siAxStMake(sold,a.onHand,a.prevOnHand,recv,prevDate,curDate,_siAxDayNum(curDate)-_siAxDayNum(prevDate),'two snapshots');o.received=recv;}
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

// ── Explorer v2 settings: ONE documented object. Every number here is a labelled DEFAULT (conventions for a
// first read, derived from this store's own distributions; not validated with the business), editable later.
const _SI_AX_CFG={
  // confidence (per article): units and counted days
  lowUnits:10,lowDays:28,highUnits:30,highDays:56,
  leadTimeSet:false,          // no supplier lead time is stored anywhere yet: while false, confidence is capped at Medium
  returnsSyncedShare:0.95,    // returns count as synced when this share of the last 60 days' line items carry status_synced_at
  // demand, classes, actions (steps 2-3)
  ewmaWeeks:12,ewmaHalfLife:4,
  coverCapWeeks:26,
  momentumMinUnits:20,momentumZ:1.96,
  snapshotDayCutoffHour:18,   // a snapshot taken before 18:00 PKT is the close of the PREVIOUS day
  snapshotBridgeDays:1,       // the sell-through span may step over this many consecutive missing snapshot days
  bandMin:30,                 // an age band with fewer articles than this is merged into the next one up
  ageBands:[28,56,112],       // counted-day floors of the age bands
  winnerPct:0.90,winnerInStock:0.70,winnerUnits:30,
  constrainedInStock:0.70,constrainedPct:0.50,
  solidPct:0.50,steadyPct:0.20,
  deadNoSaleDays:28,
  abcA:0.80,abcB:0.95,xyzX:0.5,xyzY:1.0,xyzMinWeeks:8,xyzMinMean:1,
  reorderCoverWeeks:4,holdCoverWeeks:26,markdownCoverWeeks:12,stopMinAgeDays:90
};
// Poisson 95% interval for an observed count (Byar's approximation). Used only to print ranges in words.
function _siAxPoisson(n){
  n=Math.max(0,Math.round(Number(n)||0));const z=1.96;
  const lo=n===0?0:n*Math.pow(1-1/(9*n)-z/(3*Math.sqrt(n)),3);
  const n1=n+1,hi=n1*Math.pow(1-1/(9*n1)+z/(3*Math.sqrt(n1)),3);
  return{lo:Math.max(0,lo),hi:hi};
}
// Confidence chip. Low: fewer than 10 units or fewer than 28 counted days. High: 30+ units AND 56+ days. Medium between.
// A default lead time or returns that are not synced yet cap the level at Medium (High is not honest until both are real).
function _siAxConfidence(a){
  const m=_siAxStats(a),C=_SI_AX_CFG,ret=_siAxIndex().quality.returns;
  const units=m.units==null?0:m.units,days=m.days==null?0:m.days;
  let lvl=(m.days==null||units<C.lowUnits||days<C.lowDays)?0:((units>=C.highUnits&&days>=C.highDays)?2:1);
  const caps=[];
  if(!ret.synced)caps.push('later returns are not synced yet');
  if(!C.leadTimeSet&&!_siAxLtAnyCustom()&&_siAxLtArtDays(a&&a.code)==null)caps.push('the supplier lead time is a default');
  const capped=lvl===2&&caps.length>0;if(capped)lvl=1;
  const name=['Low','Medium','High'][lvl];
  const why=[units+' unit'+(units===1?'':'s')+' over '+days+' counted day'+(days===1?'':'s')];
  if(capped)why.push('capped at Medium because '+caps.join(' and '));
  let range='';
  if(lvl===0&&days>=7){
    const pz=_siAxPoisson(units),lo=Math.round(pz.lo/days*7),hi=Math.max(lo,Math.round(pz.hi/days*7));
    range='could be anywhere from '+lo+' to '+hi+' a week';
  }
  return{level:['low','medium','high'][lvl],lvl,name,dots:lvl+1,why,caps:capped?caps:[],range,units,days};
}
function _siAxConfChip(c){
  return`<span class="si-conf lvl-${c.level}" title="${_siEsc('Confidence '+c.name+': '+c.why.join('; '))}"><span class="si-dots" aria-hidden="true">${[0,1,2].map(i=>`<i${i<c.dots?' class="on"':''}></i>`).join('')}</span>${_siEsc(c.name)} confidence</span>`;
}
// Trust note: later returns and cancellations are not in these units until the returns sync has stamped the lines.
function _siAxTrustBanner(){
  const q=_siAxIndex().quality.returns;
  if(q.synced)return`<div class="si-ax-trust ok" role="note">Returns are synced: ${q.units} unit${q.units===1?'':'s'} already returned or cancelled are taken off the totals.</div>`;
  return'';// owner's call (1 Oct 2026): no banner while returns are unsynced; the quiet note sits in Data quality and Data checks
}

// ── Scorecard ───────────────────────────────────────────────────────
// DEFAULT thresholds — conventions for a first read derived from this store's own
// distributions (docs/UNITS_METRICS.md), NOT facts about the business. They are printed on
// screen beside the chart. First matching rule wins, in this order:
// Too early · Not rated · Dead stock · Stock-constrained · Winner · Solid · Steady · Slow.  First match wins.
// Demand D = units per in-stock day (exposure-adjusted), ranked against the other classed articles of the same age band
// (percentile, mid-rank). Plan: docs/UNITS_METRICS.md "Classes v2".
const _SI_AX_SCORE={minDays:28,deadNoSaleDays:28,
  winnerPct:0.90,winnerInStock:0.70,winnerUnits:30,        // Winner: top 10% demand, in stock 70%+ of days, 30+ units, confidence not Low
  constrainedInStock:0.70,constrainedPct:0.50,             // Stock-constrained: in stock under 70% of days AND demand above the median
  solidPct:0.50,steadyPct:0.20,                            // Solid: at or above the median; Steady: at or above p20; else Slow
  poolMin:30,ageBands:[28,56,112],                         // a pool under 30 articles uses the fixed bands below
  absWinner:2.7,absSolid:0.5,absSteady:0.2,                // units per in-stock day
  overCoverWeeks:26,markdownCoverWeeks:12,stopMinAgeDays:90,riskWeeks:2};
const _SI_AX_CLASSES={
  early:{label:'Too early',act:'Not classed: wait for more counted days.'},
  unrated:{label:'Not rated',act:'Not classed: stock or pace data is missing.'},
  dead:{label:'Dead stock',act:'Stop production; bundle, discount or clear. Do not reorder or re-cut.',shape:'cross'},
  constrained:{label:'Stock-constrained',act:'Demand beat the median while it was out of stock: restock or re-cut.',shape:'tri'},
  winner:{label:'Winner',act:'Protect stock, reorder early, consider more colourways.',shape:'star'},
  solid:{label:'Solid',act:'Keep stocked; reorder when cover gets shorter than the lead time.',shape:'circle'},
  steady:{label:'Steady',act:'Hold and watch cover.',shape:'diamond'},
  slow:{label:'Slow',act:'Review price or promotion; do not reorder; consider stopping production.',shape:'square'}
};
// ── Lead time: editable defaults, per viewer (localStorage), never facts ─────────────────
const _SI_LT_KEY='groovy-si-leadtimes';
const _SI_LT_DEFAULT={tops:21,heavy:35,other:28};
const _SI_LT_LABEL={tops:'Tees and tops',heavy:'Hoodies, jackets, denim and bottoms',other:'Everything else'};
function _siAxLtGroup(cat){
  const s=String(cat||'').toLowerCase();
  if(/hood|jacket|coat|denim|jean|jort|pant|trouser|bottom|jogger|short|cargo|sweat|fleece|zip/.test(s))return'heavy';
  if(/tee|top|shirt|polo|tank|singlet/.test(s))return'tops';
  return'other';
}
function _siAxLtStored(){try{const v=JSON.parse(localStorage.getItem(_SI_LT_KEY)||'{}');return v&&typeof v==='object'?v:{};}catch(_){return{};}}
// Per-article override (Sept 2026): CODE -> whole days, per device like the category defaults. No Firestore, no rules.
// One reader, three steps: article override -> category default -> the global fallback (_SI_LT_DEFAULT.other).
const _SI_LT_ART_KEY='groovy-si-leadtimes-article';
function _siAxLtDays(v){const n=Number(v);return(v!==''&&v!=null&&typeof v!=='boolean'&&isFinite(n)&&n>=1&&n<=365)?Math.round(n):null;}
function _siAxLtCode(c){const k=String(c==null?'':c).trim().toUpperCase();return(k&&k.length<=60&&k!=='__PROTO__')?k:'';}
// Only own, valid entries of a plain object survive; corrupt JSON, arrays and junk values are ignored.
function _siAxLtArtStored(){
  const out=Object.create(null);
  try{
    const v=JSON.parse(localStorage.getItem(_SI_LT_ART_KEY)||'{}');
    if(v&&typeof v==='object'&&!Array.isArray(v))Object.keys(v).forEach(k=>{const c=_siAxLtCode(k),d=_siAxLtDays(v[k]);if(c&&d!=null)out[c]=d;});
  }catch(_){}
  return out;
}
function _siAxLtArtDays(code){const c=_siAxLtCode(code);if(!c)return null;const d=_siAxLtArtStored()[c];return d==null?null:d;}
function _siAxLeadTime(a){
  const g=_siAxLtGroup(a&&a.category),st=_siAxLtStored(),v=Number(st[g]);
  const cat=isFinite(v)&&v>=1&&v<=365;
  const ad=_siAxLtArtDays(a&&a.code),article=ad!=null;
  const days=article?ad:(cat?Math.round(v):(_SI_LT_DEFAULT[g]||_SI_LT_DEFAULT.other));
  // source says which step applied; text is the wording used next to the number
  const source=article?'article':(cat?'category':'default');
  const text=article?'your lead time for this article':(cat?'your lead time':'default lead time, unconfirmed');
  return{group:g,days,custom:article||cat,article,source,text,label:_SI_LT_LABEL[g]};
}
function _siAxLtAnyCustom(){const st=_siAxLtStored();return Object.keys(_SI_LT_DEFAULT).some(g=>{const v=Number(st[g]);return isFinite(v)&&v>=1&&v<=365;});}
window._siAxSetLt=function(g,val){
  if(!_SI_LT_DEFAULT[g])return;
  const st=_siAxLtStored(),n=Math.round(Number(val));
  if(val===''||!isFinite(n)||n<1||n>365)delete st[g];else st[g]=n;
  try{localStorage.setItem(_SI_LT_KEY,JSON.stringify(st));}catch(_){}
  if(typeof _siAxRepaintAll==='function')_siAxRepaintAll();
};
window._siAxResetLt=function(){try{localStorage.removeItem(_SI_LT_KEY);}catch(_){}if(typeof _siAxRepaintAll==='function')_siAxRepaintAll();};
let _siAxLtEdit=null,_siAxLtErr='';   // the article code whose lead-time editor is open (one at a time), and its message
function _siAxLtWrite(map){try{if(Object.keys(map).length)localStorage.setItem(_SI_LT_ART_KEY,JSON.stringify(map));else localStorage.removeItem(_SI_LT_ART_KEY);}catch(_){}}
// Repaints the explorer body only (no fetch), keeps the scroll position and puts focus back on the row's Edit button.
function _siAxLtRepaint(focusCode,focusInput){
  const sy=(typeof window!=='undefined'&&window.scrollY)||0;
  if(document.getElementById('si-ax-body'))_siAxRepaintBody();else if(typeof _siAxRepaintAll==='function')_siAxRepaintAll();
  try{
    let t=null;
    if(focusInput)t=document.querySelector('input[data-lt-input]');
    else if(focusCode){const all=document.querySelectorAll('[data-lt-edit]');for(let i=0;i<all.length;i++)if(all[i].dataset&&all[i].dataset.code===focusCode){t=all[i];break;}}
    if(t){t.focus({preventScroll:true});if(focusInput&&t.select)t.select();}
  }catch(_){}
  try{window.scrollTo(0,sy);}catch(_){}
}
window._siAxLtEdit=function(code){_siAxLtEdit=_siAxLtCode(code)||null;_siAxLtErr='';_siAxLtRepaint(null,true);};
window._siAxLtCancel=function(code){_siAxLtEdit=null;_siAxLtErr='';_siAxLtRepaint(_siAxLtCode(code));};
window._siAxSetLtArt=function(code,val){
  const c=_siAxLtCode(code);if(!c)return false;
  const map=_siAxLtArtStored();
  if(val===''||val==null){delete map[c];}
  else{const d=_siAxLtDays(val);if(d==null){_siAxLtEdit=c;_siAxLtErr='Enter a whole number of days from 1 to 365.';_siAxLtRepaint(null,true);return false;}map[c]=d;}
  _siAxLtWrite(map);_siAxLtEdit=null;_siAxLtErr='';_siAxLtRepaint(c);return true;
};
window._siAxResetLtArt=function(code){
  const c=_siAxLtCode(code);if(!c)return;
  const map=_siAxLtArtStored();delete map[c];_siAxLtWrite(map);
  if(_siAxLtEdit===c){_siAxLtEdit=null;_siAxLtErr='';}
  _siAxLtRepaint(c);
};
window._siAxLtSave=function(el){
  if(!el||!el.dataset)return;
  const i=el.parentNode&&el.parentNode.querySelector?el.parentNode.querySelector('input[data-lt-input]'):null;
  window._siAxSetLtArt(el.dataset.code,i?i.value:'');
};
window._siAxLtKey=function(ev,el){
  if(!ev||!el)return;
  if(ev.key==='Enter'){if(ev.preventDefault)ev.preventDefault();window._siAxSetLtArt(el.dataset.code,el.value);}
  else if(ev.key==='Escape'){if(ev.preventDefault)ev.preventDefault();window._siAxLtCancel(el.dataset.code);}
};
// The "Lead time: 35 days · Edit" control. Every string is escaped; the code travels in a data attribute, never in a handler string.
function _siAxLtCtlHtml(a){
  const lt=_siAxLeadTime(a),code=_siAxLtCode(a&&a.code),ec=_siEsc(code);
  if(!code)return'';
  if(_siAxLtEdit===code){
    return`<div class="si-lt-ctl editing"><label class="si-lt-l">Lead time <input type="number" min="1" max="365" step="1" inputmode="numeric" value="${lt.days}" data-lt-input="1" data-code="${ec}" onkeydown="window._siAxLtKey(event,this)" aria-label="Lead time in days for ${_siEsc(_siAxLabel(a))}"> days</label>
      <button class="si-ax-btn" data-code="${ec}" onclick="window._siAxLtSave(this)">Save</button>
      ${lt.article?`<button class="si-ax-btn" data-code="${ec}" onclick="window._siAxResetLtArt(this.dataset.code)">Reset to default</button>`:''}
      <button class="si-ax-btn" data-code="${ec}" onclick="window._siAxLtCancel(this.dataset.code)">Cancel</button>
      ${_siAxLtErr?`<div class="si-ax-note si-lt-err" role="alert" style="margin:0;flex-basis:100%">${_siEsc(_siAxLtErr)}</div>`:''}</div>`;
  }
  return`<div class="si-lt-ctl"><span class="si-lt-l" title="${_siEsc(lt.text)}">Lead time: ${lt.days} days</span>${lt.article?'<span class="si-lt-chip">custom</span>':''}<span class="si-ax-note" style="margin:0">· <button class="si-ax-btn si-lt-edit" data-lt-edit="1" data-code="${ec}" onclick="window._siAxLtEdit(this.dataset.code)">Edit</button></span></div>`;
}
// ── Demand pools: a percentile among articles of the same age band ───────────────────────
function _siAxDemandOf(m){
  if(m.perInDay!=null)return{D:m.perInDay,fb:false};
  if(m.rateWeek!=null)return{D:m.rateWeek/7,fb:true};
  return null;
}
function _siAxDemand(){
  const idx=_siAxIndex();if(idx.demand)return idx.demand;
  const T=_SI_AX_SCORE,out=new Map(),groups=T.ageBands.map(()=>[]);
  idx.list.forEach(a=>{
    const m=_siAxStats(a);
    if(m.days==null||m.days<T.minDays||(!a.hasStock&&!m.st))return;
    const d=_siAxDemandOf(m);if(!d)return;
    let b=0;T.ageBands.forEach((f,i)=>{if(m.days>=f)b=i;});
    groups[b].push({code:a.code,D:d.D,fb:d.fb,band:b});
  });
  // a band with fewer than poolMin articles is merged into the next one up
  for(let i=0;i<groups.length-1;i++)if(groups[i].length&&groups[i].length<T.poolMin){groups[i+1]=groups[i+1].concat(groups[i]);groups[i]=[];}
  groups.forEach(g=>{
    const n=g.length;if(!n)return;
    const sorted=g.map(x=>x.D).sort((p,q)=>p-q);
    const q=pct=>sorted[Math.min(n-1,Math.max(0,Math.ceil(pct*n)-1))];
    const abs=n<T.poolMin;
    g.forEach(x=>{
      let below=0,eq=0,above=0;sorted.forEach(v=>{if(v<x.D)below++;else if(v===x.D)eq++;else above++;});
      const pD=(below+0.5*eq)/n;
      out.set(x.code,{D:x.D,fb:x.fb,n,abs,pD:abs?null:pD,p:abs?null:Math.round(pD*100),rank:above+1,
        winAt:abs?T.absWinner:q(T.winnerPct),solidAt:abs?T.absSolid:q(T.solidPct),steadyAt:abs?T.absSteady:q(T.steadyPct)});
    });
  });
  idx.demand=out;return out;
}
// Returns {cls,label,act,rule,near,unverified,skipped,D,rank,n,p,abs}. The rule is built from computed values only.
// A clause whose metric is "—" is skipped, never passed by default; a row that skipped one is "partly unverified".
function _siAxClassify(a){
  const m=_siAxStats(a),T=_SI_AX_SCORE,f=v=>_siAxNum(v),pc=v=>_siAxPct(v);
  const skipped=[];
  const out=(cls,rule,extra)=>Object.assign({cls,label:_SI_AX_CLASSES[cls].label,act:_SI_AX_CLASSES[cls].act,rule,near:'',unverified:skipped.length>0,skipped:skipped.slice()},extra||{});
  if(m.days==null||m.days<T.minDays)return out('early','Only '+(m.days==null?0:m.days)+' counted day'+(m.days===1?'':'s')+'; classes start at '+T.minDays+'.');
  if(!a.hasStock&&!m.st)return out('unrated','No stock data for this article in the snapshots.');
  const dm=_siAxDemand().get(a.code);
  if(!dm)return out('unrated','No units per in-stock day yet (needs 7+ in-stock days of stock history, or a counted rate).');
  const conf=_siAxConfidence(a);
  if(dm.fb)skipped.push('in-stock demand (the plain counted rate is used)');
  if(m.inRate==null)skipped.push('in-stock rate');
  const ex={D:dm.D,rank:dm.rank,n:dm.n,p:dm.p,abs:dm.abs};
  const rankTxt=dm.abs?f(dm.D)+' units per in-stock day (fewer than '+T.poolMin+' articles of this age, so fixed bands: Winner '+T.absWinner+', Solid '+T.absSolid+', Steady '+T.absSteady+')'
    :f(dm.D)+' units per in-stock day, rank '+dm.rank+' of '+dm.n+' (p'+dm.p+') among articles of similar age';
  const inTxt=m.inRate==null?'':'in stock on '+pc(m.inRate)+' of '+m.measured+' measured days';
  const aboveP=(pct,absV)=>dm.abs?dm.D>=absV:dm.pD>=pct;
  const thr=(pctKey,absKey,val)=>dm.abs?f(T[absKey])+'/day':'p'+Math.round(T[pctKey]*100)+' ('+f(val)+'/day)';
  // dead
  if(a.hasStock&&m.pace28Days>=T.deadNoSaleDays&&m.units28===0&&a.onHand>0)
    return out('dead','no sale in the last '+m.pace28Days+' counted days with '+a.onHand+' on hand.',ex);
  if(!a.hasStock)skipped.push('sales in the last 28 days');
  // stock-constrained
  if(m.inRate!=null&&m.inRate<T.constrainedInStock&&m.units28>0&&aboveP(T.constrainedPct,T.absSolid))
    return out('constrained',inTxt+' (below '+pc(T.constrainedInStock)+') while demand beat the median: '+rankTxt+'.',Object.assign({near:'Returns to a normal class when it is in stock on '+pc(T.constrainedInStock)+' of days.'},ex));
  // winner
  const winTop=aboveP(T.winnerPct,T.absWinner);
  if(winTop&&(m.inRate==null||m.inRate>=T.winnerInStock)&&m.units>=T.winnerUnits&&conf.lvl>0){
    const r=out('winner',rankTxt+(inTxt?'; '+inTxt:'')+'; '+m.units+' units; '+conf.name+' confidence.',Object.assign({near:'Drops to Solid below '+thr('winnerPct','absWinner',dm.winAt)+'.'},ex));
    return r;
  }
  const why=[];
  if(winTop){ // top demand but one of the floors failed: say which
    if(m.inRate!=null&&m.inRate<T.winnerInStock)why.push('not a Winner: in stock on '+pc(m.inRate)+' of days, Winner needs '+pc(T.winnerInStock));
    if(m.units<T.winnerUnits)why.push('not a Winner: '+m.units+' units, Winner needs '+T.winnerUnits);
    if(conf.lvl===0)why.push('not a Winner: Low confidence');
  }
  const extra=why.length?'; '+why.join('; '):'';
  if(aboveP(T.solidPct,T.absSolid))return out('solid',rankTxt+(inTxt?'; '+inTxt:'')+extra+'.',Object.assign({near:winTop?'':'Winner from '+thr('winnerPct','absWinner',dm.winAt)+' with '+T.winnerUnits+'+ units and '+pc(T.winnerInStock)+'+ in stock.'},ex));
  if(aboveP(T.steadyPct,T.absSteady))return out('steady',rankTxt+(inTxt?'; '+inTxt:'')+'.',Object.assign({near:'Solid from '+thr('solidPct','absSolid',dm.solidAt)+'.'},ex));
  return out('slow',rankTxt+(inTxt?'; '+inTxt:'')+'.',Object.assign({near:'Steady from '+thr('steadyPct','absSteady',dm.steadyAt)+'.',review:m.units<15&&(m.cover==null||m.cover>T.overCoverWeeks)},ex));
}
// What to do, from the class and the cover against the lead time. {key,label,text,lead} — key: reorder | risk | stuck | hold | markdown | watch | ok
function _siAxActionOf(a){
  const c=_siAxClassify(a),m=_siAxStats(a),T=_SI_AX_SCORE,conf=_siAxConfidence(a),lt=_siAxLeadTime(a),ltw=lt.days/7;
  const ltTxt='lead time '+lt.days+' days ('+(lt.article?lt.text:(lt.custom?'your setting':'default, unconfirmed'))+')';
  const cov=m.cover,covTxt=_siAxCoverText(m);
  const sizes=m.risk&&m.risk.length?m.risk.map(x=>x.size).join(', '):'';
  const R=(key,label,text)=>({key,label,text,lead:lt});
  if(c.cls==='early'||c.cls==='unrated')return R('watch','Watch',c.cls==='early'?'Not classed yet: too few counted days.':'Not classed: stock or pace data is missing.');
  if(c.cls==='dead')return R('stuck','Stop / clear','Nothing sold in '+m.pace28Days+' days with '+a.onHand+' on hand: do not reorder; bundle, discount or clear.');
  // nothing sold in 28 days and nothing on hand: no current demand to restock for
  if(c.cls!=='dead'&&m.units28===0&&a.hasStock&&a.onHand===0)return R('watch','Out of stock, no recent sales','Sold nothing in the last '+m.pace28Days+' counted days and none is left: reorder only if you plan a re-run.');
  if(c.cls==='constrained')return R('reorder','Reorder now','Out of stock on '+_siAxPct(1-(m.inRate==null?1:m.inRate))+' of measured days while demand beat the median; '+ltTxt+'.');
  if(c.cls==='slow'){
    if(conf.lvl===0)return R('watch','Review: little data',m.units+' units so far: too little to decide.');
    if(m.days>=T.stopMinAgeDays&&(cov==null||cov>T.markdownCoverWeeks))return R('stuck','Stuck: markdown or stop',(cov==null?'No pace to divide stock by':covTxt+' of cover')+' after '+m.days+' counted days: mark down, then stop production if it does not move.');
    if(cov==null||cov>T.markdownCoverWeeks)return R('markdown','Mark down',(cov==null?'No recent pace':covTxt+' of cover')+' at a slow rate: discount or promote; do not reorder.');
    return R('watch','Watch','Slow but stock is low ('+covTxt+' of cover).');
  }
  // winner, solid, steady
  if(cov!=null&&cov<ltw&&conf.lvl>0)return R('reorder','Reorder now',(cov===0?'Nothing left in stock':covTxt+' of cover')+' against a '+lt.days+'-day lead time: a batch started today arrives after the stock is gone ('+lt.text+').');
  if((cov!=null&&cov<ltw+T.riskWeeks)||sizes)return R('risk','Stock-out risk',(sizes?'Size'+(m.risk.length===1?'':'s')+' '+sizes+' out and selling. ':'')+(cov!=null?covTxt+' of cover against a '+lt.days+'-day lead time.':'')+' Plan the next batch; '+ltTxt+'.');
  if(cov!=null&&cov>T.overCoverWeeks)return R('hold','Hold, do not reorder',covTxt+' of cover: enough for now.');
  return R('ok','No action',cov==null?'Cover unknown.':covTxt+' of cover, above the '+lt.days+'-day lead time.');
}
function _siAxLtArtListHtml(){
  const m=_siAxLtArtStored(),codes=Object.keys(m).sort(_siSortNat);
  let idx=null;try{idx=_siAxIndex();}catch(_){}
  const rows=codes.map(c=>{const a=idx&&idx.map&&idx.map.get(c),nm=a?_siAxLabel(a):'';return`<div class="si-lt-row"><span>${nm?'<strong>'+_siEsc(nm)+'</strong> · ':''}${_siEsc(c)}</span><span class="si-ax-note" style="margin:0">${m[c]} days</span><button class="si-ax-btn" data-code="${_siEsc(c)}" onclick="window._siAxResetLtArt(this.dataset.code)">Reset</button></div>`;}).join('');
  return`<div class="si-ax-lab" style="margin-top:12px">Articles with their own lead time (${codes.length})</div>${rows||'<div class="si-ax-note">None. Use Edit next to an article\u2019s lead time to set one; it is kept on this device only.</div>'}`;
}
function _siAxLtHtml(){
  const st=_siAxLtStored();
  const row=g=>{const v=Number(st[g]),cu=isFinite(v)&&v>=1&&v<=365;return`<label class="si-lt-row"><span>${_siEsc(_SI_LT_LABEL[g])}</span><input type="number" min="1" max="365" inputmode="numeric" value="${cu?v:_SI_LT_DEFAULT[g]}" onchange="window._siAxSetLt('${g}',this.value)" aria-label="Lead time in days, ${_siEsc(_SI_LT_LABEL[g])}"><span class="si-ax-note" style="margin:0">days · ${cu?'your setting':'default, unconfirmed'}</span></label>`;};
  return`<div class="si-lt"><div class="si-ax-lab">Lead time (days from deciding to make it to having it in stock)</div>${['tops','heavy','other'].map(row).join('')}<div class="si-ax-note">These are starting guesses, kept on this device only. “Reorder now” means the cover is shorter than the lead time. <button class="si-ax-btn" onclick="window._siAxResetLt()">Reset to defaults</button></div>${_siAxLtArtListHtml()}</div>`;
}
function _siAxClassCounts(){
  const idx=_siAxIndex();if(idx.classCounts)return idx.classCounts;
  const c={};Object.keys(_SI_AX_CLASSES).forEach(k=>{c[k]=0;});
  _siAxLive().forEach(a=>{if(a.units>0||a.hasStock)c[_siAxClassify(a).cls]++;});
  idx.classCounts=c;return c;
}
// Plain-words definitions: one registry feeds the tooltips, the "How these are
// measured" list and docs/UNITS_METRICS.md. Keys 'net'..'curve' are the ten headline
// metrics; the rest are supporting figures.
const _SI_AX_DEFS=[
  {k:'net',label:'Net units',how:'units on lines that were neither refunded nor voided, in the counted window',use:'Volume: what actually moved. Always read it with the counted days beside it.',read:'Low can simply mean few live days; high can simply mean long exposure.',cav:'Orders refunded when synced are left out; later refunds and cancellations are not seen.'},
  {k:'void',label:'Voided units / void rate',how:'units on voided orders in the counted window; void rate = voided ÷ (net + voided + refunded units)',use:'A high rate points to a payment, fraud or cancellation problem on this article: investigate the orders. Voided units are kept out of net units, sell-through and pace.',read:'High: many orders were started and never paid or were cancelled. Near 0: normal.',cav:'financial_status is read when the order is synced, so later voids are not seen and the rate may understate.'},
  {k:'refund',label:'Refunded units',how:'units on orders that were already refunded when synced, in the counted window',use:'Returns review: a product that comes back often (quality, fit, sizing).',read:'High against net units: a return problem.',cav:'Later refunds are not synced, so this understates; partial refunds are not seen.'},
  {k:'rate',label:'Units per week (live week rate)',how:'net units ÷ counted days × 7; when the article was out of stock on more than 10% of measured days, the headline figure is the in-stock pace (units on in-stock days ÷ in-stock days × 7) and the plain rate is printed beside it',use:'Compare products of different ages; decide what to reorder or stop.',read:'Low: slow or under-exposed. High: strong demand. Compare to the peer lines, not to zero.',cav:'Counted window only (later of live date and first synced order). Needs 7+ counted days.'},
  {k:'st',label:'Sell-through %',how:'units sold ÷ (units sold + stock left at the end of the span)',use:'Reorder or mark down: how much of what was available has gone.',read:'Low: stock is not moving (markdown, stop). High: nearly everything gone (restock, or you were short).',cav:'Never above 100%. Span shown on screen; needs 7+ contiguous snapshot days. Stock lost without a sale (shrinkage, transfers) counts as sold; returns restocked count as unsold.'},
  {k:'inrate',label:'In-stock rate',how:'days in stock ÷ measured days (a day is out only when stock was 0 at the end of the day before and of that day)',use:'Separate “not selling” from “not available”.',read:'Low: sales are capped by availability, so velocity is understated. High: velocity is fair.',cav:'Only days with two snapshots are measured; article level (any size in stock counts).'},
  {k:'perday',label:'Units per in-stock day',how:'units sold on in-stock days ÷ in-stock days',use:'True demand rate; compare launches and size up a reorder.',read:'Well above units per live week: the article was often out of stock.',cav:'Needs 7+ in-stock measured days. Sales on out-of-stock days are excluded.'},
  {k:'out',label:'Stock-out days',how:'measured days with no stock (of measured days)',use:'Restock decisions and lost-sales review.',read:'High: availability, not demand, is the limit.',cav:'A count of measured days, never extrapolated to unmeasured ones.'},
  {k:'cover',label:'Weeks of cover (stock lasts)',how:'on hand now ÷ weekly pace, where the pace is the in-stock pace of the last 12 weeks with recent weeks counting more (half-life 4 weeks); when fewer than 7 in-stock days exist, the plain 28-day pace. Shown as a range from the number of sales behind it, and as “more than 26 weeks” beyond that',use:'When to reorder, and what is overstocked.',read:'Under 4 weeks: reorder now. Above 26 weeks: overstock, markdown or hold (4 and 26 are labelled defaults).',cav:'Assumes the pace continues; a range, not a promise. With fewer than 10 sales behind it the range is wide and marked “rough”. Merchandise units per month are flat (the August spike was the sub-Rs-1 tip SKU, now left out).'},
  {k:'mom',label:'Momentum',how:'last 28 days’ units against the 28 days before; shown as Rising or Fading only when the two periods together hold 20+ units and the gap is bigger than chance (95%), as Steady when they do and it is not, and as “too few sales to tell” otherwise',use:'Is demand rising or fading: scale up, hold or exit.',read:'Fading: watch before reordering. Rising: building.',cav:'Needs 56 counted days. The percentage is a detail, shown only beside a Rising or Fading word.'},
  {k:'share',label:'Share of category (last 28 days)',how:'the article’s units in the last 28 days ÷ all units of the same product type in the last 28 days',use:'Range planning: which products carry a category right now.',read:'High: a pillar of the category. Low: a niche.',cav:'The window is the same for every article, so a newcomer is not diluted by its age. The all-time share is shown beside it.'},
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
function _siAxSeries(arts,metric,basis,opts){
  opts=opts||{};
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
  let xLabels=[],series=[],calKeys=[],prev=null;
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
    const win=opts.win&&opts.win.from&&opts.win.to?opts.win:null;
    let start='';
    arts.forEach(a=>{const Lv=_siAxLiveDay(a);const L=Lv&&Lv>cov?Lv:(a.firstDay||Lv);if(!L)return;let b=_siAxBucketStart(L,bucket);if(b<covB)b=covB;if(!start||b<start)start=b;});
    let keys=[];
    if(win){
      // A season frame: the whole window is the axis, so the future part of it is an empty frame (null, never 0).
      const wEnd=_siAxBucketStart(win.to,bucket);
      for(let b=_siAxBucketStart(win.from,bucket),g=0;b&&b<=wEnd&&g<1200;b=_siAxBucketNext(b,bucket),g++)keys.push(b);
    }else if(start){for(let b=start,g=0;b&&b<=curStart&&g<1200;b=_siAxBucketNext(b,bucket),g++)keys.push(b);}
    calKeys=keys;
    xLabels=keys.map(b=>_siAxFmtBucket(b,bucket,false));
    const cell=(a,b)=>{
      const L=_siAxLiveDay(a)||a.firstDay||'';
      if(!L)return null;
      if(_siAxBucketEnd(b,bucket)<L)return null; // not live yet
      if(win&&b>today)return null;               // later than today: not happened yet
      if(M.kind)return kv(a,b,_siAxBucketEnd(b,bucket));
      return val(a,b);
    };
    series=arts.map(a=>({code:a.code,values:fin(keys.map(b=>cell(a,b)))}));
    if(opts.prev){
      // The same buckets one year earlier (months: same month; weeks: 52 weeks back, so Monday stays Monday).
      // A bucket counts only when it lies wholly inside the synced data and the article was live then.
      const back=b=>bucket==='month'?_siAxAddMonths(b,-12):_siAxDayStr(_siAxDayNum(b)-364);
      prev=arts.map(a=>{
        const L=_siAxLiveDay(a)||a.firstDay||'';
        const vals=keys.map(b=>{
          const pb=back(b);
          if(!pb||pb<cov||!L||_siAxBucketEnd(pb,bucket)<L)return null;
          if(M.kind)return kv(a,pb,_siAxBucketEnd(pb,bucket));
          return val(a,pb);
        });
        return{code:a.code,values:fin(vals),any:vals.some(v=>v!=null)};
      });
    }
    if(keys.length&&keys[0]===covB&&cov>covB&&!M.kind)notes.push('The first bucket starts before the first synced order, so it may be understated.');
  }
  if(M.kind)notes.push('Counted window only: each bucket is divided by the live days counted in it, and days before the first synced order are left out (gaps, not zeros).');
  const n=xLabels.length,ticks=[];
  if(n){
    const maxT=(typeof window!=='undefined'&&window.innerWidth&&window.innerWidth<600)?3:6;
    const want=Math.min(n,n>maxT?maxT:n);
    const seen=new Set();
    for(let t=0;t<want;t++){const i=want===1?0:Math.round(t*(n-1)/(want-1));if(!seen.has(i)){seen.add(i);ticks.push(i);}}
  }
  const tickLabel=i=>basis==='launch'?xLabels[i]:_siAxFmtBucket(calKeys[i],bucket,true);
  return{xLabels,xTicks:ticks.map(i=>({i,label:tickLabel(i)})),series,prev,notes,bucket,metric,basis,metricDef:M,calKeys,win:opts.win||null};
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
  cfg.series.forEach((s0,si0)=>{
    const si=s0.ci!=null?s0.ci:si0,s=s0;
    let seg=[],lastIdx=-1;
    const flush=()=>{
      if(seg.length>=2)paths+=`<path class="si-ax-line s${si}${s.prev?' prev':''}" style="stroke-dasharray:${s.prev?'2 5':_SI_AX_DASH[si%5]}" d="${_siAxCurve(seg)}"/>`;
      else if(seg.length===1)dots+=`<i class="si-ax-end si-ax-badge si-ax-b${si}${s.prev?' prev':''}" style="left:${(seg[0].x/W*100).toFixed(2)}%;bottom:${(100-seg[0].y/H*100).toFixed(2)}%;width:${s.prev?6:10}px;height:${s.prev?6:10}px"></i>`;
      seg=[];
    };
    s.values.forEach((v,i)=>{
      if(v==null||!isFinite(v)){flush();return;}
      seg.push({x:X(i),y:Y(v)});lastIdx=i;
    });
    flush();
    if(lastIdx>=0&&!s.prev){
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
  const legend=cfg.series.map((s,si0)=>{const si=s.ci!=null?s.ci:si0;return`<span><svg viewBox="0 0 26 8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--si-s${si})" stroke-dasharray="${s.prev?'2 5':_SI_AX_DASH[si%5]}"/></svg><i class="si-ax-badge si-ax-b${si}">${si+1}</i>${_siEsc(s.name||s.code)}</span>`;}).join('');
  // One lone point per line is drawn as a dot; say so, or a young article looks like "nothing plotted".
  const live=cfg.series.filter(s=>!s.prev),pts=s=>s.values.filter(v=>v!=null&&isFinite(v)).length;
  const sparse=live.length&&live.every(s=>pts(s)<=1)?`<div class="si-ax-note" data-sparse="1">Only one point so far for each line, so there is no line to join — shown as a dot. A second ${cfg.bucketWord||'period'} of sales will draw it.</div>`:'';
  _siAxHov={labels:cfg.xLabels,series:cfg.series,money:!!cfg.money,fmt:cfg.fmt||null,n};
  return`<div class="si-ax-legend">${legend}</div>
  <div class="si-ax-wrap">
    <div class="si-ax-yaxis">${yl}</div>
    <div class="si-ax-plot" role="img" aria-label="${_siEsc(cfg.aria||'Line chart')}" onpointermove="window._siAxHover(event,this)" onpointerdown="window._siAxHover(event,this)" onpointerleave="window._siAxLeave(this,event)">
      ${gl}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>${dots}${ends}
      <div class="si-ax-cursor"></div><div class="si-ax-tip"></div>
    </div>
    <div class="si-ax-xaxis">${xl}</div>
  </div>${sparse}`;
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
    tip.innerHTML=`<b>${_siEsc(h.labels[i]||'')}</b>`+h.series.map((s,si0)=>{
      const si=s.ci!=null?s.ci:si0;const v=s.values[i];
      const t=v==null?'—':(h.fmt?h.fmt(v):(h.money?_siPKR(Math.round(v)):String(Math.round(v*10)/10)));
      return`<div class="r"><span><i class="si-ax-badge si-ax-b${si}">${si+1}</i> ${_siEsc(s.name||s.code)}</span><strong>${_siEsc(t)}</strong></div>`;
    }).join('');
    tip.style.display='block';
    if(pct>55){tip.style.left='auto';tip.style.right=(100-pct+1)+'%';}else{tip.style.right='auto';tip.style.left=(pct+1)+'%';}
  }
};
window._siAxLeave=function(el,ev){if(ev&&ev.pointerType==="touch")return;
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
function _siAxMaxCmp(){
  try{if(typeof window!=='undefined'&&window.matchMedia&&window.matchMedia('(max-width:600px)').matches)return 3;}catch(_){}
  return _SI_AX_MAX;
}
// ── Attention cues: the Compare hint pulse, the "1" badge and the transient alert ──────────
// The hint is a CSS class (a few cycles, then still); it is on while the article page is showing and
// Compare has not been opened in this visit. The badge is on the Compare tab whenever exactly one article is chosen.
function _siAxHintOn(){return !_siAxCmpSeen&&_siAxModeSel==='search'&&!!_siAxSel;}
function _siAxModeBtnHtml(id,l){
  const on=_siAxModeSel===id?' on':'';
  if(id!=='compare')return`<button id="si-ax-tab-${id}" class="si-ax-btn${on}" onclick="window._siAxSetMode('${id}')">${l}</button>`;
  const one=_siAxCmp.length===1;
  return`<button id="si-ax-tab-compare" class="si-ax-btn${on}${_siAxHintOn()?' si-ax-hint':''}"${one?' aria-label="Compare — 1 article chosen, choose another"':''} onclick="window._siAxSetMode('compare')">${l}${one?'<span class="si-ax-cbadge" aria-hidden="true">1</span>':''}</button>`;
}
function _siAxSyncTab(){const b=document.getElementById('si-ax-tab-compare');if(b)b.outerHTML=_siAxModeBtnHtml('compare','Compare');}
const _SI_AX_FLASH_MS=1500,_SI_AX_FADE_MS=250;
let _siAxFlashT1=null,_siAxFlashT2=null,_siAxFlashState=''; // '' | 'in' | 'out'
function _siAxFlashClear(){
  clearTimeout(_siAxFlashT1);clearTimeout(_siAxFlashT2);_siAxFlashT1=_siAxFlashT2=null;
  _siAxFlashState='';
  const h=document.getElementById('si-ax-live');
  if(h)h.innerHTML='';
}
// Shown at once (no delay), kept 1.5 s, then faded and removed. One at a time: a repeat replaces it, so nothing stacks.
// It never takes focus (no focus() call, not focusable).
function _siAxFlash(){
  _siAxFlashClear();
  const h=document.getElementById('si-ax-live');if(!h||_siAxCmp.length!==1)return false;
  // The text is a constant plus a number, never stored or typed text, so it is safe as markup.
  h.innerHTML='<div class="si-ax-flash">Choose another product to compare — add up to '+_siAxMaxCmp()+'</div>';
  _siAxFlashState='in';
  _siAxFlashT1=setTimeout(()=>{
    _siAxFlashState='out';
    const f=h.querySelector&&h.querySelector('.si-ax-flash');if(f)f.classList.add('out');
    _siAxFlashT2=setTimeout(_siAxFlashClear,_SI_AX_FADE_MS);
  },_SI_AX_FLASH_MS);
  return true;
}
function _siAxBodyHtml(){return _siAxModeSel==='compare'?_siAxCompareBody():(_siAxModeSel==='overview'?_siAxOverviewBody():(_siAxModeSel==='portfolio'?_siAxPortfolioBody():_siAxSearchBody()));}
function _siArticleExplorerSection(){
  if(!_siFullHist()){_siFullStart(false);return _siFullGateHtml('The Article Explorer');}
  _siAxEnsureHistory(); // one bounded read per session; repaints the body when it lands
  const idx=_siAxIndex();
  const modeBtn=_siAxModeBtnHtml;
  _siAxWireSlash();
  return`<div class="si-ax-bar" id="si-ax-modebar">${modeBtn('overview','Overview')}${modeBtn('portfolio','Portfolio')}${modeBtn('search','Search')}${modeBtn('compare','Compare')}
    <span class="si-ax-lab" style="margin-left:auto">${idx.list.length} articles${idx.list.length!==_siAxLive().length?' ('+(idx.list.length-_siAxLive().length)+' ignored)':''} · ignores the season filter</span></div>
  ${_siMetaNote()}
  ${_siAxSearchBarHtml()}
  ${_siAxTrustBanner()}
  <div id="si-ax-live" class="si-ax-live" role="status" aria-live="polite"></div>
  <div id="si-ax-body">${_siAxBodyHtml()}</div>${_siCleanQualityHtml(idx.quality)}`;
}
// The search box is navigation, so it is the same large, sticky box on every sub-tab (Overview, Portfolio, Search, Compare).
// ONE builder; the results below it are the one _siAxResultsHtml. The magnifier is an SVG path only (no text in SVG).
function _siAxSearchPlaceholder(){return _siAxModeSel==='compare'?'Find an article to compare — name, colour or code':'Find an article — name, colour or code';}
function _siAxSearchBarHtml(){
  return`<div class="si-ax-sticky" id="si-ax-sticky"><label class="si-ax-sbox" for="si-ax-input"><svg class="si-ax-mag" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4.5 4.5 1.4-1.4-4.5-4.5A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z"/></svg><input id="si-ax-input" class="si-ax-input" type="search" autocomplete="off" aria-label="Find an article" placeholder="${_siAxSearchPlaceholder()}" value="${_siEsc(_siAxQuery)}" oninput="window._siAxOnInput(this.value)" onkeydown="window._siAxKey(event)"><kbd class="si-ax-kbd" aria-hidden="true" title="Press / to search">/</kbd></label><div id="si-ax-results">${_siAxResultsHtml()}</div></div>`;
}
// "/" focuses the box when nothing is being typed anywhere. Registered once; ignored unless the Explorer's box is on screen.
function _siAxSlashOk(e){
  if(!e||e.key!=='/'||e.ctrlKey||e.metaKey||e.altKey)return false;
  const t=e.target;
  if(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||'')||t.isContentEditable))return false;
  if(typeof _siSection==='undefined'||_siSection!=='articles')return false;
  return !!document.getElementById('si-ax-input');
}
let _siAxSlashWired=false;
function _siAxWireSlash(){
  if(_siAxSlashWired||typeof document==='undefined'||!document.addEventListener)return;
  _siAxSlashWired=true;
  document.addEventListener('keydown',e=>{
    if(!_siAxSlashOk(e))return;
    const i=document.getElementById('si-ax-input');if(!i)return;
    if(e.preventDefault)e.preventDefault();
    i.focus();try{i.select();}catch(_){}
  });
}
function _siAxResultsHtml(){
  const q=_siAxQuery.trim(),mode=_siAxModeSel;
  if(!q&&(mode==='overview'||mode==='portfolio'||_siAxSel||(mode==='compare'&&_siAxCmp.length)))return'';
  const r=_siAxSearch(q,q?12:8);
  if(!r.hits.length)return`<div class="si-ax-empty">No article matches “${_siEsc(q)}”.</div>`;
  const add=mode==='compare',fn=add?'Add':(mode==='search'?'Pick':'Open');
  const hit=a=>{
    const on=add&&_siAxCmp.includes(a.code);
    const tail=add?(on?'<span class="si-ax-added" aria-hidden="true">✓ Added</span>':'<span class="si-ax-plus" aria-hidden="true">+ Add</span>'):'';
    return`<button class="si-ax-hit${on?' is-added':''}" data-code="${_siEsc(a.code)}"${add?` aria-pressed="${on}"`:''} onclick="window._siAx${fn}(this.dataset.code)">${_siAxThumb(a.code,40,a.name)}<span class="t">${_siEsc(a.name)}<div class="m">${_siEsc(a.color||'—')} · ${_siEsc(a.code)} · ${_siEsc(a.category||'no category')}</div>${_siIgChipHtml(a.code)}</span><span class="n">${a.units} sold</span>${tail}</button>`;
  };
  return`<div class="si-ax-note" style="margin:6px 0 4px">${q?r.total+' match'+(r.total===1?'':'es')+(r.total>r.hits.length?' — showing '+r.hits.length+', refine to narrow':''):'Top sellers (type to search all '+r.total+' articles)'} · ordered by units sold, then name, then code</div>
  <div class="si-ax-results">${r.hits.map(hit).join('')}</div>`;
}
window._siAxSetMode=function(m){
  _siAxModeSel=m==='compare'?'compare':(m==='overview'?'overview':(m==='portfolio'?'portfolio':'search'));_siAxQuery='';_siAxMsg='';
  if(_siAxModeSel==='compare')_siAxCmpSeen=true; // the hint has done its job
  _siAxRepaintAll();
  if(_siAxModeSel==='compare'&&_siAxCmp.length===1)_siAxFlash();
};
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
  if(b)b.innerHTML=_siAxBodyHtml();
}
window._siAxPick=function(code){_siAxSel=code;_siAxQuery='';_siAxRepaintBody();const i=document.getElementById('si-ax-input');if(i)i.focus();};
// Enter picks (Search) or adds (Compare) the top match, like a scanner-style entry box; nothing typed or no match does nothing.
window._siAxKey=function(ev){
  if(!ev||ev.key!=='Enter')return;
  const q=_siAxQuery.trim();if(!q)return;
  if(ev.preventDefault)ev.preventDefault();
  clearTimeout(window._siAxDebounce);
  const h=_siAxSearch(q,1).hits[0];if(!h)return;
  if(_siAxModeSel==='compare')window._siAxAdd(h.code);else if(_siAxModeSel==='search')window._siAxPick(h.code);else window._siAxOpen(h.code);
};
// Returns {ok,msg} so callers and tests see why an add was refused.
function _siAxTryAdd(code){
  code=String(code||'').toUpperCase();
  if(!_siAxIndex().map.has(code))return{ok:false,msg:'Unknown article.'};
  if(_siAxCmp.includes(code))return{ok:false,msg:'That article is already in the comparison.'};
  const mx=_siAxMaxCmp();
  if(_siAxCmp.length>=mx)return{ok:false,msg:'You can compare at most '+mx+' articles'+(mx<_SI_AX_MAX?' on a phone':'')+' — remove one first.'};
  _siAxCmp.push(code);return{ok:true,msg:''};
}
window._siAxAdd=function(code){
  const r=_siAxTryAdd(code);_siAxMsg=r.msg;
  if(!r.ok&&typeof showToast==='function')showToast(r.msg,true);
  if(r.ok)_siAxQuery='';
  _siAxRepaintBody();
  if(r.ok){const i=document.getElementById('si-ax-input');if(i)i.focus();_siAxSyncTab();if(_siAxCmp.length===1)_siAxFlash();else _siAxFlashClear();}
};
window._siAxRemove=function(code){
  _siAxCmp=_siAxCmp.filter(c=>c!==code);_siAxMsg='';_siAxRepaintBody();_siAxSyncTab();
  if(_siAxCmp.length===1)_siAxFlash();else _siAxFlashClear();
};
window._siAxClear=function(){_siAxSel='';_siAxQuery='';_siAxRepaintBody();};
window._siAxSetMetric=function(v){if(_SI_AX_METRICS[v])_siAxMetric=v;_siAxRepaintBody();};
window._siAxCurvePreset=function(){_siAxMetric='cum_week';_siAxBasis='launch';_siAxRepaintBody();_siAxRevealChart();};
window._siAxSetBasis=function(v){_siAxBasis=v==='launch'?'launch':'calendar';_siAxRepaintBody();_siAxRevealChart();};
// Calendar is the default time basis, so pressing it can change nothing visible; bring the chart into view and
// give it a brief outline so the press is acknowledged (a still ring under reduced motion).
function _siAxRevealChart(){
  const c=document.getElementById('si-ax-chartcard');if(!c)return false;
  let calm=false;try{calm=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){}
  if(typeof c.scrollIntoView==='function')try{c.scrollIntoView({behavior:calm?'auto':'smooth',block:'nearest'});}catch(_){}
  c.classList.add('si-ax-pop');setTimeout(()=>{try{c.classList.remove('si-ax-pop');}catch(_){}},1100);
  return true;
}
window._siAxSetBucket=function(v){_siAxBucket=v==='month'?'month':'week';_siAxRepaintBody();};



function _siAxHistBanner(){
  const st=_siHistState;
  if(st==='loading'||st==='idle')return`<div class="si-ax-note" role="status">Stock history: loading… In-stock figures show “—” until it lands (read once, kept for this session${_siHistCacheRead()?'; only the newest days are fetched on this device':''}).</div>`;
  if(st==='error')return`<div class="si-ax-note" role="alert" style="color:var(--accent-urgent);font-weight:600">Stock history could not be read (${_siEsc(_siHistError)}). In-stock rate, stock-out days, units per in-stock day and sell-through show “—”. <button class="si-ax-btn" onclick="window._siAxRetryHistory()">Retry</button></div>`;
  const H=_siHist,cov=_siAxIndex().cov;
  const short=H.dates.length<8?` <strong>Only ${H.dates.length} snapshot day${H.dates.length===1?'':'s'} exist, too few for in-stock figures (they need 7+ measured days).</strong>`:'';
  return`<div class="si-ax-note">Stock history: <strong>${H.dates.length}</strong> daily snapshots, ${_siEsc(_siAxFmtDay(H.from))} to ${_siEsc(_siAxFmtDay(H.to))}${cov&&H.from>cov?` — sales data starts earlier (${_siEsc(_siAxFmtDay(cov))}), so in-stock figures cover the snapshot window only`:''}. Negative stock counts as 0; items with no SKU are skipped; duplicate SKUs are summed; the “received” figure (supporting only, not used in sell-through) is inferred from stock increases of at least max(5, 10% of opening).${H.dropped.length?' Incomplete snapshot(s) ignored: '+_siEsc(H.dropped.join(', '))+'.':''}${short}</div>`;
}
// ── "Read this": ONE block. One compact card per article (name once, class badge with its shape, a labelled
// facts row), then a short "Across these articles" section grouped by topic. Every figure is computed from the
// stats; a fact or sentence is left out when its inputs are missing.
function _siAxReadFacts(a,m,c){
  const f=[];
  if(m.units!=null)f.push({k:'Sold',v:m.units+' units',sub:m.days+' counted days'+(m.rateWeek!=null?' · '+_siAxNum(m.rateWeek)+' a week':'')});
  if(m.st)f.push({k:'Sell-through',v:_siAxPct(m.st.value),sub:m.st.sold+' of '+(m.st.sold+m.st.closing)});
  if(m.inRate!=null)f.push({k:'In stock',v:m.outDays===0?'Every measured day':'Out '+m.outDays+' of '+m.measured+' days',sub:m.perInDay!=null?_siAxNum(m.perInDay*7)+' a week while in stock':''});
  if(m.cover!=null)f.push({k:'Cover',v:_siAxCoverText(m),sub:_siAxCoverNote(m)});
  else if(a.hasStock&&a.onHand===0&&m.pace28!=null&&m.pace28>0)f.push({k:'Cover',v:'None left',sub:'was selling '+_siAxNum(m.pace28)+' a week'});
  if(m.days!=null&&m.days>=56&&(m.momWord||m.momNote))f.push({k:'Momentum',v:_siAxMomText(m),sub:m.momWord&&m.momentum!=null?(m.momentum>=0?'up ':'down ')+_siAxPct(Math.abs(m.momentum))+' · last 4 weeks vs the 4 before':'last 4 weeks vs the 4 before'});
  return f;
}
function _siAxReadCard(r,n){
  const a=r.a,m=r.m,c=r.c;
  const chip=`<span class="si-pc-chip cls-${c.cls}"><i class="si-pc-key cls-${c.cls}"></i>${_siEsc(c.label)}</span>`;
  let body;
  if(c.cls==='early')body=`<div class="si-ax-note" style="margin:0">Only ${m.days||0} counted day${m.days===1?'':'s'}; classes start at ${_SI_AX_SCORE.minDays}.</div>`;
  else{
    const facts=_siAxReadFacts(a,m,c).map(x=>`<div class="si-rd-f"><div class="k">${_siEsc(x.k)}</div><div class="v">${_siEsc(x.v)}</div>${x.sub?`<div class="s">${_siEsc(x.sub)}</div>`:''}</div>`).join('');
    const warn=m.risk.length?`<div class="si-rd-warn"><span class="si-ax-flag">sizes out</span> Out of stock in size${m.risk.length===1?'':'s'} ${_siEsc(m.risk.map(x=>x.size).join(', '))}; sold ${m.risk.reduce((t,x)=>t+x.units,0)} in ${m.risk.length===1?'that size':'those sizes'} in the last 28 days.</div>`:'';
    body=(facts?`<div class="si-rd-facts">${facts}</div>`:'')+warn+(c.unverified?`<div class="si-ax-note" style="margin:4px 0 0">Partly unverified: ${_siEsc(c.skipped.join(', '))} unknown.</div>`:'');
  }
  const conf=_siAxConfidence(a);
  const lowLine=conf.lvl===0&&c.cls!=='early'?`<div class="si-ax-note" style="margin:0 0 4px"><strong>Too early to tell.</strong> ${_siEsc(conf.range||'Too few counted days for a pace.')}</div>`:'';
  return`<div class="si-rd-card"><div class="si-rd-head"><i class="si-ax-badge si-ax-b${n}">${n+1}</i><span class="si-rd-name">${_siEsc(_siAxLabel(a))}</span>${chip}${_siAxConfChip(conf)}</div>${lowLine}${body}</div>`;
}
// Cross-article sentences grouped by topic: [{topic, lines:[text]}]. Nothing for fewer than two articles.
function _siAxReadAcross(rows){
  const out=[],nm=r=>_siAxLabel(r.a);
  if(rows.length<2)return out;
  const add=(topic,lines)=>{if(lines.length)out.push({topic,lines});};
  const pace=[],rated=rows.filter(r=>r.m.rateWeek!=null);
  if(rated.length>=2){
    const hi=rated.reduce((x,y)=>y.m.rateWeek>x.m.rateWeek?y:x),lo=rated.reduce((x,y)=>y.m.rateWeek<x.m.rateWeek?y:x);
    if(hi!==lo){
      if(lo.m.rateWeek>0)pace.push(nm(hi)+' sells '+_siAxNum(hi.m.rateWeek/lo.m.rateWeek)+'× faster per live week than '+nm(lo)+' ('+_siAxNum(hi.m.rateWeek)+' vs '+_siAxNum(lo.m.rateWeek)+' units a week, counted window).');
      else pace.push(nm(hi)+' sells '+_siAxNum(hi.m.rateWeek)+' units per live week; '+nm(lo)+' sold none in its counted window.');
    }
    if(new Set(rated.map(r=>r.m.days)).size>1)pace.push('Counted windows differ ('+rated.map(r=>nm(r)+' '+r.m.days+' days').join(', ')+'); rates are per live week so they stay comparable.');
  }
  add('Pace',pace);
  const st=rows.filter(r=>r.m.st),stl=[];
  if(st.length>=2){
    const hi=st.reduce((x,y)=>y.m.st.value>x.m.st.value?y:x),lo=st.reduce((x,y)=>y.m.st.value<x.m.st.value?y:x);
    if(hi!==lo)stl.push('Highest sell-through: '+nm(hi)+' ('+_siAxPct(hi.m.st.value)+'); lowest: '+nm(lo)+' ('+_siAxPct(lo.m.st.value)+').');
  }
  add('Sell-through',stl);
  const cv=rows.filter(r=>r.m.cover!=null),cvl=[];
  if(cv.length>=2){
    const lo=cv.reduce((x,y)=>y.m.cover<x.m.cover?y:x),hi=cv.reduce((x,y)=>y.m.cover>x.m.cover?y:x);
    if(lo!==hi)cvl.push('Least cover: '+nm(lo)+' ('+_siAxCoverText(lo.m)+'); most: '+nm(hi)+' ('+_siAxCoverText(hi.m)+').');
  }
  rows.filter(r=>r.m.cover==null&&r.a.hasStock&&r.a.onHand===0&&r.m.pace28!=null&&r.m.pace28>0).forEach(r=>cvl.push(nm(r)+' has no stock left and was selling '+_siAxNum(r.m.pace28)+' a week.'));
  add('Cover',cvl);
  // only articles whose momentum is earned (20+ units and a gap bigger than chance) are called rising or fading
  const mo=rows.filter(r=>r.m.momWord==='Rising'||r.m.momWord==='Fading'),mol=[];
  if(mo.length>=2){
    const up=mo.filter(r=>r.m.momWord==='Rising'),dn=mo.filter(r=>r.m.momWord==='Fading');
    if(up.length)mol.push('Rising: '+up.map(r=>nm(r)+' '+_siAxPct(r.m.momentum,true)).join(', ')+' (last 4 weeks vs the 4 before).');
    if(dn.length)mol.push('Fading: '+dn.map(r=>nm(r)+' '+_siAxPct(r.m.momentum)).join(', ')+' (last 4 weeks vs the 4 before).');
  }
  add('Momentum',mol);
  return out;
}
// The one block. Cards follow class order (Winner, Solid, Steady, Stock-constrained, Slow, Dead stock, Too early, Not rated), then units.
function _siAxReadBlock(arts){
  const rows=(arts||[]).map((a,i)=>({a,i,m:_siAxStats(a),c:_siAxClassify(a)}));
  if(!rows.length)return'';
  const sorted=_siSortRows(rows,[{key:'cls',type:'cls',get:r=>r.c.label}],'cls',1,[{get:r=>r.m.units,type:'num',dir:-1},{get:r=>r.a.code,type:'code',dir:1}]);
  const cards=sorted.map(r=>_siAxReadCard(r,r.i)).join('');
  const across=_siAxReadAcross(rows),ah=across.length?`<div class="si-rd-across"><div class="si-rd-h">Across these articles</div>${across.map(g=>`<div class="si-rd-topic"><div class="si-rd-tl">${_siEsc(g.topic)}</div>${g.lines.map(t=>`<p>${_siEsc(t)}</p>`).join('')}</div>`).join('')}</div>`:'';
  return`<div class="card"><div class="card-title">Read this</div><div class="si-rd-list">${cards}</div>${ah}<div class="si-ax-note" style="margin-top:8px">Every figure is computed over each article’s counted window and is left out when its inputs are missing. Cards are in class order, then by units sold.</div></div>`;
}
// Nominal plot size in px (phone-width worst case) used only to decide how far to push overlapping points apart.
const _SI_PC_W=280,_SI_PC_H=300,_SI_PC_MIN=34,_SI_PC_NUDGE=22;
// Pure: [{px,py}] in pixels -> [{dx,dy}] offsets in whole pixels. Pairs closer than _SI_PC_MIN are pushed apart
// along their line of centres (a coincident pair along a fixed angle by index); no point moves more than _SI_PC_NUDGE.
function _siAxSpread(pts){
  const n=pts.length,o=pts.map(()=>({x:0,y:0}));
  for(let it=0;it<60;it++){
    let moved=false;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
      let vx=(pts[j].px+o[j].x)-(pts[i].px+o[i].x),vy=(pts[j].py+o[j].y)-(pts[i].py+o[i].y);
      let d=Math.hypot(vx,vy);
      if(d>=_SI_PC_MIN)continue;
      if(d<0.01){const ang=(i*2.4+j*1.3);vx=Math.cos(ang);vy=Math.sin(ang);d=1;}
      const push=(_SI_PC_MIN-d)/2+0.5,ux=vx/d,uy=vy/d;
      o[i].x-=ux*push;o[i].y-=uy*push;o[j].x+=ux*push;o[j].y+=uy*push;moved=true;
      [o[i],o[j]].forEach(q=>{const m=Math.hypot(q.x,q.y);if(m>_SI_PC_NUDGE){q.x*=_SI_PC_NUDGE/m;q.y*=_SI_PC_NUDGE/m;}});
    }
    if(!moved)break;
  }
  return o.map(q=>({dx:Math.round(q.x),dy:Math.round(q.y)}));
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
  const xs=_siAxScaleRaw([Math.max(maxX*1.08,T.absSolid*7*1.6)],false);
  // y axis: 0% to 100% with headroom, so a 100% point (sell-through cannot exceed 100%) sits inside the plot
  // instead of half outside its top edge; same at the bottom for 0%.
  const Y0=-0.04,Y1=1.12;
  const X=v=>Math.min(100,v/xs.max*100),Y=v=>(v-Y0)/(Y1-Y0)*100;
  // points that would sit on top of each other are nudged apart (at most _SI_PC_NUDGE px); exact values stay in the table and labels
  const off=_siAxSpread(pts.map(p=>({px:X(p.x)/100*_SI_PC_W,py:Y(p.y)/100*_SI_PC_H})));
  const dot=(p,k)=>`<button class="si-pc-pt cls-${p.r.c.cls}" style="left:calc(${X(p.x).toFixed(2)}% + ${off[k].dx}px);bottom:calc(${Y(p.y).toFixed(2)}% + ${off[k].dy}px)" aria-label="${_siEsc((p.i+1)+'. '+_siAxLabel(p.r.a)+': '+p.r.c.label+', '+_siAxNum(p.x)+' units per in-stock week, sell-through '+_siAxPct(p.y))}" title="${_siEsc(_siAxLabel(p.r.a)+' — '+p.r.c.label+' · '+_siAxNum(p.x)+'/in-stock wk · sell-through '+_siAxPct(p.y))}"><i>${p.i+1}</i></button>`;
  const dots=pts.map((p,k)=>dot(p,k)).join('');
  const gy=[{v:1,l:'100%'}];
  const guides=gy.map(g=>`<i class="si-pc-gy${g.v===1?' top':''}" style="bottom:${Y(g.v).toFixed(2)}%"><span>${_siEsc(g.l)}</span></i>`).join('');
  const yt=[0,0.25,0.5,0.75,1].map(v=>`<span class="si-ax-tick" style="bottom:${Y(v).toFixed(2)}%">${Math.round(v*100)}%</span>`).join('');
  const xt=[];for(let i=0;i<=xs.count;i++)xt.push(`<span class="si-ax-xtick${i===0?' first':(i===xs.count?' last':'')}" style="left:${(i/xs.count*100).toFixed(2)}%">${_siEsc(_siAxTick(xs.step*i))}</span>`);
  const legend=['winner','solid','steady','constrained','slow','dead'].map(k=>`<span><i class="si-pc-key cls-${k}"></i>${_siEsc(_SI_AX_CLASSES[k].label)}</span>`).join('');
  const chart=pts.length?`<div class="si-ax-legend">${legend}</div>
   <div class="si-pc-wrap"><div class="si-ax-yaxis">${yt}</div>
    <div class="si-pc-plot" role="group" aria-label="Performance scorecard: sell-through against units per in-stock week">${guides}${dots}</div>
    <div class="si-ax-xaxis" style="grid-column:2">${xt.join('')}</div></div>
   <div class="si-ax-note" style="text-align:center">x: units per in-stock week · y: sell-through · the class is decided by units per in-stock day against similar-age articles (x axis), not by sell-through${off.some(q=>q.dx||q.dy)?' · overlapping points are nudged apart by up to '+_SI_PC_NUDGE+' px':''}</div>`
   :`<div class="si-ax-empty">No article here has both an in-stock pace and a sell-through yet (${_siEsc(_siAxHistWhy(rows[0].m))}), so there is nothing to plot.</div>`;
  const notPlot=unplotted.length?`<div class="si-ax-note">Not plotted: ${unplotted.map(u=>_siEsc((u.i+1)+'. '+_siAxLabel(u.r.a)+' — '+u.why)).join('; ')}.</div>`:'';
  const shapeChip=c=>`<span class="si-pc-chip cls-${c.cls}"><i class="si-pc-key cls-${c.cls}"></i>${_siEsc(c.label)}</span>`;
  const tbl=_siSortTable('ax-score',[
    {key:'n',label:'#',type:'num',first:'asc',get:r=>rows.indexOf(r),cell:r=>`<td><i class="si-ax-badge si-ax-b${rows.indexOf(r)}">${rows.indexOf(r)+1}</i></td>`},
    {key:'art',label:'Article',type:'text',get:r=>_siAxLabel(r.a),cell:r=>`<td style="font-weight:600">${_siEsc(_siAxLabel(r.a))}<div class="si-ax-note" style="margin:0">${_siEsc(r.a.code)}</div></td>`},
    {key:'cls',label:'Class',type:'cls',get:r=>r.c.label,cell:r=>`<td>${shapeChip(r.c)}${r.c.unverified?'<div class="si-ax-note" style="margin:0">partly unverified</div>':''}</td>`},
    {key:'conf',label:'Confidence',type:'num',first:'desc',get:r=>_siAxConfidence(r.a).lvl,cell:r=>`<td>${_siAxConfChip(_siAxConfidence(r.a))}</td>`},
    {key:'units',label:'Net units',type:'num',get:r=>r.m.units,cell:r=>`<td>${r.m.units==null?'—':r.m.units}</td>`},
    {key:'rate',label:'Per live week',type:'num',get:r=>r.m.rateWeek,cell:r=>`<td>${_siAxNum(r.m.rateWeek)}</td>`},
    {key:'st',label:'Sell-through',type:'num',get:r=>r.m.st&&r.m.st.value,cell:r=>`<td>${_siAxPct(r.m.st&&r.m.st.value)}</td>`},
    {key:'inr',label:'In-stock',type:'num',get:r=>r.m.inRate,cell:r=>`<td>${_siAxPct(r.m.inRate)}</td>`},
    {key:'cover',label:'Cover',type:'num',first:'asc',get:r=>r.m.cover,cell:r=>`<td>${_siEsc(_siAxCoverText(r.m))}</td>`},
    {key:'rule',label:'Rule that matched',type:'text',get:r=>r.c.rule,cell:r=>`<td style="min-width:200px">${_siEsc(r.c.rule)}</td>`},
    {key:'act',label:'Use it for',type:'text',get:r=>r.c.act,cell:r=>`<td style="min-width:160px">${_siEsc(r.c.act)}</td>`}
  ],rows,{def:{key:'cls',dir:1},defText:'class order: Winner, Solid, Steady, Stock-constrained, Slow, Dead stock, Too early, Not rated',minWidth:780,ties:[{get:r=>r.m.units,type:'num',dir:-1},{get:r=>r.a.code,type:'code',dir:1}]});
  const thr=`<details class="si-ax-defs"><summary class="si-ax-lab" style="cursor:pointer">Default thresholds — defaults, not facts</summary>
   <div class="si-ax-note">Derived from this store’s own distributions (about 18 weeks of stock history); editable constants in <em>js/shopify.js</em>. First match wins, in this order.</div>
   <table class="cut-table" style="min-width:420px"><tbody>
   <tr><td>Too early</td><td>fewer than ${T.minDays} counted days — not classed</td></tr>
   <tr><td>Dead stock</td><td>no sale in the last ${T.deadNoSaleDays} counted days while stock is on hand</td></tr>
   <tr><td>Stock-constrained</td><td>in stock on less than ${_siAxPct(T.constrainedInStock)} of measured days and demand above the median (units per in-stock day, p${Math.round(T.constrainedPct*100)})</td></tr>
   <tr><td>Winner</td><td>top ${Math.round((1-T.winnerPct)*100)}% demand (p${Math.round(T.winnerPct*100)}), in stock on at least ${_siAxPct(T.winnerInStock)} of days, at least ${T.winnerUnits} units, and confidence not Low</td></tr>
   <tr><td>Solid</td><td>demand at or above the median (p${Math.round(T.solidPct*100)})</td></tr>
   <tr><td>Steady</td><td>demand at or above p${Math.round(T.steadyPct*100)}</td></tr>
   <tr><td>Slow</td><td>below p${Math.round(T.steadyPct*100)}; “Review: little data” when confidence is Low</td></tr></tbody></table>
   <div class="si-ax-note">Percentiles are taken among classed articles of similar age (bands from ${T.ageBands.join(', ')} counted days; a band under ${T.poolMin} articles merges into the next). A pool under ${T.poolMin} uses fixed bands: Winner ${T.absWinner}, Solid ${T.absSolid}, Steady ${T.absSteady} units per in-stock day.</div>
   ${_siAxLtHtml()}
   <div class="si-ax-note">A clause whose metric is “—” is skipped (never passed) and the row says “partly unverified”. These are vendor-style conventions, not validated with the business. Merchandise units per month are flat (the August spike in raw data was the sub-Rs-1 tip SKU, which is left out).</div></details>`;
  let counts='';
  if(_siHistState==='ok'){const c=_siAxClassCounts();counts=`<div class="si-ax-note">All ${Object.keys(c).reduce((t,k)=>t+c[k],0)} articles with sales or stock: ${['winner','solid','steady','constrained','slow','dead','early','unrated'].filter(k=>c[k]).map(k=>c[k]+' '+_SI_AX_CLASSES[k].label).join(' · ')}.</div>`;}
  return`<div class="card"><div class="card-title">Performance scorecard <span class="si-ax-note">(default thresholds — not facts)</span></div>
   ${chart}${notPlot}${tbl}${counts}${thr}</div>`;
}

function _siAxNeedsHistoryNote(){
  return`In-stock figures use the loaded stock snapshots only (see the stock history note above); where fewer than 7 days are measured they show “—”.`;
}
function _siAxDefsHtml(){
  return`<details class="card si-ax-defs"><summary class="card-title" style="cursor:pointer">How these are measured — and what to use them for</summary>${_SI_AX_DEFS.map(d=>`<div class="si-ax-def"><strong>${_siEsc(d.label)}</strong> = ${_siEsc(d.how)}.<div class="si-ax-note" style="margin:0"><b>Use it for:</b> ${_siEsc(d.use)}</div><div class="si-ax-note" style="margin:0"><b>Low / high:</b> ${_siEsc(d.read)}</div><div class="si-ax-note" style="margin:0"><b>Limit:</b> ${_siEsc(d.cav)}</div></div>`).join('')}</details>`;
}

// ── Search mode: one article ────────────────────────────────────────
// ── Stock vs sales timeline (one article) ───────────────────────────
// Everything here reads data already in memory: the cleaned daily sales on the article (a.daily), the per-article
// on-hand map of the bounded snapshot read (_siHist.byCode) and the lead time. No Firestore read. Every decision is a
// pure function (_siAxTimeline, _siAxTlWindow, _siAxTlSummary, _siAxTlReadout, _siAxTlCoverage, _siAxTlColumns) so
// the chart, the readout and the tables cannot disagree. Rules: docs/UNITS_METRICS.md §3c.
const _SI_TL={
  baseDays:28,minBaseDays:14,minBaseUnits:5,   // a baseline needs 14+ in-stock days and 5+ units, from up to 28 in-stock days
  skipAfter:3,                                  // the first 3 days after a restock are left out of the "after" baseline (launch burst)
  bridgeDays:2,                                 // a stretch continues over up to 2 'no data' days when stock read 0 on both sides
  maxRun:42,                                    // a stretch longer than this is probably discontinued: not estimated
  oneSide:0.5,                                  // only one side has a baseline: range is [0.5 x b, b] (an assumption, said on screen)
  strongResid:20,strongShare:0.25,              // a restock marker is solid when the jump is 20+ units and 25%+ of the stock before
  weekOutDays:4,                                // a week is shaded out when 4+ of its 7 days were out of stock
  maxDays:400
};
let _siAxTlRes='day',_siAxTlRange='90',_siAxTlHov=null;
const _SI_TL_RANGES=[['30','30 days'],['90','90 days'],['all','All']];

// Per-day series for one article. Day state follows the existing stock-out rule (_siAxExposure): a day is out of stock
// when stock read zero at BOTH the previous and this close; it is in stock when either was above zero; with either
// close missing it is 'nodata' (a gap, never a zero). Sales are the cleaned, non-voided, non-refunded units.
function _siAxTimeline(a,H,opts){
  opts=opts||{};
  const to=opts.to||(H&&H.to)||'',tn=_siAxDayNum(to);
  const r={ok:false,from:'',to,days:[],runs:[],events:[],hasStock:false,gapDays:0,negDays:0,price:null,stockFrom:H&&H.from||'',stockTo:H&&H.to||''};
  if(!a||tn==null)return r;
  let from=opts.from||(H&&H.from)||'';
  let fn=_siAxDayNum(from);if(fn==null)return r;
  if(tn-fn+1>_SI_TL.maxDays)fn=tn-_SI_TL.maxDays+1;
  if(fn>tn)return r;
  const h=H&&H.byCode?H.byCode.get(a.code):null;
  const negm=H&&H.neg?H.neg.get(a.code):null;
  r.hasStock=!!h;r.from=_siAxDayStr(fn);
  if(a.hasPrice&&a.units>0)r.price=a.rev/a.units;
  for(let k=fn;k<=tn;k++){
    const D=_siAxDayStr(k);
    const sv=h?h.get(D):null,pv=h?h.get(_siAxDayStr(k-1)):null;
    const stock=sv==null?null:sv,prev=pv==null?null:pv;
    const sold=(a.daily.get(D)||{u:0}).u;
    const state=(stock!=null&&prev!=null)?((stock>0||prev>0)?'in':'out'):'nodata';
    const neg=negm?(negm.get(D)||0):0;
    r.days.push({d:D,i:k-fn,stock,prev,sold,state,neg});
    if(neg>0)r.negDays++;
  }
  r.ok=true;
  if(h){
    // snapshot gaps inside the stock history (left blank)
    r.days.forEach(x=>{if(x.stock==null&&x.d>=r.stockFrom&&x.d<=r.stockTo)r.gapDays++;});
  }
  const days=r.days;
  // stock-out stretches
  const inIdx=[];days.forEach(x=>{if(x.state==='in')inIdx.push(x.i);});
  for(let i=0;i<days.length;i++){
    if(days[i].state!=='out')continue;
    let j=i;
    for(;;){
      while(j+1<days.length&&days[j+1].state==='out')j++;
      // one missing snapshot leaves up to two 'no data' days (the day itself, and the day after whose previous close is unknown):
      // stock read 0 on both sides of it, so the stretch continues. The gap days stay 'no data' and are not counted as out days.
      let g=0;while(j+1+g<days.length&&days[j+1+g].state==='nodata'&&g<=_SI_TL.bridgeDays)g++;
      if(g>0&&g<=_SI_TL.bridgeDays&&j+1+g<days.length&&days[j+1+g].state==='out')j=j+g;else break;
    }
    const run={from:days[i].d,to:days[j].d,i0:i,i1:j,days:j-i+1,outDays:0,sold:0,open:j===days.length-1,leftCensored:i===0||days[i-1].state==='nodata',est:null,why:''};
    for(let k=i;k<=j;k++)if(days[k].state==='out'){run.outDays++;run.sold+=days[k].sold;}
    const base=(idxs)=>{const u=idxs.reduce((s,k)=>s+days[k].sold,0);return idxs.length>=_SI_TL.minBaseDays&&u>=_SI_TL.minBaseUnits?u/idxs.length:null;};
    const pre=inIdx.filter(k=>k<i).slice(-_SI_TL.baseDays);
    const post=inIdx.filter(k=>k>j+_SI_TL.skipAfter).slice(0,_SI_TL.baseDays);
    const bp=base(pre),bq=base(post);
    if(run.days>_SI_TL.maxRun){run.why='longer than '+_SI_TL.maxRun+' days: probably discontinued or not relaunched, so not estimated';}
    else if(bp==null&&bq==null){run.why='not enough in-stock selling before or after it to set a pace (needs '+_SI_TL.minBaseDays+'+ in-stock days and '+_SI_TL.minBaseUnits+'+ units)';}
    else{
      let lo,hi,basis;
      if(bp!=null&&bq!=null){lo=Math.min(bp,bq);hi=Math.max(bp,bq);basis='before and after';}
      else{const b=bp!=null?bp:bq;lo=b*_SI_TL.oneSide;hi=b;basis=bp!=null?'before only':'after only';}
      run.est={lo,hi,mid:(lo+hi)/2,basis,pre:bp,post:bq};
    }
    r.runs.push(run);i=j;
  }
  // inferred restocks: same rule as the received figure (_siAxExposure), per day
  for(let i=0;i<days.length;i++){
    const x=days[i];if(x.stock==null||x.prev==null)continue;
    const resid=x.stock-x.prev+x.sold;
    if(resid>=Math.max(_SI_RECV_MIN,_SI_RECV_SHARE*x.prev))r.events.push({d:x.d,i,resid,prev:x.prev,stock:x.stock,sold:x.sold,strong:resid>=_SI_TL.strongResid&&resid>=_SI_TL.strongShare*x.prev});
  }
  return r;
}
// The visible slice of the series: the last N days, or everything.
function _siAxTlWindow(tl,range){
  const n=tl&&tl.days?tl.days.length:0;
  const N=range==='all'?n:Math.min(n,Math.max(1,parseInt(range,10)||90));
  return{i0:n-N,i1:n-1,n:N};
}
// Numbers for the read-out and the table, for the visible window. Lost sales use ONLY the in-stock pace.
function _siAxTlSummary(tl,range,lt){
  const w=_siAxTlWindow(tl,range),o={win:w,measured:0,out:0,inDays:0,sold:0,soldAtZero:0,runs:[],lost:null,notEstimated:0,
    ongoing:null,restocks:{n:0,units:0,strong:0},lt:null,negDays:0,price:tl?tl.price:null};
  if(!tl||!tl.ok||w.n<=0)return o;
  for(let i=w.i0;i<=w.i1;i++){
    const x=tl.days[i];o.sold+=x.sold;if(x.neg>0)o.negDays++;
    if(x.state!=='nodata')o.measured++;
    if(x.state==='out'){o.out++;o.soldAtZero+=x.sold;}else if(x.state==='in')o.inDays++;
  }
  let lo=0,hi=0,mid=0,nEst=0;
  tl.runs.forEach(run=>{
    let nWin=0,soldWin=0;for(let i=Math.max(run.i0,w.i0);i<=Math.min(run.i1,w.i1);i++)if(tl.days[i].state==='out'){nWin++;soldWin+=tl.days[i].sold;}
    if(!nWin)return;
    const row={from:run.from,to:run.to,days:run.outDays,span:run.days,nWin,sold:soldWin,est:run.est,why:run.why,open:run.open,leftCensored:run.leftCensored};
    if(run.est){lo+=nWin*run.est.lo;hi+=nWin*run.est.hi;mid+=nWin*run.est.mid;nEst+=nWin;}else o.notEstimated++;
    o.runs.push(row);
  });
  if(nEst>0)o.lost={lo:Math.round(lo),hi:Math.round(hi),mid:Math.round(mid),days:nEst,pace:mid/nEst};
  const last=tl.runs[tl.runs.length-1];
  if(last&&last.open)o.ongoing={from:last.from,days:last.days};
  tl.events.forEach(e=>{if(e.i>=w.i0&&e.i<=w.i1){o.restocks.n++;o.restocks.units+=e.resid;if(e.strong)o.restocks.strong++;}});
  if(lt&&lt.days>0&&tl.to){
    const tn=_siAxDayNum(tl.to);
    o.lt={days:lt.days,text:lt.text,placed:_siAxDayStr(tn-lt.days),lands:tl.to,
      latest:o.runs.length?{from:o.runs[o.runs.length-1].from,orderBy:_siAxDayStr(_siAxDayNum(o.runs[o.runs.length-1].from)-lt.days)}:null};
  }
  return o;
}
// The plain-language read-out. Short sentences, each only when its inputs exist.
function _siAxTlReadout(sum,hasStock){
  const L=[];
  if(!sum||!sum.win||sum.win.n<=0)return L;
  const f=d=>_siAxFmtDay(d);
  if(!hasStock){L.push('No stock history for this article, so only sales are drawn. '+sum.sold+' unit'+(sum.sold===1?'':'s')+' sold in this view.');return L;}
  if(!sum.measured){L.push('No stock readings fall in this view, so availability cannot be judged. '+sum.sold+' unit'+(sum.sold===1?'':'s')+' sold.');return L;}
  const pct=Math.round(sum.out/sum.measured*100);
  L.push('Out of stock '+sum.out+' of the '+sum.measured+' day'+(sum.measured===1?'':'s')+' measured in this view ('+pct+'%).');
  if(sum.out>0){
    if(sum.lost){
      const same=sum.lost.lo===sum.lost.hi;
      const rs=sum.price!=null&&sum.price>0?', about '+(same?_siPKR(Math.round(sum.lost.mid*sum.price)):_siPKR(Math.round(sum.lost.lo*sum.price))+'–'+_siPKR(Math.round(sum.lost.hi*sum.price)))+' at the average price before discounts':'';
      L.push('Estimate, not a count: about '+(same?'~'+sum.lost.lo:sum.lost.lo+'–'+sum.lost.hi)+' unit'+(sum.lost.hi===1?'':'s')+' of sales were likely lost while out of stock'+rs+'. It uses only the in-stock pace (about '+_siAxNum(sum.lost.pace,1)+' a day) times the days out, and ignores customers who bought another size or colour.');
    }
    if(sum.notEstimated>0){
      const r=sum.runs.find(x=>!x.est);
      L.push((sum.lost?sum.notEstimated+' stretch'+(sum.notEstimated===1?'':'es')+' left out of that estimate':'No loss estimate')+': '+(r&&r.why?r.why:'no baseline')+'.');
    }
    if(sum.soldAtZero>0)L.push(sum.soldAtZero+' unit'+(sum.soldAtZero===1?'':'s')+' sold on days stock read zero at both closes (a late restock, an order before the snapshot, or overselling). Drawn as striped bars.');
  }
  if(sum.ongoing)L.push('Out of stock now: since '+f(sum.ongoing.from)+' ('+sum.ongoing.days+' day'+(sum.ongoing.days===1?'':'s')+').');
  if(sum.restocks.n>0)L.push(sum.restocks.n+' restock'+(sum.restocks.n===1?'':'s')+' inferred from stock jumps (about '+sum.restocks.units+' units in total). Inferred from stock minus sales, not from receipts.');
  else L.push('No restock detected in this view.');
  if(sum.lt){
    let t='Lead time '+sum.lt.days+' days ('+sum.lt.text+'): an order placed on '+f(sum.lt.placed)+' would land today.';
    if(sum.lt.latest)t+=' The latest out-of-stock stretch began '+f(sum.lt.latest.from)+'; to land by then an order had to be placed by '+f(sum.lt.latest.orderBy)+'.';
    L.push(t);
  }
  return L;
}
// Honest coverage: what the stock history spans, what is blank, what was re-dated or clamped.
function _siAxTlCoverage(tl,H,cov,range){
  const L=[],f=d=>_siAxFmtDay(d);
  if(!tl||!tl.ok)return L;
  if(!H||!tl.hasStock){L.push('Sales are counted from '+(cov?f(cov):'—')+'. This article has no stock history in the snapshots, so there is no stock line.');return L;}
  const w=_siAxTlWindow(tl,range);
  L.push('Stock history: '+f(H.from)+' to '+f(H.to)+' ('+H.dates.length+' daily snapshots from one bounded read). Sales are counted from '+(cov?f(cov):'—')+'.');
  const first=tl.days[w.i0];
  if(first&&H.from&&first.d<H.from)L.push('Days before '+f(H.from)+' have no stock data (hatched grey): that is a gap, not zero stock.');
  let gaps=0;for(let i=w.i0;i<=w.i1;i++){const x=tl.days[i];if(x.stock==null&&x.d>=H.from&&x.d<=H.to)gaps++;}
  if(gaps>0)L.push(gaps+' day'+(gaps===1?' inside the stock history has':'s inside the stock history have')+' no snapshot and '+(gaps===1?'is':'are')+' left blank, never drawn as zero.');
  const today=tl.days[tl.days.length-1];
  if(today&&today.stock==null&&today.d>H.to)L.push('The newest close ('+f(H.to)+') is the last snapshot; days after it have no stock reading yet.');
  let neg=0;for(let i=w.i0;i<=w.i1;i++)if(tl.days[i].neg>0)neg++;
  L.push('Negative stock counts as 0'+(neg?' ('+neg+' day'+(neg===1?'':'s')+' in this view had an oversold variant)':'')+'. A day is out of stock when stock was 0 at both the previous and that day\'s close.');
  if(H.rekeyed&&H.rekeyed.length)L.push(H.rekeyed.length+' early-run snapshot'+(H.rekeyed.length===1?' is':'s are')+' shown on the day it closes (a snapshot before 18:00 PKT is the previous day\'s close).');
  const lc=H.loc;
  if(lc){
    if(lc.max!=null&&lc.max>1&&lc.missing>0)L.push('Snapshots from '+f(lc.firstSeen)+' sum all '+lc.max+' locations; the '+lc.missing+' before that did not record their locations (they read the first location only), so stock before then can be understated.');
    else if(lc.max!=null&&lc.max>1)L.push('Stock is summed across '+lc.max+' locations in every snapshot.');
    else if(lc.max==null)L.push('The snapshots do not record how many locations they summed, so stock may cover the first location only.');
  }
  return L;
}
// The columns drawn: one per day, or one per Monday-start week (stock = the last close of the week,
// shaded out when 4+ days were out). Gaps stay null.
function _siAxTlColumns(tl,res,range){
  const w=_siAxTlWindow(tl,range),cols=[];
  if(!tl||!tl.ok||w.n<=0)return cols;
  const days=tl.days.slice(w.i0,w.i1+1);
  if(res!=='week'){
    days.forEach(x=>{
      const ev=tl.events.find(e=>e.i===x.i);
      cols.push({label:_siAxFmtDay(x.d),short:_siAxFmtDay(x.d,true),d:x.d,stock:x.stock,sold:x.sold,state:x.state,outDays:x.state==='out'?1:0,measured:x.state==='nodata'?0:1,
        n:1,neg:x.neg,rs:ev||null,rsUnits:ev?ev.resid:0,rsStrong:!!(ev&&ev.strong)});
    });
    return cols;
  }
  const m=new Map();
  days.forEach(x=>{
    const b=_siAxBucketStart(x.d,'week');let c=m.get(b);
    if(!c){c={d:b,start:b,days:[]};m.set(b,c);cols.push(c);}
    c.days.push(x);
  });
  return cols.map(c=>{
    let sold=0,out=0,meas=0,stock=null,neg=0,ru=0,rsStrong=false,rsn=0;
    c.days.forEach(x=>{sold+=x.sold;if(x.state==='out')out++;if(x.state!=='nodata')meas++;if(x.stock!=null)stock=x.stock;if(x.neg>0)neg++;
      const ev=tl.events.find(e=>e.i===x.i);if(ev){ru+=ev.resid;rsn++;if(ev.strong)rsStrong=true;}});
    const n=c.days.length;
    const state=meas===0?'nodata':(out>0&&out>=Math.min(_SI_TL.weekOutDays,n)?'out':'in');
    return{label:'Week of '+_siAxFmtDay(c.start),short:_siAxFmtDay(c.start,true),d:c.start,stock,sold,state,outDays:out,measured:meas,n,neg,rs:rsn?{resid:ru}:null,rsUnits:ru,rsStrong};
  });
}
// ── drawing (HTML text, SVG paths only) ──
function _siAxTlTipText(c,res){
  const rows=[];
  rows.push(['Stock on hand',c.stock==null?'no stock data':String(c.stock)]);
  rows.push([res==='week'?'Sold that week':'Sold',String(c.sold)]);
  if(res==='week'){rows.push(['Out of stock',c.measured?c.outDays+' of '+c.measured+' measured days':'—']);}
  else rows.push(['State',c.state==='out'?'out of stock':(c.state==='in'?'in stock':'no data (gap)')]);
  if(c.rsUnits)rows.push(['Restock (inferred)','+'+c.rsUnits]);
  if(c.neg)rows.push(['Oversold',c.neg+' variant'+(c.neg===1?'':'s')+' below 0 (counted as 0)']);
  if(c.state==='out'&&c.sold>0&&res!=='week')rows.push(['Note','sold while stock read 0']);
  return{title:c.label,rows};
}
function _siAxTlChartHtml(tl,res,range,lt){
  const cols=_siAxTlColumns(tl,res,range),n=cols.length;
  if(!n)return'';
  const W=1000,H=100,f=v=>Math.round(v*100)/100;
  const stockVals=cols.map(c=>c.stock).filter(v=>v!=null);
  const soldVals=cols.map(c=>c.sold);
  const scS=_siAxScale(stockVals,true),scD=_siAxScale(soldVals,true);
  const hasStock=tl.hasStock&&stockVals.length>0;
  const X=i=>i/n*100;
  // bands (consecutive columns in the same state)
  const bands=[];
  cols.forEach((c,i)=>{
    const k=c.state==='out'?'out':(c.state==='nodata'?'nodata':'');
    if(!k)return;
    const b=bands[bands.length-1];
    if(b&&b.k===k&&b.i1===i-1){b.i1=i;b.days+=(k==='out'?c.outDays:0);}else bands.push({k,i0:i,i1:i,days:k==='out'?c.outDays:0});
  });
  const bandHtml=bands.filter(b=>hasStock||b.k==='out').map(b=>{
    const wpc=(b.i1-b.i0+1)/n*100,lab=b.k==='out'?'Out '+b.days+' d':'no stock data';
    return`<i class="si-tl-band ${b.k}" style="left:${X(b.i0).toFixed(2)}%;width:${wpc.toFixed(2)}%">${wpc>=(b.k==='out'?12:22)?`<b>${_siEsc(lab)}</b>`:''}</i>`;
  }).join('');
  // stock: stepped area + line, broken at gaps
  let area='',line='';
  if(hasStock){
    const Y=v=>f(H-(v/scS.max)*H);
    let i=0;
    while(i<n){
      if(cols[i].stock==null){i++;continue;}
      let j=i;while(j+1<n&&cols[j+1].stock!=null)j++;
      const x0=f(i/n*W);
      let l='M'+x0+' '+Y(cols[i].stock),ar='M'+x0+' '+H+'L'+x0+' '+Y(cols[i].stock);
      for(let k=i;k<=j;k++){
        if(k>i){l+='V'+Y(cols[k].stock);ar+='V'+Y(cols[k].stock);}
        const x1=f((k+1)/n*W);l+='H'+x1;ar+='H'+x1;
      }
      ar+='V'+H+'Z';area+=ar;line+=l;i=j+1;
    }
  }
  // restock markers
  let rsHtml='';
  if(hasStock){
    const strong=cols.map((c,i)=>({c,i})).filter(o=>o.c.rs&&o.c.stock!=null);
    const labelled=new Set(strong.filter(o=>o.c.rsStrong).sort((p,q)=>q.c.rsUnits-p.c.rsUnits).slice(0,6).map(o=>o.i));
    rsHtml=strong.map(o=>{
      const left=((o.i+0.5)/n*100).toFixed(2),bot=(o.c.stock/scS.max*100).toFixed(2);
      return`<i class="si-tl-rs ${o.c.rsStrong?'strong':'weak'}" style="left:${left}%;bottom:${bot}%"></i>`+(labelled.has(o.i)&&n<=130?`<span class="si-tl-rl${(o.i+0.5)/n>0.8?' l':''}" style="left:${left}%;bottom:${bot}%">+${o.c.rsUnits}</span>`:'');
    }).join('');
  }
  // lead-time marker: where an order placed (today - lead time) would land today
  let ltHtml='';
  if(hasStock&&lt&&lt.days>0){
    const placed=_siAxDayStr(_siAxDayNum(tl.to)-lt.days);
    let idx=-1;
    if(res==='week'){const b=_siAxBucketStart(placed,'week');idx=cols.findIndex(c=>c.d===b);}else idx=cols.findIndex(c=>c.d===placed);
    if(idx>=0){
      const left=((idx+0.5)/n*100).toFixed(2),flip=(idx+0.5)/n>0.5;
      ltHtml=`<i class="si-tl-lt" style="left:${left}%"></i><span class="si-tl-ltl${flip?' flip':''}" style="${flip?'right:'+(100-(idx+0.5)/n*100+0.8).toFixed(2):'left:'+((idx+0.5)/n*100+0.8).toFixed(2)}%">order here lands today</span>`;
    }
  }
  // sales bars
  const bars=cols.map((c,i)=>{
    if(!c.sold)return'';
    const hh=(c.sold/scD.max*100).toFixed(2);
    return`<i class="si-tl-bar${c.state==='out'&&res!=='week'?' zero':''}" style="left:${(X(i)+100/n*0.1).toFixed(3)}%;width:${(100/n*0.8).toFixed(3)}%;height:${hh}%"></i>`;
  }).join('');
  const grid=sc=>{let g='',t='';for(let i=0;i<=sc.count;i++){const p=i/sc.count*100;g+=`<i class="si-ax-grid" style="bottom:${p}%"></i>`;t+=`<span class="si-ax-tick" style="bottom:${p}%">${_siEsc(_siAxTick(sc.step*i))}</span>`;}return{g,t};};
  const gS=grid(scS),gD=grid(scD);
  const nT=Math.min(5,n),xt=[];
  for(let j=0;j<nT;j++){const i=nT===1?0:Math.round(j*(n-1)/(nT-1));xt.push({i,label:cols[i].short});}
  const xl=xt.map((t,k)=>`<span class="si-ax-xtick${xt.length>1&&k===0?' first':(k===xt.length-1&&xt.length>1?' last':'')}" style="left:${((t.i+0.5)/n*100).toFixed(2)}%">${_siEsc(t.label)}</span>`).join('');
  _siAxTlHov={n,res,cols:cols.map(c=>_siAxTlTipText(c,res))};
  const ev=`onpointermove="window._siAxTlHover(event,this)" onpointerdown="window._siAxTlHover(event,this)" onpointerleave="window._siAxTlLeave(this,event)"`;
  const stockPanel=hasStock?`<div class="si-tl-panel stock" role="img" aria-label="Stock on hand per ${res==='week'?'week':'day'}, out-of-stock stretches shaded" ${ev}>${gS.g}${bandHtml}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="si-tl-area" d="${area}"/><path class="si-tl-line" d="${line}"/></svg>${rsHtml}${ltHtml}<div class="si-ax-cursor"></div><div class="si-ax-tip"></div></div>`
    :`<div class="si-tl-panel stock none"><div class="si-tl-nostock">No stock readings for this article in this view.</div></div>`;
  const salesPanel=`<div class="si-tl-panel sales" role="img" aria-label="Units sold per ${res==='week'?'week':'day'}" ${ev}>${gD.g}${hasStock?bandHtml.replace(/<b>[^<]*<\/b>/g,''):''}${bars}<div class="si-ax-cursor"></div></div>`;
  return`<div class="si-tl-grid">
    <div class="si-tl-cap">Stock on hand (units${res==='week'?', end of week':''})</div>
    <div class="si-ax-yaxis si-tl-ya stock">${hasStock?gS.t:''}</div>${stockPanel}
    <div class="si-tl-cap">Units sold per ${res==='week'?'week':'day'}</div>
    <div class="si-ax-yaxis si-tl-ya sales">${gD.t}</div>${salesPanel}
    <div class="si-ax-xaxis si-tl-xa">${xl}</div></div>`;
}
window._siAxTlHover=function(ev,el){
  const h=_siAxTlHov;if(!h||!h.n)return;
  const r=el.getBoundingClientRect();if(!r.width)return;
  const fr=Math.min(0.999999,Math.max(0,(ev.clientX-r.left)/r.width));
  const i=Math.min(h.n-1,Math.floor(fr*h.n)),pct=(i+0.5)/h.n*100;
  const root=el.closest?el.closest('.si-tl'):null;if(!root)return;
  root.querySelectorAll('.si-ax-cursor').forEach(c=>{c.style.display='block';c.style.left=pct+'%';});
  const tip=root.querySelector('.si-tl-panel.stock .si-ax-tip')||root.querySelector('.si-ax-tip');
  if(tip){
    const t=h.cols[i];
    tip.innerHTML=`<b>${_siEsc(t.title)}</b>`+t.rows.map(x=>`<div class="r"><span>${_siEsc(x[0])}</span><strong>${_siEsc(x[1])}</strong></div>`).join('');
    tip.style.display='block';
    if(pct>55){tip.style.left='auto';tip.style.right=(100-pct+1)+'%';}else{tip.style.right='auto';tip.style.left=(pct+1)+'%';}
  }
};
window._siAxTlLeave=function(el,ev){
  if(ev&&ev.pointerType==='touch')return;
  const root=el.closest?el.closest('.si-tl'):null;if(!root)return;
  root.querySelectorAll('.si-ax-cursor').forEach(c=>{c.style.display='none';});
  root.querySelectorAll('.si-ax-tip').forEach(t=>{t.style.display='none';});
};
window._siAxTlSet=function(kind,val){
  if(kind==='res'&&(val==='day'||val==='week'))_siAxTlRes=val;
  else if(kind==='range'&&_SI_TL_RANGES.some(r=>r[0]===val))_siAxTlRange=val;
  else return;
  const a=_siAxIndex().map.get(_siAxSel),el=document.getElementById('si-tl');
  if(a&&el)el.outerHTML=_siAxTlCardHtml(a);
};
function _siAxTlRunsTable(sum){
  if(!sum.runs.length)return'';
  const f=d=>_siEsc(_siAxFmtDay(d,true));
  const rows=sum.runs.map(r=>{
    const lost=r.est?(r.est.lo===r.est.hi?'~'+Math.round(r.nWin*r.est.lo):Math.round(r.nWin*r.est.lo)+'–'+Math.round(r.nWin*r.est.hi)):'—';
    return`<tr><td>${f(r.from)}${r.leftCensored?' <span class="si-ax-flag" title="Began before the stock history starts or at a gap, so the true start is unknown">or earlier</span>':''}</td><td>${r.open?'still out':f(r.to)}</td><td>${r.days}${r.nWin<r.days?` <span class="si-ax-note" style="display:inline;margin:0">(${r.nWin} in this view)</span>`:''}</td><td>${r.sold}</td><td>${_siEsc(lost)}${r.est?'':` <span class="si-ax-flag" title="${_siEsc(r.why)}">not estimated</span>`}</td><td>${sum.lt?f(_siAxDayStr(_siAxDayNum(r.from)-sum.lt.days)):'—'}</td></tr>`;
  }).join('');
  return`<div class="si-tl-tbl"><table class="cut-table"><thead><tr><th>Out from</th><th>Back on</th><th>Days out</th><th>Sold at zero stock</th><th>Est. lost units</th><th>Order by${sum.lt?' ('+sum.lt.days+' d lead)':''}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function _siAxTlDataTable(tl,res,range){
  const cols=_siAxTlColumns(tl,res,range);
  if(!cols.length)return'';
  const rows=cols.slice().reverse().map(c=>`<tr><td>${_siEsc(res==='week'?c.label:c.label)}</td><td>${c.stock==null?'—':c.stock}</td><td>${c.sold}</td><td>${c.state==='out'?(res==='week'?'out '+c.outDays+' of '+c.measured+' d':'out of stock'):(c.state==='in'?(res==='week'&&c.outDays?'in stock, out '+c.outDays+' d':'in stock'):'no data')}${c.rsUnits?' · restock +'+c.rsUnits+' (inferred)':''}</td></tr>`).join('');
  return`<details class="si-tl-data"><summary>Table of the numbers in this chart</summary><div class="si-tl-tbl" style="max-height:300px;overflow:auto"><table class="cut-table"><thead><tr><th>${res==='week'?'Week':'Day'}</th><th>Stock (close)</th><th>Sold</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
function _siAxTlCardHtml(a){
  const idx=_siAxIndex(),H=_siHist&&_siHist.byCode?_siHist:null;
  const cov=idx.cov||'';
  const lt=_siAxLeadTime(a);
  const tl=_siAxTimeline(a,H,{from:cov||(H&&H.from)||'',to:_siPktDate(0)});
  const res=_siAxTlRes,range=_siAxTlRange;
  const btn=(kind,v,l,cur)=>`<button class="si-ax-btn${cur===v?' on':''}" aria-pressed="${cur===v}" onclick="window._siAxTlSet('${kind}','${v}')">${_siEsc(l)}</button>`;
  const bar=`<div class="si-ax-bar si-tl-bar2">${btn('res','day','Day',res)}${btn('res','week','Week',res)}<span class="si-tl-sep"></span>${_SI_TL_RANGES.map(r=>btn('range',r[0],r[1],range)).join('')}</div>`;
  if(!tl.ok)return`<div class="card si-tl" id="si-tl"><div class="card-title">Stock vs sales</div><div class="si-ax-empty">No days to draw yet.</div></div>`;
  const sum=_siAxTlSummary(tl,range,lt);
  const state=_siHistState;
  const pre=(state==='loading'||state==='idle')?`<div class="si-ax-note" role="status">Stock history is still loading, so only sales are drawn for now.</div>`:(state==='error'?`<div class="si-ax-note" role="alert" style="color:var(--accent-urgent);font-weight:600">Stock history could not be read, so only sales are drawn. <button class="si-ax-btn" onclick="window._siAxRetryHistory()">Retry</button></div>`:'');
  const read=_siAxTlReadout(sum,tl.hasStock).map(t=>`<li>${_siEsc(t)}</li>`).join('');
  const cap=_siAxTlCoverage(tl,H,cov,range).map(t=>`<div>${_siEsc(t)}</div>`).join('');
  const legend=`<div class="si-tl-legend"><span><i class="k stock"></i>Stock on hand</span><span><i class="k out"></i>Out of stock</span><span><i class="k bar"></i>Units sold</span><span><i class="k zero"></i>Sold at zero stock</span><span><i class="k rs"></i>Restock (inferred; hollow = small)</span><span><i class="k lt"></i>Lead time</span></div>`;
  return`<div class="card si-tl" id="si-tl"><div class="card-title">Stock vs sales</div>${bar}${pre}
    <ul class="si-tl-read">${read}</ul>${legend}${_siAxTlChartHtml(tl,res,range,lt)}
    ${_siAxTlRunsTable(sum)}${_siAxTlDataTable(tl,res,range)}
    <div class="si-ax-note si-tl-cov">${cap}</div></div>`;
}

// ── Sizes card (one article): the size panel ────────────────────────
// Per size: stock now and a week ago, units sold (28 days, counted window), the size's share of the article's SALES (the sales
// curve) against its share of the article's STOCK (the stock curve), weeks of cover at the size's 28-day pace and a status chip.
// Rows come from _siAxStats(a).sizeRows and the states from _siNaSizeRows, so this card and the Needs Attention tab agree. No read.
// Per-size stock HISTORY is not loaded (history is per article), so there is no per-size in-stock pace: cover uses the 28-day pace of
// the size and is "at most" when the size was out for part of the window. Missing is never 0 ("—").
const _SI_SZ={shrinkK:6,floor:0.03,floorMinSold:3,minTotal:30,gapShare:0.10,overMinStock:8,overMix:2,overCoverWeeks:12};
const _SI_SZ_CHIPS={out:{l:'Out and selling',g:'▲'},thin:{l:'Thin',g:'▼'},fine:{l:'Fine',g:'●'},over:{l:'Over-stocked vs demand',g:'■'},none:{l:'No sales',g:'○'},nodata:{l:'No stock data',g:'–'}};
function _siAxSizeJoin(a){return a.length<=1?(a[0]||''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];}
// shares (sum 1) -> integers summing to `total` by largest remainder (ties: earlier index)
function _siAxRoundShares(sh,total){
  const raw=sh.map(x=>Math.max(0,x)*total),fl=raw.map(Math.floor);let left=total-fl.reduce((s,v)=>s+v,0);
  raw.map((v,i)=>[v-fl[i],i]).sort((p,q)=>(q[0]-p[0])||(p[1]-q[1])).forEach(p=>{if(left>0){fl[p[1]]++;left--;}});
  return fl;
}
// The sales curve: last 28 days blended with lifetime. A size with few recent units leans on its lifetime share
// (weight recent/(recent+K), K=6), then the blend is renormalised to 100%. null with no sales at all.
function _siAxSizeCurve(rows){
  const L=rows.reduce((s,r)=>s+(r.sold||0),0),R=rows.reduce((s,r)=>s+(r.recent||0),0);
  if(L<=0&&R<=0)return null;
  const K=_SI_SZ.shrinkK;
  const raw=rows.map(r=>{
    const l=L>0?(r.sold||0)/L:0,rc=R>0?(r.recent||0)/R:0,w=R>0?(r.recent||0)/((r.recent||0)+K):0;
    return L>0?w*rc+(1-w)*l:rc;
  });
  const t=raw.reduce((s,v)=>s+v,0);
  return{shares:raw.map(v=>t>0?v/t:0),basis:R>0?'last 28 days blended with lifetime':'lifetime'};
}
// Size chips from the Needs Attention size states, plus the stock-mix rule and "No sales".
function _siAxSizeStatus(r,st,salesShare,stockShare){
  if(r.stock==null)return'nodata';
  if(st==='out')return'out';
  if(!(r.recent>0))return'none';                       // out or in stock, nothing sold in 28 days
  if(st==='thin')return'thin';
  if(st==='deep')return'over';
  const cw=r.coverDays!=null?r.coverDays/7:null;
  if(r.stock>=_SI_SZ.overMinStock&&salesShare!=null&&stockShare!=null&&stockShare>=_SI_SZ.overMix*salesShare&&cw!=null&&cw>_SI_SZ.overCoverWeeks)return'over';
  return'fine';
}
// Pure: sizeRows (+ the Needs Attention states) -> table rows, curves, the readout and the status of every size.
function _siAxSizePanelCalc(sizeRows,naRows,leadDays){
  const na={};(naRows||[]).forEach(x=>{na[x.size]=x;});
  const rows=(sizeRows||[]).filter(s=>s.stock!=null||s.sold>0).sort((x,y)=>_siSortCmpSize(x.size,y.size));
  const sc=_siAxSizeCurve(rows);
  const stockTot=rows.reduce((s,r)=>s+(r.stock||0),0),hasStock=rows.some(r=>r.stock!=null);
  const out=rows.map((r,i)=>{
    const n=na[r.size]||{};
    const salesShare=sc?sc.shares[i]:null,stockShare=(hasStock&&stockTot>0&&r.stock!=null)?r.stock/stockTot:null;
    const key=_siAxSizeStatus({stock:r.stock,recent:r.recent,coverDays:n.coverDays},n.state,salesShare,stockShare);
    return{size:r.size,stock:r.stock,prev:r.prev,recent:r.recent,sold:r.sold,coverWeeks:n.coverDays!=null?n.coverDays/7:null,salesShare,stockShare,key,label:_SI_SZ_CHIPS[key].l,glyph:_SI_SZ_CHIPS[key].g};
  });
  return{rows:out,basis:sc?sc.basis:null,hasStock,stockTot,readout:_siAxSizeReadout(out,hasStock,stockTot)};
}
// One sentence: the sizes that carry far more of the sales than of the stock, and the sizes sitting on far more stock than sales.
function _siAxSizeReadout(rows,hasStock,stockTot){
  if(rows.length<2||(rows.length===2&&rows.every(r=>/^unknown$/i.test(r.size))))return'Only one size is recorded for this article, so there is no size mix to compare.';
  if(!rows.some(r=>r.salesShare!=null))return'No sales are counted for this article, so there is no sales curve yet.';
  if(!hasStock)return'There is no stock data for this article, so only the sales curve is shown.';
  if(!(stockTot>0))return'Nothing is in stock, so there is no stock mix to compare with the sales mix.';
  const G=_SI_SZ.gapShare,pct=v=>Math.round(v*100)+'%';
  const under=rows.filter(r=>r.salesShare!=null&&r.stockShare!=null&&r.salesShare-r.stockShare>=G);
  const over=rows.filter(r=>r.salesShare!=null&&r.stockShare!=null&&r.stockShare-r.salesShare>=G);
  const sum=(a,k)=>a.reduce((s,r)=>s+r[k],0),part=[];
  if(under.length)part.push(_siAxSizeJoin(under.map(r=>r.size))+(under.length>1?' carry ':' carries ')+pct(sum(under,'salesShare'))+' of sales but only '+pct(sum(under,'stockShare'))+' of stock');
  if(over.length)part.push(_siAxSizeJoin(over.map(r=>r.size))+(over.length>1?' are ':' is ')+pct(sum(over,'stockShare'))+' of stock and '+pct(sum(over,'salesShare'))+' of sales');
  if(!part.length){const g=Math.max(...rows.filter(r=>r.salesShare!=null&&r.stockShare!=null).map(r=>Math.abs(r.salesShare-r.stockShare)));return'The stock mix is close to the sales mix (no size is more than '+Math.round(G*100)+' points off; the largest gap is '+Math.round(g*100)+' points).';}
  const s=part.join('; ');return s.charAt(0).toUpperCase()+s.slice(1)+'.';
}
// Suggested size split of the NEXT batch, proportional to the sales curve (real sizes only). A size that sold 3+ units gets at
// least 3%; a size with no sales gets 0. Refused under 30 counted units or with fewer than two sizes that sold. Percent and units
// both sum exactly (largest remainder). total (units) is optional: the Explorer's reorder guide, never invented here.
function _siAxSizeSplit(sizeRows,total){
  const el=(sizeRows||[]).filter(s=>!/^unknown$/i.test(s.size)&&(s.sold||0)>0).sort((x,y)=>_siSortCmpSize(x.size,y.size));
  const L=el.reduce((s,r)=>s+r.sold,0);
  if(el.length<2)return{ok:false,why:'Fewer than two sizes have sold, so there is no size split to suggest.'};
  if(L<_SI_SZ.minTotal)return{ok:false,why:'Only '+L+' units are counted for this article (the split needs '+_SI_SZ.minTotal+'+), so a split would be guesswork.'};
  let sh=_siAxSizeCurve(el).shares;
  const floored=new Array(el.length).fill(false);
  for(let it=0;it<6;it++){
    let fl=0;const need=[];
    el.forEach((r,i)=>{if(r.sold>=_SI_SZ.floorMinSold&&(floored[i]||sh[i]<_SI_SZ.floor)){floored[i]=true;fl++;}});
    const rest=1-fl*_SI_SZ.floor,other=sh.reduce((s,v,i)=>s+(floored[i]?0:v),0);
    const nx=sh.map((v,i)=>floored[i]?_SI_SZ.floor:(other>0?v/other*rest:0));
    const same=nx.every((v,i)=>Math.abs(v-sh[i])<1e-12);sh=nx;if(same)break;
  }
  const pct=_siAxRoundShares(sh,100),units=(total!=null&&total>0)?_siAxRoundShares(sh,total):null;
  return{ok:true,rows:el.map((r,i)=>({size:r.size,share:sh[i],pct:pct[i],units:units?units[i]:null})),total:total!=null&&total>0?total:null,sold:L};
}
function _siAxSizeGuide(a,m){
  const lt=_siAxLeadTime(a),c=_siAxClassify(a),act=_siAxActionOf(a);
  const pd=_siNaPerDay(m),qty=a.hasStock&&pd!=null?_siNaQty(pd,lt.days,a.onHand,c.cls):null;
  return{qty,lt,cls:c.cls,act};
}
function _siAxSizesCardHtml(a){
  const m=_siAxStats(a),g=_siAxSizeGuide(a,m);
  const calc=_siAxSizePanelCalc(m.sizeRows,_siNaSizeRows(m,g.lt.days),g.lt.days);
  if(!calc.rows.length)return`<div class="card si-sz" id="si-sz"><div class="card-title">Sizes</div><div class="si-ax-empty">No sizes are recorded for this article yet.</div></div>`;
  const mx=Math.max(0.0001,...calc.rows.map(r=>Math.max(r.salesShare||0,r.stockShare||0)));
  const p=v=>v==null?'—':Math.round(v*100)+'%';
  const bar=(cls,v)=>`<span class="si-sz-line"><span class="si-sz-bar ${cls}" aria-hidden="true"><i style="width:${v==null?0:(v/mx*100).toFixed(1)}%"></i></span><span class="si-sz-n">${cls==='s'?'sales ':'stock '}${p(v)}</span></span>`;
  const body=calc.rows.map(r=>`<tr><td class="si-sz-h"><b>${_siEsc(r.size)}</b></td><td data-l="On hand">${r.stock!=null?r.stock:'—'}</td><td data-l="A week ago">${r.prev!=null?r.prev:'—'}</td><td data-l="Sold 28 d">${r.recent}</td><td data-l="Sold (counted)">${r.sold}</td>
    <td class="si-sz-mix" data-l="Sales vs stock share">${bar('s',r.salesShare)}${bar('k',r.stockShare)}</td>
    <td data-l="Cover">${r.coverWeeks==null?'—':_siEsc(_siAxNum(r.coverWeeks,1))+' wk'}</td>
    <td data-l="Status"><span class="si-sz-chip ${r.key}"><i aria-hidden="true">${r.glyph}</i>${_siEsc(r.label)}</span></td></tr>`).join('');
  const table=`<div class="si-sz-wrap"><table class="cut-table si-sz-tbl"><thead><tr><th>Size</th><th>On hand</th><th>A week ago</th><th>Sold 28 d</th><th>Sold (counted)</th><th>Sales vs stock share</th><th title="on hand ÷ the size's 28-day weekly pace">Cover</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>`;
  const legend=`<div class="si-tl-legend"><span><i class="k szs"></i>Sales curve${calc.basis?' ('+_siEsc(calc.basis)+')':''}</span><span><i class="k szk"></i>Stock curve (today)</span></div>`;
  const sp=_siAxSizeSplit(m.sizeRows,g.qty?g.qty.hi:null);
  let split;
  if(!sp.ok)split=`<div class="si-sz-split"><div class="si-sz-sh">Suggested split for the next batch</div><div class="si-ax-note">${_siEsc(sp.why)}</div></div>`;
  else{
    const items=sp.rows.map(r=>`<span class="si-sz-sp"><b>${_siEsc(r.size)}</b> ${r.pct}%${r.units!=null?' · '+r.units+' units':''}</span>`).join('');
    const tot=sp.total?`Reorder guide for the whole batch: ${g.qty.lo}–${g.qty.hi} units (this article's Needs Attention figure: demand over the lead time plus ${g.qty.target} days of cover, rounded up to a pack of 12). The units above split the high end, ${g.qty.hi}.`:'Set the total in your PO: no reorder size guide applies to this article right now.';
    const warn=(g.act&&(g.act.key==='stuck'||g.act.key==='hold'||g.act.key==='markdown'))?` The verdict above says do not reorder now (${_siEsc(g.act.label)}); this split only matters if you do cut it.`:'';
    split=`<div class="si-sz-split"><div class="si-sz-sh">Suggested split for the next batch <span class="si-sz-tag">suggestion, not an order</span></div><div class="si-sz-sps">${items}</div>
      <div class="si-ax-note">${_siEsc(tot)}${warn}</div>
      <div class="si-ax-note">How it is worked out: each size's share of the sales curve (last 28 days blended with lifetime; a size with few recent units leans on its lifetime share), at least ${Math.round(_SI_SZ.floor*100)}% for a size that sold ${_SI_SZ.floorMinSold}+ units, none for a size that sold nothing. Stock on hand is not netted off. Sizes that are out are probably under-counted, because nothing can be sold at zero stock. Based on ${sp.sold} counted units.</div></div>`;
  }
  return`<div class="card si-sz" id="si-sz"><div class="card-title">Sizes</div><div class="si-sz-read" role="status">${_siEsc(calc.readout)}</div>${legend}${table}${split}
    <div class="si-ax-note">Status: Out and selling = none left, sold in the last 28 days. Thin = under ${_SI_NA.sizeThinDays} days of cover with ${_SI_NA.sizeThinUnits}+ units sold in 28 days (the same rule as Needs Attention). Over-stocked vs demand = more than ${_SI_NA.overCoverWeeks} weeks of cover, or ${_SI_SZ.overMix}× its sales share in stock with ${_SI_SZ.overMinStock}+ units and over ${_SI_SZ.overCoverWeeks} weeks of cover. Cover is on hand ÷ the size's 28-day weekly pace (the stock history is per article, so a size's own in-stock pace is not known: cover is an at-most figure for a size that was out part of the window). Returns are not synced, so sales run a little high. Colour is not split: an article here is one colour.</div></div>`;
}

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
  const sizeTable=_siSortTable('ax-sizes',[
    {key:'s',label:'Size',type:'size',get:r=>r.size,cell:r=>`<td>${_siEsc(r.size)}${r.risk?' <span class="si-ax-flag" title="Out of stock now, sold in the last 28 days">at risk</span>':''}</td>`},
    {key:'sold',label:'Sold (counted)',type:'num',get:r=>r.sold,cell:r=>`<td>${r.sold}</td>`},
    {key:'oh',label:'On hand',type:'num',get:r=>r.stock,cell:r=>`<td>${r.stock!=null?r.stock:'—'}</td>`},
    {key:'prev',label:'A week ago',type:'num',get:r=>r.prev,cell:r=>`<td>${r.prev!=null?r.prev:'—'}</td>`},
    {key:'st',label:'Sell-through',title:'sold ÷ (sold + on hand)',type:'num',get:r=>r.sellThrough,cell:r=>`<td>${_siAxPct(r.sellThrough)}</td>`}
  ],m.sizeRows,{def:{key:'s',dir:1},defText:'garment order: XXXS → XXXL, then waist sizes, then others'});
  // weekly close
  const closes=_siWeeklyCloses.filter(wc=>wc.top_sku&&_siAxCode(wc.top_sku.sku)===a.code);
  const closeHtml=closes.length?_siSortTable('ax-closes',[
    {key:'w',label:'Week ending',type:'date',first:'desc',get:wc=>String(wc.week_ending||'').slice(0,10),cell:wc=>`<td>${_siEsc(wc.week_ending)}</td>`},
    {key:'sku',label:'Top SKU',type:'code',get:wc=>wc.top_sku.sku,cell:wc=>`<td>${_siEsc(wc.top_sku.sku)}</td>`},
    {key:'q',label:'Units',type:'num',get:wc=>Number(wc.top_sku.quantity),cell:wc=>`<td>${_siEsc(wc.top_sku.quantity)}</td>`}
  ],closes,{def:{key:'w',dir:-1},defText:'newest first'})
    :`<div class="si-ax-note">No weekly close lists this article as its top SKU. (A weekly close stores only its top SKU, top category and category totals, so nothing more per article exists to show.)</div>`;
  // per-bucket table
  const bk=_siAxBuckets(a,_siAxBucket);
  const rows=[...bk.entries()];
  const bucketTable=rows.length?`<div style="max-height:320px;overflow:auto">`+_siSortTable('ax-bucket-'+_siAxBucket,[
    {key:'b',label:_siAxBucket==='month'?'Month':'Week starting',type:'date',first:'desc',get:r=>r[0],cell:r=>`<td>${_siEsc(_siAxFmtBucket(r[0],_siAxBucket,false))}</td>`},
    {key:'u',label:'Units',type:'num',get:r=>r[1].u,cell:r=>`<td>${r[1].u}</td>`},
    {key:'r',label:'Revenue',type:'num',get:r=>a.hasPrice?r[1].r:null,cell:r=>`<td>${a.hasPrice?_siEsc(_siPKR(Math.round(r[1].r))):'—'}</td>`}
  ],rows,{def:{key:'b',dir:-1},defText:'newest first',ties:[{get:r=>r[1].u,type:'num',dir:-1}]})+`</div>`:'';
  const cat=_siEsc(a.category||'no category');
  const vc=_siAxClassify(a),va=_siAxActionOf(a),vconf=_siAxConfidence(a);
  const verdictHtml=`<div class="card si-verdict act-${va.key}"><div class="si-vd-top"><span class="si-vd-act">${_siEsc(va.label)}</span><span class="si-pc-chip cls-${vc.cls}"><i class="si-pc-key cls-${vc.cls}"></i>${_siEsc(vc.label)}</span>${_siAxConfChip(vconf)}</div>
    <div class="si-vd-text">${_siEsc(va.text)}</div>
    <div class="si-vd-lt">${_siAxLtCtlHtml(a)}</div>
    <div class="si-ax-note" style="margin:4px 0 0">${_siEsc(vc.rule)}${vc.near?' '+_siEsc(vc.near):''}${vc.unverified?' (partly unverified)':''}</div></div>`;
  return`<div class="card"><div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:1 1 220px;min-width:0;display:flex;gap:12px;align-items:center">${_siAxThumb(a.code,64,a.name)}<div style="min-width:0"><div style="font-size:18px;font-weight:700">${_siEsc(a.name)}</div><div class="si-ax-note" style="margin:2px 0 0">${_siEsc(a.color||'—')} · ${_siEsc(a.code)} · ${cat} · ${a.skus.size} SKU${a.skus.size===1?'':'s'}</div></div></div>
    <button class="si-ax-btn${_siAxHintOn()?' si-ax-hint':''}" data-code="${_siEsc(a.code)}" onclick="window._siAxOvCompare(this.dataset.code)">+ Compare</button><button class="si-ax-btn" onclick="window._siAxSetMode('overview')">Overview</button><button class="si-ax-btn" onclick="window._siAxClear()">Pick another</button>${_siIgBtnHtml(a.code)}</div>${_siIgnored(a.code)?`<div style="flex-basis:100%">${_siIgChipHtml(a.code)}</div>`:''}</div>
  ${verdictHtml}
  <div class="si-ax-kpis si-ax-head6">${kpi('Units per week',_siAxNum(m.paceHead),m.paceHead!=null?(m.paceHeadBasis==='in stock'?'while in stock — sold out '+m.outDays+' of '+m.measured+' days, so real demand is higher (plain rate '+_siAxNum(m.rateWeek)+')':_siEsc(win)):'needs 7+ counted days','rate')}
    ${kpi('Stock lasts',_siEsc(_siAxCoverText(m)),m.cover!=null?_siEsc(_siAxCoverNote(m)):(!a.hasStock?'no stock data':'no pace to divide by'),'cover')}
    ${kpi('On hand',a.hasStock?a.onHand:'—',a.hasStock?'today\'s snapshot':'not in snapshot')}
    ${kpi('In-stock rate',_siAxPct(m.inRate),m.inRate!=null?m.inDays+' of '+m.measured+' measured days in stock':_siEsc(why),'inrate')}
    ${kpi('Momentum',_siEsc(_siAxMomText(m)),m.momWord&&m.momentum!=null?(m.momentum>=0?'up ':'down ')+_siAxPct(Math.abs(m.momentum))+' · last 28 d vs the 28 d before':'last 28 d vs the 28 d before','mom')}
    ${kpi('Sold 7d / 30d / 90d',s7.u+' / '+s30.u+' / '+s90.u,'')}</div>
  ${_siAxCoverage([a])}${_siAxHistBanner()}
  ${_siAxTlCardHtml(a)}
  ${_siAxSizesCardHtml(a)}
  <div class="card"><div class="card-title">Sales over time</div>
    <div class="si-ax-bar">${toggle}</div>${chart}
    <div class="si-ax-note">Latest ${_siAxBucket} is still running. ${_siEsc(ser.notes.join(' '))}</div></div>
  <div class="card"><div class="card-title">Size mix (units sold) and stock</div>${mix}
    <div style="margin-top:8px">${sizeTable}</div>
    <div class="si-ax-note" style="margin-top:8px">${_siAxNeedsHistoryNote()}</div></div>
  <details class="card si-ax-defs"><summary class="card-title" style="cursor:pointer">Why this verdict</summary>
  ${_siAxScorecardHtml([a])}
  ${_siAxReadBlock([a])}</details>
  <details class="card si-ax-defs"><summary class="card-title" style="cursor:pointer">All measures for this article</summary>
  <div class="si-ax-kpis">
    ${kpi('Live',_siEsc(_siAxLiveText(a)),_siEsc(_siAxAgeText(a)))}
    ${kpi('Sold since live',a.units,'counted from '+_siEsc(idx.cov?_siAxFmtDay(idx.cov):'—'))}
    ${kpi('Sold 7d / 30d / 90d',s7.u+' / '+s30.u+' / '+s90.u,'')}
    ${kpi('Voided units',m.voided!=null?m.voided:'—',m.voidRate!=null?'void rate '+_siAxPct(m.voidRate)+' of '+(m.units+m.voided+m.refunded)+' ordered':'no counted days','void')}
    ${kpi('Refunded units',m.refunded!=null?m.refunded:'—',m.refundRate!=null?'refund rate '+_siAxPct(m.refundRate)+' · later refunds not synced':'no counted days','refund')}
    ${kpi('Revenue (counted)',a.hasPrice?_siEsc(_siPKR(Math.round(a.rev))):'—','30d: '+(a.hasPrice?_siEsc(_siPKR(Math.round(s30.r))):'—'))}
    ${kpi('On hand',a.hasStock?a.onHand:'—',a.hasStock?'today\'s snapshot':'not in snapshot')}
    ${kpi('Units per week',_siAxNum(m.paceHead),m.paceHead!=null?(m.paceHeadBasis==='in stock'?'while in stock — sold out '+m.outDays+' of '+m.measured+' days, so real demand is higher (plain rate '+_siAxNum(m.rateWeek)+')':_siEsc(win)):'needs 7+ counted days','rate')}
    ${kpi('Sell-through %',m.st?_siAxPct(m.st.value):'—',m.st?'sold '+m.st.sold+' of '+(m.st.sold+m.st.closing)+' (sold + '+m.st.closing+' left) · '+_siEsc(_siAxFmtDay(m.st.from,true))+' to '+_siEsc(_siAxFmtDay(m.st.to,true))+(m.st.src==='two snapshots'?' (two snapshots)':''):_siEsc(why),'st')}
    ${kpi('In-stock rate',_siAxPct(m.inRate),m.inRate!=null?m.inDays+' of '+m.measured+' measured days in stock':_siEsc(why),'inrate')}
    ${kpi('Units per in-stock day',_siAxNum(m.perInDay,2),m.perInDay!=null?'vs '+_siAxNum(m.rateWeek!=null?m.rateWeek/7:null,2)+' per live day':_siEsc(why),'perday')}
    ${kpi('Stock-out days',m.outDays!=null?m.outDays:'—',m.outDays!=null?'of '+m.measured+' measured days':_siEsc(why),'out')}
    ${kpi('Stock lasts',_siEsc(_siAxCoverText(m)),m.cover!=null?_siEsc(_siAxCoverNote(m)):(!a.hasStock?'no stock data':'no pace to divide by'),'cover')}
    ${kpi('Momentum',_siEsc(_siAxMomText(m)),m.momWord&&m.momentum!=null?(m.momentum>=0?'up ':'down ')+_siAxPct(Math.abs(m.momentum))+' · last 28 d vs the 28 d before':'last 28 d vs the 28 d before','mom')}
    ${kpi('Share of category',_siAxPct(m.catShare28),a.category?'of '+_siEsc(a.category)+' units, last 28 days (all time '+_siAxPct(m.catShare)+')':'no category','share')}
    ${kpi('First 4 weeks',m.first4!=null?m.first4:'—',m.first4!=null?'units, first 28 days live':'launch not in counted data','first4')}
    ${kpi('Last 28 days / week',_siAxNum(m.pace28),m.pace28!=null?'last '+m.pace28Days+' counted days':'needs 7+ counted days','pace')}
    ${kpi('Received (est.)',m.received!=null?'~'+m.received:'—',m.st?'inferred over the same span':_siEsc(why),'recv')}
    ${kpi('Sizes in stock',m.sizesNow?m.sizesNow.n+' of '+m.sizesNow.of:'—',m.sizesPrev?'a week ago: '+m.sizesPrev.n+' of '+m.sizesPrev.of:'','avl')}
    ${kpi('Lost-sales risk',m.risk.length?m.risk.length+' size'+(m.risk.length===1?'':'s'):(a.hasStock?'none':'—'),m.risk.length?_siEsc(m.risk.map(r=>r.size+' ('+r.units+' sold 28d)').join(', ')):(a.hasStock?'no out-of-stock size sold in 28 d':'no stock data'),'risk')}
    ${kpi('Selling weeks',m.sellingWeeks!=null?m.sellingWeeks+' of '+m.blocks:'—',m.sellingWeeks!=null?'7-day blocks with a sale':'needs 2+ complete weeks','sell')}
    ${kpi('Peak week',m.peak?m.peak.u+' units':'—',m.peak?'week of '+_siEsc(_siAxFmtDay(m.peak.start)):'','peak')}
    ${kpi('Average unit price',m.asp!=null?_siEsc(_siPKR(Math.round(m.asp))):'—','before discounts','asp')}
  </div>
  <div class="card-title" style="margin-top:8px">Units per ${_siAxBucket}</div>${bucketTable}</details>
  ${_siAxDefsHtml()}
  <details class="card si-ax-defs"><summary class="card-title" style="cursor:pointer">Weekly close</summary>${closeHtml}</details>`;
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
  const cal=_siAxBasis==='calendar';
  const ser=_siAxSeries(arts,_siAxMetric,_siAxBasis,cal?{win:_siAxWinObj(),prev:_siAxPrev}:{});
  ser.series.forEach((s,i)=>{s.name=_siAxLabel(arts[i]);});
  // What the chart draws: each line, then (calendar only) its previous-year twin in the same colour.
  // A twin with no data is NOT drawn and NOT zero-filled; it is listed in noPrev instead.
  const chartSeries=ser.series.slice(),noPrev=[];
  if(ser.prev)ser.prev.forEach((p,i)=>{
    if(p.any)chartSeries.push({code:p.code,values:p.values,name:_siAxLabel(arts[i])+' — previous year',prev:true,ci:i});
    else noPrev.push(_siAxLabel(arts[i]));
  });
  const M=ser.metricDef;
  const rows=arts.map((a,i)=>{
    const vals=ser.series[i].values;let total=0,peak=null,peakAt=-1,latest=null;
    vals.forEach((v,k)=>{if(v==null)return;if(!M.cum&&!M.kind)total+=v;if(peak===null||v>peak){peak=v;peakAt=k;}latest=v;});
    if(M.cum){for(let k=vals.length-1;k>=0;k--)if(vals[k]!=null){total=vals[k];break;}}
    if(M.kind)total=latest;
    return{i,art:a,total,peak,peakLabel:peakAt>=0?ser.xLabels[peakAt]:'',u7:_siAxUnitsSince(a,7).u,u30:_siAxUnitsSince(a,30).u,m:_siAxStats(a)};
  });
  return{arts,ser,rows,M,chartSeries,noPrev};
}
// ── Calendar window: all data / a winter (Oct–Feb) / month by month ──────────
function _siAxLatestWinter(){return _siAxWinterOf(_siPktDate(0));}
function _siAxWinYearNow(){
  const latest=_siAxLatestWinter(),first=Math.min(latest,_siAxWinterOf(_siAxIndex().cov||_siPktDate(0)));
  const y=_siAxWinYear==null?latest:_siAxWinYear;
  return Math.max(first,Math.min(latest,y));
}
function _siAxWinObj(){return _siAxWin==='winter'?_siAxWinterWindow(_siAxWinYearNow()):null;}
window._siAxSetWin=function(w){_siAxWin=(w==='winter'||w==='months')?w:'all';_siAxRepaintBody();};
window._siAxWinStep=function(d){
  const latest=_siAxLatestWinter(),first=Math.min(latest,_siAxWinterOf(_siAxIndex().cov||_siPktDate(0)));
  _siAxWinYear=Math.max(first,Math.min(latest,_siAxWinYearNow()+(d<0?-1:1)));
  _siAxRepaintBody();
};
window._siAxMonStep=function(d){const l=_siAxMonthList();_siAxMonShift=Math.max(0,Math.min(l.maxShift,l.shift+(d<0?1:-1)));_siAxRepaintBody();};
window._siAxTogglePrev=function(){_siAxPrev=!_siAxPrev;_siAxRepaintBody();};
// The year-earlier line first exists a year after the synced data begins.
function _siAxPrevNote(d){
  if(!_siAxPrev||_siAxBasis!=='calendar')return'';
  const cov=_siAxIndex().cov;
  const why='synced orders start '+_siEsc(cov?_siAxFmtDay(cov):'—')+(cov?', so a year-earlier line can first exist from '+_siEsc(_siAxFmtDay(_siAxAddYears(cov,1))):'');
  if(d.noPrev.length===d.arts.length)return`<div class="si-ax-note" data-prev-note="all">Previous year: no data a year earlier for the period shown — ${why}. Nothing is drawn (never zero).</div>`;
  if(d.noPrev.length)return`<div class="si-ax-note" data-prev-note="some">Previous year: no data a year earlier for ${d.noPrev.map(_siEsc).join(', ')} (${why}).</div>`;
  return'';
}
function _siAxCalOptsHtml(){
  const b=(id,l)=>`<button class="si-ax-btn${_siAxWin===id?' on':''}" aria-pressed="${_siAxWin===id}" onclick="window._siAxSetWin('${id}')">${l}</button>`;
  const nav=_siAxWin==='all'?'':_siAxWin==='months'?(()=>{const l=_siAxMonthList();if(l.total<=_SI_AX_MONTHS_MAX)return'';const a=_siAxFmtBucket(l.months[0],'month',false),z=_siAxFmtBucket(l.months[l.months.length-1],'month',false);return`<span class="si-ax-lab" style="margin-left:8px">Months</span><button class="si-ax-btn" aria-label="Earlier months" ${l.hasOlder?'':'disabled '}onclick="window._siAxMonStep(-1)">‹</button><span class="si-ax-lab" style="color:var(--text)">${_siEsc(a)} – ${_siEsc(z)}</span><button class="si-ax-btn" aria-label="Later months" ${l.hasNewer?'':'disabled '}onclick="window._siAxMonStep(1)">›</button>`;})():(()=>{const w=_siAxWinterWindow(_siAxWinYearNow());return`<span class="si-ax-lab" style="margin-left:8px">Which winter</span><button class="si-ax-btn" aria-label="Earlier winter" onclick="window._siAxWinStep(-1)">‹</button><span class="si-ax-lab" style="color:var(--text)">${_siEsc(w.label)}</span><button class="si-ax-btn" aria-label="Later winter" onclick="window._siAxWinStep(1)">›</button>`;})();
  return`<div class="si-ax-bar" id="si-ax-calopts"><span class="si-ax-lab">Window</span>${b('all','All data')}${b('winter','Winter (Oct–Feb)')}${b('months','Month by month')}${nav}
    <button class="si-ax-btn${_siAxPrev?' on':''}" aria-pressed="${_siAxPrev}" style="margin-left:8px" onclick="window._siAxTogglePrev()">Compare with previous year</button></div>`;
}
// Month by month: a ROLLING window that ENDS at the current month and reaches back to the month of the first synced
// order, at most twelve tiles (the latest twelve; the stepper goes further back). No future month is ever drawn, and a
// month before the synced data is not drawn at all. Frost stays on Oct..Feb wherever they fall.
// Value = the month's total for the chosen metric family (revenue for revenue metrics, units otherwise).
// A month before the article was live is "no data" — never 0.
function _siAxMonthList(){
  const today=_siPktDate(0),last=today.slice(0,7)+'-01',cov=_siAxIndex().cov||today;
  const first=cov.slice(0,7)+'-01';
  const all=[];
  for(let k=0;k<400;k++){const m=_siAxAddMonths(first,k);if(m>last)break;all.push(m);}
  if(!all.length)all.push(last);
  const maxShift=Math.max(0,all.length-_SI_AX_MONTHS_MAX);
  const shift=Math.max(0,Math.min(maxShift,_siAxMonShift||0));
  const endIdx=all.length-1-shift,startIdx=Math.max(0,endIdx-(_SI_AX_MONTHS_MAX-1));
  return{months:all.slice(startIdx,endIdx+1),total:all.length,shift,maxShift,hasOlder:startIdx>0,hasNewer:shift>0};
}
function _siAxMonthTiles(arts,M){
  const cov=_siAxIndex().cov||'',today=_siPktDate(0),field=(M.kind||M.cum||M.pct)?'u':M.field;
  const out=[],ml=_siAxMonthList();
  for(const start of ml.months){
    const end=_siAxBucketEnd(start,'month'),mm=+start.slice(5,7);
    const cells=arts.map(a=>{
      const L=_siAxLiveDay(a)||a.firstDay||'';
      const one=(st,en,needFull)=>{
        if(!L||en<L)return null;                      // not live yet
        if(en<cov||(needFull&&st<cov))return null;    // before the synced data (a year-earlier month must lie wholly inside it)
        if(st>today)return null;                      // has not happened yet
        const x=_siAxBuckets(a,'month').get(st);return x?x[field]:0;
      };
      const pst=_siAxAddMonths(start,-12);
      return{v:one(start,end,false),p:_siAxPrev?one(pst,_siAxBucketEnd(pst,'month'),true):null};
    });
    const partial=start<cov&&end>=cov?'from '+_siAxFmtDay(cov,true):(start<=today&&today<=end?'so far':'');
    out.push({start,month:mm,frost:_siAxIsWinterMonth(mm),cells,partial,future:start>today,beforeData:end<cov});
  }
  return{tiles:out,field,list:ml};
}
function _siAxMonthsHtml(arts,M){
  const mt=_siAxMonthTiles(arts,M),fv=v=>mt.field==='r'?_siPKR(Math.round(v)):String(v);
  let mx=0;mt.tiles.forEach(t=>t.cells.forEach(c=>{if(c.v!=null&&c.v>mx)mx=c.v;if(c.p!=null&&c.p>mx)mx=c.p;}));
  const tile=t=>{
    const has=t.cells.some(c=>c.v!=null);
    const rows=has?t.cells.map((c,i)=>`<div class="mr"><i class="si-ax-badge si-ax-b${i}">${i+1}</i><span class="bar"><i class="si-ax-b${i}" style="width:${c.v!=null&&mx?Math.max(c.v>0?3:0,Math.round(c.v/mx*100)):0}%"></i></span><strong>${c.v==null?'—':_siEsc(fv(c.v))}</strong></div>${_siAxPrev?`<div class="mp">last year ${c.p==null?'no data':_siEsc(fv(c.p))}</div>`:''}`).join(''):`<div class="mn">no data${t.beforeData?' — before the synced orders':(t.future?' — not yet':'')}</div>`;
    return`<div class="si-ax-mtile${t.frost?' frost':''}" data-month="${_siEsc(t.start.slice(0,7))}"><div class="mh"><b>${_siEsc(_siAxFmtBucket(t.start,'month',false))}</b>${t.frost?'<span class="w"><span aria-hidden="true">❄</span> winter</span>':''}</div>${rows}${t.partial&&has?`<div class="mp">${_siEsc(t.partial)}</div>`:''}</div>`;
  };
  return`<div class="si-ax-months">${mt.tiles.map(tile).join('')}</div>`;
}

// ── Overview: four questions, no typing ─────────────────────────────────────
const _SI_OV_TILES=[
  {k:'reorder',l:'Reorder now',sub:'cover shorter than the lead time, or out of stock while in demand',what:'These will sell out before a new batch can arrive. Order or re-cut them today.'},
  {k:'risk',l:'Stock-out risk',sub:'a size is out and selling, or cover is within 2 weeks of the lead time',what:'A size is out or cover is close to the lead time. Cut the missing sizes before they stall.'},
  {k:'stuck',l:'Stuck / stop',sub:'no sale in 28 days, or slow with a lot of cover',what:'Stock that is not selling. Stop reordering; promote, bundle or mark down.'},
  {k:'winner',l:'Winners',sub:'top demand, in stock, 30+ units: protect these',what:'Your best sellers. Keep them in stock and keep the push on them.'}
];
function _siAxOvRows(){
  const idx=_siAxIndex();
  return _siAxLive().filter(a=>(a.units>0||a.hasStock)&&(!_siAxOvCat||(a.category||'Unknown')===_siAxOvCat)).map(a=>{
    const m=_siAxStats(a),c=_siAxClassify(a),act=_siAxActionOf(a);
    return{a,m,c,act};
  });
}
function _siAxOvIn(r,k){
  if(k==='reorder')return r.act.key==='reorder';
  if(k==='risk')return r.c.cls!=='dead'&&r.c.cls!=='early'&&r.c.cls!=='unrated'&&(r.act.key==='risk'||(r.m.risk&&r.m.risk.length>0&&r.act.key!=='reorder'));
  if(k==='stuck')return r.act.key==='stuck'||r.act.key==='markdown';
  if(k==='winner')return r.c.cls==='winner';
  return false;
}
function _siAxOvSort(k){
  const cov=r=>r.m.cover==null?(r.a.hasStock&&r.a.onHand===0?-1:1e9):r.m.cover;
  if(k==='reorder')return(x,y)=>cov(x)-cov(y)||(y.m.units-x.m.units);
  if(k==='risk')return(x,y)=>(y.m.risk?y.m.risk.length:0)-(x.m.risk?x.m.risk.length:0)||cov(x)-cov(y);
  if(k==='stuck')return(x,y)=>(y.a.onHand||0)-(x.a.onHand||0);
  return(x,y)=>(y.m.paceHead||0)-(x.m.paceHead||0);
}
function _siAxOverviewBody(){
  const idx=_siAxIndex();
  if(_siHistState!=='ok'&&_siHistState!=='error')return`<div class="si-ax-empty">Reading the stock history…</div>`+_siAxHistBanner();
  if(_siAxOvSit){const h=_siAxOvSitHtml();if(h)return h;}
  const rows=_siAxOvRows();
  const cats=[...new Set(_siAxLive().filter(a=>a.units>0||a.hasStock).map(a=>a.category||'Unknown'))].sort(_siSortNat);
  const tile=t=>{const n=rows.filter(r=>_siAxOvIn(r,t.k)).length;return`<button class="si-ov-tile${_siAxOvTile===t.k?' on':''}" aria-pressed="${_siAxOvTile===t.k}" onclick="window._siAxOvTile('${t.k}')"><span class="l">${_siEsc(t.l)}</span><span class="n">${n}</span><span class="w">${_siEsc(t.what)}</span><span class="s">${_siEsc(t.sub)}</span></button>`;};
  const cur=_SI_OV_TILES.find(t=>t.k===_siAxOvTile)||_SI_OV_TILES[0];
  const list=rows.filter(r=>_siAxOvIn(r,cur.k)).sort(_siAxOvSort(cur.k));
  const show=_siAxOvAll?list:list.slice(0,10);
  const row=r=>`<div class="si-ov-row"><div class="nm">${_siAxThumb(r.a.code,48,r.a.name)}<div class="tx"><strong>${_siEsc(_siAxLabel(r.a))}</strong><div class="si-ax-note" style="margin:0">${_siEsc(r.a.code)} · ${_siEsc(r.c.label)}</div></div></div>
    <div class="fg"><div class="k">Stock lasts</div><div class="v">${_siEsc(_siAxCoverText(r.m))}</div></div>
    <div class="fg"><div class="k">Selling / week</div><div class="v">${_siEsc(_siAxNum(r.m.paceHead))}</div></div>
    <div class="fg"><div class="k">Sizes out</div><div class="v">${r.m.risk&&r.m.risk.length?_siEsc(r.m.risk.map(x=>x.size).join(', ')):'—'}</div></div>
    <div class="act">${_siEsc(r.act.text)}</div>
    <div class="lt">${_siAxLtCtlHtml(r.a)}</div>
    <div class="btns"><button class="si-ax-btn si-ov-sit" data-code="${_siEsc(r.a.code)}" onclick="window._siAxOvSituation(this.dataset.code)">Situation</button><button class="si-ax-btn" data-code="${_siEsc(r.a.code)}" onclick="window._siAxOpen(this.dataset.code)">Open</button><button class="si-ax-btn" data-code="${_siEsc(r.a.code)}" onclick="window._siAxOvCompare(this.dataset.code)">+ Compare</button>${_siIgBtnHtml(r.a.code)}</div></div>`;
  const cnt={};rows.forEach(r=>{cnt[r.c.cls]=(cnt[r.c.cls]||0)+1;});
  const classLine=['winner','solid','steady','constrained','slow','dead','early','unrated'].filter(k=>cnt[k]).map(k=>cnt[k]+' '+_SI_AX_CLASSES[k].label).join(' · ');
  return`<div class="card"><div class="si-ax-bar"><label class="si-ax-lab" for="si-ov-cat">Category</label><select id="si-ov-cat" class="si-ax-select" onchange="window._siAxOvCat(this.value)"><option value="">All categories</option>${cats.map(c=>`<option value="${_siEsc(c)}"${c===_siAxOvCat?' selected':''}>${_siEsc(c)}</option>`).join('')}</select></div>
    <div class="si-ov-tiles">${_SI_OV_TILES.map(tile).join('')}</div>
    <div class="si-ax-lab" style="margin:12px 0 4px">${_siEsc(cur.l)} — ${list.length} article${list.length===1?'':'s'}${list.length>show.length?' (showing '+show.length+')':''}</div>
    ${show.length?show.map(row).join(''):`<div class="si-ax-empty">Nothing here right now.</div>`}
    ${list.length>10?`<button class="si-ax-btn" onclick="window._siAxOvAll()">${_siAxOvAll?'Show the first 10':'Show all '+list.length}</button>`:''}
    <div class="si-ax-note" style="margin-top:10px">${_siEsc(classLine)}. Articles with fewer than ${_SI_AX_SCORE.minDays} counted days or no stock data are not classed. Lead times are editable defaults, not facts (Lead time section below).</div></div>
  ${_siAxHistBanner()}
  <details class="card si-ax-defs"><summary class="card-title" style="cursor:pointer">Lead times (editable defaults)</summary>${_siAxLtHtml()}</details>`;
}
window._siAxOvTile=function(k){_siAxOvTile=k;_siAxOvAll=false;_siAxOvSit='';_siAxRepaintBody();};
window._siAxOvCat=function(v){_siAxOvCat=v||'';_siAxOvAll=false;_siAxOvSit='';_siAxRepaintBody();};
window._siAxOvAll=function(){_siAxOvAll=!_siAxOvAll;_siAxRepaintBody();};
window._siAxOpen=function(code){_siAxModeSel='search';_siAxSel=String(code||'').toUpperCase();_siAxQuery='';_siAxMsg='';_siAxRepaintAll();if(typeof window.scrollTo==='function')try{window.scrollTo(0,0);}catch(_){}};
window._siAxOvCompare=function(code){
  const r=_siAxTryAdd(code);
  if(r.ok)_siAxSyncTab();
  if(typeof showToast==='function')showToast(r.ok?'Added to Compare ('+_siAxCmp.length+').':r.msg,!r.ok);
};
// ── Portfolio: the whole catalogue at a glance ─────────────────────────────────────────────────────────────
// Built ONLY on the Explorer's own indexes (_siAxIndex, _siAxStats, _siAxClassify, _siAxDemand, _siAxTimeline), so every figure agrees with
// the Overview, Needs Attention and the article pages. No Firestore read. Missing is never 0 ("—"). Stock value is at the average SELLING
// price (units x the article's average unit price before discounts); cost is not stored, so there is no margin. Revenue is before
// discounts and before returns that came after the order was read. All thresholds below are labelled defaults, not facts.
const _SI_PF={
  overCoverWeeks:26,           // cover at or above this (not dead, slow or a winner) = over-stocked
  coverMax:52,                 // the scatter's right edge; longer cover sits on the edge ("52+")
  lostDays:90,                 // the stock-out exposure window (the timeline's 90 day range)
  topCap:15,listCap:25,        // long lists show this many, then Show all
  concNs:[5,10,20],            // top-N shares
  concHigh:0.5,concLow:0.35,   // top-20 share of units: 50%+ = concentrated, under 35% = spread out
  stuckLight:0.2,stuckHeavy:0.4// share of stock value in dead, slow or over-stocked articles: under 20% light, over 40% heavy
};
const _SI_PF_ORDER=['winner','solid','steady','constrained','slow','dead','early','unrated'];
const _SI_PF_COLOR={winner:'var(--si-s2)',solid:'var(--si-s0)',steady:'var(--si-s3)',constrained:'var(--si-s1)',slow:'var(--accent-warning)',dead:'var(--accent-urgent)',early:'var(--muted)',unrated:'var(--border)'};
const _SI_PF_GLYPH={winner:'★',solid:'●',steady:'◆',constrained:'▲',slow:'■',dead:'✕',early:'○',unrated:'–'};
const _SI_PF_SORTS=[{k:'demand',l:'Units per in-stock day'},{k:'cover',l:'Longest cover first'},{k:'value',l:'Stock value'},{k:'units',l:'Units sold'}];
const _SI_PF_BUCKETS=[{k:'winner',l:'Winners'},{k:'over',l:'Over-stocked (26+ weeks of cover)'},{k:'slow',l:'Slow'},{k:'dead',l:'Dead stock'},{k:'other',l:'Everything else'}];
let _siAxPfCls='',_siAxPfCat='',_siAxPfSeason='',_siAxPfSort='demand',_siAxPfAll=false,_siAxPfConcAll=false,_siAxPfMemo=null;

// units and revenue sold in winter months (Oct to Feb) and in the other months, by the day of each counted sale
function _siAxPfSeasonUnits(a){
  const o={wU:0,wR:0,sU:0,sR:0};
  if(!a||!a.daily)return o;
  a.daily.forEach((d,day)=>{
    const m=+String(day).slice(5,7);
    if(_siAxIsWinterMonth(m)){o.wU+=d.u;o.wR+=d.r;}else{o.sU+=d.u;o.sR+=d.r;}
  });
  return o;
}
// The share of the total reached by the k biggest (descending values): smallest k with cumulative >= pct of the total.
function _siAxPfReach(vals,pct){
  const tot=vals.reduce((s,v)=>s+v,0);if(!(tot>0))return null;
  let c=0;for(let i=0;i<vals.length;i++){c+=vals[i];if(c*100>=tot*pct)return i+1;}
  return vals.length;
}
function _siAxPfTop(vals,n){const tot=vals.reduce((s,v)=>s+v,0);if(!(tot>0))return null;return vals.slice(0,n).reduce((s,v)=>s+v,0)/tot;}
// rows: [{a,m,c}] (the articles with sales or stock). opts: {today, lost:(a)=>summary|null, demand:Map}. Pure: no DOM, no read.
function _siAxPfCalc(rows,opts){
  opts=opts||{};const T=_SI_PF,dm=opts.demand||new Map();
  const R=rows.map(r=>{
    const a=r.a,m=r.m,asp=m.asp;
    const su=_siAxPfSeasonUnits(a);
    const val=a.hasStock?(a.onHand>0?(asp!=null?a.onHand*asp:null):0):null;
    const d=dm.get(a.code);
    const pace=(m.paceHead!=null&&m.paceHead>0)?m.paceHead:null;
    return{a,m,c:r.c,cls:r.c.cls,code:a.code,cat:a.category||'Unknown',units:a.units||0,rev:a.rev||0,hasRev:!!a.hasPrice,
      onHand:a.hasStock?a.onHand:null,val,noPrice:a.hasStock&&a.onHand>0&&asp==null,cover:m.cover,demand:d?d.D:null,pace,
      su,season:(a.units>0)?(su.wU*2>a.units?'winter':'summer'):null};
  });
  const tot={articles:R.length,units:0,rev:0,stockUnits:0,stockVal:0,noPrice:0,noStock:0};
  R.forEach(r=>{tot.units+=r.units;tot.rev+=r.rev;if(r.onHand!=null)tot.stockUnits+=r.onHand;else tot.noStock++;if(r.val!=null)tot.stockVal+=r.val;if(r.noPrice)tot.noPrice++;});
  // 1. class mix
  const mix=_SI_PF_ORDER.map(k=>({k,label:_SI_AX_CLASSES[k].label,n:0,units:0,rev:0}));
  const mixBy={};mix.forEach(x=>{mixBy[x.k]=x;});
  R.forEach(r=>{const x=mixBy[r.cls]||mixBy.unrated;x.n++;x.units+=r.units;x.rev+=r.rev;});
  mix.forEach(x=>{x.pN=R.length?x.n/R.length:null;x.pU=tot.units>0?x.units/tot.units:null;x.pR=tot.rev>0?x.rev/tot.rev:null;});
  // 2. category and season
  const grp=(keyOf,label)=>{
    const g=new Map();
    R.forEach(r=>{
      const k=keyOf(r);let x=g.get(k);
      if(!x){x={k,label:label?label(k):k,n:0,units:0,rev:0,wU:0,stockUnits:0,stockVal:0,valMissing:0,paceStock:0,paceSum:0,paceN:0};g.set(k,x);}
      x.n++;x.units+=r.units;x.rev+=r.rev;x.wU+=r.su.wU;
      if(r.onHand!=null)x.stockUnits+=r.onHand;
      if(r.val!=null)x.stockVal+=r.val;else if(r.onHand!=null)x.valMissing++;
      if(r.onHand!=null&&r.pace!=null){x.paceStock+=r.onHand;x.paceSum+=r.pace;x.paceN++;}
    });
    const out=[...g.values()];
    out.forEach(x=>{x.pU=tot.units>0?x.units/tot.units:null;x.pR=tot.rev>0?x.rev/tot.rev:null;x.pV=tot.stockVal>0?x.stockVal/tot.stockVal:null;x.cover=x.paceSum>0?x.paceStock/x.paceSum:null;x.wShare=x.units>0?x.wU/x.units:null;});
    return out;
  };
  const cats=grp(r=>r.cat).sort((x,y)=>(y.units-x.units)||_siSortNat(x.k,y.k));
  const sg=grp(r=>r.season||'none');
  // season of SALE: every counted sale by its month (Oct to Feb = winter). Stock and cover go with the season each article mainly sells in.
  const seasons=[{k:'winter',label:'Winter months (Oct–Feb)'},{k:'summer',label:'Other months (Mar–Sep)'},{k:'none',label:'No counted sales'}].map(s=>{
    const g=sg.find(x=>x.k===s.k)||{n:0,stockUnits:0,stockVal:0,valMissing:0,cover:null,pV:null};
    let u=0,rv=0;
    if(s.k==='winter')R.forEach(r=>{u+=r.su.wU;rv+=r.su.wR;});
    else if(s.k==='summer')R.forEach(r=>{u+=r.su.sU;rv+=r.su.sR;});
    const has=s.k!=='none';
    return{k:s.k,label:s.label,units:has?u:null,rev:has?rv:null,pU:has&&tot.units>0?u/tot.units:null,pR:has&&tot.rev>0?rv/tot.rev:null,
      n:g.n,stockUnits:g.stockUnits,stockVal:g.stockVal,valMissing:g.valMissing,cover:g.cover,pV:g.pV};
  });
  // 3. concentration (articles with sales, biggest first)
  const sold=R.filter(r=>r.units>0).sort((x,y)=>(y.units-x.units)||_siSortNat(x.code,y.code));
  const uv=sold.map(r=>r.units),byRev=R.filter(r=>r.rev>0).sort((x,y)=>(y.rev-x.rev)||_siSortNat(x.code,y.code)),rv=byRev.map(r=>r.rev);
  let cum=0;const top=sold.map(r=>{cum+=r.units;return{r,cum:tot.units>0?cum/tot.units:null};});
  const conc={n:sold.length,top,
    reachU50:_siAxPfReach(uv,50),reachU80:_siAxPfReach(uv,80),reachR50:_siAxPfReach(rv,50),reachR80:_siAxPfReach(rv,80),nRev:byRev.length,
    topU:T.concNs.map(n=>({n,share:_siAxPfTop(uv,n)})),topR:T.concNs.map(n=>({n,share:_siAxPfTop(rv,n)}))};
  // 4. cash by bucket (disjoint: dead, then slow, then winner, then over-stocked, else everything else)
  const bucketOf=r=>r.cls==='dead'?'dead':(r.cls==='slow'?'slow':(r.cls==='winner'?'winner':((r.cover!=null&&r.cover>=T.overCoverWeeks&&(r.cls==='solid'||r.cls==='steady'||r.cls==='constrained'))?'over':'other')));
  const cash=_SI_PF_BUCKETS.map(b=>({k:b.k,label:b.l,n:0,stockUnits:0,val:0,valMissing:0}));
  const cashBy={};cash.forEach(x=>{cashBy[x.k]=x;});
  R.forEach(r=>{
    if(r.onHand==null)return;const x=cashBy[bucketOf(r)];
    x.n++;x.stockUnits+=r.onHand;if(r.val!=null)x.val+=r.val;else x.valMissing++;
  });
  cash.forEach(x=>{x.pV=tot.stockVal>0?x.val/tot.stockVal:null;});
  const stuckVal=cashBy.dead.val+cashBy.slow.val+cashBy.over.val;
  const stuck={val:stuckVal,share:tot.stockVal>0?stuckVal/tot.stockVal:null,winVal:cashBy.winner.val,winShare:tot.stockVal>0?cashBy.winner.val/tot.stockVal:null};
  // stock-out exposure: only where the timeline rules produce an estimate (an in-stock baseline exists); everything else is counted, not guessed
  let lost=null;
  if(opts.lost){
    lost={days:T.lostDays,lo:0,hi:0,mid:0,rs:0,articles:0,notEstimated:0,ongoing:0,withHistory:0,outNow:0};
    R.forEach(r=>{
      const sellerNow=(r.cls==='winner'||r.cls==='solid'||r.cls==='steady'||r.cls==='constrained');
      if(sellerNow&&r.a.hasStock&&r.a.onHand===0&&r.m.units28>0)lost.outNow++;
      const s=opts.lost(r.a);if(!s)return;
      lost.withHistory++;
      lost.notEstimated+=s.notEstimated||0;if(s.ongoing)lost.ongoing++;
      if(s.lost){lost.lo+=s.lost.lo;lost.hi+=s.lost.hi;lost.mid+=s.lost.mid;lost.articles++;if(s.price!=null)lost.rs+=s.lost.mid*s.price;}
    });
  }
  const res={rows:R,tot,mix,cats,seasons,conc,cash,stuck,lost,today:opts.today||''};
  res.readout=_siAxPfReadout(res);
  return res;
}
// One paragraph, each sentence only when its inputs exist.
function _siAxPfReadout(pf){
  const T=_SI_PF,L=[],t=pf.tot,rs=v=>_siPKR(Math.round(v));
  if(!t.articles)return'There is nothing to summarise yet: no article has counted sales or stock.';
  const by={};pf.mix.forEach(x=>{by[x.k]=x;});
  const classed=t.articles-by.early.n-by.unrated.n,good=by.winner.n+by.solid.n,bad=by.slow.n+by.dead.n;
  if(classed>0){
    L.push(t.articles+' articles are in the range; '+classed+' are classed, and of those '+good+' are Winner or Solid and '+bad+' are Slow or Dead'+(by.constrained.n?', with '+by.constrained.n+' held back by stock-outs':'')+'.');
  }else L.push(t.articles+' articles are in the range, none classed yet (too few counted days or no stock data).');
  const c=pf.conc;
  if(c.reachU50!=null){
    const t20=c.topU.find(x=>x.n===20);
    let word='';
    if(t20&&t20.share!=null&&c.n>20)word=t20.share>=T.concHigh?' — sales are concentrated in a few articles':(t20.share<T.concLow?' — sales are spread out, no single article carries the range':' — a moderate spread');
    L.push(c.reachU50+' article'+(c.reachU50===1?' makes':'s make')+' half of the units and '+c.reachU80+' make 80% (of '+c.n+' selling)'+word+'.');
  }
  if(pf.tot.stockVal>0&&pf.stuck.share!=null){
    const w=pf.stuck.share<T.stuckLight?'a light':(pf.stuck.share>T.stuckHeavy?'a heavy':'a moderate');
    L.push('Stock is worth '+rs(pf.tot.stockVal)+' at selling price (not cost); '+rs(pf.stuck.val)+' ('+_siAxPct(pf.stuck.share)+') is in dead, slow or over-stocked articles — '+w+' share — against '+rs(pf.stuck.winVal)+' ('+_siAxPct(pf.stuck.winShare)+') in winners.'+(t.noPrice?' '+t.noPrice+' article'+(t.noPrice===1?' with stock has':'s with stock have')+' no sale price yet and '+(t.noPrice===1?'is':'are')+' left out of that value.':''));
  }else if(!(pf.tot.stockVal>0))L.push('No stock value can be worked out yet (no stock data, or no selling price).');
  if(pf.lost&&pf.lost.articles>0)L.push('Stock-outs in the last '+pf.lost.days+' days cost an estimated '+Math.round(pf.lost.lo)+' to '+Math.round(pf.lost.hi)+' units across '+pf.lost.articles+' article'+(pf.lost.articles===1?'':'s')+' (an estimate from each article’s in-stock pace, not a count).');
  else if(pf.lost&&pf.lost.withHistory>0)L.push('No stock-out in the last '+pf.lost.days+' days has an estimate (an estimate needs enough in-stock days either side).');
  return L.join(' ');
}
// Per-article lost-sales summary through the timeline rules (the same function the article card uses). null with no history.
function _siAxPfLostOf(a){
  const H=_siHist&&_siHist.byCode?_siHist:null;
  if(!H||!H.byCode.get(a.code))return null;
  const idx=_siAxIndex(),tl=_siAxTimeline(a,H,{from:idx.cov||H.from||'',to:_siPktDate(0)});
  if(!tl||!tl.ok)return null;
  const s=_siAxTlSummary(tl,String(_SI_PF.lostDays),null);
  return{lost:s.lost,notEstimated:s.notEstimated,ongoing:s.ongoing,price:s.price};
}
// Cached per data load, day and lead-time settings (the only inputs that change without a reload), like Needs Attention.
function _siAxPf(){
  const idx=_siAxIndex();
  let lt='';try{lt=(localStorage.getItem(_SI_LT_KEY)||'')+'|'+(localStorage.getItem(_SI_LT_ART_KEY)||'');}catch(_){}
  const sig=_siPktDate(0)+'|'+lt+'|'+_siHistState+'|'+_siIgKey();
  if(_siAxPfMemo&&_siAxPfMemo.idx===idx&&_siAxPfMemo.sig===sig)return _siAxPfMemo.res;
  const rows=_siAxLive().filter(a=>a.units>0||a.hasStock).map(a=>({a,m:_siAxStats(a),c:_siAxClassify(a)}));
  const res=_siAxPfCalc(rows,{today:_siPktDate(0),demand:_siAxDemand(),lost:_siHistState==='ok'?_siAxPfLostOf:null});
  _siAxPfMemo={idx,sig,res};return res;
}
function _siAxPfFiltered(pf){
  return pf.rows.filter(r=>(!_siAxPfCls||r.cls===_siAxPfCls)&&(!_siAxPfCat||r.cat===_siAxPfCat)&&(!_siAxPfSeason||(_siAxPfSeason==='none'?r.season==null:r.season===_siAxPfSeason)));
}
function _siAxPfSorted(list,k){
  const by=k==='cover'?r=>r.cover:(k==='value'?r=>r.val:(k==='units'?r=>r.units:r=>r.demand));
  return list.slice().sort((x,y)=>{
    const a=by(x),b=by(y);
    if(a==null&&b!=null)return 1;if(b==null&&a!=null)return-1;
    return(b-a)||(y.units-x.units)||_siSortNat(x.code,y.code);
  });
}
function _siAxPfChip(cls){return`<span class="si-pf-chip"><i style="color:${cls==='unrated'?'var(--muted)':(_SI_PF_COLOR[cls]||'var(--muted)')}">${_SI_PF_GLYPH[cls]||'–'}</i>${_siEsc((_SI_AX_CLASSES[cls]||{label:cls}).label)}</span>`;}
const _siAxPfRs=v=>v==null?'—':_siPKR(Math.round(v));
function _siAxPfMixHtml(pf){
  const seg=pf.mix.filter(x=>x.n>0);
  const bar=(key,label)=>`<div class="si-pf-bar" role="img" aria-label="${_siEsc(label)}">${seg.filter(x=>x[key]>0).map(x=>`<span class="si-pf-seg" style="flex:${x[key]} 1 0;background:${_SI_PF_COLOR[x.k]}" title="${_siEsc(x.label+': '+(key==='n'?x.n+' articles':(key==='units'?x.units+' units':_siAxPfRs(x.rev))))}"></span>`).join('')}</div>`;
  const row=x=>`<tr><td>${_siAxPfChip(x.k)}</td><td class="r">${x.n}</td><td class="r">${_siAxPct(x.pN)}</td><td class="r">${_siAxPct(x.pU)}</td><td class="r">${_siAxPct(x.pR)}</td></tr>`;
  return`<div class="si-pf-lab">Articles</div>${bar('n','Share of articles by class')}<div class="si-pf-lab">Units</div>${bar('units','Share of units by class')}<div class="si-pf-lab">Revenue at list price</div>${bar('rev','Share of revenue by class')}
  <div class="si-pf-wrap"><table class="si-pf-tbl"><thead><tr><th>Class</th><th class="r">Articles</th><th class="r">% articles</th><th class="r">% units</th><th class="r">% revenue</th></tr></thead><tbody>${pf.mix.map(row).join('')}</tbody></table></div>`;
}
function _siAxPfCatHtml(pf){
  const row=x=>`<tr><td>${_siEsc(x.label)}</td><td class="r">${x.n}</td><td class="r">${x.units}</td><td class="r">${_siAxPfRs(x.rev)}</td><td class="r">${_siAxPct(x.pU)}</td><td class="r">${_siAxPfRs(x.stockVal)}${x.valMissing?'<sup title="'+x.valMissing+' article(s) with stock and no sale price are not valued">*</sup>':''}</td><td class="r">${x.cover==null?'—':_siEsc(_siAxNum(x.cover))}</td><td class="r">${_siAxPct(x.wShare)}</td></tr>`;
  return`<div class="si-pf-wrap"><table class="si-pf-tbl"><thead><tr><th>Category</th><th class="r">Articles</th><th class="r">Units</th><th class="r">Revenue (list)</th><th class="r">% of units</th><th class="r">Stock at selling price</th><th class="r">Cover (weeks)</th><th class="r">Winter share of units</th></tr></thead><tbody>${pf.cats.map(row).join('')}</tbody></table></div>`;
}
function _siAxPfSeasonHtml(pf){
  const row=x=>`<tr><td>${_siEsc(x.label)}</td><td class="r">${x.units==null?'—':x.units}</td><td class="r">${_siAxPfRs(x.rev)}</td><td class="r">${_siAxPct(x.pU)}</td><td class="r">${x.n}</td><td class="r">${_siAxPfRs(x.stockVal)}</td><td class="r">${x.cover==null?'—':_siEsc(_siAxNum(x.cover))}</td></tr>`;
  return`<div class="si-pf-wrap"><table class="si-pf-tbl"><thead><tr><th>Season</th><th class="r">Units sold in these months</th><th class="r">Revenue (list)</th><th class="r">% of units</th><th class="r">Articles that mainly sell then</th><th class="r">Their stock at selling price</th><th class="r">Their cover (weeks)</th></tr></thead><tbody>${pf.seasons.map(row).join('')}</tbody></table></div>
  <div class="si-ax-note">Sales are split by the month of each order (October to February is winter). An article counts as a winter seller when more than half of its units sold in winter months; stock follows the article.</div>`;
}
function _siAxPfConcHtml(pf){
  const c=pf.conc,T=_SI_PF;
  if(!c.n)return'<div class="si-ax-empty">No counted sales yet.</div>';
  const shareTxt=(arr)=>arr.map(x=>`top ${x.n}: ${_siAxPct(x.share)}`).join(' · ');
  const show=_siAxPfConcAll?c.top:c.top.slice(0,T.topCap);
  const row=(x,i)=>`<tr><td class="r">${i+1}</td><td><div class="si-pf-nm">${_siAxThumb(x.r.code,32,x.r.a.name)}<span><button class="si-pf-link" data-code="${_siEsc(x.r.code)}" onclick="window._siAxOpen(this.dataset.code)">${_siEsc(_siAxLabel(x.r.a))}</button><span class="si-ax-note" style="margin:0;display:block">${_siEsc(x.r.code)}</span></span></div></td><td class="r">${x.r.units}</td><td class="r">${_siAxPct(x.cum)}</td></tr>`;
  return`<div class="si-pf-facts"><div><b>${c.reachU50}</b><span>article${c.reachU50===1?' makes':'s make'} 50% of units</span></div><div><b>${c.reachU80}</b><span>make 80% of units</span></div><div><b>${c.reachR50==null?'—':c.reachR50}</b><span>make 50% of revenue</span></div><div><b>${c.reachR80==null?'—':c.reachR80}</b><span>make 80% of revenue</span></div></div>
  <div class="si-ax-note">Share of units — ${_siEsc(shareTxt(c.topU))}. Share of revenue — ${_siEsc(shareTxt(c.topR))}. Of ${c.n} articles with counted sales.</div>
  <div class="si-pf-wrap"><table class="si-pf-tbl"><thead><tr><th class="r">#</th><th>Article</th><th class="r">Units</th><th class="r">Cumulative share of units</th></tr></thead><tbody>${show.map(row).join('')}</tbody></table></div>
  ${c.top.length>T.topCap?`<button class="si-ax-btn" onclick="window._siAxPfConc()">${_siAxPfConcAll?'Show the first '+T.topCap:'Show all '+c.top.length}</button>`:''}`;
}
function _siAxPfCashHtml(pf){
  const row=x=>`<tr><td>${_siEsc(x.label)}</td><td class="r">${x.n}</td><td class="r">${x.stockUnits}</td><td class="r">${_siAxPfRs(x.val)}${x.valMissing?'<sup title="'+x.valMissing+' article(s) with stock and no sale price are not valued">*</sup>':''}</td><td class="r">${_siAxPct(x.pV)}</td></tr>`;
  const l=pf.lost;
  let lostHtml='';
  if(l===null)lostHtml=`<div class="si-ax-note">Stock-out exposure needs the stock history, which is not loaded.</div>`;
  else{
    lostHtml=`<div class="si-pf-facts"><div><b>${l.outNow}</b><span>selling article${l.outNow===1?'':'s'} out of stock now</span></div><div><b>${l.articles?Math.round(l.lo)+'–'+Math.round(l.hi):'—'}</b><span>units lost to stock-outs, last ${l.days} days (estimate)</span></div><div><b>${l.articles&&l.rs>0?_siEsc(_siAxPfRs(l.rs)):'—'}</b><span>of revenue at list price (estimate)</span></div><div><b>${l.notEstimated}</b><span>stock-out stretch${l.notEstimated===1?'':'es'} with no estimate</span></div></div>
    <div class="si-ax-note">An estimate is days out of stock x the article’s own in-stock pace, only where the Stock vs sales rules allow one (enough in-stock days either side; a long stretch that looks discontinued is not estimated). It is a range from ${l.withHistory} article${l.withHistory===1?'':'s'} with stock history, never a count of lost orders.</div>`;
  }
  return`<div class="si-pf-wrap"><table class="si-pf-tbl"><thead><tr><th>Where the stock sits</th><th class="r">Articles</th><th class="r">Units on hand</th><th class="r">Value at selling price</th><th class="r">% of stock value</th></tr></thead><tbody>${pf.cash.map(row).join('')}</tbody></table></div>
  <div class="si-ax-note">Value = units on hand x the article’s average selling price (before discounts). Cost is not stored, so this is not what the stock cost. Each article is in one row: dead, then slow, then winner, then over-stocked (a Solid, Steady or Stock-constrained article with ${_SI_PF.overCoverWeeks}+ weeks of cover), then the rest. An article with no sale price is counted but not valued (*).</div>${lostHtml}`;
}
function _siAxPfScatterHtml(list){
  const T=_SI_PF,pts=list.filter(r=>r.demand!=null&&r.cover!=null);
  if(!pts.length)return'';
  const maxD=Math.max(...pts.map(r=>r.demand)),yMax=maxD>0?maxD*1.08:1;
  const dot=r=>{const x=Math.min(1,r.cover/T.coverMax)*100,y=Math.min(1,r.demand/yMax)*100;
    return`<i class="si-pf-dot" style="left:${x.toFixed(2)}%;bottom:${y.toFixed(2)}%;background:${_SI_PF_COLOR[r.cls]||'var(--muted)'}" data-code="${_siEsc(r.code)}" title="${_siEsc(_siAxLabel(r.a)+' — '+(_SI_AX_CLASSES[r.cls]||{label:r.cls}).label+', '+_siAxNum(r.demand)+' per in-stock day, '+_siAxNum(r.cover)+' weeks of cover')}" onclick="window._siAxOpen(this.dataset.code)"></i>`;};
  const xt=[0,13,26,39,52].map(v=>`<span style="left:${v/T.coverMax*100}%">${v}${v===52?'+':''}</span>`).join('');
  const yt=[0,1,2,3,4].map(i=>`<span style="bottom:${i*25}%">${_siEsc(_siAxNum(yMax*i/4))}</span>`).join('');
  return`<div class="si-pf-plotwrap"><div class="si-pf-y">${yt}</div><div class="si-pf-plot"><i class="si-pf-ref" style="left:${T.overCoverWeeks/T.coverMax*100}%"></i>${pts.map(dot).join('')}</div><div class="si-pf-x">${xt}</div></div>
  <div class="si-ax-note si-pf-plotnote">Each dot is an article: left to right is weeks of cover (52+ sits on the right edge), bottom to top is units per in-stock day. The line marks ${T.overCoverWeeks} weeks. Click a dot to open the article. ${list.length-pts.length?(list.length-pts.length)+' article'+(list.length-pts.length===1?' has':'s have')+' no cover or demand figure and appear only in the table.':''}</div>`;
}
function _siAxPfListHtml(pf){
  const T=_SI_PF,f=_siAxPfFiltered(pf),s=_siAxPfSorted(f,_siAxPfSort),show=_siAxPfAll?s:s.slice(0,T.listCap);
  const cats=pf.cats.map(x=>x.k);
  const sel=(id,cur,opts,onch)=>`<select id="${id}" class="si-ax-select" onchange="${onch}">${opts.map(o=>`<option value="${_siEsc(o[0])}"${o[0]===cur?' selected':''}>${_siEsc(o[1])}</option>`).join('')}</select>`;
  const filters=`<div class="si-ax-bar"><label class="si-ax-lab" for="si-pf-cls">Class</label>${sel('si-pf-cls',_siAxPfCls,[['','All classes']].concat(_SI_PF_ORDER.map(k=>[k,_SI_AX_CLASSES[k].label])),"window._siAxPfSet('cls',this.value)")}
    <label class="si-ax-lab" for="si-pf-cat">Category</label>${sel('si-pf-cat',_siAxPfCat,[['','All categories']].concat(cats.map(c=>[c,c])),"window._siAxPfSet('cat',this.value)")}
    <label class="si-ax-lab" for="si-pf-season">Season</label>${sel('si-pf-season',_siAxPfSeason,[['','Any season'],['winter','Mainly winter'],['summer','Mainly other months'],['none','No counted sales']],"window._siAxPfSet('season',this.value)")}
    <label class="si-ax-lab" for="si-pf-sort">Order by</label>${sel('si-pf-sort',_siAxPfSort,_SI_PF_SORTS.map(o=>[o.k,o.l]),"window._siAxPfSet('sort',this.value)")}</div>`;
  const row=r=>`<tr><td><div class="si-pf-nm">${_siAxThumb(r.code,32,r.a.name)}<span><button class="si-pf-link" data-code="${_siEsc(r.code)}" onclick="window._siAxOpen(this.dataset.code)">${_siEsc(_siAxLabel(r.a))}</button><span class="si-ax-note" style="margin:0;display:block">${_siEsc(r.code)} · ${_siEsc(r.cat)}</span></span></div></td><td>${_siAxPfChip(r.cls)}</td><td class="r">${r.demand==null?'—':_siEsc(_siAxNum(r.demand))}</td><td class="r">${r.cover==null?(r.onHand===0?'0':'—'):_siEsc(_siAxNum(r.cover))}</td><td class="r">${r.onHand==null?'—':r.onHand}</td><td class="r">${_siAxPfRs(r.val)}</td><td class="r">${r.units}</td></tr>`;
  return`${filters}<div class="si-ax-lab" style="margin:4px 0">${f.length} of ${pf.rows.length} articles${f.length>show.length?' (showing '+show.length+')':''}</div>${_siAxPfScatterHtml(f)}
  ${show.length?`<div class="si-pf-wrap"><table class="si-pf-tbl si-pf-ranked"><thead><tr><th>Article</th><th>Class</th><th class="r">Per in-stock day</th><th class="r">Cover (weeks)</th><th class="r">On hand</th><th class="r">Stock at selling price</th><th class="r">Units sold</th></tr></thead><tbody>${show.map(row).join('')}</tbody></table></div>`:'<div class="si-ax-empty">No article matches these filters.</div>'}
  ${s.length>T.listCap?`<button class="si-ax-btn" onclick="window._siAxPfAll()">${_siAxPfAll?'Show the first '+T.listCap:'Show all '+s.length}</button>`:''}`;
}
function _siAxPortfolioBody(){
  const idx=_siAxIndex();
  if(_siHistState!=='ok'&&_siHistState!=='error')return`<div class="si-ax-empty">Reading the stock history…</div>`+_siAxHistBanner();
  const pf=_siAxPf(),t=pf.tot;
  if(!t.articles)return`<div class="card"><div class="si-ax-empty">No article has counted sales or stock yet.</div></div>`+_siAxHistBanner();
  const tile=(l,v,s)=>`<div class="si-pf-tile"><span class="l">${_siEsc(l)}</span><span class="n">${v}</span><span class="s">${_siEsc(s)}</span></div>`;
  const c=pf.conc,t5=c.topU.find(x=>x.n===5),t20=c.topU.find(x=>x.n===20);
  const tiles=`<div class="si-pf-tiles">${tile('Articles',t.articles,'with sales or stock')}${tile('Units sold',t.units,'net, counted window')}${tile('Revenue at list price',_siEsc(_siAxPfRs(t.rev)),'before discounts and later returns')}${tile('Stock at selling price',t.stockVal>0?_siEsc(_siAxPfRs(t.stockVal)):'—','not cost; '+t.stockUnits+' units on hand')}${tile('Top 5 articles',t5?_siAxPct(t5.share):'—','share of units')}${tile('Top 20 articles',t20&&c.n>20?_siAxPct(t20.share):'—','share of units')}</div>`;
  const cov=idx.cov?'Sales counted from '+_siAxFmtDay(idx.cov)+'. ':'';
  const caveat=`<div class="si-ax-note si-pf-caveat" role="note"><strong>Read with care.</strong> ${_siEsc(cov)}Units and revenue are before returns that came after the order was read (they can read about a fifth high while returns are not synced) and revenue is before discounts. Stock value is at the average selling price, not cost. The same numbers feed Overview, Needs Attention and the article pages; the class rules and thresholds are defaults, not facts.</div>`;
  return`<div class="card si-pf"><div class="card-title">Portfolio</div><p class="si-pf-read" id="si-pf-read">${_siEsc(pf.readout)}</p>${tiles}${caveat}</div>
  <div class="card si-pf"><div class="card-title">Class mix</div>${_siAxPfMixHtml(pf)}</div>
  <div class="card si-pf"><div class="card-title">Category</div>${_siAxPfCatHtml(pf)}</div>
  <div class="card si-pf"><div class="card-title">Season</div>${_siAxPfSeasonHtml(pf)}</div>
  <div class="card si-pf"><div class="card-title">Concentration</div>${_siAxPfConcHtml(pf)}</div>
  <div class="card si-pf"><div class="card-title">Cash tied up and stock-outs</div>${_siAxPfCashHtml(pf)}</div>
  <div class="card si-pf" id="si-pf-list"><div class="card-title">Every article: demand against cover</div>${_siAxPfListHtml(pf)}</div>
  ${_siAxHistBanner()}`;
}
window._siAxPfSet=function(kind,v){
  v=String(v==null?'':v);
  if(kind==='cls')_siAxPfCls=_SI_PF_ORDER.indexOf(v)>=0?v:'';
  else if(kind==='cat'){let ok=false;try{ok=_siAxPf().cats.some(x=>x.k===v);}catch(_){}_siAxPfCat=ok?v:'';}
  else if(kind==='season')_siAxPfSeason=(v==='winter'||v==='summer'||v==='none')?v:'';
  else if(kind==='sort')_siAxPfSort=_SI_PF_SORTS.some(o=>o.k===v)?v:'demand';
  else return;
  _siAxPfAll=false;_siAxRepaintBody();
};
window._siAxPfAll=function(){_siAxPfAll=!_siAxPfAll;_siAxRepaintBody();};
window._siAxPfConc=function(){_siAxPfConcAll=!_siAxPfConcAll;_siAxRepaintBody();};
// The Selected tray: one picture card per chosen article, always visible in Compare. With two or more chosen a primary
// "Compare →" button goes forward to the comparison; with one, the existing badge and alert ask for another.
function _siAxCardHtml(code,i){
  const a=_siAxIndex().map.get(code);if(!a)return'';
  let chip='';try{chip=_siAxPfChip(_siAxClassify(a).cls);}catch(_){}
  return`<div class="si-ax-card"><i class="si-ax-badge si-ax-b${i}">${i+1}</i>${_siAxThumb(a.code,64,a.name)}<div class="tx"><strong>${_siEsc(_siAxLabel(a))}</strong><div class="si-ax-note" style="margin:0">${_siEsc(a.code)}</div>${chip}</div><button class="si-ax-x" aria-label="Remove ${_siEsc(_siAxLabel(a))}" data-code="${_siEsc(code)}" onclick="window._siAxRemove(this.dataset.code)">×</button></div>`;
}
function _siAxTrayHtml(){
  const n=_siAxCmp.length,mx=_siAxMaxCmp();
  const go=n>=2?`<button class="si-ax-go" id="si-ax-go" onclick="window._siAxGo()">Compare →</button>`:'';
  const body=n?`<div class="si-ax-cards">${_siAxCmp.map(_siAxCardHtml).join('')}</div>`:`<div class="si-ax-note" style="margin:0">Search above and press + on an article to add it. Add 2–${mx} articles.</div>`;
  return`<div class="si-ax-tray" id="si-ax-tray"><div class="si-ax-trayhead"><strong>Selected (${n} of ${mx})</strong>${go}</div>${body}${_siAxMsg?`<div class="si-ax-note" style="color:var(--accent-urgent);font-weight:600" role="alert">${_siEsc(_siAxMsg)}</div>`:''}</div>`;
}
// Goes forward: brings the comparison into view and gives it a brief outline (a still ring under reduced motion).
window._siAxGo=function(){
  const c=document.getElementById('si-ax-result');if(!c)return false;
  let calm=false;try{calm=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){}
  if(typeof c.scrollIntoView==='function')try{c.scrollIntoView({behavior:calm?'auto':'smooth',block:'start'});}catch(_){}
  if(typeof c.focus==='function')try{c.focus({preventScroll:true});}catch(_){}
  c.classList.add('si-ax-pop');setTimeout(()=>{try{c.classList.remove('si-ax-pop');}catch(_){}},1100);
  return true;
};
function _siAxCompareBody(){
  const head=_siAxTrayHtml();
  const sel=`<div class="si-ax-bar"><span class="si-ax-lab">Metric</span><select class="si-ax-select" onchange="window._siAxSetMetric(this.value)">${Object.keys(_SI_AX_METRICS).map(k=>`<option value="${k}"${_siAxMetric===k?' selected':''}>${_siEsc(_SI_AX_METRICS[k].label)}</option>`).join('')}</select>
    <span class="si-ax-lab" style="margin-left:8px">Time basis</span>
    <button class="si-ax-btn${_siAxBasis==='calendar'?' on':''}" aria-pressed="${_siAxBasis==='calendar'}" onclick="window._siAxSetBasis('calendar')">Calendar</button>
    <button class="si-ax-btn${_siAxBasis==='launch'?' on':''}" aria-pressed="${_siAxBasis==='launch'}" onclick="window._siAxSetBasis('launch')">Since launch</button>
    <button class="si-ax-btn" title="${_siAxTip('curve')}" onclick="window._siAxCurvePreset()">Age-normalised curve</button></div>${_siAxBasis==='calendar'?_siAxCalOptsHtml():''}`;
  if(!_siAxCmp.length)return head+sel+_siAxCoverage([])+`<div class="si-ax-empty">Nothing to compare yet.</div>`;
  const d=_siAxCompareData();
  const fmtv=_siAxMetricFmt(d.M);
  const monthsView=_siAxBasis==='calendar'&&_siAxWin==='months';
  const chart=monthsView?_siAxMonthsHtml(d.arts,d.M):_siAxChartHtml({bucketWord:d.ser.bucket==='month'?'month':'week',series:d.chartSeries,xLabels:d.ser.xLabels,xTicks:d.ser.xTicks,integer:!d.M.money&&!d.M.kind,money:!!d.M.money,fmt:d.M.kind?fmtv:undefined,empty:'None of the selected articles has sales in the synced data for this view, so there is no line to draw.',aria:d.M.label+' — '+d.ser.basis+' basis'});
  const cell=v=>v==null?'—':_siEsc(fmtv(v));
  const totalHead=d.M.cum?'Cumulative at end':(d.M.kind?'Latest':d.M.label+' — total');
  const art=[{key:'n',label:'#',type:'num',first:'asc',get:r=>r.i,cell:r=>`<td><i class="si-ax-badge si-ax-b${r.i}">${r.i+1}</i></td>`},
    {key:'art',label:'Article',type:'text',get:r=>_siAxLabel(r.art),cell:r=>`<td style="font-weight:600">${_siEsc(_siAxLabel(r.art))}<div class="si-ax-note" style="margin:0">${_siEsc(r.art.code)}</div></td>`}];
  const ties=[{get:r=>r.art.units,type:'num',dir:-1},{get:r=>r.art.code,type:'code',dir:1}];
  const dnote=(v,t)=>v==null?'':`<div class="si-ax-note" style="margin:0">${_siEsc(t)}</div>`;
  const tbl=_siSortTable('ax-compare',art.concat([
    {key:'live',label:'Live',type:'date',first:'desc',get:r=>r.art.liveDay,cell:r=>`<td>${_siEsc(_siAxLiveText(r.art))}<div class="si-ax-note" style="margin:0">${_siEsc(_siAxAgeText(r.art))}</div></td>`},
    {key:'units',label:'Units (counted)',type:'num',get:r=>r.art.units,cell:r=>`<td>${r.art.units}</td>`},
    {key:'rev',label:'Revenue (counted)',type:'num',get:r=>r.art.hasPrice?r.art.rev:null,cell:r=>`<td>${r.art.hasPrice?_siEsc(_siPKR(Math.round(r.art.rev))):'—'}</td>`},
    {key:'u30',label:'7d / 30d',type:'num',get:r=>r.u30,cell:r=>`<td>${r.u7} / ${r.u30}</td>`},
    {key:'total',label:totalHead,type:'num',get:r=>r.total,cell:r=>`<td>${cell(r.total)}</td>`},
    {key:'peak',label:'Peak',type:'num',get:r=>r.peak,cell:r=>`<td>${cell(r.peak)} <span class="si-ax-note">${_siEsc(r.peakLabel)}</span></td>`}
  ]),d.rows,{def:{key:'n',dir:1},defText:'the order you added them',minWidth:720,ties});
  const dash=v=>v==null?'—':_siEsc(String(v));
  const pace=_siSortTable('ax-pace',art.concat([
    {key:'days',label:'Counted days',title:'Counted days: from the later of the live date and the first synced order, to today',type:'num',get:r=>r.m.days,cell:r=>`<td>${dash(r.m.days)}${r.m.partial?'<div class="si-ax-note" style="margin:0">from first order</div>':''}</td>`},
    {key:'rate',label:'Units / live week',title:_siAxTip('rate'),type:'num',get:r=>r.m.rateWeek,cell:r=>`<td>${_siAxNum(r.m.rateWeek)}</td>`},
    {key:'pace',label:'Last 28 d / week',title:_siAxTip('pace'),type:'num',get:r=>r.m.pace28,cell:r=>`<td>${_siAxNum(r.m.pace28)}</td>`},
    {key:'mom',label:'Momentum',title:_siAxTip('mom'),type:'text',get:r=>r.m.momWord,cell:r=>`<td>${_siEsc(_siAxMomText(r.m))}</td>`},
    {key:'cover',label:'Weeks of cover',title:_siAxTip('cover'),type:'num',first:'asc',get:r=>r.m.cover,cell:r=>`<td>${_siEsc(_siAxCoverText(r.m))}${r.m.cover!=null?'<div class="si-ax-note" style="margin:0">'+_siEsc(_siAxCoverNote(r.m))+'</div>':''}</td>`},
    {key:'st',label:'Sell-through',title:_siAxTip('st'),type:'num',get:r=>r.m.st&&r.m.st.value,cell:r=>`<td>${_siAxPct(r.m.st&&r.m.st.value)}${r.m.st?'<div class="si-ax-note" style="margin:0">'+_siEsc(_siAxFmtDay(r.m.st.from,true)+' – '+_siAxFmtDay(r.m.st.to,true))+'</div>':''}</td>`},
    {key:'inr',label:'In-stock rate',title:_siAxTip('inrate'),type:'num',get:r=>r.m.inRate,cell:r=>`<td>${_siAxPct(r.m.inRate)}</td>`},
    {key:'pid',label:'Units / in-stock day',title:_siAxTip('perday'),type:'num',get:r=>r.m.perInDay,cell:r=>`<td>${_siAxNum(r.m.perInDay,2)}</td>`},
    {key:'out',label:'Stock-out days',title:_siAxTip('out'),type:'num',get:r=>r.m.outDays,cell:r=>`<td>${r.m.outDays!=null?r.m.outDays+'<div class="si-ax-note" style="margin:0">of '+r.m.measured+'</div>':'—'}</td>`},
    {key:'avl',label:'Sizes in stock',title:_siAxTip('avl'),type:'num',get:r=>r.m.sizesNow&&r.m.sizesNow.n,cell:r=>`<td>${r.m.sizesNow?r.m.sizesNow.n+' of '+r.m.sizesNow.of:'—'}${r.m.risk.length?'<div class="si-ax-note" style="margin:0"><span class="si-ax-flag">at risk</span> '+_siEsc(r.m.risk.map(x=>x.size).join(', '))+'</div>':''}</td>`}
  ]),d.rows,{def:{key:'n',dir:1},defText:'the order you added them',minWidth:980,ties});
  const shape=_siSortTable('ax-shape',art.concat([
    {key:'sell',label:'Selling weeks',title:_siAxTip('sell'),type:'num',get:r=>r.m.sellingWeeks,cell:r=>`<td>${r.m.sellingWeeks!=null?r.m.sellingWeeks+' of '+r.m.blocks:'—'}</td>`},
    {key:'peak',label:'Peak week',title:_siAxTip('peak'),type:'num',get:r=>r.m.peak&&r.m.peak.u,cell:r=>`<td>${r.m.peak?r.m.peak.u+' units<div class="si-ax-note" style="margin:0">'+_siEsc(_siAxFmtDay(r.m.peak.start,true))+'</div>':'—'}</td>`},
    {key:'f4',label:'First 4 weeks',title:_siAxTip('first4'),type:'num',get:r=>r.m.first4,cell:r=>`<td>${dash(r.m.first4)}${r.m.first4==null&&r.art.liveDay&&r.m.partial?'<div class="si-ax-note" style="margin:0">launch before data</div>':''}</td>`},
    {key:'share',label:'Share of category (28 d)',title:_siAxTip('share'),type:'num',get:r=>r.m.catShare28,cell:r=>`<td>${_siAxPct(r.m.catShare28)}</td>`},
    {key:'void',label:'Voided units',title:_siAxTip('void'),type:'num',get:r=>r.m.voided,cell:r=>`<td>${r.m.voided!=null?r.m.voided:'—'}</td>`},
    {key:'vrate',label:'Void rate',title:_siAxTip('void'),type:'num',get:r=>r.m.voidRate,cell:r=>`<td>${_siAxPct(r.m.voidRate)}</td>`},
    {key:'refund',label:'Refunded units',title:_siAxTip('refund'),type:'num',get:r=>r.m.refunded,cell:r=>`<td>${r.m.refunded!=null?r.m.refunded:'—'}</td>`},
    {key:'asp',label:'Avg unit price',title:_siAxTip('asp'),type:'num',get:r=>r.m.asp,cell:r=>`<td>${r.m.asp!=null?_siEsc(_siPKR(Math.round(r.m.asp))):'—'}</td>`}
  ]),d.rows,{def:{key:'n',dir:1},defText:'the order you added them',minWidth:900,ties});
  const winNote=_siAxBasis!=='calendar'?'':(_siAxWin==='winter'?' Winter window: '+_siAxFmtDay(d.ser.win.from)+' to '+_siAxFmtDay(d.ser.win.to)+' (October to the end of February); part of the window that has not happened yet is left empty, not zero.':(monthsView?' Month by month: every month from the first synced orders up to the current one (the latest twelve; use the arrows for earlier ones), winter months frosted; units (or revenue) per month, the current month is marked so far, and an article not yet live in a month reads no data. Months before the synced orders and months still ahead are not shown.':''));
  const basisNote=d.ser.basis==='launch'?'Since launch: x-axis is weeks (or months) since each article\'s live date, so products from different years line up at the same age.':'Calendar: the same dates on the x-axis; a line starts when the article went live.';
  // The chart comes first, right under the controls: it used to sit below the scorecard and the "Read this" block, so a click on
  // Calendar / Since launch changed nothing anyone could see without scrolling past them.
  const chartCard=`<div class="card${_siAxBasis==='calendar'&&_siAxWin!=='all'?' si-ax-frost':''}" id="si-ax-chartcard"><div class="card-title">${_siEsc(monthsView?d.M.label.replace(/ per (week|month)$/,'')+' — month by month':d.M.label)}</div>${chart}${_siAxPrevNote(d)}<div class="si-ax-note">${_siEsc(basisNote)}${_siEsc(winNote)} The latest bucket is still running. ${_siEsc(d.ser.notes.join(' '))}</div></div>`;
  return head+`<div id="si-ax-result" class="si-ax-resultwrap" tabindex="-1">`+sel+chartCard+_siAxCoverage(d.arts)+_siAxHistBanner()+_siAxScorecardHtml(d.arts)+_siAxReadBlock(d.arts)+`
  <div class="card"><div class="card-title">Comparison table</div>${tbl}</div>
  <div class="card"><div class="card-title">Pace and stock <span class="si-ax-note">(counted window; in-stock figures: snapshot window)</span></div>${pace}<div class="si-ax-note" style="margin-top:8px">${_siAxNeedsHistoryNote()}</div></div>
  <div class="card"><div class="card-title">Shape and context</div>${shape}</div>
  ${_siAxDefsHtml()}</div>`;
}

// ── Needs Attention (Oct 2026) ──────────────────────────────────────
// ONE flat ranked list of ARTICLES (never variants), built on the Article Explorer's own helpers (_siAxStats, _siAxClassify,
// _siAxActionOf, _siAxLeadTime, _siAxConfidence, momentum, sizeRows) so this tab and the Explorer cannot disagree.
// Three pure layers: _siNaDetect (rules, one article -> issues), _siNaBuild (rank, bands, uncapped counts) and
// _siNaPlaybook (situation, why, actions, avoid, confidence). Rendering escapes every string once, at the boundary.
// Every number is a labelled DEFAULT (docs/UNITS_METRICS.md "Needs Attention"); missing data is "—", never 0.
const _SI_NA={
  capCritical:5,capAct:8,capWatch:5,
  minUnits28:10,minPerInDay:1,                       // evidence floor: 10+ units in 28 days or 1+ unit per in-stock day (and confidence above Low)
  critGapFrac:0.5,                                   // critical when cover is under half the lead time
  sizeShare:0.15,sizeOutUnits:3,sizeThinUnits:4,sizeThinDays:14,sizeBigShare:0.20,sizeBigUnits:10,minArticleUnits28:8,
  deadMinStock:5,deadMinAge:56,
  overCoverWeeks:26,overMinValue:100000,bigValue:500000,bigCoverWeeks:52,
  risePastLeadDays:28,fadeBigDrop:0.4,
  suddenBase:5,suddenZ:-2.5,suddenInStockDays:5,
  discPrice:0.85,discShare:0.5,discUnits:10,
  voidRate:0.10,voidUnits:5,
  qtyBand:0.25,pack:12,coverTarget:28,coverTargetWinner:35,
  staleSnapHours:26,staleOrderHours:8,gapDays:14,
  seasonFrom:'0915',seasonTo:'1130',
  saleMinUnits:5,                                    // Sales loss: an estimated 5+ units lost to stock-outs in the last 90 days (the Portfolio's own estimate)
  retDays:90,retMinUnits:20,retRate:0.15,retMult:2,retZ:1.645,retFloor:0.02,retActRate:0.25   // High return rate, see UNITS_METRICS 3b
};
const _SI_NA_GROUP={stockout:'stock',runout:'stock',sizehole:'stock',overstock:'cash',dead:'cash',rising:'demand',demanddrop:'demand',datatrust:'data',saleloss:'stock',returns:'demand',winner:'demand'};
const _SI_NA_REASON={stockout:'Out of stock',runout:'Runs out before restock',sizehole:'Size hole',overstock:'Overstocked',dead:'Dead stock',rising:'Demand rising, thin stock',demanddrop:'Demand dropped',datatrust:'Check the numbers',saleloss:'Sales loss',returns:'High return rate',winner:'Top seller'};
const _SI_NA_BANDS=[{k:'critical',l:'Critical',cap:'capCritical',sub:'act today'},{k:'act',l:'Act this week',cap:'capAct',sub:'decide this week'},{k:'watch',l:'Watch',cap:'capWatch',sub:'plan, no action yet'}];
// Reason chips, ordered by severity: act today, money already lost, a quality signal, cash tied up, no demand signal, demand moving.
// An article can sit under several (a size hole is also lost sales); each list is a set of ARTICLES and its count is the list's length.
// 'Cash tied up' is not a chip any more (it was exactly Overstocked + Dead stock); 'cash' is still accepted by _siNaGo for the Overview tile.
const _SI_NA_REASONS=[
  {k:'urgent',l:'Urgent restocks',types:['stockout','runout','sizehole'],what:'Out of a proven seller, will run out before a new batch can land, or a best-selling size is out. Reorder or cut the missing sizes first.'},
  {k:'saleloss',l:'Sales loss',what:'Stock-outs in the last 90 days that cost sales. The figures are estimates from the stock-vs-sales timeline (the Portfolio sums the same ones), not counts.'},
  {k:'returns',l:'High return rate',what:'Units come back far more than for the rest of the catalogue. Check size chart, photos and fabric before reordering.'},
  {k:'overstock',l:'Overstocked',types:['overstock'],what:'More stock than will sell for months. Stop reordering, promote or bundle, then mark down in steps.'},
  {k:'dead',l:'Dead stock',types:['dead'],what:'Stock on hand and nothing sold. Check the listing, then bundle or clear it.'},
  {k:'demand',l:'Demand shifts',types:['rising','demanddrop'],what:'Selling faster with thin stock, or a seller that has slowed. Find out why before ordering or discounting.'}
];
const _SI_NA_FILTER_KEYS=['all','cash'].concat(_SI_NA_REASONS.map(x=>x.k));
let _siNaSel='',_siNaFilter='all',_siNaBand='',_siNaFlash='',_siAxOvSit='',_siNaShow={critical:false,act:false,watch:false},_siNaWatchOpen=false,_siNaReturnY=0,_siNaMemo=null,_siNaKeyWired=false,_siNaNowMs=null;

function _siNaNow(){return _siNaNowMs!=null?_siNaNowMs:Date.now();}
function _siNaIsPhone(){try{return typeof window!=='undefined'&&typeof window.matchMedia==='function'&&!!window.matchMedia('(max-width:600px)').matches;}catch(_){return false;}}
function _siNaPerDay(m){
  if(m.perInDay!=null)return m.perInDay;
  if(m.paceHead!=null)return m.paceHead/7;
  if(m.pace28!=null)return m.pace28/7;
  return null;
}
// Enough sales to speak: confidence above Low AND (10+ units in 28 days OR 1+ unit per in-stock day).
function _siNaEvidence(r){
  const m=r.m,C=_SI_NA;
  return r.conf.lvl>0&&((m.units28!=null&&m.units28>=C.minUnits28)||(m.perInDay!=null&&m.perInDay>=C.minPerInDay));
}
// Units that were sold below 85% of the article's usual price (the unit-weighted median of the daily average price over the 56 days before
// the last 7). A proxy: line items carry no discount field. Returns null without 10+ units in the last 7 days or without prices.
function _siNaDiscount(a,today){
  const C=_SI_NA;if(!a||!a.daily||!a.hasPrice)return null;
  const Tn=_siAxDayNum(today);if(Tn==null)return null;
  const s7=_siAxDayStr(Tn-6),b0=_siAxDayStr(Tn-62);let U7=0;const pts=[];
  a.daily.forEach((d,day)=>{
    if(!d.u)return;
    if(day>=s7&&day<=today)U7+=d.u;
    else if(day>=b0&&day<s7)pts.push([d.r/d.u,d.u]);
  });
  if(U7<C.discUnits||!pts.length)return null;
  pts.sort((x,y)=>x[0]-y[0]);let tot=0;pts.forEach(p=>{tot+=p[1];});
  let acc=0,base=pts[0][0];for(const p of pts){acc+=p[1];if(acc>=tot/2){base=p[0];break;}}
  if(!(base>0))return null;
  let D=0;a.daily.forEach((d,day)=>{if(d.u&&day>=s7&&day<=today&&d.r/d.u<C.discPrice*base)D+=d.u;});
  return{units7:U7,disc:D,share:D/U7,base};
}
// Last 7 days against the mean of the 4 weeks before: base 5+ a week, Poisson z below -2.5, and in stock on 5+ of the 7 days (so a stock-out
// is never blamed on demand). Without stock history the in-stock check cannot pass, so nothing is said.
function _siNaSudden(a,m,today){
  const C=_SI_NA,Tn=_siAxDayNum(today);
  if(Tn==null||m.days==null||m.days<35)return null;
  const last=_siAxUnitsBetween(a,_siAxDayStr(Tn-6),today),prior=_siAxUnitsBetween(a,_siAxDayStr(Tn-34),_siAxDayStr(Tn-7)),base=prior/4;
  if(base<C.suddenBase)return null;
  const z=(last-base)/Math.sqrt(base);if(!(z<C.suddenZ))return null;
  const ex=_siAxExposure(a,_siAxDayStr(Tn-6),today);if(ex.inStock<C.suddenInStockDays)return null;
  return{last,base,z};
}
// Winter stock is not "dead" while winter is starting (15 Sept to 30 Nov): hoodies, zippers, jackets, or anything tagged season:winter.
function _siNaWinter(a,today){
  const md=String(today||'').slice(5).replace('-','');
  if(md<_SI_NA.seasonFrom||md>_SI_NA.seasonTo)return false;
  if(/hood|zip|jacket|coat|fleece|sweat/i.test(a&&a.category||''))return true;
  try{const sm=_siSeasonMap();for(const s of (a&&a.skus)||[]){if(sm[s]==='winter')return true;}}catch(_){}
  return false;
}
// Reorder size guide: demand per day x (lead time + cover target) minus what is on hand, as a range (pace +/- 25%, because returns
// are not synced and read the pace high), rounded UP to a pack of 12. null when even the top of the range needs nothing.
function _siNaQty(perDay,lead,onHand,cls){
  const C=_SI_NA;if(perDay==null||!(perDay>0)||lead==null)return null;
  const tgt=cls==='winner'?C.coverTargetWinner:C.coverTarget,span=lead+tgt;
  const up=v=>Math.max(0,Math.ceil(v/C.pack)*C.pack);
  const lo=up(perDay*(1-C.qtyBand)*span-(onHand||0)),hi=up(perDay*(1+C.qtyBand)*span-(onHand||0));
  if(hi<=0)return null;
  return{lo,hi,target:tgt};
}
function _siNaRow(a){return{a,m:_siAxStats(a),c:_siAxClassify(a),act:_siAxActionOf(a),lt:_siAxLeadTime(a),conf:_siAxConfidence(a)};}
function _siNaSizeRows(m,lead){
  return(m.sizeRows||[]).filter(s=>s.stock!=null||s.sold>0).map(s=>{
    const cd=(s.stock!=null&&s.recent>0)?s.stock/(s.recent/28):null;
    let st='ok';
    if(s.stock==null)st='—';
    else if(s.stock===0)st=s.recent>0?'out':'out, no recent sales';
    else if(cd!=null&&cd<_SI_NA.sizeThinDays&&s.recent>=_SI_NA.sizeThinUnits)st='thin';
    else if((s.recent===0&&s.stock>=8)||(cd!=null&&cd>_SI_NA.overCoverWeeks*7))st='deep';
    return{size:s.size,stock:s.stock,units28:s.recent,sold:s.sold,coverDays:cd,state:st};
  });
}
// One issue object for an article (also used for the reason views and the Overview's situation view). Pure given row {a,m,c,act,lt,conf} and ctx.
function _siNaMk(r,ctx,type,band,extra){
  const a=r.a,m=r.m,c=r.c,lt=r.lt,cls=c.cls,pd=_siNaPerDay(m),lead=lt.days,cd=m.coverDays,asp=m.asp;
  const disc=ctx&&ctx.disc?ctx.disc(a):null;
  return Object.assign({
    type,group:_SI_NA_GROUP[type],code:a.code,label:_siAxLabel?_siAxLabel(a):(a.name||a.code),cls,clsLabel:c.label,band,reason:_SI_NA_REASON[type],
    at:null,atKind:'',lost:null,also:[],seasonal:false,rising:false,conf:r.conf.level,
    n:{onHand:a.hasStock?a.onHand:null,coverDays:cd,cover:m.cover,coverText:_siAxCoverText(m),leadDays:lead,leadSrc:lt.source,leadText:lt.text,units28:m.units28,
      prev28:(m.momUnits!=null&&m.units28!=null)?m.momUnits-m.units28:null,perDay:pd,perInDay:m.perInDay,inRate:m.inRate,outDays:m.outDays,measured:m.measured,asp,
      momentum:m.momentum,momWord:m.momWord,voidRate:m.voidRate,voided:m.voided,days:m.days,units:m.units,pace28Days:m.pace28Days,
      confName:r.conf.name,confWhy:r.conf.why.slice(),confCaps:r.conf.caps.slice(),sizes:_siNaSizeRows(m,lead),valueTied:null,disc:disc||null,
      qty:null,gapDays:null,missed:null,holes:[],sudden:null,returnsSynced:ctx?ctx.returnsSynced:null,actKey:r.act&&r.act.key,actText:r.act&&r.act.text}
  },extra||{});
}
// One article -> its issues (strongest first). Pure given the row {a,m,c,act,lt,conf} and ctx {today,disc(a),sudden(a,m),winter(a)}.
function _siNaDetect(r,ctx){
  const a=r.a,m=r.m,c=r.c,lt=r.lt,C=_SI_NA,cls=c.cls,out=[];
  if(cls==='early'||cls==='unrated')return out;
  const ev=_siNaEvidence(r),pd=_siNaPerDay(m),lead=lt.days,cd=m.coverDays,asp=m.asp;
  const sellers=cls==='winner'||cls==='solid'||cls==='steady'||cls==='constrained';
  const disc=ctx&&ctx.disc?ctx.disc(a):null;
  const rising=m.momWord==='Rising';
  const money=u=>(asp!=null&&u!=null)?u*asp:null;
  const mk=(type,band,extra)=>_siNaMk(r,ctx,type,band,extra);
  // 1. out of stock while it is a proven seller
  if(a.hasStock&&a.onHand===0&&(cls==='winner'||cls==='solid'||cls==='constrained')&&m.units28>0&&ev){   // units28>0: the Explorer calls a zero-stock article with no recent sales "Out of stock, no recent sales" (watch), not a reorder
    const lostU=pd!=null?pd*lead:null;
    const x=mk('stockout','critical',{lost:lostU,at:money(lostU),atKind:'lost sales over one lead time'});
    x.n.missed=(m.perInDay!=null&&m.outDays!=null)?Math.round(m.perInDay*m.outDays):null;x.n.gapDays=lead;
    x.n.qty=_siNaQty(pd,lead,0,cls);x.rising=rising;out.push(x);
  }
  // 2. will run out before a batch can land (cover shorter than the lead time)
  if(a.hasStock&&a.onHand>0&&sellers&&cd!=null&&cd<lead&&ev){
    const gap=lead-cd,lostU=pd!=null?pd*gap:null;
    const x=mk('runout',cd<lead*C.critGapFrac?'critical':'act',{lost:lostU,at:money(lostU),atKind:'lost sales in the gap'});
    x.n.gapDays=gap;x.n.qty=_siNaQty(pd,lead,a.onHand,cls);x.rising=rising;out.push(x);
  }
  // 3. size holes: the article is fine overall but a size that carries 15%+ of its sales is out or thin
  if(a.hasStock&&a.onHand>0&&sellers&&m.units28!=null&&m.units28>=C.minArticleUnits28&&r.conf.lvl>0&&(cd==null||cd>=lead)){
    const holes=[];
    (m.sizeRows||[]).forEach(s=>{
      if(s.size==='Unknown'||s.stock==null||!(m.units28>0))return;
      const share=s.recent/m.units28;if(share<C.sizeShare)return;
      if(s.stock===0&&s.recent>=C.sizeOutUnits)holes.push({size:s.size,kind:'out',units28:s.recent,share,stock:0});
      else if(s.stock>0&&s.recent>=C.sizeThinUnits&&s.stock/(s.recent/28)<C.sizeThinDays)holes.push({size:s.size,kind:'thin',units28:s.recent,share,stock:s.stock});
    });
    if(holes.length){
      const lostU=holes.reduce((t,h)=>t+h.units28,0);
      const big=holes.some(h=>h.kind==='out'&&(h.share>=C.sizeBigShare||h.units28>=C.sizeBigUnits));
      const x=mk('sizehole',big?'act':'watch',{lost:lostU,at:money(lostU),atKind:'28-day sales of the size'});
      x.n.holes=holes;out.push(x);
    }
  }
  // 4. demand rising while stock is thin but not yet behind the lead time (behind it, it is a run-out with a rising chip)
  if(a.hasStock&&a.onHand>0&&sellers&&rising&&cd!=null&&cd>=lead&&cd<lead+C.risePastLeadDays&&ev&&!(disc&&disc.share>C.discShare)){
    const x=mk('rising','act',{lost:null,at:money(m.units28),atKind:'28-day sales'});x.rising=true;
    x.n.qty=_siNaQty(pd,lead,a.onHand,cls);out.push(x);
  }
  // 5. demand fell: a winner or solid article, in stock most days (so stock-outs do not explain it), and a gap bigger than chance
  if((cls==='winner'||cls==='solid')&&m.momWord==='Fading'&&(m.inRate==null||m.inRate>=0.7)){
    const drop=m.momentum!=null?m.momentum:null,prev=(m.momUnits!=null&&m.units28!=null)?m.momUnits-m.units28:null;
    const x=mk('demanddrop',(drop!=null&&drop<=-C.fadeBigDrop)?'act':'watch',{lost:prev!=null?prev-m.units28:null,at:money(prev!=null?prev-m.units28:null),atKind:'28-day sales lost'});
    out.push(x);
  }else if(a.hasStock&&sellers&&ctx&&ctx.sudden){
    const sd=ctx.sudden(a,m);
    if(sd){const x=mk('demanddrop','watch',{lost:sd.base-sd.last,at:money(sd.base-sd.last),atKind:'one week of sales lost'});x.n.sudden=sd;out.push(x);}
  }
  // 6. cash: dead and overstocked stock at article level, value at SELLING price (no cost is stored)
  if(a.hasStock&&a.onHand>0){
    const val=asp!=null?a.onHand*asp:null,winter=!!(ctx&&ctx.winter&&ctx.winter(a));
    const wk=m.cover;
    if(cls==='dead'&&a.onHand>=C.deadMinStock&&m.days>=C.deadMinAge){
      const x=mk('dead',(val!=null&&val>=C.overMinValue)?'act':'watch',{at:val,atKind:'tied up at selling price'});
      x.n.valueTied=val;
      if(winter){x.band='watch';x.seasonal=true;}
      out.push(x);
    }else if(cls!=='dead'&&((cls==='slow'&&r.act&&(r.act.key==='stuck'||r.act.key==='markdown'))||(wk!=null&&wk>=C.overCoverWeeks&&val!=null&&val>=C.overMinValue))){
      const big=(wk!=null&&wk>=C.bigCoverWeeks)||(val!=null&&val>=C.bigValue);
      const x=mk('overstock',big?'act':'watch',{at:val,atKind:'tied up at selling price'});
      x.n.valueTied=val;
      if(winter){x.band='watch';x.seasonal=true;}
      out.push(x);
    }
  }
  // 7. the numbers themselves: many of its units were voided
  if(m.voidRate!=null&&m.voidRate>=C.voidRate&&m.voided>=C.voidUnits){
    out.push(mk('datatrust','watch',{atKind:''}));
  }
  return out;
}
const _SI_NA_BAND_RANK={critical:0,act:1,watch:2};
function _siNaCmp(x,y){
  const ba=_SI_NA_BAND_RANK[x.band]-_SI_NA_BAND_RANK[y.band];if(ba)return ba;
  const ax=x.at==null?-1:x.at,ay=y.at==null?-1:y.at;if(ax!==ay)return ay-ax;
  const lx=x.lost==null?-1:x.lost,ly=y.lost==null?-1:y.lost;if(lx!==ly)return ly-lx;
  return(_siSortClassRank(x.clsLabel)-_siSortClassRank(y.clsLabel))||_siSortNat(x.code,y.code);
}
// Units sold, returned and the return rate over the last 90 counted days (never before the article's counted start).
// gross = net units + refunded units (voided units are not sales); rate = refunded / gross. null when nothing is counted.
function _siNaRet90(a,m,today){
  const C=_SI_NA;
  if(!a||!m||!m.E)return null;
  const Tn=_siAxDayNum(today),En=_siAxDayNum(m.E);if(Tn==null||En==null||En>Tn)return null;
  const Sn=Math.max(En,Tn-(C.retDays-1)),s0=_siAxDayStr(Sn);
  const units=_siAxUnitsBetween(a,s0,today);let ref=0;
  if(a.xdaily)a.xdaily.forEach((d,day)=>{if(day>=s0&&day<=today)ref+=d.r;});
  const gross=units+ref;
  return{units,ref,gross,rate:gross>0?ref/gross:null,days:Tn-Sn+1};
}
// Which articles come back too often. Only when returns are synced (otherwise the answer is "waiting", never a guess). Guards: 20+ units
// sold in 90 days; a rate of 15%+ AND at least twice the median rate of articles that pass the 20-unit floor; and a gap bigger than chance
// (one-sided z >= 1.645 against the median, floored at 2%, so a handful of returns on a small article is not an alert).
function _siNaReturnsPlan(rows,ctx){
  const C=_SI_NA,out={synced:!!(ctx&&ctx.returnsSynced===true),eligible:0,median:null,floorP:null,flag:new Map()};
  if(!out.synced||!ctx.ret)return out;
  const el=[];rows.forEach(r=>{const x=ctx.ret(r.a,r.m);if(x&&x.rate!=null&&x.gross>=C.retMinUnits){r.ret=x;el.push(r);}});
  out.eligible=el.length;if(!el.length)return out;
  const rates=el.map(r=>r.ret.rate).sort((x,y)=>x-y),mid=rates.length>>1;
  out.median=rates.length%2?rates[mid]:(rates[mid-1]+rates[mid])/2;
  out.floorP=Math.max(out.median,C.retFloor);
  el.forEach(r=>{
    const g=r.ret.gross,k=r.ret.ref,rate=r.ret.rate;
    if(rate<C.retRate||rate<C.retMult*out.median)return;
    const z=(k-g*out.floorP-0.5)/Math.sqrt(g*out.floorP*(1-out.floorP));
    if(z<C.retZ)return;
    out.flag.set(r.a.code,{z});
  });
  return out;
}
// Rows -> {issues (ranked, one per article), counts (UNCAPPED), reasons (one list of ARTICLES per chip)}. One primary issue per article; the
// others ride along as `also` (types) and `alts` (the issue objects). A reason list holds the article's issue of that reason; its length IS the chip count.
function _siNaBuild(rows,ctx){
  const C=_SI_NA,issues=[],reasons={};_SI_NA_REASONS.forEach(x=>{reasons[x.k]=[];});
  const plan=_siNaReturnsPlan(rows,ctx);
  rows.forEach(r=>{
    const all=_siNaDetect(r,ctx);
    if(all.length){const p=all[0];p.also=all.slice(1).map(x=>x.type);p.alts=all.slice(1);issues.push(p);}
    _SI_NA_REASONS.forEach(x=>{if(!x.types)return;const hit=all.find(d=>x.types.indexOf(d.type)>=0);if(hit)reasons[x.k].push(hit);});
    if(ctx&&ctx.lost&&r.c.cls!=='early'&&r.c.cls!=='unrated'){
      const s=ctx.lost(r.a);
      if(s&&s.lost&&s.lost.mid>=C.saleMinUnits){
        const base=all.find(d=>d.type==='stockout'||d.type==='runout'||d.type==='sizehole');
        const rs=s.price!=null?s.lost.mid*s.price:null;
        const x=_siNaMk(r,ctx,'saleloss',base?base.band:'watch',{lost:s.lost.mid,at:rs,atKind:'estimated sales lost to stock-outs in the last '+(ctx.lostDays||90)+' days'});
        x.n.sales={lo:s.lost.lo,hi:s.lost.hi,mid:s.lost.mid,days:s.lost.days,pace:s.lost.pace,price:s.price,ongoing:!!s.ongoing,notEstimated:s.notEstimated||0,windowDays:ctx.lostDays||90};
        reasons.saleloss.push(x);
      }
    }
    const fl=plan.flag.get(r.a.code);
    if(fl&&r.ret){
      const asp=r.m.asp,x=_siNaMk(r,ctx,'returns',r.ret.rate>=C.retActRate?'act':'watch',{lost:r.ret.ref,at:asp!=null?r.ret.ref*asp:null,atKind:'returned at selling price, last '+C.retDays+' days'});
      x.n.ret={ref:r.ret.ref,gross:r.ret.gross,rate:r.ret.rate,median:plan.median,days:r.ret.days,z:fl.z,eligible:plan.eligible};
      reasons.returns.push(x);
    }
  });
  issues.sort(_siNaCmp);
  Object.keys(reasons).forEach(k=>reasons[k].sort(_siNaCmp));
  const counts={critical:0,act:0,watch:0,byGroup:{stock:0,cash:0,demand:0,data:0},cashValue:0,cashNoValue:0};
  issues.forEach(i=>{
    counts[i.band]++;counts.byGroup[i.group]++;
    if(i.group==='cash'){if(i.n.valueTied==null)counts.cashNoValue++;else counts.cashValue+=i.n.valueTied;}
  });
  counts.action=counts.critical+counts.act;counts.total=counts.action+counts.watch;
  return{issues,counts,reasons,unavailable:{saleloss:!(ctx&&ctx.lost),returns:!plan.synced},returnsInfo:{synced:plan.synced,median:plan.median,eligible:plan.eligible}};
}
function _siNaCtx(){
  const today=_siPktDate(0);
  let rs=null;try{rs=_siAxIndex().quality.returns.synced;}catch(_){}
  return{today,returnsSynced:rs,disc:a=>_siNaDiscount(a,today),sudden:(a,m)=>_siNaSudden(a,m,today),winter:a=>_siNaWinter(a,today),ret:(a,m)=>_siNaRet90(a,m,today),
    lost:_siHistState==='ok'?_siAxPfLostOf:null,lostDays:_SI_PF.lostDays};
}
// The ranked issues for the loaded data. Memoised on the index object, today and the lead-time settings (the only inputs that change without
// a data reload), so the tab pill, the Overview tiles and the list read ONE computation.
function _siNaState(){
  const idx=_siAxIndex();
  let lt='';try{lt=(localStorage.getItem(_SI_LT_KEY)||'')+'|'+(localStorage.getItem(_SI_LT_ART_KEY)||'');}catch(_){}
  const sig=_siPktDate(0)+'|'+lt+'|'+_siHistState+'|'+_siIgKey();
  if(_siNaMemo&&_siNaMemo.idx===idx&&_siNaMemo.sig===sig)return _siNaMemo.res;
  const rows=_siAxLive().filter(a=>a.units>0||a.hasStock).map(_siNaRow);
  const res=_siNaBuild(rows,_siNaCtx());
  res.rows=rows.length;
  res.skipped=rows.filter(r=>r.c.cls==='early'||r.c.cls==='unrated').length;
  res.closest=_siNaClosest(rows);
  _siNaMemo={idx,sig,res};return res;
}
// The in-stock seller nearest the line, for the all-clear sentence: smallest (cover days - lead days) among those with evidence.
function _siNaClosest(rows){
  let best=null;
  rows.forEach(r=>{
    const m=r.m,cls=r.c.cls;
    if(!(r.a.hasStock&&r.a.onHand>0)||!(cls==='winner'||cls==='solid'||cls==='steady'||cls==='constrained')||m.coverDays==null||!_siNaEvidence(r))return;
    const gap=m.coverDays-r.lt.days;
    if(!best||gap<best.gap)best={code:r.a.code,label:_siAxLabel(r.a),gap,coverDays:m.coverDays,lead:r.lt.days};
  });
  return best;
}
// The pill on the tab and the count the Overview shows: critical + act (the things that need an action). Watch is shown, not counted.
function _siNaBadge(){
  if(!_siFullHist())return null; // classes need each article's whole history
  if(_siHistState!=='ok'&&_siHistState!=='error')return null;
  try{return _siNaState().counts.action;}catch(_){return null;}
}

// ── Data trust ──────────────────────────────────────────────────────
function _siNaAge(ms){
  const h=ms/3600000;
  if(h<1)return Math.max(1,Math.round(ms/60000))+' minutes';
  if(h<48)return Math.round(h)+' hours';
  return Math.round(h/24)+' days';
}
// What makes the lists below wrong (red), what is worth knowing (amber), what is background (quiet), what is simply not known (unknown).
// Pure given ctx {now,today,snapshot,meta,hist,histState,histError,quality}. Missing meta is "unknown", never "fine".
function _siNaTrustOf(ctx){
  const C=_SI_NA,red=[],amber=[],quiet=[],unknown=[];
  const snap=ctx.snapshot,meta=ctx.meta||{},q=ctx.quality;
  const lastErr=m=>m&&m.last_error?' Last error: '+String(m.last_error)+'.':'';
  if(ctx.histState==='error')red.push({id:'history',title:'Stock history could not be read',text:'Cover, classes and the in-stock rate fall back to rougher figures'+(ctx.histError?' ('+ctx.histError+')':'')+'.',action:'Retry. If it keeps failing, check the Firestore rules for shopify_inventory_snapshots.',retry:true});
  if(!snap){red.push({id:'snapshot',title:'No stock snapshot loaded',text:'Stock numbers are missing.',action:'Raees or Afnan: check the Netlify function log for shopify-inventory-snapshot.'});}
  else{
    const ms=_siAxSnapMs(snap.snapshot_at);
    let stale=false,age='';
    if(ms!=null){const ageMs=ctx.now-ms;if(ageMs>C.staleSnapHours*3600000){stale=true;age=_siNaAge(ageMs);}}
    else if(snap.date&&ctx.today){const d=_siAxDayNum(ctx.today)-_siAxDayNum(snap.date);if(d>1){stale=true;age=d+' days';}}
    if(stale)red.push({id:'snapshot_stale',title:'The stock snapshot is '+age+' old',text:'Cover, size holes and out-of-stock lists are for stock as it was, not as it is.'+lastErr(meta.inventory),action:'Raees or Afnan: check the Netlify function log for shopify-inventory-snapshot and run it again.'});
    else if(meta.inventory&&meta.inventory.last_status==='error')red.push({id:'snapshot_failed',title:'The last stock snapshot run failed',text:'The snapshot shown is the previous good one.'+lastErr(meta.inventory),action:'Raees or Afnan: check the Netlify function log for shopify-inventory-snapshot.'});
    const dropped=ctx.hist&&ctx.hist.dropped&&snap.date&&ctx.hist.dropped.indexOf(String(snap.date))>=0;
    if(snap.complete===false||dropped)red.push({id:'snapshot_truncated',title:'Today’s stock snapshot looks incomplete',text:'It holds far fewer items than usual, so items can read as sold out when they are not.',action:'Re-run the snapshot. Do not reorder from these lists until it is fixed.'});
  }
  const os=meta.orderSync;
  if(!os||(!os.last_status&&!os.last_success_at))unknown.push('Order sync status is not available, so how fresh the sales are is not known.');
  else{
    const sm=_siAxSnapMs(os.last_success_at);
    if(os.last_status==='error')red.push({id:'orders_failed',title:'The last order sync failed',text:'Recent sales may be missing, so pace and cover read low.'+lastErr(os),action:'Check the Netlify deploy list first (a skipped deploy looks like this), then the function log for shopify-order-sync.'});
    else if(sm!=null&&ctx.now-sm>C.staleOrderHours*3600000)red.push({id:'orders_stale',title:'Orders were last synced '+_siNaAge(ctx.now-sm)+' ago',text:'Recent sales may be missing, so pace and cover read low.',action:'Check the Netlify deploy list first, then the function log for shopify-order-sync.'});
  }
  if(ctx.hist&&ctx.hist.dates&&ctx.today){
    const Tn=_siAxDayNum(ctx.today);let miss=0;const set=new Set(ctx.hist.dates);
    for(let k=1;k<=C.gapDays;k++)if(!set.has(_siAxDayStr(Tn-k)))miss++;
    if(miss)amber.push({id:'gap',title:miss+' day'+(miss===1?'':'s')+' missing from the stock history in the last '+C.gapDays,text:'Cover and the in-stock rate count only the days that were measured.'});
  }
  if(q&&q.returns&&!q.returns.synced)quiet.push('Returns not yet synced: recent units and revenue are before later returns and cancellations, so pace reads high and they are an upper limit (stock is exact).');
  if(q){
    if(q.snapshot&&q.snapshot.negativeClamped)quiet.push(q.snapshot.negativeClamped+' negative stock entr'+(q.snapshot.negativeClamped===1?'y':'ies')+' counted as 0 (fix the count in Shopify).');
    if(q.snapshot&&q.snapshot.duplicateSkus)quiet.push(q.snapshot.duplicateSkus+' SKU'+(q.snapshot.duplicateSkus===1?'':'s')+' appear more than once in the snapshot and are summed.');
    const ns=((q.lineItems&&q.lineItems.noSku)||0)+((q.snapshot&&q.snapshot.noSku)||0);
    if(ns)quiet.push(ns+' row'+(ns===1?'':'s')+' with no SKU skipped.');
    if(q.nonMerch&&q.nonMerch.articles)quiet.push(q.nonMerch.articles+' non-merchandise code'+(q.nonMerch.articles===1?'':'s')+' left out.');
  }
  if(!_siAxLtAnyCustom())quiet.push('Lead times are defaults (21, 28 or 35 days by category) unless you set your own in the Article Explorer.');
  return{red,amber,quiet,unknown};
}
function _siNaTrust(){
  const idx=_siAxIndex();
  return _siNaTrustOf({now:_siNaNow(),today:_siPktDate(0),snapshot:_siSnapshot,meta:_siSyncMeta,hist:_siHist,histState:_siHistState,histError:_siHistError,quality:idx.quality});
}
function _siNaTrustHtml(t){
  const red=t.red.map(x=>`<div class="si-na-trust red" role="alert"><strong>${_siEsc(x.title)}.</strong> ${_siEsc(x.text)} ${x.action?`<span class="act">${_siEsc(x.action)}</span>`:''}${x.retry?` <button class="si-ax-btn" onclick="window._siNaRetry()">Retry</button>`:''}</div>`).join('');
  const amber=t.amber.map(x=>`<div class="si-na-trust amber" role="note"><strong>${_siEsc(x.title)}.</strong> ${_siEsc(x.text)}</div>`).join('');
  const notes=t.quiet.concat(t.unknown);
  const quiet=notes.length?`<details class="si-na-checks"><summary>Data checks: ${t.red.length+t.amber.length===0?'all clear, ':''}${notes.length} note${notes.length===1?'':'s'}</summary><ul>${notes.map(x=>`<li>${_siEsc(x)}</li>`).join('')}</ul></details>`:'';
  return red+amber+quiet+_siRrHtml();
}

// ── Returns refresh button (owners only) ─────────────────────────────────
// Calls the existing owners' endpoint exactly as it expects: POST {idToken,days}. See docs/RETURNS_REFRESH_RUNBOOK.md.
// Shown only while returns are unsynced AND the signed-in person is an owner (the server re-checks the ID token against its owner list).
const _SI_RR_DAYS=365;
let _siRrBusy=false,_siRrMsg='';
function _siRrIsOwner(){return typeof session!=='undefined'&&!!session&&(session.u==='afnan'||session.u==='ammar');}
function _siRrHtml(){
  let synced=true;try{synced=_siAxIndex().quality.returns.synced;}catch(_){}
  if(synced||!_siRrIsOwner())return'';
  return`<div class="si-na-checks" role="note" id="si-rr"><strong>Returns refresh.</strong> Starts Shopify's refund and cancellation catch-up for the last ${_SI_RR_DAYS} days. It runs in the background (minutes); press again if it says partial, then reload this page.${_siRrMsg?` <span id="si-rr-msg">${_siEsc(_siRrMsg)}</span>`:''} <button type="button" class="si-ax-btn" id="si-rr-btn" onclick="window._siRrRun()"${_siRrBusy?' disabled':''}>${_siRrBusy?'Starting…':'Run returns refresh'}</button></div>`;
}
window._siRrRun=async function(){
  if(_siRrBusy||!_siRrIsOwner())return;
  _siRrBusy=true;_siRrMsg='';
  _siLinesForceFull=true; // pressing the returns refresh makes the next line-item read a full one (statuses change on lines of any age)
  const done=m=>{_siRrBusy=false;_siRrMsg=m;const e=document.getElementById('si-rr');if(e)e.outerHTML=_siRrHtml()||'';};
  try{
    const idToken=await auth.currentUser.getIdToken();
    const res=await fetch('/.netlify/functions/shopify-order-refresh-now-background',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken,days:_SI_RR_DAYS})});
    const data=await res.json().catch(()=>({}));
    if(res.status===202)done('Started. Progress is in shopify_sync_meta/order_refresh_now; reload this page in a few minutes.');
    else if(res.ok)done('Finished a pass: '+(data.status||'ok')+(data.status==='partial'?' (press again to continue).':'. Reload this page.'));
    else done(data.error||('Failed ('+res.status+').'));
  }catch(e){done('Network error: '+e.message);}
};

// ── Playbook: situation, why, how to tackle, what not to do, how sure ───
// Pure: issue -> strings only. Owners are role suggestions, not assignments: Raees buys and cuts, Mustafa runs the store and prices,
// Daniyal runs ads and creators, Saim designs. The renderer escapes every string once.
function _siNaPlaybook(i){
  const n=i.n||{},P=(v,d)=>_siAxNum(v,d),R=v=>v==null||!isFinite(v)?'—':String(Math.round(v)),lab=i.label;
  const money=v=>v==null?'—':_siPKR(Math.round(v));
  const leadWhy=n.leadSrc==='default'?'the default, unconfirmed':(n.leadSrc==='article'?'your setting for this article':'your setting');
  const leadTxt=n.leadDays+' days ('+leadWhy+')';
  const qtyTxt=n.qty?'about '+n.qty.lo+'–'+n.qty.hi+' units (demand over the lead time plus '+n.qty.target+' days of cover, pace ±25%, rounded up to a pack of 12)':'';
  const inPct=n.inRate!=null?Math.round(n.inRate*100)+'%':'—';
  const rt=n.returnsSynced===true?'':' Later returns are not synced, so pace may read about a fifth high (stock is exact).';
  let situation='',why='',actions=[],avoid=[];
  const confBits=[n.confName+' confidence: '+(n.confWhy&&n.confWhy[0]?n.confWhy[0]:'—')+'.'];
  if(n.confCaps&&n.confCaps.length)confBits.push('Capped at Medium because '+n.confCaps.join(' and ')+'.');
  if(i.type==='stockout'||i.type==='runout'||i.type==='sizehole'||i.type==='rising'||i.type==='saleloss'||i.type==='winner')confBits.push('Lead time: '+leadTxt+'.'+rt);
  const holesTxt=(n.holes||[]).map(h=>h.size+(h.kind==='out'?' (out)':' ('+h.stock+' left)')).join(', ');
  switch(i.type){
    case'stockout':
      situation=lab+' has no stock left.'+(n.outDays!=null&&n.measured!=null?' It has been out on '+n.outDays+' of '+n.measured+' measured days and sold '+P(n.perInDay)+' a day while it was in stock'+(n.missed!=null?', so about '+n.missed+' units of demand were turned away':'')+'.':' It sells about '+P(n.perDay)+' a day when it is in stock.')+(i.rising?' Demand is also rising.':'');
      why='Every day out is sales lost on a proven seller, and ads and codes still send people to a page that cannot sell.';
      actions=[{owner:'Raees',text:'Reorder or re-cut now'+(qtyTxt?': '+qtyTxt:'')+'. A batch takes '+leadTxt+'; confirm that with the supplier or cutting master.'},
        {owner:'Daniyal',text:'Pause ads, creator posts and discount codes that point at it until stock lands; brief a restock post for the day it does.'},
        {owner:'Mustafa',text:'Switch on a back-in-stock notice on the product page and do not run a sale on it.'}];
      avoid=['Do not discount it: it already sells.','Do not wait for the weekly review.'];break;
    case'runout':
      situation=R(n.onHand)+' left, selling about '+P(n.perDay)+' a day: empty in about '+_siNaDays(n.coverDays)+'. A batch takes '+leadTxt+', so there is a gap of about '+_siNaDays(n.gapDays)+(i.lost!=null?' (roughly '+R(i.lost)+' units of sales)':'')+'.'+(i.rising?' Demand is also rising ('+(n.units28)+' units in 28 days against '+(n.prev28==null?'—':n.prev28)+' before).':'');
      why='A batch started today still lands after the stock is gone.';
      actions=[{owner:'Raees',text:'Confirm the lead time'+(n.leadSrc==='default'?' (it is only the default)':'')+', then order today'+(qtyTxt?': '+qtyTxt:'')+'.'},
        {owner:'Mustafa',text:'Slow the burn: hold promotions and keep the last units for full-price web orders.'},
        {owner:'Daniyal',text:'Stop any paid push to it until the batch is in sight.'}];
      avoid=['Do not reorder every size equally.','Do not run a sale on it.'];break;
    case'sizehole':
      situation=((n.holes||[]).length===1?'Size ':'Sizes ')+holesTxt+' sold '+R((n.holes||[]).reduce((t,h)=>t+h.units28,0))+' of '+n.units28+' units in the last 28 days ('+Math.round(100*(n.holes||[]).reduce((t,h)=>t+h.share,0))+'%), yet the rest of the run is in stock ('+n.coverText+' of cover overall). At least that much is being turned away: a size that is out shows low sales because it was out.';
      why='A broken size run loses the buyers who need exactly those sizes, while the article looks healthy in total.';
      actions=[{owner:'Raees',text:'Cut a size run weighted by the 28-day sales in the size table below, not a full re-order of the article.'},
        {owner:'Mustafa',text:'Mark the out sizes clearly as sold out and keep the product live; do not hide it.'}];
      avoid=['Do not reorder the whole article.','Do not read a size at 0 with low recent sales as "no demand".'];break;
    case'overstock':
      if(i.seasonal){
        situation=R(n.onHand)+' units on hand ('+money(n.valueTied)+' at selling price): '+n.coverText+' of cover, but it is winter stock and the season is starting.';
        why='Judging it now would be unfair: there is no winter sales history in the data yet (it starts 26 March 2026).';
        actions=[{owner:'Raees',text:'Hold: no reorder and no re-cut.'},{owner:'Daniyal',text:'Plan winter creative and creator seeding for it now.'},{owner:'Mustafa',text:'Check it again on 15 November; if it still moves slowly, move to the markdown steps.'}];
        avoid=['Do not mark it down before the season has had a chance.','Do not reorder.'];
      }else{
        situation=R(n.onHand)+' units on hand'+(n.valueTied!=null?' ('+money(n.valueTied)+' at selling price, cost is not recorded)':'')+': '+n.coverText+' of cover at about '+P(n.perDay)+' a day.';
        why='Cash and shelf space are tied up, and the value falls with each season.';
        actions=[{owner:'Raees',text:'Do not reorder or re-cut it.'}];
        if(n.cover==null||n.cover<52)actions.push({owner:'Mustafa',text:'Promote it or bundle it with a winner; Daniyal can push it through creators and stories.'});
        else actions.push({owner:'Mustafa',text:'Mark down in steps: 15%, then 30% after two weeks without movement. Set the steps against your cost, which the app does not hold; Afnan or Ammar approve. Then B-stock, outlet or warehouse customer sales.'});
        avoid=['No new production.','No deep discount before one promotion attempt.'];
      }
      break;
    case'dead':
      situation='Nothing sold in the last '+(n.pace28Days==null?'—':n.pace28Days)+' counted days with '+R(n.onHand)+' on hand'+(n.valueTied!=null?' ('+money(n.valueTied)+' at selling price)':'')+'.';
      why='There is no demand signal at all, and the stock is not getting cheaper to hold.';
      if(i.seasonal){actions=[{owner:'Raees',text:'Hold: no reorder.'},{owner:'Mustafa',text:'It is winter stock and winter is starting: check the listing is live and priced right, then look again on 15 November.'}];avoid=['Do not clear it yet.'];}
      else{actions=[{owner:'Mustafa',text:'First check the listing is live, priced right and in its collection.'},{owner:'Mustafa',text:'Then bundle or discount it to clear.'},{owner:'Raees',text:'Do not reorder.'},{owner:'Saim',text:'Note it for design: do not re-run this style.'}];avoid=['Do not reorder.'];}
      break;
    case'rising':
      situation='Selling faster: '+n.units28+' units in the last 28 days against '+(n.prev28==null?'—':n.prev28)+' before ('+_siAxPct(n.momentum,true)+', a gap bigger than chance). '+R(n.onHand)+' on hand is about '+_siNaDays(n.coverDays)+'; a batch takes '+leadTxt+'.'+(n.disc?' '+Math.round(n.disc.share*100)+'% of the last week’s '+n.disc.units7+' units were at a reduced price, so part of this is the sale.':'');
      why='At this pace the stock will drop below the lead time soon, and the article is the one people want.';
      actions=[{owner:'Raees',text:'Confirm the lead time and plan a reorder'+(qtyTxt?': '+qtyTxt:'')+', sized to the full-price pace.'},{owner:'Daniyal',text:'Hold extra paid push until stock is covered.'},{owner:'Mustafa',text:'Mark out sizes as sold out as they go.'}];
      avoid=['Do not cut the price further on a seller that is already rising.'];break;
    case'demanddrop':
      if(n.sudden){
        situation='Last 7 days: '+n.sudden.last+' units against about '+P(n.sudden.base)+' a week over the 4 weeks before, a drop beyond chance, while it was in stock on 5 or more of the 7 days.';
        why='A sudden drop on a seller is usually a listing, price or ad problem, not demand.';
        actions=[{owner:'Mustafa',text:'Check the listing is live, every size has stock and the price did not change.'},{owner:'Daniyal',text:'Then check ad spend and creator content for it.'},{owner:'Raees',text:'Hold any reorder for one week.'}];
        avoid=['Do not act on one week alone: look again next week.'];
      }else{
        situation='Last 28 days: '+n.units28+' units against '+(n.prev28==null?'—':n.prev28)+' in the 28 before ('+_siAxPct(n.momentum,true)+', a gap bigger than chance). It was in stock on '+inPct+' of days, so a stock-out does not explain it.';
        why='An early warning: a seller that slows becomes overstock if nobody looks.';
        actions=[{owner:'Mustafa',text:'Check price, the listing and which sizes ran out.'},{owner:'Daniyal',text:'Test fresh creator content for it.'},{owner:'Raees',text:'Hold the reorder for one cycle.'}];
        avoid=['Do not cut the price on one week’s drop.','Do not reorder to chase it.'];
      }
      break;
    case'saleloss':{
      const S=n.sales||{},same=S.lo===S.hi,rs=S.price!=null&&S.mid!=null?S.mid*S.price:null;
      situation=lab+' was out of stock often enough in the last '+(S.windowDays||90)+' days that sales were likely lost: an estimated '+(same?'about '+R(S.lo):R(S.lo)+'–'+R(S.hi))+' units'+(rs!=null?' (about '+money(rs)+' at its average price, before discounts)':'')+' over '+R(S.days)+' out-of-stock days, from its own in-stock pace of '+P(S.pace)+' a day. This is an estimate from the stock-vs-sales timeline, not a count.'+(S.ongoing?' It is still out of stock now.':'')+(S.notEstimated?' '+S.notEstimated+' out-of-stock stretch'+(S.notEstimated===1?' was':'es were')+' left out because there was no reliable in-stock baseline.':'');
      why='A day without stock sells nothing, and the loss repeats at the next restock if the batch lands late again.';
      actions=[{owner:'Raees',text:(S.ongoing?'Reorder now'+(qtyTxt?': '+qtyTxt:'')+'. ':'')+'Set the reorder point so a batch is started while cover is still longer than the lead time ('+leadTxt+'), not after the shelf is empty.'},
        {owner:'Mustafa',text:'Keep the product live with a back-in-stock notice and mark sizes that are out as sold out; do not run a sale on it.'},
        {owner:'Daniyal',text:'Time ads and creator posts to the days stock is in, and pause them while it is out.'}];
      avoid=['Do not read it as weak demand: it could not sell while out.','Do not quote the figure as a count: it is an estimate.'];break;}
    case'returns':{
      const T=n.ret||{},pct=v=>v==null?'—':(Math.round(v*1000)/10)+'%';
      situation=R(T.ref)+' of '+R(T.gross)+' units sold in the last '+(T.days||_SI_NA.retDays)+' days came back ('+pct(T.rate)+'), against a catalogue median of '+pct(T.median)+'. An alert needs '+Math.round(_SI_NA.retRate*100)+'% or more, at least twice the median, and a gap bigger than chance'+(i.at!=null?'. About '+money(i.at)+' at selling price came back':'')+'.';
      why='Every return costs the sale, shipping both ways and handling, and a high rate on one article usually means the size chart, photos, fabric or description set the wrong expectation.';
      actions=[{owner:'Mustafa',text:'Read the return reasons on the Shopify orders for this article; check the size chart, photos and description against the real garment.'},
        {owner:'Saim',text:'Check fit and fabric against the measurements in the Pattern Hub and say if the pattern or the sample needs a fix.'},
        {owner:'Raees',text:'Hold any reorder until the cause is known; add a QC check on the next batch.'},
        {owner:'Daniyal',text:'Pause paid push and creator posts that may oversell the fit until it is fixed.'}];
      avoid=['Do not discount it: returns would follow the discount.','Do not reorder to chase it.','Do not judge on fewer than '+_SI_NA.retMinUnits+' units.'];break;}
    case'winner':
      situation=lab+' is one of the top sellers: about '+P(n.perInDay)+' a day when in stock, '+R(n.units28)+' units in the last 28 days, in stock on '+inPct+' of measured days, with '+n.coverText+' of cover against a lead time of '+leadTxt+'.';
      why='Winners carry the month. Running out of one costs the most, and they are where repeat colourways and creators pay back.';
      actions=[{owner:'Raees',text:'Keep cover above the lead time plus '+_SI_NA.coverTargetWinner+' days'+(qtyTxt?': '+qtyTxt:'')+'; confirm the lead time'+(n.leadSrc==='default'?' (it is only the default)':'')+'.'},
        {owner:'Daniyal',text:'Keep creator content and ads on it while stock lasts.'},
        {owner:'Mustafa',text:'Do not discount it; keep every size live and mark sold-out sizes clearly.'},
        {owner:'Saim',text:'Brief a sibling or a new colourway while the demand is there.'}];
      avoid=['Do not discount a winner.','Do not let cover fall under the lead time.'];break;
    default:
      situation='Numbers for '+lab+' may be off: '+(n.voidRate!=null?Math.round(n.voidRate*100)+'% of its units were voided ('+n.voided+' units).':'data check.');
      why='Acting on bad numbers is worse than waiting.';
      actions=[{owner:'Raees',text:'Count the shelf for it.'},{owner:'Mustafa',text:'Compare Shopify inventory and the voided orders with what is on the shelf.'}];
      avoid=['Do not reorder or mark down on this figure until it is checked.'];
  }
  return{situation,why,actions,avoid,confidence:confBits.join(' ')};
}

// ── Rendering ───────────────────────────────────────────────────────
function _siNaDays(v){if(v==null||!isFinite(v))return'—';const d=Math.round(v);return d+' day'+(d===1?'':'s');}
function _siNaRowLine(i){
  const n=i.n,P=v=>_siAxNum(v);
  let s='';
  switch(i.type){
    case'stockout':s='Out of stock · '+(n.units28==null?'—':n.units28)+' sold in 28 days · lead time '+n.leadDays+'d ('+(n.leadSrc==='default'?'default':'set')+')';break;
    case'runout':s=n.onHand+' left · empty in about '+_siNaDays(n.coverDays)+' · lead time '+n.leadDays+'d ('+(n.leadSrc==='default'?'default':'set')+')'+(i.rising?' · demand rising':'');break;
    case'sizehole':s=(n.holes.length===1?'Size ':'Sizes ')+n.holes.map(h=>h.size).join(', ')+' '+(n.holes.some(h=>h.kind==='out')?'out':'thin')+' · '+Math.round(100*n.holes.reduce((t,h)=>t+h.share,0))+'% of 28-day sales';break;
    case'overstock':s=(i.seasonal?'Winter stock, wait · ':'')+n.onHand+' on hand · '+n.coverText+' of cover';break;
    case'dead':s=(i.seasonal?'Winter stock, wait · ':'')+n.onHand+' on hand · nothing sold in '+(n.pace28Days==null?'—':n.pace28Days)+' days';break;
    case'rising':s='Rising: '+n.units28+' vs '+(n.prev28==null?'—':n.prev28)+' units · '+n.onHand+' left, about '+_siNaDays(n.coverDays);break;
    case'demanddrop':s=n.sudden?'Last 7 days: '+n.sudden.last+' vs about '+Math.round(n.sudden.base)+' a week':'Last 28 days: '+n.units28+' vs '+(n.prev28==null?'—':n.prev28)+' units';break;
    case'saleloss':{const S=n.sales||{};s='Est. '+(S.lo===S.hi?'~'+S.lo:S.lo+'–'+S.hi)+' units lost over '+S.days+' days out'+(S.ongoing?' · out now':'')+' · estimate';break;}
    case'returns':{const T=n.ret||{};s=T.ref+' of '+T.gross+' units returned ('+(Math.round(T.rate*1000)/10)+'%) · median '+(Math.round((T.median||0)*1000)/10)+'%';break;}
    case'winner':s=P(n.perInDay)+' a day in stock · '+n.coverText+' of cover';break;
    default:s=n.voided+' units voided ('+Math.round((n.voidRate||0)*100)+'%)';
  }
  return s;
}
function _siNaAtText(i){
  if(i.group==='cash')return i.n.valueTied==null?'—':_siPKR(Math.round(i.n.valueTied))+' at selling price';
  if(i.at==null)return'';
  return'~'+_siPKR(Math.round(i.at))+' '+(i.atKind||'');
}
function _siNaRowHtml(i,trustRed){
  return`<button type="button" class="si-na-row ${i.band}" data-code="${_siEsc(i.code)}" onclick="window._siNaOpen(this.dataset.code)" aria-label="${_siEsc(i.label+': '+i.reason+'. Open the situation.')}">
    <span class="rs"><span class="si-na-reason ${i.band}">${_siEsc(i.reason)}</span>${i.seasonal?'<span class="si-na-reason soft">Seasonal wait</span>':''}${i.also&&i.also.length?`<span class="si-na-reason soft">also ${_siEsc(i.also.map(t=>_SI_NA_REASON[t].toLowerCase()).join(', '))}</span>`:''}${trustRed?'<span class="si-na-reason soft">numbers may be off</span>':''}</span>
    <span class="nm">${_siAxThumb(i.code,44,i.label)}<span class="tx"><strong>${_siEsc(i.label)}</strong><span class="cd">${_siEsc(i.code)} · ${_siEsc(i.clsLabel)}</span></span></span>
    <span class="ln">${_siEsc(_siNaRowLine(i))}</span>
    <span class="at">${_siEsc(_siNaAtText(i))}</span>
    <span class="ch" aria-hidden="true">›</span></button>`;
}
// The list the screen shows: a reason's articles (or all issues), narrowed to one band when a band chip is pressed. ONE function: the chip counts,
// the list, Prev/Next and the situation view all read it.
function _siNaReasonList(res,f){
  if(f==='all')return res.issues;
  if(f==='cash')return res.reasons.overstock.concat(res.reasons.dead).sort(_siNaCmp);
  return res.reasons[f]||res.issues;
}
function _siNaFiltered(res){
  const l=_siNaReasonList(res,_siNaFilter);
  return _siNaBand?l.filter(i=>i.band===_siNaBand):l;
}
// Chip count: the list's length, or null when the reason cannot be answered yet (never 0 for "not known").
function _siNaReasonCount(res,k){
  if(k==='all')return res.counts.total;
  if(res.unavailable&&res.unavailable[k])return null;
  return _siNaReasonList(res,k).length;
}
function _siNaBandBtn(res,b,cls,txt){
  const on=_siNaBand===b;
  return`<button type="button" class="si-na-chip ${cls}${on?' on':''}" aria-pressed="${on}" data-band="${b}" onclick="window._siNaBandSet('${b}')"><b>${res.counts[b]}</b> ${txt}</button>`;
}
function _siNaHeadHtml(res){
  const c=res.counts,bl=(_SI_NA_BANDS.find(b=>b.k===_siNaBand)||{}).l;
  return`<div class="si-na-head"><div class="si-na-big"><span class="num">${c.action}</span> article${c.action===1?'':'s'} need action</div>
    <div class="si-na-chips" role="group" aria-label="Show one band">${_siNaBandBtn(res,'critical','crit','critical')}${_siNaBandBtn(res,'act','act','this week')}${_siNaBandBtn(res,'watch','watch','to watch')}</div>
    ${_siNaBand?`<div class="si-ax-note" style="margin:6px 0 0">Showing only “${_siEsc(bl)}”. Press it again to see everything.</div>`:''}
    <div class="si-ax-note" style="margin:6px 0 0">Articles, not sizes. Counted from ${res.rows} articles with sales or stock${res.skipped?'; '+res.skipped+' too new or unrated to judge':''}. The season filter does not apply here.</div></div>`;
}
function _siNaFilterHtml(res){
  const chip=(k,l,what)=>{
    const n=_siNaReasonCount(res,k),on=_siNaFilter===k;
    const lab=(k==='returns'&&n==null)?'Return rate: waiting for returns sync':l;
    return`<button type="button" class="si-na-fchip${on?' on':''}${n===0?' zero':''}${n==null?' wait':''}" data-reason="${k}" aria-pressed="${on}" title="${_siEsc(what||'')}" onclick="window._siNaSetFilter('${k}')">${_siEsc(lab)} <b>${n==null?'—':n}</b></button>`;
  };
  const cur=_SI_NA_REASONS.find(x=>x.k===_siNaFilter);
  const ex=_siNaFilter==='all'?'':`<div class="si-na-why" role="note"><strong>${_siEsc(cur?cur.l:'Cash tied up')}.</strong> ${_siEsc(cur?cur.what:'Overstocked and dead stock together: money sitting on the shelf, valued at selling price.')}</div>`;
  return`<div class="si-na-filters" role="group" aria-label="Filter by reason">${chip('all','All')}${_SI_NA_REASONS.map(x=>chip(x.k,x.l,x.what)).join('')}</div>${ex}`;
}
function _siNaBandHtml(b,list,trustRed){
  if(!list.length)return'';
  const iso=_siNaBand===b.k,cap=_SI_NA[b.cap],all=_siNaShow[b.k]||iso||_siNaFilter!=='all',show=all?list:list.slice(0,cap);
  const fold=b.k==='watch'&&!iso&&_siNaFilter==='all',watchShut=fold&&!_siNaWatchOpen;
  const head=fold?`<button type="button" class="si-na-bh toggle" aria-expanded="${!watchShut}" onclick="window._siNaToggleWatch()"><span class="t">${_siEsc(b.l)}</span><span class="s">${_siEsc(b.sub)}</span><span class="n">${list.length}</span><span class="car" aria-hidden="true">${watchShut?'▸':'▾'}</span></button>`
    :`<div class="si-na-bh"><span class="t">${_siEsc(b.l)}</span><span class="s">${_siEsc(b.sub)}</span><span class="n">${list.length}</span></div>`;
  const more=(list.length>cap&&!iso&&_siNaFilter==='all')?`<button type="button" class="si-ax-btn si-na-more" onclick="window._siNaShowAll('${b.k}')">${_siNaShow[b.k]?'Show the first '+cap:'Show all '+list.length}</button>`:'';
  const body=watchShut?'':show.map(i=>`<div class="si-na-rw">${_siNaRowHtml(i,trustRed)}${_siIgBtnHtml(i.code,'si-na-ig')}</div>`).join('')+more;
  return`<section class="si-na-band ${b.k}${_siNaFlash===b.k?' flash':''}" id="si-na-band-${b.k}" aria-label="${_siEsc(b.l)}">${head}${body}</section>`;
}
// What a reason chip says while it cannot list anything: how it will light up, never a zero.
function _siNaWaitHtml(k){
  if(k==='returns')return`<div class="si-ax-empty si-na-waitbox" role="note"><strong>Return rate is waiting for the returns sync.</strong> Shopify refunds reach this app only when the order refresh stamps each line item with its refunded quantity (shopify-order-refresh). Until about 95% of the last 60 days’ lines carry that stamp, a rate would be a guess, so nothing is listed and no count is shown. Once it is synced this chip lists the articles that sold ${_SI_NA.retMinUnits}+ units in ${_SI_NA.retDays} days, with a return rate of ${Math.round(_SI_NA.retRate*100)}% or more, at least ${_SI_NA.retMult}× the catalogue median, and a gap bigger than chance. Defaults, not facts.</div>`;
  return`<div class="si-ax-empty si-na-waitbox" role="note"><strong>Sales loss needs the stock history.</strong> It could not be read, so no estimate is shown. Retry the history from the notice above.</div>`;
}
function _siNaEmptyHtml(res,trust){
  const snapDate=_siSnapshot&&_siSnapshot.date||'—',cov=(_siAxIndex().cov)||'—';
  if(trust.red.length)return`<div class="si-ax-empty">Nothing is flagged, but this is <strong>not an all-clear</strong>: the data above is stale or incomplete, so the lists cannot be trusted yet.</div>`;
  const cl=res.closest?` Closest to the line: ${res.closest.label} (cover ${Math.round(res.closest.coverDays)} days against a lead time of ${res.closest.lead}).`:'';
  return`<div class="si-ax-empty">Nothing needs attention${_siNaFilter==='all'&&!_siNaBand?'':' in this view'}. Checked ${res.rows} articles against stock as of ${_siEsc(snapDate)} and sales since ${_siEsc(cov)}.${_siEsc(cl)}${res.skipped?' '+res.skipped+' article'+(res.skipped===1?'':'s')+' skipped: too new or not rated.':''}</div>`;
}
function _siNaListHtml(){
  const res=_siNaState(),trust=_siNaTrust(),trustRed=trust.red.length>0;
  const list=_siNaFiltered(res);
  const bands=_SI_NA_BANDS.map(b=>_siNaBandHtml(b,list.filter(i=>i.band===b.k),trustRed)).join('');
  _siNaFlash='';   // the highlight is one-shot: painted once, then gone
  const waiting=_siNaFilter!=='all'&&_siNaFilter!=='cash'&&res.unavailable&&res.unavailable[_siNaFilter];
  return`<div class="si-na">${_siMetaNote()}${_siNaTrustHtml(trust)}${_siNaHeadHtml(res)}${_siNaFilterHtml(res)}${waiting?_siNaWaitHtml(_siNaFilter):(bands||_siNaEmptyHtml(res,trust))}</div>`;
}
function _siNaFactsHtml(i){
  const n=i.n,P=v=>_siAxNum(v),F=[];
  F.push(['On hand',n.onHand==null?'—':String(n.onHand)]);
  F.push(['Lasts',n.coverText||'—']);
  F.push(['Sold, last 28 days',n.units28==null?'—':String(n.units28)]);
  F.push(['Per in-stock day',P(n.perInDay)]);
  F.push(['In stock',n.inRate==null?'—':Math.round(n.inRate*100)+'% of '+n.measured+' days']);
  F.push(['Lead time',n.leadDays+' days ('+(n.leadSrc==='default'?'default, unconfirmed':'set')+')']);
  if(n.valueTied!=null)F.push(['At selling price',_siPKR(Math.round(n.valueTied))]);
  if(n.qty)F.push(['Reorder guide',n.qty.lo+'–'+n.qty.hi+' units']);
  if(n.disc)F.push(['Sold at a reduced price (last 7 days)',Math.round(n.disc.share*100)+'% of '+n.disc.units7]);
  return`<dl class="si-na-facts">${F.map(f=>`<div><dt>${_siEsc(f[0])}</dt><dd>${_siEsc(f[1])}</dd></div>`).join('')}</dl>`;
}
function _siNaSizeTableHtml(i){
  const rows=i.n.sizes||[];if(rows.length<2)return'';
  return`<div class="si-na-tw"><table class="cut-table si-na-sizes"><thead><tr><th>Size</th><th>On hand</th><th>Sold, 28 days</th><th>Cover</th><th>State</th></tr></thead><tbody>${rows.map(s=>`<tr class="${s.state==='out'||s.state==='thin'?'bad':''}"><td><strong>${_siEsc(s.size)}</strong></td><td>${s.stock==null?'—':s.stock}</td><td>${s.units28}</td><td>${s.coverDays==null?'—':Math.round(s.coverDays)+' days'}</td><td>${_siEsc(s.state)}</td></tr>`).join('')}</tbody></table></div>`;
}
function _siNaDetailHtml(i,o){
  o=o||{};
  const pb=_siNaPlaybook(i),bandL=(_SI_NA_BANDS.find(b=>b.k===i.band)||{}).l||'';
  const order=o.order||_siNaFiltered(_siNaState()),pos=order.findIndex(x=>x.code===i.code);
  const backFn=o.backFn||'window._siNaBack()',stepFn=o.stepFn||'window._siNaStep';
  const shut=_siNaIsPhone()?'':' open';
  const fold=(t,body)=>`<details class="si-na-fold"${shut}><summary>${_siEsc(t)}</summary>${body}</details>`;
  return`<div class="si-na-detail ${i.band}">
    <div class="si-na-dbar"><button type="button" class="si-ax-btn si-na-back" onclick="${backFn}">${_siEsc(o.backLabel||'‹ Needs Attention')}</button>
      <span class="si-na-pn">${pos>=0?`<button type="button" class="si-ax-btn" ${pos<=0?'disabled':''} onclick="${stepFn}(-1)" aria-label="Previous article">‹ Prev</button><span class="si-ax-note" style="margin:0">${pos+1} of ${order.length}</span><button type="button" class="si-ax-btn" ${pos>=order.length-1?'disabled':''} onclick="${stepFn}(1)" aria-label="Next article">Next ›</button>`:''}</span>
      <span class="si-na-btns"><button type="button" class="si-ax-btn" data-code="${_siEsc(i.code)}" onclick="window._siNaToExplorer(this.dataset.code)">Open in Article Explorer</button><button type="button" class="si-ax-btn" data-code="${_siEsc(i.code)}" onclick="window._siNaCompare(this.dataset.code)">+ Compare</button>${_siIgBtnHtml(i.code)}</span></div>
    <div class="si-na-dhead"><div class="si-na-dtop">${_siAxThumb(i.code,64,i.label)}<div class="si-na-dtx"><span class="si-na-reason ${i.band} big">${_siEsc(bandL)}</span><h2>${_siEsc(i.label)}</h2><div class="si-ax-note" style="margin:2px 0 0">${_siEsc(i.code)} · ${_siEsc(i.clsLabel)} · ${_siEsc(i.reason)}${i.also&&i.also.length?' · also '+_siEsc(i.also.map(t=>_SI_NA_REASON[t].toLowerCase()).join(', ')):''}</div></div></div></div>
    <section class="si-na-sit"><h3>Situation</h3><p>${_siEsc(pb.situation)}</p></section>
    <section class="si-na-how"><h3>How to tackle</h3><ol class="si-na-acts">${pb.actions.map(a=>`<li><span class="si-na-own">${_siEsc(a.owner)}</span><span>${_siEsc(a.text)}</span></li>`).join('')}</ol><div class="si-ax-note">Owners are suggestions, not assignments.</div></section>
    ${fold('Why it matters','<p>'+_siEsc(pb.why)+'</p>')}
    ${fold('What not to do','<ul class="si-na-avoid">'+pb.avoid.map(x=>'<li>'+_siEsc(x)+'</li>').join('')+'</ul>')}
    ${fold('Key numbers',_siNaFactsHtml(i)+_siNaSizeTableHtml(i))}
    ${fold('How sure are we','<p>'+_siEsc(pb.confidence)+'</p>')}
  </div>`;
}
// The section: the list, or one article's situation when one is open. History is read once (the Explorer's own bounded read).
function _siNaSectionHtml(){
  if(!_siFullHist()){_siFullStart(false);return _siFullGateHtml('Needs Attention');}
  if(_siHistState==='idle'||_siHistState==='loading'){
    if(_siHistState==='idle')_siAxEnsureHistory();
    return`<div class="si-ax-empty">Reading the stock history…</div>`;
  }
  if(_siNaSel){
    const i=_siNaFind(_siNaSel);
    if(i)return _siNaDetailHtml(i);
    _siNaSel='';
  }
  return _siNaListHtml();
}
window._siNaRetry=function(){_siAxEnsureHistory(true);window._siNaRepaint();};
window._siNaRepaint=function(){
  const el=document.getElementById('si-content');if(el&&_siSection==='attention')el.innerHTML=_siNaSectionHtml();
};
function _siNaOnHistory(){
  try{
    const bar=document.getElementById('si-tab-bar');if(bar)bar.outerHTML=_siTabBar();
    if(_siSection==='attention')window._siNaRepaint();
    else if(_siSection==='today'&&!_siSub){const el=document.getElementById('si-content');if(el)el.innerHTML=_siOverview(_siComputeMetrics());}
  }catch(_){}
}
function _siNaWireKeys(){
  if(_siNaKeyWired||typeof document==='undefined'||!document.addEventListener)return;
  _siNaKeyWired=true;
  document.addEventListener('keydown',e=>{
    if(e&&e.key==='Escape'&&_siAxOvSit&&_siSection==='articles'){window._siAxOvBack();return;}
    if(!_siNaSel||_siSection!=='attention')return;
    if(e&&e.key==='Escape'){window._siNaBack();}
  });
}
window._siNaOpen=function(code){
  code=String(code||'').toUpperCase();
  if(!_siNaFind(code))return false;
  _siNaReturnY=(typeof window.scrollY==='number'?window.scrollY:0)||0;
  _siNaSel=code;_siNaWireKeys();window._siNaRepaint();_siAxEnter();
  if(typeof window.scrollTo==='function')try{window.scrollTo(0,0);}catch(_){}
  return true;
};
window._siNaBack=function(){
  _siNaSel='';window._siNaRepaint();_siAxEnter();
  const y=_siNaReturnY;if(y>0&&typeof window.scrollTo==='function')try{window.scrollTo(0,y);}catch(_){}
};
window._siNaStep=function(d){
  const order=_siNaFiltered(_siNaState()),pos=order.findIndex(x=>x.code===_siNaSel),n=order[pos+d];
  if(!n)return false;
  _siNaSel=n.code;window._siNaRepaint();
  if(typeof window.scrollTo==='function')try{window.scrollTo(0,0);}catch(_){}
  return true;
};
// The article's issue as the CURRENT list shows it (so a chip's row opens that reason's situation), else its main issue.
function _siNaFind(code){
  const res=_siNaState();
  return _siNaFiltered(res).find(x=>x.code===code)||_siNaReasonList(res,_siNaFilter).find(x=>x.code===code)||res.issues.find(x=>x.code===code)||null;
}
// A reason chip: pressing the active one again returns to All (they are mutually exclusive with All and with each other).
window._siNaSetFilter=function(f){
  if(_SI_NA_FILTER_KEYS.indexOf(f)<0)return;
  _siNaFilter=(f===_siNaFilter&&f!=='all')?'all':f;_siNaSel='';window._siNaRepaint();
};
// A band chip in the headline: isolates that band (every row, none folded) and flashes it once; again returns to all.
window._siNaBandSet=function(b){
  if(!_SI_NA_BANDS.some(x=>x.k===b))return;
  _siNaBand=(_siNaBand===b)?'':b;_siNaFlash=_siNaBand;_siNaSel='';
  window._siNaRepaint();
  try{
    const el=document.getElementById(_siNaBand?'si-na-band-'+_siNaBand:'si-content');
    const rm=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(el&&el.scrollIntoView)el.scrollIntoView({block:'start',behavior:rm?'auto':'smooth'});
  }catch(_){}
};
window._siNaShowAll=function(b){if(!(b in _siNaShow))return;_siNaShow[b]=!_siNaShow[b];window._siNaRepaint();};
window._siNaToggleWatch=function(){_siNaWatchOpen=!_siNaWatchOpen;window._siNaRepaint();};
window._siNaToExplorer=function(code){
  code=String(code||'').toUpperCase();
  _siAxModeSel='search';_siAxSel=code;_siAxQuery='';_siAxMsg='';_siNaSel='';_siAxOvSit='';
  window._siSwitchTab('articles');_siAxEnter();
  if(typeof window.scrollTo==='function')try{window.scrollTo(0,0);}catch(_){}
};
window._siNaCompare=function(code){window._siAxOvCompare(code);};
// Overview tile -> this tab (optionally on one filter)
window._siNaGo=function(filter){_siNaFilter=_SI_NA_FILTER_KEYS.indexOf(filter)>=0?filter:'all';_siNaBand='';_siNaSel='';window._siSwitchTab('attention');_siAxEnter();};
// ── Overview tile -> the same situation view ────────────────────────────────
// The tile's action names the closest playbook type; the article's own detected issue of that type is used when there is one, so the text and
// the numbers are Needs Attention's. An article the tile counts but the detector does not flag (looser thresholds) gets the same issue object
// built from the same helpers (_siNaMk, _siNaQty): no second calculator.
const _SI_OV_PLAY={reorder:['stockout','runout'],risk:['sizehole','runout','stockout'],stuck:['overstock','dead'],winner:['winner']};
function _siNaViewFor(a,tile){
  const r=_siNaRow(a),ctx=_siNaCtx(),all=_siNaDetect(r,ctx);
  let want=(_SI_OV_PLAY[tile]||['runout']).slice();
  if(tile==='reorder'&&a.hasStock&&a.onHand===0)want=['stockout','runout'];else if(tile==='reorder')want=['runout','stockout'];
  if(tile==='stuck'&&r.c.cls==='dead')want=['dead','overstock'];
  for(const t of want){const hit=all.find(d=>d.type===t);if(hit)return hit;}
  const m=r.m,type=want[0],pd=_siNaPerDay(m),lead=r.lt.days;
  const x=_siNaMk(r,ctx,type,'watch',{});
  const val=(m.asp!=null&&a.hasStock)?a.onHand*m.asp:null;
  if(type==='stockout'||type==='runout'){
    x.n.gapDays=type==='runout'&&m.coverDays!=null?Math.max(0,lead-m.coverDays):lead;
    x.n.qty=_siNaQty(pd,lead,a.hasStock?a.onHand:0,r.c.cls);
    x.lost=pd!=null?pd*x.n.gapDays:null;
    x.n.missed=(m.perInDay!=null&&m.outDays!=null)?Math.round(m.perInDay*m.outDays):null;
  }else if(type==='sizehole'){
    x.n.holes=(m.risk||[]).map(k=>({size:k.size,kind:'out',units28:k.units,share:m.units28>0?k.units/m.units28:0,stock:0}));
  }else if(type==='overstock'||type==='dead'){x.n.valueTied=val;x.at=val;}
  return x;
}
function _siAxOvList(){
  const cur=_SI_OV_TILES.find(t=>t.k===_siAxOvTile)||_SI_OV_TILES[0];
  return{cur,list:_siAxOvRows().filter(r=>_siAxOvIn(r,cur.k)).sort(_siAxOvSort(cur.k))};
}
function _siAxOvSitHtml(){
  const L=_siAxOvList(),r=L.list.find(x=>x.a.code===_siAxOvSit);
  if(!r){_siAxOvSit='';return'';}
  const view=_siNaViewFor(r.a,L.cur.k);
  return _siNaDetailHtml(view,{order:L.list.map(x=>({code:x.a.code})),backFn:'window._siAxOvBack()',stepFn:'window._siAxOvStep',backLabel:'‹ '+L.cur.l});
}
window._siAxOvSituation=function(code){
  code=String(code||'').toUpperCase();
  if(!_siAxOvList().list.some(r=>r.a.code===code))return false;
  _siAxOvSit=code;_siNaWireKeys();_siAxRepaintBody();
  if(typeof window.scrollTo==='function')try{window.scrollTo(0,0);}catch(_){}
  return true;
};
window._siAxOvBack=function(){_siAxOvSit='';_siAxRepaintBody();};
window._siAxOvStep=function(d){
  const L=_siAxOvList().list,pos=L.findIndex(r=>r.a.code===_siAxOvSit),n=L[pos+d];
  if(!n)return false;_siAxOvSit=n.a.code;_siAxRepaintBody();
  if(typeof window.scrollTo==='function')try{window.scrollTo(0,0);}catch(_){}
  return true;
};

// ═══ _siSort BEGIN — one pure comparator module + sortable-table helper ═══
// Rules (every sorted list in the Article Explorer goes through this):
//  • article codes are natural/numeric aware (GST073 < GST100, GST9 < GST10)
//  • sorts are stable; ties break on the caller's list (default: units desc, then code asc)
//  • a missing value (null / '' / '—' / NaN) is ALWAYS last, ascending or descending
//  • categories: units desc, then name · classes: fixed order · sizes: garment order,
//    then numeric waist ascending, then the rest · dates/weeks: chronological (ISO keys)
const _SI_SORT_CLASSES=['Winner','Solid','Steady','Stock-constrained','Slow','Dead stock','Too early','Not rated'];
const _SI_SORT_GARMENT=['XXXS','XXS','XS','S','M','L','XL','XXL','XXXL','4XL','5XL'];
const _SI_SORT_ALIAS={'2XL':'XXL','3XL':'XXXL'};
let _siSortState={},_siSortReg={};

function _siSortMissing(v){return v==null||v===''||v==='—'||(typeof v==='number'&&!isFinite(v));}
// natural compare: digit runs compare as numbers, everything else case-insensitively
function _siSortNat(a,b){
  const x=String(a).toLowerCase().match(/\d+|\D+/g)||[],y=String(b).toLowerCase().match(/\d+|\D+/g)||[];
  for(let i=0;i<x.length&&i<y.length;i++){
    const p=x[i],q=y[i],pd=/^\d/.test(p),qd=/^\d/.test(q);
    if(pd&&qd){
      const pn=p.replace(/^0+(?=\d)/,''),qn=q.replace(/^0+(?=\d)/,'');
      if(pn.length!==qn.length)return pn.length<qn.length?-1:1;
      if(pn!==qn)return pn<qn?-1:1;
      if(p.length!==q.length)return p.length<q.length?-1:1;
    }else if(p!==q)return p<q?-1:1;
  }
  return x.length-y.length;
}
function _siSortSizeKey(s){
  const t=String(s==null?'':s).trim().toUpperCase(),g=_SI_SORT_ALIAS[t]||t;
  const gi=_SI_SORT_GARMENT.indexOf(g);
  if(gi>=0)return[0,gi,''];
  if(/^\d+(\.\d+)?$/.test(t))return[1,parseFloat(t),''];
  if(!t||t==='UNKNOWN')return[3,0,''];
  return[2,0,t];
}
function _siSortCmpSize(a,b){
  const x=_siSortSizeKey(a),y=_siSortSizeKey(b);
  return(x[0]-y[0])||(x[1]-y[1])||_siSortNat(x[2],y[2]);
}
function _siSortClassRank(c){const i=_SI_SORT_CLASSES.findIndex(n=>n.toLowerCase()===String(c==null?'':c).trim().toLowerCase());return i<0?_SI_SORT_CLASSES.length:i;}
const _SI_SORT_TYPES={
  num:(a,b)=>a-b,
  text:_siSortNat,
  code:_siSortNat,
  date:(a,b)=>a<b?-1:a>b?1:0, // ISO YYYY-MM-DD keys sort chronologically as strings
  size:_siSortCmpSize,
  cls:(a,b)=>_siSortClassRank(a)-_siSortClassRank(b)
};
// One comparison of two values of a type, honouring direction. Missing is last in BOTH directions.
function _siSortCmp(a,b,type,dir){
  const ma=_siSortMissing(a),mb=_siSortMissing(b);
  if(ma||mb)return ma&&mb?0:ma?1:-1;
  return(dir<0?-1:1)*(_SI_SORT_TYPES[type]||_SI_SORT_TYPES.text)(a,b);
}
// Stable sort of rows (never mutates). cols = [{key,type,get}], ties = [{get,type,dir}] applied in order.
function _siSortRows(rows,cols,key,dir,ties){
  const col=cols.find(c=>c.key===key)||cols[0];
  const get=col.get||(r=>r[col.key]);
  const d=dir<0?-1:1,tl=ties||[];
  return rows.map((r,i)=>({r,i})).sort((p,q)=>{
    let c=_siSortCmp(get(p.r),get(q.r),col.type||'text',d);
    if(c)return c;
    for(const t of tl){c=_siSortCmp(t.get(p.r),t.get(q.r),t.type||'text',t.dir||1);if(c)return c;}
    return p.i-q.i;
  }).map(o=>o.r);
}
// Category / dimension entries [name,units]: units desc, then name
function _siSortEntries(a,b){return((b[1]||0)-(a[1]||0))||_siSortNat(a[0],b[0]);}
// Articles: units desc, then name, then code
function _siSortArticles(x,y){return((y.units||0)-(x.units||0))||_siSortNat(x.name||'',y.name||'')||_siSortNat(x.code||'',y.code||'');}

// ── sortable table ──
function _siSortSpec(id,def){
  const s=_siSortState[id];return s&&s.key?s:{key:def.key,dir:def.dir};
}
function _siSortFirstDir(col){return col.first?(col.first==='desc'?-1:1):(col.type==='num'?-1:1);}
window._siSortClick=function(id,key){
  const reg=_siSortReg[id];if(!reg)return;
  const col=reg.cols.find(c=>c.key===key);if(!col)return;
  const cur=_siSortSpec(id,reg.def);
  _siSortState[id]=cur.key===key?{key,dir:-cur.dir}:{key,dir:_siSortFirstDir(col)};
  if(typeof _siAxRepaintBody==='function')_siAxRepaintBody();
};
function _siSortTh(id,col,spec){
  const on=spec.key===col.key;
  const aria=on?(spec.dir>0?'ascending':'descending'):'none';
  const mark=on?(spec.dir>0?'▲':'▼'):'↕';
  return`<th scope="col" aria-sort="${aria}"${col.title?` title="${_siEsc(col.title)}"`:''} class="si-sort-th${on?' on':''}"><button type="button" class="si-sort-btn" data-key="${_siEsc(col.key)}" onclick="window._siSortClick('${id}',this.dataset.key)">${_siEsc(col.label)}<span class="si-sort-mark" aria-hidden="true">${mark}</span></button></th>`;
}
// cols: [{key,label,type,get,first?,cell(row,i)}]; opts: {def:{key,dir},ties,minWidth,defText}
function _siSortTable(id,cols,rows,opts){
  opts=opts||{};
  _siSortReg[id]={cols,def:opts.def};
  const spec=_siSortSpec(id,opts.def),col=cols.find(c=>c.key===spec.key)||cols[0];
  const sorted=_siSortRows(rows,cols,col.key,spec.dir,opts.ties);
  const isDef=spec.key===opts.def.key&&spec.dir===opts.def.dir;
  const note=`<div class="si-ax-note" data-sort-note="${id}">Sorted by <strong>${_siEsc(col.label)}</strong>, ${spec.dir>0?'ascending':'descending'}${isDef&&opts.defText?' — '+_siEsc(opts.defText):''}. Click a column heading to re-sort; blank values (—) always stay last.</div>`;
  return note+`<div style="overflow-x:auto"><table class="cut-table si-sort-table" style="min-width:${opts.minWidth||320}px"><thead><tr>${cols.map(c=>_siSortTh(id,c,spec)).join('')}</tr></thead><tbody>${sorted.map((r,i)=>`<tr>${cols.map(c=>c.cell(r,i)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
// ═══ _siSort END ═══

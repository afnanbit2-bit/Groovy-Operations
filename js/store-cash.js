/* Groovy Operations — store-cash.js
   Store Cash & Cost Ledger — proper accounting build (vendors, categories,
   debit/credit payables, bill-photo capture, reconciliation, reporting).
   Run primarily by Raees. Plain global classic script (no import/export).
   Loaded after js/store.js. Shares global scope with store.js REST helpers:
   fsAdd, fsSet, fsList, fsDelete, fsQueryOrdered, todayStr, safeId, and
   shared.js helpers: showToast, logActivity, uploadToCloudinary. */

// ── State ──
let allCashLedger = [];
let allCashAccounts = [];
let allCashFloats = [];
let allCashCategories = [];
let allCashVendors = [];
let cashDataLoaded = false;
let _cashBusy = false;
let _cashTab = 'recent';
let _cashInsightsPeriod = '';
let _cashRecentPage = 0;

// transient sheet state
let _cashExpenseCat = '';
let _cashExpenseVendor = '';
let _cashExpenseAcc = 'cash';
let _cashExpenseMode = 'paid';      // 'paid' | 'credit'
let _cashTopupAcc = 'cash';
let _cashCatVendorMode = 'existing'; // 'existing' | 'new'

// uploaded photo URLs keyed by input element id
window._cashPhoto = window._cashPhoto || {};

// ── Constants ──
const CASH_ACCOUNTS = [
  {key:'cash',      label:'Cash',       accent:'#111111', online:false},
  {key:'sadapay',   label:'SadaPay',    accent:'#475569', online:true},
  {key:'easypaisa', label:'EasyPaisa',  accent:'#475569', online:true},
  {key:'mcb',       label:'MCB Bank',   accent:'#475569', online:true}
];

const WALKIN_VENDOR = {_id:'walkin', name:'Walk-in / Direct', phone:'', address:'', productTypes:[], creditTerms:'', builtin:true, openingOutstanding:0};

// deterministic muted accent per category (monotone base + subtle hue for scanning charts)
const _CAT_PALETTE = ['#0f172a','#334155','#475569','#0369a1','#0891b2','#15803d','#b45309','#7c3aed','#be123c','#4d7c0f'];
function _catAccent(id){let h=0;for(const ch of String(id||'')){h=(h*31+ch.charCodeAt(0))>>>0;}return _CAT_PALETTE[h%_CAT_PALETTE.length];}

// ── Permissions ──
function _canViewCash(){
  return session && (
    ['afnan','ammar','mustafa','arfat','raees'].includes(session.u) ||
    session.role === 'owner' || session.role === 'manager' || session.role === 'store'
  );
}
function _canEntryCash(){ return _canViewCash(); }
function _canAdminCash(){
  return session && (['afnan','ammar'].includes(session.u) || session.role === 'owner');
}

// ── Format helpers ──
function _scEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _fmtPKR(n){
  const v = Math.abs(Math.round(n||0));
  return (n<0?'−':'')+'₨'+v.toLocaleString('en-PK');
}
function _cashCurrentMonth(){
  const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function _cashPrevMonth(mo){
  const [y,m]=mo.split('-').map(Number);
  const d=new Date(y,m-2,1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}

// ── Sheet helper (uses existing mob-sheet DOM) ──
function _cashOpenSheet(title, html){
  const sheet=document.getElementById('mob-sheet');
  const back=document.getElementById('mob-sheet-backdrop');
  const titleEl=document.getElementById('mob-sheet-title');
  const itemsEl=document.getElementById('mob-sheet-items');
  if(!sheet||!back||!itemsEl) return;
  titleEl.textContent=title||'';
  titleEl.style.display=title?'block':'none';
  itemsEl.innerHTML=`<div style="padding:0 4px 16px">${html}</div>`;
  back.classList.add('open');
  requestAnimationFrame(()=>sheet.classList.add('open'));
}
function _cashCloseSheet(){
  const sheet=document.getElementById('mob-sheet');
  const back=document.getElementById('mob-sheet-backdrop');
  if(sheet)sheet.classList.remove('open');
  if(back)back.classList.remove('open');
}

// ── Photo upload helper ──
window._cashUploadPhoto=async function(inputId,statusId){
  const inp=document.getElementById(inputId);
  const file=inp&&inp.files&&inp.files[0];
  if(!file)return;
  const st=document.getElementById(statusId);
  if(st)st.innerHTML='<span class="spinner" style="width:14px;height:14px"></span> Uploading…';
  try{
    const url=await uploadToCloudinary(file);
    window._cashPhoto[inputId]=url;
    if(st)st.innerHTML=`<a href="${url}" target="_blank" style="color:#15803d;font-weight:700;text-decoration:none">✓ Attached — tap to view</a> <button onclick="window._cashClearPhoto('${inputId}','${statusId}')" style="background:none;border:none;color:#dc2626;font-size:11px;cursor:pointer">remove</button>`;
  }catch(e){
    if(st)st.innerHTML=`<span style="color:#dc2626">Upload failed: ${_scEsc(e.message)}</span>`;
  }
};
window._cashClearPhoto=function(inputId,statusId){
  delete window._cashPhoto[inputId];
  const inp=document.getElementById(inputId); if(inp)inp.value='';
  const st=document.getElementById(statusId); if(st)st.innerHTML='';
};
function _cashPhotoField(inputId,statusId,label){
  return `<label for="${inputId}" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:11px;border:1.5px dashed var(--border);border-radius:10px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;background:#fafafa;box-sizing:border-box">
      📷 ${label}
    </label>
    <input id="${inputId}" type="file" accept="image/*" capture="environment" style="display:none" onchange="window._cashUploadPhoto('${inputId}','${statusId}')">
    <div id="${statusId}" style="font-size:12px;margin:6px 0 0;min-height:16px"></div>`;
}

// ── Data layer ──
async function loadStoreCashData(){
  if(cashDataLoaded) return;
  try{
    const [ledger,accounts,floats,cats,vendors]=await Promise.all([
      // High cap: outstanding/payables, delete guards and insights iterate this
      // in-memory list, so it must hold the full working history, not a window.
      fsQueryOrdered('store_cash_ledger','ts',5000).catch(()=>[]),
      fsList('store_cash_accounts',30).catch(()=>[]),
      fsList('store_cash_floats',80).catch(()=>[]),
      fsList('store_cash_categories',60).catch(()=>[]),
      fsList('store_cash_vendors',100).catch(()=>[])
    ]);
    allCashLedger=ledger;
    allCashAccounts=accounts;
    allCashFloats=floats;
    allCashCategories=cats;
    allCashVendors=vendors;
    cashDataLoaded=true;
    await _cashSeedAccounts();
    await _cashSeedWalkin();
    _cashRecalcBalances();
  }catch(e){ console.error('[store-cash] load error',e); }
}

async function _cashSeedAccounts(){
  for(const acc of CASH_ACCOUNTS){
    const doc=allCashAccounts.find(a=>(a._id||a.key)===acc.key);
    if(!doc){
      const d={key:acc.key,label:acc.label,accent:acc.accent,online:acc.online,balance:0,openingBalance:0,countedBalance:null,countedAt:null,countedBy:null,builtin:true,lastUpdated:Date.now(),lastBy:(session&&session.name)||''};
      await fsSet('store_cash_accounts',acc.key,d).catch(()=>{});
      allCashAccounts.push({...d,_id:acc.key});
    }else if(!doc.label||!doc.accent||doc.online===undefined){
      // Repair: fsSet replaces docs, so earlier partial balance writes stripped
      // label/accent/online off the built-in accounts. Backfill from constant.
      doc.label=doc.label||acc.label;doc.accent=doc.accent||acc.accent;
      if(doc.online===undefined)doc.online=acc.online;doc.builtin=true;
      _cashPersistAccount(doc);
    }
  }
}

// Persist the FULL account doc (fsSet does a replace, not a merge — a partial
// write would silently delete label/accent/online). Backfills built-in metadata.
function _cashPersistAccount(acc){
  const k=acc._id||acc.key;
  const base=CASH_ACCOUNTS.find(a=>a.key===k);
  if(base){acc.label=acc.label||base.label;acc.accent=acc.accent||base.accent;if(acc.online===undefined)acc.online=base.online;acc.builtin=true;}
  const {_id,...rest}=acc;
  return fsSet('store_cash_accounts',k,rest).catch(()=>{});
}
async function _cashSeedWalkin(){
  if(!allCashVendors.some(v=>(v._id||v.id)==='walkin')){
    const d={...WALKIN_VENDOR,createdAt:Date.now()};
    await fsSet('store_cash_vendors','walkin',d).catch(()=>{});
    allCashVendors.unshift({...d,_id:'walkin'});
  }
}

// ── Accessors ──
function _cashAllAccounts(){
  // built-in order first, then any custom accounts created later
  const seen=new Set();const out=[];
  for(const a of CASH_ACCOUNTS){out.push(_cashGetAccount(a.key));seen.add(a.key);}
  for(const a of allCashAccounts){const k=a._id||a.key;if(!seen.has(k)){out.push(_cashGetAccount(k));seen.add(k);}}
  return out;
}
// Always resolve label/accent from the built-in constant so a partial-write
// wipe (see _cashPersistAccount) never surfaces as a blank / "undefined" label.
function _cashGetAccount(key){
  const base=CASH_ACCOUNTS.find(a=>a.key===key);
  const doc=allCashAccounts.find(a=>(a._id||a.key)===key);
  if(!doc&&!base) return null;
  const m={...(base||{}),...(doc||{}),_id:key};
  m.label=(doc&&doc.label)||base?.label||key;
  m.accent=(doc&&doc.accent)||base?.accent||'#111';
  if(base) m.online=base.online;
  return m;
}
function _cashGetCategory(key){
  if(!key) return null;
  return allCashCategories.find(c=>(c._id||c.key)===key)||null;
}
function _cashGetVendor(id){
  if(!id) return null;
  if(id==='walkin') return allCashVendors.find(v=>(v._id||v.id)==='walkin')||{...WALKIN_VENDOR};
  return allCashVendors.find(v=>(v._id||v.id)===id)||null;
}
function _cashVendorOutstanding(vendorId){
  let bal=0;
  const v=_cashGetVendor(vendorId);
  if(v&&v.openingOutstanding) bal+=v.openingOutstanding;
  for(const r of allCashLedger){
    if(r.vendorId!==vendorId) continue;
    if(r.kind==='credit_purchase') bal+=(r.amount||0);
    else if(r.kind==='vendor_payment') bal-=(r.amount||0);
  }
  return Math.round(bal);
}
function _cashTotalPayables(){
  return allCashVendors.reduce((s,v)=>s+Math.max(0,_cashVendorOutstanding(v._id||v.id)),0);
}

// ── Write core ──
async function _cashPost(entry){
  if(_cashBusy){showToast('Please wait…',true);return null;}
  _cashBusy=true;
  try{
    const id=await fsAdd('store_cash_ledger',entry);
    const row={...entry,_id:id};
    allCashLedger.unshift(row);
    _cashApplyLedgerDelta(entry,+1);
    logActivity('store-cash',`${entry.kind} ${entry.category||entry.vendorId||''} ${_fmtPKR(entry.amount)}`).catch(()=>{});
    _cashBusy=false;
    return row;
  }catch(e){
    showToast('Save failed: '+e.message,true);
    _cashBusy=false;
    return null;
  }
}

// apply an entry's effect on account balances (dir +1 = post)
function _cashApplyLedgerDelta(entry,dir){
  const a=entry.amount||0;
  const k=entry.kind;
  if(k==='topup')                          _cashApplyDelta(entry.account,+a*dir);
  else if(k==='expense')                   _cashApplyDelta(entry.account,-a*dir);
  else if(k==='vendor_payment')            _cashApplyDelta(entry.account,-a*dir);
  else if(k==='issue')                     _cashApplyDelta(entry.account,-a*dir);
  else if(k==='settle'&&a>0)               _cashApplyDelta(entry.account,+a*dir);
  else if(k==='transfer'){                 _cashApplyDelta(entry.account,-a*dir);_cashApplyDelta(entry.counterAccount,+a*dir);}
  else if(k==='adjust')                    _cashApplyDelta(entry.account,a*dir);
  // credit_purchase => no account movement (payable only)
}

function _cashApplyDelta(key,delta){
  if(!delta||!key) return;
  const acc=allCashAccounts.find(a=>(a._id||a.key)===key);
  if(!acc){console.warn('[store-cash] unknown account:',key);return;}
  acc.balance=Math.round((acc.balance||0)+delta);
  acc.lastUpdated=Date.now();
  acc.lastBy=(session&&session.name)||'';
  _cashPersistAccount(acc);
}

function _cashRecalcBalances(){
  const bals={};
  for(const a of allCashAccounts){const k=a._id||a.key;bals[k]=a.openingBalance||0;}
  const rows=[...allCashLedger].reverse();
  for(const r of rows){
    const amt=r.amount||0;
    if(r.kind==='topup')                          bals[r.account]=(bals[r.account]||0)+amt;
    else if(r.kind==='expense')                   bals[r.account]=(bals[r.account]||0)-amt;
    else if(r.kind==='vendor_payment')            bals[r.account]=(bals[r.account]||0)-amt;
    else if(r.kind==='issue')                     bals[r.account]=(bals[r.account]||0)-amt;
    else if(r.kind==='settle'&&amt>0)             bals[r.account]=(bals[r.account]||0)+amt;
    else if(r.kind==='transfer'){                 bals[r.account]=(bals[r.account]||0)-amt;bals[r.counterAccount]=(bals[r.counterAccount]||0)+amt;}
    else if(r.kind==='adjust')                    bals[r.account]=(bals[r.account]||0)+amt;
    // credit_purchase => no balance change
  }
  for(const a of allCashAccounts){
    const k=a._id||a.key;
    const derived=Math.round(bals[k]||0);
    if(a.balance!==derived){
      console.log(`[store-cash] recompute ${k}: ${a.balance} → ${derived}`);
      a.balance=derived;a.lastUpdated=Date.now();a.lastBy='system:recompute';
      _cashPersistAccount(a);
    }
  }
}

// ── Page entry point ──
function renderStoreCashLedger(){
  if(!_canViewCash()) return '<div class="empty" style="padding:40px">Access restricted.</div>';
  if(!cashDataLoaded){
    loadStoreCashData().then(()=>{
      const m=document.getElementById('main-content');
      if(m&&currentPage==='store-cash-ledger') m.innerHTML=renderStoreCashLedger();
    });
    return '<div style="padding:40px;text-align:center"><span class="spinner"></span><div style="margin-top:12px;color:var(--muted);font-size:14px">Loading Cash Ledger…</div></div>';
  }
  return _cashPageHTML();
}

function _cashReload(){
  const m=document.getElementById('main-content');
  if(m&&currentPage==='store-cash-ledger') m.innerHTML=renderStoreCashLedger();
}

// ── Page HTML ──
function _cashPageHTML(){
  const mo=_cashCurrentMonth();
  const period=_cashInsightsPeriod||mo;
  const entries=allCashLedger;
  const thisMonthOut=entries.filter(r=>(r.kind==='expense'||r.kind==='credit_purchase')&&r.month===mo).reduce((s,r)=>s+(r.amount||0),0);
  const openFloat=allCashFloats.filter(f=>f.status==='open').reduce((s,f)=>s+(f.issued||0),0);
  const payables=_cashTotalPayables();
  const tabs=[
    {id:'recent',label:'Recent'},
    {id:'issued',label:'Issued'},
    {id:'byaccount',label:'Accounts'},
    {id:'insights',label:'Insights'},
    {id:'categories',label:'Categories'},
    {id:'vendors',label:'Vendors'}
  ];
  let h='';
  h+=_cashKpiStrip(thisMonthOut,openFloat,payables);
  h+=`<div class="gp-tabs" style="margin:0 -16px;padding:0 16px;overflow-x:auto;white-space:nowrap">${tabs.map(t=>`<div class="gp-tab${_cashTab===t.id?' active':''}" onclick="window._cashSetTab('${t.id}')">${t.label}</div>`).join('')}</div>`;
  h+=`<div id="cash-tab-body" style="padding-top:10px">`;
  if(_cashTab==='recent')         h+=_cashRecentFeed(entries);
  else if(_cashTab==='issued')    h+=_cashIssuedFeed();
  else if(_cashTab==='byaccount') h+=_cashByAccountFeed(entries);
  else if(_cashTab==='insights')  h+=_cashInsightsPanel(entries,period);
  else if(_cashTab==='categories')h+=_cashCategoriesPanel();
  else if(_cashTab==='vendors')   h+=_cashVendorsPanel();
  h+=`</div>`;
  if(_canEntryCash()&&(_cashTab==='recent'||_cashTab==='byaccount'||_cashTab==='issued')) h+=_cashActionBar();
  h+=`<div style="height:160px"></div>`;
  return h;
}

// ── KPI Strip ──
function _cashKpiStrip(thisMonthOut,openFloat,payables){
  const wallets=_cashAllAccounts().map(a=>{
    const bal=a.balance||0;
    return `<div onclick="window._cashSetTab('byaccount')" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;border-top:3px solid ${a.accent||'#111'}">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px;font-weight:700">${_scEsc(a.label)}</div>
      <div style="font-size:17px;font-weight:800;color:${bal<0?'#dc2626':'#111'};line-height:1">${_fmtPKR(bal)}</div>
    </div>`;
  }).join('');
  const totalBal=allCashAccounts.reduce((s,a)=>s+(a.balance||0),0);
  const tile=(label,val,opts={})=>{
    const danger=opts.danger;const onclick=opts.onclick?`onclick="${opts.onclick}" style="cursor:pointer;`:'style="';
    return `<div ${onclick}background:#fff;border:1px solid ${danger?'#fca5a5':'var(--border)'};border-radius:10px;padding:10px 12px;border-top:3px solid ${danger?'#dc2626':'#111'}">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:${danger?'#dc2626':'var(--muted)'};margin-bottom:4px;font-weight:700">${label}</div>
      <div style="font-size:17px;font-weight:800;color:${danger?'#dc2626':(val<0?'#dc2626':'#111')};line-height:1">${_fmtPKR(val)}</div>
    </div>`;
  };
  return `<div style="padding:12px 0 4px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:7px;margin-bottom:7px">${wallets}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:6px">
      ${tile('Net Cash',totalBal)}
      ${tile('Out This Month',thisMonthOut)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px">
      ${tile('With Runners',openFloat,{danger:openFloat>0,onclick:"window._cashSetTab('issued')"})}
      ${tile('Payables',payables,{danger:payables>0,onclick:"window._cashSetTab('vendors')"})}
    </div>
  </div>`;
}

// ── Recent Feed ──
function _cashRecentFeed(entries){
  if(!entries.length) return `<div class="empty" style="padding:40px 0;text-align:center">No entries yet.<br><span style="font-size:13px;color:var(--muted)">Tap <strong>Record Expense</strong> below to start.</span></div>`;
  const PG=25;
  const totalPages=Math.ceil(entries.length/PG);
  if(_cashRecentPage>=totalPages)_cashRecentPage=Math.max(0,totalPages-1);
  const page=entries.slice(_cashRecentPage*PG,(_cashRecentPage+1)*PG);

  const tod=todayStr();
  const yd=new Date(); yd.setDate(yd.getDate()-1);
  const yest=[yd.getFullYear(),String(yd.getMonth()+1).padStart(2,'0'),String(yd.getDate()).padStart(2,'0')].join('-');
  function _dLabel(d){
    if(d===tod) return 'Today';
    if(d===yest) return 'Yesterday';
    const dt=new Date(d+'T00:00:00');
    return isNaN(dt)?d:dt.toLocaleDateString('en-PK',{weekday:'short',day:'numeric',month:'short'});
  }

  const groups={};const groupOrder=[];
  for(const r of page){
    const d=r.date||'—';
    if(!groups[d]){groups[d]=[];groupOrder.push(d);}
    groups[d].push(r);
  }

  let rows='';
  for(const d of groupOrder){
    rows+=`<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding:10px 0 4px;margin-top:4px">${_dLabel(d)}</div>`;
    for(const r of groups[d]){
      rows+=_cashFeedRow(r);
    }
  }
  let pager='';
  if(totalPages>1){
    pager=`<div style="display:flex;gap:8px;align-items:center;justify-content:center;padding:12px 0 4px;border-top:1px solid var(--border);margin-top:4px">
      <button onclick="window._cashPageNav(${_cashRecentPage-1})" ${_cashRecentPage===0?'disabled':''} class="btn-outline" style="padding:6px 14px;font-size:12px">← Prev</button>
      <span style="font-size:12px;color:var(--muted)">Page <strong>${_cashRecentPage+1}</strong>/${totalPages} · ${entries.length} entries</span>
      <button onclick="window._cashPageNav(${_cashRecentPage+1})" ${_cashRecentPage>=totalPages-1?'disabled':''} class="btn-outline" style="padding:6px 14px;font-size:12px">Next →</button>
    </div>`;
  }
  return `<div>${rows}${pager}</div>`;
}

function _cashFeedRow(r){
  const cat=_cashGetCategory(r.category);
  const vendor=_cashGetVendor(r.vendorId);
  const acc=_cashGetAccount(r.account);
  const isIn=(r.kind==='topup'||r.kind==='settle');
  const isXfer=r.kind==='transfer';
  const isCredit=r.kind==='credit_purchase';
  const sign=isIn?'+':isXfer?'↕':'-';
  const col=isIn?'#15803d':isXfer?'#475569':'#dc2626';
  const dot=cat?_catAccent(r.category):(r.kind==='topup'?'#15803d':r.kind==='vendor_payment'?'#b45309':'#6b7280');
  let title,sub;
  if(r.kind==='expense'||r.kind==='credit_purchase'){
    title=(cat?cat.label:'Uncategorized')+(vendor&&vendor._id!=='walkin'?' · '+vendor.name:'');
    sub=(isCredit?'ON CREDIT':(r.fromFloat?'Runner float':(acc?acc.label:r.account||'')))+(r.note?' · '+_scEsc(r.note):'');
  }else if(r.kind==='vendor_payment'){
    title='Paid '+(vendor?vendor.name:'vendor');
    sub=(acc?acc.label:r.account||'')+(r.note?' · '+_scEsc(r.note):'');
  }else if(r.kind==='topup'){
    title='Money In';sub=(acc?acc.label:r.account||'')+(r.note?' · '+_scEsc(r.note):'');
  }else if(r.kind==='issue'){
    title='Issued · '+_scEsc(r.payee||'');sub=(acc?acc.label:r.account||'')+(r.note?' · '+_scEsc(r.note):'');
  }else if(r.kind==='settle'){
    title='Change · '+_scEsc(r.payee||'');sub=(acc?acc.label:r.account||'');
  }else if(r.kind==='transfer'){
    title='Transfer';sub=(_cashGetAccount(r.account)?.label||r.account)+' → '+(_cashGetAccount(r.counterAccount)?.label||r.counterAccount);
  }else if(r.kind==='adjust'){
    title='Adjustment';sub=(acc?acc.label:r.account||'')+(r.adjustsReason?' · '+_scEsc(r.adjustsReason):'');
  }else{ title=r.kind; sub=''; }
  const proof=(r.billPhoto||r.proofPhoto)?`<a href="${r.billPhoto||r.proofPhoto}" target="_blank" onclick="event.stopPropagation()" style="text-decoration:none;font-size:13px;margin-right:4px" title="View bill/proof">📎</a>`:'';
  return `<div onclick="window._cashRowAction('${r._id}')" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f5f5f5;cursor:pointer">
    <div style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0"></div>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_scEsc(title)}${isCredit?' <span style="font-size:9px;background:#fef2f2;color:#dc2626;padding:1px 6px;border-radius:8px;font-weight:700;vertical-align:middle">CREDIT</span>':''}</div>
      <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_scEsc(sub)} · ${_scEsc(r.by||'')}</div>
    </div>
    ${proof}
    <div style="font-size:14px;font-weight:800;color:${col};flex-shrink:0;padding-left:2px">${sign}${_fmtPKR(r.amount)}</div>
  </div>`;
}

// ── Issued Floats ──
function _cashIssuedFeed(){
  const open=allCashFloats.filter(f=>f.status==='open');
  const closed=allCashFloats.filter(f=>f.status==='settled').slice(0,8);
  if(!open.length&&!closed.length) return `<div class="empty" style="padding:32px 0;text-align:center">No issued floats.<br><span style="font-size:12px;color:var(--muted)">Use <strong>Issue Cash</strong> to hand out a runner float.</span></div>`;
  const ageColor=ts=>{const d=(Date.now()-ts)/86400000;return d>7?'#dc2626':d>3?'#b45309':'#15803d';};
  const ageLabel=ts=>{ const d=Math.round((Date.now()-ts)/86400000);return d===0?'today':d+'d ago'; };
  const openCards=open.map(f=>`<div style="background:#fff;border:1px solid #fca5a5;border-radius:10px;padding:12px 14px;margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div style="font-weight:700;font-size:14px">${_scEsc(f.payee)||'Runner'}
        <span style="font-size:10px;background:${ageColor(f.issuedTs)};color:#fff;padding:2px 7px;border-radius:10px;margin-left:6px">${ageLabel(f.issuedTs)}</span>
      </div>
      <div style="font-size:16px;font-weight:800;color:#dc2626">${_fmtPKR(f.issued)}</div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">From ${_scEsc(_cashGetAccount(f.account)?.label||f.account)} · ${_scEsc(f.issuedBy||'')} · ${new Date(f.issuedTs).toLocaleDateString()}${f.note?' · '+_scEsc(f.note):''}</div>
    ${_canEntryCash()?`<button class="btn-primary" style="font-size:12px;padding:6px 16px;margin-top:0;background:#111" onclick="window.cashSettleFloat('${_scEsc(f._id)}')">Settle with bill ✓</button>`:''}
  </div>`).join('');
  const closedSection=closed.length?`<div style="font-size:10px;color:var(--muted);margin:12px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Recently Settled</div>`+closed.map(f=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
    <span style="color:var(--muted)">${_scEsc(f.payee)||'Runner'} · ${new Date(f.issuedTs).toLocaleDateString()}${f.billPhoto?` · <a href="${f.billPhoto}" target="_blank" style="text-decoration:none">📎</a>`:''}</span>
    <span style="font-weight:700;color:#15803d">Settled ${_fmtPKR(f.issued)}${f.variance?` (${f.variance>0?'−':'+'}${_fmtPKR(Math.abs(f.variance))})`:''}</span>
  </div>`).join(''):'';
  return `<div>${openCards}${closedSection}</div>`;
}

// ── By Account ──
function _cashByAccountFeed(entries){
  let h='';
  for(const acc of _cashAllAccounts()){
    const key=acc._id||acc.key;
    const doc=_cashGetAccount(key);
    const bal=doc?.balance||0;
    const recent=entries.filter(r=>r.account===key||r.counterAccount===key).slice(0,6);
    const drift=doc?.countedBalance!=null?Math.abs(bal-(doc.countedBalance||0)):null;
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-top:3px solid ${acc.accent||'#111'}">
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">${_scEsc(acc.label)}${acc.online?' · online':''}</div>
          <div style="font-size:24px;font-weight:800;color:${bal<0?'#dc2626':'#111'};line-height:1.1">${_fmtPKR(bal)}</div>
          ${drift!=null?`<div style="font-size:11px;margin-top:2px;color:${drift>10?'#dc2626':'#15803d'}">Last count: ${_fmtPKR(doc.countedBalance)} ${drift>10?'· off by '+_fmtPKR(drift):'✓'}</div>`:''}
        </div>
        <button class="btn-outline" style="font-size:11px;padding:4px 12px" onclick="window.cashCountWallet('${key}')">Count</button>
      </div>
      <div style="padding:2px 14px 10px">
        ${recent.map(r=>{
          const cat=_cashGetCategory(r.category);
          const isIn=(r.kind==='topup'||r.kind==='settle');
          const col=isIn?'#15803d':r.kind==='transfer'?'#475569':'#dc2626';
          const sign=isIn?'+':r.kind==='transfer'?'↕':'-';
          const lbl=cat?cat.label:(r.kind==='vendor_payment'?'Paid '+(_cashGetVendor(r.vendorId)?.name||'vendor'):r.kind);
          return`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:12px">
            <span style="color:var(--muted)">${_scEsc(lbl)} · ${_scEsc(r.date||'')}</span>
            <span style="font-weight:700;color:${col}">${sign}${_fmtPKR(r.amount)}</span>
          </div>`;
        }).join('')}
        ${!recent.length?`<div style="font-size:12px;color:var(--muted);padding:8px 0">No entries yet.</div>`:''}
      </div>
    </div>`;
  }
  h+=`<div style="display:flex;gap:8px;margin-top:4px">
    <button class="btn-outline" style="flex:1;font-size:12px;padding:8px" onclick="window.cashRecomputeBalances()">↺ Recompute balances</button>
    ${_canAdminCash()
      ?`<button class="btn-outline" style="flex:1;font-size:12px;padding:8px" onclick="window.cashSheetNewAccount()">+ New account</button>`
      :`<button class="btn-outline" style="flex:1;font-size:12px;padding:8px" onclick="window.cashRequestAccount()">Request new account</button>`}
  </div>`;
  if(_canAdminCash()){
    h+=`<div style="margin-top:22px;border:1px solid #fca5a5;border-radius:10px;padding:14px;background:#fff5f5">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#dc2626;margin-bottom:4px">Danger Zone</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:10px">Erase every ledger entry, runner float, category and vendor, and reset all account balances to zero. Use this to clear old test data before going live. This cannot be undone.</div>
      <button class="btn-outline" style="width:100%;font-size:12px;padding:9px;color:#dc2626;border-color:#fca5a5" onclick="window.cashResetAllData()">🗑 Reset all cash data</button>
    </div>`;
  }
  return h;
}

// ── CATEGORIES PANEL ──
function _cashCategoriesPanel(){
  const mo=_cashCurrentMonth();
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-size:13px;color:var(--muted)">${allCashCategories.length} categor${allCashCategories.length===1?'y':'ies'}</div>
    ${_canEntryCash()?`<button class="btn-primary" style="background:#111;font-size:12px;padding:7px 14px" onclick="window.cashSheetCategory()">+ New Category</button>`:''}
  </div>`;
  if(!allCashCategories.length){
    h+=`<div class="empty" style="padding:34px 16px;text-align:center;border:1.5px dashed var(--border);border-radius:12px">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">No categories yet</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.5">Create your first expense category — each one is linked to a vendor so spending is traceable.</div>
    </div>`;
    return h;
  }
  const sorted=[...allCashCategories].sort((a,b)=>(a.label||'').localeCompare(b.label||''));
  for(const c of sorted){
    const id=c._id||c.key;
    const vendor=_cashGetVendor(c.vendorId);
    const spend=allCashLedger.filter(r=>(r.kind==='expense'||r.kind==='credit_purchase')&&r.category===id&&r.month===mo).reduce((s,r)=>s+(r.amount||0),0);
    const budget=c.monthlyBudget||0;
    const pct=budget>0?Math.round(spend/budget*100):null;
    const barCol=pct!=null?(pct>100?'#dc2626':pct>80?'#b45309':'#15803d'):_catAccent(id);
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:${_catAccent(id)};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700">${_scEsc(c.label)}</div>
          <div style="font-size:11px;color:var(--muted)">${vendor?'Vendor: '+_scEsc(vendor.name):'No vendor linked'}</div>
        </div>
        ${_canEntryCash()?`<button class="btn-outline" style="font-size:11px;padding:4px 10px" onclick="window.cashSheetCategory('${id}')">Edit</button>`:''}
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:8px">
        <span style="font-size:11px;color:var(--muted)">This month</span>
        <span style="font-size:13px;font-weight:800">${_fmtPKR(spend)}${budget>0?` <span style="font-weight:500;color:var(--muted)">/ ${_fmtPKR(budget)}</span>`:''}</span>
      </div>
      ${budget>0?`<div style="height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;margin-top:5px"><div style="height:100%;width:${Math.min(100,pct)}%;background:${barCol};border-radius:3px"></div></div>
        ${pct>100?`<div style="font-size:10px;color:#dc2626;font-weight:600;margin-top:3px">⚠ Over by ${_fmtPKR(spend-budget)}</div>`:''}`:''}
    </div>`;
  }
  return h;
}

// ── VENDORS PANEL ──
function _cashVendorsPanel(){
  const real=allCashVendors.filter(v=>(v._id||v.id)!=='walkin');
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-size:13px;color:var(--muted)">${real.length} vendor${real.length===1?'':'s'} · Payables ${_fmtPKR(_cashTotalPayables())}</div>
    ${_canEntryCash()?`<button class="btn-primary" style="background:#111;font-size:12px;padding:7px 14px" onclick="window.cashSheetVendor()">+ New Vendor</button>`:''}
  </div>`;
  if(!real.length){
    h+=`<div class="empty" style="padding:34px 16px;text-align:center;border:1.5px dashed var(--border);border-radius:12px">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">No vendors yet</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.5">Add vendors with contact, address and product types. Walk-in / direct buys are always available without a profile.</div>
    </div>`;
    return h;
  }
  const sorted=[...real].sort((a,b)=>_cashVendorOutstanding(b._id||b.id)-_cashVendorOutstanding(a._id||a.id));
  for(const v of sorted){
    const id=v._id||v.id;
    const out=_cashVendorOutstanding(id);
    const types=(v.productTypes||[]).filter(Boolean);
    h+=`<div style="background:#fff;border:1px solid ${out>0?'#fca5a5':'var(--border)'};border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700">${_scEsc(v.name)}</div>
          ${v.phone?`<div style="font-size:12px;margin-top:2px"><a href="tel:${_scEsc(v.phone)}" style="color:#0369a1;text-decoration:none">📞 ${_scEsc(v.phone)}</a></div>`:''}
          ${v.address?`<div style="font-size:11px;color:var(--muted);margin-top:2px">📍 ${_scEsc(v.address)}</div>`:''}
          ${v.creditTerms?`<div style="font-size:11px;color:var(--muted);margin-top:2px">Terms: ${_scEsc(v.creditTerms)}</div>`:''}
          ${types.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${types.map(t=>`<span style="font-size:10px;background:#f0f0f0;color:#333;padding:2px 8px;border-radius:8px;font-weight:600">${_scEsc(t)}</span>`).join('')}</div>`:''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">Outstanding</div>
          <div style="font-size:17px;font-weight:800;color:${out>0?'#dc2626':'#15803d'}">${_fmtPKR(out)}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px">
        ${out>0&&_canEntryCash()?`<button class="btn-primary" style="flex:1;background:#111;font-size:12px;padding:7px" onclick="window.cashSheetPayVendor('${id}')">Pay Vendor</button>`:''}
        ${_canEntryCash()?`<button class="btn-outline" style="${out>0?'':'flex:1;'}font-size:12px;padding:7px ${out>0?'14px':''}" onclick="window.cashSheetVendor('${id}')">Edit</button>`:''}
        <button class="btn-outline" style="font-size:12px;padding:7px 14px" onclick="window.cashVendorLedger('${id}')">History</button>
      </div>
    </div>`;
  }
  return h;
}

// ── Insights ──
function _cashInsightsPanel(entries,period){
  if(!_canViewCash()) return '<div class="empty">Access restricted.</div>';
  const mo=period||_cashCurrentMonth();
  const months=[...new Set(entries.map(r=>r.month||'').filter(Boolean))].sort().reverse().slice(0,6);
  const isExp=r=>r.kind==='expense'||r.kind==='credit_purchase';
  const sel=entries.filter(r=>r.month===mo);
  const prevMo=_cashPrevMonth(mo);
  const prevSel=entries.filter(r=>r.month===prevMo);

  const expenses=sel.filter(isExp);
  const prevExp=prevSel.filter(isExp);
  const topups=sel.filter(r=>r.kind==='topup');
  const prevTopups=prevSel.filter(r=>r.kind==='topup');

  const totalOut=expenses.reduce((s,r)=>s+(r.amount||0),0);
  const prevOut=prevExp.reduce((s,r)=>s+(r.amount||0),0);
  const totalIn=topups.reduce((s,r)=>s+(r.amount||0),0);
  const prevIn=prevTopups.reduce((s,r)=>s+(r.amount||0),0);
  const net=totalIn-totalOut;

  function _delta(cur,prev,lowerGood){
    if(!prev) return '';
    const d=Math.round((cur-prev)/prev*100);
    const col=(d>0)===lowerGood?'#dc2626':'#15803d';
    return `<div style="font-size:10px;color:${col};font-weight:700;margin-top:3px">${d>0?'▲':'▼'}${Math.abs(d)}% vs ${prevMo}</div>`;
  }

  const byCat={};
  for(const r of expenses){const k=r.category||'__none__';byCat[k]=(byCat[k]||0)+(r.amount||0);}
  const catSorted=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);

  const byVendor={};
  for(const r of expenses){const k=r.vendorId||'walkin';byVendor[k]=(byVendor[k]||0)+(r.amount||0);}
  const vendorSorted=Object.entries(byVendor).sort((a,b)=>b[1]-a[1]);

  const byUser={};const userCt={};
  for(const r of expenses){const k=r.by||'system';byUser[k]=(byUser[k]||0)+(r.amount||0);userCt[k]=(userCt[k]||0)+1;}
  const userSorted=Object.entries(byUser).sort((a,b)=>b[1]-a[1]);

  const byDay={};
  for(const r of expenses){if(r.date)byDay[r.date]=(byDay[r.date]||0)+(r.amount||0);}
  const dayMax=Math.max(...Object.values(byDay),1);
  const dayEntries=Object.entries(byDay).sort((a,b)=>a[0].localeCompare(b[0]));

  // weekly Mon–Sun buckets within the month
  const byWeek={};
  for(const r of expenses){
    if(!r.date)continue;
    const dt=new Date(r.date+'T00:00:00');if(isNaN(dt))continue;
    const day=(dt.getDay()+6)%7; // Mon=0
    const monday=new Date(dt);monday.setDate(dt.getDate()-day);
    const wk=[monday.getFullYear(),String(monday.getMonth()+1).padStart(2,'0'),String(monday.getDate()).padStart(2,'0')].join('-');
    byWeek[wk]=(byWeek[wk]||0)+(r.amount||0);
  }
  const weekEntries=Object.entries(byWeek).sort((a,b)=>a[0].localeCompare(b[0]));
  const weekMax=Math.max(...Object.values(byWeek),1);

  const budgetOf=k=>{const c=_cashGetCategory(k);return c?(c.monthlyBudget||0):0;};
  const hasBudget=allCashCategories.some(c=>(c.monthlyBudget||0)>0);

  let h='';
  if(months.length>1){
    h+=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${months.map(m=>`<button onclick="window._cashSetPeriod('${m}')" style="padding:5px 12px;border-radius:16px;border:1.5px solid ${mo===m?'#111':'var(--border)'};background:${mo===m?'#111':'#fff'};font-size:11px;font-weight:600;cursor:pointer;color:${mo===m?'#fff':'#111'}">${m}</button>`).join('')}</div>`;
  }

  h+=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;border-top:3px solid #15803d">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">In</div>
      <div style="font-size:18px;font-weight:800;color:#15803d">${_fmtPKR(totalIn)}</div>
      ${_delta(totalIn,prevIn,false)}
    </div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;border-top:3px solid #dc2626">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Out</div>
      <div style="font-size:18px;font-weight:800;color:#dc2626">${_fmtPKR(totalOut)}</div>
      ${_delta(totalOut,prevOut,true)}
    </div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;border-top:3px solid ${net>=0?'#15803d':'#dc2626'}">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Net</div>
      <div style="font-size:18px;font-weight:800;color:${net>=0?'#15803d':'#dc2626'}">${net>=0?'+':''}${_fmtPKR(net)}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px">${expenses.length} entries</div>
    </div>
  </div>`;

  if(!expenses.length){h+=`<div class="empty" style="padding:24px 0;text-align:center">No expense entries for ${mo}.</div>`;return h;}

  // Category breakdown
  h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px 8px;border-bottom:1px solid var(--border)">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">By Category</div>
      ${hasBudget?`<div style="font-size:10px;color:var(--muted)">Budget markers shown</div>`:''}
    </div>`;
  for(const [k,amt] of catSorted){
    const cat=k==='__none__'?{label:'Uncategorized'}:(_cashGetCategory(k)||{label:k});
    const accent=k==='__none__'?'#6b7280':_catAccent(k);
    const budget=budgetOf(k);
    const shareW=totalOut?Math.min(Math.round(amt/totalOut*100),100):0;
    const usedPct=budget>0?Math.round(amt/budget*100):null;
    const barColor=usedPct!=null?(usedPct>100?'#dc2626':usedPct>80?'#b45309':accent):accent;
    h+=`<div style="padding:10px 14px;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <span style="width:9px;height:9px;border-radius:50%;background:${accent};flex-shrink:0"></span>
        <span style="flex:1;font-size:13px;font-weight:600">${_scEsc(cat.label)}</span>
        <span style="font-size:13px;font-weight:800">${_fmtPKR(amt)}</span>
        ${usedPct!=null?`<span style="font-size:10px;color:${barColor};font-weight:700;min-width:34px;text-align:right">${usedPct}%</span>`:`<span style="font-size:10px;color:var(--muted);min-width:34px;text-align:right">${totalOut?Math.round(amt/totalOut*100):0}%</span>`}
      </div>
      <div style="height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;position:relative">
        <div style="height:100%;width:${shareW}%;background:${barColor};border-radius:3px"></div>
        ${budget>0?`<div style="position:absolute;top:-1px;bottom:-1px;left:${Math.min(100,Math.round(budget/totalOut*100))}%;width:2px;background:#111;opacity:.45;border-radius:1px" title="Budget"></div>`:''}
      </div>
      ${usedPct!=null&&usedPct>100?`<div style="font-size:10px;color:#dc2626;font-weight:600;margin-top:3px">⚠ Over budget by ${_fmtPKR(amt-budget)}</div>`:''}
    </div>`;
  }
  h+=`<div style="display:flex;justify-content:space-between;padding:10px 14px;background:#fafafa">
    <span style="font-size:12px;color:var(--muted)">${catSorted.length} categories</span>
    <span style="font-size:13px;font-weight:800">${_fmtPKR(totalOut)} total out</span>
  </div></div>`;

  // By vendor
  if(vendorSorted.length){
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="padding:12px 14px 8px;border-bottom:1px solid var(--border)"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">By Vendor</div></div>`;
    for(const [k,amt] of vendorSorted){
      const v=_cashGetVendor(k);const pct=totalOut>0?Math.round(amt/totalOut*100):0;
      h+=`<div style="padding:10px 14px;border-bottom:1px solid #f5f5f5">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
          <span style="font-size:13px;font-weight:600">${_scEsc(v?v.name:k)}</span>
          <span style="font-size:13px;font-weight:800">${_fmtPKR(amt)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:5px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#111;border-radius:3px"></div></div>
          <span style="font-size:10px;color:var(--muted)">${pct}%</span>
        </div>
      </div>`;
    }
    h+=`</div>`;
  }

  // Weekly
  if(weekEntries.length>1){
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="padding:12px 14px 8px;border-bottom:1px solid var(--border)"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Weekly (Mon–Sun)</div></div>
      <div style="padding:10px 14px">`;
    for(const [wk,amt] of weekEntries){
      const d=new Date(wk+'T00:00:00');const lbl=isNaN(d)?wk:d.toLocaleDateString('en-PK',{day:'numeric',month:'short'});
      const barW=Math.round(amt/weekMax*100);
      h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="font-size:10px;color:var(--muted);width:52px;flex-shrink:0">wk ${lbl}</div>
        <div style="flex:1;height:12px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:${barW}%;background:#111;border-radius:3px"></div></div>
        <div style="font-size:11px;font-weight:700;width:72px;text-align:right;flex-shrink:0">${_fmtPKR(amt)}</div>
      </div>`;
    }
    h+=`</div></div>`;
  }

  // Daily spend
  if(dayEntries.length){
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="padding:12px 14px 8px;border-bottom:1px solid var(--border)"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Daily Cash Flow — ${mo}</div></div>
      <div style="padding:10px 14px">`;
    for(const [d,amt] of dayEntries){
      const day=parseInt(d.slice(8));const barW=Math.round(amt/dayMax*100);
      h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <div style="font-size:10px;color:var(--muted);width:18px;text-align:right;flex-shrink:0">${day}</div>
        <div style="flex:1;height:12px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:${barW}%;background:#111;border-radius:3px"></div></div>
        <div style="font-size:11px;font-weight:700;width:72px;text-align:right;flex-shrink:0">${_fmtPKR(amt)}</div>
      </div>`;
    }
    h+=`</div></div>`;
  }

  // By person
  if(userSorted.length){
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="padding:12px 14px 8px;border-bottom:1px solid var(--border)"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">By Person</div></div>`;
    for(const [u,amt] of userSorted){
      const pct=totalOut>0?Math.round(amt/totalOut*100):0;
      h+=`<div style="padding:10px 14px;border-bottom:1px solid #f5f5f5">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
          <span style="font-size:13px;font-weight:600">${_scEsc(u)}</span>
          <span style="font-size:13px;font-weight:800">${_fmtPKR(amt)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:5px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#111;border-radius:3px"></div></div>
          <span style="font-size:10px;color:var(--muted);white-space:nowrap">${userCt[u]||0} entries · ${pct}%</span>
        </div>
      </div>`;
    }
    h+=`</div>`;
  }

  return h;
}

// ── Action Bar ──
function _cashActionBar(){
  return `<div id="cash-action-bar" class="cash-action-bar">
    <button onclick="window.cashSheetExpense()" style="flex:3;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;letter-spacing:-.01em">Record Expense</button>
    <button onclick="window.cashSheetTopup()" style="flex:1;height:48px;background:#fff;color:#15803d;border:1.5px solid #15803d;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer">+ In</button>
    <button onclick="window.cashSheetIssue()" style="flex:1;height:48px;background:#fff;color:#111;border:1.5px solid var(--border);border-radius:12px;font-size:11px;font-weight:700;cursor:pointer">→ Issue</button>
  </div>`;
}

// ── Tab/nav handlers ──
window._cashSetTab=function(tab){_cashTab=tab;_cashRecentPage=0;_cashReload();};
window._cashPageNav=function(n){_cashRecentPage=n;_cashReload();const m=document.getElementById('cash-tab-body');if(m)m.scrollIntoView({behavior:'smooth',block:'start'});};
window._cashSetPeriod=function(m){_cashInsightsPeriod=m;_cashReload();};
window._cashRowAction=function(id){
  const r=allCashLedger.find(x=>x._id===id);if(!r)return;
  if(r.kind==='expense'||r.kind==='credit_purchase')window.cashSheetExpense(id);
  else if(r.kind==='topup')window.cashSheetTopup(id);
  else if(r.kind==='vendor_payment'&&r.vendorId)window.cashVendorLedger(r.vendorId);
  else showToast('Re-open this type from the action bar.');
};

/* ════════════════════════ EXPENSE SHEET ════════════════════════ */
window.cashSheetExpense=function(cloneId){
  if(!allCashCategories.length){
    _cashOpenSheet('No categories yet',`
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:16px">You need at least one expense category before recording. Each category is linked to a vendor for clean accounting.</div>
      <button class="btn-primary" style="width:100%;background:#111;height:46px" onclick="window.cashSheetCategory()">+ Create first category</button>`);
    return;
  }
  const clone=cloneId?allCashLedger.find(r=>r._id===cloneId):null;
  const defAcc=clone?.account||localStorage.getItem('groovy_cash_last_acc')||'cash';
  let defCat=clone?.category||localStorage.getItem('groovy_cash_last_cat')||'';
  if(!_cashGetCategory(defCat)) defCat=allCashCategories[0]._id||allCashCategories[0].key; // drop stale/deleted id
  const defCatDoc=_cashGetCategory(defCat);
  const defVendor=clone?.vendorId||defCatDoc?.vendorId||'walkin';
  _cashExpenseCat=defCat;_cashExpenseAcc=defAcc;_cashExpenseVendor=defVendor;_cashExpenseMode=clone?.kind==='credit_purchase'?'credit':'paid';
  delete window._cashPhoto['exp-bill'];

  const catChips=[...allCashCategories].sort((a,b)=>(a.label||'').localeCompare(b.label||'')).map(c=>{
    const k=c._id||c.key;const on=defCat===k;const ac=_catAccent(k);
    return`<button id="cc-${k}" onclick="window._cashPickCat('${k}')" style="padding:7px 12px;border-radius:20px;border:2px solid ${on?'#111':'#e5e7eb'};background:${on?'#111':'#fff'};font-size:12px;cursor:pointer;font-weight:600;color:${on?'#fff':'#111'};display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${ac}"></span>${_scEsc(c.label)}</button>`;
  }).join('');
  const accChips=_cashAllAccounts().map(a=>{const k=a._id||a.key;const on=defAcc===k;return`<button id="ca-${k}" onclick="window._cashPickAcc('${k}')" style="padding:7px 14px;border-radius:20px;border:2px solid ${on?'#111':'#e5e7eb'};background:${on?'#111':'#fff'};font-size:12px;cursor:pointer;font-weight:600;color:${on?'#fff':'#111'}">${_scEsc(a.label)}</button>`;}).join('');
  const qAmts=[100,500,1000,2000,5000].map(v=>`<button onclick="window._cashQAmt(${v})" style="flex:1;padding:8px 0;border:1px solid var(--border);border-radius:8px;background:#f9fafb;font-size:12px;font-weight:700;cursor:pointer">+${v>=1000?v/1000+'k':v}</button>`).join('');

  _cashOpenSheet('Record Expense',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Category</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${catChips}</div>

    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Vendor</div>
    <select id="exp-vendor" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;box-sizing:border-box">${_cashVendorOptions(defVendor)}</select>

    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Amount (₨)</div>
    <input id="cash-amt" type="number" inputmode="numeric" min="1" placeholder="0" value="${clone?.amount||''}" oninput="window._cashPrev()"
      style="width:100%;font-size:28px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:8px;box-sizing:border-box">
    <div style="display:flex;gap:6px;margin-bottom:16px">${qAmts}</div>

    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Payment</div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button id="mode-paid" onclick="window._cashPickMode('paid')" style="flex:1;padding:11px;border-radius:10px;border:2px solid ${_cashExpenseMode==='paid'?'#111':'#e5e7eb'};background:${_cashExpenseMode==='paid'?'#111':'#fff'};color:${_cashExpenseMode==='paid'?'#fff':'#111'};font-size:13px;font-weight:700;cursor:pointer">Paid now</button>
      <button id="mode-credit" onclick="window._cashPickMode('credit')" style="flex:1;padding:11px;border-radius:10px;border:2px solid ${_cashExpenseMode==='credit'?'#dc2626':'#e5e7eb'};background:${_cashExpenseMode==='credit'?'#dc2626':'#fff'};color:${_cashExpenseMode==='credit'?'#fff':'#111'};font-size:13px;font-weight:700;cursor:pointer">On credit</button>
    </div>

    <div id="exp-paid-block" style="display:${_cashExpenseMode==='paid'?'block':'none'}">
      <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">From Account</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${accChips}</div>
    </div>
    <div id="exp-credit-note" style="display:${_cashExpenseMode==='credit'?'block':'none'};background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:12px;color:#991b1b;line-height:1.5">Added to vendor payables. <strong>Bill photo required.</strong></div>

    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Note <span style="font-weight:400">(optional)</span></div>
    <input id="cash-note" type="text" placeholder="e.g. invoice #, what was bought" value="${_scEsc(clone?.note||'')}"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">

    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Bill photo <span id="bill-req" style="font-weight:400">${_cashExpenseMode==='credit'?'(required)':'(optional)'}</span></div>
    ${_cashPhotoField('exp-bill','exp-bill-status','Attach bill / receipt')}

    <div id="cash-prev" style="font-size:12px;color:var(--muted);text-align:center;margin:10px 0;min-height:16px"></div>
    <button id="cash-submit" onclick="window._cashDoExpense()" style="width:100%;height:50px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">Record <span id="cash-sub-amt">—</span></button>
    <button onclick="window.cashSheetTransfer(true)" style="width:100%;height:38px;background:transparent;color:var(--muted);border:1.5px solid var(--border);border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;margin-top:8px">↕ Transfer between accounts</button>
  `);
  window._cashPrev();
};
function _cashVendorOptions(sel){
  const real=allCashVendors.filter(v=>(v._id||v.id)!=='walkin').sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const walk=_cashGetVendor('walkin');
  let o=`<option value="walkin"${sel==='walkin'?' selected':''}>${_scEsc(walk?.name||'Walk-in / Direct')}</option>`;
  o+=real.map(v=>`<option value="${v._id||v.id}"${sel===(v._id||v.id)?' selected':''}>${_scEsc(v.name)}</option>`).join('');
  return o;
}
window._cashPickCat=function(key){
  _cashExpenseCat=key;localStorage.setItem('groovy_cash_last_cat',key);
  document.querySelectorAll('[id^="cc-"]').forEach(b=>{const isMe=b.id==='cc-'+key;b.style.borderColor=isMe?'#111':'#e5e7eb';b.style.background=isMe?'#111':'#fff';b.style.color=isMe?'#fff':'#111';});
  // auto-switch vendor to the category's linked vendor
  const cat=_cashGetCategory(key);
  if(cat&&cat.vendorId){const sel=document.getElementById('exp-vendor');if(sel){sel.value=cat.vendorId;_cashExpenseVendor=cat.vendorId;}}
  window._cashPrev();
};
window._cashPickAcc=function(key){
  _cashExpenseAcc=key;localStorage.setItem('groovy_cash_last_acc',key);
  document.querySelectorAll('[id^="ca-"]').forEach(b=>{const isMe=b.id==='ca-'+key;b.style.borderColor=isMe?'#111':'#e5e7eb';b.style.background=isMe?'#111':'#fff';b.style.color=isMe?'#fff':'#111';});
  window._cashPrev();
};
window._cashPickMode=function(mode){
  _cashExpenseMode=mode;
  const paid=document.getElementById('mode-paid'),cr=document.getElementById('mode-credit');
  if(paid){paid.style.borderColor=mode==='paid'?'#111':'#e5e7eb';paid.style.background=mode==='paid'?'#111':'#fff';paid.style.color=mode==='paid'?'#fff':'#111';}
  if(cr){cr.style.borderColor=mode==='credit'?'#dc2626':'#e5e7eb';cr.style.background=mode==='credit'?'#dc2626':'#fff';cr.style.color=mode==='credit'?'#fff':'#111';}
  const pb=document.getElementById('exp-paid-block');if(pb)pb.style.display=mode==='paid'?'block':'none';
  const cn=document.getElementById('exp-credit-note');if(cn)cn.style.display=mode==='credit'?'block':'none';
  const req=document.getElementById('bill-req');if(req)req.textContent=mode==='credit'?'(required)':'(optional)';
  window._cashPrev();
};
window._cashQAmt=function(v){const i=document.getElementById('cash-amt');if(i){i.value=(parseInt(i.value)||0)+v;window._cashPrev();}};
window._cashPrev=function(){
  const amt=parseInt(document.getElementById('cash-amt')?.value)||0;
  const prev=document.getElementById('cash-prev');
  const sub=document.getElementById('cash-sub-amt');
  if(prev){
    if(amt>0&&_cashExpenseMode==='paid'){const acc=_cashGetAccount(_cashExpenseAcc);prev.textContent=`Will deduct ${_fmtPKR(amt)} from ${acc?.label||''}`;}
    else if(amt>0&&_cashExpenseMode==='credit'){const v=_cashGetVendor(_cashExpenseVendor);prev.textContent=`Will add ${_fmtPKR(amt)} to ${v?.name||'vendor'} payables`;}
    else prev.textContent='';
  }
  if(sub) sub.textContent=amt>0?_fmtPKR(amt):'—';
};
window._cashDoExpense=async function(){
  const amt=parseInt(document.getElementById('cash-amt')?.value)||0;
  const cat=_cashExpenseCat;
  const vendorId=document.getElementById('exp-vendor')?.value||_cashExpenseVendor||'walkin';
  const accKey=_cashExpenseAcc;
  const note=(document.getElementById('cash-note')?.value||'').trim();
  const mode=_cashExpenseMode;
  const billPhoto=window._cashPhoto['exp-bill']||null;
  if(!amt||amt<=0){showToast('Enter an amount.',true);return;}
  if(!_cashGetCategory(cat)){showToast('Pick a valid category.',true);return;}
  if(mode==='credit'){
    if(vendorId==='walkin'){showToast('Credit purchases need a real vendor (not walk-in).',true);return;}
    if(!billPhoto){showToast('Bill photo is required for credit purchases.',true);return;}
  }
  const btn=document.getElementById('cash-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const mo=_cashCurrentMonth();
  const base={amount:amt,account:mode==='paid'?accKey:null,category:cat,vendorId,date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note,billPhoto};
  const row=await _cashPost({kind:mode==='credit'?'credit_purchase':'expense',...base});
  if(row){showToast(`${_fmtPKR(amt)} recorded ✓`);_cashCloseSheet();_cashReload();}
  else if(btn){btn.disabled=false;btn.textContent=`Record ${_fmtPKR(amt)}`;}
};

/* ════════════════════════ TOPUP SHEET ════════════════════════ */
window.cashSheetTopup=function(cloneId){
  const clone=cloneId?allCashLedger.find(r=>r._id===cloneId):null;
  const defAcc=clone?.account||'cash';
  _cashTopupAcc=defAcc;
  const accChips=_cashAllAccounts().map(a=>{const k=a._id||a.key;const on=defAcc===k;return`<button id="ta-${k}" onclick="window._cashPickTopupAcc('${k}')" style="padding:8px 16px;border-radius:20px;border:2px solid ${on?'#111':'#e5e7eb'};background:${on?'#111':'#fff'};font-size:13px;cursor:pointer;font-weight:600;color:${on?'#fff':'#111'}">${_scEsc(a.label)}</button>`;}).join('');
  const qAmts=[1000,2000,5000,10000,20000].map(v=>`<button onclick="window._cashTQAmt(${v})" style="flex:1;padding:8px 0;border:1px solid var(--border);border-radius:8px;background:#f9fafb;font-size:12px;font-weight:700;cursor:pointer">+${v>=1000?v/1000+'k':v}</button>`).join('');
  _cashOpenSheet('Money In',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Deposit Into</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">${accChips}</div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Amount (₨)</div>
    <input id="topup-amt" type="number" inputmode="numeric" min="1" placeholder="0" value="${clone?.amount||''}"
      style="width:100%;font-size:28px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:8px;box-sizing:border-box" oninput="window._cashTPrev()">
    <div style="display:flex;gap:6px;margin-bottom:16px">${qAmts}</div>
    <input id="topup-note" type="text" placeholder="Source / note (e.g. Afnan — MCB transfer)" value="${_scEsc(clone?.note||'')}"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:10px">
    <div id="topup-prev" style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:10px;min-height:16px"></div>
    <button id="topup-submit" onclick="window._cashDoTopup()" style="width:100%;height:50px;background:#15803d;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">+ Add Money In</button>
  `);
  window._cashTPrev();
};
window._cashPickTopupAcc=function(key){
  _cashTopupAcc=key;
  document.querySelectorAll('[id^="ta-"]').forEach(b=>{const isMe=b.id==='ta-'+key;b.style.borderColor=isMe?'#111':'#e5e7eb';b.style.background=isMe?'#111':'#fff';b.style.color=isMe?'#fff':'#111';});
  window._cashTPrev();
};
window._cashTQAmt=function(v){const i=document.getElementById('topup-amt');if(i){i.value=(parseInt(i.value)||0)+v;window._cashTPrev();}};
window._cashTPrev=function(){
  const amt=parseInt(document.getElementById('topup-amt')?.value)||0;
  const acc=_cashGetAccount(_cashTopupAcc);
  const prev=document.getElementById('topup-prev');
  if(prev&&acc&&amt>0) prev.textContent=`Will add ${_fmtPKR(amt)} to ${acc.label}`;
  else if(prev) prev.textContent='';
};
window._cashDoTopup=async function(){
  const amt=parseInt(document.getElementById('topup-amt')?.value)||0;
  const note=(document.getElementById('topup-note')?.value||'').trim();
  if(!amt||amt<=0){showToast('Enter an amount.',true);return;}
  const btn=document.getElementById('topup-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const mo=_cashCurrentMonth();
  const row=await _cashPost({kind:'topup',amount:amt,account:_cashTopupAcc,category:null,vendorId:null,payee:session.name,date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note});
  if(row){showToast(`${_fmtPKR(amt)} added to ${_cashGetAccount(_cashTopupAcc)?.label} ✓`);_cashCloseSheet();_cashReload();}
  else if(btn){btn.disabled=false;btn.textContent='+ Add Money In';}
};

/* ════════════════════════ TRANSFER SHEET ════════════════════════ */
window.cashSheetTransfer=function(fromExpenseSheet){
  if(fromExpenseSheet) _cashCloseSheet();
  const opts=_cashAllAccounts().map(a=>`<option value="${a._id||a.key}">${_scEsc(a.label)}</option>`).join('');
  const qAmts=[1000,2000,5000,10000].map(v=>`<button onclick="window._cashXQAmt(${v})" style="flex:1;padding:8px 0;border:1px solid var(--border);border-radius:8px;background:#f9fafb;font-size:12px;font-weight:700;cursor:pointer">+${v>=1000?v/1000+'k':v}</button>`).join('');
  const show=()=>_cashOpenSheet('Transfer',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">From</div>
    <select id="xfer-from" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box">${opts}</select>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">To</div>
    <select id="xfer-to" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box">${opts}</select>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Amount (₨)</div>
    <input id="xfer-amt" type="number" inputmode="numeric" min="1" placeholder="0"
      style="width:100%;font-size:24px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:8px;box-sizing:border-box">
    <div style="display:flex;gap:6px;margin-bottom:12px">${qAmts}</div>
    <input id="xfer-note" type="text" placeholder="Reason / note"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <button id="xfer-submit" onclick="window._cashDoTransfer()" style="width:100%;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">↕ Transfer</button>
  `);
  if(fromExpenseSheet) setTimeout(show,160); else show();
};
window._cashXQAmt=function(v){const i=document.getElementById('xfer-amt');if(i)i.value=(parseInt(i.value)||0)+v;};
window._cashDoTransfer=async function(){
  const from=document.getElementById('xfer-from')?.value;
  const to=document.getElementById('xfer-to')?.value;
  const amt=parseInt(document.getElementById('xfer-amt')?.value)||0;
  const note=(document.getElementById('xfer-note')?.value||'').trim();
  if(!amt||amt<=0){showToast('Enter an amount.',true);return;}
  if(from===to){showToast('From and To must be different.',true);return;}
  const btn=document.getElementById('xfer-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const mo=_cashCurrentMonth();
  const row=await _cashPost({kind:'transfer',amount:amt,account:from,counterAccount:to,category:null,vendorId:null,payee:'internal',date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note});
  if(row){showToast(`${_fmtPKR(amt)} transferred ✓`);_cashCloseSheet();_cashReload();}
  else if(btn){btn.disabled=false;btn.textContent='↕ Transfer';}
};

/* ════════════════════════ ISSUE FLOAT SHEET ════════════════════════ */
window.cashSheetIssue=function(){
  const opts=_cashAllAccounts().map(a=>`<option value="${a._id||a.key}">${_scEsc(a.label)}</option>`).join('');
  const qAmts=[1000,2000,5000,10000].map(v=>`<button onclick="window._cashIQAmt(${v})" style="flex:1;padding:8px 0;border:1px solid var(--border);border-radius:8px;background:#f9fafb;font-size:12px;font-weight:700;cursor:pointer">+${v>=1000?v/1000+'k':v}</button>`).join('');
  _cashOpenSheet('Issue Cash to Runner',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Runner / Person</div>
    <input id="issue-payee" type="text" value="" placeholder="Name of person taking the cash"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">From Account</div>
    <select id="issue-acc" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box">${opts}</select>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Amount (₨)</div>
    <input id="issue-amt" type="number" inputmode="numeric" min="1" placeholder="0"
      style="width:100%;font-size:24px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:8px;box-sizing:border-box">
    <div style="display:flex;gap:6px;margin-bottom:12px">${qAmts}</div>
    <input id="issue-note" type="text" placeholder="Purpose (e.g. buying neck labels)"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <button id="issue-submit" onclick="window._cashDoIssue()" style="width:100%;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">→ Issue Cash</button>
  `);
};
window._cashIQAmt=function(v){const i=document.getElementById('issue-amt');if(i)i.value=(parseInt(i.value)||0)+v;};
window._cashDoIssue=async function(){
  const payee=(document.getElementById('issue-payee')?.value||'').trim();
  const accKey=document.getElementById('issue-acc')?.value||'cash';
  const amt=parseInt(document.getElementById('issue-amt')?.value)||0;
  const note=(document.getElementById('issue-note')?.value||'').trim();
  if(!payee){showToast('Enter the runner / person name.',true);return;}
  if(!amt||amt<=0){showToast('Enter an amount.',true);return;}
  const btn=document.getElementById('issue-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const mo=_cashCurrentMonth();
  const floatId=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  const row=await _cashPost({kind:'issue',amount:amt,account:accKey,category:null,vendorId:null,payee,date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note,floatId});
  if(!row){if(btn){btn.disabled=false;btn.textContent='→ Issue Cash';}return;}
  const floatDoc={payee,issued:amt,account:accKey,issuedTs:Date.now(),issuedBy:session.name,status:'open',goodsValue:null,changeReturned:null,variance:null,billPhoto:null,floatId,note};
  await fsSet('store_cash_floats',floatId,floatDoc).catch(()=>{});
  allCashFloats.unshift({...floatDoc,_id:floatId});
  showToast(`${_fmtPKR(amt)} issued to ${payee} ✓`);
  _cashCloseSheet();_cashReload();
};

/* ════════════════════════ SETTLE FLOAT ════════════════════════ */
window.cashSettleFloat=function(floatId){
  const f=allCashFloats.find(x=>x._id===floatId||x.floatId===floatId);
  if(!f){showToast('Float not found.',true);return;}
  delete window._cashPhoto['settle-bill'];
  const catOpts=allCashCategories.length
    ? allCashCategories.sort((a,b)=>(a.label||'').localeCompare(b.label||'')).map(c=>`<option value="${c._id||c.key}">${_scEsc(c.label)}</option>`).join('')
    : '';
  _cashOpenSheet('Settle Float',`
    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px;line-height:1.5">
      <strong>${_scEsc(f.payee)}</strong> was issued <strong>${_fmtPKR(f.issued)}</strong> from <strong>${_scEsc(_cashGetAccount(f.account)?.label||f.account)}</strong>
    </div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Bill photo <span style="font-weight:400">(required)</span></div>
    ${_cashPhotoField('settle-bill','settle-bill-status','Attach bill / receipt')}
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 6px">Goods Value (₨)</div>
    <input id="settle-goods" type="number" inputmode="numeric" min="0" placeholder="0" oninput="window._cashSettlePrev('${_scEsc(floatId)}')"
      style="width:100%;font-size:22px;font-weight:800;padding:10px;border:2px solid var(--border);border-radius:10px;margin-bottom:10px;box-sizing:border-box">
    ${catOpts?`<div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Goods Category</div>
    <select id="settle-cat" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;box-sizing:border-box">${catOpts}</select>`:`<div style="font-size:12px;color:#dc2626;margin-bottom:10px">No categories exist — create one first (Categories tab).</div>`}
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Change Returned (₨)</div>
    <input id="settle-change" type="number" inputmode="numeric" min="0" placeholder="0" oninput="window._cashSettlePrev('${_scEsc(floatId)}')"
      style="width:100%;font-size:22px;font-weight:800;padding:10px;border:2px solid var(--border);border-radius:10px;margin-bottom:8px;box-sizing:border-box">
    <div id="settle-prev" style="font-size:12px;text-align:center;margin-bottom:12px;min-height:16px;color:var(--muted)"></div>
    <button id="settle-submit" onclick="window._cashDoSettle('${_scEsc(floatId)}')" style="width:100%;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">Settle ✓</button>
  `);
};
window._cashSettlePrev=function(floatId){
  const f=allCashFloats.find(x=>x._id===floatId||x.floatId===floatId);if(!f)return;
  const g=parseInt(document.getElementById('settle-goods')?.value)||0;
  const c=parseInt(document.getElementById('settle-change')?.value)||0;
  const v=f.issued-g-c;
  const el=document.getElementById('settle-prev');if(!el)return;
  if(g===0&&c===0){el.textContent='';return;}
  if(v===0){el.innerHTML='<span style="color:#15803d;font-weight:700">Balances exactly ✓</span>';}
  else if(v>0){el.innerHTML=`<span style="color:#dc2626;font-weight:700">Short by ${_fmtPKR(v)}</span> — goods+change less than issued`;}
  else{el.innerHTML=`<span style="color:#b45309;font-weight:700">Over by ${_fmtPKR(-v)}</span> — goods+change exceed issued`;}
};
window._cashDoSettle=async function(floatId){
  const f=allCashFloats.find(x=>x._id===floatId||x.floatId===floatId);
  if(!f){showToast('Float not found.',true);return;}
  if(f.status!=='open'){showToast('This float is already settled.',true);_cashCloseSheet();_cashReload();return;}
  const goodsVal=parseInt(document.getElementById('settle-goods')?.value)||0;
  const changeRet=parseInt(document.getElementById('settle-change')?.value)||0;
  const cat=document.getElementById('settle-cat')?.value||(allCashCategories[0]&&(allCashCategories[0]._id||allCashCategories[0].key))||null;
  const billPhoto=window._cashPhoto['settle-bill']||null;
  if(!billPhoto){showToast('Bill photo is required to settle.',true);return;}
  if(goodsVal<=0&&changeRet<=0){showToast('Enter goods value and/or change.',true);return;}
  const catVendor=_cashGetCategory(cat)?.vendorId||'walkin';
  const btn=document.getElementById('settle-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const mo=_cashCurrentMonth();
  const fid=f.floatId||f._id||floatId;
  // The account was already deducted by the full 'issue' when cash was handed
  // out. So the goods expense here is account-neutral (account:null) — it only
  // categorises the spend for reporting. Only the returned change flows back in.
  let ok=true;
  if(goodsVal>0){
    const r=await _cashPost({kind:'expense',amount:goodsVal,account:null,category:cat,vendorId:catVendor,payee:f.payee,date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note:'Float settle'+(f.note?': '+f.note:''),floatId:fid,fromFloat:true,billPhoto});
    if(!r)ok=false;
  }
  if(ok&&changeRet>0){
    const r=await _cashPost({kind:'settle',amount:changeRet,account:f.account,category:null,vendorId:null,payee:f.payee,date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note:'Change returned',floatId:fid});
    if(!r)ok=false;
  }
  if(!ok){showToast('Save failed — please try again.',true);if(btn){btn.disabled=false;btn.textContent='Settle ✓';}return;}
  const variance=f.issued-goodsVal-changeRet;
  const updated={...f,status:'settled',goodsValue:goodsVal,changeReturned:changeRet,variance,billPhoto,settledTs:Date.now(),settledBy:session.name};
  const fKey=f._id||fid;
  await fsSet('store_cash_floats',fKey,updated).catch(()=>{});
  const idx=allCashFloats.findIndex(x=>x._id===fKey||x.floatId===fid);
  if(idx>=0) allCashFloats[idx]=updated;
  showToast(variance!==0?`Settled — variance ${_fmtPKR(Math.abs(variance))}`:'Float settled ✓');
  _cashCloseSheet();_cashReload();
};

/* ════════════════════════ VENDORS CRUD ════════════════════════ */
window.cashSheetVendor=function(vendorId){
  const v=vendorId?_cashGetVendor(vendorId):null;
  if(v&&(v._id||v.id)==='walkin'){showToast('The walk-in vendor cannot be edited.',true);return;}
  const types=(v?.productTypes||[]).join(', ');
  _cashOpenSheet(v?'Edit Vendor':'New Vendor',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Business Name *</div>
    <input id="vn-name" type="text" value="${_scEsc(v?.name||'')}" placeholder="e.g. Pak Gas Agency"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Contact Number</div>
    <input id="vn-phone" type="tel" inputmode="tel" value="${_scEsc(v?.phone||'')}" placeholder="03xx-xxxxxxx"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Address / Area</div>
    <input id="vn-address" type="text" value="${_scEsc(v?.address||'')}" placeholder="e.g. Shershah, Karachi"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Product Types <span style="font-weight:400">(comma separated)</span></div>
    <input id="vn-types" type="text" value="${_scEsc(types)}" placeholder="e.g. Gas, Cylinders"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Credit Terms</div>
    <input id="vn-terms" type="text" value="${_scEsc(v?.creditTerms||'')}" placeholder="e.g. Net 30, cash only"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Opening Outstanding (₨) <span style="font-weight:400">${v?'':'(if they already owe)'}</span></div>
    <input id="vn-opening" type="number" inputmode="numeric" min="0" value="${v?.openingOutstanding||''}" placeholder="0" ${v?'disabled style="background:#f5f5f5;'+'':'style="'}width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:14px">
    <button id="vn-submit" onclick="window._cashDoVendor('${vendorId||''}')" style="width:100%;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">${v?'Save Changes':'Create Vendor'}</button>
    ${v&&_canAdminCash()?`<button onclick="window.cashDeleteVendor('${vendorId}')" style="width:100%;height:40px;background:transparent;color:#dc2626;border:1.5px solid #fca5a5;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;margin-top:8px">Delete vendor</button>`:''}
  `);
};
window._cashDoVendor=async function(vendorId){
  const name=(document.getElementById('vn-name')?.value||'').trim();
  if(!name){showToast('Business name is required.',true);return;}
  const phone=(document.getElementById('vn-phone')?.value||'').trim();
  const address=(document.getElementById('vn-address')?.value||'').trim();
  const productTypes=(document.getElementById('vn-types')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
  const creditTerms=(document.getElementById('vn-terms')?.value||'').trim();
  const opening=parseInt(document.getElementById('vn-opening')?.value)||0;
  const btn=document.getElementById('vn-submit');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  if(vendorId){
    const v=_cashGetVendor(vendorId);
    const upd={...v,name,phone,address,productTypes,creditTerms,updatedAt:Date.now()};
    await fsSet('store_cash_vendors',vendorId,upd).catch(()=>{});
    const i=allCashVendors.findIndex(x=>(x._id||x.id)===vendorId);if(i>=0)allCashVendors[i]={...upd,_id:vendorId};
    showToast('Vendor updated ✓');
  }else{
    const doc={name,phone,address,productTypes,creditTerms,openingOutstanding:opening,builtin:false,createdAt:Date.now(),createdBy:session.u||session.name};
    const id=await fsAdd('store_cash_vendors',doc).catch(()=>null);
    if(!id){showToast('Save failed.',true);if(btn){btn.disabled=false;btn.textContent='Create Vendor';}return;}
    allCashVendors.push({...doc,_id:id});
    showToast('Vendor created ✓');
  }
  _cashCloseSheet();_cashReload();
};
window.cashDeleteVendor=async function(vendorId){
  if((vendorId)==='walkin'){showToast('Cannot delete walk-in vendor.',true);return;}
  const used=allCashLedger.some(r=>r.vendorId===vendorId)||allCashCategories.some(c=>c.vendorId===vendorId);
  if(used){showToast('Vendor has linked records — cannot delete.',true);return;}
  if(!confirm('Delete this vendor permanently?'))return;
  await fsDelete('store_cash_vendors',vendorId).catch(()=>{});
  allCashVendors=allCashVendors.filter(v=>(v._id||v.id)!==vendorId);
  showToast('Vendor deleted ✓');_cashCloseSheet();_cashReload();
};

/* ════════════════════════ PAY VENDOR ════════════════════════ */
window.cashSheetPayVendor=function(vendorId){
  const v=_cashGetVendor(vendorId);if(!v){showToast('Vendor not found.',true);return;}
  const out=_cashVendorOutstanding(vendorId);
  delete window._cashPhoto['pay-proof'];
  const opts=_cashAllAccounts().map(a=>`<option value="${a._id||a.key}" data-online="${a.online?1:0}">${_scEsc(a.label)}${a.online?' (online)':''}</option>`).join('');
  _cashOpenSheet('Pay '+(v.name||'Vendor'),`
    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px">
      Outstanding to <strong>${_scEsc(v.name)}</strong>: <strong style="color:#dc2626">${_fmtPKR(out)}</strong>
    </div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Amount (₨)</div>
    <input id="pay-amt" type="number" inputmode="numeric" min="1" value="${out>0?out:''}" placeholder="0"
      style="width:100%;font-size:24px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:12px;box-sizing:border-box">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Pay From</div>
    <select id="pay-acc" onchange="window._cashPayAccChange()" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box">${opts}</select>
    <div id="pay-proof-wrap">
      <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Payment proof <span id="pay-proof-req" style="font-weight:400"></span></div>
      ${_cashPhotoField('pay-proof','pay-proof-status','Attach payment screenshot / receipt')}
    </div>
    <input id="pay-note" type="text" placeholder="Note (e.g. invoice paid)"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin:12px 0">
    <button id="pay-submit" onclick="window._cashDoPayVendor('${vendorId}')" style="width:100%;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">Pay Vendor</button>
  `);
  window._cashPayAccChange();
};
window._cashPayAccChange=function(){
  const sel=document.getElementById('pay-acc');if(!sel)return;
  const opt=sel.options[sel.selectedIndex];
  const online=opt&&opt.getAttribute('data-online')==='1';
  const req=document.getElementById('pay-proof-req');if(req)req.textContent=online?'(required for online transfer)':'(optional)';
};
window._cashDoPayVendor=async function(vendorId){
  const v=_cashGetVendor(vendorId);if(!v)return;
  const amt=parseInt(document.getElementById('pay-amt')?.value)||0;
  const accKey=document.getElementById('pay-acc')?.value;
  const note=(document.getElementById('pay-note')?.value||'').trim();
  const acc=_cashGetAccount(accKey);
  const proof=window._cashPhoto['pay-proof']||null;
  if(!amt||amt<=0){showToast('Enter an amount.',true);return;}
  if(acc?.online&&!proof){showToast('Payment proof is required for online transfers.',true);return;}
  const btn=document.getElementById('pay-submit');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const mo=_cashCurrentMonth();
  const row=await _cashPost({kind:'vendor_payment',amount:amt,account:accKey,category:null,vendorId,payee:v.name,date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note,proofPhoto:proof,method:acc?.online?'online':'cash'});
  if(row){showToast(`Paid ${_fmtPKR(amt)} to ${v.name} ✓`);_cashCloseSheet();_cashReload();}
  else if(btn){btn.disabled=false;btn.textContent='Pay Vendor';}
};

window.cashVendorLedger=function(vendorId){
  const v=_cashGetVendor(vendorId);if(!v){showToast('Vendor not found.',true);return;}
  const rows=allCashLedger.filter(r=>r.vendorId===vendorId).slice(0,40);
  const out=_cashVendorOutstanding(vendorId);
  let body=rows.length?rows.map(r=>{
    const isPay=r.kind==='vendor_payment';
    const col=isPay?'#15803d':'#dc2626';const sign=isPay?'−':'+';
    const lbl=isPay?'Payment':(r.kind==='credit_purchase'?'Credit purchase':'Purchase');
    const proof=(r.billPhoto||r.proofPhoto)?` <a href="${r.billPhoto||r.proofPhoto}" target="_blank" style="text-decoration:none">📎</a>`:'';
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #f5f5f5;font-size:13px">
      <div><div style="font-weight:600">${lbl}${proof}</div><div style="font-size:11px;color:var(--muted)">${_scEsc(r.date||'')} · ${_scEsc(r.note||'')}</div></div>
      <div style="font-weight:800;color:${col}">${sign}${_fmtPKR(r.amount)}</div>
    </div>`;
  }).join(''):`<div style="font-size:13px;color:var(--muted);padding:16px 0;text-align:center">No transactions yet.</div>`;
  _cashOpenSheet(v.name,`
    <div style="background:#fafafa;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;color:var(--muted)">Outstanding</span>
      <span style="font-size:16px;font-weight:800;color:${out>0?'#dc2626':'#15803d'}">${_fmtPKR(out)}</span>
    </div>
    ${out>0&&_canEntryCash()?`<button class="btn-primary" style="width:100%;background:#111;height:44px;margin-bottom:12px" onclick="window.cashSheetPayVendor('${vendorId}')">Pay Vendor</button>`:''}
    ${body}
  `);
};

/* ════════════════════════ CATEGORIES CRUD ════════════════════════ */
window.cashSheetCategory=function(catId){
  const c=catId?_cashGetCategory(catId):null;
  _cashCatVendorMode='existing';
  const vendorSel=c?.vendorId||'';
  _cashOpenSheet(c?'Edit Category':'New Category',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Category Name *</div>
    <input id="cat-label" type="text" value="${_scEsc(c?.label||'')}" placeholder="e.g. Gas Cylinder"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:14px">

    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Linked Vendor *</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button id="cvm-existing" onclick="window._cashCatVendorMode('existing')" style="flex:1;padding:9px;border-radius:9px;border:2px solid #111;background:#111;color:#fff;font-size:12px;font-weight:700;cursor:pointer">Existing vendor</button>
      <button id="cvm-new" onclick="window._cashCatVendorMode('new')" style="flex:1;padding:9px;border-radius:9px;border:2px solid #e5e7eb;background:#fff;color:#111;font-size:12px;font-weight:700;cursor:pointer">+ New vendor</button>
    </div>
    <div id="cv-existing-block">
      <select id="cat-vendor" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:14px;box-sizing:border-box">${_cashVendorOptions(vendorSel||'walkin')}</select>
    </div>
    <div id="cv-new-block" style="display:none;background:#fafafa;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px">
      <input id="cnv-name" type="text" placeholder="Vendor name *" style="width:100%;padding:9px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:8px">
      <input id="cnv-phone" type="tel" placeholder="Contact number" style="width:100%;padding:9px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:8px">
      <input id="cnv-address" type="text" placeholder="Address / area" style="width:100%;padding:9px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:8px">
      <input id="cnv-types" type="text" placeholder="Product types (comma separated)" style="width:100%;padding:9px;border:1px solid var(--border);border-radius:8px;font-size:13px;box-sizing:border-box">
    </div>

    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Monthly Budget (₨) <span style="font-weight:400">(optional)</span></div>
    <input id="cat-budget" type="number" inputmode="numeric" min="0" value="${c?.monthlyBudget||''}" placeholder="0"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:14px">

    <button id="cat-submit" onclick="window._cashDoCategory('${catId||''}')" style="width:100%;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">${c?'Save Changes':'Create Category'}</button>
    ${c&&_canAdminCash()?`<button onclick="window.cashDeleteCategory('${catId}')" style="width:100%;height:40px;background:transparent;color:#dc2626;border:1.5px solid #fca5a5;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;margin-top:8px">Delete category</button>`:''}
  `);
};
window._cashCatVendorMode=function(mode){
  _cashCatVendorMode=mode;
  const ex=document.getElementById('cvm-existing'),nw=document.getElementById('cvm-new');
  if(ex){ex.style.borderColor=mode==='existing'?'#111':'#e5e7eb';ex.style.background=mode==='existing'?'#111':'#fff';ex.style.color=mode==='existing'?'#fff':'#111';}
  if(nw){nw.style.borderColor=mode==='new'?'#111':'#e5e7eb';nw.style.background=mode==='new'?'#111':'#fff';nw.style.color=mode==='new'?'#fff':'#111';}
  const eb=document.getElementById('cv-existing-block'),nb=document.getElementById('cv-new-block');
  if(eb)eb.style.display=mode==='existing'?'block':'none';
  if(nb)nb.style.display=mode==='new'?'block':'none';
};
window._cashDoCategory=async function(catId){
  const restore=catId?'Save Changes':'Create Category';
  const fail=(msg,createdVendorId)=>{
    // roll back a just-created inline vendor so a retry can't duplicate it
    if(createdVendorId){fsDelete('store_cash_vendors',createdVendorId).catch(()=>{});allCashVendors=allCashVendors.filter(v=>(v._id||v.id)!==createdVendorId);}
    showToast(msg,true);const b=document.getElementById('cat-submit');if(b){b.disabled=false;b.textContent=restore;}
  };
  const label=(document.getElementById('cat-label')?.value||'').trim();
  if(!label){showToast('Category name is required.',true);return;}
  const budget=parseInt(document.getElementById('cat-budget')?.value)||0;
  const btn=document.getElementById('cat-submit');if(btn){btn.disabled=true;btn.textContent='Saving…';}

  let vendorId,createdVendorId=null;
  if(_cashCatVendorMode==='new'){
    const vn=(document.getElementById('cnv-name')?.value||'').trim();
    if(!vn){fail('Enter the new vendor name.');return;}
    const vdoc={name:vn,phone:(document.getElementById('cnv-phone')?.value||'').trim(),address:(document.getElementById('cnv-address')?.value||'').trim(),productTypes:(document.getElementById('cnv-types')?.value||'').split(',').map(s=>s.trim()).filter(Boolean),creditTerms:'',openingOutstanding:0,builtin:false,createdAt:Date.now(),createdBy:session.u||session.name};
    vendorId=await fsAdd('store_cash_vendors',vdoc).catch(()=>null);
    if(!vendorId){fail('Vendor save failed.');return;}
    allCashVendors.push({...vdoc,_id:vendorId});
    createdVendorId=vendorId;
  }else{
    vendorId=document.getElementById('cat-vendor')?.value||'walkin';
  }

  if(catId){
    const c=_cashGetCategory(catId);
    const upd={...c,label,vendorId,monthlyBudget:budget,updatedAt:Date.now()};
    const okId=await fsSet('store_cash_categories',catId,upd).then(()=>true).catch(()=>false);
    if(!okId){fail('Save failed.',createdVendorId);return;}
    const i=allCashCategories.findIndex(x=>(x._id||x.key)===catId);if(i>=0)allCashCategories[i]={...upd,_id:catId};
    showToast('Category updated ✓');
  }else{
    const doc={label,vendorId,monthlyBudget:budget,createdAt:Date.now(),createdBy:session.u||session.name};
    const id=await fsAdd('store_cash_categories',doc).catch(()=>null);
    if(!id){fail('Save failed.',createdVendorId);return;}
    allCashCategories.push({...doc,_id:id});
    showToast('Category created ✓');
  }
  _cashCloseSheet();_cashReload();
};
window.cashDeleteCategory=async function(catId){
  const used=allCashLedger.some(r=>r.category===catId);
  if(used){showToast('Category has expenses — cannot delete.',true);return;}
  if(!confirm('Delete this category permanently?'))return;
  await fsDelete('store_cash_categories',catId).catch(()=>{});
  allCashCategories=allCashCategories.filter(c=>(c._id||c.key)!==catId);
  showToast('Category deleted ✓');_cashCloseSheet();_cashReload();
};

/* ════════════════════════ COUNT WALLET ════════════════════════ */
window.cashCountWallet=function(key){
  const acc=_cashGetAccount(key);
  const bal=allCashAccounts.find(a=>(a._id||a.key)===key)?.balance||0;
  _cashOpenSheet(`Count ${acc?.label||key}`,`
    <div style="background:#fafafa;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px">
      Book balance: <strong>${_fmtPKR(bal)}</strong>
    </div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Actual Physical Count (₨)</div>
    <input id="count-amt" type="number" inputmode="numeric" min="0" placeholder="0"
      style="width:100%;font-size:24px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:12px;box-sizing:border-box">
    ${_canAdminCash()?`<input id="count-reason" type="text" placeholder="Reason (required if posting adjustment)"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <button id="count-submit" onclick="window._cashDoCount('${key}')" style="width:100%;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">Record Count &amp; Post Adjustment if Needed</button>`
    :`<button id="count-submit" onclick="window._cashDoCount('${key}')" style="width:100%;height:48px;background:#475569;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">Record Count</button>`}
  `);
};
window._cashDoCount=async function(key){
  const counted=parseInt(document.getElementById('count-amt')?.value);
  if(isNaN(counted)||counted<0){showToast('Enter a valid count.',true);return;}
  const reason=(document.getElementById('count-reason')?.value||'').trim();
  const bal=allCashAccounts.find(a=>(a._id||a.key)===key)?.balance||0;
  const diff=counted-bal;
  if(Math.abs(diff)>0&&_canAdminCash()&&!reason){showToast('Enter a reason for the adjustment.',true);return;}
  const btn=document.getElementById('count-submit');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const accDoc=allCashAccounts.find(a=>(a._id||a.key)===key);
  if(accDoc){accDoc.countedBalance=counted;accDoc.countedAt=Date.now();accDoc.countedBy=session.name;await _cashPersistAccount(accDoc);}
  if(diff!==0&&_canAdminCash()){
    const mo=_cashCurrentMonth();
    await _cashPost({kind:'adjust',amount:diff,account:key,category:null,vendorId:null,payee:'system',date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,adjustsReason:reason,note:'Physical count adj'});
    showToast(`Adjustment of ${_fmtPKR(Math.abs(diff))} posted ✓`);
  }else{
    showToast('Count recorded ✓');
  }
  _cashCloseSheet();_cashReload();
};

/* ════════════════════════ NEW / REQUEST ACCOUNT ════════════════════════ */
window.cashSheetNewAccount=function(){
  if(!_canAdminCash()){window.cashRequestAccount();return;}
  _cashOpenSheet('New Account',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Account Name *</div>
    <input id="na-label" type="text" placeholder="e.g. JazzCash" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;cursor:pointer"><input id="na-online" type="checkbox" checked style="width:15px;height:15px"> Online account (requires payment proof when paying vendors)</label>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Opening Balance (₨)</div>
    <input id="na-opening" type="number" inputmode="numeric" min="0" placeholder="0" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:14px">
    <button id="na-submit" onclick="window._cashDoNewAccount()" style="width:100%;height:48px;background:#111;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">Create Account</button>
  `);
};
window._cashDoNewAccount=async function(){
  const label=(document.getElementById('na-label')?.value||'').trim();
  if(!label){showToast('Enter an account name.',true);return;}
  const online=!!document.getElementById('na-online')?.checked;
  const opening=parseInt(document.getElementById('na-opening')?.value)||0;
  const key=safeId(label).toLowerCase()+'_'+Date.now().toString(36).slice(-4);
  const btn=document.getElementById('na-submit');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const doc={key,label,accent:'#475569',online,balance:opening,openingBalance:opening,countedBalance:null,builtin:false,createdAt:Date.now(),createdBy:session.u||session.name,lastUpdated:Date.now(),lastBy:session.name};
  await fsSet('store_cash_accounts',key,doc).catch(()=>{});
  allCashAccounts.push({...doc,_id:key});
  logActivity('store-cash',`Created account ${label}`).catch(()=>{});
  showToast('Account created ✓');_cashCloseSheet();_cashReload();
};
window.cashRequestAccount=function(){
  _cashOpenSheet('Request New Account',`
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:14px">New accounts are created by an owner. Send your request and an owner will set it up.</div>
    <input id="ra-label" type="text" placeholder="Account name needed (e.g. JazzCash)" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <button onclick="window._cashDoRequestAccount()" style="width:100%;height:46px;background:#111;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">Send Request to Owner</button>
  `);
};
window._cashDoRequestAccount=async function(){
  const label=(document.getElementById('ra-label')?.value||'').trim();
  if(!label){showToast('Enter the account name.',true);return;}
  await logActivity('store-cash',`⚑ Account request: "${label}" by ${session.name}`).catch(()=>{});
  showToast('Request sent to owner ✓');_cashCloseSheet();
};

/* ════════════════════════ RECOMPUTE ════════════════════════ */
window.cashRecomputeBalances=function(){
  _cashRecalcBalances();
  showToast('Balances recomputed from ledger ✓');
  _cashReload();
};

/* ════════════════════════ RESET ALL DATA (owner only) ════════════════════════ */
window.cashResetAllData=async function(){
  if(!_canAdminCash()){showToast('Owners only.',true);return;}
  const typed=prompt('This ERASES all cash entries, floats, categories and vendors, and zeroes every account balance.\n\nType RESET to confirm:');
  if(typed!=='RESET'){showToast('Reset cancelled.');return;}
  showToast('Resetting… please wait');
  try{
    // Pull the full set of docs (loaded lists may be capped) then delete each.
    const [ledger,floats,cats,vendors]=await Promise.all([
      fsList('store_cash_ledger',5000).catch(()=>allCashLedger),
      fsList('store_cash_floats',5000).catch(()=>allCashFloats),
      fsList('store_cash_categories',5000).catch(()=>allCashCategories),
      fsList('store_cash_vendors',5000).catch(()=>allCashVendors)
    ]);
    const del=(col,rows,keep)=>rows
      .map(r=>r._id||r.id||r.key)
      .filter(id=>id&&id!==keep)
      .map(id=>fsDelete(col,id).catch(()=>{}));
    await Promise.all([
      ...del('store_cash_ledger',ledger),
      ...del('store_cash_floats',floats),
      ...del('store_cash_categories',cats),
      ...del('store_cash_vendors',vendors,'walkin') // keep the built-in walk-in vendor
    ]);
    // zero every account balance (persist full doc so labels aren't wiped)
    for(const a of allCashAccounts){
      a.balance=0;a.openingBalance=0;a.countedBalance=null;a.countedAt=null;a.countedBy=null;
      a.lastUpdated=Date.now();a.lastBy='reset:'+(session.name||'');
      await _cashPersistAccount(a);
    }
    // reset in-memory state
    allCashLedger=[];allCashFloats=[];allCashCategories=[];
    allCashVendors=allCashVendors.filter(v=>(v._id||v.id)==='walkin');
    _cashTab='recent';_cashRecentPage=0;_cashInsightsPeriod='';
    logActivity('store-cash',`⚠ Cash data reset by ${session.name}`).catch(()=>{});
    showToast('All cash data reset ✓');
    _cashReload();
  }catch(e){
    console.error('[store-cash] reset error',e);
    showToast('Reset failed: '+e.message,true);
  }
};

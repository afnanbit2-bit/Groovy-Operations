/* Groovy Operations — store-cash.js
   Store Cash & Cost Ledger.
   Plain global classic script (no import/export). Loaded after js/store.js.
   Shares global scope with store.js REST helpers: fsAdd, fsSet, fsList,
   fsQueryOrdered, todayStr, safeId. Firebase via window-bridged globals. */

// ── State ──
let allCashLedger = [];
let allCashAccounts = [];
let allCashFloats = [];
let allCashCategories = [];
let cashDataLoaded = false;
let _cashBusy = false;
let _cashTab = 'recent';
let _cashInsightsPeriod = '';
let _cashRecentPage = 0;
let _cashExpenseCat = '';
let _cashExpenseAcc = 'cash';
let _cashTopupAcc = 'cash';

// ── Constants ──
const CASH_ACCOUNTS = [
  {key:'cash',      label:'Cash',       accent:'#16a34a'},
  {key:'sadapay',   label:'SadaPay',    accent:'#2563eb'},
  {key:'easypaisa', label:'EasyPaisa',  accent:'#7c3aed'},
  {key:'mcb',       label:'MCB Bank',   accent:'#0f172a'}
];

const CASH_CAT_SEED = [
  {key:'stock',        label:'Stock',          icon:'📦', accent:'#0284c7', bucket:'stock'},
  {key:'gas',          label:'Gas Cylinder',   icon:'🔥', accent:'#ea580c', bucket:'overhead'},
  {key:'water',        label:'Drinking Water', icon:'💧', accent:'#0891b2', bucket:'overhead'},
  {key:'transport',    label:'Transport',      icon:'🚗', accent:'#7c3aed', bucket:'overhead'},
  {key:'factory_cash', label:'Factory Cash',   icon:'🏭', accent:'#64748b', bucket:'passthrough'},
  {key:'service',      label:'Service/Repair', icon:'🔧', accent:'#b45309', bucket:'overhead'},
  {key:'maintenance',  label:'Maintenance',    icon:'⚙️', accent:'#0f766e', bucket:'overhead'},
  {key:'misc',         label:'Misc',           icon:'📋', accent:'#6b7280', bucket:'overhead'}
];

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
function _scEsc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _fmtPKR(n){
  const v = Math.abs(Math.round(n||0));
  return (n<0?'−':'')+'₨'+v.toLocaleString('en-PK');
}
function _cashCurrentMonth(){
  const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
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

// ── Data layer ──
async function loadStoreCashData(){
  if(cashDataLoaded) return;
  try{
    const [ledger,accounts,floats,cats]=await Promise.all([
      fsQueryOrdered('store_cash_ledger','ts',300).catch(()=>[]),
      fsList('store_cash_accounts',20).catch(()=>[]),
      fsList('store_cash_floats',50).catch(()=>[]),
      fsList('store_cash_categories',20).catch(()=>[])
    ]);
    allCashLedger=ledger;
    allCashAccounts=accounts;
    allCashFloats=floats;
    allCashCategories=cats;
    cashDataLoaded=true;
    await _cashSeedAccounts();
    await _cashSeedCategories();
    _cashRecalcBalances();
  }catch(e){ console.error('[store-cash] load error',e); }
}

async function _cashSeedAccounts(){
  const existing=new Set(allCashAccounts.map(a=>a._id||a.key));
  for(const acc of CASH_ACCOUNTS){
    if(!existing.has(acc.key)){
      const d={...acc,balance:0,openingBalance:0,countedBalance:null,countedAt:null,countedBy:null,lastUpdated:Date.now(),lastBy:session?.name||''};
      await fsSet('store_cash_accounts',acc.key,d).catch(()=>{});
      allCashAccounts.push({...d,_id:acc.key});
    }
  }
}

async function _cashSeedCategories(){
  const existing=new Set(allCashCategories.map(c=>c._id||c.key));
  for(const cat of CASH_CAT_SEED){
    if(!existing.has(cat.key)){
      const d={...cat,monthlyBudget:0,createdAt:Date.now()};
      await fsSet('store_cash_categories',cat.key,d).catch(()=>{});
      allCashCategories.push({...d,_id:cat.key});
    }
  }
}

function _cashGetAccount(key){
  return allCashAccounts.find(a=>(a._id||a.key)===key)||CASH_ACCOUNTS.find(a=>a.key===key)||null;
}
function _cashGetCategory(key){
  return allCashCategories.find(c=>(c._id||c.key)===key)||CASH_CAT_SEED.find(c=>c.key===key)||null;
}

// ── Write core ──
async function _cashPost(entry){
  if(_cashBusy){showToast('Please wait…',true);return null;}
  _cashBusy=true;
  try{
    const id=await fsAdd('store_cash_ledger',entry);
    const row={...entry,_id:id};
    allCashLedger.unshift(row);
    // Balance delta
    if(entry.kind==='topup')                              _cashApplyDelta(entry.account,+entry.amount);
    else if(entry.kind==='expense'||entry.kind==='issue') _cashApplyDelta(entry.account,-entry.amount);
    else if(entry.kind==='transfer'){                     _cashApplyDelta(entry.account,-entry.amount);_cashApplyDelta(entry.counterAccount,+entry.amount);}
    else if(entry.kind==='settle'&&entry.amount>0)        _cashApplyDelta(entry.account,+entry.amount);
    else if(entry.kind==='adjust')                        _cashApplyDelta(entry.account,entry.amount);
    logActivity('store-cash',`${entry.kind} ${entry.category||''} ${_fmtPKR(entry.amount)}`).catch(()=>{});
    _cashBusy=false;
    return row;
  }catch(e){
    showToast('Save failed: '+e.message,true);
    _cashBusy=false;
    return null;
  }
}

function _cashApplyDelta(key,delta){
  if(!delta||!key) return;
  const acc=allCashAccounts.find(a=>(a._id||a.key)===key);
  if(!acc){console.warn('[store-cash] unknown account:',key);return;}
  acc.balance=Math.round((acc.balance||0)+delta);
  acc.lastUpdated=Date.now();
  acc.lastBy=session?.name||'';
  fsSet('store_cash_accounts',acc._id||key,{balance:acc.balance,lastUpdated:acc.lastUpdated,lastBy:acc.lastBy}).catch(()=>{});
}

function _cashRecalcBalances(){
  const bals={};
  for(const a of CASH_ACCOUNTS) bals[a.key]=0;
  for(const a of allCashAccounts) bals[a._id||a.key]=a.openingBalance||0;
  const rows=[...allCashLedger].reverse();
  for(const r of rows){
    const amt=r.amount||0;
    if(r.kind==='topup')                               bals[r.account]=(bals[r.account]||0)+amt;
    else if(r.kind==='expense'||r.kind==='issue')      bals[r.account]=(bals[r.account]||0)-amt;
    else if(r.kind==='transfer'){                      bals[r.account]=(bals[r.account]||0)-amt;bals[r.counterAccount]=(bals[r.counterAccount]||0)+amt;}
    else if(r.kind==='settle'&&amt>0)                  bals[r.account]=(bals[r.account]||0)+amt;
    else if(r.kind==='adjust')                         bals[r.account]=(bals[r.account]||0)+amt;
  }
  for(const a of allCashAccounts){
    const k=a._id||a.key;
    const derived=Math.round(bals[k]||0);
    if(a.balance!==derived){
      console.log(`[store-cash] recompute ${k}: ${a.balance} → ${derived}`);
      a.balance=derived;
      fsSet('store_cash_accounts',k,{balance:derived,lastUpdated:Date.now(),lastBy:'system:recompute'}).catch(()=>{});
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
  const thisMonthExp=entries.filter(r=>r.kind==='expense'&&r.month===mo).reduce((s,r)=>s+(r.amount||0),0);
  const openFloat=allCashFloats.filter(f=>f.status==='open').reduce((s,f)=>s+(f.issued||0),0);
  const tabs=[{id:'recent',label:'Recent'},{id:'issued',label:'Issued'},{id:'byaccount',label:'Accounts'}];
  if(_canViewCash()) tabs.push({id:'insights',label:'Insights'});
  let h='';
  h+=_cashKpiStrip(thisMonthExp,openFloat);
  h+=`<div class="gp-tabs" style="margin:0 -16px;padding:0 16px;overflow-x:auto">${tabs.map(t=>`<div class="gp-tab${_cashTab===t.id?' active':''}" onclick="window._cashSetTab('${t.id}')">${t.label}</div>`).join('')}</div>`;
  h+=`<div id="cash-tab-body" style="padding-top:10px">`;
  if(_cashTab==='recent')         h+=_cashRecentFeed(entries);
  else if(_cashTab==='issued')    h+=_cashIssuedFeed();
  else if(_cashTab==='byaccount') h+=_cashByAccountFeed(entries);
  else if(_cashTab==='insights')  h+=_cashInsightsPanel(entries,period);
  h+=`</div>`;
  if(_canEntryCash()) h+=_cashActionBar();
  h+=`<div style="height:160px"></div>`;
  return h;
}

// ── KPI Strip ──
function _cashKpiStrip(thisMonthExp,openFloat){
  const wallets=CASH_ACCOUNTS.map(a=>{
    const doc=_cashGetAccount(a.key);
    const bal=doc?.balance||0;
    return `<div onclick="window._cashSetTab('byaccount')" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;border-top:3px solid ${a.accent};transition:box-shadow .15s" onmouseenter="this.style.boxShadow='0 2px 8px rgba(0,0,0,.08)'" onmouseleave="this.style.boxShadow=''">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px;font-weight:700">${a.label}</div>
      <div style="font-size:17px;font-weight:800;color:${bal<0?'#dc2626':'var(--text)'};line-height:1">${_fmtPKR(bal)}</div>
    </div>`;
  }).join('');
  const totalBal=allCashAccounts.reduce((s,a)=>s+(a.balance||0),0);
  const floatTile=openFloat>0
    ? `<div onclick="window._cashSetTab('issued')" style="cursor:pointer;background:#fff;border:1px solid #fca5a5;border-radius:10px;padding:10px 12px;border-top:3px solid #dc2626">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#dc2626;margin-bottom:4px;font-weight:700">Out w/ Noman</div>
        <div style="font-size:17px;font-weight:800;color:#dc2626;line-height:1">${_fmtPKR(openFloat)}</div>
      </div>`
    : `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;border-top:3px solid #6b7280">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px;font-weight:700">This Month</div>
        <div style="font-size:17px;font-weight:800;color:var(--text);line-height:1">${_fmtPKR(thisMonthExp)}</div>
      </div>`;
  return `<div style="padding:12px 0 4px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:7px;margin-bottom:7px">${wallets}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px">
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;border-top:3px solid #16a34a">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px;font-weight:700">Net Cash</div>
        <div style="font-size:17px;font-weight:800;color:${totalBal<0?'#dc2626':'var(--text)'};line-height:1">${_fmtPKR(totalBal)}</div>
      </div>
      ${floatTile}
    </div>
  </div>`;
}

// ── Recent Feed ──
function _cashRecentFeed(entries){
  if(!entries.length) return `<div class="empty" style="padding:40px 0;text-align:center">No entries yet.<br><span style="font-size:13px;color:var(--muted)">Tap <strong>₨ I PAID</strong> below to start.</span></div>`;
  const PG=20;
  const totalPages=Math.ceil(entries.length/PG);
  if(_cashRecentPage>=totalPages)_cashRecentPage=Math.max(0,totalPages-1);
  const page=entries.slice(_cashRecentPage*PG,(_cashRecentPage+1)*PG);
  const rows=page.map(r=>{
    const cat=_cashGetCategory(r.category);
    const acc=CASH_ACCOUNTS.find(a=>a.key===r.account);
    const dot=cat?.accent||'#6b7280';
    const isIn=(r.kind==='topup'||r.kind==='settle');
    const isXfer=r.kind==='transfer';
    const sign=isIn?'+':isXfer?'↕':'-';
    const col=isIn?'#16a34a':isXfer?'#7c3aed':'#dc2626';
    const payeeStr=r.payee&&r.payee!=='direct'&&r.payee!=='system'?` → ${r.payee}`:'';
    return `<div onclick="window._cashCloneEntry('${r._id}')" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" title="Tap to repeat this entry">
      <div style="width:9px;height:9px;border-radius:50%;background:${dot};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cat?.icon||''} ${cat?.label||(r.kind==='topup'?'Top-up':r.kind==='transfer'?'Transfer':r.kind)}${payeeStr}</div>
        <div style="font-size:11px;color:var(--muted)">${r.date||''} · ${acc?.label||r.account||''}${r.note?' · '+_scEsc(r.note):''}</div>
      </div>
      <div style="font-size:14px;font-weight:800;color:${col};flex-shrink:0;padding-left:6px">${sign}${_fmtPKR(r.amount)}</div>
    </div>`;
  }).join('');
  let pager='';
  if(totalPages>1){
    pager=`<div style="display:flex;gap:8px;align-items:center;justify-content:center;padding:12px 0 4px;border-top:1px solid var(--border)">
      <button onclick="window._cashPageNav(${_cashRecentPage-1})" ${_cashRecentPage===0?'disabled':''} class="btn-outline" style="padding:6px 14px;font-size:12px">← Prev</button>
      <span style="font-size:12px;color:var(--muted)">Page <strong>${_cashRecentPage+1}</strong>/${totalPages} · ${entries.length} entries</span>
      <button onclick="window._cashPageNav(${_cashRecentPage+1})" ${_cashRecentPage>=totalPages-1?'disabled':''} class="btn-outline" style="padding:6px 14px;font-size:12px">Next →</button>
    </div>`;
  }
  return `<div>${rows}${pager}</div>`;
}

// ── Issued Floats ──
function _cashIssuedFeed(){
  const open=allCashFloats.filter(f=>f.status==='open');
  const closed=allCashFloats.filter(f=>f.status==='settled').slice(0,5);
  if(!open.length&&!closed.length) return `<div class="empty" style="padding:32px 0;text-align:center">No issued floats.<br><span style="font-size:12px;color:var(--muted)">Use "→ Issue" to hand out cash.</span></div>`;
  const ageColor=ts=>{const d=(Date.now()-ts)/86400000;return d>7?'#dc2626':d>3?'#d97706':'#16a34a';};
  const ageLabel=ts=>{ const d=Math.round((Date.now()-ts)/86400000);return d===0?'today':d+'d ago'; };
  const openCards=open.map(f=>`<div style="background:#fff;border:1px solid #fca5a5;border-radius:10px;padding:12px 14px;margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div style="font-weight:700;font-size:14px">${_scEsc(f.payee)||'Person'}
        <span style="font-size:10px;background:${ageColor(f.issuedTs)};color:#fff;padding:2px 7px;border-radius:10px;margin-left:6px">${ageLabel(f.issuedTs)}</span>
      </div>
      <div style="font-size:16px;font-weight:800;color:#dc2626">${_fmtPKR(f.issued)}</div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">From ${CASH_ACCOUNTS.find(a=>a.key===f.account)?.label||f.account} · ${f.issuedBy||''} · ${new Date(f.issuedTs).toLocaleDateString()}${f.note?' · '+_scEsc(f.note):''}</div>
    ${_canEntryCash()?`<button class="btn-primary" style="font-size:12px;padding:6px 16px;margin-top:0" onclick="window.cashSettleFloat('${_scEsc(f._id)}')">Settle ✓</button>`:''}
  </div>`).join('');
  const closedSection=closed.length?`<div style="font-size:10px;color:var(--muted);margin:12px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Recently Settled</div>`+closed.map(f=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
    <span style="color:var(--muted)">${_scEsc(f.payee)||'Person'} · ${new Date(f.issuedTs).toLocaleDateString()}</span>
    <span style="font-weight:700;color:#16a34a">Settled ${_fmtPKR(f.issued)}${f.variance?` (${f.variance>0?'−':'+'}${_fmtPKR(Math.abs(f.variance))})`:''}</span>
  </div>`).join(''):'';
  return `<div>${openCards}${closedSection}</div>`;
}

// ── By Account ──
function _cashByAccountFeed(entries){
  let h='';
  for(const acc of CASH_ACCOUNTS){
    const doc=_cashGetAccount(acc.key);
    const bal=doc?.balance||0;
    const recent=entries.filter(r=>r.account===acc.key||r.counterAccount===acc.key).slice(0,6);
    const drift=doc?.countedBalance!=null?Math.abs(bal-(doc.countedBalance||0)):null;
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-top:3px solid ${acc.accent}">
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700">${acc.label}</div>
          <div style="font-size:24px;font-weight:800;color:${bal<0?'#dc2626':'var(--text)'};line-height:1.1">${_fmtPKR(bal)}</div>
          ${drift!=null?`<div style="font-size:11px;margin-top:2px;color:${drift>10?'#dc2626':'#16a34a'}">Last count: ${_fmtPKR(doc.countedBalance)} ${drift>10?'· off by '+_fmtPKR(drift):'✓'}</div>`:''}
        </div>
        ${_canAdminCash()?`<button class="btn-outline" style="font-size:11px;padding:4px 12px" onclick="window.cashCountWallet('${acc.key}')">Count</button>`:''}
      </div>
      <div style="padding:2px 14px 10px">
        ${recent.map(r=>{
          const cat=_cashGetCategory(r.category);
          const isIn=(r.kind==='topup'||r.kind==='settle');
          const col=isIn?'#16a34a':r.kind==='transfer'?'#7c3aed':'#dc2626';
          const sign=isIn?'+':r.kind==='transfer'?'↕':'-';
          return`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
            <span style="color:var(--muted)">${cat?.icon||''} ${cat?.label||r.kind} · ${r.date}</span>
            <span style="font-weight:700;color:${col}">${sign}${_fmtPKR(r.amount)}</span>
          </div>`;
        }).join('')}
        ${!recent.length?`<div style="font-size:12px;color:var(--muted);padding:8px 0">No entries yet.</div>`:''}
      </div>
    </div>`;
  }
  if(_canAdminCash()){
    h+=`<button class="btn-outline" style="width:100%;margin-top:4px;font-size:12px;padding:8px" onclick="window.cashRecomputeBalances()">↺ Recompute All Balances from Ledger</button>`;
  }
  return h;
}

// ── Insights (owner only) ──
function _cashInsightsPanel(entries,period){
  if(!_canViewCash()) return '<div class="empty">Access restricted.</div>';
  const mo=period||_cashCurrentMonth();
  const months=[...new Set(entries.map(r=>r.month||'').filter(Boolean))].sort().reverse().slice(0,6);
  const sel=entries.filter(r=>r.month===mo);
  const expenses=sel.filter(r=>r.kind==='expense');
  const totalOut=expenses.reduce((s,r)=>s+(r.amount||0),0);
  const totalIn=sel.filter(r=>r.kind==='topup').reduce((s,r)=>s+(r.amount||0),0);
  const net=totalIn-totalOut;
  // By category
  const byCat={};
  for(const r of expenses) byCat[r.category]=(byCat[r.category]||0)+(r.amount||0);
  const catSorted=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  const maxCat=catSorted[0]?.[1]||1;
  // By bucket
  const byBucket={};
  for(const r of expenses) byBucket[r.bucket||'overhead']=(byBucket[r.bucket||'overhead']||0)+(r.amount||0);
  const BUCKET_LABEL={stock:'Stock',overhead:'Overhead',passthrough:'Pass-through',misc:'Misc'};
  const BUCKET_COLOR={stock:'#0284c7',overhead:'#ea580c',passthrough:'#64748b',misc:'#6b7280'};
  let h='';
  // Period selector
  if(months.length>1){
    h+=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${months.map(m=>`<button onclick="window._cashSetPeriod('${m}')" style="padding:5px 11px;border-radius:16px;border:1.5px solid ${period===m?'#2563eb':'var(--border)'};background:${period===m?'#dbeafe':'#fff'};font-size:11px;font-weight:600;cursor:pointer;color:${period===m?'#2563eb':'var(--text)'}">${m}</button>`).join('')}</div>`;
  }
  // KPIs
  h+=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:12px">
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;border-top:3px solid #16a34a"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px">In</div><div style="font-size:16px;font-weight:800;color:#16a34a">${_fmtPKR(totalIn)}</div></div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;border-top:3px solid #dc2626"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px">Out</div><div style="font-size:16px;font-weight:800;color:#dc2626">${_fmtPKR(totalOut)}</div></div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;border-top:3px solid ${net>=0?'#16a34a':'#dc2626'}"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px">Net</div><div style="font-size:16px;font-weight:800;color:${net>=0?'#16a34a':'#dc2626'}">${_fmtPKR(net)}</div></div>
  </div>`;
  // By category bars
  if(catSorted.length){
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:12px;letter-spacing:.06em">Spend by Category</div>`;
    for(const [k,amt] of catSorted){
      const cat=_cashGetCategory(k);
      const pct=Math.round((amt/maxCat)*100);
      h+=`<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${cat?.icon||''} ${cat?.label||k}</span>
          <span style="font-weight:700">${_fmtPKR(amt)} <span style="color:var(--muted);font-weight:400">${totalOut?Math.round(amt/totalOut*100):0}%</span></span>
        </div>
        <div style="height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${cat?.accent||'#6b7280'};border-radius:3px;transition:width .4s"></div>
        </div>
      </div>`;
    }
    h+=`</div>`;
  }
  // Stock vs Overhead split
  if(Object.keys(byBucket).length&&totalOut>0){
    h+=`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:10px;letter-spacing:.06em">Spend Split</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(byBucket).map(([bk,amt])=>`<div style="flex:1;min-width:72px;background:${BUCKET_COLOR[bk]||'#6b7280'}15;border:1px solid ${BUCKET_COLOR[bk]||'#6b7280'}35;border-radius:8px;padding:8px 10px">
        <div style="font-size:9px;color:var(--muted);margin-bottom:2px;text-transform:uppercase;font-weight:700">${BUCKET_LABEL[bk]||bk}</div>
        <div style="font-size:14px;font-weight:800;color:${BUCKET_COLOR[bk]||'#6b7280'}">${_fmtPKR(amt)}</div>
        <div style="font-size:10px;color:var(--muted)">${Math.round(amt/totalOut*100)}%</div>
      </div>`).join('')}</div>
    </div>`;
  }
  if(!catSorted.length) h+=`<div class="empty" style="padding:24px 0">No expense entries for ${mo}.</div>`;
  return h;
}

// ── Action Bar ──
function _cashActionBar(){
  return `<div id="cash-action-bar" class="cash-action-bar">
    <button onclick="window.cashSheetExpense()" style="flex:3;height:48px;background:#dc2626;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;letter-spacing:-.01em;box-shadow:0 2px 8px #dc262638">₨ I PAID</button>
    <button onclick="window.cashSheetTopup()" style="flex:1;height:48px;background:#16a34a;color:#fff;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer">+ IN</button>
    <button onclick="window.cashSheetIssue()" style="flex:1;height:48px;background:#7c3aed;color:#fff;border:none;border-radius:12px;font-size:11px;font-weight:700;cursor:pointer">→ Issue</button>
  </div>`;
}

// ── Window event handlers ──
window._cashSetTab=function(tab){_cashTab=tab;_cashRecentPage=0;_cashReload();};
window._cashPageNav=function(n){_cashRecentPage=n;_cashReload();const m=document.getElementById('cash-tab-body');if(m)m.scrollIntoView({behavior:'smooth',block:'start'});};
window._cashSetPeriod=function(m){_cashInsightsPeriod=m;_cashReload();};
window._cashCloneEntry=function(id){const r=allCashLedger.find(x=>x._id===id);if(!r)return;if(r.kind==='expense')window.cashSheetExpense(id);else if(r.kind==='topup')window.cashSheetTopup(id);else showToast('Open sheet for this type from the action bar.');};

// ── EXPENSE SHEET ──
window.cashSheetExpense=function(cloneId){
  const clone=cloneId?allCashLedger.find(r=>r._id===cloneId):null;
  const defAcc=clone?.account||localStorage.getItem('groovy_cash_last_acc')||'cash';
  const defCat=clone?.category||localStorage.getItem('groovy_cash_last_cat')||'';
  window._cashExpenseCat=defCat; window._cashExpenseAcc=defAcc;
  const cats=allCashCategories.length?allCashCategories:CASH_CAT_SEED;
  const catChips=cats.map(c=>{
    const k=c.key||c._id;
    const on=defCat===k;
    return`<button id="cc-${k}" onclick="window._cashPickCat('${k}')" style="padding:7px 12px;border-radius:20px;border:2px solid ${on?c.accent:'#e5e7eb'};background:${on?c.accent+'18':'#fff'};font-size:12px;cursor:pointer;font-weight:600;color:${on?c.accent:'var(--text)'}">
      ${c.icon||''} ${c.label||k}
    </button>`;
  }).join('');
  const accChips=CASH_ACCOUNTS.map(a=>{
    const on=defAcc===a.key;
    return`<button id="ca-${a.key}" onclick="window._cashPickAcc('${a.key}')" style="padding:7px 14px;border-radius:20px;border:2px solid ${on?a.accent:'#e5e7eb'};background:${on?a.accent+'18':'#fff'};font-size:12px;cursor:pointer;font-weight:600;color:${on?a.accent:'var(--text)'}">${a.label}</button>`;
  }).join('');
  const qAmts=[100,500,1000,2000,5000].map(v=>`<button onclick="window._cashQAmt(${v})" style="flex:1;padding:8px 0;border:1px solid var(--border);border-radius:8px;background:#f9fafb;font-size:12px;font-weight:700;cursor:pointer">+${v>=1000?v/1000+'k':v}</button>`).join('');
  _cashOpenSheet('₨ I Paid',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Category</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">${catChips}</div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Amount (₨)</div>
    <input id="cash-amt" type="number" inputmode="numeric" min="1" placeholder="0" value="${clone?.amount||''}" oninput="window._cashPrev()"
      style="width:100%;font-size:28px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:8px;box-sizing:border-box">
    <div style="display:flex;gap:6px;margin-bottom:16px">${qAmts}</div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">From Account</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${accChips}</div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Payee / Note <span style="font-weight:400">(optional)</span></div>
    <input id="cash-note" type="text" placeholder="e.g. Noman, direct, Pak Gas Agency" value="${_scEsc(clone?.note||'')}"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:10px">
    <div id="cash-prev" style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:10px;min-height:16px"></div>
    <button id="cash-submit" onclick="window._cashDoExpense()" style="width:100%;height:50px;background:#dc2626;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">Record <span id="cash-sub-amt">—</span></button>
    <button onclick="window.cashSheetTransfer(true)" style="width:100%;height:38px;background:transparent;color:#7c3aed;border:1.5px solid #7c3aed40;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;margin-top:8px">↕ Transfer between accounts</button>
  `);
  window._cashPrev();
};

window._cashPickCat=function(key){
  window._cashExpenseCat=key;
  localStorage.setItem('groovy_cash_last_cat',key);
  const cat=_cashGetCategory(key);
  document.querySelectorAll('[id^="cc-"]').forEach(b=>{
    const isMe=b.id==='cc-'+key;
    b.style.borderColor=isMe?(cat?.accent||'#333'):'#e5e7eb';
    b.style.background=isMe?(cat?.accent||'#333')+'18':'#fff';
    b.style.color=isMe?(cat?.accent||'#333'):'var(--text)';
  });
  window._cashPrev();
};
window._cashPickAcc=function(key){
  window._cashExpenseAcc=key;
  localStorage.setItem('groovy_cash_last_acc',key);
  const acc=CASH_ACCOUNTS.find(a=>a.key===key);
  document.querySelectorAll('[id^="ca-"]').forEach(b=>{
    const isMe=b.id==='ca-'+key;
    b.style.borderColor=isMe?(acc?.accent||'#333'):'#e5e7eb';
    b.style.background=isMe?(acc?.accent||'#333')+'18':'#fff';
    b.style.color=isMe?(acc?.accent||'#333'):'var(--text)';
  });
  window._cashPrev();
};
window._cashQAmt=function(v){const i=document.getElementById('cash-amt');if(i){i.value=(parseInt(i.value)||0)+v;window._cashPrev();}};
window._cashPrev=function(){
  const amt=parseInt(document.getElementById('cash-amt')?.value)||0;
  const acc=CASH_ACCOUNTS.find(a=>a.key===window._cashExpenseAcc);
  const prev=document.getElementById('cash-prev');
  const sub=document.getElementById('cash-sub-amt');
  if(prev&&acc&&amt>0) prev.textContent=`Will deduct ${_fmtPKR(amt)} from ${acc.label}`;
  else if(prev) prev.textContent='';
  if(sub) sub.textContent=amt>0?_fmtPKR(amt):'—';
};
window._cashDoExpense=async function(){
  const amt=parseInt(document.getElementById('cash-amt')?.value)||0;
  const cat=window._cashExpenseCat;
  const accKey=window._cashExpenseAcc;
  const note=(document.getElementById('cash-note')?.value||'').trim();
  if(!amt||amt<=0){showToast('Enter an amount.',true);return;}
  if(!cat){showToast('Pick a category.',true);return;}
  const btn=document.getElementById('cash-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const catDoc=_cashGetCategory(cat);
  const payee=note||'direct';
  const mo=_cashCurrentMonth();
  const row=await _cashPost({kind:'expense',amount:amt,account:accKey,category:cat,bucket:catDoc?.bucket||'overhead',payee,date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note});
  if(row){showToast(`${_fmtPKR(amt)} recorded ✓`);_cashCloseSheet();_cashReload();}
  else if(btn){btn.disabled=false;btn.textContent=`Record ${_fmtPKR(amt)}`;}
};

// ── TOPUP SHEET ──
window.cashSheetTopup=function(cloneId){
  const clone=cloneId?allCashLedger.find(r=>r._id===cloneId):null;
  const defAcc=clone?.account||'cash';
  window._cashTopupAcc=defAcc;
  const accChips=CASH_ACCOUNTS.map(a=>{
    const on=defAcc===a.key;
    return`<button id="ta-${a.key}" onclick="window._cashPickTopupAcc('${a.key}')" style="padding:8px 16px;border-radius:20px;border:2px solid ${on?a.accent:'#e5e7eb'};background:${on?a.accent+'18':'#fff'};font-size:13px;cursor:pointer;font-weight:600;color:${on?a.accent:'var(--text)'}">${a.label}</button>`;
  }).join('');
  const qAmts=[1000,2000,5000,10000,20000].map(v=>`<button onclick="window._cashTQAmt(${v})" style="flex:1;padding:8px 0;border:1px solid var(--border);border-radius:8px;background:#f9fafb;font-size:12px;font-weight:700;cursor:pointer">+${v>=1000?v/1000+'k':v}</button>`).join('');
  _cashOpenSheet('+ Money In',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Deposit Into</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">${accChips}</div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Amount (₨)</div>
    <input id="topup-amt" type="number" inputmode="numeric" min="1" placeholder="0" value="${clone?.amount||''}"
      style="width:100%;font-size:28px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:8px;box-sizing:border-box" oninput="window._cashTPrev()">
    <div style="display:flex;gap:6px;margin-bottom:16px">${qAmts}</div>
    <input id="topup-note" type="text" placeholder="Source / note (e.g. Afnan — MCB transfer)" value="${_scEsc(clone?.note||'')}"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:10px">
    <div id="topup-prev" style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:10px;min-height:16px"></div>
    <button id="topup-submit" onclick="window._cashDoTopup()" style="width:100%;height:50px;background:#16a34a;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">+ Add Money In</button>
  `);
  window._cashTPrev();
};
window._cashPickTopupAcc=function(key){
  window._cashTopupAcc=key;
  const acc=CASH_ACCOUNTS.find(a=>a.key===key);
  document.querySelectorAll('[id^="ta-"]').forEach(b=>{
    const isMe=b.id==='ta-'+key;
    b.style.borderColor=isMe?(acc?.accent||'#333'):'#e5e7eb';
    b.style.background=isMe?(acc?.accent||'#333')+'18':'#fff';
    b.style.color=isMe?(acc?.accent||'#333'):'var(--text)';
  });
  window._cashTPrev();
};
window._cashTQAmt=function(v){const i=document.getElementById('topup-amt');if(i){i.value=(parseInt(i.value)||0)+v;window._cashTPrev();}};
window._cashTPrev=function(){
  const amt=parseInt(document.getElementById('topup-amt')?.value)||0;
  const acc=CASH_ACCOUNTS.find(a=>a.key===window._cashTopupAcc);
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
  const row=await _cashPost({kind:'topup',amount:amt,account:window._cashTopupAcc,category:null,bucket:null,payee:'Afnan',date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note});
  if(row){showToast(`${_fmtPKR(amt)} added to ${CASH_ACCOUNTS.find(a=>a.key===window._cashTopupAcc)?.label} ✓`);_cashCloseSheet();_cashReload();}
  else if(btn){btn.disabled=false;btn.textContent='+ Add Money In';}
};

// ── TRANSFER SHEET ──
window.cashSheetTransfer=function(fromExpenseSheet){
  if(fromExpenseSheet) _cashCloseSheet();
  const opts=CASH_ACCOUNTS.map(a=>`<option value="${a.key}">${a.label}</option>`).join('');
  const qAmts=[1000,2000,5000,10000].map(v=>`<button onclick="window._cashXQAmt(${v})" style="flex:1;padding:8px 0;border:1px solid var(--border);border-radius:8px;background:#f9fafb;font-size:12px;font-weight:700;cursor:pointer">+${v>=1000?v/1000+'k':v}</button>`).join('');
  const show=()=>_cashOpenSheet('↕ Transfer',`
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
    <button id="xfer-submit" onclick="window._cashDoTransfer()" style="width:100%;height:48px;background:#7c3aed;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">↕ Transfer</button>
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
  const row=await _cashPost({kind:'transfer',amount:amt,account:from,counterAccount:to,category:null,bucket:null,payee:'internal',date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note});
  if(row){showToast(`${_fmtPKR(amt)} transferred ✓`);_cashCloseSheet();_cashReload();}
  else if(btn){btn.disabled=false;btn.textContent='↕ Transfer';}
};

// ── ISSUE SHEET ──
window.cashSheetIssue=function(){
  const opts=CASH_ACCOUNTS.map(a=>`<option value="${a.key}">${a.label}</option>`).join('');
  const qAmts=[1000,2000,5000,10000].map(v=>`<button onclick="window._cashIQAmt(${v})" style="flex:1;padding:8px 0;border:1px solid var(--border);border-radius:8px;background:#f9fafb;font-size:12px;font-weight:700;cursor:pointer">+${v>=1000?v/1000+'k':v}</button>`).join('');
  _cashOpenSheet('→ Issue to Person',`
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Issue To</div>
    <input id="issue-payee" type="text" value="" placeholder="e.g. Noman"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">From Account</div>
    <select id="issue-acc" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box">${opts}</select>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Amount (₨)</div>
    <input id="issue-amt" type="number" inputmode="numeric" min="1" placeholder="0"
      style="width:100%;font-size:24px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:8px;box-sizing:border-box">
    <div style="display:flex;gap:6px;margin-bottom:12px">${qAmts}</div>
    <input id="issue-note" type="text" placeholder="Purpose (e.g. buying neck labels)"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <button id="issue-submit" onclick="window._cashDoIssue()" style="width:100%;height:48px;background:#7c3aed;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">→ Issue Cash</button>
  `);
};
window._cashIQAmt=function(v){const i=document.getElementById('issue-amt');if(i)i.value=(parseInt(i.value)||0)+v;};
window._cashDoIssue=async function(){
  const payee=(document.getElementById('issue-payee')?.value||'').trim()||'Noman';
  const accKey=document.getElementById('issue-acc')?.value||'cash';
  const amt=parseInt(document.getElementById('issue-amt')?.value)||0;
  const note=(document.getElementById('issue-note')?.value||'').trim();
  if(!amt||amt<=0){showToast('Enter an amount.',true);return;}
  const btn=document.getElementById('issue-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const mo=_cashCurrentMonth();
  const floatId=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  const row=await _cashPost({kind:'issue',amount:amt,account:accKey,category:null,bucket:null,payee:payee.toLowerCase(),date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note,floatId});
  if(!row){if(btn){btn.disabled=false;btn.textContent='→ Issue Cash';}return;}
  const floatDoc={payee,issued:amt,account:accKey,issuedTs:Date.now(),issuedBy:session.name,status:'open',goodsValue:null,changeReturned:null,variance:null,floatId,note};
  await fsSet('store_cash_floats',floatId,floatDoc).catch(()=>{});
  allCashFloats.unshift({...floatDoc,_id:floatId});
  showToast(`${_fmtPKR(amt)} issued to ${payee} ✓`);
  _cashCloseSheet();
  _cashReload();
};

// ── SETTLE FLOAT ──
window.cashSettleFloat=function(floatId){
  const f=allCashFloats.find(x=>x._id===floatId||x.floatId===floatId);
  if(!f){showToast('Float not found.',true);return;}
  const cats=allCashCategories.length?allCashCategories:CASH_CAT_SEED;
  const catOpts=cats.map(c=>`<option value="${c.key||c._id}">${c.icon||''} ${c.label||c.key}</option>`).join('');
  _cashOpenSheet('Settle Float',`
    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px;line-height:1.5">
      <strong>${_scEsc(f.payee)}</strong> was issued <strong>${_fmtPKR(f.issued)}</strong> from <strong>${CASH_ACCOUNTS.find(a=>a.key===f.account)?.label||f.account}</strong>
    </div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Goods Value (₨)</div>
    <input id="settle-goods" type="number" inputmode="numeric" min="0" placeholder="0"
      style="width:100%;font-size:22px;font-weight:800;padding:10px;border:2px solid var(--border);border-radius:10px;margin-bottom:10px;box-sizing:border-box">
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Goods Category</div>
    <select id="settle-cat" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;box-sizing:border-box">${catOpts}</select>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Change Returned (₨)</div>
    <input id="settle-change" type="number" inputmode="numeric" min="0" placeholder="0"
      style="width:100%;font-size:22px;font-weight:800;padding:10px;border:2px solid var(--border);border-radius:10px;margin-bottom:14px;box-sizing:border-box">
    <button id="settle-submit" onclick="window._cashDoSettle('${_scEsc(floatId)}')" style="width:100%;height:48px;background:#16a34a;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer">Settle ✓</button>
  `);
};
window._cashDoSettle=async function(floatId){
  const f=allCashFloats.find(x=>x._id===floatId||x.floatId===floatId);
  if(!f){showToast('Float not found.',true);return;}
  const goodsVal=parseInt(document.getElementById('settle-goods')?.value)||0;
  const changeRet=parseInt(document.getElementById('settle-change')?.value)||0;
  const cat=document.getElementById('settle-cat')?.value||'stock';
  const catDoc=_cashGetCategory(cat);
  const btn=document.getElementById('settle-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const mo=_cashCurrentMonth();
  const fid=f.floatId||f._id||floatId;
  if(goodsVal>0) await _cashPost({kind:'expense',amount:goodsVal,account:f.account,category:cat,bucket:catDoc?.bucket||'stock',payee:(f.payee||'noman').toLowerCase(),date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note:'Settled: '+(f.note||''),floatId:fid});
  if(changeRet>0) await _cashPost({kind:'settle',amount:changeRet,account:f.account,category:null,bucket:null,payee:(f.payee||'noman').toLowerCase(),date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,note:'Change returned',floatId:fid});
  const variance=f.issued-goodsVal-changeRet;
  const updated={...f,status:'settled',goodsValue:goodsVal,changeReturned:changeRet,variance,settledTs:Date.now(),settledBy:session.name};
  const fKey=f._id||fid;
  await fsSet('store_cash_floats',fKey,updated).catch(()=>{});
  const idx=allCashFloats.findIndex(x=>x._id===fKey||x.floatId===fid);
  if(idx>=0) allCashFloats[idx]=updated;
  showToast(variance!==0?`Settled — variance ${_fmtPKR(Math.abs(variance))}`:'Float settled ✓');
  _cashCloseSheet();
  _cashReload();
};

// ── COUNT WALLET (owner) ──
window.cashCountWallet=function(key){
  const acc=_cashGetAccount(key)||CASH_ACCOUNTS.find(a=>a.key===key);
  const bal=allCashAccounts.find(a=>(a._id||a.key)===key)?.balance||0;
  _cashOpenSheet(`Count ${acc?.label||key}`,`
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px">
      Book balance: <strong>${_fmtPKR(bal)}</strong>
    </div>
    <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Actual Physical Count (₨)</div>
    <input id="count-amt" type="number" inputmode="numeric" min="0" placeholder="0"
      style="width:100%;font-size:24px;font-weight:800;text-align:center;padding:12px;border:2px solid var(--border);border-radius:10px;margin-bottom:12px;box-sizing:border-box">
    ${_canAdminCash()?`<input id="count-reason" type="text" placeholder="Reason (required if posting adjustment)"
      style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px">
    <button id="count-submit" onclick="window._cashDoCount('${key}')" style="width:100%;height:48px;background:#0f172a;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">Record Count &amp; Post Adjustment if Needed</button>`
    :`<button id="count-submit" onclick="window._cashDoCount('${key}')" style="width:100%;height:48px;background:#64748b;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">Record Count</button>`}
  `);
};
window._cashDoCount=async function(key){
  const counted=parseInt(document.getElementById('count-amt')?.value);
  if(isNaN(counted)||counted<0){showToast('Enter a valid count.',true);return;}
  const reason=(document.getElementById('count-reason')?.value||'').trim();
  const bal=allCashAccounts.find(a=>(a._id||a.key)===key)?.balance||0;
  const diff=counted-bal;
  if(Math.abs(diff)>0&&_canAdminCash()&&!reason){showToast('Enter a reason for the adjustment.',true);return;}
  const btn=document.getElementById('count-submit');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const accDoc=allCashAccounts.find(a=>(a._id||a.key)===key);
  if(accDoc){accDoc.countedBalance=counted;accDoc.countedAt=Date.now();accDoc.countedBy=session.name;}
  await fsSet('store_cash_accounts',key,{countedBalance:counted,countedAt:Date.now(),countedBy:session.name}).catch(()=>{});
  if(diff!==0&&_canAdminCash()){
    const mo=_cashCurrentMonth();
    await _cashPost({kind:'adjust',amount:diff,account:key,category:null,bucket:null,payee:'system',date:todayStr(),month:mo,ts:Date.now(),by:session.u||session.name,adjustsReason:reason,note:'Physical count adj'});
    showToast(`Adjustment of ${_fmtPKR(Math.abs(diff))} posted ✓`);
  }else{
    showToast('Count recorded ✓');
  }
  _cashCloseSheet();
  _cashReload();
};

// ── Recompute ──
window.cashRecomputeBalances=function(){
  _cashRecalcBalances();
  showToast('Balances recomputed from ledger ✓');
  _cashReload();
};

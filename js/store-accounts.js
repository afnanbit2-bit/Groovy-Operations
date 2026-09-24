/* Groovy Operations — store-accounts.js
   Store Accounts (wave 1, Sept 2026): purchasing with rates → store
   inventory, vendor accounts (terms, aging, statement, rate card, Excel),
   metered consumables (water / gas daily logs → generated monthly bill),
   runner floats, two money accounts (Cash, MCB), month close, owner review.
   Run by Raees. Design: ACCOUNTS_PLAN.md. Replaces js/store-cash.js.

   Plain global classic script (no import/export). Loaded after js/store.js
   and shares its REST helpers: fsList, fsSet, fsAdd, _fsRunQuery, fsVal,
   safeId, allItems, loadStoreData, _storeDataLoaded; and shared.js:
   showToast, logActivity, uploadToCloudinary, session, currentPage.

   Rules this file holds to:
   - ONE entry shape (`acct_entries`), effects DERIVED by _acctEffect(). No
     balance is ever stored on an account; a month close stores a checkpoint.
   - Void, never edit. A voided row stays in the log, struck through.
   - Every user string reaches HTML through _acctEsc(). Colours are tokens.
   - Every date is local (YYYY-MM-DD), settable, defaulting to today. */

// ── State ──
let acctVendors=[];
let acctEntries=[];
let acctCloses=[];
let acctSettings=null;
let _acctMeterCache={};          // 'vendorId|YYYY-MM' → [logs]
let _acctLoaded=false;
let _acctLoading=null;
let _acctLoadErr=null;           // {cols:[...], quota:bool} when a read failed
let _acctBusy=false;

// page state
let _acctView='all';             // all | cash | mcb | payables
let _acctPeriod={preset:'month',from:'',to:''};
let _acctFilter={type:'',vendor:'',q:''};
let _acctPage=0;
let _acctVendorId=null;
let _acctCategoryId=null;        // the category page (acct-category) being looked at
let _acctRunnerId=null;          // the runner page (acct-runner) being looked at
let _acctVendorTab='statement';
let _acctVendorRange={from:'',to:''};
let _acctConsVendor=null;
let _acctConsMonth='';
let _acctWizard=null;            // vendor wizard state
let _acctFormLines=[];           // purchase form lines (transient)
window._acctPhoto=window._acctPhoto||{};

// ── Constants ──
const ACCT_ACCOUNTS=[
  {key:'cash',label:'Cash in hand',short:'Cash',online:false},
  {key:'mcb', label:'MCB Bank',    short:'MCB', online:true}
];
// A vendor can also be paid from OUTSIDE the two money accounts — a
// director settling a bill personally, a set-off, someone else covering
// it. Afnan (23 Sept 2026): "OTHER should be here as well but there is no
// credit debit account of other it is settled without a record." So a
// payment with account:'other' lowers the vendor's payable and moves
// NEITHER Cash nor MCB. It is deliberately NOT in ACCT_ACCOUNTS: it has no
// balance, no book, no tile — _acctIsMoney() is what the engine asks.
const ACCT_OTHER={key:'other',label:'Other',short:'Other',sub:'settled outside Cash / MCB'};
const ACCT_TYPES={
  purchase:{label:'Purchase',        verb:'Record purchase'},
  payment:{label:'Payment',          verb:'Pay a vendor'},
  cash_in:{label:'Cash in',          verb:'Cash in (Cash / MCB)'},
  transfer:{label:'Transfer',        verb:'Transfer Cash ↔ MCB'},
  float_out:{label:'Float out',      verb:'Give a float to a runner'},
  float_in:{label:'Float returned',  verb:'Change back from a runner'},
  runner_pay:{label:'Runner settled', verb:'Settle with a runner'},
  adjust:{label:'Adjustment',        verb:'Adjustment (owner)'},
  opening:{label:'Opening balance',  verb:''}
};
const ACCT_VENDOR_KINDS=[
  {key:'goods',      label:'Store items',      hint:'Thread, trims, packing — things that go on a shelf'},
  {key:'service',    label:'Services & work',  hint:'Maintenance, repairs, transport, labour'},
  {key:'utility',    label:'Recurring bill',   hint:'Water supply, internet, electricity — weekly or monthly'},
  {key:'consumable', label:'Daily consumable', hint:'Bottled water, gas — counted or weighed every day'}
];
const ACCT_TERM_MODES=[
  {key:'cash',    label:'Cash on delivery',  hint:'Paid when it arrives — never a balance'},
  {key:'credit',  label:'Credit',            hint:'Paid after N days; a running balance'},
  {key:'monthly', label:'Monthly account',   hint:'One bill a month, on a fixed day'},
  {key:'weekly',  label:'Weekly account',    hint:'One bill a week, on a fixed weekday'}
];
const _ACCT_WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ACCT_DEFAULTS={
  approvalLimit:0,            // 0 = off
  receiptRequiredAbove:2000,  // purchase/payment above this with no photo → needs review
  floatWarnDays:3,
  floatRedDays:7,
  categories:['Store purchase','Maintenance & repairs','Wages','Advances','Office & stationery','Fuel & transport','Utilities','Other'],
  runners:['Noman'],
  payDays:[3,6]               // weekdays the store settles vendors on: Wednesday and Saturday (Afnan, 23 Sept 2026)
};
const ACCT_PAGE_SIZE=40;
// Which categories are VENDOR-based (Afnan, 24 Sept 2026, ticking Store
// purchase and Other on a screenshot and crossing out the rest): a bill
// under any other category is asked "does it have a vendor?" and may name
// a free-text payee instead. Advances is a plain category for now — to be
// connected to HRM advances later. Matched case-folded; a category not on
// this list (one Raees added) defaults to no vendor, and the form still asks.
const ACCT_VENDOR_CATS=['Store purchase','Other'];
function _acctCatHasVendor(cat){const k=String(cat||'').trim().toLowerCase();return ACCT_VENDOR_CATS.some(c=>c.toLowerCase()===k);}
// A bill with NO vendor must carry its photo above this — the bill is the
// only proof of the transaction (Afnan: "take a photo above 1000 RS other
// then that its optional"). Separate from receiptRequiredAbove, which only
// flags for review; this one refuses.
const ACCT_NOVENDOR_PHOTO_ABOVE=1000;

// ── Permissions (nav/UI; firestore.rules `isStoreAccounts()` is the boundary) ──
function _acctCanView(){return !!session&&(session.role==='owner'||session.role==='manager'||session.role==='store');}
function _acctCanEntry(){return !!session&&(session.role==='owner'||session.role==='store');}
function _acctCanAdmin(){return !!session&&session.role==='owner';}
// SUPER — Afnan alone, by USERNAME (the Sept 2026 grant shape: never a
// role, or Ammar would inherit it). The one person who may EDIT an entry
// in place, DELETE one, reopen a closed month, or wipe the module. Every
// route through here is a correction tool, not a workflow: Raees voids,
// owners review, Afnan repairs. Mirror: firestore.rules isAcctSuper().
const _ACCT_SUPER_USERS=['afnan'];
function _acctIsSuper(){return !!session&&_ACCT_SUPER_USERS.includes(session.u);}
// Kept under the old name so js/shared.js's four nav sites need no rename.
function _canViewCash(){return _acctCanView();}

// ── Helpers ──
function _acctEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function _acctPKR(n){const v=Math.abs(Math.round(n||0));return (n<0?'−':'')+'₨'+v.toLocaleString('en-PK');}
function _acctSigned(n){if(!n)return '';return (n>0?'+':'−')+'₨'+Math.abs(Math.round(n)).toLocaleString('en-PK');}
function _acctPad(n){return String(n).padStart(2,'0');}
// LOCAL day, never the UTC ISO string (which names yesterday before 5am PKT).
function _acctDayStr(d){return d.getFullYear()+'-'+_acctPad(d.getMonth()+1)+'-'+_acctPad(d.getDate());}
function _acctToday(){return _acctDayStr(new Date());}
function _acctMonthOf(date){return String(date||'').slice(0,7);}
function _acctThisMonth(){return _acctMonthOf(_acctToday());}
function _acctAddDays(date,n){const d=new Date(date+'T00:00:00');d.setDate(d.getDate()+n);return _acctDayStr(d);}
function _acctDaysBetween(a,b){return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);}
function _acctDayAdd(d,n){const x=new Date(d+'T00:00:00');x.setDate(x.getDate()+n);return _acctDayStr(x);}
function _acctWeekdayOf(d){return new Date(d+'T00:00:00').getDay();}
// The most recent date on or before `today` that falls on `weekday` (0=Sunday).
function _acctLastWeekday(today,weekday){const back=(_acctWeekdayOf(today)-weekday+7)%7;return _acctDayAdd(today,-back);}
// The store's payable days (settings), as sorted weekday numbers.
function _acctPayDays(){const p=_acctSettings().payDays;const out=(Array.isArray(p)?p:[]).map(Number).filter(n=>n>=0&&n<=6);return (out.length?out:ACCT_DEFAULTS.payDays).slice().sort((a,b)=>a-b);}
function _acctIsPayDay(today){return _acctPayDays().includes(_acctWeekdayOf(today));}
// The next payable day on or after `today`.
function _acctNextPayDay(today){const wd=_acctWeekdayOf(today);const ahead=Math.min(..._acctPayDays().map(d=>(d-wd+7)%7));return _acctDayAdd(today,ahead);}
// A weekly account bills on these weekdays: its own list, a legacy single
// `billWeekday`, else the store's payable days.
function _acctBillDays(t){t=t||{};if(Array.isArray(t.billWeekdays)&&t.billWeekdays.length)return t.billWeekdays.map(Number).filter(n=>n>=0&&n<=6).sort((a,b)=>a-b);const one=parseInt(t.billWeekday);if(one>=0&&one<=6)return [one];return _acctPayDays();}
function _acctDaysLabel(days){return days.map(d=>_ACCT_WEEKDAYS[d]).join(' & ');}
function _acctMonthAdd(mo,n){const [y,m]=mo.split('-').map(Number);const d=new Date(y,m-1+n,1);return d.getFullYear()+'-'+_acctPad(d.getMonth()+1);}
function _acctMonthLabel(mo){const d=new Date(mo+'-01T00:00:00');return isNaN(d)?mo:d.toLocaleDateString('en-PK',{month:'long',year:'numeric'});}
function _acctDateLabel(date){const d=new Date(date+'T00:00:00');return isNaN(d)?date:d.toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'2-digit'});}
function _acctDaysInMonth(mo){const [y,m]=mo.split('-').map(Number);return new Date(y,m,0).getDate();}
function _acctSettings(){return Object.assign({},ACCT_DEFAULTS,acctSettings||{});}
function _acctAccount(key){return ACCT_ACCOUNTS.find(a=>a.key===key)||null;}
function _acctAccountLabel(key){const a=_acctAccount(key);return a?a.short:(key===ACCT_OTHER.key?ACCT_OTHER.short:(key||'—'));}
function _acctIsMoney(key){return !!_acctAccount(key);}
function _acctVendor(id){return acctVendors.find(v=>v._id===id)||null;}
// A bill with no vendor names who it was paid to (`payee`, free text); it
// reads through the same helper so the ledger, the category page and the
// Excel sheets show it where a vendor's name would sit.
function _acctVendorName(e){return e.vendorName||(_acctVendor(e.vendorId)||{}).name||e.payee||'';}
function _acctById(id){return acctEntries.find(e=>e._id===id)||null;}
function _acctUser(){return {by:(session&&(session.u||session.name))||'',byName:(session&&session.name)||''};}
function _acctIsPhone(){try{return window.matchMedia('(max-width:600px)').matches;}catch(_){return false;}}
// logActivity is async in the app but a plain recorder in the node harness —
// so the promise is guarded rather than chained, and a logging failure can
// never fail the entry it describes.
function _acctLog(action,detail){try{const p=logActivity(action,detail);if(p&&typeof p.catch==='function')p.catch(()=>{});}catch(_){}}

// ── Loading (never rejects; a refused read renders an error card) ──
async function _acctSafe(col,fn,fallback){
  try{return {col,ok:true,val:await fn()};}
  catch(e){console.error('[store-accounts] '+col,e);return {col,ok:false,err:e,val:fallback};}
}
async function _acctQueryRange(col,field,from){
  return _fsRunQuery(col,{from:[{collectionId:col}],
    where:{fieldFilter:{field:{fieldPath:field},op:'GREATER_THAN_OR_EQUAL',value:fsVal(from)}},
    orderBy:[{field:{fieldPath:field},direction:'ASCENDING'}],limit:5000});
}
async function loadAccountsData(force){
  if(_acctLoaded&&!force)return;
  if(_acctLoading)return _acctLoading;
  _acctLoading=(async()=>{
    _acctLoadErr=null;
    const [v,s,c]=await Promise.all([
      _acctSafe('acct_vendors',()=>fsList('acct_vendors',300),[]),
      _acctSafe('acct_settings',()=>fsList('acct_settings',10),[]),
      _acctSafe('acct_closes',()=>fsList('acct_closes',300),[])
    ]);
    acctVendors=v.val||[];
    acctSettings=(s.val||[]).find(d=>d._id==='main')||null;
    acctCloses=(c.val||[]).sort((a,b)=>String(a.month).localeCompare(String(b.month)));
    // Entries: everything after the latest close, or the whole ledger when
    // nothing has been closed yet (paged by fsList, never one body).
    const last=acctCloses.length?acctCloses[acctCloses.length-1].month:null;
    const e=await _acctSafe('acct_entries',()=>last?_acctQueryRange('acct_entries','month',_acctMonthAdd(last,1)):fsList('acct_entries',500),[]);
    acctEntries=(e.val||[]);
    _acctSort(acctEntries);
    const failed=[v,s,c,e].filter(r=>!r.ok);
    if(failed.length){
      _acctLoadErr={cols:failed.map(r=>r.col),quota:failed.some(r=>r.err&&(r.err.quota||/429/.test(String(r.err.message||''))))};
    }
    _acctLoaded=true;
    _acctLoading=null;
  })();
  return _acctLoading;
}
function _acctSort(list){list.sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.ts||0)-(a.ts||0));return list;}
async function _acctMeterLogs(vendorId,month,force){
  const key=vendorId+'|'+month;
  if(_acctMeterCache[key]&&!force)return _acctMeterCache[key];
  const rows=await _fsRunQuery('acct_meter_logs',{from:[{collectionId:'acct_meter_logs'}],
    where:{compositeFilter:{op:'AND',filters:[
      {fieldFilter:{field:{fieldPath:'vendorId'},op:'EQUAL',value:fsVal(vendorId)}},
      {fieldFilter:{field:{fieldPath:'month'},op:'EQUAL',value:fsVal(month)}}]}},limit:100});
  _acctMeterCache[key]=rows;
  return rows;
}

// ── The derivation engine ──
// An entry's effect on the two money accounts, the vendor's payable and a
// runner's float. ONE definition: the ledger table, both cash books, the
// vendor statement, the KPI tiles and the Excel exports all read this.
function _acctEffect(e){
  const fx={cash:0,mcb:0,payable:0,floatOut:0,floatUsed:0,floatBack:0,runnerPaid:0};
  if(!e||e.status==='void'||e.status==='pending')return fx;
  const a=Math.round(e.amount||0);
  const acc=e.account;
  switch(e.type){
    case 'purchase':
      if(e.source==='credit')fx.payable+=a;
      else if(e.source==='float')fx.floatUsed+=a;
      else if(_acctIsMoney(acc))fx[acc]-=a;
      break;
    // 'other' on a payment: the payable drops, no money account moves
    case 'payment':   if(_acctIsMoney(acc))fx[acc]-=a; fx.payable-=a; break;
    case 'cash_in':   if(_acctIsMoney(acc))fx[acc]+=a; break;
    case 'transfer':  if(_acctIsMoney(acc))fx[acc]-=a; if(_acctIsMoney(e.toAccount))fx[e.toAccount]+=a; break;
    case 'float_out': if(_acctIsMoney(acc))fx[acc]-=a; fx.floatOut+=a; break;
    case 'float_in':  if(_acctIsMoney(acc))fx[acc]+=a; fx.floatBack+=a; break;
    // paying a runner back what they spent over the float; 'other' settles it with no money movement
    case 'runner_pay':if(_acctIsMoney(acc))fx[acc]-=a; fx.runnerPaid+=a; break;
    case 'adjust':    if(_acctIsMoney(acc))fx[acc]+=Math.round(e.amount||0); break;   // signed
    case 'opening':   fx.payable+=a; break;
  }
  return fx;
}
function _acctLastClose(){return acctCloses.length?acctCloses[acctCloses.length-1]:null;}
// Posted entries. A closed month is already inside the checkpoint, so its
// entries are skipped unless a caller wants history (the rate card does).
function _acctLive(includeClosed){const cl=_acctLastClose();return acctEntries.filter(e=>e.status!=='void'&&e.status!=='pending'&&(includeClosed||!cl||e.month>cl.month));}
// Balances as of now (or up to and including `upToDate`), starting from the
// last close's checkpoint. Returns {cash,mcb,payables:{vendorId:amt},floats:{floatId:{...}}}.
function _acctBalances(upToDate){
  const cl=_acctLastClose();
  const b={cash:cl?(cl.cashBook||0):0,mcb:cl?(cl.mcbBook||0):0,payables:Object.assign({},cl&&cl.payables||{}),floats:{}};
  for(const e of _acctLive()){
    if(upToDate&&e.date>upToDate)continue;
    const fx=_acctEffect(e);
    b.cash+=fx.cash;b.mcb+=fx.mcb;
    if(e.vendorId&&fx.payable)b.payables[e.vendorId]=(b.payables[e.vendorId]||0)+fx.payable;
    if(e.type==='float_out'){const f=b.floats[e._id]=b.floats[e._id]||{id:e._id,person:e.person,date:e.date,category:e.category||'',out:0,used:0,back:0};f.out+=fx.floatOut;}
    if(e.floatId&&(fx.floatUsed||fx.floatBack)){const f=b.floats[e.floatId]=b.floats[e.floatId]||{id:e.floatId,person:e.person,date:e.date,out:0,used:0,back:0};f.used+=fx.floatUsed;f.back+=fx.floatBack;}
  }
  b.cash=Math.round(b.cash);b.mcb=Math.round(b.mcb);
  return b;
}
function _acctOpenFloats(){
  const b=_acctBalances();
  return Object.values(b.floats).map(f=>Object.assign({},f,{left:f.out-f.used-f.back})).filter(f=>f.left>0).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}
// What the store OWES each runner: every bill paid from a float beyond
// what the float held (Afnan, 24 Sept 2026: "it is a credit transaction
// until it is settled by anyone"), less what has since been settled with
// them (`runner_pay`). DERIVED like every other balance — nothing stored.
// An overspent float has left<0, so it is already closed to more bills;
// the excess lives here. Keyed by the runner's case-folded name; the
// display name is the float's own spelling.
function _acctRunnerOwed(upToDate){
  const b=_acctBalances(upToDate);
  const out={};
  const slot=(name)=>{const k=_acctRunnerKey(name);if(!k)return null;return out[k]=out[k]||{key:k,name,over:0,paid:0,owed:0};};
  for(const f of Object.values(b.floats)){
    const over=Math.max(0,f.used+f.back-f.out);
    if(over){const r=slot(f.person);if(r)r.over+=over;}
  }
  for(const e of _acctLive()){
    if(e.type!=='runner_pay')continue;
    if(upToDate&&e.date>upToDate)continue;
    const r=slot(e.person);if(r)r.paid+=Math.round(e.amount||0);
  }
  for(const r of Object.values(out))r.owed=Math.max(0,r.over-r.paid);
  return out;
}
function _acctRunnerOwedTo(name){const r=_acctRunnerOwed()[_acctRunnerKey(name)];return r?r.owed:0;}
function _acctTotalRunnerOwed(){return Object.values(_acctRunnerOwed()).reduce((s,r)=>s+r.owed,0);}
function _acctTotalPayables(){const b=_acctBalances();return Object.values(b.payables).reduce((s,v)=>s+Math.max(0,v),0);}
function _acctVendorBalance(vendorId){const b=_acctBalances();return Math.round(b.payables[vendorId]||0);}

// FIFO aging: payments settle the oldest credit purchases first. Returns the
// unpaid purchases with how much of each is still open, and the overdue total.
function _acctVendorAging(vendorId){
  const v=_acctVendor(vendorId);
  const mode=v&&v.terms&&v.terms.mode;
  const days=mode==='credit'?(parseInt(v.terms.creditDays)||0):(mode==='monthly'?30:(mode==='weekly'?7:0));
  const cl=_acctLastClose();
  const items=[];
  let opening=cl?(cl.payables&&cl.payables[vendorId]||0):0;
  if(opening>0)items.push({id:'__close',date:cl.month+'-01',amount:opening,open:opening,label:'Balance at '+_acctMonthLabel(cl.month)+' close'});
  let paid=0;
  for(const e of _acctLive().slice().reverse()){          // oldest first
    if(e.vendorId!==vendorId)continue;
    const fx=_acctEffect(e);
    if(fx.payable>0)items.push({id:e._id,date:e.date,amount:fx.payable,open:fx.payable,label:e.type==='opening'?'Opening balance':(e.ref?'Bill '+e.ref:'Purchase')});
    else if(fx.payable<0)paid+=-fx.payable;
  }
  for(const it of items){if(paid<=0)break;const take=Math.min(it.open,paid);it.open-=take;paid-=take;}
  const today=_acctToday();
  let overdue=0,oldest=null;
  for(const it of items){
    if(it.open<=0)continue;
    if(!oldest)oldest=it.date;
    if(days>0&&_acctDaysBetween(it.date,today)>days)overdue+=it.open;
  }
  const balance=items.reduce((s,i)=>s+i.open,0)-paid;   // negative = we overpaid
  return {balance:Math.round(balance),overdue:Math.round(overdue),oldest,creditDays:days,unpaid:items.filter(i=>i.open>0),advance:paid>0?Math.round(paid):0};
}
// Rate card: derived from this vendor's purchase lines (or every vendor's when
// vendorId is null). Keyed by item code, last purchase wins for `rate`.
function _acctRateCard(vendorId){
  const card={};
  for(const e of _acctLive(true).slice().reverse()){
    if(e.type!=='purchase'||(vendorId&&e.vendorId!==vendorId))continue;
    for(const l of (e.lines||[])){
      const k=l.itemCode||('~'+String(l.desc||'').trim().toLowerCase());
      if(!k||k==='~')continue;
      const c=card[k]=card[k]||{key:k,itemCode:l.itemCode||'',desc:l.desc||l.itemCode,unit:l.unit||'',n:0,min:null,max:null,rate:0,date:'',vendorId:e.vendorId,vendorName:_acctVendorName(e),qty:0};
      const r=Number(l.rate)||0;
      c.n++;c.qty+=Number(l.qty)||0;c.rate=r;c.date=e.date;c.vendorId=e.vendorId;c.vendorName=_acctVendorName(e);
      c.min=c.min==null?r:Math.min(c.min,r);c.max=c.max==null?r:Math.max(c.max,r);
    }
  }
  return Object.values(card).sort((a,b)=>String(a.desc).localeCompare(String(b.desc)));
}
// The latest rate paid for a store item — from this vendor if they have
// supplied it, else from anyone. Exposed so the Store's templates can read it.
function _acctLatestRate(itemCode,vendorId){
  if(!itemCode)return null;
  const own=vendorId?_acctRateCard(vendorId).find(c=>c.itemCode===itemCode):null;
  if(own)return {rate:own.rate,date:own.date,vendorName:own.vendorName};
  const any=_acctRateCard(null).find(c=>c.itemCode===itemCode);
  return any?{rate:any.rate,date:any.date,vendorName:any.vendorName}:null;
}
window.acctLatestRate=function(itemCode){const r=_acctLatestRate(itemCode);return r?r.rate:null;};

function _acctMonthClosed(month){return acctCloses.some(c=>c.month===month);}
function _acctPeriodBounds(){
  const p=_acctPeriod;const today=_acctToday();const mo=_acctThisMonth();
  if(p.preset==='month')return {from:mo+'-01',to:mo+'-31'};
  if(p.preset==='last')return {from:_acctMonthAdd(mo,-1)+'-01',to:_acctMonthAdd(mo,-1)+'-31'};
  if(p.preset==='3m')return {from:_acctMonthAdd(mo,-2)+'-01',to:today};
  if(p.preset==='year')return {from:today.slice(0,4)+'-01-01',to:today};
  if(p.preset==='custom')return {from:p.from||'0000-00-00',to:p.to||'9999-99-99'};
  return {from:'0000-00-00',to:'9999-99-99'};
}
function _acctPeriodLabel(){
  const p=_acctPeriod;
  if(p.preset==='month')return _acctMonthLabel(_acctThisMonth());
  if(p.preset==='last')return _acctMonthLabel(_acctMonthAdd(_acctThisMonth(),-1));
  if(p.preset==='3m')return 'Last 3 months';
  if(p.preset==='year')return 'This year';
  if(p.preset==='custom')return (p.from||'…')+' → '+(p.to||'…');
  return 'All time';
}
// Which entries a view shows. A "book" is one account's rows; payables is
// vendor credit movement only.
function _acctInView(e,view){
  const fx=_acctEffect(e);
  if(e.status==='void'){
    if(view==='all')return true;
    // a voided row still shows in its book, struck, so the log stays complete
    if(view==='cash')return e.account==='cash'||e.toAccount==='cash';
    if(view==='mcb')return e.account==='mcb'||e.toAccount==='mcb';
    if(view==='payables')return e.type==='purchase'&&e.source==='credit'||e.type==='payment'||e.type==='opening';
  }
  if(view==='all')return true;
  if(view==='cash')return fx.cash!==0||(e.status==='pending'&&e.account==='cash');
  if(view==='mcb')return fx.mcb!==0||(e.status==='pending'&&e.account==='mcb');
  if(view==='payables')return fx.payable!==0;
  return true;
}
function _acctParticulars(e){
  const vn=_acctVendorName(e);
  switch(e.type){
    case 'purchase':{
      const ls=e.lines||[];
      let s;
      if(e.expense)s=(ls[0]&&ls[0].desc)||'Expense';
      else if(ls.length===1)s=(ls[0].desc||ls[0].itemCode||'Purchase')+(ls[0].qty?' · '+ls[0].qty+' '+(ls[0].unit||'')+(ls[0].rate?' @ '+_acctPKR(ls[0].rate):''):'');
      else if(ls.length>1)s=ls.length+' items · '+ls.slice(0,2).map(l=>l.desc||l.itemCode).join(', ')+(ls.length>2?'…':'');
      else s='Purchase';
      if(e.meterKey)s=(e.lines&&e.lines[0]&&e.lines[0].desc)||'Monthly bill';
      return s;
    }
    case 'payment':   return 'Payment to '+(vn||'vendor');
    case 'cash_in':   return 'Cash in'+(e.via==='mcb'?' · MCB transfer':' · cash')+(e.person?' from '+e.person:'');
    case 'transfer':  return 'Transfer '+_acctAccountLabel(e.account)+' → '+_acctAccountLabel(e.toAccount);
    case 'float_out': return 'Float to '+(e.person||'runner')+(e.category?' · '+e.category:'')+(e.note?' · '+e.note:'');
    case 'float_in':  return 'Change back from '+(e.person||'runner');
    case 'runner_pay':return 'Settled with '+(e.person||'runner')+(e.note?' · '+e.note:'');
    case 'adjust':    return 'Adjustment · '+(e.note||'');
    case 'opening':   return 'Opening balance · '+vn;
  }
  return e.type;
}
function _acctSourceLabel(e){
  if((e.type==='payment'||e.type==='runner_pay')&&e.account===ACCT_OTHER.key)return ACCT_OTHER.label+' · '+ACCT_OTHER.sub;
  if(e.type!=='purchase')return e.account?_acctAccountLabel(e.account):'';
  if(e.source==='credit')return 'Credit';
  if(e.source==='float')return 'Float · '+(e.person||'');
  return _acctAccountLabel(e.account);
}
function _acctMatches(e,q){
  if(!q)return true;
  const hay=[_acctParticulars(e),_acctVendorName(e),e.person,e.ref,e.note,e.category,(e.lines||[]).map(l=>(l.desc||'')+' '+(l.itemCode||'')).join(' ')].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w=>hay.includes(w));
}
// The rows the ledger table shows for the current period/view/filters, with a
// running balance for a book view. Oldest → newest so the balance runs forward.
function _acctRows(){
  const {from,to}=_acctPeriodBounds();
  const view=_acctView;
  const rows=acctEntries.filter(e=>e.date>=from&&e.date<=to&&_acctInView(e,view)
    &&(!_acctFilter.type||e.type===_acctFilter.type)&&(!_acctFilter.vendor||e.vendorId===_acctFilter.vendor)&&_acctMatches(e,_acctFilter.q)).slice().reverse();
  let bal=null;
  if(view==='cash'||view==='mcb'){
    const before=_acctAddDays(from<'1900-01-01'?'1900-01-01':from,-1);
    bal=_acctBalances(before)[view];
  }else if(view==='payables'){
    bal=_acctFilter.vendor?Math.round(_acctBalances(_acctAddDays(from<'1900-01-01'?'1900-01-01':from,-1)).payables[_acctFilter.vendor]||0):null;
  }
  const opening=bal;
  const out=rows.map(e=>{
    const fx=_acctEffect(e);
    let inn=0,outv=0;
    if(view==='cash'||view==='mcb'){inn=Math.max(0,fx[view]);outv=Math.max(0,-fx[view]);if(bal!=null)bal+=fx[view];}
    else if(view==='payables'){inn=Math.max(0,fx.payable);outv=Math.max(0,-fx.payable);if(bal!=null)bal+=fx.payable;}
    return {e,fx,inn,out:outv,bal:bal==null?null:Math.round(bal)};
  });
  return {rows:out,opening,closing:bal==null?null:Math.round(bal)};
}

// ── Excel exports (vendored SheetJS; no CDN) ──
function _acctXlsx(sheets,fileBase){
  if(typeof XLSX==='undefined'){showToast('Excel library not loaded — reload and try again.',true);return false;}
  const wb=XLSX.utils.book_new();
  for(const [name,aoa] of sheets){
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols']=(aoa[0]||[]).map((_,i)=>({wch:Math.min(48,Math.max(10,...aoa.map(r=>String(r[i]==null?'':r[i]).length+2)))}));
    XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));
  }
  XLSX.writeFile(wb,fileBase+'.xlsx');
  return true;
}
function _acctBookRows(view,from,to){
  // A book for a date range, opening → rows → closing, as plain arrays.
  const list=acctEntries.filter(e=>e.date>=from&&e.date<=to&&e.status!=='pending'&&_acctInView(e,view)).slice().reverse();
  let bal=(view==='cash'||view==='mcb')?_acctBalances(_acctAddDays(from,-1))[view]:0;
  const head=['Date','Type','Particulars','Vendor / Person','Ref','Source','In (PKR)','Out (PKR)','Balance (PKR)','Entered by','Note','Status'];
  const rows=[head,[from,'','Opening balance','','','','','',bal,'','','']];
  let tin=0,tout=0;
  for(const e of list){
    const fx=_acctEffect(e);
    const d=(view==='payables')?fx.payable:fx[view];
    const inn=Math.max(0,d),out=Math.max(0,-d);
    if(e.status!=='void'){bal+=d;tin+=inn;tout+=out;}
    rows.push([e.date,ACCT_TYPES[e.type]?ACCT_TYPES[e.type].label:e.type,_acctParticulars(e),_acctVendorName(e)||e.person||'',e.ref||'',_acctSourceLabel(e),e.status==='void'?'':inn||'',e.status==='void'?'':out||'',e.status==='void'?'':Math.round(bal),e.byName||e.by||'',e.note||'',e.status==='void'?'VOID — '+(e.voidReason||''):'']);
  }
  rows.push([to,'','Closing balance','','','',tin,tout,Math.round(bal),'','','']);
  return rows;
}
function _acctAllRows(from,to){
  const head=['Date','Type','Particulars','Vendor / Person','Ref','Source','Cash ±','MCB ±','Credit ±','Amount','Category','Entered by','Note','Status','Photo'];
  const rows=[head];
  for(const e of acctEntries.filter(e=>e.date>=from&&e.date<=to).slice().reverse()){
    const fx=_acctEffect(e);
    rows.push([e.date,ACCT_TYPES[e.type]?ACCT_TYPES[e.type].label:e.type,_acctParticulars(e),_acctVendorName(e)||e.person||'',e.ref||'',_acctSourceLabel(e),fx.cash||'',fx.mcb||'',fx.payable||'',Math.round(e.amount||0),e.category||'',e.byName||e.by||'',e.note||'',e.status==='void'?'VOID — '+(e.voidReason||''):(e.status==='pending'?'PENDING':''),e.photo||'']);
  }
  return rows;
}
window.acctExportStatement=function(from,to){
  from=from||_acctPeriodBounds().from;to=to||_acctPeriodBounds().to;
  if(from<'1900-01-01')from=acctEntries.length?acctEntries[acctEntries.length-1].date:_acctToday();
  if(to>'9999-01-01')to=_acctToday();
  const b0=_acctBalances(_acctAddDays(from,-1)),b1=_acctBalances(to);
  const summary=[['Groovy Operations — Store Accounts statement'],['Period',from+' to '+to],['Generated',new Date().toLocaleString('en-PK')],['By',(session&&session.name)||''],[],
    ['Account','Opening','Closing'],['Cash in hand',b0.cash,b1.cash],['MCB Bank',b0.mcb,b1.mcb],['Vendor payables',Object.values(b0.payables).reduce((s,v)=>s+Math.max(0,v),0),Object.values(b1.payables).reduce((s,v)=>s+Math.max(0,v),0)],['Owed to runners',Object.values(_acctRunnerOwed(_acctAddDays(from,-1))).reduce((s,r)=>s+r.owed,0),Object.values(_acctRunnerOwed(to)).reduce((s,r)=>s+r.owed,0)],[],
    ['Payables by vendor as of '+to,'Balance']].concat(acctVendors.filter(v=>(b1.payables[v._id]||0)!==0).map(v=>[v.name,Math.round(b1.payables[v._id]||0)]));
  const ok=_acctXlsx([['Summary',summary],['Cash book',_acctBookRows('cash',from,to)],['MCB book',_acctBookRows('mcb',from,to)],['All entries',_acctAllRows(from,to)]],'Groovy-Cash-Statement-'+from+'_'+to);
  if(ok){showToast('Statement exported ✓');_acctLog('Cash statement exported',from+' → '+to);}
};
window.acctExportVendor=function(vendorId,from,to){
  const v=_acctVendor(vendorId);if(!v){showToast('Vendor not found.',true);return;}
  from=from||'0000-00-00';to=to||_acctToday();
  const list=acctEntries.filter(e=>e.vendorId===vendorId&&e.date>=from&&e.date<=to&&e.status!=='pending').slice().reverse();
  let bal=from>'0000-00-00'?Math.round(_acctBalances(_acctAddDays(from,-1)).payables[vendorId]||0):0;
  const rows=[['Date','Particulars','Ref','Source','Purchases (PKR)','Payments (PKR)','Balance owed (PKR)','Entered by','Note','Status'],[from>'0000-00-00'?from:'','Opening balance','','','','',bal,'','','']];
  for(const e of list){
    const fx=_acctEffect(e);
    const paidNow=e.type==='purchase'&&e.source!=='credit'?Math.round(e.amount||0):0;
    if(e.status!=='void')bal+=fx.payable;
    rows.push([e.date,_acctParticulars(e)+(paidNow?' (paid at purchase)':''),e.ref||'',_acctSourceLabel(e),e.status==='void'?'':(fx.payable>0?fx.payable:(paidNow||'')),e.status==='void'?'':(fx.payable<0?-fx.payable:(paidNow||'')),e.status==='void'?'':Math.round(bal),e.byName||e.by||'',e.note||'',e.status==='void'?'VOID — '+(e.voidReason||''):'']);
  }
  rows.push([to,'Closing balance owed','','','','',Math.round(bal),'','','']);
  const lines=[['Date','Item code','Description','Qty','Unit','Rate (PKR)','Total (PKR)','Ref','Paid via']];
  for(const e of list){if(e.type!=='purchase'||e.status==='void')continue;for(const l of (e.lines||[]))lines.push([e.date,l.itemCode||'',l.desc||'',l.qty,l.unit||'',l.rate,l.total,e.ref||'',_acctSourceLabel(e)]);}
  const card=[['Item code','Description','Unit','Last rate','Lowest','Highest','Purchases','Total qty','Last bought']].concat(_acctRateCard(vendorId).map(c=>[c.itemCode,c.desc,c.unit,c.rate,c.min,c.max,c.n,c.qty,c.date]));
  const t=v.terms||{};
  const profile=[['Vendor',v.name],['Supplies',(ACCT_VENDOR_KINDS.find(k=>k.key===v.kind)||{}).label||v.kind],['Terms',_acctTermsLabel(v)],['Contact person',v.contact&&v.contact.person||''],['Phone',v.contact&&v.contact.phone||''],['Address',v.contact&&v.contact.address||''],['Product types',(v.supplies||[]).join(', ')],['Balance owed as of '+_acctToday(),_acctVendorBalance(vendorId)],['Overdue',_acctVendorAging(vendorId).overdue],['Credit limit',t.creditLimit||''],['Notes',v.notes||'']];
  const ok=_acctXlsx([['Profile',profile],['Statement',rows],['Purchase lines',lines],['Rate card',card]],'Groovy-Vendor-'+safeId(v.name)+'-'+(from>'0000-00-00'?from+'_':'')+to);
  if(ok){showToast('Vendor statement exported ✓');_acctLog('Vendor statement exported',v.name);}
};
window.acctExportPayables=function(){
  const b=_acctBalances();
  const rows=[['Vendor','Terms','Balance owed (PKR)','Overdue (PKR)','Oldest unpaid','Phone']];
  for(const v of acctVendors.slice().sort((a,b)=>(b.name||'').localeCompare(a.name||''))){
    const ag=_acctVendorAging(v._id);
    if(!(b.payables[v._id]||0)&&!ag.overdue)continue;
    rows.push([v.name,_acctTermsLabel(v),Math.round(b.payables[v._id]||0),ag.overdue,ag.oldest||'',v.contact&&v.contact.phone||'']);
  }
  rows.push(['TOTAL','',_acctTotalPayables(),rows.slice(1).reduce((s,r)=>s+(r[3]||0),0),'','']);
  if(_acctXlsx([['Payables '+_acctToday(),rows]],'Groovy-Payables-'+_acctToday()))showToast('Payables exported ✓');
};
function _acctTermsLabel(v){
  const t=(v&&v.terms)||{};
  if(t.mode==='credit')return 'Credit · '+(t.creditDays||0)+' days'+(t.creditLimit?' · limit '+_acctPKR(t.creditLimit):'');
  if(t.mode==='monthly')return 'Monthly · bill day '+(t.billDay||'—')+(t.expectedAmount?' · ~'+_acctPKR(t.expectedAmount):'');
  if(t.mode==='weekly')return 'Weekly · every '+_acctDaysLabel(_acctBillDays(t))+(t.expectedAmount?' · ~'+_acctPKR(t.expectedAmount):'');
  return 'Cash on delivery';
}

/* ════════════════════════ PAGES ════════════════════════ */
// Every acct-* page routes through here — ONE line in js/shared.js.
function acctRenderPage(id,m){
  m=m||document.getElementById('main-content');
  if(!m)return;
  if(!_acctCanView()){m.innerHTML='<div class="empty" style="padding:40px">Access restricted.</div>';return;}
  if(!_acctLoaded){
    m.innerHTML=(typeof gvSkeleton==='function'?gvSkeleton(6):'<div class="empty">Loading…</div>');
    loadAccountsData().then(()=>{if(currentPage===id)acctRenderPage(id,m);});
    return;
  }
  // Store items are needed for the purchase form's item picker.
  if(typeof _storeDataLoaded==='function'&&!_storeDataLoaded()&&typeof loadStoreData==='function')loadStoreData().catch(()=>{});
  let h=_acctPageHead(id);
  if(_acctLoadErr)h+=_acctLoadErrorCard();
  if(id==='acct-ledger')h+=_acctLedgerPage();
  else if(id==='acct-vendors')h+=_acctVendorsPage();
  else if(id==='acct-vendor')h+=_acctVendorPage();
  else if(id==='acct-category')h+=_acctCategoryPage();
  else if(id==='acct-runner')h+=_acctRunnerPage();
  else if(id==='acct-consumables')h+=_acctConsumablesPage();
  else if(id==='acct-review')h+=_acctReviewPage();
  else h+='<div class="empty">Unknown accounts page.</div>';
  m.innerHTML=h;
  if(id==='acct-consumables')_acctConsAfterRender();
}
function _acctRerender(){const m=document.getElementById('main-content');if(m&&String(currentPage).startsWith('acct-'))acctRenderPage(currentPage,m);}
function _acctLoadErrorCard(){
  const e=_acctLoadErr;
  return `<div class="card" style="border-color:var(--accent-urgent);background:var(--accent-urgent-soft)">
    <div style="font-weight:700;color:var(--accent-urgent);margin-bottom:4px">Some accounts data could not be read</div>
    <div style="font-size:13px;color:var(--text);line-height:1.5">Failed: <code>${_acctEsc(e.cols.join(', '))}</code>. ${e.quota?'The Firestore read quota or rate limit is exhausted — check Firebase Console → Usage.':'If this is a permission error, check that the published <code>firestore.rules</code> match the repo (the <code>acct_*</code> collections need their match blocks).'} Figures below may be incomplete.</div>
    <button class="btn-outline" style="margin-top:10px" onclick="window.acctReload()">Retry</button>
  </div>`;
}
window.acctReload=function(){_acctLoaded=false;_acctMeterCache={};_acctRerender();};
window.acctGo=function(id){_acctPage=0;window.showPage(id);};

function _acctPageHead(id){
  const tabs=[['acct-ledger','Ledger'],['acct-vendors','Vendors'],['acct-consumables','Consumables']];
  if(_acctCanAdmin())tabs.push(['acct-review','Review & close']);
  const active=(id==='acct-vendor'||id==='acct-category'||id==='acct-runner')?'acct-vendors':id;
  const b=_acctBalances();
  const review=_acctCanAdmin()?acctEntries.filter(e=>e.needsReview&&!e.reviewedAt&&e.status!=='void').length:0;
  return `<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <div><div class="page-title">Store Accounts</div>
      <div style="font-size:13px;color:var(--muted);margin-top:2px">Cash ${_acctPKR(b.cash)} · MCB ${_acctPKR(b.mcb)} · Payables ${_acctPKR(_acctTotalPayables())}${review?` · <span style="color:var(--accent-urgent);font-weight:700">${review} to review</span>`:''}</div></div>
    ${_acctCanEntry()?`<div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-primary" style="width:auto;margin:0;padding:10px 16px" onclick="window.acctNewMenu()">+ New entry</button>
    </div>`:''}
  </div>
  <div class="gp-tabs" style="max-width:560px">${tabs.map(t=>`<button class="gp-tab${active===t[0]?' active':''}" onclick="window.acctGo('${t[0]}')">${t[1]}</button>`).join('')}</div>`;
}

// ── KPI tiles: uniform, tokens only ──
function _acctTile(label,value,opts){
  opts=opts||{};
  const danger=!!opts.danger;
  return `<div class="acct-tile${danger?' danger':''}"${opts.onclick?` onclick="${opts.onclick}" style="cursor:pointer"`:''}>
    <div class="acct-tile-l">${label}</div>
    <div class="acct-tile-v">${typeof value==='number'?_acctPKR(value):value}</div>
    ${opts.sub?`<div class="acct-tile-s">${opts.sub}</div>`:''}
  </div>`;
}

/* ── LEDGER ── */
function _acctLedgerPage(){
  const b=_acctBalances();
  const floats=_acctOpenFloats();
  const floatSum=floats.reduce((s,f)=>s+f.left,0);
  const runnerOwed=_acctTotalRunnerOwed();
  const payables=_acctTotalPayables();
  const overdue=acctVendors.reduce((s,v)=>s+_acctVendorAging(v._id).overdue,0);
  const {rows,opening,closing}=_acctRows();
  const vendorsWithRows=acctVendors.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  let h=`<div class="acct-tiles">
    ${_acctTile('Cash in hand',b.cash,{danger:b.cash<0,onclick:"window.acctSetView('cash')"})}
    ${_acctTile('MCB Bank',b.mcb,{danger:b.mcb<0,onclick:"window.acctSetView('mcb')"})}
    ${_acctTile('Owed to vendors',payables,{danger:overdue>0,sub:(overdue>0?_acctPKR(overdue)+' overdue':(payables?'nothing overdue':''))+(payables?' · pay day '+(_acctIsPayDay(_acctToday())?'today':_ACCT_WEEKDAYS[_acctWeekdayOf(_acctNextPayDay(_acctToday()))].slice(0,3)+' '+_acctDateLabel(_acctNextPayDay(_acctToday()))):''),onclick:"window.acctSetView('payables')"})}
    ${_acctTile('With runners',floatSum,{danger:floats.some(f=>_acctDaysBetween(f.date,_acctToday())>_acctSettings().floatRedDays),sub:(floats.length?floats.length+' open float'+(floats.length>1?'s':''):'no open floats')+(runnerOwed?' · owed to runners '+_acctPKR(runnerOwed):''),onclick:"window.acctSetFilter('type','float_out')"})}
  </div>`;
  h+=_acctAlerts(floats);
  const views=[['all','All entries'],['cash','Cash book'],['mcb','MCB book'],['payables','Payables']];
  h+=`<div class="card" style="padding:0;overflow:hidden">
    <div class="acct-toolbar">
      <div class="gp-tabs" style="margin:0;max-width:460px;flex:1 1 300px">${views.map(v=>`<button class="gp-tab${_acctView===v[0]?' active':''}" onclick="window.acctSetView('${v[0]}')">${v[1]}</button>`).join('')}</div>
      <select class="acct-sel" onchange="window.acctSetPeriod(this.value)">
        ${[['month','This month'],['last','Last month'],['3m','Last 3 months'],['year','This year'],['all','All time'],['custom','Custom range…']].map(o=>`<option value="${o[0]}"${_acctPeriod.preset===o[0]?' selected':''}>${o[1]}</option>`).join('')}
      </select>
      ${_acctPeriod.preset==='custom'?`<input type="date" class="acct-sel" value="${_acctEsc(_acctPeriod.from)}" onchange="window.acctSetRange('from',this.value)"><input type="date" class="acct-sel" value="${_acctEsc(_acctPeriod.to)}" onchange="window.acctSetRange('to',this.value)">`:''}
      <select class="acct-sel" onchange="window.acctSetFilter('type',this.value)">
        <option value="">All types</option>${Object.entries(ACCT_TYPES).filter(t=>t[0]!=='opening').map(t=>`<option value="${t[0]}"${_acctFilter.type===t[0]?' selected':''}>${t[1].label}</option>`).join('')}
      </select>
      <select class="acct-sel" onchange="window.acctSetFilter('vendor',this.value)">
        <option value="">All vendors</option>${vendorsWithRows.map(v=>`<option value="${v._id}"${_acctFilter.vendor===v._id?' selected':''}>${_acctEsc(v.name)}</option>`).join('')}
      </select>
      <input id="acct-q" class="acct-sel" placeholder="Search particulars, ref, note" value="${_acctEsc(_acctFilter.q)}" oninput="window.acctSearch(this.value)">
      <button class="btn-outline" onclick="window.acctExportPrompt()">⬇ Excel</button>
    </div>
    ${_acctLedgerTable(rows,opening,closing)}
  </div>`;
  return h;
}
function _acctAlerts(floats){
  const s=_acctSettings();const today=_acctToday();const mo=_acctThisMonth();
  const items=[];
  // Pay day: what is owed across every vendor, so the drawer can be planned.
  if(_acctIsPayDay(today)){
    const pay=_acctBalances().payables||{};let owed=0,n=0,over=0;
    for(const v of acctVendors){const b=Math.round(pay[v._id]||0);if(b>0){owed+=b;n++;over+=_acctVendorAging(v._id).overdue||0;}}
    items.push(owed>0
      ?{k:over>0?'urgent':'warn',t:`<b>Pay day</b> (${_ACCT_WEEKDAYS[_acctWeekdayOf(today)]}) — ${_acctPKR(owed)} owed to ${n} vendor${n===1?'':'s'}${over>0?` · ${_acctPKR(over)} overdue`:''}`,go:"window.acctGo('acct-vendors')"}
      :{k:'info',t:`<b>Pay day</b> (${_ACCT_WEEKDAYS[_acctWeekdayOf(today)]}) — nothing owed to any vendor`,go:"window.acctGo('acct-vendors')"});
  }
  for(const v of acctVendors){
    const ag=_acctVendorAging(v._id);
    if(ag.overdue>0)items.push({k:'urgent',t:`<b>${_acctEsc(v.name)}</b> — ${_acctPKR(ag.overdue)} overdue (${ag.creditDays}-day terms, oldest bill ${_acctDateLabel(ag.oldest)})`,go:`window.acctOpenVendor('${v._id}')`});
    if(v.terms&&v.terms.mode==='monthly'&&v.active!==false){
      const billed=acctEntries.some(e=>e.vendorId===v._id&&e.type==='purchase'&&e.month===mo&&e.status!=='void');
      const day=parseInt(v.terms.billDay)||1;
      if(!billed&&parseInt(today.slice(8))>=day)items.push({k:'warn',t:`<b>${_acctEsc(v.name)}</b> — monthly bill not recorded yet for ${_acctMonthLabel(mo)} (due day ${day})`,go:`window.acctOpenVendor('${v._id}')`});
    }
    if(v.terms&&v.terms.mode==='weekly'&&v.active!==false){
      // The bill is due on the most recent occurrence of its weekday; it is
      // "recorded" once a purchase from that day onward exists.
      const days=_acctBillDays(v.terms);const due=days.map(d=>_acctLastWeekday(today,d)).sort().pop();
      const billed=acctEntries.some(e=>e.vendorId===v._id&&e.type==='purchase'&&e.date>=due&&e.date<=today&&e.status!=='void');
      if(!billed)items.push({k:'warn',t:`<b>${_acctEsc(v.name)}</b> — weekly bill not recorded yet for ${_acctDateLabel(due)} (every ${_acctDaysLabel(days)})`,go:`window.acctOpenVendor('${v._id}')`});
    }
    if(v.kind==='consumable'&&v.active!==false){
      const billed=acctEntries.some(e=>e.meterKey===v._id+'_'+_acctMonthAdd(mo,-1)&&e.status!=='void');
      if(!billed&&acctEntries.length)items.push({k:'info',t:`<b>${_acctEsc(v.name)}</b> — ${_acctMonthLabel(_acctMonthAdd(mo,-1))} bill not generated from the daily log`,go:`window.acctOpenConsumable('${v._id}','${_acctMonthAdd(mo,-1)}')`});
    }
  }
  for(const f of floats){
    const age=_acctDaysBetween(f.date,today);
    if(age>=s.floatWarnDays)items.push({k:age>=s.floatRedDays?'urgent':'warn',t:`<b>${_acctEsc(f.person)}</b> holds ${_acctPKR(f.left)} of a float from ${_acctDateLabel(f.date)} — ${age} day${age===1?'':'s'}`,go:`window.acctOpenEntry('${f.id}')`});
  }
  // A runner who paid more than the float out of their own pocket is owed
  // the difference until someone settles it.
  for(const r of Object.values(_acctRunnerOwed())){
    if(r.owed>0)items.push({k:'warn',t:`<b>${_acctEsc(r.name)}</b> is owed ${_acctPKR(r.owed)} — bills over the float, not yet settled`,go:`window.acctOpenRunner(${JSON.stringify(r.name).replace(/"/g,'&quot;')})`});
  }
  for(const e of acctEntries){
    if(e.status==='pending'&&_acctCanEntry())items.push({k:'warn',t:`Cash in of ${_acctPKR(e.amount)} (${e.via==='mcb'?'MCB transfer':'cash'}) recorded by ${_acctEsc(e.byName||e.by)} — <b>confirm you received it</b>`,go:`window.acctOpenEntry('${e._id}')`});
    if(e.stockPosted===false&&e.status!=='void')items.push({k:'urgent',t:`Purchase ${_acctDateLabel(e.date)} ${_acctEsc(_acctVendorName(e))} — <b>stock was not posted to inventory</b>${e.stockError?' ('+_acctEsc(e.stockError)+')':''}`,go:`window.acctOpenEntry('${e._id}')`});
  }
  if(!items.length)return '';
  return `<div class="acct-alerts">${items.slice(0,8).map(i=>`<div class="acct-alert ${i.k}" onclick="${i.go}">${i.t}</div>`).join('')}${items.length>8?`<div class="acct-alert info">+${items.length-8} more</div>`:''}</div>`;
}
function _acctLedgerTable(rows,opening,closing){
  const book=_acctView==='cash'||_acctView==='mcb'||_acctView==='payables';
  const total=rows.length;
  const pages=Math.max(1,Math.ceil(total/ACCT_PAGE_SIZE));
  if(_acctPage>=pages)_acctPage=pages-1;
  // Newest first on screen; the running balance was computed oldest→newest.
  const shown=rows.slice().reverse().slice(_acctPage*ACCT_PAGE_SIZE,(_acctPage+1)*ACCT_PAGE_SIZE);
  const tin=rows.reduce((s,r)=>s+(r.e.status==='void'?0:r.inn),0),tout=rows.reduce((s,r)=>s+(r.e.status==='void'?0:r.out),0);
  const cols=_acctView==='payables'?['Date','Particulars','Vendor / person','Ref','Source','Purchases','Payments','Balance owed','']
    :book?['Date','Particulars','Vendor / person','Ref','Source','In','Out','Balance','']
    :['Date','Particulars','Vendor / person','Ref','Source','Cash','MCB','Credit','Amount',''];
  let h=`<div class="acct-table-wrap"><table class="acct-table">
    <thead><tr>${cols.map((c,i)=>`<th${i>=5?' class="num"':''}>${c}</th>`).join('')}</tr></thead><tbody>`;
  if(!shown.length)h+=`<tr><td colspan="${cols.length}" class="empty" style="padding:32px">No entries for ${_acctEsc(_acctPeriodLabel())}${_acctFilter.q||_acctFilter.type||_acctFilter.vendor?' with these filters':''}.</td></tr>`;
  for(const r of shown){
    const e=r.e;const fx=r.fx;
    const cls=[e.status==='void'?'void':'',e.status==='pending'?'pending':'',e.needsReview&&!e.reviewedAt&&e.status!=='void'?'review':''].filter(Boolean).join(' ');
    const flags=[e.photo?'<span title="Receipt attached">📎</span>':'',e.status==='pending'?'<span class="acct-chip warn">pending</span>':'',e.status==='void'?'<span class="acct-chip">void</span>':'',e.needsReview&&!e.reviewedAt&&e.status!=='void'?'<span class="acct-chip urgent">review</span>':'',e.stockPosted===false?'<span class="acct-chip urgent">stock!</span>':'',e.stockPosted===true?'<span class="acct-chip ok">stock ✓</span>':''].filter(Boolean).join(' ');
    const type=`<span class="acct-type">${ACCT_TYPES[e.type]?ACCT_TYPES[e.type].label:e.type}</span>`;
    const who=_acctVendorName(e)||e.person||'';
    const cells=book
      ?`<td class="num in">${r.inn?_acctPKR(r.inn):''}</td><td class="num out">${r.out?_acctPKR(r.out):''}</td><td class="num bal">${r.bal!=null&&e.status!=='void'?_acctPKR(r.bal):''}</td>`
      :`<td class="num ${fx.cash>0?'in':fx.cash<0?'out':''}">${_acctSigned(fx.cash)}</td><td class="num ${fx.mcb>0?'in':fx.mcb<0?'out':''}">${_acctSigned(fx.mcb)}</td><td class="num ${fx.payable>0?'out':fx.payable<0?'in':''}">${_acctSigned(fx.payable)}</td><td class="num bal">${_acctPKR(e.amount)}</td>`;
    h+=`<tr class="${cls}" onclick="window.acctOpenEntry('${e._id}')">
      <td class="date">${_acctDateLabel(e.date)}</td>
      <td class="part">${type} ${_acctEsc(_acctParticulars(e))}</td>
      <td>${_acctEsc(who)}</td>
      <td class="ref">${_acctEsc(e.ref||'')}</td>
      <td>${_acctEsc(_acctSourceLabel(e))}</td>
      ${cells}
      <td class="flags">${flags}</td>
    </tr>`;
  }
  h+=`</tbody>`;
  if(book){
    h+=`<tfoot><tr><td colspan="5">Opening ${_acctEsc(_acctPeriodLabel())}</td><td></td><td></td><td class="num bal">${opening!=null?_acctPKR(opening):'—'}</td><td></td></tr>
      <tr class="tot"><td colspan="5">Period totals · ${total} entr${total===1?'y':'ies'}</td><td class="num in">${_acctPKR(tin)}</td><td class="num out">${_acctPKR(tout)}</td><td class="num bal">${closing!=null?_acctPKR(closing):'—'}</td><td></td></tr></tfoot>`;
  }else{
    const sums=rows.reduce((s,r)=>{if(r.e.status!=='void'){s.cash+=r.fx.cash;s.mcb+=r.fx.mcb;s.pay+=r.fx.payable;}return s;},{cash:0,mcb:0,pay:0});
    h+=`<tfoot><tr class="tot"><td colspan="5">Period net · ${total} entr${total===1?'y':'ies'}</td><td class="num">${_acctSigned(sums.cash)||'—'}</td><td class="num">${_acctSigned(sums.mcb)||'—'}</td><td class="num">${_acctSigned(sums.pay)||'—'}</td><td></td><td></td></tr></tfoot>`;
  }
  h+=`</table></div>`;
  if(pages>1)h+=`<div class="acct-pager"><button class="btn-outline" ${_acctPage===0?'disabled':''} onclick="window.acctPageNav(${_acctPage-1})">← Newer</button><span>Page ${_acctPage+1} / ${pages}</span><button class="btn-outline" ${_acctPage>=pages-1?'disabled':''} onclick="window.acctPageNav(${_acctPage+1})">Older →</button></div>`;
  return h;
}
window.acctSetView=function(v){_acctView=v;_acctPage=0;_acctRerender();};
window.acctSetPeriod=function(p){_acctPeriod.preset=p;_acctPage=0;if(p==='custom'&&!_acctPeriod.from){_acctPeriod.from=_acctThisMonth()+'-01';_acctPeriod.to=_acctToday();}_acctRerender();};
window.acctSetRange=function(k,v){_acctPeriod[k]=v;_acctPage=0;_acctRerender();};
window.acctSetFilter=function(k,v){_acctFilter[k]=v;_acctPage=0;if(k==='type'&&v&&String(currentPage)!=='acct-ledger')window.showPage('acct-ledger');else _acctRerender();};
window.acctPageNav=function(n){_acctPage=n;_acctRerender();};
// Debounced + refocus-after-rerender, the fabInvSetSearch pattern.
window.acctSearch=function(v){
  _acctFilter.q=v||'';_acctPage=0;
  clearTimeout(window._acctSearchTo);
  window._acctSearchTo=setTimeout(()=>{_acctRerender();const i=document.getElementById('acct-q');if(i){i.focus();try{i.setSelectionRange(i.value.length,i.value.length);}catch(_){}}},180);
};

/* ── VENDORS ── */
function _acctVendorsPage(){
  const b=_acctBalances();
  const list=acctVendors.slice().sort((x,y)=>(b.payables[y._id]||0)-(b.payables[x._id]||0)||(x.name||'').localeCompare(y.name||''));
  let h=`<div class="card" style="padding:0;overflow:hidden">
    <div class="acct-toolbar">
      <div style="font-weight:700;flex:1">${list.length} vendor${list.length===1?'':'s'} · owed ${_acctPKR(_acctTotalPayables())}</div>
      <button class="btn-outline" onclick="window.acctExportPayables()">⬇ Payables</button>
      ${_acctCanEntry()?`<button class="btn-primary" style="width:auto;margin:0;padding:9px 14px" onclick="window.acctVendorWizard()">+ New vendor</button>`:''}
    </div>
    <div class="acct-table-wrap"><table class="acct-table">
      <thead><tr><th>Vendor</th><th>Supplies</th><th>Terms</th><th>Contact</th><th class="num">Balance owed</th><th class="num">Overdue</th><th class="num">Last purchase</th></tr></thead><tbody>`;
  if(!list.length)h+=`<tr><td colspan="7" class="empty" style="padding:32px">No vendors yet. Create the first one — the wizard asks how you pay them and sets the profile up to match.</td></tr>`;
  for(const v of list){
    const ag=_acctVendorAging(v._id);
    const last=acctEntries.find(e=>e.vendorId===v._id&&e.type==='purchase'&&e.status!=='void');
    h+=`<tr onclick="window.acctOpenVendor('${v._id}')"${v.active===false?' class="void"':''}>
      <td class="part"><b>${_acctEsc(v.name)}</b>${v.active===false?' <span class="acct-chip">inactive</span>':''}</td>
      <td>${_acctEsc((ACCT_VENDOR_KINDS.find(k=>k.key===v.kind)||{}).label||'')}${v.kind==='consumable'&&v.meter?` · ${_acctEsc(v.meter.label||v.meter.unit)} @ ${_acctPKR(v.meter.rate)}`:''}</td>
      <td>${_acctEsc(_acctTermsLabel(v))}</td>
      <td>${_acctEsc(v.contact&&v.contact.person||'')}${v.contact&&v.contact.phone?` · ${_acctEsc(v.contact.phone)}`:''}</td>
      <td class="num ${(b.payables[v._id]||0)>0?'out':''}">${_acctPKR(b.payables[v._id]||0)}</td>
      <td class="num ${ag.overdue>0?'out':''}">${ag.overdue?_acctPKR(ag.overdue):'—'}</td>
      <td class="num">${last?_acctDateLabel(last.date):'—'}</td>
    </tr>`;
  }
  h+=`</tbody></table></div></div>`;
  h+=_acctRunnersCard();
  h+=_acctCategoriesCard();
  return h;
}
// ── Runners — everyone who takes a float, each with their own log ──
// Afnan (24 Sept 2026): "there can be more then 1 runner so log created by
// name of other runner as well such as ABBAS". The list is DERIVED — the
// settings' runners ∪ every name a float was ever given to — so typing a
// new name on the float form IS how a runner is added; nothing has to be
// written to settings (whose runners field only owners may write). A
// runner's log is every float given to them, every bill paid from one of
// those floats and every change-back, matched by name (case-folded) and
// by the float the bill was paid from.
function _acctRunnerKey(n){return String(n||'').trim().toLowerCase();}
function _acctRunners(){
  const out=[];const seen=new Set();
  const add=n=>{n=String(n||'').trim();if(!n)return;const k=n.toLowerCase();if(seen.has(k))return;seen.add(k);out.push(n);};
  (_acctSettings().runners||[]).forEach(add);
  // newest first, so the spelling last used is the one shown; a voided float names nobody
  (acctEntries||[]).forEach(e=>{if(e&&e.type==='float_out'&&e.status!=='void')add(e.person);});
  return out;
}
function _acctRunnerEntries(name){
  const k=_acctRunnerKey(name);if(!k)return [];
  const live=acctEntries.filter(e=>e&&e.status!=='void'&&e.status!=='pending');
  const floatIds=new Set(live.filter(e=>e.type==='float_out'&&_acctRunnerKey(e.person)===k).map(e=>e._id));
  return live.filter(e=>((e.type==='float_out'||e.type==='runner_pay')&&_acctRunnerKey(e.person)===k)||(e.floatId&&floatIds.has(e.floatId)));
}
function _acctRunnerStats(){
  const open=_acctOpenFloats();
  return _acctRunners().map(name=>{
    const rows=_acctRunnerEntries(name);
    const given=rows.filter(e=>e.type==='float_out').reduce((s,e)=>s+Math.round(e.amount||0),0);
    const spent=rows.filter(e=>e.type==='purchase').reduce((s,e)=>s+Math.round(e.amount||0),0);
    const back=rows.filter(e=>e.type==='float_in').reduce((s,e)=>s+Math.round(e.amount||0),0);
    const k=_acctRunnerKey(name);
    const openLeft=open.filter(f=>_acctRunnerKey(f.person)===k).reduce((s,f)=>s+f.left,0);
    const last=rows.filter(e=>e.type==='float_out').reduce((m,e)=>(!m||e.date>m)?e.date:m,'');
    const owed=_acctRunnerOwedTo(name);
    return {name,count:rows.length,given,spent,back,openLeft,owed,last};
  }).sort((a,b)=>b.openLeft-a.openLeft||b.owed-a.owed||b.given-a.given||a.name.localeCompare(b.name));
}
function _acctRunnersCard(){
  const stats=_acctRunnerStats();
  let h=`<div class="card" style="padding:0;overflow:hidden">
    <div class="acct-toolbar">
      <div style="flex:1"><div style="font-weight:700">${stats.length} runner${stats.length===1?'':'s'}</div><div style="font-size:13px;color:var(--muted)">Everyone who takes a float, each with their own log. A new runner is added by typing their name on the float form.</div></div>
    </div>
    <div class="acct-table-wrap"><table class="acct-table">
      <thead><tr><th>Runner</th><th class="num">Floats given</th><th class="num">Spent on bills</th><th class="num">Change back</th><th class="num">Still to account for</th><th class="num">Owed to runner</th><th class="num">Last float</th></tr></thead><tbody>`;
  for(const r of stats){
    h+=`<tr data-r="${_acctEsc(r.name)}" onclick="window.acctOpenRunner(this.dataset.r)">
      <td class="part"><b>${_acctEsc(r.name)}</b></td>
      <td class="num">${r.given?_acctPKR(r.given):'—'}</td>
      <td class="num">${r.spent?_acctPKR(r.spent):'—'}</td>
      <td class="num">${r.back?_acctPKR(r.back):'—'}</td>
      <td class="num ${r.openLeft>0?'out':''}">${r.openLeft>0?_acctPKR(r.openLeft):'—'}</td>
      <td class="num ${r.owed>0?'out':''}">${r.owed>0?_acctPKR(r.owed):'—'}</td>
      <td class="num">${r.last?_acctDateLabel(r.last):'—'}</td>
    </tr>`;
  }
  h+=`</tbody></table></div></div>`;
  return h;
}
window.acctOpenRunner=function(name){
  name=String(name||'').trim();if(!name)return;
  _acctRunnerId=name;_acctPage=0;window.showPage('acct-runner');
};
function _acctRunnerPage(){
  const name=_acctRunners().find(r=>_acctRunnerKey(r)===_acctRunnerKey(_acctRunnerId))||'';
  if(!name)return `<div class="card"><div class="empty">Runner not found. <button class="btn-outline" onclick="window.acctGo('acct-vendors')">Back to vendors</button></div></div>`;
  const rows=_acctRunnerEntries(name).sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.ts||0)-(a.ts||0));
  const st=_acctRunnerStats().find(r=>r.name===name)||{given:0,spent:0,back:0,openLeft:0,owed:0};
  const cl=_acctLastClose();
  let h=`<div class="card">
    <button class="btn-outline" style="padding:4px 10px;font-size:12px;margin-bottom:8px" onclick="window.acctGo('acct-vendors')">← Vendors</button>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div><div style="font-size:19px;font-weight:800">${_acctEsc(name)}</div><div style="font-size:13px;color:var(--muted)">Runner · every float given, every bill paid from one and every change back${cl?` · since the ${_acctMonthLabel(cl.month)} close`:''}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${_acctCanEntry()&&st.owed>0?`<button class="btn-outline" onclick="window.acctForm('runner_pay',{person:${JSON.stringify(name).replace(/"/g,'&quot;')}})">Settle ${_acctPKR(st.owed)}</button>`:''}
        ${_acctCanEntry()?`<button class="btn-primary" style="width:auto;margin:0;padding:9px 14px" onclick="window.acctForm('float_out',{person:${JSON.stringify(name).replace(/"/g,'&quot;')}})">Give a float</button>`:''}
      </div>
    </div>
    <div class="acct-tiles" style="margin-top:12px">
      ${_acctTile('Floats given',st.given)}
      ${_acctTile('Spent on bills',st.spent)}
      ${_acctTile('Change back',st.back)}
      ${_acctTile('Still to account for',st.openLeft,{danger:st.openLeft>0})}
      ${_acctTile('Owed to runner',st.owed,{danger:st.owed>0,sub:st.owed>0?'spent over the float — settle it':'nothing over the float'})}
    </div>
  </div>`;
  h+=`<div class="card" style="padding:0;overflow:hidden"><div class="acct-table-wrap"><table class="acct-table">
    <thead><tr><th>Date</th><th>Particulars</th><th>Category</th><th>Vendor</th><th class="num">Amount</th></tr></thead><tbody>`;
  if(!rows.length)h+=`<tr><td colspan="5" class="empty" style="padding:28px">No floats given to ${_acctEsc(name)} yet.</td></tr>`;
  for(const e of rows){
    const type=`<span class="acct-type">${_acctEsc(ACCT_TYPES[e.type]?ACCT_TYPES[e.type].label:e.type)}</span>`;
    h+=`<tr onclick="window.acctOpenEntry('${e._id}')">
      <td class="date">${_acctDateLabel(e.date)}</td>
      <td class="part">${type} ${_acctEsc(_acctParticulars(e))}</td>
      <td>${_acctEsc(e.category||'')}</td>
      <td>${_acctEsc(_acctVendorName(e))}</td>
      <td class="num ${e.type==='float_out'||e.type==='runner_pay'?'out':''}">${_acctPKR(e.amount)}</td>
    </tr>`;
  }
  h+=`</tbody></table></div></div>`;
  return h;
}

// ── Categories — what money is spent ON, beside WHO it is paid to ──
// Afnan (24 Sept 2026): a runner is sent for many purposes (fuel for round
// trips, maintenance work, small items), so a float carries a category,
// and the Vendors tab lists every category with everything recorded under
// it. The list is DERIVED (_acctCategories: settings ∪ in use) and the
// figures are derived from the entries — nothing is stored per category.
function _acctCategoryKey(c){return String(c||'').trim().toLowerCase();}
function _acctCategoryEntries(cat){
  const k=_acctCategoryKey(cat);if(!k)return [];
  return acctEntries.filter(e=>e&&e.status!=='void'&&e.status!=='pending'&&(e.type==='purchase'||e.type==='float_out')&&_acctCategoryKey(e.category)===k);
}
function _acctCategoryStats(){
  return _acctCategories().map(name=>{
    const rows=_acctCategoryEntries(name);
    const spent=rows.filter(e=>e.type==='purchase').reduce((s,e)=>s+Math.round(e.amount||0),0);
    const floats=rows.filter(e=>e.type==='float_out').reduce((s,e)=>s+Math.round(e.amount||0),0);
    const last=rows.reduce((m,e)=>(!m||e.date>m)?e.date:m,'');
    return {name,count:rows.length,spent,floats,last};
  }).sort((a,b)=>(b.spent+b.floats)-(a.spent+a.floats)||a.name.localeCompare(b.name));
}
function _acctCategoriesCard(){
  const stats=_acctCategoryStats();
  let h=`<div class="card" style="padding:0;overflow:hidden">
    <div class="acct-toolbar">
      <div style="flex:1"><div style="font-weight:700">${stats.length} categor${stats.length===1?'y':'ies'}</div><div style="font-size:13px;color:var(--muted)">What the money was spent on — purchases and runner floats by purpose. Open one to see every entry under it.</div></div>
      ${_acctCanEntry()?`<button class="btn-outline" onclick="window.acctCategoryNew()">+ New category</button>`:''}
    </div>
    <div class="acct-table-wrap"><table class="acct-table">
      <thead><tr><th>Category</th><th class="num">Entries</th><th class="num">Spent (purchases)</th><th class="num">Floats given</th><th class="num">Last entry</th></tr></thead><tbody>`;
  for(const c of stats){
    h+=`<tr data-c="${_acctEsc(c.name)}" onclick="window.acctOpenCategory(this.dataset.c)">
      <td class="part"><b>${_acctEsc(c.name)}</b></td>
      <td class="num">${c.count||'—'}</td>
      <td class="num">${c.spent?_acctPKR(c.spent):'—'}</td>
      <td class="num">${c.floats?_acctPKR(c.floats):'—'}</td>
      <td class="num">${c.last?_acctDateLabel(c.last):'—'}</td>
    </tr>`;
  }
  h+=`</tbody></table></div></div>`;
  return h;
}
window.acctOpenCategory=function(name){
  name=String(name||'').trim();if(!name)return;
  _acctCategoryId=name;_acctPage=0;window.showPage('acct-category');
};
window.acctCategoryNew=function(){
  if(!_acctCanEntry())return;
  const name=String(prompt('New category name (what money gets spent on — e.g. Fuel, Small items)')||'').trim();
  if(!name)return;
  const have=_acctCategories().find(c=>c.toLowerCase()===name.toLowerCase());
  if(have){showToast(`"${have}" is already on the list.`);return;}
  _acctAddCategory(name);
  showToast(`Category "${name}" added.`);
  _acctRerender();
};
function _acctCategoryPage(){
  const name=_acctCategories().find(c=>_acctCategoryKey(c)===_acctCategoryKey(_acctCategoryId))||_acctCategoryId;
  const rows=_acctCategoryEntries(name);
  if(!name||(!rows.length&&!_acctCategories().some(c=>_acctCategoryKey(c)===_acctCategoryKey(name))))return `<div class="card"><div class="empty">Category not found. <button class="btn-outline" onclick="window.acctGo('acct-vendors')">Back to vendors</button></div></div>`;
  rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.ts||0)-(a.ts||0));
  const spent=rows.filter(e=>e.type==='purchase').reduce((s,e)=>s+Math.round(e.amount||0),0);
  const floats=rows.filter(e=>e.type==='float_out').reduce((s,e)=>s+Math.round(e.amount||0),0);
  const cl=_acctLastClose();
  let h=`<div class="card">
    <button class="btn-outline" style="padding:4px 10px;font-size:12px;margin-bottom:8px" onclick="window.acctGo('acct-vendors')">← Vendors</button>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div><div style="font-size:19px;font-weight:800">${_acctEsc(name)}</div><div style="font-size:13px;color:var(--muted)">Category · every purchase and runner float recorded under it${cl?` · since the ${_acctMonthLabel(cl.month)} close`:''}</div></div>
    </div>
    <div class="acct-tiles" style="margin-top:12px">
      ${_acctTile('Spent on purchases',spent)}
      ${_acctTile('Floats given',floats)}
      ${_acctTile('Entries',rows.length)}
    </div>
  </div>`;
  h+=`<div class="card" style="padding:0;overflow:hidden"><div class="acct-table-wrap"><table class="acct-table">
    <thead><tr><th>Date</th><th>Particulars</th><th>Vendor / person</th><th>Source</th><th class="num">Amount</th></tr></thead><tbody>`;
  if(!rows.length)h+=`<tr><td colspan="5" class="empty" style="padding:28px">Nothing recorded under this category yet. A purchase's Category, or a float's, puts it here.</td></tr>`;
  for(const e of rows){
    const type=`<span class="acct-type">${_acctEsc(ACCT_TYPES[e.type]?ACCT_TYPES[e.type].label:e.type)}</span>`;
    h+=`<tr onclick="window.acctOpenEntry('${e._id}')">
      <td class="date">${_acctDateLabel(e.date)}</td>
      <td class="part">${type} ${_acctEsc(_acctParticulars(e))}</td>
      <td>${_acctEsc(_acctVendorName(e)||e.person||'')}</td>
      <td>${_acctEsc(_acctSourceLabel(e))}</td>
      <td class="num">${_acctPKR(e.amount)}</td>
    </tr>`;
  }
  if(rows.length)h+=`<tr class="tot"><td colspan="4">Total</td><td class="num"><b>${_acctPKR(spent+floats)}</b></td></tr>`;
  h+=`</tbody></table></div></div>`;
  return h;
}
window.acctOpenVendor=function(id){_acctVendorId=id;_acctVendorTab='statement';_acctVendorRange={from:'',to:''};window.showPage('acct-vendor');};
function _acctVendorPage(){
  const v=_acctVendor(_acctVendorId);
  if(!v)return `<div class="card"><div class="empty">Vendor not found. <button class="btn-outline" onclick="window.acctGo('acct-vendors')">Back to vendors</button></div></div>`;
  const ag=_acctVendorAging(v._id);const bal=_acctVendorBalance(v._id);
  const kind=(ACCT_VENDOR_KINDS.find(k=>k.key===v.kind)||{}).label||v.kind;
  let h=`<div class="card">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="min-width:0">
        <button class="btn-outline" style="padding:4px 10px;font-size:12px;margin-bottom:8px" onclick="window.acctGo('acct-vendors')">← Vendors</button>
        <div style="font-size:21px;font-weight:800;line-height:1.2">${_acctEsc(v.name)}${v.active===false?' <span class="acct-chip">inactive</span>':''}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px">${_acctEsc(kind)} · ${_acctEsc(_acctTermsLabel(v))}${v.kind==='consumable'&&v.meter?` · ${_acctEsc(v.meter.type==='weighed'?'weighed':'counted')} in ${_acctEsc(v.meter.unit)} @ ${_acctPKR(v.meter.rate)}`:''}${_acctVendorBalance(v._id)>0?` · next pay day ${_acctIsPayDay(_acctToday())?'<b>today</b>':_acctEsc(_ACCT_WEEKDAYS[_acctWeekdayOf(_acctNextPayDay(_acctToday()))]+' '+_acctDateLabel(_acctNextPayDay(_acctToday())))}`:''}</div>
        <div style="font-size:13px;margin-top:6px">${v.contact&&v.contact.person?_acctEsc(v.contact.person)+' · ':''}${v.contact&&v.contact.phone?`<a href="tel:${_acctEsc(v.contact.phone)}" style="color:var(--text)">${_acctEsc(v.contact.phone)}</a>`:''}${v.contact&&v.contact.address?` · ${_acctEsc(v.contact.address)}`:''}</div>
        ${(v.supplies||[]).length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${v.supplies.map(s=>`<span class="acct-chip">${_acctEsc(s)}</span>`).join('')}</div>`:''}
        ${v.notes?`<div style="font-size:13px;color:var(--muted);margin-top:6px">${_acctEsc(v.notes)}</div>`:''}
      </div>
      <div class="acct-tiles" style="margin:0;flex:0 1 380px">
        ${_acctTile('Balance owed',bal,{danger:bal>0&&ag.overdue>0})}
        ${_acctTile('Overdue',ag.overdue,{danger:ag.overdue>0,sub:ag.oldest?'oldest bill '+_acctDateLabel(ag.oldest):''})}
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      ${_acctCanEntry()?`<button class="btn-primary" style="width:auto;margin:0;padding:9px 14px" onclick="window.acctForm('purchase',{vendorId:'${v._id}'})">Record purchase</button>
      ${bal>0?`<button class="btn-outline" onclick="window.acctForm('payment',{vendorId:'${v._id}'})">Pay ${_acctPKR(bal)}</button>`:`<button class="btn-outline" onclick="window.acctForm('payment',{vendorId:'${v._id}'})">Pay vendor</button>`}
      <button class="btn-outline" onclick="window.acctVendorWizard('${v._id}')">Edit profile</button>`:''}
      ${v.kind==='consumable'?`<button class="btn-outline" onclick="window.acctOpenConsumable('${v._id}')">Daily log</button>`:''}
      <button class="btn-outline" onclick="window.acctExportVendor('${v._id}',_acctVendorRange.from,_acctVendorRange.to)">⬇ Excel</button>
      ${_acctCanAdmin()?`<button class="btn-outline" onclick="window.acctVendorToggleActive('${v._id}')">${v.active===false?'Reactivate':'Deactivate'}</button>`:''}
      ${_acctIsSuper()?`<button class="btn-outline acct-super" style="color:var(--accent-urgent);border-color:var(--accent-urgent)" onclick="window.acctVendorDelete('${v._id}')">Delete vendor…</button>`:''}
    </div>
  </div>`;
  const tabs=[['statement','Statement'],['rates','Rate card'],['aging','Unpaid bills']];
  h+=`<div class="card" style="padding:0;overflow:hidden">
    <div class="acct-toolbar">
      <div class="gp-tabs" style="margin:0;max-width:360px;flex:1 1 240px">${tabs.map(t=>`<button class="gp-tab${_acctVendorTab===t[0]?' active':''}" onclick="window.acctVendorTab('${t[0]}')">${t[1]}</button>`).join('')}</div>
      ${_acctVendorTab==='statement'?`<input type="date" class="acct-sel" value="${_acctEsc(_acctVendorRange.from)}" onchange="window.acctVendorRange('from',this.value)"><input type="date" class="acct-sel" value="${_acctEsc(_acctVendorRange.to)}" onchange="window.acctVendorRange('to',this.value)">`:''}
    </div>`;
  if(_acctVendorTab==='statement')h+=_acctVendorStatement(v);
  else if(_acctVendorTab==='rates')h+=_acctVendorRates(v);
  else h+=_acctVendorAgingTable(v,ag);
  h+=`</div>`;
  return h;
}
window.acctVendorTab=function(t){_acctVendorTab=t;_acctRerender();};
window.acctVendorRange=function(k,v){_acctVendorRange[k]=v;_acctRerender();};
function _acctVendorStatement(v){
  const from=_acctVendorRange.from||'0000-00-00',to=_acctVendorRange.to||'9999-99-99';
  const list=acctEntries.filter(e=>e.vendorId===v._id&&e.date>=from&&e.date<=to).slice().reverse();
  let bal=from>'0000-00-00'?Math.round(_acctBalances(_acctAddDays(from,-1)).payables[v._id]||0):(_acctLastClose()?Math.round((_acctLastClose().payables||{})[v._id]||0):0);
  const opening=bal;
  const rows=list.map(e=>{const fx=_acctEffect(e);if(e.status!=='void')bal+=fx.payable;return {e,fx,bal};});
  let h=`<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th>Paid via</th><th class="num">Purchases</th><th class="num">Payments</th><th class="num">Balance owed</th><th></th></tr></thead><tbody>
    <tr class="tot"><td colspan="6">Opening balance</td><td class="num bal">${_acctPKR(opening)}</td><td></td></tr>`;
  if(!rows.length)h+=`<tr><td colspan="8" class="empty" style="padding:28px">No transactions with this vendor${from>'0000-00-00'?' in this range':''}.</td></tr>`;
  for(const r of rows.slice().reverse()){
    const e=r.e,fx=r.fx;const paidNow=e.type==='purchase'&&e.source!=='credit';
    h+=`<tr class="${e.status==='void'?'void':''}" onclick="window.acctOpenEntry('${e._id}')">
      <td class="date">${_acctDateLabel(e.date)}</td><td class="part">${_acctEsc(_acctParticulars(e))}${paidNow?' <span class="acct-chip ok">paid at purchase</span>':''}</td><td class="ref">${_acctEsc(e.ref||'')}</td><td>${_acctEsc(_acctSourceLabel(e))}</td>
      <td class="num out">${fx.payable>0?_acctPKR(fx.payable):(paidNow?'<span style="color:var(--muted)">'+_acctPKR(e.amount)+'</span>':'')}</td>
      <td class="num in">${fx.payable<0?_acctPKR(-fx.payable):(paidNow?'<span style="color:var(--muted)">'+_acctPKR(e.amount)+'</span>':'')}</td>
      <td class="num bal">${e.status==='void'?'':_acctPKR(r.bal)}</td><td class="flags">${e.photo?'📎':''}${e.status==='void'?'<span class="acct-chip">void</span>':''}</td></tr>`;
  }
  h+=`</tbody><tfoot><tr class="tot"><td colspan="6">Closing balance</td><td class="num bal">${_acctPKR(bal)}</td><td></td></tr></tfoot></table></div>`;
  return h;
}
function _acctVendorRates(v){
  const card=_acctRateCard(v._id);
  let h=`<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Item</th><th>Code</th><th>Unit</th><th class="num">Last rate</th><th class="num">Lowest</th><th class="num">Highest</th><th class="num">Bought</th><th class="num">Total qty</th><th class="num">Last bought</th></tr></thead><tbody>`;
  if(!card.length)h+=`<tr><td colspan="9" class="empty" style="padding:28px">No purchase lines yet. Rates appear here automatically from every purchase recorded against this vendor.</td></tr>`;
  for(const c of card){
    const cur=c.rate,trend=c.n>1&&c.min!==c.max?(cur>=c.max?'<span class="acct-chip urgent">highest</span>':cur<=c.min?'<span class="acct-chip ok">lowest</span>':''):'';
    h+=`<tr><td class="part"><b>${_acctEsc(c.desc)}</b></td><td class="ref">${_acctEsc(c.itemCode)}</td><td>${_acctEsc(c.unit)}</td><td class="num bal">${_acctPKR(c.rate)} ${trend}</td><td class="num">${_acctPKR(c.min)}</td><td class="num">${_acctPKR(c.max)}</td><td class="num">${c.n}×</td><td class="num">${c.qty}</td><td class="num">${_acctDateLabel(c.date)}</td></tr>`;
  }
  h+=`</tbody></table></div>`;
  return h;
}
function _acctVendorAgingTable(v,ag){
  const today=_acctToday();
  let h=`<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Bill date</th><th>Particulars</th><th class="num">Bill</th><th class="num">Still open</th><th class="num">Age</th><th>Due</th></tr></thead><tbody>`;
  if(!ag.unpaid.length)h+=`<tr><td colspan="6" class="empty" style="padding:28px">Nothing unpaid${ag.advance?' — in fact '+_acctPKR(ag.advance)+' has been paid in advance':''}.</td></tr>`;
  for(const it of ag.unpaid){
    const age=_acctDaysBetween(it.date,today);const over=ag.creditDays>0&&age>ag.creditDays;
    h+=`<tr${it.id&&it.id!=='__close'?` onclick="window.acctOpenEntry('${it.id}')"`:''}><td class="date">${_acctDateLabel(it.date)}</td><td class="part">${_acctEsc(it.label)}</td><td class="num">${_acctPKR(it.amount)}</td><td class="num out">${_acctPKR(it.open)}</td><td class="num ${over?'out':''}">${age}d</td><td>${ag.creditDays>0?(over?`<span class="acct-chip urgent">overdue ${age-ag.creditDays}d</span>`:_acctDateLabel(_acctAddDays(it.date,ag.creditDays))):'—'}</td></tr>`;
  }
  h+=`</tbody></table></div>`;
  return h;
}
window.acctVendorToggleActive=async function(id){
  const v=_acctVendor(id);if(!v)return;
  const on=v.active===false;
  if(!confirm(on?`Reactivate ${v.name}?`:`Deactivate ${v.name}? Their history stays; they just stop appearing in pickers and alerts.`))return;
  const upd=Object.assign({},v,{active:on,updatedAt:Date.now()});delete upd._id;
  try{await fsSet('acct_vendors',id,upd);Object.assign(v,upd);showToast(on?'Vendor reactivated ✓':'Vendor deactivated ✓');_acctRerender();}
  catch(e){showToast('Save failed: '+e.message,true);}
};

/* ── CONSUMABLES (daily meter logs) ── */
window.acctOpenConsumable=function(vendorId,month){_acctConsVendor=vendorId||_acctConsVendor;_acctConsMonth=month||_acctConsMonth||_acctThisMonth();window.showPage('acct-consumables');};
function _acctConsumablesPage(){
  const vendors=acctVendors.filter(v=>v.kind==='consumable'&&v.active!==false);
  if(!vendors.length)return `<div class="card"><div class="empty" style="padding:32px">No daily-consumable vendors yet.<br><span style="font-size:13px">Create a vendor and answer <b>“Daily consumable”</b> to the “what do they supply” question — the wizard then asks whether it is counted (bottles) or weighed (gas, kg) and at what rate.</span>${_acctCanEntry()?`<div style="margin-top:12px"><button class="btn-primary" style="width:auto;margin:0;padding:9px 14px" onclick="window.acctVendorWizard(null,'consumable')">+ New consumable vendor</button></div>`:''}</div></div>`;
  if(!_acctConsVendor||!vendors.some(v=>v._id===_acctConsVendor))_acctConsVendor=vendors[0]._id;
  if(!_acctConsMonth)_acctConsMonth=_acctThisMonth();
  const v=_acctVendor(_acctConsVendor);const m=v.meter||{type:'count',unit:'unit',rate:0};
  const key=v._id+'_'+_acctConsMonth;
  const bill=acctEntries.find(e=>e.meterKey===key&&e.status!=='void');
  let h=`<div class="card" style="padding:0;overflow:hidden">
    <div class="acct-toolbar">
      <div class="gp-tabs" style="margin:0;flex:1 1 240px;max-width:520px">${vendors.map(x=>`<button class="gp-tab${x._id===_acctConsVendor?' active':''}" onclick="window.acctOpenConsumable('${x._id}')">${_acctEsc(x.name)}</button>`).join('')}</div>
      <button class="btn-outline" onclick="window.acctOpenConsumable(null,'${_acctMonthAdd(_acctConsMonth,-1)}')">‹</button>
      <div style="font-weight:700;min-width:140px;text-align:center">${_acctMonthLabel(_acctConsMonth)}</div>
      <button class="btn-outline" onclick="window.acctOpenConsumable(null,'${_acctMonthAdd(_acctConsMonth,1)}')" ${_acctConsMonth>=_acctThisMonth()?'disabled':''}>›</button>
    </div>
    <div style="padding:12px 16px;font-size:13px;color:var(--muted)">${m.type==='weighed'
      ?`<b>${_acctEsc(v.name)}</b> is <b>weighed</b>: enter the ${_acctEsc(m.unit)} delivered each day and the ${_acctEsc(m.unit)} still in the cylinder you handed back. Net = delivered − returned, billed at <b>${_acctPKR(m.rate)} / ${_acctEsc(m.unit)}</b>.`
      :`<b>${_acctEsc(v.name)}</b> is <b>counted</b>: enter how many ${_acctEsc(m.unit)}s came in each day. Billed at <b>${_acctPKR(m.rate)} / ${_acctEsc(m.unit)}</b>.`}
      ${_acctMonthClosed(_acctConsMonth)?' <span class="acct-chip">month closed</span>':''}</div>
    <div id="acct-cons-grid"><div class="empty">Loading daily log…</div></div>
    <div id="acct-cons-foot" data-bill="${bill?bill._id:''}"></div>
  </div>`;
  return h;
}
function _acctConsAfterRender(){
  const v=_acctVendor(_acctConsVendor);if(!v)return;
  const month=_acctConsMonth;
  _acctMeterLogs(v._id,month).then(logs=>{
    if(currentPage!=='acct-consumables'||_acctConsVendor!==v._id||_acctConsMonth!==month)return;
    const grid=document.getElementById('acct-cons-grid');if(grid)grid.innerHTML=_acctConsGrid(v,month,logs);
    const foot=document.getElementById('acct-cons-foot');if(foot)foot.innerHTML=_acctConsFoot(v,month,logs);
  }).catch(e=>{const grid=document.getElementById('acct-cons-grid');if(grid)grid.innerHTML=`<div class="card" style="margin:12px;border-color:var(--accent-urgent)"><b>Could not read the daily log</b><div style="font-size:13px;color:var(--muted)">${_acctEsc(e.message||e)}</div><button class="btn-outline" style="margin-top:8px" onclick="window.acctOpenConsumable()">Retry</button></div>`;});
}
function _acctConsNet(m,l){const q=Number(l.qty)||0;return m.type==='weighed'?Math.max(0,q-(Number(l.residual)||0)):q;}
function _acctConsGrid(v,month,logs){
  const m=v.meter||{};const weighed=m.type==='weighed';
  const byDate={};for(const l of logs)byDate[l.date]=l;
  const days=_acctDaysInMonth(month);const today=_acctToday();
  const can=_acctCanEntry()&&!_acctMonthClosed(month);
  let h=`<div class="acct-table-wrap"><table class="acct-table cons"><thead><tr><th>Day</th><th class="num">${weighed?'Delivered ('+_acctEsc(m.unit)+')':'Received ('+_acctEsc(m.unit)+'s)'}</th>${weighed?`<th class="num">Returned in cylinder (${_acctEsc(m.unit)})</th><th class="num">Net used</th>`:''}<th class="num">Amount</th><th>Logged by</th><th>Note</th></tr></thead><tbody>`;
  let tot=0,totAmt=0;
  for(let d=1;d<=days;d++){
    const date=month+'-'+_acctPad(d);
    if(date>today)break;
    const l=byDate[date]||{};const net=_acctConsNet(m,l);const rate=l.rate!=null?l.rate:(m.rate||0);const amt=Math.round(net*rate);
    tot+=net;totAmt+=amt;
    const dt=new Date(date+'T00:00:00');const wd=dt.toLocaleDateString('en-PK',{weekday:'short'});
    const inp=(f,val)=>can?`<input type="number" inputmode="decimal" min="0" step="any" class="acct-cons-in" data-date="${date}" data-f="${f}" value="${val!=null&&val!==''?val:''}" placeholder="—" onchange="window.acctConsSave('${v._id}','${date}')">`:`${val!=null&&val!==''?val:'—'}`;
    h+=`<tr class="${date===today?'today':''}"><td class="date"><b>${d}</b> <span style="color:var(--muted)">${wd}</span></td><td class="num">${inp('qty',l.qty)}</td>${weighed?`<td class="num">${inp('residual',l.residual)}</td><td class="num">${l.qty!=null?net:''}</td>`:''}<td class="num">${l.qty!=null?_acctPKR(amt):''}</td><td>${_acctEsc(l.byName||'')}</td><td>${can?`<input class="acct-cons-in note" data-date="${date}" data-f="note" value="${_acctEsc(l.note||'')}" placeholder="" onchange="window.acctConsSave('${v._id}','${date}')">`:_acctEsc(l.note||'')}</td></tr>`;
  }
  h+=`</tbody><tfoot><tr class="tot"><td>Month total</td><td class="num"></td>${weighed?`<td class="num"></td><td class="num">${tot}</td>`:''}<td class="num bal">${_acctPKR(totAmt)}</td><td colspan="2">${tot} ${_acctEsc(m.unit)}${weighed?'':'s'} × ${_acctPKR(m.rate)}</td></tr></tfoot></table></div>`;
  return h;
}
function _acctConsFoot(v,month,logs){
  const m=v.meter||{};
  const tot=logs.reduce((s,l)=>s+_acctConsNet(m,l),0);
  const amt=logs.reduce((s,l)=>s+Math.round(_acctConsNet(m,l)*(l.rate!=null?l.rate:(m.rate||0))),0);
  const key=v._id+'_'+month;
  const bill=acctEntries.find(e=>e.meterKey===key&&e.status!=='void');
  if(bill){
    const diff=bill.vendorBillAmount!=null?Math.round(bill.vendorBillAmount)-Math.round(bill.amount):null;
    return `<div style="padding:14px 16px;border-top:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap;align-items:center">
      <div><div class="acct-tile-l">Bill generated</div><div style="font-weight:700">${_acctPKR(bill.amount)} · ${_acctDateLabel(bill.date)} <span class="acct-chip ok">on account</span></div></div>
      <div><div class="acct-tile-l">Vendor's bill</div><div style="font-weight:700">${bill.vendorBillAmount!=null?_acctPKR(bill.vendorBillAmount):'not entered'}${diff!=null?(diff===0?' <span class="acct-chip ok">matches ✓</span>':` <span class="acct-chip urgent">${diff>0?'vendor bills '+_acctPKR(diff)+' MORE':'vendor bills '+_acctPKR(-diff)+' LESS'}</span>`):''}</div></div>
      <button class="btn-outline" onclick="window.acctOpenEntry('${bill._id}')">Open bill</button>
      ${_acctCanEntry()?`<button class="btn-outline" onclick="window.acctConsCompare('${bill._id}')">Enter vendor's bill amount</button>`:''}
      <button class="btn-outline" onclick="window.acctConsPdf('${v._id}','${month}')">Print log (PDF)</button>
    </div>`;
  }
  const can=_acctCanEntry()&&!_acctMonthClosed(month)&&logs.length;
  return `<div style="padding:14px 16px;border-top:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap;align-items:center">
    <div><div class="acct-tile-l">Expected bill for ${_acctMonthLabel(month)}</div><div style="font-weight:700">${tot} ${_acctEsc(m.unit)}${m.type==='weighed'?'':'s'} × ${_acctPKR(m.rate)} = ${_acctPKR(amt)}</div></div>
    ${can?`<button class="btn-primary" style="width:auto;margin:0;padding:9px 14px" onclick="window.acctConsGenerate('${v._id}','${month}')">Generate bill → on ${_acctEsc(v.name)}'s account</button>`:`<span style="font-size:13px;color:var(--muted)">${logs.length?'':'Log at least one day first.'}</span>`}
    ${logs.length?`<button class="btn-outline" onclick="window.acctConsPdf('${v._id}','${month}')">Print log (PDF)</button>`:''}
  </div>`;
}
window.acctConsSave=async function(vendorId,date){
  const v=_acctVendor(vendorId);if(!v)return;
  const m=v.meter||{};
  const get=f=>{const i=document.querySelector(`.acct-cons-in[data-date="${date}"][data-f="${f}"]`);return i?i.value:'';};
  const qty=get('qty'),residual=get('residual'),note=get('note');
  const id=vendorId+'_'+date;
  const key=vendorId+'|'+_acctMonthOf(date);
  const logs=_acctMeterCache[key]||[];
  const prev=logs.find(l=>l._id===id);
  if(qty===''&&residual===''&&!note){ if(!prev)return; }
  const doc={vendorId,date,month:_acctMonthOf(date),qty:qty===''?null:Number(qty),residual:m.type==='weighed'?(residual===''?null:Number(residual)):null,rate:m.rate||0,note:note||'',ts:Date.now(),by:_acctUser().by,byName:_acctUser().byName};
  doc.net=_acctConsNet(m,doc);
  try{
    await fsSet('acct_meter_logs',id,doc);
    const i=logs.findIndex(l=>l._id===id);
    if(i>=0)logs[i]=Object.assign({},doc,{_id:id});else logs.push(Object.assign({},doc,{_id:id}));
    _acctMeterCache[key]=logs;
    const grid=document.getElementById('acct-cons-grid');
    // repaint totals only — the row the caret is in must not be rebuilt under it
    const foot=document.getElementById('acct-cons-foot');if(foot)foot.innerHTML=_acctConsFoot(v,_acctMonthOf(date),logs);
    if(grid){const tf=grid.querySelector('tfoot');if(tf){const tmp=document.createElement('div');tmp.innerHTML=_acctConsGrid(v,_acctMonthOf(date),logs);const nf=tmp.querySelector('tfoot');if(nf)tf.innerHTML=nf.innerHTML;const row=grid.querySelector(`.acct-cons-in[data-date="${date}"]`);const nrow=tmp.querySelector(`.acct-cons-in[data-date="${date}"]`);if(row&&nrow){const tr=row.closest('tr'),ntr=nrow.closest('tr');if(tr&&ntr){const cells=tr.querySelectorAll('td'),ncells=ntr.querySelectorAll('td');cells.forEach((c,ix)=>{if(!c.querySelector('input')&&ncells[ix])c.innerHTML=ncells[ix].innerHTML;});}}}}
  }catch(e){showToast('Could not save the day: '+e.message,true);}
};
window.acctConsGenerate=async function(vendorId,month){
  const v=_acctVendor(vendorId);if(!v)return;
  const m=v.meter||{};
  const logs=await _acctMeterLogs(vendorId,month,true);
  const tot=logs.reduce((s,l)=>s+_acctConsNet(m,l),0);
  const amt=logs.reduce((s,l)=>s+Math.round(_acctConsNet(m,l)*(l.rate!=null?l.rate:(m.rate||0))),0);
  const key=vendorId+'_'+month;
  if(acctEntries.some(e=>e.meterKey===key&&e.status!=='void')){showToast('A bill for this month already exists.',true);return;}
  if(!amt){showToast('Nothing to bill — the log is empty.',true);return;}
  if(!confirm(`Generate ${_acctMonthLabel(month)} bill for ${v.name}?\n\n${tot} ${m.unit}${m.type==='weighed'?'':'s'} × ${_acctPKR(m.rate)} = ${_acctPKR(amt)}\n\nIt goes on their account as a credit purchase; pay it from the vendor page.`))return;
  const days=logs.filter(l=>l.qty!=null).length;
  const entry=Object.assign(_acctBase('purchase'),{vendorId,vendorName:v.name,source:'credit',account:null,amount:amt,date:month+'-'+_acctPad(Math.min(_acctDaysInMonth(month),parseInt(_acctToday().slice(8))||28)),month:month>_acctThisMonth()?month:(month===_acctThisMonth()?month:month),lines:[{itemCode:'',desc:`${v.name} · ${_acctMonthLabel(month)} · ${days} day${days===1?'':'s'} logged`,qty:tot,unit:m.unit,rate:m.rate||0,total:amt}],category:'Utilities',ref:'',note:'Generated from the daily log',meterKey:key,vendorBillAmount:null});
  entry.date=month===_acctThisMonth()?_acctToday():month+'-'+_acctPad(_acctDaysInMonth(month));entry.month=_acctMonthOf(entry.date);
  if(_acctMonthClosed(entry.month)){showToast('That month is closed — the bill would land in a closed month.',true);return;}
  const row=await _acctWrite(entry);
  if(row){showToast('Bill generated ✓ — now enter the vendor\'s own bill amount to compare');_acctRerender();}
};
window.acctConsCompare=async function(entryId){
  const e=_acctById(entryId);if(!e)return;
  const v=prompt(`Amount on ${_acctVendorName(e)}'s own bill (₨)? Ours is ${_acctPKR(e.amount)}.`,e.vendorBillAmount!=null?String(e.vendorBillAmount):'');
  if(v==null)return;
  const n=parseInt(String(v).replace(/[^0-9]/g,''));if(isNaN(n)){showToast('Enter a number.',true);return;}
  const ok=await _acctPatch(entryId,{vendorBillAmount:n});
  if(ok){showToast(n===Math.round(e.amount)?'Matches our log ✓':'Recorded — variance '+_acctPKR(n-Math.round(e.amount)));_acctRerender();}
};

// ── The month's log as a PDF (Afnan, 23 Sept 2026: "after a bill is logged
// … there should be a logic to print PDF with log as well — what happened
// on each day + total billing"). Every day up to today, logged or not, the
// month total, and the bill as it stands on the account. Pure builder so
// the numbers are asserted here; the drawing is the print engine's
// `consumable-log` variant (the standing rule: no new print feature calls
// jsPDF directly). The month key on a bill is `<vendorId>_<YYYY-MM>`, and a
// vendor id may itself carry an underscore, so the month is the LAST seven
// characters, never a split on '_'.
function _acctConsPdfData(v,month,logs){
  const m=v.meter||{type:'count',unit:'unit',rate:0};const weighed=m.type==='weighed';
  const byDate={};for(const l of logs||[])byDate[l.date]=l;
  const today=_acctToday();const days=_acctDaysInMonth(month);
  const rows=[];let totalQty=0,totalAmount=0,daysLogged=0;
  for(let d=1;d<=days;d++){
    const date=month+'-'+_acctPad(d);if(date>today)break;
    const l=byDate[date]||{};const logged=l.qty!=null&&l.qty!=='';
    const net=logged?_acctConsNet(m,l):0;const rate=l.rate!=null?l.rate:(m.rate||0);const amount=logged?Math.round(net*rate):0;
    if(logged){totalQty+=net;totalAmount+=amount;daysLogged++;}
    rows.push({day:d,weekday:new Date(date+'T00:00:00').toLocaleDateString('en-PK',{weekday:'short'}),date,qty:logged?l.qty:null,residual:logged?(l.residual||0):null,net,amount,byName:l.byName||'',note:l.note||''});
  }
  const bill=acctEntries.find(e=>e.meterKey===v._id+'_'+month&&e.status!=='void')||null;
  return {vendorName:v.name,month,monthLabel:_acctMonthLabel(month),unit:m.unit||'unit',weighed,rate:m.rate||0,rows,totalQty,totalAmount,daysLogged,
    bill:bill?{amount:bill.amount,date:_acctDateLabel(bill.date),vendorBillAmount:bill.vendorBillAmount!=null?bill.vendorBillAmount:null,variance:bill.vendorBillAmount!=null?Math.round(bill.vendorBillAmount)-Math.round(bill.amount):0}:null,
    issuedBy:_acctUser().byName,urduLevel:'none'};
}
window.acctConsPdf=async function(vendorId,month){
  const v=_acctVendor(vendorId);if(!v){showToast('Vendor not found.',true);return;}
  if(!month&&typeof vendorId==='string')month=_acctConsMonth||_acctThisMonth();
  if(typeof window.printDocument!=='function'){showToast('The print engine is not loaded — reload the app and try again.',true);return;}
  let logs;
  try{logs=await _acctMeterLogs(vendorId,month);}catch(e){showToast('Could not read the daily log: '+(e.message||e),true);return;}
  const data=_acctConsPdfData(v,month,logs);
  const safe=String(v.name||'vendor').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'vendor';
  window.printDocument({type:'consumable-log',data,filename:`consumable-log-${safe}-${month}.pdf`});
  _acctLog('Consumable log printed',`${v.name} · ${_acctMonthLabel(month)}`);
};

/* ── REVIEW & CLOSE (owners) ── */
function _acctReviewPage(){
  if(!_acctCanAdmin())return '<div class="card"><div class="empty">Owners only.</div></div>';
  const s=_acctSettings();
  const queue=acctEntries.filter(e=>e.needsReview&&!e.reviewedAt&&e.status!=='void');
  const pending=acctEntries.filter(e=>e.status==='pending');
  const mo=_acctThisMonth();
  const closable=_acctMonthAdd(mo,-1);
  const lastClose=_acctLastClose();
  const b=_acctBalances(closable+'-31');
  let h=`<div class="card">
    <div class="card-title">Needs review · ${queue.length}</div>
    ${queue.length?`<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Date</th><th>Particulars</th><th>Vendor / person</th><th class="num">Amount</th><th>Why</th><th>By</th><th></th></tr></thead><tbody>${queue.map(e=>`<tr onclick="window.acctOpenEntry('${e._id}')"><td class="date">${_acctDateLabel(e.date)}</td><td class="part">${_acctEsc(_acctParticulars(e))}</td><td>${_acctEsc(_acctVendorName(e)||e.person||'')}</td><td class="num">${_acctPKR(e.amount)}</td><td>${(e.reviewFlags||[]).map(f=>`<span class="acct-chip urgent">${_acctEsc(f)}</span>`).join(' ')}</td><td>${_acctEsc(e.byName||e.by)}</td><td class="flags"><button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="event.stopPropagation();window.acctReview('${e._id}')">Clear</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty" style="padding:18px">Nothing waiting. Entries above the approval limit (${s.approvalLimit?_acctPKR(s.approvalLimit):'off'}) or without a receipt above ${_acctPKR(s.receiptRequiredAbove)} land here.</div>`}
  </div>`;
  if(pending.length)h+=`<div class="card"><div class="card-title">Cash in awaiting Raees's confirmation · ${pending.length}</div>${pending.map(e=>`<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:14px"><span>${_acctDateLabel(e.date)} · ${_acctPKR(e.amount)} into ${_acctAccountLabel(e.account)} by ${_acctEsc(e.byName||e.by)}</span><button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="window.acctOpenEntry('${e._id}')">Open</button></div>`).join('')}</div>`;
  h+=`<div class="card">
    <div class="card-title">Month close</div>
    ${lastClose?`<div style="font-size:13px;color:var(--muted);margin-bottom:10px">Last closed: <b>${_acctMonthLabel(lastClose.month)}</b> by ${_acctEsc(lastClose.closedByName||lastClose.closedBy||'')} · cash book ${_acctPKR(lastClose.cashBook)} / counted ${_acctPKR(lastClose.cashCounted)}${lastClose.variance?` · variance ${_acctPKR(lastClose.variance)}`:' · no variance'}</div>`:`<div style="font-size:13px;color:var(--muted);margin-bottom:10px">No month has been closed yet. Closing a month freezes it (no new entries, no voids) and stores a checkpoint so the ledger never has to replay from day one.</div>`}
    ${_acctMonthClosed(closable)?`<div class="empty" style="padding:12px">${_acctMonthLabel(closable)} is already closed. The current month can be closed once it ends.</div>`:`
    <div class="form-grid">
      <div class="field"><label>Month to close</label><input value="${_acctMonthLabel(closable)}" readonly></div>
      <div class="field"><label>Cash book balance at ${closable}-${_acctDaysInMonth(closable)}</label><input value="${_acctPKR(b.cash)}" readonly></div>
      <div class="field"><label>Cash actually counted (₨) *</label><input id="acct-close-counted" type="number" inputmode="numeric" min="0" placeholder="0" oninput="window.acctClosePreview(${b.cash})"></div>
      <div class="field"><label>MCB balance (book)</label><input value="${_acctPKR(b.mcb)}" readonly></div>
      <div class="field" style="grid-column:1/-1"><label>Note (required if there is a variance)</label><input id="acct-close-note" placeholder="e.g. ₨200 short — torn note replaced"></div>
    </div>
    <div id="acct-close-prev" style="font-size:13px;margin:8px 0;min-height:18px;color:var(--muted)"></div>
    <button class="btn-primary" style="width:auto;padding:10px 16px" onclick="window.acctCloseMonth('${closable}')">Close ${_acctMonthLabel(closable)}</button>`}
    ${acctCloses.length?`<div style="margin-top:14px;font-size:13px"><b>Closed months:</b> ${acctCloses.slice().reverse().map(c=>`<span class="acct-chip ok">${c.month}</span>`).join(' ')}</div>`:''}
  </div>`;
  if(_acctIsSuper()){
    h+=`<div class="card acct-super-card">
    <div class="card-title">Admin tools · Afnan only</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:10px">Correction tools, not the daily workflow. Open any entry to <b>Edit (admin)</b> or <b>Delete (admin)</b> it. Reopen the last closed month here, or reset the module to start again.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${lastClose?`<button class="btn-outline" onclick="window.acctAdminReopen('${lastClose.month}')">Reopen ${_acctMonthLabel(lastClose.month)}</button>`:''}
      <button class="btn-outline" style="color:var(--accent-urgent);border-color:var(--accent-urgent)" onclick="window.acctAdminResetPrompt()">Reset Store Accounts…</button>
    </div>
  </div>`;
  }
  h+=`<div class="card">
    <div class="card-title">Settings</div>
    <div class="form-grid">
      <div class="field"><label>Approval limit (₨) — 0 = off</label><input id="acct-s-limit" type="number" min="0" value="${s.approvalLimit||0}"></div>
      <div class="field"><label>Receipt required above (₨)</label><input id="acct-s-receipt" type="number" min="0" value="${s.receiptRequiredAbove||0}"></div>
      <div class="field"><label>Float warning after (days)</label><input id="acct-s-warn" type="number" min="1" value="${s.floatWarnDays}"></div>
      <div class="field"><label>Float red after (days)</label><input id="acct-s-red" type="number" min="1" value="${s.floatRedDays}"></div>
      <div class="field" style="grid-column:1/-1"><label>Expense categories (comma separated)</label><input id="acct-s-cats" value="${_acctEsc((s.categories||[]).join(', '))}"></div>
      <div class="field" style="grid-column:1/-1"><label>Runners (people who take floats)</label><input id="acct-s-runners" value="${_acctEsc((s.runners||[]).join(', '))}"></div>
      <div class="field" style="grid-column:1/-1"><label>Payable days — when vendors are paid</label><div style="display:flex;flex-wrap:wrap;gap:6px 14px">${_ACCT_WEEKDAYS.map((n,i)=>`<label style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" id="acct-s-pd-${i}"${_acctPayDays().includes(i)?' checked':''}> ${n}</label>`).join('')}</div></div>
    </div>
    <button class="btn-outline" style="margin-top:10px" onclick="window.acctSaveSettings()">Save settings</button>
  </div>`;
  h+=`<div class="card">
    <div class="card-title">Legacy cash ledger</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.5">Entries from the old Cash Ledger (<code>store_cash_ledger</code>) are not shown here. Import them once as ledger entries — safe to run again, rows already imported are skipped. SadaPay / EasyPaisa rows are mapped to Cash with a note.</div>
    <button class="btn-outline" style="margin-top:10px" onclick="window.acctImportLegacy()">Import legacy entries</button>
    <div id="acct-import-log" style="font-size:13px;margin-top:8px"></div>
  </div>`;
  return h;
}
window.acctClosePreview=function(book){
  const c=parseInt(document.getElementById('acct-close-counted')?.value);const el=document.getElementById('acct-close-prev');if(!el)return;
  if(isNaN(c)){el.textContent='';return;}
  const d=c-book;el.innerHTML=d===0?'<span style="color:var(--accent-success);font-weight:700">Counted cash matches the book ✓</span>':`<span style="color:var(--accent-urgent);font-weight:700">${d>0?'Surplus':'Short'} ${_acctPKR(Math.abs(d))}</span> — an adjustment entry of ${_acctSigned(d)} will be posted on the last day of the month, with your note as the reason.`;
};
window.acctCloseMonth=async function(month){
  if(!_acctCanAdmin())return;
  const counted=parseInt(document.getElementById('acct-close-counted')?.value);
  const note=(document.getElementById('acct-close-note')?.value||'').trim();
  if(isNaN(counted)||counted<0){showToast('Enter the counted cash.',true);return;}
  if(_acctMonthClosed(month)){showToast('Already closed.',true);return;}
  if(acctEntries.some(e=>e.status==='pending'&&e.month<=month)){showToast('Confirm or void the pending cash-in entries first.',true);return;}
  const last=month+'-'+_acctDaysInMonth(month);
  const b=_acctBalances(last);
  const variance=counted-b.cash;
  if(variance!==0&&!note){showToast('A variance needs a note.',true);return;}
  if(!confirm(`Close ${_acctMonthLabel(month)}?\n\nCash book ${_acctPKR(b.cash)} · counted ${_acctPKR(counted)}${variance?' · variance '+_acctSigned(variance):''}\nMCB ${_acctPKR(b.mcb)} · payables ${_acctPKR(Object.values(b.payables).reduce((s,v)=>s+Math.max(0,v),0))}\n\nNo entry can be added to or voided in this month afterwards.`))return;
  _acctBusy=true;
  try{
    if(variance!==0){
      const adj=Object.assign(_acctBase('adjust'),{account:'cash',amount:variance,date:last,month,note:'Month-close count: '+note,category:'',reviewedAt:Date.now(),reviewedBy:_acctUser().by});
      const row=await _acctWrite(adj,true);if(!row)throw new Error('adjustment failed');
    }
    const after=_acctBalances(last);
    // The checkpoint carries the balance AFTER the count adjustment, i.e. what
    // was actually in the drawer — that is what the next month starts from.
    const doc={month,closedAt:Date.now(),closedBy:_acctUser().by,closedByName:_acctUser().byName,cashBook:after.cash,cashBookBeforeCount:b.cash,cashCounted:counted,variance,mcbBook:after.mcb,payables:after.payables,note,entries:_acctLive().filter(e=>e.month===month).length};
    await fsSet('acct_closes',month,doc);
    acctCloses.push(Object.assign({},doc,{_id:month}));acctCloses.sort((a,b)=>String(a.month).localeCompare(String(b.month)));
    // The checkpoint now carries this month; drop its rows from memory exactly
    // as a reload would, so nothing is counted twice.
    acctEntries=acctEntries.filter(e=>e.month>month);
    _acctLog('Accounts month closed',month+(variance?' · variance '+_acctSigned(variance):''));
    showToast(_acctMonthLabel(month)+' closed ✓');
  }catch(e){showToast('Close failed: '+e.message,true);}
  _acctBusy=false;_acctRerender();
};
window.acctSaveSettings=async function(){
  if(!_acctCanAdmin())return;
  const g=id=>document.getElementById(id)?.value||'';
  const list=s=>String(s).split(',').map(x=>x.trim()).filter(Boolean);
  const doc={approvalLimit:parseInt(g('acct-s-limit'))||0,receiptRequiredAbove:parseInt(g('acct-s-receipt'))||0,floatWarnDays:parseInt(g('acct-s-warn'))||3,floatRedDays:parseInt(g('acct-s-red'))||7,categories:list(g('acct-s-cats')),runners:list(g('acct-s-runners')),payDays:_ACCT_WEEKDAYS.map((_,i)=>i).filter(i=>document.getElementById('acct-s-pd-'+i)?.checked),updatedAt:Date.now(),updatedBy:_acctUser().by};
  if(!doc.categories.length)doc.categories=ACCT_DEFAULTS.categories.slice();
  if(!doc.payDays.length)doc.payDays=ACCT_DEFAULTS.payDays.slice();
  try{await fsSet('acct_settings','main',doc);acctSettings=Object.assign({},doc,{_id:'main'});showToast('Settings saved ✓');_acctRerender();}
  catch(e){showToast('Save failed: '+e.message,true);}
};
window.acctReview=async function(id){
  if(!_acctCanAdmin())return;
  const ok=await _acctPatch(id,{reviewedAt:Date.now(),reviewedBy:_acctUser().by});
  if(ok){showToast('Cleared ✓');_acctRerender();}
};

/* ════════════════════════ WRITES ════════════════════════ */
function _acctBase(type){
  const u=_acctUser();const date=_acctToday();
  return {type,date,month:_acctMonthOf(date),ts:Date.now(),by:u.by,byName:u.byName,vendorId:null,vendorName:'',person:'',account:null,toAccount:null,source:null,floatId:null,amount:0,lines:[],category:'',ref:'',note:'',photo:null,status:'posted',needsReview:false,reviewFlags:[]};
}
// What an entry is flagged for at posting time. Warn, never block.
function _acctReviewFlags(e){
  const s=_acctSettings();const f=[];
  if(s.approvalLimit>0&&Math.abs(e.amount||0)>s.approvalLimit&&e.type!=='cash_in'&&e.type!=='transfer'&&e.type!=='float_in')f.push('over limit');
  if(s.receiptRequiredAbove>0&&(e.type==='purchase'||e.type==='payment'||e.type==='runner_pay')&&Math.abs(e.amount||0)>s.receiptRequiredAbove&&!e.photo&&!e.meterKey)f.push('no receipt');
  if(e.type==='adjust')f.push('adjustment');
  return f;
}
// The one write path for a ledger entry. Returns the stored row or null.
async function _acctWrite(entry,quiet){
  if(_acctBusy&&!quiet){showToast('Please wait…',true);return null;}
  if(!_acctCanEntry()){showToast('You cannot record entries.',true);return null;}
  if(!entry.date||!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)){showToast('Enter a valid date.',true);return null;}
  entry.month=_acctMonthOf(entry.date);
  if(_acctMonthClosed(entry.month)){showToast(_acctMonthLabel(entry.month)+' is closed — pick a date after the close.',true);return null;}
  if(entry.date>_acctToday()){showToast('The date cannot be in the future.',true);return null;}
  entry.reviewFlags=_acctReviewFlags(entry);entry.needsReview=entry.reviewFlags.length>0&&!entry.reviewedAt;
  const wasBusy=_acctBusy;_acctBusy=true;
  try{
    const id=await fsAdd('acct_entries',entry);
    const row=Object.assign({},entry,{_id:id});
    acctEntries.unshift(row);_acctSort(acctEntries);
    _acctLog('Accounts entry recorded',`${ACCT_TYPES[entry.type]?ACCT_TYPES[entry.type].label:entry.type} ${_acctPKR(entry.amount)}${entry.vendorName?' · '+entry.vendorName:''}${entry.person?' · '+entry.person:''}`);
    if(!wasBusy)_acctBusy=false;
    return row;
  }catch(e){
    if(!wasBusy)_acctBusy=false;
    showToast('Save failed: '+(e.message||e),true);
    return null;
  }
}
// Status/control fields only — the rules' hasOnly list mirrors these keys.
async function _acctPatch(id,patch){
  const e=_acctById(id);if(!e){showToast('Entry not found.',true);return false;}
  const doc=Object.assign({},e,patch);delete doc._id;
  try{await fsSet('acct_entries',id,doc);Object.assign(e,patch);return true;}
  catch(err){showToast('Update failed: '+(err.message||err),true);return false;}
}
window.acctVoid=async function(id){
  const e=_acctById(id);if(!e)return;
  if(e.status==='void'){showToast('Already void.',true);return;}
  if(!_acctCanEntry())return;
  if(_acctMonthClosed(e.month)){showToast(_acctMonthLabel(e.month)+' is closed — this entry can no longer be voided.',true);return;}
  if(e.reviewedAt&&!_acctCanAdmin()){showToast('An owner has reviewed this entry — ask an owner to void it.',true);return;}
  if(e.type==='float_out'){const b=_acctBalances();const f=b.floats[e._id];if(f&&(f.used||f.back)){showToast('Purchases or change were recorded against this float — void those first.',true);return;}}
  if(e.type==='purchase'&&e.stockPosted===true){if(!confirm('This purchase posted stock into inventory. Voiding it will NOT reverse the stock — do that on the Store side if the goods were not really received.\n\nVoid the money entry anyway?'))return;}
  const reason=prompt('Why is this entry being voided? (kept on the record)');
  if(reason==null)return;
  if(!reason.trim()){showToast('A reason is required.',true);return;}
  const ok=await _acctPatch(id,{status:'void',voidedAt:Date.now(),voidedBy:_acctUser().by,voidReason:reason.trim()});
  if(ok){_acctLog('Accounts entry voided',`${_acctParticulars(e)} ${_acctPKR(e.amount)} — ${reason.trim()}`);showToast('Entry voided — it stays on the record, struck through.');window.acctModalClose();_acctRerender();}
};
window.acctConfirmCashIn=async function(id){
  const e=_acctById(id);if(!e||e.status!=='pending')return;
  if(!_acctCanEntry())return;
  if(!confirm(`Confirm you received ${_acctPKR(e.amount)} into ${_acctAccountLabel(e.account)}?`))return;
  const ok=await _acctPatch(id,{status:'posted',confirmedAt:Date.now(),confirmedBy:_acctUser().by});
  if(ok){showToast('Confirmed ✓');window.acctModalClose();_acctRerender();}
};

// ── Stock posting: a purchase line naming a store item is a Store Receive ──
async function _acctPostStock(entry){
  const lines=(entry.lines||[]).filter(l=>l.itemCode);
  if(!lines.length)return;
  if(typeof allItems==='undefined'){await _acctPatch(entry._id,{stockPosted:false,stockError:'Store module not loaded'});return;}
  if(typeof _storeDataLoaded==='function'&&!_storeDataLoaded()&&typeof loadStoreData==='function'){try{await loadStoreData();}catch(_){}}
  const errors=[];const txIds=[];
  const vendorName=entry.vendorName||'';
  for(const l of lines){
    const item=allItems.find(i=>i.code===l.itemCode);
    if(!item){errors.push(l.itemCode+': not in inventory');continue;}
    const updated=Object.assign({},item);delete updated._id;
    let qty=0;
    if(item.sizeSpecific){
      const sizes=Object.assign({},item.sizes||{});let any=false;
      for(const [sz,q] of Object.entries(l.sizes||{})){const n=Number(q)||0;if(n){sizes[sz]=(parseInt(sizes[sz])||0)+n;any=true;qty+=n;}}
      if(!any){errors.push(l.itemCode+': no size quantities');continue;}
      updated.sizes=sizes;
    }else{
      qty=Number(l.qty)||0;
      if(!qty){errors.push(l.itemCode+': no quantity');continue;}
      updated.balance=(parseInt(item.balance)||0)+qty;
    }
    try{
      await fsSet('store_items',item.code,updated);
      const tx={type:'received',itemCode:item.code,itemName:item.name,supplier:vendorName,date:entry.date,notes:'Accounts purchase'+(entry.ref?' · '+entry.ref:'')+' @ '+_acctPKR(l.rate)+'/'+(l.unit||item.unit||'unit'),by:_acctUser().byName,ts:Date.now(),qty,unit:item.unit,rate:Number(l.rate)||0,acctEntryId:entry._id};
      const txId=await fsAdd('store_transactions',tx);
      txIds.push(txId);
      const idx=allItems.findIndex(i=>i.code===item.code);if(idx>=0)allItems[idx]=Object.assign({},updated,{_id:item.code});
      if(typeof allTransactions!=='undefined'&&Array.isArray(allTransactions))allTransactions.unshift(Object.assign({},tx,{_id:txId}));
      if(typeof _checkShortfallsOnReceive==='function')_checkShortfallsOnReceive(item.code).catch(()=>{});
    }catch(e){errors.push(item.code+': '+(e.message||e));}
  }
  await _acctPatch(entry._id,{stockPosted:errors.length===0,stockError:errors.join('; '),stockTx:txIds});
  if(errors.length)showToast('Money recorded, but stock was not fully posted: '+errors.join('; '),true);
}
window.acctRetryStock=async function(id){const e=_acctById(id);if(!e||e.status==='void')return;await _acctPostStock(e);_acctRerender();if(e.stockPosted)showToast('Stock posted ✓');};

/* ════════════════════════ MODAL ════════════════════════ */
function _acctModal(title,body,foot,opts){
  opts=opts||{};
  document.getElementById('acct-modal')?.remove();
  const m=document.createElement('div');m.id='acct-modal';m.className='acct-modal-back';
  m.innerHTML=`<div class="acct-modal" style="max-width:${opts.width||560}px" role="dialog" aria-modal="true">
    <div class="acct-modal-head"><span>${title}</span><button class="acct-x" onclick="window.acctModalClose()" aria-label="Close">×</button></div>
    <div class="acct-modal-body">${body}</div>
    ${foot?`<div class="acct-modal-foot">${foot}</div>`:''}
  </div>`;
  m.addEventListener('click',ev=>{if(ev.target===m&&!opts.sticky)window.acctModalClose();});
  document.body.appendChild(m);
  const first=m.querySelector('[autofocus]');if(first)setTimeout(()=>first.focus(),40);
}
window.acctModalClose=function(){document.getElementById('acct-modal')?.remove();};
function _acctPhotoField(id,label){
  return `<label for="${id}" class="acct-photo-btn">📷 ${label}</label>
    <input id="${id}" type="file" accept="image/*" capture="environment" style="display:none" onchange="window.acctUploadPhoto('${id}')">
    <div id="${id}-st" style="font-size:13px;margin-top:4px;min-height:16px"></div>`;
}
window.acctUploadPhoto=async function(id){
  const inp=document.getElementById(id);const file=inp&&inp.files&&inp.files[0];if(!file)return;
  const st=document.getElementById(id+'-st');if(st)st.textContent='Uploading…';
  try{const url=await uploadToCloudinary(file);window._acctPhoto[id]=url;if(st)st.innerHTML=`<a href="${_acctEsc(url)}" target="_blank" rel="noopener" style="color:var(--accent-success);font-weight:700">✓ Attached — view</a> <button type="button" class="acct-link" onclick="window.acctClearPhoto('${id}')">remove</button>`;}
  catch(e){if(st)st.innerHTML=`<span style="color:var(--accent-urgent)">Upload failed: ${_acctEsc(e.message||e)}</span>`;}
};
window.acctClearPhoto=function(id){delete window._acctPhoto[id];const i=document.getElementById(id);if(i)i.value='';const st=document.getElementById(id+'-st');if(st)st.textContent='';};

/* ════════════════════════ NEW ENTRY MENU ════════════════════════ */
window.acctNewMenu=function(){
  if(!_acctCanEntry())return;
  const items=[['purchase','Purchase','Goods or a bill from a vendor — paid now, on credit, or from a runner\'s float'],['payment','Payment to vendor','Settle what a vendor is owed — from Cash, from MCB, or settled some other way'],['cash_in','Cash in','Money arriving — physical cash or an MCB transfer'],['transfer','Transfer','Move between Cash and MCB'],['float_out','Float to a runner','Hand cash to Noman (or anyone) to buy with'],['float_in','Change back','A runner returns what was left of a float'],['runner_pay','Settle with a runner','A runner paid bills over the float — pay them back from Cash, MCB, or settle it some other way']];
  if(_acctCanAdmin())items.push(['adjust','Adjustment','Owner-only correction of a cash or MCB balance, with a reason']);
  _acctModal('New entry',`<div class="acct-menu">${items.map(i=>`<button class="acct-menu-item" onclick="window.acctForm('${i[0]}')"><b>${i[1]}</b><span>${i[2]}</span></button>`).join('')}</div>`,'',{width:460});
};

/* ════════════════════════ ENTRY FORMS ════════════════════════ */
function _acctVendorOptions(sel,filter){
  const list=acctVendors.filter(v=>v.active!==false&&(!filter||filter(v))).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  return `<option value="">— pick a vendor —</option>`+list.map(v=>`<option value="${v._id}"${sel===v._id?' selected':''}>${_acctEsc(v.name)}${v.terms&&v.terms.mode==='credit'?' · credit':''}</option>`).join('')+`<option value="__new__">+ New vendor…</option>`;
}
function _acctAccountChips(name,sel,extra){
  const opts=ACCT_ACCOUNTS.map(a=>({key:a.key,label:a.label})).concat(extra||[]);
  const b=_acctBalances();
  return `<div class="acct-chips" id="${name}-chips">${opts.map(o=>`<button type="button" class="acct-chipbtn${sel===o.key?' on':''}" data-v="${o.key}" onclick="window.acctChip('${name}','${o.key}')">${_acctEsc(o.label)}${b[o.key]!=null?`<small>${_acctPKR(b[o.key])}</small>`:(o.sub?`<small>${_acctEsc(o.sub)}</small>`:'')}</button>`).join('')}<input type="hidden" id="${name}" value="${_acctEsc(sel||'')}"></div>`;
}
window.acctChip=function(name,v){
  const h=document.getElementById(name);if(h)h.value=v;
  document.querySelectorAll(`#${name}-chips .acct-chipbtn`).forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(name==='f-source')window.acctPurchaseSourceChanged();
  if(name==='f-acc'&&document.getElementById('f-proof-wrap'))document.getElementById('f-proof-wrap').style.display=v==='mcb'?'block':'none';
  if(name==='f-acc'&&document.getElementById('f-acc-hint'))document.getElementById('f-acc-hint').style.display=v===ACCT_OTHER.key?'block':'none';
};
// The category list is the settings list ∪ every category already on a
// purchase in memory — so a name Raees added from the form, or one the
// legacy import wrote, is never missing from the picker even when the
// settings write below was refused. Deduped case-insensitively, first
// spelling wins, settings order first.
function _acctCategories(){
  const out=[];const seen=new Set();
  const add=c=>{c=String(c||'').trim();if(!c)return;const k=c.toLowerCase();if(seen.has(k))return;seen.add(k);out.push(c);};
  _acctSettings().categories.forEach(add);
  (acctEntries||[]).forEach(e=>{if(e&&(e.type==='purchase'||e.type==='float_out'))add(e.category);});
  return out;
}
const _ACCT_NEW_CAT='__new__';
const _ACCT_CAT_FIELDS=['categories','updatedAt','updatedBy']; // mirrored in firestore.rules acct_settings
function _acctCatOptions(sel,blank){
  return (blank?`<option value=""${!sel?' selected':''}>${_acctEsc(blank)}</option>`:'')
    +_acctCategories().map(c=>`<option${sel===c?' selected':''}>${_acctEsc(c)}</option>`).join('')
    +`<option value="${_ACCT_NEW_CAT}">+ New category…</option>`;
}
// "+ New category…" on the purchase form's Category select. Asks for a
// name, adds it to the list and selects it; an empty answer puts the
// previous pick back. A name already on the list (any case) selects the
// existing spelling rather than minting a twin.
window.acctCatChange=function(sel){
  if(!sel)return;
  if(sel.value!==_ACCT_NEW_CAT){sel.dataset.prev=sel.value;return;}
  const prev=sel.dataset.prev||_acctCategories()[0]||'';
  const name=String(prompt('New category name')||'').trim();
  const pick=name?_acctAddCategory(name):null;
  sel.innerHTML=_acctCatOptions(pick||prev);
  sel.value=pick||prev;sel.dataset.prev=sel.value;
};
function _acctAddCategory(name){
  name=String(name||'').trim();if(!name)return null;
  const have=_acctCategories().find(c=>c.toLowerCase()===name.toLowerCase());
  if(have)return have;
  const cats=_acctSettings().categories.slice();cats.push(name);
  acctSettings=Object.assign({_id:'main'},acctSettings||{},{categories:cats});
  _acctSaveCategories(cats,name); // best effort, never awaited — the form keeps the name either way
  return name;
}
// Writes ONLY the categories field (an updateMask), so Raees's write can
// never carry a stale approvalLimit over the owner's, and the rule holds
// him to exactly _ACCT_CAT_FIELDS. Owners' full settings save is
// acctSaveSettings, unchanged.
async function _acctSaveCategories(cats,name){
  try{
    const tok=await getStoreToken();
    const mask=_ACCT_CAT_FIELDS.map(f=>'updateMask.fieldPaths='+f).join('&');
    const r=await fetch(`${_FS_BASE}/acct_settings/main?${mask}`,{method:'PATCH',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
      body:JSON.stringify({fields:toFsFields({categories:cats,updatedAt:Date.now(),updatedBy:_acctUser().by})})});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error((e.error&&e.error.message)||('HTTP '+r.status));}
    _acctLog('Accounts category added',name);
  }catch(e){showToast('Category kept for this entry, but the list could not be saved: '+e.message,true);}
}
function _acctDateField(id,val){return `<div class="field"><label>Date</label><input id="${id}" type="date" value="${_acctEsc(val||_acctToday())}" max="${_acctToday()}"></div>`;}

window.acctForm=function(type,pre){
  pre=pre||{};
  if(!_acctCanEntry())return;
  if(type==='adjust'&&!_acctCanAdmin())return;
  if(type==='purchase')return _acctPurchaseForm(pre);
  const T=ACCT_TYPES[type];if(!T)return;
  let body='';
  const floats=_acctOpenFloats();
  if(type==='payment'){
    const v=_acctVendor(pre.vendorId);const bal=v?_acctVendorBalance(v._id):0;
    body=`<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Vendor *</label><select id="f-vendor" onchange="window.acctPayVendorChanged(this.value)">${_acctVendorOptions(pre.vendorId)}</select><div id="f-vendor-bal" style="font-size:13px;color:var(--muted);margin-top:4px">${v?`Owed: <b>${_acctPKR(bal)}</b>${_acctVendorAging(v._id).overdue?` · <span style="color:var(--accent-urgent)">${_acctPKR(_acctVendorAging(v._id).overdue)} overdue</span>`:''}`:''}</div></div>
      <div class="field"><label>Amount (₨) *</label><input id="f-amount" type="number" inputmode="numeric" min="1" value="${bal>0?bal:''}" placeholder="0" autofocus></div>
      ${_acctDateField('f-date')}
      <div class="field" style="grid-column:1/-1"><label>Paid from *</label>${_acctAccountChips('f-acc','cash',[ACCT_OTHER])}<div id="f-acc-hint" style="font-size:13px;color:var(--muted);margin-top:4px;display:none">Other: the vendor's balance drops, but no Cash or MCB movement is recorded — say how it was settled in the note.</div></div>
      <div class="field"><label>Ref (invoice / transfer no.)</label><input id="f-ref" placeholder="optional"></div>
      <div class="field"><label>Note</label><input id="f-note" placeholder="optional"></div>
      <div class="field" style="grid-column:1/-1" id="f-proof-wrap" style="display:none"><label>Payment proof (required for MCB)</label>${_acctPhotoField('f-photo','Attach transfer screenshot / receipt')}</div>
    </div>`;
  }else if(type==='cash_in'){
    const owner=session.role!=='store';
    body=`<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Into *</label>${_acctAccountChips('f-acc','cash')}</div>
      <div class="field" style="grid-column:1/-1"><label>Arrived as *</label><div class="acct-chips" id="f-via-chips"><button type="button" class="acct-chipbtn on" data-v="cash" onclick="window.acctChip('f-via','cash')">Physical cash</button><button type="button" class="acct-chipbtn" data-v="mcb" onclick="window.acctChip('f-via','mcb')">MCB transfer</button><input type="hidden" id="f-via" value="cash"></div></div>
      <div class="field"><label>Amount (₨) *</label><input id="f-amount" type="number" inputmode="numeric" min="1" placeholder="0" autofocus></div>
      ${_acctDateField('f-date')}
      <div class="field"><label>From whom</label><input id="f-person" placeholder="e.g. Afnan" value="${owner?_acctEsc(session.name):''}"></div>
      <div class="field"><label>Ref (transfer no.)</label><input id="f-ref" placeholder="optional"></div>
      <div class="field" style="grid-column:1/-1"><label>Note</label><input id="f-note" placeholder="optional"></div>
      <div class="field" style="grid-column:1/-1">${_acctPhotoField('f-photo','Attach transfer screenshot (optional)')}</div>
      ${owner?`<div style="grid-column:1/-1;font-size:13px;color:var(--muted);background:var(--surface-2);border-radius:8px;padding:8px 10px">Recorded by an owner, so it stays <b>pending</b> until Raees confirms he received it. It does not count toward the balance until then.</div>`:''}
    </div>`;
  }else if(type==='transfer'){
    body=`<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>From *</label>${_acctAccountChips('f-acc','mcb')}</div>
      <div class="field" style="grid-column:1/-1"><label>To *</label>${_acctAccountChips('f-to','cash')}</div>
      <div class="field"><label>Amount (₨) *</label><input id="f-amount" type="number" inputmode="numeric" min="1" placeholder="0" autofocus></div>
      ${_acctDateField('f-date')}
      <div class="field" style="grid-column:1/-1"><label>Note</label><input id="f-note" placeholder="e.g. ATM withdrawal for the drawer"></div>
    </div>`;
  }else if(type==='float_out'){
    const runners=_acctRunners();
    body=`<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Given to *</label><input id="f-person" list="acct-runners" placeholder="Name — pick a runner or type a new one" value="${_acctEsc(pre.person||(runners.length===1?runners[0]:''))}" autofocus><datalist id="acct-runners">${runners.map(r=>`<option value="${_acctEsc(r)}">`).join('')}</datalist></div>
      <div class="field"><label>Amount (₨) *</label><input id="f-amount" type="number" inputmode="numeric" min="1" placeholder="0"></div>
      ${_acctDateField('f-date')}
      <div class="field" style="grid-column:1/-1"><label>From *</label>${_acctAccountChips('f-acc','cash')}</div>
      <div class="field"><label>Category *</label><select id="f-cat" onchange="window.acctCatChange(this)">${_acctCatOptions(pre.category||'','— what is the runner sent for? —')}</select></div>
      <div class="field"><label>What for</label><input id="f-note" placeholder="e.g. thread + packing from Shershah"></div>
      <div style="grid-column:1/-1;font-size:13px;color:var(--muted);background:var(--surface-2);border-radius:8px;padding:8px 10px">When the bills come back, record each as a <b>Purchase</b> paid <b>from this float</b> — it starts in this category; then record the <b>change back</b>. The float closes itself when it is fully accounted for.</div>
    </div>`;
  }else if(type==='float_in'){
    if(!floats.length){showToast('No open floats.',true);return;}
    body=`<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Which float *</label><select id="f-float" onchange="window.acctFloatPick(this.value)">${floats.map(f=>`<option value="${f.id}"${pre.floatId===f.id?' selected':''}>${_acctEsc(f.person)} · ${_acctDateLabel(f.date)} · ${_acctPKR(f.left)} left</option>`).join('')}</select></div>
      <div class="field"><label>Change returned (₨) *</label><input id="f-amount" type="number" inputmode="numeric" min="1" value="${(pre.floatId?floats.find(f=>f.id===pre.floatId):floats[0]).left}" autofocus></div>
      ${_acctDateField('f-date')}
      <div class="field" style="grid-column:1/-1"><label>Into *</label>${_acctAccountChips('f-acc','cash')}</div>
      <div class="field" style="grid-column:1/-1"><label>Note</label><input id="f-note" placeholder="optional"></div>
    </div>`;
  }else if(type==='runner_pay'){
    const owedAll=Object.values(_acctRunnerOwed()).filter(r=>r.owed>0).sort((a,b)=>b.owed-a.owed);
    if(!owedAll.length){showToast('No runner is owed anything — every bill fits its float.',true);return;}
    const cur=owedAll.find(r=>r.key===_acctRunnerKey(pre.person))||owedAll[0];
    body=`<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Runner *</label><select id="f-person" onchange="window.acctRunnerPayPick(this.value)">${owedAll.map(r=>`<option value="${_acctEsc(r.name)}"${r.key===cur.key?' selected':''}>${_acctEsc(r.name)} · owed ${_acctPKR(r.owed)}</option>`).join('')}</select><div id="f-owed" style="font-size:13px;color:var(--muted);margin-top:4px">Spent ${_acctPKR(cur.over)} over the float${cur.paid?`, ${_acctPKR(cur.paid)} already settled`:''} — <b>${_acctPKR(cur.owed)}</b> still owed.</div></div>
      <div class="field"><label>Amount (₨) *</label><input id="f-amount" type="number" inputmode="numeric" min="1" value="${cur.owed}" placeholder="0" autofocus></div>
      ${_acctDateField('f-date')}
      <div class="field" style="grid-column:1/-1"><label>Paid from *</label>${_acctAccountChips('f-acc','cash',[ACCT_OTHER])}<div id="f-acc-hint" style="font-size:13px;color:var(--muted);margin-top:4px;display:none">Other: what the runner is owed drops, but no Cash or MCB movement is recorded — say how it was settled in the note.</div></div>
      <div class="field"><label>Ref</label><input id="f-ref" placeholder="optional"></div>
      <div class="field"><label>Note</label><input id="f-note" placeholder="optional"></div>
      <div class="field" style="grid-column:1/-1" id="f-proof-wrap" style="display:none"><label>Payment proof (required for MCB)</label>${_acctPhotoField('f-photo','Attach transfer screenshot / receipt')}</div>
    </div>`;
  }else if(type==='adjust'){
    body=`<div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Account *</label>${_acctAccountChips('f-acc','cash')}</div>
      <div class="field"><label>Amount (₨, negative to reduce) *</label><input id="f-amount" type="number" inputmode="numeric" placeholder="e.g. -200" autofocus></div>
      ${_acctDateField('f-date')}
      <div class="field" style="grid-column:1/-1"><label>Reason *</label><input id="f-note" placeholder="Why the book is being corrected"></div>
      <div style="grid-column:1/-1;font-size:13px;color:var(--accent-urgent)">Adjustments are always flagged for review and are visible to everyone who can see the ledger.</div>
    </div>`;
  }
  _acctModal(T.verb,body,`<button class="btn-outline" onclick="window.acctModalClose()">Cancel</button><button class="btn-primary" style="width:auto;margin:0;padding:10px 18px" id="f-submit" onclick="window.acctSubmit('${type}')">Record</button>`,{sticky:true});
  if(type==='payment'||type==='runner_pay')window.acctChip('f-acc','cash');
};
window.acctRunnerPayPick=function(name){
  const r=_acctRunnerOwed()[_acctRunnerKey(name)];const el=document.getElementById('f-owed');const a=document.getElementById('f-amount');
  if(!r){if(el)el.textContent='';return;}
  if(el)el.innerHTML=`Spent ${_acctPKR(r.over)} over the float${r.paid?`, ${_acctPKR(r.paid)} already settled`:''} — <b>${_acctPKR(r.owed)}</b> still owed.`;
  if(a)a.value=r.owed;
};
window.acctPayVendorChanged=function(v){
  if(v==='__new__'){window.acctVendorWizard(null,null,{then:id=>window.acctForm('payment',{vendorId:id})});return;}
  const el=document.getElementById('f-vendor-bal');const a=document.getElementById('f-amount');
  if(!v){if(el)el.textContent='';return;}
  const bal=_acctVendorBalance(v),ag=_acctVendorAging(v);
  if(el)el.innerHTML=`Owed: <b>${_acctPKR(bal)}</b>${ag.overdue?` · <span style="color:var(--accent-urgent)">${_acctPKR(ag.overdue)} overdue</span>`:''}`;
  if(a&&bal>0)a.value=bal;
};
window.acctFloatPick=function(id){const f=_acctOpenFloats().find(x=>x.id===id);const a=document.getElementById('f-amount');if(f&&a)a.value=f.left;};

window.acctSubmit=async function(type){
  const g=id=>{const el=document.getElementById(id);return el?el.value:'';};
  const amount=parseInt(g('f-amount'));
  const btn=document.getElementById('f-submit');
  const e=_acctBase(type);
  e.date=g('f-date')||_acctToday();e.note=(g('f-note')||'').trim();e.ref=(g('f-ref')||'').trim();e.photo=window._acctPhoto['f-photo']||null;
  if(type!=='adjust'&&(!amount||amount<=0)){showToast('Enter an amount.',true);return;}
  if(type==='adjust'&&(isNaN(amount)||amount===0)){showToast('Enter a non-zero amount.',true);return;}
  e.amount=amount;
  if(type==='payment'){
    const v=_acctVendor(g('f-vendor'));if(!v){showToast('Pick a vendor.',true);return;}
    e.vendorId=v._id;e.vendorName=v.name;e.account=g('f-acc')||'cash';
    if(!_acctIsMoney(e.account)&&e.account!==ACCT_OTHER.key){showToast('Pick where it was paid from.',true);return;}
    if(e.account==='mcb'&&!e.photo){showToast('Attach the transfer proof for an MCB payment.',true);return;}
    // settled outside the books: the note is the only record of HOW
    if(e.account===ACCT_OTHER.key&&!e.note){showToast('Say in the note how this was settled — nothing else records it.',true);return;}
    const bal=_acctVendorBalance(v._id);
    if(amount>bal&&!confirm(`${v.name} is owed ${_acctPKR(bal)} but you are paying ${_acctPKR(amount)} — the difference becomes an advance on their account. Continue?`))return;
  }else if(type==='cash_in'){
    e.account=g('f-acc')||'cash';e.via=g('f-via')||'cash';e.person=(g('f-person')||'').trim();
    if(session.role!=='store')e.status='pending';
  }else if(type==='transfer'){
    e.account=g('f-acc');e.toAccount=g('f-to');
    if(!e.account||!e.toAccount||e.account===e.toAccount){showToast('From and To must be different accounts.',true);return;}
  }else if(type==='float_out'){
    e.person=(g('f-person')||'').trim();e.account=g('f-acc')||'cash';e.category=(g('f-cat')||'').trim();
    if(!e.person){showToast('Who is taking the float?',true);return;}
    if(!e.category||e.category===_ACCT_NEW_CAT){showToast('Pick a category — what is the runner sent for?',true);return;}
    const b=_acctBalances();
    if(amount>b[e.account]&&!confirm(`${_acctAccountLabel(e.account)} shows only ${_acctPKR(b[e.account])}. Record anyway?`))return;
  }else if(type==='float_in'){
    const f=_acctOpenFloats().find(x=>x.id===g('f-float'));if(!f){showToast('Pick a float.',true);return;}
    if(amount>f.left){showToast(`Only ${_acctPKR(f.left)} is outstanding on that float.`,true);return;}
    e.floatId=f.id;e.person=f.person;e.account=g('f-acc')||'cash';
  }else if(type==='runner_pay'){
    e.person=(g('f-person')||'').trim();e.account=g('f-acc')||'cash';
    const owed=_acctRunnerOwedTo(e.person);
    if(!e.person||!owed){showToast('Pick a runner who is owed something.',true);return;}
    if(!_acctIsMoney(e.account)&&e.account!==ACCT_OTHER.key){showToast('Pick where it was paid from.',true);return;}
    if(e.account==='mcb'&&!e.photo){showToast('Attach the transfer proof for an MCB payment.',true);return;}
    if(e.account===ACCT_OTHER.key&&!e.note){showToast('Say in the note how this was settled — nothing else records it.',true);return;}
    // never over-settle: a runner is owed exactly the excess, no more
    if(amount>owed){showToast(`${e.person} is owed only ${_acctPKR(owed)}.`,true);return;}
  }else if(type==='adjust'){
    e.account=g('f-acc')||'cash';if(!e.note){showToast('A reason is required.',true);return;}
  }
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const row=await _acctWrite(e);
  if(row){
    delete window._acctPhoto['f-photo'];
    showToast(row.status==='pending'?'Recorded — pending Raees\'s confirmation':`${_acctPKR(Math.abs(amount))} recorded ✓`);
    window.acctModalClose();_acctRerender();
  }else if(btn){btn.disabled=false;btn.textContent='Record';}
};

/* ── PURCHASE FORM (lines with rates → inventory) ── */
// A purchase is one of two things (Afnan, 23 Sept 2026: "the logic is wrong
// … if its not a inventory, like its maintenance work for paint job, how
// will we record them as they have nothing to do with inventory"):
//   stock   — lines with a quantity and a rate; a store item posts to inventory
//   expense — work or a service: what was done and what it cost, nothing else
// Both are `type:'purchase'` on the ledger (one uniform log); an expense is
// stored as one description line at qty 1 with `expense:true`, so every
// reader — the statement, aging, the Excel sheets — needs no second shape.
const ACCT_PURCHASE_KINDS=[
  {key:'stock',  label:'Stock purchase',   sub:'items with a quantity and a rate'},
  {key:'expense',label:'Expense / service',sub:'work, repairs, transport — no inventory'}
];
function _acctPurchaseKindFor(v){return v&&(v.kind==='service'||v.kind==='utility')?'expense':'stock';}
function _acctKindChips(sel){
  return `<div class="acct-chips" id="f-kind-chips">${ACCT_PURCHASE_KINDS.map(k=>`<button type="button" class="acct-chipbtn${sel===k.key?' on':''}" data-v="${k.key}" onclick="window.acctPurchaseKind('${k.key}')">${k.label}<small>${k.sub}</small></button>`).join('')}<input type="hidden" id="f-kind" value="${_acctEsc(sel)}"></div>`;
}
window.acctPurchaseKind=function(k){
  if(!ACCT_PURCHASE_KINDS.some(x=>x.key===k))k='stock';
  const h=document.getElementById('f-kind');if(h)h.value=k;
  document.querySelectorAll('#f-kind-chips .acct-chipbtn').forEach(b=>b.classList.toggle('on',b.dataset.v===k));
  const st=document.getElementById('acct-stock-wrap'),ex=document.getElementById('acct-expense-wrap');
  if(st)st.style.display=k==='stock'?'':'none';
  if(ex)ex.style.display=k==='expense'?'':'none';
  _acctTotalPaint();
  if(k==='expense')setTimeout(()=>document.getElementById('f-exp-desc')?.focus(),20);
};
function _acctPurchaseForm(pre){
  const v=_acctVendor(pre.vendorId);
  _acctFormLines=[];
  const floats=_acctOpenFloats();
  const defSource=pre.source||(v&&v.terms&&['credit','monthly','weekly'].includes(v.terms.mode)?'credit':'cash');
  const src=[{key:'cash',label:'Cash'},{key:'mcb',label:'MCB'},{key:'credit',label:'On credit',sub:'adds to what they are owed'}].concat(floats.map(f=>({key:'float:'+f.id,label:'Float · '+f.person,sub:_acctPKR(f.left)+' left'})));
  const kind=pre.kind||_acctPurchaseKindFor(v);
  const cat=pre.category||(v&&v.kind==='utility'?'Utilities':(v&&v.kind==='service'?'Maintenance & repairs':'Store purchase'));
  // Does it have a vendor? A vendor picked (or the form opened from a
  // vendor's page) says yes; otherwise the category's own default decides
  // (ACCT_VENDOR_CATS), and the chips let either answer be changed.
  const hasV=pre.hasVendor!=null?!!pre.hasVendor:(v?true:_acctCatHasVendor(cat));
  const payees=_acctPayees();
  const body=`<div class="form-grid">
    <div class="field" style="grid-column:1/-1"><label>Does it have a vendor? *</label><div class="acct-chips" id="f-hasv-chips"><button type="button" class="acct-chipbtn${hasV?' on':''}" data-v="yes" onclick="window.acctPurchaseHasVendor(true)">Yes — a vendor account<small>store purchase, a regular supplier</small></button><button type="button" class="acct-chipbtn${hasV?'':' on'}" data-v="no" onclick="window.acctPurchaseHasVendor(false)">No — just a bill<small>repairs, wages, fuel, stationery…</small></button><input type="hidden" id="f-hasv" value="${hasV?'yes':'no'}"></div></div>
    <div class="field" style="grid-column:1/-1${hasV?'':';display:none'}" id="f-vendor-wrap"><label>Vendor *</label><select id="f-vendor" onchange="window.acctPurchaseVendorChanged(this.value)">${_acctVendorOptions(pre.vendorId)}</select><div id="f-vendor-hint" style="font-size:13px;color:var(--muted);margin-top:4px">${v?_acctEsc(_acctTermsLabel(v))+(_acctVendorBalance(v._id)?' · owed '+_acctPKR(_acctVendorBalance(v._id)):''):''}</div></div>
    <div class="field" style="grid-column:1/-1${hasV?';display:none':''}" id="f-payee-wrap"><label>Paid to *</label><input id="f-payee" list="acct-payees" placeholder="Who was paid — e.g. Ali electrician, PSO pump" value="${_acctEsc(pre.payee||'')}"><datalist id="acct-payees">${payees.map(n=>`<option value="${_acctEsc(n)}">`).join('')}</datalist><div style="font-size:13px;color:var(--muted);margin-top:4px">No vendor account — nothing goes on credit, and the bill photo is <b>required above ${_acctPKR(ACCT_NOVENDOR_PHOTO_ABOVE)}</b>.</div></div>
    ${_acctDateField('f-date')}
    <div class="field"><label>Bill / invoice no.</label><input id="f-ref" placeholder="optional"></div>
    <div class="field"><label>Category</label><select id="f-cat" onchange="window.acctCatChange(this);window.acctPurchaseCatChanged()">${_acctCatOptions(cat)}</select></div>
    <div class="field"><label>Note</label><input id="f-note" placeholder="optional"></div>
    <div class="field" style="grid-column:1/-1"><label>What is this? *</label>${_acctKindChips(kind)}</div>
  </div>
  <div id="acct-expense-wrap" class="form-grid" style="${kind==='expense'?'':'display:none'}">
    <div class="field" style="grid-column:1/-1"><label>What was done *</label><input id="f-exp-desc" placeholder="e.g. paint job for the studio" value="${_acctEsc(pre.desc||'')}"></div>
    <div class="field"><label>Amount (₨) *</label><input id="f-exp-amount" type="number" inputmode="numeric" min="1" step="1" placeholder="0" value="${_acctEsc(pre.amount||'')}" oninput="_acctTotalPaint()"></div>
    <div class="field" style="align-self:end;font-size:13px;color:var(--muted)">Nothing goes into inventory — this is money spent on work or a service.</div>
  </div>
  <div id="acct-stock-wrap" style="${kind==='stock'?'':'display:none'}">
  <div class="acct-lines-head"><span>Lines · pick a store item to post it into inventory, or type a description</span><button type="button" class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="window.acctLineAdd()">+ Line</button></div>
  <datalist id="acct-items-dl">${(typeof allItems!=='undefined'?allItems:[]).map(i=>`<option value="${_acctEsc(i.code)}">${_acctEsc(i.name)}${i.unit?' ('+_acctEsc(i.unit)+')':''}</option>`).join('')}</datalist>
  <div id="acct-lines"></div>
  </div>
  <div class="acct-total"><span>Total</span><b id="f-total">₨0</b></div>
  <div class="form-grid" style="margin-top:12px">
    <div class="field" style="grid-column:1/-1"><label>Paid via *</label>${_acctAccountChips('f-source',defSource,src.slice(2))}</div>
    <div class="field" style="grid-column:1/-1" id="f-src-hint" style="font-size:13px"></div>
    <div class="field" style="grid-column:1/-1"><label>Receipt / bill photo <span id="f-photo-req" style="font-weight:400"></span></label>${_acctPhotoField('f-photo','Attach the bill')}</div>
  </div>`;
  _acctModal('Record purchase',body,`<button class="btn-outline" onclick="window.acctModalClose()">Cancel</button><button class="btn-primary" style="width:auto;margin:0;padding:10px 18px" id="f-submit" onclick="window.acctSubmitPurchase()">Record purchase</button>`,{sticky:true,width:720});
  // The chip builder paints ONLY cash/mcb balances; strip those from credit/float chips' labels — already handled (no balance key).
  window.acctLineAdd();
  window.acctPurchaseHasVendor(hasV);
}
// Everyone a vendor-less bill was paid to, most recent first — the
// datalist behind "Paid to", derived from the entries like the runner list.
function _acctPayees(){
  const out=[];const seen=new Set();
  for(const e of (acctEntries||[])){if(!e||e.status==='void'||!e.payee)continue;const k=String(e.payee).trim().toLowerCase();if(!k||seen.has(k))continue;seen.add(k);out.push(String(e.payee).trim());}
  return out;
}
// The vendor / no-vendor switch on the purchase form. With no vendor the
// vendor select hides and "Paid to" shows; "On credit" disappears from
// Paid via (nobody to owe) and a credit pick falls back to Cash.
window.acctPurchaseHasVendor=function(yes){
  yes=!!yes;
  const h=document.getElementById('f-hasv');if(h)h.value=yes?'yes':'no';
  document.querySelectorAll('#f-hasv-chips .acct-chipbtn').forEach(b=>b.classList.toggle('on',(b.dataset.v==='yes')===yes));
  const vw=document.getElementById('f-vendor-wrap'),pw=document.getElementById('f-payee-wrap');
  if(vw)vw.style.display=yes?'':'none';
  if(pw)pw.style.display=yes?'none':'';
  const credit=document.querySelector('#f-source-chips .acct-chipbtn[data-v="credit"]');
  if(credit)credit.style.display=yes?'':'none';
  const src=document.getElementById('f-source');
  if(!yes&&src&&src.value==='credit')window.acctChip('f-source','cash');   // repaints the hint itself
  else window.acctPurchaseSourceChanged();
};
// The category decides the DEFAULT answer; a vendor already picked keeps it.
window.acctPurchaseCatChanged=function(){
  const c=document.getElementById('f-cat');if(!c||c.value===_ACCT_NEW_CAT)return;
  const v=document.getElementById('f-vendor');
  if(v&&v.value&&v.value!=='__new__')return;
  window.acctPurchaseHasVendor(_acctCatHasVendor(c.value));
};
window.acctPurchaseVendorChanged=function(v){
  if(v==='__new__'){window.acctVendorWizard(null,null,{then:id=>window.acctForm('purchase',{vendorId:id})});return;}
  const vd=_acctVendor(v);const el=document.getElementById('f-vendor-hint');
  if(el)el.innerHTML=vd?_acctEsc(_acctTermsLabel(vd))+(_acctVendorBalance(vd._id)?' · owed '+_acctPKR(_acctVendorBalance(vd._id)):''):'';
  if(vd&&vd.terms)window.acctChip('f-source',vd.terms.mode==='cash'?'cash':'credit');
  if(vd)window.acctPurchaseKind(_acctPurchaseKindFor(vd));
  // refresh rate hints on existing lines
  _acctFormLines.forEach((l,i)=>window.acctLineItem(i,l.itemCode,true));
};
window.acctPurchaseSourceChanged=function(){
  const s=document.getElementById('f-source')?.value||'';const el=document.getElementById('f-src-hint');const req=document.getElementById('f-photo-req');
  const rr=_acctSettings().receiptRequiredAbove;
  if(el){
    if(s==='credit')el.innerHTML=`<span style="color:var(--accent-warning)">Goes on the vendor's account — pay it later from their page.</span>`;
    else if(s.startsWith('float:')){const f=_acctOpenFloats().find(x=>'float:'+x.id===s);el.innerHTML=f?`Paid out of <b>${_acctEsc(f.person)}</b>'s float (${_acctPKR(f.left)} still to account for)${f.category?` · started as <b>${_acctEsc(f.category)}</b>`:''}.`:'';
      // a bill paid from a float starts in the float's own category — the
      // purpose the runner was sent for — and the pick can still be changed
      const cat=document.getElementById('f-cat');
      if(f&&f.category&&cat&&_acctCategories().includes(f.category)){cat.value=f.category;cat.dataset.prev=f.category;}}
    else el.innerHTML='';
  }
  const noV=(document.getElementById('f-hasv')||{}).value==='no';
  if(req)req.textContent=noV?`(required above ${_acctPKR(ACCT_NOVENDOR_PHOTO_ABOVE)} — the bill is the only proof)`:(rr?`(needed above ${_acctPKR(rr)} or it is flagged for review)`:'');
};
// A new line starts at quantity 1: a service bill ("paint job for the
// studio") has no quantity of its own, so its amount goes in Rate and the
// line's total IS the amount. A store item's real quantity is typed over it.
function _acctNewLine(){return {itemCode:'',desc:'',qty:'1',unit:'',rate:'',sizes:null,sizeSpecific:false};}
window.acctLineAdd=function(){
  _acctFormLines.push(_acctNewLine());
  _acctLinesRender();
  const n=_acctFormLines.length-1;setTimeout(()=>document.getElementById('l-item-'+n)?.focus(),20);
};
window.acctLineRemove=function(i){_acctFormLines.splice(i,1);if(!_acctFormLines.length)_acctFormLines.push(_acctNewLine());_acctLinesRender();};
// One line of the purchase form. Pure (no DOM), so the layout probe can
// render the REAL row — it used to hand-roll a copy with a shorter
// placeholder than the one shipped, and measured that instead.
function _acctLineHTML(l,i){
  return `<div class="acct-line" id="l-row-${i}">
    <input id="l-item-${i}" class="li" list="acct-items-dl" placeholder="Item code" value="${_acctEsc(l.itemCode)}" onchange="window.acctLineItem(${i},this.value)" title="Store item code — leave blank for anything that is not a store item">
    <input id="l-desc-${i}" class="ld" placeholder="What was bought — e.g. paint job for studio" value="${_acctEsc(l.desc)}" oninput="window.acctLineSet(${i},'desc',this.value)">
    <input id="l-qty-${i}" class="ln" type="number" inputmode="decimal" min="0" step="any" placeholder="Qty" value="${_acctEsc(l.qty)}" oninput="window.acctLineSet(${i},'qty',this.value)" ${l.sizeSpecific?'readonly title="Sum of the sizes below"':''}>
    <input id="l-unit-${i}" class="lu" placeholder="unit" value="${_acctEsc(l.unit)}" oninput="window.acctLineSet(${i},'unit',this.value)">
    <input id="l-rate-${i}" class="ln" type="number" inputmode="decimal" min="0" step="any" placeholder="Rate ₨" value="${_acctEsc(l.rate)}" oninput="window.acctLineSet(${i},'rate',this.value)">
    <span class="lt" id="l-tot-${i}">${_acctPKR((Number(l.qty)||0)*(Number(l.rate)||0))}</span>
    <button type="button" class="acct-x" onclick="window.acctLineRemove(${i})" title="Remove line">×</button>
    <div class="acct-line-sub" id="l-sub-${i}">${_acctLineSubHTML(l,i)}</div>
  </div>`;
}
function _acctLinesRender(){
  const box=document.getElementById('acct-lines');if(!box)return;
  box.innerHTML=_acctFormLines.map(_acctLineHTML).join('');
  _acctTotalPaint();
}
function _acctLineSubHTML(l,i){
  let h='';
  if(l.sizeSpecific){h+=`<div class="acct-sizes">${Object.keys(l.sizes||{}).map(sz=>`<label>${_acctEsc(sz)}<input type="number" inputmode="numeric" min="0" value="${_acctEsc(l.sizes[sz]||'')}" placeholder="0" oninput="window.acctLineSize(${i},'${_acctEsc(sz)}',this.value)"></label>`).join('')}</div>`;}
  if(l.hint)h+=`<div class="acct-line-hint">${l.hint}</div>`;
  return h;
}
window.acctLineItem=function(i,code,keep){
  const l=_acctFormLines[i];if(!l)return;
  code=(code||'').trim().toUpperCase();
  const items=typeof allItems!=='undefined'?allItems:[];
  let item=items.find(x=>x.code===code);
  if(!item&&code){const m=items.filter(x=>x.code.startsWith(code)||(x.name||'').toUpperCase().includes(code));if(m.length===1)item=m[0];}
  l.itemCode=item?item.code:'';
  if(item){
    if(!keep||!l.desc)l.desc=item.name;
    l.unit=item.unit||l.unit;
    l.sizeSpecific=!!item.sizeSpecific;
    l.sizes=item.sizeSpecific?Object.keys(item.sizes||{}).reduce((o,k)=>{o[k]=(l.sizes&&l.sizes[k])||'';return o;},{}):null;
    const vId=document.getElementById('f-vendor')?.value||'';
    const r=_acctLatestRate(item.code,vId);
    if(r){if(!keep||!l.rate)l.rate=r.rate;l.hint=`Last bought @ ${_acctPKR(r.rate)} on ${_acctDateLabel(r.date)}${r.vendorName?' from '+_acctEsc(r.vendorName):''}`;}
    else l.hint='First purchase of this item — the rate you enter becomes its rate card.';
    const stock=item.sizeSpecific?Object.values(item.sizes||{}).reduce((s,v)=>s+(parseInt(v)||0),0):(parseInt(item.balance)||0);
    l.hint+=` · in stock now: ${stock} ${_acctEsc(item.unit||'')}`;
  }else{
    if(code){l.hint=`<span style="color:var(--accent-warning)">“${_acctEsc(code)}” is not a store item — this line will not post to inventory.</span>`;}else l.hint='';
    l.sizeSpecific=false;l.sizes=null;
  }
  _acctLinesRender();
  if(!keep)setTimeout(()=>document.getElementById(item?'l-qty-'+i:'l-desc-'+i)?.focus(),20);
};
window.acctLineSet=function(i,k,v){const l=_acctFormLines[i];if(!l)return;l[k]=v;const t=document.getElementById('l-tot-'+i);if(t)t.textContent=_acctPKR((Number(l.qty)||0)*(Number(l.rate)||0));_acctTotalPaint();};
window.acctLineSize=function(i,sz,v){const l=_acctFormLines[i];if(!l||!l.sizes)return;l.sizes[sz]=v;const sum=Object.values(l.sizes).reduce((s,x)=>s+(Number(x)||0),0);l.qty=sum||'';const q=document.getElementById('l-qty-'+i);if(q)q.value=l.qty;window.acctLineSet(i,'qty',l.qty);};
function _acctFormTotal(){
  const kind=document.getElementById('f-kind')?.value||'stock';
  if(kind==='expense')return Math.round(Number(document.getElementById('f-exp-amount')?.value)||0);
  return _acctFormLines.reduce((s,l)=>s+Math.round((Number(l.qty)||0)*(Number(l.rate)||0)),0);
}
function _acctTotalPaint(){const t=document.getElementById('f-total');if(t)t.textContent=_acctPKR(_acctFormTotal());}
window.acctSubmitPurchase=async function(){
  const g=id=>{const el=document.getElementById(id);return el?el.value:'';};
  const hasV=g('f-hasv')!=='no';
  const v=hasV?_acctVendor(g('f-vendor')):null;
  if(hasV&&!v){showToast('Pick a vendor — or say it has none.',true);return;}
  const payee=hasV?'':(g('f-payee')||'').trim();
  if(!hasV&&!payee){showToast('Who was paid? Fill in Paid to.',true);return;}
  const kind=g('f-kind')||'stock';
  const lines=[];let expense=false;
  if(kind==='expense'){
    const desc=(g('f-exp-desc')||'').trim();const amt=Math.round(Number(g('f-exp-amount'))||0);
    if(!desc){showToast('Say what the work or service was.',true);return;}
    if(amt<=0){showToast('Enter the amount.',true);return;}
    lines.push({itemCode:'',desc,qty:1,unit:'',rate:amt,total:amt});expense=true;
  }else for(const [i,l] of _acctFormLines.entries()){
    const rate=Number(l.rate)||0;
    // A blank quantity beside an amount is a lump sum (a service bill):
    // the amount IS the total, so the quantity is one.
    const qty=String(l.qty==null?'':l.qty).trim()===''?(rate>0?1:0):(Number(l.qty)||0);
    let desc=(l.desc||l.itemCode||'').trim();
    if(!l.itemCode&&!desc){
      if(rate<=0)continue;                 // an untouched line
      // Never drop a line that carries an amount.
      showToast(`Line ${i+1} has an amount but no description — say what it was for (or switch to Expense / service).`,true);return;
    }
    if(qty<=0){showToast(`Enter a quantity for ${desc}.`,true);return;}
    if(rate<0){showToast('A rate cannot be negative.',true);return;}
    const line={itemCode:l.itemCode||'',desc,qty,unit:(l.unit||'').trim(),rate,total:Math.round(qty*rate)};
    if(l.sizeSpecific&&l.sizes){line.sizes={};for(const [k,x] of Object.entries(l.sizes)){if(Number(x))line.sizes[k]=Number(x);}}
    lines.push(line);
  }
  if(!lines.length){showToast('Add at least one line — or switch to Expense / service if nothing was bought for stock.',true);return;}
  const amount=lines.reduce((s,l)=>s+l.total,0);
  if(amount<=0){showToast('The total is zero — enter each line\'s rate (or, for a service, its amount).',true);return;}
  const src=g('f-source')||'cash';
  const e=_acctBase('purchase');
  if(v){e.vendorId=v._id;e.vendorName=v.name;}else e.payee=payee;
  e.date=g('f-date')||_acctToday();e.ref=(g('f-ref')||'').trim();e.category=g('f-cat')||'';e.note=(g('f-note')||'').trim();e.photo=window._acctPhoto['f-photo']||null;e.lines=lines;e.amount=amount;
  if(expense)e.expense=true;
  // No vendor: the bill IS the record, so above the threshold it must be attached.
  if(!v&&amount>ACCT_NOVENDOR_PHOTO_ABOVE&&!e.photo){showToast(`Attach the bill photo — it is required above ${_acctPKR(ACCT_NOVENDOR_PHOTO_ABOVE)} when there is no vendor.`,true);return;}
  if(src==='credit'&&!v){showToast('Nothing can go on credit without a vendor — pay it from Cash, MCB or a float.',true);return;}
  if(src==='credit'){e.source='credit';e.account=null;
    const lim=v.terms&&parseInt(v.terms.creditLimit)||0;
    if(lim&&_acctVendorBalance(v._id)+amount>lim&&!confirm(`This takes ${v.name}'s balance to ${_acctPKR(_acctVendorBalance(v._id)+amount)}, over the ${_acctPKR(lim)} credit limit. Record anyway?`))return;
  }else if(src.startsWith('float:')){
    const f=_acctOpenFloats().find(x=>'float:'+x.id===src);if(!f){showToast('That float is no longer open.',true);return;}
    // Over the float: the excess is owed to the runner until it is settled
    if(amount>f.left&&!confirm(`This bill (${_acctPKR(amount)}) is ${_acctPKR(amount-f.left)} more than the ${_acctPKR(f.left)} left on ${f.person}'s float. The extra will be owed to ${f.person} until it is settled. Record it?`))return;
    e.source='float';e.floatId=f.id;e.person=f.person;e.account=null;
  }else{e.source=src;e.account=src;
    const b=_acctBalances();if(amount>b[src]&&!confirm(`${_acctAccountLabel(src)} shows only ${_acctPKR(b[src])}. Record anyway?`))return;
  }
  const btn=document.getElementById('f-submit');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const row=await _acctWrite(e);
  if(!row){if(btn){btn.disabled=false;btn.textContent='Record purchase';}return;}
  delete window._acctPhoto['f-photo'];
  window.acctModalClose();
  showToast(`${_acctPKR(amount)} recorded ✓`+(lines.some(l=>l.itemCode)?' · posting stock…':''));
  _acctRerender();
  if(lines.some(l=>l.itemCode)){await _acctPostStock(row);_acctRerender();if(row.stockPosted)showToast('Stock posted into inventory ✓');}
};

/* ════════════════════════ ENTRY DETAIL ════════════════════════ */
window.acctOpenEntry=function(id){
  const e=_acctById(id);if(!e){showToast('Entry not found.',true);return;}
  const fx=_acctEffect(Object.assign({},e,{status:'posted'}));
  const kv=(k,v)=>v?`<div class="acct-kv"><span>${k}</span><b>${v}</b></div>`:'';
  let lines='';
  if(e.expense&&e.lines&&e.lines[0]){
    lines=`<div class="acct-kv-grid" style="margin-top:8px">${kv('Work / service',_acctEsc(e.lines[0].desc||''))}${kv('Amount',_acctPKR(e.lines[0].total))}</div>`;
  }else if(e.lines&&e.lines.length){
    lines=`<table class="acct-table" style="margin-top:10px"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Total</th></tr></thead><tbody>${e.lines.map(l=>`<tr><td class="part">${_acctEsc(l.desc||l.itemCode)}${l.itemCode?` <span class="ref">${_acctEsc(l.itemCode)}</span>`:''}${l.sizes?`<div style="font-size:12px;color:var(--muted)">${Object.entries(l.sizes).map(([k,v])=>k+': '+v).join(' · ')}</div>`:''}</td><td class="num">${l.qty} ${_acctEsc(l.unit||'')}</td><td class="num">${_acctPKR(l.rate)}</td><td class="num bal">${_acctPKR(l.total)}</td></tr>`).join('')}</tbody></table>`;
  }
  let float='';
  if(e.type==='float_out'){const f=_acctBalances().floats[e._id];if(f){const left=f.out-f.used-f.back;float=`<div class="acct-kv-grid" style="margin-top:8px">${kv('Spent on bills',_acctPKR(f.used))}${kv('Change returned',_acctPKR(f.back))}${kv('Still to account for',left>0?`<span style="color:var(--accent-urgent)">${_acctPKR(left)}</span>`:(left<0?`<span style="color:var(--accent-urgent)">over by ${_acctPKR(-left)} — owed to ${_acctEsc(f.person)}</span>`:'<span style="color:var(--accent-success)">closed ✓</span>'))}</div>${left>0&&_acctCanEntry()&&e.status!=='void'?`<div style="display:flex;gap:8px;margin-top:8px"><button class="btn-outline" onclick="window.acctModalClose();window.acctForm('purchase',{source:'float:${e._id}',category:_acctById('${e._id}')?.category||''})">Record a bill from it</button><button class="btn-outline" onclick="window.acctModalClose();window.acctForm('float_in',{floatId:'${e._id}'})">Change back</button></div>`:''}`;}}
  const body=`
    <div class="acct-kv-grid">
      ${kv('Type',ACCT_TYPES[e.type]?ACCT_TYPES[e.type].label:e.type)}${kv('Date',_acctDateLabel(e.date))}${kv('Amount',_acctPKR(e.amount))}
      ${kv('Vendor',e.vendorId&&_acctVendorName(e)?`<a class="acct-link" onclick="window.acctModalClose();window.acctOpenVendor('${e.vendorId}')">${_acctEsc(_acctVendorName(e))}</a>`:'')}${kv('Paid to',!e.vendorId&&e.payee?_acctEsc(e.payee)+' <span class="acct-chip">no vendor account</span>':'')}${kv('Person',e.type==='runner_pay'||e.type==='float_out'||e.type==='float_in'?`<a class="acct-link" onclick="window.acctModalClose();window.acctOpenRunner(this.textContent)">${_acctEsc(e.person)}</a>`:_acctEsc(e.person))}
      ${kv('Source / account',_acctEsc(_acctSourceLabel(e)))}${e.toAccount?kv('To',_acctAccountLabel(e.toAccount)):''}
      ${kv('Ref',_acctEsc(e.ref))}${kv('Category',e.category?`<a class="acct-link" onclick="window.acctModalClose();window.acctOpenCategory(this.textContent)">${_acctEsc(e.category)}</a>`:'')}${kv('Note',_acctEsc(e.note))}
      ${kv('Entered by',_acctEsc(e.byName||e.by)+' · '+new Date(e.ts||0).toLocaleString('en-PK'))}
      ${kv('Effect',[fx.cash?'Cash '+_acctSigned(fx.cash):'',fx.mcb?'MCB '+_acctSigned(fx.mcb):'',fx.payable?'Owed to vendor '+_acctSigned(fx.payable):'',fx.floatUsed?'Float used '+_acctPKR(fx.floatUsed):'',fx.floatBack?'Float returned '+_acctPKR(fx.floatBack):'',fx.runnerPaid?'Owed to runner '+_acctSigned(-fx.runnerPaid):''].filter(Boolean).join(' · '))}
      ${e.vendorBillAmount!=null?kv("Vendor's bill",_acctPKR(e.vendorBillAmount)+(Math.round(e.vendorBillAmount)===Math.round(e.amount)?' <span class="acct-chip ok">matches</span>':` <span class="acct-chip urgent">${_acctSigned(Math.round(e.vendorBillAmount)-Math.round(e.amount))} vs ours</span>`)):''}
      ${e.stockPosted===true?kv('Inventory','<span class="acct-chip ok">stock posted ✓</span>'):(e.stockPosted===false?kv('Inventory',`<span class="acct-chip urgent">not posted</span> ${_acctEsc(e.stockError||'')} ${_acctCanEntry()&&e.status!=='void'?`<button class="btn-outline" style="padding:3px 8px;font-size:12px" onclick="window.acctRetryStock('${e._id}')">Retry</button>`:''}`):'')}
      ${e.status==='pending'?kv('Status','<span class="acct-chip warn">pending confirmation</span>'):''}
      ${e.status==='void'?kv('Status',`<span class="acct-chip">VOID</span> by ${_acctEsc(e.voidedBy)} · ${new Date(e.voidedAt||0).toLocaleString('en-PK')}<br>${_acctEsc(e.voidReason)}`):''}
      ${e.needsReview?kv('Review',e.reviewedAt?`cleared by ${_acctEsc(e.reviewedBy)}`:`<span class="acct-chip urgent">${(e.reviewFlags||[]).join(', ')}</span>`):''}
      ${e.legacyId?kv('Imported','from the old cash ledger'):''}
    </div>
    ${lines}${float}
    ${e.photo?`<a href="${_acctEsc(e.photo)}" target="_blank" rel="noopener" class="acct-photo-link">📎 View attached receipt</a>`:''}`;
  const foot=[
    e.status==='pending'&&_acctCanEntry()?`<button class="btn-primary" style="width:auto;margin:0;padding:9px 14px" onclick="window.acctConfirmCashIn('${e._id}')">Confirm received</button>`:'',
    e.needsReview&&!e.reviewedAt&&e.status!=='void'&&_acctCanAdmin()?`<button class="btn-outline" onclick="window.acctReview('${e._id}');window.acctModalClose()">Clear review</button>`:'',
    e.status!=='void'&&_acctCanEntry()?`<button class="btn-outline" style="color:var(--accent-urgent);border-color:var(--accent-urgent)" onclick="window.acctVoid('${e._id}')">Void…</button>`:'',
    // A bill generated from a daily log carries its month in meterKey; the
    // PDF is the same one the consumables page prints, reachable from the
    // vendor page's statement through this detail.
    e.meterKey&&e.vendorId?`<button class="btn-outline" onclick="window.acctConsPdf('${e.vendorId}','${_acctEsc(String(e.meterKey).slice(-7))}')">Print log (PDF)</button>`:'',
    _acctIsSuper()?`<button class="btn-outline acct-super" onclick="window.acctAdminEdit('${e._id}')">Edit (admin)…</button><button class="btn-outline acct-super" style="color:var(--accent-urgent);border-color:var(--accent-urgent)" onclick="window.acctAdminDelete('${e._id}')">Delete (admin)…</button>`:'',
    `<button class="btn-outline" onclick="window.acctModalClose()">Close</button>`
  ].filter(Boolean).join('');
  _acctModal(_acctEsc(_acctParticulars(e)),body,foot,{width:620});
};

/* ════════════════════════ ADMIN TOOLS (Afnan only) ════════════════════════
   Afnan: "put a button in afnan view only to reset + edit + delete record
   of things." The module's standing rule is void-never-edit and
   nothing-is-deleted, and that rule stays for everyone else — these are
   the owner's own correction tools, gated on _acctIsSuper() here and on
   isAcctSuper() in firestore.rules, so a UI leak is not a boundary leak.
   None of them touch inventory: a purchase that posted stock keeps its
   store_transactions rows, and every confirm says so. */
// The fields an admin edit may rewrite. Effects are DERIVED from these at
// render (_acctEffect), so changing an amount or an account re-balances
// every book without a stored balance to fix. `month` follows `date`
// because the loader range-queries on it.
const _ACCT_ADMIN_FIELDS=['date','amount','vendorId','payee','person','account','toAccount','source','category','ref','note'];
window.acctAdminEdit=function(id){
  if(!_acctIsSuper())return;
  const e=_acctById(id);if(!e){showToast('Entry not found.',true);return;}
  const T=ACCT_TYPES[e.type]||{label:e.type};
  // Other is a payment-only choice; offering it on a cash_in would mint money from nowhere
  const accOpts=(sel,other)=>`<option value="">— none —</option>`+ACCT_ACCOUNTS.concat(other?[ACCT_OTHER]:[]).map(a=>`<option value="${a.key}"${sel===a.key?' selected':''}>${_acctEsc(a.label)}</option>`).join('');
  const srcOpts=sel=>['','cash','mcb','credit','float'].map(k=>`<option value="${k}"${(sel||'')===k?' selected':''}>${k||'— none —'}</option>`).join('');
  const body=`
    <div class="acct-alert info" style="cursor:default;margin-bottom:10px">Admin correction of a <b>${_acctEsc(T.label)}</b> entered by ${_acctEsc(e.byName||e.by)}. The change is written in place and logged under your name. ${e.stockPosted===true?'<b>Inventory is not touched</b> — the stock this purchase posted stays as it is.':''}${e.status==='void'?' This entry is VOID; editing does not un-void it.':''}</div>
    <div class="form-grid">
      <div class="field"><label>Date</label><input id="ae-date" type="date" value="${_acctEsc(e.date||'')}"></div>
      <div class="field"><label>Amount (₨)${e.type==='adjust'?' — signed':''}</label><input id="ae-amount" type="number" inputmode="numeric" value="${Math.round(e.amount||0)}"></div>
      <div class="field"><label>Vendor</label><select id="ae-vendor"><option value="">— none —</option>${acctVendors.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(v=>`<option value="${v._id}"${e.vendorId===v._id?' selected':''}>${_acctEsc(v.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Paid to (no vendor)</label><input id="ae-payee" value="${_acctEsc(e.payee||'')}"></div>
      <div class="field"><label>Person</label><input id="ae-person" value="${_acctEsc(e.person||'')}"></div>
      <div class="field"><label>Account</label><select id="ae-account">${accOpts(e.account,e.type==='payment'||e.type==='runner_pay')}</select></div>
      <div class="field"><label>To account (transfer)</label><select id="ae-to">${accOpts(e.toAccount)}</select></div>
      <div class="field"><label>Source (purchase)</label><select id="ae-source">${srcOpts(e.source)}</select></div>
      <div class="field"><label>Category</label><input id="ae-category" value="${_acctEsc(e.category||'')}"></div>
      <div class="field"><label>Ref</label><input id="ae-ref" value="${_acctEsc(e.ref||'')}"></div>
      <div class="field" style="grid-column:1/-1"><label>Note</label><input id="ae-note" value="${_acctEsc(e.note||'')}"></div>
    </div>`;
  _acctModal('Edit entry (admin)',body,`<button class="btn-outline" onclick="window.acctOpenEntry('${e._id}')">Cancel</button><button class="btn-primary" style="width:auto;margin:0;padding:10px 18px" id="ae-submit" onclick="window.acctAdminSave('${e._id}')">Save changes</button>`,{sticky:true,width:640});
};
// Pure: the patch an admin save writes, from the form's raw values. Only
// the fields that CHANGED are returned, so the activity line names them
// and an untouched entry writes nothing. `month` rides along with `date`.
function _acctAdminPatch(e,vals){
  const p={};
  const date=String(vals.date||'').trim();
  if(date&&date!==e.date){p.date=date;p.month=_acctMonthOf(date);}
  const amt=parseInt(vals.amount);
  if(!isNaN(amt)&&amt!==Math.round(e.amount||0))p.amount=amt;
  const vid=vals.vendorId||null;
  if(vid!==(e.vendorId||null)){p.vendorId=vid;p.vendorName=vid?((_acctVendor(vid)||{}).name||''):'';}
  const str=(k,v)=>{v=String(v||'').trim();if(v!==String(e[k]||''))p[k]=v;};
  str('person',vals.person);str('payee',vals.payee);str('category',vals.category);str('ref',vals.ref);str('note',vals.note);
  const nul=(k,v)=>{v=v||null;if(v!==(e[k]||null))p[k]=v;};
  nul('account',vals.account);nul('toAccount',vals.toAccount);nul('source',vals.source);
  // an expense is one description line whose rate and total ARE the amount
  if(p.amount!=null&&e.expense&&e.lines&&e.lines[0])p.lines=[Object.assign({},e.lines[0],{rate:p.amount,total:p.amount})];
  return p;
}
window.acctAdminSave=async function(id){
  if(!_acctIsSuper())return;
  const e=_acctById(id);if(!e)return;
  const g=k=>{const el=document.getElementById('ae-'+k);return el?el.value:'';};
  const vals={date:g('date'),amount:g('amount'),vendorId:g('vendor'),payee:g('payee'),person:g('person'),account:g('account'),toAccount:g('to'),source:g('source'),category:g('category'),ref:g('ref'),note:g('note')};
  if(vals.date&&vals.date>_acctToday()){showToast('The date cannot be in the future.',true);return;}
  if(e.type!=='adjust'&&!(parseInt(vals.amount)>0)){showToast('Enter an amount above zero.',true);return;}
  const p=_acctAdminPatch(e,vals);
  if(!Object.keys(p).length){showToast('Nothing changed.');window.acctOpenEntry(id);return;}
  const u=_acctUser();
  Object.assign(p,{editedAt:Date.now(),editedBy:u.by});
  const doc=Object.assign({},e,p);delete doc._id;
  const btn=document.getElementById('ae-submit');if(btn)btn.disabled=true;
  try{await fsSet('acct_entries',id,doc);}
  catch(err){if(btn)btn.disabled=false;showToast('Edit refused: '+(err.message||err),true);return;}
  const changed=Object.keys(p).filter(k=>!/^(editedAt|editedBy|month|vendorName|lines)$/.test(k));
  Object.assign(e,p);_acctSort(acctEntries);
  _acctLog('Accounts entry edited (admin)',`${_acctParticulars(e)} ${_acctPKR(e.amount)} — ${changed.join(', ')}`);
  showToast('Entry updated.');window.acctModalClose();_acctRerender();
};
window.acctAdminDelete=async function(id){
  if(!_acctIsSuper())return;
  const e=_acctById(id);if(!e)return;
  const stock=e.stockPosted===true?'\n\nThis purchase posted stock into inventory. Deleting the money entry does NOT reverse that — correct the Store side by hand if needed.':'';
  if(!confirm(`Delete this ${(ACCT_TYPES[e.type]||{}).label||e.type} of ${_acctPKR(e.amount)} dated ${_acctDateLabel(e.date)} for good?\n\nUnlike a void, a deleted entry leaves NO trace on the ledger. There is no undo.${stock}`))return;
  try{await fsDelete('acct_entries',id);}
  catch(err){showToast('Delete refused: '+(err.message||err),true);return;}
  acctEntries=acctEntries.filter(x=>x._id!==id);
  _acctLog('Accounts entry deleted (admin)',`${_acctParticulars(e)} ${_acctPKR(e.amount)} · ${_acctDateLabel(e.date)} · entered by ${e.byName||e.by}`);
  showToast('Entry deleted.');window.acctModalClose();_acctRerender();
};
// Delete a vendor (Afnan only; rules: acct_vendors delete is isAcctSuper()).
// REFUSED while any entry names the vendor — in memory (the live window)
// AND in Firestore (closed months are not loaded), because an entry whose
// vendor is gone drops out of every statement, the payables tile and the
// rate card while still moving Cash. Deactivate is the right tool for a
// vendor with history; delete is for one entered by mistake. A consumable
// vendor's daily meter logs go with it, and the vendor document goes LAST,
// so a refusal part-way leaves the vendor intact and says how far it got.
window.acctVendorDelete=async function(id){
  if(!_acctIsSuper())return;
  const v=_acctVendor(id);if(!v){showToast('Vendor not found.',true);return;}
  const live=acctEntries.filter(e=>e.vendorId===id).length;
  if(live){showToast(`${v.name} has ${live} ledger entr${live===1?'y':'ies'} — delete or void those first, or Deactivate the vendor instead.`,true);return;}
  let older;
  try{older=await fsQueryWhere('acct_entries','vendorId',id,1);}
  catch(err){showToast('Could not check this vendor\'s history ('+(err.message||err)+') — not deleting.',true);return;}
  if(older.length){showToast(`${v.name} has entries in a closed month — Deactivate the vendor instead, or reopen and delete those first.`,true);return;}
  const meterNote=v.kind==='consumable'?'\n\nTheir daily consumable logs are removed with them.':'';
  if(!confirm(`Delete vendor ${v.name} for good?\n\nThey have no ledger entries. The profile, terms and contact details are gone with no undo.${meterNote}`))return;
  let logs=0;
  try{
    if(v.kind==='consumable'){
      const rows=await fsQueryWhere('acct_meter_logs','vendorId',id,1000);
      for(const r of rows){await fsDelete('acct_meter_logs',r._id);logs++;}
    }
    await fsDelete('acct_vendors',id);
  }catch(err){
    showToast(`Delete refused${logs?` after ${logs} log${logs===1?'':'s'}`:''}: ${err.message||err}`,true);return;
  }
  acctVendors=acctVendors.filter(x=>x._id!==id);
  for(const k of Object.keys(_acctMeterCache))if(k.startsWith(id+'|'))delete _acctMeterCache[k];
  _acctLog('Accounts vendor deleted (admin)',`${v.name} · ${v.kind}${logs?` · ${logs} meter log${logs===1?'':'s'} removed`:''}`);
  showToast(`Vendor ${v.name} deleted.`);
  window.acctModalClose();
  if(_acctVendorId===id)_acctVendorId=null;
  window.acctGo('acct-vendors');
};
// Reopen a closed month: delete its checkpoint. Only the LATEST close can
// go — the loader reads from the month after the last close, so reopening
// an earlier one would leave a later checkpoint counting a month that has
// come back into the live ledger. Entries at or before that month reload.
window.acctAdminReopen=async function(month){
  if(!_acctIsSuper())return;
  const last=_acctLastClose();
  if(!last||last.month!==month){showToast('Only the most recently closed month can be reopened.',true);return;}
  if(!confirm(`Reopen ${_acctMonthLabel(month)}?\n\nIts closing checkpoint is deleted, its entries come back into the live ledger, and it can be edited, voided and closed again.`))return;
  try{await fsDelete('acct_closes',month);}
  catch(err){showToast('Reopen refused: '+(err.message||err),true);return;}
  _acctLog('Accounts month reopened (admin)',_acctMonthLabel(month));
  showToast(_acctMonthLabel(month)+' reopened — reloading the ledger…');
  try{await loadAccountsData(true);}catch(_){}
  _acctRerender();
};
// RESET — wipe the module. Entries, daily meter logs and month closes
// always; vendors only when asked (they are the address book, and a reset
// after a test run usually wants to keep them). Every document is removed
// one by one over REST — js/store.js has no batch endpoint — with a live
// count, and the pass stops at the first refusal so a rules problem cannot
// half-empty the ledger silently. Confirmed by typing RESET.
const _ACCT_RESET_COLS=['acct_entries','acct_meter_logs','acct_closes'];
window.acctAdminResetPrompt=function(){
  if(!_acctIsSuper())return;
  const body=`
    <div class="acct-alert urgent" style="cursor:default;margin-bottom:10px"><b>This removes every Store Accounts record.</b> All entries (purchases, payments, cash in, floats, adjustments), every daily consumable log and every month close — for good. Inventory (<code>store_items</code>, <code>store_transactions</code>) is not touched. There is no undo.</div>
    <div class="field" style="margin-bottom:10px"><label><input type="checkbox" id="ar-vendors"> Also remove the vendors</label></div>
    <div class="field"><label>Type <b>RESET</b> to confirm</label><input id="ar-word" autocomplete="off" autofocus></div>
    <div id="ar-progress" style="font-size:13px;color:var(--muted);margin-top:8px;min-height:18px"></div>`;
  _acctModal('Reset Store Accounts (admin)',body,`<button class="btn-outline" onclick="window.acctModalClose()">Cancel</button><button class="btn-primary" id="ar-go" style="width:auto;margin:0;padding:10px 18px;background:var(--accent-urgent)" onclick="window.acctAdminReset()">Reset everything</button>`,{sticky:true,width:560});
};
window.acctAdminReset=async function(){
  if(!_acctIsSuper())return;
  const word=(document.getElementById('ar-word')||{}).value||'';
  if(word.trim()!=='RESET'){showToast('Type RESET to confirm.',true);return;}
  const vendorsToo=!!(document.getElementById('ar-vendors')||{}).checked;
  const cols=_ACCT_RESET_COLS.concat(vendorsToo?['acct_vendors']:[]);
  const btn=document.getElementById('ar-go');if(btn)btn.disabled=true;
  const prog=document.getElementById('ar-progress');const say=t=>{if(prog)prog.textContent=t;};
  let done=0;
  try{
    for(const col of cols){
      say(`Reading ${col}…`);
      const docs=await _fsListAll(col);
      for(const d of docs){await fsDelete(col,d._id);done++;say(`Removed ${done} record${done===1?'':'s'}… (${col})`);}
    }
  }catch(err){
    say('');if(btn)btn.disabled=false;
    showToast(`Reset stopped after ${done} record${done===1?'':'s'}: ${err.message||err}`,true);
    _acctLog('Accounts reset (admin) — stopped',`${done} removed · ${err.message||err}`);
    try{await loadAccountsData(true);}catch(_){}
    _acctRerender();return;
  }
  _acctMeterCache={};
  _acctLog('Accounts reset (admin)',`${done} record${done===1?'':'s'} removed · ${cols.join(', ')}`);
  showToast(`Store Accounts reset — ${done} record${done===1?'':'s'} removed.`);
  window.acctModalClose();
  try{await loadAccountsData(true);}catch(_){}
  _acctRerender();
};
window.acctExportPrompt=function(){
  const b=_acctPeriodBounds();
  const from=b.from<'1900-01-01'?(acctEntries.length?acctEntries[acctEntries.length-1].date:_acctToday()):b.from;
  const to=b.to>'9999-01-01'?_acctToday():(b.to>_acctToday()?_acctToday():b.to);
  _acctModal('Export cash statement',`<div class="form-grid"><div class="field"><label>From</label><input id="x-from" type="date" value="${from}"></div><div class="field"><label>To</label><input id="x-to" type="date" value="${to}" max="${_acctToday()}"></div></div><div style="font-size:13px;color:var(--muted);margin-top:8px">One workbook: Summary (opening / closing per account, payables by vendor) · Cash book · MCB book · All entries.</div>`,
    `<button class="btn-outline" onclick="window.acctModalClose()">Cancel</button><button class="btn-primary" style="width:auto;margin:0;padding:10px 18px" onclick="window.acctExportStatement(document.getElementById('x-from').value,document.getElementById('x-to').value);window.acctModalClose()">Download .xlsx</button>`,{width:440});
};

/* ════════════════════════ VENDOR WIZARD ════════════════════════ */
// Five questions, branching on the answers, so the profile matches the terms.
window.acctVendorWizard=function(vendorId,presetKind,opts){
  if(!_acctCanEntry())return;
  const v=vendorId?_acctVendor(vendorId):null;
  _acctWizard={step:0,editing:!!v,id:vendorId||null,then:opts&&opts.then||null,
    data:v?JSON.parse(JSON.stringify(v)):{name:'',kind:presetKind||'',terms:{mode:'',creditDays:30,creditLimit:'',billDay:'',billWeekdays:[],expectedAmount:''},meter:{type:'count',unit:'',rate:'',label:''},contact:{person:'',phone:'',address:''},supplies:[],notes:'',openingBalance:0,openingDate:_acctToday(),active:true}};
  if(!_acctWizard.data.terms)_acctWizard.data.terms={mode:'cash'};
  if(!v&&presetKind&&!_acctWizard.data.terms.mode)_acctWizard.data.terms.mode=_acctWzDefaultMode(presetKind);
  if(!_acctWizard.data.meter)_acctWizard.data.meter={type:'count',unit:'',rate:'',label:''};
  if(!_acctWizard.data.contact)_acctWizard.data.contact={person:'',phone:'',address:''};
  _acctWizardRender();
};
const _ACCT_WZ_STEPS=['Who','What they supply','How you pay','Contact','Opening balance','Check & create'];
function _acctWizardRender(){
  const w=_acctWizard;if(!w)return;const d=w.data;const s=w.step;
  const steps=_ACCT_WZ_STEPS.filter((_,i)=>!(w.editing&&i===4));
  const vis=w.editing&&s>=4?s-1:s; // step index within visible list when editing skips opening balance
  let body=`<div class="acct-steps">${steps.map((t,i)=>`<span class="${i===vis?'on':(i<vis?'done':'')}">${i+1}. ${t}</span>`).join('')}</div>`;
  const radio=(name,opts,val)=>`<div class="acct-radios">${opts.map(o=>`<label class="acct-radio${val===o.key?' on':''}"><input type="radio" name="${name}" value="${o.key}"${val===o.key?' checked':''} onchange="window.acctWzSet('${name}',this.value)"><b>${o.label}</b><span>${o.hint}</span></label>`).join('')}</div>`;
  if(s===0)body+=`<div class="field"><label>Vendor / business name *</label><input id="wz-name" value="${_acctEsc(d.name)}" placeholder="e.g. Karachi Thread House" autofocus></div>`;
  else if(s===1)body+=`<div class="field"><label>What does ${_acctEsc(d.name||'this vendor')} supply? *</label>${radio('kind',ACCT_VENDOR_KINDS,d.kind)}</div>`;
  else if(s===2){
    body+=`<div class="field"><label>How do you pay them? *</label>${radio('mode',ACCT_TERM_MODES,d.terms.mode)}</div><div id="wz-terms" class="form-grid" style="margin-top:12px">${_acctWzTermsHTML(d)}</div>`;
    if(d.kind==='consumable')body+=`<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px"><div class="field"><label>How is it metered? *</label>${radio('mtype',[{key:'count',label:'Counted',hint:'e.g. bottles delivered per day'},{key:'weighed',label:'Weighed with a return',hint:'e.g. gas: kg delivered minus kg left in the returned cylinder'}],d.meter.type)}</div>
      <div class="form-grid" style="margin-top:10px"><div class="field"><label>Unit *</label><input id="wz-munit" value="${_acctEsc(d.meter.unit)}" placeholder="${d.meter.type==='weighed'?'kg':'bottle'}"></div><div class="field"><label>Rate per unit (₨) *</label><input id="wz-mrate" type="number" inputmode="decimal" min="0" step="any" value="${_acctEsc(d.meter.rate)}" placeholder="0"></div><div class="field" style="grid-column:1/-1"><label>What is it called on the log</label><input id="wz-mlabel" value="${_acctEsc(d.meter.label)}" placeholder="${d.meter.type==='weighed'?'Gas':'Bottled water'}"></div></div></div>`;
  }
  else if(s===3)body+=`<div class="form-grid"><div class="field"><label>Contact person</label><input id="wz-person" value="${_acctEsc(d.contact.person)}"></div><div class="field"><label>Phone</label><input id="wz-phone" type="tel" value="${_acctEsc(d.contact.phone)}" placeholder="03xx-xxxxxxx"></div><div class="field" style="grid-column:1/-1"><label>Address / area</label><input id="wz-address" value="${_acctEsc(d.contact.address)}"></div><div class="field" style="grid-column:1/-1"><label>Product types (comma separated)</label><input id="wz-supplies" value="${_acctEsc((d.supplies||[]).join(', '))}" placeholder="e.g. Thread, Elastic, Labels"></div><div class="field" style="grid-column:1/-1"><label>Notes</label><input id="wz-notes" value="${_acctEsc(d.notes||'')}" placeholder="anything the next person should know"></div></div>`;
  else if(s===4)body+=`<div class="form-grid"><div class="field"><label>Do you already owe them anything today? (₨)</label><input id="wz-opening" type="number" inputmode="numeric" min="0" value="${d.openingBalance||''}" placeholder="0"></div><div class="field"><label>As of</label><input id="wz-opening-date" type="date" value="${_acctEsc(d.openingDate||_acctToday())}" max="${_acctToday()}"></div></div><div style="font-size:13px;color:var(--muted);margin-top:8px">Recorded as an <b>Opening balance</b> entry on the ledger, so the statement starts from a number you can point at.</div>`;
  else if(s===5){
    const kind=(ACCT_VENDOR_KINDS.find(k=>k.key===d.kind)||{}).label||'—';
    body+=`<div class="acct-kv-grid">
      <div class="acct-kv"><span>Name</span><b>${_acctEsc(d.name)}</b></div><div class="acct-kv"><span>Supplies</span><b>${_acctEsc(kind)}</b></div>
      <div class="acct-kv"><span>Terms</span><b>${_acctEsc(_acctTermsLabel(d))}</b></div>
      ${d.kind==='consumable'?`<div class="acct-kv"><span>Meter</span><b>${d.meter.type==='weighed'?'weighed':'counted'} · ${_acctEsc(d.meter.unit)} @ ${_acctPKR(d.meter.rate)}</b></div>`:''}
      <div class="acct-kv"><span>Contact</span><b>${_acctEsc([d.contact.person,d.contact.phone,d.contact.address].filter(Boolean).join(' · ')||'—')}</b></div>
      ${(d.supplies||[]).length?`<div class="acct-kv"><span>Products</span><b>${_acctEsc(d.supplies.join(', '))}</b></div>`:''}
      ${!w.editing?`<div class="acct-kv"><span>Opening balance</span><b>${_acctPKR(d.openingBalance||0)}${d.openingBalance?' as of '+_acctDateLabel(d.openingDate):''}</b></div>`:''}
    </div>
    <div style="font-size:13px;color:var(--muted);margin-top:10px">${d.terms.mode==='credit'?`Purchases from ${_acctEsc(d.name)} will default to <b>on credit</b>; bills older than ${d.terms.creditDays||0} days show as overdue.`:d.terms.mode==='monthly'?`The ledger will remind you when ${_acctEsc(d.name)}'s bill for the month has not been recorded by day ${d.terms.billDay||'—'}.`:d.terms.mode==='weekly'?`The ledger will remind you each ${_acctDaysLabel(_acctBillDays(d.terms))} when ${_acctEsc(d.name)}'s bill has not been recorded since the last one.`:`Purchases from ${_acctEsc(d.name)} will default to <b>paid in cash</b>.`}${d.kind==='consumable'?' A daily log page is created for them under Consumables.':''}</div>`;
  }
  const last=s===5;
  const foot=`${s>0?`<button class="btn-outline" onclick="window.acctWzNav(-1)">← Back</button>`:`<button class="btn-outline" onclick="window.acctModalClose()">Cancel</button>`}<button class="btn-primary" style="width:auto;margin:0;padding:10px 18px" id="wz-next" onclick="window.acctWzNav(1)">${last?(w.editing?'Save profile':'Create vendor'):'Next →'}</button>`;
  _acctModal(w.editing?'Edit vendor profile':'New vendor',body,foot,{sticky:true,width:600});
}
function _acctWzTermsHTML(d){
  const t=d.terms||{};
  if(t.mode==='credit')return `<div class="field"><label>Paid within (days) *</label><input id="wz-days" type="number" min="0" value="${_acctEsc(t.creditDays!=null?t.creditDays:30)}"></div><div class="field"><label>Credit limit (₨, optional)</label><input id="wz-limit" type="number" min="0" value="${_acctEsc(t.creditLimit||'')}" placeholder="warn when the balance passes this"></div>`;
  if(t.mode==='monthly')return `<div class="field"><label>Bill arrives on day *</label><input id="wz-billday" type="number" min="1" max="28" value="${_acctEsc(t.billDay||'')}" placeholder="1–28"></div><div class="field"><label>Typical amount (₨, optional)</label><input id="wz-expected" type="number" min="0" value="${_acctEsc(t.expectedAmount||'')}"></div>`;
  if(t.mode==='weekly'){const on=_acctBillDays(t);return `<div class="field" style="grid-column:1/-1"><label>Bill arrives every * <span style="font-weight:400;color:var(--muted)">(the store's payable days are ticked)</span></label><div style="display:flex;flex-wrap:wrap;gap:6px 14px">${_ACCT_WEEKDAYS.map((n,i)=>`<label style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" id="wz-wd-${i}"${on.includes(i)?' checked':''}> ${n}</label>`).join('')}</div></div><div class="field"><label>Typical amount (₨, optional)</label><input id="wz-expected" type="number" min="0" value="${_acctEsc(t.expectedAmount||'')}"></div>`;}
  return '';
}
function _acctWzDefaultMode(kind){return (kind==='utility'||kind==='consumable')?'monthly':'';}
window.acctWzSet=function(name,val){
  const d=_acctWizard.data;
  if(name==='kind'){d.kind=val;if(!d.terms.mode)d.terms.mode=_acctWzDefaultMode(val);}
  if(name==='mode'){d.terms.mode=val;const box=document.getElementById('wz-terms');if(box)box.innerHTML=_acctWzTermsHTML(d);}
  if(name==='mtype'){d.meter.type=val;_acctWizardRender();return;}
  document.querySelectorAll(`.acct-radio input[name="${name}"]`).forEach(i=>i.closest('.acct-radio').classList.toggle('on',i.value===val));
};
window.acctWzNav=async function(dir){
  const w=_acctWizard;if(!w)return;const d=w.data;const g=id=>{const el=document.getElementById(id);return el?el.value:'';};
  if(dir>0){
    if(w.step===0){d.name=(g('wz-name')||'').trim();if(!d.name){showToast('Enter the vendor name.',true);return;}
      const dup=acctVendors.find(v=>v._id!==w.id&&(v.name||'').trim().toLowerCase()===d.name.toLowerCase());if(dup){showToast('A vendor with that name already exists.',true);return;}}
    if(w.step===1&&!d.kind){showToast('Pick what they supply.',true);return;}
    if(w.step===2){
      if(!d.terms.mode){showToast('Pick how you pay them.',true);return;}
      if(d.terms.mode==='credit'){d.terms.creditDays=parseInt(g('wz-days'));if(isNaN(d.terms.creditDays)||d.terms.creditDays<0){showToast('Enter the credit days.',true);return;}d.terms.creditLimit=parseInt(g('wz-limit'))||0;}
      if(d.terms.mode==='monthly'){d.terms.billDay=parseInt(g('wz-billday'));if(!(d.terms.billDay>=1&&d.terms.billDay<=28)){showToast('Bill day must be 1–28.',true);return;}d.terms.expectedAmount=parseInt(g('wz-expected'))||0;}
      if(d.terms.mode==='weekly'){d.terms.billWeekdays=_ACCT_WEEKDAYS.map((_,i)=>i).filter(i=>document.getElementById('wz-wd-'+i)?.checked);if(!d.terms.billWeekdays.length){showToast('Tick at least one day the bill arrives.',true);return;}d.terms.expectedAmount=parseInt(g('wz-expected'))||0;}
      if(d.kind==='consumable'){d.meter.unit=(g('wz-munit')||'').trim();d.meter.rate=parseFloat(g('wz-mrate'));d.meter.label=(g('wz-mlabel')||'').trim()||d.name;if(!d.meter.unit||!(d.meter.rate>=0)){showToast('Enter the unit and rate.',true);return;}}
    }
    if(w.step===3){d.contact={person:(g('wz-person')||'').trim(),phone:(g('wz-phone')||'').trim(),address:(g('wz-address')||'').trim()};d.supplies=String(g('wz-supplies')||'').split(',').map(x=>x.trim()).filter(Boolean);d.notes=(g('wz-notes')||'').trim();}
    if(w.step===4){d.openingBalance=parseInt(g('wz-opening'))||0;d.openingDate=g('wz-opening-date')||_acctToday();if(d.openingBalance&&_acctMonthClosed(_acctMonthOf(d.openingDate))){showToast('That date is in a closed month.',true);return;}}
    if(w.step===5){await _acctWzSave();return;}
    w.step++;if(w.editing&&w.step===4)w.step=5;
  }else{w.step--;if(w.editing&&w.step===4)w.step=3;}
  _acctWizardRender();
};
async function _acctWzSave(){
  const w=_acctWizard;const d=w.data;
  const btn=document.getElementById('wz-next');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const doc={name:d.name,kind:d.kind,terms:{mode:d.terms.mode,creditDays:d.terms.mode==='credit'?(d.terms.creditDays||0):0,creditLimit:d.terms.mode==='credit'?(d.terms.creditLimit||0):0,billDay:d.terms.mode==='monthly'?(d.terms.billDay||0):0,billWeekdays:d.terms.mode==='weekly'?_acctBillDays(d.terms):[],expectedAmount:(d.terms.mode==='monthly'||d.terms.mode==='weekly')?(d.terms.expectedAmount||0):0},
    meter:d.kind==='consumable'?{type:d.meter.type||'count',unit:d.meter.unit,rate:Number(d.meter.rate)||0,label:d.meter.label||d.name}:null,
    contact:d.contact,supplies:d.supplies||[],notes:d.notes||'',active:d.active!==false,updatedAt:Date.now()};
  try{
    let id=w.id;
    if(w.editing){
      const old=_acctVendor(id);Object.assign(doc,{openingBalance:old.openingBalance||0,openingDate:old.openingDate||null,createdAt:old.createdAt,createdBy:old.createdBy});
      await fsSet('acct_vendors',id,doc);Object.assign(old,doc);
      showToast('Vendor profile saved ✓');
    }else{
      Object.assign(doc,{openingBalance:d.openingBalance||0,openingDate:d.openingBalance?d.openingDate:null,createdAt:Date.now(),createdBy:_acctUser().by});
      id=await fsAdd('acct_vendors',doc);
      acctVendors.push(Object.assign({},doc,{_id:id}));
      if(d.openingBalance>0){
        const e=Object.assign(_acctBase('opening'),{vendorId:id,vendorName:d.name,amount:d.openingBalance,date:d.openingDate,note:'Opening balance when the vendor was created'});
        await _acctWrite(e,true);
      }
      _acctLog('Vendor created',d.name);
      showToast('Vendor created ✓');
    }
    window.acctModalClose();
    if(w.then)w.then(id);else{_acctVendorId=id;if(String(currentPage).startsWith('acct-'))window.showPage('acct-vendor');}
  }catch(e){showToast('Save failed: '+(e.message||e),true);if(btn){btn.disabled=false;btn.textContent=w.editing?'Save profile':'Create vendor';}}
}

/* ════════════════════════ LEGACY IMPORT (owners) ════════════════════════ */
// Old store_cash_ledger rows → acct_entries, once, keyed by legacyId.
window.acctImportLegacy=async function(){
  if(!_acctCanAdmin())return;
  const log=document.getElementById('acct-import-log');const say=t=>{if(log)log.innerHTML=t;};
  say('Reading the old ledger…');
  let rows,oldVendors,oldCats;
  try{[rows,oldVendors,oldCats]=await Promise.all([fsList('store_cash_ledger',500),fsList('store_cash_vendors',300),fsList('store_cash_categories',300)]);}
  catch(e){say(`<span style="color:var(--accent-urgent)">Could not read the old ledger: ${_acctEsc(e.message||e)}</span>`);return;}
  if(!rows.length){say('The old ledger is empty — nothing to import.');return;}
  const have=new Set(acctEntries.filter(e=>e.legacyId).map(e=>e.legacyId));
  const todo=rows.filter(r=>!have.has(r._id)).sort((a,b)=>(a.ts||0)-(b.ts||0));
  if(!todo.length){say(`All ${rows.length} old entries were already imported.`);return;}
  if(!confirm(`Import ${todo.length} old entries (${rows.length-todo.length} already imported)? Vendors named in them are created if missing.`))return;
  const vendorByName=n=>acctVendors.find(v=>(v.name||'').trim().toLowerCase()===String(n||'').trim().toLowerCase());
  const accMap=k=>k==='mcb'?'mcb':'cash';
  const catLabel=id=>{const c=oldCats.find(x=>x._id===id);return c?c.label:(id||'');};
  let n=0,skipped=0;
  for(const r of todo){
    let e=null;const date=r.date||_acctDayStr(new Date(r.ts||Date.now()));const note=[r.note,r.account&&r.account!=='cash'&&r.account!=='mcb'?'legacy account: '+r.account:''].filter(Boolean).join(' · ');
    const base=Object.assign(_acctBase('purchase'),{date,month:_acctMonthOf(date),ts:r.ts||Date.now(),by:r.by||'legacy',byName:r.by||'legacy',note,photo:r.billPhoto||r.proofPhoto||null,legacyId:r._id,category:catLabel(r.category)||''});
    let vendor=null;
    if(r.vendorId&&r.vendorId!=='walkin'){const ov=oldVendors.find(x=>x._id===r.vendorId);const nm=ov?ov.name:r.vendorId;vendor=vendorByName(nm);
      if(!vendor){const doc={name:nm,kind:ov&&ov.reimbursePerson?'service':'goods',terms:{mode:'credit',creditDays:30,creditLimit:0,billDay:0,expectedAmount:0},meter:null,contact:{person:'',phone:ov&&ov.phone||'',address:ov&&ov.address||''},supplies:ov&&ov.productTypes||[],notes:'Imported from the old cash ledger',active:true,openingBalance:ov&&ov.openingOutstanding||0,openingDate:null,createdAt:Date.now(),createdBy:_acctUser().by,updatedAt:Date.now()};
        try{const id=await fsAdd('acct_vendors',doc);vendor=Object.assign({},doc,{_id:id});acctVendors.push(vendor);if(doc.openingBalance>0)await _acctWrite(Object.assign(_acctBase('opening'),{vendorId:id,vendorName:nm,amount:doc.openingBalance,date:'2026-01-01',month:'2026-01',note:'Opening outstanding from the old cash ledger'}),true);}catch(_){skipped++;continue;}}}
    const amt=Math.round(r.amount||0);
    switch(r.kind){
      case 'expense':case 'issue':e=Object.assign(base,{type:'purchase',vendorId:vendor?vendor._id:null,vendorName:vendor?vendor.name:(r.payee||''),source:r.account?accMap(r.account):'cash',account:r.account?accMap(r.account):(r.fromFloat?null:'cash'),amount:amt,lines:(r.items&&r.items.length?r.items.map(i=>({itemCode:'',desc:i.name||'',qty:i.qty||1,unit:i.unit||'',rate:i.price||0,total:Math.round(i.total||0)})):[{itemCode:'',desc:catLabel(r.category)||r.note||'Expense',qty:1,unit:'',rate:amt,total:amt}]),person:r.payee||''});
        if(r.fromFloat){e.source='cash';e.account=null;e.note=(e.note?e.note+' · ':'')+'settled from a runner float (legacy)';}break;
      case 'credit_purchase':e=Object.assign(base,{type:'purchase',vendorId:vendor?vendor._id:null,vendorName:vendor?vendor.name:(r.paidBy||''),source:'credit',account:null,amount:amt,lines:(r.items&&r.items.length?r.items.map(i=>({itemCode:'',desc:i.name||'',qty:i.qty||1,unit:i.unit||'',rate:i.price||0,total:Math.round(i.total||0)})):[{itemCode:'',desc:catLabel(r.category)||r.note||'Credit purchase',qty:1,unit:'',rate:amt,total:amt}]),person:r.payee||''});break;
      case 'vendor_payment':e=Object.assign(base,{type:'payment',vendorId:vendor?vendor._id:null,vendorName:vendor?vendor.name:'',account:accMap(r.account),amount:amt,ref:''});break;
      case 'topup':e=Object.assign(base,{type:'cash_in',account:accMap(r.account),via:accMap(r.account)==='mcb'?'mcb':'cash',amount:amt,person:''});break;
      case 'transfer':e=Object.assign(base,{type:'transfer',account:accMap(r.account),toAccount:accMap(r.counterAccount),amount:amt});if(e.account===e.toAccount){skipped++;continue;}break;
      case 'settle':e=Object.assign(base,{type:'cash_in',account:accMap(r.account),via:'cash',amount:amt,person:r.payee||'',note:(note?note+' · ':'')+'change returned from a runner float (legacy)'});break;
      case 'adjust':e=Object.assign(base,{type:'adjust',account:accMap(r.account),amount:Math.round(r.amount||0),note:(r.adjustsReason||r.note||'legacy adjustment'),reviewedAt:Date.now(),reviewedBy:_acctUser().by});break;
      case 'income':e=Object.assign(base,{type:'cash_in',account:accMap(r.account),via:'cash',amount:amt});break;
      default:skipped++;continue;
    }
    if(!e.vendorId&&(e.type==='payment')){skipped++;continue;}
    if(e.type==='purchase'&&!e.vendorId){
      let walk=vendorByName('Walk-in / direct');
      if(!walk){try{const doc={name:'Walk-in / direct',kind:'goods',terms:{mode:'cash',creditDays:0,creditLimit:0,billDay:0,expectedAmount:0},meter:null,contact:{person:'',phone:'',address:''},supplies:[],notes:'Purchases with no named vendor (imported)',active:true,openingBalance:0,openingDate:null,createdAt:Date.now(),createdBy:_acctUser().by,updatedAt:Date.now()};const id=await fsAdd('acct_vendors',doc);walk=Object.assign({},doc,{_id:id});acctVendors.push(walk);}catch(_){skipped++;continue;}}
      e.vendorId=walk._id;e.vendorName=walk.name;
    }
    if(_acctMonthClosed(e.month)){skipped++;continue;}
    e.reviewedAt=e.reviewedAt||Date.now();e.reviewedBy=e.reviewedBy||_acctUser().by;   // history, not new work for the queue
    try{const id=await fsAdd('acct_entries',e);acctEntries.push(Object.assign({},e,{_id:id}));n++;say(`Imported ${n} of ${todo.length}…`);}catch(err){skipped++;}
  }
  _acctSort(acctEntries);
  _acctLog('Legacy cash ledger imported',`${n} entries`);
  say(`Done — imported ${n}, skipped ${skipped}.`);
  showToast(`Imported ${n} legacy entries ✓`);
  setTimeout(_acctRerender,600);
};

/* ════════════════════════ HOOKS FROM OTHER MODULES ════════════════════════ */
// A fabric sale on a gate pass (js/gatepass.js) is money in: a cash_in
// against the customer, referenced by the pass id. Returns the row or null;
// the caller says out loud when it is null (the issuer may lack entry rights,
// or the month may be closed) rather than losing a sale silently.
window.acctPostSale=async function(o){
  o=o||{};
  if(!_acctCanEntry())return null;
  try{await loadAccountsData();}catch(_){}
  const acc=o.account==='mcb'?'mcb':'cash';
  const e=Object.assign(_acctBase('cash_in'),{account:acc,via:acc,amount:Math.round(o.amount||0),person:String(o.customer||'').trim(),ref:String(o.ref||''),note:String(o.note||''),category:'Fabric sale',date:/^\d{4}-\d{2}-\d{2}$/.test(o.date||'')?o.date:_acctToday(),saleRef:o.ref||null});
  if(e.amount<=0)return null;
  return _acctWrite(e,true);
};

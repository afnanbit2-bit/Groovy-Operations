/* ─────────────────────────────────────────────────────────────────────────
   js/ma-core.js — Master Accounts: the core (M1, 28 Sept 2026)

   PURE. No DOM, no Firestore, no session, no clock except where a caller
   passes `today`. Every decision the books make lives here ONCE and is read
   by the pages (js/master-accounts.js), the tests, and — from M2 — the
   nightly rollup (a Netlify function `require`s this file; the export at
   the foot is guarded so the browser never sees `module`).

   What is here: the two charts of accounts (MASTER_ACCOUNTS_PLAN.md §4.1,
   §4.5), the settings and their defaults (§4.4), periods on a fiscal year
   from 1 July (§20), whole-rupee money, the tax block (§12), the M1
   documents (journal kinds, transfers between holders, counts — §5), how
   each one POSTS (§7), the labels every posting carries (§27), balances,
   the holders, the trial balance, the ledger with a running balance, the
   validation engine (§6: refuse / flag), edits with history and voids
   (§31), the party master with terms and rate cards kept with history
   (§4.2), items, the cost register (§26, `ma_commitments`), the rule-based
   calendar and "needs attention" lines (§17's rule half), the Unlabelled
   queue (§27), FIFO allocation for M3.

   Balances are DERIVED, never stored (§2). A posting is a line computed
   from its document by maPost; a void or an edit re-derives. Nothing here
   ever writes.

   Everything global is prefixed `ma`/`MA_` — these are classic scripts in
   ONE lexical scope (the `tb` lesson in CLAUDE.md), so a bare `const` here
   that another file also declares takes the whole app down.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';

/* ── The books and the chart of accounts ────────────────────────────────── */
const MA_BOOKS=['groovy','savings'];
const MA_ACCOUNT_TYPES=['asset','liability','equity','revenue','cogs','expense','suspense'];
const MA_HOLDER_KINDS=['cash','bank','till','float','wallet'];

/* Spend groups: the human tree a line of spend sits in (§27 `category`),
   and the `kind` label a posting on it carries by default. */
const MA_SPEND_GROUPS={
  cogs:{label:'Cost of goods',kind:'variable'},
  people:{label:'People',kind:'people'},
  running:{label:'Running the business',kind:'running'},
  fixed:{label:'Fixed',kind:'fixed'},
  financing:{label:'Financing',kind:'financing'},
  tax:{label:'Tax',kind:'tax'}
};
const MA_LABEL_KINDS=['fixed','variable','running','people','financing','one_off','tax','transfer'];
const MA_CHANNELS=['online_cod','online_prepaid','warehouse','gate','other'];
const MA_SOURCES=['manual','import','postex','shopify','store','warehouse','hrm','printing','gatepass','fabric','rollup'];

/* Groovy's chart (§4.1). A money account IS a holder: every rupee sits in
   one. `person` is whose hands it is in — a transfer into another person's
   hands waits for them to confirm (§3 #3). Holders whose feed arrives with a
   later milestone ship switched off; Settings switches them on. */
const MA_CHART=[
  // Money — the holders
  {code:'1010',name:'Cash — store drawer (Raees)',type:'asset',money:true,holderKind:'cash',person:'raees'},
  {code:'1011',name:'Cash — with Afnan',type:'asset',money:true,holderKind:'cash',person:'afnan'},
  {code:'1012',name:'Cash — with Ammar',type:'asset',money:true,holderKind:'cash',person:'ammar'},
  {code:'1020',name:'MCB current',type:'asset',money:true,holderKind:'bank'},
  {code:'1030',name:'Other bank or wallet',type:'asset',money:true,holderKind:'bank',active:false},
  {code:'1040',name:'Warehouse till (Umair)',type:'asset',money:true,holderKind:'till',person:'umair',active:false,arrives:'M5'},
  {code:'1050',name:'Runner floats',type:'asset',money:true,holderKind:'float',active:false,arrives:'M8'},
  {code:'1060',name:'TCS account',type:'asset',money:true,holderKind:'wallet',active:false,arrives:'M2'},
  // Receivables
  {code:'1110',name:'Customers — pay-later',type:'asset',control:'customer'},
  {code:'1120',name:'PostEx — delivered, not on a CPR',type:'asset',control:'courier'},
  {code:'1121',name:'PostEx — CPRs to collect',type:'asset',control:'courier'},
  {code:'1122',name:'TCS — inside 90 days',type:'asset',control:'courier'},
  {code:'1123',name:'Blue-Ex (legacy)',type:'asset',control:'courier'},
  {code:'1124',name:'Bykea',type:'asset',control:'courier'},
  {code:'1125',name:'Payfast — not paid out',type:'asset',control:'gateway'},
  {code:'1140',name:'Employees — advances and loans',type:'asset',control:'employee'},
  {code:'1150',name:'Vendor advances',type:'asset',control:'vendor'},
  {code:'1160',name:'Input tax',type:'asset'},
  {code:'1170',name:'Security deposits',type:'asset'},
  // Stock and assets
  {code:'1210',name:'Fabric',type:'asset'},
  {code:'1220',name:'Trims',type:'asset'},
  {code:'1230',name:'Work in progress',type:'asset'},
  {code:'1240',name:'Finished goods',type:'asset'},
  {code:'1310',name:'Fixed assets',type:'asset'},
  // Liabilities
  {code:'2010',name:'Payable — vendors',type:'liability',control:'vendor'},
  {code:'2020',name:'Retention held',type:'liability',control:'vendor'},
  {code:'2040',name:'Payable — salaries',type:'liability',control:'employee'},
  {code:'2050',name:'Payable — runners',type:'liability',control:'employee'},
  {code:'2060',name:'Payable — creators',type:'liability',control:'vendor'},
  {code:'2070',name:'Customer deposits',type:'liability',control:'customer'},
  {code:'2110',name:'Loan from owners’ savings',type:'liability'},
  {code:'2120',name:'Sales tax payable',type:'liability'},
  {code:'2130',name:'Withholding tax payable',type:'liability'},
  {code:'2140',name:'Other loans',type:'liability'},
  // Equity
  {code:'3010',name:'Capital — Afnan',type:'equity',owner:'afnan'},
  {code:'3011',name:'Capital — Ammar',type:'equity',owner:'ammar'},
  {code:'3020',name:'Drawings — Afnan',type:'equity',normal:'dr',owner:'afnan'},
  {code:'3021',name:'Drawings — Ammar',type:'equity',normal:'dr',owner:'ammar'},
  {code:'3090',name:'Retained result and openings',type:'equity'},
  // Revenue
  {code:'4010',name:'Online — COD',type:'revenue',channel:'online_cod'},
  {code:'4011',name:'Online — prepaid (Payfast)',type:'revenue',channel:'online_prepaid'},
  {code:'4020',name:'Warehouse sales',type:'revenue',channel:'warehouse'},
  {code:'4030',name:'Fabric & garment sales',type:'revenue',channel:'gate'},
  {code:'4040',name:'Discounts given',type:'revenue',normal:'dr'},
  {code:'4050',name:'Refunds & returns',type:'revenue',normal:'dr'},
  {code:'4090',name:'Other income',type:'revenue',channel:'other'},
  // Cost of goods
  {code:'5010',name:'Fabric',type:'cogs',spend:'cogs'},
  {code:'5020',name:'Stitching',type:'cogs',spend:'cogs'},
  {code:'5030',name:'Embellishment',type:'cogs',spend:'cogs'},
  {code:'5040',name:'Trims',type:'cogs',spend:'cogs'},
  {code:'5050',name:'Washing & dyeing',type:'cogs',spend:'cogs'},
  {code:'5060',name:'Courier fees & tax',type:'cogs',spend:'cogs'},
  {code:'5070',name:'Reversals & returns',type:'cogs',spend:'cogs'},
  {code:'5080',name:'Packaging',type:'cogs',spend:'cogs'},
  {code:'5090',name:'Cost variance',type:'cogs',spend:'cogs'},
  // Expenses
  {code:'6010',name:'Salaries',type:'expense',spend:'people'},
  {code:'6020',name:'Marketing & PR',type:'expense',spend:'running'},
  {code:'6030',name:'Utilities',type:'expense',spend:'fixed'},
  {code:'6040',name:'Rent',type:'expense',spend:'fixed'},
  {code:'6050',name:'Maintenance & repairs',type:'expense',spend:'running'},
  {code:'6060',name:'Fuel & transport',type:'expense',spend:'running'},
  {code:'6070',name:'Office & stationery',type:'expense',spend:'running'},
  {code:'6080',name:'Bank & gateway charges',type:'expense',spend:'financing'},
  {code:'6090',name:'Depreciation',type:'expense',spend:'fixed'},
  {code:'6100',name:'Subscriptions',type:'expense',spend:'fixed'},
  {code:'6110',name:'Taxes & levies (non-recoverable)',type:'expense',spend:'tax'},
  {code:'6120',name:'Food & refreshments',type:'expense',spend:'people'},
  {code:'6130',name:'Staff welfare & medical',type:'expense',spend:'people'},
  {code:'6140',name:'Licences & professional fees',type:'expense',spend:'fixed'},
  {code:'6150',name:'Insurance',type:'expense',spend:'fixed'},
  {code:'6190',name:'Other expenses',type:'expense',spend:'running'},
  // Suspense — what nobody could name yet. It lands in the Unlabelled queue.
  {code:'9010',name:'Unclassified — money in',type:'suspense',normal:'cr'},
  {code:'9020',name:'Unclassified — money out',type:'suspense',normal:'dr'},
  {code:'9030',name:'Reconciliation differences',type:'suspense',normal:'dr'}
];
const MA_SUSPENSE=['9010','9020','9030'];
const MA_UNLABELLED=['9010','9020'];

/* The Savings book's chart (§4.5). Seeded now; the book's pages are M4. */
const MA_SV_CHART=[
  {code:'S1010',name:'Cash — Afnan',type:'asset',money:true,holderKind:'cash',person:'afnan'},
  {code:'S1011',name:'Cash — Ammar',type:'asset',money:true,holderKind:'cash',person:'ammar'},
  {code:'S1020',name:'Payfast payout account',type:'asset',money:true,holderKind:'bank'},
  {code:'S1030',name:'Bank — Afnan',type:'asset',money:true,holderKind:'bank',person:'afnan'},
  {code:'S1031',name:'Bank — Ammar',type:'asset',money:true,holderKind:'bank',person:'ammar'},
  {code:'S1040',name:'Loan to Groovy',type:'asset'},
  {code:'S1050',name:'Vehicles',type:'asset'},
  {code:'S1060',name:'Property',type:'asset'},
  {code:'S1070',name:'Investments',type:'asset'},
  {code:'S1080',name:'Other receivables',type:'asset'},
  {code:'S2010',name:'Vehicle finance',type:'liability'},
  {code:'S2020',name:'Borrowed',type:'liability'},
  {code:'S2030',name:'Cards',type:'liability'},
  {code:'S2040',name:'Other liabilities',type:'liability'},
  {code:'S3010',name:'Afnan',type:'equity',owner:'afnan'},
  {code:'S3011',name:'Ammar',type:'equity',owner:'ammar'},
  {code:'S3012',name:'Joint',type:'equity'},
  {code:'S4010',name:'From Groovy — loan repayment',type:'revenue'},
  {code:'S4011',name:'From Groovy — drawings',type:'revenue'},
  {code:'S4020',name:'Other income',type:'revenue'},
  {code:'S4030',name:'Gifts and transfers in',type:'revenue'},
  {code:'S5010',name:'Marriage',type:'expense'},
  {code:'S5020',name:'Car',type:'expense'},
  {code:'S5030',name:'Household',type:'expense'},
  {code:'S5040',name:'Subscriptions',type:'expense'},
  {code:'S5050',name:'Travel',type:'expense'},
  {code:'S5060',name:'Family',type:'expense'},
  {code:'S5090',name:'Other spend',type:'expense'}
];

/* ── Parties, items, the cost register ───────────────────────────────────── */
const MA_PARTY_KINDS=['vendor','customer','courier','gateway','employee','owner','bank'];
const MA_PARTY_KIND_LABELS={vendor:'Vendor',customer:'Customer',courier:'Courier',gateway:'Gateway',employee:'Employee',owner:'Owner',bank:'Bank'};
const MA_VENDOR_ROLES=['fabric_mill','stitching','washing','dyeing','embroidery','printing','sublimation','trims','packaging','rent','service','utility','consumable','transport','other'];
const MA_TERMS_MODES=['cash','credit','monthly','weekly'];
const MA_TAX_KINDS=['none','sales','services','withholding'];
const MA_TAX_LABELS={none:'No tax',sales:'Sales tax',services:'Services tax',withholding:'Withholding'};
const MA_COURIER_CYCLES=['cpr','account','legacy','manual','weekdays'];
const MA_ITEM_KINDS=['fabric','trim','garment_service','embellishment','packaging','consumable','utility','courier_fee','subscription','other'];
const MA_COMMIT_KINDS=['fixed','variable','running','people','financing','one_off','tax'];
const MA_CADENCES=['monthly','weekly','quarterly','yearly','per_parcel','per_piece','variable'];
const MA_CADENCE_LABELS={monthly:'Monthly',weekly:'Weekly',quarterly:'Quarterly',yearly:'Yearly',per_parcel:'Per parcel',per_piece:'Per piece',variable:'Varies'};
const MA_OWNERS=['afnan','ammar'];
const MA_WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MA_WEEKDAYS_LONG=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MA_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MA_MONTHS_LONG=['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ── Documents ──────────────────────────────────────────────────────────── */
/* One collection per document kind (§5), the number minted with the doc. */
const MA_DOC_TYPES={
  journal:{col:'ma_journal',prefix:'JV',label:'Journal'},
  transfer:{col:'ma_transfer',prefix:'TR',label:'Transfer'},
  count:{col:'ma_counts',prefix:'CT',label:'Count'}
};
/* The journal's kinds, in plain words (§5 "Journal"). `holder` kinds move
   money through one holder; `lines` kinds carry their own lines. */
const MA_JOURNAL_KINDS={
  money_out:{label:'Money out',holder:true,account:true,payee:true,tax:true},
  money_in:{label:'Money in',holder:true,account:true,payee:true,tax:true},
  capital:{label:'Owner put money in',holder:true,owner:true},
  drawing:{label:'Owner took money out',holder:true,owner:true},
  opening:{label:'Opening balance',lines:true},
  general:{label:'Journal',lines:true}
};
/* The fields an edit may change, per document type (§31). Everything else
   is derived again by the builder, or is identity (type, kind, party). */
const MA_EDIT_FIELDS={
  journal:['date','holder','account','payee','amount','tax','costCentre','labelKind','channel','po','article','commitmentId','commitmentPeriod','owner','lines','note','tags','attachments'],
  transfer:['date','from','to','amount','note','attachments'],
  count:['date','counted','note','attachments']
};

/* ── Attachments (§29) — the bill or receipt on a document ───────────────
   A file is stored as a REFERENCE to a Cloudinary asset the ma-attach
   function named (ma/<64 hex>, 32 random bytes), never as a URL. A private
   (authenticated) file is looked at through a link the function signs on
   demand and that dies in five minutes, so a stored URL would be dead in
   five minutes — and in the public fallback it would be the file's only
   lock, copied into every export and backup. Cloudinary's upload answer
   carries `secure_url` AND `url`; a spread of it would carry both in, so
   the stored shape is picked field by field, here, and nowhere else:
     {publicId, format, resourceType, type, version, bytes, name, mime, by, at}
   The id patterns are netlify/lib/ma-server.js's (PID_AUTHENTICATED,
   PID_UPLOAD: a preset may put its own folder in front of a public one). */
const MA_ATTACH_FORMATS=['jpg','png','webp','heic','heif','pdf'];
const MA_ATTACH_MAX=20;
const MA_ATTACH_KEYS=['publicId','format','resourceType','type','version','bytes','name','mime','by','at'];
function maAttachPidOk(pid,type){
  if(typeof pid!=='string')return false;
  return type==='authenticated'?/^ma\/[0-9a-f]{64}$/.test(pid):/^(?:[A-Za-z0-9_-]{1,64}\/){0,3}ma\/[0-9a-f]{64}$/.test(pid);
}
function maAttachOk(a){
  return !!(a&&typeof a==='object'&&(a.type==='authenticated'||a.type==='upload')&&maAttachPidOk(a.publicId,a.type)
    &&MA_ATTACH_FORMATS.indexOf(a.format)>=0&&(a.resourceType===undefined||a.resourceType===null||a.resourceType==='image'));
}
/* The stored shape and nothing else — null when it is not a file this app
   named. The key order is fixed so two copies of one file compare equal. */
function maAttachClean(a){
  if(!maAttachOk(a))return null;
  return {publicId:a.publicId,format:a.format,resourceType:'image',type:a.type,
    version:Number.isInteger(a.version)?a.version:null,
    bytes:Number.isInteger(a.bytes)&&a.bytes>=0?a.bytes:null,
    name:maStr(a.name,200)||a.publicId.split('/').pop().slice(0,12)+'.'+a.format,
    mime:maStr(a.mime,60),
    by:a.by?maStr(a.by,40):null,at:Number.isFinite(a.at)?a.at:null};
}
function maAttachList(list){return (Array.isArray(list)?list:[]).map(maAttachClean).filter(Boolean).slice(0,MA_ATTACH_MAX);}
/* An upload that came back from Cloudinary, checked against what the
   function signed, turned into the stored shape. → {att} or {error}.
   `signed` is ma-attach's `sign` answer; `res` is Cloudinary's. A name the
   function did not give, a raw resource, or a format outside the list is
   refused: the file is then in Cloudinary but on no document. */
function maAttachFromUpload(signed,res,meta){
  const s=signed||{},r=res||{},m=meta||{};
  const pid=typeof r.public_id==='string'?r.public_id:'';
  const want=typeof s.publicId==='string'?s.publicId:'';
  const type=r.type==='authenticated'||r.type==='upload'?r.type:s.type;
  if(!want||!(pid===want||(type==='upload'&&pid.slice(-want.length-1)==='/'+want)))
    return {error:'Cloudinary stored the file under a name the server did not give it'+(pid?' ('+maStr(pid,90)+')':'')+' — it was not attached.'};
  if(r.resource_type&&r.resource_type!=='image')return {error:'Cloudinary stored the file as '+maStr(r.resource_type,20)+', not an image or a PDF — it was not attached.'};
  const format=String(r.format||'').toLowerCase();
  if(MA_ATTACH_FORMATS.indexOf(format)<0)return {error:'Cloudinary says the file is '+(format?'a .'+maStr(format,12):'of no known format')+' — only images (JPG, PNG, WebP, HEIC) and PDFs can be attached.'};
  const att=maAttachClean({publicId:pid,format,type,version:r.version,
    bytes:Number.isInteger(r.bytes)?r.bytes:s.bytes,name:s.name,mime:s.mime,by:m.by,at:m.at});
  return att?{att}:{error:'That is not a file this app can keep.'};
}
/* What the ma-attach and ma-share functions are handed to find the file. */
function maAttachRef(a){return {publicId:a.publicId,format:a.format,type:a.type,resourceType:a.resourceType||'image'};}
/* Adding a file to a document after it was recorded is an EDIT (§31): it
   goes through edits[] like any other change. These are the refusals that
   apply to a file; the document's other rules are not re-run for it — a
   holder gone below its floor since is no reason to refuse the bill. */
function maAttachIssues(doc,ctx){
  const c=ctx||{};const s=c.settings||MA_DEFAULT_SETTINGS;
  if(!doc)return [{rule:'attach.missing',level:'refuse',message:'Nothing to attach it to.'}];
  const out=[];
  if(doc.status==='void')out.push({rule:'attach.void',level:'refuse',message:'A void document cannot change — it stays on the record as it was.'});
  if(maIsDay(doc.date)&&(c.closes||[]).some(x=>x&&x.quarter===maQuarterOf(doc.date,s.fiscalYearStart)&&x.locked===true&&!x.reopenedAt))
    out.push({rule:'attach.closed',level:'refuse',message:'It sits in a closed quarter and cannot change.'});
  if(maAttachList(doc.attachments).length+(c.adding||1)>MA_ATTACH_MAX)out.push({rule:'attach.max',level:'refuse',message:'A document carries at most '+MA_ATTACH_MAX+' files.'});
  return out;
}
/* The revision a document is at (§31): 1 until it is edited, one more for
   every edit it carries. ONE number for the screen (the rail's "rev N") and
   the paper ("Revised · rev N"), which used to disagree by one — a document
   edited twice read rev 3 on screen and rev 2 on paper. Read from edits[],
   the history the rail shows under it; the rules keep `rev` in step with it
   (rev + 1 exactly when edits grows by one). */
function maRevOf(d){return (d&&Array.isArray(d.edits)?d.edits.length:0)+1;}

/* ── Settings (§4.4) ────────────────────────────────────────────────────── */
/* Every threshold the engine or the concern lines read lives here and on
   Close & audit → Settings. `mirrors` names the holders whose balance is
   still another module's book: until M8 the store drawer is Raees's Store
   Accounts, so a document here may hand cash to or take it from the
   drawer (the owner's side of a handover) but may not spend from it. */
const MA_DEFAULT_SETTINGS={
  fiscalYearStart:7,
  goLive:'2026-10-01',
  historyFrom:'2026-07-01',
  payDays:[3,6],
  cprDays:[2,5],
  tcsCreditDays:90,
  courierTolerancePct:1,
  holderFloor:{},
  mirrors:{'1010':'store'},
  relockMinutes:15,
  defaultCostCentre:'factory',
  costCentres:['factory','warehouse','office','online','owners'],
  evidence:{flagAbove:2000,refuseAbove:0},
  duplicateDays:7,
  countEveryDays:31,
  pendingWatchDays:1,
  commitmentGraceDays:3,
  backupWatchHours:36,
  share:{defaultDays:7},
  tax:{rates:{sales:null,services:null,withholding:null}},
  assetThreshold:50000
};
function maSettings(stored){
  const s=JSON.parse(JSON.stringify(MA_DEFAULT_SETTINGS));
  if(!stored||typeof stored!=='object')return s;
  const num=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
  if(num(stored.fiscalYearStart,1,12))s.fiscalYearStart=Math.round(stored.fiscalYearStart);
  ['goLive','historyFrom'].forEach(k=>{if(maIsDay(stored[k]))s[k]=stored[k];});
  ['payDays','cprDays'].forEach(k=>{
    if(Array.isArray(stored[k])){const v=stored[k].filter(d=>Number.isInteger(d)&&d>=0&&d<=6);if(v.length)s[k]=Array.from(new Set(v)).sort();}
  });
  [['tcsCreditDays',0,365],['courierTolerancePct',0,50],['relockMinutes',1,240],['duplicateDays',0,60],
   ['countEveryDays',1,366],['pendingWatchDays',0,60],['commitmentGraceDays',0,60],['backupWatchHours',1,720],
   ['assetThreshold',0,1e9]].forEach(([k,a,b])=>{if(num(stored[k],a,b))s[k]=stored[k];});
  if(stored.holderFloor&&typeof stored.holderFloor==='object')
    Object.keys(stored.holderFloor).forEach(c=>{const v=stored.holderFloor[c];if(Number.isInteger(v))s.holderFloor[c]=v;});
  if(stored.mirrors&&typeof stored.mirrors==='object'){
    s.mirrors={};Object.keys(stored.mirrors).forEach(c=>{if(stored.mirrors[c])s.mirrors[c]=String(stored.mirrors[c]);});
  }
  if(Array.isArray(stored.costCentres)){
    const v=stored.costCentres.map(x=>String(x||'').trim().toLowerCase()).filter(x=>/^[a-z][a-z0-9_]{1,23}$/.test(x));
    if(v.length)s.costCentres=Array.from(new Set(v));
  }
  if(typeof stored.defaultCostCentre==='string'&&s.costCentres.indexOf(stored.defaultCostCentre)>=0)s.defaultCostCentre=stored.defaultCostCentre;
  if(s.costCentres.indexOf(s.defaultCostCentre)<0)s.defaultCostCentre=s.costCentres[0];
  if(stored.evidence&&typeof stored.evidence==='object'){
    if(num(stored.evidence.flagAbove,0,1e9))s.evidence.flagAbove=stored.evidence.flagAbove;
    if(num(stored.evidence.refuseAbove,0,1e9))s.evidence.refuseAbove=stored.evidence.refuseAbove;
  }
  if(stored.share&&num(stored.share.defaultDays,1,90))s.share.defaultDays=Math.round(stored.share.defaultDays);
  if(stored.tax&&stored.tax.rates&&typeof stored.tax.rates==='object')
    ['sales','services','withholding'].forEach(k=>{const v=stored.tax.rates[k];s.tax.rates[k]=num(v,0,100)?v:null;});
  return s;
}

/* ── Small utilities ────────────────────────────────────────────────────── */
function maPad(n){return String(n).padStart(2,'0');}
function maEsc(s){
  return String(s===undefined||s===null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function maNorm(s){return String(s===undefined||s===null?'':s).trim().replace(/\s+/g,' ').toLowerCase();}
function maClone(o){return o===undefined?undefined:JSON.parse(JSON.stringify(o));}
function maStr(s,max){return String(s===undefined||s===null?'':s).trim().slice(0,max||500);}

/* ── Dates — always LOCAL days, never the UTC ISO string ────────────────── */
/* toISOString() names the PREVIOUS day in Pakistan before 5am (the Board's
   lesson, CLAUDE.md). A day is a 'YYYY-MM-DD' string compared as a string;
   arithmetic goes through Date.UTC so no clock or zone can shift it. */
function maDay(d){d=d||new Date();return d.getFullYear()+'-'+maPad(d.getMonth()+1)+'-'+maPad(d.getDate());}
function maIsDay(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const y=+s.slice(0,4),m=+s.slice(5,7),d=+s.slice(8,10);
  if(y<2000||y>2200||m<1||m>12||d<1)return false;
  return d<=maDaysInMonth(s.slice(0,7));
}
function _maUtc(day){return Date.UTC(+day.slice(0,4),+day.slice(5,7)-1,+day.slice(8,10));}
function _maFromUtc(t){const d=new Date(t);return d.getUTCFullYear()+'-'+maPad(d.getUTCMonth()+1)+'-'+maPad(d.getUTCDate());}
function maDayAdd(day,n){return _maFromUtc(_maUtc(day)+n*86400000);}
function maDaysBetween(a,b){return Math.round((_maUtc(b)-_maUtc(a))/86400000);}
function maWeekday(day){return new Date(_maUtc(day)).getUTCDay();}
function maMonthOf(day){return String(day||'').slice(0,7);}
function maMonthAdd(month,n){const y=+month.slice(0,4),m=+month.slice(5,7)-1+n;const yy=y+Math.floor(m/12),mm=((m%12)+12)%12;return yy+'-'+maPad(mm+1);}
function maDaysInMonth(month){const y=+month.slice(0,4),m=+month.slice(5,7);return new Date(Date.UTC(y,m,0)).getUTCDate();}
/* The fiscal year runs from `fyStart` (7 = July). FY27 is Jul 2026 – Jun
   2027: a year is named by the calendar year it ENDS in (§27). */
function maFyEndYear(day,fyStart){
  fyStart=fyStart||7;const y=+day.slice(0,4),m=+day.slice(5,7);
  if(fyStart===1)return y;
  return m>=fyStart?y+1:y;
}
function maFyOf(day,fyStart){return 'FY'+String(maFyEndYear(day,fyStart)).slice(2);}
function maQuarterOf(day,fyStart){
  fyStart=fyStart||7;const m=+day.slice(5,7);
  const q=Math.floor(((m-fyStart+12)%12)/3)+1;
  return maFyEndYear(day,fyStart)+'-Q'+q;
}
function maQuarterRange(q,fyStart){
  fyStart=fyStart||7;
  const end=+q.slice(0,4),n=+q.slice(-1);
  const startYear=fyStart===1?end:end-1;
  const startMonth=maMonthAdd(startYear+'-'+maPad(fyStart),(n-1)*3);
  const lastMonth=maMonthAdd(startMonth,2);
  return {from:startMonth+'-01',to:lastMonth+'-'+maPad(maDaysInMonth(lastMonth))};
}
function maQuarterLabel(q,fyStart){
  const r=maQuarterRange(q,fyStart);
  const a=MA_MONTHS[+r.from.slice(5,7)-1],b=MA_MONTHS[+r.to.slice(5,7)-1];
  return 'Q'+q.slice(-1)+' FY'+q.slice(2,4)+' · '+a+'–'+b+' '+r.to.slice(0,4);
}
function maPeriodLabels(day,fyStart){return {month:maMonthOf(day),quarter:maQuarterOf(day,fyStart),fy:maFyOf(day,fyStart)};}
function maMonthLabel(month,long){return (long?MA_MONTHS_LONG:MA_MONTHS)[+month.slice(5,7)-1]+' '+month.slice(0,4);}
function maDayLabel(day,withYear){
  if(!maIsDay(day))return '';
  return MA_WEEKDAYS[maWeekday(day)]+' '+(+day.slice(8,10))+' '+MA_MONTHS[+day.slice(5,7)-1]+(withYear?' '+day.slice(0,4):'');
}

/* ── Money — whole rupees, grouped the way the owners count (lac, crore) ─ */
function maIsRupees(v){return Number.isInteger(v);}
function maParseRupees(v){
  if(typeof v==='number')return Number.isFinite(v)?v:NaN;
  const s=String(v===undefined||v===null?'':v).replace(/[₨,\s]/g,'').replace(/^rs\.?/i,'');
  if(!/^-?\d+(\.\d+)?$/.test(s))return NaN;
  return Number(s);
}
/* 1,50,000 — three digits, then twos. Done by hand so a browser without
   the en-IN locale data cannot change it. */
function maGroup(n){
  const s=String(Math.abs(Math.round(n)));
  if(s.length<=3)return s;
  const last=s.slice(-3);let rest=s.slice(0,-3);const parts=[];
  while(rest.length>2){parts.unshift(rest.slice(-2));rest=rest.slice(0,-2);}
  if(rest)parts.unshift(rest);
  return parts.join(',')+','+last;
}
function maRs(n){const v=Math.round(Number(n)||0);return (v<0?'−':'')+'₨'+maGroup(v);}
function maRsSigned(n){const v=Math.round(Number(n)||0);return v===0?maRs(0):(v>0?'+':'−')+'₨'+maGroup(v);}
/* ₨8.4 lac · ₨2.1 cr — for sentences, never for a column. */
function maRsShort(n){
  const v=Math.round(Number(n)||0),a=Math.abs(v),sign=v<0?'−':'';
  const f=x=>(Math.round(x*10)/10).toFixed(1).replace(/\.0$/,'');
  if(a>=1e7)return sign+'₨'+f(a/1e7)+' cr';
  if(a>=1e5)return sign+'₨'+f(a/1e5)+' lac';
  return sign+'₨'+maGroup(a);
}
/* In words, the way a cheque or a receipt is written here (§31) — South-
   Asian grouping, title case: 150000 → "Rupees One Lakh Fifty Thousand
   Only". Whole rupees ONLY: a fraction, a negative, NaN or anything that is
   not a number gives '' — a receipt must never print words for an amount
   that is not the one in its figures. Past 99 crore the crore count is
   spelled in the same words ("One Thousand Crore"). The arithmetic is done
   with % and exact subtraction, never a floored float division, so it holds
   to Number.MAX_SAFE_INTEGER. */
const _maWordOnes=['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const _maWordTens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function _maWords99(n){return n<20?_maWordOnes[n]:_maWordTens[(n-n%10)/10]+(n%10?' '+_maWordOnes[n%10]:'');}
function _maWordsOf(n){
  const out=[];
  const crore=(n-n%1e7)/1e7;n%=1e7;
  if(crore)out.push(_maWordsOf(crore)+' Crore');
  const lakh=(n-n%1e5)/1e5;n%=1e5;
  if(lakh)out.push(_maWords99(lakh)+' Lakh');
  const th=(n-n%1000)/1000;n%=1000;
  if(th)out.push(_maWords99(th)+' Thousand');
  const h=(n-n%100)/100;n%=100;
  if(h)out.push(_maWordOnes[h]+' Hundred');
  if(n)out.push(_maWords99(n));
  return out.join(' ');
}
function maRsWords(n){
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)return '';
  return 'Rupees '+(n?_maWordsOf(n):'Zero')+' Only';
}

/* ── The chart, merged with what the owners changed ──────────────────────── */
function maCodeOk(code,book){return book==='savings'?/^S[1-9]\d{3}$/.test(code):/^[1-9]\d{3}$/.test(code);}
function _maAccNorm(r,book){
  const type=r.type;
  const normal=r.normal==='dr'||r.normal==='cr'?r.normal:
    (type==='asset'||type==='expense'||type==='cogs')?'dr':type==='suspense'?(String(r.code)==='9010'?'cr':'dr'):'cr';
  const out={code:String(r.code),name:maStr(r.name||r.code,80),type,normal,book:book||'groovy',active:r.active!==false,
    order:Number.isFinite(r.order)?r.order:parseInt(String(r.code).replace(/\D/g,''),10)};
  if(r.money){out.money=true;out.holderKind=MA_HOLDER_KINDS.indexOf(r.holderKind)>=0?r.holderKind:'cash';}
  ['person','control','owner','channel','spend','arrives','note'].forEach(k=>{if(r[k]!==undefined&&r[k]!==null&&r[k]!=='')out[k]=r[k];});
  return out;
}
/* A default account keeps its code, type and money-ness — the owners may
   rename it, switch it off or reorder it. A NEW code carries its own type.
   Codes are never reused: nothing here deletes an account. */
function maChart(book,stored){
  book=book==='savings'?'savings':'groovy';
  const by={};
  (book==='savings'?MA_SV_CHART:MA_CHART).forEach(r=>{by[r.code]=_maAccNorm(r,book);});
  (stored||[]).forEach(s=>{
    if(!s||s.code===undefined)return;
    const code=String(s.code);
    if(!maCodeOk(code,book))return;
    const cur=by[code];
    if(cur){
      if(maStr(s.name,80))cur.name=maStr(s.name,80);
      if(typeof s.active==='boolean')cur.active=s.active;
      if(Number.isFinite(s.order))cur.order=s.order;
      if(s.person!==undefined&&cur.money)cur.person=s.person||undefined;
      cur.edited=true;
    }else{
      if(MA_ACCOUNT_TYPES.indexOf(s.type)<0)return;
      const acc=_maAccNorm(s,book);
      if(acc.money&&acc.type!=='asset')delete acc.money;
      if(s.spend&&!MA_SPEND_GROUPS[s.spend])delete acc.spend;
      acc.custom=true;by[code]=acc;
    }
  });
  return Object.keys(by).sort().map(k=>by[k]);
}
function maChartIndex(list){const by={};(list||[]).forEach(a=>{by[a.code]=a;});return {list:list||[],by};}
function maAcc(idx,code){return idx&&idx.by?idx.by[String(code)]||null:null;}
function maIsMoney(idx,code){const a=maAcc(idx,code);return !!(a&&a.money);}
function maMoneyAccounts(idx,opts){
  opts=opts||{};
  return idx.list.filter(a=>a.money&&(opts.all||a.active));
}
function maAccLabel(idx,code){const a=maAcc(idx,code);return a?a.code+' · '+a.name:String(code||'');}
function maSpendGroupOf(acc){return acc&&acc.spend&&MA_SPEND_GROUPS[acc.spend]?acc.spend:null;}

/* ── The tax block (§12) — on every document, never absent ──────────────── */
/* `amount` is what the person typed. Inclusive: the tax is inside it.
   Exclusive: the tax is on top, so the cash that moves is amount + tax.
   Withholding: the payee gets amount − tax and the tax is owed to the
   state (2130), or — on money in — was withheld from us and is a credit. */
function maTaxBlank(){return {kind:'none',rate:0,inclusive:true,claimable:false,amount:0};}
function maTaxCompute(amount,tax){
  const t=Object.assign(maTaxBlank(),tax||{});
  const a=Math.round(Number(amount)||0);
  const rate=Number(t.rate)||0;
  let tx=0,net=a,gross=a,cash=a;
  if(t.kind==='sales'||t.kind==='services'){
    if(t.inclusive!==false){tx=Math.round(a*rate/(100+rate));net=a-tx;gross=a;}
    else{tx=Math.round(a*rate/100);net=a;gross=a+tx;}
    cash=gross;
  }else if(t.kind==='withholding'){
    tx=Math.round(a*rate/100);net=a;gross=a;cash=a-tx;
  }
  return {kind:MA_TAX_KINDS.indexOf(t.kind)>=0?t.kind:'none',rate:t.kind==='none'?0:rate,inclusive:t.inclusive!==false,claimable:!!t.claimable,amount:tx,net,gross,cash};
}
/* The stored block, recomputed so a form can never store a tax amount that
   disagrees with its own rate. */
function maTaxBlock(amount,tax){
  const c=maTaxCompute(amount,tax);
  const out={kind:c.kind,rate:c.rate,inclusive:c.inclusive,claimable:c.claimable,amount:c.amount};
  if(tax&&maStr(tax.ref,60))out.ref=maStr(tax.ref,60);
  return out;
}
function maTaxIssues(tax,amount){
  const out=[];
  if(!tax||typeof tax!=='object'||!tax.kind){out.push({rule:'tax.missing',level:'refuse',field:'tax',message:'Choose a tax treatment — “No tax” is a choice, and it has to be made.'});return out;}
  if(MA_TAX_KINDS.indexOf(tax.kind)<0){out.push({rule:'tax.kind',level:'refuse',field:'tax',message:'Unknown tax kind “'+tax.kind+'”.'});return out;}
  if(tax.kind==='none'){
    if(Number(tax.amount)||0)out.push({rule:'tax.amount',level:'refuse',field:'tax',message:'“No tax” cannot carry a tax amount.'});
    return out;
  }
  const r=Number(tax.rate);
  if(!Number.isFinite(r)||r<=0||r>100){out.push({rule:'tax.rate',level:'refuse',field:'tax',message:'A tax rate is between 0 and 100%.'});return out;}
  const c=maTaxCompute(amount,tax);
  if(!Number.isInteger(tax.amount)||Math.abs(tax.amount-c.amount)>1)
    out.push({rule:'tax.amount',level:'refuse',field:'tax',message:'Tax should be '+maRs(c.amount)+' at '+r+'% — it says '+maRs(tax.amount||0)+'.'});
  return out;
}

/* ── Numbering ─────────────────────────────────────────────────────────── */
/* JV-27-0001: the kind, the fiscal year, the sequence. Minted in the SAME
   transaction as the document (the Pattern Hub lesson), so a write that
   does not land never spends a number. */
function maDocNo(dt,fy,seq){
  const p=MA_DOC_TYPES[dt]?MA_DOC_TYPES[dt].prefix:'DOC';
  return p+'-'+String(fy||'').replace(/^FY/,'')+'-'+String(seq).padStart(4,'0');
}

/* ── Building a document from what a form holds ─────────────────────────── */
/* Pure: trims, rounds, computes the tax, labels the period, decides
   historical and pending. It never assigns an id or a number — the writer
   mints both in one transaction. What the app writes is exactly what this
   returns, so the tests and the emulator check the real shape. */
function maTransferConfirm(from,to,idx,recorder,settings){
  const s=settings||MA_DEFAULT_SETTINGS;
  const t=maAcc(idx,to);
  if(!t)return {pending:false,confirmBy:null,paper:false,via:null};
  if(s.mirrors&&s.mirrors[t.code])return {pending:false,confirmBy:null,paper:false,via:s.mirrors[t.code]};
  const p=t.person;
  if(!p||p===recorder)return {pending:false,confirmBy:null,paper:false,via:null};
  return {pending:true,confirmBy:p,paper:MA_OWNERS.indexOf(p)<0,via:null};
}
function maBuildDoc(dt,input,meta,idx,settings){
  const s=settings||MA_DEFAULT_SETTINGS;
  const i=input||{},m=meta||{};
  const date=maStr(i.date,10);
  const labels=maIsDay(date)?maPeriodLabels(date,s.fiscalYearStart):{month:'',quarter:'',fy:''};
  const doc={dt,book:'groovy',date,month:labels.month,quarter:labels.quarter,fy:labels.fy,
    historical:maIsDay(date)&&date<s.goLive,
    note:maStr(i.note,1000),tags:Array.isArray(i.tags)?i.tags.map(t=>maStr(t,40)).filter(Boolean).slice(0,12):[],
    attachments:maAttachList(i.attachments),
    source:MA_SOURCES.indexOf(m.source)>=0?m.source:'manual',
    by:m.by||null,byName:m.byName||null,ts:m.ts||0,rev:1,edits:[],status:'posted'};
  const rupees=v=>{const n=maParseRupees(v);return Number.isFinite(n)?n:NaN;}; // never rounded here: a fraction is kept so maValidate refuses it (amount.whole)
  if(dt==='journal'){
    const k=MA_JOURNAL_KINDS[i.kind]?i.kind:'general';
    doc.kind=k;
    const def=MA_JOURNAL_KINDS[k];
    if(def.holder)doc.holder=maStr(i.holder,8);
    if(def.owner)doc.owner=MA_OWNERS.indexOf(i.owner)>=0?i.owner:maStr(i.owner,20);
    if(def.account)doc.account=maStr(i.account,8);
    if(def.payee){
      doc.party=maStr(i.party,60)||null;
      doc.payee=doc.party?'':maStr(i.payee,120);
      doc.partyKind=doc.party?maStr(i.partyKind,20)||null:null;
    }
    if(!def.lines){
      doc.amount=rupees(i.amount);
      doc.tax=def.tax?maTaxBlock(doc.amount,i.tax||maTaxBlank()):maTaxBlank();
      if(def.tax){
        doc.costCentre=maStr(i.costCentre,24)||'';
        doc.labelKind=MA_LABEL_KINDS.indexOf(i.labelKind)>=0?i.labelKind:'';
        doc.channel=MA_CHANNELS.indexOf(i.channel)>=0?i.channel:'';
        doc.po=maStr(i.po,40);doc.article=maStr(i.article,40);
        doc.commitmentId=maStr(i.commitmentId,60)||null;
        doc.commitmentPeriod=doc.commitmentId?maStr(i.commitmentPeriod,12):'';
      }
    }else{
      doc.tax=maTaxBlank();
      doc.lines=(Array.isArray(i.lines)?i.lines:[]).slice(0,60).map(l=>{
        const o={account:maStr(l&&l.account,8)};
        if(k==='opening'){o.side=l&&l.side==='cr'?'cr':'dr';o.amount=rupees(l&&l.amount);}
        else{o.dr=rupees(l&&l.dr||0);o.cr=rupees(l&&l.cr||0);}
        if(l&&maStr(l.party,60))o.party=maStr(l.party,60);
        if(l&&maStr(l.memo,200))o.memo=maStr(l.memo,200);
        if(l&&maStr(l.costCentre,24))o.costCentre=maStr(l.costCentre,24);
        return o;
      });
      doc.amount=maJournalTotal(doc);
    }
  }else if(dt==='transfer'){
    doc.from=maStr(i.from,8);doc.to=maStr(i.to,8);doc.amount=rupees(i.amount);doc.tax=maTaxBlank();
    const c=maTransferConfirm(doc.from,doc.to,idx,m.by,s);
    doc.status=c.pending?'pending':'posted';
    doc.confirmBy=c.confirmBy;doc.confirmPaper=c.paper;
    if(c.via)doc.confirmVia=c.via;
  }else if(dt==='count'){
    doc.holder=maStr(i.holder,8);doc.counted=rupees(i.counted);
    doc.bookBalance=Number.isInteger(m.bookBalance)?m.bookBalance:0;
    doc.difference=Number.isInteger(doc.counted)?doc.counted-doc.bookBalance:NaN;
    doc.amount=Number.isInteger(doc.difference)?Math.abs(doc.difference):0;
    doc.tax=maTaxBlank();
  }
  return doc;
}
/* A journal with its own lines: the total is its debit side. */
function maJournalTotal(doc){
  if(!doc||!Array.isArray(doc.lines))return 0;
  if(doc.kind==='opening'){
    let dr=0,cr=0;doc.lines.forEach(l=>{const a=Number(l.amount)||0;if(l.side==='cr')cr+=a;else dr+=a;});
    return Math.max(dr,cr);
  }
  return doc.lines.reduce((t,l)=>t+(Number(l.dr)||0),0);
}

/* ── Posting (§7) — a document's lines, labelled per §27 ─────────────────── */
/* Every line is {account, dr, cr} plus the labels. A void or a pending
   document posts NOTHING — "pending never counts" (§6). */
function maPost(doc,idx,settings){
  const s=settings||MA_DEFAULT_SETTINGS;
  if(!doc||doc.status==='void'||doc.status==='pending')return [];
  const out=[];
  const base={
    book:doc.book||'groovy',
    doc:{dt:doc.dt,kind:doc.kind||null,id:doc.id||doc._id||null,no:doc.no||null},
    date:doc.date,month:doc.month,quarter:doc.quarter,fy:doc.fy,
    status:doc.historical?'historical':'posted',
    source:doc.source||'manual',by:doc.by||null,
    evidence:(doc.attachments||[]).length,tags:doc.tags||[],
    party:doc.party||null,partyKind:doc.partyKind||null,payee:doc.payee||''
  };
  const push=(code,dr,cr,extra)=>{
    dr=Math.round(dr||0);cr=Math.round(cr||0);
    if(!dr&&!cr)return;
    if(dr<0){cr+=-dr;dr=0;}if(cr<0){dr+=-cr;cr=0;}
    if(dr&&cr){const n=dr-cr;dr=n>0?n:0;cr=n<0?-n:0;if(!dr&&!cr)return;}
    const acc=maAcc(idx,code);
    const l=Object.assign({},base,{account:String(code),dr,cr},extra||{});
    if(acc&&acc.money)l.holder=acc.code;
    const g=maSpendGroupOf(acc);
    if(g){
      l.category=acc.name;l.spendGroup=g;
      l.costCentre=(extra&&extra.costCentre)||doc.costCentre||s.defaultCostCentre;
      l.kind=doc.labelKind||MA_SPEND_GROUPS[g].kind;
    }else if(!l.kind){l.kind=doc.dt==='transfer'?'transfer':null;}
    if(acc&&acc.type==='revenue')l.channel=doc.channel||acc.channel||'other';
    if(doc.po)l.po=doc.po;
    if(doc.article)l.article=doc.article;
    out.push(l);
  };
  if(doc.dt==='journal'){
    const k=doc.kind;
    const a=Math.round(doc.amount||0);
    if(k==='money_out'){
      const t=maTaxCompute(a,doc.tax);
      const taxToAsset=(t.kind==='sales'||t.kind==='services')&&t.claimable;
      const expense=t.kind==='withholding'?t.gross:(taxToAsset?t.net:t.gross);
      push(doc.account,expense,0);
      if(taxToAsset)push('1160',t.amount,0,{taxKind:t.kind});
      push(doc.holder,0,t.cash);
      if(t.kind==='withholding')push('2130',0,t.amount,{taxKind:t.kind});
    }else if(k==='money_in'){
      const t=maTaxCompute(a,doc.tax);
      push(doc.holder,t.cash,0);
      if(t.kind==='withholding')push('1160',t.amount,0,{taxKind:t.kind});
      push(doc.account,0,t.kind==='sales'||t.kind==='services'?t.net:t.gross);
      if(t.kind==='sales'||t.kind==='services')push('2120',0,t.amount,{taxKind:t.kind});
    }else if(k==='capital'){
      push(doc.holder,a,0);push(doc.owner==='ammar'?'3011':'3010',0,a);
    }else if(k==='drawing'){
      push(doc.owner==='ammar'?'3021':'3020',a,0);push(doc.holder,0,a);
    }else if(k==='opening'){
      let dr=0,cr=0;
      (doc.lines||[]).forEach(l=>{
        const amt=Math.round(l.amount||0);
        const ex={party:l.party||null,memo:l.memo||'',costCentre:l.costCentre||undefined};
        if(l.side==='cr'){push(l.account,0,amt,ex);cr+=amt;}else{push(l.account,amt,0,ex);dr+=amt;}
      });
      if(dr>cr)push('3090',0,dr-cr);else if(cr>dr)push('3090',cr-dr,0);
    }else{
      (doc.lines||[]).forEach(l=>push(l.account,l.dr,l.cr,{party:l.party||null,memo:l.memo||'',costCentre:l.costCentre||undefined}));
    }
  }else if(doc.dt==='transfer'){
    const a=Math.round(doc.amount||0);
    push(doc.to,a,0,{kind:'transfer'});push(doc.from,0,a,{kind:'transfer'});
  }else if(doc.dt==='count'){
    const d=Math.round(doc.difference||0);
    if(d>0){push(doc.holder,d,0);push('9030',0,d);}
    else if(d<0){push('9030',-d,0);push(doc.holder,0,-d);}
  }
  return out;
}
function maPostAll(docs,idx,settings){
  const out=[];(docs||[]).forEach(d=>{const l=maPost(d,idx,settings);for(let i=0;i<l.length;i++)out.push(l[i]);});
  return out;
}

/* ── Balances — derived, never stored ───────────────────────────────────── */
function maSumLines(lines,pred){
  const s={};
  for(const l of lines||[]){
    if(pred&&!pred(l))continue;
    const a=s[l.account]||(s[l.account]={dr:0,cr:0});
    a.dr+=l.dr||0;a.cr+=l.cr||0;
  }
  return s;
}
/* In the account's own sense: an asset that holds money is positive; a
   payable we owe is positive. */
function maBal(acc,sum){
  if(!sum)return 0;
  return acc&&acc.normal==='cr'?sum.cr-sum.dr:sum.dr-sum.cr;
}
function maBalanceOf(lines,idx,code,asOf){
  const acc=maAcc(idx,code);
  const s=maSumLines(lines,l=>l.account===String(code)&&(!asOf||l.date<=asOf));
  return maBal(acc||{normal:'dr'},s[String(code)]);
}
/* The running balance of one account in date order, and the lowest point on
   or after `fromDay` — how the engine sees "the drawer would have been
   short on 12 Aug". */
function maRunningMin(lines,idx,code,fromDay){
  const acc=maAcc(idx,code)||{normal:'dr'};
  const own=(lines||[]).filter(l=>l.account===String(code)).slice().sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  let bal=0,min=null,minDay=null;
  const byDay={};own.forEach(l=>{byDay[l.date]=(byDay[l.date]||0)+(acc.normal==='cr'?l.cr-l.dr:l.dr-l.cr);});
  const days=Object.keys(byDay).sort();
  days.forEach(d=>{bal+=byDay[d];if(d>=fromDay&&(min===null||bal<min)){min=bal;minDay=d;}});
  if(min===null){bal=0;days.forEach(d=>{if(d<fromDay)bal+=byDay[d];});min=bal;minDay=fromDay;}
  return {min,day:minDay};
}
/* Every holder, its balance, what waits to be confirmed in and out, and
   what it can actually pay with. A mirrored holder takes its balance from
   the module that still owns it (`mirrorBalances`, e.g. Store Accounts'
   drawer) — never a zero when that read failed: `mirrorOk:false`. */
function maHolderRows(idx,lines,docs,opts){
  opts=opts||{};
  const s=opts.settings||MA_DEFAULT_SETTINGS;
  const sums=maSumLines(lines,l=>(!opts.asOf||l.date<=opts.asOf)&&l.book!=='savings');
  const pend=(docs||[]).filter(d=>d.dt==='transfer'&&d.status==='pending');
  const counts=(docs||[]).filter(d=>d.dt==='count'&&d.status!=='void');
  const lastMove={};(lines||[]).forEach(l=>{if(l.holder&&l.account===l.holder&&(!lastMove[l.holder]||l.date>lastMove[l.holder]))lastMove[l.holder]=l.date;});
  return maMoneyAccounts(idx,{all:true}).filter(a=>a.active||sums[a.code]||pend.some(p=>p.from===a.code||p.to===a.code)).map(a=>{
    const ledger=maBal(a,sums[a.code]);
    const mirror=s.mirrors&&s.mirrors[a.code]?s.mirrors[a.code]:null;
    const mb=opts.mirrorBalances||{};
    const mirrorOk=!mirror||Number.isInteger(mb[a.code]);
    const balance=mirror?(mirrorOk?mb[a.code]:null):ledger;
    const pendingIn=pend.filter(p=>p.to===a.code).reduce((t,p)=>t+(p.amount||0),0);
    const pendingOut=pend.filter(p=>p.from===a.code).reduce((t,p)=>t+(p.amount||0),0);
    const lc=counts.filter(c=>c.holder===a.code).sort((x,y)=>x.date<y.date?1:x.date>y.date?-1:(y.ts||0)-(x.ts||0))[0]||null;
    return {code:a.code,name:a.name,person:a.person||null,holderKind:a.holderKind,active:a.active,mirror,mirrorOk,
      ledger,balance,pendingIn,pendingOut,available:balance===null?null:balance-pendingOut,
      floor:Number.isInteger(s.holderFloor[a.code])?s.holderFloor[a.code]:0,
      lastCount:lc?{date:lc.date,counted:lc.counted,difference:lc.difference,no:lc.no||null}:null,
      lastMove:lastMove[a.code]||null};
  });
}
/* Cash in hand, the hero number: every active holder but the TCS account
   (money that sits at TCS is not in anybody's hand until it is drawn).
   `complete:false` when a mirrored holder could not be read — the page
   says so instead of showing a smaller number as if it were whole. */
function maCashInHand(rows){
  let total=0,complete=true,n=0;
  (rows||[]).forEach(r=>{
    if(!r.active||r.holderKind==='wallet')return;
    if(r.balance===null){complete=false;return;}
    total+=r.balance;n++;
  });
  return {total,complete,holders:n};
}
/* The trial balance: every account's debit and credit totals and its net
   on one side. Debits equal credits or the books are wrong — a test
   invariant and, from M2, a nightly check. */
function maTrialBalance(lines,idx,opts){
  opts=opts||{};
  const sums=maSumLines(lines,l=>(!opts.book||l.book===opts.book)&&(!opts.asOf||l.date<=opts.asOf)&&(!opts.from||l.date>=opts.from));
  const rows=Object.keys(sums).sort().map(code=>{
    const acc=maAcc(idx,code)||{code,name:'Unknown account '+code,type:'suspense',normal:'dr'};
    const s=sums[code];const net=s.dr-s.cr;
    return {code,name:acc.name,type:acc.type,dr:s.dr,cr:s.cr,debit:net>0?net:0,credit:net<0?-net:0};
  });
  const dr=rows.reduce((t,r)=>t+r.dr,0),cr=rows.reduce((t,r)=>t+r.cr,0);
  const debit=rows.reduce((t,r)=>t+r.debit,0),credit=rows.reduce((t,r)=>t+r.credit,0);
  return {rows,dr,cr,debit,credit,balanced:dr===cr&&debit===credit};
}
/* The ledger (§16.2 "every posting, one shape"). With ONE account, holder
   or party it carries an opening, a running balance and a closing. */
function maLedger(lines,filter,idx){
  const f=filter||{};
  const q=maNorm(f.q);
  const inRange=l=>(!f.from||l.date>=f.from)&&(!f.to||l.date<=f.to);
  const match=l=>
    (!f.book||l.book===f.book)&&
    (!f.account||l.account===String(f.account))&&
    (!f.holder||l.account===String(f.holder))&&
    (!f.party||l.party===f.party)&&
    (!f.category||l.category===f.category)&&
    (!f.spendGroup||l.spendGroup===f.spendGroup)&&
    (!f.costCentre||l.costCentre===f.costCentre)&&
    (!f.source||l.source===f.source)&&
    (!f.kind||l.kind===f.kind)&&
    (!f.dt||(l.doc&&l.doc.dt===f.dt))&&
    (!q||maLineText(l,idx).indexOf(q)>=0);
  const all=(lines||[]).filter(match).slice().sort((a,b)=>
    a.date<b.date?-1:a.date>b.date?1:String(a.doc&&a.doc.no||'').localeCompare(String(b.doc&&b.doc.no||'')));
  const single=f.account||f.holder;
  const acc=single?maAcc(idx,single)||{normal:'dr'}:null;
  const sign=l=>acc&&acc.normal==='cr'?l.cr-l.dr:l.dr-l.cr;
  let opening=0;
  if(single&&f.from)all.forEach(l=>{if(l.date<f.from)opening+=sign(l);});
  let run=opening;
  const rows=[];let dr=0,cr=0;
  all.forEach(l=>{
    if(!inRange(l))return;
    dr+=l.dr;cr+=l.cr;
    const r=Object.assign({},l);
    if(single){run+=sign(l);r.balance=run;}
    rows.push(r);
  });
  return {rows,opening:single?opening:null,closing:single?run:null,dr,cr,count:rows.length,
    sources:Array.from(new Set(rows.map(r=>r.source))).length};
}
function maLineText(l,idx){
  const a=maAcc(idx,l.account);
  return maNorm([l.doc&&l.doc.no,l.account,a&&a.name,l.payee,l.party,l.category,l.costCentre,l.memo,l.date,(l.tags||[]).join(' ')].join(' '));
}

/* ── Party master (§4.2) — terms and rate cards keep their history ───────── */
function maTermsIssues(t){
  const out=[];
  const bad=(rule,message,field)=>out.push({rule,level:'refuse',field:field||'terms',message});
  if(!t||MA_TERMS_MODES.indexOf(t.mode)<0){bad('terms.mode','Terms are cash, credit, monthly or weekly.');return out;}
  if(t.mode==='credit'&&!(Number.isInteger(t.creditDays)&&t.creditDays>=1&&t.creditDays<=365))bad('terms.days','Credit terms need their days (1 to 365).');
  if(t.creditLimit!==undefined&&t.creditLimit!==null&&!(Number.isInteger(t.creditLimit)&&t.creditLimit>=0))bad('terms.limit','A credit limit is whole rupees, or empty for none.');
  if(t.mode==='monthly'&&!(Number.isInteger(t.billDay)&&t.billDay>=1&&t.billDay<=31))bad('terms.billDay','A monthly bill needs its day of the month.');
  if(t.mode==='weekly'){
    const w=Array.isArray(t.billWeekdays)?t.billWeekdays:[];
    if(!w.length||w.some(d=>!(Number.isInteger(d)&&d>=0&&d<=6)))bad('terms.billWeekdays','A weekly bill needs at least one weekday.');
  }
  if(t.payDays!==undefined&&(!Array.isArray(t.payDays)||t.payDays.some(d=>!(Number.isInteger(d)&&d>=0&&d<=6))))bad('terms.payDays','Pay days are weekdays.');
  if(t.retentionPct!==undefined&&t.retentionPct!==null&&!(Number.isFinite(t.retentionPct)&&t.retentionPct>=0&&t.retentionPct<=50))bad('terms.retention','Retention is 0 to 50%.');
  if(t.from!==undefined&&t.from!==null&&t.from!==''&&!maIsDay(t.from))bad('terms.from','Terms start on a real day.');
  return out;
}
function maTermsText(t){
  if(!t)return 'No terms';
  if(t.mode==='cash')return 'Cash';
  if(t.mode==='credit')return 'Credit '+t.creditDays+' days'+(Number.isInteger(t.creditLimit)&&t.creditLimit>0?' · limit '+maRsShort(t.creditLimit):'');
  if(t.mode==='monthly')return 'Monthly · bill on the '+t.billDay+_maOrd(t.billDay);
  if(t.mode==='weekly')return 'Weekly · '+(t.billWeekdays||[]).map(d=>MA_WEEKDAYS[d]).join(' & ');
  return t.mode;
}
function _maOrd(n){const v=n%100;if(v>=11&&v<=13)return 'th';return ['th','st','nd','rd'][n%10]||'th';}
/* The terms in force on a day. Older bills keep the terms they were made
   under (§2 "terms are the key"). */
function maTermsAt(party,day){
  const v=party&&party.vendor;if(!v)return null;
  const cur=v.terms||null;
  if(cur&&(!cur.from||!day||day>=cur.from))return cur;
  const hist=(v.termsHistory||[]).slice().sort((a,b)=>String(a.from||'').localeCompare(String(b.from||'')));
  for(let i=hist.length-1;i>=0;i--){const h=hist[i];if((!h.from||day>=h.from)&&(!h.to||day<=h.to))return h;}
  return hist.length?hist[0]:cur;
}
/* Changing terms closes the current ones the day before the new ones
   start, and keeps them. Never moves a bill already made. */
function maTermsChange(party,terms,meta){
  const p=maClone(party)||{};p.vendor=p.vendor||{};
  const m=meta||{};
  const from=maIsDay(m.from)?m.from:(m.today||'');
  const cur=p.vendor.terms;
  p.vendor.termsHistory=Array.isArray(p.vendor.termsHistory)?p.vendor.termsHistory:[];
  if(cur)p.vendor.termsHistory.push(Object.assign({},cur,{to:from?maDayAdd(from,-1):null,by:m.by||null,at:m.at||0,reason:maStr(m.reason,300)}));
  p.vendor.terms=Object.assign({},terms,{from});
  return p;
}
function maNextPayDay(day,payDays){
  const w=(payDays&&payDays.length?payDays:MA_DEFAULT_SETTINGS.payDays);
  for(let i=0;i<7;i++){const d=maDayAdd(day,i);if(w.indexOf(maWeekday(d))>=0)return d;}
  return day;
}
/* When a bill made on `day` falls due under these terms. */
function maDueDate(terms,day){
  if(!terms||!maIsDay(day))return day;
  if(terms.mode==='credit')return maDayAdd(day,terms.creditDays||0);
  if(terms.mode==='monthly'){
    const bd=terms.billDay||1;
    let mo=maMonthOf(day);
    let d=mo+'-'+maPad(Math.min(bd,maDaysInMonth(mo)));
    if(d<day){mo=maMonthAdd(mo,1);d=mo+'-'+maPad(Math.min(bd,maDaysInMonth(mo)));}
    return terms.creditDays?maDayAdd(d,terms.creditDays):d;
  }
  if(terms.mode==='weekly'){
    const w=terms.billWeekdays&&terms.billWeekdays.length?terms.billWeekdays:[1];
    for(let i=0;i<7;i++){const d=maDayAdd(day,i);if(w.indexOf(maWeekday(d))>=0)return d;}
  }
  return day;
}
/* The rate on a day for one item, from the card with its history. */
function maRateAt(party,item,day){
  const card=(party&&party.vendor&&party.vendor.rateCard)||[];
  const k=maNorm(item);
  const hits=card.filter(r=>maNorm(r.item)===k&&(!r.validFrom||!day||r.validFrom<=day)&&(!r.validTo||!day||day<=r.validTo));
  hits.sort((a,b)=>String(a.validFrom||'').localeCompare(String(b.validFrom||'')));
  return hits.length?hits[hits.length-1]:null;
}
function maRateIssues(r){
  const out=[];
  if(!r||!maStr(r.item,80))out.push({rule:'rate.item',level:'refuse',field:'item',message:'Name the item or service.'});
  if(!r||!maStr(r.unit,20))out.push({rule:'rate.unit',level:'refuse',field:'unit',message:'Give the unit (piece, kg, metre, month…).'});
  const v=r&&Number(r.rate);
  if(!(Number.isFinite(v)&&v>=0&&v<1e8&&Math.round(v*100)===v*100))out.push({rule:'rate.value',level:'refuse',field:'rate',message:'A rate is rupees, to two decimals at most.'});
  if(r&&r.validFrom&&!maIsDay(r.validFrom))out.push({rule:'rate.from',level:'refuse',field:'validFrom',message:'A rate starts on a real day.'});
  return out;
}
/* A new rate closes the open one for the same item and unit the day before
   it starts, and both stay on the card. */
function maRateChange(party,entry,meta){
  const p=maClone(party)||{};p.vendor=p.vendor||{};
  const m=meta||{};
  const card=Array.isArray(p.vendor.rateCard)?p.vendor.rateCard:[];
  const from=maIsDay(entry.validFrom)?entry.validFrom:(m.today||'');
  card.forEach(r=>{
    if(maNorm(r.item)===maNorm(entry.item)&&maNorm(r.unit)===maNorm(entry.unit)&&!r.validTo&&(!r.validFrom||r.validFrom<from))
      r.validTo=from?maDayAdd(from,-1):null;
  });
  card.push({id:m.id||('r'+(card.length+1)),item:maStr(entry.item,80),unit:maStr(entry.unit,20),
    rate:Number(entry.rate),validFrom:from,by:m.by||null,at:m.at||0,note:maStr(entry.note,200)});
  p.vendor.rateCard=card;
  return p;
}
/* A short unique code from a name: AL-KARAM → ALKA, then ALKA2… */
function maPartyCode(name,taken){
  const set=new Set((taken||[]).map(x=>String(x).toUpperCase()));
  const letters=String(name||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  let base=(letters.slice(0,4)||'P').padEnd(2,'X');
  if(!set.has(base))return base;
  for(let i=2;i<100000;i++){const c=base+i;if(!set.has(c))return c;}
  return null;
}
function maPartyIssues(p,ctx){
  const out=[];const c=ctx||{};
  const bad=(rule,message,field)=>out.push({rule,level:'refuse',field,message});
  if(!p||MA_PARTY_KINDS.indexOf(p.kind)<0)bad('party.kind','A party is a vendor, customer, courier, gateway, employee, owner or bank.','kind');
  if(!p||maStr(p.name,120).length<2)bad('party.name','Give the party a name.','name');
  if(p&&!/^[A-Z0-9]{2,12}$/.test(String(p.code||'')))bad('party.code','A code is 2 to 12 capital letters or digits.','code');
  const others=(c.parties||[]).filter(x=>x&&x.id!==(p&&p.id));
  if(p&&p.code&&others.some(x=>String(x.code||'').toUpperCase()===String(p.code).toUpperCase()))bad('party.code_taken','The code '+p.code+' is taken.','code');
  if(p&&p.name&&others.some(x=>maNorm(x.name)===maNorm(p.name)&&x.kind===p.kind))out.push({rule:'party.same_name',level:'flag',field:'name',message:'Another '+(MA_PARTY_KIND_LABELS[p.kind]||'party').toLowerCase()+' has this name.'});
  if(p&&p.vendor){
    if(p.vendor.terms)maTermsIssues(p.vendor.terms).forEach(x=>out.push(x));
    const roles=p.vendor.roles||[];
    if(roles.some(r=>MA_VENDOR_ROLES.indexOf(r)<0))bad('party.roles','Unknown vendor role.','roles');
    const tx=p.vendor.tax;
    if(tx&&tx.regime&&['none','sales','services'].indexOf(tx.regime)<0)bad('party.tax','A tax regime is none, sales or services.','tax');
    if(tx&&tx.withholdingPct!==undefined&&tx.withholdingPct!==null&&!(Number.isFinite(tx.withholdingPct)&&tx.withholdingPct>=0&&tx.withholdingPct<=100))bad('party.wht','Withholding is 0 to 100%.','tax');
  }
  if(p&&p.courier&&p.courier.cycle&&MA_COURIER_CYCLES.indexOf(p.courier.cycle)<0)bad('party.cycle','Unknown courier cycle.','cycle');
  if(p&&p.costCentre&&c.settings&&c.settings.costCentres.indexOf(p.costCentre)<0)bad('party.costCentre','Unknown cost centre.','costCentre');
  if(p&&p.owner&&p.kind==='owner'&&MA_OWNERS.indexOf(p.owner.username)<0)bad('party.owner','An owner party is Afnan or Ammar.','owner');
  return out;
}
function maItemIssues(it,ctx){
  const out=[];const c=ctx||{};
  if(!it||maStr(it.name,80).length<2)out.push({rule:'item.name',level:'refuse',field:'name',message:'Name the item or service.'});
  if(!it||MA_ITEM_KINDS.indexOf(it.kind)<0)out.push({rule:'item.kind',level:'refuse',field:'kind',message:'Pick what kind of item it is.'});
  if(!it||!maStr(it.unit,20))out.push({rule:'item.unit',level:'refuse',field:'unit',message:'Give the unit.'});
  if(it&&it.account&&c.idx){const a=maAcc(c.idx,it.account);if(!a||a.money)out.push({rule:'item.account',level:'refuse',field:'account',message:'Pick the account this item is booked to.'});}
  const others=(c.items||[]).filter(x=>x&&x.id!==(it&&it.id));
  if(it&&it.name&&others.some(x=>maNorm(x.name)===maNorm(it.name)))out.push({rule:'item.same',level:'refuse',field:'name',message:'An item with this name exists.'});
  return out;
}

/* ── The cost register (§26) — `ma_commitments` ─────────────────────────── */
function maCommitmentIssues(c,ctx){
  const out=[];const x=ctx||{};
  const bad=(rule,message,field)=>out.push({rule,level:'refuse',field,message});
  if(!c||maStr(c.name,120).length<2)bad('commit.name','Name the commitment (Rent — factory).','name');
  if(!c||MA_COMMIT_KINDS.indexOf(c.kind)<0)bad('commit.kind','Pick its kind: fixed, variable, running, people, financing, one-off or tax.','kind');
  if(!c||MA_CADENCES.indexOf(c.cadence)<0)bad('commit.cadence','Pick how often it falls due.','cadence');
  if(c&&!(Number.isInteger(c.amountExpected)&&c.amountExpected>=0))bad('commit.amount','The expected amount is whole rupees (0 if it varies).','amountExpected');
  if(c&&(c.cadence==='monthly'||c.cadence==='quarterly'||c.cadence==='yearly')&&!(Number.isInteger(c.dueDay)&&c.dueDay>=1&&c.dueDay<=31))bad('commit.dueDay','Give the day of the month it falls due.','dueDay');
  if(c&&c.cadence==='weekly'&&!(Number.isInteger(c.dueWeekday)&&c.dueWeekday>=0&&c.dueWeekday<=6))bad('commit.dueWeekday','Give the weekday it falls due.','dueWeekday');
  if(c&&c.cadence==='yearly'&&!(Number.isInteger(c.dueMonth)&&c.dueMonth>=1&&c.dueMonth<=12))bad('commit.dueMonth','Give the month it falls due.','dueMonth');
  if(c&&c.cadence==='quarterly'&&c.dueMonth!==undefined&&c.dueMonth!==null&&!(Number.isInteger(c.dueMonth)&&c.dueMonth>=1&&c.dueMonth<=3))bad('commit.dueMonth','A quarterly commitment falls in month 1, 2 or 3 of the quarter.','dueMonth');
  if(x.idx&&c){
    const a=maAcc(x.idx,c.account);
    if(!a||a.money||!a.active)bad('commit.account','Pick the account it is booked to.','account');
    if(c.holder){
      const h=maAcc(x.idx,c.holder);
      if(!h||!h.money)bad('commit.holder','The holder it is paid from is a money account.','holder');
      else if(x.settings&&x.settings.mirrors&&x.settings.mirrors[c.holder])bad('commit.holder_mirror','The drawer is Raees’s book in Store Accounts until M8 — a commitment he pays is recorded there.','holder');
    }
  }
  if(c&&c.from&&!maIsDay(c.from))bad('commit.from','It starts on a real day.','from');
  if(c&&c.to&&(!maIsDay(c.to)||(c.from&&c.to<c.from)))bad('commit.to','It ends on a real day after it starts.','to');
  if(c&&c.party&&x.parties&&!x.parties.some(p=>p.id===c.party))bad('commit.party','That party does not exist.','party');
  return out;
}
function _maClampDay(month,day){return month+'-'+maPad(Math.min(day,maDaysInMonth(month)));}
/* Every due day of a commitment inside [from, to]. Per-parcel, per-piece
   and "varies" have no calendar day — they are learned from documents. */
function maCommitmentDueDays(c,from,to,fyStart){
  const out=[];
  if(!c||!maIsDay(from)||!maIsDay(to)||to<from)return out;
  const lo=c.from&&c.from>from?c.from:from,hi=c.to&&c.to<to?c.to:to;
  if(hi<lo)return out;
  if(c.cadence==='monthly'){
    for(let mo=maMonthOf(lo);mo<=maMonthOf(hi);mo=maMonthAdd(mo,1)){const d=_maClampDay(mo,c.dueDay);if(d>=lo&&d<=hi)out.push(d);}
  }else if(c.cadence==='weekly'){
    for(let d=lo;d<=hi;d=maDayAdd(d,1))if(maWeekday(d)===c.dueWeekday)out.push(d);
  }else if(c.cadence==='quarterly'){
    const fy=fyStart||7;const within=(c.dueMonth||1)-1;
    for(let mo=maMonthOf(lo);mo<=maMonthOf(hi);mo=maMonthAdd(mo,1)){
      const off=((+mo.slice(5,7))-fy+12)%12;
      if(off%3===within){const d=_maClampDay(mo,c.dueDay);if(d>=lo&&d<=hi)out.push(d);}
    }
  }else if(c.cadence==='yearly'){
    for(let y=+lo.slice(0,4);y<=+hi.slice(0,4);y++){const d=_maClampDay(y+'-'+maPad(c.dueMonth),c.dueDay);if(d>=lo&&d<=hi)out.push(d);}
  }
  return out;
}
/* The period a due day belongs to: what a payment names when it settles it. */
function maCommitmentPeriodKey(c,day,fyStart){
  if(!c||!maIsDay(day))return '';
  if(c.cadence==='monthly')return maMonthOf(day);
  if(c.cadence==='quarterly')return maQuarterOf(day,fyStart);
  if(c.cadence==='yearly')return day.slice(0,4);
  return day;
}
/* Where a commitment stands for the period that contains `today` or was
   last due: paid (a document names it for that period), part-paid, due,
   overdue (past the grace), or upcoming. The documents are the truth. */
function maCommitmentStatus(c,docs,today,settings){
  const s=settings||MA_DEFAULT_SETTINGS;
  if(!c||c.active===false||MA_CADENCES.slice(0,4).indexOf(c.cadence)<0)return {state:'none'};
  const back=c.cadence==='weekly'?7:c.cadence==='monthly'?31:c.cadence==='quarterly'?92:366;
  const past=maCommitmentDueDays(c,maDayAdd(today,-back),today,s.fiscalYearStart);
  const next=maCommitmentDueDays(c,maDayAdd(today,1),maDayAdd(today,back+1),s.fiscalYearStart);
  const due=past.length?past[past.length-1]:(next.length?next[0]:null);
  if(!due)return {state:'none'};
  const period=maCommitmentPeriodKey(c,due,s.fiscalYearStart);
  const paid=(docs||[]).filter(d=>d.status!=='void'&&d.commitmentId===c.id&&d.commitmentPeriod===period);
  const amountPaid=paid.reduce((t,d)=>t+(d.amount||0),0);
  let state;
  if(paid.length&&(!c.amountExpected||amountPaid>=c.amountExpected))state='paid';
  else if(paid.length)state='part';
  else if(due>today)state='upcoming';
  else if(maDaysBetween(due,today)>s.commitmentGraceDays)state='overdue';
  else state='due';
  return {state,due,period,amountPaid,expected:c.amountExpected||0,docs:paid.map(d=>d.id||d._id||d.no),
    next:next.length?next[0]:null};
}
function maCommitmentText(c){
  if(!c)return '';
  if(c.cadence==='monthly')return 'Monthly · the '+c.dueDay+_maOrd(c.dueDay);
  if(c.cadence==='weekly')return 'Weekly · '+MA_WEEKDAYS_LONG[c.dueWeekday];
  if(c.cadence==='quarterly')return 'Quarterly · the '+c.dueDay+_maOrd(c.dueDay)+' of month '+(c.dueMonth||1);
  if(c.cadence==='yearly')return 'Yearly · '+c.dueDay+' '+MA_MONTHS[(c.dueMonth||1)-1];
  return MA_CADENCE_LABELS[c.cadence]||c.cadence;
}

/* ── The calendar (§17, rule-based in M1) ───────────────────────────────── */
/* Thirty days from today, one cell a day: what is due out (the cost
   register), what is expected in (M2 fills the Tuesday/Friday CPRs; M4
   the Payfast weekdays), the pay days and CPR days marked, and the
   projected balance of the holders that can pay (cash and bank). A day the
   holders cannot fund is named. An unpaid commitment already past due
   lands on today, because that is when the money is still owed. */
function maCalendar(o){
  const s=o.settings||MA_DEFAULT_SETTINGS;
  const today=o.today,n=o.days||30;
  const to=maDayAdd(today,n-1);
  const days=[];const byDay={};
  for(let i=0;i<n;i++){const d=maDayAdd(today,i);const w=maWeekday(d);
    const cell={day:d,weekday:w,in:0,out:0,events:[],payDay:s.payDays.indexOf(w)>=0,cprDay:s.cprDays.indexOf(w)>=0};
    days.push(cell);byDay[d]=cell;}
  (o.commitments||[]).filter(c=>c&&c.active!==false).forEach(c=>{
    const st=maCommitmentStatus(c,o.docs,today,s);
    if((st.state==='due'||st.state==='overdue'||st.state==='part')&&st.due<=today){
      const left=Math.max(0,(c.amountExpected||0)-(st.amountPaid||0));
      byDay[today].events.push({dir:'out',label:c.name,amount:left,commitment:c.id,period:st.period,late:true,due:st.due});
      byDay[today].out+=left;
    }
    maCommitmentDueDays(c,maDayAdd(today,1),to,s.fiscalYearStart).forEach(d=>{
      const period=maCommitmentPeriodKey(c,d,s.fiscalYearStart);
      const paid=(o.docs||[]).filter(x=>x.status!=='void'&&x.commitmentId===c.id&&x.commitmentPeriod===period).reduce((t,x)=>t+(x.amount||0),0);
      const left=Math.max(0,(c.amountExpected||0)-paid);
      if(!left)return;
      byDay[d].events.push({dir:'out',label:c.name,amount:left,commitment:c.id,period});
      byDay[d].out+=left;
    });
  });
  (o.inflows||[]).forEach(x=>{if(byDay[x.day]){byDay[x.day].events.push(Object.assign({dir:'in'},x));byDay[x.day].in+=x.amount||0;}});
  let bal=Math.round(o.start||0);const unfunded=[];
  days.forEach(c=>{bal+=c.in-c.out;c.projected=bal;if(bal<0)unfunded.push(c.day);});
  return {start:Math.round(o.start||0),days,unfunded,out:days.reduce((t,c)=>t+c.out,0),in:days.reduce((t,c)=>t+c.in,0),end:bal};
}
/* What the calendar funds from: the cash and bank holders. */
function maSpendable(rows){
  let t=0,ok=true;
  (rows||[]).forEach(r=>{if(!r.active||(r.holderKind!=='cash'&&r.holderKind!=='bank'))return;if(r.balance===null){ok=false;return;}t+=r.balance;});
  return {total:t,complete:ok};
}

/* ── Validation (§6) ────────────────────────────────────────────────────── */
/* `ctx`: {idx, settings, parties, docs (every loaded document), lines (the
   postings WITHOUT this document's current version), closes, today,
   before (the stored version, when editing), reason}. Returns
   {ok, refuses, flags, issues}. One refusal stops the write; flags post
   and put the document in the owners' review queue. Every rule is a test. */
function maValidate(doc,ctx){
  const c=ctx||{};
  const s=c.settings||MA_DEFAULT_SETTINGS;
  const idx=c.idx;
  const today=c.today||maDay();
  const issues=[];
  const refuse=(rule,message,field)=>issues.push({rule,level:'refuse',message,field:field||null});
  const flag=(rule,message,field)=>issues.push({rule,level:'flag',message,field:field||null});
  if(!doc||!MA_DOC_TYPES[doc.dt]){refuse('doc.type','Unknown document.');return _maResult(issues);}
  const closes=c.closes||[];
  const lockedQ=q=>closes.some(x=>x&&x.quarter===q&&x.locked===true&&!x.reopenedAt);
  const softM=m=>closes.some(x=>x&&x.month===m&&x.soft===true&&!x.reopenedAt);

  // Dates
  if(!maIsDay(doc.date))refuse('date.real','Pick a real day.','date');
  else{
    if(doc.date>today)refuse('date.future','A document cannot be dated in the future.','date');
    if(doc.date<s.historyFrom)refuse('date.before_books','The books start on '+maDayLabel(s.historyFrom,true)+'.','date');
    if(lockedQ(maQuarterOf(doc.date,s.fiscalYearStart)))refuse('date.closed',maQuarterLabel(maQuarterOf(doc.date,s.fiscalYearStart),s.fiscalYearStart)+' is closed.','date');
    else if(softM(maMonthOf(doc.date)))flag('date.soft_month',maMonthLabel(maMonthOf(doc.date),true)+' is soft-closed — this changes a reviewed month.','date');
  }
  if(c.before&&maIsDay(c.before.date)&&lockedQ(maQuarterOf(c.before.date,s.fiscalYearStart)))
    refuse('edit.closed','This document sits in a closed quarter and cannot change.','date');

  const acc=code=>maAcc(idx,code);
  const holderOk=(code,field,opts)=>{
    const h=acc(code);
    if(!h||!h.money){refuse('holder.money','Name the holder the money '+((opts&&opts.dir)||'moves through')+' — a cash, bank or till account.',field);return false;}
    if(!h.active){refuse('holder.inactive',h.name+' is switched off in Settings.',field);return false;}
    if(s.mirrors&&s.mirrors[h.code]&&!(opts&&opts.allowMirror)){
      refuse('holder.mirror',h.name+' is still Raees’s book in Store Accounts (it moves here at M8) — spend and counts on it are recorded there. A handover to or from it is a Transfer.',field);return false;}
    return true;
  };
  const amountOk=(v,field,label)=>{
    if(!Number.isInteger(v)||v<=0){refuse('amount.whole',(label||'The amount')+' is whole rupees above zero.',field||'amount');return false;}
    if(v>999999999){refuse('amount.max',(label||'The amount')+' looks mistyped — above ₨99 crore.',field||'amount');return false;}
    return true;
  };
  const partyOk=()=>{
    if(doc.party){
      const p=(c.parties||[]).find(x=>x.id===doc.party);
      if(!p){refuse('party.exists','That party does not exist.','party');return null;}
      if(p.active===false){refuse('party.active',p.name+' is inactive.','party');return null;}
      return p;
    }
    return null;
  };

  // What this document would do to its holders, as of today and on the way.
  const floorCheck=(own)=>{
    if(!idx)return;
    const mine=own||maPost(Object.assign({},doc,{status:doc.status==='pending'?'posted':doc.status}),idx,s);
    const credited={};mine.forEach(l=>{const a=acc(l.account);if(a&&a.money&&l.cr>l.dr)credited[a.code]=true;});
    const pend=(c.docs||[]).filter(d=>d.dt==='transfer'&&d.status==='pending'&&d.id!==doc.id&&(!c.before||d.id!==c.before.id));
    Object.keys(credited).forEach(code=>{
      const a=acc(code);
      if(s.mirrors&&s.mirrors[code])return;
      const floor=Number.isInteger(s.holderFloor[code])?s.holderFloor[code]:0;
      const all=(c.lines||[]).concat(mine);
      const after=maBalanceOf(all,idx,code);
      const out=pend.filter(p=>p.from===code).reduce((t,p)=>t+(p.amount||0),0);
      const avail=after-out;
      if(avail<floor){
        const hard=(a.holderKind==='cash'||a.holderKind==='till'||a.holderKind==='float'||a.holderKind==='wallet')&&!doc.historical;
        const msg=a.name+' would hold '+maRs(avail)+(out?' after '+maRs(out)+' waiting to be confirmed':'')+(floor?' — below its floor of '+maRs(floor):'')+'.';
        if(hard)refuse('holder.floor',msg,'holder');else flag('holder.floor',msg,'holder');
        return;
      }
      if(maIsDay(doc.date)&&doc.date<today){
        const m=maRunningMin(all,idx,code,doc.date);
        if(m.min<floor)flag('holder.dip',a.name+' would have been '+maRs(m.min)+' on '+maDayLabel(m.day)+' — check the order, or an inflow is missing.','date');
      }
    });
  };

  if(doc.dt==='journal'){
    const k=doc.kind;const def=MA_JOURNAL_KINDS[k];
    if(!def){refuse('journal.kind','Unknown journal kind.');return _maResult(issues);}
    if(def.holder){
      const hOk=holderOk(doc.holder,'holder',{dir:k==='money_in'||k==='capital'?'arrived in':'left'});
      const aOk=amountOk(doc.amount);
      if(def.account){
        const a=acc(doc.account);
        if(!a)refuse('account.valid','Pick what this money was for.','account');
        else if(a.money)refuse('account.money','Money moving between two holders is a Transfer.','account');
        else if(!a.active)refuse('account.inactive',a.name+' is switched off.','account');
        else if(MA_UNLABELLED.indexOf(a.code)>=0)flag('unlabelled','Not named yet — it waits in the Unlabelled queue until it is.','account');
        else if(k==='money_out'&&a.type==='revenue'&&!doc.note)flag('account.side','Money out booked to an income account — a refund? Say so in the note.','account');
        else if(k==='money_in'&&(a.type==='expense'||a.type==='cogs')&&!doc.note)flag('account.side','Money in booked to a cost — a refund from a vendor? Say so in the note.','account');
      }
      if(def.payee){
        const p=partyOk();
        if(!doc.party&&!maStr(doc.payee))refuse('payee.named','Name who was paid (or who paid) — a party, or a name for a one-off.','payee');
        if(p&&p.vendor&&p.vendor.tax&&p.vendor.tax.regime&&p.vendor.tax.regime!=='none'&&doc.tax&&doc.tax.kind==='none')
          flag('tax.default',p.name+'’s usual tax is '+(MA_TAX_LABELS[p.vendor.tax.regime]||p.vendor.tax.regime).toLowerCase()+' — this says no tax.','tax');
        if(p&&p.vendor&&p.vendor.tax&&(!p.vendor.tax.regime||p.vendor.tax.regime==='none')&&doc.tax&&doc.tax.kind&&doc.tax.kind!=='none'&&doc.tax.kind!=='withholding')
          flag('tax.default',p.name+' is usually not taxed — this carries '+(MA_TAX_LABELS[doc.tax.kind]||doc.tax.kind).toLowerCase()+'.','tax');
      }
      if(def.tax)maTaxIssues(doc.tax,doc.amount).forEach(x=>issues.push(x));
      if(def.owner&&MA_OWNERS.indexOf(doc.owner)<0)refuse('owner.who','Which owner — Afnan or Ammar?','owner');
      if(def.tax&&doc.costCentre&&s.costCentres.indexOf(doc.costCentre)<0)refuse('costCentre.valid','Unknown cost centre “'+doc.costCentre+'”.','costCentre');
      if(def.tax&&doc.commitmentId&&c.commitments&&!c.commitments.some(x=>x.id===doc.commitmentId))refuse('commitment.exists','That commitment is not in the register.','commitmentId');
      // Evidence (§6: attach above a threshold; refuse above another)
      if(aOk&&(k==='money_out'||k==='money_in')&&!(doc.attachments||[]).length){
        const ev=s.evidence||{};
        if(ev.refuseAbove&&doc.amount>=ev.refuseAbove)refuse('evidence.required','Attach the bill or receipt — required at '+maRs(ev.refuseAbove)+' and above.','attachments');
        else if(ev.flagAbove&&doc.amount>=ev.flagAbove)flag('evidence.missing','No bill or receipt attached ('+maRs(doc.amount)+').','attachments');
      }
      // Duplicate (same who, amount, kind within N days)
      if(aOk&&(k==='money_out'||k==='money_in')&&maIsDay(doc.date)){
        const who=doc.party||maNorm(doc.payee);
        const dup=(c.docs||[]).find(d=>d.dt==='journal'&&d.kind===k&&d.status!=='void'&&d.id!==doc.id&&(!c.before||d.id!==c.before.id)&&
          d.amount===doc.amount&&(d.party||maNorm(d.payee))===who&&maIsDay(d.date)&&Math.abs(maDaysBetween(d.date,doc.date))<=s.duplicateDays);
        if(dup)flag('duplicate','Looks like '+(dup.no||'another entry')+' — '+maRs(dup.amount)+' on '+maDayLabel(dup.date)+'.');
      }
      if(hOk&&aOk)floorCheck();
    }else{
      // Journals with their own lines
      const lines=doc.lines||[];
      if(k==='general'&&lines.length<2)refuse('journal.lines','A journal has at least two lines.','lines');
      if(k==='opening'&&!lines.length)refuse('journal.lines','Add at least one opening line.','lines');
      let dr=0,cr=0,bad=false;
      lines.forEach((l,i)=>{
        const a=acc(l.account);
        if(!a){refuse('line.account','Line '+(i+1)+': pick an account.','lines');bad=true;return;}
        if(!a.active){refuse('line.inactive','Line '+(i+1)+': '+a.name+' is switched off.','lines');bad=true;}
        if(s.mirrors&&s.mirrors[a.code]){refuse('holder.mirror','Line '+(i+1)+': '+a.name+' is still Raees’s book in Store Accounts until M8.','lines');bad=true;}
        if(k==='opening'){
          if(!Number.isInteger(l.amount)||l.amount<=0){refuse('line.amount','Line '+(i+1)+': whole rupees above zero.','lines');bad=true;return;}
          if(l.side==='cr')cr+=l.amount;else dr+=l.amount;
          if(a.code==='3090')flag('opening.self','Line '+(i+1)+': 3090 balances the opening by itself — no need to name it.','lines');
        }else{
          const d=l.dr||0,x=l.cr||0;
          if(!Number.isInteger(d)||!Number.isInteger(x)||d<0||x<0||(d>0)===(x>0)){refuse('line.side','Line '+(i+1)+': a debit OR a credit, whole rupees.','lines');bad=true;return;}
          dr+=d;cr+=x;
          if(MA_UNLABELLED.indexOf(a.code)>=0&&!l.memo)flag('unlabelled','Line '+(i+1)+' goes to '+a.name+' — say what it is so it can be named later.','lines');
        }
        if(l.party&&!(c.parties||[]).some(p=>p.id===l.party)){refuse('line.party','Line '+(i+1)+': that party does not exist.','lines');bad=true;}
      });
      if(k==='general'&&!bad&&dr!==cr)refuse('journal.balanced','Debits '+maRs(dr)+' and credits '+maRs(cr)+' must be equal.','lines');
      if(k==='opening'&&maIsDay(doc.date)&&doc.date!==s.historyFrom)flag('opening.date','Openings are usually dated '+maDayLabel(s.historyFrom,true)+', the day the books start.','date');
      if(!bad&&idx)floorCheck();
    }
  }else if(doc.dt==='transfer'){
    const fOk=holderOk(doc.from,'from',{dir:'left',allowMirror:true});
    const tOk=holderOk(doc.to,'to',{dir:'arrived in',allowMirror:true});
    if(fOk&&tOk&&doc.from===doc.to)refuse('transfer.same','A transfer moves money between two different holders.','to');
    const mirrorBoth=s.mirrors&&s.mirrors[doc.from]&&s.mirrors[doc.to];
    if(mirrorBoth)refuse('transfer.mirror','Both sides are still in Store Accounts — record it there.','to');
    const aOk=amountOk(doc.amount);
    if(fOk&&tOk&&aOk&&doc.from!==doc.to)floorCheck();
    if(aOk&&!(doc.attachments||[]).length&&(s.evidence||{}).flagAbove&&doc.amount>=100000&&!doc.note)
      flag('transfer.note','A large handover with no note or receipt — say what it was for.','note');
  }else if(doc.dt==='count'){
    if(holderOk(doc.holder,'holder',{dir:'is counted in'})){
      if(!Number.isInteger(doc.counted)||doc.counted<0)refuse('count.value','The count is whole rupees, zero or more.','counted');
      else if(doc.difference){
        if(!maStr(doc.note))refuse('count.reason','The count differs from the book by '+maRs(doc.difference)+' — say why (or “not known yet”).','note');
        flag('count.difference','Counted '+maRs(Math.abs(doc.difference))+' '+(doc.difference<0?'less':'more')+' than the book — it waits in 9030 until explained.','counted');
        if(doc.difference<0)floorCheck();
      }
    }
  }
  // Editing: a reason, and identity never changes (§31, §6)
  if(c.before){
    if(!maStr(c.reason))refuse('edit.reason','Say why this is being changed.','reason');
    if(c.before.dt!==doc.dt||(c.before.kind||null)!==(doc.kind||null))refuse('edit.type','A document cannot change its kind — void it and record the right one.');
    if((c.before.party||null)!==(doc.party||null))refuse('edit.party','A document cannot change its party — void it and record it against the right one.','party');
    if(c.before.status==='void')refuse('edit.void','A void document cannot be edited.');
    // The receiver decides who confirms (confirmBy, confirmPaper), and the
    // rules pin confirmBy on an edit — so changing it would leave a
    // confirmation owed by one person on money handed to another.
    if(c.before.dt==='transfer'&&(c.before.to||null)!==(doc.to||null))refuse('edit.receiver','A transfer cannot change who received it — void it and record the right one.','to');
  }
  return _maResult(issues);
}
function _maResult(issues){
  const refuses=issues.filter(x=>x.level==='refuse'),flags=issues.filter(x=>x.level==='flag');
  return {ok:!refuses.length,refuses,flags,issues};
}
function maVoidIssues(doc,reason,ctx){
  const c=ctx||{};const s=c.settings||MA_DEFAULT_SETTINGS;
  const out=[];
  if(!doc)return [{rule:'void.missing',level:'refuse',message:'Nothing to void.'}];
  if(doc.status==='void')out.push({rule:'void.again',level:'refuse',message:'Already void.'});
  if(!maStr(reason))out.push({rule:'void.reason',level:'refuse',field:'reason',message:'Say why it is being voided.'});
  const closes=c.closes||[];
  if(maIsDay(doc.date)&&closes.some(x=>x&&x.quarter===maQuarterOf(doc.date,s.fiscalYearStart)&&x.locked===true&&!x.reopenedAt))
    out.push({rule:'void.closed',level:'refuse',message:'It sits in a closed quarter.'});
  if(doc.dt==='count'&&(c.docs||[]).some(d=>d.dt==='count'&&d.holder===doc.holder&&d.status!=='void'&&d.id!==doc.id&&(d.date>doc.date||(d.date===doc.date&&(d.ts||0)>(doc.ts||0)))))
    out.push({rule:'void.count_later',level:'flag',message:'A later count of this holder was taken against a book that included this one.'});
  return out;
}

/* ── Edits and voids (§31) ─────────────────────────────────────────────── */
/* A value's JSON with every object's keys sorted, so two copies of one value
   compare equal whatever order their keys arrived in. firestore.rules decide
   what an edit changed by VALUE (diff().affectedKeys()) and refuse an edit
   row that names a field that did not change (k.hasAll(fields)); a diff by
   plain JSON.stringify would name an unchanged map — a tax block, a file —
   whenever a read hands its keys back in another order. The emulator was
   seen to keep insertion order (28 Sept 2026); production was not checked,
   so the diff no longer depends on it. */
function _maCanon(v){
  if(Array.isArray(v))return '['+v.map(_maCanon).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+_maCanon(v[k])).join(',')+'}';
  return JSON.stringify(v===undefined?null:v);
}
function maEditDiff(before,after){
  const fields=MA_EDIT_FIELDS[before&&before.dt]||[];
  const d={fields:[],before:{},after:{}};
  fields.forEach(f=>{
    const a=_maCanon(before[f]===undefined?null:before[f]),b=_maCanon(after[f]===undefined?null:after[f]);
    if(a!==b){d.fields.push(f);d.before[f]=before[f]===undefined?null:maClone(before[f]);d.after[f]=after[f]===undefined?null:maClone(after[f]);}
  });
  return d;
}
/* The edited document: the rebuilt fields, the same identity, one more
   row in its history. null when nothing changed. */
function maApplyEdit(before,after,meta){
  const d=maEditDiff(before,after);
  if(!d.fields.length)return null;
  const m=meta||{};
  const out=Object.assign({},after,{
    id:before.id,no:before.no,dt:before.dt,kind:before.kind,party:before.party===undefined?after.party:before.party,
    by:before.by,byName:before.byName,ts:before.ts,source:before.source,
    status:before.status==='pending'&&after.status==='posted'?'pending'
      // a transfer nobody had to confirm cannot start waiting on a confirmBy the edit may not set
      :before.dt==='transfer'&&after.status==='pending'&&!before.confirmBy?(before.status||'posted')
      :(after.status||before.status),
    confirmBy:before.confirmBy===undefined?after.confirmBy:before.confirmBy,
    confirmPaper:before.confirmPaper===undefined?after.confirmPaper:before.confirmPaper,
    rev:(before.rev||1)+1,
    edits:(before.edits||[]).concat([{at:m.at||0,by:m.by||null,byName:m.byName||null,reason:maStr(m.reason,500),fields:d.fields,before:d.before,after:d.after}])
  });
  ['confirmedBy','confirmedAt','confirmedFor','confirmVia','confirmPaper'].forEach(k=>{if(before[k]!==undefined&&out[k]===undefined)out[k]=before[k];});
  return out;
}
function maApplyVoid(doc,meta){
  const m=meta||{};
  return Object.assign({},doc,{status:'void',voidedAt:m.at||0,voidedBy:m.by||null,voidedByName:m.byName||null,voidReason:maStr(m.reason,500)});
}
/* The receiver says the money arrived. On paper = an owner confirms for a
   person who cannot sign in to the books (Raees, Umair) with a signed
   receipt; in the app = the named person themself. */
function maConfirmPatch(doc,who,meta){
  const m=meta||{};
  if(!doc||doc.status!=='pending')return {error:'Only a pending transfer is confirmed.'};
  if(who===doc.confirmBy)return {patch:{status:'posted',confirmedBy:who,confirmedAt:m.at||0,confirmVia:'app'}};
  if(doc.confirmPaper&&MA_OWNERS.indexOf(who)>=0)return {patch:{status:'posted',confirmedBy:who,confirmedAt:m.at||0,confirmedFor:doc.confirmBy,confirmVia:'paper'}};
  return {error:'Only '+(doc.confirmBy||'the receiver')+' can confirm this.'};
}

/* ── The Unlabelled queue and the review queue (§27, §14) ───────────────── */
/* Anything booked to suspense, or flagged, waits here. The Unlabelled queue
   must be empty before a month is soft-closed and a quarter locked. */
function maUnlabelled(docs,idx,settings){
  const s=settings||MA_DEFAULT_SETTINGS;
  const out=[];
  (docs||[]).forEach(d=>{
    if(d.status==='void')return;
    const lines=maPost(Object.assign({},d,{status:'posted'}),idx,s);
    const hit=lines.filter(l=>MA_UNLABELLED.indexOf(l.account)>=0);
    if(hit.length)out.push({doc:d,amount:hit.reduce((t,l)=>t+l.dr+l.cr,0),why:'booked to '+hit.map(l=>maAccLabel(idx,l.account)).join(', ')});
  });
  return out;
}
/* The flags a document still stands by. Flags are stored when it is
   recorded, and the rules pin them (an edit may not change `flags`). The two
   that ask for evidence are answered by the document itself: attach the
   bill and "no bill attached" is no longer true, so it leaves the queue
   without anybody clearing it — and if the file is removed again, the flag
   is back. Nothing is rewritten; this only reads. Every other flag is a
   judgement about the world and waits for an owner's review. */
const _maAnswered={
  'evidence.missing':d=>maAttachList(d.attachments).length>0,
  'transfer.note':d=>maAttachList(d.attachments).length>0||!!maStr(d.note)
};
function maLiveFlags(d){
  return (d&&Array.isArray(d.flags)?d.flags:[]).filter(f=>!(f&&_maAnswered[f.rule]&&_maAnswered[f.rule](d)));
}
function maAnsweredFlags(d){
  return (d&&Array.isArray(d.flags)?d.flags:[]).filter(f=>f&&_maAnswered[f.rule]&&_maAnswered[f.rule](d));
}
function maReviewQueue(docs){
  return (docs||[]).filter(d=>d.status!=='void'&&maLiveFlags(d).length&&!d.reviewedAt);
}

/* ── Backups (§30) — what a row of ma_backups says ───────────────────────
   netlify/functions/ma-backup.js writes one row a day, and a `state`:
   not_configured · starting · running · done · failed. A row with no state
   (written by hand, or before there was one) is read from `ok` — true is
   done, false is failed, or not set up when `configured` is false — and a
   row with neither is 'unknown': never "done" just because it is not
   "failed". */
const MA_BACKUP_STATES=['not_configured','starting','running','done','failed'];
function maBackupState(r){
  if(!r||typeof r!=='object')return 'none';
  if(MA_BACKUP_STATES.indexOf(r.state)>=0)return r.state;
  if(r.ok===true)return 'done';
  if(r.ok===false)return r.configured===false?'not_configured':'failed';
  return 'unknown';
}
/* What a not-set-up run is missing, in words: the reason the function
   recorded (its error after "Backups are not set up yet — "), else the
   settings it named, else the bucket. No full stop — the caller adds one. */
function maBackupMissing(r){
  const e=String((r&&r.error)||'').trim().replace(/^Backups are not set up yet\s*[—–-]\s*/i,'').replace(/[\s.]+$/,'');
  if(e)return e;
  const m=(Array.isArray(r&&r.missing)?r.missing:[]).filter(x=>typeof x==='string'&&x);
  if(m.length)return m.join(' and ')+' '+(m.length>1?'are':'is')+' not set in Netlify';
  return 'the backup bucket is not set in Netlify';
}

/* ── Needs attention (§16.1 Today; §17's rule half) ─────────────────────── */
/* Sentences with the number in them, worst first: concern, then watch.
   Fine is silent. Each carries its basis and one action. */
function maNeedsAttention(o){
  const s=o.settings||MA_DEFAULT_SETTINGS;
  const today=o.today;
  const out=[];
  const add=(state,sentence,basis,action,weight)=>out.push({state,sentence,basis,action:action||null,weight:weight||0});
  // A holder below zero or its floor
  (o.holders||[]).forEach(h=>{
    if(!h.active||h.balance===null||h.mirror)return;
    if(h.balance<(h.floor||0))add('concern',h.name+' is at '+maRs(h.balance)+(h.floor?', below its floor of '+maRs(h.floor):'')+'.','The holder’s ledger balance today.',{label:'Open',go:'holder',ref:h.code},Math.abs(h.balance)+1e9);
  });
  // A mirrored holder that could not be read
  (o.holders||[]).forEach(h=>{
    if(h.active&&h.mirror&&!h.mirrorOk)add('watch','The drawer’s balance could not be read from Store Accounts — cash in hand leaves it out.','A refused or failed read is never shown as zero.',{label:'Retry',go:'reload'},5e8);
  });
  // An unfunded day
  if(o.calendar&&o.calendar.unfunded&&o.calendar.unfunded.length){
    const d=o.calendar.unfunded[0];const cell=o.calendar.days.find(x=>x.day===d);
    add('concern','On '+maDayLabel(d)+' the cash and bank holders run '+maRs(cell?cell.projected:0)+' short of what falls due.','Cash and bank today, less the cost register’s dues day by day.',{label:'See the days',go:'calendar'},1e9);
  }
  // Commitments overdue and due
  (o.commitments||[]).forEach(c=>{
    if(c.active===false)return;
    const st=maCommitmentStatus(c,o.docs,today,s);
    const left=Math.max(0,(c.amountExpected||0)-(st.amountPaid||0));
    if(st.state==='overdue')add('concern',c.name+' — nothing recorded for '+(st.period.length===7?maMonthLabel(st.period):st.period)+'; '+(left?maRs(left)+' ':'')+'was due '+maDayLabel(st.due)+'.','The cost register: due on '+maCommitmentText(c).toLowerCase()+', with '+s.commitmentGraceDays+' days’ grace.',{label:'Record it',go:'pay_commitment',ref:c.id,period:st.period},left+5e8);
    else if(st.state==='due'||st.state==='part')add('watch',c.name+' is due '+(st.due===today?'today':maDayLabel(st.due))+(left?' — '+maRs(left)+(st.state==='part'?' still to pay':''):'')+'.','The cost register.',{label:'Record it',go:'pay_commitment',ref:c.id,period:st.period},left);
  });
  // Transfers waiting to be confirmed
  (o.docs||[]).filter(d=>d.dt==='transfer'&&d.status==='pending').forEach(d=>{
    const age=maIsDay(d.date)?maDaysBetween(d.date,today):0;
    if(age>=s.pendingWatchDays)add('watch',maRs(d.amount)+' handed to '+(d.confirmBy?d.confirmBy.charAt(0).toUpperCase()+d.confirmBy.slice(1):'the receiver')+' on '+maDayLabel(d.date)+' is waiting to be confirmed.','Pending never counts: it is in neither holder until confirmed.',{label:'Confirm',go:'doc',ref:d.id,dt:'transfer'},d.amount);
  });
  // Cash holders nobody has counted lately
  const stale=(o.holders||[]).filter(h=>h.active&&!h.mirror&&h.holderKind==='cash'&&h.balance&&(!h.lastCount||maDaysBetween(h.lastCount.date,today)>s.countEveryDays));
  if(stale.length)add('watch',stale.map((h,i)=>{const n=h.name.replace(/^Cash — /,'');return i?n:n.charAt(0).toUpperCase()+n.slice(1);}).join(' and ')+(stale.length>1?' have':' has')+' not been counted in '+s.countEveryDays+' days.','Company cash in a person’s hands is reconciled by a count (§23 #7).',{label:'Count',go:'count',ref:stale[0].code},0);
  // Unlabelled and flagged
  if(o.unlabelled&&o.unlabelled.length)add('watch',o.unlabelled.length+' entr'+(o.unlabelled.length>1?'ies are':'y is')+' not named yet — '+maRs(o.unlabelled.reduce((t,u)=>t+u.amount,0))+' in the Unlabelled queue.','Suspense must be empty before a close.',{label:'Name them',go:'unlabelled'},0);
  if(o.review&&o.review.length)add('watch',o.review.length+' entr'+(o.review.length>1?'ies were':'y was')+' flagged and '+(o.review.length>1?'wait':'waits')+' for review.','The validation engine’s flags post, and wait for an owner.',{label:'Review',go:'review'},0);
  // 9030 not explained
  if(o.recon&&o.recon!==0)add('watch','Reconciliation differences stand at '+maRs(o.recon)+' — explain them before the quarter closes.','Account 9030.',{label:'Open',go:'account',ref:'9030'},Math.abs(o.recon));
  // Backups (§30). The latest row by `at`, read by its STATE: not set up
  // is not a failure (it is a concern all the same — no backup is a real
  // risk); a run still going raises nothing and is never read as done; a
  // "running" row older than the watch window is not running, it is stuck
  // (the hourly function would have marked it failed — so it has stopped
  // waking), and that is said.
  if(o.backup!==undefined){
    const b=o.backup,st=maBackupState(b);
    const age=b&&Number.isFinite(o.nowMs)&&Number.isFinite(b.at)?o.nowMs-b.at:null;
    const over=age!==null&&age>s.backupWatchHours*3600000;
    const ago=ms=>{const days=Math.floor(ms/86400000);return days>=1?days+' day'+(days>1?'s':''):Math.round(ms/3600000)+' hours';};
    if(st==='none')add('watch','No nightly backup has run yet — the bucket and point-in-time recovery need switching on.','ma_backups has no run.',{label:'How',go:'backups'},0);
    else if(st==='not_configured')add('concern','Backups are not set up yet — '+maBackupMissing(b)+'.','ma_backups, the latest run: the nightly backup had nowhere to write.',{label:'Open',go:'backups'},9e8);
    else if(st==='failed')add('concern','Last night’s backup failed: '+String(b.error||'no reason given').slice(0,120)+'.','ma_backups, the latest run.',{label:'Open',go:'backups'},9e8);
    else if(st==='done'){if(over)add('concern','The last backup ran '+ago(age)+' ago.','ma_backups, the latest run.',{label:'Open',go:'backups'},9e8);}
    else if(over)add('concern','The backup that started '+ago(age)+' ago has not finished.','ma_backups, the latest run: still '+(st==='unknown'?'without a result':st)+' after '+s.backupWatchHours+' hours.',{label:'Open',go:'backups'},9e8);
  }
  out.sort((a,b)=>(a.state===b.state?0:a.state==='concern'?-1:1)||b.weight-a.weight);
  return out;
}

/* ── Allocation (§7) — FIFO, for M3's payments ──────────────────────────── */
function maAllocateFifo(amount,items){
  let left=Math.round(amount||0);
  const open=(items||[]).filter(x=>(x.outstanding||0)>0).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
  const allocations=[];
  for(const it of open){
    if(left<=0)break;
    const a=Math.min(left,Math.round(it.outstanding));
    allocations.push({id:it.id,amount:a});left-=a;
  }
  return {allocations,remainder:left};
}

/* ── Words ──────────────────────────────────────────────────────────────── */
function maDocTitle(doc,idx){
  if(!doc)return '';
  if(doc.dt==='journal'){const k=MA_JOURNAL_KINDS[doc.kind];return k?k.label:'Journal';}
  if(doc.dt==='transfer')return 'Transfer'+(idx?' '+(maAcc(idx,doc.from)||{name:doc.from}).name.replace(/^Cash — /,'')+' → '+(maAcc(idx,doc.to)||{name:doc.to}).name.replace(/^Cash — /,''):'');
  if(doc.dt==='count')return 'Count'+(idx?' · '+(maAcc(idx,doc.holder)||{name:doc.holder}).name:'');
  return doc.dt;
}
function maDocText(doc,idx,partyName){
  return maNorm([doc.no,maDocTitle(doc,idx),partyName,doc.payee,doc.note,doc.date,
    doc.account&&maAccLabel(idx,doc.account),doc.holder&&maAccLabel(idx,doc.holder),
    doc.from&&maAccLabel(idx,doc.from),doc.to&&maAccLabel(idx,doc.to),(doc.tags||[]).join(' ')].join(' '));
}

/* ── The audit trail (§29) — one row per thing that happened ────────────── */
const MA_AUDIT_ACTIONS=['post','edit','void','confirm','review','party','terms','rate','item','commitment','settings','chart','export','share','revoke','enter','relock','attach','download','backup'];
function maAuditRow(action,target,meta){
  const m=meta||{};
  return {action:MA_AUDIT_ACTIONS.indexOf(action)>=0?action:'post',
    target:target?{dt:target.dt||null,id:target.id||null,no:target.no||null}:null,
    detail:maStr(m.detail,300),by:m.by||null,byName:m.byName||null,at:m.at||0};
}

/* ── The PDFs (§31, M1.4) — what each one prints is decided HERE ──────────
   js/print-engine.js draws what these return and never adds, nets or
   balances anything: every figure on a PDF is computed below from the same
   postings the pages read (maPostAll → maLedger), so the paper and the
   screen cannot disagree. Void and pending documents post nothing (maPost),
   so they never reach a ledger or a statement; the receipt and the voucher
   of a void document say VOID instead.
   `x` = {idx, settings, lines, docs, parties, commitments, holders?,
          people? ({username: display name}), printedOn, printedBy}.
   Days stay 'YYYY-MM-DD', amounts whole rupees, `at` stamps milliseconds —
   the engine formats all three, so nothing here reads a clock or a zone. */
function _maPdfPerson(x,u){
  if(!u)return '';
  const p=x&&x.people;
  return p&&p[u]?String(p[u]):String(u).charAt(0).toUpperCase()+String(u).slice(1);
}
function _maPdfParty(x,id){return ((x&&x.parties)||[]).find(p=>p&&p.id===id)||null;}
function _maPdfAccName(x,code){const a=maAcc(x.idx,code);return a?a.name:String(code||'');}
function _maPdfIndex(x){
  const docs={},lines={};
  (x.docs||[]).forEach(d=>{const id=d&&(d.id||d._id);if(id)docs[id]=d;});
  (x.lines||[]).forEach(l=>{const id=l.doc&&l.doc.id;if(id)(lines[id]=lines[id]||[]).push(l);});
  return {docs,lines};
}
/* Who a posting was with: the party, the payee, the owner — or, for a
   handover, the holder on the other side. */
function _maPdfWho(x,l,d){
  if(l.party){const p=_maPdfParty(x,l.party);return p?p.name:'Unknown party';}
  if(l.payee)return l.payee;
  if(!d)return '';
  if(d.dt==='transfer')return _maPdfAccName(x,l.account===d.to?d.from:d.to);
  if(d.dt==='journal'&&(d.kind==='capital'||d.kind==='drawing'))return l.account===d.holder?_maPdfPerson(x,d.owner):_maPdfAccName(x,d.holder);
  if(d.dt==='count'&&l.account!==d.holder)return _maPdfAccName(x,d.holder);
  return '';
}
/* The ledger's particulars, in two parts: `contra` — the accounts on the
   other side of the same document — and `note` — the line's memo and the
   document's note. A handover's other side is already its "who", so a
   transfer has no contra. */
function _maPdfContra(x,l,d,docLines){
  if(d&&d.dt==='transfer')return '';
  return Array.from(new Set((docLines||[]).filter(o=>l.dr>0?o.cr>0:o.dr>0).map(o=>maAccLabel(x.idx,o.account)))).join(', ');
}
function _maPdfRow(x,ix,l){
  const id=l.doc&&l.doc.id;
  const d=ix.docs[id]||null;
  return {date:l.date,no:(l.doc&&l.doc.no)||'',kind:d?maDocTitle(d):'',who:_maPdfWho(x,l,d),
    contra:_maPdfContra(x,l,d,ix.lines[id]),note:[l.memo,d&&d.note].filter(Boolean).join(' — ')};
}
/* "Revised · rev N" — N is maRevOf, the number the rail shows (a document
   never edited prints no mark) — VOID with its reason, who recorded it. */
function _maPdfMarks(x,d){
  const edits=Array.isArray(d.edits)?d.edits:[];
  const last=edits.length?edits[edits.length-1]:null;
  return {
    revised:edits.length?{n:maRevOf(d),at:(last&&last.at)||null,by:last?(last.byName||_maPdfPerson(x,last.by)):'',reason:(last&&last.reason)||''}:null,
    void:d.status==='void'?{reason:d.voidReason||'',by:d.voidedByName||_maPdfPerson(x,d.voidedBy),at:d.voidedAt||null}:null,
    recorded:{by:d.byName||_maPdfPerson(x,d.by),at:d.ts||null}
  };
}
function _maPdfSide(x,code){
  const a=maAcc(x.idx,code);
  return {code:String(code||''),name:a?a.name:String(code||''),person:a&&a.person?_maPdfPerson(x,a.person):''};
}
/* ma-ledger — ONE account (a holder or any account) for a range, with the
   page's own filters: the exact maLedger call the Ledger page paints.
   `filter` = the maLedger filter plus `label` (the range's name). null when
   no single account is chosen — a ledger PDF is one account's statement. */
function maPdfLedgerData(x,filter){
  const f=filter||{};
  const code=f.holder||f.account;
  if(!code)return null;
  const q={};Object.keys(f).forEach(k=>{if(k!=='label')q[k]=f[k];});
  const led=maLedger(x.lines,q,x.idx);
  const a=maAcc(x.idx,code);
  const ix=_maPdfIndex(x);
  const filters=[];
  if(f.party){const p=_maPdfParty(x,f.party);filters.push('Party: '+(p?p.name:'Unknown party'));}
  if(f.dt)filters.push('Documents: '+(MA_DOC_TYPES[f.dt]?MA_DOC_TYPES[f.dt].label+'s':String(f.dt)));
  ['category','spendGroup','costCentre','source','kind'].forEach(k=>{if(f[k])filters.push(k.replace(/[A-Z]/g,c=>' '+c.toLowerCase()).replace(/^./,c=>c.toUpperCase())+': '+f[k]);});
  if(f.q)filters.push('Search: “'+maStr(f.q,60)+'”');
  return {account:{code:String(code),name:a?a.name:String(code),type:a?a.type:'',normal:a?a.normal:'dr',holder:!!(a&&a.money)},
    range:{from:f.from||'',to:f.to||'',label:f.label||''},filters,
    opening:led.opening,closing:led.closing,totals:{dr:led.dr,cr:led.cr,count:led.count},
    rows:led.rows.map(l=>Object.assign(_maPdfRow(x,ix,l),{dr:l.dr,cr:l.cr,balance:l.balance})),
    printedOn:x.printedOn||'',printedBy:x.printedBy||''};
}
/* ma-statement-holder — one holder for a range: every movement with its
   running balance (the Money page's statement), the handovers that needed a
   confirmation (every one still waiting, whatever its date, and those
   confirmed in the range) and the last count. A holder mirrored from Store
   Accounts (the drawer) prints its handovers only: its balance is that
   module's, read or not — never a running balance invented from zero. */
function maPdfHolderStatementData(x,code,range){
  const a=maAcc(x.idx,code);
  if(!a||!a.money)return null;
  const r=range||{};
  code=String(code);
  const h=(x.holders||maHolderRows(x.idx,x.lines,x.docs,{settings:x.settings})).find(y=>y.code===code)||null;
  const mirror=!!(h?h.mirror:(x.settings&&x.settings.mirrors&&x.settings.mirrors[code]));
  const led=maLedger(x.lines,{holder:code,from:r.from,to:r.to},x.idx);
  const ix=_maPdfIndex(x);
  const conf=(x.docs||[]).filter(d=>d&&d.dt==='transfer'&&(d.from===code||d.to===code)&&
      (d.status==='pending'||(d.status!=='void'&&d.confirmedBy&&(!r.from||d.date>=r.from)&&(!r.to||d.date<=r.to))))
    .sort((p,q)=>String(p.date).localeCompare(String(q.date))||String(p.no||'').localeCompare(String(q.no||'')))
    .map(d=>({date:d.date,no:d.no||'',direction:d.to===code?'in':'out',other:_maPdfAccName(x,d.to===code?d.from:d.to),amount:d.amount,
      state:d.status==='pending'?'waiting':'confirmed',
      by:_maPdfPerson(x,d.status==='pending'?d.confirmBy:d.confirmedBy),
      forWho:d.confirmedFor?_maPdfPerson(x,d.confirmedFor):'',at:d.status==='pending'?null:(d.confirmedAt||null),
      via:d.confirmVia||null,paper:!!d.confirmPaper}));
  return {holder:{code,name:a.name,person:a.person?_maPdfPerson(x,a.person):'',kind:a.holderKind||'',mirror},
    range:{from:r.from||'',to:r.to||'',label:r.label||''},
    opening:mirror?null:led.opening,closing:mirror?null:led.closing,
    mirrorBalance:mirror?(h&&Number.isInteger(h.balance)?h.balance:null):null,
    totals:{in:led.dr,out:led.cr,count:led.count},
    rows:led.rows.map(l=>Object.assign(_maPdfRow(x,ix,l),{in:l.dr,out:l.cr,balance:mirror?null:l.balance})),
    waiting:{in:h?h.pendingIn:0,out:h?h.pendingOut:0},confirmations:conf,
    lastCount:h&&h.lastCount?{date:h.lastCount.date,no:h.lastCount.no||'',counted:h.lastCount.counted,difference:h.lastCount.difference}:null,
    printedOn:x.printedOn||'',printedBy:x.printedBy||''};
}
/* ma-statement-party — the party's account with us (§7 "party ledger":
   every posting on a control account — payables, receivables, advances,
   deposits — that names them), with an opening, a running balance and a
   closing; balance > 0 is a CREDIT (Groovy owes them), < 0 a DEBIT (they
   owe Groovy). Then, apart, the money paid to or received from them on the
   spot — documents that touched our holders and never their account — so a
   cash purchase is on their statement without pretending to move what is
   owed. Aging needs bills (M3) and is not computed, so it is not printed. */
function maPdfPartyStatementData(x,partyId,range){
  const p=_maPdfParty(x,partyId);
  if(!p)return null;
  const r=range||{};
  const control=code=>{const a=maAcc(x.idx,code);return !!(a&&a.control);};
  const theirs=(x.lines||[]).filter(l=>l.party===p.id);
  const onAccount=theirs.filter(l=>control(l.account));
  const led=maLedger(onAccount,{party:p.id,from:r.from,to:r.to},x.idx);
  let opening=0;
  if(r.from)onAccount.forEach(l=>{if(l.date<r.from)opening+=l.cr-l.dr;});
  let run=opening;
  const ix=_maPdfIndex(x);
  const rows=led.rows.map(l=>{run+=l.cr-l.dr;return Object.assign(_maPdfRow(x,ix,l),{account:maAccLabel(x.idx,l.account),dr:l.dr,cr:l.cr,balance:run});});
  const touched=new Set(onAccount.map(l=>l.doc&&l.doc.id));
  const direct=maLedger(theirs.filter(l=>l.holder&&l.account===l.holder&&!touched.has(l.doc&&l.doc.id)),{from:r.from,to:r.to},x.idx);
  const v=p.vendor||null;
  return {party:{id:p.id,name:p.name||'',code:p.code||'',kind:MA_PARTY_KIND_LABELS[p.kind]||p.kind||'',
      terms:v&&v.terms?maTermsText(v.terms):'',phone:(p.contact&&p.contact.phone)||'',person:(p.contact&&p.contact.person)||''},
    range:{from:r.from||'',to:r.to||'',label:r.label||''},
    opening,closing:run,totals:{dr:led.dr,cr:led.cr,count:led.count},rows,
    direct:{paid:direct.cr,received:direct.dr,count:direct.count,
      rows:direct.rows.map(l=>Object.assign(_maPdfRow(x,ix,l),{holder:_maPdfAccName(x,l.account),paid:l.cr,received:l.dr}))},
    printedOn:x.printedOn||'',printedBy:x.printedBy||''};
}
/* ma-receipt — a TRANSFER's handover slip, signed by who gave and who got.
   state: pending (counts in neither holder yet) · confirmed · posted
   (nobody else had to confirm) · void. */
function maPdfReceiptData(x,d){
  if(!d||d.dt!=='transfer')return null;
  const state=d.status==='void'?'void':d.status==='pending'?'pending':d.confirmedBy?'confirmed':'posted';
  return Object.assign({no:d.no||'',date:d.date||'',amount:d.amount,amountWords:maRsWords(d.amount),
    from:_maPdfSide(x,d.from),to:_maPdfSide(x,d.to),note:d.note||'',state,
    waitingFor:d.status==='pending'?_maPdfPerson(x,d.confirmBy):'',paper:!!d.confirmPaper,
    confirm:d.confirmedBy?{by:_maPdfPerson(x,d.confirmedBy),at:d.confirmedAt||null,via:d.confirmVia||'app',forWho:d.confirmedFor?_maPdfPerson(x,d.confirmedFor):''}:null,
    printedOn:x.printedOn||'',printedBy:x.printedBy||''},_maPdfMarks(x,d));
}
/* ma-voucher — a MONEY OUT journal's payment voucher. `paid` is the cash
   that left the holder (maTaxCompute: less withholding, plus tax on top),
   and its words are of that figure. `tax` is null for "No tax" — the
   voucher prints the block only when there is a tax to show. */
function maPdfVoucherData(x,d){
  if(!d||d.dt!=='journal'||d.kind!=='money_out')return null;
  const t=maTaxCompute(d.amount,d.tax);
  const p=d.party?_maPdfParty(x,d.party):null;
  const a=maAcc(x.idx,d.account);
  const cm=d.commitmentId?((x.commitments||[]).find(c=>c&&c.id===d.commitmentId)||null):null;
  return Object.assign({no:d.no||'',date:d.date||'',
    paidTo:{name:p?(p.name||''):(d.payee||''),code:(p&&p.code)||'',party:!!p},
    from:_maPdfSide(x,d.holder),account:{code:String(d.account||''),name:a?a.name:String(d.account||'')},
    amount:d.amount,
    tax:t.kind==='none'?null:{kind:t.kind,label:MA_TAX_LABELS[t.kind]||t.kind,rate:t.rate,inclusive:t.inclusive,claimable:t.claimable,amount:t.amount,net:t.net,gross:t.gross},
    paid:t.cash,paidWords:maRsWords(t.cash),
    note:d.note||'',costCentre:d.costCentre||'',
    commitment:d.commitmentId?{name:cm?(cm.name||''):'',period:d.commitmentPeriod||''}:null,
    printedOn:x.printedOn||'',printedBy:x.printedBy||''},_maPdfMarks(x,d));
}

/* ── Send by link (§31) ─────────────────────────────────────────────────── */
/* A phone number as wa.me wants it: digits only, the country code first, no
   + and no leading zero. A Pakistani number is written many ways —
   0300 1234567, 0300-1234567, +92 300 1234567, 0092 300 1234567,
   3001234567 — and every one becomes 923001234567. A number that cannot be
   read with confidence gives '': the link then opens WhatsApp with the
   message and lets the person choose who, rather than send it to a stranger. */
function maWaPhone(raw){
  const d=String(raw===undefined||raw===null?'':raw).trim().replace(/[\s\-().\/]/g,'');
  let out='';
  if(/^\+\d+$/.test(d))out=d.slice(1);
  else if(/^00\d+$/.test(d))out=d.slice(2);
  else if(/^92\d{10}$/.test(d))out=d;
  else if(/^0\d{9,10}$/.test(d))out='92'+d.slice(1);
  else if(/^3\d{9}$/.test(d))out='92'+d;
  else return '';
  if(/^920\d{9,10}$/.test(out))out='92'+out.slice(3);   // +92 0300… — the trunk zero written as well
  return /^[1-9]\d{7,14}$/.test(out)?out:'';
}
/* The WhatsApp link: to that number when there is one, else to nobody yet.
   The message is always URI-encoded — it carries a link with its own ? and
   &, and a name somebody typed. */
function maWaLink(phone,text){
  return 'https://wa.me/'+maWaPhone(phone)+'?text='+encodeURIComponent(String(text===undefined||text===null?'':text));
}
/* A share link's state, in the order the ma-share function answers:
   withdrawn says so even when it has also expired; a record the function
   would not serve is 'unknown', never "live". */
function maShareState(sh,nowMs){
  if(!sh||typeof sh!=='object')return 'unknown';
  if(sh.revoked===true)return 'revoked';
  if(sh.revoked!==false||!Number.isFinite(sh.expiresAt))return 'unknown';
  return Number.isFinite(nowMs)&&nowMs>=sh.expiresAt?'expired':'live';
}

/* ── Download the books (§30, layer 3) — the owners' own copy ─────────────
   What the files hold is decided here; the page reads the collections and
   hands them over. `cols` = {collection: [{id, data}]} for every collection
   that WAS read; `failed` = [{col, message}] for every one that was not —
   named in the file itself, never dropped, never an empty list standing in
   for a collection nobody could read. The JSON is the copy a restore reads
   (the plan's ma-import, idempotent by document id, so each document keeps
   its id apart from its fields); the workbook is the same copy for a person:
   the postings and the trial balance derived from it, then every collection
   as a sheet. Every ma_* collection the rules let an owner read. */
const MA_BOOK_COLS=['ma_settings','ma_accounts','ma_sv_accounts','ma_parties','ma_items','ma_commitments','ma_counters',
  'ma_journal','ma_transfer','ma_counts','ma_closes','ma_audit','ma_backups','ma_shares','ma_feedback'];
// The postings and the trial balance are built from these; without one of
// them they are not the whole book, and they say so.
const _maBookCore=['ma_settings','ma_accounts','ma_journal','ma_transfer','ma_counts'];
function maBooksJson(o){
  const cols=o&&o.cols||{},failed=o&&o.failed||[];
  const out={format:'groovy-master-accounts-books',version:1,exportedAt:o&&o.at||0,exportedBy:o&&o.by||null,
    complete:!failed.length,failed:failed.map(f=>({collection:String(f.col),error:maStr(f.message,300)})),counts:{},collections:{}};
  MA_BOOK_COLS.forEach(c=>{if(cols[c]){out.counts[c]=cols[c].length;out.collections[c]=cols[c];}});
  return out;
}
function _maBookCell(v){
  if(v===undefined||v===null)return '';
  if(typeof v==='number'||typeof v==='boolean')return v;
  const s=typeof v==='string'?v:JSON.stringify(v);
  return s.length>32000?s.slice(0,32000)+'…':s;   // an Excel cell holds 32,767 characters
}
function maBooksSheets(o){
  o=o||{};
  const cols=o.cols||{},failed=o.failed||[];
  const when=typeof o.when==='function'?o.when:(ms=>ms);
  const of=c=>(cols[c]||[]).map(x=>Object.assign({},x.data||{},{id:x.data&&x.data.id!==undefined?x.data.id:x.id}));
  const main=(cols.ma_settings||[]).find(x=>x.id==='main');
  const s=maSettings(main?main.data:null);
  const idx=maChartIndex(maChart('groovy',of('ma_accounts')));
  const docs=of('ma_journal').map(d=>Object.assign({dt:'journal'},d)).concat(
    of('ma_transfer').map(d=>Object.assign({dt:'transfer'},d)),of('ma_counts').map(d=>Object.assign({dt:'count'},d)));
  const lines=maPostAll(docs,idx,s).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.doc&&a.doc.no||'').localeCompare(String(b.doc&&b.doc.no||'')));
  const parties={};of('ma_parties').forEach(p=>{parties[p.id]=p.name;});
  const broken=failed.filter(f=>_maBookCore.indexOf(f.col)>=0).map(f=>f.col);
  const failedBy={};failed.forEach(f=>{failedBy[f.col]=maStr(f.message,200);});
  const contents=[['GROOVY — Master Accounts: the books'],['Downloaded',when(o.at)],['By',o.byName||o.by||''],[]];
  if(broken.length)contents.push(['INCOMPLETE — the postings and the trial balance leave out '+broken.join(', ')+', which could not be read.'],[]);
  else if(failed.length)contents.push(['INCOMPLETE — '+failed.map(f=>f.col).join(', ')+' could not be read; everything else is whole.'],[]);
  contents.push(['Collection','Documents','Read']);
  MA_BOOK_COLS.forEach(c=>contents.push([c,cols[c]?cols[c].length:'',cols[c]?'yes':(failedBy[c]!==undefined?'NO — '+failedBy[c]:'not asked for')]));
  const post=[['Date','Document','Account','Debit','Credit','Holder','Party','Payee','Category','Cost centre','Kind','Channel','Status','Source','By']]
    .concat(lines.map(l=>[l.date,l.doc&&l.doc.no||'',maAccLabel(idx,l.account),l.dr,l.cr,l.holder||'',l.party?(parties[l.party]||l.party):'',l.payee||'',l.category||'',l.costCentre||'',l.kind||'',l.channel||'',l.status||'',l.source||'',l.by||'']));
  const tb=maTrialBalance(lines,idx,{book:'groovy'});
  const tbRows=[['Code','Account','Type','Debits','Credits','Debit balance','Credit balance']]
    .concat(tb.rows.map(r=>[r.code,r.name,r.type,r.dr,r.cr,r.debit,r.credit]))
    .concat([['','Total','',tb.dr,tb.cr,tb.debit,tb.credit],['',tb.balanced?'Debits equal credits.':'NOT BALANCED — debits and credits differ.']]);
  const sheets=[{name:'Contents',rows:contents},{name:'Postings',rows:post},{name:'Trial balance',rows:tbRows}];
  MA_BOOK_COLS.forEach(c=>{
    if(!cols[c])return;
    const keys=[];(cols[c]||[]).forEach(x=>Object.keys(x.data||{}).forEach(k=>{if(k!=='id'&&keys.indexOf(k)<0)keys.push(k);}));
    sheets.push({name:c,rows:[['id'].concat(keys)].concat((cols[c]||[]).map(x=>[x.id].concat(keys.map(k=>_maBookCell((x.data||{})[k])))))});
  });
  return sheets;
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={MA_BOOKS,MA_ACCOUNT_TYPES,MA_HOLDER_KINDS,MA_SPEND_GROUPS,MA_LABEL_KINDS,MA_CHANNELS,MA_SOURCES,
    MA_CHART,MA_SV_CHART,MA_SUSPENSE,MA_UNLABELLED,MA_PARTY_KINDS,MA_VENDOR_ROLES,MA_TERMS_MODES,MA_TAX_KINDS,
    MA_COMMIT_KINDS,MA_CADENCES,MA_OWNERS,MA_DOC_TYPES,MA_JOURNAL_KINDS,MA_EDIT_FIELDS,MA_DEFAULT_SETTINGS,
    maSettings,maEsc,maNorm,maDay,maIsDay,maDayAdd,maDaysBetween,maWeekday,maMonthOf,maMonthAdd,maDaysInMonth,
    maFyEndYear,maFyOf,maQuarterOf,maQuarterRange,maQuarterLabel,maPeriodLabels,maMonthLabel,maDayLabel,
    maParseRupees,maGroup,maRs,maRsSigned,maRsShort,maRsWords,maChart,maChartIndex,maAcc,maIsMoney,maMoneyAccounts,
    maTaxBlank,maTaxCompute,maTaxBlock,maTaxIssues,maDocNo,maTransferConfirm,maBuildDoc,maJournalTotal,
    maPost,maPostAll,maSumLines,maBal,maBalanceOf,maRunningMin,maHolderRows,maCashInHand,maTrialBalance,maLedger,
    maTermsIssues,maTermsText,maTermsAt,maTermsChange,maNextPayDay,maDueDate,maRateAt,maRateIssues,maRateChange,
    maPartyCode,maPartyIssues,maItemIssues,maCommitmentIssues,maCommitmentDueDays,maCommitmentPeriodKey,
    maCommitmentStatus,maCommitmentText,maCalendar,maSpendable,maValidate,maVoidIssues,maEditDiff,maApplyEdit,
    maApplyVoid,maConfirmPatch,maUnlabelled,maReviewQueue,maNeedsAttention,maAllocateFifo,maDocTitle,maDocText,
    maAuditRow,maPad,maClone,maStr,maIsRupees,maCodeOk,maAccLabel,maSpendGroupOf,maLineText,
    maPdfLedgerData,maPdfHolderStatementData,maPdfPartyStatementData,maPdfReceiptData,maPdfVoucherData,
    MA_AUDIT_ACTIONS,MA_ATTACH_FORMATS,MA_ATTACH_MAX,MA_ATTACH_KEYS,MA_BACKUP_STATES,MA_BOOK_COLS,
    maAttachPidOk,maAttachOk,maAttachClean,maAttachList,maAttachFromUpload,maAttachRef,maAttachIssues,maRevOf,
    maLiveFlags,maAnsweredFlags,maBackupState,maBackupMissing,maWaPhone,maWaLink,maShareState,maBooksJson,maBooksSheets};
}

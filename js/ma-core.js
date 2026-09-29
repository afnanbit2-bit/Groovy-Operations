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
  {code:'1060',name:'TCS account',type:'asset',money:true,holderKind:'wallet'},   // on since M2: TCS credits land here
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
  count:{col:'ma_counts',prefix:'CT',label:'Count'},
  // M2: a courier statement — PostEx's receipts and days DERIVED by the
  // nightly rollup (ids of their own, no counter), TCS and Bykea TYPED
  // (CS-27-0001) — and the collection of one or several of them (CL-27-0001).
  cpr:{col:'ma_cpr',prefix:'CS',label:'Courier statement'},
  collection:{col:'ma_collection',prefix:'CL',label:'Collection'}
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
   is derived again by the builder, or is identity (type, kind, party).
   firestore.rules lists the same per collection (maEditOk's `editable`) and
   tests/master-accounts.test.js holds the two equal. A count's `amount` is
   here, and so NAMED when it moves: it is the size of the difference, and
   an edit that moves money says so (M1.6a, security F1). */
const MA_EDIT_FIELDS={
  journal:['date','holder','account','payee','amount','tax','costCentre','labelKind','channel','po','article','commitmentId','commitmentPeriod','owner','lines','note','tags','attachments'],
  transfer:['date','from','to','amount','note','attachments'],
  count:['date','counted','amount','note','attachments'],
  // A typed statement (kind 'statement'): its totals are named with its
  // lines, so an edit that moves money says so — its tax block too, rebuilt
  // from `taxes` (M2.4: unnamed, the rules refused every edit that moved the
  // tax). Courier and kind are identity.
  cpr:['date','ref','lines','amount','net','grossCod','fees','taxes','tax','parcels','note','tags','attachments'],
  // A collection: what it covers (refs, covers, expected) and its courier are
  // identity — void it and record it again.
  collection:['date','holder','amount','collectedBy','note','tags','attachments']
};
/* What an edit may change WITHOUT naming it in its row, because the builder
   derives it again — maEditOk's `derived` in firestore.rules, held equal by
   a test (M1.6a). NOT amount and NOT tax: those are what posts, so an edit
   that moves money names them (security F1). A count's difference is here
   because the rules bind it (difference = counted − book) and move the
   book only when the day or the count is named (money F2). `flags` are the
   edit's own live flags (money F8); the review fields may only be CLEARED
   by an edit, never set — the review path (maReviewOk) alone sets them. */
const MA_EDIT_DERIVED=['rev','edits','month','quarter','fy','historical','difference','bookBalance','flags','reviewedAt','reviewedBy'];
/* The fields that move what a document POSTS. An edit that changes one
   clears the review (money F8): an owner reviewed the old figures, not the
   new ones, so a still-flagged document is back in the review queue. The
   rules hold the same list (maEditOk's `figures`). `net` joined with the
   courier statements (M2.4): it is what a collection is counted against. */
const MA_FIGURE_FIELDS=['date','amount','tax','party','account','holder','from','to','owner','lines','counted','net'];
/* A transfer's confirmation: decided when it is recorded (maTransferConfirm,
   the rules' maTrBornOk), set by maConfirmPatch, and NEVER touched by an
   edit (money F6). */
const MA_CONFIRM_KEYS=['confirmBy','confirmPaper','confirmedBy','confirmedAt','confirmedFor','confirmVia'];
/* Whose hands each holder is in (§3 #3) — the ONE map a transfer's
   confirmation is decided from (M1.6a). Read off MA_CHART: every money
   account that names a person. firestore.rules carries the same map
   (maHands, maDrawers) and tests/master-accounts.test.js fails if the two
   disagree. Deliberately the SEEDED chart, never the owners' edited copy:
   the rules cannot read that, and a confirmation the form and the rules
   decide differently is exactly what this map exists to prevent. */
const MA_HANDS=Object.freeze(MA_CHART.reduce((m,a)=>{if(a.money&&a.person)m[a.code]=a.person;return m;},{}));
/* The drawer: a CASH holder in the hands of someone who cannot sign in to
   the books (1010, Raees). Its balance is read from his Store Accounts until
   M8, so money into OR out of it waits until he has recorded it there — the
   drawer counts as his hands in both directions (money F9). */
const MA_DRAWERS=Object.freeze(MA_CHART.filter(a=>a.money&&a.holderKind==='cash'&&a.person&&MA_OWNERS.indexOf(a.person)<0).map(a=>a.code));
function maHandsOf(code){const c=String(code===undefined||code===null?'':code);return Object.prototype.hasOwnProperty.call(MA_HANDS,c)?MA_HANDS[c]:null;}
function maIsDrawer(code){return MA_DRAWERS.indexOf(String(code===undefined||code===null?'':code))>=0;}

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
  assetThreshold:50000,
  // M2 — the couriers. `from` is the day the nightly rollup derives PostEx's
  // days and receipts from: the books' start unless PostEx's parcels are not
  // complete from then (never before historyFrom). Per courier: how many days
  // after a statement the cash is usually collected, how many days an
  // uncollected one waits before Needs attention names it, whether its GST
  // is claimable (1160) or a cost (not, until the accountant says), and how
  // far back before `from` a receipt is still offered for a collection.
  couriers:{from:'2026-07-01',runWatchHours:36,
    postex:{collectLagDays:1,uncollectedDays:3,taxClaimable:false,beforeWindowDays:31},
    tcs:{collectLagDays:0,uncollectedDays:7,taxClaimable:false,beforeWindowDays:0},
    bluex:{collectLagDays:0,uncollectedDays:0,taxClaimable:false,beforeWindowDays:0},
    bykea:{collectLagDays:2,uncollectedDays:7,taxClaimable:false,beforeWindowDays:0}}
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
  const c=stored.couriers;
  if(c&&typeof c==='object'){
    if(maIsDay(c.from))s.couriers.from=c.from;
    if(num(c.runWatchHours,1,720))s.couriers.runWatchHours=c.runWatchHours;
    Object.keys(s.couriers).forEach(k=>{
      const d=s.couriers[k],v=c[k];
      if(!d||typeof d!=='object'||!v||typeof v!=='object')return;
      ['collectLagDays','uncollectedDays','beforeWindowDays'].forEach(f=>{if(Number.isInteger(v[f])&&v[f]>=0&&v[f]<=366)d[f]=v[f];});
      if(typeof v.taxClaimable==='boolean')d.taxClaimable=v.taxClaimable;
    });
  }
  // The rollup never derives income before the books start.
  if(s.couriers.from<s.historyFrom)s.couriers.from=s.historyFrom;
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
  // "5.000" is a thousands separator somewhere else in the world, and ₨5
  // here: it is never read as either (money N2) — maRupeesDotted says what
  // it probably meant.
  if(/^-?\d{1,3}(\.\d{3})+$/.test(s))return NaN;
  return Number(s);
}
/* "5.000" or "1.500.000" — digits in threes after a point, the way a
   thousands separator is written elsewhere. The figure it was probably
   meant to be ('5,000'), or '' for anything else. */
function maRupeesDotted(v){
  if(typeof v!=='string')return '';
  const s=v.replace(/[₨\s]/g,'').replace(/^rs\.?/i,'');
  if(!/^-?\d{1,3}(\.\d{3})+$/.test(s))return '';
  return (s.charAt(0)==='-'?'−':'')+maGroup(Number(s.replace(/[-.]/g,'')));
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
/* ₨8.4 lac · ₨2.1 cr — for sentences, never for a column. The unit is
   chosen by the ROUNDED figure (review V10): ₨99,99,999 is a hundred lac
   to one decimal, which is "₨1 cr", never "₨100 lac". Rounding is done in
   whole tenths of the unit (a/1e4 tenths of a lac, a/1e6 of a crore), so a
   figure on the half rounds up the same way on every browser. */
function maRsShort(n){
  const v=Math.round(Number(n)||0),a=Math.abs(v),sign=v<0?'−':'';
  const tenths=t=>t%10?(t/10).toFixed(1):String(t/10);
  const lac=Math.round(a/1e4);
  if(a>=1e7||lac>=1000)return sign+'₨'+tenths(Math.round(a/1e6))+' cr';
  if(a>=1e5)return sign+'₨'+tenths(lac)+' lac';
  return sign+'₨'+maGroup(a);
}
/* A RATE — ₨1,612.5 a kilo, ₨1,50,000 a month: grouped the way every other
   figure is (QA F15; a rate card printed ₨150,000 beside ₨1,50,000), with
   up to two decimals, since a rate need not be whole rupees. '' for
   something that is not a number. */
function maRsRate(n){
  const v=Number(n);
  if(n===null||n===undefined||n===''||!Number.isFinite(v))return '';
  const c=Math.round(Math.abs(v)*100),whole=Math.floor(c/100),frac=c%100;
  return (v<0&&c?'−':'')+'₨'+maGroup(whole)+(frac?'.'+String(frac).padStart(2,'0').replace(/0$/,''):'');
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
/* Who must confirm a transfer (§3 #3) — DERIVED from MA_HANDS, never chosen
   by the form, and the rules decide it the same way (maTrWho). The person
   whose hands the money reaches confirms: an owner in the app; anyone else
   (Raees, Umair) on paper, by an owner holding the signed receipt. Out of
   the drawer to a holder nobody holds (a bank), Raees: the drawer is his
   hands both ways. A recorder who IS the receiver has confirmed by
   recording — except where the drawer is on either side: there even the
   receiver's own entry waits until Raees has recorded it in Store Accounts
   (money F9: the drawer's balance is read from there, so a handover posted
   before he books it is counted twice, or not at all). This REPLACES M1's
   "a transfer into the drawer posts at once". `idx` and `settings` are not
   read: the map is the seeded chart's, the one the rules can see. */
function maTransferConfirm(from,to,idx,recorder){
  const drawer=maIsDrawer(from)||maIsDrawer(to);
  const who=maHandsOf(to)||(maIsDrawer(from)?maHandsOf(from):null);
  if(!who||(who===recorder&&!drawer))return {pending:false,confirmBy:null,paper:false};
  return {pending:true,confirmBy:who,paper:MA_OWNERS.indexOf(who)<0};
}
/* A transfer that waits for — or was confirmed by — someone (money F6): its
   stored confirmBy, or the map's answer for its route (a transfer recorded
   before M1.6a, when the drawer posted at once, needs one all the same). Its
   route, amount and day cannot change; it is voided and recorded again. */
function maTransferNeedsConfirm(d){
  return !!(d&&d.dt==='transfer'&&(d.confirmBy||maTransferConfirm(d.from,d.to,null,d.by).pending));
}
/* What must be said before a confirmation (money F9): a handover that
   touches the drawer is confirmed only once Raees has recorded it in Store
   Accounts. '' for every other transfer. */
function maConfirmWarning(d){
  // A collection into the drawer (Bykea's, M2): Raees records it as a cash
  // in in Store Accounts first, for the same reason.
  if(d&&d.dt==='collection'&&maIsDrawer(d.holder))return 'Confirm '+(d.no||'this collection')+' only once Raees has recorded this '+maRs(d.amount)+' as a cash in in Store Accounts. The drawer’s balance is read from there — confirming before he records it counts the money twice, or not at all.';
  if(!d||d.dt!=='transfer'||!(maIsDrawer(d.from)||maIsDrawer(d.to)))return '';
  return 'Confirm '+(d.no||'this transfer')+' only once Raees has recorded this '+maRs(d.amount)+' in Store Accounts. The drawer’s balance is read from there — confirming before he records it counts the money twice, or not at all.';
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
    const c=maTransferConfirm(doc.from,doc.to,idx,m.by);
    doc.status=c.pending?'pending':'posted';
    doc.confirmBy=c.confirmBy;doc.confirmPaper=c.paper;
  }else if(dt==='count'){
    doc.holder=maStr(i.holder,8);doc.counted=rupees(i.counted);
    doc.bookBalance=Number.isInteger(m.bookBalance)?m.bookBalance:0;
    doc.difference=Number.isInteger(doc.counted)?doc.counted-doc.bookBalance:NaN;
    doc.amount=Number.isInteger(doc.difference)?Math.abs(doc.difference):0;
    doc.tax=maTaxBlank();
  }else if(dt==='cpr'){
    // A TYPED statement (TCS, Bykea): PostEx's receipts and days are derived
    // by the rollup (maCourierDocs) and never built here.
    _maBuildStatement(doc,i,s,rupees);
  }else if(dt==='collection'){
    _maBuildCollection(doc,i,m,s,rupees);
  }
  return doc;
}
/* The book a count is held against (money F2). A new count takes the book as
   it stands (`bookNow`); an EDIT keeps the stored book unless the day or the
   figure counted changed — a note must never move the difference, and so
   the posting, behind a row that says "note". The rules agree: bookBalance
   moves only in an edit that names date or counted. */
function maCountBookOf(before,input,bookNow){
  const i=input||{};
  if(before&&Number.isInteger(before.bookBalance)&&maStr(i.date,10)===before.date&&maParseRupees(i.counted)===before.counted)return before.bookBalance;
  return bookNow;
}
/* The locked quarter a document sits in, as its label — '' when it is open
   (security F3b, money F7). One reading of ma_closes for the confirm, the
   review and anything else that must refuse in a closed quarter with words
   that name it, rather than leave the rules to refuse with none. */
function maQuarterLocked(doc,ctx){
  const c=ctx||{};const s=c.settings||MA_DEFAULT_SETTINGS;
  if(!doc||!maIsDay(doc.date))return '';
  const q=maQuarterOf(doc.date,s.fiscalYearStart);
  return (c.closes||[]).some(x=>x&&x.quarter===q&&x.locked===true&&!x.reopenedAt)?maQuarterLabel(q,s.fiscalYearStart):'';
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
/* An opening balance on the books (QA F25): a journal of kind 'opening'
   that is not void. A journal never waits — only a transfer is ever
   pending (maBuildDoc) — so "not void" is "live"; and one dated before
   go-live (historical) counts, since it is still where the books start.
   ONE definition: Needs attention's "No opening balance yet" and
   maValidate's second-opening check both read it. */
function maIsOpening(d){return !!d&&d.dt==='journal'&&d.kind==='opening'&&d.status!=='void';}

/* ── Posting (§7) — a document's lines, labelled per §27 ─────────────────── */
/* Every line is {account, dr, cr} plus the labels. A void or a pending
   document posts NOTHING — "pending never counts" (§6). */
function maPost(doc,idx,settings){
  const s=settings||MA_DEFAULT_SETTINGS;
  // `before` (a PostEx receipt dated before the books start, kept only so a
  // collection can name it) and `undated` (a receipt PostEx gave no date)
  // post nothing either (M2).
  if(!doc||doc.status==='void'||doc.status==='pending'||doc.status==='before'||doc.status==='undated')return [];
  const out=[];
  const base={
    book:doc.book||'groovy',
    doc:{dt:doc.dt,kind:doc.kind||null,id:doc.id||doc._id||null,no:doc.no||null},
    date:doc.date,month:doc.month,quarter:doc.quarter,fy:doc.fy,
    status:doc.historical?'historical':'posted',
    source:doc.source||'manual',by:doc.by||null,
    evidence:(doc.attachments||[]).length,tags:doc.tags||[],
    party:doc.party||null,partyKind:doc.partyKind||null,payee:doc.payee||'',
    courier:doc.courier||null
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
  }else if(doc.dt==='cpr'){
    _maPostCpr(doc,push,s);
  }else if(doc.dt==='collection'){
    _maPostCollection(doc,push,s);
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
  // A collection waiting for its receiver counts like a transfer waiting to
  // arrive (M2): pendingIn of its holder — so the V4 rule in maHolderCash
  // takes one into the drawer out of the drawer's Store Accounts figure.
  const pend=(docs||[]).filter(d=>(d.dt==='transfer'||d.dt==='collection')&&d.status==='pending');
  const into=(p,code)=>p.dt==='collection'?p.holder===code:p.to===code;
  const counts=(docs||[]).filter(d=>d.dt==='count'&&d.status!=='void');
  const lastMove={};(lines||[]).forEach(l=>{if(l.holder&&l.account===l.holder&&(!lastMove[l.holder]||l.date>lastMove[l.holder]))lastMove[l.holder]=l.date;});
  // A courier's own holder (the TCS account, 1060 — switched on for M2) is
  // listed only once the couriers' documents were loaded (`opts.couriers`),
  // or when something has already moved through it. A build whose pages do
  // not read ma_cpr / ma_collection yet shows no ₨0 courier row on Today or
  // Money for a feature nobody can use.
  const wallets=Object.keys(MA_COURIERS).map(k=>MA_COURIERS[k].accounts.wallet).filter(Boolean);
  const shown=a=>a.active&&(opts.couriers===true||wallets.indexOf(a.code)<0);
  return maMoneyAccounts(idx,{all:true}).filter(a=>shown(a)||sums[a.code]||pend.some(p=>p.from===a.code||into(p,a.code))).map(a=>{
    const ledger=maBal(a,sums[a.code]);
    const mirror=s.mirrors&&s.mirrors[a.code]?s.mirrors[a.code]:null;
    const mb=opts.mirrorBalances||{};
    const mirrorOk=!mirror||Number.isInteger(mb[a.code]);
    const balance=mirror?(mirrorOk?mb[a.code]:null):ledger;
    const pendingIn=pend.filter(p=>into(p,a.code)).reduce((t,p)=>t+(p.amount||0),0);
    const pendingOut=pend.filter(p=>p.from===a.code).reduce((t,p)=>t+(p.amount||0),0);
    const lc=counts.filter(c=>c.holder===a.code).sort((x,y)=>x.date<y.date?1:x.date>y.date?-1:(y.ts||0)-(x.ts||0))[0]||null;
    return {code:a.code,name:a.name,person:a.person||null,holderKind:a.holderKind,active:a.active,mirror,mirrorOk,
      ledger,balance,pendingIn,pendingOut,available:balance===null?null:balance-pendingOut,
      floor:Number.isInteger(s.holderFloor[a.code])?s.holderFloor[a.code]:0,
      lastCount:lc?{date:lc.date,counted:lc.counted,difference:lc.difference,no:lc.no||null}:null,
      lastMove:lastMove[a.code]||null};
  });
}
/* What ONE holder adds to a cash total — the one rule every cash figure on
   every page reads (review V4, QA F04): the hero, the holders tables' total,
   the Dashboard card and the 30-day start. They used to disagree by any
   handover waiting to go into the drawer, because only the 30 days took it
   out: the hero counted it twice in the window the confirm warning asks
   for (Raees records it in Store Accounts, THEN an owner confirms).
   A waiting transfer posts nothing, so the holder it left still holds it
   and the one it goes to does not — true of every holder kept here. The
   drawer is Store Accounts' figure, which moves when Raees records the
   handover, and he records it BEFORE an owner confirms it (M1.6a). So a
   handover waiting to go INTO a mirrored holder is taken out of that
   holder's figure (`waiting`): it is counted where it came from, never
   twice. Until Raees records it the figure never had it, and a total is
   short by it — which is why every page that shows a total says what is
   waiting beside it. One waiting to come OUT of the drawer is left as Store
   Accounts has it: adding it back would count money Raees may no longer
   hold. Neither way can a total be more than what is really there.
   null when the holder could not be read. */
function maHolderCash(r){
  if(!r||r.balance===null||r.balance===undefined)return null;
  const waiting=r.mirror&&r.pendingIn?r.pendingIn:0;
  return {amount:r.balance-waiting,waiting};
}
/* A cash total over the holders `take` keeps, each through maHolderCash.
   `complete:false` when a holder it keeps could not be read — the page says
   so instead of showing a smaller number as if it were whole. */
function _maCashTotal(rows,take){
  let total=0,complete=true,n=0,waiting=0;
  (rows||[]).forEach(r=>{
    if(!r||!r.active||!take(r))return;
    const x=maHolderCash(r);
    if(!x){complete=false;return;}
    total+=x.amount;waiting+=x.waiting;n++;
  });
  return {total,complete,holders:n,waiting};
}
/* Cash in hand, the hero number: every active holder but the TCS account
   (money that sits at TCS is not in anybody's hand until it is drawn). */
function maCashInHand(rows){
  return _maCashTotal(rows,r=>r.holderKind!=='wallet');
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
/* The filters that NARROW one account's ledger to SOME of its lines (M1.6b,
   money F4). A balance run over some of an account's lines is not its
   balance — "opening ₨0, balance −₨15,000" for MCB filtered to the
   landlord — so while one is on there is no running balance, no opening
   and no closing; the totals of the lines shown still stand. The range is
   not one: the opening carries what came before it. */
const MA_LEDGER_NARROW=[['party','party'],['dt','document type'],['q','search'],['category','category'],['spendGroup','spend group'],['costCentre','cost centre'],['source','source'],['kind','kind']];
/* ONE account's running balance is shown only when it IS the account's
   balance (M1.6b): not under a narrowing filter, and not for a holder whose
   balance is another module's book — the drawer is Store Accounts' (money
   F5): its lines here are the handovers alone, and a balance run from them
   is one nobody holds. → null (a balance is shown) or {narrow:[labels],
   mirror:'store'|null}. `settings` carries the mirrors; without it no
   holder is taken for mirrored. */
function maLedgerBalanceHidden(filter,settings){
  const f=filter||{};
  const code=f.account||f.holder;
  if(!code)return null;
  const narrow=MA_LEDGER_NARROW.filter(x=>f[x[0]]).map(x=>x[1]);
  const mirror=settings&&settings.mirrors&&settings.mirrors[String(code)]?String(settings.mirrors[String(code)]):null;
  return narrow.length||mirror?{narrow,mirror}:null;
}
/* "party and search" — the narrowing filters, in words. */
function maLedgerHiddenWhy(h){
  if(!h)return '';
  if(h.mirror)return 'its balance is Store Accounts’ — only handovers to and from it are recorded here';
  const n=h.narrow||[];
  return 'balance hidden while filtered by '+(n.length>1?n.slice(0,-1).join(', ')+' and '+n[n.length-1]:n[0]||'a filter')+' — a balance over some of an account’s lines is not its balance';
}
/* The ledger (§16.2 "every posting, one shape"). With ONE account or
   holder it carries an opening, a running balance and a closing — unless
   maLedgerBalanceHidden says that would not be the account's balance. */
function maLedger(lines,filter,idx,settings){
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
  const hidden=maLedgerBalanceHidden(f,settings);
  const single=hidden?null:(f.account||f.holder);
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
    sources:Array.from(new Set(rows.map(r=>r.source))).length,balanceHidden:hidden};
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
  // A party kept on a cost centre removed from Settings since may keep it
  // through an edit (M1.6b, money F1); a new choice must be on the list.
  const was=p&&(c.parties||[]).find(x=>x&&x.id===p.id);
  if(p&&p.costCentre&&c.settings&&c.settings.costCentres.indexOf(p.costCentre)<0&&!(was&&was.costCentre===p.costCentre))bad('party.costCentre','Unknown cost centre.','costCentre');
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
  // Never looks back past the day the books begin (QA F03) — the floor
  // maCommitmentOpenPeriod keeps: a period before settings.historyFrom is
  // one the books never tracked, not one left unpaid. A yearly insurance due
  // every 15 Nov, opened in October with no `from`, is upcoming — it used to
  // report last November as overdue. (maCommitmentDueDays keeps c.from.)
  const lo=maDayAdd(today,-back);
  const floor=maIsDay(s.historyFrom)&&s.historyFrom>lo?s.historyFrom:lo;
  const past=maCommitmentDueDays(c,floor,today,s.fiscalYearStart);
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
/* The period a payment made on `day` most likely settles (M1.6b, money
   F10): the OLDEST due period on or before that day still not paid in full
   — a late payment settles the period it was late for, never the one after
   it, which is what an empty field used to become (the payment date's own
   period: August's rent paid on 2 Sep marked September paid and hid it).
   How far back it looks: from the first period anything was ever recorded
   against — a period before that is one the books never tracked, not one
   left unpaid — and when nothing ever was, the latest one due on or before
   the day. Everything due already paid: the next period due after the day
   (paying ahead). A cadence with no calendar day (per parcel, per piece,
   varies) names the day itself, the way maCommitmentPeriodKey does. The
   form shows the answer and the owner may change it; '' only when there is
   nothing to name. */
function maCommitmentOpenPeriod(c,docs,day,settings){
  const s=settings||MA_DEFAULT_SETTINGS;
  if(!c||!maIsDay(day))return '';
  if(MA_CADENCES.slice(0,4).indexOf(c.cadence)<0)return day;
  const lo=c.from&&maIsDay(c.from)&&c.from>s.historyFrom?c.from:s.historyFrom;
  const periods=[];
  maCommitmentDueDays(c,lo,day,s.fiscalYearStart).forEach(d=>{const p=maCommitmentPeriodKey(c,d,s.fiscalYearStart);if(periods.indexOf(p)<0)periods.push(p);});
  const mine=(docs||[]).filter(x=>x&&x.status!=='void'&&x.commitmentId===c.id);
  const paidIn=p=>mine.filter(x=>x.commitmentPeriod===p).reduce((t,x)=>t+(x.amount||0),0);
  const any=p=>mine.some(x=>x.commitmentPeriod===p);
  let start=periods.findIndex(any);
  if(start<0)start=periods.length-1;
  const open=p=>!any(p)||(c.amountExpected&&paidIn(p)<c.amountExpected);
  for(let i=Math.max(0,start);i<periods.length;i++)if(open(periods[i]))return periods[i];
  // Paying ahead: the first period due after the day not already paid.
  const later=[];
  maCommitmentDueDays(c,maDayAdd(day,1),maDayAdd(day,400),s.fiscalYearStart).forEach(d=>{const p=maCommitmentPeriodKey(c,d,s.fiscalYearStart);if(later.indexOf(p)<0)later.push(p);});
  return later.find(open)||later[0]||'';
}
/* A period written the way this commitment's cadence keys it: 2026-09
   (monthly), 2027-Q1 (quarterly), 2026 (yearly), a day otherwise. A typo
   ("2026-9") would never match what the status looks for, so the payment
   would settle nothing and the dues would stay open. */
function maCommitmentPeriodOk(c,p){
  const v=String(p||'');
  if(!c)return !!v;
  if(c.cadence==='monthly')return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  if(c.cadence==='quarterly')return /^\d{4}-Q[1-4]$/.test(v);
  if(c.cadence==='yearly')return /^\d{4}$/.test(v);
  return maIsDay(v);
}
/* A commitment period the way a person reads it (QA F05, F07), never the
   stored key: Sep 2026 (monthly), Q1 FY27 · Jul–Sep 2026 (quarterly), 2026
   (yearly), and a day for a weekly period or a cadence without a calendar
   day — with its year only when that is not this year's. Anything else is
   given back as it came. */
function maPeriodLabel(p,fyStart,today){
  const v=String(p===undefined||p===null?'':p);
  if(/^\d{4}-(0[1-9]|1[0-2])$/.test(v))return maMonthLabel(v);
  if(/^\d{4}-Q[1-4]$/.test(v))return maQuarterLabel(v,fyStart);
  if(maIsDay(v))return maDayLabel(v,!maIsDay(today)||v.slice(0,4)!==today.slice(0,4));
  return v;
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
   lands on today, because that is when the money is still owed.
   A commitment whose amount VARIES (amountExpected 0) is never a zero
   (QA F19): its due is an event marked `varies` with no amount, it adds
   nothing to `out` or the projection, and the day and the whole window
   count it (`varies`) so every page can say a bill of unknown size falls
   due — and that the projection leaves it out. Paid (any payment naming the
   period) it is done, as maCommitmentStatus already says. */
function maCalendar(o){
  const s=o.settings||MA_DEFAULT_SETTINGS;
  const today=o.today,n=o.days||30;
  const to=maDayAdd(today,n-1);
  const days=[];const byDay={};
  for(let i=0;i<n;i++){const d=maDayAdd(today,i);const w=maWeekday(d);
    const cell={day:d,weekday:w,in:0,out:0,varies:0,events:[],payDay:s.payDays.indexOf(w)>=0,cprDay:s.cprDays.indexOf(w)>=0};
    days.push(cell);byDay[d]=cell;}
  (o.commitments||[]).filter(c=>c&&c.active!==false).forEach(c=>{
    const varies=!c.amountExpected;
    const st=maCommitmentStatus(c,o.docs,today,s);
    if((st.state==='due'||st.state==='overdue'||st.state==='part')&&st.due<=today){
      const left=varies?0:Math.max(0,c.amountExpected-(st.amountPaid||0));
      byDay[today].events.push({dir:'out',label:c.name,amount:left,commitment:c.id,period:st.period,late:true,due:st.due,varies});
      byDay[today].out+=left;
      if(varies)byDay[today].varies++;
    }
    maCommitmentDueDays(c,maDayAdd(today,1),to,s.fiscalYearStart).forEach(d=>{
      const period=maCommitmentPeriodKey(c,d,s.fiscalYearStart);
      const mine=(o.docs||[]).filter(x=>x.status!=='void'&&x.commitmentId===c.id&&x.commitmentPeriod===period);
      if(varies){
        if(mine.length)return;
        byDay[d].events.push({dir:'out',label:c.name,amount:0,commitment:c.id,period,varies:true});
        byDay[d].varies++;
        return;
      }
      const left=Math.max(0,c.amountExpected-mine.reduce((t,x)=>t+(x.amount||0),0));
      if(!left)return;
      byDay[d].events.push({dir:'out',label:c.name,amount:left,commitment:c.id,period,varies:false});
      byDay[d].out+=left;
    });
  });
  // An inflow `spendable:false` (a TCS credit: into the TCS account, not
  // spendable until moved to MCB — M2) is shown on its day and never added
  // to what the holders can pay with.
  (o.inflows||[]).forEach(x=>{if(byDay[x.day]){byDay[x.day].events.push(Object.assign({dir:'in'},x));if(x.spendable!==false)byDay[x.day].in+=x.amount||0;}});
  let bal=Math.round(o.start||0);const unfunded=[];
  days.forEach(c=>{bal+=c.in-c.out;c.projected=bal;if(bal<0)unfunded.push(c.day);});
  // `complete:false` — the start left out a holder that could not be read
  // (the drawer): every figure here is then short by what it holds, and a
  // "short" day is a question, not an answer (M1.6b, money F3).
  return {start:Math.round(o.start||0),complete:o.complete!==false,waiting:Math.round(o.waiting||0),
    days,unfunded,out:days.reduce((t,c)=>t+c.out,0),in:days.reduce((t,c)=>t+c.in,0),
    varies:days.reduce((t,c)=>t+c.varies,0),end:bal};
}
/* What the calendar funds from: the cash and bank holders, as they stand
   with every handover still waiting NOT MOVED (M1.6b) — through the same
   maHolderCash the hero reads (review V4), so the two cannot disagree about
   one holder. Only the set differs: a till or a runner float is in somebody's
   hand but does not pay the cost register. `complete:false` when a holder
   could not be read. */
function maSpendable(rows){
  const x=_maCashTotal(rows,r=>r.holderKind==='cash'||r.holderKind==='bank');
  return {total:x.total,complete:x.complete,waiting:x.waiting};
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
    // An edit that leaves the holder as it was is not a new use of it: a
    // holder switched off since stays on the documents it already carries
    // (M1.6b, money F1 — the form offers it, and must be able to keep it).
    if(!h.active&&!(c.before&&c.before[field]===h.code)){refuse('holder.inactive',h.name+' is switched off in Settings.',field);return false;}
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
        else if(!a.active&&!(c.before&&c.before.account===a.code))refuse('account.inactive',a.name+' is switched off.','account');
        else if(MA_UNLABELLED.indexOf(a.code)>=0)flag('unlabelled','Not named yet — it waits in the Unlabelled queue until it is.','account');
        else if(k==='money_out'&&a.type==='revenue'&&!doc.note)flag('account.side','Money out booked to an income account — a refund? Say so in the note.','account');
        else if(k==='money_in'&&(a.type==='expense'||a.type==='cogs')&&!doc.note)flag('account.side','Money in booked to a cost — a refund from a vendor? Say so in the note.','account');
        // Online COD income is booked from the couriers' own records (M2).
        if(k==='money_in'&&a&&a.code==='4010')flag('account.derived','Online — COD is booked from the couriers’ records (PostEx’s days, TCS and Bykea statements) — this adds to it.','account');
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
      // A cost centre removed from Settings since stays on the documents
      // recorded under it: an edit may keep it (money F1), never pick it.
      if(def.tax&&doc.costCentre&&s.costCentres.indexOf(doc.costCentre)<0&&!(c.before&&c.before.costCentre===doc.costCentre))refuse('costCentre.valid','Unknown cost centre “'+doc.costCentre+'”.','costCentre');
      if(def.tax&&doc.commitmentId&&c.commitments&&!c.commitments.some(x=>x.id===doc.commitmentId))refuse('commitment.exists','That commitment is not in the register.','commitmentId');
      // A payment against a commitment names the period it settles (money
      // F10): a blank one used to become the payment date's own period.
      else if(def.tax&&doc.commitmentId){
        const cm=(c.commitments||[]).find(x=>x&&x.id===doc.commitmentId)||null;
        const open=cm&&maIsDay(doc.date)?maCommitmentOpenPeriod(cm,(c.docs||[]).filter(d=>d&&d.id!==doc.id&&(!c.before||d.id!==c.before.id)),doc.date,s):'';
        if(!maStr(doc.commitmentPeriod))refuse('commitment.period','Say which period this pays'+(open?' — the oldest still open on that day is '+open:'')+'.','commitmentPeriod');
        else if(cm&&!maCommitmentPeriodOk(cm,doc.commitmentPeriod))refuse('commitment.period_shape','“'+maStr(doc.commitmentPeriod,20)+'” is not a period of '+cm.name+' — write it as '+(open||maCommitmentPeriodKey(cm,maIsDay(doc.date)?doc.date:s.historyFrom,s.fiscalYearStart)||'2026-09')+'.','commitmentPeriod');
      }
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
        if(!a.active&&!(c.before&&(c.before.lines||[]).some(x=>x&&x.account===a.code))){refuse('line.inactive','Line '+(i+1)+': '+a.name+' is switched off.','lines');bad=true;}
        if(s.mirrors&&s.mirrors[a.code]){refuse('holder.mirror','Line '+(i+1)+': '+a.name+' is still Raees’s book in Store Accounts until M8.','lines');bad=true;}
        if(k==='opening'){
          if(!Number.isInteger(l.amount)||l.amount<=0){refuse('line.amount','Line '+(i+1)+': whole rupees above zero.','lines');bad=true;return;}
          if(l.side==='cr')cr+=l.amount;else dr+=l.amount;
          if(a.code==='3090')flag('opening.self','Line '+(i+1)+': 3090 balances the opening by itself — no need to name it.','lines');
          // PostEx opens from its own parcels (the rollup's PX-OPEN, M2): a
          // line here on 1120 or 1121 adds to it. Blue-Ex's 1123 is typed
          // here on purpose — it has no feed — so it is never flagged.
          if(MA_OPENING_DERIVED.indexOf(a.code)>=0)flag('opening.derived','Line '+(i+1)+': '+a.name+' opens from PostEx’s own parcels (the nightly rollup) — a line here adds to it.','lines');
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
      // What the lines DO to the holders (money F12). The rules language has
      // no loop over lines, so these hold in the client only — a known
      // limit, named in firestore.rules beside maDocCreateOk.
      if(k==='general'&&!bad){
        const net={};
        lines.forEach(l=>{const a=acc(l.account);if(a&&a.money)net[a.code]=(net[a.code]||0)+(l.dr||0)-(l.cr||0);});
        const into=Object.keys(net).filter(x=>net[x]>0),outOf=Object.keys(net).filter(x=>net[x]<0);
        const names=list=>list.map(x=>acc(x).name).join(' and ');
        // Between two holders it is a handover, and a handover into another
        // person's hands waits for them: a journal would post it at once.
        if(into.length&&outOf.length)refuse('journal.holders','Money moves from '+names(outOf)+' to '+names(into)+' here — record a transfer: it waits for the receiver.','lines');
        else if(outOf.length){
          // Out of a holder against a cost: a Money out in all but name, so
          // it is flagged the way a Money out is when nothing proves it.
          const paid=outOf.reduce((t,x)=>t-net[x],0);
          const cost=lines.reduce((t,l)=>{const a=acc(l.account);return t+(a&&(a.type==='expense'||a.type==='cogs')?(l.dr||0)-(l.cr||0):0);},0);
          const pays=Math.min(paid,cost);
          const ev=s.evidence||{};
          if(pays>0&&ev.flagAbove&&pays>=ev.flagAbove){
            if(!(doc.attachments||[]).length)flag('evidence.missing','No bill or receipt attached ('+maRs(pays)+' paid out of '+names(outOf)+').','attachments');
            if(!lines.some(l=>l&&l.party))flag('journal.payee',maRs(pays)+' paid out of '+names(outOf)+' names nobody as paid — a Money out names its payee.','lines');
          }
        }
      }
      // A second opening for an account doubles its starting balance.
      if(k==='opening'&&!bad){
        const prior=(c.docs||[]).filter(d=>maIsOpening(d)&&d.id!==doc.id&&(!c.before||d.id!==c.before.id));
        const seen={};
        lines.forEach((l,i)=>{
          if(seen[l.account])return;
          const p=prior.find(d=>(d.lines||[]).some(x=>x&&x.account===l.account));
          if(p){seen[l.account]=true;flag('opening.again','Line '+(i+1)+': '+acc(l.account).name+' already has an opening ('+(p.no||'another document')+') — a second one adds to it.','lines');}
        });
      }
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
  }else if(doc.dt==='cpr'){
    _maValidateStatement(doc,c,s,{refuse,flag,lockedQ});
  }else if(doc.dt==='collection'){
    _maValidateCollection(doc,c,s,{refuse,flag,lockedQ,holderOk,amountOk,acc});
  }
  // Editing: a reason, and identity never changes (§31, §6)
  if(c.before){
    if(!maStr(c.reason))refuse('edit.reason','Say why this is being changed.','reason');
    if(c.before.dt!==doc.dt||(c.before.kind||null)!==(doc.kind||null))refuse('edit.type','A document cannot change its kind — void it and record the right one.');
    if((c.before.party||null)!==(doc.party||null))refuse('edit.party','A document cannot change its party — void it and record it against the right one.','party');
    if(c.before.status==='void')refuse('edit.void','A void document cannot be edited.');
    // The receiver decides who confirms (confirmBy, confirmPaper), and an
    // edit never touches a confirmation — so changing it would leave a
    // confirmation owed by one person on money handed to another.
    if(c.before.dt==='transfer'&&(c.before.to||null)!==(doc.to||null))refuse('edit.receiver','A transfer cannot change who received it — void it and record the right one.','to');
    if(c.before.dt==='transfer'&&doc.dt==='transfer'){
      const same=f=>_maCanon(c.before[f]===undefined?null:c.before[f])===_maCanon(doc[f]===undefined?null:doc[f]);
      if(maTransferNeedsConfirm(c.before)){
        // What was (or is to be) confirmed is this route, this amount, this
        // day (money F6) — the rules refuse the same (maTrEditOk).
        const moved=['from','amount','date'].filter(f=>!same(f));
        if(moved.length){
          const b=c.before;
          const who=_maCap(b.confirmBy||maTransferConfirm(b.from,b.to,null,b.by).confirmBy);
          refuse('edit.confirmed',(b.status==='pending'?'It waits for '+who+' to confirm':b.confirmedBy?_maCap(b.confirmedBy)+' confirmed it as it stands':'It needed '+who+'’s confirmation')+
            ' — its '+moved.join(', ')+' cannot change: void it and record it again.',moved[0]);
        }
      }else if(same('to')&&maTransferConfirm(doc.from,doc.to,null,c.before.by).pending)
        refuse('edit.route','That route waits to be confirmed, and an edit cannot start a confirmation — void it and record it again.','from');
    }
    if(c.before.dt==='collection'&&doc.dt==='collection')_maCollectionEditIssues(c.before,doc,{refuse});
    if(c.before.dt==='cpr'&&doc.dt==='cpr')_maStatementEditIssues(c.before,doc,c,{refuse});
    // A count is of one holder: that is what it IS (money M4).
    if(c.before.dt==='count'&&(c.before.holder||null)!==(doc.holder||null))refuse('edit.holder','A count cannot change which holder was counted — void it and count again.','holder');
  }
  return _maResult(issues);
}
function _maCap(u){u=String(u||'');return u?u.charAt(0).toUpperCase()+u.slice(1):'the receiver';}
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
  if(doc.dt==='cpr'&&doc.derived)out.push({rule:'void.derived',level:'refuse',message:'PostEx’s receipts and days are the nightly rollup’s — it voids one when PostEx no longer reports it. Dispute it instead.'});
  else if(doc.dt==='cpr'){const by=maCollectionsOf(c.docs,doc.id);if(by.length)out.push({rule:'void.collected',level:'refuse',message:by.map(x=>x.no||x.id).join(', ')+' collected it — void '+(by.length>1?'those':'that')+' first.'});}
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
   row in its history. null when nothing changed.
   An edit NEVER moves a status and never touches a confirmation (M1.6a,
   money F6): a note on a handover Ammar confirmed leaves it posted and
   confirmed, key for key — the builder's view of the edited route is not
   asked. `meta.flags` are the edit's own live flags (maValidate's, money
   F8); without them the stored ones stay (the writer's _maEditShape — a
   file attached from the rail changes no figure). A figure that moved
   clears the review: an owner reviewed the old figures, not these. So does
   a flag the document did not carry before (review V6): taking the note off
   a Money out booked to an income account moves no figure, but it makes a
   new claim ("booked to an income account") that no owner has looked at —
   left under the old review it would never reach the review queue. */
function maApplyEdit(before,after,meta){
  const d=maEditDiff(before,after);
  if(!d.fields.length)return null;
  const m=meta||{};
  const out=Object.assign({},after,{
    id:before.id,no:before.no,dt:before.dt,kind:before.kind,party:before.party===undefined?after.party:before.party,
    by:before.by,byName:before.byName,ts:before.ts,source:before.source,
    status:before.status,
    rev:(before.rev||1)+1,
    edits:(before.edits||[]).concat([{at:m.at||0,by:m.by||null,byName:m.byName||null,reason:maStr(m.reason,500),fields:d.fields,before:d.before,after:d.after}])
  });
  MA_CONFIRM_KEYS.forEach(k=>{if(before[k]!==undefined)out[k]=maClone(before[k]);else delete out[k];});
  let newFlag=false;
  if(Array.isArray(m.flags)){
    const f=maFlagRows(m.flags);
    if(f.length||Array.isArray(before.flags))out.flags=f;
    newFlag=maNewFlagRules(before.flags,f).length>0;
  }
  if((maEditClearsReview(d.fields)||newFlag)&&(before.reviewedAt!==undefined||before.reviewedBy!==undefined)){out.reviewedAt=null;out.reviewedBy=null;}
  return out;
}
/* The flag rules in `after` that `before` did not carry — by rule, so a
   flag re-worded by a later build is not "new". */
function maNewFlagRules(before,after){
  const had={};(Array.isArray(before)?before:[]).forEach(x=>{if(x&&x.rule)had[x.rule]=1;});
  const out=[];(Array.isArray(after)?after:[]).forEach(x=>{if(x&&x.rule&&!had[x.rule]&&out.indexOf(x.rule)<0)out.push(x.rule);});
  return out;
}
/* Does an edit naming these fields clear the review? Yes when one of them
   is a figure (MA_FIGURE_FIELDS) — the rules demand the same. */
function maEditClearsReview(fields){return (fields||[]).some(f=>MA_FIGURE_FIELDS.indexOf(f)>=0);}
/* maValidate's flags as a document stores them — the one shape, for a new
   document and an edit alike. */
function maFlagRows(flags){return (Array.isArray(flags)?flags:[]).filter(x=>x&&x.rule).map(x=>({rule:x.rule,message:x.message||'',field:x.field||null}));}
function maApplyVoid(doc,meta){
  const m=meta||{};
  return Object.assign({},doc,{status:'void',voidedAt:m.at||0,voidedBy:m.by||null,voidedByName:m.byName||null,voidReason:maStr(m.reason,500)});
}
/* The receiver says the money arrived. On paper = an owner confirms for a
   person who cannot sign in to the books (Raees, Umair) with a signed
   receipt; in the app = the named person themself. `ctx` = {closes,
   settings}: a transfer dated in a locked quarter is refused HERE, naming
   the quarter (money F7) — the rules refuse it too, but in no words a
   person can act on. */
function maConfirmPatch(doc,who,meta,ctx){
  const m=meta||{};
  if(!doc||doc.status!=='pending')return {error:'Only a pending transfer or collection is confirmed.'};
  const locked=maQuarterLocked(doc,ctx);
  if(locked)return {error:locked+' is closed — a '+(doc.dt==='collection'?'collection':'transfer')+' dated in it cannot be confirmed until an owner reopens the quarter.'};
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
   recorded, and an edit through the form stores its own live flags (M1.6a,
   money F8); a file attached from the rail leaves them as they were. The
   two that ask for evidence are answered by the document itself: attach
   the bill and "no bill attached" is no longer true, so it leaves the
   queue without anybody clearing it — and if the file is removed again,
   the flag is back. Nothing is rewritten; this only reads. Every other flag
   is a judgement about the world and waits for an owner's review. */
const _maAnswered={
  'evidence.missing':d=>maAttachList(d.attachments).length>0,
  'transfer.note':d=>maAttachList(d.attachments).length>0||!!maStr(d.note),
  // M2, decision 3: a collection or statement saved without its receipt
  // while attachments were off is answered by attaching it.
  'collection.receipt':d=>maAttachList(d.attachments).length>0,
  'statement.attach':d=>maAttachList(d.attachments).length>0
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
  // No opening balance yet (QA F25; Afnan: "keep opening balance alert").
  // The rule is maIsOpening: the book has an opening when any journal of
  // kind 'opening' is not void — so the line goes the moment one is
  // recorded, and comes back if the only one is voided. Until then every
  // balance on these pages (cash in hand, the holders, the 30 days) counts
  // from ₨0: the figures are not the books' own. That is why it is a
  // CONCERN, the red dot, and not a watch — a watch is "keep an eye on
  // this"; this is "every number here is wrong" — and why it carries the
  // largest weight: concerns sort before watches, so on a fresh install it
  // still leads the list over "Backups are not set up yet". It is raised
  // only when the caller hands the documents over (`docs` an array): with
  // none passed, whether there is an opening is not known and nothing is
  // said. The pages never reach it on a failed read — ma_journal is a core
  // collection, and a refused core read paints the error card instead.
  if(Array.isArray(o.docs)&&!o.docs.some(maIsOpening))add('concern','No opening balance yet — the books start when one is recorded.','The journal holds no opening balance that is not void, so every balance here counts from ₨0.',{label:'Record it',go:'record',kind:'opening'},Number.MAX_SAFE_INTEGER);
  // A holder below zero or its floor
  (o.holders||[]).forEach(h=>{
    if(!h.active||h.balance===null||h.mirror)return;
    if(h.balance<(h.floor||0))add('concern',h.name+' is at '+maRs(h.balance)+(h.floor?', below its floor of '+maRs(h.floor):'')+'.','The holder’s ledger balance today.',{label:'Open',go:'holder',ref:h.code},Math.abs(h.balance)+1e9);
  });
  // A mirrored holder that could not be read
  (o.holders||[]).forEach(h=>{
    if(h.active&&h.mirror&&!h.mirrorOk)add('watch','The drawer’s balance could not be read from Store Accounts — cash in hand leaves it out.','A refused or failed read is never shown as zero.',{label:'Retry',go:'reload'},5e8);
  });
  // An unfunded day — unless a holder could not be read: then the short day
  // is the missing balance talking, and it is said as that (money F3).
  if(o.calendar&&o.calendar.unfunded&&o.calendar.unfunded.length){
    const d=o.calendar.unfunded[0];const cell=o.calendar.days.find(x=>x.day===d);
    if(o.calendar.complete===false)add('watch','Can’t judge the next 30 days — the drawer’s balance could not be read.','Without the drawer, cash and bank would fall short on '+maDayLabel(d)+'; with it they may not.',{label:'Retry',go:'reload'},6e8);
    else add('concern','On '+maDayLabel(d)+' the cash and bank holders run '+maRs(cell?cell.projected:0)+' short of what falls due.','Cash and bank today, less the cost register’s dues day by day.',{label:'See the days',go:'calendar'},1e9);
  }
  // Commitments overdue and due (QA F05): the period in words, never its
  // stored key; a due day past today in the past tense; a part payment past
  // its grace is as late as nothing paid; a day outside this year carries
  // its year.
  const dayL=d=>maDayLabel(d,!maIsDay(today)||String(d).slice(0,4)!==today.slice(0,4));
  (o.commitments||[]).forEach(c=>{
    if(c.active===false)return;
    const st=maCommitmentStatus(c,o.docs,today,s);
    const left=Math.max(0,(c.amountExpected||0)-(st.amountPaid||0));
    const per=st.period?maPeriodLabel(st.period,s.fiscalYearStart,today):'';
    const late=st.due&&st.due<today&&maDaysBetween(st.due,today)>s.commitmentGraceDays;
    const act={label:'Record it',go:'pay_commitment',ref:c.id,period:st.period};
    if(st.state==='overdue')add('concern',c.name+' — nothing recorded for '+per+'; '+(left?maRs(left)+' ':'')+'was due '+dayL(st.due)+'.','The cost register: due on '+maCommitmentText(c).toLowerCase()+', with '+s.commitmentGraceDays+' days’ grace.',act,left+5e8);
    else if(st.state==='part'&&late)add('concern',c.name+' — '+maRs(left)+' still to pay for '+per+'; it was due '+dayL(st.due)+'.','The cost register: part paid, and past '+s.commitmentGraceDays+' days’ grace.',act,left+5e8);
    else if(st.state==='due'||st.state==='part'){
      const when=st.due===today?'is due today':st.due<today?'was due '+dayL(st.due):'is due '+dayL(st.due);
      add('watch',c.name+' '+when+(left?' — '+maRs(left)+(st.state==='part'?' still to pay':''):'')+'.','The cost register.',act,left);
    }
  });
  // Transfers waiting to be confirmed — "by you" to the one who confirms
  // it, and the action says Confirm only to someone who can (QA F05): for
  // anyone else it opens the transfer, which is all it ever did.
  (o.docs||[]).filter(d=>(d.dt==='transfer'||d.dt==='collection')&&d.status==='pending').forEach(d=>{
    const age=maIsDay(d.date)?maDaysBetween(d.date,today):0;
    const mine=!!o.viewer&&d.confirmBy===o.viewer;
    const can=!!o.viewer&&!maConfirmPatch(d,o.viewer,{at:0},{closes:o.closes||[],settings:s}).error;
    // "handed over", not "handed to": out of the drawer to the bank, Raees
    // confirms money that LEFT his hands (maTransferConfirm).
    const what=d.dt==='collection'?maRs(d.amount)+' collected from '+((MA_COURIERS[d.courier]||{}).name||'a courier')+' on '+dayL(d.date):maRs(d.amount)+' handed over on '+dayL(d.date);
    if(age>=s.pendingWatchDays)add('watch',what+' is waiting to be confirmed by '+(mine?'you':_maCap(d.confirmBy))+'.','Pending never counts: it is in neither holder until confirmed.',{label:can?'Confirm':'Open',go:'doc',ref:d.id,dt:d.dt},d.amount);
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
  // A read that failed says nothing about last night: that is a concern in
  // itself, never silence (money M2).
  if(o.backupUnread)add('concern','The backups could not be read — whether last night’s ran is not known.','ma_backups: the read was refused or failed. A failed read is never taken for a backup that ran.',{label:'Retry',go:'reload'},9e8);
  else if(o.backup!==undefined){
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
  // The couriers (M2): uncollected statements, collections without a
  // receipt or off their CPRs, the nightly rollup, unread collections.
  maCourierConcerns(o).forEach(x=>out.push(x));
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
  if(doc.dt==='cpr'){
    const c=(MA_COURIERS[doc.courier]||{name:doc.courier||'Courier'}).name;
    if(doc.kind==='statement')return c+' statement'+(doc.ref?' '+doc.ref:'');
    if(doc.kind==='day')return c+' · delivered '+(maIsDay(doc.date)?maDayLabel(doc.date):'');
    if(doc.kind==='opening')return c+' · owed when the books started';
    return c+' CPR '+(doc.ref||doc.no||'');
  }
  if(doc.dt==='collection')return 'Collection · '+(MA_COURIERS[doc.courier]||{name:doc.courier||'courier'}).name;
  return doc.dt;
}
function maDocText(doc,idx,partyName){
  return maNorm([doc.no,maDocTitle(doc,idx),partyName,doc.payee,doc.note,doc.date,
    doc.account&&maAccLabel(idx,doc.account),doc.holder&&maAccLabel(idx,doc.holder),
    doc.from&&maAccLabel(idx,doc.from),doc.to&&maAccLabel(idx,doc.to),doc.ref,doc.collectedBy,
    doc.refs&&Array.isArray(doc.refs.cprNos)?(doc.covers||[]).map(c=>c&&c.no).join(' '):'',(doc.tags||[]).join(' ')].join(' '));
}

/* ── The audit trail (§29) — one row per thing that happened ────────────── */
const MA_AUDIT_ACTIONS=['post','edit','void','confirm','review','party','terms','rate','item','commitment','settings','chart','export','share','revoke','enter','relock','attach','download','backup','dispute','rollup'];
function maAuditRow(action,target,meta){
  const m=meta||{};
  return {action:MA_AUDIT_ACTIONS.indexOf(action)>=0?action:'post',
    target:target?{dt:target.dt||null,id:target.id||null,no:target.no||null}:null,
    detail:maStr(m.detail,300),by:m.by||null,byName:m.byName||null,at:m.at||0};
}
/* Re-locking a quarter that was reopened (§20; M1.6a, security F3b). The
   close goes back to locked in the re-locker's name; the reopen it ends is
   kept in `reopens`, so clearing the three reopen fields loses nothing; and
   the audit row that says so — action `relock`, target {dt:'close', id: the
   quarter} — is written in the SAME batch under meta.auditId: the rules
   (maRelockOk) refuse a re-lock whose `relockAudit` row was not created by
   that very write. A close born unlocked (before the rules refused one) is
   re-locked the same way. No screen writes a close yet — the quarter lock
   arrives with M11; this and the rules are ready for it. → {patch, audit} */
function maCloseRelock(close,meta){
  const c=close||{},m=meta||{};
  const reopens=Array.isArray(c.reopens)?c.reopens.slice():[];
  if(c.reopenedAt!==undefined&&c.reopenedAt!==null)reopens.push({at:c.reopenedAt,by:c.reopenedBy,reason:c.reopenReason});
  return {
    patch:{locked:true,reopenedAt:null,reopenedBy:null,reopenReason:null,closedBy:m.by||null,closedAt:m.at||0,relockAudit:String(m.auditId||''),reopens},
    audit:maAuditRow('relock',{dt:'close',id:c.quarter||null,no:c.quarter||null},{by:m.by,byName:m.byName,at:m.at,detail:'Re-locked '+(c.quarter||'')+(maStr(m.reason)?' — '+maStr(m.reason,200):'')})
  };
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
  // The page's own rule (M1.6b, money F4/F5): no running balance under a
  // narrowing filter, nor for the drawer — whose balance is Store Accounts',
  // printed as that module has it, or "not read", the holder statement's way.
  const led=maLedger(x.lines,q,x.idx,x.settings);
  const a=maAcc(x.idx,code);
  const ix=_maPdfIndex(x);
  const filters=[];
  if(f.party){const p=_maPdfParty(x,f.party);filters.push('Party: '+(p?p.name:'Unknown party'));}
  if(f.dt)filters.push('Documents: '+(MA_DOC_TYPES[f.dt]?MA_DOC_TYPES[f.dt].label+'s':String(f.dt)));
  ['category','spendGroup','costCentre','source','kind'].forEach(k=>{if(f[k])filters.push(k.replace(/[A-Z]/g,c=>' '+c.toLowerCase()).replace(/^./,c=>c.toUpperCase())+': '+f[k]);});
  if(f.q)filters.push('Search: “'+maStr(f.q,60)+'”');
  const hid=led.balanceHidden;
  let mirrorBalance=null;
  if(hid&&hid.mirror){
    const h=(x.holders||maHolderRows(x.idx,x.lines,x.docs,{settings:x.settings})).find(y=>y.code===String(code))||null;
    mirrorBalance=h&&Number.isInteger(h.balance)?h.balance:null;
  }
  return {account:{code:String(code),name:a?a.name:String(code),type:a?a.type:'',normal:a?a.normal:'dr',holder:!!(a&&a.money)},
    range:{from:f.from||'',to:f.to||'',label:f.label||''},filters,
    opening:led.opening,closing:led.closing,totals:{dr:led.dr,cr:led.cr,count:led.count},
    balanceHidden:hid?{narrow:hid.narrow.slice(),mirror:hid.mirror,why:maLedgerHiddenWhy(hid),mirrorBalance}:null,
    rows:led.rows.map(l=>Object.assign(_maPdfRow(x,ix,l),{dr:l.dr,cr:l.cr,balance:hid?null:l.balance})),
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
  const led=maLedger(x.lines,{holder:code,from:r.from,to:r.to},x.idx,x.settings);
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
    // A slip that says "pending" never also prints a confirmation (money F6):
    // a document an old edit sent back to pending kept its confirmedBy.
    confirm:d.status!=='pending'&&d.confirmedBy?{by:_maPdfPerson(x,d.confirmedBy),at:d.confirmedAt||null,via:d.confirmVia||'app',forWho:d.confirmedFor?_maPdfPerson(x,d.confirmedFor):''}:null,
    printedOn:x.printedOn||'',printedBy:x.printedBy||''},_maPdfMarks(x,d));
}
/* ma-collection — a COLLECTION's receipt: the cash collected from a courier,
   the receipts (CPRs) it covers, what was expected, counted and the
   difference. Every figure is the document's own — `covers` is the snapshot
   taken when it was recorded, never re-read from today's receipts — so the
   paper cannot disagree with the books. state: pending · confirmed · posted
   (its recorder is the holder — nobody else had to confirm) · void. A
   courier with no CPRs (Blue-Ex, Bykea) has an empty `covers` and `legacy`
   or manual entry: the page then says so instead of printing an empty table. */
function maPdfCollectionData(x,d){
  if(!d||d.dt!=='collection')return null;
  const state=d.status==='void'?'void':d.status==='pending'?'pending':d.confirmedBy?'confirmed':'posted';
  const cr=MA_COURIERS[d.courier]||null;
  const covers=(Array.isArray(d.covers)?d.covers:[]).filter(c=>c&&typeof c==='object').map(c=>({
    no:String(c.no||c.id||''),date:String(c.date||''),net:Number.isInteger(c.net)?c.net:0}));
  return Object.assign({no:d.no||'',date:d.date||'',amount:d.amount,amountWords:maRsWords(d.amount),
    courier:{key:String(d.courier||''),name:cr?cr.name:String(d.courier||'')},
    holder:_maPdfSide(x,d.holder),collectedBy:String(d.collectedBy||''),
    covers,expected:Number.isInteger(d.expected)?d.expected:0,
    difference:Number.isInteger(d.difference)?d.difference:null,
    note:d.note||'',state,
    waitingFor:d.status==='pending'?_maPdfPerson(x,d.confirmBy):'',paper:!!d.confirmPaper,
    // As the receipt: a slip that says "pending" never also prints a confirmation.
    confirm:d.status!=='pending'&&d.confirmedBy?{by:_maPdfPerson(x,d.confirmedBy),at:d.confirmedAt||null,via:d.confirmVia||'app',forWho:d.confirmedFor?_maPdfPerson(x,d.confirmedFor):''}:null,
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
const MA_SHARE_MAX_DAYS=90;
const MA_SHARE_SKEW_MS=5*60*1000;
function maShareState(sh,nowMs){
  if(!sh||typeof sh!=='object')return 'unknown';
  if(sh.revoked===true)return 'revoked';
  if(sh.revoked!==false)return 'unknown';
  // The rest is netlify/functions/ma-share.js's shareState, check for check
  // (M1.6b): a record the function would answer "not found" to is not
  // "live" here, whatever its expiry says.
  const made=sh.createdAt,exp=sh.expiresAt;
  if(!Number.isFinite(made)||!Number.isFinite(exp))return 'unknown';
  if(Number.isFinite(nowMs)&&made>nowMs+MA_SHARE_SKEW_MS)return 'unknown';
  if(exp<=made||exp-made>MA_SHARE_MAX_DAYS*86400000+MA_SHARE_SKEW_MS)return 'unknown';
  const type=sh.deliveryType;
  const rt=sh.resourceType===undefined||sh.resourceType===null||sh.resourceType===''?'image':sh.resourceType;
  const fmt=typeof sh.format==='string'?sh.format.toLowerCase():'';
  if((type!=='authenticated'&&type!=='upload')||rt!=='image'||!maAttachPidOk(sh.pdfPublicId,type)||fmt!=='pdf')return 'unknown';
  return Number.isFinite(nowMs)&&nowMs>=exp?'expired':'live';
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
  'ma_journal','ma_transfer','ma_counts','ma_cpr','ma_collection','ma_closes','ma_audit','ma_backups','ma_runs','ma_shares','ma_feedback'];
// ma_cpr, ma_collection and ma_runs joined with the rules that let an owner
// read them (M2.4). Until those rules are PUBLISHED a read of them is
// refused, and the download says so by name — ma_cpr and ma_collection
// post, so it then says the postings leave them out.
// The postings and the trial balance are built from these; without one of
// them they are not the whole book, and they say so.
const _maBookCore=['ma_settings','ma_accounts','ma_journal','ma_transfer','ma_counts','ma_cpr','ma_collection'];
/* A share link's token IS its document id, and whoever holds it can open
   the PDF while it is live: the books carry the link's state in its place,
   never the token (M1.6b). */
function maBooksNoTokens(cols,nowMs){
  const out=Object.assign({},cols||{});
  if(Array.isArray(out.ma_shares))out.ma_shares=out.ma_shares.map(x=>({id:'withheld — '+({live:'live',expired:'expired',revoked:'withdrawn'}[maShareState(x&&x.data,nowMs)]||'not valid'),data:Object.assign({},x&&x.data||{})}));
  return out;
}
function maBooksJson(o){
  const cols=maBooksNoTokens(o&&o.cols,o&&o.at),failed=o&&o.failed||[];
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
  const cols=maBooksNoTokens(o.cols,o.at),failed=o.failed||[];
  const when=typeof o.when==='function'?o.when:(ms=>ms);
  const of=c=>(cols[c]||[]).map(x=>Object.assign({},x.data||{},{id:x.data&&x.data.id!==undefined?x.data.id:x.id}));
  const main=(cols.ma_settings||[]).find(x=>x.id==='main');
  const s=maSettings(main?main.data:null);
  const idx=maChartIndex(maChart('groovy',of('ma_accounts')));
  const docs=of('ma_journal').map(d=>Object.assign({dt:'journal'},d)).concat(
    of('ma_transfer').map(d=>Object.assign({dt:'transfer'},d)),of('ma_counts').map(d=>Object.assign({dt:'count'},d)),
    of('ma_cpr').map(d=>Object.assign({dt:'cpr'},d)),of('ma_collection').map(d=>Object.assign({dt:'collection'},d)));
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

/* ── Couriers (§4.2 `courier`, §8) — M2 ──────────────────────────────────
   Each courier's cycle (one of MA_COURIER_CYCLES) and the accounts its money
   moves through. Every code is one MA_CHART already has, and
   tests/ma-couriers.test.js fails if one is missing or is not the type its
   role needs:
     receivable   delivered parcels no statement covers yet — PostEx 1120 ·
                  TCS 1122 · Blue-Ex 1123 · Bykea 1124
     statement    a statement issued and not yet collected: PostEx's CPRs, 1121
     wallet       money that is ours and sits at the courier: TCS, 1060 (a
                  holder, shipped switched off until M2)
     collectInto  the holder a collection reaches when no owner takes it:
                  Bykea's reaches the drawer, 1010, and waits for Raees (§3 #8)
                  — who confirms is MA_HANDS', not a field here
     revenue      4010 Online — COD. §4.1 gives it "sub-accounts per courier";
                  MA_CHART has none, so until the owners add them a courier's
                  revenue is told apart by its postings' party label (§27)
     fees         5060 Courier fees & tax · reversals 5070 Reversals & returns
     difference   9030 Reconciliation differences: a collection that is not
                  its statement's net (§8)
   The numbers a cycle runs on stay in the settings (cprDays, tcsCreditDays),
   where the owners change them. Nothing here posts. */
const MA_COURIERS=(o=>{Object.keys(o).forEach(k=>{Object.freeze(o[k].accounts);Object.freeze(o[k]);});return Object.freeze(o);})({
  postex:{key:'postex',name:'PostEx',cycle:'cpr',feed:'postex_orders',
    accounts:{receivable:'1120',statement:'1121',revenue:'4010',fees:'5060',reversals:'5070',difference:'9030'}},
  tcs:{key:'tcs',name:'TCS',cycle:'account',
    accounts:{receivable:'1122',wallet:'1060',revenue:'4010',fees:'5060',reversals:'5070',difference:'9030'}},
  bluex:{key:'bluex',name:'Blue-Ex',cycle:'legacy',
    accounts:{receivable:'1123',revenue:'4010',fees:'5060',reversals:'5070',difference:'9030'}},
  bykea:{key:'bykea',name:'Bykea',cycle:'manual',
    accounts:{receivable:'1124',collectInto:'1010',revenue:'4010',fees:'5060',reversals:'5070',difference:'9030'}}
});

/* ── PostEx: parcels into CPRs, days, and what is still owed (§8) — M2 ────
   `postex_orders` holds one record per parcel (netlify/lib/postex-core.js
   `normalize`), refreshed every 4 hours for 14 days after booking, and —
   once PostEx has paid for it — the numbers of the two receipts it was paid
   on (`enrichPayments`): cprNumber_1 the UPFRONT receipt, dated cpr1Date,
   and cprNumber_2 the RESERVE receipt, dated cpr2Date. A CPR is DERIVED from
   them and never typed (§3 #5): one per receipt NUMBER, whichever part of
   whichever parcels it pays. Derivation only — nothing here posts. The
   owners decided on 29 Sept 2026 that PostEx income is booked on the day
   PostEx marks a parcel delivered; the postings that follow from it, fed by
   `days` below, are the next piece of M2.

   What a parcel is worth to its receipts is decided ONCE, in
   _maCprSplitPaisa, and read by maCprNet, the transit snapshot and the
   opening alike — §8's one definition, ending the two nets of
   js/fulfillment.js (§1). UNVERIFIED until one CPR PDF is held against it
   (§24):
     share    delivered: cod − transactionFee − transactionTax; returned:
              −(reversalFee + reversalTax). DECIDED FROM THE FIELDS, not from a
              PDF: postex-core writes a return's charge in two fields of its
              own (reversalFee, reversalTax) beside the forward ones, the COD
              tab (_postexCOD) charges a return exactly those, and a returned
              parcel collects no COD for a forward charge to come out of. The
              CPR tab (js/fulfillment.js _postexCPRs) nets a return by its
              forward transactionFee + transactionTax instead; that is not
              followed here. If a real CPR PDF shows PostEx deducts the
              forward charge on a return, the one place to change is the
              charge figures below — `days` reads the same figures.
     charges  what the share deducts, per parcel, and ONLY that: a delivered
              parcel's transactionFee + transactionTax, a returned parcel's
              reversalFee + reversalTax. `days` books exactly these, so when
              every receipt is in and PostEx's own part figures agree with the
              share, the days' COD less charges equals the receipts' nets and
              the PostEx receivable (1120) clears to zero.
     upfront  its upfrontPayment: what the upfront receipt paid for it.
     reserve  its reservePayment: what the reserve receipt paid. Not
              balancePayment — postex-core reads the reserve receipt's date as
              cpr2Date || reservePaymentDate (PostEx's documentation names the
              second receipt after the reserve payment), and nothing in the
              code pairs balancePayment with a receipt or a date.
   A figure PostEx did not send falls back to the share, less what the other
   part carries, so no parcel is counted twice; with neither figure the whole
   share goes on its first receipt (the upfront, else the reserve). When
   PostEx sent BOTH figures and they do not add up to the share, the receipts
   carry PostEx's figures and the difference is named (cpr.split_mismatch) —
   it is exactly what would stop 1120 clearing, so it is never absorbed.
   A returned parcel may be paid on ONE receipt (postex-core finishes a return
   once PostEx marks it settled): its whole share is on that receipt, so it is
   owed nothing more and waits for no second one. A parcel PostEx marks
   settled (settle === true; a missing settle means not settled) waits for
   nothing either — unless the split still expects money on a receipt it
   does not carry, which stays owed: a settle never excuses an amount. On a
   receipt a 0 is what PostEx paid. BEFORE its receipt a 0 is read as not
   sent yet: postex-core stores an amount PostEx did not send as 0 (`num`),
   and an expected ₨0 on a delivered parcel would hide what PostEx owes.
   Money is added up to the paisa and rounded once, to whole rupees, with
   Math.round — as maPost rounds every amount it posts. */
/* A receipt number longer than this is not one: an id escaped from it could
   pass Firestore's 1,500 bytes, and no receipt is numbered like that. */
const MA_CPR_NUMBER_MAX=100;
/* How long after booking the scheduled sync keeps refreshing a parcel —
   netlify/functions/postex-sync-background.js's LOOKBACK_DAYS, held equal by
   tests/ma-couriers.test.js. A parcel still on the road past it may be stale. */
const MA_POSTEX_SYNC_DAYS=14;
/* Every data issue the derivation raises, by its stable name. */
const MA_CPR_ISSUE_RULES=['derive.opts','parcel.no_tracking','parcel.duplicate','parcel.status_unknown',
  'parcel.date_fallback','parcel.date_missing','parcel.future_date','parcel.long_on_road','parcel.paid_before_books',
  'cpr.number_bad','cpr.field_missing','cpr.zero_part','cpr.date_disagree','cpr.date_fallback','cpr.date_missing',
  'cpr.not_final','cpr.return_paid','cpr.reserve_before_upfront','cpr.reserve_without_upfront','cpr.split_mismatch'];
const _maPxStatuses=['pending','in_transit','delivered','returned','cancelled'];   // what postex-core's statusCategory writes

function _maCmp(a,b){return a<b?-1:a>b?1:0;}
function _maPl(n,word){return n+' '+word+(n===1?'':'s');}
/* A number PostEx sent, or null: a finite number, or a string holding one. */
function _maPxNum(v){
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  return typeof v==='string'&&/^\s*-?\d+(\.\d+)?\s*$/.test(v)?Number(v):null;
}
function _maPaisa(v){const n=_maPxNum(v);return n===null?0:Math.round(n*100);}
function _maWhole(paisa){const r=Math.round(paisa/100);return r===0?0:r;}   // whole rupees, never −0
/* A day from a PostEx date string ("2026-07-16T…"): its first ten
   characters, read as the local day the way js/fulfillment.js reads them;
   '' for anything else. */
function _maPxDay(v){if(typeof v!=='string')return '';const d=v.trim().slice(0,10);return maIsDay(d)?d:'';}
/* A tracking or receipt number: text, trimmed; '' for none. */
function _maPxStr(v){return typeof v==='string'?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):'';}
function _maCprNo(v){const s=_maPxStr(v);return s.length<=MA_CPR_NUMBER_MAX?s:'';}
/* A short fingerprint of a string — two 32-bit FNV-style passes — for
   noticing a change, never for security. */
function _maHash(s){
  let a=0x811c9dc5,b=0x9e3779b9;
  for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x85ebca6b);b^=b>>>13;}
  return (a>>>0).toString(36)+'.'+(b>>>0).toString(36);
}
function _maCprIssue(rule,message,receipts,parcels){
  const u=l=>Array.from(new Set((l||[]).map(String))).sort(_maCmp);
  return {rule,message,refs:{receipts:u(receipts),parcels:u(parcels)}};
}

/* One part of a Firestore document id, from any text: [A-Za-z0-9-] kept,
   every other UTF-16 unit (`_` included) written as `_` and four hex digits,
   and the empty text as a lone `_`. Every escape is exactly five characters
   and `_` only ever opens one, so an id reads back to ONE text: two different
   receipt numbers never share an id (a plain strip would make "CPR 1/2" and
   "CPR-12" one receipt). No `.`, no `__`, never empty — none of Firestore's
   forbidden ids can come out of it. */
function maIdSafe(s){
  const t=String(s===undefined||s===null?'':s);
  if(!t)return '_';
  let out='';
  for(let i=0;i<t.length;i++){
    const c=t.charAt(i);
    out+=/[A-Za-z0-9-]/.test(c)?c:'_'+('000'+t.charCodeAt(i).toString(16)).slice(-4);
  }
  return out;
}
/* The id of a courier's receipt: 'postex-CPR-118842'. A courier key is
   letters only (MA_COURIERS), so the first `-` always ends it. */
function maCprId(courier,number){return maIdSafe(courier)+'-'+maIdSafe(number);}

/* What one parcel is worth and how it splits between its two receipts, in
   PAISA (the header above says why each figure is what it is). `fieldU` /
   `fieldR`: the part is PostEx's own figure, not the fallback. */
function _maCprSplitPaisa(p){
  p=p||{};
  const st=p.statusCategory,del=st==='delivered',ret=st==='returned';
  // The figures the share is made of — the ONLY charges it deducts (header).
  const cod=del?_maPaisa(p.cod):0,fee=del?_maPaisa(p.transactionFee):0,tax=del?_maPaisa(p.transactionTax):0;
  const rfee=ret?_maPaisa(p.reversalFee):0,rtax=ret?_maPaisa(p.reversalTax):0;
  const share=(cod-fee-tax-rfee-rtax)||0;
  const paidU=!!_maCprNo(p.cprNumber_1),paidR=!!_maCprNo(p.cprNumber_2);
  const known=(v,paid)=>{const n=_maPxNum(v);return n===null||(n===0&&!paid)?null:Math.round(n*100);};
  const u=known(p.upfrontPayment,paidU),r=known(p.reservePayment,paidR);
  const first=paidU||!paidR;
  return {cod,fee,tax,rfee,rtax,share,paidU,paidR,fieldU:u!==null,fieldR:r!==null,
    upfront:(u!==null?u:r!==null?share-r:first?share:0)||0,
    reserve:(r!==null?r:u!==null?share-u:first?0:share)||0};
}
/* The same in rupees — to the paisa: a parcel is an input, not a figure of
   the books — with where each part came from: 'field' (PostEx's own figure)
   or 'computed' (the share, less the other part). */
function maCprSplit(p){
  const s=_maCprSplitPaisa(p);
  return {share:s.share/100,upfront:s.upfront/100,reserve:s.reserve/100,
    basis:{upfront:s.fieldU?'field':'computed',reserve:s.fieldR?'field':'computed'}};
}
/* One record per tracking number (§6: a parcel is never doubled). A number
   the input holds twice keeps ONE copy — the one checked for its receipts
   most recently (cprCheckedAt), then synced most recently (syncedAt), then
   the larger by content — so the copy kept never depends on the order the
   records came in. → {list:[{t,p}] by tracking number, dups:{t:[copies]},
   untracked:how many records carry no tracking number} */
function _maPxUnique(parcels){
  const by=Object.create(null);let untracked=0;
  (Array.isArray(parcels)?parcels:[]).forEach(p=>{
    const t=p&&typeof p==='object'?_maPxStr(p.trackingNumber):'';
    if(!t){untracked++;return;}
    (by[t]||(by[t]=[])).push(p);
  });
  const dups=Object.create(null);
  const when=(p,k)=>{const n=_maPxNum(p[k]);return n===null?-1:n;};
  const list=Object.keys(by).sort(_maCmp).map(t=>{
    const c=by[t];
    if(c.length===1)return {t,p:c[0]};
    dups[t]=c;
    return {t,p:c.slice().sort((a,b)=>when(b,'cprCheckedAt')-when(a,'cprCheckedAt')||when(b,'syncedAt')-when(a,'syncedAt')||_maCmp(_maCanon(b),_maCanon(a)))[0]};
  });
  return {list,dups,untracked};
}

/* What ONE receipt is worth (§8) — THE definition: maCprDerive nets every
   CPR through it, and so must anything else that ever nets one. `cpr` =
   {number, parcels}: the parcels may be all of them — the ones naming
   `number` as their upfront or reserve receipt are its parcels, each part the
   sum of their split, rounded to whole rupees; net is the two parts.
   → {number, net, parts:{upfront:{parcels,amount}, reserve:{parcels,amount}},
   issues}. UNVERIFIED against a real CPR PDF (§24). */
function maCprNet(cpr){
  const c=cpr||{},number=_maCprNo(c.number);
  const out={number,net:0,parts:{upfront:{parcels:[],amount:0},reserve:{parcels:[],amount:0}},issues:[]};
  if(!number)return out;
  const acc={upfront:{sum:0,share:0,zero:true,miss:[],missSum:0},reserve:{sum:0,share:0,zero:true,miss:[],missSum:0}};
  _maPxUnique(c.parcels).list.forEach(x=>{
    const p=x.p,s=_maCprSplitPaisa(p);
    [['upfront',p.cprNumber_1,s.upfront,s.fieldU],['reserve',p.cprNumber_2,s.reserve,s.fieldR]].forEach(([k,no,amt,field])=>{
      if(_maCprNo(no)!==number)return;
      const a=acc[k];
      out.parts[k].parcels.push(x.t);
      a.sum+=amt;a.share+=s.share;
      if(!field){a.miss.push(x.t);a.missSum+=amt;}
      if(!field||amt!==0)a.zero=false;
    });
  });
  ['upfront','reserve'].forEach(k=>{
    const a=acc[k],part=out.parts[k],n=a.miss.length,field=k==='upfront'?'upfrontPayment':'reservePayment';
    part.amount=_maWhole(a.sum);
    if(n)out.issues.push(_maCprIssue('cpr.field_missing',_maPl(n,'parcel')+' on PostEx receipt '+number+' '+(n===1?'has':'have')+' no '+k+' payment on record ('+field+') — '+(n===1?'it is':'each is')+' counted at what '+(n===1?'its':'their')+' COD and PostEx’s charges make '+(n===1?'it':'them')+' worth, less anything '+(n===1?'its':'their')+' other receipt carries: '+maRs(_maWhole(a.missSum))+' in all. Check it against the receipt’s PDF.',[number],a.miss));
    if(part.parcels.length&&a.zero&&_maWhole(a.share)!==0)
      out.issues.push(_maCprIssue('cpr.zero_part','Every parcel on the '+k+' side of PostEx receipt '+number+' shows ₨0 ('+field+'), though '+(part.parcels.length===1?'its':'their')+' COD and charges come to '+maRs(_maWhole(a.share))+'. If PostEx paid '+(part.parcels.length===1?'it':'them')+' on this receipt, the amount never reached the sync — it stores an amount PostEx did not send as 0, and stops refreshing a parcel '+MA_POSTEX_SYNC_DAYS+' days after booking. The receipt counts ₨0 until it arrives.',[number],part.parcels));
  });
  out.net=out.parts.upfront.amount+out.parts.reserve.amount;
  return out;
}

/* The day a parcel reached its end — delivered, or back with us — and the
   field that said so. Delivered: orderDeliveryDate, else the day it was
   picked up, else booked. Returned: orderDeliveryDate too — an ASSUMPTION
   (PostEx is taken to date a parcel's last event there, a return as much as
   a delivery; no real return was checked) — else the day PostEx charged it
   on a receipt (the earlier of its two), else pickup, else booking.
   → {day, basis}, both '' when there is none. */
function _maPxFinalDay(p){
  const st=p.statusCategory;
  if(st!=='delivered'&&st!=='returned')return {day:'',basis:''};
  const c1=_maPxDay(p.cpr1Date),c2=_maPxDay(p.cpr2Date);
  const tries=[['orderDeliveryDate',_maPxDay(p.orderDeliveryDate)]]
    .concat(st==='returned'?[['receipt',c1&&c2?(c1<c2?c1:c2):c1||c2]]:[])
    .concat([['orderPickupDate',_maPxDay(p.orderPickupDate)],['transactionDate',_maPxDay(p.transactionDate)]]);
  for(let i=0;i<tries.length;i++)if(tries[i][1])return {day:tries[i][1],basis:tries[i][0]};
  return {day:'',basis:''};
}
/* A receipt's date, from its parcels: the day most of them carry for it
   (cpr1Date on its upfront side, cpr2Date on its reserve side); on a tie the
   later. With none of those, upfrontPaymentDate and settlementDate stand in
   (`fallback`). → {date, votes:{day:n}} */
function _maCprDate(e){
  const tally=(v,list,key)=>{list.forEach(x=>{const d=_maPxDay(x.p[key]);if(d)v[d]=(v[d]||0)+1;});return v;};
  let votes=tally(tally(Object.create(null),e.u,'cpr1Date'),e.r,'cpr2Date'),fallback=false;
  if(!Object.keys(votes).length){votes=tally(tally(Object.create(null),e.u,'upfrontPaymentDate'),e.r,'settlementDate');fallback=true;}
  let date='';
  Object.keys(votes).sort(_maCmp).forEach(d=>{if(!date||votes[d]>=votes[date])date=d;});
  return {date,votes,fallback:fallback&&!!date};
}
/* The receipt's figures as one string: the same parcels in any order give
   the same sig, and a figure that changes changes it — so the nightly rollup
   writes only the receipts that moved. Which parcels each part covers is in
   it as a fingerprint of the list, so a swap that leaves every figure equal
   still reads as a change. */
function _maCprSig(c){
  const u=c.parts.upfront,r=c.parts.reserve;
  return JSON.stringify(['v1',c.number,c.date,c.kind,u.parcels.length,u.amount,_maHash(JSON.stringify(u.parcels)),
    r.parcels.length,r.amount,_maHash(JSON.stringify(r.parcels)),c.grossCod,c.deliveryFee,c.deliveryTax,
    c.reversalFee,c.reversalTax,c.delivered,c.returned,c.net,c.settled?1:0]);
}
function _maPxBuckets(){return {road:{n:0,cod:0},up:{n:0,ret:0,amt:0,after:0},res:{n:0,ret:0,amt:0}};}
function _maPxBucketsOut(b,asOf){
  const onRoad={parcels:b.road.n,cod:_maWhole(b.road.cod)};
  const awaitingUpfront={parcels:b.up.n,returned:b.up.ret,amount:_maWhole(b.up.amt),reserveAfter:_maWhole(b.up.after)};
  const awaitingReserve={parcels:b.res.n,returned:b.res.ret,amount:_maWhole(b.res.amt)};
  return {asOf,onRoad,awaitingUpfront,awaitingReserve,owed:awaitingUpfront.amount+awaitingUpfront.reserveAfter+awaitingReserve.amount};
}

/* Every PostEx receipt, every day, and what PostEx still owes — derived from
   the parcels alone. PURE: `opts.from` (the day the books start) and
   `opts.today` are 'YYYY-MM-DD' strings the caller supplies; nothing here
   reads a clock. → {cprs, days, transit, opening, excluded, issues}:
     cprs      one per receipt NUMBER dated on or after `from`, or with no
               date (it cannot be placed before the books): {id, courier,
               number, date, kind: upfront|reserve|mixed, parts, grossCod,
               deliveryFee, deliveryTax, reversalFee, reversalTax, delivered,
               returned, net, settled, sig}. The COD, fees, reversals and
               counts DESCRIBE the receipt's parcels, to check it against
               PostEx's PDF, so a parcel paid on two receipts is described on
               both: never add them up across receipts. Money is `net` (each
               parcel's part once), and the P&L's figures are `days`.
     days      from `from` to `today`, one row per day a parcel ended on:
               how many were delivered and returned, delivered parcels' COD,
               fee and tax by delivery day, returned parcels' reversal fee and
               tax by their best date (_maPxFinalDay) — each parcel once, and
               charged exactly what its share deducts (the header), so the
               days' COD less charges and the receipts' nets are one sum.
               Income is booked on the day PostEx marks a parcel delivered
               (the owners' decision, 29 Sept 2026), so these rows are what
               the income and courier-cost postings will be made from.
     transit   as the parcels stand NOW (a status cannot be rewound), `asOf`
               today: onRoad (dispatched, not delivered or returned: count,
               COD) · awaitingUpfront (delivered or returned with no upfront
               receipt: count, the upfront expected, and the reserve those
               parcels will still bring after it) · awaitingReserve (upfront
               received, reserve not: count, the reserve expected) · owed,
               the three amounts together. A parcel on a receipt with nothing
               left to come waits for nothing when PostEx marks it settled or
               it is a return.
     opening   the same buckets at the START of `from` — what PostEx owed
               when the books start: with from '2026-07-01', the PostEx part
               of the 1 July 2026 opening balance. Parcels delivered or
               returned before `from`, a part counted owed unless its receipt
               is dated before `from`. onRoad here is COD that was on the road
               that morning (sent before `from`, not ended before it) — its
               income falls inside the books, so it is information, not owed.
               Money a receipt dated before `from` already paid on such a
               parcel is not netted here: it is named (parcel.paid_before_books).
     excluded  the receipts dated before `from`: how many, their parcels,
               their net, the first and last day, their numbers — and `list`,
               each one on its own ({id, number, date, net, kind, parts}, by
               date then number), so a receipt dated just before the books
               start (30 June 2026 was a Tuesday, a CPR day) can still be
               collected against the opening.
     issues    [{rule, message, refs:{receipts, parcels}}] — the rules are
               MA_CPR_ISSUE_RULES.
   Every list is sorted, so the same parcels in any order give the same
   answer, `sig` and all. */
function maCprDerive(parcels,opts){
  const o=opts||{},from=o.from,today=o.today;
  const out={cprs:[],days:[],transit:null,opening:null,
    excluded:{receipts:0,parcels:0,net:0,first:'',last:'',numbers:[],list:[]},issues:[]};
  const issue=(rule,message,receipts,ps)=>out.issues.push(_maCprIssue(rule,message,receipts,ps));
  const pl=(n,one,many)=>n===1?one:many;
  if(!maIsDay(from)||!maIsDay(today)||from>today){
    issue('derive.opts','PostEx receipts are derived between two real days — the day the books start (from) and today — and from cannot be after today.');
    out.transit=_maPxBucketsOut(_maPxBuckets(),maIsDay(today)?today:'');
    out.opening=_maPxBucketsOut(_maPxBuckets(),maIsDay(from)?from:'');
    return out;
  }
  const u=_maPxUnique(parcels);
  if(u.untracked)issue('parcel.no_tracking',_maPl(u.untracked,'record')+' in postex_orders '+pl(u.untracked,'carries','carry')+' no tracking number — '+pl(u.untracked,'it','they')+' cannot be told apart from any other parcel, so '+pl(u.untracked,'it is','they are')+' in no figure.');
  Object.keys(u.dups).sort(_maCmp).forEach(t=>{
    const copies=u.dups[t],nos=[],pairs=[];
    copies.forEach(p=>{
      const a=_maCprNo(p.cprNumber_1),b=_maCprNo(p.cprNumber_2),k=a+' / '+b;
      if(pairs.indexOf(k)<0)pairs.push(k);
      [a,b].forEach(n=>{if(n&&nos.indexOf(n)<0)nos.push(n);});
    });
    issue('parcel.duplicate','Tracking number '+t+' is in postex_orders '+copies.length+' times. One copy is counted — the one checked for its receipts most recently.'+(pairs.length>1?' The copies name different receipts ('+pairs.sort(_maCmp).map(k=>k.replace(/^ \/ | \/ $/g,'')||'none').join('; ')+') — check which is right.':''),nos,[t]);
  });

  // Each parcel once, with what every figure below needs.
  const P=u.list.map(x=>{
    const p=x.p,r1=_maPxStr(p.cprNumber_1),r2=_maPxStr(p.cprNumber_2),st=p.statusCategory;
    return {t:x.t,p,st,final:st==='delivered'||st==='returned',
      n1:r1.length<=MA_CPR_NUMBER_MAX?r1:'',n2:r2.length<=MA_CPR_NUMBER_MAX?r2:'',
      bad:[r1,r2].filter(r=>r.length>MA_CPR_NUMBER_MAX),
      s:_maCprSplitPaisa(p),f:_maPxFinalDay(p),
      sent:_maPxDay(p.orderPickupDate)||_maPxDay(p.transactionDate),
      booked:_maPxDay(p.transactionDate)||_maPxDay(p.orderPickupDate)};
  });
  const odd=P.filter(x=>_maPxStatuses.indexOf(x.st)<0);
  if(odd.length)issue('parcel.status_unknown',_maPl(odd.length,'parcel')+' '+pl(odd.length,'carries','carry')+' a status the sync does not write ('+Array.from(new Set(odd.map(x=>String(x.st)))).sort(_maCmp).join(', ')+') — '+pl(odd.length,'it counts','they count')+' as neither delivered nor returned.',[],odd.map(x=>x.t));
  const badBy=Object.create(null);
  P.forEach(x=>x.bad.forEach(r=>{(badBy[r]||(badBy[r]=[])).push(x.t);}));
  Object.keys(badBy).sort(_maCmp).forEach(r=>{const n=new Set(badBy[r]).size;
    issue('cpr.number_bad','A receipt number '+r.length+' characters long (“'+r.slice(0,40)+'…”) is not one — the '+_maPl(n,'parcel')+' naming it '+pl(n,'counts','count')+' as not yet on that receipt.',[],badBy[r]);});

  // The receipts: one per number, netted by maCprNet.
  const R=Object.create(null);
  const rec=n=>R[n]||(R[n]={u:[],r:[]});
  P.forEach(x=>{if(x.n1)rec(x.n1).u.push(x);if(x.n2)rec(x.n2).r.push(x);});
  const all=Object.keys(R).sort(_maCmp).map(n=>{
    const e=R[n],seen=Object.create(null),union=[];
    e.u.concat(e.r).forEach(x=>{if(!seen[x.t]){seen[x.t]=1;union.push(x);}});
    union.sort((a,b)=>_maCmp(a.t,b.t));
    const net=maCprNet({number:n,parcels:union.map(x=>x.p)});
    net.issues.forEach(i=>out.issues.push(i));
    const d=_maCprDate(e),days=Object.keys(d.votes).sort(_maCmp);
    if(days.length>1)issue('cpr.date_disagree','The '+_maPl(union.length,'parcel')+' on PostEx receipt '+n+' name '+days.length+' dates for it — '+days.map(x=>maDayLabel(x,true)+' ('+d.votes[x]+')').join(', ')+'. It is dated '+maDayLabel(d.date,true)+', the date most of them carry (on a tie, the later).',[n],union.map(x=>x.t));
    if(d.fallback)issue('cpr.date_fallback','No parcel on PostEx receipt '+n+' carries its date (cpr1Date, cpr2Date) — it is dated '+maDayLabel(d.date,true)+' from their payment dates (upfrontPaymentDate, settlementDate).',[n],union.map(x=>x.t));
    if(!d.date)issue('cpr.date_missing','PostEx receipt '+n+' has no date on any of its parcels — it is counted, but it cannot be placed before or after the day the books start.',[n],union.map(x=>x.t));
    const tot={cod:0,fee:0,tax:0,rfee:0,rtax:0,del:0,ret:0};
    union.forEach(x=>{const s=x.s;
      if(x.st==='delivered')tot.del++;else if(x.st==='returned')tot.ret++;
      tot.cod+=s.cod;tot.fee+=s.fee;tot.tax+=s.tax;tot.rfee+=s.rfee;tot.rtax+=s.rtax;
    });
    const early=union.filter(x=>!x.final);
    if(early.length)issue('cpr.not_final',_maPl(early.length,'parcel')+' on PostEx receipt '+n+' '+pl(early.length,'is','are')+' neither delivered nor returned ('+Array.from(new Set(early.map(x=>String(x.st)))).sort(_maCmp).join(', ')+') — PostEx paid for '+pl(early.length,'it before it','them before they')+' arrived, or '+pl(early.length,'its','their')+' status went back since.',[n],early.map(x=>x.t));
    let back=0;const backT=[];
    union.forEach(x=>{if(x.st!=='returned')return;const a=(x.n1===n?x.s.upfront:0)+(x.n2===n?x.s.reserve:0);if(a>0){back+=a;backT.push(x.t);}});
    if(backT.length)issue('cpr.return_paid',_maPl(backT.length,'returned parcel')+' on PostEx receipt '+n+' '+pl(backT.length,'was','were')+' paid '+maRs(_maWhole(back))+' on it as if delivered — COD nobody collected. Expect PostEx to take it back on a later receipt.',[n],backT);
    const up=net.parts.upfront,rs=net.parts.reserve;
    const c={id:maCprId('postex',n),courier:'postex',number:n,date:d.date,
      kind:up.parcels.length&&rs.parcels.length?'mixed':up.parcels.length?'upfront':'reserve',
      parts:net.parts,grossCod:_maWhole(tot.cod),deliveryFee:_maWhole(tot.fee),deliveryTax:_maWhole(tot.tax),
      reversalFee:_maWhole(tot.rfee),reversalTax:_maWhole(tot.rtax),delivered:tot.del,returned:tot.ret,
      net:net.net,settled:union.every(x=>x.p.settle===true),sig:''};
    c.sig=_maCprSig(c);
    return c;
  });
  const dateOf=Object.create(null),before=Object.create(null),excl=[];
  all.forEach(c=>{dateOf[c.number]=c.date;if(c.date&&c.date<from){before[c.number]=1;excl.push(c);}else out.cprs.push(c);});
  out.cprs.sort((a,b)=>_maCmp(a.date||'~',b.date||'~')||_maCmp(a.number,b.number));
  if(excl.length){
    const seen=Object.create(null);let n=0;
    excl.forEach(c=>[c.parts.upfront.parcels,c.parts.reserve.parcels].forEach(l=>l.forEach(t=>{if(!seen[t]){seen[t]=1;n++;}})));
    const ds=excl.map(c=>c.date).sort(_maCmp);
    const list=excl.slice().sort((a,b)=>_maCmp(a.date,b.date)||_maCmp(a.number,b.number))
      .map(c=>({id:c.id,number:c.number,date:c.date,net:c.net,kind:c.kind,parts:c.parts}));
    out.excluded={receipts:excl.length,parcels:n,net:excl.reduce((t,c)=>t+c.net,0),first:ds[0],last:ds[ds.length-1],
      numbers:excl.map(c=>c.number).sort(_maCmp),list};
  }
  const pairs=Object.create(null);
  P.forEach(x=>{
    if(!x.n1||!x.n2||x.n1===x.n2)return;
    const du=dateOf[x.n1],dr=dateOf[x.n2];
    if(du&&dr&&dr<du){const k=JSON.stringify([x.n1,x.n2]);(pairs[k]||(pairs[k]=[])).push(x.t);}
  });
  Object.keys(pairs).sort(_maCmp).forEach(k=>{const ab=JSON.parse(k),a=ab[0],b=ab[1];
    issue('cpr.reserve_before_upfront','PostEx reserve receipt '+b+' ('+maDayLabel(dateOf[b],true)+') is dated before upfront receipt '+a+' ('+maDayLabel(dateOf[a],true)+') for '+_maPl(pairs[k].length,'parcel')+' — a reserve is released after its upfront, so one of the two dates looks wrong.',[a,b],pairs[k]);});
  const onlyR=P.filter(x=>x.n2&&!x.n1&&x.st!=='returned');   // a return may be paid on one receipt (header)
  if(onlyR.length)issue('cpr.reserve_without_upfront',_maPl(onlyR.length,'parcel')+' '+pl(onlyR.length,'was','were')+' paid on a reserve receipt with no upfront receipt — '+pl(onlyR.length,'its','their')+' upfront part counts under “no upfront receipt yet” ('+maRs(_maWhole(onlyR.reduce((t,x)=>t+x.s.upfront,0)))+' expected).',onlyR.map(x=>x.n2),onlyR.map(x=>x.t));

  // PostEx's own two part figures against the share they should add up to.
  const mis=P.filter(x=>x.s.fieldU&&x.s.fieldR&&x.s.upfront+x.s.reserve!==x.s.share);
  if(mis.length){
    const diff=mis.reduce((t,x)=>t+x.s.upfront+x.s.reserve-x.s.share,0),nos=[];
    mis.forEach(x=>[x.n1,x.n2].forEach(n=>{if(n&&nos.indexOf(n)<0)nos.push(n);}));
    issue('cpr.split_mismatch',_maPl(mis.length,'parcel')+' '+pl(mis.length,'carries','carry')+' PostEx upfront and reserve payments (upfrontPayment, reservePayment) that do not add up to '+pl(mis.length,'its','their')+' COD less charges — '+maRsSigned(_maWhole(diff))+' in all. The receipts count PostEx’s figures, so the PostEx receivable will not clear by that much until the difference is found. Check it against the receipts’ PDFs.',nos,mis.map(x=>x.t));
  }

  // The days: every delivered or returned parcel once, on the day it ended.
  const D=Object.create(null),fell=Object.create(null),none=[],late=[];
  P.forEach(x=>{
    if(!x.final)return;
    const p=x.p,f=x.f;
    if(!f.day){none.push(x.t);return;}
    if(f.basis!=='orderDeliveryDate'){const k=x.st+'|'+f.basis;(fell[k]||(fell[k]=[])).push(x.t);}
    if(f.day>today){late.push(x.t);return;}
    if(f.day<from)return;
    const r=D[f.day]||(D[f.day]={del:0,cod:0,fee:0,tax:0,ret:0,rfee:0,rtax:0}),s=x.s;
    if(x.st==='delivered')r.del++;else r.ret++;
    r.cod+=s.cod;r.fee+=s.fee;r.tax+=s.tax;r.rfee+=s.rfee;r.rtax+=s.rtax;   // exactly what the share deducts
  });
  out.days=Object.keys(D).sort(_maCmp).map(d=>{const r=D[d];
    return {day:d,delivered:r.del,grossCod:_maWhole(r.cod),deliveryFee:_maWhole(r.fee),deliveryTax:_maWhole(r.tax),
      returned:r.ret,reversalFee:_maWhole(r.rfee),reversalTax:_maWhole(r.rtax)};});
  const by={orderPickupDate:['it was picked up','they were picked up','orderPickupDate'],transactionDate:['it was booked','they were booked','transactionDate'],
    receipt:['PostEx charged it on a receipt','PostEx charged them on a receipt','cpr1Date, cpr2Date']};
  Object.keys(fell).sort(_maCmp).forEach(k=>{const st=k.split('|')[0],b=by[k.split('|')[1]],n=fell[k].length;
    issue('parcel.date_fallback',_maPl(n,st+' parcel')+' '+pl(n,'carries','carry')+' no delivery date (orderDeliveryDate) — '+pl(n,'its','their')+(st==='delivered'?' COD, fee and tax are':' reversal fee and tax are')+' dated by the day '+pl(n,b[0],b[1])+' ('+b[2]+').',[],fell[k]);});
  if(none.length)issue('parcel.date_missing',_maPl(none.length,'delivered or returned parcel')+' '+pl(none.length,'carries','carry')+' no readable date at all — '+pl(none.length,'it is','they are')+' in no day and not in the opening.',[],none);
  if(late.length)issue('parcel.future_date',_maPl(late.length,'parcel')+' '+pl(late.length,'is','are')+' dated after today — '+pl(late.length,'it is','they are')+' in no day until then.',[],late);

  // What PostEx still owes: now (transit), and at the start of `from` (opening).
  const T=_maPxBuckets(),O=_maPxBuckets(),long=[],pre=[];let longCod=0,prePaid=0;
  P.forEach(x=>{
    const p=x.p,s=x.s,ret=x.st==='returned'?1:0;
    if(p.dispatched===true&&!x.final){
      T.road.n++;T.road.cod+=_maPaisa(p.cod);
      if(x.booked&&maDaysBetween(x.booked,today)>MA_POSTEX_SYNC_DAYS){long.push(x.t);longCod+=_maPaisa(p.cod);}
    }
    // Waits for nothing more (header): on a receipt, nothing left to come, and
    // PostEx says settled or it is a return. A settled parcel still expecting
    // money stays owed — a settle is never taken to excuse an amount.
    const done=!!(x.n1||x.n2)&&(x.n1?0:s.upfront)+(x.n2?0:s.reserve)===0&&(p.settle===true||x.st==='returned');
    if(x.final&&!done){
      if(!x.n1){T.up.n++;T.up.ret+=ret;T.up.amt+=s.upfront;if(!x.n2)T.up.after+=s.reserve;}
      else if(!x.n2){T.res.n++;T.res.ret+=ret;T.res.amt+=s.reserve;}
    }
    const fd=x.f.day,u0=!!(x.n1&&before[x.n1]),r0=!!(x.n2&&before[x.n2]);
    if(x.final&&!fd)return;               // no date: in no day and not in the opening (parcel.date_missing)
    if(x.final&&fd<from){
      if(x.st==='returned'&&(u0||r0)&&(u0?0:s.upfront)+(r0?0:s.reserve)===0)return;   // its one receipt was paid before the books start
      if(!u0){O.up.n++;O.up.ret+=ret;O.up.amt+=s.upfront;if(!r0)O.up.after+=s.reserve;}
      else if(!r0){O.res.n++;O.res.ret+=ret;O.res.amt+=s.reserve;}
      return;
    }
    if(p.dispatched===true&&x.sent&&x.sent<from){O.road.n++;O.road.cod+=_maPaisa(p.cod);}
    // Paid on a receipt dated before the books start, for a parcel whose end falls inside them.
    if(u0||r0){pre.push(x.t);prePaid+=(u0?s.upfront:0)+(r0?s.reserve:0);}
  });
  if(pre.length)issue('parcel.paid_before_books',_maPl(pre.length,'parcel')+' that did not end before '+maDayLabel(from,true)+' '+pl(pre.length,'was','were')+' paid '+maRs(_maWhole(prePaid))+' on receipts dated before it — money PostEx paid before the books start, for parcels whose income falls inside them. The opening does not net it.',[],pre);
  if(long.length)issue('parcel.long_on_road',_maPl(long.length,'parcel')+' on the road '+pl(long.length,'was','were')+' booked more than '+MA_POSTEX_SYNC_DAYS+' days ago — the sync stops refreshing a parcel’s status '+MA_POSTEX_SYNC_DAYS+' days after booking, so '+pl(long.length,'its status','theirs')+' may be out of date ('+maRs(_maWhole(longCod))+' of COD).',[],long);
  out.transit=_maPxBucketsOut(T,today);
  out.opening=_maPxBucketsOut(O,from);
  out.issues.sort((a,b)=>_maCmp(a.rule,b.rule)||_maCmp(JSON.stringify(a.refs),JSON.stringify(b.refs))||_maCmp(a.message,b.message));
  return out;
}

/* ── Couriers in the books (M2.3) — statements, collections, postings ─────
   What the rollup derives (maCprDerive, above) becomes documents here, and
   those documents — and the owners' typed statements and collections — post.
   MASTER_ACCOUNTS_PLAN.md §5, §6, §8, and the owners' decisions of 29 Sept
   2026: PostEx income is booked on the day PostEx marks a parcel delivered,
   its delivery fee and tax as costs; a return's reversal fee and tax are
   costs (5070, the plan's account); the books start on `couriers.from`.

   ma_cpr holds two families. DERIVED (derived:true, written only by the
   nightly rollup): a PostEx `day`, the PostEx `opening`, and one document
   per PostEx receipt (upfront | reserve | mixed) — status posted, or
   `before` (dated before the books start, kept only so a collection can
   name it: 30 June 2026 was a Tuesday, a CPR day) or `undated`. TYPED
   (kind 'statement', CS-27-0001): a TCS or Bykea statement, income booked
   on each line's own day. ma_collection holds the cash counted against one
   or several of them (CL-27-0001), with a SNAPSHOT of what it covered, so a
   collection posts from itself alone and a receipt that changes after it
   was collected is seen, never silently absorbed. */
const MA_OPENING_DERIVED=['1120','1121'];          // PostEx opens from its parcels; Blue-Ex's 1123 is typed on the opening journal
const MA_COURIER_IDS=Object.keys(MA_COURIERS);
const MA_STATEMENT_COURIERS=['tcs','bykea'];      // PostEx is never typed (§3 #5); Blue-Ex opens on the opening journal
const MA_CPR_RECEIPT_KINDS=['upfront','reserve','mixed'];
const MA_CPR_KINDS=['day','opening','upfront','reserve','mixed','statement'];
const MA_CL_MAX_COVERS=40;
const MA_ST_MAX_LINES=200;
/* A collection that waits for — or was confirmed by — someone keeps what
   was confirmed (the transfer's F6 rule): its holder, amount and day. */
const MA_CL_LOCKED=['holder','amount','date'];
/* All an owner may change on a DERIVED document; firestore.rules mirrors it. */
const MA_DERIVED_OWNER_FIELDS=['reviewedAt','reviewedBy','dispute'];
const MA_DISPUTE_STATES=['open','resolved'];
const MA_ROLLUP_BY='ma-rollup';
const MA_ROLLUP_NAME='Nightly courier rollup';
const MA_CPR_HISTORY_MAX=50;
/* A derived document's fields that move what it posts: a change clears an
   owner's review (they reviewed the old figures). */
const MA_CPR_FIGURES=['date','status','kind','amount','net','parts','delivered','returned','grossCod','deliveryFee','deliveryTax','reversalFee','reversalTax','tax','openAt'];
/* Kept by the rollup across a rewrite, never compared. */
const _maCprKeep=['id','sig','rev','edits','ts','reviewedAt','reviewedBy','dispute'];

function maCourierAcc(courier){const c=MA_COURIERS[courier];return c?c.accounts:null;}
/* The account a collection of this courier credits: PostEx's issued CPRs
   (1121), every other courier's receivable. */
function maCollectReceivable(courier){const a=maCourierAcc(courier);return a?(a.statement||a.receivable):null;}
/* Tax the courier charged, as its own figure (no rate to check it by). */
function _maGivenTax(amount,claimable){return {kind:amount?'services':'none',rate:null,inclusive:false,claimable:!!claimable,amount:Math.round(amount||0)};}
function _maPeriodOf(day,s){
  if(!maIsDay(day))return {month:'',quarter:'',fy:'',historical:false};
  const p=maPeriodLabels(day,s.fiscalYearStart);return {month:p.month,quarter:p.quarter,fy:p.fy,historical:day<s.goLive};
}
/* A posting line dated on another day than its document (a statement line,
   a collection's opening pair). */
function _maAt(day,s){const p=_maPeriodOf(day,s);return {date:day,month:p.month,quarter:p.quarter,fy:p.fy,status:p.historical?'historical':'posted'};}
function maCprCollectable(d){
  return !!d&&d.dt==='cpr'&&(d.status==='posted'||d.status==='before')&&(MA_CPR_RECEIPT_KINDS.indexOf(d.kind)>=0||d.kind==='statement');
}
/* The live collections that cover a CPR or statement. */
function maCollectionsOf(docs,cprId){
  return (docs||[]).filter(d=>d&&d.dt==='collection'&&d.status!=='void'&&d.refs&&Array.isArray(d.refs.cprNos)&&d.refs.cprNos.indexOf(cprId)>=0);
}
/* Who confirms a collection: the person whose hands its holder is (MA_HANDS)
   — the transfer rule with no "from". The recorder who IS that person has
   confirmed by recording, except into the drawer: there Raees records the
   cash in in Store Accounts first, and an owner confirms on paper. */
function maCollectionConfirm(holder,recorder){
  const who=maHandsOf(holder);
  if(!who||(who===recorder&&!maIsDrawer(holder)))return {pending:false,confirmBy:null,paper:false};
  return {pending:true,confirmBy:who,paper:MA_OWNERS.indexOf(who)<0};
}
function maCollectionNeedsConfirm(d){
  return !!(d&&d.dt==='collection'&&(d.confirmBy||maCollectionConfirm(d.holder,d.by).pending));
}

/* ── Building ─────────────────────────────────────────────────────────── */
function _maBuildStatement(doc,i,s,rupees){
  doc.kind='statement';doc.derived=false;
  doc.courier=maStr(i.courier,20);doc.ref=maStr(i.ref,60);
  doc.costCentre='online';doc.channel='online_cod';doc.party=null;
  const num=v=>{const n=typeof v==='number'?v:Number(String(v===undefined||v===null||v===''?'NaN':v).trim());return Number.isFinite(n)?n:NaN;};
  doc.lines=(Array.isArray(i.lines)?i.lines:[]).slice(0,MA_ST_MAX_LINES+1).map(l=>{
    const x=l||{};const o={date:maStr(x.date,10),ref:maStr(x.ref,60),parcels:num(x.parcels),returned:!!x.returned,
      cod:x.returned?0:rupees(x.cod||0),fee:rupees(x.fee||0),tax:rupees(x.tax||0)};
    if(maStr(x.memo,200))o.memo=maStr(x.memo,200);
    return o;
  });
  const sum=f=>doc.lines.reduce((t,l)=>t+(Number.isFinite(l[f])?l[f]:0),0);
  doc.parcels=sum('parcels');doc.grossCod=sum('cod');doc.fees=sum('fee');doc.taxes=sum('tax');
  doc.net=doc.grossCod-doc.fees-doc.taxes;doc.amount=doc.grossCod;
  const cs=(s.couriers&&s.couriers[doc.courier])||{};
  doc.tax=_maGivenTax(doc.taxes,cs.taxClaimable);
}
function _maBuildCollection(doc,i,m,s,rupees){
  doc.courier=maStr(i.courier,20);doc.holder=maStr(i.holder,8);doc.amount=rupees(i.amount);
  doc.collectedBy=maStr(i.collectedBy,60);doc.party=null;doc.tax=maTaxBlank();
  const ids=[];(Array.isArray(i.cprNos)?i.cprNos:[]).forEach(x=>{const v=maStr(x,200);if(v&&ids.indexOf(v)<0)ids.push(v);});
  doc.refs={cprNos:ids};
  // The snapshot: kept as it is on an edit (meta.covers), else read off the
  // documents named — never re-read from today's figures behind an edit.
  if(Array.isArray(m.covers))doc.covers=maClone(m.covers);
  else doc.covers=ids.map(id=>{
    const d=(m.cprs||[]).find(x=>x&&x.id===id)||null;
    const c={id,no:d?String(d.no||''):'',date:d?String(d.date||''):'',net:d&&Number.isInteger(d.net)?d.net:0};
    if(d&&d.status==='before'&&maIsDay(d.openAt))c.openAt=d.openAt;
    return c;
  });
  const legacy=(MA_COURIERS[doc.courier]||{}).cycle==='legacy';
  doc.expected=legacy?(Number.isInteger(doc.amount)?doc.amount:0):doc.covers.reduce((t,c)=>t+(Number.isInteger(c.net)?c.net:0),0);
  doc.difference=Number.isInteger(doc.amount)?doc.amount-doc.expected:NaN;
  const cf=maCollectionConfirm(doc.holder,m.by);
  doc.status=cf.pending?'pending':'posted';doc.confirmBy=cf.confirmBy;doc.confirmPaper=cf.paper;
}

/* ── Posting ──────────────────────────────────────────────────────────── */
function _maPostCpr(doc,push,s){
  const A=maCourierAcc(doc.courier);if(!A)return;
  const claim=!!(doc.tax&&doc.tax.claimable);
  const charge=(costAcc,fee,tax,ex)=>{
    push(costAcc,fee,0,ex);
    push(claim?'1160':costAcc,tax,0,Object.assign({taxKind:'services'},ex||{}));
    push(A.receivable,0,(fee||0)+(tax||0),ex);
  };
  const r=v=>Math.round(Number(v)||0);
  if(doc.kind==='day'){
    const d=doc.delivered||{},x=doc.returned||{};
    push(A.receivable,r(d.cod),0);push(A.revenue,0,r(d.cod));
    charge(A.fees,r(d.fee),r(d.tax));
    charge(A.reversals,r(x.fee),r(x.tax));
  }else if(doc.kind==='opening'){
    push(A.receivable,r(doc.amount),0);push('3090',0,r(doc.amount));
  }else if(MA_CPR_RECEIPT_KINDS.indexOf(doc.kind)>=0){
    push(A.statement||A.receivable,r(doc.net),0);push(A.receivable,0,r(doc.net));
  }else if(doc.kind==='statement'){
    (doc.lines||[]).forEach(l=>{
      if(!maIsDay(l.date))return;
      const ex=Object.assign(_maAt(l.date,s),l.memo?{memo:l.memo}:{});
      if(!l.returned){push(A.receivable,r(l.cod),0,ex);push(A.revenue,0,r(l.cod),ex);charge(A.fees,r(l.fee),r(l.tax),ex);}
      else charge(A.reversals,r(l.fee),r(l.tax),ex);
    });
  }
}
function _maPostCollection(doc,push,s){
  const R=maCollectReceivable(doc.courier);if(!R)return;
  const a=Math.round(doc.amount||0),e=Math.round(doc.expected||0);
  push(doc.holder,a,0);push(R,0,e);
  if(a<e)push('9030',e-a,0);else if(a>e)push('9030',0,a-e);
  // A receipt dated before the books start, collected after they did, was
  // still to collect on the first day: its opening pair, on that day.
  (doc.covers||[]).forEach(c=>{
    if(!c||!maIsDay(c.openAt))return;
    const ex=Object.assign(_maAt(c.openAt,s),{memo:'Still to collect when the books started — '+(c.no||c.id)});
    push(R,Math.round(c.net||0),0,ex);push('3090',0,Math.round(c.net||0),ex);
  });
}

/* ── Validating ───────────────────────────────────────────────────────── */
/* Decision 3 (29 Sept 2026): refused once attachments are on (ma-attach's
   state 'signed' or 'public'); saved and flagged while they are off or the
   state could not be asked — it waits on Needs attention until attached. */
function _maAttachRule(doc,c,rule,what,h){
  if(maAttachList(doc.attachments).length)return;
  if(c.attach==='signed'||c.attach==='public')h.refuse(rule,'Attach '+what+' — attachments are on, so it is required.','attachments');
  else h.flag(rule,'No '+what+' attached — '+(c.attach==='not_configured'?'attachments are off (not set up)':'whether attachments are on could not be checked')+'. It waits on Needs attention until one is.','attachments');
}
function _maValidateStatement(doc,c,s,h){
  if(doc.derived||doc.kind!=='statement'){h.refuse('cpr.derived','PostEx’s receipts and days are derived by the nightly rollup — they are never typed.');return;}
  if(MA_STATEMENT_COURIERS.indexOf(doc.courier)<0){h.refuse('statement.courier','A typed statement is TCS’s or Bykea’s — PostEx’s come from its parcels, Blue-Ex opens on the opening balance.','courier');return;}
  const L=doc.lines||[];
  if(!L.length)h.refuse('statement.lines','Add the statement’s lines — one per parcel, or per day.','lines');
  else if(L.length>MA_ST_MAX_LINES)h.refuse('statement.lines','A statement holds at most '+MA_ST_MAX_LINES+' lines — record it in two.','lines');
  L.slice(0,MA_ST_MAX_LINES).forEach((l,k)=>{
    const n='Line '+(k+1)+': ';
    if(!maIsDay(l.date))h.refuse('statement.lines',n+'pick the day it was delivered or returned.','lines');
    else{
      if(l.date<s.historyFrom)h.refuse('statement.lines',n+'the books start on '+maDayLabel(s.historyFrom,true)+'.','lines');
      if(maIsDay(doc.date)&&l.date>doc.date)h.refuse('statement.lines',n+'it is after the statement’s own date.','lines');
      if(h.lockedQ(maQuarterOf(l.date,s.fiscalYearStart)))h.refuse('statement.lines',n+maQuarterLabel(maQuarterOf(l.date,s.fiscalYearStart),s.fiscalYearStart)+' is closed.','lines');
    }
    if(!(Number.isInteger(l.parcels)&&l.parcels>=1))h.refuse('statement.parcels',n+'give its parcel count.','lines');
    if(['cod','fee','tax'].some(f=>!Number.isInteger(l[f])||l[f]<0))h.refuse('statement.lines',n+'COD, fee and tax are whole rupees, zero or more.','lines');
    if(l.returned&&l.cod)h.refuse('statement.lines',n+'a returned parcel carries no COD.','lines');
  });
  if(!(Number.isInteger(doc.amount)&&doc.amount>0))h.refuse('statement.amount','A statement with no COD delivered posts only costs — record it as a Money out.','lines');
  _maAttachRule(doc,c,'statement.attach','the courier’s statement',h);
  if(doc.ref){
    const dup=(c.docs||[]).find(d=>d&&d.dt==='cpr'&&d.kind==='statement'&&d.courier===doc.courier&&d.status!=='void'&&d.id!==doc.id&&(!c.before||d.id!==c.before.id)&&maNorm(d.ref)===maNorm(doc.ref));
    if(dup)h.flag('statement.ref_dup','Statement '+doc.ref+' is already recorded as '+(dup.no||dup.id)+'.','ref');
  }
}
function _maValidateCollection(doc,c,s,h){
  const C=MA_COURIERS[doc.courier];
  if(!C){h.refuse('collection.courier','Which courier is this from?','courier');return;}
  const legacy=C.cycle==='legacy',ids=(doc.refs&&doc.refs.cprNos)||[];
  if(legacy&&ids.length)h.refuse('collection.covers','Blue-Ex has no statements here — its collection is against the balance it opened with.','covers');
  if(!legacy&&!ids.length)h.refuse('collection.covers','Name the CPR'+(doc.courier==='postex'?'':' or statement')+' this cash is for.','covers');
  if(ids.length>MA_CL_MAX_COVERS)h.refuse('collection.covers','A collection covers at most '+MA_CL_MAX_COVERS+' statements — record it in two.','covers');
  const docs=c.docs||[];
  const self=d=>d.id===doc.id||(c.before&&d.id===c.before.id);
  ids.forEach(id=>{
    const d=docs.find(x=>x&&x.dt==='cpr'&&x.id===id);
    if(!d||!maCprCollectable(d)){h.refuse('collection.cpr_exists',(d?(d.no||id)+' cannot be collected':'That statement is not in the books ('+id+')')+' — a CPR, a receipt from before the books, or a typed statement.','covers');return;}
    if(d.courier!==doc.courier){h.refuse('collection.mixed',(d.no||id)+' is '+((MA_COURIERS[d.courier]||{}).name||d.courier)+'’s — one collection is one courier’s cash.','covers');return;}
    const other=maCollectionsOf(docs,id).filter(x=>!self(x));
    if(other.length)h.refuse('collection.once',(d.no||id)+' is already collected by '+other.map(x=>x.no||x.id).join(', ')+' — void that first.','covers');
    if(maIsDay(doc.date)&&maIsDay(d.date)&&doc.date<d.date)h.refuse('collection.date','Collected before '+(d.no||id)+' was issued ('+maDayLabel(d.date,true)+').','date');
    if(d.status==='before'&&maIsDay(d.openAt)&&h.lockedQ(maQuarterOf(d.openAt,s.fiscalYearStart)))
      h.refuse('collection.before_closed',(d.no||id)+' is from before the books; its quarter is closed, so it cannot join the opening now.','covers');
  });
  const hOk=h.holderOk(doc.holder,'holder',{dir:'arrived in',allowMirror:true});
  if(hOk&&(doc.courier==='tcs')!==(doc.holder===C.accounts.wallet||doc.holder==='1060'))
    h.refuse('collection.holder',doc.courier==='tcs'?'TCS credits the TCS account (1060) — moving it to MCB is a Transfer.':'Only TCS’s credits go into the TCS account.','holder');
  const aOk=h.amountOk(doc.amount);
  if(!legacy&&ids.length&&!(Number.isInteger(doc.expected)&&doc.expected>0))h.refuse('collection.nothing','Those statements come to '+maRs(doc.expected||0)+' — nothing to collect.','covers');
  _maAttachRule(doc,c,'collection.receipt','the receipt',h);
  if(aOk&&!legacy&&Number.isInteger(doc.difference)&&doc.difference){
    const tol=Math.abs(doc.expected)*(s.courierTolerancePct||0)/100;
    if(Math.abs(doc.difference)>tol){
      h.flag('collection.difference','Counted '+maRs(Math.abs(doc.difference))+' '+(doc.difference<0?'less':'more')+' than '+(ids.length>1?'their':'its')+' net of '+maRs(doc.expected)+' — it waits in 9030 until explained.','amount');
      if(!maStr(doc.note))h.refuse('collection.reason','Say why the cash differs from the net by '+maRs(doc.difference)+' (or “not known yet”).','note');
    }
  }
  if(legacy&&aOk){
    const opened=docs.some(d=>maIsOpening(d)&&(d.lines||[]).some(l=>l&&l.account===C.accounts.receivable));
    if(!opened)h.flag('collection.bluex_opening','Recovered before Blue-Ex’s opening — record its last statement as a line on the opening balance.','amount');
    else if(h.acc&&c.idx){const bal=maBalanceOf(c.lines||[],c.idx,C.accounts.receivable);if(doc.amount>bal)h.flag('collection.bluex_over','More than Blue-Ex still owes ('+maRs(bal)+') — check its opening.','amount');}
    if(maIsDay(doc.date)){
      const dup=docs.find(d=>d&&d.dt==='collection'&&d.courier===doc.courier&&d.status!=='void'&&!self(d)&&d.amount===doc.amount&&maIsDay(d.date)&&Math.abs(maDaysBetween(d.date,doc.date))<=s.duplicateDays);
      if(dup)h.flag('duplicate','Looks like '+(dup.no||'another collection')+' — '+maRs(dup.amount)+' on '+maDayLabel(dup.date)+'.');
    }
  }
  if(doc.courier==='tcs'&&maIsDay(doc.date)){
    let first='';ids.forEach(id=>{const d=docs.find(x=>x&&x.id===id);(d&&d.lines||[]).forEach(l=>{if(maIsDay(l.date)&&(!first||l.date<first))first=l.date;});});
    if(first&&doc.date<maDayAdd(first,(s.tcsCreditDays||0)-7))h.flag('collection.tcs_early','Credited earlier than the '+s.tcsCreditDays+' days TCS takes — its first parcel was delivered '+maDayLabel(first,true)+'.','date');
  }
}
function _maCollectionEditIssues(b,d,h){
  const ids=x=>JSON.stringify(((x.refs&&x.refs.cprNos)||[]).slice());
  if(b.courier!==d.courier||ids(b)!==ids(d)||_maCanon(b.covers||[])!==_maCanon(d.covers||[]))
    h.refuse('edit.covers','What a collection covers cannot change — void it and record it again.','covers');
  if(maCollectionNeedsConfirm(b)){
    const moved=MA_CL_LOCKED.filter(f=>_maCanon(b[f]===undefined?null:b[f])!==_maCanon(d[f]===undefined?null:d[f]));
    if(moved.length)h.refuse('edit.confirmed',(b.status==='pending'?'It waits for '+_maCap(b.confirmBy)+' to confirm':'It was confirmed as it stands')+' — its '+moved.join(', ')+' cannot change: void it and record it again.',moved[0]);
  }else if(b.holder!==d.holder&&maCollectionConfirm(d.holder,b.by).pending)
    h.refuse('edit.route','That holder waits for a confirmation, and an edit cannot start one — void it and record it again.','holder');
}
function _maStatementEditIssues(b,d,c,h){
  if(b.courier!==d.courier||!!b.derived!==!!d.derived)h.refuse('edit.courier','A statement cannot change its courier — void it and record the right one.','courier');
  const by=maCollectionsOf(c.docs,b.id);
  if(by.length&&['date','lines','amount','net'].some(f=>_maCanon(b[f]===undefined?null:b[f])!==_maCanon(d[f]===undefined?null:d[f])))
    h.refuse('edit.collected',by.map(x=>x.no||x.id).join(', ')+' collected it as it stands — void '+(by.length>1?'those':'that')+' first.','lines');
}

/* ── The derived documents (the rollup's half) ─────────────────────────── */
function _maYmd(day){return day.slice(2,4)+day.slice(5,7)+day.slice(8,10);}
function _maCprFlags(issues,number){
  return (issues||[]).filter(i=>i&&i.refs&&(i.refs.receipts||[]).indexOf(number)>=0).map(i=>({rule:i.rule,message:i.message,field:null}));
}
/* From maCprDerive's answer to the documents the rollup writes — PURE, so
   the rollup, the tests and anything else build the same thing. */
function maCourierDocs(der,settings){
  const s=settings||MA_DEFAULT_SETTINGS,from=s.couriers.from,pe=s.couriers.postex,claim=!!pe.taxClaimable;
  const d0=der||{},out=[];
  const base=(id,no,kind,date,status)=>Object.assign({id,no,dt:'cpr',book:'groovy',kind,courier:'postex',derived:true,source:'postex',
    by:MA_ROLLUP_BY,byName:MA_ROLLUP_NAME,ts:0,date:date||'',status,rev:1,edits:[],flags:[],note:'',tags:[],attachments:[],
    costCentre:'online',channel:'online_cod',party:null},_maPeriodOf(date,s));
  const sig=o=>'v1:'+_maHash(_maCanon(o));
  (d0.days||[]).filter(r=>r&&maIsDay(r.day)&&r.day>=from).forEach(r=>{
    const d=base('postex-day-'+r.day,'PX-'+_maYmd(r.day),'day',r.day,'posted');
    d.delivered={parcels:r.delivered||0,cod:r.grossCod||0,fee:r.deliveryFee||0,tax:r.deliveryTax||0};
    d.returned={parcels:r.returned||0,fee:r.reversalFee||0,tax:r.reversalTax||0};
    d.amount=d.delivered.cod;
    d.net=d.delivered.cod-d.delivered.fee-d.delivered.tax-d.returned.fee-d.returned.tax;
    d.tax=_maGivenTax(d.delivered.tax+d.returned.tax,claim);
    d.sig=sig([d.date,d.delivered,d.returned,d.tax]);
    out.push(d);
  });
  if(d0.opening&&maIsDay(from)){
    const o=d0.opening,d=base('postex-opening','PX-OPEN','opening',from,'posted');
    d.amount=Math.round(o.owed||0);d.net=d.amount;d.tax=maTaxBlank();
    d.owedParts={awaitingUpfront:o.awaitingUpfront||null,awaitingReserve:o.awaitingReserve||null};
    d.sig=sig([d.date,d.amount]);
    out.push(d);
  }
  const receipt=(c,status,extra)=>{
    const d=base(c.id,String(c.number||''),c.kind,c.date,status);
    d.ref=String(c.number||'');d.parts=maClone(c.parts);d.net=c.net;d.amount=c.net;d.tax=maTaxBlank();
    ['grossCod','deliveryFee','deliveryTax','reversalFee','reversalTax','delivered','returned','settled'].forEach(k=>{if(c[k]!==undefined)d[k]=c[k];});
    d.flags=_maCprFlags(d0.issues,c.number);
    Object.assign(d,extra||{});
    d.sig=sig([c.sig||[c.date,c.kind,c.parts,c.net],status,d.openAt||'',d.flags.map(f=>f.rule+':'+f.message)]);
    return d;
  };
  (d0.cprs||[]).forEach(c=>{if(c&&c.id)out.push(receipt(c,maIsDay(c.date)?'posted':'undated'));});
  const edge=maIsDay(from)?maDayAdd(from,-(pe.beforeWindowDays||0)):'';
  ((d0.excluded&&d0.excluded.list)||[]).forEach(c=>{if(c&&c.id&&maIsDay(c.date)&&c.date>=edge&&c.date<from)out.push(receipt(c,'before',{openAt:from}));});
  return out;
}
/* One stored derived document against the rollup's new one → what to do.
   `meta` = {at, locked(quarter) → bool}. Owner fields survive a rewrite: a
   dispute always; a review unless a figure moved. Nothing is ever written
   into a locked quarter, and a document an owner typed at the same id is
   never touched. → {action: none|create|update|skip, doc?, fields?, why?} */
function maCourierMerge(stored,next,meta){
  const m=meta||{},locked=typeof m.locked==='function'?m.locked:()=>false;
  if(!next)return {action:'none'};
  if(!stored){
    if(next.quarter&&locked(next.quarter))return {action:'skip',why:'locked',quarter:next.quarter};
    return {action:'create',doc:Object.assign({},maClone(next),{ts:m.at||0})};
  }
  if(!stored.derived)return {action:'skip',why:'typed'};
  if(stored.sig===next.sig&&stored.status!=='void')return {action:'none'};
  const lq=[stored.quarter,next.quarter].find(q=>q&&locked(q));
  if(lq)return {action:'skip',why:'locked',quarter:lq};
  const keys=Array.from(new Set(Object.keys(stored).concat(Object.keys(next)))).filter(k=>_maCprKeep.indexOf(k)<0).sort();
  const fields=keys.filter(k=>_maCanon(stored[k]===undefined?null:stored[k])!==_maCanon(next[k]===undefined?null:next[k]));
  const out=Object.assign({},maClone(next),{ts:stored.ts||0,rev:(stored.rev||1)+1});
  const before={},after={};fields.forEach(f=>{before[f]=stored[f]===undefined?null:maClone(stored[f]);after[f]=next[f]===undefined?null:maClone(next[f]);});
  out.edits=(Array.isArray(stored.edits)?stored.edits:[]).concat([{at:m.at||0,by:MA_ROLLUP_BY,byName:MA_ROLLUP_NAME,reason:'PostEx records changed',fields,before,after}]).slice(-MA_CPR_HISTORY_MAX);
  if(stored.dispute!==undefined)out.dispute=maClone(stored.dispute);
  const figure=fields.some(f=>MA_CPR_FIGURES.indexOf(f)>=0);
  if(!figure){['reviewedAt','reviewedBy'].forEach(k=>{if(stored[k]!==undefined)out[k]=stored[k];});}
  else if(stored.reviewedAt!==undefined||stored.reviewedBy!==undefined){out.reviewedAt=null;out.reviewedBy=null;}
  return {action:'update',doc:out,fields};
}
/* A stored derived document the data no longer produces: voided, never
   deleted — unless a live collection covers it or its quarter is locked,
   when it stays and is named. `meta` = {at, locked, docs}. */
function maCourierGone(stored,meta){
  const m=meta||{},locked=typeof m.locked==='function'?m.locked:()=>false;
  if(!stored||!stored.derived||stored.status==='void')return {action:'none'};
  if(maCollectionsOf(m.docs,stored.id).length)return {action:'skip',why:'collected'};
  if(stored.quarter&&locked(stored.quarter))return {action:'skip',why:'locked',quarter:stored.quarter};
  return {action:'void',doc:Object.assign({},maClone(stored),{status:'void',voidedAt:m.at||0,voidedBy:MA_ROLLUP_BY,voidedByName:MA_ROLLUP_NAME,
    voidReason:'PostEx no longer reports it',sig:'void'})};
}
/* Every derived document stored against every one derived now → the run's
   writes. `stored` may hold typed statements too; they are left alone. */
function maCourierPlan(stored,next,meta){
  const by={};(stored||[]).forEach(d=>{if(d&&d.id)by[d.id]=d;});
  const seen={},plan={writes:[],skipped:[],unchanged:0,created:0,updated:0,voided:0};
  (next||[]).forEach(n=>{
    seen[n.id]=1;
    const r=maCourierMerge(by[n.id]||null,n,meta);
    if(r.action==='none')plan.unchanged++;
    else if(r.action==='skip')plan.skipped.push({id:n.id,why:r.why,quarter:r.quarter||null});
    else{plan.writes.push({id:n.id,action:r.action,doc:r.doc,fields:r.fields||null});plan[r.action==='create'?'created':'updated']++;}
  });
  Object.keys(by).forEach(id=>{
    if(seen[id]||!by[id].derived)return;
    const r=maCourierGone(by[id],meta);
    if(r.action==='void'){plan.writes.push({id,action:'void',doc:r.doc});plan.voided++;}
    else if(r.action==='skip')plan.skipped.push({id,why:r.why,quarter:r.quarter||null});
  });
  return plan;
}
/* 1120 as the books have it against what the parcels say PostEx owes now. */
function maCourier1120Check(lines,idx,der){
  const ledger=maBalanceOf(lines,idx,'1120');
  const transit=der&&der.transit&&Number.isInteger(der.transit.owed)?der.transit.owed:null;
  return {ledger1120:ledger,transit1120:transit,diff:transit===null?null:ledger-transit};
}
/* An owner opens or resolves a dispute on a derived document — the one
   thing besides the review an owner may change there. */
function maDisputePatch(doc,who,input,meta){
  const i=input||{},m=meta||{};
  if(!doc||doc.dt!=='cpr'||!doc.derived)return {error:'Only a PostEx receipt or day is disputed — a typed document is edited.'};
  if(doc.status==='void')return {error:'A void document cannot be disputed.'};
  if(MA_OWNERS.indexOf(who)<0)return {error:'Only Afnan or Ammar can dispute it.'};
  const cur=doc.dispute||null;
  if(i.state==='open'){
    if(!maStr(i.reason))return {error:'Say what is wrong with it.'};
    return {patch:{dispute:{state:'open',reason:maStr(i.reason,500),by:who,at:m.at||0}}};
  }
  if(i.state==='resolved'){
    if(!cur||cur.state!=='open')return {error:'There is no open dispute to resolve.'};
    return {patch:{dispute:Object.assign({},cur,{state:'resolved',resolvedBy:who,resolvedAt:m.at||0,note:maStr(i.note,500)})}};
  }
  return {error:'A dispute is opened or resolved.'};
}

/* ── What is still to collect: the calendar and Needs attention ─────────── */
/* When the cash for a statement is expected, and whether it can be spent:
   PostEx and Bykea at their date + the courier's collectLagDays; TCS at its
   last line + tcsCreditDays, into the TCS account — never spendable. */
function _maDueOf(d,s){
  const cs=(s.couriers&&s.couriers[d.courier])||{};
  if(d.courier==='tcs'){
    const last=(d.lines||[]).reduce((m,l)=>maIsDay(l.date)&&l.date>m?l.date:m,'');
    return last?{due:maDayAdd(last,s.tcsCreditDays||0),at:maDayAdd(last,s.tcsCreditDays||0),spendable:false}:null;
  }
  if(!maIsDay(d.date))return null;
  return {due:d.date,at:maDayAdd(d.date,cs.collectLagDays||0),spendable:true};
}
function maUncollected(docs,settings){
  const s=settings||MA_DEFAULT_SETTINGS;
  return (docs||[]).filter(d=>d&&d.dt==='cpr'&&d.status==='posted'&&(MA_CPR_RECEIPT_KINDS.indexOf(d.kind)>=0||d.kind==='statement')
    &&(Number(d.net)||0)>0&&!maCollectionsOf(docs,d.id).length).map(d=>Object.assign({doc:d},_maDueOf(d,s)||{})).filter(x=>x.due);
}
/* The calendar's courier inflows (§17): every statement not collected at
   its expected day (a day past lands on today, late), and what PostEx owes
   on parcels delivered and not yet on a CPR — only the UPFRONT part it will
   pay on the next CPR day, from the rollup's transit, marked an estimate. */
function maCourierInflows(o){
  const s=o.settings||MA_DEFAULT_SETTINGS,today=o.today,out=[];
  maUncollected(o.docs,s).forEach(x=>{
    const d=x.doc,late=x.at<today;
    out.push({day:late?today:x.at,amount:d.net,label:(MA_COURIERS[d.courier]||{name:d.courier}).name+' '+(d.kind==='statement'?'statement '+(d.no||''):'CPR '+(d.ref||d.no||'')),
      late,due:x.at,courier:d.courier,cpr:d.id,spendable:x.spendable,wallet:!x.spendable});
  });
  const t=o.run&&o.run.transit&&o.run.transit.awaitingUpfront;
  if(t&&Number.isInteger(t.amount)&&t.amount>0&&maIsDay(today)){
    const cpr=maNextPayDay(today,s.cprDays);
    out.push({day:maDayAdd(cpr,(s.couriers.postex||{}).collectLagDays||0),amount:t.amount,label:'PostEx — delivered, not yet on a CPR (about)',
      estimate:true,courier:'postex',spendable:true,cprDay:cpr});
  }
  return out;
}
function _maCourierName(c){return (MA_COURIERS[c]||{name:c||'A courier'}).name;}
/* Needs attention's courier lines (maNeedsAttention calls this). `o` adds
   {run: ma_runs/rollup or null, missing: [collections that could not be
   read], nowMs}. Many uncollected statements are ONE line per courier and
   month, with a count and a total. */
function maCourierConcerns(o){
  const s=o.settings||MA_DEFAULT_SETTINGS,today=o.today,docs=o.docs||[],out=[];
  const add=(state,sentence,basis,action,weight)=>out.push({state,sentence,basis,action:action||null,weight:weight||0});
  const missing=Array.isArray(o.missing)?o.missing:[];
  ['ma_cpr','ma_collection'].forEach(col=>{if(missing.indexOf(col)>=0)add('watch',col+' could not be read — the couriers’ figures here leave it out.','A refused or failed read is never shown as zero.',{label:'Retry',go:'reload'},5e8);});
  if(!maIsDay(today))return out;
  // Uncollected, grouped per courier and month.
  const groups={};
  maUncollected(docs,s).forEach(x=>{
    const cs=(s.couriers&&s.couriers[x.doc.courier])||{};
    const age=maDaysBetween(x.due,today);
    if(age<(cs.uncollectedDays||0))return;
    const k=x.doc.courier+'|'+maMonthOf(x.due);(groups[k]=groups[k]||[]).push(Object.assign({age},x));
  });
  Object.keys(groups).sort().forEach(k=>{
    const g=groups[k].sort((a,b)=>_maCmp(a.due,b.due)),c=g[0].doc.courier,tot=g.reduce((t,x)=>t+x.doc.net,0);
    const noun=c==='postex'?'CPR':c==='tcs'?'TCS credit':'statement';
    const act={label:'Open',go:'couriers',courier:c,month:maMonthOf(g[0].due)};
    if(g.length===1){const d=g[0].doc;add('watch',(c==='postex'?'CPR '+(d.ref||d.no):_maCourierName(c)+' '+noun+' '+(d.no||''))+' ('+maDayLabel(g[0].due)+') — '+maRs(d.net)+' not collected, '+_maPl(g[0].age,'day')+'.','Nothing collected against it in the books.',act,d.net);}
    else add('watch',_maCourierName(c)+' — '+g.length+' '+noun+'s from '+maMonthLabel(maMonthOf(g[0].due),true)+' not collected: '+maRsShort(tot)+', the oldest '+maDayLabel(g[0].due)+'.','Nothing collected against them in the books.',act,tot);
  });
  const live=docs.filter(d=>d&&d.dt==='collection'&&d.status!=='void');
  const noRc=live.filter(d=>!maAttachList(d.attachments).length);
  if(noRc.length)add('watch',_maPl(noRc.length,'collection')+' '+(noRc.length>1?'have':'has')+' no receipt attached — '+maRs(noRc.reduce((t,d)=>t+(d.amount||0),0))+'.','A collection is proved by its receipt (§6).',{label:'Attach',go:'couriers',filter:'noreceipt'},0);
  const off=live.filter(d=>Number.isInteger(d.difference)&&d.difference!==0);
  if(off.length)add('watch',_maPl(off.length,'collection')+' '+(off.length>1?'differ':'differs')+' from '+(off.length>1?'their':'its')+' CPRs’ net — '+maRs(off.reduce((t,d)=>t+Math.abs(d.difference),0))+' in all, in 9030.','The cash counted against the net PostEx’s records give.',{label:'Open',go:'couriers',filter:'difference'},0);
  // A statement that changed (or went) after it was collected.
  const moved=[];let movedBy=0;
  live.forEach(d=>(d.covers||[]).forEach(cv=>{const x=docs.find(y=>y&&y.dt==='cpr'&&y.id===cv.id);if(x&&(x.status==='void'||x.net!==cv.net)){moved.push(d);movedBy+=(x.status==='void'?0:x.net)-cv.net;}}));
  if(moved.length)add('watch',_maPl(moved.length,'collected statement')+' changed after '+(moved.length>1?'they were':'it was')+' collected ('+maRsSigned(movedBy)+') — it sits in 1121.','The collection keeps what it covered; the statement moved since.',{label:'Open',go:'couriers',filter:'changed'},Math.abs(movedBy));
  const cnt={};live.forEach(d=>((d.refs&&d.refs.cprNos)||[]).forEach(id=>{(cnt[id]=cnt[id]||[]).push(d);}));
  Object.keys(cnt).sort().forEach(id=>{if(cnt[id].length<2)return;const x=docs.find(y=>y&&y.id===id);
    add('concern',(x?(x.no||id):id)+' is collected twice — '+cnt[id].map(d=>d.no||d.id).join(' and ')+'.','One live collection per CPR (§6).',{label:'Open',go:'doc',ref:cnt[id][1].id,dt:'collection'},9e8);});
  // The nightly rollup.
  if(missing.indexOf('ma_runs')>=0)add('watch','The courier rollup’s last run could not be read.','ma_runs: the read was refused or failed.',{label:'Retry',go:'reload'},5e8);
  else if(o.run!==undefined){
    const r=o.run;
    if(!r)add('watch','The courier rollup has not run yet — PostEx’s receipts and days arrive with it.','ma_runs has no run.',{label:'Open',go:'couriers'},0);
    else{
      const age=Number.isFinite(o.nowMs)&&Number.isFinite(r.at)?o.nowMs-r.at:null;
      if(r.state==='failed')add('concern','The courier rollup failed: '+String(r.error||'no reason given').slice(0,120)+'.','ma_runs/rollup, the last run.',{label:'Open',go:'couriers'},9e8);
      else if(age!==null&&age>(s.couriers.runWatchHours||36)*3600000)add('concern','The courier rollup last ran '+Math.floor(age/3600000)+' hours ago.','ma_runs/rollup, the last run.',{label:'Open',go:'couriers'},9e8);
      const ck=r.checks||{};
      if(Number.isInteger(ck.ledger1120)&&Number.isInteger(ck.transit1120)&&ck.ledger1120!==ck.transit1120)
        add('concern','The books say PostEx owes '+maRs(ck.ledger1120)+' on delivered parcels; the parcels say '+maRs(ck.transit1120)+'.','1120 against the rollup’s transit.',{label:'Open',go:'couriers'},9e8);
      const n=Number.isInteger(r.issueCount)?r.issueCount:(r.issues||[]).length;
      if(n)add('watch','PostEx data: '+_maPl(n,'issue')+' — '+((r.issues||[]).slice(0,2).map(i=>String(i.message||i.rule).slice(0,90)).join(' · ')||'see the last run')+'.','The nightly rollup’s checks.',{label:'Open',go:'couriers',filter:'issues'},0);
    }
  }
  return out;
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={MA_BOOKS,MA_ACCOUNT_TYPES,MA_HOLDER_KINDS,MA_SPEND_GROUPS,MA_LABEL_KINDS,MA_CHANNELS,MA_SOURCES,
    MA_CHART,MA_SV_CHART,MA_SUSPENSE,MA_UNLABELLED,MA_PARTY_KINDS,MA_VENDOR_ROLES,MA_TERMS_MODES,MA_TAX_KINDS,
    MA_COMMIT_KINDS,MA_CADENCES,MA_OWNERS,MA_DOC_TYPES,MA_JOURNAL_KINDS,MA_EDIT_FIELDS,MA_DEFAULT_SETTINGS,
    maSettings,maEsc,maNorm,maDay,maIsDay,maDayAdd,maDaysBetween,maWeekday,maMonthOf,maMonthAdd,maDaysInMonth,
    maFyEndYear,maFyOf,maQuarterOf,maQuarterRange,maQuarterLabel,maPeriodLabels,maMonthLabel,maDayLabel,
    maParseRupees,maRupeesDotted,maGroup,maRs,maRsSigned,maRsShort,maRsWords,maChart,maChartIndex,maAcc,maIsMoney,maMoneyAccounts,
    maTaxBlank,maTaxCompute,maTaxBlock,maTaxIssues,maDocNo,maTransferConfirm,maBuildDoc,maJournalTotal,maIsOpening,
    maPost,maPostAll,maSumLines,maBal,maBalanceOf,maRunningMin,maHolderRows,maHolderCash,maCashInHand,maTrialBalance,maLedger,
    maTermsIssues,maTermsText,maTermsAt,maTermsChange,maNextPayDay,maDueDate,maRateAt,maRateIssues,maRateChange,
    maPartyCode,maPartyIssues,maItemIssues,maCommitmentIssues,maCommitmentDueDays,maCommitmentPeriodKey,
    maCommitmentStatus,maCommitmentText,maCalendar,maSpendable,maValidate,maVoidIssues,maEditDiff,maApplyEdit,
    maApplyVoid,maConfirmPatch,maUnlabelled,maReviewQueue,maNeedsAttention,maAllocateFifo,maDocTitle,maDocText,
    maAuditRow,maPad,maClone,maStr,maIsRupees,maCodeOk,maAccLabel,maSpendGroupOf,maLineText,
    maPdfLedgerData,maPdfHolderStatementData,maPdfPartyStatementData,maPdfReceiptData,maPdfVoucherData,maPdfCollectionData,
    MA_AUDIT_ACTIONS,MA_ATTACH_FORMATS,MA_ATTACH_MAX,MA_ATTACH_KEYS,MA_BACKUP_STATES,MA_BOOK_COLS,
    maAttachPidOk,maAttachOk,maAttachClean,maAttachList,maAttachFromUpload,maAttachRef,maAttachIssues,maRevOf,
    maLiveFlags,maAnsweredFlags,maBackupState,maBackupMissing,maWaPhone,maWaLink,maShareState,MA_SHARE_MAX_DAYS,MA_SHARE_SKEW_MS,maBooksNoTokens,maBooksJson,maBooksSheets,
    MA_EDIT_DERIVED,MA_FIGURE_FIELDS,MA_CONFIRM_KEYS,MA_HANDS,MA_DRAWERS,maHandsOf,maIsDrawer,maTransferNeedsConfirm,
    maConfirmWarning,maCountBookOf,maQuarterLocked,maEditClearsReview,maFlagRows,maCloseRelock,
    MA_LEDGER_NARROW,maLedgerBalanceHidden,maLedgerHiddenWhy,maCommitmentOpenPeriod,maCommitmentPeriodOk,maPeriodLabel,maNewFlagRules,maRsRate,
    MA_COURIER_CYCLES,MA_COURIERS,MA_CPR_NUMBER_MAX,MA_POSTEX_SYNC_DAYS,MA_CPR_ISSUE_RULES,maIdSafe,maCprId,maCprSplit,maCprNet,maCprDerive,
    MA_OPENING_DERIVED,MA_COURIER_IDS,MA_STATEMENT_COURIERS,MA_CPR_RECEIPT_KINDS,MA_CPR_KINDS,MA_CL_MAX_COVERS,MA_ST_MAX_LINES,
    MA_CL_LOCKED,MA_DERIVED_OWNER_FIELDS,MA_DISPUTE_STATES,MA_ROLLUP_BY,MA_ROLLUP_NAME,MA_CPR_FIGURES,
    maCourierAcc,maCollectReceivable,maCprCollectable,maCollectionsOf,maCollectionConfirm,maCollectionNeedsConfirm,
    maCourierDocs,maCourierMerge,maCourierGone,maCourierPlan,maCourier1120Check,maDisputePatch,maUncollected,maCourierInflows,maCourierConcerns};
}

/* ═══════════════════════════════════════════════════════════════════════
   js/warehouse-sales.js — Accounts, level 2: customer purchases at the
   warehouse (Sept 2026)

   Afnan: "Umair is the warehouse manager and customers that come in and
   buy stuff — the ERP we use makes a bill … there should be an accounts
   section in Umair's tab where Umair can record the customer purchases. In
   order to punch an entry Umair must take a picture or upload the PDF …
   customer name + number + order # + due date (for customers that pay
   after making purchases — pay later, usually people we know), a tab to
   apply discount max 20%, article name is searchable with quantity …
   this account sits with Umair; once it is set up I will review, then we
   will add logic to add the receivable to Raees's Store Accounts section,
   as cash is managed by Raees."

   WHERE IT LIVES: a third SECTION on Umair's one page (Courier Performance
   → Daily Reporting · PostEx · Accounts), not a new page id. His role is
   scoped in showPage to exactly one page, so a section needs no change to
   that scope and cannot open a side door to anything else.

   DECISIONS, each recorded in ACCOUNTS_PLAN.md ("Level 2") for Afnan's
   review, all overrulable:

   - ONE DOCUMENT PER ERP ORDER, AND ITS ID IS THE ORDER NUMBER
     (wh_sales/SO0334). The bill is the source of truth and its number is
     unique, so a second entry of the same bill is not a second sale. The
     write is a transaction that reads the document first and refuses a
     duplicate by name; firestore.rules is the backstop, since a second
     write to an existing id is an UPDATE there and updates are held to
     the void and review fields.
   - THE BILL IS REQUIRED, photo or PDF (Cloudinary /auto/upload — the
     /image/upload path the rest of the app uses does not take a PDF).
     Only an anchored https://res.cloudinary.com/ URL is stored, because it
     is rendered straight into an <img src> / <a href>.
   - A LINE IS A SNAPSHOT, never a pointer. The catalog is the daily copy
     of Shopify (shopify_products): prices are rewritten every day and
     variants are never deleted, so a sale that only pointed at the catalog
     would change under its own bill. Each line keeps the title, variant,
     SKU, article code, the price charged and the catalog price of the day.
   - THE PRICE IS PREFILLED AND EDITABLE, and an edited price is FLAGGED
     for owner review rather than refused — the ERP bill is what was
     charged, and this ledger copies it. An article that is not in the
     catalog can be typed in, flagged the same way. "Warn, never block",
     the Store Accounts rule.
   - THE 20% DISCOUNT CAP IS A HARD LIMIT, in the form AND in
     firestore.rules (discount * 100 <= subtotal * 20). Whole rupees only,
     so the rule's arithmetic is exact.
   - PAY LATER NEEDS A DUE DATE; paid now needs Cash or Bank transfer.
     Collecting a pay-later bill is NOT recorded here — that is the next
     step, when this links into Raees's Store Accounts (where the cash is).
   - VOID, NEVER EDIT — the Store Accounts rule. Umair and the owners void
     with a reason; the owners clear a review flag; Afnan and Ammar (the
     Store Accounts correction pair, isAcctSuper) may delete.

   The audience is Umair BY USERNAME plus the owners by role, mirrored in
   firestore.rules isWhSales() by email. Managers see Courier Performance
   and do NOT see this section.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Audience ─────────────────────────────────────────────────────────────
const _WHS_USERS=['umair'];
function _whsSession(){return (typeof session!=='undefined'&&session)||null;}
function whsCanView(){const s=_whsSession();return !!(s&&(s.role==='owner'||_WHS_USERS.indexOf(s.u)>=0));}
function whsCanEntry(){return whsCanView();}
function _whsIsOwner(){const s=_whsSession();return !!(s&&s.role==='owner');}
// The Store Accounts correction pair (afnan, ammar). Fails CLOSED if
// js/store-accounts.js did not load.
function _whsIsSuper(){return typeof _acctIsSuper==='function'&&!!_acctIsSuper();}
// WHO did something is read from the USERNAME, which firestore.rules binds
// to the signed-in email (createdByU, voidedBy, reviewedBy); the stored name
// beside it is only a fallback for a username USER_DEFS does not know.
function _whsWho(u,name){
  const d=typeof USER_DEFS!=='undefined'&&Array.isArray(USER_DEFS)?USER_DEFS.find(x=>x&&x.u===u):null;
  return (d&&d.name)||String(name||'')||String(u||'');
}
function _whsUid(){
  try{if(typeof auth!=='undefined'&&auth&&auth.currentUser&&auth.currentUser.uid)return auth.currentUser.uid;}catch(_){}
  const s=_whsSession();return (s&&s.uid)||'';
}

// ── Rules ────────────────────────────────────────────────────────────────
const WHS_MAX_DISCOUNT_PCT=20;
const WHS_MAX_UPLOAD_MB=15;
const WHS_MAX_QTY=9999;
const WHS_PAID_VIA=[{key:'cash',label:'Cash'},{key:'bank',label:'Bank transfer'}];
// The only fields an update may touch. firestore.rules holds the same two
// lists in hasOnly(), and tests/warehouse-sales.test.js asserts they agree.
const _WHS_VOID_FIELDS=['status','voidedAt','voidedBy','voidedByName','voidReason'];
const _WHS_REVIEW_FIELDS=['needsReview','reviewedAt','reviewedBy','reviewedByName'];
// Collecting a pay-later bill (26 Sept 2026). The only other update Umair
// makes to a sale; firestore.rules holds the write to exactly these keys.
const _WHS_COLLECT_FIELDS=['collectedAt','collectedBy','collectedByName','collectedVia','collectedDate'];
// Where the money lands in Raees's Store Accounts: cash in the drawer, a bank
// transfer in MCB. The ONE mapping both sides read.
const WHS_ACCT_OF={cash:'cash',bank:'mcb'};
const _WHS_PAGE=40;
// The ledger read is capped. Past it the oldest sales — the pay-later bills
// most likely to be overdue — drop out of every total, so reaching the cap
// is SAID on screen rather than silently under-counted.
const _WHS_LOAD_CAP=1000;
const _WHS_CATALOG_STALE_MS=30*3600000;
// The Shopify SKU grammar (shopify-catalog-sync.js ARTICLE_SKU_RE): article
// code, then an optional size — GP092-M → GP092.
const _WHS_SKU_RE=/^([A-Z]{2,3}\d{3,}(?:-[TB])?)(?:-([A-Z0-9]+))?$/;

// ── State ────────────────────────────────────────────────────────────────
let whSales=[];            // newest first
let whSalesLoaded=false;
let _whsLoadErr=null;      // {code,message} when the read FAILED — never shown as an empty list
let _whsLoading=null;
let _whsTruncated=false;   // the read came back at _WHS_LOAD_CAP — older sales are not in whSales
let _whsCatalog=null,_whsCatalogErr=null,_whsCatalogLoading=null,_whsCatalogAt=null;
let _whsFilter='all',_whsQuery='',_whsShown=_WHS_PAGE;
let _whsQueryTimer=null;
let _whsDraft=null;        // the open new-sale form
let _whsHits=[];           // the search results on screen, so Enter picks the first
let _whsBusy=false;
// Raees's confirmations of what the warehouse handed over: acct_entries with
// src 'wh', read ALL-TIME with one single-field query — Store Accounts only
// loads the months after its last close, and a confirmation in a closed month
// must still count, or that sale would come back into Raees's list.
let whsConfirmations=[],whsConfLoaded=false,_whsConfErr=null,_whsConfLoading=null,_whsConfFromCache=false,_whsConfAt=0,_whsSalesAt=0;

// ── Formatting ───────────────────────────────────────────────────────────
function _whsEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function _whsRs(n){const v=Math.round(Number(n)||0);return (v<0?'−':'')+'Rs '+Math.abs(v).toLocaleString('en-US');}
function _whsPad(n){return String(n).padStart(2,'0');}
// LOCAL day, never the UTC ISO string (which names yesterday before 5am PKT).
function _whsDayStr(d){return d.getFullYear()+'-'+_whsPad(d.getMonth()+1)+'-'+_whsPad(d.getDate());}
function whsToday(){return _whsDayStr(new Date());}
function _whsIsDay(s){
  const v=String(s||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(v+'T00:00:00');
  return !isNaN(d)&&_whsDayStr(d)===v;
}
function _whsFmtDay(iso){
  if(!_whsIsDay(iso))return iso||'';
  return new Date(iso+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}
function _whsDaysBetween(a,b){return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);}
function _whsMs(v){
  if(!v)return null;
  if(typeof v==='number')return v;
  if(typeof v.toMillis==='function')return v.toMillis();
  if(typeof v.seconds==='number')return v.seconds*1000;
  const t=Date.parse(v);return isNaN(t)?null:t;
}

// ── Normalisers (pure) ───────────────────────────────────────────────────
/** The order number as a document id, or '' if it cannot be one. */
function whsOrderId(raw){
  const s=String(raw==null?'':raw).trim().toUpperCase().replace(/\s+/g,'');
  return /^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(s)?s:'';
}
/**
 * A Pakistani phone number as digits starting 0, or ''. A MOBILE (03…) is
 * exactly 11 digits — ten would be a number with a digit missing, which
 * looks valid and reaches nobody. A landline (021…, 051…) is 10 or 11.
 */
function whsPhone(raw){
  let d=String(raw==null?'':raw).replace(/\D/g,'');
  if(/^0092\d{10}$/.test(d))d='0'+d.slice(4);
  else if(/^92\d{10}$/.test(d))d='0'+d.slice(2);
  else if(/^3\d{9}$/.test(d))d='0'+d;
  if(/^03/.test(d))return /^03\d{9}$/.test(d)?d:'';
  return /^0[1-9]\d{8,9}$/.test(d)?d:'';
}
/**
 * The digits of a search query that IS a phone number, in the stored form
 * (a leading +92 / 0092 becomes 0), or '' when it is not one. An order
 * number carries digits too — SO0334 — and 0334 is the start of half the
 * mobile numbers in Pakistan, so a query with a letter in it never searches
 * by phone.
 */
function _whsPhoneQuery(q){
  const raw=String(q==null?'':q).trim();
  if(!raw||!/^[\d\s()+.\-]+$/.test(raw))return '';
  let d=raw.replace(/\D/g,'');
  if(/^0092/.test(d))d='0'+d.slice(4);
  else if(/^\+/.test(raw)&&/^92/.test(d))d='0'+d.slice(2);
  else if(/^92\d{10}$/.test(d))d='0'+d.slice(2);
  return d.length>=4?d:'';
}
function whsFmtPhone(p){const d=String(p||'');return /^03\d{9}$/.test(d)?d.slice(0,4)+'-'+d.slice(4):d;}
/** Only an anchored Cloudinary delivery URL — it goes into src/href. */
function whsBillUrl(u){return typeof u==='string'&&/^https:\/\/res\.cloudinary\.com\/[^\s"'<>\\]+$/.test(u);}
function whsArticleCode(sku){const m=_WHS_SKU_RE.exec(String(sku||'').trim().toUpperCase());return m?m[1]:'';}

// ── The catalog ──────────────────────────────────────────────────────────
function whsCatalogFromDoc(id,d){
  const o=d||{};
  const variant=[o.color,o.size,o.option3].map(x=>String(x||'').trim()).filter(x=>x&&x.toLowerCase()!=='default title').join(' / ');
  const price=Number(o.price);
  return{
    id:String(id),
    sku:String(o.sku||'').trim(),
    title:String(o.product_title||'').trim(),
    variant,
    price:isFinite(price)&&price>0?Math.round(price):0,
    status:String(o.status||'')
  };
}
/**
 * Search the catalog. An exact SKU (a barcode scanner types one and presses
 * Enter) ranks first, then a SKU prefix, then every word matching the title,
 * variant or SKU. Archived products are left out; drafts rank after active.
 */
function whsSearchCatalog(catalog,q,limit){
  const raw=String(q||'').trim().toLowerCase();
  const words=raw.split(/\s+/).filter(Boolean);
  if(!words.length)return[];
  const out=[];
  for(const v of catalog||[]){
    if(!v||v.status==='archived')continue;
    const sku=String(v.sku||'').toLowerCase();
    let rank;
    if(sku&&sku===raw)rank=0;
    else if(sku&&words.length===1&&sku.indexOf(raw)===0)rank=1;
    else{
      const hay=(v.title+' '+v.variant+' '+v.sku).toLowerCase();
      if(!words.every(w=>hay.indexOf(w)>=0))continue;
      rank=2;
    }
    out.push({v,rank});
  }
  const act=v=>v.status==='active'?0:1;
  out.sort((a,b)=>a.rank-b.rank||act(a.v)-act(b.v)||(a.v.title+' '+a.v.variant).localeCompare(b.v.title+' '+b.v.variant));
  return out.slice(0,limit||8).map(x=>x.v);
}
function _whsLoadCatalog(){
  if(_whsCatalog)return Promise.resolve();
  if(_whsCatalogLoading)return _whsCatalogLoading;
  _whsCatalogErr=null;
  _whsCatalogLoading=(async()=>{
    try{
      let rows;
      // Inventory Intel's copy, when that page already read it this session.
      if(typeof _siCollectionsLoaded!=='undefined'&&_siCollectionsLoaded&&typeof _siProducts!=='undefined'&&Array.isArray(_siProducts)&&_siProducts.length)
        rows=_siProducts.map(p=>[p._id,p]);
      else{
        const snap=await getDocs(collection(db,'shopify_products'));
        rows=snap.docs.map(d=>[d.id,d.data()]);
      }
      _whsCatalog=rows.map(r=>whsCatalogFromDoc(r[0],r[1])).filter(v=>v.title||v.sku);
    }catch(e){
      _whsCatalogErr=(e&&(e.code||e.message))||'could not read the catalog';
      console.warn('[warehouse-sales] catalog load failed',e);
    }
    try{
      const m=await getDoc(doc(db,'shopify_sync_meta','catalog_sync'));
      const md=m&&typeof m.exists==='function'&&m.exists()?m.data():{};
      _whsCatalogAt=_whsMs(md&&md.last_success_at);
    }catch(_){_whsCatalogAt=null;}
    _whsCatalogLoading=null;
    _whsPaintSearch();
  })();
  return _whsCatalogLoading;
}

// ── Money (pure) ─────────────────────────────────────────────────────────
/**
 * The discount on a subtotal. mode 'none' | 'pct' | 'rs'. Whole rupees, and
 * never more than WHS_MAX_DISCOUNT_PCT of the subtotal: a percentage that
 * rounds a rupee past the cap is held at the cap, a rupee amount over it is
 * refused with the cap named.
 * @returns {{amount:number,pct:number,max:number,error?:string}}
 */
function whsDiscount(subtotal,mode,value){
  const sub=Math.max(0,Math.round(Number(subtotal)||0));
  const max=Math.floor(sub*WHS_MAX_DISCOUNT_PCT/100);
  if(mode!=='pct'&&mode!=='rs')return{amount:0,pct:0,max};
  const raw=String(value==null?'':value).trim();
  if(raw==='')return{amount:0,pct:0,max};
  const v=Number(raw);
  if(!isFinite(v)||v<0)return{amount:0,pct:0,max,error:'The discount must be a number, 0 or more.'};
  let amount;
  if(mode==='pct'){
    if(v>WHS_MAX_DISCOUNT_PCT)return{amount:0,pct:0,max,error:`The discount can be at most ${WHS_MAX_DISCOUNT_PCT}%.`};
    amount=Math.min(Math.round(sub*v/100),max);
  }else{
    amount=Math.round(v);
    if(amount>max)return{amount:0,pct:0,max,error:`The discount can be at most ${WHS_MAX_DISCOUNT_PCT}% — ${_whsRs(max)} on this bill.`};
  }
  const pct=sub?Math.round(amount*10000/sub)/100:0;
  return{amount,pct,max};
}
function whsLineFromVariant(v){
  return{variantId:v.id,sku:v.sku,code:whsArticleCode(v.sku),title:v.title,variant:v.variant,price:v.price||'',catalogPrice:v.price||null,qty:1};
}
function whsManualLine(){return{manual:true,variantId:'',sku:'',code:'',title:'',variant:'',price:'',catalogPrice:null,qty:1};}
/** Totals of the lines as they stand in the form — tolerant of half-typed input. */
function whsLineTotals(lines){
  let qty=0,subtotal=0;
  for(const l of lines||[]){
    const q=Number(l&&l.qty),p=Math.round(Number(l&&l.price));
    const okQ=Number.isInteger(q)&&q>0&&q<=WHS_MAX_QTY;
    if(okQ)qty+=q;
    if(okQ&&isFinite(p)&&p>=1)subtotal+=p*q;
  }
  return{qty,subtotal};
}

/**
 * Turn the form into the document that is written. Pure: every refusal is
 * a message naming what to fix, in the order a person fills the form in.
 * @returns {{error:string}|{id:string,data:object}}
 */
function whsBuildSale(f,ctx){
  f=f||{};ctx=ctx||{};
  const today=ctx.today||whsToday();
  const bill=f.bill||{};
  if(!whsBillUrl(bill.url))return{error:'Attach the bill — a photo of it, or the PDF from the ERP. Every sale needs one.'};
  const id=whsOrderId(f.orderNo);
  if(!id)return{error:'Type the order number exactly as it is printed on the bill (e.g. SO0334).'};
  const date=String(f.date||'');
  if(!_whsIsDay(date))return{error:'Pick the date of the sale.'};
  if(date>today)return{error:'The sale date cannot be in the future.'};
  const name=String(f.customerName||'').trim().replace(/\s+/g,' ');
  if(!name)return{error:'Type the customer\'s name.'};
  if(name.length>80)return{error:'The customer\'s name is too long — 80 characters at most.'};
  const phone=whsPhone(f.customerPhone);
  if(!phone)return{error:'Type the customer\'s phone number — 11 digits, e.g. 0300 1234567.'};
  const src=Array.isArray(f.lines)?f.lines:[];
  if(!src.length)return{error:'Add at least one article.'};
  const lines=[];let qtyTotal=0,subtotal=0,edited=0,manual=0;
  for(let i=0;i<src.length;i++){
    const l=src[i]||{};
    const title=String(l.title||'').trim().replace(/\s+/g,' ');
    const label=title||('line '+(i+1));
    if(l.manual&&!title)return{error:'Type the name of the article that is not in the list (line '+(i+1)+').'};
    if(!l.manual&&!l.variantId)return{error:'"'+label+'" is not linked to the catalog — remove it and pick it again.'};
    const qtyRaw=String(l.qty==null?'':l.qty).trim();
    const qty=Number(qtyRaw);
    if(qtyRaw===''||!Number.isInteger(qty)||qty<1||qty>WHS_MAX_QTY)return{error:'The quantity for "'+label+'" must be a whole number from 1 to '+WHS_MAX_QTY.toLocaleString('en-US')+'.'};
    const priceRaw=String(l.price==null?'':l.price).trim();
    const price=Number(priceRaw);
    // Checked on the ROUNDED rupee that is stored: 0.4 passes "more than 0"
    // and is saved as Rs 0.
    const p=isFinite(price)?Math.round(price):NaN;
    if(priceRaw===''||!isFinite(p)||p<1)return{error:'The price for "'+label+'" must be at least Rs 1.'};
    const cat=l.manual||l.catalogPrice==null||l.catalogPrice===''?null:Math.round(Number(l.catalogPrice));
    const priceEdited=cat!=null&&isFinite(cat)&&cat>0&&p!==cat;
    const line={
      title:title.slice(0,160),
      variant:String(l.variant||'').trim().slice(0,80),
      sku:String(l.sku||'').trim().slice(0,40),
      code:String(l.code||whsArticleCode(l.sku)||''),
      variantId:String(l.variantId||''),
      qty,price:p,total:p*qty
    };
    if(l.manual){line.manual=true;manual++;}
    if(cat!=null&&isFinite(cat)&&cat>0)line.catalogPrice=cat;
    if(priceEdited){line.priceEdited=true;edited++;}
    lines.push(line);qtyTotal+=qty;subtotal+=p*qty;
  }
  const d=whsDiscount(subtotal,f.discMode,f.discVal);
  if(d.error)return{error:d.error};
  const terms=f.terms==='later'?'later':f.terms==='paid'?'paid':'';
  if(!terms)return{error:'Choose how the customer is paying — paid now, or pay later.'};
  let paidVia=null,dueDate=null;
  if(terms==='paid'){
    paidVia=WHS_PAID_VIA.some(v=>v.key===f.paidVia)?f.paidVia:'';
    if(!paidVia)return{error:'Choose how it was paid — cash or bank transfer.'};
  }else{
    dueDate=String(f.dueDate||'');
    if(!_whsIsDay(dueDate))return{error:'Pay later needs a due date — when the customer has promised to pay.'};
    if(dueDate<date)return{error:'The due date cannot be before the date of the sale.'};
  }
  const note=String(f.note||'').trim().slice(0,300);
  const flags=[];
  if(edited)flags.push(edited===1?'price changed on 1 article':'price changed on '+edited+' articles');
  if(manual)flags.push(manual===1?'1 article not in the catalog':manual+' articles not in the catalog');
  return{id,data:{
    orderNo:id,date,month:date.slice(0,7),
    customerName:name,customerPhone:phone,
    lines,qtyTotal,subtotal,discount:d.amount,discountPct:d.pct,total:subtotal-d.amount,
    terms,paidVia,dueDate,note,
    billUrl:bill.url,billKind:bill.kind==='pdf'?'pdf':'image',billName:String(bill.name||'').slice(0,120),
    needsReview:flags.length>0,reviewFlags:flags,
    status:'active',
    createdBy:String(ctx.uid||''),createdByName:String(ctx.name||''),createdByU:String(ctx.u||''),
    createdAt:ctx.now||Date.now()
  }};
}

// ── Reading the ledger (pure) ────────────────────────────────────────────
function _whsLive(s){return s&&s.status!=='void';}
function whsCollected(s){return !!(s&&s.terms==='later'&&s.collectedAt&&WHS_ACCT_OF[s.collectedVia]);}
function whsIsOverdue(s,today){return _whsLive(s)&&s.terms==='later'&&!whsCollected(s)&&_whsIsDay(s.dueDate)&&s.dueDate<(today||whsToday());}

// ── The handover to Raees (26 Sept 2026) ─────────────────────────────────
// A sale that has put money in someone's hand — paid at the counter, or a
// pay-later bill since collected — is waiting for Raees until he confirms
// it. Nothing is copied: the queue is DERIVED from the sales and his
// confirmations, so a sale recorded before this shipped is in it too.
// A version is how many times the bill was recorded before (priorVoids). It
// is written on a confirmation (whSale = ORDER#version) as history, but a
// confirmation is MATCHED BY ORDER NUMBER: a bill voided and recorded again
// is the same order the customer paid once for, so the money Raees already
// received covers the corrected entry too. Asking him to receive it again
// would put the payment in the books twice. If the corrected bill no longer
// matches what he received (another total, cash vs bank), it is CHANGED —
// shown to the owners, never re-queued.
function whsVersion(s){return Array.isArray(s&&s.priorVoids)?s.priorVoids.length:0;}
function whsHandKey(s){return String((s&&(s.orderNo||s._id))||'')+'#'+whsVersion(s);}
function whsOrderOf(s){return String((s&&(s.orderNo||s._id))||'');}
/** The order a confirmation belongs to. */
function whsConfOrder(e){return String((e&&(e.whOrder||String(e.whSale||'').split('#')[0]))||'');}
/** What money this sale put in someone's hand, or null. Pure. The date is
 *  only ever a YYYY-MM-DD day: it is drawn into Raees's page. */
function whsMoneyIn(s){
  if(!_whsLive(s))return null;
  const amount=Math.round(Number(s.total)||0);
  if(amount<=0)return null;
  const day=_whsIsDay(s.date)?s.date:'';
  if(s.terms==='paid'&&WHS_ACCT_OF[s.paidVia])return{via:s.paidVia,account:WHS_ACCT_OF[s.paidVia],date:day,amount,kind:'paid'};
  if(whsCollected(s))return{via:s.collectedVia,account:WHS_ACCT_OF[s.collectedVia],date:_whsIsDay(s.collectedDate)?s.collectedDate:day,amount,kind:'collected'};
  return null;
}
/** Does a live confirmation no longer describe the sale? Pure. */
function whsConfChanged(e,m){
  return Math.round(Number(e&&e.whSaleTotal)||0)!==m.amount||String(e&&e.account||'')!==m.account;
}
/**
 * The sales against Raees's confirmations. Pure.
 *   items    — every sale that put money in hand, each with its live
 *              confirmations (a voided confirmation does not count, so the
 *              sale goes back to the list) and the amount received;
 *   pending  — the ones nobody has confirmed yet;
 *   changed  — confirmed, but the sale no longer matches what was received
 *              (recorded again with another total, or cash vs bank);
 *   orphans  — confirmations whose sale no longer puts money in hand: voided
 *              after Raees received it, or a collection undone. The money
 *              stays in the books; the owners are told.
 *   outside  — confirmations whose sale is not in the read at all while the
 *              read is capped (opts.truncated): older than what was loaded,
 *              so nothing can be said about them — never an orphan.
 */
function whsHandovers(sales,confs,opts){
  opts=opts||{};
  const byOrder=new Map();
  for(const e of confs||[]){
    if(!e||e.status==='void'||!e.whSale)continue;
    const o=whsConfOrder(e);if(!o)continue;
    if(!byOrder.has(o))byOrder.set(o,[]);
    byOrder.get(o).push(e);
  }
  const items=[],seen=new Set(),present=new Set();
  for(const s of sales||[]){
    const o=whsOrderOf(s);present.add(o);
    const m=whsMoneyIn(s);if(!m)continue;
    seen.add(o);
    const got=byOrder.get(o)||[];
    const key=whsHandKey(s);
    items.push({key,sale:s,money:m,confs:got,received:got.reduce((t,e)=>t+Math.round(Number(e.amount)||0),0),
      earlier:got.some(e=>e.whSale!==key),changed:got.some(e=>whsConfChanged(e,m))});
  }
  const orphans=[],outside=[];
  for(const [o,list] of byOrder)if(!seen.has(o))for(const e of list)(opts.truncated&&!present.has(o)?outside:orphans).push(e);
  return{items,pending:items.filter(i=>!i.confs.length),changed:items.filter(i=>i.confs.length&&i.changed),orphans,outside};
}
/** Where one sale stands with Raees, for the warehouse side. */
let _whsConfMapFor=null,_whsConfMapVal=null;
function _whsConfMap(){
  if(_whsConfMapFor===whsConfirmations)return _whsConfMapVal;
  const m=new Map();
  for(const e of whsConfirmations||[]){if(!e||e.status==='void'||!e.whSale)continue;const o=whsConfOrder(e);if(!m.has(o))m.set(o,[]);m.get(o).push(e);}
  _whsConfMapFor=whsConfirmations;_whsConfMapVal=m;return m;
}
function whsHandStatus(s){
  const m=whsMoneyIn(s);if(!m)return null;
  if(!whsConfLoaded||_whsConfErr)return{state:'unknown',money:m};
  const got=_whsConfMap().get(whsOrderOf(s))||[];
  if(!got.length)return{state:'waiting',money:m};
  const received=got.reduce((t,e)=>t+Math.round(Number(e.amount)||0),0);
  return{state:'received',money:m,received,entry:got[0],changed:got.some(e=>whsConfChanged(e,m))};
}
// Never rejects. A failed read leaves the status UNKNOWN — never "not handed
// over", which would send somebody looking for money Raees already has.
// fromCache: offline, the SDK answers from the local cache without failing,
// so a read that did not reach the server says so — Undo collection refuses
// on it rather than trust a copy that may predate Raees's confirmation.
function whsLoadConfirmations(force){
  if(whsConfLoaded&&!force)return Promise.resolve();
  if(_whsConfLoading)return _whsConfLoading;
  _whsConfLoading=(async()=>{
    try{
      const snap=await getDocs(query(collection(db,'acct_entries'),where('src','==','wh')));
      whsConfirmations=snap.docs.map(d=>Object.assign({},d.data(),{_id:d.id}));
      _whsConfFromCache=!!(snap.metadata&&snap.metadata.fromCache);
      _whsConfErr=null;
    }catch(e){
      _whsConfErr={code:(e&&e.code)||'',message:(e&&e.message)||String(e)};
      console.warn('[warehouse-sales] handover read failed',e);
    }
    whsConfLoaded=true;_whsConfAt=Date.now();
    _whsConfLoading=null;
  })();
  return _whsConfLoading;
}
// Both lists are read once and then refreshed when somebody looks again after
// a while, so Raees's queue and Umair's "with Raees" status follow each other
// across devices without a listener. Returns true when a refresh was started.
const _WHS_STALE_MS=60000;
function whsRefreshIfStale(){
  const now=Date.now();let kicked=false;
  if(whsConfLoaded&&!_whsConfLoading&&now-_whsConfAt>_WHS_STALE_MS){whsLoadConfirmations(true);kicked=true;}
  if(whSalesLoaded&&!_whsLoading&&now-_whsSalesAt>_WHS_STALE_MS){loadWhSales(true);kicked=true;}
  return kicked?Promise.all([_whsConfLoading,_whsLoading].filter(Boolean)):null;
}
function whsSummary(sales,today){
  const t=today||whsToday(),m=t.slice(0,7);
  const r={todayTotal:0,todayCount:0,monthTotal:0,monthCount:0,laterTotal:0,laterCount:0,laterCustomers:0,overdueTotal:0,overdueCount:0,reviewCount:0,withMeTotal:0,withMeCount:0};
  const who=new Set();
  for(const s of sales||[]){
    if(!_whsLive(s))continue;
    const amt=Number(s.total)||0;
    if(s.date===t){r.todayTotal+=amt;r.todayCount++;}
    if(String(s.date||'').slice(0,7)===m){r.monthTotal+=amt;r.monthCount++;}
    if(s.terms==='later'&&!whsCollected(s)){r.laterTotal+=amt;r.laterCount++;who.add(s.customerPhone||s.customerName);}
    const h=whsHandStatus(s);
    if(h&&h.state==='waiting'){r.withMeTotal+=h.money.amount;r.withMeCount++;}
    if(whsIsOverdue(s,t)){r.overdueTotal+=amt;r.overdueCount++;}
    if(s.needsReview)r.reviewCount++;
  }
  r.laterCustomers=who.size;
  return r;
}
const WHS_FILTERS=[['all','All sales'],['paid','Paid'],['later','Pay later — to collect'],['collected','Pay later — collected'],['overdue','Overdue'],['handover','Not with Raees yet'],['review','Needs review'],['void','Void']];
function whsFilterSales(sales,filter,q,today){
  const t=today||whsToday();
  const words=String(q||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const digits=_whsPhoneQuery(q);
  return (sales||[]).filter(s=>{
    if(filter==='void'){if(s.status!=='void')return false;}
    else if(filter&&filter!=='all'){
      if(!_whsLive(s))return false;
      if(filter==='paid'&&s.terms!=='paid')return false;
      if(filter==='later'&&(s.terms!=='later'||whsCollected(s)))return false;
      if(filter==='collected'&&!whsCollected(s))return false;
      if(filter==='handover'){const h=whsHandStatus(s);if(!h||h.state!=='waiting')return false;}
      if(filter==='overdue'&&!whsIsOverdue(s,t))return false;
      if(filter==='review'&&!s.needsReview)return false;
    }
    if(!words.length)return true;
    const hay=[s.orderNo,s._id,s.customerName,s.customerPhone,s.note].concat((s.lines||[]).map(l=>(l.title||'')+' '+(l.variant||'')+' '+(l.sku||''))).join(' ').toLowerCase();
    if(words.every(w=>hay.indexOf(w)>=0))return true;
    return !!digits&&String(s.customerPhone||'').indexOf(digits)>=0;
  });
}
/** Past customers, newest spelling of each name, keyed by phone. Derived. */
function whsCustomers(sales){
  const byPhone=new Map();
  for(const s of sales||[]){
    if(!s||!s.customerPhone||byPhone.has(s.customerPhone))continue;
    byPhone.set(s.customerPhone,String(s.customerName||''));
  }
  return byPhone;
}
function _whsSort(){
  whSales.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||(_whsMs(b.createdAt)||0)-(_whsMs(a.createdAt)||0));
}

// ── Loading ──────────────────────────────────────────────────────────────
// Never rejects: renderPage dispatches with no .catch, and a failed read
// must render as a failure, never as an empty ledger.
function loadWhSales(force){
  if(whSalesLoaded&&!force)return Promise.resolve();
  if(_whsLoading)return _whsLoading;
  _whsLoading=(async()=>{
    try{
      const snap=await getDocs(query(collection(db,'wh_sales'),orderBy('createdAt','desc'),limit(_WHS_LOAD_CAP)));
      whSales=snap.docs.map(d=>Object.assign({},d.data(),{_id:d.id}));
      _whsTruncated=snap.docs.length>=_WHS_LOAD_CAP;
      _whsSort();
      _whsLoadErr=null;
    }catch(e){
      _whsLoadErr={code:(e&&e.code)||'',message:(e&&e.message)||String(e)};
      console.warn('[warehouse-sales] load failed',e);
    }
    whSalesLoaded=true;_whsSalesAt=Date.now();
    _whsLoading=null;
  })();
  return _whsLoading;
}
window.whsConfRetry=function(){whsLoadConfirmations(true).then(_whsRepaint);};
window.whsRetry=function(){
  loadWhSales(true).then(_whsRepaint);
  _whsRepaint();
};

// ── Rendering: the section ───────────────────────────────────────────────
function _whsSectionShown(){return typeof _fulfillSection!=='undefined'&&_fulfillSection==='accounts';}
function _whsRepaint(){
  if(!_whsSectionShown())return;
  const b=document.getElementById('fulfill-body');
  if(b)b.innerHTML=whsSectionHTML();
}
function _whsErrorCard(){
  const e=_whsLoadErr||{};
  const denied=/permission/i.test(String(e.code)+' '+String(e.message));
  return `<div class="acct-alert urgent" style="cursor:default;margin-bottom:12px">
    <b>The sales could not be read</b> (wh_sales: ${_whsEsc(e.code||e.message||'unknown error')}).
    ${denied?'The Firestore rules for warehouse sales may not be published yet — republish firestore.rules in the Firebase Console.':'Check the connection and try again.'}
    Nothing is shown below because nothing was read, not because there are no sales.
    <div style="margin-top:8px"><button class="btn-sm" onclick="window.whsRetry()">Retry</button></div>
  </div>`;
}
function _whsTile(label,value,sub,cls){
  return `<div class="acct-tile${cls?' '+cls:''}"><div class="acct-tile-l">${label}</div><div class="acct-tile-v">${value}</div>${sub?`<div class="acct-tile-s">${sub}</div>`:''}</div>`;
}
function _whsBadges(s,today){
  const out=[];
  if(s.status==='void')out.push('<span class="acct-chip">Void</span>');
  else if(whsCollected(s)){
    const via=(WHS_PAID_VIA.find(v=>v.key===s.collectedVia)||{label:'paid'}).label;
    out.push(`<span class="acct-chip ok">Collected · ${_whsEsc(via.toLowerCase())}</span>`);
  }else if(s.terms==='later'){
    if(whsIsOverdue(s,today)){const n=_whsDaysBetween(s.dueDate,today);out.push(`<span class="acct-chip urgent">Overdue · ${n} day${n===1?'':'s'}</span>`);}
    else out.push(`<span class="acct-chip warn">Pay later · due ${_whsEsc(_whsFmtDay(s.dueDate))}</span>`);
  }else{
    const via=(WHS_PAID_VIA.find(v=>v.key===s.paidVia)||{label:'paid'}).label;
    out.push(`<span class="acct-chip ok">Paid · ${_whsEsc(via.toLowerCase())}</span>`);
  }
  const h=whsHandStatus(s);
  if(h&&h.state==='received')out.push(h.changed?'<span class="acct-chip warn">With Raees · bill changed since</span>':'<span class="acct-chip ok">With Raees ✓</span>');
  else if(h&&h.state==='waiting')out.push('<span class="acct-chip warn">Not with Raees yet</span>');
  if(s.status!=='void'&&s.needsReview)out.push('<span class="acct-chip urgent">Review</span>');
  return out.join(' ');
}
function _whsRowHTML(s,today){
  const lines=s.lines||[];
  const first=lines[0]?(lines[0].title+(lines[0].variant?' · '+lines[0].variant:'')):'';
  const more=lines.length>1?` + ${lines.length-1} more`:'';
  const qty=Number(s.qtyTotal)||0;
  return `<div class="whs-row${s.status==='void'?' void':''}" onclick="window.whsOpen('${_whsEsc(s._id)}')">
    <div class="whs-main">
      <div class="whs-top"><span class="whs-ord">${_whsEsc(s.orderNo||s._id)}</span><span>${_whsEsc(_whsFmtDay(s.date))}</span></div>
      <div class="whs-cust">${_whsEsc(s.customerName)}</div>
      <div class="whs-sub">${_whsEsc(whsFmtPhone(s.customerPhone))} · ${qty} item${qty===1?'':'s'}${first?' · '+_whsEsc(first)+_whsEsc(more):''}</div>
    </div>
    <div class="whs-side"><div class="whs-amt">${_whsRs(s.total)}</div><div class="whs-badges">${_whsBadges(s,today)}</div></div>
  </div>`;
}
function whsSectionHTML(){
  if(!whsCanView())return '<div class="empty">Accounts is for the warehouse manager and the owners.</div>';
  if(!whsConfLoaded)whsLoadConfirmations().then(_whsRepaint);
  else{const r=whsRefreshIfStale();if(r)r.then(_whsRepaint);}
  if(!whSalesLoaded){
    loadWhSales().then(_whsRepaint);
    return (typeof gvSkeleton==='function')?gvSkeleton(4):'<div class="empty">Loading…</div>';
  }
  const today=whsToday();
  const sum=whsSummary(whSales,today);
  const list=whsFilterSales(whSales,_whsFilter,_whsQuery,today);
  const shown=list.slice(0,_whsShown);
  const alerts=[];
  if(sum.overdueCount)alerts.push(`<div class="acct-alert urgent" onclick="window.whsSetFilter('overdue')">${sum.overdueCount} pay-later bill${sum.overdueCount===1?' is':'s are'} past the due date — ${_whsRs(sum.overdueTotal)} to collect.</div>`);
  if(sum.withMeCount)alerts.push(`<div class="acct-alert warn" onclick="window.whsSetFilter('handover')">${sum.withMeCount} payment${sum.withMeCount===1?' has':'s have'} not been confirmed by Raees yet — ${_whsRs(sum.withMeTotal)}. Hand the cash over; he confirms it in Store Accounts.</div>`);
  if(whsConfLoaded&&_whsConfErr)alerts.push(`<div class="acct-alert urgent" style="cursor:default">Could not read what Raees has confirmed (acct_entries: ${_whsEsc(_whsConfErr.code||_whsConfErr.message||'error')}) — the "with Raees" status is not shown. <button class="btn-sm" onclick="event.stopPropagation();window.whsConfRetry()">Retry</button></div>`);
  if(sum.reviewCount&&_whsIsOwner())alerts.push(`<div class="acct-alert warn" onclick="window.whsSetFilter('review')">${sum.reviewCount} sale${sum.reviewCount===1?'':'s'} to review — a price that differs from the catalog, or an article that is not in it.</div>`);
  return `<div id="whs-root">
    ${_whsLoadErr?_whsErrorCard():''}
    ${_whsTruncated?`<div class="acct-alert warn" style="cursor:default;margin-bottom:12px">Only the newest ${_WHS_LOAD_CAP.toLocaleString('en-US')} sales are loaded. Anything older is left out of the totals, the overdue count, the list and the export below.</div>`:''}
    <div class="acct-tiles">
      ${_whsTile('Today',_whsRs(sum.todayTotal),sum.todayCount+' sale'+(sum.todayCount===1?'':'s'))}
      ${_whsTile('This month',_whsRs(sum.monthTotal),sum.monthCount+' sale'+(sum.monthCount===1?'':'s'))}
      ${_whsTile('Not with Raees yet',_whsConfErr||!whsConfLoaded?'—':_whsRs(sum.withMeTotal),_whsConfErr?'could not be read':!whsConfLoaded?'loading…':sum.withMeCount?sum.withMeCount+' payment'+(sum.withMeCount===1?'':'s')+' waiting for Raees':'everything handed over',sum.withMeCount?'warn':'')}
      ${_whsTile('Pay later — to collect',_whsRs(sum.laterTotal),sum.laterCount?sum.laterCount+' bill'+(sum.laterCount===1?'':'s')+' · '+sum.laterCustomers+' customer'+(sum.laterCustomers===1?'':'s'):'nothing outstanding')}
      ${_whsTile('Overdue',_whsRs(sum.overdueTotal),sum.overdueCount?sum.overdueCount+' past the due date':'none',sum.overdueCount?'danger':'')}
    </div>
    ${alerts.length?`<div class="acct-alerts">${alerts.join('')}</div>`:''}
    <div class="card whs-card">
      <div class="acct-toolbar">
        ${whsCanEntry()?'<button class="btn-primary whs-new" onclick="window.whsNewSale()">+ Record a sale</button>':''}
        <select class="acct-sel" aria-label="Show" onchange="window.whsSetFilter(this.value)">${WHS_FILTERS.map(f=>`<option value="${f[0]}"${_whsFilter===f[0]?' selected':''}>${f[1]}</option>`).join('')}</select>
        <input id="whs-find" class="acct-sel whs-find" type="search" placeholder="Order #, customer, phone or article" value="${_whsEsc(_whsQuery)}" oninput="window.whsFind(this.value)">
        <button class="btn-sm btn-outline" onclick="window.whsExport()">Export Excel</button>
      </div>
      <div id="whs-list" class="whs-list">
        ${shown.length?shown.map(s=>_whsRowHTML(s,today)).join(''):`<div class="empty" style="padding:18px">${whSales.length?'No sale matches this filter.':(_whsLoadErr?'—':'No sales recorded yet. Press “+ Record a sale” with the ERP bill in hand.')}</div>`}
      </div>
      ${list.length>shown.length?`<div class="acct-pager"><button class="btn-sm btn-outline" onclick="window.whsMore()">Show ${Math.min(_WHS_PAGE,list.length-shown.length)} more</button> <span>${shown.length} of ${list.length}</span></div>`:''}
    </div>
    <div class="whs-foot-note">Paid sales, and pay-later bills once you mark them collected, go to Raees's Store Accounts. They count in his books only after he confirms he received the money: cash into the drawer, a bank transfer into MCB.</div>
  </div>`;
}
window.whsSetFilter=function(f){_whsFilter=WHS_FILTERS.some(x=>x[0]===f)?f:'all';_whsShown=_WHS_PAGE;_whsRepaint();};
window.whsMore=function(){_whsShown+=_WHS_PAGE;_whsRepaint();};
// Debounced, and the box keeps its caret across the repaint (the
// fabInvSetSearch pattern).
window.whsFind=function(v){
  _whsQuery=String(v||'');
  clearTimeout(_whsQueryTimer);
  _whsQueryTimer=setTimeout(()=>{
    _whsShown=_WHS_PAGE;
    _whsRepaint();
    const el=document.getElementById('whs-find');
    if(el&&typeof el.focus==='function'){el.focus();try{el.setSelectionRange(el.value.length,el.value.length);}catch(_){}}
  },180);
};

// ── Modal ────────────────────────────────────────────────────────────────
// The Store Accounts modal's look (.acct-modal), under its own id, so the
// two can never close each other.
function _whsModal(title,body,foot,opts){
  opts=opts||{};
  const old=document.getElementById('whs-modal');if(old)old.remove();
  const m=document.createElement('div');m.id='whs-modal';m.className='acct-modal-back';
  m.innerHTML=`<div class="acct-modal" style="max-width:${opts.width||560}px" role="dialog" aria-modal="true">
    <div class="acct-modal-head"><span>${title}</span><button class="acct-x" onclick="window.whsModalClose()" aria-label="Close">×</button></div>
    <div class="acct-modal-body">${body}</div>
    ${foot?`<div class="acct-modal-foot">${foot}</div>`:''}
  </div>`;
  if(typeof m.addEventListener==='function')m.addEventListener('click',ev=>{if(ev.target===m&&!opts.sticky)window.whsModalClose();});
  document.body.appendChild(m);
}
window.whsModalClose=function(){const m=document.getElementById('whs-modal');if(m)m.remove();};

// ── The new-sale form ────────────────────────────────────────────────────
function _whsChips(group,opts,sel){
  return `<div class="acct-chips" id="whs-${group}-chips">${opts.map(o=>`<button type="button" class="acct-chipbtn${sel===o[0]?' on':''}" data-v="${o[0]}" onclick="window.whsChip('${group}','${o[0]}')">${o[1]}${o[2]?`<small>${o[2]}</small>`:''}</button>`).join('')}</div>`;
}
function _whsFormHTML(){
  const today=whsToday();
  const names=[...whsCustomers(whSales).values()].filter(Boolean);
  return `<div class="whs-form">
    <div class="whs-h">The bill *</div>
    <div class="whs-billrow">
      <label for="whs-bill-cam" class="acct-photo-btn">📷 Take a photo</label>
      <input id="whs-bill-cam" type="file" accept="image/*" capture="environment" style="display:none" onchange="window.whsBillPicked(this)">
      <label for="whs-bill-file" class="acct-photo-btn">📄 Upload a photo or PDF</label>
      <input id="whs-bill-file" type="file" accept="image/*,application/pdf,.pdf" style="display:none" onchange="window.whsBillPicked(this)">
    </div>
    <div id="whs-bill-st" class="whs-billst">${_whsBillStatusHTML()}</div>

    <div class="form-grid whs-grid">
      <div class="field"><label>Order # (from the bill) *</label><input id="whs-order" placeholder="e.g. SO0334" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
      <div class="field"><label>Date of sale *</label><input id="whs-date" type="date" value="${today}" max="${today}"></div>
      <div class="field"><label>Customer name *</label><input id="whs-name" list="whs-names" autocomplete="off" oninput="window.whsNameInput(this.value)"><datalist id="whs-names">${names.map(n=>`<option value="${_whsEsc(n)}">`).join('')}</datalist></div>
      <div class="field"><label>Phone number *</label><input id="whs-phone" type="tel" inputmode="tel" placeholder="0300 1234567" autocomplete="off" onblur="window.whsPhoneBlur(this.value)"></div>
    </div>

    <div class="whs-h">Articles *</div>
    <div class="whs-search">
      <input id="whs-q" class="whs-q" type="search" placeholder="Search a name, or type / scan the barcode (e.g. GP092-M)" autocomplete="off" spellcheck="false" oninput="window.whsSearchInput()" onkeydown="window.whsSearchKey(event)">
      <div id="whs-results" class="whs-results"></div>
    </div>
    <div id="whs-catnote" class="whs-catnote">${_whsCatalogNoteHTML()}</div>
    <div id="whs-lines" class="whs-lines">${_whsLinesHTML()}</div>
    <button type="button" class="whs-add-manual" onclick="window.whsAddManual()">+ An article that is not in the list</button>

    <div class="whs-h">Discount <span class="whs-hint">— ${WHS_MAX_DISCOUNT_PCT}% at most</span></div>
    ${_whsChips('disc',[['none','No discount'],['pct','Percent'],['rs','Rupees']],_whsDraft.discMode)}
    <div id="whs-disc-wrap" class="whs-disc" style="${_whsDraft.discMode==='none'?'display:none':''}">
      <input id="whs-disc" type="number" inputmode="decimal" min="0" placeholder="${_whsDraft.discMode==='rs'?'Rs':'%'}" oninput="window.whsPaintSummary()">
      <span id="whs-disc-hint" class="whs-hint"></span>
    </div>

    <div class="whs-h">Payment *</div>
    ${_whsChips('terms',[['paid','Paid now'],['later','Pay later','due date']],_whsDraft.terms)}
    <div id="whs-paid-wrap" style="${_whsDraft.terms==='paid'?'':'display:none'};margin-top:8px">
      ${_whsChips('via',WHS_PAID_VIA.map(v=>[v.key,v.label]),_whsDraft.paidVia)}
    </div>
    <div id="whs-later-wrap" class="field" style="${_whsDraft.terms==='later'?'':'display:none'};margin-top:8px;max-width:260px">
      <label>Due date — when the customer will pay *</label><input id="whs-due" type="date">
    </div>

    <div class="field" style="margin-top:12px"><label>Note</label><input id="whs-note" maxlength="300" placeholder="e.g. Awaiting payment"></div>
    <div id="whs-sum" class="whs-sum">${_whsSummaryHTML()}</div>
  </div>`;
}
// fromId: a VOIDED sale to record again — the correction for a bill that
// was entered wrong. The form opens holding everything the voided entry
// held (bill, customer, articles, payment), so only what was wrong needs
// changing.
window.whsNewSale=function(fromId){
  if(!whsCanEntry())return;
  const from=fromId?_whsById(fromId):null;
  const again=!!(from&&from.status==='void');
  _whsDraft={lines:[],discMode:'none',terms:'',paidVia:'',bill:null,uploading:false,billSeq:0,autoPhone:'',fromVoid:again?from._id:''};
  if(again){
    _whsDraft.lines=(from.lines||[]).filter(Boolean).map(l=>({
      manual:!!l.manual||!l.variantId,variantId:String(l.variantId||''),sku:String(l.sku||''),code:String(l.code||''),
      title:String(l.title||''),variant:String(l.variant||''),price:String(l.price==null?'':l.price),
      catalogPrice:l.catalogPrice==null?null:l.catalogPrice,qty:l.qty
    }));
    if(Number(from.discount)>0)_whsDraft.discMode='rs';
    _whsDraft.terms=from.terms==='later'?'later':from.terms==='paid'?'paid':'';
    _whsDraft.paidVia=WHS_PAID_VIA.some(v=>v.key===from.paidVia)?from.paidVia:'';
    if(whsBillUrl(from.billUrl))_whsDraft.bill={url:from.billUrl,kind:from.billKind==='pdf'?'pdf':'image',name:String(from.billName||'')};
  }
  // The previous form's search results must not survive into this one, or
  // a stray Enter (a scanner sends one) adds an article nobody searched for.
  _whsHits=[];
  _whsLoadCatalog();
  _whsModal(again?'Record '+_whsEsc(from._id)+' again':'Record a customer purchase',_whsFormHTML(),
    `<button class="btn-outline" onclick="window.whsModalClose()">Cancel</button><button class="btn-primary" id="whs-save" onclick="window.whsSaveSale()">Save sale</button>`,
    {sticky:true,width:760});
  if(again){
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v==null?'':String(v);};
    set('whs-order',from.orderNo||from._id);set('whs-date',from.date);
    set('whs-name',from.customerName);set('whs-phone',whsFmtPhone(from.customerPhone));
    if(Number(from.discount)>0)set('whs-disc',from.discount);
    set('whs-due',from.dueDate||'');set('whs-note',from.note||'');
    window.whsPaintSummary();
  }
};
window.whsChip=function(group,v){
  if(!_whsDraft)return;
  if(group==='disc'){
    _whsDraft.discMode=['none','pct','rs'].indexOf(v)>=0?v:'none';
    const w=document.getElementById('whs-disc-wrap');if(w)w.style.display=_whsDraft.discMode==='none'?'none':'';
    const i=document.getElementById('whs-disc');if(i){i.placeholder=_whsDraft.discMode==='rs'?'Rs':'%';if(_whsDraft.discMode==='none')i.value='';}
  }else if(group==='terms'){
    _whsDraft.terms=v==='later'?'later':'paid';
    const p=document.getElementById('whs-paid-wrap');if(p)p.style.display=_whsDraft.terms==='paid'?'':'none';
    const l=document.getElementById('whs-later-wrap');if(l)l.style.display=_whsDraft.terms==='later'?'':'none';
  }else if(group==='via'){
    _whsDraft.paidVia=WHS_PAID_VIA.some(x=>x.key===v)?v:'';
  }
  const set=_whsDraft[group==='disc'?'discMode':group==='terms'?'terms':'paidVia'];
  document.querySelectorAll('#whs-'+group+'-chips .acct-chipbtn').forEach(b=>b.classList.toggle('on',b.dataset.v===set));
  window.whsPaintSummary();
};
// A known customer: the phone fills the name, the name fills the phone.
window.whsPhoneBlur=function(v){
  const p=whsPhone(v);if(!p)return;
  const nm=document.getElementById('whs-name');
  const known=whsCustomers(whSales).get(p);
  if(nm&&known&&!String(nm.value||'').trim())nm.value=known;
};
// This runs on every keystroke, so a new customer whose name STARTS with a
// known one ("Ali" on the way to "Ali Raza") matches for a moment. The fill
// is therefore reversible: a phone this handler put in is taken back out the
// moment the name stops matching — unless it has been edited since, in which
// case it is Umair's and stays.
window.whsNameInput=function(v){
  const ph=document.getElementById('whs-phone');
  if(!ph||!_whsDraft)return;
  const want=String(v||'').trim().toLowerCase();
  let hit='';
  if(want)for(const [p,n] of whsCustomers(whSales)){if(String(n).trim().toLowerCase()===want){hit=whsFmtPhone(p);break;}}
  const cur=String(ph.value||'').trim();
  if(_whsDraft.autoPhone&&cur===_whsDraft.autoPhone&&cur!==hit){ph.value='';_whsDraft.autoPhone='';}
  if(hit&&!String(ph.value||'').trim()){ph.value=hit;_whsDraft.autoPhone=hit;}
};

// ── The bill ─────────────────────────────────────────────────────────────
function _whsThumbUrl(url){return whsBillUrl(url)&&url.indexOf('/upload/')>0?url.replace('/upload/','/upload/w_600,f_auto,q_auto/'):url;}
function _whsBillStatusHTML(){
  const d=_whsDraft;
  if(!d)return '';
  if(d.uploading)return '<span class="whs-muted">Uploading the bill…</span>';
  if(d.billError)return `<span class="whs-err">${_whsEsc(d.billError)}</span>`;
  const b=d.bill;
  if(!b||!whsBillUrl(b.url))return '<span class="whs-muted">No bill attached yet — the sale cannot be saved without it.</span>';
  const view=`<a href="${_whsEsc(b.url)}" target="_blank" rel="noopener noreferrer">view</a>`;
  if(b.kind==='pdf')return `<span class="whs-ok">✓ PDF attached</span> <span class="whs-muted">${_whsEsc(b.name||'')}</span> · ${view} · <button type="button" class="acct-link" onclick="window.whsBillClear()">remove</button>`;
  return `<span class="whs-billthumb"><img src="${_whsEsc(_whsThumbUrl(b.url))}" alt="The bill" onerror="this.style.display='none'"></span><span class="whs-ok">✓ Photo attached</span> · ${view} · <button type="button" class="acct-link" onclick="window.whsBillClear()">remove</button>`;
}
function _whsPaintBill(){const st=document.getElementById('whs-bill-st');if(st)st.innerHTML=_whsBillStatusHTML();}
async function _whsUpload(file){
  if(typeof FormData==='undefined')throw new Error('This browser cannot upload files.');
  const fd=new FormData();
  fd.append('file',file);
  fd.append('upload_preset','groovy-ops');
  const r=await fetch('https://api.cloudinary.com/v1_1/deww4lpym/auto/upload',{method:'POST',body:fd});
  let d={};try{d=await r.json();}catch(_){d={};}
  const url=d&&d.secure_url;
  // Re-checked here, the moment not to trust a URL.
  if(!whsBillUrl(url))throw new Error((d&&d.error&&d.error.message)||'The upload did not come back with a file.');
  return{url,format:String(d.format||'')};
}
window.whsBillPicked=async function(inp){
  const file=inp&&inp.files&&inp.files[0];
  if(!file||!_whsDraft)return;
  const isPdf=/pdf/i.test(file.type||'')||/\.pdf$/i.test(file.name||'');
  const isImg=/^image\//i.test(file.type||'');
  _whsDraft.billError='';
  if(!isPdf&&!isImg){_whsDraft.billError='That file is neither a photo nor a PDF.';inp.value='';_whsPaintBill();return;}
  if(file.size>WHS_MAX_UPLOAD_MB*1024*1024){_whsDraft.billError=`That file is ${(file.size/1048576).toFixed(1)} MB — ${WHS_MAX_UPLOAD_MB} MB at most.`;inp.value='';_whsPaintBill();return;}
  const draft=_whsDraft;
  // THE LATEST PICK WINS. Two uploads can be in flight at once (a photo of
  // the wrong paper, then the right PDF straight after), and they can finish
  // in either order; an upload that is no longer the latest pick — or was
  // removed while it ran — changes nothing when it lands, and only the
  // latest one ends "Uploading…".
  const seq=draft.billSeq=(draft.billSeq||0)+1;
  draft.uploading=true;_whsPaintBill();
  try{
    const res=await _whsUpload(file);
    if(draft.billSeq===seq)draft.bill={url:res.url,kind:isPdf||/^pdf$/i.test(res.format)?'pdf':'image',name:String(file.name||'')};
  }catch(e){
    if(draft.billSeq===seq){
      draft.bill=null;
      draft.billError='The bill did not upload: '+((e&&e.message)||e)+'. Try again.';
    }
  }finally{
    if(draft.billSeq===seq)draft.uploading=false;
    try{inp.value='';}catch(_){}
    if(_whsDraft===draft)_whsPaintBill();
  }
};
window.whsBillClear=function(){
  if(!_whsDraft)return;
  _whsDraft.billSeq=(_whsDraft.billSeq||0)+1;  // an upload still running is now stale
  _whsDraft.bill=null;_whsDraft.billError='';_whsDraft.uploading=false;
  _whsPaintBill();
};

// ── Articles ─────────────────────────────────────────────────────────────
function _whsCatalogNoteHTML(){
  if(_whsCatalogErr)return `<span class="whs-err">The product list could not be loaded (${_whsEsc(_whsCatalogErr)}). An article can still be typed in with “+ An article that is not in the list”.</span>`;
  if(!_whsCatalog)return '<span class="whs-muted">Loading the product list…</span>';
  if(!_whsCatalogAt)return `<span class="whs-muted">${_whsCatalog.length} products and sizes, copied from Shopify.</span>`;
  const stale=Date.now()-_whsCatalogAt>_WHS_CATALOG_STALE_MS;
  const when=new Date(_whsCatalogAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  return `<span class="${stale?'whs-err':'whs-muted'}">Product list as of ${_whsEsc(when)} — copied from Shopify once a day, so a product added since then is not here yet${stale?'. This copy is more than a day old.':'.'}</span>`;
}
function _whsPaintSearch(){
  const note=document.getElementById('whs-catnote');if(note)note.innerHTML=_whsCatalogNoteHTML();
  const box=document.getElementById('whs-results');if(!box)return;
  const q=(document.getElementById('whs-q')||{}).value||'';
  if(!String(q).trim()){box.innerHTML='';_whsHits=[];return;}
  if(!_whsCatalog){box.innerHTML='';_whsHits=[];return;}
  _whsHits=whsSearchCatalog(_whsCatalog,q,8);
  box.innerHTML=_whsHits.length
    ?_whsHits.map((v,i)=>`<button type="button" class="whs-hit${i===0?' first':''}" onclick="window.whsPick('${_whsEsc(v.id)}')"><span class="whs-hit-t">${_whsEsc(v.title)}${v.variant?` <span class="whs-muted">· ${_whsEsc(v.variant)}</span>`:''}</span><span class="whs-hit-m"><span class="whs-sku">${_whsEsc(v.sku||'no SKU')}</span><b>${v.price?_whsRs(v.price):'no price'}</b></span></button>`).join('')
    :'<div class="whs-nohit">Nothing matches. Check the spelling or the barcode — or add it as an article that is not in the list.</div>';
}
window.whsSearchInput=function(){_whsPaintSearch();};
window.whsSearchKey=function(e){
  if(!e)return;
  if(e.key==='Enter'){
    e.preventDefault&&e.preventDefault();
    const q=(document.getElementById('whs-q')||{}).value||'';
    if(String(q).trim()&&_whsHits[0])window.whsPick(_whsHits[0].id);
  }else if(e.key==='Escape'){
    const q=document.getElementById('whs-q');if(q)q.value='';
    _whsPaintSearch();
  }
};
window.whsPick=function(id){
  if(!_whsDraft||!_whsCatalog)return;
  const v=_whsCatalog.find(x=>x.id===String(id));if(!v)return;
  // The same size picked twice is one line with a bigger quantity.
  const have=_whsDraft.lines.find(l=>!l.manual&&l.variantId===v.id);
  if(have){const q=Number(have.qty);have.qty=Number.isInteger(q)&&q>0?q+1:1;}
  else _whsDraft.lines.push(whsLineFromVariant(v));
  const q=document.getElementById('whs-q');if(q){q.value='';if(typeof q.focus==='function')q.focus();}
  _whsPaintSearch();
  _whsPaintLines();
};
window.whsAddManual=function(){if(!_whsDraft)return;_whsDraft.lines.push(whsManualLine());_whsPaintLines();};
window.whsLineRemove=function(i){if(!_whsDraft)return;_whsDraft.lines.splice(i,1);_whsPaintLines();};
// Typing never rebuilds the lines — the caret stays where it is. Only the
// line's own total, its flag and the summary repaint.
window.whsLineSet=function(i,k,v){
  const l=_whsDraft&&_whsDraft.lines[i];if(!l)return;
  if(k==='qty'||k==='price'||(l.manual&&k==='title'))l[k]=v;
  const t=document.getElementById('whs-ltot-'+i);if(t)t.textContent=_whsLineTotalText(l);
  const f=document.getElementById('whs-lflag-'+i);if(f)f.innerHTML=_whsLineFlagHTML(l);
  window.whsPaintSummary();
};
function _whsLineTotalText(l){
  const q=Number(l.qty),p=Math.round(Number(l.price));
  return Number.isInteger(q)&&q>0&&q<=WHS_MAX_QTY&&isFinite(p)&&p>=1?_whsRs(p*q):'—';
}
function _whsLineFlagHTML(l){
  if(l.manual)return '<span class="whs-flag">Not in the catalog — flagged for the owners to review.</span>';
  const p=Math.round(Number(l.price)),c=Number(l.catalogPrice);
  if(isFinite(p)&&c>0&&p!==Math.round(c))return `<span class="whs-flag">Catalog price is ${_whsRs(c)} — a different price is flagged for review.</span>`;
  return '';
}
function _whsLinesHTML(){
  const d=_whsDraft;
  if(!d||!d.lines.length)return '<div class="whs-nolines">No articles yet — search above, or scan the barcode.</div>';
  return d.lines.map((l,i)=>`<div class="whs-line" id="whs-line-${i}">
    <div class="whs-lname">${l.manual
      ?`<input class="whs-lin" placeholder="Article name, as on the bill" value="${_whsEsc(l.title)}" oninput="window.whsLineSet(${i},'title',this.value)">`
      :`<b>${_whsEsc(l.title)}</b><small>${_whsEsc(l.variant||'')}${l.variant&&l.sku?' · ':''}${_whsEsc(l.sku||'')}</small>`}</div>
    <label class="whs-num"><span>Qty</span><input inputmode="numeric" value="${_whsEsc(l.qty)}" oninput="window.whsLineSet(${i},'qty',this.value)"></label>
    <label class="whs-num"><span>Price</span><input inputmode="numeric" value="${_whsEsc(l.price)}" oninput="window.whsLineSet(${i},'price',this.value)"></label>
    <div class="whs-ltot" id="whs-ltot-${i}">${_whsLineTotalText(l)}</div>
    <button type="button" class="acct-x whs-lx" onclick="window.whsLineRemove(${i})" aria-label="Remove this article">×</button>
    <div class="whs-lflag" id="whs-lflag-${i}">${_whsLineFlagHTML(l)}</div>
  </div>`).join('');
}
function _whsPaintLines(){const b=document.getElementById('whs-lines');if(b)b.innerHTML=_whsLinesHTML();window.whsPaintSummary();}

// ── Summary ──────────────────────────────────────────────────────────────
function _whsSummaryHTML(){
  const d=_whsDraft;if(!d)return '';
  const t=whsLineTotals(d.lines);
  const discVal=(document.getElementById('whs-disc')||{}).value;
  const disc=whsDiscount(t.subtotal,d.discMode,discVal);
  const row=(k,v,cls)=>`<div class="whs-srow${cls?' '+cls:''}"><span>${k}</span><b>${v}</b></div>`;
  return row('Items',String(t.qty))
    +row('Subtotal',_whsRs(t.subtotal))
    +(d.discMode!=='none'&&(disc.amount||disc.error)?row('Discount'+(disc.amount?` (${disc.pct}%)`:''),disc.error?'—':'−'+_whsRs(disc.amount)):'')
    +(disc.error?`<div class="whs-err" style="margin:4px 0">${_whsEsc(disc.error)}</div>`:'')
    +`<div class="acct-total"><span>Total</span><b>${_whsRs(t.subtotal-(disc.error?0:disc.amount))}</b></div>`;
}
window.whsPaintSummary=function(){
  const s=document.getElementById('whs-sum');if(s)s.innerHTML=_whsSummaryHTML();
  const h=document.getElementById('whs-disc-hint');
  if(h&&_whsDraft){const t=whsLineTotals(_whsDraft.lines);h.textContent=t.subtotal?`at most ${_whsRs(Math.floor(t.subtotal*WHS_MAX_DISCOUNT_PCT/100))} on this bill`:'';}
};

// ── Saving ───────────────────────────────────────────────────────────────
function _whsDupMsg(s){
  const who=s&&_whsWho(s.createdByU,s.createdByName);
  return `Order ${s&&(s.orderNo||s._id)} is already recorded${s&&s.date?' ('+_whsFmtDay(s.date)+(who?', by '+who:'')+')':''}. One bill, one sale — if it was entered wrong, open it from the list, void it, and record the bill again.`;
}
// The record of a voided entry, kept on the sale that replaces it. Only
// plain values — no nested arrays, which Firestore refuses outright — and
// every earlier entry carried forward as it is, because firestore.rules
// requires the history to grow by exactly one.
function _whsPriorVoids(old){
  const prev=Array.isArray(old&&old.priorVoids)?old.priorVoids.slice():[];
  const t=v=>String(v==null?'':v);
  prev.push({
    date:t(old.date),customerName:t(old.customerName),customerPhone:t(old.customerPhone),
    total:Number(old.total)||0,qtyTotal:Number(old.qtyTotal)||0,
    createdAt:_whsMs(old.createdAt)||0,createdByU:t(old.createdByU),createdByName:t(old.createdByName),
    voidedAt:_whsMs(old.voidedAt)||0,voidedBy:t(old.voidedBy),voidedByName:t(old.voidedByName),voidReason:t(old.voidReason).slice(0,200),
    billUrl:whsBillUrl(old.billUrl)?old.billUrl:''
  });
  return prev;
}
function _whsWriteErrMsg(e){
  const c=String((e&&e.code)||'')+' '+String((e&&e.message)||'');
  if(/permission/i.test(c))return 'The server refused this sale. Either the Firestore rules for warehouse sales are not published yet (ask Afnan to republish firestore.rules), or the sale broke one of their checks — send Afnan a screenshot of this.';
  if(/unavailable|offline|network|failed-precondition/i.test(c))return 'No connection. A sale is checked against the server for a duplicate bill, so it needs to be online — try again when connected.';
  return 'The sale was not saved: '+((e&&e.message)||e);
}
function _whsSaveBtn(on,label){const b=document.getElementById('whs-save');if(b){b.disabled=!on;b.textContent=label;}}
window.whsSaveSale=async function(){
  if(!whsCanEntry()||!_whsDraft||_whsBusy)return;
  if(_whsDraft.uploading){showToast('Wait for the bill to finish uploading.',true);return;}
  const g=id=>{const el=document.getElementById(id);return el?el.value:'';};
  const s=_whsSession()||{};
  const r=whsBuildSale({
    orderNo:g('whs-order'),date:g('whs-date'),customerName:g('whs-name'),customerPhone:g('whs-phone'),
    lines:_whsDraft.lines,discMode:_whsDraft.discMode,discVal:g('whs-disc'),
    terms:_whsDraft.terms,paidVia:_whsDraft.paidVia,dueDate:g('whs-due'),note:g('whs-note'),
    bill:_whsDraft.bill||{}
  },{today:whsToday(),uid:_whsUid(),name:s.name,u:s.u,now:Date.now()});
  if(r.error){showToast(r.error,true);return;}
  // ONE BILL, ONE SALE — except that a VOIDED entry is not a sale. Void,
  // never edit, means the correction for a bill entered wrong is to void it
  // and record the bill again, so a voided order number is free to take the
  // new entry; the voided one is kept in the new entry's history.
  const local=whSales.find(x=>x._id===r.id);
  if(local&&local.status!=='void'){showToast(_whsDupMsg(local),true);return;}
  if(local&&_whsDraft.fromVoid!==r.id&&!confirm(`${r.id} was recorded before and voided${local.voidReason?' ('+local.voidReason+')':''}.\n\nRecord this bill again? The voided entry is kept in its history.`))return;
  _whsBusy=true;_whsSaveBtn(false,'Saving…');
  let written=r.data,again=false;
  try{
    await runTransaction(db,async tx=>{
      const ref=doc(db,'wh_sales',r.id);
      const snap=await tx.get(ref);
      written=r.data;again=false;
      if(snap&&typeof snap.exists==='function'&&snap.exists()){
        const old=snap.data()||{};
        if(old.status!=='void'){const e=new Error('duplicate');e.dup=Object.assign({_id:r.id},old);throw e;}
        written=Object.assign({},r.data,{priorVoids:_whsPriorVoids(old)});again=true;
      }
      tx.set(ref,written);
    });
  }catch(e){
    _whsBusy=false;_whsSaveBtn(true,'Save sale');
    showToast(e&&e.dup?_whsDupMsg(e.dup):_whsWriteErrMsg(e),true);
    return;
  }
  _whsBusy=false;
  whSales=whSales.filter(x=>x._id!==r.id);
  whSales.unshift(Object.assign({},written,{_id:r.id}));
  _whsSort();
  try{logActivity(again?'Warehouse sale recorded again':'Warehouse sale recorded',`${r.id} · ${r.data.customerName} · ${_whsRs(r.data.total)}${r.data.terms==='later'?' · pay later, due '+r.data.dueDate:''}`);}catch(_){}
  window.whsModalClose();
  _whsDraft=null;
  showToast(`Sale ${r.id} ${again?'recorded again':'recorded'} — ${_whsRs(r.data.total)}${r.data.needsReview?' · flagged for review':''}`);
  _whsRepaint();
};

// ── One sale ─────────────────────────────────────────────────────────────
function _whsById(id){return whSales.find(s=>s._id===String(id))||null;}
function _whsHistoryHTML(s){
  const h=Array.isArray(s&&s.priorVoids)?s.priorVoids.filter(x=>x&&typeof x==='object'):[];
  if(!h.length)return '';
  return `<div class="whs-hist"><div class="whs-h" style="margin-top:14px">Recorded before and voided</div>${h.map(p=>`<div class="whs-hist-row">
    <b>${_whsRs(p.total)}</b> · ${_whsEsc(_whsFmtDay(p.date))} · recorded by ${_whsEsc(_whsWho(p.createdByU,p.createdByName))}
    <div class="whs-muted">Voided by ${_whsEsc(_whsWho(p.voidedBy,p.voidedByName))}${p.voidedAt?' · '+_whsEsc(new Date(p.voidedAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})):''} — ${_whsEsc(p.voidReason||'no reason given')}</div>
  </div>`).join('')}</div>`;
}
function _whsKV(k,v){return `<div class="acct-kv"><span>${k}</span><b>${v}</b></div>`;}
window.whsOpen=function(id){
  const s=_whsById(id);if(!s)return;
  const today=whsToday();
  const viaLabel=k=>_whsEsc((WHS_PAID_VIA.find(v=>v.key===k)||{label:'—'}).label);
  const pay=whsCollected(s)
    ?`Pay later — collected ${_whsEsc(_whsFmtDay(s.collectedDate))} · ${viaLabel(s.collectedVia)}<div class="whs-muted" style="font-weight:400">by ${_whsEsc(_whsWho(s.collectedBy,s.collectedByName))}, was due ${_whsEsc(_whsFmtDay(s.dueDate))}</div>`
    :s.terms==='later'
    ?`Pay later — due ${_whsEsc(_whsFmtDay(s.dueDate))}${whsIsOverdue(s,today)?' <span class="acct-chip urgent">overdue</span>':''}`
    :`Paid · ${viaLabel(s.paidVia)}`;
  const h=whsHandStatus(s);
  const handed=!h?'':h.state==='unknown'
    ?(_whsConfErr?'Could not be read — see the note on the list':'Checking…')
    :h.state==='waiting'
    ?`<span class="acct-chip warn">Not with Raees yet</span><div class="whs-muted" style="font-weight:400">${_whsRs(h.money.amount)} ${h.money.account==='mcb'?'in MCB — Raees confirms it from the bank':'in cash — hand it to Raees, he confirms it'}</div>`
    :h.changed
    ?`<span class="acct-chip warn">With Raees · bill changed since</span><div class="whs-muted" style="font-weight:400">${_whsEsc(_whsWho(h.entry.by,h.entry.byName))} confirmed ${_whsRs(h.received)} into ${h.entry.account==='mcb'?'MCB':'cash'} on ${_whsEsc(_whsFmtDay(h.entry.date))}, for a bill of ${_whsRs(h.entry.whSaleTotal)}. The bill is now ${_whsRs(h.money.amount)} ${h.money.account==='mcb'?'by bank transfer':'in cash'} — it is not asked for again; the owners are shown the difference.</div>`
    :`<span class="acct-chip ok">With Raees ✓</span><div class="whs-muted" style="font-weight:400">${_whsEsc(_whsWho(h.entry.by,h.entry.byName))} confirmed ${_whsRs(h.received)} on ${_whsEsc(_whsFmtDay(h.entry.date))}${h.received!==h.money.amount?` · <b>${h.received<h.money.amount?_whsRs(h.money.amount-h.received)+' short':_whsRs(h.received-h.money.amount)+' more than the bill'}</b>`:''}</div>`;
  const bill=whsBillUrl(s.billUrl)
    ?(s.billKind==='pdf'
      ?`<a class="acct-photo-link" href="${_whsEsc(s.billUrl)}" target="_blank" rel="noopener noreferrer">📄 Open the bill (PDF)</a>`
      :`<a class="whs-billview" href="${_whsEsc(s.billUrl)}" target="_blank" rel="noopener noreferrer"><img src="${_whsEsc(_whsThumbUrl(s.billUrl))}" alt="The bill" onerror="this.style.display='none'"><span>Open the bill</span></a>`)
    :'<div class="whs-err">No bill is attached to this sale.</div>';
  const lines=(s.lines||[]).map(l=>`<tr>
      <td>${_whsEsc(l.title)}${l.variant?`<div class="whs-muted">${_whsEsc(l.variant)}</div>`:''}${l.manual?'<div class="whs-flag">not in the catalog</div>':''}${l.priceEdited?`<div class="whs-flag">catalog price ${_whsRs(l.catalogPrice)}</div>`:''}</td>
      <td class="ref">${_whsEsc(l.sku||'')}</td>
      <td class="num">${Number(l.qty)||0}</td>
      <td class="num">${_whsRs(l.price)}</td>
      <td class="num">${_whsRs(l.total)}</td></tr>`).join('');
  const recorded=_whsMs(s.createdAt);
  const body=`
    ${s.status==='void'?`<div class="acct-alert urgent" style="cursor:default;margin-bottom:12px">Void — ${_whsEsc(s.voidReason||'')} (${_whsEsc(_whsWho(s.voidedBy,s.voidedByName))}${_whsMs(s.voidedAt)?', '+_whsEsc(new Date(_whsMs(s.voidedAt)).toLocaleString('en-GB')):''})${whsCanEntry()?'<div style="margin-top:6px;font-weight:400">If this bill was entered wrong, record it again below — this entry is kept in its history.</div>':''}</div>`:''}
    ${s.status!=='void'&&s.needsReview?`<div class="acct-alert warn" style="cursor:default;margin-bottom:12px">Needs review: ${_whsEsc((s.reviewFlags||[]).join(' · ')||'flagged')}</div>`:''}
    ${!s.needsReview&&s.reviewedBy?`<div class="whs-muted" style="margin-bottom:10px">Reviewed by ${_whsEsc(_whsWho(s.reviewedBy,s.reviewedByName))}.</div>`:''}
    <div class="acct-kv-grid">
      ${_whsKV('Order #',_whsEsc(s.orderNo||s._id))}
      ${_whsKV('Date',_whsEsc(_whsFmtDay(s.date)))}
      ${_whsKV('Customer',_whsEsc(s.customerName))}
      ${_whsKV('Phone',_whsEsc(whsFmtPhone(s.customerPhone)))}
      ${_whsKV('Payment',pay)}
      ${handed?_whsKV('Raees',handed):''}
      ${_whsKV('Recorded by',_whsEsc(_whsWho(s.createdByU,s.createdByName))+(recorded?' · '+_whsEsc(new Date(recorded).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})):''))}
    </div>
    <div class="acct-table-wrap" style="margin-top:14px"><table class="acct-table whs-lt-table"><thead><tr><th>Article</th><th>Barcode</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody>${lines}</tbody></table></div>
    <div class="whs-sum" style="margin-top:10px">
      <div class="whs-srow"><span>Subtotal</span><b>${_whsRs(s.subtotal)}</b></div>
      ${s.discount?`<div class="whs-srow"><span>Discount (${Number(s.discountPct)||0}%)</span><b>−${_whsRs(s.discount)}</b></div>`:''}
      <div class="acct-total"><span>Total</span><b>${_whsRs(s.total)}</b></div>
    </div>
    ${s.note?`<div style="margin-top:10px;font-size:14px"><span class="whs-muted">Note:</span> ${_whsEsc(s.note)}</div>`:''}
    <div style="margin-top:12px">${bill}</div>
    ${_whsHistoryHTML(s)}`;
  const acts=[];
  if(s.status==='void'&&whsCanEntry())acts.push(`<button class="btn-sm" onclick="window.whsNewSale('${_whsEsc(s._id)}')">Record this bill again</button>`);
  if(s.status!=='void'&&s.terms==='later'&&whsCanEntry()){
    if(!whsCollected(s))acts.push(`<button class="btn-sm" onclick="window.whsCollect('${_whsEsc(s._id)}')">Mark collected…</button>`);
    else if(h&&(h.state==='waiting'||h.state==='unknown'))acts.push(`<button class="btn-sm btn-outline" onclick="window.whsUncollect('${_whsEsc(s._id)}')">Undo collection</button>`);
  }
  if(s.status!=='void'&&_whsIsOwner()&&s.needsReview)acts.push(`<button class="btn-sm" onclick="window.whsMarkReviewed('${_whsEsc(s._id)}')">Mark reviewed</button>`);
  if(s.status!=='void'&&whsCanEntry())acts.push(`<button class="btn-sm btn-outline" onclick="window.whsVoid('${_whsEsc(s._id)}')">Void this sale…</button>`);
  if(_whsIsSuper())acts.push(`<button class="btn-sm btn-outline whs-danger" onclick="window.whsDelete('${_whsEsc(s._id)}')">Delete (admin)…</button>`);
  acts.push('<button class="btn-outline" onclick="window.whsModalClose()">Close</button>');
  _whsModal('Sale '+_whsEsc(s.orderNo||s._id),body,acts.join(''),{width:680});
};
// ── Collecting a pay-later bill ─────────────────────────────────────────
// Pure: the patch a collection writes, or {error}. Collected in full — a
// part payment is not recorded here, and the modal says so.
function whsCollectPatch(s,f,ctx){
  f=f||{};ctx=ctx||{};
  if(!s||!_whsLive(s)||s.terms!=='later')return{error:'Only a live pay-later bill can be collected.'};
  if(whsCollected(s))return{error:'This bill is already marked collected.'};
  const via=WHS_ACCT_OF[f.via]?f.via:'';
  if(!via)return{error:'Choose how the customer paid — cash or bank transfer.'};
  const date=String(f.date||'');
  const today=ctx.today||whsToday();
  if(!_whsIsDay(date))return{error:'Pick the date the customer paid.'};
  if(date>today)return{error:'The date cannot be in the future.'};
  if(date<s.date)return{error:'The customer cannot have paid before the sale ('+_whsFmtDay(s.date)+').'};
  return{patch:{collectedAt:ctx.now||Date.now(),collectedBy:String(ctx.u||''),collectedByName:String(ctx.name||''),collectedVia:via,collectedDate:date}};
}
let _whsCollectVia='';
window.whsCollect=function(id){
  const s=_whsById(id);if(!s||!whsCanEntry())return;
  if(whsCollected(s)||s.terms!=='later'||!_whsLive(s))return;
  _whsCollectVia='';
  const body=`<div style="font-size:14px;margin-bottom:10px"><b>${_whsEsc(s.orderNo||s._id)}</b> · ${_whsEsc(s.customerName)} · <b>${_whsRs(s.total)}</b><div class="whs-muted">Due ${_whsEsc(_whsFmtDay(s.dueDate))}. The full amount is recorded as paid — a part payment is not recorded here.</div></div>
    <div class="field"><label>How did the customer pay? *</label><div class="acct-chips" id="whs-cvia-chips">${WHS_PAID_VIA.map(v=>`<button type="button" class="acct-chipbtn" data-v="${v.key}" onclick="window.whsCollectVia('${v.key}')">${_whsEsc(v.label)}</button>`).join('')}</div></div>
    <div class="field"><label>Date paid *</label><input id="whs-cdate" type="date" value="${whsToday()}" min="${_whsEsc(s.date)}" max="${whsToday()}"></div>
    <div class="whs-muted" style="margin-top:8px">It then goes to Raees: cash to hand over, a bank transfer he checks in MCB. It counts in his books once he confirms.</div>`;
  _whsModal('Mark collected',body,`<button class="btn-outline" onclick="window.whsModalClose()">Cancel</button><button class="btn-primary" id="whs-csave" style="width:auto;padding:10px 16px" onclick="window.whsCollectSave('${_whsEsc(s._id)}')">Mark collected</button>`,{width:480});
};
window.whsCollectVia=function(v){
  _whsCollectVia=WHS_ACCT_OF[v]?v:'';
  document.querySelectorAll('#whs-cvia-chips .acct-chipbtn').forEach(b=>b.classList.toggle('on',b.getAttribute('data-v')===_whsCollectVia));
};
// Its own busy flag, never _whsBusy: an updateDoc made offline does not
// resolve until it reaches the server, and holding the sale form's flag for
// that long would silently stop every new sale from saving. It needs a
// connection anyway — Raees cannot see a collection that has not synced.
let _whsCollectBusy=false;
window.whsCollectSave=async function(id){
  const s=_whsById(id);if(!s||!whsCanEntry()||_whsCollectBusy)return;
  if(typeof navigator!=='undefined'&&navigator.onLine===false){showToast('Marking a bill collected needs a connection — Raees has to see it.',true);return;}
  const who=_whsSession()||{};
  const r=whsCollectPatch(s,{via:_whsCollectVia,date:(document.getElementById('whs-cdate')||{}).value},{today:whsToday(),u:who.u,name:who.name,now:Date.now()});
  if(r.error){showToast(r.error,true);return;}
  _whsCollectBusy=true;
  try{await updateDoc(doc(db,'wh_sales',s._id),r.patch);}
  catch(e){_whsCollectBusy=false;showToast(_whsWriteErrMsg(e),true);return;}
  _whsCollectBusy=false;
  Object.assign(s,r.patch);
  try{logActivity('Warehouse bill collected',`${s._id} · ${s.customerName} · ${_whsRs(s.total)} · ${r.patch.collectedVia}`);}catch(_){}
  window.whsModalClose();
  showToast(`${s._id} marked collected — ${_whsRs(s.total)} now waits for Raees to confirm.`);
  _whsRepaint();
};
// A collection marked by mistake, before Raees has confirmed it. Once he has,
// the money is in his books and this is refused — void the sale instead,
// which the owners are told about.
window.whsUncollect=async function(id){
  const s=_whsById(id);if(!s||!whsCanEntry()||!whsCollected(s))return;
  // Ask FIRST, then check with Raees's accounts: a confirmation made while
  // the dialog was open must still stop the undo.
  if(!confirm(`Undo the collection of ${s._id} (${_whsRs(s.total)})?\n\nIt goes back to "pay later — to collect".`))return;
  await whsLoadConfirmations(true);
  const h=whsHandStatus(s);
  if(h&&h.state==='received'){showToast('Raees has already confirmed receiving this — it cannot be undone here. Ask Raees or the owners.',true);_whsRepaint();return;}
  if(!h||h.state!=='waiting'||_whsConfFromCache){showToast('Could not check with Raees\'s accounts — try again when online.',true);return;}
  const patch={};for(const k of _WHS_COLLECT_FIELDS)patch[k]=null;
  try{await updateDoc(doc(db,'wh_sales',s._id),patch);}
  catch(e){showToast(_whsWriteErrMsg(e),true);return;}
  Object.assign(s,patch);
  try{logActivity('Warehouse bill collection undone',`${s._id} · ${s.customerName}`);}catch(_){}
  window.whsModalClose();
  showToast('Collection undone.');
  _whsRepaint();
};
window.whsVoid=async function(id){
  const s=_whsById(id);if(!s||s.status==='void'||!whsCanEntry())return;
  const h=whsHandStatus(s);
  const held=h&&h.state==='received'?`\n\nRaees has already received ${_whsRs(h.received)} for it — the money stays in his books. If you record this bill again, that money covers it and Raees is not asked again; if you don't, the owners are told.`:'';
  const reason=String(prompt(`Void sale ${s.orderNo||s._id} (${_whsRs(s.total)})?${held}\n\nIt stays in the list, struck through, with your reason. Why is it being voided?`,'')||'').trim();
  if(!reason){showToast('Not voided — a reason is needed.',true);return;}
  const who=_whsSession()||{};
  const patch={status:'void',voidedAt:Date.now(),voidedBy:String(who.u||''),voidedByName:String(who.name||''),voidReason:reason.slice(0,200)};
  try{await updateDoc(doc(db,'wh_sales',s._id),patch);}
  catch(e){showToast(_whsWriteErrMsg(e),true);return;}
  Object.assign(s,patch);
  try{logActivity('Warehouse sale voided',`${s._id} · ${reason}`);}catch(_){}
  window.whsModalClose();
  showToast('Sale '+s._id+' voided.');
  _whsRepaint();
};
window.whsMarkReviewed=async function(id){
  const s=_whsById(id);if(!s||!_whsIsOwner()||!s.needsReview)return;
  const who=_whsSession()||{};
  const patch={needsReview:false,reviewedAt:Date.now(),reviewedBy:String(who.u||''),reviewedByName:String(who.name||'')};
  try{await updateDoc(doc(db,'wh_sales',s._id),patch);}
  catch(e){showToast(_whsWriteErrMsg(e),true);return;}
  Object.assign(s,patch);
  window.whsModalClose();
  showToast('Marked reviewed.');
  _whsRepaint();
};
window.whsDelete=async function(id){
  const s=_whsById(id);if(!s||!_whsIsSuper())return;
  if(!confirm(`Delete sale ${s._id} for good?\n\nThere is no undo. Void keeps the record and says why — delete is for an entry made by mistake.`))return;
  try{await deleteDoc(doc(db,'wh_sales',s._id));}
  catch(e){showToast(_whsWriteErrMsg(e),true);return;}
  whSales=whSales.filter(x=>x._id!==s._id);
  try{logActivity('Warehouse sale deleted (admin)',`${s._id} · ${s.customerName} · ${_whsRs(s.total)}`);}catch(_){}
  window.whsModalClose();
  showToast('Sale '+s._id+' deleted.');
  _whsRepaint();
};

// ── Excel ────────────────────────────────────────────────────────────────
window.whsExport=function(){
  if(typeof XLSX==='undefined'){showToast('Excel export is not available — the spreadsheet library did not load.',true);return;}
  const today=whsToday();
  const list=whsFilterSales(whSales,_whsFilter,_whsQuery,today);
  if(!list.length){showToast('Nothing to export for this filter.',true);return;}
  const hand=s=>{const h=whsHandStatus(s);return !h?'':h.state==='received'?'received '+h.received+(h.changed?' (bill changed since)':''):h.state==='waiting'?'waiting':'unknown';};
  const sales=[['Date','Order #','Customer','Phone','Items','Subtotal','Discount','Discount %','Total','Payment','Paid via','Due date','Collected','Collected via','Overdue','With Raees','Status','Needs review','Recorded by','Bill','Note']]
    .concat(list.map(s=>[s.date,s.orderNo||s._id,s.customerName,whsFmtPhone(s.customerPhone),Number(s.qtyTotal)||0,Number(s.subtotal)||0,Number(s.discount)||0,Number(s.discountPct)||0,Number(s.total)||0,s.terms==='later'?'Pay later':'Paid',s.paidVia||'',s.dueDate||'',whsCollected(s)?s.collectedDate:'',whsCollected(s)?s.collectedVia:'',whsIsOverdue(s,today)?'yes':'',hand(s),s.status==='void'?'void':'active',s.needsReview?(s.reviewFlags||[]).join('; '):'',_whsWho(s.createdByU,s.createdByName),s.billUrl||'',s.note||'']));
  const lines=[['Date','Order #','Customer','Article','Variant','Barcode','Article code','Qty','Price','Line total','Catalog price','Flag']];
  for(const s of list)for(const l of s.lines||[])
    lines.push([s.date,s.orderNo||s._id,s.customerName,l.title||'',l.variant||'',l.sku||'',l.code||'',Number(l.qty)||0,Number(l.price)||0,Number(l.total)||0,l.catalogPrice==null?'':l.catalogPrice,l.manual?'not in the catalog':l.priceEdited?'price changed':'']);
  const wb=XLSX.utils.book_new();
  [['Sales',sales],['Articles',lines]].forEach(([name,aoa])=>{
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols']=aoa[0].map((_,i)=>({wch:Math.min(40,Math.max(8,...aoa.map(r=>String(r[i]==null?'':r[i]).length)))}));
    XLSX.utils.book_append_sheet(wb,ws,name);
  });
  XLSX.writeFile(wb,`warehouse-sales-${today}.xlsx`);
  showToast(`Exported ${list.length} sale${list.length===1?'':'s'}.`);
};

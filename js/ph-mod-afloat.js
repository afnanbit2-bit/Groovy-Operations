/* ─────────────────────────────────────────────────────────────────────────
   Production Ops ▸ Afloat POs (QC5, 15 Oct 2026) -- the QC reconciliation tab, READ-ONLY.  Tab id `afloat` (js/ph-ui.js PH_TABS).

   The owner's rule (Afnan): the cut quantity per size is FINAL once recorded; QC must receive the same units from stitching, per
   size, within 2 %; a tab shows every PO afloat and, as POs near the end, the reconciliation; every PO shown carries the product's
   picture. This file is that tab. The decisions are js/ph-core.js phQc* (QC1): this file arranges them and decides nothing.

   Who sees it: the managers (afnan, ammar, mustafa) and the QC floor (faizan, js/ph-data.js phCanQc). Faizan's rail is this ONE tab.
   Kashif (uzaib) does not get it (owner decision Q9: his rail stays as it is).

   What it shows (Screen A, the list): every PO in progress -- ph-core's stages cutting..qc -- grouped Cutting (units afloat) ->
   In the line -> Finishing -> Ready to close (one phQcGroup decision, shared by the list and the counts); a PO the classic flow already
   completed is listed only while it has a reconciliation that is not closed; closed ones from the last PHAF_CLOSED_DAYS days sit in a
   collapsed group; cancelled POs are hidden and counted. Each tile: the product picture, PO, article, stage, the cut (final or not),
   what QC received, the per-size line (received / cut, difference, ✓ / ✗) and a verdict chip that is ALWAYS glyph + word (+ colour).
   Screen B, the detail (opened from a tile, a page of its own on every width): the per-size table, cut / stitched / received /
   difference / allowance / verdict, the lots, the lock, the legacy receipts note and the history.

   What it writes: NOTHING. No Firestore write API appears in this file (tests/ph-mod-afloat.test.js scans the source). The actions that
   arrive in the next work package (QC6: Receive units, Lock cut now, Close PO) are drawn DISABLED with the reason written beside them,
   never as a button that does nothing silently.

   Reads (all bounded, all never-reject): its own `pos` read (newest PHAF_POS_LIMIT by ts, the PO Queue's pattern), the lazy ph-data
   stages recon (po_qc_recon), lots (po_qc_lots) and shopimg (shopify_articles, the product pictures), and, in the detail only, that PO's
   bundles (for the "stitched" column). A read that failed is NAMED and prints no number: a tile reads "received: not read", a group
   header reads "unavailable — po_qc_lots", never 0. An answer from the device's offline copy is a failure.

   Pictures (plan 6.9): po.imgFront -> po.imgBack -> shopify_articles/{code}.image_url -> a code / name tile. URLs pass the repo's own
   validators (_profPhotoUrl: anchored https://res.cloudinary.com/, _siAxImgOk: anchored https://cdn.shopify.com/), both behind typeof
   (a missing helper = no picture, the tile instead: fail closed); a Cloudinary URL is sized by _boardsDisplayUrl(u,250); the URL goes in
   through the img.src PROPERTY, never an HTML string; a picture that fails to load falls to the next one in the chain, then to the tile.

   Every stored string (article name, note, reason) reaches the page through textContent; nothing here parses a string as HTML.
   Strings are js/ph-i18n.js afloat.* (English with Urdu pairs, every Urdu row review:true). Globals are phqc / _phqc / PHAF_ prefixed
   (ph-core / ph-write own phQc* / PHQC_*, a different set: classic scripts share ONE lexical scope).
   ───────────────────────────────────────────────────────────────────────── */

const PHAF_POS_LIMIT=1000;          // newest POs read (the PO Queue's bound)
const PHAF_TIMEOUT_MS=20000;
const PHAF_STALE_MS=60000;          // a visit after this long re-reads the POs
const PHAF_CLOSED_DAYS=7;           // closed reconciliations listed for this many days
const PHAF_GROUP_CAP=60;            // tiles drawn per group before "Show more"
const PHAF_BUNDLES_LIMIT=500;       // one PO's bundles, read in the detail
const PHAF_NAME_TILE=18;            // characters of the article name on the no-photo tile
const PHAF_MONTHS=Object.freeze(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);
// The groups in the order the list draws them (phQcGroup's ids; 'unknown' = a stage this app does not recognise, listed last but
// before the collapsed closed group).
const PHAF_GROUPS=Object.freeze([
  Object.freeze({id:'cutting',  key:'afloat.g_cutting'}),
  Object.freeze({id:'line',     key:'afloat.g_line'}),
  Object.freeze({id:'finishing',key:'afloat.g_finishing'}),
  Object.freeze({id:'ready',    key:'afloat.g_ready'}),
  Object.freeze({id:'unknown',  key:'afloat.g_unknown'}),
  Object.freeze({id:'closed',   key:'afloat.g_closed'})
]);
// The groups whose membership depends on what QC received (a phase): they cannot be counted when the lots or the reconciliations
// could not be read. cutting / line / finishing / unknown are decided by the PO's stage alone.
const PHAF_PHASE_GROUPS=Object.freeze(['ready','closed']);
const PHAF_STAGE_KEYS=Object.freeze({cutting:'afloat.st_cutting',bundling:'afloat.st_bundling',stitching:'afloat.st_stitching',printing:'afloat.st_printing',
  washing:'afloat.st_washing',qc:'afloat.st_qc',completed:'afloat.st_completed',unknown:'afloat.st_unknown'});

/* ── who ──────────────────────────────────────────────────────────────── */
function _phqcUser(u){
  if(u!==undefined)return typeof u==='string'?u:'';
  return(typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'';
}
function phqcIsManager(u){return typeof phCanManage==='function'&&phCanManage(_phqcUser(u))===true;}
function phqcIsQc(u){return typeof phCanQc==='function'&&phCanQc(_phqcUser(u))===true;}
// The tab's audience: the managers and the QC floor. Fails CLOSED when the data layer did not load. Kashif (uzaib) is in neither list.
function phqcCanSee(u){return phqcIsManager(u)||phqcIsQc(u);}
const PHAF_ROLE=function(u){return phqcCanSee(u);};

/* ── small pure helpers ────────────────────────────────────────────────── */
function _phqcStr(x){return typeof phStr==='function'?phStr(x):(x==null?'':String(x));}
function _phqcIdOf(po){return _phqcStr(po&&(po.fbKey||po.id)).trim();}
function _phqcKeyOf(id){return typeof phPoKey==='function'?phPoKey(id):id;}
function _phqcNum(id){const m=/([0-9]+)$/.exec(_phqcStr(id));return m?+m[1]:Number.MAX_SAFE_INTEGER;}
// D MMM (YYYY when not this year) for a ms moment or a PKT day; '' when unreadable.
function _phqcDay(x,today){
  const d=typeof phDay==='function'?phDay(x):null;
  if(!d)return'';
  const y=d.slice(0,4),m=+d.slice(5,7),dd=+d.slice(8,10);
  return dd+' '+PHAF_MONTHS[m-1]+(today&&today.slice(0,4)!==y?' '+y:'');
}
/* Day and time stamps (QC6, owner's rule): every QC entry -- a lot, a void, a lock, a close -- shows its day AND time in a 12-hour
   clock with AM/PM, in PKT (UTC+5, no DST) whatever the viewer's device zone: "Thu 15 Oct 2026, 3:42 PM". The PKT day is
   js/ph-core.js phDay (PH_TZ_OFFSET_MIN, ph-core.js:63/202); the 12-hour wording is js/hrm.js:927 formatTime12hr, handed an "HH:MM"
   that is ALREADY in PKT (that helper reads "HH:MM" as given and never consults the device zone for it). hrm.js loads before every
   ph file (index.html), but it is behind typeof: without it the same rule is applied here. No 24-hour time is shown in this tab. */
const PHAF_WDAYS=Object.freeze(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
function _phqcPkHm(ms){
  const off=typeof PH_TZ_OFFSET_MIN==='number'?PH_TZ_OFFSET_MIN:300;
  const d=new Date(ms+off*60000);
  const p=function(n){return(n<10?'0':'')+n;};
  return p(d.getUTCHours())+':'+p(d.getUTCMinutes());
}
function _phqc12(hm){
  if(typeof formatTime12hr==='function'){try{const r=formatTime12hr(hm);if(/^(1[0-2]|[1-9]):[0-5][0-9] (AM|PM)$/.test(r))return r;}catch(e){}}
  const h=+hm.slice(0,2),m=hm.slice(3,5);
  return((h%12)||12)+':'+m+' '+(h>=12?'PM':'AM');
}
// "3:42 PM" (PKT) for a ms moment; '' when unreadable.
function _phqcClock(ms){
  if(typeof ms!=='number'||!isFinite(ms)||ms<=0)return'';
  return _phqc12(_phqcPkHm(ms));
}
// "Thu 15 Oct 2026" for a PKT day (YYYY-MM-DD) or a ms moment; '' when unreadable.
function _phqcDayLong(x){
  const d=typeof phDay==='function'?phDay(x):null;
  if(!d)return'';
  const wd=typeof phWeekday==='function'?phWeekday(d):null;
  return(wd!==null&&wd!==undefined?PHAF_WDAYS[wd]+' ':'')+(+d.slice(8,10))+' '+PHAF_MONTHS[+d.slice(5,7)-1]+' '+d.slice(0,4);
}
// The stamp: "Thu 15 Oct 2026, 3:42 PM" (PKT). '' when ms is not a moment.
function phqcStamp(ms){
  if(typeof ms!=='number'||!isFinite(ms)||ms<=0)return'';
  const d=_phqcDayLong(ms),t=_phqcClock(ms);
  return d&&t?d+', '+t:'';
}
// The stamp and who made the entry ("Thu 15 Oct 2026, 3:42 PM by Faizan"); '—' when the moment is unreadable.
function phqcStampBy(ms,who){
  const s=phqcStamp(ms),w=_phqcStr(who).trim();
  if(!s)return w?phI18nD('afloat.stamp_by',{stamp:'—',who:w}):'—';
  return w?phI18nD('afloat.stamp_by',{stamp:s,who:w}):s;
}
function _phqcWhen(ms){return phqcStamp(ms);}
// A username -> the person's name from USER_DEFS (js/auth.js); else the username as stored.
function _phqcWho(u){
  const s=_phqcStr(u).trim();if(!s)return'';
  try{if(typeof USER_DEFS!=='undefined'&&Array.isArray(USER_DEFS)){const d=USER_DEFS.filter(function(x){return x&&x.u===s;})[0];if(d&&d.name)return String(d.name);}}catch(e){}
  return s;
}
function _phqcTrim(s,n){const t=_phqcStr(s);return t.length>n?t.slice(0,n-1)+'…':t;}
// Units handed to QC through the OLD Packing ▸ Receiving page (pos.packingReceipts entries not written by the QC lot writer).
// With a reconciliation given (QC7), only the units NOT adopted yet (their ids are not in recon.legacyIds) -- phqcLegacyPlan.
function phqcLegacyUnits(po,recon){
  if(arguments.length>1)return phqcLegacyPlan(po,recon).total;
  const l=po&&Array.isArray(po.packingReceipts)?po.packingReceipts:[];
  let n=0;
  l.forEach(function(r){if(r&&r.src!=='qc'){const q=typeof phWhole==='function'?phWhole(r.qty):Math.floor(+r.qty);if(q!==null&&isFinite(q))n+=q;}});
  return n;
}
// What "Adopt old receipts" would take (QC7): the SAME selection js/ph-write.js phQcAdoptLegacy makes -- every packingReceipts entry
// without src 'qc', with a size and a whole quantity above 0, whose id (e.id, else receiptId-size) is not already in recon.legacyIds,
// each id once. -> {ids, sizes:{size:units}, total, adopted (units already adopted)}. Pure; nothing is written here.
function phqcLegacyPlan(po,recon){
  const done=recon&&Array.isArray(recon.legacyIds)?recon.legacyIds:[];
  const sizes={},ids=[];let total=0,adopted=0;
  (po&&Array.isArray(po.packingReceipts)?po.packingReceipts:[]).forEach(function(e){
    if(!e||typeof e!=='object'||e.src==='qc'||typeof e.size!=='string'||!e.size)return;
    const id=typeof e.id==='string'&&e.id?e.id:(String(e.receiptId||'')+'-'+e.size);
    const q=typeof phWhole==='function'?phWhole(e.qty):(Number.isInteger(e.qty)?e.qty:null);
    if(done.indexOf(id)>-1){if(q!==null&&q>0)adopted+=q;return;}
    if(ids.indexOf(id)>-1)return;
    if(q===null||q<=0)return;
    ids.push(id);sizes[e.size]=(Object.prototype.hasOwnProperty.call(sizes,e.size)?sizes[e.size]:0)+q;total+=q;
  });
  return{ids:ids,sizes:sizes,total:total,adopted:adopted};
}

/* ── product pictures (plan 6.9) ───────────────────────────────────────── */
// The ONE URL check: a Cloudinary URL through js/profile.js's anchored validator, a Shopify CDN URL through js/shopify.js's.
// Both behind typeof: a helper that did not load means NO picture (the code tile), never an unchecked URL. '' = refused.
function phqcImgSafe(u){
  if(typeof u!=='string'||!u||u.length>2000)return'';
  try{
    if(typeof _profPhotoUrl==='function'){const c=_profPhotoUrl(u);if(c)return c;}
    if(typeof _siAxImgOk==='function'&&_siAxImgOk(u.trim()))return u.trim();
  }catch(e){}
  return'';
}
// The thumbnail URL: a Cloudinary photo asks for its sized derivative (js/boards.js _boardsDisplayUrl: <=250 -> w_400), re-checked;
// a Shopify CDN photo is used as stored (its resizing suffixes are not verified).
function phqcSized(u){
  const s=phqcImgSafe(u);if(!s)return'';
  if(/^https:\/\/res\.cloudinary\.com\//.test(s)&&typeof _boardsDisplayUrl==='function'){
    try{const d=_boardsDisplayUrl(s,250);if(phqcImgSafe(d))return d;}catch(e){}
  }
  return s;
}
// The fallback chain for one PO -> {src, from:'po'|'po_back'|'catalog'|'none', chain:[{src,from}], front, back}.
//   shopUrl: the shopify_articles image_url for the PO's code; undefined = ask js/ph-data.js (phQcShopImageOf, null when not read).
function phqcImage(po,shopUrl){
  const p=po&&typeof po==='object'?po:{};
  const front=phqcSized(p.imgFront),back=phqcSized(p.imgBack);
  let shop=shopUrl;
  if(shop===undefined)shop=typeof phQcShopImageOf==='function'?phQcShopImageOf(p.code!=null?p.code:p.articleCode):null;
  const cat=typeof shop==='string'?phqcSized(shop):'';
  const chain=[];
  if(front)chain.push({src:front,from:'po'});
  if(back&&back!==front)chain.push({src:back,from:'po_back'});
  if(cat&&chain.every(function(c){return c.src!==cat;}))chain.push({src:cat,from:'catalog'});
  const first=chain[0]||{src:'',from:'none'};
  return{src:first.src,from:first.from,chain:chain,front:front,back:back,catalog:cat};
}
// The picture's words: "<code> — <name>" (alt text, aria-label).
function phqcAlt(po){
  const c=_phqcStr(po&&(po.code!=null?po.code:po.articleCode)).trim(),n=_phqcStr(po&&po.name).trim();
  return c&&n?c+' — '+n:(c||n||_phqcIdOf(po));
}
// The no-photo tile: the article code (bold) over the first PHAF_NAME_TILE characters of the name, and the words "No photo". In the SMALL
// tile box (56 x 70, the list) the name is left out: it is printed in full right beside the picture, and 18 characters cannot fit in 56px
// (the layout probe measured it crushed to 0px high). The detail's 96 x 120 box carries it.
function phqcCodeTile(po,size){
  const t=phEl('span','phaf-tile');
  const code=phEl('b','phaf-tile-code');code.textContent=_phqcStr(po&&(po.code!=null?po.code:po.articleCode)).trim()||_phqcIdOf(po);
  const name=phEl('span','phaf-tile-name');name.textContent=_phqcTrim(_phqcStr(po&&po.name).trim(),PHAF_NAME_TILE);
  t.appendChild(code);if(size==='head')t.appendChild(name);
  t.appendChild(phEl('span','phaf-tile-none',phI18nD('afloat.no_photo')));
  return t;
}
// A fixed box (a late picture never moves the row). size: 'tile' | 'head'. The <img> takes the next URL of the chain when one fails,
// and the code tile when the chain is used up.
function phqcImageNode(po,size,opts){
  const o=opts||{};
  const im=phqcImage(po,o.shopUrl);
  const box=phEl('span','phaf-img phaf-img-'+(size==='head'?'head':'tile'));
  box.setAttribute('data-img-from',im.from);
  if(!im.src){box.appendChild(phqcCodeTile(po,size));return box;}
  const img=document.createElement('img');
  img.className='phaf-pic';
  img.setAttribute('loading','lazy');img.setAttribute('decoding','async');img.setAttribute('referrerpolicy','no-referrer');
  img.setAttribute('alt',phqcAlt(po));
  img.setAttribute('data-from',im.from);
  let at=0;
  img.addEventListener('error',function(){
    at++;
    if(at<im.chain.length){img.setAttribute('data-from',im.chain[at].from);box.setAttribute('data-img-from',im.chain[at].from);img.src=im.chain[at].src;return;}
    if(img.parentNode)img.parentNode.removeChild(img);
    box.setAttribute('data-img-from','none');box.classList.add('phaf-img-failed');
    box.appendChild(phqcCodeTile(po,size));
  });
  img.src=im.src;              // the DOM property, never an HTML string
  box.appendChild(img);
  return box;
}

/* ── the model: ONE pure function (no DOM, no clock unless given) ─────── */
// phqcModel(pos, recon, lots, o) -> {tiles, groups:{id:[tile]}, counts, cancelled, reserved, closedOlder, junk, reconOk, lotsOk}
//   pos   the PO documents (fbKey); recon / lots: the stage rows, or null when that stage was NOT read (failed / not yet)
//   o     {now (ms), jobs: po_cut_jobs rows or null}
function phqcModel(pos,recon,lots,o){
  const x=o||{};
  const now=typeof x.now==='number'&&isFinite(x.now)?x.now:Date.now();
  const reconOk=Array.isArray(recon),lotsOk=Array.isArray(lots);
  const rcBy=Object.create(null),lotsBy=Object.create(null),jobBy=Object.create(null);
  if(reconOk)recon.forEach(function(r){const k=r&&_phqcKeyOf(r.fbKey||r.poId);if(k)rcBy[k]=r;});
  if(lotsOk)lots.forEach(function(l){const k=l&&_phqcKeyOf(l.poId);if(!k)return;(lotsBy[k]=lotsBy[k]||[]).push(Object.assign({},l,{id:l.id!=null?l.id:l.fbKey}));});
  (Array.isArray(x.jobs)?x.jobs:[]).forEach(function(j){const k=j&&_phqcKeyOf(j.fbKey||j.poId);if(k)jobBy[k]=j;});
  const out={tiles:[],groups:{},counts:{afloat:0,finishing:0,ready:null,short:null,closed:null,units:0},cancelled:0,reserved:0,closedOlder:0,junk:0,reconOk:reconOk,lotsOk:lotsOk};
  PHAF_GROUPS.forEach(function(g){out.groups[g.id]=[];});
  (Array.isArray(pos)?pos:[]).forEach(function(p){
    const st=typeof phStageOf==='function'?phStageOf(p):null;
    if(st===null){out.junk++;return;}
    if(st==='cancelled'){out.cancelled++;return;}
    if(st==='reserved'){out.reserved++;return;}
    const id=_phqcIdOf(p),key=_phqcKeyOf(id);
    if(!key){out.junk++;return;}
    const rc=reconOk?(rcBy[key]||null):null;
    // a PO the classic flow completed is afloat only while its reconciliation is open (unknown when po_qc_recon was not read)
    if(st==='completed'&&(!reconOk||!rc))return;
    const plist=lotsOk?(lotsBy[key]||[]):null;
    const rec=phQcReconcile(p,rc,plist,{reconRead:reconOk});
    const exp=phQcExpected(p,reconOk?rc:null);
    const group=phQcGroup({stage:st,phase:rec.ok?rec.phase:null});
    if(!group)return;
    if(group==='closed'){
      const at=rc&&typeof rc.closedAt==='number'?rc.closedAt:null;
      if(at===null||now-at>PHAF_CLOSED_DAYS*86400000){out.closedOlder++;return;}
    }
    const live=(plist||[]).filter(function(l){return l&&l.status==='live';});
    const lastLot=live.reduce(function(m,l){return typeof l.at==='number'&&l.at>m?l.at:m;},0);
    const season=typeof phSeasonOf==='function'?phSeasonOf(p):{key:null};
    const job=jobBy[key]||null;
    const t={id:id,key:key,po:p,code:_phqcStr(p.code!=null?p.code:p.articleCode).trim(),name:_phqcStr(p.name).trim(),stage:st,group:group,
      rec:rec,exp:exp,recon:rc,reconOk:reconOk,lotsOk:lotsOk,lots:plist,lastLotAt:lastLot||null,season:season&&season.key?season.key:null,
      master:job&&job.masterName?_phqcStr(job.masterName):'',planDay:job&&job.plannedCutDate?_phqcStr(job.plannedCutDate):'',
      ordered:typeof phWhole==='function'?phWhole(p.qty):null};
    t.verdict=phqcVerdictOf(t);
    out.tiles.push(t);
    out.groups[group].push(t);
  });
  Object.keys(out.groups).forEach(function(k){out.groups[k].sort(_phqcCmp);});
  const g=out.groups;
  out.counts.afloat=out.tiles.filter(function(t){return t.group!=='closed';}).length;
  out.counts.finishing=g.finishing.length;
  g.cutting.forEach(function(t){const u=typeof phPoUnits==='function'?phPoUnits(t.po).units:null;if(typeof u==='number')out.counts.units+=u;});
  if(reconOk&&lotsOk){
    out.counts.ready=g.ready.length;
    out.counts.short=g.ready.filter(function(t){return t.rec.ok&&t.rec.phase==='short';}).length;
    out.counts.closed=g.closed.length;
  }
  return out;
}
// Closest to done first, then the PO number.
function _phqcCmp(a,b){
  const pa=a.rec&&typeof a.rec.progressPct==='number'?a.rec.progressPct:-1,pb=b.rec&&typeof b.rec.progressPct==='number'?b.rec.progressPct:-1;
  if(pa!==pb)return pb-pa;
  return _phqcNum(a.id)-_phqcNum(b.id);
}
// The verdict chip of a tile: ALWAYS a glyph and a word; the tone is the third cue. -> {glyph, key, params, tone, extra}
function phqcVerdictOf(t){
  const r=t&&t.rec;
  if(!r||!r.ok){
    const why=r&&r.why?String(r.why):'';
    if(t&&!t.reconOk)return{glyph:'?',key:'afloat.v_unread',params:{collection:'po_qc_recon'},tone:'unread'};
    if(t&&!t.lotsOk)return{glyph:'?',key:'afloat.v_unread',params:{collection:'po_qc_lots'},tone:'unread'};
    return{glyph:'!',key:'afloat.v_bad',params:{why:why},tone:'short'};
  }
  const v=r.verdict;
  switch(r.phase){
    case'awaiting_cut':return{glyph:'○',key:'afloat.v_awaiting_cut',params:null,tone:'wait'};
    case'awaiting_qc':return{glyph:'○',key:'afloat.v_awaiting_qc',params:null,tone:'wait'};
    case'receiving':return{glyph:'◐',key:'afloat.v_receiving',params:null,tone:'recv',extra:phqcStillExpected(v)};
    case'closed':return{glyph:'✓',key:'afloat.v_closed',params:null,tone:'closed'};
    case'short':return{glyph:'✗',key:'afloat.v_short',params:null,tone:'short',extra:phqcShortText(v)};
    case'ready':
      if(v&&v.state==='exact')return{glyph:'●',key:'afloat.v_exact',params:null,tone:'ok'};
      if(v&&v.state==='over'){const n=_phqcOverBy(v);return{glyph:'▲',key:'afloat.v_over',params:{n:n},tone:'over'};}
      return{glyph:'●',key:'afloat.v_within',params:null,tone:'ok'};
  }
  return{glyph:'?',key:'afloat.v_unknown',params:null,tone:'unread'};
}
function _phqcOverBy(v){
  if(v&&v.total&&v.total.diff>0)return v.total.diff;
  let n=0;if(v&&Array.isArray(v.order))v.order.forEach(function(k){const d=v.sizes[k].diff;if(d>n)n=d;});
  return n;
}
// "20 XL, 5 M still expected" (up to three sizes, the largest gap first) -> a descriptor, or null.
function phqcStillExpected(v){
  if(!v||!Array.isArray(v.order))return null;
  const gaps=v.order.map(function(k){return{k:k,n:-v.sizes[k].diff};}).filter(function(g){return g.n>0;}).sort(function(a,b){return b.n-a.n;});
  if(!gaps.length)return null;
  const txt=gaps.slice(0,3).map(function(g){return g.n+' '+g.k;}).join(', ')+(gaps.length>3?', …':'');
  return phI18nD('afloat.still_expected',{list:txt});
}
// "M is 2 short, allowance 1" for the first size that is short beyond its allowance (or over beyond it / unexpected).
function phqcShortText(v){
  if(!v||!Array.isArray(v.order))return null;
  for(let i=0;i<v.order.length;i++){
    const k=v.order[i],s=v.sizes[k];
    if(s.state==='short')return phI18nD('afloat.size_short',{size:k,n:-s.diff,a:s.allow});
    if(s.state==='over_refused')return phI18nD('afloat.size_over_refused',{size:k,n:s.diff,a:s.allow});
    if(s.state==='unexpected')return phI18nD('afloat.size_unexpected',{size:k,n:s.recv});
  }
  if(v.total&&v.total.state==='short')return phI18nD('afloat.total_short',{n:-v.total.diff,a:v.total.allow});
  return null;
}
// One per-size cell: glyph, text and the spelled-out sentence (title / aria-label). phase decides whether a short size is "still expected".
function phqcSizeCell(k,s,phase){
  const recvTxt=s.recv+'/'+s.cut;
  const diff=s.diff===0?'':(s.diff>0?'+'+s.diff:'−'+(-s.diff));
  let glyph='',ok=null;
  if(s.state==='exact'||s.state==='within'){glyph='✓';ok=true;}
  else if(s.state==='over'){glyph='▲';ok=true;}
  else if(s.state==='short'&&phase==='receiving'){glyph='';ok=null;}
  else{glyph='✗';ok=false;}
  const stateWord=phI18nT('afloat.cell_'+(s.state==='short'&&phase==='receiving'?'expected':s.state),null,'en');
  const sentence=phI18nD('afloat.cell_aria',{size:k,recv:s.recv,cut:s.cut,diff:s.diff===0?phI18nT('afloat.cell_no_diff',null,'en'):(s.diff>0?phI18nT('afloat.cell_over_by',{n:s.diff},'en'):phI18nT('afloat.cell_short_by',{n:-s.diff},'en')),a:s.allow,state:stateWord});
  return{text:k+' '+recvTxt+(diff?' '+diff:''),glyph:glyph,ok:ok,sentence:sentence};
}

/* ── state ─────────────────────────────────────────────────────────────── */
let _phqcPos={state:'idle',rows:null,at:0,err:null,truncated:false};
let _phqcPosP=null;
let _phqcF={q:'',stage:'',season:'',short:false,attention:false};
let _phqcFiltersOpen=null;      // null = the width's default (closed on a phone)
let _phqcCollapsed={closed:true};
let _phqcShowAll={};
let _phqcOpen='';               // the PO whose detail is open ('' = the list)
let _phqcBundles={};            // poId -> {state, rows, err}
let _phqcLightbox=null;         // {node, opener}
let _phqcListEl=null,_phqcCountEl=null,_phqcCtx=null;
let _phqcSeenUser='';
let _phqcGuardsWired=false;

function _phqcErr(e){
  if(typeof phErrInfo==='function')return phErrInfo(e);
  return{code:e&&e.code?String(e.code):'',message:e&&e.message?String(e.message):String(e),permission:false,quota:false};
}
function _phqcTimeout(p,ms){return typeof _phWithTimeout==='function'?_phWithTimeout(p,ms):p;}
async function _phqcReadPos(){
  const snap=await _phqcTimeout(getDocs(query(collection(db,'pos'),orderBy('ts','desc'),limit(PHAF_POS_LIMIT))),PHAF_TIMEOUT_MS);
  if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('the read was answered from this device\'s offline copy');e.code='from-cache';throw e;}
  const docs=(snap&&snap.docs)||[];
  return{rows:docs.map(function(d){return Object.assign({},d.data(),{fbKey:d.id});}),truncated:docs.length>=PHAF_POS_LIMIT};
}
// Read the POs (read-only). NEVER rejects; a failed read keeps older rows (if any) and records the error; concurrent calls share one read.
function phqcLoadPos(force){
  if(_phqcPosP)return _phqcPosP;
  if(!force&&_phqcPos.state==='ok'&&Date.now()-_phqcPos.at<PHAF_STALE_MS)return Promise.resolve(_phqcPos);
  _phqcPos.state='loading';
  const p=(async function(){
    let r=null,err=null;
    try{r=await _phqcReadPos();}
    catch(e){
      err=_phqcErr(e);
      if(err.permission&&typeof auth!=='undefined'&&auth&&auth.currentUser&&typeof auth.currentUser.getIdToken==='function'){
        try{await auth.currentUser.getIdToken(true);r=await _phqcReadPos();err=null;}catch(e2){err=_phqcErr(e2);}
      }
    }
    if(err)_phqcPos={state:'error',rows:_phqcPos.rows,at:_phqcPos.at,err:err,truncated:_phqcPos.truncated};
    else _phqcPos={state:'ok',rows:r.rows,at:Date.now(),err:null,truncated:r.truncated};
    return _phqcPos;
  })().catch(function(e){_phqcPos={state:'error',rows:_phqcPos.rows,at:_phqcPos.at,err:_phqcErr(e),truncated:_phqcPos.truncated};return _phqcPos;})
    .then(function(v){_phqcPosP=null;return v;});
  _phqcPosP=p;
  return p;
}
function _phqcPosErrText(){
  const e=_phqcPos.err;if(!e)return'';
  let t;
  if(e.permission)t='pos: could not be read - the signed-in account is refused. Retry; if it persists, check the published firestore.rules.';
  else if(e.code==='from-cache')t='pos: only this device\'s offline copy was available, so it was not read - get a connection and retry.';
  else if(e.code==='timeout')t='pos: the read did not finish in '+Math.round(PHAF_TIMEOUT_MS/1000)+'s - check the connection and retry.';
  else if(e.quota)t='pos: the Firestore read quota is used up - retry later.';
  else t='pos: read failed ('+(e.message||e.code||'unknown')+').';
  return typeof phI18nErr==='function'?phI18nErr(t):t;
}
// One PO's bundles, for the detail's "stitched" column (bundles with stitchingDone, their units). NEVER rejects.
function phqcLoadBundles(poId){
  const cur=_phqcBundles[poId];
  if(cur&&(cur.state==='loading'||cur.state==='ok'))return cur.p||Promise.resolve(cur);
  const rec={state:'loading',rows:null,err:null,p:null};
  _phqcBundles[poId]=rec;
  rec.p=(async function(){
    try{
      const snap=await _phqcTimeout(getDocs(query(collection(db,'bundles'),where('poId','==',poId),limit(PHAF_BUNDLES_LIMIT))),PHAF_TIMEOUT_MS);
      if(snap&&snap.metadata&&snap.metadata.fromCache===true){const e=new Error('offline copy');e.code='from-cache';throw e;}
      rec.rows=((snap&&snap.docs)||[]).map(function(d){return Object.assign({},d.data(),{fbKey:d.id});});
      rec.state='ok';
    }catch(e){rec.state='error';rec.err=_phqcErr(e);}
    return rec;
  })();
  return rec.p;
}
// Stitched per size = units of this PO's bundles marked stitchingDone (bundle units are the cut units, not a count of good output).
function phqcStitched(bundles){
  if(!Array.isArray(bundles))return null;
  const out={sizes:{},total:0,bundles:bundles.length,done:0};
  bundles.forEach(function(b){
    if(!b||b.stitchingDone!==true)return;
    const k=typeof phSizeKey==='function'?(phSizeKey('alpha',b.size)||_phqcStr(b.size).trim()):_phqcStr(b.size).trim();
    const u=typeof phWhole==='function'?phWhole(b.units):Math.floor(+b.units);
    if(!k||u===null||!isFinite(u))return;
    out.done++;out.sizes[k]=(out.sizes[k]||0)+u;out.total+=u;
  });
  return out;
}

/* ── the data this tab needs, started on open; it repaints itself when a read settles ── */
function _phqcStage(s){
  const st=typeof phLoadState==='function'?(phLoadState(s)||{state:'idle'}):{state:'idle'};
  const g=typeof phGet==='function'?phGet(s):{ok:false,rows:null};
  return{state:st.state,ok:!!g.ok&&Array.isArray(g.rows),rows:g.ok?g.rows:null,truncated:!!st.truncated,at:st.at||null,
    text:st.state==='error'&&typeof phErrText==='function'?phErrText(s,st.err):null};
}
function _phqcIsHere(){return typeof _phUiTab==='undefined'||_phUiTab==='afloat';}
function _phqcRepaintLater(ctx){if(_phqcIsHere()&&ctx&&typeof ctx.repaint==='function')ctx.repaint();}
// Starts every read that has not been made yet. A read that FAILED is not retried here (that would loop on a persistent refusal):
// only the Retry button re-reads it.
function _phqcStart(ctx){
  const due=_phqcPos.state==='idle'||(_phqcPos.state==='ok'&&Date.now()-_phqcPos.at>=PHAF_STALE_MS);
  if(due&&!_phqcPosP)phqcLoadPos(false).then(function(){_phqcRepaintLater(ctx);});
  ['recon','lots','shopimg'].forEach(function(s){
    if(typeof phLoadStage!=='function')return;
    if(_phqcStage(s).state==='idle')phLoadStage(s).then(function(){_phqcRepaintLater(ctx);});
  });
}
function phqcRetry(ctx){
  const ps=[];
  if(_phqcPos.state==='error')ps.push(phqcLoadPos(true));
  ['recon','lots','shopimg'].forEach(function(s){if(_phqcStage(s).state==='error'&&typeof phLoadStage==='function')ps.push(phLoadStage(s,{force:true}));});
  Promise.all(ps).then(function(){_phqcRepaintLater(ctx);});
  _phqcRepaintLater(ctx);
}
function _phqcLoading(){
  return!!_phqcPosP||_phqcPos.state==='idle'||['recon','lots'].some(function(s){const st=_phqcStage(s).state;return st==='idle'||st==='loading';});
}

/* ── the tab ───────────────────────────────────────────────────────────── */
function phqcRender(host,ctx){
  _phqcCtx=ctx;
  // A background repaint (a fresh read landing) must not drop the person's focus: keep the focused control's id
  // and focus the same control in the new paint, unless a step asked for another one.
  if(!_phqcFocusId){try{const a=document.activeElement;if(a&&a.id&&a.id.indexOf('phaf-')===0)_phqcFocusId=a.id;}catch(e){}}
  if(_phqcSeenUser&&_phqcSeenUser!==ctx.user){phqcReset();}
  _phqcSeenUser=ctx.user;
  _phqcWireGuards();
  _phqcStart(ctx);
  if(_phqcOpen){
    const t=_phqcFindTile(_phqcOpen);
    if(t){
      if(_phqcSheet&&_phqcSheet.poId===t.id&&phqcCanReceive(t,ctx.user))phqcSheetView(host,ctx,t);
      else{if(_phqcSheet&&_phqcSheet.poId===t.id&&!_phqcSheet.saving)_phqcSheet=null;phqcDetail(host,ctx,t);}
      _phqcFocusPending();
      return;
    }
    _phqcOpen='';
  }
  _phqcSheet=null;_phqcDlg=null;
  phqcList(host,ctx);
  _phqcFocusPending();
}
// Focus the element a step asked for (a sheet's first box, the confirm's button, the opener again), once, after the paint.
function _phqcFocusPending(){
  const id=_phqcFocusId;if(!id)return;
  _phqcFocusId='';
  try{const n=document.getElementById(id);if(n&&typeof n.focus==='function')n.focus();}catch(e){}
}
function _phqcHead(ctx,title,blurb){
  const h=phEl('header','ph-head');
  const row=phEl('div','ph-head-row',null,[phEl('h2','ph-title',title)]);
  h.appendChild(row);
  if(blurb)h.appendChild(phEl('p','ph-blurb',blurb));
  return h;
}
function _phqcAlert(title,lines,btn){
  const c=phEl('section','ph-card ph-card-err phaf-alert');c.setAttribute('role','alert');
  c.appendChild(phEl('h3','ph-card-title',title));
  (lines||[]).forEach(function(l){if(l)c.appendChild(phEl('p','ph-note',l));});
  if(btn)c.appendChild(btn);
  return c;
}
function _phqcBtn(cls,text,onclick,attrs){
  const b=phEl('button',cls,text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(onclick)b.addEventListener('click',onclick);
  return b;
}
function _phqcSkeleton(){
  const w=phEl('div','ph-skelwrap phaf-skel');w.setAttribute('aria-busy','true');w.setAttribute('role','status');
  w.setAttribute('aria-label',phI18nAttr(phI18nD('afloat.loading')));
  w.appendChild(phEl('p','ph-note',phI18nD('afloat.loading')));
  ['ph-skel-t','ph-skel-a','ph-skel-b','ph-skel-b'].forEach(function(c){w.appendChild(phEl('div','gv-skel ph-skel '+c));});
  return w;
}
// The model of what is on screen now (null when the POs were never read).
function _phqcModelNow(){
  if(_phqcPos.rows===null)return null;
  const r=_phqcStage('recon'),l=_phqcStage('lots');
  const jobs=typeof phGet==='function'?phGet('jobs'):{ok:false};
  return phqcModel(_phqcPos.rows,r.ok?r.rows:null,l.ok?l.rows:null,{jobs:jobs&&jobs.ok?jobs.rows:null});
}
function _phqcFindTile(id){const m=_phqcModelNow();return m?m.tiles.filter(function(t){return t.id===id;})[0]||null:null;}

/* ── Screen A: the list ────────────────────────────────────────────────── */
function phqcList(host,ctx){
  host.appendChild(_phqcHead(ctx,phI18nD('afloat.tab'),phI18nD('afloat.blurb')));
  const loading=_phqcLoading();
  const recon=_phqcStage('recon'),lots=_phqcStage('lots'),shop=_phqcStage('shopimg');
  // failed reads: named, with ONE Retry that re-reads only what failed
  const failed=[];
  if(_phqcPos.state==='error'&&!_phqcPosP)failed.push(_phqcPosErrText());
  if(recon.state==='error')failed.push(phI18nErr(recon.text));
  if(lots.state==='error')failed.push(phI18nErr(lots.text));
  if(failed.length)host.appendChild(_phqcAlert(phI18nD(failed.length===1?'afloat.err_one':'afloat.err_many',{n:failed.length}),failed.concat([phI18nD('afloat.err_never_zero')]),
    _phqcBtn('ph-btn ph-btn-primary',phI18nD('shell.retry'),function(){phqcRetry(ctx);})));
  if(shop.state==='error')host.appendChild(phEl('p','ph-note phaf-note-warn',phI18nD('afloat.shop_failed',{why:phI18nErr(shop.text)})));
  if(_phqcPos.rows===null){
    if(_phqcPos.state==='error'&&!_phqcPosP)return;           // the alert above says why; NO tile is drawn without the POs
    host.appendChild(_phqcSkeleton());return;
  }
  if(loading)host.appendChild(phEl('p','ph-note phaf-loading-line',phI18nD('afloat.loading')));
  const m=_phqcModelNow();
  // the summary line and the data line
  const sum=phEl('p','phaf-summary');sum.setAttribute('aria-live','polite');
  const bits=[phI18nT('afloat.sum_afloat',{n:m.counts.afloat},'en')];
  sum.appendChild(phEl('span','phaf-sum-b',phI18nD('afloat.sum_afloat',{n:m.counts.afloat})));
  sum.appendChild(phEl('span','phaf-sum-b',phI18nD('afloat.sum_finishing',{n:m.counts.finishing})));
  if(m.counts.ready===null)sum.appendChild(phEl('span','phaf-sum-b phaf-unread',phI18nD('afloat.sum_ready_unread',{collection:!m.lotsOk?'po_qc_lots':'po_qc_recon'})));
  else{
    sum.appendChild(phEl('span','phaf-sum-b',phI18nD('afloat.sum_ready',{n:m.counts.ready})));
    sum.appendChild(phEl('span','phaf-sum-b'+(m.counts.short?' phaf-sum-short':''),phI18nD('afloat.sum_short',{n:m.counts.short})));
  }
  void bits;
  host.appendChild(sum);
  host.appendChild(_phqcDataLine(recon,lots,shop));
  const notes=phEl('div','phaf-notes');
  if(_phqcPos.truncated)notes.appendChild(phEl('p','ph-note phaf-note-warn',phI18nD('afloat.trunc_pos',{n:PHAF_POS_LIMIT})));
  if(lots.ok&&lots.truncated)notes.appendChild(phEl('p','ph-note phaf-note-warn',phI18nD('afloat.trunc_lots')));
  if(recon.ok&&recon.truncated)notes.appendChild(phEl('p','ph-note phaf-note-warn',phI18nD('afloat.trunc_recon')));
  if(m.cancelled||m.reserved||m.closedOlder)notes.appendChild(phEl('p','ph-note',phI18nD('afloat.not_listed',{c:m.cancelled,r:m.reserved,o:m.closedOlder,days:PHAF_CLOSED_DAYS})));
  if(notes.firstChild)host.appendChild(notes);
  if(typeof phmkNoteNode==='function'){const mn=phmkNoteNode();if(mn)host.appendChild(mn);}
  host.appendChild(_phqcFilters(ctx,m));
  const count=phEl('p','ph-note phaf-count');count.setAttribute('aria-live','polite');_phqcCountEl=count;host.appendChild(count);
  const list=phEl('div','phaf-groups');_phqcListEl=list;host.appendChild(list);
  _phqcPaintGroups(ctx,m);
}
function _phqcDataLine(recon,lots,shop){
  const p=phEl('p','phaf-data');
  const st=function(name,state,ok){
    const s=phEl('span','phaf-data-b '+(ok?'phaf-ok':state==='error'?'phaf-bad':'phaf-wait'));
    s.appendChild(phEl('code','ph-code',name));
    s.appendChild(phEl('span','',phI18nD(ok?'afloat.d_ok':state==='error'?'afloat.d_failed':'afloat.d_loading')));
    return s;
  };
  p.appendChild(phEl('span','phaf-data-l',phI18nD('afloat.data')));
  p.appendChild(st('pos',_phqcPos.state,_phqcPos.state==='ok'||(_phqcPos.rows!==null&&_phqcPos.state!=='error')));
  p.appendChild(st('po_qc_recon',recon.state,recon.ok));
  p.appendChild(st('po_qc_lots',lots.state,lots.ok));
  p.appendChild(st('shopify_articles',shop.state,shop.ok));
  if(_phqcPos.at)p.appendChild(phEl('span','phaf-data-t',phI18nD('afloat.d_read_at',{time:_phqcClock(_phqcPos.at)})));
  return p;
}
function _phqcMatches(t,F){
  if(F.stage&&t.stage!==F.stage)return false;
  if(F.season){if(F.season==='none'){if(t.season!==null)return false;}else if(t.season!==F.season)return false;}
  if(F.short&&!(t.rec.ok&&t.rec.phase==='short'))return false;
  if(F.attention&&!phqcNeedsAttention(t))return false;
  const q=_phqcStr(F.q).trim().toLowerCase();
  if(q&&(t.id+' '+t.code+' '+t.name+' '+t.master).toLowerCase().indexOf(q)<0)return false;
  return true;
}
// Needs attention: short, received on a size that was not cut, a cut changed after the lock, or units still on the old Packing page.
function phqcNeedsAttention(t){
  if(!t||!t.rec)return false;
  if(t.rec.ok&&t.rec.phase==='short')return true;
  if(t.rec.ok&&t.rec.verdict&&t.rec.verdict.order.some(function(k){return t.rec.verdict.sizes[k].state==='unexpected';}))return true;
  if(t.exp&&t.exp.drift)return true;
  if(t.lots&&t.lots.length&&phqcLegacyUnits(t.po,t.recon)>0)return true;
  return false;
}
function _phqcPhone(){try{return typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(max-width:600px)').matches;}catch(e){return false;}}
function _phqcFilters(ctx,m){
  const wrap=phEl('div','phaf-filters');
  const q=phEl('input','phaf-search');q.setAttribute('type','search');q.id='phaf-q';
  q.setAttribute('placeholder',phI18nAttr(phI18nD('afloat.search_ph')));q.setAttribute('aria-label',phI18nAttr(phI18nD('afloat.search_label')));
  q.value=_phqcF.q;
  q.addEventListener('input',function(){_phqcF.q=q.value;_phqcPaintGroups(ctx);});
  const sw=phEl('div','phaf-searchrow',null,[q]);
  const open=_phqcFiltersOpen===null?!_phqcPhone():_phqcFiltersOpen;
  const active=(_phqcF.stage?1:0)+(_phqcF.season?1:0)+(_phqcF.short?1:0)+(_phqcF.attention?1:0);
  const tog=_phqcBtn('ph-btn phaf-ftog',phI18nD(active?'afloat.filters_n':'afloat.filters',{n:active}),function(){_phqcFiltersOpen=!open;ctx.repaint();},{'aria-expanded':open?'true':'false','aria-controls':'phaf-frow'});
  sw.appendChild(tog);
  wrap.appendChild(sw);
  const row=phEl('div','phaf-frow'+(open?'':' ph-hidden'));row.id='phaf-frow';
  const sel=function(id,label,opts,val,on){
    const s=phEl('select','phaf-sel');s.id=id;
    opts.forEach(function(o){const op=document.createElement('option');op.value=o.v;op.textContent=phI18nAttr(o.t);if(o.v===val)op.setAttribute('selected','selected');s.appendChild(op);});
    s.value=val;
    s.addEventListener('change',function(){on(s.value);});
    const l=phEl('label','phaf-field',null,[phEl('span','phaf-lab',label),s]);
    return l;
  };
  const stages=[{v:'',t:phI18nD('afloat.f_all_stages')}].concat(['cutting','bundling','stitching','printing','washing','qc','completed'].map(function(k){return{v:k,t:phI18nD(PHAF_STAGE_KEYS[k])};}));
  row.appendChild(sel('phaf-f-stage',phI18nD('afloat.f_stage'),stages,_phqcF.stage,function(v){_phqcF.stage=v;_phqcPaintGroups(ctx);}));
  const seen={},seasons=[{v:'',t:phI18nD('afloat.f_all_seasons')}];
  (m?m.tiles:[]).forEach(function(t){const k=t.season===null?'none':t.season;if(!seen[k]){seen[k]=1;seasons.push({v:k,t:k==='none'?phI18nD('afloat.f_no_season'):(typeof phSeasonLabel==='function'?phSeasonLabel(k):k)});}});
  row.appendChild(sel('phaf-f-season',phI18nD('afloat.f_season'),seasons,_phqcF.season,function(v){_phqcF.season=v;_phqcPaintGroups(ctx);}));
  const chk=function(id,label,val,on){
    const c=document.createElement('input');c.setAttribute('type','checkbox');c.id=id;c.className='phaf-chk';c.checked=!!val;
    if(val)c.setAttribute('checked','checked');
    c.addEventListener('change',function(){on(!!c.checked);});
    return phEl('label','phaf-field phaf-field-chk',null,[c,phEl('span','phaf-lab',label)]);
  };
  row.appendChild(chk('phaf-f-short',phI18nD('afloat.f_short'),_phqcF.short,function(v){_phqcF.short=v;_phqcPaintGroups(ctx);}));
  row.appendChild(chk('phaf-f-att',phI18nD('afloat.f_attention'),_phqcF.attention,function(v){_phqcF.attention=v;_phqcPaintGroups(ctx);}));
  wrap.appendChild(row);
  return wrap;
}
// Paints the groups alone (a keystroke in the search box must not rebuild the box the caret is in).
function _phqcPaintGroups(ctx,model){
  const list=_phqcListEl;if(!list)return;
  phClear(list);
  const m=model||_phqcModelNow();if(!m)return;
  const shown=m.tiles.filter(function(t){return _phqcMatches(t,_phqcF);});
  if(_phqcCountEl){
    const filtering=!!(_phqcF.q||_phqcF.stage||_phqcF.season||_phqcF.short||_phqcF.attention);
    phI18nSet(_phqcCountEl,filtering?phI18nD('afloat.match_count',{n:shown.length,total:m.tiles.length}):'');
  }
  if(!m.tiles.length){list.appendChild(phEl('p','phaf-empty',phI18nD('afloat.empty')));return;}
  if(!shown.length){list.appendChild(phEl('p','phaf-empty',phI18nD('afloat.no_match')));return;}
  PHAF_GROUPS.forEach(function(g){
    const all=m.groups[g.id].filter(function(t){return shown.indexOf(t)>-1;});
    if(!all.length&&g.id==='unknown')return;
    if(!all.length&&g.id==='closed'&&m.counts.closed!==null)return;
    const sec=phEl('section','phaf-group phaf-g-'+g.id);sec.setAttribute('data-group',g.id);
    const collapsible=g.id==='closed';
    const shut=collapsible&&_phqcCollapsed.closed;
    const head=phEl('h3','phaf-ghead');
    const unreadable=PHAF_PHASE_GROUPS.indexOf(g.id)>-1&&(m.counts.ready===null);
    let countNode;
    if(unreadable)countNode=phEl('span','phaf-gcount phaf-unread',phI18nD('shell.unavailable',{collection:!m.lotsOk?'po_qc_lots':'po_qc_recon'}));
    else{
      let txt=phI18nD(all.length===1?'afloat.g_n_one':'afloat.g_n_many',{n:all.length});
      if(g.id==='cutting'&&m.counts.units)txt=phI18nD(all.length===1?'afloat.g_n_units_one':'afloat.g_n_units',{n:all.length,u:m.counts.units});
      countNode=phEl('span','phaf-gcount',txt);
    }
    if(collapsible){
      const b=_phqcBtn('phaf-gtog',null,function(){_phqcCollapsed.closed=!_phqcCollapsed.closed;_phqcPaintGroups(ctx);},{'aria-expanded':shut?'false':'true'});
      b.appendChild(phEl('span','phaf-gtitle',phI18nD(g.key)));b.appendChild(countNode);
      head.appendChild(b);
    }else{
      head.appendChild(phEl('span','phaf-gtitle',phI18nD(g.key)));head.appendChild(countNode);
    }
    sec.appendChild(head);
    if(!shut&&all.length){
      const ul=phEl('div','phaf-tiles');ul.setAttribute('role','list');
      const cap=_phqcShowAll[g.id]?all.length:Math.min(all.length,PHAF_GROUP_CAP);
      all.slice(0,cap).forEach(function(t){const li=phEl('div','phaf-li');li.setAttribute('role','listitem');li.appendChild(phqcTileNode(t,ctx));ul.appendChild(li);});
      ul.addEventListener('keydown',_phqcTileKeys);
      sec.appendChild(ul);
      if(all.length>cap)sec.appendChild(_phqcBtn('ph-btn phaf-more',phI18nD('afloat.show_more',{n:all.length-cap}),function(){_phqcShowAll[g.id]=true;_phqcPaintGroups(ctx);}));
    }
    list.appendChild(sec);
  });
}
// A node's element children as a real array. In a browser `children` is an HTMLCollection, which has no forEach (wave 2 fix:
// `(n.children||[]).forEach` threw there and the arrow keys / Back focus did nothing). Array.prototype.slice works on both.
function _phqcKids(n){return Array.prototype.slice.call((n&&n.children)||[]);}
// Arrow keys move between the tiles of one group (Up/Left back, Down/Right on, Home / End).
function _phqcTileKeys(e){
  const k=e&&e.key;if(!/^(ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Home|End)$/.test(k||''))return;
  const t=e.target&&e.target.closest?e.target.closest('.phaf-card'):null;if(!t)return;
  const ul=t.closest('.phaf-tiles');if(!ul)return;
  const items=[];(function walk(n){_phqcKids(n).forEach(function(c){if(c.nodeType===1){if(c.classList&&c.classList.contains('phaf-card'))items.push(c);else walk(c);}});})(ul);
  const i=items.indexOf(t);if(i<0)return;
  const next=k==='Home'?0:k==='End'?items.length-1:(k==='ArrowDown'||k==='ArrowRight')?Math.min(items.length-1,i+1):Math.max(0,i-1);
  if(items[next]&&typeof items[next].focus==='function')items[next].focus();
  if(e.preventDefault)e.preventDefault();
}
// One tile: a <button> (Enter / tap opens the detail). The picture is inside it (the detail is where it is enlarged).
function phqcTileNode(t,ctx){
  const b=phEl('button','phaf-card phaf-tone-'+t.verdict.tone);b.setAttribute('type','button');b.setAttribute('data-po',t.id);
  b.setAttribute('aria-label',phI18nAttr(phI18nD('afloat.open_aria',{po:t.id,name:phqcAlt(t.po)})));
  b.addEventListener('click',function(){phqcOpen(t.id);});
  b.appendChild(phqcImageNode(t.po,'tile'));
  const body=phEl('span','phaf-cbody');
  const top=phEl('span','phaf-ctop');
  top.appendChild(phEl('span','phaf-po',t.id));
  if(t.code)top.appendChild(phEl('span','phaf-code',t.code));
  body.appendChild(top);
  const nm=phEl('span','phaf-name');nm.textContent=t.name;body.appendChild(nm);
  if(typeof phmkBadgesNode==='function'){const bd=phmkBadgesNode(t.key);if(bd)body.appendChild(bd);}
  body.appendChild(phEl('span','phaf-line phaf-stage',_phqcStageLine(t)));
  body.appendChild(phEl('span','phaf-line phaf-cut',_phqcCutLine(t)));
  const recvLine=_phqcRecvLine(t);if(recvLine)body.appendChild(phEl('span','phaf-line phaf-recv',recvLine));
  const sizes=_phqcSizesNode(t);if(sizes)body.appendChild(sizes);
  body.appendChild(_phqcProgress(t));
  body.appendChild(phqcVerdictNode(t));
  b.appendChild(body);
  return b;
}
// The stage's words: a completed PO whose reconciliation is CLOSED says so (not "reconciliation open").
function _phqcStageKey(t){return t.stage==='completed'&&t.recon&&t.recon.status==='closed'?'afloat.st_completed_closed':(PHAF_STAGE_KEYS[t.stage]||'afloat.st_unknown');}
function _phqcStageLine(t){
  const st=phI18nD(_phqcStageKey(t));
  if(t.stage==='cutting'){
    const bits=[];
    if(t.planDay)bits.push(phI18nT('afloat.planned',{day:_phqcDay(t.planDay)},'en'));
    if(t.master)bits.push(t.master);
    if(typeof t.ordered==='number')bits.push(phI18nT('afloat.ordered_n',{n:t.ordered},'en'));
    return bits.length?phI18nD('afloat.stage_with',{stage:st,rest:bits.join(' · ')}):st;
  }
  return st;
}
function _phqcCutLine(t){
  const e=t.exp;
  if(!e||!e.ok)return phI18nD('afloat.cut_unreadable');
  if(e.source==='none')return phI18nD('afloat.cut_none');
  if(!t.reconOk)return phI18nD('afloat.cut_n_lock_unread',{n:e.total});
  if(e.source==='lock')return phI18nD(e.drift?'afloat.cut_n_final_drift':'afloat.cut_n_final',{n:e.total});
  return phI18nD('afloat.cut_n_open',{n:e.total});
}
// "received 100 of 120 (3 lots, last 14 Oct)" / "received: not read" / null when there is no cut.
function _phqcRecvLine(t){
  if(!t.lotsOk)return phI18nD('afloat.recv_unread');
  if(!t.reconOk)return phI18nD('afloat.recv_unread_recon');
  const r=t.rec;
  if(!r.ok)return phI18nD('afloat.recv_bad',{why:r.why});
  if(!r.cut)return null;
  const n=r.recv?r.recv.total:0;
  if(!r.lotsLive)return phI18nD('afloat.recv_none',{total:r.cut.total});
  return phI18nD(r.lotsLive===1?'afloat.recv_of_one':'afloat.recv_of',{n:n,total:r.cut.total,lots:r.lotsLive,last:_phqcDay(t.lastLotAt)});
}
function _phqcSizesNode(t){
  const r=t.rec;
  if(!r||!r.ok||!r.verdict||!r.lotsLive)return null;
  const w=phEl('span','phaf-sizes');
  r.verdict.order.forEach(function(k){
    const c=phqcSizeCell(k,r.verdict.sizes[k],r.phase);
    const s=phEl('span','phaf-sz'+(c.ok===false?' phaf-sz-bad':c.ok===true?' phaf-sz-ok':''));
    s.appendChild(phEl('span','phaf-sz-t',c.text));
    if(c.glyph){const g=phEl('span','phaf-sz-g',c.glyph);g.setAttribute('aria-hidden','true');s.appendChild(g);}
    s.setAttribute('title',phI18nAttr(c.sentence));s.setAttribute('aria-label',phI18nAttr(c.sentence));
    w.appendChild(s);
  });
  return w;
}
function _phqcProgress(t){
  const r=t.rec;
  const wrap=phEl('span','phaf-prog');
  const has=r&&r.ok&&typeof r.progressPct==='number'&&r.cut;
  const pct=has?r.progressPct:0;
  const bar=phEl('span','phaf-bar');bar.setAttribute('role','img');
  bar.setAttribute('aria-label',phI18nAttr(has?phI18nD('afloat.prog_aria',{n:r.recv?r.recv.total:0,total:r.cut.total,pct:pct}):phI18nD('afloat.prog_aria_none')));
  const fill=phEl('span','phaf-fill');fill.style.width=pct+'%';bar.appendChild(fill);
  wrap.appendChild(bar);
  wrap.appendChild(phEl('span','phaf-pct',has?pct+' %':'—'));
  return wrap;
}
function phqcVerdictNode(t){
  const v=t.verdict;
  const c=phEl('span','phaf-v phaf-v-'+v.tone);c.setAttribute('data-verdict',v.key.replace('afloat.v_',''));
  const g=phEl('span','phaf-v-g',v.glyph);g.setAttribute('aria-hidden','true');c.appendChild(g);
  c.appendChild(phEl('span','phaf-v-w',phI18nD(v.key,v.params||undefined)));
  if(v.extra)c.appendChild(phEl('span','phaf-v-x',v.extra));
  if(t.recon&&t.recon.status==='reopened')c.appendChild(phEl('span','phaf-v-x',phI18nD('afloat.v_reopened')));
  return c;
}

/* ── Screen B: the detail (read-only) ──────────────────────────────────── */
function phqcOpen(id){
  _phqcOpen=String(id||'');_phqcSheet=null;_phqcDlg=null;_phqcFlash=null;
  if(_phqcCtx&&typeof _phqcCtx.repaint==='function')_phqcCtx.repaint();
  try{const m=document.getElementById('main-content');if(m)m.scrollTop=0;}catch(e){}
  try{const b=document.getElementById('phaf-back');if(b&&typeof b.focus==='function')b.focus();}catch(e){}
}
function phqcBack(){
  const id=_phqcOpen;_phqcOpen='';_phqcSheet=null;_phqcDlg=null;_phqcFlash=null;
  if(_phqcCtx&&typeof _phqcCtx.repaint==='function')_phqcCtx.repaint();
  try{   // focus back to the tile that opened the detail
    if(_phqcListEl&&id){(function walk(n){_phqcKids(n).forEach(function(c){if(c.nodeType!==1)return;if(c.getAttribute&&c.getAttribute('data-po')===id&&typeof c.focus==='function'){c.focus();return;}walk(c);});})(_phqcListEl);}
  }catch(e){}
}
function phqcDetail(host,ctx,t){
  const today=typeof phDay==='function'?phDay(Date.now()):null;
  const wrap=phEl('section','phaf-detail');wrap.setAttribute('aria-labelledby','phaf-dtitle');
  const bar=phEl('div','phaf-dbar');
  const back=_phqcBtn('ph-btn phaf-back',phI18nD('afloat.back'),function(){phqcBack();});back.id='phaf-back';
  bar.appendChild(back);
  const title=phEl('h2','ph-title phaf-dtitle');title.id='phaf-dtitle';
  title.textContent=t.id+(t.code?' · '+t.code:'')+(t.name?' · '+t.name:'');
  bar.appendChild(title);
  wrap.appendChild(bar);
  const r=t.rec,e=t.exp,rc=t.recon;
  // header: picture (tap to enlarge) + the facts
  const hd=phEl('div','phaf-dhead');
  const im=phqcImage(t.po);
  if(im.src){
    const pb=_phqcBtn('phaf-picbtn',null,function(){phqcLightbox(t,pb);},{'aria-label':phI18nAttr(phI18nD('afloat.pic_enlarge'))});
    pb.appendChild(phqcImageNode(t.po,'head'));hd.appendChild(pb);
  }else hd.appendChild(phqcImageNode(t.po,'head'));
  const facts=phEl('div','phaf-facts');
  const st=[phI18nT(_phqcStageKey(t),null,'en')];
  if(t.po.cutAt){const cb=_phqcStr(t.po.cutBy);st.push(phI18nT(cb?'afloat.cut_on_by':'afloat.cut_on',{day:_phqcDay(t.po.cutAt,today),who:cb},'en'));}
  if(r.ok&&r.lotsLive)st.push(phI18nT(r.lotsLive===1?'afloat.lots_one':'afloat.lots_n',{n:r.lotsLive},'en'));
  if(t.lastLotAt)st.push(phI18nT('afloat.last_lot',{when:phqcStamp(t.lastLotAt)},'en'));
  facts.appendChild(phEl('p','phaf-fact',st.join(' · ')));
  const ls=_phqcLockSentence(t,today),lp=phEl('p','phaf-fact phaf-lockline');
  if(ls&&ls.nodeType===1)lp.appendChild(ls);else phI18nSet(lp,ls);
  facts.appendChild(lp);
  const vrow=phEl('p','phaf-fact phaf-vrow');
  vrow.appendChild(phEl('span','phaf-vlab',phI18nD('afloat.verdict')));
  vrow.appendChild(phqcVerdictNode(t));
  if(r.ok&&r.verdict&&r.verdict.total){const tt=r.verdict.total;vrow.appendChild(phEl('span','phaf-vtot',phI18nD('afloat.total_line',{recv:tt.recv,cut:tt.cut,diff:tt.diff>0?'+'+tt.diff:String(tt.diff).replace('-','−'),a:tt.allow})));}
  facts.appendChild(vrow);
  const still=_phqcStillLine(t);if(still)facts.appendChild(phEl('p','phaf-fact phaf-still',still));
  hd.appendChild(facts);
  wrap.appendChild(hd);
  // bands
  if(rc&&rc.status==='closed'){
    wrap.appendChild(phEl('p','phaf-band phaf-band-ok phaf-closedline',phI18nD('afloat.band_closed',{when:phqcStamp(rc.closedAt)||'—',who:_phqcStr(rc.closedByName)||_phqcWho(rc.closedBy)})));
    // QC7: a close that was a manager's override says so, with who, the cause and the reason (everyone who sees the detail reads it)
    const cs=_phqcCloseOverrideOf(rc);
    if(cs){const b=phEl('p','phaf-band phaf-band-warn phaf-ovline');b.id='phaf-ovline';phI18nSet(b,phI18nD('afloat.band_closed_short',{who:_phqcStr(cs.byName)||_phqcWho(cs.by),cause:_phqcCauseText(cs.cause),why:_phqcStr(cs.reason)}));wrap.appendChild(b);}
  }
  if(rc&&rc.status==='reopened'){
    const ov=Array.isArray(rc.overrides)?rc.overrides.filter(function(o){return o&&o.kind==='reopen';}).slice(-1)[0]:null;
    wrap.appendChild(phEl('p','phaf-band phaf-band-warn',phI18nD('afloat.band_reopened',{who:ov?(_phqcStr(ov.byName)||_phqcWho(ov.by)):'—',why:ov?_phqcStr(ov.reason):'—'})));
  }
  if(e&&e.drift){
    const d=e.drift.sizes.map(function(s){return s.size+' '+s.lock+' → '+s.live;}).join(', ');
    wrap.appendChild(phEl('p','phaf-band phaf-band-warn',phI18nD('afloat.band_drift',{list:d})));
  }
  if(_phqcFlash&&_phqcFlash.poId===t.id){const f=phEl('p','phaf-band phaf-flash phaf-band-'+(_phqcFlash.tone==='warn'?'warn':'ok'),_phqcFlash.text);f.id='phaf-flash';f.setAttribute('role','status');f.setAttribute('tabindex','-1');wrap.appendChild(f);}
  if(!t.lotsOk)wrap.appendChild(_phqcAlert(phI18nD('afloat.err_one',{n:1}),[phI18nErr(_phqcStage('lots').text||'po_qc_lots: could not be read.')]));
  if(!t.reconOk)wrap.appendChild(_phqcAlert(phI18nD('afloat.err_one',{n:1}),[phI18nErr(_phqcStage('recon').text||'po_qc_recon: could not be read.')]));
  // the table
  wrap.appendChild(_phqcTable(t));
  // hints: bundling damage, QC disposition (read-only), the old Packing receipts
  const hints=phEl('div','phaf-hints');
  const dmg=t.po&&t.po.damageSummary&&t.po.damageSummary.bySize&&typeof t.po.damageSummary.bySize==='object'?t.po.damageSummary.bySize:null;
  const dmgTxt=dmg?Object.keys(dmg).filter(function(k){return +dmg[k]>0;}).map(function(k){return(+dmg[k])+' '+k;}).join(', '):'';
  hints.appendChild(phEl('p','ph-note',dmgTxt?phI18nD('afloat.damage',{list:dmgTxt}):phI18nD('afloat.damage_none')));
  if(typeof qcDoneBySize==='function'){
    try{const dn=qcDoneBySize(t.po)||{};const tot=Object.keys(dn).reduce(function(a,k){return a+(+dn[k]||0);},0);hints.appendChild(phEl('p','ph-note',phI18nD('afloat.dispo',{n:tot})));}catch(x){}
  }
  const lgp=phqcLegacyPlan(t.po,t.recon);
  if(lgp.total>0)hints.appendChild(phEl('p','ph-note phaf-note-warn phaf-legacy-note',phI18nD('afloat.legacy',{n:lgp.total})));
  if(lgp.adopted>0)hints.appendChild(phEl('p','ph-note phaf-legacy-done',phI18nD('afloat.legacy_adopted',{n:lgp.adopted})));
  wrap.appendChild(hints);
  // the actions (QC6): Receive units, Lock cut now, Close PO -- live where the person may act, else drawn DISABLED with the reason;
  // QC7: Close with a shortfall… / Replace the cut snapshot… / Reopen… / Adopt old receipts, for the managers and owners only
  wrap.appendChild(_phqcActions(t,ctx));
  // QC7: the overrides recorded on this reconciliation, read-only, for everyone who sees the detail (Faizan included: no buttons)
  const ovs=_phqcOverridesNode(t);if(ovs)wrap.appendChild(ovs);
  // lots (oldest first, each with its day and time)
  wrap.appendChild(_phqcLots(t,ctx));
  // history
  const hist=_phqcHistory(t,today);if(hist)wrap.appendChild(hist);
  host.appendChild(wrap);
  if(_phqcDlg&&_phqcDlg.poId===t.id)host.appendChild(_phqcDlgNode(t,ctx));
}
function _phqcLockSentence(t,today){
  const e=t.exp,rc=t.recon;
  if(!e||!e.ok)return phI18nD('afloat.cut_unreadable');
  if(e.source==='none')return phI18nD('afloat.lock_none');
  if(!t.reconOk)return phI18nD('afloat.lock_unread');
  if(e.source==='lock'&&rc&&rc.cutLock){
    const L=rc.cutLock,who=_phqcWho(L.lockedBy);
    const how=phI18nD(L.source==='first_lot'?'afloat.lock_how_first':L.source==='relock'?'afloat.lock_how_relock':'afloat.lock_how_manual');
    const n=phEl('span','phaf-lock');n.setAttribute('aria-label',phI18nAttr(phI18nD('afloat.lock_aria')));
    n.appendChild(phEl('span','phaf-lock-g','🔒'));n.lastChild.setAttribute('aria-hidden','true');
    n.appendChild(phEl('span','phaf-stamp',phI18nD('afloat.lock_final',{when:phqcStampBy(L.lockedAt,who),how:how})));
    return n;
  }
  return phI18nD('afloat.lock_open');
}
function _phqcTable(t){
  const r=t.rec,e=t.exp;
  // the table scrolls sideways on its own (a phone); the notes under it do not
  const box=phEl('div','phaf-tablebox');
  const scroller=phEl('div','phaf-tablewrap');box.appendChild(scroller);
  const tb=document.createElement('table');tb.className='phaf-table';
  const cap=document.createElement('caption');cap.className='phaf-cap';phI18nSet(cap,phI18nD('afloat.t_caption'));tb.appendChild(cap);
  const thead=document.createElement('thead');const hr=document.createElement('tr');
  const stitched=_phqcBundles[t.id]||null;
  const ord=!e||e.source==='none';
  const cols=ord?['afloat.t_size','afloat.t_ordered']:['afloat.t_size','afloat.t_cut','afloat.t_stitched','afloat.t_recv','afloat.t_diff','afloat.t_allow','afloat.t_within'];
  cols.forEach(function(k){const th=document.createElement('th');th.setAttribute('scope','col');phI18nSet(th,phI18nD(k));hr.appendChild(th);});
  thead.appendChild(hr);tb.appendChild(thead);
  const tbody=document.createElement('tbody');
  const td=function(tr,txt,cls){const c=document.createElement('td');if(cls)c.className=cls;phI18nSet(c,txt);tr.appendChild(c);return c;};
  if(ord){
    // NO cut: the ORDERED sizes, greyed and said to be the order -- never a stand-in for the cut
    const sz=t.po&&t.po.sizes&&typeof t.po.sizes==='object'?t.po.sizes:{};
    const keys=typeof phQcSizeOrder==='function'?phQcSizeOrder(null,Object.keys(sz)):Object.keys(sz);
    keys.forEach(function(k){if(!(+sz[k]>0))return;const tr=document.createElement('tr');tr.className='phaf-ordered';td(tr,k,'phaf-k');td(tr,phI18nD('afloat.ordered_cell',{n:+sz[k]}),'phaf-n');tbody.appendChild(tr);});
    tb.appendChild(tbody);scroller.appendChild(tb);
    box.appendChild(phEl('p','ph-note',phI18nD('afloat.no_cut_note')));
    return box;
  }
  const lotsRead=t.lotsOk&&r&&r.ok&&r.verdict;
  const st=stitched&&stitched.state==='ok'?phqcStitched(stitched.rows):null;
  const stTxt=function(k){if(!stitched||stitched.state==='loading')return phI18nD('afloat.t_loading');if(stitched.state==='error')return phI18nD('afloat.t_not_read');return String(k==='__total'?st.total:(st.sizes[k]||0));};
  const order=lotsRead?r.verdict.order:e.order;
  order.forEach(function(k){
    const tr=document.createElement('tr');
    const cut=_phqcHas(e.sizes,k)?e.sizes[k]:0;
    td(tr,k,'phaf-k');td(tr,String(cut),'phaf-n');td(tr,stTxt(k),'phaf-n');
    if(lotsRead){
      const s=r.verdict.sizes[k];const c=phqcSizeCell(k,s,r.phase);
      td(tr,String(s.recv),'phaf-n');td(tr,s.diff===0?'0':(s.diff>0?'+'+s.diff:'−'+(-s.diff)),'phaf-n');td(tr,String(s.allow),'phaf-n');
      const v=td(tr,(c.glyph?c.glyph+' ':'')+phI18nT('afloat.cell_'+(s.state==='short'&&r.phase==='receiving'?'expected':s.state),null,'en'),'phaf-st'+(c.ok===false?' phaf-sz-bad':c.ok===true?' phaf-sz-ok':''));
      v.setAttribute('aria-label',phI18nAttr(c.sentence));
    }else{
      ['afloat.t_not_read','afloat.t_not_read','afloat.t_not_read','afloat.t_not_read'].forEach(function(x){td(tr,phI18nD(x),'phaf-n phaf-unread');});
    }
    tbody.appendChild(tr);
  });
  const tr=document.createElement('tr');tr.className='phaf-total';
  td(tr,phI18nD('afloat.t_total'),'phaf-k');td(tr,String(e.total),'phaf-n');td(tr,stTxt('__total'),'phaf-n');
  if(lotsRead){
    const tt=r.verdict.total;
    td(tr,String(tt.recv),'phaf-n');td(tr,tt.diff===0?'0':(tt.diff>0?'+'+tt.diff:'−'+(-tt.diff)),'phaf-n');td(tr,String(tt.allow),'phaf-n');
    const c=phqcSizeCell(phI18nT('afloat.t_total',null,'en'),tt,r.phase);
    td(tr,(c.glyph?c.glyph+' ':'')+phI18nT('afloat.cell_'+(tt.state==='short'&&r.phase==='receiving'?'expected':tt.state),null,'en'),'phaf-st'+(c.ok===false?' phaf-sz-bad':c.ok===true?' phaf-sz-ok':'')).setAttribute('aria-label',phI18nAttr(c.sentence));
  }else ['afloat.t_not_read','afloat.t_not_read','afloat.t_not_read','afloat.t_not_read'].forEach(function(x){td(tr,phI18nD(x),'phaf-n phaf-unread');});
  tbody.appendChild(tr);
  tb.appendChild(tbody);scroller.appendChild(tb);
  const note=stitched&&stitched.state==='ok'&&st?phI18nD('afloat.stitched_note',{done:st.done,n:st.bundles}):(stitched&&stitched.state==='error'?phI18nD('afloat.stitched_failed',{why:phI18nErr(_phqcBundlesErr(stitched))}):phI18nD('afloat.stitched_note_plain'));
  box.appendChild(phEl('p','ph-note phaf-tnote',note));
  // start the bundles read for the stitched column (repaints when it settles)
  if(!stitched)phqcLoadBundles(t.id).then(function(){if(_phqcOpen===t.id)_phqcRepaintLater(_phqcCtx);});
  return box;
}
function _phqcHas(o,k){return!!o&&Object.prototype.hasOwnProperty.call(o,k);}
function _phqcBundlesErr(b){
  const e=b&&b.err;if(!e)return'bundles: read failed.';
  if(e.permission)return'bundles: could not be read - the signed-in account is refused.';
  if(e.code==='from-cache')return'bundles: only this device\'s offline copy was available, so it was not read - get a connection and retry.';
  if(e.code==='timeout')return'bundles: the read did not finish in '+Math.round(PHAF_TIMEOUT_MS/1000)+'s.';
  return'bundles: read failed ('+(e.message||e.code||'unknown')+').';
}
/* ── QC6: the lots, the actions, the receive sheet and the confirms ────────────────────────────────────────────────────────
   SAVED ENTRIES ARE NEVER EDITED (the owner's rule). A lot is one DELIVERY of finished units from stitching to QC; a PO of 120 pieces is
   received in as many lots, on as many days, from as many visits and phones as it takes, and every visit adds a NEW lot. Nothing on this
   tab changes a saved lot, a lock or a close: there is no edit control anywhere. A mistake is put right with a NEW entry -- void the lot
   (with a reason; it stays listed, struck through) and receive the delivery again. The writers carry no path that rewrites a lot either
   (js/ph-qc-write.js phQcVoidLot touches only status / voidedAt / voidedBy / voidReason), and firestore.rules lets a lot change ONLY
   live -> void with exactly those four fields (phqcLotVoidOk); a lock and a close are replaced only by an owner's override (QC7).
   Writes go through the QC4 writers only: phQcAddLot / phQcVoidLot / phQcClose (js/ph-qc-write.js) and phQcLockCut (js/ph-write.js),
   each behind typeof. Nothing is written until the person presses the final Save / Lock / Close / Void. One write at a time (_phqcBusy). */
let _phqcSheet=null;   // the receive sheet: {poId, vals:{size:text}, note, day, step:'edit'|'review', msg, saving}
let _phqcDlg=null;     // a confirm: {kind:'lock'|'close'|'void', poId, lotId, reason, msg, opener}
let _phqcFlash=null;   // the line under the header after a write: {poId, text, tone:'ok'|'warn'}
let _phqcBusy=false;   // one write at a time (a double press saves once)
let _phqcFocusId='';   // the element to focus after the next paint

function _phqcModelOf(po){
  if(typeof phSizeModel!=='function'||typeof _phPoArt!=='function')return null;
  try{const a=phSizeModel(_phPoArt(po||{}));return a.source==='default'?null:a.model;}catch(e){return null;}
}
function _phqcVoidWindow(){return typeof PHQC_VOID_WINDOW_MS==='number'?PHQC_VOID_WINDOW_MS:86400000;}
function _phqcOpenRecon(rc){return!!rc&&(rc.status==='locked'||rc.status==='reopened');}
function _phqcOffline(){try{return typeof navigator!=='undefined'&&!!navigator&&navigator.onLine===false;}catch(e){return false;}}
const PHAF_STAGES_FALLBACK=Object.freeze(['cutting','bundling','stitching','printing','washing','qc']);
function _phqcStageOkForClose(st){
  const o=typeof PH_REAL_STAGE_ORDER!=='undefined'&&Array.isArray(PH_REAL_STAGE_ORDER)?PH_REAL_STAGE_ORDER:PHAF_STAGES_FALLBACK;
  return st==='completed'||o.indexOf(st)>=o.indexOf('stitching');
}
// Who may receive on this PO now: QC Ops or a manager, a cut to hold it to, the reconciliation and the lots read, not closed.
function phqcCanReceive(t,u){
  if(!t||!t.rec||!t.rec.ok||!t.rec.cut||!t.reconOk||!t.lotsOk)return false;
  if(t.recon&&!_phqcOpenRecon(t.recon))return false;
  return phqcIsManager(u)||phqcIsQc(u);
}
// May `u` void lot x? A manager any time; QC Ops (Faizan) his OWN lot within 24 h. Only a live lot, only while the reconciliation is open.
function phqcCanVoid(t,x,u,now){
  if(!t||!x||x.status!=='live'||!_phqcOpenRecon(t.recon)||!t.reconOk)return false;
  const who=_phqcUser(u);
  if(phqcIsManager(who))return true;
  if(!phqcIsQc(who)||x.by!==who||typeof x.at!=='number')return false;
  return(typeof now==='number'?now:Date.now())-x.at<=_phqcVoidWindow();
}
// "XL 20, M 5" -- what is still expected per size (cut minus received, sizes still short), largest first; '' when nothing.
function _phqcStillList(v){
  if(!v||!Array.isArray(v.order))return'';
  return v.order.map(function(k){return{k:k,n:-v.sizes[k].diff};}).filter(function(g){return g.n>0;}).map(function(g){return g.k+' '+g.n;}).join(' · ');
}
// The detail's "still expected per size" line, after every lot (null before a cut or with nothing outstanding).
function _phqcStillLine(t){
  const r=t&&t.rec;
  if(!r||!r.ok||!r.verdict||r.phase==='closed'||r.phase==='awaiting_cut')return null;
  const list=_phqcStillList(r.verdict),tot=r.verdict.total;
  if(!list)return phI18nD('afloat.still_none');
  return phI18nD('afloat.still_line',{list:list,n:Math.max(0,-tot.diff)});
}
function _phqcLotsSorted(lots){
  return(lots||[]).slice().sort(function(a,b){
    const sa=typeof a.seq==='number'?a.seq:1e9,sb=typeof b.seq==='number'?b.seq:1e9;
    if(sa!==sb)return sa-sb;
    return(a.at||0)-(b.at||0);
  });
}
function _phqcLotSizesText(x){
  const sz=x&&x.sizes&&typeof x.sizes==='object'?x.sizes:{};
  const keys=typeof phQcSizeOrder==='function'?phQcSizeOrder(null,Object.keys(sz)):Object.keys(sz);
  return keys.map(function(k){return k+' '+sz[k];}).join(' · ');
}
function _phqcLotTotal(x){
  if(x&&typeof x.total==='number')return x.total;
  const sz=x&&x.sizes&&typeof x.sizes==='object'?x.sizes:{};
  return Object.keys(sz).reduce(function(a,k){return a+(+sz[k]||0);},0);
}
// One saved lot, read-only: "Lot #1 · Mon 12 Oct 2026, 4:00 PM by Faizan" / "40 pcs delivered to QC: S 10 · M 15 · L 10 · XL 5".
// The stamp is the lot's `at` (the moment it was saved, bound by the rules to the server clock); the lot's `day` is the day the person
// said the units were delivered -- it may be earlier than the day of `at` (a delivery entered later), and is then said beside it.
function phqcLotNode(x,opts){
  const o=opts||{};
  const li=phEl('li','phaf-lot'+(x.status==='void'?' phaf-lot-void':''));
  li.setAttribute('data-lot',_phqcStr(x.id));
  const head=phEl('span','phaf-lot-h phaf-stamp');
  phI18nSet(head,phI18nD('afloat.lot_head',{n:x.seq!=null?x.seq:'?',when:phqcStampBy(x.at,_phqcStr(x.byName)||_phqcWho(x.by))}));
  li.appendChild(head);
  const body=phEl('span','phaf-lot-b');
  phI18nSet(body,phI18nD('afloat.lot_body',{n:_phqcLotTotal(x),list:_phqcLotSizesText(x)}));
  li.appendChild(body);
  const atDay=typeof phDay==='function'?phDay(x.at):null;
  if(x.day&&atDay&&x.day!==atDay)li.appendChild(phEl('span','phaf-lot-day',phI18nD('afloat.lot_day',{day:_phqcDayLong(x.day)})));
  if(x.src==='legacy')li.appendChild(phEl('span','phaf-lot-tag',phI18nD('afloat.lot_legacy')));
  if(x.note){const n=phEl('span','phaf-lot-note');n.textContent='“'+_phqcStr(x.note)+'”';li.appendChild(n);}
  if(x.status==='void'){
    const v=phEl('span','phaf-lot-voidw phaf-stamp');
    phI18nSet(v,phI18nD('afloat.lot_voided',{when:phqcStampBy(x.voidedAt,_phqcWho(x.voidedBy)),why:_phqcStr(x.voidReason)}));
    li.appendChild(v);
  }
  if(o.voidBtn){
    const b=_phqcBtn('ph-btn phaf-void',phI18nD('afloat.a_void'),function(){phqcVoidAsk(o.poId,_phqcStr(x.id),b.id);},{'aria-label':phI18nAttr(phI18nD('afloat.a_void_aria',{n:x.seq}))});
    b.id='phaf-void-'+_phqcStr(x.id);
    li.appendChild(b);
  }
  return li;
}
function _phqcLots(t,ctx){
  const sec=phEl('section','phaf-lots');
  sec.appendChild(phEl('h3','ph-card-title',phI18nD('afloat.lots')));
  sec.appendChild(phEl('p','ph-note phaf-lots-what',phI18nD('afloat.lots_what')));
  if(!t.lotsOk){sec.appendChild(phEl('p','ph-note phaf-unread',phI18nD('afloat.lots_unread')));return sec;}
  const l=_phqcLotsSorted(t.lots);
  if(!l.length){sec.appendChild(phEl('p','ph-note',phI18nD('afloat.lots_none')));sec.appendChild(phEl('p','ph-note phaf-noedit',phI18nD('afloat.no_edit')));return sec;}
  const ul=phEl('ul','phaf-lotlist');
  const now=Date.now();
  l.forEach(function(x){ul.appendChild(phqcLotNode(x,{poId:t.id,voidBtn:phqcCanVoid(t,x,ctx.user,now)}));});
  sec.appendChild(ul);
  sec.appendChild(phEl('p','ph-note phaf-noedit',phI18nD('afloat.no_edit')));
  return sec;
}
function _phqcActions(t,ctx){
  const sec=phEl('section','phaf-actions');
  const r=t.rec,rc=t.recon;
  const closed=!!rc&&rc.status==='closed';
  const mgr=phqcIsManager(ctx.user),qc=phqcIsQc(ctx.user);
  const row=phEl('div','phaf-arow');
  const why=[];
  const off=function(key,reasonKey,params,id){
    const b=phEl('button','ph-btn phaf-off',phI18nD(key));b.setAttribute('type','button');b.setAttribute('disabled','disabled');b.disabled=true;b.setAttribute('aria-disabled','true');
    const wid='phaf-off-why-'+why.length;b.setAttribute('aria-describedby',wid);if(id)b.id=id;
    why.push({id:wid,text:phI18nD(reasonKey,params||undefined)});
    return b;
  };
  if(closed){
    sec.appendChild(phEl('p','ph-note phaf-closed-note',phI18nD('afloat.closed_no_more')));
    // QC7: an OWNER may reopen it (a new overrides row; the closed record and the history are kept)
    if(phqcCanReopen(t,ctx.user)){
      const b=_phqcBtn('ph-btn phaf-reopen-btn',phI18nD('afloat.a_reopen'),function(){phqcReopenAsk(t.id,b.id);});b.id='phaf-reopen-btn';
      sec.appendChild(phEl('div','phaf-arow',null,[b]));
    }
    return sec;
  }
  if(r&&r.ok&&r.cut&&(mgr||qc)){
    if(phqcCanReceive(t,ctx.user)){
      const b=_phqcBtn('ph-btn ph-btn-primary phaf-recv-btn',phI18nD('afloat.a_receive'),function(){phqcSheetOpen(t.id);});b.id='phaf-recv-btn';row.appendChild(b);
    }else row.appendChild(off('afloat.a_receive','afloat.why_recv_unread',null,'phaf-recv-btn'));
  }
  if(mgr&&t.exp&&t.exp.ok&&t.exp.source==='live'&&t.reconOk&&!rc){
    const b=_phqcBtn('ph-btn phaf-lock-btn',phI18nD('afloat.a_lock'),function(){phqcLockAsk(t.id,b.id);});b.id='phaf-lock-btn';row.appendChild(b);
  }
  let note=null;
  if(r&&r.ok&&rc){
    if(r.phase==='ready'&&(mgr||qc)){
      if(_phqcStageOkForClose(t.stage)){const b=_phqcBtn('ph-btn ph-btn-primary phaf-close-btn',phI18nD('afloat.a_close'),function(){phqcCloseAsk(t.id,b.id);});b.id='phaf-close-btn';row.appendChild(b);}
      else row.appendChild(off('afloat.a_close','afloat.why_close_stage',{stage:phI18nD(PHAF_STAGE_KEYS[t.stage]||'afloat.st_unknown')},'phaf-close-btn'));
    }else if(r.phase==='receiving'||r.phase==='short'){
      // QC7: a MANAGER closes a PO that is not 'ready' with a reason and a cause (an override); never the floor
      if(mgr){
        if(phqcCanCloseShort(t,ctx.user)){const b=_phqcBtn('ph-btn phaf-short-btn',phI18nD('afloat.a_close_short'),function(){phqcShortAsk(t.id,b.id);});b.id='phaf-close-btn';row.appendChild(b);}
        else if(!_phqcStageOkForClose(t.stage))row.appendChild(off('afloat.a_close_short','afloat.why_close_stage',{stage:phI18nD(PHAF_STAGE_KEYS[t.stage]||'afloat.st_unknown')},'phaf-close-btn'));
        else row.appendChild(off('afloat.a_close_short','afloat.why_ov_full',null,'phaf-close-btn'));
      }
      else if(qc&&r.phase==='receiving')row.appendChild(off('afloat.a_close','afloat.why_close_wait',{list:_phqcStillList(r.verdict)||'—'},'phaf-close-btn'));
      else if(qc)note=phI18nD('afloat.why_close_short');
    }
  }
  // QC7: Replace the cut snapshot… (owner). Only when the PO's recorded cut differs from the lock (the drift band says so): there is
  // nothing to replace otherwise, so nothing is drawn. A manager who is not an owner sees it disabled then (so he knows whom to ask);
  // the floor never sees it.
  if(rc&&_phqcOpenRecon(rc)&&t.reconOk&&t.exp&&t.exp.ok&&t.exp.source==='lock'){
    if(phqcCanRelock(t,ctx.user)){const b=_phqcBtn('ph-btn phaf-relock-btn',phI18nD('afloat.a_relock'),function(){phqcRelockAsk(t.id,b.id);});b.id='phaf-relock-btn';row.appendChild(b);}
    else if(t.exp.drift&&phqcIsOwner(ctx.user))row.appendChild(off('afloat.a_relock','afloat.why_ov_full',null,'phaf-relock-btn'));
    else if(t.exp.drift&&mgr)row.appendChild(off('afloat.a_relock','afloat.why_relock_owner',null,'phaf-relock-btn'));
  }
  // QC7: Adopt old receipts as lot #n (managers), only while there are old Packing receipts that are not adopted yet
  if(phqcCanAdopt(t,ctx.user)){
    const seq=(rc&&typeof rc.lotCount==='number'?rc.lotCount:0)+1;
    const b=_phqcBtn('ph-btn phaf-adopt-btn',phI18nD('afloat.a_adopt',{n:seq}),function(){phqcAdoptAsk(t.id,b.id);});b.id='phaf-adopt-btn';row.appendChild(b);
  }
  if(row.firstChild)sec.appendChild(row);
  why.forEach(function(w){const p=phEl('p','ph-note phaf-off-why',w.text);p.id=w.id;sec.appendChild(p);});
  if(note)sec.appendChild(phEl('p','ph-note phaf-off-why phaf-short-note',note));
  return sec;
}
function _phqcHistory(t,today){
  void today;
  const ev=[];
  const L=t.recon&&t.recon.cutLock;
  if(L&&typeof L.lockedAt==='number')ev.push({at:L.lockedAt,d:phI18nD('afloat.h_locked',{when:phqcStampBy(L.lockedAt,_phqcWho(L.lockedBy))})});
  (t.lots||[]).forEach(function(x){
    if(typeof x.at==='number')ev.push({at:x.at,d:phI18nD('afloat.h_lot',{n:x.seq!=null?x.seq:'?',when:phqcStampBy(x.at,_phqcStr(x.byName)||_phqcWho(x.by))})});
    if(x.status==='void'&&typeof x.voidedAt==='number')ev.push({at:x.voidedAt,d:phI18nD('afloat.h_lot_voided',{n:x.seq!=null?x.seq:'?',when:phqcStampBy(x.voidedAt,_phqcWho(x.voidedBy))})});
  });
  (t.recon&&Array.isArray(t.recon.overrides)?t.recon.overrides:[]).forEach(function(o){if(o&&typeof o.at==='number')ev.push({at:o.at,d:phI18nD('afloat.h_override_'+(o.kind==='relock'||o.kind==='reopen'||o.kind==='close_short'?o.kind:'other'),{when:phqcStampBy(o.at,_phqcStr(o.byName)||_phqcWho(o.by))})});});
  if(t.recon&&typeof t.recon.closedAt==='number'&&t.recon.closedAt>0)ev.push({at:t.recon.closedAt,d:phI18nD('afloat.h_closed',{when:phqcStampBy(t.recon.closedAt,_phqcStr(t.recon.closedByName)||_phqcWho(t.recon.closedBy))})});
  if(!ev.length)return null;
  ev.sort(function(a,b){return a.at-b.at;});
  const sec=phEl('section','phaf-hist');
  sec.appendChild(phEl('h3','phaf-vlab',phI18nD('afloat.history')));
  const ul=phEl('ul','phaf-histlist');
  ev.forEach(function(e){ul.appendChild(phEl('li','phaf-hist-i phaf-stamp',e.d));});
  sec.appendChild(ul);
  return sec;
}

/* ── the receive sheet (Screen C, phone-first) ─────────────────────────────────────────────────────────────────────────── */
function _phqcPaint(){if(_phqcCtx&&typeof _phqcCtx.repaint==='function'&&_phqcIsHere())_phqcCtx.repaint();}
function _phqcToday(){return typeof phDay==='function'?phDay(Date.now()):'';}
// Opens a BLANK sheet for one more delivery (nothing carried over from an earlier visit or a draft that was not saved).
function phqcSheetOpen(id){
  const t=_phqcFindTile(String(id||''));
  if(!t||!phqcCanReceive(t,_phqcUser()))return false;
  _phqcSheet={poId:t.id,vals:{},note:'',day:_phqcToday(),step:'edit',msg:null,saving:false};
  _phqcFlash=null;_phqcDlg=null;
  const first=t.rec.cut.order[0];
  _phqcFocusId=first?'phaf-rx-in-'+first:'phaf-sheet-x';
  _phqcPaint();
  return true;
}
// Closes the sheet. A sheet that was not saved is thrown away: nothing was written and nothing is kept.
function phqcSheetClose(){
  if(!_phqcSheet)return false;
  _phqcSheet=null;_phqcFocusId='phaf-recv-btn';
  _phqcPaint();
  return true;
}
// The lot as typed: canonical size -> whole number, a blank box is 0; a box that is not a whole number stays its text (phQcLotProblem says so).
function _phqcSheetLot(S){
  const out={};
  Object.keys(S.vals||{}).forEach(function(k){
    const v=String(S.vals[k]==null?'':S.vals[k]).trim();
    if(v==='')return;
    out[k]=/^[0-9]+$/.test(v)?parseInt(v,10):v;
  });
  return out;
}
// The live preview: the refusal (null = may be saved), the totals and the verdict after this lot. Pure over the tile.
function phqcSheetPreview(t,vals){
  const r=t.rec,cut=r.cut.sizes,recv=r.recv?r.recv.sizes:{},model=_phqcModelOf(t.po);
  const lot=_phqcSheetLot({vals:vals||{}});
  const problem=typeof phQcLotProblem==='function'?phQcLotProblem(cut,recv,lot,{model:model}):'the QC core is not loaded';
  let lotTotal=0;Object.keys(lot).forEach(function(k){if(typeof lot[k]==='number')lotTotal+=lot[k];});
  const after={};
  r.cut.order.forEach(function(k){after[k]=(_phqcHas(recv,k)?recv[k]:0)+(typeof lot[k]==='number'?lot[k]:0);});
  Object.keys(recv).forEach(function(k){if(!_phqcHas(after,k))after[k]=recv[k];});
  const v=typeof phQcVerdict==='function'?phQcVerdict(cut,after,{model:model}):null;
  let phase=null;
  if(v&&v.ok)phase=v.total.state==='short'?'receiving':(v.state==='exact'||v.state==='within'||v.state==='over')?'ready':'short';
  return{lot:lot,lotTotal:lotTotal,problem:problem,empty:lotTotal===0&&!Object.keys(lot).some(function(k){return typeof lot[k]!=='number';}),after:after,verdict:v,phase:phase,
    recvTotal:r.recv?r.recv.total:0,cutTotal:r.cut.total};
}
// "after this lot: 120 of 120 — exact" (a descriptor)
function _phqcAfterText(p){
  const n=p.recvTotal+p.lotTotal;
  if(!p.verdict||!p.verdict.ok)return phI18nD('afloat.rx_after_plain',{n:n,cut:p.cutTotal});
  if(p.phase==='receiving')return phI18nD('afloat.rx_after_recv',{n:n,cut:p.cutTotal,list:_phqcStillList(p.verdict)});
  if(p.phase==='ready')return phI18nD('afloat.rx_after_'+(p.verdict.state==='exact'?'exact':p.verdict.state==='over'?'over':'within'),{n:n,cut:p.cutTotal});
  return phI18nD('afloat.rx_after_short',{n:n,cut:p.cutTotal});
}
// One size's hint while typing: "✓ complete", "→ will be exact", "→ 5 still expected after this lot", "would be 2 over — allowed 1".
function _phqcRowHint(c,have,add,allow){
  const a=typeof add==='number'?add:0,after=have+a;
  if(after>c+allow)return{key:'afloat.rx_h_over',p:{n:after-c,a:allow},bad:true};
  if(after===c)return{key:a?'afloat.rx_h_exact':'afloat.rx_h_complete',p:null,bad:false};
  if(after>c)return{key:'afloat.rx_h_overok',p:{n:after-c,a:allow},bad:false};
  return{key:a?'afloat.rx_h_still_after':'afloat.rx_h_still',p:{n:c-after},bad:false};
}
function phqcSheetView(host,ctx,t){
  const S=_phqcSheet,r=t.rec,cut=r.cut,recv=r.recv?r.recv.sizes:{};
  const wrap=phEl('section','phaf-sheet');wrap.setAttribute('aria-labelledby','phaf-stitle');
  const bar=phEl('div','phaf-dbar');
  const x=_phqcBtn('ph-btn phaf-back',phI18nD('afloat.rx_cancel'),function(){phqcSheetClose();});x.id='phaf-sheet-x';
  bar.appendChild(x);
  const title=phEl('h2','ph-title phaf-dtitle');title.id='phaf-stitle';
  phI18nSet(title,phI18nD('afloat.rx_title',{po:t.id+(t.code?' · '+t.code:'')+(t.name?' · '+t.name:'')}));
  bar.appendChild(title);
  wrap.appendChild(bar);
  const hd=phEl('div','phaf-dhead');
  hd.appendChild(phqcImageNode(t.po,'tile'));
  const facts=phEl('div','phaf-facts');
  facts.appendChild(phEl('p','phaf-fact phaf-rx-what',phI18nD('afloat.rx_what')));
  facts.appendChild(phEl('p','phaf-fact',phI18nD(t.exp&&t.exp.source==='lock'?'afloat.rx_cut_final':'afloat.rx_cut_locks',{n:cut.total})));
  const still=_phqcStillLine(t);if(still)facts.appendChild(phEl('p','phaf-fact phaf-still',still));
  hd.appendChild(facts);
  wrap.appendChild(hd);
  const pv=phqcSheetPreview(t,S.vals);
  const msg=phEl('p','phaf-rx-msg');msg.id='phaf-rx-msg';msg.setAttribute('role','alert');
  if(S.msg){phI18nSet(msg,S.msg);msg.classList.add('phaf-rx-msg-on');}
  if(S.step==='review'){
    // the final step: the numbers once more, BEFORE the save, because a saved lot cannot be edited
    const rv=phEl('div','phaf-review');rv.setAttribute('role','group');rv.setAttribute('aria-labelledby','phaf-rv-title');
    const h=phEl('h3','ph-card-title',phI18nD('afloat.rv_title'));h.id='phaf-rv-title';rv.appendChild(h);
    rv.appendChild(phEl('p','ph-note phaf-noedit',phI18nD('afloat.rv_final')));
    const tb=document.createElement('table');tb.className='phaf-table phaf-rv-table';
    const tr0=document.createElement('tr');
    ['afloat.t_size','afloat.rx_c_lot','afloat.rx_c_after','afloat.t_cut'].forEach(function(k){const th=document.createElement('th');th.setAttribute('scope','col');phI18nSet(th,phI18nD(k));tr0.appendChild(th);});
    const th0=document.createElement('thead');th0.appendChild(tr0);tb.appendChild(th0);
    const tbody=document.createElement('tbody');
    cut.order.forEach(function(k){
      const add=typeof pv.lot[k]==='number'?pv.lot[k]:0;
      const tr=document.createElement('tr');
      [k,String(add),String(pv.after[k]),String(cut.sizes[k])].forEach(function(v,i){const td=document.createElement('td');td.className=i?'phaf-n':'phaf-k';td.textContent=v;tr.appendChild(td);});
      tbody.appendChild(tr);
    });
    const trt=document.createElement('tr');trt.className='phaf-total';
    [phI18nT('afloat.t_total',null,'en'),String(pv.lotTotal),String(pv.recvTotal+pv.lotTotal),String(cut.total)].forEach(function(v,i){const td=document.createElement('td');td.className=i?'phaf-n':'phaf-k';td.textContent=v;trt.appendChild(td);});
    tbody.appendChild(trt);tb.appendChild(tbody);
    const tw=phEl('div','phaf-tablewrap');tw.appendChild(tb);rv.appendChild(tw);
    rv.appendChild(phEl('p','phaf-fact phaf-rx-after',_phqcAfterText(pv)));
    rv.appendChild(phEl('p','phaf-fact',phI18nD('afloat.rv_day',{day:_phqcDayLong(S.day)||S.day})));
    if(S.note){const n=phEl('p','phaf-fact phaf-rv-note');n.textContent='“'+S.note+'”';rv.appendChild(n);}
    wrap.appendChild(rv);
    wrap.appendChild(msg);
    const acts=phEl('div','phaf-rx-acts');
    const save=_phqcBtn('ph-btn ph-btn-primary phaf-rx-save',phI18nD(S.saving?'afloat.rx_saving':'afloat.rx_save'),function(){phqcSheetSave();});save.id='phaf-rx-save';
    if(S.saving||_phqcBusy){save.setAttribute('aria-disabled','true');save.setAttribute('aria-busy','true');}
    acts.appendChild(save);
    const edit=_phqcBtn('ph-btn phaf-rx-edit',phI18nD('afloat.rx_edit'),function(){if(_phqcBusy)return;S.step='edit';S.msg=null;_phqcFocusId='phaf-rx-review';_phqcPaint();});edit.id='phaf-rx-edit';
    acts.appendChild(edit);
    wrap.appendChild(acts);
  }else{
    const form=phEl('div','phaf-rx');
    const dl=phEl('label','phaf-field phaf-rx-dayf');
    dl.appendChild(phEl('span','phaf-lab',phI18nD('afloat.rx_day')));
    const di=phEl('input','phaf-rx-day');di.id='phaf-rx-day';di.setAttribute('type','date');di.value=S.day||'';
    const today=_phqcToday();if(today)di.setAttribute('max',today);
    if(typeof t.po.cutDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.po.cutDate))di.setAttribute('min',t.po.cutDate);
    di.addEventListener('input',function(){S.day=di.value;_phqcSheetLive(t);});di.addEventListener('change',function(){S.day=di.value;_phqcSheetLive(t);});
    dl.appendChild(di);form.appendChild(dl);
    const tb=document.createElement('table');tb.className='phaf-table phaf-rx-table';
    const cap=document.createElement('caption');cap.className='phaf-cap';phI18nSet(cap,phI18nD('afloat.rx_caption'));tb.appendChild(cap);
    const tr0=document.createElement('tr');
    ['afloat.t_size','afloat.rx_c_cut','afloat.rx_c_sofar','afloat.rx_c_lot'].forEach(function(k){const th=document.createElement('th');th.setAttribute('scope','col');phI18nSet(th,phI18nD(k));tr0.appendChild(th);});
    const th0=document.createElement('thead');th0.appendChild(tr0);tb.appendChild(th0);
    const tbody=document.createElement('tbody');
    const inputs=[];
    cut.order.forEach(function(k,ix){
      const tr=document.createElement('tr');
      const c=cut.sizes[k],have=_phqcHas(recv,k)?recv[k]:0;
      const tdk=document.createElement('td');tdk.className='phaf-k';tdk.textContent=k;tr.appendChild(tdk);
      const tdc=document.createElement('td');tdc.className='phaf-n';tdc.textContent=String(c);tr.appendChild(tdc);
      const tdh=document.createElement('td');tdh.className='phaf-n';tdh.textContent=String(have);tr.appendChild(tdh);
      const tdi=document.createElement('td');tdi.className='phaf-rx-cell';
      const grp=phEl('div','phaf-step');
      const inp=phEl('input','phaf-rx-in');inp.id='phaf-rx-in-'+k;inp.setAttribute('type','number');inp.setAttribute('inputmode','numeric');
      inp.setAttribute('min','0');inp.setAttribute('step','1');inp.setAttribute('autocomplete','off');
      inp.setAttribute('aria-label',phI18nAttr(phI18nD('afloat.rx_in_aria',{size:k})));
      inp.value=S.vals[k]!=null?String(S.vals[k]):'';
      const set=function(v){inp.value=v;S.vals[k]=v;_phqcSheetLive(t);};
      const minus=_phqcBtn('ph-btn phaf-stepb',null,function(){const n=parseInt(inp.value,10);set(String(isFinite(n)&&n>0?n-1:0));},{'aria-label':phI18nAttr(phI18nD('afloat.rx_minus',{size:k}))});minus.textContent='−';
      const plus=_phqcBtn('ph-btn phaf-stepb',null,function(){const n=parseInt(inp.value,10);set(String(isFinite(n)&&n>=0?n+1:1));},{'aria-label':phI18nAttr(phI18nD('afloat.rx_plus',{size:k}))});plus.textContent='+';
      inp.addEventListener('input',function(){S.vals[k]=inp.value;_phqcSheetLive(t);});
      inp.addEventListener('focus',function(){_phqcFocusId=inp.id;});
      inp.addEventListener('keydown',function(e){
        if(e&&e.key==='Enter'){if(e.preventDefault)e.preventDefault();const nx=inputs[ix+1];const to=nx||document.getElementById('phaf-rx-note');if(to&&typeof to.focus==='function')to.focus();}
      });
      inputs.push(inp);
      grp.appendChild(minus);grp.appendChild(inp);grp.appendChild(plus);
      tdi.appendChild(grp);
      const hint=phEl('span','phaf-rx-hint');hint.id='phaf-rx-hint-'+k;hint.setAttribute('aria-live','polite');
      tdi.appendChild(hint);
      tr.appendChild(tdi);
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);
    const tw=phEl('div','phaf-tablewrap');tw.appendChild(tb);form.appendChild(tw);
    const tot=phEl('p','phaf-fact phaf-rx-total');tot.id='phaf-rx-total';tot.setAttribute('aria-live','polite');form.appendChild(tot);
    const prob=phEl('p','phaf-rx-problem');prob.id='phaf-rx-problem';prob.setAttribute('role','status');form.appendChild(prob);
    const nl=phEl('label','phaf-field phaf-rx-notef');
    nl.appendChild(phEl('span','phaf-lab',phI18nD('afloat.rx_note')));
    const ta=phEl('textarea','phaf-rx-note');ta.id='phaf-rx-note';ta.setAttribute('maxlength','200');ta.setAttribute('rows','2');ta.value=S.note||'';
    const cnt=phEl('span','phaf-rx-count');cnt.id='phaf-rx-count';
    ta.addEventListener('input',function(){if(ta.value.length>200)ta.value=ta.value.slice(0,200);S.note=ta.value;cnt.textContent=ta.value.length+' / 200';});
    cnt.textContent=(S.note||'').length+' / 200';
    nl.appendChild(ta);nl.appendChild(cnt);form.appendChild(nl);
    wrap.appendChild(form);
    wrap.appendChild(msg);
    const acts=phEl('div','phaf-rx-acts');
    const go=_phqcBtn('ph-btn ph-btn-primary phaf-rx-review',phI18nD('afloat.rx_review'),function(){phqcSheetReview();});go.id='phaf-rx-review';
    acts.appendChild(go);
    wrap.appendChild(acts);
  }
  // the lots already delivered (read-only, oldest first, with their day and time)
  const so=phEl('section','phaf-lots phaf-rx-sofar');
  so.appendChild(phEl('h3','ph-card-title',phI18nD('afloat.rx_sofar',{n:(t.lots||[]).filter(function(l){return l&&l.status==='live';}).length})));
  const l=_phqcLotsSorted(t.lots);
  if(!l.length)so.appendChild(phEl('p','ph-note',phI18nD('afloat.lots_none')));
  else{const ul=phEl('ul','phaf-lotlist');l.forEach(function(xx){ul.appendChild(phqcLotNode(xx,{}));});so.appendChild(ul);}
  so.appendChild(phEl('p','ph-note phaf-noedit',phI18nD('afloat.no_edit')));
  wrap.appendChild(so);
  host.appendChild(wrap);
  if(S.step!=='review')_phqcSheetLive(t);
}
// Repaints ONLY the preview nodes (a keystroke never rebuilds the box the caret is in).
function _phqcSheetLive(t){
  const S=_phqcSheet;if(!S||S.step!=='edit')return;
  const pv=phqcSheetPreview(t,S.vals);
  const recv=t.rec.recv?t.rec.recv.sizes:{};
  t.rec.cut.order.forEach(function(k){
    const h=document.getElementById('phaf-rx-hint-'+k);if(!h)return;
    const raw=String(S.vals[k]==null?'':S.vals[k]).trim();
    const add=raw===''?0:(/^[0-9]+$/.test(raw)?parseInt(raw,10):null);
    if(add===null){phI18nSet(h,phI18nD('afloat.rx_h_bad'));h.className='phaf-rx-hint phaf-rx-hint-bad';return;}
    const c=t.rec.cut.sizes[k],have=_phqcHas(recv,k)?recv[k]:0,allow=typeof phQcAllowance==='function'?phQcAllowance(c):0;
    const hn=_phqcRowHint(c,have,add,allow);
    phI18nSet(h,phI18nD(hn.key,hn.p||undefined));
    h.className='phaf-rx-hint'+(hn.bad?' phaf-rx-hint-bad':'');
  });
  const tot=document.getElementById('phaf-rx-total');
  if(tot)phI18nSet(tot,phI18nD('afloat.rx_total',{n:pv.lotTotal,after:_phqcAfterText(pv)}));
  const prob=document.getElementById('phaf-rx-problem');
  let dayProb=_phqcDayProblem(t,S.day);
  const txt=dayProb||(pv.empty?null:pv.problem);
  if(prob){if(txt){prob.textContent=String(txt);prob.className='phaf-rx-problem phaf-rx-problem-on';}else{prob.textContent=pv.empty?phI18nT('afloat.rx_enter',null,'en'):'';prob.className='phaf-rx-problem'+(pv.empty?' phaf-rx-problem-hint':'');}}
  const go=document.getElementById('phaf-rx-review');
  if(go){const no=!!(dayProb||pv.problem);if(no){go.setAttribute('aria-disabled','true');go.setAttribute('aria-describedby','phaf-rx-problem');}else{go.removeAttribute('aria-disabled');go.removeAttribute('aria-describedby');}}
}
// The day the units were delivered: a day, not in the future (PKT), not before the cut day. null = fine, else the sentence.
function _phqcDayProblem(t,day){
  const today=_phqcToday();
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||(typeof phIsDay==='function'&&!phIsDay(day)))return phI18nT('afloat.rx_day_bad',null,'en');
  if(today&&day>today)return phI18nT('afloat.rx_day_future',{day:day},'en');
  if(typeof t.po.cutDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.po.cutDate)&&day<t.po.cutDate)return phI18nT('afloat.rx_day_before_cut',{day:t.po.cutDate},'en');
  return null;
}
// Step 1 -> step 2: the numbers are checked (the same core check the writer runs) and shown once more before the save.
function phqcSheetReview(){
  const S=_phqcSheet;if(!S||_phqcBusy)return false;
  const t=_phqcFindTile(S.poId);if(!t||!phqcCanReceive(t,_phqcUser())){S.msg=phI18nD('afloat.rx_gone');_phqcPaint();return false;}
  const pv=phqcSheetPreview(t,S.vals);
  const dp=_phqcDayProblem(t,S.day);
  if(dp||pv.problem){S.msg=dp||pv.problem;_phqcFocusId='phaf-rx-msg';_phqcPaint();return false;}
  S.msg=null;S.step='review';_phqcFocusId='phaf-rx-save';_phqcPaint();
  return true;
}
// Step 2: the save (phQcAddLot). One at a time; offline is refused out loud; a stale revision reloads the latest copy and keeps the
// numbers on screen (nothing of this person's was saved, nothing of the other person's is lost).
async function phqcSheetSave(){
  const S=_phqcSheet;if(!S||S.step!=='review')return{ok:false,code:'no-sheet'};
  if(_phqcBusy||S.saving)return{ok:false,code:'busy'};
  const t=_phqcFindTile(S.poId);
  if(!t||!phqcCanReceive(t,_phqcUser())){S.step='edit';S.msg=phI18nD('afloat.rx_gone');_phqcPaint();return{ok:false,code:'gone'};}
  const pv=phqcSheetPreview(t,S.vals);
  if(pv.problem){S.step='edit';S.msg=pv.problem;_phqcPaint();return{ok:false,code:'refused'};}
  if(_phqcOffline()){S.msg=phI18nD('afloat.rx_offline');_phqcPaint();return{ok:false,code:'offline'};}
  if(typeof phQcAddLot!=='function'){S.msg=phI18nD('afloat.no_writer');_phqcPaint();return{ok:false,code:'no-writer'};}
  _phqcBusy=true;S.saving=true;_phqcPaint();
  let res;
  const rev=t.recon&&typeof t.recon.rev==='number'?t.recon.rev:0;
  try{res=await phQcAddLot(t.id,{sizes:pv.lot,day:S.day,note:S.note},{expectedRev:rev});}
  catch(e){res={ok:false,code:'failed',error:String(e&&e.message||e)};}
  _phqcBusy=false;
  if(_phqcSheet===S)S.saving=false;
  if(res&&res.ok){
    _phqcSheet=null;
    await _phqcRefreshPo(t.id);
    const nt=_phqcFindTile(t.id);
    const lotAt=res.lot&&typeof res.lot.at==='number'?res.lot.at:Date.now();
    _phqcFlash={poId:t.id,tone:'ok',text:phI18nD('afloat.ok_lot',{n:res.seq,when:phqcStampBy(lotAt,(res.lot&&res.lot.byName)||_phqcWho(_phqcUser())),pcs:res.total,po:t.id,after:_phqcNowText(nt)})};
    if(typeof showToast==='function'){try{showToast(String(phI18nT('afloat.ok_lot_toast',{n:res.seq,pcs:res.total,po:t.id},'en')));}catch(e){}}
    _phqcFocusId='phaf-flash';
    _phqcPaint();
    return res;
  }
  if(res&&res.code==='stale'){
    await _phqcReloadQc(t.id);
    if(_phqcSheet===S){S.step='edit';S.msg=phI18nD('afloat.rx_stale',{po:t.id});}
  }else if(_phqcSheet===S){
    if(res&&(res.code==='refused'||res.code==='invalid'))S.step='edit';
    S.msg=_phqcResMsg(res);
  }
  _phqcFocusId='phaf-rx-msg';
  _phqcPaint();
  return res||{ok:false,code:'failed'};
}
// What a PO now reads, after a write ("now exact: 120 of 120 — it can be closed", "still expected: XL 15 (15 pcs)").
function _phqcNowText(t){
  const r=t&&t.rec;
  if(!r||!r.ok||!r.verdict)return phI18nD('afloat.now_unknown');
  const tt=r.verdict.total;
  if(r.phase==='ready')return phI18nD('afloat.now_'+(r.verdict.state==='exact'?'exact':r.verdict.state==='over'?'over':'within'),{n:tt.recv,cut:tt.cut});
  if(r.phase==='receiving')return phI18nD('afloat.now_recv',{n:tt.recv,cut:tt.cut,list:_phqcStillList(r.verdict)});
  if(r.phase==='closed')return phI18nD('afloat.now_closed',{n:tt.recv,cut:tt.cut});
  return phI18nD('afloat.now_short',{n:tt.recv,cut:tt.cut});
}
function _phqcResMsg(res){
  if(!res)return phI18nD('afloat.err_unknown');
  if(res.code==='offline')return phI18nD('afloat.rx_offline');
  // Wave 2 (R3): a refusal is the writer's own sentence, VERBATIM -- it names the device clock (every QC write is refused when the
  // phone's date is more than two days off, and that reads exactly like "rules not published"). The short generic line only when
  // the writer gave none.
  if(res.code==='permission'){const w=_phqcStr(res.error);return w?phI18nD('afloat.err_permission_v',{why:w}):phI18nD('afloat.err_permission');}
  return _phqcStr(res.error)||phI18nD('afloat.err_unknown');
}
// One PO document, read fresh after a write (so the tile and its stage are current). NEVER rejects; a failed read keeps the old row.
async function _phqcRefreshPo(poId){
  try{
    if(typeof getDoc!=='function'||typeof doc!=='function')return false;
    const snap=await _phqcTimeout(getDoc(doc(db,'pos',poId)),PHAF_TIMEOUT_MS);
    if(!snap||(snap.metadata&&snap.metadata.fromCache===true)||!snap.exists())return false;
    const row=Object.assign({},snap.data(),{fbKey:poId});
    const rows=Array.isArray(_phqcPos.rows)?_phqcPos.rows.slice():[];
    const i=rows.findIndex(function(p){return p&&(p.fbKey===poId||p.id===poId);});
    if(i>-1)rows[i]=row;else rows.unshift(row);
    _phqcPos.rows=rows;
    return true;
  }catch(e){return false;}
}
// After a stale refusal: the reconciliations, the lots and that PO, read again.
async function _phqcReloadQc(poId){
  const ps=[_phqcRefreshPo(poId)];
  if(typeof phLoadStage==='function'){ps.push(phLoadStage('recon',{force:true}));ps.push(phLoadStage('lots',{force:true}));}
  try{await Promise.all(ps);}catch(e){}
}

/* ── the confirms: Lock cut now, Close PO, Void a lot ───────────────────────────────────────────────────────────────────── */
function phqcLockAsk(poId,opener){
  const t=_phqcFindTile(poId);
  if(!t||!phqcIsManager(_phqcUser())||!t.exp||t.exp.source!=='live'||t.recon||!t.reconOk)return false;
  _phqcDlg={kind:'lock',poId:t.id,reason:'',msg:null,opener:opener||'phaf-lock-btn'};_phqcFocusId='phaf-dlg-go';_phqcPaint();return true;
}
function phqcCloseAsk(poId,opener){
  const t=_phqcFindTile(poId);
  if(!t||!t.rec||!t.rec.ok||t.rec.phase!=='ready'||!_phqcOpenRecon(t.recon)||!(phqcIsManager(_phqcUser())||phqcIsQc(_phqcUser())))return false;
  _phqcDlg={kind:'close',poId:t.id,reason:'',msg:null,opener:opener||'phaf-close-btn'};_phqcFocusId='phaf-dlg-go';_phqcPaint();return true;
}
function phqcVoidAsk(poId,lotId,opener){
  const t=_phqcFindTile(poId);
  const x=t&&(t.lots||[]).filter(function(l){return _phqcStr(l.id)===lotId;})[0];
  if(!x||!phqcCanVoid(t,x,_phqcUser()))return false;
  _phqcDlg={kind:'void',poId:t.id,lotId:lotId,reason:'',msg:null,opener:opener||''};_phqcFocusId='phaf-dlg-reason';_phqcPaint();return true;
}
function phqcDlgClose(){
  const d=_phqcDlg;if(!d)return false;
  _phqcDlg=null;_phqcFocusId=d.opener||'';_phqcPaint();return true;
}
function _phqcDlgNode(t,ctx){
  const d=_phqcDlg;void ctx;
  if(PHAF_OV_KINDS.indexOf(d.kind)>-1)return _phqcOvDlgNode(t,d);
  const back=phEl('div','phaf-dlg-back');back.id='phaf-dlg-back';
  const box=phEl('div','phaf-dlg');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','phaf-dlg-title');
  const r=t.rec;
  let titleKey,goKey,lines=[];
  if(d.kind==='lock'){
    titleKey='afloat.dl_lock_t';goKey='afloat.dl_lock_go';
    const e=t.exp,list=e.order.map(function(k){return k+' '+e.sizes[k];}).join(', ');
    lines.push(phI18nD('afloat.dl_lock_q',{po:t.id,n:e.total,list:list}));
    lines.push(phI18nD('afloat.dl_lock_final'));
  }else if(d.kind==='close'){
    titleKey='afloat.dl_close_t';goKey='afloat.dl_close_go';
    const tt=r.verdict.total;
    lines.push(phI18nD('afloat.dl_close_q_'+(r.verdict.state==='exact'?'exact':r.verdict.state==='over'?'over':'within'),{po:t.id,n:tt.recv,cut:tt.cut}));
    if(r.verdict.state==='over'){
      const ov=r.verdict.order.filter(function(k){return r.verdict.sizes[k].diff>0;}).map(function(k){return'+'+r.verdict.sizes[k].diff+' '+k;}).join(', ');
      lines.push(phI18nD('afloat.dl_close_over',{list:ov}));
    }
    lines.push(phI18nD('afloat.dl_close_final'));
  }else{
    titleKey='afloat.dl_void_t';goKey='afloat.dl_void_go';
    const x=(t.lots||[]).filter(function(l){return _phqcStr(l.id)===d.lotId;})[0]||{};
    lines.push(phI18nD('afloat.dl_void_q',{n:x.seq,when:phqcStampBy(x.at,_phqcStr(x.byName)||_phqcWho(x.by)),pcs:_phqcLotTotal(x),list:_phqcLotSizesText(x)}));
    lines.push(phI18nD('afloat.dl_void_how'));
  }
  const h=phEl('h3','phaf-dlg-title',phI18nD(titleKey,{po:t.id}));h.id='phaf-dlg-title';box.appendChild(h);
  lines.forEach(function(l){box.appendChild(phEl('p','phaf-dlg-p',l));});
  let ta=null;
  const go=_phqcBtn('ph-btn ph-btn-primary phaf-dlg-go',phI18nD(_phqcBusy?'afloat.rx_saving':goKey),function(){phqcDlgGo();});go.id='phaf-dlg-go';
  const valid=function(){return d.kind!=='void'||_phqcStr(d.reason).trim().length>=(typeof PHQC_VOID_REASON_MIN==='number'?PHQC_VOID_REASON_MIN:3);};
  const paintGo=function(){if(!valid()||_phqcBusy){go.setAttribute('aria-disabled','true');}else go.removeAttribute('aria-disabled');};
  if(d.kind==='void'){
    const lab=phEl('label','phaf-field phaf-dlg-f');
    lab.appendChild(phEl('span','phaf-lab',phI18nD('afloat.dl_void_reason')));
    ta=phEl('textarea','phaf-dlg-reason');ta.id='phaf-dlg-reason';ta.setAttribute('maxlength','500');ta.setAttribute('rows','2');ta.value=d.reason||'';
    ta.addEventListener('input',function(){d.reason=ta.value;paintGo();});
    lab.appendChild(ta);box.appendChild(lab);
  }
  const msg=phEl('p','phaf-rx-msg');msg.id='phaf-dlg-msg';msg.setAttribute('role','alert');
  if(d.msg){phI18nSet(msg,d.msg);msg.classList.add('phaf-rx-msg-on');}
  box.appendChild(msg);
  paintGo();
  const acts=phEl('div','phaf-dlg-acts');
  acts.appendChild(go);
  const no=_phqcBtn('ph-btn phaf-dlg-no',phI18nD('afloat.dl_no'),function(){phqcDlgClose();});no.id='phaf-dlg-no';
  acts.appendChild(no);
  box.appendChild(acts);
  box.addEventListener('keydown',function(e){if(e&&e.key==='Escape'){if(e.preventDefault)e.preventDefault();phqcDlgClose();return;}_phqcTrap(box,e);});
  back.appendChild(box);
  back.addEventListener('click',function(e){if(e&&e.target===back)phqcDlgClose();});
  return back;
}
// The controls Tab can reach inside a dialog (real DOM: HTMLCollection; tests/ph-dom.js: an array -- both through slice).
function _phqcFocusables(root){
  const out=[];
  (function w(n){Array.prototype.slice.call((n&&n.children)||[]).forEach(function(c){
    if(!c||c.nodeType!==1)return;
    if(/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(String(c.tagName||''))&&!c.disabled&&c.getAttribute('disabled')===null)out.push(c);
    w(c);
  });})(root);
  return out;
}
// Focus trap (QC7, every confirm of this tab): Tab from the last control goes to the first, Shift+Tab from the first to the last.
function _phqcTrap(box,e){
  if(!e||e.key!=='Tab')return false;
  const f=_phqcFocusables(box);if(!f.length)return false;
  let a=null;try{a=document.activeElement;}catch(x){}
  const i=f.indexOf(a);
  let to=null;
  if(e.shiftKey){if(i<=0)to=f[f.length-1];}
  else if(i===-1||i===f.length-1)to=f[0];
  if(to){if(e.preventDefault)e.preventDefault();try{to.focus();}catch(x){}return true;}
  return false;
}
// The confirm's primary button. One write at a time; the writer's refusal is printed IN the dialog.
async function phqcDlgGo(){
  const d=_phqcDlg;if(!d)return{ok:false,code:'no-dialog'};
  if(PHAF_OV_KINDS.indexOf(d.kind)>-1)return phqcOvGo();
  if(_phqcBusy)return{ok:false,code:'busy'};
  const t=_phqcFindTile(d.poId);if(!t){d.msg=phI18nD('afloat.rx_gone');_phqcPaint();return{ok:false,code:'gone'};}
  if(d.kind==='void'&&_phqcStr(d.reason).trim().length<(typeof PHQC_VOID_REASON_MIN==='number'?PHQC_VOID_REASON_MIN:3)){d.msg=phI18nD('afloat.dl_void_short');_phqcPaint();return{ok:false,code:'invalid'};}
  if(_phqcOffline()){d.msg=phI18nD('afloat.rx_offline');_phqcPaint();return{ok:false,code:'offline'};}
  const fn=d.kind==='lock'?(typeof phQcLockCut==='function'?phQcLockCut:null):d.kind==='close'?(typeof phQcClose==='function'?phQcClose:null):(typeof phQcVoidLot==='function'?phQcVoidLot:null);
  if(!fn){d.msg=phI18nD('afloat.no_writer');_phqcPaint();return{ok:false,code:'no-writer'};}
  const rev=t.recon&&typeof t.recon.rev==='number'?t.recon.rev:0;
  _phqcBusy=true;_phqcPaint();
  let res;
  try{
    if(d.kind==='lock')res=await phQcLockCut(t.id,{expectedRev:0});
    else if(d.kind==='close')res=await phQcClose(t.id,{expectedRev:rev});
    else res=await phQcVoidLot(d.lotId,_phqcStr(d.reason).trim(),{expectedRev:rev});
  }catch(e){res={ok:false,code:'failed',error:String(e&&e.message||e)};}
  _phqcBusy=false;
  if(res&&res.ok){
    _phqcDlg=null;
    await _phqcRefreshPo(t.id);
    const me=_phqcWho(_phqcUser());
    let text;
    if(d.kind==='lock')text=phI18nD('afloat.ok_lock',{po:t.id,when:phqcStampBy(res.recon&&res.recon.cutLock?res.recon.cutLock.lockedAt:Date.now(),me)});
    else if(d.kind==='close')text=phI18nD('afloat.ok_close',{po:t.id,when:phqcStampBy(res.recon&&res.recon.closedAt?res.recon.closedAt:Date.now(),(res.recon&&res.recon.closedByName)||me)});
    else text=phI18nD('afloat.ok_void',{n:res.lot&&res.lot.seq!=null?res.lot.seq:'?',when:phqcStampBy(res.lot&&res.lot.voidedAt?res.lot.voidedAt:Date.now(),me),after:_phqcNowText(_phqcFindTile(t.id))});
    _phqcFlash={poId:t.id,tone:'ok',text:text};
    if(typeof showToast==='function'){try{showToast(String(text));}catch(e){}}
    _phqcFocusId='phaf-flash';
    _phqcPaint();
    return res;
  }
  if(res&&res.code==='stale'){
    await _phqcReloadQc(t.id);
    _phqcDlg=null;
    _phqcFlash={poId:t.id,tone:'warn',text:phI18nD('afloat.dl_stale',{po:t.id})};
    _phqcFocusId='phaf-flash';
  }else{
    if(_phqcDlg===d){d.msg=_phqcResMsg(res);_phqcFocusId='phaf-dlg-msg';}
  }
  _phqcPaint();
  return res||{ok:false,code:'failed'};
}

/* ── QC7: the manager overrides -- Close with a shortfall… / Replace the cut snapshot… / Reopen… / Adopt old receipts ───────────────
   The owner's rules: the cut is FINAL once locked and a saved entry is NEVER edited. An override does not edit anything either: each one
   is a NEW row the writer appends to the reconciliation's overrides list (kind, who, when, cause, reason; before / after for a relock),
   with a pos/{id}/history row, in ONE transaction (js/ph-qc-write.js phQcClose / phQcRelock / phQcReopen, js/ph-write.js
   phQcAdoptLegacy, each behind typeof). Who: Close with a shortfall and Adopt = a MANAGER (afnan, ammar, mustafa); Replace the cut
   snapshot and Reopen = an OWNER (afnan, ammar). Faizan never gets any of them (he reads the overrides list, no buttons).
   Every dialog has two steps -- 1: what is being accepted, in plain words, with the cause and reason boxes; 2: the final confirm with
   the cause and reason read back -- and nothing is written before the step-2 button. The revision the person confirmed is the one sent
   (a change underneath is refused as stale and the latest copy is read again). One write at a time (_phqcBusy); offline is refused out
   loud; Escape and "Not yet" close it; Tab stays inside it; focus goes back to the button that opened it.
   CODE OVER PLAN (and over the brief, said here so nobody re-derives it): phQcRelock takes NO typed sizes -- it replaces the snapshot with
   the cut recorded on the PO, only when the two differ, so "the new sizes" in this dialog are the PO's recorded cut, read-only; with
   none different there is no button (nothing to replace). The relock overrides row has no cause field, so the cause chosen here is written
   at the start of its reason ("Cause: Cutting miscount. …"). The close-short bell rows go to the OTHER managers (PHQC_BELL_MANAGERS
   minus the person closing), not only the owners. Reopen writes NO bell row and does not touch the pos document. ─────────────────── */
const PHAF_OV_KINDS=Object.freeze(['short','relock','reopen','adopt']);
const PHAF_CAUSES_FALLBACK=Object.freeze(['cutting_miscount','lost_in_line','damaged_before_qc','other']);
const PHAF_BELL_FALLBACK=Object.freeze(['afnan','ammar','mustafa']);
function phqcIsOwner(u){return typeof phIsOwner==='function'&&phIsOwner(_phqcUser(u))===true;}
function _phqcCauses(){return typeof PHQC_CLOSE_CAUSES!=='undefined'&&Array.isArray(PHQC_CLOSE_CAUSES)?PHQC_CLOSE_CAUSES:PHAF_CAUSES_FALLBACK;}
function _phqcReasonMin(){return typeof PHQC_REASON_MIN==='number'?PHQC_REASON_MIN:5;}
function _phqcOvMax(){return typeof PHQC_OVERRIDES_MAX==='number'?PHQC_OVERRIDES_MAX:20;}
function _phqcOvRoom(rc){return(rc&&Array.isArray(rc.overrides)?rc.overrides.length:0)<_phqcOvMax();}
function _phqcCauseText(c){return _phqcCauses().indexOf(c)>-1?phI18nD('afloat.cause_'+c):phI18nD('afloat.cause_unknown',{c:_phqcStr(c)||'—'});}
// "S 20 · M 38 · L 40 · XL 20"
function _phqcCutList(sizes,order){
  const sz=sizes&&typeof sizes==='object'?sizes:{};
  const keys=Array.isArray(order)?order:(typeof phQcSizeOrder==='function'?phQcSizeOrder(null,Object.keys(sz)):Object.keys(sz));
  return keys.map(function(k){return k+' '+(_phqcHas(sz,k)?sz[k]:0);}).join(' · ');
}
// The managers a decision's bell rows go to (js/ph-qc-write.js phQcBellRows: every OTHER manager), as names.
function _phqcToldNames(u){
  const l=typeof PHQC_BELL_MANAGERS!=='undefined'&&Array.isArray(PHQC_BELL_MANAGERS)?PHQC_BELL_MANAGERS:PHAF_BELL_FALLBACK;
  return l.filter(function(x){return x!==u;}).map(_phqcWho).join(', ');
}
// The close_short overrides row of the CURRENT close (the writer stamps both with the same moment), or null.
function _phqcCloseOverrideOf(rc){
  if(!rc||rc.status!=='closed'||!Array.isArray(rc.overrides))return null;
  const l=rc.overrides.filter(function(o){return o&&o.kind==='close_short';}).slice(-1)[0];
  return l&&typeof l.at==='number'&&l.at===rc.closedAt?l:null;
}
// The PO's recorded cut (pos.cutQty once cutting is done) read as the core reads it, ignoring the lock; null when unreadable.
function _phqcLiveCutOf(t){
  try{const e=phQcExpected(Object.assign({},t.po),null,{model:_phqcModelOf(t.po)});return e&&e.ok&&e.source==='live'?e:null;}catch(x){return null;}
}
// Who may do what (each also checked again by the writer and by firestore.rules).
function phqcCanCloseShort(t,u){
  return phqcIsManager(u)&&!!t&&t.reconOk&&t.lotsOk&&!!t.rec&&t.rec.ok&&(t.rec.phase==='receiving'||t.rec.phase==='short')&&_phqcOpenRecon(t.recon)&&_phqcStageOkForClose(t.stage)&&_phqcOvRoom(t.recon);
}
function phqcCanRelock(t,u){
  return phqcIsOwner(u)&&!!t&&t.reconOk&&t.lotsOk&&!!t.rec&&t.rec.ok&&_phqcOpenRecon(t.recon)&&!!t.exp&&t.exp.ok&&t.exp.source==='lock'&&!!t.exp.drift&&!!_phqcLiveCutOf(t)&&_phqcOvRoom(t.recon);
}
function phqcCanReopen(t,u){return phqcIsOwner(u)&&!!t&&t.reconOk&&!!t.recon&&t.recon.status==='closed'&&_phqcOvRoom(t.recon);}
function phqcCanAdopt(t,u){
  if(!phqcIsManager(u)||!t||!t.reconOk||!t.lotsOk||!t.rec||!t.rec.ok)return false;
  if(t.recon&&!_phqcOpenRecon(t.recon))return false;
  if(!t.recon&&!(t.exp&&t.exp.ok&&t.exp.source==='live'))return false;
  return phqcLegacyPlan(t.po,t.recon).ids.length>0;
}
// The phase a verdict gives (the core's rule, phQcReconcile): nothing live = awaiting QC; total short = still receiving; exact / within /
// over = ready; anything else = short.
function _phqcPhaseOf(v,lotsLive){
  if(!v||!v.ok)return null;
  if(!lotsLive)return'awaiting_qc';
  if(v.total.state==='short')return'receiving';
  return(v.state==='exact'||v.state==='within'||v.state==='over')?'ready':'short';
}
// "is now exact: 118 of 118. It can be closed." / "has 0 of 120 received yet." for a {verdict, phase}
function _phqcPhaseText(v,phase){
  if(!v||!v.ok)return phI18nD('afloat.now_unknown');
  if(phase==='awaiting_qc')return phI18nD('afloat.now_awaiting',{cut:v.total.cut});
  return _phqcNowText({rec:{ok:true,verdict:v,phase:phase}});
}
// The per-size difference a close with a shortfall accepts, in plain words (one line per size that is not exact, then the exact ones).
function phqcGapLines(v){
  const out=[],exact=[];
  if(!v||!Array.isArray(v.order))return out;
  v.order.forEach(function(k){
    const s=v.sizes[k];
    if(s.state==='exact'){exact.push(k);return;}
    const key=s.state==='short'?'afloat.gap_short':s.state==='within'?'afloat.gap_within':s.state==='over'?'afloat.gap_over':s.state==='over_refused'?'afloat.gap_over_refused':'afloat.gap_unexpected';
    out.push(phI18nD(key,{size:k,n:Math.abs(s.diff),recv:s.recv,cut:s.cut,a:s.allow}));
  });
  if(exact.length)out.push(phI18nD('afloat.gap_exact',{list:exact.join(', ')}));
  return out;
}
function phqcGapTotal(v){
  const t=v&&v.total;if(!t)return phI18nD('afloat.now_unknown');
  return phI18nD(t.diff<0?'afloat.gap_total_short':t.diff>0?'afloat.gap_total_over':'afloat.gap_total_even',{n:Math.abs(t.diff),recv:t.recv,cut:t.cut,a:t.allow});
}
// The relock preview: the locked cut beside the PO's recorded cut, per size, and the verdict before and after (pure over the tile;
// recomputed with phQcVerdict on the lots that are ALREADY received -- they are not changed). null when it cannot be judged.
function phqcRelockPreview(t){
  const live=_phqcLiveCutOf(t);
  if(!live||!t.rec||!t.rec.ok||!t.exp||!t.exp.ok||t.exp.source!=='lock')return null;
  const model=_phqcModelOf(t.po),lock=t.exp,recv=t.rec.recv?t.rec.recv.sizes:{};
  const keys=typeof phQcSizeOrder==='function'?phQcSizeOrder(model,Object.keys(lock.sizes).concat(Object.keys(live.sizes))):Object.keys(live.sizes);
  const rows=keys.map(function(k){return{size:k,lock:_phqcHas(lock.sizes,k)?lock.sizes[k]:0,live:_phqcHas(live.sizes,k)?live.sizes[k]:0};});
  const after=typeof phQcVerdict==='function'?phQcVerdict(live.sizes,recv,{model:model}):null;
  return{live:live,rows:rows,lockTotal:lock.total,liveTotal:live.total,
    before:{verdict:t.rec.verdict,phase:t.rec.phase},after:{verdict:after,phase:_phqcPhaseOf(after,t.rec.lotsLive)},
    lots:t.rec.lotsLive,pcs:t.rec.recv?t.rec.recv.total:0};
}
// The adoption preview: what would become one lot, the refusal the writer would give (null = it may), whether it locks the cut.
function phqcAdoptPreview(t){
  const plan=phqcLegacyPlan(t.po,t.recon),model=_phqcModelOf(t.po);
  const cut=t.rec&&t.rec.ok&&t.rec.cut?t.rec.cut.sizes:null,recv=t.rec&&t.rec.recv?t.rec.recv.sizes:{};
  const problem=!cut?phI18nT('afloat.rx_gone',null,'en'):(typeof phQcLotProblem==='function'?phQcLotProblem(cut,recv,plan.sizes,{model:model}):'the QC core is not loaded');
  const after={};
  if(cut){Object.keys(cut).forEach(function(k){after[k]=(_phqcHas(recv,k)?recv[k]:0);});Object.keys(recv).forEach(function(k){after[k]=recv[k];});
    Object.keys(plan.sizes).forEach(function(k){after[k]=(_phqcHas(after,k)?after[k]:0)+plan.sizes[k];});}
  const v=cut&&typeof phQcVerdict==='function'?phQcVerdict(cut,after,{model:model}):null;
  return{plan:plan,problem:problem,seq:(t.recon&&typeof t.recon.lotCount==='number'?t.recon.lotCount:0)+1,lockNow:!t.recon,
    cutList:cut?_phqcCutList(cut,t.rec.cut.order):'',after:{verdict:v,phase:_phqcPhaseOf(v,1)}};
}
function _phqcOvAllowed(t,kind,u){
  if(kind==='short')return phqcCanCloseShort(t,u);
  if(kind==='relock')return phqcCanRelock(t,u);
  if(kind==='reopen')return phqcCanReopen(t,u);
  if(kind==='adopt')return phqcCanAdopt(t,u);
  return false;
}
function _phqcOvOpen(kind,t,opener,first){
  _phqcDlg={kind:kind,poId:t.id,reason:'',cause:'',step:'form',msg:null,opener:opener||'',rev:null};
  _phqcFlash=null;_phqcSheet=null;_phqcFocusId=first;_phqcPaint();return true;
}
function phqcShortAsk(poId,opener){const t=_phqcFindTile(poId);if(!t||!phqcCanCloseShort(t,_phqcUser()))return false;return _phqcOvOpen('short',t,opener||'phaf-close-btn','phaf-dlg-cause');}
function phqcRelockAsk(poId,opener){const t=_phqcFindTile(poId);if(!t||!phqcCanRelock(t,_phqcUser()))return false;return _phqcOvOpen('relock',t,opener||'phaf-relock-btn','phaf-dlg-cause');}
function phqcReopenAsk(poId,opener){const t=_phqcFindTile(poId);if(!t||!phqcCanReopen(t,_phqcUser()))return false;return _phqcOvOpen('reopen',t,opener||'phaf-reopen-btn','phaf-dlg-reason');}
function phqcAdoptAsk(poId,opener){const t=_phqcFindTile(poId);if(!t||!phqcCanAdopt(t,_phqcUser()))return false;return _phqcOvOpen('adopt',t,opener||'phaf-adopt-btn','phaf-dlg-reason');}
// Why the step-1 button may not go on (null = it may): a cause from the list (close-short, relock), a reason of PHQC_REASON_MIN+
// characters (every override), and for an adoption the writer's own refusal.
function _phqcOvProblem(t,d){
  if((d.kind==='short'||d.kind==='relock')&&_phqcCauses().indexOf(d.cause)<0)return phI18nD('afloat.ov_cause_missing');
  if(_phqcStr(d.reason).trim().length<_phqcReasonMin())return phI18nD('afloat.ov_reason_short',{n:_phqcReasonMin()});
  if(d.kind==='adopt'){const p=phqcAdoptPreview(t);if(p.problem)return p.problem;}
  return null;
}
function _phqcOvTable(heads,rows,cls){
  const tb=document.createElement('table');tb.className='phaf-table phaf-ov-table'+(cls?' '+cls:'');
  const th0=document.createElement('thead'),tr0=document.createElement('tr');
  heads.forEach(function(h){const th=document.createElement('th');th.setAttribute('scope','col');phI18nSet(th,h);tr0.appendChild(th);});
  th0.appendChild(tr0);tb.appendChild(th0);
  const tbody=document.createElement('tbody');
  rows.forEach(function(r){const tr=document.createElement('tr');if(r.cls)tr.className=r.cls;r.cells.forEach(function(v,i){const td=document.createElement('td');td.className=i?'phaf-n':'phaf-k';phI18nSet(td,v);tr.appendChild(td);});tbody.appendChild(tr);});
  tb.appendChild(tbody);
  const w=phEl('div','phaf-tablewrap');w.appendChild(tb);return w;
}
// The override dialog (both steps). Every stored or typed string reaches the page through textContent.
function _phqcOvDlgNode(t,d){
  const me=_phqcUser(),told=_phqcToldNames(me);
  const back=phEl('div','phaf-dlg-back');back.id='phaf-dlg-back';
  const box=phEl('div','phaf-dlg phaf-dlg-ov phaf-dlg-'+d.kind);box.id='phaf-dlg';
  box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','phaf-dlg-title');box.setAttribute('aria-describedby','phaf-dlg-lead');
  const titleKey={short:'afloat.ov_short_t',relock:'afloat.ov_relock_t',reopen:'afloat.ov_reopen_t',adopt:'afloat.ov_adopt_t'}[d.kind];
  const h=phEl('h3','phaf-dlg-title',phI18nD(titleKey,{po:t.id}));h.id='phaf-dlg-title';box.appendChild(h);
  box.appendChild(phEl('p','phaf-dlg-step',phI18nD(d.step==='confirm'?'afloat.ov_step_two':(d.kind==='short'||d.kind==='relock')?'afloat.ov_step_one':'afloat.ov_step_one_reason')));
  const P=function(x,cls,id){const p=phEl('p','phaf-dlg-p'+(cls?' '+cls:''),x);if(id)p.id=id;box.appendChild(p);return p;};
  let blocked=null;
  const r=t.rec;
  if(d.kind==='short'){
    const v=r.verdict,tt=v.total;
    P(phI18nD(r.phase==='receiving'?'afloat.ov_short_lead_recv':'afloat.ov_short_lead',{po:t.id,recv:tt.recv,cut:tt.cut}),null,'phaf-dlg-lead');
    const ul=phEl('ul','phaf-ov-gaps');ul.id='phaf-ov-gaps';
    phqcGapLines(v).forEach(function(x){ul.appendChild(phEl('li','phaf-ov-gap',x));});
    ul.appendChild(phEl('li','phaf-ov-gap phaf-ov-gapt',phqcGapTotal(v)));
    box.appendChild(ul);
    P(phI18nD('afloat.ov_short_effect',{told:told||'—'}),'phaf-dlg-effect');
  }else if(d.kind==='relock'){
    const pv=phqcRelockPreview(t);
    P(phI18nD('afloat.ov_relock_lead',{po:t.id}),null,'phaf-dlg-lead');
    if(!pv)blocked=phI18nD('afloat.now_unknown');
    else{
      const rows=pv.rows.map(function(x){const d2=x.live-x.lock;return{cls:d2?'phaf-ov-chg':'',cells:[x.size,String(x.lock),String(x.live),d2===0?'—':(d2>0?'+'+d2:'−'+(-d2))]};});
      const dt=pv.liveTotal-pv.lockTotal;
      rows.push({cls:'phaf-total',cells:[phI18nT('afloat.t_total',null,'en'),String(pv.lockTotal),String(pv.liveTotal),dt===0?'—':(dt>0?'+'+dt:'−'+(-dt))]});
      box.appendChild(_phqcOvTable([phI18nD('afloat.t_size'),phI18nD('afloat.ov_c_locked'),phI18nD('afloat.ov_c_recorded'),phI18nD('afloat.ov_c_change')],rows,'phaf-ov-relock'));
      P(phI18nD('afloat.ov_relock_before',{po:t.id,txt:_phqcPhaseText(pv.before.verdict,pv.before.phase)}),'phaf-ov-before','phaf-ov-before');
      P(phI18nD('afloat.ov_relock_after',{po:t.id,txt:_phqcPhaseText(pv.after.verdict,pv.after.phase)}),'phaf-ov-after','phaf-ov-after');
      P(phI18nD('afloat.ov_relock_lots',{n:pv.lots,pcs:pv.pcs}),'phaf-ov-warn');
      P(phI18nD('afloat.ov_relock_how'),'phaf-dlg-note');
      P(phI18nD('afloat.ov_relock_effect',{told:told||'—'}),'phaf-dlg-effect');
    }
  }else if(d.kind==='reopen'){
    const rc=t.recon,cv=rc.closeVerdict&&typeof rc.closeVerdict==='object'?rc.closeVerdict:null;
    P(phI18nD('afloat.ov_reopen_lead',{po:t.id,when:phqcStamp(rc.closedAt)||'—',who:_phqcStr(rc.closedByName)||_phqcWho(rc.closedBy)||'—',
      recv:cv&&cv.total?cv.total.recv:'—',cut:cv&&cv.total?cv.total.cut:'—'}),null,'phaf-dlg-lead');
    P(phI18nD('afloat.ov_reopen_writes'),'phaf-dlg-effect');
    P(phI18nD('afloat.ov_reopen_pos'),'phaf-ov-warn','phaf-ov-reopen-pos');
    P(phI18nD('afloat.ov_reopen_again'),'phaf-dlg-note');
  }else{
    const pv=phqcAdoptPreview(t);
    P(phI18nD('afloat.ov_adopt_lead',{po:t.id,n:pv.plan.total,seq:pv.seq}),null,'phaf-dlg-lead');
    const order=typeof phQcSizeOrder==='function'?phQcSizeOrder(_phqcModelOf(t.po),Object.keys(pv.plan.sizes)):Object.keys(pv.plan.sizes);
    box.appendChild(_phqcOvTable([phI18nD('afloat.t_size'),phI18nD('afloat.ov_c_adopt')],order.map(function(k){return{cells:[k,String(pv.plan.sizes[k])]};}).concat([{cls:'phaf-total',cells:[phI18nT('afloat.t_total',null,'en'),String(pv.plan.total)]}]),'phaf-ov-adopt'));
    P(phI18nD('afloat.ov_adopt_receipts',{k:pv.plan.ids.length}),'phaf-dlg-note');
    if(pv.lockNow)P(phI18nD('afloat.ov_adopt_lock',{po:t.id,list:pv.cutList}),'phaf-ov-warn');
    if(pv.problem)blocked=pv.problem;
    else P(phI18nD('afloat.ov_adopt_after',{po:t.id,txt:_phqcPhaseText(pv.after.verdict,pv.after.phase)}),'phaf-ov-after','phaf-ov-after');
    P(phI18nD('afloat.ov_adopt_final'),'phaf-ov-warn phaf-ov-final');
  }
  if(blocked){const b=phEl('p','phaf-rx-problem phaf-rx-problem-on phaf-ov-blocked');b.id='phaf-ov-blocked';b.setAttribute('role','status');phI18nSet(b,blocked);box.appendChild(b);}
  const needsCause=d.kind==='short'||d.kind==='relock';
  const go=_phqcBtn('ph-btn ph-btn-primary phaf-dlg-go',phI18nD(_phqcBusy?'afloat.rx_saving':d.step==='confirm'?{short:'afloat.ov_short_go',relock:'afloat.ov_relock_go',reopen:'afloat.ov_reopen_go',adopt:'afloat.ov_adopt_go'}[d.kind]:'afloat.ov_continue',{po:t.id}),function(){phqcDlgGo();});go.id='phaf-dlg-go';
  const valid=function(){return!blocked&&!_phqcOvProblem(t,d);};
  const paintGo=function(){if(!valid()||_phqcBusy){go.setAttribute('aria-disabled','true');}else go.removeAttribute('aria-disabled');if(_phqcBusy)go.setAttribute('aria-busy','true');};
  if(d.step!=='confirm'){
    if(needsCause){
      const lab=phEl('label','phaf-field phaf-dlg-f');
      lab.appendChild(phEl('span','phaf-lab',phI18nD('afloat.ov_cause')));
      const sel=phEl('select','phaf-sel phaf-dlg-cause');sel.id='phaf-dlg-cause';
      [''].concat(_phqcCauses()).forEach(function(c){const op=document.createElement('option');op.value=c;op.textContent=phI18nAttr(c?_phqcCauseText(c):phI18nD('afloat.ov_cause_pick'));if(c===d.cause)op.setAttribute('selected','selected');sel.appendChild(op);});
      sel.value=d.cause||'';
      sel.addEventListener('change',function(){d.cause=sel.value;paintGo();});
      lab.appendChild(sel);box.appendChild(lab);
    }
    const lab=phEl('label','phaf-field phaf-dlg-f');
    lab.appendChild(phEl('span','phaf-lab',phI18nD('afloat.ov_reason',{n:_phqcReasonMin()})));
    const ta=phEl('textarea','phaf-dlg-reason');ta.id='phaf-dlg-reason';ta.setAttribute('maxlength','500');ta.setAttribute('rows','3');ta.value=d.reason||'';
    ta.addEventListener('input',function(){d.reason=ta.value;paintGo();});
    lab.appendChild(ta);box.appendChild(lab);
  }else{
    const sum=phEl('div','phaf-ov-sum');sum.id='phaf-ov-sum';
    if(needsCause)sum.appendChild(phEl('p','phaf-dlg-p',phI18nD('afloat.ov_sum_cause',{cause:_phqcCauseText(d.cause)})));
    const rs=phEl('p','phaf-dlg-p phaf-ov-sum-r');rs.textContent='“'+_phqcStr(d.reason).trim()+'”';sum.appendChild(rs);
    sum.appendChild(phEl('p','phaf-dlg-p phaf-noedit',phI18nD('afloat.ov_sum_final')));
    box.appendChild(sum);
  }
  const msg=phEl('p','phaf-rx-msg');msg.id='phaf-dlg-msg';msg.setAttribute('role','alert');msg.setAttribute('tabindex','-1');
  if(d.msg){phI18nSet(msg,d.msg);msg.classList.add('phaf-rx-msg-on');}
  box.appendChild(msg);
  paintGo();
  const acts=phEl('div','phaf-dlg-acts');
  acts.appendChild(go);
  const no=_phqcBtn('ph-btn phaf-dlg-no',phI18nD(d.step==='confirm'?'afloat.ov_back':'afloat.dl_no'),function(){
    if(d.step==='confirm'){if(_phqcBusy)return;d.step='form';d.msg=null;_phqcFocusId=needsCause?'phaf-dlg-cause':'phaf-dlg-reason';_phqcPaint();}
    else phqcDlgClose();
  });no.id='phaf-dlg-no';
  acts.appendChild(no);
  box.appendChild(acts);
  box.addEventListener('keydown',function(e){if(e&&e.key==='Escape'){if(e.preventDefault)e.preventDefault();phqcDlgClose();return;}_phqcTrap(box,e);});
  back.appendChild(box);
  back.addEventListener('click',function(e){if(e&&e.target===back)phqcDlgClose();});
  return back;
}
// The override dialog's primary button: step 1 -> step 2 (nothing written); step 2 -> the writer. One write at a time.
async function phqcOvGo(){
  const d=_phqcDlg;if(!d||PHAF_OV_KINDS.indexOf(d.kind)<0)return{ok:false,code:'no-dialog'};
  if(_phqcBusy)return{ok:false,code:'busy'};
  const me=_phqcUser();
  const t=_phqcFindTile(d.poId);
  if(!t||!_phqcOvAllowed(t,d.kind,me)){d.msg=phI18nD('afloat.ov_gone');_phqcFocusId='phaf-dlg-msg';_phqcPaint();return{ok:false,code:'gone'};}
  const pr=_phqcOvProblem(t,d);
  if(pr){d.step='form';d.msg=pr;_phqcFocusId='phaf-dlg-msg';_phqcPaint();return{ok:false,code:'invalid'};}
  if(d.step!=='confirm'){
    d.step='confirm';d.msg=null;d.rev=t.recon&&typeof t.recon.rev==='number'?t.recon.rev:0;_phqcFocusId='phaf-dlg-go';_phqcPaint();
    return{ok:false,code:'confirm'};
  }
  if(_phqcOffline()){d.msg=phI18nD('afloat.ov_offline');_phqcFocusId='phaf-dlg-msg';_phqcPaint();return{ok:false,code:'offline'};}
  const fn=d.kind==='short'?(typeof phQcClose==='function'?phQcClose:null):d.kind==='relock'?(typeof phQcRelock==='function'?phQcRelock:null):
    d.kind==='reopen'?(typeof phQcReopen==='function'?phQcReopen:null):(typeof phQcAdoptLegacy==='function'?phQcAdoptLegacy:null);
  if(!fn){d.msg=phI18nD('afloat.no_writer');_phqcFocusId='phaf-dlg-msg';_phqcPaint();return{ok:false,code:'no-writer'};}
  const why=_phqcStr(d.reason).trim(),rev=typeof d.rev==='number'?d.rev:0;
  const before=d.kind==='relock'?phqcRelockPreview(t):d.kind==='adopt'?phqcAdoptPreview(t):null;
  _phqcBusy=true;_phqcPaint();
  let res;
  try{
    if(d.kind==='short')res=await phQcClose(t.id,{expectedRev:rev,reason:why,cause:d.cause});
    else if(d.kind==='relock')res=await phQcRelock(t.id,{expectedRev:rev,reason:phI18nT('afloat.ov_relock_reason',{cause:phI18nT('afloat.cause_'+d.cause,null,'en'),why:why},'en')});
    else if(d.kind==='reopen')res=await phQcReopen(t.id,{expectedRev:rev,reason:why});
    else res=await phQcAdoptLegacy(t.id,{expectedRev:rev,reason:why});
  }catch(e){res={ok:false,code:'failed',error:String(e&&e.message||e)};}
  _phqcBusy=false;
  if(res&&res.ok){
    _phqcDlg=null;
    await _phqcRefreshPo(t.id);
    const nt=_phqcFindTile(t.id);
    let text;
    if(d.kind==='short'){
      const at=res.recon&&res.recon.closedAt?res.recon.closedAt:Date.now();
      text=phI18nD('afloat.ok_short',{po:t.id,when:phqcStampBy(at,(res.recon&&res.recon.closedByName)||_phqcWho(me)),gap:phqcGapTotal(res.verdict&&res.verdict.total?{total:res.verdict.total}:t.rec.verdict),
        told:(Array.isArray(res.told)?res.told.map(_phqcWho).join(', '):'')||'—'});
    }else if(d.kind==='relock'){
      const L=res.recon&&res.recon.cutLock;
      text=phI18nD('afloat.ok_relock',{po:t.id,when:phqcStampBy(L&&L.lockedAt?L.lockedAt:Date.now(),_phqcWho(me)),list:L?_phqcCutList(L.sizes):(before?_phqcCutList(before.live.sizes,before.live.order):'—'),n:L?L.total:'—',after:_phqcNowText(nt),
        told:(Array.isArray(res.told)?res.told.map(_phqcWho).join(', '):'')||'—'});
    }else if(d.kind==='reopen'){
      text=phI18nD('afloat.ok_reopen',{po:t.id,when:phqcStampBy(res.recon&&res.recon.updatedAt?res.recon.updatedAt:Date.now(),_phqcWho(me))});
    }else{
      text=phI18nD('afloat.ok_adopt',{po:t.id,n:res.lot&&typeof res.lot.total==='number'?res.lot.total:(before?before.plan.total:'?'),seq:res.seq,when:phqcStampBy(res.lot&&res.lot.at?res.lot.at:Date.now(),_phqcWho(me)),after:_phqcNowText(nt)});
    }
    _phqcFlash={poId:t.id,tone:'ok',text:text};
    if(typeof showToast==='function'){try{showToast(String(text));}catch(e){}}
    _phqcFocusId='phaf-flash';
    _phqcPaint();
    return res;
  }
  if(res&&res.code==='stale'){
    await _phqcReloadQc(t.id);
    _phqcDlg=null;
    _phqcFlash={poId:t.id,tone:'warn',text:phI18nD('afloat.dl_stale',{po:t.id})};
    _phqcFocusId='phaf-flash';
  }else if(_phqcDlg===d){d.msg=_phqcResMsg(res);_phqcFocusId='phaf-dlg-msg';}
  _phqcPaint();
  return res||{ok:false,code:'failed'};
}
// The overrides recorded on a reconciliation, read-only, oldest first: kind, when (12-hour PKT) and who, the cause, the reason, and for a
// relock the cut before -> after. Shown to everyone who sees the detail; it holds no control.
function _phqcOverridesNode(t){
  const l=t.recon&&Array.isArray(t.recon.overrides)?t.recon.overrides.filter(function(o){return o&&typeof o==='object';}):[];
  if(!l.length)return null;
  const sec=phEl('section','phaf-ovs');sec.id='phaf-ovs';
  sec.appendChild(phEl('h3','ph-card-title',phI18nD('afloat.ov_list_t',{n:l.length})));
  sec.appendChild(phEl('p','ph-note phaf-ovs-what',phI18nD('afloat.ov_list_what')));
  const ul=phEl('ul','phaf-ovlist');
  l.slice().sort(function(a,b){return(typeof a.at==='number'?a.at:0)-(typeof b.at==='number'?b.at:0);}).forEach(function(o){
    const kind=o.kind==='close_short'||o.kind==='relock'||o.kind==='reopen'?o.kind:'other';
    const li=phEl('li','phaf-ov phaf-ov-'+kind);li.setAttribute('data-kind',kind);
    const hd=phEl('span','phaf-ov-h phaf-stamp');
    phI18nSet(hd,phI18nD('afloat.ov_row_'+kind,{when:phqcStampBy(o.at,_phqcStr(o.byName)||_phqcWho(o.by))}));
    li.appendChild(hd);
    if(o.cause)li.appendChild(phEl('span','phaf-ov-c',phI18nD('afloat.ov_row_cause',{cause:_phqcCauseText(o.cause)})));
    if(o.before&&typeof o.before==='object'&&o.after&&typeof o.after==='object')li.appendChild(phEl('span','phaf-ov-cut',phI18nD('afloat.ov_row_cut',{from:_phqcCutList(o.before),to:_phqcCutList(o.after)})));
    if(o.reason){const rr=phEl('span','phaf-ov-r');rr.textContent='“'+_phqcStr(o.reason)+'”';li.appendChild(rr);}
    ul.appendChild(li);
  });
  sec.appendChild(ul);
  return sec;
}

/* ── the classic Final QC button and the old Packing ▸ Receiving tab (the two side-edits call these) ─────────────────────── */
// js/pos.js window.completeQC asks this first: a sentence (refuse) or null (go on). It refuses while the PO has a QC reconciliation
// that is NOT closed -- read FRESH from po_qc_recon/{id}. A PO with no reconciliation (older POs) goes on as before. FAIL OPEN on purpose
// for a REFUSED read: po_qc_recon is readable by every signed-in person once firestore.rules is published, so a permission refusal means
// the rules are not published and no reconciliation can have been written. Any other failed read (no connection, a timeout) refuses
// with "could not check" -- a refusal can be retried, a Final QC completed past an open reconciliation cannot be undone from here.
// Wave 2: the fail-open is LOUD. A refused read is remembered per PO (phqcCloseSkippedWarn gives the warning completeQC shows in its
// toast and its confirm), and an Activity row "QC check skipped" names po_qc_recon, so a rules regression is seen the first time.
let _phqcCqcSkipped={};
function phqcCloseSkippedWarn(po){
  const key=_phqcKeyOf(_phqcIdOf(po));
  return key&&_phqcCqcSkipped[key]?String(phI18nT('afloat.cqc_skipped',{po:key},'en')):'';
}
async function phqcCloseBlock(po){
  const id=_phqcIdOf(po),key=_phqcKeyOf(id);
  if(!key)return null;
  delete _phqcCqcSkipped[key];
  let rc=null;
  try{
    const snap=await _phqcTimeout(getDoc(doc(db,'po_qc_recon',key)),PHAF_TIMEOUT_MS);
    if(snap&&snap.exists())rc=snap.data()||null;
    else if(snap&&snap.metadata&&snap.metadata.fromCache===true){
      const mem=typeof phQcReconOf==='function'?phQcReconOf(key):null;
      if(mem)rc=mem;
    }
  }catch(e){
    const i=_phqcErr(e);
    if(i.permission){
      _phqcCqcSkipped[key]=true;
      try{if(typeof logActivity==='function')Promise.resolve(logActivity('QC check skipped',key+' · Final QC pre-check: po_qc_recon could not be read (permission refused by the published firestore.rules) — completed without the QC reconciliation check; republish firestore.rules')).catch(function(){});}catch(e2){}
      return null;
    }
    const mem=typeof phQcReconOf==='function'?phQcReconOf(key):null;
    if(mem&&mem.status==='closed')return null;
    return String(phI18nT('afloat.cqc_unknown',{po:key},'en'));
  }
  if(!rc||rc.status==='closed')return null;
  return String(phI18nT('afloat.cqc_open',{po:key},'en'));
}
function _phqcEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
// js/production.js (Packing ▸ Receiving) asks this first: for QC Ops (Faizan) the list is a pointer to the new screen; '' for everyone else
// (the managers keep the old page). Static strings only, escaped.
function phqcPackPointerHTML(){
  if(!phqcIsQc())return'';
  const t=function(k){return _phqcEsc(phI18nT(k,null,'en'));};
  return'<div class="phaf-pack-ptr" role="note"><div class="phaf-pack-ptr-t">'+t('afloat.pack_title')+'</div><p class="phaf-pack-ptr-p">'+t('afloat.pack_body')+'</p>'+
    '<button type="button" class="ph-btn ph-btn-primary phaf-pack-ptr-b" onclick="window.showPage(\'prod-ops\')">'+t('afloat.pack_btn')+'</button></div>';
}

/* ── the lightbox (tap the detail's picture): front and back, contain-fit ── */
function phqcLightbox(t,opener){
  phqcLightboxClose();
  const im=phqcImage(t.po);
  if(!im.src)return false;
  const views=[];
  const big=function(u){const s=phqcImgSafe(u);if(!s)return'';if(/^https:\/\/res\.cloudinary\.com\//.test(s)&&typeof _boardsDisplayUrl==='function'){try{const d=_boardsDisplayUrl(s,1200);if(phqcImgSafe(d))return d;}catch(e){}}return s;};
  const f=big(t.po.imgFront),b=big(t.po.imgBack);
  if(f)views.push({src:f,key:'afloat.pic_front'});
  if(b)views.push({src:b,key:'afloat.pic_back'});
  if(!views.length&&im.catalog)views.push({src:big(t.po.code&&phQcShopImageOf?phQcShopImageOf(t.po.code):im.catalog)||im.catalog,key:'afloat.pic_catalog'});
  if(!views.length)return false;
  const ov=phEl('div','phaf-lightbox');ov.id='phaf-lightbox';ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');
  ov.setAttribute('aria-label',phI18nAttr(phI18nD('afloat.pic_title',{name:phqcAlt(t.po)})));
  const img=document.createElement('img');img.className='phaf-lb-img';img.setAttribute('alt',phqcAlt(t.po));img.setAttribute('referrerpolicy','no-referrer');img.src=views[0].src;
  const close=_phqcBtn('ph-btn phaf-lb-close',phI18nD('afloat.pic_close'),function(){phqcLightboxClose();});close.id='phaf-lb-close';
  const top=phEl('div','phaf-lb-bar',null,[close]);
  if(views.length>1){
    views.forEach(function(v,i){
      const vb=_phqcBtn('ph-btn phaf-lb-v'+(i===0?' on':''),phI18nD(v.key),function(){img.src=v.src;},{'aria-pressed':i===0?'true':'false'});
      vb.addEventListener('click',function(){_phqcKids(top).forEach(function(c){if(c.classList&&c.classList.contains('phaf-lb-v')){c.classList.remove('on');c.setAttribute('aria-pressed','false');}});vb.classList.add('on');vb.setAttribute('aria-pressed','true');});
      top.appendChild(vb);
    });
  }
  ov.appendChild(top);ov.appendChild(img);
  ov.addEventListener('click',function(e){if(e&&e.target===ov)phqcLightboxClose();});
  document.body.appendChild(ov);
  _phqcLightbox={node:ov,opener:opener||null};
  try{close.focus();}catch(e){}
  return true;
}
function phqcLightboxClose(){
  const lb=_phqcLightbox;if(!lb)return false;
  _phqcLightbox=null;
  try{if(lb.node.parentNode)lb.node.parentNode.removeChild(lb.node);}catch(e){}
  try{if(lb.opener&&typeof lb.opener.focus==='function')lb.opener.focus();}catch(e){}
  return true;
}
// Escape closes in order: the lightbox, then the detail, then (the shell) the takeover.
function _phqcWireGuards(){
  if(_phqcGuardsWired||typeof phAddEscapeGuard!=='function')return;
  _phqcGuardsWired=true;
  phAddEscapeGuard(function(){if(_phqcLightbox){phqcLightboxClose();return true;}return false;});
  phAddEscapeGuard(function(){if(_phqcDlg&&_phqcIsHere()){phqcDlgClose();return true;}return false;});
  phAddEscapeGuard(function(){if(_phqcSheet&&_phqcIsHere()&&!_phqcSheet.saving){phqcSheetClose();return true;}return false;});
  phAddEscapeGuard(function(){if(_phqcOpen&&_phqcIsHere()){phqcBack();return true;}return false;});
}
function phqcReset(){
  _phqcPos={state:'idle',rows:null,at:0,err:null,truncated:false};_phqcPosP=null;
  _phqcF={q:'',stage:'',season:'',short:false,attention:false};_phqcFiltersOpen=null;_phqcCollapsed={closed:true};_phqcShowAll={};
  _phqcOpen='';_phqcBundles={};phqcLightboxClose();
  _phqcSheet=null;_phqcDlg=null;_phqcFlash=null;_phqcBusy=false;_phqcFocusId='';_phqcCqcSkipped={};
}

if(typeof phRegisterTab==='function'){
  phRegisterTab('afloat',{label:'Afloat POs',lkey:'afloat.tab',short:'Af',roles:PHAF_ROLE,render:phqcRender});
}else if(typeof console!=='undefined')console.warn('[prod-ops] ph-mod-afloat: the shell is not loaded, the tab is not registered');

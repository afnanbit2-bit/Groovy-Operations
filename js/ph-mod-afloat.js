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
function _phqcClock(ms){
  if(typeof ms!=='number'||!isFinite(ms))return'';
  const d=new Date(ms+5*3600000);
  const p=function(n){return(n<10?'0':'')+n;};
  return p(d.getUTCHours())+':'+p(d.getUTCMinutes());
}
function _phqcWhen(ms,today){const a=_phqcDay(ms,today),b=_phqcClock(ms);return a&&b?a+' '+b:a;}
// A username -> the person's name from USER_DEFS (js/auth.js); else the username as stored.
function _phqcWho(u){
  const s=_phqcStr(u).trim();if(!s)return'';
  try{if(typeof USER_DEFS!=='undefined'&&Array.isArray(USER_DEFS)){const d=USER_DEFS.filter(function(x){return x&&x.u===s;})[0];if(d&&d.name)return String(d.name);}}catch(e){}
  return s;
}
function _phqcTrim(s,n){const t=_phqcStr(s);return t.length>n?t.slice(0,n-1)+'…':t;}
// Units handed to QC through the OLD Packing ▸ Receiving page (pos.packingReceipts entries not written by the QC lot writer).
function phqcLegacyUnits(po){
  const l=po&&Array.isArray(po.packingReceipts)?po.packingReceipts:[];
  let n=0;
  l.forEach(function(r){if(r&&r.src!=='qc'){const q=typeof phWhole==='function'?phWhole(r.qty):Math.floor(+r.qty);if(q!==null&&isFinite(q))n+=q;}});
  return n;
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
  if(_phqcSeenUser&&_phqcSeenUser!==ctx.user){phqcReset();}
  _phqcSeenUser=ctx.user;
  _phqcWireGuards();
  _phqcStart(ctx);
  if(_phqcOpen){
    const t=_phqcFindTile(_phqcOpen);
    if(t){phqcDetail(host,ctx,t);return;}
    _phqcOpen='';
  }
  phqcList(host,ctx);
}
function _phqcHead(ctx,title,blurb){
  const h=phEl('header','ph-head');
  const row=phEl('div','ph-head-row',null,[phEl('h2','ph-title',title)]);
  row.appendChild(phEl('span','ph-chip ph-chip-view phaf-ro',phI18nD('afloat.read_only_chip')));
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
  if(t.lots&&t.lots.length&&phqcLegacyUnits(t.po)>0)return true;
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
// Arrow keys move between the tiles of one group (Up/Left back, Down/Right on, Home / End).
function _phqcTileKeys(e){
  const k=e&&e.key;if(!/^(ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Home|End)$/.test(k||''))return;
  const t=e.target&&e.target.closest?e.target.closest('.phaf-card'):null;if(!t)return;
  const ul=t.closest('.phaf-tiles');if(!ul)return;
  const items=[];(function walk(n){(n.children||[]).forEach(function(c){if(c.nodeType===1){if(c.classList&&c.classList.contains('phaf-card'))items.push(c);else walk(c);}});})(ul);
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
function _phqcStageLine(t){
  const st=phI18nD(PHAF_STAGE_KEYS[t.stage]||'afloat.st_unknown');
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
  _phqcOpen=String(id||'');
  if(_phqcCtx&&typeof _phqcCtx.repaint==='function')_phqcCtx.repaint();
  try{const m=document.getElementById('main-content');if(m)m.scrollTop=0;}catch(e){}
  try{const b=document.getElementById('phaf-back');if(b&&typeof b.focus==='function')b.focus();}catch(e){}
}
function phqcBack(){
  const id=_phqcOpen;_phqcOpen='';
  if(_phqcCtx&&typeof _phqcCtx.repaint==='function')_phqcCtx.repaint();
  try{   // focus back to the tile that opened the detail
    if(_phqcListEl&&id){(function walk(n){(n.children||[]).forEach(function(c){if(c.nodeType!==1)return;if(c.getAttribute&&c.getAttribute('data-po')===id&&typeof c.focus==='function'){c.focus();return;}walk(c);});})(_phqcListEl);}
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
  bar.appendChild(phEl('span','ph-chip ph-chip-view phaf-ro',phI18nD('afloat.read_only_chip')));
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
  const st=[phI18nT(PHAF_STAGE_KEYS[t.stage]||'afloat.st_unknown',null,'en')];
  if(t.po.cutAt){const cb=_phqcStr(t.po.cutBy);st.push(phI18nT(cb?'afloat.cut_on_by':'afloat.cut_on',{day:_phqcDay(t.po.cutAt,today),who:cb},'en'));}
  if(r.ok&&r.lotsLive)st.push(phI18nT(r.lotsLive===1?'afloat.lots_one':'afloat.lots_n',{n:r.lotsLive},'en'));
  if(t.lastLotAt)st.push(phI18nT('afloat.last_lot',{when:_phqcWhen(t.lastLotAt,today)},'en'));
  facts.appendChild(phEl('p','phaf-fact',st.join(' · ')));
  const ls=_phqcLockSentence(t,today),lp=phEl('p','phaf-fact phaf-lockline');
  if(ls&&ls.nodeType===1)lp.appendChild(ls);else phI18nSet(lp,ls);
  facts.appendChild(lp);
  const vrow=phEl('p','phaf-fact phaf-vrow');
  vrow.appendChild(phEl('span','phaf-vlab',phI18nD('afloat.verdict')));
  vrow.appendChild(phqcVerdictNode(t));
  if(r.ok&&r.verdict&&r.verdict.total){const tt=r.verdict.total;vrow.appendChild(phEl('span','phaf-vtot',phI18nD('afloat.total_line',{recv:tt.recv,cut:tt.cut,diff:tt.diff>0?'+'+tt.diff:String(tt.diff).replace('-','−'),a:tt.allow})));}
  facts.appendChild(vrow);
  hd.appendChild(facts);
  wrap.appendChild(hd);
  // bands
  if(rc&&rc.status==='closed')wrap.appendChild(phEl('p','phaf-band phaf-band-ok',phI18nD('afloat.band_closed',{when:_phqcWhen(rc.closedAt,today),who:_phqcStr(rc.closedByName)||_phqcWho(rc.closedBy)})));
  if(rc&&rc.status==='reopened'){
    const ov=Array.isArray(rc.overrides)?rc.overrides.filter(function(o){return o&&o.kind==='reopen';}).slice(-1)[0]:null;
    wrap.appendChild(phEl('p','phaf-band phaf-band-warn',phI18nD('afloat.band_reopened',{who:ov?(_phqcStr(ov.byName)||_phqcWho(ov.by)):'—',why:ov?_phqcStr(ov.reason):'—'})));
  }
  if(e&&e.drift){
    const d=e.drift.sizes.map(function(s){return s.size+' '+s.lock+' → '+s.live;}).join(', ');
    wrap.appendChild(phEl('p','phaf-band phaf-band-warn',phI18nD('afloat.band_drift',{list:d})));
  }
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
  const leg=phqcLegacyUnits(t.po);
  if(leg>0)hints.appendChild(phEl('p','ph-note phaf-note-warn',phI18nD('afloat.legacy',{n:leg})));
  wrap.appendChild(hints);
  // lots
  wrap.appendChild(_phqcLots(t,today));
  // the actions of the next work package: drawn DISABLED, the reason beside them (never a button that does nothing silently)
  wrap.appendChild(_phqcActions(t,ctx));
  // history
  const hist=_phqcHistory(t,today);if(hist)wrap.appendChild(hist);
  host.appendChild(wrap);
}
function _phqcLockSentence(t,today){
  const e=t.exp,rc=t.recon;
  if(!e||!e.ok)return phI18nD('afloat.cut_unreadable');
  if(e.source==='none')return phI18nD('afloat.lock_none');
  if(!t.reconOk)return phI18nD('afloat.lock_unread');
  if(e.source==='lock'&&rc&&rc.cutLock){
    const L=rc.cutLock,who=_phqcWho(L.lockedBy);
    const how=L.source==='first_lot'?phI18nT('afloat.lock_how_first',null,'en'):L.source==='relock'?phI18nT('afloat.lock_how_relock',{who:who},'en'):phI18nT('afloat.lock_how_manual',{who:who},'en');
    const n=phEl('span','phaf-lock');n.setAttribute('aria-label',phI18nAttr(phI18nD('afloat.lock_aria')));
    n.appendChild(phEl('span','phaf-lock-g','🔒'));n.lastChild.setAttribute('aria-hidden','true');
    n.appendChild(phEl('span','',phI18nD('afloat.lock_final',{when:_phqcWhen(L.lockedAt,today),how:how})));
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
function _phqcLots(t,today){
  const sec=phEl('section','phaf-lots');
  sec.appendChild(phEl('h3','ph-card-title',phI18nD('afloat.lots')));
  if(!t.lotsOk){sec.appendChild(phEl('p','ph-note phaf-unread',phI18nD('afloat.lots_unread')));return sec;}
  const l=(t.lots||[]).slice().sort(function(a,b){return(b.at||0)-(a.at||0);});
  if(!l.length){sec.appendChild(phEl('p','ph-note',phI18nD('afloat.lots_none')));return sec;}
  const ul=phEl('ul','phaf-lotlist');
  l.forEach(function(x){
    const li=phEl('li','phaf-lot'+(x.status==='void'?' phaf-lot-void':''));
    const sz=x.sizes&&typeof x.sizes==='object'?x.sizes:{};
    const keys=typeof phQcSizeOrder==='function'?phQcSizeOrder(null,Object.keys(sz)):Object.keys(sz);
    const head=phEl('span','phaf-lot-h');
    head.textContent='#'+(x.seq!=null?x.seq:'?')+' · '+(_phqcDay(x.day||x.at,today)||'—')+(typeof x.at==='number'?' '+_phqcClock(x.at):'')+' · '+(_phqcStr(x.byName)||_phqcWho(x.by)||'—');
    li.appendChild(head);
    const body=phEl('span','phaf-lot-b');
    body.textContent=keys.map(function(k){return k+' '+sz[k];}).join(' ')+' · '+(x.total!=null?x.total:keys.reduce(function(a,k){return a+(+sz[k]||0);},0))+' pcs';
    li.appendChild(body);
    if(x.src==='legacy')li.appendChild(phEl('span','phaf-lot-tag',phI18nD('afloat.lot_legacy')));
    if(x.note){const n=phEl('span','phaf-lot-note');n.textContent='“'+_phqcStr(x.note)+'”';li.appendChild(n);}
    if(x.status==='void'){const v=phEl('span','phaf-lot-voidw');v.appendChild(phEl('span','',phI18nD('afloat.lot_void')));const why=phEl('span','');why.textContent=' · '+_phqcStr(x.voidReason);v.appendChild(why);li.appendChild(v);}
    ul.appendChild(li);
  });
  sec.appendChild(ul);
  return sec;
}
function _phqcActions(t,ctx){
  const sec=phEl('section','phaf-actions');
  const r=t.rec;
  const btns=[];
  const off=function(key){const b=phEl('button','ph-btn phaf-off',phI18nD(key));b.setAttribute('type','button');b.setAttribute('disabled','disabled');b.disabled=true;b.setAttribute('aria-disabled','true');b.setAttribute('aria-describedby','phaf-off-why');return b;};
  const closed=t.recon&&t.recon.status==='closed';
  if(!closed&&r&&r.ok&&r.cut)btns.push(off('afloat.a_receive'));
  if(phqcIsManager(ctx.user)&&t.exp&&t.exp.ok&&t.exp.source==='live'&&t.reconOk)btns.push(off('afloat.a_lock'));
  if(!closed&&r&&r.ok&&(r.canClose.floor||(phqcIsManager(ctx.user)&&r.canClose.manager)))btns.push(off(r.phase==='ready'?'afloat.a_close':'afloat.a_close_short'));
  if(!btns.length)return sec;
  const row=phEl('div','phaf-arow');btns.forEach(function(b){row.appendChild(b);});
  sec.appendChild(row);
  const why=phEl('p','ph-note phaf-off-why',phI18nD('afloat.a_soon'));why.id='phaf-off-why';sec.appendChild(why);
  return sec;
}
function _phqcHistory(t,today){
  const ev=[];
  const L=t.recon&&t.recon.cutLock;
  if(L&&typeof L.lockedAt==='number')ev.push({at:L.lockedAt,txt:phI18nT('afloat.h_locked',{when:_phqcWhen(L.lockedAt,today),who:_phqcWho(L.lockedBy)},'en')});
  (t.lots||[]).forEach(function(x){if(typeof x.at==='number')ev.push({at:x.at,txt:phI18nT(x.status==='void'?'afloat.h_lot_void':'afloat.h_lot',{n:x.seq!=null?x.seq:'?',when:_phqcWhen(x.at,today)},'en')});});
  (t.recon&&Array.isArray(t.recon.overrides)?t.recon.overrides:[]).forEach(function(o){if(o&&typeof o.at==='number')ev.push({at:o.at,txt:phI18nT('afloat.h_override_'+(o.kind==='relock'||o.kind==='reopen'||o.kind==='close_short'?o.kind:'other'),{when:_phqcWhen(o.at,today),who:_phqcStr(o.byName)||_phqcWho(o.by)},'en')});});
  if(t.recon&&typeof t.recon.closedAt==='number')ev.push({at:t.recon.closedAt,txt:phI18nT('afloat.h_closed',{when:_phqcWhen(t.recon.closedAt,today)},'en')});
  if(!ev.length)return null;
  ev.sort(function(a,b){return a.at-b.at;});
  const p=phEl('p','ph-note phaf-hist');
  p.appendChild(phEl('span','phaf-vlab',phI18nD('afloat.history')));
  const s=phEl('span','');s.textContent=' '+ev.map(function(e){return e.txt;}).join(' · ');p.appendChild(s);
  return p;
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
      vb.addEventListener('click',function(){(top.children||[]).forEach(function(c){if(c.classList&&c.classList.contains('phaf-lb-v')){c.classList.remove('on');c.setAttribute('aria-pressed','false');}});vb.classList.add('on');vb.setAttribute('aria-pressed','true');});
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
  phAddEscapeGuard(function(){if(_phqcOpen&&_phqcIsHere()){phqcBack();return true;}return false;});
}
function phqcReset(){
  _phqcPos={state:'idle',rows:null,at:0,err:null,truncated:false};_phqcPosP=null;
  _phqcF={q:'',stage:'',season:'',short:false,attention:false};_phqcFiltersOpen=null;_phqcCollapsed={closed:true};_phqcShowAll={};
  _phqcOpen='';_phqcBundles={};phqcLightboxClose();
}

if(typeof phRegisterTab==='function'){
  phRegisterTab('afloat',{label:'Afloat POs',lkey:'afloat.tab',short:'Af',roles:PHAF_ROLE,render:phqcRender});
}else if(typeof console!=='undefined')console.warn('[prod-ops] ph-mod-afloat: the shell is not loaded, the tab is not registered');

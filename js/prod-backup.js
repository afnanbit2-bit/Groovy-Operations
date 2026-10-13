/* ─────────────────────────────────────────────────────────────────────────
   Production data backup (Oct 2026) — READ-ONLY, OWNER-ONLY.

   WHY IT EXISTS. Afnan: before ANY production-flow change ships, no current
   job work may be lost "at any cost". This is the safety copy: one file on
   the owner's own device holding every record the production flow works on,
   plus a way to check that file against what is live.

   WHAT IT DOES
   - Reads PB_COLLECTIONS through the client SDK (getDocs, window-bridged),
     builds ONE JSON file  collection -> { docId -> document }  and a summary
     (documents per collection, a fingerprint of each collection, and every
     collection that could not be read — NAMED, never silently empty), and
     downloads it. Nothing else.
   - pbVerifyLive() reads the same collections again and compares them with a
     backup file the owner picks: counts, ids only in one side, and documents
     whose content differs. Also read-only.
   - It writes NOTHING to Firestore. The one ordinary write that happens is
     the app's own logActivity row ("Production data backup"), made by
     js/shared.js, not by this file. tests/prod-backup.test.js holds that:
     no write function is called here, and the source never names one.

   HOW IT READS — AND WHY NOT "PAGED". getDocs(collection(db,name)) with no
   limit() returns EVERY document; the SDK pages the wire internally. True
   cursor paging needs startAfter()/documentId(), which index.html does not
   bridge onto window (a cross-track edit this file may not make), so a
   cursor would be a guess. The things that make a whole read untrustworthy
   are handled instead: a read answered from the device's offline copy
   (snapshot.metadata.fromCache) is a FAILURE, not data; a size that
   disagrees with the documents is a failure; a read that never answers is a
   named timeout, never a hang; documents holding local changes the server
   has not seen are counted and said.

   SERIALISATION — NOTHING IS LOST. Documents are plain JSON in place, with
   the Firestore types that JSON cannot carry written as ISO / base64 /
   path strings and listed in a side table `tags` by exact path:
     timestamp  ISO-8601 with all NINE fractional digits  2026-10-10T09:15:30.123456789Z
     geopoint   {latitude, longitude}     ref  the document path
     bytes      base64      vector  number list      date  ISO
     nan / inf / -inf / negzero   (JSON would turn each into null or 0)
   A path is an array: strings are map keys, numbers are array indexes, so a
   key containing a dot is unambiguous. pbDecodeDoc() applies the table to
   undo it (tests prove encode -> JSON -> decode is exact). A class this file
   does not know is kept as its own fields AND tagged `unknown:<name>` and
   counted in the summary — never dropped quietly. Firestore integers beyond
   2^53 are already rounded by the time the SDK hands them over; nothing here
   can undo that.

   WHAT THE FILE DOES NOT HOLD (say so, rather than imply): subcollections,
   collections outside PB_COLLECTIONS, Realtime Database attendance, Firebase
   Auth accounts, and files stored in Cloudinary (documents keep their URLs).

   NOT VERIFIED AGAINST LIVE FIRESTORE: this was written and tested against a
   fake SDK. The first real run is the test — it reports its own result.

   RULES THIS FILE FOLLOWS (CLAUDE.md): every global is pb / _pb / PB_
   prefixed (classic scripts share one lexical scope); no window.X= handler
   shares a name with a top-level function (in a browser those are ONE
   binding); every loader settles and never rejects; no literal colours; user
   text reaches the page through textContent only; no toISOString().slice
   for a day (UTC names yesterday before 5am in PKT).
   ───────────────────────────────────────────────────────────────────────── */

const PB_FORMAT='groovy-production-backup';
const PB_VERSION=1;
// The owner's list. A collection added here is read, fingerprinted, listed
// and compared everywhere with no other change.
const PB_COLLECTIONS=['pos','bundles','gatepasses','returns','fabricin','fabric_inventory','fabric_movements','fabric_drawstrings','drawstring_moves','printing_jobs','counters','settings',
  // Requests, approvals and records that sit beside a job (added after review):
  'gatepass_edit_requests','po_issue_requests','po_edit_requests','po_shortfalls','qc_reports','printing_billing','sla_events','article_recipes','color_library','stock_transfers','bstock_items','bstock_cartons','trim_templates','articles',
  // Production Ops (14 Oct 2026): the drafts, cut jobs, cutting masters, consumption standards and settings it keeps
  'po_drafts','po_cut_jobs','cutting_masters','ph_standards','ph_settings'];
// NOT here on purpose: store_items and store_transactions (the Store's own ledger).
// By USERNAME, never by role — the same shape as _MA_USERS.
const _PB_USERS=['afnan','ammar'];
const PB_READ_TIMEOUT_MS=180000;
const PB_LAST_KEY='groovy-pb-last';
const PB_ID_LIST_CAP=200;
const PB_MAX_DEPTH=100;

// session is a top-level `let` in js/shared.js — a lexical global reachable
// by bare name, never a window property. Fails CLOSED with no session.
function pbCanUse(){return !!(typeof session!=='undefined'&&session&&_PB_USERS.indexOf(session.u)>-1);}

/* ── small helpers ───────────────────────────────────────────────────── */
// defineProperty, not assignment: a key called __proto__ must become an own
// key, never reach the prototype.
function _pbSet(o,k,v){Object.defineProperty(o,k,{value:v,enumerable:true,writable:true,configurable:true});return o;}
function _pbHas(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
function _pbGroup(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
function _pbErr(e){return String((e&&e.message)||e||'failed')+(e&&e.code?' ('+e.code+')':'');}
const _PB_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _pbWhen(ms){
  const d=new Date(ms),p=n=>String(n).padStart(2,'0');
  return d.getDate()+' '+_PB_MONTHS[d.getMonth()]+' '+d.getFullYear()+', '+p(d.getHours())+':'+p(d.getMinutes());
}
function pbFileName(d,complete){
  const p=n=>String(n).padStart(2,'0');
  return 'groovy-production-backup_'+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+(complete?'':'_INCOMPLETE')+'.json';
}
// A fingerprint to notice a damaged or edited file. NOT a security
// signature — anyone who edits a file can recompute it (cyrb53).
function pbHash(str){
  let h1=0xdeadbeef,h2=0x41c6ce57;
  for(let i=0;i<str.length;i++){const ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (4294967296*(2097151&h2)+(h1>>>0)).toString(16);
}
// JSON with object keys sorted, so two documents compare equal whatever
// order the server listed their fields in.
function pbCanon(v){
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(pbCanon).join(',')+']';
  return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+pbCanon(v[k])).join(',')+'}';
}
function _pbTagsCanon(tags){
  return (tags||[]).map(t=>JSON.stringify(t.p)+'|'+t.t).sort().join(';');
}

/* ── Firestore values <-> JSON ───────────────────────────────────────── */
function pbTsToIso(sec,nanos){
  // new Date(...).toISOString() carries milliseconds only; the nine digits
  // are written from `nanoseconds` itself, so nothing is rounded.
  return new Date(sec*1000).toISOString().slice(0,19)+'.'+String(nanos).padStart(9,'0')+'Z';
}
function pbIsoToTs(iso){
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(String(iso));
  if(!m)return null;
  const ms=Date.parse(m[1]+'Z');
  if(isNaN(ms))return null;
  return{seconds:ms/1000,nanoseconds:m[2]?parseInt((m[2]+'000000000').slice(0,9),10):0};
}
// Duck-typing, and only ever on something a plain stored map cannot be:
// every test needs a FUNCTION property, and Firestore data never holds one.
function _pbIsTs(v){return typeof v.toDate==='function'&&typeof v.seconds==='number'&&typeof v.nanoseconds==='number';}
function _pbIsGeo(v){return typeof v.latitude==='number'&&typeof v.longitude==='number'&&typeof v.isEqual==='function';}
function _pbIsBytes(v){return typeof v.toBase64==='function'&&typeof v.toUint8Array==='function';}
function _pbIsRef(v){return typeof v.path==='string'&&typeof v.withConverter==='function';}
function _pbIsVector(v){return typeof v.toArray==='function';}
function _pbIsDate(v){return Object.prototype.toString.call(v)==='[object Date]';}
// A plain object's prototype is a ROOT prototype (its own prototype is
// null). Not compared with Object.prototype: that differs between realms.
function _pbIsPlain(v){const p=Object.getPrototypeOf(v);return p===null||Object.getPrototypeOf(p)===null;}

function _pbEnc(v,path,tags){
  if(v===null||v===undefined)return null;
  const t=typeof v;
  if(t==='string'||t==='boolean')return v;
  if(t==='number'){
    if(v!==v){tags.push({p:path.slice(),t:'nan'});return null;}
    if(v===Infinity){tags.push({p:path.slice(),t:'inf'});return null;}
    if(v===-Infinity){tags.push({p:path.slice(),t:'-inf'});return null;}
    if(v===0&&1/v<0){tags.push({p:path.slice(),t:'negzero'});return 0;}
    return v;
  }
  if(t==='bigint'){tags.push({p:path.slice(),t:'bigint'});return String(v);}
  if(t!=='object'){tags.push({p:path.slice(),t:'unknown:'+t});return String(v);}
  if(path.length>PB_MAX_DEPTH){tags.push({p:path.slice(),t:'toodeep'});return null;}
  if(Array.isArray(v)){
    return v.map((x,i)=>{path.push(i);const r=_pbEnc(x,path,tags);path.pop();return r;});
  }
  if(_pbIsTs(v)){
    let iso=null;
    try{iso=pbTsToIso(v.seconds,v.nanoseconds);}catch(_){iso=null;}
    if(iso!==null){tags.push({p:path.slice(),t:'timestamp'});return iso;}
    tags.push({p:path.slice(),t:'timestamp-raw'});
    return{seconds:v.seconds,nanoseconds:v.nanoseconds};
  }
  if(_pbIsGeo(v)){tags.push({p:path.slice(),t:'geopoint'});return{latitude:v.latitude,longitude:v.longitude};}
  if(_pbIsBytes(v)){tags.push({p:path.slice(),t:'bytes'});return v.toBase64();}
  if(_pbIsRef(v)){tags.push({p:path.slice(),t:'ref'});return v.path;}
  if(_pbIsDate(v)){
    if(isNaN(v.getTime())){tags.push({p:path.slice(),t:'unknown:InvalidDate'});return null;}
    tags.push({p:path.slice(),t:'date'});return v.toISOString();
  }
  if(_pbIsVector(v)){tags.push({p:path.slice(),t:'vector'});return Array.prototype.slice.call(v.toArray());}
  let src=v;
  if(!_pbIsPlain(v)){
    // A type this file does not know. Keep what it holds AND say so.
    tags.push({p:path.slice(),t:'unknown:'+((v.constructor&&v.constructor.name)||'object')});
    if(typeof v.toJSON==='function'){try{src=v.toJSON();}catch(_){src=v;}}
    if(src===null||typeof src!=='object')return src===undefined?null:src;
  }
  const out={};
  Object.keys(src).forEach(k=>{
    const x=src[k];
    if(x===undefined)return;            // Firestore never yields undefined; JSON would drop it too
    path.push(k);
    _pbSet(out,k,_pbEnc(x,path,tags));
    path.pop();
  });
  return out;
}
// One document -> {data, tags}. `data` is JSON-safe; `tags` lists the paths
// whose JSON form is not what Firestore held.
function pbEncodeDoc(data){
  const tags=[];
  const enc=_pbEnc(data===undefined||data===null?{}:data,[],tags);
  return{data:enc,tags};
}
function _pbRestore(t,val,makers){
  switch(t){
    case 'nan':return NaN;
    case 'inf':return Infinity;
    case '-inf':return -Infinity;
    case 'negzero':return -0;
    case 'bigint':return BigInt(val);
    case 'date':return new Date(val);
    case 'timestamp':{
      const x=pbIsoToTs(val);if(!x)return val;
      return makers.timestamp?makers.timestamp(x.seconds,x.nanoseconds):{__type:'timestamp',seconds:x.seconds,nanoseconds:x.nanoseconds};
    }
    case 'geopoint':return makers.geopoint?makers.geopoint(val.latitude,val.longitude):{__type:'geopoint',latitude:val.latitude,longitude:val.longitude};
    case 'ref':return makers.ref?makers.ref(val):{__type:'ref',path:val};
    case 'bytes':return makers.bytes?makers.bytes(val):{__type:'bytes',base64:val};
    case 'vector':return makers.vector?makers.vector(val):{__type:'vector',values:val};
    default:return val;
  }
}
// The inverse of pbEncodeDoc. `makers` may supply real constructors
// ({timestamp:(sec,nanos)=>…}); without them a typed value comes back as a
// small tagged object. This is NOT a restore tool — it writes nothing — it
// is how the round trip is proven and how a restore would start.
function pbDecodeDoc(enc,tags,makers){
  makers=makers||{};
  const root=_pbSet({},'v',JSON.parse(JSON.stringify(enc===undefined?null:enc)));
  (tags||[]).forEach(tg=>{
    const p=tg.p||[];
    let parent=root,key='v';
    for(let i=0;i<p.length;i++){parent=parent[key];key=p[i];}
    _pbSet(parent,key,_pbRestore(tg.t,parent[key],makers));
  });
  return root.v;
}

/* ── reading ─────────────────────────────────────────────────────────── */
// One collection. NEVER rejects: it answers {col,ok:true,docs} or
// {col,ok:false,message}.
async function _pbReadOne(col,timeoutMs){
  let timer=null;
  try{
    const snap=await Promise.race([
      Promise.resolve().then(()=>getDocs(collection(db,col))),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('no answer after '+Math.round(timeoutMs/1000)+' seconds'),{code:'timeout'})),timeoutMs);})
    ]);
    if(!snap||!Array.isArray(snap.docs))return{col,ok:false,message:'the read returned something unexpected'};
    if(snap.metadata&&snap.metadata.fromCache)return{col,ok:false,message:"answered from this device's offline copy, not the server — the list may be incomplete"};
    if(typeof snap.size==='number'&&snap.size!==snap.docs.length)return{col,ok:false,message:'the read reported '+snap.size+' documents but delivered '+snap.docs.length};
    const docs=snap.docs.map(d=>({id:d.id,data:typeof d.data==='function'?d.data():(d.data||{}),pending:!!(d.metadata&&d.metadata.hasPendingWrites)}));
    return{col,ok:true,docs};
  }catch(e){
    return{col,ok:false,message:_pbErr(e)};
  }finally{
    if(timer!==null)clearTimeout(timer);
  }
}
// Every collection, in parallel, each settling on its own. Never rejects.
async function pbReadAll(opts){
  opts=opts||{};
  const names=opts.collections||PB_COLLECTIONS;
  const timeoutMs=opts.timeoutMs||PB_READ_TIMEOUT_MS;
  return Promise.all(names.map(c=>_pbReadOne(c,timeoutMs)));
}

/* ── building the file ───────────────────────────────────────────────── */
// results: pbReadAll's answers. Pure. A collection that failed is ABSENT
// from `collections` (never {}), so nobody can mistake it for an empty one.
function pbBuildBackup(results,meta){
  meta=meta||{};
  const collections={},tags={},counts={},hashes={},pendingWrites={},pendingIds={},unusual={};
  const failed=[],empty=[],seen=new Set();
  let total=0;
  (results||[]).forEach(r=>{
    const col=r&&r.col;
    if(col)seen.add(col);
    if(!r||!r.ok){failed.push({col:col||'(unknown)',message:String((r&&r.message)||'could not be read')});return;}
    const colObj={},colTags={};
    let pend=0;const pids=[];
    const docs=r.docs||[];
    docs.forEach(d=>{
      const e=pbEncodeDoc(d.data);
      _pbSet(colObj,d.id,e.data);
      if(e.tags.length){
        _pbSet(colTags,d.id,e.tags);
        e.tags.forEach(tg=>{
          const t=String(tg.t);
          if(t.indexOf('unknown:')===0||t==='timestamp-raw'||t==='toodeep'){
            if(!_pbHas(unusual,col))_pbSet(unusual,col,{});
            unusual[col][t]=(unusual[col][t]||0)+1;
          }
        });
      }
      if(d.pending){pend++;if(pids.length<50)pids.push(d.id);}
    });
    const n=Object.keys(colObj).length;
    if(n!==docs.length){failed.push({col,message:'the read held duplicate document ids ('+docs.length+' documents, '+n+' ids)'});return;}
    collections[col]=colObj;
    if(Object.keys(colTags).length)tags[col]=colTags;
    counts[col]=n;total+=n;
    hashes[col]=pbHash(pbCanon({d:colObj,t:colTags}));
    if(!n)empty.push(col);
    if(pend){pendingWrites[col]=pend;pendingIds[col]=pids;}
  });
  PB_COLLECTIONS.forEach(c=>{if(!seen.has(c))failed.push({col:c,message:'was not read'});});
  const summary={
    total,counts,hashes,failed,empty,pendingWrites,pendingIds,unusualTypes:unusual,
    expected:PB_COLLECTIONS.slice(),
    complete:failed.length===0
  };
  const backup={
    format:PB_FORMAT,version:PB_VERSION,
    createdAt:new Date(meta.at||Date.now()).toISOString(),
    createdBy:meta.by||null,project:meta.project||null,
    summary,collections,tags
  };
  return{backup,summary};
}

function pbSummaryText(s,x){
  x=x||{};
  const read=Object.keys(s.counts).length,want=(s.expected||PB_COLLECTIONS).length;
  const parts=[];
  const size=x.chars?' (about '+(x.chars<1048576?Math.max(1,Math.round(x.chars/1024))+' KB':(Math.round(x.chars/104857.6)/10)+' MB')+')':'';
  if(!read)parts.push('Nothing could be read, so NO backup file was saved.');
  else if(x.saved===false)parts.push('The backup could not be saved to this device.');
  else if(s.complete)parts.push('Backup saved'+(x.filename?' as '+x.filename:'')+size+' — '+_pbGroup(s.total)+' documents in '+read+' of '+want+' collections.');
  else parts.push('INCOMPLETE backup saved'+(x.filename?' as '+x.filename:'')+size+' — '+_pbGroup(s.total)+' documents from '+read+' of '+want+' collections. Fix the problem and back up again before changing anything.');
  if(s.failed.length)parts.push('Could not read: '+s.failed.map(f=>f.col+' ('+f.message+')').join('; ')+'.');
  if(s.empty.length)parts.push('Read fine but empty: '+s.empty.join(', ')+'.');
  const pw=Object.keys(s.pendingWrites||{});
  if(pw.length)parts.push('Holds changes this device has not yet sent to the server in: '+pw.map(c=>c+' ('+s.pendingWrites[c]+(s.pendingIds&&s.pendingIds[c]?': '+s.pendingIds[c].slice(0,5).join(', ')+(s.pendingWrites[c]>5?', …':''):'')+')').join(', ')+'.');
  const un=Object.keys(s.unusualTypes||{});
  if(un.length)parts.push('Contains value types this file does not know in: '+un.join(', ')+' (kept as plain fields and tagged).');
  return parts.join(' ');
}

/* ── saving, remembering, painting ───────────────────────────────────── */
function _pbSaveFile(name,text){
  try{
    const blob=new Blob([text],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;
    document.body.appendChild(a);a.click();if(a.remove)a.remove();
    const t=setTimeout(()=>{try{URL.revokeObjectURL(url);}catch(_){}},60000);
    if(t&&t.unref)t.unref();
    return true;
  }catch(e){return false;}
}
function _pbProject(){try{return (db&&db.app&&db.app.options&&db.app.options.projectId)||null;}catch(_){return null;}}
// A convenience for the person, nothing more: the file they saved is the
// backup, not this note. Every access guarded — private windows and blocked
// storage throw.
function _pbRememberLast(info){
  try{if(typeof localStorage!=='undefined'&&localStorage)localStorage.setItem(PB_LAST_KEY,JSON.stringify(info));}catch(_){}
}
function pbLastBackup(){
  try{
    if(typeof localStorage==='undefined'||!localStorage)return null;
    const raw=localStorage.getItem(PB_LAST_KEY);
    if(!raw)return null;
    const o=JSON.parse(raw);
    return o&&typeof o==='object'&&typeof o.at==='number'?o:null;
  }catch(_){return null;}
}
function pbLastText(o){
  if(!o)return 'No backup has been made from this browser yet.';
  return 'Last backup from this browser: '+_pbWhen(o.at)+(o.byName?' by '+o.byName:'')+' — '+_pbGroup(o.total||0)+' documents in '+(o.collections||0)+' collections'+(o.complete?', complete.':', INCOMPLETE'+(o.failed&&o.failed.length?' (could not read '+o.failed.join(', ')+')':'')+'.')+' This note is only a reminder kept in this browser — the file you saved is the backup.';
}
function _pbSay(id,msg){try{const el=document.getElementById(id);if(el)el.textContent=msg;}catch(_){}}
function _pbPaintLast(){_pbSay('pb-last',pbLastText(pbLastBackup()));}

let _pbBusy=false;
let _pbVerifyBusy=false;

// The backup. Never rejects; answers {ok,saved,complete,filename,summary,message}.
async function pbRunBackup(opts){
  opts=opts||{};
  if(!pbCanUse())return{ok:false,saved:false,reason:'gate',message:'Production backup is for Afnan and Ammar.'};
  if(_pbBusy)return{ok:false,saved:false,reason:'busy',message:'A backup is already running.'};
  _pbBusy=true;
  try{
    // Who is asking is taken NOW: a sign-out while the reads run must not
    // turn into a TypeError that loses the file.
    const who=session;
    const btn=document.getElementById('pb-backup-btn');if(btn)btn.disabled=true;
    _pbSay('pb-status','Reading every collection…');
    const results=await pbReadAll(opts);
    const at=Date.now();
    const built=pbBuildBackup(results,{at,by:who.u,project:_pbProject()});
    const s=built.summary;
    const read=Object.keys(s.counts).length;
    let saved=false,filename=null,chars=0;
    if(read){
      filename=pbFileName(new Date(at),s.complete);
      const text=JSON.stringify(built.backup);
      chars=text.length;
      saved=_pbSaveFile(filename,text);
    }
    const message=pbSummaryText(s,{saved,filename,chars});
    if(saved)_pbRememberLast({at,by:who.u,byName:who.name||who.u,complete:s.complete,total:s.total,collections:read,failed:s.failed.map(f=>f.col),filename});
    try{
      const p=typeof logActivity==='function'
        ?logActivity('Production data backup',(saved?(s.complete?'complete':'INCOMPLETE'):'NOT saved')+' · '+_pbGroup(s.total)+' documents in '+read+' collections'+(s.failed.length?' · could not read '+s.failed.map(f=>f.col).join(', '):''))
        :null;
      if(p&&typeof p.catch==='function')p.catch(()=>{});
    }catch(_){}
    _pbSay('pb-status',message);
    _pbSay('pb-last',pbLastText(pbLastBackup()));
    try{if(typeof showToast==='function')showToast(saved?(s.complete?'Production backup saved.':'Backup saved, but INCOMPLETE — read the message.'):'Backup NOT saved — read the message.');}catch(_){}
    return{ok:saved&&s.complete,saved,complete:s.complete,filename,summary:s,message};
  }catch(e){
    const message='The backup failed: '+_pbErr(e)+' No file was saved.';
    _pbSay('pb-status',message);
    return{ok:false,saved:false,reason:'error',message};
  }finally{
    _pbBusy=false;
    const b=document.getElementById('pb-backup-btn');if(b)b.disabled=false;
  }
}

/* ── verifying a file ────────────────────────────────────────────────── */
// The file against itself: is it a backup, is every collection the size and
// content its own summary says. Pure.
function pbCheckFile(b){
  const problems=[];
  if(!b||typeof b!=='object'||Array.isArray(b))return{ok:false,problems:['This is not a Groovy production backup (it is not a JSON object).'],cols:[],failedAtBackup:[]};
  if(b.format!==PB_FORMAT)problems.push('This file is not a Groovy production backup (its format marker is missing or different).');
  else if(b.version!==PB_VERSION)problems.push('This backup is format version '+b.version+'; this build reads version '+PB_VERSION+'.');
  const colsOk=b.collections&&typeof b.collections==='object'&&!Array.isArray(b.collections);
  const cols=colsOk?Object.keys(b.collections):[];
  if(!colsOk)problems.push('The file has no "collections" section.');
  const sum=b.summary&&typeof b.summary==='object'&&!Array.isArray(b.summary)?b.summary:null;
  if(!sum)problems.push('The file has no summary.');
  const failedAtBackup=sum&&Array.isArray(sum.failed)?sum.failed.map(f=>f&&f.col).filter(Boolean):[];
  if(colsOk&&sum){
    const counts=sum.counts&&typeof sum.counts==='object'?sum.counts:{};
    const hashes=sum.hashes&&typeof sum.hashes==='object'?sum.hashes:{};
    const tagsAll=b.tags&&typeof b.tags==='object'?b.tags:{};
    let total=0;
    cols.forEach(c=>{
      const col=b.collections[c];
      const n=col&&typeof col==='object'?Object.keys(col).length:0;
      total+=n;
      if(counts[c]!==n)problems.push(c+': the file holds '+n+' documents but its summary says '+(counts[c]===undefined?'nothing':counts[c])+' — the file was cut short or edited.');
      const h=pbHash(pbCanon({d:col||{},t:_pbHas(tagsAll,c)?tagsAll[c]:{}}));
      if(hashes[c]!==h)problems.push(c+': the content does not match the fingerprint taken when the backup was made — the file was changed or damaged.');
    });
    Object.keys(counts).forEach(c=>{if(cols.indexOf(c)<0)problems.push(c+': the summary lists it but the file holds none of its documents.');});
    if(sum.total!==total)problems.push('The file holds '+_pbGroup(total)+' documents in all but its summary says '+(sum.total===undefined?'nothing':_pbGroup(sum.total))+'.');
  }
  return{ok:problems.length===0,problems,cols,failedAtBackup};
}
function _pbCap(arr){return arr.length>PB_ID_LIST_CAP?arr.slice(0,PB_ID_LIST_CAP):arr;}
// The file against the live read. Pure: `live` is pbReadAll's answer.
function pbCompare(backup,live){
  const file=pbCheckFile(backup);
  const rows=[];
  const liveCols=new Set();
  (live||[]).forEach(r=>{
    liveCols.add(r.col);
    const inFile=file.cols.indexOf(r.col)>-1;
    const row={col:r.col,inFile:inFile?Object.keys(backup.collections[r.col]||{}).length:null,live:null,status:'',message:'',n:{onlyLive:0,onlyFile:0,changed:0},onlyLive:[],onlyFile:[],changed:[]};
    rows.push(row);
    if(!r.ok){row.status='unread';row.message=r.message||'could not be read';return;}
    row.live=r.docs.length;
    if(!inFile){
      row.status='notInFile';
      row.message=file.failedAtBackup.indexOf(r.col)>-1?'could not be read when the backup was made, so the file holds nothing for it':'the file holds nothing for this collection';
      return;
    }
    const fileCol=backup.collections[r.col]||{};
    const fileTags=(backup.tags&&_pbHas(backup.tags,r.col)&&backup.tags[r.col])||{};
    const seen=new Set();
    r.docs.forEach(d=>{
      seen.add(d.id);
      if(!_pbHas(fileCol,d.id)){row.n.onlyLive++;row.onlyLive.push(d.id);return;}
      const e=pbEncodeDoc(d.data);
      const here=pbCanon(e.data)+'#'+_pbTagsCanon(e.tags);
      const there=pbCanon(fileCol[d.id])+'#'+_pbTagsCanon(_pbHas(fileTags,d.id)?fileTags[d.id]:[]);
      if(here!==there){row.n.changed++;row.changed.push(d.id);}
    });
    Object.keys(fileCol).forEach(id=>{if(!seen.has(id)){row.n.onlyFile++;row.onlyFile.push(id);}});
    row.onlyLive=_pbCap(row.onlyLive);row.onlyFile=_pbCap(row.onlyFile);row.changed=_pbCap(row.changed);
    row.status=(row.n.onlyLive||row.n.onlyFile||row.n.changed)?'differs':'identical';
  });
  file.cols.forEach(c=>{
    if(!liveCols.has(c))rows.push({col:c,inFile:Object.keys(backup.collections[c]||{}).length,live:null,status:'notChecked',message:'not one of the collections this build checks',n:{onlyLive:0,onlyFile:0,changed:0},onlyLive:[],onlyFile:[],changed:[]});
  });
  return{
    file,rows,
    intact:file.ok,
    allRead:rows.every(r=>r.status!=='unread'),
    identical:file.ok&&file.failedAtBackup.length===0&&rows.length>0&&rows.every(r=>r.status==='identical')
  };
}
function pbVerifyText(res){
  if(!res)return 'Nothing to report.';
  if(res.reason==='gate'||res.reason==='busy'||res.reason==='error')return res.message;
  const parts=[];
  const f=res.file;
  if(f&&f.problems.length)parts.push('PROBLEM WITH THE FILE ITSELF: '+f.problems.join(' '));
  else parts.push('The file is intact — every collection matches its own fingerprint.');
  if(f&&f.failedAtBackup.length)parts.push('The backup was INCOMPLETE when it was made: '+f.failedAtBackup.join(', ')+' could not be read.');
  const un=res.rows.filter(r=>r.status==='unread');
  if(un.length)parts.push('Could not read live: '+un.map(r=>r.col+' ('+r.message+')').join('; ')+' — those were NOT compared.');
  const diff=res.rows.filter(r=>r.status==='differs');
  if(diff.length)parts.push('Differences since the backup: '+diff.map(r=>r.col+' ('+r.n.onlyLive+' new, '+r.n.onlyFile+' gone, '+r.n.changed+' changed)').join('; ')+'. Work done after the backup shows up here — that is expected; documents that are GONE or CHANGED are the ones to look at.');
  if(res.identical)parts.push('Live data is identical to this backup.');
  return parts.join(' ');
}
function pbParseBackupText(text){
  try{return{ok:true,backup:JSON.parse(text)};}
  catch(e){return{ok:false,message:'That file is not valid JSON ('+_pbErr(e)+') — it may have been cut short while saving or copying.'};}
}
// Read live data (still read-only) and compare. Never rejects.
async function pbVerifyLive(backup,opts){
  if(!pbCanUse())return{ok:false,reason:'gate',message:'Production backup is for Afnan and Ammar.'};
  try{
    const chk=pbCheckFile(backup);
    if(!chk.cols.length)return{ok:false,reason:'notabackup',message:chk.problems.join(' ')||'The file holds no collections.',file:chk,rows:[],intact:false,allRead:true,identical:false};
    const live=await pbReadAll(opts);
    const cmp=pbCompare(backup,live);
    return Object.assign({ok:true},cmp);
  }catch(e){
    return{ok:false,reason:'error',message:'The check failed: '+_pbErr(e)};
  }
}

/* ── the card ────────────────────────────────────────────────────────── */
function pbUsersEntry(){
  if(!pbCanUse())return '';
  return '<div class="card"><div class="card-title">Production data</div>'
    +'<div style="font-size:13px;line-height:1.5;color:var(--muted);margin-bottom:10px">A read-only copy of every job record, saved to this device. Take one before any production change.</div>'
    +'<button class="btn-outline" onclick="window.pbOpen()">Back up production data</button></div>';
}
function pbCardHTML(){
  return '<h3>Back up production data</h3>'
    +'<div class="sub">Read-only. Saves every job record to this device as one file. Nothing in the app is changed.</div>'
    +'<div style="font-size:13px;line-height:1.5;color:var(--muted);margin-bottom:12px">Covers: '+PB_COLLECTIONS.join(' · ')+'. Run this on a computer; the file contains business data and must be kept private — do not share it or leave it on a shared device.</div>'
    +'<button class="btn-primary" id="pb-backup-btn" onclick="window.pbBackupNow()">Back up production data</button>'
    +'<div id="pb-status" role="status" style="font-size:13px;line-height:1.5;margin-top:10px;color:var(--text)"></div>'
    +'<div id="pb-last" style="font-size:12px;line-height:1.5;margin-top:8px;color:var(--muted)"></div>'
    +'<div style="border-top:1px solid var(--border);margin:16px 0 12px"></div>'
    +'<div style="font-weight:600;font-size:14px;margin-bottom:4px">Check a backup file</div>'
    +'<div class="sub" style="margin-bottom:10px">Reads live data (still read-only) and compares it with a backup file, collection by collection.</div>'
    +'<input type="file" id="pb-file" accept=".json,application/json" style="display:none" onchange="window.pbVerifyPick(this)">'
    +'<button class="btn-outline" id="pb-verify-btn" onclick="document.getElementById(\'pb-file\').click()">Choose a backup file…</button>'
    +'<div id="pb-verify-msg" role="status" style="font-size:13px;line-height:1.5;margin-top:10px;color:var(--text)"></div>'
    +'<div id="pb-verify-table" style="overflow-x:auto;margin-top:8px"></div>'
    +'<div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn-outline" onclick="window.pbClose()">Close</button></div>';
}
const _PB_STATUS_WORD={identical:'Identical',differs:'Differs',unread:'Not read',notInFile:'Not in file',notChecked:'Not checked'};
// Built with createElement + textContent: every string here came out of a
// file somebody chose, so none of it goes through an HTML string.
function _pbPaintVerify(res){
  _pbSay('pb-verify-msg',pbVerifyText(res));
  const host=document.getElementById('pb-verify-table');
  if(!host)return;
  host.textContent='';
  if(!res||!res.rows||!res.rows.length)return;
  const tbl=document.createElement('table');
  tbl.style.cssText='width:100%;border-collapse:collapse;font-size:13px';
  const mk=(tag,text,right)=>{const c=document.createElement(tag);c.textContent=text;c.style.cssText='padding:6px 8px;border-bottom:1px solid var(--border);text-align:'+(right?'right':'left')+';white-space:nowrap';return c;};
  const head=document.createElement('tr');
  ['Collection','In file','Live now','Result'].forEach((h,i)=>head.appendChild(mk('th',h,i===1||i===2)));
  tbl.appendChild(head);
  res.rows.forEach(r=>{
    const tr=document.createElement('tr');
    tr.appendChild(mk('td',r.col));
    tr.appendChild(mk('td',r.inFile===null?'—':_pbGroup(r.inFile),true));
    tr.appendChild(mk('td',r.live===null?'—':_pbGroup(r.live),true));
    const detail=r.status==='differs'?' ('+r.n.onlyLive+' new, '+r.n.onlyFile+' gone, '+r.n.changed+' changed)':'';
    tr.appendChild(mk('td',(_PB_STATUS_WORD[r.status]||r.status)+detail));
    tbl.appendChild(tr);
  });
  host.appendChild(tbl);
}

/* ── window handlers (names differ from every function above) ────────── */
window.pbOpen=function(){
  if(!pbCanUse()){try{if(typeof showToast==='function')showToast('Production backup is for Afnan and Ammar.');}catch(_){}return false;}
  const old=document.getElementById('pb-back');if(old&&old.remove)old.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='pb-back';
  back.onclick=ev=>{if(ev.target===back)window.pbClose();};
  back.innerHTML='<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:560px">'+pbCardHTML()+'</div>';
  document.body.appendChild(back);
  _pbPaintLast();
  return true;
};
window.pbClose=function(){const b=document.getElementById('pb-back');if(b&&b.remove)b.remove();};
window.pbBackupNow=function(){return pbRunBackup();};
function _pbReadFile(f){
  if(typeof f.text==='function')return f.text();
  return new Promise((resolve,reject)=>{
    try{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error||new Error('could not read the file'));r.readAsText(f);}
    catch(e){reject(e);}
  });
}
window.pbVerifyPick=async function(input){
  if(!pbCanUse())return false;
  if(_pbVerifyBusy)return false;
  const f=input&&input.files&&input.files[0];
  if(!f)return false;
  _pbVerifyBusy=true;
  try{
    _pbSay('pb-verify-msg','Reading '+(f.name||'the file')+'…');
    const parsed=pbParseBackupText(await _pbReadFile(f));
    if(!parsed.ok){_pbSay('pb-verify-msg',parsed.message);return false;}
    _pbSay('pb-verify-msg','Reading live data to compare…');
    const res=await pbVerifyLive(parsed.backup);
    _pbPaintVerify(res);
    return res;
  }catch(e){
    _pbSay('pb-verify-msg','The check failed: '+_pbErr(e));
    return false;
  }finally{
    _pbVerifyBusy=false;
    try{input.value='';}catch(_){}
  }
};

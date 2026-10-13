/* ─────────────────────────────────────────────────────────────────────────
   Production data backup (js/prod-backup.js) — read-only, owner-only.

   What this proves: the gate is by USERNAME and fails closed; every Firestore
   value type survives encode -> JSON -> decode exactly (nanosecond
   timestamps, nested arrays and maps, NaN / Infinity / -0, a hostile
   __proto__ key); a collection that cannot be read — refused, timed out,
   answered from the offline copy, thrown — is NAMED and the file says it is
   incomplete, never an empty list; nothing is written to Firestore (the
   source never names a write function and the harness records none, beyond
   the app's own logActivity row); and a file is checked against live data
   for new, gone and changed documents.

   What it does NOT prove: that the real Firestore SDK answers the way the
   fake does. The fake mimics getDocs / snapshot.metadata / doc.metadata;
   the first real run is the test.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');

const SRC=fs.readFileSync(path.join(ROOT,'js/prod-backup.js'),'utf8');

// ── fake Firestore value classes, defined OUTSIDE the vm (a different realm
// from the module, which is exactly what must not matter) ───────────────
class Ts{constructor(s,n){this.seconds=s;this.nanoseconds=n;}toDate(){return new Date(this.seconds*1000);}toMillis(){return this.seconds*1000;}isEqual(o){return !!o&&o.seconds===this.seconds&&o.nanoseconds===this.nanoseconds;}}
class Geo{constructor(a,b){this.latitude=a;this.longitude=b;}isEqual(o){return !!o&&o.latitude===this.latitude;}}
class Ref{constructor(p){this.path=p;this.id=p.split('/').pop();}withConverter(){return this;}}
class Bytes{constructor(b){this._b=b;}toBase64(){return this._b;}toUint8Array(){return new Uint8Array();}}
class Weird{constructor(){this.a=1;this.b=new Ts(5,6);}}
const MAKERS={timestamp:(s,n)=>new Ts(s,n),geopoint:(a,b)=>new Geo(a,b),ref:p=>new Ref(p),bytes:b=>new Bytes(b)};

// Equality that tells -0 from 0 and NaN from NaN, and compares the fake
// Firestore classes by value. No prototype checks (two realms).
function same(a,b){
  if(typeof a==='number'&&typeof b==='number')return Object.is(a,b);
  if(a instanceof Ts)return b instanceof Ts&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
  if(a instanceof Geo)return b instanceof Geo&&a.latitude===b.latitude&&a.longitude===b.longitude;
  if(a instanceof Ref)return b instanceof Ref&&a.path===b.path;
  if(a instanceof Bytes)return b instanceof Bytes&&a._b===b._b;
  if(a instanceof Date)return b instanceof Date&&a.getTime()===b.getTime();
  if(Array.isArray(a))return Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>same(x,b[i]));
  if(a&&typeof a==='object'){
    if(!b||typeof b!=='object'||Array.isArray(b))return false;
    const ka=Object.keys(a),kb=Object.keys(b);
    return ka.length===kb.length&&ka.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&same(a[k],b[k]));
  }
  return a===b;
}
function walk(n,out){out=out||[];if(!n)return out;if(n.textContent)out.push(String(n.textContent));(n.children||[]).forEach(c=>walk(c,out));return out;}
// How many collections the module reads — derived, so adding one never silently shrinks coverage.
const N=loadApp({files:['js/prod-backup.js']}).run('PB_COLLECTIONS.length');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=(p,ms)=>Promise.race([p,delay(ms||3000).then(()=>'HUNG')]);

function liveStore(){
  return{
    pos:[
      {id:'PO-1',data:{poNumber:'PO-1',qty:500,rate:12.5,createdAt:new Ts(1700000000,123456789),sizes:{S:100,M:{x:[1,2,{y:3}]}},stage:'cutting',done:false,note:null}},
      {id:'PO-2',data:{poNumber:'PO-2',qty:80,createdAt:new Ts(1700000100,0),history:[{at:new Ts(1700000200,5),by:'uzaib'},{at:new Ts(1700000300,6),by:'alam'}]}}
    ],
    bundles:[{id:'B-1',data:{po:'PO-1',size:'M',qty:50}},{id:'B-2',data:{po:'PO-1',size:'S',qty:50}}],
    gatepasses:[{id:'GP-1',data:{vendor:'Ali',items:[{n:'denim',q:3},{n:'rib',q:1}],date:new Ts(1700001000,1)}}],
    returns:[],
    fabricin:[{id:'F-1',data:{rolls:4,kg:81.5}}],
    fabric_inventory:[{id:'FI-1',data:{type:'denim',balance:120}}],
    fabric_movements:[{id:'M-1',data:{ts:1700000000000,kind:'issue',qty:5}},{id:'M-2',data:{ts:1700000001000,kind:'in',qty:9}}],
    fabric_drawstrings:[{id:'D-1',data:{color:'black',meters:100}}],
    drawstring_moves:[{id:'DM-1',data:{color:'black',delta:-5}}],
    printing_jobs:[{id:'PJ-1',data:{po:'PO-1',stage:'bulk',sizes:{M:50},stageHistory:[{s:'pp',at:new Ts(1700000400,9)}]}}],
    counters:[{id:'main',data:{pos:41,bundles:900,gatepasses:12}}],
    settings:[{id:'pattern_hub',data:{poIntegration:true}}],
    gatepass_edit_requests:[{id:'GER-1',data:{gp:'GP-1',status:'pending',at:new Ts(1700002000,3)}}],
    po_issue_requests:[{id:'PIR-1',data:{po:'PO-1',lines:[{code:'T1',qty:4}],status:'open'}}],
    po_edit_requests:[{id:'PER-1',data:{po:'PO-1',changes:{qty:[500,520]}}}],
    po_shortfalls:[{id:'SF-1',data:{po:'PO-1',short:3}}],
    qc_reports:[{id:'QC-1',data:{po:'PO-1',defects:[{k:'stain',n:2}]}}],
    printing_billing:[{id:'PB-1',data:{job:'PJ-1',amount:15000}}],
    sla_events:[{id:'SLA-1',data:{job:'PJ-1',kind:'pp_sample',at:new Ts(1700000500,0)}}],
    article_recipes:[{id:'GST073',data:{name:'Tee',steps:[{s:'print'},{s:'wash'}]}}],
    color_library:[{id:'CL-1',data:{pantoneCode:'485 C',hexApprox:'#da291c'}}],
    stock_transfers:[{id:'ST-1',data:{poId:'PO-1',items:[{c:'T1',q:4}],status:'booked'}}],
    bstock_items:[{id:'BS-1',data:{code:'GST073-M',qty:2}}],
    bstock_cartons:[{id:'BC-1',data:{items:['BS-1']}}],
    trim_templates:[{id:'TT-1',data:{name:'Basic',trims:['label','tag']}}],
    articles:[{id:'GST073',data:{code:'GST073',category:'tops',name:'Tee'}}],
    // Production Ops (14 Oct 2026): real shapes, abbreviated
    po_drafts:[{id:'DRAFT-1-ABCD',data:{id:'DRAFT-1-ABCD',status:'draft',rev:1,entryDevice:'pc',po:{code:'GST073',qty:120,sizes:{S:20,M:40}},createdAt:1700000000000}}],
    po_cut_jobs:[{id:'PO-1',data:{poId:'PO-1',status:'open',rev:1,plannedCutDate:'2026-10-14',masterName:'Hassan'}}],
    cutting_masters:[{id:'CM-001',data:{name:'Hassan',active:true}}],
    ph_standards:[{id:'GST073',data:{unit:'kg',grossPerPiece:0.42,rev:1}}],
    ph_settings:[{id:'main',data:{dailyCapacity:400,rev:1}}]
  };
}

// A fake SDK: collection(db,name) names the read, getDocs answers from `data`.
// opts: fail{col:Error} · failSync[col] · hang[col] · cache[col] · onRead(col)
function fakeDb(data,opts){
  opts=opts||{};
  const calls={cols:[],getDocs:0,limit:0,query:0,where:0,orderBy:0};
  const saved=[];
  const globals={
    db:{app:{options:{projectId:'groovy-gatepass'}}},
    collection:(d,name)=>{calls.cols.push(name);if(opts.collectionThrows&&opts.collectionThrows.indexOf(name)>-1)throw new Error('collection() blew up');return{__col:name};},
    getDocs:(ref)=>{
      calls.getDocs++;
      const col=ref&&ref.__col;
      if(opts.onRead)opts.onRead(col);
      if(opts.failSync&&opts.failSync.indexOf(col)>-1)throw new Error('sync boom');
      return (async()=>{
        if(opts.fail&&opts.fail[col])throw opts.fail[col];
        if(opts.hang&&opts.hang.indexOf(col)>-1)return new Promise(()=>{});
        const rows=(data[col]||[]);
        return{
          docs:rows.map(r=>({id:r.id,data:()=>r.data,metadata:{hasPendingWrites:!!r.pending}})),
          size:opts.badSize&&opts.badSize[col]!=null?opts.badSize[col]:rows.length,
          metadata:{fromCache:!!(opts.cache&&opts.cache.indexOf(col)>-1)}
        };
      })();
    },
    limit:()=>{calls.limit++;return{};},query:()=>{calls.query++;return{};},where:()=>{calls.where++;return{};},orderBy:()=>{calls.orderBy++;return{};},
    Blob:class{constructor(parts,o){this.text=parts.join('');this.type=o&&o.type;}},
    URL:{createObjectURL:b=>{saved.push(b);return 'blob:fake';},revokeObjectURL(){}}
  };
  if(opts.blobThrows)globals.Blob=class{constructor(){throw new Error('Blob refused');}};
  return{globals,calls,saved};
}
function boot(sessionOpt,fdbOpt,data,extraGlobals){
  const fdb=fakeDb(data||liveStore(),fdbOpt);
  // The harness turns a null `session` option into its default Afnan, so a
  // signed-out caller is set through globals instead.
  const g=Object.assign({},fdb.globals,extraGlobals||{});
  if(sessionOpt===null)g.session=null;
  const app=loadApp({files:['js/prod-backup.js'],session:sessionOpt||undefined,globals:g});
  return Object.assign({app},fdb);
}
const STAGES_G={STAGES:[{label:'Cutting',owner:'Uzaib'}]};
const OWNER_A={uid:'u1',name:'Afnan',u:'afnan',role:'owner',title:'Co-Founder'};
const memStore=()=>{const m={};return{getItem:k=>(k in m?m[k]:null),setItem:(k,v)=>{m[k]=String(v);},_m:m};};
const noWrites=(t)=>t.state.writes.length===0&&t.state.batches.length===0&&t.state.txCount===0&&t.state.plainWriteCount===0;

module.exports=async function(){
  const s=suite('prod-backup');

  /* ── 1. the gate ─────────────────────────────────────────────────── */
  s.section('gate: afnan and ammar by USERNAME, closed without a session');
  {
    const can=(sess)=>{const t=boot(sess);return t.app.run('pbCanUse()');};
    s.eq('afnan may',can(OWNER_A),true);
    s.eq('ammar may',can({u:'ammar',name:'Ammar',role:'owner'}),true);
    s.eq('Mustafa (manager) may not',can({u:'mustafa',name:'Mustafa',role:'manager'}),false);
    s.eq('Uzaib (worker) may not',can({u:'uzaib',name:'Uzaib',role:'worker'}),false);
    s.eq('a third account with the OWNER ROLE may not — it is a username list, not a role',can({u:'sami',name:'Sami',role:'owner'}),false);
    s.eq('a different case is not afnan',can({u:'AFNAN',name:'A',role:'owner'}),false);
    s.eq('a null session fails closed',can(null),false);
    const t=boot(OWNER_A);delete t.app.ctx.session;
    s.eq('no session variable at all fails closed',t.app.run('pbCanUse()'),false);
    s.eq('the allowed list is exactly afnan and ammar',JSON.stringify(boot(OWNER_A).app.run('_PB_USERS')),JSON.stringify(['afnan','ammar']));

    const m=boot({u:'mustafa',name:'Mustafa',role:'manager'});
    const r=await m.app.run('pbRunBackup()');
    s.eq('a refused caller gets reason gate',r.reason,'gate');
    s.eq('…and not a single read was made',m.calls.getDocs,0);
    s.eq('…and no file was saved',m.saved.length,0);
    s.eq('pbOpen refuses a non-owner',m.app.run('window.pbOpen()'),false);
    s.eq('…and puts no modal on the page',m.app.bodyCount('pb-back'),0);
    s.ok('…and says why',m.app.state.toasts.some(x=>/Afnan and Ammar/.test(x)));
    s.eq('pbUsersEntry is empty for a non-owner',m.app.run('pbUsersEntry()'),'');
    const v=await m.app.run('pbVerifyLive({})');
    s.eq('verify refuses a non-owner too',v.reason,'gate');
    s.eq('…without reading',m.calls.getDocs,0);
    const pick=await m.app.run('window.pbVerifyPick({files:[{name:"x.json",text:async()=>"{}"}]})');
    s.eq('the file picker handler refuses a non-owner',pick,false);
    s.eq('…without reading',m.calls.getDocs,0);
    s.ok('pbUsersEntry offers the button to afnan',/pbOpen/.test(boot(OWNER_A).app.run('pbUsersEntry()')));
  }

  /* ── 2. encoding every Firestore value type ──────────────────────── */
  s.section('serialisation: nothing is lost on the way to JSON and back');
  {
    const t=boot(OWNER_A);const run=t.app.run,ctx=t.app.ctx;
    const iso=(sec,n)=>{ctx.__a=[sec,n];return run('pbTsToIso(__a[0],__a[1])');};
    s.eq('a timestamp keeps all nine fractional digits',iso(1700000000,123456789),'2023-11-14T22:13:20.123456789Z');
    s.eq('…one nanosecond is not rounded away',iso(0,1),'1970-01-01T00:00:00.000000001Z');
    s.eq('…before 1970',iso(-1,999999999),'1969-12-31T23:59:59.999999999Z');
    s.eq('…the last second Firestore allows',iso(253402300799,999999999),'9999-12-31T23:59:59.999999999Z');
    s.eq('…the first second Firestore allows',iso(-62135596800,0),'0001-01-01T00:00:00.000000000Z');
    ctx.__i='2023-11-14T22:13:20.123456789Z';
    s.eq('an ISO string parses back to the same seconds',run('pbIsoToTs(__i).seconds'),1700000000);
    s.eq('…and the same nanoseconds',run('pbIsoToTs(__i).nanoseconds'),123456789);
    ctx.__i='1970-01-01T00:00:00.5Z';
    s.eq('a short fraction is padded, not misread (.5 = 500,000,000 ns)',run('pbIsoToTs(__i).nanoseconds'),500000000);
    ctx.__i='not a date';
    s.eq('garbage is refused, not guessed',run('pbIsoToTs(__i)'),null);

    const doc={
      poNumber:'PO-0042',qty:1200,rate:12.5,done:false,note:null,empty:'',unicode:'گیٹ پاس · ₨ 15,000',
      sizes:{S:100,M:200,L:{deep:[1,[2,[3,{x:'y'}]],null]}},
      stages:[{name:'cutting',at:new Ts(1700000000,123456789),log:[new Ts(1,1),new Ts(0,0)]}],
      createdAt:new Ts(1700000000,500000000),early:new Ts(-1000,999999999),
      'dotted.key':{'a.b':new Ts(1700000001,7)},
      loc:new Geo(31.5204,74.3587),ref:new Ref('pos/PO-1'),blob:new Bytes('AAEC'),d:new Date(Date.UTC(2026,9,10,1,2,3,456)),
      weird:{n:NaN,i:Infinity,m:-Infinity,z:-0,big:123456789012345}
    };
    ctx.__doc=doc;
    const enc=run('pbEncodeDoc(__doc)');
    const text=JSON.stringify(enc);
    const back=JSON.parse(text);
    s.eq('a timestamp field is an ISO string with nine digits',back.data.createdAt,'2023-11-14T22:13:20.500000000Z');
    s.eq('a nested timestamp (map in array) is too',back.data.stages[0].at,'2023-11-14T22:13:20.123456789Z');
    s.eq('a timestamp inside an array inside a map',back.data.stages[0].log[0],'1970-01-01T00:00:01.000000001Z');
    s.eq('a negative-seconds timestamp',back.data.early,'1969-12-31T23:43:20.999999999Z');
    s.eq('a key containing a dot is kept as one key',back.data['dotted.key']['a.b'],'2023-11-14T22:13:21.000000007Z');
    s.eq('plain values are untouched: string',back.data.poNumber,'PO-0042');
    s.eq('plain values are untouched: number',back.data.rate,12.5);
    s.eq('plain values are untouched: boolean false',back.data.done,false);
    s.eq('plain values are untouched: null',back.data.note,null);
    s.eq('plain values are untouched: empty string',back.data.empty,'');
    s.eq('plain values are untouched: Urdu and ₨',back.data.unicode,'گیٹ پاس · ₨ 15,000');
    s.eq('nested arrays and maps are kept in place',JSON.stringify(back.data.sizes),JSON.stringify(doc.sizes));
    s.eq('a geopoint is its two numbers',JSON.stringify(back.data.loc),'{"latitude":31.5204,"longitude":74.3587}');
    s.eq('a document reference is its path',back.data.ref,'pos/PO-1');
    s.eq('bytes are base64',back.data.blob,'AAEC');
    s.eq('a Date is ISO',back.data.d,'2026-10-10T01:02:03.456Z');
    s.eq('NaN and the infinities are tagged, not silently null',back.tags.filter(x=>x.p[0]==='weird').map(x=>x.p[1]+':'+x.t).sort().join(','),'i:inf,m:-inf,n:nan,z:negzero');
    const tagFor=(p)=>{const k=JSON.stringify(p);const x=back.tags.find(y=>JSON.stringify(y.p)===k);return x&&x.t;};
    s.eq('the table names a top-level timestamp by exact path',tagFor(['createdAt']),'timestamp');
    s.eq('…a timestamp under array indexes by exact path',tagFor(['stages',0,'log',1]),'timestamp');
    s.eq('…a dotted key as ONE path segment',tagFor(['dotted.key','a.b']),'timestamp');
    s.eq('…a geopoint',tagFor(['loc']),'geopoint');
    s.eq('…a ref',tagFor(['ref']),'ref');
    s.eq('…bytes',tagFor(['blob']),'bytes');

    // the real round trip: through JSON text, with real constructors back
    ctx.__enc=back;ctx.__mk=MAKERS;
    const round=run('pbDecodeDoc(__enc.data,__enc.tags,__mk)');
    s.ok('encode -> JSON text -> decode gives back EXACTLY the original document (types, nesting, -0, NaN, nanoseconds)',same(round,doc));
    ctx.__enc2=run('pbEncodeDoc(__doc)');
    s.ok('…and decoding without constructors still returns the values, tagged',(()=>{ctx.__d0=JSON.parse(JSON.stringify(ctx.__enc2));const r=run('pbDecodeDoc(__d0.data,__d0.tags)');return r.createdAt.__type==='timestamp'&&r.createdAt.seconds===1700000000&&r.createdAt.nanoseconds===500000000&&Number.isNaN(r.weird.n)&&Object.is(r.weird.z,-0);})());

    ctx.__plain={a:1,b:[1,2,{c:'d'}],e:{f:null}};
    const pe=run('pbEncodeDoc(__plain)');
    s.eq('a document with no special values needs no tags',pe.tags.length,0);
    s.eq('an empty/undefined document is an empty map',JSON.stringify(run('pbEncodeDoc(undefined)').data),'{}');

    ctx.__host=JSON.parse('{"__proto__":{"polluted":1},"a":{"__proto__":2}}');
    const he=run('pbEncodeDoc(__host)');
    s.ok('a __proto__ key stays an OWN key in the encoding',Object.keys(he.data).indexOf('__proto__')>-1);
    s.eq('…and nothing reached Object.prototype',({}).polluted,undefined);
    const hb=JSON.parse(JSON.stringify(he));
    ctx.__hb=hb;
    const hd=run('pbDecodeDoc(__hb.data,__hb.tags)');
    s.ok('…and it survives a decode as an own key',Object.prototype.hasOwnProperty.call(hd,'__proto__')&&hd.a&&Object.prototype.hasOwnProperty.call(hd.a,'__proto__'));

    ctx.__w={w:new Weird()};
    const we=run('pbEncodeDoc(__w)');
    s.eq('a class it does not know is TAGGED unknown, not dropped',we.tags.map(x=>x.t).filter(x=>/unknown/.test(x)).join(','),'unknown:Weird');
    s.eq('…its fields are still kept',we.data.w.a,1);
    s.eq('…including a timestamp inside it',we.data.w.b,'1970-01-01T00:00:05.000000006Z');
    const bw=run('pbBuildBackup([{col:"pos",ok:true,docs:[{id:"x",data:__w}]}]).summary');
    s.eq('…and the summary counts the unknown type',JSON.stringify(bw.unusualTypes),'{"pos":{"unknown:Weird":1}}');
  }

  /* ── 3. building the file ────────────────────────────────────────── */
  s.section('the file: collection -> {id: doc}, a summary, a fingerprint per collection');
  {
    const t=boot(OWNER_A);const run=t.app.run,ctx=t.app.ctx;
    const store=liveStore();
    const results=Object.keys(store).map(c=>({col:c,ok:true,docs:store[c].map(r=>({id:r.id,data:r.data}))}));
    ctx.__r=results;
    const b=run('pbBuildBackup(__r,{at:Date.UTC(2026,9,10,9,0,0),by:"afnan",project:"groovy-gatepass"})');
    const bk=b.backup;
    s.eq('format marker',bk.format,'groovy-production-backup');
    s.eq('version',bk.version,1);
    s.eq('created at, as ISO',bk.createdAt,'2026-10-10T09:00:00.000Z');
    s.eq('created by',bk.createdBy,'afnan');
    s.eq('which project',bk.project,'groovy-gatepass');
    s.eq('collections are keyed by name, in the owner\'s list order',Object.keys(bk.collections).join(','),run('PB_COLLECTIONS.join(",")'));
    s.eq('a collection is {docId: document}',Object.keys(bk.collections.pos).join(','),'PO-1,PO-2');
    s.eq('a document holds its fields',bk.collections.pos['PO-1'].qty,500);
    s.eq('total documents',bk.summary.total,Object.keys(store).reduce((n,c)=>n+store[c].length,0));
    s.eq('counts per collection: pos',bk.summary.counts.pos,2);
    s.eq('counts per collection: fabric_movements',bk.summary.counts.fabric_movements,2);
    s.ok('the Production Ops collections are in the file with their documents and a fingerprint each (14 Oct 2026)',
      ['po_drafts','po_cut_jobs','cutting_masters','ph_standards','ph_settings'].every(c=>bk.collections[c]&&Object.keys(bk.collections[c]).length===1&&bk.summary.counts[c]===1&&typeof bk.summary.hashes[c]==='string')
      &&bk.collections.po_cut_jobs['PO-1'].plannedCutDate==='2026-10-14'&&bk.collections.ph_settings.main.dailyCapacity===400);
    s.ok('a fingerprint per read collection',Object.keys(bk.summary.counts).every(c=>typeof bk.summary.hashes[c]==='string'&&bk.summary.hashes[c].length>5));
    s.eq('complete when everything was read',bk.summary.complete,true);
    s.eq('a collection that read fine but holds nothing is LISTED as empty',JSON.stringify(bk.summary.empty),'["returns"]');
    s.ok('…and is present as {} (an honest empty), with count 0',Object.keys(bk.collections.returns).length===0&&bk.summary.counts.returns===0);
    s.eq('no collection is flagged failed',bk.summary.failed.length,0);
    s.ok('a timestamp is an ISO string in place',bk.collections.pos['PO-1'].createdAt==='2023-11-14T22:13:20.123456789Z');
    s.ok('and its path is in the side table',String(JSON.stringify((bk.tags.pos||{})['PO-1'])).indexOf('"createdAt"')>-1);
    s.eq('a document with nothing special has no entry in the table',bk.tags.bundles,undefined);

    const withFail=results.map(r=>r.col==='bundles'?{col:'bundles',ok:false,message:'Missing or insufficient permissions. (permission-denied)'}:r);
    ctx.__r2=withFail;
    const f=run('pbBuildBackup(__r2,{})');
    s.eq('a failed collection is NAMED',f.summary.failed[0].col,'bundles');
    s.ok('…with Firestore\'s own words',/permission-denied/.test(f.summary.failed[0].message));
    s.eq('…is not complete',f.summary.complete,false);
    s.eq('…is ABSENT from the file, never an empty {}',Object.prototype.hasOwnProperty.call(f.backup.collections,'bundles'),false);
    s.ok('…and has no count or fingerprint',f.summary.counts.bundles===undefined&&f.summary.hashes.bundles===undefined);
    s.eq('the other collections are all still there',Object.keys(f.backup.collections).length,N-1);

    ctx.__r3=results.filter(r=>r.col!=='settings');
    const miss=run('pbBuildBackup(__r3,{})').summary;
    s.eq('a collection nobody tried to read is reported, not forgotten',miss.failed.map(x=>x.col+':'+x.message).join(','),'settings:was not read');
    s.eq('…and the backup is not complete',miss.complete,false);

    ctx.__r4=[{col:'pos',ok:true,docs:[{id:'A',data:{a:1}},{id:'A',data:{a:2}}]}];
    const dup=run('pbBuildBackup(__r4,{})').summary;
    s.ok('duplicate ids in a read are a failure, not a silent overwrite',dup.failed.some(x=>x.col==='pos'&&/duplicate/.test(x.message)));

    ctx.__r5=[{col:'pos',ok:true,docs:[{id:'A',data:{a:1},pending:true},{id:'B',data:{a:1}}]}];
    s.eq('documents holding unsent local changes are counted',run('pbBuildBackup(__r5,{}).summary.pendingWrites.pos'),1);
    s.eq('the fingerprint is the same for the same content',run('pbBuildBackup(__r5,{}).summary.hashes.pos'),run('pbBuildBackup(__r5,{}).summary.hashes.pos'));
    ctx.__r6=[{col:'pos',ok:true,docs:[{id:'A',data:{a:2}},{id:'B',data:{a:1}}]}];
    s.ok('…and different when one value differs',run('pbBuildBackup(__r5,{}).summary.hashes.pos')!==run('pbBuildBackup(__r6,{}).summary.hashes.pos'));
    ctx.__r7=[{col:'pos',ok:true,docs:[{id:'B',data:{a:1}},{id:'A',data:{a:1}}]}];
    s.eq('…and the same whatever order the documents arrive in',run('pbBuildBackup(__r5,{}).summary.hashes.pos'),run('pbBuildBackup(__r7,{}).summary.hashes.pos'));
  }

  /* ── 4. the backup end to end, against the fake SDK ──────────────── */
  s.section('the backup run: reads everything, saves one file, writes nothing');
  let goodText='';
  {
    const mem=memStore();
    const t=boot(OWNER_A,{},liveStore(),{localStorage:mem});
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.ok('it finished (did not hang)',r!=='HUNG');
    s.eq('the run is ok and complete',r.ok&&r.complete,true);
    s.eq('every collection in the owner\'s list was read exactly once',t.calls.cols.slice().sort().join(','),t.app.run('PB_COLLECTIONS.slice().sort().join(",")'));
    s.eq('…one read per collection in the list',t.calls.getDocs,N);
    s.eq('no limit() was applied — a whole read, no cap',t.calls.limit,0);
    s.eq('no query/where/orderBy either',t.calls.query+t.calls.where+t.calls.orderBy,0);
    s.eq('exactly one file was saved',t.saved.length,1);
    s.ok('the file is named with the local date and time',/^groovy-production-backup_\d{4}-\d{2}-\d{2}_\d{4}\.json$/.test(r.filename));
    goodText=t.saved[0].text;
    s.eq('it is a JSON download',t.saved[0].type,'application/json');
    const file=JSON.parse(goodText);
    const live=liveStore();
    s.eq('the file holds every collection in the list',Object.keys(file.collections).length,N);
    s.ok('every document of every collection is in the file with the right fields',Object.keys(live).every(c=>live[c].every(row=>{
      const got=file.collections[c][row.id];if(!got)return false;
      t.app.ctx.__row=row.data;const e=t.app.run('pbEncodeDoc(__row)');
      return JSON.stringify(got)===JSON.stringify(e.data);
    })));
    s.ok('and decoding the FILE gives back the live documents exactly',Object.keys(live).every(c=>live[c].every(row=>{
      t.app.ctx.__fd=file.collections[c][row.id];t.app.ctx.__ft=(file.tags[c]&&file.tags[c][row.id])||[];t.app.ctx.__mk=MAKERS;
      return same(t.app.run('pbDecodeDoc(__fd,__ft,__mk)'),row.data);
    })));
    s.eq('summary counts equal the live counts',JSON.stringify(file.summary.counts),JSON.stringify(Object.keys(live).reduce((o,c)=>{o[c]=live[c].length;return o;},{})));
    s.eq('NOTHING was written to Firestore (no set/update/add/delete/transaction/batch)',noWrites(t.app),true);
    s.eq('exactly one app activity row',t.app.state.activity.length,1);
    s.eq('…saying what happened',t.app.state.activity[0].action,'Production data backup');
    s.ok('…with counts, never with data',new RegExp('complete · \\d+ documents in '+N+' collections').test(t.app.state.activity[0].detail)&&!/PO-1|denim|uzaib/.test(t.app.state.activity[0].detail));
    s.ok('the status line says what was saved',new RegExp(N+' of '+N+' collections').test(t.app.el('pb-status').textContent)&&/Backup saved as groovy-production-backup_/.test(t.app.el('pb-status').textContent));
    s.ok('the size is shown in KB for a small file and never as "0 MB"',/\(about \d+ KB\)/.test(t.app.el('pb-status').textContent));
    s.ok('a toast confirms it',t.app.state.toasts.some(x=>/Production backup saved/.test(x)));
    const last=t.app.run('pbLastBackup()');
    s.ok('the last-backup note is stored in localStorage (a convenience)',last&&last.total===file.summary.total&&last.complete===true&&last.byName==='Afnan');
    s.ok('…and says it is only a reminder',/only a reminder/.test(t.app.run('pbLastText(pbLastBackup())')));
    s.ok('Monitor files the new verb under Process, not a misleading bucket',(()=>{
      const m=loadApp({files:['js/activity.js']});
      return m.run('_monitorCategorize("Production data backup").key')==='other';
    })());
  }

  s.section('the backup run: a collection that cannot be read is NAMED, the file says so');
  {
    const denied=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
    const t=boot(OWNER_A,{fail:{bundles:denied}});
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.eq('not complete, not ok',r.ok||r.complete,false);
    s.ok('a partial file is still saved (better than none)',r.saved===true&&t.saved.length===1);
    s.ok('…and its NAME says INCOMPLETE',/_INCOMPLETE\.json$/.test(r.filename));
    s.ok('the message names the collection and the reason',/Could not read: bundles \(Missing or insufficient permissions\. \(permission-denied\)\)/.test(r.message));
    s.ok('…and says INCOMPLETE and what to do',/INCOMPLETE backup saved/.test(r.message)&&/back up again before changing anything/.test(r.message));
    const file=JSON.parse(t.saved[0].text);
    s.eq('the file lists it as failed',file.summary.failed.map(x=>x.col).join(','),'bundles');
    s.eq('…and does not pretend it is empty',Object.prototype.hasOwnProperty.call(file.collections,'bundles'),false);
    s.ok('the activity row says INCOMPLETE and names it',/INCOMPLETE/.test(t.app.state.activity[0].detail)&&/bundles/.test(t.app.state.activity[0].detail));
    s.eq('still nothing written',noWrites(t.app),true);
  }
  {
    const t=boot(OWNER_A,{cache:['pos']});
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.ok('a read answered from the OFFLINE COPY counts as a failure, not data',r.summary.failed.some(f=>f.col==='pos'&&/offline copy/.test(f.message)));
    s.eq('…so pos is not in the file',Object.prototype.hasOwnProperty.call(JSON.parse(t.saved[0].text).collections,'pos'),false);
  }
  {
    const t=boot(OWNER_A,{badSize:{pos:5}});
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.ok('a size that disagrees with the documents is a failure',r.summary.failed.some(f=>f.col==='pos'&&/reported 5 documents but delivered 2/.test(f.message)));
  }
  {
    const t=boot(OWNER_A,{hang:['returns']});
    const t0=Date.now();
    const r=await watchdog(t.app.run('pbRunBackup({timeoutMs:60})'),2500);
    s.ok('a read that never answers is a named timeout, not a hang',r!=='HUNG'&&r.summary&&r.summary.failed.some(f=>f.col==='returns'&&/no answer after/.test(f.message)&&/timeout/.test(f.message)));
    s.ok('…and the other collections still made it',r!=='HUNG'&&Object.keys(r.summary.counts).length===N-1);
    s.ok('…promptly',Date.now()-t0<2500);
    s.eq('the run released its lock afterwards',await t.app.run('pbRunBackup({timeoutMs:60})').then(x=>x.reason!=='busy'),true);
  }
  {
    const t=boot(OWNER_A,{failSync:['pos']});
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.ok('getDocs throwing SYNCHRONOUSLY is contained and named',r!=='HUNG'&&r.summary.failed.some(f=>f.col==='pos'&&/sync boom/.test(f.message)));
    const t2=boot(OWNER_A,{collectionThrows:['gatepasses']});
    const r2=await watchdog(t2.app.run('pbRunBackup()'));
    s.ok('collection() throwing is contained and named',r2!=='HUNG'&&r2.summary.failed.some(f=>f.col==='gatepasses'&&/collection\(\) blew up/.test(f.message)));
  }
  {
    const all={};liveStore();Object.keys(liveStore()).forEach(c=>{all[c]=new Error('down');});
    const t=boot(OWNER_A,{fail:all});
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.eq('when NOTHING can be read, no file is saved at all (an empty file must not pass for a backup)',t.saved.length,0);
    s.ok('…and the message says so',/Nothing could be read, so NO backup file was saved/.test(r.message)&&r.saved===false);
    s.eq('…every collection is named',r.summary.failed.length,N);
    s.ok('…the activity row says NOT saved',/NOT saved/.test(t.app.state.activity[0].detail));
  }
  {
    const t=boot(OWNER_A,{blobThrows:true});
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.ok('a failure to save the file is reported, never thrown',r!=='HUNG'&&r.saved===false&&/could not be saved to this device/.test(r.message));
    s.eq('…and the run is not "ok"',r.ok,false);
  }
  {
    const t=boot(OWNER_A,{},liveStore(),{localStorage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}}});
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.ok('blocked storage (private window) does not break the backup',r.ok===true&&t.saved.length===1);
    const t2=boot(OWNER_A);
    s.eq('no localStorage at all gives "no backup yet"',t2.app.run('pbLastBackup()'),null);
    t2.app.run('window.pbOpen()');
    s.ok('…and the card says so',/No backup has been made from this browser yet/.test(t2.app.el('pb-last').textContent));
  }
  {
    // two presses at once
    const t=boot(OWNER_A);
    const p1=t.app.run('pbRunBackup()');
    const r2=await t.app.run('pbRunBackup()');
    const r1=await p1;
    s.eq('a second press while one is running is refused',r2.reason,'busy');
    s.ok('…and the first still completes',r1.ok===true);
    s.eq('…saving exactly one file',t.saved.length,1);
  }
  {
    // the person signs out while the reads are in flight
    let tt;
    const fdb=fakeDb(liveStore(),{onRead:(col)=>{if(col==='pos')tt.app.ctx.session=null;}});
    const app=loadApp({files:['js/prod-backup.js'],session:OWNER_A,globals:fdb.globals});
    tt=Object.assign({app},fdb);
    const r=await watchdog(app.run('pbRunBackup()'));
    s.ok('a sign-out mid-run does not lose the file',r!=='HUNG'&&r.saved===true&&fdb.saved.length===1);
    s.eq('…and the file still names who asked',fdb.saved[0]&&JSON.parse(fdb.saved[0].text).createdBy,'afnan');
  }
  {
    // an unusual live value is surfaced in the message
    const data=liveStore();data.pos[0].data.odd=new Weird();
    const t=boot(OWNER_A,{},data);
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.ok('an unknown value type is said in the status, not hidden',/value types this file does not know in: pos/.test(r.message));
  }

  s.section('the list: the owner\'s 12 plus the requests, approvals and records beside a job');
  {
    const t=boot(OWNER_A);
    const list=t.app.run('PB_COLLECTIONS.slice()');
    const owners=['pos','bundles','gatepasses','returns','fabricin','fabric_inventory','fabric_movements','fabric_drawstrings','drawstring_moves','printing_jobs','counters','settings'];
    const more=['gatepass_edit_requests','po_issue_requests','po_edit_requests','po_shortfalls','qc_reports','printing_billing','sla_events','article_recipes','color_library','stock_transfers','bstock_items','bstock_cartons','trim_templates','articles'];
    const prodOps=['po_drafts','po_cut_jobs','cutting_masters','ph_standards','ph_settings'];
    s.eq('31 collections (26 + the five Production Ops ones, 14 Oct 2026)',list.length,31);
    s.ok('the five Production Ops collections are all there (drafts, cut jobs, masters, standards, settings)',prodOps.every(c=>list.indexOf(c)>-1));
    s.ok('the original 12 are all still there',owners.every(c=>list.indexOf(c)>-1));
    s.ok('the 14 added after review are all there',more.every(c=>list.indexOf(c)>-1));
    s.ok('no collection is listed twice',new Set(list).size===list.length);
    s.ok('the Store ledger (store_items, store_transactions) is deliberately NOT read',list.indexOf('store_items')<0&&list.indexOf('store_transactions')<0);
    const rules=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
    s.ok('every listed collection has a firestore.rules block (else its read is default-denied)',list.every(c=>new RegExp('match /'+c+'/').test(rules)),list.filter(c=>!new RegExp('match /'+c+'/').test(rules)).join(','));
    const r=await watchdog(t.app.run('pbRunBackup()'));
    s.ok('every one is read with collection(db,name) — one access shape, whatever shape the app itself uses for that collection',r!=='HUNG'&&t.calls.cols.slice().sort().join(',')===list.slice().sort().join(','));
    s.ok('…and each lands in the file with its documents',more.every(c=>Object.keys(JSON.parse(t.saved[0].text).collections[c]).length>=1));
  }

  s.section('documents holding unsent local changes are named, through the real read path');
  {
    const data=liveStore();
    data.pos[1].pending=true;data.gatepasses[0].pending=true;data.articles[0].pending=true;
    const t=boot(OWNER_A,{},data);
    const r=await watchdog(t.app.run('pbRunBackup()'));
    const sm=r!=='HUNG'&&r.summary;
    s.eq('the summary counts them per collection',JSON.stringify(sm&&sm.pendingWrites),JSON.stringify({pos:1,gatepasses:1,articles:1}));
    s.eq('…and names the documents',JSON.stringify(sm&&sm.pendingIds),JSON.stringify({pos:['PO-2'],gatepasses:['GP-1'],articles:['GST073']}));
    s.ok('…and the status message says so, with the ids',/not yet sent to the server in: pos \(1: PO-2\), gatepasses \(1: GP-1\), articles \(1: GST073\)/.test(r.message||''));
    const file=JSON.parse(t.saved[0].text);
    s.eq('…and the file itself carries it',JSON.stringify(file.summary.pendingWrites),JSON.stringify({pos:1,gatepasses:1,articles:1}));
    s.ok('they are still IN the backup (the local copy is the newest)',file.collections.pos['PO-2']&&file.collections.gatepasses['GP-1']);
    const clean=boot(OWNER_A);
    const rc=await watchdog(clean.app.run('pbRunBackup()'));
    s.eq('a clean read reports none',JSON.stringify(rc.summary.pendingWrites),'{}');
    s.ok('…and says nothing about it',!/not yet sent/.test(rc.message));
  }

  /* ── 5. verifying a backup file against live data ────────────────── */
  s.section('verify: counts, new / gone / changed documents, read-only');
  {
    const file=()=>JSON.parse(goodText);
    // same data live -> identical
    let t=boot(OWNER_A);
    t.app.ctx.__file=file();
    let v=await watchdog(t.app.run('pbVerifyLive(__file)'));
    s.ok('it finished (did not hang)',v!=='HUNG');
    s.eq('an untouched backup is identical to live',v.identical,true);
    s.eq('…the file is intact',v.intact,true);
    s.eq('…every row is "identical"',v.rows.filter(r=>r.status==='identical').length,N);
    s.eq('each row carries the file count and the live count',v.rows.find(r=>r.col==='pos').inFile+'/'+v.rows.find(r=>r.col==='pos').live,'2/2');
    t.app.ctx.__vv=v;
    s.ok('pbVerifyText: intact + identical',/The file is intact/.test(t.app.run('pbVerifyText(__vv)'))&&/Live data is identical/.test(t.app.run('pbVerifyText(__vv)')));
    s.eq('verification reads exactly the listed collections once',t.calls.getDocs,N);
    s.eq('…and writes nothing at all',noWrites(t.app),true);
    s.eq('…not even an activity row',t.app.state.activity.length,0);

    // live has moved on
    const moved=liveStore();
    moved.pos.push({id:'PO-3',data:{poNumber:'PO-3'}});                       // new since the backup
    moved.bundles=moved.bundles.filter(r=>r.id!=='B-2');                      // gone since
    moved.gatepasses[0].data.items[1].q=99;                                   // nested change
    moved.printing_jobs[0].data.stageHistory[0].at=new Ts(1700000400,10);     // one nanosecond different
    moved.pos[1].data={history:[{by:'uzaib',at:new Ts(1700000200,5)},{by:'alam',at:new Ts(1700000300,6)}],createdAt:new Ts(1700000100,0),qty:80,poNumber:'PO-2'}; // same content, fields in another order
    t=boot(OWNER_A,{},moved);t.app.ctx.__file=file();
    v=await watchdog(t.app.run('pbVerifyLive(__file)'));
    const row=c=>v.rows.find(r=>r.col===c);
    s.eq('not identical once work has happened',v.identical,false);
    s.eq('a new document is found',JSON.stringify(row('pos').onlyLive),'["PO-3"]');
    s.eq('…counted',row('pos').n.onlyLive,1);
    s.eq('a document gone since the backup is found',JSON.stringify(row('bundles').onlyFile),'["B-2"]');
    s.eq('a nested change is found',JSON.stringify(row('gatepasses').changed),'["GP-1"]');
    s.eq('a ONE-NANOSECOND timestamp change is found',JSON.stringify(row('printing_jobs').changed),'["PJ-1"]');
    s.eq('a different field ORDER with the same content is not a change',row('pos').n.changed,0);
    s.eq('untouched collections stay identical',row('fabricin').status,'identical');
    t.app.ctx.__vv=v;
    const txt=t.app.run('pbVerifyText(__vv)');
    s.ok('the text lists the collections that differ, with counts',/pos \(1 new, 0 gone, 0 changed\)/.test(txt)&&/bundles \(0 new, 1 gone, 0 changed\)/.test(txt));
    s.ok('…and tells the owner what to look at',/GONE or CHANGED/.test(txt));
    s.eq('still nothing written',noWrites(t.app),true);

    // a live collection that cannot be read is NOT compared and is named
    t=boot(OWNER_A,{fail:{returns:new Error('quota')}});t.app.ctx.__file=file();
    v=await watchdog(t.app.run('pbVerifyLive(__file)'));
    s.eq('an unreadable live collection is "unread"',v.rows.find(r=>r.col==='returns').status,'unread');
    s.eq('…so the whole is not "identical"',v.identical,false);
    s.eq('…and allRead is false',v.allRead,false);
    t.app.ctx.__vv=v;
    s.ok('…the text names it and says it was not compared',/Could not read live: returns \(quota\)/.test(t.app.run('pbVerifyText(__vv)'))&&/NOT compared/.test(t.app.run('pbVerifyText(__vv)')));

    // the file itself
    const check=(mut)=>{const f=file();mut(f);t.app.ctx.__f=f;return t.app.run('pbCheckFile(__f)');};
    s.eq('an intact file passes its own check',check(()=>{}).ok,true);
    let c=check(f=>{f.collections.pos['PO-1'].qty=501;});
    s.ok('a value edited after the backup fails the fingerprint, naming the collection',!c.ok&&c.problems.some(p=>/^pos: the content does not match the fingerprint/.test(p)));
    c=check(f=>{delete f.collections.pos['PO-2'];});
    s.ok('a document removed from the file is a count mismatch ("cut short or edited")',c.problems.some(p=>/^pos: the file holds 1 documents but its summary says 2/.test(p)));
    c=check(f=>{f.format='something-else';});
    s.ok('another format is refused',c.problems.some(p=>/not a Groovy production backup/.test(p)));
    c=check(f=>{f.version=2;});
    s.ok('a newer version is named, not misread',c.problems.some(p=>/format version 2/.test(p)));
    c=check(f=>{delete f.collections;});
    s.ok('a file with no collections is refused',c.problems.some(p=>/no "collections" section/.test(p)));
    c=check(f=>{f.summary.total=1;});
    s.ok('a wrong grand total is caught',c.problems.some(p=>/in all but its summary says 1/.test(p)));
    c=check(f=>{f.collections.extra={a:{}};});
    s.ok('a collection the summary never listed is caught',c.problems.some(p=>/^extra:/.test(p)));
    s.eq('a non-object is not a backup',t.app.run('pbCheckFile([1,2]).ok'),false);
    s.eq('null is not a backup',t.app.run('pbCheckFile(null).ok'),false);

    // a damaged file is reported, and not-a-backup costs no live reads
    t=boot(OWNER_A);t.app.ctx.__bad={hello:'world'};
    v=await watchdog(t.app.run('pbVerifyLive(__bad)'));
    s.ok('a random JSON file is refused',v.ok===false&&v.reason==='notabackup'&&/not a Groovy production backup/.test(v.message));
    s.eq('…and NO live reads were spent on it',t.calls.getDocs,0);
    t=boot(OWNER_A);const tam=file();tam.collections.counters.main.pos=999;t.app.ctx.__file=tam;
    v=await watchdog(t.app.run('pbVerifyLive(__file)'));
    s.ok('a tampered file is reported intact:false with its problem first in the text',v.intact===false&&/PROBLEM WITH THE FILE ITSELF: counters: the content does not match the fingerprint/.test((t.app.ctx.__vv=v,t.app.run('pbVerifyText(__vv)'))));

    // an incomplete backup stays visibly incomplete when verified
    const denied=Object.assign(new Error('denied'),{code:'permission-denied'});
    const ti=boot(OWNER_A,{fail:{bundles:denied}});await ti.app.run('pbRunBackup()');
    t=boot(OWNER_A);t.app.ctx.__file=JSON.parse(ti.saved[0].text);
    v=await watchdog(t.app.run('pbVerifyLive(__file)'));
    s.eq('an INCOMPLETE backup is never reported identical',v.identical,false);
    s.eq('…its missing collection is "notInFile"',v.rows.find(r=>r.col==='bundles').status,'notInFile');
    t.app.ctx.__vv=v;
    s.ok('…the text says it was incomplete when made',/The backup was INCOMPLETE when it was made: bundles/.test(t.app.run('pbVerifyText(__vv)')));

    // incomplete for a collection this build does not even list: still never "identical"
    t=boot(OWNER_A);const odd=file();odd.summary.failed=[{col:'collection_added_later',message:'permission-denied'}];t.app.ctx.__file=odd;
    v=await watchdog(t.app.run('pbVerifyLive(__file)'));
    s.ok('every collection this build checks is identical, yet an incomplete file is NOT called identical',v.rows.every(r=>r.status==='identical')&&v.identical===false);
    t.app.ctx.__vv=v;
    s.ok('…and the text names what was missing',/INCOMPLETE when it was made: collection_added_later/.test(t.app.run('pbVerifyText(__vv)')));

    // a file collection this build does not check is listed, never read
    t=boot(OWNER_A);const ex=file();
    const exAdd=JSON.parse(JSON.stringify(ex));exAdd.collections.mystery={a:{x:1}};exAdd.summary.counts.mystery=1;exAdd.summary.total+=1;
    t.app.ctx.__e=exAdd;exAdd.summary.hashes.mystery=t.app.run('pbHash(pbCanon({d:__e.collections.mystery,t:{}}))');
    v=await watchdog(t.app.run('pbVerifyLive(__e)'));
    s.eq('a collection the file holds but the build does not check is "notChecked"',v.rows.find(r=>r.col==='mystery').status,'notChecked');
    s.ok('…and was never read live (a file cannot make the app read arbitrary collections)',t.calls.cols.indexOf('mystery')<0);

    // parse
    t=boot(OWNER_A);
    s.eq('valid JSON parses',t.app.run('pbParseBackupText("{\\"a\\":1}").ok'),true);
    const pr=t.app.run('pbParseBackupText("{\\"a\\":")');
    s.ok('cut-off JSON is reported as possibly cut short',pr.ok===false&&/not valid JSON/.test(pr.message)&&/cut short/.test(pr.message));

    // the file picker, end to end
    t=boot(OWNER_A);
    const input={files:[{name:'groovy-production-backup_x.json',text:async()=>goodText}],value:'C:\\fakepath\\x.json'};
    t.app.ctx.__input=input;
    const pick=await watchdog(t.app.run('window.pbVerifyPick(__input)'));
    s.ok('the picker verifies the chosen file',pick!=='HUNG'&&pick&&pick.identical===true);
    s.eq('…and clears the input so the same file can be chosen again',input.value,'');
    s.ok('…the message is painted',/Live data is identical/.test(t.app.el('pb-verify-msg').textContent));
    const cells=walk(t.app.el('pb-verify-table'));
    s.ok('…and a table row per collection with the collection name',t.app.run('PB_COLLECTIONS').every(c=>cells.indexOf(c)>-1));
    s.ok('…and "Identical" in the result column',cells.filter(x=>x==='Identical').length===N);
    t=boot(OWNER_A);
    const badIn={files:[{name:'broken.json',text:async()=>'{"format":'}],value:'x'};
    t.app.ctx.__input=badIn;
    const pickBad=await watchdog(t.app.run('window.pbVerifyPick(__input)'));
    s.eq('a broken file returns false',pickBad,false);
    s.ok('…and says it may have been cut short',/may have been cut short/.test(t.app.el('pb-verify-msg').textContent));
    s.eq('…without reading live data',t.calls.getDocs,0);
  }

  /* ── 6. the card, the entry, the wiring ──────────────────────────── */
  s.section('the card and where it is reachable');
  {
    const mem=memStore();
    mem.setItem('groovy-pb-last',JSON.stringify({at:Date.UTC(2026,9,10,9,5),by:'afnan',byName:'<img src=x onerror=alert(1)>',complete:false,total:1234,collections:11,failed:['bundles']}));
    const t=boot(OWNER_A,{},liveStore(),{localStorage:mem});
    s.eq('pbOpen opens for an owner',t.app.run('window.pbOpen()'),true);
    const html=t.app.bodyHtml('pb-back');
    s.ok('the card has the button',/Back up production data/.test(html)&&/pbBackupNow/.test(html));
    s.ok('…the verify control',/pbVerifyPick/.test(html)&&/Check a backup file/.test(html));
    s.ok('…and lists every collection it covers',t.app.run('PB_COLLECTIONS').every(c=>html.indexOf(c)>-1));
    s.ok('…and says it is read-only',/Read-only/.test(html));
    s.ok('…advises running it on a computer',/Run this on a computer/.test(html));
    s.ok('…and says the file is business data that must be kept private',/contains business data and must be kept private/.test(html));
    s.ok('…and lists the added collections too',t.app.run('PB_COLLECTIONS').length===31&&/articles/.test(html)&&/gatepass_edit_requests/.test(html));
    s.ok('…and carries no literal colour (tokens only)',!/#[0-9a-fA-F]{3,8}\b/.test(html)&&!/rgba?\(/.test(html));
    s.ok('a stored note is NEVER put into markup (a hostile one stays text)',html.indexOf('<img')<0&&html.indexOf('onerror')<0);
    const note=t.app.el('pb-last').textContent;
    s.ok('…it is painted with textContent, as text',note.indexOf('<img src=x onerror=alert(1)>')>-1);
    s.ok('…and says INCOMPLETE with what could not be read',/INCOMPLETE \(could not read bundles\)/.test(note)&&/1,234 documents in 11 collections/.test(note)&&/10 Oct 2026, 09:05/.test(note));
    t.app.run('window.pbClose()');
    s.eq('Close removes the modal',t.app.bodyCount('pb-back'),0);
    t.app.run('window.pbOpen();window.pbOpen()');
    s.eq('opening twice never stacks two modals',t.app.bodyCount('pb-back'),1);
  }
  {
    s.ok('Users page: the entry point exists for an owner',/Production data/.test(boot(OWNER_A).app.run('pbUsersEntry()'))&&/window\.pbOpen\(\)/.test(boot(OWNER_A).app.run('pbUsersEntry()')));
    const auth=fs.readFileSync(path.join(ROOT,'js/auth.js'),'utf8');
    s.ok('renderUsers calls it behind typeof (a build without the module renders as before)',/\$\{typeof pbUsersEntry==='function'\?pbUsersEntry\(\):''\}/.test(auth));
    s.eq('…and it is the ONLY mention of the module in js/auth.js',(auth.match(/pbUsersEntry|prod-backup|pbOpen/g)||[]).length,2);
    let renders=null;
    try{
      const a=loadApp({files:['js/auth.js','js/prod-backup.js'],session:OWNER_A,globals:STAGES_G});
      renders=a.run('renderUsers()');
      const b=loadApp({files:['js/auth.js','js/prod-backup.js'],session:{u:'sami',name:'Sami',role:'owner',title:'x'},globals:STAGES_G});
      s.ok('renderUsers (real js/auth.js) shows the entry to afnan',/Production data/.test(renders));
      s.ok('…and not to another owner-role account',!/Production data/.test(b.run('renderUsers()')));
      const c=loadApp({files:['js/auth.js'],session:OWNER_A,globals:STAGES_G});
      s.ok('…and renders fine when the module is not loaded at all',/User accounts/.test(c.run('renderUsers()'))&&!/Production data/.test(c.run('renderUsers()')));
    }catch(e){s.ok('renderUsers could be driven in the harness',false,String(e&&e.message||e));}
  }
  s.section('wiring: registered in the three places, no global collisions');
  {
    const idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
    const tag=idx.indexOf('<script src="/js/prod-backup.js');
    s.ok('index.html loads it',tag>-1);
    s.ok('…after master-accounts.js (late in the load order)',tag>idx.indexOf('/js/master-accounts.js'));
    s.ok('…and before the Firebase bootstrap module',tag<idx.indexOf('<script type="module">'));
    const sw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
    s.ok('sw.js precaches it',/PRECACHE_URLS[\s\S]*'\/js\/prod-backup\.js'/.test(sw));
    const code=SRC.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    const tops=[...code.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m=>m[1]||m[2]);
    s.ok('every top-level name is pb / _pb / PB_ / _PB_ prefixed (classic scripts share one scope)',tops.length>20&&tops.every(n=>/^(?:_?pb|_?PB_)/.test(n)),tops.filter(n=>!/^(?:_?pb|_?PB_)/.test(n)).join(','));
    const handlers=[...code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m=>m[1]);
    s.ok('window handlers exist',handlers.length>=4);
    s.ok('no window.X= handler shares a name with a top-level function (in a browser those are ONE binding)',handlers.every(h=>tops.indexOf(h)<0),handlers.filter(h=>tops.indexOf(h)>-1).join(','));
    const others=fs.readdirSync(path.join(ROOT,'js')).filter(f=>f.endsWith('.js')&&f!=='prod-backup.js');
    const clash=[];
    others.forEach(f=>{
      const x=fs.readFileSync(path.join(ROOT,'js',f),'utf8');
      for(const m of x.matchAll(/^(?:async\s+)?function\s+(_?(?:pb|PB_)[\w$]*)|^(?:const|let|var)\s+(_?(?:pb|PB_)[\w$]*)/gm))clash.push(f+':'+(m[1]||m[2]));
    });
    s.eq('no other script declares a pb / PB_ top-level name',clash.join(','),'');
    const exposed=new Set(tops);
    s.ok('none of this file\'s top-level names is declared in another script',others.every(f=>{
      const x=fs.readFileSync(path.join(ROOT,'js',f),'utf8');
      return [...exposed].every(n=>!new RegExp('^(?:async\\s+)?function\\s+'+n.replace(/\$/g,'\\$')+'\\b|^(?:const|let|var)\\s+'+n.replace(/\$/g,'\\$')+'\\b','m').test(x));
    }));
  }

  /* ── 7. the source holds the read-only promise ───────────────────── */
  s.section('source invariants: it cannot write, cannot cap, cannot use UTC for a day');
  {
    const code=SRC.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    const named=['setDoc','updateDoc','addDoc','deleteDoc','runTransaction','writeBatch'].filter(n=>new RegExp('\\b'+n+'\\b').test(code));
    s.eq('the code never names a Firestore write function',named.join(','),'');
    s.ok('no limit() / query() / where() / startAfter — a whole read, nothing to cap or filter',!/\b(?:limit|query|where|orderBy|startAfter|startAt)\s*\(/.test(code));
    s.ok('no toISOString().slice for a day (UTC names yesterday before 5am in PKT)',!/toISOString\(\)\.slice\(0\s*,\s*10\)/.test(code));
    s.ok('no literal colour anywhere in the module',!/#[0-9a-fA-F]{3,8}\b/.test(code.replace(/'#[^']*'/g,m=>/^'#[0-9a-fA-F]+'$/.test(m)?m:'')));
    s.ok('the only network call is getDocs (a read)',(code.match(/\b(?:getDocs|getDoc|fetch|XMLHttpRequest)\s*\(/g)||[]).every(x=>/getDocs/.test(x)));
    s.ok('every handler that touches data checks the gate first',/pbRunBackup\(opts\)\{[\s\S]{0,200}if\(!pbCanUse\(\)\)/.test(code)&&/pbVerifyLive\(backup,opts\)\{[\s\S]{0,80}if\(!pbCanUse\(\)\)/.test(code)&&/window\.pbVerifyPick=async function\(input\)\{\s*if\(!pbCanUse\(\)\)/.test(code)&&/window\.pbOpen=function\(\)\{\s*if\(!pbCanUse\(\)\)/.test(code));
  }

  return s;
};

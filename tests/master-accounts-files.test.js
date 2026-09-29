/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts M1.5b — files, share links, backups and the owners' copy
   (js/master-accounts.js + js/ma-core.js, wired to M1.5a's functions).

   The client is DRIVEN against the REAL function handlers
   (netlify/functions/ma-attach.js and ma-share.js, firebase-admin replaced
   by tests/ma-fake-admin.js) and a fake Cloudinary that checks the upload's
   signature with a signer written again here — so what is held is the
   contract end to end: the browser sends Cloudinary exactly the fields the
   function signed; the reference stored on a document carries no URL; the
   link the page shows is the one the function serves; a withdrawal writes
   its audit row because it went through the function.

   What this cannot prove: that the live Cloudinary account takes the
   upload, what a phone's camera hands the picker, or how WhatsApp treats
   the link — the sandbox reaches none of them.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const crypto=require('crypto');
const harness=require('./harness');
const {suite,ROOT}=harness;
const {loadFn,TOKENS,FAKE_SA,withEnv}=require('./ma-fake-admin');
const M=require('../js/ma-core.js');
const J=v=>JSON.stringify(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const tick=(ms)=>new Promise(r=>setTimeout(r,ms||5));
// File is a global from Node 20; buffer.File is there from 18.13 (CI runs 20).
const File=globalThis.File||require('buffer').File;

const SECRET='test-secret-not-real-9Kq';
const KEY='123450987612345';
const SIGNED_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:KEY,CLOUDINARY_API_SECRET:SECRET,CLOUDINARY_CLOUD_NAME:undefined};
const UNSIGNED_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:undefined,CLOUDINARY_API_SECRET:undefined,CLOUDINARY_CLOUD_NAME:undefined,MA_ALLOW_PUBLIC_ATTACH:'1'};
// M1.6c: no key and no opt-in — attachments are switched off.
const NOKEY_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:undefined,CLOUDINARY_API_SECRET:undefined,CLOUDINARY_CLOUD_NAME:undefined,MA_ALLOW_PUBLIC_ATTACH:undefined};
// …and a server that cannot start at all: the generic 503 carries the same
// code, not_configured, but no status body.
const NOSA_ENV={FIREBASE_SERVICE_ACCOUNT:undefined,CLOUDINARY_API_KEY:KEY,CLOUDINARY_API_SECRET:SECRET,CLOUDINARY_CLOUD_NAME:undefined,MA_ALLOW_PUBLIC_ATTACH:undefined};
const AFNAN={uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};
const PID='ma/'+'0123456789abcdef'.repeat(4);

// Cloudinary's signature, written again from its documentation.
const UNSIGNED=['file','api_key','resource_type','cloud_name','signature'];
function indepSig(p,secret){
  const keys=Object.keys(p).filter(k=>!UNSIGNED.includes(k)&&p[k]!==undefined&&p[k]!==null&&p[k]!=='').sort();
  return crypto.createHash('sha1').update(keys.map(k=>k+'='+String(p[k])).map(x=>x.split('&').join('%26')).join('&')+secret).digest('hex');
}

/* ── a small book, built by the core ─────────────────────────────────── */
const S=M.maSettings(null);
const IDX=M.maChartIndex(M.maChart('groovy',[]));
const T0=Date.UTC(2026,6,2,6);
function built(dt,input,no,extra){
  const d=M.maBuildDoc(dt,input,{by:'afnan',byName:'Afnan',ts:T0+(Number(no.slice(-2))||1)*60000},IDX,S);
  d.no=no;d.id=no;return Object.assign(d,extra||{});
}
function seedBook(){
  const party={id:'p1',kind:'vendor',name:'Asghar Printers',code:'ASG',active:true,contact:{person:'Asghar',phone:'0300-1234567'},vendor:{roles:['printing'],tax:{regime:'none'},terms:{mode:'cash',from:'2026-07-01'},termsHistory:[],rateCard:[]}};
  const cap=built('journal',{kind:'capital',date:'2026-07-02',holder:'1011',owner:'afnan',amount:300000},'JV-27-0001');
  // costCentre is set, as on every document the form records (its select has no blank option).
  const out=built('journal',{kind:'money_out',date:'2026-07-05',holder:'1011',account:'5030',party:'p1',partyKind:'vendor',amount:20000,tax:{kind:'none'},costCentre:'factory',note:'Printing'},'JV-27-0002',
    {flags:[{rule:'evidence.missing',message:'No bill or receipt attached (₨20,000).',field:'attachments'}]});
  const vd=M.maApplyVoid(built('journal',{kind:'money_out',date:'2026-07-06',holder:'1011',account:'6050',payee:'Plumber',amount:1500,tax:{kind:'none'}},'JV-27-0003'),{at:T0,by:'afnan',byName:'Afnan',reason:'Entered twice'});
  const tr=built('transfer',{date:'2026-07-07',from:'1011',to:'1012',amount:50000,note:'Float'},'TR-27-0001');
  const withFile=built('journal',{kind:'money_out',date:'2026-07-08',holder:'1011',account:'6070',payee:'Stationers',amount:2500,tax:{kind:'none'},
    attachments:[{publicId:PID,format:'pdf',type:'authenticated',name:'stationery-bill.pdf',mime:'application/pdf',bytes:204800,by:'afnan',at:T0}]},'JV-27-0004');
  return {ma_parties:{p1:party},ma_journal:{[cap.no]:cap,[out.no]:out,[vd.no]:vd,[withFile.no]:withFile},ma_transfer:{[tr.no]:tr},
    ma_counters:{journal:{FY27:4},transfer:{FY27:1}},ma_settings:{main:{payDays:[3,6],share:{defaultDays:7}}}};
}

/* ── the world: the page, the two real functions, a fake Cloudinary ───── */
function mkWorld(o){
  o=o||{};
  const st={tokens:TOKENS,docs:{}};                        // the server's Firestore
  const attach=loadFn('netlify/functions/ma-attach.js',st);
  const share=loadFn('netlify/functions/ma-share.js',st);
  const W={st,attach,share,calls:[],uploads:[],prints:[],opened:[],clip:[],xlsx:[],saved:[],clicks:[],tx:[],sets:[],
    cloud:{refuse:null,folder:'',answerPid:null,format:null,resourceType:null},db:clone(o.seed||seedBook()),token:o.token||'t_afnan',failCols:o.failCols||[],netDown:false};
  const col=c=>(W.db[c]=W.db[c]||{});
  async function viaFn(fn,init){
    const headers={};Object.keys(init.headers||{}).forEach(k=>{headers[k.toLowerCase()]=init.headers[k];});
    const r=await fn._handle({httpMethod:init.method||'GET',headers,body:init.body,isBase64Encoded:false},Date.now());
    return {ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,json:async()=>JSON.parse(r.body)};
  }
  async function cloud(url,init){
    const fd=init&&init.body;
    const fields={};let file=null;const keys=[];
    for(const [k,v] of fd.entries()){keys.push(k);if(k==='file')file=v;else fields[k]=v;}
    W.uploads.push({url,keys,fields,file:file?{name:file.name,size:file.size,type:file.type}:null});
    const bad=(status,message)=>({ok:false,status,json:async()=>({error:{message}})});
    if(W.cloud.refuse)return bad(W.cloud.refuse.status||400,W.cloud.refuse.message);
    if(!file)return bad(400,'Missing required parameter - file');
    let type='upload';
    if(fields.signature!==undefined){
      if(indepSig(fields,SECRET)!==fields.signature)return bad(401,'Invalid Signature '+fields.signature+'. String to sign - '+Object.keys(fields).sort().join(','));
      if(Math.abs(Number(fields.timestamp)*1000-Date.now())>3600000)return bad(400,'Stale request - reported time is older than 1 hour');
      type=fields.type||'upload';
    }else if(fields.upload_preset!=='groovy-ops')return bad(400,'Upload preset must be specified when using unsigned upload');
    const ext=((/\.([A-Za-z0-9]+)$/.exec(file.name||'')||[])[1]||'').toLowerCase();
    const fmt=W.cloud.format||(file.type==='application/pdf'?'pdf':ext==='jpeg'?'jpg':ext);
    const pid=W.cloud.answerPid||(W.cloud.folder?W.cloud.folder+'/':'')+fields.public_id;
    const ver=1790000000+W.uploads.length;
    const at='https://res.cloudinary.com/deww4lpym/image/'+type+'/v'+ver+'/'+pid+'.'+fmt;
    return {ok:true,status:200,json:async()=>({asset_id:'a'+ver,public_id:pid,version:ver,format:fmt,resource_type:W.cloud.resourceType||'image',type,bytes:file.size,
      url:at.replace('https:','http:'),secure_url:at,original_filename:'x',signature:'s',etag:'e'})};
  }
  async function fetchImpl(url,init){
    url=String(url);init=init||{};
    W.calls.push({url,method:init.method,auth:(init.headers||{}).Authorization||'',body:typeof init.body==='string'?JSON.parse(init.body):null});
    if(W.netDown)throw new TypeError('Failed to fetch');
    if(url==='/.netlify/functions/ma-attach')return viaFn(attach,init);
    if(url==='/.netlify/functions/ma-share')return viaFn(share,init);
    if(/^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/image\/upload$/.test(url))return cloud(url,init);
    throw new Error('unexpected fetch '+url);
  }
  const globals={
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    FormData,Blob,
    URL:{createObjectURL:b=>{W.saved.push(b);return 'blob:groovy/'+W.saved.length;},revokeObjectURL(){}},
    setTimeout:(fn,ms)=>ms>=60000?0:setTimeout(fn,ms),
    fetch:fetchImpl,
    doc:(_db,c,id)=>({col:c,id}),
    collection:(_db,c)=>({col:c}),
    query:(c,...cl)=>({col:c.col,where:cl.filter(x=>x&&x.op)}),
    where:(f,op,v)=>({f,op,v}),
    orderBy:()=>({}),limit:()=>({}),
    getDocs:async q=>{
      if(W.failCols.indexOf(q.col)>=0)throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      let rows=q.col==='ma_shares'
        ?Object.keys(st.docs).filter(k=>k.indexOf('ma_shares/')===0).map(k=>({id:k.slice(10),d:st.docs[k]}))
        :Object.keys(col(q.col)).map(id=>({id,d:col(q.col)[id]}));
      (q.where||[]).forEach(w=>{rows=rows.filter(r=>w.op==='=='&&r.d[w.f]===w.v);});
      W.lastQuery=q;
      return {docs:rows.map(r=>({id:r.id,data:()=>clone(r.d)}))};
    },
    runTransaction:async(_db,fn)=>{
      const ops=[];W.tx.push(ops);
      await fn({get:async ref=>{const d=col(ref.col)[ref.id];return {exists:()=>d!==undefined,data:()=>clone(d===undefined?{}:d)};},
        set:(ref,d)=>{ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},
        update:(ref,d)=>{ops.push({op:'update',col:ref.col,id:ref.id,data:clone(d)});}});
      ops.forEach(x=>{if(x.op==='set')col(x.col)[x.id]=clone(x.data);else col(x.col)[x.id]=Object.assign({},col(x.col)[x.id],clone(x.data));});
    },
    writeBatch:()=>{const ops=[];return {set(ref,d){ops.push({col:ref.col,id:ref.id,data:clone(d)});},async commit(){ops.forEach(x=>{col(x.col)[x.id]=clone(x.data);W.sets.push(x);});}};},
    setDoc:async(ref,d)=>{W.sets.push({col:ref.col,id:ref.id,data:clone(d)});col(ref.col)[ref.id]=clone(d);},
    auth:{currentUser:o.signedOut?null:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date().toUTCString()},getIdToken:async()=>W.token}},
    printDocument:async p=>{W.prints.push(clone(Object.assign({},p,{data:undefined}))||{});if(W.printFail)throw new Error(W.printFail);
      return p.deliver==='blob'?{blob:new Blob(['%PDF-1.4 '+p.type+' '+'x'.repeat(2048)],{type:'application/pdf'}),filename:p.filename}:undefined;},
    XLSX:{utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(wb,ws,name)=>{wb.sheets.push({name,rows:ws.rows});}},writeFile:(wb,name)=>{W.xlsx.push({name,sheets:wb.sheets});}}
  };
  const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:o.page||'ma-ledger',session:o.session||AFNAN,globals});
  app.ctx.window.open=()=>{
    const w={closed:false,opener:{},location:{href:''},document:{title:'',body:{textContent:''}},close(){this.closed=true;}};
    W.opened.push(w);return W.popupBlocked?null:w;
  };
  app.ctx.navigator.clipboard={writeText:async t=>{if(W.clipFail)throw new Error('denied');W.clip.push(t);}};
  const mk=app.ctx.document.createElement;
  app.ctx.document.createElement=function(t){const n=mk.call(app.ctx.document,t);if(String(t).toLowerCase()==='a')n.click=function(){W.clicks.push({href:n.href,download:n.download});};return n;};
  W.app=app;W.toasts=app.state.toasts;
  W.file=(name,type,size)=>new File([Buffer.alloc(size||2048,7)],name,{type});
  // A file input with files in it, handed to the page's own handler.
  W.pick=(files,where)=>{app.ctx.__files=files;return app.run('window.maAttachPicked({files:__files,value:"C:\\\\fakepath\\\\x"},'+J(where)+')');};
  // What a browser does with the modal's markup: every input, select and
  // textarea starts with the value the page wrote into it. The harness keeps
  // an element's value apart from the HTML string, so a test that reads a
  // form without this reads '' everywhere.
  W.fill=()=>{
    const html=app.bodyHtml('ma-modal-back');
    const un=v=>String(v).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    const at=(a,n)=>{const m=new RegExp('(?:^|\\s)'+n+'="([^"]*)"').exec(a);return m?m[1]:null;};
    let m;
    const inRe=/<input\b([^>]*)>/g;
    while((m=inRe.exec(html))){
      const id=at(m[1],'id');if(!id)continue;
      const type=at(m[1],'type')||'text';
      if(type==='file')continue;
      if(type==='checkbox'||type==='radio'){app.el(id).checked=/\schecked(?:\s|$|=)/.test(m[1]);continue;}
      app.el(id).value=un(at(m[1],'value')||'');
    }
    const selRe=/<select\b([^>]*)>([\s\S]*?)<\/select>/g;
    while((m=selRe.exec(html))){
      const id=at(m[1],'id');if(!id)continue;
      const opts=[];let o;const oRe=/<option\b([^>]*)>/g;
      while((o=oRe.exec(m[2])))opts.push({v:un(at(o[1],'value')||''),sel:/\sselected(?:\s|$|=)/.test(o[1])});
      const pick=opts.find(x=>x.sel)||opts[0];
      app.el(id).value=pick?pick.v:'';
    }
    const taRe=/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g;
    while((m=taRe.exec(html))){const id=at(m[1],'id');if(id)app.el(id).value=un(m[2]);}
  };
  W.fnCalls=name=>W.calls.filter(c=>c.url==='/.netlify/functions/'+name);
  W.cloudCalls=()=>W.calls.filter(c=>/api\.cloudinary\.com/.test(c.url));
  return W;
}
const shares=st=>Object.keys(st.docs).filter(k=>k.indexOf('ma_shares/')===0).map(k=>Object.assign({token:k.slice(10)},st.docs[k]));
const serverAudit=st=>Object.keys(st.docs).filter(k=>k.indexOf('ma_audit/')===0).map(k=>st.docs[k]);
const noUrlIn=v=>!/cloudinary\.com|secure_url|"url"/.test(J(v));

module.exports=async function(){
  const s=suite('master-accounts-files');

  s.section('the stored shape — a reference to a file the server named, never a URL');
  {
    const signed={publicId:PID,type:'authenticated',name:'bill.pdf',mime:'application/pdf',bytes:204800};
    const res={public_id:PID,version:1790000001,format:'pdf',resource_type:'image',type:'authenticated',bytes:204801,
      secure_url:'https://res.cloudinary.com/deww4lpym/image/authenticated/v1/'+PID+'.pdf',url:'http://res.cloudinary.com/x',original_filename:'bill'};
    const r=M.maAttachFromUpload(signed,res,{by:'afnan',at:5});
    s.eq('an upload answer becomes exactly the stored keys',J(Object.keys(r.att||{})),J(M.MA_ATTACH_KEYS));
    s.ok('… carrying neither of the two URLs Cloudinary sent back',noUrlIn(r.att),J(r.att));
    s.eq('… with Cloudinary\'s own version and size',J([r.att.version,r.att.bytes,r.att.type,r.att.format]),J([1790000001,204801,'authenticated','pdf']));
    s.ok('a name the server did not give is refused, not stored',!!M.maAttachFromUpload(signed,Object.assign({},res,{public_id:'ma/'+'f'.repeat(64)}),{}).error);
    s.ok('a public file under the preset\'s own folder is accepted (the fallback)',!!M.maAttachFromUpload(Object.assign({},signed,{type:'upload'}),Object.assign({},res,{type:'upload',public_id:'groovy/'+PID}),{}).att);
    s.ok('… a private one never carries a folder',!!M.maAttachFromUpload(signed,Object.assign({},res,{public_id:'groovy/'+PID}),{}).error);
    s.ok('a raw resource is refused',/not an image or a PDF/.test(M.maAttachFromUpload(signed,Object.assign({},res,{resource_type:'raw'}),{}).error||''));
    s.ok('a format outside the list is refused',/only images/i.test(M.maAttachFromUpload(signed,Object.assign({},res,{format:'docx'}),{}).error||''));
    const d=M.maBuildDoc('journal',{kind:'money_out',date:'2026-07-05',holder:'1011',account:'5030',payee:'X',amount:5000,tax:{kind:'none'},
      attachments:[Object.assign({secure_url:'https://res.cloudinary.com/x/y.pdf',url:'http://x'},r.att),{url:'https://res.cloudinary.com/a.pdf'},{id:'a'}]},{by:'afnan'},IDX,S);
    s.eq('maBuildDoc keeps the reference and drops anything that is not one',d.attachments.length,1);
    s.ok('… and strips any URL that rode along on the reference',noUrlIn(d.attachments));
    s.eq('a void document takes no file',M.maAttachIssues({status:'void',date:'2026-07-05'},{})[0].rule,'attach.void');
    s.eq('nor does one in a locked quarter',M.maAttachIssues({status:'posted',date:'2026-07-05'},{closes:[{quarter:'2027-Q1',locked:true}]})[0].rule,'attach.closed');
    s.eq('… a reopened quarter does',M.maAttachIssues({status:'posted',date:'2026-07-05'},{closes:[{quarter:'2027-Q1',locked:true,reopenedAt:3}]}).length,0);
    s.eq('twenty files at most',M.maAttachIssues({status:'posted',date:'2026-07-05',attachments:Array.from({length:20},()=>r.att)},{})[0].rule,'attach.max');
  }

  s.section('the review queue reads LIVE flags — the bill answers "no bill attached"');
  {
    const f=[{rule:'evidence.missing',message:'No bill'},{rule:'duplicate',message:'Looks like JV-1'}];
    const att=M.maAttachClean({publicId:PID,format:'jpg',type:'upload',name:'b.jpg'});
    s.eq('with no file both flags stand',M.maLiveFlags({flags:f}).length,2);
    s.eq('with a file the evidence flag is answered; the other stays',J(M.maLiveFlags({flags:f,attachments:[att]}).map(x=>x.rule)),J(['duplicate']));
    s.eq('… and is reported as answered',J(M.maAnsweredFlags({flags:f,attachments:[att]}).map(x=>x.rule)),J(['evidence.missing']));
    s.ok('a document whose only flag was the missing bill leaves the queue',M.maReviewQueue([{status:'posted',flags:[f[0]],attachments:[att]}]).length===0&&M.maReviewQueue([{status:'posted',flags:[f[0]]}]).length===1);
    s.eq('a large handover\'s note or file answers transfer.note',M.maLiveFlags({flags:[{rule:'transfer.note'}],note:'Wages'}).length,0);
  }

  await withEnv(SIGNED_ENV,async()=>{
    s.section('attaching while recording — sign, straight to Cloudinary, the reference rides in');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      app.run("window.maRecordKind('money_out')");
      const form=app.bodyHtml('ma-modal-back');
      s.ok('every document form carries the file field',/id="ma-w-attachments"/.test(form));
      s.ok('… with a camera picker and a plain one (a capture input cannot pick a PDF)',/type="file" accept="image\/\*" capture="environment"/.test(form)&&/accept="image\/\*,application\/pdf,\.pdf" multiple/.test(form));
      const ok=await W.pick([W.file('bill-14-oct.pdf','application/pdf',204800)],'form');
      s.eq('the upload finished and said so',ok,true);
      const fn=W.fnCalls('ma-attach');
      s.eq('first the function is asked to sign',J(fn.map(c=>c.body.action)),J(['sign']));
      s.eq('… as the signed-in owner (a Bearer ID token)',fn[0].auth,'Bearer t_afnan');
      s.eq('… for this file\'s name, type and size',J(fn[0].body.file),J({name:'bill-14-oct.pdf',type:'application/pdf',size:204800}));
      const up=W.uploads[0]||{};
      s.eq('then the file goes STRAIGHT to Cloudinary\'s image upload',up.url,'https://api.cloudinary.com/v1_1/deww4lpym/image/upload');
      s.eq('… carrying every signed field and the file — nothing else',J(up.keys&&up.keys.slice().sort()),J(['allowed_formats','api_key','file','overwrite','public_id','signature','timestamp','type']));
      s.ok('… and the signature Cloudinary checks is good (an independent signer agrees)',W.cloudCalls().length===1&&!W.toasts.some(t=>/Invalid Signature/.test(t)));
      const atts=JSON.parse(app.run('JSON.stringify(_maF.atts)'));
      s.eq('the form now holds one reference',atts.length,1);
      s.ok('… with no URL in it',noUrlIn(atts),J(atts));
      s.eq('… private, under the name the server minted',J([atts[0].type,atts[0].publicId===up.fields.public_id,/^ma\/[0-9a-f]{64}$/.test(atts[0].publicId)]),J(['authenticated',true,true]));
      s.ok('… listed on the form with View and Remove',/bill-14-oct\.pdf/.test(app.el('ma-f-att').innerHTML)&&/maAttachView\('form',0\)/.test(app.el('ma-f-att').innerHTML)&&/maAttachDrop\(0\)/.test(app.el('ma-f-att').innerHTML));
      app.el('ma-f-date').value='2026-07-09';app.el('ma-f-holder').value='1011';app.el('ma-f-account').value='5030';app.el('ma-f-payee').value='Asghar';app.el('ma-f-amount').value='25000';app.el('ma-f-taxkind').value='none';app.el('ma-f-costCentre').value='factory';
      app.run('_maF.attBusy=1');
      await app.run('window.maSaveForm()');
      s.eq('Record waits while an upload is still running — nothing written',W.tx.length,0);
      s.ok('… saying why, under the field',/Wait for the upload to finish/.test(app.el('ma-e-attachments').textContent));
      app.run('_maF.attBusy=0');
      await app.run('window.maSaveForm()');
      s.eq('then it records — one transaction',W.tx.length,1);
      const d=(W.tx[0].find(x=>x.col==='ma_journal')||{}).data||{};
      s.eq('the document carries the file',(d.attachments||[]).length,1);
      s.eq('… as exactly the stored keys',J(Object.keys(d.attachments[0]||{})),J(M.MA_ATTACH_KEYS));
      s.ok('… and nothing on the document is a Cloudinary URL',noUrlIn(d),J(d.attachments));
      s.ok('₨25,000 with its bill attached is not flagged "no bill"',!(d.flags||[]).some(x=>x.rule==='evidence.missing'));
      s.ok('the shared unsigned uploadToCloudinary() is never used by Master Accounts',!/uploadToCloudinary/.test(read('js/master-accounts.js')));
    }

    s.section('attaching afterwards — an EDIT with history; the flag leaves the queue on its own');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      s.ok('JV-27-0002 waits in the review queue for its bill',app.run("maReviewQueue(_maCtx().docs).some(d=>d.id==='JV-27-0002')"));
      const rail=app.run("_maRail={kind:'doc',dt:'journal',id:'JV-27-0002'};_maPageHTML('ma-ledger')");
      s.ok('the rail shows "No file attached" and both pickers',/No file attached/.test(rail)&&/id="ma-att-cam-rail"/.test(rail)&&/id="ma-att-file-rail"/.test(rail));
      const before=clone(W.db.ma_journal['JV-27-0002']);
      const ok=await W.pick([W.file('asghar-oct.jpg','image/jpeg',51200)],'rail');
      s.eq('the file is attached',ok,true);
      s.eq('one transaction for the edit',W.tx.length,1);
      const ops=W.tx[0];
      const e=(ops.find(x=>x.col==='ma_journal')||{}).data||{};
      const changed=Object.keys(Object.assign({},before,e)).filter(k=>J(before[k])!==J(e[k])).sort();
      s.eq('it changes exactly attachments, rev and edits — the rules\' edit shape',J(changed),J(['attachments','edits','rev']));
      const row=(e.edits||[])[0]||{};
      s.eq('rev 2; one edits[] row by the caller naming exactly attachments',J([e.rev,e.edits.length,row.by,row.fields]),J([2,1,'afnan',['attachments']]));
      s.eq('… its reason says what happened',row.reason,'Attached asghar-oct.jpg');
      s.ok('… before/after carry references, never URLs',noUrlIn(row));
      s.eq('the stored flags are NOT rewritten — an attach is not a form edit, and changes no figure',J(e.flags),J(before.flags));
      const au=ops.find(x=>x.col==='ma_audit');
      s.eq('an audit row goes with it: attach, by afnan, rev 2',J(au&&[au.data.action,au.data.by,/^rev 2 · attachments — Attached asghar-oct\.jpg$/.test(au.data.detail)]),J(['attach','afnan',true]));
      s.ok('the review queue no longer holds it — the file answers the flag',!app.run("maReviewQueue(_maCtx().docs).some(d=>d.id==='JV-27-0002')"));
      const rail2=app.run("_maPageHTML('ma-ledger')");
      s.ok('the rail lists the file with View and Download',/asghar-oct\.jpg/.test(rail2)&&/maAttachView\('rail',0\)/.test(rail2)&&/maAttachView\('rail',0,true\)/.test(rail2));
      s.ok('… and shows the flag as answered, with no "Mark reviewed"',/answered: the document has it now/.test(rail2)&&!/maReviewDoc\('journal','JV-27-0002'\)/.test(rail2));
      s.ok('… at the rail\'s own revision',/rev 2</.test(rail2));
      // Taking it off again, through Edit (the reason is typed): the flag is back.
      app.run("window.maEditDoc('journal','JV-27-0002')");
      W.fill();
      app.run('window.maAttachDrop(0)');
      app.el('ma-f-reason').value='wrong photo';
      await app.run('window.maSaveForm()');
      if(W.tx.length===1)await app.run('window.maSaveForm()');   // acknowledge the evidence flag the form shows
      const e2=((W.tx[1]||[]).find(x=>x.col==='ma_journal')||{}).data||{};
      s.eq('removing it is an edit naming attachments, with the typed reason',J([(e2.edits||[]).length,(e2.edits||[])[1]&&e2.edits[1].fields,(e2.edits||[])[1]&&e2.edits[1].reason]),J([2,['attachments'],'wrong photo']));
      s.ok('… and "no bill attached" is back in the queue',app.run("maReviewQueue(_maCtx().docs).some(d=>d.id==='JV-27-0002')"));
      // A void document takes no file, and nothing is uploaded for it.
      const n=W.calls.length;
      app.run("_maRail={kind:'doc',dt:'journal',id:'JV-27-0003'}");
      const vrail=app.run("_maPageHTML('ma-ledger')");
      s.ok('a void document\'s rail offers no picker, and says why',!/ma-att-cam-rail/.test(vrail)&&/A void document cannot change/.test(vrail));
      await W.pick([W.file('x.jpg','image/jpeg')],'rail');
      s.eq('… and a pick on it sends nothing anywhere',W.calls.length,n);
    }

    s.section('looking at a file — a fresh link every time, opened, never kept');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      app.run("_maRail={kind:'doc',dt:'journal',id:'JV-27-0004'}");
      const a1=await app.run("window.maAttachView('rail',0)");
      const a2=await app.run("window.maAttachView('rail',0)");
      const urls=W.fnCalls('ma-attach');
      s.eq('each look asks the function again',J(urls.map(c=>c.body.action)),J(['url','url']));
      s.eq('… for the stored reference',J(urls[0].body.file),J({publicId:PID,format:'pdf',type:'authenticated',resourceType:'image'}));
      s.ok('the tab was opened in the click and pointed at a signed download link',a1===true&&a2===true&&/^https:\/\/api\.cloudinary\.com\/v1_1\/deww4lpym\/image\/download\?/.test(W.opened[0].location.href));
      s.ok('… that expires (expires_at in the link)',/expires_at=\d+/.test(W.opened[0].location.href));
      s.eq('… and the opened tab cannot reach back into the app',W.opened[0].opener,null);
      s.ok('the link is never kept — not on the document, not in the page\'s data',!/api\.cloudinary\.com|download\?/.test(app.run('JSON.stringify(maData)')));
      await app.run("window.maAttachView('rail',0,true)");
      const dl=W.fnCalls('ma-attach').slice(-1)[0];
      s.ok('Download asks for the file as an attachment',dl.body.download===true&&/attachment=true/.test(W.opened[2].location.href));
      W.popupBlocked=true;
      const b=await app.run("window.maAttachView('rail',0)");
      s.ok('a blocked tab is said out loud',b===false&&W.toasts.some(t=>/blocked the new tab/.test(t)));
      W.popupBlocked=false;W.netDown=true;
      await app.run("window.maAttachView('rail',0)");
      s.ok('no network: the tab closes and the reason is shown',W.opened.slice(-1)[0].closed===true&&W.toasts.some(t=>/Could not open stationery-bill\.pdf: Could not reach the server/.test(t)));
      W.netDown=false;
    }

    s.section('every refusal is shown as it came');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      app.run("window.maRecordKind('money_out')");
      await W.pick([W.file('quote.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document')],'form');
      s.ok('415 — the function\'s own sentence',/quote\.docx did not upload: Only images \(JPG, PNG, WebP, HEIC\) and PDFs can be attached — not \.docx files\./.test(app.el('ma-f-att').innerHTML));
      s.eq('… and nothing went to Cloudinary',W.uploads.length,0);
      await W.pick([W.file('scan.pdf','application/pdf',25*1024*1024+1)],'form');
      s.ok('413 — too large, in the function\'s words',/The file is larger than 25 MB\./.test(app.el('ma-f-att').innerHTML));
      W.cloud.refuse={status:400,message:'File size too large. Got 11000000. Maximum is 10485760.'};
      await W.pick([W.file('big.pdf','application/pdf',11000000)],'form');
      s.ok('Cloudinary\'s own refusal (its plan\'s cap), in its words',/big\.pdf did not upload: Cloudinary refused the file: File size too large\. Got 11000000\. Maximum is 10485760\./.test(app.el('ma-f-att').innerHTML));
      s.eq('… and nothing reached the form',app.run('_maF.atts.length'),0);
      W.cloud.refuse=null;
      W.token='t_forged';
      await W.pick([W.file('a.jpg','image/jpeg')],'form');
      s.ok('401 — sign in again',/Could not verify who you are — sign in again and retry\./.test(app.el('ma-f-att').innerHTML));
      W.token='t_mustafa';
      await W.pick([W.file('a.jpg','image/jpeg')],'form');
      s.ok('403 — for Afnan and Ammar only (the server decides, not the page)',/Master Accounts is for Afnan and Ammar only\./.test(app.el('ma-f-att').innerHTML));
      W.token='t_afnan';W.netDown=true;
      await W.pick([W.file('a.jpg','image/jpeg')],'form');
      s.ok('no network — said',/Could not reach the server — check the connection/.test(app.el('ma-f-att').innerHTML));
      W.netDown=false;
      W.cloud.answerPid='ma/'+'e'.repeat(64);
      await W.pick([W.file('a.jpg','image/jpeg')],'form');
      s.ok('a file stored under another name is not attached',/under a name the server did not give it/.test(app.el('ma-f-att').innerHTML)&&app.run('_maF.atts.length')===0);
      W.cloud.answerPid=null;
      const out=mkWorld({signedOut:true});
      await out.app.run('maLoad()');
      // With no signed-in user there is no sign-in time, so the idle lock is
      // due and no form opens (M1.6b, security F5). Activity a moment ago
      // lets this reach the upload, which is what is under test here.
      out.app.run('_maTouch()');
      out.app.run("window.maRecordKind('money_out')");
      await out.pick([out.file('a.jpg','image/jpeg')],'form');
      s.ok('signed out — said, and nothing is sent',/Sign in again — you are signed out\./.test(out.app.el('ma-f-att').innerHTML)&&out.calls.length===0);
    }

    s.section('Settings — which mode is in force, from the server');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      app.run("_maCloseTab='settings';_maPageHTML('ma-close')");
      await tick(20);
      const html=app.el('ma-att-mode').innerHTML;
      s.eq('it asks the function for its status',J(W.fnCalls('ma-attach').map(c=>c.body.action)),J(['status']));
      s.ok('private: said, with the five-minute link',/<span class="ma-word fine">private<\/span>/.test(html)&&/stops working after 5 minutes/.test(html));
      s.ok('… and that withdrawing a link cannot recall a downloaded copy',/nothing can recall a copy/.test(html));
      s.ok('the share-link days sit beside it, from settings',/id="ma-s-sharedays"[^>]*value="7"/.test(app.run("_maPageHTML('ma-close')")));
    }
  });

  await withEnv(UNSIGNED_ENV,async()=>{
    s.section('the public fallback — said plainly, everywhere it matters');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      app.run("_maCloseTab='settings';_maPageHTML('ma-close')");
      await tick(20);
      const html=app.el('ma-att-mode').innerHTML;
      s.ok('Settings: public, on purpose',/Public — on purpose\./.test(html)&&/<span class="ma-word warn">public<\/span>/.test(html));
      s.ok('… because MA_ALLOW_PUBLIC_ATTACH is 1 (M1.6c: public only by the owners\' choice)',/MA_ALLOW_PUBLIC_ATTACH is set to 1 in Netlify/.test(html));
      s.ok('… naming what is missing in Netlify',/CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set there/.test(html));
      s.ok('… and no longer calling it the automatic fallback',!/Public — the fallback\./.test(html)&&!/The server holds no Cloudinary key, so/.test(html));
      s.ok('… a permanent, unguessable address',/permanent address that is long and random/.test(html)&&/nobody can guess it/.test(html));
      s.ok('… and that withdrawing or expiring a share only stops our link',/only stops OUR link; it cannot recall the file’s own address, or a copy someone already has/.test(html));
      app.run("window.maRecordKind('money_out')");
      await W.pick([W.file('receipt.jpeg','image/jpeg',9000)],'form');
      const up=W.uploads[0]||{};
      s.eq('the unsigned preset, and the server\'s own random name — nothing else',J((up.keys||[]).slice().sort()),J(['file','public_id','upload_preset']));
      const a=JSON.parse(app.run('JSON.stringify(_maF.atts[0]||null)'));
      s.eq('the reference says public (type upload)',a&&a.type,'upload');
      s.ok('… still no URL stored',noUrlIn(a));
      s.ok('the form says the file is public',/This file is public in this setup/.test(app.el('ma-f-att').innerHTML));
      W.cloud.folder='groovy';
      await W.pick([W.file('two.png','image/png',9000)],'form');
      s.ok('a preset that files it under its own folder is still ours',JSON.parse(app.run('JSON.stringify(_maF.atts.map(x=>x.publicId))')).some(p=>/^groovy\/ma\/[0-9a-f]{64}$/.test(p)));
      W.cloud.folder='';
      app.run('window.maCloseModal()');
      // A private file cannot be opened without the key: not_configured, said.
      app.run("_maRail={kind:'doc',dt:'journal',id:'JV-27-0004'}");
      await app.run("window.maAttachView('rail',0)");
      s.ok('503 not configured — the function\'s sentence',W.toasts.some(t=>/This file is private and the server has no Cloudinary key to open it with — set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Netlify\./.test(t)));
    }
  });

  await withEnv(NOKEY_ENV,async()=>{
    s.section('M1.6c: no key and no opt-in — attachments are OFF, and Settings says so');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      // (a) the refusal's body rides on the error
      const err=JSON.parse(await app.run("_maFn('ma-attach',{action:'status'}).then(()=>'null',e=>JSON.stringify({status:e.status,code:e.code,body:e.body||null}))"));
      s.eq('status → 503 not_configured, the body kept on the error',J([err.status,err.code,err.body&&err.body.state]),J([503,'not_configured','not_configured']));
      s.eq('… the whole status body, not just its code',J(err.body&&err.body.missing),J(['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']));
      app.run("_maAttachSt=null;_maCloseTab='settings';_maPageHTML('ma-close')");
      await tick(20);
      // (b) the status loader carries the state
      const st=JSON.parse(app.run('JSON.stringify(_maAttachSt)'));
      s.eq('the loader keeps state: not_configured beside the code',J([st&&st.state,st&&st.code]),J(['not_configured','not_configured']));
      // (c) the card, keyed on state
      const html=app.el('ma-att-mode').innerHTML;
      s.ok('Settings: "Attachments are off — not set up."',/<b>Attachments are off — not set up\.<\/b>/.test(html));
      s.ok('… then the server\'s own sentence, naming what is missing',/Attachments are not set up: CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set in Netlify\./.test(html));
      s.ok('… both ways out, the opt-in named',/set MA_ALLOW_PUBLIC_ATTACH to 1 to allow public files on purpose/.test(html));
      s.ok('… and a Check again button',/<button class="ma-btn sm" onclick="window\.maAttachStatusCheck\(\)">Check again<\/button>/.test(html));
      s.ok('… never "could not ask the server" — the server answered',!/Could not ask the attachment server/.test(html));
      s.ok('… and never private or public',!/ma-word fine|ma-word warn/.test(html));
      // An upload in this state is refused by the server, and nothing goes to Cloudinary.
      app.run("window.maRecordKind('money_out')");
      await W.pick([W.file('receipt.jpeg','image/jpeg',9000)],'form');
      s.eq('an upload sends nothing to Cloudinary',W.uploads.length,0);
      s.ok('… and says why, in the server\'s words',/Attachments are not set up: CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set in Netlify/.test(app.el('ma-f-att').innerHTML));
      app.run('window.maCloseModal()');
    }
  });

  await withEnv(NOSA_ENV,async()=>{
    s.section('M1.6c: a server that cannot start says so — the same code, but NOT "attachments are off"');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      const err=JSON.parse(await app.run("_maFn('ma-attach',{action:'status'}).then(()=>'null',e=>JSON.stringify({status:e.status,code:e.code,body:e.body||null}))"));
      s.eq('status → the generic 503: code not_configured, no state in its body',J([err.status,err.code,err.body&&err.body.state]),J([503,'not_configured',undefined]));
      app.run("_maAttachSt=null;_maCloseTab='settings';_maPageHTML('ma-close')");
      await tick(20);
      const st=JSON.parse(app.run('JSON.stringify(_maAttachSt)'));
      s.eq('the loader: the code, and state null',J([st&&st.code,st&&st.state]),J(['not_configured',null]));
      const html=app.el('ma-att-mode').innerHTML;
      s.ok('Settings: "Could not ask the attachment server." with the server\'s sentence',/Could not ask the attachment server\.<\/b> The server is not set up yet — the reason is in the Netlify function log\./.test(html));
      s.ok('… NOT "Attachments are off" — the card is keyed on state, never on code',!/Attachments are off/.test(html));
    }
  });

  await withEnv(SIGNED_ENV,async()=>{
    s.section('share a voucher — PDF as a blob, uploaded, linked; the link the function serves');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      const rail=app.run("_maRail={kind:'doc',dt:'journal',id:'JV-27-0002'};_maPageHTML('ma-ledger')");
      s.ok('the voucher\'s rail offers Share beside its PDF',/window\.maDocShare\('journal','JV-27-0002'\)/.test(rail)&&/Share voucher/.test(rail));
      s.eq('the panel opens',app.run("window.maDocShare('journal','JV-27-0002')"),true);
      await tick(20);
      const panel=app.bodyHtml('ma-modal-back');
      s.ok('… prefilled with the party and their phone, and the days from settings',/id="ma-f-shfor"[^>]*value="Asghar Printers"/.test(panel)&&/id="ma-f-shphone"[^>]*value="0300-1234567"/.test(panel)&&/id="ma-f-shdays"[^>]*value="7"/.test(panel));
      s.eq('the links already made are read with ONE where the rules can prove',J(W.lastQuery&&W.lastQuery.where),J([{f:'docId',op:'==',v:'JV-27-0002'}]));
      s.ok('… none yet',/No links yet\./.test(app.el('ma-sh-list').innerHTML));
      W.fill();
      const ok=await app.run('window.maShareMake()');
      s.eq('a link is made',ok,true);
      s.eq('the PDF is made as a blob — no tab, no download',J(W.prints.map(p=>[p.type,p.deliver,p.filename])),J([['ma-voucher','blob','Voucher-JV-27-0002.pdf']]));
      const sign=W.fnCalls('ma-attach').find(c=>c.body.action==='sign');
      s.eq('it is signed as that PDF',J(sign&&sign.body.file&&[sign.body.file.name,sign.body.file.type,sign.body.file.size>0]),J(['Voucher-JV-27-0002.pdf','application/pdf',true]));
      s.eq('uploaded straight to Cloudinary, private',J([W.uploads.length,W.uploads[0]&&W.uploads[0].fields.type]),J([1,'authenticated']));
      const create=W.fnCalls('ma-share').find(c=>c.body.action==='create');
      // M1.6b: the subject carries the revision the PDF was made at — in `no`,
      // which ma-share keeps, and as `rev` for a server that stores it — so
      // the list can say when the document changed since (money M3).
      s.eq('create names the document at its revision, the file, the days and who it is for',J(create&&[create.body.subject,create.body.file.format,create.body.file.type,create.body.days,create.body.to]),
        J([{type:'journal',id:'JV-27-0002',no:'JV-27-0002 · rev 1',rev:1},'pdf','authenticated',7,{party:'Asghar Printers',phone:'+923001234567'}]));
      s.ok('… by reference, not by URL',noUrlIn(create&&create.body));
      const sh=shares(W.st);
      s.eq('the function wrote ONE share',sh.length,1);
      const tok=sh[0].token;
      s.eq('… live, for the voucher, by afnan',J([sh[0].revoked,sh[0].docKind,sh[0].docId,sh[0].createdBy,sh[0].days]),J([false,'journal','JV-27-0002','afnan',7]));
      s.eq('… and it keeps the revision the client sent, as docRev (M1.6c)',sh[0].docRev,1);
      s.ok('… and its own audit row, "share"',serverAudit(W.st).some(a=>a.action==='share'&&a.target&&a.target.id==='JV-27-0002'));
      const link='https://groovyoperations.netlify.app/.netlify/functions/ma-share?t='+tok;
      const made=app.el('ma-sh-made').innerHTML;
      s.ok('the page shows the full link: this origin + the function\'s path',made.indexOf('value="'+link+'"')>=0);
      s.ok('no host is written in the client — the origin is the page\'s own',!/groovyoperations\.netlify\.app/.test(read('js/master-accounts.js')));
      const text='GROOVY — Voucher JV-27-0002\n'+link;
      const wa=(/href="(https:\/\/wa\.me\/[^"]+)"/.exec(made)||[])[1]||'';
      s.ok('WhatsApp goes to the party, the number normalised to 92…',wa.indexOf('https://wa.me/923001234567?text=')===0,wa.slice(0,60));
      s.ok('… the message URI-encoded, the link inside it',wa.indexOf(encodeURIComponent(text))>0&&decodeURIComponent(wa.split('?text=')[1]||'').indexOf(link)>=0);
      s.ok('… nothing in the query left raw (no bare ?, & or space in the message)',!/[?&\s]/.test((wa.split('?text=')[1]||'').replace(/&amp;/g,'')));
      await app.run("window.maShareCopy('new')");
      s.eq('Copy puts the link on the clipboard',W.clip[0],link);
      // The link, served by the real function: a 302 to a signed, expiring download.
      const served=await W.share._handle({httpMethod:'GET',queryStringParameters:{t:tok},headers:{'user-agent':'Mozilla/5.0'}},Date.now());
      s.ok('the function serves that very link: 302 to a signed Cloudinary download',served.statusCode===302&&/^https:\/\/api\.cloudinary\.com\/v1_1\/deww4lpym\/image\/download\?/.test(served.headers.Location));
      await W.share._handle({httpMethod:'GET',queryStringParameters:{t:tok},headers:{'user-agent':'WhatsApp/2.23.20.0'}},Date.now());
      await app.run('_maShareListLoad()');
      const list=app.el('ma-sh-list').innerHTML;
      s.ok('the list: made by, works until, opened once, one preview',/Made by Afnan/.test(list)&&/Works until/.test(list)&&/Opened 1 time · last/.test(list)&&/1 link preview, last/.test(list));
      s.ok('… and a live link carries Copy, WhatsApp and Withdraw',/maShareCopy\('/.test(list)&&/wa\.me/.test(list)&&/maShareRevoke\('/.test(list));
      // Withdraw: asked first; declined, nothing is sent.
      const n=W.calls.length;
      app.ctx.confirm=()=>false;
      s.eq('Withdraw asks first — declined, nothing happens',await app.run("window.maShareRevoke('"+tok+"')"),false);
      s.eq('… and nothing was sent',W.calls.length,n);
      const asked=[];app.ctx.confirm=m=>{asked.push(m);return true;};
      s.eq('confirmed, it withdraws',await app.run("window.maShareRevoke('"+tok+"')"),true);
      s.ok('… the question says a downloaded copy stays',/A copy somebody already downloaded stays with them/.test(asked[0]||''));
      const rv=W.fnCalls('ma-share').slice(-1)[0];
      s.eq('THROUGH THE FUNCTION: POST ma-share revoke, as the owner',J([rv.body.action,rv.body.token,rv.auth]),J(['revoke',tok,'Bearer t_afnan']));
      s.eq('… so the share is revoked, by afnan',J([W.st.docs['ma_shares/'+tok].revoked,W.st.docs['ma_shares/'+tok].revokedBy]),J([true,'afnan']));
      s.ok('… and the function wrote its "revoke" audit row',serverAudit(W.st).some(a=>a.action==='revoke'&&a.target&&a.target.id==='JV-27-0002'));
      s.ok('the page never writes ma_shares itself',!W.sets.some(x=>x.col==='ma_shares')&&!W.tx.some(t=>t.some(x=>x.col==='ma_shares'))&&!/ma_shares:\s*id=>|doc\(db,\s*'ma_shares'/.test(read('js/master-accounts.js')));
      s.ok('the list says withdrawn, and offers nothing on it',/<span class="ma-word urgent">withdrawn<\/span>/.test(app.el('ma-sh-list').innerHTML)&&!/maShareRevoke/.test(app.el('ma-sh-list').innerHTML));
      const gone=await W.share._handle({httpMethod:'GET',queryStringParameters:{t:tok},headers:{}},Date.now());
      s.eq('… and the link now answers 410',gone.statusCode,410);
    }

    s.section('share — refused before anything is sent when it cannot work');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      app.run("window.maDocShare('journal','JV-27-0002')");await tick(10);
      W.fill();
      app.el('ma-f-shdays').value='91';
      s.eq('91 days is refused',await app.run('window.maShareMake()'),false);
      s.ok('… saying the range',/1 to 90/.test(app.el('ma-sh-err').textContent));
      app.el('ma-f-shdays').value='0';
      s.eq('0 days too',await app.run('window.maShareMake()'),false);
      app.el('ma-f-shdays').value='7';app.el('ma-f-shphone').value='12-34';
      s.eq('a number that cannot be read is refused, not sent',await app.run('window.maShareMake()'),false);
      s.eq('nothing was printed, signed or created',J([W.prints.length,W.fnCalls('ma-attach').filter(c=>c.body.action==='sign').length,W.fnCalls('ma-share').length]),J([0,0,0]));
      app.el('ma-f-shphone').value='';W.printFail='the font would not load';
      s.eq('a PDF that fails stops it',await app.run('window.maShareMake()'),false);
      s.ok('… with the reason, and nothing signed',/The PDF could not be made: the font would not load/.test(app.el('ma-sh-err').textContent)&&!W.fnCalls('ma-attach').some(c=>c.body.action==='sign'));
      W.printFail=null;W.cloud.refuse={status:400,message:'Invalid file size'};
      s.eq('Cloudinary refusing the PDF stops it',await app.run('window.maShareMake()'),false);
      s.ok('… in its own words, and no link was made',/Cloudinary refused the file: Invalid file size/.test(app.el('ma-sh-err').textContent)&&shares(W.st).length===0);
      W.cloud.refuse=null;
      app.el('ma-f-shfor').value='';app.el('ma-f-shphone').value='';
      s.eq('with nobody named, it still makes a link',await app.run('window.maShareMake()'),true);
      const c=W.fnCalls('ma-share').slice(-1)[0];
      s.eq('… for nobody in particular',c.body.to,null);
      s.ok('… and WhatsApp opens to nobody chosen yet',/href="https:\/\/wa\.me\/\?text=/.test(app.el('ma-sh-made').innerHTML));
      app.run('window.maCloseModal()');
      const noAcc=app.run("_maLF=_maLFBlank();window.maShare('ledger')");
      s.eq('a ledger of every account cannot be shared',noAcc,false);
      s.ok('… saying to pick one',W.toasts.some(t=>/Pick one holder or one account first/.test(t)));
      s.eq('a capital journal has no PDF to share',app.run("window.maDocShare('journal','JV-27-0001')"),false);
    }

    s.section('the statements share too — each lists its own links');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      const party=app.run("_maPartyId='p1';_maPageHTML('ma-party')");
      s.ok('a party page\'s ⋯ offers Share PDF',/window\.maShare\('party'\)/.test(party));
      app.run("window.maShare('party')");await tick(10);
      s.ok('… prefilled with the party\'s phone',/id="ma-f-shphone"[^>]*value="0300-1234567"/.test(app.bodyHtml('ma-modal-back')));
      W.fill();
      await app.run('window.maShareMake()');
      const c=W.fnCalls('ma-share').slice(-1)[0];
      s.ok('a statement\'s subject is the party',c&&c.body.subject.type==='party'&&c.body.subject.id==='p1');
      s.eq('… printed as the party statement',W.prints.slice(-1)[0].type,'ma-statement-party');
      app.run('window.maCloseModal()');
      app.run("_maHolderCode='1011';window.maShare('holder')");await tick(10);
      W.fill();
      await app.run('window.maShareMake()');
      s.eq('a holder statement\'s subject is the holder',J(W.fnCalls('ma-share').slice(-1)[0].body.subject.type),J('holder'));
      app.run('window.maCloseModal()');
      app.run("_maLF=Object.assign(_maLFBlank(),{holder:'1011'});window.maShare('ledger')");await tick(10);
      s.ok('a ledger lists only the ledger\'s own links, not the holder statement\'s',/No links yet\./.test(app.el('ma-sh-list').innerHTML));
    }

    s.section('the share list escapes what it shows, and says each state');
    {
      const W=mkWorld();const app=W.app;
      await app.run('maLoad()');
      const now=Date.now(),D=86400000;
      const base={docKind:'journal',docId:'JV-27-0002',docNo:'JV-27-0002',pdfPublicId:PID,format:'pdf',resourceType:'image',deliveryType:'authenticated',createdBy:'afnan',createdAt:now-2*D,days:7,revoked:false,revokedAt:null,revokedBy:null,opens:0,lastOpenedAt:null,previews:0,lastPreviewAt:null};
      const tk=c=>c.repeat(43);
      W.st.docs['ma_shares/'+tk('a')]=Object.assign({},base,{filename:'<img src=x onerror=alert(1)>.pdf',to:{party:'<b>Asghar</b>',phone:'+923001234567'},createdBy:'<script>',expiresAt:now+5*D});
      W.st.docs['ma_shares/'+tk('b')]=Object.assign({},base,{filename:'old.pdf',to:null,createdAt:now-20*D,expiresAt:now-13*D});
      W.st.docs['ma_shares/'+tk('c')]=Object.assign({},base,{filename:'withdrawn.pdf',to:null,expiresAt:now+5*D,revoked:true,revokedAt:now-D,revokedBy:'ammar'});
      W.st.docs['ma_shares/'+tk('d')]=Object.assign({},base,{docKind:'transfer',filename:'other-kind.pdf',expiresAt:now+5*D});
      app.run("window.maDocShare('journal','JV-27-0002')");await tick(20);
      const list=app.el('ma-sh-list').innerHTML;
      s.ok('a hostile filename is escaped, never markup',list.indexOf('<img src=x')<0&&list.indexOf('&lt;img src=x onerror=alert(1)&gt;.pdf')>=0);
      s.ok('… a hostile party name and a hostile author too',list.indexOf('<b>Asghar')<0&&list.indexOf('&lt;b&gt;Asghar&lt;/b&gt;')>=0&&list.indexOf('<script>')<0&&list.indexOf('&lt;script&gt;')>=0);
      s.ok('live, expired and withdrawn, each said',/<span class="ma-word fine">live<\/span>/.test(list)&&/<span class="ma-word mute">expired<\/span>/.test(list)&&/<span class="ma-word urgent">withdrawn<\/span>/.test(list));
      s.ok('… withdrawn by whom (through _maWho)',/Withdrawn by Ammar/.test(list));
      s.eq('only the live one carries actions',(list.match(/maShareRevoke\(/g)||[]).length,1);
      s.ok('another document kind with the same id is not listed',list.indexOf('other-kind.pdf')<0);
      s.eq('maShareState: withdrawn outranks expired',M.maShareState({revoked:true,expiresAt:1},5),'revoked');
      s.eq('… a record the server would not serve is not "live"',M.maShareState({revoked:'no',expiresAt:9e15},5),'unknown');
      const failing=mkWorld({failCols:['ma_shares']});
      await failing.app.run('maLoad()');
      failing.app.run("window.maDocShare('journal','JV-27-0002')");await tick(20);
      s.ok('a refused read names ma_shares — never "no links"',/Could not read ma_shares\./.test(failing.app.el('ma-sh-list').innerHTML)&&!/No links yet/.test(failing.app.el('ma-sh-list').innerHTML));
    }
  });

  s.section('WhatsApp — a Pakistani number becomes 92…, and the message is always encoded');
  {
    const cases=[['0300 1234567','923001234567'],['0300-1234567','923001234567'],['+92 300 1234567','923001234567'],['0092 300 1234567','923001234567'],
      ['3001234567','923001234567'],['923001234567','923001234567'],['+92 0300 1234567','923001234567'],['(0300) 123-4567','923001234567'],['+1 415 555 0100','14155550100'],
      ['12-34',''],['abc',''],['',''],[null,'']];
    cases.forEach(([raw,want])=>s.eq('"'+raw+'" → "'+want+'"',M.maWaPhone(raw),want));
    const msg='GROOVY — a & b\nhttps://x.test/f?t=abc&x=1';
    s.eq('with a number: wa.me/<digits>?text=<encoded>',M.maWaLink('0300 1234567',msg),'https://wa.me/923001234567?text='+encodeURIComponent(msg));
    s.eq('without one: wa.me/?text=<encoded>',M.maWaLink('',msg),'https://wa.me/?text='+encodeURIComponent(msg));
    s.ok('no raw & or ? survives in the message',!/[&?\s]/.test(M.maWaLink('0300 1234567',msg).split('?text=')[1]));
  }

  s.section('backups — read by their state');
  {
    const said=(row,nowMs)=>M.maNeedsAttention({settings:S,backup:row,nowMs}).filter(x=>/^ma_backups/.test(x.basis)).map(x=>x.state+': '+x.sentence);
    const H=3600000;
    s.eq('none yet: a watch',J(said(null,0)),J(['watch: No nightly backup has run yet — the bucket and point-in-time recovery need switching on.']));
    const nc={state:'not_configured',ok:false,configured:false,missing:['MA_BACKUP_BUCKET'],error:'Backups are not set up yet — MA_BACKUP_BUCKET is not set in Netlify',at:1000};
    s.eq('not set up: a concern worded as what it is',J(said(nc,1000+H)),J(['concern: Backups are not set up yet — MA_BACKUP_BUCKET is not set in Netlify.']));
    s.ok('… never "failed"',!/failed/.test(said(nc,1000+H)[0]));
    s.eq('… an old row with no state, not configured, reads the same',M.maBackupState({ok:false,configured:false}),'not_configured');
    s.eq('… with no error text, from the names it missed',J(said({state:'not_configured',missing:['MA_BACKUP_BUCKET','FIREBASE_SERVICE_ACCOUNT'],at:1},2)),J(['concern: Backups are not set up yet — MA_BACKUP_BUCKET and FIREBASE_SERVICE_ACCOUNT are not set in Netlify.']));
    ['starting','running'].forEach(st=>{
      s.eq(st+', an hour old: nothing',J(said({state:st,ok:null,at:1000},1000+H)),J([]));
      s.eq(st+', 40 hours old: stuck, said — never "ran"',J(said({state:st,ok:null,at:1000},1000+40*H)),J(['concern: The backup that started 1 day ago has not finished.']));
    });
    s.eq('a row with neither state nor ok is unknown — never done',M.maBackupState({at:1}),'unknown');
    s.eq('done, an hour ago: nothing',J(said({state:'done',ok:true,at:1000},1000+H)),J([]));
    s.eq('done, 37 hours ago: a concern',J(said({state:'done',ok:true,at:0},37*H)),J(['concern: The last backup ran 1 day ago.']));
    s.eq('failed: its error',J(said({state:'failed',ok:false,error:'Firestore refused the export (HTTP 403): The caller does not have permission',at:0},1)),J(['concern: Last night’s backup failed: Firestore refused the export (HTTP 403): The caller does not have permission.']));
    s.ok('"backup" is an audit action the core knows',M.MA_AUDIT_ACTIONS.indexOf('backup')>=0&&M.maAuditRow('backup',null,{}).action==='backup');
    const W=mkWorld();const app=W.app;
    await app.run('maLoad()');
    const now=Date.now();
    const runs=[{id:'nightly-2026-09-28',state:'running',ok:null,at:now-30*60000,operationState:'PROCESSING',collections:25},
      {id:'nightly-2026-09-27',state:'not_configured',ok:false,configured:false,missing:['MA_BACKUP_BUCKET'],error:'Backups are not set up yet — MA_BACKUP_BUCKET is not set in Netlify',at:now-24*H},
      {id:'nightly-2026-09-26',state:'failed',ok:false,error:'Firestore refused the export (HTTP 403): <b>no</b> permission',at:now-48*H},
      {id:'nightly-2026-09-25',state:'done',ok:true,collections:25,size:'12.3 MB',documents:123456,at:now-72*H},
      {id:'nightly-2026-09-24',state:'starting',ok:null,at:now-96*H},
      {id:'nightly-2026-09-23',ok:null,at:now-120*H}];
    app.run('maData.backups='+J(runs)+';_maInvalidate();_maCloseTab="overview"');
    const html=app.run("_maPageHTML('ma-close')");
    // The Backups table's own rows, newest first — the order `runs` is in.
    const sec=html.slice(html.indexOf('>Backups<'));
    const body=sec.slice(sec.indexOf('<tbody>')+7,sec.indexOf('</tbody>'));
    const trs=body.split('</tr>').filter(x=>/<tr/.test(x));
    s.eq('the table holds every run, newest first',trs.length,runs.length);
    const rowOf=id=>trs[runs.findIndex(x=>x.id===id)]||'';
    s.ok('running reads "running", with its start — never "done"',/<span class="ma-word mute">running<\/span>/.test(rowOf('nightly-2026-09-28'))&&/started .* · PROCESSING/.test(rowOf('nightly-2026-09-28'))&&!/>done</.test(rowOf('nightly-2026-09-28')));
    s.ok('starting reads "starting"',/<span class="ma-word mute">starting<\/span>/.test(rowOf('nightly-2026-09-24')));
    s.ok('not set up reads "not set up", naming what is missing',/<span class="ma-word warn">not set up<\/span>/.test(rowOf('nightly-2026-09-27'))&&/missing: MA_BACKUP_BUCKET/.test(rowOf('nightly-2026-09-27')));
    s.ok('failed reads "failed", its error escaped',/<span class="ma-word urgent">failed<\/span>/.test(rowOf('nightly-2026-09-26'))&&/&lt;b&gt;no&lt;\/b&gt;/.test(rowOf('nightly-2026-09-26')));
    s.ok('done reads "done" with collections, size and documents',/<span class="ma-word fine">done<\/span>/.test(rowOf('nightly-2026-09-25'))&&/25 collections · 12\.3 MB · 1,23,456 documents/.test(rowOf('nightly-2026-09-25')));
    s.ok('a row with no state and no ok says "no result" — never "done"',/<span class="ma-word mute">no result<\/span>/.test(rowOf('nightly-2026-09-23')));
    s.eq('Today raises nothing for a backup that is running (the newest row)',app.run('JSON.stringify(_maAttention(_maCtx()).filter(x=>/^ma_backups/.test(x.basis)))'),'[]');
    app.run('maData.backups=[maData.backups[1]];_maInvalidate()');
    s.ok('… and says "not set up" when that is the newest',JSON.parse(app.run('JSON.stringify(_maAttention(_maCtx()).filter(x=>/^ma_backups/.test(x.basis)).map(x=>x.state+": "+x.sentence))')).join('|')==='concern: Backups are not set up yet — MA_BACKUP_BUCKET is not set in Netlify.');
  }

  s.section('Download the books — every collection, a failed one named, an export row');
  {
    const W=mkWorld();const app=W.app;
    await app.run('maLoad()');
    const html=app.run("_maCloseTab='overview';_maPageHTML('ma-close')");
    s.ok('Close & audit offers it',/window\.maDownloadBooks\(\)/.test(html)&&/Download the books/.test(html));
    const ok=await app.run('window.maDownloadBooks()');
    s.eq('with every collection read, it succeeds',ok,true);
    s.eq('it read every ma_* collection the rules let an owner read',M.MA_BOOK_COLS.length,18);
    s.ok('…the couriers\' three among them (M2.4)',['ma_cpr','ma_collection','ma_runs'].every(c=>M.MA_BOOK_COLS.indexOf(c)>=0));
    const json=JSON.parse(await W.saved[0].text());
    s.eq('the JSON: the books\' own format, whole',J([json.format,json.version,json.complete,json.exportedBy]),J(['groovy-master-accounts-books',1,true,'afnan']));
    s.eq('… every document keeps its id apart from its fields',J(json.collections.ma_journal.map(d=>d.id).sort()),J(['JV-27-0001','JV-27-0002','JV-27-0003','JV-27-0004']));
    s.eq('… and the counts',J([json.counts.ma_journal,json.counts.ma_transfer,json.counts.ma_parties]),J([4,1,1]));
    s.ok('the JSON is downloaded under the books\' name',/^groovy-books_\d{4}-\d{2}-\d{2}_\d{4}\.json$/.test((W.clicks[0]||{}).download||''),J(W.clicks));
    const wb=W.xlsx[0]||{sheets:[]};
    s.ok('the workbook: Contents, Postings, Trial balance, then the collections',J(wb.sheets.slice(0,3).map(x=>x.name))===J(['Contents','Postings','Trial balance'])&&wb.sheets.some(x=>x.name==='ma_journal'));
    const tb=wb.sheets.find(x=>x.name==='Trial balance');
    s.ok('… its trial balance balances',tb&&tb.rows.some(r=>r[1]==='Debits equal credits.'));
    const au=W.sets.find(x=>x.col==='ma_audit'&&x.data.action==='export');
    s.ok('an export row is written to the audit trail',!!au&&/Download the books · JSON and Excel · \d+ documents in 18 collections/.test(au.data.detail),au&&au.data.detail);
    const F=mkWorld({failCols:['ma_shares','ma_journal']});
    await F.app.run('maLoad()').catch(()=>{});
    const ok2=await F.app.run('window.maDownloadBooks()');
    s.eq('with two collections refused, it still downloads — and says it was not whole',ok2,false);
    const j2=JSON.parse(await F.saved[0].text());
    s.eq('the JSON names each one that failed',J(j2.failed.map(f=>f.collection)),J(['ma_journal','ma_shares']));
    s.ok('… with the reason, and is marked incomplete',j2.complete===false&&/permission/i.test(j2.failed[0].error));
    s.ok('… and holds no empty list pretending to be a collection',!('ma_shares' in j2.collections)&&!('ma_journal' in j2.collections));
    const contents=(F.xlsx[0]||{sheets:[]}).sheets.find(x=>x.name==='Contents');
    s.ok('the workbook says the postings leave out what could not be read',contents&&contents.rows.some(r=>/INCOMPLETE — the postings and the trial balance leave out ma_journal/.test(r[0]||'')));
    s.ok('… and marks each failed collection NO',contents&&contents.rows.some(r=>r[0]==='ma_shares'&&/^NO — /.test(r[2])));
    s.ok('the toast names them too',F.toasts.some(t=>/Could not read: ma_journal \(.*\); ma_shares/.test(t)));
    const au2=F.sets.find(x=>x.col==='ma_audit'&&x.data.action==='export');
    s.ok('… and so does the audit row',!!au2&&/could not read ma_journal, ma_shares/.test(au2.data.detail));
  }

  s.section('one revision number, on the screen and on the paper');
  {
    const e0=M.maBuildDoc('journal',{kind:'money_out',date:'2026-07-05',holder:'1011',account:'6050',payee:'Bilal',amount:1000,tax:{kind:'none'}},{by:'afnan',byName:'Afnan',ts:1},IDX,S);
    e0.id=e0.no='JV-27-0009';
    const ed=(b,amt,why)=>M.maApplyEdit(b,M.maBuildDoc('journal',{kind:'money_out',date:'2026-07-05',holder:'1011',account:'6050',payee:'Bilal',amount:amt,tax:{kind:'none'}},{by:'afnan'},IDX,S),{at:2,by:'afnan',byName:'Afnan',reason:why});
    const e2=ed(ed(e0,1100,'a'),1200,'b');
    s.eq('never edited: rev 1',M.maRevOf(e0),1);
    s.eq('edited twice: rev 3 (edits + 1)',M.maRevOf(e2),3);
    const X={idx:IDX,settings:S,lines:[],docs:[e2],parties:[],commitments:[],people:{afnan:'Afnan'}};
    s.eq('the voucher prints the same number',M.maPdfVoucherData(X,e2).revised.n,M.maRevOf(e2));
    s.eq('a document never edited prints no mark',M.maPdfVoucherData(X,e0).revised,null);
    const W=mkWorld({seed:Object.assign(seedBook(),{ma_journal:{[e2.no]:e2}})});
    await W.app.run('maLoad()');
    const rail=W.app.run("_maRail={kind:'doc',dt:'journal',id:'JV-27-0009'};_maPageHTML('ma-ledger')");
    s.ok('the rail says rev 3 — the number on the paper',/JV-27-0009 · rev 3</.test(rail));
    s.ok('… and the page reads it from maRevOf, never from d.rev',/rev \$\{maRevOf\(d\)\}/.test(read('js/master-accounts.js'))&&!/rev \$\{d\.rev/.test(read('js/master-accounts.js')));
  }

  s.section('the edit diff compares values, not key order');
  {
    const b=M.maBuildDoc('journal',{kind:'money_out',date:'2026-07-05',holder:'1011',account:'6050',payee:'Bilal',amount:1000,tax:{kind:'none'}},{by:'afnan'},IDX,S);
    const shuffled=Object.assign({},b,{tax:{amount:0,claimable:false,inclusive:true,kind:'none',rate:0}});   // keys handed back in another order
    const after=M.maBuildDoc('journal',{kind:'money_out',date:'2026-07-05',holder:'1011',account:'6050',payee:'Bilal',amount:1200,tax:{kind:'none'}},{by:'afnan'},IDX,S);
    s.eq('a tax block read back in another key order is not "changed"',J(M.maEditDiff(shuffled,after).fields),J(['amount']));
  }

  s.section('the service worker never caches a Master Accounts file');
  {
    const src=read('sw.js');
    const listeners={},puts=[];
    const cacheOf=name=>({match:async()=>undefined,put:async(req)=>{puts.push({cache:name,url:req.url||String(req)});},keys:async()=>[],delete:async()=>true});
    const ctx={self:{addEventListener:(t,fn)=>{listeners[t]=fn;},location:{origin:'https://groovyoperations.netlify.app'},skipWaiting:async()=>{},clients:{claim:async()=>{}}},
      caches:{open:async n=>cacheOf(n),keys:async()=>[],delete:async()=>true},
      fetch:async req=>({ok:true,status:200,type:'cors',url:req.url||String(req),clone(){return this;}}),URL,console,Promise,setTimeout};
    vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'sw.js'});
    const fire=async url=>{
      let p=null;
      listeners.fetch({request:{method:'GET',url},respondWith(x){p=x;}});
      if(p)await p;
      await tick(5);
      return p!==null;
    };
    const IMG='https://res.cloudinary.com/deww4lpym/image/upload/f_auto,q_auto,w_400/v1/boards/abc123.jpg';
    s.eq('an ordinary board photo is intercepted…',await fire(IMG),true);
    s.ok('… and cached in the image cache',puts.some(x=>x.cache==='groovy-ops-images'&&x.url===IMG));
    const priv=[
      'https://res.cloudinary.com/deww4lpym/image/upload/v1790000001/'+PID+'.pdf',
      'https://res.cloudinary.com/deww4lpym/image/upload/groovy/'+PID+'.jpg',
      'https://res.cloudinary.com/deww4lpym/image/upload/f_auto,q_auto,w_400/v1790000001/'+PID+'.jpg',
      'https://res.cloudinary.com/deww4lpym/image/authenticated/s--AbCd1234--/v1790000001/'+PID+'.pdf',
      'https://res.cloudinary.com/deww4lpym/image/private/s--AbCd1234--/v1/receipt.jpg'];
    for(const u of priv){
      s.eq('not intercepted: '+u.replace('https://res.cloudinary.com/deww4lpym',''),await fire(u),false);
    }
    s.eq('a private download link is never intercepted either',await fire('https://api.cloudinary.com/v1_1/deww4lpym/image/download?public_id='+PID),false);
    s.ok('none of them reached a cache',!puts.some(x=>priv.indexOf(x.url)>=0||/download/.test(x.url)));
    const before=puts.length;
    await ctx.cacheFirstImage({url:priv[0]});await tick(5);
    s.eq('cacheFirstImage itself refuses to store one, even if routed there',puts.length,before);
  }

  return s;
};

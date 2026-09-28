/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts attachments — netlify/functions/ma-attach.js (M1.5a)

   The real handler, driven with firebase-admin replaced (tests/ma-fake-
   admin.js). Every refusal a caller can meet, both modes (authenticated
   with the Cloudinary key; the unsigned fallback without it), and the
   signature it hands out recomputed here by an independent signer — so the
   test holds the SCHEME, not the lib's copy of it. Cannot prove: that the
   live Cloudinary account accepts the upload (the sandbox cannot reach it).
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const crypto=require('crypto');
const {suite}=require('./harness');
const {loadFn,TOKENS,FAKE_SA,withEnv}=require('./ma-fake-admin');
const J=v=>JSON.stringify(v);

const UNSIGNED=['file','api_key','resource_type','cloud_name','signature'];
function indepSig(p,secret){
  const keys=Object.keys(p).filter(k=>!UNSIGNED.includes(k)&&p[k]!==undefined&&p[k]!==null&&p[k]!=='').sort();
  const str=keys.map(k=>k+'='+(Array.isArray(p[k])?p[k].join(','):String(p[k]))).map(x=>x.split('&').join('%26')).join('&');
  return crypto.createHash('sha1').update(str+secret).digest('hex');
}

const SECRET='test-secret-not-real-7Qz';
const KEY='987654321098765';
const NOW=Date.UTC(2026,9,5,6,30,15,250);
const SIGNED_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:KEY,CLOUDINARY_API_SECRET:SECRET,CLOUDINARY_CLOUD_NAME:undefined};
const UNSIGNED_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:undefined,CLOUDINARY_API_SECRET:undefined,CLOUDINARY_CLOUD_NAME:undefined};

function ev(body,o){
  o=o||{};
  const headers=Object.assign({},o.headers||{});
  if(o.token!==null)headers.authorization='Bearer '+(o.token||'t_afnan');
  return{httpMethod:o.method||'POST',headers,body:typeof body==='string'?body:JSON.stringify(body),isBase64Encoded:!!o.b64};
}
async function call(fn,body,o){
  const r=await fn._handle(ev(body,o),(o&&o.now)||NOW);
  let parsed=null;try{parsed=JSON.parse(r.body);}catch(e){}
  return{status:r.statusCode,body:parsed,raw:r.body,headers:r.headers||{}};
}
const FILE={name:'bill-14-oct.pdf',type:'application/pdf',size:204800};

module.exports=async function(){
  const s=suite('ma-attach');

  await withEnv(SIGNED_ENV,async()=>{
    s.section('who may call it');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-attach.js',st);
      const g=await call(fn,{action:'status'},{method:'GET'});
      s.eq('GET is refused — 405',g.status,405);
      s.eq('… saying POST',g.headers.Allow,'POST');
      const none=await call(fn,{action:'status'},{token:null});
      s.eq('no Authorization header → 401 auth',J([none.status,none.body.code]),J([401,'auth']));
      s.eq('… and the token check is never even asked',st.verify.length,0);
      const basic=await call(fn,{action:'status'},{token:null,headers:{authorization:'Basic dXNlcjpwYXNz'}});
      s.eq('a non-Bearer Authorization → 401 auth',basic.status,401);
      const bad=await call(fn,{action:'status'},{token:'t_forged'});
      s.eq('a token Firebase does not accept → 401 auth',J([bad.status,bad.body.code]),J([401,'auth']));
      const m=await call(fn,{action:'status'},{token:'t_mustafa'});
      s.eq('Mustafa (a manager) → 403 forbidden',J([m.status,m.body.code]),J([403,'forbidden']));
      const r=await call(fn,{action:'status'},{token:'t_raees'});
      s.eq('Raees → 403 forbidden',r.status,403);
      const ne=await call(fn,{action:'status'},{token:'t_noemail'});
      s.eq('a token with no email → 403 forbidden',ne.status,403);
      const a=await call(fn,{action:'status'},{token:'t_afnan'});
      s.eq('Afnan → 200',a.status,200);
      const am=await call(fn,{action:'status'},{token:'t_ammar'});
      s.eq('Ammar (email in mixed case) → 200',am.status,200);
      s.ok('every token check asked Firebase to refuse a REVOKED session',st.verify.length>0&&st.verify.every(v=>v.checkRevoked===true));
      const hdr=await call(fn,{action:'status'},{token:null,headers:{Authorization:'Bearer t_afnan'}});
      s.eq('the header is read whatever its case',hdr.status,200);
    }

    s.section('the request');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-attach.js',st);
      s.eq('a body that is not JSON → 400 json',(await call(fn,'{nope')).body.code,'json');
      s.eq('a JSON array → 400 json',(await call(fn,'[1,2]')).body.code,'json');
      s.eq('an oversized body → 413 too_large',(await call(fn,J({action:'status',pad:'x'.repeat(20000)}))).status,413);
      s.eq('an unknown action → 400 action',J([(await call(fn,{action:'delete'})).status,(await call(fn,{action:'delete'})).body.code]),J([400,'action']));
      const b64=await call(fn,Buffer.from(J({action:'status'})).toString('base64'),{b64:true});
      s.eq('a base64-encoded body is read',b64.status,200);
    }

    s.section('status — the Cloudinary key is set: private attachments');
    {
      const fn=loadFn('netlify/functions/ma-attach.js',{tokens:TOKENS});
      const r=(await call(fn,{action:'status'})).body;
      s.eq('configured',r.configured,true);
      s.eq('mode authenticated',r.mode,'authenticated');
      s.eq('nothing missing',J(r.missing),J([]));
      s.eq('the cloud is the app\'s',r.cloudName,'deww4lpym');
      s.eq('the cap is 25 MB',r.maxBytes,25*1024*1024);
      s.eq('images and PDF',J(r.types),J(['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']));
      s.eq('a look lasts 300 s',r.urlSeconds,300);
      s.ok('the note says private',/private/i.test(r.note)&&!/PUBLIC/.test(r.note));
    }

    s.section('sign — the key is set: a signed, authenticated upload');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-attach.js',st);
      const r=await call(fn,{action:'sign',file:FILE});
      const b=r.body;
      s.eq('200',r.status,200);
      s.eq('mode authenticated',b.mode,'authenticated');
      s.eq('the upload goes STRAIGHT to Cloudinary, to this cloud\'s image upload',b.uploadUrl,'https://api.cloudinary.com/v1_1/deww4lpym/image/upload');
      s.eq('the form fields are exactly these',J(Object.keys(b.fields).sort()),J(['allowed_formats','api_key','public_id','signature','timestamp','type']));
      s.ok('the name is minted here: ma/ + 64 hex',/^ma\/[0-9a-f]{64}$/.test(b.fields.public_id));
      s.eq('… and is the one the response names',b.publicId,b.fields.public_id);
      s.eq('type authenticated',b.fields.type,'authenticated');
      s.eq('only images and PDF are allowed on Cloudinary\'s side too',b.fields.allowed_formats,'jpg,png,webp,heic,heif,pdf');
      s.eq('the timestamp is now, in seconds',b.fields.timestamp,Math.floor(NOW/1000));
      s.eq('the api_key is sent',b.fields.api_key,KEY);
      const expect=indepSig({timestamp:b.fields.timestamp,public_id:b.fields.public_id,type:'authenticated',allowed_formats:b.fields.allowed_formats},SECRET);
      s.eq('the signature, recomputed independently, matches',b.fields.signature,expect);
      s.eq('the signature stops working after an hour',b.signatureExpiresAt,(Math.floor(NOW/1000)+3600)*1000);
      s.eq('the file is described back',J([b.name,b.mime,b.bytes,b.resourceType,b.type]),J(['bill-14-oct.pdf','application/pdf',204800,'image','authenticated']));
      s.ok('THE SECRET NEVER LEAVES THE SERVER',r.raw.indexOf(SECRET)<0);
      const again=(await call(fn,{action:'sign',file:FILE})).body;
      s.ok('a second signing names a different file',again.publicId!==b.publicId);
      s.eq('nothing was written to Firestore',J([Object.keys(st.docs).length,st.batches.length,st.txs.length]),J([0,0,0]));
    }

    s.section('sign — what is refused');
    {
      const fn=loadFn('netlify/functions/ma-attach.js',{tokens:TOKENS});
      const c=async f=>{const r=await call(fn,{action:'sign',file:f});return r.status+' '+(r.body.code||'');};
      s.eq('no file → 400 name',await c(undefined),'400 name');
      s.eq('over 25 MB → 413 size',await c({name:'big.pdf',type:'application/pdf',size:26*1024*1024}),'413 size');
      s.eq('a Word file → 415 type',await c({name:'bill.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:10}),'415 type');
      s.eq('an SVG → 415 type',await c({name:'x.svg',type:'image/svg+xml',size:10}),'415 type');
      s.eq('no size → 400 size',await c({name:'a.pdf',type:'application/pdf'}),'400 size');
    }

    s.section('url — a private file, through a link that expires');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-attach.js',st);
      const pid='ma/'+'c'.repeat(64);
      const r=await call(fn,{action:'url',file:{publicId:pid,format:'pdf',type:'authenticated',resourceType:'image'}});
      s.eq('200, signed',J([r.status,r.body.delivery]),J([200,'signed']));
      const u=new URL(r.body.url);
      s.eq('Cloudinary\'s download API, this cloud',u.origin+u.pathname,'https://api.cloudinary.com/v1_1/deww4lpym/image/download');
      const q=Object.fromEntries(u.searchParams);
      s.eq('the file asked for',J([q.public_id,q.format,q.type]),J([pid,'pdf','authenticated']));
      s.eq('it expires 5 minutes from now',Number(q.expires_at),Math.floor(NOW/1000)+300);
      s.eq('… and the response says when',r.body.expiresAt,(Math.floor(NOW/1000)+300)*1000);
      s.eq('the signature, recomputed independently, matches',q.signature,indepSig({timestamp:Number(q.timestamp),public_id:pid,format:'pdf',type:'authenticated',expires_at:Number(q.expires_at)},SECRET));
      s.ok('the secret is not in it',r.raw.indexOf(SECRET)<0);
      const d=await call(fn,{action:'url',download:true,file:{publicId:pid,format:'pdf',type:'authenticated'}});
      const dq=Object.fromEntries(new URL(d.body.url).searchParams);
      s.eq('asked as a download, it signs attachment=true',J([dq.attachment,dq.signature]),J(['true',indepSig({timestamp:Number(dq.timestamp),public_id:pid,format:'pdf',type:'authenticated',expires_at:Number(dq.expires_at),attachment:true},SECRET)]));
      const pub=await call(fn,{action:'url',file:{publicId:pid,format:'jpg',type:'upload'}});
      s.eq('a file made in the fallback is its public URL, which never expires',J([pub.body.url,pub.body.expiresAt,pub.body.delivery]),
        J(['https://res.cloudinary.com/deww4lpym/image/upload/'+pid+'.jpg',null,'public']));
      s.eq('not a Master Accounts file → 400 file',J([(await call(fn,{action:'url',file:{publicId:'profile/abc',format:'jpg',type:'upload'}})).body.code]),J(['file']));
      s.eq('a format that is not ours → 400 file',(await call(fn,{action:'url',file:{publicId:pid,format:'html',type:'authenticated'}})).body.code,'file');
      s.eq('no file → 400 file',(await call(fn,{action:'url'})).body.code,'file');
      s.eq('still nothing written to Firestore',Object.keys(st.docs).length+st.batches.length+st.txs.length,0);
    }
  });

  await withEnv(UNSIGNED_ENV,async()=>{
    s.section('the fallback — no Cloudinary key: public files, and it says so');
    {
      const fn=loadFn('netlify/functions/ma-attach.js',{tokens:TOKENS});
      const st=(await call(fn,{action:'status'})).body;
      s.eq('status: not configured, mode unsigned',J([st.configured,st.mode]),J([false,'unsigned']));
      s.eq('… naming both missing variables',J(st.missing),J(['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']));
      s.eq('… and the preset in use',st.preset,'groovy-ops');
      s.ok('… and saying the files are PUBLIC, for good',/PUBLIC/.test(st.note)&&/for good/.test(st.note));
      const r=await call(fn,{action:'sign',file:FILE});
      const b=r.body;
      s.eq('sign: mode unsigned, type upload',J([r.status,b.mode,b.type]),J([200,'unsigned','upload']));
      s.eq('the fields are the app\'s preset and a name minted here — nothing signed',J(Object.keys(b.fields).sort()),J(['public_id','upload_preset']));
      s.eq('the preset',b.fields.upload_preset,'groovy-ops');
      s.ok('the name is still 32 random bytes',/^ma\/[0-9a-f]{64}$/.test(b.fields.public_id));
      s.ok('the response warns it will be public',/public/.test(b.warning));
      s.eq('the same upload endpoint',b.uploadUrl,'https://api.cloudinary.com/v1_1/deww4lpym/image/upload');
      const u=await call(fn,{action:'url',file:{publicId:'ma/'+'d'.repeat(64),format:'pdf',type:'authenticated'}});
      s.eq('a PRIVATE file cannot be opened without the key → 503 not_configured',J([u.status,u.body.code]),J([503,'not_configured']));
      const p=await call(fn,{action:'url',file:{publicId:'ma/'+'d'.repeat(64),format:'pdf',type:'upload'}});
      s.eq('a public file still opens',p.body.delivery,'public');
    }
  });

  await withEnv({FIREBASE_SERVICE_ACCOUNT:undefined},async()=>{
    s.section('no service account — refused, never crashed');
    const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-attach.js',st);
    const r=await call(fn,{action:'status'});
    s.eq('503 not_configured',J([r.status,r.body.code]),J([503,'not_configured']));
    s.eq('and no token was checked',st.verify.length,0);
  });
  return s;
};

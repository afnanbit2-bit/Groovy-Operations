/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts attachments — netlify/functions/ma-attach.js (M1.5a, M1.6c)

   The real handler, driven with firebase-admin replaced (tests/ma-fake-
   admin.js). Every refusal a caller can meet, all three states (signed,
   with the Cloudinary key; public, only when the owners opted in with
   MA_ALLOW_PUBLIC_ATTACH=1; and not set up, which fails CLOSED), and the
   signature it hands out recomputed here by an independent signer — so the
   test holds the SCHEME, not the lib's copy of it. Cannot prove: that the
   live Cloudinary account accepts the upload, or that it honours
   overwrite=0 (the sandbox cannot reach Cloudinary at all).
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
const NOT_SET_UP='The server is not set up yet — the reason is in the Netlify function log.';
// Every env names MA_ALLOW_PUBLIC_ATTACH, so what the machine running the
// tests happens to have set can never decide a state.
const SIGNED_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:KEY,CLOUDINARY_API_SECRET:SECRET,CLOUDINARY_CLOUD_NAME:undefined,MA_ALLOW_PUBLIC_ATTACH:undefined};
// No key, and the owners chose public files on purpose.
const PUBLIC_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:undefined,CLOUDINARY_API_SECRET:undefined,CLOUDINARY_CLOUD_NAME:undefined,MA_ALLOW_PUBLIC_ATTACH:'1'};
// No key and no opt-in: attachments are not set up.
const NONE_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:undefined,CLOUDINARY_API_SECRET:undefined,CLOUDINARY_CLOUD_NAME:undefined,MA_ALLOW_PUBLIC_ATTACH:undefined};

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
const PID_D='ma/'+'d'.repeat(64);

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
      s.eq('Ammar → 200',am.status,200);
      // M1.6c: the rules compare the token's email exactly
      // (isMasterAccounts: `userEmail() in [...]`); so does this function now.
      const amx=await call(fn,{action:'status'},{token:'t_ammar_mixed'});
      s.eq('Ammar@groovy.op, another case → 403 forbidden, as the rules would say',J([amx.status,amx.body.code]),J([403,'forbidden']));
      const afc=await call(fn,{action:'status'},{token:'t_afnan_caps'});
      s.eq('… and AFNAN@groovy.op → 403',afc.status,403);
      const sgx=await call(fn,{action:'sign',file:FILE},{token:'t_ammar_mixed'});
      s.eq('… who gets no signature either',J([sgx.status,!!(sgx.body&&sgx.body.fields)]),J([403,false]));
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
      const res=await call(fn,{action:'status'});
      const r=res.body;
      s.eq('200',res.status,200);
      s.eq('state signed',r.state,'signed');
      s.eq('configured',r.configured,true);
      s.eq('mode authenticated',r.mode,'authenticated');
      s.eq('nothing missing, nothing invalid, no opt-in needed',J([r.missing,r.invalid,r.publicOptIn]),J([[],[],false]));
      s.eq('no preset — nothing goes up unsigned',r.preset,null);
      s.eq('the cloud is the app\'s',r.cloudName,'deww4lpym');
      s.eq('the cap is 25 MB',r.maxBytes,25*1024*1024);
      s.eq('images and PDF',J(r.types),J(['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']));
      s.eq('a look lasts 300 s',r.urlSeconds,300);
      s.ok('the note says private',/private/i.test(r.note)&&!/PUBLIC/.test(r.note));
      s.ok('… and it is not an error',r.error===undefined&&r.code===undefined);
    }

    s.section('sign — the key is set: a signed, authenticated upload that cannot overwrite');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-attach.js',st);
      const r=await call(fn,{action:'sign',file:FILE});
      const b=r.body;
      s.eq('200',r.status,200);
      s.eq('mode authenticated',b.mode,'authenticated');
      s.eq('the upload goes STRAIGHT to Cloudinary, to this cloud\'s image upload',b.uploadUrl,'https://api.cloudinary.com/v1_1/deww4lpym/image/upload');
      s.eq('the form fields are exactly these',J(Object.keys(b.fields).sort()),J(['allowed_formats','api_key','overwrite','public_id','signature','timestamp','type']));
      s.ok('the name is minted here: ma/ + 64 hex',/^ma\/[0-9a-f]{64}$/.test(b.fields.public_id));
      s.eq('… and is the one the response names',b.publicId,b.fields.public_id);
      s.eq('type authenticated',b.fields.type,'authenticated');
      s.eq('only images and PDF are allowed on Cloudinary\'s side too',b.fields.allowed_formats,'jpg,png,webp,heic,heif,pdf');
      // M1.6c (security F7): a signed upload overwrites by default and these
      // fields are good for an hour, so without this a replay could put a
      // different file under the same name. 0 is how Cloudinary's own Node
      // SDK sends overwrite:false (tests/ma-server.test.js holds its golden).
      s.eq('overwrite is 0 — the SDK\'s own spelling of overwrite:false',b.fields.overwrite,0);
      s.eq('the timestamp is now, in seconds',b.fields.timestamp,Math.floor(NOW/1000));
      s.eq('the api_key is sent',b.fields.api_key,KEY);
      const base={timestamp:b.fields.timestamp,public_id:b.fields.public_id,type:'authenticated',allowed_formats:b.fields.allowed_formats};
      s.eq('the signature, recomputed independently WITH overwrite=0, matches',b.fields.signature,indepSig(Object.assign({overwrite:0},base),SECRET));
      s.ok('… the same fields with overwrite dropped do not match — it is inside the signature',b.fields.signature!==indepSig(base,SECRET));
      s.ok('… nor with overwrite turned on',b.fields.signature!==indepSig(Object.assign({overwrite:1},base),SECRET)&&b.fields.signature!==indepSig(Object.assign({overwrite:true},base),SECRET));
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

  await withEnv(PUBLIC_ENV,async()=>{
    s.section('the fallback — no key, and MA_ALLOW_PUBLIC_ATTACH=1: public files, and it says so');
    {
      const fn=loadFn('netlify/functions/ma-attach.js',{tokens:TOKENS});
      const sr=await call(fn,{action:'status'});
      const st=sr.body;
      s.eq('status: 200, state public, not configured (no key), mode unsigned',J([sr.status,st.state,st.configured,st.mode]),J([200,'public',false,'unsigned']));
      s.eq('… naming both missing variables',J(st.missing),J(['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']));
      s.eq('… the opt-in that allowed it',st.publicOptIn,true);
      s.eq('… and the preset in use',st.preset,'groovy-ops');
      s.ok('… saying the files are PUBLIC, for good, and why',/PUBLIC/.test(st.note)&&/for good/.test(st.note)&&/MA_ALLOW_PUBLIC_ATTACH is set to 1/.test(st.note));
      const r=await call(fn,{action:'sign',file:FILE});
      const b=r.body;
      s.eq('sign: mode unsigned, type upload',J([r.status,b.mode,b.type]),J([200,'unsigned','upload']));
      s.eq('the fields are the app\'s preset and a name minted here — nothing signed',J(Object.keys(b.fields).sort()),J(['public_id','upload_preset']));
      s.eq('the preset',b.fields.upload_preset,'groovy-ops');
      s.ok('the name is still 32 random bytes',/^ma\/[0-9a-f]{64}$/.test(b.fields.public_id));
      s.ok('the response warns it will be public',/public/.test(b.warning));
      s.eq('the same upload endpoint',b.uploadUrl,'https://api.cloudinary.com/v1_1/deww4lpym/image/upload');
      const u=await call(fn,{action:'url',file:{publicId:PID_D,format:'pdf',type:'authenticated'}});
      s.eq('a PRIVATE file cannot be opened without the key → 503 not_configured',J([u.status,u.body.code]),J([503,'not_configured']));
      const p=await call(fn,{action:'url',file:{publicId:PID_D,format:'pdf',type:'upload'}});
      s.eq('a public file still opens',p.body.delivery,'public');
    }
  });

  await withEnv(NONE_ENV,async()=>{
    s.section('no key and no opt-in — attachments fail CLOSED');
    {
      const stt={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-attach.js',stt);
      const r=await call(fn,{action:'status'});
      const b=r.body||{};
      s.eq('status → 503 not_configured',J([r.status,b.code]),J([503,'not_configured']));
      s.eq('… whose body is still the status: state not_configured, no mode',J([b.state,b.configured,b.mode,b.publicOptIn]),J(['not_configured',false,null,false]));
      s.eq('… both keys named as missing',J([b.missing,b.invalid]),J([['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'],[]]));
      s.eq('… and no preset — nothing goes up',b.preset,null);
      s.ok('… its error is the sentence an owner reads: not set up, nothing uploaded, both ways out',
        /^Attachments are not set up: CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set in Netlify\./.test(b.error)&&/nothing is uploaded/.test(b.error)&&/MA_ALLOW_PUBLIC_ATTACH to 1/.test(b.error),b.error);
      s.eq('… the same sentence as its note',b.error,b.note);
      const sg=await call(fn,{action:'sign',file:FILE});
      s.eq('sign → 503 not_configured',J([sg.status,sg.body.code]),J([503,'not_configured']));
      s.eq('… with no name minted, no fields, no upload address — only the refusal',J(Object.keys(sg.body).sort()),J(['code','error']));
      s.eq('… saying the same thing',sg.body.error,b.error);
      const sb=await call(fn,{action:'sign',file:{name:'x.svg',type:'image/svg+xml',size:10}});
      s.eq('… before it even looks at the file',J([sb.status,sb.body.code]),J([503,'not_configured']));
      const up=await call(fn,{action:'url',file:{publicId:PID_D,format:'pdf',type:'authenticated'}});
      s.eq('a private file → 503 not_configured',J([up.status,up.body.code]),J([503,'not_configured']));
      const pub=await call(fn,{action:'url',file:{publicId:PID_D,format:'jpg',type:'upload'}});
      s.eq('a file that is ALREADY public still opens — refusing would un-publish nothing',J([pub.status,pub.body.delivery,pub.body.url]),
        J([200,'public','https://res.cloudinary.com/deww4lpym/image/upload/'+PID_D+'.jpg']));
      s.eq('nothing written to Firestore',Object.keys(stt.docs).length+stt.batches.length+stt.txs.length,0);
      const mx=await call(fn,{action:'status'},{token:'t_mustafa'});
      s.eq('someone who is not an owner still hears 403, not the set-up state',J([mx.status,mx.body.code,mx.body.state]),J([403,'forbidden',undefined]));
    }
  });

  await withEnv(Object.assign({},NONE_ENV,{MA_ALLOW_PUBLIC_ATTACH:'true'}),async()=>{
    s.section('an opt-in that is not exactly "1" is no opt-in');
    {
      const fn=loadFn('netlify/functions/ma-attach.js',{tokens:TOKENS});
      const r=await call(fn,{action:'status'});
      s.eq('"true" → still 503 not_configured, no opt-in',J([r.status,r.body.state,r.body.publicOptIn]),J([503,'not_configured',false]));
      s.ok('… and it says the variable is set, but not to 1',/MA_ALLOW_PUBLIC_ATTACH is set, but not to 1/.test(r.body.error),r.body.error);
      s.eq('sign → 503',(await call(fn,{action:'sign',file:FILE})).status,503);
    }
  });

  await withEnv({FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:'9876 5432',CLOUDINARY_API_SECRET:SECRET,CLOUDINARY_CLOUD_NAME:undefined,MA_ALLOW_PUBLIC_ATTACH:undefined},async()=>{
    s.section('a key that is not a key (it holds a space)');
    {
      const fn=loadFn('netlify/functions/ma-attach.js',{tokens:TOKENS});
      const r=await call(fn,{action:'status'});
      s.eq('is not signed: 503 not_configured, the key named invalid, nothing missing',J([r.status,r.body.state,r.body.invalid,r.body.missing]),J([503,'not_configured',['CLOUDINARY_API_KEY'],[]]));
      s.ok('… saying so, without echoing the key or the secret',/holds a space or a line break/.test(r.body.error)&&r.raw.indexOf('9876 5432')<0&&r.raw.indexOf(SECRET)<0);
      const sg=await call(fn,{action:'sign',file:FILE});
      s.eq('sign → 503: nothing is signed with a broken key, and nothing goes up public instead',J([sg.status,!!sg.body.fields]),J([503,false]));
    }
  });

  s.section('before the caller is known — "not set up", and not a word more');
  {
    const logs=[];const orig=console.error;
    console.error=(...a)=>{logs.push(a.map(x=>String(x)).join(' '));};
    try{
      await withEnv({FIREBASE_SERVICE_ACCOUNT:undefined},async()=>{
        const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-attach.js',st);
        const r=await call(fn,{action:'status'});
        s.eq('no service account → 503 not_configured',J([r.status,r.body.code]),J([503,'not_configured']));
        s.eq('… the one generic sentence',r.body.error,NOT_SET_UP);
        s.ok('… not naming the variable',!/FIREBASE|SERVICE_ACCOUNT|service account/i.test(r.raw));
        s.eq('… and no token was checked',st.verify.length,0);
        const anon=await call(fn,{action:'sign',file:FILE},{token:null});
        s.eq('someone with no token at all hears exactly the same',anon.raw,r.raw);
        s.ok('the reason is in the function log',logs.some(l=>l.indexOf('[ma-attach]')===0&&/FIREBASE_SERVICE_ACCOUNT/.test(l)),logs.join(' | '));
      });
      logs.length=0;
      await withEnv(SIGNED_ENV,async()=>{
        const PEM='Failed to parse private key: Error: Invalid PEM formatted message.';
        const st={tokens:TOKENS,initError:PEM};const fn=loadFn('netlify/functions/ma-attach.js',st);
        const r=await call(fn,{action:'status'});
        s.eq('an Admin SDK that will not start → 503 not_configured',J([r.status,r.body.code]),J([503,'not_configured']));
        s.eq('… the same generic sentence',r.body.error,NOT_SET_UP);
        s.ok('… never the SDK\'s own error',r.raw.indexOf('PEM')<0&&r.raw.indexOf('private key')<0&&!/Admin SDK/.test(r.raw));
        s.eq('… no token checked',st.verify.length,0);
        s.ok('the SDK\'s error is in the function log instead',logs.some(l=>l.indexOf('[ma-attach]')===0&&l.indexOf(PEM)>=0),logs.join(' | '));
      });
    }finally{console.error=orig;}
  }
  return s;
};

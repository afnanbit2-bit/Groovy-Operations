/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts, server side — netlify/lib/ma-server.js (M1.5a, M1.6c)

   The shared code the three functions stand on: who may call them, what a
   Master Accounts file is, and how Cloudinary is signed.

   - ONE owners list in four places: the functions' MA_OWNER_EMAILS, the
     rules' isMasterAccounts(), the client gate _MA_USERS and the core's
     MA_OWNERS. Widening one without the others fails here — compared
     EXACTLY, the way the rules compare a token's email (M1.6c).
   - Attachments are in one of three states (signed · public by opt-in ·
     not set up), and the third fails CLOSED (M1.6c, security F7).
   - The Cloudinary signature is recomputed by an INDEPENDENT implementation
     below (not the lib's), and pinned to golden values that Cloudinary's own
     Node SDK 2.11.0 produced for the same inputs when this was written. What
     that proves: we sign the way Cloudinary's SDK signs. What it cannot: that
     the live account accepts it — the sandbox cannot reach Cloudinary at all.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const harness=require('./harness');
const {suite,ROOT}=harness;
const {loadFn,TOKENS,FAKE_SA,withEnv}=require('./ma-fake-admin');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

// An independent signer: the scheme as Cloudinary documents it, written
// again from scratch so a bug in the lib's cannot hide in both.
const UNSIGNED=['file','api_key','resource_type','cloud_name','signature'];
function indepToSign(p){
  const keys=Object.keys(p).filter(k=>!UNSIGNED.includes(k)&&p[k]!==undefined&&p[k]!==null&&p[k]!=='');
  keys.sort((a,b)=>a<b?-1:a>b?1:0);
  return keys.map(k=>k+'='+(Array.isArray(p[k])?p[k].join(','):String(p[k]))).map(s=>s.split('&').join('%26')).join('&');
}
const indepSig=(p,secret)=>crypto.createHash('sha1').update(indepToSign(p)+secret).digest('hex');

module.exports=async function(){
  const s=suite('ma-server');
  const lib=loadFn('netlify/lib/ma-server.js',{});
  const core=require('../js/ma-core.js');

  s.section('one owners list — the functions, the rules, the client gate and the core');
  {
    const rules=read('firestore.rules');
    const m=/function isMasterAccounts\(\)\s*\{[\s\S]*?in\s*\[([^\]]*)\]/.exec(rules);
    const ruleEmails=m?(m[1].match(/'([^']+)'/g)||[]).map(x=>x.replace(/'/g,'')):[];
    const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],session:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'}});
    const client=JSON.parse(app.run('JSON.stringify(_MA_USERS)')).map(u=>u+'@groovy.op');
    const coreOwners=core.MA_OWNERS.map(u=>u+'@groovy.op');
    const server=lib.MA_OWNER_EMAILS.slice();
    // Exactly as written — no lower-casing: the rules compare the token's
    // email as it is, so two lists equal only after lower-casing would
    // disagree about Ammar@groovy.op.
    const same=a=>J(a.slice().sort());
    s.eq('the rules name two people',ruleEmails.length,2);
    s.eq('the functions\' MA_OWNER_EMAILS is the rules\' isMasterAccounts()',same(server),same(ruleEmails));
    s.eq('… is the client gate _MA_USERS (js/master-accounts.js)',same(server),same(client));
    s.eq('… and is the core\'s MA_OWNERS (js/ma-core.js)',same(server),same(coreOwners));
    s.ok('every server email is a lower-case @groovy.op address',server.every(e=>/^[a-z]+@groovy\.op$/.test(e)));
    const isMA=/function isMasterAccounts\(\)\s*\{([\s\S]*?)\n    \}/.exec(rules);
    const ue=/function userEmail\(\)\s*\{([^}]*)\}/.exec(rules);
    const mu=/function maUser\(\)\s*\{([^}]*)\}/.exec(rules);
    s.ok('the rules take the token\'s email as it is — no lower() in isMasterAccounts or userEmail()',
      !!isMA&&!!ue&&!/lower\(/.test(isMA[1])&&!/lower\(/.test(ue[1])&&/return request\.auth\.token\.email;/.test(ue[1]));
    s.ok('… and the rules\' username is the part before the @ (maUser)',!!mu&&/request\.auth\.token\.email\.split\('@'\)\[0\]/.test(mu[1]));
  }

  s.section('who is an owner — the verified email, compared exactly as the rules compare it');
  {
    const st={tokens:Object.assign({},TOKENS,{
      t_space:{uid:'u-sp',email:' afnan@groovy.op'},
      t_array:{uid:'u-ar',email:['afnan@groovy.op']},
      t_object:{uid:'u-ob',email:{toString(){return 'afnan@groovy.op';}}}
    })};
    const L=loadFn('netlify/lib/ma-server.js',st);
    const app=L.getAdmin();
    const who=async t=>{
      const r=await L.verifyOwner({headers:{authorization:'Bearer '+t}},app);
      return r.error?r.error.statusCode+' '+JSON.parse(r.error.body).code:'owner '+J([r.owner.uid,r.owner.email,r.owner.u]);
    };
    s.eq('afnan@groovy.op → the owner afnan (maUser\'s answer)',await who('t_afnan'),'owner '+J(['u-afnan','afnan@groovy.op','afnan']));
    s.eq('ammar@groovy.op → the owner ammar',await who('t_ammar'),'owner '+J(['u-ammar','ammar@groovy.op','ammar']));
    s.eq('Ammar@groovy.op, another case → 403, as the rules would refuse it',await who('t_ammar_mixed'),'403 forbidden');
    s.eq('AFNAN@groovy.op → 403',await who('t_afnan_caps'),'403 forbidden');
    s.eq('a leading space → 403, never trimmed into an owner',await who('t_space'),'403 forbidden');
    s.eq('an email that is not a string → 403',await who('t_array'),'403 forbidden');
    s.eq('… nor an object that turns into one when stringified',await who('t_object'),'403 forbidden');
    s.eq('no email → 403',await who('t_noemail'),'403 forbidden');
    s.eq('a manager → 403',await who('t_mustafa'),'403 forbidden');
    s.eq('a token Firebase refuses → 401',await who('t_forged'),'401 auth');
    s.ok('every check asked Firebase to refuse a revoked session',st.verify.length===10&&st.verify.every(v=>v.checkRevoked===true));
  }

  s.section('before the caller is known — "not set up", and not a word more (startAdmin)');
  {
    const logs=[];const orig=console.error;
    console.error=(...a)=>{logs.push(a.map(x=>String(x)).join(' '));};
    try{
      const L0=loadFn('netlify/lib/ma-server.js',{});
      s.eq('the sentence is the same for everyone',L0.NOT_SET_UP,'The server is not set up yet — the reason is in the Netlify function log.');
      for(const [label,sa] of [['no service account',undefined],['a service account that is not JSON','{not json']]){
        logs.length=0;
        await withEnv({FIREBASE_SERVICE_ACCOUNT:sa},async()=>{
          const L=loadFn('netlify/lib/ma-server.js',{});
          const b=L.startAdmin('ma-test');
          const body=b.error?JSON.parse(b.error.body):{};
          s.eq(label+' → 503 not_configured',J([b.error&&b.error.statusCode,body.code,!!b.app]),J([503,'not_configured',false]));
          s.eq('… saying only that the server is not set up',body.error,L.NOT_SET_UP);
          s.ok('… not which variable it is',!!b.error&&!/FIREBASE|SERVICE_ACCOUNT|service account|JSON/i.test(b.error.body));
          s.ok('… the reason is in the function log, tagged with the function',logs.length===1&&logs[0].indexOf('[ma-test]')===0&&/FIREBASE_SERVICE_ACCOUNT/.test(logs[0]),logs.join(' | '));
        });
      }
      logs.length=0;
      await withEnv({FIREBASE_SERVICE_ACCOUNT:FAKE_SA},async()=>{
        const PEM='Failed to parse private key: Error: Invalid PEM formatted message.';
        const L=loadFn('netlify/lib/ma-server.js',{initError:PEM});
        const b=L.startAdmin('ma-test');
        const body=b.error?JSON.parse(b.error.body):{};
        s.eq('an Admin SDK that will not start → 503 not_configured',J([b.error&&b.error.statusCode,body.code]),J([503,'not_configured']));
        s.eq('… the same sentence',body.error,L.NOT_SET_UP);
        s.ok('… never the SDK\'s own error',!!b.error&&b.error.body.indexOf('PEM')<0&&b.error.body.indexOf('private key')<0&&!/Admin SDK/.test(b.error.body));
        s.ok('… which goes to the function log instead',logs.length===1&&logs[0].indexOf('[ma-test]')===0&&logs[0].indexOf(PEM)>=0,logs.join(' | '));
        const ok=loadFn('netlify/lib/ma-server.js',{}).startAdmin('ma-test');
        s.ok('a server that starts hands back the Admin SDK, and nothing else',!!ok.app&&!ok.error&&typeof ok.app.auth==='function');
      });
    }finally{console.error=orig;}
  }

  s.section('the Cloudinary signature — the documented scheme, and the SDK\'s own answers');
  {
    const secret='test-secret-not-real';
    const pid='ma/'+'0123456789abcdef'.repeat(4);
    const up={api_key:'123456789012345',timestamp:1790000000,public_id:pid,type:'authenticated',allowed_formats:'jpg,png,webp,heic,heif,pdf'};
    // Golden: Cloudinary Node SDK 2.11.0, utils.api_sign_request(<the same params, no api_key>, secret).
    s.eq('an upload signature equals the one Cloudinary\'s SDK produced',lib.cloudinarySignature(up,secret),'4ce1612c26c630f194657451addc0a615b05b517');
    s.eq('the independent signer agrees with the golden value',indepSig(up,secret),'4ce1612c26c630f194657451addc0a615b05b517');
    s.eq('the string signed: sorted by key, api_key left out',lib.cloudinaryToSign(up),
      'allowed_formats=jpg,png,webp,heic,heif,pdf&public_id='+pid+'&timestamp=1790000000&type=authenticated');
    const reversed={};Object.keys(up).reverse().forEach(k=>{reversed[k]=up[k];});
    s.eq('insertion order does not change it',lib.cloudinarySignature(reversed,secret),lib.cloudinarySignature(up,secret));
    // M1.6c: a signed upload OVERWRITES by default, and its fields stay good
    // for an hour — so overwrite is signed too. Golden: SDK 2.11.0 sends
    // overwrite:false as 0 (build_upload_params → as_safe_bool), and
    // sign_request over exactly these parameters gives this signature (with a
    // literal `false` it would be 44b8895b…, a different request).
    const up0=Object.assign({},up,{overwrite:0});
    s.eq('with overwrite=0 — how the SDK sends overwrite:false — it equals the SDK\'s signature',lib.cloudinarySignature(up0,secret),'6439255890ad0034223dc75ce8dab932adc7b326');
    s.eq('… and the independent signer agrees',indepSig(up0,secret),'6439255890ad0034223dc75ce8dab932adc7b326');
    s.eq('overwrite=0 is IN the string signed, in its sorted place (0 is not a blank)',lib.cloudinaryToSign(up0),
      'allowed_formats=jpg,png,webp,heic,heif,pdf&overwrite=0&public_id='+pid+'&timestamp=1790000000&type=authenticated');
    s.ok('… so a request that drops it, or turns it on, no longer matches the signature',
      lib.cloudinarySignature(up0,secret)!==lib.cloudinarySignature(up,secret)&&lib.cloudinarySignature(up0,secret)!==lib.cloudinarySignature(Object.assign({},up,{overwrite:1}),secret));
    const withJunk=Object.assign({file:'data:…',resource_type:'image',cloud_name:'deww4lpym',signature:'x',blank:'',nothing:null,missing:undefined},up);
    s.eq('file, resource_type, cloud_name, signature and blanks are never signed',lib.cloudinaryToSign(withJunk),lib.cloudinaryToSign(up));
    s.eq('an & inside a value is written %26 (the SDK\'s v2)',lib.cloudinaryToSign({a:'x&y',b:1}),'a=x%26y&b=1');
    s.eq('an array joins with commas',lib.cloudinaryToSign({tags:['a','b'],timestamp:2}),'tags=a,b&timestamp=2');
    let agree=0;
    for(let i=0;i<300;i++){
      const p={timestamp:1700000000+i,public_id:lib.newPublicId(),type:i%2?'authenticated':'upload',format:['pdf','jpg','png'][i%3],expires_at:1700000300+i};
      if(i%5===0)p.attachment=true;
      if(i%7===0)p.api_key=String(100000+i);
      if(lib.cloudinarySignature(p,secret+i)===indepSig(p,secret+i))agree++;
    }
    s.eq('300 random parameter sets: the lib and the independent signer agree',agree,300);
  }

  s.section('a private file\'s link — Cloudinary\'s download API, expiring');
  {
    const cfg={cloudName:'deww4lpym',apiKey:'123456789012345',apiSecret:'test-secret-not-real',signed:true};
    const pid='ma/'+'0123456789abcdef'.repeat(4);
    const out=lib.privateDownloadUrl(cfg,{publicId:pid,format:'pdf',type:'authenticated',resourceType:'image'},1790000000123);
    const u=new URL(out.url);
    s.eq('it is the image download endpoint of this cloud',u.origin+u.pathname,'https://api.cloudinary.com/v1_1/deww4lpym/image/download');
    const q=Object.fromEntries(u.searchParams);
    s.eq('it carries exactly the SDK\'s parameters',J(Object.keys(q).sort()),J(['api_key','expires_at','format','public_id','signature','timestamp','type']));
    s.eq('it expires 300 s after it is made',Number(q.expires_at)-Number(q.timestamp),300);
    s.eq('… and says so, in ms',out.expiresAt,1790000300000);
    // Golden: SDK 2.11.0 utils.private_download_url(pid,'pdf',{…,expires_at:1790000300,timestamp:1790000000}).
    s.eq('its signature equals the SDK\'s',q.signature,'a8ffbbd2ab41b1f448a760870ea412a490605a83');
    const att=lib.privateDownloadUrl(cfg,{publicId:pid,format:'jpg',type:'authenticated',resourceType:'image'},1790000000000,{attachment:true});
    s.eq('asked as a download, it signs attachment=true like the SDK',new URL(att.url).searchParams.get('signature'),'dff6581b7252107c0347d292287cf8e75d8ff151');
    s.eq('a public file is its plain delivery URL',lib.publicUrl(cfg,{publicId:pid,format:'pdf',resourceType:'image'}),'https://res.cloudinary.com/deww4lpym/image/upload/'+pid+'.pdf');
    s.eq('deliveryUrl refuses a private file when no key is set',lib.deliveryUrl({signed:false},{publicId:pid,format:'pdf',type:'authenticated',resourceType:'image'},0).code,'not_configured');
  }

  s.section('names: minted here, unguessable');
  {
    const ids=new Set();for(let i=0;i<500;i++)ids.add(lib.newPublicId());
    s.eq('500 file names, 500 different',ids.size,500);
    s.ok('a file name is ma/ and 64 hex characters (32 random bytes)',[...ids].every(x=>/^ma\/[0-9a-f]{64}$/.test(x)));
    const t=lib.newToken();
    s.ok('a share token is 43 base64url characters (32 random bytes)',/^[A-Za-z0-9_-]{43}$/.test(t),t);
    s.eq('… and decodes to 32 bytes',Buffer.from(t,'base64url').length,32);
  }

  s.section('what a Master Accounts file is (assetRef)');
  {
    const pid='ma/'+'a'.repeat(64);
    const ok=x=>!!lib.assetRef(x).ref;
    s.ok('a private PDF',ok({publicId:pid,format:'pdf',type:'authenticated'}));
    s.ok('a public JPG made in the fallback',ok({publicId:pid,format:'JPG',type:'upload'}));
    s.ok('a public file under a preset\'s folder',ok({publicId:'groovy/'+pid,format:'pdf',type:'upload'}));
    s.ok('… but a private one may not carry a folder — it is only ever minted here',!ok({publicId:'groovy/'+pid,format:'pdf',type:'authenticated'}));
    s.ok('a name that is not ma/<64 hex> is refused',!ok({publicId:'ma/abc',format:'pdf',type:'authenticated'})&&!ok({publicId:'profile/'+'a'.repeat(64),format:'pdf',type:'upload'}));
    s.ok('a path trick is refused',!ok({publicId:'../'+pid,format:'pdf',type:'upload'})&&!ok({publicId:pid+'/x',format:'pdf',type:'upload'}));
    s.ok('an unknown delivery type is refused',!ok({publicId:pid,format:'pdf',type:'private'})&&!ok({publicId:pid,format:'pdf'}));
    s.ok('a raw or video resource is refused',!ok({publicId:pid,format:'pdf',type:'upload',resourceType:'raw'}));
    s.ok('a format that is not an image or a PDF is refused',!ok({publicId:pid,format:'html',type:'upload'})&&!ok({publicId:pid,format:'svg',type:'upload'}));
    s.eq('the format is normalised to lower case',lib.assetRef({publicId:pid,format:'PDF',type:'upload'}).ref.format,'pdf');
    s.eq('a missing resourceType means image',lib.assetRef({publicId:pid,format:'pdf',type:'upload'}).ref.resourceType,'image');
  }

  s.section('what the browser may upload (fileCheck)');
  {
    const fc=lib.fileCheck;
    s.eq('a JPEG photo',J(fc({name:'IMG_2031.JPG',type:'image/jpeg',size:812345})),J({name:'IMG_2031.JPG',mime:'image/jpeg',bytes:812345}));
    s.eq('a PDF',fc({name:'bill 14 Oct.pdf',type:'application/pdf',size:1}).mime,'application/pdf');
    s.eq('a .heic with no type (Windows) is read from its name',fc({name:'bill.heic',type:'',size:10}).mime,'image/heic');
    s.eq('image/jpg is image/jpeg',fc({name:'a.jpg',type:'image/jpg',size:10}).mime,'image/jpeg');
    s.eq('a name with no extension is fine when the type is',fc({name:'scan',type:'image/png',size:10}).mime,'image/png');
    const code=x=>{const r=fc(x);return r.code?r.status+' '+r.code:'ok';};
    s.eq('no name → 400 name',code({type:'image/png',size:10}),'400 name');
    s.eq('a blank name → 400 name',code({name:'   ',type:'image/png',size:10}),'400 name');
    s.eq('a name over 200 characters → 400 name',code({name:'a'.repeat(197)+'.pdf',type:'application/pdf',size:10}),'400 name');
    s.eq('a path in the name → 400 name',code({name:'x/../bill.pdf',type:'application/pdf',size:10}),'400 name');
    s.eq('a control character → 400 name',code({name:'bill\n.pdf',type:'application/pdf',size:10}),'400 name');
    s.eq('an .exe → 415 type',code({name:'bill.exe',type:'application/pdf',size:10}),'415 type');
    s.eq('an SVG → 415 type (it can carry script)',code({name:'logo.svg',type:'image/svg+xml',size:10}),'415 type');
    s.eq('an HTML page → 415 type',code({name:'x',type:'text/html',size:10}),'415 type');
    s.eq('a PDF that calls itself a JPEG → 415 type',code({name:'bill.pdf',type:'image/jpeg',size:10}),'415 type');
    s.eq('a photo that calls itself a PDF → 415 type',code({name:'bill.jpg',type:'application/pdf',size:10}),'415 type');
    s.eq('no size → 400 size',code({name:'a.pdf',type:'application/pdf'}),'400 size');
    s.eq('an empty file → 400 size',code({name:'a.pdf',type:'application/pdf',size:0}),'400 size');
    s.eq('a fractional size → 400 size',code({name:'a.pdf',type:'application/pdf',size:1.5}),'400 size');
    s.eq('exactly 25 MB is allowed',code({name:'a.pdf',type:'application/pdf',size:25*1024*1024}),'ok');
    s.eq('one byte more → 413 size',code({name:'a.pdf',type:'application/pdf',size:25*1024*1024+1}),'413 size');
  }

  s.section('the audit row is the core\'s own shape');
  {
    const meta={detail:'Link to JV-27-0001.pdf · 7 days',by:'afnan',at:1790000000000};
    const target={dt:'journal',id:'JV-27-0001',no:'JV-27-0001'};
    s.eq('a share row is exactly maAuditRow(\'share\', …)',J(lib.auditRow('share',target,meta)),J(core.maAuditRow('share',target,meta)));
    s.eq('a revoke row is exactly maAuditRow(\'revoke\', …)',J(lib.auditRow('revoke',target,meta)),J(core.maAuditRow('revoke',target,meta)));
    const bt={dt:'backup',id:'nightly-2026-09-29',no:'nightly-2026-09-29'},bm={by:'ma-backup',byName:'Nightly backup',at:5,detail:'Done'};
    const b=lib.auditRow('backup',bt,bm);
    s.eq('a backup row is exactly maAuditRow(\'backup\', …) — the core lists \'backup\' too',J(b),J(core.maAuditRow('backup',bt,bm)));
    s.eq('… so it keeps action \'backup\'',b.action,'backup');
    s.eq('… with the core\'s fields',J(Object.keys(b).sort()),J(Object.keys(core.maAuditRow('post',null,{})).sort()));
    s.eq('the actions the server writes are share, revoke, backup and rollup',J(lib.SERVER_AUDIT_ACTIONS),J(['share','revoke','backup','rollup']));
    s.ok('… every one of them in the core\'s MA_AUDIT_ACTIONS (nothing is relabelled \'post\')',lib.SERVER_AUDIT_ACTIONS.every(a=>core.MA_AUDIT_ACTIONS.indexOf(a)>=0));
    // The backup writes by:'ma-backup'. A client row must say by == maUser(),
    // an owner's username, so no page can write a row that claims to be the
    // backup — which is what lets Close & audit name that writer safely.
    const rules=read('firestore.rules');
    const ab=/match \/ma_audit\/\{id\}\s*\{([\s\S]*?)\n    \}/.exec(rules);
    s.ok('a client\'s audit row must say by == maUser() (the rules)',!!ab&&/request\.resource\.data\.by == maUser\(\)/.test(ab[1])&&/allow update, delete:\s*if false;/.test(ab[1]));
    s.ok('… and no owner, and no account at all, is called ma-backup',lib.MA_OWNER_EMAILS.every(e=>e.split('@')[0]!=='ma-backup')&&read('js/auth.js').indexOf("u:'ma-backup'")<0);
    let threw=false;try{lib.auditRow('delete',null,{});}catch(e){threw=true;}
    s.ok('an action the server has no business writing is refused',threw);
    s.ok('an audit id sorts by time and names who',/^1790000000000-afnan-[0-9a-f]{6}$/.test(lib.auditId(1790000000000,'afnan')));
  }

  s.section('the cloud and the preset are the ones the rest of the app uploads with');
  {
    const shared=read('js/shared.js');
    const m=/api\.cloudinary\.com\/v1_1\/([A-Za-z0-9_-]+)\//.exec(shared);
    s.eq('the default cloud is js/shared.js\'s',lib.CLOUDINARY_CLOUD,m&&m[1]);
    s.ok('the fallback preset is js/shared.js\'s',shared.indexOf("'upload_preset','"+lib.CLOUDINARY_PRESET+"'")>=0);
    const c=lib.cloudinaryConfig({CLOUDINARY_CLOUD_NAME:'other-cloud'});
    s.eq('CLOUDINARY_CLOUD_NAME overrides it',c.cloudName,'other-cloud');
    s.eq('… unless it is not a cloud name',lib.cloudinaryConfig({CLOUDINARY_CLOUD_NAME:'x/../y'}).cloudName,lib.CLOUDINARY_CLOUD);
    s.eq('with both keys: authenticated',lib.cloudinaryConfig({CLOUDINARY_API_KEY:'1',CLOUDINARY_API_SECRET:'s'}).mode,'authenticated');
  }

  s.section('attachments are in one of three states — and without the key or the opt-in, off');
  {
    const C=e=>lib.cloudinaryConfig(e);
    const st=c=>J([c.state,c.mode,c.signed,c.publicOptIn]);
    s.eq('both keys → signed: private files',st(C({CLOUDINARY_API_KEY:'1',CLOUDINARY_API_SECRET:'s'})),J(['signed','authenticated',true,false]));
    const none=C({});
    s.eq('neither key, no opt-in → not_configured, and no mode at all',st(none),J(['not_configured',null,false,false]));
    s.eq('… both keys named as missing, none invalid, no opt-in set',J([none.missing,none.invalid,none.publicOptInSet]),J([['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'],[],false]));
    s.eq('only the key → not_configured, the secret named',J([C({CLOUDINARY_API_KEY:'1'}).state,C({CLOUDINARY_API_KEY:'1'}).missing]),J(['not_configured',['CLOUDINARY_API_SECRET']]));
    s.eq('only the secret → not_configured, the key named',J([C({CLOUDINARY_API_SECRET:'s'}).state,C({CLOUDINARY_API_SECRET:'s'}).missing]),J(['not_configured',['CLOUDINARY_API_KEY']]));
    s.eq('a key of spaces is no key',C({CLOUDINARY_API_KEY:'   ',CLOUDINARY_API_SECRET:'s'}).missing[0],'CLOUDINARY_API_KEY');
    const pub=C({MA_ALLOW_PUBLIC_ATTACH:'1'});
    s.eq('no key and MA_ALLOW_PUBLIC_ATTACH=1 → public: the fallback, on purpose',st(pub),J(['public','unsigned',false,true]));
    s.eq('… still naming what is missing',J(pub.missing),J(['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']));
    s.eq('… the opt-in read around its spaces',C({MA_ALLOW_PUBLIC_ATTACH:' 1 '}).state,'public');
    for(const v of ['true','TRUE','yes','on','0','01','1.0','2']){
      const c=C({MA_ALLOW_PUBLIC_ATTACH:v});
      s.eq('MA_ALLOW_PUBLIC_ATTACH='+J(v)+' is no opt-in → not_configured (and it is noticed as set)',J([c.state,c.publicOptIn,c.publicOptInSet]),J(['not_configured',false,true]));
    }
    s.eq('an opt-in of spaces is not even set',C({MA_ALLOW_PUBLIC_ATTACH:'  '}).publicOptInSet,false);
    s.eq('the keys win over the opt-in: signed',C({CLOUDINARY_API_KEY:'1',CLOUDINARY_API_SECRET:'s',MA_ALLOW_PUBLIC_ATTACH:'1'}).state,'signed');
    const bad=C({CLOUDINARY_API_KEY:'12 34',CLOUDINARY_API_SECRET:'s'});
    s.eq('a key holding a space is invalid, not signed → not_configured',J([bad.state,bad.signed,bad.invalid,bad.missing]),J(['not_configured',false,['CLOUDINARY_API_KEY'],[]]));
    s.eq('… a secret holding a line break likewise',C({CLOUDINARY_API_KEY:'1',CLOUDINARY_API_SECRET:'ab\ncd'}).invalid[0],'CLOUDINARY_API_SECRET');
    s.eq('… and with the opt-in, an unusable key is the public fallback',C({CLOUDINARY_API_KEY:'12 34',CLOUDINARY_API_SECRET:'s',MA_ALLOW_PUBLIC_ATTACH:'1'}).state,'public');
    s.eq('the opt-in\'s name',lib.PUBLIC_OPT_IN,'MA_ALLOW_PUBLIC_ATTACH');

    const m=lib.attachNotSetUp(none);
    s.ok('the sentence an owner reads names what is missing',/^Attachments are not set up: CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set in Netlify\./.test(m),m);
    s.ok('… says nothing is uploaded, and why',/nothing is uploaded/.test(m)&&/public/.test(m)&&/for good/.test(m));
    s.ok('… and gives both ways out',/Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Netlify to keep files private/.test(m)&&/set MA_ALLOW_PUBLIC_ATTACH to 1 to allow public files on purpose/.test(m));
    const one=lib.attachNotSetUp(C({CLOUDINARY_API_KEY:'1'}));
    s.ok('one missing key is named alone, in the singular',/^Attachments are not set up: CLOUDINARY_API_SECRET is not set in Netlify\./.test(one),one);
    const inv=lib.attachNotSetUp(C({CLOUDINARY_API_KEY:'12 34',CLOUDINARY_API_SECRET:'sec ret'}));
    s.ok('keys holding spaces are called that — and never echoed',/CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET hold a space or a line break, so they are not keys/.test(inv)&&inv.indexOf('12 34')<0&&inv.indexOf('sec ret')<0,inv);
    const odd=lib.attachNotSetUp(C({MA_ALLOW_PUBLIC_ATTACH:'yes'}));
    s.ok('an opt-in set to something else is pointed out, its value not repeated',/\(MA_ALLOW_PUBLIC_ATTACH is set, but not to 1\.\)$/.test(odd)&&odd.indexOf('yes')<0,odd);
    s.ok('… and not mentioned when it is not set',m.indexOf('is set, but')<0);
  }

  s.section('a helper is not an endpoint, and nothing secret is committed');
  {
    s.ok('the shared code lives outside netlify/functions (the postex-core rule)',!fs.existsSync(path.join(ROOT,'netlify/functions/ma-server.js')));
    const files=['netlify/lib/ma-server.js','netlify/functions/ma-attach.js','netlify/functions/ma-share.js','netlify/functions/ma-backup.js'];
    files.forEach(f=>{
      const src=read(f);
      s.ok(f+' holds no private key',src.indexOf('BEGIN PRIVATE KEY')<0);
      s.ok(f+' reads the Cloudinary secret from the environment only',!/CLOUDINARY_API_SECRET\s*[:=]\s*['"`]/.test(src)&&!/api_?secret\s*[:=]\s*['"`][^'"`]/i.test(src));
    });
  }
  return s;
};

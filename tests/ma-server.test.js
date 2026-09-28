/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts, server side — netlify/lib/ma-server.js (M1.5a)

   The shared code the three functions stand on: who may call them, what a
   Master Accounts file is, and how Cloudinary is signed.

   - ONE owners list in four places: the functions' MA_OWNER_EMAILS, the
     rules' isMasterAccounts(), the client gate _MA_USERS and the core's
     MA_OWNERS. Widening one without the others fails here.
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
const {loadFn}=require('./ma-fake-admin');
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
    const norm=a=>J(a.map(x=>x.toLowerCase()).sort());
    s.eq('the rules name two people',ruleEmails.length,2);
    s.eq('the functions\' MA_OWNER_EMAILS is the rules\' isMasterAccounts()',norm(server),norm(ruleEmails));
    s.eq('… is the client gate _MA_USERS (js/master-accounts.js)',norm(server),norm(client));
    s.eq('… and is the core\'s MA_OWNERS (js/ma-core.js)',norm(server),norm(coreOwners));
    s.ok('every server email is a lower-case @groovy.op address',server.every(e=>/^[a-z]+@groovy\.op$/.test(e)));
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
    const b=lib.auditRow('backup',{dt:'backup',id:'nightly-2026-09-29',no:'nightly-2026-09-29'},{by:'ma-backup',byName:'Nightly backup',at:5,detail:'Done'});
    s.eq('a backup row keeps action \'backup\' (the core would file it as \'post\')',b.action,'backup');
    s.eq('… with the core\'s fields',J(Object.keys(b).sort()),J(Object.keys(core.maAuditRow('post',null,{})).sort()));
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
    s.eq('with neither key: the unsigned fallback, both named as missing',J([lib.cloudinaryConfig({}).mode,lib.cloudinaryConfig({}).missing]),J(['unsigned',['CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']]));
    s.eq('with only one of them: still the fallback',lib.cloudinaryConfig({CLOUDINARY_API_KEY:'1'}).mode,'unsigned');
    s.eq('with both: authenticated',lib.cloudinaryConfig({CLOUDINARY_API_KEY:'1',CLOUDINARY_API_SECRET:'s'}).mode,'authenticated');
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

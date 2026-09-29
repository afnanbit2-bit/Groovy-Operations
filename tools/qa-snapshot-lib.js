/* ─────────────────────────────────────────────────────────────────────────
   tools/qa-snapshot-lib.js — the PURE half of tools/qa-snapshot.js.

   No dependencies and no I/O, so tests/qa-snapshot.test.js can run it in CI
   (which installs nothing). Everything that decides WHAT MAY BE COPIED lives
   here, and nothing here can read or write a database:

     · guards      — where the tool may write, and where it may read from
     · secretScan  — documents it must never copy
     · masker      — deterministic masking of personal data

   Never log a value that came out of a document. Every function here that
   reports a problem reports a PATH and a REASON, not the content.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const crypto=require('crypto');

/* ── 1. guards ─────────────────────────────────────────────────────────── */

// The write target must be an emulator: a demo- project id, on this machine.
// A demo- id is the one Firebase itself refuses to route to a real project.
function checkTarget(t){
  const errs=[];
  if(!t||typeof t!=='object')return ['no target given'];
  if(typeof t.projectId!=='string'||!/^demo-[a-z0-9-]+$/.test(t.projectId))
    errs.push('target project id "'+t.projectId+'" is not a demo- emulator project — refusing to write anywhere else');
  if(!isLoopback(t.host))errs.push('target host "'+t.host+'" is not this machine (127.0.0.1 / localhost / ::1)');
  if(!Number.isInteger(t.port)||t.port<1||t.port>65535)errs.push('target port "'+t.port+'" is not a port');
  return errs;
}
function isLoopback(h){return h==='127.0.0.1'||h==='localhost'||h==='::1'||h==='[::1]';}

// Reading: either a real project through credentials, or (tests) a demo-
// emulator. A live source must not be the target, and is never given a host
// override — so it cannot be quietly redirected.
function checkSource(s,target){
  const errs=[];
  if(!s||typeof s!=='object')return ['no source given'];
  if(typeof s.projectId!=='string'||!s.projectId)errs.push('the source project id is unknown');
  if(target&&s.projectId===target.projectId)errs.push('source and target are the same project ("'+s.projectId+'")');
  if(s.emulator){
    if(!/^demo-[a-z0-9-]+$/.test(s.projectId||''))errs.push('a --source-emulator source must be a demo- project');
    if(!isLoopback(s.host))errs.push('a --source-emulator source must be on this machine');
  }else{
    if(!s.credentialsPath)errs.push('GOOGLE_APPLICATION_CREDENTIALS is not set — a live source needs a credentials file');
    if(/^demo-/.test(s.projectId||''))errs.push('a demo- project cannot be a live source');
  }
  return errs;
}

/* ── 2. secrets: never copy ───────────────────────────────────────────── */

// Whole collections that hold credentials. integration_secrets carries the
// Instagram token; passkeys / passkey_challenges carry WebAuthn public keys,
// emails and single-use challenges. None has a firestore.rules match block.
const SECRET_COLLECTIONS=['integration_secrets','passkeys','passkey_challenges'];
function isSecretCollection(name){return SECRET_COLLECTIONS.indexOf(String(name))>-1;}

// A field NAME that says it is a credential.
const SECRET_FIELD=/(^|[_-])(token|secret|password|passwd|apikey|api_key|private_?key|webhook|credential|authorization|bearer)s?($|[_-])|apikey|accesstoken|refreshtoken|clientsecret|privatekey/i;
// A VALUE that looks like one, wherever it is hiding.
const SECRET_VALUE=[
  [/AIza[0-9A-Za-z_-]{35}/,'Google API key'],
  [/sh(pat|pss|pca)_[0-9a-f]{20,}/i,'Shopify token'],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/,'Slack token'],
  [/EAA[A-Za-z0-9]{40,}/,'Meta access token'],
  [/ya29\.[0-9A-Za-z_-]{20,}/,'Google OAuth token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/,'private key'],
  [/\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/,'JWT'],
  [/\bBearer\s+[0-9A-Za-z._~+\/-]{20,}/,'bearer token'],
  [/https:\/\/hooks\.slack\.com\/services\//,'Slack webhook URL'],
  [/https:\/\/discord(app)?\.com\/api\/webhooks\//,'Discord webhook URL']
];
// Returns null, or a REASON string (never the offending value).
function secretScan(value,pathSoFar){
  const at=pathSoFar||'';
  if(value==null)return null;
  if(typeof value==='string'){
    for(const [re,why] of SECRET_VALUE)if(re.test(value))return why+' in value at '+(at||'(root)');
    return null;
  }
  if(Array.isArray(value)){
    for(let i=0;i<value.length;i++){const r=secretScan(value[i],at+'['+i+']');if(r)return r;}
    return null;
  }
  if(typeof value==='object'&&value.constructor===Object){
    for(const k of Object.keys(value)){
      if(SECRET_FIELD.test(k)&&value[k]!=null&&value[k]!=='')return 'credential-like field name "'+k+'" at '+(at||'(root)');
      const r=secretScan(value[k],at?at+'.'+k:k);if(r)return r;
    }
  }
  return null;
}

/* ── 3. masking ───────────────────────────────────────────────────────── */

const F_PHONE=/^(phone\d?|mobile|whatsapp|customerphone|contactphone|tel|telephone)$/i;
const F_ADDRESS=/^(address\d?|deliveryaddress|shippingaddress|billingaddress|street|streetaddress)$/i;
const F_CNIC=/^cnic$/i;
const F_BANK=/^(bankaccount|iban|accountnumber|accountno)$/i;
const F_EMAIL=/^email$/i;
// Customer / counterparty names. `person` is a runner or a contact — masked
// consistently, so the app's case-folded name matching still lines up.
const F_NAME=/^(customername|customer|consignee|consigneename|buyername|contactperson|person|payee)$/i;
// Names that are personal only in a given collection (the field is `name`
// everywhere, and a product's name is not personal).
const NAME_IN={employees:['name','fullName'],creators:['name'],user_profiles:[],wh_sales:[]};

// Collections that exist to hold personal data: copied ONLY with --include-pii
// and always masked.
const PII_COLLECTIONS=['employees','payslips','advance_requests','loans','wh_sales','creators','paid_pr_requests','dispatches','acct_vendors','hrm_notifications','user_profiles'];

// The owner's books. Master Accounts (js/ma-core.js, js/master-accounts.js) is
// readable by afnan and ammar ONLY (isMasterAccounts() in firestore.rules) and
// deliberately NOT by the QA account: Afnan's rule, "just for me and Ammar",
// which is why every other collection admits QA through isQaRead() and these
// do not. All of its collections are named ma_<something>.
//
// THIS is the one definition of that family, for everything QA-shaped:
//   · tests/qa-read-guard.test.js exempts exactly these collections from
//     "every read rule admits QA" — and asserts that they still do NOT
//   · tests/rules-emulator-qa.js expects the QA account to be REFUSED on them
//   · defaultCollections() below leaves them out of the snapshot
// Naming one explicitly (--collections ma_journal) is still honoured: that is
// a person with live credentials asking, the same as --include-pii for the
// personal-data collections. Nothing else is exempt, and the pattern needs at
// least one character after the prefix, so `ma_` alone and names such as
// `marketing_settings` are not caught.
const OWNER_ONLY_BOOKS=/^ma_[a-z0-9_]+$/;
function isOwnerOnlyBooks(name){return OWNER_ONLY_BOOKS.test(String(name));}

// What a run copies when --collections is not given: every collection the
// rules name, minus the personal-data collections (unless --include-pii),
// minus the owner's books. Pure, so CI can hold it without an emulator.
function defaultCollections(all,includePii){
  return all.filter(c=>(includePii||PII_COLLECTIONS.indexOf(c)<0)&&!isOwnerOnlyBooks(c));
}

function makeMasker(salt){
  const key=String(salt==null?'groovy-qa-mask-v1':salt);
  const h=(kind,v)=>crypto.createHmac('sha256',key).update(kind+'\u0000'+String(v)).digest('hex');
  // Same input -> same output, so a join on a masked field still joins.
  function digits(kind,v,n){
    const hex=h(kind,v);let out='';
    for(let i=0;out.length<n;i++)out+=String(parseInt(hex.substr((i*2)%60,2),16)%10);
    return out;
  }
  // Same length and separators; a Pakistani mobile keeps its leading 03 so
  // the app's own phone validation still accepts it.
  function phone(v){
    const s=String(v),n=s.replace(/\D/g,'').length;
    if(!n)return s;
    let d=digits('phone',s,n);
    if(n>=2&&/^\D*03/.test(s))d='03'+d.slice(2);
    let i=0;
    return s.replace(/\d/g,()=>d[i++]);
  }
  const M={
    phone,
    address:v=>'Masked address '+h('address',v).slice(0,6),
    cnic:v=>{const d=digits('cnic',v,13);return /-/.test(String(v))?d.slice(0,5)+'-'+d.slice(5,12)+'-'+d.slice(12):d;},
    bank:v=>'MASKED'+digits('bank',v,10),
    email:v=>{const s=String(v);return /@groovy\.op$/i.test(s)?s:'masked-'+h('email',s).slice(0,8)+'@example.invalid';},
    name:v=>'Masked '+h('name',v).slice(0,6)
  };
  function walk(coll,val,pathKey){
    if(val==null)return val;
    if(Array.isArray(val))return val.map(x=>walk(coll,x,pathKey));
    if(typeof val==='object'&&val.constructor===Object){
      const out={};
      for(const k of Object.keys(val)){
        const v=val[k];
        if(typeof v==='string'&&v!==''){
          if(F_PHONE.test(k))out[k]=M.phone(v);
          else if(F_ADDRESS.test(k))out[k]=M.address(v);
          else if(F_CNIC.test(k))out[k]=M.cnic(v);
          else if(F_BANK.test(k))out[k]=M.bank(v);
          else if(F_EMAIL.test(k))out[k]=M.email(v);
          else if(F_NAME.test(k))out[k]=M.name(v);
          else if(!pathKey&&(NAME_IN[coll]||[]).indexOf(k)>-1)out[k]=M.name(v);
          else out[k]=walk(coll,v,k);
        }else out[k]=walk(coll,v,k);
      }
      return out;
    }
    return val; // numbers, booleans, Timestamps, GeoPoints, Buffers — left as they are
  }
  return {maskDoc:(coll,data)=>walk(coll,data,''),phone:M.phone,name:M.name,address:M.address};
}

/* ── 4. arguments ─────────────────────────────────────────────────────── */

function parseArgs(argv){
  const a={collections:null,exclude:[],maskPii:false,includePii:false,acceptUnmasked:false,dryRun:false,clearTarget:false,seedAuth:false,limit:0,
    targetProject:'demo-groovy-ops',targetHost:'127.0.0.1',targetPort:8080,authHost:'127.0.0.1',authPort:9099,
    sourceEmulator:null,salt:null,help:false,unknown:[]};
  for(let i=2;i<argv.length;i++){
    const x=argv[i];const eq=x.indexOf('=');const k=eq>-1?x.slice(0,eq):x;const inline=eq>-1?x.slice(eq+1):null;
    const val=()=>inline!=null?inline:argv[++i];
    switch(k){
      case '--collections':a.collections=String(val()||'').split(',').map(s=>s.trim()).filter(Boolean);break;
      case '--exclude':a.exclude=String(val()||'').split(',').map(s=>s.trim()).filter(Boolean);break;
      case '--mask-pii':a.maskPii=true;break;
      case '--include-pii':a.includePii=true;break;
      case '--i-accept-unmasked-pii':a.acceptUnmasked=true;break;
      case '--dry-run':a.dryRun=true;break;
      case '--clear-target':a.clearTarget=true;break;
      case '--seed-auth':a.seedAuth=true;break;
      case '--limit':a.limit=parseInt(val(),10)||0;break;
      case '--target-project':a.targetProject=String(val());break;
      case '--target-host':a.targetHost=String(val());break;
      case '--target-port':a.targetPort=parseInt(val(),10);break;
      case '--source-emulator':{const v=String(val());const m=/^([^:]+):(\d+)$/.exec(v);a.sourceEmulator=m?{host:m[1],port:parseInt(m[2],10)}:{host:v,port:NaN};break;}
      case '--source-project':a.sourceProject=String(val());break;
      case '--salt':a.salt=String(val());break;
      case '-h':case '--help':a.help=true;break;
      default:a.unknown.push(x);
    }
  }
  return a;
}

// Personal data leaves the source only masked, unless the human says so twice.
function checkPii(a){
  const errs=[];
  const wantsPii=a.includePii||(a.collections||[]).some(c=>PII_COLLECTIONS.indexOf(c)>-1);
  if(!a.maskPii&&!a.acceptUnmasked)
    errs.push('refusing to copy without masking: pass --mask-pii (recommended) or, knowingly, --i-accept-unmasked-pii');
  if(a.maskPii&&a.acceptUnmasked)errs.push('--mask-pii and --i-accept-unmasked-pii contradict each other');
  return {errs,wantsPii};
}

module.exports={checkTarget,checkSource,isLoopback,SECRET_COLLECTIONS,isSecretCollection,secretScan,makeMasker,PII_COLLECTIONS,OWNER_ONLY_BOOKS,isOwnerOnlyBooks,defaultCollections,parseArgs,checkPii};

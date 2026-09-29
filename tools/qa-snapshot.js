#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   tools/qa-snapshot.js — copy a snapshot of live Firestore into the LOCAL
   EMULATOR so bugs can be reproduced and fixed against real-shaped data.

     GOOGLE_APPLICATION_CREDENTIALS=/path/to/read-only-key.json \
       node tools/qa-snapshot.js --mask-pii --collections pos,bundles,store_items

   The direction is one-way and it is enforced in code, not by convention:

     · READS from live through the credentials file named by
       GOOGLE_APPLICATION_CREDENTIALS. The class that touches the source has
       no write method at all (tests/qa-snapshot.test.js fails if one is
       ever added above `class Target`). Use a key with the Cloud Datastore
       Viewer role only — see "QA debug access" in CLAUDE.md.
     · WRITES only to an emulator: the target project id must be `demo-…`
       and the host must be this machine. Anything else is refused BEFORE
       the credentials file is opened.
     · FIRESTORE_EMULATOR_HOST is read once and then removed from the
       environment: the Firestore client lets that variable override the host
       of EVERY instance in the process, live source included, so leaving it
       set would silently redirect the read. Both instances get explicit
       settings instead.
     · Never copies a secret: the collections in SECRET_COLLECTIONS, any
       document with a credential-shaped field name or value (reported by
       PATH and REASON only), and nothing is ever printed from a document.
     · Personal data is copied only MASKED (--mask-pii): phones, addresses,
       customer / counterparty names, CNIC, bank accounts and emails, all
       deterministically (same input -> same output, so joins and the app's
       name matching still work). Unmasked needs --i-accept-unmasked-pii.

   Options
     --collections a,b,c     top-level collections (default: every collection in
                             firestore.rules, minus secrets, minus PII collections
                             unless --include-pii)
     --exclude a,b           skip these
     --mask-pii              mask personal data (required unless the flag below)
     --i-accept-unmasked-pii copy personal data as it is (the human's call)
     --include-pii           also copy the PII collections (employees, payslips…)
     --limit N               at most N documents per collection (0 = all)
     --dry-run               read and count, write nothing, touch no emulator
     --clear-target          empty the emulator's Firestore first (emulator REST)
     --seed-auth             create an Auth-emulator user per js/auth.js USER_DEFS
                             (password "qa-emulator-only": an emulator, not a secret)
     --target-project ID     default demo-groovy-ops  (must start with demo-)
     --target-host H --target-port P   default 127.0.0.1:8080
     --source-emulator H:P --source-project ID    read from ANOTHER EMULATOR
                             (tests only: fake source data, no credentials)
     --salt S                masking salt (default is fixed, so runs are repeatable)
   Exit codes: 0 done · 1 failed · 2 refused by a guard
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const lib=require('./qa-snapshot-lib.js');
const REPO=path.join(__dirname,'..');

function dep(p){return require(require.resolve(p,{paths:[process.env.EMU_DEPS,REPO,process.cwd()].filter(Boolean)}));}
function refuse(lines){
  console.error('\nREFUSED — nothing was read or written:');
  lines.forEach(l=>console.error('  · '+l));
  process.exit(2);
}
function rulesCollections(){
  const t=fs.readFileSync(path.join(REPO,'firestore.rules'),'utf8').split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
  const out=[];const re=/match\s+\/([A-Za-z0-9_]+)\/\{[A-Za-z0-9_]+\}\s*\{/g;let m;
  while((m=re.exec(t))){
    let d=0;for(let i=0;i<m.index;i++){if(t[i]==='{')d++;else if(t[i]==='}')d--;}
    if(d===2&&m[1]!=='databases')out.push(m[1]);
  }
  return out;
}
function userDefEmails(){
  const s=fs.readFileSync(path.join(REPO,'js','auth.js'),'utf8');
  const i=s.indexOf('const USER_DEFS=[');const j=s.indexOf('\n];',i);
  return (s.slice(i,j).match(/email:'([a-z0-9._-]+@groovy\.op)'/g)||[]).map(x=>/'(.*)'/.exec(x)[1]);
}

/* ── SOURCE: reads only. There is deliberately no write method here. ─────── */
class Source{
  constructor(db){this.db=db;}
  async listCollections(){return (await this.db.listCollections()).map(c=>c.id);}
  // Pages by document id so a big collection never sits in memory at once.
  async *docs(collRef,limit){
    let last=null,n=0;
    for(;;){
      let q=collRef.orderBy('__name__').limit(300);
      if(last)q=q.startAfter(last);
      const snap=await q.get();
      if(snap.empty)return;
      for(const d of snap.docs){yield d;last=d;n++;if(limit&&n>=limit)return;}
      if(snap.size<300)return;
    }
  }
}

/* ── TARGET: the only place anything is written, and only to an emulator. ── */
class Target{
  constructor(db,FirestoreCls){this.db=db;this.F=FirestoreCls;this.w=db.bulkWriter();this.w.onWriteError(e=>{console.error('  write failed on '+e.documentRef.path+': '+e.code);return false;});}
  ref(p){return this.db.doc(p);}
  // References cannot cross Firestore instances; rebuild them on this one.
  convert(v){
    if(v==null)return v;
    if(v instanceof this.F.DocumentReference)return this.db.doc(v.path);
    if(Array.isArray(v))return v.map(x=>this.convert(x));
    if(typeof v==='object'&&v.constructor===Object){const o={};for(const k of Object.keys(v))o[k]=this.convert(v[k]);return o;}
    return v;
  }
  set(p,data){return this.w.set(this.ref(p),this.convert(data));}
  async flush(){await this.w.close();}
}

async function main(){
  const a=lib.parseArgs(process.argv);
  if(a.help){console.log(fs.readFileSync(__filename,'utf8').split('*/')[0].replace(/^#!.*\n\/\*/,'').replace(/^ {3}/gm,''));return;}
  if(a.unknown.length)refuse(['unknown option(s): '+a.unknown.join(' ')]);

  // The emulator variable must not stay in the environment (see header).
  const envEmu=process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  if(envEmu&&!process.argv.some(x=>/^--target-(host|port)/.test(x))){
    const m=/^(.+):(\d+)$/.exec(envEmu);if(m){a.targetHost=m[1];a.targetPort=parseInt(m[2],10);}
  }

  const target={projectId:a.targetProject,host:a.targetHost,port:a.targetPort};
  const errs=lib.checkTarget(target);
  if(errs.length)refuse(errs);            // before the credentials file is even opened
  if(!a.dryRun&&!envEmu&&!process.argv.some(x=>/^--target-/.test(x))){
    // Nothing says an emulator is running; writing to 127.0.0.1:8080 unasked is a guess.
    refuse(['no emulator named: set FIRESTORE_EMULATOR_HOST (firebase emulators:exec does) or pass --target-host/--target-port']);
  }

  const pii=lib.checkPii(a);
  if(pii.errs.length)refuse(pii.errs);

  let source;
  if(a.sourceEmulator){
    source={emulator:true,projectId:a.sourceProject||'demo-qa-source',host:a.sourceEmulator.host,port:a.sourceEmulator.port};
  }else{
    const cred=process.env.GOOGLE_APPLICATION_CREDENTIALS;
    let pid=null;
    if(cred){try{pid=JSON.parse(fs.readFileSync(cred,'utf8')).project_id||null;}catch(e){refuse(['GOOGLE_APPLICATION_CREDENTIALS does not point at a readable JSON key file']);}}
    source={emulator:false,projectId:pid,credentialsPath:cred};
  }
  const serr=lib.checkSource(source,target);
  if(serr.length)refuse(serr);

  const {Firestore}=dep('@google-cloud/firestore');
  const all=rulesCollections();
  let colls=(a.collections||all.filter(c=>a.includePii||lib.PII_COLLECTIONS.indexOf(c)<0));
  colls=colls.filter(c=>a.exclude.indexOf(c)<0);

  console.log('QA snapshot');
  console.log('  source : '+(source.emulator?'EMULATOR '+source.host+':'+source.port:'LIVE (read-only)')+'  project '+source.projectId);
  console.log('  target : EMULATOR '+target.host+':'+target.port+'  project '+target.projectId+(a.dryRun?'   (dry run — nothing will be written)':''));
  console.log('  privacy: '+(a.maskPii?'personal data MASKED':'personal data UNMASKED (--i-accept-unmasked-pii)')+'   secrets: skipped');
  console.log('  collections ('+colls.length+'): '+colls.join(', '));

  const srcDb=new Firestore(source.emulator
    ?{projectId:source.projectId,host:source.host+':'+source.port,ssl:false,customHeaders:{Authorization:'Bearer owner'}}
    :{projectId:source.projectId,keyFilename:source.credentialsPath});
  const src=new Source(srcDb);
  let tgt=null;
  if(!a.dryRun){
    const tgtDb=new Firestore({projectId:target.projectId,host:target.host+':'+target.port,ssl:false,customHeaders:{Authorization:'Bearer owner'}});
    tgt=new Target(tgtDb,dep('@google-cloud/firestore'));
    if(a.clearTarget){
      const r=await fetch('http://'+target.host+':'+target.port+'/emulator/v1/projects/'+target.projectId+'/databases/(default)/documents',{method:'DELETE'});
      console.log('  cleared the emulator ('+r.status+')');
    }
  }
  const masker=lib.makeMasker(a.salt);
  const stat={read:0,written:0,skippedSecret:0,skippedColl:0};
  const skips=[];

  async function copyDoc(coll,docSnap){
    stat.read++;
    const data=docSnap.data();
    const why=lib.secretScan(data);
    if(why){stat.skippedSecret++;skips.push(docSnap.ref.path+' — '+why);return;}
    if(tgt){tgt.set(docSnap.ref.path,a.maskPii?masker.maskDoc(coll,data):data);stat.written++;}
    // sub-collections (comments, activity, revisions, trash…) — presence is transient
    for(const sub of await docSnap.ref.listCollections()){
      if(sub.id==='presence'||lib.isSecretCollection(sub.id))continue;
      for await(const d of src.docs(sub,a.limit))await copyDoc(coll,d);
    }
  }
  for(const c of colls){
    if(lib.isSecretCollection(c)){stat.skippedColl++;console.log('  '+c.padEnd(28)+'SKIPPED (secret-bearing collection)');continue;}
    const before={...stat};
    for await(const d of src.docs(srcDb.collection(c),a.limit))await copyDoc(c,d);
    console.log('  '+c.padEnd(28)+'read '+String(stat.read-before.read).padStart(6)+'   written '+String(stat.written-before.written).padStart(6)+(stat.skippedSecret>before.skippedSecret?'   skipped '+(stat.skippedSecret-before.skippedSecret)+' (secret-shaped)':''));
  }
  if(tgt)await tgt.flush();
  if(skips.length){console.log('\n  documents left out because they looked like they hold a credential (path — reason; values are never printed):');skips.slice(0,50).forEach(s=>console.log('    '+s));if(skips.length>50)console.log('    … '+(skips.length-50)+' more');}

  if(a.seedAuth&&!a.dryRun){
    const base='http://'+a.authHost+':'+a.authPort;
    if(!lib.isLoopback(a.authHost))refuse(['the Auth emulator host must be this machine']);
    let made=0;
    for(const email of userDefEmails()){
      const r=await fetch(base+'/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'qa-emulator-only',returnSecureToken:false})});
      if(r.ok)made++;
    }
    console.log('\n  Auth emulator: '+made+' users created (password "qa-emulator-only")');
  }
  console.log('\n  done — '+stat.read+' documents read, '+stat.written+' written, '+stat.skippedSecret+' left out as secret-shaped');
}
main().catch(e=>{console.error('FAILED: '+(e&&e.code||'')+' '+String(e&&e.message||e).split('\n')[0]);process.exit(1);});

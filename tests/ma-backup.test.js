/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts nightly backup — netlify/functions/ma-backup.js (M1.5a)

   The function against an in-memory Firestore (tests/ma-fake-admin.js) and a
   scripted Firestore Admin REST API, through every state a run can be in:
   not set up, before its hour, started, still running, done, failed at the
   start, failed later, lost, stuck, and started twice by accident.

   The rows it writes are then read by the app's OWN code — maNeedsAttention
   from js/ma-core.js, and _maLatestBackup plus the Close & audit page from
   js/master-accounts.js in the harness — so "the core reads them" is shown,
   not assumed. Cannot prove: that the bucket exists, that the service account
   may export to it, or that PITR is on — only the first real run can.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const {loadFn,FAKE_SA,withEnv,clone}=require('./ma-fake-admin');
const core=require('../js/ma-core.js');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

const TOKEN='ya29.test-token-not-real';
const T0=Date.UTC(2026,9,5,3,30,5);                // 5 Oct 2026 03:30:05 UTC = 08:30 PKT
const H=3600000;
const OP_PREFIX='projects/groovy-gatepass/databases/(default)/operations/';
const res=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});

// A scripted Firestore Admin API: exportDocuments starts an operation,
// operations/{id} reports whatever the test set it to.
function google(st,o){
  o=o||{};
  st.calls=[];st.ops=st.ops||{};let n=0;
  return async(url,init)=>{
    const body=init&&init.body?JSON.parse(init.body):null;
    st.calls.push({url,method:init.method,auth:(init.headers||{}).Authorization,body});
    if(o.throwAll)throw new Error('getaddrinfo ENOTFOUND firestore.googleapis.com');
    if(/:exportDocuments$/.test(url)){
      if(o.refuseSnapshot&&body.snapshotTime)return res(400,{error:{code:400,message:'Invalid snapshot_time',status:'INVALID_ARGUMENT'}});
      if(o.exportStatus)return res(o.exportStatus,{error:{code:o.exportStatus,message:o.exportMessage||'The caller does not have permission',status:'PERMISSION_DENIED'}});
      const name=OP_PREFIX+'ASA'+(++n)+'x';
      st.ops[name]={state:'PROCESSING',outputUriPrefix:body.outputUriPrefix};
      return res(200,{name,metadata:{'@type':'type.googleapis.com/google.firestore.admin.v1.ExportDocumentsMetadata',operationState:'PROCESSING',collectionIds:body.collectionIds,outputUriPrefix:body.outputUriPrefix}});
    }
    const m=/^https:\/\/firestore\.googleapis\.com\/v1\/(projects\/.+\/operations\/.+)$/.exec(url);
    if(m&&init.method==='GET'){
      if(o.checkThrows)throw new Error('socket hang up');
      const op=st.ops[m[1]];
      if(!op)return res(404,{error:{code:404,message:'Operation not found.',status:'NOT_FOUND'}});
      if(op.state==='PROCESSING')return res(200,{name:m[1],metadata:{operationState:'PROCESSING'}});
      if(op.state==='SUCCESSFUL')return res(200,{name:m[1],done:true,
        metadata:{operationState:'SUCCESSFUL',endTime:new Date(op.end).toISOString(),progressDocuments:{completedWork:'8431',estimatedWork:'8431'},progressBytes:{completedWork:'12884901',estimatedWork:'12900000'}},
        response:{'@type':'type.googleapis.com/google.firestore.admin.v1.ExportDocumentsResponse',outputUriPrefix:op.outputUriPrefix}});
      if(op.state==='FAILED')return res(200,{name:m[1],done:true,metadata:{operationState:'FAILED',endTime:new Date(op.end).toISOString()},
        error:{code:7,message:'service-1234@gcp-sa-firestore.iam.gserviceaccount.com does not have storage.objects.create access to the Google Cloud Storage object.'}});
    }
    return res(500,{error:{message:'the script has no answer for '+url}});
  };
}
// Every state made here, so the suite can end by naming any run that threw.
const ALL=[];
function mk(state,o){
  const st=Object.assign({},state||{});
  st.thrown=[];ALL.push(st);
  const fn=loadFn('netlify/functions/ma-backup.js',st);
  const g=google(st,o);
  // A run that throws is a finding to NAME, not a crash that silences the
  // rest of the suite (CLAUDE.md: every assertion null-safe): it is recorded,
  // returned as {threw}, and the last assertion lists them all.
  const run=async(now,env)=>{
    try{
      return await fn._test.runBackup({db:makeDb(st),env:env||ENV_OK,nowMs:now,fetch:g,getToken:()=>{
        if(st.tokenError)return Promise.reject(new Error(st.tokenError));
        return Promise.resolve(TOKEN);
      }});
    }catch(e){const m=String(e&&e.message||e);st.thrown.push(m);return{threw:m};}
  };
  return{st,fn,run};
}
// runBackup is handed a db, as the handler hands it app.firestore(); take
// the fake's own.
function makeDb(st){return require('./ma-fake-admin').makeAdmin(st).firestore();}
const ENV_OK={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,MA_BACKUP_BUCKET:'groovy-books-backups'};
const ENV_NOBUCKET={FIREBASE_SERVICE_ACCOUNT:FAKE_SA};
const rows=st=>Object.keys(st.docs).filter(k=>k.indexOf('ma_backups/')===0).sort().map(k=>Object.assign({id:k.split('/')[1]},st.docs[k]));
const first=st=>rows(st).slice(0,1)[0]||{};
async function tryRun(runFn,now,env){const rep=await runFn(now,env)||{};return{rep,threw:rep.threw||null};}
const audits=st=>Object.keys(st.docs).filter(k=>k.indexOf('ma_audit/')===0).map(k=>st.docs[k]);
// What the Today page would say about backups, from the core itself.
function said(row,nowMs){
  return core.maNeedsAttention({settings:core.maSettings(null),backup:row,nowMs})
    .filter(x=>/^ma_backups/.test(x.basis)).map(x=>x.state+': '+x.sentence);
}
function memLS(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];}};}
// The page code, with ma_backups holding what the function wrote.
async function pageApp(backups){
  const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:'ma-close',
    session:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
    globals:{localStorage:memLS(),doc:(_d,c,id)=>({col:c,id}),collection:(_d,c)=>({col:c}),query:c=>c,orderBy:()=>({}),limit:()=>({}),
      getDocs:async q=>({docs:(q.col==='ma_backups'?backups:[]).map(r=>({id:r.id,data:()=>clone(r)}))}),
      auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date().toUTCString()}}}}});
  await app.run('maLoad()');
  return app;
}

module.exports=async function(){
  const s=suite('ma-backup');
  const {MA_BACKUP_COLLECTIONS:COLS,START_UTC_MINUTES}=loadFn('netlify/functions/ma-backup.js',{})._test;

  s.section('what is exported — every collection of the books, and the feeders (§30)');
  {
    const inList=c=>COLS.indexOf(c)>=0;
    const lit=f=>Array.from(new Set((read(f).match(/'(ma_[a-z_]+)'/g)||[]).map(x=>x.replace(/'/g,''))));
    const client=lit('js/master-accounts.js').concat(lit('js/ma-core.js'));
    s.ok('the client names some collections to check',client.length>=10,client.length);
    const missC=client.filter(c=>!inList(c));
    s.ok('every ma_* collection the client reads or writes is exported',!missC.length,missC.join(', ')||undefined);
    const server=['netlify/lib/ma-server.js','netlify/functions/ma-attach.js','netlify/functions/ma-share.js','netlify/functions/ma-backup.js']
      .map(f=>(read(f).match(/collection\('([a-z_]+)'\)/g)||[]).map(x=>/'([a-z_]+)'/.exec(x)[1])).reduce((a,b)=>a.concat(b),[]);
    const missS=server.filter(c=>!inList(c));
    s.ok('… and every one the functions touch',!missS.length,missS.join(', ')||undefined);
    const rules=read('firestore.rules');
    const blocks=(rules.match(/match \/((?:ma|acct)_[a-z_]+)\//g)||[]).map(x=>/\/([a-z_]+)\//.exec(x)[1]);
    const missR=blocks.filter(c=>!inList(c));
    s.ok('every ma_* and acct_* block in firestore.rules is exported',blocks.length>=20&&!missR.length,missR.join(', ')||undefined);
    const feeders=['postex_orders','wh_sales','payroll_runs','payslips','shopify_orders'];
    s.ok('the plan\'s feeders: '+feeders.join(', '),feeders.every(inList));
    s.eq('no collection twice (the API requires it)',new Set(COLS).size,COLS.length);
    s.ok('every entry is a collection id',COLS.every(c=>/^[a-z][a-z0-9_]*$/.test(c)));
  }

  s.section('when — the schedule');
  {
    const toml=read('netlify.toml');
    const m=/\[functions\."ma-backup"\]\s*\n\s*schedule\s*=\s*"([^"]+)"/.exec(toml);
    s.eq('netlify.toml wakes ma-backup every hour at :30',m&&m[1],'30 * * * *');
    s.eq('the export itself starts at 03:30 UTC (08:30 PKT), the plan\'s time',START_UTC_MINUTES,3*60+30);
    s.eq('… a minute the schedule actually wakes on',START_UTC_MINUTES%60,30);
  }

  await withEnv(ENV_OK,async()=>{
    s.section('before 03:30 UTC: nothing starts');
    {
      const {st,run}=mk();
      const rep=await run(Date.UTC(2026,9,5,2,30,0));
      s.eq('no row, no call to Google',J([rows(st).length,st.calls.length]),J([0,0]));
      s.eq('the report says why',rep.start,'before 03:30 UTC');
    }

    s.section('03:30 UTC: the export starts, once');
    {
      const {st,run}=mk();
      const rep=await run(T0);
      s.eq('one call: exportDocuments',J(st.calls.map(c=>c.method+' '+c.url)),
        J(['POST https://firestore.googleapis.com/v1/projects/groovy-gatepass/databases/(default):exportDocuments']));
      const c=st.calls[0]||{body:{}};
      s.eq('with the service account\'s own token',c.auth,'Bearer '+TOKEN);
      s.eq('exporting exactly the list',J(c.body.collectionIds),J(COLS));
      s.eq('into the bucket, under ma-backups/<UTC stamp>',c.body.outputUriPrefix,'gs://groovy-books-backups/ma-backups/2026-10-05_033005Z');
      s.eq('as a consistent snapshot, a whole minute in the past',c.body.snapshotTime,'2026-10-05T03:29:00.000Z');
      const r=rows(st);
      s.eq('one row, named for the UTC day',J(r.map(x=>x.id)),J(['nightly-2026-10-05']));
      const x=r[0];
      s.eq('running, its result not known yet (ok null)',J([x.state,x.ok,x.configured]),J(['running',null,true]));
      s.eq('the operation is recorded',x.operation,OP_PREFIX+'ASA1x');
      s.eq('at = when it started (what the core ages it by)',x.at,T0);
      s.eq('how many collections — a number, as the Backups table prints it',x.collections,COLS.length);
      s.eq('consistent, from that snapshot',J([x.consistent,x.snapshotTime]),J([true,'2026-10-05T03:29:00.000Z']));
      s.eq('the report',rep.start,'started nightly-2026-10-05');
      s.eq('a started run writes no audit row yet — only its end does',audits(st).length,0);
      s.eq('the core: a running backup is not a concern',J(said(x,T0+H)),J([]));
      await run(T0+60000);
      s.eq('a second wake the same day starts nothing',st.calls.filter(q=>/exportDocuments/.test(q.url)).length,1);
      s.eq('… and writes no second row',rows(st).length,1);
    }

    s.section('the next wakes: still running, then done');
    {
      const {st,run}=mk();
      await run(T0);
      await run(T0+H);
      const x=first(st);
      s.eq('an hour later, still PROCESSING: still running',J([x.state,x.operationState,x.checkedAt]),J(['running','PROCESSING',T0+H]));
      s.eq('… only a GET was made — no second export',st.calls.map(c=>c.method).join(' '),'POST GET');
      st.ops[OP_PREFIX+'ASA1x'].state='SUCCESSFUL';st.ops[OP_PREFIX+'ASA1x'].end=T0+300000;
      const rep=await run(T0+2*H);
      const d=first(st);
      s.eq('done: ok, the documents, the bytes, the size',J([d.state,d.ok,d.documents,d.bytes,d.size]),J(['done',true,8431,12884901,'12.3 MB']));
      s.eq('ended when Firestore says it ended',d.endedAt,T0+300000);
      s.eq('the report',J(rep.resolved),J([{id:'nightly-2026-10-05',state:'done'}]));
      const a=audits(st);
      s.eq('one audit row: backup, by the nightly backup',J(a.map(x=>[x.action,x.by,x.byName,x.target.no])),J([['backup','ma-backup','Nightly backup','nightly-2026-10-05']]));
      s.eq('… saying what it did',(a[0]||{}).detail,'Done — 8,431 documents · 12.3 MB · '+COLS.length+' collections');
      s.eq('the row and its audit row were one batch',J(st.batches.map(b=>b.map(w=>w.op+' '+w.path.split('/')[0]))),J([['update ma_backups','set ma_audit']]));
      s.eq('the core: done an hour ago — fine',J(said(d,T0+3*H)),J([]));
      s.eq('the core: done 37 hours ago — a concern',J(said(d,T0+37*H)),J(['concern: The last backup ran 1 day ago.']));
      await run(T0+3*H);
      s.eq('a done run is never checked again',st.calls.length,3);
      await run(T0+24*H);
      s.eq('the next day at 03:30: a new row',J(rows(st).map(r=>r.id+' '+r.state)),J(['nightly-2026-10-05 done','nightly-2026-10-06 running']));
    }

    s.section('failures reach the Today page, in Google\'s own words');
    {
      const {st,run}=mk({},{exportStatus:403});
      await run(T0);
      const x=first(st);
      s.eq('refused at the start: failed at once',J([x.state,x.ok]),J(['failed',false]));
      s.eq('… with the reason',x.error,'Firestore refused the export (HTTP 403): The caller does not have permission');
      s.eq('… and an audit row',audits(st).map(a=>a.action+' '+a.detail).join(),'backup Failed — Firestore refused the export (HTTP 403): The caller does not have permission');
      s.eq('the core: a concern, naming it',J(said(x,T0+60000)),J(['concern: Last night’s backup failed: Firestore refused the export (HTTP 403): The caller does not have permission.']));
      await run(T0+H);
      s.eq('a failed day is not retried every hour (one attempt a day)',st.calls.filter(q=>/exportDocuments/.test(q.url)).length,1);
    }
    {
      const {st,run}=mk();
      await run(T0);
      st.ops[OP_PREFIX+'ASA1x'].state='FAILED';st.ops[OP_PREFIX+'ASA1x'].end=T0+120000;
      await run(T0+H);
      const x=first(st);
      s.eq('failed while running: failed, ok false',J([x.state,x.ok,x.operationState]),J(['failed',false,'FAILED']));
      s.ok('… with Google\'s message and code',/^The Firestore export failed: service-1234@gcp-sa-firestore\.iam\.gserviceaccount\.com does not have storage\.objects\.create access/.test(x.error)&&/\(code 7\)$/.test(x.error),x.error);
      s.ok('the core names it on Today',/^concern: Last night’s backup failed: The Firestore export failed/.test(said(x,T0+2*H)[0]||''));
    }
    {
      const {st,run}=mk({},{refuseSnapshot:true});
      await run(T0);
      const x=first(st);
      s.eq('a snapshot refused (400): retried once without it',J(st.calls.map(c=>!!c.body.snapshotTime)),J([true,false]));
      s.eq('… running, marked not consistent, with the reason',J([x.state,x.consistent,x.snapshotTime,/^A consistent snapshot was refused/.test(x.note)]),J(['running',false,null,true]));
    }
    {
      const {st,run}=mk();
      await run(T0);
      delete st.ops[OP_PREFIX+'ASA1x'];
      await run(T0+H);
      s.eq('an operation Firestore no longer knows: failed',first(st).error,'Firestore no longer knows this export (its operation was not found)');
    }
    {
      const {st,run}=mk();
      await run(T0);
      const m2=mk(st,{checkThrows:true});
      const rep=await m2.run(T0+H);
      const x=first(m2.st);
      s.eq('Google unreachable while checking: still running, not failed',J([x.state,x.ok]),J(['running',null]));
      s.ok('… the reason is kept',/^Could not ask Firestore how the export went: socket hang up/.test(x.lastCheckError||''),x.lastCheckError);
      s.eq('… and it will be asked again',J(rep.pending),J(['nightly-2026-10-05']));
    }
    {
      const {st,run}=mk();
      await run(T0);
      await run(T0+11*H);
      s.eq('PROCESSING after 11 hours: still running',first(st).state,'running');
      await run(T0+13*H);
      s.eq('after 12 hours: failed, "did not finish"',J([first(st).state,first(st).error]),J(['failed','The export did not finish within 12 hours']));
    }
    {
      const {st,run}=mk({docs:{'ma_backups/nightly-2026-10-04':{id:'nightly-2026-10-04',kind:'nightly',at:T0-24*H,state:'starting',ok:null,collections:25}}});
      await run(T0-24*H+10*60000);
      s.eq('claimed but never started, 10 minutes on: left alone',first(st).state,'starting');
      await run(T0-24*H+20*60000);
      s.ok('20 minutes on: failed — whether an export ran is unknown, and it says so',first(st).state==='failed'&&/stopped before it recorded an export, so whether one ran is unknown/.test(first(st).error),first(st).error);
    }
    {
      const {st,run}=mk({tokenError:'invalid_grant: Invalid JWT Signature.'});
      await run(T0);
      s.ok('no access token: failed, saying so',first(st).state==='failed'&&/^Could not get a Google access token for the service account: invalid_grant/.test(first(st).error),first(st).error);
    }
    {
      const st={};const m1=mk(st);
      await Promise.all([m1.run(T0),m1.run(T0+1)]);
      s.eq('two wakes at once start ONE export',m1.st.calls.filter(q=>/exportDocuments/.test(q.url)).length,1);
      s.ok('… because the loser\'s claim re-ran and found the day taken',(m1.st.txRetries||0)>=1,m1.st.txRetries);
    }
  });

  s.section('not set up: a state, never a success and never a crash');
  {
    const {st,run}=mk();
    const {rep,threw}=await tryRun(run,T0,ENV_NOBUCKET);
    s.eq('a missing bucket does not crash the run',threw,null);
    const x=first(st);
    s.eq('a row for the day, not_configured, ok FALSE',J([x.id,x.state,x.ok,x.configured]),J(['nightly-2026-10-05','not_configured',false,false]));
    s.eq('naming what is missing',J(x.missing),J(['MA_BACKUP_BUCKET']));
    s.eq('in words — no full stop: the core adds its own',x.error,'Backups are not set up yet — MA_BACKUP_BUCKET is not set in Netlify');
    s.eq('no call to Google, no audit row',J([st.calls.length,audits(st).length]),J([0,0]));
    s.eq('the report',rep.start,'not configured: MA_BACKUP_BUCKET is not set in Netlify');
    const told=x.at?said(x,T0+60000):[];
    s.ok('the core never reads it as a backup that worked',told.length===1&&/^concern: /.test(told[0]),J(told));
    s.eq('… in one sentence, with one full stop',told[0],'concern: Last night’s backup failed: Backups are not set up yet — MA_BACKUP_BUCKET is not set in Netlify.');
    await tryRun(run,T0+H,ENV_NOBUCKET);
    s.eq('one row a day, however many wakes',rows(st).length,1);
    await tryRun(run,T0+2*H,ENV_OK);
    s.eq('set up later the same day: the next wake runs a real backup',J([first(st).state,first(st).configured,first(st).error]),J(['running',true,null]));
    const bad=mk();
    await tryRun(bad.run,T0,{FIREBASE_SERVICE_ACCOUNT:FAKE_SA,MA_BACKUP_BUCKET:'Not A Bucket!'});
    s.eq('a bucket name that cannot be one: not set up, saying so',first(bad.st).error,'Backups are not set up yet — MA_BACKUP_BUCKET is not a Cloud Storage bucket name');
    const gs=mk();
    await tryRun(gs.run,T0,{FIREBASE_SERVICE_ACCOUNT:FAKE_SA,MA_BACKUP_BUCKET:'gs://groovy-books-backups/'});
    s.eq('gs://name/ is read as the bucket name',((gs.st.calls[0]||{}).body||{}).outputUriPrefix,'gs://groovy-books-backups/ma-backups/2026-10-05_033005Z');
    const noproj=mk();
    await tryRun(noproj.run,T0,{FIREBASE_SERVICE_ACCOUNT:JSON.stringify({private_key:'x',client_email:'y'}),MA_BACKUP_BUCKET:'groovy-books-backups'});
    s.eq('a service account with no project: not set up, saying so',first(noproj.st).error,'Backups are not set up yet — the service account names no project');
  }

  s.section('the app\'s own code reads these rows (js/master-accounts.js in the harness)');
  {
    const {st,run}=mk();
    await withEnv(ENV_OK,async()=>{
      await run(T0-24*H);
      st.ops[OP_PREFIX+'ASA1x'].state='SUCCESSFUL';st.ops[OP_PREFIX+'ASA1x'].end=T0-24*H+300000;
      await run(T0-23*H);
    });
    const done=rows(st);
    const app=await pageApp(done);
    s.eq('_maLatestBackup picks the function\'s row',JSON.parse(app.run('JSON.stringify(_maLatestBackup())')).id,'nightly-2026-10-04');
    const html=app.run("_maCloseTab='overview';_maPageHTML('ma-close')");
    s.ok('Close & audit → Backups prints it done, with the collections and the size',/<span class="ma-word fine">done<\/span>/.test(html)&&html.indexOf(COLS.length+' collections · 12.3 MB')>=0);
    const failed={id:'nightly-2026-10-05',kind:'nightly',at:done[0].at+24*H,state:'failed',ok:false,error:'Firestore refused the export (HTTP 403): The caller does not have permission',collections:COLS.length};
    const app2=await pageApp(done.concat([failed]));
    s.eq('a newer failed row is the latest',JSON.parse(app2.run('JSON.stringify(_maLatestBackup())')).id,'nightly-2026-10-05');
    s.ok('Today names the failure',/Last night’s backup failed: Firestore refused the export/.test(app2.run("_maPageHTML('ma-overview')")));
    const nc={id:'nightly-2026-10-07',kind:'nightly',at:Date.now(),state:'not_configured',ok:false,configured:false,error:'Backups are not set up yet — MA_BACKUP_BUCKET is not set in Netlify.',collections:COLS.length};
    const app3=await pageApp([nc]);
    s.ok('Today says a backup that is not set up is not set up',/Backups are not set up yet/.test(app3.run("_maPageHTML('ma-overview')")));
  }

  s.section('the handler');
  await withEnv({FIREBASE_SERVICE_ACCOUNT:undefined},async()=>{
    const st={};const fn=loadFn('netlify/functions/ma-backup.js',st);
    const r=await fn.handler({});
    s.eq('no service account: 503, and nothing written',J([r.statusCode,Object.keys(st.docs).length]),J([503,0]));
  });
  await withEnv(ENV_OK,async()=>{
    const st={docs:{'ma_backups/nightly-2026-10-04':{id:'nightly-2026-10-04',kind:'nightly',at:T0-24*H,state:'running',ok:null,collections:25,operation:OP_PREFIX+'ASAdone'}},ops:{}};
    st.ops[OP_PREFIX+'ASAdone']={state:'SUCCESSFUL',end:T0-23*H,outputUriPrefix:'gs://groovy-books-backups/ma-backups/2026-10-04_033005Z'};
    const fn=loadFn('netlify/functions/ma-backup.js',st);
    const saved=global.fetch;global.fetch=google(st);
    try{
      const r=await fn.handler({});
      s.eq('with one: 200',r.statusCode,200);
      s.eq('… the Admin SDK\'s credential gave the token',st.calls.every(c=>c.auth==='Bearer ya29.test-token-not-real')&&st.tokenCalls>=1,true);
      s.eq('… and the pending run was resolved',st.docs['ma_backups/nightly-2026-10-04'].state,'done');
    }finally{global.fetch=saved;}
  });

  s.section('no run threw');
  s.eq('not one run of the function threw, in any section above',J(ALL.map(st=>st.thrown).reduce((x,y)=>x.concat(y),[])),J([]));

  s.section('the rules: owners read ma_backups; no client writes it');
  {
    const rules=read('firestore.rules');
    const m=/match \/ma_backups\/\{id\}\s*\{([\s\S]*?)\n    \}/.exec(rules);
    s.ok('owners read',!!m&&/allow read:\s*if isMasterAccounts\(\);/.test(m[1]));
    s.ok('create, update and delete are false — the Admin SDK alone writes it',!!m&&/allow create, update, delete:\s*if false;/.test(m[1]));
  }
  return s;
};

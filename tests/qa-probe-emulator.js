/* ─────────────────────────────────────────────────────────────────────────
   tests/qa-probe-emulator.js — tools/qa-probe.js rehearsed against the
   Auth + Firestore emulators (never live). Run by hand:

     EMU_DEPS=/tmp/emu/node_modules /tmp/emu/node_modules/.bin/firebase \
       emulators:exec --only auth,firestore --project demo-groovy-ops \
       "node tests/qa-probe-emulator.js"

   It proves the probe (1) passes against the real rules, before and after the
   sandbox list exists, (2) FAILS LOUDLY against rules that do not confine QA,
   and (3) cleans up any probe document that landed.
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const REPO=path.join(__dirname,'..');
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment}=dep('@firebase/rules-unit-testing');
const PROJECT='demo-groovy-ops';
const [FH,FP]=(process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8080').split(':');
const DOCS='http://'+FH+':'+FP+'/v1/projects/'+PROJECT+'/databases/(default)/documents';
const AUTH='http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
let pass=0,fail=0;
const t=async(n,f)=>{try{await f();pass++;console.log('  ok   '+n);}catch(e){fail++;console.log('  FAIL '+n+'\n       '+String(e.message).split('\n')[0]);}};
const expect=(c,m)=>{if(!c)throw new Error(m);};
const probe=()=>{const r=cp.spawnSync(process.execPath,[path.join(REPO,'tools','qa-probe.js'),'--emulator'],{cwd:REPO,encoding:'utf8',env:Object.assign({},process.env,{QA_PASSWORD:'qa-emulator-only',QA_PROJECT:PROJECT})});return {code:r.status,out:(r.stdout||'')+(r.stderr||'')};};
const strays=async()=>{let n=0;for(const c of ['counters','pos','bug_reports','hrm_notifications','board_items','board_lists']){const j=await (await fetch(DOCS+'/'+c+'?pageSize=100',{headers:{Authorization:'Bearer owner'}})).json();n+=(j.documents||[]).filter(d=>/qa-probe-/.test(d.name)).length;}return n;};
(async()=>{
  const rules=fs.readFileSync(path.join(REPO,'firestore.rules'),'utf8');
  const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules,host:FH,port:Number(FP)}});
  const su=await (await fetch(AUTH+'/accounts:signUp?key=demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'claude@groovy.op',password:'qa-emulator-only',returnSecureToken:true})})).json();
  const uid=su.localId;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{const {doc,setDoc}=dep('firebase/firestore');const db=c.firestore();await setDoc(doc(db,'pos','PO-1'),{poNo:'PO-1'});await setDoc(doc(db,'employees','e1'),{name:'x'});});

  console.log('against the real rules (QA reads everything, writes only its sandbox)');
  await t('passes: every read works, the credential collections are refused, the sandbox list/item/comment are created and removed',async()=>{
    const r=probe();if(process.env.QA_VERBOSE)console.log(r.out);
    expect(r.code===0,'exit '+r.code+'\n'+r.out.slice(-900));
    expect(/ok   employees/.test(r.out)&&/ok   payslips/.test(r.out)&&/ok   acct_entries/.test(r.out)&&/ok   bug_reports/.test(r.out),'owner-only reads not exercised');
    expect(/ok   integration_secrets/.test(r.out)&&/ok   passkeys/.test(r.out),'credential collections not checked');
    expect(/ok   create a QA list it admins alone/.test(r.out)&&/ok   create an item in it, assigned to itself/.test(r.out)&&/ok   comment on it/.test(r.out)&&/ok   delete the item/.test(r.out)&&/ok   delete the list/.test(r.out),'sandbox lines missing');
    expect(/ok   …but NOT with a second person assigned/.test(r.out)&&/ok   …but NOT with a second person in it/.test(r.out),'people fences not exercised');
    expect(await strays()===0,'a probe document is still there');
  });
  await t('never prints the password',async()=>{expect(!probe().out.includes('qa-emulator-only'),'password in output');});
  await t('refuses to run without exactly one of --live / --emulator, or without a password',async()=>{
    const a=cp.spawnSync(process.execPath,[path.join(REPO,'tools','qa-probe.js')],{encoding:'utf8',env:Object.assign({},process.env,{QA_PASSWORD:'x'})});
    const b=cp.spawnSync(process.execPath,[path.join(REPO,'tools','qa-probe.js'),'--live','--emulator'],{encoding:'utf8',env:Object.assign({},process.env,{QA_PASSWORD:'x'})});
    const c=cp.spawnSync(process.execPath,[path.join(REPO,'tools','qa-probe.js'),'--emulator'],{encoding:'utf8',env:Object.assign({},process.env,{QA_PASSWORD:''})});
    expect(a.status===2&&b.status===2&&c.status===2,'exit codes '+[a.status,b.status,c.status]);
  });

  console.log('\nagainst rules that do NOT confine the account (the ruleset PUBLISHED today, before any isQa())');
  await t('fails loudly, names the kill switch, and deletes every document that landed',async()=>{
    const old=cp.execSync('git show '+(process.env.OLD_RULES_REF||'430fc28')+':firestore.rules',{cwd:REPO,encoding:'utf8',maxBuffer:1<<26});
    const env2=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules:old,host:FH,port:Number(FP)}});
    const r=probe();
    expect(r.code===1,'exit '+r.code+'\n'+r.out.slice(-500));
    expect(/THESE WRITES LANDED/.test(r.out)&&/KILL SWITCH/.test(r.out),'no alarm');
    expect(/counters\/qa-probe-/.test(r.out),'did not name what landed');
    expect(await strays()===0,'probe documents were left behind');
    await env2.cleanup();
  });

  console.log('\nagainst main\'s narrower rules (QA blocked from role-gated reads)');
  await t('fails on the read block: the probe checks the read-everything decision',async()=>{
    const main=cp.execSync('git show origin/main:firestore.rules',{cwd:REPO,encoding:'utf8',maxBuffer:1<<26});
    const env3=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules:main,host:FH,port:Number(FP)}});
    const r=probe();
    expect(r.code===1,'exit '+r.code+'\n'+r.out.slice(-500));
    expect(/FAIL employees/.test(r.out)&&/FAIL payslips/.test(r.out),'the blocked reads were not reported');
    expect(!/THESE WRITES LANDED/.test(r.out),'writes landed under main\'s rules');
    expect(await strays()===0,'probe documents were left behind');
    await env3.cleanup();
  });
  await env.cleanup();
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});

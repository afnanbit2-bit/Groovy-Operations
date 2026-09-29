/* ─────────────────────────────────────────────────────────────────────────
   tests/qa-snapshot-emulator.js — tools/qa-snapshot.js, end to end, in the
   Firestore emulator, with FAKE source data only. It never touches a
   credentials file for a real project and never runs the tool in live mode.

   Not a *.test.js (needs firebase-tools + Java + firebase-admin); run by hand:

     cd /tmp/emu && npm install firebase-tools@13 @firebase/rules-unit-testing firebase firebase-admin@13
     cd <repo> && EMU_DEPS=/tmp/emu/node_modules \
       /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore \
       --project demo-qa-snap "node tests/qa-snapshot-emulator.js"

   The "source" is a second demo- project in the same emulator (demo-qa-source)
   and the target is another (demo-qa-target); the tool's --source-emulator
   mode exists for exactly this.
   ───────────────────────────────────────────────────────────────────────── */
const fs=require('fs');
const os=require('os');
const path=require('path');
const cp=require('child_process');
const REPO=path.join(__dirname,'..');
const dep=p=>require(require.resolve(p,{paths:[process.env.EMU_DEPS,REPO,process.cwd()].filter(Boolean)}));
const {initializeTestEnvironment}=dep('@firebase/rules-unit-testing');
const fsdk=dep('firebase/firestore');fsdk.setLogLevel('silent');
const {doc,setDoc,getDoc,getDocs,collection,Timestamp}=fsdk;
const TOOL=path.join(REPO,'tools','qa-snapshot.js');

const FAKE_KEY='AIza'+'SyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1'.slice(0,35); // shaped like a Google API key, obviously fake
const [HOST,PORT]=(process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8080').split(':');

let pass=0,fail=0;
async function t(name,fn){try{await fn();pass++;console.log('  ok   '+name);}catch(e){fail++;console.log('  FAIL '+name+'\n       '+String(e&&e.message||e).split('\n')[0]);}}
const expect=(c,m)=>{if(!c)throw new Error(m);};

function tool(args,env){
  const r=cp.spawnSync(process.execPath,[TOOL].concat(args),{cwd:REPO,encoding:'utf8',env:Object.assign({},process.env,env||{})});
  return {code:r.status,out:(r.stdout||'')+(r.stderr||''),stdout:r.stdout||''};
}

(async()=>{
  const rules='rules_version = \'2\'; service cloud.firestore { match /databases/{d}/documents { match /{document=**} { allow read, write: if true; } } }';
  const src=await initializeTestEnvironment({projectId:'demo-qa-source',firestore:{rules,host:HOST,port:Number(PORT)}});
  const dst=await initializeTestEnvironment({projectId:'demo-qa-target',firestore:{rules,host:HOST,port:Number(PORT)}});
  // withSecurityRulesDisabled resolves to nothing, so carry the result out.
  const via=env=>async fn=>{let out;await env.withSecurityRulesDisabled(async c=>{out=await fn(c.firestore());});return out;};
  const S=via(src),D=via(dst);
  await src.clearFirestore();await dst.clearFirestore();

  await S(async db=>{
    await setDoc(doc(db,'pos','PO-1'),{poNo:'PO-1',qty:120,sizes:{M:60,L:60},created:Timestamp.fromMillis(1790000000000),rel:doc(db,'pos','PO-2')});
    await setDoc(doc(db,'pos','PO-2'),{poNo:'PO-2',qty:5});
    await setDoc(doc(db,'pos','PO-1','notes','n1'),{text:'sub-collection doc'});
    await setDoc(doc(db,'employees','e1'),{name:'Bilal Ahmed',cnic:'35202-1234567-1',phone:'0300-1112223',address:'House 5, Street 2, Lahore',bankAccount:'PK36SCBL0000001123456702',basicSalary:50000,email:'bilal@gmail.com'});
    await setDoc(doc(db,'wh_sales','SO0001'),{orderNo:'SO0001',customerName:'Sheikh Bilal',customerPhone:'0300-9225227',total:3490,lines:[{title:'TEE',qty:1}]});
    await setDoc(doc(db,'wh_sales','SO0002'),{orderNo:'SO0002',customerName:'Sheikh Bilal',customerPhone:'0300-9225227',total:100,lines:[]});
    await setDoc(doc(db,'gatepasses','GP-1'),{no:'GP-1',sale:{customer:'Ali Raza',phone:'0321-7654321',amount:900}});
    await setDoc(doc(db,'integration_secrets','instagram'),{token:'IGQVJ-not-a-real-token',kind:'page'});
    await setDoc(doc(db,'passkeys','cred1'),{uid:'u1',email:'a@groovy.op',publicKey:'MFkw'});
    await setDoc(doc(db,'passkey_challenges','ch1'),{challenge:'xyz'});
    await setDoc(doc(db,'store_items','SI-KEY'),{code:'SI-KEY',note:'pasted by mistake: '+FAKE_KEY});
    await setDoc(doc(db,'store_items','SI-TOKENFIELD'),{code:'SI-TOKENFIELD',apiKey:'whatever'});
    await setDoc(doc(db,'store_items','SI-OK'),{code:'SI-OK',balance:7});
    await setDoc(doc(db,'mood_boards','B1'),{title:'Board',visibility:'shared'});
    await setDoc(doc(db,'mood_boards','B1','presence','u1'),{at:1});
    await setDoc(doc(db,'mood_boards','B1','comments','c1'),{text:'hi',byUid:'u1'});
    // the owner's books (Master Accounts, ma_*): afnan + ammar only, and the QA account is refused them too
    await setDoc(doc(db,'ma_journal','JV-27-0001'),{kind:'money_out',amount:150000,status:'posted',note:'FAKE — an owner-only book entry'});
    await setDoc(doc(db,'ma_accounts','1010'),{code:'1010',name:'Cash in hand'});
  });
  const dump=async(path_)=>D(async db=>(await getDocs(collection(db,...path_))).docs.map(d=>({id:d.id,...d.data()})));
  const has=async(path_)=>D(async db=>(await getDoc(doc(db,...path_))).exists());
  const get=async(path_)=>D(async db=>(await getDoc(doc(db,...path_))).data());

  const BASE=['--source-emulator',HOST+':'+PORT,'--source-project','demo-qa-source','--target-project','demo-qa-target','--target-host',HOST,'--target-port',PORT];

  console.log('refusals — each must stop before anything is read or written');
  await t('a non-demo target project is refused (groovy-gatepass), with nothing written',async()=>{
    const r=tool(['--mask-pii','--target-project','groovy-gatepass','--target-host',HOST,'--target-port',PORT,'--source-emulator',HOST+':'+PORT,'--source-project','demo-qa-source']);
    expect(r.code===2,'exit '+r.code+' :: '+r.out.slice(0,200));
    expect(/not a demo- emulator project/.test(r.out),'message: '+r.out.slice(0,200));
    expect(!/source :/.test(r.out),'it got as far as planning a copy');
  });
  for(const p of ['groovy','demo','Demo-x','demo_x','groovy-gatepass-demo','demo-'])
    await t('target project "'+p+'" is refused',async()=>{const r=tool(['--mask-pii','--target-project',p,'--source-emulator',HOST+':'+PORT,'--source-project','demo-qa-source']);expect(r.code===2,'exit '+r.code);});
  await t('a target host that is not this machine is refused',async()=>{
    for(const h of ['firestore.googleapis.com','10.0.0.5','example.com']){
      const r=tool(['--mask-pii','--target-project','demo-qa-target','--target-host',h,'--target-port','8080','--source-emulator',HOST+':'+PORT,'--source-project','demo-qa-source']);
      expect(r.code===2&&/not this machine/.test(r.out),h+' -> exit '+r.code);
    }
  });
  await t('source and target being the same project is refused',async()=>{
    const r=tool(['--mask-pii','--target-project','demo-qa-source','--target-host',HOST,'--target-port',PORT,'--source-emulator',HOST+':'+PORT,'--source-project','demo-qa-source']);
    expect(r.code===2&&/same project/.test(r.out),'exit '+r.code+' '+r.out.slice(0,160));
  });
  await t('without --mask-pii it refuses (personal data is not copied by accident)',async()=>{
    const r=tool(BASE);expect(r.code===2&&/refusing to copy without masking/.test(r.out),'exit '+r.code);
    expect((await dump(['pos'])).length===0,'something was written');
  });
  await t('a live source with no credentials file is refused',async()=>{
    const r=tool(['--mask-pii','--target-project','demo-qa-target','--target-host',HOST,'--target-port',PORT],{GOOGLE_APPLICATION_CREDENTIALS:''});
    expect(r.code===2&&/GOOGLE_APPLICATION_CREDENTIALS/.test(r.out),'exit '+r.code+' '+r.out.slice(0,160));
  });
  await t('a live source whose key names a demo- project is refused (and no network is touched)',async()=>{
    const f=path.join(os.tmpdir(),'qa-fake-key-'+process.pid+'.json');fs.writeFileSync(f,JSON.stringify({type:'service_account',project_id:'demo-qa-target'}));
    try{const r=tool(['--mask-pii','--target-project','demo-qa-target','--target-host',HOST,'--target-port',PORT],{GOOGLE_APPLICATION_CREDENTIALS:f});expect(r.code===2,'exit '+r.code+' '+r.out.slice(0,200));}
    finally{fs.unlinkSync(f);}
  });
  await t('an unknown option is refused rather than ignored',async()=>{const r=tool(BASE.concat(['--mask-pii','--wipe-live']));expect(r.code===2,'exit '+r.code);});

  console.log('\nthe copy');
  const COLLS='pos,employees,wh_sales,gatepasses,integration_secrets,passkeys,passkey_challenges,store_items,mood_boards';
  let first;
  await t('runs to completion against fake data',async()=>{
    first=tool(BASE.concat(['--mask-pii','--include-pii','--clear-target','--collections',COLLS]));
    expect(first.code===0,'exit '+first.code+' :: '+first.out.slice(-400));
  });
  await t('ordinary data arrives intact: numbers, nested maps, Timestamps, sub-collections',async()=>{
    const po=await get(['pos','PO-1']);
    expect(po.qty===120&&po.sizes.M===60&&po.sizes.L===60,'fields '+JSON.stringify(po));
    expect(po.created&&po.created.toMillis&&po.created.toMillis()===1790000000000,'Timestamp lost');
    expect((await dump(['pos','PO-1','notes'])).length===1,'sub-collection not copied');
    expect((await dump(['mood_boards','B1','comments'])).length===1,'comments not copied');
  });
  await t('a document reference is rebuilt on the target',async()=>{
    const po=await get(['pos','PO-1']);
    expect(po.rel&&po.rel.path==='pos/PO-2','reference is '+(po.rel&&po.rel.path));
  });
  await t('presence (transient) is not copied',async()=>{expect((await dump(['mood_boards','B1','presence'])).length===0,'copied');});
  await t('SECRET collections are never copied: integration_secrets, passkeys, passkey_challenges',async()=>{
    for(const c of ['integration_secrets','passkeys','passkey_challenges'])expect((await dump([c])).length===0,c+' has documents in the target');
    expect(/integration_secrets\s+SKIPPED/.test(first.out),'the skip was not reported');
  });
  await t('a document holding a key-shaped value, or a credential-named field, is left out',async()=>{
    expect(!(await has(['store_items','SI-KEY'])),'value-shaped secret was copied');
    expect(!(await has(['store_items','SI-TOKENFIELD'])),'field-named secret was copied');
    expect(await has(['store_items','SI-OK']),'an ordinary sibling was dropped too');
  });
  await t('the skip is reported by PATH and REASON, and the value is never printed',async()=>{
    expect(/store_items\/SI-KEY/.test(first.out)&&/Google API key/.test(first.out),'no path/reason line');
    expect(!first.out.includes(FAKE_KEY)&&!first.out.includes('IGQVJ')&&!first.out.includes('whatever'),'a secret value reached the output');
  });
  await t('personal data is masked: phone, address, CNIC, bank, name, email, customer, nested sale.customer',async()=>{
    const e=await get(['employees','e1']);
    expect(e.phone!=='0300-1112223'&&/^03\d\d-\d{7}$/.test(e.phone),'phone '+e.phone);
    expect(/^Masked address /.test(e.address),'address '+e.address);
    expect(/^\d{5}-\d{7}-\d$/.test(e.cnic)&&e.cnic!=='35202-1234567-1','cnic '+e.cnic);
    expect(/^MASKED\d{10}$/.test(e.bankAccount),'bank '+e.bankAccount);
    expect(/^Masked /.test(e.name)&&e.name!=='Bilal Ahmed','name '+e.name);
    expect(/@example\.invalid$/.test(e.email),'email '+e.email);
    expect(e.basicSalary===50000,'numbers are not personal data and must survive');
    const w=await get(['wh_sales','SO0001']);
    expect(/^Masked /.test(w.customerName)&&w.customerPhone!=='0300-9225227'&&w.total===3490,'wh_sales '+JSON.stringify(w));
    const g=await get(['gatepasses','GP-1']);
    expect(/^Masked /.test(g.sale.customer)&&g.sale.phone!=='0321-7654321'&&g.sale.amount===900,'gatepass '+JSON.stringify(g));
  });
  await t('masking is deterministic: the same customer masks the same in two documents (joins still join)',async()=>{
    const a=await get(['wh_sales','SO0001']),b=await get(['wh_sales','SO0002']);
    expect(a.customerName===b.customerName&&a.customerPhone===b.customerPhone,a.customerName+' vs '+b.customerName);
  });
  await t('no raw personal value survives anywhere in the target',async()=>{
    const all=JSON.stringify([await dump(['employees']),await dump(['wh_sales']),await dump(['gatepasses'])]);
    for(const raw of ['Bilal Ahmed','35202-1234567-1','0300-1112223','House 5','PK36SCBL','Sheikh Bilal','0300-9225227','Ali Raza','0321-7654321','bilal@gmail.com'])
      expect(!all.includes(raw),'"'+raw+'" is still in the target');
  });
  await t('a second run is identical (idempotent, repeatable masking)',async()=>{
    const before=JSON.stringify([await dump(['employees']),await dump(['wh_sales'])]);
    const r=tool(BASE.concat(['--mask-pii','--include-pii','--collections',COLLS]));
    expect(r.code===0,'exit '+r.code);
    expect(JSON.stringify([await dump(['employees']),await dump(['wh_sales'])])===before,'output changed between runs');
  });
  await t('PII collections are NOT copied unless asked for (--include-pii)',async()=>{
    const r=tool(BASE.concat(['--mask-pii','--clear-target']));   // default collection set
    expect(r.code===2||r.code===0,'exit '+r.code);
    // default set reads collections named in firestore.rules; the fake source has employees/wh_sales in it
    expect((await dump(['employees'])).length===0&&(await dump(['wh_sales'])).length===0,'a PII collection was copied without --include-pii');
    expect((await dump(['pos'])).length===2,'default set did not copy pos: '+(await dump(['pos'])).length);
  });
  await t('the owner\'s books (ma_*, Master Accounts) are NOT copied by default — not even with --include-pii — and the rest still is',async()=>{
    const r=tool(BASE.concat(['--mask-pii','--include-pii','--clear-target']));   // default collection set, PII allowed
    expect(r.code===0,'exit '+r.code+' :: '+r.out.slice(-200));
    expect((await dump(['ma_journal'])).length===0&&(await dump(['ma_accounts'])).length===0,'an owner-only book was copied by default');
    expect(!/ma_journal|ma_accounts/.test(r.stdout),'the run listed an owner-only book among its collections');
    expect((await dump(['pos'])).length===2&&(await dump(['store_items'])).length>0,'the default set stopped copying ordinary collections');
  });
  await t('… but naming one with --collections is a deliberate ask, and is honoured',async()=>{
    const r=tool(BASE.concat(['--mask-pii','--clear-target','--collections','ma_journal']));
    expect(r.code===0,'exit '+r.code+' :: '+r.out.slice(-200));
    expect((await dump(['ma_journal'])).length===1,'an explicitly named ma_ collection was not copied');
  });
  await t('--dry-run reads and counts but writes nothing',async()=>{
    await dst.clearFirestore();
    const r=tool(BASE.concat(['--mask-pii','--dry-run','--collections','pos,store_items']));
    expect(r.code===0&&/dry run/.test(r.out),'exit '+r.code+' '+r.out.slice(-200));
    expect((await dump(['pos'])).length===0,'a dry run wrote');
  });
  await t('--limit caps documents per collection',async()=>{
    await dst.clearFirestore();
    const r=tool(BASE.concat(['--mask-pii','--limit','1','--collections','pos']));
    expect(r.code===0&&(await dump(['pos'])).length===1,'exit '+r.code+' docs '+(await dump(['pos'])).length);
  });

  console.log('\nthe source is only ever read');
  await t('nothing above `class Target` in the tool can write (the source path has no write call)',async()=>{
    const s=fs.readFileSync(TOOL,'utf8');
    const head=s.slice(0,s.indexOf('class Target'));
    const bad=head.match(/\.(set|create|update|delete|add|batch|bulkWriter|recursiveDelete|runTransaction|commit)\s*\(/g);
    expect(!bad,'write-shaped calls before class Target: '+bad);
  });
  await t('the source data was not modified by any run',async()=>{
    const n=await S(async db=>(await getDocs(collection(db,'pos'))).size);
    const e=await S(async db=>(await getDoc(doc(db,'employees','e1'))).data());
    expect(n===2&&e.name==='Bilal Ahmed'&&e.phone==='0300-1112223','source changed');
  });

  await src.cleanup();await dst.cleanup();
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});

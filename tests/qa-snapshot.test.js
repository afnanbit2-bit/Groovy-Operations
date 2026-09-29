/* ─────────────────────────────────────────────────────────────────────────
   tools/qa-snapshot-lib.js — what may be copied, and where (Sept 2026).
   Pure, no emulator: CI holds the guards, the secret scan and the masking.
   The tool end to end is tests/qa-snapshot-emulator.js.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {suite}=require('./harness');
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=v=>JSON.stringify(v);

module.exports=async function(){
  const s=suite('qa-snapshot');
  const stripped=read('firestore.rules').split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');

  s.section('tools/qa-snapshot-lib.js — what may be copied, and where');
  {
    const L=require('../tools/qa-snapshot-lib.js');
    const T=(o)=>Object.assign({projectId:'demo-groovy-ops',host:'127.0.0.1',port:8080},o||{});
    s.eq('the default emulator target is allowed',L.checkTarget(T()).length,0);
    for(const p of ['groovy-gatepass','groovy','demo','demo-','Demo-x','demo_x','groovy-gatepass-demo','','x'])
      s.ok('target project "'+p+'" is refused',L.checkTarget(T({projectId:p})).length>0);
    for(const h of ['firestore.googleapis.com','example.com','10.0.0.5','0.0.0.0','','127.0.0.1.evil.test'])
      s.ok('target host "'+h+'" is refused',L.checkTarget(T({host:h})).length>0);
    for(const h of ['127.0.0.1','localhost','::1'])s.eq('target host "'+h+'" is allowed',L.checkTarget(T({host:h})).length,0);
    s.ok('a bad port is refused',L.checkTarget(T({port:NaN})).length>0&&L.checkTarget(T({port:0})).length>0);
    s.ok('nothing at all is refused',L.checkTarget(null).length>0);
    const live={emulator:false,projectId:'groovy-gatepass',credentialsPath:'/x.json'};
    s.eq('a live source with a key is allowed',L.checkSource(live,T()).length,0);
    s.ok('a live source with no key is refused',L.checkSource({emulator:false,projectId:'groovy-gatepass'},T()).length>0);
    s.ok('a live source that IS the target project is refused',L.checkSource({emulator:false,projectId:'demo-groovy-ops',credentialsPath:'/x'},T()).length>0);
    s.ok('an emulator source must be demo- and local',L.checkSource({emulator:true,projectId:'groovy-gatepass',host:'127.0.0.1'},T()).length>0&&L.checkSource({emulator:true,projectId:'demo-src',host:'example.com'},T()).length>0);
    s.eq('a demo- emulator source is allowed',L.checkSource({emulator:true,projectId:'demo-src',host:'127.0.0.1'},T()).length,0);

    s.ok('integration_secrets, passkeys and passkey_challenges are secret collections',['integration_secrets','passkeys','passkey_challenges'].every(L.isSecretCollection));
    s.ok('no ordinary collection is',!['pos','employees','shopify_orders','settings'].some(L.isSecretCollection));
    // every secret collection really is one the rules give no match block
    s.ok('and none of them has a match block in firestore.rules (default deny)',L.SECRET_COLLECTIONS.every(c=>!new RegExp('match\\s+/'+c+'/').test(stripped)));

    const fakeKey='AIza'+'x'.repeat(35);
    s.ok('a Google API key value is caught, at any depth',/Google API key/.test(L.secretScan({a:{b:[{c:fakeKey}]}})||''));
    s.ok('a credential-named field is caught',/apiKey/.test(L.secretScan({apiKey:'v'})||''));
    for(const k of ['token','secret','password','access_token','refreshToken','clientSecret','private_key','webhook','Authorization'])
      s.ok('field name "'+k+'" is caught',!!L.secretScan({[k]:'v'}));
    s.ok('an EMPTY credential field is not a secret',L.secretScan({token:''})===null&&L.secretScan({token:null})===null);
    s.ok('a JWT, a PEM key, a Shopify token, a Slack webhook are caught',!!L.secretScan({x:'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'})&&!!L.secretScan({x:'-----BEGIN PRIVATE KEY-----'})&&!!L.secretScan({x:'shpat_'+'a'.repeat(32)})&&!!L.secretScan({x:'https://hooks.slack.com/services/T0/B0/xyz'}));
    s.ok('an ordinary document is not',L.secretScan({poNo:'PO-1',qty:120,sizes:{M:1},note:'tokenised fabric roll',lines:[{sku:'GP092-M'}]})===null);
    s.ok('the reason never contains the value',!(L.secretScan({k:fakeKey})||'').includes(fakeKey)&&!(L.secretScan({apiKey:'hunter2hunter2'})||'').includes('hunter2'));

    const m=L.makeMasker();
    const doc=m.maskDoc('wh_sales',{customerName:'Sheikh Bilal',customerPhone:'0300-9225227',address:'House 5, Street 2',cnic:'35202-1234567-1',email:'x@gmail.com',bankAccount:'PK36SCBL0000001123456702',title:'EFFORTLESS TEE',qty:3,lines:[{sku:'GP092-M'}],sale:{customer:'Ali Raza',phone:'0321-7654321',amount:900}});
    s.ok('a customer name is masked',/^Masked /.test(doc.customerName));
    s.ok('a phone keeps its shape and its leading 03, and changes',/^03\d\d-\d{7}$/.test(doc.customerPhone)&&doc.customerPhone!=='0300-9225227');
    s.ok('an address is masked',/^Masked address /.test(doc.address));
    s.ok('a CNIC keeps its 5-7-1 shape',/^\d{5}-\d{7}-\d$/.test(doc.cnic)&&doc.cnic!=='35202-1234567-1');
    s.ok('a bank account and an outside email are masked',/^MASKED/.test(doc.bankAccount)&&/@example\.invalid$/.test(doc.email));
    s.ok('a team email (@groovy.op) is left alone',m.maskDoc('x',{email:'raees@groovy.op'}).email==='raees@groovy.op');
    s.ok('nested fields are masked (sale.customer, sale.phone)',/^Masked /.test(doc.sale.customer)&&doc.sale.phone!=='0321-7654321');
    s.ok('numbers, product names and SKUs are untouched',doc.qty===3&&doc.title==='EFFORTLESS TEE'&&doc.lines[0].sku==='GP092-M'&&doc.sale.amount===900);
    s.ok('the same input masks the same (a join on a masked field still joins)',m.maskDoc('x',{customerName:'Sheikh Bilal'}).customerName===doc.customerName);
    s.ok('a different input masks differently',m.maskDoc('x',{customerName:'Sheikh Bilaal'}).customerName!==doc.customerName);
    s.ok('a different salt gives a different mask (the salt is the only key)',L.makeMasker('another').maskDoc('x',{customerName:'Sheikh Bilal'}).customerName!==doc.customerName);
    s.ok('`name` is personal in employees and creators, not in store_items',/^Masked /.test(m.maskDoc('employees',{name:'Bilal'}).name)&&/^Masked /.test(m.maskDoc('creators',{name:'Bilal'}).name)&&m.maskDoc('store_items',{name:'Thread'}).name==='Thread');
    s.ok('masking does not mutate its input',(()=>{const i={customerName:'A'};m.maskDoc('x',i);return i.customerName==='A';})());

    const a=L.parseArgs(['node','x','--mask-pii','--collections','pos,bundles','--limit','5','--dry-run']);
    s.ok('arguments parse',a.maskPii&&a.dryRun&&a.limit===5&&J(a.collections)===J(['pos','bundles']));
    s.eq('the default target is the demo- project',a.targetProject,'demo-groovy-ops');
    s.ok('unknown options are collected, not ignored',L.parseArgs(['node','x','--wipe-live']).unknown.length===1);
    s.ok('copying with neither masking flag is refused',L.checkPii(L.parseArgs(['node','x'])).errs.length>0);
    s.ok('--mask-pii satisfies it',L.checkPii(L.parseArgs(['node','x','--mask-pii'])).errs.length===0);
    s.ok('the two flags together are a contradiction',L.checkPii(L.parseArgs(['node','x','--mask-pii','--i-accept-unmasked-pii'])).errs.length>0);
  }

  return s;
};

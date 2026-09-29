/* ─────────────────────────────────────────────────────────────────────────
   QA / debugging access (Sept 2026, branch qa-access-v2) — the parts that
   can be checked WITHOUT an emulator, so CI (which installs nothing) holds
   them:
     · js/env.js: the emulator switch is inert off localhost, opt-in on it,
       and never points the emulator at a real project
   What the RULES allow is tests/rules-emulator-qa.js (real emulator); the
   read-scope guard is tests/qa-read-guard.test.js.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=v=>JSON.stringify(v);

module.exports=async function(){
  const s=suite('qa-access');
  s.section('js/env.js — which Firebase does the page talk to?');
  {
    const src=read('js/env.js');
    const run=(hostname,search,stored)=>{
      const store={};if(stored)store['gv-env']=stored;
      const sandbox={window:{},location:{hostname,search:search||''},document:{readyState:'complete',body:null,createElement(){return {setAttribute(){}}},addEventListener(){}}};
      sandbox.window.sessionStorage={getItem:k=>store[k]===undefined?null:store[k],setItem:(k,v)=>{store[k]=v;}};
      sandbox.sessionStorage=sandbox.window.sessionStorage;
      vm.runInNewContext(src,sandbox);
      return {env:sandbox.window.__GV_ENV,store};
    };
    const prod=run('groovyoperations.netlify.app','?env=emulator');
    s.eq('on the production host ?env=emulator does NOTHING',prod.env.mode,'live');
    s.eq('and points at the live project',prod.env.projectId,'groovy-gatepass');
    s.ok('and does not even remember the choice',!('gv-env' in prod.store));
    s.eq('a deploy-preview host is inert too',run('deploy-preview-12--groovyoperations.netlify.app','?env=emulator').env.mode,'live');
    s.eq('a look-alike host (localhost.evil.test) is inert',run('localhost.evil.test','?env=emulator').env.mode,'live');
    s.eq('localhost without the parameter is live (local development is unchanged)',run('localhost','').env.mode,'live');
    const emu=run('localhost','?env=emulator');
    s.eq('localhost + ?env=emulator is the emulator',emu.env.mode,'emulator');
    s.ok('on a demo- project id',/^demo-/.test(emu.env.projectId));
    s.ok('never the live project id',emu.env.projectId!=='groovy-gatepass');
    s.eq('127.0.0.1 works',run('127.0.0.1','?env=emulator').env.mode,'emulator');
    s.eq('[::1] works',run('[::1]','?env=emulator').env.mode,'emulator');
    s.eq('the choice is remembered for the tab',emu.store['gv-env'],'emulator');
    s.eq('and holds on the next page (no parameter)',run('localhost','','emulator').env.mode,'emulator');
    s.eq('?env=live turns it off again',run('localhost','?env=live','emulator').env.mode,'live');
    s.ok('the REST base points at the local emulator',/^http:\/\/127\.0\.0\.1:8080\/v1\/projects\/demo-/.test(emu.env.restBase));
    s.ok('the live REST base is the real one',/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/groovy-gatepass\//.test(prod.env.restBase));
    s.ok('the source carries no API key, token or secret of any kind',!/AIza|secret|token|password/i.test(src.replace(/window\.__GV_ENV|sessionStorage|gv-env/g,'')));
  }
  {
    const html=read('index.html');
    const store=read('js/store.js');
    s.ok('index.html loads js/env.js before the Firebase bootstrap',html.indexOf('/js/env.js')>-1&&html.indexOf('/js/env.js')<html.indexOf('<script type="module">'));
    s.ok('and after diagnostics.js, so its errors are still recorded first',html.indexOf('/js/diagnostics.js')<html.indexOf('/js/env.js'));
    const emuCfg=/const app=initializeApp\(EMU\s*\?\{([^}]*)\}/.exec(html);
    s.ok('the emulator config is a fake key on a demo project',!!emuCfg&&/apiKey:'demo-/.test(emuCfg[1])&&!/AIza/.test(emuCfg[1])&&/projectId:GVENV\.projectId/.test(emuCfg[1]));
    s.ok('the live config is untouched',/projectId:'groovy-gatepass',storageBucket:'groovy-gatepass\.appspot\.com'/.test(html));
    s.ok('emulator mode uses in-memory Firestore (no stale persistent cache)',/if\(EMU\)\{[\s\S]{0,300}firestoreDb=getFirestore\(app\);[\s\S]{0,200}connectFirestoreEmulator/.test(html));
    s.ok('Auth and the Realtime Database are pointed at the emulators too',/connectAuthEmulator\(authInst/.test(html)&&/connectDatabaseEmulator\(rtdbInst/.test(html));
    s.ok('js/store.js takes its REST base from the switch',/window\.__GV_ENV&&window\.__GV_ENV\.restBase/.test(store));
    s.ok('and no client file other than env.js and store.js hard-codes the live Firestore host',!fs.readdirSync(path.join(ROOT,'js')).some(f=>f.endsWith('.js')&&f!=='store.js'&&f!=='env.js'&&/firestore\.googleapis\.com/.test(read('js/'+f))));
  }


  s.section('hygiene');
  {
    const gi=read('.gitignore').split('\n').map(x=>x.trim());
    for(const p of ['.env','.env.*','*.pem','*.key','firestore-debug.log','ui-debug.log','firebase-debug.log'])
      s.ok('.gitignore lists '+p,gi.indexOf(p)>-1);
    s.eq('and lists nothing twice',gi.filter(x=>x&&x[0]!=='#').length,new Set(gi.filter(x=>x&&x[0]!=='#')).size);
    const tracked=require('child_process').execSync('git ls-files',{cwd:ROOT,encoding:'utf8'}).split('\n');
    s.ok('firestore-debug.log is no longer tracked',tracked.indexOf('firestore-debug.log')===-1);
    s.ok('no tracked file looks like a service-account key or a private key',!tracked.some(f=>/adminsdk|serviceaccount|\.pem$|\.key$|(^|\/)\.env/i.test(f)));
    const fj=JSON.parse(read('firebase.json'));
    s.ok('firebase.json has emulators for auth and firestore',fj.emulators&&fj.emulators.firestore&&fj.emulators.auth);
    s.ok('and still no hosting or storage block (a deploy cannot touch Netlify or Storage)',!fj.hosting&&!fj.storage&&!fj.database);
    s.ok('the emulators npm script names a demo- project',/emulators:start[^"]*--project demo-/.test(read('package.json')));
    s.ok('USER_DEFS holds exactly ONE claude entry and QA_ROLE is declared once',(read('js/auth.js').match(/\{u:'claude'/g)||[]).length===1&&(read('js/auth.js').match(/const QA_ROLE=/g)||[]).length===1);
  }
  return s;
};

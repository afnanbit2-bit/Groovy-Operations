/* ─────────────────────────────────────────────────────────────────────────
   Pattern Hub — js/patterns.js (M0: the article registry)

   What is worth guarding here (PATTERN_HUB_PLAN.md §15):
   - who can see and manage the hub, by USERNAME, and that firestore.rules
     names the same people — Arfat holds the manager role and must be OUT;
   - the code grammar: prefix + 3+ digits + optional -T/-B, uppercased,
     foreign schemes (TOPS-030) rejected;
   - the seed constant itself: 522 rows, unique, every one parseable, every
     prefix known, and needsPattern false for headwear ONLY;
   - minting: next-after-highest per category, an explicit code may fill a
     gap but never lowers the counter, an existing code is refused inside
     the transaction, a co-ord mints a Top+Bottom pair in ONE transaction,
     and a category doc whose counter fell below the seed maximum can never
     hand out a code the seed already used;
   - the loader cannot reject, and a FAILED read and an EMPTY registry
     render DIFFERENT screens — in particular the seed is never offered on
     a failed read (it would re-write everything over a live registry);
   - an article name is escaped on the way into HTML;
   - the seed is idempotent and batched at ≤400 writes;
   - every route in js/shared.js reaches the gate behind a typeof guard.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

const SESS={
  afnan:{uid:'u-af',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
  ammar:{uid:'u-am',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'},
  mustafa:{uid:'u-mu',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'},
  arfat:{uid:'u-ar',u:'arfat',name:'Arfat',role:'manager',email:'arfat@groovy.op'},
  uzaib:{uid:'u-uz',u:'uzaib',name:'Uzaib',role:'viewer',email:'uzaib@groovy.op'}
};

// A tiny Firestore: a Map of 'col/id' → data, with getDocs/doc/runTransaction
// wired to it, so a mint can be asserted against what it actually wrote.
function fakeFs(store){
  const meta={tx:0,txWrites:[]};
  const g={
    doc:(db,col,id)=>({col,id,key:col+'/'+id}),
    collection:(db,name)=>({name}),
    getDocs:async ref=>({docs:Array.from(store.entries()).filter(([k])=>k.startsWith(ref.name+'/')).map(([k,v])=>({id:k.slice(ref.name.length+1),data:()=>v}))}),
    runTransaction:async(db,fn)=>{
      meta.tx++;
      const writes=[];
      const tx={
        get:async r=>({exists:()=>store.has(r.key),data:()=>store.get(r.key)}),
        set:(r,p,o)=>{writes.push([r.key,p,o]);},
        update:(r,p)=>{writes.push([r.key,p,{merge:true}]);}
      };
      await fn(tx);   // a throw here aborts: nothing below runs
      writes.forEach(([k,p,o])=>{store.set(k,Object.assign({},(o&&o.merge&&store.get(k))||{},p));meta.txWrites.push(k);});
    }
  };
  return{globals:g,meta};
}
function app(o){
  o=o||{};
  return loadApp(Object.assign({files:['js/patterns.js'],currentPage:'pattern-hub',session:o.session||SESS.afnan},o));
}
const J=v=>JSON.stringify(v);

module.exports=async function(){
  const s=suite('patterns');

  // ── Audience ──────────────────────────────────────────────────────────
  s.section('audience — by username, Arfat out');
  for(const [u,want] of [['afnan',true],['ammar',true],['mustafa',true],['arfat',false],['uzaib',false]]){
    const a=app({session:SESS[u]});
    s.eq(u+' can see the hub: '+want,a.run('_canSeePatternHub()'),want);
    s.eq(u+' can manage: '+want,a.run('_canManagePatterns()'),want);
  }
  s.eq('no session → closed',app().run('session=null;_canSeePatternHub()'),false);
  s.ok('renderPatternHub refuses Arfat with a message, not a blank',/test phase/.test(app({session:SESS.arfat}).run('renderPatternHub()')));

  // ── Code grammar ──────────────────────────────────────────────────────
  s.section('code grammar');
  const a0=app();
  s.eq('GST062 → GST / 62',J(a0.run("_ptnParseCode('GST062')")),J({code:'GST062',prefix:'GST',num:62,suffix:''}));
  s.eq('lower-case and whitespace are normalised',a0.run("_ptnParseCode('  gp100 ').code"),'GP100');
  s.eq('GCO001-T carries its suffix',a0.run("_ptnParseCode('GCO001-T').suffix"),'-T');
  s.eq('TOPS-030 (foreign scheme) is not a code',a0.run("_ptnParseCode('TOPS-030')"),null);
  s.eq('a bare prefix is not a code',a0.run("_ptnParseCode('GP')"),null);
  s.eq('format pads to three digits',a0.run("_ptnFormatCode('GB',7,'')"),'GB007');
  s.eq('format does not truncate past 999',a0.run("_ptnFormatCode('GP',1000,'')"),'GP1000');
  s.eq('a co-ord number yields a Top and a Bottom',J(a0.run("_ptnCodesFor(_ptnCategory('GCO'),9)")),J(['GCO009-T','GCO009-B']));
  s.eq('a plain category yields one code',J(a0.run("_ptnCodesFor(_ptnCategory('GST'),77)")),J(['GST077']));

  // ── The seed constant ─────────────────────────────────────────────────
  s.section('the TAC seed — 522 rows, all sound');
  const seed=a0.run('_TAC_ARTICLES');
  s.eq('522 rows',seed.length,522);
  s.eq('every code is unique',new Set(seed.map(r=>r[0])).size,522);
  s.eq('every code parses',seed.filter(([c])=>!a0.run("_ptnParseCode("+J(c)+")")).length,0);
  s.eq('every prefix has a category',seed.filter(([c])=>!a0.run("_ptnCategoryOfCode("+J(c)+")")).length,0);
  s.eq('every row has a name',seed.filter(([,n])=>!String(n||'').trim()).length,0);
  const cats=a0.run('_TAC_CATEGORIES');
  s.eq('31 categories, unique prefixes',new Set(cats.map(c=>c.prefix)).size,31);
  s.eq('needsPattern is false for headwear only',J(cats.filter(c=>c.needsPattern===false).map(c=>c.prefix)),J(['GHW']));
  s.eq('only GCO is the Top/Bottom form',J(cats.filter(c=>c.form==='NNN-TB').map(c=>c.prefix)),J(['GCO']));
  const mx=a0.run('_ptnSeedMaxByPrefix()');
  s.eq('seed max GP = 103',mx.GP,103);
  s.eq('seed max GST = 76',mx.GST,76);
  s.eq('seed max GB = 27',mx.GB,27);
  s.eq('seed max GCO = 8',mx.GCO,8);
  s.eq('the denim codes title-matching recovered are all in the seed',
    ['GD004','GD006','GD009','GD010','GD011','GD012','GD013'].filter(c=>!seed.some(r=>r[0]===c)).length,0);

  // ── Minting ───────────────────────────────────────────────────────────
  s.section('minting — next-after-highest, transactional, never backwards');
  function mintApp(store,session){
    const f=fakeFs(store);
    const a=app({session:session||SESS.afnan,globals:f.globals});
    return{a,meta:f.meta,store};
  }
  async function mint(a,cat,name,code,needs){
    a.el('ptn-mint-cat').value=cat;a.el('ptn-mint-name').value=name;a.el('ptn-mint-code').value=code||'';
    a.el('ptn-mint-needs').checked=needs!==false;
    await a.run('window.ptnMint()');
  }
  {
    const st=new Map([['tac_categories/GST',{prefix:'GST',nextNumber:77}]]);
    const {a,meta,store}=mintApp(st);
    await a.run('loadPatternsData()');
    s.eq('preview of the next GST code is GST077',J(a.run("_ptnNextCodes('GST')")),J(['GST077']));
    await mint(a,'GST','Live in Pants | Olive');
    s.ok('GST077 written',store.has('articles/GST077'));
    s.eq('with the name, category, brand and source',J([store.get('articles/GST077').name,store.get('articles/GST077').category,store.get('articles/GST077').brand,store.get('articles/GST077').source]),J(['Live in Pants | Olive','GST','groovy','minted']));
    s.eq('needsPattern inherited from the form',store.get('articles/GST077').needsPattern,true);
    s.eq('counter moved to 78',store.get('tac_categories/GST').nextNumber,78);
    s.eq('one transaction',meta.tx,1);
    s.ok('toast names the code',a.state.toasts.some(t=>/Minted GST077/.test(t)));
    s.ok('it is in the in-memory list without a reload',a.run("tacArticles.some(x=>x.code==='GST077')"));
  }
  {
    const st=new Map([['tac_categories/GH',{prefix:'GH',nextNumber:42}]]);
    const {a,store}=mintApp(st);
    await a.run('loadPatternsData()');
    await mint(a,'GH','Gap filler','GH036');
    s.ok('an explicit unused code fills a gap',store.has('articles/GH036'));
    s.eq('…and the counter does NOT move backwards',store.get('tac_categories/GH').nextNumber,42);
  }
  {
    const st=new Map([['tac_categories/GST',{prefix:'GST',nextNumber:77}],['articles/GST001',{code:'GST001',name:'Baggy Trousers | Black'}]]);
    const {a,meta,store}=mintApp(st);
    await a.run('loadPatternsData()');
    await mint(a,'GST','Duplicate attempt','GST001');
    s.eq('an existing code is refused inside the transaction (no writes landed)',meta.txWrites.length,0);
    s.eq('the original is untouched',store.get('articles/GST001').name,'Baggy Trousers | Black');
    s.ok('and the refusal is said',a.state.toasts.some(t=>/already exists/.test(t)));
  }
  {
    const {a,meta}=mintApp(new Map());
    await mint(a,'GST','Wrong prefix','GP999');
    s.eq('a code from another category is refused before any transaction',meta.tx,0);
    await mint(a,'GST','');
    s.eq('a blank name is refused before any transaction',meta.tx,0);
  }
  {
    const st=new Map([['tac_categories/GCO',{prefix:'GCO',nextNumber:9}]]);
    const {a,meta,store}=mintApp(st);
    await a.run('loadPatternsData()');
    await mint(a,'GCO','The Drift Set | Olive');
    s.ok('a co-ord mints the Top…',store.has('articles/GCO009-T'));
    s.ok('…and the Bottom',store.has('articles/GCO009-B'));
    s.eq('…in ONE transaction',meta.tx,1);
    s.eq('counter at 10',store.get('tac_categories/GCO').nextNumber,10);
    await mint(a,'GCO','Suffix given','GCO010-T');
    s.eq('an explicit co-ord code with a suffix is refused (give the number only)',meta.tx,1);
  }
  {
    // A category doc whose counter is BELOW what the seed already used
    // (hand-edited, or written before a bigger seed) must never hand out a
    // code the TAC list already has.
    const st=new Map([['tac_categories/GP',{prefix:'GP',nextNumber:5}]]);
    const {a,store}=mintApp(st);
    await a.run('loadPatternsData()');
    await mint(a,'GP','Floor test');
    s.ok('a low counter is floored at seed max + 1 → GP104',store.has('articles/GP104'));
    s.eq('counter now 105',store.get('tac_categories/GP').nextNumber,105);
  }
  {
    const st=new Map([['tac_categories/GST',{prefix:'GST',nextNumber:77}]]);
    const {a,meta}=mintApp(st,SESS.arfat);
    await mint(a,'GST','Arfat tries');
    s.eq('Arfat cannot mint',meta.tx,0);
  }
  {
    // The default for the "needs a pattern" box comes from the CATEGORY —
    // false for headwear only — both when the form first renders and when
    // the category is switched. The mint itself honours whatever the box says.
    const {a,store}=mintApp(new Map());
    await a.run('loadPatternsData()');
    a.run("_ptnMintOpen=true;_ptnFilter.brand='groovy'");
    a.el('ptn-mint-cat').value='GHW';
    s.ok('the mint form renders headwear with the box UNticked',/id="ptn-mint-needs" >/.test(a.run('_ptnMintFormHTML()')));
    a.el('ptn-mint-cat').value='GST';
    s.ok('…and a garment category with it ticked',/id="ptn-mint-needs" checked/.test(a.run('_ptnMintFormHTML()')));
    a.el('ptn-mint-cat').value='GHW';a.el('ptn-mint-needs').checked=true;
    a.run('window.ptnMintCatChanged()');
    s.eq('switching the category to headwear unticks the box',a.el('ptn-mint-needs').checked,false);
    await mint(a,'GHW','New cap',undefined,false);
    s.eq('a headwear mint lands with needsPattern:false',store.get('articles/GHW015')&&store.get('articles/GHW015').needsPattern,false);
  }

  // ── Loader and the failed-vs-empty rule ───────────────────────────────
  s.section('loader cannot reject; failed ≠ empty');
  {
    const a=app({globals:{getDocs:async()=>{throw new Error('Missing or insufficient permissions');}}});
    let threw=false;try{await a.run('loadPatternsData()');}catch(e){threw=true;}
    s.eq('both reads refused → loader still resolves',threw,false);
    s.eq('both collections recorded as failed',J([a.run("_ptnLoadFailed('tac_categories')"),a.run("_ptnLoadFailed('articles')")]),J([true,true]));
    const html=a.run('renderPatternHub()');
    s.ok('renders the error card',/id="ptn-load-error"/.test(html));
    s.ok('…that names the collections and the rules republish',/tac_categories, articles/.test(html)&&/firestore\.rules/.test(html));
    s.ok('…with Retry',/ptnRetryLoad/.test(html));
    s.ok('the seed is NOT offered on a failed read',!/ptn-seed-card/.test(html));
  }
  {
    const a=app({globals:{
      collection:(db,name)=>({name}),
      getDocs:async ref=>{if(ref.name==='articles')throw new Error('denied');return{docs:[]};}
    }});
    await a.run('loadPatternsData()');
    const html=a.run('renderPatternHub()');
    s.ok('one read refused → warning strip, not the error card',/id="ptn-load-warn"/.test(html)&&!/ptn-load-error/.test(html));
    s.ok('…still no seed offered while articles is unknown',!/ptn-seed-card/.test(html));
    s.ok('…and the table says the collection failed rather than "no articles"',/ptn-articles-failed/.test(html)&&!/ptn-empty/.test(html));
    a.state.toasts.length=0;
    await a.run('window.ptnSeedRegistry()');
    s.eq('seeding is refused outright on a failed read',a.state.writes.length,0);
  }
  let emptyHtml;
  {
    const a=app();
    await a.run('loadPatternsData()');
    emptyHtml=a.run('renderPatternHub()');
    s.ok('an EMPTY registry offers the seed',/ptn-seed-card/.test(emptyHtml)&&/522/.test(emptyHtml));
    s.ok('…and no error',!/ptn-load-error|ptn-load-warn/.test(emptyHtml));
  }

  // ── Seed ──────────────────────────────────────────────────────────────
  s.section('seed — idempotent, batched');
  {
    const a=app();
    await a.run('loadPatternsData()');
    await a.run('window.ptnSeedRegistry()');
    const sets=a.state.writes.filter(w=>w.op==='set');
    s.eq('writes 31 categories + 522 articles',sets.length,553);
    s.ok('in more than one batch',a.state.batches.length>=2);
    s.eq('no batch exceeds 400',a.state.batches.filter(b=>b.length>400).length,0);
    const gst=sets.find(w=>w.data.prefix==='GST');
    s.eq('GST counter seeded at max+1 = 77',gst&&gst.data.nextNumber,77);
    const cap=sets.find(w=>w.data.code==='GHW001');
    s.eq('a cap is seeded with needsPattern:false',cap&&cap.data.needsPattern,false);
    const art=sets.find(w=>w.data.code==='GST062');
    s.eq('an article carries source tac_seed and a null patternId',J([art.data.source,art.data.patternId]),J(['tac_seed',null]));
  }
  {
    const st=new Map([['tac_categories/GST',{prefix:'GST',nextNumber:90}]]);
    a0.run('_TAC_ARTICLES').forEach(([c,n])=>st.set('articles/'+c,{code:c,name:n}));
    const f=fakeFs(st);
    const a=app({globals:Object.assign({},f.globals,{writeBatch:undefined})});
    // writeBatch undefined → any write attempt would throw; a full registry must not try
    await a.run('loadPatternsData()');
    await a.run('window.ptnSeedRegistry()');
    s.ok('a full registry seeds nothing',a.state.toasts.some(t=>/Nothing to seed/.test(t)));
    s.ok('…and does not offer the seed card',!/ptn-seed-card/.test(a.run('renderPatternHub()')));
  }

  // ── Escaping ──────────────────────────────────────────────────────────
  s.section('stored-XSS boundary');
  {
    const st=new Map([['articles/GP999',{code:'GP999',name:'<img src=x onerror=alert(1)> Tee',brand:'groovy',category:'GP',needsPattern:true,active:true}]]);
    const {a}=mintApp(st);
    await a.run('loadPatternsData()');
    const html=a.run('renderPatternHub()');
    s.ok('an article name is escaped',/&lt;img src=x onerror=alert\(1\)&gt; Tee/.test(html)&&!/<img src=x/.test(html));
  }

  // ── Save / retire ─────────────────────────────────────────────────────
  s.section('edit');
  {
    const st=new Map([['articles/GP999',{code:'GP999',name:'Old',brand:'groovy',category:'GP',needsPattern:true,active:true}]]);
    const {a}=mintApp(st);
    await a.run('loadPatternsData()');
    a.run("window.ptnEditArticle('GP999')");
    a.el('ptn-edit-name').value='New name';a.el('ptn-edit-needs').checked=false;a.el('ptn-edit-active').checked=false;
    await a.run("window.ptnSaveArticle('GP999')");
    const w=a.state.writes.find(x=>x.op==='update');
    s.eq('one update with name, needsPattern and active',J([w&&w.data.name,w&&w.data.needsPattern,w&&w.data.active]),J(['New name',false,false]));
    s.ok('a retired article is hidden by default',!/GP999/.test(a.run('_ptnTableHTML()')));
    a.run("window.ptnSetFilter('showRetired','1')");
    s.ok('…and shown with "Show retired"',/GP999/.test(a.run('_ptnTableHTML()')));
  }

  // ── Rules and shell parity ────────────────────────────────────────────
  s.section('three layers agree: js/patterns.js, firestore.rules, js/shared.js');
  {
    const rules=read('firestore.rules');
    const authSrc=read('js/auth.js');
    const users=a0.run('_PATTERN_HUB_USERS');
    const emailOf=u=>(new RegExp("u:'"+u+"',\\s*email:'([^']+)'").exec(authSrc)||[])[1];
    const jsEmails=users.map(emailOf).sort();
    const owners=(/function isOwner\(\)\s*\{[^}]*\[([^\]]*)\]/.exec(rules)||[,''])[1].match(/'[^']+'/g).map(x=>x.replace(/'/g,''));
    const mustafa=(/function isMustafa\(\)\s*\{[^}]*==\s*'([^']+)'/.exec(rules)||[])[1];
    s.ok('rules define isPatternAdmin() as owners + Mustafa',/function isPatternAdmin\(\)\s*\{\s*return isOwner\(\) \|\| isMustafa\(\);\s*\}/.test(rules));
    s.eq('…which is exactly _PATTERN_HUB_USERS',J(owners.concat([mustafa]).sort()),J(jsEmails));
    s.ok('Arfat is not in the JS list',users.indexOf('arfat')<0);
    s.ok('Arfat is not a pattern admin in rules',!/isPatternAdmin[^}]*arfat/.test(rules));
    s.ok('articles create requires the payload code to equal the doc id',/match \/articles\/\{code\}[\s\S]*?request\.resource\.data\.code == code/.test(rules));
    s.ok('articles update cannot change code or category',/request\.resource\.data\.category == resource\.data\.category/.test(rules));
    s.ok('tac_categories is readable when signed in and written by admins only',/match \/tac_categories\/\{prefix\}\s*\{\s*allow read: if signedIn\(\);\s*allow write: if isPatternAdmin\(\);/.test(rules));
  }
  {
    const shared=read('js/shared.js');
    const calls=shared.match(/_canSeePatternHub\(\)/g)||[];
    s.eq('shared.js reaches the gate from two routes (desktop nav, More sheet)',calls.length,2);
    const guarded=shared.match(/typeof _canSeePatternHub==='function'&&_canSeePatternHub\(\)/g)||[];
    s.eq('…every one behind a typeof guard that fails closed',guarded.length,calls.length);
    s.ok('renderPage dispatches pattern-hub',/id==='pattern-hub'/.test(shared));
    s.ok('…and does not crash if the module failed to load',/typeof loadPatternsData!=='function'/.test(shared));
    s.ok('the bug tracker knows the page name',/'pattern-hub':'Pattern Hub'/.test(shared));
    s.ok('the mobile nav maps it to More',/'pattern-hub':'more'/.test(shared));
    s.ok('no hard-coded username route',!/session\.u==='afnan'[^\n]*pattern/.test(shared));
  }

  return s;
};

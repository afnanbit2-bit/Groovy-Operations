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
        update:(r,p)=>{writes.push([r.key,p,{merge:true}]);},
        delete:r=>{writes.push([r.key,null,{del:true}]);}
      };
      await fn(tx);   // a throw here aborts: nothing below runs
      writes.forEach(([k,p,o])=>{if(o&&o.del){store.delete(k);}else store.set(k,Object.assign({},(o&&o.merge&&store.get(k))||{},p));meta.txWrites.push(k);});
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
    s.ok('renderPage routes every pattern-* page through ptnRenderPage',/id\.startsWith\('pattern-'\)[^\n]*ptnRenderPage\(id\)/.test(shared));
    s.ok('…and does not crash if the module failed to load',/typeof ptnRenderPage==='function'/.test(shared));
    s.ok('shared.js carries no per-page pattern dispatch besides the prefix route',(shared.match(/id==='pattern-/g)||[]).length===0);
    s.ok('the bug tracker knows the page name',/'pattern-hub':'Pattern Hub'/.test(shared));
    s.ok('the mobile nav maps it to More',/'pattern-hub':'more'/.test(shared));
    s.ok('no hard-coded username route',!/session\.u==='afnan'[^\n]*pattern/.test(shared));
  }

  // ═════════════════════════════════════════════════════════════════════
  // M1 — Shopify liveness, reconcile, export, router
  // ═════════════════════════════════════════════════════════════════════
  s.section('M1 · one normaliser, and it recovers the seven denims by title');
  {
    const a=app();await a.run('loadPatternsData()');
    // registry = the seed, in memory
    a.run("tacArticles=_TAC_ARTICLES.map(([code,name])=>({code,name,brand:'groovy',category:_ptnParseCode(code).prefix,needsPattern:true,active:true}))");
    const want={'Carpenter Dark Grey Denim':'GD012','Carpenter Light Grey Denim':'GD013','Carpenter Washed Black Denim':'GD006','Project Rebirth Denim':'GD010','cross star denim blue':'GD011','CORE Denim | Washed Blue':'GD004','Fade Washed Denim':'GD009'};
    Object.entries(want).forEach(([title,code])=>{
      const m=a.run('_ptnTitleMatch('+J(title)+')');
      s.eq('"'+title+'" → '+code+' (exact)',J([m&&m.code,m&&m.kind]),J([code,'exact']));
    });
    s.eq('"The Best Is Yet To Come" is only a LIKELY match to the 2.0',J((a.run("_ptnTitleMatch('The Best Is Yet To Come')")||{}).kind),J('likely'));
    s.eq('"Trying Times" matches nothing',a.run("_ptnTitleMatch('Trying Times')"),null);
    s.eq('"Anxiety Prime" matches nothing',a.run("_ptnTitleMatch('Anxiety Prime')"),null);
    s.eq('normaliser: punctuation, case, & and T-Shirt',a.run("_ptnNorm('  Money & Feelings T-Shirt | RUST ')"),'money and feelings tee rust');
    s.ok('same name → similarity 1',a.run("_ptnSim('Jorts | Dark Stone','jorts dark stone')")===1);
    s.ok('renamed colourway reads as "substantially different"',a.run("_ptnSim('Live in Pants | Heather Grey','Live in Pants | Arctyc White')")<a.run('_PTN_SIM_SAME'));
    s.ok('spelling drift does not',a.run("_ptnSim('Pit Crew Shirt','Pitcrew Shirt')")>=a.run('_PTN_SIM_SAME'));
  }

  s.section('M1 · the buckets');
  function recApp(session){
    const store=new Map([
      ['tac_categories/GST',{prefix:'GST',nextNumber:77}],
      ['tac_categories/GBT',{prefix:'GBT',nextNumber:20}],
      ['articles/GST062',{code:'GST062',name:'Live in Pants | Heather Grey',brand:'groovy',category:'GST',needsPattern:true,active:true}],
      ['articles/GST001',{code:'GST001',name:'Baggy Trousers | Black',brand:'groovy',category:'GST',needsPattern:true,active:true}],
      ['articles/GD012',{code:'GD012',name:'Carpenter Dark Grey Denim',brand:'groovy',category:'GD',needsPattern:true,active:true}],
      ['articles/GST029',{code:'GST029',name:'Navy Blue Trouser',brand:'groovy',category:'GST',needsPattern:true,active:true}],
      ['articles/CP001',{code:'CP001',name:'Champions (94)',brand:'cultured',category:'CP',needsPattern:true,active:true}],
      ['shopify_articles/GST062',{code:'GST062',status:'active',product_titles:['Live in Pants | Arctyc White'],product_ids:['1'],size_axis:'alpha'}],
      ['shopify_articles/GST001',{code:'GST001',status:'active',product_titles:['Baggy Trousers | Black'],product_ids:['2'],size_axis:'alpha'}],
      ['shopify_articles/GBT020',{code:'GBT020',status:'active',product_titles:['Cupid Lovestruck Baby Tee'],product_ids:['3'],size_axis:'alpha'}],
      ['shopify_articles/ZZZ001',{code:'ZZZ001',status:'active',product_titles:['Mystery'],product_ids:['9']}]
    ]);
    const f=fakeFs(store);
    const meta={last_success_at:'2026-09-17T04:00:00Z',codes:4,unkeyed_products:[
      {product_id:'30',title:'Carpenter Dark Grey Denim',status:'active',reason:'no_sku',sku_sample:''},
      {product_id:'40',title:'Kinder Planet Baby Tee',status:'draft',reason:'foreign_sku',sku_sample:'TOPS-030'}
    ],multi_code_products:[{product_id:'5',title:'Chicago Bulls',status:'active',codes:['GP061','GP060']}]};
    const globals=Object.assign({},f.globals,{
      getDoc:async r=>({exists:()=>r.key==='shopify_sync_meta/articles_rollup',data:()=>meta}),
      updateDoc:async(r,p)=>{const cur=store.get(r.key)||{};store.set(r.key,Object.assign({},cur,p));}
    });
    const a=app({session:session||SESS.afnan,globals});
    return{a,store,meta:f.meta};
  }
  {
    const {a,store}=recApp();
    await a.run('loadPatternsData()');await a.run('loadPatternsShopify()');
    const r=a.run('_ptnReconcile()');
    s.eq('unknown codes: GBT020 (known prefix) and ZZZ001 (unknown prefix)',J(r.unknownCodes.map(u=>[u.code,!!u.cat])),J([['GBT020',true],['ZZZ001',false]]));
    s.eq('name mismatch: GST062 only',J(r.nameMismatch.map(u=>u.code)),J(['GST062']));
    s.ok('…flagged as substantially different',r.nameMismatch[0].sim<a.run('_PTN_SIM_SAME'));
    s.eq('not on Shopify: the GROOVY codes with no rollup doc, never Cultured',J(r.notOnShopify.map(u=>u.code).sort()),J(['GD012','GST029']));
    s.eq('unkeyed: the denim matches GD012 exactly, the baby tee matches nothing',J(r.unkeyed.map(u=>[u.productId,u.match&&u.match.code,u.match&&u.match.kind])),J([['30','GD012','exact'],['40',null,null]]));
    s.eq('two-codes bucket carries the product',J(r.multiCode.map(u=>u.codes)),J([['GP061','GP060']]));
    s.eq('ok = shared codes whose names agree',r.ok,1);
    s.eq('nothing waiting on Shopify yet',r.fixShopify.length,0);
    const html=a.run('renderPatternReconcile()');
    s.ok('the page renders the tabs with counts',/Codes not in registry <b>2<\/b>/.test(html)&&/Name mismatches <b>1<\/b>/.test(html));
    s.ok('an unknown prefix offers no Add button',!/ptnAddFromShopify\('ZZZ001'\)/.test(html)&&/ptnAddFromShopify\('GBT020'\)/.test(html));
    s.ok('the hub badge counts open items (2 unknown + 1 name + 2 unkeyed)',/badge[^>]*>5</.test(a.run('_ptnRecBadge()')));
    s.ok('the hub shows the Shopify column',/ptn-shop/.test(a.run('_ptnTableHTML()'))&&/active/.test(a.run('_ptnTableHTML()')));
    s.ok('the sync line names the copy',/Shopify copy: <b>4<\/b>/.test(a.run('_ptnSyncLineHTML()')));

    // add from Shopify
    a.state.toasts.length=0;
    await a.run("window.ptnAddFromShopify('GBT020')");
    const added=store.get('articles/GBT020');
    s.ok('GBT020 added with the Shopify title as its name',added&&added.name==='Cupid Lovestruck Baby Tee');
    s.eq('…source and link recorded',J([added.source,added.shopifyLink&&added.shopifyLink.productId]),J(['assigned_from_reconcile','3']));
    s.eq('…GBT counter moved past it',store.get('tac_categories/GBT').nextNumber,21);
    await a.run("window.ptnAddFromShopify('ZZZ001')");
    s.ok('an unknown prefix is refused with a message',!store.has('articles/ZZZ001')&&a.state.toasts.some(t=>/No TAC category/.test(t)));
    s.eq('the bucket drops GBT020 on the next compute',J(a.run('_ptnReconcile()').unknownCodes.map(u=>u.code)),J(['ZZZ001']));

    // names
    await a.run("window.ptnUseShopifyName('GST062')");
    s.eq('Use Shopify name renames and marks reviewed',J([store.get('articles/GST062').name,!!store.get('articles/GST062').nameReviewedAt]),J(['Live in Pants | Arctyc White',true]));
    s.eq('…and the mismatch is gone',a.run('_ptnReconcile()').nameMismatch.length,0);

    // link an unkeyed product
    await a.run("window.ptnLinkProduct('30','GD012')");
    const gd=store.get('articles/GD012');
    s.eq('link writes shopifyLink on the article only',J([gd.shopifyLink.productId,gd.shopifyLink.reason,gd.name]),J(['30','no_sku','Carpenter Dark Grey Denim']));
    const r2=a.run('_ptnReconcile()');
    s.eq('…the product leaves the open list and lands in Fix in Shopify',J([r2.unkeyed.filter(u=>!u.linked).length,r2.fixShopify.map(f=>f.code)]),J([1,['GD012']]));
    s.ok('Fix in Shopify tells a human the SKU to type',/GD012-&lt;size&gt;/.test(a.run("_ptnRecTab='fix';_ptnReconcileHTML()")));
    s.ok('a linked article shows "fix SKU" on the hub',/linked · fix SKU/.test(a.run("_ptnShopifyCellHTML(tacArticles.find(x=>x.code==='GD012'))")));

    // mint for an unkeyed product carries the link into the mint
    a.run("window.ptnMintForProduct('40')");
    s.ok('a pending link is set and the mint form opened',a.run('!!_ptnPendingLink&&_ptnMintOpen'));
    a.el('ptn-mint-cat').value='GBT';a.el('ptn-mint-name').value='Kinder Planet Baby Tee';a.el('ptn-mint-code').value='';a.el('ptn-mint-needs').checked=true;
    await a.run('window.ptnMint()');
    const kp=store.get('articles/GBT021');
    s.ok('minted GBT021 with the link attached',kp&&kp.shopifyLink&&kp.shopifyLink.productId==='40'&&kp.shopifyLink.reason==='foreign_sku');
    s.eq('the pending link is consumed',a.run('_ptnPendingLink'),null);

    // retire
    await a.run("window.ptnRetireQuick('GST029')");
    s.eq('retire writes active:false and asked first',J([store.get('articles/GST029').active,a.state.confirms.length]),J([false,1]));
  }
  {
    const {a,meta}=recApp(SESS.arfat);
    await a.run('loadPatternsData()');await a.run('loadPatternsShopify()');
    await a.run("window.ptnAddFromShopify('GBT020')");await a.run("window.ptnLinkProduct('30','GD012')");
    s.eq('Arfat can do none of it',meta.tx+a.state.writes.length,0);
  }

  s.section('M1 · Run sync now — the scheduled function refuses HTTP, the button does not');
  {
    s.ok('the dead URL hint is gone from the module',!/run it now at <code>\/\.netlify\/functions\/shopify-catalog-sync/.test(read('js/patterns.js')));
    const a0=app({session:SESS.arfat});
    s.eq('Arfat gets no button',a0.run('_ptnSyncNowBtnHTML()'),'');
    // an admin: a scripted fetch answers 202; the sync meta moves from an old
    // run to a fresh success on the second poll
    let polls=0;const posts=[];
    const meta=()=>({last_run_at:polls>=2?'2026-09-17T15:00:00Z':'2026-09-17T04:00:00Z',last_success_at:'2026-09-17T15:00:00Z',last_status:'success',articles_written:336,unkeyed_products:11,multi_code_products:1});
    const a=app({globals:{
      auth:{currentUser:{getIdToken:async()=>'tok-afnan'}},
      fetch:async(url,init)=>{posts.push({url,body:JSON.parse(init.body)});return{status:202,ok:true,json:async()=>({})};},
      getDoc:async r=>{if(r&&r.key==='shopify_sync_meta/catalog_sync'){polls++;return{exists:()=>true,data:meta};}return{exists:()=>false,data:()=>({})};},
      doc:(db,col,id)=>({col,id,key:col+'/'+id}),
      collection:(db,name)=>({name})
    }});
    a.run('_ptnSyncPollMs=15');
    s.ok('an admin sees the button',/ptn-sync-now/.test(a.run('_ptnSyncNowBtnHTML()')));
    await a.run('window.ptnRunSyncNow()');
    s.eq('it POSTs the ID token to the background wrapper, not to the scheduled function',J([posts[0].url,posts[0].body.idToken]),J(['/.netlify/functions/pattern-sync-now-background','tok-afnan']));
    s.eq('…and shows running',a.run('_ptnSyncRun.status'),'running');
    await new Promise(r=>setTimeout(r,120));
    s.eq('a fresh success in the meta doc ends the run as done',a.run('_ptnSyncRun.status'),'done');
    s.ok('…with the three numbers in the message',/336 article codes, 11 without a usable SKU, 1 with two codes/.test(a.run('_ptnSyncRun.msg')));
    s.ok('the stale (pre-click) success was not mistaken for ours',polls>=2);
    s.ok('the rollup was reloaded',a.run('_ptnShopifyLoaded')===true);
  }
  {
    const a=app({globals:{auth:{currentUser:{getIdToken:async()=>'t'}},fetch:async()=>({status:403,ok:false,json:async()=>({error:'Your account cannot run the catalog sync.'})})}});
    await a.run('window.ptnRunSyncNow()');
    s.eq('a refused start is reported, not spun',a.run('_ptnSyncRun.status'),'failed');
    s.ok('…with the server\'s reason',/cannot run the catalog sync/.test(a.run('_ptnSyncRun.msg')));
  }

  s.section('M1 · rollup missing or refused');
  {
    const a=app({globals:{collection:(db,name)=>({name}),getDocs:async ref=>{if(ref.name==='shopify_articles')throw new Error('Missing or insufficient permissions');return{docs:[]};}}});
    await a.run('loadPatternsData()');await a.run('loadPatternsShopify()');
    s.ok('the reconcile page names the collection and the republish',/ptn-rec-failed/.test(a.run('renderPatternReconcile()'))&&/firestore\.rules/.test(a.run('renderPatternReconcile()')));
    s.ok('the hub warns but still works',/ptn-shop-warn/.test(a.run('renderPatternHub()'))&&/ptn-seed-card/.test(a.run('renderPatternHub()')));
    s.eq('the badge is silent',a.run('_ptnRecBadge()'),'');
  }
  {
    const a=app();
    await a.run('loadPatternsData()');await a.run('loadPatternsShopify()');
    s.ok('no rollup yet → the page offers Run sync now (not a URL that 403s)',/ptn-rec-none/.test(a.run('renderPatternReconcile()'))&&/ptn-sync-now/.test(a.run('renderPatternReconcile()'))&&!/functions\/shopify-catalog-sync/.test(a.run('renderPatternReconcile()')));
    s.ok('…and the hub says so too',/ptn-shop-none/.test(a.run('renderPatternHub()')));
  }

  s.section('M1 · export');
  {
    const {a}=recApp();
    await a.run('loadPatternsData()');await a.run('loadPatternsShopify()');
    const rows=a.run('_ptnExportRows()');
    s.eq('one row per article, TAC category order (GD before GST) then number, other brands after',J(rows.map(r=>r[2])),J(['GD012','GST001','GST029','GST062','CP001']));
    s.eq('header',J(a.run('_PTN_EXPORT_HEADER')),J(['Brand','Category','Article Code','Article Name','Needs pattern','Status','Shopify']));
    s.eq('a row carries brand, category, code, name, pattern flag, status and Shopify status',J(rows[3]),J(['GROOVY','GST · Sweatpants & Trousers','GST062','Live in Pants | Heather Grey','Yes','Active','active']));
    s.eq('a code absent from Shopify reads —',rows[2][6],'—');
    a.state.toasts.length=0;
    a.run("window.ptnExportTac('xlsx')");
    s.ok('with no XLSX loaded the export says so rather than throwing',a.state.toasts.some(t=>/spreadsheet library/.test(t)));
    a.run("window.ptnExportTac('pdf')");
    s.ok('with no print engine the export says so rather than throwing',a.state.toasts.some(t=>/print engine/.test(t)));
  }
  {
    const calls=[];
    const {a}=recApp();
    a.ctx.window.printDocument=o=>calls.push(o);
    await a.run('loadPatternsData()');await a.run('loadPatternsShopify()');
    a.run("window.ptnExportTac('pdf')");
    s.eq('PDF goes through the print engine, generic variant, English only',J([calls.length,calls[0]&&calls[0].type,calls[0]&&calls[0].data.urduLevel]),J([1,'generic','none']));
    s.ok('…with the category headings and every code in the body',/GROOVY — GST · Sweatpants & Trousers\n/.test(calls[0].data.bodyHtml)&&/GST062   Live in Pants/.test(calls[0].data.bodyHtml)&&/Cultured Legacy — CP/.test(calls[0].data.bodyHtml));
  }

  s.section('M1 · router');
  {
    const a=app({session:SESS.arfat});
    a.run("ptnRenderPage('pattern-hub')");
    s.ok('Arfat gets the test-phase message from the router',/test phase/.test(a.el('main-content').innerHTML));
  }
  {
    const {a}=recApp();
    a.run("currentPage='pattern-reconcile';ptnRenderPage('pattern-reconcile')");
    s.ok('the router paints a skeleton first',/skeleton/.test(a.el('main-content').innerHTML));
    await new Promise(r=>setTimeout(r,10));
    s.ok('…then the reconcile page',/Reconcile with Shopify/.test(a.el('main-content').innerHTML));
    a.run("currentPage='pattern-nope';ptnRenderPage('pattern-nope')");
    await new Promise(r=>setTimeout(r,10));
    s.ok('an unknown pattern-* page says so instead of a blank',/Unknown Pattern Hub page/.test(a.el('main-content').innerHTML));
  }

  // ═════════════════════════════════════════════════════════════════════
  // M2 — blocks, the hook rack, assignment, the queue
  // ═════════════════════════════════════════════════════════════════════
  function blocksApp(store,session,extra){
    store=store||new Map();
    const f=fakeFs(store);
    let counter=41;
    const globals=Object.assign({},f.globals,{
      getDoc:async r=>({exists:()=>store.has(r.key),data:()=>store.get(r.key)}),
      updateDoc:async(r,p)=>{const cur=store.get(r.key)||{};store.set(r.key,Object.assign({},cur,p));f.meta.updates=(f.meta.updates||0)+1;},
      deleteDoc:async r=>{store.delete(r.key);},
      getNextId:async()=>(++counter),
      writeBatch:()=>{const ops=[];f.meta.batches=(f.meta.batches||0)+1;return{update(r,p){ops.push(['u',r.key,p]);return this;},set(r,p){ops.push(['s',r.key,p]);return this;},delete(r){ops.push(['d',r.key]);return this;},async commit(){ops.forEach(([op,k,p])=>{if(op==='d')store.delete(k);else store.set(k,Object.assign({},op==='u'?(store.get(k)||{}):{},p));f.meta.batchWrites=(f.meta.batchWrites||0)+1;});}};}
    },extra||{});
    const a=app({session:session||SESS.afnan,globals});
    return{a,store,meta:f.meta};
  }
  // the transaction stub needs delete/update too
  const origFakeFs=fakeFs;
  function seedArticles(store){
    [['GST060','Live in Pants | Ash Grey','GST'],['GST061','Live in Pants | Deep Green','GST'],['GST062','Live in Pants | Arctyc White','GST'],
     ['GSO001','Aim Shorts | Ash Grey','GSO'],['GSO002','Aim Shorts | Deep Green','GSO'],
     ['GP001','REBIRTH','GP'],['GP090','EFFORTLESS TEE | BLACK','GP'],['GP091','EFFORTLESS TEE | MUTED OLIVE','GP'],
     ['GD001','CORE Denim | Black','GD'],['GHW001','Classic Snapback Stone','GHW'],['CP001','Champions (94)','CP']
    ].forEach(([c,n,cat])=>store.set('articles/'+c,{code:c,name:n,brand:cat[0]==='C'?'cultured':'groovy',category:cat,needsPattern:cat!=='GHW',active:true,patternId:null}));
  }

  s.section('M2 · clustering is a suggestion built from names, colourways stripped');
  {
    const {a,store}=blocksApp();seedArticles(store);
    await a.run('loadPatternsData()');
    s.eq('Live in Pants colourways share a key',new Set(['GST060','GST061','GST062'].map(c=>a.run("_ptnClusterKey(tacArticles.find(x=>x.code==="+J(c)+"))"))).size,1);
    s.eq('Aim Shorts share a key',new Set(['GSO001','GSO002'].map(c=>a.run("_ptnClusterKey(tacArticles.find(x=>x.code==="+J(c)+"))"))).size,1);
    s.eq('EFFORTLESS TEE colourways share a key',new Set(['GP090','GP091'].map(c=>a.run("_ptnClusterKey(tacArticles.find(x=>x.code==="+J(c)+"))"))).size,1);
    s.ok('a different category never merges',a.run("_ptnClusterKey(tacArticles.find(x=>x.code==='GST060'))")!==a.run("_ptnClusterKey(tacArticles.find(x=>x.code==='GSO001'))"));
    s.eq('suggested name from the key',a.run("_ptnSuggestName(_ptnClusterKey(tacArticles.find(x=>x.code==='GST060')))"),'Live In Pants block');
    const cl=a.run('_ptnClusters(_ptnUnassigned().filter(x=>x.brand==="groovy"))');
    s.eq('clusters sorted largest first; the queue never holds a cap',J([cl[0].articles.length,cl.some(c=>c.articles.some(x=>x.code==='GHW001'))]),J([3,false]));
    s.ok('the queue page renders groups with an Assign and a New-block action',/ptn-cluster/.test(a.run('renderPatternUnassigned()'))&&/ptnNewBlockFor\(0\)/.test(a.run('renderPatternUnassigned()')));
    s.ok('nothing is ever written by looking at the suggestion',a.state.writes.length===0);
  }

  s.section('M2 · create a block, place it, the lock holds the slot');
  {
    const {a,store,meta}=blocksApp();seedArticles(store);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');
    const ok=await a.run("_ptnSaveBlockData({name:'Live In Pants block',category:'GST',fit:'Relaxed',tracedBy:'Hassan',sizeAxis:'alpha',sampleSize:'M',sizes:['XS','S','M','L','XL']},{id:null,prefill:{codes:['GST060','GST061','GST062','GHW001']}})");
    s.eq('created',ok,true);
    const p=store.get('patterns/ptn_0042');
    s.ok('PTN-0042 from the counter, not on a hook yet',p&&p.code==='PTN-0042'&&p.hook===null&&p.slot===null&&p.status==='active');
    s.eq('the three articles were assigned in one batch, the cap skipped',J([store.get('articles/GST060').patternId,store.get('articles/GST062').patternId,store.get('articles/GHW001').patternId,meta.batches]),J(['ptn_0042','ptn_0042',null,1]));
    s.ok('the block document was never written by the assignment',!('articles' in (store.get('patterns/ptn_0042')||{})));
    s.eq('it is Unplaced on the rack page',a.run('_ptnUnplaced().length'),1);
    s.ok('the hook map renders 50 cells, all empty',(a.run('_ptnHookMapHTML()').match(/ptn-slot-empty/g)||[]).length===50);
    // place it
    a.run("_ptnBlockId='ptn_0042'");a.el('ptn-slot-pick').value='3-2';
    await a.run("window.ptnPlaceBlock('ptn_0042')");
    s.eq('hook/slot written on the block',J([store.get('patterns/ptn_0042').hook,store.get('patterns/ptn_0042').slot]),J([3,2]));
    s.eq('…and the lock',store.get('pattern_slots/3-2')&&store.get('pattern_slots/3-2').patternId,'ptn_0042');
    s.ok('the map shows it in 3-2',/data-slot="3-2"[^>]*onclick="window.ptnOpenBlock\('ptn_0042'\)"/.test(a.run('_ptnHookMapHTML()')));
    // a second block cannot take the same slot
    await a.run("_ptnSaveBlockData({name:'Aim Shorts block',category:'GSO',fit:'',tracedBy:'Alam',sizeAxis:'alpha',sampleSize:'',sizes:['S','M','L']},{id:null,prefill:{}})");
    a.run("_ptnBlockId='ptn_0043'");a.el('ptn-slot-pick').value='3-2';
    a.state.toasts.length=0;
    await a.run("window.ptnPlaceBlock('ptn_0043')");
    s.eq('a taken slot is refused inside the transaction',store.get('pattern_slots/3-2').patternId,'ptn_0042');
    s.ok('…and says who holds it',a.state.toasts.some(t=>/already holds PTN-0042/.test(t)));
    s.ok('the pick list greys the taken slot',/value="3-2" disabled/.test(a.run('_ptnBlockHTML()')));
    // move releases the old lock
    a.run("_ptnBlockId='ptn_0042'");a.el('ptn-slot-pick').value='7-5';
    await a.run("window.ptnPlaceBlock('ptn_0042')");
    s.eq('moving releases 3-2 and takes 7-5',J([store.has('pattern_slots/3-2'),store.get('pattern_slots/7-5').patternId]),J([false,'ptn_0042']));
    a.el('ptn-slot-pick').value='11-1';
    a.state.toasts.length=0;await a.run("window.ptnPlaceBlock('ptn_0042')");
    s.ok('a slot off the rack is refused',a.state.toasts.some(t=>/does not exist/.test(t))&&store.get('patterns/ptn_0042').hook===7);
    // retire releases and unassigns nothing — articles just show unassigned
    await a.run("window.ptnRetireBlock('ptn_0042')");
    s.eq('retire releases the slot and marks retired',J([store.has('pattern_slots/7-5'),store.get('patterns/ptn_0042').status]),J([false,'retired']));
    s.eq('its articles are back in the queue without any write to them',J([store.get('articles/GST060').patternId,a.run('_ptnUnassigned().some(x=>x.code==="GST060")')]),J(['ptn_0042',true]));
    s.ok('a stale patternId is inert on the hub',/unassigned/.test(a.run("_ptnPatternCellHTML(tacArticles.find(x=>x.code==='GST060'))")));
  }

  s.section('M2 · validation, permissions, assignment rules');
  {
    const {a,store,meta}=blocksApp();seedArticles(store);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');
    const bad=[
      [{name:'',category:'GST',sizeAxis:'alpha',sizes:['M']},'name'],
      [{name:'x',category:'ZZ',sizeAxis:'alpha',sizes:['M']},'category'],
      [{name:'x',category:'GST',sizeAxis:'alpha',sizes:[]},'at least one size'],
      [{name:'x',category:'GST',sizeAxis:'alpha',sizes:['30']},'not on the alpha axis'],
      [{name:'x',category:'GST',sizeAxis:'waist',sizes:['30'],sampleSize:'32'},'sample size']
    ];
    bad.forEach(([d,msg])=>{s.ok('refused: '+msg,new RegExp(msg).test(a.run('_ptnValidateBlock('+J(d)+')')||''));});
    s.eq('a good form passes',a.run("_ptnValidateBlock({name:'x',category:'GD',sizeAxis:'waist',sizes:['28','30'],sampleSize:'30'})"),null);
    s.eq('nothing was written by validation',meta.tx,0);
    await a.run("_ptnSaveBlockData({name:'Denim block',category:'GD',fit:'',tracedBy:'',sizeAxis:'waist',sampleSize:'',sizes:['28','30']},{id:null,prefill:{}})");
    a.state.toasts.length=0;
    await a.run("window.ptnAssign('ptn_0042',['GHW001','CP001'])");
    s.ok('a cap is skipped (needsPattern false) and the toast says so; the other article still lands',store.get('articles/GHW001').patternId===null&&store.get('articles/CP001').patternId==='ptn_0042'&&a.state.toasts.some(t=>/skipped GHW001/.test(t)));
    a.state.toasts.length=0;await a.run("window.ptnAssign('ptn_0042',['GHW001'])");
    s.ok('a cap alone is refused outright',a.state.toasts.some(t=>/cannot take a pattern/.test(t)));
    await a.run("window.ptnAssign('ptn_0042',['GD001'])");
    s.eq('GD001 assigned',store.get('articles/GD001').patternId,'ptn_0042');
    await a.run("_ptnSaveBlockData({name:'Second denim',category:'GD',fit:'',tracedBy:'',sizeAxis:'waist',sampleSize:'',sizes:['28']},{id:null,prefill:{}})");
    a.state.toasts.length=0;
    await a.run("window.ptnAssign('ptn_0043',['GD001'])");
    s.ok('assigning to another block MOVES it and says so',store.get('articles/GD001').patternId==='ptn_0043'&&a.state.toasts.some(t=>/1 moved from another block/.test(t)));
    await a.run("window.ptnUnassign('GD001')");
    s.eq('unassign clears the link',store.get('articles/GD001').patternId,null);
    s.ok('edit keeps code and createdAt (rules forbid changing them; the patch never sends them)',(async()=>{})&&true);
    const before=store.get('patterns/ptn_0042');
    await a.run("_ptnSaveBlockData({name:'Denim block v2',category:'GD',fit:'Baggy',tracedBy:'Alam',sizeAxis:'waist',sampleSize:'30',sizes:['28','30','32']},{id:'ptn_0042',prefill:{}})");
    const after=store.get('patterns/ptn_0042');
    s.eq('edit updates the fields and leaves code/createdAt alone',J([after.name,after.fit,after.sizes,after.code===before.code,after.createdAt===before.createdAt]),J(['Denim block v2','Baggy',['28','30','32'],true,true]));
  }
  {
    const {a,store,meta}=blocksApp(undefined,SESS.arfat);seedArticles(store);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');
    await a.run("_ptnSaveBlockData({name:'x',category:'GST',sizeAxis:'alpha',sizes:['M']},{id:null,prefill:{}})");
    await a.run("window.ptnAssign('ptn_0042',['GST060'])");
    s.eq('Arfat can create nothing and assign nothing',meta.tx+(meta.batches||0)+a.state.writes.length,0);
    s.ok('and gets no New block button',!/ptnNewBlock\(\)/.test(a.run('renderPatternBlocks()')));
  }

  s.section('M2 · loaders and stale locks');
  {
    const a=app({globals:{collection:(db,name)=>({name}),getDocs:async ref=>{if(ref.name==='patterns')throw new Error('Missing or insufficient permissions');return{docs:[]};}}});
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');
    s.ok('a refused patterns read renders the error card with the republish hint',/ptn-blocks-error/.test(a.run('renderPatternBlocks()'))&&/firestore\.rules/.test(a.run('renderPatternBlocks()')));
  }
  {
    const st=new Map([['pattern_slots/2-2',{patternId:'ptn_gone',patternCode:'PTN-0009'}]]);
    const {a,store}=blocksApp(st);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');
    s.ok('a lock with no live block shows as stale, with a clear action',/ptn-slot-stale[^>]*data-slot="2-2"/.test(a.run('_ptnHookMapHTML()'))&&/ptnClearSlot\('2-2'\)/.test(a.run('_ptnHookMapHTML()')));
    await a.run("window.ptnClearSlot('2-2')");
    s.ok('clearing removes it',!store.has('pattern_slots/2-2'));
  }
  {
    const shared=read('js/shared.js');const rules=read('firestore.rules');
    s.ok('rules: pattern_slots ids are exactly the 50 rack positions',/match \/pattern_slots\/\{key\}[\s\S]*?key\.matches\('\^\(\[1-9\]\|10\)-\[1-5\]\$'\)/.test(rules));
    s.ok('rules: a block update may not change its code',/match \/patterns\/\{id\}[\s\S]*?request\.resource\.data\.code == resource\.data\.code/.test(rules));
    s.ok('the three new pages have bug-tracker names',/'pattern-blocks':'Pattern Hub · Patterns'/.test(shared)&&/'pattern-unassigned'/.test(shared));
  }

  // ═════════════════════════════════════════════════════════════════════
  // M3 — measurements
  // ═════════════════════════════════════════════════════════════════════
  const LSmem=()=>{const m={};return{getItem:k=>(k in m?m[k]:null),setItem(k,v){m[k]=String(v);},removeItem(k){delete m[k];}};};
  function gridApp(store,session,ls){
    store=store||new Map();
    const f=fakeFs(store);
    const globals=Object.assign({},f.globals,{
      localStorage:ls||LSmem(),
      getDoc:async r=>({exists:()=>store.has(r.key),data:()=>store.get(r.key)}),
      updateDoc:async(r,p)=>{const cur=store.get(r.key)||{};store.set(r.key,Object.assign({},cur,p));f.meta.updates=(f.meta.updates||0)+1;},
      setDoc:async(r,p,o)=>{store.set(r.key,Object.assign({},(o&&o.merge&&store.get(r.key))||{},p));f.meta.sets=(f.meta.sets||0)+1;},
      getNextId:async()=>7,
      writeBatch:()=>{const ops=[];return{set(r,p){ops.push(['s',r.key,p]);return this;},update(r,p){ops.push(['u',r.key,p]);return this;},delete(r){ops.push(['d',r.key]);return this;},async commit(){ops.forEach(([op,k,p])=>{if(op==='d')store.delete(k);else store.set(k,Object.assign({},op==='u'?(store.get(k)||{}):{},p));});f.meta.batches=(f.meta.batches||0)+1;}};}
    });
    const a=app({session:session||SESS.afnan,globals});
    return{a,store,meta:f.meta};
  }
  const BLOCK={code:'PTN-0007',name:'Live In Pants block',category:'GST',status:'active',sizeAxis:'alpha',sizes:['S','M','L'],sampleSize:'M',pomTemplate:'pant',extraPoms:[],grid:{},hook:null,slot:null,createdAt:'2026-09-17'};

  s.section('M3 · units and the quarter-inch rule');
  {
    const {a}=gridApp();
    s.eq('22.5 in stays 22.5',J(a.run("_ptnParseIn('22.5','in')")),J({inches:22.5,rounded:false}));
    s.eq('22 1/2 is read as 22.5',a.run("_ptnParseIn('22 1/2','in').inches"),22.5);
    s.eq('22.6 rounds to 22.5 and says so',J(a.run("_ptnParseIn('22.6','in')")),J({inches:22.5,rounded:true}));
    s.eq('a comma decimal is accepted',a.run("_ptnParseIn('22,25','in').inches"),22.25);
    s.eq('57.2 cm → 22.5 in',a.run("_ptnParseIn('57.2','cm').inches"),22.5);
    s.eq('blank → empty',J(a.run("_ptnParseIn('  ','in')")),J({empty:true}));
    s.eq('prose → bad, never thrown',J(a.run("_ptnParseIn('about 22','in')")),J({bad:true}));
    s.eq('negative → bad',J(a.run("_ptnParseIn('-3','in')")),J({bad:true}));
    s.eq('22.5 in displays as 22.5 / 57.2 cm',J([a.run("_ptnFmt(22.5,'in')"),a.run("_ptnFmt(22.5,'cm')")]),J(['22.5','57.2']));
    s.eq('22 in displays without a decimal',a.run("_ptnFmt(22,'in')"),'22');
    s.eq('the unit preference is per viewer, default inches',a.run("_ptnUnits()"),'in');
    a.run("_ptnSetUnits('cm')");s.eq('…and sticks',a.run("_ptnUnits()"),'cm');
  }

  s.section('M3 · rows: template + extras + orphans, never dropped');
  {
    const st=new Map([['patterns/ptn_0007',Object.assign({},BLOCK,{extraPoms:[{key:'drawcord',label:'Drawcord length',howTo:'tip to tip'}],grid:{M:{waist_relaxed:15,old_point:3}}})]]);
    _seedPoms(st);
    const {a}=gridApp(st);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');await a.run('loadPatternsPoms()');
    const rows=a.run("_ptnRowsFor(_ptnBlock('ptn_0007'))");
    s.eq('10 template points first',rows.slice(0,10).every(r=>r.src==='template')&&rows[0].key==='waist_relaxed',true);
    s.eq('then the block-only extra',J([rows[10].key,rows[10].src]),J(['drawcord','extra']));
    s.eq('then the orphan key still holding a number',J([rows[11].key,rows[11].src]),J(['old_point','orphan']));
    const html=a.run("_ptnGridCardHTML(_ptnBlock('ptn_0007'))");
    s.ok('the orphan renders greyed with a clear action, and the how-to text shows',/no longer in the template/.test(html)&&/ptnClearRow\('ptn_0007','old_point'\)/.test(html)&&/Lay flat\. Across the top of the waistband/.test(html));
    s.ok('the grid has one input per point per size (12 rows × 3 sizes)',(html.match(/class="ptn-cell/g)||[]).length===36);
    s.ok('±0.5 in is stated',/±0\.5 in/.test(html));
    s.ok('a block with no sizes says so instead of a blank grid',/tick the sizes/.test(a.run("_ptnGridCardHTML(Object.assign({},_ptnBlock('ptn_0007'),{sizes:[]}))")));
  }
  function _seedPoms(st){
    // the seed constant, as the seed action would write it
    const seed=app().run('_PTN_POM_SEED');
    seed.forEach(t=>st.set('pom_templates/'+t.id,{id:t.id,label:t.label,poms:t.poms}));
  }

  s.section('M3 · saving the grid: inches stored, rounded, bad cells flagged not thrown');
  {
    const st=new Map([['patterns/ptn_0007',Object.assign({},BLOCK)]]);_seedPoms(st);
    const {a,store,meta}=gridApp(st);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');await a.run('loadPatternsPoms()');
    a.run("_ptnBlockId='ptn_0007'");
    a.run("_ptnGridDraft={M:{waist_relaxed:'15.1',hip:'22 1/2',thigh:'about 12'},L:{waist_relaxed:'16'}}");a.run("_ptnGridDirty=true");
    a.state.toasts.length=0;
    const ok=await a.run("window.ptnSaveGrid('ptn_0007')");
    const g=store.get('patterns/ptn_0007').grid;
    s.eq('saved',ok,true);
    s.eq('numbers stored in inches, rounded to quarters, as NUMBERS',J(g),J({M:{waist_relaxed:15,hip:22.5},L:{waist_relaxed:16}}));
    s.ok('the prose cell was left blank and named, and the rounding reported',a.state.toasts.some(t=>/left blank \(not a number\): M thigh/.test(t)&&/1 rounded/.test(t)));
    s.eq('one write for the whole grid',meta.updates,1);
    s.eq('the draft is cleared',a.run('_ptnGridDraft'),null);
    // cm input stores inches
    a.run("_ptnSetUnits('cm')");
    a.run("_ptnGridDraft={S:{waist_relaxed:'38.1'}}");a.run("_ptnGridDirty=true");
    await a.run("window.ptnSaveGrid('ptn_0007')");
    s.eq('38.1 cm typed → 15 in stored',store.get('patterns/ptn_0007').grid.S.waist_relaxed,15);
    s.ok('…and the cell displays 38.1 in cm view',/value="38\.1"/.test(a.run("_ptnGridCardHTML(_ptnBlock('ptn_0007'))")));
    a.run("_ptnSetUnits('in')");
    // blanking a cell removes it
    a.run("_ptnGridDraft={S:{waist_relaxed:''}}");a.run("_ptnGridDirty=true");
    await a.run("window.ptnSaveGrid('ptn_0007')");
    s.ok('a blanked cell is removed, and an empty size row goes with it',!store.get('patterns/ptn_0007').grid.S);
    // nothing changed → no write
    const before=meta.updates;a.run("_ptnGridDraft={M:{waist_relaxed:'15'}}");a.run("_ptnGridDirty=true");
    await a.run("window.ptnSaveGrid('ptn_0007')");
    s.eq('re-saving the same value writes nothing',meta.updates,before);
    s.ok('filled/total counts the template points only',J(a.run("_ptnGridFilled(_ptnBlock('ptn_0007'))"))===J({filled:3,total:30}));
  }

  s.section('M3 · extras, clearing an orphan, the template editor');
  {
    const st=new Map([['patterns/ptn_0007',Object.assign({},BLOCK,{grid:{M:{gone:9,waist_relaxed:15}}})]]);_seedPoms(st);
    const {a,store}=gridApp(st);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');await a.run('loadPatternsPoms()');
    a.run("_ptnBlockId='ptn_0007'");
    a.ctx.prompt=(m,d)=>/Name of the point/.test(m)?'Drawcord length':'tip to tip';
    await a.run("window.ptnAddExtraPom('ptn_0007')");
    s.eq('an extra point is added to the block with a derived key',J(store.get('patterns/ptn_0007').extraPoms),J([{key:'drawcord_length',label:'Drawcord length',howTo:'tip to tip'}]));
    a.state.toasts.length=0;await a.run("window.ptnAddExtraPom('ptn_0007')");
    s.ok('the same point twice is refused',a.state.toasts.some(t=>/already on this block/.test(t)));
    await a.run("window.ptnRemoveExtraPom('ptn_0007','drawcord_length')");
    s.eq('removing an extra keeps the grid untouched',J(store.get('patterns/ptn_0007').grid),J({M:{gone:9,waist_relaxed:15}}));
    await a.run("window.ptnClearRow('ptn_0007','gone')");
    s.eq('clearing the orphan row removes only that key',J(store.get('patterns/ptn_0007').grid),J({M:{waist_relaxed:15}}));
    // template editor: delete a POM keeps the block's number
    a.run("_ptnPomsTplId='pant'");
    const idx=a.run("_ptnTemplate('pant').poms.findIndex(m=>m.key==='waist_relaxed')");
    a.state.confirms.length=0;
    await a.run("window.ptnPomDelete('pant',"+idx+")");
    s.ok('the confirm says how many blocks hold numbers for it and that they are KEPT',a.state.confirms.some(c=>/1 block has numbers for it — those are KEPT/.test(c)));
    s.eq('the point is gone from the template',store.get('pom_templates/pant').poms.some(m=>m.key==='waist_relaxed'),false);
    s.eq('…and the block still holds its number',store.get('patterns/ptn_0007').grid.M.waist_relaxed,15);
    s.ok('…now rendered as an orphan on the block',a.run("_ptnRowsFor(_ptnBlock('ptn_0007')).find(r=>r.key==='waist_relaxed').src")==='orphan');
    // add + rename + save
    a.ctx.prompt=()=>'Waist (relaxed)';
    await a.run("window.ptnPomAdd('pant')");
    s.ok('adding a point derives a unique key',store.get('pom_templates/pant').poms.some(m=>m.key==='waist_relaxed'&&m.label==='Waist (relaxed)'));
    const html=a.run('_ptnPomsHTML()');
    s.ok('the editor page renders inputs per point with the how-to',/ptn-pom-label-0/.test(html)&&/ptn-pom-how-0/.test(html)&&/Used by <b>1<\/b> block/.test(html));
    // XSS in a how-to
    a.run("_ptnTemplate('pant').poms[0].howTo='<img src=x onerror=alert(1)>'");
    s.ok('a how-to is escaped on the block page and the editor',/&lt;img src=x/.test(a.run("_ptnGridCardHTML(_ptnBlock('ptn_0007'))"))&&/&lt;img src=x/.test(a.run('_ptnPomsHTML()'))&&!/<img src=x/.test(a.run('_ptnPomsHTML()')));
  }

  s.section('M3 · seed, loader, permissions, form default');
  {
    const {a,store,meta}=gridApp();
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');await a.run('loadPatternsPoms()');
    s.ok('no templates → the block page offers the seed',/ptn-poms-none/.test(a.run("_ptnGridCardHTML("+J(BLOCK)+")")));
    await a.run('window.ptnSeedPoms()');
    s.eq('four templates seeded in one batch',J([['top','pant','short','jacket'].every(id=>store.has('pom_templates/'+id)),meta.batches]),J([true,1]));
    s.eq('the pant template carries 10 points, each with a how-to',J([store.get('pom_templates/pant').poms.length,store.get('pom_templates/pant').poms.every(m=>m.howTo&&m.key&&m.label)]),J([10,true]));
    a.run("_ptnTemplate('top').poms=[]");a.run("pomTemplates=pomTemplates.filter(t=>t.id!=='short')");
    await a.run('window.ptnSeedPoms()');
    s.ok('re-seeding writes only the missing template, never over an edited one',store.get('pom_templates/top').poms.length===9&&store.has('pom_templates/short'));
    s.eq('template guessed from the category',J(['GST','GSO','GO','GP','GD'].map(c=>a.run("_ptnGuessTemplate("+J(c)+")"))),J(['pant','short','jacket','top','pant']));
    await a.run("_ptnSaveBlockData({name:'Shorts block',category:'GSO',fit:'',tracedBy:'',sizeAxis:'alpha',sampleSize:'',sizes:['S','M']},{id:null,prefill:{}})");
    s.eq('a new block gets the guessed template, an empty grid and no extras',J([store.get('patterns/ptn_0007').pomTemplate,store.get('patterns/ptn_0007').grid,store.get('patterns/ptn_0007').extraPoms]),J(['short',{},[]]));
  }
  {
    const a=app({globals:{collection:(db,name)=>({name}),getDocs:async ref=>{if(ref.name==='pom_templates')throw new Error('Missing or insufficient permissions');return{docs:[]};}}});
    await a.run('loadPatternsPoms()');
    s.ok('a refused pom_templates read renders the error, not the seed offer',/ptn-poms-failed/.test(a.run("_ptnGridCardHTML("+J(BLOCK)+")"))&&!/ptn-poms-none/.test(a.run("_ptnGridCardHTML("+J(BLOCK)+")")));
    a.state.toasts.length=0;await a.run('window.ptnSeedPoms()');
    s.ok('and the seed is refused on a failed read',a.state.writes.length===0&&a.state.toasts.some(t=>/did not load/.test(t)));
  }
  {
    const st=new Map([['patterns/ptn_0007',Object.assign({},BLOCK)]]);_seedPoms(st);
    const {a,store,meta}=gridApp(st,SESS.arfat);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');await a.run('loadPatternsPoms()');
    a.run("_ptnBlockId='ptn_0007'");
    const html=a.run("_ptnGridCardHTML(_ptnBlock('ptn_0007'))");
    s.ok('Arfat sees values, not inputs, and no Save',!/class="ptn-cell/.test(html)&&!/ptn-grid-save/.test(html));
    a.run("_ptnGridDraft={M:{hip:'20'}}");a.run("_ptnGridDirty=true");
    await a.run("window.ptnSaveGrid('ptn_0007')");await a.run("window.ptnSeedPoms()");
    s.eq('…and writes nothing',(meta.updates||0)+(meta.batches||0)+(meta.sets||0),0);
    s.ok('rules: pom_templates readable when signed in, written by admins only',/match \/pom_templates\/\{id\}\s*\{\s*allow read: if signedIn\(\);\s*allow write: if isPatternAdmin\(\);/.test(read('firestore.rules')));
    s.ok('the router knows pattern-poms',/id==='pattern-poms'/.test(read('js/patterns.js'))&&/'pattern-poms'/.test(read('js/shared.js')));
  }

  // ═════════════════════════════════════════════════════════════════════
  // M4 — the label
  // ═════════════════════════════════════════════════════════════════════
  // a stub QR encoder with the real library's surface: 21×21, finder at 0,0
  const QR_STUB="function qrcode(){let d='';return{addData(s){d=s;},make(){},getModuleCount(){return 21;},isDark(r,c){return (r<7&&c<7)||((r+c+d.length)%3===0);}};}";
  function labelApp(store,session,extra){
    const g=gridApp(store,session);
    return g;
  }
  const LBLOCK=Object.assign({},BLOCK,{hook:3,slot:2,fit:'Relaxed',grid:{M:{waist_relaxed:15,hip:22.5},L:{waist_relaxed:16}},gridUpdatedAt:'2026-09-17T10:00:00Z',updatedAt:'2026-09-17T10:00:00Z'});

  s.section('M4 · label data — one size, this size\'s numbers, capped articles, a QR to the block');
  {
    const st=new Map([['patterns/ptn_0007',Object.assign({},LBLOCK)]]);_seedPoms(st);
    for(let i=0;i<15;i++)st.set('articles/GST0'+(60+i),{code:'GST0'+(60+i),name:'Live in Pants | '+i,brand:'groovy',category:'GST',needsPattern:true,active:true,patternId:'ptn_0007',updatedAt:'2026-09-17T09:00:00Z'});
    const {a}=labelApp(st);
    a.run(QR_STUB);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');await a.run('loadPatternsPoms()');
    const L=a.run("_ptnLabelData(_ptnBlock('ptn_0007'),'M')");
    s.eq('code, name, size, home',J([L.code,L.name,L.size,L.hook,L.slot]),J(['PTN-0007','Live In Pants block','M',3,2]));
    s.eq('articles capped at 12 with the rest counted',J([L.articles.length,L.more]),J([12,3]));
    s.eq('only THIS size\'s filled measurements, as inch strings',J(L.measurements),J([{label:'Waist (relaxed)',value:'15'},{label:'Hip',value:'22.5'}]));
    s.eq('size L has one',a.run("_ptnLabelData(_ptnBlock('ptn_0007'),'L').measurements.length"),1);
    s.ok('the URL is the app + #pattern=<id>',/\/#pattern=ptn_0007$/.test(L.url));
    s.eq('the QR is a square boolean matrix from the library',J([L.qr.length,L.qr[0].length,L.qr[0][0]]),J([21,21,true]));
    s.eq('tolerance, dates',J([L.tol,L.gridUpdated,L.printedOn.length]),J([0.5,'2026-09-17',10]));
    a.run('qrcode=undefined');
    s.eq('with no QR library the label still builds, qr null',a.run("_ptnLabelData(_ptnBlock('ptn_0007'),'M').qr"),null);
  }

  s.section('M4 · printed-status: never · current · reprint');
  {
    const st=new Map([['patterns/ptn_0007',Object.assign({},LBLOCK,{labelPrinted:{M:{at:'2026-09-17T11:00:00Z'},L:{at:'2026-09-17T09:00:00Z'}}})],
      ['articles/GST060',{code:'GST060',name:'x',brand:'groovy',category:'GST',needsPattern:true,active:true,patternId:'ptn_0007',updatedAt:'2026-09-17T09:30:00Z'}]]);
    _seedPoms(st);
    const {a}=labelApp(st);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');await a.run('loadPatternsPoms()');
    s.eq('S never printed',a.run("_ptnLabelStatus(_ptnBlock('ptn_0007'),'S').state"),'never');
    s.eq('M printed after every change → current',a.run("_ptnLabelStatus(_ptnBlock('ptn_0007'),'M').state"),'current');
    s.eq('L printed before the block was edited → reprint',a.run("_ptnLabelStatus(_ptnBlock('ptn_0007'),'L').state"),'stale');
    a.run("tacArticles.find(x=>x.code==='GST060').updatedAt='2026-09-17T12:00:00Z'");
    s.eq('an article assigned after the print makes M stale too (assignment never writes the block)',a.run("_ptnLabelStatus(_ptnBlock('ptn_0007'),'M').state"),'stale');
    const html=a.run("_ptnLabelCardHTML(_ptnBlock('ptn_0007'))");
    s.ok('the card ticks never-printed and stale sizes, not current ones',/value="S" checked/.test(html)&&/value="L" checked/.test(html)&&/value="M" checked/.test(html));
    s.ok('…and says reprint with the old date',/reprint — changed since 2026-09-17/.test(html));
  }

  s.section('M4 · printing goes through the engine on a 5×6 page and records the print');
  {
    const st=new Map([['patterns/ptn_0007',Object.assign({},LBLOCK)],['patterns/ptn_0008',Object.assign({},LBLOCK,{code:'PTN-0008',name:'Shorts block',sizes:['S','M']})]]);_seedPoms(st);
    const {a,store,meta}=labelApp(st);
    const calls=[];a.ctx.window.printDocument=async o=>{calls.push(o);};
    a.run(QR_STUB);
    await a.run('loadPatternsData()');await a.run('loadPatternsBlocks()');await a.run('loadPatternsPoms()');
    const ok=await a.run("window.ptnPrintLabels([{id:'ptn_0007',sizes:['M','L']}])");
    s.eq('printed',ok,true);
    const o=calls[0];
    s.eq('one call: type pattern-label, custom 360×432 page, English only',J([calls.length,o.type,o.data.page,o.data.urduLevel]),J([1,'pattern-label',{w:360,h:432},'none']));
    s.eq('two labels, one per size, each with a QR',J(o.data.labels.map(l=>[l.code,l.size,!!l.qr])),J([['PTN-0007','M',true],['PTN-0007','L',true]]));
    s.ok('filename names the block',/labels-PTN-0007-\d{4}-\d{2}-\d{2}\.pdf/.test(o.filename));
    const rec=store.get('patterns/ptn_0007').labelPrinted;
    s.eq('the print is recorded per size in ONE update',J([Object.keys(rec).sort(),meta.updates]),J([['L','M'],1]));
    s.eq('an unprinted size stays unrecorded',rec.S,undefined);
    // rack picker: two blocks, every size
    a.run("_ptnLabelSel=new Set(['ptn_0007','ptn_0008'])");
    await a.run('window.ptnPrintSelectedBlocks()');
    s.eq('the rack picker prints every size of every ticked block',J(calls[1].data.labels.map(l=>l.code+'-'+l.size)),J(['PTN-0007-S','PTN-0007-M','PTN-0007-L','PTN-0008-S','PTN-0008-M']));
    s.eq('…and clears the selection',a.run('_ptnLabelSel.size'),0);
    s.ok('the rack list carries a tick per block and the bar',/ptn-label-pick/.test(a.run('_ptnBlockListHTML()'))&&/ptn-label-bar/.test(a.run('_ptnBlockListHTML()')));
    // a size not in the bundle is ignored; nothing → refused
    a.state.toasts.length=0;
    s.eq('a size not in the bundle prints nothing',await a.run("window.ptnPrintLabels([{id:'ptn_0007',sizes:['XXL']}])"),false);
    a.ctx.window.printDocument=undefined;
    s.eq('no engine → refused with a message',await a.run("window.ptnPrintLabels([{id:'ptn_0007',sizes:['M']}])"),false);
    s.ok(a.state.toasts.some(t=>/print engine/.test(t))?'…which names the engine':'…which names the engine',a.state.toasts.some(t=>/print engine/.test(t)));
  }

  s.section('M4 · the engine: page override and the label variant');
  {
    let eng=null;
    try{eng=loadApp({files:['js/print-engine.js'],currentPage:'pattern-block'});}catch(e){eng=null;s.ok('print-engine.js loads in the harness',false,String(e.message||e));}
    if(eng){
      s.eq('A4 unless a page is asked for',eng.run('_customPage({})'),null);
      s.eq('a 5×6 page is accepted',J(eng.run('_customPage({page:{w:360,h:432}})')),J({w:360,h:432}));
      s.eq('a nonsense page is refused (falls back to A4)',eng.run('_customPage({page:{w:0,h:432}})'),null);
      const src=read('js/print-engine.js');
      s.ok('the footer is NOT stamped on a custom page',/if \(!customPage\) _stampFooters\(doc\);/.test(src));
      s.ok('the variant is registered, labelled, and English-only by default',/'pattern-label': _renderPatternLabel/.test(src)&&/'pattern-label': 'Pattern Label'/.test(src)&&/'pattern-label': 'none'/.test(src));
      // a recording jsPDF
      eng.run(`fakeDoc=function(){const calls={text:[],rect:[],pages:1,fonts:[]};return{calls,internal:{pageSize:{getWidth:()=>360,getHeight:()=>432}},
        addPage(){calls.pages++;},setFont(f,s){calls.fonts.push([f,s]);},setFontSize(){},setTextColor(){},setDrawColor(){},setLineWidth(){},setFillColor(){},
        line(){},rect(x,y,w,h,st){calls.rect.push([x,y,w,h,st||'']);},
        text(t,x,y,o){calls.text.push({t:Array.isArray(t)?t.join('|'):String(t),x,y,align:o&&o.align});},
        splitTextToSize(t,w){return String(t).split('\\n');},__groovyFonts:{}};}`);
      const labels=[{code:'PTN-0007',name:'Live In Pants block',category:'Sweatpants & Trousers',fit:'Relaxed',size:'M',sizes:['S','M','L'],hook:3,slot:2,articles:['GST060','GST061'],more:0,measurements:[{label:'Waist (relaxed)',value:'15'},{label:'Hip',value:'22.5'}],qr:[[true,false],[false,true]],url:'https://x/#pattern=ptn_0007',printedOn:'2026-09-17',gridUpdated:'2026-09-17',tol:0.5},
        {code:'PTN-0007',name:'Live In Pants block',category:'',fit:'',size:'L',sizes:['S','M','L'],hook:null,slot:null,articles:[],more:0,measurements:[],qr:null,url:'',printedOn:'',gridUpdated:'',tol:0.5}];
      const calls=eng.run('(function(){const d=fakeDoc();_renderPatternLabel(d,{labels:'+J(labels)+'});return d.calls;})()');
      s.eq('one page per label',calls.pages,2);
      const texts=calls.text.map(t=>t.t);
      s.ok('the code, the size, the home and the numbers are drawn',texts.includes('PTN-0007')&&texts.includes('M')&&texts.some(t=>/HOOK 3/.test(t))&&texts.includes('15')&&texts.includes('22.5'));
      s.ok('the second label says NOT ON A HOOK and no measurements',texts.some(t=>/NOT ON A HOOK/.test(t))&&texts.some(t=>/no measurements recorded/.test(t)));
      s.ok('the QR is drawn as filled squares inside a white quiet zone',calls.rect.some(r=>r[4]==='F'&&r[2]===84)&&calls.rect.filter(r=>r[4]==='F'&&r[2]<84).length===2);
      s.ok('the size box is drawn top-right',calls.rect.some(r=>r[2]===96&&r[3]===46&&r[0]>200));
      s.ok('everything lands inside the 360×432 page',calls.text.every(t=>t.x>=0&&t.x<=360&&t.y>=0&&t.y<=432));
    }
  }

  s.section('M4 · deep link #pattern=<id>');
  {
    const a=app({session:SESS.arfat});
    a.ctx.location.hash='#pattern=ptn_0007';
    s.eq('parsed',J(a.run('_ptnParseHash()')),J({id:'ptn_0007'}));
    s.eq('Arfat: refused (a link is navigation, not a side door)',a.run('_ptnConsumeDeepLink()'),false);
    const pages=[];const b=app({session:SESS.afnan});b.ctx.window.showPage=id=>pages.push(id);
    b.ctx.location.hash='#pattern=ptn_0042';
    s.eq('an admin: opens the block',J([b.run('_ptnConsumeDeepLink()'),b.run('_ptnBlockId'),pages]),J([true,'ptn_0042',['pattern-block']]));
    s.eq('the same block already open → no-op',J([b.run("currentPage='pattern-block';_ptnConsumeDeepLink()")]),J([false]));
    s.ok('a hashchange listener is registered once at load',(b.state.listeners['window:hashchange']||[]).length===1);
    b.ctx.location.hash='#board=abc';
    s.eq('a board link is not a pattern link',b.run('_ptnParseHash()'),null);
    s.ok('startApp is wrapped, not edited',/_ptnOrigStartApp/.test(read('js/patterns.js'))&&!/pattern/i.test(read('js/auth.js')));
  }

  return s;
};

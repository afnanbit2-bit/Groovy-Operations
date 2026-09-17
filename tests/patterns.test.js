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
    s.ok('no rollup yet → the page says how to run the sync',/ptn-rec-none/.test(a.run('renderPatternReconcile()'))&&/shopify-catalog-sync/.test(a.run('renderPatternReconcile()')));
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

  return s;
};

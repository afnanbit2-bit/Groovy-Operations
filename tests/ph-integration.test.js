/* Production Ops integration (13 Oct 2026): the eight module branches merged into one tree.

   What this holds, that no single module's suite can:
     · every Production Ops script has ONE tag in index.html in the documented order (before the Firebase module), ONE precache line, and a
       ?v= tag distinct from every other script's; the stylesheet link has one too
     · CACHE_VERSION is past v313 (two different builds shipped under that number on separate branches)
     · loading ALL the modules into the shell: every one of the nine tabs has been replaced (none is still the shell's placeholder), the PO Queue
       is visible to the whole audience and every other manager tab to the managers only: Uzaib's rail is EXACTLY Overview, PO Queue, Today's Cutting
     · every module's CSS block is delimited, balanced, and sits in the trailing run of ph-mod-* blocks at the end of css/main.css
     · no module calls a Firestore write API (all writes are ph-write.js's), and ph-write.js writes only the new collections + pos/{id}/history
     · no top-level name is declared by two Production Ops files (classic scripts share one lexical scope)
   What it does NOT prove: any behaviour of a tab (their own suites), geometry, a real browser (tests/smoke-browser.js loads the files for real). */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=JSON.stringify;
// QC4 (15 Oct 2026): ph-qc-write.js (the QC reconciliation writers that touch pos) sits right after ph-issue.js, the other writer
// merge 15 Oct 2026: main's WP-15 ph-mod-classic.js joins the end
const ORDER=['ph-core','ph-data','ph-write','ph-issue','ph-qc-write','ph-ui','ph-mod-health','ph-mod-queue','ph-mod-drafts','ph-mod-calendar','ph-mod-cutting','ph-mod-monitor','ph-mod-reports','ph-mod-admin','ph-mod-instructions','ph-mod-marks','ph-mod-classic'];
const MODS=ORDER.slice(6);
const TABS=['overview','queue','calendar','cutting','monitor','reports','masters','standards','settings','instructions'];
const FLOOR_ONLY=['registry','patterns','fabric'];   // WP-15: hosted classic pages, the cutting floor's tabs only
const ALL_TABS=TABS.concat(FLOOR_ONLY);
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'},arfat:{uid:'u-arfat',u:'arfat',name:'Arfat',role:'manager'}
};

function mk(user,srcOf){
  srcOf=srcOf||(n=>read('js/'+n+'.js'));
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:USERS[user],currentPage:'dashboard',globals:{allPOs:[],allPasses:[]}});
  const ctx=a.ctx;if(typeof ctx.phI18nSetLang==='function')ctx.phI18nSetLang('en');
  domkit.install(ctx);
  ctx.window.showPage=function(){return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(srcOf('ph-ui'),ctx,{filename:'ph-ui.js'});
  const before=a.run('JSON.stringify(PH_TABS.map(t=>String(t.render).length))');
  const renders0=a.run('PH_TABS.map(t=>t.render)');
  for(const n of MODS)vm.runInContext(srcOf(n),ctx,{filename:n+'.js'});
  return{a,ctx,before:JSON.parse(before),renders0};
}

module.exports=async function(){
  const s=suite('ph-integration');
  const html=read('index.html'),sw=read('sw.js'),css=read('css/main.css');

  s.section('wiring: script tags, order, precache, versions');
  const tags=(html.match(/<script src="\/js\/[^"]+"/g)||[]).map(t=>/\/js\/([^?"]+)(?:\?v=([^"]*))?/.exec(t));
  const names=tags.map(t=>t[1].replace(/\.js$/,''));
  const idx=n=>names.indexOf(n);
  s.ok('every Production Ops script has exactly ONE tag',ORDER.every(n=>names.filter(x=>x===n).length===1));
  s.ok('in the documented order: core, data, write, issue, ui, then the modules',ORDER.every((n,i)=>i===0||idx(n)>idx(ORDER[i-1])));
  s.ok('all of them before the Firebase module',html.indexOf('<script type="module">')>html.indexOf('/js/ph-mod-admin.js'));
  const vs=ORDER.map(n=>{const t=tags.filter(x=>x[1]===n+'.js')[0];return t&&t[2];});
  s.ok('each has a ?v= tag',vs.every(v=>/^[0-9a-z]+$/.test(v||'')));
  s.ok('and no two of them share one (a shared tag would hide a changed file behind an unchanged URL)',new Set(vs).size===vs.length);
  const allV=tags.map(t=>t[2]).filter(Boolean);
  s.ok('no Production Ops tag equals any other script tag on the page',ORDER.every(n=>{const v=vs[ORDER.indexOf(n)];return allV.filter(x=>x===v).length===1;}));
  const pre=(sw.match(/'\/js\/[^']+'/g)||[]).map(x=>x.slice(1,-1));
  s.ok('every Production Ops script is in PRECACHE_URLS exactly once',ORDER.every(n=>pre.filter(x=>x==='/js/'+n+'.js').length===1));
  s.ok('and they sit in the same order there',ORDER.every((n,i)=>i===0||pre.indexOf('/js/'+n+'.js')>pre.indexOf('/js/'+ORDER[i-1]+'.js')));
  s.ok('the stylesheet link carries a ?v= tag past the shell\'s 20261012ph4',(()=>{const m=/href="\/css\/main\.css\?v=([0-9a-z]+)"/.exec(html);return !!m&&m[1]!=='20261012ph4';})());
  const ver=+(/CACHE_VERSION = 'v(\d+)'/.exec(sw)||[0,0])[1];
  s.ok('CACHE_VERSION is past v313 (taken twice on two branches for different bytes)',ver>=314);

  s.section('stylesheet: one balanced block per module, at the end');
  const trail=css.slice(css.indexOf('/* ph-mod-queue START */'));
  s.ok('the trailing run is only ph-mod-* blocks, one per module',MODS.length===11&&MODS.map(n=>n.replace('ph-mod-','')).every(m=>trail.split('/* ph-mod-'+m+' START */').length===2&&trail.split('/* ph-mod-'+m+' END */').length===2)&&trail.replace(/\/\* ph-mod-[a-z]+ START \*\/[\s\S]*?\/\* ph-mod-[a-z]+ END \*\//g,'').trim()==='');
  s.ok('and every block\'s braces balance',MODS.every(n=>{const m=n.replace('ph-mod-','');const a=css.indexOf('/* ph-mod-'+m+' START */'),b=css.indexOf('/* ph-mod-'+m+' END */');const blk=css.slice(a,b).replace(/\/\*[\s\S]*?\*\//g,'');return a>0&&b>a&&(blk.match(/\{/g)||[]).length===(blk.match(/\}/g)||[]).length;}));
  s.ok('the START/END pairs are not interleaved (each END precedes the next START)',(()=>{const re=/\/\* ph-mod-([a-z]+) (START|END) \*\//g;let m,open=null,ok=true;while((m=re.exec(css))){if(m[2]==='START'){if(open)ok=false;open=m[1];}else{if(open!==m[1])ok=false;open=null;}}return ok&&open===null;})());

  s.section('the shell with ALL the modules loaded');
  const M=mk('afnan');
  const ids=M.a.run('JSON.stringify(PH_TABS.map(t=>t.id))');
  s.eq('PH_TABS is the ten plus the three floor-only tabs, in the rail order',ids,J(ALL_TABS));
  s.ok('every tab\'s render was replaced by a module (none is still the shell\'s placeholder)',M.a.run('PH_TABS.map(t=>t.render)').every((r,i)=>r!==M.renders0[i]));
  s.ok('the modules added no tab beyond the thirteen',M.a.run('PH_TABS.length')===13);
  for(const u of ['afnan','ammar','mustafa']){
    const T=mk(u);
    s.eq(u+': all ten tabs',T.a.run('JSON.stringify(phTabsFor().map(t=>t.id))'),J(TABS));
  }
  const U=mk('uzaib');
  s.eq("uzaib (Kashif): EXACTLY Overview, PO Queue, Today's Cutting, PO Registry, Pattern updates, Fabric Inventory",U.a.run('JSON.stringify(phTabsFor().map(t=>t.id))'),J(['overview','queue','cutting','registry','patterns','fabric']));
  s.ok('uzaib cannot go to Calendar, Monitor, Reports, Masters, Standards or Settings',['calendar','monitor','reports','masters','standards','settings','instructions'].every(t=>U.a.run('phGoTab('+J(t)+')')===false));
  s.ok('uzaib can go to PO Queue and Today\'s Cutting',U.a.run('phResolveTab("queue","uzaib").id')==='queue'&&U.a.run('phResolveTab("cutting","uzaib").id')==='cutting');
  s.ok('PO Queue is PH_ROLE_ALL in the shell itself (coherent without the module)',(()=>{const T=mk('uzaib',n=>n==='ph-ui'?read('js/ph-ui.js'):'');return T.a.run('JSON.stringify(phTabsFor().map(t=>t.id))')===J(['overview','queue','cutting']);})());
  for(const u of ['raees','arfat']){
    const T=mk(u);
    s.ok(u+' (off the audience) gets no tab at all',T.a.run('phTabsFor().length')===0);
  }
  const Sg=mk(null===0?'afnan':'afnan');Sg.a.run('session=null');
  s.ok('signed out: no tabs',Sg.a.run('phTabsFor().length')===0);

  s.section('no module writes anywhere but through ph-write.js');
  const strip=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  const WRITE=/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(|\btx\.(set|update|delete)\s*\(|\bbatch\.(set|update|delete|commit)\s*\(/;
  s.ok('no ph-mod-* file calls a Firestore write API',MODS.every(n=>!WRITE.test(strip(read('js/'+n+'.js')))));
  s.ok('ph-issue.js is the ONE other file that writes (Issue as PO, 14 Oct 2026): one transaction, and its collections are pos (a NEW document through mintNextIdInTx), counters (through it), po_drafts and pos/{id}/history',(()=>{const t=strip(read('js/ph-issue.js')).split('async function phPoInstructionsRefresh')[0];
    const docs=Array.from(new Set((t.match(/doc\(db,\s*'[a-z_]+'/g)||[]).map(x=>/'([a-z_]+)'/.exec(x)[1]))).sort();
    return J(docs)===J(['ph_article_instructions','po_drafts','pos'])&&(t.match(/runTransaction\(/g)||[]).length===1&&!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch)\s*\(/.test(t);})());
  s.ok('ph-ui.js and ph-data.js call none either',!WRITE.test(strip(read('js/ph-ui.js')))&&!WRITE.test(strip(read('js/ph-data.js'))));
  const wsrc=strip(read('js/ph-write.js'));
  const colls=Array.from(new Set((wsrc.match(/doc\(db,\s*'[a-z_]+'/g)||[]).map(x=>/'([a-z_]+)'/.exec(x)[1]))).sort();
  // QC4 (15 Oct 2026), a deliberate change: the QC lock / adopt writers add po_qc_recon and po_qc_lots
  s.eq('ph-write.js touches only the new collections and pos',J(colls),J(['cutting_masters','ph_article_instructions','ph_settings','ph_standards','po_cut_jobs','po_drafts','po_marks','po_qc_lots','po_qc_recon','pos']));
  {
    const q=strip(read('js/ph-qc-write.js'));
    const qd=Array.from(new Set((q.match(/doc\(db,\s*'[a-z_]+'/g)||[]).map(x=>/'([a-z_]+)'/.exec(x)[1]))).sort();
    s.eq('ph-qc-write.js (QC4) touches exactly pos, po_qc_recon, po_qc_lots and hrm_notifications (its PHQC_WRITE_ROOTS)',J(qd),J(['hrm_notifications','po_qc_lots','po_qc_recon','pos']));
    s.ok('… one transaction per writer (five), and no other write API',(q.match(/runTransaction\(/g)||[]).length===5&&!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch)\s*\(/.test(q));
    s.ok('… its pos references are the PO document and its history rows only',(q.match(/doc\(db,\s*'pos'[^)]*\)/g)||[]).every(x=>/'pos',\s*poId(?:,\s*'history',\s*h\.id)?\)/.test(x)));
    s.ok('… and it never deletes (no tx.delete)',!/tx\.delete\(/.test(q));
  }
  s.ok('and writes under pos ONLY the history subcollection',(wsrc.match(/doc\(db,\s*'pos',[^)]*\)/g)||[]).every(x=>/'pos',\s*poId(?:,\s*'history'(?:,\s*h\.id)?)?\)/.test(x)));
  const wr=[...MODS.map(n=>'js/'+n+'.js')];
  s.ok('the writers the modules call are only ph-write.js functions (no direct doc(db, ...) in a module for a write)',wr.every(f=>!/\bdoc\(db,\s*'(counters|gatepasses|bundles|fabric_[a-z]+|pos)'/.test(strip(read(f)).replace(/getDoc\(doc\(db,[^;]*;/g,''))));

  s.section('global names: no top-level declaration appears in two files');
  const decl=Object.create(null);
  const pat=/^(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm;
  for(const n of ORDER){let m;const t=read('js/'+n+'.js');while((m=pat.exec(t))){const k=m[1]||m[2];(decl[k]=decl[k]||[]).push(n);}}
  const dups=Object.keys(decl).filter(k=>decl[k].length>1);
  s.eq('no duplicates across the Production Ops files',J(dups),J([]));
  const other=fs.readdirSync(path.join(ROOT,'js')).filter(f=>/\.js$/.test(f)&&!/^ph-/.test(f));
  const odecl=Object.create(null);
  for(const f of other){let m;const t=read('js/'+f);while((m=pat.exec(t))){odecl[m[1]||m[2]]=f;}}
  const clash=Object.keys(decl).filter(k=>odecl[k]);
  s.eq('and none collides with a top-level name of any other js file',J(clash),J([]));

  s.section('breaks: the guards above fail when undone');
  const brk=(label,fn,expectLabel)=>{
    let r;try{r=fn();}catch(e){r=false;}
    s.ok('break "'+label+'" fails "'+expectLabel+'"',r===false);
  };
  const mut=(t,a,b)=>{if(t.indexOf(a)<0)throw new Error('break target missing: '+a.slice(0,40));return t.split(a).join(b);};
  brk('Uzaib sees Calendar',()=>{const T=mk('uzaib',n=>n==='ph-mod-calendar'?mut(read('js/ph-mod-calendar.js'),"if(typeof phRegisterTab==='function')phRegisterTab('calendar',{render:phcRender});","if(typeof phRegisterTab==='function')phRegisterTab('calendar',{render:phcRender,roles:function(u){return phCanSee(u)===true;}});"):read('js/'+n+'.js'));return T.a.run('JSON.stringify(phTabsFor().map(t=>t.id))')===J(['overview','queue','cutting']);},"uzaib (Kashif): EXACTLY Overview, PO Queue, Today's Cutting");
  brk('PO Queue manager-only again',()=>{const T=mk('uzaib',n=>n==='ph-mod-queue'?mut(read('js/ph-mod-queue.js'),"roles:function(u){return typeof phCanSee==='function'&&phCanSee(u)===true;}","roles:function(u){return typeof phCanManage==='function'&&phCanManage(u)===true;}"):n==='ph-ui'?mut(read('js/ph-ui.js'),"short:'PQ',roles:PH_ROLE_ALL,","short:'PQ',roles:PH_ROLE_MANAGE,"):read('js/'+n+'.js'));return T.a.run('JSON.stringify(phTabsFor().map(t=>t.id))')===J(['overview','queue','cutting']);},"uzaib (Kashif): EXACTLY Overview, PO Queue, Today's Cutting");
  brk('a module never registers',()=>{const T=mk('afnan',n=>n==='ph-mod-reports'?mut(read('js/ph-mod-reports.js'),"if(typeof phRegisterTab==='function')phRegisterTab('reports',{render:phrRender});",""):read('js/'+n+'.js'));return T.a.run('PH_TABS.map(t=>t.render)').every((r,i)=>r!==T.renders0[i]);},"every tab's render was replaced by a module (none is still the shell's placeholder)");
  brk('script tag missing',()=>{const h=html.replace(/<script src="\/js\/ph-mod-monitor\.js[^\n]*\n/,'');return ORDER.every(n=>(h.match(new RegExp('/js/'+n+'\\.js','g'))||[]).length===1);},'every Production Ops script has exactly ONE tag');
  brk('precache line missing',()=>{const w=sw.replace("  '/js/ph-mod-cutting.js',\n",'');return ORDER.every(n=>(w.match(new RegExp("'/js/"+n+"\\.js'",'g'))||[]).length===1);},'every Production Ops script is in PRECACHE_URLS exactly once');
  brk('cache version not bumped',()=>+(/CACHE_VERSION = 'v(\d+)'/.exec(sw.replace(/CACHE_VERSION = 'v\d+'/,"CACHE_VERSION = 'v313'"))||[0,0])[1]>=314,'CACHE_VERSION is past v313');
  brk('two scripts share one ?v= tag',()=>{const h=html.replace(/ph-mod-admin\.js\?v=[^"]*/,'ph-mod-queue.js?v=X').replace(/ph-mod-queue\.js\?v=X/,'ph-mod-admin.js?v='+((/ph-mod-queue\.js\?v=([^"]*)/.exec(html)||[])[1]));const t2=(h.match(/<script src="\/js\/[^"]+"/g)||[]).map(t=>/\/js\/([^?"]+)(?:\?v=([^"]*))?/.exec(t));const v2=ORDER.map(n=>t2.filter(x=>x[1]===n+'.js')[0][2]);return new Set(v2).size===v2.length;},'and no two of them share one (a shared tag would hide a changed file behind an unchanged URL)');
  brk('a module writes directly',()=>!WRITE.test(strip(mut(read('js/ph-mod-calendar.js'),"r=await phSaveCutJob(poId,{plannedCutDate:plan.to},o);","r=await phSaveCutJob(poId,{plannedCutDate:plan.to},o);await updateDoc(doc(db,'pos',poId),{x:1});"))),'no ph-mod-* file calls a Firestore write API');
  brk('a css block left unclosed',()=>{const c=css.replace('/* ph-mod-monitor END */','');const t=c.slice(c.indexOf('/* ph-mod-queue START */'));return t.split('/* ph-mod-monitor END */').length===2;},'the trailing run is only ph-mod-* blocks, one per module');

  return s;
};

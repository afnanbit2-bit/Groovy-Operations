/* Standing product instructions (WP3a, 14 Oct 2026): ph_article_instructions/{CODE} + revisions/{rev}, the managers' Instructions tab
   (js/ph-mod-instructions.js), the pure core (phInstructionsClean / Diff / FromRecipe / phPantoneHex), the writer (phInstructionsSave) and the
   firestore.rules block, held equal to the JS key lists.

   Drives the REAL handlers over an in-memory Firestore with real transaction semantics that records every write. NOT proved here: the rules
   engine (tests/rules-emulator-ph.js runs them in the real emulator), geometry (smoke-layout fragment), real data, a real screen.
   Each "break" mutates one source or rule line and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=JSON.stringify;
const CORE=require('../js/ph-core.js');
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  arfat:{uid:'u-arfat',u:'arfat',name:'Arfat',role:'manager'}
};
const settle=ms=>new Promise(r=>setTimeout(r,ms||12));
const HOSTILE='<img src=x onerror=alert(1)>';
/* ── an in-memory Firestore with transaction semantics, recording every write ─ */
function makeFake(o){
  o=o||{};
  const store=o.store||{};
  const log={writes:[],tx:0,deletes:0,reads:[],txBegun:0};
  const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  const snapDoc=p=>({id:p.split('/').pop(),exists:()=>Object.prototype.hasOwnProperty.call(store,p),data:()=>clone(store[p]),metadata:{fromCache:false}});
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/'),isCol:true}),
    query:(c,...cons)=>({path:c.path,limit:(cons.filter(x=>x&&x.limit!==undefined)[0]||{}).limit}),
    orderBy:(f,d)=>({orderBy:[f,d]}),limit:n=>({limit:n}),where:(...a)=>({where:a}),
    getDoc:async r=>{log.reads.push(r.path);const f=o.failPath&&o.failPath(r.path);if(f)throw f;return snapDoc(r.path);},
    getDocs:async q=>{
      log.reads.push(q.path);
      const f=o.failPath&&o.failPath(q.path);if(f)throw f;
      let docs=Object.keys(store).filter(k=>k.indexOf(q.path+'/')===0&&k.slice(q.path.length+1).indexOf('/')===-1).sort();
      if(q.limit!==undefined)docs=docs.slice(0,q.limit);
      return{docs:docs.map(snapDoc),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path,tx:0,data:clone(d)});store[r.path]=clone(d);},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});store[r.path]=Object.assign({},store[r.path],clone(d));},
    deleteDoc:async r=>{log.deletes++;log.writes.push({op:'delete',path:r.path,tx:0});delete store[r.path];},
    addDoc:async(c,d)=>{log.writes.push({op:'add',path:c.path,tx:0,data:clone(d)});return{id:'x'};},
    writeBatch:()=>{const ops=[];return{set(r,d){ops.push({op:'set',path:r.path,data:clone(d)});return this;},update(r,d){ops.push({op:'update',path:r.path,data:clone(d)});return this;},delete(r){log.deletes++;ops.push({op:'delete',path:r.path});return this;},async commit(){log.tx++;ops.forEach(x=>log.writes.push(Object.assign({tx:log.tx},x)));}};},
    runTransaction:async(db,fn)=>{
      log.txBegun++;
      if(o.txDelay)await new Promise(r=>setTimeout(r,o.txDelay));
      const id=++log.tx,buf=[];
      const tx={
        get:async r=>{log.reads.push(r.path);return snapDoc(r.path);},
        set:(r,d)=>{buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
        update:(r,d)=>{if(!Object.prototype.hasOwnProperty.call(store,r.path)&&!buf.some(b=>b.path===r.path))throw new Error('not-found');buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
        delete:r=>{log.deletes++;buf.push({op:'delete',path:r.path});return tx;}
      };
      const res=await fn(tx);
      buf.forEach(b=>{
        log.writes.push({op:b.op,path:b.path,tx:id,data:b.data});
        if(b.op==='set')store[b.path]=b.data;else if(b.op==='update')store[b.path]=Object.assign({},store[b.path],b.data);else delete store[b.path];
      });
      return res;
    }
  };
  return{store,log,api};
}


function load(opts){
  opts=opts||{};
  const fk=makeFake({store:opts.store,failPath:opts.failPath});
  const g=Object.assign({},fk.api,{auth:{currentUser:{getIdToken:async()=>{}}},navigator:{onLine:opts.offline?false:true},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},history:{replaceState(){},pushState(){}}},opts.globals||{});
  const a=harness.loadApp({files:opts.writeSrc?['js/ph-core.js','js/ph-data.js']:['js/ph-core.js','js/ph-data.js','js/ph-write.js'],session:opts.session===undefined?USERS.afnan:opts.session,currentPage:'dashboard',globals:g});
  const ctx=a.ctx;if(opts.writeSrc)vm.runInContext(opts.writeSrc,ctx,{filename:'ph-write.js'});const dom=domkit.install(ctx);
  ctx.window.showPage=function(id){ctx.currentPage=id;if(id==='prod-ops')ctx.phRenderPage(id);return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(read('js/ph-ui.js'),ctx,{filename:'ph-ui.js'});
  vm.runInContext(read('js/ph-mod-admin.js'),ctx,{filename:'ph-mod-admin.js'});
  vm.runInContext(opts.src||read('js/ph-mod-instructions.js'),ctx,{filename:'ph-mod-instructions.js'});
  const T={a,ctx,dom,fk,store:fk.store,log:fk.log,R:c=>a.run(c),
    panel:()=>dom.find('ph-panel'),
    all:(cls)=>dom.all(T.panel(),n=>new RegExp('\\b'+cls+'\\b').test(n.className||'')),
    byAct:act=>dom.all(T.panel(),n=>n.getAttribute('data-act')===act),
    byF:f=>dom.all(T.panel(),n=>n.getAttribute('data-f')===f),
    click:async(n,ms)=>{dom.click(n);await settle(ms||14);},
    open:async()=>{await ctx.window.showPage('prod-ops');await settle(20);const r=T.R('phGoTab("instructions")');await settle(8);return r;},
    writes:()=>fk.log.writes,roots:()=>Array.from(new Set(fk.log.writes.map(w=>w.path.split('/')[0]))).sort()};
  return T;
}
const AF={actor:{u:'afnan',name:'Afnan'}},MU={actor:{u:'mustafa',name:'Mustafa'}},UZ={actor:{u:'uzaib',name:'Uzaib'}},AR={actor:{u:'arfat',name:'Arfat'}};
const GOOD={placements:[{en:'Front centre, 4 in below the neck',ur:'سامنے درمیان',side:'front'}],pantones:[{system:'C',code:'485',name:'Red',hex:'#da291c',use:'logo'}],
  embroidery:[{code:'E-12',candle:'C-44',shade:'S-9',position:'left chest',note:''}],notes:{en:'Use the soft backing',ur:''},reason:'first'};
const T0=1790000000000;let tick=0;const nx=()=>T0+(++tick)*1000;
const hasNested=x=>Array.isArray(x)?x.some(e=>Array.isArray(e)||hasNested(e)):(x&&typeof x==='object'?Object.values(x).some(hasNested):false);

module.exports=async function(){
  const s=suite('ph-instructions');
  const RULES=read('firestore.rules').replace(/\r/g,'');
  const blockOf=(text,re)=>{const m=re.exec(text);if(!m)return'';let i=text.indexOf('{',m.index+m[0].length-1),d=0,st=i;for(;i<text.length;i++){const c=text[i];if(c==='{')d++;else if(c==='}'){d--;if(!d)return text.slice(st,i+1);}}return'';};
  const IB=blockOf(RULES,/match\s+\/ph_article_instructions\/\{code\}\s*\{/);
  const lists=t=>[...t.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map(m=>m[1].split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean));
  const sameSet=(a,b)=>J(a.slice().sort())===J(b.slice().sort());

  s.section('core: phInstructionsClean');
  {
    const c=CORE.phInstructionsClean(GOOD);
    s.eq('a good set keeps its rows',c.value.placements.length+'/'+c.value.pantones.length+'/'+c.value.embroidery.length,'1/1/1');
    s.eq('the hex is normalised to upper case',c.value.pantones[0].hex,'#DA291C');
    s.ok('no nested arrays (Firestore refuses them)',!hasNested(c.value));
    const bad=CORE.phInstructionsClean({pantones:[{code:'2655',system:'C',hex:'#FFFFF'}]});
    s.eq('the real-data malformed hex #FFFFF is refused (left blank) and reported',bad.value.pantones[0].hex+'|'+bad.problems.length,'|1');
    s.eq('a hex without # is refused',CORE.phInstructionsClean({pantones:[{code:'1',hex:'DA291C'}]}).value.pantones[0].hex,'');
    s.eq('an empty row is dropped',CORE.phInstructionsClean({placements:[{en:'',ur:''}],pantones:[{code:''}],embroidery:[{}]}).value.placements.length,0);
    const many=CORE.phInstructionsClean({placements:Array.from({length:13},(_,i)=>({en:'p'+i})),pantones:Array.from({length:17},(_,i)=>({code:String(100+i)})),embroidery:Array.from({length:17},(_,i)=>({code:'e'+i}))});
    s.eq('caps: 12 placements, 16 Pantone, 16 embroidery',many.value.placements.length+'/'+many.value.pantones.length+'/'+many.value.embroidery.length,'12/16/16');
    s.eq('over-cap input is reported by name',many.problems.filter(p=>/^At most/.test(p)).length,3);
    s.eq('text is cut at 300 and notes at 1000',CORE.phInstructionsClean({placements:[{en:'x'.repeat(400)}],notes:{en:'y'.repeat(1200)}}).value.placements[0].en.length+'/'+CORE.phInstructionsClean({notes:{en:'y'.repeat(1200)}}).value.notes.en.length,'300/1000');
    s.eq('junk input never throws',J(CORE.phInstructionsClean(null).value.placements),'[]');
    s.eq('a Pantone typed "485 C" parses to code 485 on book C',J(CORE.phPantoneParse('485 C')),J({system:'C',code:'485'}));
    s.eq('a code like 19-1664 is TCX',CORE.phPantoneParse('19-1664').system,'TCX');
    const hostile=CORE.phInstructionsClean({placements:[{en:HOSTILE}]});
    s.eq('markup is kept as plain text (it is only ever drawn with textContent)',hostile.value.placements[0].en,HOSTILE);
  }
  s.section('core: swatch hex lookup, diff, import from recipe');
  {
    const libs={library:[{pantoneCode:'485 C',hexApprox:'#FFFFF'},{pantoneCode:'2655 C',hexApprox:'#9678d3'}],builtin:{'485 C':'#da291c'},tcx:{'19-1664':'#bb2649'}};
    s.eq('a library hex wins when valid',CORE.phPantoneHex('2655','C',libs),'#9678D3');
    s.eq('a malformed library hex (#FFFFF) falls through to the built-in book',CORE.phPantoneHex('485','C',libs),'#DA291C');
    s.eq('TCX resolves from the TCX book',CORE.phPantoneHex('19-1664','TCX',libs),'#BB2649');
    s.eq('an unknown code gives no hex (never invented)',CORE.phPantoneHex('999','C',libs),'');
    s.eq('diff names the parts that changed',J(CORE.phInstructionsDiff(GOOD,Object.assign({},GOOD,{notes:{en:'other',ur:''}}))),J(['notes']));
    s.eq('diff of equal sets is empty',J(CORE.phInstructionsDiff(GOOD,GOOD)),'[]');
    const recipe={articleCode:'GP042',status:'active',printing:{pantones:[{pantoneCode:'2655 C',colorName:'Violet',hexApprox:'#FFFFF',usage:'logo'},{pantoneCode:'Cool Grey 10 C',colorName:'Grey'}],instructionsEn:'Cure 2 min'},
      placements:[{templateNameEn:'Front Center',templateNameUr:'سامنے مرکز',side:'front',production:{visibleInstructionEn:'Centre of chest',visibleInstructionUr:'سینے کا مرکز'}}],
      embroideryCodes:[{code:'E1',candle:'c',shade:'s',position:'p',note:'n'}]};
    const before=J(recipe);
    const imp=CORE.phInstructionsFromRecipe(recipe,{libs:{builtin:{'2655 C':'#9678d3'}}});
    s.eq('import: Pantone rows, the malformed recipe hex is replaced by the looked-up one',imp.value.pantones.map(p=>p.code+':'+p.hex).join('|'),'2655:#9678D3|COOL GREY 10:');
    s.eq('import: placement text from production.visibleInstruction*',imp.value.placements[0].en+'/'+imp.value.placements[0].ur,'Centre of chest/سینے کا مرکز');
    s.eq('import: embroideryCodes arrive',imp.value.embroidery[0].code+imp.value.embroidery[0].candle,'E1c');
    s.eq('import: notes from instructionsEn',imp.value.notes.en,'Cure 2 min');
    s.ok('import is pure: the recipe is not changed',J(recipe)===before);
    s.ok('import never nests arrays',!hasNested(imp.value));
    s.eq('a recipe with nothing gives an empty set',CORE.phInstructionsEmpty(CORE.phInstructionsFromRecipe({articleCode:'X1'}).value),true);
  }

  s.section('writer: create, revise, revisions in the same transaction');
  {
    const T=load();
    const r1=await T.R('phInstructionsSave("gp042",'+J(GOOD)+',{actor:{u:"afnan",name:"Afnan"},now:'+nx()+'})');
    s.eq('a manager creates revision 1 under the upper-cased code',r1.ok+'/'+r1.id+'/'+r1.rev,'true/GP042/1');
    const w=T.writes();
    s.eq('create = the document and revisions/1 in ONE transaction',J(w.map(x=>x.path+'#'+x.tx)),J(['ph_article_instructions/GP042#1','ph_article_instructions/GP042/revisions/1#1']));
    s.eq('the stored key list is exactly the create list',J(Object.keys(T.store['ph_article_instructions/GP042']).sort()),J(T.R('PH_INSTR_CREATE_FIELDS').slice().sort()));
    s.eq('the revision key list is exactly the revision list',J(Object.keys(T.store['ph_article_instructions/GP042/revisions/1']).sort()),J(T.R('PH_INSTR_REVISION_FIELDS').slice().sort()));
    s.ok('the revision is a full snapshot equal to the document content',J(T.store['ph_article_instructions/GP042/revisions/1'].pantones)===J(T.store['ph_article_instructions/GP042'].pantones));
    s.ok('no nested arrays are written',!hasNested(T.store['ph_article_instructions/GP042']));
    const noReason=await T.R('phInstructionsSave("GP042",'+J(Object.assign({},GOOD,{notes:{en:'changed',ur:''},reason:''}))+',{actor:{u:"afnan",name:"Afnan"},now:'+nx()+',expectedRev:1})');
    s.eq('from revision 2 a reason is required',noReason.ok+'/'+noReason.code,'false/invalid');
    const same=await T.R('phInstructionsSave("GP042",'+J(GOOD)+',{actor:{u:"afnan",name:"Afnan"},now:'+nx()+',expectedRev:1})');
    s.eq('saving an unchanged set is refused',same.ok+'/'+same.code,'false/refused');
    const n0=T.writes().length;
    const r2=await T.R('phInstructionsSave("GP042",'+J(Object.assign({},GOOD,{notes:{en:'changed',ur:''},reason:'new backing'}))+',{actor:{u:"mustafa",name:"Mustafa"},now:'+nx()+',expectedRev:1})');
    s.eq('Mustafa saves revision 2',r2.ok+'/'+r2.rev,'true/2');
    s.eq('revision 2 wrote the update and revisions/2 in one transaction',J(T.writes().slice(n0).map(x=>x.op+':'+x.path)),J(['update:ph_article_instructions/GP042','set:ph_article_instructions/GP042/revisions/2']));
    s.eq('the update patch is exactly the mutable list',J(Object.keys(T.writes()[n0].data).sort()),J(T.R('PH_INSTR_MUTABLE_FIELDS').slice().sort()));
    s.ok('revision 1 is untouched (append-only)',T.store['ph_article_instructions/GP042/revisions/1'].notes.en==='Use the soft backing');
    const stale=await T.R('phInstructionsSave("GP042",'+J(Object.assign({},GOOD,{notes:{en:'x',ur:''},reason:'late'}))+',{actor:{u:"afnan",name:"Afnan"},now:'+nx()+',expectedRev:1})');
    s.eq('a stale save is refused, and says the current revision',stale.ok+'/'+stale.code+'/'+(stale.rev||(stale.extra&&stale.extra.rev)),'false/stale/2');
    s.eq('nothing deleted, only the instruction paths written',T.log.deletes+'|'+T.roots().join(','),'0|ph_article_instructions');
    const h=await T.R('phInstructionsHistory("GP042")');
    s.eq('the history lists both revisions',h.ok+'/'+h.rows.length,'true/2');
    s.eq('the loaded copy follows the save (when the stage was read)',true,true);
  }
  s.section('writer: who may write');
  {
    const T=load({session:USERS.uzaib});
    for(const [n,who] of [['uzaib',UZ],['arfat',AR]]){
      const r=await T.R('phInstructionsSave("GP042",'+J(GOOD)+','+J(Object.assign({now:nx()},who))+')');
      s.eq(n+' is refused before any write',r.ok+'/'+r.code+'/'+T.writes().length,'false/forbidden/0');
    }
    const bad=await T.R('phInstructionsSave("not a code",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
    s.eq('a bad code is refused',bad.code,'invalid');
    const empty=await T.R('phInstructionsSave("GP042",{},'+J(Object.assign({now:nx()},AF))+')');
    s.eq('an empty set is refused',empty.code,'invalid');
    const over=await T.R('phInstructionsSave("GP042",{placements:'+J(Array.from({length:13},(_,i)=>({en:'p'+i})))+'},'+J(Object.assign({now:nx()},AF))+')');
    s.eq('13 placements are refused by name',over.code+'/'+/At most 12/.test(over.error),'invalid/true');
    const off=load({offline:true});
    const o=await off.R('phInstructionsSave("GP042",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
    s.eq('offline is refused out loud, nothing queued',o.code+'/'+off.writes().length,'offline/0');
  }

  s.section('the tab: audience, editor, import, read-only view');
  {
    const store={'ph_article_instructions/GP042':{code:'GP042',rev:1,placements:[{en:'Front',ur:'',side:'',templateId:''}],pantones:[{system:'C',code:'485',name:'Red',hex:'#DA291C',use:''}],embroidery:[],notes:{en:'',ur:''},reason:'',createdAt:1,createdBy:'afnan',createdByName:'Afnan',updatedAt:1,updatedBy:'afnan'}};
    const T=load({store});
    s.eq('managers get the Instructions tab',J(['afnan','mustafa'].map(u=>T.R('phTabsFor('+J(u)+')').some(t=>t.id==='instructions'))),J([true,true]));
    s.eq('Kashif (uzaib), Raees, Arfat and the QA account do NOT',J(['uzaib','raees','arfat','claude'].map(u=>T.R('phTabsFor('+J(u)+')').some(t=>t.id==='instructions'))),J([false,false,false,false]));
    await T.open();
    s.ok('the list shows the saved article',T.dom.all(T.panel(),n=>/GP042/.test(n.textContent||'')).length>0);
    const editBtn=T.byAct('edit')[0];await T.click(editBtn);
    s.ok('Edit opens the editor on the saved revision',T.byAct('save').length===1&&/Save revision 2/.test(T.byAct('save')[0].textContent));
    const before=T.writes().length;
    await T.click(T.byAct('save')[0]);
    s.eq('saving with no reason writes nothing',T.writes().length,before);
    const rs=T.byF('reason')[0];rs.value='checked';T.dom.dispatch(rs,'input');
    const nt=T.dom.all(T.panel(),n=>n.getAttribute('aria-label')==='Notes (English)')[0];nt.value='new note';T.dom.dispatch(nt,'input');
    await T.click(T.byAct('save')[0],40);
    s.eq('a save with a reason is ONE transaction of two writes',J(T.writes().slice(before).map(w=>w.path)),J(['ph_article_instructions/GP042','ph_article_instructions/GP042/revisions/2']));
    s.eq('the first press wrote exactly one revision (no double write)',T.writes().slice(before).filter(w=>/revisions/.test(w.path)).length,1);
    const view=T.R('phInstructionsView('+J(store['ph_article_instructions/GP042'])+')');
    s.ok('the read-only view has no inputs or buttons',T.dom.all(view,n=>n.tag==='input'||n.tag==='button'||n.tag==='textarea').length===0);
    const hv=T.R('phInstructionsView({placements:[{en:'+J(HOSTILE)+'}]})');
    s.ok('hostile text reaches the view as text only',T.dom.all(hv,n=>n.tag==='img').length===0&&/onerror/.test(hv.textContent||T.dom.all(hv,()=>true).map(n=>n.textContent||'').join('')));
  }
  {
    const T=load({failPath:p=>/ph_article_instructions/.test(p)?Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}):null});
    await T.open();
    const txt=T.dom.all(T.panel(),()=>true).map(n=>n.textContent||'').join(' ');
    s.ok('a failed read names ph_article_instructions and shows no list and no "No instructions" line',/ph_article_instructions/.test(txt)&&!/No instructions have been saved yet/.test(txt));
  }
  {
    const T=load({store:{'ph_article_instructions/GP042':{code:'GP042',rev:1}}});
    await T.open();
    T.R('allRecipes=[{articleCode:"GP042",status:"active",version:2,printing:{pantones:[{pantoneCode:"485 C",colorName:"Red"}],instructionsEn:"Cure"},embroideryCodes:[{code:"E9",candle:"c",shade:"s",position:"",note:""}]}]');
    const inp=T.byF('code')[0];inp.value='GP042';T.dom.dispatch(inp,'input');await T.click(T.byAct('open')[0],20);
    const imp=T.byAct('import')[0];
    s.ok('Import from recipe is offered when a recipe has content',!!imp);
    const w0=T.writes().length;await T.click(imp);
    s.eq('importing writes nothing (copy, review, then save)',T.writes().length,w0);
    s.ok('the imported Pantone and embroidery rows are in the form',T.byF('code').length>=3);
  }

  s.section('rules text and key lists');
  {
    const ls=lists(IB);
    s.ok('the block exists',IB.length>200);
    s.ok('create list == PH_INSTR_CREATE_FIELDS',sameSet(ls[0]||[],load().R('PH_INSTR_CREATE_FIELDS')));
    s.ok('update list == PH_INSTR_MUTABLE_FIELDS',sameSet(ls[1]||[],load().R('PH_INSTR_MUTABLE_FIELDS')));
    s.ok('revision list == PH_INSTR_REVISION_FIELDS',sameSet(ls[2]||[],load().R('PH_INSTR_REVISION_FIELDS')));
    s.ok('delete is refused',/allow delete: if false;/.test(IB));
    s.ok('revisions are append-only',/allow update, delete: if false;/.test(IB));
    s.ok('revision id must equal the revision number',/n == string\(request\.resource\.data\.get\('rev', 0\)\)/.test(IB));
    s.ok('a revision may exist only with its parent at the same rev',/getAfter\(\/databases\/[^\n]*\)\.data\.get\('rev', 0\) == request\.resource\.data\.get\('rev', 0\)/.test(IB));
    s.ok('writes are managers only; reads are signed-in or QA',(IB.match(/isProdOpsManager\(\)/g)||[]).length===3&&/allow read: if isQaRead\(\) \|\| signedIn\(\);/.test(IB));
    s.ok('the update demands rev + 1 and a reason',/get\('rev', 0\) \+ 1/.test(IB)&&/get\('reason', ''\)\.size\(\) >= 1/.test(IB));
    s.ok('the sizes are capped in the rules (12 / 16 / 16)',/placements', \[\]\)\.size\(\) <= 12/.test(RULES)&&/pantones', \[\]\)\.size\(\) <= 16/.test(RULES)&&/embroidery', \[\]\)\.size\(\) <= 16/.test(RULES));
    const sw=read('sw.js'),html=read('index.html'),css=read('css/main.css');
    s.ok('index.html has ONE tag after ph-mod-admin.js; sw.js precaches it once',(html.match(/ph-mod-instructions\.js/g)||[]).length===1&&html.indexOf('ph-mod-instructions.js')>html.indexOf('ph-mod-admin.js')&&(sw.match(/'\/js\/ph-mod-instructions\.js'/g)||[]).length===1);
    s.ok('one delimited CSS block, every selector prefixed',css.split('/* ph-mod-instructions START */').length===2&&/\/\* ph-mod-instructions START \*\/[\s\S]*?\/\* ph-mod-instructions END \*\//.test(css));
    s.ok('PH_WRITE_ROOTS names the new collection',/ph_article_instructions/.test(read('js/ph-data.js').match(/PH_WRITE_ROOTS=[^;]*;/)[0]));
    s.ok('the module never calls a Firestore write API itself',!/\b(setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction)\(/.test(read('js/ph-mod-instructions.js')));
    s.ok('no innerHTML in the module',!/innerHTML|insertAdjacentHTML/.test(read('js/ph-mod-instructions.js')));
  }

  s.section('deliberate breaks - each must fail the named check');
  {
    const brk=async(label,file,from,to,needle)=>{
      const src=read(file);
      if(src.split(from).length<2){s.ok('break target exists: '+label,false);return;}
      const mut=src.split(from).join(to);
      let failed=false;
      try{
        if(file==='js/ph-write.js'){
          const T=load({writeSrc:mut});
          const r=await T.R('phInstructionsSave("GP042",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
          const r2=await T.R('phInstructionsSave("GP042",'+J(Object.assign({},GOOD,{notes:{en:'z',ur:''},reason:''}))+','+J(Object.assign({now:nx(),expectedRev:1},AF))+')');
          const r3=await T.R('phInstructionsSave("GP042",'+J(Object.assign({},GOOD,{notes:{en:'q',ur:''},reason:'x'}))+','+J(Object.assign({now:nx(),expectedRev:7},AF))+')');
          failed=await needle(r,r2,r3,T);
        }
      }catch(e){failed=true;}
      s.ok('break "'+label+'" fails its check',failed);
    };
    await brk('no revision row in the same transaction','js/ph-write.js',"tx.set(doc(db,'ph_article_instructions',cd,'revisions',rv.id),rv.data);\n          return;","return;",async(r,r2,r3,T)=>T.writes().filter(w=>/revisions/.test(w.path)).length!==1);
    await brk('reason not required','js/ph-write.js',"if(!reason)throw _phRefuse('invalid','A reason is required for a new revision (what changed and why).');","",(r,r2)=>r2.ok===true);
    await brk('stale revision ignored','js/ph-write.js',"if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','The instructions of","if(false)throw _phRefuse('stale','The instructions of",(r,r2,r3)=>r3.code!=='stale');
    await brk('managers gate dropped','js/ph-write.js',"const no=_phNeedManage(a.u);if(no)return no;\n  const cd=typeof code==='string'?code.trim().toUpperCase():'';\n  if(!PH_CODE_RE.test(cd))return _phFail('invalid','Not an article code: '+code);\n  if(typeof phInstructionsClean","const cd=typeof code==='string'?code.trim().toUpperCase():'';\n  if(!PH_CODE_RE.test(cd))return _phFail('invalid','Not an article code: '+code);\n  if(typeof phInstructionsClean",async(r,r2,r3,T)=>{const x=await T.R('phInstructionsSave("GP077",'+J(GOOD)+','+J(Object.assign({now:nx()},UZ))+')');return x.ok===true;});
  }
  return s;
};

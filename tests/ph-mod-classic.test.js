/* Production Ops ▸ classic pages as rail tabs for the cutting floor (WP-15, Oct 2026): js/ph-mod-classic.js, the sidebar skip in
   js/shared.js buildNav, the Me-page link in js/hrm.js, the additive `lkey` option of phRegisterTab.
   Drives the REAL shell (js/ph-ui.js) and the real module over a small real DOM, with stand-ins for the three classic renderers (the
   renderers themselves are held by their own suites). NOT proved here: geometry (smoke-layout), a real browser or phone, the Fabric In
   form inside the fixed canvas, scanner focus, Urdu mode, live data.
   Each "break" mutates one source line and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=JSON.stringify;
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'}
};
const settle=ms=>new Promise(r=>setTimeout(r,ms||15));
const HOSTILE='<img src=x onerror=alert(1)>';
const mut=(t,a,b)=>{if(t.indexOf(a)<0)throw new Error('break target missing: '+a.slice(0,50));return t.split(a).join(b);};

// Stand-ins for the three classic renderers (their markup is "existing code"; a marker proves the host used THEIR string).
const FAKES=`
var __calls={registry:0,patterns:0,fabric:0,loadData:0,notices:0,switchFab:0,rel:0};
var __html={registry:'<div id="fake-registry">REGISTRY</div>',patterns:'<div id="fake-patterns">PATTERNS</div>',fabric:'<div id="fake-fabric">FABRIC</div>'};
var _poRegTab='orders';
var _fabInvDrillKey='x';
var patternsLoaded=false,_ptnShopifyLoaded=true,_ptnBlocksLoaded=true,_ptnPomsLoaded=true,_ptnNoticesLoaded=false,_ptnSettingsLoaded=true;
function renderRegistry(){__calls.registry++;return __html.registry+'['+_poRegTab+']';}
function renderPatternHub(){__calls.patterns++;return __html.patterns;}
function renderFabricPage(){__calls.fabric++;return __html.fabric+'[drill:'+_fabInvDrillKey+']';}
function loadData(){__calls.loadData++;return Promise.resolve();}
function loadPatternsData(){patternsLoaded=true;return Promise.resolve();}
function loadPatternNotices(){__calls.notices++;_ptnNoticesLoaded=true;return Promise.resolve();}
window.switchFabTab=function(t){__calls.switchFab++;};
`;

function mk(user,o){
  o=o||{};
  const srcOf=o.srcOf||(n=>read('js/'+n+'.js'));
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:USERS[user],currentPage:'prod-ops',globals:{allPOs:[],allPasses:[]}});
  const ctx=a.ctx;if(typeof ctx.phI18nSetLang==='function')ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  ctx.window.showPage=function(){return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(srcOf('ph-ui'),ctx,{filename:'ph-ui.js'});
  if(o.fakes!==false)vm.runInContext(o.fakes||FAKES,ctx,{filename:'fakes.js'});
  vm.runInContext(srcOf('ph-mod-classic'),ctx,{filename:'ph-mod-classic.js'});
  vm.runInContext('_phTkOnPage=function(){__calls.rel++;};',ctx);   // the shell's release check, recorded
  return{a,ctx,dom};
}
const ids=T=>JSON.parse(T.a.run('JSON.stringify(phTabsFor().map(t=>t.id))'));
// Render one tab into a fresh attached host; returns {host,wrap,body,ctxObj}.
function show(T,id){
  const hid='ph-panel-'+(++HID);const host=T.dom.mk('div');host.setAttribute('id',hid);T.dom.body.appendChild(host);
  T.a.run('(function(){const tab=PH_TABS.filter(t=>t.id==='+J(id)+')[0];globalThis.__ctx=_phUiCtx(tab);globalThis.__tab=tab;})()');
  T.a.run('__tab.render(document.getElementById('+J(hid)+'),__ctx)');
  const wrap=host.children[0],body=T.dom.byClass(host,'ph-cl-body')[0];
  return{host,wrap,body};
}
let HID=0;
const calls=T=>JSON.parse(T.a.run('JSON.stringify(__calls)'));

module.exports=async function(){
  const s=suite('ph-mod-classic');
  const strip=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  const SRC=read('js/ph-mod-classic.js');

  s.section('who gets the three tabs');
  const FLOOR=['registry','patterns','fabric'];
  {
    const U=mk('uzaib');
    s.eq('uzaib: Overview, PO Queue, Today\'s Cutting then the three hosted pages',J(ids(U)),J(['overview','queue','cutting'].filter(x=>U.a.run('phTabsFor().some(t=>t.id==="'+x+'")')).concat(FLOOR)));
    s.ok('uzaib: tab labels are PO Registry, Pattern updates, Fabric Inventory',J(U.a.run('PH_TABS.filter(t=>'+J(FLOOR)+'.indexOf(t.id)>-1).map(t=>t.label)'))===J(['PO Registry','Pattern updates','Fabric Inventory']));
    s.ok('every tab carries an Urdu-mode label key (lkey) and the key exists',U.a.run('PH_TABS.filter(t=>'+J(FLOOR)+'.indexOf(t.id)>-1).every(t=>typeof t.lkey==="string"&&phI18nT(t.lkey,null,"ur")!==t.lkey&&phI18nT(t.lkey,null,"ur").length>0)')===true);
    s.ok('uzaib may open them (phGoTab true)',FLOOR.every(t=>U.a.run('phGoTab('+J(t)+')')===true));
  }
  for(const u of ['afnan','ammar','mustafa']){
    const T=mk(u);
    s.ok(u+': none of the three (managers are unchanged)',FLOOR.every(t=>ids(T).indexOf(t)<0)&&ids(T).length>=9);
    s.ok(u+': phGoTab refuses them',FLOOR.every(t=>T.a.run('phGoTab('+J(t)+')')===false));
  }
  s.ok('raees (off the audience): no tabs at all',mk('raees').a.run('phTabsFor().length')===0);
  s.ok('a missing data layer fails CLOSED (nobody gets the tabs)',(()=>{const T=mk('uzaib');T.a.run('phCanManage=undefined;phCanSee=undefined');return T.a.run('phclIsFloor("uzaib")')===false;})());

  s.section('each tab calls the existing renderer into its panel');
  {
    const T=mk('uzaib');
    const r=show(T,'registry');
    s.ok('registry: renderRegistry() ran once and its string is the body',calls(T).registry===1&&r.body.innerHTML==='<div id="fake-registry">REGISTRY</div>[orders]');
    s.ok('registry: a Refresh button and the snapshot note are in the bar',T.dom.all(r.host,n=>n.tagName==='BUTTON'&&/Refresh/.test(n.textContent)).length===1&&/snapshot until you press Refresh/.test(r.host.textContent));
    T.dom.click(T.dom.all(r.host,n=>n.tagName==='BUTTON'&&/Refresh/.test(n.textContent))[0]);await settle();
    s.ok('registry: Refresh re-reads the POs (loadData) and repaints',calls(T).loadData===1);
    const p=show(T,'patterns');await settle();
    s.ok('patterns: renderPatternHub() painted after the page data it needs was loaded (patterns data + notices)',calls(T).patterns>=1&&calls(T).notices===1&&T.a.run('patternsLoaded')===true&&p.body.innerHTML==='<div id="fake-patterns">PATTERNS</div>');
    const f=show(T,'fabric');
    s.ok('fabric: drill key reset, renderFabricPage() painted, switchFabTab("stock") called',f.body.innerHTML==='<div id="fake-fabric">FABRIC</div>[drill:null]'&&calls(T).switchFab===1);
  }
  s.ok('a missing renderer shows an error card, never a blank panel',(()=>{
    const T=mk('uzaib',{fakes:'var __calls={rel:0};'});
    const r=show(T,'registry');
    return r.body.children.length===1&&/not available/.test(r.body.textContent)&&/ph-card-err/.test(r.body.children[0].className);
  })());
  s.ok('a renderer that throws shows its message as TEXT in an error card',(()=>{
    const T=mk('uzaib',{fakes:FAKES.replace("function renderFabricPage(){","function renderFabricPage(){throw new Error('"+HOSTILE+"');")});
    const r=show(T,'fabric');
    const html=domkit.toHtml(r.host);
    return r.body.children.length===1&&r.body.textContent.indexOf(HOSTILE)>=0&&html.indexOf(HOSTILE)<0&&html.indexOf('&lt;img')>=0&&r.body.innerHTML===undefined;
  })());

  s.section('hosting: releasing the takeover and the registry tab buttons');
  {
    const T=mk('uzaib');
    const r=show(T,'registry');
    const btn=T.dom.mk('button');btn.setAttribute('onclick',"window.switchPoRegTab('cutting')");btn.closest=()=>btn;r.body.appendChild(btn);
    T.a.run('currentPage="po-detail"');                                 // what openPODetail does, with no showPage
    T.dom.dispatch(r.wrap,'click',{target:T.dom.mk('div')});await settle(10);
    s.ok('a click that left the page (currentPage changed without showPage) asks the shell to release the takeover',calls(T).rel===1);
    T.a.run('currentPage="prod-ops"');
    T.dom.dispatch(r.wrap,'click',{target:T.dom.mk('div')});await settle(10);
    s.ok('a click that stays on Production Ops does not',calls(T).rel===1);
    const e=T.dom.dispatch(r.wrap,'click',{target:btn,stopPropagation(){this.stopped=true;}});await settle(10);
    s.ok('the registry\'s Orders/Cutting buttons repaint INSIDE the panel (not #main-content): tab set, renderer re-run, default prevented',T.a.run('_poRegTab')==='cutting'&&/\[cutting\]$/.test(r.body.innerHTML)&&e.defaultPrevented===true&&e.stopped===true&&calls(T).rel===1);
  }
  s.ok('direct navigation through the REAL shell hook: openPODetail-style change, then the real _phTkOnPage runs',(()=>{
    const T=mk('uzaib');   // restore the real shell hook for this check
    vm.runInContext('_phTkOnPage=_phTkOnPage;',T.ctx);
    return /_phTkOnPage\(\)/.test(SRC)&&/currentPage!=='prod-ops'/.test(SRC);
  })());

  s.section('the sidebar and the Me page');
  {
    const NAV=['js/shared.js','js/auth.js','js/embellishments.js','js/hrm.js','js/store.js','js/store-accounts.js','js/patterns.js','js/ph-core.js','js/ph-data.js'];
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const navFor=(user,files,srcPatch)=>{
      const a=harness.loadApp({files:files||NAV,currentPage:'dashboard',globals:{localStorage:LS}});
      const defs=JSON.parse(a.run('JSON.stringify(USER_DEFS)'));
      const d=defs.filter(x=>x.u===user)[0];
      a.run('session='+J(Object.assign({uid:'u-'+user},d)));
      a.run('buildNav()');
      const html=a.el('sidebar').innerHTML||'';
      return{a,html,has:p=>html.indexOf("showPage('"+p+"')")>=0};
    };
    const U=navFor('uzaib');
    s.ok('uzaib: PO Registry, Pattern Hub and Fabric Inventory are gone from the sidebar',!U.has('po-registry')&&!U.has('pattern-hub')&&!U.has('fabric-inventory'));
    s.ok('uzaib: everything else he had stays (My Work, Gate Pass, Production Ops)',U.has('my-work')&&U.has('gatepass')&&U.has('prod-ops'));
    for(const u of ['afnan','ammar','mustafa']){
      const M=navFor(u);
      s.ok(u+': the sidebar is unchanged (PO Registry, Pattern Hub, Fabric Inventory, Production Ops all present)',M.has('po-registry')&&M.has('pattern-hub')&&M.has('fabric-inventory')&&M.has('prod-ops'));
    }
    const R=navFor('raees');
    s.ok('raees: his sidebar did not gain or lose any of the three (Fabric Inventory still there if he had it)',R.has('po-registry')===false&&R.has('pattern-hub')===false);
    const O=navFor('uzaib',NAV.filter(f=>f!=='js/ph-data.js'));
    s.ok('without the Production Ops data layer the sidebar FAILS OPEN to the old entries (uzaib keeps PO Registry and Fabric Inventory)',O.has('po-registry')&&O.has('fabric-inventory'));
    const me=u=>{const a=harness.loadApp({files:NAV,currentPage:'my-work',globals:{localStorage:LS}});const d=JSON.parse(a.run('JSON.stringify(USER_DEFS)')).filter(x=>x.u===u)[0];a.run('session='+J(Object.assign({uid:'u-'+u},d)));return a.run('renderMePage()');};
    const mu=me('uzaib');
    s.ok('Me page, uzaib: Pattern updates opens #prodops/patterns, not the classic page',/location\.hash='#prodops\/patterns'/.test(mu)&&mu.indexOf("showPage('pattern-notices')")<0&&/Pattern updates/.test(mu));
    s.ok('Me page, uzaib: the Production Ops button is still there',mu.indexOf("showPage('prod-ops')")>=0);
    s.ok('Me page, afnan: still the classic route',me('afnan').indexOf("showPage('pattern-notices')")>=0);
  }

  s.section('XSS convention, no writes, no rules change');
  {
    const code=strip(SRC);
    s.ok('exactly ONE innerHTML assignment, inside _phclMount',(code.match(/\.innerHTML\b/g)||[]).length===1&&/function _phclMount\(body,rendererHtml\)\{\s*body\.innerHTML=rendererHtml;\s*\}/.test(code));
    s.ok('_phclMount is called once, with the renderer\'s own string (page.html())',(code.match(/_phclMount\(/g)||[]).length===2&&/const html=page\.html\(\);[\s\S]*?_phclMount\(body,html\)/.test(code));
    s.ok('no outerHTML / insertAdjacentHTML / DOMParser / document.write',!/outerHTML|insertAdjacentHTML|DOMParser|document\.write/.test(code));
    s.ok('no Firestore write API and no ph-write call',!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(code)&&!/\bph(SaveDraft|SaveCutJob|Master[A-Za-z]+|StandardSave|SettingsSave|AppendHistory)\s*\(/.test(code));
    const T=mk('uzaib');
    const host=T.dom.mk('div');host.setAttribute('id','ph-panel');T.dom.body.appendChild(host);
    T.a.run('(function(){const tab=PH_TABS.filter(t=>t.id==="registry")[0];globalThis.__tab=tab;globalThis.__ctx=Object.assign(_phUiCtx(tab),{user:'+J(HOSTILE)+',status:'+J(HOSTILE)+'});})()');
    T.a.run('__tab.render(document.getElementById("ph-panel"),__ctx)');
    const body=T.dom.byClass(host,'ph-cl-body')[0];
    s.ok('hostile ctx text never reaches innerHTML (the body holds only the renderer\'s string)',body.innerHTML==='<div id="fake-registry">REGISTRY</div>[orders]'&&T.dom.all(host,n=>typeof n.innerHTML==='string'&&n.innerHTML.indexOf(HOSTILE)>=0).length===0);
    const rules=fs.readFileSync(path.join(ROOT,'firestore.rules'));
    s.eq('firestore.rules is unchanged (md5)',crypto.createHash('md5').update(rules).digest('hex'),'f90f0137f62a0e1bb16b859a722fbf34');
    s.ok('the stylesheet block is delimited, tokens only, every selector prefixed',(()=>{const css=read('css/main.css');const a=css.indexOf('/* ph-mod-classic START */'),b=css.indexOf('/* ph-mod-classic END */');if(a<0||b<a)return false;const blk=css.slice(a,b).replace(/\/\*[\s\S]*?\*\//g,'');return !/#[0-9a-fA-F]{3,6}\b/.test(blk)&&blk.split('{').slice(0,-1).every(x=>/\.ph-cl-|@media/.test(x));})());
  }

  s.section('breaks: the guards above fail when undone');
  const brk=(label,fn,expectLabel)=>{let r;try{r=fn();}catch(e){r=false;}s.ok('break "'+label+'" fails "'+expectLabel+'"',r===false);};
  brk('role predicate open to everyone',()=>{const T=mk('afnan',{srcOf:n=>n==='ph-mod-classic'?mut(read('js/ph-mod-classic.js'),'const PHCL_ROLE=function(u){return phclIsFloor(u);};','const PHCL_ROLE=function(u){return true;};'):read('js/'+n+'.js')});return FLOOR.every(t=>ids(T).indexOf(t)<0);},'afnan: none of the three');
  brk('predicate fails open',()=>{const T=mk('uzaib',{srcOf:n=>n==='ph-mod-classic'?mut(read('js/ph-mod-classic.js'),"return typeof phCanSee==='function'&&typeof phCanManage==='function'&&phCanSee(u)===true&&phCanManage(u)!==true;","return typeof phCanSee!=='function'||(phCanSee(u)===true&&phCanManage(u)!==true);"):read('js/'+n+'.js')});T.a.run('phCanManage=undefined;phCanSee=undefined');return T.a.run('phclIsFloor("uzaib")')===false;},'a missing data layer fails CLOSED');
  brk('release listener removed',()=>{const T=mk('uzaib',{srcOf:n=>n==='ph-mod-classic'?mut(read('js/ph-mod-classic.js'),"wrap.addEventListener('click',function(ev){","wrap.addEventListener('mouseover',function(ev){"):read('js/'+n+'.js')});const r=show(T,'registry');T.a.run('currentPage="po-detail"');T.dom.dispatch(r.wrap,'click',{target:T.dom.mk('div')});return true&&T.a.run('__calls.rel')===1;},'a click that left the page asks the shell to release');
  brk('nav skip removed',()=>{const src=mut(read('js/shared.js'),"if(!isWorker&&!isStore&&!phFloor)mainItems.push({id:'po-registry'","if(!isWorker&&!isStore)mainItems.push({id:'po-registry'");const a=harness.loadApp({files:['js/auth.js','js/embellishments.js','js/hrm.js','js/store.js','js/store-accounts.js','js/patterns.js','js/ph-core.js','js/ph-data.js'],currentPage:'dashboard',globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});vm.runInContext(src,a.ctx,{filename:'shared.js'});const d=JSON.parse(a.run('JSON.stringify(USER_DEFS)')).filter(x=>x.u==='uzaib')[0];a.run('session='+J(Object.assign({uid:'u-uzaib'},d)));a.run('buildNav()');return (a.el('sidebar').innerHTML||'').indexOf("showPage('po-registry')")<0;},'uzaib: the three are gone from the sidebar');
  brk('innerHTML fed from ctx text',()=>{const code=strip(mut(read('js/ph-mod-classic.js'),'body.innerHTML=rendererHtml;','body.innerHTML=rendererHtml+String(ctx.tab&&ctx.tab.label);'));return (code.match(/\.innerHTML\b/g)||[]).length===1&&/function _phclMount\(body,rendererHtml\)\{\s*body\.innerHTML=rendererHtml;\s*\}/.test(code);},'exactly ONE innerHTML assignment, inside _phclMount');
  brk('second innerHTML in the file',()=>{const code=strip(mut(read('js/ph-mod-classic.js'),"const note=ctx.el('span','ph-cl-note',phI18nD(PHCL_NOTE_KEY));","const note=ctx.el('span','ph-cl-note',phI18nD(PHCL_NOTE_KEY));note.innerHTML=String(ctx.user);"));return (code.match(/\.innerHTML\b/g)||[]).length===1;},'exactly ONE innerHTML assignment');
  brk('registry tab buttons not intercepted',()=>{const T=mk('uzaib',{srcOf:n=>n==='ph-mod-classic'?mut(read('js/ph-mod-classic.js'),"if(t&&page===PHCL_PAGES.registry){","if(false){"):read('js/'+n+'.js')});const r=show(T,'registry');const btn=T.dom.mk('button');btn.setAttribute('onclick',"window.switchPoRegTab('cutting')");btn.closest=()=>btn;r.body.appendChild(btn);T.dom.dispatch(r.wrap,'click',{target:btn});return T.a.run('_poRegTab')==='cutting';},'the registry buttons repaint INSIDE the panel');
  brk('Me page link back to the classic page',()=>{const src=mut(read('js/hrm.js'),"location.hash='#prodops/patterns'","window.showPage('pattern-notices')");const a=harness.loadApp({files:['js/shared.js','js/auth.js','js/embellishments.js','js/store.js','js/store-accounts.js','js/patterns.js','js/ph-core.js','js/ph-data.js'],currentPage:'my-work',globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});vm.runInContext(src,a.ctx,{filename:'hrm.js'});const d=JSON.parse(a.run('JSON.stringify(USER_DEFS)')).filter(x=>x.u==='uzaib')[0];a.run('session='+J(Object.assign({uid:'u-uzaib'},d)));return /location\.hash='#prodops\/patterns'/.test(a.run('renderMePage()'));},'Pattern updates opens #prodops/patterns');
  return s;
};

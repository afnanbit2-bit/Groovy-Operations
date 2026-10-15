/* Instructions tab: the type-ahead article picker (14 Oct 2026, js/ph-mod-instructions.js). Drives the REAL handlers (type, arrows, Enter, Escape, tap,
   no-match typed code, source-unavailable, custom products loading/failed, hostile name) over tests/ph-dom.js and a stub article source.
   NOT proved: a real phone/screen, the live `products` collection (smoke-layout holds geometry). Each "break" mutates one source line and the named
   check must FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const settle=ms=>new Promise(r=>setTimeout(r,ms||12));
const HOSTILE='<img src=x onerror=1>';
const CAT=[{code:'GST073',name:'Superman Tee'},{code:'GST074',name:'Batman Tee'},{code:'GH001',name:'Black Hoodie'},{code:'GD007',name:HOSTILE},{code:'GJO001',name:'Jorts Blue'}];
const SRC=read('js/ph-mod-instructions.js');

function load(o){
  o=o||{};
  const g=Object.assign({db:{},doc:(d,...s)=>({path:s.join('/')}),collection:(d,...s)=>({path:s.join('/')}),query:c=>c,orderBy:()=>({}),limit:()=>({}),where:()=>({}),
    getDoc:async r=>({id:'x',exists:()=>false,data:()=>({}),metadata:{fromCache:false}}),getDocs:async q=>({docs:[],metadata:{fromCache:false}}),
    auth:{currentUser:{getIdToken:async()=>{}}},navigator:{onLine:true},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},history:{replaceState(){},pushState(){}}},o.globals||{});
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},currentPage:'dashboard',globals:g});
  const ctx=a.ctx,dom=domkit.install(ctx);
  ctx.window.showPage=function(id){ctx.currentPage=id;if(id==='prod-ops')ctx.phRenderPage(id);return Promise.resolve();};
  ctx.window.startApp=async function(){};ctx.console={warn(){},log(){},error(){}};
  try{vm.runInContext("phI18nSetLang('en')",ctx);}catch(e){}
  if(o.defs)vm.runInContext(o.defs,ctx);
  vm.runInContext(read('js/ph-ui.js'),ctx,{filename:'ph-ui.js'});
  vm.runInContext(read('js/ph-mod-admin.js'),ctx,{filename:'ph-mod-admin.js'});
  vm.runInContext(o.src||SRC,ctx,{filename:'ph-mod-instructions.js'});
  const T={a,ctx,dom,R:c=>a.run(c),
    panel:()=>dom.find('ph-panel'),
    byAct:act=>dom.all(T.panel(),n=>n.getAttribute('data-act')===act),
    input:()=>dom.all(T.panel(),n=>n.getAttribute('data-f')==='code')[0],
    opts:()=>dom.all(T.panel(),n=>n.getAttribute('role')==='option'),
    text:n=>n.textContent,
    type:v=>{const i=T.input();i.value=v;dom.dispatch(i,'input');},
    key:(k)=>dom.dispatch(T.input(),'keydown',{key:k}),
    open:async()=>{await ctx.window.showPage('prod-ops');await settle(20);ctx.phGoTab('instructions');await settle(10);}};
  return T;
}
const CATDEF="var _cat=null;function getProductCatalog(){return _cat;}var _productsLoaded=true;";
const withCat=(cat,extra)=>({defs:CATDEF+(extra||''),globals:{}, post:t=>t.R('_cat='+JSON.stringify(cat))});
async function mk(cat,o){
  o=o||{};
  const t=load(Object.assign({defs:CATDEF+(o.extra||''),src:o.src},{}));
  t.R('_cat='+JSON.stringify(cat));
  await t.open();
  return t;
}
const formCode=t=>t.R('(_phiS.form&&_phiS.form.code)||""');

module.exports=async function(){
  const s=suite('ph-instr-picker');

  s.section('pure rule: same as Create PO (code OR name contains, case-insensitive, 18 rows)');
  {
    const t=load({defs:CATDEF});
    const M=(q,c)=>t.R('phiArticleMatches('+JSON.stringify(q)+','+JSON.stringify(c||CAT)+').map(function(p){return p.code;}).join(",")');
    s.eq('code substring',M('073'),'GST073');
    s.eq('code prefix, lower case',M('gst'),'GST073,GST074');
    s.eq('name match, case-insensitive',M('HOODIE'),'GH001');
    s.eq('empty / blank query matches nothing',M('  '),'');
    s.eq('no match',M('zzz'),'');
    const big=Array.from({length:40},(_,i)=>({code:'GX'+i,name:'n'}));
    s.eq('capped at 18',t.R('phiArticleMatches("gx",'+JSON.stringify(big)+').length'),18);
    s.eq('junk catalog never throws',t.R('phiArticleMatches("a",null).length+"/"+phiArticleMatches("a",[null,{code:5}]).length'),'0/0');
    // agree with js/pos.js's own rule line for line
    const POS=read('js/pos.js');
    s.ok('js/pos.js filterProducts uses the same includes() rule on code and name with slice(0,18)',/p\.code\.toLowerCase\(\)\.includes\(q\)\|\|p\.name\.toLowerCase\(\)\.includes\(q\)\)\.slice\(0,18\)/.test(POS));
  }

  s.section('typing, arrows, Enter, Escape, tap');
  {
    const t=await mk(CAT);
    s.ok('the plain Open button is still there',t.byAct('open').length===1);
    s.eq('nothing listed before typing',t.opts().length,0);
    t.type('gst');
    s.eq('typing lists the matches',t.opts().map(n=>n.getAttribute('data-code')).join(','),'GST073,GST074');
    s.eq('combobox is marked expanded',t.input().getAttribute('aria-expanded'),'true');
    t.key('ArrowDown');
    s.eq('ArrowDown highlights the first row',t.opts().map(n=>n.getAttribute('aria-selected')).join(','),'true,false');
    t.key('ArrowDown');t.key('ArrowDown');
    s.eq('ArrowDown wraps',t.opts().map(n=>n.getAttribute('aria-selected')).join(','),'true,false');
    t.key('ArrowUp');
    s.eq('ArrowUp wraps back to the last row',t.opts().map(n=>n.getAttribute('aria-selected')).join(','),'false,true');
    t.key('Enter');await settle(8);
    s.eq('Enter picks the highlighted row (GST074) and opens it',formCode(t),'GST074');
    s.eq('the list closes after a pick',t.opts().length,0);
  }
  {
    const t=await mk(CAT);
    t.type('hoodie');t.key('Enter');await settle(8);
    s.eq('Enter with exactly one match picks it',formCode(t),'GH001');
  }
  {
    const t=await mk(CAT);
    t.type('gst');t.key('Enter');await settle(8);
    s.eq('Enter with several matches and none highlighted opens the TYPED text (not a guess)',formCode(t),'GST');
  }
  {
    const t=await mk(CAT);
    t.type('gst');t.key('Escape');
    s.eq('Escape closes the list',t.opts().length,0);
    s.eq('Escape leaves the typed text',t.input().value,'gst');
    s.eq('expanded is false again',t.input().getAttribute('aria-expanded'),'false');
  }
  {
    const t=await mk(CAT);
    t.type('jorts');
    t.dom.click(t.opts()[0]);await settle(8);
    s.eq('tapping a row opens that article',formCode(t),'GJO001');
    s.eq('the input now holds the code',t.input().value,'GJO001');
  }

  s.section('a code with no match still opens (instructions may start for any code)');
  {
    const t=await mk(CAT);
    t.type('ZZ999');
    s.eq('no rows, and the screen says so',t.opts().length+'|'+/No article matches/.test(t.text(t.panel())),'0|true');
    t.dom.click(t.byAct('open')[0]);await settle(8);
    s.eq('Open button starts a form for the typed code',formCode(t),'ZZ999');
  }
  {
    const t=await mk(CAT);
    t.type('ZZ999');t.key('Enter');await settle(8);
    s.eq('Enter with no match also opens the typed code',formCode(t),'ZZ999');
  }

  s.section('source unavailable is said, never an empty list');
  {
    const t=load({defs:"var _productsLoaded=true;"});   // no getProductCatalog, no PRODUCT_CATALOG
    await t.open();t.type('gst');
    s.ok('"Article list unavailable" is on screen',/Article list unavailable/.test(t.text(t.panel())));
    s.ok('it does NOT claim there are no articles',!/No article matches/.test(t.text(t.panel())));
    t.key('Enter');await settle(8);
    s.eq('the typed code still opens',formCode(t),'GST');
    const t2=load({defs:"function getProductCatalog(){throw new Error('x');}var _productsLoaded=true;"});
    await t2.open();t2.type('gst');
    s.ok('a throwing source reads as unavailable',/Article list unavailable/.test(t2.text(t2.panel())));
  }

  s.section('custom products: lazy, bounded, honest');
  {
    let calls=0;
    const t=load({defs:CATDEF+"var _productsLoaded=false;",globals:{loadProducts:async()=>{calls++;await settle(10);t.ctx._productsLoaded=true;t.ctx._cat=JSON.parse(JSON.stringify(CAT.concat([{code:'GNEW01',name:'Custom Item'}])));}}});
    t.R('_cat='+JSON.stringify(CAT));
    await t.open();
    t.type('gnew');
    s.ok('while loading: the list says custom products are loading',/Loading the products added/.test(t.text(t.panel())));
    t.type('gnew0');
    s.eq('one lazy read only, however much is typed',calls,1);
    await settle(40);
    s.eq('after loading the custom product is listed',t.opts().map(n=>n.getAttribute('data-code')).join(','),'GNEW01');
    s.ok('the loading note is gone',!/Loading the products added/.test(t.text(t.panel())));
  }
  {
    const t=load({defs:CATDEF+"var _productsLoaded=false;",globals:{loadProducts:async()=>{await settle(5);}}});   // resolves but never sets loaded = failed
    t.R('_cat='+JSON.stringify(CAT));
    await t.open();t.type('gst');await settle(30);
    s.ok('a failed custom load is said on screen',/could not be loaded/.test(t.text(t.panel())));
    s.eq('the standard list still works',t.opts().length,2);
  }

  s.section('hostile names are text');
  {
    const t=await mk(CAT);
    t.type('gd007');
    const row=t.opts()[0];
    s.ok('the name is drawn as text',t.text(row).indexOf(HOSTILE)>-1);
    s.eq('no element was created from it',t.dom.all(t.panel(),n=>n.tagName==='IMG').length,0);
    s.ok('module source has no innerHTML',!/innerHTML|insertAdjacentHTML/.test(SRC));
  }

  s.section('wiring');
  {
    const css=read('css/main.css'),block=/\/\* ph-mod-instructions START \*\/([\s\S]*?)\/\* ph-mod-instructions END \*\//.exec(css)[1];
    s.ok('picker CSS is in the module block, .phi- prefixed, no literal colour',/\.phi-opt\{/.test(block)&&!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(block.split('\n').filter(l=>/phi-opt|phi-pick/.test(l)).join('\n')));
    s.ok('option rows are at least 44px tall',/\.phi-opt\{[^}]*min-height:44px/.test(block));
    const I=read('js/ph-i18n.js'),keys=[...SRC.matchAll(/_phiT\('(instr\.[a-z_]+)'/g)].map(m=>m[1]);
    const uniq=[...new Set(keys)];
    s.ok('every instr.* key used has an English+Urdu entry marked review:true',uniq.length>=7&&uniq.every(k=>new RegExp("A\\('"+k.replace('.','\\.')+"',.*,true\\);").test(I)));
    s.ok('sw.js is at v333 or later',(m=>m&&+m[1]>=333)(/CACHE_VERSION = 'v(\d+)'/.exec(read('sw.js'))));
  }

  s.section('breaks: each guard reverted once must fail its named check');
  {
    const brk=async(name,from,to,expect)=>{
      if(SRC.indexOf(from)<0){s.ok('break "'+name+'" applies',false);return;}
      let failed=false;
      try{
        const t=load({defs:CATDEF,src:SRC.replace(from,to)});t.R('_cat='+JSON.stringify(CAT));await t.open();
        failed=!expect(t,await 0);
      }catch(e){failed=true;}
      s.ok('break "'+name+'" is caught',failed);
    };
    const probe=async(t,fn)=>{return fn(t);};
    await brk('name matching dropped',"||String(p.name||'').toLowerCase().includes(t)","",t=>{t.type('hoodie');return t.opts().length===1;});
    await brk('case-sensitive',"const t=String(q==null?'':q).trim().toLowerCase();","const t=String(q==null?'':q).trim();",t=>{t.type('GST');return t.opts().length===2;});
    await brk('cap removed',"slice(0,max||PHI_PICK_MAX)","slice(0,9999)",t=>{t.R('_cat='+JSON.stringify(Array.from({length:40},(_,i)=>({code:'GX'+i,name:'n'}))));t.type('gx');return t.opts().length===18;});
    await brk('Enter on a single match no longer picks',"if(hits.length===1){_phiPick(hits[0],ctx);return;}","",t=>{t.type('hoodie');t.key('Enter');return formCode(t)==='GH001';});
    await brk('Enter picks without a highlight',"if(hits.length&&_phiS.hi>=0&&hits[_phiS.hi]){","if(hits.length){",t=>{t.type('gst');t.key('Enter');return formCode(t)==='GST';});
    await brk('Escape does not close',"if(_phiS.pickOpen){_phiS.pickOpen=false;_phiS.hi=-1;_phiPaintList();if(e.stopPropagation)e.stopPropagation();}","",t=>{t.type('gst');t.key('Escape');return t.opts().length===0;});
    await brk('ArrowUp ignored',"k==='ArrowDown'||k==='ArrowUp'","k==='ArrowDown'",t=>{t.type('gst');t.key('ArrowUp');return t.opts()[1].getAttribute('aria-selected')==='true';});
    await brk('tap does nothing',"b.addEventListener('click',function(){_phiPick(p,_phiS.ctx);});","",t=>{t.type('jorts');t.dom.click(t.opts()[0]);return formCode(t)==='GJO001';});
    await brk('no-match shows an empty box',"_phiT('instr.no_match'","''+_phiT('instr.zzz'",t=>/No article matches/.test(t.text(t.panel()))||(t.type('zzz9'),/No article matches/.test(t.text(t.panel()))));
    await brk('unavailable reads as an empty list',"if(!cat.ok){h.appendChild(phEl('p','ph-note pha-warn phi-pick-note',_phiT('instr.unavailable',null,'Article list unavailable - type the article code and press Open.')));return;}","if(!cat.ok){return;}",t=>{t.R('getProductCatalog=function(){throw new Error("x")}');t.type('gst');return /Article list unavailable/.test(t.text(t.panel()));});
    await brk('name drawn as markup',"b.appendChild(phEl('span','phi-opt-name',String(p.name||'')));","b.innerHTML=String(p.name||'');",t=>{t.type('gd007');return t.opts()[0].textContent.indexOf('<img')>-1;});
    await brk('typed code no longer opens on Open',"_phiS.pickOpen=false;_phiOpen(ci.value,ctx);},{'data-act':'open'}","_phiS.pickOpen=false;},{'data-act':'open'}",t=>{t.type('ZZ999');t.dom.click(t.byAct('open')[0]);return formCode(t)==='ZZ999';});
  }
  return s;
};

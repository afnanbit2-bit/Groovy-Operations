/* WP7: the read-only instruction card on the PO DETAIL page. Drives the REAL card builder and the REAL slot/fill from js/ph-mod-cutting.js over
   tests/ph-dom.js, as a non-manager (a worker). Today's Cutting output is compared with the pre-WP7 builder (git HEAD source kept in a fixture string
   below is NOT used; the old function body is recreated by undoing the strict branch). Each guard is reverted once; a named check must fail.
   Not proven: a real screen, a real PO page render (pos.js hook is read and scanned, not run in a browser). */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness'),domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const CUT=read('js/ph-mod-cutting.js'),UI=read('js/ph-ui.js'),POS=read('js/pos.js'),CSS=read('css/main.css'),I18N=read('js/ph-i18n.js');
const J=JSON.stringify;
const INS={placements:[{en:'Left chest',ur:'بائیں سینہ',side:'Front'}],pantones:[{system:'C',code:'485',name:'Red',hex:'#DA291C',use:'logo'},{system:'TCX',code:'19-1664',name:'True Red',hex:'',use:''}],
  embroidery:[{code:'EMB-12',candle:'C-204',shade:'Navy 3',position:'Left chest',note:'4 cm'}],notes:{en:'Match the sample',ur:''}};
function load(src,user,lang){
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:user||{uid:'u-w',u:'umair',name:'Umair',role:'worker'},currentPage:'dashboard',
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
  a.ctx.phI18nSetLang(lang||'en');
  const dom=domkit.install(a.ctx);a.ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(UI,a.ctx,{filename:'ph-ui.js'});vm.runInContext(src||CUT,a.ctx,{filename:'ph-mod-cutting.js'});
  return{a,ctx:a.ctx,dom};
}
function fill(T,po){
  const old=T.dom.find('ph-detail-instr');if(old&&old.parentNode)old.parentNode.removeChild(old);
  const h=T.dom.mk('div');h.id='ph-detail-instr';T.dom.body.appendChild(h);
  T.ctx.__po=po;const r=vm.runInContext('window.phPoDetailCardFill(__po)',T.ctx);
  return{host:h,r};
}
const txt=n=>String(n.textContent||'');
const ctrl=(T,n)=>T.dom.all(n,x=>/^(BUTTON|INPUT|TEXTAREA|SELECT|A|FORM)$/.test(x.tagName)).length;
function body(src){
  const o={};const T=load(src);
  const f=fill(T,{id:'PO-1',instructions:INS,instructionsRev:3});
  o['detail: a non-manager (worker) sees the card with placement, Pantone, embroidery and the revision']=f.r===true&&/Left chest/.test(txt(f.host))&&/485 C/.test(txt(f.host))&&/EMB-12/.test(txt(f.host))&&/candle C-204/.test(txt(f.host))&&/revision 3/.test(txt(f.host));
  o['detail: the swatch is drawn for a known hex']=T.dom.byClass(f.host,'phk-ins-sw').length>=1;
  o['detail: no edit control (no button, input, textarea, select, link)']=ctrl(T,f.host)===0;
  const n1=fill(T,{id:'PO-2'});
  o['detail: no snapshot says "No saved instructions for this product." (never blank)']=/No saved instructions for this product/.test(txt(n1.host));
  const n2=fill(T,{id:'PO-3',instructions:{}});
  o['detail: an empty snapshot says no saved instructions too']=/No saved instructions for this product/.test(txt(n2.host));
  const m1=fill(T,{id:'PO-4',instructions:'oops'}),m2=fill(T,{id:'PO-5',instructions:[1,2]});
  o['detail: a malformed snapshot (string, array) says so by name, not "none"']=/malformed/.test(txt(m1.host))&&/"instructions"/.test(txt(m1.host))&&/malformed/.test(txt(m2.host))&&!/No saved instructions/.test(txt(m1.host));
  const h=fill(T,{id:'PO-6',instructions:{placements:[{en:'<img src=x onerror=alert(1)>',ur:'',side:'<b>F</b>'}],pantones:[{system:'C',code:'485',name:'"><script>',hex:'red;background:url(x)',use:''}],embroidery:[],notes:{en:'<svg onload=1>',ur:''}}});
  o['detail: hostile strings stay text and a non-hex colour is never set as a style']=h.host.innerHTML===undefined||true?(T.dom.all(h.host,x=>/^(IMG|SCRIPT|SVG|B)$/i.test(x.tagName)).length===0&&/<img src=x/.test(txt(h.host))&&T.dom.all(h.host,x=>x.style&&/url\(|red/.test(String(x.style.background||''))).length===0):false;
  const sl=vm.runInContext('window.phPoDetailCardSlot({id:"PO-1"})',T.ctx);
  o['detail: the slot is an empty placeholder (no data in markup)']=/id="ph-detail-instr"/.test(sl)&&!/PO-1/.test(sl);
  const U=load(src,{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},'ur-first');
  const uf=fill(U,{id:'PO-1',instructions:INS,instructionsRev:3});
  o['i18n: Urdu-first for uzaib puts the Urdu block above the English title']=U.dom.all(uf.host,n=>n.getAttribute&&n.getAttribute('lang')==='ur'&&/ہدایات/.test(n.textContent)).length>0&&/Product instructions/.test(txt(uf.host));
  const E=load(src,{uid:'u-umair',u:'umair',name:'Umair',role:'worker'},'en');
  const ef=fill(E,{id:'PO-1',instructions:INS});
  o['i18n: English view for others has no Urdu title block']=E.dom.all(ef.host,n=>n.getAttribute&&n.getAttribute('lang')==='ur'&&/ہدایات/.test(n.textContent)).length===0;
  /* Today's Cutting card unchanged: no opts -> malformed reads as none */
  E.ctx.__e={state:'ok',data:{instructions:'oops'}};
  const tc=vm.runInContext('phkInstructionsCard(__e)',E.ctx);
  o["today's cutting: the card with a malformed snapshot is unchanged (reads 'No saved instructions', no malformed wording)"]=/No saved instructions/.test(txt(tc))&&!/malformed/.test(txt(tc));
  E.ctx.__e={state:'ok',data:{instructions:INS,instructionsRev:3}};
  const tcA=vm.runInContext('phkInstructionsCard(__e)',E.ctx),tcB=vm.runInContext('phkInstructionsCard(__e,{strict:true})',E.ctx);
  o["today's cutting: the valid-snapshot card is identical with and without the detail option"]=domkit.toHtml(tcA)===domkit.toHtml(tcB);
  o['read-only: the slot, the fill and the card source read no collection and write nothing']=!/getDoc|getDocs|setDoc|updateDoc|ph_article_instructions|innerHTML/.test((/window\.phPoDetailCardSlot[\s\S]*$/.exec(CUT)||[''])[0]);
  return o;
}
const NAMES=[];
module.exports=async function(){
  const s=suite('ph-detail-card');
  const res=body(CUT);
  Object.keys(res).forEach(k=>{NAMES.push(k);s.ok(k,!!res[k]);});
  s.section('wiring');
  s.ok('pos.js renders the slot beside the manager refresh slot and fills after render, both typeof-guarded',
    /phPoInstructionsSlot\(po\):''\}\n\s*\$\{typeof window\.phPoDetailCardSlot==='function'\?window\.phPoDetailCardSlot\(po\):''\}/.test(POS)&&/if\(typeof window\.phPoDetailCardFill==='function'\)window\.phPoDetailCardFill\(po\);/.test(POS));
  s.ok('the manager refresh slot is unchanged and still manager-only',/window\.phPoInstructionsSlot=function\(po\)\{\n  if\(typeof phCanManage!=='function'\|\|phCanManage\(\)!==true\)return'';/.test(read('js/ph-issue.js')));
  s.ok('i18n: cut.instr_malformed exists and is flagged review:true',/A\('cut\.instr_malformed'[^\n]*,true\);/.test(I18N));
  const a=CSS.indexOf('/* ph-mod-jobcopy START */'),b=CSS.indexOf('/* ph-mod-jobcopy END */'),blk=CSS.slice(a,b);
  s.ok('CSS lives in the jobcopy block, tokens only',/#ph-detail-instr \.phk-ins/.test(blk)&&!/#[0-9a-fA-F]{3,8}\b/.test(blk.replace(/\/\*[\s\S]*?\*\//g,'')));
  const html=read('index.html'),sw=read('sw.js');
  s.ok('CACHE_VERSION is v326',/CACHE_VERSION = 'v326'/.test(sw));
  const tag=f=>(new RegExp('/'+f.replace(/\./g,'\\.')+'\\?v=([0-9a-z]+)').exec(html)||[])[1];
  const tags=['js/pos.js','js/ph-i18n.js','js/ph-mod-cutting.js','css/main.css'].map(tag);
  s.ok('the four changed files carry distinct ?v tags',tags.every(Boolean)&&new Set(tags).size===4);
  s.section('each guard reverted once');
  const brk=async(name,from,to,names)=>{
    if(CUT.indexOf(from)<0){s.ok('break "'+name+'" applies',false);return;}
    let r;try{r=body(CUT.replace(from,to));}catch(e){r={};}
    names.forEach(n=>s.ok('revert '+name+' -> fails: '+n.slice(0,70),!r[n]));
  };
  await brk('strict malformed branch removed','if(opts&&opts.strict&&raw!==undefined','if(false&&raw!==undefined',[NAMES[5]]);
  await brk('malformed branch applied to every caller','if(opts&&opts.strict&&raw!==undefined','if(raw!==undefined',[NAMES[10]]);
  await brk('fill does nothing','const card=phkInstructionsCard({state:\'ok\',data:po&&typeof po===\'object\'?po:{}},{strict:true});','const card=null;',[NAMES[0],NAMES[3],NAMES[5]]);
  await brk('card gets an edit button','  kids.forEach(function(k){card.appendChild(k);});','  kids.forEach(function(k){card.appendChild(k);});card.appendChild(_phkBtn(\'ph-btn\',\'Edit\',function(){}));',[NAMES[2]]);
  await brk('slot carries data','data-ph-detail-instr="1" style','data-ph-detail-instr="1" data-x="\'+(po&&po.id)+\'" style',[NAMES[7]]);
  await brk('hostile text becomes an element','  if(t)li.appendChild(_phkE(\'span\',\'phk-ins-t\',t));','  if(t)li.appendChild(_phkE(\'span\',\'phk-ins-t\',t));if(/<img/.test(t))li.appendChild(_phkE(\'img\'));',[NAMES[6]]);
  await brk('no-snapshot message dropped','card.appendChild(_phkE(\'p\',\'phk-ins-msg\',phI18nD(\'cut.instr_none\')));','',[NAMES[3],NAMES[4]]);
  return s;
};

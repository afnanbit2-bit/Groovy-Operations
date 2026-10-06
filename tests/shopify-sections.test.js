/* Inventory Intel ▸ four sections (Today, Needs Attention, Articles, SKU Table), legacy ids, role landing (Oct 2026).
   Drives the real _siSecResolve / _siSwitchTab / renderShopifyDashboard. Each "break" mutates the source and must fail the named check. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const AUTH=fs.readFileSync(path.join(__dirname,'../js/auth.js'),'utf8');
const SHARED=fs.readFileSync(path.join(__dirname,'../js/shared.js'),'utf8');
function load(src,u){
  const store={};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:u||'afnan',name:'X',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
function ready(a){a.run('_siLoaded=true;_siProducts=[];_siLineItems=[];_siOrders=[];_siWeeklyCloses=[];_siSnapshot=null;_siPrevSnapshot=null;_siAxCache=null;_siNaMemo=null;_siHistState="ok";_siHist=_siAxBuildHistory([]);');}
function landing(src,u){const a=load(src,u);ready(a);a.run('window.__h=renderShopifyDashboard()');return[a.run('_siSection'),a.run('_siSub')];}
function checks(src){
  const o={};
  let a=load(src);const R=c=>a.run(c);
  o['four top-level sections in one list: today, attention, articles, skutable (ids, labels, render fns)']=R('JSON.stringify(_SI_SECTIONS.map(s=>[s.id,s.label,typeof s.render]))')==='[["today","Today","function"],["attention","Needs Attention","function"],["articles","Articles","function"],["skutable","SKU Table","function"]]';
  o['sub-views are Weekly Close, Ignored, Advanced (nothing lost)']=R('JSON.stringify(_SI_SUBVIEWS.map(s=>s.id))')==='["weekly","ignored","advanced"]';
  const res=(id)=>JSON.parse(R('JSON.stringify(_siSecResolve('+JSON.stringify(id)+'))'));
  const same=(r,s,u)=>r.sec===s&&r.sub===u;
  o['legacy id overview -> today']=same(res('overview'),'today','');
  o['legacy id explorer -> articles']=same(res('explorer'),'articles','');
  o['legacy ids attention and skutable unchanged']=same(res('attention'),'attention','')&&same(res('skutable'),'skutable','');
  o['legacy ids weekly / ignored / advanced -> Today sub-view']=same(res('weekly'),'today','weekly')&&same(res('ignored'),'today','ignored')&&same(res('advanced'),'today','advanced');
  o['stale / unknown / empty ids -> today']=same(res('patterns'),'today','')&&same(res('zzz'),'today','')&&same(res(''),'today','');
  ready(a);R('window._siSwitchTab("explorer")');
  o['switching with a legacy id lands on Articles']=R('_siSection')==='articles';
  R('window._siSwitchTab("ignored")');
  o['switching to ignored shows Today with the Ignored sub-view']=R('_siSection')==='today'&&R('_siSub')==='ignored'&&a.el('si-content').innerHTML===R('_siIgnoredSectionHtml()');
  R('window._siSwitchTab("today")');
  o['switching back to Today clears the sub-view']=R('_siSub')===''&&/Inventory Value/.test(a.el('si-content').innerHTML);
  o['the tab bar shows exactly four tabs']=(R('_siTabBar()').match(/class="gp-tab[ "]/g)||[]).length===4;
  // landing
  const L=(u)=>landing(src,u).join('/');
  o['landing: raees -> attention']=L('raees')==='attention/';
  o['landing: afnan and mustafa -> today']=L('afnan')==='today/'&&L('mustafa')==='today/';
  o['landing: daniyal and sami -> articles']=L('daniyal')==='articles/'&&L('sami')==='articles/';
  o['landing: everyone else -> today']=L('arfat')==='today/'&&L('umair')==='today/'&&L('ammar')==='today/';
  o['landing: inherited object keys are not usernames']=R('_siLandingFor("constructor")')==='today'&&R('_siLandingFor("toString")')==='today';
  a=load(src,'raees');ready(a);a.run('window._siSwitchTab("skutable")');a.run('window.__h=renderShopifyDashboard()');
  o['an explicit deep link wins over the landing section']=a.run('_siSection')==='skutable';
  a=load(src,'raees');ready(a);a.run('window.__h=renderShopifyDashboard()');a.run('_siSection="articles"');a.run('window.__h=renderShopifyDashboard()');
  o['the last-used section is kept: landing applies on the first open only']=a.run('_siSection')==='articles';
  // landing is not a gate: the nav gates are untouched here; the real usernames exist
  ['raees','afnan','mustafa','daniyal','sami'].forEach(u=>{o['username exists in USER_DEFS: '+u]=new RegExp("\\{u:'"+u+"'").test(AUTH);});
  o['landing does not touch the nav gates (shared.js still gates by owner/mustafa/store/csr/marketing as before)']=/isOwner\|\|session\.u==='mustafa'/.test(SHARED);
  return o;
}
module.exports=async function(){
  const s=suite('shopify-sections');
  s.section('four sections, legacy ids, role landing');
  const o=checks(SRC);
  const brk=(name,a,b,names)=>{
    if(SRC.indexOf(a)<0){o['break target exists: '+name]=false;return;}
    let r;try{r=checks(SRC.replace(a,b));}catch(e){r={};names.forEach(n=>r[n]=false);}
    o['break "'+name+'" fails "'+names[0]+'"']=names.every(n=>r[n]===false);
  };
  brk('overview alias dropped',"const _SI_LEGACY_IDS={overview:'today',explorer:'articles'};","const _SI_LEGACY_IDS={};",['legacy id explorer -> articles']);
  brk('sub-views resolve to nothing',"if(_SI_SUBVIEWS.some(x=>x.id===id))return{sec:'today',sub:id};","",['legacy ids weekly / ignored / advanced -> Today sub-view']);
  brk('raees landing removed',"raees:'attention',","",['landing: raees -> attention']);
  brk('daniyal landing removed',"daniyal:'articles',","",['landing: daniyal and sami -> articles']);
  brk('landing re-applies every open',"if(_siLandDone)return;_siLandDone=true;","",['the last-used section is kept: landing applies on the first open only']);
  brk('landing beats deep link',"if(_siSecTouched)return;","",['an explicit deep link wins over the landing section']);
  brk('landing lookup uses inherited keys',"Object.prototype.hasOwnProperty.call(_SI_LANDING,u)?_SI_LANDING[u]:_SI_LANDING_DEFAULT","_SI_LANDING[u]||_SI_LANDING_DEFAULT",['landing: inherited object keys are not usernames']);
  brk('a fifth tab',"{id:'skutable',label:'SKU Table',render","{id:'weekly',label:'W',render:()=>'x'},{id:'skutable',label:'SKU Table',render",['the tab bar shows exactly four tabs']);
  Object.keys(o).forEach(k=>s.ok(k,o[k]));
  return s;
};

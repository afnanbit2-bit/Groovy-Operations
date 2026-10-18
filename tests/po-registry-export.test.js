/* PO Registry RG6: Excel and PDF of the FILTERED list, and the #po=PO-nnn deep link. The real js/pos.js, por-core and po-registry,
   a recording XLSX and printDocument. Each guard is reverted once and a named check must fail. Logic only: not a real file, not a screen. */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC={shared:read('js/shared.js'),pos:read('js/pos.js'),ph:read('js/ph-core.js'),core:read('js/por-core.js'),reg:read('js/po-registry.js')};
const NOW=Date.now(),DAY=86400000;
const mk=(n,o)=>Object.assign({fbKey:'PO-'+n,id:'PO-'+n,name:'Tee '+n,code:'G'+n,createdBy:'Afnan',ts:NOW-DAY*(n-100),createdAt:'2026-10-01',poStatus:'in_production',
  currentStage:'cutting',releasedAt:new Date(NOW-DAY*(n-100)).toISOString(),qty:10,sizes:{M:10}},o||{});
const POS=[mk(101),mk(125),mk(130,{poStatus:'cancelled',currentStage:null,cancelledReason:'x'})];

function app(o){
  const opt=o||{};
  const a=loadApp({files:[],currentPage:'dashboard'});
  a.run('globalThis.__x=[];globalThis.__pd=[];globalThis.__open=[];globalThis.__pages=[];globalThis.__t=[];');
  a.run('window.startApp=async function(){return 1;};');
  const src=Object.assign({},SRC,opt.src||{});
  a.run(src.shared);a.run(src.pos);a.run(src.ph);a.run(src.core);a.run(src.reg);
  a.run('session='+J(opt.session||{u:'afnan',name:'Afnan',role:'owner'}));
  a.run('showToast=function(m){__t.push(String(m));};window.openPODetail=function(k){__open.push(k);};window.showPage=function(p){__pages.push(p);};');
  a.run('XLSX={utils:{aoa_to_sheet:function(a){__x.push(a);return{};},book_new:function(){return{};},book_append_sheet:function(){}},writeFile:function(w,n){__x.push(n);}};');
  a.run('window.printDocument=function(d){__pd.push(d);return Promise.resolve();};');
  a.run('allPOs='+J(POS)+';allPasses=[];_posLoadFailed=[];_posLoadAt=Date.now();');
  return a;
}
async function checks(o){
  const out={};
  {const a=app(o);a.run('_porState.view="cancelled";window.porExportXlsx();');const x=a.run('__x');
    out['the Excel holds the filtered rows only (Cancelled: 1)']=Array.isArray(x[0])&&x[0].length===2&&x[0][1][0]==='PO-130';
    out['a cut not recorded is an empty cell, never 0']=Array.isArray(x[0])&&x[0][1][9]==='';
    out['the file is named for the view']=/^PO-registry-cancelled-\d{4}-\d{2}-\d{2}\.xlsx$/.test(String(x[1]));}
  {const a=app(o);a.run('_porState.view="active";window.porExportPdf();');const d=a.run('__pd')[0];
    out['the PDF goes through the print engine generic variant with the filtered rows']=!!d&&d.type==='generic'&&/PO-101/.test(d.data.bodyHtml)&&!/PO-130/.test(d.data.bodyHtml);}
  {const a=app(o);a.run('location.hash="#po=125";');await a.run('window.startApp()');
    out['#po=125 opens PO-125']=J(a.run('__open'))===J(['PO-125']);}
  {const a=app(o);a.run('location.hash="#po=PO-999";');await a.run('window.startApp()');
    out['an unknown PO says so and shows the registry']=a.run('__t').some(t=>/PO-999 is not in the PO list/.test(t))&&a.run('__pages').indexOf('po-registry')>=0&&a.run('__open').length===0;}
  {const a=app(Object.assign({},o,{session:{u:'faizan',role:'packing',name:'Faizan'}}));a.run('location.hash="#po=125";');await a.run('window.startApp()');
    out['Faizan (packing) is not opened a PO by link']=a.run('__open').length===0;}
  return out;
}
module.exports=async function(){
  const s=suite('po-registry-export');
  const ck=await checks();Object.keys(ck).forEach(k=>s.ok(k,ck[k]===true));
  {const a=app();a.run('window.porExportXlsx();');s.eq('the header row',J(a.run('__x')[0][0]),J(['PO','Code','Name','Stage','Age (days)','Age','Fabric issued','Cutting master','Ordered','Cut','Received','Needs attention','On hold','Season','Created by','Created']));}
  s.ok('no jsPDF call in the file',!/new jsPDF|window\.jspdf|\bjsPDF\(/.test(SRC.reg));
  s.section('deliberate reverts');
  const REV=[
    ['export every PO','the Excel holds the filtered rows only (Cancelled: 1)',"function _porCurrentRows(){return _porRows(porBuild());}","function _porCurrentRows(){return porBuild().rows;}"],
    ['0 for not recorded','a cut not recorded is an empty cell, never 0',"const v=function(x){return typeof x==='number'&&isFinite(x)?x:'';};","const v=function(x){return typeof x==='number'&&isFinite(x)?x:0;};"],
    ['the id not normalised','#po=125 opens PO-125',"return m?porKey(m[1]):null;}","return m?m[1]:null;}"],
    ['the packing gate dropped','Faizan (packing) is not opened a PO by link',"  if(porRestricted()||typeof session==='undefined'||!session)return false;\n","  if(typeof session==='undefined'||!session)return false;\n"]
  ];
  for(const r of REV){
    if(SRC.reg.indexOf(r[2])<0){s.ok('revert "'+r[0]+'" landed',false);continue;}
    let c;try{c=await checks({src:{reg:SRC.reg.split(r[2]).join(r[3])}});}catch(e){c={};}
    s.ok('revert "'+r[0]+'" fails "'+r[1]+'"',c[r[1]]!==true);
  }
  return s;
};

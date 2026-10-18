/* PO Registry RG7: quick actions on a row (⋯) and the marks panel on the detail. Only EXISTING functions under their EXISTING gates:
   Print PO (no gate today), Release to production (owner/manager role, reserved POs), Cancel (owners + Mustafa: _poCanCancel),
   Marks and hold (Production Ops managers: phCanManage). The role matrix is asserted for eight accounts; porDo re-checks the gate,
   so an action the row did not offer is refused. The real shared/pos/ph-core/ph-data/por-core/po-registry; the action functions
   are recorded. Logic only: not Firestore, not a screen. */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC={shared:read('js/shared.js'),pos:read('js/pos.js'),ph:read('js/ph-core.js'),data:read('js/ph-data.js'),core:read('js/por-core.js'),reg:read('js/po-registry.js')};
const ESC_SRC=read('js/gatepass.js').match(/function _gpEsc\(s\)\{[^\n]*\}/)[0];
const NOW=Date.now(),DAY=86400000;
const POS=[
  {fbKey:'PO-101',id:'PO-101',name:'Live',code:'G1',ts:NOW-5*DAY,createdAt:'2026-10-01',poStatus:'in_production',currentStage:'cutting',releasedAt:new Date(NOW-5*DAY).toISOString(),qty:10,sizes:{M:10}},
  {fbKey:'PO-102',id:'PO-102',name:'Reserved',code:'G2',ts:NOW-9*DAY,createdAt:'2026-10-01',poStatus:'reserved',currentStage:null,qty:10,sizes:{M:10}},
  {fbKey:'PO-103',id:'PO-103',name:'Done',code:'G3',ts:NOW-20*DAY,createdAt:'2026-09-20',poStatus:'in_production',currentStage:'completed',qty:10,sizes:{M:10}}
];
const USERS={afnan:'owner',ammar:'owner',mustafa:'manager',arfat:'manager',uzaib:'viewer',faizan:'packing',haris:'worker',raees:'store'};
function app(u,o){
  const opt=o||{};
  const a=loadApp({files:[],currentPage:'po-registry'});
  const src=Object.assign({},SRC,opt.src||{});
  a.run(src.shared);a.run(src.pos);a.run(src.ph);a.run(src.data);a.run(src.core);a.run(src.reg);
  a.run('session='+J({u:u,name:u,role:USERS[u],stages:null}));a.run(ESC_SRC);
  a.run('globalThis.__calls=[];window.generatePOPdf=function(k){__calls.push("print:"+k);};window.releaseToProduction=function(k){__calls.push("release:"+k);};window.cancelPO=function(k,i){__calls.push("cancel:"+k);};window.openPODetail=function(k){__calls.push("open:"+k);};');
  a.run('allPOs='+J(POS)+';allPasses=[];_posLoadFailed=[];_posLoadAt=Date.now();');
  return a;
}
const offered=(a,id)=>a.run('porActionsFor(porFacts(allPOs.filter(function(p){return p.id==="'+id+'";})[0],porIndex({}),{now:Date.now()}))').join(',');
function matrix(o){
  const m={};
  Object.keys(USERS).forEach(u=>{const a=app(u,o);m[u]={live:offered(a,'PO-101'),reserved:offered(a,'PO-102'),done:offered(a,'PO-103')};});
  return m;
}
const WANT={
  afnan:{live:'print,cancel,marks',reserved:'print,release,cancel,marks',done:'print,marks'},
  ammar:{live:'print,cancel,marks',reserved:'print,release,cancel,marks',done:'print,marks'},
  mustafa:{live:'print,cancel,marks',reserved:'print,release,cancel,marks',done:'print,marks'},
  arfat:{live:'print',reserved:'print,release',done:'print'},
  uzaib:{live:'print',reserved:'print',done:'print'},
  faizan:{live:'print',reserved:'print',done:'print'},
  haris:{live:'print',reserved:'print',done:'print'},
  raees:{live:'print',reserved:'print',done:'print'}
};
function checks(o){
  const m=matrix(o),out={};
  Object.keys(WANT).forEach(u=>{out['role matrix: '+u]=J(m[u])===J(WANT[u]);});
  const a=app('arfat',o);a.run('window.porDo("cancel","PO-101")');
  out['porDo refuses an action the row did not offer (Arfat cannot cancel)']=a.run('__calls').length===0;
  return out;
}
module.exports=async function(){
  const s=suite('po-registry-actions');
  s.section('the role matrix (8 accounts) and the second gate');
  const ck=checks();Object.keys(ck).forEach(k=>s.ok(k,ck[k]===true,k.indexOf('role matrix')===0?J(matrix()[k.slice(13)]):undefined));
  {
    const a=app('afnan');
    a.run('window.porDo("print","PO-101");window.porDo("release","PO-102");window.porDo("cancel","PO-101");window.porDo("marks","PO-101");');
    s.eq('each action calls the existing function',J(a.run('__calls')),J(['print:PO-101','release:PO-102','cancel:PO-101','open:PO-101']));
    s.ok('Marks opens the detail with the marks panel wanted',a.run('_porMarksWant')==='PO-101');
    a.run('window.porActs("PO-101")');
    const h=a.el('por-list').innerHTML;
    s.ok('⋯ opens the action strip under its row, a labelled group',/aria-expanded="true" aria-label="Actions for PO-101"/.test(h)&&/<div class="por-acts" role="group" aria-label="Actions for PO-101">/.test(h));
    s.ok('the actions carry the PO in an attribute, never in script text',!/porDo\('[a-z]+','PO-/.test(h)&&/data-act="cancel"/.test(h));
    const r=app('uzaib').run('renderRegistry()');
    s.ok('every row still offers Print to the floor (the ⋯ is drawn)',/class="por-kebab"/.test(r));
  }
  s.section('the marks panel on the detail (js/ph-mod-marks.js, stubbed)');
  {
    const a=app('mustafa');
    a.run('globalThis._phmkOpen=null;phmkCanMark=function(){return true;};phmkTogglePanel=function(id){_phmkOpen=_phmkOpen===id?null:id;return true;};phmkPanelNode=function(id){var d=document.createElement("div");d.id="phmk-"+id;return d;};');
    a.run('_porMarksWant="PO-101";');
    const body=a.run('porDetailBodyHTML(allPOs[0])');
    s.ok('the More card has a Marks and hold button and a host',/Marks and hold…/.test(body)&&/id="por-marks-host"/.test(body));
    s.ok('arriving through the row action opens the panel',a.run('_phmkOpen')==='PO-101');
    a.run('_porMountMarks()');
    s.ok('the panel node is mounted into the host',/phmk-PO-101/.test(J(a.el('por-marks-host').children&&a.el('por-marks-host').children.map?a.el('por-marks-host').children.map(c=>c.id):a.el('por-marks-host').innerHTML)));
    const b=app('arfat');b.run('phmkCanMark=function(){return false;};phmkTogglePanel=function(){return true;};');
    s.ok('not for Arfat',!/Marks and hold/.test(b.run('porDetailBodyHTML(allPOs[0])')));
  }
  s.section('deliberate reverts');
  const REV=[
    ['cancel offered by role','role matrix: arfat',"if(typeof _poCanCancel==='function'&&_poCanCancel()&&","if(('owner manager').indexOf(role)>=0&&"],
    ['release offered to everyone','role matrix: uzaib',"if(f.stage==='reserved'&&(role==='owner'||role==='manager'))out.push('release');","if(f.stage==='reserved')out.push('release');"],
    ['porDo trusts the button','porDo refuses an action the row did not offer (Arfat cannot cancel)',"    if(porActionsFor(f).indexOf(act)<0)return false;          // the gate again: an action the row did not offer is refused\n",""],
    ['marks for every manager role','role matrix: arfat',"let mgr=false;try{mgr=typeof phCanManage==='function'&&phCanManage()===true;}catch(e){}","let mgr=role==='owner'||role==='manager';"]
  ];
  for(const r of REV){
    if(SRC.reg.indexOf(r[2])<0){s.ok('revert "'+r[0]+'" landed',false);continue;}
    let c;try{c=checks({src:{reg:SRC.reg.split(r[2]).join(r[3])}});}catch(e){c={};}
    s.ok('revert "'+r[0]+'" fails "'+r[1]+'"',c[r[1]]!==true);
  }
  return s;
};

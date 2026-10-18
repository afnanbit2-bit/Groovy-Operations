/* PO Registry RG5: ONE row everywhere. js/pos.js poRowHTML() hands over to js/po-registry.js porRowForPO() behind typeof (try/catch),
   so the Dashboard's "Recent production orders" and All Active Orders draw the registry's row (a button, code, stage facts, alt text)
   with no edit to js/embellishments.js. Driven through the REAL renderDashboard() and renderMyWork(). Logic and markup only. */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC={shared:read('js/shared.js'),pos:read('js/pos.js'),emb:read('js/embellishments.js'),ph:read('js/ph-core.js'),core:read('js/por-core.js'),reg:read('js/po-registry.js')};
const ESC_SRC=read('js/gatepass.js').match(/function _gpEsc\(s\)\{[^\n]*\}/)[0];
const NOW=Date.now(),DAY=86400000;
const POS=[1,2,3].map(n=>({fbKey:'PO-00'+n,id:'PO-00'+n,name:'Tee '+n,code:'GST00'+n,fabric:'Jersey',createdBy:'Afnan',ts:NOW-n*DAY,createdAt:'2026-10-0'+n,
  poStatus:'in_production',currentStage:'cutting',releasedAt:new Date(NOW-n*DAY).toISOString(),qty:10,sizes:{M:10},imgFront:'https://res.cloudinary.com/x/'+n+'.jpg'}));

function app(o){
  const opt=o||{};
  const a=loadApp({files:[],currentPage:'dashboard'});
  const src=Object.assign({},SRC,opt.src||{});
  a.run(src.shared);a.run(src.pos);a.run(src.emb);a.run(src.ph);a.run(src.core);
  if(!opt.noReg)a.run(src.reg);
  a.run('session='+J({u:'afnan',name:'Afnan',role:'owner',canPO:true,stages:null}));a.run(ESC_SRC);
  a.run('allPOs='+J(POS)+';allPasses=[];_posLoadFailed=[];_posLoadAt=Date.now();');
  return a;
}
const count=(h,re)=>(h.match(re)||[]).length;
function checks(o){
  const a=app(o);
  const dash=a.run('renderDashboard()'),mine=a.run('renderMyWork()');
  return{
    'the dashboard recent list draws the shared row (3 buttons)':count(dash,/<button type="button" class="por-row"/g)===3&&count(dash,/class="po-row"/g)===0,
    'All Active Orders draws the shared row (3 buttons)':count(mine,/<button type="button" class="por-row"/g)===3,
    'every picture has alt text':count(dash,/<img /g)===count(dash,/<img [^>]*alt="[^"]+"/g)&&count(dash,/<img /g)===3,
    'the article code is on the dashboard row':/<span class="por-code">GST001<\/span>/.test(dash)
  };
}
module.exports=async function(){
  const s=suite('po-registry-rows');
  const ck=checks();
  Object.keys(ck).forEach(k=>s.ok(k,ck[k]===true));
  {const a=app({noReg:true});const d=a.run('renderDashboard()');
    s.ok('without js/po-registry.js the old row is drawn (the counts do not change)',count(d,/class="po-row"/g)===3);}
  {const a=app({src:{reg:SRC.reg+'\nporRowForPO=function(){throw new Error("x");};'}});const d=a.run('renderDashboard()');
    s.ok('a throwing row falls back to the old row',count(d,/class="po-row"/g)===3);}
  s.ok('js/embellishments.js is not edited for this (no por call in it)',!/\bpor[A-Z]\w*\(/.test(SRC.emb));
  s.section('deliberate revert');
  const from="  if(typeof porRowForPO==='function'){try{return porRowForPO(p);}";
  s.ok('the hand-over line is in js/pos.js poRowHTML',SRC.pos.indexOf(from)>0);
  const c=checks({src:{pos:SRC.pos.split(from).join('  if(false){try{return porRowForPO(p);}')}});
  s.ok('revert "the hand-over removed" fails "the dashboard recent list draws the shared row"',c['the dashboard recent list draws the shared row (3 buttons)']!==true);
  return s;
};

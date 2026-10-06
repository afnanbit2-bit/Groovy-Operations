/* ─────────────────────────────────────────────────────────────────────────
   PO job copies (Oct 2026) — po.jobCopies = {embroidery,printing,washing}.
   Drives the REAL js/pos.js create path (window.submitPO), the edit path
   (window.savePOEdit) and the two renderers; asserts the stored shape (all
   three keys, real booleans), the all-unticked default and that an older PO
   with no field reads as all false. Not seen on a real screen.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

function app(extra){
  return loadApp({files:['js/pos.js'],globals:Object.assign({
    currentPage:'',
    allPOs:[],allPasses:[],allReturns:[],allFabricIn:[],
    allGPEditRequests:[],allFabricInventory:[],allFabricMovements:[],
    STAGE_KEYS:['cutting','bundling'],
    PO_STATUS:{RESERVED:'reserved'},poImages:{front:null,back:null},editingPO:null,_poEmbellishment:null,session:{uid:'u1',name:'Afnan',u:'afnan',role:'owner',canPO:true},
    getNextId:async()=>7,
    loadData:async()=>{},
    _gpEsc:s=>String(s)
  },extra||{})});
}
function fill(a,ticks){
  const v={'po-name':'Tee','po-code':'GST001','po-qty':'100','po-fabric':'Terry'};
  Object.keys(v).forEach(k=>{a.el(k).value=v[k];});
  ['embroidery','printing','washing'].forEach(k=>{a.el('po-jc-'+k).checked=!!ticks[k];});
  a.run("poImages.front='x';");
}
const KEYS=['embroidery','printing','washing'];
const shapeOk=j=>!!j&&Object.keys(j).sort().join()===KEYS.slice().sort().join()&&KEYS.every(k=>typeof j[k]==='boolean');
const ticked=(html,k)=>new RegExp('id="po-jc-'+k+'" checked').test(html);

module.exports=async function(){
  const s=suite('po-jobcopies');

  s.section('create: the stored shape');
  {
    const a=app();fill(a,{embroidery:true,washing:true});
    await a.run('window.submitPO()');
    const w=a.state.writes.find(x=>x.op==='set'&&x.data&&x.data.id==='PO-007');
    s.ok('the PO was written',!!w,a.state.toasts.join('|'));
    const j=w&&w.data.jobCopies;
    s.ok('jobCopies has exactly the three keys, all real booleans',shapeOk(j),JSON.stringify(j));
    s.eq('embroidery ticked is true',j&&j.embroidery,true);
    s.eq('printing unticked is false',j&&j.printing,false);
    s.eq('washing ticked is true',j&&j.washing,true);
  }
  s.section('create: default is all unticked');
  {
    const a=app();fill(a,{});
    await a.run('window.submitPO()');
    const w=a.state.writes.find(x=>x.op==='set'&&x.data&&x.data.id==='PO-007');
    s.ok('stored all three keys as false',!!w&&shapeOk(w.data.jobCopies)&&KEYS.every(k=>w.data.jobCopies[k]===false),JSON.stringify(w&&w.data.jobCopies));
    const html=app().run('renderPOCreate()');
    s.ok('the create form offers all three checkboxes',KEYS.every(k=>html.indexOf('id="po-jc-'+k+'"')>=0));
    s.ok('none is pre-ticked on a new PO',KEYS.every(k=>!ticked(html,k)));
  }
  s.section('legacy PO reads as all false');
  {
    const a=app();
    const none='{"embroidery":false,"printing":false,"washing":false}';
    s.eq('no field -> all false',JSON.stringify(a.run('_poJobCopiesOf({id:"PO-001"})')),none);
    s.eq('null PO -> all false',JSON.stringify(a.run('_poJobCopiesOf(null)')),none);
    s.eq('a truthy non-boolean is not true',JSON.stringify(a.run('_poJobCopiesOf({jobCopies:{embroidery:"yes",printing:1}})')),none);
    a.run("allPOs=[{fbKey:'k',id:'PO-001',name:'n',code:'c',qty:5}];editingPO='k';_poCanEdit=()=>true;");
    const html=a.run('renderPOEditPage()');
    s.ok('edit form of a legacy PO shows the boxes, none ticked',KEYS.every(k=>html.indexOf('id="po-jc-'+k+'"')>=0&&!ticked(html,k)));
  }
  s.section('edit: prefilled and saved');
  {
    const a=app();
    a.run("allPOs=[{fbKey:'k',id:'PO-002',name:'n',code:'c',qty:5,fabric:'f',jobCopies:{embroidery:false,printing:true,washing:false}}];editingPO='k';_poCanEdit=()=>true;");
    const html=a.run('renderPOEditPage()');
    s.ok('printing is prefilled ticked',ticked(html,'printing'));
    s.ok('embroidery is not',!ticked(html,'embroidery'));
    a.el('po-qty').value='5';a.el('po-fabric').value='f';
    a.el('po-jc-embroidery').checked=true;a.el('po-jc-printing').checked=false;a.el('po-jc-washing').checked=true;
    await a.run("window.savePOEdit('k')");
    const w=a.state.writes.find(x=>x.op==='update');
    s.ok('update carries a well-formed jobCopies',!!w&&shapeOk(w.data.jobCopies),JSON.stringify(w&&w.data));
    s.ok('values follow the boxes',!!w&&w.data.jobCopies.embroidery===true&&w.data.jobCopies.printing===false&&w.data.jobCopies.washing===true);
  }
  return s;
};

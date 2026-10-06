/* Job-copy buttons on the PO detail page (js/pos.js). Holds: which buttons show
   (_poJobCopyKinds, one pure rule), the markup, the click handlers reaching the generate
   functions with the right PO, a throw being toasted, and Print all continuing past a failure.
   renderDetailPage itself is not driven (it needs most of the app); the source check below
   holds that it calls _poJobCopiesHTML. Layout/look not covered: no PO detail smoke-layout fragment. */
'use strict';
const fs=require('fs'),path=require('path');
const {loadApp,suite,ROOT}=require('./harness');

module.exports=function(){
  const s=suite('po-jobcopy-buttons');
  const app=loadApp({files:['js/pos.js'],globals:{currentPage:'',allPOs:[],allPasses:[],allReturns:[],allFabricIn:[],allGPEditRequests:[],allFabricInventory:[],allFabricMovements:[]}});
  const run=c=>app.run(c);
  const kinds=po=>run('_poJobCopyKinds('+JSON.stringify(po)+')').join(',');

  s.section('which kinds show');
  s.eq('no field: all three, in order',kinds({id:'P1'}),'embroidery,printing,washing');
  s.eq('all false: none',kinds({jobCopies:{embroidery:false,printing:false,washing:false}}),'');
  s.eq('one true',kinds({jobCopies:{printing:true}}),'printing');
  s.eq('all true',kinds({jobCopies:{embroidery:true,printing:true,washing:true}}),'embroidery,printing,washing');

  s.section('markup');
  const btnsOf=po=>(run('_poJobCopiesHTML('+JSON.stringify(po)+')').match(/data-jobcopy="[a-z]+"/g)||[]).map(x=>x.slice(14,-1)).join(',');
  s.eq('older PO: three buttons plus Print all',btnsOf({id:'P1',fbKey:'k1'}),'embroidery,printing,washing,all');
  s.eq('one ticked: one button, no Print all',btnsOf({fbKey:'k1',jobCopies:{washing:true}}),'washing');
  s.eq('two ticked: two plus Print all',btnsOf({fbKey:'k1',jobCopies:{embroidery:true,washing:true}}),'embroidery,washing,all');
  s.eq('none ticked: no row',run('_poJobCopiesHTML({fbKey:"k1",jobCopies:{}})'),'');
  const src=fs.readFileSync(path.join(ROOT,'js/pos.js'),'utf8');
  s.ok('detail page renders the row',/function renderDetailPage[\s\S]*?\$\{_poJobCopiesHTML\(po\)\}/.test(src));

  s.section('handlers');
  run(`globalThis.__calls=[];allPOs.length=0;allPOs.push({fbKey:'k1',id:'P1'},{fbKey:'k2',id:'P2',jobCopies:{embroidery:true,printing:true,washing:true}});
    window.generateEmbroideryJobPdf=function(p){__calls.push(['embroidery',p.id]);};
    window.generatePrintingJobPdf=function(p){__calls.push(['printing',p.id]);throw new Error('boom');};
    window.generateWashingJobPdf=async function(p){await null;__calls.push(['washing',p.id]);};`);
  const calls=()=>JSON.stringify(run('__calls'));
  const toastHas=re=>app.state.toasts.some(t=>re.test(JSON.stringify(t)));
  return run('window.poJobCopyPrint("k1","embroidery")').then(()=>{
    s.eq('click passes the right PO and kind',calls(),'[["embroidery","P1"]]');
    run('__calls.length=0');
    return run('window.poJobCopyPrint("k1","printing")');
  }).then(r=>{
    s.eq('a throwing generator resolves false, not a rejection',r,false);
    s.ok('the throw was toasted',toastHas(/Printing job failed: boom/));
    run('__calls.length=0');
    return run('window.poJobCopyPrintAll("k2")');
  }).then(()=>{
    s.eq('Print all: failure in the middle does not stop washing',calls(),'[["embroidery","P2"],["printing","P2"],["washing","P2"]]');
    return run('window.poJobCopyPrint("nope","washing")');
  }).then(()=>{
    s.ok('unknown PO is toasted',toastHas(/PO not found/));
    return s;
  });
};

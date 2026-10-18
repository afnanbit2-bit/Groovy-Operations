/* PO Registry RG4: the PO detail BODY (js/po-registry.js porDetailBodyHTML / porDetailAfter) through the REAL js/pos.js
   renderDetailPage() hand-over. Hand fixture: PO-125 at stitching, cut 119 of 120 on 9 Sep, bundling done 14 Sep with 3 damaged,
   4 bundles (2 stitched), received 55, a fabric pass spelt "125". Each guard is reverted once and a named check must fail.
   Logic and markup only: not Firestore, not a screen. */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC={shared:read('js/shared.js'),pos:read('js/pos.js'),ph:read('js/ph-core.js'),core:read('js/por-core.js'),reg:read('js/po-registry.js')};
const ESC_SRC=read('js/gatepass.js').match(/function _gpEsc\(s\)\{[^\n]*\}/)[0];
const OWNER={uid:'u1',name:'Afnan',u:'afnan',role:'owner',canPO:true,stages:null};

const PO125={fbKey:'PO-125',id:'PO-125',name:'Athletic Tee · Black',code:'GAT012',fabric:'Single Jersey 180',fabricCode:'BLKJRS180',createdBy:'Mustafa',
  ts:Date.parse('2026-09-05T10:00:00+05:00'),createdAt:'2026-09-05',poStatus:'in_production',currentStage:'stitching',releasedAt:'2026-09-05T08:00:00.000Z',releasedBy:'Mustafa',
  qty:120,sizes:{XS:0,S:20,M:40,L:40,XL:20,'2XL':0},cutAt:'2026-09-09T06:00:00.000Z',cutBy:'Uzaib',cutQty:{XS:0,S:20,M:39,L:40,XL:20,'2XL':0},bundleIds:['B-1','B-2','B-3','B-4'],
  stages:{cutting:{done:true,doneAt:'2026-09-09T06:00:00.000Z',doneBy:'Uzaib'},bundling:{done:true,doneAt:'2026-09-14T06:00:00.000Z',doneBy:'Zohaib'}},
  damageSummary:{total:3,bySize:{M:2,L:1}},damagePercent:2.5,damageFlagged:true,packingReceipts:[{size:'S',qty:20},{size:'M',qty:35}],
  notes:'<b>rib</b> late',imgFront:'https://res.cloudinary.com/x/f.jpg',imgBack:'https://res.cloudinary.com/x/b.jpg',embellishment:{required:false}};
const BUNDLES=[{bundleId:'B-1',poId:'PO-125',size:'S',units:20,stitchingDone:true},{bundleId:'B-2',poId:'PO-125',size:'M',units:39,stitchingDone:true},
  {bundleId:'B-3',poId:'PO-125',size:'L',units:40},{bundleId:'B-4',poId:'PO-125',size:'XL',units:20}];
const PASSES=[{id:'GP-312',gpType:'fabric',poId:'125',date:'2026-09-07',cutMaster:'Alam',totalWeight:40.1}];

async function open(o){
  const opt=o||{};
  const a=loadApp({files:[],currentPage:'po-detail',globals:{getDocs:opt.getDocs||(async()=>({docs:BUNDLES.map(b=>({data:()=>b}))}))}});
  const src=Object.assign({},SRC,opt.src||{});
  a.run(src.shared);a.run(src.pos);a.run(src.ph);a.run(src.core);
  if(!opt.noReg)a.run(src.reg);
  a.run('session='+J(opt.session||OWNER));a.run(ESC_SRC);
  a.run('loadData=async function(){};showToast=function(){};');
  a.run('allPOs='+J([Object.assign({},PO125,opt.po||{})])+';allPasses='+J(PASSES)+';_posLoadFailed=[];_posLoadAt=Date.now();viewingPO="PO-125";');
  a.run('renderDetailPage()');
  const first=a.el('main-content').innerHTML,loading=a.el('por-detail').innerHTML;
  await new Promise(r=>setTimeout(r,20));
  return{a,first,loading,after:a.el('por-detail').innerHTML};
}
async function checks(o){
  const out={};
  const {first,after}=await open(o);
  const tl=(first.match(/<ol class="por-tl"[\s\S]*?<\/ol>/)||[''])[0];
  const labels=(tl.match(/<b>([^<]+)<\/b>/g)||[]).map(x=>x.replace(/<\/?b>/g,''));
  out['the timeline is in the real order']=J(labels)===J(['Created','Released','Fabric issued','Cut','Bundling','Stitching','Printing','Washing','Final QC','Completed']);
  out['the header slots are kept']=/generatePOPdf|Print PO/.test(first)&&/Edit PO/.test(first)&&/Cancel PO/.test(first);
  out['the old cards are not drawn']=!/class="stage-item"/.test(first)&&!/Product images/.test(first);
  out['six sizes, 2XL included']=/<th scope="col">2XL<\/th>/.test(first);
  out['a pass spelt 125 is on the timeline']=/GP-312 · 7 Sep · Alam · 40.1 kg/.test(first);
  out['after the bundles read: 4 bundles, 2 stitched']=/4 bundles, 2 stitched/.test(after)&&/<th scope="row">Stitched<\/th>/.test(after);
  out['notes are escaped']=after.indexOf('<b>rib</b>')<0&&after.indexOf('&lt;b&gt;rib&lt;/b&gt;')>=0;
  out['photos are collapsed under the timeline']=/<details class="por-photos"><summary>Photos \(2\)<\/summary>/.test(after)&&after.indexOf('por-photos')>after.indexOf('por-tl');
  out['the current stage carries Force advance for a manager']=/Stitching[\s\S]*?Force advance/.test(tl)&&(tl.match(/Force advance/g)||[]).length===1;
  return out;
}

module.exports=async function(){
  const s=suite('po-registry-detail');
  s.section('PO-125 through renderDetailPage');
  const ck=await checks();
  Object.keys(ck).forEach(k=>s.ok(k,ck[k]===true));
  {
    const {first,after,loading}=await open();
    s.ok('the title says PO-125 once (not "PO PO-125")',/<div class="page-title">PO-125<\/div>/.test(first));
    s.ok('cut 119 pcs, 4 bundles, inside the gate (119/120)',/9 Sep 2026 by Uzaib · 119 pcs · 4 bundles/.test(first)&&/inside the gate/.test(first));
    s.ok('bundling: 3 damaged (M 2, L 1) · 2.5%',/3 damaged \(M 2, L 1\) · 2.5%/.test(first));
    s.ok('before the read: "reading bundles…"',/reading bundles…/.test(loading));
    s.ok('Final QC: received 55 of 119',/received 55 of 119/.test(first));
    s.ok('sizes: received S 20, M 35',/<th scope="row">Received<\/th><td>0<\/td><td>20<\/td><td>35<\/td><td>0<\/td><td>0<\/td><td>0<\/td><td class="por-tot">55<\/td>/.test(after),after.slice(after.indexOf('Received'),after.indexOf('Received')+120));
  }
  {
    const {after}=await open({getDocs:async()=>{throw Object.assign(new Error('Missing or insufficient permissions'),{code:'permission-denied'});}});
    s.ok('a refused bundles read is said by name, never "0 bundles"',/bundles: could not be read \(permission denied\)/.test(after)&&!/0 bundles/.test(after));
  }
  {
    const {after}=await open({getDocs:async()=>({metadata:{fromCache:true},docs:[]})});
    s.ok('an offline-copy answer is a failed read',/only the offline copy answered/.test(after));
  }
  {
    const {first}=await open({session:{u:'arfat',name:'Arfat',role:'manager',stages:null}});
    s.ok('Arfat: no History button (Production Ops only), Force advance is offered by role as before',!/History ▸/.test(first)&&/Force advance/.test(first));
    const w=await open({session:{u:'waqas',name:'Waqas',role:'worker',stages:['stitching']}});
    s.ok('Waqas (stitching): Go to stage, no Force advance',/Go to stage/.test(w.first)&&!/Force advance/.test(w.first));
  }
  {
    const {first}=await open({noReg:true});
    s.ok('without js/po-registry.js the old body is drawn',/class="stage-item"/.test(first)&&!/por-detail/.test(first));
    const t=await open({src:{reg:SRC.reg+'\nporDetailBodyHTML=function(){throw new Error("x");};'}});
    s.ok('a throwing body falls back to the old cards',/class="stage-item"/.test(t.first));
  }
  s.section('deliberate reverts');
  const REV=[
    ['display STAGES order','the timeline is in the real order','reg',"items.push(_porTlItem(stateOf('printing'),'Printing',[_porStageBy(po,'printing')],_porStageActions(po,'printing')));\n","",
      "  const dmg=po.damageSummary&&","  items.push(_porTlItem(stateOf('printing'),'Printing',[_porStageBy(po,'printing')],_porStageActions(po,'printing')));\n  const dmg=po.damageSummary&&"],
    ['the hand-over removed','the old cards are not drawn','pos',"  if(typeof porDetailBodyHTML==='function'){try{_porBody=porDetailBodyHTML(po);}","  if(false){try{_porBody=porDetailBodyHTML(po);}"],
    ['2XL dropped','six sizes, 2XL included','core',"const sizes=POR_SIZES.concat(extra);","const sizes=POR_SIZES.slice(0,5).concat(extra);"],
    ['porKey bypassed','a pass spelt 125 is on the timeline','core',"const k=porKey(_porPassPo(g));","const k=_porStr(_porPassPo(g));"],
    ['porDetailAfter not called','after the bundles read: 4 bundles, 2 stitched','pos',"  if(_porBody!==null&&typeof porDetailAfter==='function')porDetailAfter(po);",""],
    ['notes not escaped','notes are escaped','reg',"<b>Notes</b> <span>'+_porEsc(po.notes)+'</span>","<b>Notes</b> <span>'+po.notes+'</span>"],
    ['photos open above','photos are collapsed under the timeline','reg',"return'<details class=\"por-photos\"><summary>","return'<details open class=\"por-photos-x\"><summary>"],
    ['force advance on every stage','the current stage carries Force advance for a manager','reg',"  if(po.currentStage!==key)return'';\n",""]
  ];
  for(const r of REV){
    let src=SRC[r[2]];let landed=true;
    for(let i=3;i<r.length;i+=2){if(src.indexOf(r[i])<0)landed=false;src=src.split(r[i]).join(r[i+1]);}
    if(!landed){s.ok('revert "'+r[0]+'" landed',false);continue;}
    let c;try{c=await checks({src:{[r[2]]:src}});}catch(e){c={};}
    s.ok('revert "'+r[0]+'" fails "'+r[1]+'"',c[r[1]]!==true);
  }
  return s;
};

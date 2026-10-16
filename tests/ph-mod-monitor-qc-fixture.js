/* Fixture for the QC8 part of tests/ph-mod-monitor.test.js (not a *.test.js; the runner skips it).
   NOW = Mon 12 Oct 2026, 09:00 PKT (the Monitor fixture's clock). Every PO is the owner's example: 120 pieces cut 20/40/40/20, so under the 2 %
   rule (two in every hundred, nearest piece, a half goes up) the allowances are S 0, M 1, L 1, XL 0 and the PO total 2.
   What each PO is, and the list(s) it must land in (worked out by hand; the numbers are written beside the assertions in the test):
     PO-201  stitching  20/40/40/20 received                          exact           -> ready        (+ two VOID lots: 1 and 3 days ago)
     PO-202  qc         20/39/40/20                                   within (1 short)-> ready        (+ a void lot 8 days ago: outside the 7-day window)
     PO-203  qc         20/41/40/20                                   over by 1       -> ready
     PO-204  qc         20/38/40/20  (M 2 short > allowance 1)        phase short     -> short        (+ a void lot 2 days ago)
     PO-205  qc         20/40/40/0, newest lot 2 days ago             receiving       -> receiving (not idle: 2 < 3 days)
     PO-206  qc         20/40/40/0, newest lot 4 days ago             receiving       -> receiving + idle (4 days)
     PO-207  qc         cut recorded, no lot, washing done 5 days ago awaiting QC     -> idle (5 days)
     PO-208  qc         cut recorded, no lot, washing done 1 day ago  awaiting QC     -> nowhere (1 < 3 days)
     PO-209  qc         cut recorded, no lot, washing has no date      awaiting QC     -> nowhere, counted as "could not be dated"
     PO-210  stitching  20/40/40/20 received, the PO now says M 45 (lock says 40)      -> ready + drift
     PO-211  completed  closed 2 days ago WITH a close_short override -> closed with a shortfall
     PO-212  completed  closed 10 days ago with a close_short override                -> nowhere (outside the 7-day window)
     PO-213  completed  closed 2 days ago, clean (its only override is an earlier relock) -> nowhere
     PO-214  cancelled  a full set of lots on it                                      -> nowhere (cancelled)
     PO-215  reserved                                                                 -> nowhere
     PO-216  completed  classic-completed, never reconciled                           -> nowhere
     PO-217  qc         a lot with a status that is neither live nor void             -> "could not be judged"
     PO-218  qc         20/40/40/0, newest lot exactly 3 days ago                     receiving       -> receiving + idle (3 days: the boundary counts)
     PO-219  stitching  cut recorded, no lot, bundling done 10 days ago               -> nowhere (only a PO that reached QC is late with its lots)
   So: ready 201,202,203,210 (4) · short 204 (1) · receiving 205,206,218 (3) · idle 207(5 d),206(4 d),218(3 d) (3) · drift 210 (1)
       closedShort 211 (1) · voided: PO-201 (2 lots) and PO-204 (1 lot) = 2 POs, 3 lots · notJudged 217 · idle-no-date 1 (PO-209). */
'use strict';
const fx=require('./ph-mod-monitor-fixture');
const NOW=fx.NOW;
const DAY=86400000;
const STAGES=['cutting','bundling','stitching','printing','washing','qc'];
const CUT={S:20,M:40,L:40,XL:20};
const iso=ms=>new Date(ms).toISOString();

function po(id,stage,o){
  const stages={};STAGES.forEach(k=>{stages[k]={done:false,doneAt:null,doneBy:null};});
  stages.cutting={done:true,doneAt:iso(NOW-9*DAY),doneBy:'Uzaib'};
  const base={id:id,name:'Athletic Tee '+id.slice(3),code:'GAT'+id.slice(3),qty:120,sizes:Object.assign({},CUT),poStatus:'in_production',currentStage:stage,
    stages:stages,cutQty:Object.assign({},CUT),cutAt:iso(NOW-9*DAY),ts:NOW-30*DAY,createdAt:'2026-09-12'};
  return Object.assign(base,o||{});
}
const lock=()=>({sizes:Object.assign({},CUT),total:120,cutAt:iso(NOW-9*DAY),cutBy:'Uzaib',lockedAt:NOW-8*DAY,lockedBy:'faizan',source:'first_lot'});
const recon=(id,o)=>Object.assign({poId:id,status:'locked',rev:2,cutLock:lock(),lotCount:1,voidCount:0,lastLotAt:NOW-DAY,overrides:[],createdAt:NOW-8*DAY,createdBy:'faizan',updatedAt:NOW-DAY,updatedBy:'faizan'},o||{});
let seq=0;
function lot(poId,sizes,o){
  seq++;
  const total=Object.keys(sizes).reduce((a,k)=>a+sizes[k],0);
  return Object.assign({id:poId+'-17920000'+String(seq).padStart(5,'0')+'-ab'+String(seq).padStart(2,'0'),poId:poId,seq:seq,sizes:sizes,total:total,day:'2026-10-10',note:'',
    at:NOW-DAY,by:'faizan',byName:'Faizan',status:'live',src:'qc'},o||{});
}
const voidLot=(poId,sizes,ago,reason,by)=>lot(poId,sizes,{status:'void',at:NOW-ago*DAY-DAY,voidedAt:NOW-ago*DAY,voidedBy:by||'faizan',voidReason:reason});
const closedOv=(cause,reason)=>[{kind:'close_short',at:NOW-2*DAY,by:'mustafa',byName:'Mustafa',reason:reason,cause:cause}];

function build(){
  seq=0;
  const pos=[],rc=[],lots=[];
  const add=(p,r,l)=>{pos.push(p);if(r)rc.push(r);(l||[]).forEach(x=>lots.push(x));};
  add(po('PO-201','stitching'),recon('PO-201'),[lot('PO-201',{S:20,M:40,L:40,XL:20}),voidLot('PO-201',{S:5},1,'wrong size'),voidLot('PO-201',{M:3},3,'counted twice','mustafa')]);
  add(po('PO-202','qc'),recon('PO-202'),[lot('PO-202',{S:20,M:39,L:40,XL:20}),voidLot('PO-202',{S:2},8,'old typo')]);
  add(po('PO-203','qc'),recon('PO-203'),[lot('PO-203',{S:20,M:41,L:40,XL:20})]);
  add(po('PO-204','qc'),recon('PO-204'),[lot('PO-204',{S:20,M:38,L:40,XL:20}),voidLot('PO-204',{L:1},2,'wrong bundle')]);
  add(po('PO-205','qc'),recon('PO-205'),[lot('PO-205',{S:20,M:40,L:40},{at:NOW-2*DAY})]);
  add(po('PO-206','qc'),recon('PO-206'),[lot('PO-206',{S:20,M:40,L:40},{at:NOW-4*DAY})]);
  const qcPo=(id,doneAgo)=>{const p=po(id,'qc');p.stages.washing=doneAgo===null?{done:true,doneAt:null,doneBy:null}:{done:true,doneAt:iso(NOW-doneAgo*DAY),doneBy:'x'};return p;};
  add(qcPo('PO-207',5),null,[]);
  add(qcPo('PO-208',1),null,[]);
  add(qcPo('PO-209',null),null,[]);
  const p210=po('PO-210','stitching');p210.cutQty={S:20,M:45,L:40,XL:20};
  add(p210,recon('PO-210'),[lot('PO-210',{S:20,M:40,L:40,XL:20})]);
  const closed=(id,ago,ov,total)=>recon(id,{status:'closed',closedAt:NOW-ago*DAY,closedBy:'mustafa',closedByName:'Mustafa',overrides:ov,closeVerdict:{state:'short',phase:ov.length?'receiving':'ready',total:total}});
  add(po('PO-211','completed',{poStatus:'complete'}),closed('PO-211',2,closedOv('lost_in_line','two lost in the line'),{cut:120,recv:118,diff:-2,allow:2,state:'within'}),[lot('PO-211',{S:20,M:38,L:40,XL:20})]);
  add(po('PO-212','completed',{poStatus:'complete'}),closed('PO-212',10,closedOv('other','old one'),{cut:120,recv:110,diff:-10,allow:2,state:'short'}),[]);
  add(po('PO-213','completed',{poStatus:'complete'}),closed('PO-213',2,[{kind:'relock',at:NOW-5*DAY,by:'afnan',byName:'Afnan',reason:'recount'}],{cut:120,recv:120,diff:0,allow:2,state:'exact'}),[lot('PO-213',{S:20,M:40,L:40,XL:20})]);
  add(po('PO-214','cancelled',{poStatus:'cancelled',currentStage:null}),recon('PO-214'),[lot('PO-214',{S:20,M:40,L:40,XL:20})]);
  add(po('PO-215','x',{poStatus:'reserved',currentStage:null,cutQty:undefined,cutAt:undefined}),null,[]);
  add(po('PO-216','completed',{poStatus:'complete'}),null,[]);
  add(po('PO-217','qc'),recon('PO-217'),[lot('PO-217',{S:20},{status:'weird'})]);
  add(po('PO-218','qc'),recon('PO-218'),[lot('PO-218',{S:20,M:40,L:40},{at:NOW-3*DAY})]);
  const p219=po('PO-219','stitching');p219.stages.bundling={done:true,doneAt:iso(NOW-10*DAY),doneBy:'x'};
  add(p219,null,[]);
  return{pos:pos.map(p=>Object.assign({},p,{fbKey:p.id})),recon:rc.map(r=>Object.assign({},r,{fbKey:r.poId})),lots:lots.map(l=>Object.assign({},l,{fbKey:l.id}))};
}
/** the same data as a fake Firestore keyed by collection path (the Monitor fixture's other collections kept, its 15 POs replaced) */
function dbData(over){
  const b=build();
  const strip=a=>a.map(r=>{const c=Object.assign({},r);delete c.fbKey;return c;});
  // a recon document's id IS its PO id; a lot's id is its own
  const d=fx.dbData();
  d.pos=strip(b.pos);
  d.po_qc_recon=strip(b.recon).map(r=>Object.assign({},r,{id:r.poId}));
  d.po_qc_lots=strip(b.lots);
  d.po_cut_jobs=[];
  return Object.assign(d,over||{});
}
const clone=x=>JSON.parse(JSON.stringify(x));
module.exports={NOW,DAY,CUT,build,dbData,clone,po,recon,lot,voidLot,closedOv,lock};

/* PO Registry RG2: two more Data-health checks in js/ph-mod-health.js, held on a hand-made fixture.
     released_unreadable — a PO whose releasedAt is stored but is not a moment; the note counts text vs number.
     bundles_no_cut     — bundles whose PO carries no recorded cut, or whose PO does not exist (managers only).
   The live survey (15 Oct 2026, reported in the plan, NOT re-run here) found 58 bundles while no pos document had a cut, and
   releasedAt stored as 135 ISO strings and 1 number. Logic only: no Firestore, no screen. Each guard is reverted once. */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(ROOT,'js/ph-mod-health.js'),'utf8');

const POS=[
  {id:'PO-001',fbKey:'PO-001',name:'A',currentStage:'cutting',poStatus:'in_production',releasedAt:'2026-08-01T09:00:00.000Z',qty:10,sizes:{M:10}},
  {id:'PO-002',fbKey:'PO-002',name:'B',currentStage:'bundling',poStatus:'in_production',releasedAt:1786000000000,cutAt:'2026-08-05T09:00:00.000Z',cutQty:{M:10},qty:10,sizes:{M:10}},
  {id:'PO-003',fbKey:'PO-003',name:'C',currentStage:'cutting',poStatus:'in_production',releasedAt:'not a date',qty:10,sizes:{M:10}},
  {id:'PO-004',fbKey:'PO-004',name:'D',poStatus:'reserved',qty:10,sizes:{M:10}}
];
const BUNDLES=[
  {bundleId:'B-0001',poId:'PO-001',size:'M',units:5},   // PO-001 has no cut: listed
  {bundleId:'B-0002',poId:'PO-001',size:'M',units:5},
  {bundleId:'B-0003',poId:'PO-002',size:'M',units:10},  // PO-002 was cut: fine
  {bundleId:'B-0004',poId:'PO-099',size:'S',units:7},   // no such PO
  {bundleId:'B-0005',size:'S',units:1}                   // no PO number at all (note)
];

function model(src,over){
  const a=loadApp({files:['js/ph-core.js'],globals:{}});
  a.run(src);
  return JSON.parse(J(a.run('phhBuildModel('+J(Object.assign({pos:POS,passes:[],jobs:[],picks:{},recon:[],lots:[],bundles:BUNDLES},over||{}))+')')));
}
function checks(src){
  const m=model(src),nm=model(src,{qc:false}),nb=model(src,{bundles:null});
  const b=m.byId.bundles_no_cut,r=m.byId.released_unreadable;
  return{
    'the bundles of an uncut PO are listed (PO-001, 2 bundles, 10 pcs)':!!b&&b.items.some(i=>i.id==='PO-001'&&/2 bundles \(10 pcs/.test(i.text)),
    'a cut PO\'s bundles are not listed':!!b&&!b.items.some(i=>i.id==='PO-002'),
    'bundles for a PO that does not exist are listed by key':!!b&&b.items.some(i=>i.id==='PO-099'&&/does not exist/.test(i.text)),
    'bundles not read: the check is unavailable, never 0':nb.byId.bundles_no_cut.state==='unavailable'&&nb.byId.bundles_no_cut.count===null&&nb.byId.bundles_no_cut.unavailable.join()==='bundles',
    'a non-manager is not shown the bundle check':!nm.byId.bundles_no_cut&&!!nm.byId.released_unreadable,
    'an unreadable releasedAt is listed':!!r&&r.items.length===1&&r.items[0].id==='PO-003',
    'the note counts text and number':!!r&&/2 POs store the release as text/.test(r.note)&&/1 as a number/.test(r.note)
  };
}

module.exports=async function(){
  const s=suite('po-registry-health');
  s.section('the two checks on the hand fixture');
  const ck=checks(SRC);
  Object.keys(ck).forEach(k=>s.ok(k,ck[k]===true));
  const m=model(SRC);
  s.eq('bundles_no_cut count: PO-001 and PO-099 = 2',m.byId.bundles_no_cut.count,2);
  s.ok('the bundle with no PO number is noted',/1 bundle has no PO number/.test(m.byId.bundles_no_cut.note));
  s.eq('released_unreadable count 1',m.byId.released_unreadable.count,1);
  s.ok('the bundle read is unordered (an orderBy would drop a bundle with no ts) and bounded',/getDocs\(query\(collection\(db,'bundles'\),limit\(lim\)\)\)/.test(SRC));
  s.ok('the bundle read is started only with the managers\' qc option',/const bun=wantQc\?_phhEnsureBundles\(force\):null;/.test(SRC));

  s.section('deliberate reverts');
  const REV=[
    ['a cut PO counts as uncut','a cut PO\'s bundles are not listed',"        if(cutKeys.has(k))return;\n",""],
    ['a missing PO dropped','bundles for a PO that does not exist are listed by key',"        else r.items.push({kind:'note',id:k,text:why+' · '+k+' does not exist'});",""],
    ['unread bundles treated as none','bundles not read: the check is unavailable, never 0',"const bunOk=Array.isArray(I.bundles)&&I.bundlesTruncated!==true;","const bunOk=true;I.bundles=I.bundles||[];"],
    ['the manager gate dropped','a non-manager is not shown the bundle check',"if((c.qc||c.mgr)&&!qcOn)return;","if(c.qc&&!qcOn)return;"],
    ['an unreadable date passed as read','an unreadable releasedAt is listed',"if(phMs(po.releasedAt)===null){","if(false){"]
  ];
  for(const r of REV){
    if(SRC.indexOf(r[2])<0){s.ok('revert "'+r[0]+'" landed',false);continue;}
    let c;try{c=checks(SRC.split(r[2]).join(r[3]));}catch(e){c={};}
    s.ok('revert "'+r[0]+'" fails "'+r[1]+'"',c[r[1]]!==true);
  }
  return s;
};

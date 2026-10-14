/* A new PO is born released (WP13). Both creators stamp `releasedAt` (a number, ms) in the document they create, so
   ph-core's lead time counts the PO from its issue instead of excluding it as 'start_from_ts'.
   Held by driving the real entry points: window.submitPO (classic form), phBuildIssuedPo (the pure builder phIssueDraft hands
   to m.write inside the ONE transaction; the full-commit equality is asserted in tests/ph-issue.test.js), ph-core's phLeadTime
   on the stored documents, a legacy PO document, and the New-PO fabric card (no roll picker). Logic only: not Firestore, not a screen. */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const R=require('./po-reserve-removal.test.js').helpers;
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=v=>JSON.stringify(v);

module.exports=async function(){
  const s=suite('po-releasedat');

  s.section('classic form: submitPO stamps releasedAt');
  const before=Date.now();
  const a=R.mkApp({'counters/main':{pos:6}});
  await R.createPO(a);
  const p=R.at(a,'pos/PO-007');
  s.ok('releasedAt is a number in ms (same unit as ts)',typeof p.releasedAt==='number'&&p.releasedAt>=1e11&&p.releasedAt>=before,String(p.releasedAt));
  s.ok('it is the last key (after createdAt), the order PH_ISSUE_CLASSIC_KEYS holds',Object.keys(p).indexOf('releasedAt')===Object.keys(p).indexOf('createdAt')+1);
  s.ok('the stamp is in the payload that createWithNextId writes (one transaction with the counter)',/createdAt:_poPktDay\(Date\.now\(\)\),releasedAt:Date\.now\(\)\}/.test(read('js/pos.js'))&&a.db.log.commits===1);

  s.section('Issue as PO: the builder stamps releasedAt = ts, inside the transaction');
  const P=loadApp({files:['js/shared.js','js/pos.js','js/ph-core.js','js/ph-write.js','js/ph-issue.js'],currentPage:'dashboard',globals:{}});
  const rec=P.run('phBuildIssuedPo({name:"T",code:"GST001",qty:10,sizes:{S:10}},{id:"PO-050",now:1790000000000,draftId:"D",enteredBy:"u",issuedBy:"m",issuedByName:"M",stageKeys:STAGE_KEYS,poStatus:"in_production",currentStage:"cutting",pktDay:"2026-10-14"})');
  s.ok('releasedAt equals ts and is a number',rec.releasedAt===1790000000000&&rec.ts===rec.releasedAt);
  s.ok('it sits right after createdAt',Object.keys(rec).indexOf('releasedAt')===Object.keys(rec).indexOf('createdAt')+1);
  const src=read('js/ph-issue.js');
  const txBody=src.slice(src.indexOf('runTransaction'));
  s.ok('phBuildIssuedPo is called inside the runTransaction callback and its record is what m.write commits',txBody.indexOf('phBuildIssuedPo(')>0&&txBody.indexOf('m.write(rec)')>txBody.indexOf('phBuildIssuedPo('));
  s.ok('PH_ISSUE_CLASSIC_KEYS lists releasedAt',P.run('PH_ISSUE_CLASSIC_KEYS').indexOf('releasedAt')===P.run('PH_ISSUE_CLASSIC_KEYS').indexOf('createdAt')+1);

  s.section('lead time now counts a new PO from its issue');
  const HOUR=3600000;
  const cutAt=new Date(p.releasedAt+50*HOUR).toISOString();
  const lt=a.run('phLeadTime('+J(Object.assign({},p,{cutAt}))+')');
  s.ok('state cut with days, quality start_from_release (not start_from_ts)',lt.state==='cut'&&lt.quality.indexOf('start_from_release')>=0&&lt.quality.indexOf('start_from_ts')<0,J(lt));
  const rep=a.run('phLeadTime('+J(Object.assign({},p,{releasedAt:undefined,cutAt}))+')');
  s.ok('control: the same PO without releasedAt is start_from_ts (excluded from averages)',rep.quality.indexOf('start_from_ts')>=0);
  s.ok('a PO built by the issue builder counts the same way',a.run('phLeadTime('+J(Object.assign({},rec,{cutAt:new Date(rec.releasedAt+HOUR).toISOString()}))+')').quality.indexOf('start_from_release')>=0);

  s.section('legacy POs are untouched');
  const legacy={id:'PO-001',ts:1780000000000,poStatus:'reserved',currentStage:null,createdAt:'2026-09-01'};
  const a2=R.mkApp({'pos/PO-001':legacy,'counters/main':{pos:1}});
  await R.createPO(a2);
  s.eq('creating a new PO leaves an existing document byte-identical',J(a2.db.get('pos/PO-001')),J(legacy));
  s.ok('a legacy PO with no releasedAt is still start_from_ts',a2.run('phLeadTime('+J(Object.assign({},legacy,{cutAt:new Date(legacy.ts+HOUR).toISOString()}))+')').quality.indexOf('start_from_ts')>=0);
  s.ok('release-to-production still writes its own ISO releasedAt (unchanged)',/releasedBy:session\.name,releasedAt:new Date\(\)\.toISOString\(\)/.test(read('js/pos.js')));

  s.section('the New-PO form does not show the roll picker');
  const f=loadApp({files:['js/fabric.js'],globals:{allFabricInventory:[{_id:'k1',fabType:'Terry',gsm:220,color:'Black',unit:'kg',rollsCount:3,rolls:[{rollCode:'r1',status:'in_stock',weight:20}]}],_gpEsc:x=>String(x==null?'':x)}});
  const html=f.run('window.fabPoFabricCard()');
  s.ok('no stock select, no roll rows, no add-fabric button',!/po-fab-sel|po-fab-rows|po-fab-rolls|fabPoAddRow|Select fabric/.test(html),html.slice(0,200));
  s.ok('the manual fields are still there',['po-fabric','po-fabriccode','po-store','po-rolls'].every(i=>html.indexOf('id="'+i+'"')>=0));
  s.ok('it says fabric is issued later through Fabric Issue and nothing is reserved',/issued later through <b>Fabric Issue<\/b>/.test(html)&&/Nothing is reserved/.test(html));
  s.ok('the legacy picker code is kept, unused (not deleted)',/window\.fabPoReserveCommit=/.test(read('js/fabric.js'))&&/function _fabPoRowHTML/.test(read('js/fabric.js')));
  return s;
};

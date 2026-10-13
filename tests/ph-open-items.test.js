/* Production Ops open items, writer side (14 Oct 2026): js/ph-write.js.

   What this holds, over the REAL js/ph-core.js + ph-data.js + the writer source under test, against the same in-memory Firestore
   tests/ph-data.test.js uses (real transaction semantics, every write recorded):
     · rollsChecklist may carry `missingCodes` / `extraCodes` (lists of roll codes, each at most 40 characters, at most 200 of each);
       a bad list is refused BY NAME before any round trip; the five counts behave exactly as before; nothing else in the job
       document or its field lists moved (firestore.rules checks rollsChecklist only as a map: read from the rules text below)
     · phSaveCutJob takes an optional opts.data for the history row, checked before any round trip against the history limits
       (a plain map, at most 40 keys INCLUDING the writer's own jobRev, no array inside an array); jobRev is always the writer's
     · phCutJobChangeData builds the structured from/to for a plan or move (one change flat, several as a list; nothing moved = null)
     · phSettingsSave: null clears a saved value back to its default (the key is left out of the whole-document write); the delay
       target and the stuck limit go together; the hard PC-only rule only an owner; nothing saved or already default is refused
     · phMasterSetKind changes a master's kind and writes nothing else
     · the rules text agrees: phSettingsOk accepts an omitted key for every value field, a master update may change `kind`, and a job's
       rollsChecklist is validated only as a map
   What it does NOT prove: the real rules engine (tests/rules-emulator-ph.js runs the same writes against the real emulator) or real
   Firestore. Each "break" mutates the writer source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-write.js');
const RULES=read('firestore.rules').replace(/\r/g,'');
const H=require('./ph-data.test.js').helpers;
const J=JSON.stringify;
const AF={u:'afnan',name:'Afnan'},MU={u:'mustafa',name:'Mustafa'},UZ={u:'uzaib',name:'Uzaib'};
let tick=0;const T0=H.T0;const nx=()=>T0+(++tick)*1000;
const A=(who,extra)=>J(Object.assign({actor:who,now:nx()},extra||{}));

function mkW(src,store){
  const fk=H.makeFake({});
  Object.keys(store||{}).forEach(k=>{fk.store[k]=JSON.parse(JSON.stringify(store[k]));});
  const globals=Object.assign({},fk.api,{
    auth:{currentUser:{getIdToken:async()=>{}}},
    setTimeout:(fn,ms)=>setTimeout(fn,ms>=20000?20:ms),
    navigator:{onLine:true}
  });
  const app=harness.loadApp({files:['js/ph-core.js','js/ph-data.js'],globals});
  vm.runInContext(src,app.ctx,{filename:'ph-write.js'});
  return{app,fk,store:fk.store,log:fk.log,run:c=>app.run(c),call:c=>app.run('(async()=>{return await '+c+';})()')};
}
const JOB=(o)=>Object.assign({poId:'PO-001',status:'open',rev:2,plannedCutDate:'2026-10-20',masterId:'CM-001',masterName:'Hassan',rollsChecklist:null,note:'',createdAt:1,createdBy:'afnan',createdByName:'Afnan',updatedAt:1,updatedBy:'afnan'},o||{});
const BASE=()=>({'pos/PO-001':{id:'PO-001'},'po_cut_jobs/PO-001':JOB(),
  'cutting_masters/CM-001':{id:'CM-001',name:'Hassan',nameKey:'hassan',kind:'unset',active:true,aliases:[],notes:'',createdAt:1,createdBy:'afnan',updatedAt:1,updatedBy:'afnan'}});
const COUNTS={total:6,verified:5,short:0,missing:1,extra:1};
const hist=m=>m.log.writes.filter(w=>/^pos\/PO-001\/history\//.test(w.path));
const codes=n=>Array.from({length:n},(_,i)=>'R-'+i);

async function checks(src){
  const o={};

  /* ═══ 2. the which-rolls detail inside rollsChecklist ═══ */
  {
    const m=mkW(src,BASE());
    const r=await m.call('phSaveCutJob("PO-001",{rollsChecklist:'+J(Object.assign({},COUNTS,{missingCodes:['RB-1'],extraCodes:['STRAY-1']}))+'},'+A(UZ)+')');
    o['codes: a checklist with missingCodes and extraCodes is saved with both lists inside rollsChecklist']=r.ok===true&&J(m.store['po_cut_jobs/PO-001'].rollsChecklist.missingCodes)==='["RB-1"]'&&J(m.store['po_cut_jobs/PO-001'].rollsChecklist.extraCodes)==='["STRAY-1"]'&&m.store['po_cut_jobs/PO-001'].rollsChecklist.verified===5;
    o['codes: the job update still names only the same keys (rev, rollsChecklist, updatedAt, updatedBy): no new top-level field']=(()=>{const w=m.log.writes.filter(x=>x.path==='po_cut_jobs/PO-001')[0];return !!w&&J(Object.keys(w.data).sort())===J(['rev','rollsChecklist','updatedAt','updatedBy']);})();
    const m2=mkW(src,BASE());
    const r2=await m2.call('phSaveCutJob("PO-001",{rollsChecklist:'+J(COUNTS)+'},'+A(UZ)+')');
    o['codes: a checklist with only the five counts saves exactly as before (no code keys appear)']=r2.ok===true&&J(Object.keys(m2.store['po_cut_jobs/PO-001'].rollsChecklist).sort())===J(['extra','missing','short','total','verified']);
    const m3=mkW(src,BASE());
    const r3=await m3.call('phSaveCutJob("PO-001",{rollsChecklist:'+J(Object.assign({},COUNTS,{missingCodes:['  R-1 ','','R-1','R-2',' '],extraCodes:null}))+'},'+A(UZ)+')');
    o['codes: codes are trimmed, empty ones dropped, repeats merged; a null list is the same as none']=r3.ok===true&&J(m3.store['po_cut_jobs/PO-001'].rollsChecklist.missingCodes)==='["R-1","R-2"]'&&!('extraCodes' in m3.store['po_cut_jobs/PO-001'].rollsChecklist);
    const m4=mkW(src,BASE());
    const r4=await m4.call('phSaveCutJob("PO-001",{rollsChecklist:'+J(Object.assign({},COUNTS,{missingCodes:codes(200).map(c=>(c+'x'.repeat(40)).slice(0,40)),extraCodes:[]}))+'},'+A(UZ)+')');
    o['codes: exactly 200 codes of 40 characters are accepted (the limits are inclusive)']=r4.ok===true&&m4.store['po_cut_jobs/PO-001'].rollsChecklist.missingCodes.length===200&&m4.store['po_cut_jobs/PO-001'].rollsChecklist.missingCodes.every(c=>c.length===40);
    const bad=async(cl)=>{const m=mkW(src,BASE());const r=await m.call('phSaveCutJob("PO-001",{rollsChecklist:'+J(Object.assign({},COUNTS,cl))+'},'+A(UZ)+')');return r.ok===false&&r.code==='invalid'&&m.log.tx===0&&m.log.writes.length===0?r.error:null;};
    const e201=await bad({missingCodes:codes(201)});
    o['codes: 201 codes are refused by name, before any transaction']=/missingCodes has more than 200 codes/.test(e201||'');
    const e41=await bad({extraCodes:['x'.repeat(41)]});
    o['codes: a 41-character code is refused by name, before any transaction']=/roll code in extraCodes is longer than 40/.test(e41||'');
    const eStr=await bad({missingCodes:'R-1'});
    o['codes: a list that is not a list is refused']=/missingCodes must be a list of roll codes/.test(eStr||'');
    const eNum=await bad({extraCodes:['R-1',7]});
    o['codes: a code that is not text is refused']=/extraCodes holds something that is not text/.test(eNum||'');
    const eFrac=await bad({total:1.5});
    o['codes: the five counts are still validated (a fraction is refused)']=/total must be a whole number/.test(eFrac||'');
  }

  /* ═══ 3. opts.data on the history row ═══ */
  {
    const m=mkW(src,BASE());
    const r=await m.call('phSaveCutJob("PO-001",{plannedCutDate:"2026-10-22"},'+A(MU,{data:{field:'plannedCutDate',from:'2026-10-20',to:'2026-10-22'}})+')');
    const h=hist(m)[0];
    o['data: the history row carries the caller\'s data plus the writer\'s jobRev']=r.ok===true&&!!h&&J(h.data.data)===J({field:'plannedCutDate',from:'2026-10-20',to:'2026-10-22',jobRev:3});
    const m1=mkW(src,BASE());
    await m1.call('phSaveCutJob("PO-001",{note:"x"},'+A(MU)+')');
    o['data: without opts.data the row carries jobRev only (unchanged behaviour)']=J(hist(m1)[0].data.data)===J({jobRev:3});
    const m2=mkW(src,BASE());
    await m2.call('phSaveCutJob("PO-001",{note:"x"},'+A(MU,{data:{jobRev:99,field:'f'}})+')');
    o['data: jobRev is ALWAYS the writer\'s (a caller cannot forge the revision it points at)']=hist(m2)[0].data.data.jobRev===3&&hist(m2)[0].data.data.field==='f';
    const m3=mkW(src,BASE());
    const keys39={};for(let i=0;i<39;i++)keys39['k'+i]=i;
    const r39=await m3.call('phSaveCutJob("PO-001",{note:"x"},'+A(MU,{data:keys39})+')');
    o['data: 39 caller keys + jobRev = 40 keys is accepted (the rules\' limit is inclusive)']=r39.ok===true&&Object.keys(hist(m3)[0].data.data).length===40;
    const bad=async(d)=>{const m=mkW(src,BASE());const r=await m.call('phSaveCutJob("PO-001",{note:"x"},'+A(MU,{data:d})+')');return r.ok===false&&r.code==='invalid'&&m.log.tx===0&&m.log.writes.length===0?r.error:null;};
    const keys40={};for(let i=0;i<40;i++)keys40['k'+i]=i;
    o['data: 40 caller keys (41 with jobRev) are refused BEFORE any transaction']=/more than 40 keys/.test((await bad(keys40))||'');
    o['data: data that is not an object is refused before any transaction']=/must be an object/.test((await bad('text'))||'')&&/must be an object/.test((await bad([1,2]))||'');
    o['data: an array inside an array is refused before any transaction (Firestore refuses it)']=/array inside an array/.test((await bad({a:[[1]]}))||'');
    const m5=mkW(src,{'pos/PO-009':{id:'PO-009'}});
    const r5=await m5.call('phSaveCutJob("PO-009",{plannedCutDate:"2026-10-25"},'+A(MU,{data:{field:'plannedCutDate',from:'',to:'2026-10-25'}})+')');
    o['data: a NEW job\'s first history row (cut_job_opened) carries it too']=r5.ok===true&&r5.created===true&&J(m5.log.writes.filter(w=>/history/.test(w.path))[0].data.data)===J({field:'plannedCutDate',from:'',to:'2026-10-25',jobRev:1});
    const m6=mkW(src,BASE());
    const r6=await m6.call('phSaveCutJob("PO-001",{note:"x"},'+A(MU,{data:null})+')');
    o['data: null is the same as none']=r6.ok===true&&J(hist(m6)[0].data.data)===J({jobRev:3});
  }
  {
    const f=(p,i)=>JSON.parse(JSON.stringify(vm.runInContext('phCutJobChangeData('+J(p)+','+J(i)+')',mkW(src).app.ctx)));
    const c1=f({plannedCutDate:'2026-10-20'},{plannedCutDate:'2026-10-22'});
    o['change data: a moved day is {field, from, to}']=J(c1)===J({field:'plannedCutDate',from:'2026-10-20',to:'2026-10-22'});
    o['change data: a day cleared is to ""; a first day is from ""']=J(f({plannedCutDate:'2026-10-20'},{plannedCutDate:null}))===J({field:'plannedCutDate',from:'2026-10-20',to:''})&&J(f(null,{plannedCutDate:'2026-10-20'}))===J({field:'plannedCutDate',from:'',to:'2026-10-20'});
    o['change data: a new master is {field:master, from "CM-001 Hassan", to "CM-002 Alam"}']=J(f({masterId:'CM-001',masterName:'Hassan'},{masterId:'CM-002',masterName:'Alam'}))===J({field:'master',from:'CM-001 Hassan',to:'CM-002 Alam'});
    o['change data: two changes are {field:"plannedCutDate+master", changes:[...]} (an array of maps, never an array in an array)']=J(f({plannedCutDate:'2026-10-20',masterId:'CM-001',masterName:'Hassan'},{plannedCutDate:'2026-10-22',masterId:'CM-002',masterName:'Alam'}))===J({field:'plannedCutDate+master',changes:[{field:'plannedCutDate',from:'2026-10-20',to:'2026-10-22'},{field:'master',from:'CM-001 Hassan',to:'CM-002 Alam'}]});
    o['change data: nothing moved (same day, same master, or neither key given) is null: send no data']=f({plannedCutDate:'2026-10-20'},{plannedCutDate:'2026-10-20'})===null&&f({masterId:'CM-001',masterName:'Hassan'},{masterId:'CM-001',masterName:'Hassan'})===null&&f({plannedCutDate:'2026-10-20'},{note:'x'})===null&&f(null,null)===null;
    o['change data: a master given by id only keeps the stored name in the "from" and shows the id in the "to"']=J(f({masterId:'CM-001',masterName:'Hassan'},{masterId:'CM-002'}))===J({field:'master',from:'CM-001 Hassan',to:'CM-002 Hassan'});
    const long=f({masterId:'CM-001',masterName:'Hassan'},{masterId:null,masterName:'N'.repeat(200)});
    o['change data: from/to are cut at the history limit of 80 characters']=long.to.length===80;
  }

  /* ═══ 7. settings: clear back to default ═══ */
  {
    const SET=()=>({'ph_settings/main':{dailyCapacity:450,delayTargetDays:5,stuckDays:20,grossOverTolPct:4.5,cutGate:[75,125],offWeekdays:[0,6],skipDays:['2026-10-31'],pcOnlyHard:true,rev:4,updatedAt:1,updatedBy:'afnan'}});
    const m=mkW(src,SET());
    const r=await m.call('phSettingsSave({dailyCapacity:null},'+A(MU)+')');
    const d=m.store['ph_settings/main'];
    o['clear: null removes the key from the saved document; every other value and pcOnlyHard stay; the revision moves']=r.ok===true&&!('dailyCapacity' in d)&&d.grossOverTolPct===4.5&&J(d.cutGate)===J([75,125])&&d.pcOnlyHard===true&&d.rev===5&&d.updatedBy==='mustafa';
    o['clear: it is a whole-document write (set), one transaction, to ph_settings/main only, nothing deleted']=m.log.writes.length===1&&m.log.writes[0].op==='set'&&m.log.writes[0].path==='ph_settings/main'&&m.log.deletes===0&&m.log.tx===1;
    o['clear: the result\'s settings object has no such key (the screen reads the default again)']=!('dailyCapacity' in r.settings)&&r.settings.rev===5;
    o['clear: the data layer resolves the cleared value to the default (400)']=m.run('phSettings('+J(d)+').dailyCapacity')===400;
    const m2=mkW(src,SET());
    const r2=await m2.call('phSettingsSave({delayTargetDays:null,stuckDays:null},'+A(MU)+')');
    o['clear: the delay target and the stuck limit cleared together work']=r2.ok===true&&!('delayTargetDays' in m2.store['ph_settings/main'])&&!('stuckDays' in m2.store['ph_settings/main'])&&m2.store['ph_settings/main'].dailyCapacity===450;
    const m3=mkW(src,SET());
    const r3=await m3.call('phSettingsSave({stuckDays:null},'+A(MU)+')');
    o['clear: clearing ONE of the pair is refused by name, before any transaction, nothing written']=r3.ok===false&&r3.code==='invalid'&&/clear both or neither/.test(r3.error)&&m3.log.tx===0&&m3.log.writes.length===0;
    const m3b=mkW(src,SET());
    const r3b=await m3b.call('phSettingsSave({delayTargetDays:null,stuckDays:30},'+A(MU)+')');
    o['clear: clearing one of the pair while setting the other is refused too']=r3b.ok===false&&/clear both or neither/.test(r3b.error)&&m3b.log.writes.length===0;
    const m4=mkW(src,SET());
    const r4=await m4.call('phSettingsSave({pcOnlyHard:null},'+A(MU)+')');
    o['clear: a manager cannot clear the hard PC-only rule (owner only), nothing written']=r4.ok===false&&r4.code==='forbidden'&&m4.log.tx===0&&m4.store['ph_settings/main'].pcOnlyHard===true;
    const r4b=await m4.call('phSettingsSave({pcOnlyHard:null},'+A(AF)+')');
    o['clear: an owner can; the key is gone']=r4b.ok===true&&!('pcOnlyHard' in m4.store['ph_settings/main'])&&m4.store['ph_settings/main'].dailyCapacity===450;
    const m5=mkW(src,SET());
    const r5=await m5.call('phSettingsSave({dailyCapacity:500,grossOverTolPct:null},'+A(MU)+')');
    o['clear: setting one value and clearing another in one save works']=r5.ok===true&&m5.store['ph_settings/main'].dailyCapacity===500&&!('grossOverTolPct' in m5.store['ph_settings/main']);
    const m6=mkW(src,{});
    const r6=await m6.call('phSettingsSave({dailyCapacity:null},'+A(MU)+')');
    o['clear: with nothing saved yet there is nothing to clear (refused, no document created)']=r6.ok===false&&/Nothing has been saved yet/.test(r6.error)&&m6.log.writes.length===0;
    const m7=mkW(src,SET());
    const r7=await m7.call('phSettingsSave({grossUnderTolPct:null},'+A(MU)+')');
    o['clear: a value that has no saved value is refused as already the default, nothing written']=r7.ok===false&&/Nothing to clear: grossUnderTolPct has no saved value/.test(r7.error)&&m7.log.writes.length===0;
    const r8=await m7.call('phSettingsSave({colour:null},'+A(MU)+')');
    o['clear: an unknown setting is still refused by name even as null']=r8.ok===false&&r8.code==='invalid'&&/Not a Production Ops setting: colour/.test(r8.error);
    const m9=mkW(src,SET());
    const r9=await m9.call('phSettingsSave({dailyCapacity:null},'+A(MU,{expectedRev:2})+')');
    o['clear: a stale revision is refused (nothing cleared)']=r9.ok===false&&r9.code==='stale'&&m9.store['ph_settings/main'].dailyCapacity===450;
    const m10=mkW(src,SET());
    const r10=await m10.call('phSettingsSave({dailyCapacity:null},'+A(UZ)+')');
    o['clear: the cutting floor (Kashif) cannot clear anything']=r10.ok===false&&r10.code==='forbidden'&&m10.log.tx===0;
    const m11=mkW(src,SET());
    const r11=await m11.call('phSettingsSave({dailyCapacity:0},'+A(MU)+')');
    o['clear: an ordinary bad value is still refused (0 capacity), the clear path did not loosen validation']=r11.ok===false&&r11.code==='invalid'&&m11.store['ph_settings/main'].dailyCapacity===450;
  }

  /* ═══ 7. a master's kind ═══ */
  {
    const m=mkW(src,BASE());
    const r=await m.call('phMasterSetKind("CM-001","outsource",'+A(MU)+')');
    const w=m.log.writes[0];
    o['kind: a manager sets the kind; the update names kind, updatedAt, updatedBy only']=r.ok===true&&m.store['cutting_masters/CM-001'].kind==='outsource'&&m.log.writes.length===1&&w.op==='update'&&w.path==='cutting_masters/CM-001'&&J(Object.keys(w.data).sort())===J(['kind','updatedAt','updatedBy'])&&w.data.updatedBy==='mustafa';
    o['kind: name, key, aliases and active are untouched']=m.store['cutting_masters/CM-001'].name==='Hassan'&&m.store['cutting_masters/CM-001'].nameKey==='hassan'&&m.store['cutting_masters/CM-001'].active===true;
    const r2=await m.call('phMasterSetKind("CM-001","outsource",'+A(MU)+')');
    o['kind: the kind it already has is refused by name, nothing written']=r2.ok===false&&r2.code==='refused'&&/already outsource/.test(r2.error)&&m.log.writes.length===1;
    const tx0=m.log.tx;
    const r3=await m.call('phMasterSetKind("CM-001","freelance",'+A(MU)+')');
    o['kind: a kind outside inhouse / outsource / unset is refused, before any transaction']=r3.ok===false&&r3.code==='invalid'&&m.log.tx===tx0;
    const r4=await m.call('phMasterSetKind("CM-001","inhouse",'+A(UZ)+')');
    o['kind: the cutting floor (Kashif) cannot']=r4.ok===false&&r4.code==='forbidden'&&m.store['cutting_masters/CM-001'].kind==='outsource';
    const r5=await m.call('phMasterSetKind("CM-404","inhouse",'+A(MU)+')');
    o['kind: a master that does not exist is refused']=r5.ok===false&&r5.code==='missing';
    const r6=await m.call('phMasterSetKind("not-an-id","inhouse",'+A(MU)+')');
    o['kind: an id that is not CM-nnn is refused']=r6.ok===false&&r6.code==='invalid';
  }

  /* ═══ the rules text agrees (no rule change is needed) ═══ */
  {
    const fn=(name)=>{const i=RULES.indexOf('function '+name+'(');let d=0,j=RULES.indexOf('{',i),s=j;for(;j<RULES.length;j++){if(RULES[j]==='{')d++;else if(RULES[j]==='}'){d--;if(d===0)break;}}return RULES.slice(s,j+1);};
    const body=fn('phSettingsOk');
    const vals=['dailyCapacity','skipDays','offWeekdays','delayTargetDays','stuckDays','grossOverTolPct','grossUnderTolPct','cutGate','pcOnlyHard'];
    o['rules: phSettingsOk accepts an OMITTED key for every value field (so a cleared key is legal)']=vals.every(k=>body.indexOf("!('"+k+"' in d)")>-1);
    o['rules: beside the values phSettingsOk asks only for a number updatedAt and a legal updatedBy']=body.indexOf("d.get('updatedAt', null) is number")>-1&&body.indexOf("phBy(d.get('updatedBy', ''))")>-1;
    const upd=RULES.slice(RULES.indexOf('match /cutting_masters/'));
    o['rules: a cutting_masters update may change `kind` (and only the listed keys), to inhouse / outsource / unset']=/affectedKeys\(\)\s*\.hasOnly\(\[[^\]]*'kind'[^\]]*\]\)/.test(upd.slice(0,2500))&&/kind', ''\) in \['inhouse','outsource','unset'\]/.test(upd.slice(0,2500));
    const jb=fn('phJobShapeOk');
    o['rules: a job\'s rollsChecklist is validated only as a map (no key list, no size), so the code lists need no rule change']=/d\.get\('rollsChecklist', null\) == null \|\| d\.rollsChecklist is map/.test(jb)&&!/rollsChecklist\.(keys|size|diff)/.test(RULES);
    o['rules: the history data must be a map of at most 40 keys (jobRev + 39 caller keys is the writer\'s limit)']=/d\.get\('data', \{\}\) is map && d\.get\('data', \{\}\)\.keys\(\)\.size\(\) <= 40/.test(RULES);
  }
  return o;
}

module.exports=async function(){
  const s=suite('ph-open-items');
  const base=await checks(SRC);
  s.section('production ops open items - the writer');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));

  s.section('deliberate breaks - each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const pairs=Array.isArray(from)?from:[[from,to]];
    let mut=SRC;
    for(const [f,t] of pairs){
      if(mut.split(f).length-1<1){s.ok('break target exists: '+label+' ('+f.slice(0,50)+')',false);return;}
      mut=mut.split(f).join(t);
    }
    let r;try{r=await checks(mut);}catch(e){r={};}
    failing.forEach(f=>{
      if(!(f in base)){s.ok('break "'+label+'": the named check exists ('+f.slice(0,50)+')',false);return;}
      broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);
    });
  };
  const K=prefix=>Object.keys(base).filter(k=>k.indexOf(prefix)===0);
  await brk('the code lists are dropped',"    out[k]=l.value;\n  }\n  return{value:out};","  }\n  return{value:out};",['codes: a checklist with missingCodes and extraCodes is saved with both lists inside rollsChecklist']);
  await brk('the code count limit is gone',"if(out.length>PH_CODES_MAX)return","if(false)return",['codes: 201 codes are refused by name, before any transaction']);
  await brk('the code length limit is gone',"if(t.length>PH_CODE_LEN_MAX)return","if(false)return",['codes: a 41-character code is refused by name, before any transaction']);
  await brk('a non-text code is kept',"if(typeof x[i]!=='string')return","if(false)return",['codes: a code that is not text is refused']);
  await brk('repeats are kept',"if(seen[t])continue;","",['codes: codes are trimmed, empty ones dropped, repeats merged; a null list is the same as none']);
  await brk('empty codes are kept',"if(!t)continue;","",['codes: codes are trimmed, empty ones dropped, repeats merged; a null list is the same as none']);
  await brk('the limit is exclusive',"if(out.length>PH_CODES_MAX)return","if(out.length>=PH_CODES_MAX)return",['codes: exactly 200 codes of 40 characters are accepted (the limits are inclusive)']);
  await brk('opts.data is ignored',"data:Object.assign({},extraData,{jobRev:saved.rev})","data:{jobRev:saved.rev}",K('data: the history row carries'));
  await brk('a caller can forge jobRev',"data:Object.assign({},extraData,{jobRev:saved.rev})","data:Object.assign({jobRev:saved.rev},extraData)",['data: jobRev is ALWAYS the writer\'s (a caller cannot forge the revision it points at)']);
  await brk('the data is not checked before the round trip',"    if(t.error)return _phFail('invalid',t.error);\n    extraData=o.data;","    extraData=o.data;",['data: 40 caller keys (41 with jobRev) are refused BEFORE any transaction','data: an array inside an array is refused before any transaction (Firestore refuses it)']);
  await brk('the data object check is gone',"    if(!_phIsObj(o.data))return _phFail('invalid','The history data must be an object.');","",['data: data that is not an object is refused before any transaction']);
  await brk('change data reports a no-op',"    if(f!==t)ch.push({field:'plannedCutDate',from:f,to:t});","    ch.push({field:'plannedCutDate',from:f,to:t});",['change data: nothing moved (same day, same master, or neither key given) is null: send no data']);
  await brk('the master label is not capped',"return _phStr([id||'',name||''].join(' ').trim(),PH_HISTORY_FT_MAX);","return[id||'',name||''].join(' ').trim();",['change data: from/to are cut at the history limit of 80 characters']);
  await brk('two changes are flattened to the first',"  return{field:ch.map(function(c){return c.field;}).join('+'),changes:ch};","  return{field:ch[0].field,from:ch[0].from,to:ch[0].to};",['change data: two changes are {field:"plannedCutDate+master", changes:[...]} (an array of maps, never an array in an array)']);
  await brk('null is stored as a value',"if(patch[k]===null)delete merged[k];else merged[k]=patch[k];","merged[k]=patch[k];",['clear: null removes the key from the saved document; every other value and pcOnlyHard stay; the revision moves']);
  await brk('a half pair is allowed (no pre-check)',"  if((patch.delayTargetDays===null)!==(patch.stuckDays===null))\n    return _phFail('invalid','The delay target and the stuck limit go back to their defaults together: clear both or neither.');\n","",['clear: clearing ONE of the pair is refused by name, before any transaction, nothing written','clear: clearing one of the pair while setting the other is refused too']);
  await brk('a manager can clear pcOnlyHard',"    if(!phIsOwner(a.u))return _phFail('forbidden','Only an owner can switch the hard PC-only rule.');","",['clear: a manager cannot clear the hard PC-only rule (owner only), nothing written']);
  await brk('nothing-saved is not refused',"          if(!prev)throw _phRefuse('refused','Nothing has been saved yet, so there is nothing to put back to its default.');","",['clear: with nothing saved yet there is nothing to clear (refused, no document created)']);
  await brk('an already-default clear writes anyway',"          if(clearing.every(function(k){return!(k in prev);}))throw","          if(false)throw",['clear: a value that has no saved value is refused as already the default, nothing written']);
  await brk('the kind is not validated',"  if(PH_MASTER_KINDS.indexOf(kind)<0)return Promise.resolve(_phFail('invalid','The kind must be inhouse, outsource or unset.'));","",['kind: a kind outside inhouse / outsource / unset is refused, before any transaction']);
  await brk('the same kind is rewritten',"    if((prev.kind||'unset')===kind)return{refuse:{code:'refused',error:'Cutting master '+id+' is already '+kind+'.'}};","",['kind: the kind it already has is refused by name, nothing written']);
  await brk('the kind update also touches the name',"return{patch:{kind:kind,updatedAt:ctx.now,updatedBy:ctx.u}};","return{patch:{kind:kind,name:prev.name,updatedAt:ctx.now,updatedBy:ctx.u}};",['kind: a manager sets the kind; the update names kind, updatedAt, updatedBy only']);
  s.ok('breaks run: '+broken,broken>=20,String(broken));
  return s;
};

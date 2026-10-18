/* The PO Registry's pure core (js/por-core.js, RG1). Hand-worked fixtures, today = 15 Oct 2026 12:00 PKT:
   every age, step count, need and view count below was worked out by hand from the dates in the fixture
   (the arithmetic is written beside each assertion). It runs the core twice: alone (its own copies of the
   id/stage rules) and with the real js/ph-core.js loaded (the rules it defers to), and holds the copies equal.
   Then each guard is reverted once in a copy of the source and a named assertion must fail.
   Logic only: no Firestore, no screen. */
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {loadApp,suite,ROOT}=require('./harness');
const SRC=fs.readFileSync(path.join(ROOT,'js/por-core.js'),'utf8');
const PHCORE=fs.readFileSync(path.join(ROOT,'js/ph-core.js'),'utf8');
const J=v=>JSON.stringify(v);

const NOW=Date.parse('2026-10-15T12:00:00+05:00');
// The fixture (shapes from the live survey: releasedAt as an ISO string and as a number, poStatus absent, gate passes in three spellings).
const POS=[
  {fbKey:'PO-140',id:'PO-140',name:'RAW CITY POLO',code:'GP098',fabric:'Pique',createdBy:'Afnan',ts:Date.parse('2026-08-20T10:00:00+05:00'),createdAt:'2026-08-20',
    poStatus:'in_production',currentStage:'cutting',releasedAt:'2026-08-20T09:00:00.000Z',qty:120,sizes:{XS:0,S:20,M:40,L:40,XL:20,'2XL':0},imgFront:'https://res.cloudinary.com/x/a.jpg'},
  {fbKey:'PO-061',id:'PO-061',name:'Legacy Tee',code:'GB001',fabric:'Jersey',createdBy:'Mustafa',ts:Date.parse('2026-08-10T10:00:00+05:00'),createdAt:'2026-08-10',
    poStatus:'reserved',currentStage:null,qty:60,sizes:{S:20,M:20,L:20},imgFront:'https://res.cloudinary.com/x/b.jpg'},
  {fbKey:'PO-125',id:'PO-125',name:'Athletic Tee | Black',code:'GAT012',fabric:'Single Jersey 180',createdBy:'Mustafa',ts:Date.parse('2026-09-05T10:00:00+05:00'),createdAt:'2026-09-05',
    poStatus:'in_production',currentStage:'stitching',releasedAt:'2026-09-05T08:00:00.000Z',qty:120,sizes:{XS:0,S:20,M:40,L:40,XL:20,'2XL':0},
    cutAt:'2026-09-09T06:00:00.000Z',cutQty:{XS:0,S:20,M:39,L:40,XL:20,'2XL':0},
    stages:{cutting:{done:true,doneAt:'2026-09-09T06:00:00.000Z'},bundling:{done:true,doneAt:'2026-09-14T06:00:00.000Z'}},
    packingReceipts:[{size:'S',qty:20},{size:'M',qty:35}],imgFront:'https://res.cloudinary.com/x/c.jpg'},
  {fbKey:'PO-152',id:'PO-152',name:'MF Shorts - Arctyc White',code:'GSO015',fabric:'Terry',createdBy:'Afnan',ts:Date.parse('2026-10-12T10:00:00+05:00'),createdAt:'2026-10-12',
    poStatus:'in_production',currentStage:'cutting',releasedAt:Date.parse('2026-10-12T10:00:00+05:00'),qty:100,sizes:{S:30,M:30,L:30},imgFront:'https://res.cloudinary.com/x/d.jpg'},
  {fbKey:'PO-160',id:'PO-160',name:'Cancelled Hoodie',code:'GHZ004',createdBy:'Afnan',ts:Date.parse('2026-09-01T10:00:00+05:00'),createdAt:'2026-09-01',
    poStatus:'cancelled',currentStage:null,cancelledAt:'2026-09-11T07:00:00.000Z',cancelledBy:'Afnan',cancelledReason:'wrong fabric',qty:50,sizes:{M:50},imgFront:'https://res.cloudinary.com/x/e.jpg'},
  {fbKey:'PO-170',id:'PO-170',name:'No Status PO',code:'GST001',createdBy:'Afnan',ts:Date.parse('2026-10-14T10:00:00+05:00'),createdAt:'2026-10-14',
    currentStage:'cutting',qty:10,sizes:{M:10}}
];
const PASSES=[
  {id:'GP-312',gpType:'fabric',poId:'125',date:'2026-09-07',cutMaster:'Alam',totalWeight:40.1},
  {id:'GP-313',gpType:'fabric',poId:'PO-125',date:'2026-09-08',cutMaster:'Alam',totalWeight:6},
  {id:'GP-314',gpType:'fabric',poId:'Sample',date:'2026-09-08'},
  {id:'GP-315',gpType:'fabric',poId:'152',date:'2026-10-13',cutMaster:'Hassan',totalWeight:30},
  {id:'GP-316',gpType:'process',poId:'140',date:'2026-09-01'}
];
const MARKS=[{fbKey:'PO-125',marks:{hold:{reason:'waiting for rib'}}}];

function loadCore(src,withPh){
  const ctx={console,Date,Math,JSON,Set,Map,Object,Array,String,Number,RegExp,Error,isFinite,parseInt,parseFloat};
  vm.createContext(ctx);
  if(withPh)vm.runInContext(PHCORE,ctx,{filename:'ph-core.js'});
  vm.runInContext(src.replace(/if\(typeof module[\s\S]*$/,''),ctx,{filename:'por-core.js'});
  return code=>vm.runInContext(code,ctx);
}
function modelOf(run,opts){
  const o=Object.assign({passes:PASSES,marks:MARKS},opts||{});
  run('var __idx=porIndex('+J(o)+');');
  return run('porModel('+J(POS)+',__idx,{now:'+NOW+'})');
}
const byId=(m,id)=>m.rows.filter(r=>r.id===id)[0];

// The guarded assertions: each returns true when the rule holds. The revert section reruns them on a mutated source.
function checks(run){
  const m=modelOf(run);
  const unread=modelOf(run,{passes:null,marks:null});
  return{
    'a pass spelt 125 is on PO-125':byId(m,'PO-125').fabric.state==='issued'&&byId(m,'PO-125').fabric.passes.length===2,
    'a reserved PO is never stuck':byId(m,'PO-061').needs.indexOf('stuck')<0,
    'unread fabric is never "none"':byId(unread,'PO-140').fabric.state==='unread'&&byId(unread,'PO-140').needs.indexOf('no_fabric')<0,
    'search AND view combine':run('porSelect(porModel('+J(POS)+',porIndex({}),{now:'+NOW+'}),{view:"cancelled",q:"polo"}).length')===0,
    'nulls sort last':(()=>{const r=run('porSort([{ts:null,id:"a"},{ts:5,id:"b"},{ts:9,id:"c"}],"newest").map(function(x){return x.id;}).join("")');return r==='cba';})(),
    'a hold takes the PO out of stuck':byId(m,'PO-125').needs.indexOf('stuck')<0&&byId(m,'PO-125').needs.indexOf('hold')>=0,
    'the age at cutting starts from the first fabric issue':byId(m,'PO-152').age.since==='fabric'&&byId(m,'PO-152').age.days===2,
    'the size table always has 2XL':run('porSizeTable({sizes:{S:1}},null).sizes').indexOf('2XL')>=0
  };
}

module.exports=async function(){
  const s=suite('por-core');

  for(const withPh of [false,true]){
    const run=loadCore(SRC,withPh);
    const tag=withPh?' (with ph-core)':' (alone)';
    const m=modelOf(run);

    s.section('PO-140: at cutting, released 20 Aug, no fabric pass'+tag);
    const a=byId(m,'PO-140');
    s.eq('stage cutting',a.stage,'cutting');
    s.eq('20 Aug -> 15 Oct = 11 + 30 + 15 = 56 days since release',a.age.words,'56 days since release');
    s.eq('needs: fabric not issued (56 >= 7) and stuck (56 >= 7)',J(a.needs),J(['no_fabric','stuck']));
    s.eq('progress: created + released = 2 of 7',a.progress.done+'/'+a.progress.of,'2/7');
    s.eq('cut not recorded is null, never 0',a.cut,null);
    s.eq('received not recorded is null',a.received,null);
    s.ok('a process gate pass (not fabric) is not counted as fabric',a.fabric.state==='none');

    s.section('PO-061: legacy reserved, created 10 Aug'+tag);
    const b=byId(m,'PO-061');
    s.eq('stage reserved',b.stage,'reserved');
    s.eq('10 Aug -> 15 Oct = 21 + 30 + 15 = 66 days, never released',b.age.words,'created 66 days ago · not released');
    s.eq('needs nothing (reserved is never stuck or short of fabric)',J(b.needs),'[]');
    s.eq('progress: created only',b.progress.done,1);

    s.section('PO-125: stitching, cut 119 of 120, two passes in two spellings, on hold'+tag);
    const c=byId(m,'PO-125');
    s.eq('stage stitching',c.stage,'stitching');
    s.eq('cut = 20 + 39 + 40 + 20 = 119',c.cut,119);
    s.eq('received = 20 + 35 = 55',c.received,55);
    s.eq('the passes spelt "125" and "PO-125" both index under PO-125 (2 passes, first 7 Sep, master Alam)',[c.fabric.passes.length,c.fabric.day,c.fabric.master].join('|'),'2|2026-09-07|Alam');
    s.eq('fabric weight 40.1 + 6 = 46.1',c.fabric.weight,46.1);
    s.eq('entered stitching when bundling was done (14 Sep): 16 + 15 = 31 days',c.age.words,'31 days at stitching');
    s.eq('needs: on hold only (a hold takes it out of stuck)',J(c.needs),J(['hold']));
    s.eq('progress: created, released, fabric, cut, bundled = 5 of 7',c.progress.done,5);
    s.eq('the hold reason is carried',c.mark.hold.reason,'waiting for rib');

    s.section('PO-152: releasedAt is a NUMBER; fabric issued 13 Oct; qty 100 but sizes add to 90'+tag);
    const d=byId(m,'PO-152');
    s.eq('releasedAt read as a number',d.releasedType,'number');
    s.eq('age from the fabric issue (13 Oct -> 15 Oct = 2 days)',d.age.words,'2 days since fabric issue');
    s.eq('needs: qty ≠ sizes only (2 < 7 days)',J(d.needs),J(['qty_mismatch']));
    s.eq('ordered is qty (100), sizes add to 90',d.ordered+'/'+d.sizesSum,'100/90');

    s.section('PO-160 cancelled and PO-170 with no poStatus'+tag);
    const e=byId(m,'PO-160');
    s.eq('cancelled',e.stage,'cancelled');
    s.eq('cancelled day and reason carried',e.age.words+'|'+e.cancelled.reason,'cancelled 2026-09-11|wrong fabric');
    s.eq('cancelled needs nothing',J(e.needs),'[]');
    const f=byId(m,'PO-170');
    s.eq('no poStatus, currentStage cutting -> cutting',f.stage,'cutting');
    s.ok('no release date: dated from creation, never judged stuck',f.age.since==='created'&&f.needs.indexOf('stuck')<0,J(f.age));
    s.ok('no photo is said',f.needs.indexOf('no_photo')>=0);

    s.section('views'+tag);
    const want={active:5,attention:4,cutting:3,finishing:1,done:0,cancelled:1,all:6};
    // active: 140, 061, 125, 152, 170 (not the cancelled 160) = 5; attention: 140 (no_fabric, stuck), 125 (hold), 152 (qty), 170 (no photo) = 4;
    // cutting: 140, 152, 170 = 3; finishing: 125 (stitching) = 1; done 0; cancelled 160 = 1; all 6.
    s.eq('view counts',J(m.counts),J(want));
    s.eq('one junk pass ("Sample")',m.junkPasses,1);
    const all=run('porSelect(porModel('+J(POS)+',porIndex('+J({passes:PASSES,marks:MARKS})+'),{now:'+NOW+'}),{view:"all",sort:"newest"}).map(function(r){return r.id;})');
    s.eq('All: newest first, cancelled last',all.join(','),'PO-170,PO-152,PO-125,PO-140,PO-061,PO-160');
    const age=run('porSelect(porModel('+J(POS)+',porIndex('+J({passes:PASSES,marks:MARKS})+'),{now:'+NOW+'}),{view:"active",sort:"age"}).map(function(r){return r.id;})');
    // ages: 061 66, 140 56, 125 31, 152 2, 170 1 (14 Oct -> 15 Oct)
    s.eq('Active, oldest at this stage first',age.join(','),'PO-061,PO-140,PO-125,PO-152,PO-170');
    s.eq('search: "125" finds PO-125 by its digits',run('porSelect(porModel('+J(POS)+',porIndex({}),{now:'+NOW+'}),{view:"all",q:"125"}).length'),1);
    s.eq('search: code and creator, all words must match ("mustafa gat")',run('porSelect(porModel('+J(POS)+',porIndex({}),{now:'+NOW+'}),{view:"all",q:"mustafa gat"}).map(function(r){return r.id;}).join()'),'PO-125');

    s.ok('a release AFTER now (a clock behind the data) gives no age, never a negative one',run('porAge({stage:"cutting",fabric:{firstMs:null},releaseMs:'+(NOW+3*86400000)+'},'+NOW+').days')===null);
    s.section('unread side data'+tag);
    const u=modelOf(run,{passes:null,marks:null});
    s.eq('fabric unread when gatepasses were not read',byId(u,'PO-140').fabric.state,'unread');
    s.eq('marks unread when po_marks were not read',byId(u,'PO-125').mark.state,'unread');
    s.ok('unread passes give no "fabric not issued" (only stuck, from release)',J(byId(u,'PO-140').needs)===J(['stuck']),J(byId(u,'PO-140').needs));
    s.ok('a not-read delay plan says unread',run('porDelay({job:"unread"},{}).state')==='unread');

    s.section('group by'+tag);
    const g=run('porGroup(porModel('+J(POS)+',porIndex({}),{now:'+NOW+'}).rows,"stage").map(function(x){return x.key+":"+x.rows.length+(x.collapsed?"c":"");})');
    s.eq('stage groups in the real order; reserved and cancelled collapsed',g.join(','),'cutting:3,stitching:1,reserved:1c,cancelled:1c');
    const mo=run('porGroup(porModel('+J(POS)+',porIndex({}),{now:'+NOW+'}).rows,"month").map(function(x){return x.label+":"+x.ordered;})');
    s.eq('month groups, newest first, pieces ordered (Oct 100+10, Sep 120+50, Aug 120+60)',mo.join(','),'Oct 2026:110,Sep 2026:170,Aug 2026:180');

    s.section('the size table'+tag);
    const t=run('porSizeTable('+J(Object.assign({},POS[2],{cutQty:Object.assign({},POS[2].cutQty,{XXL:1})}))+','+J([{size:'S',units:20,stitchingDone:true},{size:'M',units:39,stitchingDone:true},{size:'L',units:40}])+')');
    s.eq('the six sizes in order, plus a size the PO carries outside them',t.sizes.join(','),'XS,S,M,L,XL,2XL,XXL');
    s.eq('cut total 119 + 1 = 120',t.cut.total,120);
    s.eq('stitched: S 20 + M 39 = 59',t.stitched.total,59);
    s.eq('received S 20, M 35',t.received.S+'/'+t.received.M,'20/35');
    s.ok('a PO with no cut has no cut row (null, not zeros)',run('porSizeTable({sizes:{S:3}},null).cut')===null);

    s.section('the guards'+tag);
    const ck=checks(run);
    Object.keys(ck).forEach(k=>s.ok(k,ck[k]===true));
  }

  s.section('the own copies equal ph-core');
  {
    const ph=loadCore(SRC,true);
    const ins=['PO-125','125','po-0125',' PO 125 ','PO_125',125,'Sample','',null,'538','0','PO-1','abc12','9999999999'];
    const bad=ins.filter(x=>ph('_porKeyOwn('+J(x)+')')!==ph('phPoKey('+J(x)+')'));
    s.ok('_porKeyOwn === phPoKey on '+ins.length+' spellings',bad.length===0,J(bad));
    const st=[{poStatus:'cancelled'},{poStatus:'complete'},{currentStage:'completed'},{currentStage:'qc'},{currentStage:'odd'},{},{poStatus:'reserved'},{poStatus:'weird'},{poStatus:'in_production',currentStage:'bundling'}];
    const bs=st.filter(x=>ph('_porStageOwn('+J(x)+')')!==ph('phStageOf('+J(x)+')'));
    s.ok('_porStageOwn === phStageOf on '+st.length+' documents',bs.length===0,J(bs));
    const ms=['2026-08-20T09:00:00.000Z','2026-08-20',1786000000000,'2026-08-20T09:00:00',{seconds:1786000000}];
    const bm=ms.filter(x=>ph('_porMsOwn('+J(x)+')')!==ph('phMs('+J(x)+')'));
    s.ok('_porMsOwn === phMs on '+ms.length+' stamps',bm.length===0,J(bm));
  }

  s.section('deliberate reverts: each guard, undone once, fails by name');
  const REVERTS=[
    ['porKey bypassed in the pass index','a pass spelt 125 is on PO-125',"const k=porKey(_porPassPo(g));","const k=_porStr(_porPassPo(g));"],
    ['reserved and creation-dated ages judged stuck','a reserved PO is never stuck',"  if(live&&!held&&F.stage!=='unknown'){","  if(!held){",
      "if(age.days!==null&&age.days>=sd&&(age.since==='fabric'||age.since==='release'||age.since==='stage'))out.add('stuck');","if(age.days!==null&&age.days>=sd)out.add('stuck');"],
    ['unread gate passes treated as "no fabric"','unread fabric is never "none"',"if(!X.passesOk)fabric={state:'unread'","if(false)fabric={state:'unread'"],
    ['the view dropped from the search','search AND view combine',"porViewOf(S.view||'active',f)&&porMatches","porMatches"],
    ['nulls sorted first','nulls sort last',"if(xn)return 1;if(yn)return-1;","if(xn)return-1;if(yn)return 1;"],
    ['a hold no longer suspends stuck','a hold takes the PO out of stuck',"if(live&&!held&&F.stage!=='unknown'){","if(live&&F.stage!=='unknown'){"],
    ['the cutting age from release only','the age at cutting starts from the first fabric issue',"if(F.fabric&&F.fabric.firstMs!=null){","if(false){"],
    ['2XL dropped from the size table','the size table always has 2XL',"const sizes=POR_SIZES.concat(extra);","const sizes=POR_SIZES.slice(0,5).concat(extra);"]
  ];
  for(const r of REVERTS){
    let src=SRC,landed=true;
    for(let i=2;i<r.length;i+=2){if(src.indexOf(r[i])<0)landed=false;src=src.split(r[i]).join(r[i+1]);}
    if(!landed){s.ok('revert "'+r[0]+'" landed in the source',false);continue;}
    let ck;try{ck=checks(loadCore(src,true));}catch(e){ck={};}
    s.ok('revert "'+r[0]+'" fails "'+r[1]+'"',ck[r[1]]!==true);
  }

  s.section('wiring');
  {
    const IX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),SW=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
    s.ok('index.html loads js/por-core.js once, after po-print.js',IX.split('/js/por-core.js?v=').length===2&&IX.indexOf('/js/por-core.js?v=')>IX.indexOf('/js/po-print.js?v='));
    s.ok('sw.js precaches js/por-core.js once',SW.split("'/js/por-core.js'").length===2);
    const names=[];SRC.replace(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm,(x,n)=>names.push(n));
    s.ok('every top-level name is por/_por/POR_ prefixed ('+names.length+')',names.length>10&&names.every(n=>/^(por|_por|POR_|_POR_)/.test(n)),J(names.filter(n=>!/^(por|_por|POR_|_POR_)/.test(n))));
    const others=fs.readdirSync(path.join(ROOT,'js')).filter(f=>f.endsWith('.js')&&f!=='por-core.js'&&f!=='po-registry.js').map(f=>fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n');
    const clash=names.filter(n=>new RegExp('^(?:const|let|var|function)\\s+'+n.replace(/\$/g,'\\$')+'\\b','m').test(others));
    s.ok('no other js file declares the same top-level names',clash.length===0,J(clash));
    s.ok('pure: no document, window, db, Date.now or session in the core',!/\bdocument\.|\bwindow\.|\bdb\b|Date\.now\(|\bsession\b/.test(SRC.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'')));
    const L=loadApp({files:['js/ph-core.js','js/por-core.js']});
    s.ok('loads in the app sandbox with ph-core beside it',L.run('typeof porModel')==='function');
  }
  return s;
};

/* Production Ops ▸ Today's Cutting (12 Oct 2026): js/ph-mod-cutting.js and its wiring (index.html, sw.js, css/main.css).

   What this drives -- the REAL handlers, over the REAL js/ph-core.js + ph-data.js + ph-write.js + ph-ui.js, against tests/ph-dom.js's small
   real DOM and a fake Firestore whose runTransaction really is atomic (nothing lands unless the callback finishes) and records every write:
     · the day split (PKT, never UTC), today's jobs vs the overdue list, the roll checklist from the PO's fabric issue (gate passes: groups,
       rib, outward passes ignored, units never mixed), the verdict (a mismatch is FLAGGED and SAVED, never blocked), the weight tolerance
     · the scan field (Enter, Tab, the Add button), unknown / duplicate / mixed-case codes, tap to tick, count-only mode
     · the two writes -- Save roll check, Mark complete -- each ONE transaction through phSaveCutJob (job update + pos history row), nothing else
     · Uzaib (floor) vs the managers; Record the cut calls the EXISTING cutting screen and writes nothing; a hostile string stays text
     · honest states: a failed jobs / PO / gate-pass read is said by name and never drawn as "no jobs" or "no rolls"
   What it does NOT prove: geometry (the harness has no layout -- tests/smoke-layout.js's 'production ops — todays cutting' fragments hold that
   in real Chromium), the real Firestore SDK, a barcode scanner, or anything on a real phone. Each "break" mutates the source and requires the
   named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-cutting.js');
const UI=read('js/ph-ui.js');
const CSS=read('css/main.css');
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'}
};
// 20:00 UTC on 12 Oct is 01:00 PKT on 13 Oct: the UTC day and the PKT day differ, so a UTC "today" is caught.
const FIXED=Date.UTC(2026,9,12,20,0,0);
class FixedDate extends Date{constructor(...a){if(a.length)super(...a);else super(FIXED);}static now(){return FIXED;}}
const TODAY='2026-10-13',YEST='2026-10-12',OLD='2026-10-09';

const job=(id,o)=>Object.assign({id,poId:id,status:'open',rev:2,plannedCutDate:TODAY,masterId:'CM-001',masterName:'Hassan',plannedFabric:{qty:102.4,unit:'kg',note:''},rollsChecklist:null,note:'',createdAt:1,createdBy:'afnan',createdByName:'Afnan',updatedAt:1,updatedBy:'afnan'},o||{});
const po=(id,o)=>Object.assign({id,name:'Effortless Tee',code:'GST073',qty:240,sizes:{XS:0,S:40,M:80,L:80,XL:40,'2XL':0},currentStage:'cutting',fabric:'Single Jersey'},o||{});
const PASS1={id:'GP-0007',gpType:'fabric',poId:'PO-001',dest:'Factory',fabricUnit:'kg',fabricQty:102.4,rollCodes:['R-101','R-102','R-103','R-201','R-202'],
  fabrics:[{fabType:'Single Jersey',gsm:180,color:'Black',unit:'kg',rollCodes:['R-101','R-102','R-103'],rollsCount:3,weight:60},
           {fabType:'Fleece',gsm:260,color:'Black',unit:'kg',rollCodes:['R-201','R-202'],rollsCount:2,weight:40}],
  ribType:'Rib',ribGsm:220,ribColor:'Black',ribRollCodes:['RB-1'],ribRolls:1,ribWeight:2.4};
const OUTWARD={id:'GP-0003',gpType:'fabric',poId:'PO-001',gpReason:'process',dest:'Dyer',rollCodes:['X-1'],fabricUnit:'kg',fabricQty:9};
const GARMENTS={id:'GP-0004',gpType:'garments',poId:'PO-001',rollCodes:['G-1']};
const PASS3={id:'GP-0009',gpType:'fabric',poId:'PO-003',dest:'Factory',fabricUnit:'kg',fabricQty:30,rollCodes:['Q-1','Q-2'],fabrics:[{fabType:'Rib',gsm:200,color:'Navy',unit:'kg',rollCodes:['Q-1','Q-2'],weight:30}]};

function fakeFs(o){
  o=o||{};
  const store=JSON.parse(JSON.stringify(o.store||{}));
  const reads={},txs=[],plain=[];
  const stripId=r=>{const c=Object.assign({},r);delete c.id;return c;};
  const api={
    db:{},
    collection:(db,...s)=>({path:s.join('/')}),doc:(db,...s)=>({path:s.join('/')}),
    query:(c,...cs)=>({path:c.path,w:cs.filter(x=>x&&x.w).map(x=>x.w)}),
    where:(f,op,v)=>({w:[f,op,v]}),orderBy:()=>({}),limit:()=>({}),
    getDocs:async q=>{
      reads[q.path]=(reads[q.path]||0)+1;
      if(o.gate)await o.gate.p;
      const f=o.fail&&o.fail[q.path];if(f)throw f();
      let rows=(o.data&&o.data[q.path])||[];
      (q.w||[]).forEach(w=>{rows=rows.filter(r=>w[1]==='in'?w[2].indexOf(r[w[0]])>-1:r[w[0]]===w[2]);});   // the cutting screen asks for every spelling of the PO with an `in`
      return{docs:rows.map(r=>({id:r.id,data:()=>stripId(r)})),metadata:{fromCache:!!(o.cache&&o.cache[q.path])}};
    },
    getDoc:async r=>{
      reads[r.path]=(reads[r.path]||0)+1;
      if(o.gate)await o.gate.p;
      const f=o.fail&&o.fail[r.path];if(f)throw f();
      const d=(o.data&&o.data[r.path])||store[r.path];
      return{exists:()=>!!d,data:()=>Object.assign({},d),metadata:{fromCache:false}};
    },
    setDoc:async r=>{plain.push('setDoc '+r.path);},updateDoc:async r=>{plain.push('updateDoc '+r.path);},addDoc:async()=>{plain.push('addDoc');},
    deleteDoc:async()=>{plain.push('deleteDoc');},writeBatch:()=>{plain.push('writeBatch');return{set(){},update(){},delete(){},commit:async()=>{}};},
    runTransaction:async(db,fn)=>{
      const ops=[];
      const tx={
        get:async ref=>{const d=store[ref.path]||(o.txExtra&&o.txExtra[ref.path]);return{exists:()=>!!d,data:()=>JSON.parse(JSON.stringify(d||{}))};},
        set:(ref,d)=>{ops.push({op:'set',path:ref.path,data:JSON.parse(JSON.stringify(d))});},
        update:(ref,d)=>{ops.push({op:'update',path:ref.path,data:JSON.parse(JSON.stringify(d))});}
      };
      if(o.txFail)throw o.txFail();
      await fn(tx);
      ops.forEach(p=>{store[p.path]=p.op==='set'?p.data:Object.assign({},store[p.path],p.data);});   // atomic: only if fn finished
      txs.push(ops);
    }
  };
  return{api,reads,txs,plain,store};
}
const gate=()=>{let open;const p=new Promise(r=>{open=r;});return{p,open};};
// every fake read resolves in microtasks, so a couple of turns of the event loop settle the whole screen (no wall-clock waiting)
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};

function baseData(){
  return{
    po_drafts:[],cutting_masters:[{id:'CM-001',name:'Hassan'}],ph_standards:[],'ph_settings/main':{},
    po_cut_jobs:[job('PO-001'),job('PO-002',{status:'complete',masterName:'Alam',rollsChecklist:{total:2,verified:2,short:0,missing:0,extra:0}}),
      job('PO-003',{plannedCutDate:OLD}),job('PO-004',{plannedCutDate:YEST,status:'complete'}),job('PO-005',{plannedCutDate:'2026-10-20'}),job('PO-006',{plannedCutDate:null})],
    'pos/PO-001':po('PO-001'),'pos/PO-002':po('PO-002',{name:'Core Tee'}),'pos/PO-003':po('PO-003',{name:'Late Hoodie',code:'GHD011',qty:100,sizes:{M:50,L:50}}),
    gatepasses:[PASS1,OUTWARD,GARMENTS,PASS3]
  };
}

function load(opts){
  opts=opts||{};
  const data=opts.data||baseData();
  const fk=fakeFs({data:data,store:opts.store||storeOf(data),fail:opts.fail,gate:opts.gate,cache:opts.cache,txFail:opts.txFail});
  const calls=[],opened=[];
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:opts.session||USERS.uzaib,currentPage:'dashboard',
    globals:Object.assign({},fk.api,{Date:FixedDate,allPOs:opts.allPOs,
      localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
      history:{replaceState(s,t,u){calls.push(String(u));},pushState(){}}},opts.globals||{})});
  const ctx=a.ctx;if(typeof ctx.phI18nSetLang==='function')ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  ctx.window.showPage=function(id){ctx.currentPage=id;if(id==='prod-ops')ctx.phRenderPage(id);return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.window.openStageWork=function(id,stage){opened.push([id,stage]);ctx.currentPage='stage-work';return Promise.resolve();};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(UI,ctx,{filename:'ph-ui.js'});
  vm.runInContext(opts.src||SRC,ctx,{filename:'ph-mod-cutting.js'});
  const T={a,ctx,dom,fk,opened,calls,R:c=>a.run(c),
    panel:()=>dom.find('ph-panel'),text:n=>n?n.textContent:'',
    card:id=>dom.all(dom.body,n=>n.getAttribute('data-po')===id)[0]||null,
    btns:(root,t)=>dom.all(root||dom.body,n=>n.tagName==='BUTTON'&&n.textContent===t),
    btn:(root,t)=>T.btns(root,t)[0]||null,
    click:n=>dom.click(n),
    type:(n,v)=>{n.value=v;dom.dispatch(n,'input');},
    enter:(n,v)=>{n.value=v;dom.dispatch(n,'keydown',{key:'Enter'});},
    scan:(poId,v)=>{const i=dom.find('phk-scan-'+poId);T.enter(i,v);},
    open:async(extra)=>{await ctx.window.showPage('prod-ops');await settle();ctx.phGoTab('cutting');await settle(40);}
  };
  return T;
}
function storeOf(data){
  const s={};
  Object.keys(data).forEach(k=>{
    if(k.indexOf('/')>-1)s[k]=data[k];
    if(k==='po_cut_jobs')data[k].forEach(r=>{const c=Object.assign({},r);delete c.id;s['po_cut_jobs/'+r.id]=c;});
  });
  return s;
}
const J=JSON.stringify;
const GROUP={};   // check name -> the group of blocks that produces it (so a break re-runs only those)
const OTHERS=fs.readdirSync(path.join(ROOT,'js')).filter(f=>/\.js$/.test(f)&&f!=='ph-mod-cutting.js').map(f=>read('js/'+f)).join('\n');

async function checks(src,only){
  const o=new Proxy({},{set(t,k,v){t[k]=v;GROUP[k]=grp;return true;}});
  const want=g=>!only||only.indexOf(g)>-1;
  let grp='';
  const mk=(u,more)=>load(Object.assign({session:USERS[u],src:src},more||{}));

  /* ── pure: the day split ── */
  if(want('pure')){grp='pure';
    const T=mk('uzaib');
    const sp=J(T.R('(function(){const r=phkSplitJobs('+J(baseData().po_cut_jobs.map(r=>Object.assign({fbKey:r.id},r)))+',"'+TODAY+'");return {t:r.today.map(x=>x.fbKey),o:r.overdue.map(x=>x.fbKey),u:r.undated};})()'));
    o['days: today = the jobs planned for the PKT day (complete ones stay visible); overdue = OPEN and earlier; future, finished-yesterday and undated are neither; the undated one is counted']=sp===J({t:['PO-001','PO-002'],o:['PO-003'],u:1});
    o['days: "today" is the PKT day, not the UTC one (20:00 UTC on 12 Oct is 13 Oct in Pakistan)']=T.R('phkToday()')===TODAY&&T.R('phkToday()')!==new Date(FIXED).toISOString().slice(0,10);
    o['days: overdue is oldest first']=J(T.R('phkSplitJobs([{fbKey:"PO-9",status:"open",plannedCutDate:"2026-10-11"},{fbKey:"PO-8",status:"open",plannedCutDate:"2026-10-02"},{fbKey:"PO-7",status:"open",plannedCutDate:"2026-10-02"}],"'+TODAY+'").overdue.map(x=>x.fbKey)'))===J(['PO-7','PO-8','PO-9']);
    o['days: junk rows and a non-day planned date are ignored, never thrown on']=(()=>{try{return T.R('phkSplitJobs([null,3,{fbKey:"PO-1",status:"open",plannedCutDate:"13/10/2026"}],"'+TODAY+'").undated')===1&&T.R('phkSplitJobs(null,"'+TODAY+'").today.length')===0;}catch(e){return false;}})();
  }
  /* ── pure: the fabric issue ── */
  if(want('pure')){grp='pure';
    const T=mk('uzaib');
    const iss=T.R('phkIssueFromPasses('+J([PASS1,OUTWARD,GARMENTS])+')');
    o['issue: 6 rolls = 3 + 2 fabric rolls + 1 rib roll, from the fabric issue only (the outward process pass and a garments pass are ignored)']=iss.rolls.length===6&&!iss.byCode['X-1']&&!iss.byCode['G-1']&&!!iss.byCode['RB-1'];
    o['issue: groups keep their own type / gsm / colour, the rib is its own group']=iss.groups.length===3&&/Single Jersey 180 gsm Black/.test(iss.groups[0].label)&&/^Rib 220 gsm Black/.test(iss.groups[2].label)&&iss.groups[2].rib===true;
    o['issue: the weight is the sum of the groups (102.4 kg), one unit, not mixed']=iss.weight===102.4&&iss.unit==='kg'&&iss.mixedUnits===false;
    const dup=T.R('phkIssueFromPasses('+J([PASS1,Object.assign({},PASS1,{id:'GP-0008'})])+')');
    o['issue: a roll on two passes is one roll']=dup.rolls.length===6&&dup.groups.length===3;
    const mix=T.R('phkIssueFromPasses('+J([Object.assign({},PASS1,{fabrics:[{fabType:'A',gsm:1,color:'x',unit:'kg',rollCodes:['A1'],weight:5},{fabType:'B',gsm:1,color:'y',unit:'meters',rollCodes:['B1'],weight:7}],ribRollCodes:[]})])+')');
    o['issue: kg and m are never added together: the weight is unknown and the units are said to differ']=mix.mixedUnits===true&&mix.weight===null&&mix.unit===null;
    const nw=T.R('phkIssueFromPasses('+J([Object.assign({},PASS1,{fabrics:[{fabType:'A',gsm:1,color:'x',unit:'kg',rollCodes:['A1'],weight:5},{fabType:'B',gsm:1,color:'y',unit:'kg',rollCodes:['B1']}],ribRollCodes:[]})])+')');
    o['issue: one unrecorded group weight makes the total unknown (null), never a partial sum']=nw.weight===null&&nw.rolls.length===2;
    const legacy=T.R('phkIssueFromPasses('+J([{gpType:'fabric',poId:'PO-1',rollCodes:['L-1','L-2'],fabricType:'Jersey',fabricGsm:150,fabricColor:'Red',fabricUnit:'kg',fabricQty:20}])+')');
    o['issue: an older pass with no fabrics[] still lists its rolls']=legacy.rolls.length===2&&legacy.weight===20;
    o['issue: no passes = no rolls (not an error)']=T.R('phkIssueFromPasses([]).rolls.length')===0&&T.R('phkIssueFromPasses(null).rolls.length')===0;
    o['issue: codes are normalised (trim, upper case)']=T.R('phkNormCode("  r-101 ")')==='R-101';
  }
  /* ── pure: the verdict ── */
  if(want('pure')){grp='pure';
    const T=mk('uzaib');
    const issue=T.R('phkIssueFromPasses('+J([PASS1])+')');
    const ev=w=>JSON.parse(J(T.R('phkEvalChecklist(phkIssueFromPasses('+J([PASS1])+'),'+J(w)+')')));
    const all={mode:'scan',present:{'R-101':true,'R-102':true,'R-103':true,'R-201':true,'R-202':true,'RB-1':true},extras:[]};
    const r1=ev(all);
    o['verdict: every roll present = 6 of 6, no mismatch']=r1.ok&&r1.counts.total===6&&r1.counts.verified===6&&r1.counts.missing===0&&r1.counts.extra===0&&r1.counts.short===0&&r1.mismatch===false;
    const r2=ev(Object.assign({},all,{present:{'R-101':true,'R-102':true,'R-103':true,'R-201':true,'R-202':true}}));
    o['verdict: a missing roll is flagged (missing 1) and the code is named, but the check is still SAVABLE (never blocked)']=r2.ok===true&&r2.counts.missing===1&&r2.mismatch===true&&r2.missingCodes.join()==='RB-1'&&/MISSING RB-1/.test(r2.summary);
    const r3=ev(Object.assign({},all,{extras:['Z-9']}));
    o['verdict: a code that is not on the issue is an EXTRA, flagged, still savable']=r3.ok&&r3.counts.extra===1&&r3.mismatch&&r3.extraCodes.join()==='Z-9'&&/NOT ON THE ISSUE Z-9/.test(r3.summary);
    const t1=ev({mode:'tally',tallyRolls:'5'});
    o['count mode: 5 counted of 6 = verified 5, missing 1, flagged']=t1.ok&&t1.counts.verified===5&&t1.counts.missing===1&&t1.mismatch;
    const t2=ev({mode:'tally',tallyRolls:'7'});
    o['count mode: 7 counted of 6 = verified 6, extra 1, flagged']=t2.ok&&t2.counts.verified===6&&t2.counts.extra===1&&t2.mismatch;
    o['count mode: an empty or non-whole count is not savable yet (and says what to do), never read as zero']=!ev({mode:'tally',tallyRolls:''}).ok&&!ev({mode:'tally',tallyRolls:'2.5'}).ok&&!ev({mode:'tally',tallyRolls:'-1'}).ok&&/how many rolls/.test(ev({mode:'tally',tallyRolls:''}).problems.join());
    o['count mode: zero counted is a valid answer (everything missing)']=ev({mode:'tally',tallyRolls:'0'}).counts.missing===6;
    // weight: issued 102.4 kg, tolerance max(2% = 2.05, 0.5) = 2.05
    const w1=ev(Object.assign({},all,{weighed:'103'}));
    o['weight: 0.6 kg off an issued 102.4 kg is inside the tolerance (2.05): short 0']=w1.ok&&w1.counts.short===0&&w1.weight.comparable&&w1.weight.tol===2.05&&!w1.mismatch;
    const w2=ev(Object.assign({},all,{weighed:'105.5'}));
    o['weight: 3.1 kg over is outside the tolerance: short 1, flagged, the sentence says over and the limit']=w2.counts.short===1&&w2.mismatch&&/WEIGHT 3\.1 kg over 102\.4 kg \(limit 2\.05\)/.test(w2.summary);
    const w3=ev(Object.assign({},all,{weighed:'99'}));
    o['weight: under counts the same way (3.4 kg under)']=w3.counts.short===1&&/under/.test(w3.summary);
    o['weight: a weight that is not a positive number is not savable, never ignored']=!ev(Object.assign({},all,{weighed:'abc'})).ok&&!ev(Object.assign({},all,{weighed:'0'})).ok&&!ev(Object.assign({},all,{weighed:'-3'})).ok;
    const wk=(e,i)=>JSON.parse(J(T.R('phkWeightCheck('+e+','+i+',"kg",false)')));
    o['tolerance: on 100 kg the limit is 2 (the percent), 2.00 passes and 2.01 is flagged']=wk(102,100).flag===false&&wk(102.01,100).flag===true&&wk(98,100).flag===false&&wk(97.99,100).flag===true;
    o['tolerance: on 10 kg the 0.5 floor applies (2% would be 0.2): 0.5 passes, 0.6 is flagged']=wk(10.5,10).flag===false&&wk(10.6,10).flag===true&&wk(10.5,10).tol===0.5;
    o['tolerance: the two limits are named constants (documented defaults)']=T.R('PHK_WEIGHT_TOL_PCT')===2&&T.R('PHK_WEIGHT_TOL_ABS')===0.5;
    const nc=JSON.parse(J(T.R('phkWeightCheck(50,null,"kg",false)')));
    o['weight: with no issued weight the comparison is "not recorded", never a pass or a fail']=nc.comparable===false&&nc.flag===false&&/not recorded/.test(nc.why);
    o['weight: units that differ are not compared']=JSON.parse(J(T.R('phkWeightCheck(50,60,null,true)'))).comparable===false;
    o['verdict: no rolls issued = not savable and says so']=(()=>{const r=JSON.parse(J(T.R('phkEvalChecklist(phkIssueFromPasses([]),{mode:"scan"})')));return r.ok===false&&/no rolls/.test(r.problems.join());})();
    o['verdict: the summary fits the history reason (<= 480 characters) however many codes are missing']=(()=>{
      const big=T.R('phkIssueFromPasses([{gpType:"fabric",poId:"P",rollCodes:'+J(Array.from({length:120},(_,i)=>'ROLL-'+(1000+i)))+',fabricUnit:"kg"}])');
      const r=JSON.parse(J(T.R('phkEvalChecklist(phkIssueFromPasses([{gpType:"fabric",poId:"P",rollCodes:'+J(Array.from({length:120},(_,i)=>'ROLL-'+(1000+i)))+',fabricUnit:"kg"}]),{mode:"scan",present:{},extras:[]})')));
      return r.ok&&r.summary.length<=480&&r.counts.missing===120;})();
    void issue;
  }
  /* ── pure: the cut gate preview ── */
  if(want('pure')){grp='pure';
    const T=mk('uzaib');
    const pv=(cut,p)=>JSON.parse(J(T.R('phkCutPreview('+J(p||po('PO-1'))+','+J(cut)+')')));
    o['gate: 168 of 240 is the bottom of 70-130% (ok), 167 needs an override']=pv({S:'168'}).verdict==='ok'&&pv({S:'167'}).verdict==='needs_override'&&pv({S:'168'}).min===168&&pv({S:'168'}).max===312;
    o['gate: 312 is the top (ok), 313 needs an override']=pv({S:'312'}).verdict==='ok'&&pv({S:'313'}).verdict==='needs_override';
    o['gate: per-size numbers add up to the total the gate judges']=pv({S:'40',M:'80',L:'50'}).total===170&&pv({S:'40',M:'80',L:'50'}).verdict==='ok';
    o['gate: nothing entered / junk / negative is "invalid" (information only), never a verdict']=pv({}).verdict==='invalid'&&pv({S:'x'}).verdict==='invalid'&&pv({S:'-4'}).verdict==='invalid'&&pv({S:'x'}).bad.join()==='S';
    o['gate: an approved variance (po.cutOverride) is shown as such, any quantity']=pv({S:'5'},po('PO-1',{cutOverride:{by:'mustafa'}})).verdict==='override';
    o['gate: a PO with no quantity cannot be judged']=pv({S:'100'},po('PO-1',{qty:0})).verdict==='invalid';
    o['gate: sizes come out in garment order and only the ordered ones']=J(T.R('phkSizesOf('+J(po('PO-1',{sizes:{XL:5,S:3,'2XL':0,M:4,XS:1}}))+').map(s=>s.size)'))===J(['XS','S','M','XL']);
  }

  /* ── the tab: today, overdue, the cards ── */
  if(want('tab')){grp='tab';
    const T=mk('uzaib');
    await T.open();
    const cards=T.dom.all(T.panel(),n=>n.getAttribute('data-po')).map(n=>n.getAttribute('data-po'));
    o['tab: today\'s cards are exactly the PKT-today jobs (PO-001, PO-002); the overdue one is a row, not a card, until opened']=J(cards)===J(['PO-001','PO-002']);
    o['tab: the overdue list shows PO-003 with how many days late']=/PO-003/.test(T.text(T.panel()))&&/4 days late/.test(T.text(T.panel()));
    o['tab: future, finished-yesterday and undated jobs are not listed; the undated open one is counted']=!/PO-005|PO-004/.test(T.text(T.panel()))&&/1 open job with no planned day/.test(T.text(T.panel()));
    o['tab: the head counts say 2 planned today, 1 overdue']=/2 jobs planned today · 1 overdue/.test(T.text(T.panel()));
    const c=T.card('PO-001');const t=T.text(c);
    o['card: PO number, article and code, ordered quantity, sizes, master, planned day']=/PO-001/.test(t)&&/Effortless Tee · GST073/.test(t)&&/240 pcs/.test(t)&&/S 40 · M 80 · L 80 · XL 40/.test(t)&&/Hassan/.test(t)&&/2026-10-13/.test(t);
    o['card: planned fabric from the job and the ISSUED fabric (type / gsm / colour, rolls, weight) from the gate pass']=/Planned fabric/.test(t)&&/102.4 kg/.test(t)&&/Single Jersey 180 gsm Black/.test(t)&&/3 rolls · 60 kg/.test(t)&&/Rib 220 gsm Black/.test(t)&&/6 rolls in all · 102.4 kg/.test(t);
    o['card: Mark complete and Save roll check are there for the floor user, with 48px-class buttons marked']=!!T.btn(c,'Mark complete')&&!!T.btn(c,'Save roll check');
    o['card: the finished job (PO-002) shows Complete, a saved result and no edit controls']=(()=>{const c2=T.card('PO-002');const t2=T.text(c2);return /✓ Complete/.test(t2)&&/Saved roll check: 2 of 2 verified/.test(t2)&&!T.btn(c2,'Mark complete')&&!T.btn(c2,'Save roll check');})();
    o['card: a job with no fabric issue says so (PO-002) and offers no checklist']=/No fabric issue was found for this PO/.test(T.text(T.card('PO-002')));
    o['tab: the finished job still shows what the roll check found']=/Matches the issue/.test(T.text(T.card('PO-002')));
    // overdue: open a card
    T.click(T.btn(T.panel(),'Open'));await settle(40);
    o['overdue: Open expands the full card (PO-003: the Late Hoodie, 4 days late) and loads its fabric']=!!T.card('PO-003')&&/Late Hoodie/.test(T.text(T.card('PO-003')))&&/4 days late/.test(T.text(T.card('PO-003')))&&/Rib Navy|Rib 200 gsm Navy/.test(T.text(T.card('PO-003')));
    o['overdue: it can be closed again']=(()=>{T.click(T.btn(T.card('PO-003').parentNode,'Close'));return !T.card('PO-003');})();
  }
  if(want('tab')){grp='tab';
    const many=baseData();
    for(let i=10;i<24;i++)many.po_cut_jobs.push(job('PO-0'+i,{plannedCutDate:OLD}));
    const T=mk('uzaib',{data:many});
    await T.open();
    const rows=T.dom.all(T.panel(),n=>/\bphk-ovrow\b/.test(n.className));
    o['overdue: only the first 10 rows show, then "Show all 15 overdue"']=rows.length===10&&!!T.btn(T.panel(),'Show all 15 overdue');
    T.click(T.btn(T.panel(),'Show all 15 overdue'));
    o['overdue: Show all lists every overdue job']=T.dom.all(T.panel(),n=>/\bphk-ovrow\b/.test(n.className)).length===15;
  }

  /* ── honest states ── */
  if(want('states')){grp='states';
    const gp=gate();
    const dataHeld=baseData();
    const T=load({session:USERS.uzaib,src:src,data:dataHeld});
    // hold ONLY the pos / gatepasses reads
    const origGetDoc=T.ctx.getDoc,origGetDocs=T.ctx.getDocs;
    await T.ctx.window.showPage('prod-ops');await settle();
    T.ctx.getDoc=async r=>{if(/^pos\//.test(r.path))await gp.p;return origGetDoc(r);};
    T.ctx.getDocs=async q=>{if(q.path==='gatepasses')await gp.p;return origGetDocs(q);};
    T.ctx.phGoTab('cutting');await settle(10);
    const t=T.text(T.card('PO-001'));
    o['loading: before the PO / fabric reads settle the card says it is reading, and shows no roll count and no input']=/Reading the PO/.test(t)&&/Reading the fabric issue/.test(t)&&!T.dom.find('phk-scan-PO-001')&&!/rolls verified/.test(t);
    gp.open();await settle(40);
    o['loading: once they settle the checklist appears']=!!T.dom.find('phk-scan-PO-001')&&/0 of 6 rolls verified/.test(T.text(T.card('PO-001')));
  }
  if(want('states')){grp='states';
    const T=mk('uzaib',{fail:{gatepasses:PERM}});
    await T.open();
    const t=T.text(T.card('PO-001'));
    o['failed fabric-issue read: the card names gatepasses and offers Try again, and does NOT say "no fabric issue" or show a roll list']=/gatepasses for PO-001: could not be read/.test(t)&&!!T.btn(T.card('PO-001'),'Try again')&&!/No fabric issue was found/.test(t)&&!T.dom.find('phk-scan-PO-001');
    o['failed fabric-issue read: the PO details still show (the two reads are independent)']=/Effortless Tee/.test(t);
    o['failed fabric-issue read: Mark complete is still there (it does not need the issue)']=!!T.btn(T.card('PO-001'),'Mark complete')&&!T.btn(T.card('PO-001'),'Save roll check');
  }
  if(want('states')){grp='states';
    const T=mk('uzaib',{fail:{'pos/PO-001':PERM}});
    await T.open();
    const t=T.text(T.card('PO-001'));
    o['failed PO read: the card says pos/PO-001 could not be read, with Try again, and no article / quantity is invented']=/pos\/PO-001: could not be read/.test(t)&&!!T.btn(T.card('PO-001'),'Try again')&&!/240 pcs/.test(t);
    T.fk.api.getDoc=async r=>({exists:()=>true,data:()=>po('PO-001'),metadata:{fromCache:false}});
  }
  if(want('states')){grp='states';
    const d=baseData();delete d['pos/PO-001'];
    const T=mk('uzaib',{data:d});
    await T.open();
    o['a PO that does not exist: "was not found", not a blank card']=/PO PO-001 was not found/.test(T.text(T.card('PO-001')));
  }
  if(want('states')){grp='states';
    const T=mk('uzaib',{cache:{gatepasses:true}});
    await T.open();
    o['an offline-copy answer for the fabric issue is a failure, not "no rolls"']=/offline copy/.test(T.text(T.card('PO-001')))&&!T.dom.find('phk-scan-PO-001');
  }
  if(want('states')){grp='states';
    const T=mk('uzaib',{fail:{po_cut_jobs:PERM}});
    await T.open();
    const t=T.text(T.panel());
    o['failed jobs read: an alert names po_cut_jobs with Retry; no cards, no "0 jobs", no "no cut jobs are planned"']=/cutting jobs could not be read/i.test(t)&&/po_cut_jobs/.test(t)&&!!T.btn(T.panel(),'Retry')&&!/planned today/.test(t)&&!/No cut jobs are planned/.test(t)&&!T.card('PO-001');
  }
  if(want('states')){grp='states';
    const d=baseData();d.po_cut_jobs=[];
    const T=mk('uzaib',{data:d});
    await T.open();
    o['a jobs read that SUCCEEDED and is empty says "No cut jobs are planned for today" (the one place the empty sentence is right)']=/No cut jobs are planned for today/.test(T.text(T.panel()))&&/Nothing overdue/.test(T.text(T.panel()));
  }

  /* ── scanning ── */
  if(want('scan')){grp='scan';
    const T=mk('uzaib');
    await T.open();
    const inp=T.dom.find('phk-scan-PO-001');
    o['scan: the field is a text input a scanner can type into (autocomplete off, upper-case keyboard, a label)']=!!inp&&inp.getAttribute('type')==='text'&&inp.getAttribute('autocomplete')==='off'&&inp.getAttribute('autocapitalize')==='characters'&&T.dom.all(T.card('PO-001'),n=>n.tagName==='LABEL'&&n.getAttribute('for')==='phk-scan-PO-001').length===1;
    T.enter(inp,'r-101');
    o['scan: a code on the issue (any case) is ticked present on Enter, the field is cleared, the roll shows ✓ Present']=T.R('phkWork("PO-001").present["R-101"]')===true&&inp.value===''&&/R-101 is on the issue - present/.test(T.text(T.card('PO-001')))&&/1 of 6 rolls verified/.test(T.text(T.card('PO-001')));
    T.enter(inp,'R-101');
    o['scan: the same code again is noted, counted once']=/already scanned - counted once/.test(T.text(T.card('PO-001')))&&/1 of 6 rolls verified/.test(T.text(T.card('PO-001')))&&T.R('phkWork("PO-001").dups.join()')==='R-101';
    T.enter(inp,'ZZ-9');
    o['scan: a code that is not on the issue is an EXTRA, shown, flagged in the summary']=T.R('phkWork("PO-001").extras.join()')==='ZZ-9'&&/NOT on this PO's fabric issue/.test(T.text(T.card('PO-001')))&&/MISMATCH/.test(T.text(T.card('PO-001')));
    T.enter(inp,'ZZ-9');
    o['scan: an extra scanned twice is not added twice']=T.R('phkWork("PO-001").extras.length')===1;
    T.enter(inp,'   ');
    o['scan: a blank scan does nothing']=T.R('phkWork("PO-001").extras.length')===1&&T.R('Object.keys(phkWork("PO-001").present).length')===1;
    // Tab submits a typed code (some scanners end with Tab)
    inp.value='R-102';const e=T.dom.dispatch(inp,'keydown',{key:'Tab'});
    o['scan: Tab with a code typed submits it (and keeps focus in the field); Tab on an empty field is left alone']=T.R('phkWork("PO-001").present["R-102"]')===true&&e.defaultPrevented===true&&(()=>{const ev=T.dom.dispatch(T.dom.find('phk-scan-PO-001'),'keydown',{key:'Tab'});return ev.defaultPrevented===false;})();
    // Add button
    inp.value='R-103';T.click(T.btn(T.card('PO-001'),'Add'));
    o['scan: the Add button does the same as Enter']=T.R('phkWork("PO-001").present["R-103"]')===true;
    // tap to tick / untick
    const rollBtn=T.dom.all(T.card('PO-001'),n=>n.tagName==='BUTTON'&&/R-201/.test(n.textContent)&&/Not seen yet/.test(n.textContent))[0];
    T.click(rollBtn);
    o['tap: a roll can be ticked present by tap, and tapping again unticks it (aria-pressed follows)']=T.R('phkWork("PO-001").present["R-201"]')===true&&T.dom.all(T.card('PO-001'),n=>n.tagName==='BUTTON'&&/R-201/.test(n.textContent))[0].getAttribute('aria-pressed')==='true'&&(()=>{T.click(T.dom.all(T.card('PO-001'),n=>n.tagName==='BUTTON'&&/R-201/.test(n.textContent))[0]);return !T.R('phkWork("PO-001").present["R-201"]');})();
    // remove an extra
    T.click(T.btn(T.card('PO-001'),'Remove'));
    o['an extra can be removed again']=T.R('phkWork("PO-001").extras.length')===0;
    o['scan: the unsaved state is said ("Not saved yet.")']=/Not saved yet/.test(T.text(T.card('PO-001')));
    o['scan: every roll of the issue is listed, 6 rows (3 + 2 + rib)']=T.dom.all(T.card('PO-001'),n=>/^phk-roll(?: on)?$/.test(n.className)).length===6;
    // typing into the weighed total updates the verdict in place without rebuilding the field
    const wi=T.dom.find('phk-wt-PO-001');
    T.type(wi,'110');
    o['weight: a weighed total outside the limit is flagged in the summary']=/WEIGHT|weight 7\.6 kg over|MISMATCH/.test(T.text(T.card('PO-001')))&&T.dom.find('phk-wt-PO-001')===wi;
    // scanning before the issue has loaded is refused out loud
    const U=mk('uzaib',{fail:{gatepasses:PERM}});await U.open();
    o['scan: with the issue unloaded a scan is refused (kind "unavailable"), nothing is ticked']=U.R('phkScan("PO-001","R-101").kind')==='unavailable'&&U.R('Object.keys(phkWork("PO-001").present).length')===0;
  }

  /* ── count-only mode ── */
  if(want('scan')){grp='scan';
    const T=mk('uzaib');
    await T.open();
    T.click(T.btn(T.card('PO-001'),'Count only'));
    const i1=T.dom.find('phk-cnt-PO-001');
    o['count mode: the switch swaps the inputs (a rolls-counted field and an optional weight)']=!!i1&&!T.dom.find('phk-scan-PO-001')&&!!T.dom.find('phk-cw-PO-001');
    o['count mode: the save is not offered until a count is typed']=T.btn(T.card('PO-001'),'Save roll check').getAttribute('aria-disabled')==='true';
    T.type(i1,'5');
    o['count mode: typing a count updates the verdict (5 of 6, 1 missing, MISMATCH) without rebuilding the field']=/5 of 6 rolls verified/.test(T.text(T.card('PO-001')))&&/MISMATCH: 1 roll missing/.test(T.text(T.card('PO-001')))&&T.dom.find('phk-cnt-PO-001')===i1;
    o['count mode: the save is now enabled']=T.btn(T.card('PO-001'),'Save roll check').getAttribute('aria-disabled')==='false';
  }

  /* ── the writes ── */
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    // nothing scanned: Save is refused (a pristine screen would otherwise record "all missing")
    const rEmpty=await T.R('phkSaveChecklist("PO-001")');
    o['save: nothing scanned yet is refused, nothing written']=rEmpty.ok===false&&rEmpty.code==='invalid'&&T.fk.txs.length===0;
    ['R-101','R-102','R-103','R-201','R-202'].forEach(c=>T.scan('PO-001',c));
    T.scan('PO-001','STRAY-1');
    const before=T.R('phkWork("PO-001").dirty');
    const r=await T.R('phkSaveChecklist("PO-001")');
    o['save: a MISMATCH (rib roll missing + a stray code) is SAVED flagged, never blocked']=before===true&&r.ok===true&&r.job.rollsChecklist.missing===1&&r.job.rollsChecklist.extra===1&&r.job.rollsChecklist.verified===5&&r.job.rollsChecklist.total===6;
    o['save: ONE transaction holds the job update and the pos history row']=T.fk.txs.length===1&&T.fk.txs[0].length===2&&T.fk.txs[0][0].path==='po_cut_jobs/PO-001'&&/^pos\/PO-001\/history\//.test(T.fk.txs[0][1].path);
    const upd=T.fk.txs[0][0].data,hist=T.fk.txs[0][1].data;
    o['save: the job update is the checklist + rev + updatedBy only (status untouched); rev is +1']=T.fk.txs[0][0].op==='update'&&J(Object.keys(upd).sort())===J(['rev','rollsChecklist','updatedAt','updatedBy'])&&upd.rev===3&&upd.updatedBy==='uzaib';
    o['save: the WHICH-rolls detail is stored inside rollsChecklist (missingCodes ["RB-1"], extraCodes ["STRAY-1"]); the job update still carries only the same four keys']=J(upd.rollsChecklist.missingCodes)==='["RB-1"]'&&J(upd.rollsChecklist.extraCodes)==='["STRAY-1"]'&&J(Object.keys(upd).sort())===J(['rev','rollsChecklist','updatedAt','updatedBy']);
    o['save: the saved card prints the codes (Missing: RB-1 / Not on the issue: STRAY-1), not only the counts']=/Missing: RB-1/.test(T.text(T.card('PO-001')))&&/Not on the issue: STRAY-1/.test(T.text(T.card('PO-001')));
    o['save: the history row names the codes (MISSING RB-1 / NOT ON THE ISSUE STRAY-1) in its reason and is a cut_job_updated row by uzaib']=hist.type==='cut_job_updated'&&hist.by==='uzaib'&&/MISSING RB-1/.test(hist.reason)&&/NOT ON THE ISSUE STRAY-1/.test(hist.reason)&&/5 of 6 verified/.test(hist.reason);
    o['save: the card says Saved - FLAGGED and shows the saved result with the mismatch chip']=/Saved - FLAGGED/.test(T.text(T.card('PO-001')))&&/✗ MISMATCH flagged/.test(T.text(T.card('PO-001')))&&T.R('phkWork("PO-001").dirty')===false;
    o['save: the loaded job copy followed (rev 3), so the next save is not stale']=T.R('phGet("jobs").rows.filter(r=>r.fbKey==="PO-001")[0].rev')===3;
    const r2=await T.R('phkSaveChecklist("PO-001")');
    o['save: saving again works on the new revision (no stale refusal)']=r2.ok===true&&T.fk.txs.length===2&&T.fk.txs[1][0].data.rev===4;
    o['writes: everything written went to po_cut_jobs/* and pos/*/history/* only; no plain write, no batch']=T.fk.txs.every(tx=>tx.every(p=>/^po_cut_jobs\/PO-\d+$/.test(p.path)||/^pos\/PO-\d+\/history\/\d{13}-/.test(p.path)))&&T.fk.plain.length===0;
    o['writes: the pos document itself is never written (only its history sub-collection)']=T.fk.txs.every(tx=>tx.every(p=>!/^pos\/PO-\d+$/.test(p.path)));
  }
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    T.click(T.btn(T.card('PO-001'),'Count only'));
    T.type(T.dom.find('phk-cnt-PO-001'),'6');T.type(T.dom.find('phk-cw-PO-001'),'108');
    const r=await T.R('phkSaveChecklist("PO-001")');
    o['save (count mode): no codes exist, so both lists are sent EMPTY (a re-save clears an older list)']=r.ok&&J(r.job.rollsChecklist.missingCodes)==='[]'&&J(r.job.rollsChecklist.extraCodes)==='[]';
    o['save (count mode): 6 of 6 rolls but 5.6 kg over the limit = short 1, flagged and saved']=r.ok&&r.job.rollsChecklist.verified===6&&r.job.rollsChecklist.short===1&&/WEIGHT 5\.6 kg over/.test(T.fk.txs[0][1].data.reason)&&/count/.test(T.fk.txs[0][1].data.reason);
  }
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    ['R-101','R-102','R-103','R-201','R-202','RB-1'].forEach(c=>T.scan('PO-001',c));
    const r=await T.R('phkSaveChecklist("PO-001")');
    o['save: all six present = no mismatch, saved as matching']=r.ok&&r.job.rollsChecklist.missing===0&&/Matches the issue/.test(T.text(T.card('PO-001')))&&/no mismatch/.test(T.fk.txs[0][1].data.reason);
  }
  /* the code lists are clipped to what the writer accepts, and the counts keep the truth */
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    const big=Array.from({length:250},(_,i)=>'R-'+i);
    const cl=T.R('phkChecklistForSave('+J({counts:{total:260,verified:9,short:0,missing:251,extra:0},missingCodes:['X'.repeat(60),'  ','R-0'].concat(big),extraCodes:[]})+')');
    o['codes: a list longer than 200 is clipped to 200, the rest is counted in left, and the counts still say 251']=cl.checklist.missingCodes.length===200&&cl.left.missing===51&&cl.checklist.missing===251&&cl.checklist.total===260;
    o['codes: a code over 40 characters is clipped to 40, an empty one is dropped, a repeat is one']=cl.checklist.missingCodes.every(c=>c.length<=40&&c.length>0)&&new Set(cl.checklist.missingCodes).size===cl.checklist.missingCodes.length;
    ['R-101','R-102','R-103','R-201','R-202'].forEach(c=>T.scan('PO-001',c));
    T.scan('PO-001','Z'.repeat(60));
    const r=await T.R('phkSaveChecklist("PO-001")');
    o['codes: a 60-character stray code (a scanner can type anything) still SAVES, clipped to 40 (never blocked)']=r.ok===true&&r.job.rollsChecklist.extraCodes.length===1&&r.job.rollsChecklist.extraCodes[0]==='Z'.repeat(40)&&r.job.rollsChecklist.extra===1;
  }
  /* mark complete */
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    T.scan('PO-001','R-101');
    T.click(T.btn(T.card('PO-001'),'Mark complete'));
    o['complete: the first press only ASKS (Yes / Cancel); nothing is written']=T.fk.txs.length===0&&!!T.btn(T.card('PO-001'),'Yes, mark complete')&&!!T.btn(T.card('PO-001'),'Cancel')&&/Mark this job complete\?/.test(T.text(T.card('PO-001')));
    o['complete: the question says the unsaved roll check goes with it, flagged']=/also saves the roll check, flagged as a mismatch/.test(T.text(T.card('PO-001')));
    T.click(T.btn(T.card('PO-001'),'Cancel'));
    o['complete: Cancel puts the question away']=!T.btn(T.card('PO-001'),'Yes, mark complete')&&T.fk.txs.length===0;
    T.click(T.btn(T.card('PO-001'),'Mark complete'));
    T.click(T.btn(T.card('PO-001'),'Yes, mark complete'));
    await settle(30);
    o['complete: Yes writes status complete + the unsaved roll check in ONE transaction (job + history)']=T.fk.txs.length===1&&T.fk.txs[0].length===2&&T.fk.txs[0][0].data.status==='complete'&&T.fk.txs[0][0].data.rollsChecklist.verified===1&&T.fk.txs[0][0].data.completedBy==='uzaib'&&typeof T.fk.txs[0][0].data.completedAt==='number';
    o['complete: the roll check goes with its code lists (5 missing codes, none extra)']=J(T.fk.txs[0][0].data.rollsChecklist.missingCodes)===J(['R-102','R-103','R-201','R-202','RB-1'])&&J(T.fk.txs[0][0].data.rollsChecklist.extraCodes)==='[]';
    o['complete: the history reason says it was marked complete and carries the roll check']=/^Marked complete - Roll check \(scan\): 1 of 6 verified/.test(T.fk.txs[0][1].data.reason);
    o['complete: the card now reads Complete and the edit controls are gone (the roll check is closed)']=/✓ Complete/.test(T.text(T.card('PO-001')))&&!T.btn(T.card('PO-001'),'Mark complete')&&!T.dom.find('phk-scan-PO-001')&&/roll check is closed/.test(T.text(T.card('PO-001')));
    o['complete: it does NOT do the real cut: no pos write, no status beyond complete, no bundles, the job is not "done"']=T.fk.txs[0].every(p=>!/^pos\/PO-\d+$/.test(p.path))&&T.fk.txs[0][0].data.status!=='done'&&T.fk.plain.length===0;
  }
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    // no scanning at all: Mark complete sends the status alone
    T.click(T.btn(T.card('PO-001'),'Mark complete'));
    T.click(T.btn(T.card('PO-001'),'Yes, mark complete'));await settle(30);
    o['complete: with no roll check made it sends the status alone (no invented checklist)']=T.fk.txs.length===1&&T.fk.txs[0][0].data.status==='complete'&&!('rollsChecklist' in T.fk.txs[0][0].data)&&/^Marked complete$/.test(T.fk.txs[0][1].data.reason);
  }
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    T.click(T.btn(T.card('PO-001'),'Count only'));
    T.type(T.dom.find('phk-cnt-PO-001'),'3');
    T.click(T.btn(T.card('PO-001'),'Save roll check'));await settle(30);
    T.click(T.btn(T.card('PO-001'),'Mark complete'));
    o['complete: an already-saved roll check is not re-sent (only the status)']=!/also saves the roll check/.test(T.text(T.card('PO-001')));
    T.click(T.btn(T.card('PO-001'),'Yes, mark complete'));await settle(30);
    o['complete: so the second transaction carries status only']=T.fk.txs.length===2&&T.fk.txs[1][0].data.status==='complete'&&!('rollsChecklist' in T.fk.txs[1][0].data);
  }
  if(want('writes')){grp='writes';
    // a stale revision, an offline press, a refusing database
    const T=mk('uzaib');
    await T.open();
    T.scan('PO-001','R-101');
    T.fk.store['po_cut_jobs/PO-001'].rev=7;   // someone else changed it
    const r=await T.R('phkSaveChecklist("PO-001")');
    o['stale: someone else changed the job -> refused with their revision, nothing written, a Reload button offered']=r.ok===false&&r.code==='stale'&&T.fk.txs.length===0&&/changed by someone else/.test(T.text(T.card('PO-001')))&&!!T.btn(T.card('PO-001'),'Reload the latest');
    o['stale: the unsaved scan work is kept (not lost to the refusal)']=T.R('phkWork("PO-001").present["R-101"]')===true&&T.R('phkWork("PO-001").dirty')===true;
  }
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    T.scan('PO-001','R-101');
    T.ctx.navigator.onLine=false;
    const r=await T.R('phkSaveChecklist("PO-001")');
    o['offline: refused out loud (a transaction cannot be queued), nothing written, the scan work is kept']=r.ok===false&&r.code==='offline'&&T.fk.txs.length===0&&/No connection/.test(T.text(T.card('PO-001')))&&T.R('phkWork("PO-001").present["R-101"]')===true;
  }
  if(want('writes')){grp='writes';
    const T=mk('uzaib',{txFail:PERM});
    await T.open();
    T.scan('PO-001','R-101');
    const r=await T.R('phkSaveChecklist("PO-001")');
    o['refused by the database: the message says so (republish the rules), no success claimed']=r.ok===false&&r.code==='permission'&&/Refused by the database rules/.test(T.text(T.card('PO-001')))&&!/Saved/.test(T.text(T.card('PO-001')));
  }
  if(want('writes')){grp='writes';
    const T=mk('uzaib');
    await T.open();
    T.scan('PO-001','R-101');
    const p1=T.R('phkSaveChecklist("PO-001")'),p2=T.R('phkSaveChecklist("PO-001")');
    const [a,b]=await Promise.all([p1,p2]);
    o['a double press is ONE save (the second is told a save is already running)']=T.fk.txs.length===1&&((a.ok&&b.code==='busy')||(b.ok&&a.code==='busy'));
  }

  /* ── who can do what ── */
  if(want('who')){grp='who';
    const U=mk('uzaib',{allPOs:[Object.assign({fbKey:'PO-001'},po('PO-001'))]});
    await U.open();
    o['uzaib: the roll check and Mark complete are his']=!!U.btn(U.card('PO-001'),'Save roll check')&&!!U.btn(U.card('PO-001'),'Mark complete');
    o['uzaib: NO "Record the cut" button']=!U.btn(U.card('PO-001'),'Record the cut');
    o['uzaib: the tab says what he may do']=/Roll check and Mark complete only/.test(U.text(U.panel()));
    const r=U.R('phkRecordCut("PO-001")');
    o['uzaib: even called directly, Record the cut is refused and the cutting screen is not opened']=r.ok===false&&r.code==='forbidden'&&U.opened.length===0;
    o['uzaib: he can do nothing else: no master / date / status controls exist in the card']=U.dom.all(U.card('PO-001'),n=>n.tagName==='SELECT').length===0&&!U.btn(U.card('PO-001'),'Override')&&!U.btn(U.card('PO-001'),'Reassign');
  }
  if(want('who')){grp='who';
    const M=mk('mustafa',{allPOs:[Object.assign({fbKey:'PO-001'},po('PO-001'))]});
    await M.open();
    o['a manager: sees Record the cut on a PO that is at the cutting stage']=!!M.btn(M.card('PO-001'),'Record the cut');
    o['a manager: no "roll check and Mark complete only" chip']=!/Roll check and Mark complete only/.test(M.text(M.panel()));
    M.click(M.btn(M.card('PO-001'),'Record the cut'));
    o['a manager: Record the cut opens the EXISTING cutting screen (openStageWork PO-001 cutting) and writes nothing']=J(M.opened)===J([['PO-001','cutting']])&&M.fk.txs.length===0&&M.fk.plain.length===0;
    o['a manager: the takeover lets go when the cutting screen opens (currentPage left prod-ops)']=!M.dom.body.classList.contains('ph-fullscreen');
  }
  if(want('who')){grp='who';
    const M=mk('afnan',{allPOs:[]});
    await M.open();
    M.click(M.btn(M.card('PO-001'),'Record the cut'));
    o['a manager: when the PO list is not loaded, Record the cut says so (a toast) and opens nothing']=M.opened.length===0&&M.a.state.toasts.some(t=>/Open PO-001 from PO Registry/.test(t));
  }
  if(want('who')){grp='who';
    const d=baseData();d['pos/PO-001']=po('PO-001',{currentStage:'bundling'});
    const M=mk('afnan',{data:d,allPOs:[Object.assign({fbKey:'PO-001'},d['pos/PO-001'])]});
    await M.open();
    o['a manager: a PO already past cutting shows no Record the cut, and says the cut is recorded']=!M.btn(M.card('PO-001'),'Record the cut')&&/already recorded \(the PO is at bundling\)/.test(M.text(M.card('PO-001')));
  }
  if(want('who')){grp='who';
    const R=mk('raees');
    await R.ctx.window.showPage('prod-ops');await settle();
    o['someone off the audience (raees) gets no tab at all']=R.R('phTabsFor().length')===0&&!R.card('PO-001');
  }
  if(want('who')){grp='who';
    const U=mk('uzaib');
    o['registry: the cutting tab is this module\'s render, still open to the whole audience (uzaib sees it)']=U.R('phTabsFor("uzaib").some(t=>t.id==="cutting")')===true&&U.R('PH_TABS.filter(t=>t.id==="cutting")[0].render===phkRenderTab')===true&&U.R('PH_TABS.filter(t=>t.id==="cutting")[0].label')==="Today's Cutting";
    o['registry: the other tabs were left alone (still placeholders)']=U.R('PH_TABS.filter(t=>t.id!=="cutting").every(t=>t.render!==phkRenderTab)');
  }

  /* ── the preview calculator ── */
  if(want('preview')){grp='preview';
    const T=mk('uzaib');
    await T.open();
    T.click(T.btn(T.card('PO-001'),'Check a cut quantity (preview)'));
    o['preview: opens on demand, says nothing is saved']=/Nothing is saved and nothing is recorded/.test(T.text(T.card('PO-001')))&&!!T.dom.find('phk-cut-PO-001-S');
    T.type(T.dom.find('phk-cut-PO-001-S'),'30');T.type(T.dom.find('phk-cut-PO-001-M'),'60');T.type(T.dom.find('phk-cut-PO-001-L'),'60');T.type(T.dom.find('phk-cut-PO-001-XL'),'30');
    o['preview: 180 of 240 is inside the 70-130% gate (168-312) and says so']=/Cut so far: 180 pcs of 240 ordered/.test(T.text(T.card('PO-001')))&&/✓ Inside the gate: 168–312 pcs \(70–130% of 240\)/.test(T.text(T.card('PO-001')));
    T.type(T.dom.find('phk-cut-PO-001-S'),'1');
    o['preview: 151 is outside it and says an owner or Mustafa must approve a variance first']=/✗ Outside the gate/.test(T.text(T.card('PO-001')))&&/owner or Mustafa/.test(T.text(T.card('PO-001')));
    await settle();
    o['preview: it writes nothing at all']=T.fk.txs.length===0&&T.fk.plain.length===0;
  }

  /* ── XSS ── */
  if(want('xss')){grp='xss';
    const HOST='<img src=x onerror="alert(1)">';
    const d=baseData();
    d['pos/PO-001']=po('PO-001',{name:HOST,code:'<b>X</b>'});
    d.po_cut_jobs[0]=job('PO-001',{masterName:'<script>bad()</script>',note:'<i>note</i>'});
    d.gatepasses=[Object.assign({},PASS1,{fabrics:[{fabType:'<u>Jersey</u>',gsm:180,color:'<svg onload=x>',unit:'kg',rollCodes:['<R>1'],weight:5}],ribRollCodes:[]})];
    const T=mk('uzaib',{data:d});
    await T.open();
    const card=T.card('PO-001');
    o['XSS: a hostile article name, master, note, fabric and roll code reach the page only as text (no element is created from them)']=T.text(card).indexOf(HOST)>-1&&T.dom.all(card,n=>/^(IMG|SCRIPT|SVG|B|I|U)$/.test(n.tagName)).length===0&&domkit.toHtml(card).indexOf('<img')===-1&&domkit.toHtml(card).indexOf('<script')===-1;
    T.scan('PO-001','<b>bad</b>');
    o['XSS: a scanned hostile code is shown as text too']=/&lt;B&gt;BAD&lt;\/B&gt;/.test(domkit.toHtml(T.card('PO-001')))&&T.dom.all(T.card('PO-001'),n=>n.tagName==='B').length===0;
    o['XSS: the source never assigns innerHTML / outerHTML / insertAdjacentHTML or parses a string as HTML']=!/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|DOMParser|document\.write/.test(src.replace(/\/\*[\s\S]*?\*\//g,''));
  }

  /* ── source guards ── */
  if(want('source')){grp='source';
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:'"])\/\/.*$/gm,'$1');
    o['read/write scope: the source calls no Firestore write API and writes only through phSaveCutJob']=!/\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(code)&&/\bphSaveCutJob\(/.test(code)&&!/\bphAppendHistory\(|\bphMasterAdd\(|\bphStandardSave\(|\bphSettingsSave\(|\bphSaveDraft\(/.test(code);
    o['read/write scope: it reads only pos/{id} (getDoc) and gatepasses (getDocs), nothing else']=(src.match(/\b(?:getDoc|getDocs)\(/g)||[]).length===2&&/getDoc\(doc\(db,'pos',poId\)\)/.test(src)&&/collection\(db,'gatepasses'\),q,limit/.test(src)&&/where\('poId','in',spell\)/.test(src);
    o['the real cutting-done is not reimplemented: markCuttingDone / cutState / bundles are not referenced; only openStageWork is called']=!/markCuttingDone|cutState|pendingBundles|counters\/main|getNextId|createWithNextId/.test(code)&&/openStageWork\(id,'cutting'\)/.test(code);
    const names=[];(code.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)||[]).forEach(l=>{const m=/(?:function\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/.exec(l);if(m)names.push(m[1]);});
    o['globals: every top-level name is phk / _phk / PHK_ prefixed']=names.length>30&&names.every(n=>/^(?:phk|_phk|PHK_)/.test(n));
    o['globals: none of those names is declared in any other js/ file (one lexical scope)']=names.every(n=>!new RegExp('^(?:async\\s+)?function\\s+'+n.replace(/\$/g,'\\$')+'\\b|^(?:const|let|var)\\s+'+n.replace(/\$/g,'\\$')+'\\b','m').test(OTHERS));
    o['the tolerance is a documented default, not buried: two named constants and a comment that says so']=/const PHK_WEIGHT_TOL_PCT=2;/.test(src)&&/const PHK_WEIGHT_TOL_ABS=0\.5;/.test(src)&&/DEFAULT/.test(src);
    o['the tab registers itself with phRegisterTab("cutting", { render }) and changes nothing else about the tab']=/phRegisterTab\('cutting',\{render:phkRenderTab\}\)/.test(src);
  }
  return o;
}

async function wiring(s){
  s.section('wiring: script order, precache, stylesheet');
  const html=read('index.html'),sw=read('sw.js');
  const tag=f=>html.indexOf('/js/'+f+'?v=');
  s.ok('ph-mod-cutting.js has ONE script tag, after ph-ui.js and before the Firebase module',tag('ph-mod-cutting.js')>tag('ph-ui.js')&&tag('ph-ui.js')>0&&html.indexOf('<script type="module">')>tag('ph-mod-cutting.js')&&html.split('/js/ph-mod-cutting.js').length===2&&/<script src="\/js\/ph-mod-cutting\.js\?v=[0-9a-z]+"><\/script>/.test(html));
  s.ok('it is in PRECACHE_URLS (once, after ph-ui.js)',sw.indexOf("'/js/ph-mod-cutting.js'")>sw.indexOf("'/js/ph-ui.js'")&&sw.split("'/js/ph-mod-cutting.js'").length===2);
  s.section('stylesheet contract');
  const a=CSS.indexOf('/* ph-mod-cutting START */'),b=CSS.indexOf('/* ph-mod-cutting END */');
  s.ok('one delimited block, in the trailing run of ph-mod-* blocks at the end of the stylesheet',a>0&&b>a&&CSS.indexOf('/* ph-mod-cutting START */',a+1)<0&&CSS.slice(b+'/* ph-mod-cutting END */'.length).replace(/\/\* ph-mod-[a-z]+ START \*\/[\s\S]*?\/\* ph-mod-[a-z]+ END \*\//g,'').trim()==='');
  const blk=CSS.slice(a,b).replace(/\/\*[\s\S]*?\*\//g,'');
  s.ok('tokens only: no literal colour in the block',!/#[0-9a-fA-F]{3,8}\b/.test(blk)&&!/\b(?:rgb|rgba|hsl|hsla)\(/.test(blk));
  s.ok('every selector is .phk- prefixed (no collision with another module)',(blk.match(/[^{}]+(?=\{)/g)||[]).filter(sel=>!/^\s*@media/.test(sel)).every(sel=>sel.split(',').every(p=>/\.phk-/.test(p))));
  s.ok('text sizes: nothing under 12px; inputs 16px (no zoom on focus)',!/font-size:(?:[0-9]|1[01])(?:\.\d+)?px/.test(blk)&&/\.phk-in\{[^}]*font-size:16px/.test(blk));
  s.ok('touch targets: buttons, inputs and roll rows are 48px tall',/\.phk-btn\{min-height:48px/.test(blk)&&/\.phk-in\{[^}]*min-height:48px/.test(blk)&&/\.phk-roll-b\{[^}]*min-height:48px/.test(blk));
  s.ok('wide screens: the card is two columns from 900px',/@media \(min-width:900px\)\{[^@]*\.phk-card-body\{grid-template-columns:minmax\(0,5fr\) minmax\(0,6fr\)/.test(blk));
  s.ok('phone first: the card body is a single column by default',/\.phk-card-body\{display:grid;grid-template-columns:minmax\(0,1fr\)/.test(blk));
  s.ok('reduced motion: the one transition is switched off',/prefers-reduced-motion:reduce\)\{\.phk-roll-b\{transition:none\}/.test(blk));
  s.ok('the ink on the active mode button is --on-dark (anything painted on --dark takes its ink from it)',/\.phk-seg-b\.on\{background:var\(--dark\);border-color:var\(--dark\);color:var\(--on-dark\)\}/.test(blk));
  const used=new Set();(SRC.match(/'(?:[^']*\s)?phk-[a-z0-9-]+(?:\s[^']*)?'/g)||[]).forEach(str=>(str.match(/phk-[a-z0-9-]+/g)||[]).forEach(c=>used.add(c)));
  const defined=new Set((blk.match(/\.phk-[a-z0-9-]+/g)||[]).map(c=>c.slice(1)));
  const dynamic=['phk-scan-','phk-wt-','phk-cnt-','phk-cw-','phk-cut-'];   // ids, not classes
  const hooks=['phk-info','phk-check','phk-head'];                         // structural hooks with no rule of their own
  const missing=[...used].filter(c=>!defined.has(c)&&hooks.indexOf(c)<0&&!/-$/.test(c)&&!dynamic.some(d=>c.indexOf(d)===0));
  s.ok('every phk- class the script uses has a rule (or is an id)',missing.length===0,missing.join(','));
}

module.exports=async function(){
  const s=suite('ph-mod-cutting');
  const base=await checks(SRC);
  s.section("Today's Cutting");
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  await wiring(s);

  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const pairs=Array.isArray(from)?from:[[from,to]];
    let mut=SRC;
    for(const [f,t] of pairs){
      if(mut.split(f).length-1<1){s.ok('break target exists: '+label+' ('+f.slice(0,50)+')',false);return;}
      mut=mut.split(f).join(t);
    }
    const need=[...new Set(failing.map(f=>GROUP[f]).filter(Boolean))];
    let r;try{r=await checks(mut,need);}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{
      if(!(f in base)){s.ok('break "'+label+'": the named check exists ('+f.slice(0,50)+')',false);return;}
      broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);
    });
  };
  await brk('today by the UTC day',"function phkToday(now){return phDay(typeof now==='number'?now:Date.now());}","function phkToday(now){return new Date(typeof now==='number'?now:Date.now()).toISOString().slice(0,10);}",['days: "today" is the PKT day, not the UTC one (20:00 UTC on 12 Oct is 13 Oct in Pakistan)']);
  await brk('overdue includes finished jobs',"else if(pd<today&&r.status==='open')out.overdue.push(r);","else if(pd<today)out.overdue.push(r);",['days: today = the jobs planned for the PKT day (complete ones stay visible); overdue = OPEN and earlier; future, finished-yesterday and undated are neither; the undated one is counted']);
  await brk('outward process passes counted as the issue',"return(Array.isArray(p.fabrics)&&p.fabrics.length>0)||!p.gpReason;","return true;",['issue: 6 rolls = 3 + 2 fabric rolls + 1 rib roll, from the fabric issue only (the outward process pass and a garments pass are ignored)']);
  await brk('rib rolls dropped',"if(Array.isArray(p.ribRollCodes)&&p.ribRollCodes.length){","if(false){",['issue: 6 rolls = 3 + 2 fabric rolls + 1 rib roll, from the fabric issue only (the outward process pass and a garments pass are ignored)','verdict: every roll present = 6 of 6, no mismatch']);
  await brk('a roll on two passes counted twice',"const fresh=codes.filter(function(c){return!seen[c];});","const fresh=codes;",['issue: a roll on two passes is one roll']);
  await brk('kg and m added together',"out.mixedUnits=units.length>1;","out.mixedUnits=false;",['issue: kg and m are never added together: the weight is unknown and the units are said to differ']);
  await brk('a partial weight sum',"if(!out.mixedUnits&&out.groups.every(function(g){return g.weight!==null;})){","if(!out.mixedUnits){",['issue: one unrecorded group weight makes the total unknown (null), never a partial sum']);
  await brk('a missing roll blocks the save',"out.mismatch=out.flags.length>0;\n  out.ok=true;","out.mismatch=out.flags.length>0;\n  out.ok=!out.mismatch;",['verdict: a missing roll is flagged (missing 1) and the code is named, but the check is still SAVABLE (never blocked)','save: a MISMATCH (rib roll missing + a stray code) is SAVED flagged, never blocked']);
  await brk('extras not flagged',"if(extra>0){out.flags.push(extra+(extra===1?' roll not on the issue':' rolls not on the issue'));out.flagsD.push(phI18nD('cut.n_w',{n:extra,w:phI18nD(extra===1?'cut.roll_noton_one':'cut.roll_noton_many')}));}","",['verdict: a code that is not on the issue is an EXTRA, flagged, still savable']);
  await brk('weight never flagged',"out.flag=Math.abs(out.diff)>out.tol;","out.flag=false;",['weight: 3.1 kg over is outside the tolerance: short 1, flagged, the sentence says over and the limit','tolerance: on 100 kg the limit is 2 (the percent), 2.00 passes and 2.01 is flagged']);
  await brk('the absolute floor dropped',"out.tol=phRound(Math.max(issuedWeight*PHK_WEIGHT_TOL_PCT/100,PHK_WEIGHT_TOL_ABS),2);","out.tol=phRound(issuedWeight*PHK_WEIGHT_TOL_PCT/100,2);",['tolerance: on 10 kg the 0.5 floor applies (2% would be 0.2): 0.5 passes, 0.6 is flagged']);
  await brk('a bad weight ignored',"if(n===null||n<=0){out.problems.push(phI18nD('cut.err_weight_number'));return out;}","",['weight: a weight that is not a positive number is not savable, never ignored']);
  await brk('an empty count read as zero',"const n=raw===''?null:phWhole(raw);","const n=raw===''?0:phWhole(raw);",['count mode: an empty or non-whole count is not savable yet (and says what to do), never read as zero']);
  await brk('summary not cut to the history limit',"return s.length>PHK_REASON_MAX?s.slice(0,PHK_REASON_MAX-1)+'…':s;\n}","return s;\n}",['verdict: the summary fits the history reason (<= 480 characters) however many codes are missing']);
  await brk('an unknown code ticked present',"if(issue.byCode[code]){\n    if(w.present[code]===true){","if(true){\n    if(w.present[code]===true){",['scan: a code that is not on the issue is an EXTRA, shown, flagged in the summary']);
  await brk('case-sensitive codes',"function phkNormCode(c){return String(c==null?'':c).trim().toUpperCase();}","function phkNormCode(c){return String(c==null?'':c).trim();}",['scan: a code on the issue (any case) is ticked present on Enter, the field is cleared, the roll shows ✓ Present']);
  await brk('Enter does not submit',"if(k==='Enter'||(k==='Tab'&&String(inp.value||'').trim()!==''))","if(false)",['scan: a code on the issue (any case) is ticked present on Enter, the field is cleared, the roll shows ✓ Present']);
  await brk('Tab on an empty field swallowed',"(k==='Tab'&&String(inp.value||'').trim()!=='')","(k==='Tab')",['scan: Tab with a code typed submits it (and keeps focus in the field); Tab on an empty field is left alone']);
  await brk('a duplicate scan counted as a new extra',"if(w.dups.indexOf(code)<0)w.dups.push(code);","w.extras.push(code);",['scan: the same code again is noted, counted once']);
  await brk('a blank scan recorded',"if(!code)return{kind:'empty'};","",['scan: a blank scan does nothing']);
  await brk('scan before the issue is loaded ticks anyway',"if(!issue){_phkSay(w,'err',phI18nD('cut.err_issue_not_loaded'));return{kind:'unavailable',code:code};}","",['scan: with the issue unloaded a scan is refused (kind "unavailable"), nothing is ticked']);
  await brk('nothing-scanned save allowed',"if(!res.active)return Promise.resolve({ok:false,code:'invalid',error:phI18nD('cut.err_scan_first')});","",['save: nothing scanned yet is refused, nothing written']);
  await brk('the checklist is written with a plain setDoc',"r=await phSaveCutJob(poId,input,{reason:reason,expectedRev:typeof job.rev==='number'?job.rev:undefined});","await setDoc(doc(db,'po_cut_jobs',poId),input);r={ok:true,job:Object.assign({},job,input)};",['read/write scope: the source calls no Firestore write API and writes only through phSaveCutJob','save: ONE transaction holds the job update and the pos history row']);
  await brk('no expected revision (a stale save overwrites)',"expectedRev:typeof job.rev==='number'?job.rev:undefined","expectedRev:undefined",['stale: someone else changed the job -> refused with their revision, nothing written, a Reload button offered']);
  await brk('the history reason dropped (no codes recorded)',"{reason:reason,expectedRev","{reason:'',expectedRev",['save: the history row names the codes (MISSING RB-1 / NOT ON THE ISSUE STRAY-1) in its reason and is a cut_job_updated row by uzaib']);
  await brk('a double press saves twice',"if(w.busy)return{ok:false,code:'busy',error:phI18nD('cut.save_running')};","",['a double press is ONE save (the second is told a save is already running)']);
  await brk('a failed save claims success',"_phkSay(w,'err',(r&&r.error)||phI18nD('cut.could_not_save'),{reload:!!(r&&(r.code==='stale')),code:r&&r.code});","_phkSay(w,'ok','Saved.');",['refused by the database: the message says so (republish the rules), no success claimed','offline: refused out loud (a transaction cannot be queued), nothing written, the scan work is kept']);
  await brk('the dirty checklist not sent with Mark complete',"if(res.ok&&res.active&&w.dirty){","if(false){",['complete: Yes writes status complete + the unsaved roll check in ONE transaction (job + history)']);
  await brk('an already-saved checklist re-sent with Mark complete',"if(res.ok&&res.active&&w.dirty){","if(res.ok&&res.active){",['complete: so the second transaction carries status only']);
  await brk('Mark complete without asking',"if(dis)return;w.confirming=true;_phkPaintDyn(poId);","if(dis)return;phkMarkComplete(poId);",['complete: the first press only ASKS (Yes / Cancel); nothing is written']);
  await brk('Mark complete does the real cut (status done)',"const input={status:'complete'};","const input={status:'done'};",['complete: it does NOT do the real cut: no pos write, no status beyond complete, no bundles, the job is not "done"']);
  await brk('the checklist stays open on a complete job',"function _phkCanEdit(job){return!!job&&job.status==='open'&&","function _phkCanEdit(job){return!!job&&",['complete: the card now reads Complete and the edit controls are gone (the roll check is closed)']);
  await brk('Record the cut shown to everyone',"if(_phkCtx&&_phkCtx.canManage&&entry&&entry.po.state==='ok'){","if(entry&&entry.po.state==='ok'){",['uzaib: NO "Record the cut" button']);
  await brk('Record the cut not guarded in the function',"if(typeof phCanManage!=='function'||!phCanManage()){return{ok:false,code:'forbidden',error:phI18nD('cut.record_managers')};}","",['uzaib: even called directly, Record the cut is refused and the cutting screen is not opened']);
  await brk('Record the cut does not let go of the takeover',"if(typeof _phTkOnPage==='function')_phTkOnPage();","",['a manager: the takeover lets go when the cutting screen opens (currentPage left prod-ops)']);
  await brk('Record the cut opens a PO the list does not hold',"if(typeof window==='undefined'||typeof window.openStageWork!=='function'||!known){","if(typeof window==='undefined'||typeof window.openStageWork!=='function'){",['a manager: when the PO list is not loaded, Record the cut says so (a toast) and opens nothing']);
  await brk('Record the cut offered after the cut',"if(po&&po.poStatus!=='cancelled'&&cs==='cutting'&&job.status!=='done'){","if(po){",['a manager: a PO already past cutting shows no Record the cut, and says the cut is recorded']);
  await brk('a failed gate-pass read looks like no fabric issue',"return{state:'error',passes:null,issue:null,text:_phkErrText('gatepasses for '+poId,e)};","return{state:'ok',passes:[],issue:phkIssueFromPasses([]),text:''};",['failed fabric-issue read: the card names gatepasses and offers Try again, and does NOT say "no fabric issue" or show a roll list']);
  await brk('an offline-copy answer trusted',"function _phkFromCache(snap){return typeof _phFromCache==='function'?_phFromCache(snap):!!(snap&&snap.metadata&&snap.metadata.fromCache===true);}","function _phkFromCache(snap){return false;}",['an offline-copy answer for the fabric issue is a failure, not "no rolls"']);
  await brk('a failed PO read invents an empty PO',"return{state:'error',data:null,text:_phkErrText('pos/'+poId,e)};","return{state:'ok',data:{},text:''};",['failed PO read: the card says pos/PO-001 could not be read, with Try again, and no article / quantity is invented']);
  await brk('a failed jobs read drawn as an empty day',"if(!jobs||!jobs.ok){","if(false){",['failed jobs read: an alert names po_cut_jobs with Retry; no cards, no "0 jobs", no "no cut jobs are planned"']);
  await brk('the loading state shows the checklist',"if(!entry||entry.issue.state==='loading'){kids.push(_phkE('p','phk-muted',phI18nD('cut.reading_issue')));return _phkE('div','phk-col phk-check',null,kids);}","",['loading: before the PO / fabric reads settle the card says it is reading, and shows no roll count and no input']);
  await brk('the gate preview writes',"w.cut[z]=i.value;paint();","w.cut[z]=i.value;paint();phSaveCutJob(poId,{note:'x'});",['preview: it writes nothing at all']);
  await brk('the gate verdict ignores an approved variance',"else if(override)verdict='override';","",['gate: an approved variance (po.cutOverride) is shown as such, any quantity']);
  await brk('a stored string parsed as HTML',"function _phkE(tag,cls,text,kids){return(_phkCtx&&_phkCtx.el?_phkCtx.el:phEl)(tag,cls,text,kids);}","function _phkE(tag,cls,text,kids){const n=(_phkCtx&&_phkCtx.el?_phkCtx.el:phEl)(tag,cls,null,kids);if(text!=null)n.innerHTML=text;return n;}",['XSS: the source never assigns innerHTML / outerHTML / insertAdjacentHTML or parses a string as HTML']);
  await brk('the codes are not sent (counts only, as before)',"Object.assign({},res&&res.counts,{missingCodes:m.list,extraCodes:x.list})","Object.assign({},res&&res.counts)",['save: the WHICH-rolls detail is stored inside rollsChecklist (missingCodes ["RB-1"], extraCodes ["STRAY-1"]); the job update still carries only the same four keys','save (count mode): no codes exist, so both lists are sent EMPTY (a re-save clears an older list)']);
  await brk('the saved card hides the codes',"if(mc||ec){","if(false){",['save: the saved card prints the codes (Missing: RB-1 / Not on the issue: STRAY-1), not only the counts']);
  await brk('a code is not clipped to 40',"const t=String(c==null?'':c).trim().slice(0,PHK_CODE_LEN);","const t=String(c==null?'':c).trim();",['codes: a code over 40 characters is clipped to 40, an empty one is dropped, a repeat is one','codes: a 60-character stray code (a scanner can type anything) still SAVES, clipped to 40 (never blocked)']);
  await brk('the list is not capped',"if(out.length<PHK_CODES_MAX)out.push(t);else left++;","out.push(t);",['codes: a list longer than 200 is clipped to 200, the rest is counted in left, and the counts still say 251']);
  await brk('Mark complete saves counts only',"input.rollsChecklist=phkChecklistForSave(res).checklist;","input.rollsChecklist=res.counts;",['complete: the roll check goes with its code lists (5 missing codes, none extra)']);
  await brk('a global without the prefix',"function phkNormCode(c){","function normCode(c){return phkNormCode(c);}\nfunction phkNormCode(c){",['globals: every top-level name is phk / _phk / PHK_ prefixed']);
  s.ok('breaks run: '+broken,broken>=45,String(broken));
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   Cutting / Issue Registry — the cut-date filter (js/fabric.js)

   The registry is how Afnan answers "what got cut on the 14th", so the date
   filter has to agree with three things at once: the rows listed, the
   headline totals above them, and the Excel export. Each is a separate code
   path over the same filtered set, and they drifting apart is the failure
   this suite exists to catch.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const _esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Local YYYY-MM-DD, n days back from today — the same convention the app
// uses. Built here rather than hardcoded so the suite doesn't go stale.
function day(n){
  const d=new Date();d.setDate(d.getDate()-(n||0));
  const p=x=>String(x).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
const TODAY=day(0),YESTERDAY=day(1),THREE=day(3),TWENTY=day(20);

function issue(o){
  return Object.assign({
    gpType:'fabric',id:'GP-'+o.poId,poId:'PO-000',articleName:'Tee',articleCode:'GP1',
    fabricType:'Jersey',fabricGsm:240,fabricColor:'Black',fabricUnit:'kg',
    plannedQty:0,totalBundles:0,fabricQty:0,rollsCount:1,avgConsumption:0,
    sizeBreakdown:[],issuer:'Uzaib',cutMaster:'Hassan'
  },o);
}

// Newest first is what _fabIssueRecords() sorts to; ts drives that order.
const PASSES=[
  issue({id:'GP-1',poId:'PO-001',date:TODAY,    ts:5000,plannedQty:100,totalBundles:4,fabricQty:25}),
  issue({id:'GP-2',poId:'PO-002',date:TODAY,    ts:4000,plannedQty:50, totalBundles:2,fabricQty:15}),
  issue({id:'GP-3',poId:'PO-003',date:YESTERDAY,ts:3000,plannedQty:80, totalBundles:3,fabricQty:20}),
  issue({id:'GP-4',poId:'PO-004',date:THREE,    ts:2000,plannedQty:70, totalBundles:3,fabricQty:18}),
  issue({id:'GP-5',poId:'PO-005',date:TWENTY,   ts:1000,plannedQty:60, totalBundles:2,fabricQty:12}),
  // No `date` field at all — an older record. Its day falls back to `ts`.
  issue({id:'GP-6',poId:'PO-006',ts:new Date(YESTERDAY+'T09:00:00').getTime(),plannedQty:10,totalBundles:1,fabricQty:5}),
  // Neither date nor ts: unplaceable in time.
  issue({id:'GP-7',poId:'PO-007',ts:0,plannedQty:7,totalBundles:1,fabricQty:3}),
  // Not a fabric issue — must never appear in this registry at all.
  {id:'GP-X',gpType:'garments',date:TODAY,ts:9000,plannedQty:999}
];

function app(extra){
  const sheets=[];
  const a=loadApp({files:['js/fabric.js'],globals:Object.assign({
    currentPage:'',
    allPasses:PASSES.map(p=>Object.assign({},p)),
    allFabricInventory:[],allFabricMovements:[],allPOs:[],
    _gpEsc:_esc,
    XLSX:{
      utils:{aoa_to_sheet:aoa=>({aoa}),book_new:()=>({}),book_append_sheet:(wb,ws)=>{wb.ws=ws;}},
      writeFile:(wb,name)=>sheets.push({aoa:wb.ws.aoa,name})
    }
  },extra||{})});
  a.sheets=sheets;
  return a;
}
const ids=a=>a.run('_fabRegFiltered().map(g=>g.id).join(",")');
const preset=(a,p)=>a.run(`(_fabRegDate={preset:'${p}',from:'',to:''},1)`);

module.exports=function(){
  const s=suite('fabric');

  s.section('the registry only ever holds fabric issues');
  {
    const a=app();
    s.eq('a garments gate pass is not an issue',a.run('_fabIssueRecords().some(g=>g.id==="GP-X")'),false);
    s.eq('all seven fabric issues are',a.run('_fabIssueRecords().length'),7);
  }

  s.section('presets select the right days');
  {
    const a=app();
    s.eq('all — every issue, including the undateable one',ids(a),'GP-1,GP-2,GP-6,GP-3,GP-4,GP-5,GP-7');
    preset(a,'today');
    s.eq('today',ids(a),'GP-1,GP-2');
    preset(a,'yesterday');
    // GP-6 carries no `date`, so its day comes from `ts` — and it lands here.
    s.eq('yesterday, incl. the record with only a ts',ids(a),'GP-6,GP-3');
    preset(a,'week');
    s.eq('last 7 days',ids(a),'GP-1,GP-2,GP-6,GP-3,GP-4');
    s.eq('20 days ago is outside it',ids(a).indexOf('GP-5'),-1);
  }

  s.section('an entry with no day at all is excluded from a bounded range');
  {
    // It cannot be PROVED to sit in the range, so a range must not claim it.
    const a=app();
    preset(a,'today');
    s.eq('not in today',ids(a).indexOf('GP-7'),-1);
    preset(a,'all');
    s.ok('but never hidden from All',ids(a).indexOf('GP-7')>-1,ids(a));
  }

  s.section('custom range is inclusive at both ends');
  {
    const a=app();
    a.run(`(_fabRegDate={preset:'custom',from:'${THREE}',to:'${YESTERDAY}'},1)`);
    s.eq('from..to keeps both boundary days',ids(a),'GP-6,GP-3,GP-4');
    a.run(`(_fabRegDate={preset:'custom',from:'${YESTERDAY}',to:''},1)`);
    s.eq('an open end means unbounded',ids(a),'GP-1,GP-2,GP-6,GP-3');
    a.run(`(_fabRegDate={preset:'custom',from:'',to:'${THREE}'},1)`);
    s.eq('and so does an open start',ids(a),'GP-4,GP-5');
  }

  s.section('a backwards custom range is refused, not silently applied');
  {
    const a=app();
    a.el('fab-reg-from').value=TODAY;
    a.el('fab-reg-to').value=TWENTY;
    a.run('window.fabRegApplyCustom()');
    s.ok('it says so',/after/i.test(a.state.toasts.join(' ')),a.state.toasts.join(' '));
    s.eq('and the filter is untouched',a.run('_fabRegDate.preset'),'all');
  }

  s.section('the headline totals follow the filter');
  {
    // The whole point of a date filter: "pieces cut" must mean "cut in the
    // range I picked", not "cut ever".
    const a=app();
    s.ok('all — 377 pcs',/377 pcs/.test(a.run('_fabRegStatsHTML()')),a.run('_fabRegStatsHTML()').slice(0,200));
    preset(a,'today');
    const st=a.run('_fabRegStatsHTML()');
    s.ok('today — 150 pcs',/150 pcs/.test(st));
    s.ok('6 bundles',/>6</.test(st));
    s.ok('40.0 kg out',/40\.0/.test(st));
    s.ok('and it says what it is counting',/2<\/strong> of 7 issues/.test(st)&&/Today/.test(st),st.slice(-200));
  }

  s.section('every filter repaints the totals, not just the list');
  {
    // A stale stat tile above a filtered list is worse than no tile.
    const a=app();
    a.run('renderFabricIssueRegistry()');
    preset(a,'today');
    a.run('_fabRegRepaint()');
    s.ok('stats container is repainted',/150 pcs/.test(a.el('fab-reg-stats').innerHTML));
    a.run('window.fabRegFilter("PO-001")');
    s.ok('search narrows them too',/100 pcs/.test(a.el('fab-reg-stats').innerHTML),a.el('fab-reg-stats').innerHTML.slice(0,160));
    s.ok('and the list agrees',/PO-001/.test(a.el('fab-reg-list').innerHTML)&&!/PO-002/.test(a.el('fab-reg-list').innerHTML));
  }

  s.section('the list is grouped by day, with that day\'s roll-up');
  {
    const a=app();
    const html=a.run('_fabRegListHTML()');
    s.ok('the day is named in full',html.indexOf(a.run(`_fabRegDayLabel('${TODAY}')`))>-1);
    s.ok('with the day total, not the page total',/2 issues · <strong[^>]*>150<\/strong> pcs/.test(html),
      (html.match(/\d+ issues · <strong[^>]*>\d+<\/strong> pcs/g)||[]).join(' | '));
    s.ok('kg is labelled',/40\.0<\/strong> kg/.test(html));
    s.ok('an undateable row still gets a header',/No date/.test(html));
  }

  s.section('each day gets exactly ONE header');
  {
    // GP-6 carries no `date` and a real `ts`, while GP-3 (same day) carries a
    // 1970 `ts` — the shape an entry gets when its date is corrected in Edit.
    // Ordered by `ts` alone they interleave with other days and yesterday
    // renders twice, each header claiming the whole day's totals.
    const a=app();
    const html=a.run('_fabRegListHTML()');
    const heads=(html.match(/\d+ issues? · <strong[^>]*>\d+<\/strong> pcs/g)||[]);
    s.eq('five days, five headers',heads.length,5);
    s.eq('none repeated',new Set(heads).size,heads.length);
    // '' sorts below every real day, so the unplaceable rows land at the end
    // rather than at the top where they would read as the newest cutting.
    const oldest=a.run(`_fabRegDayLabel('${TWENTY}')`);
    s.ok('the undated group sorts last',html.indexOf('No date')>html.indexOf(oldest),
      `No date @${html.indexOf('No date')}, ${oldest} @${html.indexOf(oldest)}`);
  }

  s.section('weights of different units are never added together');
  {
    const a=app({allPasses:[
      issue({id:'GP-A',poId:'PO-A',date:TODAY,ts:2,fabricQty:10,fabricUnit:'kg'}),
      issue({id:'GP-B',poId:'PO-B',date:TODAY,ts:1,fabricQty:40,fabricUnit:'meters'})
    ]});
    const t=a.run(`JSON.stringify([..._fabRegDayTotals(_fabRegFiltered()).values()])`);
    s.eq('kg and meters are separate',t,JSON.stringify([{n:2,pcs:0,bundles:0,kg:10,m:40}]));
  }

  s.section('Export Excel exports what is on screen');
  {
    const a=app();
    preset(a,'today');
    a.run('window.fabExportIssueRegistry()');
    const x=a.sheets[0];
    s.eq('two rows plus header, blank and total',x.aoa.length,5);
    s.eq('only the filtered POs',x.aoa.slice(1,3).map(r=>r[2]).join(','),'PO-001,PO-002');
    s.eq('the total row totals the filtered set',x.aoa[4][8],150);
    s.ok('the range is in the filename',x.name.indexOf(TODAY)>-1,x.name);
    s.ok('and in the toast',/2 issues/.test(a.state.toasts.join(' ')),a.state.toasts.join(' '));
  }

  s.section('nothing in range says so, rather than "no fabric issues"');
  {
    const a=app();
    a.run(`(_fabRegDate={preset:'custom',from:'2001-01-01',to:'2001-01-02'},1)`);
    const html=a.run('_fabRegListHTML()');
    s.ok('names the range that is empty',/No fabric issues for/.test(html),html);
  }

  s.section('opening the registry starts on All dates');
  {
    // It is a historical record, not a feed — defaulting to Today would show
    // an empty page most mornings and read as broken.
    const a=app();
    preset(a,'month');
    a.run('renderFabricIssueRegistry()');
    s.eq('preset reset',a.run('_fabRegDate.preset'),'all');
    s.eq('page reset',a.run('_fabRegPage'),0);
  }

  // ═════════════════════════════════════════════════════════════════════
  // Cutting masters beyond Hassan and Alam (Afnan, Sept 2026)
  // ═════════════════════════════════════════════════════════════════════
  const J=JSON.stringify;
  const MASTER_PASSES=[
    issue({id:'GP-A',poId:'PO-A',date:TODAY,ts:300,cutMaster:'Imran'}),
    issue({id:'GP-B',poId:'PO-B',date:TODAY,ts:200,cutMaster:'  alam '}),   // Alam in another case
    issue({id:'GP-C',poId:'PO-C',date:TODAY,ts:100,cutMaster:'Bilal'}),
    issue({id:'GP-D',poId:'PO-D',date:TODAY,ts:50, cutMaster:''}),
    {id:'GP-G',gpType:'garments',ts:400,cutMaster:'Zafar'}                  // not a fabric issue
  ];
  const mApp=extra=>app(Object.assign({allPasses:MASTER_PASSES.map(p=>Object.assign({},p))},extra||{}));

  s.section('cutting masters — the list is derived from the issues');
  {
    const a=mApp();
    s.eq('Hassan and Alam first, then every recorded name A–Z',J(a.run('_fabCutMasters()')),J(['Hassan','Alam','Bilal','Imran']));
    s.eq('a name in another case is the same master, not a twin',a.run('_fabCutMasters().filter(n=>n.toLowerCase()==="alam").length'),1);
    s.ok('a garments pass contributes nothing',a.run('_fabCutMasters().indexOf("Zafar")<0'));
    const b=app({allPasses:[]});
    s.eq('with no issues at all the two defaults remain',J(b.run('_fabCutMasters()')),J(['Hassan','Alam']));
    const html=a.run('_fabCutMasterOptions("")');
    s.ok('the dropdown ends with "+ Add cutting master…"',/<option value="__new">\+ Add cutting master…<\/option>$/.test(html),html);
    s.ok('and offers the recorded names',/>Imran</.test(html)&&/>Bilal</.test(html));
  }

  s.section('cutting masters — editing an issue never blanks its name');
  {
    // The live bug this replaces: the Edit form listed only Hassan and Alam,
    // so saving an issue cut by anyone else wrote cutMaster:''.
    const a=app({allPasses:[issue({id:'GP-E',poId:'PO-E',date:TODAY,ts:10,cutMaster:'Qasim'})]});
    a.run(`session=${J({uid:'u1',u:'afnan',name:'Afnan',role:'owner'})}`);
    a.run("window.fabRegEdit('GP-E')");
    const modal=a.el('fab-modal-ov').innerHTML;
    s.ok('the Edit form offers the issue\'s own master, selected',/<option value="Qasim" selected>Qasim<\/option>/.test(modal),modal.slice(0,400));
    s.ok('and the add option',/value="__new"/.test(modal));
    const opt=a.run('_fabCutMasterOptions("Nobody On Record")');
    s.ok('a name on no record is still offered when it is the current value',/<option value="Nobody On Record" selected>/.test(opt));
  }

  s.section('cutting masters — the value a save reads');
  {
    const a=mApp();
    a.el('fab-iss-cutmaster').value='  Imran  ';
    s.eq('trimmed',a.run("_fabCutMasterValue('fab-iss-cutmaster')"),'Imran');
    a.el('fab-iss-cutmaster').value='__new';
    s.eq('the "+ Add" row is never saved as a name',a.run("_fabCutMasterValue('fab-iss-cutmaster')"),'');
  }

  s.section('cutting masters — adding one from the dropdown');
  {
    const answers=['  Nadeem   Khan ','imran',null];
    const a=mApp({prompt:()=>answers.shift()});
    const sel=a.el('fab-iss-cutmaster');
    sel.value='Hassan';a.run("window.fabCutMasterChange(document.getElementById('fab-iss-cutmaster'))");
    s.eq('an ordinary pick is remembered as the previous value',sel.dataset.prev,'Hassan');

    sel.value='__new';a.run("window.fabCutMasterChange(document.getElementById('fab-iss-cutmaster'))");
    s.eq('a new name is selected, tidied',sel.value,'Nadeem Khan');
    s.ok('and is now on the list for the next form',a.run('_fabCutMasters().indexOf("Nadeem Khan")>-1'));
    s.ok('the rebuilt dropdown carries it, selected',/<option value="Nadeem Khan" selected>/.test(sel.innerHTML));
    s.ok('the toast says it is saved with the issue',/added/.test(a.state.toasts.join(' ')),a.state.toasts.join(' | '));

    sel.value='__new';a.run("window.fabCutMasterChange(document.getElementById('fab-iss-cutmaster'))");
    s.eq('a name already on the list in another case selects the existing spelling',sel.value,'Imran');
    s.eq('and mints no twin',a.run('_fabCutMasters().filter(n=>n.toLowerCase()==="imran").length'),1);

    sel.value='__new';a.run("window.fabCutMasterChange(document.getElementById('fab-iss-cutmaster'))");
    s.eq('cancelling puts the previous pick back',sel.value,'Imran');
  }

  s.section('cutting masters — the registry search finds them');
  {
    const a=mApp();
    a.run("_fabRegQ='bilal'");
    s.eq('searching a master lists the issues they cut',ids(a),'GP-C');
  }

  s.section('cutting masters — printed on the fabric-issue gate pass');
  {
    let eng=null;
    try{eng=loadApp({files:['js/print-engine.js']});}catch(e){s.ok('print-engine.js loads in the harness',false,String(e.message||e));}
    if(eng){
      eng.run(`fakeDoc=function(){const calls={text:[],pages:1};const base={calls,__groovyFonts:{},__groovyUrdu:true,
        internal:{pageSize:{getWidth:()=>595,getHeight:()=>842}},addPage(){calls.pages++;},
        text(t,x,y){calls.text.push({t:Array.isArray(t)?t.join('|'):String(t),y,page:calls.pages});},
        getTextWidth(t){return String(t).length*5;},splitTextToSize(t){return String(t).split('\\n');}};
        return new Proxy(base,{get(o,k){return k in o?o[k]:function(){return 0;};}});};`);
      const one={id:'GP-102',gpType:'fabric',date:'2026-09-26',time:'10:30',name:'Mustafa',issuer:'Mustafa',
        article:'Jersey 240gsm Black',spec:'PO PO-120 · GST073 · 8 rolls',dest:'Factory',fabricType:'Jersey',fabricGsm:240,
        fabricColor:'Black',rollsCount:8,fabricQty:180,fabricUnit:'kg',documentType:'Gate Pass',documentNumber:'GP-102',issuedBy:'Mustafa'};
      const render=d=>eng.run(`(function(){const d=fakeDoc();_renderGatePass(d,${J(d)});return d.calls;})()`);
      const plain=render(one),withM=render(Object.assign({},one,{cutMaster:'Nadeem Khan'})),both=render(Object.assign({},one,{cutMaster:'Imran',purpose:'Sample run'}));
      const has=(c,t)=>c.text.some(x=>x.t===t);
      s.ok('a new master\'s name is printed, labelled',has(withM,'Cutting master')&&has(withM,'Nadeem Khan'));
      s.ok('in the Purpose slot a fabric issue never fills',!has(withM,'Purpose'));
      s.ok('a pass with no master prints exactly as before',has(plain,'Purpose')&&!has(plain,'Cutting master'));
      s.ok('a pass carrying a purpose keeps it beside the master',has(both,'Purpose')&&has(both,'Sample run')&&has(both,'Imran'));
      // MEASURED: a ninth row pushed a single-fabric issue's signatures onto
      // page 2 (gate-guard box at y=765 of 806). Taking Purpose's place keeps it on one.
      const guard=c=>c.text.find(x=>/Gate Guard/.test(x.t));
      s.eq('a single-fabric issue still prints on ONE page',withM.pages,plain.pages);
      s.eq('with the gate-guard box exactly where it was',guard(withM)&&[guard(withM).page,Math.round(guard(withM).y)].join(':'),guard(plain)&&[guard(plain).page,Math.round(guard(plain).y)].join(':'));
    }
    const gp=require('fs').readFileSync(require('path').join(__dirname,'..','js','gatepass.js'),'utf8');
    s.ok('the legacy (engine-off) PDF follows the same rule',/Cutting master: \$\{_cm\}/.test(gp)&&/rows\[2\]\[1\]=`Cutting master/.test(gp));
    s.ok('the engine path hands the record, cutMaster included, to the variant',/type:'gate-pass',data:Object\.assign\(\{\},gp,/.test(gp));
  }

  return s;
};

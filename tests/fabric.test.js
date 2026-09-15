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

// ── Gate pass registry ────────────────────────────────────────────────────
// Same days as the fabric fixture so the two can be compared directly, but
// a spread of pass TYPES, since a gate pass rolls up by type.
const GP_PASSES=[
  {id:'GP-1',gpType:'garments',date:TODAY,    ts:5000,article:'Tee',dest:'FebKnit',name:'Uzaib',totalUnits:100},
  {id:'GP-2',gpType:'fabric',  date:TODAY,    ts:4000,article:'Jersey',dest:'Al-Hamd',name:'Uzaib',fabricQty:25,fabricUnit:'kg',rollsCount:2},
  {id:'GP-3',gpType:'garments',date:YESTERDAY,ts:3000,article:'Hoodie',dest:'Al-Nisa',name:'Hassan',totalUnits:80},
  {id:'GP-4',gpType:'item',    date:THREE,    ts:2000,article:'Machine',dest:'JR Traders',name:'Hassan',assetItems:[{n:1},{n:2}]},
  {id:'GP-5',gpType:'fabric',  date:TWENTY,   ts:1000,article:'Fleece',dest:'Aqib',name:'Uzaib',fabricQty:40,fabricUnit:'meters'},
  {id:'GP-6',gpType:'garments',ts:new Date(YESTERDAY+'T09:00:00').getTime(),article:'Sando',dest:'FebKnit',name:'Uzaib',totalUnits:10},
  {id:'GP-7',gpType:'garments',ts:0,article:'Cap',dest:'FebKnit',name:'Uzaib',totalUnits:7}
];
// gatepass.js FIRST, fabric.js second — the real index.html order. The date
// helpers therefore do not exist while gatepass.js is executing, which is
// exactly the constraint the guards in that file are written for.
function gpApp(){
  const sheets=[];
  const a=loadApp({files:['js/gatepass.js','js/fabric.js'],globals:{
    currentPage:'',
    allPasses:GP_PASSES.map(p=>Object.assign({},p)),
    allReturns:[],allFabricIn:[],allPOs:[],allGPEditRequests:[],
    allFabricInventory:[],allFabricMovements:[],
    XLSX:{
      utils:{aoa_to_sheet:aoa=>({aoa}),book_new:()=>({}),book_append_sheet:(wb,ws)=>{wb.ws=ws;}},
      writeFile:(wb,name)=>sheets.push({aoa:wb.ws.aoa,name})
    }
  }});
  a.sheets=sheets;
  return a;
}
// The day label out of each day header — the one thing that must appear once
// per day in either registry. Both render it as the only font-weight:800 span
// in the list body.
const dayHeads=html=>(html.match(/font-weight:800">([^<]+)<\/div>/g)||[])
  .map(m=>m.replace(/.*800">/,'').replace('</div>',''));
const gpIds=a=>a.run('_gpRegFiltered().map(p=>p.id).join(",")');
const gpPreset=(a,p)=>a.run(`(_gpRegDate={preset:'${p}',from:'',to:''},1)`);

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
    s.ok('the day is named in full',html.indexOf(a.run(`_gvDayLabel('${TODAY}')`))>-1);
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
    const heads=dayHeads(html);
    s.eq('five days, five headers',heads.length,5);
    s.eq('none repeated',new Set(heads).size,heads.length,heads.join(' | '));
    // '' sorts below every real day, so the unplaceable rows land at the end
    // rather than at the top where they would read as the newest cutting.
    const oldest=a.run(`_gvDayLabel('${TWENTY}')`);
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

  s.section('GATE PASS registry — the same filter, the same helpers');
  {
    // js/fabric.js loads AFTER js/gatepass.js, so the helpers only exist at
    // render time. Loading both in that real order is the point of this
    // fixture: a call moved to load time would throw here.
    const gp=gpApp();
    s.eq('all',gpIds(gp),'GP-1,GP-2,GP-6,GP-3,GP-4,GP-5,GP-7');
    gpPreset(gp,'today');
    s.eq('today',gpIds(gp),'GP-1,GP-2');
    gpPreset(gp,'yesterday');
    s.eq('yesterday, incl. the pass with only a ts',gpIds(gp),'GP-6,GP-3');
    gpPreset(gp,'week');
    s.eq('last 7 days',gpIds(gp),'GP-1,GP-2,GP-6,GP-3,GP-4');
    gp.run(`(_gpRegDate={preset:'custom',from:'${THREE}',to:'${YESTERDAY}'},1)`);
    s.eq('custom is inclusive at both ends',gpIds(gp),'GP-6,GP-3,GP-4');

    s.section('and an undateable pass is treated identically');
    gpPreset(gp,'today');
    s.eq('excluded from a bounded range',gpIds(gp).indexOf('GP-7'),-1);
    gpPreset(gp,'all');
    s.ok('never hidden from All',gpIds(gp).indexOf('GP-7')>-1,gpIds(gp));
  }

  s.section('the two registries can never disagree about a preset');
  {
    // The reason the helpers moved out of the Cutting registry at all: one
    // definition of "Yesterday", used by both pages.
    const a=app(),gp=gpApp();
    ['today','yesterday','week','month','all'].forEach(pre=>{
      const A=a.run(`JSON.stringify(_gvDateBounds({preset:'${pre}'}))`);
      const B=gp.run(`JSON.stringify(_gvDateBounds({preset:'${pre}'}))`);
      s.eq(pre,A,B);
    });
  }

  s.section('gate pass day headers roll the day up, by TYPE');
  {
    // pcs, fabric weight and asset items are different things; a single
    // blended number would be a made-up one.
    const gp=gpApp();
    gp.run('renderGPRegistry()');
    gpPreset(gp,'today');
    gp.run('_gpRegRender()');
    const html=gp.el('gp-reg-body').innerHTML;
    s.ok('the day is named in full',html.indexOf(gp.run(`_gvDayLabel('${TODAY}')`))>-1,html.slice(0,120));
    s.ok('2 passes',/2 passes/.test(html));
    s.ok('garment pcs counted',/>100<\/strong> pcs/.test(html),html.slice(0,400));
    s.ok('fabric kg counted separately',/>25\.0<\/strong> kg/.test(html));
    s.ok('and never added together',!/125/.test(html));

    s.section('the summary follows the filter');
    const sum=gp.el('gp-reg-summary').innerHTML;
    s.ok('says the range',/Today/.test(sum),sum);
    s.ok('and the same totals',/2 passes/.test(sum)&&/100<\/strong> pcs/.test(sum),sum);
  }

  s.section('each gate pass day gets exactly ONE header');
  {
    const gp=gpApp();
    gp.run('renderGPRegistry()');gp.run('_gpRegRender()');
    // Dedupe on the DAY LABEL. The totals text is not unique — four of these
    // five days hold one pass each, so "1 pass" legitimately repeats.
    const heads=dayHeads(gp.el('gp-reg-body').innerHTML);
    s.eq('five days, five headers',heads.length,5);
    s.eq('none repeated',new Set(heads).size,heads.length,heads.join(' | '));
  }

  s.section('a backwards gate pass range is refused too');
  {
    const gp=gpApp();
    gp.el('gp-reg-from').value=TODAY;
    gp.el('gp-reg-to').value=TWENTY;
    gp.run('window.gpRegApplyCustom()');
    s.ok('it says so',/after/i.test(gp.state.toasts.join(' ')),gp.state.toasts.join(' '));
    s.eq('and the filter is untouched',gp.run('_gpRegDate.preset'),'all');
  }

  s.section('gate pass export follows the filter');
  {
    const gp=gpApp();
    gpPreset(gp,'today');
    gp.run('window.gpRegExport()');
    const x=gp.sheets[0];
    s.eq('header plus the two filtered rows',x.aoa.length,3);
    s.eq('only those passes',x.aoa.slice(1).map(r=>r[2]).join(','),'GP-1,GP-2');
    s.ok('range in the filename',x.name.indexOf(TODAY)>-1,x.name);
    s.ok('and in the toast',/2 passes/.test(gp.state.toasts.join(' ')),gp.state.toasts.join(' '));
  }

  s.section('Clear filters resets the date too');
  {
    const gp=gpApp();
    gpPreset(gp,'today');
    gp.run('window.gpRegClear()');
    s.eq('back to All dates',gp.run('_gpRegDate.preset'),'all');
    s.eq('with no stale custom range',gp.run('_gpRegDate.from+"|"+_gpRegDate.to'),'|');
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

  return s;
};

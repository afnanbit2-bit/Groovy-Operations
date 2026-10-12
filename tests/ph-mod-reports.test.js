/* Production Ops ▸ Reports tab (12 Oct 2026): js/ph-mod-reports.js and its wiring in index.html, sw.js, css/main.css.

   The fixture is ~15 POs, their fabric-issue gate passes, two cutting masters, two seasons, three standards and a registry.
   Every figure asserted below is HAND ARITHMETIC (the working is in the comment beside it), not a copy of the code's output.

   Range used throughout: Mon 2026-10-05 .. Sun 2026-10-11 (a Monday-start week), "today" 2026-10-12.

   PO     code    qty  stage      season            issue day (pass)    master    fabric      cut (PKT day)  cut pieces
   PO-001 GST073  400  completed  winter (stored)   10-02               Hassan    120 kg      10-05          400   planned 10-04
   PO-002 GST073  300  washing    winter            10-06               Hassan     80 kg      10-08          300   planned 10-08
   PO-003 GST073  500  printing   winter            10-06               Alam      170 kg      10-09          500   planned 10-10
   PO-004 GD007   200  cutting    winter            10-07               Alam      450 m       -              -
   PO-005 GD007    60  qc         winter            10-03               Alam      220 m       10-06          100   no plan, override USED 10-06
   PO-006 GHZ001  250  bundling   winter            released 10-08      -         -           10-10          250   planned 10-10
   PO-007 GST074  600  stitching  summer            10-04               Hassan    150 kg      10-05 (PKT)    600   planned 10-05  (cutAt 10-04T20:30Z)
   PO-008 GST075  350  cutting    summer            10-09               Alam       90 kg      -              -
   PO-009 GST076  150  reserved   -                 -                   -         -           -              -
   PO-010 GST077  100  cancelled  -                 -                   -         -           -              -
   PO-011 GST078  200  cutting    guessed winter    released 10-10      -         -           -              -
   PO-012 GST079  180  printing   guessed summer    ts only (10-07)     -         -           10-11          180   planned 09-30
   PO-013 GST080  220  completed  summer            09-21               Hassan     66 kg      09-25          220   (outside the range)
   PO-014 GST073  100  cutting    winter            10-11               Hassan     30 kg      -              -     override APPROVED 10-10, unused
   PO-015 GST074  300  stitching  summer            10-05               'Alam Bhai' 100 kg    10-07          300   planned 10-06
   Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-reports.js');
const UI_SRC=read('js/ph-ui.js');
const CSS=read('css/main.css');
const J=JSON.stringify;
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'}
};
// every top-level name the OTHER js files declare (one pass, once): a classic-script global of ours must not clash with any of them
const OTHER_DECLS=new Set();
fs.readdirSync(path.join(ROOT,'js')).filter(f=>f!=='ph-mod-reports.js'&&/\.js$/.test(f)).forEach(f=>{
  const t=fs.readFileSync(path.join(ROOT,'js',f),'utf8');
  const re=/(?:^|\n)(?:async\s+)?(?:function\s+|(?:const|let|var)\s+)([A-Za-z0-9_$]+)/g;let mt;
  while((mt=re.exec(t)))OTHER_DECLS.add(mt[1]);
});
const RANGE={mode:'custom',day:'',from:'2026-10-05',to:'2026-10-11',master:'',season:'',article:''};
const settle=ms=>new Promise(r=>setTimeout(r,ms||25));

/* ── the fixture ─────────────────────────────────────────────────────── */
function fixture(){
  const iso=(d,t)=>d+'T'+(t||'10:00:00')+'+05:00';
  const po=(id,code,qty,stage,x)=>Object.assign({id:id,fbKey:id,name:'Tee '+id,code:code,qty:qty,ts:Date.parse('2026-09-28T10:00:00+05:00')},
    stage==='cancelled'?{poStatus:'cancelled',currentStage:'cutting'}:stage==='reserved'?{poStatus:'reserved',currentStage:''}:{currentStage:stage},x||{});
  const pos=[
    po('PO-001','GST073',400,'completed',{season:'winter',seasonYear:2026,releasedAt:iso('2026-10-01'),cutAt:iso('2026-10-05'),cutQty:{S:100,M:200,L:100},plannedCutDate:'2026-10-04'}),
    po('PO-002','GST073',300,'washing',{season:'winter',seasonYear:2026,releasedAt:iso('2026-10-05'),cutAt:iso('2026-10-08'),cutQty:{S:100,M:100,L:100},plannedCutDate:'2026-10-08'}),
    po('PO-003','GST073',500,'printing',{season:'winter',seasonYear:2026,releasedAt:iso('2026-10-06'),cutAt:iso('2026-10-09'),cutQty:{S:100,M:250,L:150},plannedCutDate:'2026-10-10'}),
    po('PO-004','GD007',200,'cutting',{season:'winter',seasonYear:2026,releasedAt:iso('2026-10-07')}),
    po('PO-005','GD007',60,'qc',{season:'winter',seasonYear:2026,releasedAt:iso('2026-10-02'),cutAt:iso('2026-10-06'),cutQty:{'30':50,'32':50},
      cutOverride:{by:'afnan',byName:'Afnan',at:iso('2026-10-05','09:00:00'),usedAt:iso('2026-10-06','11:00:00'),reason:'extra panels',actualTotal:100,pct:166.7}}),
    po('PO-006','GHZ001',250,'bundling',{season:'winter',seasonYear:2026,releasedAt:iso('2026-10-08'),cutAt:iso('2026-10-10'),cutQty:{M:120,L:130},plannedCutDate:'2026-10-10'}),
    po('PO-007','GST074',600,'stitching',{season:'summer',seasonYear:2026,releasedAt:iso('2026-10-03'),cutAt:'2026-10-04T20:30:00Z',cutQty:{M:600},plannedCutDate:'2026-10-05'}),
    po('PO-008','GST075',350,'cutting',{season:'summer',seasonYear:2026,releasedAt:iso('2026-10-09')}),
    po('PO-009','GST076',150,'reserved'),
    po('PO-010','GST077',100,'cancelled'),
    po('PO-011','GST078',200,'cutting',{releasedAt:iso('2026-10-10'),plannedCutDate:'2026-10-12'}),
    po('PO-012','GST079',180,'printing',{ts:Date.parse('2026-10-07T12:00:00+05:00'),cutAt:iso('2026-10-11','09:00:00'),cutQty:{M:90,L:90},plannedCutDate:'2026-09-30'}),
    po('PO-013','GST080',220,'completed',{season:'summer',seasonYear:2026,releasedAt:iso('2026-09-20'),cutAt:iso('2026-09-25'),cutQty:{M:220},
      cutOverride:{by:'afnan',byName:'Afnan',at:iso('2026-09-24'),usedAt:iso('2026-09-25'),reason:'short fabric',actualTotal:220,pct:100}}),
    po('PO-014','GST073',100,'cutting',{season:'winter',seasonYear:2026,releasedAt:iso('2026-10-11'),cutOverride:{by:'ammar',byName:'Ammar',at:iso('2026-10-10','15:00:00'),reason:'approved ahead'}}),
    po('PO-015','GST074',300,'stitching',{season:'summer',seasonYear:2026,releasedAt:iso('2026-10-05'),cutAt:iso('2026-10-07'),cutQty:{S:100,M:100,L:100},plannedCutDate:'2026-10-06'})
  ];
  const gp=(poId,master,date,fab,unit,more)=>Object.assign({gpType:'fabric',poId:poId,cutMaster:master,date:date,fabricUsed:fab,fabricUnit:unit,articleCode:'x'},more||{});
  const passes=[
    gp('PO-001','Hassan','2026-10-02',120,'kg'),gp('PO-002','Hassan','2026-10-06',80,'kg'),gp('PO-003','Alam','2026-10-06',170,'kg'),
    gp('PO-004','Alam','2026-10-07',450,'meters'),gp('PO-005','Alam','2026-10-03',220,'mtr'),gp('PO-007','HASSAN ','2026-10-04',150,'kg'),
    gp('PO-008','Alam','2026-10-09',90,'kg'),gp('PO-013','Hassan','2026-09-21',66,'kg'),gp('PO-014','Hassan','2026-10-11',30,'kg'),
    gp('PO-015','Alam Bhai','2026-10-05',100,'kg'),
    {gpType:'outward',poId:'PO-001',cutMaster:'Zed',date:'2026-10-01',fabricUsed:999,fabricUnit:'kg'},      // not a fabric issue: ignored
    gp('PO-999','Ghost','2026-10-02',5,'kg')                                                                  // a pass for no PO: ignored
  ];
  const standards=[{fbKey:'GST073',unit:'kg',grossPerPiece:0.3},{fbKey:'GST074',unit:'kg',grossPerPiece:0.3,tolerancePct:5},{fbKey:'GD007',unit:'m',grossPerPiece:2}];
  const masters=[{fbKey:'CM-001',id:'CM-001',name:'Hassan',active:true,aliases:[]},{fbKey:'CM-002',id:'CM-002',name:'Alam',active:true,aliases:['Alam Bhai']}];
  return{pos,passes,standards,masters};
}
function input(over,fx){
  fx=fx||fixture();
  return Object.assign({today:'2026-10-12',filters:Object.assign({},RANGE,(over&&over.filters)||{}),
    pos:{state:'ok',rows:fx.pos},passes:{state:'ok',rows:fx.passes},
    standards:{ok:true,rows:fx.standards},masters:{ok:true,rows:fx.masters},settings:{ok:true,rows:{}}},over&&over.src||{});
}

/* ── a fake Firestore that records reads and WRITES ──────────────────── */
function fakeDb(o){
  o=o||{};
  const reads={},writes=[];
  const api={
    db:{},collection:(db,...s)=>({path:s.join('/')}),doc:(db,...s)=>({path:s.join('/')}),
    query:c=>({path:c.path}),orderBy:()=>({}),limit:()=>({}),where:()=>({}),
    getDocs:async q=>{
      reads[q.path]=(reads[q.path]||0)+1;
      if(o.gate&&(q.path==='pos'||q.path==='gatepasses'))await o.gate.p;
      const f=o.fail&&o.fail[q.path];if(f)throw f();
      const rows=(o.data&&o.data[q.path])||[];
      return{docs:rows.map(r=>({id:r.id||r.fbKey,data:()=>{const c=Object.assign({},r);delete c.fbKey;return c;}})),metadata:{fromCache:!!(o.cache&&o.cache[q.path])}};
    },
    getDoc:async r=>{
      reads[r.path]=(reads[r.path]||0)+1;
      const f=o.fail&&o.fail[r.path];if(f)throw f();
      const d=o.data&&o.data[r.path];
      return{exists:()=>!!d,data:()=>Object.assign({},d),metadata:{fromCache:false}};
    },
    setDoc:async()=>{writes.push('setDoc');},updateDoc:async()=>{writes.push('updateDoc');},addDoc:async()=>{writes.push('addDoc');},
    deleteDoc:async()=>{writes.push('deleteDoc');},writeBatch:()=>{writes.push('writeBatch');return{set(){},update(){},delete(){},commit:async()=>{}};},
    runTransaction:async()=>{writes.push('runTransaction');}
  };
  return{api,reads,writes};
}
function load(opts){
  opts=opts||{};
  const src=opts.src||SRC;
  const store={},calls={xlsx:[],pdf:[],toasts:[],open:[],exit:0,sheets:null};
  const fx=opts.fx||fixture();
  const dataAll=Object.assign({'cutting_masters':fx.masters,'ph_standards':fx.standards,'po_drafts':[],'po_cut_jobs':[],'ph_settings/main':{}},opts.db&&opts.db.data||{});
  const fk=fakeDb(Object.assign({},opts.db||{},{data:dataAll}));
  const xl={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:aoa=>({aoa}),book_append_sheet:(wb,ws,name)=>{wb.sheets.push({name,aoa:ws.aoa});}},writeFile:(wb,name)=>calls.xlsx.push({name,sheets:wb.sheets})};
  const globals=Object.assign({},fk.api,{
    localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
    history:{replaceState(){},pushState(){}},
    XLSX:opts.XLSX||xl,
    showToast:(m,e)=>calls.toasts.push({m,e:!!e}),
    allPOs:opts.noApp?[]:fx.pos,allPasses:opts.noApp?[]:fx.passes
  },opts.globals||{});
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js'],session:opts.session===undefined?USERS.afnan:opts.session,currentPage:'dashboard',globals});
  const ctx=a.ctx;
  const dom=domkit.install(ctx);
  ctx.window.printDocument=function(arg){calls.pdf.push(arg);};
  ctx.window.openPODetail=function(fb){calls.open.push(fb);};
  ctx.window.showPage=function(id){ctx.currentPage=id;if(id==='prod-ops')ctx.phRenderPage(id);return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(UI_SRC,ctx,{filename:'ph-ui.js'});
  if(opts.afterUi)opts.afterUi(ctx);
  vm.runInContext(src,ctx,{filename:'ph-mod-reports.js'});
  vm.runInContext('phExit=function(){__exit();}',Object.assign(ctx,{__exit:()=>{calls.exit++;}}));
  const T={a,ctx,dom,fk,store,calls,fx,
    R:c=>a.run(c),
    as(u){ctx.session=u;},
    panel:()=>dom.find('ph-panel'),
    text:n=>n?n.textContent:'',
    build:over=>ctx.phrBuild(input(over,fx)),
    show:async(tab)=>{ctx.currentPage='prod-ops';ctx.phRenderPage('prod-ops');await ctx.phUiLoad();if(tab)ctx.phGoTab(tab);await settle();},
    sec:(m,id)=>m.sections.filter(s=>s.id===id)[0],
    cards:()=>dom.byClass(T.panel(),'phr-sec')
  };
  return T;
}
// cell text of a row, as the table prints it
const rowTxt=(T,m,id,key)=>{const s=T.sec(m,id);const r=s.rows.filter(x=>x.key===key)[0];return r?r.cells.map((v,i)=>T.ctx._phrCellText(s.columns[i],v)):null;};
const keys=(s)=>s.rows.map(r=>r.key);
const num=(x,dp)=>Math.round(x*Math.pow(10,dp))/Math.pow(10,dp);

async function checks(src){
  const o={};
  const T=load({src:src});
  const m=T.build();
  const S=id=>T.sec(m,id);
  // ── the report figures: hand arithmetic ──
  {
    const sum=S('summary');
    o['summary: POs issued 9 and units issued 2380 (PO-002,003,004,006,008,011,012,014,015: 300+500+200+250+350+200+180+100+300)']=sum.rows[0].cells[1]===9&&sum.rows[1].cells[1]===2380;
    o['summary: units cut 2630 (Hassan 400+300+600, Alam 500+100+300, unassigned 250+180) over 8 cut records']=sum.rows[2].cells[1]===2630&&/8 cut record/.test(sum.rows[2].cells[2]);
    o['summary: units afloat 850 = the issued pieces of the 4 POs still at cutting (200+350+200+100)']=sum.rows[3].cells[1]===850&&J(sum.rows[3].pos)===J(['PO-004','PO-008','PO-011','PO-014']);
    o['summary: units in production 3080 = cutting 850 + bundling 250 + stitching 600+300 + printing 500+180 + washing 300 + qc 100']=sum.rows[4].cells[1]===3080;
    const se=S('seasons');
    const wi=se.rows.filter(r=>r.key==='winter-2026')[0],su=se.rows.filter(r=>r.key==='summer-2026')[0];
    o['seasons: winter 2026/27 = 6 POs 1550 units (5 stored 300+500+200+250+100, 1 guessed 200)']=J(rowTxt(T,m,'seasons','winter-2026').slice(0,3))===J(['Winter 2026/27','6','1,550'])&&wi.cells[4]===5&&wi.cells[5]===1;
    o['seasons: summer 2026 = 3 POs 830 units (2 stored 350+300, 1 guessed 180)']=su.cells[1]===3&&su.cells[2]===830&&su.cells[4]===2&&su.cells[5]===1;
    o['seasons: both rows are flagged (they hold a guessed season) and a note explains a guess']=se.rows.every(r=>r.flag===true)&&se.notes.some(n=>/Guessed/.test(n));
    o['seasons: the bar of the larger season is 1 and the other is 830/1550; rows in key order (summer 2026, winter 2026)']=wi.cells[3]===1&&Math.abs(su.cells[3]-830/1550)<1e-9&&se.rows.map(r=>r.key).join()==='summer-2026,winter-2026';
    const av=S('averages');
    o['averages: PO issue qty 2380/9 = 264.4 over n=9 (total 2380)']=av.rows[0].cells[1]===264.4&&av.rows[0].cells[2]===9&&av.rows[0].cells[3]===2380;
    o['averages: cut qty 2630/8 = 328.8 over n=8 (328.75 rounds half away from zero)']=av.rows[1].cells[1]===328.8&&av.rows[1].cells[2]===8&&av.rows[1].cells[3]===2630;
    const cm=S('cutMaster');
    o['cut per master: Hassan 1300 / 3 jobs / 433.3, Alam 900 / 3 / 300, Unassigned 430 / 2 / 215 -- most units first']=J(cm.rows.map(r=>[r.cells[0],r.cells[1],r.cells[3],r.cells[4]]))===J([['Hassan',1300,3,433.3],['Alam',900,3,300],['Unassigned',430,2,215]]);
    o['cut per master: footer 2630 over 8 jobs, average 328.8']=cm.foot.cells[1]===2630&&cm.foot.cells[3]===8&&cm.foot.cells[4]===328.8;
    o['cut per master: the registry flag reads yes / yes and "—" for Unassigned; alias "Alam Bhai" and "HASSAN " resolve into the registered masters']=J(cm.rows.map(r=>r.cells[5]))===J(['yes','yes','—'])&&cm.rows.length===3;
    o['cut per master: the bar of the largest master is 1']=cm.rows[0].cells[2]===1&&Math.abs(cm.rows[1].cells[2]-900/1300)<1e-9;
    const cd=S('cutDay');
    o['cut per day: columns are Day, one per master (Hassan, Alam, Unassigned) and Total']=J(cd.columns.map(c=>c.l))===J(['Day','Hassan','Alam','Unassigned','Total']);
    o['cut per day: 10-05 = Hassan 1000 (PO-001 400 + PO-007 600) -- PO-007 was cut at 20:30Z on 10-04 = 01:30 PKT on 10-05 (PKT day, not UTC)']=J(cd.rows[0].cells)===J(['2026-10-05',1000,null,null,1000]);
    o['cut per day: 10-06 Alam 100, 10-07 Alam 300, 10-08 Hassan 300, 10-09 Alam 500, 10-10 Unassigned 250, 10-11 Unassigned 180']=J(cd.rows.slice(1).map(r=>r.cells))===J([['2026-10-06',null,100,null,100],['2026-10-07',null,300,null,300],['2026-10-08',300,null,null,300],['2026-10-09',null,500,null,500],['2026-10-10',null,null,250,250],['2026-10-11',null,null,180,180]]);
    o['cut per day: a day with no cut by a master is a blank cell, not a recorded 0']=cd.rows.every(r=>r.cells.every(v=>v!==0));
    o['cut per day: footer = 1300 / 900 / 430 / 2630']=J(cd.foot.cells)===J(['Total',1300,900,430,2630]);
    const cw=S('cutWeek');
    o['cut per week (Monday start): one week 2026-10-05 to 2026-10-11, 1300 / 900 / 430 / 2630, not partial']=cw.rows.length===1&&J(cw.rows[0].cells)===J(['2026-10-05 to 2026-10-11',1300,900,430,2630]);
  }
  // ── gross vs the standard ──
  {
    const gp=S('grossProduct');
    const r=k=>gp.rows.filter(x=>x.key===k)[0];
    o['gross per product: GST073 kg = (120+80+170)/(400+300+500) = 0.3083 against 0.30; gap (370-360)/360 = +2.78% -- within 3%']=(()=>{const x=r('GST073|kg');return x&&x.cells[3]===1200&&x.cells[4]===370&&x.cells[5]===0.3083&&x.cells[6]===0.3&&x.cells[7]===2.78&&x.cells[9]==='within';})();
    o['gross per product: GST074 kg = (150+100)/900 = 0.2778 against 0.30 (tol 5%); gap (250-270)/270 = -7.41% -- under']=(()=>{const x=r('GST074|kg');return x&&x.cells[3]===900&&x.cells[4]===250&&x.cells[5]===0.2778&&x.cells[7]===-7.41&&x.cells[9]==='under'&&x.cells[8]==='+5% / -5%';})();
    o['gross per product: GD007 m = 220/100 = 2.2 against 2.0; gap +10% -- over']=(()=>{const x=r('GD007|m');return x&&x.cells[5]===2.2&&x.cells[6]===2&&x.cells[7]===10&&x.cells[9]==='over';})();
    o['gross per product: GHZ001 and GST079 were cut with no fabric issue -- listed, "not recorded", never a gross of 0']=(()=>{const a=r('GHZ001|-'),b=r('GST079|-');return a&&b&&a.cells[9]==='none'&&b.cells[9]==='none'&&a.cells[5]===null&&b.cells[5]===null&&a.cells[2]===1;})();
    o['gross per product: ordered most pieces first (GST073 1200, GST074 900, GD007 100)']=J(gp.rows.slice(0,3).map(x=>x.key))===J(['GST073|kg','GST074|kg','GD007|m']);
    o['gross per product: the verdict is printed with a glyph and a word (not colour alone)']=T.ctx._phrCellText({f:'verdict'},'under')==='▼ Under'&&T.ctx._phrCellText({f:'verdict'},'over')==='▲ Over'&&T.ctx._phrCellText({f:'verdict'},'within')==='✓ Within';
    const gm=S('grossMaster');
    const q=k=>gm.rows.filter(x=>x.key===k)[0];
    o['gross per master: Hassan kg = (120+80+150)/(400+300+600) = 350/1300 = 0.2692; vs standard (350-390)/390 = -10.26% under']=(()=>{const x=q('hassan|kg');return x&&x.cells[2]===1300&&x.cells[3]===350&&x.cells[4]===0.2692&&x.cells[5]===-10.26&&x.cells[6]==='under';})();
    o['gross per master: Alam kg = (170+100)/800 = 0.3375; vs standard (270-240)/240 = +12.5% over']=(()=>{const x=q('alam|kg');return x&&x.cells[2]===800&&x.cells[3]===270&&x.cells[4]===0.3375&&x.cells[5]===12.5&&x.cells[6]==='over';})();
    o['gross per master: team average kg = 620/2100 = 0.2952; Hassan (0.2692-0.2952)/0.2952 = -8.81% under, Alam (0.3375-0.2952)/0.2952 = +14.33% over']=(()=>{const a=q('hassan|kg'),b=q('alam|kg');return a.cells[7]===0.2952&&a.cells[8]===-8.81&&a.cells[9]==='under'&&b.cells[7]===0.2952&&b.cells[8]===14.33&&b.cells[9]==='over';})();
    o['gross per master: Alam m (the only master with metres) has nothing to compare with and says so']=(()=>{const x=q('alam|m');return x&&x.cells[4]===2.2&&x.cells[5]===10&&x.cells[6]==='over'&&x.cells[9]==='single'&&x.cells[8]===null;})();
    o['gross per master: Unassigned (no fabric issue) is listed as not recorded']=(()=>{const x=q('|-');return x&&x.cells[0]==='Unassigned'&&x.cells[9]==='none'&&x.cells[4]===null;})();
  }
  // ── lead time, delay, overrides ──
  {
    const ld=S('lead');
    const rr=k=>ld.rows.filter(x=>x.key===k)[0];
    o['lead time: (3+2+3+3+2+1+2)/7 = 2.3 days over n=7 (issue = the first fabric-issue date, else the release date)']=rr('lead').cells[1]===2.3&&rr('lead').cells[2]===7;
    o['lead time: PO-012 (only a creation time) is EXCLUDED and counted: noStart = 1, never averaged']=rr('nostart').cells[1]===1&&J(rr('nostart').pos)===J(['PO-012'])&&rr('lead').pos.indexOf('PO-012')<0;
    o['lead time: none later than the 3-day target']=rr('leadlate').cells[1]===0;
    o['delay gap: (+1 0 -1 0 0 +11 +1)/7 = 12/7 = 1.7 days; 3 late, 3 on time, 1 early, 42.9% late; PO-005 has no plan (noPlan 1)']=rr('gap').cells[1]===1.7&&rr('gap').cells[2]===7&&rr('late').cells[1]===3&&rr('ontime').cells[1]===3&&rr('early').cells[1]===1&&/42\.9%/.test(rr('late').cells[3])&&rr('noplan').cells[1]===1&&J(rr('noplan').pos)===J(['PO-005']);
    o['delay gap: the late POs are PO-001, PO-012, PO-015']=J(rr('late').pos)===J(['PO-001','PO-012','PO-015']);
    const ov=S('overrides');
    o['cut-gate overrides in range: PO-005 (used 10-06) and PO-014 (approved 10-10, unused); PO-013 (09-25) is outside']=J(ov.rows.map(r=>[r.cells[0],r.cells[3],r.cells[4]]))===J([['PO-005','2026-10-06','used on the cut'],['PO-014','2026-10-10','approved, not used yet']]);
    o['cut-gate overrides: who, why and the numbers are carried']=ov.rows[0].cells[2]==='Afnan'&&ov.rows[0].cells[5]==='extra panels'&&ov.rows[0].cells[6]===100&&ov.rows[0].cells[7]===60&&ov.rows[0].cells[8]===166.7;
  }
  // ── click-through: every row's POs agree with its figure ──
  {
    const cm=S('cutMaster'),ids=r=>J(r.pos);
    o['click-through: Hassan\'s row lists PO-001, PO-002, PO-007; Alam\'s PO-003, PO-005, PO-015; Unassigned PO-006, PO-012']=ids(cm.rows[0])===J(['PO-001','PO-002','PO-007'])&&ids(cm.rows[1])===J(['PO-003','PO-005','PO-015'])&&ids(cm.rows[2])===J(['PO-006','PO-012']);
    const se=S('seasons');
    const w2=se.rows.filter(r=>r.key==='winter-2026')[0],s2=se.rows.filter(r=>r.key==='summer-2026')[0];
    o['click-through: the winter row lists its 6 issued POs, the summer row its 3']=w2.pos.length===6&&s2.pos.length===3&&J(s2.pos)===J(['PO-008','PO-012','PO-015']);
    const cd=S('cutDay');
    o['click-through: the 10-05 day lists PO-001 and PO-007; the week lists all 8 cut POs']=J(cd.rows[0].pos)===J(['PO-001','PO-007'])&&S('cutWeek').rows[0].pos.length===8;
    const ld=S('lead');
    o['click-through: the number of POs behind a row equals the figure (lead n=7, gap n=7, cut 8, issued 9)']=ld.rows.filter(r=>r.key==='lead')[0].pos.length===7&&ld.rows.filter(r=>r.key==='gap')[0].pos.length===7&&S('summary').rows[2].pos.length===8&&S('summary').rows[0].pos.length===9;
    const gp=S('grossProduct');
    o['click-through: a gross row lists the POs of that article and unit (GST073 kg: PO-001, 002, 003)']=J(gp.rows.filter(r=>r.key==='GST073|kg')[0].pos)===J(['PO-001','PO-002','PO-003']);
  }
  // ── filters ──
  {
    const A=T.build({filters:{master:'alam'}});
    o['filter master=Alam: units cut 900 over 3 jobs, only Alam in the matrix']=T.sec(A,'cutMaster').rows.length===1&&T.sec(A,'cutMaster').rows[0].cells[1]===900&&J(T.sec(A,'cutDay').columns.map(c=>c.l))===J(['Day','Alam','Total']);
    o['filter master=Alam: the team benchmark still compares against ALL masters (0.2952)']=T.sec(A,'grossMaster').rows.filter(r=>r.key==='alam|kg')[0].cells[7]===0.2952;
    const U=T.build({filters:{master:'__none'}});
    o['filter master=unassigned: PO-006 and PO-012 only, 430 units']=T.sec(U,'cutMaster').rows.length===1&&T.sec(U,'cutMaster').rows[0].cells[1]===430;
    const W=T.build({filters:{season:'summer'}});
    o['filter season=summer: PO-007, PO-012, PO-015 cut -> 600+180+300 = 1080 units; 3 issued (008, 012, 015)']=T.sec(W,'cutMaster').rows.reduce((n,r)=>n+r.cells[1],0)===1080&&T.sec(W,'summary').rows[0].cells[1]===3&&T.sec(W,'summary').rows[1].cells[1]===830;
    const Wn=T.build({filters:{season:'winter'}});
    o['filter season=winter keeps the guessed winter PO-011 (issued 6) and cut 400+300+500+100+250 = 1550']=T.sec(Wn,'summary').rows[0].cells[1]===6&&T.sec(Wn,'summary').rows[2].cells[1]===1550;
    const Ar=T.build({filters:{article:'gst074'}});
    o['filter article=gst074 (case-insensitive prefix): PO-007 and PO-015, 900 units, 2 issued in range? only PO-015 (issued 10-05)']=T.sec(Ar,'summary').rows[2].cells[1]===900&&T.sec(Ar,'summary').rows[0].cells[1]===1;
    const D=T.build({filters:{mode:'day',day:'2026-10-05'}});
    o['mode day 10-05: units cut 1000 (PO-001 + PO-007 at PKT 10-05), range text is that day']=T.sec(D,'summary').rows[2].cells[1]===1000&&D.rangeText==='2026-10-05';
    const Wk=T.build({filters:{mode:'week',day:'2026-10-07'}});
    o['mode week containing Wed 10-07 = Mon 10-05 to Sun 10-11 (Monday start)']=Wk.range.from==='2026-10-05'&&Wk.range.to==='2026-10-11'&&T.sec(Wk,'summary').rows[2].cells[1]===2630;
    const Sun=T.build({filters:{mode:'week',day:'2026-10-11'}});
    o['mode week containing Sunday 10-11 is still the week that began Mon 10-05']=Sun.range.from==='2026-10-05'&&Sun.range.to==='2026-10-11';
    const Al=T.build({filters:{mode:'all'}});
    o['mode all dates: PO-013 (cut 09-25, 220) joins -> 2850 cut over 9 records, PO-013\'s override is listed (3)']=T.sec(Al,'summary').rows[2].cells[1]===2850&&T.sec(Al,'overrides').rows.length===3&&Al.rangeText==='all dates';
    const Pt=T.build({filters:{from:'2026-10-05',to:'2026-10-05'}});
    o['a one-day custom range, 10-05: weekly row is PARTIAL']=/partial/.test(T.sec(Pt,'cutWeek').rows[0].cells[0]);
    const Bad=T.build({filters:{from:'2026-10-12',to:'2026-10-01'}});
    o['a range with From after To is refused: every section says invalid range, nothing is exported']=Bad.badRange===true&&Bad.sections.every(s=>s.state==='unavailable'&&/invalid range/.test(s.message))&&Bad.exportable===false;
    const Bad2=T.build({filters:{from:'2026-02-30'}});
    o['a date that is not a real day is refused too']=Bad2.badRange===true;
  }
  // ── honest states ──
  {
    const nc=fixture();nc.pos.forEach(p=>{delete p.cutAt;delete p.cutQty;delete p.cutOverride;});
    const N2=T.ctx.phrBuild(input(null,nc));
    const sN=id=>T.sec(N2,id);
    o['no cut records: Units cut says "no data yet", never 0']=sN('summary').rows[2].cells[1]==='no data yet'&&T.ctx._phrCellText({n:true,f:'int'},sN('summary').rows[2].cells[1])==='no data yet';
    o['no cut records: cut per master / day / week / gross per product / gross per master are state "nodata" with the "no data yet" message']=['cutMaster','cutDay','cutWeek','grossProduct','grossMaster'].every(id=>sN(id).state==='nodata'&&/^no data yet/.test(sN(id).message)&&sN(id).rows.length===0);
    o['no cut records: average cut qty, lead time and delay gap all read "no data yet" (not 0)']=sN('averages').rows[1].cells[1]==='no data yet'&&sN('lead').rows.every(r=>r.cells[1]==='no data yet');
    o['no cut records: overrides say "no data yet" too (an empty list would read as "none")']=sN('overrides').state==='nodata';
    o['no cut records: the issue-based figures still stand (9 POs issued, 2380 units)']=sN('summary').rows[0].cells[1]===9&&sN('summary').rows[1].cells[1]===2380;
    const none=T.ctx.phrBuild(input({src:{pos:{state:'ok',rows:[]}}}));
    o['no POs at all: POs issued says "no data yet" and the seasons section is "nodata"']=none.sections.filter(s=>s.id==='summary')[0].rows[0].cells[1]==='no data yet'&&none.sections.filter(s=>s.id==='seasons')[0].state==='nodata';
    const quiet=T.build({filters:{from:'2027-01-04',to:'2027-01-10'}});
    o['no PO issued and nothing cut in the range: both averages say "no data yet", not 0']=T.sec(quiet,'averages').rows.every(r=>r.cells[1]==='no data yet');
    o['cut records exist but none in the range: a real zero is printed (0 units), the sections say "nothing was cut"']=T.sec(quiet,'summary').rows[2].cells[1]===0&&T.sec(quiet,'cutMaster').state==='empty'&&/nothing was cut/.test(T.sec(quiet,'cutMaster').message);
    const pe=T.ctx.phrBuild(input({src:{pos:{state:'error',rows:null,text:'pos: could not be read (permission denied) - x'}}}));
    o['pos failed: every section reads "unavailable — pos", the build is not exportable and the notice names pos']=pe.sections.length===10&&pe.sections.every(s=>s.state==='unavailable'&&s.message==='unavailable — pos')&&pe.exportable===false&&pe.notices.some(n=>/^pos:/.test(n.text));
    const ge=T.ctx.phrBuild(input({src:{passes:{state:'error',rows:null,text:'gatepasses: could not be read (permission denied) - x'}}}));
    o['gatepasses failed: the master sections read "unavailable — gatepasses" (masters come from the fabric issue); the PO-only sections still show']=['cutMaster','cutDay','cutWeek','grossMaster'].every(id=>T.sec(ge,id).state==='unavailable'&&/^unavailable — gatepasses/.test(T.sec(ge,id).message))&&T.sec(ge,'seasons').state==='ok'&&T.sec(ge,'averages').rows[0].cells[1]===264.4;
    const se=T.ctx.phrBuild(input({src:{standards:{ok:false,rows:null,text:'ph_standards: could not be read'}}}));
    o['ph_standards failed: gross verdicts read "unavailable — ph_standards" (never within/over/under), the actual gross still shows']=(()=>{const g=T.sec(se,'grossProduct').rows.filter(r=>r.key==='GST073|kg')[0];return g.cells[5]===0.3083&&g.cells[9]==='unavailable — ph_standards'&&T.sec(se,'grossMaster').rows.every(r=>r.cells[6]==='unavailable — ph_standards'||r.cells[6]==='none')&&se.notices.some(n=>/ph_standards/.test(n.text));})();
    const me=T.ctx.phrBuild(input({src:{masters:{ok:false,rows:null,text:'cutting_masters: could not be read'}}}));
    o['cutting_masters failed: the registry column says unavailable, the figures are unchanged']=T.sec(me,'cutMaster').rows[0].cells[5]==='unavailable — cutting_masters'&&T.sec(me,'cutMaster').rows[0].cells[1]===1300+0*1;
    const st=T.ctx.phrBuild(input({src:{settings:{ok:false,rows:null,text:'ph_settings: could not be read'}}}));
    o['ph_settings failed: the default tolerances (3 over / 5 under) are used and the page says so']=st.tolerance.known===false&&st.tolerance.over===3&&st.tolerance.under===5&&st.notices.some(n=>/ph_settings/.test(n.text))&&T.sec(st,'grossProduct').notes.some(n=>/defaults/.test(n));
    const tr=T.ctx.phrBuild(input({src:{pos:{state:'ok',rows:fixture().pos,truncated:true}}}));
    o['a list cut at its limit says so']=tr.notices.some(n=>/cut at 2000/.test(n.text));
    const junk=T.ctx.phrBuild(input({src:{pos:{state:'ok',rows:[null,5,'x'].concat(fixture().pos)}}}));
    o['junk entries in pos are ignored and counted, the figures are unchanged']=junk.counts.junk===3&&T.sec(junk,'summary').rows[2].cells[1]===2630;
  }
  // ── consistency: the per-PO membership agrees with phReport, and exports ──
  {
    const rep=m.report,mem=m.members;
    const cnt=f=>Object.keys(mem).filter(k=>f(mem[k])).length;
    o['membership equals phReport: lead n, noStart, gap n, cut n, issued n']=cnt(x=>x.lead==='counted')===rep.leadTime.n&&cnt(x=>x.lead==='noStart')===rep.leadTime.noStart&&cnt(x=>x.gap==='late'||x.gap==='early'||x.gap==='ontime')===rep.delayGap.n&&cnt(x=>x.cut)===rep.cutTotal.n&&cnt(x=>x.issued)===_sum(rep.seasons,'pos');
    o['membership: the cut units of the POs add up to phReport\'s cutTotal']=Object.keys(mem).reduce((n,k)=>n+(mem[k].cutUnits||0),0)===rep.cutTotal.units;
  }
  function _sum(a,k){return a.reduce((n,r)=>n+r[k],0);}
  // ── Excel ──
  {
    const E=load({src:src});
    const mm=E.build();
    E.R('phrExportXlsx')(mm);
    const x=E.calls.xlsx[0];
    o['Excel: one sheet per section plus an Info sheet, in order']=!!x&&J(x.sheets.map(s=>s.name))===J(['Info','Summary','By season','Cut per master','Cut per day','Cut per week','Gross per product','Gross per master','Averages','Lead time and delay','Cut gate overrides']);
    o['Excel: the range is in the filename']=!!x&&x.name==='Production-Report-2026-10-05_to_2026-10-11.xlsx';
    const sh=n=>x&&x.sheets.filter(s=>s.name===n)[0].aoa;
    o['Excel: Cut per master sheet = header + Hassan/Alam/Unassigned rows + total, numbers stay numbers (the bar column is not exported)']=!!x&&J(sh('Cut per master'))===J([['Master','Units cut','Cut jobs','Avg cut qty','In registry'],['Hassan',1300,3,433.3,'yes'],['Alam',900,3,300,'yes'],['Unassigned',430,2,215,'—'],['All masters',2630,8,328.8,'']]);
    o['Excel: Cut per day sheet carries the matrix with blanks, not zeros']=!!x&&J(sh('Cut per day')[0])===J(['Day','Hassan','Alam','Unassigned','Total'])&&J(sh('Cut per day')[1])===J(['2026-10-05',1000,'','',1000]);
    o['Excel: Gross per product verdicts are words, not keys']=!!x&&sh('Gross per product')[1][9]==='✓ Within'&&sh('Gross per product')[2][9]==='▼ Under';
    o['Excel: the Info sheet names the range and the filters']=!!x&&J(sh('Info')[1])===J(['Range','2026-10-05 to 2026-10-11'])&&/all masters/.test(sh('Info')[2][1]);
    const nc=fixture();nc.pos.forEach(p=>{delete p.cutAt;delete p.cutQty;});
    const E2=load({src:src,fx:nc});E2.R('phrExportXlsx')(E2.ctx.phrBuild(input(null,nc)));
    const x2=E2.calls.xlsx[0];
    o['Excel: a no-data section exports its message ("no data yet"), not an empty or zero sheet']=!!x2&&J(x2.sheets.filter(s=>s.name==='Cut per master')[0].aoa)===J([['Cut per master'],['no data yet — no PO has a recorded cut (cutAt with cut quantities)']]);
    // a failed pos exports nothing
    const E3=load({src:src});E3.R('phrExportXlsx')(E3.ctx.phrBuild(input({src:{pos:{state:'error',rows:null,text:'x'}}})));
    o['Excel: nothing is exported when pos is unavailable (a toast says so)']=E3.calls.xlsx.length===0&&E3.calls.toasts.length===1;
    // a REAL SheetJS round trip
    let real=true;
    try{
      const XL=require(path.join(ROOT,'assets/vendor/xlsx-0.18.5.full.min.js'));
      const R=load({src:src,XLSX:Object.assign({},XL,{writeFile:(wb,name)=>{R.calls.xlsx.push({name,wb});}})});
      R.R('phrExportXlsx')(R.build());
      const wb=R.calls.xlsx[0].wb,buf=XL.write(wb,{type:'buffer',bookType:'xlsx'}),back=XL.read(buf);
      real=J(back.SheetNames)===J(['Info','Summary','By season','Cut per master','Cut per day','Cut per week','Gross per product','Gross per master','Averages','Lead time and delay','Cut gate overrides'])&&XL.utils.sheet_to_json(back.Sheets['Cut per master'],{header:1})[1][1]===1300&&XL.utils.sheet_to_json(back.Sheets['Cut per master'],{header:1})[1][0]==='Hassan';
    }catch(e){real=false;}
    o['Excel: the REAL vendored SheetJS writes and reads the workbook back (sheet names, Hassan 1300)']=real;
    // a non-manager is refused
    const U=load({src:src,session:USERS.uzaib});U.R('phrExportXlsx')(U.build());U.R('phrExportPdf')(U.build());
    o['exports: Uzaib (not a manager) is refused both, with a toast, and nothing is built']=U.calls.xlsx.length===0&&U.calls.pdf.length===0&&U.calls.toasts.length===2;
  }
  // ── PDF ──
  {
    const P=load({src:src});
    P.R('phrExportPdf')(P.build());
    const d=P.calls.pdf[0];
    o['PDF goes through printDocument: type generic, urduLevel none, a .pdf filename with the range']=!!d&&P.calls.pdf.length===1&&d.type==='generic'&&d.data.urduLevel==='none'&&d.filename==='Production-Report-2026-10-05_to_2026-10-11.pdf';
    o['PDF body carries every section title and the figures (Hassan | 1,300 | 3)']=!!d&&/CUT PER MASTER/.test(d.data.bodyHtml)&&/Hassan \| 1,300 \| /.test(d.data.bodyHtml)&&/LEAD TIME AND DELAY/.test(d.data.bodyHtml)&&/CUT GATE OVERRIDES/.test(d.data.bodyHtml);
    o['PDF body: a no-data section prints its message, the range and the filters are in the subtitle']=!!d&&/Range: 2026-10-05 to 2026-10-11/.test(d.data.bodyHtml)&&/2026-10-05 to 2026-10-11/.test(d.data.subtitle);
    const P2=load({src:src});
    P2.R('phrExportPdf')(P2.ctx.phrBuild(input({filters:{master:'__none'}})));
    o['PDF: angle brackets in stored text are stripped (the engine strips tags from the body)']=(()=>{const f=fixture();f.passes.push({gpType:'fabric',poId:'PO-006',cutMaster:'<b>X</b>',date:'2026-10-08',fabricUsed:10,fabricUnit:'kg'});const Q=load({src:src,fx:f});Q.R('phrExportPdf')(Q.ctx.phrBuild(input(null,f)));return Q.calls.pdf.length===1&&!/[<>]/.test(Q.calls.pdf[0].data.bodyHtml);})();
    const noP=load({src:src,afterUi:c=>{}});noP.ctx.window.printDocument=undefined;
    noP.R('phrExportPdf')(noP.build());
    o['PDF: a missing print engine is a toast, not a throw']=noP.calls.toasts.length===1&&noP.calls.pdf.length===0;
  }
  // ── the tab: rendering, filters, click-through, honest loading ──
  {
    const R=load({src:src});
    R.R('_phrF='+J(RANGE));
    await R.show('reports');
    const root=R.dom.find('phr-root');
    o['the Reports tab replaces the placeholder: a phr-root with the heading Reports']=!!root&&/Reports/.test(R.text(R.panel()))&&!/Placeholder/.test(R.text(R.panel()));
    o['10 sections are drawn, each a card with its title']=R.cards().length===10&&R.cards().map(c=>c.getAttribute('data-sec')).join()==='summary,seasons,cutMaster,cutDay,cutWeek,grossProduct,grossMaster,averages,lead,overrides';
    o['every table scrolls INSIDE its own wrapper (.phr-scroll), none is a direct child of the card']=(()=>{const t=R.dom.all(R.panel(),n=>n.tagName==='TABLE');return t.length>=9&&t.every(x=>x.parentNode&&/\bphr-scroll\b/.test(x.parentNode.className));})();
    o['charts are HTML bars (.phr-bar) with a width style, no svg and no canvas']=(()=>{const b=R.dom.byClass(R.panel(),'phr-bar');return b.length>=5&&b.every(x=>/^width:\d+%$/.test(x.children[0].getAttribute('style')||''))&&R.dom.all(R.panel(),n=>n.tagName==='SVG'||n.tagName==='CANVAS').length===0;})();
    o['the filter bar: 4 range buttons (Day, Week, Custom, All dates), master / season / article controls, Reset, Reload, Export Excel, Export PDF']=(()=>{const f=R.dom.byClass(R.panel(),'phr-filters')[0];const t=R.text(f);return !!f&&R.dom.byClass(f,'phr-mode').length===4&&/Export Excel/.test(t)&&/Export PDF/.test(t)&&/Reset filters/.test(t)&&/Reload from server/.test(t)&&R.dom.all(f,n=>n.tagName==='SELECT').length===2;})();
    o['the range mode in force is aria-pressed']=R.dom.byClass(R.panel(),'phr-mode').filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.getAttribute('data-mode')).join()==='custom';
    // clicking a row opens its POs
    const cm=R.cards()[2];
    const tr=R.dom.byClass(cm,'phr-row-tr')[0];
    R.dom.click(tr);
    const panel=R.dom.byClass(R.cards()[2],'phr-pos')[0];
    o['clicking a row opens "POs behind: Hassan (3)" with PO-001, PO-002, PO-007']=!!panel&&/POs behind: Hassan \(3\)/.test(R.text(panel))&&['PO-001','PO-002','PO-007'].every(p=>R.text(panel).indexOf(p)>-1);
    o['the PO list shows article, stage, master, cut day, cut pieces and season']=!!panel&&/GST073/.test(R.text(panel))&&/completed/.test(R.text(panel))&&/2026-10-05/.test(R.text(panel))&&/Winter 2026\/27/.test(R.text(panel));
    const open=R.dom.all(panel||R.panel(),n=>n.tagName==='BUTTON'&&n.getAttribute('data-fb')==='PO-002')[0];
    if(open)R.dom.click(open);
    o['"Open PO" leaves Production Ops first (phExit) and then opens that PO in the classic detail page']=R.calls.exit===1&&J(R.calls.open)===J(['PO-002']);
    R.dom.click(R.dom.byClass(R.cards()[2],'phr-row-tr')[0]);
    o['clicking the same row again closes the panel']=R.dom.byClass(R.cards()[2],'phr-pos').length===0;
    const btn=R.dom.byClass(R.cards()[2],'phr-pobtn')[0];
    R.dom.click(btn);
    o['the POs button does the same (keyboard route) and is aria-expanded']=R.dom.byClass(R.cards()[2],'phr-pos').length===1&&R.dom.byClass(R.cards()[2],'phr-pobtn')[0].getAttribute('aria-expanded')==='true';
    // filters through the controls
    const sel=R.dom.all(R.panel(),n=>n.tagName==='SELECT'&&n.getAttribute('aria-label')==='Master')[0];
    sel.value='alam';R.dom.dispatch(sel,'change');
    o['picking a master in the select filters the report and closes the open PO panel']=R.text(R.cards()[2]).indexOf('Hassan')<0&&R.text(R.cards()[2]).indexOf('Alam')>-1&&R.dom.byClass(R.panel(),'phr-pos').length===0;
    const sea=R.dom.all(R.panel(),n=>n.tagName==='SELECT'&&n.getAttribute('aria-label')==='Season')[0];
    sea.value='summer';R.dom.dispatch(sea,'change');
    o['picking a season narrows it further (Alam + summer: PO-015 = 300 units)']=/300/.test(R.text(R.cards()[2]))&&R.text(R.cards()[2]).indexOf('900')<0;
    const art=R.dom.all(R.panel(),n=>n.tagName==='INPUT'&&n.getAttribute('aria-label')==='Article code (starts with)')[0];
    art.value='GST073';R.dom.dispatch(art,'change');
    o['typing an article narrows it (Alam + summer + GST073 = nothing cut -> "nothing was cut")']=/nothing was cut in this range with these filters/.test(R.text(R.cards()[2]));
    R.dom.click(R.dom.all(R.panel(),n=>n.tagName==='BUTTON'&&n.textContent==='Reset filters')[0]);
    o['Reset filters returns to this week with all masters, seasons and articles']=R.R('_phrF.mode')==='week'&&R.R('_phrF.master')===''&&R.R('_phrF.season')===''&&R.R('_phrF.article')==='';
    R.dom.click(R.dom.byClass(R.panel(),'phr-mode').filter(b=>b.getAttribute('data-mode')==='day')[0]);
    const day0=R.R('_phrF.day');
    R.dom.click(R.dom.byClass(R.panel(),'phr-step').filter(b=>b.getAttribute('data-step')==='-1')[0]);
    o['Day mode: the previous-day arrow steps back one PKT day']=R.R('_phrF.mode')==='day'&&R.R('phDaysBetween(_phrF.day,"'+day0+'")')===1;
    R.dom.click(R.dom.byClass(R.panel(),'phr-mode').filter(b=>b.getAttribute('data-mode')==='week')[0]);
    R.dom.click(R.dom.byClass(R.panel(),'phr-step').filter(b=>b.getAttribute('data-step')==='1')[0]);
    o['Week mode: the arrow steps a whole week']=R.R('phWeekday(phWeekStart(_phrF.day))')===1;
    R.dom.click(R.dom.byClass(R.panel(),'phr-mode').filter(b=>b.getAttribute('data-mode')==='all')[0]);
    o['All dates mode shows no date inputs']=R.dom.all(R.dom.byClass(R.panel(),'phr-filters')[0],n=>n.tagName==='INPUT'&&n.getAttribute('type')==='date').length===0;
    R.dom.click(R.dom.byClass(R.panel(),'phr-mode').filter(b=>b.getAttribute('data-mode')==='custom')[0]);
    o['Custom mode shows From and To']=R.dom.all(R.dom.byClass(R.panel(),'phr-filters')[0],n=>n.tagName==='INPUT'&&n.getAttribute('type')==='date').length===2;
    // no writes at all
    o['read-only: nothing was written while rendering, filtering, opening POs']=R.fk.writes.length===0;
  }
  // ── the sources: the app's lists, else our own read ──
  {
    const A=load({src:src});A.R('_phrF='+J(RANGE));await A.show('reports');
    o['sources: allPOs / allPasses non-empty are used as they are -- no Firestore read of pos or gatepasses']=!A.fk.reads['pos']&&!A.fk.reads['gatepasses'];
    const fx=fixture();
    const B=load({src:src,noApp:true,db:{data:{pos:fx.pos.map(p=>Object.assign({},p,{id:p.id})),gatepasses:fx.passes.map((g,i)=>Object.assign({id:'GP-'+i},g))}},fx:fx});
    B.R('_phrF='+J(RANGE));await B.show('reports');await settle(60);
    o['sources: empty app lists -> the tab reads pos and gatepasses ITSELF once, and the report is the same (2630 cut)']=B.fk.reads['pos']===1&&B.fk.reads['gatepasses']===1&&/2,630/.test(B.text(B.cards()[0]));
    B.R('_phrCtx.repaint()');B.R('_phrCtx.repaint()');await settle();
    o['sources: repainting never re-reads (still one read each)']=B.fk.reads['pos']===1&&B.fk.reads['gatepasses']===1;
    const F=load({src:src,noApp:true,db:{fail:{pos:PERM},data:{gatepasses:[]}}});
    F.R('_phrF='+J(RANGE));await F.show('reports');await settle(60);
    o['failed pos: the tab shows "unavailable — pos" in all ten sections, a red notice naming pos, and a Retry']=F.cards().length===10&&F.cards().every(c=>/unavailable — pos/.test(F.text(c)))&&/pos: could not be read/.test(F.text(F.panel()))&&F.dom.all(F.panel(),n=>n.tagName==='BUTTON'&&n.getAttribute('data-act')==='retry').length===1;
    F.R('_phrCtx.repaint()');await settle();F.R('_phrCtx.repaint()');await settle();
    o['failed pos: a failure does NOT re-read itself on every repaint (1 read)']=F.fk.reads['pos']===1;
    F.R('phrRetrySources()');await settle(60);
    o['Retry re-reads only the failed list (pos twice, gatepasses once)']=F.fk.reads['pos']===2&&F.fk.reads['gatepasses']===1;
    const C=load({src:src,noApp:true,db:{cache:{pos:true},data:{pos:fx.pos,gatepasses:[]}}});
    C.R('_phrF='+J(RANGE));await C.show('reports');await settle(60);
    o['an answer from the offline copy is not a read: "unavailable — pos"']=/unavailable — pos/.test(C.text(C.cards()[0]))&&/offline copy/.test(C.text(C.panel()));
    const g=(()=>{let open;const p=new Promise(r=>{open=r;});return{p,open};})();
    const L=load({src:src,noApp:true,db:{gate:g,data:{pos:fx.pos,gatepasses:fx.passes}}});
    L.R('_phrF='+J(RANGE));await L.show('reports');
    o['while the read is out the tab shows a loading card (skeleton), not figures and not a blank panel']=/Reading POs and gate passes/.test(L.text(L.panel()))&&L.dom.byClass(L.panel(),'gv-skel').length>=1&&L.cards().length===0;
    g.open();await settle(80);
    o['and repaints with the figures when the read settles']=L.cards().length===10;
    const Rl=load({src:src});Rl.R('_phrF='+J(RANGE));await Rl.show('reports');
    Rl.R('phrReload()');await settle(60);
    o['Reload from server re-reads both lists from Firestore itself (the app\'s copies may be old)']=Rl.fk.reads['pos']===1&&Rl.fk.reads['gatepasses']===1;
  }
  // ── audience ──
  {
    const U=load({src:src,session:USERS.uzaib});
    o['audience: Uzaib\'s tab list has no Reports and he cannot go to it']=U.R('phTabsFor().map(t=>t.id).join()')==='overview,queue,cutting'&&U.R('phGoTab("reports")')===false;
    const Rz=load({src:src,session:USERS.raees});
    o['audience: Raees has no tabs at all']=Rz.R('phTabsFor().length')===0;
    const M=load({src:src,session:USERS.mustafa});
    o['audience: Mustafa (a manager) has Reports']=M.R('phTabsFor().some(t=>t.id==="reports")');
    // defence in depth: the render itself refuses a non-manager
    const D=load({src:src,session:USERS.uzaib});
    const host=D.dom.mk('div');D.ctx.phrRender(host,{canManage:false,user:'uzaib',get:()=>({ok:false}),el:D.ctx.phEl,clear:D.ctx.phClear,repaint(){}});
    o['audience: phrRender itself shows "No access" and reads nothing for a non-manager']=/No access/.test(host.textContent)&&!D.fk.reads['pos']&&D.dom.byClass(host,'phr-sec').length===0;
    o['audience: the Reports tab is registered through phRegisterTab with the manager-only default role']=D.R('PH_TABS.filter(x=>x.id==="reports").length===1&&PH_TABS.filter(x=>x.id==="reports")[0].render===phrRender&&PH_TABS.filter(x=>x.id==="reports")[0].roles===PH_ROLE_MANAGE')===true;
  }
  // ── XSS ──
  {
    const HOST='<img src=x onerror=alert(1)>',fx=fixture();
    fx.passes.push({gpType:'fabric',poId:'PO-006',cutMaster:HOST,date:'2026-10-08',fabricUsed:10,fabricUnit:'kg'});
    fx.pos[5].name='<script>alert(2)</script>';fx.pos[5].code='GHZ001';
    const X=load({src:src,fx:fx});
    X.R('_phrF='+J(RANGE));await X.show('reports');
    const all=X.dom.all(X.panel(),n=>true);
    o['XSS: a hostile master name reaches the page as text only -- no element was created from it']=X.text(X.panel()).indexOf(HOST)>-1&&all.every(n=>n.tagName!=='IMG'&&n.tagName!=='SCRIPT');
    o['XSS: the serialised tree escapes it (no raw < in the markup)']=(()=>{const h=domkit.toHtml(X.panel());return h.indexOf('<img')<0&&h.indexOf('&lt;img')>-1;})();
    X.dom.click(X.dom.byClass(X.cards()[2],'phr-row-tr').filter(r=>/img/.test(r.textContent))[0]);
    o['XSS: the PO name in the PO panel is text too']=all.length>0&&X.dom.all(X.panel(),n=>n.tagName==='SCRIPT').length===0&&X.text(X.panel()).indexOf('<script>alert(2)</script>')>-1;
    o['XSS: a hostile master is selectable as a filter option and stays text']=X.dom.all(X.panel(),n=>n.tagName==='OPTION').some(op=>op.textContent===HOST);
    o['XSS: the source never parses a string as HTML (innerHTML / outerHTML / insertAdjacentHTML / DOMParser / document.write)']=!/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|document\.write|\beval\(|new Function/.test(src.replace(/\/\*[\s\S]*?\*\//g,''));
  }
  // ── read-only ──
  {
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
    o['read-only: the source names no Firestore write API']=!/\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|setItem\()/.test(code.replace(/localStorage/g,''));
    o['read-only: the source calls no ph-write function and no existing writer (phSave / phMark / phBuild / phMaster / phRetire / phSet...)']=!/\bph(?:Save|Mark|Build|Master(?:Create|Add|Rename|SetActive)|Set(?:Settings|Standard)|Issue|Append|Open(?:Cut)?Job|Retire|Send)[A-Za-z]*\(/.test(code)&&!/logActivity\(/.test(code);
    o['read-only: only getDocs is used, on the two collections pos and gatepasses (no other path)']=(code.match(/getDocs\(/g)||[]).length===1&&/_phrReadOwn\(n,/.test(code)&&!/getDoc\(/.test(code);
    const W=load({src:src});W.R('_phrF='+J(RANGE));await W.show('reports');
    W.R('phrExportXlsx')(W.build());W.R('phrExportPdf')(W.build());W.R('phrReload()');await settle(60);
    o['read-only: rendering + both exports + a reload recorded no write of any kind']=W.fk.writes.length===0;
  }
  // ── hygiene ──
  {
    const names=[];
    src.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').forEach(l=>{const mt=/^(?:async\s+)?(?:function\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+))/.exec(l);if(mt)names.push(mt[1]||mt[2]);});
    o['globals: every top-level name is phr / _phr / PHR_ prefixed']=names.length>40&&names.every(n=>/^(?:phr|_phr|PHR_)/.test(n));
    const others=names.filter(n=>OTHER_DECLS.has(n));
    o['globals: none of them is declared in any other js file (one lexical scope)']=others.length===0;
  }
  return o;
}

async function wiring(s){
  s.section('wiring in index.html, sw.js and the stylesheet');
  const idx=read('index.html'),sw=read('sw.js');
  const tagsAll=idx.match(/<script src="\/js\/[^"]+"/g)||[];
  const names=tagsAll.map(t=>/\/js\/([^?"]+)/.exec(t)[1]);
  s.ok('ONE script tag for ph-mod-reports.js',names.filter(n=>n==='ph-mod-reports.js').length===1);
  s.ok('it loads after ph-ui.js',names.indexOf('ph-mod-reports.js')>names.indexOf('ph-ui.js')&&names.indexOf('ph-ui.js')>-1);
  s.ok('and carries a ?v= tag',/<script src="\/js\/ph-mod-reports\.js\?v=[0-9a-z]+"><\/script>/.test(idx));
  const pre=sw.match(/'\/js\/[^']+'/g).map(x=>x.slice(1,-1));
  s.ok('ONE PRECACHE_URLS entry, after ph-ui.js',pre.filter(x=>x==='/js/ph-mod-reports.js').length===1&&pre.indexOf('/js/ph-mod-reports.js')>pre.indexOf('/js/ph-ui.js'));
  s.section('stylesheet contract (geometry the harness cannot lay out)');
  const a=CSS.indexOf('/* ph-mod-reports START */'),b=CSS.indexOf('/* ph-mod-reports END */');
  s.ok('the block is delimited by START / END markers and sits in the trailing run of ph-mod-* blocks at the END of css/main.css',a>0&&b>a&&CSS.slice(b+'/* ph-mod-reports END */'.length).replace(/\/\* ph-mod-[a-z]+ START \*\/[\s\S]*?\/\* ph-mod-[a-z]+ END \*\//g,'').trim()==='');
  const blk=CSS.slice(a,b).replace(/\/\*[\s\S]*?\*\//g,'');
  s.ok('tokens only: no literal colour in the block',!/#[0-9a-fA-F]{3,8}\b/.test(blk)&&!/\b(?:rgb|rgba|hsl|hsla)\(/.test(blk));
  s.ok('every selector in the block is .phr-prefixed or a .ph-btn child of one',(blk.match(/[^{}]+(?=\{)/g)||[]).filter(sel=>!/^\s*@media/.test(sel)).every(sel=>sel.split(',').every(p=>/phr-/.test(p))));
  s.ok('tables scroll inside .phr-scroll (overflow-x:auto), never the page',/\.phr-scroll\{[^}]*overflow-x:auto/.test(blk));
  s.ok('touch targets are 44px: range buttons, step arrows, inputs, the POs button',/\.phr-mode,\.phr-step\{[^}]*min-height:44px/.test(blk)&&/\.phr-in\{[^}]*min-height:44px/.test(blk)&&/\.phr-pobtn\{[^}]*min-height:44px/.test(blk));
  s.ok('nothing under 12px, cell text 13px',!/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/.test(blk)&&/\.phr-table\{[^}]*font-size:13px/.test(blk));
  s.ok('the verdict colours are tokens with a soft ground (success / urgent / warning)',/\.phr-v-within\{[^}]*var\(--accent-success-soft\)/.test(blk)&&/\.phr-v-over\{[^}]*var\(--accent-urgent-soft\)/.test(blk)&&/\.phr-v-under\{[^}]*var\(--accent-warning-soft\)/.test(blk));
  s.ok('the on-state of a range button takes its ink from --on-dark (painted on --dark)',/\.phr-mode\.on\{[^}]*background:var\(--dark\)[^}]*color:var\(--on-dark\)/.test(blk));
  s.ok('a focus ring is drawn',/\.phr-mode:focus-visible[^{]*\{outline:2px solid var\(--text\)/.test(blk));
  s.ok('phone: fields go full width and the actions wrap',/@media \(max-width:600px\)\{[\s\S]*\.phr-field\{flex:1 1 100%\}/.test(blk));
  s.ok('bars are HTML boxes on a --soft track',/\.phr-bar\{[^}]*background:var\(--soft\)/.test(blk)&&/\.phr-bar i\{[^}]*background:var\(--text\)/.test(blk));
}

module.exports=async function(){
  const s=suite('ph-mod-reports');
  const base=await checks(SRC);
  s.section('reports tab');
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
    let r;try{r=await checks(mut);}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{
      if(!(f in base)){s.ok('break "'+label+'" names a real check: '+f.slice(0,50),false);return;}
      broken++;s.ok('break "'+label+'" fails "'+f.slice(0,90)+'"',r[f]!==true);
    });
  };
  const K=prefix=>Object.keys(base).filter(k=>k.indexOf(prefix)===0);
  await brk('UTC day instead of the PKT day for a cut',"cutDay:po.cutAt,cutUnits:cutArg","cutDay:phDay(po.cutAt).slice(0,8)+'01',cutUnits:cutArg",[K('cut per day: 10-05')[0],K('mode day 10-05')[0]]);
  await brk('the gate-pass date is not used as the issue day',"if(first!==null)issueAtById[id]=first;","",[K('lead time: (3+2+3')[0]]);
  await brk('the first pass of a PO is not the earliest',"return(a.ms===null?Infinity:a.ms)-(b.ms===null?Infinity:b.ms);","return 0;",[]);
  await brk('a non-fabric pass is counted as a fabric issue',"phStr(gp.gpType)!=='fabric'","false",[K('cut per master: Hassan 1300')[0]]);
  await brk('fabric of two units is added together',"else if(units.length>1)mixedUnit++;","else if(units.length>1){fabric=byUnit.kg+byUnit.m;funit='kg';}",[]);
  await brk('alias lookup removed',"if(n&&aliasMap[n.toLowerCase()])return aliasMap[n.toLowerCase()];","",[K('cut per master: the registry flag')[0],K('cut per master: Hassan 1300')[0]]);
  await brk('cancelled POs are not left out of the jobs',"if(stage!=='cancelled'){\n      const hasCutAt","if(true){\n      const hasCutAt",[]);
  await brk('a PO with a cutAt but no quantities counts as a cut record',"if(hasCutAt&&cutArg!==null){","if(hasCutAt){cutArg=cutArg||1;",[]);
  await brk('the season filter ignores guessed seasons being their own bucket',"const s=i.season.season===null?'none':i.season.season;if(s!==F.season)return false;","",[K('filter season=summer')[0],K('filter season=winter')[0]]);
  await brk('the master filter is ignored',"if(F.master==='')return true;","return true;",[K('filter master=Alam: units')[0],K('filter master=unassigned')[0]]);
  await brk('the team benchmark follows the master filter',"const teamInfos=infos.filter(passSA);","const teamInfos=infos.filter(passSA).filter(function(i){return F.master===''||(F.master===PHR_NONE_MASTER?i.masterKey==='':i.masterKey===F.master);});",[K('filter master=Alam: the team')[0]]);
  await brk('the article filter is a substring instead of a prefix',"i.code.indexOf(F.article)!==0","i.code.indexOf(F.article)<0",[]);
  await brk('week starts on Sunday',"from=phWeekStart(day);to=phDayAdd(from,6);","from=phDayAdd(phWeekStart(day),-1);to=phDayAdd(from,6);",[K('mode week containing Wed')[0]]);
  await brk('From after To is accepted',"else if(from!==null&&to!==null&&from>to){bad=true;why='\"From\" is after \"To\".';from=to=null;}","",[K('a range with From after To')[0]]);
  await brk('an invalid date is accepted',"from=out.from===''?null:(phIsDay(out.from)?out.from:undefined);","from=out.from===''?null:out.from;",[K('a date that is not a real day')[0]]);
  await brk('no data shown as zero for Units cut',"const cutVal=function(v){return cutNoData?PHR_NO_DATA:v;};","const cutVal=function(v){return v;};",[K('no cut records: Units cut')[0]]);
  await brk('a no-cut section is an empty table, not a message',"const cutBlank=function(){return{state:cutNoData?'nodata':'empty',message:cutEmptyMsg};};","const cutBlank=function(){return{state:'ok',message:''};};",[K('no cut records: cut per master')[0]]);
  await brk('average of nothing printed as 0',"const none=function(me){return me.n?me.value:PHR_NO_DATA;};","const none=function(me){return me.value||0;};",[K('no PO issued and nothing cut')[0]]);
  await brk('lead time columns show 0 with no cut data',"const cv=function(v){return cutNoData?PHR_NO_DATA:v;};","const cv=function(v){return v;};",[K('no cut records: average cut qty')[0]]);
  await brk('a real zero is hidden once cut records exist',"const cutVal=function(v){return cutNoData?PHR_NO_DATA:v;};","const cutVal=function(v){return v?v:PHR_NO_DATA;};",[K('cut records exist but none')[0]]);
  await brk('a failed pos still builds sections',"if(F.range.bad||needPos){","if(F.range.bad){",[K('pos failed')[0]]);
  await brk('gatepasses failure is ignored for the master sections',"const masterBlock=needMaster?","const masterBlock=false?",[K('gatepasses failed')[0]]);
  await brk('a failed standards read still prints a verdict',"if(!stdOk)verdict=_phrUnavail(['ph_standards']);","if(false)verdict='x';",[K('ph_standards failed')[0]]);
  await brk('the benchmark ignores the single-master case',"if(team&&nTeam[u]>=2){","if(team){",[K('gross per master: Alam m')[0]]);
  await brk('overrides outside the range are listed',"if((range.from!==null&&day<range.from)||(range.to!==null&&day>range.to))return;","",[K('cut-gate overrides in range')[0]]);
  await brk('an unused (approved) override is dropped',"const used=phDay(co.usedAt)!==null,day=used?phDay(co.usedAt):phDay(co.at);","const used=phDay(co.usedAt)!==null,day=used?phDay(co.usedAt):null;if(day===null)return;",[K('cut-gate overrides in range')[0]]);
  await brk('membership is not asked of phReport (a hand-made list)',"x.lead=one.leadTime.n?'counted':one.leadTime.noStart?'noStart':one.leadTime.invalid?'invalid':null;","x.lead=one.leadTime.n?'counted':null;",[K('membership equals phReport')[0],K('lead time: PO-012')[0]]);
  await brk('the Excel sheet names are wrong',"XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(phrAoa(sec)),sec.sheet);","XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(phrAoa(sec)),sec.id);",[K('Excel: one sheet per section')[0]]);
  await brk('the filename omits the range',"const span=r.from===null&&r.to===null?'all-dates':(r.from||'start')+'_to_'+(r.to||'today');","const span='x';",[K('Excel: the range is in the filename')[0],K('PDF goes through printDocument')[0]]);
  await brk('the Excel export writes the bar column',"const cols=sec.columns.filter(function(c){return!c.bar;});\n  const idx=sec.columns.map(function(c,i){return c.bar?-1:i;}).filter(function(i){return i>=0;});","const cols=sec.columns;\n  const idx=sec.columns.map(function(c,i){return i;});",[K('Excel: Cut per master sheet')[0]]);
  await brk('numbers are exported as formatted text',"if(typeof v==='number')return v;\n  return phStr(v);\n}\nfunction phrAoa","if(typeof v==='number')return String(v);\n  return phStr(v);\n}\nfunction phrAoa",[K('Excel: Cut per master sheet')[0]]);
  await brk('verdict keys exported instead of words',"if(col.f==='verdict')return _phrVerdictText(v);\n  if(typeof v==='number')return v;","if(typeof v==='number')return v;",[K('Excel: Gross per product verdicts')[0]]);
  await brk('a no-data section exports an empty sheet',"if(sec.state!=='ok'){return[[sec.title],[sec.message||PHR_NO_DATA]];}","if(sec.state!=='ok'){return[[sec.title]];}",[K('Excel: a no-data section')[0]]);
  await brk('exports are open to a non-manager',"if(!(typeof phCanManage==='function'&&phCanManage()===true)){_phrToast('Exports are for the managers.',true);return false;}","",[K('exports: Uzaib')[0]]);
  await brk('a failed pos still exports',"if(!model||!model.exportable){","if(false){",[K('Excel: nothing is exported')[0]]);
  await brk('the PDF bypasses printDocument type generic',"window.printDocument({type:'generic',","window.printDocument({type:'po',",[K('PDF goes through printDocument')[0]]);
  await brk('the PDF turns Urdu on',"urduLevel:'none'","urduLevel:'full'",[K('PDF goes through printDocument')[0]]);
  await brk('angle brackets survive into the PDF text',"return phStr(s).replace(/[<>]/g,'').replace(/\\s+/g,' ').trim();","return phStr(s);",[K('PDF: angle brackets')[0]]);
  // (the mutation "a failed read re-reads itself on every repaint" is NOT run: it makes the tab repaint forever, which starves the event loop -- the check above holds it as one read)
  await brk('the offline copy counts as a read',"if(snap&&snap.metadata&&snap.metadata.fromCache===true){","if(false){",[K('an answer from the offline copy')[0]]);
  await brk('the app lists are ignored (always re-read)',"if(col==='pos'&&typeof allPOs!=='undefined'&&Array.isArray(allPOs)&&allPOs.length)return allPOs;","",[K('sources: allPOs / allPasses')[0]]);
  await brk('Retry re-reads everything',"const bad=['pos','gatepasses'].filter(function(n){return _phrSrc[n].state==='error';});","const bad=['pos','gatepasses'];",[K('Retry re-reads only')[0]]);
  await brk('the loading card is dropped (figures from an unread list)',"if(_phrSrc.pos.state==='loading'||_phrSrc.gatepasses.state==='loading'||_phrSrc.pos.state==='idle'||_phrSrc.gatepasses.state==='idle'){","if(false){",[K('while the read is out')[0]]);
  await brk('a non-manager is not refused by the render',"if(!ctx.canManage){","if(false){",[K('audience: phrRender itself')[0]]);
  await brk('the tab is not registered',"if(typeof phRegisterTab==='function')phRegisterTab('reports',{render:phrRender});","",[K('audience: the Reports tab is registered')[0],K('the Reports tab replaces')[0]]);
  await brk('the master name is parsed as HTML',"function _phrField(label,control){","function _phrField(label,control){ if(label==='Master'){const d=document.createElement('div');d.innerHTML='x';}\n  ",[K('XSS: the source never parses')[0]]);
  await brk('a stored name written with a tag-parsing helper',"td.textContent=_phrCellText(col,v);","td.innerHTML=_phrCellText(col,v);",[K('XSS: the source never parses')[0]]);
  await brk('a write sneaks in',"function phrReload(){","function phrReload(){ setDoc(doc(db,'pos','x'),{});",[K('read-only: the source names no Firestore write API')[0]]);
  await brk('a ph-write function is called',"function phrReset"+"Filters(){","function phrReset"+"Filters(){ phSaveStandard('X',{});",[K('read-only: the source calls no ph-write')[0]]);
  await brk('Open PO does not leave the takeover',"try{if(typeof phExit==='function')phExit();}catch(e){}","",[K('"Open PO" leaves')[0]]);
  await brk('a row click does not open its POs',"tr.addEventListener('click',function(){phrSelect(sec.id,r.key);});","",[K('clicking a row opens')[0]]);
  await brk('bars are not HTML (an svg)',"const track=phEl('div','phr-bar');","const track=phEl('svg','phr-bar');",[K('charts are HTML bars')[0]]);
  await brk('tables are not wrapped for scrolling',"const wrap=phEl('div','phr-scroll');wrap.setAttribute('tabindex','0');wrap.setAttribute('role','region');wrap.setAttribute('aria-label',sec.title+' table');","const wrap=phEl('div','phr-nowrap');wrap.setAttribute('tabindex','0');",[K('every table scrolls INSIDE')[0]]);
  await brk('a global without the prefix',"function _phrBtn(cls,text,fn,attrs){","function zzBtn(cls,text,fn,attrs){",[K('globals: every top-level name')[0]]);
  s.ok('breaks run: '+broken,broken>=45);
  return s;
};
// shared with tests/smoke-layout.js (the layout fragment renders the same fixture through the same loader)
module.exports.fixture=fixture;
module.exports.load=load;
module.exports.RANGE=RANGE;
module.exports.PERM=PERM;

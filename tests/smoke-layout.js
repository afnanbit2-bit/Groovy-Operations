#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Layout smoke test.  `node tests/smoke-layout.js`

   Renders real markup from the real modules, puts it in a real browser with
   the real stylesheet, and MEASURES it. Everything else in tests/ proves
   logic; this is the first thing here that can see a layout.

   It exists because of a bug that shipped: the Team directory on the
   Profile page put the person's name and the action buttons in one flex row
   inside a 220px grid tile. The buttons are flex-shrink:0 and the name is
   flex:1;min-width:0, so the name was squeezed to EXACTLY ZERO WIDTH and
   every row rendered anonymously — you could not tell whose profile was
   whose. Measured after the fix: 0px → 177px at the same window width. The
   assertion suites were all green through the whole thing, because the name
   was in the DOM the entire time; it just had nowhere to go.

   The same class of failure has bitten this app repeatedly — the board's
   entire top bar invisible for weeks behind a wrong z-index, the delete X
   whose click was retargeted by a pointer capture, the profile photo that
   was a plain <img> with no handler. So the checks are written generally:
   render a fragment, then fail on any element that carries text but
   occupies no width, any container that overflows itself, and any
   CLICKABLE element that is zero-sized, pointer-events:none, or covered by
   something else when the browser hit-tests its centre. Add fragments to
   FRAGMENTS as pages grow.

   Checks each fragment at desktop, laptop and phone widths — a tile that
   fits at 1900px can still collapse at 1280px, which is the width most
   people actually use.

   Skips cleanly (exit 0) when no browser is available.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const os=require('os');
const {execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
const {loadApp}=require('./harness');

function findBrowser(){
  if(process.env.CHROME_BIN&&fs.existsSync(process.env.CHROME_BIN))return process.env.CHROME_BIN;
  const candidates=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
    '/usr/bin/chromium','/usr/bin/chromium-browser'];
  for(const c of candidates)if(fs.existsSync(c))return c;
  try{
    const base='/opt/pw-browsers';
    for(const d of fs.readdirSync(base)){
      const p=path.join(base,d,'chrome-linux','chrome');
      if(fs.existsSync(p))return p;
    }
  }catch(e){}
  return null;
}

// ── the fragments under test ─────────────────────────────────────────────
// Each returns real HTML from the real module. Names are filled in here
// because the modules hydrate them with textContent at runtime, which the
// node harness's stub DOM records but does not put into the markup — the
// hydration itself is covered by tests/profile.test.js.
const FRAGMENTS={
  'profile page (owner, mixed profiles)':()=>{
    const app=loadApp({
      files:['js/boards.js','js/profile.js'],currentPage:'profile',
      session:{uid:'uid-afnan',u:'afnan',name:'Afnan',role:'owner',
               title:'Co-founder',email:'afnan@groovy.op'},
      globals:{getDocs:async()=>({docs:[{id:'uid-afnan',data:()=>({
        uid:'uid-afnan',username:'afnan',displayName:'Afnan',
        jobTitle:'Co-founder',department:'Operations',nameColor:'#7B1F2A'})}]})}
    });
    return app.run('loadProfiles(true)').then(()=>{
      let html=app.run('renderProfilePage()');
      // Longest real names in USER_DEFS, so the measurement is the worst case.
      ['Afnan','Ammar','Mustafa','Uzaib'].forEach((n,i)=>{
        html=html.replace(new RegExp('(id="prof-dir-n-'+i+'"[^>]*>)'),'$1'+n);
        html=html.replace(new RegExp('(id="prof-dir-s-'+i+'"[^>]*>)'),
          '$1Printing &amp; Embellishments');
      });
      return html;
    });
  },
  // A 280px column with a 2-up grid of thumbnails and wrapping labels —
  // precisely the shape that crushed the Profile directory. Rendered inside
  // a stand-in for the canvas wrap, since the real one is position:fixed.
  'boards — Unsorted tray':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'}`);
    app.run(`_boardsTrayOpen=true`);
    app.run(`_editUnsorted=[
      {id:'u1',kind:'text',text:'A note with a fairly long first line that has to wrap somewhere'},
      {id:'u2',kind:'file',fileName:'winter-sequence-2026-techpack-final-v3.pdf',fileSize:2400000},
      {id:'u3',kind:'link',linkUrl:'https://example.test/a',linkTitle:'example.test'},
      {id:'u4',kind:'file',fileName:'a.pdf'}
    ]`);
    let html=app.run('_boardsTrayHTML(true)');
    app.run('_boardsTrayHydrate()');
    // Same reason as above: hydration goes into the harness's stub nodes, so
    // the labels are written in here for the measurement.
    ['A note with a fairly long first line that has to wrap somewhere',
     'winter-sequence-2026-techpack-final-v3.pdf','example.test','a.pdf'].forEach((t,i)=>{
      html=html.replace(new RegExp('(id="board-tray-l-'+i+'"[^>]*>)'),'$1'+t);
    });
    // The tray is position:absolute against the canvas wrap; give it one.
    return Promise.resolve(
      '<div style="position:relative;height:600px;width:100%">'+html+'</div>');
  },
  // Cards carrying every piece of chrome at once — the shape QA reported
  // twice: a label and a reaction row stealing the body's height until the
  // sub-board card's own title was gone, and a file card whose Open and
  // Download buttons sit inside a body that is also a drag handle. The
  // hit-test is the real value here: these two buttons are the exact
  // pattern (a control inside a drag surface) that made the delete X inert.
  // A column and its children: the derived layout, measured. Guards the
  // geometry (nothing clipped out of view, every control reachable) and
  // the header strip, which is the only interactive part of the container.
  //
  // What it does NOT prove, checked by deliberately removing the rule: the
  // column's `pointer-events:none`. The children are painted ABOVE the
  // column as later siblings, so elementFromPoint reaches them either way.
  // That rule is there so panning and marquee-select work THROUGH the
  // column's background, which is behaviour no layout measurement sees.
  // The store category chips — the control Afnan reported as unreadable in
  // dark mode, and the shape the same bug took in eight other files.
  'store — inventory category chips':()=>{
    const app=loadApp({files:['js/store.js'],globals:{
      allItems:[],_invFilterCat:'all',_invSearchQ:'',_invSort:'category',
      _catLabel:k=>k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()),
      getStatus:()=>'ok',getBal:()=>0
    }});
    // Only the chip row is under test; renderInventory pulls in far more.
    const html=app.run(`(()=>{
      const chip=(key,label,count,active)=>\`<button style="padding:6px 12px;border:1px solid \${active?'var(--dark)':'var(--border)'};border-radius:999px;background:\${active?'var(--dark)':'var(--surface)'};color:\${active?'var(--on-dark)':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit;font-weight:\${active?'600':'500'}">\${label}\${count!=null?\` <span style="opacity:.7;font-weight:400">\${count}</span>\`:''}</button>\`;
      const cats=[['all','All',300,true],['neck','Neck Labels',19,false],['sleeve','Sleeve & Hem Labels',6,false],['patches','Patches',7,false]];
      return '<div class="card" style="padding:12px"><div style="display:flex;gap:6px;flex-wrap:wrap">'+
        cats.map(c=>chip(c[0],c[1],c[2],c[3])).join('')+'</div></div>';
    })()`);
    return Promise.resolve(html);
  },
  // The embellishments track's SLA panel, priority chip and PP-attempt rows.
  // Every one of these used to pair a FIXED light background with a
  // foreground that follows the theme (var(--green), var(--amber),
  // var(--muted)), so in dark mode they rendered light-on-light. The
  // contrast check below is what actually proves this; the geometry checks
  // would pass either way.
  'embellishments — SLA panel, priority chip, PP attempts':()=>{
    const app=loadApp({files:['js/embellishments.js'],
      session:{u:'ammar',name:'Ammar',role:'owner'},
      globals:{allRecipes:[],allPOs:[],allPrintingJobs:[],allQCReports:[],
               allPrintBilling:[]}});
    const mk=(pri,dueOffsetMs)=>({
      _id:'j-'+pri,poNumber:'PO-2041',articleCode:'GRV-HD-114',
      articleName:'Oversized hoodie — winter drop',priority:pri,
      currentStage:'printing',processType:'screen_print',
      slaCurrentDue:new Date(Date.now()+dueOffsetMs).toISOString(),
      sizeBreakdown:{S:10,M:24,L:18},
      ppAttempts:[
        {attemptNo:1,status:'approved',by:'Ammar',at:new Date().toISOString()},
        {attemptNo:2,status:'rejected',by:'Ammar',at:new Date().toISOString(),
         rejectionReason:'Pantone 185 C came out too warm'},
        {attemptNo:3,status:'pending',by:'Ammar',at:new Date().toISOString()}
      ]});
    // ok / near / over / critical all at once — each has its own tint.
    const jobs=[mk('urgent',-9e6),mk('normal',36e5),mk('flexible',864e5)];
    const html=jobs.map(j=>app.run('printWorkerCardHTML('+JSON.stringify(j)+')')).join('')
      +app.run('renderPPAttemptsCard('+JSON.stringify(jobs[0])+')')
      +app.run('renderTowerSwimlane("printing",[])');
    return Promise.resolve(html);
  },
  // A table carrying cell attributes — bold, sized, aligned and coloured —
  // with one cell focused. The contrast check is the point: a cell colour
  // is a palette NAME painted by a class precisely so it reads in BOTH
  // themes, which a stored hex could not do.
  'boards — a table with styled cells':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set(['t']);moodBoards=[];
      _editCards=[{id:'t',type:'table',x:20,y:20,w:360,h:460,head:true,rows:[
        ['Fabric','Qty','Status'],
        [{v:'Cotton drill 8.5oz',b:true},'120',{v:'Cleared',bg:'green'}],
        [{v:'Fleece 320gsm',sz:'l'},{v:'40',al:'r'},{v:'Rework',bg:'red'}],
        ['Rib 2x1',{v:'8',al:'c',i:true,bg:'purple'},{v:'Pending',bg:'blue'}],
        [{v:'1',t:'check'},{v:'45000',t:'currency'},{v:'twelve',t:'number'}],
        [{v:'',t:'check'},{v:'12',t:'percent'},{v:'2026-09-15',t:'date'}],
        ['Total',{v:'=SUM(B2:B4)',t:'currency'},{v:'=NOPE(1)'}]
      ]}];
      _boardsCellFocus={id:'t',r:1,i:0};`);
    let html=app.run(`_boardCardHTML(_editCards[0],true)`);
    // Hydration writes into the harness's stub nodes, so the text is put
    // back here for the measurement — same as every other fragment.
    app.run(`_editCards[0].rows`).forEach((row,r)=>row.forEach((cell,i)=>{
      const v=app.run(`_boardsCellDisplay(_editCards[0].rows[${r}][${i}])`);
      html=html.replace(new RegExp('(id="board-td-t-'+r+'-'+i+'"[^>]*>)'),'$1'+v);
    }));
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:580px;width:100%">'+html+'</div>');
  },
  'boards — a column and its cards':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set();moodBoards=[];
      _editCards=[
        {id:'col',type:'column',title:'Winter fabric',x:20,y:20,w:260,h:160},
        {id:'a',type:'text',text:'Cotton drill 8.5oz',x:0,y:0,w:170,h:90,columnId:'col'},
        {id:'b',type:'file',fileName:'swatch-card.pdf',fileSize:20480,
         fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/s.pdf',x:0,y:0,w:170,h:130,columnId:'col'}
      ];
      _boardsLayoutColumns();`);
    let html=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    html=html.replace(/(id="board-txt-a"[^>]*>)/,'$1Cotton drill 8.5oz');
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:600px;width:100%">'+html+'</div>');
  },
  // The trash panel is a list of rows that each pair a long, unbounded
  // string (the card preview) with fixed-width chrome and two buttons —
  // the exact shape that crushed the Profile directory's names to 0px.
  // Both tabs' buttons must also be genuinely clickable: the panel sits
  // beside the rail and a z-index a step out would bury it, which is how
  // the board's whole top bar was invisible for weeks.
  //
  // VERIFIED BOTH WAYS, and worth recording WHICH way: recolouring the day
  // header to its own background fails this fragment at 1:1 in both themes,
  // so the contrast and text checks genuinely reach it. The "overflows its
  // own box" check does NOT bite here, and that is correct rather than a
  // gap — the panel is overflow:hidden, so a too-wide row is clipped and
  // cannot push the page around. A 2000px flex child and a 3000px row were
  // both tried and both passed for that reason. What protects a clipped
  // panel is the "text laid out entirely outside its clipping ancestor"
  // check, not the overflow one.
  // The rail went from a floating pill to a full-height column. MEASURED,
  // rather than argued: the rail's content is ~616px tall, and the old pill
  // was capped at calc(100% - 40px), so it overflowed on any stage shorter
  // than ~656px — a 720p laptop once the browser chrome and the board's own
  // top bar are taken off. Trash, pinned last, was the entry that fell off.
  //
  // 640px here is that laptop. VERIFIED BOTH WAYS at this height: the old
  // pill reports 616 > 598 and fails, the column passes. At 660px BOTH pass
  // (620 of room for 611 of tools, a 9px margin) — which is why the first
  // version of this fragment proved nothing and was rewritten rather than
  // kept green.
  // The regrouped top bar. Seven controls where there were thirteen, and
  // the hit-test is the point: the View button is the only way to reach
  // zoom, Fit, Snap and the minimap now, so a View button the browser
  // cannot actually click takes all four down with it.
  'boards — the board top bar':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'Winter Drop 2027',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];moodBoards=[];
      _boardsMenuOpen=false;_boardsViewOpen=false;`);
    const full=app.run(`_renderBoardCanvasHTML()`);
    // Just the bar: the stage below it is a pan/zoom surface with no
    // intrinsic height, and pulling it in measures nothing useful.
    const i=full.indexOf('<div class="board-topbar">');
    const j=full.indexOf('<div class="board-stage"');
    return Promise.resolve(
      '<div style="position:relative;width:100%">'+full.slice(i,j)+'</div>');
  },
  'boards — the tool rail':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _boardsRenderRail();`);
    const inner=app.run(`document.getElementById('board-rail').innerHTML`);
    // 660px is a 768px-tall laptop minus the app top bar — the height at
    // which the old pill clipped.
    return Promise.resolve(
      '<div style="position:relative;height:640px;width:100%;overflow:hidden">'+
      '<div class="board-rail" id="board-rail">'+inner+'</div></div>');
  },
  'boards — the trash panel':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _boardsCardTrashOpen=true;_boardsCardTrashTab='mine';
      const now=Date.now();
      _boardsCardTrash=[
        {id:'e1',card:{id:'g1',type:'text',text:'Winter Drop 2027 — fleece weight comparison against last season, full tech pack notes'},
         conns:[],byUid:'u1',byName:'Afnan',at:now},
        {id:'e2',card:{id:'g2',type:'file',fileName:'swatch-card.pdf'},conns:[],byUid:'u1',byName:'Afnan',at:now},
        {id:'e3',card:{id:'g3',type:'table',rows:[['A']]},conns:[],byUid:'u1',byName:'Afnan',at:now-86400000}
      ];`);
    // Render through the real function into the real host, then hand back
    // what it produced — the panel hydrates its text with textContent, so
    // reading innerHTML after the call is the only way to see the rows.
    app.run(`(function(){
      const host=document.createElement('div');
      host.id='board-ctrash-panel';host.className='board-ctrash-panel';
      document.body.appendChild(host);
      _boardsRenderTrash();
      return true;})()`);
    const inner=app.run(`document.getElementById('board-ctrash-panel').innerHTML`);
    // The host itself is position:absolute inside the canvas wrap, so the
    // fragment supplies that containing block rather than letting it
    // escape to the page and measure nothing.
    return Promise.resolve(
      '<div style="position:relative;height:620px;width:100%">'+
      '<div class="board-ctrash-panel" style="display:flex">'+inner+'</div></div>');
  },
  'boards — a card wearing labels, reactions and captions':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set();
      moodBoards=[{id:'CHILD',title:'Winter Drop 2027',cards:[{id:'x'}],visibility:'shared',ownerUid:'u1'}];
      _editCards=[
        {id:'sb',type:'board',boardId:'CHILD',x:10,y:10,w:200,h:104,
         labels:[{t:'QA-LABEL',c:'grey'}],reactions:{'A':['u2']}},
        {id:'fl',type:'file',x:10,y:210,w:200,h:140,caption:'Approved 12 Sep',
         fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/t.pdf',
         fileName:'winter-techpack-v4.pdf',fileSize:2841193},
        {id:'or',type:'board',boardId:'',x:10,y:420,w:200,h:104}
      ];`);
    let html=app.run(`_editCards.map(c=>_boardCardHTML(c,true)).join('')`);
    // Hydrated at runtime with textContent; written in here so it can be measured.
    html=html.replace(/(id="board-label-sb-0"[^>]*>)/,'$1QA-LABEL')
             .replace(/(id="board-cap-fl"[^>]*>)/,'$1Approved 12 Sep');
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:600px;width:100%">'+html+'</div>');
  },
  // The Cutting / Issue Registry's filter bar: a wrapping row of six preset
  // buttons with an inline CUT DATE label, the range caption under the stat
  // tiles, and the day headers in the list — each of which puts a label and
  // a number in one justify-between row, the shape that crushed the Profile
  // directory's names to 0px. Both date-bar states are rendered so the
  // custom from/to inputs are measured too. The hit-test matters here: the
  // presets are the controls the whole feature is operated with.
  'cutting registry — cut-date filter':()=>{
    const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const day=n=>{const d=new Date();d.setDate(d.getDate()-n);
      const p=v=>String(v).padStart(2,'0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
    const iss=(i,date,ts)=>({gpType:'fabric',id:'GP-34'+i,ts,date,poId:'PO-1'+i,
      articleName:'EFFORTLESS TEE — FADED OLIVE',articleCode:'GP09'+i,
      fabricType:'Jersey Heavy',fabricGsm:248,fabricColor:'Slate Grey',fabricUnit:'kg',
      plannedQty:90+i,totalBundles:4,fabricQty:26.9,rollsCount:1,avgConsumption:0.2989,
      sizeBreakdown:[{size:'S',qty:15,bundles:[15]},{size:'M',qty:30,bundles:[30]},
                     {size:'L',qty:30,bundles:[30]},{size:'XL',qty:15,bundles:[15]}],
      issuer:'Uzaib',cutMaster:'Hassan',regIncomplete:i===2,
      regLabels:i===1?[{text:'PRINTING',bg:'#ede9fe',fg:'#5b21b6'}]:[]});
    const app=loadApp({files:['js/fabric.js'],currentPage:'',globals:{
      allPasses:[iss(1,day(0),5e3),iss(2,day(0),4e3),iss(3,day(1),3e3),iss(4,day(4),2e3)],
      allFabricInventory:[],allFabricMovements:[],allPOs:[],_gpEsc:esc}});
    const card=app.run('renderFabricIssueRegistry()');
    // …and the same bar in its custom state, which the reset above clears.
    app.run(`(_fabRegDate={preset:'custom',from:'${day(7)}',to:'${day(0)}'},1)`);
    const custom=app.run('_fabRegDateBarHTML()');
    return Promise.resolve(card+'<div class="card">'+custom+'</div>');
  },

  // The Creator Database (Marketing M1): stat tiles, filter bar, a table
  // carrying every tier chip (including the "manual" badge and an unscored
  // row) and the Needs completion column. The table is allowed to scroll
  // sideways inside its own wrapper at 420px; the page must not.
  // The Pattern Hub measurement grid. The size headers must sit over their
  // own input boxes: they were right-aligned in a column stretched to the
  // full card width while the 64px input sat at its left edge, so every
  // label drifted ~135px right — the XS label landed over the S box.
  // NOTE: this probe does not measure ALIGNMENT, only zero-width text,
  // overflow, hit-testing and contrast. The alignment itself is a one-off
  // Chromium measurement (135px drift before, 0px after) and is held here
  // only as the markup rule, in tests/patterns.test.js.
  'pattern hub — measurement grid':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const tpl={id:'pant',label:'Pants & trousers',poms:[
      {key:'waist_relaxed',label:'Waist (relaxed)',howTo:'Lay flat. Across the top of the waistband, edge to edge, without stretching.'},
      {key:'hip',label:'Hip',howTo:'Across the widest point of the seat, lying flat, at the crotch line.'},
      {key:'inseam',label:'Inseam',howTo:'From the crotch seam down to the bottom of the leg, along the inner seam.'}]};
    const block={id:'ptn_0004',code:'PTN-0004',name:'LIVE IN PANTS',category:'GST',status:'active',
      sizeAxis:'alpha',sizes:['XS','S','M','L','XL','2XL'],sampleSize:'M',pomTemplate:'pant',
      extraPoms:[{key:'cuff',label:'Cuff'}],grid:{M:{hip:22.5}},hook:null,slot:null,
      fit:'Baggy',tracedBy:'Hassan',createdAt:'2026-09-17'};
    const mk=session=>{
      const app=loadApp({files:['js/patterns.js'],currentPage:'pattern-block',session,globals:{localStorage:LS}});
      app.run('pomTemplates='+JSON.stringify([tpl])+';_ptnPomsLoaded=true;patterns=['+JSON.stringify(block)+'];_ptnBlocksLoaded=true;');
      return app.run('_ptnGridCardHTML(_ptnBlock("ptn_0004"))');
    };
    // The editable grid (an admin) and the read-only one (cutting), since
    // they build different cells and both have to line up.
    return mk({uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'})
         + mk({uid:'u2',u:'uzaib',name:'Uzaib',role:'viewer',email:'uzaib@groovy.op'});
  },

  // The Pattern Hub card on the Dashboard (M7). Four stat tiles in one flex
  // row plus a two-line caption — the same justify/flex shape that crushed
  // the Profile directory's names to 0px, and it has to survive 420px.
  // Rendered twice: populated, and in its failed-read state, whose message
  // is the longest string the card can carry.
  'pattern hub — dashboard card':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const data={
      articles:[
        {id:'GST060',code:'GST060',name:'Live in Pants | Ash',brand:'groovy',category:'GST',needsPattern:true,active:true,patternId:'ptn_0007'},
        {id:'GST062',code:'GST062',name:'Live in Pants | Cool',brand:'groovy',category:'GST',needsPattern:true,active:true,patternId:null},
        {id:'GHW001',code:'GHW001',name:'Cap',brand:'groovy',category:'GHW',needsPattern:false,active:true,patternId:null}
      ],
      patterns:[
        {id:'ptn_0007',code:'PTN-0007',name:'Live In Pants block',category:'GST',status:'active',sizeAxis:'alpha',sizes:['S','M'],hook:3,slot:2,extraPoms:[{key:'hem',label:'Hem'}],grid:{S:{hem:22},M:{hem:23}},labelPrinted:{S:{at:'2030-01-01'},M:{at:'2030-01-01'}}},
        {id:'ptn_0011',code:'PTN-0011',name:'Half-done block',category:'GST',status:'active',sizeAxis:'alpha',sizes:['S','M'],extraPoms:[{key:'hem',label:'Hem'}],grid:{S:{hem:22}},labelPrinted:{}}
      ],
      pattern_slots:[],
      pattern_notices:[{id:'n1',patternId:'ptn_0007',patternCode:'PTN-0007',revisionN:2,summary:'Hem shortened',lines:[],articleCodes:['GST060'],status:'open',raisedAt:'2026-09-17'}]
    };
    const app=loadApp({files:['js/patterns.js'],currentPage:'dashboard',
      session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
      globals:{localStorage:LS,
        doc:(db,...rest)=>({key:rest.join('/')}),
        collection:(db,...rest)=>({name:rest.join('/')}),
        getDoc:async()=>({exists:()=>false,data:()=>({})}),
        getDocs:async ref=>({docs:(data[String(ref&&ref.name||'')]||[]).map(r=>({id:r.id,data:()=>r}))})}});
    return app.run('_ptnPoEnsure()').then(()=>{
      const card=app.run('renderPatternDashboardWidget()');
      const ok=card.replace('Loading…',app.run('_ptnDashBodyHTML()'));
      const bad=card.replace('Loading…',app.run("_ptnFailed.articles=true;_ptnDashBodyHTML()"));
      return ok+bad;
    });
  },

  'marketing — creator database':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const rows=[
      {ig_handle:'saritasangrez',name:'Sarita Sangrez',tier:'A',score:82,follower_count:128000,engagement_rate:0.052,city:'Lahore',niche:['Fashion Creator','Content Creator'],status:'active'},
      {ig_handle:'night_flarz',name:'Night Flarz',tier:'B',score:61,follower_count:42000,engagement_rate:0.031,city:'Karachi',niche:['Content Creator'],status:'active',tier_is_override:true,tier_formula:'C',tier_override_reason:'Strong past sales',avg_likes:1200,avg_comments:100,avg_views:30000,data_source:'api',api_fetched_at:Date.now()-3600000},
      {ig_handle:'st4rr.doll',name:'',tier:'C',score:35,follower_count:12000,engagement_rate:0.02,city:'Islamabad',niche:['Blogger','Meme/Comedy','Fitness'],status:'do_not_use'},
      {ig_handle:'shoaibkhn.t',name:'Shoaib Khan',tier:'below_threshold',score:60,follower_count:500000,engagement_rate:0.005,city:'Rahim Yar Khan',niche:[],status:'blacklisted'},
      {ig_handle:'shadysaidthat',name:'',tier:null,score:null,follower_count:null,engagement_rate:null,city:'',niche:[],status:'active'}
    ].map((r,i)=>Object.assign({id:'cr_'+i},r));
    const app=loadApp({files:['js/auth.js','js/marketing.js'],currentPage:'mkt-creators',
      session:{uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'},
      globals:{localStorage:LS,getDocs:async()=>({docs:rows.map(r=>({id:r.id,data:()=>r}))})}});
    return app.run('loadMarketingCreators()').then(()=>{
      const page=app.run('renderMarketingCreators()');
      app.run("_mktFilter.view='incomplete'");
      const incomplete=app.run('_mktListHTML()');
      // The creator form: the "Fetch from Instagram" row sits beside the
      // Source picker and must stay reachable at phone width.
      app.run("window.mktOpenCreator('cr_1')");
      const fetched=app.bodyHtml('mkt-modal-back');
      app.run("window.mktOpenCreator('')");
      const blank=app.bodyHtml('mkt-modal-back');
      return page+incomplete+fetched+blank;
    });
  },

  // The Dispatch Log (Marketing M2): the list with every status and Day-7
  // state, plus the log form with a creator and two products picked, and
  // the Day-7 capture form. Modals are rendered as their inner card only —
  // the fixed backdrop is shared app chrome, not this page's layout.
  // Paid PR Approvals (Marketing M3): the page, a pending request as the
  // APPROVER sees it (Approve / Reject reachable), and an approved one with
  // the payment form. The approve/reject buttons are the gate's only UI, so
  // the hit-test matters most here.
  'marketing — paid PR approvals':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const now=Date.now(),DAY=86400000;
    const creators=[
      {id:'cr_a',ig_handle:'saritasangrez',name:'Sarita Sangrez',city:'Lahore',status:'active',tier:'A',address:'House 3, Gulberg III',phone:'0300 7654321'},
      {id:'cr_b',ig_handle:'night_flarz',name:'Night Flarz',status:'active',tier:'B'}
    ];
    const reqs=[
      {id:'p1',creator_id:'cr_a',status:'pending',deliverable:'1 Reel + 3 story frames, tagged, link in bio for 48h',proposed_amount_pkr:45000,timeline:'Posts within 10 days of receipt',rationale:'Top engagement in the Lahore set; last organic post drove 38 coded orders.',requested_by_user_id:'u2',created_at:now-2*DAY,payment_status:'unpaid'},
      {id:'p2',creator_id:'cr_b',status:'approved',deliverable:'2 Reels',proposed_amount_pkr:120000,requested_by_user_id:'u2',created_at:now-9*DAY,decided_by_user_id:'u1',decided_at:now-8*DAY,dispatch_id:'dx',payment_status:'unpaid'},
      {id:'p3',creator_id:'cr_b',status:'rejected',deliverable:'Account takeover for a week',proposed_amount_pkr:350000,requested_by_user_id:'u2',created_at:now-20*DAY,decided_by_user_id:'u1',decided_at:now-19*DAY,rejection_reason:'Out of budget this quarter'}
    ];
    const dispatches=[{id:'dx',creator_id:'cr_b',type:'paid_pr',paid_pr_request_id:'p2',status:'confirmed',date_of_dispatch:'',products:[]}];
    const app=loadApp({files:['js/auth.js','js/marketing.js'],currentPage:'mkt-paid-pr',
      session:{uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op',canApprovePaidPR:true},
      globals:{localStorage:LS,
        collection:(db,name)=>({name}),
        getDocs:async ref=>({docs:(ref.name==='creators'?creators:ref.name==='dispatches'?dispatches:ref.name==='paid_pr_requests'?reqs:[]).map(r=>({id:r.id,data:()=>r}))})}});
    return app.run('loadMarketingCreators()').then(()=>{
      const page=app.run('renderMarketingPaidPR()');
      app.run("_mktPrFilter.status='all'");
      const all=app.run('_mktPrListHTML()');
      app.run("window.mktOpenPaidPR('p1')");
      const pending=app.bodyHtml('mkt-modal-back');
      app.run("window.mktOpenPaidPR('p2')");
      const approved=app.bodyHtml('mkt-modal-back');
      return page+all+'<div class="card">'+pending+'</div><div class="card">'+approved+'</div>';
    });
  },

  // Reports and the sheet importer (Marketing M6/M7). Reports carry four
  // tables and three explanatory strips; the importer carries the long
  // preview lists, the duplicate radios and the Name-column checkboxes.
  'marketing — reports and importer':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const DAY=86400000,now=Date.now();
    const day=n=>{const d=new Date(now-n*DAY);const p=v=>String(v).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
    const creators=[
      {id:'cr_a',ig_handle:'saritasangrez',name:'Sarita Sangrez',status:'active'},
      {id:'cr_b',ig_handle:'night_flarz',name:'Night Flarz',status:'active'}
    ];
    const dispatches=[
      {id:'d1',creator_id:'cr_a',type:'organic',date_of_dispatch:day(40),status:'content_received',link_to_post:'https://x',performance_captured_at:1,performance_views:18400,performance_likes:1200,performance_comments:80,performance_saves:64,products:[{variant_id:'v1',product_title:'Effortless Tee',variant_title:'Rust / M',sku:'GP01-R-M'}]},
      {id:'d2',creator_id:'cr_b',type:'organic',date_of_dispatch:day(5),status:'shipped',products:[{variant_id:'v2',product_title:'Love Hurts Hoodie',variant_title:'Black / L'}]}
    ];
    const reqs=[
      {id:'p1',creator_id:'cr_a',status:'approved',proposed_amount_pkr:45000,decided_at:now-20*DAY,payment_status:'paid'},
      {id:'p2',creator_id:'cr_b',status:'approved',proposed_amount_pkr:120000,decided_at:now-50*DAY,payment_status:'unpaid'}
    ];
    const lines=[{sku:'GP01-R-M',quantity:3,order_created_at:new Date(now-45*DAY).toISOString()},{sku:'GP01-R-M',quantity:11,order_created_at:new Date(now-35*DAY).toISOString()}];
    const sheet={SheetNames:['Master List','Sep 2026'],Sheets:{
      'Master List':[['Tier','Name','IG Handle','Niche','City','Address','Phone #','Top Size','Bottom Size'],
        ['A','Sarita','saritasangrez','Fashion Creator','lahore','','','small','medium'],
        ['A','','a.very.long.handle.name_2026','Content Creator, Meme/Comedy','taxila','House 14, Street 9, Sector F-7/2, Islamabad Capital Territory','0300 1234567','large/xl','34/medium'],
        ['B','_kinzaa11','','','','','','',''],
        ['','One','shadysaidthat','','','','','',''],['','Two','shadysaidthat','','','','','',''],
        ['A','','','','','','','','']],
      'Sep 2026':[['Date of Dispatch','IG Handle','Collection Sent','Products sent','Status','Link to Post'],
        ['','st4rr.doll','Lowkey Heat','rust effortless, love hurts, ','',''],['','shadysaidthat','Live In Pants','','','']]
    }};
    const app=loadApp({files:['js/auth.js','js/marketing.js'],currentPage:'mkt-reports',
      session:{uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op',canApprovePaidPR:true},
      globals:{localStorage:LS,XLSX:{utils:{sheet_to_json:sh=>sh}},
        collection:(db,name)=>({name}),
        getDoc:async()=>({exists:()=>false}),
        getDocs:async ref=>({docs:(ref.name==='creators'?creators:ref.name==='dispatches'?dispatches:ref.name==='paid_pr_requests'?reqs:ref.name==='shopify_line_items'?lines:[]).map(r=>({id:r.id||'x',data:()=>r}))})}});
    return app.run('loadMarketingCreators()').then(()=>app.run('Promise.all([_mktLoadLineItems(),_mktLoadCatalog()])')).then(()=>{
      const reports=app.run('renderMarketingReports()');
      app.run('mktImportFromWorkbook('+JSON.stringify(sheet)+',"Final_Content_Tracker_2026.xlsx")');
      const imp=app.run('renderMarketingImport()');
      return reports+imp;
    });
  },

  'marketing — dispatch log':()=>{
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const DAY=86400000,now=Date.now();
    const day=n=>{const d=new Date(now-n*DAY);const p=v=>String(v).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
    const creators=[
      {id:'cr_a',ig_handle:'st4rr.doll',name:'Starr Doll',city:'Lahore',address:'House 12, Street 4, DHA Phase 5',phone:'0300 1234567',top_size:'M',bottom_size:'30',status:'active',tier:'B'},
      {id:'cr_b',ig_handle:'shoaibkhn.t',name:'Shoaib Khan',status:'active',tier:'A'},
      {id:'cr_c',ig_handle:'shadysaidthat',name:'',status:'active'}
    ];
    const P=(t,v)=>({product_id:'1',variant_id:t+v,product_title:t,variant_title:v});
    const dispatches=[
      {id:'d1',creator_id:'cr_a',type:'organic',date_of_dispatch:day(1),collection_sent:'Lowkey Heat',status:'confirmed',products:[P('Effortless Tee','Rust / M'),P('Love Hurts Hoodie','Black / L'),P('Tinted Denim','Blue / 30')]},
      {id:'d2',creator_id:'cr_b',type:'organic',date_of_dispatch:day(3),collection_sent:'Lowkey Heat',status:'in_transit',products:[P('Essential 2.0','Black / M')]},
      {id:'d3',creator_id:'cr_c',type:'organic',date_of_dispatch:day(12),collection_sent:'Live In Pants',status:'shipped',shipped_at:now-10*DAY,products:[P('Live In Pants','Grey / 32')]},
      {id:'d4',creator_id:'cr_a',type:'organic',date_of_dispatch:day(20),collection_sent:'Lowkey Heat',status:'content_received',shipped_at:now-18*DAY,content_received_at:now-15*DAY,link_to_post:'https://www.instagram.com/p/abc/',products:[P('Script Tee','Blue / M')],performance_captured_at:now-8*DAY,performance_views:12500,performance_likes:900,performance_comments:40,performance_saves:31,performance_story_replies:5},
      {id:'d5',creator_id:'cr_b',type:'organic',date_of_dispatch:'',collection_sent:'',status:'confirmed',products:[],products_note:'rust effortless, love hurts'}
    ];
    const app=loadApp({files:['js/auth.js','js/marketing.js'],currentPage:'mkt-dispatches',
      session:{uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'},
      globals:{localStorage:LS,
        collection:(db,name)=>({name}),
        getDocs:async ref=>({docs:(ref.name==='creators'?creators:ref.name==='dispatches'?dispatches:[
          {id:'v1',product_title:'Effortless Tee',color:'Rust',size:'M',sku:'GP01-R-M',status:'active'},
          {id:'v2',product_title:'Effortless Tee',color:'Blue',size:'M',sku:'GP01-B-M',status:'draft'}
        ]).map(r=>({id:r.id,data:()=>r}))}),
        getDoc:async()=>({exists:()=>true,data:()=>({last_success_at:{seconds:Math.floor((now-3*3600000)/1000)}})})}});
    return app.run('loadMarketingCreators()').then(()=>app.run('_mktLoadCatalog()')).then(()=>{
      const page=app.run('renderMarketingDispatches()');
      app.run("window.mktOpenDispatch('d1')");
      const form=app.bodyHtml('mkt-modal-back');
      app.run("window.mktOpenDispatch('')");
      const blank=app.bodyHtml('mkt-modal-back');
      app.run("window.mktOpenPerformance('d3')");
      const perf=app.bodyHtml('mkt-modal-back');
      return page+'<div class="card">'+form+'</div><div class="card">'+blank+'</div><div class="card">'+perf+'</div>';
    });
  },
  // The Inventory Intel SKU table, reported unreadable in dark mode and
  // measured at 1.1:1 before the fix. `.cut-table th` painted a white-alpha
  // ink on `background:var(--dark)` — and --dark INVERTS, so in dark mode
  // that is near-white text on a near-white bar. Every .cut-table in the app
  // had it; this is the page it was reported on, and the one that puts the
  // most numbers on screen at once.
  //
  // Verified both ways: restoring `color:rgba(255,255,255,.6)` on
  // `.cut-table th` fails this fragment in dark and names every header cell.
  // The tinted cells below it cover the other half of the same bug — a
  // literal ink (#111, #dc2626) or a literal light chip on a row background
  // that follows the theme.
  'inventory intel — SKU table':()=>{
    const app=loadApp({files:['js/shopify.js']});
    const rows=[
      {sku:'LIP-CG-XS',title:'Live in Pants',color:'Cool Grey',productType:'Live In Pants',
       size:'XS',onHand:58,s7:62,s30:242,daysLeft:0,dailyRate:8.8,sellThrough:0.81,
       reorderPoint:120,suggestedQty:200,season:'winter',garmentType:'bottom'},
      {sku:'LIP-CG-S',title:'Live in Pants',color:'Cool Grey',productType:'Live In Pants',
       size:'S',onHand:0,s7:20,s30:90,daysLeft:0,dailyRate:3,sellThrough:1,
       reorderPoint:60,suggestedQty:90,season:'winter',garmentType:'bottom'},
      {sku:'LIP-CG-M',title:'Live in Pants',color:'Cool Grey',productType:'Live In Pants',
       size:'M',onHand:9,s7:14,s30:60,daysLeft:5,dailyRate:2,sellThrough:0.6,
       reorderPoint:40,suggestedQty:70,season:'winter',garmentType:'bottom'},
      {sku:'CT-MR-M',title:'CORE Tees',color:'Maroon',productType:'Basic Tee',
       size:'M',onHand:367,s7:31,s30:98,daysLeft:44,dailyRate:3.3,sellThrough:0.2,
       reorderPoint:80,suggestedQty:0,season:'summer',garmentType:'top'},
      // A variant Shopify has not reported inventory for. onHand is undefined,
      // so BOTH `every(onHand>0)` and `some(onHand<=0)` are false and the
      // group total takes the third branch — the one that used to be a
      // literal near-black on a row background that follows the theme
      // (measured 1.02:1). It is the only way to reach that branch, which is
      // why a table of ordinary rows does not cover it.
      {sku:'TC-DI-OS',title:'Classic Denim',color:'Iced',productType:'Trucker Cap',
       size:'OS',s7:25,s30:89,daysLeft:5,dailyRate:1.2,season:'all-season'}
    ];
    // Expand the first group so the per-variant child rows are measured too —
    // those carry the sold-out ink and the striped --surface-2 background.
    app.run("_siSkuExpanded.add('Live in Pants|||Cool Grey')");
    const html=app.run('_siSkuTableSection('+JSON.stringify(rows)+')');
    return Promise.resolve('<div class="card">'+html+'</div>');
  },
  // The other shape of the same bug, and the one that hid longest: a label
  // whose ink is a literal white-alpha sitting on a `background:var(--dark)`
  // panel. --dark is the app's "strong contrast chip" and inverts, so these
  // read at ~1.08:1 in dark mode while the value beside them (which already
  // used --on-dark) stayed perfectly legible. Gate Pass has six of them.
  // The bell's cards at each priority. Their message text follows the theme,
  // so a card background that did not would be unreadable in dark mode —
  // which is exactly how they shipped until Sept 2026.
  'hrm — notification cards':()=>{
    const app=loadApp({files:['js/hrm.js'],
      session:{uid:'u9',u:'daniyal',name:'Daniyal Tufail',role:'creator_content_ops_lead'}});
    const n=(id,priority,title,message,actionUrl)=>({_id:id,priority,title,message,actionUrl,createdAt:Date.now()-86400000*3});
    const cards=[
      n('a','normal','Advance approved','PKR 50,000 approved. Will be deducted from your next payroll.'),
      n('b','high','No post yet: @st4rr.doll','Shipped 14 days ago and nothing is posted.','mkt-dispatches'),
      n('c','low','Policy updated','lateGraceMinutes changed from 15 to 14.')
    ].map(x=>app.run('_hrmNotifCardHTML('+JSON.stringify(x)+')')).join('');
    return Promise.resolve('<div style="max-width:360px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px">'+cards+'</div>');
  },
  'gate pass — dark summary panels':()=>{
    const app=loadApp({files:['js/gatepass.js'],currentPage:'gate-pass',
      session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'}});
    const html=app.run('renderOutward()');
    return Promise.resolve(html);
  }
};

const WIDTHS=[1900,1280,420];

const browser=findBrowser();
if(!browser){
  console.log('smoke-layout: no browser found — skipping.');
  console.log('  (set CHROME_BIN to run it)');
  process.exit(0);
}

// The measuring script. Anything with its own text that ends up zero-wide
// or zero-high is invisible to a human no matter what the DOM says.
const PROBE=`
const bad=[];
function textOfOwn(el){
  let t='';
  el.childNodes.forEach(n=>{if(n.nodeType===3)t+=n.textContent;});
  return t.trim();
}
// display:none on an ANCESTOR does not show up in a descendant's own
// computed style — the child keeps whatever display it specified, so every
// collapsible form in this app (the delay-reason textarea, the QC defect
// rows) reported as zero-size invisible text. Walk up instead.
function hiddenEl(el){
  for(let n=el;n&&n.id!=='main-content';n=n.parentElement){
    const s=getComputedStyle(n);
    if(s.display==='none'||s.visibility==='hidden')return true;
  }
  return false;
}
// An <option> is never laid out — Chromium renders a select's list itself,
// so every option in the document reports a 0x0 rect. Reporting them is a
// false positive that would block any fragment containing a dropdown, and
// it says nothing about whether the select is readable. The select ITSELF
// is still measured, which is the part a human sees.
// An ARRAY, not a comma-joined string: 'OPTION,OPTGROUP'.indexOf('P') is 1,
// so a string membership test would silently exempt every <p> in the app.
const UNLAID=['OPTION','OPTGROUP'];
document.querySelectorAll('#main-content *').forEach(el=>{
  const cs=getComputedStyle(el);
  if(hiddenEl(el)||cs.position==='fixed'||UNLAID.indexOf(el.tagName)>-1)return;
  const own=textOfOwn(el);
  if(!own)return;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1){
    bad.push({why:'invisible text',text:own.slice(0,40),
      cls:el.className&&el.className.toString().slice(0,60),
      w:Math.round(r.width),h:Math.round(r.height)});
  }
});
// Text that is laid out but painted NOWHERE: its box falls entirely outside
// the nearest clipping ancestor. This is what "the label sits on top of the
// title" actually was — a flex body with justify-content:center whose
// content was taller than the box spills equally out of BOTH ends, and the
// card's overflow:hidden erases the top one. Zero-size checks miss it
// completely: the element has a perfectly good rect, just not one anybody
// can see. Deliberately requires NO intersection at all, so a long note
// whose last lines are cut off is not a finding.
document.querySelectorAll('#main-content *').forEach(el=>{
  if(!textOfOwn(el))return;
  const cs=getComputedStyle(el);
  if(hiddenEl(el))return;
  let p=el.parentElement,clip=null,clipX=false,clipY=false;
  while(p&&p.id!=='main-content'){
    const pcs=getComputedStyle(p);
    const hx=pcs.overflowX==='hidden',hy=pcs.overflowY==='hidden';
    if(hx||hy){clip=p;clipX=hx;clipY=hy;break;}
    p=p.parentElement;
  }
  if(!clip)return;
  const r=el.getBoundingClientRect(),c=clip.getBoundingClientRect();
  if(r.width<1||r.height<1)return;
  // PER AXIS, and only an axis that is genuinely hidden. An axis that
  // SCROLLS has not hidden anything - it has moved it off-screen, and it
  // comes back when you scroll. Judging both axes against a box that
  // scrolls on one of them reports every horizontally-docked phone rail and
  // every tall scrolling card body as broken; that exact false positive is
  // why the +Row/+Col strip could not be held by a fragment. A box hidden
  // on BOTH axes is unchanged, which is the case the check was written for
  // (a centred flex body spilling out of both ends).
  // NOTE: no backticks in this comment - the PROBE is a template literal.
  const outX=clipX&&(r.right<=c.left||r.left>=c.right);
  const outY=clipY&&(r.bottom<=c.top||r.top>=c.bottom);
  if(outX||outY){
    bad.push({why:'text is clipped completely out of view',
      text:textOfOwn(el).slice(0,40),
      cls:el.className&&el.className.toString().slice(0,50),
      clippedBy:(clip.className||clip.tagName).toString().slice(0,50)});
  }
});
// Text you cannot READ because it is nearly the same colour as what is
// behind it. This is the class of bug the dark-mode sweep was always going
// to leave behind, and CLAUDE.md predicted it: the property-qualified sweep
// converted a plain background:#fff but not one built inside a template
// ternary, where the literal survives in the inactive branch — so toggle
// chips across the app kept a hardcoded white under near-white text.
// Worse in the other direction: --dark and --red INVERT, so an active chip
// painted var(--dark) with a hardcoded color:#fff turns into white on
// light. Both states of the same control, invisible.
//
// The threshold is deliberately LOW (2.2:1). This is not a WCAG audit — a
// stricter bar would flag every piece of muted helper text in the app and
// drown the real finding. 2.2 is "a human cannot read this at all".
function lum(c){
  // NB: PROBE is a template literal, so a lone backslash is eaten before
  // the browser ever sees it — \\d here is what reaches the regex as \d.
  const m=String(c).match(/[\\d.]+/g);
  if(!m||m.length<3)return null;
  if(m.length>3&&parseFloat(m[3])===0)return null;          // fully transparent
  const f=v=>{v=parseFloat(v)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);
}
function bgOf(el){
  let n=el;
  while(n&&n!==document.documentElement){
    const c=getComputedStyle(n).backgroundColor;
    const l=lum(c);
    if(l!==null)return l;
    n=n.parentElement;
  }
  return lum(getComputedStyle(document.body).backgroundColor);
}
document.querySelectorAll('#main-content *').forEach(el=>{
  const own=textOfOwn(el);
  if(!own)return;
  const cs=getComputedStyle(el);
  if(hiddenEl(el))return;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1)return;
  const fg=lum(cs.color),bg=bgOf(el);
  if(fg===null||bg===null)return;
  const ratio=(Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
  if(ratio<2.2){
    bad.push({why:'text is unreadable against its background',
      text:own.slice(0,34),ratio:Math.round(ratio*100)/100,
      color:cs.color,bg:getComputedStyle(el).backgroundColor,
      cls:(el.className||'').toString().slice(0,50)});
  }
});
// The tool rail must never need VERTICAL scrolling. It is navigation
// chrome: a tool you have to discover by scrolling a column is, in
// practice, a tool nobody finds - and the rail was a vertically-scrolling
// pill until Sept 2026, with Trash the entry most likely to fall off a
// short laptop viewport. Scoped to the vertical axis on purpose, so the
// phone dock (which scrolls sideways by design) is naturally exempt.
document.querySelectorAll('#main-content .board-rail').forEach(el=>{
  if(el.scrollHeight>el.clientHeight+2){
    bad.push({why:'the tool rail cannot show all its tools without scrolling',
      scroll:el.scrollHeight,client:el.clientHeight});
  }
});
document.querySelectorAll('#main-content .card, #main-content [class*="-row"], #main-content [class*="-tile"]').forEach(el=>{
  if(el.scrollWidth>el.clientWidth+2){
    bad.push({why:'overflows its own box',
      cls:el.className&&el.className.toString().slice(0,60),
      scroll:el.scrollWidth,client:el.clientWidth});
  }
});
if(document.documentElement.scrollWidth>innerWidth+2){
  bad.push({why:'the page scrolls sideways',
    scroll:document.documentElement.scrollWidth,viewport:innerWidth});
}
// A control that exists but cannot be clicked. This is the shape of nearly
// every UI bug this app has had: the board's whole top bar behind a wrong
// z-index, the delete X retargeted by a pointer capture, the profile photo
// with no handler at all. Hit-test the centre of everything clickable and
// make sure the browser would actually reach it.
document.querySelectorAll('#main-content button, #main-content [onclick], #main-content a[href]').forEach(el=>{
  const cs=getComputedStyle(el);
  if(hiddenEl(el))return;
  if(el.disabled)return;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1){
    bad.push({why:'clickable but has no size',
      text:(el.textContent||'').trim().slice(0,30),
      cls:(el.className||'').toString().slice(0,50)});
    return;
  }
  if(cs.pointerEvents==='none'){
    bad.push({why:'clickable but pointer-events:none',
      text:(el.textContent||'').trim().slice(0,30)});
    return;
  }
  // Off-screen at this width is a layout question, already covered above.
  if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return;
  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  // The click reaches the control if the hit IS the control, or a
  // descendant of it (it still bubbles). Anything else means something is
  // painted on top — INCLUDING an ancestor, which is how an ::after
  // overlay or a mispositioned z-index swallows its own children. An
  // earlier version of this check exempted ancestors and therefore caught
  // nothing; it was verified by deliberately covering a button.
  if(hit&&hit!==el&&!el.contains(hit)){
    bad.push({why:'something else is covering this control',
      text:(el.textContent||'').trim().slice(0,30),
      coveredBy:(hit.tagName+'.'+(hit.className||'')).slice(0,50)});
  }
});
document.getElementById('__out').textContent=JSON.stringify(bad);
`;

(async function main(){
  const cases=[];
  for(const [name,build] of Object.entries(FRAGMENTS)){
    cases.push({name,html:await build()});
  }

  const server=http.createServer((req,res)=>{
    const url=decodeURIComponent(req.url.split('?')[0]);
    const m=/^\/__frag\/(\d+)$/.exec(url);
    if(m){
      const c=cases[Number(m[1])];
      res.writeHead(200,{'Content-Type':'text/html'});
      return res.end(`<!doctype html><html><head>
<script>document.documentElement.setAttribute('data-theme',new URL(location).searchParams.get('t')||'light');<\/script>
<link rel="stylesheet" href="/css/main.css"></head><body>
<div id="main-content" style="padding:18px 16px">${c.html}</div>
<pre id="__out">running</pre>
<script>${PROBE}<\/script></body></html>`);
    }
    const file=path.join(ROOT,url.replace(/^\/+/,''));
    if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){
      res.writeHead(404);return res.end('not found');
    }
    res.writeHead(200,{'Content-Type':url.endsWith('.css')?'text/css':'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
  });

  const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'groovy-layout-'));
  let failures=0,checks=0,pending=0;

  // Launched asynchronously on purpose: this process is also the web server,
  // and a synchronous spawn deadlocks the loop that has to answer the
  // browser's requests — see the same note in tests/smoke-browser.js.
  server.listen(0,'127.0.0.1',()=>{
    const port=server.address().port;
    console.log('smoke-layout: '+path.basename(browser)+', '+cases.length+
      ' fragment(s) × '+WIDTHS.length+' widths × 2 themes\n');
    const jobs=[];
    cases.forEach((c,i)=>WIDTHS.forEach(w=>['light','dark'].forEach(t=>jobs.push({c,i,w,t}))));
    pending=jobs.length;
    // A bounded pool, not all at once: with 14 fragments that is 84 Chromes,
    // and on a developer's Windows machine most of them blew the 120s
    // timeout and reported "the probe never ran" — a failure of the runner,
    // not of any layout. SMOKE_LAYOUT_CONCURRENCY overrides the default.
    const LIMIT=Math.max(1,Number(process.env.SMOKE_LAYOUT_CONCURRENCY)||Math.min(8,Math.max(2,os.cpus().length)));
    let next=0;
    const launch=()=>{
      if(next>=jobs.length)return;
      const j=jobs[next++];
      execFile(browser,['--headless=new','--no-sandbox','--disable-gpu',
        '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
        '--disable-background-networking','--disable-component-update','--disable-sync',
        '--disable-default-apps','--disable-extensions','--metrics-recording-only',
        '--mute-audio','--no-proxy-server',
        '--window-size='+j.w+',1000',
        '--user-data-dir='+profileDir+'-'+j.i+'-'+j.w+'-'+j.t,
        '--virtual-time-budget=8000','--dump-dom',
        'http://127.0.0.1:'+port+'/__frag/'+j.i+'?t='+j.t],
        {encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000},
        (err,stdout)=>{
          const label=j.c.name+' @ '+j.w+'px '+j.t;
          checks++;
          const m=/<pre id="__out">([\s\S]*?)<\/pre>/.exec(stdout||'');
          if(!m||m[1].trim()==='running'){
            failures++;
            console.log('  FAIL '+label+' — the probe never ran'+(err?' ('+err.message+')':''));
          }else{
            let bad=[];
            try{bad=JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&')
                                   .replace(/&lt;/g,'<').replace(/&gt;/g,'>'));}catch(e){}
            if(bad.length){
              failures++;
              console.log('  FAIL '+label);
              bad.slice(0,6).forEach(b=>console.log('       '+JSON.stringify(b)));
            }else{
              console.log('  OK   '+label);
            }
          }
          if(--pending===0)finish();else launch();
        });
    };
    for(let k=0;k<Math.min(LIMIT,jobs.length);k++)launch();
  });

  function finish(){
    server.close();
    try{WIDTHS.forEach(w=>cases.forEach((c,i)=>['light','dark'].forEach(t=>
      fs.rmSync(profileDir+'-'+i+'-'+w+'-'+t,{recursive:true,force:true}))));}catch(e){}
    console.log('');
    if(failures){
      console.log('\x1b[31m'+failures+' of '+checks+' layout checks failed\x1b[0m');
      process.exit(1);
    }
    console.log('\x1b[32mall '+checks+' layout checks passed\x1b[0m');
  }
})().catch(e=>{console.error('smoke-layout: '+(e&&e.stack||e));process.exit(1);});

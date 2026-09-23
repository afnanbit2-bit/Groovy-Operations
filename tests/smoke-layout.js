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


// Store Accounts fixture: a small, realistic ledger — an overdue credit
// vendor, a cash-terms walk-in, a consumable (gas) vendor, an aged runner
// float, a void row, a pending cash-in and a review flag.
function _acctFixture(){
  const LS={getItem:()=>null,setItem(){},removeItem(){}};
  const pad=n=>String(n).padStart(2,'0');
  const day=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
  let seq=0;
  const E=(type,o)=>Object.assign({_id:'e'+(++seq),type,date:day(0),month:day(0).slice(0,7),ts:1000+seq,by:'raees',byName:'Raees',vendorId:null,vendorName:'',person:'',account:null,toAccount:null,source:null,floatId:null,amount:0,lines:[],category:'',ref:'',note:'',photo:null,status:'posted',needsReview:false,reviewFlags:[]},o||{});
  const V=(id,o)=>Object.assign({_id:id,name:id,kind:'goods',terms:{mode:'credit',creditDays:30,creditLimit:0,billDay:0,expectedAmount:0},meter:null,contact:{person:'',phone:'',address:''},supplies:[],notes:'',active:true,openingBalance:0},o||{});
  const app=loadApp({files:['js/store.js','js/store-accounts.js'],currentPage:'acct-ledger',globals:{
    allItems:[{code:'TH1',name:'Thread white 40/2',unit:'cone',balance:20,sizeSpecific:false,_id:'TH1'}],allTransactions:[],allTemplates:[],allRequests:[],allActivePOs:[],
    allStoreCategories:[],allPoIssueRequests:[],allPoEditRequests:[],allPoShortfalls:[],
    auth:{currentUser:{getIdToken:async()=>'tok'}},localStorage:LS,
    _ilPage:1,_ilQ:'',_ilPO:'',_ilDir:'',IL_PER:15,IL_MAX_PAGES:1000,_invFilterCat:'all',_invSearchQ:'',_invSort:'category'}});
  const entries=[
    E('cash_in',{account:'cash',amount:40000,date:day(40),via:'cash',person:'Afnan'}),
    E('cash_in',{account:'mcb',amount:150000,date:day(40),via:'mcb',person:'Ammar',ref:'TRX-88121'}),
    E('purchase',{source:'credit',amount:18000,vendorId:'thread',vendorName:'Karachi Thread House',date:day(38),ref:'INV-2291',category:'Store purchase',lines:[{itemCode:'TH1',desc:'Thread white 40/2',qty:60,unit:'cone',rate:210,total:12600},{itemCode:'TH2',desc:'Thread black 40/2',qty:24,unit:'cone',rate:225,total:5400}],photo:'https://res.cloudinary.com/x/y.jpg',stockPosted:true}),
    E('payment',{account:'mcb',amount:13000,vendorId:'thread',vendorName:'Karachi Thread House',date:day(20),ref:'TRX-88400',photo:'https://res.cloudinary.com/x/z.jpg'}),
    E('purchase',{source:'cash',account:'cash',amount:1450,vendorId:'walk',vendorName:'Walk-in / direct',date:day(6),category:'Maintenance & repairs',lines:[{itemCode:'',desc:'Plumber — washroom tap',qty:1,unit:'',rate:1450,total:1450}]}),
    E('float_out',{_id:'flt1',account:'cash',amount:5000,person:'Noman',date:day(9),note:'packing + thread run'}),
    E('purchase',{source:'float',floatId:'flt1',person:'Noman',amount:3200,vendorId:'walk',vendorName:'Walk-in / direct',date:day(8),category:'Store purchase',lines:[{itemCode:'',desc:'Packing tape ×24',qty:24,unit:'roll',rate:133.33,total:3200}]}),
    E('purchase',{source:'cash',account:'cash',amount:800,vendorId:'walk',vendorName:'Walk-in / direct',date:day(5),status:'void',voidReason:'entered twice',voidedBy:'raees',lines:[{itemCode:'',desc:'Tea & biscuits',qty:1,unit:'',rate:800,total:800}]}),
    E('transfer',{account:'mcb',toAccount:'cash',amount:20000,date:day(3),note:'ATM withdrawal for the drawer'}),
    E('purchase',{source:'cash',account:'cash',amount:12500,vendorId:'walk',vendorName:'Walk-in / direct',date:day(2),category:'Maintenance & repairs',needsReview:true,reviewFlags:['over limit','no receipt'],lines:[{itemCode:'',desc:'Generator service',qty:1,unit:'',rate:12500,total:12500}]}),
    E('cash_in',{account:'cash',amount:10000,status:'pending',date:day(1),via:'cash',person:'Afnan',by:'afnan',byName:'Afnan'})
  ];
  const vendors=[
    V('thread',{name:'Karachi Thread House',contact:{person:'Bilal',phone:'0300-1234567',address:'Shershah, Karachi'},supplies:['Thread','Elastic'],terms:{mode:'credit',creditDays:30,creditLimit:50000,billDay:0,expectedAmount:0}}),
    V('walk',{name:'Walk-in / direct',terms:{mode:'cash',creditDays:0,creditLimit:0,billDay:0,expectedAmount:0}}),
    V('net',{name:'Nayatel',kind:'utility',terms:{mode:'weekly',creditDays:0,creditLimit:0,billDay:0,billWeekdays:[3,6],expectedAmount:2500},contact:{person:'',phone:'',address:''}}),
    V('gas',{name:'Pak Gas Agency',kind:'consumable',terms:{mode:'monthly',creditDays:0,creditLimit:0,billDay:5,expectedAmount:30000},meter:{type:'weighed',unit:'kg',rate:300,label:'Gas'},contact:{person:'',phone:'021-1234567',address:''}})
  ];
  const seed=a=>a.run(`acctEntries=${JSON.stringify(entries)};acctVendors=${JSON.stringify(vendors)};acctCloses=[];acctSettings={approvalLimit:10000,receiptRequiredAbove:2000,floatWarnDays:3,floatRedDays:7,categories:ACCT_DEFAULTS.categories,runners:['Noman']};_acctLoaded=true;_storeLoadAttempted=true;_acctSort(acctEntries);1`);
  return {app,seed};
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
      {id:'u4',kind:'file',fileName:'a.pdf'},
      {id:'u5',kind:'cards',name:'FABRIC & TRIMS FOR WINTER · 12 cards',
        cards:[{id:'c1',type:'column',title:'FABRIC & TRIMS FOR WINTER'}]},
      {id:'u6',kind:'cards',name:'Table',cards:[{id:'c2',type:'table'}]}
    ]`);
    let html=app.run('_boardsTrayHTML(true)');
    app.run('_boardsTrayHydrate()');
    // Same reason as above: hydration goes into the harness's stub nodes, so
    // the labels are written in here for the measurement.
    ['A note with a fairly long first line that has to wrap somewhere',
     'winter-sequence-2026-techpack-final-v3.pdf','example.test','a.pdf',
     'FABRIC & TRIMS FOR WINTER · 12 cards','Table'].forEach((t,i)=>{
      html=html.replace(new RegExp('(id="board-tray-l-'+i+'"[^>]*>)'),'$1'+t);
    });
    // The tray is position:absolute against the canvas wrap; give it one.
    return Promise.resolve(
      '<div style="position:relative;height:600px;width:100%">'+html+'</div>');
  },
  /* ── THE UNSORTED PEEK ZONE ──────────────────────────────────────────
     Built by _boardsStashZone only while a card is being dragged and the
     tray is shut, so the probe cannot reach it through the module — it is
     composed here from the same markup that function writes. Worth
     measuring because its whole job is to be READ mid-gesture: the idle
     label is --muted on --surface and the armed one is --text on --hover,
     and both have to hold in either theme. */
  /* The drag ghost. It is built with createElement at drag time, so no
     fragment can render the REAL builder — what is measured here is the
     CSS, and the class names are pinned on the other side by
     tests/boards.test.js, which asserts the builder emits exactly these.
     That is the same division the trash ramp uses: the colours are this
     probe's, the mechanism is the suite's.

     The picture is a solid WHITE stand-in, so ink that stops reading over
     a light photograph shows up rather than hiding behind a dark sample.
     Each ghost is given its own left/top because the real thing is
     position:fixed and they would otherwise stack at 0,0 and report each
     other as covering — the documented false hit. */
  /* The RAIL's drag ghost — the card each placing tool will drop, at the
     board's zoom. Drawn at zoom 1 with the real birth sizes, so what is
     measured is the footprint a drop really lands. Same division as the
     tray ghost: the CSS is this probe's, the class names and the sizes are
     pinned in tests/boards.test.js against _boardsNewCardSize.

     Each is position:fixed with its own left/top, because that is what the
     real one is and they would otherwise stack at 0,0 and report each
     other as covering — the documented false hit. */
  /* The selection rail with its counts. The button is built inside
     _boardsRenderRail's own map, so this renders the real rail through the
     real module rather than a hand-written copy — which also makes it the
     only place that can check a ZERO paints no badge at all.

     The badge chip is var(--red) with var(--on-dark) ink: both invert
     together, which is the documented correct pair, and this fragment is
     what proves it rather than the arithmetic. */
  'boards — the selection rail counts':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      moodBoards=[{id:'b1',ownerUid:'u1',visibility:'shared',title:'T',cards:[]}];
      _editConnectors=[];_boardsConnSel=null;_boardsDrawOn=null;
      _boardsComments=[{id:'m1',cardId:'a'},{id:'m2',cardId:'a'},{id:'m3',cardId:'a',resolved:true}];
      _editCards=[{id:'a',type:'text',x:0,y:0,w:220,h:100,
         labels:[{t:'See this',c:'green'},{t:'Fabric',c:'blue'}],
         reactions:{'👍':['u1','u2'],'🔥':['u3']}},
        {id:'z',type:'text',x:300,y:0,w:220,h:100}];`);
    const rail=who=>{
      app.run(`_boardsSelection=new Set(['${who}'])`);
      const items=JSON.parse(app.run(`JSON.stringify(_boardsRailItems().filter(i=>i&&i.act))`));
      return items.map(it=>
        '<button class="rail-btn" data-act="'+it.act+'" title="'+it.label+'">'+
        '<span class="rail-glyph">•</span><span>'+it.label+'</span>'+
        (it.count?'<span class="board-rail-badge">'+(it.count>99?'99+':it.count)+'</span>':'')+
        '</button>').join('');
    };
    return Promise.resolve({widths:[1900,1280],html:
      '<div style="display:flex;gap:24px;align-items:flex-start">'+
      '<div class="board-rail" style="position:relative">'+rail('a')+'</div>'+
      '<div class="board-rail" style="position:relative">'+rail('z')+'</div>'+
      '</div>'});
  },
  'boards — the rail drag ghost':()=>{
    const G=(x,y,w,h,type,inner)=>
      '<div class="board-rail-ghost card type-'+type+'" style="left:'+x+'px;top:'+y+'px;'+
        'width:'+w+'px;height:'+h+'px;font-size:15px">'+
        '<div class="ghost-in">'+inner+'</div></div>';
    const head=(name)=>'<div class="ghost-head"><div class="ghost-name">'+name+'</div>'+
      '<div class="ghost-sub">0 cards</div></div>';
    let cells='';for(let i=0;i<12;i++)cells+='<div class="ghost-cell"></div>';
    return Promise.resolve(
      '<div style="position:relative;height:640px">'+
      G(30,40,220,100,'text','<div class="ghost-ph">Double-click to type…</div>')+
      G(280,40,170,120,'link','<div class="ghost-field">Enter a link URL</div>')+
      G(480,40,240,170,'todo',
        '<div class="ghost-row"><div class="ghost-check"></div>'+
        '<div class="ghost-item">To-do</div></div>'+
        '<div class="ghost-ph">Add a task…</div>')+
      G(760,40,340,136,'board','<div class="ghost-spine"></div>'+
        '<div class="ghost-info"><div class="ghost-name">New board</div>'+
        '<div class="ghost-sub">PRIVATE</div></div>')+
      G(30,240,440,58,'heading','<div class="ghost-band">Section title</div>')+
      G(500,240,280,160,'column',head('New Column')+
        '<div class="ghost-panel">Drag cards here</div>')+
      G(810,240,360,200,'table','<div class="ghost-grid">'+cells+'</div>')+
      G(30,330,440,320,'frame',head('New Frame')+'<div class="ghost-panel"></div>')+
      '</div>');
  },
  'boards — the drag ghost':()=>{
    const WHITE="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%23fff'/%3E%3C/svg%3E";
    const ghost=(x,y,inner,label)=>
      '<div class="board-tray-ghost" style="left:'+x+'px;top:'+y+'px">'+
        '<div class="board-tray-ghost-pic">'+inner+'</div>'+
        '<div class="board-tray-ghost-label">'+label+'</div>'+
      '</div>';
    const badge=w=>'<div class="board-tray-ghost-badge">'+w+'</div>';
    return Promise.resolve(
      '<div style="position:relative;height:420px">'+
      // A photograph, with the name under it.
      ghost(90,110,'<img src="'+WHITE+'" alt="">','Model REF 1')+
      // No picture: the word carries it, on the default --soft box.
      ghost(260,110,badge('COLUMN'),'FABRIC &amp; TRIMS FOR WINTER')+
      ghost(430,110,badge('PDF'),'winter-sequence-2026-techpack-final-v3.pdf')+
      // A board with no cover paints its own literal colour, with the ink
      // _boardsInkOn computes — light and dark case, both measured.
      ghost(600,110,'<div class="board-tray-ghost-badge" style="background:#1A1A2E;color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center">W</div>','WINTER DUMP 2K27')+
      ghost(770,110,'<div class="board-tray-ghost-badge" style="background:#F2E8C9;color:#111;width:100%;height:100%;display:flex;align-items:center;justify-content:center">D</div>','DENIM DUMP 2K27')+
      '</div>');
  },
  'boards — the Unsorted peek zone':()=>{
    const zone=on=>'<div style="position:relative;height:170px;width:100%;'+
      'background:var(--bg);border:1px solid var(--border);margin-bottom:10px">'+
      '<div class="board-stash-zone'+(on?' panel-drop':'')+'">'+
      '<span class="board-stash-zone-label">Unsorted</span></div></div>';
    return Promise.resolve(zone(false)+zone(true));
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
  // Store Accounts (js/store-accounts.js): the KPI tiles, the alert strip,
  // the ledger toolbar and the books table with a running balance, the
  // vendor profile, the consumables grid and the purchase form. The table
  // is allowed to scroll sideways inside its own wrapper on a phone (the
  // Marketing rule), so the table fragments opt out of 420px, where the
  // probe would read a row scrolled out of the wrapper as covered; the
  // tiles and the form are measured at every width.
  'store accounts — ledger, vendor, consumables':()=>{
    const {app,seed}=_acctFixture();
    seed(app);
    app.run("currentPage='acct-ledger';_acctView='cash';_acctPeriod={preset:'all'}");
    const ledger=app.run("_acctPageHead('acct-ledger')+_acctLedgerPage()");
    app.run("_acctVendorId='thread';_acctVendorTab='aging';currentPage='acct-vendor'");
    const vendor=app.run("_acctVendorPage()");
    const m=app.run('_acctThisMonth()');
    const logs=[{date:m+'-01',qty:45,residual:5,byName:'Raees'},{date:m+'-02',qty:45,residual:7,byName:'Raees',note:'late delivery'}];
    const cons=app.run(`(()=>{const v=_acctVendor('gas');return '<div class="card" style="padding:0;overflow:hidden">'+_acctConsGrid(v,'${m}',${JSON.stringify(logs)})+_acctConsFoot(v,'${m}',${JSON.stringify(logs)})+'</div>';})()`);
    return Promise.resolve({widths:[1900,1280],html:ledger+vendor+cons});
  },
  'store accounts — tiles, alerts and the purchase form':()=>{
    const {app,seed}=_acctFixture();
    seed(app);
    app.run("currentPage='acct-ledger';_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    const tiles=app.run("_acctPageHead('acct-ledger')+(()=>{const b=_acctBalances();const f=_acctOpenFloats();return '<div class=\"acct-tiles\">'+_acctTile('Cash in hand',b.cash)+_acctTile('MCB Bank',b.mcb)+_acctTile('Owed to vendors',_acctTotalPayables(),{danger:true,sub:'₨5,000 overdue'})+_acctTile('With runners',f.reduce((s,x)=>s+x.left,0),{danger:true,sub:'1 open float'})+'</div>'+_acctAlerts(f);})()");
    app.run("window.acctForm('purchase',{vendorId:'thread'})");
    app.run("_acctFormLines=[{itemCode:'TH1',desc:'Thread white 40/2',qty:'12',unit:'cone',rate:'210',hint:'Last bought @ ₨210 on 01 Sep 26 from Karachi Thread House · in stock now: 20 cone'},{itemCode:'',desc:'Rickshaw to Shershah',qty:'1',unit:'',rate:'300',hint:''},_acctNewLine()]");
    const body=app.run('window.__cap.b');
    // The REAL row (`_acctLineHTML`), placeholders included — a hand-rolled copy
    // here once measured a shorter placeholder than the one that shipped.
    const lines=app.run("_acctFormLines.map((l,i)=>_acctLineHTML(l,i)).join('')");
    const modal=(b)=>'<div class="acct-modal" style="position:static;max-width:720px;margin-top:14px"><div class="acct-modal-head"><span>Record purchase</span><button class="acct-x">×</button></div><div class="acct-modal-body">'+b+'</div><div class="acct-modal-foot"><button class="btn-outline">Cancel</button><button class="btn-primary" style="width:auto;margin:0;padding:10px 18px">Record purchase</button></div></div>';
    // the same form opened for a service vendor: Expense mode, the stock block hidden
    app.run("window.acctForm('purchase',{vendorId:'net'})");
    const expBody=app.run('window.__cap.b');
    const form=modal(body.replace('<div id="acct-lines"></div>','<div id="acct-lines">'+lines+'</div>'))+modal(expBody);
    return Promise.resolve(tiles+form);
  },
  // Afnan's correction tools: the Admin tools card on the review page (the
  // whole page, which had never been measured), the admin edit modal and
  // the reset modal. The fixture's session is made afnan by name — the card
  // and the buttons are gated on the username, not the owner role.
  'store accounts — admin tools, edit and reset':()=>{
    const {app,seed}=_acctFixture();
    seed(app);
    app.run("session.u='afnan';session.role='owner';currentPage='acct-review';acctCloses=[{_id:'2026-08',month:'2026-08',cashBook:12000,cashCounted:12000,variance:0,closedByName:'Afnan'}];_acctModal=function(t,b,f){window.__cap={t,b,f};}");
    const review=app.run("_acctReviewPage()");
    const modal=(t,b,f)=>'<div class="acct-modal" style="position:static;max-width:640px;margin-top:14px"><div class="acct-modal-head"><span>'+t+'</span><button class="acct-x">×</button></div><div class="acct-modal-body">'+b+'</div><div class="acct-modal-foot">'+f+'</div></div>';
    app.run("window.acctAdminEdit(acctEntries.find(e=>e.type==='purchase')._id)");
    const edit=app.run("modal=window.__cap;JSON.stringify(modal)");
    app.run("window.acctAdminResetPrompt()");
    const reset=app.run("JSON.stringify(window.__cap)");
    const e=JSON.parse(edit),r=JSON.parse(reset);
    return Promise.resolve(review+modal(e.t,e.b,e.f)+modal(r.t,r.b,r.f));
  },
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
  /* A FRAME wears the column's title block now, so it is measured beside
     it rather than trusted to inherit it: same head, same count, same
     corner buttons. Its count is GEOMETRY (the cards whose centres fall
     inside) and its region stays see-through, which is the one place the
     two deliberately differ.
     ITS OWN FRAGMENT, not more rows on the column one: the probe SKIPS
     hit-testing anything below the window, so a 1500px stack quietly stops
     being checked at all — found by breaking the frame body to cover its
     own header and watching the probe pass. */
  'boards — frames wear the column title block':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];moodBoards=[];
      _editCards=[
        {id:'fr',type:'frame',title:'Winter Drop 2027 — cut and sew',x:20,y:20,w:380,h:230},
        {id:'fk',type:'text',text:'Lab dip approved',x:40,y:130,w:170,h:80},
        {id:'frempty',type:'frame',title:'',x:20,y:280,w:380,h:190},
        {id:'frfold',type:'frame',title:'Archived section',x:20,y:500,w:380,h:190,collapsed:true,openH:190},
        {id:'hid',type:'text',text:'hidden by the fold',x:40,y:590,w:170,h:80}
      ];
      _boardsSelection=new Set(['fr']);`);
    let html=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    html=html.replace(/(id="board-txt-fk"[^>]*>)/,'$1Lab dip approved');
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:720px;width:100%">'+html+'</div>');
  },
  'boards — a column and its cards':()=>{
    const app=loadApp({files:['js/boards.js']});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set();moodBoards=[];
      _editCards=[
        {id:'col',type:'column',title:'Winter fabric',x:20,y:20,w:260,h:160},
        {id:'a',type:'text',text:'Cotton drill 8.5oz',x:0,y:0,w:170,h:90,columnId:'col'},
        {id:'b',type:'file',fileName:'swatch-card.pdf',fileSize:20480,
         fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/s.pdf',x:0,y:0,w:170,h:130,columnId:'col'},
        // The header Afnan drew: the name centred with the count under it
        // and a collapse minus in the corner. An EMPTY column is the one
        // that matters here — it is the drop target, and its whole body is
        // the "Drag cards here" panel, so a title block that overran it
        // would cover the thing you are aiming at. One selected (the ✕
        // shows beside the minus only then, or on hover), one collapsed to
        // its header, one with a name long enough to need the room.
        // ONE COLUMN of columns, and that is not cosmetic: a 280px column
        // at x=300 sits past the right edge of the 420px viewport, where
        // the wrapper clips it and the hit-test then reports its own
        // buttons as unreachable — the fragment measuring itself. Same
        // reason the board-card fragment stacked.
        {id:'empty',type:'column',title:'',x:20,y:360,w:280,h:150},
        {id:'sel',type:'column',title:'Lowkey Heat drop — sampling',x:20,y:530,w:280,h:150},
        {id:'fold',type:'column',title:'Archived',x:20,y:700,w:280,h:150,collapsed:true},
        {id:'f1',type:'text',text:'hidden by the fold',x:0,y:0,w:256,h:90,columnId:'fold'}
      ];
      _boardsSelection=new Set(['sel']);
      _boardsLayoutColumns();`);
    let html=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    html=html.replace(/(id="board-txt-a"[^>]*>)/,'$1Cotton drill 8.5oz');
    // A second copy of the EMPTY column with the drop highlight forced on.
    // The probe cannot drag, and that highlight is the only feedback a
    // person gets while aiming a card at a column, so it would otherwise
    // never be measured. Only the empty one, re-homed to the top-left: a
    // copy of the whole set needs a wrapper as tall as the first, and a
    // column hanging past a clipping wrapper reports its own controls as
    // covered — the fragment measuring itself rather than the layout.
    const empty=/(<div class="board-column[^]*?)(?=<div class="board-column|$)/;
    const one=(html.match(/<div class="board-column"[^>]*id="board-card-empty"[^]*?<\/div>\s*(?=<div class="board-card-el|<div class="board-column|$)/)||[''])[0];
    const lit=one.replace('class="board-column"','class="board-column drop-into"')
                 .replace(/id="board-card-empty"/,'id="board-card-lit"')
                 .replace(/left:\d+px;top:\d+px/,'left:20px;top:20px');
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:800px;width:100%">'+html+'</div>'+
      '<div style="position:relative;overflow:hidden;height:200px;width:100%">'+lit+'</div>');
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
  // Level of detail. The same three cards rendered twice - once at NEAR and
  // once at FAR - so the probe measures what each zoom actually paints.
  // What this holds: the far board must still be free of clipped text and
  // unreachable controls once the chrome is hidden, which is the risk in
  // hiding a flex sibling (the body grows into its space).
  /* A board card is a SPINE now (option D): the board's face down the left
     edge, the whole name and meta on the CARD SURFACE beside it, and a strip
     of the board's own thumbnails at the foot. Three things this has to
     hold, and none of them is visible to a logic suite:

     - the name and meta take their ink from tokens now (they used to sit on
       a literal black scrim), so the contrast check has to see them in BOTH
       themes — a literal white left behind would be white-on-white in light;
     - the long-name card wraps to the clamped two lines rather than
       overflowing. Note what this does NOT prove, checked by removing it:
       the info column's min-width:0. The title carries word-break, so it
       shrinks either way — that rule is a guard for whatever is added to
       the column next, not something a measurement here can hold;
     - the thumbnail strip and the phone Open pill share the foot of the
       card, and the pill is hit-tested.

     The covers are swapped for a solid WHITE image: the probe has no
     network, and an <img> that never loads measures as nothing. */
  'boards — a board card wears the board’s face':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    const COVER='https://res.cloudinary.com/deww4lpym/image/upload/v1/cover.jpg';
    app.run(`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
      moodBoards=[
        {id:'B1',title:'WINTER DUMP 2K27',ownerUid:'u1',visibility:'personal',coverUrl:'${COVER}',
         color:'#C2410C',icon:'W',cards:[{id:'a',type:'image',imageUrl:'${COVER}'},{id:'b',type:'file',fileUrl:'x'}]},
        {id:'B2',title:'A board with a deliberately long name that has to wrap',ownerUid:'u1',
         visibility:'shared',color:'#35507A',icon:'L',cards:[{id:'c'}]},
        {id:'B3',title:'Untitled board',ownerUid:'u1',visibility:'personal',cards:[]},
        {id:'B4',title:'Old card, never resized',ownerUid:'u1',visibility:'personal',color:'#14532D',cards:[{id:'d'}]}
      ];
      _editCards=[
        // ONE COLUMN, and that is not cosmetic. A card laid out past the
        // right edge is CLIPPED, and the hit-test then reports its own
        // controls as covered by whatever the probe finds at that point —
        // a false failure of the fragment, not of the layout. The narrowest
        // width checked is 420px, i.e. 388px of content, so every card has
        // to fit inside that. It cost two rows when a board card was 260
        // wide; at 340 it costs a column.
        // The birth size: a wide rectangle, 340x136.
        {id:'k1',type:'board',boardId:'B1',x:10,y:10,w:340,h:136},
        {id:'k2',type:'board',boardId:'B2',x:10,y:200,w:340,h:136},
        {id:'k3',type:'board',boardId:'B3',x:10,y:390,w:340,h:136},
        // The sizes board cards were written at before the redesign and
        // before the rectangle — not migrated, so the render has to grow
        // them rather than clip them.
        {id:'k4',type:'board',boardId:'B4',x:10,y:580,w:200,h:124},
        {id:'k7',type:'board',boardId:'B2',x:10,y:770,w:260,h:172},
        // A board this viewer cannot read, and an orphan with no boardId.
        {id:'k5',type:'board',boardId:'GONE',x:10,y:990,w:340,h:136},
        {id:'k6',type:'board',boardId:'',x:10,y:1180,w:340,h:136}
      ];`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      // A solid WHITE stand-in for every picture: the probe has no network,
      // and an <img> that never loads measures as nothing at all.
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"');
    // The hover line is opacity:0 until :hover, and the probe cannot hover —
    // so a second copy is rendered with it forced visible. Without this the
    // most legible thing on the card (white on a dark wash over an unknown
    // photograph) would never be measured at all.
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:1350px;width:100%">'+
        '<div class="board-world" data-lod="near">'+cards+'</div></div>'+
      '<div style="position:relative;overflow:hidden;height:1350px;width:100%;margin-top:12px">'+
        '<div class="board-world" data-lod="near" id="hovered">'+cards+'</div></div>'+
      '<style>#hovered .board-subboard-cta{opacity:1}</style>');
  },
  /* The "Preparing to download…" cover. It carries text on a literal dark
     wash, so the contrast check applies; and because it is
     pointer-events:none, every control under it must still be reachable —
     which is the hit-test's whole job, and the reason the cover explains
     rather than blocks. */
  'boards — preparing to download':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();moodBoards=[];
      _editCards=[
        {id:'f1',type:'file',fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/brief.pdf',
         fileName:'brief.pdf',name:'ARTICLE #1',x:10,y:10,w:240,h:220},
        {id:'i1',type:'image',name:'BACK VIEW',
         imageUrl:'https://res.cloudinary.com/x/image/upload/v1/back.jpg',x:280,y:10,w:240,h:220}
      ];`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    // The cover is built by _boardsBusyStart with createElement, which the
    // node harness stubs out — so it is built here the way the browser
    // really builds it, on the card that is downloading.
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:270px;width:100%">'+
        '<div class="board-world" data-lod="near">'+cards+'</div></div>'+
      '<script>' +
      '(function(){var el=document.getElementById("board-card-f1");if(!el)return;' +
      'var o=document.createElement("div");o.className="board-card-busy";' +
      'var t=document.createElement("div");t.className="board-card-busy-text";' +
      't.textContent="Preparing to download… 42%";o.appendChild(t);el.appendChild(o);})();' +
      '<\/script>');
  },
  'boards — cards at far zoom (level of detail)':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();moodBoards=[];
      _editCards=[
        {id:'n',type:'text',text:'Winter fleece weights',name:'Fleece',x:10,y:10,w:220,h:150,
         labels:[{t:'REF',c:'blue'}],reactions:{'👍':['u2']}},
        {id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',
         name:'Hoodie',caption:'Front',x:250,y:10,w:220,h:200},
        {id:'l',type:'link',linkUrl:'https://example.test',linkTitle:'example.test',
         linkDesc:'A reference',linkSite:'example.test',
         linkImage:'https://res.cloudinary.com/x/image/upload/v1/hero.jpg',x:490,y:10,w:220,h:200},
        {id:'sb',type:'board',boardId:'CH',boardTitle:'WINTER 2K27',name:'WINTER 2K27',
         color:'green',x:730,y:10,w:200,h:130}
      ];
      moodBoards=[{id:'CH',title:'Untitled board',cards:[{id:'z'}],visibility:'personal',ownerUid:'u1'}];`)
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`);
    // Link cards hydrate their text with textContent, so an un-hydrated one
    // leaves an EMPTY <a> — which is a real 0x0 box and reports as an
    // unclickable control. That is the fragment measuring itself, not the
    // app, so fill them the way the canvas does. Both worlds share the ids,
    // so this fills the near one; the far one is display:none there anyway.
    const linkFill=app.run(`JSON.stringify(_editCards.filter(c=>c.type==='link')
      .map(c=>({id:c.id,t:c.linkTitle||'',u:c.linkUrl||'',d:c.linkDesc||''})))`);
    // Two worlds side by side, each stamped the way _boardsApplyTransform
    // stamps the real one. No transform: the probe measures layout, and a
    // scale() would shrink everything below its own size thresholds.
    return Promise.resolve(
      '<div style="position:relative;overflow:hidden;height:300px;width:100%">'+
        '<div class="board-world" data-lod="near">'+cards+'</div></div>'+
      '<div style="position:relative;overflow:hidden;height:300px;width:100%;margin-top:12px">'+
        '<div class="board-world" data-lod="far">'+cards+'</div></div>'+
      '<script>' +
      'JSON.parse(' + JSON.stringify(linkFill) + ').forEach(function(c){' +
      'document.querySelectorAll("#board-linkt-"+c.id).forEach(function(e){e.textContent=c.t;});' +
      'document.querySelectorAll("#board-linku-"+c.id).forEach(function(e){e.textContent=c.u;});' +
      'document.querySelectorAll("#board-linkd-"+c.id).forEach(function(e){e.textContent=c.d;});});' +
      '<\/script>');
  },
  // The top bar with the Unsorted tray OPEN. Reported from a screenshot in
  // which the word "Comments" was cut off mid-word: the tray, the comments
  // drawer and the card trash are all position:absolute with top:0, and
  // their containing block was .board-canvas-wrap, which starts at the
  // VIEWPORT top — so each of them painted over the bar. The hit-test is
  // what holds this: a control the browser cannot reach because a panel is
  // sitting on it is exactly what that check was written for.
  'boards — the top bar with the tray open':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'Winter Drop 2027',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];moodBoards=[];
      _boardsMenuOpen=false;_boardsViewOpen=false;_boardsTrayOpen=true;`);
    const full=app.run(`_renderBoardCanvasHTML()`);
    // The real wrap, so the tray resolves against the real containing block.
    return Promise.resolve({widths:[1900,1280],html:
      '<div style="position:relative;height:620px;width:100%;overflow:hidden">'+
      full.replace('class="board-canvas-wrap"','class="board-canvas-wrap" style="position:absolute;height:100%"')+
      '</div>'});
  },
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
    return Promise.resolve({widths:[1900,1280],html:
      '<div style="position:relative;width:100%">'+full.slice(i,j)+'</div>'});
  },
  // Home's top bar is a DIFFERENT bar — it drops share/rename/template and
  // grows the Boards button, which is the one route to the panel. Its count
  // is the red the panel tabs use, and it sits on .tool-btn.on's var(--dark)
  // chip, which INVERTS: black in light, near-white in dark. Neither bar
  // fragment above is on Home, so nothing measured this button at all.
  'boards — Home’s top bar':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:.84,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
      _boardsMenuOpen=false;_boardsViewOpen=false;_boardsHomePanelCollapsed=false;
      moodBoards=[
        {id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'},
        {id:'B',title:'WINTER DUMP 2K27',ownerUid:'u1',visibility:'personal',updatedAt:5,cards:[]}
      ];`);
    const full=app.run(`_renderBoardCanvasHTML()`);
    const i=full.indexOf('<div class="board-topbar">');
    const j=full.indexOf('<div class="board-stage"');
    return Promise.resolve({widths:[1900,1280],html:
      '<div style="position:relative;width:100%">'+full.slice(i,j)+'</div>'});
  },
  /* The trash badge's fill ramp. The whole point of four DISCRETE phases
     rather than a per-count colour is that they can be measured: this puts
     the badge on the real rail button at every phase, so the contrast check
     reads each one against the chip it actually sits on, in BOTH themes.
     The chip is var(--red), which INVERTS, so a ramp that only worked in
     light mode would fail here rather than in production.
     The panel's ask is rendered beside it for the same reason. */
  'boards — the trash badge fills up':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _boardsRenderRail();`);
    const inner=app.run(`document.getElementById('board-rail').innerHTML`);
    // The real trash button, lifted out of the real rail, once per phase.
    const btn=(inner.match(/<button[^>]*data-act="trash"[\s\S]*?<\/button>/)||[])[0]||'';
    const counts=[3,12,24,30];
    const cells=counts.map(n=>{
      const cls=app.run(`_boardsTrashPhase(${n})`);
      const one=btn.replace(/<span class="board-rail-badge"[^>]*><\/span>/,
        `<span class="board-rail-badge ${cls}">${n}</span>`);
      return '<div style="position:relative;width:58px">'+one+'</div>';
    }).join('');
    const nag=app.run(`_boardsTrashNagHTML(30)`);
    return Promise.resolve(
      '<div class="board-rail" style="position:relative;inset:auto;height:auto;'+
      'flex-direction:row;width:auto;display:flex;gap:6px">'+cells+'</div>'+
      '<div class="board-ctrash-panel" style="position:relative;display:flex;'+
      'inset:auto;width:320px;margin-top:14px">'+nag+'</div>');
  },
  /* The colour panel and a card on each BACKGROUND (Sept 2026). A
     background is the one place a card's own ink sits on a coloured
     surface, so every palette entry is rendered with real text in both
     themes and measured — a soft token that read in light only would fail
     here by name. The panel's tabs and swatches are hit-tested too. */
  'boards — card backgrounds and the colour panel':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;`);
    const names=app.run(`_BOARDS_COLORS.slice(1)`);
    const themes=app.run(`JSON.stringify(_BOARDS_CARD_THEMES)`);
    // Every palette name as paper AND strip, every paper-and-ink preset, a
    // literal paper and a literal strip — five to a row, so no card is
    // laid out past the right edge of a 1280px window and reported as
    // covered by whatever the hit-test finds there.
    const specs=names.map(n=>({bg:n,color:n,label:n}))
      .concat(JSON.parse(themes).map(th=>({bg:th.bg,ink:th.ink,label:th.ink+' ink on '+th.bg})))
      .concat([{bg:'#C8102E',label:'a literal paper'},{color:'#0F766E',label:'a literal strip'}]);
    const cards=specs.map((sp,i)=>app.run(`(function(){const c=Object.assign(_boardsNewCard('text'),{id:'bg${i}',x:${20+(i%5)*240},y:${20+Math.floor(i/5)*130},text:'Dye lot ${i}'});
      ${sp.bg?`c.bg='${sp.bg}';`:''}${sp.color?`c.color='${sp.color}';`:''}${sp.ink?`c.ink='${sp.ink}';`:''}if(${i}===${names.length-1})c.locked=true;_editCards.push(c);return _boardCardHTML(c,true);})()`)
      // The body is hydrated with textContent at runtime, so the fragment
      // fills it here. NOTE the real class list is "board-card-body
      // board-text-body" — a match on the bare "board-text-body" never
      // fired, and every paper was measured with an EMPTY body until Sept
      // 2026 (found by breaking a token and watching only the A tile fail).
      .replace('<div class="board-card-body board-text-body"','<div class="board-card-body board-text-body" data-fill="Dye lot and rib order — '+sp.label+'"'));
    const stageH=20+Math.ceil(specs.length/5)*130;
    // The last card is LOCKED, so the padlock beside its name is measured
    // against the locked head strip in both themes.
    app.run(`_boardsSelection=new Set(['bg0']);_boardsColorTab='bg'`);
    const panel=app.run(`_boardsCtxHTML(_boardsColorPanelItems())`);
    // The ⋯ menu, with its provenance footer (avatar on a --cat-* token).
    const more=app.run(`_editCards[0].by='Afnan';_editCards[0].at=Date.now();_boardsCtxHTML(_boardsMoreItems(true))`);
    const rail=app.run(`_boardsRenderRail();document.getElementById('board-rail').innerHTML`);
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:'+stageH+'px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards.join('')+'</div></div>'+
      '<script>document.querySelectorAll("[data-fill]").forEach(function(e){e.textContent=e.getAttribute("data-fill")})</script>'+
      '<div style="display:flex;gap:24px;align-items:flex-start;margin-top:14px">'+
      // The selection rail is 7 buttons since the ⋯ round (Back · Color ·
      // Labels · Reactions · Comment · Rename · ⋯); 520px holds it in the
      // large tier, and the fragment must stay inside a 1000px window's
      // viewport for the hit-test to reach every control.
      '<div style="position:relative;height:520px;width:100px"><div class="board-rail" id="board-rail">'+rail+'</div></div>'+
      '<div class="board-ctx" style="position:relative">'+panel+'</div>'+
      '<div class="board-ctx" style="position:relative">'+more+'</div></div>'});
  },
  /* The image card, like Milanote's (Sept 2026): a photo is the whole
     card, its head strip an overlay that shows only on hover or selection.
     The probe cannot hover, so the strip is measured on SELECTED cards
     (the same class the app sets): a plain photo (literal white ink on the
     literal scrim), a photo with a Top strip colour (theme ink on the
     tint), a locked one (the amber pair), plus an unselected photo wearing
     a comment badge painted onto the picture, a photo at h:0 with caption,
     label and reaction (the minimum height the render grows it to), and
     an EMPTY image card, which keeps the ordinary strip. Pictures are a
     solid WHITE stand-in, so a scrim that ever faded to transparent would
     read as white-on-white and fail. */
  /* The second Milanote video's round (Sept 2026): no card has a header
     strip, so every type is measured at REST (the head is a hover overlay
     and the probe cannot hover) and again SELECTED, which is the state
     that shows the strip. The dark scrim carries literal white ink, so it
     is measured on a to-do, a link and a table — three different papers
     under it. The to-do's own additions (title, nested task, due chip,
     assignee, the "Add a title" prompt) and the link card's one field and
     in-card error are here too, plus a card at h:0 so the render draws it
     at exactly the minimum the new chrome asks for. */
  'boards — cards without a header':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _editCards=[
        // Explicit heights, not h:0. _boardsTodoMinH counts ONE-LINE tasks —
        // it cannot know that "Send the tech pack" wraps at this width, and
        // the body scrolls when it does. The minimum-height contract is
        // asserted in tests/boards.test.js instead; this fragment is here
        // for the chrome, the contrast and the hit-testing. Same division
        // the +Row/+Col strip settled on.
        {id:'td',type:'todo',title:'MILE STONE',color:'red',x:10,y:10,w:300,h:200,
         items:[{text:'Cut the fleece'},{text:'Rib order',depth:1,due:'2020-01-01',who:'Ammar Shah'},
                {text:'Send the tech pack',done:true,depth:1,due:'2099-01-01',who:'Afnan'}]},
        {id:'ta',type:'todo',x:330,y:10,w:300,h:200,items:[{text:'one'},{text:'two'},{text:'three'}]},
        {id:'lk',type:'link',x:650,y:10,w:340,h:0},
        {id:'le',type:'link',linkTitle:'ASHI',x:650,y:150,w:340,h:0,_linkErr:'Sorry, something went wrong. The page could not be read — the link still works.'},
        {id:'im',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',
         sourceUrl:'https://www.pinterest.com/pin/1/',name:'FLEECE',x:10,y:260,w:240,h:300},
        {id:'nt',type:'text',text:'x',name:'WINTER NOTE',locked:true,color:'green',x:270,y:260,w:240,h:150},
        {id:'tb',type:'table',rows:[['Fabric','GSM'],['Drill','245']],head:true,color:'blue',x:530,y:260,w:280,h:150}
      ];
      _boardsSelection=new Set(['td','im','nt','tb']);`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"')
      // Everything this module hydrates with textContent has to be filled in
      // the REAL browser, or the fragment measures empty boxes — the defect
      // the Home panel's rows hid for weeks.
      .replace(/(id="board-tdtitle-td"[^>]*>)/,'$1MILE STONE')
      .replace(/(id="board-todo-td-0"[^>]*>)/,'$1Cut the fleece')
      .replace(/(id="board-todo-td-1"[^>]*>)/,'$1Rib order')
      .replace(/(id="board-todo-td-2"[^>]*>)/,'$1Send the tech pack')
      .replace(/(id="board-todo-ta-0"[^>]*>)/,'$1one').replace(/(id="board-todo-ta-1"[^>]*>)/,'$1two').replace(/(id="board-todo-ta-2"[^>]*>)/,'$1three')
      .replace(/(id="board-linkt-le"[^>]*>)/,'$1ASHI')
      .replace(/(id="board-name-im"[^>]*>)/,'$1FLEECE').replace(/(id="board-name-nt"[^>]*>)/,'$1WINTER NOTE')
      .replace(/(id="board-txt-nt"[^>]*>)/,'$1Fleece weights for the winter drop');
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:600px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'+
      // The head is opacity:0/visibility:hidden until hover, and the probe
      // cannot hover — so a second copy is forced visible. Without it the
      // literal white ink on the literal scrim would never be measured.
      '<style>#hovered .board-card-head{opacity:1!important;visibility:visible!important}</style>'+
      '<div id="hovered" style="position:relative;height:600px;width:100%;overflow:hidden;margin-top:14px">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'});
  },
  /* Draw on · Edit · Background (Sept 2026). Three things no logic suite
     can see: that the drawing overlay lands on the body rather than over
     the card foot, that a cropped or rotated picture actually covers its
     card, and that the pen rail and the Background menu can be clicked.
     The pictures are a solid WHITE image, so a stroke or a scrim that ever
     went white would read as white-on-white. */
  'boards — drawing, a cropped picture and the Background menu':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      const PIC='https://res.cloudinary.com/x/image/upload/v1/a.jpg';
      _editCards=[
        {id:'d1',type:'image',imageUrl:PIC,x:10,y:10,w:240,h:360,imgW:1000,imgH:1500,
         strokes:[{c:'red',w:4,p:[10,12,40,55,72,30,90,80]},{c:'blue',w:8,p:[20,80,80,20]}]},
        {id:'d2',type:'image',imageUrl:PIC,x:270,y:10,w:240,h:240,imgW:1000,imgH:1500,
         crop:{x:0.25,y:0.25,w:0.5,h:0.5},caption:'Middle half'},
        {id:'d3',type:'image',imageUrl:PIC,x:530,y:10,w:360,h:240,imgW:1000,imgH:1500,rotate:90},
        {id:'d4',type:'image',imageUrl:PIC,x:910,y:10,w:240,h:200,imgW:1000,imgH:1500,
         strokes:[{c:'green',w:2,p:[5,5,95,95]}],labels:[{t:'marked up',c:'green'}],reactions:{'👍':['u1']}}
      ];
      _boardsSelection=new Set(['d1']);_boardsDrawOn='d1';`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"')
      .replace(/(id="board-cap-d2"[^>]*>)/,'$1Middle half')
      .replace(/(id="board-label-d4-0"[^>]*>)/,'$1marked up');
    // The pen's own rail, and the Background menu, both rendered where
    // they really open. A .board-ctx is position:fixed, so it is given a
    // static position here or it would sit over the cards.
    const rail=app.run(`_boardsRailItems()`);
    const railHtml=app.run(`(function(){const items=_boardsRailItems();return items.map(it=>{
      if(it.drawSwatches)return '<div class="rail-swatches">'+_BOARDS_DRAW_COLORS.map(c=>'<button class="board-swatch sw-'+c+(c===_boardsDrawColor?' on':'')+'" data-act="draw:color:'+c+'" title="'+c+'"></button>').join('')+'</div>';
      if(it.drawWidths)return '<div class="rail-fmt-row">'+_BOARDS_DRAW_WIDTHS.map(x=>'<button class="board-pen-w'+(x.w===_boardsDrawWidth?' on':'')+'" data-act="draw:width:'+x.w+'" title="'+x.label+'"><span style="height:'+x.w+'px"></span></button>').join('')+'</div>';
      return '<button class="rail-btn'+(it.off?' off':'')+(it.done?' rail-done':'')+'" data-act="'+(it.off?'':it.act)+'" title="'+it.label+'">'+_boardsIcon(it.icon)+'<span>'+it.label+'</span></button>';
    }).join('');})()`);
    const bgMenu=app.run(`_boardsCtxHTML(_boardsImgBgItems('d1'))`);
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:430px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'+
      '<div style="display:flex;gap:20px;align-items:flex-start;margin-top:16px">'+
      '<div class="board-rail selecting" style="position:relative;left:auto;top:auto;transform:none">'+railHtml+'</div>'+
      '<div class="board-ctx" style="position:relative;left:auto;top:auto;max-height:none">'+bgMenu+'</div></div>'});
  },
  /* The crop editor is a fixed full-viewport takeover, so it gets a
     fragment to itself — dropped into another one it would cover every
     control there and every hit-test would name it. */
  'boards — the crop and rotate editor':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editCards=[{id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360}];
      _boardsSelection=new Set(['p']);
      _boardsEdit={id:'p',rot:90,crop:{x:0.2,y:0.15,w:0.55,h:0.6},nat:{w:1000,h:1500},url:'x'};`);
    // The overlay is built with createElement, which the node harness
    // stubs, so the markup is composed here exactly as _boardsRenderImgEditor
    // writes it and then MEASURED for real.
    const rn={w:1500,h:1000};
    const q={x:0.2,y:0.15,w:0.55,h:0.6};
    const poly='polygon(0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,'+(q.x*100)+'% '+(q.y*100)+'%,'+(q.x*100)+'% '+((q.y+q.h)*100)+'%,'+((q.x+q.w)*100)+'% '+((q.y+q.h)*100)+'%,'+((q.x+q.w)*100)+'% '+(q.y*100)+'%,'+(q.x*100)+'% '+(q.y*100)+'%)';
    const pic='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E';
    return Promise.resolve({widths:[1900,1280,420],html:
      '<div class="board-imgedit" style="position:relative;height:520px">'+
      '<div class="board-imgedit-bar"><strong>Crop and rotate</strong>'+
      '<span class="board-imgedit-dims">825 × 600 px</span><span style="flex:1"></span>'+
      '<button class="tool-btn" title="Rotate left">↺</button><button class="tool-btn" title="Rotate right">↻</button>'+
      '<button class="tool-btn">Reset</button><button class="tool-btn">Cancel</button>'+
      '<button class="tool-btn primary">Apply</button></div>'+
      '<div class="board-imgedit-body"><div class="board-imgedit-pic" style="aspect-ratio:'+rn.w+' / '+rn.h+'">'+
      '<img src="'+pic+'" alt="" style="transform:rotate(90deg);width:'+(rn.h/rn.w*100).toFixed(4)+'%;height:'+(rn.w/rn.h*100).toFixed(4)+'%;left:'+((1-rn.h/rn.w)*50).toFixed(4)+'%;top:'+((1-rn.w/rn.h)*50).toFixed(4)+'%">'+
      '<div class="board-imgedit-shade" style="clip-path:'+poly+'"></div>'+
      '<div class="board-imgedit-rect" style="left:'+(q.x*100)+'%;top:'+(q.y*100)+'%;width:'+(q.w*100)+'%;height:'+(q.h*100)+'%">'+
      '<span class="board-imgedit-h nw"></span><span class="board-imgedit-h ne"></span>'+
      '<span class="board-imgedit-h sw"></span><span class="board-imgedit-h se"></span></div></div></div>'+
      '<div class="board-imgedit-foot">Drag inside the picture to choose what the card shows. Esc closes without changing anything.</div></div>'});
  },
  /* ── EVERY CARD TYPE CAN BE GRABBED BY ITS OWN HEAD STRIP ────────────
     The strip is what a person aims at: it carries the card's name, the
     delete ✕ and a grab cursor. It is also an absolute overlay over the
     card's first row and is pointer-events:none, so what a press on it
     really reaches is that row — and if the row guards its own pointerdown,
     the card does not move. That is what Afnan reported for the to-do card
     ("to do not moving properly"), and the link card was worse: no drag
     surface anywhere on it at all. Every type is rendered SELECTED here, so
     the strip is painted and the probe can hit-test it. */
  'boards — every card type can be grabbed':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      const PIC='https://res.cloudinary.com/x/image/upload/v1/a.jpg';
      _editCards=[
        {id:'c1',type:'todo',x:10,y:10,w:240,h:150,items:[{text:'Trace the pattern'},{text:'Cut the denim'}]},
        {id:'c2',type:'text',text:'a note',x:270,y:10,w:220,h:110},
        {id:'c3',type:'link',x:510,y:10,w:220,h:100},
        {id:'c4',type:'link',linkUrl:'https://x.test',linkTitle:'T',_linkEdit:true,x:750,y:10,w:220,h:150},
        {id:'c5',type:'table',rows:[['Size','Qty'],['M','40']],x:10,y:190,w:240,h:150},
        {id:'c6',type:'image',imageUrl:PIC,x:270,y:190,w:220,h:150},
        {id:'c7',type:'board',boardId:'B',x:510,y:190,w:240,h:150},
        {id:'c8',type:'heading',text:'SECTION',x:750,y:190,w:220,h:80}
      ];
      _boardsSelection=new Set(_editCards.map(c=>c.id));`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"');
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:400px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'});
  },
  'boards — photo cards':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
      _editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      const PIC='https://res.cloudinary.com/x/image/upload/v1/a.jpg';
      _editCards=[
        {id:'p1',type:'image',imageUrl:PIC,name:'FRONT',x:10,y:10,w:240,h:180},
        {id:'p2',type:'image',imageUrl:PIC,name:'BACK',color:'green',x:270,y:10,w:240,h:180},
        {id:'p3',type:'image',imageUrl:PIC,name:'LOCKED',locked:true,x:530,y:10,w:240,h:180},
        {id:'p4',type:'image',imageUrl:PIC,x:790,y:10,w:240,h:180},
        {id:'p5',type:'image',imageUrl:PIC,caption:'Rib order',labels:[{t:'approved',c:'green'}],reactions:{'👍':['u1']},x:10,y:210,w:240,h:0},
        {id:'p6',type:'image',x:270,y:210,w:170,h:120}
      ];
      _boardsSelection=new Set(['p1','p2','p3']);`);
    const cards=app.run(`_boardsRenderOrder().map(c=>_boardCardHTML(c,true)).join('')`)
      .replace(/src="[^"]*cloudinary[^"]*"/g,
        'src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'3\'%3E%3Crect width=\'4\' height=\'3\' fill=\'%23ffffff\'/%3E%3C/svg%3E"')
      // The badge is filled by _boardsPaintCommentBadges, which needs the
      // DOM; painted here the way it would be, on the unselected photo.
      .replace(/(id="board-cmt-p4"[^>]*style=")display:none/,'$1display:inline-flex').replace(/(id="board-cmt-p4"[^>]*>)/,'$12')
      .replace(/(id="board-cap-p5"[^>]*>)/,'$1Rib order').replace(/(id="board-label-p5-0"[^>]*>)/,'$1approved');
    return Promise.resolve({widths:[1900,1280],html:
      '<div class="board-stage" style="position:relative;height:460px;width:100%;overflow:hidden">'+
      '<div class="board-world" data-lod="near" style="position:absolute;left:0;top:0">'+cards+'</div></div>'});
  },
  /* Labels, Reactions and Comments as popovers (Sept 2026). The comment
     rows put literal initials on --cat-* tokens with --on-dark ink, in both
     themes — the one place an avatar's ink could go unreadable — and every
     checkbox row, category button and emoji is hit-tested. The label
     text and comment bodies are hydrated in the browser, since the module
     writes them with textContent. */
  'boards — labels, reactions and comment panels':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan Bhatti',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',title:'Winter Drop',ownerUid:'u1',visibility:'shared'};
      _editCards=[Object.assign(_boardsNewCard('text'),{id:'n1',text:'a',labels:[{t:'Ready for printing',c:'green'},{t:'Pattern done',c:'blue'},{t:'Needs review',c:'red'}],reactions:{'🔥':['u1']}})];
      _editConnectors=[];_boardsSelection=new Set(['n1']);_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _boardsComments=[{id:'c1',cardId:'n1',ts:Date.now()-60000,text:'follow this one',byName:'Afnan Bhatti',byUid:'u1'},{id:'c2',cardId:'n1',ts:Date.now(),replyTo:'c1',text:'on it',byName:'Daniyal Tufail',byUid:'u2'},{id:'c3',cardId:'n1',ts:Date.now(),text:'ok',byName:'Sami',byUid:'u3'},{id:'c4',cardId:'n1',ts:Date.now(),text:'x',byName:'Mustafa Khan',byUid:'u4'},{id:'c5',cardId:'n1',ts:Date.now(),text:'y',byName:'Ammar Shah',byUid:'u5'},{id:'c6',cardId:'n1',ts:Date.now(),text:'z',byName:'Umair',byUid:'u6'}];`);
    const grab=()=>app.run(`document.getElementById('board-sheet').innerHTML`);
    app.run(`_boardsRenderLabelSheet('n1','')`);const labels=grab();
    app.run(`_boardsRenderReactionSheet('n1','')`);const reacts=grab();
    app.run(`_boardsCommentPopCard='n1';_boardsRenderCommentPop()`);const cmts=grab();
    const pop=(inner,w)=>'<div class="board-sheet board-pop" style="position:relative;left:auto;top:auto;width:'+w+'px;max-height:none;overflow:visible">'+inner+'</div>';
    return Promise.resolve({widths:[1900,1280],html:
      // The panes scroll in the app; here everything is laid out flat, or a
      // scrolled-away emoji reads as "covered" (the documented false hit).
      '<style>.board-emoji-pane{height:auto}.board-emoji-scroll,.board-emoji-cats,.board-cpop-list,.board-label-list{overflow:visible;max-height:none}</style>'+
      // Stacked, not side by side: the app never shows two at once, and a
      // row of three lets one panel's rows sit under another's emoji.
      '<div style="display:flex;flex-direction:column;gap:28px;align-items:flex-start">'+pop(labels,330)+pop(reacts,380)+pop(cmts,320)+'</div>'+
      '<script>'+
      '["Ready for printing","Pattern done","Needs review"].forEach(function(t,i){var e=document.getElementById("board-lrow-"+i);if(e)e.textContent=t});'+
      'var bn=document.getElementById("board-label-boardname");if(bn)bn.textContent="Winter Drop";'+
      '[["c1","Afnan Bhatti","follow this one"],["c2","Daniyal Tufail","on it"],["c3","Sami","ok"],["c4","Mustafa Khan","x"],["c5","Ammar Shah","y"],["c6","Umair","z"]].forEach(function(c){var n=document.getElementById("board-cpop-name-"+c[0]);if(n)n.textContent=c[1];var t=document.getElementById("board-cpop-text-"+c[0]);if(t)t.textContent=c[2]});'+
      '</script>'});
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
    /* THE HOVER CUE IS DELIBERATELY NOT MEASURED HERE, and the attempt is
       worth recording. A second copy with .cue-on forced was tried: it
       proves nothing, because the cue is an ::after and this probe
       enumerates ELEMENTS, and at 420px the rail docks to the bottom of its
       wrapper so two copies reported each other as covering the Image tool —
       a false failure of the fragment, not of the layout. The cue's geometry
       is a one-off measurement recorded in css/main.css; its SCOPE is held
       by tests/invariants.test.js. */
    /* TWO TIERS, TWO VIEWPORTS (Sept 2026). The rail is sized by a
       min-height media query — 22px icons and a 61px pitch from 880px of
       viewport up, the compact rail below — so the wrapper is sized like
       the real stage (the viewport minus the board's own top bar; the
       canvas is a fixed takeover, so the app bar is not above it) and the
       fragment is run at a 1000px viewport (large tier, ~808px of rail) AND
       a 768px viewport (compact tier, ~623px of rail). Each tier was
       measured once with scratchpad/measure-rail.js.

       THE HEIGHTS ARE VIEWPORT HEIGHTS, AND THAT TOOK A CI FAILURE TO GET
       RIGHT. A fragment declaring heights is served inside an iframe of
       exactly that box (see the server below), because --window-size sets
       the WINDOW and the browser keeps an unpredictable slice of it: this
       machine left 100vh at 681 for a 768px window and the CI runner left
       647, so the same rail reported client:631 here and client:575 there
       and failed only on CI — the probe measuring the runner's chrome.
       Framed, the stage is exactly h-50: 950 and 718, everywhere.

       What that costs, stated rather than buried: the old 631 was smaller
       than the truth, so the check used to fire at 13 tools (673 compact)
       and now fires at 14. The guard is still real — the rail must not
       scroll — it is just no longer accidentally strict.

       STILL OPEN, and deliberately not decided here: what a 768px-tall
       LAPTOP really leaves. CLAUDE.md puts a 900px screen at ~790px of
       viewport, i.e. ~110px of OS and browser chrome; the same subtraction
       makes a 768px screen ~658px of viewport and a ~608px stage, which
       the 623px compact rail would NOT fit. That is a product question
       about the shortest screen we support, not a probe setting, so it is
       flagged for a human rather than answered by choosing a number.
       NOT at 420px: a wrapper one viewport tall plus the probe's own output
       block overflows the page, the vertical scrollbar takes 15px off the
       phone dock, and the Image tool then sits 4px past its right edge —
       reported as "covered" by the wrapper. That dock scrolls sideways by
       design and is measured at REAL phone widths (this probe's 420 is a
       clamped 500) by tests/smoke-phone.js, the same reason the top-bar
       fragments opt out. */
    return Promise.resolve({widths:[1900,1280],heights:[1000,768],html:
      '<div style="position:relative;height:calc(100vh - 50px);width:100%;overflow:hidden">'+
      '<div class="board-rail" id="board-rail">'+inner+'</div></div>'});
  },
  // Home's Boards panel: a row is a tile, a name that must ellipsize rather
  // than collapse, a meta line, a state word and an Open button — the exact
  // shape that crushed the Profile directory's names to 0px when the name
  // shared a flex row with fixed-width actions.
  // A link preview is a picture above two clamped text rows inside a fixed
  // height card — the exact shape that erased a sub-board card's title when
  // labels and reactions took the room. Rendered at the birth size too, so
  // a card somebody shrank still shows its title rather than nothing.
  'boards — link preview cards':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];moodBoards=[];
      _editCards=[
        {id:'lp',type:'link',x:10,y:10,w:250,h:280,
         linkUrl:'https://scuffers.com/collections/hoodies/products/club-navy-zipper',
         linkTitle:'Club Navy Zipper — heavyweight rugby stripe hoodie, navy/ecru',
         linkDesc:'Scuffers® Official Website. Everyday Urban Aesthetics. As Always, With Love',
         linkSite:'scuffers.com',
         linkImage:'https://res.cloudinary.com/deww4lpym/image/upload/v1/hero.jpg'},
        {id:'ln',type:'link',x:280,y:10,w:250,h:150,
         linkUrl:'https://example.com/a',linkTitle:'A page with no picture at all',
         linkDesc:'And a description long enough to need the second line it is given',
         linkSite:'example.com'},
        {id:'lt',type:'link',x:550,y:10,w:170,h:120,
         // The SMALLEST a link card gets, WITH a picture — so the show/hide
         // toggle is rendered on the card whose resize grip is nearest it.
         // A control tucked into a corner another control already owns is
         // this module's most repeated bug.
         linkUrl:'https://example.com/b',linkTitle:'Still at the birth size',linkSite:'example.com',
         linkImage:'https://res.cloudinary.com/deww4lpym/image/upload/v1/hero.jpg'},
        {id:'lo',type:'link',x:740,y:10,w:250,h:150,linkPreviewOff:true,
         linkUrl:'https://scuffers.com/collections/hoodies/products/club-navy-zipper',
         linkTitle:'Preview turned off — still a link',
         linkDesc:'The picture is hidden and the three rows keep their room',
         linkSite:'scuffers.com',
         linkImage:'https://res.cloudinary.com/deww4lpym/image/upload/v1/hero.jpg'}
      ];`);
    const html=app.run(`_editCards.map(c=>_boardCardHTML(c,true)).join('')`);
    // The text is hydrated with textContent, so it has to be put back the
    // same way the canvas does it or the fragment measures empty boxes.
    const fill=app.run(`JSON.stringify(_editCards.map(c=>({id:c.id,t:c.linkTitle||'',u:c.linkUrl||'',d:c.linkDesc||''})))`);
    return Promise.resolve(
      '<div class="board-world" data-lod="near" style="position:relative;height:420px">'+html+'</div>'+
      '<script>' +
      'JSON.parse(' + JSON.stringify(fill) + ').forEach(function(c){' +
      'var t=document.getElementById("board-linkt-"+c.id);if(t)t.textContent=c.t;' +
      'var u=document.getElementById("board-linku-"+c.id);if(u)u.textContent=c.u;' +
      'var d=document.getElementById("board-linkd-"+c.id);if(d)d.textContent=c.d;});' +
      '<\/script>');
  },
  'boards — Home’s Boards panel':()=>{
    const app=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app.run(`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
      _boardsTrayOpen=true;_boardsPanelQuery='';_boardsPanelFilter='all';
      _boardsHomePanelCollapsed=false;
      moodBoards=[
        {id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'},
        // The name Afnan's panel truncated to "WINTER D…", plus a longer one
        // still, so the two-line clamp is measured rather than assumed.
        {id:'A',title:'Winter Drop 2027 — fleece, outerwear and the full tech-pack reference dump',
         ownerUid:'u1',ownerName:'Afnan',visibility:'shared',updatedAt:9,color:'#7C3AED',icon:'W',
         cards:[{id:'i1',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/a.jpg',x:0,y:0,w:170,h:120},
                {id:'f1',type:'file',fileUrl:'https://res.cloudinary.com/x/raw/upload/t.pdf',x:0,y:0,w:200,h:110}]},
        {id:'B',title:'WINTER DUMP 2K27',ownerUid:'u2',ownerName:'Ammar',visibility:'personal',updatedAt:5,cards:[]},
        // A board wearing an uploaded PICTURE rather than a letter.
        {id:'C',title:'Lowkey Heat ’26',ownerUid:'u1',visibility:'shared',updatedAt:3,color:'#C2410C',
         coverUrl:'https://res.cloudinary.com/deww4lpym/image/upload/v1/cover.jpg',cards:[]}
      ];
      _editCards=[{id:'c1',type:'board',boardId:'B',x:0,y:0,w:200,h:124}];`);
    app.run(`_editBoard.isHome=true;(function(){
      const host=document.createElement('div');
      host.id='board-panel-host';
      host.innerHTML=_boardsTrayHTML(true);
      document.body.appendChild(host);
      _boardsPanelHydrate();
      return true;})()`);
    const inner=app.run(`document.getElementById('board-panel-host').innerHTML`);
    // THE NAMES HAVE TO BE FILLED HERE. _boardsPanelHydrate walks
    // document.getElementById, and the harness's DOM does not parse an
    // innerHTML string into findable elements — so calling it above does
    // nothing and every row measured EMPTY. This fragment claimed to prove
    // "the whole name is visible" and was measuring blank boxes until the
    // name became clickable and the probe reported it as a zero-size
    // control. Filled in the real browser instead, like the link-preview
    // and far-zoom fragments already are.
    const names=app.run(`JSON.stringify(_boardsHomeList().map(b=>({id:b.id,t:b.title||''})))`);
    // .board-tray is position:absolute inside the canvas wrap, so the
    // fragment supplies that containing block rather than letting it escape
    // to the page and measure nothing.
    return Promise.resolve(
      '<div style="position:relative;height:620px;width:100%;overflow:hidden">'+inner+'</div>'+
      '<script>' +
      'JSON.parse(' + JSON.stringify(names) + ').forEach(function(b){' +
      'var e=document.getElementById("board-panel-n-"+b.id);if(e)e.textContent=b.t;});' +
      '<\/script>');
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
        {id:'or',type:'board',boardId:'',x:10,y:420,w:200,h:104},
        // A note at EXACTLY its minimum height wearing a label and two
        // reactions: the foot's chips have to fit under the text at that
        // height, so a chrome constant that under-counts the foot clips them
        // here (the note is placed at h:0 and grown by the render).
        {id:'mn',type:'text',x:230,y:10,w:220,h:0,text:'Dye lot 4 — rib order',
         labels:[{t:'see this',c:'green'}],reactions:{'A':['u2'],'B':['u1','u2']}}
      ];`);
    let html=app.run(`_editCards.map(c=>_boardCardHTML(c,true)).join('')`);
    // Hydrated at runtime with textContent; written in here so it can be measured.
    html=html.replace(/(id="board-label-sb-0"[^>]*>)/,'$1QA-LABEL')
             .replace(/(id="board-label-mn-0"[^>]*>)/,'$1see this')
             .replace(/(<div class="board-card-body board-text-body"[^>]*id="board-txt-mn"[^>]*>)/,'$1Dye lot 4 — rib order')
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
      // The niche tag screen. A row is a flexing name beside fixed-width
      // buttons inside a modal — the exact shape that rendered every name
      // in the Profile directory at 0px. The messy tag is in the fragment
      // so the "needs tidying" chip is measured too.
      app.run('mktNicheTags=["Streetwear"];mktNicheTagsLoaded=true');
      app.run('mktCreators=mktCreators.concat([{id:"cr_messy",ig_handle:"x",niche:[String.fromCharCode(34)+"Blogger"+String.fromCharCode(34)]}])');
      app.run('window.mktOpenNicheTags()');
      const tags=app.bodyHtml('mkt-modal-back');
      return page+incomplete+fetched+blank+tags;
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
// An element's class as a STRING. .className on an SVG element is an
// SVGAnimatedString, which stringifies to "[object SVGAnimatedString]" and
// names nothing - the exact defect already fixed for the coverer report,
// still live everywhere else until Sept 2026. getAttribute is the one form
// that works on both HTML and SVG.
function clsOf(el,max){
  if(!el)return '';
  var c=(el.getAttribute&&el.getAttribute('class'))||'';
  if(!c&&typeof el.className==='string')c=el.className;
  return String(c).slice(0,max||50);
}

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
      cls:clsOf(el,60),
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
      cls:clsOf(el,50),
      clippedBy:(clsOf(clip,50)||String(clip.tagName)).slice(0,50)});
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
      cls:clsOf(el,50)});
  }
});
// At FAR zoom a card paints its content and nothing else. This is the
// contract the level-of-detail rules exist to keep: at 22% a header strip
// is ~5 physical px of grey and its text is under 3px, so painting it is
// worse than painting nothing. Asserted rather than assumed, because the
// rules are pure CSS and a renamed class would silently stop applying them
// with no other symptom.
document.querySelectorAll('.board-world[data-lod="far"]').forEach(world=>{
  ['.board-card-kind','.board-card-name','.board-card-del','.board-resize-handle',
   '.board-labels','.board-reactions','.board-caption',
   '.board-link-img+.board-link-meta'].forEach(sel=>{
    world.querySelectorAll(sel).forEach(el=>{
      if(getComputedStyle(el).display!=='none'){
        bad.push({why:'card chrome is still painted at far zoom',sel:sel,
          display:getComputedStyle(el).display});
      }
    });
  });
  world.querySelectorAll('.board-card-head').forEach(el=>{
    const h=el.getBoundingClientRect().height;
    if(h>12)bad.push({why:'the card header is still a full strip at far zoom',h:Math.round(h)});
    // A TINTED card kept its coloured banding, because .tint-* .board-card-head
    // sits later in the file at the same specificity and was winning.
    const bg=getComputedStyle(el).backgroundColor;
    if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent'){
      bad.push({why:'a card header still paints a background at far zoom',bg:bg,
        cls:clsOf(el.parentElement,40)});
    }
  });
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
      cls:clsOf(el,60),
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
      cls:clsOf(el,50)});
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
      // Naming the coverer is the whole value of this finding, and
      // hit.className gave up on both counts: on an SVG it is an
      // SVGAnimatedString that stringifies to "[object SVGAnimatedString]",
      // and the thing on top is often an unclassed svg or path inside a
      // classed wrapper. So: the tag, then the nearest ancestor that has a
      // class - which is what a person would call it.
      // (No backticks in this comment: the PROBE is a template literal and
      // one would close it. Documented in CLAUDE.md, and hit anyway.)
      coveredBy:(hit.tagName+'.'+
        (clsOf(hit,70)||
         (hit.closest&&clsOf(hit.closest('[class]'),70))||'?')
        ).slice(0,70)});
  }
});
// A CARD THAT SAYS GRAB ME AND THEN DOES NOT MOVE.
// The rule is exact: wherever a card paints cursor:grab, a press there has
// to start the drag. Nothing else on a card is allowed to claim that
// cursor, so this needs no list of card types and no threshold.
//
// It is the shape of what Afnan reported as "to do not moving properly".
// The head strip is an absolute overlay across the card's first row and it
// is pointer-events:none, so both the CURSOR and the press come from
// whatever sits underneath. On a to-do card that is the task text, which
// inherits grab from .board-card-body and carried a stopPropagation guard
// of its own - so the strip showed a grab hand over 58% of itself and the
// card would not move. Every logic suite was green: the drag handler was
// in the DOM the whole time.
// A link card's form is correctly NOT flagged: its fields paint a text
// caret, so they promise nothing.
document.querySelectorAll('#main-content .board-card-el').forEach(card=>{
  if(hiddenEl(card))return;
  const r=card.getBoundingClientRect();
  if(r.width<8||r.height<8)return;
  if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return;
  function reaches(el){
    let n=el;
    while(n&&n!==document.body){
      const h=n.getAttribute&&n.getAttribute('onpointerdown');
      if(h){
        if(h.indexOf('stopPropagation')>=0)return false;
        if(h.indexOf('DragStart')>=0)return true;
      }
      if(n===card)return false;
      n=n.parentElement;
    }
    return false;
  }
  let lying=0,tot=0,worst='';
  for(let dy=2;dy<r.height-2;dy+=4)for(let dx=3;dx<r.width-3;dx+=4){
    const x=r.left+dx,y=r.top+dy;
    if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
    const n=document.elementFromPoint(x,y);
    if(!n||!card.contains(n))continue;
    if(getComputedStyle(n).cursor!=='grab')continue;
    tot++;
    if(!reaches(n)){lying++;if(!worst)worst=clsOf(n,50)||n.tagName;}
  }
  if(lying>2){
    bad.push({why:'the card paints a grab cursor where a press will not drag it',
      card:clsOf(card,50),
      points:lying+' of '+tot,
      saysGrab:worst});
  }
});
(window.parent!==window?window.parent.document:document).getElementById('__out').textContent=JSON.stringify(bad);
`;

(async function main(){
  const cases=[];
  for(const [name,build] of Object.entries(FRAGMENTS)){
    const built=await build();
    // A builder may return {html,widths} to opt out of a width. The board
    // TOP BAR fragments do: they render the DESKTOP markup (seven controls),
    // and at 420px the phone CSS lays the bar out as ONE non-wrapping row
    // for the PHONE markup — which the real app renders there, since
    // _boardsIsPhone() is true. The phone bar is measured, comprehensively,
    // by tests/smoke-phone.js instead.
    if(built&&typeof built==='object')cases.push({name,html:built.html,widths:built.widths,heights:built.heights});
    else cases.push({name,html:built});
  }

  const server=http.createServer((req,res)=>{
    const url=decodeURIComponent(req.url.split('?')[0]);
    const m=/^\/__frag\/(\d+)$/.exec(url);
    if(m){
      const c=cases[Number(m[1])];
      const q=new URLSearchParams(req.url.split('?')[1]||'');
      res.writeHead(200,{'Content-Type':'text/html'});
      // A fragment that declares heights is measured INSIDE AN IFRAME of
      // exactly that viewport, the same device tests/smoke-phone.js uses and
      // for the same reason: --window-size sets the WINDOW, not the viewport,
      // and how much of it the browser keeps for itself differs per Chrome
      // build. The tool rail is sized by a min-height media query and its
      // wrapper is a calc() off 100vh, so on the CI runner both resolved
      // ~120px shorter than here and the rail reported that it had to scroll
      // - a measurement of the runner's chrome, not of the app. An iframe has
      // a viewport of exactly its own box, so 100vh and the tier query are
      // the numbers the fragment asks for, on every machine. The inner page
      // is served byte-identical to the unframed one so nothing else moves,
      // and the probe writes its result up into the shell's own __out.
      if(c.heights&&q.get('vh')&&!q.get('inner')){
        return res.end(`<!doctype html><html><body style="margin:0">`+
          `<iframe src="/__frag/${Number(m[1])}?t=${q.get('t')==='dark'?'dark':'light'}&inner=1" `+
          `style="border:0;display:block;width:${Number(q.get('vw'))||1280}px;`+
          `height:${Number(q.get('vh'))}px"></iframe>`+
          `<pre id="__out">running</pre></body></html>`);
      }
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
    // A builder may also return {heights}: extra WINDOW heights to measure
    // at, for markup whose CSS keys off the viewport height (the tool rail
    // has two tiers). The default is the one height every fragment gets.
    cases.forEach((c,i)=>(c.widths||WIDTHS).forEach(w=>(c.heights||[1000]).forEach(h=>['light','dark'].forEach(t=>
      jobs.push({c,i,w,h,t,dir:profileDir+'-'+i+'-'+w+'-'+h+'-'+t})))));
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
        '--window-size='+j.w+','+j.h,
        '--user-data-dir='+j.dir,
        '--virtual-time-budget=8000','--dump-dom',
        'http://127.0.0.1:'+port+'/__frag/'+j.i+'?t='+j.t+
         (j.c.heights?'&vw='+j.w+'&vh='+j.h:'')],
        {encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000},
        (err,stdout)=>{
          const label=j.c.name+' @ '+j.w+'px '+(j.h!==1000?j.h+'px tall ':'')+j.t;
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
    /* SWEEP BY PREFIX, because reconstructing the paths is what was broken.
       This used to rebuild them from WIDTHS/cases/themes and LEFT OUT THE
       HEIGHT, so it matched nothing: every ~8MB Chrome profile was orphaned
       in /tmp, roughly 900MB per run. That is what exhausted this sandbox's
       disk allowance mid-session, and the symptom was the probe reporting
       "the probe never ran" — a disk failure wearing a browser failure's
       clothes.

       The second attempt read the job list, and could not work either:
       `jobs` lives inside the server.listen callback and finish() is
       declared outside it, so it threw a ReferenceError straight into this
       catch and stayed silent. Reading the DIRECTORY is what removes both
       failure modes — it needs nothing in scope but `profileDir`, it takes
       the mkdtemp base as well as the per-job siblings, and no future
       change to the job path can desync it. */
    try{
      const base=path.basename(profileDir),parent=path.dirname(profileDir);
      fs.readdirSync(parent).forEach(n=>{
        if(n===base||n.indexOf(base+'-')===0)fs.rmSync(path.join(parent,n),{recursive:true,force:true});
      });
    }catch(e){}
    console.log('');
    if(failures){
      console.log('\x1b[31m'+failures+' of '+checks+' layout checks failed\x1b[0m');
      process.exit(1);
    }
    console.log('\x1b[32mall '+checks+' layout checks passed\x1b[0m');
  }
})().catch(e=>{console.error('smoke-layout: '+(e&&e.stack||e));process.exit(1);});

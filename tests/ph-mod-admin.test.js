/* Production Ops admin tabs (12 Oct 2026): js/ph-mod-admin.js -- Masters, Standards, Settings -- and its wiring.

   What this drives (the REAL handlers: the real js/ph-core.js, ph-data.js, ph-write.js, ph-ui.js over a small real DOM
   (tests/ph-dom.js) and an in-memory Firestore with real transaction semantics that RECORDS every write):
     · the audience: the three tabs are managers' (afnan, ammar, mustafa); Uzaib and everyone off the audience cannot see or render them
     · Masters: add / rename / retire / reactivate, the Hassan / Alam seed (only when pressed), suggestions from fabric issues,
       a failed read names the collection and shows no list; the daily and weekly log against a HAND-COMPUTED fixture, "no data yet" is never a zero
     · Standards: coverage ("N of M active articles have a standard"), search and filter, the size-model guess by prefix and the override,
       a REQUIRED reason, rev checked (a stale save is refused and offers a reload), invalid numbers refused before any write
     · Settings: defaults labelled unconfirmed, only the changed fields are written, skip days / weekdays off / gate / stuck-vs-target validated,
       pcOnlyHard is an OWNER's (disabled for Mustafa, refused by the writer if forced), a stale save offers a reload
     · every write lands in cutting_masters / ph_standards / ph_settings only, nothing is deleted; one press = one write
     · XSS: stored text only ever reaches textContent
   What it does NOT prove: geometry (tests/smoke-layout.js's "production ops - admin tabs" fragment holds that in real Chromium), the real Firestore
   (tests/rules-emulator-ph.js holds the rules) and nothing has been seen on a real screen or phone. Each "break" mutates the source and requires
   the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-admin.js'),UISRC=read('js/ph-ui.js'),CSS=read('css/main.css');
const J=JSON.stringify;
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'},
  arfat:{uid:'u-arfat',u:'arfat',name:'Arfat',role:'manager'},
  claude:{uid:'u-claude',u:'claude',name:'Claude',role:'qa'}
};
const settle=ms=>new Promise(r=>setTimeout(r,ms||12));
const HOSTILE='<img src=x onerror=alert(1)>';

/* ── an in-memory Firestore with transaction semantics, recording every write ─ */
function makeFake(o){
  o=o||{};
  const store=o.store||{};
  const log={writes:[],tx:0,deletes:0,reads:[],txBegun:0};
  const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  const snapDoc=p=>({id:p.split('/').pop(),exists:()=>Object.prototype.hasOwnProperty.call(store,p),data:()=>clone(store[p]),metadata:{fromCache:false}});
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/'),isCol:true}),
    query:(c,...cons)=>({path:c.path,limit:(cons.filter(x=>x&&x.limit!==undefined)[0]||{}).limit}),
    orderBy:(f,d)=>({orderBy:[f,d]}),limit:n=>({limit:n}),where:(...a)=>({where:a}),
    getDoc:async r=>{log.reads.push(r.path);const f=o.failPath&&o.failPath(r.path);if(f)throw f;return snapDoc(r.path);},
    getDocs:async q=>{
      log.reads.push(q.path);
      const f=o.failPath&&o.failPath(q.path);if(f)throw f;
      let docs=Object.keys(store).filter(k=>k.indexOf(q.path+'/')===0&&k.slice(q.path.length+1).indexOf('/')===-1).sort();
      if(q.limit!==undefined)docs=docs.slice(0,q.limit);
      return{docs:docs.map(snapDoc),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path,tx:0,data:clone(d)});store[r.path]=clone(d);},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});store[r.path]=Object.assign({},store[r.path],clone(d));},
    deleteDoc:async r=>{log.deletes++;log.writes.push({op:'delete',path:r.path,tx:0});delete store[r.path];},
    addDoc:async(c,d)=>{log.writes.push({op:'add',path:c.path,tx:0,data:clone(d)});return{id:'x'};},
    writeBatch:()=>{const ops=[];return{set(r,d){ops.push({op:'set',path:r.path,data:clone(d)});return this;},update(r,d){ops.push({op:'update',path:r.path,data:clone(d)});return this;},delete(r){log.deletes++;ops.push({op:'delete',path:r.path});return this;},async commit(){log.tx++;ops.forEach(x=>log.writes.push(Object.assign({tx:log.tx},x)));}};},
    runTransaction:async(db,fn)=>{
      log.txBegun++;
      if(o.txDelay)await new Promise(r=>setTimeout(r,o.txDelay));
      const id=++log.tx,buf=[];
      const tx={
        get:async r=>{log.reads.push(r.path);return snapDoc(r.path);},
        set:(r,d)=>{buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
        update:(r,d)=>{if(!Object.prototype.hasOwnProperty.call(store,r.path)&&!buf.some(b=>b.path===r.path))throw new Error('not-found');buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
        delete:r=>{log.deletes++;buf.push({op:'delete',path:r.path});return tx;}
      };
      const res=await fn(tx);
      buf.forEach(b=>{
        log.writes.push({op:b.op,path:b.path,tx:id,data:b.data});
        if(b.op==='set')store[b.path]=b.data;else if(b.op==='update')store[b.path]=Object.assign({},store[b.path],b.data);else delete store[b.path];
      });
      return res;
    }
  };
  return{store,log,api};
}

function load(src,opts){
  opts=opts||{};
  const lsStore={},shown=[];
  const fk=makeFake({store:opts.store,failPath:opts.failPath,txDelay:opts.txDelay});
  const g=Object.assign({},fk.api,{
    auth:{currentUser:{getIdToken:async()=>{}}},
    navigator:{onLine:opts.offline?false:true},
    localStorage:{getItem:k=>lsStore[k]==null?null:lsStore[k],setItem(k,v){lsStore[k]=String(v);},removeItem(k){delete lsStore[k];}},
    history:{replaceState(){},pushState(){}}
  },opts.globals||{});
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:opts.session===undefined?USERS.afnan:opts.session,currentPage:'dashboard',globals:g});
  const ctx=a.ctx;if(typeof ctx.phI18nSetLang==='function')ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  ctx.window.showPage=function(id){
    shown.push(id);ctx.currentPage=id;
    if(id==='prod-ops')ctx.phRenderPage(id);
    return Promise.resolve();
  };
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(UISRC,ctx,{filename:'ph-ui.js'});
  vm.runInContext(src,ctx,{filename:'ph-mod-admin.js'});
  const T={a,ctx,dom,fk,store:fk.store,log:fk.log,shown,
    R:c=>a.run(c),
    as(u){ctx.session=u;},
    panel:()=>dom.find('ph-panel'),
    text:n=>n?n.textContent:'',
    html:n=>n?domkit.toHtml(n):'',
    byF:(root,f)=>dom.all(root||T.panel(),n=>n.getAttribute('data-f')===f)[0]||null,
    byAct:(root,act)=>dom.all(root||T.panel(),n=>n.getAttribute('data-act')===act),
    act:(act,root)=>T.byAct(root,act)[0]||null,
    rowOf:(attr,val)=>dom.all(T.panel(),n=>n.getAttribute(attr)===val)[0]||null,
    set(f,v,evt){const n=T.byF(null,f);n.value=v;dom.dispatch(n,evt||'input');dom.dispatch(n,'change');return n;},
    check(f,v){const n=T.byF(null,f);n.checked=v;dom.dispatch(n,'change');return n;},
    click:async(n,ms)=>{dom.click(n);await settle(ms||14);},
    open:async tab=>{await ctx.window.showPage('prod-ops');await settle(20);const r=T.R('phGoTab('+J(tab)+')');await settle(8);return r;},
    wroteRoots:()=>Array.from(new Set(fk.log.writes.map(w=>w.path.split('/')[0]))).sort(),
    writesTo:p=>fk.log.writes.filter(w=>w.path===p),
    flash:()=>{const f=T.dom.all(T.panel(),n=>/\bpha-flash\b/.test(n.className))[0];return f?f.textContent:'';}
  };
  return T;
}

const MASTERS_BOTH={'cutting_masters/CM-001':{id:'CM-001',name:'Hassan',nameKey:'hassan',kind:'unset',active:true,aliases:[],notes:'',createdAt:1,createdBy:'afnan',updatedAt:1,updatedBy:'afnan',retiredAt:null,retiredBy:null,retiredReason:''},
  'cutting_masters/CM-002':{id:'CM-002',name:'Alam',nameKey:'alam',kind:'inhouse',active:true,aliases:[],notes:'',createdAt:1,createdBy:'afnan',updatedAt:1,updatedBy:'afnan',retiredAt:null,retiredBy:null,retiredReason:''},
  'ph_settings/counters':{cutting_masters:2,updatedAt:1,updatedBy:'afnan'}};
const POS=[
  {fbKey:'PO-001',id:'PO-001',code:'GST073',cutAt:'2026-10-05T09:00:00+05:00',cutQty:{S:50,M:50}},
  {fbKey:'PO-002',id:'PO-002',code:'GST073',cutAt:'2026-10-05T15:00:00+05:00',cutQty:{M:30}},
  {fbKey:'PO-003',id:'PO-003',code:'GD007',cutAt:'2026-10-08T10:00:00+05:00',cutQty:{'30':20,'32':40}},
  {fbKey:'PO-004',id:'PO-004',code:'GST073',cutAt:'2026-10-13T10:00:00+05:00',cutQty:{L:10}},
  {fbKey:'PO-005',id:'PO-005',code:'GST073'},
  {fbKey:'PO-006',id:'PO-006',code:'GST073',cutAt:'2026-10-06T10:00:00+05:00',cutQty:{M:999},poStatus:'cancelled'},
  {fbKey:'PO-007',id:'PO-007',code:'GST073',cutAt:'2026-09-30T23:30:00+05:00',cutQty:{M:25}}
];
const PASSES=[
  {gpType:'fabric',poId:'PO-001',cutMaster:'hassan',ts:1},
  {gpType:'fabric',poId:'PO-003',cutMaster:' HASSAN ',ts:2},
  {gpType:'fabric',poId:'PO-004',cutMaster:'Hassan',ts:3},
  {gpType:'fabric',poId:'PO-007',cutMaster:'Bashir',ts:4},
  {gpType:'fabric',poId:'PO-008',cutMaster:'Bashir',ts:5},
  {gpType:'fabric',poId:'PO-002',cutMaster:'Hassan',ts:7},
  {gpType:'gate',poId:'PO-001',cutMaster:'NotFabric',ts:6}
];
const JOBROWS={'po_cut_jobs/PO-002':{poId:'PO-002',status:'open',rev:1,masterId:'CM-002',masterName:'Alam',createdAt:1,createdBy:'uzaib',updatedAt:1,updatedBy:'uzaib'}};
const ARTS=[
  {code:'GST073',name:'Effortless Tee',brand:'groovy',active:true},
  {code:'GD007',name:'Straight Denim',brand:'groovy',active:true},
  {code:'GHW001',name:'Classic Cap',brand:'groovy'},
  {code:'GOLD01',name:'Retired Tee',brand:'groovy',active:false},
  {code:'XB001',name:'Other Brand Tee',brand:'other',active:true}
];
const STD=(extra)=>Object.assign({code:'GST073',unit:'kg',grossPerPiece:0.31,tolerancePct:null,sizes:null,sizeModel:'alpha',reason:'first cut',rev:2,createdAt:1,createdBy:'afnan',updatedAt:1,updatedBy:'afnan'},extra||{});
const SETTINGS_SAVED=(extra)=>Object.assign({dailyCapacity:420,rev:3,updatedAt:1790000000000,updatedBy:'afnan'},extra||{});

const ALLOWED_ROOTS=['cutting_masters','ph_settings','ph_standards'];

async function checks(src){
  const o={};
  const mk=(u,more)=>load(src,Object.assign({session:USERS[u]},more||{}));
  const FULLG=(extra)=>Object.assign({allPOs:POS,allPasses:PASSES,tacArticles:ARTS,patternsLoaded:true,_ptnLoadFailed:()=>false},extra||{});

  /* ── registration and the audience ── */
  {
    const T=mk('afnan');
    o['the three tabs are registered with this file\'s render']=['masters','standards','settings'].every(id=>T.R('PH_TABS.filter(t=>t.id==='+J(id)+')[0].render.name')==={masters:'_phaRenderMasters',standards:'_phaRenderStandards',settings:'_phaRenderSettings'}[id]);
    o['the tab order and the other six tabs are untouched']=T.R('PH_TABS.map(t=>t.id).join()')==='overview,queue,calendar,cutting,monitor,reports,masters,standards,settings'&&T.R('PH_TABS.filter(t=>/_phaRender/.test(t.render.name)).length')===3;
    for(const u of ['afnan','ammar','mustafa']){T.as(USERS[u]);o['tabs: '+u+' sees Masters, Standards and Settings']=T.R('phTabsFor().filter(t=>["masters","standards","settings"].indexOf(t.id)>-1).length')===3;}
    T.as(USERS.uzaib);
    o['tabs: uzaib sees none of the three']=T.R('phTabsFor().filter(t=>["masters","standards","settings"].indexOf(t.id)>-1).length')===0;
    for(const u of ['raees','arfat','claude']){T.as(USERS[u]);o['tabs: '+u+' (off the audience) sees nothing']=T.R('phTabsFor().length')===0;}
  }
  {
    const U=mk('uzaib');await U.ctx.window.showPage('prod-ops');await settle(40);
    let hits=0;U.ctx.__spy=()=>{hits++;};
    ['masters','standards','settings'].forEach(id=>U.R('(function(){var t=PH_TABS.filter(function(x){return x.id==='+J(id)+'})[0];var o=t.render;t.render=function(h,c){__spy();return o(h,c);};})()'));
    ['masters','standards','settings'].forEach(id=>{U.R('_phUiTab='+J(id));U.R('_phUiPaintPanel()');});
    o['uzaib: a forced tab id never calls a render of the three (he gets his default)']=hits===0&&/Overview/.test(U.text(U.panel()));
    // defence in depth: a render handed a non-manager ctx refuses and draws no control
    const T=mk('afnan');await T.open('masters');
    for(const [name,fn] of [['masters','_phaRenderMasters'],['standards','_phaRenderStandards'],['settings','_phaRenderSettings']]){
      const host=T.ctx.document.createElement('div');
      T.ctx.__h=host;T.ctx.__c={user:'uzaib',canManage:false,readOnly:true,get:()=>({ok:true,rows:[]}),repaint(){},reload(){}};
      T.R(fn+'(__h,__c)');
      o['guard: the '+name+' render refuses a ctx that is not a manager (no controls, no data)']=/Managers only/.test(host.textContent)&&T.dom.all(host,n=>n.tagName==='INPUT'||n.tagName==='BUTTON'||n.tagName==='SELECT').length===0;
    }
    // even with a ctx that lies, the real audience list decides
    const host=T.ctx.document.createElement('div');T.ctx.__h=host;T.ctx.__c={user:'uzaib',canManage:true,get:()=>({ok:true,rows:[]}),repaint(){},reload(){}};
    T.R('_phaRenderMasters(__h,__c)');
    o['guard: a ctx claiming canManage for uzaib still refuses (the audience list decides)']=/Managers only/.test(host.textContent);
  }

  /* ── Masters ── */
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});
    await T.open('masters');
    const pn=T.panel();
    o['masters: the register lists Hassan and Alam with their ids and counts 2 active']=/Hassan/.test(T.text(pn))&&/Alam/.test(T.text(pn))&&/CM-001/.test(T.text(pn))&&/Register \(2 active\)/.test(T.text(pn));
    o['masters: the Hassan / Alam seed is NOT offered when both exist']=!T.act('seed');
    o['masters: opening the tab and rendering it wrote nothing']=T.log.writes.length===0&&T.log.tx===0;
    // add
    T.set('newname','   Zaheer   ');
    await T.click(T.act('add'));
    o['masters add: one transaction, new master CM-003 with the normalised name']=T.log.tx===1&&T.writesTo('cutting_masters/CM-003').length===1&&T.store['cutting_masters/CM-003'].name==='Zaheer'&&T.store['cutting_masters/CM-003'].active===true;
    o['masters add: the counter document moves to 3 (ph_settings/counters), never counters/main']=T.store['ph_settings/counters'].cutting_masters===3&&!T.log.writes.some(w=>w.path==='counters/main');
    o['masters add: a success message names the new id and the list shows it']=/Zaheer added \(CM-003\)/.test(T.flash())&&/Register \(3 active\)/.test(T.text(T.panel()));
    o['masters add: the input is cleared after a save']=T.byF(null,'newname').value==='';
    const n1=T.log.writes.length;
    T.set('newname','');await T.click(T.act('add'));
    o['masters add: an empty name is refused with no write']=T.log.writes.length===n1&&/needs a name/.test(T.flash());
    T.set('newname','ALAM');await T.click(T.act('add'));
    o['masters add: a duplicate (any case) is refused by name with no write']=T.log.writes.length===n1&&/already in the registry as Alam/.test(T.flash());
    // rename
    await T.click(T.act('rename',T.rowOf('data-master','CM-001')));
    o['masters rename: pressing Rename opens an inline edit with no write']=!!T.byF(null,'rename')&&T.log.writes.length===n1;
    T.set('rename','Hasan Khan');
    await T.click(T.act('save-edit'));
    o['masters rename: updates the name and keeps the old key as an alias']=T.store['cutting_masters/CM-001'].name==='Hasan Khan'&&J(T.store['cutting_masters/CM-001'].aliases)===J(['hassan']);
    o['masters rename: the edit box closes and the list shows the new name']=!T.byF(null,'rename')&&/Hasan Khan/.test(T.text(T.panel()));
    // retire needs a reason
    const n2=T.log.writes.length;
    await T.click(T.act('retire',T.rowOf('data-master','CM-002')));
    await T.click(T.act('save-edit'));
    o['masters retire: a blank reason is refused in the screen with no write']=T.log.writes.length===n2&&/reason is required to retire/.test(T.flash());
    T.set('reason','left the company');
    await T.click(T.act('save-edit'));
    o['masters retire: writes active:false, the reason and who/when; never a delete']=T.store['cutting_masters/CM-002'].active===false&&T.store['cutting_masters/CM-002'].retiredReason==='left the company'&&T.store['cutting_masters/CM-002'].retiredBy==='afnan'&&T.log.deletes===0;
    o['masters retire: a retired master is hidden until "Show retired" is ticked']=!T.rowOf('data-master','CM-002');
    T.check('showretired',true);
    o['masters retire: ticking Show retired lists it with a Retired chip and the reason']=!!T.rowOf('data-master','CM-002')&&/Retired/.test(T.text(T.rowOf('data-master','CM-002')))&&/left the company/.test(T.text(T.rowOf('data-master','CM-002')));
    await T.click(T.act('reactivate',T.rowOf('data-master','CM-002')));
    o['masters reactivate: active again, retirement fields cleared']=T.store['cutting_masters/CM-002'].active===true&&T.store['cutting_masters/CM-002'].retiredReason==='';
    o['masters: only the allowed collections were written, nothing deleted']=J(T.wroteRoots().filter(r=>ALLOWED_ROOTS.indexOf(r)<0))==='[]'&&T.log.deletes===0;
  }
  // seed: only when pressed, only what is missing
  {
    const T=mk('mustafa',{store:{},globals:FULLG()});
    await T.open('masters');
    o['seed: an empty register offers "Add Hassan / Alam" and writes nothing until it is pressed']=!!T.act('seed')&&/Add Hassan \/ Alam/.test(T.text(T.act('seed')))&&T.log.writes.length===0;
    o['seed: an empty register is said to be empty (read, and nothing in it)']=/read, and nothing is in it yet/.test(T.text(T.panel()));
    await T.click(T.act('seed'),80);
    o['seed: pressing it creates CM-001 Hassan and CM-002 Alam through the writer, in that order']=T.store['cutting_masters/CM-001']&&T.store['cutting_masters/CM-001'].name==='Hassan'&&T.store['cutting_masters/CM-002']&&T.store['cutting_masters/CM-002'].name==='Alam'&&T.store['ph_settings/counters'].cutting_masters===2;
    o['seed: afterwards the seed button is gone']=!T.act('seed');
    o['seed: a manager other than an owner (mustafa) can do it - managers write masters']=T.store['cutting_masters/CM-001'].createdBy==='mustafa';
    const P=mk('afnan',{store:{'cutting_masters/CM-001':MASTERS_BOTH['cutting_masters/CM-001'],'ph_settings/counters':{cutting_masters:1,updatedAt:1,updatedBy:'afnan'}},globals:FULLG()});
    await P.open('masters');
    o['seed: with Hassan present the button says only "Add Alam"']=/Add Alam$/.test(P.text(P.act('seed')));
    // an alias counts as present
    const Q=mk('afnan',{store:{'cutting_masters/CM-001':Object.assign({},MASTERS_BOTH['cutting_masters/CM-001'],{name:'Hasan Khan',nameKey:'hasan khan',aliases:['hassan']}),'cutting_masters/CM-002':MASTERS_BOTH['cutting_masters/CM-002'],'ph_settings/counters':{cutting_masters:2,updatedAt:1,updatedBy:'afnan'}},globals:FULLG()});
    await Q.open('masters');
    o['seed: a renamed master (old name kept as an alias) is not offered again']=!Q.act('seed');
  }
  // suggestions
  {
    const ZAH=Object.assign({},MASTERS_BOTH['cutting_masters/CM-001'],{id:'CM-003',name:'Zaheer',nameKey:'zaheer'});
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH,{'cutting_masters/CM-003':ZAH,'ph_settings/counters':{cutting_masters:3,updatedAt:1,updatedBy:'afnan'}}),globals:FULLG({allPasses:PASSES.concat([{gpType:'fabric',poId:'PO-010',cutMaster:'ZAHEER',ts:8}])})});
    await T.open('masters');
    const sug=T.dom.all(T.panel(),n=>n.getAttribute('data-suggest')!==null);
    o['suggestions: a name on two fabric issues and not in the register is offered with its count']=sug.length===1&&sug[0].getAttribute('data-suggest')==='bashir'&&/Bashir/.test(T.text(sug[0]))&&/on 2 fabric issues/.test(T.text(sug[0]));
    o['suggestions: a registered name in another case (ZAHEER / Zaheer) / a non-fabric pass is NOT offered']=!/NotFabric/.test(T.text(T.panel()))&&!/Zaheer/.test(T.text(sug[0]||T.panel()))&&sug.length===1;
    o['suggestions: rendering them wrote nothing (read-only data)']=T.log.writes.length===0;
    await T.click(T.act('suggest'),60);
    o['suggestions: "Add to register" adds exactly that master through the writer']=T.store['cutting_masters/CM-004']&&T.store['cutting_masters/CM-004'].name==='Bashir'&&T.log.tx===1;
    o['suggestions: once added it is no longer a suggestion']=T.dom.all(T.panel(),n=>n.getAttribute('data-suggest')!==null).length===0;
  }
  // failed read
  {
    const T=mk('afnan',{store:{},failPath:p=>p==='cutting_masters'?PERM():null,globals:FULLG()});
    await T.open('masters');
    const t=T.text(T.panel());
    o['failed read: the card names cutting_masters and says it is not an empty list']=/cutting_masters/.test(t)&&/not an empty list/.test(t);
    o['failed read: no list, no count, no add form, no seed button']=!/Register \(/.test(t)&&!T.act('add')&&!T.act('seed')&&!T.byF(null,'newname');
    o['failed read: a Retry button is offered']=T.dom.all(T.panel(),n=>n.tagName==='BUTTON'&&/Retry/.test(n.textContent)).length>=1;
    o['failed read: the log still draws (it needs the PO list, not the register) and says the register did not load']=/did not load/.test(t);
  }
  // XSS
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH,{'cutting_masters/CM-003':Object.assign({},MASTERS_BOTH['cutting_masters/CM-001'],{id:'CM-003',name:HOSTILE,nameKey:HOSTILE.toLowerCase()})}),
      globals:FULLG({allPasses:PASSES.concat([{gpType:'fabric',poId:'PO-009',cutMaster:'<script>x</script>',ts:9}])})});
    await T.open('masters');
    const h=T.html(T.panel());
    o['xss: a hostile master name and a hostile gate-pass name reach the page only as escaped text']=!/<img/i.test(h)&&!/<script/i.test(h)&&/&lt;img src=x onerror=alert\(1\)&gt;/.test(h)&&/&lt;script&gt;/.test(h);
  }

  /* ── the log: hand-computed fixture ── */
  {
    const env=(more)=>Object.assign({pos:POS,passes:PASSES,jobRows:[{fbKey:'PO-002',poId:'PO-002',masterName:'Alam'}],masters:[{id:'CM-001',name:'Hassan',aliases:[]},{id:'CM-002',name:'Alam',aliases:[]}],standards:[],settings:{}},more||{});
    const T=mk('afnan');
    T.ctx.__e=env();
    const M=(st,e)=>{T.ctx.__st=st;T.ctx.__e=e||env();return JSON.parse(JSON.stringify(T.R('phaMasterLogModel(__st,__e)')));};
    const oct=M({mode:'month',month:'2026-10',master:''});
    o['log model: October is ok with 4 POs (the cancelled PO, the PO with no cut and September are out)']=oct.state==='ok'&&oct.log.totals.jobs===4&&oct.range.from==='2026-10-01'&&oct.range.to==='2026-10-31';
    o['log model: daily October units are 130 (5 Oct), 60 (8 Oct), 10 (13 Oct)']=J(oct.log.daily.map(d=>[d.day,d.units,d.jobs]))===J([['2026-10-05',130,2],['2026-10-08',60,1],['2026-10-13',10,1]]);
    o['log model: October total is 200 units in 4 POs']=oct.log.totals.units===200;
    o['log model: weeks start Monday: 5 Oct week holds 190, 12 Oct week holds 10; both inside the month so neither is partial']=J(oct.log.weekly.map(w=>[w.weekStart,w.weekEnd,w.units,w.partial]))===J([['2026-10-05','2026-10-11',190,false],['2026-10-12','2026-10-18',10,false]]);
    o['log model: by master, most units first: Hassan 170 in 3 POs, Alam 30 in 1']=J(oct.summary.rows.map(r=>[r.name,r.units,r.jobs]))===J([['Hassan',170,3],['Alam',30,1]]);
    o['log model: a master name on a gate pass is resolved to the register spelling (hassan / " HASSAN " -> Hassan)']=oct.summary.rows.every(r=>r.registered===true);
    o['log model: the PO\'s cut job master (Alam) wins and PO-002 is Alam\'s 30']=oct.summary.rows.filter(r=>r.name==='Alam')[0].units===30;
    const al=M({mode:'month',month:'2026-10',master:'alam'});
    o['log model: filtering to Alam gives one day, 30 units']=al.log.state==='ok'&&J(al.log.daily.map(d=>[d.day,d.units]))===J([['2026-10-05',30]]);
    const wk=M({mode:'week',week:'2026-10-08',master:''});
    o['log model: week mode for any day in the week (Thu 8 Oct) is Mon 5 Oct to Sun 11 Oct = 190 units']=wk.range.from==='2026-10-05'&&wk.range.to==='2026-10-11'&&wk.log.totals.units===190&&wk.state==='ok';
    const sunWk=M({mode:'week',week:'2026-10-11',master:''});
    o['log model: Sunday 11 Oct belongs to the week that started Monday 5 Oct']=sunWk.range.from==='2026-10-05';
    const sep=M({mode:'month',month:'2026-09',master:''});
    o['log model: September holds the 30 Sept 23:30 PKT cut (25 units) by Bashir, who is not in the register']=sep.log.totals.units===25&&sep.summary.rows[0].name==='Bashir'&&sep.summary.rows[0].registered===false;
    const pkt=M({mode:'month',month:'2026-10',master:''}).log.daily.map(d=>d.day);
    o['log model: days are PKT (a 15:00 +05:00 cut stays on the same day)']=pkt.indexOf('2026-10-05')===0;
    const none=M({mode:'month',month:'2026-12',master:''});
    o['log model: a month with no cut is "noperiod", not a zero row']=none.state==='noperiod'&&none.summary.rows.length===0&&none.jobsTotal===5;
    const nodata=M({mode:'month',month:'2026-10',master:''},env({pos:[{fbKey:'PO-001',code:'GST073'}]}));
    o['log model: no PO has a recorded cut -> "nodata" (real data today)']=nodata.state==='nodata'&&nodata.jobsTotal===0&&nodata.log===null;
    const unl=M({mode:'month',month:'2026-10',master:''},env({pos:null}));
    o['log model: the PO list not loaded -> "unloaded"']=unl.state==='unloaded';
    o['log model: a bad month is "badrange"']=M({mode:'month',month:'2026-13',master:''}).state==='badrange'&&M({mode:'week',week:'nope',master:''}).state==='badrange';
    // a renamed master: old gate-pass names still resolve
    const ren=M({mode:'month',month:'2026-10',master:''},env({masters:[{id:'CM-001',name:'Hasan Khan',aliases:['hassan']},{id:'CM-002',name:'Alam',aliases:[]}]}));
    o['log model: a renamed master keeps its history (old name via the alias -> new name)']=ren.summary.rows[0].name==='Hasan Khan'&&ren.summary.rows[0].units===170;
    T.ctx.__e=env();
    const cj=JSON.parse(JSON.stringify(T.R('phaCutJobs(__e.pos,__e.passes,__e.jobRows,__e.masters).map(j=>[j.id,j.master])')));
    o['cut jobs: one per PO with a recorded cut, in PO order, master resolved (PO-006 cancelled stays in the list for the core to drop)']=J(cj.map(x=>x[0]))===J(['PO-001','PO-002','PO-003','PO-004','PO-006','PO-007'])&&cj.filter(x=>x[0]==='PO-001')[0][1]==='Hassan'&&cj.filter(x=>x[0]==='PO-007')[0][1]==='Bashir';
  }
  // the log on screen
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH,JOBROWS),globals:FULLG()});
    await T.open('masters');
    T.set('logmode','month','change');
    const m=T.byF(null,'logmonth');m.value='2026-10';T.dom.dispatch(m,'change');
    const t=T.text(T.panel());
    o['log screen: October shows the three daily rows, the total and the weekly rows']=/Mon 5 Oct 2026/.test(t)&&/Thu 8 Oct 2026/.test(t)&&/Tue 13 Oct 2026/.test(t)&&/Total/.test(t)&&/Mon 5 Oct 2026 to Sun 11 Oct 2026/.test(t);
    const daily=T.dom.all(T.panel(),n=>n.tagName==='TR'&&/Mon 5 Oct 2026$|^Mon 5 Oct 2026/.test(n.children[0]&&n.children[0].textContent||''))[0];
    o['log screen: the 5 Oct row reads 2 POs and 130 units']=!!daily&&daily.children[1].textContent==='2'&&daily.children[2].textContent==='130';
    o['log screen: it says days with no cut are left out, not shown as zero']=/left out, not shown as zero/.test(t);
    await T.click(T.act('prev'),20);
    o['log screen: the previous month shows September (Bashir, not in register)']=/Sep 2026/.test(T.text(T.panel()))&&/Bashir/.test(T.text(T.panel()))&&/Not in register/.test(T.text(T.panel()));
    o['log screen: reading the log wrote nothing']=T.log.writes.length===0;
    // week mode
    T.set('logmode','week','change');
    const w=T.byF(null,'logweek');w.value='2026-10-08';T.dom.dispatch(w,'change');
    o['log screen: week mode names the Monday-start week']=/week of Mon 5 Oct 2026/.test(T.text(T.panel()))&&/190/.test(T.text(T.panel()));
    // master filter
    T.set('logmode','month','change');
    const mm=T.byF(null,'logmonth');mm.value='2026-10';T.dom.dispatch(mm,'change');
    T.set('logmaster','alam','change');
    o['log screen: filtering by master shows that master only (Alam: 30)']=/Daily - Alam/.test(T.text(T.panel()))&&!/Daily - Hassan/.test(T.text(T.panel()));
  }
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:FULLG({allPOs:[{fbKey:'PO-001',code:'GST073'},{fbKey:'PO-002',code:'GST073'}]})});
    await T.open('masters');
    const t=T.text(T.panel());
    o['log screen: no recorded cut anywhere says "No data yet" and names how many POs were looked at']=/No data yet: none of the 2 purchase orders/.test(t);
    o['log screen: "No data yet" draws no table and no zero units']=T.dom.all(T.panel(),n=>n.tagName==='TABLE').length===0;
    const U=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:{}});
    await U.open('masters');
    o['log screen: a PO list that is not loaded says so, never a zero']=/No data yet: the purchase order list is not loaded/.test(U.text(U.panel()))&&U.dom.all(U.panel(),n=>n.tagName==='TABLE').length===0;
  }
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:FULLG({allPOs:POS.map(p=>Object.assign({},p,{cutAt:p.cutAt&&p.cutAt.replace('2026-10','2026-08').replace('2026-09','2026-08')}))})});
    await T.open('masters');
    o['log screen: cuts exist but not in the chosen month -> "No cut recorded in this period" (not a table of zeros)']=/No cut recorded in this period/.test(T.text(T.panel()))&&T.dom.all(T.panel(),n=>n.tagName==='TABLE').length===0;
  }

  /* ── Standards ── */
  {
    const store=Object.assign({},MASTERS_BOTH,{'ph_standards/GST073':STD(),'ph_standards/ZZ999':STD({code:'ZZ999',rev:1})});
    const T=mk('mustafa',{store,globals:FULLG()});
    await T.open('standards');
    const t=T.text(T.panel());
    o['standards: coverage reads "1 of 3 active articles have a standard" (retired and other-brand articles are not counted)']=/1 of 3 active articles have a standard/.test(t);
    o['standards: a saved standard whose code is no article is flagged']=/Not an article code/.test(t)&&/1 saved standard\(s\) are for a code that is not in the registry/.test(t);
    o['standards: a row shows the revision and the saved gross']=/Revision 2/.test(T.text(T.rowOf('data-code','GST073')))&&/0\.31 kg per piece/.test(T.text(T.rowOf('data-code','GST073')));
    o['standards: the article name is shown; a retired article without a standard is not offered']=/Effortless Tee/.test(t)&&!T.rowOf('data-code','GOLD01');
    o['standards: rendering wrote nothing']=T.log.writes.length===0;
    T.set('q','gd');
    o['standards: search filters the list by code or name']=!!T.rowOf('data-code','GD007')&&!T.rowOf('data-code','GST073');
    T.set('q','');T.set('filter','without','change');
    o['standards: "Without a standard" lists GD007 and GHW001 only']=!!T.rowOf('data-code','GD007')&&!!T.rowOf('data-code','GHW001')&&!T.rowOf('data-code','GST073');
    T.set('filter','with','change');
    o['standards: "With a standard" lists GST073 and the orphan']=!!T.rowOf('data-code','GST073')&&!!T.rowOf('data-code','ZZ999')&&!T.rowOf('data-code','GD007');
    T.set('filter','all','change');
    // set a new waist-size standard
    await T.click(T.act('edit',T.rowOf('data-code','GD007')),5);
    o['standards edit: GD007 (prefix GD) is guessed as Waist, with the reason shown']=T.byF(null,'model').value==='waist'&&/Guessed from the code prefix: Waist \(prefix match\)/.test(T.text(T.panel()));
    o['standards edit: the per-size boxes are the waist sizes 26 to 40']=['26','28','30','32','34','36','38','40'].every(k=>!!T.byF(null,'size-'+k))&&!T.byF(null,'size-XS');
    o['standards edit: nothing was written by opening the editor']=T.log.writes.length===0;
    T.set('unit','kg','change');T.set('gross','0.62');
    await T.click(T.act('save'));
    o['standards: a blank reason is refused in the screen, no write']=T.log.writes.length===0&&/reason is required/i.test(T.flash());
    T.set('reason','   ');await T.click(T.act('save'));
    o['standards: a whitespace reason is refused too']=T.log.writes.length===0;
    T.set('gross','abc');T.set('reason','sampled');await T.click(T.act('save'));
    o['standards: a gross that is not a number is refused, no write']=T.log.writes.length===0&&/Gross per piece must be a number above zero/.test(T.flash());
    T.set('gross','0');await T.click(T.act('save'));
    o['standards: a gross of zero is refused, no write']=T.log.writes.length===0;
    T.set('gross','0.62');T.set('tol','150');await T.click(T.act('save'));
    o['standards: a tolerance over 100 is refused, no write']=T.log.writes.length===0&&/Tolerance must be a percent/.test(T.flash());
    T.set('tol','');T.set('size-30','-1');await T.click(T.act('save'));
    o['standards: a negative per-size gross is refused naming the size, no write']=T.log.writes.length===0&&/Size 30/.test(T.flash());
    T.set('size-30','0.6');T.set('unit','','change');await T.click(T.act('save'));
    o['standards: no unit chosen is refused, no write']=T.log.writes.length===0&&/Choose the unit/.test(T.flash());
    T.set('unit','kg','change');
    await T.click(T.act('save'));
    const sv=T.store['ph_standards/GD007'];
    o['standards save: a NEW standard is created at revision 1 with the reason, the waist model and the per-size value']=!!sv&&sv.rev===1&&sv.reason==='sampled'&&sv.sizeModel==='waist'&&sv.unit==='kg'&&sv.grossPerPiece===0.62&&sv.sizes&&sv.sizes['30']===0.6&&sv.tolerancePct===null;
    o['standards save: only ph_standards was written, in one transaction']=J(T.wroteRoots())===J(['ph_standards'])&&T.log.tx===1;
    o['standards save: a message names the code and the revision; the editor closes; coverage becomes 2 of 3']=/Saved the standard of GD007 \(revision 1\)/.test(T.flash())&&!T.byF(null,'gross')&&/2 of 3 active articles have a standard/.test(T.text(T.panel()));
    // edit an existing one: revision counts
    await T.click(T.act('edit',T.rowOf('data-code','GST073')),5);
    o['standards edit: an existing standard opens prefilled (unit, gross, its stored model)']=T.byF(null,'unit').value==='kg'&&T.byF(null,'gross').value==='0.31'&&T.byF(null,'model').value==='alpha'&&/Currently revision 2\. Saving makes revision 3/.test(T.text(T.panel()));
    T.set('gross','0.33');T.set('tol','4');T.set('reason','re-weighed');
    await T.click(T.act('save'));
    const s2=T.store['ph_standards/GST073'];
    o['standards save: an existing standard goes to revision 3 with the new gross, tolerance and reason']=s2.rev===3&&s2.grossPerPiece===0.33&&s2.tolerancePct===4&&s2.reason==='re-weighed';
    // stale
    await T.click(T.act('edit',T.rowOf('data-code','GST073')),5);
    T.set('gross','0.40');T.set('reason','mine');
    T.store['ph_standards/GST073']=Object.assign({},T.store['ph_standards/GST073'],{rev:7,grossPerPiece:0.36});
    const before=J(T.store['ph_standards/GST073']);
    await T.click(T.act('save'));
    o['standards stale: a save over someone else\'s newer revision is refused and NOTHING is written']=J(T.store['ph_standards/GST073'])===before&&/changed by someone else \(revision 7/.test(T.flash());
    const rl=T.dom.all(T.panel(),n=>n.tagName==='BUTTON'&&/Reload the data/.test(n.textContent))[0];
    o['standards stale: the refusal offers a Reload the data button and says nothing of yours was saved']=!!rl&&/nothing of yours was saved/.test(T.text(T.panel()));
    await T.click(rl,80);
    o['standards stale: Reload re-reads, closes the editor and says the values are current']=/Reloaded\. These are the current values/.test(T.flash())&&!T.byF(null,'gross')&&/0\.36 kg per piece/.test(T.text(T.rowOf('data-code','GST073')))&&/Revision 7/.test(T.text(T.rowOf('data-code','GST073')));
    // override the model
    await T.click(T.act('edit',T.rowOf('data-code','GD007')),5);
    const gm=T.byF(null,'model');gm.value='alpha';T.dom.dispatch(gm,'change');
    o['standards edit: overriding the model swaps the size boxes, notes the override and warns about dropped per-size values']=!!T.byF(null,'size-XS')&&!T.byF(null,'size-30')&&/You have overridden it/.test(T.text(T.panel()))&&/will be dropped on save: 30/.test(T.text(T.panel()));
    T.set('reason','it is a tee after all');
    await T.click(T.act('save'));
    o['standards save: the overridden model is what is stored, and the dropped per-size value is gone']=T.store['ph_standards/GD007'].sizeModel==='alpha'&&T.store['ph_standards/GD007'].sizes===null&&T.store['ph_standards/GD007'].rev===2;
    o['standards: nothing but ph_standards written, nothing deleted']=J(T.wroteRoots())===J(['ph_standards'])&&T.log.deletes===0;
  }
  // double press
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:FULLG(),txDelay:20});
    await T.open('standards');
    await T.click(T.act('edit',T.rowOf('data-code','GST073')),5);
    T.set('unit','kg','change');T.set('gross','0.5');T.set('reason','r');
    const b=T.act('save');
    T.dom.click(b);T.dom.click(b);T.dom.click(b);
    await settle(150);
    o['one press = one write: pressing Save three times in a row starts ONE transaction']=T.log.txBegun===1&&T.writesTo('ph_standards/GST073').length===1;
  }
  {
    // one write at a time: while the add is in flight a different button (the seed) is ignored
    const T=mk('afnan',{store:{},globals:FULLG(),txDelay:30});
    await T.open('masters');
    T.set('newname','Zaheer');
    T.dom.click(T.act('add'));
    T.dom.click(T.act('seed'));
    await settle(200);
    o['one write at a time: a second action while one is in flight is ignored']=Object.keys(T.store).filter(k=>/^cutting_masters\//.test(k)).length===1&&T.store['cutting_masters/CM-001'].name==='Zaheer';
  }
  // failed standards read
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH),failPath:p=>p==='ph_standards'?PERM():null,globals:FULLG()});
    await T.open('standards');
    const t=T.text(T.panel());
    o['standards failed read: names ph_standards, says it is not an empty list']=/ph_standards/.test(t)&&/not an empty list/.test(t);
    o['standards failed read: no coverage figure, no list, no search box']=!/active articles have a standard/.test(t)&&!T.byF(null,'q')&&T.dom.all(T.panel(),n=>/\bpha-srow\b/.test(n.className)).length===0;
  }
  // failed / missing / empty article registry
  {
    const store=Object.assign({},MASTERS_BOTH,{'ph_standards/GST073':STD()});
    const F=mk('afnan',{store,globals:FULLG({_ptnLoadFailed:c=>c==='articles',tacArticles:[]})});
    await F.open('standards');
    const t=F.text(F.panel());
    o['article registry failed: coverage is "unavailable" and no "N of M" is printed (never 0 of 0)']=/Coverage is unavailable/.test(t)&&!/\d+ of \d+ active articles/.test(t);
    o['article registry failed: saved standards are still listed and editable']=!!F.rowOf('data-code','GST073')&&!!F.act('edit',F.rowOf('data-code','GST073'));
    o['article registry failed: a Retry is offered']=!!F.act('retry-articles');
    const E=mk('afnan',{store,globals:FULLG({tacArticles:[]})});
    await E.open('standards');
    o['article registry empty: says not seeded, no coverage number']=/empty \(not seeded yet\)/.test(E.text(E.panel()))&&!/\d+ of \d+ active articles/.test(E.text(E.panel()));
    const M=mk('afnan',{store,globals:{}});
    await M.open('standards');
    o['article registry unavailable (no patterns.js): says so, no coverage number']=/not available in this build/.test(M.text(M.panel()))&&!/\d+ of \d+ active articles/.test(M.text(M.panel()));
    // loading: the module asks the registry loader once
    let calls=0;
    const L=mk('afnan',{store,globals:FULLG({patternsLoaded:false,loadPatternsData:async()=>{calls++;L.ctx.patternsLoaded=true;}})});
    await L.open('standards');await settle(40);
    o['article registry not yet loaded: the tab asks for it ONCE and then shows the coverage']=calls===1&&/of 3 active articles have a standard/.test(L.text(L.panel()));
  }
  // XSS in standards
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH,{'ph_standards/GST073':STD({reason:HOSTILE})}),globals:FULLG({tacArticles:[{code:'GST073',name:HOSTILE,brand:'groovy',active:true}]})});
    await T.open('standards');
    const h=T.html(T.panel());
    o['xss: a hostile article name reaches the page only as escaped text']=!/<img/i.test(h)&&/&lt;img src=x onerror=alert\(1\)&gt;/.test(h);
  }
  // size model guess is pure core
  {
    const T=mk('afnan');
    o['size model guess: GD, GJO and GC prefixes are waist, a tee is alpha, GCO is alpha']=['GD007','GJO001','GC009'].every(c=>T.R('phSizeModel({code:'+J(c)+'}).model')==='waist')&&T.R('phSizeModel({code:"GST073"}).model')==='alpha'&&T.R('phSizeModel({code:"GCO001"}).model')==='alpha';
    T.ctx.__f={unit:'kg',gross:'0.5',tol:'',model:'waist',sizes:{'26':'0.4','XS':'9'},reason:'x'};
    const r=JSON.parse(JSON.stringify(T.R('phaStandardInput(__f)')));
    o['standard input: per-size values outside the chosen model are ignored, blank tolerance is null']=r.input&&J(r.input.sizes)===J({'26':0.4})&&r.input.tolerancePct===null&&r.input.sizeModel==='waist';
    T.ctx.__f.reason='';
    o['standard input: the reason is required (pure builder)']=/reason is required/.test(T.R('phaStandardInput(__f).error'));
  }

  /* ── Back to default (14 Oct 2026) and a master's kind ── */
  {
    const SAVED={'ph_settings/main':{dailyCapacity:450,delayTargetDays:5,stuckDays:20,grossOverTolPct:4.5,cutGate:[75,125],offWeekdays:[0,6],skipDays:['2026-10-31'],pcOnlyHard:true,rev:4,updatedAt:1,updatedBy:'afnan'}};
    const T=mk('mustafa',{store:Object.assign({},MASTERS_BOTH,JSON.parse(JSON.stringify(SAVED))),globals:FULLG()});
    await T.open('settings');
    o['clear: every saved value has a Back to default button; an unsaved one has none']=['dailyCapacity','delayTargetDays','stuckDays','grossOverTolPct','cutGate','offWeekdays','skipDays'].every(k=>!!T.act('clear-'+k))&&!T.act('clear-grossUnderTolPct');
    o['clear: the hard PC-only rule has NO clear button for a manager (an owner\'s switch)']=!T.act('clear-pcOnlyHard');
    o['clear: showing the buttons wrote nothing']=T.log.writes.length===0;
    await T.click(T.act('clear-dailyCapacity'));
    const d1=T.store['ph_settings/main'];
    o['clear: the capacity key is REMOVED from the document, the other values stay, the revision moves']=!('dailyCapacity' in d1)&&d1.grossOverTolPct===4.5&&J(d1.cutGate)===J([75,125])&&d1.rev===5&&d1.updatedBy==='mustafa';
    o['clear: the screen reads Default 400 again and says the capacity is back to its default']=/Default 400 - defaults, unconfirmed/.test(T.text(T.panel()))&&/back to its default \(revision 5\)/.test(T.flash());
    o['clear: written to ph_settings only, nothing deleted (the whole document is replaced)']=J(T.wroteRoots())===J(['ph_settings'])&&T.log.deletes===0&&T.log.writes.every(w=>w.path==='ph_settings/main');
    o['clear: the stale-looking pcOnlyHard the manager cannot clear is still stored']=d1.pcOnlyHard===true;
    // the pair goes together, from either button
    await T.click(T.act('clear-stuckDays'));
    const d2=T.store['ph_settings/main'];
    o['clear: the delay target and the stuck limit go back TOGETHER (pressing the stuck limit clears both)']=!('delayTargetDays' in d2)&&!('stuckDays' in d2)&&d2.rev===6&&d2.grossOverTolPct===4.5;
    await T.click(T.act('clear-cutGate'));await T.click(T.act('clear-offWeekdays'));await T.click(T.act('clear-skipDays'));
    const d3=T.store['ph_settings/main'];
    o['clear: the cut gate, the weekdays off and the skip days clear one by one']=!('cutGate' in d3)&&!('offWeekdays' in d3)&&!('skipDays' in d3)&&d3.rev===9&&d3.pcOnlyHard===true&&d3.grossOverTolPct===4.5;
    o['clear: the saved document still has only legal keys (rev, updatedAt, updatedBy, the values left)']=Object.keys(d3).every(k=>['dailyCapacity','skipDays','offWeekdays','delayTargetDays','stuckDays','grossOverTolPct','grossUnderTolPct','cutGate','pcOnlyHard','rev','updatedAt','updatedBy'].indexOf(k)>-1);
    // an owner can clear the hard PC-only rule
    const Ow=mk('afnan',{store:Object.assign({},MASTERS_BOTH,JSON.parse(JSON.stringify(SAVED))),globals:FULLG()});
    await Ow.open('settings');
    o['clear: an owner sees the PC-only clear button']=!!Ow.act('clear-pcOnlyHard');
    await Ow.click(Ow.act('clear-pcOnlyHard'));
    o['clear: the owner clears pcOnlyHard; it is gone from the document']=!('pcOnlyHard' in Ow.store['ph_settings/main'])&&Ow.store['ph_settings/main'].dailyCapacity===450;
    // a stale revision is refused and nothing is cleared
    const St=mk('mustafa',{store:Object.assign({},MASTERS_BOTH,JSON.parse(JSON.stringify(SAVED))),globals:FULLG()});
    await St.open('settings');
    St.store['ph_settings/main'].rev=9;   // someone else saved meanwhile
    await St.click(St.act('clear-dailyCapacity'));
    o['clear: a stale revision is refused, the value is NOT cleared']=St.store['ph_settings/main'].dailyCapacity===450&&St.store['ph_settings/main'].rev===9&&/changed by someone else/.test(St.flash());

    // master kind
    const M=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});
    await M.open('masters');
    const row=()=>M.rowOf('data-master','CM-001');
    await M.click(M.act('kind',row()));
    o['kind: Change kind opens an inline select on the current kind, no write yet']=!!M.byF(null,'kind')&&M.byF(null,'kind').value==='unset'&&M.log.writes.length===0;
    M.set('kind','outsource','change');
    await M.click(M.act('save-edit'));
    const mk1=M.store['cutting_masters/CM-001'];
    o['kind: saving writes kind only (name, key and aliases untouched) with who and when']=mk1.kind==='outsource'&&mk1.name==='Hassan'&&mk1.nameKey==='hassan'&&J(mk1.aliases)==='[]'&&mk1.updatedBy==='afnan'&&mk1.updatedAt>1;
    o['kind: written to cutting_masters only, nothing deleted, and the list shows Outsourced']=J(M.wroteRoots())===J(['cutting_masters'])&&M.log.deletes===0&&/Outsourced/.test(M.text(row()))&&/Hassan is now Outsourced/.test(M.flash());
    await M.click(M.act('kind',row()));
    M.set('kind','outsource','change');
    await M.click(M.act('save-edit'));
    o['kind: choosing the kind it already has is refused by name, nothing written']=/already outsource/.test(M.flash());
    const U=mk('mustafa',{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});
    await U.open('masters');
    await U.click(U.act('kind',U.rowOf('data-master','CM-002')));
    U.set('kind','unset','change');
    await U.click(U.act('save-edit'));
    o['kind: a manager (Mustafa) can set it back to Not set']=U.store['cutting_masters/CM-002'].kind==='unset';
  }

  /* ── Settings ── */
  {
    const T=mk('mustafa',{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});
    await T.open('settings');
    const t=T.text(T.panel());
    o['settings: with nothing saved every value is a default and the screen says the defaults are unconfirmed']=/Nothing has been saved yet: every value below is a default, and the defaults are unconfirmed/.test(t)&&/Default 400 - defaults, unconfirmed/.test(t)&&/Default 3 - defaults, unconfirmed/.test(t)&&/Default 7 - defaults, unconfirmed/.test(t)&&/Default 5 - defaults, unconfirmed/.test(t)&&/Default 70 to 130 - defaults, unconfirmed/.test(t);
    o['settings: the default values are filled in (400, 3, 7, 3, 5, 70, 130)']=['dailyCapacity','delayTargetDays','stuckDays','grossOverTolPct','grossUnderTolPct','gateLo','gateHi'].map(f=>T.byF(null,f).value).join()==='400,3,7,3,5,70,130';
    o['settings: the gate note says the PO cutting screen reads this value (WP1)']=/classic PO cutting screen reads this value/.test(t)&&!/does not read this/.test(t);
    o['settings: no weekday is off by default and there are no skip days']=[0,1,2,3,4,5,6].every(d=>T.byF(null,'off-'+d).checked===false)&&/No skip days/.test(t);
    o['settings: rendering wrote nothing']=T.log.writes.length===0;
    await T.click(T.act('save'));
    o['settings: pressing Save with nothing changed says so and writes nothing']=T.log.writes.length===0&&/Nothing has changed/.test(T.flash());
    T.set('dailyCapacity','450');
    await T.click(T.act('save'));
    const sv=T.store['ph_settings/main'];
    o['settings save: a first save creates revision 1 holding ONLY the changed field plus rev/updatedAt/updatedBy']=!!sv&&sv.rev===1&&sv.dailyCapacity===450&&J(Object.keys(sv).sort())===J(['dailyCapacity','rev','updatedAt','updatedBy'])&&sv.updatedBy==='mustafa';
    o['settings save: a message names what was saved and the revision']=/Settings saved \(revision 1\): dailyCapacity/.test(T.flash());
    o['settings save: afterwards that field reads "Saved" and the rest still read as defaults']=/Saved/.test(T.text(T.byF(null,'dailyCapacity').parentNode.parentNode))&&/Default 3 - defaults, unconfirmed/.test(T.text(T.panel()));
    o['settings save: written to ph_settings only, nothing deleted']=J(T.wroteRoots())===J(['ph_settings'])&&T.log.deletes===0;
    // second save: revision 2, adds a field, keeps the first
    T.set('grossOverTolPct','4.5');
    await T.click(T.act('save'));
    o['settings save: a second save is revision 2 and keeps the first field']=T.store['ph_settings/main'].rev===2&&T.store['ph_settings/main'].dailyCapacity===450&&T.store['ph_settings/main'].grossOverTolPct===4.5;
    // validation, each with no write
    const n=T.log.writes.length;
    const bad=async(f,v,re,label)=>{const prev=T.byF(null,f).value;T.set(f,v);await T.click(T.act('save'));const ok=T.log.writes.length===n&&re.test(T.flash());T.set(f,prev);return ok;};
    o['settings validation: capacity 0 and a fraction are refused']=await bad('dailyCapacity','0',/Daily capacity must be a whole number/)&&await bad('dailyCapacity','12.5',/Daily capacity must be a whole number/);
    o['settings validation: stuck at or below the delay target is refused']=await bad('stuckDays','3',/stuck limit must be above the delay target/);
    o['settings validation: a tolerance over 100 or negative is refused']=await bad('grossUnderTolPct','101',/percent from 0 to 100/)&&await bad('grossOverTolPct','-1',/percent from 0 to 100/);
    o['settings validation: a gate of 40 / 130 or 70 / 90 is refused']=await bad('gateLo','40',/cut gate needs a lower limit/)&&await bad('gateHi','90',/cut gate needs a lower limit/);
    // gate saved
    T.set('gateLo','75');T.set('gateHi','125');
    await T.click(T.act('save'));
    o['settings save: the cut gate is stored as a [lo, hi] pair (the managers may change it, the rules allow it)']=J(T.store['ph_settings/main'].cutGate)===J([75,125])&&T.store['ph_settings/main'].rev===3;
    // off weekdays
    T.check('off-0',true);T.check('off-6',true);
    await T.click(T.act('save'));
    o['settings save: weekdays off are stored as a sorted list of day numbers']=J(T.store['ph_settings/main'].offWeekdays)===J([0,6]);
    const nn=T.log.writes.length;
    [1,2,3,4,5].forEach(d=>T.check('off-'+d,true));
    await T.click(T.act('save'));
    o['settings validation: all seven weekdays off is refused, no write']=T.log.writes.length===nn&&/All seven weekdays cannot be off/.test(T.flash());
    // skip days: the form was rebuilt after a refusal? re-read values
    [1,2,3,4,5].forEach(d=>T.check('off-'+d,false));
    // skip days
    T.set('skipNew','not a day');
    await T.click(T.act('skip-add'));
    o['skip days: a value that is not a day is refused (nothing added)']=/Choose a real day/.test(T.flash())&&T.dom.all(T.panel(),n=>n.getAttribute('data-skip')!==null).length===0;
    T.set('skipNew','2026-02-30');
    await T.click(T.act('skip-add'));
    o['skip days: 30 February is refused']=T.dom.all(T.panel(),n=>n.getAttribute('data-skip')!==null).length===0;
    T.set('skipNew','2026-12-25');await T.click(T.act('skip-add'),5);
    T.set('skipNew','2026-10-20');await T.click(T.act('skip-add'),5);
    T.set('skipNew','2026-12-25');await T.click(T.act('skip-add'),5);
    const rows=T.dom.all(T.panel(),n=>n.getAttribute('data-skip')!==null).map(n=>n.getAttribute('data-skip'));
    o['skip days: added days are listed sorted, a repeat is not added twice']=J(rows)===J(['2026-10-20','2026-12-25']);
    o['skip days: adding does not write (nothing is saved until Save)']=T.store['ph_settings/main'].skipDays===undefined;
    await T.click(T.act('skip-remove',T.rowOf('data-skip','2026-10-20')),5);
    o['skip days: Remove drops it from the draft']=J(T.dom.all(T.panel(),n=>n.getAttribute('data-skip')!==null).map(n=>n.getAttribute('data-skip')))===J(['2026-12-25']);
    await T.click(T.act('save'));
    o['skip days: Save stores the list as PKT day strings']=J(T.store['ph_settings/main'].skipDays)===J(['2026-12-25'])&&J(T.store['ph_settings/main'].offWeekdays)===J([0,6]);
    // the skip day is labelled with its weekday
    o['skip days: a day is shown with its weekday (Fri 25 Dec 2026)']=/Fri 25 Dec 2026/.test(T.text(T.panel()));
  }
  // stale settings
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH,{'ph_settings/main':SETTINGS_SAVED()}),globals:FULLG()});
    await T.open('settings');
    o['settings: a saved document shows its revision, who saved it and when']=/Revision 3, last saved by afnan on /.test(T.text(T.panel()))&&T.byF(null,'dailyCapacity').value==='420';
    T.set('dailyCapacity','500');
    T.store['ph_settings/main']=Object.assign({},T.store['ph_settings/main'],{rev:4,dailyCapacity:430});
    const before=J(T.store['ph_settings/main']);
    await T.click(T.act('save'));
    o['settings stale: a save over a newer revision is refused and NOTHING is written']=J(T.store['ph_settings/main'])===before&&/changed by someone else \(revision 4/.test(T.flash());
    const rl=T.dom.all(T.panel(),n=>n.tagName==='BUTTON'&&/Reload the data/.test(n.textContent))[0];
    o['settings stale: a Reload the data button is offered']=!!rl;
    await T.click(rl,80);
    o['settings stale: Reload shows the newer values (430, revision 4) and drops the unsaved draft']=T.byF(null,'dailyCapacity').value==='430'&&/Revision 4/.test(T.text(T.panel()))&&/Reloaded/.test(T.flash());
    T.set('dailyCapacity','440');
    await T.click(T.act('save'));
    o['settings stale: after the reload the same change saves cleanly as revision 5']=T.store['ph_settings/main'].rev===5&&T.store['ph_settings/main'].dailyCapacity===440;
  }
  {
    // the document was created by someone else after this screen loaded (it showed "nothing saved")
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});
    await T.open('settings');
    T.set('dailyCapacity','500');
    T.store['ph_settings/main']={dailyCapacity:410,rev:1,updatedAt:1,updatedBy:'ammar'};
    await T.click(T.act('save'));
    o['settings stale: a document created by someone else while this screen showed "nothing saved" is also refused (expected revision 0)']=T.store['ph_settings/main'].dailyCapacity===410&&T.store['ph_settings/main'].rev===1&&/changed by someone else/.test(T.flash());
  }
  // failed settings read
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH),failPath:p=>p==='ph_settings/main'?PERM():null,globals:FULLG()});
    await T.open('settings');
    const t=T.text(T.panel());
    o['settings failed read: names ph_settings, no form, no Save, no defaults shown as if they were saved']=/ph_settings/.test(t)&&!T.act('save')&&!T.byF(null,'dailyCapacity')&&/not an empty list/.test(t);
  }
  // pcOnlyHard: an owner's switch
  {
    const M=mk('mustafa',{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});
    await M.open('settings');
    const cb=M.byF(null,'pcOnlyHard');
    o['pcOnlyHard: Mustafa sees the switch DISABLED with the reason']=!!cb&&cb.getAttribute('disabled')!==null&&/Only an owner \(Afnan or Ammar\) can change this/.test(M.text(M.panel()));
    for(const u of ['afnan','ammar']){
      const O=mk(u,{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});await O.open('settings');
      const c=O.byF(null,'pcOnlyHard');
      o['pcOnlyHard: '+u+' (an owner) sees it enabled, no restriction note']=c.getAttribute('disabled')===null&&!/Only an owner \(Afnan or Ammar\) can change this/.test(O.text(O.panel()));
    }
    const O=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});await O.open('settings');
    O.check('pcOnlyHard',true);
    await O.click(O.act('save'));
    o['pcOnlyHard: an owner can switch it on; only that field (+meta) is written']=O.store['ph_settings/main'].pcOnlyHard===true&&J(Object.keys(O.store['ph_settings/main']).sort())===J(['pcOnlyHard','rev','updatedAt','updatedBy']);
    // forced by a manager: the writer refuses
    M.check('pcOnlyHard',true);
    const txBefore=M.log.txBegun;
    await M.click(M.act('save'));
    o['pcOnlyHard: if Mustafa forces the box the WRITER refuses (forbidden), no transaction starts, nothing is stored']=M.log.txBegun===txBefore&&!M.store['ph_settings/main']&&/Only an owner can switch the hard PC-only rule/.test(M.flash());
    // mustafa saving something else must not change an owner's pcOnlyHard
    const M2=mk('mustafa',{store:Object.assign({},MASTERS_BOTH,{'ph_settings/main':{dailyCapacity:400,pcOnlyHard:true,rev:1,updatedAt:1,updatedBy:'afnan'}}),globals:FULLG()});
    await M2.open('settings');
    o['pcOnlyHard: an owner\'s ON shows ticked (and disabled) for Mustafa']=M2.byF(null,'pcOnlyHard').checked===true&&M2.byF(null,'pcOnlyHard').getAttribute('disabled')!==null;
    M2.set('stuckDays','9');
    await M2.click(M2.act('save'));
    o['pcOnlyHard: Mustafa saving another setting keeps the owner\'s pcOnlyHard=true']=M2.store['ph_settings/main'].pcOnlyHard===true&&M2.store['ph_settings/main'].stuckDays===9&&M2.store['ph_settings/main'].rev===2;
    o['settings: changing only the stuck limit stores the PAIR (the core judges stuck against the target, so the writer needs both)']=M2.store['ph_settings/main'].delayTargetDays===3&&J(Object.keys(M2.store['ph_settings/main']).sort())===J(['delayTargetDays','dailyCapacity','pcOnlyHard','rev','stuckDays','updatedAt','updatedBy'].sort());
    // the writer itself, as uzaib
    const U=mk('uzaib',{store:Object.assign({},MASTERS_BOTH),globals:FULLG()});
    const r=await U.ctx.phSettingsSave({dailyCapacity:500},{});
    o['writers: uzaib cannot save settings (forbidden), no write']=r.ok===false&&r.code==='forbidden'&&U.log.writes.length===0;
  }
  // offline
  {
    const T=mk('afnan',{store:Object.assign({},MASTERS_BOTH),globals:FULLG(),offline:true});
    await T.open('settings');
    T.set('dailyCapacity','500');
    await T.click(T.act('save'));
    o['offline: a save is refused out loud (a transaction cannot be queued), nothing written']=T.log.writes.length===0&&/No connection/.test(T.flash());
  }
  return o;
}

/* ── the wiring in the other files and the stylesheet ── */
function wiring(s){
  const IDX=read('index.html'),SW=read('sw.js');
  s.section('wiring: script tag, precache, stylesheet block');
  const lines=IDX.split('\n');
  const iUi=lines.findIndex(l=>/\/js\/ph-ui\.js/.test(l)),iAd=lines.findIndex(l=>/\/js\/ph-mod-admin\.js/.test(l));
  s.ok('index.html has ONE script tag for js/ph-mod-admin.js, after the ph-ui.js tag',lines.filter(l=>/ph-mod-admin\.js/.test(l)).length===1&&iUi>-1&&iAd>iUi&&/^<script src="\/js\/ph-mod-admin\.js\?v=[0-9a-z]+"><\/script>$/.test(lines[iAd]));
  s.ok('sw.js precaches /js/ph-mod-admin.js exactly once, after /js/ph-ui.js',(SW.match(/'\/js\/ph-mod-admin\.js'/g)||[]).length===1&&SW.indexOf("'/js/ph-mod-admin.js'")>SW.indexOf("'/js/ph-ui.js'"));
  const a=CSS.indexOf('/* ph-mod-admin START */'),b=CSS.indexOf('/* ph-mod-admin END */');
  s.ok('css/main.css carries ONE delimited ph-mod-admin block in the trailing run of ph-mod-* blocks at the end of the file',a>0&&b>a&&CSS.split('/* ph-mod-admin START */').length===2&&CSS.slice(b+'/* ph-mod-admin END */'.length).replace(/\/\* ph-mod-[a-z]+ START \*\/[\s\S]*?\/\* ph-mod-[a-z]+ END \*\//g,'').trim()==='');
  const blk=CSS.slice(a,b).replace(/\/\*[\s\S]*?\*\//g,'');
  s.ok('every selector in the block is .pha- prefixed',(blk.match(/[^{}]+(?=\{)/g)||[]).filter(x=>!/^\s*@media/.test(x)).every(x=>x.split(',').every(p=>/\.pha-/.test(p))));
  s.ok('tokens only: no literal colour in the block',!/#[0-9a-fA-F]{3,8}\b/.test(blk)&&!/\b(?:rgb|rgba|hsl|hsla)\(/.test(blk));
  s.ok('text sizes: nothing under 12px in the block',!/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/.test(blk));
  s.ok('touch targets: buttons, inputs and check rows are 44px',/\.pha-btn\{min-height:44px\}/.test(blk)&&/\.pha-in\{[^}]*min-height:44px/.test(blk)&&/\.pha-check\{[^}]*min-height:44px/.test(blk));
  s.ok('a focus ring is drawn on the inputs',/\.pha-in:focus-visible\{outline:2px solid var\(--text\)/.test(blk));
  s.ok('the phone breakpoint stacks the grids',/@media \(max-width:600px\)\{[^]*\.pha-grid\{grid-template-columns:1fr\}/.test(blk));
  s.ok('the block uses --accent-success-soft / --surface-2 / --border tokens that exist in :root',['--accent-success-soft','--surface-2','--border','--soft','--muted','--text'].every(t=>new RegExp(t+':').test(CSS)));
  s.section('source scans');
  const code=SRC.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  s.ok('nothing parses a string as HTML (no innerHTML / outerHTML / insertAdjacentHTML / DOMParser / document.write)',!/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|document\.write/.test(code));
  s.ok('no Firestore write API is called from this file (writes go through js/ph-write.js)',!/\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(code));
  s.ok('it calls the five writers',['phMasterAdd(','phMasterRename(','phMasterSetActive(','phStandardSave(','phSettingsSave('].every(w=>code.indexOf(w)>-1));
  s.ok('it never reads or writes a collection by name (no collection()/doc() calls)',!/\bcollection\s*\(|\bdoc\s*\(/.test(code));
  s.ok('days come from the core (no toISOString, no local Date for days)',!/toISOString|getFullYear|getMonth\(|toLocaleDateString/.test(code));
  s.ok('every top-level name is ph / _ph / PH_ prefixed',(code.match(/^(?:function\s+|const\s+|let\s+)([A-Za-z0-9_$]+)/gm)||[]).every(m=>/(?:function|const|let)\s+(?:ph|_ph|PH)/.test(m)));
  s.ok('it does not touch the shell, the core, the data layer or the writers (no edits by name)',!/PH_TABS\.push|PH_TABS\.splice|_phData\s*=|_phLoad\s*=/.test(code));
  s.ok('stored text only reaches the page through textContent or value (phEl text argument)',(code.match(/\.textContent\s*=/g)||[]).length<=2);
  // the three Master Accounts style lists: every key the screen sends exists in the writer's list
  s.ok('every setting the screen can send is one the writer accepts',['dailyCapacity','delayTargetDays','stuckDays','grossOverTolPct','grossUnderTolPct','cutGate','offWeekdays','skipDays','pcOnlyHard'].every(k=>read('js/ph-write.js').indexOf("'"+k+"'")>-1)&&/PH_SETTINGS_VALUE_FIELDS=Object\.freeze\(\['dailyCapacity','skipDays','offWeekdays','delayTargetDays','stuckDays','grossOverTolPct','grossUnderTolPct','cutGate','pcOnlyHard'\]\)/.test(read('js/ph-write.js')));
}

module.exports=async function(){
  const s=suite('ph-mod-admin');
  const base=await checks(SRC);
  s.section('production ops admin tabs');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  wiring(s);

  s.section('deliberate breaks - each must fail the named check');
  let broken=0;
  // The breaks are independent (each loads its own apps in its own vm contexts), so they run in a small pool; the results are emitted in order.
  const queue=[];
  const brk=(label,from,to,failing,srcOverride)=>{
    queue.push(async()=>{
      const pairs=Array.isArray(from)?from:[[from,to]];
      let mut=srcOverride||SRC;
      for(const [f,t] of pairs){
        if(mut.split(f).length-1<1)return[['break target exists: '+label+' ('+String(f).slice(0,50)+')',false]];
        mut=mut.split(f).join(t);
      }
      let r;try{r=await checks(mut);}catch(e){r={};failing.forEach(f=>r[f]=false);}
      return failing.map(f=>['break "'+label+'" fails "'+f+'"',r[f]!==true]);
    });
  };
  brk('manager guard ignored','if(ctx.canManage&&typeof phCanManage===\'function\'&&phCanManage(ctx.user))return true;','if(true)return true;',['guard: the masters render refuses a ctx that is not a manager (no controls, no data)','guard: a ctx claiming canManage for uzaib still refuses (the audience list decides)']);
  brk('standard reason not required',"if(!reason)return{error:'A reason is required: say why this standard is being set or changed.'};",'',['standards: a blank reason is refused in the screen, no write','standards: a whitespace reason is refused too','standard input: the reason is required (pure builder)']);
  brk('standards: revision not sent','phStandardSave(f.code,built.input,{expectedRev:f.rev})','phStandardSave(f.code,built.input,{})',["standards stale: a save over someone else's newer revision is refused and NOTHING is written"]);
  brk('settings: revision not sent','phSettingsSave(built.patch,{expectedRev:_phaT.rev})','phSettingsSave(built.patch,{})',['settings stale: a save over a newer revision is refused and NOTHING is written','settings stale: a document created by someone else while this screen showed "nothing saved" is also refused (expected revision 0)']);
  brk('settings: a missing document is treated as "no revision to check"',"_phaT.rev=typeof raw.rev==='number'?raw.rev:0;","_phaT.rev=typeof raw.rev==='number'?raw.rev:undefined;",['settings stale: a document created by someone else while this screen showed "nothing saved" is also refused (expected revision 0)']);
  brk('pcOnlyHard enabled for everyone',"const isOwner=typeof phIsOwner==='function'&&phIsOwner(ctx.user);","const isOwner=true;",['pcOnlyHard: Mustafa sees the switch DISABLED with the reason']);
  brk('the owner-only note dropped',"if(!isOwner)pc.appendChild(phEl('p','ph-note pha-reason','Only an owner (Afnan or Ammar) can change this. The database rules enforce it, so it cannot be changed from here.'));",'',['pcOnlyHard: Mustafa sees the switch DISABLED with the reason']);
  brk('pcOnlyHard dropped from a manager\'s patch before the writer sees it',"if(!!f.pcOnlyHard!==!!current.pcOnlyHard)patch.pcOnlyHard=!!f.pcOnlyHard;","if(!!f.pcOnlyHard!==!!current.pcOnlyHard&&current.owner)patch.pcOnlyHard=!!f.pcOnlyHard;",['pcOnlyHard: an owner can switch it on; only that field (+meta) is written']);
  brk('every field sent, not only the changed ones',"if(cap.n!==S.dailyCapacity)patch.dailyCapacity=cap.n;","patch.dailyCapacity=cap.n;",['settings save: a first save creates revision 1 holding ONLY the changed field plus rev/updatedAt/updatedBy','settings: pressing Save with nothing changed says so and writes nothing']);
  brk('rendering the seed writes it automatically',"const box=phEl('div','pha-seed');","if(!window.__seeded){window.__seeded=1;phMasterAdd(missing[0],{kind:'unset'});}const box=phEl('div','pha-seed');",['seed: an empty register offers "Add Hassan / Alam" and writes nothing until it is pressed']);
  brk('failed register read falls through as an empty list',"if(!g.ok)return _phaFailCard(ctx,'masters','Cutting masters could not be read');","if(!g.ok)g.rows=[];",['failed read: the card names cutting_masters and says it is not an empty list','failed read: no list, no count, no add form, no seed button']);
  brk('failed settings read falls through to defaults',"if(!gs.ok){host.appendChild(_phaFailCard(ctx,'settings','Production Ops settings could not be read'));return;}","",['settings failed read: names ph_settings, no form, no Save, no defaults shown as if they were saved']);
  brk('failed standards read falls through',"if(!g.ok){host.appendChild(_phaFailCard(ctx,'standards','Consumption standards could not be read'));return;}","",['standards failed read: names ph_standards, says it is not an empty list']);
  brk('a failed article registry still counts coverage',"if(typeof _ptnLoadFailed==='function'&&_ptnLoadFailed('articles'))return{state:'failed',list:null};","",['article registry failed: coverage is "unavailable" and no "N of M" is printed (never 0 of 0)']);
  brk('"no data yet" drawn as a table',"if(!out.jobsTotal){out.state='nodata';return out;}","",['log model: no PO has a recorded cut -> "nodata" (real data today)','log screen: no recorded cut anywhere says "No data yet" and names how many POs were looked at']);
  brk('weeks start on the day given, not Monday',"const ws=phWeekStart(day);\n  return{from:ws,","const ws=day;\n  return{from:ws,",['log model: week mode for any day in the week (Thu 8 Oct) is Mon 5 Oct to Sun 11 Oct = 190 units','log model: Sunday 11 Oct belongs to the week that started Monday 5 Oct']);
  brk('month ends a day early',"const y=Number(m.slice(0,4)),mo=Number(m.slice(5,7)),dim=new Date(Date.UTC(y,mo,0)).getUTCDate();","const y=Number(m.slice(0,4)),mo=Number(m.slice(5,7)),dim=new Date(Date.UTC(y,mo,0)).getUTCDate()-1;",['log model: October is ok with 4 POs (the cancelled PO, the PO with no cut and September are out)']);
  brk('a cancelled PO is counted (neither the job flag nor the PO list reaches the core)',[["cutUnits:units,\n      articleCode:po.code!=null?po.code:po.articleCode,sizeModel:po.sizeModel,sizeAxis:po.sizeAxis,poStatus:po.poStatus}","cutUnits:units,\n      articleCode:po.code!=null?po.code:po.articleCode,sizeModel:po.sizeModel,sizeAxis:po.sizeAxis}"],["const opts={standards:stdMap,settings:env.settings||{},pos:env.pos};","const opts={standards:stdMap,settings:env.settings||{}};"]],null,['log model: October is ok with 4 POs (the cancelled PO, the PO with no cut and September are out)','log model: October total is 200 units in 4 POs']);
  brk('aliases not followed (a renamed master loses its history)',"reg.forEach(function(m){if(m&&m.name&&Array.isArray(m.aliases)){","reg.forEach(function(m){if(false){",['log model: a renamed master keeps its history (old name via the alias -> new name)']);
  brk('the cut job master no longer wins over the gate pass',"const raw=jobMaster[_phaPoKey(id)]||passMaster[_phaPoKey(id)]||'';","const raw=passMaster[_phaPoKey(id)]||jobMaster[_phaPoKey(id)]||'';",["log model: the PO's cut job master (Alam) wins and PO-002 is Alam's 30"]);
  brk('registered names offered as suggestions',[["if(m.name)known.add(phMasterKey(m.name));",""],["if(m.nameKey)known.add(String(m.nameKey));",""]],null,['suggestions: a name on two fabric issues and not in the register is offered with its count','suggestions: a registered name in another case (ZAHEER / Zaheer) / a non-fabric pass is NOT offered']);
  brk('non-fabric gate passes counted as suggestions',"if(!g||g.gpType!=='fabric')return;\n    const n=phNorm(g.cutMaster),k=phMasterKey(n);","if(!g)return;\n    const n=phNorm(g.cutMaster),k=phMasterKey(n);",['suggestions: a registered name in another case (ZAHEER / Zaheer) / a non-fabric pass is NOT offered']);
  brk('a retire without a reason goes to the writer',"if(ed.kind==='retire'&&!text.trim()){_phaFlash={tab:'masters',kind:'bad',text:'A reason is required to retire a master.'};ctx.repaint();return;}","",['masters retire: a blank reason is refused in the screen with no write']);
  brk('busy flag dropped (a second, different button runs while a write is in flight)',"if(_phaBusy)return Promise.resolve(null);\n  _phaBusy=true;","_phaBusy=true;",['one write at a time: a second action while one is in flight is ignored']);
  brk('both double-press guards dropped',[["if(_phaBusy)return Promise.resolve(null);\n  _phaBusy=true;","_phaBusy=true;"],["if(btn){try{btn.setAttribute('disabled','');btn.textContent='Saving...';}catch(e){}}",""],["if(b.getAttribute('disabled')!==null)return;",""]],null,['one press = one write: pressing Save three times in a row starts ONE transaction']);
  brk('skip day not validated',"if(!phIsDay(d)){_phaFlash={tab:'settings',kind:'bad',text:'Choose a real day, year-month-day.'};ctx.repaint();return;}","",['skip days: a value that is not a day is refused (nothing added)','skip days: 30 February is refused']);
  brk('skip days not deduplicated',"if(f.skip.indexOf(d)<0)f.skip=f.skip.concat([d]).sort();","f.skip=f.skip.concat([d]).sort();",['skip days: added days are listed sorted, a repeat is not added twice']);
  brk('stale refusal loses its Reload button',"stale:r.code==='stale'","stale:false",['standards stale: the refusal offers a Reload the data button and says nothing of yours was saved','settings stale: a Reload the data button is offered']);
  brk('the size model guess ignored',"const guess=_phaGuessModel(code);\n  const model=std&&std.sizeModel&&Object.prototype.hasOwnProperty.call(PH_SIZE_MODELS,std.sizeModel)?std.sizeModel:guess.model;","const guess=_phaGuessModel(code);\n  const model='alpha';",['standards edit: GD007 (prefix GD) is guessed as Waist, with the reason shown']);
  brk('coverage counts retired and other-brand articles',"function _phaIsActiveGroovy(a){return a&&a.active!==false&&(a.brand===undefined||a.brand===null||a.brand==='groovy');}","function _phaIsActiveGroovy(a){return !!a;}",['standards: coverage reads "1 of 3 active articles have a standard" (retired and other-brand articles are not counted)']);
  brk('Back to default sends 0, not null',"const patch={};keys.forEach(function(k){patch[k]=null;});","const patch={};keys.forEach(function(k){patch[k]=0;});",['clear: the capacity key is REMOVED from the document, the other values stay, the revision moves']);
  brk('the pair is cleared one at a time',"const cb=clearBtn(pair?CLEAR_PAIR.slice():[k],pair","const cb=clearBtn([k],pair",['clear: the delay target and the stuck limit go back TOGETHER (pressing the stuck limit clears both)']);
  brk('a manager gets the PC-only clear button',"if(!keys.every(function(k){return k!=='pcOnlyHard'||isOwner;}))return null;","",['clear: the hard PC-only rule has NO clear button for a manager (an owner\'s switch)']);
  brk('the clear ignores the revision',"return phSettingsSave(patch,{expectedRev:_phaT.rev});},\n        function(r){_phaT.form=null;_phaT.sig=null;return label","return phSettingsSave(patch,{});},\n        function(r){_phaT.form=null;_phaT.sig=null;return label",['clear: a stale revision is refused, the value is NOT cleared']);
  brk('Save kind always saves the old kind',"return phMasterSetKind(r.fbKey,k);","return phMasterSetKind(r.fbKey,r.kind||'unset');",['kind: saving writes kind only (name, key and aliases untouched) with who and when']);
  brk('the kind select does not follow the pick',"_phaBind(ksel,ed,'text');","",['kind: saving writes kind only (name, key and aliases untouched) with who and when']);
  const results=new Array(queue.length);let next=0;
  const worker=async()=>{while(next<queue.length){const i=next++;results[i]=await queue[i]();}};
  await Promise.all([worker(),worker(),worker(),worker(),worker()]);
  results.forEach(rs=>rs.forEach(r=>{broken++;s.ok(r[0],r[1]);}));
  s.ok('breaks counted (at least 30)',broken>=30);
  // the source-scan breaks are checked against the scan expressions directly (they live in wiring(), not checks())
  s.section('source-scan breaks');
  const scan=(mut)=>{const code=mut.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');return{
    html:!/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|document\.write/.test(code),
    write:!/\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(code),
    prefix:(code.match(/^(?:function\s+|const\s+|let\s+)([A-Za-z0-9_$]+)/gm)||[]).every(m=>/(?:function|const|let)\s+(?:ph|_ph|PH)/.test(m))};};
  s.ok('the clean source passes all three scans',scan(SRC).html&&scan(SRC).write&&scan(SRC).prefix);
  s.ok('an innerHTML use fails the HTML scan',scan(SRC.replace("function _phaChip(text,cls){return phEl(","function _phaChip(text,cls){document.body.innerHTML=text;return phEl(")).html===false);
  s.ok('a direct write fails the write scan',scan(SRC.replace("function _phaToday(){return phDay(Date.now());}","function _phaToday(){setDoc(doc(db,'x','y'),{});return phDay(Date.now());}")).write===false);
  s.ok('an unprefixed name fails the prefix scan',scan(SRC.replace("const PHA_ROWS_SHOWN=60;","const PHA_ROWS_SHOWN=60;\nconst shown=1;")).prefix===false);
  return s;
};

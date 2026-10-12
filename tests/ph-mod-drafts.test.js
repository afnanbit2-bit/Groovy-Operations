/* Production Ops module "PO Drafts" (12 Oct 2026): js/ph-mod-drafts.js and its wiring in index.html, sw.js, css/main.css.

   What this drives (the REAL handlers: the real js/ph-core.js, js/ph-data.js, js/ph-write.js and js/ph-mod-drafts.js over tests/ph-dom.js's
   small real DOM and an in-memory Firestore with real transaction semantics, which RECORDS every write):
     · the list: drafts by status, a completeness chip per row, honest states (a failed po_drafts read is named and is never "no drafts";
       Retry re-reads only po_drafts; an unread master registry reads "not checked")
     · the form: typing, the live completeness panel, one save = one transaction on po_drafts, the stale-revision refusal, parse problems named
     · the COMPLETENESS GATE: Mark ready is refused with the missing fields named, BEFORE anything is written; a complete draft saves then readies
     · PC-ONLY: a PC edits; off a PC the form is read-only; soft rule = warning + explicit override; hard rule (or an unread setting) = no override and
       no writer is ever called, even if the handler is invoked directly
     · NO ISSUING: every recorded write is to po_drafts; no `pos` write, no PDF; "Issue as PO (later wave)" is disabled
     · send back (managers only), abandon (reason required), audience (off the audience: nothing, no write)
     · XSS: stored text only ever reaches textContent / value; the source never parses a string as HTML
     · wiring: script tag after ph-ui.js, one precache entry, the stylesheet block (tokens only, 44px targets)
   What it does NOT prove: geometry (the harness has no layout; tests/smoke-layout.js's "production ops — po draft form" holds that in real
   Chromium), real Firestore / the rules (tests/rules-emulator-ph.js holds the writers' rules), a real screen or phone, or the userAgent of a
   real device (phIsPcOnly is a heuristic). Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-drafts.js');
const CSS=read('css/main.css');
const J=JSON.stringify;
const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
const WIN='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store'},
  claude:{uid:'u-claude',u:'claude',name:'Claude',role:'qa'}
};
const T0=1790000000000;
const GOOD={code:'GST073',name:'Effortless Tee',pattern:'P-12',qty:100,sizes:{S:50,M:50},ratio:'1:1',fabric:'Jersey 180',fabricCode:'JER180',store:'Main store',totalRoll:'6',
  plannedFabricQty:30,plannedFabricUnit:'kg',season:'winter',plannedCutDate:'2026-10-20',requestedDate:'2026-10-25',cutMasterId:'CM-001',cutMaster:'Hassan',
  embellishment:{required:true},jobCopies:{embroidery:true,printing:false,washing:false},notes:'Handle with care'};
const draftDoc=(id,status,po,extra)=>Object.assign({id,status,rev:1,entryDevice:'pc',createdBy:'afnan',createdByName:'Afnan',createdAt:T0,updatedAt:T0,updatedBy:'afnan',po},extra||{});
const master=(id,name,active)=>({id,name,nameKey:name.toLowerCase(),kind:'inhouse',active:active!==false,aliases:[],notes:'',createdAt:T0,createdBy:'afnan',createdByName:'Afnan',updatedAt:T0,updatedBy:'afnan',retiredAt:null,retiredBy:null,retiredReason:''});
const SEED=()=>({
  'cutting_masters/CM-001':master('CM-001','Hassan'),'cutting_masters/CM-002':master('CM-002','Alam'),'cutting_masters/CM-003':master('CM-003','Retired Rao',false),
  'po_drafts/DRAFT-K1-AAAA':draftDoc('DRAFT-K1-AAAA','draft',GOOD,{updatedAt:T0+3000}),
  'po_drafts/DRAFT-K1-BBBB':draftDoc('DRAFT-K1-BBBB','draft',{code:'GH001',name:'Black Hoodie',qty:50,sizes:{M:50},fabric:'Fleece'},{updatedAt:T0+4000}),
  'po_drafts/DRAFT-K1-CCCC':draftDoc('DRAFT-K1-CCCC','ready',GOOD,{updatedAt:T0+2000,readyAt:T0+2000,readyBy:'afnan'}),
  'po_drafts/DRAFT-K1-DDDD':draftDoc('DRAFT-K1-DDDD','abandoned',{code:'GB001',name:'Old'},{updatedAt:T0+1000,abandonedReason:'duplicate'}),
  'ph_standards/GST073':{code:'GST073',unit:'kg',grossPerPiece:0.3,tolerancePct:3,sizes:null,sizeModel:null,rev:1,createdAt:T0,createdBy:'afnan',createdByName:'Afnan',updatedAt:T0,updatedBy:'afnan'}
});
const CATALOG=[{code:'GH001',name:'Black Hoodie'},{code:'GST073',name:'Effortless Tee'},{code:'GD007',name:'Straight Denim'},{code:'GX9',name:'<img src=x onerror=alert(1)> Hostile'}];

/* ── a small in-memory Firestore with transaction semantics, recording everything (as tests/ph-data.test.js) ── */
function makeFake(o){
  o=o||{};
  const store={};const log={reads:[],writes:[],queries:[],tx:0,getDocs:0,deletes:0};
  const snapDoc=p=>({id:p.split('/').pop(),exists:()=>Object.prototype.hasOwnProperty.call(store,p),data:()=>clone(store[p]),metadata:{fromCache:false}});
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/'),isCol:true}),
    query:(c,...cons)=>({path:c.path,limit:(cons.filter(x=>x&&x.limit!==undefined)[0]||{}).limit}),
    orderBy:(f,d)=>({orderBy:[f,d]}),limit:n=>({limit:n}),where:(...a)=>({where:a}),
    getDoc:async r=>{log.reads.push(r.path);const f=o.failPath&&o.failPath(r.path);if(f)throw f;return snapDoc(r.path);},
    getDocs:async q=>{
      log.getDocs++;log.queries.push({path:q.path,limit:q.limit});
      const f=o.failPath&&o.failPath(q.path);if(f)throw f;
      let docs=Object.keys(store).filter(k=>k.indexOf(q.path+'/')===0&&k.slice(q.path.length+1).indexOf('/')===-1).sort();
      if(q.limit!==undefined)docs=docs.slice(0,q.limit);
      return{docs:docs.map(snapDoc),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path,tx:0,data:clone(d)});store[r.path]=clone(d);},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});store[r.path]=Object.assign({},store[r.path],clone(d));},
    deleteDoc:async r=>{log.deletes++;log.writes.push({op:'delete',path:r.path,tx:0});delete store[r.path];},
    addDoc:async(c,d)=>{log.writes.push({op:'add',path:c.path,tx:0,data:clone(d)});return{id:'x'};},
    writeBatch:()=>{const ops=[];return{set(r,d){ops.push({op:'set',path:r.path,data:clone(d)});return this;},update(r,d){ops.push({op:'update',path:r.path,data:clone(d)});return this;},delete(r){ops.push({op:'delete',path:r.path});return this;},async commit(){log.tx++;ops.forEach(x=>{log.writes.push(Object.assign({tx:log.tx},x));});}};},
    runTransaction:async(db,fn)=>{
      const id=++log.tx;const buf=[];
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
const settle=(ms)=>new Promise(r=>setTimeout(r,ms||20));
const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});

function load(src,o){
  o=o||{};
  const fk=makeFake({failPath:o.failPath});
  const seed=o.store||SEED();
  Object.keys(seed).forEach(k=>{fk.store[k]=clone(seed[k]);});
  if(o.settings)fk.store['ph_settings/main']=clone(o.settings);
  const nav={onLine:true,userAgent:o.ua||WIN};
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js'],session:o.session===undefined?USERS.afnan:o.session,currentPage:'dashboard',viewportW:o.width||1400,
    globals:Object.assign({},fk.api,{
      navigator:nav,auth:{currentUser:{getIdToken:async()=>{}}},
      getProductCatalog:()=>CATALOG,
      localStorage:{getItem:()=>null,setItem(){},removeItem(){}}
    },o.globals||{})});
  const ctx=a.ctx;
  const dom=domkit.install(ctx);
  ctx.console={warn(){},log(){},error(){}};
  if(o.shell)vm.runInContext(read('js/ph-ui.js'),ctx,{filename:'ph-ui.js'});
  vm.runInContext(src,ctx,{filename:'ph-mod-drafts.js'});
  const T={a,ctx,dom,fk,log:fk.log,store:fk.store,nav,
    R:c=>a.run(c),
    as(u){ctx.session=u;},
    width(w){ctx.window.innerWidth=w;},
    async open(opts){
      await a.run('phLoadAll('+(opts&&opts.only?J({only:opts.only}):'')+')');
      const host=dom.mk('div');dom.body.appendChild(host);T.host=host;
      ctx.phDraftsPanel(host,{user:(ctx.session||{}).u});
      return host;
    },
    text:n=>(n||T.host).textContent,
    html:n=>domkit.toHtml(n||T.host),
    all:(pred,root)=>dom.all(root||T.host,pred),
    byAct:(act)=>dom.all(T.host,n=>n.getAttribute('data-act')===act)[0]||null,
    byId:(id)=>dom.all(T.host,n=>n.id===id)[0]||null,
    byText:(tag,txt)=>dom.all(T.host,n=>n.tagName===tag.toUpperCase()&&n.textContent===txt)[0]||null,
    byAttr:(k,v)=>dom.all(T.host,n=>n.getAttribute(k)===v)[0]||null,
    type(id,val){const n=T.byId(id);n.value=val;dom.dispatch(n,'input');return n;},
    choose(id,val){const n=T.byId(id);n.value=val;dom.dispatch(n,'change');return n;},
    tick(id,v){const n=T.byId(id);n.checked=v;dom.dispatch(n,'change');return n;},
    press(n){if(!n||n.disabled)return false;dom.click(n);return true;},
    async act(act,ms){const b=T.byAct(act);const ok=T.press(b);await settle(ms||30);return ok;},
    paths:()=>T.log.writes.map(w=>w.path),
    roots:()=>T.log.writes.map(w=>w.path.split('/')[0])
  };
  return T;
}
async function fillGood(T,over){
  const g=Object.assign({},GOOD,over||{});
  T.type('phd-f-code',g.code);T.type('phd-f-name',g.name);
  Object.keys(g.sizes).forEach(k=>T.type('phd-sz-'+k,String(g.sizes[k])));
  T.type('phd-f-qty',String(g.qty));T.type('phd-f-fabric',g.fabric);
  T.type('phd-f-plannedFabricQty',String(g.plannedFabricQty));T.choose('phd-f-plannedFabricUnit',g.plannedFabricUnit);
  T.choose('phd-f-season',g.season);T.type('phd-f-plannedCutDate',g.plannedCutDate);T.type('phd-f-requestedDate',g.requestedDate);
  T.choose('phd-f-cutMasterId',g.cutMasterId);
}
const cls=(n,c)=>(' '+n.className+' ').indexOf(' '+c+' ')>-1;
const rowOf=(T,id)=>T.all(n=>cls(n,'phd-row')&&n.textContent.indexOf(id)>-1)[0]||null;
const noteOf=T=>{const n=T.all(x=>cls(x,'phd-note'))[0];return n?n.textContent:'';};

async function checks(src){
  const o={};
  const K=(name,cond)=>{o[name]=!!cond;};

  /* ── the list ── */
  {
    const T=load(src);await T.open();
    const t=T.text();
    K('list: the default filter shows the draft and the ready drafts, not the abandoned one',/DRAFT-K1-AAAA/.test(t)&&/DRAFT-K1-BBBB/.test(t)&&/DRAFT-K1-CCCC/.test(t)&&!/DRAFT-K1-DDDD/.test(t));
    K('list: filter chips carry the counts (Open 3, Draft 2, Ready 1, Abandoned 1, All 4)',['Open 3','Draft 2','Ready 1','Abandoned 1','All 4'].every(x=>!!T.byText('button',x)));
    K('list: newest first (by updatedAt)',t.indexOf('DRAFT-K1-BBBB')<t.indexOf('DRAFT-K1-AAAA')&&t.indexOf('DRAFT-K1-AAAA')<t.indexOf('DRAFT-K1-CCCC'));
    K('list: a complete draft says Complete, an incomplete one says how many are missing',/Complete/.test(T.text(rowOf(T,'DRAFT-K1-AAAA')))&&/\d+ missing/.test(T.text(rowOf(T,'DRAFT-K1-BBBB'))));
    T.press(T.byText('button','Abandoned 1'));
    K('list: the Abandoned filter shows the abandoned draft with its status chip',/DRAFT-K1-DDDD/.test(T.text())&&/abandoned/.test(T.text(rowOf(T,'DRAFT-K1-DDDD'))));
    K('list: a read-only view of a draft the person cannot edit is labelled View, an editable one Open',T.byAttr('data-open','DRAFT-K1-DDDD').textContent==='View');
    K('list: reading the list wrote nothing',T.log.writes.length===0);
  }
  {   // a failed read is NAMED and never "no drafts"
    const T=load(src,{failPath:p=>p==='po_drafts'?PERM():null});await T.open();
    const t=T.text();
    K('failed: the list says po_drafts could not be read and names the rules',/po_drafts/.test(t)&&/could not be read/i.test(t)&&/republish/i.test(t));
    K('failed: it is never shown as "no drafts" or as a zero count',!/holds no drafts/.test(t)&&!/Open 0/.test(t)&&!T.byAttr('data-filter','open'));
    K('failed: a Retry button is offered',!!T.byText('button','Retry'));
  }
  {   // Retry re-reads ONLY po_drafts
    let failing=true;
    const T=load(src,{failPath:p=>(p==='po_drafts'&&failing)?PERM():null});await T.open();
    const before=T.log.queries.map(q=>q.path).filter(p=>p!=='po_drafts').length,bd=T.log.queries.filter(q=>q.path==='po_drafts').length;
    failing=false;
    T.press(T.byText('button','Retry'));await settle(60);
    const after=T.log.queries.map(q=>q.path);
    K('failed: Retry re-reads po_drafts only (no other collection is read again)',after.filter(p=>p!=='po_drafts').length===before&&after.filter(p=>p==='po_drafts').length===bd+1);
    K('failed: after a good Retry the list shows the drafts',/DRAFT-K1-AAAA/.test(T.text())&&!/could not be read/.test(T.text()));
  }
  {   // an empty collection that WAS read
    const s=SEED();Object.keys(s).forEach(k=>{if(k.indexOf('po_drafts/')===0)delete s[k];});
    const T=load(src,{store:s});await T.open();
    K('empty: a collection that was read and is empty says so',/po_drafts was read and holds no drafts/.test(T.text()));
  }
  {   // masters unreadable: completeness is "not checked", never a pass
    const T=load(src,{failPath:p=>p==='cutting_masters'?PERM():null});await T.open();
    K('masters failed: rows say "not checked", never Complete',/not checked/.test(T.text(rowOf(T,'DRAFT-K1-AAAA')))&&!/Complete/.test(T.text(rowOf(T,'DRAFT-K1-AAAA'))));
  }
  {   // truncated list
    const s=SEED();for(let i=0;i<300;i++)s['po_drafts/DRAFT-K2-'+String(1000+i)]=draftDoc('DRAFT-K2-'+String(1000+i),'draft',GOOD);
    const T=load(src,{store:s});await T.open();
    K('truncated: a list that hit its read limit says it was cut',/cut at its read limit/.test(T.text()));
  }

  /* ── audience: off the team, nothing ── */
  {
    const T=load(src,{session:USERS.raees});await T.open({only:['drafts']});
    K('audience: raees gets "No access" and no list',/No access/.test(T.text())&&!T.byAct('new'));
    T.R('_phdNew()');T.R('_phdOpen("DRAFT-K1-AAAA")');
    K('audience: raees cannot reach a form even by calling the handlers, and nothing is written',!T.byId('phd-f-code')&&T.log.writes.length===0&&T.R('_phdNew()')===false);
    const Q=load(src,{session:USERS.claude});await Q.open({only:['drafts']});
    K('audience: the QA account is out',/No access/.test(Q.text()));
    const N=load(src,{});N.as(null);await N.open({only:['drafts']});
    K('audience: signed out is out (fail closed)',/No access/.test(N.text()));
  }

  /* ── the form: typing, live completeness, one save ── */
  {
    const T=load(src);await T.open();
    K('new: the New draft button is enabled on a PC and opens a blank form',T.press(T.byAct('new'))&&!!T.byId('phd-f-code'));
    K('new: nothing is written by opening the form',T.log.writes.length===0);
    K('new: the live panel says Not complete and names the missing fields',/Not complete yet/.test(T.text())&&['Article code','Article name','Quantity','Fabric','Season','Planned cut date','Requested date','Cutting master'].every(x=>T.text().indexOf(x)>-1));
    K('new: Issue as PO is a disabled control that says it is a later wave',(()=>{const b=T.byAct('issue');return !!b&&b.disabled===true&&b.getAttribute('disabled')!==null&&/later wave/.test(b.textContent);})());
    T.type('phd-f-code','gd007');
    K('sizes: a waist-size article code switches the grid to the waist axis (26..40), by itself',T.byId('phd-sz-26')&&T.byId('phd-sz-40')&&!T.byId('phd-sz-XS'));
    T.choose('phd-f-sizeModel','alpha');
    K('sizes: an explicit axis wins over the code prefix',T.byId('phd-sz-XS')&&!T.byId('phd-sz-26'));
    T.choose('phd-f-sizeModel','');T.type('phd-f-code','GST073');
    K('sizes: back to the alpha axis for a tee',!!T.byId('phd-sz-XS')&&!T.byId('phd-sz-26'));
    T.type('phd-sz-S','50');T.type('phd-sz-M','50');T.type('phd-f-qty','90');
    K('sizes: the sum hint shows the total and the mismatch',/Sizes add up to 100 pcs - the quantity says 90/.test(T.text()));
    K('sizes: the live panel reports the mismatch by name',/the sizes add up to 100 but the quantity is 90/.test(T.text()));
    T.press(T.byText('button','Use the sizes total'));
    K('sizes: Use the sizes total fills the quantity',T.byId('phd-f-qty').value==='100'&&/matches the quantity/.test(T.text()));
    K('sizes: the ratio is shown',/Ratio: 1:1/.test(T.text()));
    K('typing never wrote anything',T.log.writes.length===0);
  }
  {   // complete form -> Complete; Save is ONE transaction on po_drafts
    const T=load(src);await T.open();T.press(T.byAct('new'));await fillGood(T);
    K('complete: every required field filled reads Complete in the live panel',/Every required field is filled/.test(T.text())&&!/Not complete yet/.test(T.text()));
    K('complete: the summary is titled Print-ready only now',/Print-ready summary/.test(T.text())&&!/not print-ready/.test(T.text()));
    K('complete: the summary reads back the fields',/Effortless Tee/.test(T.text())&&/S 50 · M 50/.test(T.text())&&/Winter/.test(T.text())&&/20 Oct 2026/.test(T.text())&&/Hassan/.test(T.text()));
    T.tick('phd-emb',true);T.tick('phd-jc-printing',true);T.type('phd-f-notes','Handle with care');T.type('phd-f-code','gst073');
    await T.act('save');
    const w=T.log.writes;
    K('save: exactly one write, one transaction, to po_drafts, a create',w.length===1&&w[0].op==='set'&&/^po_drafts\/DRAFT-[0-9A-Z]+-[0-9A-Z]{4}$/.test(w[0].path)&&w[0].tx>0);
    const d=w[0]&&w[0].data||{};
    K('save: the draft is a draft, rev 1, entered on a PC, by the signed-in person',d.status==='draft'&&d.rev===1&&d.entryDevice==='pc'&&d.createdBy==='afnan'&&d.updatedBy==='afnan');
    const po=d.po||{};
    K('save: numbers are numbers, sizes are a map of whole numbers, the ratio is derived',po.qty===100&&J(po.sizes)===J({S:50,M:50})&&po.ratio==='1:1'&&po.plannedFabricQty===30&&po.plannedFabricUnit==='kg');
    K('save: season, dates, the master (id and name), embellishment flag, job copies and notes are stored',po.season==='winter'&&po.plannedCutDate==='2026-10-20'&&po.requestedDate==='2026-10-25'&&po.cutMasterId==='CM-001'&&po.cutMaster==='Hassan'&&po.embellishment.required===true&&po.jobCopies.printing===true&&po.jobCopies.embroidery===false&&po.notes==='Handle with care');
    K('save: the code is stored upper case',po.code==='GST073');
    K('save: the form now shows the draft id, revision 1 and a saved note',new RegExp('Draft '+(w[0]&&w[0].path.split('/')[1])).test(T.text())&&/created \(revision 1\)/.test(T.text()));
    K('save: nothing but po_drafts was written (no pos, no history, no counters)',T.roots().every(r=>r==='po_drafts'));
    K('save: the new draft appears in the loaded list without a reload',T.R('phGet("drafts").rows.some(r=>r.fbKey==='+J(w[0].path.split('/')[1])+')'));
    // edit and save again: rev 2, an update
    T.type('phd-f-name','Effortless Tee v2');
    K('save: an edit marks the form as having unsaved changes',/unsaved changes/.test(T.text()));
    await T.act('save');
    const w2=T.log.writes;
    K('save again: an update with rev 2 and only the editable fields',w2.length===2&&w2[1].op==='update'&&w2[1].data.rev===2&&J(Object.keys(w2[1].data).sort())===J(['po','rev','updatedAt','updatedBy']));
    K('save again: the unsaved marker clears',!/unsaved changes/.test(T.text()));
  }
  {   // typed text that is not understood is named and nothing is written
    const T=load(src);await T.open();T.press(T.byAct('new'));await fillGood(T);
    T.type('phd-f-qty','abc');T.type('phd-f-plannedCutDate','tomorrow');
    K('problems: the live panel names text that was not understood',/Not understood/.test(T.text())&&/quantity "abc"/.test(T.text()));
    await T.act('save');
    K('problems: Save refuses, names both, writes nothing',/Not saved/.test(T.text())&&/quantity "abc"/.test(T.text())&&/not a date/.test(T.text())&&T.log.writes.length===0);
    await T.act('ready');
    K('problems: Mark ready also refuses and writes nothing',/Not marked ready/.test(T.text())&&T.log.writes.length===0);
  }

  /* ── THE GATE ── */
  {
    const T=load(src);await T.open();T.press(T.byAct('new'));
    T.type('phd-f-code','GST073');T.type('phd-f-name','Effortless Tee');T.type('phd-sz-S','40');T.type('phd-f-qty','40');T.type('phd-f-fabric','Jersey');
    await T.act('ready');
    const t=T.text(),nt=noteOf(T);
    K('gate: Mark ready on an incomplete draft is refused',/Not marked ready - the draft is incomplete/.test(nt));
    K('gate: the refusal names the missing fields',['Planned fabric quantity','Planned fabric unit','Season','Planned cut date','Requested date','Cutting master'].every(x=>nt.indexOf(x)>-1)&&!/Missing: [^.]*Article code/.test(nt));
    K('gate: refused BEFORE anything is written (no save, no ready)',T.log.writes.length===0&&T.log.tx===0);
    K('gate: the form keeps what was typed',T.byId('phd-f-code').value==='GST073'&&T.byId('phd-sz-S').value==='40');
    K('gate: the status is still draft in the form',!/READY/.test(t));
  }
  {   // each field is individually enforced (a field removed from a complete draft is named)
    const gaps={'Season':{season:''},'Cutting master':{cutMasterId:''},'Requested date':{requestedDate:''},'Planned fabric unit':{plannedFabricUnit:''},'Fabric':{fabric:''}};
    let named=true,none=true;
    for(const lab of Object.keys(gaps)){
      const T=load(src);await T.open();T.press(T.byAct('new'));await fillGood(T,gaps[lab]);
      // fillGood types '' for the cleared one: select '' is the "choose" option
      await T.act('ready');
      if(T.log.writes.length)none=false;
      if(!new RegExp('Missing: [^.]*'+lab).test(noteOf(T)))named=false;
    }
    K('gate: removing any one required field refuses Mark ready and names exactly it',named&&none);
  }
  {   // a complete draft: saved, then readied; the form locks
    const T=load(src);await T.open();T.press(T.byAct('new'));await fillGood(T);
    await T.act('ready',60);
    const w=T.log.writes;
    K('ready: a complete new draft is saved and then readied: two transactions on the same document',w.length===2&&w[0].op==='set'&&w[1].op==='update'&&w[0].path===w[1].path&&w[0].tx!==w[1].tx);
    K('ready: the ready patch is the writer\'s (status ready, rev 2, readyAt, readyBy)',w[1]&&w[1].data.status==='ready'&&w[1].data.rev===2&&w[1].data.readyBy==='afnan'&&typeof w[1].data.readyAt==='number');
    K('ready: the form says READY / is locked and every input is disabled',/is marked ready/.test(T.text())&&T.byId('phd-f-code').disabled===true&&T.byId('phd-f-notes').disabled===true&&T.byAct('save').disabled===true&&T.byAct('ready').disabled===true);
    K('ready: only po_drafts was written',T.roots().every(r=>r==='po_drafts'));
  }
  {   // the saved draft is edited, then marked ready: saved first (one update), then readied
    const T=load(src);await T.open();T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));
    K('open: an existing draft fills the form from the stored values',T.byId('phd-f-code').value==='GST073'&&T.byId('phd-sz-S').value==='50'&&T.byId('phd-f-cutMasterId').value==='CM-001'&&T.byId('phd-emb').checked===true);
    T.type('phd-f-name','Edited name');
    await T.act('ready',60);
    const w=T.log.writes;
    K('ready: an edited existing draft is saved (update) then readied (update): rev 2 then rev 3',w.length===2&&w[0].data.rev===2&&w[1].data.rev===3&&w[1].data.status==='ready');
  }
  {   // a retired master is visible and blocks readiness
    const T=load(src);await T.open();T.press(T.byAct('new'));await fillGood(T,{cutMasterId:'CM-003'});
    K('master: a retired master is not offered as a choice',(()=>{const opts=T.byId('phd-f-cutMasterId').children.map(c=>c.getAttribute('value'));return opts.indexOf('CM-001')>-1&&opts.indexOf('CM-003')<0;})());
    const T2=load(src);await T2.open();T2.press(T2.byAttr('data-open','DRAFT-K1-AAAA'));
    // a stored draft naming a retired master keeps it visible and the gate says it is retired
    const s=SEED();s['po_drafts/DRAFT-K1-AAAA']=draftDoc('DRAFT-K1-AAAA','draft',Object.assign({},GOOD,{cutMasterId:'CM-003',cutMaster:'Retired Rao'}));
    const T3=load(src,{store:s});await T3.open();T3.press(T3.byAttr('data-open','DRAFT-K1-AAAA'));
    K('master: a draft that names a retired master shows it (flagged) and the gate says it is retired',/Retired Rao \(retired or not in the registry\)/.test(T3.text())&&/is retired in the master registry/.test(T3.text()));
    await T3.act('ready');
    K('master: Mark ready is refused for the retired master, nothing written',/Not marked ready/.test(T3.text())&&T3.log.writes.length===0);
  }
  {   // masters unreadable: the master cannot be checked, so ready is refused
    const T=load(src,{failPath:p=>p==='cutting_masters'?PERM():null});await T.open();T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));
    K('masters failed: the form names cutting_masters, offers no master choice and disables it',/cutting_masters/.test(T.text())&&T.byId('phd-f-cutMasterId').disabled===true);
    await T.act('ready');
    K('masters failed: Mark ready is refused (the master cannot be checked) and writes nothing',/master registry is not available/.test(noteOf(T))&&T.log.writes.length===0);
  }

  /* ── PC-only ── */
  {   // a PC
    const T=load(src);await T.open();T.press(T.byAct('new'));
    K('pc: on a PC (Windows, 1400 wide) there is no PC-only banner and the form is editable',!/PC-only - this screen is read-only|does not look like a PC/.test(T.text())&&T.byId('phd-f-code').disabled!==true&&T.byAct('save').disabled!==true);
  }
  {   // a narrow window, soft rule
    const T=load(src,{width:800});await T.open();
    K('soft: off a PC the New draft button is disabled',T.byAct('new').disabled===true);
    K('soft: off a PC the list still reads and the banner explains, with the honest limit of the check',/does not look like a PC screen/.test(T.text())&&/can be wrong and it can be faked/.test(T.text())&&/not a security boundary/.test(T.text()));
    T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));
    K('soft: opening a draft off a PC shows a READ-ONLY form (every input disabled, Save and Ready disabled)',T.byId('phd-f-code').disabled===true&&T.byId('phd-sz-S').disabled===true&&T.byId('phd-f-notes').disabled===true&&T.byAct('save').disabled===true&&T.byAct('ready').disabled===true);
    K('soft: no Fix buttons are offered on a read-only form',!T.byAttr('data-fix','code'));
    await T.R('_phdSave()');await settle();
    K('soft: invoking Save directly is refused too (the guard is in the handler, not only the button) and writes nothing',/read-only/.test(T.text())&&T.log.writes.length===0);
    T.press(T.byText('button','Edit anyway on this screen'));
    K('soft: "Edit anyway" is offered, and after it the form is editable with a visible warning',T.byId('phd-f-code').disabled!==true&&/you are editing on a screen that does not look like a PC/i.test(T.text()));
    T.type('phd-f-name','Edited narrow');await T.act('save');
    K('soft: after the override a save goes through (one update on po_drafts)',T.log.writes.length===1&&T.log.writes[0].path==='po_drafts/DRAFT-K1-AAAA');
  }
  {   // phone user agent at a wide width
    const T=load(src,{width:1400,ua:IPHONE});await T.open();
    K('ua: a phone user agent is not a PC even in a wide window',T.byAct('new').disabled===true&&/does not look like a PC/.test(T.text()));
  }
  {   // hard rule
    const T=load(src,{width:800,settings:{pcOnlyHard:true,rev:1,updatedAt:T0,updatedBy:'afnan'}});await T.open();
    K('hard: off a PC the banner says the hard rule is on and offers NO override',/hard PC-only rule/.test(T.text())&&!T.byText('button','Edit anyway on this screen'));
    T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));
    K('hard: the form is read-only and there is no override button',T.byId('phd-f-code').disabled===true&&!T.byText('button','Edit anyway on this screen'));
    T.R('_phdOverride=true');T.R('_phdPaint()');
    K('hard: even forcing the override flag does not unlock the form',T.byId('phd-f-code').disabled===true&&T.byAct('save').disabled===true);
    await T.R('_phdSave()');await T.R('_phdReady()');await T.R('_phdAbandon("because")');await T.R('_phdSendBack("because")');await settle();
    K('hard: calling save / ready / abandon / send back directly writes NOTHING',T.log.writes.length===0&&T.log.tx===0);
    K('hard: _phdNew() is refused',T.R('_phdNew()')===false);
  }
  {   // hard rule on a PC: not in the way
    const T=load(src,{width:1400,settings:{pcOnlyHard:true,rev:1,updatedAt:T0,updatedBy:'afnan'}});await T.open();T.press(T.byAct('new'));
    K('hard: on a PC the hard rule changes nothing (the form is editable)',T.byId('phd-f-code').disabled!==true);
  }
  {   // the setting could not be read -> fail closed off a PC
    const T=load(src,{width:800,failPath:p=>p==='ph_settings/main'?PERM():null});await T.open();
    K('unread setting: off a PC it is treated as hard and says so, with no override',/could not be read, so the strict rule is assumed/.test(T.text())&&!T.byText('button','Edit anyway on this screen'));
    const P=load(src,{width:1400,failPath:p=>p==='ph_settings/main'?PERM():null});await P.open();P.press(P.byAct('new'));
    K('unread setting: on a PC the form is still editable',P.byId('phd-f-code').disabled!==true);
  }

  /* ── NO ISSUING, nothing outside po_drafts ── */
  {
    const T=load(src);await T.open();
    T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));await T.act('ready',60);
    const T2=load(src);await T2.open();T2.press(T2.byAttr('data-open','DRAFT-K1-CCCC'));
    K('issue: the Issue control exists on a READY draft and is disabled (a later wave)',(()=>{const b=T2.byAct('issue');return !!b&&b.disabled===true&&/later wave/.test(b.textContent);})());
    const w=T2.byAct('issue');let clicked=false;(w._ls.click||[]).forEach(()=>{clicked=true;});
    K('issue: the Issue control has no click handler at all',clicked===false);
    K('issue: a full cycle (open, edit, ready) wrote only to po_drafts: no pos, no counters, no history, no cut job',T.roots().length>0&&T.roots().every(r=>r==='po_drafts'));
  }

  /* ── send back and abandon ── */
  {
    const T=load(src);await T.open();T.press(T.byAttr('data-open','DRAFT-K1-CCCC'));
    K('ready: a ready draft is locked with an explanation',T.byId('phd-f-code').disabled===true&&/is READY: it is locked/.test(T.text()));
    T.press(T.byAct('sendback'));
    K('send back: asks for a reason first',!!T.byId('phd-f-ask-reason')&&T.log.writes.length===0);
    await T.act('ask-ok');
    K('send back: without a reason it is refused and writes nothing',/A reason is needed to send a draft back/.test(T.text())&&T.log.writes.length===0);
    T.type('phd-f-ask-reason','master changed');await T.act('ask-ok');
    const w=T.log.writes;
    K('send back: with a reason it writes the writer\'s patch (draft, rev 2, sentBackReason)',w.length===1&&w[0].data.status==='draft'&&w[0].data.rev===2&&w[0].data.sentBackReason==='master changed');
    K('send back: the draft is editable again',T.byId('phd-f-code').disabled!==true&&/Sent back: master changed/.test(T.text()));
  }
  {   // Uzaib (floor): can save/ready/abandon but NOT send back
    const T=load(src,{session:USERS.uzaib});await T.open();T.press(T.byAttr('data-open','DRAFT-K1-CCCC'));
    K('send back: a floor user sees the button disabled',T.byAct('sendback').disabled===true);
    await T.R('_phdSendBack("nope")');T.R('_phdPaint()');await settle();
    K('send back: a floor user calling it directly is refused and writes nothing',/Only a manager/.test(T.text())&&T.log.writes.length===0);
    const D=load(src,{session:USERS.uzaib});await D.open();D.press(D.byAttr('data-open','DRAFT-K1-BBBB'));
    D.type('phd-f-name','Floor edit');await D.act('save');
    K('floor: a floor user can edit and save a draft (one update)',D.log.writes.length===1&&D.log.writes[0].data.updatedBy==='uzaib');
  }
  {
    const T=load(src);await T.open();T.press(T.byAttr('data-open','DRAFT-K1-BBBB'));
    T.press(T.byAct('abandon'));
    K('abandon: asks for a reason first',!!T.byId('phd-f-ask-reason')&&T.log.writes.length===0);
    await T.act('ask-ok');
    K('abandon: no reason, no write',/A reason is needed to abandon a draft/.test(T.text())&&T.log.writes.length===0);
    T.type('phd-f-ask-reason','duplicate of AAAA');await T.act('ask-ok');
    const w=T.log.writes;
    K('abandon: with a reason the draft is abandoned (writer patch) and locked',w.length===1&&w[0].data.status==='abandoned'&&w[0].data.abandonedReason==='duplicate of AAAA'&&T.byId('phd-f-code').disabled===true&&/abandoned/.test(T.text()));
  }
  {   // a refused abandon keeps the typed reason
    const T=load(src);await T.open();T.press(T.byAttr('data-open','DRAFT-K1-BBBB'));
    T.fk.store['po_drafts/DRAFT-K1-BBBB']=Object.assign({},T.fk.store['po_drafts/DRAFT-K1-BBBB'],{rev:4});
    T.press(T.byAct('abandon'));T.type('phd-f-ask-reason','not needed any more');await T.act('ask-ok');
    K('abandon: a refused attempt (stale revision) keeps the typed reason in the box and writes nothing',/changed by someone else/.test(T.text())&&T.byId('phd-f-ask-reason')&&T.byId('phd-f-ask-reason').value==='not needed any more'&&T.log.writes.length===0);
  }
  {   // a never-saved form is discarded without a write
    const T=load(src);await T.open();T.press(T.byAct('new'));T.type('phd-f-code','GH001');
    T.press(T.byAct('abandon'));
    K('discard: a new unsaved draft offers Discard (no reason, nothing to write)',!T.byId('phd-f-ask-reason')&&!!T.byAct('ask-ok')&&/Discard this new draft/.test(T.text()));
    T.press(T.byAct('ask-ok'));
    K('discard: discarding writes nothing and returns to the list',T.log.writes.length===0&&!!T.byAct('new')&&/Discarded/.test(T.text()));
  }
  {   // leaving with unsaved edits asks first
    const T=load(src);await T.open();T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));T.type('phd-f-name','changed');
    T.press(T.byAct('back'));
    K('leave: Back with unsaved edits asks before discarding',/Your unsaved changes will be lost/.test(T.text())&&!!T.byId('phd-f-code'));
    T.press(T.byAct('ask-cancel'));
    K('leave: Cancel keeps the form and the edit',T.byId('phd-f-name').value==='changed');
    T.press(T.byAct('back'));T.press(T.byAct('ask-ok'));
    K('leave: confirming returns to the list, nothing written',!!T.byAct('new')&&T.log.writes.length===0);
  }

  {   // sizes that do not fit the article's axis are said, not silently kept or silently dropped
    const s=SEED();s['po_drafts/DRAFT-K1-AAAA']=draftDoc('DRAFT-K1-AAAA','draft',Object.assign({},GOOD,{sizes:{S:50,M:40,'34':10},qty:100}));
    const T=load(src,{store:s});await T.open();T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));
    K('stray sizes: a stored size outside the axis is said to be dropped on save',/1 size entry does not belong to this size axis and will not be saved/.test(T.text()));
    T.type('phd-f-name','x');await T.act('save');
    K('stray sizes: the save drops it, says so, and stores only the axis sizes',T.log.writes.length===1&&J(T.log.writes[0].data.po.sizes)===J({S:50,M:40})&&/outside this size axis were not saved/.test(T.text()));
  }

  /* ── concurrent change ── */
  {
    const T=load(src);await T.open();T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));
    T.fk.store['po_drafts/DRAFT-K1-AAAA']=Object.assign({},T.fk.store['po_drafts/DRAFT-K1-AAAA'],{rev:5,po:Object.assign({},GOOD,{name:'Changed by someone else'})});
    T.type('phd-f-name','my edit');await T.act('save');
    K('stale: a save over a draft someone else changed is refused with the revision, and writes nothing',/changed by someone else \(revision 5, yours was 1\)/.test(T.text())&&T.log.writes.length===0);
    K('stale: a Reload button is offered and the typed edit is still in the form',!!T.byText('button','Reload the latest copy')&&T.byId('phd-f-name').value==='my edit');
    T.press(T.byText('button','Reload the latest copy'));await settle(60);
    K('stale: Reload fetches the latest copy into the form',T.byId('phd-f-name').value==='Changed by someone else');
  }

  /* ── the article search ── */
  {
    const T=load(src);await T.open();T.press(T.byAct('new'));
    T.type('phd-f-search','hoodie');
    K('search: matches by name from the catalog',T.all(n=>cls(n,'phd-hit')).length===1&&/GH001/.test(T.text(T.byId('phd-results'))));
    T.press(T.all(n=>cls(n,'phd-hit'))[0]);
    K('search: picking fills the code and name and clears the results',T.byId('phd-f-code').value==='GH001'&&T.byId('phd-f-name').value==='Black Hoodie'&&T.all(n=>cls(n,'phd-hit')).length===0);
    K('search: the catalog hint confirms the code',/In the catalog: Black Hoodie/.test(T.text()));
    T.type('phd-f-code','ZZ999');
    K('search: a code that is not in the catalog is flagged but not blocked',/Not in the article catalog/.test(T.text()));
    T.type('phd-f-search','nothing-like-this');
    K('search: no match says so',/No article in the catalog matches/.test(T.text(T.byId('phd-results'))));
  }

  /* ── the standard is a suggestion, never a write ── */
  {
    const T=load(src);await T.open();T.press(T.byAct('new'));
    T.type('phd-f-code','GST073');T.type('phd-sz-S','50');T.type('phd-sz-M','50');
    K('standard: the saved standard is shown with a computed suggestion',/Standard for GST073: 0.3 kg per piece → about 30 kg for 100 pieces/.test(T.text()));
    T.press(T.all(n=>n.tagName==='BUTTON'&&/Use the standard/.test(n.textContent))[0]);await settle(40);
    K('standard: using it fills the fabric quantity and unit in the form only',T.byId('phd-f-plannedFabricQty').value==='30'&&T.byId('phd-f-plannedFabricUnit').value==='kg'&&T.log.writes.length===0);
  }

  /* ── the form survives a tab switch, not another person ── */
  {
    const T=load(src);await T.open();T.press(T.byAct('new'));T.type('phd-f-code','GH001');T.type('phd-f-fabric','Fleece');
    const host2=T.dom.mk('div');T.dom.body.appendChild(host2);T.ctx.phDraftsPanel(host2,{});T.host=host2;
    K('tab switch: re-rendering the tab into a new host keeps the form and what was typed',T.byId('phd-f-code').value==='GH001'&&T.byId('phd-f-fabric').value==='Fleece');
    T.as(USERS.mustafa);
    const host3=T.dom.mk('div');T.dom.body.appendChild(host3);T.ctx.phDraftsPanel(host3,{});T.host=host3;
    K('another person on the same page load: nothing carries over (list view, no form)',!T.byId('phd-f-code')&&!!T.byAct('new'));
  }

  /* ── XSS ── */
  {
    const evil='<img src=x onerror=alert(1)>';
    const s=SEED();
    s['po_drafts/DRAFT-K1-AAAA']=draftDoc('DRAFT-K1-AAAA','draft',Object.assign({},GOOD,{name:evil,notes:'<script>alert(2)</script>',fabric:evil,pattern:evil,cutMaster:evil,cutMasterId:'CM-009'}),{updatedAt:T0+9000,updatedBy:evil,createdByName:evil});
    s['cutting_masters/CM-002']=master('CM-002',evil);
    const T=load(src,{store:s});await T.open();
    const list=T.html();
    K('xss: a hostile article name in the list is escaped text',list.indexOf('<img src=x')<0&&list.indexOf('&lt;img src=x')>-1);
    K('xss: no element was created from stored text (no IMG / SCRIPT in the tree)',T.all(n=>n.tagName==='IMG'||n.tagName==='SCRIPT').length===0);
    T.press(T.byAttr('data-open','DRAFT-K1-AAAA'));
    const form=T.html();
    K('xss: the form, the summary and the master list carry hostile text only as escaped text',form.indexOf('<img src=x')<0&&form.indexOf('<script>')<0&&T.all(n=>n.tagName==='IMG'||n.tagName==='SCRIPT').length===0);
    K('xss: a hostile value is in the input value property, not parsed',T.byId('phd-f-name').value===evil&&T.byId('phd-f-notes').value==='<script>alert(2)</script>');
    T.type('phd-f-search','hostile');
    K('xss: a hostile catalog name in the search results is text',T.all(n=>n.tagName==='IMG').length===0&&T.html().indexOf('<img src=x')<0);
    K('xss: the source never parses a string as HTML',!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|DOMParser|document\.write|createContextualFragment/.test(src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')));
  }

  /* ── no existing collection, no PDF, nothing registered ── */
  {
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
    K('scope: the source calls no Firestore write API itself (only ph-write.js writers)',!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(code));
    K('scope: the only ph-write functions used are the four draft writers',read('js/ph-write.js').split('\n').map(l=>/^(?:async )?function (ph[A-Z]\w*)/.exec(l)).filter(Boolean).map(m=>m[1]).filter(n=>new RegExp('\\b'+n+'\\s*\\(').test(code)).sort().join()==='phAbandonDraft,phMarkDraftReady,phSaveDraft,phSendBackDraft');
    K('scope: no PDF, no print, no pos document: the source names none of them',!/generatePOPdf|printDocument|jsPDF|window\.print|collection\(db,\s*'pos'\)|doc\(db,\s*'pos'|'pos'/.test(code));
    K('scope: it registers nothing (no tab, no listener, no escape guard, no window.* handler)',!/phRegisterTab|phAddEscapeGuard|addEventListener\('(keydown|hashchange|popstate)'|window\.[A-Za-z_]+\s*=(?!=)|document\.addEventListener/.test(code));
  }
  return o;
}

async function shellChecks(){
  const o={};
  const K=(n,c)=>{o[n]=!!c;};
  const T=load(SRC,{shell:true});
  T.R('phRegisterTab("queue",{render:function(h,c){if(typeof phDraftsPanel==="function")phDraftsPanel(h,c);}})');
  T.ctx.currentPage='prod-ops';
  T.ctx.phRenderPage('prod-ops');
  await T.R('phUiLoad()');
  T.R('phGoTab("queue")');
  const panel=T.dom.find('ph-panel');
  T.host=panel;
  K('shell: the PO Queue tab renders the drafts panel through the documented extension point',/PO Drafts/.test(panel.textContent)&&/DRAFT-K1-AAAA/.test(panel.textContent));
  K('shell: the shell data load is what the panel reads (no extra read of po_drafts)',T.log.queries.filter(q=>q.path==='po_drafts').length===1);
  T.press(T.byAct('new'));
  T.type('phd-f-code','GH001');
  T.R('phGoTab("overview")');T.R('phGoTab("queue")');
  K('shell: a tab switch away and back keeps the open form and what was typed',!!T.byId('phd-f-code')&&T.byId('phd-f-code').value==='GH001');
  K('shell: opening the form and typing wrote nothing',T.log.writes.length===0);
  return o;
}

module.exports=async function(){
  const s=suite('ph-mod-drafts');
  s.section('PO drafts (PC-only entry)');
  const real=await checks(SRC);
  Object.keys(real).forEach(k=>s.ok(k,real[k]===true));
  const sh=await shellChecks();
  Object.keys(sh).forEach(k=>s.ok(k,sh[k]===true));

  s.section('wiring: script tag, precache, version');
  const idx=read('index.html'),sw=read('sw.js');
  const iUi=idx.indexOf('/js/ph-ui.js'),iMod=idx.indexOf('/js/ph-mod-drafts.js'),iMod2=idx.indexOf('/js/ph-mod-drafts.js',iMod+1);
  s.ok('index.html loads js/ph-mod-drafts.js once, right after js/ph-ui.js',iMod>iUi&&iUi>0&&iMod2<0&&/ph-ui\.js[^\n]*\n<script src="\/js\/ph-mod-drafts\.js\?v=[^"]+"><\/script>/.test(idx));
  s.ok('the script tag is before the Firebase bootstrap module',iMod<idx.indexOf('<script type="module">'));
  const pre=sw.indexOf("'/js/ph-ui.js'"),pm=sw.indexOf("'/js/ph-mod-drafts.js'");
  s.ok('sw.js precaches it once, right after js/ph-ui.js',pm>pre&&pre>0&&sw.split("'/js/ph-mod-drafts.js'").length===2&&/'\/js\/ph-ui\.js',\n  '\/js\/ph-mod-drafts\.js',/.test(sw));
  s.ok('every global the file declares is ph/_phd/PH_DRAFTS_ prefixed (one lexical scope with the other ph files)',(()=>{
    const code=SRC.replace(/\/\*[\s\S]*?\*\//g,'');
    const names=[...code.matchAll(/^(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)/gm)].map(m=>m[1]);
    return names.length>40&&names.every(n=>/^(phDraftsPanel|_phd[A-Z]\w*|PH_DRAFTS_[A-Z_]+)$/.test(n));
  })());
  s.ok('no global of this file collides with a name in the other ph files (checked by loading them together)',(()=>{
    const code=SRC.replace(/\/\*[\s\S]*?\*\//g,'');
    const mine=[...code.matchAll(/^(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)/gm)].map(m=>m[1]);
    const others=['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-ui.js'].map(f=>read(f).replace(/\/\*[\s\S]*?\*\//g,'')).join('\n');
    return mine.every(n=>!new RegExp('^(?:const|let|function|async function)\\s+'+n.replace(/\$/g,'\\$')+'\\b','m').test(others));
  })());

  s.section('stylesheet contract (geometry the harness cannot lay out)');
  const a0=CSS.indexOf('/* ph-mod-drafts START */'),b0=CSS.indexOf('/* ph-mod-drafts END */');
  const blk=CSS.slice(a0,b0).replace(/\/\*[\s\S]*?\*\//g,'');
  s.ok('the block exists, is delimited and sits at the end of the stylesheet',a0>0&&b0>a0&&CSS.slice(b0).trim()==='/* ph-mod-drafts END */');
  s.ok('tokens only: no literal colour in the block',!/#[0-9a-fA-F]{3,8}\b/.test(blk)&&!/\b(?:rgb|rgba|hsl|hsla)\(/.test(blk));
  s.ok('every selector in the block is .phd- prefixed',(blk.match(/[^{}]+(?=\{)/g)||[]).filter(x=>!/^\s*@media/.test(x)).every(x=>x.split(',').every(p=>/\.phd-/.test(p))));
  s.ok('text sizes: nothing under 12px in the block',!/font-size:(?:[0-9]|10|11)(?:\.\d+)?px/.test(blk));
  s.ok('touch targets: inputs, buttons, filters, search hits and checks are 44px',['.phd-in','.phd-btn','.phd-filter','.phd-hit','.phd-check','.phd-small'].every(c=>new RegExp(c.replace('.','\\.')+'\\{[^}]*min-height:44px').test(blk)));
  s.ok('the layout is one column on a phone and the form grid collapses',/@media \(max-width:1100px\)\{\.phd-layout\{grid-template-columns:minmax\(0,1fr\)\}\}/.test(blk)&&/@media \(max-width:600px\)\{[\s\S]*\.phd-grid\{grid-template-columns:minmax\(0,1fr\)\}/.test(blk));
  s.ok('a long article name wraps (overflow-wrap) instead of widening the row',/\.phd-row-title\{[^}]*overflow-wrap:anywhere/.test(blk)&&/\.phd-row-main\{[^}]*min-width:0/.test(blk));
  s.ok('disabled inputs keep readable ink (not a faded one) on a soft ground',/\.phd-in:disabled\{[^}]*background:var\(--soft\);[^}]*color:var\(--text\)/.test(blk));
  s.ok('the active filter takes its ink from --on-dark on --dark',/\.phd-filter\.on\{[^}]*background:var\(--dark\)[^}]*color:var\(--on-dark\)/.test(blk));

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
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  await brk('the client gate dropped from Mark ready',"  const gate=_phdGate(t.po);\n  if(!gate.ok){","  const gate={ok:true,missing:[]};\n  if(!gate.ok){",['gate: refused BEFORE anything is written (no save, no ready)','gate: removing any one required field refuses Mark ready and names exactly it']);
  await brk('Mark ready saves before it checks',"  // THE GATE, before anything is written: refused with the missing fields named.\n  const gate=_phdGate(t.po);","  if(f.dirty||!f.id){const s0=await _phdSave();if(!s0||!s0.ok)return;}\n  const gate=_phdGate(t.po);",['gate: refused BEFORE anything is written (no save, no ready)']);
  await brk('the refusal does not name the fields',"_phdFmtList(gate.missing.map(function(m){return _phdLabel(m.field)+' ('+m.why+')';}))+'. Your changes","'a field is missing. Your changes",['gate: the refusal names the missing fields']);
  await brk('the hard rule has no teeth (a non-PC always may write)',"  if(pc.isPc)return{ok:true,kind:'pc'};\n  if(pc.hard)return","  if(pc.isPc)return{ok:true,kind:'pc'};\n  if(false)return",['hard: calling save / ready / abandon / send back directly writes NOTHING','hard: even forcing the override flag does not unlock the form']);
  await brk('an unread setting is treated as soft',"hard:hardSet||!known}","hard:hardSet}",['unread setting: off a PC it is treated as hard and says so, with no override']);
  await brk('a non-PC is treated as a PC',"const isPc=typeof phIsPcOnly==='function'&&phIsPcOnly(sc.ua,sc.width)===true;","const isPc=true;",['soft: off a PC the New draft button is disabled','ua: a phone user agent is not a PC even in a wide window']);
  await brk('the write guard is only on the button (handler unguarded)',"async function _phdSave(){\n  const f=_phdForm;\n  if(!_phdWriteGuard())return{ok:false,code:'forbidden'};","async function _phdSave(){\n  const f=_phdForm;",['soft: invoking Save directly is refused too (the guard is in the handler, not only the button) and writes nothing']);
  await brk('the soft override is not offered',"if(_phdCanRecord())c.appendChild(_phdBtn('',\"Edit anyway on this screen\"","if(false)c.appendChild(_phdBtn('',\"Edit anyway on this screen\"",['soft: "Edit anyway" is offered, and after it the form is editable with a visible warning']);
  await brk('a failed read is drawn as an empty list',"  if(!g.ok){\n    const c=_phdErrCard('PO drafts could not be read'","  if(false){\n    const c=_phdErrCard('PO drafts could not be read'",['failed: the list says po_drafts could not be read and names the rules','failed: it is never shown as "no drafts" or as a zero count']);
  await brk('Retry re-reads everything',"Promise.resolve(typeof phLoadStage==='function'?phLoadStage('drafts',{force:true}):null).then(done,done);   // phLoadStage never rejects","Promise.resolve(phLoadAll({force:true})).then(done,done);   // phLoadStage never rejects",['failed: Retry re-reads po_drafts only (no other collection is read again)']);
  await brk('masters unread shown as complete',"if(masters===null)chips.appendChild(_phdChip('not checked','wait'));\n    else{","if(false)chips.appendChild(_phdChip('not checked','wait'));\n    else{",['masters failed: rows say "not checked", never Complete']);
  await brk('a floor user can send back',"  if(!_phdCanManage()){_phdSetNote('err','Only a manager (Afnan, Ammar, Mustafa) can send a ready draft back.');return;}","",['send back: a floor user calling it directly is refused and writes nothing']);
  await brk('the stale revision is not sent',"const r=await phSaveDraft(f.id||null,t.po,f.id?{expectedRev:f.rev}:{});","const r=await phSaveDraft(f.id||null,t.po,{});",['stale: a save over a draft someone else changed is refused with the revision, and writes nothing']);
  await brk('unparseable text is quietly dropped on save',"  if(t.problems.length){_phdSetNote('err','Not saved. Fix these first: '","  if(false){_phdSetNote('err','Not saved. Fix these first: '",['problems: Save refuses, names both, writes nothing']);
  await brk('another person inherits the form',"if(_phdForm&&_phdForm.owner!==_phdUser()){","if(false){",['another person on the same page load: nothing carries over (list view, no form)']);
  await brk('the audience gate is removed',"function _phdCanSee(){return typeof phCanSee==='function'&&phCanSee(_phdUser())===true;}","function _phdCanSee(){return true;}",['audience: raees gets \"No access\" and no list','audience: the QA account is out','audience: signed out is out (fail closed)']);
  await brk('role check on writes dropped',"function _phdCanRecord(){return typeof phCanRecordFloor==='function'&&phCanRecordFloor(_phdUser())===true;}","function _phdCanRecord(){return true;}",['audience: raees cannot reach a form even by calling the handlers, and nothing is written']);
  await brk('the Issue control becomes live',"const issue=_phdBtn('phd-issue','Issue as PO (later wave)',null,{'data-act':'issue','aria-disabled':'true'});_phdOff(issue);","const issue=_phdBtn('phd-issue','Issue as PO (later wave)',function(){},{'data-act':'issue','aria-disabled':'true'});",['issue: the Issue control exists on a READY draft and is disabled (a later wave)','issue: the Issue control has no click handler at all','new: Issue as PO is a disabled control that says it is a later wave']);
  await brk('a pos write sneaks in',"async function _phdAbandon(reason){","async function _phdAbandon(reason){ await setDoc(doc(db,'pos','PO-001'),{x:1});",['scope: the source calls no Firestore write API itself (only ph-write.js writers)','scope: no PDF, no print, no pos document: the source names none of them']);
  await brk('a PDF is generated',"function _phdSummary(po,gate,t){","function _phdSummary(po,gate,t){ if(false)generatePOPdf(po);",['scope: no PDF, no print, no pos document: the source names none of them']);
  await brk('a tab is registered by the module',"let _phdHost=null,","phRegisterTab('queue',{render:phDraftsPanel});\nlet _phdHost=null,",['scope: it registers nothing (no tab, no listener, no escape guard, no window.* handler)']);
  await brk('a row title is parsed as HTML',"main.appendChild(_phdEl('div','phd-row-title',code||name?(code+(code&&name?' - ':'')+name):'(no article chosen yet)'));","const tt=_phdEl('div','phd-row-title');tt.innerHTML=code+' - '+name;main.appendChild(tt);",['xss: the source never parses a string as HTML']);
  await brk('the axis is not derived from the code',"function _phdModel(f){return phSizeModel({sizeModel:f.sizeModel||undefined,code:String(f.code||'').trim().toUpperCase()});}","function _phdModel(f){return phSizeModel({sizeModel:f.sizeModel||undefined,code:''});}",['sizes: a waist-size article code switches the grid to the waist axis (26..40), by itself']);
  await brk('the sum is not checked against the quantity',"_phdRefs.sumhint.textContent='Sizes add up to '+sum+' pcs'+(qty!==null?(qty===sum?' - matches the quantity.':' - the quantity says '+qty+'.'):'.');","_phdRefs.sumhint.textContent='';",['sizes: the sum hint shows the total and the mismatch']);
  await brk('typing does not mark the form unsaved',"function _phdTouch(){const f=_phdForm;if(!f)return;f.dirty=true;f.seq++;_phdUpdateLive();}","function _phdTouch(){const f=_phdForm;if(!f)return;f.seq++;_phdUpdateLive();}",['save: an edit marks the form as having unsaved changes','leave: Back with unsaved edits asks before discarding']);
  await brk('a ready draft is editable',"function _phdEditable(){return!!_phdForm&&_phdForm.status==='draft'&&_phdWriteCheck().ok;}","function _phdEditable(){return!!_phdForm&&_phdWriteCheck().ok;}",['ready: a ready draft is locked with an explanation','ready: the form says READY / is locked and every input is disabled']);
  await brk('retired masters are offered',"reg.filter(function(m){return m.active!==false;}).forEach(function(m){opts.push","reg.forEach(function(m){opts.push",['master: a retired master is not offered as a choice']);
  await brk('the gate is given an empty registry',"function _phdGate(po){return phPoComplete(po,{masters:_phdMasters(),today:_phdToday()});}","function _phdGate(po){return phPoComplete(po,{masters:[],today:_phdToday()});}",['ready: a complete new draft is saved and then readied: two transactions on the same document']);
  await brk('the code is not upper-cased',"code:cut(f.code,T.code).toUpperCase(),","code:cut(f.code,T.code),",['save: the code is stored upper case']);
  await brk('the ratio is not derived',"ratio:minQ?ratioKeys.map(function(k){return Math.round(sizes[k]/minQ);}).join(':'):'',","ratio:'',",['save: numbers are numbers, sizes are a map of whole numbers, the ratio is derived','sizes: the ratio is shown']);
  await brk('the override unlocks a hard rule',"  if(pc.hard)return{ok:false,kind:'hard'","  if(pc.hard&&!_phdOverride)return{ok:false,kind:'hard'",['hard: even forcing the override flag does not unlock the form']);
  await brk('Reload latest does nothing',"const done=function(){_phdLoading=false;_phdOpen(id);};","const done=function(){_phdLoading=false;_phdPaint();};",['stale: Reload fetches the latest copy into the form']);
  await brk('the list is not sorted',"return rows.slice().sort(function(a,b){const x=Number(a.updatedAt)||0,y=Number(b.updatedAt)||0;return y-x||(a.fbKey<b.fbKey?-1:a.fbKey>b.fbKey?1:0);});","return rows.slice();",['list: newest first (by updatedAt)']);
  await brk('the default filter shows everything',"let _phdHost=null,_phdView='list',_phdFilter='open',","let _phdHost=null,_phdView='list',_phdFilter='all',",['list: the default filter shows the draft and the ready drafts, not the abandoned one']);
  await brk('using the standard writes a draft',"      _phdTouch();\n    });\n    if(!_phdEditable())_phdOff(b);\n    box.appendChild(b);","      _phdTouch();_phdSave();\n    });\n    if(!_phdEditable())_phdOff(b);\n    box.appendChild(b);",['standard: using it fills the fabric quantity and unit in the form only']);
  await brk('the tab switch drops the form',"  _phdHost=host;\n  if(_phdForm&&_phdForm.owner","  _phdHost=host;_phdForm=null;_phdView='list';\n  if(_phdForm&&_phdForm.owner",['tab switch: re-rendering the tab into a new host keeps the form and what was typed']);
  await brk('the PC-only banner hides its own limits',"It is a guard against mistakes, not a security boundary: it can be wrong and it can be faked, and the server cannot tell what device wrote a draft.","Fine.",['soft: off a PC the list still reads and the banner explains, with the honest limit of the check']);
  await brk('stray sizes are not counted',"const dropped=Object.keys(f.strays||{}).length+","const dropped=0*Object.keys(f.strays||{}).length+0*",['stray sizes: a stored size outside the axis is said to be dropped on save']);
  await brk('a summary row parses HTML',"dl.appendChild(_phdEl('dd','phd-dd'+(missing?' phd-none':''),v||'-'));","const dd0=_phdEl('dd','phd-dd');dd0.innerHTML=v||'-';dl.appendChild(dd0);",['xss: the source never parses a string as HTML']);
  await brk('a refused attempt loses the typed reason',"    _phdSetVal(ta,a.reason||'');","    _phdSetVal(ta,'');",['abandon: a refused attempt (stale revision) keeps the typed reason in the box and writes nothing']);
  s.ok('breaks run: '+broken,broken>=40);
  return s;
};

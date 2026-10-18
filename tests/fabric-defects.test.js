/* ─────────────────────────────────────────────────────────────────────────
   Fabric ▸ defective rolls and the Defects & Returns tab (js/fabric.js on top of
   the engine in js/gatepass.js — the REAL engine, against an in-memory
   Firestore with real transaction semantics).

   What this guards:
     1  a roll is marked defective by ANYONE with canFabric (Kashif included);
        the status, the record, the totals and the movement are right; the photo
        goes up BEFORE the transaction and a failed upload asks.
     2  undo and return-to-vendor are owners + Mustafa — in the UI and in the engine.
     3  the issue picker and the roll edit/delete refuse a defective roll.
     4  the tab groups supplier → lot with roll and kg totals, filters, searches,
        exports exactly the rows it shows, and draws every stored string as TEXT.
     5  the KPI tile, the tab label and the view-only CSR lead.
     6  (WP-F3) the supplier-return form is ONE transaction across buckets.
   Plain node, no network: it proves the LOGIC, not what a phone shows.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');
const {installMint}=require('./mint-helper');

const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const J=x=>JSON.stringify(x);
const _esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const K1='jersey__220gsm__black';
const K2='rib__250gsm__black';

function makeFs(){
  const store=new Map();
  const stats={tx:0};
  let auto=0;
  const ref=path=>({path,id:path.split('/').pop()});
  const apply=b=>{
    const p=b.ref.path;
    if(b.op==='delete'){store.delete(p);return;}
    if(b.op==='update'||(b.op==='set'&&b.merge))store.set(p,Object.assign({},store.get(p)||{},b.data));
    else store.set(p,b.data);
  };
  const api={
    db:{__db:1},
    collection:(_db,name)=>({__coll:name}),
    doc:(a,...segs)=>(a&&a.__coll)?ref(a.__coll+'/auto'+(++auto)):ref(segs.join('/')),
    runTransaction:async(_db,fn)=>{
      stats.tx++;
      const buf=[];let wrote=false;
      const tx={
        get:async r=>{
          if(wrote)throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return{exists:()=>store.has(r.path),data:()=>clone(store.get(r.path))};
        },
        set(r,data,opts){wrote=true;buf.push({op:'set',ref:r,data:clone(data),merge:!!(opts&&opts.merge)});return tx;},
        update(r,data){wrote=true;buf.push({op:'update',ref:r,data:clone(data)});return tx;},
        delete(r){wrote=true;buf.push({op:'delete',ref:r});return tx;}
      };
      await fn(tx);
      buf.forEach(apply);
    },
    setDoc:async(r,data)=>{store.set(r.path,clone(data));},
    updateDoc:async(r,data)=>{if(!store.has(r.path))throw new Error('No document to update: '+r.path);store.set(r.path,Object.assign({},store.get(r.path),clone(data)));},
    deleteDoc:async r=>{store.delete(r.path);},
    getDocs:async c=>({metadata:{fromCache:false},docs:[...store.keys()].filter(k=>k.startsWith(c.__coll+'/')).map(k=>({id:k.split('/').pop(),data:()=>clone(store.get(k))}))})
  };
  return{store,stats,api,keys:prefix=>[...store.keys()].filter(k=>k.startsWith(prefix))};
}

const SESS={
  kashif:{uid:'u1',u:'uzaib',name:'Uzaib',role:'viewer',canFabric:true},
  mustafa:{uid:'u2',u:'mustafa',name:'Mustafa',role:'manager',canFabric:true},
  arfat:{uid:'u3',u:'arfat',name:'Arfat',role:'manager',canFabric:true},
  afnan:{uid:'u4',u:'afnan',name:'Afnan',role:'owner',canFabric:true},
  raees:{uid:'u5',u:'raees',name:'Raees',role:'store',canFabric:false}
};
const roll=(code,w,extra)=>Object.assign({rollCode:code,weight:w,gsm:220,unit:'kg',status:'in_stock',sourceFabId:'FAB-001'},extra||{});
const RECEIPTS=[
  {id:'FAB-001',fabCode:'JER-220-01',supplier:'Acme Textiles',date:'2026-10-01'},
  {id:'FAB-002',fabCode:'JER-220-02',supplier:'Acme Textiles',date:'2026-10-08'},
  {id:'FAB-003',fabCode:'RIB-250-01',supplier:'Zeta Mills',date:'2026-10-05'}
];

function app(who,opts){
  opts=opts||{};
  const fs=makeFs();
  const uploads=[];
  const a=loadApp({files:['js/gatepass.js','js/fabric.js'].concat(opts.i18n?['js/ph-i18n.js']:[]),session:SESS[who||'afnan'],globals:Object.assign({},fs.api,{
    _gpEsc:_esc,
    allPasses:[],allFabricInventory:[],allFabricMovements:[],allReturns:[],allGPEditRequests:[],allFabricIn:clone(RECEIPTS),allPOs:[],
    currentPage:'',_fabInvDrillKey:null,_fabInvFilter:'all',_fabInvCatFilter:'',_fabInvSearchQ:'',loadData:async()=>{},
    console:{log:console.log,error:console.error,warn:()=>{},info:()=>{}},
    logActivity:async(act,detail)=>{a.state.activity.push({action:act,detail});},
    confirm:m=>{a.state.confirms.push(String(m));return opts.confirm===undefined?true:opts.confirm;},
    uploadToCloudinary:async f=>{uploads.push({txAtCall:fs.stats.tx,name:f&&f.name});if(opts.uploadFails)throw new Error('network down');return 'https://res.cloudinary.com/demo/image/upload/x.jpg';},
    XLSX:{utils:{aoa_to_sheet:aoa=>({aoa}),book_new:()=>({}),book_append_sheet:(wb,ws)=>{wb.ws=ws;}},writeFile:(wb,name)=>a.sheets.push({aoa:wb.ws.aoa,name})}
  },opts.globals||{})});
  a.fs=fs;a.uploads=uploads;a.sheets=[];
  a.run("window.hrmCloseModal=function(){var b=document.getElementById('hrm-modal-back');if(b&&b.remove)b.remove();}");
  installMint(a);
  return a;
}
function seed(a,rolls,key,type,gsm,color){
  key=key||K1;type=type||'Jersey';gsm=gsm||220;color=color||'Black';
  const doc={key,fabType:type,gsm,color,unit:'kg',rolls:clone(rolls),
    totalWeight:rolls.filter(r=>(r.status||'in_stock')==='in_stock').reduce((n,r)=>n+r.weight,0),lastMovementAt:1};
  a.fs.store.set('fabric_inventory/'+key,doc);
  a.ctx.allFabricInventory.push(Object.assign(clone(doc),{_id:key}));
}
const inv=(a,key)=>a.fs.store.get('fabric_inventory/'+(key||K1));
const rollOf=(a,code,key)=>(inv(a,key).rolls||[]).find(r=>r.rollCode===code);
const movs=a=>a.fs.keys('fabric_movements/').map(k=>a.fs.store.get(k));
const lastToast=a=>a.state.toasts[a.state.toasts.length-1]||'';
async function attempt(p){try{return{res:await p};}catch(e){return{err:e};}}

// The modal's fields, the way a person fills them (the harness cannot parse the modal's HTML).
function fillModal(a,o){
  o=o||{};
  a.el('fdf-note').value=o.note==null?'two holes near the selvedge':o.note;
  a.el('fdf-gsm').value=String(o.gsm==null?'198':o.gsm);
  a.el('fdf-weight').value=String(o.weight==null?'24.5':o.weight);
  a.el('fdf-photo').files=o.photo?[{name:'p.jpg'}]:[];
  a.ctx.document.querySelector=sel=>(/aria-pressed="true"/.test(sel)&&o.reason!==null)?{getAttribute:()=>o.reason||'Holes/stains'}:null;
}
const markedAt=(a,code,key)=>rollOf(a,code,key).status==='defective';

module.exports=async function(){
  const s=suite('fabric-defects');

  // ═══ 1 — marking ═════════════════════════════════════════════════════
  s.section('mark — Kashif (a viewer with canFabric) marks a roll; status, record, totals, movement');
  {
    const a=app('kashif');seed(a,[roll('R1',24.5),roll('R2',30)]);
    a.run("fabActiveTab='stock'");
    await a.run('window.fabDefectOpen("R1")');
    s.eq('the modal opens for Kashif',a.bodyCount('hrm-modal-back'),1);
    s.ok('and shows the six reasons',['Shade variation','Holes/stains','Wrong GSM','Short weight','Wrong colour','Other'].every(r=>a.bodyHtml('hrm-modal-back').includes(r)));
    s.ok('the GSM and weight are prefilled from the roll',/id="fdf-gsm"[^>]*value="220"/.test(a.bodyHtml('hrm-modal-back'))&&/id="fdf-weight"[^>]*value="24.5"/.test(a.bodyHtml('hrm-modal-back')));
    s.ok('supplier, lot and receipt are derived from the receipt',/Acme Textiles/.test(a.bodyHtml('hrm-modal-back'))&&/JER-220-01/.test(a.bodyHtml('hrm-modal-back')));
    fillModal(a,{photo:true});
    await a.run('window.fabDefectSave("R1")');
    s.eq('R1 is defective',rollOf(a,'R1').status,'defective');
    s.eq('with the reason',rollOf(a,'R1').defect.reason,'Holes/stains');
    s.eq('the measured gsm',rollOf(a,'R1').defect.gsmMeasured,198);
    s.eq('who marked it',rollOf(a,'R1').defect.by,'Uzaib');
    s.ok('the photo URL is kept',/res\.cloudinary\.com/.test(rollOf(a,'R1').defect.photoUrl));
    s.eq('the photo was uploaded BEFORE the transaction',a.uploads[0]&&a.uploads[0].txAtCall,0);
    s.eq('the other roll is untouched',rollOf(a,'R2').status,'in_stock');
    s.eq('totals drop the defective roll',inv(a).totalWeight,30);
    s.eq('one movement row, subtype defect',J(movs(a).map(m=>m.subtype)),'["defect"]');
    s.ok('and the person was told',/marked defective/.test(lastToast(a)),lastToast(a));
    s.eq('the in-memory stock follows',a.run('allFabricInventory[0].rolls[0].status'),'defective');
  }
  s.section('mark — no reason picked: nothing is written');
  {
    const a=app('kashif');seed(a,[roll('R1',10)]);
    await a.run('window.fabDefectOpen("R1")');
    fillModal(a,{reason:null});
    await a.run('window.fabDefectSave("R1")');
    s.eq('still in stock',rollOf(a,'R1').status,'in_stock');
    s.eq('no transaction ran',a.fs.stats.tx,0);
    s.ok('asks for the reason',/what is wrong/i.test(lastToast(a)),lastToast(a));
  }
  s.section('mark — a failed photo upload asks; "no" saves nothing, "yes" saves without a photo');
  {
    const no=app('kashif',{uploadFails:true,confirm:false});seed(no,[roll('R1',10)]);
    await no.run('window.fabDefectOpen("R1")');fillModal(no,{photo:true});
    await no.run('window.fabDefectSave("R1")');
    s.ok('it asked',no.state.confirms.some(c=>/without a photo/.test(c)),J(no.state.confirms));
    s.eq('declined: the roll is untouched',rollOf(no,'R1').status,'in_stock');
    s.eq('declined: no transaction',no.fs.stats.tx,0);
    const yes=app('kashif',{uploadFails:true,confirm:true});seed(yes,[roll('R1',10)]);
    await yes.run('window.fabDefectOpen("R1")');fillModal(yes,{photo:true});
    await yes.run('window.fabDefectSave("R1")');
    s.eq('accepted: marked defective',rollOf(yes,'R1').status,'defective');
    s.eq('accepted: with no photo',rollOf(yes,'R1').defect.photoUrl,'');
  }
  s.section('mark — only a roll that is in stock; view-only and non-fabric accounts cannot');
  {
    const a=app('kashif');seed(a,[roll('R1',10,{status:'issued',issuedTo:'GP-1'}),roll('R2',10,{status:'reserved',reservedPO:'PO-1'}),roll('R3',10,{status:'defective',defect:{reason:'x'}})]);
    for(const c of ['R1','R2','R3']){await a.run(`window.fabDefectOpen("${c}")`);}
    s.eq('no modal for an issued / reserved / already-defective roll',a.bodyCount('hrm-modal-back'),0);
    s.ok('and the last message says why',/already marked defective/.test(lastToast(a)),lastToast(a));
    const r=app('raees');seed(r,[roll('R1',10)]);
    await r.run('window.fabDefectOpen("R1")');
    s.eq('Raees (no canFabric) gets no modal',r.bodyCount('hrm-modal-back'),0);
    const c=app('afnan',{globals:{isCsrLead:()=>true}});seed(c,[roll('R1',10)]);
    await c.run('window.fabDefectOpen("R1")');
    s.eq('the view-only CSR lead gets none either',c.bodyCount('hrm-modal-back'),0);
  }

  // ═══ 2 — undo and return: owners + Mustafa ═══════════════════════════
  s.section('undo — Kashif refused (UI and engine), Arfat refused, Mustafa and an owner allowed');
  {
    const mk=who=>{const a=app(who);seed(a,[roll('R1',10,{status:'defective',defect:{reason:'Wrong GSM',by:'Uzaib',at:5}})]);return a;};
    const k=mk('kashif');
    await k.run('window.fabDefUndo("R1")');
    s.eq('Kashif: UI refuses',rollOf(k,'R1').status,'defective');
    s.ok('Kashif: says who can',/owners and Mustafa/.test(lastToast(k)),lastToast(k));
    const eng=await attempt(k.run('_fabInvUpsert({fabType:"Jersey",gsm:220,color:"Black",unit:"kg",undefectRollCodes:["R1"]})'));
    s.eq('Kashif: the ENGINE refuses too',eng.err&&eng.err.code,'fabric/not-permitted');
    s.eq('Kashif: still defective',rollOf(k,'R1').status,'defective');
    const ar=mk('arfat');await ar.run('window.fabDefUndo("R1")');
    s.eq('Arfat (manager, not Mustafa): refused',rollOf(ar,'R1').status,'defective');
    const m=mk('mustafa');await m.run('window.fabDefUndo("R1")');
    s.eq('Mustafa: back in stock',rollOf(m,'R1').status,'in_stock');
    s.eq('Mustafa: movement defect_undo',movs(m)[0]&&movs(m)[0].subtype,'defect_undo');
    const o=mk('afnan');await o.run('window.fabDefUndo("R1")');
    s.eq('an owner: back in stock',rollOf(o,'R1').status,'in_stock');
  }
  s.section('return selected to vendor — owners + Mustafa; one transaction across buckets');
  {
    const mk=who=>{
      const a=app(who);
      seed(a,[roll('R1',10,{status:'defective',defect:{reason:'Wrong GSM'}}),roll('R9',5)]);
      seed(a,[roll('B1',6,{sourceFabId:'FAB-003',status:'defective',defect:{reason:'Holes/stains'}})],K2,'Rib',250,'Black');
      a.ctx.document.querySelectorAll=sel=>/fab-def-cb:checked/.test(sel)?[{dataset:{key:K1,roll:'R1'}},{dataset:{key:K2,roll:'B1'}}]:[];
      a.el('fab-def-ref').value='RTV-9';
      return a;};
    const k=mk('kashif');
    await k.run('window.fabDefReturn()');
    s.eq('Kashif: refused',rollOf(k,'R1').status,'defective');
    s.eq('Kashif: nothing ran',k.fs.stats.tx,0);
    const m=mk('mustafa');
    await m.run('window.fabDefReturn()');
    s.eq('Mustafa: first bucket returned',rollOf(m,'R1').status,'returned_supplier');
    s.eq('Mustafa: second bucket returned',rollOf(m,'B1',K2).status,'returned_supplier');
    s.eq('ONE transaction',m.fs.stats.tx,1);
    s.eq('the ref is on the roll',rollOf(m,'R1').returnRef,'RTV-9');
    s.eq('the defect record survives the return',rollOf(m,'R1').defect.reason,'Wrong GSM');
    s.ok('the reason says what was wrong (mixed)',/Wrong GSM/.test(rollOf(m,'R1').returnReason)&&/Holes\/stains/.test(rollOf(m,'R1').returnReason),rollOf(m,'R1').returnReason);
    s.eq('two movements, both return_out',J(movs(m).map(x=>x.subtype)),'["return_out","return_out"]');
    s.eq('an untouched in-stock roll stays',rollOf(m,'R9').status,'in_stock');
    // someone else issued... a defective roll can't be; but a roll that left the bucket aborts everything
    const g=mk('afnan');
    g.fs.store.get('fabric_inventory/'+K2).rolls[0].status='returned_supplier';   // a second device returned B1 first
    const before=J([inv(g),inv(g,K2)]);
    await g.run('window.fabDefReturn()');
    s.eq('a roll gone on the server: NOTHING moves (first bucket untouched)',J([inv(g),inv(g,K2)]),before);
  }

  // ═══ 3 — refusals elsewhere ═══════════════════════════════════════════
  s.section('the issue picker refuses a defective roll; edit and delete say defective');
  {
    const a=app('afnan');seed(a,[roll('R1',10,{status:'defective',defect:{reason:'x'}}),roll('R2',10)]);
    a.run('_fabIssueRolls=[]');
    await a.run('_fabIssueAdd("R1")');
    s.eq('not added',a.run('_fabIssueRolls.length'),0);
    s.ok('and it says defective',/marked defective/.test(lastToast(a)),lastToast(a));
    await a.run('_fabIssueAdd("R2")');
    s.eq('a good roll still goes in',a.run('_fabIssueRolls.length'),1);
    await a.run('window.deleteFabricRoll("FAB-001","R1")');
    s.ok('delete: wording mentions defective',/marked defective/.test(lastToast(a)),lastToast(a));
    await a.run('window.editFabricRoll("FAB-001","R1")');
    s.ok('edit: wording mentions defective',/marked defective/.test(lastToast(a)),lastToast(a));
    a.ctx.document.getElementById('fab-iss-stock').value=K1;
    a.run('window.fabIssuePickStock()');
    const html=a.el('fab-iss-checklist').innerHTML;
    s.ok('the checklist does not list the defective roll',!/data-roll="R1"/.test(html)&&/data-roll="R2"/.test(html),html.slice(0,200));
    s.ok('the checklist row carries the small flag',/fdf-flag/.test(html)&&/fabDefectOpen\('R2'\)/.test(html));
    const k=app('raees');seed(k,[roll('R2',10)]);k.ctx.document.getElementById('fab-iss-stock').value=K1;k.run('window.fabIssuePickStock()');
    s.ok('no flag for an account that cannot mark',!/fdf-flag/.test(k.el('fab-iss-checklist').innerHTML));
  }

  // ═══ 4 — the tab ═════════════════════════════════════════════════════
  const grouped=who=>{
    const a=app(who||'afnan');
    seed(a,[
      roll('R1',10,{status:'defective',defect:{reason:'Wrong GSM',note:'light',by:'Uzaib',at:1e12}}),
      roll('R2',20,{status:'defective',defect:{reason:'Holes/stains'}}),
      roll('R3',30,{sourceFabId:'FAB-002',status:'defective',defect:{reason:'Shade variation'}}),
      roll('R4',40,{status:'returned_supplier',returnRef:'RTV-1',returnReason:'Wrong GSM',returnedToSupplierAt:1e12,defect:{reason:'Wrong GSM'}}),
      roll('R5',50),                                                  // plain stock: never on the tab
      roll('R6',60,{status:'returned_supplier'})                      // returned for another reason: not a defect
    ]);
    seed(a,[roll('B1',6,{sourceFabId:'FAB-003',status:'defective',defect:{reason:'Other'}})],K2,'Rib',250,'Black');
    return a;
  };
  s.section('tab — grouped supplier → lot with roll and kg totals; plain stock and non-defect returns stay out');
  {
    const a=grouped();
    const g=a.run('_fabDefectGroups(_fabDefectFiltered())');
    s.eq('two suppliers, A→Z',J(g.map(x=>x.supplier)),'["Acme Textiles","Zeta Mills"]');
    s.eq('Acme: 4 rolls and 100 kg (R1+R2+R3+R4)',J([g[0].rolls,g[0].kg]),'[4,100]');
    s.eq('Acme has two lots, newest receipt first',J(g[0].lots.map(l=>l.lotId)),'["FAB-002","FAB-001"]');
    s.eq('lot FAB-001: 3 rolls, 70 kg',J([g[0].lots[1].rolls,g[0].lots[1].kg]),'[3,70]');
    s.eq('Zeta: one roll, 6 kg',J([g[1].rolls,g[1].kg]),'[1,6]');
    const html=a.run('renderFabricReturnsTab()');
    s.ok('the tab shows each supplier, lot code and total',/Acme Textiles/.test(html)&&/JER-220-01/.test(html)&&/4 rolls · 100\.0 kg/.test(html),html.slice(0,300));
    const card=html.split('Return to supplier')[0];
    s.ok('plain stock and a non-defect return are not listed in the defects card',!/>R5</.test(card)&&!/>R6</.test(card));
    s.ok('an owner sees checkboxes for the defective ones only',(html.match(/class="fab-def-cb"/g)||[]).length===4);
    s.ok('and the Return and Undo controls',/Return selected to vendor/.test(html)&&/Undo defective/.test(html));
    s.ok('the existing supplier-return form is still on the tab',/Return to supplier/.test(html));
  }
  s.section('tab — filters, search and the Excel export agree');
  {
    const a=grouped();
    a.run("_fabDefSup='Acme Textiles'");
    s.eq('supplier filter',a.run('_fabDefectFiltered().length'),4);
    a.run("_fabDefState='returned'");
    s.eq('returned only',J(a.run('_fabDefectFiltered().map(x=>x.roll.rollCode)')),'["R4"]');
    a.run("_fabDefState='defective'");
    s.eq('defective only',a.run('_fabDefectFiltered().length'),3);
    a.run("_fabDefQ='r2'");
    s.eq('roll-code search (any case)',J(a.run('_fabDefectFiltered().map(x=>x.roll.rollCode)')),'["R2"]');
    const rows=a.run('_fabDefectExportRows()');
    s.eq('the export is the header plus exactly the rows shown',rows.length,2);
    s.eq('with the roll, supplier and reason',J([rows[1][0],rows[1][4],rows[1][11]]),'["Acme Textiles","R2","Holes/stains"]');
    a.run("_fabDefQ='';_fabDefState='all';_fabDefSup=''");
    s.eq('all rows = 5 data rows + header',a.run('_fabDefectExportRows().length'),6);
    await a.run('window.fabExportDefects()');
    s.eq('one workbook written',a.sheets.length,1);
    s.ok('named for the defects',/fabric-defects/.test(a.sheets[0].name),a.sheets[0].name);
    const ret=a.run('_fabDefectExportRows()').find(r=>r[4]==='R4');
    s.eq('a returned roll exports its ref and state',J([ret[10],ret[18]]),'["Returned","RTV-1"]');
  }
  s.section('tab — hostile text from a roll or its note is only ever drawn as text');
  {
    const evil='<img src=x onerror=alert(1)>';
    const a=app('afnan');
    seed(a,[roll('R<b>1',10,{status:'defective',defect:{reason:evil,note:evil,by:evil,photoUrl:'javascript:alert(1)'}})]);
    a.ctx.allFabricIn=[{id:'FAB-001',fabCode:evil,supplier:evil,date:evil}];
    const html=a.run('renderFabricReturnsTab()');
    s.ok('no raw tag from any stored string',!/<img src=x/.test(html)&&!/<b>1/.test(html),html.match(/.{0,40}onerror.{0,20}/)&&html.match(/.{0,40}onerror.{0,20}/)[0]);
    s.ok('it is there, escaped',/&lt;img src=x onerror=alert\(1\)&gt;/.test(html));
    s.ok('a non-https photo address is never a link',!/javascript:/.test(html));
    const sheet=a.run('_fabDefectExportRows()[1]');
    s.eq('and the export carries no photo link for it',sheet[17],'');
    const drill=a.run('_fabRollDetail(allFabricInventory[0].rolls[0])');
    s.ok('the stock drill detail line escapes it too',!/<img src=x/.test(drill)&&/&lt;img/.test(drill),drill.slice(0,160));
  }

  // ═══ 5 — KPI, label, view-only ════════════════════════════════════════
  s.section('stock tab — the Defective tile replaces Reserved');
  {
    const a=grouped();
    a.ctx.allFabricInventory.forEach(x=>{x.reservedWeight=9;});
    const html=a.run('renderFabricInventory()');
    s.ok('Defective tile: rolls · kg',/Defective<\/div>\s*<div[^>]*>4 · 66\.0 kg/.test(html)||/4 · 66\.0 kg/.test(html),(html.match(/Defective.{0,200}/)||[''])[0]);
    s.ok('no Reserved tile any more',!/>Reserved</.test(html));
    const b=app('afnan');seed(b,[roll('R1',5)]);
    s.ok('nothing defective reads a dash',/Defective<\/div>\s*<div[^>]*>—/.test(b.run('renderFabricInventory()')));
    const drill=a.run('_renderFabInvDrill("'+K1+'")');
    s.ok('the drill shows Mark defective on an in-stock roll',/fabDefectOpen\('R5'\)/.test(drill)&&!/fabDefectOpen\('R1'\)/.test(drill));
  }
  s.section('tab label and the view-only CSR lead');
  {
    const a=app('afnan');
    s.ok('the Returns tab is now Defects & Returns',/id="fabtab-returns"[^>]*>Defects &amp; Returns<|id="fabtab-returns"[^>]*>Defects & Returns</.test(a.run('renderFabricPage()')));
    const c=app('afnan',{globals:{isCsrLead:()=>true}});seed(c,[roll('R1',10,{status:'defective',defect:{reason:'Wrong GSM'}}),roll('R2',5)]);
    s.ok('the CSR lead still sees the tab in the bar',/fabtab-returns/.test(c.run('renderFabricPage()')));
    c.run("window.switchFabTab('returns')");
    s.eq('and opens it (not bounced to Stock)',c.run('fabActiveTab'),'returns');
    const html=c.run('renderFabricReturnsTab()');
    s.ok('it lists the defective roll',/>R1</.test(html));
    s.ok('but draws NO action: no scan, no checkbox, no undo, no return, no supplier form',!/fab-def-scan|fab-def-cb|Undo defective|Return selected to vendor|Return to supplier/.test(html),html.match(/fab-def-scan|fab-def-cb|Undo defective|Return selected|Return to supplier/g));
    s.ok('export is still there',/fabExportDefects/.test(html));
    const k=app('kashif');seed(k,[roll('R1',10,{status:'defective',defect:{reason:'x'}})]);
    const kh=k.run('renderFabricReturnsTab()');
    s.ok('Kashif sees the scan but no Undo / Return',/fab-def-scan/.test(kh)&&!/Undo defective|Return selected to vendor|fab-def-cb/.test(kh));
  }

  // ═══ 6 — WP-F3: the supplier-return form is ONE transaction ═════════════
  s.section('supplier-return form — several fabrics, ONE transaction; a refusal leaves every bucket untouched');
  {
    const mk=(who)=>{
      const a=app(who);
      seed(a,[roll('R1',10),roll('R2',20)]);
      seed(a,[roll('B1',6,{sourceFabId:'FAB-003'}),roll('B2',7,{sourceFabId:'FAB-003'})],K2,'Rib',250,'Black');
      a.el('fab-sret-reason').value='Excess';a.el('fab-sret-note').value='too much';
      a.ctx.document.querySelectorAll=sel=>/fab-sret-cb:checked/.test(sel)?[
        {dataset:{key:K1,roll:'R1',supplier:'Acme Textiles'}},{dataset:{key:K1,roll:'R2',supplier:'Acme Textiles'}},
        {dataset:{key:K2,roll:'B1',supplier:'Zeta Mills'}}]:[];
      return a;};
    const ok=mk('kashif');                                   // in-stock returns are still open to the fabric team
    await ok.run('window.submitFabRetSupplier()');
    s.eq('first bucket returned',J([rollOf(ok,'R1').status,rollOf(ok,'R2').status]),'["returned_supplier","returned_supplier"]');
    s.eq('second bucket returned',rollOf(ok,'B1',K2).status,'returned_supplier');
    s.eq('exactly ONE transaction for both fabrics',ok.fs.stats.tx,1);
    s.eq('the untouched roll stays',rollOf(ok,'B2',K2).status,'in_stock');
    s.ok('each bucket\'s movement names ITS supplier',movs(ok).some(m=>/Acme Textiles/.test(m.note))&&movs(ok).some(m=>/Zeta Mills/.test(m.note)),J(movs(ok).map(m=>m.note)));
    s.ok('the reason with its note is on the roll',rollOf(ok,'R1').returnReason==='Excess — too much',rollOf(ok,'R1').returnReason);
    const bad=mk('mustafa');
    bad.fs.store.get('fabric_inventory/'+K2).rolls[0].status='issued';       // another phone issued B1 meanwhile
    const before=J([inv(bad),inv(bad,K2)]);
    await bad.run('window.submitFabRetSupplier()');
    s.eq('a roll that left stock in the SECOND fabric: the first is NOT returned',J([inv(bad),inv(bad,K2)]),before);
    s.eq('no movement rows',movs(bad).length,0);
    s.ok('and the person is told which roll and that nothing was saved',/B1/.test(lastToast(bad))&&/Nothing was saved/.test(lastToast(bad)),lastToast(bad));
  }

  s.section('Urdu — Urdu-first accounts read اردو — English on the labels; English stays English; the stored reason never changes');
  {
    const k=app('kashif',{i18n:true});seed(k,[roll('R1',10)]);
    const html=k.run('renderFabricReturnsTab()');
    s.ok('the tab title carries Urdu',/خراب رولز اور واپسی/.test(k.run('renderFabricPage()')),k.run('renderFabricPage()').match(/fabtab-returns.{0,80}/)[0]);
    await k.run('window.fabDefectOpen("R1")');
    const modal=k.bodyHtml('hrm-modal-back');
    s.ok('the reason chips carry Urdu AND keep the English value',/data-reason="Holes\/stains"[^>]*>[^<]*سوراخ/.test(modal),modal.match(/data-reason="Holes[^]{0,120}/)[0]);
    fillModal(k);
    await k.run('window.fabDefectSave("R1")');
    s.eq('the STORED reason is the English one',rollOf(k,'R1').defect.reason,'Holes/stains');
    s.ok('the row shows the Urdu label',/سوراخ/.test(k.run('renderFabricReturnsTab()')));
    const en=app('afnan',{i18n:true});seed(en,[roll('R1',10)]);
    en.run("phI18nSetLang('en')");
    s.ok('English view: no Urdu on the tab title',!/[\u0600-\u06FF]/.test(en.run('renderFabricPage()')));
    const keys=['fab.tab_defects','fab.mark_defective','fab.save_defect','fab.undo_defective','fab.return_selected','fab.return_ref','fab.defective','fab.returned','fab.export','fab.scan_ph','fab.reason_shade','fab.reason_holes','fab.reason_gsm','fab.reason_short','fab.reason_colour','fab.reason_other'];
    s.ok('all 16 keys exist, have Urdu and are flagged for review',keys.every(x=>en.run('phI18nHas("'+x+'")')&&/[\u0600-\u06FF]/.test(en.run('PH_I18N_STR["'+x+'"].ur'))&&en.run('PH_I18N_STR["'+x+'"].review')===true));
    s.ok('the screen uses exactly the reason keys the table has',/fab\.reason_shade/.test(require('fs').readFileSync(__dirname+'/../js/fabric.js','utf8')));
  }

  return s;
};

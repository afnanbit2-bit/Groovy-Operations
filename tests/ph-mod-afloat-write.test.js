/* Production Ops ▸ Afloat POs, the WRITE screens (QC6, 15 Oct 2026): js/ph-mod-afloat.js's "+ Receive units" sheet (edit -> Review and
   save -> Save lot), "Lock cut now", "Close PO", "Void…", the day-and-time stamps, and the two side-edits (js/pos.js completeQC refuses
   while a reconciliation is open; js/production.js Packing ▸ Receiving is a pointer for Faizan).

   What this drives: the REAL js/ph-core.js, ph-data.js, ph-write.js, ph-qc-write.js (the QC4 writers), ph-i18n.js, ph-ui.js and the
   module, over tests/ph-dom.js and an in-memory Firestore with REAL transaction semantics (reads before writes, all-or-nothing commit,
   dotted update paths applied as Firestore applies them) that records every read and write. The clock is fixed and moved by the test.
     · the owner's scenario: a 120-piece PO cut 20/40/40/20 received in THREE lots on THREE days (Mon 4:00 PM PKT 10/15/10/5, Wed
       9:05 AM 5/15/20/0, Thu 12:05 AM 5/10/10/15): receiving after lots 1 and 2 (nobody can close, no lot refused as short), exact
       after lot 3, Faizan closes; each lot keeps its own 12-hour PKT stamp; the earlier lots' stored documents are byte-for-byte
       unchanged after every later lot; the close writes the classic Final QC fields and the reconciliation's closed row
     · every visit starts BLANK, "+ Receive units" is there on every visit until the close, an unsaved draft writes nothing and is not kept
     · a lot over cut + allowance refused INLINE (nothing saved), offline, a double press (one lot), two phones at once (stale: the latest
       copy reloaded, the numbers kept, no lost or duplicated lot), void (own < 24 h yes; another person's or > 24 h no; a manager yes)
     · Faizan cannot close a short PO; a manager sees the close disabled with the QC7 line; Kashif and others get no write control
     · nothing on the tab edits a saved entry; the writers have no path that rewrites a lot, a lock or a close
     · the stamps: hand-computed 12-hour PKT strings (morning, noon, midnight, 12:05 AM, a single-digit hour, both sides of midnight),
       in a child process under a FOREIGN device timezone, with and without js/hrm.js formatTime12hr
     · the classic completeQC refusal (and its normal behaviour with no reconciliation), the Packing ▸ Receiving pointer
   What it does NOT prove: the rules (tests/rules-emulator-ph.js), geometry (tests/smoke-layout.js), real Firestore, a real phone. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-afloat.js');
const UI=read('js/ph-ui.js');
const J=JSON.stringify;
const DAY=86400000;
// Fixed moments (PKT = UTC+5): hand-computed
const MON_4PM=Date.UTC(2026,9,12,11,0,0);       // Mon 12 Oct 2026, 4:00 PM PKT
const WED_905=Date.UTC(2026,9,14,4,5,0);        // Wed 14 Oct 2026, 9:05 AM PKT
const THU_0005=Date.UTC(2026,9,14,19,5,0);      // Thu 15 Oct 2026, 12:05 AM PKT (still 14 Oct in UTC)
const WED_2359=Date.UTC(2026,9,14,18,59,0);     // Wed 14 Oct 2026, 11:59 PM PKT
const THU_NOON=Date.UTC(2026,9,15,7,0,0);       // Thu 15 Oct 2026, 12:00 PM PKT
const CLK={now:MON_4PM};
class FixedDate extends Date{
  constructor(...a){if(a.length===0)super(CLK.now);else super(...a);}
  static now(){return CLK.now;}
}
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
  ammar:{uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer',email:'uzaib@groovy.op'},
  faizan:{uid:'u-faizan',u:'faizan',name:'Faizan',role:'packing',email:'faizan@groovy.op'},
  raees:{uid:'u-raees',u:'raees',name:'Raees',role:'store',email:'raees@groovy.op'}
};
const CUT={S:20,M:40,L:40,XL:20};
const STAGES=['cutting','bundling','stitching','printing','washing','qc'];
function cutPo(id,stage,o){
  const stages={};STAGES.forEach(k=>{stages[k]={done:false,doneAt:null,doneBy:null};});
  stages.cutting={done:true,doneAt:'2026-10-10T05:00:00.000Z',doneBy:'Uzaib'};
  return Object.assign({id:id,name:'Athletic Tee · Black',code:'GAT012',qty:120,sizes:Object.assign({},CUT),poStatus:'in_production',currentStage:stage,stages:stages,
    cutQty:Object.assign({},CUT),cutAt:'2026-10-10T05:00:00.000Z',cutBy:'Uzaib',cutDate:'2026-10-10',ts:Date.UTC(2026,8,30),createdAt:'2026-09-30',packingReceipts:[]},o||{});
}
const lock=(by,src)=>({sizes:Object.assign({},CUT),total:120,cutAt:'2026-10-10T05:00:00.000Z',cutBy:'Uzaib',lockedAt:MON_4PM-DAY,lockedBy:by||'faizan',source:src||'first_lot'});
const recon=(id,o)=>Object.assign({poId:id,status:'locked',rev:1,cutLock:lock(),lotCount:0,voidCount:0,lastLotAt:0,overrides:[],legacyIds:[],closedAt:0,closedBy:'',closedByName:'',closeVerdict:null,
  createdAt:MON_4PM-DAY,createdBy:'faizan',updatedAt:MON_4PM-DAY,updatedBy:'faizan',updatedByName:'Faizan'},o||{});
const lotRow=(id,seq,sizes,o)=>Object.assign({poId:id,seq:seq,sizes:sizes,total:Object.values(sizes).reduce((a,b)=>a+b,0),day:'2026-10-12',note:'',at:MON_4PM-3600000*seq,by:'faizan',byName:'Faizan',status:'live',src:'qc'},o||{});

/* ── an in-memory Firestore: transactions buffer their writes and commit all-or-nothing; dotted update keys set nested fields ── */
function makeFake(seed,o){
  o=o||{};
  const store={};const log={reads:[],writes:[],queries:[],tx:0};
  const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  Object.keys(seed||{}).forEach(k=>{store[k]=clone(seed[k]);});
  const has=p=>Object.prototype.hasOwnProperty.call(store,p);
  const snapDoc=p=>({id:p.split('/').pop(),exists:()=>has(p),data:()=>clone(store[p]),metadata:{fromCache:false}});
  const applyUpd=(cur,d)=>{const out=clone(cur)||{};Object.keys(d).forEach(k=>{const parts=k.split('.');let t=out;for(let i=0;i<parts.length-1;i++){if(!t[parts[i]]||typeof t[parts[i]]!=='object')t[parts[i]]={};t=t[parts[i]];}t[parts[parts.length-1]]=clone(d[k]);});return out;};
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/'),isCol:true}),
    where:(f,op,v)=>({where:[f,op,v]}),limit:n=>({limit:n}),orderBy:(f,d)=>({orderBy:[f,d]}),
    query:(c,...cons)=>({path:c.path,wheres:cons.filter(x=>x&&x.where).map(x=>x.where),limit:(cons.filter(x=>x&&x.limit!==undefined)[0]||{}).limit}),
    getDoc:async r=>{log.reads.push(r.path);if(o.getDocErr&&o.getDocErr[r.path])throw o.getDocErr[r.path]();return snapDoc(r.path);},
    getDocs:async q=>{
      log.queries.push({path:q.path,wheres:q.wheres});
      let docs=Object.keys(store).filter(k=>k.indexOf(q.path+'/')===0&&k.slice(q.path.length+1).indexOf('/')===-1).sort();
      (q.wheres||[]).forEach(w=>{docs=docs.filter(k=>w[1]==='=='&&store[k][w[0]]===w[2]);});
      if(q.limit!==undefined)docs=docs.slice(0,q.limit);
      return{docs:docs.map(snapDoc),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path,tx:0});store[r.path]=clone(d);},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});store[r.path]=applyUpd(store[r.path],d);},
    addDoc:async(c,d)=>{log.writes.push({op:'add',path:c.path,tx:0});return{id:'x'};},
    deleteDoc:async r=>{log.writes.push({op:'delete',path:r.path,tx:0});delete store[r.path];},
    writeBatch:()=>({set(r){log.writes.push({op:'batch',path:r.path});return this;},update(r){log.writes.push({op:'batch',path:r.path});return this;},delete(){return this;},async commit(){}}),
    runTransaction:async(db,fn)=>{
      const id=++log.tx;const buf=[];
      const tx={
        get:async r=>{log.reads.push(r.path);return snapDoc(r.path);},
        set:(r,d)=>{buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
        update:(r,d)=>{if(!has(r.path)&&!buf.some(b=>b.path===r.path))throw new Error('not-found');buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
        delete:r=>{buf.push({op:'delete',path:r.path});return tx;}
      };
      if(o.beforeTx)await o.beforeTx(store,log);
      const res=await fn(tx);
      buf.forEach(b=>{log.writes.push({op:b.op,path:b.path,tx:id,data:b.data});
        if(b.op==='set')store[b.path]=b.data;else if(b.op==='update')store[b.path]=applyUpd(store[b.path],b.data);else delete store[b.path];});
      return res;
    }
  };
  return{store,log,api};
}
function grab(file,re){const m=re.exec(read(file));if(!m)throw new Error('could not find the helper in '+file);return m[0];}
const FMT12=grab('js/hrm.js',/function formatTime12hr\(timeString\)\{[\s\S]*?\n\}/);
const HELPERS=[
  grab('js/profile.js',/function _profPhotoUrl\(u\)\{[\s\S]*?\n\}/),
  grab('js/shopify.js',/const _SI_AX_IMG_RE=[^\n]*\n/),
  grab('js/shopify.js',/function _siAxImgOk\(u\)\{[^\n]*\}/),
  grab('js/boards.js',/function _boardsDisplayUrl\(url,cardW,card\)\{[\s\S]*?\n\}/)
].join('\n');
const settle=ms=>new Promise(r=>setTimeout(r,ms||30));
function hasC(n,c){return String(n.className||'').split(/\s+/).indexOf(c)>-1;}

// One phone / one session. fk: a shared fake (two phones on one database). opts.src / opts.qcw mutate the module / the writer file.
function mk(user,o){
  o=o||{};
  const fk=o.fk||makeFake(o.seed||{},o);
  const toasts=[];
  const globals=Object.assign({},fk.api,{
    Date:FixedDate,currentPage:'dashboard',allPOs:[],allPasses:[],
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    history:{replaceState(){},pushState(){}},
    auth:{currentUser:{getIdToken:async()=>{}}},
    USER_DEFS:[{u:'mustafa',name:'Mustafa'},{u:'faizan',name:'Faizan'},{u:'afnan',name:'Afnan'},{u:'ammar',name:'Ammar'},{u:'uzaib',name:'Uzaib'}],
    qcDoneBySize:function(){return{};}
  },o.globals||{});
  const files=o.noWriters?['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js']:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-qc-write.js','js/ph-i18n.js'];
  const a=harness.loadApp({files:files.filter(f=>f!=='js/ph-qc-write.js'||!o.qcw),session:USERS[user]||null,globals:globals});
  const ctx=a.ctx;
  if(o.qcw)vm.runInContext(o.qcw,ctx,{filename:'ph-qc-write.js'});
  ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  ctx.window.showPage=function(id){ctx.currentPage=id;if(id==='prod-ops')ctx.phRenderPage(id);return Promise.resolve();};
  ctx.window.startApp=async function(){};
  ctx.console={warn(){},log(){},error(){}};
  ctx.showToast=function(m){toasts.push(String(m));};
  vm.runInContext(HELPERS,ctx,{filename:'helpers.js'});
  if(o.fmt!==false)vm.runInContext(FMT12,ctx,{filename:'hrm-fmt.js'});
  vm.runInContext(UI,ctx,{filename:'ph-ui.js'});
  vm.runInContext(o.src||SRC,ctx,{filename:'ph-mod-afloat.js'});
  a.run('session='+J(USERS[user]||null));
  const T={a,ctx,dom,fk,store:fk.store,log:fk.log,toasts,R:c=>a.run(c),
    text:n=>n?n.textContent:'',
    all:pred=>dom.all(dom.body,pred),
    cls:(c,root)=>dom.byClass(root||dom.body,c),
    id:i=>dom.find(i),
    card:id=>dom.all(dom.body,n=>n.tagName==='BUTTON'&&hasC(n,'phaf-card')&&n.getAttribute('data-po')===id)[0]||null,
    show:async()=>{ctx.currentPage='dashboard';a.run('_phUiTab="afloat"');await ctx.window.showPage('prod-ops');await settle(40);a.run('_phUiTab="afloat";_phUiPaintPanel()');await settle(60);},
    open:async id=>{const c=T.card(id);if(!c)throw new Error('no tile '+id);dom.click(c);await settle(50);},
    back:async()=>{a.run('phqcBack()');await settle(20);},
    click:async i=>{const n=dom.find(i);if(!n)throw new Error('no element #'+i);dom.click(n);await settle(40);},
    type:(size,v)=>{const n=dom.find('phaf-rx-in-'+size);if(!n)throw new Error('no box '+size);n.value=String(v);dom.dispatch(n,'input');},
    fill:sizes=>{Object.keys(sizes).forEach(k=>T.type(k,sizes[k]));},
    lots:()=>Object.keys(fk.store).filter(k=>k.indexOf('po_qc_lots/')===0).sort().map(k=>fk.store[k]),
    lotDocs:()=>{const o2={};Object.keys(fk.store).filter(k=>k.indexOf('po_qc_lots/')===0).forEach(k=>{o2[k]=J(fk.store[k]);});return o2;},
    detail:()=>dom.byClass(dom.body,'phaf-detail')[0]||null,
    sheet:()=>dom.byClass(dom.body,'phaf-sheet')[0]||null,
    // reload the takeover: every module and data-layer copy forgotten, as a fresh page would
    reload:async()=>{a.run('phqcReset();phResetData()');await T.show();}
  };
  return T;
}
// receive one lot through the screens: open the sheet, type, Review and save, Save lot
async function receive(T,poId,sizes,o){
  o=o||{};
  if(!T.sheet()){await T.click('phaf-recv-btn');}
  T.fill(sizes);
  if(o.note!==undefined){const n=T.id('phaf-rx-note');n.value=o.note;T.dom.dispatch(n,'input');}
  await T.click('phaf-rx-review');
  if(o.reviewOnly)return null;
  const p=T.R('phqcSheetSave()');
  const r=await p;await settle(60);
  return r;
}

module.exports=async function(){
  const s=suite('ph-mod-afloat-write');

  /* ── 1. the stamps: hand-computed 12-hour PKT strings ───────────── */
  s.section('stamps: 12-hour clock with AM/PM, in PKT, whatever the device zone');
  {
    const T=mk('faizan');
    const st=ms=>T.R('phqcStamp('+ms+')');
    s.eq('Thu 3:42 PM (the owner\'s example)',st(Date.UTC(2026,9,15,10,42)),'Thu 15 Oct 2026, 3:42 PM');
    s.eq('a morning, single-digit hour: 9:07 AM',st(Date.UTC(2026,9,15,4,7)),'Thu 15 Oct 2026, 9:07 AM');
    s.eq('noon is 12:00 PM',st(THU_NOON),'Thu 15 Oct 2026, 12:00 PM');
    s.eq('midnight is 12:00 AM (and already the next PKT day)',st(Date.UTC(2026,9,14,19,0)),'Thu 15 Oct 2026, 12:00 AM');
    s.eq('12:05 AM',st(THU_0005),'Thu 15 Oct 2026, 12:05 AM');
    s.eq('one minute before midnight PKT: 11:59 PM, the day before',st(WED_2359),'Wed 14 Oct 2026, 11:59 PM');
    s.eq('Monday 4:00 PM',st(MON_4PM),'Mon 12 Oct 2026, 4:00 PM');
    s.eq('with who: "… by Faizan"',T.R('String(phqcStampBy('+MON_4PM+',"Faizan"))'),'Mon 12 Oct 2026, 4:00 PM by Faizan');
    s.eq('an unreadable moment gives no stamp (never "Invalid Date")',J([st(0),T.R('phqcStamp(NaN)'),T.R('phqcStamp("x")')]),J(['','','']));
    s.ok('it reuses js/hrm.js formatTime12hr (loaded) …',T.R('typeof formatTime12hr')==='function');
    const N=mk('faizan',{fmt:false});
    s.ok('… and without it gives the SAME strings (morning, noon, midnight, 12:05, 11:59 PM)',N.R('typeof formatTime12hr')==='undefined'&&[Date.UTC(2026,9,15,4,7),THU_NOON,Date.UTC(2026,9,14,19,0),THU_0005,WED_2359].every(ms=>N.R('phqcStamp('+ms+')')===st(ms)));
  }
  // a FOREIGN device timezone: the same strings (child processes under TZ=America/Los_Angeles and Pacific/Kiritimati)
  const childStamps=(tz,src)=>{
    const script=`const vm=require('vm'),fs=require('fs'),path=require('path');const R=${J(ROOT)};const c={console};c.window=c;vm.createContext(c);
      for(const f of ['js/ph-core.js','js/ph-i18n.js'])vm.runInContext(fs.readFileSync(path.join(R,f),'utf8'),c);
      vm.runInContext(${J(FMT12)},c);vm.runInContext(fs.readFileSync(${J(path.join(ROOT,'js/hrm.js'))},'utf8').slice(0,0),c);
      vm.runInContext(${J(src)},c);
      process.stdout.write(JSON.stringify([${[Date.UTC(2026,9,15,10,42),Date.UTC(2026,9,15,4,7),THU_NOON,Date.UTC(2026,9,14,19,0),THU_0005,WED_2359,MON_4PM].join(',')}].map(m=>c.phqcStamp(m))));`;
    // the script goes in on stdin (QC7: the module grew past the 128 KB a single -e argument may carry: spawn E2BIG)
    return JSON.parse(cp.execFileSync(process.execPath,['-'],{input:script,env:Object.assign({},process.env,{TZ:tz}),encoding:'utf8'}));
  };
  const WANT=['Thu 15 Oct 2026, 3:42 PM','Thu 15 Oct 2026, 9:07 AM','Thu 15 Oct 2026, 12:00 PM','Thu 15 Oct 2026, 12:00 AM','Thu 15 Oct 2026, 12:05 AM','Wed 14 Oct 2026, 11:59 PM','Mon 12 Oct 2026, 4:00 PM'];
  {
    let la,ki;try{la=childStamps('America/Los_Angeles',SRC);ki=childStamps('Pacific/Kiritimati',SRC);}catch(e){la=ki=['threw: '+e.message];}
    s.eq('device zone America/Los_Angeles (UTC−7): the PKT strings',J(la),J(WANT));
    s.eq('device zone Pacific/Kiritimati (UTC+14): the PKT strings',J(ki),J(WANT));
  }

  /* ── 2. the owner's scenario: 120 pieces, three lots on three days, then the close ─── */
  s.section('owner\'s scenario: cut 20/40/40/20, lots 10/15/10/5 (Mon 4:00 PM), 5/15/20/0 (Wed 9:05 AM), 5/10/10/15 (Thu 12:05 AM), close');
  CLK.now=MON_4PM;
  const fk=makeFake({'pos/PO-201':cutPo('PO-201','stitching')});
  let F=mk('faizan',{fk});
  await F.show();
  await F.open('PO-201');
  s.ok('visit 1: "+ Receive units" is a live button for Faizan (no lot yet, cut recorded)',!!F.id('phaf-recv-btn')&&!hasC(F.id('phaf-recv-btn'),'phaf-off'));
  s.ok('… there is no Close button before anything is received',!F.id('phaf-close-btn'));
  await F.click('phaf-recv-btn');
  s.ok('the sheet opens BLANK (every box empty) and says a lot is one delivery to QC',!!F.sheet()&&['S','M','L','XL'].every(k=>F.id('phaf-rx-in-'+k).value==='')&&/One delivery to QC/.test(F.text(F.sheet())));
  s.ok('… with the sizes in the size order (S, M, L, XL), 48px boxes, numeric keypad',J(F.cls('phaf-rx-in').map(n=>n.id))===J(['phaf-rx-in-S','phaf-rx-in-M','phaf-rx-in-L','phaf-rx-in-XL'])&&F.cls('phaf-rx-in').every(n=>n.getAttribute('inputmode')==='numeric'&&n.getAttribute('type')==='number'));
  s.ok('… focus is in the first box (S)',F.ctx.document.activeElement===F.id('phaf-rx-in-S'));
  s.ok('… "Delivered to QC on" defaults to today (PKT), never later than today',F.id('phaf-rx-day').value==='2026-10-12'&&F.id('phaf-rx-day').getAttribute('max')==='2026-10-12'&&F.id('phaf-rx-day').getAttribute('min')==='2026-10-10');
  F.fill({S:10,M:15,L:10,XL:5});
  s.ok('typing updates the hints without a repaint: S "→ 10 still expected after this lot"',/→ 10 still expected after this lot/.test(F.text(F.id('phaf-rx-hint-S')))&&F.cls('phaf-rx-in')[0]===F.id('phaf-rx-in-S'));
  s.ok('… the total line: "This lot: 40 pcs · after this lot: 40 of 120 — still expected S 10 · M 25 · L 30 · XL 15"',/This lot: 40 pcs · after this lot: 40 of 120 — still expected S 10 · M 25 · L 30 · XL 15/.test(F.text(F.id('phaf-rx-total'))));
  s.ok('… an early partial lot is VALID: no refusal shown, Review is enabled',F.id('phaf-rx-problem').textContent===''&&F.id('phaf-rx-review').getAttribute('aria-disabled')===null);
  s.eq('… nothing is written while typing',F.log.writes.length,0);
  await F.click('phaf-rx-review');
  const rv=F.cls('phaf-review')[0];
  s.ok('Review and save: the per-size numbers once more (S 10 → after 10 of 20 … Total 40 → 40 of 120)',!!rv&&F.all(n=>n.tagName==='TR'&&n.parentNode&&n.parentNode.tagName!=='THEAD'&&n.parentNode.parentNode&&hasC(n.parentNode.parentNode,'phaf-rv-table')).map(r=>r.children.map(c=>c.textContent).join('|')).join(';')==='S|10|10|20;M|15|15|40;L|10|10|40;XL|5|5|20;Total|40|40|120');
  s.ok('… and says a saved lot cannot be edited, BEFORE the save',/Once saved, this lot cannot be edited/.test(F.text(rv)));
  s.eq('… still nothing written at the review step',F.log.writes.length,0);
  const r1=await F.R('phqcSheetSave()');await settle(60);
  const lots1=F.lots();
  s.ok('Save lot: lot #1 written in ONE transaction (lot + reconciliation created + packingReceipts mirror + history row)',r1&&r1.ok&&r1.seq===1&&lots1.length===1&&F.log.tx===1&&F.log.writes.filter(w=>w.tx===1).length===4);
  s.ok('… the lot is exactly what was typed, by Faizan, at Mon 4:00 PM PKT, delivered 12 Oct',J(lots1[0].sizes)===J({S:10,M:15,L:10,XL:5})&&lots1[0].total===40&&lots1[0].by==='faizan'&&lots1[0].at===MON_4PM&&lots1[0].day==='2026-10-12');
  s.ok('… the first lot locked the cut (20/40/40/20, source first_lot)',J(F.store['po_qc_recon/PO-201'].cutLock.sizes)===J(CUT)&&F.store['po_qc_recon/PO-201'].cutLock.source==='first_lot');
  s.ok('… the sheet closed and the detail repainted from fresh data (no takeover reload)',!F.sheet()&&!!F.detail());
  s.eq('… the success line carries the stamp, who, the pieces and what is still expected','Lot #1 saved Mon 12 Oct 2026, 4:00 PM by Faizan — 40 pcs delivered to QC. PO-201 has 40 of 120; still expected S 10 · M 25 · L 30 · XL 15.',F.text(F.id('phaf-flash')));
  s.ok('… focus moved to that line',F.ctx.document.activeElement===F.id('phaf-flash'));
  s.ok('… the verdict is RECEIVING and the detail shows still expected per size',/◐receiving/.test(F.text(F.detail()))&&/Still expected per size: S 10 · M 25 · L 30 · XL 15 \(80 pcs\)/.test(F.text(F.detail())));
  s.ok('… nobody can close: Faizan sees Close PO DISABLED with the reason "still expected …"',hasC(F.id('phaf-close-btn'),'phaf-off')&&F.id('phaf-close-btn').disabled===true&&/Close when QC has received the cut: still expected S 10/.test(F.text(F.detail())));
  s.ok('… the lot is listed with its stamp: "Lot #1 · Mon 12 Oct 2026, 4:00 PM by Faizan" / "40 pcs delivered to QC: S 10 · M 15 · L 10 · XL 5"',/Lot #1 · Mon 12 Oct 2026, 4:00 PM by Faizan/.test(F.text(F.detail()))&&/40 pcs delivered to QC: S 10 · M 15 · L 10 · XL 5/.test(F.text(F.detail())));
  s.ok('… "+ Receive units" is still there (the PO stays open for more lots)',!!F.id('phaf-recv-btn')&&!hasC(F.id('phaf-recv-btn'),'phaf-off'));
  const snap1=F.lotDocs();
  // visit 2: leave the tab, reload the takeover, another day
  CLK.now=WED_905;
  await F.back();
  await F.reload();
  await F.open('PO-201');
  s.ok('visit 2 (Wed, after leaving the tab and reloading the takeover): "+ Receive units" is there',!!F.id('phaf-recv-btn')&&!hasC(F.id('phaf-recv-btn'),'phaf-off'));
  await F.click('phaf-recv-btn');
  s.ok('… the sheet starts BLANK (nothing carried over) and the day is today, 14 Oct',['S','M','L','XL'].every(k=>F.id('phaf-rx-in-'+k).value==='')&&F.id('phaf-rx-day').value==='2026-10-14');
  s.ok('… "received so far" comes from ALL saved lots (10/15/10/5) and lot #1 is in "Lots already delivered (1)" with its stamp',
    F.all(n=>n.tagName==='TR'&&n.parentNode&&n.parentNode.tagName!=='THEAD'&&n.parentNode.parentNode&&hasC(n.parentNode.parentNode,'phaf-rx-table')).map(r=>r.children[2].textContent).join(',')==='10,15,10,5'&&/Lots already delivered \(1\)/.test(F.text(F.sheet()))&&/Lot #1 · Mon 12 Oct 2026, 4:00 PM by Faizan/.test(F.text(F.sheet())));
  // a lot that would take S over its cut + allowance (S: 20 cut, allowance 0; 10 received; 11 more = 21)
  const w0=F.log.writes.length;
  F.fill({S:11});
  s.ok('a lot over cut + allowance: the row hint turns red "would be 1 over — allowed 0" at once',/would be 1 over — allowed 0/.test(F.text(F.id('phaf-rx-hint-S')))&&hasC(F.id('phaf-rx-hint-S'),'phaf-rx-hint-bad'));
  s.ok('… the refusal sentence is shown INLINE before saving',/QC cannot receive more than was cut: S has 20 cut, 10 received, this lot adds 11 - the allowance is 0\./.test(F.text(F.id('phaf-rx-problem'))));
  s.ok('… Review and save is aria-disabled',F.id('phaf-rx-review').getAttribute('aria-disabled')==='true');
  await F.click('phaf-rx-review');
  s.ok('… pressing it anyway stays on the numbers, prints the refusal, writes nothing',!F.cls('phaf-review').length&&/QC cannot receive more than was cut/.test(F.text(F.id('phaf-rx-msg')))&&F.log.writes.length===w0);
  s.ok('… and the sheet cannot be saved from the numbers step at all',(await F.R('phqcSheetSave()')).code==='no-sheet'&&F.log.writes.length===w0);
  F.type('S','');
  const r2=await receive(F,'PO-201',{S:5,M:15,L:20,XL:0});
  s.ok('lot #2 (5/15/20/0) saves: seq 2',r2&&r2.ok&&r2.seq===2&&F.lots().length===2);
  s.ok('… lot #1\'s stored document is BYTE-FOR-BYTE what it was',Object.keys(snap1).every(k=>F.lotDocs()[k]===snap1[k]));
  s.ok('… still RECEIVING after lot 2 (75 of 120): nobody can close',/◐receiving/.test(F.text(F.detail()))&&hasC(F.id('phaf-close-btn'),'phaf-off')&&/still expected S 5 · M 10 · L 10 · XL 15/.test(F.text(F.id('phaf-flash'))));
  s.ok('… lot #2 carries its own stamp "Wed 14 Oct 2026, 9:05 AM by Faizan"',/Lot #2 · Wed 14 Oct 2026, 9:05 AM by Faizan/.test(F.text(F.detail())));
  const snap2=F.lotDocs();
  // visit 3: just after midnight PKT, a third day
  CLK.now=THU_0005;
  await F.back();await F.reload();await F.open('PO-201');
  await F.click('phaf-recv-btn');
  s.ok('visit 3 (Thu 12:05 AM PKT): blank again; the day is 15 Oct in PKT (still 14 Oct in UTC)',['S','M','L','XL'].every(k=>F.id('phaf-rx-in-'+k).value==='')&&F.id('phaf-rx-day').value==='2026-10-15');
  const r3=await receive(F,'PO-201',{S:5,M:10,L:10,XL:15},{note:'third rack'});
  s.ok('lot #3 (5/10/10/15) saves: seq 3, 120 of 120',r3&&r3.ok&&r3.seq===3&&F.lots().length===3);
  s.ok('… lots #1 and #2 stored documents unchanged, byte for byte',Object.keys(snap2).every(k=>F.lotDocs()[k]===snap2[k]));
  s.eq('… the success line: exact, can be closed','Lot #3 saved Thu 15 Oct 2026, 12:05 AM by Faizan — 40 pcs delivered to QC. PO-201 is now exact: 120 of 120. It can be closed.',F.text(F.id('phaf-flash')));
  s.ok('… the verdict is EXACT (ready)',/●exact/.test(F.text(F.detail())));
  const lis=F.cls('phaf-lot',F.cls('phaf-lots')[0]);
  s.eq('… the lots are listed OLDEST FIRST, each with its own 12-hour PKT stamp',J(lis.map(li=>F.text(F.cls('phaf-lot-h',li)[0]))),J(['Lot #1 · Mon 12 Oct 2026, 4:00 PM by Faizan','Lot #2 · Wed 14 Oct 2026, 9:05 AM by Faizan','Lot #3 · Thu 15 Oct 2026, 12:05 AM by Faizan']));
  s.ok('… the history lists the lock and the three lots, oldest first, 12-hour',/cut locked Mon 12 Oct 2026, 4:00 PM by Faizan/.test(F.text(F.cls('phaf-hist')[0]))&&/lot #3 saved Thu 15 Oct 2026, 12:05 AM by Faizan/.test(F.text(F.cls('phaf-hist')[0])));
  s.ok('… no 24-hour time anywhere on the detail (no "16:00", "09:05", "00:05")',!/\b(1[3-9]|2[0-3]|0\d):\d\d\b/.test(F.text(F.detail())));
  s.ok('… the lock line: "Cut is final — locked Mon 12 Oct 2026, 4:00 PM by Faizan when the first lot was received"',/Cut is final — locked Mon 12 Oct 2026, 4:00 PM by Faizan when the first lot was received/.test(F.text(F.detail())));
  s.ok('Close PO is now a LIVE button for Faizan',!!F.id('phaf-close-btn')&&!hasC(F.id('phaf-close-btn'),'phaf-off'));
  CLK.now=THU_NOON;
  await F.click('phaf-close-btn');
  const dlg=F.cls('phaf-dlg')[0];
  s.ok('the close confirm: role=dialog aria-modal, "QC received exactly 120 of 120", "cannot be edited", focus on Close PO',!!dlg&&dlg.getAttribute('role')==='dialog'&&dlg.getAttribute('aria-modal')==='true'&&/exactly 120 of 120 on PO-201/.test(F.text(dlg))&&/A closed PO cannot be edited/.test(F.text(dlg))&&F.ctx.document.activeElement===F.id('phaf-dlg-go'));
  const wc=F.log.writes.length;
  await F.click('phaf-dlg-no');
  s.ok('… "Not yet" closes it, writes nothing, focus back on Close PO',!F.cls('phaf-dlg').length&&F.log.writes.length===wc&&F.ctx.document.activeElement===F.id('phaf-close-btn'));
  await F.click('phaf-close-btn');
  const rc=await F.R('phqcDlgGo()');await settle(60);
  const P=F.store['pos/PO-201'],RC=F.store['po_qc_recon/PO-201'];
  s.ok('Faizan closes: the reconciliation is closed (by faizan, verdict exact / ready)',rc&&rc.ok&&RC.status==='closed'&&RC.closedBy==='faizan'&&RC.closedAt===THU_NOON&&RC.closeVerdict.state==='exact'&&RC.closeVerdict.phase==='ready');
  // R1 (16 Oct 2026), a deliberate change: this PO is at STITCHING, so the close does NOT mark Final QC complete (the classic fields
  // need stage qc and every bundle dispositioned, as js/pos.js completeQC does); it carries only the two additive keys, and says why
  s.ok('… and the PO stays at stitching (no classic Final QC fields), carrying the two additive keys; the writer says why',P.currentStage==='stitching'&&P.stages.qc.done===false&&P.stages.qc.doneBy===null&&P.qcReconClosedAt===THU_NOON&&P.qcReconClosedBy==='faizan'
    &&rc.classic&&rc.classic.written===false&&rc.classic.why==='PO is still at stitching');
  s.ok('… lots #1–#3 still byte-for-byte as saved',(()=>{const now=F.lotDocs();return Object.keys(snap2).every(k=>now[k]===snap2[k])&&Object.keys(now).length===3;})());
  s.ok('after the close: "+ Receive units" is GONE, the closed line carries its stamp "✓ Closed Thu 15 Oct 2026, 12:00 PM by Faizan"',!F.id('phaf-recv-btn')&&!F.id('phaf-close-btn')&&/✓ Closed Thu 15 Oct 2026, 12:00 PM by Faizan/.test(F.text(F.detail()))&&/Only an owner can reopen it/.test(F.text(F.detail())));
  s.ok('… the stage does NOT read "Completed — Final QC marked complete" (R1: the PO is still at stitching)',!/Completed — Final QC marked complete/.test(F.text(F.detail()))&&!/reconciliation open/.test(F.text(F.detail())));
  s.ok('… no Void control on any lot of a closed PO, and no Reopen control (QC7)',F.cls('phaf-void').length===0&&!/Reopen/.test(F.text(F.detail())));
  s.ok('… the sheet cannot be opened any more (phqcSheetOpen refuses)',F.R('phqcSheetOpen("PO-201")')===false&&!F.sheet());
  s.ok('… a second close is refused by the writer (a close record is never rewritten)',(await F.R('phQcClose("PO-201",{expectedRev:'+RC.rev+'})')).ok===false&&F.store['po_qc_recon/PO-201'].closedAt===THU_NOON);
  // R1 (16 Oct 2026): the same close of a PO AT Final QC with every bundle dispositioned does mark Final QC complete
  {
    CLK.now=THU_NOON;
    const fq=makeFake({'pos/PO-209':cutPo('PO-209','qc'),'po_qc_recon/PO-209':recon('PO-209',{lotCount:1,rev:1}),'po_qc_lots/PO-209-1792000000001-aaaa':lotRow('PO-209',1,Object.assign({},CUT)),
      'bundles/B9001':{bundleId:'B9001',poId:'PO-209',size:'M',units:60,qcStatus:'pass'},'bundles/B9002':{bundleId:'B9002',poId:'PO-209',size:'L',units:60,qcStatus:'fail',qcReason:'stain'}});
    const Q=mk('faizan',{fk:fq});
    await Q.show();await Q.open('PO-209');await Q.click('phaf-close-btn');
    const rq=await Q.R('phqcDlgGo()');await settle(60);
    const PQ=fq.store['pos/PO-209'];
    s.ok('R1: a PO at QC with every bundle dispositioned: the close writes the classic Final QC fields and says so',rq&&rq.ok&&rq.classic&&rq.classic.written===true&&PQ.currentStage==='completed'&&PQ.stages.qc.done===true&&PQ.stages.qc.doneBy==='Faizan'&&/QC received 120 of 120 \(exact\); 1 bundle failed QC/.test(PQ.stages.qc.notes));
    s.ok('… and the stage reads "Completed — Final QC marked complete"',/Completed — Final QC marked complete/.test(Q.text(Q.detail())));
  }

  /* ── 3. the unsaved draft, the stale revision (two phones), offline, the double press ─── */
  s.section('draft, two phones, offline, double press');
  {
    CLK.now=WED_905;
    const fk2=makeFake({'pos/PO-202':cutPo('PO-202','qc'),'po_qc_recon/PO-202':recon('PO-202',{lotCount:1,rev:1}),'po_qc_lots/PO-202-1792000000001-aaaa':lotRow('PO-202',1,{S:10})});
    const A=mk('faizan',{fk:fk2}),B=mk('mustafa',{fk:fk2});
    await A.show();await B.show();await A.open('PO-202');await B.open('PO-202');
    await A.click('phaf-recv-btn');A.fill({M:10});
    await A.click('phaf-sheet-x');
    s.ok('an unsaved draft: Cancel closes the sheet and NOTHING is written',!A.sheet()&&fk2.log.writes.length===0&&fk2.log.tx===0);
    await A.click('phaf-recv-btn');
    s.ok('… and is not kept: the next sheet is blank',A.id('phaf-rx-in-M').value==='');
    // both phones review a lot against revision 1
    await B.click('phaf-recv-btn');B.fill({L:10});await B.click('phaf-rx-review');
    A.fill({M:10});await A.click('phaf-rx-review');
    const ra=await A.R('phqcSheetSave()');await settle(60);
    const rb=await B.R('phqcSheetSave()');await settle(60);
    s.ok('two phones: the first save wins (lot #2)',ra.ok&&ra.seq===2);
    s.ok('… the second is a STALE refusal and writes nothing',rb.ok===false&&rb.code==='stale'&&fk2.log.tx===2&&Object.keys(fk2.store).filter(k=>k.indexOf('po_qc_lots/')===0).length===2);
    s.ok('… the second phone sees "Someone else just saved a lot …", is back on the numbers, and its numbers are KEPT',/Someone else just saved a lot on PO-202/.test(B.text(B.id('phaf-rx-msg')))&&!B.cls('phaf-review').length&&B.id('phaf-rx-in-L').value==='10');
    s.ok('… and the latest copy is loaded: "received so far" now includes the other phone\'s lot (M 10)',B.all(n=>n.tagName==='TR'&&n.parentNode&&n.parentNode.tagName!=='THEAD'&&n.parentNode.parentNode&&hasC(n.parentNode.parentNode,'phaf-rx-table')).map(r=>r.children[0].textContent+':'+r.children[2].textContent).indexOf('M:10')>-1);
    await B.click('phaf-rx-review');
    const rb2=await B.R('phqcSheetSave()');await settle(60);
    const seqs=Object.keys(fk2.store).filter(k=>k.indexOf('po_qc_lots/')===0).map(k=>fk2.store[k].seq).sort();
    s.ok('… saved again: lot #3; seqs 1,2,3 — none lost, none duplicated',rb2.ok&&rb2.seq===3&&J(seqs)===J([1,2,3])&&fk2.store['po_qc_recon/PO-202'].lotCount===3);
    // offline
    await A.back();await A.reload();await A.open('PO-202');await A.click('phaf-recv-btn');A.fill({XL:1});await A.click('phaf-rx-review');
    A.R('navigator.onLine=false');
    const tx0=fk2.log.tx;
    const ro=await A.R('phqcSheetSave()');await settle(30);
    s.ok('offline: refused out loud IN the sheet, nothing written, no transaction',ro.code==='offline'&&/No connection/.test(A.text(A.id('phaf-rx-msg')))&&fk2.log.tx===tx0&&!!A.sheet());
    A.R('navigator.onLine=true');
    // double press
    const p1=A.R('phqcSheetSave()'),p2=A.R('phqcSheetSave()');
    const d1=await p1,d2=await p2;await settle(60);
    s.ok('a double press saves ONCE (the second press is "busy")',d1.ok===true&&d2.code==='busy'&&Object.keys(fk2.store).filter(k=>k.indexOf('po_qc_lots/')===0).length===4&&fk2.log.tx===tx0+1);
  }

  /* ── 4. void ───────────────────────────────────────────────────── */
  s.section('void: Faizan his own lot within 24 h; not another person\'s, not after 24 h; a manager any lot');
  {
    CLK.now=WED_905;
    const seed={'pos/PO-203':cutPo('PO-203','qc'),'po_qc_recon/PO-203':recon('PO-203',{lotCount:3,rev:3}),
      'po_qc_lots/PO-203-1792000000001-aaaa':lotRow('PO-203',1,{S:10},{at:WED_905-2*3600000,by:'faizan',byName:'Faizan'}),
      'po_qc_lots/PO-203-1792000000002-bbbb':lotRow('PO-203',2,{M:10},{at:WED_905-3600000,by:'mustafa',byName:'Mustafa'}),
      'po_qc_lots/PO-203-1792000000003-cccc':lotRow('PO-203',3,{L:10},{at:WED_905-25*3600000,by:'faizan',byName:'Faizan'})};
    const fk3=makeFake(seed);
    const F3=mk('faizan',{fk:fk3});await F3.show();await F3.open('PO-203');
    const vb=id=>F3.id('phaf-void-PO-203-'+id);
    s.ok('Faizan: Void… on his own lot of 2 h ago only (not Mustafa\'s, not his own 25 h old one)',!!vb('1792000000001-aaaa')&&!vb('1792000000002-bbbb')&&!vb('1792000000003-cccc'));
    s.ok('… a direct call for another person\'s lot or an old one is refused (no dialog)',F3.R('phqcVoidAsk("PO-203","PO-203-1792000000002-bbbb")')===false&&F3.R('phqcVoidAsk("PO-203","PO-203-1792000000003-cccc")')===false&&!F3.cls('phaf-dlg').length);
    const before=J(fk3.store['po_qc_lots/PO-203-1792000000001-aaaa']);
    await F3.click('phaf-void-PO-203-1792000000001-aaaa');
    s.ok('the void confirm: the lot with its stamp, a reason box (focused), Void disabled until 3 characters',/Void lot #1 \(Wed 14 Oct 2026, 7:05 AM by Faizan · 10 pcs: S 10\)/.test(F3.text(F3.cls('phaf-dlg')[0]))&&F3.ctx.document.activeElement===F3.id('phaf-dlg-reason')&&F3.id('phaf-dlg-go').getAttribute('aria-disabled')==='true');
    const ta=F3.id('phaf-dlg-reason');ta.value='ab';F3.dom.dispatch(ta,'input');
    const short=await F3.R('phqcDlgGo()');
    s.ok('… a 2-character reason is refused in the dialog, nothing written',short.code==='invalid'&&/at least 3 characters/.test(F3.text(F3.id('phaf-dlg-msg')))&&fk3.log.tx===0);
    const ta2=F3.id('phaf-dlg-reason');ta2.value='typed S for M';F3.dom.dispatch(ta2,'input');
    s.ok('… with 3+ characters Void is enabled',F3.id('phaf-dlg-go').getAttribute('aria-disabled')===null);
    const rv=await F3.R('phqcDlgGo()');await settle(60);
    const after=fk3.store['po_qc_lots/PO-203-1792000000001-aaaa'];
    s.ok('… voided: status void, voidedBy faizan, the reason; every OTHER field of the lot unchanged',rv.ok&&after.status==='void'&&after.voidedBy==='faizan'&&after.voidReason==='typed S for M'&&(()=>{const b=JSON.parse(before);delete b.status;const a=Object.assign({},after);['status','voidedAt','voidedBy','voidReason'].forEach(k=>delete a[k]);return J(a)===J(b);})());
    s.ok('… listed struck through with the void stamp "void · Wed 14 Oct 2026, 9:05 AM by Faizan · typed S for M"',F3.cls('phaf-lot-void').length===1&&/void · Wed 14 Oct 2026, 9:05 AM by Faizan · typed S for M/.test(F3.text(F3.cls('phaf-lot-void')[0])));
    s.ok('… and the void lot offers no further control (it cannot be un-voided or edited)',!F3.id('phaf-void-PO-203-1792000000001-aaaa'));
    const M3=mk('mustafa',{fk:fk3});await M3.show();await M3.open('PO-203');
    s.ok('a manager (Mustafa): Void… on every LIVE lot, Faizan\'s old one included',!!M3.id('phaf-void-PO-203-1792000000002-bbbb')&&!!M3.id('phaf-void-PO-203-1792000000003-cccc'));
  }

  /* ── 5. who can close; who gets write controls at all ─────────── */
  s.section('a short PO: Faizan cannot close it; a manager sees the QC7 line; Kashif and others get no write control');
  {
    CLK.now=WED_905;
    const seed={'pos/PO-204':cutPo('PO-204','qc'),'po_qc_recon/PO-204':recon('PO-204',{lotCount:1,rev:1}),'po_qc_lots/PO-204-1792000000001-aaaa':lotRow('PO-204',1,{S:20,M:38,L:40,XL:20}),
      'pos/PO-205':cutPo('PO-205','washing')};
    const fk4=makeFake(seed);
    const F4=mk('faizan',{fk:fk4});await F4.show();await F4.open('PO-204');
    s.ok('Faizan on a SHORT PO: no Close button, "Only a manager can close a short PO."',!F4.id('phaf-close-btn')&&/Only a manager can close a short PO\./.test(F4.text(F4.detail())));
    s.ok('… phqcCloseAsk refuses him (no dialog), and the writer refuses a direct close',F4.R('phqcCloseAsk("PO-204")')===false&&(await F4.R('phQcClose("PO-204",{expectedRev:1})')).code==='forbidden');
    s.ok('… but he can still receive more units (the PO is open)',!!F4.id('phaf-recv-btn')&&!hasC(F4.id('phaf-recv-btn'),'phaf-off'));
    const M4=mk('mustafa',{fk:fk4});await M4.show();await M4.open('PO-204');
    // QC7, a deliberate change: the override arrived; the button is LIVE for a manager (tests/ph-mod-afloat-override.test.js drives it)
    s.ok('a manager on the short PO: "Close with a shortfall…" is LIVE (QC7; it was disabled in QC6)',!!M4.id('phaf-close-btn')&&!hasC(M4.id('phaf-close-btn'),'phaf-off')&&M4.id('phaf-close-btn').disabled!==true&&/Close with a shortfall/.test(M4.text(M4.id('phaf-close-btn')))&&!/arrives with the next update/.test(M4.text(M4.detail())));
    await M4.back();await M4.open('PO-205');
    s.ok('a manager on a cut PO with no reconciliation: "Lock cut now" is live',!!M4.id('phaf-lock-btn'));
    await M4.click('phaf-lock-btn');
    s.ok('… the lock confirm lists the cut and says a lock cannot be edited',/Lock the cut of PO-205 as final \(120 pcs: S 20, M 40, L 40, XL 20\)/.test(M4.text(M4.cls('phaf-dlg')[0]))&&/A lock cannot be edited afterwards/.test(M4.text(M4.cls('phaf-dlg')[0])));
    const rl=await M4.R('phqcDlgGo()');await settle(60);
    s.ok('… Lock: po_qc_recon/PO-205 created (manual, by mustafa) and the line "Cut is final — locked Wed 14 Oct 2026, 9:05 AM by Mustafa with “Lock cut now”"',rl.ok&&fk4.store['po_qc_recon/PO-205'].cutLock.source==='manual'&&fk4.store['po_qc_recon/PO-205'].cutLock.lockedBy==='mustafa'&&/Cut is final — locked Wed 14 Oct 2026, 9:05 AM by Mustafa with “Lock cut now”/.test(M4.text(M4.detail())));
    s.ok('… and Lock cut now is gone (a lock is not re-done); a second lock by the writer is refused',!M4.id('phaf-lock-btn')&&(await M4.R('phQcLockCut("PO-205",{expectedRev:1})')).ok===false);
    const F5=mk('faizan',{fk:fk4});await F5.show();await F5.open('PO-205');
    s.ok('Faizan sees no "Lock cut now" (QC5 decision kept: the first lot locks the cut for him)',!F5.id('phaf-lock-btn'));
    for(const u of ['uzaib','raees']){
      const K=mk(u,{fk:fk4});
      s.ok(u+': no Afloat POs tab, and the write helpers refuse him',K.R('JSON.stringify(phTabsFor().map(t=>t.id))').indexOf('afloat')<0&&K.R('phqcSheetOpen("PO-204")')===false&&K.R('phqcCloseAsk("PO-204")')===false&&K.R('phqcLockAsk("PO-205")')===false);
    }
  }

  /* ── 6. nothing edits a saved entry (UI, writers) ─────────────── */
  s.section('saved entries cannot be edited: no control on the tab, no path in the writers');
  {
    const strip=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    const D=F.detail();
    s.ok('the detail holds no input, select or textarea (nothing on a saved lot, lock or close can be typed into)',F.all(n=>/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName)&&D&&(function(x){for(let p=x;p;p=p.parentNode)if(p===D)return true;return false;})(n)).length===0);
    s.ok('… and no button named Edit / Change / Modify / Update anywhere on the tab',F.all(n=>n.tagName==='BUTTON'&&/\b(edit|change|modify|update|correct)\b/i.test(n.textContent)).length===0);
    s.ok('the module calls no writer that rewrites an entry (no edit / update / change function exists for a lot, a lock or a close)',!/\bphQc(Edit|Update|Change|Fix|Set|Rewrite)\w*\s*\(/.test(strip(SRC)));
    const QW=strip(read('js/ph-qc-write.js')),W=strip(read('js/ph-write.js'));
    s.ok('the writers: po_qc_lots is CREATED only with a fresh id (phQcBuildLot -> phQcLotId) in phQcAddLot and phQcAdoptLegacy',(QW.match(/tx\.set\(doc\(db,'po_qc_lots',lot\.id\),lot\.data\)/g)||[]).length===1&&(W.match(/tx\.set\(doc\(db,'po_qc_lots',lot\.id\),lot\.data\)/g)||[]).length===1);
    s.ok('… and UPDATED in exactly one place, phQcVoidLot, with exactly the four void fields',(QW.match(/tx\.update\(lref,/g)||[]).length===1&&/const lpatch=\{status:'void',voidedAt:now,voidedBy:a\.u,voidReason:why\};/.test(QW)&&!/tx\.update\(doc\(db,'po_qc_lots'/.test(QW+W)&&F.R('JSON.stringify(PHQC_LOT_VOID_FIELDS)')===J(['status','voidedAt','voidedBy','voidReason']));
    s.ok('… a void of a void lot is refused (a voided lot is final too)',await (async()=>{const T6=mk('mustafa',{seed:{'pos/PO-206':cutPo('PO-206','qc'),'po_qc_recon/PO-206':recon('PO-206',{lotCount:1,voidCount:1,rev:2}),'po_qc_lots/PO-206-1792000000001-aaaa':lotRow('PO-206',1,{S:10},{status:'void',voidedAt:1,voidedBy:'mustafa',voidReason:'abc'})}});
      const r=await T6.R('phQcVoidLot("PO-206-1792000000001-aaaa","again please")');return r.ok===false&&T6.log.tx===1&&T6.log.writes.length===0;})());
    s.ok('… the cut lock is created only when there is none (phQcLockCut refuses an existing reconciliation) and replaced only by an owner\'s relock (QC7)',/throw _phRefuse\('refused','The cut of '\+poId\+' is already final/.test(W)&&/if\(!phIsOwner\(a\.u\)\)return _phFail\('forbidden','Only an owner \(Afnan or Ammar\) can replace the cut snapshot\.'\);/.test(QW));
    s.ok('… a close record: phQcClose refuses a closed reconciliation; only an owner\'s reopen leaves closed (QC7)',/if\(r\.status==='closed'\)throw _phRefuse\('refused','The QC reconciliation of '\+poId\+' is already closed\.'\);/.test(QW));
  }

  /* ── 7. the classic Final QC button and the old Packing ▸ Receiving tab ─── */
  s.section('side-edits: classic completeQC refuses while a reconciliation is open; Packing ▸ Receiving points Faizan to Afloat POs');
  const POS=read('js/pos.js'),PROD=read('js/production.js');
  const CQC=(/window\.completeQC=async function\(fbKey\)\{[\s\S]*?\n\};/.exec(POS)||[''])[0];
  const runCQC=async(o)=>{
    const T=mk('afnan',{seed:o.seed||{},getDocErr:o.getDocErr,src:o.src});
    const calls={upd:[],toast:[]};
    T.R('globalThis.allPOs=[{fbKey:"PO-301",id:"PO-301",currentStage:"qc"}];globalThis.currentBundles=[];globalThis.confirm=()=>true;globalThis.loadData=async()=>{};');
    T.ctx.updateDoc=async(r,d)=>{calls.upd.push(r.path);};
    T.ctx.showToast=m=>{calls.toast.push(String(m));};
    T.ctx.logActivity=async()=>{};
    if(o.noModule)T.R('phqcCloseBlock=undefined');
    vm.runInContext(o.cqc||CQC,T.ctx,{filename:'completeQC.js'});
    await T.R('window.completeQC("PO-301")');
    return calls;
  };
  {
    s.ok('js/pos.js: completeQC asks phqcCloseBlock first, behind typeof (one line, after the stage check, before the confirm)',/if\(po\.currentStage!=='qc'\)\{[^\n]*\n  if\(typeof phqcCloseBlock==='function'\)\{const qb=await phqcCloseBlock\(po\);if\(qb\)\{showToast\(qb,true\);return;\}\}/.test(POS));
    const open=await runCQC({seed:{'po_qc_recon/PO-301':recon('PO-301',{lotCount:1})}});
    s.ok('a reconciliation is OPEN: Complete QC is refused, NOTHING is written, the toast points to Afloat POs',open.upd.length===0&&/Final QC cannot be completed here: PO-301 has a QC reconciliation that is not closed/.test(open.toast.join(' '))&&/Afloat POs/.test(open.toast.join(' ')));
    const none=await runCQC({seed:{}});
    s.ok('no reconciliation (older POs): the classic flow completes QC as before',none.upd.length===1&&none.upd[0]==='pos/PO-301'&&/QC complete/.test(none.toast.join(' ')));
    const closed=await runCQC({seed:{'po_qc_recon/PO-301':recon('PO-301',{status:'closed',closedAt:1})}});
    s.ok('a CLOSED reconciliation: the classic flow goes on',closed.upd.length===1);
    const perm=await runCQC({getDocErr:{'po_qc_recon/PO-301':()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'})}});
    s.ok('a REFUSED read (rules not published: no reconciliation can exist): fails open, completes',perm.upd.length===1);
    const net=await runCQC({getDocErr:{'po_qc_recon/PO-301':()=>Object.assign(new Error('Failed to get document because the client is offline.'),{code:'unavailable'})}});
    s.ok('any OTHER failed read: refused with "could not be checked", nothing written',net.upd.length===0&&/could not be checked/.test(net.toast.join(' ')));
    const nomod=await runCQC({seed:{'po_qc_recon/PO-301':recon('PO-301',{lotCount:1})},noModule:true});
    s.ok('a build WITHOUT Production Ops (no phqcCloseBlock): exactly the classic behaviour',nomod.upd.length===1);
  }
  const RECV=(/function _receivingListHTML\(\)\{[\s\S]*?\n\}/.exec(PROD)||[''])[0];
  const runRecv=(u,o)=>{
    const T=mk(u,o||{});
    T.R('globalThis._packQ="";globalThis._packOpenPOs=()=>[];globalThis.poCutTotal=()=>0;globalThis.poReceivedTotal=()=>0;globalThis._gpEsc=x=>String(x);globalThis._packListCard=()=>"";');
    vm.runInContext(RECV,T.ctx,{filename:'recv.js'});
    return T.R('_receivingListHTML()');
  };
  {
    s.ok('js/production.js: _receivingListHTML asks phqcPackPointerHTML first, behind typeof (one branch)',/function _receivingListHTML\(\)\{\n  if\(typeof phqcPackPointerHTML==='function'\)\{const qp=phqcPackPointerHTML\(\);if\(qp\)return qp;\}/.test(PROD));
    const f=runRecv('faizan');
    s.ok('Faizan: the Receiving tab is a pointer ("Receiving moved to QC Ops") with a button to Production Ops',/Receiving moved to QC Ops/.test(f)&&/onclick="window\.showPage\('prod-ops'\)"/.test(f)&&!/pack-search/.test(f));
    const a=runRecv('afnan');
    s.ok('a manager keeps the old Receiving list',/pack-search/.test(a)&&!/Receiving moved/.test(a));
    const nm=runRecv('faizan',{src:'/* no module */'});
    s.ok('a build WITHOUT Production Ops: the old list for everyone',/pack-search/.test(nm));
  }

  s.section('wiring: the changed files carry new ?v= tags and the cache version moved past v340');
  {
    const IX=read('index.html'),SW=read('sw.js');
    s.ok('sw.js CACHE_VERSION is v341 or later (QC5 was v340)',+(/CACHE_VERSION = 'v(\d+)'/.exec(SW)||[0,0])[1]>=341);
    // QC7, a deliberate change: main.css, ph-i18n.js and ph-mod-afloat.js changed again and carry the QC7 tags (qc7m / qc7i / qc7a)
    for(const [f,tag] of [['css/main.css','20261015qc7m'],['js/pos.js','20261015qc6p'],['js/production.js','20261015qc6r'],['js/ph-i18n.js','20261015qc7i'],['js/ph-mod-afloat.js','20261015qc7a']])
      s.ok(f+' is loaded with ?v='+tag+' (a tag no other file uses)',IX.indexOf('/'+f+'?v='+tag+'"')>-1&&IX.split('?v='+tag+'"').length===2);
  }

  /* ── 8. breaks: each guard reverted once must fail its named check ─── */
  s.section('breaks: each guard reverted once must fail its named check');
  const mut=(t,a,b)=>{if(t.indexOf(a)<0)throw new Error('break target missing: '+a.slice(0,60));return t.split(a).join(b);};
  const brk=async(label,expect,fn)=>{let r;try{r=await fn();}catch(e){r='threw: '+e.message;}s.ok('break "'+label+'" fails "'+expect+'"',r===false);};
  const QCW=read('js/ph-qc-write.js');
  // a scenario: the 120-piece PO with lot 1 saved, through the screens, on a mutated module / writer
  const lot1With=async(o)=>{CLK.now=MON_4PM;const T=mk('faizan',Object.assign({seed:{'pos/PO-201':cutPo('PO-201','stitching')}},o||{}));await T.show();await T.open('PO-201');await T.click('phaf-recv-btn');return T;};
  await brk('24-hour clock (the 12-hour conversion bypassed)','Thu 3:42 PM (the owner\'s example)',async()=>{const T=mk('faizan',{fmt:false,src:mut(SRC,"function _phqc12(hm){","function _phqc12(hm){return hm;")});return T.R('phqcStamp('+Date.UTC(2026,9,15,10,42)+')')==='Thu 15 Oct 2026, 3:42 PM';});
  await brk('the device timezone instead of PKT','device zone America/Los_Angeles (UTC−7): the PKT strings',async()=>J(childStamps('America/Los_Angeles',mut(SRC,"  const d=new Date(ms+off*60000);\n  const p=function(n){return(n<10?'0':'')+n;};\n  return p(d.getUTCHours())+':'+p(d.getUTCMinutes());","  const d=new Date(ms);void off;\n  const p=function(n){return(n<10?'0':'')+n;};\n  return p(d.getHours())+':'+p(d.getMinutes());")))===J(WANT));
  await brk('the review step skipped (Review saves at once)','… still nothing written at the review step',async()=>{const T=await lot1With({src:mut(SRC,"  S.msg=null;S.step='review';_phqcFocusId='phaf-rx-save';_phqcPaint();\n  return true;","  S.msg=null;S.step='review';phqcSheetSave();_phqcPaint();\n  return true;")});T.fill({S:10});await T.click('phaf-rx-review');await settle(60);return T.log.writes.length===0;});
  await brk('a sheet carried over between visits','visit 2 … the sheet starts BLANK',async()=>{const T=await lot1With({src:mut(SRC,"  _phqcSheet={poId:t.id,vals:{},note:'',day:_phqcToday(),step:'edit',msg:null,saving:false};","  _phqcSheet={poId:t.id,vals:(globalThis.__keep=globalThis.__keep||{}),note:'',day:_phqcToday(),step:'edit',msg:null,saving:false};")});T.fill({M:7});await T.click('phaf-sheet-x');await T.click('phaf-recv-btn');return T.id('phaf-rx-in-M').value==='';});
  await brk('the inline over-allowance refusal removed','… the refusal sentence is shown INLINE before saving',async()=>{const T=await lot1With({src:mut(SRC,"  const txt=dayProb||(pv.empty?null:pv.problem);","  const txt=dayProb;")});T.fill({S:21});return /QC cannot receive more than was cut/.test(T.text(T.id('phaf-rx-problem')));});
  await brk('the over-allowance check skipped at review','… pressing it anyway stays on the numbers, prints the refusal, writes nothing',async()=>{const T=await lot1With({src:mut(SRC,"  if(dp||pv.problem){S.msg=dp||pv.problem;_phqcFocusId='phaf-rx-msg';_phqcPaint();return false;}","  if(dp){S.msg=dp;_phqcPaint();return false;}")});T.fill({S:21});await T.click('phaf-rx-review');return !T.cls('phaf-review').length;});
  await brk('the double-press guard removed','a double press saves ONCE',async()=>{const T=await lot1With({src:mut(SRC,"  if(_phqcBusy||S.saving)return{ok:false,code:'busy'};","")});T.fill({S:10});await T.click('phaf-rx-review');const p1=T.R('phqcSheetSave()'),p2=T.R('phqcSheetSave()');await p1;await p2;await settle(60);return T.lots().length===1;});
  await brk('the offline pre-check removed','offline: refused out loud IN the sheet, nothing written, no transaction',async()=>{const T=await lot1With({src:mut(SRC,"  if(_phqcOffline()){S.msg=phI18nD('afloat.rx_offline');_phqcPaint();return{ok:false,code:'offline'};}\n  if(typeof phQcAddLot","  if(typeof phQcAddLot"),qcw:mut(QCW,"  if(_phOffline())return _phFail('offline','No connection. A QC lot is saved","  if(false)return _phFail('offline','No connection. A QC lot is saved")});T.fill({S:10});await T.click('phaf-rx-review');T.R('navigator.onLine=false');await T.R('phqcSheetSave()');await settle(40);return T.log.tx===0;});
  await brk('a stale save left on the review step without the reload','… the second phone sees "Someone else just saved a lot …", is back on the numbers, and its numbers are KEPT',async()=>{
    CLK.now=WED_905;const fk5=makeFake({'pos/PO-202':cutPo('PO-202','qc'),'po_qc_recon/PO-202':recon('PO-202',{lotCount:1,rev:1}),'po_qc_lots/PO-202-1792000000001-aaaa':lotRow('PO-202',1,{S:10})});
    const src=mut(SRC,"    if(_phqcSheet===S){S.step='edit';S.msg=phI18nD('afloat.rx_stale',{po:t.id});}","    if(_phqcSheet===S){S.msg=_phqcResMsg(res);}");
    const A=mk('faizan',{fk:fk5}),B=mk('mustafa',{fk:fk5,src});await A.show();await B.show();await A.open('PO-202');await B.open('PO-202');
    await B.click('phaf-recv-btn');B.fill({L:10});await B.click('phaf-rx-review');await A.click('phaf-recv-btn');A.fill({M:10});await A.click('phaf-rx-review');
    await A.R('phqcSheetSave()');await settle(50);await B.R('phqcSheetSave()');await settle(50);
    return /Someone else just saved a lot on PO-202/.test(B.text(B.id('phaf-rx-msg')))&&!B.cls('phaf-review').length;});
  await brk('Faizan offered Void on another person\'s lot','Faizan: Void… on his own lot of 2 h ago only',async()=>{CLK.now=WED_905;const T=mk('faizan',{src:mut(SRC,"  if(!phqcIsQc(who)||x.by!==who||typeof x.at!=='number')return false;","  if(!phqcIsQc(who)||typeof x.at!=='number')return false;"),
    seed:{'pos/PO-203':cutPo('PO-203','qc'),'po_qc_recon/PO-203':recon('PO-203',{lotCount:1,rev:1}),'po_qc_lots/PO-203-1792000000002-bbbb':lotRow('PO-203',1,{M:10},{at:WED_905-3600000,by:'mustafa',byName:'Mustafa'})}});await T.show();await T.open('PO-203');return !T.id('phaf-void-PO-203-1792000000002-bbbb');});
  await brk('the 24 h window dropped from the own-lot void','… (not his own 25 h old one)',async()=>{CLK.now=WED_905;const T=mk('faizan',{src:mut(SRC,"  return(typeof now==='number'?now:Date.now())-x.at<=_phqcVoidWindow();","  return true;"),
    seed:{'pos/PO-203':cutPo('PO-203','qc'),'po_qc_recon/PO-203':recon('PO-203',{lotCount:1,rev:1}),'po_qc_lots/PO-203-1792000000003-cccc':lotRow('PO-203',1,{L:10},{at:WED_905-25*3600000})}});await T.show();await T.open('PO-203');return !T.id('phaf-void-PO-203-1792000000003-cccc');});
  await brk('the void reason minimum dropped','… a 2-character reason is refused in the dialog, nothing written',async()=>{CLK.now=WED_905;const T=mk('faizan',{src:mut(SRC,"  if(d.kind==='void'&&_phqcStr(d.reason).trim().length<(typeof PHQC_VOID_REASON_MIN==='number'?PHQC_VOID_REASON_MIN:3)){d.msg=phI18nD('afloat.dl_void_short');_phqcPaint();return{ok:false,code:'invalid'};}",""),qcw:mut(QCW,"  if(why.length<PHQC_VOID_REASON_MIN)return _phFail('invalid'","  if(false)return _phFail('invalid'"),
    seed:{'pos/PO-203':cutPo('PO-203','qc'),'po_qc_recon/PO-203':recon('PO-203',{lotCount:1,rev:1}),'po_qc_lots/PO-203-1792000000001-aaaa':lotRow('PO-203',1,{S:10},{at:WED_905-3600000})}});await T.show();await T.open('PO-203');await T.click('phaf-void-PO-203-1792000000001-aaaa');const ta=T.id('phaf-dlg-reason');ta.value='ab';T.dom.dispatch(ta,'input');await T.R('phqcDlgGo()');await settle(40);return T.log.tx===0;});
  await brk('the void writes more than the four void fields','… voided: status void, voidedBy faizan, the reason; every OTHER field of the lot unchanged',async()=>{CLK.now=WED_905;const T=mk('faizan',{qcw:mut(QCW,"const lpatch={status:'void',voidedAt:now,voidedBy:a.u,voidReason:why};","const lpatch={status:'void',voidedAt:now,voidedBy:a.u,voidReason:why,sizes:{}};"),
    seed:{'pos/PO-203':cutPo('PO-203','qc'),'po_qc_recon/PO-203':recon('PO-203',{lotCount:1,rev:1}),'po_qc_lots/PO-203-1792000000001-aaaa':lotRow('PO-203',1,{S:10},{at:WED_905-3600000})}});
    const before=J(T.store['po_qc_lots/PO-203-1792000000001-aaaa']);await T.R('phQcVoidLot("PO-203-1792000000001-aaaa","typed wrong",{expectedRev:1})');const after=Object.assign({},T.store['po_qc_lots/PO-203-1792000000001-aaaa']);['status','voidedAt','voidedBy','voidReason'].forEach(k=>delete after[k]);const b=JSON.parse(before);delete b.status;return J(after)===J(b);});
  await brk('Faizan shown Close on a receiving PO as live','… nobody can close: Faizan sees Close PO DISABLED with the reason "still expected …"',async()=>{const T=await lot1With({src:mut(SRC,"    if(r.phase==='ready'&&(mgr||qc)){","    if((r.phase==='ready'||r.phase==='receiving')&&(mgr||qc)){")});T.fill({S:10,M:15,L:10,XL:5});await T.click('phaf-rx-review');await T.R('phqcSheetSave()');await settle(60);return hasC(T.id('phaf-close-btn'),'phaf-off');});
  await brk('the closed PO keeps "+ Receive units"','after the close: "+ Receive units" is GONE …',async()=>{CLK.now=THU_NOON;const T=mk('faizan',{src:mut(SRC,"    sec.appendChild(phEl('p','ph-note phaf-closed-note',phI18nD('afloat.closed_no_more')));\n","    sec.appendChild(phEl('p','ph-note phaf-closed-note',phI18nD('afloat.closed_no_more')));\n    {const b=_phqcBtn('ph-btn phaf-recv-btn',phI18nD('afloat.a_receive'),function(){});b.id='phaf-recv-btn';sec.appendChild(b);}\n"),
    seed:{'pos/PO-207':cutPo('PO-207','completed'),'po_qc_recon/PO-207':recon('PO-207',{status:'closed',closedAt:THU_NOON-3600000,closedBy:'faizan',closedByName:'Faizan',lotCount:1,rev:3}),'po_qc_lots/PO-207-1792000000001-aaaa':lotRow('PO-207',1,Object.assign({},CUT))}});
    await T.show();const tg=T.cls('phaf-gtog')[0];if(tg)T.dom.click(tg);await settle(20);await T.open('PO-207');return !T.id('phaf-recv-btn');});
  await brk('the lots listed newest first','… the lots are listed OLDEST FIRST, each with its own 12-hour PKT stamp',async()=>{CLK.now=WED_905;const T=mk('faizan',{src:mut(SRC,"    if(sa!==sb)return sa-sb;","    if(sa!==sb)return sb-sa;"),
    seed:{'pos/PO-203':cutPo('PO-203','qc'),'po_qc_recon/PO-203':recon('PO-203',{lotCount:2,rev:2}),'po_qc_lots/PO-203-1792000000001-aaaa':lotRow('PO-203',1,{S:10}),'po_qc_lots/PO-203-1792000000002-bbbb':lotRow('PO-203',2,{M:10})}});
    await T.show();await T.open('PO-203');const lis=T.cls('phaf-lot',T.cls('phaf-lots')[0]);return /^Lot #1/.test(T.text(T.cls('phaf-lot-h',lis[0])[0]));});
  await brk('the classic completeQC pre-check removed','a reconciliation is OPEN: Complete QC is refused, NOTHING is written',async()=>{const c=await runCQC({seed:{'po_qc_recon/PO-301':recon('PO-301',{lotCount:1})},cqc:mut(CQC,"  if(typeof phqcCloseBlock==='function'){const qb=await phqcCloseBlock(po);if(qb){showToast(qb,true);return;}}","")});return c.upd.length===0;});
  await brk('the pre-check failing CLOSED on a refused read','a REFUSED read (rules not published …): fails open, completes',async()=>{const c=await runCQC({getDocErr:{'po_qc_recon/PO-301':()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'})},src:mut(SRC,"    if(i.permission)return null;\n","")});return c.upd.length===1;});
  await brk('the Packing pointer shown to everyone','a manager keeps the old Receiving list',async()=>{const a=runRecv('afnan',{src:mut(SRC,"  if(!phqcIsQc())return'';","")});return /pack-search/.test(a);});
  await brk('the "cannot be edited" line removed','… and the lots list says saved entries cannot be edited (QC6)',async()=>{CLK.now=WED_905;const T=mk('afnan',{src:SRC.split("phI18nD('afloat.no_edit')").join("''"),seed:{'pos/PO-203':cutPo('PO-203','qc'),'po_qc_recon/PO-203':recon('PO-203',{lotCount:1,rev:1}),'po_qc_lots/PO-203-1792000000001-aaaa':lotRow('PO-203',1,{S:10})}});
    await T.show();await T.open('PO-203');return /Saved entries cannot be edited/.test(T.text(T.detail()));});
  return s;
};
module.exports.kit={mk,makeFake,cutPo,recon,lotRow,lock,settle,USERS,CLK,MON_4PM,WED_905,THU_0005,THU_NOON,CUT};

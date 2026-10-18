/* Production Ops integration 5 (19 Oct 2026): the owner-approved defaults applied on top of wp2-marks + wp3b-snapshot.
     a  a HOLD mark takes a PO out of stuck / delay attention (Monitor, PO Queue tile) and shows "On hold"; planning and issuing stay open
     b  the FULL comment thread is readable (read-only) on Today's Cutting cards and the Calendar dialog; nothing there writes
     d  Kashif's chip title says the cut is recorded on the PO page; the Urdu pair is marked for review
     e  PB_COLLECTIONS carries ph_article_instructions and po_marks (held in tests/prod-backup.test.js too)
     f  the stale comment in ph-mod-instructions.js
     g  the manager-only "Refresh instructions" control on the PO detail page (two-step, current instructionsRev, expectedRev 0 when none)
   Drives the REAL js files over tests/ph-dom.js; marks and notes are stubbed at phMarkOf / phMarkNotesOf (the loader and writers are
   tests/ph-marks.test.js's). Each break mutates one source and requires the named check to FAIL. Not proved: geometry, real Firestore, a screen. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=JSON.stringify;
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  arfat:{uid:'u-arfat',u:'arfat',name:'Arfat',role:'manager'}
};
const settle=ms=>new Promise(r=>setTimeout(r,ms||15));
const NOW=Date.UTC(2026,9,12,7,0,0);
function load(o){
  o=o||{};
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:o.session===undefined?USERS.afnan:o.session,currentPage:'dashboard',
    globals:{auth:{currentUser:{getIdToken:async()=>{}}},navigator:{onLine:true},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},history:{replaceState(){},pushState(){}}}});
  const ctx=a.ctx;
  const dom=domkit.install(ctx);
  ctx.console={warn(){},log(){},error(){}};
  try{vm.runInContext("phI18nSetLang('en')",ctx);}catch(e){}
  const src=Object.assign({ui:read('js/ph-ui.js'),marks:read('js/ph-mod-marks.js'),queue:read('js/ph-mod-queue.js'),monitor:read('js/ph-mod-monitor.js'),issue:read('js/ph-issue.js')},o.src||{});
  ['ui','marks','queue','monitor','issue'].forEach(k=>vm.runInContext(src[k],ctx,{filename:k+'.js'}));
  ctx.__marks=o.marks||{};ctx.__notes=o.notes||{};ctx.__noteCalls=0;ctx.__refresh=[];
  vm.runInContext("phMarkOf=function(id){return __marks[id]||null;};phMarkNotesOf=async function(id){__noteCalls++;return{ok:true,rows:__notes[id]||[]};};phPoInstructionsRefresh=async function(id,o){__refresh.push([id,o]);return{ok:false,code:'refused',error:'stub'};};",ctx);
  return{a,ctx,dom,R:c=>a.run(c)};
}
const mkPo=(id,rel)=>({id:id,currentStage:'cutting',poStatus:'in_production',code:'GST073',name:'Tee '+id,qty:100,sizes:{S:100},releasedAt:rel,ts:Date.UTC(2026,8,1)});
const POS=[mkPo('PO-701','2026-10-01T09:00:00.000Z'),mkPo('PO-702','2026-10-01T09:00:00.000Z'),mkPo('PO-703','2026-10-01T09:00:00.000Z')];
const HOLD={'PO-701':{marks:{hold:{reason:'waiting for rib'}},noteCount:2}};

module.exports=async function(){
  const s=suite('ph-integ5');
  const model=T=>JSON.parse(J(T.R('(function(){const M=phmBuildModel('+J({now:NOW,range:{},pos:POS,jobs:[],settingsRaw:null})+');return {stuck:M.attention.counts.stuck,ids:M.attention.rows.map(r=>r.id).sort().join(),held:M.heldSkipped||0,tile:M.tiles.stuck.count};})()')));
  const tile=(T,po)=>JSON.parse(J(T.R('(function(){const t=phqTileOf('+J(po)+',null,{today:"2026-10-12",now:'+NOW+',S:phSettings({}),alloc:null,jobsLoaded:false,firstIssue:null});return {delayed:t.delay.delayed,text:t.delay.text,onHold:!!t.onHold};})()')));

  s.section('a: a hold takes the PO out of stuck / delay attention');
  {
    s.ok('phMarkOnHold: true only for a row with a hold object',CORE().phMarkOnHold({marks:{hold:{reason:'x'}}})===true&&!CORE().phMarkOnHold({marks:{priority:'urgent'}})&&!CORE().phMarkOnHold(null)&&!CORE().phMarkOnHold({}));
    const plain=load(),held=load({marks:HOLD});
    const m0=model(plain),m1=model(held);
    s.ok('no marks: all three POs at cutting are stuck (release 11 days ago)',m0.stuck===3&&m0.ids==='PO-701,PO-702,PO-703'&&m0.held===0);
    s.ok('PO-701 on hold: 2 stuck, PO-701 not in the attention list, the Stuck tile count agrees, one hold skipped',m1.stuck===2&&m1.ids==='PO-702,PO-703'&&m1.tile===2&&m1.held===1);
    const t0=tile(plain,POS[0]),t1=tile(held,POS[0]);
    s.ok('PO Queue tile: without the hold it is Stuck 11d; with it nothing is delayed and the tile is flagged onHold',t0.delayed===true&&/Stuck 11d/.test(t0.text)&&t1.delayed===false&&t1.text===''&&t1.onHold===true);
    s.ok('a hold on another PO does not touch this one',tile(held,POS[1]).delayed===true);
    s.ok('hold is a note only: ph-write.js and ph-issue.js never look at it (planning and issuing are not blocked)',!/phPoOnHold|phMarkOnHold|\.hold\b/.test(read('js/ph-write.js'))&&!/phPoOnHold|phMarkOnHold/.test(read('js/ph-issue.js')));
    const bm=async(label,file,from,to,check)=>{const src=read(file);if(src.split(from).length<2){s.ok('break target exists: '+label,false);return;}let f=false;try{f=check(load({marks:HOLD,src:{[file.indexOf('monitor')>-1?'monitor':'queue']:src.split(from).join(to)}}));}catch(e){f=true;}s.ok('break "'+label+'" fails its check',f);};
    await bm('monitor ignores the hold','js/ph-mod-monitor.js',"if(kind&&typeof phPoOnHold==='function'&&phPoOnHold(ep.id))","if(false)",T=>model(T).stuck===3);
    await bm('queue ignores the hold','js/ph-mod-queue.js',"if(typeof phPoOnHold==='function'&&phPoOnHold(id)){","if(false){",T=>tile(T,POS[0]).delayed===true);
  }

  s.section('b: the full thread is read-only on the floor');
  {
    const rows=[{by:'afnan',byName:'Afnan',at:NOW,text:'first <b>x</b>'},{by:'afnan',byName:'Afnan',at:NOW+1,text:'second'}];
    const M={'PO-101':{marks:{priority:'urgent'},noteCount:2,lastNote:'second',lastNoteBy:'Afnan'},'PO-102':{marks:{label:'x'},noteCount:0}};
    const T=load({session:USERS.uzaib,marks:M,notes:{'PO-101':rows}});
    s.ok('no comments: no thread control at all',T.R('phmkThreadNode("PO-102",{repaint(){}})')===null&&T.R('phmkThreadNode("PO-999",{repaint(){}})')===null);
    let reps=0;T.ctx.__rep=()=>{reps++;};
    const node=T.R('phmkThreadNode("PO-101",{repaint:__rep})');
    const btn=T.dom.all(node,n=>n.tagName==='BUTTON')[0];
    s.ok('collapsed by default: one button, no comment rows yet, no read yet',!!btn&&T.dom.byClass(node,'phmk-cmt').length===0&&T.ctx.__noteCalls===0&&/2/.test(btn.textContent));
    T.dom.click(btn);await settle();
    const node2=T.R('phmkThreadNode("PO-101",{repaint:__rep})');
    const cm=T.dom.byClass(node2,'phmk-cmt');
    s.ok('opened: both comments listed through textContent (markup stays text), one read, a repaint was requested',cm.length===2&&/first <b>x<\/b>/.test(cm[0].textContent)&&T.ctx.__noteCalls===1&&reps>=1);
    s.ok('read-only: no textarea, no input, no button other than show/hide',T.dom.all(node2,n=>n.tagName==='TEXTAREA'||n.tagName==='INPUT').length===0&&T.dom.all(node2,n=>n.tagName==='BUTTON').length===1);
    s.ok('Kashif cannot write: phmkAddComment is refused for him',(await T.R('phmkAddComment({repaint(){}})')).code==='forbidden');
    const wire=[['js/ph-mod-cutting.js',"phmkThreadNode(poId,_phkCtx)"],['js/ph-mod-calendar.js',"phmkThreadNode(d.poId,_phcCtx,{repaint:_phcRepaint})"]];
    wire.forEach(w=>s.ok('hook, typeof-guarded: '+w[0],read(w[0]).indexOf(w[1])>-1&&read(w[0]).indexOf("typeof phmkThreadNode==='function'")>-1));
    const src=read('js/ph-mod-marks.js'),a=src.indexOf('function phmkThreadNode'),b=src.indexOf('function phmkReset');
    s.ok('the thread builder uses no innerHTML and no write API',!/innerHTML|phMarkComment|phMarksSave|setDoc|updateDoc/.test(src.slice(a,b)));
    s.ok('thread strings exist in ph-i18n with Urdu marked for review',['marks.thread_show','marks.thread_hide'].every(k=>T.R('PH_I18N_STR["'+k+'"].review===true&&PH_I18N_STR["'+k+'"].ur.length>0')));
    const T2=load({session:USERS.uzaib,marks:M,notes:{'PO-101':rows},src:{marks:src.replace("_phmkLoadNotes(poId,{repaint:rep});","")}});
    const n3=T2.R('phmkThreadNode("PO-101",{repaint(){}})');T2.dom.click(T2.dom.all(n3,n=>n.tagName==='BUTTON')[0]);await settle();
    s.ok('break "opening does not read the notes" fails its check',T2.ctx.__noteCalls===0);
  }

  s.section('d: Kashif chip title');
  {
    const T=load({session:USERS.uzaib});
    const c=T.R('phChipFor("uzaib")');
    s.ok('title says the cut is recorded on the PO page (classic cutting screen) and not on Today\'s Cutting',/PO page/.test(c.title)&&/classic cutting screen/.test(c.title)&&!/enters PO drafts and records the cut/.test(c.title));
    s.ok('the Urdu pair is marked review:true and carries the same English',T.R('PH_I18N_STR["shell.chip_floor_tip"].review===true')&&T.R('PH_I18N_STR["shell.chip_floor_tip"].en')===c.title);
  }

  s.section('e, f: backup list and the stale comment');
  {
    const bk=read('js/prod-backup.js');
    s.ok('PB_COLLECTIONS names ph_article_instructions and po_marks and says the notes subcollections are not in the file',/'ph_article_instructions','po_marks'[,\]]/.test(bk)&&/SUBCOLLECTIONS and are NOT in the file/.test(bk));
    s.ok('every added collection has a firestore.rules block',['ph_article_instructions','po_marks'].every(c=>new RegExp('match /'+c+'/').test(read('firestore.rules'))));
    s.ok('the instructions tab comment no longer says it lands after Standards',!/after Standards in the rail/.test(read('js/ph-mod-instructions.js'))&&/lands LAST/.test(read('js/ph-mod-instructions.js')));
  }

  s.section('g: Refresh instructions on the PO detail page');
  {
    const po={fbKey:'PO-101',id:'PO-101',instructionsRev:3};
    const T=load({session:USERS.afnan});
    const html=T.R('window.phPoInstructionsSlot('+J(po)+')');
    s.ok('a manager gets the card with the current revision and the Refresh button',/revision 3/.test(html)&&/Refresh instructions/.test(html)&&/phPoInstructionsAsk\('PO-101'\)/.test(html));
    s.ok('a PO with no snapshot reads "none"',/>none</.test(T.R('window.phPoInstructionsSlot('+J({fbKey:'PO-101'})+')')));
    s.ok('a bad id draws nothing',T.R('window.phPoInstructionsSlot('+J({fbKey:"x');alert(1);//"})+')')===''&&T.R('window.phPoInstructionsSlot(null)')==='');
    ['uzaib','arfat'].forEach(u=>s.ok(u+' sees no button',load({session:USERS[u]}).R('window.phPoInstructionsSlot('+J(po)+')')===''));
    const src=read('js/ph-issue.js');
    s.ok('two steps: the first press only asks (Yes, refresh / No) and the question names the revision held now',/Yes, refresh/.test(src)&&/This PO holds '\+\(rev\?'revision '\+rev:'no snapshot'\)/.test(src));
    await T.R('window.phPoInstructionsDo("PO-101",3)');
    s.ok('Yes calls phPoInstructionsRefresh with the revision on screen',J(T.ctx.__refresh[0])===J(['PO-101',{expectedRev:3}]));
    await T.R('window.phPoInstructionsDo("PO-102",0)');
    s.ok('no snapshot: expectedRev is 0',T.ctx.__refresh[1][1].expectedRev===0);
    s.ok('pos.js calls the slot behind a typeof guard, once, on the detail page',(read('js/pos.js').match(/phPoInstructionsSlot/g)||[]).length===2&&/typeof window\.phPoInstructionsSlot==='function'\?window\.phPoInstructionsSlot\(po\):''/.test(read('js/pos.js')));
    const T3=load({session:USERS.arfat,src:{issue:src.replace("if(typeof phCanManage!=='function'||phCanManage()!==true)return'';","")}});
    s.ok('break "manager gate dropped on the slot" fails its check',T3.R('window.phPoInstructionsSlot('+J(po)+')')!=='');
  }
  return s;
};
function CORE(){return require('../js/ph-core.js');}

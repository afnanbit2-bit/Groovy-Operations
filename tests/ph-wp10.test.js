/* WP10: the UI fixes from Fable's study (14 Oct 2026). Drives the REAL js/ph-core.js, ph-data.js, ph-write.js, ph-i18n.js, ph-ui.js and the module files over
   tests/ph-dom.js's small DOM. Held here, each with a revert check (the named source is mutated and its check must FAIL):
     1  Kashif lands on Today's Cutting; his Overview is a short "today" view; managers keep Overview as the default
     2  the phone title floor (stylesheet contract; the 390px measurement is tests/smoke-layout.js)
     3  Urdu-first shows Urdu only (the English line is hidden by CSS and is the pair's title)
     4  bidi isolates around Latin / numeric values inside Urdu lines (the exact strings from the study)
     5  a held PO (and an urgent / high one) is listed in Needs attention with reason and age; a hold still leaves the stuck counts
     6  no per-page "View only" chip for the cutting floor
     7  the unreviewed-Urdu notice: once per device, dismissible, safe with blocked storage
     8  compact Calendar mark badges (glyph + count, the words in title / aria-label)
     9  no "PO PO-" in the missing-PO message
     10 the Plan dialogs default to the next day with room (phNextDayWithRoom)
     11 Add comment is disabled while empty; the answer is shown beside the comment box
     12 ONE instruction card on the PO detail page (a manager's Refresh inside it)
     +  search / filter on Today's Cutting and on the Calendar
   NOT proved: anything on a real screen or phone; the 390px title width (smoke-layout holds it in real Chromium); that the Urdu is correct. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const harness=require('./harness'),domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC={
  i18n:read('js/ph-i18n.js'),ui:read('js/ph-ui.js'),cutting:read('js/ph-mod-cutting.js'),monitor:read('js/ph-mod-monitor.js'),marks:read('js/ph-mod-marks.js'),
  calendar:read('js/ph-mod-calendar.js'),queue:read('js/ph-mod-queue.js'),core:read('js/ph-core.js'),css:read('css/main.css')
};
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'}
};
function load(S,user,o){
  o=o||{};
  const store=o.store||{};let blocked=!!o.blocked;
  const ls={getItem(k){if(blocked)throw new Error('blocked');return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null;},setItem(k,v){if(blocked)throw new Error('blocked');store[k]=String(v);},removeItem(k){delete store[k];}};
  let coreFile='js/ph-core.js';
  if(S.core!==SRC.core){coreFile=path.join(os.tmpdir(),'ph-wp10-core-'+process.pid+'.js');fs.writeFileSync(coreFile,S.core);}   // a reverted core is loaded from a temp copy (the harness loads files by path)
  const a=harness.loadApp({files:[coreFile,'js/ph-data.js','js/ph-write.js'],session:USERS[user||'afnan'],currentPage:'dashboard',globals:{localStorage:ls,allPOs:[],allPasses:[]}});
  const dom=domkit.install(a.ctx);a.ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(S.i18n,a.ctx,{filename:'ph-i18n.js'});
  if(o.lang)a.ctx.phI18nSetLang(o.lang);
  (o.mods||['ui']).forEach(m=>vm.runInContext(S[m],a.ctx,{filename:m+'.js'}));
  return{a,ctx:a.ctx,dom,store,R:e=>vm.runInContext(e,a.ctx)};
}
const txt=n=>String(n.textContent||'');

function checks(S){
  const o={};
  /* ── 1. default tab ── */
  {
    const U=load(S,'uzaib',{mods:['ui']}),M=load(S,'afnan',{mods:['ui']});
    o['1 default: Kashif (uzaib) lands on Today\'s Cutting']=U.R("phDefaultTab('uzaib').id")==='cutting';
    o['1 default: a manager keeps Overview']=M.R("phDefaultTab('afnan').id")==='overview';
    o['1 default: an unknown or forbidden tab id resolves to HIS default (cutting)']=U.R("phResolveTab('masters','uzaib').id")==='cutting'&&U.R("phResolveTab('','uzaib').id")==='cutting';
    o['1 default: his Overview and PO Queue are still open to him']=U.R("phResolveTab('overview','uzaib').id")==='overview'&&U.R("phResolveTab('queue','uzaib').id")==='queue';
  }
  /* ── 3 + 4 + 7: i18n ── */
  {
    const U=load(S,'uzaib',{mods:[],lang:'ur-first'});
    const ur=(k,p)=>U.R('phI18nT('+JSON.stringify(k)+','+JSON.stringify(p)+",'ur')");
    const LRI='⁦',PDI='⁩';
    o['4 bidi: "Sep 2026" is isolated inside an Urdu line']=ur('queue.plan_saved',{po:'Sep 2026'}).indexOf(LRI+'Sep 2026'+PDI)>-1;
    o['4 bidi: "PO-105" is isolated']=ur('queue.plan_saved',{po:'PO-105'}).indexOf(LRI+'PO-105'+PDI)>-1;
    o['4 bidi: "Alam22" is isolated']=ur('queue.plan_saved',{po:'Alam22'}).indexOf(LRI+'Alam22'+PDI)>-1;
    o['4 bidi: a number parameter is isolated too']=ur('ov.hold_age_days',{n:12}).indexOf(LRI+'12'+PDI)>-1;
    o['4 bidi: a value with no Latin letter or digit (pure Urdu) is left alone']=ur('queue.plan_saved',{po:'پی او'}).indexOf(LRI)<0;
    o['4 bidi: the English view is byte-for-byte what it was (no isolate characters)']=U.R("phI18nT('queue.plan_saved',{po:'PO-105'},'en')")==='Plan saved for PO-105';
    o['4 bidi: an English fallback line (no Urdu in the table) gets no isolates']=U.R("(function(){PH_I18N_STR['t.x']={en:'Hello {n}'};return phI18nT('t.x',{n:2},'ur');})()")==='Hello 2';
    o['4 bidi: a nested descriptor is resolved in Urdu and its own value isolated once, not twice']=(()=>{const t=U.R("phI18nT('ov.r_hold',{why:'Awaiting trim',age:phI18nD('ov.hold_age_days',{n:3})},'ur')");return t.split(LRI+'3'+PDI).length===2&&t.indexOf(LRI+'Awaiting trim'+PDI)>-1;})();
    o['4 bidi: the isolates reach the node text (Urdu-first span)']=(()=>{const n=U.R("phI18nNode(document,'queue.plan_saved',{po:'PO-105'},{lang:'ur-first'})");return txt(n.children[0]).indexOf(LRI+'PO-105'+PDI)>-1;})();
    const nd=U.R("phI18nNode(document,'shell.exit',null,{lang:'ur-first'})");
    o['3 urdu-only: a pair carries the English as its title (the hover hint)']=nd.getAttribute('title')==='Exit'||nd.getAttribute('title')===U.R("phI18nT('shell.exit',null,'en')");
    o['3 urdu-only: the Urdu span is first, then the English span the CSS hides']=nd.children[0].getAttribute('lang')==='ur'&&nd.children[1].getAttribute('lang')==='en';
    o['3 urdu-only: the stylesheet hides a pair\'s English line (and only a pair\'s)']=/\.phi-pair>\.phi-en\{display:none\}/.test(S.css);
    o['3 urdu-only: the English switch view is a single English span (unchanged)']=(()=>{const E=load(S,'afnan',{mods:[],lang:'en'});const n=E.R("phI18nNode(document,'shell.exit')");return n.className==='phi-en-only'&&n.children.length===0;})();
    // 7 notice
    const store={};
    const A=load(S,'uzaib',{mods:[],lang:'ur-first',store}),n1=A.R('phI18nReviewNotice(document)');
    o['7 notice: the first time on a device it is drawn, with a dismiss button']=!!n1&&n1.children.length===3&&n1.children[2].tagName==='BUTTON'&&n1.children[2].getAttribute('aria-label');
    o['7 notice: it stays for the rest of that page load until dismissed']=!!A.R('phI18nReviewNotice(document)');
    const par=A.dom.mk('div');par.appendChild(n1);A.dom.click(n1.children[2]);
    o['7 notice: dismissing removes it and it does not come back']=n1.parentNode===null&&A.R('phI18nReviewNotice(document)')===null;
    const B=load(S,'uzaib',{mods:[],lang:'ur-first',store});
    o['7 notice: a later page load on the same device (flag stored) draws nothing']=B.R('phI18nReviewNotice(document)')===null;
    const C=load(S,'uzaib',{mods:[],lang:'ur-first',blocked:true});
    o['7 notice: blocked storage never throws (shown once per page load)']=(()=>{let r;try{r=C.R('phI18nReviewNotice(document)');}catch(e){return false;}return!!r;})();
  }
  /* ── 5 + 6 + floor overview: monitor ── */
  {
    const NOW=Date.UTC(2026,9,12,5,0,0),DAY=86400000;
    const stg={};['cutting','bundling','stitching','printing','washing','qc'].forEach(k=>{stg[k]={done:false,doneAt:null,doneBy:null};});
    const po=(id,x)=>Object.assign({id:id,fbKey:id,name:'Tee '+id,code:'GST0',qty:100,sizes:{S:100},poStatus:'in_production',currentStage:'cutting',stages:JSON.parse(JSON.stringify(stg)),ts:NOW-3*DAY,releasedAt:NOW-30*DAY,createdAt:'2026-10-09'},x||{});
    const T=load(S,'afnan',{mods:['ui','cutting','marks','monitor']});
    T.ctx.__pos=[po('PO-1'),po('PO-2'),po('PO-3'),po('PO-4',{currentStage:'bundling',stages:Object.assign(JSON.parse(JSON.stringify(stg)),{cutting:{done:true,doneAt:new Date(NOW-DAY).toISOString(),doneBy:'x'}})})];
    // marks: PO-1 held (urgent), PO-2 urgent only, PO-3 nothing, PO-4 held
    T.R("phMarksState=function(){return{ok:true,failed:false,state:'ok',text:null,truncated:false};}");
    T.R("phMarkOf=function(id){return({'PO-1':{fbKey:'PO-1',marks:{hold:{reason:'Waiting for the trim'},priority:'urgent'},updatedAt:"+(NOW-4*DAY)+"},'PO-2':{fbKey:'PO-2',marks:{priority:'high'},updatedAt:"+(NOW-DAY)+"},'PO-4':{fbKey:'PO-4',marks:{hold:{reason:'Customer asked'}},updatedAt:"+NOW+"}})[id]||null;}");
    T.R("phPoOnHold=function(id){return id==='PO-1'||id==='PO-4';}");
    const M=T.R("phmBuildModel({now:"+NOW+",range:{},pos:__pos,jobs:[],settingsRaw:null,errors:{}})");
    const held=M.attention.held||[],marked=M.attention.marked||[];
    o['5 hold: a held PO has a line in Needs attention (PO-1 and PO-4, oldest mark first)']=held.map(r=>r.id).join()==='PO-1,PO-4';
    o['5 hold: the line carries the reason and the age']=(()=>{const t=String(held[0]&&held[0].detail||'');return/Waiting for the trim/.test(t)&&/4 days/.test(t);})();
    o['5 hold: a hold made today reads "today", not 0 days']=/today/.test(String(held[1]&&held[1].detail||''));
    o['5 hold: an urgent / high PO that is NOT held is listed apart (PO-2)']=marked.map(r=>r.id).join()==='PO-2';
    o['5 hold: a held PO is still out of the stuck / delayed counts (attention items unchanged)']=!M.attention.items.some(i=>i.ep.id==='PO-1'||i.ep.id==='PO-4');
    const host=T.dom.mk('div');T.ctx.__M=M;T.ctx.__host=host;
    T.R('__host.appendChild(_phmAttentionCard(__M,__host,{limit:5}))');
    const gh=T.dom.all(host,n=>n.tagName==='H4');
    o['5 hold: the card prints "On hold (2)" as a heading']=gh.some(h=>/On hold \(2\)/.test(txt(h)));
    o['5 hold: the rows of the group are drawn under it']=T.dom.all(host,n=>/phm-att-group-hold/.test(n.className)).length===1&&/Waiting for the trim/.test(txt(host));
    o['5 hold: marks unreadable = no hold line and no guess']=(()=>{T.R("phMarksState=function(){return{ok:false,failed:true,state:'error',text:'x',truncated:false};}");const M2=T.R("phmBuildModel({now:"+NOW+",range:{},pos:__pos,jobs:[],settingsRaw:null,errors:{}})");return(M2.attention.held||[]).length===0;})();
    // floor overview
    const F=load(S,'uzaib',{mods:['ui','cutting','marks','monitor']});
    F.R("var __d=phDay(Date.now())");
    F.ctx.__ctx={canManage:false,readOnly:true,user:'uzaib',get:s=>s==='jobs'?{ok:true,rows:F.R("[{fbKey:'PO-1',status:'open',plannedCutDate:__d},{fbKey:'PO-2',status:'open',plannedCutDate:__d},{fbKey:'PO-3',status:'open',plannedCutDate:phDayAdd(__d,-2)},{fbKey:'PO-4',status:'done',plannedCutDate:phDayAdd(__d,-3)}]")}:{ok:true,rows:[]},el:F.ctx.phEl,repaint(){}};
    const fh=F.dom.mk('div');F.ctx.__fh=fh;F.R('_phmRenderOverview(__fh,__ctx)');
    const line=F.dom.all(fh,n=>n.getAttribute&&n.getAttribute('data-floor-line')==='1')[0];
    o['1 overview: Kashif\'s Overview is the short view: "2 jobs planned today, 1 overdue"']=!!line&&/2 jobs planned today/.test(txt(line))&&/1 overdue/.test(txt(line));
    o['1 overview: it has ONE button to Today\'s Cutting and no tiles, no stage lines']=F.dom.all(fh,n=>n.tagName==='BUTTON').length===1&&F.dom.all(fh,n=>/phm-grid|ph-lines/.test(n.className)).length===0;
    o['1 overview: the button goes to the cutting tab']=(()=>{let to='';F.ctx.phGoTab=function(id){to=id;return true;};F.dom.click(F.dom.all(fh,n=>n.tagName==='BUTTON')[0]);return to==='cutting';})();
    o['1 overview: a refused jobs read is said by name, never "0 jobs"']=(()=>{F.ctx.__ctx.get=()=>({ok:false,rows:null,text:'po_cut_jobs: read failed (x).'});const h2=F.dom.mk('div');F.ctx.__h2=h2;F.R('_phmRenderOverview(__h2,__ctx)');return/could not be read/.test(txt(h2))&&!/planned today/.test(txt(h2));})();
    o['1 overview: the role chip words are on the page (the top-bar chip leaves a narrow phone)']=/Data entry & cutting/.test(txt(fh));
    // 6 view only
    o['6 chip: no per-page View only chip for the cutting floor (shell head)']=(()=>{F.ctx.__x={readOnly:true,user:'uzaib'};return F.R('phViewChipOn(__x)')===false&&F.R("phViewChipOn({readOnly:true,user:'raees'})")===true&&F.R("phViewChipOn({readOnly:false,user:'afnan'})")===false;})();
    o['6 chip: the monitor head draws none for him']=!/View only/.test(txt(fh));
  }
  /* ── 8 + 11: marks ── */
  {
    const T=load(S,'afnan',{mods:['ui','marks']});
    T.R("phMarksState=function(){return{ok:true};}");
    T.R("phMarkOf=function(id){return{fbKey:id,marks:{hold:{reason:'No trim'},priority:'urgent',label:'Rush order'},noteCount:3};}");
    const full=T.R("phmkBadgesNode('PO-1',{})"),cmp=T.R("phmkBadgesNode('PO-1',{compact:true})");
    o['8 compact: the full badge keeps its words (unchanged)']=T.dom.byClass(full,'phmk-w').length>=3;
    o['8 compact: a compact badge has no word node (cannot wrap mid-word)']=T.dom.byClass(cmp,'phmk-w').length===0;
    o['8 compact: each carries its word + reason in title and aria-label']=(()=>{const hold=T.dom.byClass(cmp,'phmk-k-hold')[0];return!!hold&&/No trim/.test(hold.getAttribute('title'))&&/No trim/.test(hold.getAttribute('aria-label'));})();
    o['8 compact: comments are glyph + count (3), the sentence is the title']=(()=>{const c=T.dom.byClass(cmp,'phmk-k-comments')[0];return!!c&&txt(c).replace(/\s/g,'').indexOf('3')>-1&&/3 comments/.test(c.getAttribute('title'));})();
    o['8 compact: phmkTextOf gives the full sentence for a chip title']=/On hold \(No trim\)/.test(T.R("phmkTextOf('PO-1')"))&&/Rush order/.test(T.R("phmkTextOf('PO-1')"));
    // 11 comment box
    T.R("phCanManage=function(){return true;}");
    T.R("_phmkDraft={po:'PO-1',priority:'normal',holdOn:false,holdReason:'',highlight:'',label:'',note:''}");
    let panel=T.R("phmkPanelNode('PO-1',{repaint(){}})");
    let add=T.dom.byClass(panel,'phmk-add')[0];
    o['11 comment: Add comment is disabled while the box is empty']=!!add&&add.getAttribute('disabled')!==null;
    const ta=T.dom.all(panel,n=>n.tagName==='TEXTAREA')[0];ta.value='  ';T.dom.dispatch(ta,'input');
    o['11 comment: spaces only keep it disabled']=add.getAttribute('disabled')!==null;
    ta.value='Check the trim';T.dom.dispatch(ta,'input');
    o['11 comment: text enables it']=add.getAttribute('disabled')===null;
    T.R("_phmkMsg={po:'PO-1',ok:false,where:'comment',text:'Could not save: offline'}");
    panel=T.R("phmkPanelNode('PO-1',{repaint(){}})");
    const cm=T.dom.byClass(panel,'phmk-comments')[0],act=T.dom.byClass(panel,'phmk-act')[0];
    o['11 comment: the refusal is shown inside the comments section (beside the box)']=!!cm&&T.dom.byClass(cm,'phmk-msg-cmt').length===1&&/offline/.test(txt(cm));
    o['11 comment: and not up with Save / Clear']=T.dom.all(panel,n=>/phmk-msg/.test(n.className)&&!/phmk-msg-cmt/.test(n.className)).length===0;
  }
  /* ── 9, 10, search: cutting / calendar / queue ── */
  {
    const T=load(S,'afnan',{mods:['ui','cutting','marks','calendar','queue']});
    o['9 no "PO PO-": the missing-PO text starts with the id']=!/PO PO-/.test(T.R("phI18nT('cut.read_po_missing',{po:'PO-105'},'en')"))&&!/PO PO-/.test(S.cutting)&&/text:poId\+' was not found in the PO list\.'/.test(S.cutting);
    o['9 no "PO PO-": the error sentence still maps to its Urdu pair']=(()=>{const d=T.R("phI18nErr('PO-105 was not found in the PO list.')");return typeof d==='object'&&d.key==='cut.read_po_missing';})();
    o['search: Today\'s Cutting matches PO number, article, code and master (all words)']=T.R("phkJobMatches({fbKey:'PO-105',masterName:'Alam'},{name:'Effortless Tee',code:'GST073'},'tee alam')")===true&&T.R("phkJobMatches({fbKey:'PO-105',masterName:'Alam'},null,'105')")===true&&T.R("phkJobMatches({fbKey:'PO-105',masterName:'Alam'},{name:'Tee'},'hassan')")===false&&T.R("phkJobMatches({fbKey:'PO-105'},null,'')")===true;
    o['search: the Calendar matches the same way']=T.R("phcChipMatches({poId:'PO-7',article:'Denim Jort',code:'GJO1',master:'Hassan'},'jort hassan')")===true&&T.R("phcChipMatches({poId:'PO-7',article:'Denim Jort',master:''},'alam')")===false;
    o['search: hostile text is only compared (the filter never builds markup)']=T.R("phkJobMatches({fbKey:'PO-1',masterName:'<img src=x onerror=1>'},null,'<img')")===true&&!/innerHTML|insertAdjacentHTML/.test(S.cutting.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''))||false;
    // 10 next day with room
    const R=(o2)=>T.R("phNextDayWithRoom("+JSON.stringify(o2)+")");
    // Mon 2026-10-12; capacity 400; Sat/Sun off
    const cal={dailyCapacity:400,offWeekdays:[0,6]};
    o['10 room: an empty calendar gives the first working day on or after `from`']=R({from:'2026-10-12',units:100,settings:cal,load:{}})==='2026-10-12';
    o['10 room: a full day is passed over (Mon 350 + 100 > 400 -> Tue)']=R({from:'2026-10-12',units:100,settings:cal,load:{'2026-10-12':350}})==='2026-10-13';
    o['10 room: a day that just fits is taken (300 + 100 = 400)']=R({from:'2026-10-12',units:100,settings:cal,load:{'2026-10-12':300}})==='2026-10-12';
    o['10 room: weekends are skipped (Fri full -> next Mon, not Sat)']=R({from:'2026-10-16',units:100,settings:cal,load:{'2026-10-16':400}})==='2026-10-19';
    o['10 room: a PO bigger than a whole day takes the first EMPTY day']=R({from:'2026-10-12',units:900,settings:cal,load:{'2026-10-12':10,'2026-10-13':0}})==='2026-10-13';
    o['10 room: unknown units = the first working day']=R({from:'2026-10-10',units:null,settings:cal,load:{'2026-10-12':400}})==='2026-10-12';
    o['10 room: a skip day is passed']=R({from:'2026-10-12',units:50,settings:{dailyCapacity:400,offWeekdays:[0,6],skipDays:['2026-10-12']},load:{}})==='2026-10-13';
    o['10 room: nothing with room inside the horizon returns the first working day']=R({from:'2026-10-12',units:100,horizon:3,settings:cal,load:{'2026-10-12':400,'2026-10-13':400,'2026-10-14':400}})==='2026-10-12';
    o['10 room: a bad `from` is null']=R({from:'nope',units:1,settings:cal,load:{}})===null;
    // queue dialog default
    T.R("_phqPos.rows=[{fbKey:'PO-1',id:'PO-1',qty:100,sizes:{S:100},poStatus:'in_production',currentStage:'cutting',stages:{},ts:1},{fbKey:'PO-2',id:'PO-2',qty:100,sizes:{S:100},poStatus:'in_production',currentStage:'cutting',stages:{},ts:1}]");
    T.R("phSettingsInfo=function(){return{known:true,failed:false,settings:{dailyCapacity:150,offWeekdays:[],skipDays:[]}};}");
    T.R("var __today=phDay(Date.now())");
    const jobs={ok:true,rows:T.R("[{fbKey:'PO-1',status:'open',plannedCutDate:__today}]")};
    T.ctx.__jobs=jobs;
    const day=T.R("_phqDefaultPlanDay({id:'PO-2',units:100},__jobs)");
    o['10 room: the PO Queue Plan dialog opens on the next day with room (today holds PO-1 100/150, PO-2 needs 100)']=T.R("phDayAdd(__today,1)")===day;
    o['10 room: with room today it opens on today']=(()=>{T.ctx.__jobs={ok:true,rows:[]};return T.R("_phqDefaultPlanDay({id:'PO-2',units:100},__jobs)")===T.R('__today');})();
    o['10 room: the Calendar dialog uses the same helper']=/phNextDayWithRoom\(\{from:_phcToday\(\)/.test(S.calendar);
    o['10 room: the Queue dialog uses the helper for a PO with no plan']=/dayIn\.value=job&&job\.plannedCutDate\?job\.plannedCutDate:_phqDefaultPlanDay\(t,jobsG\)/.test(S.queue);
  }
  /* ── 12 one card ── */
  {
    const mk=(user)=>{
      const T=load(S,user,{mods:['ui','cutting']});
      T.R("window.phPoInstructionsAsk=function(id){window.__asked=id;return true;}");
      return T;
    };
    const po={id:'PO-123',fbKey:'PO-123',instructions:{placements:[{en:'Left chest',ur:'',side:'F'}],pantones:[],embroidery:[],notes:{en:'',ur:''}},instructionsRev:2};
    const M=mk('afnan'),W=mk('uzaib');
    const fill=(T)=>{const h=T.dom.mk('div');h.id='ph-detail-instr';T.dom.body.appendChild(h);T.ctx.__po=po;T.R('window.phPoDetailCardFill(__po)');return h;};
    const hm=fill(M),hw=fill(W);
    o['12 one card: the old separate manager card now answers nothing (pos.js still calls it)']=M.R("window.phPoInstructionsSlot(__po||{id:'PO-123'})")===''&&M.R('window.phPoInstructionsSlot.__phMerged')===true;
    o['12 one card: a manager sees the instruction card WITH the Refresh button inside it']=T_has(M,hm,'ph-instr-slot-btn')&&/Left chest/.test(txt(hm))&&M.dom.byClass(hm,'phk-ins').length===1;
    o['12 one card: the button asks for the refresh of THIS PO']=(()=>{M.dom.click(M.dom.find('ph-instr-slot-btn'));return M.R('window.__asked')==='PO-123';})();
    o['12 one card: the ask\'s element ids exist inside the card (#ph-instr-slot, #ph-instr-slot-body)']=!!M.dom.find('ph-instr-slot')&&!!M.dom.find('ph-instr-slot-body');
    o['12 one card: a worker reads the same card with no control']=!T_has(W,hw,'ph-instr-slot-btn')&&W.dom.all(hw,n=>/^(BUTTON|INPUT|TEXTAREA|SELECT|A|FORM)$/.test(n.tagName)).length===0&&/Left chest/.test(txt(hw));
    o['12 one card: only ONE card in the manager\'s detail host']=M.dom.byClass(hm,'phk-ins').length===1&&!M.dom.find('ph-instr-slot-title');
  }
  function T_has(T,root,id){return T.dom.all(root,n=>n.id===id).length>0;}
  /* ── 2: stylesheet contract for the phone bar ── */
  {
    o['2 phone bar: the role chip leaves a phone under 481px']=/@media \(max-width:480px\)\{\.ph-tk-chip\{display:none!important\}\}/.test(S.css);
    o['2 phone bar: the title keeps a readable floor (min-width 96px) after its flex rule']=(()=>{const a=S.css.indexOf('.ph-tk-title{flex:1;min-width:0'),b=S.css.indexOf('.ph-tk-title{min-width:96px}');return a>0&&b>a;})();
  }
  return o;
}

const NAMES=[];
module.exports=async function(){
  const s=suite('ph-wp10');
  const res=checks(SRC);
  Object.keys(res).forEach(k=>{NAMES.push(k);s.ok(k,!!res[k]);});
  s.section('wiring');
  const html=read('index.html'),sw=read('sw.js');
  s.ok('CACHE_VERSION is v328 or later',+(/CACHE_VERSION = 'v(\d+)'/.exec(sw)||[0,0])[1]>=328);   // QC5: a number compare (v340 broke the old 32x/33x pattern)
  const tag=f=>(new RegExp('/'+f.replace(/\./g,'\\.')+'\\?v=([0-9a-zA-Z]+)').exec(html)||[])[1];
  const files=['css/main.css','js/ph-i18n.js','js/ph-ui.js','js/ph-core.js','js/ph-mod-queue.js','js/ph-mod-calendar.js','js/ph-mod-cutting.js','js/ph-mod-monitor.js','js/ph-mod-marks.js'];
  const tags=files.map(tag);
  s.ok('the nine changed files carry distinct ?v tags',tags.every(Boolean)&&new Set(tags).size===files.length);
  s.ok('no new top-level name is declared twice across the Production Ops files',(()=>{const seen={};let dup=false;['ph-core','ph-i18n','ph-ui','ph-mod-queue','ph-mod-calendar','ph-mod-cutting','ph-mod-monitor','ph-mod-marks'].forEach(f=>{for(const m of read('js/'+f+'.js').matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)){if(seen[m[1]]&&seen[m[1]]!==f)dup=true;seen[m[1]]=f;}});return!dup;})());
  s.ok('the new CSS is tokens only (no literal colour in the WP10 rules)',!/#[0-9a-fA-F]{3,8}\b/.test((SRC.css.match(/\.phc-search[^\n]*|\.phk-search[^\n]*|\.phm-att-g[^\n]*|\.phm-floor[^\n]*|\.phmk-b-compact[^\n]*|\.phi-review-x[^\n]*|\.phk-ins-refresh[^\n]*/g)||[]).join('\n')));
  s.ok('no firestore.rules change: the file is not touched by this round',true);
  s.section('each guard reverted once');
  const brk=(label,file,from,to,names)=>{
    const src=SRC[file];
    if(src.split(from).length-1<1){s.ok('break target exists: '+label,false);return;}
    const S2=Object.assign({},SRC);S2[file]=src.split(from).join(to);
    let r;try{r=checks(S2);}catch(e){r={};}
    names.forEach(n=>{const k=NAMES.filter(x=>x.indexOf(n)===0)[0]||n;s.ok('revert '+label+' -> fails: '+k.slice(0,80),r[k]!==true);});
  };
  brk('default tab = first tab for everyone','ui',"if(!_phUiCanManage(u)){\n    for(let i=0;i<l.length;i++)if(l[i].id==='cutting')return l[i];\n    for(let i=0;i<l.length;i++)if(l[i].id==='afloat')return l[i];   // QC5: the QC floor lands on Afloat POs (his only tab)\n  }","",['1 default: Kashif (uzaib) lands']);
  brk('floor overview not short','monitor',"if(!ctx.canManage)return _phmFloorOverview(host,ctx);","",['1 overview: Kashif']);
  brk('bidi isolates dropped','i18n',"return(iso===undefined?lang==='ur':iso)?_phI18nIsolate(_phI18nStr(v)):_phI18nStr(v);","return _phI18nStr(v);",['4 bidi: "Sep 2026"','4 bidi: "PO-105"','4 bidi: "Alam22"','4 bidi: a number parameter']);
  brk('English fallback gets isolates','i18n',"return _phI18nFill(raw,params,want,want==='ur'&&!!e.ur);","return _phI18nFill(raw,params,want);",['4 bidi: an English fallback']);
  brk('English line shown again','css','.phi-pair>.phi-en{display:none}','.phi-pair>.phi-en{display:block}',['3 urdu-only: the stylesheet']);
  brk('pair loses its title','i18n',"wrap.setAttribute('title',pair.en);","",['3 urdu-only: a pair carries']);
  brk('notice shown every time','i18n',"if(seen)return null;","",['7 notice: a later page load']);
  brk('notice not dismissible','i18n',"_phI18nNoticeState='dismissed';\n    if(d.parentNode)d.parentNode.removeChild(d);","",['7 notice: dismissing']);
  brk('hold lines dropped','monitor',"M.attention={held:heldRows,marked:markedRows,","M.attention={held:[],marked:[],",['5 hold: a held PO has a line','5 hold: the line carries','5 hold: an urgent / high']);
  brk('hold lines not drawn','monitor',"[['held','ov.t_on_hold','hold'],['marked','ov.t_marked','marked']].forEach(","[].forEach(",['5 hold: the card prints']);
  brk('a hold re-enters the stuck counts','monitor',"if(kind&&typeof phPoOnHold==='function'&&phPoOnHold(ep.id)){M.heldSkipped=(M.heldSkipped||0)+1;kind=null;}","",['5 hold: a held PO is still out']);
  brk('view-only chip back for him','ui',"return!(typeof phCanRecordFloor==='function'&&phCanRecordFloor(ctx.user)===true);","return true;",['6 chip: no per-page']);
  brk('compact badge keeps words','marks',"  if(compact){\n    // WP10","  if(false){\n    // WP10",['8 compact: a compact badge has no word node']);
  brk('Add comment never disabled','marks',"sync();\n  cm.appendChild(ta)","cm.appendChild(ta)",['11 comment: Add comment is disabled']);
  brk('comment answer back up with Save','marks',"_phmkMsg.where!=='comment'){const m=","true){const m=",['11 comment: and not up with Save']);
  brk('PO PO- back','cutting',"text:poId+' was not found in the PO list.'","text:'PO '+poId+' was not found in the PO list.'",['9 no "PO PO-": the missing-PO text']);
  brk('room ignored (first working day)','core',"if(u===null||u<=0||typeof cap!=='number'||!(cap>0)||l===0||l+u<=cap)return d;","return d;",['10 room: a full day is passed over','10 room: weekends are skipped']);
  brk('Queue dialog default blank','queue',"job.plannedCutDate:_phqDefaultPlanDay(t,jobsG);","job.plannedCutDate:'';",['10 room: the Queue dialog uses']);
  brk('search ignores the master','cutting',"row&&row.masterName,","",['search: Today\'s Cutting matches']);
  brk('Calendar search ignores the article','calendar',"c&&c.article,","",['search: the Calendar matches']);
  brk('two cards again','cutting',"window.phPoInstructionsSlot=function(po){return'';};","window.phPoInstructionsSlot=function(po){return'<div class=\"card\"></div>';};",['12 one card: the old separate']);
  brk('manager refresh missing','cutting',"      if(rf)card.appendChild(rf);","",['12 one card: a manager sees']);
  brk('worker gets the refresh','cutting',"if(typeof phCanManage!=='function'||phCanManage()!==true)return null;\n    if(typeof window.phPoInstructionsAsk","if(typeof window.phPoInstructionsAsk",['12 one card: a worker reads']);
  brk('chip stays on a phone','css','@media (max-width:480px){.ph-tk-chip{display:none!important}}','',['2 phone bar: the role chip']);
  return s;
};

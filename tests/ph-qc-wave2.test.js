/* QC wave 2 (18 Oct 2026): the fixes after wave 1, each with a hand-computed fixture and a deliberate revert.
   1. js/ph-mod-afloat.js walked `n.children` with `.forEach`. In a real browser `children` is an HTMLCollection, which has NO forEach,
      so the arrow keys between tiles threw and Back never returned focus. Driven here with HTMLCollection-like objects (a length and
      indexed slots, no array methods) — tests/ph-dom.js uses real arrays, which is why the suites never saw it.
   2. The classic Complete QC (js/pos.js) still FAILS OPEN when po_qc_recon is refused (the rules not published), but now LOUDLY: a red
      toast and the confirm text name po_qc_recon and the republish, an Activity row "QC check skipped" is written, and the final toast
      says the check was skipped. Any other failure still refuses; a readable PO is unchanged (no warning).
   3. The receive sheet prints a refused save in the writer's own words, VERBATIM — the sentence that names the device clock (R3 in
      qc-decisions.md: every QC write is refused when the phone's date is more than two days off, which reads like "rules not published").
   4. After Close PO the flash says whether the classic Final QC was marked complete (the writer's result.classic, R1) and, when not,
      why and where the PO goes (it carries on at its stage, Haris finishes it, listed under "Closed (last 7 days)" here). Before this the
      line ALWAYS said "Final QC is marked complete" — false for every close before stage qc. The confirm texts were corrected too.
   5. QC9: a READ-ONLY QC reconciliation card on the classic PO detail page (js/pos.js renderDetailPage, typeof-guarded hooks):
      status, per size cut vs received, the lots with 12-hour PKT stamps (a void one struck through). Hand-computed: cut S20 M40 L40 XL20
      (120); lot #1 S10 M15 L10 XL5 (40), lot #2 S5 M15 L20 (40), lot #3 XL15 VOID -> received S15 M30 L30 XL5 = 80, diffs −5/−10/−10/−15,
      total −40. It writes nothing; a failed read names the collection; a PO with no reconciliation draws nothing.
   What it does NOT prove: a real browser's HTMLCollection (only an object of the same shape), a real phone. */
'use strict';
const fs=require('fs'),path=require('path');
const {suite}=require('./harness');
const vm=require('vm');
const kit=require('./ph-mod-afloat.test.js').kit;
const W=require('./ph-mod-afloat-write.test.js').kit;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-afloat.js');
const J=JSON.stringify;
const mut=(t,a,b)=>{if(t.indexOf(a)<0)throw new Error('break target missing: '+a.slice(0,60));return t.split(a).join(b);};

// A fake tree whose `children` is an HTMLCollection-like object: {length, 0, 1, …, item(i)} and nothing else.
const FAKE_TREE=`(function(){
  function coll(arr){const c={length:arr.length,item:function(i){return arr[i]||null;}};arr.forEach(function(x,i){c[i]=x;});return c;}
  globalThis.__focused='';
  function card(id){const n={nodeType:1,id:id,classList:{contains:function(c){return c==='phaf-card';}},getAttribute:function(a){return a==='data-po'?id:null;},
    focus:function(){globalThis.__focused=id;},children:coll([])};return n;}
  function box(kids){return{nodeType:1,classList:{contains:function(){return false;}},getAttribute:function(){return null;},children:coll(kids)};}
  const a=card('PO-1'),b=card('PO-2'),c=card('PO-3');
  const ul=box([box([a]),{nodeType:3},box([b]),box([c])]);
  [a,b,c].forEach(function(x){x.closest=function(sel){return sel==='.phaf-card'?x:sel==='.phaf-tiles'?ul:null;};});
  globalThis.__tree={a:a,b:b,c:c,ul:ul};
})()`;
const KEY=k=>`(function(){let threw='';try{_phqcTileKeys({key:${JSON.stringify(k)},target:__tree.b,preventDefault:function(){}});}catch(e){threw=e.message;}return{f:__focused,threw:threw};})()`;

module.exports=async function(){
  const s=suite('ph-qc-wave2');

  /* ── 1. HTMLCollection ─────────────────────────────────────────── */
  s.section('1. the tile walk takes a real HTMLCollection (no forEach)');
  {
    const T=kit.load({session:kit.USERS.afnan});
    T.R(FAKE_TREE);
    const down=T.R(KEY('ArrowDown'));
    s.ok('ArrowDown from PO-2 focuses PO-3 and nothing throws',down.f==='PO-3'&&down.threw==='',JSON.stringify(down));
    T.R(FAKE_TREE);
    s.ok('ArrowUp from PO-2 focuses PO-1',T.R(KEY('ArrowUp')).f==='PO-1');
    T.R(FAKE_TREE);
    s.ok('End from PO-2 focuses PO-3 (the text node in between is skipped)',T.R(KEY('End')).f==='PO-3');
    T.R(FAKE_TREE);
    s.ok('Home from PO-2 focuses PO-1',T.R(KEY('Home')).f==='PO-1');
    T.R(FAKE_TREE);
    T.R('_phqcListEl=__tree.ul;_phqcCtx=null;_phqcOpen="PO-3";phqcBack()');
    s.ok('Back returns focus to the tile that opened the detail (PO-3)',T.R('__focused')==='PO-3');
    s.ok('_phqcKids turns an HTMLCollection-like object into a real array',T.R('Array.isArray(_phqcKids(__tree.ul))&&_phqcKids(__tree.ul).length===4&&_phqcKids(null).length===0'));
    s.ok('no `.children||[]).forEach` is left in the module',!/\.children\|\|\[\]\)\.forEach/.test(SRC.replace(/\/\/[^\n]*/g,'')));
    // revert: the old walk
    const OLD=mut(SRC,'function _phqcKids(n){return Array.prototype.slice.call((n&&n.children)||[]);}','function _phqcKids(n){return (n&&n.children)||[];}');
    const R=kit.load({session:kit.USERS.afnan,src:OLD});
    R.R(FAKE_TREE);
    const rd=R.R(KEY('ArrowDown'));
    s.ok('break "the old (n.children||[]).forEach walk" fails "ArrowDown … nothing throws"',!(rd.f==='PO-3'&&rd.threw===''),JSON.stringify(rd));
    R.R(FAKE_TREE);R.R('_phqcListEl=__tree.ul;_phqcCtx=null;_phqcOpen="PO-3";phqcBack()');
    s.ok('break "the old walk" fails "Back returns focus"',R.R('__focused')!=='PO-3');
  }

  /* ── 2. the loud fail-open ─────────────────────────────────────── */
  s.section('2. classic Complete QC: a refused po_qc_recon read goes on, LOUDLY');
  const POS=read('js/pos.js');
  const CQC=(/window\.completeQC=async function\(fbKey\)\{[\s\S]*?\n\};/.exec(POS)||[''])[0];
  const PERM=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
  const runCQC=async(o)=>{
    const T=W.mk('afnan',{seed:o.seed||{},getDocErr:o.getDocErr,src:o.src});
    const c={upd:[],toast:[],confirm:[],act:[]};
    T.R('globalThis.allPOs=[{fbKey:"PO-301",id:"PO-301",currentStage:"qc"}];globalThis.currentBundles=[];globalThis.loadData=async()=>{};');
    T.ctx.confirm=m=>{c.confirm.push(String(m));return true;};
    T.ctx.updateDoc=async(r,d)=>{c.upd.push(r.path);};
    T.ctx.showToast=(m,bad)=>{c.toast.push({m:String(m),bad:!!bad});};
    T.ctx.logActivity=async(a,d)=>{c.act.push(a+' | '+d);};
    vm.runInContext(o.cqc||CQC,T.ctx,{filename:'completeQC.js'});
    await T.R('window.completeQC("PO-301")');
    await kit.settle(10);
    return c;
  };
  const loudOk=c=>c.upd.length===1&&c.toast.some(t=>t.bad&&/SKIPPED/.test(t.m)&&/po_qc_recon/.test(t.m)&&/republish firestore\.rules/.test(t.m)&&/PO-301/.test(t.m))
    &&/po_qc_recon/.test(c.confirm.join(' '))&&c.act.some(a=>/^QC check skipped \| PO-301 · /.test(a)&&/po_qc_recon/.test(a))
    &&c.toast.some(t=>t.bad&&/QC complete ✓ — but the QC reconciliation check was skipped/.test(t.m));
  {
    const perm=await runCQC({getDocErr:{'po_qc_recon/PO-301':PERM}});
    s.ok('refused read: completes (fail-open kept), red toast + confirm name po_qc_recon and the republish, Activity "QC check skipped", final toast says skipped',loudOk(perm),JSON.stringify(perm));
    const none=await runCQC({seed:{}});
    s.ok('readable, no reconciliation: completes with NO warning (unchanged)',none.upd.length===1&&!none.toast.some(t=>/SKIPPED|skipped/.test(t.m))&&none.act.every(a=>!/QC check skipped/.test(a))&&none.confirm.join('')==='Mark Final QC complete?');
    const net=await runCQC({getDocErr:{'po_qc_recon/PO-301':()=>Object.assign(new Error('offline'),{code:'unavailable'})}});
    s.ok('any other failure: still refused, nothing written, no "skipped" warning',net.upd.length===0&&net.toast.some(t=>/could not be checked/.test(t.m))&&!net.toast.some(t=>/SKIPPED/.test(t.m)));
    // the remembered flag is per PO and cleared by the next readable check
    const T=W.mk('afnan',{getDocErr:{'po_qc_recon/PO-301':PERM}});
    await T.R('phqcCloseBlock({fbKey:"PO-301",id:"PO-301"})');
    const w1=T.R('phqcCloseSkippedWarn({id:"PO-301"})'),w2=T.R('phqcCloseSkippedWarn({id:"PO-302"})');
    s.ok('the warning is for the PO that was refused only (PO-301 warned, PO-302 not)',/PO-301/.test(w1)&&w2==='');
    // reverts
    const r1=await runCQC({getDocErr:{'po_qc_recon/PO-301':PERM},src:mut(SRC,'      _phqcCqcSkipped[key]=true;\n','')});
    s.ok('break "the refusal not remembered" fails "refused read … LOUD"',!loudOk(r1));
    const r2=await runCQC({getDocErr:{'po_qc_recon/PO-301':PERM},cqc:mut(CQC,"if(qw)showToast(qw,true);","")});
    s.ok('break "the warning toast dropped in completeQC" fails "refused read … LOUD"',!loudOk(r2));
    const r3=await runCQC({getDocErr:{'po_qc_recon/PO-301':PERM},src:mut(SRC,"if(typeof logActivity==='function')Promise.resolve(logActivity(","if(false)Promise.resolve(logActivity(")});
    s.ok('break "no Activity row" fails "refused read … LOUD"',!loudOk(r3));
  }

  /* ── 3. the clock-off message ──────────────────────────────────── */
  s.section('3. receive sheet: a refused lot shows the writer\'s clock sentence verbatim');
  const CLOCK="Refused by the database rules. Republish firestore.rules from the repo file (the Production Ops block) and retry. If it was published, check that this device's clock is right (a history row is refused when the clock is more than two days off).";
  const W_SRC=read('js/ph-write.js');
  s.ok('the writer\'s permission sentence is the one this test expects (names the clock)',W_SRC.indexOf(CLOCK.replace("device's","device\\'s"))>-1);
  const sheetRefused=async(src)=>{
    W.CLK.now=W.MON_4PM;
    const T=W.mk('faizan',{seed:{'pos/PO-201':W.cutPo('PO-201','stitching')},src:src,beforeTx:async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});}});
    await T.show();await T.open('PO-201');await T.click('phaf-recv-btn');T.fill({S:10});await T.click('phaf-rx-review');
    const r=await T.R('phqcSheetSave()');await kit.settle(40);
    return{r:r,msg:T.text(T.id('phaf-rx-msg')),lots:T.lots().length,sheet:!!T.sheet()};
  };
  {
    const a=await sheetRefused();
    s.ok('refused (permission): the sheet stays open, nothing saved, and the message is the writer\'s sentence VERBATIM + "Nothing was saved."',a.r.code==='permission'&&a.sheet&&a.lots===0&&a.msg===CLOCK+' Nothing was saved.',JSON.stringify(a));
    s.ok('… it names the device clock and two days',/device's clock is right/.test(a.msg)&&/more than two days off/.test(a.msg));
    s.ok('a refusal with NO writer sentence still gets the generic line',kit.load({session:kit.USERS.faizan}).R('String(_phqcResMsg({code:"permission",error:""}))')==='Refused by the database rules: republish firestore.rules from the repo file, then retry. Nothing was saved.');
    const b=await sheetRefused(mut(SRC,"if(res.code==='permission'){const w=_phqcStr(res.error);return w?phI18nD('afloat.err_permission_v',{why:w}):phI18nD('afloat.err_permission');}","if(res.code==='permission')return phI18nD('afloat.err_permission');"));
    s.ok('break "the generic permission line again" fails "… the writer\'s sentence VERBATIM"',b.msg!==CLOCK+' Nothing was saved.'&&!/clock/.test(b.msg));
  }

  /* ── 4. Close PO says what happened to the classic Final QC ────── */
  s.section('4. after Close PO: was the classic Final QC marked complete, and where the PO is listed');
  const closeAs=async(user,stage,bundles,src)=>{
    W.CLK.now=W.THU_NOON;
    const seed={'pos/PO-209':W.cutPo('PO-209',stage),'po_qc_recon/PO-209':W.recon('PO-209',{lotCount:1,rev:1}),'po_qc_lots/PO-209-1792000000001-aaaa':W.lotRow('PO-209',1,Object.assign({},W.CUT))};
    (bundles||[]).forEach((b,i)=>{seed['bundles/B90'+i]=Object.assign({bundleId:'B90'+i,poId:'PO-209',size:'M',units:60},b);});
    const fk=W.makeFake(seed);
    const Q=W.mk(user,{fk:fk,src:src});
    await Q.show();await Q.open('PO-209');await Q.click('phaf-close-btn');
    const r=await Q.R('phqcDlgGo()');await kit.settle(60);
    return{r:r,flash:Q.text(Q.id('phaf-flash')),pos:fk.store['pos/PO-209'],closed:JSON.parse(Q.R('JSON.stringify(_phqcModelNow().groups.closed.map(t=>t.id))')),Q:Q};
  };
  {
    const st=await closeAs('faizan','stitching');
    s.eq('Faizan closes a PO at STITCHING: the flash says Final QC is NOT marked complete, why, and where the PO goes',
      'PO-209 is closed — Thu 15 Oct 2026, 12:00 PM by Faizan. Final QC is NOT marked complete: PO is still at stitching. The PO carries on at Stitching; Haris completes Final QC on its stage page as usual. Here it is listed under "Closed (last 7 days)", then it leaves Afloat POs.',st.flash);
    s.ok('… and that is the truth: the PO is still at stitching, and it IS listed under Closed (last 7 days)',st.r.ok&&st.r.classic.written===false&&st.pos.currentStage==='stitching'&&J(st.closed)===J(['PO-209']));
    const ok=await closeAs('faizan','qc',[{qcStatus:'pass'},{qcStatus:'fail',size:'L',qcReason:'stain'}]);
    s.eq('a PO at QC with every bundle dispositioned: "Final QC is marked complete."','PO-209 is closed — Thu 15 Oct 2026, 12:00 PM by Faizan. Final QC is marked complete.',ok.flash);
    s.ok('… and it was (currentStage completed, stages.qc.done)',ok.r.classic.written===true&&ok.pos.currentStage==='completed'&&ok.pos.stages.qc.done===true);
    const pend=await closeAs('faizan','qc',[{qcStatus:'pass'},{size:'L'}]);
    s.ok('a PO at QC with ONE bundle not yet dispositioned: NOT marked complete, "1 bundle not yet dispositioned by QC", carries on at Final QC',/Final QC is NOT marked complete: 1 bundle not yet dispositioned by QC\. The PO carries on at Final QC;/.test(pend.flash)&&pend.pos.currentStage==='qc',pend.flash);
    const already=await closeAs('mustafa','completed');
    s.ok('a PO the classic flow had already completed: "Final QC had already been completed in the classic flow."',/PO-209 is closed — .*\. Final QC had already been completed in the classic flow\.$/.test(already.flash),already.flash);
    s.ok('a result with no `classic` (an older writer): "not known", never a claim',/not known — check the PO page/.test(String(st.Q.R('phI18nT("afloat.ok_close",{po:"PO-1",when:"x",classic:phqcClassicLine({ok:true},{stage:"qc"})},"en")'))));
    const I18N=read('js/ph-i18n.js');
    s.ok('the close confirm and the shortfall confirm no longer promise Final QC unconditionally',/Closing marks Final QC complete only when the PO is at Final QC and QC has checked every bundle/.test(I18N)&&/Final QC is marked complete on the PO if it is at Final QC with every bundle checked/.test(I18N)&&!/'Closing marks Final QC complete\. /.test(I18N));
    const b=await closeAs('faizan','stitching',null,mut(SRC,"  if(c.written===true)return phI18nD('afloat.ok_classic_yes');","  return phI18nD('afloat.ok_classic_yes');"));
    s.ok('break "the line always says marked complete" fails "… NOT marked complete, why, and where the PO goes"',/NOT marked complete/.test(b.flash)===false);
  }

  /* ── 5. QC9: the read-only card on the classic PO page ─────────── */
  s.section('5. QC9: read-only QC reconciliation card on the classic PO detail page');
  const POSJ=read('js/pos.js');
  s.ok('js/pos.js: the slot sits right after the instruction card slot, behind typeof',/\$\{typeof window\.phPoDetailCardSlot==='function'\?window\.phPoDetailCardSlot\(po\):''\}\n  \$\{typeof window\.phPoQcCardSlot==='function'\?window\.phPoQcCardSlot\(po\):''\}/.test(POSJ));
  s.ok('js/pos.js: the fill is called after the page HTML is in, behind typeof',/window\.phPoDetailCardFill\(po\);\n  if\(typeof window\.phPoQcCardFill==='function'\)window\.phPoQcCardFill\(po\);/.test(POSJ));
  const PCSEED=()=>({'pos/PO-501':W.cutPo('PO-501','qc'),
    'po_qc_recon/PO-501':W.recon('PO-501',{lotCount:3,voidCount:1,rev:5}),
    'po_qc_lots/PO-501-1792000000001-aaaa':W.lotRow('PO-501',1,{S:10,M:15,L:10,XL:5},{at:W.MON_4PM,day:'2026-10-12',note:kit.HOSTILE}),
    'po_qc_lots/PO-501-1792000000002-bbbb':W.lotRow('PO-501',2,{S:5,M:15,L:20},{at:W.WED_905,day:'2026-10-14'}),
    'po_qc_lots/PO-501-1792000000003-cccc':W.lotRow('PO-501',3,{XL:15},{at:W.THU_0005,day:'2026-10-15',status:'void',voidedAt:W.THU_NOON,voidedBy:'faizan',voidReason:'wrong size'})});
  const fill=async(user,o)=>{
    o=o||{};W.CLK.now=W.THU_NOON;
    const fk=W.makeFake(o.seed||PCSEED(),{getDocErr:o.getDocErr});
    const T=W.mk(user,{fk:fk,src:o.src});
    if(o.lotsErr)T.ctx.getDocs=async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});};
    if(o.cache)T.ctx.getDoc=async r=>({exists:()=>false,data:()=>null,metadata:{fromCache:true}});
    T.R('(function(){const h=document.createElement("div");h.id="ph-detail-qc";document.body.appendChild(h);})()');
    const tx0=fk.log.tx,w0=fk.log.writes.length;
    const ret=await T.R('window.phPoQcCardFill('+J(fk.store['pos/PO-501']||{fbKey:'PO-501',id:'PO-501'})+')');
    await kit.settle(20);
    const host=T.ctx.document.getElementById('ph-detail-qc');
    const rows=T.ctx.document.getElementsByTagName?null:null;
    const trs=T.dom.all(host,n=>n.tagName==='TR').map(r=>r.children.map(c=>T.text(c)).join('|'));
    return{ret,T,fk,host,text:T.text(host),trs,lots:T.cls('phaf-lot',host).map(n=>T.text(n)),voided:T.cls('phaf-lot-void',host).length,writes:fk.log.writes.length-w0,tx:fk.log.tx-tx0,btns:T.dom.all(host,n=>n.tagName==='BUTTON'||n.tagName==='INPUT'||n.tagName==='TEXTAREA').length};
  };
  {
    for(const u of ['afnan','faizan']){
      const a=await fill(u);
      s.ok(u+': the card is drawn and says it is read-only; status "Open — QC is receiving. Cut locked Sun 11 Oct 2026, 4:00 PM by Faizan."',a.ret===true&&/QC reconciliation \(read-only\)/.test(a.text)&&/Open — QC is receiving\. Cut locked Sun 11 Oct 2026, 4:00 PM by Faizan\./.test(a.text)&&/Read-only\. Lots are received and the PO is closed in Production Ops ▸ Afloat POs\./.test(a.text),a.text);
    }
    const a=await fill('mustafa');
    s.eq('per size cut | received | difference (hand-computed; the void lot does not count)',J(a.trs),J(['Size|Cut (final)|QC received|Difference','S|20|15|−5','M|40|30|−10','L|40|30|−10','XL|20|5|−15','Total|120|80|−40']));
    s.ok('the verdict reads "receiving"',/◐ receiving/.test(a.text));
    s.eq('three lots, oldest first, each with its 12-hour PKT stamp',J(a.lots.map(t=>t.split(' pcs')[0])),J(['Lot #1 · Mon 12 Oct 2026, 4:00 PM by Faizan40','Lot #2 · Wed 14 Oct 2026, 9:05 AM by Faizan40','Lot #3 · Thu 15 Oct 2026, 12:05 AM by Faizan15']));
    s.ok('the void lot is struck through and says who voided it, when and why',a.voided===1&&/Thu 15 Oct 2026, 12:00 PM by Faizan/.test(a.lots[2])&&/wrong size/.test(a.lots[2]));
    s.ok('no 24-hour time on the card',!/\b(1[3-9]|2[0-3]|0\d):\d\d\b/.test(a.text));
    s.ok('it WRITES NOTHING (no write, no transaction) and offers NO control',a.writes===0&&a.tx===0&&a.btns===0);
    s.ok('a hostile lot note reaches the page as text only',/<img src=x onerror=alert\(1\)>/.test(a.text)&&a.T.dom.all(a.host,n=>n.tagName==='IMG').length===0);
    const closedSeed=PCSEED();closedSeed['po_qc_recon/PO-501']=W.recon('PO-501',{status:'closed',closedAt:W.THU_NOON,closedBy:'mustafa',closedByName:'Mustafa',lotCount:3,voidCount:1,rev:6});
    const c=await fill('afnan',{seed:closedSeed});
    s.ok('a closed reconciliation: "Closed Thu 15 Oct 2026, 12:00 PM by Mustafa." and the closed verdict',/Closed Thu 15 Oct 2026, 12:00 PM by Mustafa\./.test(c.text)&&/✓ closed/.test(c.text),c.text);
    const none=await fill('afnan',{seed:{'pos/PO-501':W.cutPo('PO-501','qc')}});
    s.ok('no reconciliation and no lot (an older PO): NOTHING is drawn, the page looks as before',none.ret===false&&none.host.children.length===0);
    const e1=await fill('afnan',{getDocErr:{'po_qc_recon/PO-501':()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'})}});
    s.ok('po_qc_recon refused: an alert naming po_qc_recon, no table, no number',/could not be read — po_qc_recon/.test(e1.text)&&e1.trs.length===0&&e1.T.dom.all(e1.host,n=>n.getAttribute&&n.getAttribute('role')==='alert').length===1,e1.text);
    const e2=await fill('afnan',{lotsErr:true});
    s.ok('po_qc_lots refused: an alert naming po_qc_lots, no table',/could not be read — po_qc_lots/.test(e2.text)&&e2.trs.length===0);
    const e3=await fill('afnan',{cache:true});
    s.ok('an offline-copy answer is a failure, not "no reconciliation"',/could not be read — po_qc_recon/.test(e3.text)&&/offline copy/.test(e3.text));
    const r1=await fill('afnan',{seed:{'pos/PO-501':W.cutPo('PO-501','qc')},src:mut(SRC,"  if(!rc&&!lots.length)return null;\n","")});
    s.ok('break "a card drawn for a PO with no reconciliation" fails "… NOTHING is drawn"',!(r1.ret===false&&r1.host.children.length===0));
    const r2=await fill('afnan',{getDocErr:{'po_qc_recon/PO-501':()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'})},src:mut(SRC,"  }catch(e){out.err={collection:'po_qc_recon',message:_phqcErr(e).message};return out;}","  }catch(e){return out;}")});
    s.ok('break "a refused po_qc_recon read drawn as none" fails "… an alert naming po_qc_recon"',!/could not be read — po_qc_recon/.test(r2.text));
    const r3=await fill('afnan',{cache:true,src:mut(SRC,"    if(snap&&snap.metadata&&snap.metadata.fromCache===true)throw Object.assign(new Error('the read was answered from this device\\'s offline copy'),{code:'from-cache'});\n    out.recon=","    out.recon=")});
    s.ok('break "an offline copy accepted" fails "an offline-copy answer is a failure"',!/offline copy/.test(r3.text));
  }

  /* ── wiring ─────────────────────────────────────────────────────── */
  s.section('wiring: CACHE_VERSION past v343, the changed files carry new distinct ?v= tags');
  {
    const IX=read('index.html'),SW=read('sw.js');
    s.ok('sw.js CACHE_VERSION is v344 or later (wave 1 was v343)',+(/CACHE_VERSION = 'v(\d+)'/.exec(SW)||[0,0])[1]>=344);
    for(const [f,tag] of [['js/pos.js','20261018qw2p'],['js/ph-i18n.js','20261018qw2i'],['js/ph-mod-health.js','20261018qw2h'],['js/ph-mod-afloat.js','20261018qw2a']])
      s.ok(f+' is loaded with ?v='+tag+' (a tag no other file uses)',IX.indexOf('/'+f+'?v='+tag+'"')>-1&&IX.split('?v='+tag+'"').length===2);
  }

  return s;
};

/* Production Ops ▸ Afloat POs, the MANAGER OVERRIDES (QC7, 15 Oct 2026): js/ph-mod-afloat.js's "Close with a shortfall…" (a manager),
   "Replace the cut snapshot…" (an owner), "Reopen…" (an owner) and "Adopt old receipts as lot #n" (a manager), their two-step dialogs,
   and the read-only overrides list on the detail.

   What this drives: the REAL js/ph-core.js, ph-data.js, ph-write.js, ph-qc-write.js (the QC4 writers), ph-i18n.js, ph-ui.js and the
   module, over tests/ph-dom.js and the in-memory Firestore of tests/ph-mod-afloat-write.test.js (real transaction semantics: reads
   before writes, all-or-nothing commit, every read / write recorded). The REAL handlers are pressed; nothing is called past the screen
   except to show that the writer refuses a person the screen gives no control to.
     · the 120-piece PO (cut 20/40/40/20) with lots totalling 118 (M 2 short): a manager closes it short -- the per-size words, the cause
       and reason checks, step 2, the close_short overrides row, the qc_closed_short history row, the bell rows to the OTHER managers, the
       classic Final QC fields; Faizan has no control and the writer refuses him
     · relock 20/40/40/20 -> 20/38/40/20 (the PO's recorded cut was corrected) with the lots already received becoming EXACT; refused for
       Mustafa (not an owner) and Faizan; the lots are byte-for-byte unchanged
     · reopen by an owner, another lot, close again: both close records kept in the PO's history, in order; the pos document untouched by
       the reopen; refused for non-owners
     · adopt legacy: offered only while old Packing receipts are not adopted; one lot with src 'legacy'; the button disappears; a second
       press from another screen is stale
     · every dialog: two steps (nothing written at step 1), double press, offline, stale revision (the latest copy read again), Escape,
       focus into the dialog / trapped in it / back to the opener, success feedback with a 12-hour PKT stamp and the person's name
     · the overrides list for a manager and for Faizan (read-only: no control in it), hostile reasons as text
     · 20 deliberate reverts, each failing a named assertion
   What it does NOT prove: the rules (tests/rules-emulator-ph.js), geometry (tests/smoke-layout.js), real Firestore, a real phone. */
'use strict';
const fs=require('fs'),path=require('path');
const harness=require('./harness');
const {suite}=harness;
const K=require('./ph-mod-afloat-write.test.js').kit;
const {mk,makeFake,cutPo,recon,lotRow,settle,CLK,WED_905,THU_NOON}=K;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC=read('js/ph-mod-afloat.js');
const QCW=read('js/ph-qc-write.js');
const J=JSON.stringify;
const HOUR=3600000;
const HOSTILE='<img src=x onerror=alert(1)>';
function hasC(n,c){return String(n.className||'').split(/\s+/).indexOf(c)>-1;}
// PHQC7_CONTROL=1 runs every revert scenario UNBROKEN (the mutation checked for its target, then not applied): each must then pass,
// which shows a revert fails because of its break and not because its scenario fails anyway.
const CONTROL=!!process.env.PHQC7_CONTROL;
const mut=(t,a,b)=>{if(t.indexOf(a)<0)throw new Error('break target missing: '+a.slice(0,70));return CONTROL?t:t.split(a).join(b);};

// The PO with lots totalling 118 of 120 (M 38 of 40, allowance 1: SHORT on M; the total is inside its allowance of 2).
function shortSeed(id,o){
  o=o||{};
  const s={};
  s['pos/'+id]=cutPo(id,'qc',o.po);
  s['po_qc_recon/'+id]=recon(id,Object.assign({lotCount:2,rev:2},o.recon||{}));
  s['po_qc_lots/'+id+'-1792000000001-aaaa']=lotRow(id,1,{S:20,M:20,L:20,XL:10},{at:WED_905-5*HOUR});
  s['po_qc_lots/'+id+'-1792000000002-bbbb']=lotRow(id,2,{M:18,L:20,XL:10},{at:WED_905-4*HOUR});
  // QC fix wave 1 integration (R1, 16 Oct 2026), a deliberate change: R1 writes the classic Final QC fields only for a PO at stage
  // qc whose bundles are ALL dispositioned, and refuses "no bundles on record". This PO is at qc; two dispositioned bundles are
  // seeded so the close-short path still exercises (and asserts) the classic write, as R1 intends for such a PO.
  if(!o.noBundles){
    s['bundles/'+id+'-B1']={bundleId:id+'-B1',poId:id,size:'M',units:60,qcStatus:'pass'};
    s['bundles/'+id+'-B2']={bundleId:id+'-B2',poId:id,size:'L',units:60,qcStatus:'pass'};
  }
  return s;
}
const hist=(T,id,type)=>Object.keys(T.store).filter(k=>k.indexOf('pos/'+id+'/history/')===0).map(k=>T.store[k]).filter(h=>!type||h.type===type).sort((a,b)=>a.at-b.at);
const bells=T=>Object.keys(T.store).filter(k=>k.indexOf('hrm_notifications/')===0).map(k=>T.store[k]);
const lotDocs=(T,id)=>{const o={};Object.keys(T.store).filter(k=>k.indexOf('po_qc_lots/'+id+'-')===0).forEach(k=>{o[k]=J(T.store[k]);});return o;};
const dlg=T=>T.cls('phaf-dlg')[0]||null;
function fill(T,o){
  if(o.cause!==undefined){const s=T.id('phaf-dlg-cause');if(!s)throw new Error('no cause box');s.value=o.cause;T.dom.dispatch(s,'change');}
  if(o.reason!==undefined){const r=T.id('phaf-dlg-reason');if(!r)throw new Error('no reason box');r.value=o.reason;T.dom.dispatch(r,'input');}
}
const go=async T=>{const r=await T.R('phqcDlgGo()');await settle(40);return r;};
// one override, through the screens, up to step 2 (not confirmed)
async function toStep2(T,poId,btn,o){if(T.card(poId))await T.open(poId);await T.click(btn);fill(T,o||{});await go(T);}
// count the calls a writer receives (the module calls it by its bare global name)
const spy=(T,name)=>T.R('globalThis.__calls=0;(function(){const o='+name+';'+name+'=function(){globalThis.__calls++;return o.apply(this,arguments);};})();');
const calls=T=>T.R('globalThis.__calls');

module.exports=async function(){
  const s=suite('ph-mod-afloat-override');

  /* ── 1. close with a shortfall: the 118-of-120 PO ─────────────────────────────────── */
  s.section('close with a shortfall: a manager closes the 118-of-120 PO (M 2 short) with a cause and a reason');
  CLK.now=WED_905;
  const fkA=makeFake(shortSeed('PO-401'));
  {
    const F=mk('faizan',{fk:fkA});await F.show();await F.open('PO-401');
    s.ok('Faizan on the short PO: no "Close with a shortfall…" control of any kind, "Only a manager can close a short PO."',F.all(n=>/Close with a shortfall/.test(n.textContent||'')&&n.tagName==='BUTTON').length===0&&!F.id('phaf-close-btn')&&/Only a manager can close a short PO\./.test(F.text(F.detail())));
    s.ok('… phqcShortAsk refuses him (no dialog)',F.R('phqcShortAsk("PO-401")')===false&&!dlg(F));
    const wr=await F.R('phQcClose("PO-401",{expectedRev:2,reason:"two pieces lost",cause:"lost_in_line"})');
    s.ok('… and the writer refuses him directly (forbidden), nothing written',wr.ok===false&&wr.code==='forbidden'&&fkA.log.writes.length===0);
  }
  const txA=fkA.log.tx;   // Faizan's refused attempt above opened (and abandoned) one transaction
  const lotsBefore=lotDocs({store:fkA.store},'PO-401');
  const M=mk('mustafa',{fk:fkA});await M.show();await M.open('PO-401');
  spy(M,'phQcClose');
  {
    const b=M.id('phaf-close-btn');
    s.ok('Mustafa (a manager): "Close with a shortfall…" is a LIVE button',!!b&&/Close with a shortfall…/.test(M.text(b))&&!hasC(b,'phaf-off')&&b.disabled!==true);
    await M.click('phaf-close-btn');
    const d=dlg(M);
    s.ok('the dialog: role=dialog, aria-modal, titled "Close PO-401 with a shortfall?", step 1 of 2',!!d&&d.getAttribute('role')==='dialog'&&d.getAttribute('aria-modal')==='true'&&/Close PO-401 with a shortfall\?/.test(M.text(d))&&/Step 1 of 2/.test(M.text(d)));
    const gaps=M.cls('phaf-ov-gap',d).map(n=>M.text(n));
    s.eq('… the shortfall it accepts, per size, in plain words (and the total)',J(gaps),J(['M: 2 short — 38 of 40 received (allowance 1)','Exactly as cut: S, L, XL','Total: 2 short — 118 of 120 (allowance 2)']));
    s.ok('… says the differences become final, Final QC is marked complete and the OTHER managers (Afnan, Ammar) are told',/These differences become final: Final QC is marked complete/.test(M.text(d))&&/Afnan, Ammar are told on their bell/.test(M.text(d)));
    s.ok('… focus is in the dialog (the cause box)',M.ctx.document.activeElement===M.id('phaf-dlg-cause'));
    s.ok('… the cause list is the writer\'s: Cutting miscount, Lost in the line, Damaged before QC, Other (after "Choose a cause…")',J(M.id('phaf-dlg-cause').children.map(o=>o.value))===J(['','cutting_miscount','lost_in_line','damaged_before_qc','other'])&&J(M.id('phaf-dlg-cause').children.map(o=>o.textContent))===J(['Choose a cause…','Cutting miscount','Lost in the line','Damaged before QC','Other']));
    s.ok('… the primary button is aria-disabled until a cause and a reason are given',M.id('phaf-dlg-go').getAttribute('aria-disabled')==='true');
    // Escape closes, focus back on the opener, nothing written
    M.dom.dispatch(d,'keydown',{key:'Escape'});await settle(30);
    s.ok('Escape closes it; focus back on "Close with a shortfall…"; nothing written',!dlg(M)&&M.ctx.document.activeElement===M.id('phaf-close-btn')&&fkA.log.writes.length===0);
    await M.click('phaf-close-btn');
    fill(M,{reason:'two pieces lost in the line'});
    const r0=await go(M);
    s.ok('no cause: refused with a visible message, still step 1, nothing written',r0.code==='invalid'&&/Choose a cause from the list\./.test(M.text(M.id('phaf-dlg-msg')))&&/Step 1 of 2/.test(M.text(dlg(M)))&&fkA.log.writes.length===0&&fkA.log.tx===txA&&calls(M)===0);
    fill(M,{cause:'lost_in_line',reason:'abc'});
    const r1=await go(M);
    s.ok('a reason under 5 characters: refused with a visible message, still step 1',r1.code==='invalid'&&/A reason of at least 5 characters is needed\./.test(M.text(M.id('phaf-dlg-msg')))&&!!M.id('phaf-dlg-reason')&&fkA.log.tx===txA&&calls(M)===0);
    fill(M,{reason:'two pieces lost in the line'});
    s.ok('… with both, the primary button is enabled',M.id('phaf-dlg-go').getAttribute('aria-disabled')===null);
    const r2=await go(M);
    s.ok('Continue: step 2 of 2 reads back the cause and the reason; NOTHING written yet',r2.code==='confirm'&&/Step 2 of 2/.test(M.text(dlg(M)))&&/Cause: Lost in the line/.test(M.text(dlg(M)))&&/“two pieces lost in the line”/.test(M.text(dlg(M)))&&fkA.log.writes.length===0&&fkA.log.tx===txA&&calls(M)===0);
    s.ok('… the final button says what it does ("Yes, close PO-401 with a shortfall") and has focus',/Yes, close PO-401 with a shortfall/.test(M.text(M.id('phaf-dlg-go')))&&M.ctx.document.activeElement===M.id('phaf-dlg-go'));
    await M.click('phaf-dlg-no');
    s.ok('"Back" returns to step 1 with the cause and the reason kept',/Step 1 of 2/.test(M.text(dlg(M)))&&M.id('phaf-dlg-cause').value==='lost_in_line'&&M.id('phaf-dlg-reason').value==='two pieces lost in the line');
    await go(M);
    // offline
    M.R('navigator.onLine=false');
    const ro=await go(M);
    s.ok('offline: refused out loud IN the dialog, still step 2, no transaction',ro.code==='offline'&&/No connection\. This is saved with a transaction/.test(M.text(M.id('phaf-dlg-msg')))&&/Step 2 of 2/.test(M.text(dlg(M)))&&fkA.log.tx===txA&&calls(M)===0);
    M.R('navigator.onLine=true');
    // the double press
    const p1=M.R('phqcDlgGo()'),p2=M.R('phqcDlgGo()');
    const d1=await p1,d2=await p2;await settle(60);
    s.ok('a double press closes ONCE (the second press is "busy"; one transaction)',d1&&d1.ok===true&&d2.code==='busy'&&fkA.log.tx===txA+1&&calls(M)===1);
    const RC=fkA.store['po_qc_recon/PO-401'],P=fkA.store['pos/PO-401'];
    s.ok('the reconciliation is closed by mustafa with ONE close_short overrides row: cause lost_in_line, the reason, his name, the moment',RC.status==='closed'&&RC.closedBy==='mustafa'&&RC.closedAt===WED_905&&RC.overrides.length===1&&RC.overrides[0].kind==='close_short'&&RC.overrides[0].cause==='lost_in_line'&&RC.overrides[0].reason==='two pieces lost in the line'&&RC.overrides[0].by==='mustafa'&&RC.overrides[0].at===WED_905&&RC.closeVerdict.phase==='short');
    const h=hist({store:fkA.store},'PO-401','qc_closed_short');
    s.ok('… one history row qc_closed_short (override, cause, 118 of 120)',h.length===1&&h[0].data.override===true&&h[0].data.cause==='lost_in_line'&&h[0].data.recv===118&&h[0].data.cut===120);
    const bl=bells({store:fkA.store});
    s.eq('… bell rows to the OTHER managers (afnan, ammar), none to the closer',J(bl.map(b=>b.forUser).sort()),J(['afnan','ammar']));
    s.ok('… each bell names the PO, the closer, the cause and the reason',bl.every(b=>/PO-401/.test(b.title)&&/Mustafa closed PO-401 at QC with 118 of 120 received \(short, lost_in_line\)\. Reason: two pieces lost in the line/.test(b.message)));
    s.ok('… and the PO carries the classic Final QC fields + qcReconClosedAt/By',P.currentStage==='completed'&&P.stages.qc.done===true&&/closed by a manager: short/.test(P.stages.qc.notes)&&P.qcReconClosedAt===WED_905&&P.qcReconClosedBy==='mustafa');
    s.ok('… the lots are byte-for-byte as saved',J(lotDocs({store:fkA.store},'PO-401'))===J(lotsBefore));
    s.eq('success feedback: the stamp in 12-hour PKT, the person, the total accepted, who was told','PO-401 is closed with a shortfall — Wed 14 Oct 2026, 9:05 AM by Mustafa. Total: 2 short — 118 of 120 (allowance 2). Final QC is marked complete. Afnan, Ammar were told.',M.text(M.id('phaf-flash')));
    s.ok('… focus on that line; the dialog is gone',M.ctx.document.activeElement===M.id('phaf-flash')&&!dlg(M));
    const ov=M.id('phaf-ovs');
    s.ok('the overrides list on the detail: "Closed with a shortfall · Wed 14 Oct 2026, 9:05 AM by Mustafa", the cause and the reason',!!ov&&/Overrides on this PO \(1\)/.test(M.text(ov))&&/Closed with a shortfall · Wed 14 Oct 2026, 9:05 AM by Mustafa/.test(M.text(ov))&&/Cause: Lost in the line/.test(M.text(ov))&&/“two pieces lost in the line”/.test(M.text(ov)));
    s.ok('… and the closed band says it was closed with a shortfall, by whom, why',/Closed with a shortfall by Mustafa — cause: Lost in the line\. Reason: “two pieces lost in the line”/.test(M.text(M.id('phaf-ovline'))));
    s.ok('Mustafa (not an owner) gets no Reopen control on the closed PO',!M.id('phaf-reopen-btn')&&M.R('phqcReopenAsk("PO-401")')===false);
    const F2=mk('faizan',{fk:fkA});await F2.show();
    const tg=F2.cls('phaf-gtog')[0];if(tg)F2.dom.click(tg);await settle(20);
    await F2.open('PO-401');
    s.ok('Faizan sees the SAME overrides list and the band (by Mustafa, the cause), with NO control in the list',/Closed with a shortfall · Wed 14 Oct 2026, 9:05 AM by Mustafa/.test(F2.text(F2.id('phaf-ovs')))&&/Closed with a shortfall by Mustafa/.test(F2.text(F2.detail()))&&F2.all(n=>/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(n.tagName)&&(function(x){for(let p=x;p;p=p.parentNode)if(p===F2.id('phaf-ovs'))return true;return false;})(n)).length===0);
    s.ok('… and no Reopen / Replace / Adopt control anywhere',!F2.id('phaf-reopen-btn')&&!F2.id('phaf-relock-btn')&&!F2.id('phaf-adopt-btn')&&!/Reopen…|Replace the cut snapshot|Adopt old receipts/.test(F2.text(F2.detail())));
  }

  /* ── 2. reopen by an owner, another lot, close again ───────────────────────────────── */
  s.section('reopen: an owner reopens the closed PO; another lot; it closes again; both closes kept in order');
  {
    const posBefore=J(fkA.store['pos/PO-401']);
    CLK.now=WED_905+HOUR;
    const A=mk('afnan',{fk:fkA});await A.show();
    const tg=A.cls('phaf-gtog')[0];if(tg)A.dom.click(tg);await settle(20);
    await A.open('PO-401');
    const b=A.id('phaf-reopen-btn');
    s.ok('Afnan (an owner): a live "Reopen…" button on the closed PO',!!b&&/Reopen…/.test(A.text(b))&&!hasC(b,'phaf-off'));
    for(const u of ['mustafa','faizan','uzaib','raees']){const W=mk(u,{fk:fkA});const r=await W.R('phQcReopen("PO-401",{expectedRev:3,reason:"one carton found"})');s.ok(u+': the writer refuses a reopen (forbidden)',r.ok===false&&r.code==='forbidden');}
    await A.click('phaf-reopen-btn');
    const d=dlg(A);
    s.ok('the dialog names the close ("closed Wed 14 Oct 2026, 9:05 AM by Mustafa, with 118 of 120 received")',/PO-401 was closed Wed 14 Oct 2026, 9:05 AM by Mustafa, with 118 of 120 received/.test(A.text(d)));
    s.ok('… says exactly what reopening writes and that the PO document is NOT changed',/the QC reconciliation goes back to open \(status “reopened”\)/.test(A.text(d))&&/qc_reopened/.test(A.text(d))&&/No bell is sent/.test(A.text(d))&&/The PO document is NOT changed: it stays Completed with Final QC marked done/.test(A.text(d)));
    s.ok('… and what closing again does (qcReconClosedAt / qcReconClosedBy set to the new close; stages.qc keeps the first)',/sets qcReconClosedAt \/ qcReconClosedBy on the PO to the new close/.test(A.text(d))&&/stages\.qc\) keep the first close/.test(A.text(d)));
    s.ok('… focus in the reason box',A.ctx.document.activeElement===A.id('phaf-dlg-reason'));
    s.ok('… a reopen has no cause box, and its step line asks only for the reason (not "the cause and the reason")',!A.id('phaf-dlg-cause')&&/Step 1 of 2 · read what is being accepted, then give the reason$/.test(A.text(A.cls('phaf-dlg-step')[0]).trim()));
    fill(A,{reason:'one'});
    const r0=await go(A);
    s.ok('a short reason refused at step 1',r0.code==='invalid'&&/at least 5 characters/.test(A.text(A.id('phaf-dlg-msg'))));
    fill(A,{reason:'one carton found in the store'});
    await go(A);
    const tx0=fkA.log.tx;
    s.ok('step 2, nothing written',/Step 2 of 2/.test(A.text(dlg(A)))&&fkA.log.tx===tx0);
    const r=await go(A);
    const RC=fkA.store['po_qc_recon/PO-401'];
    s.ok('reopened: status reopened, a reopen overrides row by afnan with the reason, the close_short row untouched',r.ok&&RC.status==='reopened'&&RC.overrides.length===2&&RC.overrides[1].kind==='reopen'&&RC.overrides[1].by==='afnan'&&RC.overrides[1].reason==='one carton found in the store'&&RC.overrides[0].kind==='close_short'&&RC.overrides[0].reason==='two pieces lost in the line');
    s.ok('… the pos document is byte-for-byte unchanged by the reopen',J(fkA.store['pos/PO-401'])===posBefore);
    s.ok('… a qc_reopened history row; no bell row added',hist({store:fkA.store},'PO-401','qc_reopened').length===1&&bells({store:fkA.store}).length===2);
    s.eq('… the success line','PO-401 is reopened — Wed 14 Oct 2026, 10:05 AM by Afnan. The PO stays marked completed until QC closes it again.',A.text(A.id('phaf-flash')));
    s.ok('… the overrides list now reads close_short then reopen, oldest first',J(A.cls('phaf-ov',A.id('phaf-ovs')).map(n=>n.getAttribute('data-kind')))===J(['close_short','reopen']));
    // another lot (the 2 missing M) and the close again, by Faizan (plain close: exact)
    CLK.now=WED_905+2*HOUR;
    const F=mk('faizan',{fk:fkA});await F.show();await F.open('PO-401');
    await F.click('phaf-recv-btn');F.fill({M:2});await F.click('phaf-rx-review');
    const rl=await F.R('phqcSheetSave()');await settle(60);
    s.ok('after the reopen Faizan receives the 2 M: lot #3, PO exact (120 of 120)',rl.ok&&rl.seq===3&&/●exact/.test(F.text(F.detail())));
    CLK.now=WED_905+3*HOUR;
    await F.click('phaf-close-btn');
    const rc2=await F.R('phqcDlgGo()');await settle(60);
    const RC2=fkA.store['po_qc_recon/PO-401'],P2=fkA.store['pos/PO-401'];
    s.ok('closed again by Faizan (exact, plain close)',rc2.ok&&RC2.status==='closed'&&RC2.closedBy==='faizan'&&RC2.closedAt===WED_905+3*HOUR&&RC2.closeVerdict.state==='exact');
    const H=hist({store:fkA.store},'PO-401').filter(x=>/^qc_(closed|closed_short|reopened)$/.test(x.type));
    s.eq('BOTH close records are kept in the PO\'s history, in order: closed short, reopened, closed',J(H.map(x=>x.type+'@'+x.at)),J(['qc_closed_short@'+WED_905,'qc_reopened@'+(WED_905+HOUR),'qc_closed@'+(WED_905+3*HOUR)]));
    s.ok('… the second close set qcReconClosedAt/By to the new close; Final QC\'s own fields keep the first close',P2.qcReconClosedAt===WED_905+3*HOUR&&P2.qcReconClosedBy==='faizan'&&P2.stages.qc.doneAt===new Date(WED_905).toISOString()&&P2.stages.qc.doneBy==='Mustafa');
    s.ok('… the two override rows are still there, unchanged',RC2.overrides.length===2&&RC2.overrides[0].reason==='two pieces lost in the line'&&RC2.overrides[1].reason==='one carton found in the store');
  }

  /* ── 3. relock: the PO's recorded cut corrected to 20/38/40/20 ─────────────────────── */
  s.section('relock: an owner replaces the lock 20/40/40/20 with the PO\'s corrected cut 20/38/40/20; the lots become exact');
  CLK.now=WED_905;
  const fkB=makeFake(shortSeed('PO-402',{po:{cutQty:{S:20,M:38,L:40,XL:20}}}));
  {
    const lotsB=lotDocs({store:fkB.store},'PO-402');
    const F=mk('faizan',{fk:fkB});await F.show();await F.open('PO-402');
    s.ok('Faizan: no Replace control; phqcRelockAsk refuses; the writer refuses (forbidden)',!F.id('phaf-relock-btn')&&F.R('phqcRelockAsk("PO-402")')===false&&(await F.R('phQcRelock("PO-402",{expectedRev:2,reason:"M recounted"})')).code==='forbidden');
    const Mu=mk('mustafa',{fk:fkB});await Mu.show();await Mu.open('PO-402');
    const mb=Mu.id('phaf-relock-btn');
    s.ok('Mustafa (a manager, not an owner): "Replace the cut snapshot…" is DISABLED and says only an owner can',!!mb&&hasC(mb,'phaf-off')&&mb.disabled===true&&/Only an owner \(Afnan or Ammar\) can replace the cut snapshot/.test(Mu.text(Mu.detail())));
    s.ok('… phqcRelockAsk refuses him and the writer refuses him (forbidden)',Mu.R('phqcRelockAsk("PO-402")')===false&&(await Mu.R('phQcRelock("PO-402",{expectedRev:2,reason:"M recounted"})')).code==='forbidden'&&fkB.log.tx===0);
    const A=mk('afnan',{fk:fkB});await A.show();await A.open('PO-402');
    s.ok('Afnan (an owner): a live "Replace the cut snapshot…" (the drift band is shown)',!!A.id('phaf-relock-btn')&&!hasC(A.id('phaf-relock-btn'),'phaf-off')&&/M 40 → 38/.test(A.text(A.detail())));
    await A.click('phaf-relock-btn');
    const d=dlg(A);
    const rows=A.all(n=>n.tagName==='TR'&&n.parentNode&&n.parentNode.tagName==='TBODY'&&(function(x){for(let p=x;p;p=p.parentNode)if(p===d)return true;return false;})(n)).map(r=>r.children.map(c=>c.textContent).join('|'));
    s.eq('the old and the new cut per size (Locked now | Recorded on the PO | Change)',J(rows),J(['S|20|20|—','M|40|38|−2','L|40|40|—','XL|20|20|—','Total|120|118|−2']));
    s.ok('… the effect on the verdict BEFORE confirming: now SHORT, after the replacement EXACT 118 of 118',/Now: PO-402 has 118 of 120 and is SHORT on a size beyond its allowance\./.test(A.text(A.id('phaf-ov-before')))&&/After the replacement: PO-402 is now exact: 118 of 118\. It can be closed\./.test(A.text(A.id('phaf-ov-after'))));
    s.ok('… warns that the lots already received are NOT changed (2 lots, 118 pcs)',/The lots already received are NOT changed: 2 lots, 118 pcs stay exactly as saved/.test(A.text(d)));
    s.ok('… and that the new figures are the PO\'s recorded cut (nothing typed here)',/nothing on this screen types a cut/.test(A.text(d))&&A.all(n=>n.tagName==='INPUT'&&(function(x){for(let p=x;p;p=p.parentNode)if(p===d)return true;return false;})(n)).length===0);
    fill(A,{reason:'M recounted at the cutting table'});
    const r0=await go(A);
    s.ok('no cause: refused at step 1',r0.code==='invalid'&&/Choose a cause/.test(A.text(A.id('phaf-dlg-msg')))&&fkB.log.tx===0);
    fill(A,{cause:'cutting_miscount'});
    await go(A);
    s.ok('step 2 reads back the cause and reason; nothing written',/Cause: Cutting miscount/.test(A.text(dlg(A)))&&fkB.log.tx===0);
    const r=await go(A);
    const RC=fkB.store['po_qc_recon/PO-402'];
    s.ok('relocked: cutLock = the PO\'s recorded cut 20/38/40/20 (source relock, by afnan), total 118',r.ok&&J(RC.cutLock.sizes)===J({S:20,M:38,L:40,XL:20})&&RC.cutLock.total===118&&RC.cutLock.source==='relock'&&RC.cutLock.lockedBy==='afnan');
    s.ok('… one relock overrides row with before / after, and the cause written at the start of its reason',RC.overrides.length===1&&RC.overrides[0].kind==='relock'&&J(RC.overrides[0].before)===J({S:20,M:40,L:40,XL:20})&&J(RC.overrides[0].after)===J({S:20,M:38,L:40,XL:20})&&RC.overrides[0].reason==='Cause: Cutting miscount. M recounted at the cutting table');
    s.ok('… a qc_cut_relocked history row and bell rows to ammar and mustafa',hist({store:fkB.store},'PO-402','qc_cut_relocked').length===1&&J(bells({store:fkB.store}).map(b=>b.forUser).sort())===J(['ammar','mustafa']));
    s.ok('… the lots are byte-for-byte as saved (a relock never touches a lot)',J(lotDocs({store:fkB.store},'PO-402'))===J(lotsB));
    s.ok('… the PO now reads EXACT; the success line says so with the stamp and who was told',/●exact/.test(A.text(A.detail()))&&A.text(A.id('phaf-flash'))==='The cut snapshot of PO-402 was replaced — Wed 14 Oct 2026, 9:05 AM by Afnan. The locked cut is now S 20 · M 38 · L 40 · XL 20 (118 pcs); PO-402 is now exact: 118 of 118. It can be closed. Ammar, Mustafa were told.');
    s.ok('… the drift is gone, so is the Replace button; a plain Close PO is offered',!A.id('phaf-relock-btn')&&!!A.id('phaf-close-btn')&&/Close PO/.test(A.text(A.id('phaf-close-btn')))&&!/Close with a shortfall/.test(A.text(A.id('phaf-close-btn'))));
    s.ok('… the overrides list: "Cut snapshot replaced · … by Afnan", "Cut S 20 · M 40 · L 40 · XL 20 → S 20 · M 38 · L 40 · XL 20"',/Cut snapshot replaced · Wed 14 Oct 2026, 9:05 AM by Afnan/.test(A.text(A.id('phaf-ovs')))&&/Cut S 20 · M 40 · L 40 · XL 20 → S 20 · M 38 · L 40 · XL 20/.test(A.text(A.id('phaf-ovs'))));
    const A2=mk('afnan',{fk:makeFake(shortSeed('PO-409'))});await A2.show();await A2.open('PO-409');
    s.ok('an owner on a PO whose recorded cut EQUALS the lock: no Replace button (nothing to replace)',!A2.id('phaf-relock-btn')&&A2.R('phqcRelockAsk("PO-409")')===false);
  }

  /* ── 4. adopt the old Packing receipts ─────────────────────────────────────────────── */
  s.section('adopt legacy: shown only while old receipts are not adopted; one lot src legacy; the button disappears; a second press is stale');
  CLK.now=WED_905;
  const legacySeed=()=>({'pos/PO-404':cutPo('PO-404','qc',{packingReceipts:[{id:'RCV-1-S',receiptId:'RCV-1',size:'S',qty:5,by:'Faizan',ts:'2026-10-11T05:00:00.000Z'},{id:'RCV-1-M',receiptId:'RCV-1',size:'M',qty:10,by:'Faizan',ts:'2026-10-11T05:00:00.000Z'}]})});
  const fkC=makeFake(legacySeed());
  {
    const F=mk('faizan',{fk:fkC});await F.show();await F.open('PO-404');
    s.ok('Faizan: no Adopt control; phqcAdoptAsk refuses; the writer refuses (forbidden)',!F.id('phaf-adopt-btn')&&F.R('phqcAdoptAsk("PO-404")')===false&&(await F.R('phQcAdoptLegacy("PO-404",{expectedRev:0,reason:"before QC Ops"})')).code==='forbidden');
    const A=mk('afnan',{fk:fkC});await A.show();await A.open('PO-404');   // a second manager's screen, opened BEFORE the adoption
    const M2=mk('mustafa',{fk:fkC});await M2.show();await M2.open('PO-404');
    s.ok('Mustafa: "Adopt old receipts as lot #1" (old receipts exist, none adopted)',!!M2.id('phaf-adopt-btn')&&/Adopt old receipts as lot #1/.test(M2.text(M2.id('phaf-adopt-btn'))));
    await M2.click('phaf-adopt-btn');
    const d=dlg(M2);
    const rows=M2.all(n=>n.tagName==='TR'&&n.parentNode&&n.parentNode.tagName==='TBODY'&&(function(x){for(let p=x;p;p=p.parentNode)if(p===d)return true;return false;})(n)).map(r=>r.children.map(c=>c.textContent).join('|'));
    s.eq('the dialog shows what will be adopted, per size',J(rows),J(['S|5','M|10','Total|15']));
    s.ok('… from 2 old receipts, as lot #1, that it also locks the cut, and that it is PERMANENT',/Adopt the 15 units received through the old Packing page on PO-404 as lot #1/.test(M2.text(d))&&/From 2 old receipts/.test(M2.text(d))&&/it also locks the cut as final \(S 20 · M 40 · L 40 · XL 20\)/.test(M2.text(d))&&/This is permanent/.test(M2.text(d)));
    await A.click('phaf-adopt-btn');fill(A,{reason:'received before QC Ops existed'});await go(A);   // Afnan's screen waits at step 2
    fill(M2,{reason:'received before QC Ops existed'});await go(M2);
    const tx0=fkC.log.tx;
    const r=await go(M2);
    const L=Object.keys(fkC.store).filter(k=>k.indexOf('po_qc_lots/PO-404-')===0).map(k=>fkC.store[k]);
    s.ok('adopted: ONE lot, src legacy, seq 1, S 5 + M 10, by mustafa',r.ok&&fkC.log.tx===tx0+1&&L.length===1&&L[0].src==='legacy'&&L[0].seq===1&&J(L[0].sizes)===J({S:5,M:10})&&L[0].by==='mustafa');
    s.ok('… the reconciliation is created (cut locked) with the two receipt ids adopted; a qc_legacy_adopted history row',J(fkC.store['po_qc_recon/PO-404'].legacyIds)===J(['RCV-1-S','RCV-1-M'])&&hist({store:fkC.store},'PO-404','qc_legacy_adopted').length===1);
    s.ok('… pos.packingReceipts is NOT changed (the units are already there; nothing is mirrored)',J(fkC.store['pos/PO-404'].packingReceipts)===J(legacySeed()['pos/PO-404'].packingReceipts));
    s.ok('… the button is gone; the note says the units were adopted; the success line names lot #1 and the stamp',!M2.id('phaf-adopt-btn')&&/15 units from the old Packing page were adopted/.test(M2.text(M2.detail()))&&/^15 units from the old Packing page are now lot #1 — Wed 14 Oct 2026, 9:05 AM by Mustafa\./.test(M2.text(M2.id('phaf-flash'))));
    s.ok('… and the lot is listed "from the old Packing page"',/Lot #1 · Wed 14 Oct 2026, 9:05 AM by Mustafa/.test(M2.text(M2.detail()))&&M2.cls('phaf-lot-tag').length===1);
    const ra=await go(A);
    s.ok('a second press from the screen opened before (Afnan, step 2): STALE, nothing written, the latest copy read again',ra.ok===false&&ra.code==='stale'&&Object.keys(fkC.store).filter(k=>k.indexOf('po_qc_lots/PO-404-')===0).length===1&&fkC.log.writes.filter(w=>w.tx>tx0+1).length===0);
    s.ok('… Afnan sees "Someone else changed the reconciliation …", the dialog closed, and the Adopt button gone after the reload',/Someone else changed the reconciliation of PO-404 just now/.test(A.text(A.id('phaf-flash')))&&!dlg(A)&&!A.id('phaf-adopt-btn'));
    s.ok('… the writer refuses a further adoption (nothing left to adopt)',(await A.R('phQcAdoptLegacy("PO-404",{expectedRev:1,reason:"again again"})')).code==='refused');
  }

  /* ── 5. every override dialog: double press, offline, stale revision ───────────────── */
  s.section('every dialog: a double press writes once, offline is refused out loud, a stale revision reloads the latest copy');
  const cases=[
    {kind:'short',user:'ammar',seed:()=>shortSeed('PO-411'),po:'PO-411',btn:'phaf-close-btn',fill:{cause:'damaged_before_qc',reason:'two damaged before QC'},ok:fk=>fk.store['po_qc_recon/PO-411'].status==='closed'},
    {kind:'relock',user:'ammar',seed:()=>shortSeed('PO-412',{po:{cutQty:{S:20,M:38,L:40,XL:20}}}),po:'PO-412',btn:'phaf-relock-btn',fill:{cause:'cutting_miscount',reason:'M recounted at cutting'},ok:fk=>fk.store['po_qc_recon/PO-412'].cutLock.source==='relock'},
    {kind:'reopen',user:'ammar',seed:()=>shortSeed('PO-413',{po:{currentStage:'completed'},recon:{status:'closed',closedAt:WED_905-HOUR,closedBy:'faizan',closedByName:'Faizan',rev:3}}),po:'PO-413',btn:'phaf-reopen-btn',closed:true,fill:{reason:'one carton found'},ok:fk=>fk.store['po_qc_recon/PO-413'].status==='reopened'},
    {kind:'adopt',user:'mustafa',seed:()=>{const x=shortSeed('PO-414',{po:{packingReceipts:[{id:'RCV-9-M',size:'M',qty:2,by:'Faizan'}]}});return x;},po:'PO-414',btn:'phaf-adopt-btn',fill:{reason:'old receipt from before'},ok:fk=>Object.keys(fk.store).filter(k=>k.indexOf('po_qc_lots/PO-414-')===0).length===3}
  ];
  for(const c of cases){
    CLK.now=WED_905;
    const fk=makeFake(c.seed());
    const T=mk(c.user,{fk});await T.show();
    if(c.closed){const tg=T.cls('phaf-gtog')[0];if(tg)T.dom.click(tg);await settle(20);}
    await toStep2(T,c.po,c.btn,c.fill);
    s.ok(c.kind+': step 2 reached, nothing written',/Step 2 of 2/.test(T.text(dlg(T)))&&fk.log.tx===0&&fk.log.writes.length===0);
    T.R('navigator.onLine=false');
    const ro=await go(T);
    s.ok(c.kind+': offline refused IN the dialog ("No connection"), no transaction',ro.code==='offline'&&/No connection/.test(T.text(T.id('phaf-dlg-msg')))&&fk.log.tx===0&&!!dlg(T));
    T.R('navigator.onLine=true');
    // stale: another device moves the revision; this screen still confirms the revision it showed
    const before=fk.store['po_qc_recon/'+c.po].rev;
    fk.store['po_qc_recon/'+c.po].rev=before+1;
    const rs=await go(T);
    s.ok(c.kind+': a stale revision is refused, nothing written, the dialog closes with "Someone else changed …"',rs.code==='stale'&&fk.log.writes.length===0&&!dlg(T)&&/Someone else changed the reconciliation of /.test(T.text(T.id('phaf-flash'))));
    s.ok(c.kind+': … and the latest copy was read again (the reconciliation and the lots re-read)',fk.log.queries.filter(q=>q.path==='po_qc_recon').length>=2&&fk.log.queries.filter(q=>q.path==='po_qc_lots'&&!(q.wheres||[]).length).length>=2);
    // again, on the fresh copy: a double press writes once
    await T.click(c.btn);fill(T,c.fill);await go(T);
    const tx0=fk.log.tx;
    const p1=T.R('phqcDlgGo()'),p2=T.R('phqcDlgGo()');
    const d1=await p1,d2=await p2;await settle(60);
    s.ok(c.kind+': a double press writes ONCE (one transaction, the second press "busy")',d1&&d1.ok===true&&d2.code==='busy'&&fk.log.tx===tx0+1&&c.ok(fk));
    s.ok(c.kind+': … success feedback carries a 12-hour PKT stamp and the person\'s name',/Wed 14 Oct 2026, 9:05 AM by (Ammar|Mustafa)/.test(T.text(T.id('phaf-flash'))));
  }

  /* ── 6. focus, the trap, who gets which control, hostile strings ───────────────────── */
  s.section('focus in / trapped in / back to the opener; Kashif and others get nothing; hostile reasons are text');
  {
    CLK.now=WED_905;
    const fk=makeFake(shortSeed('PO-421'));
    const T=mk('afnan',{fk});await T.show();await T.open('PO-421');
    await T.click('phaf-close-btn');
    const d=dlg(T);
    const cause=T.id('phaf-dlg-cause'),no=T.id('phaf-dlg-no');
    no.focus();T.dom.dispatch(d,'keydown',{key:'Tab',target:no});
    s.ok('Tab from the last control goes to the first (the cause box): focus stays inside the dialog',T.ctx.document.activeElement===cause);
    cause.focus();T.dom.dispatch(d,'keydown',{key:'Tab',shiftKey:true,target:cause});
    s.ok('Shift+Tab from the first goes to the last ("Not yet")',T.ctx.document.activeElement===no);
    await T.click('phaf-dlg-no');
    s.ok('"Not yet" closes it and focus goes back to the opener',!dlg(T)&&T.ctx.document.activeElement===T.id('phaf-close-btn'));
    // the Escape guard of the shell (phAddEscapeGuard): the dialog closes before the detail
    await T.click('phaf-close-btn');
    T.R('PH_ESCAPE_GUARDS.some(function(g){return g();})');await settle(20);
    s.ok('the shell\'s Escape (phAddEscapeGuard) closes the dialog first, the detail stays open',!dlg(T)&&!!T.detail());
    for(const u of ['uzaib','raees']){
      const W=mk(u,{fk});
      s.ok(u+': no Afloat POs tab, and every override ask refuses',W.R('JSON.stringify(phTabsFor().map(t=>t.id))').indexOf('afloat')<0&&['phqcShortAsk','phqcRelockAsk','phqcReopenAsk','phqcAdoptAsk'].every(f=>W.R(f+'("PO-421")')===false));
    }
    const fkH=makeFake(Object.assign(shortSeed('PO-422',{po:{currentStage:'completed'},recon:{status:'closed',closedAt:WED_905-HOUR,closedBy:'mustafa',closedByName:'Mustafa',rev:3,
      overrides:[{kind:'close_short',at:WED_905-HOUR,by:'mustafa',byName:HOSTILE,reason:HOSTILE,cause:'other'}]}})));
    const H=mk('faizan',{fk:fkH});await H.show();const tg=H.cls('phaf-gtog')[0];if(tg)H.dom.click(tg);await settle(20);await H.open('PO-422');
    s.ok('a hostile name and reason in an override reach the page as TEXT (no element made from them)',H.text(H.id('phaf-ovs')).indexOf(HOSTILE)>-1&&H.all(n=>n.tagName==='IMG'&&n.getAttribute('src')==='x').length===0&&H.all(n=>typeof n.innerHTML==='string'&&n.innerHTML.indexOf('onerror')>-1).length===0);
  }

  /* ── 7. source rules ───────────────────────────────────────────────────────────────── */
  s.section('source: the module writes only through the QC writers; the dialogs carry no edit path');
  {
    const strip=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    const code=strip(SRC);
    s.ok('the override writers are called behind typeof (phQcClose / phQcRelock / phQcReopen / phQcAdoptLegacy)',/typeof phQcRelock==='function'/.test(code)&&/typeof phQcReopen==='function'/.test(code)&&/typeof phQcAdoptLegacy==='function'/.test(code)&&/typeof phQcClose==='function'/.test(code));
    s.ok('no Firestore write API in the module',!/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(|\btx\.(set|update|delete)\s*\(/.test(code));
    s.ok('the relock dialog types no cut (phQcRelock is called with expectedRev and reason only)',/phQcRelock\(t\.id,\{expectedRev:rev,reason:/.test(code)&&!/phQcRelock\([^)]*sizes/.test(code));
    const I=read('js/ph-i18n.js');
    const keys=[...new Set([...SRC.matchAll(/'(afloat\.(?:ov|gap|cause|ok_short|ok_relock|ok_reopen|ok_adopt|a_reopen|a_relock|a_adopt|why_ov|why_relock|band_closed_short|legacy_adopted|now_awaiting)[a-z_]*)'/g)].map(m=>m[1]))].filter(k=>!/_$/.test(k))
      .concat(['afloat.cause_cutting_miscount','afloat.cause_lost_in_line','afloat.cause_damaged_before_qc','afloat.cause_other','afloat.ov_row_close_short','afloat.ov_row_relock','afloat.ov_row_reopen','afloat.ov_row_other']);
    const T=mk('afnan');
    s.ok('every QC7 string has English + Urdu and is marked review:true ('+keys.length+' keys)',keys.length>=60&&keys.every(k=>T.R('phI18nHas('+J(k)+')')===true&&T.R('PH_I18N_STR['+J(k)+'].review')===true&&T.R('PH_I18N_STR['+J(k)+'].ur.length>0'))&&/QC7 \(15 Oct 2026\): the manager overrides/.test(I));
    const CSS=read('css/main.css');
    const blk=(()=>{const a=CSS.indexOf('/* ph-mod-afloat START */'),b=CSS.indexOf('/* ph-mod-afloat END */');return a>0&&b>a?CSS.slice(a,b):'';})();
    s.ok('the QC7 styles sit INSIDE the ph-mod-afloat block, tokens only',/\.phaf-dlg-ov\{/.test(blk)&&/\.phaf-ovlist\{/.test(blk)&&CSS.split('.phaf-dlg-ov{').length===blk.split('.phaf-dlg-ov{').length&&CSS.split('.phaf-ov{').length===blk.split('.phaf-ov{').length&&!/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(blk.replace(/\/\*[\s\S]*?\*\//g,'')));
    const IX=read('index.html'),SW=read('sw.js');
    s.ok('sw.js CACHE_VERSION is v342 or later (QC6 was v341)',+(/CACHE_VERSION = 'v(\d+)'/.exec(SW)||[0,0])[1]>=342);
    for(const [f,tag] of [['css/main.css','20261018wpfm346c'],['js/ph-i18n.js','20261018wpfm346i'],['js/ph-mod-afloat.js','20261018qw2a']])   // QC wave 2 moved the two js tags on
      s.ok(f+' is loaded with ?v='+tag+' (a tag no other file uses)',IX.indexOf('/'+f+'?v='+tag+'"')>-1&&IX.split('?v='+tag+'"').length===2);
  }

  /* ── 8. the reverts ────────────────────────────────────────────────────────────────── */
  s.section('reverts: each guard undone once fails its named assertion');
  const brk=async(label,expect,fn)=>{let r;try{r=await fn();}catch(e){r='threw: '+e.message;}if(r!==false&&process.env.PHQC7_DEBUG)console.log('  [brk]',label,'->',r);s.ok((CONTROL?'control (unbroken) "':'break "')+label+'" '+(CONTROL?'passes':'fails')+' "'+expect+'"',CONTROL?r===true:r===false);};
  const shortAt=async(user,o)=>{CLK.now=WED_905;const fk=makeFake(shortSeed('PO-431',o&&o.seedOpts));const T=mk(user,Object.assign({fk},o||{}));await T.show();
    if(o&&o.closed){const tg=T.cls('phaf-gtog')[0];if(tg)T.dom.click(tg);await settle(20);}
    await T.open('PO-431');return T;};
  await brk('Faizan allowed the close-short ask','… phqcShortAsk refuses him (no dialog)',async()=>{const T=await shortAt('faizan',{src:mut(SRC,"  return phqcIsManager(u)&&!!t&&t.reconOk&&t.lotsOk&&!!t.rec&&t.rec.ok&&(t.rec.phase==='receiving'","  return(phqcIsManager(u)||phqcIsQc(u))&&!!t&&t.reconOk&&t.lotsOk&&!!t.rec&&t.rec.ok&&(t.rec.phase==='receiving'")});return T.R('phqcShortAsk("PO-431")')===false;});
  await brk('the cause check dropped','no cause: refused with a visible message, still step 1, nothing written',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"  if((d.kind==='short'||d.kind==='relock')&&_phqcCauses().indexOf(d.cause)<0)return phI18nD('afloat.ov_cause_missing');\n","")});await T.click('phaf-close-btn');fill(T,{reason:'two pieces lost'});const r=await go(T);return r.code==='invalid'&&/Step 1 of 2/.test(T.text(dlg(T)));});
  await brk('the reason minimum dropped','a reason under 5 characters: refused with a visible message, still step 1',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"  if(_phqcStr(d.reason).trim().length<_phqcReasonMin())return phI18nD('afloat.ov_reason_short',{n:_phqcReasonMin()});\n","")});await T.click('phaf-close-btn');fill(T,{cause:'other',reason:'abc'});const r=await go(T);return r.code==='invalid'&&!!T.id('phaf-dlg-reason');});
  await brk('step 2 skipped (Continue writes at once)','Continue: step 2 of 2 reads back the cause and the reason; NOTHING written yet',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"  if(d.step!=='confirm'){\n    d.step='confirm';","  if(false){\n    d.step='confirm';")});spy(T,'phQcClose');await T.click('phaf-close-btn');fill(T,{cause:'other',reason:'two pieces lost'});await go(T);return calls(T)===0&&T.log.tx===0;});
  await brk('the offline check removed (module and writer)','offline: refused out loud IN the dialog, still step 2, no transaction',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"  if(_phqcOffline()){d.msg=phI18nD('afloat.ov_offline');","  if(false){d.msg=phI18nD('afloat.ov_offline');"),qcw:mut(QCW,"  if(_phOffline())return _phFail('offline','No connection. Closing a PO","  if(false)return _phFail('offline','No connection. Closing a PO")});await toStep2(T,'PO-431','phaf-close-btn',{cause:'other',reason:'two pieces lost'});T.R('navigator.onLine=false');await go(T);T.R('navigator.onLine=true');return T.log.tx===0;});
  await brk('the double-press guard removed','a double press closes ONCE (the second press is "busy"; one transaction)',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"  const d=_phqcDlg;if(!d||PHAF_OV_KINDS.indexOf(d.kind)<0)return{ok:false,code:'no-dialog'};\n  if(_phqcBusy)return{ok:false,code:'busy'};","  const d=_phqcDlg;if(!d||PHAF_OV_KINDS.indexOf(d.kind)<0)return{ok:false,code:'no-dialog'};")});await toStep2(T,'PO-431','phaf-close-btn',{cause:'other',reason:'two pieces lost'});const p1=T.R('phqcDlgGo()'),p2=T.R('phqcDlgGo()');await p1;await p2;await settle(60);return T.log.tx===1;});
  await brk('the stale refusal printed in place (no reload)','short: a stale revision is refused, nothing written, the dialog closes with "Someone else changed …"',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"  if(res&&res.code==='stale'){\n    await _phqcReloadQc(t.id);\n    _phqcDlg=null;\n    _phqcFlash={poId:t.id,tone:'warn',text:phI18nD('afloat.dl_stale',{po:t.id})};\n    _phqcFocusId='phaf-flash';\n  }else if(_phqcDlg===d){d.msg=_phqcResMsg(res);_phqcFocusId='phaf-dlg-msg';}\n  _phqcPaint();\n  return res||{ok:false,code:'failed'};\n}\n// The overrides recorded","  if(_phqcDlg===d){d.msg=_phqcResMsg(res);_phqcFocusId='phaf-dlg-msg';}\n  _phqcPaint();\n  return res||{ok:false,code:'failed'};\n}\n// The overrides recorded")});await toStep2(T,'PO-431','phaf-close-btn',{cause:'other',reason:'two pieces lost'});T.store['po_qc_recon/PO-431'].rev++;await go(T);return !dlg(T)&&/Someone else changed/.test(T.text(T.id('phaf-flash')));});
  await brk('the confirmed revision not sent (the fresh tile\'s revision instead)','short: a stale revision is refused, nothing written …',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"  const why=_phqcStr(d.reason).trim(),rev=typeof d.rev==='number'?d.rev:0;","  const why=_phqcStr(d.reason).trim();await _phqcReloadQc(t.id);const ft=_phqcFindTile(d.poId);const rev=ft&&ft.recon?ft.recon.rev:0;")});await toStep2(T,'PO-431','phaf-close-btn',{cause:'other',reason:'two pieces lost'});T.store['po_qc_recon/PO-431'].rev++;await go(T);return T.log.writes.length===0;});
  await brk('the relock opened to managers','… phqcRelockAsk refuses him and the writer refuses him (forbidden)',async()=>{const T=await shortAt('mustafa',{seedOpts:{po:{cutQty:{S:20,M:38,L:40,XL:20}}},src:mut(SRC,"  return phqcIsOwner(u)&&!!t&&t.reconOk&&t.lotsOk&&!!t.rec&&t.rec.ok&&_phqcOpenRecon(t.recon)","  return phqcIsManager(u)&&!!t&&t.reconOk&&t.lotsOk&&!!t.rec&&t.rec.ok&&_phqcOpenRecon(t.recon)")});return T.R('phqcRelockAsk("PO-431")')===false;});
  await brk('the relock "after" judged against the old lock','… the effect on the verdict BEFORE confirming: now SHORT, after the replacement EXACT 118 of 118',async()=>{const T=await shortAt('afnan',{seedOpts:{po:{cutQty:{S:20,M:38,L:40,XL:20}}},src:mut(SRC,"phQcVerdict(live.sizes,recv,{model:model})","phQcVerdict(lock.sizes,recv,{model:model})")});await T.click('phaf-relock-btn');return /is now exact: 118 of 118/.test(T.text(T.id('phaf-ov-after')));});
  await brk('the relock cause not written into the reason','… one relock overrides row with before / after, and the cause written at the start of its reason',async()=>{const T=await shortAt('afnan',{seedOpts:{po:{cutQty:{S:20,M:38,L:40,XL:20}}},src:mut(SRC,"reason:phI18nT('afloat.ov_relock_reason',{cause:phI18nT('afloat.cause_'+d.cause,null,'en'),why:why},'en')","reason:why")});await toStep2(T,'PO-431','phaf-relock-btn',{cause:'cutting_miscount',reason:'M recounted at the cutting table'});await go(T);return /^Cause: Cutting miscount\. /.test(T.store['po_qc_recon/PO-431'].overrides[0].reason);});
  await brk('the reopen opened to managers','Mustafa (not an owner) gets no Reopen control on the closed PO',async()=>{const T=await shortAt('mustafa',{closed:true,seedOpts:{po:{currentStage:'completed'},recon:{status:'closed',closedAt:WED_905-HOUR,closedBy:'faizan',closedByName:'Faizan',rev:3}},src:mut(SRC,"function phqcCanReopen(t,u){return phqcIsOwner(u)","function phqcCanReopen(t,u){return phqcIsManager(u)")}).catch(()=>null);if(!T)return 'no tile';return T.R('phqcReopenAsk("PO-431")')===false;});
  await brk('the adopt button kept after adoption','… the button is gone; the note says the units were adopted …',async()=>{CLK.now=WED_905;const fk=makeFake(legacySeed());const T=mk('mustafa',{fk,src:mut(SRC,"  return phqcLegacyPlan(t.po,t.recon).ids.length>0;\n}","  return true;\n}")});await T.show();await T.open('PO-404');await T.click('phaf-adopt-btn');fill(T,{reason:'received before QC Ops existed'});await go(T);const r=await go(T);return r.ok===true&&!T.id('phaf-adopt-btn');});
  await brk('the legacy plan ignoring what was adopted','… the button is gone; the note says the units were adopted …',async()=>{CLK.now=WED_905;const fk=makeFake(legacySeed());const T=mk('mustafa',{fk,src:mut(SRC,"    if(done.indexOf(id)>-1){if(q!==null&&q>0)adopted+=q;return;}\n","")});await T.show();await T.open('PO-404');await T.click('phaf-adopt-btn');fill(T,{reason:'received before QC Ops existed'});await go(T);await go(T);return !T.id('phaf-adopt-btn')&&/15 units from the old Packing page were adopted/.test(T.text(T.detail()));});
  await brk('the focus trap removed','Tab from the last control goes to the first (the cause box): focus stays inside the dialog',async()=>{const T=await shortAt('afnan',{src:mut(SRC,"phqcDlgClose();return;}_phqcTrap(box,e);});\n  back.appendChild(box);\n  back.addEventListener('click',function(e){if(e&&e.target===back)phqcDlgClose();});\n  return back;\n}\n// The override dialog's","phqcDlgClose();return;}});\n  back.appendChild(box);\n  back.addEventListener('click',function(e){if(e&&e.target===back)phqcDlgClose();});\n  return back;\n}\n// The override dialog's")});await T.click('phaf-close-btn');const no=T.id('phaf-dlg-no');no.focus();T.dom.dispatch(dlg(T),'keydown',{key:'Tab',target:no});return T.ctx.document.activeElement===T.id('phaf-dlg-cause');});
  await brk('focus not moved into the dialog','… focus is in the dialog (the cause box)',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"return _phqcOvOpen('short',t,opener||'phaf-close-btn','phaf-dlg-cause');","return _phqcOvOpen('short',t,opener||'phaf-close-btn','');")});await T.click('phaf-close-btn');return T.ctx.document.activeElement===T.id('phaf-dlg-cause');});
  await brk('the overrides list dropped from the detail','Faizan sees the SAME overrides list and the band …',async()=>{const T=await shortAt('faizan',{closed:true,seedOpts:{po:{currentStage:'completed'},recon:{status:'closed',closedAt:WED_905-HOUR,closedBy:'mustafa',closedByName:'Mustafa',rev:3,overrides:[{kind:'close_short',at:WED_905-HOUR,by:'mustafa',byName:'Mustafa',reason:'lost',cause:'lost_in_line'}]}},src:mut(SRC,"  const ovs=_phqcOverridesNode(t);if(ovs)wrap.appendChild(ovs);","")}).catch(()=>null);
    if(!T)return 'no tile';return !!T.id('phaf-ovs');});
  await brk('an override reason written as HTML','a hostile name and reason in an override reach the page as TEXT',async()=>{CLK.now=WED_905;const fk=makeFake(shortSeed('PO-422',{po:{currentStage:'completed'},recon:{status:'closed',closedAt:WED_905-HOUR,closedBy:'mustafa',closedByName:'Mustafa',rev:3,overrides:[{kind:'close_short',at:WED_905-HOUR,by:'mustafa',byName:'M',reason:HOSTILE,cause:'other'}]}}));const T=mk('faizan',{fk,src:mut(SRC,"if(o.reason){const rr=phEl('span','phaf-ov-r');rr.textContent=","if(o.reason){const rr=phEl('span','phaf-ov-r');rr.innerHTML=")});await T.show();const tg=T.cls('phaf-gtog')[0];if(tg)T.dom.click(tg);await settle(20);await T.open('PO-422');return T.all(n=>typeof n.innerHTML==='string'&&n.innerHTML.indexOf('onerror')>-1).length===0;});
  await brk('the gap words signed (−2 short)','… the shortfall it accepts, per size, in plain words (and the total)',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"    out.push(phI18nD(key,{size:k,n:Math.abs(s.diff),","    out.push(phI18nD(key,{size:k,n:s.diff,")});await T.click('phaf-close-btn');return T.cls('phaf-ov-gap',dlg(T)).map(n=>T.text(n))[0]==='M: 2 short — 38 of 40 received (allowance 1)';});
  await brk('the close-short cause not sent','the reconciliation is closed by mustafa with ONE close_short overrides row …',async()=>{const T=await shortAt('mustafa',{src:mut(SRC,"res=await phQcClose(t.id,{expectedRev:rev,reason:why,cause:d.cause});","res=await phQcClose(t.id,{expectedRev:rev,reason:why});")});await toStep2(T,'PO-431','phaf-close-btn',{cause:'lost_in_line',reason:'two pieces lost'});await go(T);const R=T.store['po_qc_recon/PO-431'];return R.status==='closed'&&R.overrides[0].cause==='lost_in_line';});
  await brk('the close-short told the floor too (the button for Faizan)','Faizan on the short PO: no "Close with a shortfall…" control of any kind …',async()=>{const T=await shortAt('faizan',{src:mut(SRC,"      if(mgr){\n        if(phqcCanCloseShort(t,ctx.user))","      if(mgr||qc){\n        if(phqcCanCloseShort(t,ctx.user))")});return T.all(n=>/Close with a shortfall/.test(n.textContent||'')&&n.tagName==='BUTTON').length===0;});
  return s;
};

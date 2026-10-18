/* QC wave 2 (18 Oct 2026): the fixes after wave 1, each with a hand-computed fixture and a deliberate revert.
   1. js/ph-mod-afloat.js walked `n.children` with `.forEach`. In a real browser `children` is an HTMLCollection, which has NO forEach,
      so the arrow keys between tiles threw and Back never returned focus. Driven here with HTMLCollection-like objects (a length and
      indexed slots, no array methods) — tests/ph-dom.js uses real arrays, which is why the suites never saw it.
   2. The classic Complete QC (js/pos.js) still FAILS OPEN when po_qc_recon is refused (the rules not published), but now LOUDLY: a red
      toast and the confirm text name po_qc_recon and the republish, an Activity row "QC check skipped" is written, and the final toast
      says the check was skipped. Any other failure still refuses; a readable PO is unchanged (no warning).
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

  return s;
};

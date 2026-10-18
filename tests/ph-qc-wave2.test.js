/* QC wave 2 (18 Oct 2026): the fixes after wave 1, each with a hand-computed fixture and a deliberate revert.
   1. js/ph-mod-afloat.js walked `n.children` with `.forEach`. In a real browser `children` is an HTMLCollection, which has NO forEach,
      so the arrow keys between tiles threw and Back never returned focus. Driven here with HTMLCollection-like objects (a length and
      indexed slots, no array methods) — tests/ph-dom.js uses real arrays, which is why the suites never saw it.
   What it does NOT prove: a real browser's HTMLCollection (only an object of the same shape), a real phone. */
'use strict';
const fs=require('fs'),path=require('path');
const {suite}=require('./harness');
const kit=require('./ph-mod-afloat.test.js').kit;
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

  return s;
};

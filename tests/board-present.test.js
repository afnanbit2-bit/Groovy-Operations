/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — a formatted note keeps its structure on a slide (#97 bug 3).
   Present drew c.text, the note with its lines and lists stripped, so a
   note read "test- bullet one1. numbered…" on one line.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-present');
  const app=loadApp({files:['js/boards.js']});
  const {run}=app;
  const stage=app.el('board-present-stage');
  const paint=card=>{
    stage.children.length=0;stage.childNodes.length=0;
    run(`_boardsPresentList=[${JSON.stringify(card)}];_boardsPresentIdx=0;_boardsPresentPaint();`);
    return stage.children.find(n=>/\bbp-body\b/.test(n.className||''));
  };
  const RICH='<div>test</div><ul><li>bullet one</li></ul><ol><li>numbered</li></ol><img src=x onerror="alert(1)">';

  s.section('a formatted note');
  const b=paint({id:'n1',type:'text',text:'test bullet one numbered',rich:RICH});
  s.ok('renders as rich markup',b&&/\brich\b/.test(b.className));
  s.eq('through the same sanitiser the canvas uses',b&&b.innerHTML,run(`_boardsSanitizeRich(${JSON.stringify(RICH)})`));
  // What the sanitiser strips is checked in a real browser, not here — the
  // harness DOMParser is a tag-soup stub (see tests/harness.js).
  s.ok('and not the flattened text',b&&b.textContent==='');

  s.section('a plain note');
  const p=paint({id:'n2',type:'text',text:'  just words  '});
  s.ok('is text, not markup',p&&!/\brich\b/.test(p.className)&&p.innerHTML==='');
  s.eq('trimmed as before',p&&p.textContent,'just words');

  s.section('only a note carries markup');
  const o=paint({id:'x',type:'mystery',text:'t',rich:'<b>x</b>'});
  s.ok('an unknown type with a stray rich field is still drawn as text',o&&o.textContent==='t'&&o.innerHTML==='');
  return s;
};

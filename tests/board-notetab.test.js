/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — Tab in a note stays in the note (GitHub #97, bug 1).
   The browser used to move focus to the next control, so what was typed
   after Tab landed elsewhere or fired a board shortcut.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-notetab');
  const app=loadApp({files:['js/boards.js']});
  const {run,state}=app;
  run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};currentPage='board-canvas';
    _editBoard={id:'B',ownerUid:'u1',visibility:'personal'};_editCards=[];_editConnectors=[];`);
  const note=app.el('board-txt-n1');
  note.isContentEditable=true;
  const press=(shift,sel)=>{
    state.execCommands.length=0;
    run(`window.getSelection=()=>(${sel||'{anchorNode:null}'});`);
    return JSON.parse(run(`(function(){let p=false;const e={key:'Tab',shiftKey:${!!shift},preventDefault(){p=true;}};
      _boardsOnKeydown(e);return JSON.stringify({p,cmds:document.execCommands||null});})()`));
  };
  const cmds=()=>state.execCommands.map(c=>c[0]+(c[2]!=null&&c[0]==='insertText'?':'+JSON.stringify(c[2]):'')).join(',');

  s.section('not editing');
  run(`_boardsEditingEl=null`);
  s.eq('Tab is left to the browser',press(false).p,false);

  s.section('editing a note, caret in plain text');
  run(`_boardsEditingEl=document.getElementById('board-txt-n1')`);
  s.eq('Tab is kept in the note',press(false).p,true);
  s.eq('and indents with four no-break spaces',cmds(),'insertText:'+JSON.stringify('    '));
  s.eq('Shift+Tab is kept in the note too',press(true).p,true);
  s.eq('and inserts nothing',cmds(),'');

  s.section('caret in a list item');
  const inLi=`{anchorNode:{nodeType:3,parentNode:{nodeType:1,tagName:'LI',parentNode:document.getElementById('board-txt-n1')}}}`;
  press(false,inLi);
  s.eq('Tab nests the item',cmds(),'styleWithCSS,indent');
  press(true,inLi);
  s.eq('Shift+Tab un-nests it',cmds(),'styleWithCSS,outdent');

  s.section('a heading');
  note.classList.add('board-heading-body');
  s.eq('Tab stays in the heading',press(false,inLi).p,true);
  s.eq('and changes nothing',cmds(),'');
  note.classList.remove('board-heading-body');

  s.section('not a note');
  const todo=app.el('board-todo-t1-0');todo.isContentEditable=true;
  run(`_boardsEditingEl=document.getElementById('board-todo-t1-0')`);
  s.eq('a to-do item keeps its own Tab handler',press(false).p,false);
  run(`_boardsEditingEl=document.getElementById('board-txt-n1')`);
  s.eq('Ctrl+Tab is never taken',JSON.parse(run(`(function(){let p=false;_boardsOnKeydown({key:'Tab',ctrlKey:true,preventDefault(){p=true;}});return JSON.stringify(p);})()`)),false);

  // GitHub #97, bug 6. MEASURED in real Chromium: with the full-width strip
  // the first line and the placeholder sat under it; with the corner chip
  // and the first-line float, no text rect meets the chip. The probe cannot
  // hover, so the two rules are held here.
  s.section('the hover strip does not cover a note');
  const css=require('fs').readFileSync(require('path').join(__dirname,'..','css','main.css'),'utf8');
  const chip=(css.match(/\.board-card-el\.type-text>\.board-card-head\{[^}]*\}/)||[''])[0];
  s.ok('a note wears a corner chip, not a full-width strip',/left:auto/.test(chip)&&/right:\d+px/.test(chip),chip);
  s.ok('the type word is not in it',/\.board-card-el\.type-text>\.board-card-head \.board-card-kind\{display:none\}/.test(css));
  s.ok('the first line keeps room for the chip, at rest as well as on hover',
    /\.board-text-body:not\(:empty\)::before\{content:'';float:right;width:\d+px/.test(css));
  return s;
};

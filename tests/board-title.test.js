/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — renaming a board in the top bar (GitHub #97, bug 10).
   Enter did nothing: the rename sat in a debounce and the box kept the
   caret, and the breadcrumb tile kept the old name's letter. Enter now
   leaves the box, leaving saves at once and repaints the tile, and Escape
   puts back the name the box had when it was entered.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-title');
  const app=loadApp({files:['js/boards.js']});
  const {run}=app;
  run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};currentPage='board-canvas';
    _editBoard={id:'B',ownerUid:'u1',visibility:'personal',title:'Winter',zoom:1};
    moodBoards=[{id:'B',title:'Winter'}];_editCards=[];_editConnectors=[];
    window.__saves=0;_boardsSaveNow=function(){window.__saves++;};`);
  const input=app.el('board-title-input');input.value='Winter';
  input.blur=function(){run(`window.boardsTitleDone(document.getElementById('board-title-input'))`);};
  const tile=app.el('board-crumb-tile');
  const key=k=>run(`window.boardsTitleKey({key:'${k}',preventDefault(){},stopPropagation(){}},document.getElementById('board-title-input'))`);

  s.section('Enter commits');
  run(`window.boardsTitleFocus(document.getElementById('board-title-input'))`);
  input.value='  Summer ';run(`window.boardsTitleInput(document.getElementById('board-title-input').value)`);
  key('Enter');
  s.eq('the title is saved trimmed',run(`_editBoard.title`),'Summer');
  s.eq('the box shows it trimmed',input.value,'Summer');
  s.eq('saved now, not after a debounce',run(`window.__saves`),1);
  s.eq('the boards list follows',run(`moodBoards[0].title`),'Summer');
  s.ok('the breadcrumb tile is repainted with the new letter',/>S</.test(tile.innerHTML||''),tile.innerHTML);

  s.section('Escape restores');
  run(`window.boardsTitleFocus(document.getElementById('board-title-input'))`);
  input.value='Oops';run(`window.boardsTitleInput('Oops')`);
  key('Escape');
  s.eq('the name before editing comes back',run(`_editBoard.title`),'Summer');
  s.eq('and in the box',input.value,'Summer');

  s.section('wired');
  const src=require('fs').readFileSync(require('path').join(__dirname,'..','js','boards.js'),'utf8');
  s.ok('the input carries all three handlers',/id="board-title-input"[^>]*onkeydown="window\.boardsTitleKey\(event,this\)"[^>]*onblur="window\.boardsTitleDone\(this\)"/.test(src));
  return s;
};

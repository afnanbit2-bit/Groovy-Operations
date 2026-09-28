/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — drag a card onto another board to move it (GitHub #97,
   bug 2). A card dropped on a sub-board card or on a breadcrumb goes to
   that board's Unsorted through window.boardsMoveCardsTo — the same call
   as "Move to board…". DRIVEN through the real drag: pointerdown, a move
   past the threshold, a pointerup over the target.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-dragmove');
  const app=loadApp({files:['js/boards.js']});
  const {run,state}=app;
  const setup=(extra)=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};currentPage='board-canvas';
    _editBoard={id:'A',ownerUid:'u1',visibility:'personal',zoom:1};
    moodBoards=[{id:'A',ownerUid:'u1',visibility:'personal'},{id:'C',ownerUid:'u1',visibility:'personal'},
      {id:'H',ownerUid:'u1',visibility:'personal',isHome:true}];
    _editConnectors=[];_boardsSelection=new Set();_boardsUndo=[];
    _editCards=[{id:'n1',type:'text',text:'x',x:0,y:0,w:220,h:100},
      {id:'sb',type:'board',boardId:'C',x:500,y:0,w:340,h:136},
      {id:'sh',type:'board',boardId:'H',x:500,y:300,w:340,h:136}${extra||''}];
    window.__moved=null;window.boardsMoveCardsTo=function(t,ids){window.__moved={t,ids};return Promise.resolve(1);};`);
  const rect=(id,l,t)=>{const e=app.el(id);e.getBoundingClientRect=()=>({left:l,top:t,right:l+100,bottom:t+100,width:100,height:100});return e;};
  const drag=(card,x,y)=>{
    run(`window.boardsCardDragStart({clientX:5,clientY:5,pointerId:1,stopPropagation(){},currentTarget:document.getElementById('board-card-${card}'),target:document.getElementById('board-card-${card}')},'${card}')`);
    const ev={clientX:x,clientY:y,pointerId:1};
    (state.listeners.pointermove||[]).slice().forEach(f=>f(ev));
    const hovering=app.el('board-card-sb').classList.contains('board-move-drop');
    (state.listeners.pointerup||[]).slice().forEach(f=>f(ev));
    return hovering;
  };

  s.section('onto a sub-board card');
  setup();rect('board-card-sb',500,0);rect('board-card-sh',500,300);
  const lit=drag('n1',550,50);
  s.ok('the target lights up while held over it',lit);
  s.eq('the card is moved to that board',run(`JSON.stringify(window.__moved)`),JSON.stringify({t:'C',ids:['n1']}));
  s.eq('it is put back where it started until the move lands',run(`_editCards.find(c=>c.id==='n1').x`),0);
  s.eq('the drag leaves no undo entry of its own',run(`_boardsUndo.length`),0);
  s.ok('and the highlight is gone',!app.el('board-card-sb').classList.contains('board-move-drop'));

  s.section('refused');
  setup();rect('board-card-sb',500,0);rect('board-card-sh',500,300);
  drag('n1',550,350);
  s.eq('Home is not a target',run(`window.__moved`),null);
  setup();rect('board-card-sb',500,0);
  drag('n1',1500,1500);
  s.eq('a drop on empty canvas is an ordinary move',run(`window.__moved`),null);
  s.eq('and the card stays where it was dropped',run(`_editCards.find(c=>c.id==='n1').x`),1495);
  setup(",{id:'sb2',type:'board',boardId:'C',x:0,y:600,w:340,h:136}");rect('board-card-sb',500,0);
  drag('sb2',550,50);
  s.eq('a board link is never moved into another board',run(`window.__moved`),null);

  s.section('breadcrumbs');
  const src=require('fs').readFileSync(require('path').join(__dirname,'..','js','boards.js'),'utf8');
  s.ok('an ancestor crumb carries its board id as a drop target',/class="board-crumb" data-board-drop="\$\{_boardsEsc\(a\.id\)\}"/.test(src));
  return s;
};

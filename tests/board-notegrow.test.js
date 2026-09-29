/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — a note is as tall as its text (GitHub #97, bug 7).
   It used to keep a fixed height and scroll inside at ~100px. MEASURED in
   real Chromium (a 200px note drawn whole, c.h untouched at render; typing
   grew c.h to 380); this suite holds the rules the browser run cannot:
   render never writes c.h, typing only grows, a column child is not drawn
   over its neighbour, and the cap holds.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-notegrow');
  const app=loadApp({files:['js/boards.js']});
  const {run}=app;
  run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};currentPage='board-canvas';
    _editBoard={id:'B',ownerUid:'u1',visibility:'personal',zoom:1};_editConnectors=[];
    _editCards=[{id:'n1',type:'text',text:'x',x:0,y:0,w:220,h:100},
      {id:'col',type:'column',title:'C',x:400,y:0,w:280,h:300},
      {id:'n2',type:'text',text:'y',columnId:'col',x:410,y:70,w:260,h:100},
      {id:'h1',type:'heading',text:'z',x:0,y:400,w:220,h:60}];`);
  // A body whose text needs 220px inside a 100px card (its body is 98).
  const dom=(id,cardH,over)=>{
    const card=app.el('board-card-'+id),body=app.el('board-txt-'+id);
    card.offsetHeight=cardH;card.style=card.style||{};
    body.clientHeight=cardH-2;body.scrollHeight=cardH-2+over;
    return card;
  };
  const h=id=>run(`_editCards.find(c=>c.id==='${id}').h`);

  s.section('at render: drawn taller, never stored taller');
  let card=dom('n1',100,120);
  run(`_boardsFitNotes()`);
  s.eq('the card is drawn to its text',card.style.height,'220px');
  s.eq('c.h is not written on a read path',h('n1'),100);
  const n2=dom('n2',100,120);n2.style.height='';
  run(`_boardsFitNotes()`);
  s.ok('a note in a column is not drawn over its neighbour',!n2.style.height,n2.style.height);

  s.section('while typing: c.h grows');
  card=dom('n1',100,120);
  run(`window.boardsTextInput('n1',document.getElementById('board-txt-n1'))`);
  s.eq('the stored height follows the text',h('n1'),220);
  dom('n1',220,0);
  run(`window.boardsTextInput('n1',document.getElementById('board-txt-n1'))`);
  s.eq('text that fits changes nothing',h('n1'),220);
  dom('n2',100,60);
  run(`window.boardsTextInput('n2',document.getElementById('board-txt-n2'))`);
  s.eq('a column child grows too, and its column relays it out',h('n2'),160);

  s.section('limits');
  dom('n1',220,9000);
  run(`window.boardsTextInput('n1',document.getElementById('board-txt-n1'))`);
  s.eq('capped, so a pasted essay scrolls instead',h('n1'),run(`_BOARDS_NOTE_MAX_H`));
  dom('h1',60,80);
  s.eq('only notes grow — a heading is not measured',run(`_boardsNoteNeedH(_editCards.find(c=>c.id==='h1'))`),null);
  s.eq('a missing element measures nothing',run(`_boardsNoteNeedH({id:'gone',type:'text'})`),null);

  s.section('resize cannot cut the text off');
  const src=require('fs').readFileSync(require('path').join(__dirname,'..','js','boards.js'),'utf8');
  const rs=(src.match(/window\.boardsResizeStart=function[\s\S]*?\n};/)||[''])[0];
  s.ok('the resize clamps a note at its text',/c\.type==='text'\)\{const need=_boardsNoteNeedH\(c\)/.test(rs));
  return s;
};

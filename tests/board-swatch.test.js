/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — the colour swatch (28 Sept 2026). A note whose whole text
   is a hex colour becomes a swatch when editing ends; the swatch shows its
   value in HEX / RGB / HSL / Off and the nearest named colour. DRIVEN
   through _boardsEndEdit and the picker's own handlers, not only helpers.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-swatch');
  const app=loadApp({files:['js/boards.js']});
  const {run}=app;
  const setup=(cards)=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};currentPage='board-canvas';
    _editBoard={id:'A',ownerUid:'u1',visibility:'personal',zoom:1};moodBoards=[_editBoard];
    _editConnectors=[];_boardsSelection=new Set();_boardsUndo=[];_boardsRedo=[];_boardsSwPick=null;
    _editCards=${JSON.stringify(cards)};`);

  s.section('hex detection');
  const hx=v=>run(`_boardsSwatchHexFrom(${JSON.stringify(v)})`);
  s.eq('#ff5733 → #FF5733',hx('#ff5733'),'#FF5733');
  s.eq('surrounding space is trimmed',hx('  #75ae76\n'),'#75AE76');
  s.eq('#abc expands to #AABBCC',hx('#abc'),'#AABBCC');
  ['ff5733','#ff573','#ff57333','#ggg','the colour #ff5733','#ff5733 please','',null].forEach(v=>
    s.eq('refused: '+JSON.stringify(v),hx(v),''));

  s.section('a note becomes a swatch when editing ends');
  setup([{id:'n1',type:'text',text:'#ff5733',x:40,y:60,w:220,h:100}]);
  run(`_boardsEditingEl=document.getElementById('board-txt-n1');_boardsEndEdit()`);
  const c=()=>JSON.parse(run(`JSON.stringify(_editCards[0])`));
  s.eq('type is swatch',c().type,'swatch');
  s.eq('hex normalised',c().hex,'#FF5733');
  s.eq('same x/y',c().x+','+c().y,'40,60');
  s.eq('born 220×230',c().w+'x'+c().h,'220x230');
  s.eq('no text left behind',c().text,undefined);
  s.eq('one undo entry',run(`_boardsUndo.length`),1);
  run(`window.boardsUndoAction()`);
  s.eq('Ctrl+Z restores the note',c().type,'text');
  s.eq('… with its text',c().text,'#ff5733');

  setup([{id:'n2',type:'text',text:'hello #ff5733',x:0,y:0,w:220,h:100}]);
  run(`_boardsEditingEl=document.getElementById('board-txt-n2');_boardsEndEdit()`);
  s.eq('a note with other words stays a note',c().type,'text');
  s.eq('… and pushes no undo',run(`_boardsUndo.length`),0);

  s.section('the name');
  s.eq('#FF0000 is Red',run(`_boardsSwatchName('#FF0000')`),'Red');
  s.eq('#FE0101 is nearest Red',run(`_boardsSwatchName('#FE0101')`),'Red');
  s.eq('#FF6037 is Outrageous Orange',run(`_boardsSwatchName('#FF6037')`),'Outrageous Orange');
  s.eq('an invalid hex has no name',run(`_boardsSwatchName('red')`),'');
  s.ok('the list is curated and large',run(`_BOARDS_COLOR_NAMES.length`)>=150);
  s.eq('a name the person gave wins',run(`_boardsSwatchLabel({hex:'#FF0000',name:'Brand red'})`),'Brand red');

  s.section('display formats');
  const v=f=>run(`_boardsSwatchValue('#75AE76','${f}')`);
  s.eq('HEX',v('hex'),'#75AE76');
  s.eq('RGB',v('rgb'),'117,174,118');
  s.eq('HSL',v('hsl'),'121,26%,57%');
  s.eq('Off',v('off'),'');

  s.section('the Display switch');
  setup([{id:'s1',type:'swatch',hex:'#75AE76',x:0,y:0,w:220,h:230}]);
  run(`_boardsSelection=new Set(['s1'])`);
  run(`_boardsSwatchAct('fmt:rgb')`);
  s.eq('picking RGB stores fmt',c().fmt,'rgb');
  s.eq('… and pushes undo',run(`_boardsUndo.length`),1);
  run(`_boardsSwatchAct('fmt:hex')`);
  s.eq('HEX is the default and stores nothing',c().fmt,undefined);
  run(`_boardsSwatchAct('fmt:bogus')`);
  s.eq('an unknown format is refused',c().fmt,undefined);
  const rail=JSON.parse(run(`JSON.stringify(_boardsRailItems().map(i=>i.act))`));
  s.eq('the rail is Color · Labels · Reactions · Comment · Display · Caption · ⋯',
    rail.join(','),'deselect,sw:pick,labels,reactions,card-comment,sw:display,caption,more');

  s.section('changing the colour');
  setup([{id:'s1',type:'swatch',hex:'#75AE76',x:0,y:0,w:220,h:230}]);
  run(`_boardsSelection=new Set(['s1']);window.boardsSwatchPicker('s1')`);
  run(`_boardsSwPick.mode='hex';window.boardsSwpField(0,'#FF0000')`);
  s.eq('a hex field sets the colour',c().hex,'#FF0000');
  s.eq('… and the derived name follows',run(`_boardsSwatchLabel(_editCards[0])`),'Red');
  run(`_boardsSwPick.mode='rgb';window.boardsSwpField(1,255)`);
  s.eq('an RGB field sets the colour',c().hex,'#FFFF00');
  s.eq('ONE undo entry for the whole picker session',run(`_boardsUndo.length`),1);
  s.eq('an invalid hex is refused',run(`_boardsSwPick.mode='hex';window.boardsSwpField(0,'#zzzzzz')`),false);
  s.eq('… and changes nothing',c().hex,'#FFFF00');
  s.eq('the setter refuses garbage',run(`_boardsSwatchSetHex('s1','red;background:url(x)')`),false);
  s.eq('… still',c().hex,'#FFFF00');

  s.section('search and the markup');
  s.ok('card text carries the hex',run(`_boardsCardText(_editCards[0])`).indexOf('#ffff00')>-1);
  s.ok('… and the name',run(`_boardsCardText(_editCards[0])`).indexOf('yellow')>-1);
  s.eq('the noun is Colour',run(`_boardsCardNoun(_editCards[0])`),'Colour');
  const html=run(`_boardCardHTML({id:'x',type:'swatch',hex:'red"><script>',x:0,y:0,w:220,h:230},true)`);
  s.ok('an invalid stored hex never reaches the style',html.indexOf('script')<0&&html.indexOf('background:#CCCCCC')>-1);
  s.ok('the name is not interpolated (hydrated with textContent)',
    run(`_boardCardHTML({id:'y',type:'swatch',hex:'#111111',name:'<b>me</b>',x:0,y:0,w:220,h:230},true)`).indexOf('<b>me')<0);

  s.section('Pantone codes (C and TCX)');
  run(`COLOR_IMPORT_PANTONE_HEX={'485 C':'#da291c','Cool Grey 10 C':'#53565a','Pantone Red 032 C':'#e31c23'};
    _boardsPantoneLib=[{pantoneCode:'19-1664 TCX',hexApprox:'#9C1B31'},{pantoneCode:'18-1662 TCX',hexApprox:'not a colour'},{pantoneCode:'17-1463 TCX',hexApprox:'#E27A53',status:'archived'}];
    _boardsPantoneCache=null;`);
  const key=t=>run(`_boardsPantoneKey(${JSON.stringify(t)})`);
  s.eq('a C code is read',key('485 c'),'485 C');
  s.eq('a Pantone prefix is ignored',key('Pantone 485 C'),'485 C');
  s.eq('a TCX code is read, dash optional',key('19 1664 tcx'),'19-1664 TCX');
  // Pantone's books write GRAY; people type GREY. Both reach one key, or
  // every Cool Gray code in a real book drops out (29 Sept 2026).
  s.eq('Cool Grey and Cool Gray are one code',key('cool grey 10 c')+'|'+key('Cool Gray 10 C'),'COOL GRAY 10 C|COOL GRAY 10 C');
  s.eq('plain text is not a code',key('red'),'');
  const book=run(`JSON.stringify(_boardsPantoneBook())`);
  s.ok('the built-in C codes are in the book',/"485 C":"#DA291C"/.test(book),book);
  s.ok('the colour library\'s TCX codes are in the book',/"19-1664 TCX":"#9C1B31"/.test(book));
  s.ok('an invalid library hex is left out',!/18-1662/.test(book));
  s.ok('an archived library colour is left out',!/17-1463/.test(book));
  run(`_editCards=[{id:'p1',type:'text',text:'Pantone 485 C',x:0,y:0,w:220,h:100},{id:'p2',type:'text',text:'99-9999 TCX',x:0,y:0,w:220,h:100}];`);
  run(`_boardsSwatchFromNoteEl({id:'board-txt-p1',textContent:''});_boardsSwatchFromNoteEl({id:'board-txt-p2',textContent:''})`);
  s.eq('a known code turns the note into a swatch of its colour',run(`_editCards[0].type+' '+_editCards[0].hex`),'swatch #DA291C');
  s.eq('showing the code',run(`_boardsSwatchValue(_editCards[0].hex,_boardsSwatchFmt(_editCards[0]),_editCards[0].pantone)`),'485 C');
  s.eq('an unknown code stays a note — nothing is guessed',run(`_editCards[1].type`),'text');
  s.eq('any swatch shows its nearest code, marked approximate',run(`_boardsSwatchValue('#D82A1F','pantone')`),'≈ 485 C');
  return s;
};

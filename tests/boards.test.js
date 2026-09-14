/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — js/boards.js

   Covers the invariants that would be expensive to rediscover: the touch
   zoom curve, the rich-text sanitiser (a real stored-XSS boundary), labels
   and reactions, board identity, and the phone/desktop split.

   NOT covered, and it matters: anything visual. See tests/harness.js.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const FILES=['js/boards.js'];

module.exports=function(){
  const s=suite('boards');

  // ── touch: the 100% detent and micro zoom ─────────────────────────────
  {
    const app=loadApp({files:FILES});
    const {run,state}=app;
    s.section('pinch stops at 100% when it starts below it');
    run(`__p={zoom:0.19,micro:false,buzzed100:false,buzzedMax:false}`);
    s.ok('19% × 1.5 → 28.5%',Math.abs(run(`_boardsPinchZoom(__p,1.5)`)-0.285)<1e-9);
    s.eq('a wide spread stops dead at 100%',run(`_boardsPinchZoom(__p,9)`),1);
    s.eq('and buzzed exactly once',state.vibrations.length,1);
    run(`_boardsPinchZoom(__p,12)`);
    s.eq('no second buzz while held there',state.vibrations.length,1);
    s.ok('pinching back in is unaffected',Math.abs(run(`_boardsPinchZoom(__p,0.8)`)-0.152)<1e-9);
    s.eq('and never goes below the 10% floor',run(`_boardsPinchZoom(__p,0.01)`),0.1);

    s.section('a pinch that starts at 100% is geared down');
    state.vibrations.length=0;
    run(`__m={zoom:1,micro:true,buzzed100:false,buzzedMax:false}`);
    s.eq('no movement, no change',run(`_boardsPinchZoom(__m,1)`),1);
    const g2=run(`_boardsPinchZoom(__m,2)`);
    s.ok('fingers twice as far apart → 134%, not 200%',Math.abs(g2-1.34)<1e-9,Math.round(g2*100)+'%');
    s.eq('a huge spread caps at 200%',run(`_boardsPinchZoom(__m,9)`),2);
    s.eq('and buzzed once at the ceiling',state.vibrations.length,1);
    s.eq('pinching IN is NOT geared down',run(`_boardsPinchZoom(__m,0.5)`),0.5);
  }

  // ── the rich-text sanitiser ───────────────────────────────────────────
  // The parser underneath is a stub (see harness.js); what is under test is
  // the allow-list walk, which is the part this repo wrote.
  {
    const {run}=loadApp({files:FILES});
    const S=h=>run(`_boardsSanitizeRich(${JSON.stringify(h)})`);
    s.section('rich text keeps formatting and nothing else');
    s.eq('bold/italic/underline/strike survive',S('<b>a</b><i>b</i><u>c</u><s>d</s>'),'<b>a</b><i>b</i><u>c</u><s>d</s>');
    s.eq('strong/em normalise',S('<strong>a</strong><em>b</em>'),'<b>a</b><i>b</i>');
    s.eq('lists survive',S('<ul><li>one</li></ul>'),'<ul><li>one</li></ul>');
    s.eq('a colour span survives',S('<span style="color:#7B1F2A">x</span>'),'<span style="color:#7B1F2A">x</span>');
    s.eq('font color normalises to a span',S('<font color="#14532D">g</font>'),'<span style="color:#14532D">g</span>');

    s.section('and strips every way in');
    s.eq('a script tag goes, its text stays',S('<script>alert(1)</script>hi'),'alert(1)hi');
    s.eq('an img/onerror goes entirely',S('<img src="x" onerror="alert(1)">'),'');
    s.eq('onclick never survives',S('<b onclick="steal()">x</b>'),'<b>x</b>');
    s.eq('a javascript: anchor goes, its text stays',S('<a href="javascript:alert(1)">click</a>'),'click');
    s.eq('non-colour styles are dropped',S('<span style="position:fixed;background:url(x)">t</span>'),'<span>t</span>');
    s.eq('a bogus colour value is refused',S('<span style="color:url(javascript:1)">t</span>'),'<span>t</span>');
    s.eq('an iframe goes',S('<iframe src="x"></iframe>'),'');
    s.ok('plain text is recognised as unformatted',run(`_boardsRichIsPlain('hello','hello')`)===true);
    s.ok('formatted text is not',run(`_boardsRichIsPlain('<b>hello</b>','hello')`)===false);
  }

  // ── labels and reactions ──────────────────────────────────────────────
  {
    const app=loadApp({files:FILES});
    const {run}=app;
    run(`_editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
         _editCards=[{id:'a',type:'text',text:'one',x:0,y:0,w:200,h:120},
                     {id:'b',type:'text',text:'two',x:0,y:0,w:200,h:120}];
         _editConnectors=[];_boardsPeers=[];_boardsSelection=new Set();`);

    s.section('labels live on the card, the library is derived');
    run(`window.boardsAddLabel('a','Approved','green')`);
    run(`window.boardsAddLabel('b','Approved','green')`);
    run(`window.boardsAddLabel('b','Urgent','red')`);
    s.eq('stored on the card',run(`JSON.stringify(_editCards[0].labels)`),'[{"t":"Approved","c":"green"}]');
    s.eq('the same label twice is a no-op',run(`(window.boardsAddLabel('a','approved','red'),_editCards[0].labels.length)`),1);
    s.eq('library derived, most-used first',
      run(`_boardsLabelLibrary().map(l=>l.t+':'+l.n).join(' ')`),'Approved:2 Urgent:1');
    s.eq('an unknown colour falls back to grey',
      run(`(window.boardsAddLabel('a','X','chartreuse'),_editCards[0].labels[1].c)`),'grey');
    run(`window.boardsRemoveLabel('a','X');window.boardsRemoveLabel('a','Approved')`);
    s.ok('removing the last one drops the field',run(`_editCards[0].labels===undefined`));
    s.ok('labels are searchable',/urgent/i.test(run(`_boardsCardText(_editCards[1])`)));
    s.ok('label markup carries no user text (hydrated after)',
      !/Approved/.test(run(`_boardsLabelsHTML(_editCards[1])`)));

    s.section('reactions store uids, not counts');
    run(`window.boardsToggleReaction('a','A')`);
    s.eq('my uid is recorded',run(`JSON.stringify(_editCards[0].reactions['A'])`),'["u1"]');
    run(`window.boardsToggleReaction('a','A')`);
    s.ok('tapping again removes it, and the field with it',run(`_editCards[0].reactions===undefined`));
    run(`_editCards[0].reactions={'B':['u2']};window.boardsToggleReaction('a','B')`);
    s.eq('joining someone else’s reaction appends',run(`JSON.stringify(_editCards[0].reactions['B'])`),'["u2","u1"]');
    s.ok('the chip is marked as mine',/board-reaction mine/.test(run(`_boardsReactionsHTML(_editCards[0])`)));
  }

  // ── phone vs desktop ──────────────────────────────────────────────────
  {
    const desktop=loadApp({files:FILES,phone:false});
    const phone=loadApp({files:FILES,phone:true});
    const boot=a=>a.run(`_editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsPeers=[];_boardsSelection=new Set();`);
    boot(desktop);boot(phone);
    const dh=desktop.run(`_renderBoardCanvasHTML()`);
    const ph=phone.run(`_renderBoardCanvasHTML()`);

    s.section('the minimap is a desktop affordance');
    s.ok('desktop renders it',/id="board-minimap"/.test(dh));
    s.ok('desktop renders its toggle',/boardsToggleMinimap/.test(dh));
    s.ok('phone renders neither',!/id="board-minimap"/.test(ph)&&!/boardsToggleMinimap/.test(ph));
    s.ok('but both keep the zoom readout',/id="board-zoom-pill"/.test(dh)&&/id="board-zoom-pill"/.test(ph));

    s.section('the phone action bar is six targets');
    phone.run(`_editCards=[{id:'a',type:'text',text:'x',x:0,y:0,w:200,h:120}];_boardsSelection=new Set(['a'])`);
    s.eq('Color/Labels/Reactions/Comment/More/Done',
      phone.run(`JSON.stringify(_boardsRailItems().map(i=>i.act||''))`),
      '["color","labels","reactions","card-comment","more","deselect"]');
    desktop.run(`_editCards=[{id:'a',type:'text',text:'x',x:0,y:0,w:200,h:120}];_boardsSelection=new Set(['a'])`);
    const drail=desktop.run(`JSON.stringify(_boardsRailItems().map(i=>i.act||(i.swatches?'swatches':'sep')))`);
    s.ok('desktop keeps its full rail',/labels/.test(drail)&&/reactions/.test(drail)&&/swatches/.test(drail));

    s.section('More and the right-click menu share one item list');
    const menu=desktop.run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act||'').filter(Boolean))`);
    s.ok('the menu offers labels and reactions',/labels/.test(menu)&&/reactions/.test(menu));
  }

  // ── board identity ────────────────────────────────────────────────────
  {
    const {run}=loadApp({files:FILES});
    s.section('a stored board colour is never trusted');
    s.eq('a good hex passes, uppercased',run(`_boardsValidHex('#3fcfaf')`),'#3FCFAF');
    s.eq('a short hex is refused',run(`_boardsValidHex('#fff')`),'');
    s.eq('a css function is refused',run(`_boardsValidHex('url(javascript:1)')`),'');
    s.eq('a named colour is refused',run(`_boardsValidHex('red')`),'');
    s.eq('an attribute-break attempt is refused',run(`_boardsValidHex('#abc"><script>')`),'');

    s.section('and the ink on it stays readable');
    s.eq('dark text on a pale tile',run(`_boardsInkOn('#F5C230')`),'#111111');
    s.eq('light text on a dark tile',run(`_boardsInkOn('#14532D')`),'#FFFFFF');

    s.section('HSV → hex');
    s.eq('pure red',run(`_boardsHsvToHex(0,100,100)`),'#FF0000');
    s.eq('pure green',run(`_boardsHsvToHex(120,100,100)`),'#00FF00');
    s.eq('pure blue',run(`_boardsHsvToHex(240,100,100)`),'#0000FF');
    s.eq('zero value is black',run(`_boardsHsvToHex(200,80,0)`),'#000000');
    s.eq('zero saturation is grey',run(`_boardsHsvToHex(200,0,50)`),'#808080');
    let allValid=true;
    [0,45,90,135,180,225,270,315,359].forEach(h=>[0,33,66,100].forEach(sv=>[0,50,100].forEach(v=>{
      if(!/^#[0-9A-F]{6}$/.test(run(`_boardsHsvToHex(${h},${sv},${v})`)))allValid=false;
    })));
    s.ok('every point in a 108-point sweep is a valid hex',allValid);

    s.section('the gallery tile');
    run(`moodBoards=[{id:'B1',title:'Winter Drop 2027',visibility:'shared',ownerUid:'u1',cards:[],color:'#35507A',icon:'J'}]`);
    const tile=run(`_boardsTileHTML(moodBoards[0],34)`);
    s.ok('carries the icon on the colour',/#35507A/.test(tile));
    s.ok('with readable ink',/color:#FFFFFF/.test(tile));
    run(`moodBoards.push({id:'B2',title:'plain',visibility:'shared',ownerUid:'u1',cards:[],color:'javascript:alert(1)'})`);
    s.ok('a poisoned colour never reaches the style attribute',
      !/javascript/.test(run(`_boardsTileHTML(moodBoards[1],34)`)));
    s.ok('and it falls back to the title initial',/>P</.test(run(`_boardsTileHTML(moodBoards[1],34)`)));
  }

  // ── the sheet ─────────────────────────────────────────────────────────
  {
    const app=loadApp({files:FILES,currentPage:'boards'});
    const {run}=app;
    run(`moodBoards=[{id:'B1',title:'W',visibility:'shared',ownerUid:'u1',ownerName:'Afnan',cards:[]}]`);
    s.section('pickers render into one host on document.body');
    run(`window.boardsOpenColorPicker('board','B1')`);
    s.ok('the colour sheet opens on the gallery page',/board-tile-sw/.test(app.bodyHtml('board-sheet')));
    s.ok('and offers a custom colour',/Custom colour/.test(app.bodyHtml('board-sheet')));
    run(`window.boardsOpenCustomColor()`);
    s.ok('the custom picker has three sliders',
      /bhsv-h/.test(app.bodyHtml('board-sheet'))&&/bhsv-s/.test(app.bodyHtml('board-sheet'))&&/bhsv-v/.test(app.bodyHtml('board-sheet')));
    run(`window.boardsOpenIconPicker('B1')`);
    s.ok('the icon picker offers a no-icon option',/No icon/.test(app.bodyHtml('board-sheet')));
    run(`window.boardsOpenSetup('B1')`);
    s.ok('new-board setup asks for the name first',/board-setup-name/.test(app.bodyHtml('board-sheet')));
    run(`window.boardsCloseSheet()`);
    s.eq('closing removes the host entirely',app.bodyCount('board-sheet'),0);
  }

  // ── the wheel (Sept 2026) ─────────────────────────────────────────────
  // There was NO wheel handler in js/boards.js at all, so Ctrl+wheel fell
  // through to the browser's page zoom and scaled the top bar, the rail,
  // the minimap and the Report Bug button along with the canvas, while the
  // board's own zoom readout sat unchanged. Reported by Afnan.
  //
  // preventDefault IS the fix — a handler that zooms the canvas but lets
  // the event through leaves the page zooming as well.
  {
    const app=loadApp({files:FILES});
    const {run}=app;
    run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1'}`);
    run(`_editCards=[]`);
    run(`_boardsWireStagePan()`);
    const stage='board-stage';

    s.section('ctrl+wheel zooms the CANVAS, not the page');
    s.eq('the listener is non-passive, or preventDefault is ignored',
      JSON.stringify(app.listenerOpts(stage,'wheel')),'{"passive":false}');
    let e=app.fire(stage,'wheel',{ctrlKey:true,deltaY:-100,clientX:400,clientY:300});
    s.ok('the browser zoom is prevented',e.defaultPrevented);
    const zIn=run(`_editBoard.zoom`);
    s.ok('and the board zoomed IN',zIn>1,Math.round(zIn*100)+'%');
    app.fire(stage,'wheel',{ctrlKey:true,deltaY:100,clientX:400,clientY:300});
    s.ok('scrolling the other way zooms OUT',run(`_editBoard.zoom`)<zIn);
    // A trackpad pinch reaches Chrome as a wheel event with ctrlKey set.
    run(`_editBoard.zoom=1;_editBoard.panX=0;_editBoard.panY=0`);
    app.fire(stage,'wheel',{metaKey:true,deltaY:-40,clientX:100,clientY:100});
    s.ok('cmd+wheel works the same (macOS)',run(`_editBoard.zoom`)>1);

    s.section('zoom is anchored to the cursor');
    // The world point under the cursor must not move. Zoom about (200,150)
    // from 1× and the same world coordinate has to map back to (200,150).
    run(`_editBoard.zoom=1;_editBoard.panX=0;_editBoard.panY=0`);
    const before=run(`_boardsScreenToWorld(200,150)`);
    app.fire(stage,'wheel',{ctrlKey:true,deltaY:-100,clientX:200,clientY:150});
    const after=run(`_boardsScreenToWorld(200,150)`);
    s.ok('the point under the cursor stays put',
      Math.abs(before.x-after.x)<1e-6&&Math.abs(before.y-after.y)<1e-6,
      JSON.stringify(before)+' vs '+JSON.stringify(after));

    s.section('a plain wheel pans instead');
    run(`_editBoard.zoom=1;_editBoard.panX=0;_editBoard.panY=0`);
    e=app.fire(stage,'wheel',{deltaY:120});
    s.ok('it is prevented too — the page must not scroll',e.defaultPrevented);
    s.eq('scrolling down moves the board up',run(`_editBoard.panY`),-120);
    s.eq('and not sideways',run(`_editBoard.panX`),0);
    s.eq('the zoom is untouched',run(`_editBoard.zoom`),1);
    run(`_editBoard.panX=0;_editBoard.panY=0`);
    app.fire(stage,'wheel',{deltaY:120,shiftKey:true});
    s.eq('shift swaps the axis',run(`_editBoard.panX`),-120);
    s.eq('leaving the other alone',run(`_editBoard.panY`),0);

    s.section('zoom stays inside the board\'s own limits');
    run(`_editBoard.zoom=_BOARDS_ZOOM_MAX`);
    for(let i=0;i<20;i++)app.fire(stage,'wheel',{ctrlKey:true,deltaY:-100,clientX:0,clientY:0});
    s.eq('it cannot go past the ceiling',run(`_editBoard.zoom`),run(`_BOARDS_ZOOM_MAX`));
    run(`_editBoard.zoom=_BOARDS_ZOOM_MIN`);
    for(let i=0;i<20;i++)app.fire(stage,'wheel',{ctrlKey:true,deltaY:100,clientX:0,clientY:0});
    s.eq('nor below the floor',run(`_editBoard.zoom`),run(`_BOARDS_ZOOM_MIN`));
  }

  // ── the file-drop overlay must not answer an internal drag ────────────
  // Chrome advertises a natively-dragged <img> to the drop target as
  // carrying Files, so dragging a card's own picture raised "Drop files to
  // add them to this board" AND cancelled the pointer stream the card drag
  // runs on — two logics at once, which is what Afnan saw.
  {
    const app=loadApp({files:FILES});
    const {run}=app;
    const filesDrag={dataTransfer:{types:['Files'],files:[{name:'a.png'}]}};
    s.section('a real file drop is still recognised');
    s.eq('types carrying Files counts',run(`_boardsDragHasFiles(${JSON.stringify(filesDrag)})`),true);
    s.eq('a plain text drag does not',
      run(`_boardsDragHasFiles({dataTransfer:{types:['text/plain'],files:[]}})`),false);
    s.eq('and no dataTransfer at all does not',run(`_boardsDragHasFiles({})`),false);

    s.section('but not while a drag from inside the board is in flight');
    run(`_boardsInternalDrag=true`);
    s.eq('even one claiming to carry Files',
      run(`_boardsDragHasFiles(${JSON.stringify(filesDrag)})`),false);
    run(`_boardsInternalDrag=false`);
    s.eq('and it recovers once that drag ends',
      run(`_boardsDragHasFiles(${JSON.stringify(filesDrag)})`),true);
  }

  // ── cards must be movable ─────────────────────────────────────────────
  {
    const app=loadApp({files:FILES});
    const {run}=app;
    run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0}`);
    const card=t=>`_boardCardHTML(${JSON.stringify({id:'c1',type:t,x:0,y:0,w:200,h:200,
      imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',
      fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/a.pdf',fileName:'a.pdf',
      boardId:'b2',items:[],text:''})},true)`;

    s.section('no card image can start a native browser drag');
    s.ok('the image card',/draggable="false"/.test(run(card('image'))));
    s.ok('the file card body',/draggable="false"/.test(run(card('file'))));

    // Sept 2026: every body drags now, not just the three holding nothing
    // editable. A note is only contenteditable while it is BEING edited, so
    // a press on one is unambiguously a grab.
    s.section('a card drags from its body, not only its header strip');
    const bodyDrag=t=>{
      const html=run(card(t));
      const m=/<(?:div|a) class="board-card-body[^>]*>/g;
      return (html.match(m)||[]).some(tag=>/boardsCardDragStart/.test(tag));
    };
    ['image','file','board','text','todo'].forEach(t=>{
      s.ok('a '+t+' card does',bodyDrag(t));
    });
    s.ok('a link card does NOT — it is three form fields',!bodyDrag('link'));

    s.section('nothing is editable until it is double-clicked');
    ['text','todo'].forEach(t=>{
      const html=run(card(t));
      s.ok('a '+t+' card ships contenteditable="false"',
        /contenteditable="false"/.test(html)&&!/contenteditable="true"/.test(html));
      s.ok('and offers a double-click to open it',/ondblclick="window\.boardsBeginEdit/.test(html));
    });
    s.ok('the card name too',/board-card-name[^>]*ondblclick="window\.boardsBeginEdit/.test(run(card('image'))));

    s.section('the delete ✕ can actually be clicked');
    // It sits inside a header whose pointerdown calls setPointerCapture;
    // without stopPropagation the capture retargets the click away from the
    // button and nothing happens. Every other control in that header
    // already carried the guard — these two were missed.
    ['image','text','todo','link','file','board'].forEach(t=>{
      s.ok('the '+t+' card ✕ stops pointerdown',
        /<button class="board-card-del" onpointerdown="event\.stopPropagation\(\)"/.test(run(card(t))));
    });
    const frame=run(`_boardCardHTML(${JSON.stringify({id:'f1',type:'frame',x:0,y:0,w:300,h:300})},true)`);
    s.ok('and so does the frame ✕',
      /<button class="board-card-del" onpointerdown="event\.stopPropagation\(\)"/.test(frame));

    s.section('every card still has its header handle');
    ['image','file','board','text','todo','link'].forEach(t=>{
      s.ok(t+' keeps the header drag',
        /<div class="board-card-head" onpointerdown="window\.boardsCardDragStart/.test(run(card(t))));
    });

    s.section('a locked card is not draggable from anywhere');
    const locked=run(`_boardCardHTML(${JSON.stringify({id:'c2',type:'image',x:0,y:0,w:200,h:200,
      locked:true,imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg'})},true)`);
    s.ok('the body carries no drag handler',
      !/board-card-body[^>]*boardsCardDragStart/.test(locked));
  }

  // ── the Unsorted tray (Sept 2026) ─────────────────────────────────────
  // Milanote's holding pen, per board. The rules worth pinning: it is a
  // plain array on the board doc, open/closed is per viewer and never board
  // data, a stashed card leaves the canvas without being destroyed, and
  // dragging one out produces the right kind of card.
  {
    const app=loadApp({files:FILES});
    const {run,state}=app;
    run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'}`);
    run(`_editCards=[];_editConnectors=[];_editUnsorted=[]`);

    s.section('open/closed is per viewer, not board data');
    run(`_boardsTrayOpen=true`);
    const saved=run(`_boardsUnsortedForSave()`);
    s.eq('an empty tray saves as an empty array',JSON.stringify(saved),'[]');
    run(`_editUnsorted=[{id:'u1',kind:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',_uploading:true}]`);
    const saved2=run(`_boardsUnsortedForSave()`);
    s.ok('a transient _ flag never reaches Firestore',
      !('_uploading' in saved2[0]),JSON.stringify(Object.keys(saved2[0])));
    s.ok('but the real fields do',saved2[0].kind==='image'&&!!saved2[0].imageUrl);

    s.section('a card sent to Unsorted leaves the board but is not destroyed');
    run(`_editUnsorted=[]`);
    run(`_editCards=[{id:'c1',type:'image',x:0,y:0,w:200,h:200,imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',name:'Jacket'},{id:'c2',type:'text',x:0,y:0,w:200,h:200,text:'hi'}]`);
    run(`_editConnectors=[{from:'c1',to:'c2'}]`);
    run(`_boardsSelection=new Set(['c1'])`);
    run(`window.boardsTrayStash('c1')`);
    s.eq('the card is off the canvas',run(`_editCards.length`),1);
    s.eq('and in the tray',run(`_editUnsorted.length`),1);
    s.eq('carrying its image',run(`_editUnsorted[0].imageUrl`),'https://res.cloudinary.com/x/image/upload/v1/a.jpg');
    s.eq('and its name',run(`_editUnsorted[0].name`),'Jacket');
    s.eq('its connector went with it',run(`_editConnectors.length`),0);
    s.ok('and it is no longer selected',!run(`_boardsSelection.has('c1')`));

    s.section('dragging one out makes the right kind of card');
    const mk=(u)=>run(`_boardsCardFromTrayItem(${JSON.stringify(u)},{x:100,y:100})`);
    const img=mk({id:'u1',kind:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',name:'Jacket'});
    s.eq('an image item → an image card',img.type,'image');
    s.eq('keeping its url',img.imageUrl,'https://res.cloudinary.com/x/image/upload/v1/a.jpg');
    s.eq('and its name',img.name,'Jacket');
    s.ok('centred on the drop point',Math.abs((img.x+img.w/2)-100)<1&&Math.abs((img.y+img.h/2)-100)<1);
    s.eq('a file item → a file card',mk({kind:'file',fileUrl:'u',fileName:'a.pdf'}).type,'file');
    s.eq('a link item → a link card',mk({kind:'link',linkUrl:'https://x.test'}).type,'link');
    const txt=mk({kind:'text',text:'some words'});
    s.eq('a text item → a note',txt.type,'text');
    s.eq('with its words',txt.text,'some words');

    s.section('a tray label is never interpolated into the HTML');
    run(`_editUnsorted=[{id:'u1',kind:'text',text:'<img src=x onerror=alert(1)>'}]`);
    const html=run(`_boardsTrayHTML(true)`);
    s.ok('no raw script or handler in the markup',!/onerror=alert/.test(html));
    s.ok('the slot exists instead',/id="board-tray-l-0"/.test(html));
    run(`_boardsTrayHydrate()`);
    s.eq('and hydration writes it as text',app.el('board-tray-l-0').textContent,'<img src=x onerror=alert(1)>');

    s.section('the tray only renders when it is open');
    run(`_boardsTrayOpen=false`);
    s.eq('closed renders nothing',run(`_boardsTrayHTML(true)`),'');

    s.section('a viewer who cannot edit gets no controls');
    run(`_boardsTrayOpen=true`);
    const ro=run(`_boardsTrayHTML(false)`);
    s.ok('no add button',!/boardsTrayPick/.test(ro));
    s.ok('no remove button',!/boardsTrayRemove/.test(ro));
    s.ok('and nothing draggable out',!/boardsTrayDragStart/.test(ro));
  }

  // ── drag now SELECTS, and panning must not be lost ────────────────────
  // Afnan asked for Milanote's gesture. This reverses the Stage 2 decision,
  // whose stated worry was that a canvas with no scrollbars strands anyone
  // who can't pan — so the pan routes are what these tests are really for.
  {
    const app=loadApp({files:FILES});
    const {run}=app;
    function stage(){
      run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1'}`);
      run(`_editCards=[{id:'a',type:'text',x:0,y:0,w:50,h:50},{id:'b',type:'text',x:200,y:200,w:50,h:50}]`);
      run(`_boardsSelection=new Set()`);
      run(`_boardsSpaceDown=false;_boardsPanMode=false;_boardsLineMode=false`);
      run(`_boardsWireStagePan()`);
      return 'board-stage';
    }
    // Drive the real handler and report which branch it took, by watching
    // what a following pointermove changes.
    function gesture(down){
      // Reset the marquee BEFORE the gesture — the handler sets display on
      // pointerdown, so clearing it afterwards (as the first version of
      // this helper did) reads back '' and reports no marquee for a
      // marquee that worked perfectly.
      app.el('board-marquee').style.display='';
      const id=stage();
      const el=app.el(id);
      app.fire(el,'pointerdown',Object.assign({target:el,currentTarget:el,
        pointerId:1,button:0,pointerType:'mouse',clientX:10,clientY:10},down));
      const panBefore=run(`_editBoard.panX`);
      const marqueed=app.el('board-marquee').style.display==='block';
      ((el._ls&&el._ls.pointermove)||[]).forEach(l=>l.fn({clientX:300,clientY:300,target:el}));
      return{panned:run(`_editBoard.panX`)!==panBefore,marqueed};
    }

    s.section('a plain mouse drag on empty canvas selects');
    let g=gesture({});
    s.ok('it draws a marquee',g.marqueed);
    s.ok('and does NOT pan',!g.panned);

    s.section('but every pan route still pans');
    g=gesture({pointerType:'touch'});
    s.ok('a finger pans — a phone has no Shift key',g.panned&&!g.marqueed);
    g=gesture({button:1});
    s.ok('middle-button drag pans',g.panned&&!g.marqueed);
    run(`_boardsSpaceDown=true`);
    const el2=app.el(stage());
    run(`_boardsSpaceDown=true`);
    app.fire(el2,'pointerdown',{target:el2,currentTarget:el2,pointerId:1,button:0,
      pointerType:'mouse',clientX:10,clientY:10});
    const pb=run(`_editBoard.panX`);
    ((el2._ls&&el2._ls.pointermove)||[]).forEach(l=>l.fn({clientX:300,clientY:300,target:el2}));
    s.ok('space+drag pans',run(`_editBoard.panX`)!==pb);
    run(`_boardsSpaceDown=false`);

    // The wheel is the route nobody has to discover — proved in the wheel
    // section above, re-asserted here because it is now load-bearing.
    const el3=app.el(stage());
    const before=run(`_editBoard.panY`);
    app.fire(el3,'wheel',{deltaY:120});
    s.ok('and the wheel pans without any modifier at all',run(`_editBoard.panY`)!==before);

    s.section('Shift+drag still marquees, so nothing unlearns');
    g=gesture({shiftKey:true});
    s.ok('marquee',g.marqueed&&!g.panned);

    s.section('the Hand toggle arms panning with no key held');
    run(`_boardsPanMode=false`);
    run(`window.boardsTogglePan()`);
    s.eq('it turns on',run(`_boardsPanMode`),true);
    const id=stage();
    run(`_boardsPanMode=true`);
    const el4=app.el(id);
    app.fire(el4,'pointerdown',{target:el4,currentTarget:el4,pointerId:1,button:0,
      pointerType:'mouse',clientX:10,clientY:10});
    const p4=run(`_editBoard.panX`);
    ((el4._ls&&el4._ls.pointermove)||[]).forEach(l=>l.fn({clientX:300,clientY:300,target:el4}));
    s.ok('and a plain drag pans while it is on',run(`_editBoard.panX`)!==p4);
  }

  // ── the selection actions from Milanote's menu ────────────────────────
  {
    const app=loadApp({files:FILES});
    const {run}=app;
    run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1'}`);

    s.section('Connect with Lines');
    run(`_editCards=[{id:'a',x:0,y:0,w:10,h:10},{id:'b',x:50,y:0,w:10,h:10},{id:'c',x:100,y:0,w:10,h:10}]`);
    run(`_editConnectors=[];_boardsSelection=new Set(['a','b','c'])`);
    run(`window.boardsConnectSelection()`);
    s.eq('three cards make two lines',run(`_editConnectors.length`),2);
    s.ok('in selection order',run(`_editConnectors[0].from`)==='a'&&run(`_editConnectors[0].to`)==='b');
    // Running it twice must not stack a second line on the same pair.
    run(`window.boardsConnectSelection()`);
    s.eq('running it again adds nothing',run(`_editConnectors.length`),2);
    run(`_editConnectors=[{from:'b',to:'a'}]`);
    run(`window.boardsConnectSelection()`);
    s.eq('and an existing line counts in either direction',run(`_editConnectors.length`),2);
    run(`_boardsSelection=new Set(['a'])`);
    const n=run(`_editConnectors.length`);
    run(`window.boardsConnectSelection()`);
    s.eq('one card connects nothing',run(`_editConnectors.length`),n);

    s.section('Align');
    const setCards=()=>run(`_editCards=[{id:'a',x:0,y:0,w:100,h:20},{id:'b',x:40,y:60,w:60,h:20},{id:'c',x:10,y:120,w:20,h:20}];_boardsSelection=new Set(['a','b','c'])`);
    setCards();run(`window.boardsAlignSelection('left')`);
    s.ok('left puts every x at the bounding box left',
      run(`_editCards.every(c=>c.x===0)`));
    setCards();run(`window.boardsAlignSelection('right')`);
    s.ok('right lines up the right EDGES, not the x',
      run(`_editCards.every(c=>c.x+c.w===100)`));
    setCards();run(`window.boardsAlignSelection('hcenter')`);
    s.ok('centre uses each card own width',
      run(`_editCards.every(c=>Math.abs((c.x+c.w/2)-50)<1e-9)`));
    setCards();run(`window.boardsAlignSelection('top')`);
    s.ok('top works on the other axis',run(`_editCards.every(c=>c.y===0)`));
    // A locked card is not moved by anything else on this board; nor here.
    run(`_editCards=[{id:'a',x:0,y:0,w:10,h:10},{id:'b',x:80,y:0,w:10,h:10,locked:true}];_boardsSelection=new Set(['a','b'])`);
    run(`window.boardsAlignSelection('left')`);
    s.eq('a locked card stays put',run(`_editCards[1].x`),80);

    s.section('Distribute evens the GAPS, not the positions');
    // Different widths is the case that makes position-spacing look wrong.
    run(`_editCards=[{id:'a',x:0,y:0,w:100,h:10},{id:'b',x:150,y:0,w:20,h:10},{id:'c',x:300,y:0,w:100,h:10}];_boardsSelection=new Set(['a','b','c'])`);
    run(`window.boardsDistributeSelection('h')`);
    const gaps=run(`(function(){
      const o=_editCards.slice().sort((p,q)=>p.x-q.x);
      return [o[1].x-(o[0].x+o[0].w), o[2].x-(o[1].x+o[1].w)];
    })()`);
    s.ok('the two gaps are equal',Math.abs(gaps[0]-gaps[1])<1e-9,JSON.stringify(gaps));
    s.ok('and the outer cards never move',run(`_editCards[0].x===0&&_editCards[2].x+_editCards[2].w===400`));
    run(`_editCards=[{id:'a',x:0,y:0,w:10,h:10},{id:'b',x:50,y:0,w:10,h:10}];_boardsSelection=new Set(['a','b'])`);
    run(`window.boardsDistributeSelection('h')`);
    s.eq('two cards are left alone — nothing to distribute',run(`_editCards[1].x`),50);

    s.section('and they are offered on a multi-selection');
    run(`_editCards=[{id:'a',type:'text',x:0,y:0,w:10,h:10},{id:'b',type:'text',x:9,y:9,w:10,h:10},{id:'c',type:'text',x:20,y:20,w:10,h:10}]`);
    run(`_boardsSelection=new Set(['a','b','c'])`);
    const labels=run(`_boardsCardCtxItems(true).map(i=>i.label||'').join('|')`);
    ['Connect with Lines','Align left','Align middle','Distribute horizontally']
      .forEach(l=>s.ok("the menu offers '"+l+"'",labels.indexOf(l)>=0));
    run(`_boardsSelection=new Set(['a','b'])`);
    const two=run(`_boardsCardCtxItems(true).map(i=>i.label||'').join('|')`);
    s.ok('but distribute is hidden on only two cards',two.indexOf('Distribute')<0);
  }

  // ── the QA round (Sept 2026) ──────────────────────────────────────────
  // Eight findings from Afnan's exhaustive pass over a real board. Several
  // were regressions from the click/double-click change: card bodies now
  // ship contenteditable="false", and four actions were still calling a
  // bare el.focus(), which on a non-editable node does nothing at all —
  // the field appeared, you could not type, and nothing saved.
  {
    const app=loadApp({files:FILES});
    const {run}=app;
    function board(){
      run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'}`);
      run(`_editConnectors=[];_boardsSelection=new Set()`);
    }

    s.section('rename / caption / heading open EDIT mode, not just focus');
    // A bare focus() is the bug. These must reach boardsBeginEdit, which is
    // the only thing that makes an element typeable.
    const src=require('fs').readFileSync(require('path').join(__dirname,'..','js/boards.js'),'utf8');
    const ctx=src.slice(src.indexOf('function _boardsCtxRun'));
    ['board-cap-','board-name-'].forEach(id=>{
      const near=ctx.slice(0,ctx.indexOf('\n}\n'));
      s.ok("'"+id+"' is opened with boardsBeginEdit",
        new RegExp("boardsBeginEdit\\(null,'"+id).test(near));
    });
    s.ok('and no action focuses a caption without opening it',
      !/getElementById\('board-cap-'\+c\.id\);\s*\n\s*if\(el\)el\.focus\(\)/.test(src));

    // End to end: open the caption editor and check the element really is
    // editable afterwards, which is what "the text saves" depends on.
    board();
    run(`_editCards=[{id:'a',type:'image',x:0,y:0,w:200,h:200,imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',caption:''}]`);
    run(`_boardsSelection=new Set(['a'])`);
    run(`document.getElementById('main-content').innerHTML=_boardCardHTML(_editCards[0],true)`);
    run(`_boardsCtxRun('caption')`);
    s.eq('the caption element is editable after the action',
      app.el('board-cap-a').getAttribute('contenteditable'),'true');
    run(`window.boardsCaptionInput('a',{textContent:'Front print, 2026'})`);
    s.eq('and typing into it reaches the card',run(`_editCards[0].caption`),'Front print, 2026');

    s.section('the Board tool creates a REAL board, never a dead reference');
    board();
    run(`_editCards=[]`);
    run(`window.boardsAddChildBoard=function(){globalThis.__child=(globalThis.__child||0)+1;}`);
    run(`window.boardsAddCard('board')`);
    s.eq('it calls the real sub-board creator',run(`__child||0`),1);
    s.eq('and mints no orphan card',run(`_editCards.length`),0);
    // Every other type still adds a card directly.
    run(`window.boardsAddCard('text')`);
    s.eq('a note still adds normally',run(`_editCards.length`),1);

    s.section('line mode does not survive leaving a board');
    run(`_boardsLineMode=true`);
    const resets=/_boardsMenuOpen=false;[\s\S]{0,400}?_boardsLineMode=false;/.test(src);
    s.ok('it is reset beside the other per-opening state',resets);

    s.section('a drag that moved swallows the click it ends with');
    // A file card's body is an <a href>, so the click a drag ends with
    // opened the raw PDF in a new tab. Drive the real document-level
    // capture listener rather than grepping for it.
    const clickers=app.state.listeners['click']||[];
    function docClick(){
      let prevented=false;
      clickers.forEach(fn=>{try{fn({preventDefault(){prevented=true;},
        stopPropagation(){},target:null});}catch(e){}});
      return prevented;
    }
    s.ok('a plain click is left alone',!docClick());
    run(`_boardsSuppressClick=true`);
    s.ok('the click right after a drag is swallowed',docClick());
    s.ok('and only that one — the next click works again',!docClick());
    s.ok('it is armed by a drag that moved, not by every pointerdown',
      /if\(pushed\)_boardsSuppressClick=true;/.test(src));

    s.section('double-clicking a header opens that card type\'s editable');
    board();
    run(`_editCards=[{id:'h',type:'heading',x:0,y:0,w:300,h:60},{id:'i',type:'image',x:0,y:0,w:200,h:200}]`);
    run(`window.boardsBeginEdit=function(ev,id){globalThis.__opened=id;}`);
    run(`window.boardsHeadDblClick(null,'h')`);
    s.eq('a heading opens its banner text',run(`__opened`),'board-txt-h');
    run(`window.boardsHeadDblClick(null,'i')`);
    s.eq('an image opens its name',run(`__opened`),'board-name-i');
    run(`_editCards[1].locked=true;globalThis.__opened=null`);
    run(`window.boardsHeadDblClick(null,'i')`);
    s.eq('a locked card opens nothing',run(`__opened`),null);

    s.section('new cards never land exactly on an existing one');
    // The cascade repeats every 6, so the 7th card used to land exactly on
    // the 1st. Place a real card at each point so the next call has to
    // dodge what is already there.
    board();
    run(`_editCards=[];_boardsAddCascade=0`);
    const pts=[];
    for(let i=0;i<12;i++){
      const p=run(`_boardsPlacementPoint()`);
      pts.push(Math.round(p.x)+','+Math.round(p.y));
      run(`_editCards.push({id:'c'+${i},type:'text',w:180,h:120,`+
          `x:${JSON.stringify(0)},y:0})`);
      run(`_editCards[_editCards.length-1].x=${JSON.stringify(p.x)}`);
      run(`_editCards[_editCards.length-1].y=${JSON.stringify(p.y)}`);
    }
    s.eq('twelve cards, twelve distinct spots',new Set(pts).size,12,
      JSON.stringify(pts.slice(0,5)));

  }

  return s;
};

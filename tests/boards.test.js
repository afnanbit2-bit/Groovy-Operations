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
    s.eq('and never goes below the 5% floor',run(`_boardsPinchZoom(__p,0.01)`),0.05);

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

  // ── the second QA round: three things reported as STILL broken ────────
  // Each of these was reported twice. They are cheap to assert and each one
  // was invisible to every existing suite, which is exactly why they came
  // back from a human instead of from CI.
  {
    const app=loadApp({files:FILES});
    const {run}=app;
    run(`_editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
         _editConnectors=[];_boardsPeers=[];_boardsSelection=new Set();
         moodBoards=[{id:'CHILD',title:'Child',cards:[],visibility:'shared',ownerUid:'u1'}];`);

    s.section('labels and reactions grow the card instead of eating the body');
    run(`_editCards=[{id:'k',type:'board',boardId:'CHILD',x:0,y:0,w:200,h:104}]`);
    const bare=run(`_boardsMinCardH(_editCards[0])`);
    run(`_editCards[0].labels=[{t:'QA-LABEL',c:'grey'}];_editCards[0].reactions={'👍':['u2']}`);
    const dressed=run(`_boardsMinCardH(_editCards[0])`);
    s.ok('a label and a reaction raise the minimum',dressed>bare,bare+' → '+dressed);
    s.ok('past the 104px default a sub-board card ships with',dressed>104,String(dressed));
    const html=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('and the card is DRAWN at the bigger height, with no write',
      new RegExp('height:'+dressed+'px').test(html),String(dressed));
    run(`window.boardsToggleReaction('k','🔥')`);
    s.ok('reacting also raises the stored height',run(`_editCards[0].h`)>=dressed);

    s.section('an orphan sub-board card can be repaired, not just deleted');
    run(`_editCards=[{id:'o',type:'board',boardId:'',x:0,y:0,w:200,h:104}]`);
    const orphan=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('it offers to create the board',/boardsRepairBoardCard\('o'\)/.test(orphan));
    s.ok('and no longer renders a dead "Missing board" line',!/Missing board/.test(orphan));
    run(`_editCards=[{id:'g',type:'board',boardId:'GONE',x:0,y:0,w:200,h:104}]`);
    const gone=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('a link to something unreadable says WHY',/private to someone else/.test(gone));
    s.ok('and does not offer an Open button that cannot work',!/boardsGoto/.test(gone));
    run(`_editCards=[{id:'l',type:'board',boardId:'CHILD',x:0,y:0,w:200,h:104}]`);
    s.ok('a real link still opens',/boardsGoto\('CHILD'\)/.test(run(`_boardCardHTML(_editCards[0],true)`)));

    s.section('a caption opens on ONE click');
    // Reported twice as "the caption does not save". It always saved — the
    // field was contenteditable="false" and only a double-click switched it
    // on, so no keystroke ever reached it.
    run(`_editCards=[{id:'i',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',caption:'',x:0,y:0,w:200,h:160}]`);
    const cap=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('single click begins edit',/onclick="window\.boardsBeginEdit\(event,'board-cap-i'\)"/.test(cap));
    s.ok('double click still does too',/ondblclick="window\.boardsBeginEdit\(event,'board-cap-i'\)"/.test(cap));

    s.section('a file card carries Open and Download on the card itself');
    run(`_editCards=[{id:'f',type:'file',fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/t.pdf',fileName:'t.pdf',fileSize:10,x:0,y:0,w:200,h:140}]`);
    const fc=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('Open is a real button',/boardsFileOpen\('f'\)/.test(fc));
    s.ok('Download is a real button',/boardsFileDownload\('f'\)/.test(fc));
    // The delete ✕ was inert for weeks because its pointerdown reached the
    // drag handle and the click was retargeted away. A file card's BODY is
    // a drag handle, so these two need the same guard.
    const acts=fc.slice(fc.indexOf('board-file-actions'));
    s.eq('both stop pointerdown reaching the drag handle',
      (acts.match(/onpointerdown="event\.stopPropagation\(\)"/g)||[]).length,2);
    s.ok('and the anchor no longer wraps them (invalid, and it would win the click)',
      fc.indexOf('board-file-actions')>fc.indexOf('</a>'));

    s.section('Fit and 100% are one context-aware button');
    const bar=run(`_renderBoardCanvasHTML()`);
    s.eq('one button, not two',(bar.match(/id="board-fit-btn"/g)||[]).length,1);
    s.ok('it routes through the toggle',/boardsToggleFit\(\)/.test(bar));
    s.ok('and boardsResetView is no longer a top-bar button of its own',
      !/class="tool-btn" onclick="window\.boardsResetView\(\)"/.test(bar));
  }

  // ── Home is a board ───────────────────────────────────────────────────
  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      boardsLoaded=true;_boardsTrash=[];_editConnectors=[];_boardsSelection=new Set();
      moodBoards=[
        {id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],createdAt:20},
        {id:'H2',isHome:true,ownerUid:'u1',title:'Home',cards:[],createdAt:10},
        {id:'A',title:'Winter Drop',ownerUid:'u1',visibility:'shared',cards:[],updatedAt:5},
        {id:'B',title:'Fabric refs',ownerUid:'u2',visibility:'shared',cards:[],updatedAt:9},
        {id:'SUB',title:'Nested',ownerUid:'u1',visibility:'shared',parentId:'A',cards:[],updatedAt:1}
      ];
      moodBoards[2].cards=[{id:'link',type:'board',boardId:'SUB',x:0,y:0,w:200,h:104}];`);

    s.section('one Home per person, chosen deterministically');
    s.eq('the oldest wins, so two tabs agree',run(`_boardsMyHome().id`),'H2');
    s.ok('and it knows a home when it sees one',run(`_boardsIsHome({isHome:true})`)===true);

    s.section('auto-place puts every unplaced board on Home');
    run(`_editBoard={id:'H2',isHome:true,ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};_editCards=[]`);
    const n=run(`_boardsHomeAutoPlace()`);
    s.eq('two root boards placed',n,2);
    s.eq('and NOT the nested one, nor any Home',
      run(`_editCards.map(c=>c.boardId).sort().join(',')`),'A,B');
    s.eq('running it again places nothing',run(`_boardsHomeAutoPlace()`),0);
    s.ok('cards are laid out apart from each other',
      run(`_editCards[0].x!==_editCards[1].x||_editCards[0].y!==_editCards[1].y`));

    s.section('a board nested under a real parent still lists at root elsewhere');
    // Placing a board on Home must NOT make it "nested" — otherwise every
    // board would vanish from All boards the moment Home picked it up.
    s.ok('SUB is nested, A and B are not',
      run(`(n=>n.has('SUB')&&!n.has('A')&&!n.has('B'))(_boardsNestedIds())`));

    s.section('Home reconciles itself on open');
    run(`_editCards=[
      {id:'c1',type:'board',boardId:'A',x:0,y:0,w:200,h:124},
      {id:'c2',type:'board',boardId:'A',x:300,y:0,w:200,h:124},
      {id:'c3',type:'board',boardId:'B',x:0,y:200,w:200,h:124}];
      _editConnectors=[{from:'c2',to:'c3'}]`);
    s.eq('a duplicate card for one board is collapsed',run(`_boardsHomeDedupe()`),1);
    s.eq('keeping the first',run(`_editCards.map(c=>c.id).join(',')`),'c1,c3');
    s.eq('and dropping connectors that pointed at the removed card',run(`_editConnectors.length`),0);
    run(`_boardsTrash=[{id:'B',title:'Fabric refs',deletedAt:1}];moodBoards=moodBoards.filter(b=>b.id!=='B')`);
    s.eq('a trashed board loses its card',run(`_boardsHomePruneTrashed()`),1);
    s.eq('leaving the rest alone',run(`_editCards.map(c=>c.boardId).join(',')`),'A');
    // The safety rule: a board merely MISSING from moodBoards (one of the
    // three loadBoardsData queries failed) must never be pruned, or a
    // partial load would empty somebody's Home.
    run(`_boardsTrash=[];moodBoards=moodBoards.filter(b=>b.id!=='A')`);
    s.eq('but a board that is merely absent is kept',run(`_boardsHomePruneTrashed()`),0);
    s.eq('the card survives a partial load',run(`_editCards.length`),1);
  }

  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};boardsLoaded=true;_boardsTrash=[];
      moodBoards=[
        {id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'},
        {id:'HX',isHome:true,ownerUid:'u9',title:'Home',cards:[],visibility:'personal'},
        {id:'A',title:'Winter Drop',ownerUid:'u1',visibility:'shared',cards:[]}
      ];`);
    s.section('All boards never lists a Home');
    const g=run(`renderBoardsGallery()`);
    s.ok('the real board is there',/Winter Drop/.test(g));
    s.ok('neither Home is',!/>Home</.test(g.replace(/← Home/g,'')));
    s.ok('and it leads back to Home',/showPage\('boards'\)/.test(g));
    s.ok('opening from here remembers where you came from',/boardsOpenFromAll/.test(g));

    s.section('the Home top bar drops what makes no sense on it');
    run(`_editBoard={id:'H',isHome:true,ownerUid:'u1',visibility:'personal',title:'Home',zoom:1,panX:0,panY:0};
         _editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsPeers=[]`);
    const hb=run(`_renderBoardCanvasHTML()`);
    s.ok('no delete',!/boardsDelete\(\)/.test(hb));
    s.ok('no template, no share, no visibility toggle',
      !/boardsToggleTemplate/.test(hb)&&!/boardsOpenShare/.test(hb)&&!/boardsToggleVisibility/.test(hb));
    s.ok('no rename field — Home is not a title you edit',!/board-title-input/.test(hb));
    s.ok('but All boards is reachable',/boardsShowAll\(\)/.test(hb));
    s.ok('and back leaves the module',/← Creative Hub/.test(hb));
    run(`_editBoard={id:'A',ownerUid:'u1',visibility:'shared',title:'Winter Drop',zoom:1,panX:0,panY:0}`);
    const nb=run(`_renderBoardCanvasHTML()`);
    s.ok('an ordinary board keeps all of it',
      /boardsDelete\(\)/.test(nb)&&/board-title-input/.test(nb)&&/boardsToggleVisibility/.test(nb));
    s.ok('and its back button points at Home',/← Home/.test(nb));
  }

  // ── attachments: preview and download ─────────────────────────────────
  {
    const {run}=loadApp({files:FILES});
    s.section('a download is saved under the CARD name, like Milanote');
    const N=c=>run(`_boardsSaveNameFor(${JSON.stringify(c)})`);
    s.eq('card name wins over the upload id',
      N({name:'Shibuya Chino Pants - Olive',fileName:'hsvx821oewbdnjei3bvi.pdf'}),
      'Shibuya Chino Pants - Olive.pdf');
    s.eq('no card name falls back to the original',
      N({fileName:'winter-techpack-v4.pdf'}),'winter-techpack-v4.pdf');
    s.eq('characters Windows refuses are stripped',
      N({name:'PO/077: draft?',fileName:'a.pdf'}),'PO 077 draft.pdf');
    s.eq('the extension comes off the URL when there is no filename',
      N({fileUrl:'https://res.cloudinary.com/x/image/upload/v1/abc.PDF'}),'file.pdf');

    s.section('a refused asset says what to do about it');
    const E=(r,pdf)=>run(`_boardsAssetErrorText(${JSON.stringify(r)},${pdf})`);
    s.ok('401 on a PDF names the Cloudinary setting',/Allow delivery of PDF and ZIP files/.test(E({status:401},true)));
    s.ok('and says the thumbnail still working is not a contradiction',/served as an image/.test(E({status:403},true)));
    s.ok('a non-PDF 401 does not claim that',!/PDF and ZIP/.test(E({status:401},false)));
    s.ok('a network failure mentions offline',/offline/.test(E({err:'Failed to fetch'},false)));

    s.section('one preview path for every card type that has an asset');
    s.eq('an image card exposes its URL as fileUrl',
      run(`_boardsPreviewCard({type:'image',imageUrl:'https://x/y/a.png'}).fileUrl`),'https://x/y/a.png');
    s.eq('and gets a filename from the URL',
      run(`_boardsPreviewCard({type:'image',imageUrl:'https://x/y/a.png'}).fileName`),'a.png');
    s.eq('a file card is unchanged',
      run(`_boardsPreviewCard({type:'file',fileUrl:'https://x/y/b.pdf',fileName:'b.pdf'}).fileUrl`),'https://x/y/b.pdf');
  }

  // ── columns: the one real container ───────────────────────────────────
  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    const boot=()=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      _editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();_boardsPeers=[];moodBoards=[];boardsLoaded=true;
      _editCards=[
        {id:'col',type:'column',title:'Fabric',x:100,y:100,w:280,h:160},
        {id:'a',type:'text',text:'one',x:0,y:0,w:170,h:100,columnId:'col'},
        {id:'b',type:'text',text:'two',x:0,y:0,w:200,h:120,columnId:'col'},
        {id:'free',type:'text',text:'loose',x:800,y:800,w:170,h:100}
      ];_boardsLayoutColumns();`);
    boot();

    s.section('membership is stored on the CHILD, never on the column');
    // An items:[] array on the column would lose an insert under the
    // Stage 6 per-card merge; a columnId per child cannot.
    s.ok('the column carries no membership field',
      run(`_editCards[0].items===undefined&&_editCards[0].cards===undefined`));
    s.eq('children are found by columnId',run(`_boardsColumnChildren(_editCards[0]).map(c=>c.id).join(',')`),'a,b');

    s.section('layout derives position, width and the column height');
    s.eq('children share the column x',run(`_editCards[1].x+','+_editCards[2].x`),'112,112');
    s.eq('and are stacked in order',run(`_editCards[1].y+','+_editCards[2].y`),'142,252');
    s.eq('width comes from the column, not the card',run(`_editCards[1].w+','+_editCards[2].w`),'256,256');
    s.eq('height is derived from the contents',run(`_editCards[0].h`),284);
    // Idempotence is load-bearing: opening a board must not mark every
    // card as locally changed and trigger a write for a correct layout.
    s.eq('running layout again changes nothing',run(`_boardsLayoutColumns()`),false);

    s.section('order is derived from y, so a merge needs no order field');
    run(`_editCards[2].y=110`);   // as if dropped above 'a'
    run(`_boardsLayoutColumns()`);
    s.eq('the moved card is first now',run(`_boardsColumnChildren(_editCards[0]).map(c=>c.id).join(',')`),'b,a');
    run(`_editCards[1].y=_editCards[2].y`);
    s.eq('a y tie still orders deterministically',
      run(`_boardsColumnChildren(_editCards[0]).map(c=>c.id).join(',')`),'a,b');

    s.section('a stale columnId is inert, never a lost card');
    boot();
    run(`_editCards.push({id:'ghost',type:'text',text:'x',x:5,y:5,w:170,h:100,columnId:'gone'})`);
    s.eq('it belongs to no column',run(`_boardsColumnOf(_editCards[4])===null`),true);
    s.eq('and it is not dragged into anybody else',run(`_boardsColumnChildren(_editCards[0]).length`),2);
    s.eq('layout leaves it exactly where it is',run(`(_boardsLayoutColumns(),_editCards[4].x+','+_editCards[4].y)`),'5,5');

    s.section('deleting a column RELEASES its cards');
    boot();
    run(`window.boardsDeleteCard('col')`);
    s.eq('the column is gone',run(`_editCards.filter(c=>c.type==='column').length`),0);
    s.eq('both cards survive',run(`_editCards.filter(c=>c.id==='a'||c.id==='b').length`),2);
    s.ok('and carry no dangling membership',run(`_editCards.every(c=>c.columnId===undefined)`));

    s.section('deleting a SELECTION containing a column releases too');
    boot();
    run(`_boardsSetSelection(['col'])`);
    run(`window.boardsDeleteSelection()`);
    s.eq('cards kept',run(`_editCards.filter(c=>c.id==='a'||c.id==='b').length`),2);
    s.ok('membership cleared',run(`_editCards.every(c=>c.columnId===undefined)`));

    s.section('and there is a separate, confirmed way to delete both');
    boot();
    run(`_boardsSetSelection(['col'])`);
    run(`window.boardsDeleteColumnAndCards()`);   // harness confirm() returns true
    s.eq('column and children all gone',run(`_editCards.map(c=>c.id).join(',')`),'free');

    s.section('Group into Column builds a real container');
    boot();
    run(`_editCards=[
      {id:'x',type:'text',text:'1',x:300,y:400,w:170,h:100},
      {id:'y',type:'text',text:'2',x:320,y:200,w:210,h:80}
    ];_boardsSelection=new Set(['x','y']);`);
    run(`window.boardsStackSelection()`);
    const col=run(`_editCards.find(c=>c.type==='column')`);
    s.ok('a column card was created',!!col);
    s.eq('holding both, top-to-bottom by where they were',
      run(`_boardsColumnChildren(_editCards.find(c=>c.type==='column')).map(c=>c.id).join(',')`),'y,x');
    s.eq('the column is wide enough for the widest card',
      run(`_editCards.find(c=>c.type==='column').w`),210+24);

    s.section('a container never nests inside another container');
    boot();
    s.eq('a column is not a drop target for itself',
      run(`_boardsColumnAt(200,200,new Set(['col']))===null`),true);
    s.eq('and columns/frames are never drop candidates',
      run(`_boardsDropTargets([_editCards[0],{id:'f',type:'frame',x:0,y:0,w:10,h:10}],new Set()).length`),0);

    s.section('moving a column does NOT tip its cards out');
    // The bug this guards: the children travel WITH the column, so their
    // own column is in movingCols and therefore not a valid target — read
    // naively that is "dropped on empty canvas", and every card falls out.
    boot();
    s.eq('children travelling with their column are not re-homed',
      run(`_boardsDropTargets(_editCards.filter(c=>c.columnId==='col'),new Set(['col'])).length`),0);
    s.eq('but a loose card still is',
      run(`_boardsDropTargets([_editCards[3]],new Set(['col'])).length`),1);

    s.section('a card dropped on a column joins it at the slot it landed in');
    boot();
    const drop=run(`(()=>{
      const f=_editCards[3];
      f.x=150;f.y=240;   // between the two children
      const d=_boardsDropTargets([f],new Set())[0];
      return d.col.id+'|'+d.slot.index;
    })()`);
    s.eq('target column and index',drop,'col|1');

    s.section('duplicating a column copies what is inside it');
    boot();
    const dup=run(`JSON.stringify((()=>{
      const p=_boardsDuplicatePayload([_editCards[0]],[]);
      const nc=p.cards.find(c=>c.type==='column');
      return{n:p.cards.length,kids:p.cards.filter(c=>c.columnId===nc.id).length,
             stale:p.cards.filter(c=>c.columnId&&c.columnId==='col').length};
    })())`);
    s.eq('three cards, two of them children, none pointing at the original',
      dup,'{"n":3,"kids":2,"stale":0}');
    const orphan=run(`JSON.stringify((()=>{
      const p=_boardsDuplicatePayload([_editCards[1]],[]);
      return p.cards.map(c=>c.columnId===undefined);
    })())`);
    s.eq('copying a child alone frees the copy',orphan,'[true]');

    s.section('the menu offers the container actions, and only on a column');
    boot();
    run(`_boardsSetSelection(['col'])`);
    const m=run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act||'').filter(Boolean))`);
    s.ok('ungroup',/col-release/.test(m));
    s.ok('delete both, marked dangerous',/col-delete-all/.test(m));
    s.ok('select contents',/selectinside/.test(m));
    s.ok('a column is never stashable to Unsorted',!/stash/.test(m));
    run(`_boardsSetSelection(['a'])`);
    const m2=run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act||'').filter(Boolean))`);
    s.ok('a child can be taken out',/col-out/.test(m2));
    run(`_boardsSetSelection(['free'])`);
    s.ok('a loose card cannot',
      !/col-out/.test(run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act||''))`)));

    s.section('select contents reads membership, not geometry');
    boot();
    run(`_boardsSetSelection(['col']);_boardsCtxRun('selectinside')`);
    s.eq('exactly the children',run(`[..._boardsSelection].sort().join(',')`),'a,b');

    s.section('columns paint behind their children');
    s.eq('render order puts the column before its cards',
      run(`_boardsRenderOrder().map(c=>c.id).join(',')`),'col,a,b,free');
  }

  // ── connectors: selectable, styleable, curved ──────────────────────────
  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    const boot=()=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      _editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
      _boardsSelection=new Set();_boardsPeers=[];moodBoards=[];_boardsConnSel=null;
      _editCards=[
        {id:'a',type:'text',text:'1',x:0,y:0,w:100,h:100},
        {id:'b',type:'text',text:'2',x:200,y:200,w:100,h:100}
      ];
      _editConnectors=[{id:'L1',from:'a',to:'b',arrow:true},
                       {free:true,x1:0,y1:0,x2:100,y2:0}];`);
    boot();

    s.section('older connectors are given ids without dirtying the board');
    run(`_boardsConnEnsureIds()`);
    s.ok('the one with no id now has one',run(`!!_editConnectors[1].id`));
    s.eq('the one that had an id keeps it',run(`_editConnectors[0].id`),'L1');
    // The ids are minted BEFORE _boardsConnBase is taken on open, so this
    // migration never makes an untouched board look changed.
    run(`_boardsConnBase=JSON.stringify(_editConnectors)`);
    s.eq('and the board is not dirty afterwards',run(`_boardsConnDirty()`),false);

    s.section('geometry: straight by default, quadratic when bent');
    const g=run(`JSON.stringify((g=>({d:g.d,bent:g.bent}))(_boardsConnGeom(_editConnectors[0])))`);
    s.eq('a straight line is a plain L path',g,'{"d":"M 50 50 L 250 250","bent":false}');
    run(`_editConnectors[0].bx=20;_editConnectors[0].by=-40`);
    const c=run(`JSON.stringify((g=>({apex:g.apex,ctrl:g.ctrl,bent:g.bent}))(_boardsConnGeom(_editConnectors[0])))`);
    // The stored bend is the APEX offset, so the handle sits exactly where
    // the curve is; the control point is derived as mid + 2·offset,
    // because for a quadratic the apex is .25p1 + .5c + .25p2.
    s.eq('apex is mid + the stored offset, control is mid + twice it',c,
      '{"apex":{"x":170,"y":110},"ctrl":{"x":190,"y":70},"bent":true}');
    s.ok('and the path is a Q curve',/^M 50 50 Q 190 70 250 250$/.test(
      run(`_boardsConnGeom(_editConnectors[0]).d`)));

    s.section('a bend is an OFFSET, so it survives the cards moving');
    run(`_editCards[1].x=600;_editCards[1].y=600`);
    s.eq('the bend is still the same offset from the new midpoint',
      run(`JSON.stringify(_boardsConnGeom(_editConnectors[0]).apex)`),
      '{"x":370,"y":310}');

    s.section('selection is by id, so a delete that shifts indices is safe');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn(_editConnectors[1].id)`);
    const keep=run(`_boardsConnSel`);
    run(`window.boardsDeleteConnector('L1')`);
    s.eq('the other line is still the selected one',run(`_boardsConnSel`),keep);
    s.eq('and only one was removed',run(`_editConnectors.length`),1);

    s.section('card selection and line selection are mutually exclusive');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn('L1')`);
    s.eq('selecting a line clears the cards',run(`_boardsSelection.size`),0);
    run(`_boardsSelectCard('a',false)`);
    s.eq('selecting a card clears the line',run(`_boardsConnSel===null`),true);

    s.section('the line rail and the right-click menu offer the same actions');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn('L1')`);
    const rail=run(`JSON.stringify(_boardsRailItems().map(i=>i.act||(i.connSwatches?'swatches':'sep')))`);
    const menu=run(`JSON.stringify(_boardsConnItems(_boardsConnById('L1'),true).map(i=>i.act||(i.connSwatches?'swatches':i.sep?'sep':'title')))`);
    ['ln:arrow','ln:arrowStart','ln:dash','ln:label','ln:delete'].forEach(a=>{
      s.ok(a+' in both',rail.indexOf(a)>-1&&menu.indexOf(a)>-1);
    });
    s.ok('both offer a colour row',/swatches/.test(rail)&&/swatches/.test(menu));

    s.section('every line action routes through one place');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn('L1')`);
    run(`_boardsCtxRun('ln:dash')`);
    s.eq('dashed on',run(`_editConnectors[0].dash`),true);
    run(`_boardsCtxRun('ln:dash')`);
    s.eq('and off again drops the field',run(`_editConnectors[0].dash===undefined`),true);
    run(`_boardsCtxRun('ln:w:thick')`);
    s.eq('weight set',run(`_editConnectors[0].weight`),'thick');
    run(`_boardsCtxRun('ln:c:red')`);
    s.eq('colour set',run(`_editConnectors[0].color`),'red');
    run(`_boardsCtxRun('ln:c:none')`);
    s.eq('"none" removes it rather than storing a word',run(`_editConnectors[0].color===undefined`),true);
    run(`_editConnectors[0].bx=10;_editConnectors[0].by=10;_boardsCtxRun('ln:straight')`);
    s.eq('straighten clears the bend',
      run(`_editConnectors[0].bx===undefined&&_editConnectors[0].by===undefined`),true);

    s.section('a stroke colour never reaches the DOM unvalidated');
    // The palette is a fixed name list mapped to CSS variables — a stored
    // value that is not in it falls back rather than being written into a
    // style attribute.
    s.ok('a known name maps to a variable',
      /^var\(--accent-urgent\)$/.test(run(`_boardsConnStroke({color:'red'})`)));
    s.ok('anything else does not',
      !/url|expression|;/.test(run(`_boardsConnStroke({color:'red;background:url(x)'})`)));

    s.section('duplicating a connector detaches it so the copy is visible');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn('L1');window.boardsDuplicateConnector('L1')`);
    s.eq('there are three now',run(`_editConnectors.length`),3);
    const dup=run(`JSON.stringify((c=>({free:!!c.free,from:c.from,sameId:c.id==='L1'}))(_editConnectors[2]))`);
    s.eq('the copy is freeform, offset, and has its own id',dup,'{"free":true,"sameId":false}');

    s.section('a label is rendered as structure, never interpolated');
    // Same stored-XSS boundary as card text, to-do items and comments: the
    // <text> node is emitted EMPTY and filled with textContent afterwards.
    // Driven through the real renderer — the harness's svg stub records
    // what was written to innerHTML, and its querySelector returns null, so
    // the hydration pass is a no-op and whatever is left is exactly what
    // the markup builder produced.
    boot();
    run(`_boardsConnEnsureIds();_editConnectors[0].label='<img src=x onerror=alert(1)>'`);
    run(`_boardsDrawConnectors()`);
    const markup=app.el('board-conn-layer').innerHTML;
    s.ok('a <text> node was emitted for the label',/<text class="conn-label"/.test(markup));
    s.ok('carrying none of the label text',!/img src|onerror|alert/.test(markup));
    s.ok('and the hit path is emitted BEFORE the visible one',
      markup.indexOf('conn-hit')<markup.indexOf('class="conn"'));
  }

  // ── tables, reading order, the document export and Presentation ───────
  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    const boot=()=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      _editBoard={id:'B',title:'Winter Drop',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
      _editConnectors=[];_boardsSelection=new Set();_boardsConnSel=null;_boardsPeers=[];
      moodBoards=[{id:'CH',title:'Child board',cards:[
        {id:'ct',type:'text',text:'inside the child',x:0,y:0,w:170,h:100}],visibility:'shared',ownerUid:'u1'}];
      _editCards=[];`);

    s.section('a table is rows[][] of plain strings');
    boot();
    run(`window.boardsAddCard('table')`);
    // 3 x 4 and empty, per the spec. No prefilled "Column A" header row:
    // the A/B/C band labels the columns now, and two labellings of the same
    // thing would disagree the moment someone renamed one.
    s.eq('three columns by four rows, empty',
      run(`_editCards[0].rows.length+'x'+_editCards[0].rows[0].length`),'4x3');
    s.ok('with nothing in them',run(`_editCards[0].rows.every(r=>r.every(v=>v===''))`));
    s.eq('and no header row by default',run(`_editCards[0].head`),false);
    run(`window.boardsTableAdd(_editCards[0].id,'row')`);
    s.eq('adding a row matches the column count',run(`_editCards[0].rows.length+'x'+_editCards[0].rows[4].length`),'5x3');
    run(`window.boardsTableAdd(_editCards[0].id,'col')`);
    s.eq('adding a column widens every row',
      run(`_editCards[0].rows.every(r=>r.length===4)`),true);
    // A table that grows needs the room, or the new row is drawn outside
    // the card and clipped — the bug the label rows caused on small cards.
    s.ok('and the card grew to fit',run(`_editCards[0].h>=_boardsTableMinH(_editCards[0])`));
    run(`_editCards[0].head=true;
         while(_editCards[0].rows.length>2)window.boardsTableDrop(_editCards[0].id,'row')`);
    run(`window.boardsTableDrop(_editCards[0].id,'row')`);
    s.eq('a header table never drops below the header plus one row',run(`_editCards[0].rows.length`),2);
    run(`while(_editCards[0].rows[0].length>1)window.boardsTableDrop(_editCards[0].id,'col');
         window.boardsTableDrop(_editCards[0].id,'col')`);
    s.eq('and never below one column',run(`_editCards[0].rows[0].length`),1);
    run(`_editCards[0].rows=[['Fabric','GSM'],['Drill','245']]`);
    s.ok('cell text is searchable',/245/.test(run(`_boardsCardText(_editCards[0])`)));
    s.ok('the markup carries no cell text — hydrated after, like every other string',
      !/Fabric|245/.test(run(`_boardCardHTML(_editCards[0],true)`)));

    s.section('reading order: frames first, then rows left-to-right');
    boot();
    run(`_editCards=[
      {id:'loose',type:'text',text:'z',x:900,y:900,w:100,h:60},
      {id:'f',type:'frame',title:'Bottoms',x:0,y:0,w:400,h:300},
      {id:'r1b',type:'text',text:'b',x:200,y:40,w:100,h:60},
      {id:'r1a',type:'text',text:'a',x:20,y:50,w:100,h:60},
      {id:'r2',type:'text',text:'c',x:20,y:200,w:100,h:60}
    ]`);
    s.eq('frame, then its cards banded by y and sorted by x, then the rest',
      run(`_boardsReadingOrder().map(c=>c.id).join(',')`),'f,r1a,r1b,r2,loose');
    // Plain y-sorting would read a row of cards as separate rows; the band
    // is generous because nobody aligns to the pixel.
    s.ok('a 10px difference in y does not break the row',
      run(`_boardsReadingOrder().map(c=>c.id).join(',')`).indexOf('r1a,r1b')>-1);

    s.section('a column is emitted whole, in its own order');
    boot();
    run(`_editCards=[
      {id:'col',type:'column',title:'Fabric',x:0,y:0,w:280,h:200},
      {id:'k2',type:'text',text:'2',x:12,y:150,w:256,h:60,columnId:'col'},
      {id:'k1',type:'text',text:'1',x:12,y:60,w:256,h:60,columnId:'col'},
      {id:'other',type:'text',text:'x',x:600,y:20,w:100,h:60}
    ];_boardsLayoutColumns()`);
    s.eq('the column, then its children in order, then the rest',
      run(`_boardsReadingOrder().map(c=>c.id).join(',')`),'col,k1,k2,other');

    s.section('the document export walks that same order');
    boot();
    run(`_editCards=[
      {id:'h',type:'heading',text:'Bottoms',x:0,y:0,w:440,h:58},
      {id:'n',type:'text',text:'Confirm the wash',name:'Note',x:0,y:120,w:200,h:100},
      {id:'t',type:'todo',items:[{text:'Lab dip',done:true},{text:'Bulk',done:false}],x:0,y:240,w:240,h:170},
      {id:'tb',type:'table',head:true,rows:[['Fabric','GSM'],['Drill','245']],x:0,y:400,w:360,h:150},
      {id:'sb',type:'board',boardId:'CH',boardTitle:'Child board',x:0,y:560,w:200,h:104}
    ]`);
    const md=run(`_boardsBuildDoc(false).md`);
    s.ok('the board title is the H1',/^# Winter Drop/.test(md));
    s.ok('a heading card becomes an H2',/\n## Bottoms/.test(md));
    s.ok('a to-do becomes a checklist with its state',/- \[x\] Lab dip/.test(md)&&/- \[ \] Bulk/.test(md));
    s.ok('a table becomes a markdown table with a separator row',
      /\| Fabric \| GSM \|/.test(md)&&/\| --- \| --- \|/.test(md));
    s.ok('a note keeps its card name in bold',/\*\*Note\*\*/.test(md));
    s.ok('a sub-board is named but says it was left out',/Child board/.test(md)&&/not included/.test(md));
    const withSubs=run(`_boardsBuildDoc(true).md`);
    s.ok('including sub-boards pulls the child cards in',/inside the child/.test(withSubs));
    s.eq('and the canvas is left pointing at its OWN cards afterwards',
      run(`_editCards.length`),5);

    s.section('the Word file is HTML, and it escapes what it interpolates');
    boot();
    run(`_editCards=[{id:'x',type:'text',text:'<img src=x onerror=alert(1)>',x:0,y:0,w:200,h:100}]`);
    const doc=run(`_boardsBuildDoc(false)`);
    s.ok('it is a Word-openable HTML document',/schemas-microsoft-com:office:word/.test(doc.html));
    s.ok('with the card text escaped',/&lt;img/.test(doc.html)&&!/<img src=x/.test(doc.html));

    s.section('Presentation skips what has nothing to show');
    boot();
    run(`_editCards=[
      {id:'h',type:'heading',text:'Bottoms',x:0,y:0,w:440,h:58},
      {id:'empty',type:'text',text:'   ',x:0,y:120,w:200,h:100},
      {id:'noimg',type:'image',x:0,y:240,w:170,h:120},
      {id:'real',type:'text',text:'Confirm the wash',x:0,y:360,w:200,h:100},
      {id:'emptytodo',type:'todo',items:[{text:'',done:false}],x:0,y:480,w:240,h:170}
    ]`);
    s.eq('a blank note, an unfilled image card and an empty to-do are all skipped',
      run(`_boardsPresentable().map(c=>c.id).join(',')`),'h,real');
    s.eq('and it presents in reading order',
      run(`_boardsPresentable()[0].id`),'h');
  }

  // ── the four gaps the Milanote line teardown found ────────────────────
  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    const boot=()=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      _editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
      _boardsSelection=new Set();_boardsPeers=[];moodBoards=[];_boardsConnSel=null;
      _boardsLineClipboard=[];
      _editCards=[{id:'a',type:'text',text:'1',x:0,y:0,w:100,h:100},
                  {id:'b',type:'text',text:'2',x:400,y:400,w:100,h:100}];
      _editConnectors=[
        {id:'F',free:true,x1:10,y1:20,x2:110,y2:120,arrow:true,bx:15,by:-30,label:'Flow',weight:'thick',dash:true},
        {id:'B2',from:'a',to:'b',arrow:true}
      ];`);
    boot();

    s.section('a freeform line drags as a whole, carrying its curve');
    // The bend is an OFFSET from the midpoint, so moving both endpoints
    // needs no extra work — that is the point of storing it that way.
    const before=run(`JSON.stringify(_boardsConnGeom(_editConnectors[0]).apex)`);
    run(`(cn=>{cn.x1+=50;cn.y1+=50;cn.x2+=50;cn.y2+=50;})(_editConnectors[0])`);
    const after=run(`JSON.stringify(_boardsConnGeom(_editConnectors[0]).apex)`);
    s.eq('the apex travels with the line',
      JSON.stringify({x:JSON.parse(before).x+50,y:JSON.parse(before).y+50}),after);
    s.eq('and the stored bend is untouched',run(`_editConnectors[0].bx+','+_editConnectors[0].by`),'15,-30');

    s.section('a card-bound line is not draggable — its ends ARE the cards');
    s.eq('drag refuses it',run(`(()=>{
      const n=_editConnectors[1];const b4=JSON.stringify(n);
      _boardsConnDrag({clientX:0,clientY:0,pointerId:1},n);
      return JSON.stringify(n)===b4;})()`),true);
    s.eq('and refuses a locked one',run(`(()=>{
      const n=_editConnectors[0];n.locked=true;const b4=n.x1;
      _boardsConnDrag({clientX:0,clientY:0,pointerId:1},n);
      delete n.locked;return n.x1===b4;})()`),true);

    s.section('lock, and what it takes away');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn('F');_boardsCtxRun('ln:lock')`);
    s.eq('the line is locked',run(`_boardsConnById('F').locked`),true);
    run(`window.boardsDeleteConnector('F')`);
    s.eq('a locked line cannot be deleted',run(`_editConnectors.length`),2);
    s.ok('and is told so',/locked/i.test(app.state.toasts.join(' ')));
    run(`_boardsDrawConnectors()`);
    const lockedSvg=app.el('board-conn-layer').innerHTML;
    // NB `conn-hit` contains `conn-h` — the invisible hit stroke is always
    // there, so the handle test has to be anchored on the full class.
    s.ok('it keeps its outline but loses every handle',
      /class="conn free selected/.test(lockedSvg)&&!/class="conn-h[" ]/.test(lockedSvg));
    const lockedMenu=run(`JSON.stringify(_boardsConnItems(_boardsConnById('F'),true).map(i=>i.act||''))`);
    s.ok('and the menu hides the styling it cannot apply',!/ln:dash/.test(lockedMenu));
    s.ok('while still offering the unlock',/ln:lock/.test(lockedMenu));
    run(`_boardsCtxRun('ln:lock')`);
    s.ok('unlock drops the field rather than storing false',
      run(`_boardsConnById('F').locked===undefined`));

    s.section('z-order is array order, like cards');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn('F');_boardsCtxRun('ln:front')`);
    s.eq('front moves it last, so it paints on top',run(`_editConnectors[1].id`),'F');
    run(`_boardsCtxRun('ln:back')`);
    s.eq('back moves it first',run(`_editConnectors[0].id`),'F');

    s.section('copy and paste carry the whole line, label included');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn('F')`);
    let written='';
    run(`__ev={clipboardData:{setData:(t,v)=>{__w=v;}},preventDefault(){}};__w='';_boardsOnCopy(__ev,false)`);
    written=run(`__w`);
    s.ok('tagged as lines, not as cards',written.indexOf('groovy-board-lines:')===0,written.slice(0,24));
    s.ok('carrying the label',/Flow/.test(written));
    s.ok('the curve',/"bx":15/.test(written));
    s.ok('the weight and dash',/thick/.test(written)&&/"dash":true/.test(written));
    s.ok('and never the id — a paste mints its own',!/"id"/.test(written));
    run(`_boardsPasteLines(JSON.parse(__w.slice('groovy-board-lines:'.length)))`);
    s.eq('pasting adds one',run(`_editConnectors.length`),3);
    const pasted=run(`JSON.stringify((c=>({label:c.label,bx:c.bx,dash:!!c.dash,off:c.x1-10,sameId:c.id==='F'}))(_editConnectors[2]))`);
    s.eq('offset, styled, and its own line',pasted,'{"label":"Flow","bx":15,"dash":true,"off":24,"sameId":false}');
    s.eq('and it becomes the selection',run(`_boardsConnSel`),run(`_editConnectors[2].id`));

    s.section('a card-bound line pastes as the shape it was drawn in');
    boot();
    run(`_boardsConnEnsureIds();_boardsPasteLines([{from:'a',to:'b',arrow:true,label:'Bound'}])`);
    const flat=run(`JSON.stringify((c=>({free:!!c.free,from:c.from,label:c.label}))(_editConnectors[2]))`);
    // The cards it names may not exist on the board being pasted into.
    s.eq('flattened to freeform, keeping its style',flat,'{"free":true,"label":"Bound"}');

    s.section('a custom colour goes through the same validator');
    boot();
    run(`_boardsConnEnsureIds();_boardsSelectConn('F');_boardsCtxRun('ln:custom')`);
    s.eq('the picker targets the LINE, not a board',run(`_boardsColorTarget.kind`),'conn');
    run(`window.boardsPickTileColor('#3FCFAF')`);
    s.eq('a valid hex is stored',run(`_boardsConnById('F').color`),'#3FCFAF');
    s.ok('and reaches the stroke',/^#3FCFAF$/.test(run(`_boardsConnStroke(_boardsConnById('F'))`)));
    run(`window.boardsPickTileColor('red;background:url(x)')`);
    s.ok('anything else is refused before it can reach a style attribute',
      run(`_boardsConnById('F').color===undefined`));
    s.ok('falling back rather than passing it through',
      /var\(/.test(run(`_boardsConnStroke({free:true,color:'javascript:1'})`)));
    s.ok('a palette NAME still works alongside hexes',
      /var\(--accent-urgent\)/.test(run(`_boardsConnStroke({color:'red'})`)));
  }

  // ── M1: the table cell model ──────────────────────────────────────
  {
    const app=loadApp({files:['js/boards.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const run=x=>app.run(x);
    const boot=()=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      _editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
      _boardsSelection=new Set(['t']);_boardsConnSel=null;_boardsCellFocus=null;
      _editConnectors=[];moodBoards=[];_boardsPeers=[];
      _editCards=[{id:'t',type:'table',x:0,y:0,w:360,h:150,head:true,
        rows:[['Column A','Column B'],['10','20']]}];`);
    boot();

    s.section('a cell stays a bare string until it carries an attribute');
    // This is what makes the typed-cell work need no migration: 'Auto' —
    // the default type — is exactly what a bare string already means.
    s.eq('a plain table is plain strings',run(`typeof _editCards[0].rows[1][0]`),'string');
    run(`_boardsCellWrite(_editCards[0],1,0,{v:'99'})`);
    s.eq('writing only the value keeps it a string',run(`typeof _editCards[0].rows[1][0]`),'string');
    s.eq('and the value lands',run(`_editCards[0].rows[1][0]`),'99');
    run(`_boardsCellWrite(_editCards[0],1,0,{b:true})`);
    s.eq('an attribute upgrades it to an object',run(`typeof _editCards[0].rows[1][0]`),'object');
    s.eq('carrying the value with it',run(`_boardsCellVal(_editCards[0].rows[1][0])`),'99');
    run(`_boardsCellWrite(_editCards[0],1,0,{b:false})`);
    s.eq('clearing the last attribute DOWNGRADES it back',run(`typeof _editCards[0].rows[1][0]`),'string');
    s.eq('losing nothing',run(`_editCards[0].rows[1][0]`),'99');

    s.section('every consumer reads through the helper');
    // Seven call sites used to read c.rows[r][i] raw. Each would have
    // rendered "[object Object]" the first time a cell grew an attribute.
    boot();
    run(`_boardsCellWrite(_editCards[0],1,0,{b:true,bg:'red'})`);
    s.ok('the search index',/10/.test(run(`_boardsCardText(_editCards[0])`)));
    s.ok('and does not leak the object',!/object/.test(run(`_boardsCardText(_editCards[0])`)));
    const doc=run(`JSON.stringify(_boardsCardDoc(_editCards[0]))`);
    s.ok('the Word/Markdown export',doc.indexOf('10')>-1&&doc.indexOf('object Object')<0,doc.slice(0,60));

    s.section('a cell colour is a palette NAME, never a stored hex');
    // The swatch palette maps to CSS variables that INVERT with the theme;
    // a literal hex would be light-on-light in dark mode.
    boot();
    run(`window.boardsCellAction;_boardsCellFocus={id:'t',r:1,i:1};window.boardsCellColor('green')`);
    s.eq('a palette name is stored',run(`_editCards[0].rows[1][1].bg`),'green');
    s.eq('and painted by a class',run(`_boardsCellClass(_editCards[0].rows[1][1])`),' cell-bg-green');
    s.ok('nothing reaches a style attribute',
      !/background/.test(run(`_boardsCellStyle(_editCards[0].rows[1][1])`)));
    run(`window.boardsCellColor('#ff0000;x:url(y)')`);
    s.ok('anything off the palette falls back rather than passing through',
      run(`_editCards[0].rows[1][1]===undefined||_boardsCellAttr(_editCards[0].rows[1][1],'bg')===undefined`));

    s.section('focus is re-derived, never trusted');
    boot();
    run(`_boardsCellFocus={id:'t',r:1,i:1}`);
    s.ok('a real cell resolves',run(`!!_boardsFocusedCell()`));
    run(`_editCards[0].rows.pop()`);
    s.ok('a row that went away does not paint a ring on its replacement',
      run(`_boardsFocusedCell()===null`));
    boot();
    run(`_boardsCellFocus={id:'gone',r:0,i:0}`);
    s.ok('nor does a deleted card',run(`_boardsFocusedCell()===null`));

    s.section('the rail gains a fourth mode');
    boot();
    s.ok('a selected table alone shows card actions',
      !/cell:/.test(run(`JSON.stringify(_boardsRailItems())`)));
    run(`_boardsCellFocus={id:'t',r:1,i:1}`);
    const rail=run(`JSON.stringify(_boardsRailItems())`);
    s.ok('a focused cell swaps the rail',/cell:bold/.test(rail));
    s.ok('carrying the spec toolbar',
      /cell:italic/.test(rail)&&/cell:size/.test(rail)&&/cell:align/.test(rail)
      &&/cellSwatches/.test(rail)&&/cell:row-below/.test(rail)&&/cell:col-right/.test(rail));
    run(`_boardsCtxRun('cell:bold')`);
    s.ok('and the router applies it',run(`!!_boardsCellAttr(_editCards[0].rows[1][1],'b')`));
    s.ok('the rail reflects the state it just set',
      /"act":"cell:bold","label":"Bold","icon":"rename","on":true/.test(run(`JSON.stringify(_boardsRailItems())`)));

    s.section('selecting something else drops the focus');
    boot();
    run(`_boardsCellFocus={id:'t',r:1,i:1};_editCards.push({id:'z',type:'text',x:9,y:9,w:10,h:10});
      _boardsSelectCard('z')`);
    s.ok('so the rail cannot offer cell actions for a cell nobody sees',
      run(`_boardsCellFocus===null`));

    s.section('a locked card refuses cell edits');
    boot();
    run(`_editCards[0].locked=true;_boardsCellFocus={id:'t',r:1,i:1};_boardsCtxRun('cell:bold')`);
    s.ok('nothing is written',run(`_boardsCellAttr(_editCards[0].rows[1][1],'b')===undefined`));

    s.section('coordinates are derived, never stored');
    // Display-only: the letter comes from the column index, the number from
    // the row index. Nothing to migrate and nothing that can go stale.
    s.eq('A is the first column',run(`_boardsColName(0)`),'A');
    s.eq('Z is the 26th',run(`_boardsColName(25)`),'Z');
    s.eq('and it carries past Z rather than running out',run(`_boardsColName(26)`),'AA');
    s.eq('deep into two letters',run(`_boardsColName(27)+' '+_boardsColName(51)+' '+_boardsColName(52)`),'AB AZ BA');
    s.eq('a reference is the pair',run(`_boardsCellRef(3,1)`),'B4');

    s.section('the reference grammar maps 1:1 onto the stored array');
    // B1 is rows[0][1] whether or not `head` is set — head is pure styling.
    // M5's parser then needs no special case anywhere.
    s.eq('B1 is row 0',run(`JSON.stringify(_boardsRefToRC('B1'))`),'{"r":0,"i":1}');
    s.eq('lower case too',run(`JSON.stringify(_boardsRefToRC('b1'))`),'{"r":0,"i":1}');
    s.eq('two letters',run(`JSON.stringify(_boardsRefToRC('AA2'))`),'{"r":1,"i":26}');
    s.ok('it round-trips',run(`(()=>{for(let r=0;r<40;r++)for(let i=0;i<60;i++){
      const x=_boardsRefToRC(_boardsCellRef(r,i));if(!x||x.r!==r||x.i!==i)return false;}return true;})()`));
    s.ok('and anything that is not a reference is null',
      run(`_boardsRefToRC('B0')===null&&_boardsRefToRC('')===null&&_boardsRefToRC('1B')===null
        &&_boardsRefToRC('B1:B4')===null`));

    s.section('the +Row/+Col strip lives OUTSIDE the scrolling element');
    // Twice a patch put it inside: as a plain flex child it scrolled out of
    // reach on a table taller than its card, and as a sticky one it covered
    // the bottom row so a checkbox there could not be clicked. Both were
    // found by smoke-layout — but only with a table that actually
    // overflows, and the hit-test check reads a legitimately scrolled-away
    // control as "covered", so the fragment cannot hold this ground. The
    // nesting is the thing that matters, so assert the nesting.
    boot();
    const th=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('the table is inside the scroller',/board-table-scroll"?>\s*<table/.test(th));
    s.ok('and the strip is after it closes',
      /<\/table>\s*<\/div>[\s\S]*board-table-add/.test(th));
    s.ok('with nothing scrollable wrapping the strip',
      th.indexOf('board-table-add')>th.lastIndexOf('board-table-scroll'));

    s.section('the band and the gutter are rendered, not stored');
    boot();
    const html=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('the column band is there',/board-tr-coords/.test(html)&&/>A</.test(html)&&/>B</.test(html));
    s.ok('and the row gutter',/board-coord">1</.test(html)&&/board-coord">2</.test(html));
    s.ok('nothing of it reaches the document',
      run(`JSON.stringify(_editCards[0]).indexOf('coord')<0`));
    s.ok('the card reserves the band height so a new row is never clipped',
      run(`_boardsTableMinH(_editCards[0])>=26+20+2*28+26`));

    s.section('nothing written to Firestore may nest an array in an array');
    // Firestore refuses {rows:[['a','b']]} outright — "Nested arrays are
    // not supported" — so every board carrying a table failed to save from
    // the day the table card shipped. This checks the RULE, not one field,
    // so a future array-of-arrays anywhere on a card fails here first.
    boot();
    run(`_editCards=[
      {id:'t',type:'table',x:0,y:0,w:360,h:200,head:false,
       rows:[['Fabric','Qty'],[{v:'45000',t:'currency'},'120']]},
      {id:'n',type:'text',x:0,y:0,w:100,h:100,text:'hi',
       labels:[{t:'urgent',c:'red'}],reactions:{'👍':['u1','u2']}}
    ]`);
    const nested=x=>{
      if(Array.isArray(x))return x.some(v=>Array.isArray(v)||nested(v));
      if(x&&typeof x==='object')return Object.keys(x).some(k=>nested(x[k]));
      return false;
    };
    s.ok('a table with cells is refused by Firestore before this fix',
      nested(JSON.parse(run(`JSON.stringify(_editCards)`))));
    s.ok('and the saved form has no nested array anywhere',
      !nested(JSON.parse(run(`JSON.stringify(_boardsCardsForSave())`))));
    s.ok('reactions (an object holding arrays) are untouched — they were always legal',
      run(`JSON.stringify(_boardsCardsForSave()[1].reactions)`)==='{"👍":["u1","u2"]}');

    s.section('the wire form round-trips, and both directions are idempotent');
    const wire=run(`JSON.stringify(_boardsCardsForSave()[0].rows)`);
    s.ok('each row becomes an object holding its cells',/^\[\{"c":\[/.test(wire),wire.slice(0,30));
    s.eq('decoding gives back exactly what was in memory',
      run(`JSON.stringify(_boardsDecodeCards(_boardsCardsForSave())[0].rows)`),
      run(`JSON.stringify(_editCards[0].rows)`));
    s.eq('encoding twice changes nothing',
      run(`JSON.stringify(_boardsEncodeRows(_boardsEncodeRows(_boardsCardsForSave()[0])))`),
      run(`JSON.stringify(_boardsCardsForSave()[0])`));
    s.eq('decoding twice changes nothing',
      run(`JSON.stringify(_boardsDecodeCard(_boardsDecodeCard(_boardsCardsForSave()[0])))`),
      run(`JSON.stringify(_editCards[0])`));
    s.ok('a board written before this — plain nested rows — still decodes',
      run(`JSON.stringify(_boardsDecodeCard({type:'table',rows:[['a','b']]}).rows)`)==='[["a","b"]]');
    s.ok('and a malformed row decodes to an empty one rather than throwing',
      run(`JSON.stringify(_boardsDecodeCard({type:'table',rows:[{},null]}).rows)`)==='[[],[]]');
    s.ok('a non-table card is passed straight through',
      run(`_boardsEncodeRows(_editCards[1])===_editCards[1]`));

    s.section('the rail is grouped, and the overflow keeps it short');
    boot();
    run(`_boardsSelection=new Set();_boardsCellFocus=null;_boardsConnSel=null`);
    const acts=run(`_boardsRailItems().map(i=>i.act||'|').join(' ')`);
    ['add:text','add:link','add:todo','add:board','add:column','line']
      .forEach(a=>s.ok('the main group keeps '+a,acts.indexOf(a)>-1));
    // 'imagepanel', not 'add:image' — the Image tool opens the add-image
    // panel (search + upload) rather than going straight to a file picker.
    ['imagepanel','file'].forEach(a=>s.ok('the media group keeps '+a,acts.indexOf(a)>-1));
    s.ok('and the overflow button',acts.indexOf('more-tools')>-1);
    ['add:heading','add:table','add:frame'].forEach(a=>
      s.ok(a+' folds away behind it',acts.indexOf(a)<0));
    // Milanote has a Trash at the foot because a deleted card goes to a
    // per-board trash. Ours do not — Ctrl+Z covers them (Stage 1) — so a
    // Trash here would be a second Delete pretending to be a safety net.
    s.ok('no Trash at the foot, deliberately',acts.indexOf('trash')<0);
    s.eq('the overflow offers exactly what was folded away',
      run(`_BOARDS_RAIL_OVERFLOW.map(i=>i.act).join(',')`),'add:heading,add:table,add:frame');

    s.section('the add-image panel — upload always, search only if switched on');
    boot();
    run(`_editBoard.title='Winter Drop fleece';
      _editCards=[{id:'a',type:'text',x:0,y:0,w:100,h:100,text:'cotton drill fleece swatch'},
                  {id:'b',type:'text',x:0,y:0,w:100,h:100,text:'fleece hoodie reference'}]`);
    const kws=run(`_boardsImgKeywords()`);
    s.ok('keywords are derived from the board itself',kws.indexOf('fleece')>-1,kws.join(','));
    s.ok('the board title feeds them too',kws.indexOf('winter')>-1);
    s.ok('and nothing is stored to keep in step',
      run(`JSON.stringify(_editBoard).indexOf('keyword')<0`));
    s.ok('stop-words and bare numbers are dropped',
      run(`_boardsImgKeywords().every(w=>['the','and','note','card','board'].indexOf(w)<0&&!/^\\d+$/.test(w))`));
    s.ok('and it is capped, not a word cloud',run(`_boardsImgKeywords().length<=6`));

    s.section('a search that is not configured is not an error');
    run(`_boardsImgPanelState={configured:false,hint:'Set PEXELS_API_KEY',photos:[]}`);
    const offHtml=run(`_boardsImgPanelHTML()`);
    s.ok('upload is still offered',/Upload your own/.test(offHtml));
    s.ok('and it says so plainly rather than failing red',
      /not switched on/.test(offHtml)&&/Upload still works/.test(offHtml));
    run(`_boardsImgPanelState={configured:true,error:'Search provider returned 429',photos:[]}`);
    s.ok('a real provider failure names itself',
      /returned 429/.test(run(`_boardsImgPanelHTML()`)));
    run(`_boardsImgPanelState={configured:true,photos:[]}`);
    s.ok('and no results is its own message',/Try another word/.test(run(`_boardsImgPanelHTML()`)));

    s.section('a stock result is escaped like every other outside string');
    run(`_boardsImgPanelState={configured:true,photos:[
      {id:'1',thumb:'https://x.test/t.jpg',full:'https://x.test/f.jpg',
       alt:'<img src=x onerror=alert(1)>',credit:'"><script>bad()</script>'}]}`);
    const stockHtml=run(`_boardsImgPanelHTML()`);
    // What matters is that nothing can OPEN a tag or CLOSE an attribute —
    // the literal words surviving escaped is harmless and expected.
    s.ok('no tag can be opened',stockHtml.indexOf('<img src=x')<0
      &&stockHtml.indexOf('<script>')<0);
    s.ok('and no attribute can be closed early',
      stockHtml.indexOf('title="<')<0&&stockHtml.indexOf('"><script')<0);
    s.ok('the dangerous characters are entities instead',
      /&lt;img src=x/.test(stockHtml)&&/&quot;&gt;&lt;script&gt;/.test(stockHtml));
    s.ok('but the picture is still offered',/board-img-hit/.test(stockHtml));

    s.section('drag-to-place — click-to-place is unchanged');
    // The spec's single-click-then-click-to-place is NOT built: a browser
    // session could not reproduce it in the real product or find any armed
    // affordance, and our click already places immediately.
    const html6=run(`(()=>{_boardsRenderRail();
      const h=document.getElementById('board-rail');return h?h.innerHTML:'';})()`);
    s.ok('draggable tools are marked in the markup',/data-drag="1"/.test(html6));
    s.ok('and say so in their tooltip',/drag onto the board/.test(html6));
    s.ok('a tool with no drag affordance is not marked',
      run(`_BOARDS_RAIL_MAIN.filter(i=>i.act==='add:board')[0].drag===undefined`));

    s.section('the drag creates nothing until it is released on the canvas');
    boot();
    run(`_boardsSelection=new Set();_editCards=[];_boardsNextPlacement=null;
      __stage=document.getElementById('board-stage');
      __stage.getBoundingClientRect=()=>({left:0,top:0,right:1000,bottom:800,width:1000,height:800});
      __btn={getAttribute:k=>k==='data-act'?'add:text':'Note — click to place, or drag onto the board',
             getBoundingClientRect:()=>({left:0,top:0,right:40,bottom:40})};
      __ev=(x,y)=>({clientX:x,clientY:y,button:0,target:{closest:()=>__btn}});
      _boardsRailDragStart(__ev(20,20));`);
    s.ok('a press alone arms nothing visible',run(`_boardsRailDrag!==null&&_boardsRailDrag.moved===false`));
    run(`_boardsRailDragMove(__ev(22,21))`);
    s.ok('and a twitch below the threshold is still not a drag',run(`_boardsRailDrag.moved===false`));
    run(`_boardsRailDragMove(__ev(300,300))`);
    s.ok('past it, the drag is live',run(`_boardsRailDrag.moved===true`));
    s.eq('nothing has been created yet',run(`_editCards.length`),0);
    run(`_boardsRailDragEnd(__ev(300,300))`);
    s.eq('releasing on the canvas creates one card',run(`_editCards.length`),1);
    s.eq('of the type that was dragged',run(`_editCards[0].type`),'text');
    s.ok('and the drag is torn down',run(`_boardsRailDrag===null`));
    // A drag ends with a click on whatever is under the pointer, which
    // would run the rail action a second time.
    s.ok('the trailing click is suppressed',run(`_boardsSuppressClick===true`));

    s.section('released anywhere else, nothing is created');
    boot();
    run(`_boardsSelection=new Set();_editCards=[];
      __stage=document.getElementById('board-stage');
      __stage.getBoundingClientRect=()=>({left:0,top:0,right:1000,bottom:800,width:1000,height:800});
      __btn={getAttribute:()=>'add:table',getBoundingClientRect:()=>({left:0,top:0,right:40,bottom:40})};
      __ev=(x,y)=>({clientX:x,clientY:y,button:0,target:{closest:()=>__btn}});
      _boardsRailDragStart(__ev(20,20));_boardsRailDragMove(__ev(300,300));
      _boardsRailDragEnd(__ev(2000,2000));`);
    s.eq('dropped outside the stage',run(`_editCards.length`),0);
    run(`_boardsRailDragStart(__ev(20,20));_boardsRailDragMove(__ev(300,300));
         _boardsRailDragEscape({key:'Escape'});`);
    s.ok('Escape abandons a drag in flight',run(`_boardsRailDrag===null`));
    run(`_boardsRailDragEnd(__ev(300,300))`);
    s.eq('and the abandoned drag cannot still land',run(`_editCards.length`),0);

    s.section('a press that never moves is still a click');
    boot();
    run(`_boardsSelection=new Set();_editCards=[];
      __btn={getAttribute:()=>'add:text',getBoundingClientRect:()=>({left:0,top:0,right:40,bottom:40})};
      __ev=(x,y)=>({clientX:x,clientY:y,button:0,target:{closest:()=>__btn}});
      _boardsRailDragStart(__ev(20,20));_boardsSuppressClick=false;
      _boardsRailDragEnd(__ev(20,20));`);
    s.ok('so the rail click handler is left alone to place it',
      run(`_boardsSuppressClick===false`));
    s.eq('and the drag made nothing of its own',run(`_editCards.length`),0);

    s.section('the selection rail has a way back to the add-tools');
    boot();
    run(`_editCards=[{id:'a',type:'text',x:0,y:0,w:100,h:100,text:'x'}];
         _boardsSelection=new Set(['a']);_boardsCellFocus=null;_boardsConnSel=null`);
    const selRail=run(`JSON.stringify(_boardsRailItems())`);
    s.ok('a Back entry is offered',/"act":"deselect","label":"Back"/.test(selRail));
    s.ok('and it is the first thing on the rail',
      run(`_boardsRailItems()[0].act`)==='deselect');

    s.section('formulas — a formula IS the cell value, starting with =');
    // Not a separate field: the raw string is what you edit, it round-trips
    // through every export untouched, and it needs no entry in
    // _BOARDS_CELL_ATTRS, so the downgrade can never throw it away.
    boot();
    run(`_editCards[0].head=false;_editCards[0].rows=[
      ['Item','Qty'],['Drill','10'],['Fleece','20'],['Rib','x'],['Total','=SUM(B2:B4)']]`);
    const fx=x=>run('JSON.stringify(_boardsFxRun(_editCards[0],'+JSON.stringify(x)+',new Set()))');
    s.eq('it stays a plain string',run(`typeof _editCards[0].rows[4][1]`),'string');
    s.eq('editing shows the formula, not the answer',
      run(`_boardsCellVal(_editCards[0].rows[4][1])`),'=SUM(B2:B4)');
    s.eq('displaying shows the answer',
      run(`_boardsCellDisplay(_editCards[0].rows[4][1],_editCards[0])`),'30');
    s.ok('and it is recognised as a formula',run(`_boardsIsFormula('=SUM(A1)')===true`));
    s.ok('a bare = is not enough to be one by accident',
      run(`_boardsIsFormula('a=b')===false&&_boardsIsFormula('')===false`));

    s.section('the six functions the spec asks for');
    s.eq('SUM',fx('=SUM(B2:B4)'),'{"value":30}');
    s.eq('AVERAGE',fx('=AVERAGE(B2:B3)'),'{"value":15}');
    s.eq('MIN',fx('=MIN(B2:B3)'),'{"value":10}');
    s.eq('MAX',fx('=MAX(B2:B3)'),'{"value":20}');
    s.eq('COUNT counts NUMBERS, not cells',fx('=COUNT(B2:B4)'),'{"value":2}');
    s.eq('IF on a comparison',fx('=IF(B2>5,"over","ok")'),'{"value":"over"}');
    s.eq('IF taking the other branch',fx('=IF(B2>500,"over","ok")'),'{"value":"ok"}');
    s.eq('IF comparing text',fx('=IF(A2="Drill",1,0)'),'{"value":1}');
    // Text in a range is SKIPPED, not zero — a column under a heading must
    // still add up, and B4 here holds 'x'.
    s.ok('text in a range is skipped rather than counted',fx('=SUM(B2:B4)')==='{"value":30}');

    s.section('arithmetic, which the spec did not ask for');
    // IF's condition needs a comparison evaluator anyway, so + - * / and
    // parens came almost free — and a formula feature where =B2*1.15
    // silently failed would be reported as broken the same day.
    s.eq('multiply',fx('=B2*1.15'),'{"value":11.5}');
    s.eq('parens beat precedence',fx('=(B2+B3)/2'),'{"value":15}');
    s.eq('precedence without them',fx('=B2+B3/2'),'{"value":20}');
    s.eq('a function inside arithmetic',fx('=SUM(B2:B3)+100'),'{"value":130}');
    s.eq('unary minus',fx('=-B2'),'{"value":-10}');
    s.eq('a nested call',fx('=MAX(SUM(B2:B3),5)'),'{"value":30}');

    s.section('every failure is an error IN the cell, never a thrown render');
    s.eq('an unknown function',fx('=NOPE(1)'),'{"err":"#NAME?"}');
    s.eq('a cell past the edge',fx('=B9'),'{"err":"#REF!"}');
    s.eq('a range past the edge',fx('=SUM(B2:B99)'),'{"err":"#REF!"}');
    s.eq('dividing by zero',fx('=1/0'),'{"err":"#DIV/0!"}');
    s.eq('averaging nothing numeric',fx('=AVERAGE(A2:A3)'),'{"err":"#DIV/0!"}');
    s.eq('an unclosed bracket',fx('=SUM('),'{"err":"#ERR!"}');
    s.eq('trailing junk',fx('=SUM(B2:B3) rubbish'),'{"err":"#ERR!"}');
    s.eq('an empty formula',fx('='),'{"err":"#ERR!"}');
    s.eq('a character the tokenizer does not know',fx('=B2 # B3'),'{"err":"#ERR!"}');
    s.ok('_boardsFxRun never throws, whatever it is given',
      run(`(()=>{const junk=['=','=((((','=)','="unterminated','=SUM(,,)','=1..2','=IF()',
        '=A','=:','=SUM(B2:)','=\u0000'];
        try{junk.forEach(j=>_boardsFxRun(_editCards[0],j,new Set()));return true;}
        catch(e){return 'THREW: '+e;}})()`));

    s.section('a formula that depends on itself is caught, not hung');
    boot();
    run(`_editCards[0].rows=[['=A1','=B2'],['=B1','=A2']]`);
    s.eq('directly self-referential',
      run(`_boardsCellDisplay(_editCards[0].rows[0][0],_editCards[0])`),'#CYCLE!');
    s.eq('and a two-cell loop',
      run(`_boardsCellDisplay(_editCards[0].rows[0][1],_editCards[0])`),'#CYCLE!');

    s.section('a formula reads through other formulas');
    boot();
    run(`_editCards[0].head=false;_editCards[0].rows=[['10','20'],['=A1+B1','=A2*2']]`);
    s.eq('one level',run(`_boardsCellDisplay(_editCards[0].rows[1][0],_editCards[0])`),'30');
    s.eq('two levels',run(`_boardsCellDisplay(_editCards[0].rows[1][1],_editCards[0])`),'60');

    s.section('the answer is formatted by the CELL type, not by the formula');
    boot();
    run(`_editCards[0].head=false;_editCards[0].rows=[['20000','25000'],
      [{v:'=SUM(A1:B1)',t:'currency'},{v:'=A1/B1',t:'percent',fmt:{d:1}}]]`);
    s.eq('a currency cell',run(`_boardsCellDisplay(_editCards[0].rows[1][0],_editCards[0])`),'Rs 45,000');
    s.eq('a percent cell',run(`_boardsCellDisplay(_editCards[0].rows[1][1],_editCards[0])`),'0.8%');
    s.ok('and a numeric result sits right without being told to',
      /text-align:right/.test(run(`_boardsCellStyle('=SUM(A1:B1)',_editCards[0])`)));

    s.section('formulas reach the exports and the search index');
    boot();
    run(`_editCards[0].head=false;_editCards[0].rows=[['10','20'],['Total','=SUM(A1:B1)']]`);
    const fdoc=run(`JSON.stringify(_boardsCardDoc(_editCards[0]))`);
    s.ok('the Word/Markdown export shows the ANSWER',/\|\s*30\s*\|/.test(fdoc),fdoc.slice(0,80));
    const ftext=run(`_boardsCardText(_editCards[0])`);
    s.ok('search finds the computed value',/30/.test(ftext));
    s.ok('and the formula text too, so you can find where it is',/sum\(a1:b1\)/.test(ftext));

    s.section('the picker and the rail');
    boot();
    run(`_boardsCellFocus={id:'t',r:1,i:1}`);
    const fxm=run(`JSON.stringify(_boardsCellFxItems())`);
    ['SUM','AVERAGE','MIN','MAX','COUNT','IF'].forEach(fn=>
      s.ok('offers '+fn,fxm.indexOf('"cellfx:'+fn+'"')>-1));
    s.ok('and the help entry the spec shows',/cellfx:__help/.test(fxm));
    s.ok('the rail offers Formula',/"act":"cell:formula"/.test(run(`JSON.stringify(_boardsRailItems())`)));
    run(`_boardsCtxRun('cellfx:SUM')`);
    s.eq('picking one writes the template',run(`_boardsCellVal(_editCards[0].rows[1][1])`),'=SUM()');

    s.section('a card names its own type in its header');
    // The ternary chain had no branch for table/column/frame, so all three
    // fell through to 'Note' — a table card labelled itself NOTE. Found in
    // the browser QA round, filed as cosmetic; it is a mislabel.
    boot();
    const kindOf=t=>{
      const h=run(`_boardCardHTML(Object.assign({},_editCards[0],{type:'${t}',id:'k'}),true)`);
      const m=/id="board-name-k"[^>]*data-placeholder="([^"]*)"/.exec(h);
      return m?m[1]:'(none)';
    };
    s.eq('a table says Table, not Note',kindOf('table'),'Table');
    s.eq('and a plain note still says Note',kindOf('text'),'Note');
    // Columns and frames render their own markup with an in-place title and
    // no type label at all, so they were never mislabelled — only the table
    // fell through the chain. Asserted so the distinction is on the record.
    s.eq('a column carries no type label to get wrong',kindOf('column'),'(none)');
    s.eq('nor does a frame',kindOf('frame'),'(none)');

    s.section('a cell stops pointerdown, or it can never be edited');
    // boardsCardDragStart calls setPointerCapture on the card body, and a
    // captured pointer RETARGETS the following click and dblclick to the
    // capturing element. A note survives that because its ondblclick is on
    // the very element carrying the drag handler; a cell's is on a
    // DESCENDANT, so the cell handler never ran and the dblclick bubbled to
    // the stage — double-clicking a table spawned a stray note.
    boot();
    const cellHtml=run(`_boardCardHTML(_editCards[0],true)`);
    const tds=cellHtml.match(/<t[dh] id="board-td-[^>]*>/g)||[];
    s.ok('every data cell carries the guard',
      tds.length>0&&tds.every(t=>t.indexOf('onpointerdown="event.stopPropagation()"')>-1),
      tds.length+' cells');
    s.ok('and still carries the handler that needs it',
      tds.every(t=>/ondblclick|boardsCellToggle/.test(t)));
    // The A/B/C band and the row gutter are chrome, not data — they keep the
    // drag, so a table can still be grabbed by something other than its header.
    const coords=cellHtml.match(/<td class="board-coord[^>]*>/g)||[];
    s.ok('the coordinate chrome deliberately does NOT stop it',
      coords.length>0&&coords.every(t=>t.indexOf('onpointerdown')<0),coords.length+' coords');

    s.section('Escape and clicking away leave cell mode');
    // Escape used to be gated on _boardsEditingEl, but a cell focused by
    // RIGHT-CLICK has focus without edit mode, so it fell through and the
    // ring and the cell rail stayed up with no way out but Done.
    boot();
    // Isolated deliberately: with a card selected, line 893's Escape clears
    // the selection and _boardsSetSelection drops the focus with it, so
    // that path proves nothing about the gate. An EMPTY selection is the
    // only way to exercise the gate on its own.
    run(`currentPage='board-canvas';_boardsEditingEl=null;_boardsSelection=new Set();
         _boardsConnSel=null;_boardsCellFocus={id:'t',r:1,i:1};
         _boardsOnKeydown({key:'Escape',preventDefault(){}})`);
    s.ok('Escape clears a focus that was never in edit mode',run(`_boardsCellFocus===null`));
    run(`_boardsSelection=new Set(['t']);_boardsCellFocus={id:'t',r:1,i:1};
         _boardsOnKeydown({key:'Escape',preventDefault(){}})`);
    s.ok('and with the table selected too',run(`_boardsCellFocus===null`));
    run(`_boardsCellFocus={id:'t',r:1,i:1};_boardsSetSelection([])`);
    s.ok('and clearing the selection takes the cell with it',run(`_boardsCellFocus===null`));
    run(`_boardsCellFocus={id:'t',r:1,i:1};_boardsSetSelection(['t'])`);
    s.ok('but selecting the cell\'s OWN table keeps it',run(`_boardsCellFocus!==null`));

    s.section('the value is always the raw string, the format is derived');
    // Switch to Text and you get your '007' back, not '7'. That is what
    // makes a type change lossless in both directions.
    boot();
    run(`_editCards[0].rows=[['007','1200'],['','']];_boardsCellFocus={id:'t',r:0,i:1};
         _boardsCtxRun('celltype:number')`);
    s.eq('the stored value is untouched',run(`_boardsCellVal(_editCards[0].rows[0][1])`),'1200');
    s.eq('only the display changes',run(`_boardsCellDisplay(_editCards[0].rows[0][1])`),'1,200');
    run(`_boardsCtxRun('cellfmt:d:2')`);
    s.eq('decimals come from the format',run(`_boardsCellDisplay(_editCards[0].rows[0][1])`),'1,200.00');
    run(`_boardsCtxRun('celltype:text')`);
    s.eq('and it round-trips back out',run(`_boardsCellDisplay(_editCards[0].rows[0][1])`),'1200');
    s.eq("auto never rewrites what you typed",run(`_boardsCellDisplay('007')`),'007');

    s.section('a type survives being the only thing a cell carries');
    // _BOARDS_CELL_ATTRS drives the downgrade to a bare string. Leave 't'
    // out of it and the type is thrown away the instant it stands alone.
    boot();
    run(`_editCards[0].rows=[['5','x'],['','']];_boardsCellFocus={id:'t',r:0,i:0};
         _boardsCtxRun('celltype:percent')`);
    s.eq('it stays an object',run(`typeof _editCards[0].rows[0][0]`),'object');
    s.eq('carrying the type',run(`_boardsCellType(_editCards[0].rows[0][0])`),'percent');
    run(`_boardsCtxRun('celltype:auto')`);
    s.eq('and auto clears it back to a bare string',run(`typeof _editCards[0].rows[0][0]`),'string');

    s.section('percentage does NOT multiply by 100');
    // Deliberate divergence from the spreadsheet convention: in a garment
    // ops tool people type 12 meaning a 12% rejection rate.
    boot();
    run(`_editCards[0].rows=[[{v:'12',t:'percent'},{v:'12.5',t:'percent',fmt:{d:1}}],['','']]`);
    s.eq('12 reads as 12%',run(`_boardsCellDisplay(_editCards[0].rows[0][0])`),'12%');
    s.eq('and the decimals are honoured',run(`_boardsCellDisplay(_editCards[0].rows[0][1])`),'12.5%');

    s.section('currency, dates and checkboxes');
    boot();
    s.eq('Rs is the default symbol',run(`_boardsCellDisplay({v:'45000',t:'currency'})`),'Rs 45,000');
    s.eq('and the submenu changes it',run(`_boardsCellDisplay({v:'45000',t:'currency',fmt:{c:'usd',d:2}})`),'$45,000.00');
    s.eq('a date formats four ways',
      run(`['d','s','i'].map(f=>_boardsCellDisplay({v:'2026-09-15',t:'date',fmt:{f:f}})).join(' | ')`),
      '15 Sep 2026 | 15/09/2026 | 2026-09-15');
    s.eq('and something that is not a date is shown as typed',
      run(`_boardsCellDisplay({v:'next tuesday',t:'date'})`),'next tuesday');
    s.eq('a checkbox is a tick or nothing',
      run(`_boardsCellDisplay({v:'1',t:'check'})+'/'+_boardsCellDisplay({v:'',t:'check'})`),'✓/');
    run(`_editCards[0].rows=[[{v:'',t:'check'},'']];window.boardsCellToggle('t',0,0)`);
    s.eq('clicking it toggles',run(`_boardsCellVal(_editCards[0].rows[0][0])`),'1');
    run(`window.boardsCellToggle('t',0,0)`);
    s.eq('and back',run(`_boardsCellVal(_editCards[0].rows[0][0])`),'');
    s.ok('its click carries the pointerdown guard every control in a drag surface needs',
      /cell-t-check[\s\S]{0,240}onpointerdown="event.stopPropagation\(\)"/
        .test(run(`_boardCardHTML(_editCards[0],true)`)));

    s.section('numbers read tolerantly, and bad ones are flagged not rejected');
    s.eq('a pasted thousands separator still computes',run(`_boardsCellNum('1,200')`),1200);
    s.eq('so does a currency symbol',run(`_boardsCellNum('Rs 45,000')`),45000);
    s.eq('and a trailing percent',run(`_boardsCellNum('12%')`),12);
    s.eq('negatives',run(`_boardsCellNum('-3.5')`),-3.5);
    s.ok('prose is not a number',run(`_boardsCellNum('twelve')===null&&_boardsCellNum('')===null`));
    s.ok('a typed numeric cell holding prose is flagged',
      run(`_boardsCellInvalid({v:'twelve',t:'number'})===true`));
    s.ok('an EMPTY one is not — that is just an empty cell',
      run(`_boardsCellInvalid({v:'',t:'number'})===false`));
    s.ok('and an untyped one never is',run(`_boardsCellInvalid('twelve')===false`));

    s.section('numbers sit right without being told to');
    s.ok('a number cell',/text-align:right/.test(run(`_boardsCellStyle({v:'5',t:'number'})`)));
    s.ok('and an AUTO cell holding a number — the one thing auto formats',
      /text-align:right/.test(run(`_boardsCellStyle('1200')`)));
    s.ok('but not one holding words',!/text-align/.test(run(`_boardsCellStyle('Cotton')`)));
    s.ok('an explicit alignment still wins',
      /text-align:center/.test(run(`_boardsCellStyle({v:'5',t:'number',al:'c'})`)));

    s.section('Clear resets presentation, never the type');
    boot();
    run(`_editCards[0].rows=[[{v:'1200',t:'currency',b:true,bg:'red',sz:'l'},'']];
         _boardsCellFocus={id:'t',r:0,i:0};_boardsCtxRun('cell:clear')`);
    s.eq('the type is what the cell IS, not how it looks',
      run(`_boardsCellType(_editCards[0].rows[0][0])`),'currency');
    s.ok('the styling is gone',
      run(`_boardsCellAttr(_editCards[0].rows[0][0],'b')===undefined
        &&_boardsCellAttr(_editCards[0].rows[0][0],'bg')===undefined`));

    s.section('the type menu is the spec menu');
    boot();
    const tm=run(`JSON.stringify(_boardsCellTypeItems({v:'1',t:'currency'}))`);
    ['auto','number','currency','percent','text','date','check']
      .forEach(t=>s.ok('offers '+t,tm.indexOf('celltype:'+t)>-1));
    s.ok('ticking the one in force',/✓  Currency/.test(tm));
    s.ok('and marking the four that open a format menu',
      (tm.match(/›/g)||[]).length===4);
    s.ok('the rail offers Type',/"act":"cell:type"/.test(
      run(`_boardsCellFocus={id:'t',r:0,i:0};JSON.stringify(_boardsRailItems())`)));

    s.section('exports and search show the formatted value');
    boot();
    run(`_editCards[0].head=false;_editCards[0].rows=[[{v:'45000',t:'currency'},'Drill']]`);
    const dx=run(`JSON.stringify(_boardsCardDoc(_editCards[0]))`);
    s.ok('the Word/Markdown export is what you see on screen',/Rs 45,000/.test(dx));
    const tx=run(`_boardsCardText(_editCards[0])`);
    s.ok('search finds the raw number',/45000/.test(tx));
    s.ok('and the formatted one — both are the same cell',/45,000/.test(tx));

    s.section('rows and columns insert RELATIVE to the focused cell');
    boot();
    run(`_editCards[0].rows=[['A0','B0'],['A1','B1'],['A2','B2']];_boardsCellFocus={id:'t',r:1,i:1}`);
    run(`_boardsCtxRun('cell:row-above')`);
    s.eq('above puts the blank row before it',
      run(`_editCards[0].rows.map(r=>r.join('')).join('|')`),'A0B0||A1B1|A2B2');
    // Leave the index alone and the ring lands on the blank row that was
    // just pushed under it, which reads as the caret jumping.
    s.eq('and the focus follows the cell it was on',
      run(`_boardsCellFocus.r+','+_boardsCellFocus.i`),'2,1');
    s.eq('which is still the same text',run(`_boardsCellVal(_boardsFocusedCell().cell)`),'B1');
    boot();
    run(`_editCards[0].rows=[['A0','B0'],['A1','B1']];_boardsCellFocus={id:'t',r:0,i:0};
         _boardsCtxRun('cell:row-below')`);
    s.eq('below puts it after',run(`_editCards[0].rows.map(r=>r.join('')).join('|')`),'A0B0||A1B1');
    s.eq('and a row inserted BELOW does not move the focus',
      run(`_boardsCellFocus.r`),0);

    s.section('and columns the same way');
    boot();
    run(`_editCards[0].rows=[['A','B','C'],['1','2','3']];_boardsCellFocus={id:'t',r:1,i:1};
         _boardsCtxRun('cell:col-left')`);
    s.eq('every row widens together',run(`_editCards[0].rows.map(r=>r.length).join(',')`),'4,4');
    s.eq('the blank lands in the right place',run(`_editCards[0].rows[0].join('|')`),'A||B|C');
    s.eq('and the focus shifts right with its cell',run(`_boardsCellFocus.i`),2);
    s.eq('still the same text',run(`_boardsCellVal(_boardsFocusedCell().cell)`),'2');

    s.section('delete takes the whole row or column the cell sits in');
    boot();
    run(`_editCards[0].head=false;_editCards[0].rows=[['A0','B0'],['A1','B1'],['A2','B2']];
         _boardsCellFocus={id:'t',r:1,i:0};_boardsCtxRun('cell:del-row')`);
    s.eq('the row is gone',run(`_editCards[0].rows.map(r=>r.join('')).join('|')`),'A0B0|A2B2');
    s.ok('and the focus with it — that cell does not exist any more',
      run(`_boardsCellFocus===null`));
    boot();
    run(`_editCards[0].rows=[['A','B','C'],['1','2','3']];_boardsCellFocus={id:'t',r:0,i:2};
         _boardsCtxRun('cell:del-col')`);
    s.eq('the column is gone from every row',run(`_editCards[0].rows.map(r=>r.join('')).join('|')`),'AB|12');
    s.ok('focus cleared',run(`_boardsCellFocus===null`));
    boot();
    run(`_editCards[0].rows=[['A','B','C'],['1','2','3']];_boardsCellFocus={id:'t',r:0,i:0};
         window.boardsTableDeleteCol('t',2)`);
    s.eq('deleting a LATER column leaves the focus alone',run(`_boardsCellFocus.i`),0);

    s.section('the floors still hold, from any direction');
    boot();
    run(`_editCards[0].head=true;_editCards[0].rows=[['h','h'],['a','b']];
         window.boardsTableDeleteRow('t',0)`);
    s.eq('a header table keeps its header plus a body row',run(`_editCards[0].rows.length`),2);
    run(`while(_editCards[0].rows[0].length>1)window.boardsTableDeleteCol('t',0);
         window.boardsTableDeleteCol('t',0)`);
    s.eq('and never falls below one column',run(`_editCards[0].rows[0].length`),1);
    s.ok('an out-of-range index is a no-op, not a hole',
      run(`(()=>{const b=JSON.stringify(_editCards[0].rows);
        window.boardsTableDeleteRow('t',99);window.boardsTableInsertRow('t',-5);
        return _editCards[0].rows.length>=1&&Array.isArray(_editCards[0].rows[0]);})()`));

    s.section('append and drop are the same code, not a second copy');
    boot();
    run(`_editCards[0].head=false;_editCards[0].rows=[['A','B'],['1','2']];
         window.boardsTableAdd('t','row')`);
    s.eq('adding a row still appends',run(`_editCards[0].rows.length+':'+_editCards[0].rows[2].join('')`),'3:');
    run(`window.boardsTableDrop('t','row')`);
    s.eq('and dropping still removes the last',run(`_editCards[0].rows.length`),2);
    s.eq('leaving the earlier rows untouched',run(`_editCards[0].rows.map(r=>r.join('')).join('|')`),'AB|12');

    s.section('the cell menu is the spec menu');
    boot();
    const cm=run(`JSON.stringify(_boardsCellCtxItems(_editCards[0],1,1))`);
    ['cell:copy','cell:cut','cell:paste','cell:row-above','cell:row-below',
     'cell:col-left','cell:col-right','cell:del-row','cell:del-col','cell:align']
      .forEach(a=>s.ok('offers '+a,cm.indexOf('"'+a+'"')>-1));
    s.ok('naming the row and column it would delete',
      /Delete row 2/.test(cm)&&/Delete column B/.test(cm));
    s.ok('and the shortcuts, so the menu teaches them',
      /Alt ↑/.test(cm)&&/Alt ←/.test(cm));
    s.ok('with the reference in the footer',/"title":"B2/.test(cm));

    s.section('Alt+Arrow is read BEFORE the editable bail');
    // A focused cell is contenteditable, so the bail that protects text
    // cards would swallow this every time. Gated on a focused cell, so the
    // one thing it costs — Alt+Left/Right as word-jump on a Mac — is only
    // unavailable inside a table cell, which is where the spec wants it.
    boot();
    run(`currentPage='board-canvas';_editCards[0].rows=[['A','B'],['1','2']];
         _boardsCellFocus={id:'t',r:1,i:1};__pd=0;
         _boardsOnKeydown({key:'ArrowUp',altKey:true,preventDefault(){__pd++;}})`);
    s.eq('Alt+Up inserts above',run(`_editCards[0].rows.length`),3);
    s.eq('and claims the key from the browser',run(`__pd`),1);
    run(`_boardsOnKeydown({key:'ArrowRight',altKey:true,preventDefault(){}})`);
    s.eq('Alt+Right inserts a column',run(`_editCards[0].rows[0].length`),3);
    run(`_boardsCellFocus=null;__n=_editCards[0].rows.length;
         _boardsOnKeydown({key:'ArrowUp',altKey:true,preventDefault(){}})`);
    s.eq('with no focused cell it does nothing at all',run(`_editCards[0].rows.length`),run(`__n`));
    run(`_boardsCellFocus={id:'t',r:0,i:0};__n2=_editCards[0].rows.length;
         _boardsOnKeydown({key:'ArrowUp',altKey:true,ctrlKey:true,preventDefault(){}})`);
    s.eq('and Ctrl+Alt+Up is not it either',run(`_editCards[0].rows.length`),run(`__n2`));

    s.section('a locked table refuses all of it');
    boot();
    run(`_editCards[0].locked=true;_editCards[0].rows=[['A','B'],['1','2']];
         _boardsCellFocus={id:'t',r:0,i:0};_boardsCtxRun('cell:row-above')`);
    s.eq('nothing is inserted',run(`_editCards[0].rows.length`),2);

        s.section('a table can carry a caption, per the spec toolbar');
    boot();
    run(`_boardsCtxRun('caption')`);
    s.eq('the field is created',run(`typeof _editCards[0].caption`),'string');
    s.ok('the rail offers it',/"act":"caption"/.test(run(`JSON.stringify(_boardsRailItems())`)));
    s.ok('and it is drawn',/board-cap-t/.test(run(`_boardCardHTML(_editCards[0],true)`)));
  }

  return s;
};

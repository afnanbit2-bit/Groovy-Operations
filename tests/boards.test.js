/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — js/boards.js

   Covers the invariants that would be expensive to rediscover: the touch
   zoom curve, the rich-text sanitiser (a real stored-XSS boundary), labels
   and reactions, board identity, and the phone/desktop split.

   NOT covered, and it matters: anything visual. See tests/harness.js.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite,ROOT}=require('./harness');
const _BOARDS_PHRASE_DEBUG=h=>(h.match(/board-subboard-cta[^<]*<span>([^<]*)/)||[])[1]||'(no cta)';

const FILES=['js/boards.js'];

module.exports=function(){
  const s=suite('boards');
  // Async blocks push their promise here instead of `return`ing it. A bare
  // `return` in the middle of this function ends it, silently dropping every
  // block below — the tell is the assertion total going DOWN when tests are
  // added. The final block resolves these before handing the suite back.
  const _pending=[];

  // ── touch: the 100% detent and micro zoom ─────────────────────────────
  {
    const app=loadApp({files:FILES});
    const {run,state}=app;
    s.section('pinch stops at 100% when it starts below it');
    // 40%, not the 19% this used to start from: the floor is 25% now, so a
    // gesture starting below it is not a state the app can be in.
    run(`__p={zoom:0.4,micro:false,buzzed100:false,buzzedMax:false}`);
    s.ok('40% × 1.5 → 60%',Math.abs(run(`_boardsPinchZoom(__p,1.5)`)-0.6)<1e-9);
    s.eq('a wide spread stops dead at 100%',run(`_boardsPinchZoom(__p,9)`),1);
    s.eq('and buzzed exactly once',state.vibrations.length,1);
    run(`_boardsPinchZoom(__p,12)`);
    s.eq('no second buzz while held there',state.vibrations.length,1);
    s.ok('pinching back in is unaffected',Math.abs(run(`_boardsPinchZoom(__p,0.8)`)-0.32)<1e-9);
    s.eq('and never goes below the floor',run(`_boardsPinchZoom(__p,0.01)`),0.25);

    s.section('the zoom floor is 25%, enforced in ONE place');
    s.eq('the floor itself',run(`_BOARDS_ZOOM_MIN`),0.25);
    s.eq('a pinch cannot pass it',run(`_boardsClampZoom(0.01)`),0.25);
    s.eq('nor can anything else',run(`_boardsClampZoom(0.2499)`),0.25);
    s.eq('the ceiling still holds',run(`_boardsClampZoom(99)`),3);
    s.eq('and junk is not a zoom',run(`_boardsClampZoom(0)`),1);
    // A board SAVED below the floor — every board Afnan has worked at 19%
    // on — must come back inside it, or zooming out would appear to do
    // nothing with no way to tell why.
    // boardsOpen only routes; _boardsOpenCanvas is what reads the document.
    _pending.push((async()=>{
      run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};currentPage='board-canvas';
        boardsLoaded=true;_boardsTrash=[];_boardsViewingId='OLD';
        moodBoards=[{id:'OLD',title:'Winter',ownerUid:'u1',visibility:'personal',zoom:0.19,cards:[],connectors:[]}];`);
      await run(`_boardsOpenCanvas()`);
      s.eq('a board stored at 19% opens at the floor',run(`_editBoard&&_editBoard.zoom`),0.25);

      // And a HOME saved at 25% comes back at 40 — which is what makes the
      // higher floor need no migration. Sequenced inside this same block on
      // purpose: two _pending blocks that each set up state and then await
      // will overwrite each other, because every body runs to its first
      // await at push time.
      run(`_boardsViewingId='H2';
        moodBoards=[{id:'H2',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:0.25,cards:[],connectors:[]}];`);
      await run(`_boardsOpenCanvas()`);
      s.eq('a Home stored at 25% opens at 40%',run(`_editBoard&&_editBoard.zoom`),0.40);
    })());

    // HOME's floor is higher, because Home holds board cards and nothing
    // else — things you READ rather than a wall of tech packs you want all
    // of at once. Same single enforcement point, so every entry path and
    // Fit inherit it.
    // Its own app instance: the block above is mid-await on a board OPEN,
    // and _editBoard is what both that and the clamp read. Setting it here
    // would clobber the open before its microtask resumes — which is the
    // same _pending hazard, reached from the synchronous side.
    s.section('Home stops at 40%');
    {
      const z=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const rz=x=>z.run(x);
      rz(`_editBoard={id:'H',isHome:true,zoom:1}`);
      s.eq('the Home floor',rz(`_BOARDS_HOME_ZOOM_MIN`),0.40);
      s.eq('a pinch stops at 40 on Home',rz(`_boardsClampZoom(0.1)`),0.40);
      s.eq('25% is below Home\u2019s floor',rz(`_boardsClampZoom(0.25)`),0.40);
      s.eq('and the ceiling is unchanged',rz(`_boardsClampZoom(99)`),3);
      rz(`_editBoard={id:'A',zoom:1}`);
      s.eq('an ordinary board still goes to 25',rz(`_boardsClampZoom(0.1)`),0.25);
      // Nothing may read the constant directly and skip the Home branch.
      const src=require('fs').readFileSync(require('path').join(ROOT,'js/boards.js'),'utf8');
      s.eq('the floor is read through the helper, never the constant',
        (src.match(/_BOARDS_ZOOM_MIN/g)||[]).length,2);   // declaration + the helper
    }

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

    // The card's FOOT (Sept 2026): labels and reactions sit UNDER the
    // content, inside the card, like Milanote's chips — not in a row wedged
    // between the header and the body.
    s.section('labels and reactions are the card\'s foot');
    run(`_editCards[0].labels=[{t:'see this',c:'green'}]`);
    const cardHtml=run(`_boardCardHTML(_editCards[0],true)`);
    const iBody=cardHtml.indexOf('board-card-body'),iFoot=cardHtml.indexOf('board-card-foot'),iLab=cardHtml.indexOf('board-labels'),iRe=cardHtml.indexOf('board-reactions');
    s.ok('the foot comes after the body',iBody>=0&&iFoot>iBody,iBody+' '+iFoot);
    s.ok('and holds the labels and the reactions, labels first',iLab>iFoot&&iRe>iLab,iFoot+' '+iLab+' '+iRe);
    s.ok('a label chip keeps its colour class',/board-label lc-green/.test(cardHtml));
    run(`delete _editCards[0].labels;delete _editCards[0].reactions`);
    s.ok('a bare card has no foot at all',!/board-card-foot/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    s.eq('the foot is counted once per row in the minimum height',
      run(`_boardsMinCardH({type:'text',labels:[{t:'a',c:'grey'}],reactions:{'A':['u']}})-_boardsMinCardH({type:'text'})`),
      run(`_BOARDS_CHROME_H.labels+_BOARDS_CHROME_H.reactions`));
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
    // The inline swatch grid became the Color tile + panel (Sept 2026).
    s.ok('desktop keeps its full rail',/labels/.test(drail)&&/reactions/.test(drail)&&/color-panel/.test(drail));

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
    const card2=lit=>`_boardCardHTML(${lit},true)`;
    const bodyDrag2=lit=>{
      const html=run(card2(lit));
      return ((html.match(/<(?:div|a) class="board-card-body[^>]*>/g)||[])
        .some(tag=>/boardsCardDragStart/.test(tag)));
    };
    ['image','file','board','text','todo','link'].forEach(t=>{
      s.ok('a '+t+' card does',bodyDrag(t));
    });
    // The link card was the one exclusion, and it left that card with NO
    // drag surface at all once the head strip became an inert overlay —
    // measured at 0% of the whole card, not just of the strip. Its fields
    // carry the pointerdown guard instead, which is what the exclusion was
    // really reaching for, so the padding around the form drags.
    s.ok('a link card in its edit form drags from the body too',
      bodyDrag2(`{id:'l',type:'link',x:0,y:0,w:220,h:150,linkUrl:'https://x.test',linkTitle:'T',_linkEdit:true}`));
    s.ok('and every field in that form stops pointerdown itself',
      (run(card2(`{id:'l',type:'link',x:0,y:0,w:220,h:150,linkUrl:'https://x.test',linkTitle:'T',_linkEdit:true}`))
        .match(/<(?:input|textarea)[^>]*>/g)||[]).every(t=>/stopPropagation/.test(t)));
    s.ok('a brand-new link card drags from the body as well',
      bodyDrag2(`{id:'l',type:'link',x:0,y:0,w:220,h:100}`));

    s.section('nothing is editable until it is double-clicked');
    ['text','todo'].forEach(t=>{
      const html=run(card(t));
      s.ok('a '+t+' card ships contenteditable="false"',
        /contenteditable="false"/.test(html)&&!/contenteditable="true"/.test(html));
    });
    s.ok('a note offers a double-click to open it',/ondblclick="window\.boardsBeginEdit/.test(run(card('text'))));
    s.ok('and so does a task',/board-todo-.*ondblclick="window\.boardsBeginEdit/.test(
      run(`_boardCardHTML({id:'t9',type:'todo',items:[{text:'a'}],x:0,y:0,w:240,h:160},true)`)));
    // THE CARD NAME IS A LABEL NOW, not a control. It lives in the head,
    // which floats over the card's first row and is pointer-events:none —
    // anything clickable in there would steal a click aimed at the content
    // underneath (the probe caught it eating a link card's URL field).
    // Renaming is the rail's Rename, F2 and the right-click menu.
    const nameHtml=run(card('image'));
    s.ok('the card name carries no click handlers',
      !/board-card-name[^>]*on(click|dblclick)=/.test(nameHtml),(nameHtml.match(/board-card-name[^>]*/)||[''])[0]);
    s.ok('and the head itself carries none either',
      !/class="board-card-head"[^>]*ondblclick/.test(nameHtml));
    s.ok('Rename still reaches it',run(`(function(){
      var hit=null;window.boardsBeginEdit=function(ev,id){hit=id;};
      _editCards=[{id:'r9',type:'image',x:0,y:0,w:200,h:200}];_boardsSelection=new Set(['r9']);
      _boardsCtxRun('rename');return hit;})()`)==='board-name-r9');

    /* ── A to-do item can be double-clicked AND the card can be grabbed ──
       Reported by Afnan twice, and the second report is what settled it.
       First: double-clicking a to-do did nothing, because the drag captured
       the pointer on the pointerdown and a captured pointer retargets the
       following dblclick to the CAPTURING element. That was patched by
       hanging a stopPropagation guard on the item text.
       Then: "to do not moving properly" — the card would not move at all
       when grabbed by its head strip. The strip is an inert overlay, so the
       press falls through to the first task's text, and that guard ate it.
       MEASURED with the real stylesheet in headless Chromium
       (scratchpad/measure-card-grab.js): 42% of the strip started a drag,
       and none of its middle. Both reports are one cause — the eager
       capture — so the capture is deferred past the drag threshold and the
       guard is gone from anything that is merely text. */
    s.section('a to-do item can be double-clicked, and the card still drags');
    {
      const todo=run(`_boardCardHTML(${JSON.stringify({id:'td',type:'todo',x:0,y:0,w:240,h:170,title:'Sampling',
        items:[{text:'Lab dip',done:false},{text:'Bulk',done:true}]})},true)`);
      const rows=todo.match(/<div class="board-todo-text[^>]*>/g)||[];
      s.eq('both items render',rows.length,2);
      rows.forEach((r,i)=>{
        s.ok('item '+i+' offers the double-click',
          /ondblclick="window\.boardsBeginEdit/.test(r),r.slice(0,90));
        // No guard: the press has to reach the body's drag handler, or the
        // head strip — which sits directly over this row — is a dead grip.
        s.ok('item '+i+' lets the press through to the card drag',
          !/onpointerdown=/.test(r),r.slice(0,90));
      });
      s.ok('the list title lets it through too',
        !/<div class="board-todo-title[^>]*onpointerdown=/.test(todo),
        (todo.match(/<div class="board-todo-title[^>]*>/)||[''])[0].slice(0,90));
      // The real CONTROLS keep theirs: each acts on a single click, and a
      // drag must not begin on one you are in the middle of pressing.
      s.ok('the checkbox still stops pointerdown',
        /<input type="checkbox"[^>]*onpointerdown="event\.stopPropagation\(\)"/.test(todo));
      s.ok('the remove ✕ still stops pointerdown',
        /<button class="board-todo-del"[^>]*onpointerdown="event\.stopPropagation\(\)"/.test(todo));
      s.ok('and "Add a task…" still stops pointerdown',
        /<div class="board-todo-add"[^>]*onpointerdown="event\.stopPropagation\(\)"/.test(todo));
      s.ok('the to-do body still starts a card drag',
        /<div class="board-card-body board-todo-body" onpointerdown="window\.boardsCardDragStart/.test(todo));
    }

    /* ── The capture is what made both bugs, so the mechanism is asserted ─
       If setPointerCapture ever moves back onto the pointerdown, every
       descendant's click is retargeted again and the guards come back with
       it — which is how a to-do card became ungrabbable at its own grip.
       The threshold check has to come FIRST. */
    s.section('the drag takes the pointer only once it is a drag');
    {
      const src=require('fs').readFileSync(require('path').join(__dirname,'..','js','boards.js'),'utf8');
      const fn=src.slice(src.indexOf('window.boardsCardDragStart=function'),
                         src.indexOf('window.boardsResizeStart=function'));
      // The CALL, not the prose — the comment above it names the function
      // while explaining why it no longer runs there.
      const cap=fn.indexOf('setPointerCapture(');
      const thresh=fn.indexOf('_BOARDS_DRAG_PX');
      s.ok('boardsCardDragStart captures the pointer somewhere',cap>-1);
      s.ok('and only AFTER the drag threshold is passed',thresh>-1&&cap>thresh,
        'threshold at '+thresh+', capture at '+cap);
      // Without a capture at pointerdown the element stops seeing the
      // pointer the moment it leaves, so the tracking must be document-wide.
      s.ok('it tracks on the document, not on the pressed element',
        /document\.addEventListener\('pointermove'/.test(fn)&&
        /document\.addEventListener\('pointerup'/.test(fn));
      s.ok('and it tears those listeners down again',
        /document\.removeEventListener\('pointermove'/.test(fn)&&
        /document\.removeEventListener\('pointerup'/.test(fn));
    }

    /* ── A board card is a SPINE (Sept 2026) ────────────────────────────
       Afnan lived with option A (the cover full bleed) for a day and then
       picked option D: "i like D spine its perfect". The face runs down the
       left edge, the whole name sits beside it, and a strip of the board's
       own thumbnails says what is inside. */
    s.section('a board card wears the board’s face');
    {
      const app5=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const r5=x=>app5.run(x);
      const COVER='https://res.cloudinary.com/deww4lpym/image/upload/v1/cover.jpg';
      const bc=`{id:'k1',type:'board',boardId:'B',x:0,y:0,w:240,h:180}`;
      const setB=extra=>r5(`_editBoard={id:'H',isHome:true,ownerUid:'u1',visibility:'personal',zoom:1};
        moodBoards=[{id:'B',title:'WINTER DUMP 2K27',ownerUid:'u1',visibility:'personal',
          cards:[{id:'a',type:'image',imageUrl:'${COVER}'},{id:'b',type:'file',fileUrl:'x'},{id:'c',type:'text'}]${extra}}];
        _editCards=[${bc}];`);

      setB(`,coverUrl:'${COVER}',color:'#C2410C',icon:'W'`);
      const withCover=r5(`_boardCardHTML(_editCards[0],true)`);
      // THE SPINE PAINTS THE COVER. A picture somebody chose for a board is
      // its identity and must not be demoted to a 30px chip in the strip
      // below, which is for contents.
      s.ok('the cover fills the spine',/class="board-subboard-spine has-cover"/.test(withCover));
      s.ok('as a sized derivative, not the original',
        /board-subboard-spine has-cover[^>]*>\s*<img[^>]*f_auto/.test(withCover));
      s.ok('with CORS, so the PNG export can read it back',
        /board-subboard-spine has-cover[^>]*>\s*<img[^>]*crossorigin="anonymous"/.test(withCover));
      s.ok('and no native HTML5 drag',
        /board-subboard-spine has-cover[^>]*>\s*<img[^>]*draggable="false"/.test(withCover));
      s.ok('the whole name sits beside it',
        /board-subboard-info/.test(withCover)&&/WINTER DUMP 2K27/.test(withCover));
      s.ok('the meta names the state and counts cards AND files',
        /PRIVATE · 3 cards · 2 files/.test(withCover),
        (withCover.match(/board-subboard-meta">([^<]*)/)||[])[1]);
      s.ok('the type strip is gone from the body',!/board-subboard-open">Open →/.test(withCover));

      /* THE THUMBNAIL STRIP is the half of D that says what is INSIDE, and
         it is DERIVED from the child board's cards on every render — nothing
         is stored and nothing migrates. The +N counts the cards the strip
         could not show, not the pictures it left out. */
      s.eq('one image card makes one thumbnail',
        (withCover.match(/board-subboard-thumb"/g)||[]).length,1);
      s.ok('and the rest of the board is a +N chip',
        /board-subboard-more">\+2</.test(withCover),
        (withCover.match(/board-subboard-more">([^<]*)/)||[])[1]);
      s.ok('a thumbnail carries the same three guards every board image does',
        /board-subboard-thumb"><img[^>]*f_auto[^>]*crossorigin="anonymous"[^>]*draggable="false"/.test(withCover));

      // No cover → the board's colour carrying its icon or first letter.
      setB(`,color:'#C2410C',icon:'W'`);
      const noCover=r5(`_boardCardHTML(_editCards[0],true)`);
      s.ok('no cover falls back to the colour field',
        /class="board-subboard-spine"[^>]*background:#C2410C/.test(noCover));
      s.ok('carrying the icon',/board-subboard-glyph">W</.test(noCover));
      s.ok('and no cover <img> at all',!/board-subboard-spine has-cover/.test(noCover));
      setB(``);
      const bare=r5(`_boardCardHTML(_editCards[0],true)`);
      s.ok('no icon falls back to the first letter',/board-subboard-glyph">W</.test(bare));
      s.ok('and no colour falls back to a neutral',/background:var\(--soft\)/.test(bare));
      // A board with no pictures in it gets no strip at all, rather than an
      // empty row or a chip that only repeats the count above it.
      r5(`moodBoards[0].cards=[{id:'t',type:'text'}];`);
      s.ok('a board with no pictures shows no strip',
        !/board-subboard-thumbs/.test(r5(`_boardCardHTML(_editCards[0],true)`)));
      s.eq('and the helper agrees',
        r5(`JSON.stringify(_boardsBoardThumbs({cards:[{type:'text'},{type:'text'}]}))`),
        JSON.stringify({urls:[],rest:2}));
      s.eq('the strip is capped at three',
        r5(`_boardsBoardThumbs({cards:[1,2,3,4,5].map(i=>({type:'image',imageUrl:'u'+i}))}).urls.length`),3);

      // ONE decision about what a board looks like — the gallery tile, the
      // panel row and the card all read it, so they cannot disagree.
      s.eq('the face of a board is decided once',
        r5(`JSON.stringify(_boardsFaceOf({title:'Winter',icon:'W',color:'#C2410C',coverUrl:'${COVER}'}))`),
        JSON.stringify({cover:COVER,color:'#C2410C',glyph:'W'}));
      s.eq('a glyph is never empty',r5(`_boardsFaceOf({}).glyph`),'?');
      // A stored cover is never trusted — the string goes into an <img src>.
      s.eq('a lookalike host is refused',
        r5(`_boardsFaceOf({coverUrl:'https://res.cloudinary.com.evil.test/a.jpg'}).cover`),'');
      s.eq('so is a javascript: URL',
        r5(`_boardsFaceOf({coverUrl:'javascript:alert(1)'}).cover`),'');
      s.eq('and an invalid colour is dropped, never passed through',
        r5(`_boardsFaceOf({color:'red;background:url(x)'}).color`),'');

      // Double-click opens it, and the handler sits on the very element
      // carrying the drag handler — a descendant would be retargeted away
      // by the pointer capture, which is the bug this file keeps finding.
      s.ok('double-clicking the card opens the board',
        /board-subboard-body openable"[^>]*boardsCardDragStart[^>]*ondblclick="window\.boardsGoto\('B'\)"/.test(noCover));

      /* ── "This one opens" ──────────────────────────────────────────
         Afnan: drop the Open pill, glow the corners in red while the card
         is idle, and say how on hover. Both hang off `.openable`. */
      s.ok('an openable card is marked as such',/board-subboard-body openable/.test(noCover));
      s.ok('and carries the line, not a button',
        /board-subboard-cta/.test(noCover)&&!/>Open</.test(noCover));
      s.ok('the line is the one Afnan wrote',
        noCover.indexOf('Double-click to open your mind')>0,_BOARDS_PHRASE_DEBUG(noCover));
      // THE PILL SURVIVES ON A PHONE. There is no hover there, and dblclick
      // is not dependable once .board-stage has taken touch-action — the
      // reason double-tap-to-place is paired by hand — so removing it
      // would leave a board with no way in but a long-press.
      const ph=loadApp({files:['js/boards.js'],phone:true,
        session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      ph.run(`_editBoard={id:'H',isHome:true,ownerUid:'u1',visibility:'personal',zoom:1};
        moodBoards=[{id:'B',title:'W',ownerUid:'u1',visibility:'personal',cards:[]}];
        _editCards=[{id:'k1',type:'board',boardId:'B',x:0,y:0,w:240,h:180}];`);
      s.ok('a phone still gets the Open button',
        />Open</.test(ph.run(`_boardCardHTML(_editCards[0],true)`)));

      // The three states survive the redesign.
      r5(`moodBoards=[];`);
      const gone=r5(`_boardCardHTML(_editCards[0],true)`);
      s.ok('a board this viewer cannot read says why',/Not available/.test(gone));
      s.ok('and offers no Open button that would no-op',!/boardsGoto/.test(gone));
      r5(`_editCards=[{id:'k2',type:'board',boardId:'',x:0,y:0,w:240,h:180}];`);
      const orphan=r5(`_boardCardHTML(_editCards[0],true)`);
      s.ok('an orphan still offers to create the board',/boardsRepairBoardCard/.test(orphan));
      // A board that is gone, or never linked, invites nothing — a
      // double-click on either can do nothing, so neither the glow nor the
      // line appears.
      s.ok('a card with nothing behind it is not openable',
        !/openable/.test(gone)&&!/board-subboard-cta/.test(gone));
      s.ok('nor is an orphan',!/openable/.test(orphan)&&!/board-subboard-cta/.test(orphan));
      s.ok('but the orphan keeps its repair button',/>Create</.test(orphan));

      // A board card is born a WIDE RECTANGLE, at Afnan's request and to
      // the shape he drew on a screenshot.
      s.eq('a new board card is 340x136',
        r5(`_BOARDS_HOME_W+'x'+_BOARDS_HOME_H`),'340x136');
      // ONE definition of that size. It used to be two — 200x104 from
      // _boardsNewCard and 260x172 on Home — so the same card came out a
      // different shape depending on which way you made it.
      s.eq('and the same size wherever it is minted',
        r5(`(function(){var c=_boardsNewCard('board');return c.w+'x'+c.h;})()`),'340x136');
      // The birth height has to clear the render's own minimum, or every
      // new card is silently grown and the shape asked for never appears.
      s.ok('the birth height is not grown by the render',
        r5(`_boardsMinCardH({type:'board',w:_BOARDS_HOME_W,h:_BOARDS_HOME_H})`)<=136,
        r5(`String(_boardsMinCardH({type:'board',w:_BOARDS_HOME_W,h:_BOARDS_HOME_H}))`));
      // ...and still clear the content. MEASURED in headless Chromium with
      // the real stylesheet: the tallest a spine card's body ever gets is
      // 107px (a two-line name + the meta line + a thumbnail strip). The
      // 28px header strip used to be charged on top of that; EVERY card's
      // head is a hover overlay now, so the minimum is the body alone.
      s.ok('and still clears the measured content',
        r5(`_boardsMinCardH({type:'board',w:_BOARDS_HOME_W,h:0})`)>=107,
        r5(`String(_boardsMinCardH({type:'board',w:_BOARDS_HOME_W,h:0}))`));
      // Cards written at the old sizes are not rewritten on open — the
      // render grows them to the minimum instead, so nothing migrates.
      s.ok('an old card is drawn tall enough for the name',
        r5(`_boardsMinCardH({type:'board',w:200,h:124})`)>=107,
        r5(`String(_boardsMinCardH({type:'board',w:200,h:124}))`));
      s.eq('and no type is charged for a head strip any more',
        r5(`String(_boardsMinCardH({type:'text'})-_BOARDS_MIN_BODY_H.text)`),'0');
    }

    /* ── One download per card ──────────────────────────────────────────
       Afnan pressed Download twice because nothing happened, and got the
       file twice. The wait is structural — an <a download> at a
       cross-origin URL is ignored by Chrome, so the bytes have to be
       fetched and turned into a same-origin blob: before a dialog can
       appear with the name we chose — so it is made visible and the second
       press is refused. */
    _pending.push((async()=>{
      const A='https://res.cloudinary.com/x/image/upload/v1/hoodie.jpg';
      let opened=0,reads=0;
      const bytes=new Uint8Array(4);
      const mk=(opts)=>loadApp({files:['js/boards.js'],
        session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        globals:Object.assign({
          fetch:async()=>{reads++;return{
            ok:true,status:200,
            headers:{get:k=>k==='content-length'?'4':'image/jpeg'},
            body:{getReader(){let n=0;return{read:async()=>(n++?{done:true}:{done:false,value:bytes})};}},
            blob:async()=>({})
          };},
          Blob:function(){return{};},
          open:()=>{opened++;}
        },opts||{})});

      const app6=mk();
      const r6=x=>app6.run(x);
      r6(`URL.createObjectURL=function(){return'blob:x';};URL.revokeObjectURL=function(){};
        _editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
        _editCards=[{id:'p1',type:'image',name:'ARTICLE #1',imageUrl:'${A}',x:0,y:0,w:240,h:180}];`);
      // The card element has to exist for the overlay to attach to.
      r6(`document.getElementById('board-card-p1')`);

      // TWO presses, the second while the first is still in flight.
      const both=r6(`(function(){
        const c=_boardsPreviewCard(_editCards[0]);
        return Promise.all([_boardsDownloadAsset(c),_boardsDownloadAsset(c)]);
      })()`);
      const res=await both;
      s.eq('the second press is refused',JSON.stringify(res),'[true,false]');
      s.eq('so the file is fetched once, not twice',reads,1);
      s.ok('and it says why rather than doing nothing',
        /Already preparing/.test(app6.state.toasts.join(' ')),app6.state.toasts.join(' | '));
      // The guard releases, or the card could never be downloaded again.
      s.eq('the guard is released afterwards',r6(`_boardsDownloading.size`),0);
      s.eq('and the overlay is taken down',r6(`_boardsBusy.size`),0);

      // The overlay goes UP while it runs, carrying a real percentage when
      // the response says how big it is.
      const app7=mk();
      const r7=x=>app7.run(x);
      r7(`URL.createObjectURL=function(){return'blob:x';};URL.revokeObjectURL=function(){};
        _editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
        _editCards=[{id:'p1',type:'image',name:'ARTICLE #1',imageUrl:'${A}',x:0,y:0,w:240,h:180}];
        __seen=[];
        __origStart=_boardsBusyStart;
        _boardsBusyStart=function(id,l){__seen.push('start:'+l);return __origStart(id,l);};
        __origProg=_boardsBusyProgress;
        _boardsBusyProgress=function(id,f,l){__seen.push('prog:'+Math.round(f*100));return __origProg(id,f,l);};`);
      await r7(`_boardsDownloadAsset(_boardsPreviewCard(_editCards[0]))`);
      s.eq('the card says what is happening',
        r7(`__seen[0]`),'start:Preparing to download…');
      s.ok('and reports progress as the bytes arrive',
        r7(`__seen.indexOf('prog:100')>0`),r7(`JSON.stringify(__seen)`));

      // A FAILED download must not leave the card wearing the cover.
      const app8=mk({fetch:async()=>{throw new Error('offline');}});
      const r8=x=>app8.run(x);
      r8(`URL.createObjectURL=function(){return'blob:x';};URL.revokeObjectURL=function(){};
        _editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
        _editCards=[{id:'p1',type:'image',name:'ARTICLE #1',imageUrl:'${A}',x:0,y:0,w:240,h:180}];`);
      const okf=await r8(`_boardsDownloadAsset(_boardsPreviewCard(_editCards[0]))`);
      s.eq('a failed download reports failure',okf,false);
      s.eq('the overlay comes down anyway',r8(`_boardsBusy.size`),0);
      s.eq('and the card can be tried again',r8(`_boardsDownloading.size`),0);

      // No Content-Length: the shimmer carries it, never a stuck number.
      const app9=mk({fetch:async()=>({ok:true,status:200,
        headers:{get:()=>null},body:null,blob:async()=>({})})});
      const r9=x=>app9.run(x);
      r9(`URL.createObjectURL=function(){return'blob:x';};URL.revokeObjectURL=function(){};
        _editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
        _editCards=[{id:'p1',type:'image',name:'A',imageUrl:'${A}',x:0,y:0,w:240,h:180}];
        __p=0;_boardsBusyProgress=function(){__p++;};`);
      s.eq('an unmeasurable download still succeeds',
        await r9(`_boardsDownloadAsset(_boardsPreviewCard(_editCards[0]))`),true);
      s.eq('and shows no percentage at all',r9(`__p`),0);
      s.eq('nothing was opened in a tab',opened,0);
    })());

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

    /* ── The head strip is CHROME, not a handle ─────────────────────────
       It is an absolute overlay across the card's first row and CSS gives
       it pointer-events:none, so a click aimed at the content beneath it
       still lands (the layout probe caught it eating a link card's URL
       field). It carried a drag handler anyway — dead from the day the
       strip became inert, and reading in review exactly like a working
       grip. The drag belongs to the BODY the press falls through to. */
    s.section('the head strip carries no handler it cannot run');
    ['image','file','board','text','todo','link'].forEach(t=>{
      const head=(run(card(t)).match(/<div class="board-card-head"[^>]*>/)||[''])[0];
      s.ok(t+"'s head has no drag handler",!/onpointerdown=/.test(head),head);
    });
    s.ok('and the strip really is inert in the stylesheet',
      /\.board-card-head\{[^}]*pointer-events:none/.test(
        require('fs').readFileSync(require('path').join(__dirname,'..','css','main.css'),'utf8')));

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

    // boardsHeadDblClick is gone with the header strip. It existed because
    // a heading's drag strip sat over its banner and ate the first
    // double-click; the head is inert on every card now, so the banner gets
    // that double-click itself — the workaround's own cause is removed.
    s.section('the head strip swallows nothing');
    board();
    s.eq('the workaround is gone',run(`typeof window.boardsHeadDblClick`),'undefined');
    s.ok('and a heading banner opens on its own double-click',
      /board-heading-body[^>]*ondblclick="window\.boardsBeginEdit\(event,'board-txt-h9'\)"/.test(
        run(`_boardCardHTML({id:'h9',type:'heading',x:0,y:0,w:300,h:60},true)`)));

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

  // ── Paste always collects ─────────────────────────────────────────────
  // Afnan: "make paste always collect into unsorted". This REVERSES the
  // Stage-1 rule, so what that rule protected has to hold instead: a paste
  // must never be invisible, and the copied-cards clipboard must never be
  // mistaken for somebody's text.
  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    const boot=()=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      currentPage='board-canvas';
      _editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
      _boardsUndo=[];_boardsRedo=[];_boardsClipboard=[];_boardsLineClipboard=[];
      _boardsTrayOpen=false;_boardsTrayTab='unsorted';_boardsEditingEl=null;moodBoards=[];`);
    // A paste event the real handler can read.
    const PASTE=`function(text,image){return{
      defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},
      clipboardData:{
        items:image?[{type:'image/png',getAsFile:function(){return image;}}]:[],
        getData:function(){return text||'';}
      }};}`;

    s.section('a pasted URL collects, with the panel shut');
    boot();
    run(`_mkPaste=${PASTE};_boardsOnPaste(_mkPaste('https://scuffers.com/p/1'))`);
    s.eq('it lands in Unsorted',run(`_editUnsorted.length`),1);
    s.eq('as a link item',run(`_editUnsorted[0].kind`),'link');
    s.eq('and nothing was placed on the canvas',run(`_editCards.length`),0);
    // The whole objection to this reversal: a paste into a panel nobody can
    // see is indistinguishable from a paste that did nothing.
    s.ok('the panel opened so you can see where it went',run(`_boardsTrayOpen`)===true);
    s.ok('the toast says so',/Unsorted/.test(app.state.toasts.join(' ')),app.state.toasts.slice(-1)[0]);

    s.section('plain text too');
    boot();
    run(`_mkPaste=${PASTE};_boardsOnPaste(_mkPaste('fleece 320gsm, ask Hassan'))`);
    s.eq('one note item',run(`_editUnsorted.length+':'+_editUnsorted[0].kind`),'1:text');
    s.eq('carrying the text',run(`_editUnsorted[0].text`),'fleece 320gsm, ask Hassan');

    // Home has no Unsorted to collect INTO, so it places — what a paste did
    // before the tray existed. This replaces the "switch to the Unsorted
    // tab" behaviour outright; there is no tab to switch to.
    s.section('on Home a paste PLACES, because there is nothing to collect into');
    boot();
    run(`_editBoard.isHome=true;_boardsTrayOpen=true;
      _mkPaste=${PASTE};_boardsOnPaste(_mkPaste('https://a.test/'))`);
    s.eq('nothing was collected',run(`_editUnsorted.length`),0);
    s.eq('a link card landed instead',run(`_editCards.length+':'+_editCards[0].type`),'1:link');
    boot();
    run(`_editBoard.isHome=true;_mkPaste=${PASTE};_boardsOnPaste(_mkPaste('fleece 320gsm'))`);
    s.eq('and plain text becomes a note card',run(`_editCards.length+':'+_editCards[0].type`),'1:text');
    s.eq('still nothing collected',run(`_editUnsorted.length`),0);

    s.section('CARDS copied from a board are still cards, tray open or shut');
    // This is the bug the reordering fixes. The tray branch used to run
    // FIRST, so with the tray open Ctrl+V of copied cards made a NOTE
    // holding the raw tagged JSON — and every paste collects now.
    boot();
    run(`_boardsTrayOpen=true;_mkPaste=${PASTE};
      _boardsOnPaste(_mkPaste(_BOARDS_CLIP_PREFIX+JSON.stringify([
        {id:'x',type:'text',text:'copied note',x:0,y:0,w:170,h:100}])))`);
    s.eq('a card, not a tray item',run(`_editCards.length`),1);
    s.eq('nothing was collected',run(`_editUnsorted.length`),0);
    s.ok('and no raw JSON anywhere',!/groovy-board/.test(run(`JSON.stringify(_editCards)`)));
    boot();
    run(`_editCards=[{id:'a',type:'text',x:0,y:0,w:170,h:100},{id:'b',type:'text',x:300,y:0,w:170,h:100}];
      _boardsTrayOpen=true;_mkPaste=${PASTE};
      _boardsOnPaste(_mkPaste(_BOARDS_CLIP_LINE_PREFIX+JSON.stringify([{free:true,x1:0,y1:0,x2:50,y2:50}])))`);
    s.eq('a copied LINE is a line',run(`_editConnectors.length`),1);
    s.eq('not a tray item',run(`_editUnsorted.length`),0);

    s.section('what still outranks the panel');
    boot();
    run(`_editCards=[{id:'img',type:'image',imageUrl:'',x:0,y:0,w:170,h:120}];
      _boardsSelection=new Set(['img']);
      _boardsUploadFileToCard=function(id,f){_calledWith=id;};
      _mkPaste=${PASTE};_boardsOnPaste(_mkPaste('',{name:'p.png',size:9,type:'image/png'}))`);
    s.eq('an image fills a selected EMPTY image card',run(`_calledWith`),'img');
    s.eq('rather than collecting',run(`_editUnsorted.length`),0);
    boot();
    // The guard is _boardsIsEditableFocus(), which reads the FOCUSED
    // element — so it covers an <input> too (the link form, the Find bar,
    // the Boards panel's search box), not only a card switched editable.
    app.state.activeElement={tagName:'DIV',isContentEditable:true};
    run(`_mkPaste=${PASTE};_boardsOnPaste(_mkPaste('some typing'))`);
    s.eq('text pasted into a card being edited belongs to that card',run(`_editUnsorted.length`),0);
    s.eq('and is not swallowed',run(`_editCards.length`),0);
    app.state.activeElement={tagName:'INPUT'};
    run(`_boardsOnPaste(_mkPaste('https://a.test/'))`);
    s.eq('nor is a URL typed into a search box collected',run(`_editUnsorted.length`),0);
    // Stage 1: an image beats an editing caret, because pasting one into a
    // contenteditable does nothing useful anyway.
    run(`_boardsOnPaste(_mkPaste('',{name:'p.png',size:9,type:'image/png'}))`);
    s.eq('an image still wins over an editing caret',run(`_editUnsorted.length`),1);
    app.state.activeElement=null;

    s.section('right-click → Paste is the one that still PLACES');
    s.ok('the menu no longer promises Ctrl+V pastes "here"',
      !/Ctrl\+V here/.test(require('fs').readFileSync(
        require('path').join(__dirname,'..','js/boards.js'),'utf8')));
    _pending.push((async()=>{
      boot();
      run(`navigator.clipboard.readText=function(){return Promise.resolve('https://a.test/x');}`);
      await run(`_boardsCtxPaste()`);
      s.eq('a card on the canvas',run(`_editCards.length+':'+(_editCards[0]||{}).type`),'1:link');
      s.eq('and nothing collected',run(`_editUnsorted.length`),0);
    })());
  }

  // ── Link previews ─────────────────────────────────────────────────────
  // The fetch itself lives in netlify/functions/link-preview.js and has its
  // own suite. What is worth holding here are the two judgement calls the
  // client makes with what comes back.
  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    const boot=()=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      _editBoard={id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];moodBoards=[];`);
    const META=`{host:'scuffers.com',title:'Club Navy Zipper',
      description:'Everyday Urban Aesthetics. As Always, With Love',siteName:'Scuffers',
      image:'https://scuffers.com/hero.jpg'}`;

    s.section('a preview fills in a pasted link');
    boot();
    run(`_editCards=[{id:'L',type:'link',linkUrl:'https://scuffers.com/p/1',
      linkTitle:'scuffers.com',linkDesc:'',x:0,y:0,w:_BOARDS_LINK_W,h:_BOARDS_LINK_H}]`);
    s.ok('applied',run(`_boardsApplyLinkMeta(_editCards[0],${META},'https://res.cloudinary.com/x/image/upload/h.jpg')`));
    s.eq('the real page title replaces the host placeholder',run(`_editCards[0].linkTitle`),'Club Navy Zipper');
    s.eq('the description arrives',run(`_editCards[0].linkDesc`),'Everyday Urban Aesthetics. As Always, With Love');
    s.eq('and OUR copy of the picture, never the remote one',
      run(`_editCards[0].linkImage`),'https://res.cloudinary.com/x/image/upload/h.jpg');
    s.eq('the card grows to preview size',run(`_editCards[0].w+'x'+_editCards[0].h`),
      run(`_BOARDS_LINK_PREVIEW_W+'x'+_BOARDS_LINK_PREVIEW_H`));

    s.section('what somebody typed outranks what the page calls itself');
    boot();
    run(`_editCards=[{id:'L',type:'link',linkUrl:'https://scuffers.com/p/1',
      linkTitle:'Navy hoodie ref',linkDesc:'ask Hassan',x:0,y:0,w:_BOARDS_LINK_W,h:_BOARDS_LINK_H}];
      _boardsApplyLinkMeta(_editCards[0],${META},'https://res.cloudinary.com/x/i.jpg')`);
    s.eq('the title is kept',run(`_editCards[0].linkTitle`),'Navy hoodie ref');
    s.eq('so is the description',run(`_editCards[0].linkDesc`),'ask Hassan');
    s.eq('but the picture still lands',run(`!!_editCards[0].linkImage`),true);

    s.section('a card somebody has already sized is never resized');
    boot();
    run(`_editCards=[{id:'L',type:'link',linkUrl:'https://a.test/',linkTitle:'a.test',x:0,y:0,w:420,h:300}];
      _boardsApplyLinkMeta(_editCards[0],${META},'https://res.cloudinary.com/x/i.jpg')`);
    s.eq('kept the hand size',run(`_editCards[0].w+'x'+_editCards[0].h`),'420x300');
    // No picture → a shorter card, because the whole card would otherwise be
    // empty space under two lines of text.
    boot();
    run(`_editCards=[{id:'L',type:'link',linkUrl:'https://a.test/',linkTitle:'a.test',x:0,y:0,w:_BOARDS_LINK_W,h:_BOARDS_LINK_H}];
      _boardsApplyLinkMeta(_editCards[0],${META},'')`);
    s.eq('a preview with no picture is a text-height card',
      run(`_editCards[0].h`),run(`_BOARDS_LINK_TEXT_H`));

    s.section('the preview replaces the three raw inputs');
    boot();
    run(`_editCards=[{id:'lnk1',type:'link',linkUrl:'https://scuffers.com/p/1',linkTitle:'Club Navy Zipper',
      linkDesc:'Everyday Urban Aesthetics',linkSite:'Scuffers',
      linkImage:'https://res.cloudinary.com/x/image/upload/h.jpg',x:0,y:0,w:250,h:280}]`);
    const card=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('a preview picture is drawn',/board-link-img/.test(card));
    s.ok('and the form is gone',!/board-link-edit/.test(card));
    // The title and description were written by a stranger's web page. Same
    // boundary as card text, comments and to-do items: structure only.
    s.ok('no third-party text anywhere in the markup',!/Club Navy|Urban Aesthetics|Scuffers/.test(card));
    s.ok('only empty nodes for it',/id="board-linkt-lnk1"[^>]*><\/a>/.test(card)&&/id="board-linku-lnk1"><\/span>/.test(card));

    s.section('the title IS the link, and opening it is not a hole');
    s.ok('a real anchor to the page',/<a class="link-title"[^>]*href="https:\/\/scuffers\.com\/p\/1"/.test(card));
    s.ok('in a new tab',/target="_blank"/.test(card));
    // Without rel=noopener the opened page can reach back through
    // window.opener. This is not decoration.
    s.ok('and the opened page cannot reach back',/rel="noopener noreferrer"/.test(card));
    // The anchor sits inside a drag surface: a pointerdown reaching the
    // handler retargets the click away and the link would never open — the
    // delete-✕ bug, now for the fourth time.
    s.ok('a press on the title does not start a card drag',
      /<a class="link-title"[^>]*onpointerdown="event\.stopPropagation\(\)"/.test(card));
    s.eq('http and https are hrefs',run(`_boardsSafeHref('https://a.test/x')`),'https://a.test/x');
    [`javascript:alert(1)`,`data:text/html,<script>`,`  JAVASCRIPT:alert(1)`,`file:///etc/passwd`,`x`,``]
      .forEach(u=>s.eq('refused: '+JSON.stringify(u),run(`_boardsSafeHref(${JSON.stringify(u)})`),''));
    run(`_editCards=[{id:'js1',type:'link',linkUrl:'javascript:alert(1)',linkTitle:'x',x:0,y:0,w:250,h:280}]`);
    const evil=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('a javascript: URL gets an anchor with NO href — plain text, not a link',
      /<a class="link-title"/.test(evil)&&!/href=/.test(evil));

    s.section('the preview picture can be turned off');
    boot();
    run(`_editCards=[{id:'L',type:'link',linkUrl:'https://a.test/',linkTitle:'a',
      linkImage:'https://res.cloudinary.com/x/i.jpg',x:0,y:0,w:_BOARDS_LINK_PREVIEW_W,h:_BOARDS_LINK_PREVIEW_H}];
      _boardsPushUndo=function(){};
      window.boardsLinkTogglePreview('L')`);
    s.eq('the flag is on the CARD, so everyone sees the same card',run(`_editCards[0].linkPreviewOff`),true);
    s.ok('no picture in the markup',!/board-link-img/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    s.eq('and the card shrinks to its text height',run(`_editCards[0].h`),run(`_BOARDS_LINK_TEXT_H`));
    run(`window.boardsLinkTogglePreview('L')`);
    s.ok('toggling back restores both',run(`!_editCards[0].linkPreviewOff&&_editCards[0].h===_BOARDS_LINK_PREVIEW_H`));
    // A card sized by hand keeps its size, like every other fit in this file.
    run(`_editCards[0].w=380;_editCards[0].h=420;window.boardsLinkTogglePreview('L')`);
    s.eq('a hand-sized card is not resized',run(`_editCards[0].h`),420);
    // Nothing to toggle without a picture, so nothing is offered.
    run(`_editCards=[{id:'N',type:'link',linkUrl:'https://a.test/',linkTitle:'a',x:0,y:0,w:250,h:150}]`);
    s.ok('and a card with no picture has no toggle',!/board-link-eye/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    s.ok('a preview card drags from its body like an image card',
      /board-link-preview" onpointerdown="window\.boardsCardDragStart/.test(card));
    // A card with no URL yet — the rail's Link tool — still needs the form.
    run(`_editCards=[{id:'lnk2',type:'link',linkUrl:'',linkTitle:'',linkDesc:'',x:0,y:0,w:170,h:120}]`);
    // A blank link card is Milanote's ONE field now; the three-input form
    // is what "Edit link details" opens.
    const blankHtml=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('a blank link card is one field',/board-link-new/.test(blankHtml)&&!/board-link-edit/.test(blankHtml));
    s.ok('and it says what to type',/placeholder="Enter a link URL"/.test(blankHtml));
    run(`_editCards=[{id:'lnk3',type:'link',linkUrl:'https://a.test/',linkTitle:'a',_linkEdit:true,x:0,y:0,w:170,h:120}]`);
    s.ok('and so is one being edited on purpose',/board-link-edit/.test(run(`_boardCardHTML(_editCards[0],true)`)));

    s.section('the in-flight flags never reach Firestore');
    boot();
    run(`_editCards=[{id:'L',type:'link',linkUrl:'https://a.test/',linkTitle:'a',x:0,y:0,w:170,h:120,
      _fetching:true,_linkEdit:true,_linkNoPreview:true,_linkFetched:'https://a.test/'}]`);
    const saved=run(`JSON.stringify(_boardsCardsForSave())`);
    s.ok('no _fetching — the "Uploading…" bug in a new place',saved.indexOf('_fetching')===-1);
    s.ok('nor any other underscore field',saved.indexOf('_link')===-1,saved);
    s.ok('the real fields are still written',/linkUrl/.test(saved));

    s.section('a preview picture goes into the PNG/PDF export too');
    s.eq('a link card offers its mirrored picture',
      run(`_boardsExportImageUrl({type:'link',linkImage:'https://res.cloudinary.com/x/i.jpg'})`),
      'https://res.cloudinary.com/x/i.jpg');
    s.eq('an image card is unchanged',
      run(`_boardsExportImageUrl({type:'image',imageUrl:'https://res.cloudinary.com/x/j.jpg'})`),
      'https://res.cloudinary.com/x/j.jpg');
    s.eq('and a note offers nothing',run(`_boardsExportImageUrl({type:'text',text:'x'})`),'');

    s.section('dragging a collected link out of Unsorted keeps its preview');
    boot();
    run(`_editUnsorted=[{id:'u1',kind:'link',linkUrl:'https://scuffers.com/p/1',linkTitle:'Club Navy Zipper',
      text:'Everyday Urban Aesthetics',linkSite:'Scuffers',linkImage:'https://res.cloudinary.com/x/h.jpg'}];
      _boardsPushUndo=function(){};`);
    run(`_editCards=[_boardsCardFromTrayItem(_editUnsorted[0],{x:10,y:10})]`);
    s.eq('the picture comes with it — not fetched a second time',
      run(`_editCards[0].linkImage`),'https://res.cloudinary.com/x/h.jpg');
    s.eq('so does the description',run(`_editCards[0].linkDesc`),'Everyday Urban Aesthetics');
    s.eq('and it lands at preview size',run(`_editCards[0].w+'x'+_editCards[0].h`),
      run(`_BOARDS_LINK_PREVIEW_W+'x'+_BOARDS_LINK_PREVIEW_H`));
    const tray=run(`_boardsTrayItemHTML(_editUnsorted[0],0,true)`);
    s.ok('and the tray row shows the picture, not a grey LINK box',
      /board-tray-thumb" src=/.test(tray)&&!/>LINK</.test(tray));
  }

  // ── Home's Boards panel ───────────────────────────────────────────────
  // The panel is DERIVED from the same query the gallery reads, which is
  // what lets "take a board off Home and it goes back to the list" need no
  // bookkeeping — and what made auto-place-on-open have to go, since the
  // two answered the same question in opposite directions.
  {
    const app=loadApp({files:FILES,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
    const {run}=app;
    const boot=()=>run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
      boardsLoaded=true;_boardsTrash=[];_editConnectors=[];_boardsSelection=new Set();
      _boardsUndo=[];_boardsRedo=[];_boardsPanelQuery='';_boardsPanelFilter='all';
      _editBoard={id:'H',isHome:true,ownerUid:'u1',visibility:'personal',title:'Home',zoom:1,panX:0,panY:0};
      _editCards=[];_editUnsorted=[];
      moodBoards=[
        {id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'},
        {id:'HX',isHome:true,ownerUid:'u9',title:'Home',cards:[],visibility:'personal'},
        {id:'A',title:'Winter Drop',ownerUid:'u1',visibility:'shared',ownerName:'Afnan',cards:[],updatedAt:9},
        {id:'B',title:'Fabric refs',ownerUid:'u2',visibility:'personal',ownerName:'Ammar',cards:[],updatedAt:5},
        {id:'SUB',title:'Nested',ownerUid:'u1',visibility:'shared',parentId:'A',cards:[],updatedAt:1}
      ];
      moodBoards[2].cards=[{id:'link',type:'board',boardId:'SUB',x:0,y:0,w:200,h:104}];`);

    s.section('opening Home no longer arranges it for you');
    boot();
    s.eq('sync places nothing',run(`_boardsHomeSync()`),0);
    s.eq('so Home stays as it was left',run(`_editCards.length`),0);
    // The safety net that makes that safe: the panel still lists them.
    s.eq('and the panel holds both root boards',
      run(`_boardsHomeList().map(b=>b.id).sort().join(',')`),'A,B');
    s.ok('never a Home, never this board, never a nested sub-board',
      run(`_boardsHomeList().every(b=>!b.isHome&&b.id!=='H'&&b.id!=='SUB')`));
    run(`_boardsHomePanelCollapsed=true`);
    s.ok('and a brand-new Home un-collapses the panel',
      run(`_boardsHomeFirstRun()&&_boardsHomePanelCollapsed===false`));
    // A nudge, not a setting. The harness leaves localStorage undefined (the
    // app guards every access), so persistence cannot be observed — but
    // _boardsSetHomePanel is the ONLY thing that writes the preference, and
    // first-run must assign the field instead of calling it.
    s.ok('by assigning the field, never through the persisting setter',
      !/_boardsSetHomePanel/.test(run(`String(_boardsHomeFirstRun)`)));
    run(`_editCards=[{id:'x',type:'text',text:'',x:0,y:0,w:170,h:100}]`);
    s.ok('but a Home somebody has already used is left alone',run(`_boardsHomeFirstRun()`)===false);

    s.section('filter and search');
    boot();
    s.eq('Team',run(`(_boardsPanelFilter='shared',_boardsPanelBoards().map(b=>b.id).join(','))`),'A');
    s.eq('Private',run(`(_boardsPanelFilter='personal',_boardsPanelBoards().map(b=>b.id).join(','))`),'B');
    s.eq('All, newest first',run(`(_boardsPanelFilter='all',_boardsPanelBoards().map(b=>b.id).join(','))`),'A,B');
    s.eq('search matches the title',run(`(_boardsPanelQuery='fabric',_boardsPanelBoards().map(b=>b.id).join(','))`),'B');
    s.eq('and the owner',run(`(_boardsPanelQuery='ammar',_boardsPanelBoards().map(b=>b.id).join(','))`),'B');
    s.eq('a miss is a miss',run(`(_boardsPanelQuery='zzz',_boardsPanelBoards().length)`),0);
    // Whose board it is, but only when it isn't yours.
    boot();
    s.ok('a row names someone else as the owner',/Ammar/.test(run(`_boardsPanelRowHTML(moodBoards[3],false,true)`)));
    s.ok('and never reads your own name back at you',!/Afnan/.test(run(`_boardsPanelRowHTML(moodBoards[2],false,true)`)));

    s.section('placing');
    boot();
    s.eq('nothing is on Home yet',run(`_boardsPanelUnplaced().length`),2);
    run(`window.boardsPanelRowClick('A')`);
    s.eq('clicking a row places that board',run(`_editCards.length`),1);
    s.eq('as a board card pointing at it',run(`_editCards[0].type+':'+_editCards[0].boardId`),'board:A');
    s.eq('and it is now "on Home"',run(`_boardsHomeCarded()['A']`),run(`_editCards[0].id`));
    s.eq('so the panel stops offering it',run(`_boardsPanelUnplaced().map(b=>b.id).join(',')`),'B');
    s.ok('placing is undoable, unlike the old automatic arrangement',run(`_boardsUndo.length>0`));
    const before=run(`_editCards.length`);
    run(`window.boardsPanelRowClick('A')`);
    s.eq('clicking an already-placed row scrolls to it rather than placing twice',
      run(`_editCards.length`),before);
    run(`window.boardsHomePlaceAll()`);
    s.eq('Place all takes the rest',run(`_editCards.filter(c=>c.type==='board').length`),2);
    s.eq('and then has nothing left to do',run(`_boardsPanelUnplaced().length`),0);

    s.section('taking a board off Home returns it to the panel, and leaves the board alone');
    boot();
    run(`window.boardsPanelRowClick('A');window.boardsDeleteCard(_editCards[0].id)`);
    s.eq('the card is gone',run(`_editCards.length`),0);
    s.ok('the board itself is untouched',run(`!!moodBoards.find(b=>b.id==='A'&&!b.deletedAt)`));
    s.eq('and it is back in the panel',
      run(`_boardsPanelUnplaced().map(b=>b.id).sort().join(',')`),'A,B');
    s.ok('the toast says where it went',
      /Boards panel/.test(app.state.toasts.join(' ')),app.state.toasts.slice(-1)[0]);
    // ✕ no longer trashes the board, so trashing it needs its own route.
    run(`_boardsSelection=new Set();window.boardsPanelRowClick('A');_boardsSelection=new Set([_editCards[0].id])`);
    s.ok('and the card menu carries one',
      JSON.stringify(run(`_boardsCardCtxItems(true)`)).indexOf('home-trash')>-1);

    s.section('the panel never interpolates a board title into its HTML');
    boot();
    run(`moodBoards[3].title='<img src=x onerror=alert(1)>'`);
    const rows=run(`_boardsPanelRowsHTML(true)`);
    s.ok('no title in the markup at all',!/onerror|Winter Drop/.test(rows));
    s.ok('only an empty node for it',/id="board-panel-n-A"[^>]*><\/div>/.test(rows));

    s.section("Home's panel is a fixture, and closing it is soft");
    boot();
    run(`_editBoard.isHome=true;_boardsHomePanelCollapsed=false;_boardsTrayOpen=false`);
    // Always open: it does not depend on the Unsorted tray's own open flag.
    const homePanel=run(`_renderBoardCanvasHTML()`);
    s.ok('the panel is there with the tray flag OFF',/class="board-tray wide"/.test(homePanel));
    s.ok('and it says Hide, not Close',/Hide ›/.test(homePanel));
    s.ok('the stage is inset so Fit cannot fit the board under it',
      /class="board-below with-panel"/.test(homePanel));
    run(`window.boardsCloseTray()`);
    s.ok('closing COLLAPSES rather than removing it',run(`_boardsHomePanelCollapsed`)===true);
    const collapsed=run(`_renderBoardCanvasHTML()`);
    s.ok('the rail is still on screen',/board-tray collapsed/.test(collapsed));
    s.ok('carrying the way back',/boardsTogglePanel\(\)/.test(collapsed));
    s.ok('and the stage takes the room',/with-panel-collapsed/.test(collapsed));
    run(`window.boardsTogglePanel()`);
    s.ok('and it comes back',run(`_boardsHomePanelCollapsed`)===false);
    // Collecting no longer reaches Home at all — a paste there PLACES (see
    // the paste section) — so what used to un-collapse the panel went with
    // the tray. Off Home it still opens a closed one, which is the half
    // that still has to hold: a paste that collects must never be invisible.
    run(`_editBoard.isHome=false;_boardsTrayOpen=false;_boardsCollectInto()`);
    s.ok('off Home, collecting still opens a closed tray',run(`_boardsTrayOpen`)===true);
    run(`_editBoard.isHome=true`);
    // Off Home nothing changed: Close still closes.
    run(`_editBoard.isHome=false;_boardsTrayOpen=true;window.boardsCloseTray()`);
    s.eq('the Unsorted tray still closes outright',run(`_boardsTrayOpen`),false);

    s.section("a board's own picture");
    s.eq('only an anchored Cloudinary URL is a picture',
      run(`_boardsCoverUrl('https://res.cloudinary.com/x/image/upload/a.jpg')`),
      'https://res.cloudinary.com/x/image/upload/a.jpg');
    [`https://res.cloudinary.com.evil.test/a.jpg`,`http://res.cloudinary.com/a.jpg`,
     `javascript:alert(1)`,`https://evil.test/res.cloudinary.com/a.jpg`,``]
      .forEach(u=>s.eq('refused: '+JSON.stringify(u),run(`_boardsCoverUrl(${JSON.stringify(u)})`),''));
    s.ok('a picture fills the tile',
      /board-tile-img/.test(run(`_boardsTileHTML({title:'X',coverUrl:'https://res.cloudinary.com/x/a.jpg'},54)`)));
    s.ok('an untrusted one falls back to the letter, never into an img src',
      !/evil|<img/.test(run(`_boardsTileHTML({title:'Xavier',coverUrl:'https://evil.test/a.jpg'},54)`)));
    s.ok('an emoji icon still wins over the letter',
      />W</.test(run(`_boardsTileHTML({title:'Zed',icon:'W'},54)`)));

    s.section('the row shows the whole name, never beside a button');
    boot();
    run(`_editBoard.isHome=true;
      moodBoards=[{id:'H',isHome:true,ownerUid:'u1',cards:[]},
        {id:'A',title:'WINTER DUMP 2K27',ownerUid:'u1',visibility:'personal',cards:[],updatedAt:1}];`);
    const row=run(`_boardsPanelRowHTML(moodBoards[1],false,true)`);
    s.ok('the name is its own element',/board-panel-name" id="board-panel-n-A"[^>]*><\/div>/.test(row));
    s.ok('and the actions are on their own line below it',
      row.indexOf('board-panel-name')<row.indexOf('board-panel-actions'));
    s.ok('the tile is the big one',/width:58px/.test(row));
    s.ok('a row carries the boards menu',/boardsPanelMenu\(event,'A'\)/.test(row));
    s.ok('on right-click too',/oncontextmenu="window\.boardsPanelMenu/.test(row));

    s.section('the two double-clicks Afnan asked for');
    s.ok('the NAME opens an inline rename',/ondblclick="event\.stopPropagation\(\);window\.boardsPanelRename\('A'\)/.test(row));
    s.ok('the TILE opens the look sheet',/ondblclick="event\.stopPropagation\(\);window\.boardsOpenBoardLook\('A'\)/.test(row));
    // Both swallow their own single click, or a double-click on an unplaced
    // board would PLACE it on the way to renaming it.
    s.ok('and neither lets a single click reach the row',
      (row.match(/onclick="event\.stopPropagation\(\)"/g)||[]).length>=2);
    // The gallery menu keeps ONE entry for all of it rather than four.
    const menu=JSON.stringify(run(`_boardsGalleryCtxItems(moodBoards[1])`));
    s.ok('one entry covers picture, colour, letter and icon',/g:look/.test(menu));
    s.ok('and the four separate ones are gone',!/g:cover|g:color|g:icon/.test(menu));


    s.section('search reaches the cards, and says so');
    boot();
    run(`_editBoard.isHome=true;_boardsPanelFilter='all';
      moodBoards=[{id:'H',isHome:true,ownerUid:'u1',cards:[]},
        {id:'A',title:'Winter Drop',ownerUid:'u1',visibility:'shared',updatedAt:2,
         cards:[{id:'c1',type:'text',text:'heavyweight fleece 320gsm'}]},
        {id:'B',title:'Fabric refs',ownerUid:'u1',visibility:'shared',updatedAt:1,cards:[]}];`);
    s.eq('a word only on a CARD still finds its board',
      run(`(_boardsPanelQuery='fleece',_boardsPanelBoards().map(b=>b.id).join(','))`),'A');
    s.ok('and the row says why it is there',
      /matching card/.test(run(`_boardsPanelRowHTML(moodBoards[1],false,true)`)));
    s.ok('a title match does not claim card hits',
      !/matching card/.test(run(`(_boardsPanelQuery='winter',_boardsPanelRowHTML(moodBoards[1],false,true))`)));
    s.ok('the list says how many matched',
      /1 board matched/.test(run(`(_boardsPanelQuery='fleece',_boardsPanelRowsHTML(true))`)));

    // Afnan: "there is no need for unsorted function in home". So the tab
    // strip went with it — a header carrying one tab says nothing — and the
    // panel on Home is the Boards panel, full stop.
    s.section('Home has no Unsorted at all');
    boot();
    run(`_boardsTrayOpen=true`);
    const homeBar=run(`_renderBoardCanvasHTML()`);
    s.ok('no tab strip',!/board-tray-tabs/.test(homeBar));
    s.ok('and no way back to an Unsorted tray',!/boardsTraySetTab/.test(homeBar));
    s.ok('the panel is still there',/board-panel-list/.test(homeBar));
    s.ok('and the top bar toggles the panel',/boardsTogglePanel\(\)/.test(homeBar));

    /* ── Dragging a board card back INTO the panel ──────────────────────
       Afnan drew the arrow the other way round. The gesture is driven for
       real here — boardsCardDragStart, a pointermove to make it a drag
       rather than a click, then a pointerup over the panel — because the
       whole thing lives in that handler's closure and grepping the source
       proves nothing about what it does. */
    s.section('a board card dropped on the panel comes off Home');
    {
      const app2=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas'});
      const r2=x=>app2.run(x);
      const setup=`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        moodBoards=[{id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'},
                    {id:'B',title:'WINTER DUMP 2K27',ownerUid:'u1',visibility:'personal',cards:[]}];
        _editCards=[{id:'k1',type:'board',boardId:'B',x:40,y:60,w:200,h:124}];
        _editConnectors=[];_editUnsorted=[];_boardsSelection=new Set(['k1']);
        _boardsUndo=[];_boardsRedo=[];_boardsHomePanelCollapsed=false;_boardsPanelFlash=null;
        _boardsSuppressClick=false;
        // The panel occupies the right-hand strip; the harness's default
        // rect has no right/bottom, so it is given a real one.
        document.getElementById('board-tray').getBoundingClientRect=
          function(){return{left:800,right:1200,top:0,bottom:600};};`;
      // Driven through the DOCUMENT listeners — see the note on the phone
      // threshold test: the capture is deferred, so the tracking is
      // document-wide.
      const fire=(x,y)=>{
        const ev=t=>({type:t,clientX:x,clientY:y,pointerId:1,altKey:false,shiftKey:false});
        (app2.state.listeners.pointermove||[]).slice().forEach(f=>f(ev('pointermove')));
        (app2.state.listeners.pointerup||[]).slice().forEach(f=>f(ev('pointerup')));
      };
      const drag=(x,y)=>{
        r2(`(function(){
          const head=document.getElementById('drag-head');
          window.boardsCardDragStart({currentTarget:head,target:head,clientX:0,clientY:0,pointerId:1,
            stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false},'k1');})()`);
        fire(x,y);
        return true;
      };

      r2(setup);
      drag(900,300);                      // inside the panel
      s.eq('the card is gone from Home',r2(`_editCards.length`),0);
      s.ok('the board itself is untouched',r2(`moodBoards.some(b=>b.id==='B'&&!b.deletedAt)`));
      s.ok('and the toast says it is still in the panel',
        /still in the Boards panel/.test(app2.state.toasts.join(' ')),app2.state.toasts.slice(-1)[0]);
      // ONE undo entry for the whole gesture, and it restores the card at
      // the position it was grabbed from — the drag's own entry is popped
      // before boardsDeleteCard pushes its own, or Ctrl+Z would put the
      // card back where it was dropped and need a second press.
      s.eq('one undo entry, not two',r2(`_boardsUndo.length`),1);
      r2(`window.boardsUndoAction()`);
      s.eq('undo brings it back',r2(`_editCards.length+':'+(_editCards[0]||{}).boardId`),'1:B');
      s.eq('exactly where it started',r2(`_editCards[0].x+','+_editCards[0].y`),'40,60');

      // Dropped on the CANVAS it is an ordinary move, not an unplace.
      r2(setup);
      drag(300,300);
      s.eq('a drop on the canvas keeps the card',r2(`_editCards.length`),1);

      // Only a lone board card qualifies. A note dropped on the panel is a
      // move like any other — "some of that did something" is worse than
      // not offering the gesture.
      r2(setup+`_editCards=[{id:'n1',type:'text',text:'',x:40,y:60,w:170,h:100}];
        _boardsSelection=new Set(['n1']);`);
      r2(`(function(){
        const head=document.getElementById('drag-head2');
        window.boardsCardDragStart({currentTarget:head,target:head,clientX:0,clientY:0,pointerId:1,
          stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false},'n1');})()`);
      fire(900,300);
      s.eq('a note dropped on the panel is just a move',r2(`_editCards.length`),1);
      s.ok('and the predicate says so directly',
        r2(`_boardsUnplaceDrag([{type:'text'}])===false&&_boardsUnplaceDrag([{type:'board',boardId:'B'}])===true`));
      s.ok('a board card with no boardId is not a drop target either',
        r2(`_boardsUnplaceDrag([{type:'board',boardId:''}])===false`));
      s.ok('nor is a multi-selection',
        r2(`_boardsUnplaceDrag([{type:'board',boardId:'B'},{type:'board',boardId:'C'}])===false`));
    }

    s.section('the row that changed state is flashed, once');
    {
      const app3=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const r3=x=>app3.run(x);
      r3(`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        moodBoards=[{id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'},
                    {id:'B',title:'Winter',ownerUid:'u1',visibility:'personal',cards:[]}];
        _editCards=[];_boardsPanelQuery='';_boardsPanelFilter='all';_boardsPanelFlash='B';`);
      s.ok('the flashed row carries the class',/board-panel-row[^"]*flash/.test(r3(`_boardsPanelRowsHTML(true)`)));
      // One-shot: the render that paints it consumes it, so the animation
      // cannot repeat on the next render.
      s.eq('and the flag is consumed',r3(`String(_boardsPanelFlash)`),'null');
      s.ok('so the next render has no flash',!/flash/.test(r3(`_boardsPanelRowsHTML(true)`)));
    }

    s.section('items left in Home’s retired tray are not stranded');
    {
      const app4=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const r4=x=>app4.run(x);
      r4(`_editBoard={id:'H',isHome:true,title:'Home',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        moodBoards=[{id:'H',isHome:true,ownerUid:'u1',title:'Home',cards:[],visibility:'personal'}];
        _editCards=[];_editConnectors=[];_boardsUndo=[];
        _editUnsorted=[{id:'u1',kind:'text',text:'ask Hassan'},{id:'u2',kind:'text',text:'and Alam'}];`);
      s.ok('the panel says so',/2 items were collected here/.test(r4(`_boardsPanelHTML(true)`)));
      r4(`window.boardsHomeFlushUnsorted()`);
      s.eq('placing them empties the tray',r4(`_editUnsorted.length`),0);
      s.eq('and makes a card each',r4(`_editCards.length`),2);
      s.eq('one undo entry for the lot',r4(`_boardsUndo.length`),1);
      s.ok('and the notice is gone for good',!/collected here/.test(r4(`_boardsPanelHTML(true)`)));
    }
    // Afnan, from a screenshot: the count should read as a count, not as
    // part of the label. All three counts (the two tabs and the top bar's
    // Boards button) carry .board-tray-tabn / .board-tray-reopen-n, which
    // paint var(--count-accent) — a REAL red that deliberately does not
    // invert, because it sits on backgrounds that swap (a tab or button is
    // transparent when idle and a var(--dark) chip when .on). The markup
    // half is what a logic suite can hold; the colour is measured by
    // smoke-layout in both themes.
    s.ok('the top bar count is a span, not bare text',
      /Boards <span class="board-tray-tabn">\d+<\/span>/.test(homeBar));
    s.ok('and so is the panel heading count',
      /board-tray-title">Boards <span class="board-tray-tabn">\d+<\/span>/.test(homeBar));
    run(`_editBoard={id:'A',title:'Winter Drop',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0}`);
    const plainBar=run(`_renderBoardCanvasHTML()`);
    s.ok('an ordinary board has no tab strip',!/boardsTraySetTab/.test(plainBar));
    s.ok('and keeps the plain Unsorted button',/boardsToggleTray\(\)/.test(plainBar));

    // Deferred, so the state it needs is built INSIDE the closure — the
    // sections below this one call boot() and would otherwise have replaced
    // moodBoards long before this ran.
    _pending.push((async()=>{
      s.section('the look sheet writes the tile fields, and only those');
      run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};currentPage='board-canvas';
        _editBoard={id:'H',isHome:true,ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        moodBoards=[{id:'H',isHome:true,ownerUid:'u1',cards:[]},
          {id:'A',title:'Winter',ownerUid:'u1',visibility:'shared',cards:[]}];
        _boardsLookTarget='A';_boardsOpenSheet=function(){};
        _boardsRenderCanvasAndWire=function(){};`);
      await run(`window.boardsLookIcon('27')`);
      s.eq('a number is just the icon field — no new field, no migration',
        run(`moodBoards[1].icon`),'27');
      await run(`window.boardsLookColor('#C2410C')`);
      s.eq('a colour is validated on the way in',run(`moodBoards[1].color`),'#C2410C');
      await run(`window.boardsLookColor('javascript:alert(1)')`);
      s.eq('and junk clears it rather than reaching a style attribute',
        run(`moodBoards[1].color===undefined`),true);
      // Restored immediately after: a stubbed getElementById would break
      // every later assertion in this file.
      run(`__realGEBI=document.getElementById;document.getElementById=function(){return{value:'  ABCD  '};}`);
      await run(`window.boardsLookText()`);
      run(`document.getElementById=__realGEBI`);
      s.eq('typed text is capped at two characters',run(`moodBoards[1].icon`),'AB');
      s.eq('a picture is the only thing that clears a picture',
        run(`(moodBoards[1].coverUrl='https://res.cloudinary.com/x/a.jpg',moodBoards[1].icon)`),'AB');
      await run(`window.boardsLookIcon(null,true)`);
      s.eq('removing it leaves the letter alone',
        run(`(moodBoards[1].coverUrl===undefined)+':'+moodBoards[1].icon`),'true:AB');
    })());
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
    // The trail replaced the "← Home" text (Sept 2026, Milanote's shape):
    // a round chip with the GROOVY mark, then Home, both pointing at Home.
    s.ok('and its trail starts at Home',/board-home-chip[^>]*onclick="window\.boardsGotoGallery\(\)"/.test(nb)&&/board-crumb-home[^>]*onclick="window\.boardsGotoGallery\(\)">Home</.test(nb));
    s.ok('with the board\'s own tile before its name',/board-crumb-slash">\/<\/span><span class="board-tile/.test(nb));
    s.ok('and no "← Home" text button beside it',!/← Home/.test(nb));
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

    /* ── THE 35 MB UPLOAD LIMIT ─────────────────────────────────────────
       Checked inside _boardsUploadAny, because that is the one function
       every upload route goes through — the drop, the picker, Replace, the
       Unsorted tray, a board's cover and the link-preview mirror. A guard
       on any one of those is a guard the other five walk past. The drop and
       the tray ALSO pre-check, so an oversized file never mints a card that
       sits on "Uploading…" and fails a minute later. */
    s.section('a file over 35 MB is refused before it is sent');
    {
      const MB=1024*1024;
      const up=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas',
        globals:{fetch:async()=>{throw new Error('the upload must not be attempted');}}});
      const r=x=>up.run(x);
      r(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        _editCards=[];_editConnectors=[];_editUnsorted=[];_boardsUndo=[];_boardsSelection=new Set();
        _boardsPlacementPoint=function(){return{x:0,y:0};};`);
      s.eq('the limit is 35 MB',r(`_BOARDS_MAX_UPLOAD_MB`),35);
      s.eq('and in bytes',r(`_BOARDS_MAX_UPLOAD`),35*MB);
      s.ok('35 MB exactly is allowed',!r(`_boardsTooBig({name:'a',size:${35*MB}})`));
      s.ok('a byte over is not',!!r(`_boardsTooBig({name:'a',size:${35*MB+1}})`));
      // _boardsMirrorPreviewImage hands this a remote URL STRING, which has
      // no size and is fetched by Cloudinary itself — it must pass.
      s.ok('a remote URL string is not size-checked',
        !r(`_boardsTooBig('https://example.test/a.jpg')`));
      s.ok('a file with no size at all is not refused',!r(`_boardsTooBig({name:'a'})`));

      // Dropping several files must add the ones that fit, not refuse the lot.
      r(`_boardsAddFiles([{name:'a.png',size:${2*MB},type:'image/png'},
        {name:'huge.mov',size:${60*MB},type:'video/quicktime'},
        {name:'b.png',size:${3*MB},type:'image/png'}],{x:0,y:0})`);
      s.eq('the files that fit are still added',r(`_editCards.length`),2);
      s.ok('and the one that does not is NAMED',
        /huge\.mov/.test(up.state.toasts.join(' '))&&/35 MB/.test(up.state.toasts.join(' ')),
        up.state.toasts.slice(-1)[0]);
      s.ok('no card was minted for it',
        !/huge/.test(r(`JSON.stringify(_editCards.map(c=>c.fileName||''))`)));
      // The tray is the other bulk path.
      r(`_editUnsorted=[];`);
      r(`_boardsTrayAddFiles([{name:'big.zip',size:${40*MB}},{name:'ok.png',size:${MB},type:'image/png'}])`);
      s.eq('the tray collects only what fits',r(`_editUnsorted.length`),1);

      // The message names the file and the limit, so a refusal is
      // actionable rather than "upload failed".
      const msg=r(`_boardsTooBigMsg({name:'huge.mov',size:${60*MB}})`);
      s.ok('the refusal names the file, its size and the limit',
        /huge\.mov/.test(msg)&&/60\.0 MB/.test(msg)&&/35 MB/.test(msg),msg);
      // And the gate itself refuses without ever reaching the network — the
      // stubbed fetch throws if it is called at all. Awaited through
      // _pending, never a `return` in the middle of the module: that ends
      // the function and silently drops every block below it (the bug that
      // once took the assertion total DOWN when tests were added).
      _pending.push((async()=>{
        const said=await r(`(async function(){try{
          await _boardsUploadAny({name:'huge.mov',size:${60*MB}});return'no error';
        }catch(e){return e.message;}})()`);
        s.section('the upload gate refuses without making a request');
        s.ok('it throws before fetch is reached',
          /huge\.mov/.test(said)&&/35 MB/.test(said),said);
      })());
    }

    /* ── DROPPING INTO A COLUMN IS AN OVERLAP TEST, NOT A CENTRE POINT ──
       Afnan: dropping into a column "does not work properly". Measured
       before changing anything (scratchpad/probe-drop-overlap.js, driving
       the real drag): of 272 positions where the card VISIBLY overlapped an
       empty column by a quarter or more, 90 were refused, and a card
       sitting 45% inside one still would not drop. The old rule asked
       whether an invisible centre pixel was inside; a person aims with the
       card, and the card is nearly as big as an empty column. */
    s.section('a card joins the column it overlaps');
    {
      const cd=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const r=x=>cd.run(x);
      r(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1};
        _editConnectors=[];_boardsSelection=new Set();
        _editCards=[{id:'col',type:'column',title:'',x:400,y:100,w:280,h:150}];`);
      // 45% of the card inside — the exact case the probe reported refused.
      s.ok('a card 45% inside joins it',
        !!r(`_boardsColumnForCard({x:420,y:45,w:220,h:100})`),
        'card y45..145 against a column at y100');
      s.ok('a card barely brushing the edge does NOT',
        !r(`_boardsColumnForCard({x:420,y:-5,w:220,h:100})`));
      s.ok('and a card fully inside obviously does',
        !!r(`_boardsColumnForCard({x:410,y:110,w:200,h:60})`));
      // min(card, column) is what makes both directions work: a big card
      // dropped squarely on a small column is as deliberate as the reverse.
      r(`_editCards=[{id:'small',type:'column',title:'',x:400,y:100,w:160,h:150}];`);
      s.ok('a card much bigger than the column still lands on it',
        r(`(_boardsColumnForCard({x:380,y:80,w:600,h:400})||{}).id`),'small');
      // Two columns overlapping the card: the one it is most over wins.
      r(`_editCards=[{id:'left',type:'column',title:'',x:0,y:100,w:300,h:200},
                     {id:'right',type:'column',title:'',x:300,y:100,w:300,h:200}];`);
      s.eq('the column it overlaps MOST wins',
        r(`(_boardsColumnForCard({x:220,y:120,w:200,h:100})||{}).id`),'right');
      s.eq('and the other way round',
        r(`(_boardsColumnForCard({x:180,y:120,w:200,h:100})||{}).id`),'left');
      // A locked column is not a target, and neither is one being dragged.
      r(`_editCards=[{id:'lk',type:'column',title:'',x:400,y:100,w:280,h:150,locked:true}];`);
      s.ok('a locked column takes no drops',!r(`_boardsColumnForCard({x:410,y:110,w:200,h:60})`));
      r(`_editCards=[{id:'me',type:'column',title:'',x:400,y:100,w:280,h:150}];`);
      s.ok('and a column being dragged is not its own target',
        !r(`_boardsColumnForCard({x:410,y:110,w:200,h:60},new Set(['me']))`));

      // Through the path the DRAG actually takes. Asserting the helper
      // alone proves the helper: it stays green with _boardsDropTargets
      // still wired to the old centre-point rule, which is the thing being
      // replaced. Verified by putting that call back — this is what fails.
      r(`_editCards=[{id:'col',type:'column',title:'',x:400,y:100,w:280,h:150},
                     {id:'n',type:'text',text:'x',x:420,y:45,w:220,h:100}];`);
      const drop=r(`(function(){const n=_editCards.find(c=>c.id==='n');
        return (_boardsDropTargets([n],new Set()).find(d=>d.card.id==='n')||{}).col;})()`);
      s.ok('the drag path itself lands a 45%-overlapping card in the column',
        !!drop&&drop.id==='col',drop?drop.id:'nothing');
    }

    /* ── COLLAPSE ────────────────────────────────────────────────────────
       The minus in Afnan's drawing. It is a way of LOOKING at a column, not
       an edit to it: the children stay in _editCards, keep their positions
       and keep counting, so search, the exports and the reading order are
       untouched — they are simply not drawn. */
    s.section('a column collapses to its header');
    {
      const cf=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas'});
      const r=x=>cf.run(x);
      r(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        _editConnectors=[];_editUnsorted=[];_boardsUndo=[];_boardsRedo=[];_boardsSelection=new Set();
        _editCards=[{id:'col',type:'column',title:'Sampling',x:400,y:100,w:280,h:150},
                    {id:'a',type:'text',text:'A',x:0,y:0,w:256,h:90,columnId:'col'},
                    {id:'b',type:'text',text:'B',x:0,y:0,w:256,h:90,columnId:'col'}];
        _boardsLayoutColumns();`);
      const openH=Number(r(`_editCards[0].h`));
      const kidY=r(`_boardsColumnChildren(_editCards[0]).map(c=>c.y).join(',')`);
      r(`window.boardsFoldContainer('col')`);
      s.eq('it shrinks to exactly the header',r(`_editCards[0].h`),Number(r(`_BOARDS_COL_HEAD`)));
      s.eq('its children are not drawn',r(`_boardsRenderOrder().map(c=>c.id).join(',')`),'col');
      s.eq('but they are still on the board',r(`_boardsColumnChildren(_editCards[0]).length`),2);
      s.eq('and they have not been moved',
        r(`_boardsColumnChildren(_editCards[0]).map(c=>c.y).join(',')`),kidY);
      const html=r(`_boardCardHTML(_editCards[0],true)`);
      s.ok('the header still says how many are inside',/board-column-count">2 cards/.test(html));
      s.ok('the glyph flips to +',/board-column-fold[^>]*>\+</.test(html));
      s.ok('and the body panel is gone with them',!/board-column-body/.test(html));
      s.ok('a collapsed column takes no drops',
        !r(`_boardsColumnForCard({x:410,y:110,w:200,h:60})`));
      r(`window.boardsFoldContainer('col')`);
      s.eq('expanding puts the height back',r(`_editCards[0].h`),openH);
      s.eq('and the list back exactly as it was',
        r(`_boardsColumnChildren(_editCards[0]).map(c=>c.y).join(',')`),kidY);
      // Every mutating action pushes undo BEFORE it mutates — the module's
      // standing contract.
      s.eq('both folds are undoable',r(`_boardsUndo.length`),2);
      r(`window.boardsUndoAction()`);
      s.eq('undo folds it again',r(`!!_editCards[0].collapsed`),true);
    }

    /* ── A FRAME WEARS THE COLUMN'S TITLE BLOCK ─────────────────────────
       Afnan: "now do the frame like the column". The same centred name,
       the same count under it, the same collapse minus. The ONE real
       difference is where the count comes from — a column owns its
       children by c.columnId, a frame owns whatever is geometrically
       inside it, so the frame's is counted at render and stores nothing. */
    s.section('a frame wears the column title block');
    {
      const fr=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas'});
      const r=x=>fr.run(x);
      r(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        _editConnectors=[];_editUnsorted=[];_boardsUndo=[];_boardsRedo=[];_boardsSelection=new Set();
        _editCards=[{id:'fr',type:'frame',title:'',x:100,y:100,w:400,h:300},
                    {id:'a',type:'text',text:'A',x:130,y:150,w:170,h:80},
                    {id:'b',type:'text',text:'B',x:330,y:150,w:170,h:80},
                    {id:'out',type:'text',text:'OUT',x:700,y:150,w:170,h:80}];`);
      const h=r(`_boardCardHTML(_editCards[0],true)`);
      s.ok('the empty title reads "New Frame"',/placeholder="New Frame"/.test(h));
      s.ok('the count is the cards geometrically inside it',
        /board-frame-count">2 cards</.test(h),
        (h.match(/board-frame-count">[^<]*/)||[''])[0]);
      s.ok('the card outside it is not counted',r(`_boardsCardsInFrame(_editCards[0]).length`)===2);
      s.ok('it carries the same collapse button',/board-column-fold[^>]*boardsFoldContainer/.test(h));
      s.ok('delete is still reachable',/board-card-del[^>]*boardsDeleteCard/.test(h));
      s.ok('and the same selection dot',/board-card-corner/.test(h));
      s.ok('the header still starts the frame drag',
        /board-frame-head"[^>]*boardsCardDragStart/.test(h));
      s.ok('one card is singular',
        /board-frame-count">1 card</.test(r(`(function(){
          _editCards=_editCards.filter(c=>c.id!=='b');
          return _boardCardHTML(_editCards[0],true);})()`)));
      // The floor moved with the header: a frame could be dragged to 60px,
      // which is UNDER the 63px title block, so its own header overflowed
      // its box. Existing frames are not rewritten — the render grows them.
      s.ok('a frame cannot be shorter than its own title block',
        Number(r(`_boardsMinCardH({type:'frame'})`))>=Number(r(`_BOARDS_COL_HEAD`)));
      s.ok('and a short stored height is grown by the render, not migrated',
        /height:150px/.test(r(`(function(){_editCards[0].h=60;
          return _boardCardHTML(_editCards[0],true);})()`))&&r(`_editCards[0].h`)===60);
    }

    /* ── Folding a frame, and the height it has to remember ─────────────
       A column's height is DERIVED, so expanding recomputes it. A frame's
       is whatever somebody dragged it to, so the fold keeps it — and that
       kept height is also what membership is measured against while it is
       folded, or a folded frame would report nothing inside it, say
       "0 cards", and leave its contents behind when dragged. */
    s.section('a frame collapses to its header');
    {
      const ff=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas'});
      const r=x=>ff.run(x);
      const boot=()=>r(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        _editConnectors=[];_editUnsorted=[];_boardsUndo=[];_boardsRedo=[];_boardsSelection=new Set();
        _boardsSuppressClick=false;_boardsSnapGrid=false;
        _editCards=[{id:'fr',type:'frame',title:'Archived',x:100,y:100,w:400,h:300},
                    {id:'a',type:'text',text:'A',x:130,y:150,w:170,h:80},
                    {id:'b',type:'text',text:'B',x:330,y:150,w:170,h:80},
                    {id:'out',type:'text',text:'OUT',x:700,y:150,w:170,h:80}];`);
      boot();
      r(`window.boardsFoldContainer('fr')`);
      s.eq('it shrinks to exactly the header',r(`_editCards[0].h`),Number(r(`_BOARDS_COL_HEAD`)));
      s.eq('it remembers the height it had',r(`_editCards[0].openH`),300);
      s.eq('its contents are not drawn',r(`_boardsRenderOrder().map(c=>c.id).join(',')`),'fr,out');
      s.eq('but it still knows what it is hiding',r(`_boardsCardsInFrame(_editCards[0]).length`),2);
      s.ok('and says so in the header',
        /board-frame-count">2 cards</.test(r(`_boardCardHTML(_editCards[0],true)`)));
      s.eq('nothing inside it moved',
        r(`_editCards.filter(c=>c.type==='text').map(c=>c.x+','+c.y).join('|')`),
        '130,150|330,150|700,150');
      r(`window.boardsFoldContainer('fr')`);
      s.eq('expanding puts the height back',r(`_editCards[0].h`),300);
      s.eq('and forgets the remembered one',r(`_editCards[0].openH===undefined`),true);
      s.eq('both folds are undoable',r(`_boardsUndo.length`),2);

      // A frame takes its contents with it when dragged — and that must
      // still be true when the contents are the ones it is hiding.
      boot();
      r(`window.boardsFoldContainer('fr');_boardsSelection=new Set(['fr']);
        (function(){const h=document.getElementById('dh');
          window.boardsCardDragStart({currentTarget:h,target:h,clientX:0,clientY:0,pointerId:1,
            stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false},'fr');})()`);
      const ev=t=>({type:t,clientX:200,clientY:0,pointerId:1,altKey:true,shiftKey:false});
      (ff.state.listeners.pointermove||[]).slice().forEach(f=>f(ev('pointermove')));
      (ff.state.listeners.pointerup||[]).slice().forEach(f=>f(ev('pointerup')));
      s.eq('a collapsed frame still carries what it hides',
        r(`_editCards.filter(c=>c.id==='a'||c.id==='b').map(c=>c.x).join(',')`),'330,530');
      s.eq('and leaves the card outside it alone',r(`_editCards.find(c=>c.id==='out').x`),700);

      // One implementation for both containers.
      s.ok('a locked container refuses to fold',r(`(function(){
        _editCards=[{id:'lk',type:'frame',title:'',x:0,y:0,w:300,h:300,locked:true}];
        window.boardsFoldContainer('lk');return !_editCards[0].collapsed;})()`));
      s.ok('and an ordinary card is not foldable at all',r(`(function(){
        _editCards=[{id:'n',type:'text',text:'x',x:0,y:0,w:100,h:100}];
        window.boardsFoldContainer('n');return !_editCards[0].collapsed;})()`));
    }

    /* ── The header Afnan drew ─────────────────────────────────────────── */
    s.section('the column header is a title block');
    {
      const ch=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      ch.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1};
        _editConnectors=[];_boardsSelection=new Set();
        _editCards=[{id:'col',type:'column',title:'',x:0,y:0,w:280,h:150}];`);
      const h=ch.run(`_boardCardHTML(_editCards[0],true)`);
      s.ok('the empty title reads "New Column"',/placeholder="New Column"/.test(h));
      s.ok('the count is words, not a chip',/board-column-count">0 cards</.test(h));
      s.ok('one card is singular',
        /board-column-count">1 card</.test(ch.run(`(function(){
          _editCards.push({id:'k',type:'text',text:'x',x:0,y:0,w:10,h:10,columnId:'col'});
          return _boardCardHTML(_editCards[0],true);})()`)));
      s.ok('the header still starts the column drag',
        /board-column-head"[^>]*boardsCardDragStart/.test(h));
      s.ok('the title does not — it is a field',
        /board-column-title[^>]*onpointerdown="event\.stopPropagation\(\)"/.test(h));
      s.ok('delete is still reachable',/board-card-del[^>]*boardsDeleteCard/.test(h));
      s.ok('and a selected column wears the same dot a card does',
        /board-card-corner/.test(h));
    }

    s.section('layout derives position, width and the column height');
    s.eq('children share the column x',run(`_editCards[1].x+','+_editCards[2].x`),'112,112');
    // Read off the CONSTANTS, not written as literals. The title block grew
    // from a 30px strip to the 63px name-and-count block Afnan drew, and a
    // hardcoded 142 here would have to be re-derived by hand every time the
    // header changes — the same reason the file card's page maths reads
    // _BOARDS_FILE_CHROME_H instead of 66.
    const HEAD=Number(run(`_BOARDS_COL_HEAD`)),PAD=Number(run(`_BOARDS_COL_PAD`)),
          GAP=Number(run(`_BOARDS_COL_GAP`));
    const firstY=100+HEAD+PAD;                       // the column sits at y=100
    s.eq('and are stacked in order',run(`_editCards[1].y+','+_editCards[2].y`),
      firstY+','+(firstY+100+GAP));
    s.eq('width comes from the column, not the card',run(`_editCards[1].w+','+_editCards[2].w`),'256,256');
    // head + pad + every child and the gaps between them + pad
    const kidH=JSON.parse(run(`JSON.stringify(_boardsColumnChildren(_editCards[0]).map(c=>c.h))`));
    s.eq('height is derived from the contents',run(`_editCards[0].h`),
      HEAD+PAD+kidH.reduce((a,b)=>a+b,0)+GAP*(kidH.length-1)+PAD);
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
    s.ok('a column IS stashable now, children and all',/stash/.test(m));
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
    // The id is pinned because a card's real id carries Date.now(), and
    // this assertion searches the WHOLE markup — where that id appears in
    // `id`, `data-id` and every inline handler. A timestamp containing the
    // digits 245 (1789724573410 did, on 18 Sept 2026) failed the check with
    // nothing wrong in the app at all. Found by reading the match, not by
    // re-running until it passed.
    run(`_editCards[0].id='tblA';_editCards[0].rows=[['Fabric','GSM'],['Drill','245']]`);
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
    // A Trash at the foot, because deleted cards really do go somewhere
    // now. It is a DESTINATION, not a second Delete button — the router
    // sends it to the panel and it never removes anything.
    s.ok('a Trash at the foot',acts.indexOf('trash')>-1);
    s.eq('and it is the last tool',acts.trim().split(' ').pop(),'trash');
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

    /* ── The bin fills up (Sept 2026) ─────────────────────────────────
       Afnan: the number darkens as the count rises, white through phases to
       red, and at 30 the bin animates to ask to be emptied — with a way to
       ignore that for 24 hours.

       WHAT HOLDS WHAT. The COLOURS are smoke-layout's: the ink sits on a
       chip that INVERTS, and no logic suite can see a colour. The DOM toggle
       itself is held by neither — the harness's querySelector returns null,
       so _boardsPaintTrashCount bails there — which is exactly why the
       decision it paints was extracted into _boardsTrashAlarm. This holds
       the boundaries, the threshold and the snooze. */
    s.section('the badge phases are exact at their boundaries');
    {
      const store={};
      const ls={getItem:k=>(k in store?store[k]:null),
                setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
      const t=loadApp({files:['js/boards.js'],globals:{localStorage:ls},
        session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const tr=x=>t.run(x);
      const phase=n=>tr(`_boardsTrashPhase(${n})`);
      // Off by one at either end is the whole risk in a banded scale.
      s.eq('nothing at all below the first band',[0,1,9].map(phase).join('|'),'||');
      s.eq('the first band starts at 10',[10,19].map(phase).join('|'),'fill-1|fill-1');
      s.eq('the second at 20',[20,29].map(phase).join('|'),'fill-2|fill-2');
      s.eq('and the last exactly at the threshold',
        [30,31,500].map(phase).join('|'),'fill-3|fill-3|fill-3');
      s.eq('which is the same 30 the alarm uses',tr(`_BOARDS_TRASH_FULL`),30);

      s.section('the bin only asks once it is actually full');
      tr(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
        _editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal'};
        _editCards=[];_editConnectors=[];_boardsCardTrash=[];`);
      s.ok('29 does not shake',!tr(`_boardsTrashAlarm(29)`));
      s.ok('30 does',tr(`_boardsTrashAlarm(30)`));
      s.ok('and so does anything past it',tr(`_boardsTrashAlarm(400)`));

      s.section('ignore for 24 hours');
      const nagFull=tr(`_boardsTrashNagHTML(30)`);
      s.ok('the ask only appears at the threshold',
        tr(`_boardsTrashNagHTML(29)`)===''&&nagFull.length>0);
      s.ok('and it offers the snooze',/boardsTrashSnooze/.test(nagFull));
      // It states the COUNT, not "full": 30 is a nudge, not a limit, and
      // nothing stops working at it. A message implying otherwise would lie.
      s.ok('it states the count rather than claiming a limit',
        /30 deleted cards/.test(nagFull)&&!/full/i.test(nagFull),nagFull);
      tr(`window.boardsTrashSnooze()`);
      s.ok('taking it silences the alarm',!tr(`_boardsTrashAlarm(30)`));
      // The count is still 30 — only the nagging stopped.
      s.eq('but the badge still reads as full',phase(30),'fill-3');
      const snoozed=tr(`_boardsTrashNagHTML(30)`);
      s.ok('and the strip says so rather than vanishing',
        /Not asking again until/.test(snoozed)&&!/boardsTrashSnooze/.test(snoozed),snoozed);
      const until=tr(`_boardsTrashSnoozedUntil('b1')`);
      s.eq('for 24 hours',Math.round((until-Date.now())/3600000),24);
      // PER BOARD: a board you have not looked at must not be silenced too.
      s.eq('another board is untouched',tr(`_boardsTrashSnoozedUntil('other')`),0);

      s.section('an expired snooze is ignored, and pruned on the next write');
      tr(`localStorage.setItem('groovy-boards-trash-snooze',
        JSON.stringify({old:Date.now()-1000,b1:Date.now()-1000}))`);
      s.eq('a stale entry does not count',tr(`_boardsTrashSnoozedUntil('b1')`),0);
      s.ok('so the bin asks again',tr(`_boardsTrashAlarm(30)`));
      tr(`window.boardsTrashSnooze()`);
      s.eq('and the next write drops the dead key',
        tr(`Object.keys(JSON.parse(localStorage.getItem('groovy-boards-trash-snooze'))).join(',')`),
        'b1');
      // A corrupt value must not take the module down on a read path.
      tr(`localStorage.setItem('groovy-boards-trash-snooze','not json')`);
      s.eq('and junk in the key reads as no snooze',tr(`_boardsTrashSnoozedUntil('b1')`),0);
      // Nothing here is board data: it is about being nagged, on this
      // device. The same rule the minimap, snap and the tray follow.
      s.eq('nothing was written to Firestore',t.state.writes.length,0);
    }

    s.section('drag-to-place — click-to-place is unchanged');
    // The spec's single-click-then-click-to-place is NOT built: a browser
    // session could not reproduce it in the real product or find any armed
    // affordance, and our click already places immediately.
    const html6=run(`(()=>{_boardsRenderRail();
      const h=document.getElementById('board-rail');return h?h.innerHTML:'';})()`);
    s.ok('draggable tools are marked in the markup',/data-drag="1"/.test(html6));
    s.ok('and say so in their tooltip',/drag onto the board/.test(html6));
    /* BOARD IS DRAGGABLE NOW (Sept 2026 — Afnan circled the tool and drew an
       arrow onto the canvas). It places a card like every other tool; it
       just mints the board behind it first. The three that are still
       click-only are the three that place nothing. */
    s.ok('the Board tool is a drag source',
      run(`_BOARDS_RAIL_MAIN.filter(i=>i.act==='add:board')[0].drag===true`));
    // The flag only matters if it reaches the DOM: _boardsRailDragStart
    // starts a drag from [data-act][data-drag="1"] and nothing else.
    s.ok('and the rendered rail marks it',
      /data-act="add:board"[^>]*data-drag="1"|data-drag="1"[^>]*data-act="add:board"/.test(html6),
      (html6.match(/<button[^>]*add:board[^>]*>/)||[])[0]||'(no Board button)');
    s.ok('a tool that places nothing is not marked',
      run(`_BOARDS_RAIL_MAIN.filter(i=>i.act==='line')[0].drag===undefined
        &&_BOARDS_RAIL_MEDIA.every(i=>i.drag===undefined)`));

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

    /* THE DROP POINT ONLY SURVIVES IF THE LAST RIGHT-CLICK IS FORGOTTEN.
       _boardsCtxWorld is set when the context menu OPENS and is never
       cleared when it closes, and _boardsCtxRun's place() overwrites
       _boardsNextPlacement from it — so after ONE right-click anywhere on
       the canvas, every rail drag landed its card at that point instead of
       under the pointer. Live since M6. The rail's CLICK path already
       cleared it; the drag path was missed.
       Verified by reverting: the drop below lands at -1089,-1039. */
    s.section('a stale right-click cannot hijack the drop point');
    boot();
    run(`_boardsSelection=new Set();_editCards=[];_boardsNextPlacement=null;
      _boardsCtxWorld={x:-999,y:-999};
      __stage=document.getElementById('board-stage');
      __stage.getBoundingClientRect=()=>({left:0,top:0,right:1000,bottom:800,width:1000,height:800});
      __btn={getAttribute:()=>'add:text',getBoundingClientRect:()=>({left:0,top:0,right:40,bottom:40})};
      __ev=(x,y)=>({clientX:x,clientY:y,button:0,target:{closest:()=>__btn}});
      _boardsRailDragStart(__ev(20,20));_boardsRailDragMove(__ev(300,300));
      _boardsRailDragEnd(__ev(300,300));`);
    s.eq('the card lands where the pointer was released',
      run(`JSON.stringify({x:_editCards[0].x,y:_editCards[0].y})`),
      JSON.stringify({x:210,y:260}));
    s.ok('and the stale point is dropped rather than left to fire again',
      run(`_boardsCtxWorld===null`));

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

    /* ── A cell double-clicks to edit AND the table drags by its grid ────
       The cell used to stop pointerdown unconditionally: the drag captured
       the pointer on the pointerdown, and a captured pointer retargets the
       following dblclick to the capturing element, so the cell's handler
       never ran and double-clicking a table spawned a stray note. The
       recorded cost — "a table no longer drags by its cells" — turned out
       to be the to-do card's bug in another place: the grid inherits
       cursor:grab from the card body, so ~44% of a table card promised a
       grab and would not move. The capture is deferred past the drag
       threshold now, so the guard is needed only on cells that act on a
       SINGLE click. */
    s.section('a text cell drags, a checkbox cell does not');
    boot();
    const cellHtml=run(`_boardCardHTML(_editCards[0],true)`);
    const tds=cellHtml.match(/<t[dh] id="board-td-[^>]*>/g)||[];
    const textCells=tds.filter(t=>/ondblclick/.test(t));
    s.ok('the table renders text cells',textCells.length>0,tds.length+' cells');
    s.ok('a text cell lets the press through to the card drag',
      textCells.every(t=>t.indexOf('onpointerdown')<0),
      (textCells.find(t=>t.indexOf('onpointerdown')>=0)||'').slice(0,110));
    s.ok('and still offers the double-click that opens it',
      textCells.every(t=>/ondblclick="window\.boardsFocusCell/.test(t)));
    // A checkbox cell toggles on a single click, so a drag must not begin
    // on it.
    const checkHtml=run(`_boardCardHTML(Object.assign({},_editCards[0],
      {rows:[[{v:'x',t:'check'}]]}),true)`);
    const checks=(checkHtml.match(/<t[dh] id="board-td-[^>]*>/g)||[]).filter(t=>/boardsCellToggle/.test(t));
    s.ok('a checkbox cell renders',checks.length>0,checks.length+' cells');
    s.ok('and it keeps the pointerdown guard',
      checks.every(t=>t.indexOf('onpointerdown="event.stopPropagation()"')>-1),
      (checks[0]||'').slice(0,110));
    // The A/B/C band and the row gutter are chrome, not data — they have
    // always kept the drag, and still do.
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

  // ── M8: no Trash, so every delete says it is undoable ─────────────────
  // The spec's build note asks for a recoverable Trash. This file declined
  // it twice on purpose (Stage 1 for cards, again for lines) because Ctrl+Z
  // already covers them — and that is only defensible if the keystroke is
  // discoverable. These assertions are the thing that keeps it so: a delete
  // path that stops naming the undo is a delete path with no safety net a
  // person can find.
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    const {run,state}=app;
    const boot=()=>{
      state.toasts.length=0;
      run(`_editBoard={id:'b1',title:'B',ownerUid:'u1',visibility:'personal'};
           _editCards=[
             {id:'n',type:'text',text:'note',x:0,y:0,w:170,h:100},
             {id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/a.jpg',x:200,y:0,w:170,h:100},
             {id:'t',type:'table',rows:[['A']],x:400,y:0,w:240,h:140}
           ];
           _editConnectors=[{id:'L',from:'n',to:'p'}];
           _boardsSelection=new Set();_boardsConnSel=null;`);
    };

    s.section('every card type has a noun, so no toast reads "Card deleted"');
    // The delete toast is the only place these strings surface, and a type
    // missing from the map degrades to the generic word silently.
    [['text','Note'],['todo','To-do'],['board','Board link'],['frame','Frame'],
     ['column','Column'],['table','Table'],['heading','Heading'],
     ['image','Image'],['file','File'],['link','Link']].forEach(([t,n])=>{
      s.eq(t+' → '+n,run(`_boardsCardNoun({type:'${t}'})`),n);
    });
    s.eq('an unknown type still says something',run(`_boardsCardNoun({type:'zzz'})`),'Card');
    s.eq('and a missing card does not throw',run(`_boardsCardNoun(null)`),'Card');

    s.section('deleting a card names what went and how to get it back');
    boot();
    run(`window.boardsDeleteCard('n')`);
    s.ok('the toast names the card',/Note deleted/.test(state.toasts.join(' ')),state.toasts.join(' | '));
    s.ok('and names the keystroke',/Ctrl\+Z/.test(state.toasts.join(' ')));
    s.ok('an undo entry really is there to use',run(`_boardsUndo.length>0`));
    run(`window.boardsUndoAction()`);
    s.eq('and it brings the card back',run(`_editCards.filter(c=>c.id==='n').length`),1);

    s.section('a table says table, not note');
    // The card header's own type label had this bug: no `table` branch, so
    // a table introduced itself as a NOTE. Same map, same risk.
    boot();
    run(`window.boardsDeleteCard('t')`);
    s.ok('Table deleted',/Table deleted/.test(state.toasts.join(' ')),state.toasts.join(' | '));

    s.section('exactly ONE toast fires per delete');
    // The column-released and sub-board-link branches are chained with
    // `else`; unchained, a column delete would say both "kept on the board"
    // and "Column deleted — press Ctrl+Z".
    boot();
    run(`_editCards.push({id:'col',type:'column',x:700,y:0,w:256,h:120,title:'C'},
                         {id:'k',type:'text',text:'in',x:700,y:30,w:256,h:100,columnId:'col'});
         _boardsLayoutColumns()`);
    state.toasts.length=0;
    run(`window.boardsDeleteCard('col')`);
    s.eq('one toast, not two',state.toasts.length,1,state.toasts.join(' | '));
    s.ok('and it is the one about the kept card',/kept on the board/.test(state.toasts[0]));
    s.ok('not the undo toast',!/Ctrl\+Z/.test(state.toasts[0]));

    s.section('a sub-board link says where the board went, not Ctrl+Z');
    boot();
    run(`_editCards.push({id:'sb',type:'board',boardId:'b2',boardTitle:'Child',x:900,y:0,w:170,h:104})`);
    state.toasts.length=0;
    run(`window.boardsDeleteCard('sb')`);
    s.eq('still one toast',state.toasts.length,1,state.toasts.join(' | '));
    s.ok('naming the boards list',/boards list/.test(state.toasts[0]));

    s.section('a bulk delete counts what it removed');
    boot();
    run(`_boardsSetSelection(['n','p']);window.boardsDeleteSelection()`);
    s.ok('plural and countable',/2 cards deleted/.test(state.toasts.join(' ')),state.toasts.join(' | '));
    s.ok('with the keystroke',/Ctrl\+Z/.test(state.toasts.join(' ')));
    boot();
    run(`_boardsSetSelection(['n']);window.boardsDeleteSelection()`);
    s.ok('singular reads as singular',/1 card deleted/.test(state.toasts.join(' ')),state.toasts.join(' | '));

    s.section('deleting a line says so too');
    boot();
    run(`window.boardsDeleteConnector('L')`);
    s.ok('Line deleted — Ctrl+Z',/Line deleted.*Ctrl\+Z/.test(state.toasts.join(' ')),state.toasts.join(' | '));
    run(`window.boardsUndoAction()`);
    s.eq('and undo restores it',run(`_editConnectors.length`),1);

    s.section('the confirmed destructive action states it in the CONFIRM');
    // boardsDeleteColumnAndCards is the one delete that asks first, so the
    // undo belongs in the question, not in a toast after the fact.
    boot();
    run(`_editCards.push({id:'col',type:'column',x:700,y:0,w:256,h:120,title:'C'},
                         {id:'k',type:'text',text:'in',x:700,y:30,w:256,h:100,columnId:'col'});
         _boardsLayoutColumns();_boardsSetSelection(['col'])`);
    state.confirms.length=0;
    run(`window.boardsDeleteColumnAndCards()`);
    s.ok('the question names Ctrl+Z',/Ctrl\+Z/.test(state.confirms.join(' ')),state.confirms.join(' | '));

    s.section('the tray is honest that it is NOT undoable');
    // _boardsPushUndo snapshots cards and connectors only — the Unsorted
    // tray is saved in `head` and is genuinely not recoverable. The confirm
    // says exactly that, and must keep saying it.
    boot();
    run(`_editUnsorted=[{id:'u1',kind:'text',text:'x'}]`);
    state.confirms.length=0;
    run(`window.boardsTrayRemove(0)`);
    s.ok('it says it cannot be undone',/cannot be undone/i.test(state.confirms.join(' ')),state.confirms.join(' | '));
    s.ok('and does not promise Ctrl+Z',!/Ctrl\+Z/.test(state.confirms.join(' ')));
    s.eq('the item really is gone',run(`_editUnsorted.length`),0);

    s.section('provenance says "you" for your own card');
    boot();
    run(`_editCards[0].by='Afnan';_editCards[0].at=Date.now();_boardsSetSelection(['n'])`);
    // Milanote's footer: avatar · "Created by you just now" (video, 99s).
    const whoText=`(function(){const w=_boardsCardCtxItems(true).find(i=>i.who);return w?_boardsWhoText(w):'';})()`;
    s.eq('mine reads as you',run(whoText),'Created by you just now');
    run(`_editCards[0].by='Ammar'`);
    s.eq('someone else keeps their name',run(whoText),'Created by Ammar just now');
    s.ok('the menu draws it with an avatar',/board-ctx-who[^]*board-avatar[^]*Created by Ammar/.test(run(`_boardsCtxHTML(_boardsCardCtxItems(true))`)));
    run(`delete _editCards[0].by`);
    s.eq('a card with no provenance shows no line',run(whoText),'');
    s.ok('and no footer',!/board-ctx-who/.test(run(`_boardsCtxHTML(_boardsCardCtxItems(true))`)));

    // ── The ⋯ menu and Lock position, like Milanote's (Sept 2026) ─────────
    s.section('the ⋯ menu is the right-click menu minus what the rail carries');
    boot();
    run(`_editCards[0].by='Afnan';_editCards[0].at=Date.now();_boardsSetSelection(['n'])`);
    const railActs=JSON.parse(run(`JSON.stringify(_boardsRailItems().map(i=>i.act).filter(Boolean))`));
    const ctxActs=JSON.parse(run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act).filter(Boolean))`));
    const moreActs=JSON.parse(run(`JSON.stringify(_boardsMoreItems(true).map(i=>i.act).filter(Boolean))`));
    s.eq('the desktop rail is Milanote\'s: Back · Color · Labels · Reactions · Comment · Rename · ⋯',
      railActs.join(','),'deselect,color-panel,labels,reactions,card-comment,rename,more');
    s.ok('nothing on the rail is repeated in ⋯',!moreActs.some(a=>railActs.indexOf(a)>=0),moreActs.join(','));
    s.ok('and nothing the right-click offers is lost between the two',
      ctxActs.every(a=>railActs.indexOf(a)>=0||moreActs.indexOf(a)>=0),
      ctxActs.filter(a=>railActs.indexOf(a)<0&&moreActs.indexOf(a)<0).join(','));
    s.ok('⋯ offers nothing the right-click does not',moreActs.every(a=>ctxActs.indexOf(a)>=0));
    s.ok('Convert to Document leads for a note, then Lock, then z-order (Milanote\'s order)',
      /^copytext,todoc,lock,front,back,/.test(moreActs.join(',')),moreActs.join(','));
    s.ok('the clipboard block comes last',/cut,copy,dup,delete,stash,card-link$/.test(moreActs.join(',')),moreActs.join(','));
    s.eq('lock reads as Milanote names it',run(`_boardsMoreItems(true).find(i=>i.act==='lock').label`),'Lock position');
    s.ok('the provenance footer closes it',run(`JSON.stringify(_boardsMoreItems(true).slice(-1)[0])`).indexOf('"who":"Afnan"')>=0);
    s.ok('no swatch row rides along — the Color tile is on the rail',!/swatches/.test(run(`JSON.stringify(_boardsMoreItems(true))`)));
    s.ok('and the ⋯ delete keeps its danger flag',run(`_boardsMoreItems(true).find(i=>i.act==='delete').danger===true`));
    s.eq('read-only still gets a ⋯ (copy text, copy link, provenance)',
      run(`_boardsMoreItems(false).map(i=>i.act||(i.who?'who':'')).filter(Boolean).join(',')`),'copytext,card-link,who');
    s.ok('read-only rail still ends in ⋯',/,more$/.test(run(`_boardsRailItems().map(i=>i.act).join(',')`)));

    // ── The image card, like Milanote's (Sept 2026) ───────────────────────
    // Read off the video (34s / 112s): a photo is the whole card — no strip,
    // no border, only a small comment badge in its top-right corner — and
    // its rail is Color · Labels · Reactions · Comment · Rename · Caption · ⋯.
    s.section('a photo is the whole card');
    run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsConnSel=null;_boardsCellFocus=null;`);
    s.ok('an image card with a picture is a photo',run(`_boardsIsPhotoCard({type:'image',imageUrl:'https://res.cloudinary.com/x/a.jpg'})`));
    s.ok('an empty image card is not',!run(`_boardsIsPhotoCard({type:'image'})`));
    s.ok('nor one still uploading',!run(`_boardsIsPhotoCard({type:'image',imageUrl:'x',_uploading:true})`));
    s.ok('nor a file card',!run(`_boardsIsPhotoCard({type:'file',fileUrl:'x',imageUrl:'x'})`));
    const photoHtml=run(`_boardCardHTML({id:'ph',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360},true)`);
    s.ok('the card wears .photo',/class="board-card-el type-image photo/.test(photoHtml));
    s.ok('the head strip is still there (drag handle, name, ✕)',/board-card-head/.test(photoHtml)&&/board-card-name/.test(photoHtml)&&/board-card-del/.test(photoHtml));
    // The head holds no nested div, so it ends at the first </div> after it.
    const headOf=h=>(h.match(/<div class="board-card-head"[\s\S]*?<\/div>/)||[''])[0];
    s.ok('the comment badge is NOT inside the head',!/board-cmt-/.test(headOf(photoHtml)),headOf(photoHtml).slice(0,200));
    s.ok('it sits on the picture, under the id the painter fills',/board-cmt-badge pin" id="board-cmt-ph"/.test(photoHtml));
    s.eq('exactly one badge per card',(photoHtml.match(/board-cmt-badge/g)||[]).length,1);
    const emptyHtml=run(`_boardCardHTML({id:'em',type:'image',x:0,y:0,w:170,h:120},true)`);
    s.ok('an empty image card is not a photo',!/ photo/.test(emptyHtml));
    // NO card keeps its badge in the head now: every type wears the pin.
    s.ok('and its badge is a pin too, outside the head',
      !/board-cmt-/.test(headOf(emptyHtml))&&/board-cmt-badge pin/.test(emptyHtml));
    s.ok('so does one still uploading',!/ photo/.test(run(`_boardCardHTML({id:'up',type:'image',imageUrl:'x',_uploading:true,x:0,y:0,w:170,h:120},true)`)));

    s.section('the overlaid strip costs the picture nothing — the crop is gone');
    // Before this, _boardsFitImageCard set c.h to the picture's height and
    // the render put a 28px strip INSIDE it, so object-fit:cover cropped
    // every picture by 28px. Measured in headless Chromium: 238×332 drawn in
    // a 240×360 card before, 240×360 after.
    s.eq('a photo needs no head height',run(`_boardsMinCardH({type:'image',imageUrl:'x'})`),run(`_BOARDS_MIN_BODY_H.image`));
    s.eq('and an empty image card is charged none either',run(`_boardsMinCardH({type:'image'})`),run(`_BOARDS_MIN_BODY_H.image`));
    s.ok('a fitted portrait is drawn at exactly its own height',run(`(function(){const c=_boardsNewCard('image');c.imageUrl='x';
      _boardsFitImageCard(c,{width:1000,height:1500});return Math.max(c.h,_boardsMinCardH(c))===c.h&&c.h===360;})()`));
    s.eq('a caption and labels still grow it',run(`_boardsMinCardH({type:'image',imageUrl:'x',caption:'a',labels:[{t:'x',c:'grey'}]})-_boardsMinCardH({type:'image',imageUrl:'x'})`),
      run(`_BOARDS_CHROME_H.caption+_BOARDS_CHROME_H.labels`));

    // CORRECTED Sept 2026 from the frame at 82s at full resolution: the
    // image rail is Color · Labels · Reactions · Comment · Draw on · Edit ·
    // Background · Caption · ⋯, with NO Rename. The earlier "Rename before
    // Caption" was read off the TO-DO card at 112s.

    /* ── Draw on · Edit · Background (Sept 2026) ────────────────────────
       The three tools on Milanote's image rail, READ OFF the second video
       at 82s (the rail and its glyphs) and never once demonstrated there,
       so everything below holds OUR behaviour rather than a copy of
       theirs. The geometry is the half worth testing hardest: it is pure
       arithmetic, and it was also MEASURED in real headless Chromium
       (scratchpad/measure-imgtools.js) against the same five cases. */
    s.section('a stroke is FLAT, because Firestore refuses a nested array');
    boot();
    run(`_editCards=[{id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',
      x:0,y:0,w:240,h:360,imgW:1000,imgH:1500,
      strokes:[{c:'red',w:4,p:[10,10,20,20,30,15]},{c:'blue',w:2,p:[50,50]}]}]`);
    const nestedS=x=>{
      if(Array.isArray(x))return x.some(v=>Array.isArray(v)||nestedS(v));
      if(x&&typeof x==='object')return Object.keys(x).some(k=>nestedS(x[k]));
      return false;
    };
    s.ok('the saved form nests no array in an array',
      !nestedS(JSON.parse(run(`JSON.stringify(_boardsCardsForSave())`))));
    s.ok('and the strokes survive the save untouched',
      run(`JSON.stringify(_boardsCardsForSave()[0].strokes[0].p)`)==='[10,10,20,20,30,15]');
    s.eq('a three-point stroke is one path',run(`_boardsStrokePath({p:[10,10,20,20,30,15]})`),'M10 10L20 20L30 15');
    s.eq('a single tap is a dot, not nothing',run(`_boardsStrokePath({p:[5,6]})`),'M5 6L5.01 6');
    s.eq('an empty stroke draws nothing',run(`_boardsStrokePath({p:[]})`),'');
    s.eq('a stroke knows its own length in POINTS, not numbers',run(`_boardsStrokeLen({p:[1,2,3,4,5,6]})`),3);
    const drawHtml=run(`_boardsDrawOverlayHTML(_editCards[0],true)`);
    s.ok('the overlay is a DIV around the svg — an <svg> is replaced and will not stretch',
      /^<div class="board-draw/.test(drawHtml)&&/<svg viewBox="0 0 100 100"/.test(drawHtml),drawHtml.slice(0,90));
    s.ok('and it stops above the card foot',/style="bottom:0px"/.test(drawHtml),drawHtml.slice(0,140));
    s.ok('a card with labels pushes it up by the foot',
      /style="bottom:31px"/.test(run(`_boardsDrawOverlayHTML({id:'q',type:'text',strokes:[{c:'red',w:4,p:[1,1,2,2]}],labels:[{t:'x',c:'red'}]},true)`)));
    s.eq('a card with no strokes and no pen on it draws no overlay',
      run(`_boardsDrawOverlayHTML({id:'z',type:'text'},true)`),'');
    s.ok('the strokes carry the palette TOKEN, never a literal',
      /var\(--accent-urgent\)/.test(drawHtml)&&!/#/.test(drawHtml.replace(/&[a-z]+;/g,'')),drawHtml.slice(0,200));
    /* DRIVEN, not written by hand: the fixture above could hold a flat
       array while the handler pushed pairs, and the nested-array rule
       would still read green. The pointer stream is faked because the
       harness has no DOM — what matters is the SHAPE that comes out. */
    const drawn=(function(){
      run(`(function(){
        _editCards=[{id:'d1',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360}];
        _boardsSelection=new Set(['d1']);_boardsDrawOn='d1';_boardsDrawColor='red';_boardsDrawWidth=4;
        _boardsUndo=[];_boardsRedo=[];
        const svg={appendChild(){},querySelector(){return svg;},setAttribute(){},};
        const host={
          _ls:{},
          querySelector(){return svg;},
          getBoundingClientRect(){return{left:0,top:0,width:100,height:100};},
          setPointerCapture(){},releasePointerCapture(){},
          addEventListener(t,f){host._ls[t]=f;},removeEventListener(t){delete host._ls[t];}
        };
        window.boardsDrawStart({currentTarget:host,clientX:10,clientY:10,pointerId:1,
          preventDefault(){},stopPropagation(){}},'d1');
        host._ls.pointermove({clientX:40,clientY:60});
        host._ls.pointermove({clientX:70,clientY:20});
        host._ls.pointermove({clientX:70.2,clientY:20.1});   // below the min step — dropped
        host._ls.pointerup();
        return 0;
      })()`);
      return JSON.parse(run(`JSON.stringify(_editCards[0].strokes)`));
    })();
    s.eq('one stroke',drawn.length,1);
    s.eq('its points are FLAT numbers, never [x,y] pairs',JSON.stringify(drawn[0].p),'[10,10,40,60,70,20]');
    s.eq('and it carries the pen',drawn[0].c+'/'+drawn[0].w,'red/4');
    s.ok('nothing the handler wrote nests an array',
      !nestedS(JSON.parse(run(`JSON.stringify(_boardsCardsForSave())`))));
    s.eq('it pushed exactly one undo entry for the stroke',run(`_boardsUndo.length`),1);
    // Put the block's own fixture back — the drive above replaced _editCards.
    run(`_editCards=[{id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',
      x:0,y:0,w:240,h:360,imgW:1000,imgH:1500,
      strokes:[{c:'red',w:4,p:[10,10,20,20,30,15]},{c:'blue',w:2,p:[50,50]}]}];
      _boardsSelection=new Set(['p']);_boardsDrawOn=null;`);

    s.section('the pen is a MODE, and it outranks every other rail');
    run(`_boardsSelection=new Set(['p']);_boardsDrawOn=null;`);
    s.ok('off, the image rail is the ordinary one',
      run(`_boardsRailItems().map(i=>i.act).join(',')`).indexOf('img:draw')>=0);
    run(`window.boardsDrawMode('p')`);
    s.eq('on, the rail is the drawing tools and nothing else',
      run(`_boardsRailItems().map(i=>i.act||(i.drawSwatches?'<swatches>':i.drawWidths?'<widths>':'?')).join(',')`),
      'draw:done,<swatches>,<widths>,draw:undo,draw:clear');
    s.ok('Undo stroke and Erase all are LIVE, because this card has strokes',
      run(`_boardsRailItems().filter(i=>i.act==='draw:undo'||i.act==='draw:clear').every(i=>!i.off)`));
    s.ok('and both are greyed on a card with none',run(`(function(){
      _editCards.push({id:'p2',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/b.jpg',x:0,y:0,w:240,h:240});
      _boardsDrawOn='p2';_boardsSelection=new Set(['p2']);
      const r=_boardsRailItems().filter(i=>i.act==='draw:undo'||i.act==='draw:clear');
      _editCards.pop();_boardsDrawOn='p';_boardsSelection=new Set(['p']);
      return r.length===2&&r.every(i=>i.off);})()`));
    s.ok('the card says it is being drawn on',/board-card-el type-image photo drawing/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    // Line mode survived leaving the board once and turned every later
    // board into an arrow-drawing surface. A mode that is not reset is the
    // same bug with a different name.
    run(`_boardsSetSelection([])`);
    s.eq('selecting something else ends it',run(`_boardsDrawOn`),null);
    run(`window.boardsDrawMode('p')`);
    s.eq('Escape ends it',(function(){run(`_boardsOnKeydown({key:'Escape',preventDefault(){},target:{tagName:'DIV'}})`);return run(`_boardsDrawOn`);})(),null);
    /* Opening a board is async (_boardsOpenCanvas reads the document), so
       this one assertion has to await — in its OWN app instance. The first
       version of it shared this block's, and every later synchronous
       section in the suite then ran BEFORE the await resolved and left
       _boardsDrawOn in some other state: it passed with the reset deleted,
       which is the documented _pending hazard wearing a third face. */
    _pending.push((async()=>{
      const a2=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const r2=a2.run;
      r2(`currentPage='board-canvas';boardsLoaded=true;_boardsTrash=[];moodBoards=[
          {id:'B8',title:'First',ownerUid:'u1',visibility:'personal',zoom:1,cards:[
            {id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360}],connectors:[]},
          {id:'B9',title:'Another',ownerUid:'u1',visibility:'personal',zoom:1,cards:[],connectors:[]}];
        _boardsViewingId='B8';`);
      await r2(`_boardsOpenCanvas()`);
      r2(`window.boardsDrawMode('p')`);
      const was=r2(`_boardsDrawOn`);
      r2(`_boardsViewingId='B9'`);
      await r2(`_boardsOpenCanvas()`);
      const now=r2(`_boardsDrawOn`);
      s.section('the pen does not survive leaving the board');
      s.eq('it was on',was,'p');
      s.eq('and opening another board clears it',now,null);
    })());

    s.section('undo is per STROKE, not per drawing session');
    boot();
    run(`_editCards=[{id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360,
      strokes:[{c:'red',w:4,p:[1,1,2,2]},{c:'blue',w:2,p:[3,3,4,4]}]}];
      _boardsSelection=new Set(['p']);_boardsDrawOn='p';_boardsUndo=[];`);
    run(`window.boardsDrawUndo()`);
    s.eq('one stroke comes off',run(`_editCards[0].strokes.length`),1);
    s.eq('and it pushed exactly one undo entry',run(`_boardsUndo.length`),1);
    run(`window.boardsDrawUndo()`);
    s.eq('the last one deletes the field rather than leaving an empty array',run(`_editCards[0].strokes===undefined`),true);

    s.section('the picture geometry — MEASURED in Chromium, held here as arithmetic');
    /* Each case below was rendered in real headless Chromium against the
       real css/main.css and the <img>'s own bounding rect read back; the
       numbers are what it measured. A .board-card-el.type-image.photo has
       NO border (border:none), so its body is the full card box — getting
       that wrong by 2px leaves a strip of the card showing through a
       cropped picture, which is what the first cut did. */
    s.eq('an unedited card needs no geometry at all',run(`_boardsImgGeom({type:'image',imageUrl:'x',imgW:1000,imgH:1500,w:240,h:360},240,360)`),null);
    s.eq('nor does one whose natural size is unknown',run(`_boardsImgGeom({type:'image',imageUrl:'x',rotate:90,w:240,h:360},240,360)`),null);
    s.eq('a photo card body is the FULL card box',run(`JSON.stringify(_boardsCardBodyBox({type:'image',imageUrl:'x',w:240,h:360}))`),'{"w":240,"h":360}');
    s.eq('every other card loses its 1px borders',run(`JSON.stringify(_boardsCardBodyBox({type:'text',w:240,h:360}))`),'{"w":238,"h":358}');
    s.eq('and a caption comes off the body, not the card',
      run(`JSON.stringify(_boardsCardBodyBox({type:'image',imageUrl:'x',caption:'c',w:240,h:180}))`),'{"w":240,"h":150}');
    const geom=(c,w,h)=>JSON.parse(run(`(function(){const g=_boardsImgGeom(${c},${w},${h});
      return JSON.stringify({rot:g.rot,w:+g.w.toFixed(1),h:+g.h.toFixed(1),left:+g.left.toFixed(1),top:+g.top.toFixed(1)});})()`));
    /* The element is laid out UNROTATED and turned about its own centre, so
       the LAYOUT box is w×h and the VISUAL box after a quarter turn is
       h×w. Both are asserted, because the visual one is what Chromium
       measured and the layout one is what goes into the style attribute. */
    const rot90=geom(`{type:'image',imageUrl:'x',imgW:1000,imgH:1500,rotate:90}`,360,240);
    s.eq('rotated 90°, the layout box is the upright picture',
      [rot90.w,rot90.h,rot90.left,rot90.top].join(','),'240,360,60,-60');
    s.eq('and the VISUAL box after the turn is the card exactly — measured 360×240',
      [rot90.h,rot90.w].join('x'),'360x240');
    const cropMid=geom(`{type:'image',imageUrl:'x',imgW:1000,imgH:1500,crop:{x:0.25,y:0.25,w:0.5,h:0.5}}`,240,240);
    s.eq('the middle half of a 1000×1500 fills a 240 square — measured 480×720 at -120,-240',
      [cropMid.w,cropMid.h,cropMid.left,cropMid.top].join(','),'480,720,-120,-240');
    const both=geom(`{type:'image',imageUrl:'x',imgW:1000,imgH:1500,rotate:90,crop:{x:0.1,y:0,w:0.4,h:1}}`,240,400);
    s.eq('a crop of a rotated picture is in the ROTATED frame',
      [both.w,both.h,both.left,both.top].join(','),'400,600,40,-100');
    s.eq('and it measured 600×400 at -60,0 on screen',
      [both.h,both.w,both.left+(both.w-both.h)/2,both.top+(both.h-both.w)/2].join(','),'600,400,-60,0');
    s.ok('a crop of the whole picture is no crop',run(`_boardsCrop({crop:{x:0,y:0,w:1,h:1}})`)===null);
    s.ok('a crop outside the picture is refused rather than clamped',
      run(`_boardsCrop({crop:{x:0.5,y:0,w:0.9,h:1}})`)===null);
    s.ok('an unknown rotation is upright',run(`_boardsRot({rotate:45})`)===0&&run(`_boardsRot({rotate:270})`)===270);

    s.section('the editor rotates the CROP with the picture');
    /* Turning the picture must not jump the framing to a different part of
       it: a 90° turn maps (x,y,w,h) → (1-y-h, x, h, w). */
    run(`_boardsEdit={id:'p',rot:0,crop:{x:0.1,y:0.2,w:0.3,h:0.4},nat:{w:1000,h:1500},url:'x'};
      _boardsRenderImgEditor=function(){};`);
    run(`window.boardsImgEditRotate(90)`);
    s.eq('one turn right',run(`JSON.stringify(_boardsEdit.crop)`),JSON.stringify({x:1-0.2-0.4,y:0.1,w:0.4,h:0.3}));
    s.eq('and the rotation with it',run(`_boardsEdit.rot`),90);
    run(`window.boardsImgEditRotate(-90)`);
    s.eq('turning back restores it exactly',run(`JSON.stringify(_boardsEdit.crop)`),JSON.stringify({x:0.1,y:0.2,w:0.3,h:0.4}));
    s.eq('four turns is a full circle',(function(){
      run(`_boardsEdit.crop={x:0.1,y:0.2,w:0.3,h:0.4};_boardsEdit.rot=0;`);
      for(let i=0;i<4;i++)run(`window.boardsImgEditRotate(90)`);
      return run(`JSON.stringify(_boardsEdit.crop)+'|'+_boardsEdit.rot`);})(),JSON.stringify({x:0.1,y:0.2,w:0.3,h:0.4})+'|0');

    s.section('Apply stores the natural size and re-fits the card');
    boot();
    run(`_editCards=[{id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360}];
      _boardsSelection=new Set(['p']);
      _boardsEdit={id:'p',rot:90,crop:{x:0,y:0,w:1,h:1},nat:{w:1000,h:1500},url:'x'};`);
    run(`window.boardsImgEditApply()`);
    s.eq('the natural size is stored WITH the edit — the geometry is meaningless without it',
      run(`_editCards[0].imgW+'x'+_editCards[0].imgH`),'1000x1500');
    s.eq('the card is re-fitted to what it now shows',run(`_editCards[0].w+'x'+_editCards[0].h`),'240x160');
    s.ok('and a whole-picture crop is not stored at all',run(`_editCards[0].crop===undefined`));
    run(`_boardsEdit={id:'p',rot:0,crop:{x:0,y:0,w:1,h:1},nat:{w:1000,h:1500},url:'x'};window.boardsImgEditApply()`);
    s.ok('Reset clears the rotation too',run(`_editCards[0].rotate===undefined&&!_boardsImgEdited(_editCards[0])`));

    s.section('Background — the picture, and the board');
    boot();
    run(`_editCards=[{id:'p',type:'image',imageUrl:'https://res.cloudinary.com/demo/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360}];
      _boardsSelection=new Set(['p']);`);
    s.eq('removing a background is a DELIVERY component — nothing is re-uploaded',
      run(`_boardsNoBgUrl('https://res.cloudinary.com/demo/image/upload/v1/a.jpg')`),
      'https://res.cloudinary.com/demo/image/upload/e_background_removal/v1/a.jpg');
    s.eq('a URL that is not Cloudinary is left alone',run(`_boardsNoBgUrl('https://other.test/a.jpg')`),'https://other.test/a.jpg');
    run(`window.boardsImgNoBg('p')`);
    s.eq('the card carries the flag',run(`_editCards[0].nobg`),true);
    s.ok('the card asks Cloudinary for the stripped picture',
      /e_background_removal/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    s.ok('and a failure clears the flag rather than leaving a broken picture',run(`(function(){
      window.boardsNoBgFailed({},'p');return _editCards[0].nobg===undefined;})()`));
    // The export must show what the SCREEN shows, or the background comes
    // back in the PNG and the PDF only.
    run(`_editCards[0].nobg=true`);
    s.ok('the export reads the same delivery URL',/e_background_removal/.test(run(`_boardsExportImageUrl(_editCards[0])`)));
    run(`delete _editCards[0].nobg`);
    run(`window.boardsUseAsBoardBg('p')`);
    s.eq('a board background is stored on the BOARD',run(`_editBoard.bgImage`),'https://res.cloudinary.com/demo/image/upload/v1/a.jpg');
    s.eq('with a fit',run(`_editBoard.bgFit`),'cover');
    // The string goes straight into a CSS url(), so the moment to check it
    // is the moment it is WRITTEN. res.cloudinary.com.evil.test must not pass.
    run(`_editBoard.bgImage=null;_editCards[0].imageUrl='https://res.cloudinary.com.evil.test/a.jpg';window.boardsUseAsBoardBg('p')`);
    s.ok('a lookalike host is refused',run(`!_editBoard.bgImage`));
    run(`_editCards[0].imageUrl='https://res.cloudinary.com/demo/image/upload/v1/a.jpg';window.boardsUseAsBoardBg('p');window.boardsClearBoardBg()`);
    s.ok('and clearing it removes both fields',run(`_editBoard.bgImage===undefined&&_editBoard.bgFit===undefined`));
    const bgItems=run(`JSON.stringify(_boardsImgBgItems('p').map(i=>i.act||i.title||i.note||(i.sep?'—':'?')))`);
    s.ok('the menu says the add-on is needed rather than letting a broken picture say it',
      /add-on/.test(bgItems),bgItems);

    s.section('on a phone the pen settings go behind one button');
    /* The phone rail is a horizontal dock. Six colour swatches beside
       three width buttons and three labelled tools ran off the right edge
       at 390 and at 360 — found by tests/smoke-phone.js, not by reading —
       so they live in a bottom sheet, the pattern Colour, Labels and
       Reactions already follow there. */
    {
      const ph=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},phone:true});
      ph.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        _editCards=[{id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360,
          strokes:[{c:'red',w:4,p:[1,1,2,2]}]}];
        _editConnectors=[];_boardsSelection=new Set(['p']);_boardsDrawOn='p';_boardsCellFocus=null;_boardsConnSel=null;`);
      s.eq('four targets, no swatch rows',
        ph.run(`_boardsRailItems().map(i=>i.act||'<row>').join(',')`),
        'draw:done,draw:pen,draw:undo,draw:clear');
      ph.run(`window.boardsDrawPenSheet()`);
      const sheet=ph.run(`(document.getElementById('board-sheet')||{innerHTML:''}).innerHTML`);
      s.ok('and the sheet carries every colour and every width',
        (sheet.match(/data-act="draw:color:/g)||[]).length===6&&
        (sheet.match(/data-act="draw:width:/g)||[]).length===3,
        (sheet.match(/data-act="draw:(color|width):/g)||[]).join(' '));
    }

    s.section('the image rail is Milanote\'s, and Rename / Replace / Download went to ⋯');
    run(`_editCards=[{id:'ph',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:240,h:360,by:'Afnan',at:1},
      {id:'fl',type:'file',fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/a.pdf',fileName:'a.pdf',x:0,y:0,w:240,h:200}];
      _boardsSelection=new Set(['ph']);`);
    s.eq('Color · Labels · Reactions · Comment · Draw on · Edit · Background · Caption · ⋯',run(`_boardsRailItems().map(i=>i.act).join(',')`),
      'deselect,color-panel,labels,reactions,card-comment,img:draw,img:edit,img:bg,caption,more');
    const imgMore=run(`_boardsMoreItems(true).map(i=>i.act).filter(Boolean).join(',')`);
    s.ok('⋯ carries Replace, Download and Open original for the picture',/replace/.test(imgMore)&&/download/.test(imgMore)&&/openasset/.test(imgMore),imgMore);
    // Rename left the rail, so the derive put it in ⋯ with no other edit —
    // the same algebra that already moved Replace and Download there.
    s.ok('and Rename, which left the rail, is in ⋯ on its own',/(^|,)rename(,|$)/.test(imgMore),imgMore);
    s.ok('nothing on the rail repeats in ⋯',run(`(function(){const rail=_boardsRailItems().map(i=>i.act).filter(Boolean);
      return _boardsMoreItems(true).map(i=>i.act).filter(Boolean).every(a=>rail.indexOf(a)<0);})()`));
    s.ok('and nothing the right-click offers is lost',run(`(function(){const rail=_boardsRailItems().map(i=>i.act);const more=_boardsMoreItems(true).map(i=>i.act).filter(Boolean);
      return _boardsCardCtxItems(true).map(i=>i.act).filter(Boolean).every(a=>rail.indexOf(a)>=0||more.indexOf(a)>=0);})()`));
    run(`_boardsSelection=new Set(['fl'])`);
    s.eq('a file card\'s rail is unchanged',run(`_boardsRailItems().map(i=>i.act).join(',')`),
      'deselect,color-panel,labels,reactions,card-comment,caption,replace,download,rename,more');
    run(`_boardsSelection=new Set()`);

    /* ── The second Milanote video: no headers, the to-do card, the link
       card's one field (Sept 2026) ─────────────────────────────────────
       Read off "Winter Drop 2027": no card type has a header strip, the
       rail follows what is FOCUSED rather than what is selected, a to-do
       has a title and nesting and per-task dates and assignees, and a
       link card is born as one field. */
    s.section('no card type has a header strip');
    run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsEditingEl=null;`);
    // table is left out on purpose: _boardsMinCardH returns early for it
    // (its height is derived per row), so it never saw the head charge.
    ['text','todo','file','link','board','image','heading'].forEach(t=>{
      s.eq(t+' is charged no head height',
        run(`_boardsMinCardH({type:'${t}'})-(_BOARDS_MIN_BODY_H['${t}']||48)`),0);
    });
    const anyHtml=run(`_boardCardHTML({id:'n1',type:'text',text:'x',x:0,y:0,w:200,h:120},true)`);
    s.ok('the head is still in the DOM — it is the drag handle',/board-card-head/.test(anyHtml));
    s.ok('the comment pin is outside it',/board-cmt-badge pin/.test(anyHtml));
    s.ok('and the corner handle is emitted',/board-card-corner/.test(anyHtml));
    const headOnly=(anyHtml.match(/<div class="board-card-head"[\s\S]*?<\/div>/)||[''])[0];
    s.ok('nothing but the name, the lock and the ✕ live in the head',
      !/board-cmt-|board-card-corner/.test(headOnly));

    s.section('a to-do card has a title, and asks for one');
    const td=(items,extra)=>run(`_boardCardHTML(Object.assign({id:'td',type:'todo',items:${JSON.stringify(items)},x:0,y:0,w:240,h:160},${JSON.stringify(extra||{})}),true)`);
    s.ok('no title, no title row',!/board-todo-title/.test(td([{text:'a'}])));
    s.ok('a title renders its own row',/board-tdtitle-td/.test(td([{text:'a'}],{title:'MILE STONE'})));
    s.ok('two tasks is too early to ask',!/board-todo-ask/.test(td([{text:'a'},{text:'b'}])));
    s.ok('three tasks and it asks',/Add a title to this list\?/.test(td([{text:'a'},{text:'b'},{text:'c'}])));
    s.ok('answered once, never asked again',!/board-todo-ask/.test(td([{text:'a'},{text:'b'},{text:'c'}],{titleAsked:true})));
    s.ok('and a card that already has one is not asked',!/board-todo-ask/.test(td([{text:'a'},{text:'b'},{text:'c'}],{title:''})));
    // A to-do card is as tall as its list — found by smoke-layout on this
    // round's first run, with the add row and the prompt drawn outside it.
    const tdh=(o)=>run(`_boardsMinCardH(Object.assign({type:'todo'},${JSON.stringify(o)}))`);
    s.ok('a longer list makes a taller card',tdh({items:[{},{},{},{},{}]})>tdh({items:[{}]}));
    s.eq('the title row is charged',tdh({items:[{},{}],title:'x'})-tdh({items:[{},{}]}),run(`_BOARDS_CHROME_H.todoTitle`));
    s.eq('and so is the prompt',tdh({items:[{},{},{}]})-tdh({items:[{},{},{}],titleAsked:true}),run(`_BOARDS_CHROME_H.todoAsk`));
    s.eq('a 40-task list is capped, not a 1,100px card',
      tdh({items:new Array(40).fill({})}),tdh({items:new Array(12).fill({})}));
    s.ok('and an empty list keeps the floor',tdh({items:[]})>=run(`_BOARDS_MIN_BODY_H.todo`));

    s.section('tasks nest, and only one level at a time');
    run(`_editCards=[{id:'td',type:'todo',items:[{text:'a'},{text:'b'},{text:'c'}],x:0,y:0,w:240,h:200}]`);
    s.ok('the first task can never be indented',!run(`_boardsTodoCanIndent(_editCards[0],0)`));
    s.ok('the second can',run(`_boardsTodoCanIndent(_editCards[0],1)`));
    s.ok('nothing at depth 0 can be outdented',!run(`_boardsTodoCanOutdent(_editCards[0],1)`));
    run(`window.boardsTodoIndent('td',1,1)`);
    s.eq('one level deeper',run(`_boardsTodoDepth(_editCards[0].items[1])`),1);
    s.ok('and not two in a row',!run(`_boardsTodoCanIndent(_editCards[0],1)`));
    s.ok('but the one under it can follow',run(`_boardsTodoCanIndent(_editCards[0],2)`));
    run(`window.boardsTodoIndent('td',1,-1)`);
    s.eq('outdent clears the field rather than storing a zero',run(`String(_editCards[0].items[1].depth)`),'undefined');
    s.eq('depth is clamped however it was stored',run(`_boardsTodoDepth({depth:99})`),run(`_BOARDS_TODO_MAX_DEPTH`));
    s.eq('and junk reads as no depth',run(`_boardsTodoDepth({depth:'x'})`),0);

    s.section('a task carries a due date and a person');
    s.eq('a real date is kept',run(`_boardsTodoValidDue('2026-09-25')`),'2026-09-25');
    s.eq('anything else is dropped',run(`String(_boardsTodoValidDue('next tuesday'))`),'null');
    s.eq('today reads as Today',run(`_boardsDueLabel(_boardsTodayStr())`),'Today');
    s.ok('an overdue task is flagged',/board-todo-due over/.test(run(`_boardsTodoMetaHTML({due:'2020-01-01'})`)));
    s.ok('a ticked one is not',!/over/.test(run(`_boardsTodoMetaHTML({due:'2020-01-01',done:true})`)));
    s.ok('an assignee shows initials, escaped',/board-todo-who/.test(run(`_boardsTodoMetaHTML({who:'Ammar Shah'})`)));
    s.ok('and no meta at all when there is none',run(`_boardsTodoMetaHTML({text:'x'})`)==='');

    s.section('the rail follows FOCUS, not just the selection');
    run(`_editCards=[{id:'td',type:'todo',title:'T',items:[{text:'a'},{text:'b'}],x:0,y:0,w:240,h:200}];
      _boardsSelection=new Set(['td']);_boardsIsPhone=()=>false;`);
    run(`_boardsEditingEl={id:'board-todo-td-1'}`);
    s.eq('a focused TASK gets the long rail',run(`_boardsRailItems().map(i=>i.act).join(',')`),
      'deselect,color-panel,labels,reactions,card-comment,todo:title,todo:due,todo:assign,todo:indent,todo:outdent');
    s.ok('outdent is greyed on a task at depth 0',run(`_boardsRailItems().find(i=>i.act==='todo:outdent').off===true`));
    run(`_boardsEditingEl={id:'board-tdtitle-td'}`);
    s.eq('a focused TITLE gets the short one',run(`_boardsRailItems().map(i=>i.act).join(',')`),
      'deselect,color-panel,todo:title,more');
    run(`_boardsEditingEl=null`);
    s.ok('and with nothing focused it is the ordinary selection rail',
      /rename/.test(run(`_boardsRailItems().map(i=>i.act).join(',')`)));
    s.ok('which still offers Title',/todo:title/.test(run(`_boardsRailItems().map(i=>i.act).join(',')`)));
    s.eq('a card id with a dash in it still resolves',
      run(`(function(){_boardsEditingEl={id:'board-todo-a-b-c-3'};var f=_boardsTodoFocus();return f.id+'|'+f.i+'|'+f.what;})()`),'a-b-c|3|item');
    run(`_boardsEditingEl=null`);

    s.section('a link card is born as ONE field');
    run(`_editCards=[{id:'lk',type:'link',x:0,y:0,w:340,h:120}];_boardsSelection=new Set(['lk']);`);
    const lk=()=>run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('one field, not three',/board-link-new/.test(lk())&&!/board-link-edit/.test(lk()));
    // Text that is not a URL is KEPT as the title, with the failure said in
    // the card — Milanote's own behaviour with "ASHI".
    run(`window.boardsLinkNewCommit('lk','ASHI')`);
    s.eq('junk becomes the title',run(`_editCards[0].linkTitle`),'ASHI');
    s.eq('and no URL is invented',run(`String(_editCards[0].linkUrl)`),'undefined');
    s.ok('the failure is said inside the card',/board-link-err/.test(lk()));
    s.ok('and the card is the preview shape now, not the field',!/board-link-new/.test(lk()));
    s.ok('the description is editable, with Milanote\'s placeholder',
      /data-placeholder="Add a description"/.test(lk()));
    run(`_editCards=[{id:'lk2',type:'link',x:0,y:0,w:340,h:120}];_boardsLinkHydrate=()=>{__hydrated=true};__hydrated=false;`);
    run(`window.boardsLinkNewCommit('lk2','https://example.test/a')`);
    s.eq('a real URL is taken',run(`_editCards[0].linkUrl`),'https://example.test/a');
    s.eq('the host seeds the title',run(`_editCards[0].linkTitle`),'example.test');
    s.ok('and the fetch is started once',run(`__hydrated`));
    s.ok('a javascript: URL is never taken as one',
      run(`(function(){_editCards=[{id:'lk3',type:'link',x:0,y:0,w:340,h:120}];
        window.boardsLinkNewCommit('lk3','javascript:alert(1)');
        return String(_editCards[0].linkUrl)==='undefined'&&_editCards[0].linkTitle==='javascript:alert(1)';})()`));

    s.section('turning a link into an image keeps the page');
    run(`_editCards=[{id:'li',type:'link',linkUrl:'https://www.pinterest.com/pin/1/',linkTitle:'Pin',
      linkImage:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:0,y:0,w:340,h:300}];
      _boardsSelection=new Set(['li']);`);
    run(`window.boardsLinkToImage('li')`);
    s.eq('it is an image card now',run(`_editCards[0].type`),'image');
    s.eq('carrying the picture',run(`_editCards[0].imageUrl`),'https://res.cloudinary.com/x/image/upload/v1/a.jpg');
    s.eq('and the page it came from',run(`_editCards[0].sourceUrl`),'https://www.pinterest.com/pin/1/');
    const srcHtml=run(`_boardCardHTML(_editCards[0],true)`);
    s.ok('which is drawn as "From pinterest.com"',/board-card-source/.test(srcHtml)&&/pinterest\.com/.test(srcHtml));
    s.eq('the source line is charged to the card',
      run(`_boardsMinCardH({type:'image',imageUrl:'x',sourceUrl:'https://a.test/'})-_boardsMinCardH({type:'image',imageUrl:'x'})`),
      run(`_BOARDS_CHROME_H.caption`));
    s.ok('a javascript: source renders as plain text, never an href',
      !/href/.test(run(`_boardCardHTML({id:'s2',type:'image',imageUrl:'x',sourceUrl:'javascript:alert(1)',x:0,y:0,w:200,h:200},true)`).match(/board-card-source[\s\S]*?<\/div>/)[0]));

    s.section('the crop toggle, and Milanote\'s image menu order');
    run(`_editCards=[{id:'im',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/a.jpg',x:0,y:0,w:240,h:300}];
      _boardsSelection=new Set(['im']);`);
    s.ok('cropped by default — nothing stored',/object-fit:cover/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    run(`window.boardsImgCrop('im')`);
    s.eq('uncropped stores the exception only',run(`_editCards[0].fit`),'contain');
    s.ok('and the picture is fitted whole',/object-fit:contain/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    run(`window.boardsImgCrop('im')`);
    s.eq('cropping again clears it',run(`String(_editCards[0].fit)`),'undefined');
    const imgMenu2=run(`_boardsCardCtxItems(true).map(i=>i.act).filter(Boolean).join(',')`);
    s.ok('Download original, Replace, Crop — Milanote\'s order',
      /download,replace,imgcrop/.test(imgMenu2),imgMenu2);
    s.ok('and the crop entry carries its tick',
      run(`_boardsCardCtxItems(true).find(i=>i.act==='imgcrop').hint`)==='✓');

    s.section('the colour panel drops its tabs where there is no paper');
    s.ok('a note has paper',run(`_boardsCardHasPaper({type:'text'})`));
    s.ok('an image does not',!run(`_boardsCardHasPaper({type:'image'})`));
    s.ok('nor a file',!run(`_boardsCardHasPaper({type:'file'})`));
    s.ok('an image card\'s panel has no tabs',
      !run(`JSON.stringify(_boardsColorPanelItems())`).includes('colortab:'));
    s.ok('and it is the STRIP palette, never the background one',
      run(`JSON.stringify(_boardsColorPanelItems())`).includes('swatches')&&
      !run(`JSON.stringify(_boardsColorPanelItems())`).includes('bgSwatches'));
    run(`_editCards=[{id:'n2',type:'text',text:'x',x:0,y:0,w:200,h:120}];_boardsSelection=new Set(['n2']);_boardsColorTab='bg';`);
    s.ok('a note keeps both tabs',
      run(`JSON.stringify(_boardsColorPanelItems())`).includes('colortab:strip'));
    s.ok('and its paper presets',
      run(`JSON.stringify(_boardsColorPanelItems())`).includes('themes'));

    s.section('the labels panel is headed "Recently created"');
    run(`_editCards=[{id:'c1',type:'text',text:'x',labels:[{t:'DONE',c:'green'}],x:0,y:0,w:200,h:120},
                    {id:'c2',type:'text',text:'y',labels:[{t:'DONE',c:'green'}],x:0,y:0,w:200,h:120}];
      _boardsSelection=new Set(['c1']);_boardsLabelRows=_boardsLabelRowsFor('c1','').rows;`);
    s.eq('both cards carry it',run(`_boardsLabelCards('DONE').length`),2);
    s.eq('and the match ignores case',run(`_boardsLabelCards('done').length`),2);
    run(`globalThis.__prompt='SHIPPED';prompt=()=>__prompt;`);
    run(`_boardsLabelAct('rename:0')`);
    s.eq('renaming rewrites every card',
      run(`_editCards.map(c=>c.labels[0].t).join(',')`),'SHIPPED,SHIPPED');
    run(`_boardsLabelRows=_boardsLabelRowsFor('c1','').rows;confirm=()=>true;`);
    run(`_boardsLabelAct('drop:0')`);
    s.eq('and removing drops it from every card',
      run(`_editCards.map(c=>c.labels.length).join(',')`),'0,0');

    s.section('the dot grid is a placement cue, not the background');
    s.ok('a helper flashes it',run(`typeof _boardsFlashGrid`)==='function');
    s.ok('and placing a card asks for it',
      /_boardsFlashGrid\(false\)/.test(run(`String(_boardsPlacementPoint)`)));

    // ── The colour panel, like Milanote's (Sept 2026) ─────────────────────
    s.section('the palette is Milanote\'s grid and every name has a token');
    s.eq('none + eleven names in Milanote\'s order',run(`_BOARDS_COLORS.join(',')`),'none,grey,teal,green,tan,yellow,amber,red,pink,purple,sky,blue');
    s.ok('every name maps to a token',run(`_BOARDS_COLORS.slice(1).every(n=>/^--/.test(_BOARDS_COLOR_TOKENS[n]||''))`));
    s.eq('a name is a colour value',run(`_boardsColorValue('teal')`),'teal');
    s.eq('a hex is a colour value, uppercased',run(`_boardsColorValue('#c8102e')`),'#C8102E');
    s.eq('none is not',run(`String(_boardsColorValue('none'))`),'null');
    s.eq('junk is not',run(`String(_boardsColorValue('red; background:url(x)'))`),'null');
    s.eq('every preset names a paper and an ink on the palette',
      run(`_BOARDS_CARD_THEMES.filter(t=>_BOARDS_COLORS.indexOf(t.bg)>0&&_BOARDS_COLORS.indexOf(t.ink)>0).length`),run(`_BOARDS_CARD_THEMES.length`));
    s.eq('seven of them, as in the video',run(`_BOARDS_CARD_THEMES.length`),7);

    s.section('paper, ink and a literal on the card');
    boot();
    run(`_boardsSetSelection(['n'])`);
    run(`window.boardsSetTheme(0)`);
    s.eq('a preset sets paper and ink',run(`_editCards[0].bg+'/'+_editCards[0].ink`),'tan/red');
    s.ok('and paints both as classes',/bg-tan/.test(run(`_boardsCardColorClasses(_editCards[0])`))&&/ink-red/.test(run(`_boardsCardColorClasses(_editCards[0])`)));
    s.eq('a name puts nothing in the style',run(`_boardsCardColorStyle(_editCards[0])`),'');
    run(`window.boardsSetBg('sky')`);
    s.eq('a plain paper pick keeps the paper',run(`_editCards[0].bg`),'sky');
    s.ok('and clears the ink — red ink on red paper is what that avoids',run(`_editCards[0].ink===undefined`));
    run(`window.boardsSetBg('#c8102e')`);
    s.eq('a literal paper is stored validated',run(`_editCards[0].bg`),'#C8102E');
    s.ok('painted as bg-custom, never as a class carrying the hex',/ bg-custom/.test(run(`_boardsCardColorClasses(_editCards[0])`))&&!/#C8102E/.test(run(`_boardsCardColorClasses(_editCards[0])`)));
    s.eq('with the hex and a computed ink in custom properties only',run(`_boardsCardColorStyle(_editCards[0])`),'--card-bg:#C8102E;--card-ink:#FFFFFF;');
    run(`window.boardsSetColor('#F1E3D4')`);
    s.eq('a literal strip too, with a dark ink on a pale band',run(`_boardsCardColorStyle(_editCards[0])`),'--card-bg:#C8102E;--card-ink:#FFFFFF;--card-strip:#F1E3D4;--card-strip-ink:#111111;');
    run(`_editCards[0].bg='url(javascript:1)';_editCards[0].color='<b>'`);
    s.eq('garbage stored on a card paints nothing',run(`_boardsCardColorClasses(_editCards[0])+'|'+_boardsCardColorStyle(_editCards[0])`),'|');
    run(`window.boardsSetBg('none')`);
    s.ok('none removes the paper',run(`_editCards[0].bg===undefined`));

    s.section('the rail tile reads a literal too');
    run(`_editCards[0].bg='#C8102E';delete _editCards[0].color`);
    s.eq('class',run(`_boardsColorTileClass(_editCards)`),'custom');
    s.eq('style',run(`_boardsColorTileStyle(_editCards)`),'background:#C8102E');
    run(`_editCards[0].bg='teal'`);
    s.eq('a name is a class and no style',run(`_boardsColorTileClass(_editCards)+'|'+_boardsColorTileStyle(_editCards)`),'bg-teal|');

    s.section('the panel: tabs with glyphs, the grid, the presets, custom');
    run(`_boardsColorTab='bg';_boardsSetSelection(['n'])`);
    const pb=JSON.parse(run(`JSON.stringify(_boardsColorPanelItems())`));
    s.eq('two tabs with glyphs',pb[0].tabs.map(t=>t.glyph).join(','),'bg,strip');
    s.ok('the background grid, then the presets',pb[1].bgSwatches===true&&pb[1].grid===true&&pb[3].themes===true);
    s.ok('and Custom colour… last, for the background',pb[pb.length-1].custom===true&&pb[pb.length-1].prop==='bg');
    s.ok('no "from this board" row without pictures (the harness has none)',!pb.some(i=>i.ownSwatches));
    run(`_boardsColorTab='strip'`);
    const ps=JSON.parse(run(`JSON.stringify(_boardsColorPanelItems())`));
    s.ok('the strip tab has no presets — a preset is paper plus ink',!ps.some(i=>i.themes)&&ps[1].swatches===true);
    s.eq('its custom entry targets the strip',ps[ps.length-1].prop,'strip');
    const html=run(`_boardsColorTab='bg';_boardsCtxHTML(_boardsColorPanelItems())`);
    s.ok('the tabs draw their glyphs',/board-ctx-tabg-bg/.test(html)&&/board-ctx-tabg-strip/.test(html));
    s.eq('twelve tiles in the grid',(html.match(/data-act="bg:/g)||[]).length,12);
    s.eq('seven A tiles',(html.match(/data-act="theme:/g)||[]).length,7);
    s.ok('each A tile paints with the card\'s own classes',/board-theme-sw bg-tan ink-red/.test(html));
    s.ok('the current preset is ringed',/bg-tan ink-red on"/.test(run(`_editCards[0].bg='tan';_editCards[0].ink='red';_boardsCtxHTML(_boardsColorPanelItems())`)));

    s.section('the router validates a literal on the way back');
    run(`_editCards[0].bg='grey';delete _editCards[0].ink`);
    run(`_boardsCtxRun('bghex:#0f766e')`);
    s.eq('a good hex lands',run(`_editCards[0].bg`),'#0F766E');
    run(`_boardsCtxRun('bghex:javascript:alert(1)')`);
    s.ok('a bad one clears rather than passes through',run(`_editCards[0].bg===undefined`));
    run(`_boardsCtxRun('theme:3')`);
    s.eq('theme:<i> applies the preset',run(`_editCards[0].bg+'/'+_editCards[0].ink`),'teal/red');
    run(`_boardsCtxRun('striphex:#C8102E')`);
    s.eq('striphex sets the strip',run(`_editCards[0].color`),'#C8102E');

    s.section('colours from this board are picked from pixels, deduped, capped');
    const pix=run(`(function(){
      const px=[];const put=(r,g,b,n)=>{for(let i=0;i<n;i++)px.push(r,g,b,255);};
      put(200,16,46,50);put(202,18,44,30);put(15,118,110,20);put(240,240,240,10);put(0,0,0,5);put(10,10,10,4);
      for(let i=0;i<9;i++)put(20*i+40,120,60,3);
      const acc=_boardsPaletteAccumulate(px,{});
      return _boardsPalettePick(acc,8).join(',');})()`);
    s.ok('the dominant colour leads',/^#C[89]1[0-2][2-3][A-F0-9]/.test(pix),pix);
    s.ok('a near twin is folded into it',!/#CA122C/.test(pix),pix);
    s.ok('never more than eight',pix.split(',').length<=8,pix);
    s.ok('transparent pixels are ignored',run(`_boardsPalettePick(_boardsPaletteAccumulate([255,0,0,10],{}),8).length`)===0);
    s.eq('no pictures in the DOM → no row, no throw',run(`_boardsBoardPalette().length`),0);

    s.section('the desktop ⋯ opens as a popover beside the button');
    run(`_boardsSheetAnchorRect=function(a){return a&&a.act==='more'?{left:20,top:300,right:112,bottom:374,width:92,height:74}:null;}`);
    run(`_boardsOpenCtx=function(x,y,items){globalThis.__ctxAt={x:x,y:y,n:items.length};}`);
    run(`window.boardsOpenMore()`);
    s.eq('to the right of the rail, top-aligned with the button',run(`JSON.stringify(__ctxAt)`).replace(/"n":\d+/,'"n":N'),'{"x":122,"y":300,"n":N}');
    s.ok('carrying the ⋯ list, not the whole right-click one',run(`__ctxAt.n`)===run(`_boardsMoreItems(true).length`));

    s.section('Lock position');
    boot();
    run(`_boardsSetSelection(['n'])`);
    state.toasts.length=0;
    run(`window.boardsToggleLock()`);
    s.ok('the card is locked',run(`_editCards[0].locked===true`));
    s.ok('and the toast says where the unlock lives',/⋯/.test(state.toasts.join(' ')),state.toasts.join(' | '));
    s.eq('the menu now offers Unlock position',run(`_boardsMoreItems(true).find(i=>i.act==='lock').label`),'Unlock position');
    s.ok('the header carries a padlock, not a word',/board-card-lock/.test(run(`_boardCardHTML(_editCards[0],true)`))&&!/· Locked/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    // The header keeps its drag handler — the HANDLER refuses, with the
    // reason — but the delete ✕ and the resize grip are gone, as before.
    s.ok('and no delete ✕ or resize grip',!/board-card-del|board-resize-handle/.test(run(`_boardCardHTML(_editCards[0],true)`)));
    state.toasts.length=0;
    const before=run(`_editCards[0].x+','+_editCards[0].y`);
    run(`window.boardsCardDragStart({clientX:0,clientY:0,button:0,pointerId:1,target:{setPointerCapture(){}},preventDefault(){},stopPropagation(){}},'n')`);
    s.ok('a refused move names the ⋯ menu',/⋯ menu to move it/.test(state.toasts.join(' ')),state.toasts.join(' | '));
    s.eq('the card did not move',run(`_editCards[0].x+','+_editCards[0].y`),before);
    state.toasts.length=0;
    run(`window.boardsToggleLock()`);
    s.ok('unlocked again',run(`!_editCards[0].locked`));
    s.ok('said out loud',/unlocked/i.test(state.toasts.join(' ')));
    s.ok('and the padlock is gone',!/board-card-lock/.test(run(`_boardCardHTML(_editCards[0],true)`)));
  }

  // ── Trash: deleted cards go somewhere, and Ctrl+Z still works ─────────
  // The pair has to hold together: undo restores a card under its own id,
  // and the trash row for it must stop showing WITHOUT anything being
  // written. That derivation is the whole design, so it is asserted first.
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    const {run,state}=app;
    // A trash entry is the only thing this module writes that carries a
    // `card`, so that is how the recorded writes are picked out — whether
    // they arrived one at a time or through a batch.
    const trashed=()=>state.writes.filter(w=>w.data&&w.data.card).map(w=>w.data);
    const countOp=op=>state.writes.filter(w=>w.op===op).length;
    const nests=v=>Array.isArray(v)?(v.some(Array.isArray)||v.some(nests))
      :(v&&typeof v==='object'?Object.keys(v).some(k=>nests(v[k])):false);
    const boot=()=>{
      state.toasts.length=0;state.writes.length=0;state.batches.length=0;
      run(`_editBoard={id:'b1',title:'B',ownerUid:'u1',visibility:'personal'};
           _editCards=[
             {id:'n',type:'text',text:'a note',x:0,y:0,w:170,h:100},
             {id:'p',type:'image',imageUrl:'https://res.cloudinary.com/x/a.jpg',x:200,y:0,w:170,h:100},
             {id:'t',type:'table',rows:[['A','B'],['1','2']],x:400,y:0,w:240,h:140}
           ];
           _editConnectors=[{id:'L',from:'n',to:'p'}];
           _boardsCardTrash=[];_boardsSelection=new Set();_boardsConnSel=null;
           _boardsCardTrashOpen=false;_boardsCardTrashTab='mine';`);
    };

    s.section('deleting a card writes a trash entry');
    boot();
    run(`window.boardsDeleteCard('n')`);
    s.eq('one entry written',trashed().length,1);
    s.eq('holding the card',trashed()[0].card.id,'n');
    s.eq('stamped with who',trashed()[0].byUid+'/'+trashed()[0].byName,'u1/Afnan');
    s.ok('and when',typeof trashed()[0].at==='number'&&trashed()[0].at>0);

    s.section('the connectors go WITH the card, captured before the filter');
    // Afterwards there is nothing left to record — a restore without its
    // lines returns a different card from the one that went.
    s.eq('the line attached to it is stored',trashed()[0].conns.map(c=>c.id).join(','),'L');
    s.eq('and it really was removed from the board',run(`_editConnectors.length`),0);

    s.section('a TABLE is encoded on the way in — Firestore refuses nested arrays');
    boot();
    run(`window.boardsDeleteCard('t')`);
    const rows=JSON.stringify(trashed()[0].card.rows);
    s.ok('rows are wrapped, not nested',/^\[\{"c":\[/.test(rows),rows);
    // The RULE, not the field: nothing a trash write produces may nest an
    // array in an array, so a future one fails here first.
    s.ok('nothing written nests an array in an array',!nests(trashed()));

    s.section('a bulk delete is ONE batch, not N round trips');
    boot();
    run(`_boardsSetSelection(['n','p']);window.boardsDeleteSelection()`);
    s.eq('one batch',state.batches.length,1);
    s.eq('carrying both cards',state.batches[0].length,2);
    // The board-activity row is an add too, so the assertion is narrower
    // than "no adds": no TRASH entry may be written outside the batch.
    s.eq('no trash entry outside the batch',
      state.writes.filter(w=>w.op==='add'&&w.data&&w.data.card).length,0);

    s.section('AN ENTRY IS HIDDEN ONCE ITS CARD IS BACK — no write, no bookkeeping');
    // This is what lets Ctrl+Z and the trash coexist. Undo restores the
    // card under its own id; the row stops matching and disappears.
    boot();
    run(`window.boardsDeleteCard('n')`);
    run(`_boardsCardTrash=[{id:'e1',card:{id:'n',type:'text',text:'a note'},conns:[],byUid:'u1',byName:'Afnan',at:Date.now()}]`);
    s.eq('the row shows while the card is gone',run(`_boardsTrashLive().length`),1);
    state.writes.length=0;
    run(`window.boardsUndoAction()`);
    s.eq('the card is back',run(`_editCards.filter(c=>c.id==='n').length`),1);
    s.eq('and the row is gone',run(`_boardsTrashLive().length`),0);
    s.eq('with nothing written to make that true',state.writes.length,0);

    s.section('an entry with no usable card is dropped, not drawn blank');
    run(`_boardsCardTrash=[{id:'x',byUid:'u1',at:1},{id:'y',card:{},byUid:'u1',at:1}]`);
    s.eq('both ignored',run(`_boardsTrashLive().length`),0);

    s.section('the two tabs split on who deleted it');
    boot();
    run(`_boardsCardTrash=[
      {id:'a',card:{id:'g1',type:'text',text:'mine'},byUid:'u1',byName:'Afnan',at:Date.now()},
      {id:'b',card:{id:'g2',type:'image'},byUid:'u2',byName:'Ammar',at:Date.now()}
    ]`);
    s.eq('mine',run(`_boardsTrashTabRows('mine').map(e=>e.id).join(',')`),'a');
    s.eq('theirs',run(`_boardsTrashTabRows('others').map(e=>e.id).join(',')`),'b');

    s.section('purging follows the rules, not the UI');
    // _boardsTrashCanPurge mirrors the firestore.rules delete clause:
    // your own entry, the board's owner, or an app owner.
    s.ok('my own entry, yes',run(`_boardsTrashCanPurge({byUid:'u1'})`));
    s.ok("the board owner may clear someone else's",run(`_boardsTrashCanPurge({byUid:'u2'})`));
    run(`_editBoard.ownerUid='u9';session.role='worker'`);
    s.ok('a plain member may not',!run(`_boardsTrashCanPurge({byUid:'u2'})`));
    s.ok('but still may purge their own',run(`_boardsTrashCanPurge({byUid:'u1'})`));

    s.section('restore puts the card back, and its lines with it');
    boot();
    run(`_boardsCardTrash=[{id:'e',card:{id:'n2',type:'text',text:'back',x:5,y:6,w:170,h:100},
         conns:[{id:'L2',from:'n2',to:'p'},{id:'L3',from:'n2',to:'gone'}],
         byUid:'u1',byName:'Afnan',at:Date.now()}]`);
    run(`window.boardsTrashRestore('e')`);
    s.eq('the card is on the board',run(`_editCards.filter(c=>c.id==='n2').length`),1);
    s.eq('at the position it was deleted from',run(`_editCards.find(c=>c.id==='n2').x+','+_editCards.find(c=>c.id==='n2').y`),'5,6');
    s.eq('the line whose other end is here comes back',run(`_editConnectors.filter(c=>c.id==='L2').length`),1);
    s.eq('the one pointing at a missing card does NOT',run(`_editConnectors.filter(c=>c.id==='L3').length`),0);
    s.ok('and the restore is itself undoable',run(`_boardsUndo.length>0`));

    s.section('a table survives the round trip');
    boot();
    run(`window.boardsDeleteCard('t')`);
    run(`_boardsCardTrash=[{id:'e',card:`+JSON.stringify(trashed()[0].card)+`,conns:[],byUid:'u1',byName:'A',at:1}]`);
    run(`window.boardsTrashRestore('e')`);
    s.eq('rows are a nested array again in memory',
      run(`JSON.stringify(_editCards.find(c=>c.id==='t').rows)`),'[["A","B"],["1","2"]]');

    s.section('restoring twice is refused, not duplicated');
    state.toasts.length=0;
    run(`window.boardsTrashRestore('e')`);
    s.eq('still one copy',run(`_editCards.filter(c=>c.id==='t').length`),1);
    s.ok('and it says so',/already back/i.test(state.toasts.join(' ')),state.toasts.join(' | '));

    s.section('restoring both ends of one line restores it ONCE');
    boot();
    run(`_editCards=[];_editConnectors=[];
         _boardsCardTrash=[
           {id:'e1',card:{id:'c1',type:'text',x:0,y:0,w:170,h:100},conns:[{id:'L9',from:'c1',to:'c2'}],byUid:'u1',at:1},
           {id:'e2',card:{id:'c2',type:'text',x:0,y:0,w:170,h:100},conns:[{id:'L9',from:'c1',to:'c2'}],byUid:'u1',at:1}
         ]`);
    run(`window.boardsTrashRestore('e1')`);
    s.eq('first restore draws nothing yet',run(`_editConnectors.length`),0);
    run(`window.boardsTrashRestore('e2')`);
    s.eq('the second brings the line back',run(`_editConnectors.length`),1);
    run(`window.boardsTrashRestore('e1')`);
    s.eq('and it is never doubled',run(`_editConnectors.filter(c=>c.id==='L9').length`),1);

    s.section('the delete toast names both routes back');
    boot();
    run(`window.boardsDeleteCard('n')`);
    s.ok('Ctrl+Z',/Ctrl\+Z/.test(state.toasts.join(' ')),state.toasts.join(' | '));
    s.ok('and the Trash',/Trash/.test(state.toasts.join(' ')));

    s.section('day headers read as a person would say them');
    const DAY=86400000;
    s.eq('today',run(`_boardsTrashDay(Date.now())`),'Today');
    s.eq('yesterday',run(`_boardsTrashDay(Date.now()-${DAY})`),'Yesterday');
    s.ok('older is a date',!/Today|Yesterday/.test(run(`_boardsTrashDay(Date.now()-5*${DAY})`)));
    // A timestamp a few hours ahead (a clock skew between two devices) must
    // still read as Today rather than falling through to a date.
    s.eq('a slightly-ahead clock still says Today',run(`_boardsTrashDay(Date.now()+3600000)`),'Today');

    s.section('the panel never interpolates a stored string into its HTML');
    boot();
    run(`_boardsCardTrashOpen=true;
         _boardsCardTrash=[{id:'e',card:{id:'z',type:'text',text:'<img src=x onerror=alert(1)>'},
           conns:[],byUid:'u1',byName:'<script>bad</script>',at:Date.now()}]`);
    run(`_boardsRenderTrash()`);
    const html=run(`(document.getElementById('board-ctrash-panel')||{innerHTML:''}).innerHTML`);
    s.ok('no tag can open from the card text',html.indexOf('<img')<0,html.slice(0,160));
    s.ok('and none from the name',html.indexOf('<script')<0);
  }


  // ── The top bar, regrouped (Sept 2026) ────────────────────────────────
  // It carried thirteen same-weight controls in one row, so nothing read as
  // primary and five of them were already hidden on a phone — the tell that
  // the row was over capacity at every width. Everything about how the
  // board is LOOKED AT moved into one View menu, the way Milanote groups it.
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    const {run,state}=app;
    const boot=(phone)=>{
      run(`_editBoard={id:'b1',title:'Winter Drop',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
           _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
           _boardsMenuOpen=false;_boardsViewOpen=false;_boardsPanMode=false;
           _boardsSnapGrid=false;_boardsMinimapOn=true;moodBoards=[];`);
    };
    boot();
    const bar=()=>run(`_renderBoardCanvasHTML()`);

    s.section('the view controls left the bar for one View menu');
    const html=bar();
    // Each of these used to be its own top-level button in the row.
    ['board-view-btn','board-view-menu'].forEach(id=>
      s.ok('the bar carries '+id,html.indexOf('id="'+id+'"')>-1));
    s.ok('Fit moved into it',/board-view-menu[\s\S]*?id="board-fit-btn"/.test(html));
    s.ok('Snap too',/board-view-menu[\s\S]*?id="board-snap-btn"/.test(html));
    s.ok('and the minimap toggle',/board-view-menu[\s\S]*?Minimap:/.test(html));
    s.ok('the bare ✋ chip is gone from the row',html.indexOf('>✋<')<0);

    s.section('the zoom reading stays visible, and keeps its id');
    // _boardsApplyTransform writes #board-zoom-readout on every pan and
    // zoom. Moving it inside the View button rather than renaming it is
    // what lets that function stay untouched.
    s.ok('the readout rides the View button',
      /id="board-view-btn"[\s\S]*?id="board-zoom-readout"[\s\S]*?<\/button>/.test(html));
    run(`_editBoard.zoom=0.42;_boardsApplyTransform()`);
    s.eq('and the transform updates it',run(`document.getElementById('board-zoom-readout').textContent`),'42%');

    s.section('the stale "Saved" is gone');
    // The save indicator was deliberately removed (see "Making it feel
    // instant"), but the markup still SHIPPED the word, so every board
    // opened claiming it had just saved.
    s.ok('the status span is empty in the markup',
      /id="board-save-status"><\/span>/.test(html),html.slice(html.indexOf('board-save-status')-40,html.indexOf('board-save-status')+60));

    s.section('opening one dropdown closes the other');
    run(`window.boardsToggleViewMenu(null)`);
    s.ok('View opens',run(`_boardsViewOpen`));
    run(`window.boardsToggleMenu(null)`);
    s.ok('the ⋯ menu takes over',run(`_boardsMenuOpen`));
    s.ok('and View closed',!run(`_boardsViewOpen`));
    run(`window.boardsToggleViewMenu(null)`);
    s.ok('and back the other way',run(`_boardsViewOpen&&!_boardsMenuOpen`));

    s.section('one sync function drives both dropdowns');
    // Eight call sites already do `_boardsMenuOpen=false;_boardsSyncMenu()`
    // after an action. Teaching that ONE function about the second menu is
    // what let all eight stay untouched. It REFLECTS the flags, it does not
    // clear them — and it does not need to, because the two toggles above
    // make it impossible for both to be open at once.
    run(`_boardsMenuOpen=false;_boardsViewOpen=false;_boardsSyncMenu()`);
    s.eq('both hidden',run(`document.getElementById('board-view-menu').style.display+','+document.getElementById('board-menu').style.display`),'none,none');
    run(`_boardsViewOpen=true;_boardsSyncMenu()`);
    s.eq('View shown, ⋯ still hidden',run(`document.getElementById('board-view-menu').style.display+','+document.getElementById('board-menu').style.display`),'flex,none');
    s.ok('and the View button reads as active',run(`document.getElementById('board-view-btn').classList.contains('on')`));
    run(`window.boardsToggleMenu(null)`);
    s.eq('opening ⋯ swaps them',run(`document.getElementById('board-view-menu').style.display+','+document.getElementById('board-menu').style.display`),'none,flex');
    s.ok('so the two can never both be open',!run(`_boardsMenuOpen&&_boardsViewOpen`));

    s.section('Snap repaints its own label — it does not re-render');
    // pan and minimap both rebuild the canvas (fresh labels, and
    // _boardsSyncMenu restores the open state); snap does not, so it is the
    // one that has to write its own text.
    boot();
    run(`_renderBoardCanvasHTML();_boardsSnapGrid=false`);
    run(`document.getElementById('board-snap-btn').textContent='Snap to grid: off'`);
    run(`window.boardsToggleSnap()`);
    s.eq('the label flips',run(`document.getElementById('board-snap-btn').textContent`),'Snap to grid: on');
    run(`window.boardsToggleSnap()`);
    s.eq('and back',run(`document.getElementById('board-snap-btn').textContent`),'Snap to grid: off');

    s.section('the ⋯ menu no longer duplicates the view actions on a phone');
    // It used to carry Fit / Zoom to 100% / Snap at phone width only. View
    // offers them at every width now, and two surfaces for one action is
    // exactly what the rail/selection-bar merge exists to prevent.
    const app2=loadApp({files:FILES,phone:true,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    app2.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];moodBoards=[];
      _boardsMenuOpen=false;_boardsViewOpen=false;`);
    const ph=app2.run(`_renderBoardCanvasHTML()`);
    const menu=ph.slice(ph.indexOf('id="board-menu"'));
    s.ok('no Fit to screen in the ⋯ menu',menu.indexOf('Fit to screen')<0);
    s.ok('no second Zoom to 100%',menu.indexOf('Zoom to 100%')<0);
    s.ok('but View is still there on a phone',ph.indexOf('id="board-view-btn"')>-1);
    s.ok('and the minimap toggle is NOT offered on a phone',
      ph.slice(ph.indexOf('board-view-menu')).indexOf('Minimap:')<0);
  }


  // ── Level of detail by zoom ───────────────────────────────────────────
  // Afnan compared our board at 22% with Milanote's at 27%: theirs reads,
  // ours does not. The cause was NOT font size — it is that we painted
  // every piece of card chrome at every zoom. Verified before the change:
  // there was no zoom-dependent rendering in the file at all.
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    const {run}=app;
    run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
         _editCards=[];_editConnectors=[];_boardsSelection=new Set();moodBoards=[];`);

    s.section('three buckets, and the boundaries are exact');
    // 0.25 is the floor now; the buckets below it are unreachable but the
    // function is pure and still answers, which is what is asserted.
    [[0.25,'far'],[0.3,'far'],[0.34,'far'],[0.35,'mid'],[0.5,'mid'],
     [0.69,'mid'],[0.7,'near'],[1,'near'],[3,'near']].forEach(([z,want])=>{
      s.eq(Math.round(z*100)+'% → '+want,run(`_boardsLodFor(${z})`),want);
    });
    // The zoom Afnan was looking at, and Milanote's in the same screenshot.
    s.eq('our 22% is far',run(`_boardsLodFor(0.22)`),'far');
    s.eq("Milanote's 27% would be too",run(`_boardsLodFor(0.27)`),'far');
    s.eq('junk does not throw',run(`_boardsLodFor(undefined)`),'far');

    s.section('the transform stamps it on the world');
    run(`_editBoard.zoom=0.22;_boardsApplyTransform()`);
    s.eq('far',run(`document.getElementById('board-world').getAttribute('data-lod')`),'far');
    run(`_editBoard.zoom=1;_boardsApplyTransform()`);
    s.eq('and back to near',run(`document.getElementById('board-world').getAttribute('data-lod')`),'near');

    s.section('the attribute is only WRITTEN when the bucket changes');
    // _boardsApplyTransform runs on every pointermove of a pan and every
    // frame of a pinch. Writing the attribute each time would thrash the
    // style engine for no reason.
    run(`__w=document.getElementById('board-world');__n=0;
         __orig=__w.setAttribute.bind(__w);
         __w.setAttribute=function(k,v){if(k==='data-lod')__n++;return __orig(k,v);};`);
    run(`_editBoard.zoom=1;_boardsApplyTransform();_boardsApplyTransform();_boardsApplyTransform()`);
    s.eq('three applies at one zoom write nothing',run(`__n`),0);
    run(`_editBoard.zoom=0.2;_boardsApplyTransform();_boardsApplyTransform()`);
    s.eq('crossing a boundary writes exactly once',run(`__n`),1);
  }


  // ── an image card is sized to its picture ─────────────────────────────
  // Afnan pasted ONE photo into Milanote and into this board: theirs kept
  // the garment whole, ours cut the top and bottom off. Card images draw
  // with object-fit:cover (which CROPS to fill), and an image card was born
  // 170×120 and never resized — while the file branch three lines away
  // always called _boardsFitPdfCard. So a portrait photo showed the middle
  // 170×120 slice of itself and nothing else.
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    const {run}=app;
    const boot=()=>run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editCards=[];_editConnectors=[];_editUnsorted=[];_boardsSelection=new Set();
      _boardsSaveDebounced=()=>{};_boardsRenderCanvasAndWire=()=>{};_boardsRenderSoon=()=>{};
      __uploads=[];
      _boardsUploadAny=f=>new Promise((ok,bad)=>__uploads.push({f,ok,bad}));`);
    const tick=()=>new Promise(r=>setImmediate(r));
    const ratio=id=>run(`(c=>Math.round((c.w/c.h)*1000)/1000)(_editCards.find(c=>c.id==='${id}'))`);

    _pending.push((async()=>{
      s.section('the shape a fitted card takes');
      boot();
      const fit=(w,h)=>run(`(function(){const c=_boardsNewCard('image');
        _boardsFitImageCard(c,{width:${w},height:${h}});return c.w+'x'+c.h;})()`);
      // The garment photo from the screenshot: tall portrait.
      s.eq('a 1000×1500 portrait',fit(1000,1500),'240x360');
      s.eq('a 1600×900 landscape',fit(1600,900),'240x135');
      s.eq('a square',fit(800,800),'240x240');

      s.section('a very tall picture keeps its RATIO, not just its cap');
      // Clamping the height alone would crop the very thing this exists to
      // stop cropping, so the width comes down with it.
      const tall=fit(500,5000);
      const tw=+tall.split('x')[0],th=+tall.split('x')[1];
      s.eq('height is capped',th,520);
      s.ok('and the width followed it down',tw<240,tall);
      s.ok('the ratio still matches the picture exactly',Math.abs((tw/th)-(500/5000))<0.005,tall);

      s.section('no dimensions back → the default is left alone');
      s.eq('missing',fit(0,0),'170x120');
      s.eq('junk',run(`(function(){const c=_boardsNewCard('image');
        _boardsFitImageCard(c,{width:'x',height:null});return c.w+'x'+c.h;})()`),'170x120');
      s.eq('no response at all',run(`(function(){const c=_boardsNewCard('image');
        _boardsFitImageCard(c);return c.w+'x'+c.h;})()`),'170x120');

      s.section('a card someone already sized is never re-fitted');
      s.eq('hand-sized card untouched',run(`(function(){const c=_boardsNewCard('image');
        c.w=400;c.h=400;_boardsFitImageCard(c,{width:1000,height:1500});return c.w+'x'+c.h;})()`),'400x400');

      s.section('pasting a photo produces a card the shape of the photo');
      // This is the reported bug end to end: _boardsOnPaste routes through
      // _boardsUploadFileToCard, which is where the image branch had no fit.
      boot();
      run(`(function(){const c=_boardsNewCard('image');c.id='p1';_editCards.push(c);})();
           _boardsUploadFileToCard('p1',{name:'hoodie.png',type:'image/png',size:9})`);
      await tick();
      run(`__uploads[0].ok({secure_url:'https://res.cloudinary.com/x/image/upload/v1/h.png',width:1000,height:1500})`);
      await tick();await tick();
      s.eq('the card is portrait, like the picture',run(`(c=>c.w+'x'+c.h)(_editCards[0])`),'240x360');
      s.ok('so cover crops nothing',Math.abs(ratio('p1')-(1000/1500))<0.02);

      s.section('resized mid-upload → left alone, same guard the file path uses');
      boot();
      run(`(function(){const c=_boardsNewCard('image');c.id='p2';_editCards.push(c);})();
           _boardsUploadFileToCard('p2',{name:'a.png',type:'image/png',size:9})`);
      await tick();
      run(`(c=>{c.w=333;c.h=222;})(_editCards[0])`);
      run(`__uploads[0].ok({secure_url:'https://res.cloudinary.com/x/image/upload/v1/a.png',width:1000,height:1500})`);
      await tick();await tick();
      s.eq('kept the hand size',run(`(c=>c.w+'x'+c.h)(_editCards[0])`),'333x222');

      s.section('out of the Unsorted tray, already the right shape');
      // A tray item keeps no PDF page size, but an image costs nothing to
      // carry — Cloudinary hands the dimensions back with the URL.
      boot();
      const t=JSON.parse(run(`JSON.stringify(_boardsCardFromTrayItem({id:'u',kind:'image',
        imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.png',imgW:1000,imgH:1500},{x:0,y:0}))`));
      s.eq('portrait out of the tray',t.w+'x'+t.h,'240x360');
      const t2=JSON.parse(run(`JSON.stringify(_boardsCardFromTrayItem({id:'u',kind:'image',
        imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.png'},{x:0,y:0}))`));
      s.eq('an older tray item with no dimensions keeps the default',t2.w+'x'+t2.h,'170x120');
    })());
  }


  // ── the image preview closes on the backdrop ──────────────────────────
  // Afnan: "double clicked on the image to open it bigger but when i click
  // on the grid to close it does not close, it closes by just clicking on
  // cross on the top right". The handler existed — it tested
  // `e.target===wrap`, which is essentially never true, because the wrap is
  // a flex column fully covered by its own bar plus .board-preview-body
  // (flex:1). The dark space around the picture IS that body.
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
    const {run}=app;
    const node=cls=>run(`(function(){const n=document.createElement('div');
      ${cls?`n.classList.add('${cls}');`:''}return n;})()`);

    s.section('the dark space around the picture closes it');
    run(`__wrap=document.createElement('div');
         __body=document.createElement('div');__body.classList.add('board-preview-body');
         __img=document.createElement('img');__img.classList.add('board-preview-img');
         __bar=document.createElement('div');__bar.classList.add('board-preview-bar');
         __btn=document.createElement('button');__btn.classList.add('tool-btn');
         __frame=document.createElement('iframe');__frame.classList.add('board-preview-frame');`);
    s.ok('the body around the image IS the backdrop',run(`_boardsPreviewBackdrop(__body,__wrap)`));
    s.ok('and so is the wrap itself, if it is ever exposed',run(`_boardsPreviewBackdrop(__wrap,__wrap)`));

    s.section('the thing you came to look at never dismisses itself');
    s.ok('not the picture',!run(`_boardsPreviewBackdrop(__img,__wrap)`));
    s.ok('not the PDF viewer',!run(`_boardsPreviewBackdrop(__frame,__wrap)`));
    s.ok('not the top bar',!run(`_boardsPreviewBackdrop(__bar,__wrap)`));
    s.ok('not a button in it',!run(`_boardsPreviewBackdrop(__btn,__wrap)`));
    s.ok('and a null target does nothing',!run(`_boardsPreviewBackdrop(null,__wrap)`));

    s.section('Escape still closes it, and stops there');
    // It listens in the CAPTURE phase and stops propagation, so Escape does
    // not also reach the board and clear the selection behind the overlay.
    run(`__stopped=0;__removed=0;
         document.getElementById=function(){return null;};`);
    run(`_boardsPreviewKey({key:'Escape',stopPropagation(){__stopped++;}})`);
    s.eq('Escape is consumed',run(`__stopped`),1);
    run(`_boardsPreviewKey({key:'a',stopPropagation(){__stopped++;}})`);
    s.eq('any other key is left alone',run(`__stopped`),1);
  }

  /* ── DRAGGING ANYTHING INTO UNSORTED (Sept 2026) ──────────────────────
     Afnan: "when inside a board you can drag anything link file image
     collum etc and save it in unsorted so the board remains clean."

     The half worth testing hardest is not the gesture — it is what a
     stashed card KEEPS. The old tray item was a hand-mapped summary, so
     a to-do or a table came back as an empty note. */
  {
    const app=loadApp({files:FILES,globals:{requestAnimationFrame:()=>0}});
    const {run,state}=app;
    const boot=(extra)=>run(`
      _editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      moodBoards=[{id:'b1',ownerUid:'u1',visibility:'shared',title:'T',cards:[]}];
      _editCards=[];_editConnectors=[];_editUnsorted=[];_boardsSelection=new Set();
      _boardsUndo=[];_boardsRedo=[];_boardsTrayOpen=false;
      `+(extra||''));
    const back=(i,x,y)=>run(`JSON.stringify(_boardsCardsFromTrayItem(_editUnsorted[${i||0}],{x:${x||0},y:${y||0}}))`);

    s.section('a stashed card keeps everything it was');
    boot(`_editCards=[{id:'t1',type:'todo',x:10,y:20,w:240,h:170,title:'Cutting',
      items:[{t:'trace',done:true},{t:'bundle',depth:1}]}];`);
    run(`window.boardsTrayStashCards(['t1'])`);
    s.eq('it left the board',run(`_editCards.length`),0);
    s.eq('and there is one row in Unsorted',run(`_editUnsorted.length`),1);
    // The bug this replaces: a to-do has no c.text, so the old mapping
    // wrote {kind:'text',text:''} and the card came back EMPTY.
    const todo=JSON.parse(back(0,500,500));
    s.eq('it comes back a to-do, not a note',(todo.cards[0]||{}).type,'todo');
    const ti=(todo.cards[0]||{}).items||[];
    s.eq('with its tasks',ti.map(i=>i.t).join('+'),'trace+bundle');
    s.ok('and their state',!!(ti[0]&&ti[0].done===true&&ti[1]&&ti[1].depth===1));
    s.eq('centred on the drop point',(todo.cards[0]||{}).x+','+(todo.cards[0]||{}).y,'380,415');

    /* A table's `rows` is an array of arrays and FIRESTORE REFUSES THOSE
       OUTRIGHT — the bug that meant table content never persisted at all.
       `unsorted` is saved on the board document exactly like `cards`, so
       a stashed table is the same shape in the same place. The assertion
       is the RULE, not the field: nothing a save produces may nest an
       array inside an array. */
    s.section('a stashed table cannot nest an array in an array');
    boot(`_editCards=[{id:'tb',type:'table',x:0,y:0,w:360,h:200,head:true,
      rows:[['Size','Qty'],['M','40']]}];`);
    run(`window.boardsTrayStashCards(['tb'])`);
    const nested=run(`(function(){
      let bad=0;
      const walk=v=>{
        if(!Array.isArray(v))return v&&typeof v==='object'?Object.keys(v).forEach(k=>walk(v[k])):0;
        v.forEach(x=>{if(Array.isArray(x))bad++;walk(x);});
      };
      walk(_boardsUnsortedForSave());
      return bad;})()`);
    s.eq('no array directly inside an array',nested,0);
    const tbl=JSON.parse(back(0,0,0));
    s.eq('and it decodes back to real rows',JSON.stringify((tbl.cards[0]||{}).rows),'[["Size","Qty"],["M","40"]]');
    s.eq('the row says TABLE, not NOTE',
      (run(`_boardsTrayItemHTML(_editUnsorted[0],0,true)`).match(/thumb-empty">([^<]*)/)||[])[1],'TABLE');

    /* "collum etc" is the whole point: a column parked without its
       children is an empty box, and children left behind are loose cards
       that used to be organised. */
    s.section('a column goes as ONE row, children and all');
    boot(`_editCards=[
      {id:'col',type:'column',x:100,y:100,w:280,h:400,title:'Fabric'},
      {id:'a',type:'text',text:'one',columnId:'col',x:112,y:175,w:256,h:100},
      {id:'b',type:'text',text:'two',columnId:'col',x:112,y:285,w:256,h:100},
      {id:'free',type:'text',text:'loose',x:700,y:100,w:170,h:100}];
      _editConnectors=[{id:'k1',from:'a',to:'b',arrow:true},{id:'k2',from:'b',to:'free',arrow:true}];`);
    // Only the column is asked for — expansion happens inside the stash,
    // so the menu (one id) and the drag (an expanded group) agree.
    run(`window.boardsTrayStashCards(['col'])`);
    s.eq('one row, not three',run(`_editUnsorted.length`),1);
    s.eq('carrying three cards',run(`((_editUnsorted[0]||{}).cards||[]).length`),3);
    s.eq('the loose card stayed',run(`_editCards.map(c=>c.id).join()`),'free');
    s.eq('the row names the column and counts them',run(`_boardsTrayLabel(_editUnsorted[0])`),'Fabric · 2 cards');
    // Both ends going → the line rides along. One end left behind has
    // nothing to come back to — the trash's rule.
    s.eq('the internal line rode along',run(`((_editUnsorted[0]||{}).conns||[]).map(c=>c.id).join()`),'k1');
    s.eq('and the one reaching outside did not',run(`_editConnectors.length`),0);
    const col=JSON.parse(back(0,1000,1000));
    s.eq('it comes back a column with both children',
      (col.cards||[]).map(c=>c.type).join(),'column,text,text');
    s.ok('the children still point at it',
      (col.cards||[]).length>1&&col.cards.slice(1).every(c=>c.columnId===col.cards[0].id));
    s.eq('in the order they were in',(col.cards||[]).slice(1).map(c=>c.text).join(),'one,two');
    s.eq('and the line came back too',(col.conns||[]).length,1);
    const cc=col.cards||[],k0=(col.conns||[])[0]||{};
    s.ok('remapped through the same ids',
      !!(cc[1]&&cc[2]&&k0.from===cc[1].id&&k0.to===cc[2].id));
    // Relative geometry: the group lands in the shape it left in.
    s.eq('the children keep their offsets from the column',
      cc.length>2?(cc[1].y-cc[0].y)+','+(cc[2].y-cc[0].y):'(only '+cc.length+' cards)','75,185');

    s.section('a frame takes whatever is sitting inside it');
    boot(`_editCards=[
      {id:'f',type:'frame',x:0,y:0,w:400,h:400,title:'Denim'},
      {id:'in',type:'text',text:'inside',x:50,y:50,w:100,h:100},
      {id:'out',type:'text',text:'outside',x:900,y:50,w:100,h:100}];`);
    run(`window.boardsTrayStashCards(['f'])`);
    s.eq('one row',run(`_editUnsorted.length`),1);
    s.eq('with the frame and its card',run(`((_editUnsorted[0]||{}).cards||[]).map(c=>c.id).join()`),'f,in');
    s.eq('the card outside stayed',run(`_editCards.map(c=>c.id).join()`),'out');

    s.section('several loose cards are several rows');
    boot(`_editCards=[{id:'p',type:'text',text:'a',x:0,y:0,w:170,h:100},
      {id:'q',type:'text',text:'b',x:200,y:0,w:170,h:100},
      {id:'r',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg',x:400,y:0,w:170,h:120}];`);
    run(`window.boardsTrayStashCards(['p','q','r'])`);
    s.eq('three rows you can bring back one at a time',run(`_editUnsorted.length`),3);
    s.eq('the picture row still shows its picture',run(`(_editUnsorted[2]||{}).kind`),'image');
    s.ok('through the thumbnail, not a badge',
      /board-tray-thumb" src=/.test(run(`_boardsTrayItemHTML(_editUnsorted[2],2,true)`)));

    /* A card's comments live at mood_boards/{board}/comments keyed by card
       id, so a card that goes to Unsorted and comes back must keep its
       thread. An id already taken is remapped, and columnId and the
       connectors go through the same map. */
    s.section('ids are kept where they are free, remapped where they are not');
    boot(`_editCards=[{id:'keepme',type:'text',text:'x',x:0,y:0,w:170,h:100}];`);
    run(`window.boardsTrayStashCards(['keepme'])`);
    s.eq('a free id comes back unchanged',(JSON.parse(back(0,0,0)).cards[0]||{}).id,'keepme');
    run(`_editCards=[{id:'keepme',type:'text',text:'other',x:0,y:0,w:170,h:100}]`);
    const clash=JSON.parse(back(0,0,0));
    s.ok('a taken id is remapped instead of colliding',(clash.cards[0]||{}).id!=='keepme');
    s.ok('and it is a real card id',/^c\d+_/.test((clash.cards[0]||{}).id||''));

    s.section('what is NOT stashable, and it is refused whole');
    boot(`_editCards=[{id:'bl',type:'board',boardId:'B',x:0,y:0,w:340,h:136},
      {id:'n',type:'text',text:'n',x:400,y:0,w:170,h:100}];
      _boardsSelection=new Set(['bl','n']);`);
    s.ok('a board link is not a drop target',run(`_boardsStashDrag([{type:'board',boardId:'B'}])===false`));
    s.ok('nor is a group holding one',
      run(`_boardsStashDrag([{type:'text'},{type:'board',boardId:'B'}])===false`));
    s.ok('an ordinary group is',run(`_boardsStashDrag([{type:'text'},{type:'column'}])===true`));
    s.ok('the menu agrees with the gesture',
      !/stash/.test(run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act||''))`)));
    // HOME has no Unsorted, so an item pushed there would be saved on the
    // document and reachable from nowhere. This used to be offered.
    run(`_editBoard.isHome=true;_boardsSelection=new Set(['n'])`);
    s.ok('and Home offers it at all',
      !/stash/.test(run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act||''))`)));
    s.eq('nor does the call do anything there',run(`window.boardsTrayStashCards(['n'])`),0);
    s.eq('nothing was collected',run(`_editUnsorted.length`),0);
    s.ok('and the gesture is off on Home and on a phone',
      run(`_boardsStashDrag([{type:'text'}])===false`));

    s.section('a locked card is kept on the board, and counted');
    boot(`_editCards=[
      {id:'col',type:'column',x:0,y:0,w:280,h:400,title:'Fabric'},
      {id:'a',type:'text',text:'one',columnId:'col',x:12,y:75,w:256,h:100},
      {id:'b',type:'text',text:'two',columnId:'col',x:12,y:185,w:256,h:100,locked:true}];`);
    run(`window.boardsTrayStashCards(['col'])`);
    s.eq('the locked one stayed',run(`_editCards.map(c=>c.id).join()`),'b');
    s.ok('and the toast says so rather than dropping it silently',
      /1 locked card kept on the board/.test(state.toasts.slice(-1)[0]),state.toasts.slice(-1)[0]);

    s.section('collecting is never invisible, and it is undoable');
    boot(`_editCards=[{id:'z',type:'text',text:'z',x:0,y:0,w:170,h:100}];
      _editUnsorted=[{id:'old',kind:'text',text:'was here already'}];`);
    s.ok('the tray starts shut',run(`_boardsTrayOpen===false`));
    run(`window.boardsTrayStashCards(['z'])`);
    s.ok('stashing opens it',run(`_boardsTrayOpen===true`));
    s.eq('two rows now',run(`_editUnsorted.length`),2);
    s.eq('one undo entry',run(`_boardsUndo.length`),1);
    run(`window.boardsUndoAction()`);
    s.eq('and undo puts the card back',run(`_editCards.length+':'+(_editCards[0]||{}).id`),'1:z');
    /* THE HALF THAT MADE THE SNAPSHOT CHANGE NECESSARY. The undo snapshot
       was cards and connectors only, so Ctrl+Z restored the card and left
       the copy in Unsorted — the same card in two places, which is worse
       than no undo at all. */
    s.eq('and takes back only the row it added',run(`_editUnsorted.map(u=>u.id).join()`),'old');
    /* The same widening closes one that was already there and had no
       symptom anyone would report: the drag OUT of the tray pushes undo
       too, and Ctrl+Z used to take the card off the board WITHOUT putting
       the item back. The thing was simply gone. */
    boot(`_editUnsorted=[{id:'u1',kind:'text',text:'collected'}];`);
    run(`_boardsPushUndo();
      _editCards.push(_boardsCardsFromTrayItem(_editUnsorted[0],{x:0,y:0}).cards[0]);
      _editUnsorted=[]`);
    run(`window.boardsUndoAction()`);
    s.eq('undoing a drag OUT of the tray puts the item back',run(`_editUnsorted.length`),1);
    s.eq('and takes the card off the board',run(`_editCards.length`),0);

    /* The GESTURE, driven for real — boardsCardDragStart, a pointermove to
       make it a drag rather than a click, then a pointerup over the tray.
       Everything that decides the drop lives in that handler's closure, so
       grepping the source proves nothing about what it does. */
    s.section('the drag itself puts a card in Unsorted');
    {
      const app2=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas',globals:{requestAnimationFrame:()=>0}});
      const r2=x=>app2.run(x);
      const setup=`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
        moodBoards=[{id:'b1',ownerUid:'u1',visibility:'shared',title:'T',cards:[]}];
        _editCards=[{id:'n1',type:'text',text:'keep me',x:40,y:60,w:170,h:100}];
        _editConnectors=[];_editUnsorted=[];_boardsSelection=new Set(['n1']);
        _boardsUndo=[];_boardsRedo=[];_boardsTrayOpen=true;_boardsSuppressClick=false;
        // The open tray is the right-hand strip. The harness's default rect
        // has no right/bottom, so it is given a real one.
        document.getElementById('board-tray').getBoundingClientRect=
          function(){return{left:800,right:1200,top:0,bottom:600};};`;
      // Driven through the DOCUMENT listeners: the capture is deferred past
      // the drag threshold, so the tracking is document-wide.
      const fire=(x,y)=>{
        const ev=t=>({type:t,clientX:x,clientY:y,pointerId:1,altKey:false,shiftKey:false});
        (app2.state.listeners.pointermove||[]).slice().forEach(f=>f(ev('pointermove')));
        (app2.state.listeners.pointerup||[]).slice().forEach(f=>f(ev('pointerup')));
      };
      const drag=(x,y)=>{
        r2(`(function(){
          const head=document.getElementById('drag-body');
          window.boardsCardDragStart({currentTarget:head,target:head,clientX:0,clientY:0,pointerId:1,
            stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false},'n1');})()`);
        fire(x,y);
      };

      r2(setup);
      drag(900,300);                         // over the tray
      s.eq('the card is off the board',r2(`_editCards.length`),0);
      s.eq('and in Unsorted',r2(`_editUnsorted.length`),1);
      s.eq('still itself',r2(`(((_editUnsorted[0]||{}).cards||[])[0]||{}).text||'(nothing collected)'`),'keep me');
      // ONE entry: the drag's own is popped before boardsTrayStashCards
      // pushes its own, or Ctrl+Z would put the card back where it was
      // DROPPED and need a second press.
      s.eq('one undo entry, not two',r2(`_boardsUndo.length`),1);
      r2(`window.boardsUndoAction()`);
      s.eq('undo brings it back',r2(`_editCards.length`),1);
      s.eq('exactly where it started',r2(`_editCards[0].x+','+_editCards[0].y`),'40,60');
      s.eq('and out of Unsorted',r2(`_editUnsorted.length`),0);

      r2(setup);
      drag(300,300);                         // over the canvas
      s.eq('a drop on the canvas is an ordinary move',r2(`_editCards.length`),1);
      s.eq('and collects nothing',r2(`_editUnsorted.length`),0);

      // A board link dropped on the tray is a move like any other.
      r2(setup+`_editCards=[{id:'k1',type:'board',boardId:'B',x:40,y:60,w:340,h:136}];
        _boardsSelection=new Set(['k1']);`);
      r2(`(function(){
        const head=document.getElementById('drag-body2');
        window.boardsCardDragStart({currentTarget:head,target:head,clientX:0,clientY:0,pointerId:1,
          stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false},'k1');})()`);
      fire(900,300);
      s.eq('a board link dropped on the tray stays on the board',r2(`_editCards.length`),1);
      s.eq('and nothing was collected',r2(`_editUnsorted.length`),0);
    }
  }

  /* ── THE HAND TOOL MOVES TO THE RAIL (Sept 2026) ─────────────────────
     Afnan, with the View menu open and an arrow drawn to the foot of the
     rail: *"i want this hand funtion to sit on side bar as it is used very
     often"*. It was a row inside View — two clicks for a mode you flip
     constantly, and no state visible until you opened the menu again. */
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
      currentPage:'board-canvas'});
    const {run}=app;
    const boot=()=>run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
      moodBoards=[{id:'b1',ownerUid:'u1',visibility:'personal',title:'T',cards:[]}];
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
      _boardsPanMode=false;_boardsLineMode=false;`);
    const acts=()=>JSON.parse(run(`JSON.stringify(_boardsRailItems().filter(i=>i.act).map(i=>i.act))`));
    const item=a=>JSON.parse(run(`JSON.stringify(_boardsRailItems().find(i=>i.act===${JSON.stringify(a)})||null)`));

    s.section('Hand is on the rail, next to Fit');
    boot();
    const a=acts();
    s.ok('the rail carries it',a.includes('pan'),a.join(','));
    s.eq('directly after Fit — both change how you LOOK at the board',
      a.slice(a.indexOf('fit'),a.indexOf('fit')+2).join(','),'fit,pan');
    s.eq('and it is labelled',(item('pan')||{}).label,'Hand');
    s.ok('with an icon of its own',!!(item('pan')||{}).icon);

    /* A MODE NEEDS ITS STATE ON THE BUTTON. That is the whole reason the
       menu row was a bad home: it only said "on" once you reopened it. */
    s.section('the button says whether the mode is on');
    s.eq('off by default',String((item('pan')||{}).on),'false');
    run(`_boardsPanMode=true`);
    s.eq('and on once it is',String((item('pan')||{}).on),'true');
    s.ok('which the renderer paints as a class',
      /class="rail-btn on[^"]*" data-act="pan"/.test(run(`(function(){
        _boardsRenderRail();return document.getElementById('board-rail').innerHTML;})()`)),
      'no .on class on the Hand button');
    run(`_boardsPanMode=false`);

    s.section('pressing it toggles the mode');
    boot();
    run(`_boardsCtxRun('pan')`);
    s.ok('one press turns it on',run(`_boardsPanMode===true`));
    run(`_boardsCtxRun('pan')`);
    s.ok('and the next turns it off',run(`_boardsPanMode===false`));

    /* ONE SURFACE, NOT TWO — the rule that merged the rail and the old
       selection bar, and the same one that took Comment off the rail in
       this round. A toggle in two places is two things to find and two
       labels to keep in step. */
    s.section('and it left the View menu');
    boot();
    const bar=run(`_renderBoardCanvasHTML()`);
    s.ok('no Hand row in View',!/Hand \(drag to pan\)/.test(bar));
    s.ok('boardsTogglePan is reached from the rail, not a menu button',
      !/onclick="window\.boardsTogglePan\(\)"/.test(bar));
    s.ok('View still carries the things it is for',
      /Snap to grid/.test(bar)&&/Zoom to 100%/.test(bar)&&/Minimap/.test(bar));

    /* THE SWAP, AND WHY IT WAS FORCED. Measured with
       scratchpad/measure-rail-hand.js against the real stylesheet: a
       13-tool rail is 871px in the large tier and 673px compact, and a
       768px-tall laptop leaves about 631px of stage. Twelve fits, thirteen
       does not — so Hand took a place rather than adding one, and the
       place it took was the tool already sitting one click away on a
       button you can always see. */
    s.section('Comment went to the top bar, and nothing was lost');
    boot();
    s.eq('the rail is twelve tools, the measured capacity',acts().length,12);
    s.ok('Comment is not one of them',!acts().includes('comment-board'));
    s.ok('but the top bar still opens the same drawer',
      /id="board-cmt-btn"[^>]*onclick="window\.boardsToggleDrawer\(\)"/.test(bar),
      'no Comments button in the top bar');
    s.ok('and that button shows whether the drawer is open',
      /board-cmt-btn/.test(bar)&&/tool-btn\$\{_boardsDrawerOpen/.test(
        require('fs').readFileSync(ROOT+'/js/boards.js','utf8')));

    /* NOT ON A PHONE, and this is not an oversight. A touch drag already
       pans unconditionally, so the toggle would be a control that changes
       nothing there. Keeping it out of _BOARDS_RAIL_MAIN is what enforces
       that by construction — everything in that list reaches the phone's
       More sheet. */
    s.section('a phone never sees it, because a touch drag already pans');
    {
      const ph=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        phone:true,currentPage:'board-canvas'});
      ph.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
        _editCards=[];_editConnectors=[];_boardsSelection=new Set();
        _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;`);
      const pacts=JSON.parse(ph.run(`JSON.stringify(_boardsRailItems().filter(i=>i.act).map(i=>i.act))`));
      const pover=JSON.parse(ph.run(`JSON.stringify(_boardsRailPhoneOverflow().map(i=>i.act))`));
      s.ok('not on the phone dock',!pacts.includes('pan'),pacts.join(','));
      s.ok('nor behind its More sheet',!pover.includes('pan'),pover.join(','));
      s.ok('it is not an add-tool, which is what keeps it off both',
        !JSON.parse(ph.run(`JSON.stringify(_BOARDS_RAIL_MAIN.map(i=>i.act))`)).includes('pan'));
      // The reason, asserted rather than left in a comment: touch is the
      // FIRST term of wantPan, so it pans whatever the toggle says.
      s.ok('a touch drag pans with the toggle off',
        /const wantPan=\(e\.pointerType==='touch'\)\|\|/.test(
          require('fs').readFileSync(ROOT+'/js/boards.js','utf8')));
    }
  }

  /* ── THE UNSORTED TRAY: BIGGER, SORTED, AND NOT CROPPED (Sept 2026) ───
     Afnan, with five items circled: *"make unsorted bigger for better drag
     to drop movement + unsorted should have sort by category option in it
     as well ( links ) ( images ) ( files ) ( etc. etc. ) + the preview of
     unsorted should be logically well as well as the current model preview
     is not right."*

     The third one was a real bug: the thumbnail was `object-fit:cover` in a
     fixed 84px box, so a full-length model reference rendered as the strip
     across its middle — a pair of legs. That half is CSS and is held by
     tests/smoke-layout.js; this suite holds the filter, and in particular
     the one thing a filtered list can get catastrophically wrong. */
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
      currentPage:'board-canvas'});
    const {run}=app;
    const ITEMS=`[
      {id:'a',kind:'image',name:'Model REF 1',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/a.jpg'},
      {id:'b',kind:'link', linkUrl:'https://x.test/1',linkTitle:'x.test'},
      {id:'c',kind:'file', fileName:'oil-wash.pdf',fileUrl:'https://res.cloudinary.com/x/image/upload/v1/o.pdf'},
      {id:'d',kind:'image',name:'Model Ref 3',imageUrl:'https://res.cloudinary.com/x/image/upload/v1/d.jpg'},
      {id:'e',kind:'link', linkUrl:'https://y.test/2',linkTitle:'y.test'},
      {id:'f',kind:'cards',name:'Fabric · 2 cards',cards:[{id:'k',type:'column',title:'Fabric'}]}
    ]`;
    const boot=(items)=>run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      moodBoards=[{id:'b1',ownerUid:'u1',visibility:'shared',title:'T',cards:[]}];
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _editUnsorted=${items||ITEMS};_boardsTrayFilter='all';_boardsTrayOpen=true;`);

    s.section('every item lands in exactly one bucket');
    boot();
    s.eq('an image',run(`_boardsTrayKind(_editUnsorted[0])`),'image');
    s.eq('a link',run(`_boardsTrayKind(_editUnsorted[1])`),'link');
    s.eq('a file',run(`_boardsTrayKind(_editUnsorted[2])`),'file');
    s.eq('a stashed container',run(`_boardsTrayKind(_editUnsorted[5])`),'cards');
    // A stashed IMAGE card carries kind:'image' beside its `cards`, and it
    // is a picture — it belongs where somebody looking for one would go.
    s.eq('a stashed image card files under Images, not Cards',
      run(`_boardsTrayKind({kind:'image',imageUrl:'x',cards:[{id:'k',type:'image'}]})`),'image');
    s.eq('and something written before the kinds settled still buckets',
      run(`_boardsTrayKind({id:'z'})`),'text');

    s.section('the chips are derived from what is actually there');
    boot();
    s.eq('only the kinds present, with counts',
      run(`JSON.stringify(_boardsTrayCats().map(c=>c.k+':'+c.n))`),
      '["image:2","link:2","file:1","cards:1"]');
    s.ok('no chip for a category holding nothing',
      !JSON.parse(run(`JSON.stringify(_boardsTrayCats().map(c=>c.k))`)).includes('text'));
    const chips=run(`_boardsTrayCatsHTML()`);
    s.ok('All comes first and counts everything',/All<span[^>]*>6</.test(chips),chips.slice(0,120));
    s.ok('and the active one is marked',/board-tray-cat on[^"]*"[^>]*>All/.test(chips));
    // One kind of thing needs no way to narrow it.
    boot(`[{id:'a',kind:'image',imageUrl:'x'},{id:'b',kind:'image',imageUrl:'y'}]`);
    s.eq('one kind → no chip row at all',run(`_boardsTrayCatsHTML()`),'');

    /* ── THE INDEX IS THE WHOLE RISK ─────────────────────────────────────
       boardsTrayDragStart, boardsTrayRemove and _boardsTrayHydrate all
       address an item by its position in `_editUnsorted`. A filtered list
       that renumbered its rows would drag out, delete and label a
       DIFFERENT item than the one under the pointer — silently, and worse
       the more you filter. */
    s.section('a filtered row still points at its own item');
    boot();
    run(`_boardsTrayFilter='link'`);
    s.eq('two rows',run(`_boardsTrayRows().length`),2);
    s.eq('carrying their ORIGINAL indexes',
      run(`JSON.stringify(_boardsTrayRows().map(r=>r.i))`),'[1,4]');
    s.eq('which are the links',
      run(`JSON.stringify(_boardsTrayRows().map(r=>_editUnsorted[r.i].id))`),'["b","e"]');
    const html=run(`_boardsTrayListHTML(true)`);
    const idx=(html.match(/boardsTrayDragStart\(event,(\d+)\)/g)||[]).join(',');
    s.eq('and the markup hands those indexes to the drag',
      idx,'boardsTrayDragStart(event,1),boardsTrayDragStart(event,4)');
    s.ok('the remove button agrees',
      /boardsTrayRemove\(1\)/.test(html)&&/boardsTrayRemove\(4\)/.test(html));
    s.ok('the label ids agree too, so the hydrate fills the right rows',
      /board-tray-l-1"/.test(html)&&/board-tray-l-4"/.test(html));

    s.section('and the drag really brings out the item you grabbed');
    {
      const dr=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas'});
      const r=x=>dr.run(x);
      r(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
        moodBoards=[{id:'b1',ownerUid:'u1',visibility:'shared',title:'T',cards:[]}];
        _editCards=[];_editConnectors=[];_boardsSelection=new Set();
        _editUnsorted=${ITEMS};_boardsTrayFilter='link';_boardsTrayOpen=true;
        document.getElementById('board-stage').getBoundingClientRect=
          function(){return{left:0,top:0,right:1200,bottom:800};};`);
      // Row 0 of the FILTERED list is _editUnsorted[1] — the first link.
      const i=JSON.parse(r(`JSON.stringify(_boardsTrayRows().map(x=>x.i))`))[0];
      r(`(function(){
        const host=document.getElementById('tray-row');
        window.boardsTrayDragStart({currentTarget:host,clientX:0,clientY:0,pointerId:1,
          stopPropagation(){}},${i});})()`);
      const host=dr.run(`document.getElementById('tray-row')`);
      const ev=(x,y)=>({clientX:x,clientY:y,pointerId:1});
      dr.fire('tray-row','pointermove',ev(60,60));
      dr.fire('tray-row','pointerup',ev(400,300));
      s.eq('one card came out',r(`_editCards.length`),1);
      s.eq('and it is the link that was under the pointer',
        r(`(_editCards[0]||{}).linkUrl||'(none)'`),'https://x.test/1');
      s.eq('which left the tray',r(`_editUnsorted.length`),5);
      s.ok('the other link is untouched',r(`_editUnsorted.some(u=>u.id==='e')`));
    }

    /* Drag the last link out and the filter points at a category that no
       longer exists. A panel showing nothing, with no chip left to press,
       reads as broken. */
    s.section('a filter with nothing behind it heals itself');
    boot();
    run(`_boardsTrayFilter='link'`);
    s.eq('while the links are there it holds',run(`_boardsTrayFilterNow()`),'link');
    run(`_editUnsorted=_editUnsorted.filter(u=>u.kind!=='link')`);
    s.eq('once they are gone it reads as all',run(`_boardsTrayFilterNow()`),'all');
    s.eq('so every remaining item is still shown',run(`_boardsTrayRows().length`),4);
    s.eq('and nothing was written to make that true',run(`_boardsTrayFilter`),'link');

    /* There is deliberately NO "nothing in this category" screen. The heal
       above means a filter whose category has emptied simply IS "all", so
       an empty filtered list is unreachable while the tray holds anything
       — the first cut carried a branch for it and this assertion is what
       proved that branch was dead code. */
    s.section('so an empty filtered list cannot happen');
    boot();
    run(`_boardsTrayFilter='text'`);   // a category with nothing in it
    const none=run(`_boardsTrayListHTML(true)`);
    s.ok('it shows everything rather than an empty shelf',
      (none.match(/board-tray-item/g)||[]).length===6,
      (none.match(/board-tray-item/g)||[]).length+' rows');
    s.ok('and says nothing about categories',!/category/i.test(none));
    boot(`[]`);
    const bare=run(`_boardsTrayListHTML(true)`);
    s.ok('an empty tray explains what the tray is for',/Nothing here yet/.test(bare));
    s.ok('and that is the only empty screen there is',
      (bare.match(/board-tray-empty/g)||[]).length===1);
  }

  /* ── THE DRAG GHOST CARRIES THE ITEM'S OWN PICTURE (Sept 2026) ────────
     Afnan: *"now make the drag ghost show the actual image"*. It was a
     dark text chip, which said what KIND of thing was in flight but not
     WHICH one — two model references a word apart in name produced an
     identical chip — beside a tray whose whole point is that you know an
     item by its picture. */
  {
    const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
      currentPage:'board-canvas'});
    const {run}=app;
    const IMG='https://res.cloudinary.com/x/image/upload/v1/model.jpg';
    const ITEMS=`[
      {id:'a',kind:'image',name:'Model REF 1',imageUrl:'${IMG}'},
      {id:'b',kind:'link', linkUrl:'https://x.test/1',linkTitle:'x.test'},
      {id:'c',kind:'link', linkUrl:'https://y.test/2',linkTitle:'y.test',linkImage:'https://res.cloudinary.com/x/image/upload/v1/og.png'},
      {id:'d',kind:'file', fileName:'oil-wash.pdf',fileUrl:'https://res.cloudinary.com/x/image/upload/v1/o.pdf'},
      {id:'e',kind:'file', fileName:'notes.docx',fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/n.docx'},
      {id:'f',kind:'cards',name:'Fabric',cards:[{id:'k',type:'column',title:'Fabric'}]},
      {id:'g',kind:'text',text:'a loose thought'}
    ]`;
    const boot=()=>run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
      moodBoards=[{id:'b1',ownerUid:'u1',visibility:'shared',title:'T',cards:[]}];
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();
      _editUnsorted=${ITEMS};_boardsTrayFilter='all';_boardsTrayOpen=true;`);

    s.section('one decision about what picture stands for an item');
    boot();
    const face=i=>JSON.parse(run(`JSON.stringify(_boardsTrayFace(_editUnsorted[${i}])||{})`));
    s.ok('a photo is its own picture',!!face(0).src,JSON.stringify(face(0)));
    s.ok('and it is fetched with CORS, like every other board image',face(0).cors===true);
    s.eq('a link with no preview is a word',face(1).src||'(none)','(none)');
    s.eq('which says what it is',face(1).badge,'LINK');
    s.ok('a link WITH a preview is that picture',!!face(2).src,JSON.stringify(face(2)));
    s.ok('a PDF is its page-1 render',/\.(jpg|png)|f_/.test(face(3).src||''),face(3).src||'(none)');
    s.eq('and falls back to the extension',face(3).badge,'PDF');
    s.eq('a file that cannot be rasterised is just the extension',face(4).src||'(none)','(none)');
    s.eq('a stashed container says which type',face(5).badge,'COLUMN');
    s.eq('a note is a note',face(6).badge,'NOTE');
    // Every item has SOMETHING to show — a ghost with neither picture nor
    // word would fly as an empty box.
    s.ok('nothing is ever faceless',
      JSON.parse(run(`JSON.stringify(_editUnsorted.map(u=>!!(_boardsTrayFace(u).src||_boardsTrayFace(u).badge)))`))
        .every(Boolean));
    s.ok('and neither is a missing item',!!run(`(_boardsTrayFace(null)||{}).badge`));

    /* The anti-drift assertion, and the reason the helper exists at all:
       the ROW and the GHOST must resolve to the same url. They were two
       copies of the branch for about an hour. */
    s.section('the row draws exactly the picture the ghost will carry');
    boot();
    const rowHtml=run(`_boardsTrayListHTML(true)`);
    [0,2,3].forEach(i=>{
      const f=face(i);
      s.ok('item '+i+' — the row uses the face url',
        rowHtml.indexOf(f.src)>=0,f.src);
    });
    // Pinned to the 400 bucket on BOTH sides, so the ghost paints from
    // cache instead of flying blank while a second size downloads.
    s.eq('and it is the same bucket, not a second request',
      run(`_boardsTrayFace(_editUnsorted[0]).src`),
      run(`_boardsDisplayUrl(_editUnsorted[0].imageUrl,400)`));

    s.section('so the ghost really is the picture');
    boot();
    const ghostOf=(i)=>{
      run(`document.getElementById('board-stage').getBoundingClientRect=
        function(){return{left:0,top:0,right:1200,bottom:800};};`);
      run(`(function(){const h=document.getElementById('tray-row');
        window.boardsTrayDragStart({currentTarget:h,clientX:0,clientY:0,pointerId:1,
          stopPropagation(){}},${i});})()`);
      app.fire('tray-row','pointermove',{clientX:80,clientY:80,pointerId:1});
      return (app.state.body||[]).filter(n=>n&&n.className==='board-tray-ghost').pop();
    };
    const drop=()=>app.fire('tray-row','pointerup',{clientX:-500,clientY:-500,pointerId:1});

    const g0=ghostOf(0);
    s.ok('a ghost was built at all',!!g0);
    const pic0=g0&&(g0.children||[]).find(c=>c.className==='board-tray-ghost-pic');
    const img0=pic0&&(pic0.children||[]).find(c=>c.tagName==='IMG');
    s.ok('it holds a real <img>',!!img0,JSON.stringify((pic0||{}).children||[]));
    s.eq('carrying the face url',img0&&img0.src,run(`_boardsTrayFace(_editUnsorted[0]).src`));
    s.eq('with CORS set, so the export can still read it',img0&&img0.crossOrigin,'anonymous');
    s.ok('it is not draggable, or the native drag would fight the pointer one',
      img0&&img0.draggable===false);
    const lab0=g0&&(g0.children||[]).find(c=>c.className==='board-tray-ghost-label');
    s.eq('and it still says which one it is',lab0&&lab0.textContent,'Model REF 1');
    drop();

    // An item with no picture gets the word instead — never an empty box.
    const g5=ghostOf(5);
    const pic5=g5&&(g5.children||[]).find(c=>c.className==='board-tray-ghost-pic');
    s.ok('a stashed column carries no <img>',
      !!pic5&&!(pic5.children||[]).some(c=>c.tagName==='IMG'));
    const bad5=pic5&&(pic5.children||[]).find(c=>c.className==='board-tray-ghost-badge');
    s.eq('it carries its type word',bad5&&bad5.textContent,'COLUMN');
    drop();

    /* The label is somebody's filename or the first line of their note, so
       it is written with textContent — never interpolated. Asserted the
       only way a node harness can: the builder is handed a tag and the tag
       comes back as TEXT, not as markup. */
    s.section('a label is never markup');
    boot();
    run(`_editUnsorted[0].name='<img src=x onerror=alert(1)>'`);
    const gx=ghostOf(0);
    const labx=gx&&(gx.children||[]).find(c=>c.className==='board-tray-ghost-label');
    s.eq('the tag is the text',labx&&labx.textContent,'<img src=x onerror=alert(1)>');
    s.ok('and nothing was parsed out of it',
      !labx||!(labx.children||[]).length);
    drop();

    s.section('and the ghost leaves when the drag does');
    boot();
    ghostOf(0);
    const before=(app.state.body||[]).filter(n=>n&&n.className==='board-tray-ghost').length;
    drop();
    const after=(app.state.body||[]).filter(n=>n&&n.className==='board-tray-ghost').length;
    s.ok('one ghost while dragging',before>=1,'before='+before);
    s.ok('and none left behind after the drop',after===0,'after='+after);
  }

  // ── a PDF card is sized to its page ─────────────────────────────────────
  // At the 200×110 file default the name row and the Open/Download buttons
  // left the page thumbnail a ~20px strip. Reported with a screenshot of a
  // production brief that had to be dragged open by hand.
  {
    const app=loadApp({files:FILES,globals:{requestAnimationFrame:()=>0}});
    const {run}=app;
    const IMG='https://res.cloudinary.com/x/image/upload/v1/brief.pdf';
    const RAW='https://res.cloudinary.com/x/raw/upload/v1/brief.pdf';
    const boot=()=>run(`_editBoard={id:'b1',zoom:1,panX:0,panY:0,visibility:'shared',ownerUid:'u1',title:'T'};
      _editCards=[];_editConnectors=[];_editUnsorted=[];_boardsSelection=new Set();
      _boardsSaveDebounced=()=>{};_boardsRenderCanvasAndWire=()=>{};
      __uploads=[];
      _boardsUploadAny=f=>new Promise((ok,bad)=>__uploads.push({f,ok,bad}));`);
    const pdf=`{name:'Denim Production Brief GROOVY.pdf',type:'application/pdf',size:1153433}`;
    const size=id=>run(`(c=>c.w+'x'+c.h)(_editCards.find(c=>c.id==='${id}'))`);
    const tick=()=>new Promise(r=>setImmediate(r));
    const A4=`${240}x${Math.round(238*Math.SQRT2)+run(`_BOARDS_FILE_CHROME_H`)}`;

    /* ── The phone round (Sept 2026 audit) ──────────────────────────────
       Every one of these came out of measuring the composed phone canvas in
       headless Chromium (tests/smoke-phone.js holds the geometry); what is
       asserted HERE is the logic behind each fix. */
    s.section('phone: the rail is six targets and More');
    {
      const ph=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas',phone:true});
      const r=x=>ph.run(x);
      r(`_editBoard={id:'X',title:'B',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
         _editCards=[];_editConnectors=[];_boardsSelection=new Set();_editUnsorted=[];
         _boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;moodBoards=[];`);
      s.eq('the add-mode bar',r(`_boardsRailItems().map(i=>i.act).join(',')`),
        'add:text,imagepanel,file,add:board,more-tools,trash');
      // More lists every add-tool the bar does not carry — nothing is lost,
      // and nothing is listed twice.
      const over=JSON.parse(r(`JSON.stringify(_boardsRailPhoneOverflow().map(i=>i.act))`));
      const bar=JSON.parse(r(`JSON.stringify(_BOARDS_RAIL_PHONE.map(i=>i.act))`));
      const allAdd=JSON.parse(r(`JSON.stringify(_BOARDS_RAIL_MAIN.concat(_BOARDS_RAIL_OVERFLOW,_BOARDS_RAIL_MEDIA).map(i=>i.act))`));
      s.ok('More holds every tool the bar left off',allAdd.every(a=>bar.includes(a)||over.includes(a)),
        allAdd.filter(a=>!bar.includes(a)&&!over.includes(a)).join(','));
      s.ok('and none of the ones on the bar',!over.some(a=>bar.includes(a)));
      s.ok('and the board-level actions',over.includes('comment-board')&&over.includes('fit'));
      s.eq('nothing appears twice',new Set(over).size,over.length);
      // Desktop is untouched: the full grouped column.
      const dt=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},currentPage:'board-canvas'});
      dt.run(`_editBoard={id:'X',title:'B',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};
         _editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;`);
      const dacts=JSON.parse(dt.run(`JSON.stringify(_boardsRailItems().filter(i=>i.act).map(i=>i.act))`));
      s.ok('the desktop rail still carries Line and Column inline',
        dacts.includes('line')&&dacts.includes('add:column'));
      s.ok('and Comment is on the phone sheet even though it left the desktop rail',
        over.includes('comment-board')&&!dacts.includes('comment-board'));

      s.section('phone: the top bar is one row and the ⋯ sheet holds the rest');
      ph.run(`window.openBugReportModal=function(){};`);
      const html=r(`_renderBoardCanvasHTML()`);
      const topbar=html.slice(html.indexOf('class="board-topbar"'),html.indexOf('id="board-view-menu"'));
      s.ok('no Undo button in the bar',!/id="board-undo-btn"/.test(topbar));
      s.ok('no Find button in the bar',!/boardsToggleFind\(\)"[^>]*>Find</.test(topbar));
      s.ok('no Comments button in the bar',!/id="board-cmt-btn"/.test(topbar));
      s.ok('no visibility pill in the bar',!/class="pill">PRIVATE/.test(topbar));
      const menu=html.slice(html.indexOf('id="board-menu"'));   // the ⋯ sheet is the last thing in the bar
      s.ok('Undo keeps its id inside the sheet (so _boardsSyncHistoryButtons still finds it)',/id="board-undo-btn"/.test(menu));
      s.ok('Redo too',/id="board-redo-btn"/.test(menu));
      s.ok('Find is in the sheet',/boardsToggleFind/.test(menu));
      s.ok('Comments is in the sheet, id intact',/id="board-cmt-btn"/.test(menu));
      s.ok('Report a bug is in the sheet (the FAB is hidden on a phone)',/openBugReportModal/.test(menu));
      s.eq('the Undo id appears exactly once in the whole render',(html.match(/id="board-undo-btn"/g)||[]).length,1);
      const dhtml=dt.run(`_renderBoardCanvasHTML()`);
      const dbar=dhtml.slice(dhtml.indexOf('class="board-topbar"'),dhtml.indexOf('id="board-view-menu"'));
      s.ok('desktop keeps Undo in the bar',/id="board-undo-btn"/.test(dbar));
      s.ok('and no Report a bug in its menu',!/openBugReportModal/.test(dhtml));

      s.section('phone: the empty hint says what a finger can do');
      s.ok('double-tap, not double-click',/Double-tap anywhere/.test(html));
      s.ok('no Ctrl+V, no Space, no drop',!/Ctrl\+V|hold Space|drop files/.test(html));
      s.ok('the desktop hint is unchanged',/Double-click anywhere/.test(dhtml)&&/Ctrl\+V/.test(dhtml));

      s.section('phone: a card drag starts after 4px');
      r(`_editCards=[{id:'n1',type:'text',text:'',x:40,y:60,w:170,h:100}];_boardsUndo=[];_boardsRedo=[];_boardsSelection=new Set();_boardsSuppressClick=false;`);
      // The gesture tracks on the DOCUMENT now: the drag does not capture
      // the pointer until it has passed the threshold, so before that the
      // pressed element stops seeing it the moment it leaves.
      const drag=(x,y)=>{
        r(`(function(){
          const head=document.getElementById('drag-head');
          window.boardsCardDragStart({currentTarget:head,target:head,clientX:0,clientY:0,pointerId:1,
            stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false},'n1');})()`);
        const ev=t=>({type:t,clientX:x,clientY:y,pointerId:1,altKey:false,shiftKey:false});
        (ph.state.listeners.pointermove||[]).slice().forEach(f=>f(ev('pointermove')));
        (ph.state.listeners.pointerup||[]).slice().forEach(f=>f(ev('pointerup')));
        return true;
      };
      drag(2,3);
      s.eq('a 2-3px roll pushes no undo entry',r(`_boardsUndo.length`),0);
      s.eq('and moves nothing',r(`_editCards[0].x+','+_editCards[0].y`),'40,60');
      s.ok('and does not swallow the click',!JSON.parse(r(`_boardsSuppressClick`)));
      drag(9,0);
      s.eq('9px is a drag: one undo entry',r(`_boardsUndo.length`),1);
      s.eq('and the card moved',r(`_editCards[0].x`),49);

      s.section('phone: the keyboard resize does not pan the board');
      r(`_boardsWasPhone=null;_boardsViewRect={w:390,h:700};_editBoard.panX=0;_editBoard.panY=0;
         document.getElementById('board-stage').getBoundingClientRect=function(){return{width:390,height:400,left:0,top:0};};
         _boardsEditingEl={contains(){return false;}};`);
      r(`_boardsOnViewportChange()`);
      s.eq('while a card is being edited the pan is left alone',r(`_editBoard.panY`),0);
      s.eq('and the remembered view rect too, so the closing resize sees no delta',r(`_boardsViewRect.h`),700);
      r(`_boardsEditingEl=null;document.getElementById('board-stage').getBoundingClientRect=function(){return{width:390,height:700,left:0,top:0};};`);
      r(`_boardsOnViewportChange()`);
      s.eq('the keyboard closing after the edit ended is a no-op',r(`_editBoard.panY`),0);
      r(`document.getElementById('board-stage').getBoundingClientRect=function(){return{width:390,height:400,left:0,top:0};};`);
      r(`_boardsOnViewportChange()`);
      s.eq('a real resize with nothing being edited still recentres',r(`_editBoard.panY`),-150);

      s.section('phone: two taps on an [ondblclick] element are a double-click');
      // The document listeners _boardsWireTouch registered at load are
      // driven from here with plain objects; `target` answers closest()
      // the way a card body inside the stage would.
      const MouseEv=function(type,init){this.type=type;Object.assign(this,init||{});this.isTrusted=false;};
      const tap=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
        currentPage:'board-canvas',phone:true,globals:{MouseEvent:MouseEv}});
      tap.run(`_editBoard={id:'X',title:'B',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};_editCards=[];_editConnectors=[];`);
      const stage={id:'board-stage'};
      const fired=[];
      const el={id:'body-el',dispatchEvent(ev){fired.push(ev.type+'@'+ev.clientX+','+ev.clientY);}};
      const target={closest(sel){if(/board-stage/.test(sel))return stage;if(sel==='[ondblclick]')return el;return null;},dispatchEvent(ev){fired.push(ev.type+'@'+ev.clientX+','+ev.clientY);}};
      const ls=tap.state.listeners;
      s.ok('the touch tracker is wired at load',!!(ls.pointerdown&&ls.pointerup&&ls.dblclick&&ls.contextmenu),Object.keys(ls).join(','));
      const touch=(type,x,y,pointerType)=>{
        const ev={type,pointerType:pointerType||'touch',pointerId:7,clientX:x,clientY:y,target,stopPropagation(){this._s=true;},preventDefault(){this._p=true;}};
        (ls[type]||[]).forEach(fn=>fn(ev));return ev;
      };
      touch('pointerdown',100,100);touch('pointerup',100,100);
      s.eq('one tap fires nothing',fired.length,0);
      touch('pointerdown',104,102);touch('pointerup',104,102);
      s.eq('the second tap within 300ms fires a dblclick at the tap point',fired.join('|'),'dblclick@104,102');
      // A browser that synthesizes its own dblclick right after ours is
      // dropped at the capture phase, so an inline handler never runs twice.
      const dup={type:'dblclick',isTrusted:true,stopPropagation(){this._s=true;},preventDefault(){this._p=true;}};
      ls.dblclick.forEach(fn=>fn(dup));
      s.ok('a trusted dblclick within the window is swallowed',!!(dup._s&&dup._p));
      // A tap that MOVED is not a tap.
      fired.length=0;
      touch('pointerdown',100,100);touch('pointermove',130,100);touch('pointerup',130,100);
      touch('pointerdown',130,100);touch('pointerup',130,100);
      s.eq('a drag then a tap is not a pair',fired.length,0);
      // A mouse never goes through this path.
      fired.length=0;
      touch('pointerdown',1,1,'mouse');touch('pointerup',1,1,'mouse');
      touch('pointerdown',1,1,'mouse');touch('pointerup',1,1,'mouse');
      s.eq('mouse taps are ignored',fired.length,0);

      _pending.push((async()=>{
        // The long-press, driven against the real timer.
        const hp=loadApp({files:['js/boards.js'],session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'},
          currentPage:'board-canvas',phone:true,globals:{MouseEvent:MouseEv}});
        hp.run(`_editBoard={id:'X',title:'B',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};_editCards=[];_editConnectors=[];`);
        const hls=hp.state.listeners;
        const got=[];
        const tgt={closest(sel){return /board-stage/.test(sel)?stage:null;},dispatchEvent(ev){got.push(ev.type);}};
        const t=(type,x,y)=>{const ev={type,pointerType:'touch',pointerId:3,clientX:x,clientY:y,target:tgt,stopPropagation(){},preventDefault(){}};(hls[type]||[]).forEach(fn=>fn(ev));};
        const wait=ms=>new Promise(res=>setTimeout(res,ms));
        t('pointerdown',50,50);await wait(560);
        const held=got.join('|');
        t('pointerup',50,50);
        const afterUp=got.join('|');
        got.length=0;
        t('pointerdown',50,50);await wait(120);t('pointerup',50,50);await wait(500);
        const early=got.join('|');
        got.length=0;
        t('pointerdown',50,50);await wait(120);t('pointermove',80,50);await wait(500);t('pointerup',80,50);
        const moved=got.join('|');
        got.length=0;
        t('pointerdown',50,50);await wait(100);
        const nat={type:'contextmenu',isTrusted:true,stopPropagation(){this._s=true;},preventDefault(){this._p=true;}};
        hls.contextmenu.forEach(fn=>fn(nat));
        await wait(560);t('pointerup',50,50);
        const native=got.join('|');

        s.section('phone: a long-press is the right-click');
        s.eq('held still for 500ms → contextmenu at the press point',held,'contextmenu');
        s.eq('and the release after a hold is not a tap',afterUp,'contextmenu');
        s.eq('released early → nothing',early,'');
        s.eq('moved during the hold → nothing',moved,'');
        s.eq('a native long-press arriving first cancels ours',native,'');
        s.ok('and that native one was let through (nothing of ours had fired)',!nat._s);
      })());
    }

    // ── The rail's Note round (Sept 2026): "Drag me", the note ghost, the
    // text rail, the Text style menu, and the Home trail. Read off Afnan's
    // video of Milanote frame by frame; see CLAUDE.md.
    {
      const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const r=app.run;
      r(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:0.5,panX:0,panY:0};
         _editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;`);
      s.section('"Drag me" is offered only by a drag source');
      s.eq('a tool that places nothing gets no tip',r(`_boardsRailTipShow({getAttribute:()=>'0'})`),false);
      s.eq('a drag source gets one',r(`_boardsRailTipShow({getAttribute:()=>'1',getBoundingClientRect:()=>({right:80,top:100,bottom:140}),querySelector:()=>null})`),true);
      s.eq('placed beside the button, on the icon\'s centre line',r(`_boardsRailTipEl.style.left+' '+_boardsRailTipEl.style.top`),'88px 120px');
      s.eq('and it says what Milanote\'s says',r(`_boardsRailTipEl.textContent`),'Drag me');
      r(`_boardsRailTipHide()`);
      s.eq('hide drops it',r(`_boardsRailTipEl`),null);
      s.eq('and nothing is shown mid-drag',r(`(_boardsRailDrag={act:'add:text'},_boardsRailTipShow({getAttribute:()=>'1'}))`),false);
      r(`_boardsRailDrag=null`);

      s.section('a Note is carried as the card it becomes, at the board\'s zoom');
      r(`_boardsRailGhostShow({act:'add:text',label:'Note'})`);
      const g=r(`(function(){var g=document.getElementById('board-rail-ghost');return {cls:g.className,w:g.style.width,h:g.style.height,fs:g.style.fontSize,kids:g.children.length}})()`);
      s.eq('a note ghost',g.cls,'board-rail-ghost note');
      s.eq('220 wide at 50% zoom',g.w,'110px');
      s.eq('100 tall at 50% zoom',g.h,'50px');
      s.ok('with a placeholder inside',g.kids===1);
      r(`_boardsRailGhostHide();_boardsRailGhostShow({act:'add:link',label:'Link'})`);
      s.eq('any other tool keeps the chip',r(`document.getElementById('board-rail-ghost').className`),'board-rail-ghost');
      r(`_boardsRailGhostHide()`);
      s.eq('the ghost reads the same birth size _boardsNewCard mints',r(`_boardsNewCard('text').w+'x'+_boardsNewCard('text').h`),'220x100');

      s.section('a note in edit mode is the rail\'s fifth mode');
      r(`_boardsEditingEl={isContentEditable:true,id:'board-txt-c1',closest:()=>null}`);
      s.ok('active while a note body holds the caret',r(`_boardsFmtActive()`));
      const acts=r(`_boardsRailItems().map(it=>it.act||(it.sep?'|':it.fmtSwatches?'colours':it.fmtHilite?'highlights':'?')).join(',')`);
      s.eq('back · Text style · B I S U · bullets · numbers · colours · highlights',acts,
        'fmt:done,fmt:style,fmt:bold,fmt:italic,fmt:strikeThrough,fmt:underline,fmt:insertUnorderedList,fmt:insertOrderedList,|,colours,highlights');
      r(`_boardsRenderRail()`);
      s.eq('and the rail records that mode',r(`document.getElementById('board-rail').dataset.mode`),'text');
      r(`_boardsEditingEl={isContentEditable:true,id:'board-td-c1-0-0',closest:()=>null}`);
      s.ok('a table cell is not a note',!r(`_boardsFmtActive()`));
      r(`_boardsEditingEl=null`);
      const phone=loadApp({files:FILES,phone:true,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      phone.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0};_editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
        _boardsEditingEl={isContentEditable:true,id:'board-txt-c1',closest:()=>null}`);
      s.ok('a phone keeps its floating bar instead',!phone.run(`_boardsFmtActive()`));

      s.section('every formatting action goes through one implementation');
      r(`__cmds=[];document.execCommand=(c,u,v)=>{__cmds.push(c+':'+v);return true};_boardsFmtTarget={focus(){},dispatchEvent(){}}`);
      r(`_boardsCtxRun('fmt:bold')`);
      s.eq('bold: styleWithCSS off, then the command',r(`__cmds.join(' ')`),'styleWithCSS:false bold:null');
      r(`__cmds=[];_boardsCtxRun('fmt:hilite:#FDE68A')`);
      s.eq('highlight: styleWithCSS on, then hiliteColor',r(`__cmds.join(' ')`),'styleWithCSS:true hiliteColor:#FDE68A');
      r(`__cmds=[];_boardsCtxRun('fmt:block:h2')`);
      s.eq('a Text style pick is a formatBlock',r(`__cmds.join(' ')`),'styleWithCSS:false formatBlock:<h2>');
      r(`__cmds=[];_boardsCtxRun('fmt:color:#7B1F2A')`);
      s.eq('a text colour is foreColor with CSS on',r(`__cmds.join(' ')`),'styleWithCSS:true foreColor:#7B1F2A');
      s.eq('the Text style menu offers Milanote\'s blocks',r(`_BOARDS_FMT_BLOCKS.map(b=>b.label).join(' · ')`),
        'Large heading · Normal heading · Normal text · Small text · Code block · Quote block');

      s.section('the sanitiser keeps the blocks the menu writes, and only those');
      s.eq('every heading level folds onto the three drawn',
        r(`_boardsSanitizeRich('<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>')`),
        '<h2>a</h2><h2>b</h2><h3>c</h3><h3>d</h3><h6>e</h6><h6>f</h6>');
      s.eq('code and quote survive',r(`_boardsSanitizeRich('<pre>x</pre><blockquote>q</blockquote>')`),'<pre>x</pre><blockquote>q</blockquote>');
      s.eq('a highlight from the list survives',r(`_boardsSanitizeRich('<span style="background-color:#FDE68A">h</span>')`),'<span style="background-color:#FDE68A">h</span>');
      s.eq('as rgb, the way execCommand writes it',r(`_boardsSanitizeRich('<span style="background-color: rgb(253, 230, 138)">h</span>')`),'<span style="background-color:#FDE68A">h</span>');
      s.eq('a highlight the menu never offered is dropped',r(`_boardsSanitizeRich('<span style="background-color:#ff0000">h</span>')`),'<span>h</span>');
      s.eq('colour and highlight together',r(`_boardsSanitizeRich('<span style="color:#7B1F2A;background-color:#BBF7D0">h</span>')`),'<span style="color:#7B1F2A;background-color:#BBF7D0">h</span>');
      s.eq('a colour alone carries no stray semicolon',r(`_boardsSanitizeRich('<span style="color:#7B1F2A">h</span>')`),'<span style="color:#7B1F2A">h</span>');

      s.section('the top bar is a trail: chip, Home, slash, tile, name');
      r(`_boardsCameFromAll=false;_editBoard={id:'b1',title:'Winter',ownerUid:'u1',visibility:'personal',zoom:1,panX:0,panY:0,color:'#7C3AED'}`);
      const bar=r(`_renderBoardCanvasHTML()`);
      s.ok('the chip carries the app icon and goes Home',/board-home-chip[^>]*boardsGotoGallery[^>]*>\s*<img src="\/assets\/icons\/icon-192\.png"/.test(bar));
      s.ok('Home, then a slash, then the board\'s tile',/board-crumb-home[^>]*>Home<\/button>[\s\S]*board-crumb-slash">\/<\/span><span class="board-tile"[^>]*background:#7C3AED/.test(bar));
      r(`_boardsCameFromAll=true`);
      s.ok('opened from All boards, that is a crumb too',/board-crumb-slash">\/<\/span><button class="board-crumb" onclick="window\.boardsShowAll\(\)">All boards<\/button>/.test(r(`_renderBoardCanvasHTML()`)));
      r(`_boardsCameFromAll=false`);
      const ph=phone.run(`_renderBoardCanvasHTML()`);
      s.ok('a phone keeps its capped back button and no chip',/back-btn/.test(ph)&&!/board-home-chip/.test(ph));
    }

    // ── Colour: Background beside the Top strip, the rail's Color tile,
    // and Convert to Document (Sept 2026). See CLAUDE.md.
    {
      const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      const r=app.run;
      r(`_editBoard={id:'b1',title:'Winter',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
         _editCards=[Object.assign(_boardsNewCard('text'),{id:'n1',text:'Fabric plan\\nOrder the rib.\\n\\nCheck the dye lot.'}),Object.assign(_boardsNewCard('text'),{id:'n2',text:'b'})];
         _editConnectors=[];_boardsSelection=new Set(['n1']);_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;_boardsUndo=[];`);
      s.section('a card has a Background beside its Top strip');
      r(`window.boardsSetBg('green')`);
      s.eq('bg is a palette name on the card',r(`_editCards[0].bg`),'green');
      s.eq('and the strip is untouched',r(`_editCards[0].color`),undefined);
      r(`window.boardsSetColor('red')`);
      s.ok('the card paints both as classes',/class="board-card-el type-text[^"]* tint-red bg-green"/.test(r(`_boardCardHTML(_editCards[0],true)`)));
      r(`window.boardsSetBg('none')`);
      s.eq('none clears it rather than storing "none"',r(`'bg' in _editCards[0]`),false);
      s.eq('each change was undoable',r(`_boardsUndo.length`),3);

      s.section('the rail\'s Color tile reads the card\'s current colour');
      s.eq('strip only → the strip colour',r(`_boardsColorTileClass([{color:'red'}])`),'sw-red');
      s.eq('background wins over the strip',r(`_boardsColorTileClass([{color:'red',bg:'blue'}])`),'bg-blue');
      s.eq('neither → an empty outline',r(`_boardsColorTileClass([{}])`),'none');
      s.eq('a name off the palette is not painted',r(`_boardsColorTileClass([{bg:'evil'}])`),'none');
      const acts=r(`_boardsRailItems().map(it=>it.act||(it.sep?'|':'?')).join(',')`);
      s.ok('the selection rail carries the tile, not the inline grid',/^deselect,color-panel,labels,reactions,card-comment/.test(acts)&&!/\?/.test(acts.replace(/\|/g,'')));
      r(`_boardsRenderRail()`);
      s.ok('and draws it with the current colour',/rail-color-tile sw-red/.test(r(`document.getElementById('board-rail').innerHTML`)));

      s.section('the colour panel: two tabs, live');
      let items=r(`_boardsColorPanelItems()`);
      s.eq('Background first',items[0].tabs.map(t=>t.label+(t.on?'*':'')).join(' | '),'Background* | Top strip');
      s.ok('the Background tab shows bg swatches marking the current',items[1].bgSwatches===true&&items[1].current==='none');
      r(`_boardsCtxRun('colortab:strip')`);
      items=r(`_boardsColorPanelItems()`);
      s.ok('Top strip shows the strip swatches marking red',items[1].swatches===true&&items[1].current==='red');
      const html=r(`_boardsCtxHTML(_boardsColorPanelItems())`);
      s.ok('tabs render as buttons routed through the menu',/board-ctx-tab on" data-act="colortab:strip"/.test(html));
      s.ok('the current swatch is marked',/board-swatch sw-red on" data-act="color:red"/.test(html));
      r(`_boardsCtxRun('bg:purple')`);
      s.eq('bg: routes to the setter',r(`_editCards[0].bg`),'purple');

      s.section('Convert to Document');
      s.eq('a document from a note: first line is the title',r(`_boardsDocFromNote(_editCards[0]).title`),'Fabric plan');
      s.eq('paragraphs split on blank lines',r(`_boardsDocFromNote(_editCards[0]).blocks.map(b=>b.type+':'+b.text).join('|')`),'paragraph:Order the rib.|paragraph:Check the dye lot.');
      s.eq('an empty note still gets one empty paragraph',r(`_boardsDocFromNote({text:''}).blocks.length`),1);
      r(`__c=0;confirm=()=>{__c++;return true};location={origin:'https://ops.example',pathname:'/',hash:''}`);
      const menu=r(`_boardsCardCtxItems(true).map(i=>i.act).join(',')`);
      s.ok('it is on the note\'s menu',/todoc/.test(menu));
      const before=app.state.writes.length;
      const p=r(`window.boardsConvertToDocument()`);
      s.ok('it returns a promise',!!p&&typeof p.then==='function');
      _pending.push(p.then(()=>{
        const w=app.state.writes.slice(before).find(x=>x.op==='add');
        s.section('Convert to Document (after the write)');
        s.eq('one confirm asked',r(`__c`),1);
        s.ok('a notes_pages doc was written',!!w);
        s.eq('titled from the note, visibility from the board',w&&(w.data.title+' · '+w.data.visibility),'Fabric plan · shared');
        s.eq('with the paragraphs',w&&w.data.blocks.length,2);
        const c=r(`_editCards[0]`);
        s.eq('the card is a link now',c.type,'link');
        s.eq('to the document\'s deep link',c.linkUrl,'https://ops.example/#note=new');
        s.eq('titled like the page',c.linkTitle,'Fabric plan');
        s.ok('and the note text is gone from it',!('text' in c));
        s.eq('undo restores the note',(r(`window.boardsUndoAction();_editCards[0].type+':'+_editCards[0].text.slice(0,11)`)),'text:Fabric plan');
      }));

      s.section('#note= is a deep link to the page');
      r(`location={origin:'https://ops.example',pathname:'/',hash:'#note=abc'}`);
      s.eq('parsed',JSON.stringify(r(`_boardsParseHash()`)),'{"note":"abc"}');
      r(`location.hash='#board=b9&card=c1'`);
      s.eq('a board link is unchanged',JSON.stringify(r(`_boardsParseHash()`)),'{"board":"b9","card":"c1"}');
    }

    // ── Labels, Reactions and Comments as Milanote's panels (Sept 2026).
    {
      const app=loadApp({files:FILES,session:{u:'afnan',name:'Afnan Bhatti',role:'owner',uid:'u1'}});
      const r=app.run;
      r(`_editBoard={id:'b1',title:'Winter',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};
         _editCards=[Object.assign(_boardsNewCard('text'),{id:'n1',text:'a',labels:[{t:'Ready for printing',c:'green'}],reactions:{'🔥':['u1','u2'],'👀':['u1']}}),
                     Object.assign(_boardsNewCard('text'),{id:'n2',text:'b',labels:[{t:'Pattern done',c:'blue'},{t:'Ready for printing',c:'green'}],reactions:{'🔥':['u3']}})];
         _editConnectors=[];_boardsSelection=new Set(['n1']);_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;_boardsUndo=[];`);
      s.section('the label panel: one field searches and creates, the board\'s list ticks');
      let d=r(`_boardsLabelRowsFor('n1','')`);
      s.eq('the whole library, most used first',d.rows.map(l=>l.t+(l.on?'*':'')).join(' | '),'Ready for printing* | Pattern done');
      s.ok('nothing to create with an empty field',!d.create);
      d=r(`_boardsLabelRowsFor('n1','pattern')`);
      s.eq('typing filters',d.rows.map(l=>l.t).join(),'Pattern done');
      s.ok('a partial match still offers to create the typed name',d.create&&!d.exact);
      d=r(`_boardsLabelRowsFor('n1','pattern done')`);
      s.ok('an exact match (any case) offers no twin',d.exact&&!d.create);
      d=r(`_boardsLabelRowsFor('n1','see this')`);
      s.ok('no results, and a create offer',d.rows.length===0&&d.create);
      r(`window.boardsLabelToggle=window.boardsLabelToggle;_boardsLabelRows=_boardsLabelRowsFor('n1','').rows;document.getElementById('board-label-input').value='';window.boardsLabelToggle('n1',1)`);
      s.eq('ticking a row puts that label on the card',r(`_editCards[0].labels.map(l=>l.t).join(',')`),'Ready for printing,Pattern done');
      r(`_boardsLabelRows=_boardsLabelRowsFor('n1','').rows;window.boardsLabelToggle('n1',0)`);
      s.eq('unticking takes it off',r(`_editCards[0].labels.map(l=>l.t).join(',')`),'Pattern done');

      s.section('the reaction picker: categories, frequently used is derived');
      s.eq('frequently used counts the board\'s reactions, most first',r(`_boardsFrequentEmoji().slice(0,2).join('')`),'🔥👀');
      r(`_editCards.forEach(c=>delete c.reactions)`);
      s.eq('with none on the board it falls back to the curated set',r(`_boardsFrequentEmoji().length`),14);
      s.ok('the categories are Milanote\'s, in order',r(`_BOARDS_EMOJI_CATS.map(c=>c.n).join('·')`)==='Smileys & Emotions·People & Body·Animals & Nature·Food & Drink·Travel & Places·Activities·Objects·Symbols·Flags');
      s.ok('every entry carries a keyword',r(`_BOARDS_EMOJI_CATS.every(c=>c.e.every(x=>x.e&&x.k))`));
      s.eq('search by keyword',r(`_boardsEmojiSearch('tshirt')[0]`),'👕');
      s.eq('search by the emoji itself',r(`_boardsEmojiSearch('👖')[0]`),'👖');
      s.eq('no duplicates across the catalogue and the curated list',r(`(function(){const a=_boardsEmojiSearch('heart');return a.length===new Set(a).size})()`),true);
      s.eq('an empty search matches nothing',r(`_boardsEmojiSearch('').length`),0);

      s.section('comments: a thread with replies, avatars, and the popover');
      const th=r(`_boardsThread([{id:'c2',ts:2,text:'b'},{id:'r1',ts:3,replyTo:'c1',text:'r'},{id:'c1',ts:1,text:'a'},{id:'orphan',ts:4,replyTo:'gone',text:'o'}]).map(c=>c.id+':'+c.depth).join(' ')`);
      s.eq('parents in time order, each followed by its replies; an orphaned reply is kept',th,'c1:0 r1:1 c2:0 orphan:0');
      s.eq('initials from first and last name',r(`_boardsInitials('Afnan Bhatti')`),'AB');
      s.eq('one name → two letters',r(`_boardsInitials('daniyal')`),'DA');
      s.ok('the avatar colour is a token, never a literal',/style="background:var\(--[a-z-]+\)"/.test(r(`_boardsAvatarHTML('Afnan Bhatti')`)));
      s.eq('the same name always gets the same colour',r(`_boardsAvatarHTML('Sami')===_boardsAvatarHTML('Sami')`),true);
      r(`window.innerWidth=1400;window.innerHeight=900`);
      r(`_boardsOpenSheet('T','<b>x</b>',{anchor:{rect:{left:300,right:420,top:200,bottom:260}},width:320})`);
      const pop=r(`(function(){var e=document.getElementById('board-sheet');return {cls:e.className,left:e.style.left,top:e.style.top,w:e.style.width}})()`);
      s.eq('an anchored sheet is a popover beside its anchor',pop.cls+' '+pop.left+' '+pop.top+' '+pop.w,'board-sheet board-pop 434px 194px 320px');
      r(`_boardsOpenSheet('T','x',{anchor:{rect:{left:1200,right:1300,top:200,bottom:260}},width:320})`);
      s.ok('and flips to the left when there is no room on the right',r(`document.getElementById('board-sheet').classList.contains('tail-right')`)&&r(`document.getElementById('board-sheet').style.left`)==='866px');
      r(`_boardsOpenSheet('T','x')`);
      s.eq('no anchor → the bottom sheet, as before',r(`document.getElementById('board-sheet').className`),'board-sheet');
      const phone=loadApp({files:FILES,phone:true,session:{u:'afnan',name:'Afnan',role:'owner',uid:'u1'}});
      phone.run(`_editBoard={id:'b1',title:'T',ownerUid:'u1',visibility:'shared',zoom:1,panX:0,panY:0};_editCards=[];_boardsOpenSheet('T','x',{anchor:{rect:{left:0,right:10,top:0,bottom:10}}})`);
      s.eq('a phone ignores the anchor and keeps the sheet',phone.run(`document.getElementById('board-sheet').className`),'board-sheet');
      r(`_boardsComments=[{id:'c1',cardId:'n1',ts:1,text:'follow this',byName:'Afnan Bhatti',byUid:'u1'}];window.boardsOpenComments('n1')`);
      s.eq('Comment on a card opens the popover on desktop',r(`_boardsCommentPopCard`),'n1');
      s.ok('it holds the thread and a Send box',/board-cpop-row/.test(r(`document.getElementById('board-sheet').innerHTML`))&&/Write a comment/.test(r(`document.getElementById('board-sheet').innerHTML`)));
      r(`window.boardsReplyTo('c1')`);
      s.ok('Reply switches the box to a reply',/Write a reply/.test(r(`document.getElementById('board-sheet').innerHTML`)));
      const before=app.state.writes.length;
      r(`document.getElementById('board-cmt-input').value='abc'`);
      _pending.push(r(`window.boardsAddComment()`).then(()=>{
        const w=app.state.writes.slice(before).find(x=>x.op==='add');
        s.section('comments (after the write)');
        s.eq('a reply carries replyTo and the card',w&&(w.data.replyTo+' '+w.data.cardId+' '+w.data.text),'c1 n1 abc');
        s.eq('and the reply state is cleared',r(`_boardsReplyTo`),null);
      }));
      r(`window.boardsCloseSheet()`);
      s.eq('closing forgets the card',r(`_boardsCommentPopCard`),null);
      phone.run(`_editCards=[Object.assign(_boardsNewCard('text'),{id:'n1'})];_boardsComments=[];window.boardsOpenComments('n1')`);
      s.ok('a phone opens the drawer instead',phone.run(`_boardsDrawerOpen===true&&_boardsCommentPopCard===null`));
    }

    return Promise.all(_pending.concat([(async()=>{
      boot();
      s.section('the page-size maths');
      s.eq('no size reported → A4 portrait',run(`_boardsPdfCardH()`),Math.round(238*Math.SQRT2)+run(`_BOARDS_FILE_CHROME_H`));
      s.eq('US Letter (612×792)',run(`_boardsPdfCardH(792/612)`),Math.round(238*792/612)+run(`_BOARDS_FILE_CHROME_H`));
      s.eq('garbage ratio falls back to A4',run(`_boardsPdfCardH(NaN)`),run(`_boardsPdfCardH()`));
      s.eq('a sliver page is clamped, not a 4000px card',run(`_boardsPdfCardH(1000)`),238*4+run(`_BOARDS_FILE_CHROME_H`));
      s.ok('a PDF is recognised by type',run(`_boardsIsPdfFile({type:'application/pdf',name:'x'})`));
      s.ok('or by name when the browser gives no type',run(`_boardsIsPdfFile({type:'',name:'Brief.PDF'})`));
      s.ok('a Word file is not a PDF',!run(`_boardsIsPdfFile({type:'',name:'brief.docx'})`));

      s.section('dropping a PDF: page-sized from the start, fitted when it lands');
      run(`_boardsAddFiles([${pdf}],{x:0,y:0})`);
      const id=run(`_editCards[0].id`);
      s.eq('the placeholder is already A4-shaped',size(id),A4);
      run(`__uploads[0].ok({secure_url:'${IMG}',bytes:1153433,width:612,height:792})`);
      await tick();
      s.eq('then fitted to the real page (Letter)',size(id),'240x'+(Math.round(238*792/612)+run(`_BOARDS_FILE_CHROME_H`)));
      s.eq('and it is a file card with its file',run(`_editCards[0].type+' '+_editCards[0].fileUrl`),`file ${IMG}`);

      s.section('a card someone sized is left alone');
      boot();
      run(`_boardsAddFiles([${pdf}],{x:0,y:0})`);
      run(`_editCards[0].w=500;_editCards[0].h=300`);
      run(`__uploads[0].ok({secure_url:'${IMG}',width:612,height:792})`);
      await tick();
      s.eq('resized while uploading → not refitted',size(run(`_editCards[0].id`)),'500x300');
      boot();
      run(`_editCards=[{id:'r',type:'file',x:0,y:0,w:320,h:180,fileUrl:'${IMG}',fileName:'old.pdf'}]`);
      run(`_boardsUploadFileToCard('r',${pdf})`);
      run(`__uploads[0].ok({secure_url:'${IMG}',width:612,height:792})`);
      await tick();
      s.eq('Replace on a resized card keeps its size',size('r'),'320x180');

      s.section('the empty file card from the rail grows when its PDF arrives');
      boot();
      run(`_editCards=[Object.assign(_boardsNewCard('file'),{id:'e'})]`);
      s.eq('starts at the compact default',size('e'),'200x110');
      run(`_boardsUploadFileToCard('e',${pdf})`);
      run(`__uploads[0].ok({secure_url:'${IMG}'})`);
      await tick();
      s.eq('no page size in the response → A4',size('e'),A4);

      s.section('files with no thumbnail stay compact');
      boot();
      run(`_boardsAddFiles([{name:'costing.xlsx',type:'application/vnd.ms-excel',size:9}],{x:0,y:0})`);
      run(`__uploads[0].ok({secure_url:'https://res.cloudinary.com/x/raw/upload/v1/costing.xlsx'})`);
      await tick();
      s.eq('a spreadsheet keeps 200×110',size(run(`_editCards[0].id`)),'200x110');
      boot();
      run(`_boardsAddFiles([${pdf}],{x:0,y:0})`);
      run(`__uploads[0].ok({secure_url:'${RAW}',width:612,height:792})`);
      await tick();
      s.eq('a PDF stored RAW (no thumbnail possible) shrinks back',size(run(`_editCards[0].id`)),'200x110');
      boot();
      run(`_boardsAddFiles([${pdf}],{x:0,y:0})`);
      run(`__uploads[0].bad(new Error('offline'))`);
      await tick();
      s.eq('a failed PDF upload shrinks back to the empty card',size(run(`_editCards[0].id`)),'200x110');

      s.section('a mixed drop does not overlap');
      boot();
      run(`_boardsAddFiles([${pdf},{name:'a.docx',type:'',size:1},${pdf},{name:'b.zip',type:'',size:1}],{x:0,y:0})`);
      const cards=run(`JSON.stringify(_editCards.map(c=>({x:c.x,y:c.y,w:c.w,h:c.h})))`);
      const cs=JSON.parse(cards);
      let overlap=false;
      for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){
        const a=cs[i],b=cs[j];
        if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h)overlap=true;
      }
      s.eq('four cards',cs.length,4);
      s.ok('no two cards overlap',!overlap,cards);

      s.section('out of the Unsorted tray');
      boot();
      const t=run(`JSON.stringify(_boardsCardFromTrayItem({id:'u',kind:'file',fileUrl:'${IMG}',fileName:'brief.pdf'},{x:1000,y:1000}))`);
      const tc=JSON.parse(t);
      s.eq('a PDF comes out A4-shaped',`${tc.w}x${tc.h}`,A4);
      s.eq('and centred on the drop point',`${tc.x+tc.w/2},${tc.y+tc.h/2}`,'1000,1000');
      const d=JSON.parse(run(`JSON.stringify(_boardsCardFromTrayItem({id:'v',kind:'file',fileUrl:'https://res.cloudinary.com/x/raw/upload/v1/a.docx',fileName:'a.docx'},{x:0,y:0}))`));
      s.eq('a Word file stays compact',`${d.w}x${d.h}`,'200x110');
    })(),
    /* THE BOARD TOOL, DRAGGED (Sept 2026). Its own loadApp instance: this is
       a _pending block that sets up state and then awaits, and the
       documented hazard is two of those clobbering each other's _editBoard.
       Driven for real rather than grepped — the whole path lives in
       _boardsRailDragEnd's closure, and the Board tool is the one that does
       not just push a card: it mints the board first, so the placement has
       to survive an await. */
    (async()=>{
      const bd=loadApp({files:['js/boards.js'],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'}});
      const r=x=>bd.run(x);
      const drag=board=>r(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
        _editBoard=${board};moodBoards=[];
        _editCards=[];_editConnectors=[];_boardsSelection=new Set();
        _boardsNextPlacement=null;_boardsCtxWorld=null;
        __stage=document.getElementById('board-stage');
        __stage.getBoundingClientRect=()=>({left:0,top:0,right:1000,bottom:800,width:1000,height:800});
        /* The stub HONOURS THE SELECTOR, and that is the point: a naive
           closest() that always answers passes with drag:true reverted, so
           it would prove the mechanics and not the flag. This reads the real
           list, so dropping drag:true breaks this block too. */
        __drag=_BOARDS_RAIL_MAIN.filter(i=>i.act==='add:board')[0].drag?'1':null;
        __btn={getAttribute:k=>k==='data-drag'?__drag:'add:board',
               getBoundingClientRect:()=>({left:0,top:0,right:40,bottom:40})};
        __ev=(x,y)=>({clientX:x,clientY:y,button:0,
          target:{closest:sel=>(/data-drag/.test(sel)&&!__drag)?null:__btn}});
        _boardsRailDragStart(__ev(20,20));_boardsRailDragMove(__ev(420,320));
        _boardsRailDragEnd(__ev(420,320));`);
      // boardsAddChildBoard mints the board and THEN places the card, so the
      // drop has to survive an await.
      const settle=()=>new Promise(k=>setTimeout(k,30));
      const shot=()=>r(`JSON.stringify(_editCards.map(c=>({type:c.type,board:!!c.boardId,x:c.x,y:c.y})))`);
      /* EVERY AWAIT HAPPENS BEFORE THE FIRST ASSERTION, deliberately.
         s.section sets state on the shared reporter, so a _pending block
         that awaits BETWEEN its section and its assertions has the other
         concurrent block's section land in the middle — the findings then
         file themselves under a heading from a different test. Seen, not
         guessed: these read as "out of the Unsorted tray / one card". */
      drag(`{id:'B',title:'T',visibility:'shared',ownerUid:'u1',zoom:1,panX:0,panY:0}`);
      await settle();
      const onBoard=JSON.parse(shot());
      drag(`{id:'H',title:'Home',isHome:true,visibility:'personal',ownerUid:'u1',zoom:1,panX:0,panY:0}`);
      await settle();
      const onHome=JSON.parse(shot());

      s.section('the Board tool drags onto a board');
      s.eq('one card',onBoard.length,1);
      s.eq('and it is a board link',onBoard[0]&&onBoard[0].type,'board');
      /* A card type that is a LINK to something must never be creatable
         without the thing it links to — the orphan the rail used to mint. */
      s.ok('pointing at a board that really exists',!!(onBoard[0]&&onBoard[0].board));
      s.eq('placed where the pointer was released',
        onBoard[0]?onBoard[0].x+','+onBoard[0].y:'(no card)','330,280');

      s.section('and onto Home, where it is a NEW board rather than a sub-board');
      s.eq('one card',onHome.length,1);
      s.ok('linked to a real board',!!(onHome[0]&&onHome[0].type==='board'&&onHome[0].board));
      s.eq('at the drop point too',
        onHome[0]?onHome[0].x+','+onHome[0].y:'(no card)','330,280');
    })()])).then(()=>s);
  }
};

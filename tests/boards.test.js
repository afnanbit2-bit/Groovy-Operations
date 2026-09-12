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

  return s;
};

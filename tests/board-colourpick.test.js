/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — Pick colour on a picture, and the TCX / Pantone C tabs
   (29 Sept 2026). Afnan: "a tab for TCX code and pantone code — we click on
   an image and it gives which code it is".

   Closeness is CIEDE2000, checked here against the published reference
   pairs (Sharma, Wu & Dalal 2005), not against numbers this file invented.
   The pick is DRIVEN: a stub canvas answers getImageData, and the real
   _boardsPickAt maps the click, averages the patch and opens the panel.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-colourpick');
  const app=loadApp({files:['js/boards.js']});
  const {run}=app;
  run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};currentPage='board-canvas';
    _editBoard={id:'B',ownerUid:'u1',visibility:'personal',title:'T',zoom:1,panX:0,panY:0};
    _editConnectors=[];_editUnsorted=[];_boardsUndo=[];_boardsRedo=[];
    _editCards=[{id:'ph',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/a.jpg',x:100,y:100,w:200,h:200}];
    _BOARDS_PANTONE_EXTRA['485 C']='#DA291C';
    _BOARDS_PANTONE_EXTRA['186 C']='#C8102E';
    _BOARDS_PANTONE_EXTRA['19-1664 TCX']='#9E2A2B';
    _BOARDS_PANTONE_EXTRA['18-1662 TCX']='#C3202F';
    _BOARDS_PANTONE_EXTRA['11-0601 TCX']='#F4F5F0';`);

  s.section('CIEDE2000 matches the published reference pairs');
  const de=(a,b)=>run(`_boardsDE2000(${JSON.stringify(a)},${JSON.stringify(b)})`);
  [[{L:50,a:2.6772,b:-79.7751},{L:50,a:0,b:-82.7485},2.0425],
   [{L:50,a:3.1571,b:-77.2803},{L:50,a:0,b:-82.7485},2.8615],
   [{L:60.2574,a:-34.0099,b:36.2677},{L:60.4626,a:-34.1751,b:39.4387},1.2644],
   [{L:2.0776,a:0.0795,b:-1.1350},{L:0.9033,a:-0.0636,b:-0.5514},0.9082],
   [{L:50,a:2.5,b:0},{L:73,a:25,b:-18},27.1492]
  ].forEach(([a,b,want])=>s.ok('ΔE2000 = '+want,Math.abs(de(a,b)-want)<0.0005,String(de(a,b))));
  s.ok('white is L 100',Math.abs(run(`_boardsLab('#FFFFFF').L`)-100)<0.01);
  s.ok('black is L 0',Math.abs(run(`_boardsLab('#000000').L`))<0.01);
  s.eq('a colour is 0 from itself',run(`_boardsDE2000(_boardsLab('#9E2A2B'),_boardsLab('#9E2A2B'))`),0);

  s.section('two books, never mixed');
  s.eq('a TCX code is TCX',run(`_boardsPantoneSys('19-1664 TCX')`),'TCX');
  s.eq('a C code is C',run(`_boardsPantoneSys('485 C')`),'C');
  s.eq('paper and uncoated belong to neither tab',run(`_boardsPantoneSys('19-1664 TPX')+_boardsPantoneSys('485 U')`),'');
  const tcx=JSON.parse(run(`JSON.stringify(_boardsPantoneMatches('#A02A2C','TCX',3))`));
  s.eq('the TCX tab lists only TCX',tcx.map(m=>m.code).join(),'19-1664 TCX,18-1662 TCX,11-0601 TCX');
  s.ok('closest first',tcx[0].de<tcx[1].de&&tcx[1].de<tcx[2].de);
  const c=JSON.parse(run(`JSON.stringify(_boardsPantoneMatches('#DB2A1D','C',2))`));
  s.eq('the C tab lists only C, closest first',c.map(m=>m.code).join(),'485 C,186 C');
  s.eq('the words follow the number',run(`[0.4,2,5,9,20].map(_boardsDeWord).join()`),'Exact,Very close,Close,Rough,Far off');
  s.eq('counts by book',run(`_boardsPantoneCount('TCX')+'/'+_boardsPantoneCount('C')`),'3/2');

  s.section('an empty book says so');
  run(`delete _BOARDS_PANTONE_EXTRA['19-1664 TCX'];delete _BOARDS_PANTONE_EXTRA['18-1662 TCX'];delete _BOARDS_PANTONE_EXTRA['11-0601 TCX'];_boardsPickSys='TCX'`);
  const none=run(`_boardsNearHTML('#A02A2C','pick')`);
  s.ok('no TCX loaded is said, not faked with a C code',/No TCX \(fabric\) codes are loaded/.test(none)&&!/485 C/.test(none),none.slice(0,200));
  run(`_BOARDS_PANTONE_EXTRA['19-1664 TCX']='#9E2A2B';_BOARDS_PANTONE_EXTRA['18-1662 TCX']='#C3202F'`);
  const withTcx=run(`_boardsNearHTML('#A02A2C','pick')`);
  s.ok('buttons carry an index, never the code',/boardsNearUse\('pick',0\)/.test(withTcx)&&!/boardsNearUse\([^)]*TCX/.test(withTcx));

  s.section('the patch average');
  s.eq('transparent pixels are left out',run(`_boardsAvgPixels([200,40,40,255, 0,0,0,0, 100,20,20,255])`),'#961E1E');
  s.eq('an all-transparent patch reads nothing',run(`_boardsAvgPixels([0,0,0,0])`),'');

  s.section('Pick colour, driven');
  s.ok('the rail offers Pick colour on a picture',/img:pick/.test(run(`_boardsSelection=new Set(['ph']);_boardsRailItems().map(i=>i.act).join()`)));
  s.ok('the right-click menu offers it too (the phone\'s More sheet reads that list)',
    /img:pick/.test(run(`_boardsCardCtxItems(true).map(i=>i.act).filter(Boolean).join()`)));
  s.ok('and ⋯ does not repeat what the rail already carries',
    !/img:pick/.test(run(`_boardsMoreItems(true).map(i=>i.act).filter(Boolean).join()`)));
  run(`window.boardsPickMode('ph')`);
  s.eq('it turns on for that picture',run(`_boardsPickOn`),'ph');
  s.ok('the card says so (crosshair class)',/ picking/.test(run(`_boardCardHTML(_editCards[0])`)));
  // A picture 200×200 drawn at zoom 1: the stub canvas answers a red patch.
  run(`(function(){
    const card=document.getElementById('board-card-ph');
    const img={naturalWidth:1000,naturalHeight:1000};
    const body={getBoundingClientRect(){return{left:100,top:100,right:300,bottom:300,width:200,height:200};},querySelector(){return img;}};
    card.querySelector=function(){return body;};
    const orig=document.createElement;
    window.__patch=[];for(let i=0;i<25;i++)window.__patch.push(160,42,44,255);
    window.__asked=null;
    document.createElement=function(t){
      if(t==='canvas')return{width:0,height:0,getContext(){return{drawImage(){},save(){},restore(){},beginPath(){},rect(){},clip(){},translate(){},rotate(){},
        getImageData(x,y,w,h){window.__asked=[x,y,w,h];return{data:window.__patch};}};}};
      return orig.apply(document,arguments);
    };
  })()`);
  run(`window.boardsCardDragStart({currentTarget:{},target:{},clientX:150,clientY:160,pointerId:1,button:0,pointerType:'mouse',stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false},'ph')`);
  s.eq('a press reads the colour instead of dragging',run(`_boardsPickLast&&_boardsPickLast.hex`),'#A02A2C');
  s.eq('the patch is centred on the click, in card pixels',run(`JSON.stringify(window.__asked)`),'[48,58,5,5]');
  s.eq('and nothing moved',run(`_editCards[0].x+','+_editCards[0].y`),'100,100');
  s.eq('the panel lists the closest TCX first',run(`_boardsNearLast.pick[0]&&_boardsNearLast.pick[0].code`),'19-1664 TCX');
  run(`window.boardsNearUse('pick',0)`);
  const sw=JSON.parse(run(`JSON.stringify(_editCards.find(c=>c.type==='swatch'))`));
  s.eq('Swatch makes a swatch of that code',sw.pantone+' '+sw.hex+' '+sw.fmt,'19-1664 TCX #9E2A2B pantone');
  s.eq('beside the picture',sw.x+','+sw.y,'324,100');
  run(`window.boardsPickExact()`);
  const two=JSON.parse(run(`JSON.stringify(_editCards.filter(c=>c.type==='swatch'))`));
  s.eq('the exact colour stacks under the first, never on it',two[1]&&(two[1].hex+' '+two[1].y+' '+(two[1].pantone||'-')),'#A02A2C 346 -');
  s.eq('each swatch is one undo',run(`_boardsUndo.length`),2);
  run(`window.__patch=[0,0,0,0]`);
  run(`_boardsPickLast=null;_boardsPickAt({clientX:150,clientY:160},'ph')`);
  s.eq('a transparent spot reads nothing',run(`_boardsPickLast`),null);
  run(`window.__patch=[];for(let i=0;i<25;i++)window.__patch.push(160,42,44,255)`);
  run(`_boardsPickLast=null;_boardsPickAt({clientX:40,clientY:40},'ph')`);
  s.eq('a click off the picture reads nothing',run(`_boardsPickLast`),null);
  run(`_boardsSetSelection(['other'])`);
  s.eq('selecting something else ends pick mode',run(`_boardsPickOn`),null);

  s.section('a viewer can read, not make');
  run(`_editBoard.ownerUid='someone-else';session={uid:'u9',u:'uzaib',name:'Uzaib',role:'viewer'};_editBoard.visibility='personal';_editBoard.sharedWith=['uzaib@groovy.op'];_editBoard.sharedView=['uzaib@groovy.op']`);
  s.ok('Pick colour is still on the rail',/img:pick/.test(run(`_boardsSelection=new Set(['ph']);_boardsRailItems().map(i=>i.act).join()`)));
  s.ok('but the matches carry no Swatch button',!/boardsNearUse/.test(run(`_boardsNearHTML('#A02A2C','pick')`)));
  run(`_editBoard.ownerUid='u1';session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'}`);

  s.section('a recoloured swatch drops a code it no longer is');
  run(`_editCards.push({id:'sw1',type:'swatch',hex:'#9E2A2B',pantone:'19-1664 TCX',fmt:'pantone',x:0,y:0,w:220,h:230})`);
  run(`_boardsSwatchSetHex('sw1','#123456')`);
  s.eq('the old code is gone',run(`_editCards.find(c=>c.id==='sw1').pantone||'none'`),'none');
  run(`_editCards.find(c=>c.id==='sw1').pantone='19-1664 TCX';_boardsSwatchSetHex('sw1','#9E2A2B')`);
  s.eq('set to the code\'s own colour, the code stays',run(`_editCards.find(c=>c.id==='sw1').pantone||'none'`),'19-1664 TCX');

  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — Unsorted previews and the magnet (Sept 2026).
   A note, a to-do, a column, a colour each preview as what they are in the
   Unsorted tray instead of a word in a grey box, and a card let go NEAR
   the tray is caught. The drag itself is driven in tests/boards.test.js
   ("the magnet"); this file holds the previews and the pure magnet maths.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-trayprev');
  const app=loadApp({files:['js/boards.js']});
  const {run}=app;
  run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
    _editBoard={id:'B',ownerUid:'u1',visibility:'shared',title:'T',zoom:1,panX:0,panY:0};
    _editCards=[];_editConnectors=[];_editUnsorted=[];`);
  const prev=u=>run(`(function(){const p=_boardsTrayPreview(${JSON.stringify(u)},0);return p?JSON.stringify(p):null;})()`);
  const P=u=>{const x=prev(u);return x?JSON.parse(x):null;};

  s.section('a to-do shows its tasks, ticked, with a count');
  {
    const p=P({id:'u',kind:'cards',cards:[{id:'t',type:'todo',title:'Launch',items:[
      {text:'trace',done:true},{text:'bundle'},{text:'a'},{text:'b'},{text:'c'},{text:'d'},{text:'e'}]}]});
    s.ok('it is a to-do preview',!!p&&/board-tray-prev-todo/.test(p.html));
    s.ok('the title is in the text, not the markup',p.texts.includes('Launch')&&!/Launch/.test(p.html));
    s.ok('the first tasks are listed',p.texts.includes('trace')&&p.texts.includes('bundle'));
    s.eq('done / total',(/prev-count">([^<]*)/.exec(p.html)||[])[1],'1/7');
    s.ok('a done task is marked done',/board-tray-prev-task done/.test(p.html));
    s.ok('and the rest are counted, not dropped',/\+3 more/.test(p.html));
  }

  s.section('a column shows its title and how many cards it holds');
  {
    const p=P({id:'u',kind:'cards',cards:[{id:'c',type:'column',title:'Fabric'},
      {id:'a',type:'text',text:'second',columnId:'c',y:200},{id:'b',type:'text',text:'first',columnId:'c',y:80},
      {id:'d',type:'image',imageUrl:'https://res.cloudinary.com/x/image/upload/a.jpg',columnId:'c',y:300}]});
    s.ok('it is a column preview',!!p&&/board-tray-prev-col/.test(p.html));
    s.ok('its title',p.texts.includes('Fabric'));
    s.eq('its count',(/prev-count">\s*([^<]*)/.exec(p.html)||[])[1].trim(),'3 cards');
    s.ok('its cards in the column\'s order',p.texts.indexOf('first')<p.texts.indexOf('second'));
    s.ok('a picture shows as a picture',/board-tray-prev-kidpic" src="https:\/\/res\.cloudinary\.com/.test(p.html));
  }

  s.section('a note, a colour, a heading, a table');
  {
    const n=P({id:'u',kind:'text',cards:[{id:'n',type:'text',text:'line one\nline two'}]});
    s.ok('a note shows its words',!!n&&n.texts[0]==='line one\nline two');
    const loose=P({id:'u',kind:'text',text:'pasted text'});
    s.ok('so does text pasted straight in',!!loose&&loose.texts[0]==='pasted text');
    const w=P({id:'u',kind:'cards',cards:[{id:'w',type:'swatch',hex:'#C0392B'}]});
    s.ok('a colour paints itself',!!w&&/background:#C0392B/i.test(w.html));
    s.ok('and says its code',w.texts.includes('#C0392B'));
    const bad=P({id:'u',kind:'cards',cards:[{id:'w',type:'swatch',hex:'red;background:url(x)'}]});
    s.eq('a colour that is not a colour paints nothing',bad,null);
    const h=P({id:'u',kind:'cards',cards:[{id:'h',type:'heading',text:'SUMMER'}]});
    s.ok('a heading is a heading',!!h&&/prev-heading/.test(h.html)&&h.texts[0]==='SUMMER');
    const t=P({id:'u',kind:'cards',cards:[{id:'t',type:'table',rows:[['Size','Qty'],['M',{v:'40',b:1}]]}]});
    s.ok('a table shows its cells',!!t&&t.texts.join()==='Size,Qty,M,40');
    s.eq('a photo keeps its picture (no preview)',P({id:'u',kind:'image',imageUrl:'https://res.cloudinary.com/x/a.jpg'}),null);
  }

  s.section('user text never reaches the markup');
  {
    const evil='<img src=x onerror=alert(1)>';
    const p=P({id:'u',kind:'cards',cards:[{id:'t',type:'todo',title:evil,items:[{text:evil}]}]});
    s.ok('not in the html',!/onerror/.test(p.html));
    s.ok('only in the text slots',p.texts.filter(x=>x===evil).length===2);
    run(`_editUnsorted=[${JSON.stringify({id:'u',kind:'cards',cards:[{id:'t',type:'todo',title:'Go',items:[{text:'one'}]}]})}]`);
    const a=app.el('board-tray-p-0-0'),b=app.el('board-tray-p-0-1');
    run(`_boardsTrayHydrate()`);
    s.eq('the hydrate writes every slot with textContent',[a.textContent,b.textContent].sort().join('+'),'Go+one');
  }

  s.section('the magnet maths');
  {
    const m=(x,y)=>run(`JSON.stringify(_boardsMagnet({left:800,right:1200,top:0,bottom:600},${x},${y}))`);
    const on=JSON.parse(m(900,300)),near=JSON.parse(m(760,300)),mid=JSON.parse(m(700,300)),far=JSON.parse(m(500,300));
    s.ok('on the target: caught, full strength',on.caught&&on.m===1);
    s.ok('40px short: caught',near.caught);
    s.ok('100px short: pulled, not caught',!mid.caught&&mid.m>0&&mid.m<1&&mid.vx>0);
    s.ok('300px short: nothing',far.m===0&&!far.caught);
    s.ok('closer pulls harder',near.m>mid.m);
    s.ok('no target, no magnet',JSON.parse(run(`JSON.stringify(_boardsMagnet(null,0,0))`)).m===0);
  }

  s.section('the stash name reads a to-do\'s first task');
  s.eq('not the empty old field',run(`_boardsStashName({type:'todo',items:[{text:'cut fabric'}]},1)`),'cut fabric');

  s.section('a link with no picture shows the link, not a grey box');
  {
    const p=P({id:'u',kind:'link',linkUrl:'https://www.pinterest.com/pin/123/',linkTitle:'Wide leg denim',linkSite:'Pinterest',text:'A pin'});
    s.ok('it is a link preview',!!p&&/board-tray-prev-link/.test(p.html));
    s.ok('site, title, description and address are in the text slots',
      p.texts.join('|')==='Pinterest|Wide leg denim|A pin|www.pinterest.com/pin/123/',p.texts.join('|'));
    s.ok('none of it is in the markup',!/Wide leg|Pinterest/.test(p.html));
    const bare=P({id:'u',kind:'link',linkUrl:'https://pinterest.com/pin/9/',linkTitle:'pinterest.com'});
    s.eq('a title that is only the host is not repeated',bare.texts.join('|'),'pinterest.com|pinterest.com/pin/9/');
    const busy=P({id:'u',kind:'link',linkUrl:'https://a.test/',_fetching:true});
    s.eq('while it fetches it says so',busy.texts[0],'Loading preview…');
    s.eq('a link WITH a picture keeps its picture',P({id:'u',kind:'link',linkUrl:'https://a.test/',linkImage:'https://res.cloudinary.com/x/a.jpg'}),null);
    const evil=P({id:'u',kind:'link',linkUrl:'https://a.test/',linkTitle:'<img src=x onerror=alert(1)>'});
    s.ok('a hostile title never reaches the markup',!/onerror/.test(evil.html));
  }

  s.section('a link dragged out with no picture asks again');
  {
    run(`window.__hyd=[];_boardsLinkHydrate=function(id){window.__hyd.push(id);};
      _editCards=[];_editConnectors=[];_boardsSelection=new Set();_boardsTrayOpen=true;
      _editUnsorted=[{id:'a',kind:'link',linkUrl:'https://www.pinterest.com/pin/1/',linkTitle:'pinterest.com'},
                     {id:'b',kind:'link',linkUrl:'https://b.test/',linkTitle:'B',linkImage:'https://res.cloudinary.com/x/b.jpg'}];
      document.getElementById('board-stage').getBoundingClientRect=function(){return{left:0,top:0,right:1200,bottom:800};};`);
    const drag=i=>{
      run(`window.boardsTrayDragStart({currentTarget:document.getElementById('tray-row'),clientX:0,clientY:0,pointerId:1,stopPropagation(){}},${i})`);
      app.fire('tray-row','pointermove',{clientX:60,clientY:60,pointerId:1});
      app.fire('tray-row','pointerup',{clientX:400,clientY:300,pointerId:1});
    };
    drag(0);
    s.eq('the pictureless link is fetched again',run(`window.__hyd.length`),1);
    s.eq('for the card that landed',run(`window.__hyd[0]===_editCards[0].id`),true);
    drag(0);
    s.eq('one that brought its picture is not',run(`window.__hyd.length`),1);
    s.eq('and it kept that picture',run(`_editCards[1].linkImage`),'https://res.cloudinary.com/x/b.jpg');
  }

  return s;
};

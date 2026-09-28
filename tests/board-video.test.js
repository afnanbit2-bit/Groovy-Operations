/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — video in a link card (js/boards.js "Video in a link card").
   Built from the Claude in Chrome study, GitHub issue #94 §12.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-video');
  const app=loadApp({files:['js/boards.js']});
  const {run}=app;
  const v=u=>JSON.parse(run(`JSON.stringify(_boardsVideoOf(${JSON.stringify(u)}))`));

  s.section('which links are videos');
  s.eq('youtube watch',v('https://www.youtube.com/watch?v=aqz-KE-bpKQ').id,'aqz-KE-bpKQ');
  s.eq('youtu.be',v('https://youtu.be/aqz-KE-bpKQ').id,'aqz-KE-bpKQ');
  s.eq('shorts',v('https://youtube.com/shorts/aqz-KE-bpKQ').id,'aqz-KE-bpKQ');
  s.eq('mobile',v('https://m.youtube.com/watch?v=aqz-KE-bpKQ').id,'aqz-KE-bpKQ');
  s.ok('a start time is carried',/&start=90$/.test(v('https://youtu.be/aqz-KE-bpKQ?t=1m30s').embed));
  s.ok('the embed is youtube-nocookie with autoplay',/^https:\/\/www\.youtube-nocookie\.com\/embed\/aqz-KE-bpKQ\?autoplay=1/.test(v('https://youtu.be/aqz-KE-bpKQ').embed));
  s.eq('vimeo',v('https://vimeo.com/76979871').embed,'https://player.vimeo.com/video/76979871?autoplay=1');
  s.eq('a lookalike host is not YouTube',v('https://youtube.com.evil.test/watch?v=aqz-KE-bpKQ'),null);
  s.eq('nor a subdomain trick',v('https://evil.test/youtube.com/watch?v=aqz-KE-bpKQ'),null);
  s.eq('an id that is not YouTube-shaped is refused',v('https://youtu.be/"><script>'),null);
  s.eq('javascript: is not a video',v('javascript:alert(1)'),null);
  s.eq('a channel page is not a video',v('https://www.youtube.com/@blender'),null);
  s.eq('an ordinary link is not a video',v('https://pinterest.com/pin/1'),null);

  s.section('the card at rest');
  run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
    _editBoard={id:'B',title:'W',ownerUid:'u1',visibility:'personal'};_editConnectors=[];_boardsCardTrash=[];_boardsConnSel=null;_boardsCellFocus=null;
    _editCards=[{id:'v1',type:'link',linkUrl:'https://youtu.be/aqz-KE-bpKQ',linkTitle:'Big Buck Bunny',x:0,y:0,w:340,h:300}];_boardsSelection=new Set();`);
  const html=run(`_boardCardHTML(_editCards[0],true)`);
  s.ok('a 16:9 box with a play button',/board-video"[^>]*>[\s\S]*board-video-play/.test(html));
  s.ok('YouTube\'s still as the thumbnail when nothing was fetched',html.indexOf('i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg')>0);
  s.ok('NO player is loaded until play is pressed',html.indexOf('<iframe')<0);
  s.ok('the play button cannot start a card drag',/board-video-play" onpointerdown="event.stopPropagation\(\)"/.test(html));
  s.ok('the preview toggle is offered even without a fetched picture',html.indexOf('boardsLinkTogglePreview')>0);
  run(`_editCards[0].linkImage='https://res.cloudinary.com/x/image/upload/v1/t.jpg'`);
  s.ok('a fetched picture is preferred',run(`_boardCardHTML(_editCards[0],true)`).indexOf('res.cloudinary.com/x/image/upload')>0);
  run(`_editCards[0].linkPreviewOff=true`);
  s.ok('Preview off hides the video',run(`_boardCardHTML(_editCards[0],true)`).indexOf('board-video')<0);
  run(`delete _editCards[0].linkPreviewOff`);

  s.section('pressing play');
  const box=app.el('board-vid-v1');
  run(`window.boardsVideoPlay('v1')`);
  s.ok('the player replaces the thumbnail in that one element',/<iframe class="board-video-frame" src="https:\/\/www\.youtube-nocookie\.com/.test(box.innerHTML));
  s.ok('allowed to go full screen and picture-in-picture',/allowfullscreen/.test(box.innerHTML)&&/picture-in-picture/.test(box.innerHTML));
  s.ok('a re-render keeps it playing (restarting — known limit)',run(`_boardCardHTML(_editCards[0],true)`).indexOf('<iframe')>0);
  s.eq('playing is never stored on the card',run(`JSON.stringify(_boardsCardsForSave?_boardsCardsForSave():_editCards).indexOf('laying')`),-1);
  run(`_editCards.push({id:'l2',type:'link',linkUrl:'https://pinterest.com/pin/1'});window.boardsVideoPlay('l2')`);
  s.eq('play on a non-video does nothing',run(`_boardsPlaying.has('l2')`),false);

  s.section('sizing');
  run(`__c={id:'n',type:'link',linkUrl:'https://youtu.be/aqz-KE-bpKQ',w:_BOARDS_LINK_W,h:_BOARDS_LINK_H};_boardsApplyLinkMeta(__c,{title:'T'},'')`);
  s.eq('a fresh video card is sized for the player',run(`__c.w+'x'+__c.h`),'340x300');
  run(`__c={id:'n',type:'link',linkUrl:'https://youtu.be/aqz-KE-bpKQ',w:500,h:400};_boardsApplyLinkMeta(__c,{title:'T'},'')`);
  s.eq('one sized by hand is left alone',run(`__c.w+'x'+__c.h`),'500x400');

  return s;
};

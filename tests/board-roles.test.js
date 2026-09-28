/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — sharing roles (edit / comment / view), the client half.
   The rules half runs in the real emulator: tests/rules-emulator-boards.js.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const BOARD={id:'B',title:'Winter',visibility:'personal',ownerUid:'u-mustafa',cards:[],connectors:[],unsorted:[],
  sharedWith:['daniyal@groovy.op','saim@groovy.op','umair@groovy.op'],
  sharedView:['umair@groovy.op'],sharedComment:['saim@groovy.op']};

function as(u,role){
  const app=loadApp({files:['js/boards.js']});
  app.run(`session=${JSON.stringify({uid:'u-'+u,u,name:u,role:role||'manager',email:u+'@groovy.op'})};
    moodBoards=[${JSON.stringify(BOARD)}];boardsLoaded=true;_boardsViewingId='B';currentPage='board-canvas';`);
  return app;
}

module.exports=async function(){
  const s=suite('board-roles');

  s.section('who is what');
  const who=(u,role)=>{const a=as(u,role);return a.run(`[_boardsCanEdit(moodBoards[0]),_boardsCanComment(moodBoards[0]),_boardsCanManageShare(moodBoards[0])].join(',')`);};
  s.eq('the board\'s owner: edit, comment, manage',who('mustafa'),'true,true,true');
  s.eq('an editor: edit, comment, not manage',who('daniyal'),'true,true,false');
  s.eq('a commenter: comment only',who('saim'),'false,true,false');
  s.eq('a viewer: nothing',who('umair'),'false,false,false');
  s.eq('not shared: nothing',who('abbas'),'false,false,false');
  s.eq('an app owner: everything',who('afnan','owner'),'true,true,true');
  {
    const a=as('daniyal');
    s.eq('a board shared before roles still means edit',a.run(`_boardsCanEdit({ownerUid:'x',visibility:'personal',sharedWith:['daniyal@groovy.op']})`),true);
    s.eq('email case does not matter',a.run(`_boardsShareRole({sharedWith:['Umair@Groovy.op'],sharedView:['UMAIR@groovy.op']},'umair@groovy.op')`),'view');
    s.eq('a TEAM board is editable whatever the lists say',a.run(`_boardsCanEdit({ownerUid:'x',visibility:'shared',sharedWith:['daniyal@groovy.op'],sharedView:['daniyal@groovy.op']})`),true);
  }

  s.section('what a share writes');
  {
    const a=as('mustafa');
    const p=JSON.parse(a.run(`JSON.stringify(_boardsSharePatch({'A@groovy.op':'edit','b@groovy.op':'comment','c@groovy.op':'view','d@groovy.op':'owner',' ':'edit'}))`));
    s.eq('everyone picked is on sharedWith, lower-cased; junk roles and blanks dropped',p.sharedWith.join(','),'a@groovy.op,b@groovy.op,c@groovy.op');
    s.eq('the commenter',p.sharedComment.join(','),'b@groovy.op');
    s.eq('the viewer',p.sharedView.join(','),'c@groovy.op');
  }

  s.section('the share sheet');
  {
    const a=as('daniyal');
    a.run(`_editBoard=JSON.parse(JSON.stringify(moodBoards[0]));window.boardsOpenShare()`);
    s.eq('an editor who is not the owner cannot open it',a.el('board-share-modal').innerHTML,'');
    s.ok('and the ⋯ menu does not offer it',a.run(`_renderBoardCanvasHTML()`).indexOf('boardsOpenShare')<0);
  }
  {
    const a=as('mustafa');
    a.run(`_editBoard=JSON.parse(JSON.stringify(moodBoards[0]));
      USER_DEFS=[{u:'mustafa',name:'Mustafa',email:'mustafa@groovy.op'},{u:'saim',name:'Saim',email:'saim@groovy.op'},{u:'abbas',name:'Abbas',email:'abbas@groovy.op'}];
      window.boardsOpenShare()`);
    const html=a.el('board-share-modal').innerHTML;
    s.ok('the owner gets it, with a role per person',/board-share-role/.test(html));
    s.ok('Saim shows as Can comment',/value="comment" selected/.test(html));
    s.ok('someone not shared has the role picker disabled',/Abbas[\s\S]*?<select[^>]*disabled/.test(html));
    s.ok('the owner is not offered to themselves',html.indexOf('@mustafa')<0);
    s.ok('the ⋯ menu offers it',a.run(`_renderBoardCanvasHTML()`).indexOf('boardsOpenShare')>=0);
  }

  s.section('the top bar says what you can do');
  {
    const pill=u=>{const a=as(u);a.run(`_editBoard=JSON.parse(JSON.stringify(moodBoards[0]))`);const h=a.run(`_renderBoardCanvasHTML()`);return(h.match(/board-role-pill">([^<]*)</)||[])[1]||'';};
    s.eq('viewer',pill('umair'),'View only');
    s.eq('commenter',pill('saim'),'Can comment');
    s.eq('editor sees no pill',pill('daniyal'),'');
  }

  s.section('commenting');
  {
    const a=as('umair');
    a.run(`_editBoard=JSON.parse(JSON.stringify(moodBoards[0]));`);
    await a.run(`window.boardsAddComment()`);
    a.el('board-cmt-input').value='hello';
    await a.run(`window.boardsAddComment()`);
    s.eq('a viewer\'s comment is refused before any write',a.state.writes.length,0);
    s.ok('and told why',a.state.toasts.some(t=>/not comment/.test(t)));
  }
  {
    const a=as('saim');
    a.run(`_editBoard=JSON.parse(JSON.stringify(moodBoards[0]));`);
    a.el('board-cmt-input').value='love this';
    await a.run(`window.boardsAddComment()`);
    s.ok('a commenter\'s comment is written',a.state.writes.some(w=>w.op==='add'&&w.data.text==='love this'));
    a.run(`_boardsDrawerOpen=true;_boardsDrawerTab='comments';_boardsComments=[{id:'c1',text:'x',byUid:'u-x',byName:'X',ts:1,cardId:null}];_boardsRenderDrawer()`);
    const html=a.el('board-drawer').innerHTML;
    s.ok('the drawer gives a commenter the compose box',/board-drawer-compose/.test(html));
    s.ok('but not Resolve — that is an editor\'s',!/boardsResolveComment/.test(html));
  }

  return s;
};

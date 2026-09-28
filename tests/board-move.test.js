/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — "Move to board…" (js/boards.js boardsMoveCardsTo)

   A moved card lands in the TARGET board's Unsorted (Milanote's rule). The
   things worth guarding: the target is appended to on the SERVER's copy of
   its Unsorted, inside a transaction, before anything leaves this board; a
   failed write moves nothing; a container takes its contents; locked cards
   stay; and Ctrl+Z can never bring a moved card back as a duplicate.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

function setup(txImpl){
  const tx={calls:0,updates:[],server:{unsorted:[{id:'already-there'}]}};
  const app=loadApp({files:['js/boards.js'],globals:{
    runTransaction:txImpl||(async(db,fn)=>{
      tx.calls++;
      return fn({
        get:async()=>({exists:()=>true,data:()=>tx.server}),
        update:(ref,p)=>{tx.updates.push(p);}
      });
    }),
    doc:(db,col,id)=>({col,id})
  }});
  app.run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};boardsLoaded=true;
    moodBoards=[
      {id:'SRC',title:'Winter',ownerUid:'u1',visibility:'personal',cards:[],connectors:[],unsorted:[]},
      {id:'DST',title:'Denim',ownerUid:'u1',visibility:'personal',cards:[],connectors:[],unsorted:[{id:'stale-copy'}]},
      {id:'HOME',title:'Home',isHome:true,ownerUid:'u1',visibility:'personal'}];
    _editBoard=moodBoards[0];_editUnsorted=[];currentPage='board-canvas';
    _editCards=[
      {id:'n1',type:'text',text:'hello',x:100,y:100,w:220,h:100},
      {id:'col',type:'column',title:'Refs',x:400,y:0,w:280,h:300},
      {id:'k1',type:'text',text:'in column',columnId:'col',x:410,y:70,w:260,h:80},
      {id:'lk',type:'text',text:'locked',locked:true,x:900,y:0,w:100,h:100},
      {id:'bl',type:'board',boardId:'DST',x:0,y:600,w:340,h:136},
      {id:'stay',type:'text',text:'stays',x:0,y:900,w:100,h:100}];
    _editConnectors=[{id:'c1',from:'n1',to:'k1'},{id:'c2',from:'n1',to:'stay'},{id:'c3',from:'col',to:'k1'}];
    _boardsUndo=[];_boardsRedo=[];_boardsSelection=new Set();`);
  return{app,tx};
}

module.exports=async function(){
  const s=suite('board-move');

  {
    const {app}=setup();
    const {run}=app;
    s.section('the menu offers it where Move to Unsorted is offered');
    run(`_boardsSelection=new Set(['n1'])`);
    const acts=run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act).filter(Boolean))`);
    s.ok('Move to board… is on the card menu',acts.indexOf('"movetoboard"')>=0,acts);
    s.ok('beside Move to Unsorted',acts.indexOf('"stash"')>=0);
    run(`_boardsSelection=new Set(['bl'])`);
    s.ok('not for a board link',run(`JSON.stringify(_boardsCardCtxItems(true).map(i=>i.act))`).indexOf('movetoboard')<0);

    s.section('the picker never offers this board or Home');
    run(`_boardsSelection=new Set(['n1']);window.boardsOpenMoveTo()`);
    const html=app.bodyHtml('board-sheet');
    s.ok('the other board is offered',html.indexOf("boardsMoveCardsTo('DST')")>=0);
    s.ok('this board is not',html.indexOf("boardsMoveCardsTo('SRC')")<0);
    s.ok('Home is not',html.indexOf("boardsMoveCardsTo('HOME')")<0);
  }

  {
    const {app,tx}=setup();
    const {run,state}=app;
    s.section('moving a note and a column');
    // an earlier, unrelated action, so there IS history to purge
    run(`_boardsPushUndo();_editCards.find(c=>c.id==='stay').x=5;`);
    const n=await run(`window.boardsMoveCardsTo('DST',['n1','col','lk'])`);
    s.eq('two rows: the note, and the column with its child',n,2);
    s.eq('one transaction',tx.calls,1);
    const u=tx.updates[0]&&tx.updates[0].unsorted;
    s.ok('appended to the SERVER\'s Unsorted, not this tab\'s stale copy',
      !!u&&u[0].id==='already-there'&&!u.some(x=>x.id==='stale-copy'),JSON.stringify(u&&u.map(x=>x.id)));
    s.eq('the server keeps what it had plus the two',u&&u.length,3);
    const colItem=u&&u.find(x=>x.cards&&x.cards[0].id==='col');
    s.eq('the column carries its child',colItem&&colItem.cards.length,2);
    s.eq('a line inside the column travels with it',colItem&&colItem.conns&&colItem.conns.map(c=>c.id).join(','),'c3');
    const noteItem=u&&u.find(x=>x.cards&&x.cards[0].id==='n1');
    s.ok('a line between two separate rows is dropped — the Unsorted rule',!(noteItem&&noteItem.conns));
    s.eq('left this board: note, column and child',run(`_editCards.map(c=>c.id).join(',')`),'lk,bl,stay');
    s.eq('the line to a card that stayed is dropped',run(`_editConnectors.length`),0);
    s.ok('the locked card is kept and counted',state.toasts.some(t=>/1 locked card kept here/.test(t)),state.toasts.join(' | '));
    s.ok('the toast names the board and says undo will not return them',
      state.toasts.some(t=>/moved to Unsorted in Denim/.test(t)&&/Ctrl\+Z will not bring them back/.test(t)));

    s.section('Ctrl+Z cannot resurrect a moved card');
    s.eq('the earlier history is kept',run(`_boardsUndo.length`),1);
    run(`window.boardsUndoAction()`);
    s.ok('undoing the earlier edit brings back its x…',run(`_editCards.find(c=>c.id==='stay').x`)===0);
    s.ok('…and NOT the moved cards',run(`!_editCards.some(c=>c.id==='n1'||c.id==='col'||c.id==='k1')`));
  }

  {
    const {app}=setup(async()=>{throw new Error('offline');});
    const {run,state}=app;
    s.section('a failed write moves nothing');
    const n=await run(`window.boardsMoveCardsTo('DST',['n1'])`);
    s.eq('nothing moved',n,0);
    s.ok('the card is still here',run(`_editCards.some(c=>c.id==='n1')`));
    s.ok('and it says so',state.toasts.some(t=>/Nothing was moved/.test(t)),state.toasts.join(' | '));
  }

  {
    const {app,tx}=setup();
    const {run}=app;
    s.section('refusals');
    s.eq('a board link is refused',await run(`window.boardsMoveCardsTo('DST',['bl'])`),0);
    s.eq('to this same board',await run(`window.boardsMoveCardsTo('SRC',['n1'])`),0);
    s.eq('to Home',await run(`window.boardsMoveCardsTo('HOME',['n1'])`),0);
    s.eq('only locked cards',await run(`window.boardsMoveCardsTo('DST',['lk'])`),0);
    s.eq('no write for any of them',tx.calls,0);
  }

  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — notifications to the bell (js/boards.js "Notifications").

   Who is told about a comment, a reply, an assignment and a due task; that
   every row is escaped (the bell renders title and message raw); that the
   link opens the board on the card; and that a private board never leaks a
   comment into the bell of someone it is not shared with.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const USERS=[
  {u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'},
  {u:'daniyal',name:'Daniyal',role:'creator_content_ops_lead',email:'daniyal@groovy.op'},
  {u:'saim',name:'Saim',role:'designer',email:'saim@groovy.op'},
  {u:'abbas',name:'Abbas',role:'worker',email:'abbas@groovy.op'},
  {u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'}
];
const PRIV={id:'B',title:'Winter <Drop>',visibility:'personal',ownerUid:'u-mustafa',ownerUsername:'mustafa',
  sharedWith:['daniyal@groovy.op','saim@groovy.op'],sharedComment:['saim@groovy.op'],cards:[],connectors:[]};

function setup(me,extra){
  const sets=[],adds=[];
  const app=loadApp({files:['js/boards.js'],USER_DEFS:USERS,globals:Object.assign({
    doc:(db,col,id)=>({path:col+'/'+(id||'auto')}),
    setDoc:async(ref,data)=>{sets.push({path:ref.path,data});},
    addDoc:async(ref,data)=>{adds.push(data);return{id:'CMT1'};}
  },extra||{})});
  const u=USERS.find(x=>x.u===me);
  app.run(`session=${JSON.stringify({uid:'u-'+me,u:me,name:u.name,role:u.role,email:u.email})};
    moodBoards=[${JSON.stringify(PRIV)}];_editBoard=JSON.parse(JSON.stringify(moodBoards[0]));
    _boardsComments=[];currentPage='board-canvas';`);
  return{app,sets,adds};
}
const tick=()=>new Promise(r=>setTimeout(r,10));

module.exports=async function(){
  const s=suite('board-notify');

  {
    const {app}=setup('daniyal');
    const {run}=app;
    s.section('a row is escaped and links to the card');
    const row=JSON.parse(run(`JSON.stringify(_boardsNotifRow({type:'comment',forUser:'mustafa',boardId:'B',cardId:"c1');alert(1);//",title:'<img src=x>',message:'<b>hi</b>'}))`));
    s.ok('title escaped',row.title.indexOf('<img')<0&&row.title.indexOf('&lt;img')===0);
    s.ok('message escaped',row.message.indexOf('<b>')<0);
    s.eq('the link cannot break out of the onclick it is written into',row.actionUrl,'#board=B&card=c1alert1');
    s.eq('it is a Mood Boards row',row.source,'moodboards');

    s.section('who is told about a comment');
    run(`_boardsComments=[
      {id:'a',cardId:'c1',byU:'saim',byName:'Saim'},
      {id:'b',cardId:'c1',byName:'Abbas'},
      {id:'c',cardId:'c2',byU:'daniyal'},
      {id:'d',cardId:null,byName:'Afnan'}]`);
    const r=c=>run(`_boardsCommentRecipients(_editBoard,${JSON.stringify(c)},_boardsComments,'daniyal').sort().join(',')`);
    s.eq('owner + earlier authors in that card\'s thread, not me, not someone the private board is not shared with',
      r({id:'new',cardId:'c1'}),'mustafa,saim');
    s.eq('the whole-board thread is its own thread',r({id:'new',cardId:null}),'mustafa');
    s.eq('an app owner is not a reader of a private board',run(`_boardsCanReadAs(_editBoard,'afnan')`),false);
    s.eq('on a TEAM board everyone reads',run(`_boardsCanReadAs({visibility:'shared'},'abbas')`),true);
    s.eq('older comments are traced by display name',run(`_boardsCommentAuthorU({byName:'Saim'})`),'saim');
  }

  {
    const {app,sets,adds}=setup('daniyal');
    const {run}=app;
    s.section('posting a comment writes the bell rows');
    run(`_boardsComments=[{id:'a',cardId:'c1',byU:'saim',byName:'Saim'}];_boardsDrawerCard='c1';_boardsReplyTo='a';`);
    app.el('board-cmt-input').value='Looks great';
    await run(`window.boardsAddComment()`);
    await tick();
    const rows=sets.filter(x=>x.path.indexOf('hrm_notifications/')===0);
    s.eq('two people told',rows.length,2);
    const saim=rows.find(x=>x.data.forUser==='saim');
    s.ok('the author being replied to hears it AS a reply',saim&&saim.data.type==='reply'&&/replied to you/.test(saim.data.title));
    const own=rows.find(x=>x.data.forUser==='mustafa');
    s.ok('the owner hears a new comment, board title escaped',own&&own.data.type==='comment'&&own.data.title.indexOf('&lt;Drop&gt;')>0,own&&own.data.title);
    s.eq('deterministic id per comment and person',own&&own.path,'hrm_notifications/mb_cmt_CMT1_mustafa');
    s.ok('the message carries who and what',own&&own.data.message==='Daniyal: Looks great');
    s.eq('the comment itself records the username',adds[0]&&adds[0].byU,'daniyal');
  }

  {
    const {app,sets}=setup('mustafa');
    const {run}=app;
    s.section('assigning a task');
    run(`_editCards=[{id:'t1',type:'todo',items:[{text:'Book the studio',due:'2026-10-02'},{text:'x'}],x:0,y:0,w:240,h:170}];`);
    run(`window.boardsTodoSetWho('t1',0,'Daniyal')`);
    await tick();
    const rows=sets.filter(x=>x.path.indexOf('hrm_notifications/')===0);
    s.eq('the assignee is told',rows.length,1);
    s.ok('with the task, the board and the due date',rows[0]&&/Book the studio · Winter &lt;Drop&gt; · due/.test(rows[0].data.message),rows[0]&&rows[0].data.message);
    run(`window.boardsTodoSetWho('t1',0,'Daniyal')`);
    await tick();
    s.eq('assigning the same person again tells nobody',sets.filter(x=>x.path.indexOf('hrm_notifications/')===0).length,1);
    run(`window.boardsTodoSetWho('t1',1,'Mustafa')`);
    await tick();
    s.eq('assigning yourself tells nobody',sets.filter(x=>x.path.indexOf('hrm_notifications/')===0).length,1);
    run(`window.boardsTodoSetWho('t1',1,'Abbas')`);
    await tick();
    s.eq('someone who cannot open the board is not told',sets.filter(x=>x.path.indexOf('hrm_notifications/')===0).length,1);
  }

  {
    s.section('due reminders');
    const {app,sets}=setup('daniyal');
    const {run}=app;
    run(`moodBoards=[{id:'B',title:'Winter',cards:[{id:'t1',type:'todo',items:[
      {text:'late',who:'Daniyal',due:'2026-09-20'},
      {text:'today',who:'daniyal',due:'2026-09-28'},
      {text:'future',who:'Daniyal',due:'2026-10-20'},
      {text:'done',who:'Daniyal',due:'2026-09-20',done:true},
      {text:'someone else',who:'Saim',due:'2026-09-20'},
      {text:'bad date',who:'Daniyal',due:'soon'}]}]},
      {id:'X',title:'Trashed',deletedAt:1,cards:[{id:'t9',type:'todo',items:[{text:'gone',who:'Daniyal',due:'2026-09-20'}]}]}]`);
    const due=JSON.parse(run(`JSON.stringify(_boardsDueForMe(moodBoards,'Daniyal','2026-09-28').map(d=>d.it.text+':'+d.overdue))`));
    s.eq('overdue and today, mine, not done, not trashed',due.join(','),'late:true,today:false');
    run(`_boardsTodayStr=()=>'2026-09-28'`);
    run(`_boardsRaiseDueReminders()`);
    await tick();
    const rows=sets.filter(x=>x.path.indexOf('hrm_notifications/mb_due_')===0);
    s.eq('one reminder each',rows.length,2);
    s.ok('overdue is high priority',rows.some(r=>r.data.title==='Task overdue'&&r.data.priority==='high'));
    s.ok('an id per task per day',rows.every(r=>/_daniyal_2026-09-28$/.test(r.path)));
  }
  {
    const {app,sets}=setup('daniyal',{getDoc:async()=>({exists:()=>true,data:()=>({})})});
    const {run}=app;
    run(`moodBoards=[{id:'B',title:'W',cards:[{id:'t1',type:'todo',items:[{text:'late',who:'Daniyal',due:'2026-09-20'}]}]}];_boardsTodayStr=()=>'2026-09-28'`);
    run(`_boardsRaiseDueReminders()`);
    await tick();
    s.eq('a reminder already there (maybe dismissed) is not rewritten',sets.length,0);
  }

  {
    s.section('the bell\'s View opens the board');
    const app=loadApp({files:['js/shared.js','js/boards.js'],globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    app.run(`location.hash='';window._hrmNotifAction('#board=B&card=c1')`);
    s.eq('the deep link is handed to the hash',app.run('location.hash'),'#board=B&card=c1');
    let pages=[];
    app.run(`window.showPage=p=>{__p=p};__p=null;window._hrmNotifAction('hrm-advances')`);
    s.eq('an ordinary page id still routes as before',app.run('__p'),'hrm-advances');
  }

  return s;
};

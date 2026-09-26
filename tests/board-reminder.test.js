/* ─────────────────────────────────────────────────────────────────────────
   The Board — the 08:00 PKT reminder (scripts/board-reminder-plan.js and
   netlify/functions/board-reminder.js).

   What this holds:
     · "today" is Pakistan's day, at both edges of it;
     · buildReminderPlan: due today and overdue, one row per person on the
       item, nothing for done / future / undated / malformed items, a person
       with no username named rather than dropped silently;
     · the row is the client's own notification shape, escaped the way the
       bell needs, and the Board's inbox reads it;
     · runReminder against an in-memory Firestore: a second run the same
       day writes nothing (and so never re-unreads a read reminder), the
       next day an overdue item is reminded again, a dry run writes nothing;
     · the scheduled function and its 03:00 UTC schedule.
   firebase-admin is replaced through Module._load, as the seed test does.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const Module=require('module');
const {suite,loadApp,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

function fakeDb(store){
  const state={writes:0,commits:0};
  const snapOf=p=>({exists:store[p]!=null,id:p.split('/').pop(),data:()=>store[p]});
  const db={
    doc:p=>({path:p,id:p.split('/').pop(),set:async(d,opt)=>{state.writes++;
      store[p]=opt&&opt.merge?Object.assign({},store[p]||{},d):Object.assign({},d);}}),
    getAll:async(...refs)=>refs.map(r=>snapOf(r.path)),
    collection:c=>({where:(f,op,v)=>({get:async()=>{
      const docs=Object.keys(store).filter(k=>k.indexOf(c+'/')===0&&k.split('/').length===2)
        .filter(k=>op==='=='&&store[k][f]===v).map(k=>({id:k.split('/')[1],data:()=>store[k]}));
      return{forEach:fn=>docs.forEach(fn),size:docs.length};
    }})}),
    batch:()=>{const ops=[];return{set:(ref,d)=>ops.push({ref,d}),
      commit:async()=>{state.commits++;ops.forEach(o=>{state.writes++;store[o.ref.path]=Object.assign({},o.d);});}};}
  };
  return{db,state,store};
}

module.exports=async function(){
  const s=suite('board-reminder');
  const R=require('../scripts/board-reminder-plan.js');

  s.section('today is Pakistan’s day');
  s.eq('19:00 UTC is already the next day in Karachi',R.pktDay(Date.UTC(2026,8,25,19,0)),'2026-09-26');
  s.eq('18:59 UTC is still the day before',R.pktDay(Date.UTC(2026,8,25,18,59)),'2026-09-25');
  s.eq('03:00 UTC, when it runs, is 08:00 the same day',R.pktDay(Date.UTC(2026,8,26,3,0)),'2026-09-26');

  s.section('what a run owes');
  const NOW=Date.UTC(2026,8,26,3,0);            // 08:00 PKT, 26 Sep
  const names={'u-ammar':'ammar','u-afnan':'afnan','u-must':'mustafa'};
  const items=[
    {id:'due',title:'Shade list locked',status:'open',date:'2026-09-26',assigneeUids:['u-ammar','u-afnan'],ownerUid:'u-ammar',listId:'L'},
    {id:'late',title:'Walika visit',status:'open',date:'2026-09-24',assigneeUids:['u-must'],ownerUid:'u-ammar'},
    {id:'later',title:'Shoot 1',status:'open',date:'2026-10-08',assigneeUids:['u-ammar'],ownerUid:'u-ammar'},
    {id:'done',title:'Brief',status:'done',date:'2026-09-20',assigneeUids:['u-ammar'],ownerUid:'u-ammar'},
    {id:'nodate',title:'Denim bulk',status:'open',date:null,assigneeUids:['u-ammar'],ownerUid:'u-ammar'},
    {id:'junk',title:'x',status:'open',date:'soon',assigneeUids:['u-ammar'],ownerUid:'u-ammar'},
    {id:'solo',title:'Mine',status:'open',date:'2026-09-26',assigneeUids:[],ownerUid:'u-ammar'},
    {id:'ghost',title:'Nobody',status:'open',date:'2026-09-26',assigneeUids:['u-gone'],ownerUid:'u-gone'}
  ];
  const p=R.buildReminderPlan({items,usernameByUid:names,existing:{},nowMs:NOW});
  const by=id=>p.writes.filter(w=>w.data.itemId===id);
  s.eq('an item due today reminds everyone on it',J(by('due').map(w=>w.data.forUser)),J(['ammar','afnan']));
  s.eq('as due_today',J(by('due').map(w=>w.data.type)),J(['due_today','due_today']));
  s.eq('an overdue item reminds its person as overdue',J(by('late').map(w=>w.data.type+':'+w.data.forUser)),J(['overdue:mustafa']));
  s.eq('a future item is left alone',by('later').length,0);
  s.eq('a done item is left alone, however late it was',by('done').length,0);
  s.eq('an undated item is left alone',by('nodate').length,0);
  s.eq('a malformed date is left alone',by('junk').length,0);
  s.eq('an item with nobody assigned reminds its owner',J(by('solo').map(w=>w.data.forUser)),J(['ammar']));
  s.eq('a person with no username is named, not silently dropped',J(p.report.noUsername),J(['u-gone']));
  s.eq('the report counts them',J([p.report.dueToday,p.report.overdue,p.report.items]),J([3,1,3]));
  s.eq('one row per item, per person, per day',by('due')[0].id,'tb_due_today_due_u-ammar_20260926');
  s.ok('the overdue line says since when',/^Overdue since 24 Sep: /.test(by('late')[0].data.message));

  s.section('the row is the client’s own notification, escaped for the bell');
  {
    const nasty=R.buildReminderPlan({items:[{id:'x',status:'open',date:'2026-09-26',assigneeUids:['u-ammar'],visibility:'shared',
      title:'<img src=x onerror=alert(1)> & "q"'}],usernameByUid:names,nowMs:NOW}).writes[0].data;
    s.ok('the title in the message is escaped (the bell prints it raw)',
      !/<img/.test(nasty.message)&&/&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;q&quot;/.test(nasty.message));
    const long=R.buildReminderPlan({items:[{id:'y',status:'open',date:'2026-09-26',assigneeUids:['u-ammar'],visibility:'shared',
      title:'a'.repeat(100)+'&&&&&&&&&&&&&&&&&&&&'}],usernameByUid:names,nowMs:NOW}).writes[0].data;
    s.ok('cut BEFORE escaping, so no half entity is left',!/&(a|am|amp)?$/.test(long.message)&&/&amp;$/.test(long.message));
    // A PRIVATE item's title never reaches a row every signed-in account can
    // read (review of 0e6f33e, verified): the owner learns only that
    // something is due. An item with no visibility field is treated as
    // private -- the safe side.
    const priv=R.buildReminderPlan({items:[{id:'p',status:'open',date:'2026-09-26',assigneeUids:['u-ammar'],visibility:'private',
      title:'Salary talk with Mustafa'}],usernameByUid:names,nowMs:NOW}).writes[0].data;
    s.ok('a private item is reminded without its title',!/Salary/.test(priv.message)&&/private item/.test(priv.message));
    const unk=R.buildReminderPlan({items:[{id:'q',status:'open',date:'2026-09-20',assigneeUids:['u-ammar'],
      title:'No field on it'}],usernameByUid:names,nowMs:NOW}).writes[0].data;
    s.ok('so is one with no visibility field, overdue wording kept',!/No field/.test(unk.message)&&/^Overdue since 20 Sep: /.test(unk.message));
    const a=loadApp({files:['js/shared.js','js/auth.js','js/theboard.js'],
      globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
    const clientKeys=Object.keys(a.run('tbNotifPayload({})')).sort();
    const rowKeys=Object.keys(p.writes[0].data);
    s.eq('it carries every field the client’s own rows carry',clientKeys.filter(k=>rowKeys.indexOf(k)<0).join(','),'');
    s.eq('with the Board’s source, so the inbox filters it in',p.writes[0].data.source,a.run('TB_NOTIF_SOURCE'));
    a.run('session={uid:"u-ammar",u:"ammar",name:"Ammar",role:"owner",email:"ammar@groovy.op"}');
    const rows=a.run('tbInboxRows('+J([Object.assign({_id:p.writes[0].id},p.writes[0].data)])+',"ammar")');
    s.eq('and the Board’s inbox lists it',rows.length,1);
    s.ok('with its own words',/due today/.test(a.run('_TB_NOTIF_WORDS.due_today'))&&/overdue/.test(a.run('_TB_NOTIF_WORDS.overdue')));
    s.eq('a priority the bell understands, and not an alarm every morning',p.writes[0].data.priority,'normal');
  }

  s.section('a run: written once a day, again the next day while overdue');
  {
    const store={};
    items.forEach(it=>{ store['board_items/'+it.id]=Object.assign({},it); delete store['board_items/'+it.id].id; });
    Object.keys(names).forEach(u=>{ store['user_profiles/'+u]={uid:u,username:names[u]}; });
    const f=fakeDb(store);
    const dry=await R.runReminder({db:f.db,nowMs:NOW,dryRun:true});
    s.eq('a dry run writes nothing',f.state.writes,0);
    s.eq('but says what it would send',dry.dueToday+dry.overdue,4);
    const r1=await R.runReminder({db:f.db,nowMs:NOW});
    s.eq('the first run writes the four',r1.written,4);
    s.ok('and leaves a summary a person can read',f.store['board_config/reminder']&&f.store['board_config/reminder'].written===4);
    const id=R.reminderId('due_today','due','u-ammar','2026-09-26');
    f.store['hrm_notifications/'+id].readBy=['ammar'];
    const r2=await R.runReminder({db:f.db,nowMs:NOW+2*3600*1000});
    s.eq('a second run the same day writes nothing',r2.written,0);
    s.eq('and counts them as already sent',r2.alreadySent,4);
    s.eq('so a reminder already read stays read',J(f.store['hrm_notifications/'+id].readBy),J(['ammar']));
    const r3=await R.runReminder({db:f.db,nowMs:NOW+24*3600*1000});
    s.eq('the next day, what is still open and past its date is overdue for everyone on it',r3.overdue,4);
    s.eq('and nothing is due that day',r3.dueToday,0);
  }

  s.section('the scheduled function');
  {
    const fnPath=path.join(ROOT,'netlify/functions/board-reminder.js');
    const env=process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    const store={'board_items/i':{status:'open',date:R.pktDay(Date.now()),assigneeUids:['u-ammar'],title:'t'},
      'user_profiles/u-ammar':{username:'ammar'}};
    const f=fakeDb(store);
    const fakeAdmin={apps:[],initializeApp(){this.apps.push({});},credential:{cert:()=>({})},firestore:()=>f.db};
    const orig=Module._load;
    Module._load=function(req,...rest){ if(req==='firebase-admin')return fakeAdmin; return orig.call(this,req,...rest); };
    try{
      delete require.cache[fnPath];
      const fn=require(fnPath);
      s.eq('unconfigured, it says so rather than crash',(await fn.handler({})).statusCode,503);
      process.env.FIREBASE_SERVICE_ACCOUNT='{}';
      const r=await fn.handler({});
      s.eq('configured, it runs',r.statusCode,200);
      s.eq('and writes today’s reminder',JSON.parse(r.body).report.written,1);
    }finally{
      Module._load=orig;
      if(env===undefined)delete process.env.FIREBASE_SERVICE_ACCOUNT;else process.env.FIREBASE_SERVICE_ACCOUNT=env;
    }
    const toml=read('netlify.toml');
    s.ok('it is scheduled at 03:00 UTC, which is 08:00 in Pakistan',
      /\[functions\."board-reminder"\]\s*\n\s*schedule\s*=\s*"0 3 \* \* \*"/.test(toml));
    s.ok('the function body is the shared module',/require\("\.\.\/\.\.\/scripts\/board-reminder-plan\.js"\)/.test(read('netlify/functions/board-reminder.js')));
  }
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   The Board — the 08:00 PKT reminder, as ONE implementation.

   netlify/functions/board-reminder.js runs it on a schedule (03:00 UTC =
   08:00 PKT, netlify.toml). This file does NOT require firebase-admin: the
   caller hands it the Admin handles, and CI installs nothing, so the pure
   part is what tests/board-reminder.test.js reads -- the seed's shape.

   WHAT IT WRITES. For every OPEN item with a date:
     · date == today  → one `due_today` row per person on it
     · date <  today  → one `overdue`   row per person on it, EVERY day it
                        stays overdue (the approved plan: "deduped per item
                        per day", not "once")
   into hrm_notifications, the collection the app's bell and The Board's
   inbox both read, in exactly the shape the client's tbNotifPayload
   writes (source 'tb', forUser = USERNAME, title/message HTML-escaped
   because the bell renders both raw).

   DEDUPED PER ITEM, PER PERSON, PER DAY BY ID. A row's id is
   tb_<type>_<itemId>_<uid>_<YYYYMMDD>, and a run writes only the ids that
   do not exist yet -- so a second run the same day (a retry, a manual
   trigger) adds nothing and never marks a read reminder unread again.

   "TODAY" IS PAKISTAN'S. Asia/Karachi is UTC+5 with no daylight saving,
   so the day is the UTC clock moved five hours -- the one place in this
   module a UTC ISO string is the right tool, because the offset is applied
   explicitly first. (The client's _tbDay uses the browser's local clock;
   a server has no local clock worth trusting.)
   ───────────────────────────────────────────────────────────────────────── */
'use strict';

const TB_NOTIF_SOURCE='tb';
const PKT_OFFSET_MS=5*60*60*1000;
const RUN_PATH='board_config/reminder';

/** 'YYYY-MM-DD' in Pakistan for a UTC instant. Pure. */
function pktDay(nowMs){
  return new Date(Number(nowMs)+PKT_OFFSET_MS).toISOString().slice(0,10);
}
const VALID_DAY=/^\d{4}-\d{2}-\d{2}$/;

/** The same escaping the client applies before the bell prints raw HTML. */
function esc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const clean=s=>String(s==null?'':s).replace(/[^A-Za-z0-9_-]/g,'');
/** One reminder per item, per person, per PKT day. Pure. */
function reminderId(type,itemId,uid,day){
  return'tb_'+clean(type)+'_'+clean(itemId)+'_'+clean(uid)+'_'+String(day).replace(/-/g,'');
}
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDay(day){
  const p=String(day).split('-');
  return Number(p[2])+' '+(MONTHS[Number(p[1])-1]||'');
}

/**
 * Every reminder a run owes today, and the report it returns. PURE.
 *   items          [{id, ...board_items data}]  -- the open ones
 *   usernameByUid  { uid: 'ammar', … }           -- from user_profiles
 *   existing       { rowId: true }               -- reminder rows already there
 *   nowMs          the run's instant
 */
function buildReminderPlan(o){
  const items=(o&&o.items)||[];
  const names=(o&&o.usernameByUid)||{};
  const existing=(o&&o.existing)||{};
  const now=Number((o&&o.nowMs)||0);
  const today=pktDay(now);
  const writes=[];
  const report={day:today,dueToday:0,overdue:0,alreadySent:0,items:0,noUsername:[]};
  items.forEach(it=>{
    if(!it||it.status==='done'||!VALID_DAY.test(String(it.date||'')))return;
    if(it.date>today)return;
    const type=it.date===today?'due_today':'overdue';
    const who=(Array.isArray(it.assigneeUids)&&it.assigneeUids.length)?it.assigneeUids
      :(it.ownerUid?[it.ownerUid]:[]);
    let any=false;
    who.filter((u,i,a)=>u&&a.indexOf(u)===i).forEach(uid=>{
      const handle=names[uid];
      if(!handle){ if(report.noUsername.indexOf(uid)<0)report.noUsername.push(uid); return; }
      const id=reminderId(type,it.id,uid,today);
      if(existing[id]){ report.alreadySent++; return; }
      // A PRIVATE item's title never goes into the row: hrm_notifications
      // is readable by every signed-in account, Board or not (review of
      // 0e6f33e, verified). The owner still learns something is due.
      const title=it.visibility==='shared'?String(it.title||'untitled'):null;
      writes.push({id:id,data:{
        source:TB_NOTIF_SOURCE,type:type,forUser:String(handle),fromUid:'',
        itemId:String(it.id),listId:it.listId?String(it.listId):null,
        title:esc('The Board'),
        // Cut THEN escape, as the client does: escaping first and cutting
        // after can leave half an entity (&am) for the bell to print.
        message:esc(((type==='due_today'?'Due today: ':'Overdue since '+shortDay(it.date)+': ')
          +(title==null?'one of your private items':'“'+title+'”')).slice(0,120)),
        actionUrl:'tb-dash',priority:'normal',readBy:[],createdAt:now,reminderDay:today
      }});
      report[type==='due_today'?'dueToday':'overdue']++;
      any=true;
    });
    if(any)report.items++;
  });
  return{writes:writes,report:report,today:today};
}

/**
 * The run: read the open items and the usernames of the people on them,
 * see which of today's rows exist, write the rest. `db` is the Admin
 * Firestore handle. `dryRun` writes nothing and returns the same report.
 * A summary goes to board_config/reminder so a person can see the last
 * run without the Netlify console.
 */
async function runReminder(o){
  const db=o.db,now=Number(o.nowMs||Date.now());
  const snap=await db.collection('board_items').where('status','==','open').get();
  const items=[];
  snap.forEach(d=>items.push(Object.assign({id:d.id},d.data())));
  const uids=[];
  items.forEach(it=>{
    const who=(Array.isArray(it.assigneeUids)&&it.assigneeUids.length)?it.assigneeUids:(it.ownerUid?[it.ownerUid]:[]);
    who.forEach(u=>{ if(u&&uids.indexOf(u)<0)uids.push(u); });
  });
  const usernameByUid={};
  for(let i=0;i<uids.length;i+=100){
    const refs=uids.slice(i,i+100).map(u=>db.doc('user_profiles/'+u));
    (await db.getAll(...refs)).forEach(s=>{
      const u=s.exists?(s.data()||{}).username:null;
      if(u)usernameByUid[s.id]=String(u);
    });
  }
  // What today's rows WOULD be, to see which already exist.
  const draft=buildReminderPlan({items,usernameByUid,existing:{},nowMs:now});
  const existing={};
  const ids=draft.writes.map(w=>w.id);
  for(let i=0;i<ids.length;i+=100){
    const refs=ids.slice(i,i+100).map(id=>db.doc('hrm_notifications/'+id));
    (await db.getAll(...refs)).forEach(s=>{ if(s.exists)existing[s.id]=true; });
  }
  const plan=buildReminderPlan({items,usernameByUid,existing,nowMs:now});
  if(!o.dryRun){
    for(let i=0;i<plan.writes.length;i+=400){
      const b=db.batch();
      plan.writes.slice(i,i+400).forEach(w=>b.set(db.doc('hrm_notifications/'+w.id),w.data));
      await b.commit();
    }
    await db.doc(RUN_PATH).set({lastRunAt:now,day:plan.today,written:plan.writes.length,
      dueToday:plan.report.dueToday,overdue:plan.report.overdue,alreadySent:plan.report.alreadySent,
      noUsername:plan.report.noUsername},{merge:true});
  }
  return Object.assign({dryRun:!!o.dryRun,written:o.dryRun?0:plan.writes.length},plan.report);
}

module.exports={TB_NOTIF_SOURCE,RUN_PATH,pktDay,reminderId,esc,buildReminderPlan,runReminder};

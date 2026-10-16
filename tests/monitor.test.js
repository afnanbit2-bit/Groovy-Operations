/* ─────────────────────────────────────────────────────────────────────────
   Monitor — js/activity.js, the owner-only oversight page.

   Written for the Sept 2026 change that turned the watched PERSON from a
   single name into a list, because CLAUDE.md warned that "several places
   assume that" — seven call sites, each of which reads correctly with one
   watched person and silently stops flagging the second.

   What is worth guarding here:
   - a watched row needs BOTH the right person and a watched action;
   - matching works by username (what logActivity writes now) AND by
     display name (every row written before it did);
   - an action that is merely similar is not flagged;
   - the categoriser puts a removal under Delete, not under Money;
   - the page actually renders the flag it computed.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const LS={getItem:()=>null,setItem(){},removeItem(){}};
const J=v=>JSON.stringify(v);

function app(){
  return harness.loadApp({
    files:['js/shared.js','js/auth.js','js/activity.js'],
    currentPage:'monitor',
    session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
    globals:{localStorage:LS}
  });
}

module.exports=async function(){
  const s=suite('monitor');
  const a=app();

  s.section('the watch list is a list of people');
  {
    const watched=a.run('_MONITOR_WATCH_USERS');
    // Changed deliberately (QC reconciliation, Oct 2026): faizan joined, for the QC removal/override verbs only.
    s.eq('three people are watched',J(watched),J(['mustafa','daniyal','faizan']));
    const defs=a.run('USER_DEFS');
    watched.forEach(u=>s.ok('"'+u+'" is a real account',defs.some(d=>d.u===u)));
    s.ok('none is an owner — the panel is for delegated power',
      watched.every(u=>(defs.find(d=>d.u===u)||{}).role!=='owner'));
    const label=a.run('_monitorWatchLabel()');
    s.ok('the heading names both',/Mustafa/.test(label)&&/Daniyal/.test(label));
    s.ok('and Faizan',/Faizan/.test(label));
    s.ok('joined readably',/ and /.test(label));
  }

  s.section('what gets the red marker');
  {
    const w=r=>a.run('_monitorIsWatched('+J(r)+')');
    s.eq('a watched action by a watched person',w({u:'mustafa',user:'Mustafa',action:'Payslip paid'}),true);
    s.eq('and by the second one',w({u:'daniyal',user:'Daniyal Tufail',action:'Dispatch deleted'}),true);
    s.eq('an ordinary action by a watched person is not flagged',w({u:'daniyal',action:'Dispatch logged'}),false);
    s.eq('nor is editing one',w({u:'daniyal',action:'Dispatch updated'}),false);
    s.eq('a watched action by anyone else is not flagged',w({u:'afnan',user:'Afnan',action:'Dispatch deleted'}),false);
    s.eq('a row with no person at all is not flagged',w({action:'Dispatch deleted'}),false);
    s.eq('and neither is nothing',w(null),false);
    // Rows written before logActivity carried `u` only have the name.
    s.eq('an old row matches on the display name',w({user:'Mustafa',action:'Loan created'}),true);
    s.eq('a name that is not an account does not',w({user:'Somebody',action:'Loan created'}),false);
    // Every Marketing removal, and nothing else from that module.
    ['Dispatch deleted','Creator deleted','Paid PR request withdrawn','Niche tag removed']
      .forEach(act=>s.eq('"'+act+'" is watched',w({u:'daniyal',action:act}),true));
    ['Creator added','Creator updated','Paid PR approved','Niche tag renamed','Dispatch performance captured']
      .forEach(act=>s.eq('"'+act+'" is not',w({u:'daniyal',action:act}),false));
  }

  s.section('categories');
  {
    const cat=x=>a.run('_monitorCategorize('+J(x)+').key');
    s.eq('a delete is a delete',cat('Dispatch deleted'),'delete');
    // A withdrawal is a removal. It contains the word "Paid", so without
    // /withdraw/ in the delete matcher it lands under Approve / Money —
    // which is checked second, and would have hidden it among approvals.
    s.eq('so is a withdrawal',cat('Paid PR request withdrawn'),'delete');
    s.eq('an approval is still money',cat('Paid PR approved'),'money');
    s.eq('a payment too',cat('Paid PR payment logged'),'money');
    // Every Marketing verb had been falling into the Process fallback since
    // M2 — nobody ran the sanity-check CLAUDE.md asks for when a new verb
    // appears. Checked by categorising all 126 logActivity strings in
    // js/*.js before and after: exactly 8 moved, all of them out of `other`.
    s.eq('logging a dispatch is a create',cat('Dispatch logged'),'create');
    s.eq('editing one is an edit',cat('Dispatch updated'),'edit');
    s.eq('capturing performance is a create',cat('Dispatch performance captured'),'create');
    s.eq('a creator edit is an edit',cat('Creator updated'),'edit');
    s.eq('so is a profile one',cat('Profile updated'),'edit');
    // Inventory Intel Ignore (Oct 2026): both verbs fell into Process; they are edits. The category check was run over every logActivity
    // string in js/*.js before and after: only these two moved, and 'Mood board restored' stays where it was.
    s.eq('an ignore is an edit',cat('Article ignored'),'edit');
    s.eq('so is a restore of one',cat('Article restored'),'edit');
    s.eq('another module\'s restore is untouched',cat('Mood board restored'),'other');
    s.eq('and a bulk Instagram fetch',cat('Creators fetched from Instagram'),'edit');
    // Genuinely process-shaped actions stay in the fallback — the bucket is
    // not a bug, and widening the verbs must not swallow them.
    s.eq('a stage step is still Process',cat('Stage done'),'other');
    s.eq('and a QC disposition',cat('QC disposition'),'other');
    s.eq('a login is a login',cat('Login'),'auth');
  }

  s.section('QC reconciliation verbs (Oct 2026): categories');
  {
    const cat=x=>a.run('_monitorCategorize('+J(x)+').key');
    // Table: verb -> bucket. Before this change all eight were Process.
    const want={
      'QC lot received':'create',
      'QC lot voided':'delete',
      'QC cut locked':'other',
      'QC PO closed':'other',
      'QC PO closed with shortfall':'edit',
      'QC cut relocked':'edit',
      'QC PO reopened':'edit',
      'QC legacy receipts adopted':'create'
    };
    Object.keys(want).forEach(v=>s.eq('"'+v+'" -> '+want[v],cat(v),want[v]));
    // The patterns are anchored to the QC verbs. Generic words would have
    // dragged other modules' verbs along (checked: both sat in Process).
    s.eq('another module\'s void is untouched',cat('Warehouse sale voided'),'other');
    s.eq('another module\'s reopen is untouched',cat('Bug reopened (verify failed)'),'other');
    s.eq('a longer QC string is not caught by the anchors',cat('QC lot voided again'),'other');
    s.eq('QC Report submitted is still a create',cat('QC Report submitted'),'create');
    s.eq('QC rework resolved is still Process',cat('QC rework resolved'),'other');
    s.eq('QC disposition is still Process',cat('QC disposition'),'other');
  }

  s.section('QC reconciliation verbs: who is flagged');
  {
    const w=r=>a.run('_monitorIsWatched('+J(r)+')');
    // The QC person: removals and overrides only.
    ['QC lot voided','QC PO closed with shortfall','QC cut relocked','QC PO reopened']
      .forEach(act=>s.eq('faizan "'+act+'" is flagged',w({u:'faizan',user:'Faizan',action:act}),true));
    ['QC lot received','QC cut locked','QC PO closed','QC legacy receipts adopted']
      .forEach(act=>s.eq('faizan "'+act+'" is NOT flagged',w({u:'faizan',user:'Faizan',action:act}),false));
    s.eq('faizan\'s other work is not flagged',w({u:'faizan',user:'Faizan',action:'Packing receipt'}),false);
    // One shared action set (the existing design): a watched person is flagged on ANY listed action. Faizan cannot
    // log these Marketing verbs in practice; this documents the consequence rather than endorsing it.
    s.eq('the set is shared: faizan + a Marketing removal would be flagged',w({u:'faizan',action:'Dispatch deleted'}),true);
    // The watched person is who is flagged: an owner doing the same override is not.
    ['QC lot voided','QC PO closed with shortfall','QC cut relocked','QC PO reopened']
      .forEach(act=>{
        s.eq('afnan "'+act+'" is not flagged',w({u:'afnan',user:'Afnan',action:act}),false);
        s.eq('ammar "'+act+'" is not flagged',w({u:'ammar',user:'Ammar',action:act}),false);
      });
    s.eq('haris (QC manager) is not watched',w({u:'haris',user:'Haris',action:'QC lot voided'}),false);
    // Existing watches unchanged.
    s.eq('mustafa Payslip paid still flagged',w({u:'mustafa',user:'Mustafa',action:'Payslip paid'}),true);
    s.eq('mustafa Fabric roll deleted still flagged',w({u:'mustafa',action:'Fabric roll deleted'}),true);
    s.eq('daniyal Dispatch deleted still flagged',w({u:'daniyal',action:'Dispatch deleted'}),true);
    s.eq('daniyal Dispatch logged still not',w({u:'daniyal',action:'Dispatch logged'}),false);
    s.eq('mustafa QC lot received is not flagged',w({u:'mustafa',action:'QC lot received'}),false);
    // Username first, display name only for rows with no `u`.
    s.eq('old row, display name only: Faizan + void is flagged',w({user:'Faizan',action:'QC lot voided'}),true);
    s.eq('old row, display name only: Faizan + lot received is not',w({user:'Faizan',action:'QC lot received'}),false);
    s.eq('username wins over a matching display name',w({u:'afnan',user:'Faizan',action:'QC lot voided'}),false);
    s.eq('a name that is not an account is not flagged',w({user:'Somebody',action:'QC lot voided'}),false);
    // The set is exactly the four QC overrides plus the existing ones.
    const set=a.run('Array.from(_MONITOR_WATCH_ACTIONS)');
    s.eq('exactly 4 QC verbs are in the watch set',set.filter(x=>/^QC /.test(x)).length,4);
    s.eq('the watch set grew by exactly 4',set.length,21);
  }

  s.section('QC verbs in the rendered Monitor (detail is escaped)');
  {
    const t=app();
    const now=Date.now();
    t.run('_monitorItems='+J([
      {_id:'1',user:'Faizan',u:'faizan',action:'QC lot voided',detail:'LOT-1 <img src=x onerror=alert(1)>',ts:now},
      {_id:'2',user:'Faizan',u:'faizan',action:'QC lot received',detail:'LOT-2 · PO-105 · 40',ts:now},
      {_id:'3',user:'Afnan',u:'afnan',action:'QC PO closed with shortfall',detail:'PO-105',ts:now}
    ])+';_monitorLoaded=true;_monitorFilter={preset:"all",from:"",to:""}');
    t.run('_renderMonitorPage()');
    const page=t.el('main-content').innerHTML;
    s.ok('the watched panel shows',/Recent watched activity/.test(page));
    s.ok('exactly one watched row (the void)',/>1<\/div>\s*<div[^>]*>Watched \(/.test(page));
    s.ok('the heading names Faizan',/Faizan/.test(page.split('Recent watched activity')[1]||''));
    s.ok('the detail is escaped, never live markup',!/<img src=x/.test(page)&&/&lt;img src=x/.test(page));
    t.run('_monitorPerson="Faizan";_monitorExpanded=new Set(["1","2"]);_renderMonitorPage()');
    const dd=t.el('main-content').innerHTML;
    s.ok('drilldown: the void sits under Delete',/Delete<\/span>[\s\S]*QC lot voided/.test(dd));
    s.ok('drilldown: the lot received sits under Create',/Create<\/span>[\s\S]*QC lot received/.test(dd));
    s.ok('drilldown: only the void carries the flag',(dd.match(/⚠ <\/span>/g)||[]).length===1);
    s.ok('drilldown: detail escaped there too',!/<img src=x/.test(dd));
  }

  s.section('the page renders what it computed');
  {
    const t=app();
    const now=Date.now();
    t.run('_monitorItems='+J([
      {_id:'1',user:'Daniyal Tufail',u:'daniyal',action:'Dispatch deleted',detail:'@saritas · 2 Sep',ts:now},
      {_id:'2',user:'Mustafa',u:'mustafa',action:'Payslip paid',detail:'Ali',ts:now},
      {_id:'3',user:'Daniyal Tufail',u:'daniyal',action:'Dispatch logged',detail:'@saritas',ts:now},
      {_id:'4',user:'Afnan',u:'afnan',action:'Dispatch deleted',detail:'@nightf',ts:now}
    ])+';_monitorLoaded=true;_monitorFilter={preset:"all",from:"",to:""}');
    t.run('_renderMonitorPage()');
    const page=t.el('main-content').innerHTML;
    s.ok('the watched panel is shown',/Recent watched activity/.test(page));
    s.ok('naming both watched people',/Mustafa/.test(page)&&/Daniyal/.test(page));
    // Two watched rows: Daniyal's delete and Mustafa's payslip. Afnan's
    // delete is an owner's and is not watched; Daniyal's log is ordinary.
    // The tile puts its number ABOVE its label, so read them in that order.
    s.ok('the count is two, not four',/>2<\/div>\s*<div[^>]*>Watched \(/.test(page));
    s.ok('an owner deleting is not flagged',!/Afnan[\s\S]{0,200}⚠/.test(page));
  }
  {
    // Nothing watched → no panel, and no crash on an empty list.
    const t=app();
    t.run('_monitorItems='+J([{_id:'1',user:'Afnan',u:'afnan',action:'Login',ts:Date.now()}])
      +';_monitorLoaded=true;_monitorFilter={preset:"all",from:"",to:""}');
    t.run('_renderMonitorPage()');
    const page=t.el('main-content').innerHTML;
    s.ok('no watched panel when nothing is flagged',!/Recent watched activity/.test(page));
    s.ok('the page still renders',/Monitor/.test(page)&&/Afnan/.test(page));
  }
  {
    // The dashboard widget reads the same predicate.
    const t=app();
    const src=require('fs').readFileSync(require('path').join(harness.ROOT,'js','activity.js'),'utf8');
    s.eq('nothing still reads a single watched name',(src.match(/_MONITOR_WATCH_USER\b/g)||[]).length,0);
    // Named rather than counted: a count also matches the name inside a
    // comment, which is the mistake the boards helper scan already
    // recorded — a rewording of prose would fail a count for no reason.
    [/rangeItems\.filter\(_monitorIsWatched\)/,   // the watched panel
     /actions\.filter\(_monitorIsWatched\)/,      // a person's card count
     /const flagged=_monitorIsWatched\(a\)/,       // the drilldown row
     /items\.filter\(_monitorIsWatched\)/         // the dashboard widget
    ].forEach((re,i)=>s.ok('flag site '+(i+1)+' goes through the one predicate',re.test(src)));
    s.eq('and none of them re-derives it inline',(src.match(/_MONITOR_WATCH_ACTIONS\.has\(/g)||[]).length,1);
  }

  s.section('QC verbs: the writers and the Monitor read the same strings (no drift)');
  {
    // Read the QC strings the writers actually log, out of their source:
    // every 'QC ...' literal inside a _phLog(...) call (the close call picks
    // one of two with a ternary, so both literals are read).
    const fs=require('fs'),path=require('path');
    const logged=new Set();
    ['ph-qc-write.js','ph-write.js'].forEach(f=>{
      const src=fs.readFileSync(path.join(harness.ROOT,'js',f),'utf8');
      const re=/_phLog\(([^\n]*)/g;let m;
      while((m=re.exec(src))){
        const lits=m[1].match(/'QC [^']*'/g)||[];
        lits.forEach(l=>logged.add(l.slice(1,-1)));
      }
    });
    const want={
      'QC lot received':['create',false],
      'QC lot voided':['delete',true],
      'QC cut locked':['other',false],
      'QC PO closed':['other',false],
      'QC PO closed with shortfall':['edit',true],
      'QC cut relocked':['edit',true],
      'QC PO reopened':['edit',true],
      'QC legacy receipts adopted':['create',false]
    };
    s.eq('the writers log exactly the eight QC verbs',J(Array.from(logged).sort()),J(Object.keys(want).sort()));
    const cat=x=>a.run('_monitorCategorize('+J(x)+').key');
    const w=x=>a.run('_monitorIsWatched('+J({u:'faizan',user:'Faizan',action:x})+')');
    Array.from(logged).forEach(v=>{
      const exp=want[v];
      s.ok('logged verb "'+v+'" is one the Monitor knows',!!exp);
      if(!exp)return;
      s.eq('logged verb "'+v+'" is categorised '+exp[0],cat(v),exp[0]);
      s.eq('logged verb "'+v+'" watched='+exp[1],w(v),exp[1]);
    });
  }

  return s;
};

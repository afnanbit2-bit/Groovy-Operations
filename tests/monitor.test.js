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
    s.eq('two people are watched',J(watched),J(['mustafa','daniyal']));
    const defs=a.run('USER_DEFS');
    watched.forEach(u=>s.ok('"'+u+'" is a real account',defs.some(d=>d.u===u)));
    s.ok('neither is an owner — the panel is for delegated power',
      watched.every(u=>(defs.find(d=>d.u===u)||{}).role!=='owner'));
    const label=a.run('_monitorWatchLabel()');
    s.ok('the heading names both',/Mustafa/.test(label)&&/Daniyal/.test(label));
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
    s.eq('and a bulk Instagram fetch',cat('Creators fetched from Instagram'),'edit');
    // Genuinely process-shaped actions stay in the fallback — the bucket is
    // not a bug, and widening the verbs must not swallow them.
    s.eq('a stage step is still Process',cat('Stage done'),'other');
    s.eq('and a QC disposition',cat('QC disposition'),'other');
    s.eq('a login is a login',cat('Login'),'auth');
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

  return s;
};

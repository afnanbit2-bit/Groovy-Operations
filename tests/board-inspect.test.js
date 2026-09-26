/* ─────────────────────────────────────────────────────────────────────────
   scripts/board-inspect.js — the decisions, without a database.

   The script itself needs firebase-admin and live credentials (or the
   emulator), which CI does not have. What it DECIDES is pure and held here:
     · the write probe's verdict -- a writer is REFUSED, a reader runs, and
       anything unclassifiable is refused rather than guessed;
     · the seed check -- what "counted open for everyone" means, which is
       the whole of the 39-vs-42 question;
     · the counts and the markdown.
   The run itself was driven against the Firestore emulator (BOARD-LOG.md,
   QA-B): that is where the reserved-id probe bug was found.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const path=require('path');
const {suite}=require('./harness');
const I=require(path.join(__dirname,'..','scripts','board-inspect.js'));

module.exports=async function(){
  const s=suite('board-inspect');

  s.section('the write probe decides whether it may run at all');
  {
    s.eq('a refused write (a read-only credential) runs',I.probeVerdict({code:7,message:'7 PERMISSION_DENIED: Missing or insufficient permissions.'}).run,true);
    s.eq('…and so does the string form of that code',I.probeVerdict({code:'permission-denied'}).run,true);
    s.eq('NOT_FOUND means the credential could write: REFUSED',I.probeVerdict({code:5,message:'5 NOT_FOUND: No document to update'}).run,false);
    s.ok('and it says what to use instead',/datastore\.viewer/.test(I.probeVerdict({code:5}).why));
    s.eq('a probe that succeeded wrote something: REFUSED',I.probeVerdict(null).run,false);
    // The first version probed `__inspect_probe__`, a RESERVED id: every
    // credential got INVALID_ARGUMENT. Unclassifiable is refused, never
    // waved through.
    s.eq('anything else is refused rather than guessed',
      I.probeVerdict({code:3,message:'3 INVALID_ARGUMENT: Resource id "__inspect_probe__" is invalid because it is reserved.'}).run,false);
    s.eq('an auth failure too',I.probeVerdict({code:16,message:'16 UNAUTHENTICATED'}).run,false);
    const src=require('fs').readFileSync(path.join(__dirname,'..','scripts','board-inspect.js'),'utf8');
    s.ok('the probe id is not a reserved __x__ id',!/doc\('[^']*__[a-z_]+__/.test(src));
    s.ok('and is random per run, so it can never name a document that exists',/inspect-probe-'\+require\('crypto'\)\.randomUUID\(\)/.test(src));
    s.ok('and it is an update(), which never creates a document',/inspect-probe-[^;]*\.update\(/.test(src));
  }

  s.section('the seed check: what "counted open" means');
  {
    const rows=[{id:'a',title:'A',date:'2026-09-27'},{id:'b',title:'B',date:'2026-09-28'},
      {id:'c',title:'C',date:'2026-09-29'},{id:'d',title:'D',date:'2026-09-30'},{id:'e',title:'E',date:'2026-10-01'},
      {id:'f',title:'F',date:'2026-10-02'}];
    const L='tbl';
    const docs={
      a:{listId:L,status:'open',visibility:'shared',date:'2026-09-28',ownerUid:'u1'},   // moved
      b:{listId:L,status:'done',visibility:'shared',date:'2026-09-28'},
      c:{listId:L,status:'open',visibility:'private',date:'2026-09-29',ownerUid:'u2'},
      e:{listId:'other',status:'open',visibility:'shared',date:'2026-10-01'}
    };
    const r=I.seedCheck(rows,docs,{itemIds:['a','b','c','d','e']},L);
    const by=id=>r.filter(x=>x.id===id)[0];
    s.eq('a shared, open item is counted',by('a').countedOpen,true);
    s.eq('and it knows it moved',by('a').moved,true);
    s.eq('a done item is not counted',by('b').countedOpen,false);
    s.eq('and says done',by('b').state,'done');
    s.eq('a PRIVATE item is not counted -- nobody but its owner loads it',by('c').countedOpen,false);
    s.ok('and says so, with its owner',/private/.test(by('c').state)&&by('c').owner==='u2');
    s.eq('a seeded id on the record with no document was deleted',by('d').state,'DELETED since seeding');
    s.ok('an item in another list is named as moved there',/moved to another list/.test(by('e').state)&&!by('e').countedOpen);
    s.eq('a seeded id never on the record was never written',by('f').state,'never written');
    s.eq('one of six counted open',r.filter(x=>x.countedOpen).length,1);
    s.eq('a missing record is not an error',I.seedCheck(rows,{},null,L).filter(x=>x.state==='never written').length,6);
  }

  s.section('counts and tables');
  {
    const c=I.countsFor([{status:'open',date:'2026-10-01',visibility:'shared',kind:'gate',lane:'denim'},
      {status:'done',date:null,visibility:'private',kind:'task'},{status:'open',visibility:'shared',kind:'task',lane:'denim',qa:true}]);
    s.eq('open and done',[c.open,c.done].join(),'2,1');
    s.eq('undated',c.undated,2);
    s.eq('shared / private',c.shared+'/'+c.private,'2/1');
    s.eq('by kind',JSON.stringify(c.byKind),'{"gate":1,"task":2}');
    s.eq('by lane, with no lane named',JSON.stringify(c.byLane),'{"denim":2,"(none)":1}');
    s.eq('qa items counted apart',c.qa,1);
    const lists=[{id:'tbl_winter_drop_2027',title:'Winter Drop 2027'},{id:'x',title:'Winter shoot'},{id:'y',title:'QA Sandbox'}];
    s.eq('a project by exact id',I.pickLists(lists,'y').map(l=>l.id).join(),'y');
    s.eq('by part of the title, any case',I.pickLists(lists,'WINTER').length,2);
    s.eq('no argument is every project',I.pickLists(lists,undefined).length,3);
    const t=I.mdTable(['a','b'],[['x|y','line1\nline2'],[null,3]]);
    s.eq('a markdown table',t,'| a | b |\n|---|---|\n| x\\|y | line1 line2 |\n|  | 3 |');
  }
  return s;
};

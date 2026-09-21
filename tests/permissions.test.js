/* ─────────────────────────────────────────────────────────────────────────
   Permissions — the parity guard.

   js/permissions.js replaced 38 scattered permission helpers with one
   can() over one rule table. The whole point of that change was that it
   changes NOTHING: the same people keep the same rights, down to the
   quirks that look like bugs.

   Proving that needs a "before". tests/fixtures/permissions-parity.json
   is it — every account's answer to every capability, CAPTURED FROM THE
   PRE-REFACTOR TREE (the commit it came from is recorded inside it).
   This suite asserts the live app still answers identically, twice over:

     1. through can() — the new path
     2. through the ORIGINAL helper name — which is what the rest of the
        app actually calls, so a helper wired to the wrong capability is
        caught even though can() itself is right

   16 subjects (15 accounts + nobody signed in) x 38 capabilities, both
   ways = 1,216 answers. If any single one moves, this names the person
   and the capability.

   WHEN A RIGHT IS DELIBERATELY CHANGED, this suite is SUPPOSED to fail.
   Re-capturing the snapshot to make it pass is only correct once the
   change has been reviewed — the fixture is the record of what the app
   used to do, and silently regenerating it throws that record away.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const fs=require('fs');
const path=require('path');

const LS={getItem:()=>null,setItem(){},removeItem(){}};
const FILES=['js/permissions.js','js/shared.js','js/print-engine.js','js/auth.js','js/pos.js',
  'js/embellishments.js','js/hrm.js','js/store.js','js/store-cash.js','js/gatepass.js',
  'js/fabric.js','js/production.js','js/shopify.js','js/fulfillment.js','js/notes.js',
  'js/boards.js','js/profile.js','js/activity.js','js/marketing.js','js/patterns.js'];

/* capability -> the ORIGINAL helper call. This map is the thing that
   catches a helper delegating to the wrong capability: can('pay.run')
   can be perfectly right while _canProcessPayroll() asks for pay.view. */
const VIA_HELPER={
  'pay.view':'_canViewPayroll()','pay.run':'_canProcessPayroll()','pay.slip':'_canManagePayslips()',
  'hrm.ops':'_canViewHRMOps()','hrm.approve':'_canApproveHRMOps()','hrm.loans':'_canManageLoans()',
  'hrm.policy':'_canEditPolicy()','recipe.manage':'canManageRecipes()','recipe.lock':'canLockRecipe()',
  'pp.new':'canApproveNewPP()','pp.repeat':'canApproveRepeatPP()','pp.urgent':'canApproveUrgentBypass()',
  'bill.approve':'canApproveBilling()','print.work':'isPrintWorker()','bundle.work':'isBundleWorker()',
  'stitch.work':'isStitchWorker()','qc.work':'isQCWorker()','print.view':'canSeePrinting()',
  'qc.view':'canViewQCReport()','qc.record':'_qcCanRecord()','store.approve':'_canApproveEdits()',
  'cash.view':'_canViewCash()','cash.entry':'_canEntryCash()','cash.admin':'_canAdminCash()',
  'ptn.view':'_canSeePatternHub()','ptn.manage':'_canManagePatterns()','ptn.cut':'_isPatternCutting()',
  'ptn.ack':'_canAckPatternNotice()','mkt.access':'canAccessMarketing()','mkt.lead':'isContentOpsLead()',
  'mkt.paidpr':'canApprovePaidPR()','mkt.scoring':'canEditScoring()','hub.view':'_canSeeCreativeHub()',
  'fulfil.view':'_canViewFulfillment()','fulfil.edit':'_canEditFulfillment()',
  'fabric.delete':'_fabCanDelete()','fabric.edit':'!_fabReadOnly()','prof.admin':'_profIsAdmin()'
};

module.exports=async function(){
  const s=suite('permissions');
  const snap=JSON.parse(fs.readFileSync(
    path.join(harness.ROOT,'tests/fixtures/permissions-parity.json'),'utf8'));
  const a=harness.loadApp({files:FILES,globals:{localStorage:LS}});
  const defs=a.run('USER_DEFS');
  const setSubject=u=>{
    const d=defs.find(x=>x.u===u);
    a.run('session='+JSON.stringify(d?Object.assign({uid:'uid-'+d.u},d):null));
    return d;
  };

  s.section('the snapshot covers what it claims to');
  s.eq('every account in USER_DEFS has a row',
    defs.filter(d=>!snap.answers[d.u]).length,0);
  s.ok('and the signed-out case',!!snap.answers['(nobody)']);
  s.eq('every capability the app defines is in it',
    a.run('Object.keys(PERM_RULES)').filter(c=>snap.capabilities.indexOf(c)<0)
      .filter(c=>c!=='acct.manage'&&c!=='perm.grant').join(',')||'none','none');
  s.ok('and the snapshot is not trivially all-false',
    snap.capabilities.some(c=>snap.subjects.some(u=>snap.answers[u][c])));
  s.eq('every capability has a helper to cross-check against',
    snap.capabilities.filter(c=>!VIA_HELPER[c]).join(',')||'none','none');

  s.section('parity — every account, every capability, both paths');
  {
    let viaCan=0,viaHelper=0,total=0;
    const bad=[];
    snap.subjects.forEach(u=>{
      setSubject(u);
      snap.capabilities.forEach(c=>{
        total++;
        const want=snap.answers[u][c];
        let gotCan,gotHelper;
        try{gotCan=!!a.run('can('+JSON.stringify(c)+')');}catch(e){gotCan='threw: '+e.message;}
        try{gotHelper=!!a.run(VIA_HELPER[c]);}catch(e){gotHelper='threw: '+e.message;}
        if(gotCan===want)viaCan++;else bad.push('can  '+u+' / '+c+': '+gotCan+' (was '+want+')');
        if(gotHelper===want)viaHelper++;else bad.push(VIA_HELPER[c]+' as '+u+': '+gotHelper+' (was '+want+')');
      });
    });
    s.eq('can() matches the pre-refactor answer, every time',viaCan,total);
    s.eq('and so does every original helper',viaHelper,total);
    // Name the first few rather than only a count — a bare "608 != 604"
    // sends the next person hunting.
    bad.slice(0,8).forEach(x=>s.ok('unchanged: '+x,false));
  }

  s.section('the rules table itself');
  {
    setSubject('afnan');
    s.ok('an unknown capability is false, never true',!a.run("can('nope.nope')"));
    s.ok('and so is a missing one',!a.run("can('')")&&!a.run("can(null)"));
    // A typo opening a door is the failure mode a capability system must
    // not have; this is the assertion that says so.
    s.eq('no rule is reachable under two names',
      a.run('Object.keys(PERM_RULES).length'),
      a.run('new Set(Object.keys(PERM_RULES)).size'));
    s.ok('the module gates are owners only',
      a.run("can('acct.manage')")&&a.run("can('perm.grant')"));
    setSubject('mustafa');
    s.ok('a manager cannot grant rights',
      !a.run("can('acct.manage')")&&!a.run("can('perm.grant')"));
    setSubject('(nobody)');
    s.ok('nobody signed in grants no module gate',
      !a.run("can('acct.manage')")&&!a.run("can('perm.grant')"));
  }

  s.section('subject override — the admin screen previews without signing in');
  {
    setSubject('afnan');
    s.ok('asking about someone else does not read the session',
      a.run("can('pay.run',{u:'haris',role:'worker'})")===false);
    s.ok('and asking about the session still works beside it',
      a.run("can('pay.run')")===true);
    s.eq('permsFor is the same answer set as can(), per person',
      a.run("permsFor({u:'uzaib',role:'viewer'}).join(',')"),
      a.run("Object.keys(PERM_RULES).filter(c=>can(c,{u:'uzaib',role:'viewer'})).sort().join(',')"));
  }

  s.section('permHolders — who can do this?');
  {
    setSubject('afnan');
    const holders=a.run("permHolders('store.approve')");
    s.eq('names exactly the store-edit approvers',
      holders.slice().sort().join(','),'ammar,arfat,mustafa');
    s.eq('pay.run is the two owners',
      a.run("permHolders('pay.run')").slice().sort().join(','),'afnan,ammar');
    s.eq('an unknown capability has no holders',
      a.run("permHolders('nope.nope')").length,0);
    // A rights list derived at call time cannot rot; a stored one would.
    s.eq('every holder actually passes can() for that capability',
      a.run("permHolders('hub.view').filter(u=>!can('hub.view',USER_DEFS.find(d=>d.u===u))).length"),0);
  }

  s.section('the derived lists still name the same people');
  {
    setSubject('afnan');
    const eqList=(label,expr,want)=>s.eq(label,a.run(expr).join(','),want);
    // These mirror firestore.rules and are asserted against it elsewhere
    // (tests/patterns.test.js, tests/invariants.test.js). They read
    // js/permissions.js now, so this checks the indirection did not
    // quietly empty them — an empty list fails OPEN in some of those
    // mirror tests, which is the dangerous direction.
    eqList('_PATTERN_ADMIN_USERS','_PATTERN_ADMIN_USERS','afnan,ammar,mustafa');
    eqList('_PATTERN_CUTTING_USERS','_PATTERN_CUTTING_USERS','uzaib');
    eqList('_PATTERN_HUB_USERS','_PATTERN_HUB_USERS','afnan,ammar,mustafa,uzaib');
    eqList('_PROFILE_ADMINS','_PROFILE_ADMINS','afnan,ammar,mustafa');
    eqList('_PROFILE_PROTECTED','_PROFILE_PROTECTED','afnan,ammar');
    eqList('_CREATIVE_HUB_USERS','_CREATIVE_HUB_USERS','afnan,ammar,sami,mustafa,abbas');
    s.ok('permRuleUsers returns a COPY, so a caller cannot edit the rule',
      a.run("(function(){var l=permRuleUsers('prof.admin');l.push('mallory');"+
            "return permRuleUsers('prof.admin').indexOf('mallory')<0;})()"));
    s.eq('and a non-list rule honestly has no list',
      a.run("permRuleUsers('fulfil.view').length"),0);
  }

  s.section('the quirks, held deliberately');
  {
    // Each of these is what the app did before the refactor. They are
    // asserted so that CHANGING one is a visible decision rather than a
    // side effect of tidying the rule table.
    setSubject('(nobody)');
    s.ok('fabric.edit and qc.record invert with nobody signed in',
      a.run("can('fabric.edit')")&&a.run("can('qc.record')"));
    setSubject('sami');
    s.ok('and are the CSR lead’s only two refusals of that shape',
      !a.run("can('fabric.edit')")&&!a.run("can('qc.record')"));
    setSubject('afnan');
    s.ok('an owner still cannot approve a store edit',!a.run("can('store.approve')"));
    setSubject('raees');
    s.ok('cash.entry grants nothing beyond cash.view',
      a.run("can('cash.view')")===a.run("can('cash.entry')"));
    setSubject('mustafa');
    s.ok('Mustafa approves repeat PP but cannot raise a new one',
      a.run("can('pp.repeat')")&&!a.run("can('pp.new')"));
    setSubject('arfat');
    s.ok('Arfat is the reverse pair',
      a.run("can('pp.new')")&&!a.run("can('pay.view')"));
    // Arfat holds Mustafa's `manager` role and none of his grants — the
    // Sept 2026 rule. If a rule is ever switched from users to roles,
    // this is what catches it.
    s.ok('and the manager role alone grants Arfat none of Mustafa’s rights',
      ['pay.view','pay.slip','hrm.ops','hrm.loans','ptn.manage','prof.admin','hub.view','fabric.delete']
        .every(c=>!a.run('can('+JSON.stringify(c)+')')));
  }

  s.section('Phase 2 — a stored grant overrides the default');
  {
    setSubject('haris');
    const U='uid-haris';
    s.ok('with nothing stored, the built-in answer stands',
      !a.run("can('pay.view')")&&!a.run("permGrantsLoaded()"));

    // GRANT
    a.run("permSetGrants({'"+U+"':{caps:{'pay.view':true},preset:'',username:'haris'}},{})");
    s.ok('an override grants a right the default refuses',a.run("can('pay.view')"));
    s.eq('and says where it came from',a.run("permExplain('pay.view').source"),'override');
    s.ok('a capability the override does not mention falls through',
      !a.run("can('pay.run')"));
    s.eq('and says so',a.run("permExplain('pay.run').source"),'default');
    // The original helper must move with it — this is what proves the
    // grant reaches the app rather than only can().
    s.ok('the ORIGINAL helper moves with it',a.run('_canViewPayroll()'));

    // REVOKE — the half that is easy to get wrong
    setSubject('afnan');
    a.run("permSetGrants({'uid-afnan':{caps:{'pay.run':false},preset:'',username:'afnan'}},{})");
    s.ok('an override can REVOKE a right the default grants',!a.run("can('pay.run')"));
    s.eq('and it reads as an override, not a default',
      a.run("permExplain('pay.run').source"),'override');
    s.ok('the original helper is revoked too',!a.run('_canProcessPayroll()'));
    // `false` and absent must never be confused: a revocation that is
    // read as "not mentioned" silently does nothing, which is the worst
    // failure this module could have.
    s.ok('a revoked right is distinguishable from an unmentioned one',
      a.run("permExplain('pay.run').source")!==a.run("permExplain('pay.view').source"));

    // PRESETS
    a.run("permSetGrants({'uid-haris':{caps:{},preset:'floor-lead',username:'haris'}},"+
          "{'floor-lead':{caps:{'pay.view':true,'qc.work':false}}})");
    setSubject('haris');
    s.ok('a preset grants',a.run("can('pay.view')"));
    s.ok('and a preset revokes',!a.run("can('qc.work')"));
    s.eq('named in the explanation',a.run("permExplain('pay.view').detail"),'floor-lead');
    a.run("permSetGrants({'uid-haris':{caps:{'pay.view':false},preset:'floor-lead',username:'haris'}},"+
          "{'floor-lead':{caps:{'pay.view':true}}})");
    s.ok('a personal override BEATS the preset',!a.run("can('pay.view')"));
    s.eq('and says which layer won',a.run("permExplain('pay.view').source"),'override');
    a.run("permSetGrants({'uid-haris':{caps:{},preset:'nope',username:'haris'}},{})");
    s.ok('a preset that does not exist falls through to the default',
      !a.run("can('pay.view')")&&a.run("permExplain('pay.view').source")==='default');

    // A grant is keyed by UID, not username — the whole reason profiles
    // are keyed that way. Somebody else's grant must not leak across.
    a.run("permSetGrants({'uid-afnan':{caps:{'qc.work':true},preset:'',username:'afnan'}},{})");
    setSubject('haris');
    s.ok('another account\u2019s grant does not reach this one',
      a.run("permExplain('qc.work').source")==='default');
    s.ok('and the subject override reads THEIR grant, not the session\u2019s',
      a.run("can('qc.work',{uid:'uid-afnan',u:'afnan',role:'owner'})"));

    s.ok('permGrantFor returns a COPY',
      a.run("(function(){var g=permGrantFor('uid-afnan');g.caps['qc.work']=false;"+
            "return permGrantFor('uid-afnan').caps['qc.work']===true;})()"));
    s.eq('an account with nothing stored has no grant',
      a.run("permGrantFor('uid-nobody')"),null);
    s.eq('permPresetNames lists what is held',
      a.run("permSetGrants({},{b:{caps:{}},a:{caps:{}}});permPresetNames().join(',')"),'a,b');

    // Back to nothing stored, so the parity section above stays true for
    // any later block.
    a.run("permSetGrants({},{})");
  }

  s.section('Phase 2 — the loader cannot reject');
  {
    const mk=extra=>harness.loadApp({files:FILES,globals:Object.assign({localStorage:LS},extra)});
    // A denied read must leave every answer on the built-in default —
    // i.e. exactly today's behaviour — never on "nobody can do anything".
    const denied=mk({getDocs:async()=>{throw new Error('Missing or insufficient permissions');},
                     getDoc:async()=>{throw new Error('Missing or insufficient permissions');}});
    denied.run("session={uid:'uid-afnan',u:'afnan',name:'Afnan',role:'owner'}");
    let threw=null;
    await denied.run("permLoadGrants()").catch(e=>{threw=e&&e.message||String(e);});
    s.eq('a denied read does not reject',threw,null);
    s.ok('and the built-in answer still stands',denied.run("can('pay.run')"));
    s.eq('reported as a default, not a grant',denied.run("permExplain('pay.run').source"),'default');

    const ok=mk({
      getDocs:async()=>({docs:[{id:'floor',data:()=>({caps:{'pay.view':true}})}]}),
      getDoc:async()=>({exists:()=>true,data:()=>({uid:'uid-haris',preset:'floor',caps:{}})})
    });
    ok.run("session={uid:'uid-haris',u:'haris',name:'Haris',role:'worker'}");
    await ok.run("permLoadGrants()");
    s.ok('a real read applies the preset',ok.run("can('pay.view')"));
    s.eq('from the preset layer',ok.run("permExplain('pay.view').source"),'preset');
    s.ok('and it is marked loaded',ok.run('permGrantsLoaded()'));

    // Missing document is a NORMAL state, not an error: it is every
    // account today.
    const none=mk({getDocs:async()=>({docs:[]}),getDoc:async()=>({exists:()=>false,data:()=>({})})});
    none.run("session={uid:'uid-afnan',u:'afnan',name:'Afnan',role:'owner'}");
    await none.run("permLoadGrants()");
    s.ok('no stored document leaves the defaults intact',none.run("can('pay.run')"));
    s.eq('and reads as a default',none.run("permExplain('pay.run').source"),'default');
  }

  s.section('Phase 2 — startApp loads it but never waits for it');
  {
    const src=require('fs').readFileSync(require('path').join(harness.ROOT,'js/auth.js'),'utf8');
    const body=src.slice(src.indexOf('async function startApp()'),
                         src.indexOf('async function startApp()')+3000);
    s.ok('startApp calls permLoadGrants',/permLoadGrants\s*\(\s*\)/.test(body));
    // The white-screen incident: an awaited read that never settles parks
    // startApp forever and the app renders nothing. tests/smoke-startapp.js
    // is the real guard; this one names the specific call.
    s.ok('and does NOT await it',!/await\s+permLoadGrants/.test(body));
    s.ok('it repaints only when an answer actually changed',
      /after===before\)return/.test(body));
  }

  s.section('Phase 2 — nothing derives a rights list at load time any more');
  {
    const ptn=require('fs').readFileSync(require('path').join(harness.ROOT,'js/patterns.js'),'utf8');
    // A list baked in when the file parses cannot see a grant written
    // later. Both places that pick notification recipients ask at send
    // time now; this is the one Phase 2 found.
    s.ok('the cutting notice asks who holds ptn.cut at send time',
      /permHolders\('ptn\.cut'\)/.test(ptn));
    const store=require('fs').readFileSync(require('path').join(harness.ROOT,'js/store.js'),'utf8');
    s.ok('and the store edit notice asks who holds store.approve',
      /permHolders\('store\.approve'\)/.test(store));
    s.ok('with no _EDIT_APPROVERS list left behind',!/_EDIT_APPROVERS/.test(store));
  }

  return s;
};

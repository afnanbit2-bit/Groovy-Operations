/* ═══════════════════════════════════════════════════════════════════════
   PERMISSIONS — one question, one answer.

   Every "may this person do X?" in the app goes through can('x') here.
   Before this file, that question was answered in 38 separate helper
   functions scattered across ten modules, each carrying its own hardcoded
   username list. Widening a right meant finding every copy; the Creative
   Hub gate was six copies, one of them written INVERTED, and a naive grep
   for the positive form missed it.

   ── PHASE 1: THIS FILE CHANGES NOTHING ────────────────────────────────
   The rule table below reproduces EXACTLY what the app answered before it
   existed — the same username lists, the same role tests, the same
   quirks, including the ones that look like bugs (see QUIRKS). It is
   rewiring, not a policy change. tests/permissions.test.js asserts all
   608 answers (16 subjects x 38 capabilities) against a snapshot captured
   from the pre-refactor tree at tests/fixtures/permissions-parity.json.
   If a rule here drifts from what the app used to do, that test names the
   person and the capability.

   Later phases put a per-person grant on the user's own record and read
   it here; the table below then becomes the DEFAULT rather than the whole
   answer. Nothing outside this file has to learn about that.

   ── WHERE THE REAL BOUNDARY IS ────────────────────────────────────────
   This file is a PUBLIC static asset. It is not security — anyone can
   read it and anyone can call can() from a console with whatever they
   like. `firestore.rules` is the only real boundary, and the capabilities
   marked BOUNDARY below must be mirrored there. The rest are nav and UI
   scoping: they decide what someone is OFFERED, not what the database
   will accept.

   ── QUIRKS PRESERVED ON PURPOSE ───────────────────────────────────────
   These are what the app does today. They are recorded, not endorsed —
   changing any of them is a policy decision for a later phase, not
   something a refactor gets to do quietly.

   - fabric.edit and qc.record are TRUE with nobody signed in. Both are
     written as "not the CSR lead" rather than as a positive grant, so the
     signed-out case inverts. Harmless today (there is no UI before the
     login screen) but it is why `not` below is deliberately NOT guarded
     by the no-session check that every positive form carries.
   - store.approve excludes Afnan. An owner cannot approve a store edit.
   - cash.entry and fulfil.edit are aliases of their .view twin and grant
     nothing beyond it.
   - Mustafa has pp.repeat, pp.urgent and bill.approve but not pp.new or
     recipe.manage, while Arfat has the reverse pair.
   ═══════════════════════════════════════════════════════════════════════ */

/* A rule is data, not a function, so the admin screen in a later phase
   can EXPLAIN a grant ("because you are an owner") rather than just
   report a boolean. Forms:
     {users:[...]}  — by username
     {roles:[...]}  — by session.role
     {flag:'x'}     — a per-account flag on the USER_DEFS entry
     {cap:'x'}      — the same answer as another capability
     {any:[rule,…]} — union
     {not:rule}     — inversion; see QUIRKS on why this ignores no-session
*/
const PERM_RULES={
  // ── the module's own gates ──
  'acct.manage'  :{roles:['owner']},                        // BOUNDARY
  'perm.grant'   :{roles:['owner']},                        // BOUNDARY

  // ── payroll and HRM ── js/hrm.js
  'pay.view'     :{users:['afnan','ammar','mustafa']},      // BOUNDARY
  'pay.run'      :{users:['afnan','ammar']},                // BOUNDARY
  'pay.slip'     :{users:['afnan','ammar','mustafa']},      // BOUNDARY
  'hrm.ops'      :{users:['afnan','ammar','mustafa']},
  'hrm.approve'  :{users:['afnan','ammar']},                // BOUNDARY
  'hrm.loans'    :{users:['afnan','ammar','mustafa']},      // BOUNDARY
  'hrm.policy'   :{users:['afnan','ammar']},

  // ── embellishments ── js/embellishments.js
  'recipe.manage':{users:['ammar','afnan','arfat']},
  'recipe.lock'  :{users:['ammar']},
  'pp.new'       :{users:['ammar','afnan','arfat']},
  'pp.repeat'    :{users:['ammar','afnan','arfat','mustafa','haris']},
  'pp.urgent'    :{users:['ammar','afnan','arfat','mustafa']},
  'bill.approve' :{users:['ammar','afnan','arfat','mustafa']},

  // ── who works which station ──
  'print.work'   :{users:['asghar']},
  'bundle.work'  :{users:['zohaib']},
  'stitch.work'  :{users:['waqas']},
  'qc.work'      :{users:['haris']},
  // canSeePrinting(): observer, any station worker, or Ammar by name.
  'print.view'   :{any:[{roles:['owner','manager']},{cap:'print.work'},{cap:'bundle.work'},
                        {cap:'stitch.work'},{cap:'qc.work'},{users:['ammar']}]},
  // canViewQCReport(): the trailing `||session.u==='haris'` in the
  // original is redundant with qc.work and is not repeated here.
  'qc.view'      :{any:[{roles:['owner','manager']},{cap:'qc.work'}]},
  // _qcCanRecord(): everyone EXCEPT the view-only CSR lead.
  'qc.record'    :{not:{roles:['csr_lead']}},

  // ── store and cash ── js/store.js, js/store-cash.js
  'store.approve':{users:['ammar','arfat','mustafa']},
  'cash.view'    :{any:[{users:['afnan','ammar','mustafa','arfat','raees']},
                        {roles:['owner','manager','store']}]},
  'cash.entry'   :{cap:'cash.view'},
  'cash.admin'   :{any:[{users:['afnan','ammar']},{roles:['owner']}]},

  // ── fabric ── js/fabric.js
  'fabric.delete':{any:[{roles:['owner']},{users:['mustafa']}]},   // BOUNDARY
  'fabric.edit'  :{not:{roles:['csr_lead']}},

  // ── Pattern Hub ── js/patterns.js
  'ptn.view'     :{users:['afnan','ammar','mustafa','uzaib']},
  'ptn.manage'   :{users:['afnan','ammar','mustafa']},            // BOUNDARY
  'ptn.cut'      :{users:['uzaib']},                              // BOUNDARY
  'ptn.ack'      :{any:[{cap:'ptn.manage'},{cap:'ptn.cut'}]},

  // ── Marketing ── js/auth.js
  'mkt.access'   :{roles:['owner','creator_content_ops_lead']},   // BOUNDARY
  'mkt.lead'     :{roles:['creator_content_ops_lead']},           // BOUNDARY
  'mkt.paidpr'   :{flag:'canApprovePaidPR'},                      // BOUNDARY
  'mkt.scoring'  :{flag:'canEditScoring'},                        // BOUNDARY

  // ── the rest ──
  'hub.view'     :{users:['afnan','ammar','sami','mustafa','abbas']},
  'fulfil.view'  :{roles:['owner','manager','fulfillment']},
  'fulfil.edit'  :{cap:'fulfil.view'},
  'prof.admin'   :{users:['afnan','ammar','mustafa']}             // BOUNDARY
};

/* Mustafa may edit every other employee's profile, but not either
   owner's. Kept as data beside the rule it qualifies rather than buried
   in js/profile.js, so the admin screen can say so. */
const PERM_PROFILE_PROTECTED=['afnan','ammar'];
/** A COPY, like permRuleUsers — never a live reference to the table. */
function permProtected(){ return PERM_PROFILE_PROTECTED.slice(); }

/* ═══ PHASE 2 — a stored grant, per person ═══════════════════════════
   The rule table above is the DEFAULT. A person can also carry a stored
   grant, and can() prefers it. Nothing has one yet, so until something
   writes to `user_accounts` every answer still comes from the table —
   which is what keeps the parity snapshot green through this phase too.

   Three layers, most specific first:
     1. the person's OWN override   user_accounts/{uid}.caps[cap]
     2. their role PRESET           permission_presets/{name}.caps[cap]
     3. the rule table above

   `false` IS AN ANSWER, not an absence. An override has to be able to
   REVOKE a right the default grants, so every lookup asks whether the key
   is PRESENT, never whether the value is truthy — `{'pay.view':false}` and
   `{}` mean completely different things. Getting that wrong would make a
   revocation silently do nothing, which is the worst failure this module
   could have.

   Held in memory, keyed by uid, so can() stays SYNCHRONOUS: it is called
   from inside render functions, and an async permission check would mean
   rewriting every call site in the app. */
let _PERM_GRANTS={};    // uid  -> {caps:{}, preset:'', username:''}
let _PERM_PRESETS={};   // name -> {caps:{}}
let _PERM_GRANTS_LOADED=false;

/* Where a person's answer to one capability actually comes from.
   Returned as data so the admin screen can SAY why ("granted directly",
   "from the Manager preset", "the default for this role") rather than
   showing a bare tick. can() is this function's `allowed` field. */
function permExplain(cap,subject){
  const rule=PERM_RULES[cap];
  if(!rule)return{allowed:false,source:'unknown',detail:'no such capability'};
  if(subject===undefined)subject=(typeof session!=='undefined'&&session)?session:null;
  const g=(subject&&subject.uid)?_PERM_GRANTS[subject.uid]:null;
  if(g&&g.caps&&Object.prototype.hasOwnProperty.call(g.caps,cap))
    return{allowed:!!g.caps[cap],source:'override',detail:'set on this account'};
  if(g&&g.preset&&_PERM_PRESETS[g.preset]&&_PERM_PRESETS[g.preset].caps
     &&Object.prototype.hasOwnProperty.call(_PERM_PRESETS[g.preset].caps,cap))
    return{allowed:!!_PERM_PRESETS[g.preset].caps[cap],source:'preset',detail:g.preset};
  return{allowed:!!_permEval(rule,subject),source:'default',detail:'the built-in rule'};
}

/* Replace what is held in memory. Phase 3's screen calls this after a
   write so the UI updates without a reload; the loader below calls it
   with what Firestore returned. Kept separate from the loader so a test
   can drive the resolution chain with no Firestore at all. */
function permSetGrants(grants,presets){
  _PERM_GRANTS=grants||{};
  _PERM_PRESETS=presets||{};
  _PERM_GRANTS_LOADED=true;
}
function permGrantsLoaded(){ return _PERM_GRANTS_LOADED; }
/** The stored grant for one account, or null. A COPY. */
function permGrantFor(uid){
  const g=uid&&_PERM_GRANTS[uid];
  return g?JSON.parse(JSON.stringify(g)):null;
}
/** Every preset name currently held. */
function permPresetNames(){ return Object.keys(_PERM_PRESETS).sort(); }

/**
 * Load the stored grants.
 *
 * CANNOT REJECT. It is called from startApp and is never awaited — see
 * the note there, and "Loading must never hang" in CLAUDE.md. A refused
 * or hanging read leaves every answer on the Phase-1 default, which is
 * exactly today's behaviour, so the app degrades to "as it was" rather
 * than to "nobody can do anything".
 *
 * `everyone` is for the admin screen; by default a person reads only
 * their OWN account document, which is all the rules let them read.
 */
async function permLoadGrants(opts){
  opts=opts||{};
  const grants={},presets={};
  const uid=opts.uid||((typeof session!=='undefined'&&session&&session.uid)||'');
  try{
    const snap=await getDocs(collection(db,'permission_presets'));
    snap.docs.forEach(d=>{const v=d.data()||{};presets[d.id]={caps:v.caps||{}};});
  }catch(e){ /* no presets is a normal state, not an error */ }
  try{
    if(opts.everyone){
      const snap=await getDocs(collection(db,'user_accounts'));
      snap.docs.forEach(d=>{const v=d.data()||{};
        grants[d.id]={caps:v.caps||{},preset:v.preset||'',username:v.username||''};});
    }else if(uid){
      const d=await getDoc(doc(db,'user_accounts',uid));
      if(d&&d.exists&&d.exists()){const v=d.data()||{};
        grants[uid]={caps:v.caps||{},preset:v.preset||'',username:v.username||''};}
    }
  }catch(e){
    try{console.warn('[permissions] could not read stored grants: '+(e&&e.message||e));}catch(_){}
  }
  permSetGrants(grants,presets);
  return{grants,presets};
}

/* Evaluate one rule against a subject. `subject` is a session-shaped
   object — {u, role, …flags} — or null for nobody signed in. */
function _permEval(rule,subject){
  if(!rule)return false;
  if(rule.not)return !_permEval(rule.not,subject);
  if(rule.any)return rule.any.some(r=>_permEval(r,subject));
  if(!subject)return false;                     // every POSITIVE form needs somebody
  if(rule.cap)return can(rule.cap,subject);
  if(rule.users)return rule.users.indexOf(subject.u)>-1;
  if(rule.roles)return rule.roles.indexOf(subject.role)>-1;
  if(rule.flag)return subject[rule.flag]===true;
  return false;
}

/**
 * May this person do X?
 *
 * @param {string} cap  a key of PERM_RULES
 * @param {object} [subject]  defaults to the signed-in session. Passing
 *        one explicitly is how the admin screen previews what somebody
 *        else would see without signing in as them.
 * @returns {boolean}  an unknown capability is always false — a typo must
 *        never open a door.
 */
const _permWarned={};
function can(cap,subject){
  const rule=PERM_RULES[cap];
  if(!rule){
    // Once per NAME, not once per call: permHolders() asks the same
    // question for every account, and fifteen identical lines bury the
    // one that matters.
    if(!_permWarned[cap]){
      _permWarned[cap]=1;
      try{console.warn('[permissions] unknown capability: '+cap);}catch(e){}
    }
    return false;
  }
  if(subject===undefined)subject=(typeof session!=='undefined'&&session)?session:null;
  // Fast path: with nothing stored — which is every account until the
  // admin screen writes one — this is the Phase-1 rule table, untouched.
  if(!_PERM_GRANTS_LOADED)return !!_permEval(rule,subject);
  return !!permExplain(cap,subject).allowed;
}

/**
 * The literal username list behind a {users:[…]} rule.
 *
 * Downstream modules that need the LIST rather than a yes/no — the
 * Pattern Hub and Profile mirror theirs against firestore.rules, and a
 * test asserts each pair names the same people — read it from here
 * instead of keeping a second copy. Returns [] for a rule that is not a
 * plain username list, which is the honest answer: there is no list.
 */
function permRuleUsers(cap){
  const r=PERM_RULES[cap];
  return (r&&r.users)?r.users.slice():[];
}

/** Every capability this person holds — for the admin screen and tests. */
function permsFor(subject){
  return Object.keys(PERM_RULES).filter(c=>can(c,subject)).sort();
}

/**
 * Every ACCOUNT holding a capability — for "notify the approvers", and for
 * the admin screen's "who can do this?" view.
 *
 * Derived from USER_DEFS on every call rather than stored: a second list
 * of who-can-do-what is the thing that would rot the first time a right
 * moved. Returns usernames. Empty if USER_DEFS has not loaded yet, which
 * is why callers should treat an empty result as "ask later", not as
 * "nobody".
 */
function permHolders(cap){
  if(typeof USER_DEFS==='undefined'||!Array.isArray(USER_DEFS))return [];
  return USER_DEFS.filter(d=>can(cap,d)).map(d=>d.u);
}

window.can=can;
window.permsFor=permsFor;
window.permHolders=permHolders;
window.permRuleUsers=permRuleUsers;
window.permProtected=permProtected;
window.permExplain=permExplain;
window.permSetGrants=permSetGrants;
window.permGrantsLoaded=permGrantsLoaded;
window.permGrantFor=permGrantFor;
window.permPresetNames=permPresetNames;
window.permLoadGrants=permLoadGrants;

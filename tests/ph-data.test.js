/* ─────────────────────────────────────────────────────────────────────────
   Production Ops data layer (js/ph-data.js reads, js/ph-write.js writes) and
   the firestore.rules block that guards its collections (12 Oct 2026).

   What this holds:
     · the audience: _PH_USERS / _PH_MANAGE_USERS name exactly the people
       isProdOps() / isProdOpsManager() name (by email), every one a real
       USER_DEFS account, and the helpers answer per person
     · every JS field list / id pattern / status list equals the rules' (a
       writer that adds a field the rule does not allow, or the reverse, fails
       here by name); every builder emits exactly the listed keys
     · the loaders NEVER reject (throw, reject, hang, offline-cache answer) and
       a failed read is NAMED and reads as "not loaded" (rows:null), never as an
       empty list; reads are bounded; the pos history is read only on request
     · the writers write ONLY the new collections and the append-only
       pos/{id}/history rows: every write path is recorded and checked; no
       counters/main, no pos document, no delete; the history row and its parent
       write are ONE transaction; offline and forbidden refuse before any write
     · the rules text: new reads start `isQaRead() ||`, nothing is deletable,
       history is append-only, the existing pos / counters / settings rules are
       byte-for-byte what they were

   What it does NOT prove: that real Firestore (or the real rules engine)
   answers like the fake -- tests/rules-emulator-ph.js runs the rules and the
   writers against the real emulator, and nothing has run against the live
   project. See the header of tests/harness.js.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');

const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const RULES=read('firestore.rules').replace(/\r/g,'');
const SRC_DATA=read('js/ph-data.js'),SRC_WRITE=read('js/ph-write.js');
const J=JSON.stringify;
const sameSet=(a,b)=>J(a.slice().sort())===J(b.slice().sort());

/* ── rules text helpers ───────────────────────────────────────────────── */
function braceBlock(text,startRe){
  const m=startRe.exec(text);if(!m)return null;
  let i=text.indexOf('{',m.index+m[0].length-1),depth=0,start=i;
  for(;i<text.length;i++){const c=text[i];if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)return text.slice(start,i+1);}}
  return null;
}
const matchBlock=name=>braceBlock(RULES,new RegExp('match\\s+/'+name+'/\\{[A-Za-z]+\\}\\s*\\{'));
const funcBody=name=>braceBlock(RULES,new RegExp('function\\s+'+name+'\\s*\\([^)]*\\)\\s*\\{'));
const lists=t=>t?[...t.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map(m=>m[1].split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean)):[];
const nth=(t,i)=>lists(t)[i]||['(missing hasOnly list #'+i+')'];
const inList=(t,re)=>{const m=re.exec(t||'');return m?m[1].split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean):['(missing list)'];};
const emails=name=>{const b=funcBody(name);return b?[...b.matchAll(/'([a-z]+)@groovy\.op'/g)].map(m=>m[1]):['(function missing)'];};

/* ── a small in-memory Firestore with transaction semantics, recording everything ─ */
function makeFake(o){
  o=o||{};
  const store={};const log={reads:[],writes:[],queries:[],tx:0,txOps:[],getDocs:0,tokenRefresh:0,deletes:0};
  const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  const snapDoc=p=>({id:p.split('/').pop(),exists:()=>Object.prototype.hasOwnProperty.call(store,p),data:()=>clone(store[p]),metadata:{fromCache:!!o.fromCache}});
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/'),isCol:true}),
    query:(c,...cons)=>({path:c.path,limit:(cons.filter(x=>x&&x.limit!==undefined)[0]||{}).limit,order:(cons.filter(x=>x&&x.orderBy)[0]||{}).orderBy}),
    orderBy:(f,d)=>({orderBy:[f,d]}),limit:n=>({limit:n}),where:(...a)=>({where:a}),
    getDoc:async r=>{log.reads.push(r.path);if(o.failPath&&o.failPath(r.path)){throw o.failPath(r.path);}return snapDoc(r.path);},
    getDocs:async q=>{
      log.getDocs++;log.queries.push({path:q.path,limit:q.limit,order:q.order});
      if(o.getDocsSync)throw new Error('sync boom');
      if(o.hang&&o.hang(q.path))return new Promise(()=>{});
      const fail=o.failPath&&o.failPath(q.path);
      if(fail){if(typeof fail==='function')return fail();throw fail;}
      let docs=Object.keys(store).filter(k=>k.indexOf(q.path+'/')===0&&k.slice(q.path.length+1).indexOf('/')===-1).sort();
      if(q.limit!==undefined)docs=docs.slice(0,q.limit);
      return{docs:docs.map(snapDoc),metadata:{fromCache:!!o.fromCache}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path,tx:0,data:clone(d)});store[r.path]=clone(d);},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});store[r.path]=Object.assign({},store[r.path],clone(d));},
    deleteDoc:async r=>{log.deletes++;log.writes.push({op:'delete',path:r.path,tx:0});delete store[r.path];},
    addDoc:async(c,d)=>{log.writes.push({op:'add',path:c.path,tx:0,data:clone(d)});return{id:'x'};},
    writeBatch:()=>{const ops=[];return{set(r,d){ops.push({op:'set',path:r.path,data:clone(d)});return this;},update(r,d){ops.push({op:'update',path:r.path,data:clone(d)});return this;},delete(r){log.deletes++;ops.push({op:'delete',path:r.path});return this;},async commit(){log.tx++;ops.forEach(x=>{log.writes.push(Object.assign({tx:log.tx},x));});}};},
    runTransaction:async(db,fn)=>{
      if(o.txThrows){const e=o.txThrows;throw e;}
      const id=++log.tx;const buf=[];
      const tx={
        get:async r=>{log.reads.push(r.path);return snapDoc(r.path);},
        set:(r,d)=>{buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
        update:(r,d)=>{if(!Object.prototype.hasOwnProperty.call(store,r.path)&&!buf.some(b=>b.path===r.path))throw new Error('not-found');buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
        delete:r=>{log.deletes++;buf.push({op:'delete',path:r.path});return tx;}
      };
      const res=await fn(tx);
      buf.forEach(b=>{
        log.writes.push({op:b.op,path:b.path,tx:id,data:b.data});
        if(b.op==='set')store[b.path]=b.data;else if(b.op==='update')store[b.path]=Object.assign({},store[b.path],b.data);else delete store[b.path];
      });
      return res;
    }
  };
  return{store,log,api};
}
const T0=1790000000000;
function mk(o){
  o=o||{};
  const fk=makeFake(o);
  const globals=Object.assign({},fk.api,{
    auth:{currentUser:{getIdToken:async()=>{fk.log.tokenRefresh++;}}},
    // a read that "never settles" is cut off at PH_READ_TIMEOUT_MS (20 s): the test shortens only that timer
    setTimeout:(fn,ms)=>setTimeout(fn,ms>=20000?20:ms),
    navigator:{onLine:o.offline?false:true}
  },o.globals||{});
  const app=loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js'],globals});
  return{app,fk,store:fk.store,log:fk.log,run:c=>app.run(c),call:async c=>app.run('(async()=>{return await '+c+';})()')};
}
const AF={u:'afnan',name:'Afnan'},MU={u:'mustafa',name:'Mustafa'},UZ={u:'uzaib',name:'Uzaib'},RA={u:'raees',name:'Raees'},QA={u:'claude',name:'Claude'};
const A=(who,extra)=>J(Object.assign({actor:who},extra||{}));
let tick=0;const nx=()=>T0+(++tick)*1000;
const rootOf=p=>p.split('/')[0];
const GOOD_PO={code:'GST073',name:'Effortless Tee',qty:100,sizes:{S:50,M:50},fabric:'Jersey 180',plannedFabricQty:30,plannedFabricUnit:'kg',season:'winter',plannedCutDate:'2026-10-20',requestedDate:'2026-10-25',cutMasterId:'CM-001'};

module.exports=async function(){
  const s=suite('ph-data');

  /* ═══ 1. the audience ═══ */
  s.section('audience: the JS lists and the rules name the same people');
  {
    const a=loadApp({files:['js/auth.js','js/ph-core.js','js/ph-data.js']});
    const jsAll=a.run('_PH_USERS'),jsMgr=a.run('_PH_MANAGE_USERS'),jsFloor=a.run('_PH_FLOOR_USERS');
    s.eq('the module audience is afnan, ammar, mustafa, uzaib',J(jsAll),J(['afnan','ammar','mustafa','uzaib']));
    s.eq('the managers are afnan, ammar, mustafa',J(jsMgr),J(['afnan','ammar','mustafa']));
    s.eq('the floor list is uzaib alone, and users = managers + floor',J(jsFloor)+J(jsAll),J(['uzaib'])+J(jsMgr.concat(jsFloor)));
    s.eq('rules isProdOps() lists exactly _PH_USERS (by <u>@groovy.op)',J(emails('isProdOps').sort()),J(jsAll.slice().sort()));
    s.eq('rules isProdOpsManager() lists exactly _PH_MANAGE_USERS',J(emails('isProdOpsManager').sort()),J(jsMgr.slice().sort()));
    s.ok('both rules helpers are built on signedIn() (which excludes the QA account)',/function isProdOps\(\)\s*\{\s*return signedIn\(\)/.test(RULES)&&/function isProdOpsManager\(\)\s*\{\s*return signedIn\(\)/.test(RULES));
    s.eq('every audience member is a real account whose email is <u>@groovy.op',a.run("_PH_USERS.filter(u=>!USER_DEFS.some(d=>d.u===u&&d.email===u+'@groovy.op')).join(',')"),'');
    s.ok('uzaib is the existing login for the cutting incharge (js/auth.js)',a.run("USER_DEFS.some(d=>d.u==='uzaib'&&d.stages.indexOf('cutting')>-1)"));
    const who=u=>a.run('['+['phCanSee','phCanManage','phCanRecordFloor','phIsOwner','phCanSetPcOnly'].map(f=>f+'('+J(u)+')').join(',')+']');
    s.eq('afnan: sees, manages, records, owner',J(who('afnan')),J([true,true,true,true,true]));
    s.eq('ammar: sees, manages, records, owner',J(who('ammar')),J([true,true,true,true,true]));
    s.eq('mustafa: sees, manages, records, NOT an owner',J(who('mustafa')),J([true,true,true,false,false]));
    s.eq('uzaib sees and records the cutting floor but does NOT manage',J(who('uzaib')),J([true,false,true,false,false]));
    for(const u of ['raees','umair','arfat','daniyal','sami','waqas','claude','',null,'AFNAN','afnan ',42])
      s.eq('nobody else is in it: '+J(u),J(who(u)),J([false,false,false,false,false]));
    const b=loadApp({files:['js/ph-core.js','js/ph-data.js'],session:{u:'mustafa',name:'Mustafa',role:'manager'}});
    s.ok('with no argument the helpers read the signed-in session',b.run('phCanSee()')===true&&b.run('phCanManage()')===true&&b.run('phIsOwner()')===false);
    const c=loadApp({files:['js/ph-core.js','js/ph-data.js'],session:{u:'arfat',name:'Arfat',role:'manager'}});
    s.ok('Arfat holds the manager role and gets nothing: the lists are usernames, not a role',c.run('phCanSee()')===false&&c.run('phCanManage()')===false);
  }

  /* ═══ 2. field lists, ids and statuses equal the rules ═══ */
  s.section('rules and JS agree on every field list, id pattern and status list');
  {
    const w=loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js']});
    const L=n=>w.run(n).slice();
    const drafts=matchBlock('po_drafts'),dstep=funcBody('phDraftStep');
    s.eq('po_drafts create keys = PH_DRAFT_CREATE_FIELDS',J(nth(drafts,0).slice().sort()),J(L('PH_DRAFT_CREATE_FIELDS').sort()));
    const dl=[0,1,2,3].map(i=>nth(dstep,i));
    s.ok('phDraftStep edit keys = PH_DRAFT_EDIT_FIELDS',sameSet(dl[0],L('PH_DRAFT_EDIT_FIELDS')));
    s.ok('… mark-ready keys = PH_DRAFT_READY_FIELDS',sameSet(dl[1],L('PH_DRAFT_READY_FIELDS')));
    s.ok('… send-back keys = PH_DRAFT_BACK_FIELDS',sameSet(dl[2],L('PH_DRAFT_BACK_FIELDS')));
    s.ok('… abandon keys = PH_DRAFT_ABANDON_FIELDS',sameSet(dl[3],L('PH_DRAFT_ABANDON_FIELDS')));
    s.eq('the draft statuses the rules move between = PH_DRAFT_STATUSES (no `issued` yet)',J([...new Set([...dstep.matchAll(/(?:r|d)\.status == '([a-z]+)'/g)].map(m=>m[1]))].sort()),J(L('PH_DRAFT_STATUSES').sort()));
    s.ok('the word issued appears in neither draft rule (it arrives with the issue transaction and its own rules change)',!/issued/.test(drafts+dstep));
    const jobs=matchBlock('po_cut_jobs'),jstep=funcBody('phJobStep');
    s.eq('po_cut_jobs create keys = PH_JOB_CREATE_FIELDS',J(nth(jobs,0).slice().sort()),J(L('PH_JOB_CREATE_FIELDS').sort()));
    s.eq('phJobStep mutable keys = PH_JOB_MUTABLE_FIELDS',J(nth(jstep,0).slice().sort()),J(L('PH_JOB_MUTABLE_FIELDS').sort()));
    s.eq('job statuses in the rule = PH_JOB_STATUSES',J(inList(jstep,/status', ''\) in \[([^\]]*)\]/).sort()),J(L('PH_JOB_STATUSES').sort()));
    s.ok('overridden is an owner\'s decision in the rule',/!= 'overridden' \|\| r\.get\('status', ''\) == 'overridden' \|\| isOwner\(\)/.test(jstep));
    const masters=matchBlock('cutting_masters');
    s.eq('cutting_masters create keys = PH_MASTER_CREATE_FIELDS',J(nth(masters,0).slice().sort()),J(L('PH_MASTER_CREATE_FIELDS').sort()));
    s.eq('cutting_masters update keys = PH_MASTER_MUTABLE_FIELDS',J(nth(masters,1).slice().sort()),J(L('PH_MASTER_MUTABLE_FIELDS').sort()));
    s.eq('master kinds in the rule = PH_MASTER_KINDS',J(inList(masters,/kind', ''\) in \[([^\]]*)\]/).sort()),J(L('PH_MASTER_KINDS').sort()));
    const stds=matchBlock('ph_standards');
    s.eq('ph_standards create keys = PH_STANDARD_CREATE_FIELDS',J(nth(stds,0).slice().sort()),J(L('PH_STANDARD_CREATE_FIELDS').sort()));
    s.eq('ph_standards update keys = PH_STANDARD_MUTABLE_FIELDS',J(nth(stds,1).slice().sort()),J(L('PH_STANDARD_MUTABLE_FIELDS').sort()));
    const sett=matchBlock('ph_settings'),sok=funcBody('phSettingsOk');
    s.eq('phSettingsOk keys = PH_SETTINGS_FIELDS',J(nth(sok,0).slice().sort()),J(L('PH_SETTINGS_FIELDS').sort()));
    s.ok('counters create AND update are held to PH_COUNTER_FIELDS',lists(sett).length===2&&lists(sett).every(l=>sameSet(l,L('PH_COUNTER_FIELDS'))));
    const hist=braceBlock(matchBlock('pos'),/match\s+\/history\/\{row\}\s*\{/);
    s.eq('pos/{id}/history keys = PH_HISTORY_FIELDS',J(nth(hist,0).slice().sort()),J(L('PH_HISTORY_FIELDS').sort()));
    s.eq('the settings keys the core resolves are all stored by the writer (and pcOnlyHard is the only extra)',
      J(w.run('Object.keys(PH_DEFAULT_SETTINGS).filter(k=>PH_SETTINGS_VALUE_FIELDS.indexOf(k)<0).concat(PH_SETTINGS_VALUE_FIELDS.filter(k=>Object.keys(PH_DEFAULT_SETTINGS).indexOf(k)<0))')),J(['pcOnlyHard']));
    for(const [n,re] of [['PH_HIST_TYPE_RE','history type'],['PH_CODE_RE','article code'],['PH_DRAFT_ID_RE','draft id'],['PH_PO_ID_RE','PO id'],['PH_MASTER_ID_RE','master id'],['PH_HISTORY_ROW_RE','history row id']])
      s.ok('the '+re+' pattern is written the same in JS and in the rules ('+w.run(n+'.source')+')',RULES.indexOf("'"+w.run(n+'.source')+"'")>-1);
    s.eq('PH_WRITE_ROOTS is exactly the five new collections',J(L('PH_WRITE_ROOTS').sort()),J(['cutting_masters','ph_settings','ph_standards','po_cut_jobs','po_drafts']));
    s.ok('every PH_COLLECTIONS collection has a match block',w.run("Object.keys(PH_COLLECTIONS).every(k=>true)")&&['po_drafts','po_cut_jobs','cutting_masters','ph_standards','ph_settings'].every(c=>!!matchBlock(c)));
    s.ok('and the pos history match block sits inside the existing pos block',!!hist&&!!matchBlock('pos'));
  }

  /* ═══ 3. builders emit exactly the listed keys ═══ */
  s.section('builders emit exactly the keys the rules allow');
  {
    const m=mk();
    const ctx='{u:"afnan",name:"Afnan",now:'+T0+',rand:"AB12"}';
    const keys=e=>m.run('Object.keys('+e+').sort()');
    s.eq('phBuildDraft',J(keys('phBuildDraft({code:"X"},'+ctx+').data')),J(m.run('PH_DRAFT_CREATE_FIELDS').slice().sort()));
    s.eq('phBuildCutJob (all fields given or defaulted)',J(keys('phBuildCutJob("PO-001",{},'+ctx+').data')),J(m.run('PH_JOB_CREATE_FIELDS').slice().sort()));
    s.eq('phBuildMaster',J(keys('phBuildMaster("Alam","CM-001",'+ctx+').data')),J(m.run('PH_MASTER_CREATE_FIELDS').slice().sort()));
    s.eq('phBuildStandard',J(keys('phBuildStandard("GST073",phStandard({unit:"kg",grossPerPiece:0.3}),null,"",'+ctx+').data')),J(m.run('PH_STANDARD_CREATE_FIELDS').slice().sort()));
    s.eq('phBuildHistoryRow',J(keys('phBuildHistoryRow({type:"scheduled"},'+ctx+').data')),J(m.run('PH_HISTORY_FIELDS').slice().sort()));
    const sub=(patchExpr,listName)=>m.run('Object.keys('+patchExpr+').every(k=>'+listName+'.indexOf(k)>-1)');
    s.ok('draft edit patch ⊆ edit keys',sub('phDraftEditPatch({rev:1},{a:1},'+ctx+').patch','PH_DRAFT_EDIT_FIELDS'));
    s.eq('draft ready patch = ready keys (without po)',J(keys('phDraftReadyPatch({rev:1},'+ctx+').patch')),J(m.run('PH_DRAFT_READY_FIELDS').filter(k=>k!=='po').sort()));
    s.eq('draft send-back patch = back keys',J(keys('phDraftBackPatch({rev:1},"r",'+ctx+').patch')),J(m.run('PH_DRAFT_BACK_FIELDS').slice().sort()));
    s.eq('draft abandon patch = abandon keys',J(keys('phDraftAbandonPatch({rev:1},"r",'+ctx+').patch')),J(m.run('PH_DRAFT_ABANDON_FIELDS').slice().sort()));
    s.eq('history row id is 13 digits + - + 4 characters and sorts by time',m.run('phHistoryRowId('+T0+',"ab12")'),T0+'-ab12');
    s.ok('a clock that is not 13 digits makes no row id (null), never a bad one',m.run('phHistoryRowId(12345,"ab12")')===null&&m.run('phBuildHistoryRow({type:"x_y"},{u:"a",now:12345}).error').length>5);
    s.ok('draft ids match the pattern and carry the time in base 36',/^DRAFT-[0-9A-Z]+-[0-9A-Z]{4}$/.test(m.run('phDraftId('+T0+')')));
    s.eq('nested arrays in a draft are refused by name (Firestore refuses them outright)',m.run('phBuildDraft({rows:[[1,2]]},'+ctx+').error'),'the PO draft holds an array inside an array, which Firestore refuses');
    s.ok('an oversize draft is refused',/too large/.test(m.run('phBuildDraft({x:"'+'a'.repeat(310000)+'"},'+ctx+').error')));
    s.ok('undefined and functions never reach the document (JSON copy)',m.run('JSON.stringify(Object.keys(phBuildDraft({a:1,b:undefined,c:function(){}},'+ctx+').data.po))')==='["a"]');
  }

  /* ═══ 4. the loaders ═══ */
  s.section('loaders: never reject, name what failed, never look empty');
  {
    // all five stages read, bounded
    const m=mk();
    m.store['po_drafts/DRAFT-A-AAAA']={id:'DRAFT-A-AAAA',status:'draft',updatedAt:2};
    m.store['po_drafts/DRAFT-B-BBBB']={id:'DRAFT-B-BBBB',status:'draft',updatedAt:1};
    m.store['cutting_masters/CM-001']={id:'CM-001',name:'Alam',active:true};
    m.store['ph_settings/main']={dailyCapacity:500,rev:1};
    const r=await m.call('phLoadAll({})');
    s.ok('phLoadAll resolves ok:true with all five stages loaded',r.ok===true&&r.loaded.length===5&&r.failed.length===0);
    const d=m.run('phGet("drafts")');
    s.ok('drafts read: ok, 2 rows, each carries its document id as fbKey',d.ok&&d.rows.length===2&&d.rows.every(x=>/^DRAFT-/.test(x.fbKey)));
    s.ok('an empty collection that WAS read is ok with rows [] (so [] can only mean empty)',m.run('phGet("jobs")').ok===true&&m.run('phGet("jobs")').rows.length===0);
    s.eq('settings resolved through the core: capacity 500',m.run('phSettingsNow().dailyCapacity'),500);
    s.ok('every list query is bounded by limit() and no query touches a pos history',m.log.queries.length===4&&m.log.queries.every(q=>typeof q.limit==='number'&&q.limit>0&&q.limit<=1500)&&m.log.queries.every(q=>q.path.indexOf('history')<0));
    s.eq('the limits are the declared ones',J(m.log.queries.map(q=>q.limit).sort((a,b)=>a-b)),J([300,500,500,1500]));
    s.ok('ordered lists ask for newest first on a single field (no composite index)',m.log.queries.filter(q=>q.order).every(q=>q.order[1]==='desc'));
    const again=await m.call('phLoadAll({})');
    s.eq('a second phLoadAll reads nothing (cached) unless forced',m.log.getDocs,4);
    await m.call('phLoadAll({force:true})');
    s.eq('force re-reads',m.log.getDocs,8);
  }
  {
    // a refused read is NAMED and not empty; others still load
    const e=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
    const m=mk({failPath:p=>p==='cutting_masters'?e:null});
    m.store['po_drafts/DRAFT-A-AAAA']={id:'DRAFT-A-AAAA',status:'draft',updatedAt:2};
    const r=await m.call('phLoadAll({})');
    s.ok('one refused collection does not take the others down (allSettled shape)',r.ok===false&&r.failed.length===1&&r.loaded.length===4);
    s.eq('the failure names the collection',r.failed[0].name,'cutting_masters');
    s.ok('and says to republish firestore.rules, starting with the collection name',/^cutting_masters: could not be read - republish firestore\.rules/.test(r.failed[0].text));
    const g=m.run('phGet("masters")');
    s.ok('the refused stage reads as NOT loaded: ok:false, rows:null (never [])',g.ok===false&&g.rows===null&&g.state==='error');
    s.ok('phLoadFailed / phLoadErrors / phMasterList agree',m.run('phLoadFailed("masters")')===true&&m.run('phLoadErrors().length')===1&&m.run('phMasterList()')===null);
    s.ok('the permission failure was retried ONCE behind a token refresh',m.log.tokenRefresh===1);
    s.ok('drafts still loaded',m.run('phGet("drafts")').rows.length===1);
  }
  {
    const m=mk({failPath:p=>p==='po_drafts'?Object.assign(new Error('unavailable'),{code:'unavailable'}):null});
    const r=await m.call('phLoadAll({})');
    s.ok('a non-permission failure is not retried with a token refresh and is still named',m.log.tokenRefresh===0&&r.failed[0].name==='po_drafts'&&/read failed/.test(r.failed[0].text));
    const q=mk({failPath:p=>p==='ph_standards'?Object.assign(new Error('HTTP 429'),{code:'resource-exhausted'}):null});
    const rq=await q.call('phLoadAll({})');
    s.ok('a quota failure says so',/quota/.test(rq.failed[0].text));
  }
  {
    const m=mk({getDocsSync:true});
    let out,threw=false;
    try{out=await m.call('phLoadAll({force:true})');}catch(e){threw=true;}
    s.ok('a getDocs that THROWS synchronously does not reject phLoadAll',!threw&&out.failed.length===4);
    const h=mk({hang:p=>p==='po_cut_jobs'});
    const t0=Date.now();
    // guarded: a loader that really hung would leave node with an empty event loop and exit 0 in silence
    const rh=await Promise.race([h.call('phLoadAll({})'),new Promise(r=>setTimeout(()=>r({hung:true,failed:[]}),3000))]);
    s.ok('a read that never settles is cut off and reported as a timeout (not a hang)',!rh.hung&&Date.now()-t0<2900&&rh.failed.length===1&&rh.failed[0].name==='po_cut_jobs'&&/did not finish/.test(rh.failed[0].text));
    const c=mk({fromCache:true});
    const rc=await c.call('phLoadAll({})');
    s.ok('an answer from the offline copy is a FAILURE, not an empty list (all five)',rc.failed.length===5&&rc.failed.every(f=>/offline copy/.test(f.text))&&c.run('phGet("drafts")').rows===null);
    const bad=await m.call('phLoadStage("nonsense")');
    s.ok('an unknown stage resolves {ok:false}, never throws',bad.ok===false);
    const co=mk();let reads=0;
    const p1=co.call('phLoadStage("masters")'),p2=co.call('phLoadStage("masters")');await p1;await p2;
    s.eq('concurrent calls for one stage share one read',co.log.queries.filter(q=>q.path==='cutting_masters').length,1);
  }
  {
    // truncation is said, not hidden
    const m=mk();
    for(let i=0;i<300;i++)m.store['po_drafts/DRAFT-'+i+'-AAAA']={id:'x',updatedAt:i};
    await m.call('phLoadStage("drafts")');
    const g=m.run('phGet("drafts")');
    s.ok('a list that hit its limit says truncated and holds exactly the limit',g.ok&&g.truncated===true&&g.rows.length===300);
  }
  {
    // settings: missing doc vs failed read
    const m=mk();
    await m.call('phLoadStage("settings")');
    const i=m.run('phSettingsInfo()');
    s.ok('a settings doc that does not exist is read successfully: known, defaults (400), pcOnlyHard false',i.known===true&&i.failed===false&&i.settings.dailyCapacity===400&&i.pcOnlyHard===false);
    const f=mk({failPath:p=>p==='ph_settings/main'?Object.assign(new Error('x'),{code:'permission-denied'}):null});
    await f.call('phLoadStage("settings")');
    const j=f.run('phSettingsInfo()');
    s.ok('a settings read that FAILED is known:false and failed:true, so defaults are never mistaken for saved values',j.known===false&&j.failed===true&&j.settings.dailyCapacity===400&&j.pcOnlyHard===false);
    const g=mk();g.store['ph_settings/main']={dailyCapacity:0,pcOnlyHard:true,skipDays:['2026-10-31','nope']};
    await g.call('phLoadStage("settings")');
    s.ok('stored junk is clamped by the core, and pcOnlyHard is read as stored',g.run('phSettingsNow().dailyCapacity')===400&&g.run('phSettingsInfo().pcOnlyHard')===true&&g.run('phSettingsNow().skipDays.join()')==='2026-10-31');
  }
  {
    // pos history: only when asked, bounded
    const m=mk();
    for(let i=0;i<5;i++)m.store['pos/PO-001/history/'+(T0+i)+'-ab1'+i]={at:T0+i,by:'afnan',type:'scheduled'};
    const bad=await m.call('phHistoryOf("not-a-po")');
    s.ok('a bad PO id is refused without a read',bad.ok===false&&m.log.getDocs===0);
    const r=await m.call('phHistoryOf("PO-001",{limit:3})');
    s.ok('history is one bounded read: 3 rows, truncated, ordered newest first, limit passed through',r.ok&&r.rows.length===3&&r.truncated===true&&m.log.queries[0].limit===3&&m.log.queries[0].path==='pos/PO-001/history'&&m.log.queries[0].order[1]==='desc');
    const r2=await m.call('phHistoryOf("PO-001",{limit:3})');
    s.ok('a second call is cached; force re-reads',r2.cached===true&&m.log.getDocs===1);
    await m.call('phHistoryOf("PO-001",{force:true,limit:99999})');
    s.eq('the limit is clamped to the maximum (200)',m.log.queries[1].limit,200);
    const f=mk({failPath:p=>p==='pos/PO-001/history'?Object.assign(new Error('x'),{code:'permission-denied'}):null});
    const rf=await f.call('phHistoryOf("PO-001")');
    s.ok('a refused history read is ok:false, rows:null and says why',rf.ok===false&&rf.rows===null&&/republish/.test(rf.text));
    const c=mk({fromCache:true});
    const rc=await c.call('phHistoryOf("PO-001")');
    s.ok('an offline-copy history answer is a failure, not "no rows"',rc.ok===false&&rc.rows===null);
  }

  /* ═══ 5. the writers ═══ */
  s.section('writers: only the new collections, one transaction for a row and its parent');
  {
    const m=mk();
    m.store['pos/PO-001']={id:'PO-001',qty:100,code:'GST073'};
    m.store['cutting_masters/CM-001']={id:'CM-001',name:'Master One',nameKey:'master one',active:true,kind:'inhouse'};
    await m.call('phLoadAll({force:true})');
    const poBefore=J(m.store['pos/PO-001']);
    // run every writer once
    const d=await m.call('phSaveDraft(null,'+J(GOOD_PO)+','+A(UZ,{now:nx()})+')');
    await m.call('phSaveDraft('+J(d.id)+',{code:"GST073",qty:7},'+A(UZ,{now:nx(),expectedRev:1})+')');
    await m.call('phSaveDraft('+J(d.id)+','+J(GOOD_PO)+','+A(UZ,{now:nx()})+')');
    const rdy=await m.call('phMarkDraftReady('+J(d.id)+','+A(UZ,{now:nx()})+')');
    const back=await m.call('phSendBackDraft('+J(d.id)+',"fabric",'+A(MU,{now:nx()})+')');
    const ab=await m.call('phAbandonDraft('+J(d.id)+',"dup",'+A(AF,{now:nx()})+')');
    const job=await m.call('phSaveCutJob("PO-001",{plannedCutDate:"2026-10-20",masterId:"CM-001",masterName:"Master One",plannedFabric:{qty:30,unit:"m"},rollsChecklist:{total:3,verified:3,short:0,missing:0,extra:0}},'+A(UZ,{now:nx()})+')');
    const job2=await m.call('phSaveCutJob("PO-001",{status:"complete"},'+A(UZ,{now:nx()})+')');
    const hist=await m.call('phAppendHistory("PO-001",{type:"scheduled",to:"2026-10-21",data:{x:1}},'+A(UZ,{now:nx()})+')');
    const ma=await m.call('phMasterAdd("Hassan",'+A(MU,{now:nx(),kind:'inhouse'})+')');
    const mr=await m.call('phMasterRename('+J(ma.id)+',"Hassan Ali",'+A(MU,{now:nx()})+')');
    const mx=await m.call('phMasterSetActive('+J(ma.id)+',false,"left",'+A(AF,{now:nx()})+')');
    const my=await m.call('phMasterSetActive('+J(ma.id)+',true,"",'+A(AF,{now:nx()})+')');
    const st=await m.call('phStandardSave("gst073",{unit:"kg",grossPerPiece:0.31,sizes:{S:0.3}},'+A(AF,{now:nx()})+')');
    const st2=await m.call('phStandardSave("GST073",{unit:"kg",grossPerPiece:0.32},'+A(AF,{now:nx()})+')');
    const se=await m.call('phSettingsSave({dailyCapacity:450,skipDays:["2026-10-31"]},'+A(MU,{now:nx()})+')');
    const se2=await m.call('phSettingsSave({pcOnlyHard:true},'+A(AF,{now:nx()})+')');
    s.ok('the happy path ran for every writer (all ok:true)',[d,rdy,back,ab,job,job2,hist,ma,mr,mx,my,st,st2,se,se2].every(x=>x&&x.ok===true));
    const paths=m.log.writes.map(w=>w.path);
    const roots=new Set(paths.map(rootOf));
    s.ok('EVERY write path is in a new collection or is a pos history row ('+[...roots].sort().join(', ')+')',
      paths.every(p=>m.run('PH_WRITE_ROOTS').indexOf(rootOf(p))>-1||/^pos\/PO-[0-9]{3,}\/history\/[0-9]{13}-[A-Za-z0-9]{4}$/.test(p)));
    s.ok('no write touched a pos DOCUMENT (only .../history/... under pos)',paths.filter(p=>rootOf(p)==='pos').every(p=>p.split('/').length===4&&p.split('/')[2]==='history'));
    s.eq('the pos document is byte-for-byte what it was',J(m.store['pos/PO-001']),poBefore);
    s.ok('counters/main (and any `counters` / gatepasses / bundles / fabric_* path) was never read or written',![...paths,...m.log.reads].some(p=>/^(counters|gatepasses|bundles|returns|fabricin|fabric_|settings\/|activity)/.test(p)));
    s.eq('no delete anywhere',m.log.deletes,0);
    s.eq('no op other than set / update was used',J([...new Set(m.log.writes.map(w=>w.op))].sort()),J(['set','update']));
    // the history row and its parent: ONE transaction
    const jobWrites=m.log.writes.filter(w=>w.path==='po_cut_jobs/PO-001');
    const histWrites=m.log.writes.filter(w=>/^pos\/PO-001\/history\//.test(w.path));
    s.ok('every cut-job write shares its transaction with a history row (job tx ids ⊆ history tx ids)',jobWrites.length===2&&jobWrites.every(jw=>jw.tx>0&&histWrites.some(h=>h.tx===jw.tx)));
    s.eq('the opened row is cut_job_opened, the second cut_job_updated, both by uzaib',J(histWrites.filter(h=>h.tx).map(h=>[h.data.type,h.data.by])),J([['cut_job_opened','uzaib'],['cut_job_updated','uzaib']]));
    s.ok('the standalone phAppendHistory is a single setDoc, not a transaction',m.log.writes.filter(w=>w.tx===0&&/history/.test(w.path)).length===1);
    s.eq('a job is created open at rev 1, then updated to rev 2 and completed with completedAt/By',J([job.job.status,job.job.rev,job2.job.rev,job2.job.status,job2.job.completedBy]),J(['open',1,2,'complete','uzaib']));
    s.eq('the planned fabric unit was normalised (m stays m; a quantity needs a unit)',job.job.plannedFabric.unit,'m');
    // masters
    s.eq('the master id comes from ph_settings/counters: CM-002 after the seeded CM-001',ma.id,'CM-002');
    s.eq('the counter document is ph_settings/counters, value 2',J(m.store['ph_settings/counters']),J({cutting_masters:2,updatedAt:m.store['ph_settings/counters'].updatedAt,updatedBy:'mustafa'}));
    s.ok('rename kept the old name key as an alias; retire stamped retiredAt/By; reactivate cleared them',mr.master.aliases.join()==='hassan'&&mx.master.retiredBy==='afnan'&&my.master.retiredAt===null);
    // standard + settings
    s.eq('the standard id is the upper-cased code; rev 1 then 2',J([st.id,st.rev,st2.rev]),J(['GST073',1,2]));
    s.ok('settings keep earlier keys on a later save and store only keys that were set',J(Object.keys(m.store['ph_settings/main']).sort())===J(['dailyCapacity','pcOnlyHard','rev','skipDays','updatedAt','updatedBy']));
    s.eq('pcOnlyHard stored true by the owner; rev 2',J([m.store['ph_settings/main'].pcOnlyHard,se2.rev]),J([true,2]));
    // local caches follow
    s.ok('loaded caches were patched in step (the master list has the new master)',m.run('phMasterList().some(x=>x.fbKey===' + J(ma.id) + ')'));
    // statuses
    s.eq('the final draft is abandoned at rev 6 with the reason stored',J([m.store['po_drafts/'+d.id].status,m.store['po_drafts/'+d.id].rev,m.store['po_drafts/'+d.id].abandonedReason]),J(['abandoned',6,'dup']));
    s.ok('send-back stored who and why; ready stored who',back.draft.sentBackBy==='mustafa'&&back.draft.sentBackReason==='fabric'&&rdy.draft.readyBy==='uzaib');
    // activity verbs land in sensible Monitor buckets
    const mon=loadApp({files:['js/activity.js']});
    const bucket=a=>mon.run('_monitorCategorize('+J(a)+').key');
    s.eq('the logged verbs categorise: added→create, renamed→edit, updated→edit, withdrawn→delete, retired→other',
      J(['Cutting master added','Cutting master renamed','Production standard updated','Production Ops settings updated','PO draft withdrawn','Cutting master retired'].map(bucket)),J(['create','edit','edit','edit','delete','other']));
    const acts=m.app.state.activity.map(a=>a.action);
    s.ok('and those verbs are what the writers logged ('+[...new Set(acts)].join(' | ')+')',['Cutting master added','Cutting master renamed','Cutting master retired','Cutting master reactivated','Production standard updated','Production Ops settings updated','PO draft withdrawn'].every(v=>acts.indexOf(v)>-1));
    s.ok('drafts and cut jobs log nothing (they are frequent saves)',!acts.some(a=>/draft saved|cut job/i.test(a)));
  }
  {
    // forbidden callers write nothing
    const m=mk();
    m.store['pos/PO-001']={id:'PO-001'};m.store['po_drafts/DRAFT-A-AAAA']={id:'DRAFT-A-AAAA',status:'ready',rev:2,createdBy:'uzaib',po:{}};
    await m.call('phLoadAll({force:true})');
    const base=m.log.writes.length;
    const who={raees:RA,qa:QA};
    const code=async(c)=>(await m.call(c)).code;
    const refused=[];
    for(const w of [RA,QA])refused.push(
      await code('phSaveDraft(null,{a:1},'+A(w)+')'),await code('phAppendHistory("PO-001",{type:"scheduled"},'+A(w)+')'),await code('phSaveCutJob("PO-001",{note:"x"},'+A(w)+')'),
      await code('phMasterAdd("X",'+A(w)+')'),await code('phStandardSave("GST073",{unit:"kg",grossPerPiece:1},'+A(w)+')'),await code('phSettingsSave({dailyCapacity:10},'+A(w)+')'),
      await code('phAbandonDraft("DRAFT-A-AAAA","x",'+A(w)+')'));
    s.ok('Raees and the QA account are refused by every writer with code forbidden',refused.every(c=>c==='forbidden'));
    // uzaib: floor actions yes, manager actions no
    const uz=[await code('phMasterAdd("X",'+A(UZ)+')'),await code('phMasterRename("CM-001","Y",'+A(UZ)+')'),await code('phMasterSetActive("CM-001",false,"r",'+A(UZ)+')'),
      await code('phStandardSave("GST073",{unit:"kg",grossPerPiece:1},'+A(UZ)+')'),await code('phSettingsSave({dailyCapacity:10},'+A(UZ)+')'),await code('phSendBackDraft("DRAFT-A-AAAA","x",'+A(UZ)+')')];
    s.ok('uzaib cannot add/rename/retire a master, save a standard or a setting, or send a draft back',uz.every(c=>c==='forbidden'));
    const pc=await m.call('phSettingsSave({pcOnlyHard:true},'+A(MU)+')');
    s.ok('Mustafa cannot flip the hard PC-only switch; an owner-only job status is refused to uzaib',pc.code==='forbidden'&&(await code('phSaveCutJob("PO-001",{status:"overridden"},'+A(UZ)+')'))==='forbidden');
    s.eq('none of those refusals wrote anything',m.log.writes.length,base);
    s.eq('… or opened a transaction',m.log.tx,0);
  }
  {
    // offline: refused out loud, nothing written
    const m=mk({offline:true});
    m.store['pos/PO-001']={id:'PO-001'};
    const calls=['phSaveDraft(null,{a:1},'+A(UZ)+')','phSaveCutJob("PO-001",{note:"x"},'+A(UZ)+')','phAppendHistory("PO-001",{type:"scheduled"},'+A(UZ)+')',
      'phStandardSave("GST073",{unit:"kg",grossPerPiece:1},'+A(AF)+')','phSettingsSave({dailyCapacity:10},'+A(AF)+')','phAbandonDraft("DRAFT-A-AAAA","x",'+A(UZ)+')'];
    const out=[];for(const c of calls)out.push(await m.call(c));
    s.ok('offline: every writer answers code offline with a plain sentence',out.every(r=>r.ok===false&&r.code==='offline'&&/connection/i.test(r.error)));
    s.eq('… and wrote and transacted nothing',m.log.writes.length+m.log.tx,0);
  }
  {
    // refusals and failure mapping
    const m=mk();
    m.store['pos/PO-001']={id:'PO-001'};
    const bad=[
      ['a draft id that is not one','phSaveDraft("bogus",{a:1},'+A(UZ)+')','invalid'],
      ['a draft po that is not an object','phSaveDraft(null,"text",'+A(UZ)+')','invalid'],
      ['editing a draft that does not exist','phSaveDraft("DRAFT-ZZ-ZZZZ",{a:1},'+A(UZ)+')','missing'],
      ['a cut job for a PO that does not exist','phSaveCutJob("PO-404",{note:"x"},'+A(UZ)+')','missing'],
      ['a cut job id that is not a PO id','phSaveCutJob("job-1",{note:"x"},'+A(UZ)+')','invalid'],
      ['a bad planned cut date','phSaveCutJob("PO-001",{plannedCutDate:"20 Oct"},'+A(UZ)+')','invalid'],
      ['a planned fabric with no unit','phSaveCutJob("PO-001",{plannedFabric:{qty:5}},'+A(UZ)+')','invalid'],
      ['a rolls checklist with a fraction','phSaveCutJob("PO-001",{rollsChecklist:{total:1.5,verified:0,short:0,missing:0,extra:0}},'+A(UZ)+')','invalid'],
      ['a master id that is not CM-nnn','phSaveCutJob("PO-001",{masterId:"alam"},'+A(UZ)+')','invalid'],
      ['an unknown job status','phSaveCutJob("PO-001",{status:"finished"},'+A(UZ)+')','invalid'],
      ['a history type with capitals','phAppendHistory("PO-001",{type:"Scheduled"},'+A(UZ)+')','invalid'],
      ['a history row for a bad PO id','phAppendHistory("po1",{type:"scheduled"},'+A(UZ)+')','invalid'],
      ['an empty master name','phMasterAdd("   ",'+A(AF)+')','invalid'],
      ['a standard with unit yards','phStandardSave("GST073",{unit:"yards",grossPerPiece:1},'+A(AF)+')','invalid'],
      ['a standard with zero gross','phStandardSave("GST073",{unit:"kg",grossPerPiece:0},'+A(AF)+')','invalid'],
      ['a standard code with spaces','phStandardSave("gst 073",{unit:"kg",grossPerPiece:1},'+A(AF)+')','invalid'],
      ['a standard with an unknown size model','phStandardSave("GST073",{unit:"kg",grossPerPiece:1,sizeModel:"huge"},'+A(AF)+')','invalid'],
      ['settings capacity 0','phSettingsSave({dailyCapacity:0},'+A(AF)+')','invalid'],
      ['a setting nobody knows','phSettingsSave({colour:"red"},'+A(AF)+')','invalid'],
      ['settings with nothing in them','phSettingsSave({},'+A(AF)+')','invalid'],
      ['every weekday off','phSettingsSave({offWeekdays:[0,1,2,3,4,5,6]},'+A(AF)+')','invalid'],
      ['sending back without a reason','phSendBackDraft("DRAFT-A-AAAA","  ",'+A(AF)+')','invalid'],
      ['retiring a master without a reason','phMasterSetActive("CM-001",false,"",'+A(AF)+')','invalid'],
      ['abandoning a draft without a reason','phAbandonDraft("DRAFT-A-AAAA","   ",'+A(AF)+')','invalid'],
      ['a non-boolean pcOnlyHard','phSettingsSave({pcOnlyHard:"yes"},'+A(AF)+')','invalid']
    ];
    for(const [label,c,code] of bad){const r=await m.call(c);s.ok('refused: '+label+' → '+code,r.ok===false&&r.code===code&&typeof r.error==='string'&&r.error.length>5,J(r).slice(0,120));}
    s.eq('none of those wrote anything',m.log.writes.length,0);
    // stale
    m.store['po_drafts/DRAFT-A-AAAA']={id:'DRAFT-A-AAAA',status:'draft',rev:3,createdBy:'uzaib',po:{}};
    const st=await m.call('phSaveDraft("DRAFT-A-AAAA",{a:1},'+A(UZ,{expectedRev:2})+')');
    s.ok('a stale expectedRev is refused (code stale, current rev reported) and nothing is written',st.ok===false&&st.code==='stale'&&st.rev===3&&m.log.writes.length===0);
    m.store['po_cut_jobs/PO-001']={poId:'PO-001',status:'open',rev:2};
    m.store['ph_settings/main']={dailyCapacity:400,rev:3};
    m.store['ph_standards/GST073']={code:'GST073',unit:'kg',grossPerPiece:0.3,rev:4};
    const before=m.log.writes.length;
    const sj=await m.call('phSaveCutJob("PO-001",{note:"x"},'+A(UZ,{expectedRev:1})+')');
    const ss=await m.call('phSettingsSave({dailyCapacity:420},'+A(AF,{expectedRev:1})+')');
    const sd=await m.call('phStandardSave("GST073",{unit:"kg",grossPerPiece:0.4},'+A(AF,{expectedRev:1})+')');
    s.ok('a stale expectedRev is refused for a cut job, the settings and a standard too (code stale, the current rev reported, nothing written)',
      [sj,ss,sd].every(r=>r.ok===false&&r.code==='stale')&&J([sj.rev,ss.rev,sd.rev])===J([2,3,4])&&m.log.writes.length===before);
    m.store['po_drafts/DRAFT-B-BBBB']={id:'DRAFT-B-BBBB',status:'ready',rev:2,createdBy:'uzaib',po:{}};
    const ed=await m.call('phSaveDraft("DRAFT-B-BBBB",{a:1},'+A(UZ)+')');
    s.ok('a ready draft cannot be edited (send it back first)',ed.ok===false&&ed.code==='refused'&&/send it back/.test(ed.error));
    m.store['po_cut_jobs/PO-001']={poId:'PO-001',status:'done',rev:4};
    const dn=await m.call('phSaveCutJob("PO-001",{note:"x"},'+A(UZ)+')');
    s.ok('a done cut job is never changed again',dn.ok===false&&dn.code==='refused');
    const k=mk();k.store['pos/PO-002']={id:'PO-002'};
    const born=await k.call('phSaveCutJob("PO-002",{status:"done"},'+A(UZ)+')');
    s.ok('a new job asked to start as done is refused',born.ok===false&&born.code==='refused'&&k.log.writes.length===0);
    // an incomplete draft can't be marked ready; the registry unread refuses too
    const u=mk();u.store['po_drafts/DRAFT-A-AAAA']={id:'DRAFT-A-AAAA',status:'draft',rev:1,createdBy:'uzaib',po:GOOD_PO};
    const unread=await u.call('phMarkDraftReady("DRAFT-A-AAAA",'+A(UZ)+')');
    s.ok('mark ready with the master registry NOT loaded is refused (it cannot be checked)',unread.ok===false&&/master registry is not available/.test(unread.error));
    // duplicates
    const dup=mk();dup.store['cutting_masters/CM-001']={id:'CM-001',name:'Alam',nameKey:'alam',active:false,aliases:['old alam']};
    const unr=await dup.call('phMasterAdd("Zed",'+A(AF)+')');
    await dup.call('phLoadAll({force:true})');
    const d1=await dup.call('phMasterAdd("  alam ",'+A(AF)+')'),d2=await dup.call('phMasterAdd("OLD ALAM",'+A(AF)+')');
    s.ok('duplicate master names are refused (case/space-insensitive, retired ones too, old names via aliases); an unread registry refuses',unr.code==='unread'&&d1.code==='exists'&&/retired/.test(d1.error)&&d2.code==='exists');
    s.eq('… with nothing written',dup.log.writes.length,0);
  }
  {
    // failure mapping: nothing throws, nothing is patched locally
    const perm=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
    const m=mk({txThrows:perm});
    m.store['pos/PO-001']={id:'PO-001'};
    const r=await m.call('phSaveCutJob("PO-001",{note:"x"},'+A(UZ)+')');
    s.ok('a rules refusal comes back as code permission, with the republish hint, never thrown',r.ok===false&&r.code==='permission'&&/republish/i.test(r.error));
    const n=mk({txThrows:Object.assign(new Error('Failed to get document because the client is offline.'),{code:'unavailable'})});
    const r2=await n.call('phStandardSave("GST073",{unit:"kg",grossPerPiece:1},'+A(AF)+')');
    s.ok('a transport failure comes back as code offline',r2.ok===false&&r2.code==='offline');
    const o=mk({txThrows:new Error('boom')});
    const r3=await o.call('phSettingsSave({dailyCapacity:10},'+A(AF)+')');
    s.ok('any other error is code failed with the message',r3.ok===false&&r3.code==='failed'&&/boom/.test(r3.error));
    const noDb=loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js'],globals:{db:undefined,runTransaction:undefined}});
    let threw=false,res;try{res=await noDb.run('(async()=>await phSaveDraft(null,{a:1},{actor:{u:"afnan",name:"A"}}))()');}catch(e){threw=true;}
    s.ok('even with no database bridge a writer resolves {ok:false} rather than throwing',!threw&&res&&res.ok===false);
  }
  {
    // the silent-save opt-out is paired for frequent saves
    const calls=[];
    const m=mk({globals:{window:{_gvSilentSaveStart(){calls.push('start');},_gvSilentSaveStop(){calls.push('stop');}}}});
    m.store['pos/PO-001']={id:'PO-001'};
    await m.call('phSaveDraft(null,{a:1},'+A(UZ)+')');
    await m.call('phSaveCutJob("PO-001",{note:"x"},'+A(UZ)+')');
    await m.call('phSaveCutJob("PO-404",{note:"x"},'+A(UZ)+')');
    s.eq('drafts and cut jobs (frequent) opt out of the blocking overlay, start and stop paired, even on a refusal',J(calls),J(['start','stop','start','stop','start','stop']));
    const c2=[];
    const n=mk({globals:{window:{_gvSilentSaveStart(){c2.push('start');},_gvSilentSaveStop(){c2.push('stop');}}}});
    await n.call('phStandardSave("GST073",{unit:"kg",grossPerPiece:1},'+A(AF)+')');
    s.eq('one-off deliberate saves (a standard) keep the normal overlay',c2.length,0);
  }

  /* ═══ 6. source guards ═══ */
  s.section('source: nothing here can write what it must not');
  {
    const code=src=>src.split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n').replace(/\/\*[\s\S]*?\*\//g,'');
    const D=code(SRC_DATA),W=code(SRC_WRITE);
    for(const [n,src] of [['ph-data.js',D],['ph-write.js',W]]){
      s.ok(n+': no deleteDoc, addDoc or arrayUnion/increment/deleteField/serverTimestamp (the last four are not bridged)',!/\b(deleteDoc|addDoc|arrayUnion|increment|deleteField|serverTimestamp)\b/.test(src));
      s.ok(n+': never names counters, gatepasses, bundles, returns, fabricin, fabric_* or the settings collection as a path',!/(?:doc|collection)\(\s*db\s*,\s*['"](counters|gatepasses|bundles|returns|fabricin|fabric_inventory|fabric_movements|fabric_drawstrings|settings|activity|products)['"]/.test(src));
      s.ok(n+': no UTC day (toISOString / toLocale…Date) -- days are PKT strings from js/ph-core.js',!/toISOString|toLocaleDateString|\.getUTC(Date|Month|FullYear)|new Date\(/.test(src));
      s.ok(n+': no prompt / confirm / alert, no inline onclick',!/\b(prompt|confirm|alert)\s*\(|onclick=/.test(src));
      s.ok(n+': no import / export / require (classic script)',!/^\s*(import|export)\s/m.test(src)&&!/\brequire\(/.test(src));
    }
    s.eq('ph-write.js names the pos collection exactly three times: the read of the PO, and two history row paths',(W.match(/'pos'/g)||[]).length,3);
    s.ok('… as doc(db,\'pos\',poId) once (a read) and doc(db,\'pos\',poId,\'history\',…) twice (the cut-job transaction and phAppendHistory)',(W.match(/doc\(db,'pos',poId\)/g)||[]).length===1&&(W.match(/doc\(db,'pos',poId,'history',/g)||[]).length===2);
    s.ok('ph-write.js: the PO document reference is only ever passed to tx.get (never set/update)',!/tx\.(set|update)\(pref/.test(W)&&/tx\.get\(pref\)/.test(W));
    s.ok('ph-data.js names pos once, for the bounded history read',(D.match(/'pos'/g)||[]).length===1&&/collection\(db,'pos',id,'history'\)/.test(D));
    s.ok('every setDoc/updateDoc/tx.set/tx.update target is a po_drafts / po_cut_jobs / ph_* / cutting_masters / history reference',(()=>{
      const targets=[...W.matchAll(/(?:setDoc|updateDoc|tx\.set|tx\.update)\(([A-Za-z_.]+(?:\([^)]*\))?)/g)].map(m=>m[1]);
      return targets.length>10&&targets.every(t=>/^(ref|jref|cref|doc\(db,'(pos|ph_settings|cutting_masters)',)/.test(t));
    })());
    s.ok('the loaders are never async-rejecting: every exported loader is wrapped (phLoadStage catches, phLoadAll catches, phHistoryOf try/catch)',/\.catch\(function\(e\)\{return\{ok:false,stage:key/.test(D)&&/catch\(e\)\{results=/.test(D)&&/catch\(e\)\{\s*const err=phErrInfo\(e\)/.test(D));
  }
  {
    // no two files declare the same top-level name (one shared lexical scope)
    const dir=path.join(ROOT,'js');
    const tops=f=>{const t=read('js/'+f);const out=[];for(const m of t.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm))out.push(m[1]);for(const m of t.matchAll(/^(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm))out.push(m[1]);return out;};
    const mine=['ph-data.js','ph-write.js'];
    const all={};fs.readdirSync(dir).filter(f=>f.endsWith('.js')).forEach(f=>tops(f).forEach(n=>{(all[n]=all[n]||[]).push(f);}));
    const clash=Object.keys(all).filter(n=>all[n].length>1&&all[n].some(f=>mine.indexOf(f)>-1));
    s.eq('no top-level name in ph-data.js / ph-write.js is declared in any other js file (one lexical scope) ['+clash.join(',')+']',clash.length,0);
    s.ok('every new global starts with ph / _ph / PH_ / _PH_',mine.every(f=>tops(f).every(n=>/^(ph|_ph|PH_|_PH_)/.test(n))));
    const w=loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js']});
    s.ok('the three scripts load together in one context (no redeclaration error) and the public API exists',['phLoadAll','phGet','phSaveDraft','phSaveCutJob','phAppendHistory','phMasterAdd','phStandardSave','phSettingsSave','phHistoryOf'].every(n=>w.run('typeof '+n)==='function'));
  }

  /* ═══ 7. the rules text ═══ */
  s.section('rules: the new blocks follow the repo conventions; the old ones are untouched');
  {
    const news=['po_drafts','po_cut_jobs','cutting_masters','ph_standards','ph_settings'];
    for(const c of news){
      const b=matchBlock(c);
      s.ok(c+': read starts `isQaRead() ||`',/allow read:\s*if isQaRead\(\) \|\| signedIn\(\);/.test(b));
      s.ok(c+': delete is refused for everyone',/allow delete:\s*if false;/.test(b));
      s.ok(c+': no combined read/write statement, no request.auth != null',!/allow read,/.test(b)&&!/request\.auth != null/.test(b));
      s.ok(c+': every create/update requires a named, listed shape (not a bare signedIn())',!/allow (create|update|write)[^;]*:\s*if signedIn\(\);/.test(b));
    }
    const hist=braceBlock(matchBlock('pos'),/match\s+\/history\/\{row\}\s*\{/);
    s.ok('pos/{id}/history: update and delete are refused (append-only)',/allow update, delete:\s*if false;/.test(hist));
    s.ok('… create is the Production Ops team only, for a PO that exists after the write, in their own name',/isProdOps\(\)/.test(hist)&&/existsAfter\(\/databases\/\$\(database\)\/documents\/pos\/\$\(doc\)\)/.test(hist)&&/phBy\(/.test(hist));
    s.ok('… read starts isQaRead()',/allow read:\s*if isQaRead\(\) \|\| signedIn\(\);/.test(hist));
    const pos=matchBlock('pos');
    s.ok('the pos document keeps its exact read and write rules (read isQaRead||signedIn, write signedIn)',/allow read:\s+if isQaRead\(\) \|\| signedIn\(\);\s*allow write: if signedIn\(\);/.test(pos));
    for(const line of [
      "match /bundles/{doc}              { allow read: if isQaRead() || signedIn(); allow write: if signedIn(); }",
      "match /gatepasses/{doc}           { allow read: if isQaRead() || signedIn(); allow write: if signedIn(); }",
      "match /counters/{doc}             { allow read: if isQaRead() || signedIn(); allow write: if signedIn(); }",
      "match /activity/{doc}             { allow read: if isQaRead() || signedIn(); allow write: if signedIn(); }"])
      s.ok('unchanged line: '+line.slice(0,60).replace(/\s+/g,' ')+'…',RULES.indexOf(line)>-1);
    s.ok('settings/{doc} is untouched (owner write): the Production Ops switches live in the NEW ph_settings',/match \/settings\/\{doc\} \{\s*allow read: if isQaRead\(\) \|\| \(signedIn\(\)\);\s*allow write: if isOwner\(\);\s*\}/.test(RULES));
    s.ok('pcOnlyHard needs an owner (create and update)',/get\('pcOnlyHard', false\) == false \|\| isOwner\(\)/.test(matchBlock('ph_settings'))&&/get\('pcOnlyHard', false\) == resource\.data\.get\('pcOnlyHard', false\) \|\| isOwner\(\)/.test(matchBlock('ph_settings')));
    s.ok('masters, standards and settings need a manager; drafts, jobs and history need the audience',
      /isProdOpsManager\(\)/.test(matchBlock('cutting_masters'))&&/isProdOpsManager\(\)/.test(matchBlock('ph_standards'))&&/isProdOpsManager\(\)/.test(matchBlock('ph_settings'))
      &&/isProdOps\(\)/.test(matchBlock('po_drafts'))&&/isProdOps\(\)/.test(matchBlock('po_cut_jobs'))&&!/isProdOpsManager\(\)\s*&&\s*id\.matches\('\^DRAFT/.test(matchBlock('po_drafts')));
  }

  /* ═══ 8. the three places ═══ */
  s.section('wiring: script tags in order, precached, cache version moved');
  {
    const html=read('index.html'),sw=read('sw.js');
    const tag=f=>html.indexOf('/js/'+f+'?v=');
    s.ok('ph-data.js and ph-write.js have script tags, after ph-core.js and before the Firebase module',tag('ph-core.js')>0&&tag('ph-data.js')>tag('ph-core.js')&&tag('ph-write.js')>tag('ph-data.js')&&html.indexOf('<script type="module">')>tag('ph-write.js'));
    s.ok('both are in PRECACHE_URLS',/'\/js\/ph-data\.js'/.test(sw)&&/'\/js\/ph-write\.js'/.test(sw));
    s.ok('the ?v= tags of the new scripts are not the old ph-core one',/ph-data\.js\?v=[0-9a-z]+/.test(html)&&/ph-write\.js\?v=[0-9a-z]+/.test(html));
    s.ok('CACHE_VERSION moved past v311',/CACHE_VERSION = 'v312'/.test(sw));
  }
  return s;
};

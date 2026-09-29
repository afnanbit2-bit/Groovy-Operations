/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts — the pages and the writer (js/master-accounts.js, M1.3)

   The core (js/ma-core.js) has its own suite. This one drives the REAL
   writer paths against a stubbed Firestore that records every operation of
   every transaction, and holds what the rules demand of them:
   - a new document is ONE transaction: the counter, the document (its id IS
     its number, its quarter is its date's July-FY quarter, `by` is the
     signer) and an audit row; a refusal writes nothing at all;
   - flags are stored on the document and reach the review queue;
   - edit / void / confirm / review patch exactly the keys the rules allow;
   - a refused read is an error card naming the collection, never a zero;
   - the drawer is mirrored from Store Accounts, and a failed mirror is
     "incomplete", never a smaller number shown as whole;
   - the audience is Afnan and Ammar by username, equal to the rules' emails;
   - party names and notes are escaped wherever they are painted.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const clone=v=>JSON.parse(JSON.stringify(v));

function memLS(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];}};}

/* A Firestore that keeps what is written and records every op. */
function mkApp(o){
  o=o||{};
  const db=o.seed?clone(o.seed):{};
  const S={tx:[],batches:[],sets:[],reads:0};
  const col=c=>(db[c]=db[c]||{});
  const snap=(c,id)=>{const d=col(c)[id];return {exists:()=>d!==undefined,data:()=>clone(d===undefined?{}:d)};};
  const globals=Object.assign({
    localStorage:memLS(),
    doc:(_db,c,id)=>({col:c,id}),
    collection:(_db,c)=>({col:c}),
    query:c=>c,orderBy:()=>({}),limit:()=>({}),
    getDocs:async q=>{
      S.reads++;
      if((o.fail||[]).indexOf(q.col)>=0)throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      return {docs:Object.keys(col(q.col)).map(id=>({id,data:()=>clone(col(q.col)[id])}))};
    },
    runTransaction:async(_db,fn)=>{
      const ops=[];S.tx.push(ops);
      await fn({get:async ref=>snap(ref.col,ref.id),set:(ref,d)=>{ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},update:(ref,d)=>{ops.push({op:'update',col:ref.col,id:ref.id,data:clone(d)});}});
      ops.forEach(x=>{if(x.op==='set')col(x.col)[x.id]=clone(x.data);else col(x.col)[x.id]=Object.assign({},col(x.col)[x.id],clone(x.data));});
    },
    writeBatch:()=>{const ops=[];S.batches.push(ops);return{set(ref,d){ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},async commit(){ops.forEach(x=>{col(x.col)[x.id]=clone(x.data);});}};},
    setDoc:async(ref,d)=>{S.sets.push({col:ref.col,id:ref.id,data:clone(d)});},
    auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date().toUTCString()}}}
  },o.globals||{});
  const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:'ma-overview',
    session:o.session||{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},globals});
  return {app,S,db};
}
/* A document the way the writer stores it — built by the core. */
function built(app,dt,input,meta,no){
  const d=JSON.parse(app.run('JSON.stringify((()=>{const d=maBuildDoc('+J(dt)+','+J(input)+','+J(meta)+',maChartIndex(maChart("groovy")),MA_DEFAULT_SETTINGS);return d;})())'));
  d.no=no;d.id=no;return d;
}
const set=(app,id,v)=>{app.el(id).value=v;};

module.exports=async function(){
  const s=suite('master-accounts');
  const T0=Date.UTC(2026,6,1,6);

  s.section('the audience — Afnan and Ammar by username, the same two as the rules');
  {
    const rules=read('firestore.rules');
    const m=/function isMasterAccounts\(\)\s*\{[\s\S]*?in\s*\[([^\]]*)\]/.exec(rules);
    const emails=m?(m[1].match(/'([^']+)'/g)||[]).map(x=>x.replace(/'/g,'')):[];
    const {app}=mkApp();
    const users=JSON.parse(app.run('JSON.stringify(_MA_USERS)'));
    s.eq('the rules name two emails',emails.length,2);
    s.eq('_MA_USERS is the rules\' list, by username',J(users.slice().sort()),J(emails.map(e=>e.split('@')[0]).sort()));
    s.ok('every rules email is @groovy.op',emails.every(e=>/@groovy\.op$/.test(e)));
    s.eq('afnan sees it',app.run('maCanSee()'),true);
    app.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    s.eq('ammar sees it',app.run('maCanSee()'),true);
    app.run("session={uid:'u-zed',u:'zed',name:'Zed',role:'owner',email:'zed@groovy.op'}");
    s.eq('another owner does not — it is a list, not the role',app.run('maCanSee()'),false);
  }
  {
    const {app,S}=mkApp({session:{uid:'u-must',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'}});
    s.eq('Mustafa gets no nav items',app.run('maNavItems().length'),0);
    app.run("maRenderPage('ma-overview')");
    const html=app.el('main-content').innerHTML;
    s.ok('maRenderPage refuses Mustafa in words',/for Afnan and Ammar/.test(html),html.slice(0,120));
    s.eq('and reads nothing for him',S.reads,0);
    s.eq('Record refuses too (nothing loaded, nothing opened)',app.run("window.maRecord();_maF"),null);
  }
  {
    // The real buildNav(), per account (the store-access pattern).
    const LS={getItem:()=>null,setItem(){},removeItem(){}};
    const NAV=['js/shared.js','js/auth.js','js/embellishments.js','js/hrm.js','js/store.js','js/store-accounts.js','js/ma-core.js','js/master-accounts.js'];
    const nav=u=>{
      const b=harness.loadApp({files:NAV,currentPage:'dashboard',globals:{localStorage:LS}});
      const def=JSON.parse(b.run('JSON.stringify(USER_DEFS.find(x=>x.u==='+J(u)+'))'));
      b.run('session='+J(Object.assign({uid:'u-'+u},def)));
      b.run('buildNav()');
      return b.el('sidebar').innerHTML||'';
    };
    const af=nav('afnan'),am=nav('ammar'),mu=nav('mustafa'),ar=nav('arfat'),ra=nav('raees');
    s.ok('Afnan\'s sidebar carries the Master Accounts section',/nav-ma-toggle/.test(af)&&/showPage\('ma-overview'\)/.test(af));
    s.ok('and every M1 page',['ma-overview','ma-money','ma-out','ma-parties','ma-ledger','ma-close'].every(id=>af.indexOf("showPage('"+id+"')")>=0));
    s.ok('Ammar\'s does too',/nav-ma-toggle/.test(am));
    s.ok('Mustafa\'s does not',!/nav-ma-toggle|ma-overview/.test(mu));
    s.ok('Arfat\'s does not',!/nav-ma-toggle/.test(ar));
    s.ok('Raees\'s does not',!/nav-ma-toggle/.test(ra));
    s.ok('the section is labelled Master Accounts, not Accounts',/<span>Master Accounts<\/span>/.test(af));
  }

  s.section('the loader never rejects — a refused read is a card naming it');
  {
    const {app}=mkApp({fail:['ma_journal']});
    await app.run('maLoad()');
    const html=app.run("_maPageHTML('ma-overview')");
    s.ok('the card names ma_journal',/Could not read ma_journal/.test(html));
    s.ok('it offers Retry',/maRetry\(\)/.test(html));
    s.ok('and shows no Cash in hand at all (never a zero)',!/Cash in hand/.test(html));
    const led=app.run("_maPageHTML('ma-ledger')");
    s.ok('every page says the same, not an empty ledger',/Could not read ma_journal/.test(led)&&!/0 postings/.test(led));
    const {app:b}=mkApp({fail:['ma_audit']});
    await b.run('maLoad()');
    s.ok('a failed audit read does not block Today',/Cash in hand/.test(b.run("_maPageHTML('ma-overview')")));
    b.run("_maCloseTab='audit'");
    s.ok('it is named on the audit tab instead',/Could not read ma_audit/.test(b.run("_maPageHTML('ma-close')")));
    const {app:c}=mkApp({globals:{getDocs:async()=>{throw new Error('offline');}}});
    let threw=false;try{await c.run('maLoad()');}catch(e){threw=true;}
    s.eq('with every read failing, maLoad still resolves',threw,false);
  }

  s.section('the drawer is mirrored from Store Accounts');
  {
    const {app}=mkApp({globals:{loadAccountsData:async()=>{},_acctBalances:()=>({cash:12345.4}),_acctLoadErr:null}});
    await app.run('maLoad()');
    s.eq('mirrorOk, the drawer\'s cash from _acctBalances',app.run("_maCtx().holders.find(h=>h.code==='1010').balance"),12345);
    // `waiting` joined the shape with review V4 (what the total leaves out
    // while a handover waits to go into the drawer) — none here.
    s.eq('cash in hand includes it and is complete',app.run("JSON.stringify(maCashInHand(_maCtx().holders))"),J({total:12345,complete:true,holders:4,waiting:0}));
    const {app:b}=mkApp({globals:{loadAccountsData:async()=>{},_acctBalances:()=>({cash:999}),_acctLoadErr:{cols:['acct_entries']}}});
    await b.run('maLoad()');
    s.eq('a failed Store read → mirrorOk false, balance null',b.run("JSON.stringify(_maCtx().holders.find(h=>h.code==='1010'))").indexOf('"balance":null')>=0,true);
    s.eq('cash in hand says incomplete',b.run('maCashInHand(_maCtx().holders).complete'),false);
    const html=b.run("_maPageHTML('ma-overview')");
    s.ok('Today says the drawer was not read',/drawer not read/.test(html)&&/not read/.test(html));
    const {app:c}=mkApp();
    await c.run('maLoad()');
    s.eq('no Store module at all → not read, never zero',c.run("_maCtx().holders.find(h=>h.code==='1010').balance"),null);
  }

  s.section('the writer — one transaction: counter + document + audit');
  {
    const seed={ma_journal:{}};
    const {app}=mkApp();
    const cap=built(app,'journal',{kind:'capital',date:'2026-07-01',holder:'1011',owner:'afnan',amount:100000},{by:'afnan',byName:'Afnan',ts:T0},'JV-27-0001');
    seed.ma_journal[cap.no]=cap;
    seed.ma_counters={journal:{FY27:1}};
    const {app:a,S,db}=mkApp({seed});
    await a.run('maLoad()');
    a.run("window.maRecordKind('money_out')");
    s.ok('the form opens in a modal',/Money out/.test(a.bodyHtml('ma-modal-back')));
    // Updated deliberately in M1.6b (money N1): the form still starts on No
    // tax with no party, but no longer calls that a choice — it says it is a
    // preset, and a party's usual tax replaces it (master-accounts-screens).
    s.ok('the tax block starts on No tax — said to be a preset, not a choice',/value="none"/.test(a.bodyHtml('ma-modal-back'))&&/No tax is pre-set, not chosen/.test(a.bodyHtml('ma-modal-back'))&&!/chosen, not assumed/.test(a.bodyHtml('ma-modal-back')));
    s.ok('the drawer is left out of the holders, with its reason',!/value="1010"/.test(a.bodyHtml('ma-modal-back'))&&/Store Accounts until M8/.test(a.bodyHtml('ma-modal-back')));
    // A refusal writes nothing.
    set(a,'ma-f-date','2026-09-01');set(a,'ma-f-holder','1011');set(a,'ma-f-account','6050');set(a,'ma-f-payee','Plumber');set(a,'ma-f-amount','');set(a,'ma-f-taxkind','none');
    await a.run('window.maSaveForm()');
    s.eq('an empty amount is refused — no transaction',S.tx.length,0);
    s.ok('the refusal is shown under the field',/whole rupees/.test(a.el('ma-e-amount').textContent),a.el('ma-e-amount').textContent);
    set(a,'ma-f-date','2099-01-01');set(a,'ma-f-amount','1500');
    await a.run('window.maSaveForm()');
    s.eq('a future date is refused — no transaction',S.tx.length,0);
    // Clean: under the evidence threshold, money in the holder.
    set(a,'ma-f-date','2026-09-01');
    await a.run('window.maSaveForm()');
    s.eq('a clean document is ONE transaction',S.tx.length,1);
    const ops=S.tx[0].filter(x=>x.op==='set');
    const counter=ops.find(x=>x.col==='ma_counters'),d=ops.find(x=>x.col==='ma_journal'),au=ops.find(x=>x.col==='ma_audit');
    s.ok('it writes the counter, the document and an audit row',!!(counter&&d&&au)&&ops.length===3,J(ops.map(x=>x.col)));
    s.eq('the counter moves FY27 on to 2',counter&&counter.data.FY27,2);
    s.eq('the document id IS its number',d&&d.id,'JV-27-0002');
    s.eq('no == id',d&&d.data.no,d&&d.id);
    s.eq('id stored on the document too',d&&d.data.id,'JV-27-0002');
    s.eq('its quarter is the date\'s July-FY quarter',d&&d.data.quarter,'2027-Q1');
    s.eq('by is the signer\'s username',d&&d.data.by,'afnan');
    s.eq('rev 1, no edits, posted',J([d.data.rev,d.data.edits,d.data.status]),J([1,[],'posted']));
    s.ok('no flags on a clean one',!d.data.flags);
    s.eq('the audit row: post, by afnan, a number time',J([au.data.action,au.data.by,typeof au.data.at,au.data.target&&au.data.target.no]),J(['post','afnan','number','JV-27-0002']));
    s.ok('the store holds it now',!!db.ma_journal['JV-27-0002']);
    s.ok('and the page\'s own copy too',a.run("maData.journal.some(d=>d.id==='JV-27-0002')"));
    s.eq('the modal closed',a.run('_maF'),null);

    // Flags: shown first, stored on the second press, and queued.
    a.run("window.maRecordKind('money_out')");
    set(a,'ma-f-date','2026-09-02');set(a,'ma-f-holder','1011');set(a,'ma-f-account','6050');set(a,'ma-f-payee','Painter');set(a,'ma-f-amount','5000');set(a,'ma-f-taxkind','none');set(a,'ma-f-costCentre','factory');
    await a.run('window.maSaveForm()');
    s.eq('a flagged document is NOT written on the first press',S.tx.length,1);
    s.ok('the flag is shown',/No bill or receipt attached/.test(a.el('ma-f-issues').innerHTML));
    await a.run('window.maSaveForm()');
    s.eq('the second press writes it',S.tx.length,2);
    const f=S.tx[1].find(x=>x.col==='ma_journal');
    s.ok('the flags are stored on the document',f&&Array.isArray(f.data.flags)&&f.data.flags.some(x=>x.rule==='evidence.missing'),J(f&&f.data.flags));
    s.eq('its number is the next one',f&&f.id,'JV-27-0003');
    s.ok('it waits in the review queue',a.run("maReviewQueue(_maCtx().docs).some(d=>d.id==='JV-27-0003')"));
    s.ok('the Ledger review tab lists it',(a.run("_maLedgerTab='review';_maPageHTML('ma-ledger')")).indexOf('JV-27-0003')>=0);

    // Offline: says so, writes nothing.
    a.ctx.navigator.onLine=false;
    a.run("window.maRecordKind('money_out')");
    set(a,'ma-f-date','2026-09-03');set(a,'ma-f-holder','1011');set(a,'ma-f-account','6050');set(a,'ma-f-payee','Tea');set(a,'ma-f-amount','300');set(a,'ma-f-taxkind','none');
    const toasts=[];a.ctx.showToast=m=>toasts.push(m);
    await a.run('window.maSaveForm()');
    s.eq('offline: no transaction',S.tx.length,2);
    s.ok('and it says a connection is needed',toasts.some(t=>/needs a connection/.test(t)),J(toasts));
    a.ctx.navigator.onLine=true;
    a.run('window.maCloseModal()');

    // A transaction that fails spends no number and says so.
    const {app:x,S:SX}=mkApp({seed,globals:{runTransaction:async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});}}});
    await x.run('maLoad()');
    x.run("window.maRecordKind('money_out')");
    set(x,'ma-f-date','2026-09-01');set(x,'ma-f-holder','1011');set(x,'ma-f-account','6050');set(x,'ma-f-payee','Plumber');set(x,'ma-f-amount','1500');set(x,'ma-f-taxkind','none');
    await x.run('window.maSaveForm()');
    s.ok('a refused write names the rules and says nothing was saved',/Firestore rules/.test(x.el('ma-f-issues').innerHTML)&&/Nothing was saved/.test(x.el('ma-f-issues').innerHTML));
    s.eq('and nothing was added to the page\'s copy',x.run('maData.journal.length'),1);

    // Edit: rev + 1, the row by the editor naming the changed field, the
    // flags and every untouched key kept.
    a.run("window.maEditDoc('journal','JV-27-0003')");
    s.ok('the edit form opens prefilled',/Edit JV-27-0003/.test(a.bodyHtml('ma-modal-back')));
    set(a,'ma-f-date','2026-09-02');set(a,'ma-f-holder','1011');set(a,'ma-f-account','6050');set(a,'ma-f-payee','Painter');set(a,'ma-f-amount','5200');set(a,'ma-f-taxkind','none');
    set(a,'ma-f-costCentre','factory');set(a,'ma-f-labelKind','');set(a,'ma-f-po','');set(a,'ma-f-article','');set(a,'ma-f-commitmentId','');set(a,'ma-f-commitmentPeriod','');set(a,'ma-f-tags','');set(a,'ma-f-note','');
    set(a,'ma-f-reason','');
    await a.run('window.maSaveForm()');
    s.eq('an edit with no reason is refused',S.tx.length,2);
    set(a,'ma-f-reason','the bill said 5,200');
    await a.run('window.maSaveForm()');
    if(S.tx.length===2)await a.run('window.maSaveForm()');   // acknowledge the evidence flag
    s.eq('the edit is one transaction',S.tx.length,3);
    const before=db.ma_journal['JV-27-0003'];
    const e=S.tx[2].find(x=>x.col==='ma_journal');
    s.eq('rev 2',e&&e.data.rev,2);
    s.eq('one edit row, by afnan, naming amount',J(e&&e.data.edits.map(r=>[r.by,r.fields])),J([['afnan',['amount']]]));
    s.ok('the flags are kept',e&&e.data.flags&&e.data.flags.length>0);
    s.eq('id and no kept',J([e.data.id,e.data.no]),J(['JV-27-0003','JV-27-0003']));
    const f3=S.tx[1].find(x=>x.col==='ma_journal').data;
    const changed=Object.keys(Object.assign({},f3,e.data)).filter(k=>J(f3[k])!==J(e.data[k]));
    // M1.6a: the derived list is the core's (and the rules', held equal
    // below) — amount and tax are NOT in it, so a moved amount is named.
    const derived=JSON.parse(a.run('JSON.stringify(MA_EDIT_DERIVED)'));
    const allowed=derived.concat(JSON.parse(a.run('JSON.stringify(MA_EDIT_FIELDS.journal)')));
    s.ok('every changed key is one the rules allow',changed.every(k=>allowed.indexOf(k)>=0),J(changed));
    s.ok('and every changed non-derived key is named in the row',changed.filter(k=>derived.indexOf(k)<0).every(k=>e.data.edits[0].fields.indexOf(k)>=0),J(changed));
    s.ok('…amount among them — it moved, so the row names it',changed.indexOf('amount')>=0&&e.data.edits[0].fields.indexOf('amount')>=0);
    s.ok('an audit row "edit" goes with it',S.tx[2].some(x=>x.col==='ma_audit'&&x.data.action==='edit'));

    // Review: exactly the two review keys, in the reviewer's name.
    await a.run("window.maReviewDoc('journal','JV-27-0003')");
    const rv=S.tx[3].find(x=>x.op==='update');
    s.eq('review patches exactly reviewedAt and reviewedBy',J(Object.keys(rv.data).sort()),J(['reviewedAt','reviewedBy']));
    s.eq('in the reviewer\'s own name',rv.data.reviewedBy,'afnan');
    s.ok('it leaves the review queue',!a.run("maReviewQueue(_maCtx().docs).some(d=>d.id==='JV-27-0003')"));

    // Void: exactly the void keys; a void with no reason is refused.
    a.ctx.prompt=()=>'  ';
    await a.run("window.maVoidDoc('journal','JV-27-0002')");
    s.eq('a void with no reason writes nothing',S.tx.length,4);
    a.ctx.prompt=()=>'entered twice';
    await a.run("window.maVoidDoc('journal','JV-27-0002')");
    const vd=S.tx[4].find(x=>x.op==='update');
    s.eq('void patches exactly the five void keys',J(Object.keys(vd.data).sort()),J(['status','voidReason','voidedAt','voidedBy','voidedByName']));
    s.eq('status void, by afnan, the reason kept',J([vd.data.status,vd.data.voidedBy,vd.data.voidReason]),J(['void','afnan','entered twice']));
    s.ok('an audit row "void"',S.tx[4].some(x=>x.col==='ma_audit'&&x.data.action==='void'));
    s.ok('a void posts nothing',a.run("_maCtx().lines.every(l=>l.doc.id!=='JV-27-0002')"));

    // A transfer into Ammar's hands waits; Ammar confirms it.
    a.run("window.maRecordKind('transfer')");
    set(a,'ma-f-date','2026-09-05');set(a,'ma-f-from','1011');set(a,'ma-f-to','1012');set(a,'ma-f-amount','20000');set(a,'ma-f-note','');
    await a.run('window.maSaveForm()');
    const tr=S.tx[5].find(x=>x.col==='ma_transfer');
    s.eq('a transfer to Ammar is born pending, TR-27-0001',J([tr&&tr.id,tr&&tr.data.status,tr&&tr.data.confirmBy]),J(['TR-27-0001','pending','ammar']));
    s.ok('pending counts in neither holder',a.run("_maCtx().lines.every(l=>l.doc.id!=='TR-27-0001')"));
    s.ok('Afnan is not offered Confirm on it',!/maConfirmDoc\('TR-27-0001'\)/.test(a.run("_maPageHTML('ma-money')")));
    a.run("session={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'}");
    s.ok('Ammar is',/maConfirmDoc\('TR-27-0001'\)/.test(a.run("_maInvalidate();_maPageHTML('ma-money')")));
    await a.run("window.maConfirmDoc('TR-27-0001')");
    const cf=S.tx[6].find(x=>x.op==='update');
    s.eq('confirm patches exactly the confirm keys',J(Object.keys(cf.data).sort()),J(['confirmVia','confirmedAt','confirmedBy','status']));
    s.eq('posted, by ammar, in the app',J([cf.data.status,cf.data.confirmedBy,cf.data.confirmVia]),J(['posted','ammar','app']));
    s.eq('and now it counts in Ammar\'s cash',a.run("maBalanceOf(_maCtx().lines,_maCtx().idx,'1012')"),20000);
  }

  s.section('the pages paint, and escape what people typed');
  {
    const bad='<img src=x onerror=alert(1)>';
    const seed={ma_parties:{p1:{id:'p1',kind:'vendor',name:bad,code:'IMGX',active:true,notes:'<script>x()</script>',contact:{person:'"quoted"',phone:''},vendor:{roles:['printing'],tax:{regime:'none'},terms:{mode:'credit',creditDays:30,from:'2026-07-01'},termsHistory:[{mode:'cash',from:'2026-07-01',to:'2026-07-31',by:'afnan',reason:'<b>moved</b>'}],rateCard:[{id:'r1',item:'<i>tee</i>',unit:'piece',rate:45,validFrom:'2026-07-01'}]}}},
      ma_commitments:{c1:{id:'c1',name:'Rent <u>factory</u>',kind:'fixed',cadence:'monthly',dueDay:5,amountExpected:150000,account:'6040',holder:'1020',party:'p1',active:true}}};
    const {app}=mkApp({seed});
    await app.run('maLoad()');
    const list=app.run("_maPageHTML('ma-parties')");
    s.ok('the parties list escapes a name',list.indexOf('&lt;img src=x onerror=alert(1)&gt;')>=0&&list.indexOf('<img src=x')<0);
    app.run("_maPartyId='p1'");
    const page=app.run("_maPageHTML('ma-party')");
    s.ok('the party page escapes the name, notes, contact, terms reason and rate item',page.indexOf('<img src=x')<0&&page.indexOf('<script>')<0&&page.indexOf('<b>moved')<0&&page.indexOf('<i>tee')<0&&page.indexOf('&lt;script&gt;')>=0);
    const out=app.run("_maPageHTML('ma-out')");
    s.ok('the cost register escapes a commitment name',out.indexOf('<u>factory')<0&&out.indexOf('&lt;u&gt;factory')>=0);
    const today=app.run("_maPageHTML('ma-overview')");
    s.ok('Today escapes a commitment named in a concern',today.indexOf('<u>factory')<0);
    s.ok('Today carries the four figures',['Cash in hand','In this month','Out this month','Owed to us less we owe'].every(x=>today.indexOf(x)>=0));
    s.ok('and never an uppercase transform or letter-spacing in the module CSS',!/\.ma-[^{]*\{[^}]*(text-transform:uppercase|letter-spacing:\.0[5-9]|letter-spacing:[1-9])/.test(read('css/main.css')));
    ['ma-overview','ma-money','ma-out','ma-parties','ma-ledger','ma-close'].forEach(id=>{
      let h='';try{h=app.run("_maPageHTML('"+id+"')");}catch(e){h='THREW '+e.message;}
      s.ok(id+' paints, with the Record button',/maRecord\(\)/.test(h),h.slice(0,80));
    });
    ['audit','settings','chart','items'].forEach(t=>{let h='';try{h=app.run("_maCloseTab='"+t+"';_maPageHTML('ma-close')");}catch(e){h='THREW '+e.message;}s.ok('Close & audit → '+t+' paints',/ma-tabs/.test(h),h.slice(0,80));});
    ['documents','unlabelled','review'].forEach(t=>{let h='';try{h=app.run("_maLedgerTab='"+t+"';_maPageHTML('ma-ledger')");}catch(e){h='THREW '+e.message;}s.ok('Ledger → '+t+' paints',/ma-tabs/.test(h),h.slice(0,80));});
    s.ok('Money out has no empty tab strip (Commitments only in M1)',!/ma-tabs/.test(out));
    app.run("window.maRecord()");
    const pick=app.bodyHtml('ma-modal-back');
    s.ok('the Record picker offers the live kinds',['Money out','Money in','Transfer','Count','Owner put money in','Owner took money out','Opening balance','Journal','Commitment'].every(x=>pick.indexOf('>'+x+'<')>=0));
    s.ok('and names the coming ones with their milestone',/Collection<\/b><span>arrives with M2/.test(pick)&&/Bill<\/b><span>arrives with M3/.test(pick)&&/Savings entry<\/b><span>arrives with M4/.test(pick));
    s.ok('a coming tile is not a button',!/<button[^>]*maRecordKind\('bill'\)/.test(pick));
    // From a party page the form comes prefilled with the party.
    app.run("_maPage='ma-party';_maPartyId='p1';window.maRecordKind('money_out')");
    s.ok('Record on a party page prefills the party',/<option value="p1" selected>/.test(app.bodyHtml('ma-modal-back')));
    app.run("window.maPayCommitment('c1','')");
    const pay=app.bodyHtml('ma-modal-back');
    s.ok('Record payment on a commitment prefills commitment, account and holder',/<option value="c1" selected>/.test(pay)&&/<option value="6040" selected>/.test(pay)&&/<option value="1020" selected>/.test(pay));
  }

  s.section('a new party from any form, and its audit row');
  {
    const {app,S}=mkApp();
    await app.run('maLoad()');
    app.run("window.maRecordKind('money_out')");
    set(app,'ma-f-npname','Al-Hamd Washing');set(app,'ma-f-npkind','vendor');
    await app.run('window.maInlineParty()');
    const b=S.batches[0]||[];
    const p=b.find(x=>x.col==='ma_parties'),au=b.find(x=>x.col==='ma_audit');
    s.ok('one batch: the party and its audit row',!!(p&&au)&&b.length===2,J(b.map(x=>x.col)));
    s.eq('a code is minted from the name',p&&p.data.code,'ALHA');
    s.ok('a vendor starts on cash terms from today',p&&p.data.vendor&&p.data.vendor.terms.mode==='cash');
    s.eq('the audit row is "party", by afnan',J([au.data.action,au.data.by]),J(['party','afnan']));
    s.ok('the form\'s party select now picks it',/value="p_[^"]+" selected/.test(app.el('ma-f-party').innerHTML));
  }

  s.section('the PDFs — on the right pages, for the right documents (M1.4)');
  {
    const {app:b}=mkApp();
    const m=(t,x)=>Object.assign({by:'afnan',byName:'Afnan',ts:T0+t},x||{});
    const cap=built(b,'journal',{kind:'capital',date:'2026-07-02',holder:'1011',owner:'afnan',amount:300000,note:'Wages'},m(1),'JV-27-0001');
    const out=built(b,'journal',{kind:'money_out',date:'2026-07-05',holder:'1011',account:'5030',party:'p1',amount:20000,tax:{kind:'withholding',rate:4},note:'Printing'},m(2),'JV-27-0002');
    const trf=built(b,'transfer',{date:'2026-07-06',from:'1011',to:'1012',amount:50000,note:'Float'},m(3),'TR-27-0001');
    const cnt=built(b,'count',{date:'2026-07-07',holder:'1011',counted:229000},m(4,{bookBalance:230000}),'CT-27-0001');
    const tv=JSON.parse(b.run('JSON.stringify(maApplyVoid('+J(built(b,'transfer',{date:'2026-07-08',from:'1011',to:'1020',amount:1000},m(5),'TR-27-0002'))+',{at:'+(T0+9)+',by:"afnan",byName:"Afnan",reason:"Wrong day"}))'));
    const seed={ma_journal:{[cap.no]:cap,[out.no]:out},ma_transfer:{[trf.no]:trf,[tv.no]:tv},ma_counts:{[cnt.no]:cnt},
      ma_parties:{p1:{id:'p1',kind:'vendor',name:'Asghar Printers',code:'ASG',active:true,vendor:{terms:{mode:'credit',creditDays:30,from:'2026-07-01'}}}}};
    const {app,S}=mkApp({seed});
    await app.run('maLoad()');
    const calls=[];
    app.ctx.printDocument=o=>{calls.push(o);return Promise.resolve({blob:{},filename:o.filename});};
    const toasts=app.state.toasts;
    const rail=(dt,id)=>app.run("_maRail={kind:'doc',dt:"+J(dt)+",id:"+J(id)+"};_maPageHTML('ma-ledger')");
    const btns=h=>['Receipt (PDF)','Voucher (PDF)'].filter(x=>h.indexOf(x)>=0).join(',');
    s.eq('a transfer\'s rail offers its receipt, and only that',btns(rail('transfer','TR-27-0001')),'Receipt (PDF)');
    s.ok('…wired to maDocPdf for that transfer',/window\.maDocPdf\('transfer','TR-27-0001'\)/.test(rail('transfer','TR-27-0001')));
    s.eq('a Money out\'s rail offers its voucher, and only that',btns(rail('journal','JV-27-0002')),'Voucher (PDF)');
    s.eq('a capital journal offers neither',btns(rail('journal','JV-27-0001')),'');
    s.eq('a count offers neither',btns(rail('count','CT-27-0001')),'');
    s.eq('a VOID transfer still offers its receipt — it prints VOID',btns(rail('transfer','TR-27-0002')),'Receipt (PDF)');
    app.run('_maRail=null');

    await app.run("window.maDocPdf('transfer','TR-27-0001')");
    const c0=calls[0]||{};
    s.eq('Receipt → the ma-receipt variant, named Receipt-<no>.pdf',J([c0.type,c0.filename]),J(['ma-receipt','Receipt-TR-27-0001.pdf']));
    s.ok('…its data is the core\'s receipt for that transfer',c0.data&&c0.data.no==='TR-27-0001'&&c0.data.amount===50000&&c0.data.amountWords==='Rupees Fifty Thousand Only'&&c0.data.state==='pending'&&c0.data.waitingFor==='Ammar',J(c0.data&&[c0.data.state,c0.data.waitingFor]));
    s.ok('…and never deliver:"blob" — the person gets the tab and the download',!('deliver' in c0));
    await app.run("window.maDocPdf('journal','JV-27-0002')");
    const c1=calls[1]||{};
    s.eq('Voucher → the ma-voucher variant, named Voucher-<no>.pdf',J([c1.type,c1.filename]),J(['ma-voucher','Voucher-JV-27-0002.pdf']));
    s.ok('…paid to the party, the cash that left, the tax block',c1.data&&c1.data.paidTo.name==='Asghar Printers'&&c1.data.paid===19200&&c1.data.tax&&c1.data.tax.kind==='withholding');
    await app.run("window.maDocPdf('transfer','TR-27-0002')");
    const c2=calls[2]||{};
    s.eq('a void receipt says so in its file name too',c2.filename,'Receipt-TR-27-0002-VOID.pdf');
    s.eq('…and in its data',c2.data&&c2.data.state,'void');
    const n=calls.length;
    await app.run("window.maDocPdf('journal','JV-27-0001')");
    await app.run("window.maDocPdf('count','CT-27-0001')");
    s.eq('a capital journal or a count prints nothing',calls.length,n);
    s.ok('…and says why',toasts.filter(t=>/^Only a transfer \(its receipt\) or a Money out \(its voucher\) has a PDF of its own/.test(t)).length===2,J(toasts));
    const ex=S.sets.filter(x=>x.col==='ma_audit'&&x.data.action==='export').map(x=>[x.data.detail,x.data.target&&x.data.target.no]);
    s.eq('each PDF leaves one export row in the audit, naming the file and the document',J(ex),J([['PDF · Receipt-TR-27-0001.pdf','TR-27-0001'],['PDF · Voucher-JV-27-0002.pdf','JV-27-0002'],['PDF · Receipt-TR-27-0002-VOID.pdf','TR-27-0002']]));

    // The page PDFs sit in the ⋯ menu of the pages that are one account's.
    app.run("_maPeriod='all'");
    const head=h=>((/<div class="ma-menu" id="ma-menu">([\s\S]*?)<\/div>/.exec(h)||[])[1]||'');
    s.ok('the Ledger (postings) offers Download PDF',/window\.maPdf\('ledger'\)/.test(head(app.run("_maLedgerTab='postings';_maPageHTML('ma-ledger')"))));
    s.ok('…its other tabs do not',['documents','unlabelled','review'].every(t=>!/maPdf\(/.test(head(app.run("_maLedgerTab='"+t+"';_maPageHTML('ma-ledger')")))));
    app.run("_maLedgerTab='postings'");
    s.ok('a holder page offers it',/window\.maPdf\('holder'\)/.test(head(app.run("_maHolderCode='1011';_maPageHTML('ma-holder')"))));
    s.ok('a party page offers it',/window\.maPdf\('party'\)/.test(head(app.run("_maPartyId='p1';_maPageHTML('ma-party')"))));
    ['ma-overview','ma-money','ma-out','ma-parties','ma-close'].forEach(id=>s.ok(id+' has no PDF (no single account to print)',!/maPdf\(/.test(app.run("_maPageHTML('"+id+"')"))));

    const k=calls.length;
    app.run("window.maPdf('ledger')");
    s.eq('a ledger PDF of every account is refused',calls.length,k);
    s.ok('…saying to pick one holder or one account',toasts.some(t=>/Pick one holder or one account/.test(t)));
    const r=JSON.parse(app.run('JSON.stringify(_maRange(_maCtx()))'));
    app.run("window.maLedgerFilter('holder','1011')");
    app.run("window.maPdf('ledger')");
    const c3=calls[k]||{};
    s.eq('with a holder picked → ma-ledger, Ledger-<code>-<from>_<to>.pdf',J([c3.type,c3.filename]),J(['ma-ledger','Ledger-1011-'+r.from+'_'+r.to+'.pdf']));
    s.eq('…one row per posting the page shows',c3.data&&c3.data.rows.length,app.run('_maLedgerFiltered(_maCtx()).led.count'));
    s.eq('…opening and closing are the page\'s',J(c3.data&&[c3.data.opening,c3.data.closing]),app.run('JSON.stringify((l=>[l.opening,l.closing])(_maLedgerFiltered(_maCtx()).led))'));
    s.ok('…the waiting transfer and the void one are not on it',c3.data&&!c3.data.rows.some(x=>x.no==='TR-27-0001'||x.no==='TR-27-0002'));
    app.run("window.maLedgerFilter('account','5030')");
    app.run("window.maPdf('ledger')");
    s.eq('an account filter prints that account',(calls[k+1]||{}).filename,'Ledger-5030-'+r.from+'_'+r.to+'.pdf');
    app.run("_maHolderCode='1011';window.maPdf('holder')");
    s.eq('holder page → ma-statement-holder, Holder-<code>-…pdf',J([(calls[k+2]||{}).type,(calls[k+2]||{}).filename]),J(['ma-statement-holder','Holder-1011-'+r.from+'_'+r.to+'.pdf']));
    app.run("_maPartyId='p1';window.maPdf('party')");
    s.eq('party page → ma-statement-party, Statement-<code>-…pdf',J([(calls[k+3]||{}).type,(calls[k+3]||{}).filename]),J(['ma-statement-party','Statement-ASG-'+r.from+'_'+r.to+'.pdf']));

    // A missing engine, and a failing one, are said out loud.
    const t0=toasts.length;
    delete app.ctx.printDocument;
    s.eq('no print engine → nothing, and false',app.run("window.maDocPdf('transfer','TR-27-0001')"),false);
    s.ok('…with a toast saying the engine is not loaded',toasts.slice(t0).some(t=>/PDF engine is not loaded/.test(t)));
    app.ctx.printDocument=()=>Promise.reject(new Error('the font would not load'));
    app.run("window.maDocPdf('journal','JV-27-0002')");
    await new Promise(res=>setTimeout(res,0));
    s.ok('a PDF that fails is said out loud, with the reason',toasts.some(t=>t==='The PDF failed: the font would not load'),J(toasts.slice(t0)));
    app.run("session={uid:'u-must',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'}");
    app.ctx.printDocument=o=>{calls.push(o);};
    const c=calls.length;
    app.run("window.maDocPdf('transfer','TR-27-0001');window.maPdf('holder')");
    s.eq('nobody else can print one',calls.length,c);
  }

  /* ── M1.6a on the page: what the core decides, the page asks, offers and
     writes. Every block its own app — a refused write in one must not leave
     another's copy out of step with its store. ─────────────────────────── */
  const AMMAR={uid:'u-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'};
  const {app:mb}=mkApp();
  const m6=(t,x)=>Object.assign({by:'afnan',byName:'Afnan',ts:T0+t},x||{});
  const NONE={kind:'none',rate:0,inclusive:true,claimable:false};
  const cap6=built(mb,'journal',{kind:'capital',date:'2026-07-02',holder:'1011',owner:'afnan',amount:300000},m6(1),'JV-27-0001');
  const capB6=built(mb,'journal',{kind:'capital',date:'2026-07-02',holder:'1020',owner:'afnan',amount:500000},m6(2),'JV-27-0002');
  const toAm=built(mb,'transfer',{date:'2026-09-05',from:'1011',to:'1012',amount:20000},m6(3),'TR-27-0001');
  const toDr=built(mb,'transfer',{date:'2026-09-06',from:'1011',to:'1010',amount:15000},m6(4),'TR-27-0002');
  const toBk=built(mb,'transfer',{date:'2026-09-07',from:'1011',to:'1020',amount:10000},m6(5),'TR-27-0003');
  const amC=built(mb,'transfer',{date:'2026-09-08',from:'1020',to:'1012',amount:40000},m6(6),'TR-27-0004');
  Object.assign(amC,JSON.parse(mb.run('JSON.stringify(maConfirmPatch('+J(amC)+',"ammar",{at:'+(T0+60)+'}).patch)')));
  const cnt6=built(mb,'count',{date:'2026-09-10',holder:'1011',counted:250000},m6(7,{bookBalance:255000}),'CT-27-0001');
  const out6=built(mb,'journal',{kind:'money_out',date:'2026-09-12',holder:'1020',account:'6050',payee:'Painter',amount:5000,tax:NONE},m6(8),'JV-27-0003');
  out6.flags=[{rule:'evidence.missing',message:'No bill or receipt attached (₨5,000).',field:'attachments'}];
  out6.reviewedAt=T0+50;out6.reviewedBy='ammar';
  const small6=built(mb,'journal',{kind:'money_out',date:'2026-09-14',holder:'1020',account:'6050',payee:'Tea',amount:1000,tax:NONE},m6(9),'JV-27-0004');
  const seed6={ma_journal:{[cap6.no]:cap6,[capB6.no]:capB6,[out6.no]:out6,[small6.no]:small6},ma_transfer:{[toAm.no]:toAm,[toDr.no]:toDr,[toBk.no]:toBk,[amC.no]:amC},ma_counts:{[cnt6.no]:cnt6}};
  const lastEdit=(S,col)=>{const t=S.tx[S.tx.length-1]||[];const x=t.find(y=>y.col===col);return x?x.data:null;};
  const saveTwice=async(a,S)=>{const n=S.tx.length;await a.run('window.maSaveForm()');if(S.tx.length===n)await a.run('window.maSaveForm()');return S.tx.length>n;};

  s.section('M1.6a — the page: seeded the way the map says');
  s.eq('into Ammar\'s hands: waits for Ammar, in the app',J([toAm.status,toAm.confirmBy,toAm.confirmPaper]),J(['pending','ammar',false]));
  s.eq('into the drawer: waits for Raees, on paper',J([toDr.status,toDr.confirmBy,toDr.confirmPaper]),J(['pending','raees',true]));
  s.eq('into the bank: nobody confirms, it posts',J([toBk.status,toBk.confirmBy]),J(['posted',null]));
  s.eq('the seeded confirmation: Ammar, in the app',J([amC.status,amC.confirmedBy,amC.confirmVia]),J(['posted','ammar','app']));

  s.section('M1.6a — confirming a handover that touches the drawer asks first (money F9)');
  {
    const {app:a,S}=mkApp({seed:seed6});
    await a.run('maLoad()');
    const asked=[];a.ctx.confirm=q=>{asked.push(q);return false;};
    await a.run("window.maConfirmDoc('TR-27-0002')");
    s.eq('Confirm on a drawer handover asks a question',asked.length,1);
    s.ok('…that it be confirmed only once Raees has recorded it in Store Accounts',/only once Raees has recorded this ₨15,000 in Store Accounts/.test(asked[0]||'')&&/Has Raees recorded it\?/.test(asked[0]||''),(asked[0]||'').replace(/\s+/g,' '));
    s.eq('answered no: nothing is written',S.tx.length,0);
    s.eq('…and it still waits',a.run("_maDoc('transfer','TR-27-0002').status"),'pending');
    a.ctx.confirm=q=>{asked.push(q);return true;};
    await a.run("window.maConfirmDoc('TR-27-0002')");
    const cf=(S.tx[0]||[]).find(x=>x.op==='update');
    s.eq('answered yes: posted, on paper, for Raees, by Afnan',J(cf&&[cf.data.status,cf.data.confirmVia,cf.data.confirmedFor,cf.data.confirmedBy]),J(['posted','paper','raees','afnan']));
    // The rail says it before anyone presses Confirm: shown on the waiting
    // copy (put back to pending on the page for this look only).
    const rail=a.run("maData.transfer.find(d=>d.id==='TR-27-0002').status='pending';_maInvalidate();_maRail={kind:'doc',dt:'transfer',id:'TR-27-0002'};_maPageHTML('ma-ledger')");
    s.ok('the rail of a drawer handover that waits says the same',/Confirm it only once Raees has recorded it in Store Accounts\./.test(rail));
    s.ok('…and a handover into Ammar\'s hands does not',!/only once Raees/.test(a.run("_maRail={kind:'doc',dt:'transfer',id:'TR-27-0001'};_maPageHTML('ma-ledger')")));
    a.run("maData.transfer.find(d=>d.id==='TR-27-0002').status='posted';_maInvalidate();_maRail=null");
    a.run('session='+J(AMMAR));
    const n=asked.length;
    await a.run("window.maConfirmDoc('TR-27-0001')");
    s.eq('a handover into Ammar\'s own hands asks nothing — he confirms what he holds',asked.length,n);
    s.eq('…and is confirmed, by Ammar, in the app',J((((S.tx[1]||[]).find(x=>x.op==='update'))||{data:{}}).data.confirmVia),J('app'));
  }

  s.section('M1.6a — a confirmation is of the revision on the screen (money F11)');
  {
    const {app:a,S,db}=mkApp({seed:seed6,session:AMMAR});
    await a.run('maLoad()');
    Object.assign(db.ma_transfer['TR-27-0001'],{rev:2,amount:60000});        // Afnan edited it after Ammar's screen loaded
    await a.run("window.maConfirmDoc('TR-27-0001')");
    s.ok('a transfer edited since the screen loaded is not confirmed',!S.tx.some(t=>t.some(x=>x.op==='update')));
    s.ok('…and it says so',a.state.toasts.some(t=>/It changed since it was opened — refresh and check it before confirming\./.test(t)),J(a.state.toasts));
    s.eq('…and the stored copy still waits',db.ma_transfer['TR-27-0001'].status,'pending');
  }

  s.section('M1.6a — editing a transfer that waits or was confirmed (money F6)');
  {
    const {app:a,S}=mkApp({seed:seed6});
    await a.run('maLoad()');
    a.run("window.maEditDoc('transfer','TR-27-0001')");
    const h=a.bodyHtml('ma-modal-back');
    const dis=(html,id)=>new RegExp('id="'+id+'"[^>]*\\sdisabled').test(html);
    const LOCK=['ma-f-date','ma-f-amount','ma-f-from','ma-f-to'];
    s.ok('its date, amount, from and to are not offered',LOCK.every(id=>dis(h,id)),J(LOCK.map(id=>dis(h,id))));
    s.ok('…it says why, and what to do instead',/It waits for Ammar to confirm — its from, to, amount and date cannot change: void it and record it again\./.test(h));
    s.ok('…and its note is offered',!dis(h,'ma-f-note'));
    set(a,'ma-f-date','2026-09-09');set(a,'ma-f-from','1020');set(a,'ma-f-amount','99999');set(a,'ma-f-note','in an envelope');set(a,'ma-f-reason','note');
    const wrote=await saveTwice(a,S);
    const e=lastEdit(S,'ma_transfer');
    s.ok('the note edit is written',wrote,a.el('ma-f-issues').innerHTML);
    s.eq('…the note, and not what the locked fields were made to hold',J(e&&[e.date,e.from,e.to,e.amount,e.note]),J(['2026-09-05','1011','1012',20000,'in an envelope']));
    s.eq('…still waiting, for Ammar, in the app',J(e&&[e.status,e.confirmBy,e.confirmPaper]),J(['pending','ammar',false]));
    s.eq('…its row names only the note',J(e&&e.edits.slice(-1)[0].fields),J(['note']));

    a.run("window.maEditDoc('transfer','TR-27-0004')");
    const hc=a.bodyHtml('ma-modal-back');
    s.ok('a transfer Ammar confirmed is locked the same way, and says who confirmed it',LOCK.every(id=>dis(hc,id))&&/Ammar confirmed it as it stands — its from, to, amount and date cannot change: void it and record it again\./.test(hc));
    set(a,'ma-f-date','2026-09-08');set(a,'ma-f-from','1020');set(a,'ma-f-amount','40000');set(a,'ma-f-note','Ammar signed');set(a,'ma-f-reason','note');
    await saveTwice(a,S);
    const c=lastEdit(S,'ma_transfer');
    s.eq('a note on it: still posted, still Ammar\'s confirmation at the same moment',J(c&&[c.status,c.confirmBy,c.confirmedBy,c.confirmVia,c.confirmedAt]),J(['posted','ammar','ammar','app',T0+60]));
    s.eq('…its row names only the note',J(c&&c.edits.slice(-1)[0].fields),J(['note']));
    s.eq('…and it still counts in Ammar\'s cash',a.run("maBalanceOf(_maCtx().lines,_maCtx().idx,'1012')"),40000);

    a.run("window.maEditDoc('transfer','TR-27-0003')");
    const hb=a.bodyHtml('ma-modal-back');
    s.ok('a transfer nobody confirms offers its date, amount and from',['ma-f-date','ma-f-amount','ma-f-from'].every(id=>!dis(hb,id))&&dis(hb,'ma-f-to'));
    set(a,'ma-f-date','2026-09-07');set(a,'ma-f-from','1010');set(a,'ma-f-amount','10000');set(a,'ma-f-note','');set(a,'ma-f-reason','it came from the drawer');
    const n=S.tx.length;
    await a.run('window.maSaveForm()');await a.run('window.maSaveForm()');
    s.eq('…but not a route out of the drawer, which would wait for Raees: nothing is written',S.tx.length,n);
    s.ok('…and it says an edit cannot start a confirmation',/an edit cannot start a confirmation — void it and record it again/.test(a.el('ma-e-from').textContent+' '+a.el('ma-f-issues').innerHTML),a.el('ma-e-from').textContent);
    set(a,'ma-f-from','1011');set(a,'ma-f-amount','12000');set(a,'ma-f-reason','the slip said 12,000');
    await saveTwice(a,S);
    const b=lastEdit(S,'ma_transfer');
    s.eq('…while a new amount on it is written, named, and it stays posted',J(b&&[b.amount,b.status,b.edits.slice(-1)[0].fields]),J([12000,'posted',['amount']]));
  }

  s.section('M1.6a — editing a count keeps its holder and its book (money F2, M4)');
  {
    const {app:a,S}=mkApp({seed:seed6});
    await a.run('maLoad()');
    a.run("window.maEditDoc('count','CT-27-0001')");
    const h=a.bodyHtml('ma-modal-back');
    s.ok('the holder is not offered, and it says why',/id="ma-f-holder"[^>]*\sdisabled/.test(h)&&/Which holder was counted cannot change — void it and count again\./.test(h));
    set(a,'ma-f-date','2026-09-10');set(a,'ma-f-holder','1012');set(a,'ma-f-counted','250000');set(a,'ma-f-note','recounted: the same');set(a,'ma-f-reason','note');
    a.run('window.maCountBook()');
    s.ok('the book shown is the one it was counted against',a.el('ma-f-book').innerHTML.indexOf('The book says '+a.run('maRs(255000)'))===0,a.el('ma-f-book').innerHTML);
    await saveTwice(a,S);
    const e=lastEdit(S,'ma_counts');
    s.eq('a note edit keeps holder, book, difference and amount',J(e&&[e.holder,e.bookBalance,e.difference,e.amount]),J(['1011',255000,-5000,5000]));
    s.eq('…and its row names only the note',J(e&&e.edits.slice(-1)[0].fields),J(['note']));
    const book=a.run("maBalanceOf(maPostAll(_maCtx().docs.filter(d=>d.id!=='CT-27-0001'),_maCtx().idx,_maCtx().s),_maCtx().idx,'1011','2026-09-10')");
    s.ok('(the book as it stands is not the stored one)',book!==255000,String(book));
    a.run("window.maEditDoc('count','CT-27-0001')");
    set(a,'ma-f-date','2026-09-10');set(a,'ma-f-counted','251000');set(a,'ma-f-note','recounted: the same');set(a,'ma-f-reason','counted again');
    await saveTwice(a,S);
    const r=lastEdit(S,'ma_counts');
    s.eq('a recount is held against the book as it stands, and names counted and amount',J(r&&[r.bookBalance,r.difference,r.amount,r.edits.slice(-1)[0].fields]),J([book,251000-book,Math.abs(251000-book),['counted','amount']]));
  }

  s.section('M1.6a — an edit stores its flags; a moved figure clears the review (money F8)');
  {
    const {app:a,S}=mkApp({seed:seed6});
    await a.run('maLoad()');
    const cc=a.run("_maDoc('journal','JV-27-0003').costCentre||''");
    const fill=(amount,note,reason)=>{
      set(a,'ma-f-date','2026-09-12');set(a,'ma-f-holder','1020');set(a,'ma-f-account','6050');set(a,'ma-f-payee','Painter');set(a,'ma-f-amount',amount);set(a,'ma-f-taxkind','none');
      set(a,'ma-f-costCentre',cc);set(a,'ma-f-labelKind','');set(a,'ma-f-po','');set(a,'ma-f-article','');set(a,'ma-f-commitmentId','');set(a,'ma-f-commitmentPeriod','');set(a,'ma-f-tags','');set(a,'ma-f-note',note);set(a,'ma-f-reason',reason);
    };
    a.run("window.maEditDoc('journal','JV-27-0003')");fill('5000','second coat','note');
    await saveTwice(a,S);
    const n=lastEdit(S,'ma_journal');
    s.eq('a note on a reviewed document: named "note", the review kept',J(n&&[n.edits.slice(-1)[0].fields,n.reviewedAt,n.reviewedBy]),J([['note'],T0+50,'ammar']));
    s.eq('…and its flags are the ones this edit raised',J(n&&(n.flags||[]).map(x=>x.rule)),J(['evidence.missing']));
    a.run("window.maEditDoc('journal','JV-27-0003')");fill('6000','second coat','the bill said 6,000');
    await saveTwice(a,S);
    const m=lastEdit(S,'ma_journal');
    s.eq('a new amount clears the review',J(m&&[m.reviewedAt,m.reviewedBy]),J([null,null]));
    s.ok('…stores the flag for the new amount',!!m&&(m.flags||[]).some(x=>x.rule==='evidence.missing'&&/₨6,000/.test(x.message)),J(m&&m.flags));
    s.ok('…so it waits in the review queue again',a.run("maReviewQueue(_maCtx().docs).some(d=>d.id==='JV-27-0003')"));
    s.ok('…and the save says so',a.state.toasts.some(t=>/^JV-27-0003 saved — revision 3\. It waits for review\.$/.test(t)),J(a.state.toasts));
    a.run("window.maEditDoc('journal','JV-27-0003')");fill('1500','second coat','it was 1,500 after all');
    await saveTwice(a,S);
    const l=lastEdit(S,'ma_journal');
    s.eq('an edit that raises no flag stores none',J(l&&l.flags),J([]));
    s.ok('…and it leaves the review queue',!a.run("maReviewQueue(_maCtx().docs).some(d=>d.id==='JV-27-0003')"));
    // "Record small, edit up" — the reproduction: ₨1,000 with no flags,
    // edited to ₨95,000 with no bill. The flag shown on the edit is stored.
    s.ok('(a small money-out, recorded clean)',!('flags' in a.run("_maDoc('journal','JV-27-0004')")));
    a.run("window.maEditDoc('journal','JV-27-0004')");
    const cc4=a.run("_maDoc('journal','JV-27-0004').costCentre||''");
    set(a,'ma-f-date','2026-09-14');set(a,'ma-f-holder','1020');set(a,'ma-f-account','6050');set(a,'ma-f-payee','Tea');set(a,'ma-f-amount','95000');set(a,'ma-f-taxkind','none');
    set(a,'ma-f-costCentre',cc4);set(a,'ma-f-labelKind','');set(a,'ma-f-po','');set(a,'ma-f-article','');set(a,'ma-f-commitmentId','');set(a,'ma-f-commitmentPeriod','');set(a,'ma-f-tags','');set(a,'ma-f-note','');set(a,'ma-f-reason','it was the paint');
    await saveTwice(a,S);
    const up=lastEdit(S,'ma_journal');
    s.ok('edited up to ₨95,000 with no bill: the flag it raised is stored on it',!!up&&up.amount===95000&&(up.flags||[]).some(x=>x.rule==='evidence.missing'),J(up&&[up.amount,up.flags]));
    s.ok('…and it waits in the review queue',a.run("maReviewQueue(_maCtx().docs).some(d=>d.id==='JV-27-0004')"));
  }

  s.section('M1.6a — a closed quarter: no Confirm, no Mark reviewed, and said by name (money F7, security F3b)');
  {
    const seedL=clone(seed6);
    delete seedL.ma_journal['JV-27-0003'].reviewedAt;delete seedL.ma_journal['JV-27-0003'].reviewedBy;
    seedL.ma_closes={'2027-Q1':{quarter:'2027-Q1',locked:true,closedBy:'afnan',closedAt:T0+100}};
    const {app:a,S}=mkApp({seed:seedL,session:AMMAR});
    await a.run('maLoad()');
    const Q='Q1 FY27 · Jul–Sep 2026';
    s.eq('(the quarter as the page names it)',a.run("maQuarterLocked(_maDoc('transfer','TR-27-0001'),{closes:maData.closes,settings:_maCtx().s})"),Q);
    const money=a.run("_maPageHTML('ma-money')");
    s.ok('the waiting list offers Ammar no Confirm in the closed quarter, and says why',!/maConfirmDoc\('TR-27-0001'\)/.test(money)&&/quarter closed/.test(money));
    await a.run("window.maConfirmDoc('TR-27-0001')");
    s.eq('Confirm refused: nothing is written',S.tx.length,0);
    s.ok('…naming the quarter, not the rules',a.state.toasts.some(t=>t===Q+' is closed — a transfer dated in it cannot be confirmed until an owner reopens the quarter.'),J(a.state.toasts));
    const rt=a.run("_maRail={kind:'doc',dt:'transfer',id:'TR-27-0001'};_maPageHTML('ma-ledger')");
    s.ok('the rail offers no Confirm, and says the quarter is closed',!/maConfirmDoc\(/.test(rt)&&rt.indexOf(Q+' is closed, so it cannot be confirmed until the quarter is reopened.')>=0);
    const rv=a.run("_maRail=null;_maLedgerTab='review';_maPageHTML('ma-ledger')");
    s.ok('the review queue lists the flagged document, with no Mark reviewed in the closed quarter',rv.indexOf('JV-27-0003')>=0&&/quarter closed/.test(rv)&&!/maReviewDoc\('journal','JV-27-0003'\)/.test(rv));
    await a.run("window.maReviewDoc('journal','JV-27-0003')");
    s.eq('Mark reviewed refused: nothing is written',S.tx.length,0);
    s.ok('…naming the quarter',a.state.toasts.some(t=>t===Q+' is closed — a document dated in it cannot be reviewed until an owner reopens the quarter.'),J(a.state.toasts));
    const rj=a.run("_maRail={kind:'doc',dt:'journal',id:'JV-27-0003'};_maPageHTML('ma-ledger')");
    s.ok('its rail offers no Mark reviewed',!/maReviewDoc\(/.test(rj));
    a.run("maData.closes[0].reopenedAt="+(T0+200)+";maData.closes[0].reopenedBy='afnan';_maInvalidate();_maRail=null");
    s.ok('a reopened quarter offers Confirm again',/maConfirmDoc\('TR-27-0001'\)/.test(a.run("_maPageHTML('ma-money')")));
  }

  s.section('M1.6a — the audit trail names who by the signed-in account (security F3)');
  {
    const UD=[{u:'afnan',name:'Afnan'},{u:'ammar',name:'Ammar'}];
    const {app:a}=mkApp({seed:{ma_audit:{r1:{id:'r1',by:'afnan',byName:'Mallory',action:'void',at:T0+5,target:{dt:'journal',id:'JV-27-0001',no:'JV-27-0001'},detail:'wrong'}}},globals:{USER_DEFS:UD}});
    await a.run('maLoad()');
    const h=a.run("_maCloseTab='audit';_maPageHTML('ma-close')");
    s.ok('the trail shows the name of `by`, never the stored byName',/data-l="Who">Afnan<\/td>/.test(h)&&h.indexOf('Mallory')<0,h.slice(h.indexOf('<tbody>'),h.indexOf('<tbody>')+160));
    const got=[];a.ctx.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:r=>{got.push(r);return {};},book_append_sheet(){}},writeFile(){}};
    a.run("window.maExcel('audit')");
    s.eq('…and so does its Excel',J(got[0]&&got[0][1]&&got[0][1][1]),J('Afnan'));
  }

  s.section('The nightly backup\'s audit rows name the job, not its id');
  {
    // netlify/functions/ma-backup.js writes its own audit rows with
    // by:'ma-backup' (byName 'Nightly backup'). The trail shows the name
    // derived from `by` — so without this, Close & audit and its Excel read
    // the raw id "ma-backup". No client can write that `by`: the ma_audit
    // create rule binds it to the caller's own login (maUser()).
    const UD=[{u:'afnan',name:'Afnan'},{u:'ammar',name:'Ammar'}];
    const {app:a}=mkApp({seed:{ma_audit:{
      b1:{id:'b1',by:'ma-backup',byName:'Nightly backup',action:'backup',at:T0+9,target:{dt:'backup',id:'2026-09-28',no:'2026-09-28'},detail:'done'},
      r1:{id:'r1',by:'afnan',byName:'Afnan',action:'void',at:T0+5,target:{dt:'journal',id:'JV-27-0001',no:'JV-27-0001'},detail:'wrong'}}},globals:{USER_DEFS:UD}});
    await a.run('maLoad()');
    s.eq('_maWho names the nightly backup',a.run("_maWho('ma-backup')"),'Nightly backup');
    s.eq('…and still resolves a person the same way',a.run("_maWho('ammar')"),'Ammar');
    s.eq('…and still returns an unknown id as it is',a.run("_maWho('zz-nobody')"),'zz-nobody');
    const h=a.run("_maCloseTab='audit';_maPageHTML('ma-close')");
    s.ok('the trail says "Nightly backup" for a backup row',/data-l="Who">Nightly backup<\/td>/.test(h),h.slice(h.indexOf('<tbody>'),h.indexOf('<tbody>')+200));
    s.ok('…and never shows the raw id "ma-backup" as a name',!/data-l="Who">ma-backup</.test(h));
    const got=[];a.ctx.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:r=>{got.push(r);return {};},book_append_sheet(){}},writeFile(){}};
    a.run("window.maExcel('audit')");
    const rows=(got[0]||[]).slice(1);
    s.eq('its Excel names the job in the Who column',J(rows.map(r=>r[1])),J(['Nightly backup','Afnan']));
  }

  s.section('M1.6a — the rules hold the lists the core holds (one decision, two places)');
  {
    const rules=read('firestore.rules');
    const {app:a}=mkApp();
    const core=n=>JSON.parse(a.run('JSON.stringify('+n+')'));
    const list=src=>(src.match(/'([^']*)'/g)||[]).map(x=>x.slice(1,-1));
    const fn=name=>{const m=new RegExp('function '+name+'\\(\\)\\s*\\{\\s*return\\s*([\\s\\S]*?);\\s*\\}').exec(rules);return m?m[1]:'';};
    const handsSrc=fn('maHands');
    const hands={};(handsSrc.match(/'[^']+'\s*:\s*'[^']+'/g)||[]).forEach(p=>{const kv=list(p);hands[kv[0]]=kv[1];});
    s.eq('maHands() is MA_HANDS',J(hands),J(core('MA_HANDS')));
    s.eq('maDrawers() is MA_DRAWERS',J(list(fn('maDrawers'))),J(core('MA_DRAWERS')));
    const letList=name=>{const m=new RegExp('let '+name+' = \\[([^\\]]*)\\]').exec(rules);return m?list(m[1]):null;};
    const sorted=x=>J((x||[]).slice().sort());
    s.eq('maEditOk\'s derived list is MA_EDIT_DERIVED',sorted(letList('derived')),sorted(core('MA_EDIT_DERIVED')));
    s.eq('…and its figures list is MA_FIGURE_FIELDS',sorted(letList('figures')),sorted(core('MA_FIGURE_FIELDS')));
    s.ok('…and neither lets amount or tax go unnamed',['amount','tax'].every(k=>(letList('derived')||['amount']).indexOf(k)<0));
    [['ma_journal','journal'],['ma_transfer','transfer'],['ma_counts','count'],['ma_cpr','cpr'],['ma_collection','collection']].forEach(([col,dt])=>{
      const m=new RegExp('match /'+col+'/\\{docId\\}[\\s\\S]*?maEditOk\\(\''+dt+'\', \\[([^\\]]*)\\]').exec(rules);
      s.eq(col+'\'s editable list is MA_EDIT_FIELDS.'+dt,sorted(m&&list(m[1])),sorted(core('MA_EDIT_FIELDS.'+dt)));
    });
    const cm=/maDocCreateOk[\s\S]*?!d\.keys\(\)\.hasAny\(\[([^\]]*)\]\)/.exec(rules);
    const pend=a.run('JSON.stringify(maBuildDoc("transfer",{date:"2026-09-05",from:"1011",to:"1012",amount:5},{by:"afnan",byName:"Afnan",ts:1},maChartIndex(maChart("groovy")),MA_DEFAULT_SETTINGS))');
    const paper=a.run('JSON.stringify(maBuildDoc("transfer",{date:"2026-09-05",from:"1011",to:"1040",amount:5},{by:"afnan",byName:"Afnan",ts:1},maChartIndex(maChart("groovy")),MA_DEFAULT_SETTINGS))');
    const keysOf=x=>JSON.parse(a.run('JSON.stringify(Object.keys('+x+'))'));
    const confirmKeys=keysOf('maConfirmPatch('+pend+',"ammar",{at:1}).patch').concat(keysOf('maConfirmPatch('+paper+',"afnan",{at:1}).patch')).filter((k,i,x)=>k!=='status'&&x.indexOf(k)===i);
    const voidKeys=JSON.parse(a.run('JSON.stringify((d=>Object.keys(maApplyVoid(d,{at:1,by:"afnan",byName:"Afnan",reason:"x"})).filter(k=>!(k in d)))('+pend+'))'));
    const forbidden=confirmKeys.concat(voidKeys,['reviewedAt','reviewedBy']);
    s.eq('a create may carry none of what confirm, void and review set',sorted(cm&&list(cm[1])),sorted(forbidden));
    s.ok('…and MA_CONFIRM_KEYS is those four plus the two the map decides',J(core('MA_CONFIRM_KEYS').slice().sort())===J(confirmKeys.concat(['confirmBy','confirmPaper']).sort()));
    s.ok('a transfer and a collection are born with the map\'s answer; anything else with no confirmation at all',/\(dt == 'transfer' \? maTrBornOk\(d\) : \(dt == 'collection' \? maClBornOk\(d\) : !d\.keys\(\)\.hasAny\(\['confirmBy','confirmPaper'\]\)\)\)/.test(rules));
    s.ok('ma_shares: no client create, update or delete — the ma-share function writes them',/match \/ma_shares\/\{token\} \{\s*allow read: if isMasterAccounts\(\);\s*allow create, update, delete: if false;/.test(rules));
    s.ok('…and the page never writes one, nor a close',!/ma_shares:\s*id=>|doc\(db,\s*'ma_shares'|ma_closes:\s*id=>|doc\(db,\s*'ma_closes'/.test(read('js/master-accounts.js')));
    s.ok('ma_audit: a row is written now — within five minutes of the server\'s clock',/match \/ma_audit\/\{id\}[\s\S]*?math\.abs\(request\.resource\.data\.at - request\.time\.toMillis\(\)\) <= 300000;/.test(rules));
    s.ok('ma_closes: a close is born locked',/match \/ma_closes\/\{q\}[\s\S]*?allow create:[\s\S]*?request\.resource\.data\.locked == true[\s\S]*?allow update: if maReopenOk\(\) \|\| maRelockOk\(q\);/.test(rules));
    s.ok('a date is a real month and day in the rules',/function maDayOk\(d\) \{ return d is string && d\.matches\('\^\[0-9\]\{4\}-\(0\[1-9\]\|1\[0-2\]\)-\(0\[1-9\]\|\[12\]\[0-9\]\|3\[01\]\)\$'\); \}/.test(rules));
    s.ok('review refuses a locked quarter',/function maReviewOk\(\)[\s\S]*?&& !maLocked\(resource\.data\.quarter\);/.test(rules));
    // M2.4 — the couriers: the rules' lists and numbers are the core's.
    s.eq('maCouriers() is MA_COURIER_IDS',sorted(list(fn('maCouriers'))),sorted(core('MA_COURIER_IDS')));
    const stc=/function maStatementCreateOk\([^)]*\)\s*\{[\s\S]*?d\.get\('courier', null\) in \[([^\]]*)\]/.exec(rules);
    s.eq('a typed statement\'s couriers are MA_STATEMENT_COURIERS',sorted(stc&&list(stc[1])),sorted(core('MA_STATEMENT_COURIERS')));
    s.ok('a statement holds at most MA_ST_MAX_LINES lines',new RegExp('d\\.lines\\.size\\(\\) <= '+core('MA_ST_MAX_LINES')+'\\b').test(rules));
    s.ok('a collection names at most MA_CL_MAX_COVERS statements',new RegExp('d\\.refs\\.cprNos\\.size\\(\\) <= '+core('MA_CL_MAX_COVERS')+'\\b').test(rules));
    const dsp=/function maDisputeOk\(\)[\s\S]*?x\.get\('state', null\) in \[([^\]]*)\]/.exec(rules);
    s.eq('a dispute\'s states are MA_DISPUTE_STATES',sorted(dsp&&list(dsp[1])),sorted(core('MA_DISPUTE_STATES')));
    const der=/function maDisputeOk\(\)[\s\S]*?affectedKeys\(\)\.hasOnly\(\[([^\]]*)\]\)/.exec(rules);
    s.eq('on a derived document an owner moves only the review (maReviewOk) or the dispute: MA_DERIVED_OWNER_FIELDS',sorted((der?list(der[1]):[]).concat(['reviewedAt','reviewedBy'])),sorted(core('MA_DERIVED_OWNER_FIELDS')));
    s.ok('ma_cpr: a derived document takes only review or dispute; a typed one edit, void or review',/match \/ma_cpr\/\{docId\}[\s\S]*?allow update: if resource\.data\.get\('derived', null\) == false[\s\S]*?\|\| maVoidOk\(\) \|\| maReviewOk\(\)\)[\s\S]*?: \(resource\.data\.get\('derived', false\) == true && \(maReviewOk\(\) \|\| maDisputeOk\(\)\)\);\s*allow delete: if false;/.test(rules));
    s.ok('ma_runs: no client create, update or delete — the ma-rollup function writes it',/match \/ma_runs\/\{id\} \{\s*allow read: if isMasterAccounts\(\);\s*allow create, update, delete: if false;/.test(rules));
    s.ok('…and the page never writes a run',!/doc\(db,\s*'ma_runs'/.test(read('js/master-accounts.js')));
    s.ok('TCS lands in the TCS account — the rules\' 1060 is MA_COURIERS.tcs\'s wallet',/\(d\.courier == 'tcs'\) == \(d\.holder == '1060'\)/.test(rules)&&core('MA_COURIERS.tcs.accounts.wallet')==='1060');
  }

  s.section('the re-lock');
  {
    const {app}=mkApp({globals:{auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date(Date.now()-3*3600000).toUTCString()}}}}});
    app.run("maRenderPage('ma-overview')");
    s.ok('an old sign-in and no activity → locked',/Master Accounts is locked/.test(app.el('main-content').innerHTML));
    s.ok('it asks for the password when this device has no fingerprint lock',/ma-lock-pw/.test(app.el('main-content').innerHTML)&&!/Unlock with fingerprint/.test(app.el('main-content').innerHTML));
    app.ctx.lockEnabledFor=()=>true;app.ctx._lockShow=(def,cb)=>cb();
    app.run("maRenderPage('ma-overview')");
    s.ok('with the app lock on this device, the fingerprint is offered',/Unlock with fingerprint/.test(app.el('main-content').innerHTML));
    const {app:b,S}=mkApp({globals:{reauthenticateWithCredential:async()=>{},EmailAuthProvider:{credential:()=>({})},auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{}}}}});
    b.run("maRenderPage('ma-overview')");
    set(b,'ma-lock-pw','secret');
    await b.run('window.maUnlockPassword()');
    s.ok('the right password unlocks, and writes an "enter" audit row',S.sets.some(x=>x.col==='ma_audit'&&x.data.action==='enter'&&/password/.test(x.data.detail)));
    s.ok('recent activity keeps it open',b.run('_maNeedsRelock()')===false);
  }

  return s;
};

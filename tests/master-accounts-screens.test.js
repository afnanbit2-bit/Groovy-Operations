/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts — the screens, the idle re-lock and the device cache
   (M1.6b, 28 Sept 2026)

   M1.6a made edits and confirmations hold at the rules. This suite drives
   the page fixes that followed the two reviews (money, security): every
   one runs the REAL page code (js/ma-core.js + js/master-accounts.js)
   against a stubbed Firestore that records what is read and written, and
   was checked by breaking the fix once and watching it fail by name.

   - the idle re-lock: a tap, a key, a repaint, the tab coming back and the
     Dashboard card all ask first; a tap never unlocks;
   - the drawer read: a failed or slow read is incomplete everywhere cash is
     shown, never a whole number, and never a false "runs short";
   - pending handovers are not moved on the 30-day panel;
   - the Ledger shows no running balance under a narrowing filter or for
     the mirrored drawer — page, PDF data and Excel alike;
   - a commitment payment names its period; a blank one is refused;
   - the forms never write a value the owner did not choose;
   - a save that fails after its dialog closed says so;
   - backups, share links, Download the books, "5.000", In and Out;
   - an owner's sign-out takes the books off the device.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const clone=v=>JSON.parse(JSON.stringify(v));

function memLS(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];},_m:m};}

/* A Firestore that keeps what is written and records every op (the
   master-accounts suite's, with a read log). */
function mkApp(o){
  o=o||{};
  const db=o.seed?clone(o.seed):{};
  const S={tx:[],batches:[],sets:[],reads:[],fns:[]};
  const col=c=>(db[c]=db[c]||{});
  const snap=(c,id)=>{const d=col(c)[id];return {exists:()=>d!==undefined,data:()=>clone(d===undefined?{}:d)};};
  const globals=Object.assign({
    localStorage:o.ls||memLS(),
    doc:(_db,c,id)=>({col:c,id}),
    collection:(_db,c)=>({col:c}),
    query:(c,...w)=>Object.assign({},c,{where:w.filter(x=>x&&x.field)}),orderBy:()=>({}),limit:()=>({}),
    where:(field,op,value)=>({field,op,value}),
    getDocs:async q=>{
      S.reads.push(q.col);
      if((o.fail||[]).indexOf(q.col)>=0)throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      let ids=Object.keys(col(q.col));
      (q.where||[]).forEach(w=>{ids=ids.filter(id=>col(q.col)[id][w.field]===w.value);});
      return {docs:ids.map(id=>({id,data:()=>clone(col(q.col)[id])}))};
    },
    runTransaction:async(_db,fn)=>{
      if(o.txFail)throw o.txFail;
      const ops=[];S.tx.push(ops);
      await fn({get:async ref=>snap(ref.col,ref.id),set:(ref,d)=>{ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},update:(ref,d)=>{ops.push({op:'update',col:ref.col,id:ref.id,data:clone(d)});}});
      ops.forEach(x=>{if(x.op==='set')col(x.col)[x.id]=clone(x.data);else col(x.col)[x.id]=Object.assign({},col(x.col)[x.id],clone(x.data));});
    },
    writeBatch:()=>{const ops=[];S.batches.push(ops);return{set(ref,d){ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},async commit(){if(o.batchFail)throw o.batchFail;ops.forEach(x=>{col(x.col)[x.id]=clone(x.data);});}};},
    setDoc:async(ref,d)=>{S.sets.push({col:ref.col,id:ref.id,data:clone(d)});},
    auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date().toUTCString()},getIdToken:async()=>'t_afnan'}}
  },o.globals||{});
  const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:o.page||'ma-overview',
    session:o.session||{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},globals});
  return {app,S,db};
}
/* A document the way the writer stores it — built by the core. */
function built(app,dt,input,meta,no){
  const d=JSON.parse(app.run('JSON.stringify(maBuildDoc('+J(dt)+','+J(input)+','+J(meta)+',maChartIndex(maChart("groovy")),MA_DEFAULT_SETTINGS))'));
  d.no=no;d.id=no;return d;
}
const set=(app,id,v)=>{app.el(id).value=v;};
const fireDoc=(app,type,ev)=>(app.state.listeners[type]||[]).forEach(fn=>fn(ev||{}));

/* What a browser holds in the open form's controls when nobody touches
   them: a select's selected option — or its FIRST when none is marked,
   which is the whole of money F1 — an input's value, a checkbox's state.
   The harness does not parse markup, so the form's own HTML is read. */
function unesc(v){return String(v).replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function attr(a,name){const m=new RegExp('(?:^|\\s)'+name+'="([^"]*)"').exec(a);return m?unesc(m[1]):null;}
function untouched(app){
  Object.keys(app.nodes).forEach(k=>{if(/^ma-f-|^ma-l-/.test(k))delete app.nodes[k];});
  return hold(app,app.bodyHtml('ma-modal-back'));
}
function hold(app,html){
  const out={};let m;
  const reS=/<select\b([^>]*)>([\s\S]*?)<\/select>/g;
  while((m=reS.exec(html))){
    const id=attr(m[1],'id');if(!id)continue;
    const opts=[];const reO=/<option\b([^>]*)>([^<]*)/g;let o;
    while((o=reO.exec(m[2])))opts.push({v:attr(o[1],'value'),sel:/\sselected\b/.test(o[1]),t:unesc(o[2])});
    const pick=opts.find(x=>x.sel)||opts[0];
    out[id]={value:pick?pick.v:'',opts};
  }
  const reI=/<input\b([^>]*)>/g;
  while((m=reI.exec(html))){const id=attr(m[1],'id');if(!id)continue;
    if(attr(m[1],'type')==='checkbox')out[id]={checked:/\schecked\b/.test(m[1])};else out[id]={value:attr(m[1],'value')||''};}
  const reT=/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g;
  while((m=reT.exec(html))){const id=attr(m[1],'id');if(!id)continue;out[id]={value:unesc(m[2])};}
  Object.keys(out).forEach(id=>{const e=app.el(id);if('checked' in out[id])e.checked=out[id].checked;else e.value=out[id].value;});
  return out;
}

module.exports=async function(){
  const s=suite('master-accounts-screens');
  const T0=Date.UTC(2026,6,1,6);
  const m=(t,x)=>Object.assign({by:'afnan',byName:'Afnan',ts:T0+t},x||{});

  /* ── 9. The idle re-lock ─────────────────────────────────────────────── */
  s.section('the idle re-lock — a page left open locks, and a tap never unlocks (security F5)');
  {
    const {app:mb}=mkApp();
    const cap=built(mb,'journal',{kind:'capital',date:'2026-07-02',holder:'1011',owner:'afnan',amount:4200000},m(1),'JV-27-0001');
    const LS=memLS();
    const {app,S}=mkApp({seed:{ma_journal:{[cap.no]:cap}},ls:LS,
      globals:{auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date(Date.now()-86400000).toUTCString()}}}}});
    app.run("_maUnlocked('password')");
    await new Promise(r=>setTimeout(r,20));
    const main=()=>app.el('main-content').innerHTML;
    const locked=()=>/Master Accounts is locked/.test(main());
    s.ok('(unlocked, Today shows the books)',!locked()&&/Cash in hand/.test(main()));
    // Two hours pass with the page open: move the page's own clocks back.
    const idle=()=>{app.run('_maLastTouch-=2*3600000;_maUnlockedAt-=2*3600000');const a=JSON.parse(LS.getItem('groovy-ma-active'));a['u-afnan']-=2*3600000;LS.setItem('groovy-ma-active',JSON.stringify(a));};
    idle();
    s.eq('(two hours idle: the lock is due)',app.run('_maNeedsRelock()'),true);
    fireDoc(app,'pointerdown',{});
    s.ok('one tap anywhere shows the lock instead of the books',locked()&&!/Cash in hand/.test(main()));
    s.eq('…and the tap did not touch the clock — the lock is still due',app.run('_maNeedsRelock()'),true);
    app.run("maRenderPage('ma-ledger')");
    s.ok('so the next page (the sidebar\'s Ledger) opens on the lock, not the postings',locked()&&!/postings/.test(main()));
    fireDoc(app,'keyup',{});fireDoc(app,'pointerdown',{});
    s.eq('typing the password (keys on the lock) is not activity either',app.run('_maNeedsRelock()'),true);
    s.ok('…and the lock stays as it is',locked());
    const rows=S.sets.filter(x=>x.col==='ma_audit'&&x.data.action==='relock');
    s.eq('the idle lock writes no "relock" audit row — that word is the quarter\'s (M1.6a)',rows.length,0);
  }
  {
    const LS=memLS();
    const {app}=mkApp({ls:LS,globals:{auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date(Date.now()-86400000).toUTCString()}}}}});
    app.run("_maUnlocked('password')");
    await new Promise(r=>setTimeout(r,20));
    const main=()=>app.el('main-content').innerHTML;
    const idle=()=>{app.run('_maLastTouch-=2*3600000;_maUnlockedAt-=2*3600000');const a=JSON.parse(LS.getItem('groovy-ma-active'));a['u-afnan']-=2*3600000;LS.setItem('groovy-ma-active',JSON.stringify(a));};
    idle();
    app.run("window.maSetPeriod('all')");
    s.ok('a repaint through window.maSetPeriod while it is due shows the lock',/Master Accounts is locked/.test(main())&&!/Cash in hand/.test(main()));
    app.run("_maLockShown=false;_maPaint()");
    s.ok('_maPaint itself asks first',/Master Accounts is locked/.test(main()));
    app.run("_maLockShown=false");
    app.el('main-content').innerHTML='BOOKS';
    fireDoc(app,'visibilitychange',{});
    s.ok('the tab coming back swaps an open page for the lock',/Master Accounts is locked/.test(main()));
    app.el('main-content').innerHTML='BOOKS';app.run('_maLockShown=false');
    app.run('_maRelockCheck()');
    s.ok('…and so does the 30-second check',/Master Accounts is locked/.test(main()));
    s.ok('(the check is on a timer)',/setInterval\(_maRelockCheck,30000\)/.test(read('js/master-accounts.js')));
    // A form open when the lock comes is closed — it shows the books' figures.
    app.run("_maLockShown=false;_maLastTouch=Date.now()");
    await app.run('maLoad()');
    app.run("window.maRecordKind('money_out')");
    s.ok('(a form is open)',app.run('_maF!==null'));
    idle();
    fireDoc(app,'pointerdown',{});
    s.eq('a form open when the lock comes is closed',app.run('_maF'),null);
    app.run("window.maRecordKind('money_out')");
    s.eq('…and none opens while the lock is showing',app.run('_maF'),null);
    // Another page of the app is not touched by the checks.
    app.run("currentPage='dashboard'");app.el('main-content').innerHTML='DASHBOARD';
    fireDoc(app,'visibilitychange',{});fireDoc(app,'pointerdown',{});
    s.eq('off Master Accounts the checks leave the page alone',app.el('main-content').innerHTML,'DASHBOARD');
  }
  s.section('the Dashboard card reads nothing while the lock is due (security F5)');
  {
    const {app,S}=mkApp({page:'dashboard',globals:{auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date(Date.now()-86400000).toUTCString()}}}}});
    s.ok('(the card renders its placeholder)',/ma-dash-body/.test(app.run('renderMasterAccountsDashboardWidget()')));
    app.el('ma-dash-body').innerHTML='Loading…';
    await app.run('_maPopulateDashboard()');
    s.eq('a due lock: the card says Master Accounts is locked',app.el('ma-dash-body').textContent,'Master Accounts is locked — open it to unlock.');
    s.eq('…and reads no collection at all',J(S.reads),J([]));
    s.eq('…nothing is in memory',app.run('maLoaded'),false);
    const {app:b,S:SB}=mkApp({page:'dashboard'});
    b.el('ma-dash-body').innerHTML='Loading…';
    await b.run('_maPopulateDashboard()');
    s.ok('signed in a moment ago, the card shows the figures',/cash in hand/.test(b.el('ma-dash-body').innerHTML));
    s.ok('…having read the books',SB.reads.indexOf('ma_journal')>=0);
  }

  /* ── 2. A failed drawer read is incomplete, everywhere ───────────────── */
  // The review's reproduction (money F3): MCB ₨80,000 and Afnan ₨50,000; the
  // drawer holds ₨2,00,000 in Store Accounts; rent ₨1,50,000 is due today.
  const {app:mb2}=mkApp();
  const TODAY=JSON.parse(mb2.run('JSON.stringify(maDay())'));
  const DUE=+TODAY.slice(8,10);
  const opening2=built(mb2,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:80000},{account:'1011',side:'dr',amount:50000}]},m(1),'JV-27-0001');
  const rent2={id:'c1',name:'Rent — factory',kind:'fixed',cadence:'monthly',dueDay:DUE,amountExpected:150000,account:'6040',holder:'1020',active:true};
  const seed2={ma_journal:{[opening2.no]:opening2},ma_commitments:{c1:rent2}};
  const store=(cash,err)=>({loadAccountsData:async()=>{},_acctBalances:()=>({cash}),_acctLoadErr:err||null});
  s.section('a failed drawer read is "incomplete" everywhere cash is shown, and never a false short day (money F3)');
  {
    const {app}=mkApp({seed:seed2,globals:store(200000,{cols:['acct_entries']})});
    await app.run('maLoad()');
    const h=app.run("_maPageHTML('ma-overview')");
    const cashBank=(/<dt>Cash and bank today<\/dt><dd>([\s\S]*?)<\/dd>/.exec(h)||[])[1]||'';
    s.ok('"Cash and bank today" carries the marker',/₨1,30,000/.test(cashBank)&&/incomplete/.test(cashBank),cashBank);
    const leaves=(/<dt>Leaves<\/dt><dd>([\s\S]*?)<\/dd>/.exec(h)||[])[1]||'';
    s.ok('"Leaves" too',/incomplete/.test(leaves),leaves);
    const first=(/<dt>First short day<\/dt><dd>([\s\S]*?)<\/dd>/.exec(h)||[])[1]||'';
    s.ok('the first short day is not named — it cannot be judged',/can’t judge — the drawer’s balance could not be read/.test(first),first);
    const na=JSON.parse(app.run('JSON.stringify(_maAttention(_maCtx()).map(x=>[x.state,x.sentence]))'));
    s.ok('no "runs short" concern is raised',!na.some(x=>/short of what falls due/.test(x[1])),J(na));
    s.ok('…the plain line is said instead',na.some(x=>x[0]==='watch'&&x[1]==='Can’t judge the next 30 days — the drawer’s balance could not be read.'),J(na));
    s.ok('the day strip marks no day short',!/class="ma-cd[^"]*\bshort\b/.test(h)&&/the drawer’s balance could not be read — these leave it out/.test(h));
    s.ok('(the hero still says it is incomplete)',/drawer not read — incomplete/.test(h));
    app.el('ma-dash-body').innerHTML='';
    await app.run('_maPopulateDashboard()');
    s.ok('the Dashboard card says incomplete beside its figure',/₨1,30,000<\/span> cash in hand <span class="ma-word warn">incomplete — the drawer was not read<\/span>/.test(app.el('ma-dash-body').innerHTML),app.el('ma-dash-body').innerHTML);
  }
  {
    const {app}=mkApp({seed:seed2,globals:store(200000)});
    await app.run('maLoad()');
    const h=app.run("_maPageHTML('ma-overview')");
    const cashBank=(/<dt>Cash and bank today<\/dt><dd>([\s\S]*?)<\/dd>/.exec(h)||[])[1]||'';
    s.ok('with the drawer read, cash and bank is whole: ₨3,30,000, no marker',/₨3,30,000/.test(cashBank)&&!/incomplete/.test(cashBank),cashBank);
    const na=JSON.parse(app.run('JSON.stringify(_maAttention(_maCtx()).map(x=>x[1]||x.sentence))'));
    s.ok('…and nothing about a short day or judging',!na.some(x=>/short of what falls due|Can’t judge/.test(x)),J(na));
  }
  {
    // Core: the concern is replaced only when the calendar is incomplete.
    const {app}=mkApp();
    const na=c=>JSON.parse(app.run('JSON.stringify(maNeedsAttention({today:"2026-10-20",settings:MA_DEFAULT_SETTINGS,holders:[],commitments:[],docs:[],calendar:maCalendar({today:"2026-10-20",commitments:['+J(Object.assign({},rent2,{dueDay:25}))+'],settings:MA_DEFAULT_SETTINGS,start:1000,complete:'+c+'})}).map(x=>x.state+":"+x.sentence))'));
    s.ok('complete and short: the concern names the day',na(true).some(x=>/^concern:On .* run .* short/.test(x)),J(na(true)));
    s.ok('incomplete and short: a watch that says it cannot judge',J(na(false))===J(['watch:Can’t judge the next 30 days — the drawer’s balance could not be read.']),J(na(false)));
  }
  s.section('the drawer read has 12 seconds, is always fresh, says "as of", and is read again after 5 minutes (money M1, S2)');
  {
    // A Store Accounts read that never settles no longer holds the page.
    const quick=(fn,ms)=>setTimeout(fn,ms>=12000?5:ms);
    const {app}=mkApp({seed:seed2,globals:{setTimeout:quick,clearTimeout,loadAccountsData:()=>new Promise(()=>{}),_acctBalances:()=>({cash:1}),_acctLoadErr:null}});
    let done=false;
    const p=app.run('maLoad()').then(()=>{done=true;});
    await new Promise(r=>setTimeout(r,60));
    s.eq('a Store read that never answers: maLoad still resolves',done,true);
    await Promise.race([p,new Promise(r=>setTimeout(r,200))]);   // bounded: a regression must fail by name, not stop the suite
    s.eq('…the drawer is not read, never a figure',app.run("_maCtx().holders.find(h=>h.code==='1010').balance"),null);
    s.ok('…and it says why',/did not answer within 12 seconds/.test(app.run('_maMirror.why')),app.run('_maMirror.why'));
  }
  {
    const calls=[];let cash=200000;
    const g={loadAccountsData:async f=>{calls.push(f);},_acctBalances:()=>({cash}),_acctLoadErr:null};
    const {app}=mkApp({seed:seed2,page:'ma-money',globals:g});
    await app.run('maLoad()');
    s.eq('the read asks Store Accounts for a FRESH copy (force), never its session copy',J(calls),J([true]));
    const at=app.run('_maMirror.at');const d=new Date(at);
    const hhmm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    const money=app.run("_maPageHTML('ma-money')");
    s.ok('the Money page says when it was read',money.indexOf('drawer read from Store Accounts as of '+hhmm)>=0,hhmm);
    s.ok('…and so does the drawer\'s row in the holder table',money.indexOf('in Store Accounts · as of '+hhmm)>=0);
    app.run("_maHolderCode='1010'");
    s.ok('…and the drawer\'s own page',app.run("_maPageHTML('ma-holder')").indexOf('(₨2,00,000, as of '+hhmm+')')>=0);
    // Opening a page within five minutes reads nothing new.
    app.run("_maLastTouch=Date.now();maRenderPage('ma-money')");
    await new Promise(r=>setTimeout(r,10));
    s.eq('a page opened within five minutes reads nothing again',calls.length,1);
    // Older than five minutes: read again on page open, and painted.
    cash=250000;
    app.run('_maMirror.at-=6*60000');
    app.run("maRenderPage('ma-money')");
    await new Promise(r=>setTimeout(r,10));
    s.eq('a page opened after five minutes reads it again',J(calls),J([true,true]));
    s.ok('…and paints the new figure',/₨2,50,000/.test(app.el('main-content').innerHTML));
  }

  /* ── 3. Waiting handovers are not moved on the 30-day panel ──────────── */
  s.section('the 30-day panel counts a waiting handover where it came from (not moved)');
  {
    const {app:mb3}=mkApp();
    const op=built(mb3,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:100000},{account:'1011',side:'dr',amount:40000}]},m(1),'JV-27-0001');
    // MCB → drawer ₨20,000 waits for Raees; he has recorded it (his figure 70,000 = 50,000 + 20,000).
    const inD=built(mb3,'transfer',{date:'2026-09-20',from:'1020',to:'1010',amount:20000},m(2),'TR-27-0001');
    // Afnan → Ammar ₨15,000 waits for Ammar.
    const toAm=built(mb3,'transfer',{date:'2026-09-21',from:'1011',to:'1012',amount:15000},m(3),'TR-27-0002');
    s.eq('(both wait)',J([inD.status,inD.confirmBy,toAm.status,toAm.confirmBy]),J(['pending','raees','pending','ammar']));
    const {app}=mkApp({seed:{ma_journal:{[op.no]:op},ma_transfer:{[inD.no]:inD,[toAm.no]:toAm}},globals:store(70000)});
    await app.run('maLoad()');
    const sp=JSON.parse(app.run('JSON.stringify(maSpendable(_maCtx().holders))'));
    s.eq('cash and bank: MCB 1,00,000 (not moved) + Afnan 40,000 + drawer 70,000 − the 20,000 still to be confirmed',sp.total,190000);
    s.eq('…the 20,000 is named as waiting',sp.waiting,20000);
    s.eq('…and it is complete',sp.complete,true);
    const h=app.run("_maPageHTML('ma-overview')");
    const cashBank=(/<dt>Cash and bank today<\/dt><dd>([\s\S]*?)<\/dd>/.exec(h)||[])[1]||'';
    s.ok('Today\'s panel starts from ₨1,90,000, never ₨2,10,000 (the handover twice)',/₨1,90,000/.test(cashBank),cashBank);
    s.ok('…and says the ₨20,000 is counted where it came from',/<dt>Handovers waiting<\/dt><dd>₨20,000 <span class="ma-muted">into the drawer — counted where they came from until confirmed<\/span>/.test(h));
    const cal=JSON.parse(app.run('JSON.stringify(_maCalendarOf(_maCtx()))'));
    s.eq('the calendar projects from the same start',cal.start,190000);
    // Out of the drawer: left as Store Accounts has it — never added back.
    const out=JSON.parse(app.run('JSON.stringify(maSpendable([{code:"1010",active:true,holderKind:"cash",mirror:"store",balance:50000,pendingIn:0,pendingOut:20000},{code:"1020",active:true,holderKind:"bank",balance:100000,pendingIn:0,pendingOut:0}]))'));
    s.eq('a handover waiting to come OUT of the drawer is not added back',out.total,150000);
    const mixed=JSON.parse(app.run('JSON.stringify(maSpendable([{code:"1011",active:true,holderKind:"cash",balance:40000,pendingOut:15000},{code:"1012",active:true,holderKind:"cash",balance:0,pendingIn:15000}]))'));
    s.eq('between two holders kept here, a waiting handover changes nothing (it posts nothing)',mixed.total,40000);
  }

  /* ── 4. No running balance under a narrowing filter ──────────────────── */
  // The review's reproduction (money F4): MCB opens ₨1,00,000 on 1 Jul; fuel
  // ₨5,000 on 10 Aug; rent ₨15,000 to the landlord on 1 Sep. MCB holds 80,000.
  const {app:mb4}=mkApp();
  const NONE={kind:'none',rate:0,inclusive:true,claimable:false};
  const op4=built(mb4,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:100000},{account:'1011',side:'dr',amount:60000}]},m(1),'JV-27-0001');
  const fuel=built(mb4,'journal',{kind:'money_out',date:'2026-08-10',holder:'1020',account:'6060',payee:'fuel pump',amount:5000,tax:NONE},m(2),'JV-27-0002');
  const rent4=built(mb4,'journal',{kind:'money_out',date:'2026-09-01',holder:'1020',account:'6040',party:'pL',partyKind:'vendor',amount:15000,tax:NONE},m(3),'JV-27-0003');
  const hand=built(mb4,'transfer',{date:'2026-09-02',from:'1010',to:'1011',amount:50000},m(4),'TR-27-0001');
  Object.assign(hand,JSON.parse(mb4.run('JSON.stringify(maConfirmPatch('+J(hand)+',"afnan",{at:'+(T0+99)+'}).patch)')));
  const seed4={ma_journal:{[op4.no]:op4,[fuel.no]:fuel,[rent4.no]:rent4},ma_transfer:{[hand.no]:hand},
    ma_parties:{pL:{id:'pL',kind:'vendor',name:'Landlord',code:'LAND',active:true,vendor:{tax:{regime:'none'}}}}};
  const xl=app=>{const got=[];app.ctx.XLSX={utils:{book_new:()=>({s:[]}),aoa_to_sheet:r=>({r}),book_append_sheet(wb,ws,n){got.push({n,rows:ws.r});}},writeFile(){}};return got;};
  s.section('the Ledger shows no running balance under a party, search or document-type filter (money F4)');
  {
    const {app}=mkApp({seed:seed4,page:'ma-ledger',globals:store(200000)});
    await app.run('maLoad()');
    app.run("_maPeriod='all';_maLedgerTab='postings';_maLF=_maLFBlank();window.maLedgerFilter('holder','1020')");
    const whole=app.run("_maPageHTML('ma-ledger')");
    s.ok('(MCB alone: a Balance column and its opening, closing at ₨80,000)',/<th class="ma-num">Balance<\/th>/.test(whole)&&/₨80,000/.test(whole));
    const cases=[['party','pL','party'],['q','fuel','search'],['dt','transfer','document type']];
    for(const [k,v,word] of cases){
      app.run("_maLF=_maLFBlank();window.maLedgerFilter('holder','1020');window.maLedgerFilter("+J(k)+","+J(v)+")");
      const h=app.run("_maPageHTML('ma-ledger')");
      s.ok('MCB + '+word+': no Balance column',!/<th class="ma-num">Balance<\/th>/.test(h));
      s.ok('…no opening',!/opening ₨/.test(h));
      s.ok('…and it says why',h.indexOf('balance hidden while filtered by '+word+' — a balance over some of an account’s lines is not its balance')>=0);
    }
    app.run("_maLF=_maLFBlank();window.maLedgerFilter('holder','1020');window.maLedgerFilter('party','pL');window.maLedgerFilter('q','rent')");
    s.ok('two filters are both named',app.run("_maPageHTML('ma-ledger')").indexOf('balance hidden while filtered by party and search')>=0);
    // The PDF and the Excel follow the same rule — one decision.
    app.run("_maLF=_maLFBlank();window.maLedgerFilter('holder','1020');window.maLedgerFilter('party','pL')");
    const calls=[];app.ctx.printDocument=o=>{calls.push(o);return Promise.resolve({});};
    app.run("window.maPdf('ledger')");
    const d=(calls[0]||{}).data||{};
    s.eq('the Ledger PDF under a party filter: no opening, no closing',J([d.opening,d.closing]),J([null,null]));
    s.ok('…no balance on any row',Array.isArray(d.rows)&&d.rows.length===1&&d.rows.every(r=>r.balance===null),J(d.rows&&d.rows.map(r=>r.balance)));
    s.eq('…and the reason travels with it',J(d.balanceHidden&&[d.balanceHidden.narrow,d.balanceHidden.mirror]),J([['party'],null]));
    s.eq('…while its totals of the rows shown still stand',J(d.totals),J({dr:0,cr:15000,count:1}));
    const got=xl(app);
    app.run("window.maExcel('ledger')");
    const rows=(got[0]||{}).rows||[];
    s.ok('the Ledger Excel under a party filter has no Balance column',rows[0]&&rows[0].indexOf('Balance')<0,J(rows[0]));
    s.ok('…and its last row says why',/^Balance hidden while filtered by party/.test(String((rows[rows.length-1]||[])[0])),J(rows[rows.length-1]));
    app.run("_maLF=_maLFBlank();window.maLedgerFilter('holder','1020')");
    const got2=xl(app);app.run("window.maExcel('ledger')");
    s.ok('MCB alone: the Excel keeps its Balance column, ending at 80,000',(got2[0].rows[0]||[]).indexOf('Balance')>=0&&got2[0].rows.filter(r=>r.length===9).slice(-1)[0][8]===80000,J(got2[0].rows.slice(-1)));
  }
  /* ── 5. The mirrored drawer gets no invented running balance ─────────── */
  s.section('the drawer (1010) gets no running balance in the Ledger, its PDF or either Excel (money F5)');
  {
    const {app}=mkApp({seed:seed4,page:'ma-ledger',globals:store(200000)});
    await app.run('maLoad()');
    app.run("_maPeriod='all';_maLedgerTab='postings';_maLF=_maLFBlank();window.maLedgerFilter('holder','1010')");
    const h=app.run("_maPageHTML('ma-ledger')");
    s.ok('the Ledger for 1010: no Balance column',!/<th class="ma-num">Balance<\/th>/.test(h));
    s.ok('…never the −₨50,000 made up from the handovers',!/−₨50,000/.test(h));
    const asOf=app.run('_maMirrorAsOf()');
    s.ok('…and Store Accounts\' balance, with when it was read',h.indexOf('no running balance here — the drawer’s balance is Store Accounts’: ₨2,00,000 '+asOf)>=0,asOf);
    const calls=[];app.ctx.printDocument=o=>{calls.push(o);return Promise.resolve({});};
    app.run("window.maPdf('ledger')");
    const d=(calls[0]||{}).data||{};
    s.eq('the Ledger PDF for 1010: no opening or closing, the mirror named, its balance Store Accounts\'',J([d.opening,d.closing,d.balanceHidden&&d.balanceHidden.mirror,d.balanceHidden&&d.balanceHidden.mirrorBalance]),J([null,null,'store',200000]));
    s.ok('…no balance on its rows',(d.rows||[]).every(r=>r.balance===null));
    const got=xl(app);app.run("window.maExcel('ledger')");
    const rows=(got[0]||{}).rows||[];
    s.ok('the Ledger Excel for 1010: no Balance column, and Store Accounts\' figure said',rows[0]&&rows[0].indexOf('Balance')<0&&/Store Accounts’: ₨2,00,000/.test(String((rows[rows.length-1]||[])[0])),J(rows[rows.length-1]));
    app.run("_maHolderCode='1010'");
    const got2=xl(app);app.run("window.maExcel('holder')");
    const hr=(got2[0]||{}).rows||[];
    s.ok('the holder Excel for 1010: no Balance column either',hr[0]&&hr[0].indexOf('Balance')<0&&/Store Accounts’: ₨2,00,000/.test(String((hr[hr.length-1]||[])[0])),J([hr[0],hr[hr.length-1]]));
    app.run("_maHolderCode='1011'");
    const got3=xl(app);app.run("window.maExcel('holder')");
    s.ok('(a holder kept here keeps its Balance column)',(got3[0].rows[0]||[]).indexOf('Balance')>=0);
  }
  {
    const {app}=mkApp({seed:seed4,page:'ma-ledger',globals:store(200000,{cols:['acct_entries']})});
    await app.run('maLoad()');
    app.run("_maPeriod='all';_maLedgerTab='postings';_maLF=_maLFBlank();window.maLedgerFilter('holder','1010')");
    const h=app.run("_maPageHTML('ma-ledger')");
    s.ok('a failed Store read: the Ledger says the drawer could not be read — no figure at all',/the drawer’s balance is Store Accounts’: it could not be read \(Store Accounts could not read acct_entries\)/.test(h)&&!/<th class="ma-num">Balance<\/th>/.test(h));
    const calls=[];app.ctx.printDocument=o=>{calls.push(o);return Promise.resolve({});};
    app.run("window.maPdf('ledger')");
    s.eq('…and its PDF carries "not read" (null), never a figure',((calls[0]||{}).data||{}).balanceHidden&&calls[0].data.balanceHidden.mirrorBalance,null);
  }

  /* ── 6. A commitment payment names its period ────────────────────────── */
  s.section('a commitment payment names the period it settles; a blank one is refused (money F10)');
  const rent6={id:'cR',name:'Rent',kind:'fixed',cadence:'monthly',dueDay:25,amountExpected:150000,account:'6040',holder:'1020',active:true};
  {
    const {app}=mkApp();
    const pay=(p,amt,date)=>({dt:'journal',kind:'money_out',status:'posted',commitmentId:'cR',commitmentPeriod:p,amount:amt||150000,date:date||'2026-08-01'});
    const open=(docs,day)=>app.run('maCommitmentOpenPeriod('+J(rent6)+','+J(docs)+','+J(day)+',MA_DEFAULT_SETTINGS)');
    s.eq('the review\'s case: July paid, August not — a payment on 2 Sep settles August',open([pay('2026-07')],'2026-09-02'),'2026-08');
    s.eq('nothing ever recorded: the latest due on or before the day (August, on 2 Sep)',open([],'2026-09-02'),'2026-08');
    s.eq('a hole is found: July and September paid, August not — a payment on 5 Oct settles August',open([pay('2026-07'),pay('2026-09')],'2026-10-05'),'2026-08');
    s.eq('a part-paid period is still open',open([pay('2026-07'),pay('2026-08',50000)],'2026-09-30'),'2026-08');
    s.eq('everything due already paid: the next period due (paying ahead)',open([pay('2026-07'),pay('2026-08')],'2026-09-20'),'2026-09');
    s.eq('…never one already paid in advance',open([pay('2026-07'),pay('2026-08'),pay('2026-09')],'2026-09-20'),'2026-10');
    s.eq('a void payment does not count',open([pay('2026-07'),Object.assign(pay('2026-08'),{status:'void'})],'2026-09-02'),'2026-08');
    s.eq('a cadence with no calendar day names the day itself',app.run('maCommitmentOpenPeriod({id:"v",cadence:"variable",amountExpected:0},[],"2026-09-02",MA_DEFAULT_SETTINGS)'),'2026-09-02');
    s.eq('a period in the wrong shape is not one ("2026-9")',app.run('maCommitmentPeriodOk('+J(rent6)+',"2026-9")'),false);
    s.eq('(2026-09 is)',app.run('maCommitmentPeriodOk('+J(rent6)+',"2026-09")'),true);
  }
  {
    const {app:mb6}=mkApp();
    const op6=built(mb6,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:900000}]},m(1),'JV-27-0001');
    const jul=built(mb6,'journal',{kind:'money_out',date:'2026-07-25',holder:'1020',account:'6040',payee:'Landlord',amount:150000,tax:NONE,commitmentId:'cR',commitmentPeriod:'2026-07',attachments:[]},m(2),'JV-27-0002');
    const net6={id:'cN',name:'Internet',kind:'fixed',cadence:'monthly',dueDay:10,amountExpected:9000,account:'6030',holder:'1020',active:true};
    const {app,S}=mkApp({seed:{ma_journal:{[op6.no]:op6,[jul.no]:jul},ma_commitments:{cR:rent6,cN:net6}}});
    await app.run('maLoad()');
    app.run("window.maPayCommitment('cR','')");
    const h=app.bodyHtml('ma-modal-back');
    const pv=(/id="ma-f-commitmentPeriod"[^>]*value="([^"]*)"/.exec(h)||[])[1];
    s.eq('Record payment from the register offers the oldest open period, in the field',pv,'2026-08');
    s.ok('…and says what it is',h.indexOf('The oldest period not paid in full on that day — change it if this pays another.')>=0);
    // Another commitment, another date: the suggestion follows both; the owner's own period stays.
    set(app,'ma-f-commitmentPeriod',pv);set(app,'ma-f-commitmentId','cN');set(app,'ma-f-date','2026-09-15');
    app.run('window.maCommitPeriodSync()');
    s.eq('picking the internet, paid on 15 Sep: its September (due the 10th)',app.el('ma-f-commitmentPeriod').value,'2026-09');
    set(app,'ma-f-date','2026-09-02');
    app.run('window.maCommitPeriodSync()');
    s.eq('…and dated 2 Sep instead: August, the latest due by then',app.el('ma-f-commitmentPeriod').value,'2026-08');
    app.run("window.maCommitPeriodTyped()");set(app,'ma-f-commitmentPeriod','2026-10');set(app,'ma-f-date','2026-09-28');
    app.run('window.maCommitPeriodSync()');
    s.eq('once the owner types a period it is theirs — a new date leaves it',app.el('ma-f-commitmentPeriod').value,'2026-10');
    // A blank period is refused and nothing is written.
    const fill=period=>{set(app,'ma-f-date','2026-09-02');set(app,'ma-f-holder','1020');set(app,'ma-f-account','6040');set(app,'ma-f-payee','Landlord');set(app,'ma-f-party','');set(app,'ma-f-amount','150000');set(app,'ma-f-taxkind','none');
      set(app,'ma-f-costCentre','factory');set(app,'ma-f-labelKind','');set(app,'ma-f-po','');set(app,'ma-f-article','');set(app,'ma-f-commitmentId','cR');set(app,'ma-f-commitmentPeriod',period);set(app,'ma-f-tags','');set(app,'ma-f-note','');};
    fill('');
    await app.run('window.maSaveForm()');await app.run('window.maSaveForm()');
    s.eq('"Settles a commitment" with the period left blank writes nothing',S.tx.length,0);
    s.ok('…and says which period is the oldest still open',/Say which period this pays — the oldest still open on that day is 2026-08\./.test(app.el('ma-e-commitmentPeriod').textContent),app.el('ma-e-commitmentPeriod').textContent);
    fill('2026-8');
    await app.run('window.maSaveForm()');await app.run('window.maSaveForm()');
    s.ok('a period in the wrong shape is refused too',S.tx.length===0&&/is not a period of Rent — write it as 2026-08\./.test(app.el('ma-e-commitmentPeriod').textContent),app.el('ma-e-commitmentPeriod').textContent);
    fill('2026-08');
    await app.run('window.maSaveForm()');if(!S.tx.length)await app.run('window.maSaveForm()');
    const d=((S.tx[0]||[]).find(x=>x.col==='ma_journal')||{}).data||{};
    s.eq('named, it is written against August',J([d.commitmentId,d.commitmentPeriod]),J(['cR','2026-08']));
    const st=JSON.parse(app.run("JSON.stringify(maCommitmentStatus(_maCommit('cR'),_maCtx().docs,'2026-09-28',_maCtx().s))"));
    s.eq('…so September still reads as owed, never paid by a late August',st.state==='paid',false);
  }

  /* ── 1. The forms never write a value the owner did not choose ─────── */
  s.section('an untouched form saves exactly what was stored — cost centre, kind, channel, tax, lines, tags (money F1)');
  {
    const {app:mb}=mkApp();
    const NONE={kind:'none'};
    const base={date:'2026-09-10',holder:'1020',account:'6040',payee:'Landlord',amount:15000,tax:NONE,note:'rent',attachments:[]};
    const D=[
      built(mb,'journal',Object.assign({kind:'money_out'},base),m(1),'JV-27-0001'),                                   // no cost centre
      built(mb,'journal',Object.assign({kind:'money_out',costCentre:'online'},base,{amount:15001}),m(2),'JV-27-0002'), // one taken off the list
      built(mb,'journal',Object.assign({},base,{kind:'money_out',amount:15002,costCentre:'factory',labelKind:'transfer',channel:'warehouse',tax:{kind:'sales',rate:18,inclusive:true,ref:'STN-1'}}),m(3),'JV-27-0003'),
      built(mb,'journal',{kind:'money_in',date:'2026-09-10',holder:'1020',account:'4090',payee:'Mill',amount:15003,tax:NONE,costCentre:'factory',commitmentId:'cR',commitmentPeriod:'2026-08',note:'x',attachments:[]},m(4),'JV-27-0004'),
      built(mb,'journal',{kind:'general',date:'2026-09-10',lines:[{account:'6040',dr:500,costCentre:'office'},{account:'1020',cr:500}],tags:['audit'],note:'x'},m(5),'JV-27-0005'),
      built(mb,'transfer',{date:'2026-09-10',from:'1020',to:'1011',amount:5000,tags:['x'],note:'x'},m(6),'TR-27-0001'),
      built(mb,'journal',Object.assign({},base,{kind:'money_out',holder:'1030',amount:15004,costCentre:'factory'}),m(7),'JV-27-0006'), // a holder switched off since
      built(mb,'journal',Object.assign({},base,{kind:'money_out',account:'6150',amount:15005,costCentre:'factory'}),m(8),'JV-27-0007') // an account switched off since
    ];
    const seed={ma_journal:{},ma_transfer:{},ma_settings:{main:{costCentres:['factory','warehouse','office','owners'],defaultCostCentre:'factory'}},
      ma_accounts:{'6150':{code:'6150',active:false}},
      ma_commitments:{cR:{id:'cR',name:'Rent',kind:'fixed',cadence:'monthly',dueDay:25,amountExpected:150000,account:'6040',holder:'1020',active:true}}};
    D.forEach(d=>{seed[d.dt==='transfer'?'ma_transfer':'ma_journal'][d.id]=d;});
    const {app,S,db}=mkApp({seed});
    await app.run('maLoad()');
    const editNote=async d=>{
      app.run('window.maEditDoc('+J(d.dt)+','+J(d.id)+')');
      const u=untouched(app);
      set(app,'ma-f-note',(d.note||'')+' — checked');set(app,'ma-f-reason','the note');
      const n=S.tx.length;
      await app.run('window.maSaveForm()');if(S.tx.length===n)await app.run('window.maSaveForm()');
      const w=S.tx.length>n?(S.tx[S.tx.length-1].find(x=>x.col===(d.dt==='transfer'?'ma_transfer':'ma_journal'))||{}).data:null;
      const why=app.el('ma-f-issues').innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      return {u,w,row:w&&w.edits[w.edits.length-1],why};
    };
    let r=await editNote(D[0]);
    s.eq('stored with no cost centre, the edit form preselects the blank — not the default',r.u['ma-f-costCentre'].value,'');
    s.ok('…and says what a blank means',r.u['ma-f-costCentre'].opts.some(o=>o.v===''&&o.t==='Settings’ default (now factory)'));
    s.eq('a note edit writes the cost centre back as it was ("")',r.w&&r.w.costCentre,'');
    s.eq('…and its row names the note alone',J(r.row&&r.row.fields),J(['note']));
    r=await editNote(D[1]);
    s.eq('a cost centre taken off the list since is still offered, and preselected',r.u['ma-f-costCentre'].value,'online');
    s.ok('…under a name that says so',r.u['ma-f-costCentre'].opts.some(o=>o.v==='online'&&/no longer in Settings/.test(o.t)));
    s.eq('a note edit keeps "online" — the check lets an edit keep what it had',r.w&&r.w.costCentre,'online',r.why);
    s.eq('…naming the note alone',J(r.row&&r.row.fields),J(['note']));
    r=await editNote(D[2]);
    s.eq('a kind the form does not offer (transfer) is kept',r.w&&r.w.labelKind,'transfer');
    s.eq('Money out has no channel field — its stored channel is kept',r.w&&r.w.channel,'warehouse');
    s.eq('the tax block\'s reference has no field — it is kept',r.w&&r.w.tax&&r.w.tax.ref,'STN-1');
    s.eq('…so nothing but the note is named (tax untouched, review not cleared)',J(r.row&&r.row.fields),J(['note']));
    r=await editNote(D[3]);
    s.eq('Money in has no commitment field — its stored commitment and period are kept',J(r.w&&[r.w.commitmentId,r.w.commitmentPeriod]),J(['cR','2026-08']));
    s.eq('…naming the note alone',J(r.row&&r.row.fields),J(['note']));
    r=await editNote(D[4]);
    s.eq('a journal line\'s own cost centre (no field on the form) is kept',r.w&&r.w.lines&&r.w.lines[0].costCentre,'office');
    s.eq('a journal\'s tags (no field on its form) are kept',J(r.w&&r.w.tags),J(['audit']));
    s.eq('…naming the note alone',J(r.row&&r.row.fields),J(['note']));
    r=await editNote(D[5]);
    s.eq('a transfer\'s tags are kept, so the rules see no unnamed field',J(r.w&&r.w.tags),J(['x']));
    s.eq('…naming the note alone',J(r.row&&r.row.fields),J(['note']));
    r=await editNote(D[6]);
    s.ok('a holder switched off since is offered, and preselected',r.u['ma-f-holder'].value==='1030'&&r.u['ma-f-holder'].opts.some(o=>o.v==='1030'&&/switched off/.test(o.t)));
    s.eq('…and a note edit keeps it — the check lets an edit keep what it had',r.w&&r.w.holder,'1030',r.why);
    r=await editNote(D[7]);
    s.eq('an account switched off since: a note edit keeps it',r.w&&r.w.account,'6150',r.why);
    // A NEW document may not pick what was taken off the list.
    app.run("window.maRecordKind('money_out')");untouched(app);
    set(app,'ma-f-holder','1020');set(app,'ma-f-account','6040');set(app,'ma-f-payee','Landlord');set(app,'ma-f-amount','900');set(app,'ma-f-costCentre','online');
    const n0=S.tx.length;
    await app.run('window.maSaveForm()');await app.run('window.maSaveForm()');
    s.ok('a new document on a cost centre taken off the list is refused',S.tx.length===n0&&/Unknown cost centre “online”/.test(app.el('ma-e-costCentre').textContent),app.el('ma-e-costCentre').textContent);
    app.run("window.maRecordKind('money_out')");const nu=untouched(app);
    s.eq('a new document starts on the default, where the owner can see it',nu['ma-f-costCentre'].value,'factory');
    s.eq('…and "Settles a commitment" on No',nu['ma-f-commitmentId'].value,'');
    app.run('window.maCloseModal()');
    void db;
  }
  s.section('the commitment and party forms keep what was stored (money F1)');
  {
    const cm={id:'cR',name:'Rent',kind:'fixed',cadence:'monthly',dueDay:25,amountExpected:150000,account:'6040',holder:'1030',party:null,costCentre:'online',from:null,to:null,note:'',active:true,history:[]};
    const pa={id:'p1',kind:'vendor',name:'Mill',code:'MILL',active:true,costCentre:'',contact:{person:'',phone:''},notes:'',vendor:{roles:['fabric_mill'],tax:{regime:'none'}},history:[]};
    const pb=Object.assign({},pa,{id:'p2',name:'Dyer',code:'DYER',costCentre:'online'});
    const ce=Object.assign({},cm,{id:'cE',name:'Water',holder:'1020',costCentre:''});
    const {app,S}=mkApp({seed:{ma_settings:{main:{costCentres:['factory','warehouse','office','owners'],defaultCostCentre:'factory'}},ma_commitments:{cR:cm,cE:ce},ma_parties:{p1:pa,p2:pb}}});
    await app.run('maLoad()');
    const lastWrite=col=>{const b=S.batches[S.batches.length-1]||[];return ((b.find(x=>x.col===col)||{}).data)||(((S.tx[S.tx.length-1]||[]).find(x=>x.col===col)||{}).data)||null;};
    app.run("window.maRecordKind('commitment',{id:'cR'})");
    let u=untouched(app);
    s.eq('a commitment\'s removed cost centre is preselected, not the default',u['ma-f-costCentre'].value,'online');
    s.eq('…and its switched-off holder, not "Not fixed"',u['ma-f-holder'].value,'1030');
    set(app,'ma-f-note','checked');
    const nb=S.batches.length+S.tx.length;
    await app.run('window.maSaveForm()');
    let w=lastWrite('ma_commitments');
    s.ok('a note edit of the commitment keeps both',S.batches.length+S.tx.length>nb&&w&&w.costCentre==='online'&&w.holder==='1030',J(w&&[w.costCentre,w.holder]));
    s.eq('…and its history names the note alone',J(w&&w.history[w.history.length-1].fields),J(['note']));
    app.run("window.maRecordKind('commitment',{id:'cE'})");
    u=untouched(app);
    s.eq('a commitment with no cost centre shows the blank, not the default',u['ma-f-costCentre'].value,'');
    set(app,'ma-f-note','checked');
    await app.run('window.maSaveForm()');
    w=lastWrite('ma_commitments');
    s.eq('…and a note edit keeps it blank',J(w&&[w.id,w.costCentre]),J(['cE','']));
    app.run("window.maPartyForm('p1')");
    u=untouched(app);
    s.eq('a party with no cost centre shows the blank, not the default',u['ma-f-costCentre'].value,'');
    set(app,'ma-f-pnotes','checked');
    await app.run('window.maSaveForm()');
    w=lastWrite('ma_parties');
    s.eq('…and a notes edit keeps it blank — no longer coerced to the default',w&&w.costCentre,'');
    s.eq('…naming the notes alone',J(w&&w.history[w.history.length-1].fields),J(['notes']));
    app.run("window.maPartyForm('p2')");
    u=untouched(app);
    set(app,'ma-f-pnotes','checked');
    await app.run('window.maSaveForm()');
    w=lastWrite('ma_parties');
    s.eq('a party on a cost centre taken off the list keeps it through an edit',w&&w.id==='p2'&&w.costCentre,'online');
  }
  s.section('a default cost centre that moves is said (money F1)');
  {
    const {app}=mkApp({page:'ma-close'});
    await app.run('maLoad()');
    app.run("maRenderPage('ma-close')");app.run("window.maCloseTabSet('settings')");
    const held=hold(app,app.el('main-content').innerHTML);
    s.ok('(the Settings page is up, with its re-lock minutes)',held['ma-s-relock']&&held['ma-s-relock'].value==='15',J(Object.keys(held).slice(0,8)));
    set(app,'ma-s-cc','warehouse, office');set(app,'ma-s-ccdef','factory');
    await app.run('window.maSaveSettings()');
    const t=app.state.toasts[app.state.toasts.length-1]||'';
    s.ok('taking the default off the list says the new default, and that blank ones move with it',/The default cost centre is now warehouse \(factory is no longer on the list\) — anything recorded without a cost centre of its own now posts there\./.test(t),t||app.el('ma-s-err').textContent);
  }

  /* ── 7. A save that fails after its dialog was closed ─────────────────── */
  s.section('a save that fails after its dialog closed says what was not saved (money F13)');
  {
    let release;const gate=()=>new Promise(r=>{release=r;});
    const refused=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
    let hold=null;
    const {app:mb}=mkApp();
    const cap=built(mb,'journal',{kind:'capital',date:'2026-09-02',holder:'1011',owner:'afnan',amount:420000,note:'x'},m(1),'JV-27-0001');
    const {app,S}=mkApp({seed:{ma_journal:{[cap.no]:cap}},globals:{
      runTransaction:async()=>{S.tx.push([]);if(hold)await hold;throw refused;},
      writeBatch:()=>({set(){},async commit(){if(hold)await hold;throw refused;}})}});
    await app.run('maLoad()');
    const toasts=()=>app.state.toasts.slice();
    const fillCap=()=>{untouched(app);set(app,'ma-f-date','2026-09-02');set(app,'ma-f-holder','1011');set(app,'ma-f-amount','500000');set(app,'ma-f-owner','afnan');set(app,'ma-f-note','');};
    // Open: the failure is said in the form, not as a toast.
    app.run("window.maRecordKind('capital')");fillCap();
    let t0=toasts().length;
    await app.run('window.maSaveForm()');
    s.ok('with the form still open, the failure is said in it',/Refused by the Firestore rules[\s\S]*Nothing was saved\./.test(app.el('ma-f-issues').innerHTML)&&toasts().length===t0);
    // Closed while the save was in flight.
    hold=gate();
    const p1=app.run('window.maSaveForm()');
    app.run('window.maCloseModal()');
    release();await p1;
    let t=toasts().slice(t0);
    s.ok('closed while it saved: a toast names what was not saved',t.some(x=>/^Not saved: Owner put money in · ₨5,00,000 · Wed 2 Sep — Refused by the Firestore rules/.test(x)&&/Record it again\.$/.test(x)),J(t));
    // An edit, closed while saving.
    app.run("window.maEditDoc('journal','JV-27-0001')");untouched(app);set(app,'ma-f-note','y');set(app,'ma-f-reason','a note');
    hold=gate();t0=toasts().length;
    const p2=app.run('window.maSaveForm()');
    app.run('window.maCloseModal()');release();await p2;
    t=toasts().slice(t0);
    s.ok('…and an edit says which document',t.some(x=>/^Not saved: the edit to JV-27-0001 — /.test(x)),J(t));
    // Replaced by another form: the new form is not blamed, the toast says it.
    app.run("window.maRecordKind('capital')");fillCap();
    hold=gate();t0=toasts().length;
    const p3=app.run('window.maSaveForm()');
    app.run("window.maCloseModal();window.maRecordKind('money_out')");release();await p3;
    t=toasts().slice(t0);
    s.ok('a form opened meanwhile is not blamed: the toast says it',t.some(x=>/^Not saved: Owner put money in/.test(x))&&!/Refused/.test(app.el('ma-f-issues').innerHTML),J(t));
    app.run('window.maCloseModal()');
    // A commitment and a party, closed while saving.
    app.run("window.maRecordKind('commitment')");untouched(app);
    set(app,'ma-f-name','Rent — factory');set(app,'ma-f-account','6040');set(app,'ma-f-amountExpected','150000');set(app,'ma-f-dueDay','25');
    hold=gate();t0=toasts().length;
    const p4=app.run('window.maSaveForm()');
    app.run('window.maCloseModal()');release();await p4;
    t=toasts().slice(t0);
    s.ok('a commitment closed while saving: "Not saved: the new commitment Rent — factory"',t.some(x=>/^Not saved: the new commitment Rent — factory — /.test(x)),J(t));
    app.run("window.maPartyForm()");untouched(app);
    set(app,'ma-f-name','Mill Two');set(app,'ma-f-code','MILL2');
    hold=gate();t0=toasts().length;
    const p5=app.run('window.maSaveForm()');
    app.run('window.maCloseModal()');release();await p5;
    t=toasts().slice(t0);
    s.ok('a party closed while saving says so',t.some(x=>/^Not saved: the new party Mill Two — /.test(x)),J(t));
  }

  /* ── 8. Backups, share links, the books, "5.000", In and Out ─────────── */
  s.section('a failed backups read is a concern on Today and on the Dashboard card (money M2)');
  {
    const {app}=mkApp({fail:['ma_backups']});
    await app.run('maLoad()');
    app.run("maRenderPage('ma-overview')");
    s.ok('Today says the backups could not be read',/The backups could not be read — whether last night’s ran is not known\./.test(app.el('main-content').innerHTML));
    const na=JSON.parse(app.run('JSON.stringify(_maAttention(_maCtx()))'));
    s.eq('…as a concern, not a watch',(na.find(x=>/backups could not be read/.test(x.sentence))||{}).state,'concern');
    app.el('ma-dash-body');
    await app.run('_maPopulateDashboard()');
    s.ok('the Dashboard card says it too',/the backups could not be read/.test(app.el('ma-dash-body').innerHTML),app.el('ma-dash-body').innerHTML);
    const {app:ok}=mkApp({seed:{ma_backups:{b1:{at:Date.now()-3600000,state:'done'}}}});
    await ok.run('maLoad()');ok.el('ma-dash-body');await ok.run('_maPopulateDashboard()');
    s.ok('a backups read that worked adds nothing',!/backups could not be read/.test(ok.el('ma-dash-body').innerHTML)&&!JSON.parse(ok.run('JSON.stringify(_maAttention(_maCtx()))')).some(x=>/backups/.test(x.sentence)));
  }
  s.section('a share is "live" only when the ma-share function would serve it');
  {
    const M=require(path.join(ROOT,'js/ma-core.js'));
    const {loadFn}=require('./ma-fake-admin');
    const fn=loadFn('netlify/functions/ma-share.js',{docs:{}});
    const NOW=Date.UTC(2026,8,28,6);const DAY=86400000;const PID='ma/'+'a'.repeat(64);
    const ok={pdfPublicId:PID,format:'pdf',resourceType:'image',deliveryType:'authenticated',createdAt:NOW-DAY,expiresAt:NOW+6*DAY,revoked:false};
    const cases=[['whole',{}],['no file',{pdfPublicId:undefined}],['not a pdf',{format:'jpg'}],['PDF in capitals',{format:'PDF'}],['a raw file',{resourceType:'raw'}],
      ['resource type blank',{resourceType:''}],['a public file in a folder',{deliveryType:'upload',pdfPublicId:'groovy/'+PID}],['a folder on a private file',{pdfPublicId:'groovy/'+PID}],
      ['delivery unknown',{deliveryType:'private'}],['made in the future',{createdAt:NOW+10*60000,expiresAt:NOW+DAY}],['longer than 90 days',{createdAt:NOW-DAY,expiresAt:NOW-DAY+91*DAY}],
      ['expiry before made',{expiresAt:NOW-2*DAY}],['no createdAt',{createdAt:undefined}],['expired',{createdAt:NOW-8*DAY,expiresAt:NOW-DAY}],['withdrawn',{revoked:true}],['revoked missing',{revoked:undefined}]];
    const word={live:'live',expired:'expired',revoked:'revoked',invalid:'unknown'};
    const disagree=cases.filter(([n,o])=>M.maShareState(Object.assign({},ok,o),NOW)!==word[fn._test.shareState(Object.assign({},ok,o),NOW).state]).map(c=>c[0]);
    s.eq('the page and the server agree on all '+cases.length+' shapes',J(disagree),J([]));
    s.eq('a record with no file is not called live',M.maShareState(Object.assign({},ok,{pdfPublicId:undefined}),NOW),'unknown');
  }
  s.section('voiding a document withdraws its live share links (money M3)');
  {
    const NOWS=Date.now();const DAY=86400000;const PID='ma/'+'b'.repeat(64);
    const {app:mb}=mkApp();
    const d=built(mb,'journal',{kind:'money_out',date:'2026-09-10',holder:'1020',account:'6040',payee:'Landlord',amount:15000,tax:{kind:'none'},note:'rent',attachments:[]},m(1),'JV-27-0001');
    const sh=o=>Object.assign({docKind:'journal',docId:'JV-27-0001',docNo:'JV-27-0001 · rev 1',pdfPublicId:PID,format:'pdf',resourceType:'image',deliveryType:'authenticated',
      filename:'Voucher-JV-27-0001.pdf',createdBy:'afnan',createdAt:NOWS-DAY,expiresAt:NOWS+6*DAY,revoked:false},o||{});
    const T=c=>c.repeat(43);
    const shares={[T('a')]:sh(),[T('b')]:sh({createdAt:NOWS-9*DAY,expiresAt:NOWS-2*DAY}),[T('c')]:sh({revoked:true,revokedAt:NOWS,revokedBy:'afnan'}),[T('d')]:sh({docKind:'transfer'}),[T('e')]:sh({pdfPublicId:undefined})};
    const world=o=>{
      const calls=[];
      const {app,S,db}=mkApp(Object.assign({seed:{ma_journal:{[d.no]:clone(d)},ma_shares:clone(shares)},globals:{prompt:()=>'entered twice',
        fetch:async(url,opts)=>{const b=JSON.parse(opts.body);calls.push({url,b});if(o&&o.refuse)return {ok:false,status:500,json:async()=>({error:'The server is down.'})};return {ok:true,status:200,json:async()=>({token:b.token,revoked:true,revokedAt:1,revokedBy:'afnan'})};}}},o||{}));
      return {app,S,db,calls};
    };
    let w=world();
    await w.app.run('maLoad()');
    await w.app.run("window.maVoidDoc('journal','JV-27-0001')");
    const t=w.app.state.toasts[w.app.state.toasts.length-1]||'';
    s.eq('the one live link to it is withdrawn, through ma-share',J(w.calls.map(c=>[c.url.split('/').pop(),c.b.action,c.b.token])),J([['ma-share','revoke',T('a')]]));
    s.ok('…and the toast says so',/JV-27-0001 voided — it stays on the record, struck through\. Its live link was withdrawn\./.test(t),t);
    s.ok('(expired, withdrawn, another document\'s, and one the server would not serve are left alone)',w.calls.length===1);
    w=world({refuse:true});
    await w.app.run('maLoad()');await w.app.run("window.maVoidDoc('journal','JV-27-0001')");
    let t2=w.app.state.toasts[w.app.state.toasts.length-1]||'';
    s.ok('a withdrawal that fails is said, never assumed',/1 of its 1 live link could not be withdrawn — open Share on it and withdraw it\./.test(t2),t2);
    w=world({fail:['ma_shares']});
    await w.app.run('maLoad()');await w.app.run("window.maVoidDoc('journal','JV-27-0001')");
    t2=w.app.state.toasts[w.app.state.toasts.length-1]||'';
    s.ok('links that could not be read are said too',/Its share links could not be read — open Share on it and withdraw any that are live\./.test(t2),t2);
    s.eq('…while the void itself stands',w.app.run("_maDoc('journal','JV-27-0001').status"),'void');
  }
  s.section('a live link says when its document changed after it was made (money M3)');
  {
    const NOWS=Date.now();const DAY=86400000;const PID='ma/'+'c'.repeat(64);
    const {app:mb}=mkApp();
    const d=built(mb,'journal',{kind:'money_out',date:'2026-09-10',holder:'1020',account:'6040',payee:'Landlord',amount:15000,tax:{kind:'none'},note:'rent',attachments:[]},m(1),'JV-27-0001');
    d.edits=[{at:NOWS-2*3600000,by:'afnan',byName:'Afnan',reason:'amount',fields:['amount'],before:{amount:14000},after:{amount:15000}}];
    const sh=o=>Object.assign({docKind:'journal',docId:'JV-27-0001',pdfPublicId:PID,format:'pdf',resourceType:'image',deliveryType:'authenticated',
      filename:'Voucher-JV-27-0001.pdf',createdBy:'afnan',createdAt:NOWS-DAY,expiresAt:NOWS+6*DAY,revoked:false},o||{});
    const T=c=>c.repeat(43);
    const {app}=mkApp({seed:{ma_journal:{[d.no]:clone(d)},ma_shares:{[T('a')]:sh({docNo:'JV-27-0001 · rev 1'}),[T('b')]:sh({docNo:'JV-27-0001 · rev 2',filename:'Voucher-2.pdf'}),[T('c')]:sh({docNo:'JV-27-0001',filename:'Voucher-old.pdf'})}},
      globals:{fetch:async()=>({ok:true,status:200,json:async()=>({mode:'authenticated',configured:true})})}});
    await app.run('maLoad()');
    const sp=JSON.parse(app.run("JSON.stringify(_maShareSpec('journal','JV-27-0001').subject)"));
    s.eq('a link is made carrying the revision the PDF is at',J([sp.no,sp.rev]),J(['JV-27-0001 · rev 2',2]));
    app.run("window.maDocShare('journal','JV-27-0001')");
    await new Promise(r=>setTimeout(r,20));
    const list=app.el('ma-sh-list').innerHTML;
    const items=list.split('<li class="ma-sh-item">').slice(1);
    const of=f=>items.find(x=>x.indexOf(f)>=0)||'';
    s.ok('made at rev 1, the document at rev 2: the list says it changed since',/Made at rev 1 — the document has changed since \(it is at rev 2 now\)\. The link still serves the old PDF\./.test(of('Voucher-JV-27-0001.pdf')));
    s.ok('made at rev 2: nothing to say',of('Voucher-2.pdf')&&!/Made at rev/.test(of('Voucher-2.pdf')));
    s.ok('a link made before the revision was written into it: read from the edits before it',/Made at rev 1 — the document has changed since/.test(of('Voucher-old.pdf')));
    app.run('window.maCloseModal()');
    app.run("_maDoc('journal','JV-27-0001').status='void'");
    app.run("window.maDocShare('journal','JV-27-0001')");
    await new Promise(r=>setTimeout(r,20));
    s.ok('a voided document: the list says so on each live link',/Made at rev 2 — the document has been voided since\. Withdraw the link\./.test(app.el('ma-sh-list').innerHTML));
  }
  s.section('Download the books carries no share token');
  {
    const M=require(path.join(ROOT,'js/ma-core.js'));
    const NOW=Date.UTC(2026,8,28,6);const DAY=86400000;const PID='ma/'+'d'.repeat(64);
    const live='L'.repeat(43),old='E'.repeat(43);
    const rec=o=>Object.assign({docKind:'journal',docId:'JV-27-0001',docNo:'JV-27-0001 · rev 1',pdfPublicId:PID,format:'pdf',resourceType:'image',deliveryType:'authenticated',createdAt:NOW-DAY,expiresAt:NOW+DAY,revoked:false},o||{});
    const cols={ma_shares:[{id:live,data:rec()},{id:old,data:rec({createdAt:NOW-9*DAY,expiresAt:NOW-DAY})}],ma_journal:[{id:'JV-27-0001',data:{no:'JV-27-0001'}}]};
    const json=JSON.stringify(M.maBooksJson({cols,failed:[],at:NOW,by:'afnan'}));
    const sheets=JSON.stringify(M.maBooksSheets({cols,failed:[],at:NOW,by:'afnan'}));
    s.ok('neither the JSON nor the workbook holds a token',json.indexOf(live)<0&&json.indexOf(old)<0&&sheets.indexOf(live)<0&&sheets.indexOf(old)<0);
    s.ok('…each link is there, as its state',/"id":"withheld — live"/.test(json)&&/"id":"withheld — expired"/.test(json)&&/withheld — live/.test(sheets));
    s.eq('…and the rest of the books are untouched',M.maBooksJson({cols,failed:[],at:NOW}).collections.ma_journal[0].id,'JV-27-0001');
  }
  s.section('"5.000" is refused, and says what it probably meant (money N2)');
  {
    const M=require(path.join(ROOT,'js/ma-core.js'));
    s.ok('the parser reads "5.000" as nothing — not ₨5',Number.isNaN(M.maParseRupees('5.000'))&&Number.isNaN(M.maParseRupees('1.500.000'))&&Number.isNaN(M.maParseRupees('₨ 15.000')));
    s.eq('…while 5.00 and 5.5 are still read as they were',J([M.maParseRupees('5.00'),M.maParseRupees('5.5'),M.maParseRupees('1,50,000')]),J([5,5.5,150000]));
    s.eq('what it probably meant',J([M.maRupeesDotted('5.000'),M.maRupeesDotted('1.500.000'),M.maRupeesDotted('5.00'),M.maRupeesDotted('5000')]),J(['5,000','15,00,000','','']));
    const {app,S}=mkApp();
    await app.run('maLoad()');
    app.run("window.maRecordKind('capital')");untouched(app);
    set(app,'ma-f-date','2026-09-02');set(app,'ma-f-holder','1011');set(app,'ma-f-amount','5.000');set(app,'ma-f-owner','afnan');
    await app.run('window.maSaveForm()');await app.run('window.maSaveForm()');
    s.ok('a form with "5.000" writes nothing, and asks',S.tx.length===0&&/The amount “5\.000” — did you mean 5,000\? Rupees take a comma, or none\./.test(app.el('ma-e-amount').textContent),app.el('ma-e-amount').textContent);
    app.run('window.maCloseModal()');
    app.run("window.maRecordKind('general')");
    app.run("_maF.lines=[{account:'6040',dr:'1.500',cr:'',party:'',memo:''},{account:'1020',dr:'',cr:'1500',party:'',memo:''}]");
    set(app,'ma-f-date','2026-09-02');
    await app.run('window.maSaveForm()');
    s.ok('…and a journal line says which line',/Line 1 debit “1\.500” — did you mean 1,500\?/.test(app.el('ma-e-lines').textContent),app.el('ma-e-lines').textContent);
    app.run('window.maCloseModal()');
    app.run("window.maRecordKind('commitment')");untouched(app);
    set(app,'ma-f-name','Rent — factory');set(app,'ma-f-account','6040');set(app,'ma-f-amountExpected','150.000');set(app,'ma-f-dueDay','25');
    const nb=S.batches.length;
    await app.run('window.maSaveForm()');
    s.ok('a commitment\'s expected amount too',S.batches.length===nb&&/The expected amount “150\.000” — did you mean 1,50,000\?/.test(app.el('ma-e-amountExpected').textContent),app.el('ma-e-amountExpected').textContent);
  }
  s.section('"In" and "Out" this month leave out openings and money moved between holders (money N3)');
  {
    const {app:mb}=mkApp();
    const T=new Date();const mon=T.getFullYear()+'-'+String(T.getMonth()+1).padStart(2,'0');const day=mon+'-01';
    const D=[
      built(mb,'journal',{kind:'opening',date:day,lines:[{account:'1020',side:'dr',amount:900000},{account:'3090',side:'cr',amount:900000}]},m(1),'JV-27-0001'),
      built(mb,'journal',{kind:'general',date:day,lines:[{account:'1012',dr:50000},{account:'1020',cr:50000}]},m(2),'JV-27-0002'),
      built(mb,'journal',{kind:'money_out',date:day,holder:'1020',account:'6040',payee:'Landlord',amount:15000,tax:{kind:'none'},note:'x',attachments:[]},m(3),'JV-27-0003'),
      built(mb,'journal',{kind:'money_in',date:day,holder:'1020',account:'4090',payee:'Buyer',amount:7000,tax:{kind:'none'},note:'x',attachments:[]},m(4),'JV-27-0004'),
      built(mb,'journal',{kind:'general',date:day,lines:[{account:'1012',dr:2000},{account:'1020',cr:1500},{account:'4090',cr:500}]},m(5),'JV-27-0005'),
      built(mb,'transfer',{date:day,from:'1020',to:'1011',amount:3000},m(6),'TR-27-0001')
    ];
    const seed={ma_journal:{},ma_transfer:{}};D.forEach(d=>{seed[d.dt==='transfer'?'ma_transfer':'ma_journal'][d.id]=d;});
    const {app}=mkApp({seed});
    await app.run('maLoad()');
    const f=JSON.parse(app.run('JSON.stringify(_maMonthFlows(_maCtx()))'));
    s.eq('in: the money in (7,000) and what a journal brought in net (500) — no opening, no move between holders',f.inM,7500);
    s.eq('out: the rent (15,000) alone',f.outM,15000);
  }

  /* ── 12. The tax a new document starts on comes from the party ───────── */
  s.section('a new document\'s tax starts on the party\'s usual, and a preset is never called a choice (§12, money N1)');
  {
    const pv=(id,name,tax)=>({id,kind:'vendor',name,code:name.toUpperCase().replace(/[^A-Z]/g,'').slice(0,8),active:true,costCentre:'factory',contact:{person:'',phone:''},notes:'',vendor:{roles:[],tax},history:[]});
    const {app,S}=mkApp({seed:{ma_parties:{pS:pv('pS','Stitcher',{regime:'sales'}),pW:pv('pW','Washer',{regime:'none',withholdingPct:4}),pN:pv('pN','Plumber',{regime:'none'})}}});
    await app.run('maLoad()');
    app.run("window.maRecordKind('money_out',{party:'pS'})");
    let u=untouched(app);let h=app.bodyHtml('ma-modal-back');
    s.eq('with a sales-tax vendor, the form starts on sales tax',u['ma-f-taxkind'].value,'sales');
    s.ok('…with no rate, and says where it came from',u['ma-f-taxrate'].value===''&&/Stitcher’s usual tax is sales tax — confirm it by giving the rate, or change it\./.test(h));
    set(app,'ma-f-date','2026-09-02');set(app,'ma-f-holder','1020');set(app,'ma-f-account','5020');set(app,'ma-f-amount','1500');
    await app.run('window.maSaveForm()');await app.run('window.maSaveForm()');
    s.ok('…so saving without the rate is refused — the owner confirms it',S.tx.length===0&&/A tax rate is between 0 and 100%/.test(app.el('ma-e-tax').textContent),app.el('ma-e-tax').textContent);
    app.run('window.maCloseModal()');
    app.run("window.maRecordKind('money_out')");u=untouched(app);h=app.bodyHtml('ma-modal-back');
    s.ok('with no party: No tax, said to be a preset, not a choice',u['ma-f-taxkind'].value==='none'&&/No tax is pre-set, not chosen — pick the treatment if this one is taxed\./.test(h)&&!/chosen, not assumed/.test(h));
    app.run("window.maPartyPicked('pW')");
    s.eq('picking a party with a usual withholding moves it there',J([app.el('ma-f-taxkind').value,app.el('ma-f-taxrate').value]),J(['withholding',4]));
    s.ok('…and says so',/Washer’s usual withholding is 4% — confirm it, or change it\./.test(app.el('ma-f-taxfrom').textContent));
    app.run("window.maTaxKind('services')");
    app.run("window.maPartyPicked('pN')");
    s.eq('once the owner picks a treatment, a party picked after does not move it',app.el('ma-f-taxkind').value,'services');
    s.eq('…and the "where it came from" line is gone',app.el('ma-f-taxfrom').textContent,'');
    app.run('window.maCloseModal()');
    // An edit keeps the stored tax: a party never moves it.
    const {app:mb}=mkApp();
    const d=built(mb,'journal',{kind:'money_out',date:'2026-09-10',holder:'1020',account:'5020',party:'pS',partyKind:'vendor',amount:1500,tax:{kind:'none'},note:'x',attachments:[]},m(1),'JV-27-0001');
    const {app:e}=mkApp({seed:{ma_journal:{[d.no]:d},ma_parties:{pS:pv('pS','Stitcher',{regime:'sales'})}}});
    await e.run('maLoad()');
    e.run("window.maEditDoc('journal','JV-27-0001')");u=untouched(e);
    s.ok('an edit starts on the stored tax, with no party line',u['ma-f-taxkind'].value==='none'&&!/usual tax/.test(e.bodyHtml('ma-modal-back')));
  }

  /* ── 10. An owner's sign-out takes the books off the device ──────────── */
  s.section('an owner\'s sign-out takes the books off this device — or says why not (security F6)');
  {
    const run=async o=>{
      const calls=[];
      const {app}=mkApp({session:o.session,globals:Object.assign({
        waitForPendingWrites:o.wait||(async()=>{calls.push('wait');}),
        terminate:async()=>{calls.push('terminate');},
        clearIndexedDbPersistence:o.clear||(async()=>{calls.push('clear');}),
        alert:m=>{calls.push('alert: '+m);}
      },o.globals||{})});
      app.run('_maOffWait=30');
      const r=await app.run('window.maBooksOffDevice()');
      return {r,calls};
    };
    let x=await run({});
    s.eq('an owner online: queued writes first, then Firestore stops, then its copy is deleted',J(x.calls),J(['wait','terminate','clear']));
    s.eq('…and nothing is said',J(x.r),J({cleared:true}));
    x=await run({session:{uid:'u-must',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'},globals:{auth:{currentUser:{uid:'u-must',email:'mustafa@groovy.op'}}}});
    s.ok('anyone else\'s sign-out touches nothing',x.calls.length===0&&x.r.skipped==='not an owner');
    x=await run({session:{uid:'u-afnan',u:'',name:'',role:'owner'},globals:{auth:{currentUser:{uid:'u-afnan',email:'Afnan@groovy.op'}}}});
    s.ok('an owner known only by the signed-in account (the lock screen) is still an owner',J(x.calls)===J(['wait','terminate','clear']));
    x=await run({wait:()=>new Promise(()=>{})});
    s.ok('writes still queued (offline): the copy is kept — Firestore is not stopped',x.r.kept===true&&x.calls.indexOf('terminate')<0&&x.calls.indexOf('clear')<0);
    s.ok('…and it is said plainly',x.calls.some(c=>/^alert: You are signed out — but this device keeps its offline copy of the books\. Some changes have not reached the server yet/.test(c)&&/Sign in again when you are online, let them send, then sign out: that removes it\./.test(c)),J(x.calls));
    x=await run({clear:()=>{throw Object.assign(new Error('Persistence can only be cleared …'),{code:'failed-precondition'});}});
    s.ok('another tab holds it (failed-precondition): nothing is signed out',x.r.stay===true);
    s.ok('…and it says to close the other tabs and sign out again',x.calls.some(c=>/Close the other Groovy Ops tabs and sign out again — you are still signed in\./.test(c)),J(x.calls));
    x=await run({clear:()=>new Promise(()=>{})});
    s.ok('a delete that never finishes is the same answer',x.r.stay===true&&x.calls.some(c=>/Close the other Groovy Ops tabs/.test(c)));
    x=await run({clear:async()=>{throw Object.assign(new Error('IndexedDB is not available'),{code:'unavailable'});}});
    s.ok('any other failure: signed out, and told the copy stayed and what to do',x.r.failed===true&&x.calls.some(c=>/could not be taken off this device \(IndexedDB is not available\)\. Clear this site’s data/.test(c)));
    x=await run({globals:{terminate:undefined}});
    s.eq('a cached index.html without the bridge: signs out as before',x.r.skipped,'no bridge');
  }
  {
    // doLogout and lockUsePassword (js/auth.js) ask first, and honour "stay".
    const drive=async(which,res)=>{
      const seq=[];
      const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js','js/auth.js'],
        session:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},
        globals:{localStorage:memLS(),sessionStorage:Object.assign(memLS(),{clear(){}}),signOut:async()=>{seq.push('signOut');},
          location:{origin:'https://groovyoperations.netlify.app',pathname:'/',hash:'',reload(){seq.push('reload');}}}});
      app.run("session={uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'}");
      app.ctx.window.maBooksOffDevice=async()=>{seq.push('books');return res;};
      await app.run('window.'+which+'()');
      return seq;
    };
    s.eq('Sign out: the books come off first, then the sign-out',J(await drive('doLogout',{cleared:true})),J(['books','signOut','reload']));
    s.eq('…and while another tab holds them, nothing is signed out',J(await drive('doLogout',{stay:true})),J(['books','reload']));
    s.eq('"Use password instead" on the lock does the same',J(await drive('lockUsePassword',{cleared:true})),J(['books','signOut','reload']));
    s.eq('…and honours "stay" too',J(await drive('lockUsePassword',{stay:true})),J(['books','reload']));
  }

  return s;
};

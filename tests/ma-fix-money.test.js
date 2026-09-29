/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts — the money-figure and screen fixes after M1.6c's review
   and visual QA (29 Sept 2026).

   - V4 (QA F04): ONE rule for every cash total. The hero, the holders
     tables, the Dashboard card and the 30-day start all read maHolderCash:
     a handover waiting to go INTO the drawer is taken out of the drawer's
     Store Accounts figure, and every total says what it leaves out.
   - V6: a note-only edit that raises a flag the document did not carry
     clears the old review, so the new claim reaches the review queue.
   - V10: ₨99,95,000 and up is "₨1 cr", never "₨100 lac" — both sides of
     the boundary.
   - F03: a yearly commitment never looks back past the day the books
     begin; a due in another year says its year.
   - F19: a commitment whose amount varies is never ₨0 — on the calendar,
     the 30-day panel, the day rail and the Excel.
   - F05–F18 (polish): Needs attention's wording, the holder's waiting list
     in date order, labels not keys, "since" not "in Since", "off", the
     audit's document number, the void pill, the rail's "Postings" heading,
     phone tap targets, lakh grouping on rates, the day strip, one rule
     above a total, the error page in the shell.

   - F20–F24 (the second QA pass): the slide-over rail stretches under the
     top bar, Money out's dates do not break, the Parties filter is one row
     and the tabs wrap on a phone, a section's actions wrap as one group.
   - F25–F27 (Afnan's calls): "No opening balance yet" leads Needs attention
     until one is recorded; the picker folds the later kinds; the rail
     slides over the page up to 1440px.

   Every check here was made to fail once by undoing its fix. What only a
   browser can show — the sticky header and rail (F01/F02), the phone's
   selects (F13), tap-target heights (F14), the slide-over rail (F20), the
   dates, filters, tabs and section actions (F21–F24) — was MEASURED in real
   Chromium and screenshotted; the CSS checks below hold the rules that
   fixed them.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const M=require('../js/ma-core.js');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const clone=v=>JSON.parse(JSON.stringify(v));

function memLS(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];},_m:m};}
/* The screens suite's recording Firestore (tests/master-accounts-screens.test.js). */
function mkApp(o){
  o=o||{};
  const db=o.seed?clone(o.seed):{};
  const S={tx:[],batches:[],sets:[],reads:[]};
  const col=c=>(db[c]=db[c]||{});
  const snap=(c,id)=>{const d=col(c)[id];return {exists:()=>d!==undefined,data:()=>clone(d===undefined?{}:d)};};
  const globals=Object.assign({
    localStorage:memLS(),
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
      const ops=[];S.tx.push(ops);
      await fn({get:async ref=>snap(ref.col,ref.id),set:(ref,d)=>{ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},update:(ref,d)=>{ops.push({op:'update',col:ref.col,id:ref.id,data:clone(d)});}});
      ops.forEach(x=>{if(x.op==='set')col(x.col)[x.id]=clone(x.data);else col(x.col)[x.id]=Object.assign({},col(x.col)[x.id],clone(x.data));});
    },
    writeBatch:()=>{const ops=[];S.batches.push(ops);return{set(ref,d){ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},async commit(){ops.forEach(x=>{col(x.col)[x.id]=clone(x.data);});}};},
    setDoc:async(ref,d)=>{S.sets.push({col:ref.col,id:ref.id,data:clone(d)});},
    auth:{currentUser:{uid:'u-afnan',email:'afnan@groovy.op',metadata:{lastSignInTime:new Date().toUTCString()},getIdToken:async()=>'t_afnan'}},
    confirm:()=>true,prompt:()=>'because'
  },o.globals||{});
  const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:o.page||'ma-overview',
    session:o.session||{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},globals});
  return {app,S,db};
}
function built(app,dt,input,meta,no){
  const d=JSON.parse(app.run('JSON.stringify(maBuildDoc('+J(dt)+','+J(input)+','+J(meta)+',maChartIndex(maChart("groovy")),MA_DEFAULT_SETTINGS))'));
  d.no=no;d.id=no;return d;
}
/* What a browser holds in the open form's controls, untouched (the screens
   suite's `untouched`). */
function unesc(v){return String(v).replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function attr(a,name){const m=new RegExp('(?:^|\\s)'+name+'="([^"]*)"').exec(a);return m?unesc(m[1]):null;}
function untouched(app){
  Object.keys(app.nodes).forEach(k=>{if(/^ma-f-|^ma-l-/.test(k))delete app.nodes[k];});
  const html=app.bodyHtml('ma-modal-back');
  const out={};let m;
  const reS=/<select\b([^>]*)>([\s\S]*?)<\/select>/g;
  while((m=reS.exec(html))){const id=attr(m[1],'id');if(!id)continue;
    const opts=[];const reO=/<option\b([^>]*)>/g;let x;while((x=reO.exec(m[2])))opts.push({v:attr(x[1],'value'),sel:/\sselected\b/.test(x[1])});
    const pick=opts.find(y=>y.sel)||opts[0];out[id]={value:pick?pick.v:''};}
  const reI=/<input\b([^>]*)>/g;
  while((m=reI.exec(html))){const id=attr(m[1],'id');if(!id)continue;
    if(attr(m[1],'type')==='checkbox')out[id]={checked:/\schecked\b/.test(m[1])};else out[id]={value:attr(m[1],'value')||''};}
  const reT=/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g;
  while((m=reT.exec(html))){const id=attr(m[1],'id');if(!id)continue;out[id]={value:unesc(m[2])};}
  Object.keys(out).forEach(id=>{const e=app.el(id);if('checked' in out[id])e.checked=out[id].checked;else e.value=out[id].value;});
}
const dd=(h,label)=>(new RegExp('<dt>'+label+'</dt><dd>([\\s\\S]*?)</dd>').exec(h)||[])[1]||'';
const txt=h=>String(h).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const S0=M.maSettings(null);

module.exports=async function(){
  const s=suite('ma-fix-money');
  const T0=Date.UTC(2026,6,1,6);
  const m=(t,x)=>Object.assign({by:'afnan',byName:'Afnan',ts:T0+t},x||{});
  const store=cash=>({loadAccountsData:async()=>{},_acctBalances:()=>({cash}),_acctLoadErr:null});

  /* ── V4 — the core: one rule, two sets ─────────────────────────────── */
  s.section('V4 — every cash total reads one rule (maHolderCash)');
  {
    const rows=[
      {code:'1010',active:true,holderKind:'cash',mirror:'store',balance:70000,pendingIn:20000,pendingOut:0},
      {code:'1011',active:true,holderKind:'cash',balance:40000,pendingIn:0,pendingOut:0},
      {code:'1020',active:true,holderKind:'bank',balance:100000,pendingIn:0,pendingOut:20000},
      {code:'1040',active:true,holderKind:'till',balance:3000,pendingIn:0,pendingOut:0},
      {code:'1060',active:true,holderKind:'wallet',balance:5000,pendingIn:0,pendingOut:0},
      {code:'1030',active:false,holderKind:'bank',balance:900,pendingIn:0,pendingOut:0}
    ];
    const cih=M.maCashInHand(rows),sp=M.maSpendable(rows);
    s.eq('the hero takes a handover waiting to go INTO the drawer out of the drawer (70,000 − 20,000 + 40,000 + 1,00,000 + till 3,000)',cih.total,193000);
    s.eq('…and names what it left out',cih.waiting,20000);
    s.eq('the 30 days: the same rule over cash and bank',sp.total,190000);
    s.eq('…naming the same 20,000',sp.waiting,20000);
    s.eq('the two differ only by the holders the 30 days do not fund from (the till)',cih.total-sp.total,3000);
    s.eq('maHolderCash — the drawer',J(M.maHolderCash(rows[0])),J({amount:50000,waiting:20000}));
    s.eq('maHolderCash — a holder kept here is its balance (a pending posts nothing)',J(M.maHolderCash(rows[2])),J({amount:100000,waiting:0}));
    s.eq('maHolderCash — a holder not read is null',M.maHolderCash({code:'1010',mirror:'store',balance:null,pendingIn:20000}),null);
    const unread=M.maCashInHand([{code:'1010',active:true,holderKind:'cash',mirror:'store',balance:null,pendingIn:20000},rows[1]]);
    s.eq('a total over an unread drawer is incomplete, and names nothing waiting it could not read',J(unread),J({total:40000,complete:false,holders:1,waiting:0}));
    s.eq('the wallet and a switched-off holder are in neither total',J([cih.holders,M.maSpendable(rows).total]),J([4,190000]));
  }

  /* ── V4 — the pages ────────────────────────────────────────────────── */
  s.section('V4 — the hero, the holders tables, Money and the Dashboard card agree with the 30 days');
  {
    const {app:b}=mkApp();
    const op=built(b,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:100000},{account:'1011',side:'dr',amount:40000}]},m(1),'JV-27-0001');
    // MCB → drawer ₨20,000 waits; Raees has recorded it (his figure 70,000 = 50,000 + 20,000).
    const inD=built(b,'transfer',{date:'2026-09-20',from:'1020',to:'1010',amount:20000},m(2),'TR-27-0001');
    const {app}=mkApp({seed:{ma_journal:{[op.no]:op},ma_transfer:{[inD.no]:inD}},globals:store(70000)});
    await app.run('maLoad()');
    const h=app.run("_maPageHTML('ma-overview')");
    const hero=(/<div class="ma-stat hero">([\s\S]*?)<\/div><\/div>/.exec(h)||[])[1]||'';
    s.ok('the hero is ₨1,90,000 — never ₨2,10,000, the handover counted twice',/<div class="ma-stat-v">₨1,90,000<\/div>/.test(hero),txt(hero));
    s.ok('…the same figure the 30 days start from',/₨1,90,000/.test(dd(h,'Cash and bank today')),dd(h,'Cash and bank today'));
    s.ok('…and says, under it, what it leaves out',/₨20,000 waiting to go into the drawer/.test(hero),txt(hero));
    s.ok('…with why, true whether or not Raees has recorded it yet',/title="A handover into the drawer counts where it came from until it is confirmed/.test(hero));
    const tot=(/<tr class="ma-total">([\s\S]*?)<\/tr>/.exec(h)||[])[1]||'';
    s.ok('Today\'s holders table totals the hero\'s figure',/Cash in hand<\/td><td class="ma-num">₨1,90,000/.test(tot),txt(tot));
    s.ok('…with the waiting handover as its own line above it, so the rows add up',/<tr class="ma-less">[\s\S]*?Less: handed into the drawer, not confirmed yet[\s\S]*?−₨20,000/.test(h));
    s.ok('…a line that carries no phone labels (it is not a record)',/<tr class="ma-less"><td class="" data-l="">/.test(h));
    const money=app.run("_maPageHTML('ma-money')");
    s.ok('the Money page\'s total is the same',/Cash in hand<\/td><td class="ma-num">₨1,90,000/.test(money));
    app.el('ma-dash-body').innerHTML='';
    await app.run('_maPopulateDashboard()');
    const card=app.el('ma-dash-body').innerHTML;
    s.ok('the Dashboard card shows the same figure and what it leaves out',/₨1,90,000<\/span> cash in hand \(₨20,000 waiting to go into the drawer\)/.test(card),card);
    // Nothing waiting: nothing extra said anywhere.
    const {app:q}=mkApp({seed:{ma_journal:{[op.no]:op}},globals:store(50000)});
    await q.run('maLoad()');
    const qh=q.run("_maPageHTML('ma-overview')");
    s.ok('with nothing waiting, no "waiting" under the hero and no "less" line',!/waiting to go into the drawer/.test(qh)&&!/ma-less/.test(qh));
    q.el('ma-dash-body').innerHTML='';
    await q.run('_maPopulateDashboard()');
    s.ok('…nor on the card',!/waiting/.test(q.el('ma-dash-body').innerHTML),q.el('ma-dash-body').innerHTML);
  }

  /* ── V6 — a new flag clears the old review ─────────────────────────── */
  s.section('V6 — an edit that raises a flag the document did not carry clears the review');
  {
    const idx=M.maChartIndex(M.maChart('groovy'));
    const bd=(input,meta)=>M.maBuildDoc('journal',input,meta,idx,S0);
    const IN={kind:'money_out',date:'2026-09-10',holder:'1020',account:'4090',amount:1500,payee:'Refund to X',tax:{kind:'none'},note:'refund of a deposit',attachments:[]};
    const before=Object.assign(bd(IN,m(1)),{id:'JV-27-0002',no:'JV-27-0002',flags:[],reviewedAt:5,reviewedBy:'ammar'});
    const after=bd(Object.assign({},IN,{note:''}),m(1));
    const NEW=[{rule:'account.side',message:'Money out booked to an income account.',field:'account'}];
    // What is WRITTEN is maApplyEdit's result through the writer's
    // _maEditShape, which keeps every stored key the edit did not set — so a
    // review is kept by leaving it out and cleared only by an explicit null.
    // (JSON turns an absent field into null too, which is why the clear is
    // asserted with === and the written shape, never with J() alone.)
    const {app:sh}=mkApp();
    const shape=(b,x)=>JSON.parse(sh.run('JSON.stringify(_maEditShape('+J(b)+','+J(x)+'))'));
    const e=M.maApplyEdit(before,after,{at:9,by:'afnan',reason:'tidy',flags:NEW});
    s.ok('a note-only edit that raises a NEW flag clears the review — an explicit null, not a field left out',e.reviewedAt===null&&e.reviewedBy===null,J({at:e.reviewedAt===undefined?'absent':e.reviewedAt,by:e.reviewedBy===undefined?'absent':e.reviewedBy}));
    s.eq('…so the written document carries no review',J((w=>[w.reviewedAt,w.reviewedBy])(shape(before,e))),J([null,null]));
    s.eq('…stores the flag',J(e.flags.map(f=>f.rule)),J(['account.side']));
    s.eq('…and names only the note (the rules hold that — see the emulator run in the docs note)',J(e.edits[e.edits.length-1].fields),J(['note']));
    const had=Object.assign({},before,{flags:NEW.slice()});
    const same=M.maApplyEdit(had,Object.assign({},after,{note:'x'}),{at:9,by:'afnan',reason:'x',flags:NEW});
    s.ok('a flag the document already carried does not clear it (the core leaves the review alone)',!('reviewedAt' in same)&&!('reviewedBy' in same),J([same.reviewedAt,same.reviewedBy]));
    s.eq('…so the written document keeps Ammar\'s review',J((w=>[w.reviewedAt,w.reviewedBy])(shape(had,same))),J([5,'ammar']));
    const noFlags=M.maApplyEdit(before,after,{at:9,by:'afnan',reason:'x'});
    s.eq('an edit that stores no flags of its own keeps it (the rail\'s attach)',shape(before,noFlags).reviewedBy,'ammar');
    s.eq('maNewFlagRules — by rule, once each',J(M.maNewFlagRules([{rule:'a'}],[{rule:'a'},{rule:'b'},{rule:'b',message:'again'}])),J(['b']));
    // Driven through the page: the form, the flag acknowledged, the write.
    const {app:b}=mkApp();
    const op=built(b,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:1000000}]},m(1),'JV-27-0001');
    const d=built(b,'journal',IN,m(2),'JV-27-0002');
    d.flags=[];d.reviewedAt=5;d.reviewedBy='ammar';
    const {app,S}=mkApp({seed:{ma_journal:{[op.no]:op,[d.no]:d}}});
    await app.run('maLoad(true)');
    app.run("window.maEditDoc('journal','JV-27-0002')");untouched(app);
    app.el('ma-f-note').value='';app.el('ma-f-reason').value='tidy';
    await app.run('window.maSaveForm()');await app.run('window.maSaveForm()');
    const w=(S.tx[S.tx.length-1]||[]).find(x=>x.col==='ma_journal');
    s.ok('the page writes the edit',!!w,app.el('ma-f-issues').innerHTML);
    s.eq('…with the new flag and the review cleared',J(w&&[w.data.flags.map(f=>f.rule),w.data.reviewedAt,w.data.reviewedBy]),J([['account.side'],null,null]));
    s.eq('…so it waits in the review queue again',app.run('JSON.stringify(maReviewQueue(_maCtx().docs).map(x=>x.no))'),J(['JV-27-0002']));
  }

  /* ── V10 — lac and crore at the boundary ───────────────────────────── */
  s.section('V10 — ₨99,95,000 and up is "₨1 cr", never "₨100 lac"');
  {
    const cases=[[9999999,'₨1 cr'],[9995000,'₨1 cr'],[9994999,'₨99.9 lac'],[9950000,'₨99.5 lac'],[10000000,'₨1 cr'],[10500000,'₨1.1 cr'],
      [99999,'₨99,999'],[100000,'₨1 lac'],[150000,'₨1.5 lac'],[-9999999,'−₨1 cr'],[0,'₨0']];
    cases.forEach(([n,w])=>s.eq(String(n),M.maRsShort(n),w));
    let bad=null;
    for(let n=9900000;n<=10100000;n+=137){const r=M.maRsShort(n);if(/100 lac|100\.0 lac/.test(r)){bad=n+' → '+r;break;}}
    s.eq('no figure near a crore prints "100 lac"',bad,null);
  }

  /* ── F03 — the books' first day is a floor ─────────────────────────── */
  s.section('F03 — a yearly commitment never reports a due from before the books begin');
  {
    const ins={id:'c6',name:'Fire and theft insurance',kind:'fixed',cadence:'yearly',dueMonth:11,dueDay:15,amountExpected:85000,account:'6150',holder:'1020',active:true};
    const st=M.maCommitmentStatus(ins,[],'2026-10-08',S0);
    s.eq('opened in October with no `from`, it is upcoming — 15 Nov 2026',J([st.state,st.due]),J(['upcoming','2026-11-15']));
    const cal=M.maCalendar({today:'2026-10-08',days:30,commitments:[ins],docs:[],settings:S0,start:0});
    s.eq('…nothing late lands on today',cal.days[0].events.length,0);
    const na=M.maNeedsAttention({today:'2026-10-08',settings:S0,holders:[],commitments:[ins],docs:[],calendar:cal});
    s.ok('…and Needs attention says nothing about 2025',!na.some(x=>/2025/.test(x.sentence)),J(na.map(x=>x.sentence)));
    s.eq('a year on, it is overdue for the period the books did track',J((st2=>[st2.state,st2.period])(M.maCommitmentStatus(ins,[],'2026-12-01',S0))),J(['overdue','2026']));
    const rent={id:'c1',name:'Rent',kind:'fixed',cadence:'monthly',dueDay:5,amountExpected:150000,account:'6040',active:true};
    s.eq('a monthly one is unchanged: overdue on the 20th',M.maCommitmentStatus(rent,[],'2026-10-20',S0).state,'overdue');
    const {app}=mkApp();
    s.eq('a due in another year says its year',app.run('_maDayY({today:"2026-10-08"},"2027-01-05")'),'Tue 5 Jan 2027');
    s.eq('…this year\'s does not',app.run('_maDayY({today:"2026-10-08"},"2026-11-15")'),'Sun 15 Nov');
  }

  /* ── F19 — a varying amount is never a zero ───────────────────────── */
  s.section('F19 — a commitment whose amount varies is never "₨0"');
  {
    const diesel={id:'c8',name:'Generator diesel',kind:'running',cadence:'monthly',dueDay:10,amountExpected:0,account:'6060',holder:'1011',active:true};
    // Rent starts in October, so September's rent is not late on the 20th:
    // the only rent in the window is 25 Oct.
    const rent={id:'c1',name:'Rent',kind:'fixed',cadence:'monthly',dueDay:25,amountExpected:150000,account:'6040',active:true,from:'2026-10-01'};
    const cal=M.maCalendar({today:'2026-10-20',days:30,commitments:[diesel,rent],docs:[],settings:S0,start:500000});
    const late=cal.days[0].events.find(e=>e.commitment==='c8');
    s.eq('its late due lands on today, marked varies',J(late&&[late.late,late.varies,late.amount]),J([true,true,0]));
    s.eq('…adding nothing to what goes out',cal.days[0].out,0);
    const nov=cal.days.find(d=>d.day==='2026-11-10');
    s.eq('next month\'s due is on the calendar too — it used to vanish',J(nov&&nov.events.map(e=>[e.label,e.varies])),J([['Generator diesel',true]]));
    s.eq('the window counts the bills whose amount varies',cal.varies,2);
    s.eq('…and out is only the rent',cal.out,150000);
    const paid=Object.assign({},M.maBuildDoc('journal',{kind:'money_out',date:'2026-10-12',holder:'1011',account:'6060',amount:4000,payee:'Pump',tax:{kind:'none'}},m(1),M.maChartIndex(M.maChart('groovy')),S0),{commitmentId:'c8',commitmentPeriod:'2026-10'});
    const cal2=M.maCalendar({today:'2026-10-20',days:30,commitments:[diesel],docs:[paid],settings:S0,start:0});
    s.eq('paid for its period, it is done — no event',cal2.days[0].events.length+':'+cal2.varies,'0:1');
    const {app}=mkApp();
    const html=app.run('_maCalHTML('+J(cal)+')');
    s.ok('the day strip says "amount varies", never ₨0',/Generator diesel <span class="ma-ev-v">amount varies<\/span>/.test(html)&&!/Generator diesel ₨0/.test(html));
    // The 30-day panel, on the page.
    const {app:b}=mkApp();
    const op=built(b,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:300000}]},m(1),'JV-27-0001');
    const TODAY=JSON.parse(b.run('JSON.stringify(maDay())'));
    const d2=Object.assign({},diesel,{dueDay:+TODAY.slice(8,10)});
    const {app:p}=mkApp({seed:{ma_journal:{[op.no]:op},ma_commitments:{c8:d2}},globals:store(0)});
    await p.run('maLoad()');
    const h=p.run("_maPageHTML('ma-overview')");
    s.ok('"Due out" says a bill of unknown size falls due',/₨0 <span class="ma-muted">\+ \d bills? whose amount varies<\/span>/.test(dd(h,'Due out')),dd(h,'Due out'));
    s.ok('"Leaves" says it is before that bill',/before (that bill|those \d bills)/.test(dd(h,'Leaves')),dd(h,'Leaves'));
    const xl=p.run('JSON.stringify(maData.commitments.map(x=>x.amountExpected||"varies"))');
    s.eq('(the Excel reads the same expression)',xl,J(['varies']));
    s.ok('the Excel\'s Expected column is "varies", never 0',/x\.amountExpected\|\|'varies'/.test(read('js/master-accounts.js')));
  }

  /* ── F05 — Needs attention says it the way a person reads it ───────── */
  s.section('F05 — Needs attention: periods in words, tense, "you", Confirm only when you can');
  {
    const guard={id:'g',name:'Security guard',kind:'people',cadence:'weekly',dueWeekday:6,amountExpected:7000,account:'6020',active:true};
    const na=M.maNeedsAttention({today:'2026-10-08',settings:S0,holders:[],commitments:[guard],docs:[]});
    s.ok('a weekly period is a day, not "2026-10-03"',na.some(x=>x.sentence==='Security guard — nothing recorded for Sat 3 Oct; ₨7,000 was due Sat 3 Oct.'),J(na.map(x=>x.sentence)));
    const elec={id:'e',name:'Electricity — K-Electric',kind:'running',cadence:'monthly',dueDay:3,amountExpected:62000,account:'6030',active:true};
    const part=Object.assign({},M.maBuildDoc('journal',{kind:'money_out',date:'2026-10-07',holder:'1020',account:'6030',amount:30000,payee:'K-Electric',tax:{kind:'none'}},m(1),M.maChartIndex(M.maChart('groovy')),S0),{commitmentId:'e',commitmentPeriod:'2026-10'});
    // Every book in this section has its opening (OPEN): without one, "No
    // opening balance yet" leads the list (QA F25, asserted below).
    const OPEN=M.maBuildDoc('journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:1000000}]},m(0),M.maChartIndex(M.maChart('groovy')),S0);
    const late=M.maNeedsAttention({today:'2026-10-08',settings:S0,holders:[],commitments:[elec],docs:[OPEN,part]});
    s.eq('a part payment past its grace is a concern, in the past tense',J(late.map(x=>[x.state,x.sentence])),J([['concern','Electricity — K-Electric — ₨32,000 still to pay for Oct 2026; it was due Sat 3 Oct.']]));
    const within=M.maNeedsAttention({today:'2026-10-05',settings:S0,holders:[],commitments:[elec],docs:[OPEN,part]});
    s.eq('…within its grace a watch — "was due", not "is due"',J(within.map(x=>x.sentence)),J(['Electricity — K-Electric was due Sat 3 Oct — ₨32,000 still to pay.']));
    const today=M.maNeedsAttention({today:'2026-10-03',settings:S0,holders:[],commitments:[elec],docs:[OPEN]});
    s.eq('…and on the day, "is due today"',J(today.map(x=>x.sentence)),J(['Electricity — K-Electric is due today — ₨62,000.']));
    const tr=M.maBuildDoc('transfer',{date:'2026-10-01',from:'1011',to:'1012',amount:25000},m(2),M.maChartIndex(M.maChart('groovy')),S0);
    tr.id='TR-27-0004';tr.no='TR-27-0004';
    const as=who=>M.maNeedsAttention({today:'2026-10-08',settings:S0,holders:[],commitments:[],docs:[OPEN,tr],viewer:who,closes:[]})[0];
    s.eq('to Ammar, the one who confirms it: "by you", and Confirm',J([as('ammar').sentence,as('ammar').action.label]),J(['₨25,000 handed over on Thu 1 Oct is waiting to be confirmed by you.','Confirm']));
    s.eq('to Afnan, who cannot confirm it: "by Ammar", and Open',J([as('afnan').sentence,as('afnan').action.label]),J(['₨25,000 handed over on Thu 1 Oct is waiting to be confirmed by Ammar.','Open']));
    const lockedQ=M.maNeedsAttention({today:'2026-10-08',settings:S0,holders:[],commitments:[],docs:[OPEN,Object.assign({},tr,{date:'2026-09-20',quarter:'2027-Q1'})],viewer:'ammar',closes:[{quarter:'2027-Q1',locked:true}]})[0];
    s.eq('in a closed quarter even the confirmer gets Open — it cannot be confirmed',lockedQ.action.label,'Open');
    const {app}=mkApp();
    s.ok('the page hands Needs attention the viewer and the closes',/viewer:typeof session!=='undefined'&&session\?session\.u:null,closes:maData\.closes/.test(read('js/master-accounts.js')));
    s.eq('maPeriodLabel: a quarter',M.maPeriodLabel('2027-Q2',7,'2026-10-08'),'Q2 FY27 · Oct–Dec 2026');
    s.eq('maPeriodLabel: a day in another year carries it',M.maPeriodLabel('2025-11-15',7,'2026-10-08'),'Sat 15 Nov 2025');
    s.eq('maPeriodLabel: a year stays a year',M.maPeriodLabel('2026',7,'2026-10-08'),'2026');
    void app;
  }

  /* ── the screens: F06–F18 ──────────────────────────────────────────── */
  s.section('F06–F18 — the pages');
  {
    const {app:b}=mkApp();
    const op=built(b,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:500000},{account:'1011',side:'dr',amount:200000}]},m(1),'JV-27-0001');
    const t1=built(b,'transfer',{date:'2026-09-29',from:'1011',to:'1012',amount:1000},m(2),'TR-27-0001');
    const t2=built(b,'transfer',{date:'2026-10-07',from:'1011',to:'1012',amount:2000},m(3),'TR-27-0002');
    const t3=built(b,'transfer',{date:'2026-10-06',from:'1011',to:'1012',amount:3000},m(4),'TR-27-0003');
    const v=built(b,'journal',{kind:'money_out',date:'2026-09-14',holder:'1011',account:'6070',amount:1200,payee:'Tea',tax:{kind:'none'},labelKind:'one_off',commitmentPeriod:''},m(5),'JV-27-0002');
    const vd=Object.assign({},v,{status:'void',voidReason:'twice',voidedBy:'afnan',voidedAt:T0+9});
    const mi=built(b,'journal',{kind:'money_in',date:'2026-09-15',holder:'1020',account:'4010',amount:5000,payee:'Walk-in',tax:{kind:'none'},channel:'online_cod'},m(6),'JV-27-0003');
    const offC={id:'c9',name:'Old warehouse rent',kind:'one_off',cadence:'monthly',dueDay:1,amountExpected:9000,account:'6040',active:false};
    const party={id:'p1',code:'V-0001',name:'Iqbal Estates',kind:'vendor',active:true,vendor:{roles:[],terms:{mode:'cash'},rateCard:[{item:'Rent',unit:'month',rate:150000,validFrom:'2026-07-01',by:'afnan'},{item:'Fleece',unit:'kg',rate:1612.5,validFrom:'2026-09-15',by:'afnan'}]}};
    const {app,S}=mkApp({seed:{ma_journal:{[op.no]:op,[vd.no]:vd,[mi.no]:mi},ma_transfer:{[t1.no]:t1,[t2.no]:t2,[t3.no]:t3},ma_commitments:{c9:offC},ma_parties:{p1:party},
      ma_audit:{a1:{action:'post',target:{dt:'journal',id:'JV-27-0001',no:'JV-27-0001'},detail:'x',by:'afnan',at:T0}}},globals:store(0)});
    await app.run('maLoad()');
    // F06
    app.run("_maHolderCode='1011'");
    const hold=app.run("_maPageHTML('ma-holder')");
    const pendSec=hold.slice(hold.indexOf('Waiting to be confirmed'));
    const order=['TR-27-0001','TR-27-0003','TR-27-0002'].map(n=>pendSec.indexOf('>'+n+'<'));
    s.ok('F06 — a holder\'s waiting list is in date order (29 Sep, 6 Oct, 7 Oct)',order.every((x,i)=>x>0&&(!i||x>order[i-1])),J(order));
    // F14 — the waiting rows open the transfer
    s.ok('F14 — a waiting row opens its transfer (not only its 15px number)',/<tr class=" ma-rowlink" onclick="window\.maOpenDoc\('transfer','TR-27-0001'\)">/.test(pendSec));
    // F07 — the rail's fields in words
    app.run("window.maOpenDoc('journal','JV-27-0002')");
    const rail=app.run('_maRailHTML()');
    s.ok('F07 — the rail\'s Date is a date, not 2026-09-14',/<dt>Date<\/dt><dd>Mon 14 Sep 2026<\/dd>/.test(rail),dd(rail,'Date'));
    s.ok('F07 — its Kind is "one-off", not one_off',/<dt>Kind<\/dt><dd>one-off<\/dd>/.test(rail),dd(rail,'Kind'));
    s.ok('F12 — a void document\'s lines are "Would have posted", not "Postings"',/<h4>Would have posted<\/h4>/.test(rail)&&!/<h4>Postings<\/h4>/.test(rail));
    app.run("window.maOpenDoc('transfer','TR-27-0001')");
    s.ok('F12 — a waiting transfer\'s are "Posts once confirmed"',/<h4>Posts once confirmed<\/h4>/.test(app.run('_maRailHTML()')));
    app.run("window.maOpenDoc('journal','JV-27-0003')");
    s.ok('F07 — a Money in\'s Channel is "online cod"',/<dt>Channel<\/dt><dd>online cod<\/dd>/.test(app.run('_maRailHTML()')));
    s.eq('F07 — a period in the rail is in words',app.run('_maFieldVal(_maCtx(),{commitmentPeriod:"2026-10"},"commitmentPeriod")'),'Oct 2026');
    // F07 — the Ledger's labels
    app.run("_maPeriod='all';_maLedgerTab='postings'");
    const led=app.run("_maPageHTML('ma-ledger')");
    s.ok('F07 — the Ledger\'s labels read "online cod", never online_cod',/online cod/.test(led)&&!/online_cod/.test(led));
    // F08 — "since", not "in Since"
    app.run("_maPartyId='p1'");
    const pty=app.run("_maPageHTML('ma-party')");
    s.ok('F08 — an empty state on All reads "since …", never "in Since …"',/Nothing with Iqbal Estates since Wed 1 Jul 2026\./.test(pty)&&!/in Since/.test(pty));
    app.run("_maPeriod='month'");
    s.ok('F08 — …and a month still reads "in"',/No postings in [A-Z][a-z]+ 20\d\d\./.test(app.run("_maPageHTML('ma-party')")));
    // F15 — lakh grouping on the rate card
    s.ok('F15 — the rate card groups a rate the lakh way: ₨1,50,000',/₨1,50,000/.test(pty)&&!/₨150,000/.test(pty));
    s.ok('F15 — …and keeps a fraction: ₨1,612.5',/₨1,612\.5/.test(pty));
    s.eq('F15 — maRsRate',J([150000,1612.5,0.05,-12.5,''].map(M.maRsRate)),J(['₨1,50,000','₨1,612.5','₨0.05','−₨12.5','']));
    // F09 — a switched-off commitment
    const out=app.run("_maPageHTML('ma-out')");
    s.ok('F09 — a switched-off commitment says "off", not "no calendar day"',/Old warehouse rent[\s\S]*?<span class="ma-word mute">off<\/span>/.test(out)&&!/no calendar day/.test(out));
    s.ok('F07 — its kind is "one-off" in the table',/Old warehouse rent[\s\S]*?<td class="" data-l="Kind">one-off<\/td>/.test(out));
    app.run("window.maOpenCommitment('c9')");
    const cr=app.run('_maRailHTML()');
    s.ok('F07/F09 — the commitment rail: Kind in words, and "off"',/<dt>Kind<\/dt><dd>one-off<\/dd>/.test(cr)&&/<span class="ma-word mute">off<\/span>/.test(cr));
    // F10 — the audit's document number never breaks
    app.run("_maCloseTab='audit'");
    s.ok('F10 — the audit trail\'s Document column is nowrap',/<td class="ma-nw" data-l="Document">JV-27-0001<\/td>/.test(app.run("_maPageHTML('ma-close')")));
    // F07 — the review's audit detail in words
    s.ok('F07 — a review is audited by the flags\' words, not rule ids',/maLiveFlags\(d\)\.map\(x=>x\.message\|\|x\.rule\)\.join\('; '\)/.test(read('js/master-accounts.js')));
    // F18 — the error page is in the shell
    const {app:e}=mkApp({fail:['ma_journal']});
    await e.run('maLoad()');
    const eh=e.run("_maPageHTML('ma-overview')");
    s.ok('F18 — the error page sits in the same shell as every page',/^<div class="ma-shell"><div class="ma-page">/.test(eh)&&/Could not read ma_journal/.test(eh),eh.slice(0,60));
    s.ok('F18 — …and so does the loading skeleton',/^<div class="ma-shell"><div class="ma-page">/.test(e.run('_maSkeleton()')));
    void S;
  }

  /* ── F16 — the day strip ───────────────────────────────────────────── */
  s.section('F16 — the Day by day strip: every event reachable, no grey slab');
  {
    const cs=[1,2,3,4,5].map(i=>({id:'k'+i,name:'Bill '+i,kind:'fixed',cadence:'monthly',dueDay:25,amountExpected:1000*i,account:'6040',active:true}));
    const cal=M.maCalendar({today:'2026-10-20',days:30,commitments:cs,docs:[],settings:S0,start:100000});
    const {app}=mkApp();
    const html=app.run('_maCalHTML('+J(cal)+')');
    const day=(/<div class="ma-cd has">(<b>Sun 25<\/b>[\s\S]*?)<\/div>/.exec(html)||[])[1]||'';
    s.eq('every event is in the cell — two shown, three kept for the phone and the rail',(day.match(/class="ma-ev[^"]*"/g)||[]).filter(x=>!/mute/.test(x)).length,5);
    s.eq('…the three past two are marked',(day.match(/ma-ev-x/g)||[]).length,3);
    s.ok('"+3 more" is a button that opens the day in the rail',/<button class="ma-ev mute ma-ev-more" onclick="window\.maOpenDay\('2026-10-25'\)">\+3 more<\/button>/.test(day),day);
    const cells=(html.match(/<div class="ma-cd[ "]/g)||[]).length;
    s.eq('the grid is whole weeks — the last one padded with blank days',cells%7,0);
    s.ok('…blank ones',/<div class="ma-cd blank" aria-hidden="true"><\/div><\/div>$/.test(html));
    // The day rail
    const {app:p}=mkApp({seed:{ma_commitments:Object.fromEntries(cs.map(c=>[c.id,c]))},globals:store(0)});
    await p.run('maLoad()');
    const TODAY=JSON.parse(p.run('JSON.stringify(maDay())'));
    const due=M.maCommitmentDueDays(cs[0],M.maDayAdd(TODAY,1),M.maDayAdd(TODAY,29))[0];
    p.run('window.maOpenDay('+J(due)+')');
    const r=p.run('_maRailHTML()');
    s.ok('the day rail lists all five',(r.match(/window\.maOpenCommitment\('k\d'\)/g)||[]).length===5,txt(r).slice(0,200));
    s.ok('…with what goes out that day',/<dt>Due out<\/dt><dd>₨15,000<\/dd>/.test(r),dd(r,'Due out'));
    p.run("window.maOpenCommitment('k3')");
    s.ok('…and a row opens its commitment',/Bill 3/.test(p.run('_maRailHTML()')));
    p.run('window.maOpenDay("1999-01-01")');
    s.eq('a day off the calendar opens nothing',p.run('_maRailHTML()'),'');
  }

  /* ── the CSS the browser measurements rest on ──────────────────────── */
  s.section('the CSS behind F01/F02, F11, F13, F14, F16, F17');
  {
    const css=read('css/main.css');
    const phone=(()=>{const i=css.indexOf('/* the phone: the same order, stacked */');return i<0?'':css.slice(i,css.indexOf('\n}\n',i));})();
    s.ok('F01/F02 — #main-content stops being a scroll container on a Master Accounts page (clip, not auto)',/@media \(min-width:601px\)\{#main-content:has\(>\.ma-shell\)\{overflow-x:clip;overflow-y:visible;min-width:0\}\}/.test(css));
    // The 52px is the APP's top bar, so it is set under #scr-app, the shell
    // that carries the bar. Unscoped, a page drawn without the bar (the
    // layout probe's fragments) had its header pushed 52px down over its
    // own tabs — smoke-layout named Postings / Documents / Review as covered.
    s.ok('F02 — the header sticks (at 0 where there is no top bar)',/\n\.ma-head\{position:sticky;top:0;/.test(css));
    s.ok('F02 — …and below the 52px top bar in the app',/@media \(min-width:601px\)\{#scr-app #main-content:has\(>\.ma-shell\) \.ma-head\{top:52px\}\}/.test(css));
    s.ok('F01 — and so does the rail (a grid column only above 1440px since F27)',/\n\.ma-rail\{position:sticky;top:0;/.test(css)&&/@media \(min-width:1441px\)\{#scr-app #main-content:has\(>\.ma-shell\) \.ma-rail\{top:52px\}\}/.test(css));
    s.ok('F01 — the rail\'s 52px is the wide grid\'s only: an id rule must not out-rank the slide-over or the phone sheet',!/\n#scr-app[^{\n]*\.ma-rail\{/.test(css));
    // A browser without :has() drops the rule that stops #main-content
    // scrolling. An offset left without it pushed the header 70px down over
    // the tabs: head 122–181 over tabs 135–171 at 1280×800, measured by
    // deleting the :has() rules in Chromium. So every 52px offset carries
    // the same :has(), and the two are dropped together.
    const offs=css.match(/[^{}\n]*\.ma-(?:head|rail)\{top:52px\}/g)||[];
    s.ok('F01/F02 — the 52px offsets exist only with :has(>.ma-shell): a browser without it drops them with the scroll change, never leaving a header pushed down over the page',
      offs.length===2&&offs.every(x=>/#scr-app #main-content:has\(>\.ma-shell\) \.ma-(?:head|rail)\{top:52px\}$/.test(x)),offs.join(' | '));
    s.ok('F01 — the shell reaches the page\'s foot, so the rail never rides up under the top bar',/\.ma-shell\{[^}]*margin:-18px -16px -18px\}/.test(css));
    s.ok('F11 — the void pill is not struck through',/\.ma-pill\{[^}]*\}/.test(css)&&!/\.ma-pill\{[^}]*line-through/.test(css));
    s.ok('F11 — a void row\'s amount is',/\.ma-table tr\.ma-void td\.ma-num\{text-decoration:line-through\}|tr\.ma-void td\.ma-num\{text-decoration:line-through\}|,\.ma-table tr\.ma-void td\.ma-num\{text-decoration:line-through\}/.test(css));
    s.ok('F13 — on a phone the filter row\'s rule is scoped to the filter row',/\.ma-filters \.ma-sel\{max-width:none;flex:1 1 45%\}/.test(phone)&&!/\n\s*\.ma-sel\{max-width:none;flex:1 1 45%\}/.test(phone));
    s.ok('F13 — a select in a form field is the field\'s width',/\.ma-field \.ma-sel\{max-width:none;width:100%\}/.test(phone));
    s.ok('F14 — selects and search are 36px on a phone',/\.ma-sel,\.ma-search\{height:36px\}/.test(phone));
    s.ok('F14 — period, back, links, checkboxes and the ⋯ menu\'s rows are at least 34px',/\.ma-period button,\.ma-back,\.ma-link,\.ma-chk,\.ma-menu button\{min-height:34px\}/.test(phone));
    s.ok('F14 — a "Paid by" document number in the commitment rail is 34px (no row opens it)',/\.ma-hist \.ma-doclink\{min-height:34px\}/.test(phone));
    s.ok('F14 — the concern actions 34px, the chips 34px',/\.ma-concerns \.ma-act\{[^}]*min-height:34px/.test(phone)&&/\.ma-chip\{height:34px\}/.test(phone));
    s.ok('F17 — one rule above a total on a phone',/table\.ma-cards tr\.ma-total td\{border-top:0\}/.test(phone));
    s.ok('F16 — past two events a desktop day hides them (the rail has them)…',/\n\.ma-ev-x\{display:none\}/.test(css));
    s.ok('F16 — …the phone shows them all, and no "more"',/\.ma-ev-x\{display:block\}/.test(phone)&&/\.ma-ev\.ma-ev-more\{display:none\}/.test(phone));
  }

  /* ── the second QA pass: F20–F24 ───────────────────────────────────── */
  s.section('F20–F24 — the slide-over rail, dates that do not break, one-row filters, tabs, section actions');
  {
    const css=read('css/main.css');
    const phone=(()=>{const i=css.indexOf('/* the phone: the same order, stacked */');return i<0?'':css.slice(i,css.indexOf('\n}\n',i));})();
    const slide=(/@media \(max-width:1440px\)\{\s*\.ma-shell\.rail-open\{[^}]*\}\s*\.ma-rail\{([^}]*)\}/.exec(css)||[])[1]||'';
    // F20 was MEASURED in real Chromium (1024×768, 1180×720, both themes):
    // JV-27-0013's rail at 0–883 in a 768px screen, over the top bar, its
    // Edit / Void / Voucher (PDF) / Share voucher unreachable; fixed, 52–768
    // and scrolling. This holds the rule that did it — at the slide-over's
    // breakpoint, which F27 moved from 1200 to 1440.
    s.ok('F20 — up to 1440px the rail STRETCHES between the top bar and the foot (a fixed box obeys align-self)',/align-self:stretch/.test(slide)&&/top:52px/.test(slide)&&/bottom:0/.test(slide),slide);
    s.ok('F20 — …and the fix stays in the slide-over: the wide grid\'s rail rule is unchanged',/\n\.ma-rail\{position:sticky;top:0;align-self:start;/.test(css));
    s.ok('F22 — on a phone the Parties kind filter is one row the full width',/\.ma-filters \.ma-period\{width:100%;flex-wrap:nowrap;overflow-x:auto\}/.test(phone));
    s.ok('F23 — on a phone tabs wrap rather than run off the screen',/\.ma-tabs\{flex-wrap:wrap\}/.test(phone));
    // F21 and F24 in the markup the pages render.
    const {app:b}=mkApp();
    const op=built(b,'journal',{kind:'opening',date:'2026-07-01',lines:[{account:'1011',side:'dr',amount:100000}]},m(1),'JV-27-0001');
    const rent={id:'c1',name:'Rent',kind:'fixed',cadence:'monthly',dueDay:5,amountExpected:150000,account:'6040',active:true};
    const {app}=mkApp({seed:{ma_journal:{[op.no]:op},ma_commitments:{c1:rent}},globals:store(0)});
    await app.run('maLoad()');
    const out=app.run("_maPageHTML('ma-out')");
    const cell=(/<td class="" data-l="State">([\s\S]*?)<\/td>/.exec(out)||[])[1]||'';
    s.ok('F21 — Money out\'s due date never breaks across two lines',/<span class="ma-muted ma-nw">[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}( \d{4})?<\/span>/.test(cell),cell);
    app.run("_maHolderCode='1011'");
    const hold=app.run("_maPageHTML('ma-holder')");
    const head=(/<h2 class="ma-sec-title">Statement<\/h2>[\s\S]*?<\/div>/.exec(hold)||[''])[0];
    s.ok('F24 — a section\'s actions are ONE group that wraps as a unit (Transfer and Count together)',/<span class="ma-sec-acts ma-nw"><button class="ma-link"[^>]*>Transfer<\/button> <button class="ma-link"[^>]*>Count<\/button><\/span>/.test(head),head);
    s.ok('F24 — …and a section with no actions carries no empty group',!/<span class="ma-sec-acts ma-nw"><\/span>/.test(hold));
  }

  /* ── F25, F26 and F27, Afnan's calls on the judgement findings ────── */
  // "keep opening balance alert, fold the tiles, slide-over up to 1440".
  // There was no opening-balance alert to keep — the QA had SUGGESTED one —
  // so F25 builds it.
  s.section('F25 — while the book has no opening balance, Needs attention leads with it');
  {
    const idx=M.maChartIndex(M.maChart('groovy'));
    const bd=(input,t,no)=>Object.assign(M.maBuildDoc('journal',input,m(t),idx,S0),{id:no,no});
    const OP=bd({kind:'opening',date:'2026-07-01',lines:[{account:'1020',side:'dr',amount:500000}]},1,'JV-27-0001');
    const OP2=bd({kind:'opening',date:'2026-07-02',lines:[{account:'1011',side:'dr',amount:20000}]},2,'JV-27-0005');
    const VOID=M.maApplyVoid(OP,{reason:'wrong figures',by:'afnan',at:5});
    const MI=bd({kind:'money_in',date:'2026-10-02',holder:'1020',account:'4010',amount:9000,payee:'Walk-in',tax:{kind:'none'}},3,'JV-27-0002');
    const TR=Object.assign(M.maBuildDoc('transfer',{date:'2026-10-02',from:'1020',to:'1011',amount:1000},m(4),idx,S0),{id:'TR-27-0001',no:'TR-27-0001'});
    const na=(docs,x)=>M.maNeedsAttention(Object.assign({today:'2026-10-08',settings:S0,holders:[],commitments:[],docs},x||{}));
    const isIt=l=>/^No opening balance yet/.test(l.sentence);
    const e0=na([])[0]||{};
    s.eq('an empty book: it is the FIRST line',e0.sentence,'No opening balance yet — the books start when one is recorded.');
    s.eq('…a concern (the red dot), not a watch',e0.state,'concern');
    s.eq('…with one action: Record it, straight to the Opening balance form',J(e0.action),J({label:'Record it',go:'record',kind:'opening'}));
    s.ok('…and a basis that says why every figure is off',/counts from ₨0/.test(e0.basis||''),e0.basis);
    s.eq('one opening: the line is gone',na([OP]).filter(isIt).length,0);
    s.eq('the only opening voided: the line is back',na([VOID]).filter(isIt).length,1);
    s.eq('a void opening beside a live one: the live one counts',na([VOID,OP2]).filter(isIt).length,0);
    s.eq('an opening dated before go-live (historical) is still where the books start',J([OP.historical,na([OP]).filter(isIt).length]),J([true,0]));
    s.eq('a book of other documents but no opening still says it — it is the opening that counts, not how many documents there are',na([MI,TR]).filter(isIt).length,1);
    s.eq('no documents handed over at all: not known, and nothing is said',M.maNeedsAttention({today:'2026-10-08',settings:S0}).filter(isIt).length,0);
    const deep=[{code:'1011',name:'Cash — with Afnan',active:true,holderKind:'cash',balance:-99999999999,floor:0}];
    const heavy=na([],{holders:deep,backup:{state:'not_configured',missing:['MA_BACKUP_BUCKET'],at:1},nowMs:2});
    s.eq('it leads the heaviest concerns there are — a holder ₨9,99,99,99,999 short, backups not set up',J(heavy.slice(0,3).map(l=>l.state+':'+(isIt(l)?'opening':/is at/.test(l.sentence)?'holder':/Backups are not set up/.test(l.sentence)?'backups':l.sentence))),J(['concern:opening','concern:holder','concern:backups']));
    s.ok('…and every watch comes after it',heavy.slice(3).every(l=>l.state==='watch'),J(heavy.slice(3).map(l=>l.state)));
    s.eq('maIsOpening — the one rule, and only a live opening journal',J([OP,VOID,MI,TR,null,Object.assign({},OP,{dt:'transfer'})].map(d=>M.maIsOpening(d))),J([true,false,false,false,false,false]));
    // The page: Today, the Dashboard card, the button, recording, voiding.
    const {app}=mkApp({globals:store(0)});
    await app.run('maLoad()');
    const h=app.run("_maPageHTML('ma-overview')");
    const first=(/<ul class="ma-concerns"><li>([\s\S]*?)<\/li>/.exec(h)||[])[1]||'';
    s.ok('Today on an empty book: Needs attention opens on it, with the red dot',/^<span class="ma-dot urgent"><\/span><span class="ma-line"[^>]*>No opening balance yet — the books start when one is recorded\.<\/span>/.test(first),first);
    s.ok('…and its button reads Record it and calls this line',/<button class="ma-act" onclick="window\.maConcern\(0\)">Record it<\/button>$/.test(first),first);
    const n0=app.run('_maAttention(_maCtx()).length');
    const card=async()=>{app.el('ma-dash-body').innerHTML='';await app.run('_maPopulateDashboard()');return app.el('ma-dash-body').innerHTML;};
    const c0=await card();
    s.ok('the Dashboard card counts it: the same list, not a second one',new RegExp('<b>'+n0+'</b> need'+(n0===1?'s':'')+' attention').test(c0)&&n0>=1,c0);
    app.run('window.maConcern(0)');
    s.eq('Record it opens the Opening balance form directly — no picker in between',app.run('_maF&&_maF.kind'),'opening');
    s.ok('…the form titled Opening balance',/<h2[^>]*>Opening balance<\/h2>/.test(app.bodyHtml('ma-modal-back')));
    untouched(app);
    app.run("window.maLineSet(0,'account','1020');window.maLineSet(0,'amount','500000')");
    await app.run('window.maSaveForm()');
    if(app.run('!!_maF'))await app.run('window.maSaveForm()');   // "Record anyway" answers a flag, if one was raised
    const no=app.run('(maData.journal.find(d=>d.kind==="opening")||{}).no||""');
    s.ok('the opening is recorded',!!no,app.bodyHtml('ma-modal-back').slice(0,300));
    const h1=app.run("_maPageHTML('ma-overview')");
    s.ok('…and the line is gone from Today at once',!/No opening balance yet/.test(h1));
    const c1=await card();
    s.ok('…and from the Dashboard card\'s count (one fewer)',n0-1===0?/nothing to worry about/.test(c1):new RegExp('<b>'+(n0-1)+'</b> need'+(n0-1===1?'s':'')+' attention').test(c1),c1);
    await app.run("window.maVoidDoc('journal','"+no+"')");
    s.eq('voided, it is void',app.run('(maData.journal.find(d=>d.no==="'+no+'")||{}).status'),'void');
    s.ok('…and the line is back, first',/<ul class="ma-concerns"><li><span class="ma-dot urgent"><\/span><span class="ma-line"[^>]*>No opening balance yet/.test(app.run("_maPageHTML('ma-overview')")));
    // A journal that could not be read is not an empty journal: the page
    // paints the error card, and never claims there is no opening.
    const {app:f}=mkApp({seed:{ma_journal:{[OP.no]:OP}},fail:['ma_journal'],globals:store(0)});
    await f.run('maLoad()');
    const fh=f.run("_maPageHTML('ma-overview')");
    s.ok('a refused journal read: the error card, and no "No opening balance yet"',/Could not read/.test(fh)&&!/No opening balance yet/.test(fh),txt(fh).slice(0,200));
    f.el('ma-dash-body').innerHTML='';await f.run('_maPopulateDashboard()');
    s.ok('…nor a count on the Dashboard card',/Could not read ma_journal/.test(f.el('ma-dash-body').textContent||f.el('ma-dash-body').innerHTML)&&!/attention/.test(f.el('ma-dash-body').innerHTML),f.el('ma-dash-body').textContent||f.el('ma-dash-body').innerHTML);
  }

  s.section('F26 — the picker folds the later kinds behind one button');
  {
    const ls=memLS();
    const {app,S}=mkApp({globals:Object.assign(store(0),{localStorage:ls})});
    await app.run('maLoad()');
    app.run('window.maRecord()');
    const pick=app.bodyHtml('ma-modal-back');
    const LIVE=['Money out','Money in','Transfer','Count','Owner put money in','Owner took money out','Opening balance','Journal','Commitment','Collection','Courier statement'];
    const SOON=[['Bill','M3'],['Payment','M3'],['Purchase order','M3'],['Receipt','M3'],['Payout','M4'],['Loan','M4'],['Savings entry','M4']];
    const liveGrid=(/<div class="ma-tiles">([\s\S]*?)<\/div>\s*<button type="button" class="ma-fold"/.exec(pick)||[])[1]||'';
    const liveNames=(liveGrid.match(/<button class="ma-tile" onclick="window\.maRecordKind\('[a-z_]+'\)"><b>[^<]*<\/b>/g)||[]).map(x=>/<b>([^<]*)<\/b>/.exec(x)[1]);
    s.eq('the eleven live kinds — the nine there were, then Collection and Courier statement (M2) — eleven buttons, in order, first on the picker',J(liveNames),J(LIVE));
    s.ok('…and none of the later kinds sits among them',!/ma-tile off/.test(liveGrid),liveGrid.slice(0,120));
    const fold=(/<button type="button" class="ma-fold"[^>]*>[^<]*<\/button>/.exec(pick)||[''])[0];
    s.ok('the fold is a real button (type="button")',/^<button type="button" class="ma-fold" id="ma-soon-fold"/.test(fold),fold);
    s.ok('…folded by default: aria-expanded="false"',/ aria-expanded="false"/.test(fold),fold);
    s.ok('…and it names the list it opens (aria-controls)',/ aria-controls="ma-soon"/.test(fold)&&/<div class="ma-tiles ma-soon" id="ma-soon"/.test(pick),fold);
    s.ok('…and says how many kinds wait behind it',/>Coming later · 7<\/button>$/.test(fold),fold);
    s.ok('the list is hidden while folded',/<div class="ma-tiles ma-soon" id="ma-soon" hidden>/.test(pick));
    // Everything from the list on: the seven tiles, then only closing tags.
    const soonPart=pick.slice(Math.max(0,pick.indexOf('<div class="ma-tiles ma-soon"')));
    const soonTiles=(soonPart.match(/<div class="ma-tile off" aria-disabled="true"><b>[^<]*<\/b><span>arrives with M\d<\/span><\/div>/g)||[]).map(x=>{const r=/<b>([^<]*)<\/b><span>arrives with (M\d)<\/span>/.exec(x);return [r[1],r[2]];});
    s.eq('behind it, the seven later kinds, each still named with its milestone, in order',J(soonTiles),J(SOON));
    s.ok('…and still not clickable: no button and no handler among them',pick.indexOf('<div class="ma-tiles ma-soon"')>0&&!/<button|onclick/.test(soonPart),soonPart.slice(0,160));
    s.ok('the old "Coming" label is gone (the button is the heading now)',!/ma-tiles-h/.test(pick));
    // The count is DERIVED from the tiles: an eighth later kind says 8.
    app.run("_MA_TILES.push({k:'x_test',t:'Test kind',coming:'M9'})");
    s.ok('the count is derived from the list, not written into the label',/>Coming later · 8<\/button>/.test(app.run('_maPickerHTML()')));
    app.run('_MA_TILES.pop()');
    // Toggling flips the two elements the picker drew, IN PLACE: a browser
    // keeps focus on the button. The harness's elements stand in for them,
    // carrying what the markup gave them.
    const lsBefore=J(ls._m),writes=J([S.tx.length,S.batches.length,S.sets.length]),bodies=app.bodyCount('ma-modal-back'),html0=app.bodyHtml('ma-modal-back');
    app.el('ma-soon-fold').setAttribute('aria-expanded','false');app.el('ma-soon').setAttribute('hidden','');
    app.run('window.maToggleSoon()');
    s.eq('a click opens it: aria-expanded="true"',app.el('ma-soon-fold').getAttribute('aria-expanded'),'true');
    s.eq('…and the list is shown (hidden removed)',app.el('ma-soon').getAttribute('hidden'),null);
    s.ok('…and a re-render would draw it open too',/aria-expanded="true"/.test(app.run('_maPickerHTML()'))&&!/id="ma-soon" hidden/.test(app.run('_maPickerHTML()')));
    s.ok('…in place: the modal is not rebuilt (the button keeps focus)',app.bodyCount('ma-modal-back')===bodies&&app.bodyHtml('ma-modal-back')===html0);
    app.run('window.maToggleSoon()');
    s.ok('a second click folds it again',app.el('ma-soon-fold').getAttribute('aria-expanded')==='false'&&app.el('ma-soon').getAttribute('hidden')==='');
    app.run('window.maToggleSoon()');
    app.run('window.maCloseModal();window.maRecord()');
    s.ok('opened again, the picker is folded again (nothing is remembered)',/aria-expanded="false"/.test(app.bodyHtml('ma-modal-back'))&&/id="ma-soon" hidden>/.test(app.bodyHtml('ma-modal-back')));
    s.eq('the fold is written nowhere: not the device…',J(ls._m),lsBefore);
    s.eq('…and not Firestore',J([S.tx.length,S.batches.length,S.sets.length]),writes);
    const css=read('css/main.css');
    const foldCss=(/\n\.ma-fold\{([^}]*)\}/.exec(css)||[])[1]||'';
    s.ok('CSS — the folded list hides itself (.ma-tiles is display:grid, which beats the browser\'s own [hidden])',/\n\.ma-soon\[hidden\]\{display:none\}/.test(css));
    s.ok('CSS — the fold is at least 34px tall at every width (a base rule, not a desktop one)',/min-height:36px/.test(foldCss),foldCss);
    s.ok('CSS — the fold line itself is unbordered: it adds no box to the modal',/border:0/.test(foldCss)&&!/border:1px/.test(foldCss),foldCss);
    s.ok('CSS — tokens only: no literal colour on the fold',!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test((css.match(/\n\.ma-fold[^{]*\{[^}]*\}/g)||[]).join('')));
  }

  s.section('F27 — the rail slides over the page up to 1440px, and sits beside it only above');
  {
    const css=read('css/main.css');
    const over=(/@media \(max-width:(\d+)px\)\{\s*\.ma-shell\.rail-open\{grid-template-columns:minmax\(0,1fr\)\}\s*\.ma-rail\{position:fixed;/.exec(css)||[])[1];
    const beside=(/@media \(min-width:(\d+)px\)\{#scr-app #main-content:has\(>\.ma-shell\) \.ma-rail\{top:52px\}\}/.exec(css)||[])[1];
    s.eq('the slide-over reaches 1440px',over,'1440');
    s.eq('the grid column (and its sticky offset) starts at 1441px',beside,'1441');
    s.ok('the two meet exactly: no width is both, none is neither',Number(over)+1===Number(beside),over+' / '+beside);
    s.ok('no other width still switches the rail (the old 1200/1201 are gone)',!/@media \((?:max|min)-width:120[01]px\)\{[^@]*\.ma-rail/.test(css));
  }

  return s;
};

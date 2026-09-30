/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts M2 — the review fixes (30 Sept 2026)

   The money / security review of M2 and the screens review found these;
   each section below fails on the code before its fix (7e41206) and passes
   after it, and each fix was undone once to watch a named assertion here
   fail (the list is in the commit message).

   B1  a new opening line on 1120 / 1121 is REFUSED; a stored one is a
       Needs attention concern naming the journal.
   S1  a parcel's figures are whole rupees, rounded ONCE — the day, the
       receipts and transit add the same rupees, and the 1120 check clears.
   S2  CLAIMS: one live collection per CPR, held inside the transaction that
       records a collection (and at the rules — tests/rules-emulator-ma.js);
       a void releases them in the same write.
   S4  a receipt that crosses the books' start after it was collected is
       "changed after collection", and the rollup never moves a collected
       one across — it skips it and says so.
   S5  a negative receipt is listed, tickable, and counted in what is
       expected.
   S7  one dispute open at a time; the opener kept; `disputes` appended one
       row per change; Open / Resolve on the rail.
   N1  a collection difference inside the tolerance is no Needs attention
       line; past it, the line ends once the collection is reviewed.
   N2  a NEW flag from the rollup clears an earlier review.
   N3  Money in says what PostEx owes in the books and, apart from it, what
       is on receipts from before the books.
   The screens review's write-path items: a double press records once, an
   unreadable ma_collection offers nothing to collect, a stale net is
   refused inside the transaction, "No the receipt attached" is gone, and a
   waiting collection's holder is locked on the edit.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const M=require('../js/ma-core.js');
const J=v=>JSON.stringify(v);
const clone=v=>JSON.parse(JSON.stringify(v===undefined?null:v));
const SET=M.maSettings(null);
const IDX=M.maChartIndex(M.maChart('groovy',[]));
const fn=name=>typeof M[name]==='function'?M[name]:null;   // new helpers: absent before the fix → a named failure, never a crash
const tryer=f=>{try{return f();}catch(e){return {threw:String(e&&e.message||e)};}};

/* ── core fixtures (the reviewers' shapes) ───────────────────────────── */
let pn=0;
const px=o=>Object.assign({trackingNumber:'T'+(++pn),statusCategory:'delivered',dispatched:true,
  transactionDate:'2026-07-01T08:00:00',orderPickupDate:'2026-07-01T09:00:00',orderDeliveryDate:'2026-07-02T16:00:00',
  cod:10000,transactionFee:0,transactionTax:0,reversalFee:0,reversalTax:0,settle:true},o);
const derive=(parcels,today)=>M.maCprDerive(parcels,{from:'2026-07-01',today:today||'2026-08-05'});
const docsOf=der=>M.maCourierDocs(der,SET).map(d=>Object.assign({dt:'cpr'},d));
const coll=(input,no,cprs,by)=>{const d=M.maBuildDoc('collection',input,{by:by||'afnan',byName:'Afnan',ts:1,cprs},IDX,SET);d.no=no;d.id=no;return Object.assign({dt:'collection'},d);};
const bal=(docs,code)=>M.maBalanceOf(M.maPostAll(docs,IDX,SET),IDX,code);
const applyPlan=(stored,plan)=>{const by={};stored.forEach(d=>{by[d.id]=d;});plan.writes.forEach(w=>{by[w.id]=Object.assign({dt:'cpr'},clone(w.doc));});return Object.keys(by).map(k=>by[k]);};
const ATT=[{publicId:'ma/'+'a'.repeat(64),format:'jpg',type:'authenticated',resourceType:'image'}];
const V=(d,ctx)=>M.maValidate(d,Object.assign({idx:IDX,settings:SET,docs:[],lines:[],closes:[],today:'2026-08-05'},ctx||{}));
const lvl=(res,rule)=>((res.issues||[]).find(i=>i.rule===rule)||{}).level||null;

/* ── the page, over a stubbed Firestore whose transactions behave like
   Firestore's: what one read is recorded, and a commit whose reads changed
   meanwhile runs the whole callback again (a retry). Tabs can share a db. */
function memLS(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];}};}
function mkApp(o){
  o=o||{};
  const db=o.db||{};
  const S={tx:[],retries:0,reads:[],fetches:[]};
  const col=c=>(db[c]=db[c]||{});
  const gate=o.gate||{};
  const globals=Object.assign({
    localStorage:memLS(),
    doc:(_db,c,id)=>({col:c,id}),
    collection:(_db,c)=>({col:c}),
    query:(c,...w)=>Object.assign({},c,{where:w.filter(x=>x&&x.field)}),orderBy:()=>({}),limit:()=>({}),
    where:(field,op,value)=>({field,op,value}),
    getDocs:async q=>{
      S.reads.push(q.col);
      if((o.fail||[]).indexOf(q.col)>=0)throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      if(gate.getDocs)await gate.getDocs(q.col);
      let ids=Object.keys(col(q.col));
      (q.where||[]).forEach(w=>{ids=ids.filter(id=>col(q.col)[id][w.field]===w.value);});
      return {docs:ids.map(id=>({id,data:()=>clone(col(q.col)[id])}))};
    },
    runTransaction:async(_db,f)=>{
      for(let attempt=0;attempt<6;attempt++){
        const seen={},ops=[];
        await f({
          get:async ref=>{const d=col(ref.col)[ref.id];seen[ref.col+'\u0000'+ref.id]=J(d===undefined?null:d);await new Promise(r=>setTimeout(r,2));
            return {exists:()=>d!==undefined,data:()=>clone(d===undefined?{}:d)};},
          set:(ref,d)=>{ops.push({op:'set',col:ref.col,id:ref.id,data:clone(d)});},
          update:(ref,d)=>{ops.push({op:'update',col:ref.col,id:ref.id,data:clone(d)});}});
        const stale=Object.keys(seen).some(k=>{const [c,id]=k.split('\u0000');const d=col(c)[id];return J(d===undefined?null:d)!==seen[k];});
        if(stale){S.retries++;continue;}
        ops.forEach(x=>{if(x.op==='set')col(x.col)[x.id]=clone(x.data);else col(x.col)[x.id]=Object.assign({},col(x.col)[x.id],clone(x.data));});
        S.tx.push(ops);
        return;
      }
      throw new Error('transaction aborted after retries');
    },
    writeBatch:()=>{const ops=[];return{set(ref,d){ops.push({col:ref.col,id:ref.id,data:clone(d)});},async commit(){ops.forEach(x=>{col(x.col)[x.id]=clone(x.data);});}};},
    setDoc:async(ref,d)=>{col(ref.col)[ref.id]=clone(d);},
    fetch:async(url,init)=>{S.fetches.push(String(url));
      if(o.slowAttach&&String(url).indexOf('ma-attach')>=0){await new Promise(r=>setTimeout(r,o.slowAttach));return {ok:true,status:200,json:async()=>({mode:'authenticated',maxBytes:26214400,urlSeconds:300})};}
      return {ok:true,status:202,json:async()=>({})};},
    loadAccountsData:async()=>{},_acctBalances:()=>({cash:0}),_acctLoadErr:null,
    auth:{currentUser:{uid:'u-'+(o.u||'afnan'),email:(o.u||'afnan')+'@groovy.op',metadata:{lastSignInTime:new Date().toUTCString()},getIdToken:async()=>'t'}}
  },o.globals||{});
  const u=o.u||'afnan';
  const app=harness.loadApp({files:['js/ma-core.js','js/master-accounts.js'],currentPage:o.page||'ma-in',
    session:{uid:'u-'+u,u,name:u==='ammar'?'Ammar':'Afnan',role:'owner',email:u+'@groovy.op'},globals});
  return {app,S,db};
}
function unesc(v){return String(v).replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function attr(a,name){const m=new RegExp('(?:^|\\s)'+name+'="([^"]*)"').exec(a);return m?unesc(m[1]):null;}
/* Copy the open modal's controls into the DOM stub, as a person would see them. */
function untouched(app){
  Object.keys(app.nodes).forEach(k=>{if(/^ma-f-/.test(k))delete app.nodes[k];});
  const html=app.bodyHtml('ma-modal-back');const out={};let m;
  const reS=/<select\b([^>]*)>([\s\S]*?)<\/select>/g;
  while((m=reS.exec(html))){const id=attr(m[1],'id');if(!id)continue;const opts=[];const reO=/<option\b([^>]*)>/g;let x;
    while((x=reO.exec(m[2])))opts.push({v:attr(x[1],'value'),sel:/\sselected\b/.test(x[1])});
    const pick=opts.find(y=>y.sel)||opts[0];out[id]={value:pick?pick.v:'',disabled:/\sdisabled\b/.test(m[1])};}
  const reI=/<input\b([^>]*)>/g;
  while((m=reI.exec(html))){const id=attr(m[1],'id');if(id)out[id]={value:attr(m[1],'value')||'',disabled:/\sdisabled\b/.test(m[1])};}
  const reT=/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g;
  while((m=reT.exec(html))){const id=attr(m[1],'id');if(id)out[id]={value:unesc(m[2])};}
  Object.keys(out).forEach(id=>{app.el(id).value=out[id].value;});
  return out;
}
const set=(app,id,v)=>{app.el(id).value=v;};
const txt=h=>String(h).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const said=app=>txt(app.run("(document.getElementById('ma-f-issues')||{}).innerHTML+' '+_MA_FIELDS.map(f=>{const e=document.getElementById('ma-e-'+f);return e?e.textContent:''}).join(' ')"));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* The page's fixture: three PostEx receipts derived from their parcels. */
let qn=0;
const pp=o=>{qn++;return Object.assign({trackingNumber:'PX'+String(qn).padStart(5,'0'),status:'Delivered',statusCategory:'delivered',dispatched:true,
  transactionDate:'2026-07-08T10:00:00',orderPickupDate:'2026-07-09T09:00:00',orderDeliveryDate:'2026-07-10T16:00:00',cod:3000,transactionFee:180,transactionTax:28.8,
  reversalFee:0,reversalTax:0,upfrontPayment:0,reservePayment:0,balancePayment:0,syncedAt:1790000000000,cprCheckedAt:1790100000000},o);};
const PARCELS=[
  pp({trackingNumber:'PA',cod:3000,cprNumber_1:'JUL-1',cpr1Date:'2026-07-14',upfrontPayment:2400}),
  pp({trackingNumber:'PB',cod:2000,cprNumber_1:'JUL-1',cpr1Date:'2026-07-14',upfrontPayment:1500,cprNumber_2:'JUL-2',cpr2Date:'2026-07-21',reservePayment:200}),
  pp({trackingNumber:'PC',cod:1000,transactionFee:100,transactionTax:16,cprNumber_1:'JUL-3',cpr1Date:'2026-07-28',upfrontPayment:800})
];
const PDER=M.maCprDerive(PARCELS,{from:'2026-07-01',today:'2026-08-05'});
const PDOCS=M.maCourierDocs(PDER,SET);
const RUN=()=>({id:'rollup',state:'done',ok:true,at:Date.UTC(2026,8,29,3,45),day:'2026-09-29',parcels:3,transit:PDER.transit,issueCount:0,issues:[],checks:{}});
function seedDb(extra){
  const db={ma_cpr:{},ma_runs:{rollup:RUN()}};
  PDOCS.forEach(d=>{db.ma_cpr[d.id]=clone(d);});
  Object.keys(extra||{}).forEach(k=>{db[k]=Object.assign(db[k]||{},clone(extra[k]));});
  return db;
}
const NET=id=>(PDOCS.find(d=>d.id===id)||{}).net;
const pageColl=(input,no,by)=>coll(Object.assign({courier:'postex',holder:'1011',date:'2026-08-01',attachments:ATT},input),no,PDOCS.map(d=>Object.assign({dt:'cpr'},d)),by);
/* Open the Collection form on some CPRs, filled the way a person would. */
function fillColl(app,cprNos,holder,amount){
  app.run("_maAttachSt={mode:'authenticated'}");
  app.run("window.maRecordKind('collection',{courier:'postex',cprNos:"+J(cprNos)+"})");
  untouched(app);
  set(app,'ma-f-holder',holder||'1011');
  if(amount!==undefined)set(app,'ma-f-amount',String(amount));
  app.run("_maF.atts="+J(ATT));
}

module.exports=async function(){
  const s=suite('master-accounts-m2-review');

  /* ═══ B1 ═══════════════════════════════════════════════════════════════ */
  s.section('B1 — an opening line on 1120 or 1121 is refused; a stored one is a concern');
  {
    const oj=(lines,no)=>{const d=M.maBuildDoc('journal',{kind:'opening',date:'2026-07-01',lines},{by:'afnan',byName:'Afnan',ts:1},IDX,SET);d.no=d.id=no||'JV-27-0001';return Object.assign({dt:'journal'},d);};
    const a=V(oj([{account:'1120',side:'dr',amount:8000}]));
    s.eq('a NEW opening line on 1120 is refused',lvl(a,'opening.derived'),'refuse');
    s.ok('…saying PostEx’s opening comes from its parcels',/PostEx’s opening comes from its parcels/.test(((a.issues||[]).find(x=>x.rule==='opening.derived')||{}).message||''));
    s.eq('…and one on 1121',lvl(V(oj([{account:'1121',side:'dr',amount:5000}])),'opening.derived'),'refuse');
    s.eq('Blue-Ex’s 1123 is typed there on purpose — never refused',lvl(V(oj([{account:'1123',side:'dr',amount:5000}])),'opening.derived'),null);
    // An opening recorded under M1, when the line was not even flagged.
    const m1=oj([{account:'1120',side:'dr',amount:8000},{account:'1121',side:'dr',amount:5000},{account:'1123',side:'dr',amount:2000}]);m1.flags=[];
    s.eq('an edit of an M1 opening that keeps such a line is refused',lvl(V(Object.assign(clone(m1),{note:'x'}),{before:m1,docs:[m1],reason:'a note'}),'opening.derived'),'refuse');
    const drop=oj([{account:'1123',side:'dr',amount:2000}]);
    s.eq('…one without it saves',lvl(V(drop,{before:m1,docs:[m1],reason:'PostEx opens from its parcels'}),'opening.derived'),null);
    const na=M.maCourierConcerns({settings:SET,today:'2026-07-10',docs:[m1]});
    const line=na.find(x=>/opens PostEx a second time/.test(x.sentence||''));
    s.ok('Needs attention: a CONCERN naming the journal, ₨13,000 and 1120 and 1121, saying to void those lines',
      !!line&&line.state==='concern'&&/JV-27-0001/.test(line.sentence)&&/₨13,000/.test(line.sentence)&&/1120 and 1121/.test(line.sentence)&&/Void those lines/.test(line.sentence),J(na.map(x=>x.sentence)));
    s.eq('…its button opens that journal',J(line&&line.action),J({label:'Open',go:'doc',ref:'JV-27-0001',dt:'journal'}));
    s.eq('an opening with no line on 1120 or 1121 raises nothing',M.maCourierConcerns({settings:SET,today:'2026-07-10',docs:[drop]}).filter(x=>/second time/.test(x.sentence||'')).length,0);
    s.eq('a VOID one raises nothing',M.maCourierConcerns({settings:SET,today:'2026-07-10',docs:[Object.assign(clone(m1),{status:'void'})]}).filter(x=>/second time/.test(x.sentence||'')).length,0);
    // The reviewer's case, through Needs attention itself.
    const parcels=[px({trackingNumber:'J1',orderDeliveryDate:'2026-06-26T10:00:00',cod:8000}),
      px({trackingNumber:'J2',orderDeliveryDate:'2026-06-25T10:00:00',cod:5000,cprNumber_1:'CPR-J',cpr1Date:'2026-06-30',upfrontPayment:5000})];
    const der=derive(parcels,'2026-07-10');
    const docs=docsOf(der).concat([m1]);
    const all=M.maNeedsAttention({settings:SET,today:'2026-07-10',holders:[],docs,run:{state:'done',at:Date.UTC(2026,6,10),checks:M.maCourier1120Check(M.maPostAll(docs,IDX,SET),IDX,der),issues:[],issueCount:0},nowMs:Date.UTC(2026,6,10,1),missing:[]});
    s.ok('…and it reaches Needs attention (the owners see it every day until the lines go)',all.some(x=>x.state==='concern'&&/JV-27-0001 opens PostEx a second time/.test(x.sentence||'')),J(all.map(x=>x.sentence)));
  }

  /* ═══ S1 ═══════════════════════════════════════════════════════════════ */
  s.section('S1 — whole rupees per parcel: the day, the receipts and transit agree, and 1120 clears');
  {
    // Four parcels on one day, each on its own receipt paying its whole share
    // (3,000 − 180 − 28.80 = 2,791.20): the day and the four receipts must
    // book the same rupees.
    const parcels=[];
    for(let i=0;i<4;i++)parcels.push(px({cod:3000,transactionFee:180,transactionTax:28.8,cprNumber_1:'CPR-'+i,cpr1Date:'2026-07-14',upfrontPayment:2791.2,cprNumber_2:'R-'+i,cpr2Date:'2026-07-21',reservePayment:0}));
    const der=derive(parcels);
    const docs=docsOf(der);
    const lines=M.maPostAll(docs,IDX,SET);
    const chk=M.maCourier1120Check(lines,IDX,der);
    s.eq('the 1120 check: the books and the parcels agree to the rupee',J([chk.ledger1120,chk.transit1120,chk.diff]),J([0,0,0]));
    s.eq('every receipt carries the whole-rupee share (2,791.20 → ₨2,791)',der.cprs.filter(c=>c.number.indexOf('CPR-')===0).map(c=>c.net).join(','),'2791,2791,2791,2791');
    const na=M.maCourierConcerns({settings:SET,today:'2026-08-05',docs,run:{state:'done',at:Date.UTC(2026,7,5),checks:chk,issues:[],issueCount:0},nowMs:Date.UTC(2026,7,5,1)});
    s.eq('…so Needs attention says nothing about 1120',na.filter(x=>/PostEx owes/.test(x.sentence||'')).length,0);
    // A month of realistic parcels, 80/20 upfront and reserve to the paisa.
    const P=[];let n=0;
    const nextCpr=d=>{for(let i=1;i<8;i++){const x=M.maDayAdd(d,i);const w=new Date(x+'T00:00:00Z').getUTCDay();if(w===2||w===5)return x;}return M.maDayAdd(d,3);};
    for(let d=1;d<=20;d++)for(let i=0;i<9;i++){
      n++;const cod=1500+((n*37)%40)*50,share=cod-180-28.8,up=Math.round(share*0.8*100)/100,res=Math.round((share-up)*100)/100;
      const dd='2026-07-'+String(d).padStart(2,'0'),c1=nextCpr(dd),c2=M.maDayAdd(c1,7);
      P.push(px({orderDeliveryDate:dd+'T16:00:00',transactionDate:dd+'T08:00:00',orderPickupDate:dd+'T09:00:00',cod,transactionFee:180,transactionTax:28.8,
        upfrontPayment:up,reservePayment:res,cprNumber_1:'U-'+c1,cpr1Date:c1,cprNumber_2:'R-'+c2,cpr2Date:c2}));
    }
    const der2=derive(P,'2026-08-31');
    const chk2=M.maCourier1120Check(M.maPostAll(docsOf(der2),IDX,SET),IDX,der2);
    s.eq('a month of '+P.length+' parcels, paid 80/20 to the paisa: 1120 clears exactly',J([chk2.diff,der2.transit.owed]),J([0,0]));
    s.ok('…and no parcel is named a split mismatch (its two parts add up to its share)',!der2.issues.some(i=>i.rule==='cpr.split_mismatch'),J(der2.issues.map(i=>i.rule)));
  }

  /* ═══ S2 — claims, core ════════════════════════════════════════════════ */
  s.section('S2 — claims: the one definition of "names a live collection"');
  {
    const live=fn('maClaimLive');
    const C={'CL-27-0001':{status:'posted'},'CL-27-0002':{status:'void'},'CL-27-0003':{status:'pending'}};
    s.ok('maClaimLive exists',!!live);
    if(live){
      s.eq('no claim, or a released one (collection null): names none',J([live(null,C),live({collection:null},C)]),J([null,null]));
      s.eq('a claim naming a posted or a pending collection: that one',J([live({collection:'CL-27-0001'},C),live({collection:'CL-27-0003'},C)]),J(['CL-27-0001','CL-27-0003']));
      s.eq('…a void one: none',live({collection:'CL-27-0002'},C),null);
      s.eq('…one that does not exist: none',live({collection:'CL-27-0099'},C),null);
    }
    const f=fn('maClaimFor'),r=fn('maClaimRelease');
    s.eq('a claim: the covered id, the collection, by whom, when',J(f&&f('postex-JUL-3','CL-27-0001','afnan',5)),J({doc:'postex-JUL-3',collection:'CL-27-0001',at:5,by:'afnan'}));
    s.eq('a release: the collection null, released now, by whom',J(r&&r({doc:'postex-JUL-3',collection:'CL-27-0001',at:1,by:'ammar'},'afnan',9)),J({doc:'postex-JUL-3',collection:null,at:9,by:'afnan',releasedAt:9}));
    s.ok('ma_claims is in Download the books, and it is not a posting collection',M.MA_BOOK_COLS.indexOf('ma_claims')>=0);
  }

  s.section('S2 — two tabs record the same CPR at the same moment: ONE collection');
  {
    const db=seedDb();
    // Both tabs pass the fresh read of ma_collection before either writes —
    // the check that used to be the only one, and ran outside the transaction.
    let armed=false;const waiting=[];
    const gate={getDocs:async c=>{if(!armed||c!=='ma_collection')return;await new Promise(r=>{waiting.push(r);if(waiting.length===2)waiting.forEach(x=>x());});}};
    const A=mkApp({db,u:'afnan',gate}),B=mkApp({db,u:'ammar',gate});
    for(const t of [A,B]){await t.app.run('maLoad()');fillColl(t.app,['postex-JUL-3'],t===A?'1011':'1020',NET('postex-JUL-3'));}
    armed=true;
    await Promise.all([A.app.run('window.maSaveForm()'),B.app.run('window.maSaveForm()')]);
    const cls=Object.keys(db.ma_collection||{});
    s.eq('one collection is stored, not two',cls.length,1);
    const won=cls[0],claim=(db.ma_claims||{})['postex-JUL-3']||{};
    s.eq('the CPR’s claim names it',claim.collection,won);
    const loser=[A,B].find(t=>!/recorded/.test(J(t.app.state.toasts)))||{app:null};
    s.ok('the other tab is refused, naming the collection that got there first',!!loser.app&&new RegExp('already collected by '+won).test(said(loser.app)),loser.app?said(loser.app):'both recorded');
    s.ok('…its transaction ran again and saw the claim (a retry, not a second write)',A.S.retries+B.S.retries>=1);
    const all=Object.keys(db.ma_cpr).map(k=>Object.assign({dt:'cpr'},db.ma_cpr[k])).concat(cls.map(k=>Object.assign({dt:'collection'},db.ma_collection[k])));
    s.eq('1121 holds nothing twice — only the two CPRs nobody collected',bal(all,'1121'),NET('postex-JUL-1')+NET('postex-JUL-2'));
  }

  s.section('S2 — a void releases its claims in the same write, and the CPR can be collected again');
  {
    const c1=pageColl({cprNos:['postex-JUL-1','postex-JUL-3'],amount:NET('postex-JUL-1')+NET('postex-JUL-3')},'CL-27-0001');
    const db=seedDb({ma_collection:{'CL-27-0001':c1},ma_claims:{
      'postex-JUL-1':{doc:'postex-JUL-1',collection:'CL-27-0009',at:1,by:'afnan'},      // names ANOTHER collection: left alone
      'postex-JUL-3':{doc:'postex-JUL-3',collection:'CL-27-0001',at:1,by:'afnan'}}});
    const {app,S}=mkApp({db,globals:{prompt:()=>'counted against the wrong CPRs',confirm:()=>true}});
    await app.run('maLoad()');
    await app.run("window.maVoidDoc('collection','CL-27-0001')");
    const ops=S.tx[S.tx.length-1]||[];
    s.eq('one transaction: the void, the release and the audit row',J(ops.map(x=>x.col+':'+x.op).sort()),J(['ma_audit:set','ma_claims:set','ma_collection:update']));
    s.eq('the claim that named it is released — collection null, released now',J([db.ma_claims['postex-JUL-3'].collection,Number.isFinite(db.ma_claims['postex-JUL-3'].releasedAt)]),J([null,true]));
    s.eq('a claim naming another collection is left as it was',db.ma_claims['postex-JUL-1'].collection,'CL-27-0009');
    fillColl(app,['postex-JUL-3'],'1011',NET('postex-JUL-3'));
    await app.run('window.maSaveForm()');
    s.eq('the CPR is collected again: a new collection, and the claim names it',J([Object.keys(db.ma_collection).sort(),db.ma_claims['postex-JUL-3'].collection]),J([['CL-27-0001','CL-27-0002'],'CL-27-0002']));
    s.ok('…a re-claim carries no releasedAt',!('releasedAt' in db.ma_claims['postex-JUL-3']));
  }

  s.section('S2 — a claim left naming a VOID collection (voided by a build without claims) does not block');
  {
    const old=Object.assign(pageColl({cprNos:['postex-JUL-3'],amount:NET('postex-JUL-3')},'CL-27-0007'),{status:'void',voidedAt:2,voidedBy:'afnan',voidReason:'x'});
    const db=seedDb({ma_collection:{'CL-27-0007':old},ma_claims:{'postex-JUL-3':{doc:'postex-JUL-3',collection:'CL-27-0007',at:1,by:'afnan'}}});
    const {app}=mkApp({db});
    await app.run('maLoad()');
    fillColl(app,['postex-JUL-3'],'1011',NET('postex-JUL-3'));
    await app.run('window.maSaveForm()');
    const nu=Object.keys(db.ma_collection).find(k=>k!=='CL-27-0007')||'';
    s.ok('recorded, and the claim now names the new collection',Object.keys(db.ma_collection).length===2&&db.ma_claims['postex-JUL-3'].collection===nu&&db.ma_collection[nu].status==='posted',J([Object.keys(db.ma_collection),db.ma_claims['postex-JUL-3']]));
  }

  /* ═══ the screens review: a stale net, inside the transaction ══════════ */
  s.section('screens — the CPR moved while the form was open: refused inside the transaction');
  {
    for(const [label,change,words] of [
      ['its net (the rollup rewrote it)',d=>{d.net=900;d.amount=900;},/changed since this form was opened — now ₨900/],
      ['its status (voided since)',d=>{d.status='void';},/changed since this form was opened — void since/],
      ['which side of the books’ start it is dated',d=>{d.status='before';d.openAt='2026-07-01';},/now dated before the books started/]]){
      const db=seedDb();
      const {app,S}=mkApp({db});
      await app.run('maLoad()');
      fillColl(app,['postex-JUL-3'],'1011',NET('postex-JUL-3'));
      change(db.ma_cpr['postex-JUL-3']);
      await app.run('window.maSaveForm()');
      s.ok(label+': nothing is written, and the form says what moved',!Object.keys(db.ma_collection||{}).length&&!Object.keys(db.ma_claims||{}).length&&S.tx.length===0&&words.test(said(app)),said(app));
    }
    const db=seedDb();
    const {app}=mkApp({db});
    await app.run('maLoad()');
    fillColl(app,['postex-JUL-3'],'1011',NET('postex-JUL-3'));
    db.ma_cpr['postex-JUL-3'].net=900;db.ma_cpr['postex-JUL-3'].amount=900;
    await app.run('window.maSaveForm()');
    s.eq('…the page takes what the transaction read: the form now counts ₨900',J([app.run("maData.cpr.find(d=>d.id==='postex-JUL-3').net"),app.el('ma-f-amount').value]),J([900,'900']));
    await app.run('window.maSaveForm()');
    const cl=(db.ma_collection||{})['CL-27-0001']||{};
    s.eq('…and the next press records it against the net as stored',J([cl.expected,(cl.covers||[{}])[0].net]),J([900,900]));
  }

  /* ═══ S4 ═══════════════════════════════════════════════════════════════ */
  s.section('S4 — "changed after collection" sees a receipt cross the books’ start');
  {
    const moved=fn('maCoverMoved');
    s.ok('maCoverMoved exists',!!moved);
    if(moved){
      const cv={id:'x',net:100},cvB={id:'x',net:100,openAt:'2026-07-01'};
      s.eq('nothing moved',moved(cv,{status:'posted',net:100}),'');
      s.eq('its net',moved(cv,{status:'posted',net:120}),'net');
      s.eq('voided',moved(cv,{status:'void',net:100}),'void');
      s.eq('no longer collectable (undated)',moved(cv,{status:'undated',net:100}),'status');
      s.eq('collected inside the books, now dated before them',moved(cv,{status:'before',openAt:'2026-07-01',net:100}),'books');
      s.eq('collected from before the books, now inside them',moved(cvB,{status:'posted',net:100}),'books');
      s.eq('from before the books, still before them',moved(cvB,{status:'before',openAt:'2026-07-01',net:100}),'');
    }
    const p1=[px({trackingNumber:'A',orderDeliveryDate:'2026-06-28T12:00:00',cprNumber_1:'CPR-9',cpr1Date:'2026-07-01',upfrontPayment:10000})];
    const d1=docsOf(derive(p1));
    const cl=coll({courier:'postex',holder:'1011',amount:10000,date:'2026-07-03',cprNos:['postex-CPR-9'],attachments:ATT},'CL-27-0001',d1);
    // The receipt as the rollup of the old code would have left it: moved.
    const crossed=d1.map(d=>d.id==='postex-CPR-9'?Object.assign({},d,{status:'before',openAt:'2026-07-01',date:'2026-06-30'}):d);
    const na=M.maCourierConcerns({settings:SET,today:'2026-08-05',docs:crossed.concat([cl])});
    s.ok('Needs attention names it — same net, other side of the start',na.some(x=>/changed after it was collected/.test(x.sentence||'')&&/other side of the books’ start/.test(x.sentence||'')),J(na.map(x=>x.sentence)));
  }

  s.section('S4 — the rollup never moves a COLLECTED receipt across the books’ start');
  for(const [label,dBefore,dAfter] of [['posted (1 July) → before (30 June)','2026-07-01','2026-06-30'],['before (30 June) → posted (1 July)','2026-06-30','2026-07-01']]){
    const p1=[px({trackingNumber:'A',orderDeliveryDate:'2026-06-28T12:00:00',cprNumber_1:'CPR-9',cpr1Date:dBefore,upfrontPayment:10000})];
    const d1=docsOf(derive(p1));
    const cl=coll({courier:'postex',holder:'1011',amount:10000,date:'2026-07-03',cprNos:['postex-CPR-9'],attachments:ATT},'CL-27-0001',d1);
    const all1=d1.concat([cl]);
    const der2=derive([Object.assign({},p1[0],{cpr1Date:dAfter})]);
    const plan=M.maCourierPlan(d1,M.maCourierDocs(der2,SET),{at:2,locked:()=>false,docs:[cl]});
    const all2=applyPlan(d1,plan).concat([cl]);
    const cpr1=all1.find(d=>d.id==='postex-CPR-9'),cpr2=all2.find(d=>d.id==='postex-CPR-9');
    s.eq(label+': the receipt is left as it was',J([cpr2.status,cpr2.date]),J([cpr1.status,cpr1.date]));
    const sk=(plan.skipped||[]).find(x=>x.id==='postex-CPR-9')||{};
    s.ok('…skipped with a message the run carries — naming the collection and what to do',/CL-27-0001 collected it/.test(sk.message||'')&&/void CL-27-0001 and record it again/.test(sk.message||'')&&sk.rule==='cpr.collected_moved',J(plan.skipped));
    s.ok('…a message-bearing skip comes first (the run keeps the first hundred)',plan.skipped.length>0&&!!plan.skipped[0].message);
    s.eq('…1121 is not silently corrupted — it holds nothing',bal(all2,'1121'),0);
    const chk=M.maCourier1120Check(M.maPostAll(all2,IDX,SET),IDX,der2);
    const run={state:'done',at:Date.UTC(2026,7,5),checks:chk,issues:[],issueCount:0,skipped:clone(plan.skipped)};
    const na=M.maCourierConcerns({settings:SET,today:'2026-08-05',docs:all2,run,nowMs:Date.UTC(2026,7,5,1)});
    s.ok('…Needs attention carries the rollup’s skip as a CONCERN',na.some(x=>x.state==='concern'&&/CL-27-0001 collected it/.test(x.sentence||'')),J(na.map(x=>x.sentence)));
    s.ok('…and the 1120 check says the books and the parcels differ (loud, where the old code was silent)',chk.diff!==0&&na.some(x=>/The books say PostEx owes/.test(x.sentence||'')),J(chk));
    // The way out the message gives: void the collection, run again, record it again.
    const voidCl=Object.assign({},cl,{status:'void'});
    const plan3=M.maCourierPlan(applyPlan(d1,plan),M.maCourierDocs(der2,SET),{at:3,locked:()=>false,docs:[voidCl]});
    const d3=applyPlan(applyPlan(d1,plan),plan3);
    const cl2=coll({courier:'postex',holder:'1011',amount:10000,date:'2026-07-03',cprNos:['postex-CPR-9'],attachments:ATT},'CL-27-0002',d3);
    const all3=d3.concat([voidCl,cl2]);
    const chk3=M.maCourier1120Check(M.maPostAll(all3,IDX,SET),IDX,der2);
    s.eq('…void it, the next run moves the receipt, record it again: every account is right (3090 the ₨10,000 PostEx owed at the start)',J([chk3.diff,bal(all3,'1121'),bal(all3,'1011'),bal(all3,'3090')]),J([0,0,10000,10000]));
  }
  {
    const p1=[px({trackingNumber:'A',orderDeliveryDate:'2026-06-28T12:00:00',cprNumber_1:'CPR-9',cpr1Date:'2026-07-01',upfrontPayment:10000})];
    const d1=docsOf(derive(p1));
    const plan=M.maCourierPlan(d1,M.maCourierDocs(derive([Object.assign({},p1[0],{cpr1Date:'2026-06-30'})]),SET),{at:2,locked:()=>false,docs:[]});
    s.ok('a receipt nobody collected still moves across the start as before',plan.writes.some(w=>w.id==='postex-CPR-9'&&w.doc.status==='before'),J(plan.writes.map(w=>w.id+':'+(w.doc&&w.doc.status))));
  }

  /* ═══ S5 ═══════════════════════════════════════════════════════════════ */
  s.section('S5 — a negative receipt is listed, tickable and counted');
  {
    const parcels=[px({trackingNumber:'D1',cprNumber_1:'CPR-1',cpr1Date:'2026-07-07',upfrontPayment:10000}),
      px({trackingNumber:'R1',statusCategory:'returned',cod:0,reversalFee:150,reversalTax:24,cprNumber_1:'CPR-R',cpr1Date:'2026-07-07'})];
    const docs=docsOf(derive(parcels));
    s.eq('the returned parcel’s receipt nets −₨174',(docs.find(d=>d.id==='postex-CPR-R')||{}).net,-174);
    s.eq('maUncollected offers it beside the positive one',M.maUncollected(docs,SET).map(x=>x.doc.id).sort().join(','),'postex-CPR-1,postex-CPR-R');
    const both=coll({courier:'postex',holder:'1011',amount:9826,date:'2026-07-08',cprNos:['postex-CPR-1','postex-CPR-R'],attachments:ATT},'CL-27-0001',docs);
    s.eq('collected together: expected ₨9,826, no difference, and it validates',J([both.expected,both.difference,V(both,{docs,attach:'signed'}).ok]),J([9826,0,true]));
    s.eq('…1121 and 9030 then clear',J([bal(docs.concat([both]),'1121'),bal(docs.concat([both]),'9030')]),J([0,0]));
    const alone=coll({courier:'postex',holder:'1011',amount:1,date:'2026-07-08',cprNos:['postex-CPR-R'],attachments:ATT},'CL-27-0002',docs);
    s.eq('on its own it is nothing to collect (refused)',lvl(V(alone,{docs,attach:'signed'}),'collection.nothing'),'refuse');
    const inflow=M.maCourierInflows({settings:SET,today:'2026-08-05',docs}).find(x=>x.cpr==='postex-CPR-R');
    s.eq('the calendar counts it as what PostEx deducts',inflow&&inflow.amount,-174);
    const db={ma_cpr:{},ma_runs:{rollup:RUN()}};docs.forEach(d=>{db.ma_cpr[d.id]=clone(d);});
    const {app}=mkApp({db});
    await app.run('maLoad()');
    s.eq('Money in lists it, tickable',app.run("_maCollectable(_maCtx(),'postex').map(x=>x.doc.id).sort().join(',')"),'postex-CPR-1,postex-CPR-R');
    app.run("window.maCourierTickAll('postex',true)");
    s.eq('ticking both: the Record button says ₨9,826',app.run("_maRecLabel('postex',_maCollectable(_maCtx(),'postex'))"),'Record collection · 2 ticked · ₨9,826');
    app.run("window.maOpenDoc('cpr','postex-CPR-R')");
    s.ok('its rail offers to record its collection',/Record its collection/.test(app.run('_maRailHTML()')));
  }

  /* ═══ S7 ═══════════════════════════════════════════════════════════════ */
  s.section('S7 — disputes: one open at a time, the opener kept, one history row per change');
  {
    const d=Object.assign({dt:'cpr'},PDOCS.find(x=>x.id==='postex-JUL-1'));
    const o=M.maDisputePatch(d,'afnan',{state:'open',reason:'PostEx paid 2,000'},{at:3});
    s.eq('an open writes the dispute AND one history row',J(o.patch),J({dispute:{state:'open',reason:'PostEx paid 2,000',by:'afnan',at:3},disputes:[{state:'open',reason:'PostEx paid 2,000',by:'afnan',at:3}]}));
    const opened=Object.assign({},d,o.patch);
    s.ok('a second open over an open one is refused — by either owner',!!M.maDisputePatch(opened,'ammar',{state:'open',reason:'nothing wrong'},{at:4}).error&&!!M.maDisputePatch(opened,'afnan',{state:'open',reason:'again'},{at:4}).error);
    const r=M.maDisputePatch(opened,'ammar',{state:'resolved',note:'PostEx corrected it'},{at:9});
    s.eq('a resolve keeps who opened it, when and why',J([r.patch.dispute.by,r.patch.dispute.at,r.patch.dispute.reason,r.patch.dispute.resolvedBy]),J(['afnan',3,'PostEx paid 2,000','ammar']));
    s.eq('…and appends its own row, the first kept',J(r.patch.disputes),J([{state:'open',reason:'PostEx paid 2,000',by:'afnan',at:3},{state:'resolved',note:'PostEx corrected it',by:'ammar',at:9}]));
    const again=M.maDisputePatch(Object.assign({},opened,r.patch),'afnan',{state:'open',reason:'short again'},{at:12});
    s.eq('a new dispute after a resolution: allowed, the resolution kept in the history',(again.patch&&again.patch.disputes||[]).map(x=>x.state).join(','),'open,resolved,open');
    s.eq('the owner fields are the review, the dispute and its history',M.MA_DERIVED_OWNER_FIELDS.join(),'reviewedAt,reviewedBy,dispute,disputes');
    // The rollup keeps the history across a rewrite.
    const stored=Object.assign({},d,again.patch);
    const next=Object.assign({},d,{net:d.net+1,amount:d.amount+1,sig:'v1:moved'});
    const mr=M.maCourierMerge(stored,next,{at:20});
    s.eq('a rollup rewrite keeps the dispute and all its history',J([mr.doc&&mr.doc.dispute&&mr.doc.dispute.state,(mr.doc&&mr.doc.disputes||[]).length,(mr.fields||[]).indexOf('disputes')]),J(['open',3,-1]));
  }
  s.section('S7 — Open dispute and Resolve dispute on a derived document’s rail');
  {
    const db=seedDb();
    let answer='PostEx paid ₨2,000 on it';
    const {app,S}=mkApp({db,globals:{prompt:()=>answer}});
    await app.run('maLoad()');
    app.run("window.maOpenDoc('cpr','postex-JUL-1')");
    let rail=app.run('_maRailHTML()');
    s.ok('an owner sees Open dispute on a PostEx receipt',/window\.maDisputeDoc\('postex-JUL-1','open'\)/.test(rail)&&!/Resolve dispute/.test(rail));
    const hasAction=app.run("typeof window.maDisputeDoc==='function'");
    s.ok('the page has a dispute action (window.maDisputeDoc)',hasAction);
    if(hasAction){
    await app.run("window.maDisputeDoc('postex-JUL-1','open')");
    const x=db.ma_cpr['postex-JUL-1'];
    s.eq('it writes the dispute and its first history row, in one transaction with an audit row',J([x.dispute&&x.dispute.state,(x.disputes||[]).length,(S.tx[S.tx.length-1]||[]).map(o=>o.col).sort().join(',')]),J(['open',1,'ma_audit,ma_cpr']));
    rail=app.run('_maRailHTML()');
    s.ok('…the rail now offers Resolve dispute and shows the dispute',/window\.maDisputeDoc\('postex-JUL-1','resolved'\)/.test(rail)&&/PostEx paid ₨2,000 on it/.test(rail)&&!/'open'\)">Open dispute/.test(rail));
    answer='PostEx corrected it';
    await app.run("window.maDisputeDoc('postex-JUL-1','resolved')");
    s.eq('resolved: the opener kept, two rows of history',J([db.ma_cpr['postex-JUL-1'].dispute.state,db.ma_cpr['postex-JUL-1'].dispute.by,(db.ma_cpr['postex-JUL-1'].disputes||[]).map(r=>r.state).join(',')]),J(['resolved','afnan','open,resolved']));
    // Someone else changed the dispute since this screen read it: refused.
    db.ma_cpr['postex-JUL-1'].disputes.push({state:'open',reason:'x',by:'ammar',at:1});db.ma_cpr['postex-JUL-1'].dispute={state:'open',reason:'x',by:'ammar',at:1};
    const before=S.tx.length;answer='again';
    await app.run("window.maDisputeDoc('postex-JUL-1','open')");
    s.eq('a dispute changed in another tab since: nothing written',S.tx.length,before);
    app.run("window.maOpenDoc('cpr','postex-JUL-1')");
    const {app:typed}=mkApp({db:seedDb({ma_cpr:{'CS-27-0001':Object.assign(M.maBuildDoc('cpr',{courier:'tcs',date:'2026-07-31',ref:'T',lines:[{date:'2026-07-10',parcels:1,cod:500,fee:10,tax:0}],attachments:ATT},{by:'afnan',byName:'Afnan',ts:1},IDX,SET),{id:'CS-27-0001',no:'CS-27-0001'})}})});
    await typed.run('maLoad()');
    typed.run("window.maOpenDoc('cpr','CS-27-0001')");
    s.ok('a typed statement has no dispute button — it is edited',!/maDisputeDoc/.test(typed.run('_maRailHTML()')));
    }
  }

  /* ═══ N1 ═══════════════════════════════════════════════════════════════ */
  s.section('note 1 — a difference inside the tolerance is no line; past it, reviewing ends it');
  {
    const docs=docsOf(derive([px({trackingNumber:'A',cprNumber_1:'CPR-1',cpr1Date:'2026-07-07',upfrontPayment:10000})]));
    const mk=(amount,no)=>coll({courier:'postex',holder:'1011',amount,date:'2026-07-08',cprNos:['postex-CPR-1'],attachments:ATT,note:'short'},no,docs);
    const off=fn('maCollectionOff');
    s.ok('maCollectionOff exists',!!off);
    const inside=mk(9990,'CL-27-0001'),past=mk(9800,'CL-27-0002');
    if(off)s.eq('₨10 short of ₨10,000 (1% is ₨100): not off; ₨200 short: off',J([off(inside,SET),off(past,SET)]),J([false,true]));
    const line=docs2=>M.maCourierConcerns({settings:SET,today:'2026-08-05',docs:docs2}).filter(x=>/differ/.test(x.sentence||''));
    s.eq('inside the tolerance: no Needs attention line at all',line(docs.concat([inside])).length,0);
    s.eq('past it: a line',line(docs.concat([past])).length,1);
    s.eq('…until the collection is reviewed',line(docs.concat([Object.assign({},past,{reviewedAt:5,reviewedBy:'afnan'})])).length,0);
    const db={ma_cpr:{},ma_collection:{},ma_runs:{rollup:RUN()}};docs.forEach(d=>{db.ma_cpr[d.id]=clone(d);});
    db.ma_collection['CL-27-0001']=clone(inside);db.ma_collection['CL-27-0002']=clone(Object.assign({},past,{cprNos:undefined,refs:{cprNos:['postex-CPR-1']}}));
    const {app}=mkApp({db});
    await app.run('maLoad()');
    app.run("window.maCourierFilter('difference')");
    s.eq('the Money in filter behind the line shows the same collections',app.run("_maCollFiltered(_maCtx(),'postex').list.map(d=>d.id).join(',')"),'CL-27-0002');
  }

  /* ═══ N2 ═══════════════════════════════════════════════════════════════ */
  s.section('note 2 — a NEW flag from the rollup clears an earlier review');
  {
    const base=[px({trackingNumber:'A',cprNumber_1:'CPR-1',cpr1Date:'2026-07-07',upfrontPayment:6000,cprCheckedAt:5}),
      px({trackingNumber:'B',cod:4000,cprNumber_1:'CPR-1',cpr1Date:'2026-07-07',cprCheckedAt:5})];
    const d1=docsOf(derive(base)).find(d=>d.id==='postex-CPR-1');
    const stored=Object.assign({},d1,{reviewedAt:1,reviewedBy:'afnan'});
    const night2=base.concat([Object.assign({},base[1],{cprNumber_1:'CPR-2',cpr1Date:'2026-07-07',cprCheckedAt:0,syncedAt:0})]);
    const d2=docsOf(derive(night2)).find(d=>d.id==='postex-CPR-1');
    const r=M.maCourierMerge(stored,d2,{at:2,locked:()=>false});
    s.ok('(the fixture: night 2 adds a rule, every figure the same)',M.maNewFlagRules(stored.flags,d2.flags).length>0&&(r.fields||[]).join()==='flags',J([M.maNewFlagRules(stored.flags,d2.flags),r.fields]));
    s.eq('the review is cleared …',J([r.doc.reviewedAt,r.doc.reviewedBy]),J([null,null]));
    s.eq('…so the receipt is back in the review queue',M.maReviewQueue([Object.assign({dt:'cpr'},r.doc)]).length,1);
    const same=Object.assign({},stored,{flags:(stored.flags||[]).map(f=>Object.assign({},f,{message:f.message+' (re-worded)'})),sig:'v1:reworded'});
    const k=M.maCourierMerge(stored,same,{at:3,locked:()=>false});
    s.eq('a flag re-worded under the same rule keeps the review',J([k.doc&&k.doc.reviewedAt,k.doc&&k.doc.reviewedBy]),J([1,'afnan']));
  }

  /* ═══ N3 ═══════════════════════════════════════════════════════════════ */
  s.section('note 3 — Money in never says more is uncollected than the books say is owed');
  {
    const parcels=[px({trackingNumber:'D1',cprNumber_1:'CPR-1',cpr1Date:'2026-07-07',upfrontPayment:10000}),
      px({trackingNumber:'R1',statusCategory:'returned',cod:0,reversalFee:150,reversalTax:24,cprNumber_1:'CPR-R',cpr1Date:'2026-07-07'}),
      px({trackingNumber:'J1',orderDeliveryDate:'2026-06-25T10:00:00',cod:5000,cprNumber_1:'CPR-J',cpr1Date:'2026-06-30',upfrontPayment:5000})];
    const der=derive(parcels,'2026-09-29');
    const db={ma_cpr:{},ma_runs:{rollup:Object.assign(RUN(),{transit:der.transit})}};docsOf(der).forEach(d=>{db.ma_cpr[d.id]=clone(d);});
    const {app}=mkApp({db});
    await app.run('maLoad()');
    const sum=txt((/<p class="ma-sum">([\s\S]*?)<\/p>/.exec(app.run('_maInHTML()'))||['',''])[1]).trim();
    s.ok('what PostEx owes, and the part of it on CPRs not yet collected, agree with the books',/PostEx owes ₨9,826 ?; ₨9,826 of it is on 2 CPRs not yet collected\./.test(sum),sum);
    s.ok('…the receipt from before the books is said apart from it',/₨5,000 is on 1 CPR from before the books started/.test(sum)&&/not in what the books say it owes until it is collected/.test(sum),sum);
    s.ok('…and it is still offered to collect',app.run("_maCollectable(_maCtx(),'postex').some(x=>x.doc.id==='postex-CPR-J')"));
  }

  /* ═══ the screens review's write-path items ═══════════════════════════ */
  s.section('screens — a double press records ONCE (collection and statement)');
  {
    const db=seedDb();
    const {app,S}=mkApp({db,slowAttach:60});
    await app.run('maLoad()');
    app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-3']})");
    untouched(app);set(app,'ma-f-holder','1011');set(app,'ma-f-amount',String(NET('postex-JUL-3')));app.run("_maF.atts="+J(ATT));
    const r0=S.reads.filter(c=>c==='ma_collection').length;
    const a=app.run('window.maSaveForm()');await sleep(5);const b=app.run('window.maSaveForm()');
    await Promise.all([a,b]);
    s.eq('a collection pressed twice while the attachment state is still asked for: one transaction, one collection',J([S.tx.length,Object.keys(db.ma_collection||{}).length]),J([1,1]));
    // The claims (S2) would also stop a second collection inside its own
    // transaction, so the count above holds either way; what only the guard
    // does is drop the second press before it reads or writes anything.
    s.eq('…and the second press did nothing: ma_collection was read fresh once, not twice',S.reads.filter(c=>c==='ma_collection').length-r0,1);
    app.run("window.maRecordKind('statement',{courier:'tcs'})");
    untouched(app);set(app,'ma-f-date','2026-09-14');set(app,'ma-f-ref','TCS-SEP-1');
    app.run("_maF.stLines=[{date:'2026-09-10',parcels:'12',returned:false,cod:'35000',fee:'1750',tax:'280',memo:''}];_maF.atts="+J(ATT));
    app.run("_maAttachSt=null");
    const c=app.run('window.maSaveForm()');await sleep(5);const d=app.run('window.maSaveForm()');
    await Promise.all([c,d]);
    s.eq('a statement pressed twice: one statement',Object.keys(db.ma_cpr).filter(k=>/^CS-/.test(k)).length,1);
  }

  s.section('screens — ma_collection unreadable: nothing is offered to collect');
  {
    const c1=pageColl({cprNos:['postex-JUL-1'],amount:NET('postex-JUL-1')},'CL-27-0001');
    const db=seedDb({ma_collection:{'CL-27-0001':c1}});
    const {app,S}=mkApp({db,fail:['ma_collection']});
    await app.run('maLoad()');
    app.run("window.maOpenDoc('cpr','postex-JUL-1')");
    const rail=app.run('_maRailHTML()');
    s.ok('its rail says whether it is collected is not known — never "not yet"',/not known — incomplete — ma_collection could not be read/.test(rail)&&!/not yet/.test(rail),txt(rail).slice(0,400));
    s.ok('…and offers no "Record its collection"',!/Record its collection/.test(rail));
    s.eq('Money in’s list offers nothing',app.run("_maCollectable(_maCtx(),'postex').length"),0);
    app.run("window.maRecordKind('collection',{courier:'postex',cprNos:['postex-JUL-1']})");
    const form=app.bodyHtml('ma-modal-back');
    s.ok('the Collection form lists none of them as free',!/value="postex-JUL-1"/.test(form)&&/which statements are already collected is not known/.test(form));
    untouched(app);set(app,'ma-f-holder','1011');set(app,'ma-f-amount',String(NET('postex-JUL-1')));app.run("_maF.atts="+J(ATT));
    await app.run('window.maSaveForm()');
    s.ok('…and Record is refused, writing nothing',S.tx.length===0&&/ma_collection could not be read/.test(said(app)),said(app));
  }

  s.section('screens — the wording: "No receipt attached", never "No the receipt"');
  {
    const docs=PDOCS.map(d=>Object.assign({dt:'cpr'},d));
    const bare=coll({courier:'postex',holder:'1011',amount:NET('postex-JUL-3'),date:'2026-08-01',cprNos:['postex-JUL-3'],attachments:[]},'CL-27-0001',docs);
    const off=V(bare,{docs,attach:'not_configured'}),on=V(bare,{docs,attach:'signed'});
    const msg=(r,rule)=>((r.issues||[]).find(i=>i.rule===rule)||{}).message||'';
    s.ok('attachments off: "No receipt attached — …"',/^No receipt attached — /.test(msg(off,'collection.receipt')),msg(off,'collection.receipt'));
    s.ok('attachments on: "Attach the receipt — …"',/^Attach the receipt — /.test(msg(on,'collection.receipt')),msg(on,'collection.receipt'));
    const st=Object.assign({dt:'cpr'},M.maBuildDoc('cpr',{courier:'tcs',date:'2026-07-31',ref:'T',lines:[{date:'2026-07-10',parcels:1,cod:500,fee:10,tax:0}]},{by:'afnan',byName:'Afnan',ts:1},IDX,SET));
    const so=V(st,{attach:'not_configured'});
    s.ok('a statement: "No courier’s statement attached — …"',/^No courier’s statement attached — /.test(msg(so,'statement.attach')),msg(so,'statement.attach'));
    s.ok('nothing anywhere says "No the"',[msg(off,'collection.receipt'),msg(on,'collection.receipt'),msg(so,'statement.attach'),msg(V(st,{attach:'signed'}),'statement.attach')].every(m=>m&&!/No the |Attach the the /.test(m)));
  }

  s.section('screens — a waiting collection’s holder is locked on the edit, as the core locks it');
  {
    const w=pageColl({holder:'1012',cprNos:['postex-JUL-3'],amount:NET('postex-JUL-3')},'CL-27-0001');   // into Ammar's hands: waits for him
    const p=pageColl({holder:'1020',cprNos:['postex-JUL-1'],amount:NET('postex-JUL-1')},'CL-27-0002');   // MCB: posts at once
    const db=seedDb({ma_collection:{'CL-27-0001':w,'CL-27-0002':p}});
    const {app}=mkApp({db});
    await app.run('maLoad()');
    s.ok('(the fixture: CL-27-0001 waits for Ammar; CL-27-0002 posted)',w.status==='pending'&&w.confirmBy==='ammar'&&p.status==='posted');
    app.run("window.maEditDoc('collection','CL-27-0001')");
    let f=untouched(app);
    s.eq('the waiting one: its holder select is disabled, on the stored holder',J([f['ma-f-holder'].disabled,f['ma-f-holder'].value]),J([true,'1012']));
    set(app,'ma-f-holder','1011');
    s.eq('…and what the form reads is the stored holder, whatever the control says',app.run('_maCollRead(_maF).holder'),'1012');
    app.run('window.maCloseModal()');
    app.run("window.maEditDoc('collection','CL-27-0002')");
    f=untouched(app);
    s.eq('a posted one nobody had to confirm: its holder can change',f['ma-f-holder'].disabled,false);
  }

  s.section('housekeeping — ma_claims everywhere a collection list is kept');
  {
    const fs=require('fs'),path=require('path');
    const read=p=>fs.readFileSync(path.join(harness.ROOT,p),'utf8');
    const rules=read('firestore.rules');
    s.ok('firestore.rules: an ma_claims block — owners read, create and update through maClaimOk, never delete',/match \/ma_claims\/\{docId\} \{\s*allow read: if isMasterAccounts\(\);\s*allow create, update: if maClaimOk\(docId\);\s*allow delete: if false;/.test(rules));
    s.ok('…and a collection is created only with its first statement’s claim',/allow create: if maDocCreateOk\('collection'[\s\S]{0,200}&& maClClaimedOk\(docId\);/.test(rules));
    s.ok('the nightly backup exports it',/'ma_claims'/.test(read('netlify/functions/ma-backup.js')));
    s.ok('the page writes it only through _MA_REF (a literal the invariants see)',/ma_claims:id=>doc\(db,'ma_claims',id\)/.test(read('js/master-accounts.js')));
  }
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts M1.4 — the PDFs, as js/print-engine.js draws them.

   printDocument is DRIVEN against a jsPDF that records every word it is
   asked to draw, with the data built by js/ma-core.js's own maPdf*Data from
   a real book of postings. What this holds:
   - the five variants are registered everywhere a variant must be;
   - the page each asks for: the ledger A4 LANDSCAPE (its footer on the
     landscape page), the statements A4 portrait, the two slips A5 with
     their own footer and never the A4 one — and every variant that existed
     before M1.4 still constructs A4 portrait (landscape asked or not);
   - the ledger's table head is drawn again on every page it reaches;
   - the engine prints the figures it is handed and computes none of them;
   - a voided or waiting document is never drawn on a ledger or statement;
   - VOID and "Revised · rev N" are drawn exactly when they are true, and
     N is the rail's own number (maRevOf);
   - Urdu is drawn only by a font that can draw it — never tofu;
   - deliver:'blob' opens no tab, downloads nothing and resolves
     {blob, filename}; a failure rejects;
   - money and dates are formatted exactly the way the screen formats them.

   It cannot tell what a PDF LOOKS like: the five were rendered for real in
   headless Chromium (pdf.js) and looked at, page by page, for M1.4.
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
const ARABIC=/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const MA_TYPES=['ma-ledger','ma-statement-party','ma-statement-holder','ma-receipt','ma-voucher'];

/* A jsPDF that records what it is asked to draw, page by page. */
const FAKE=`__made=[];__docs=[];__open=0;__throwOn=null;
FakePDF=function(opts){
  __made.push(JSON.parse(JSON.stringify(opts||{})));
  let W=595.28,H=841.89;
  if(opts&&Array.isArray(opts.format)){W=opts.format[0];H=opts.format[1];}
  if(opts&&opts.orientation==='landscape'&&W<H){const t=W;W=H;H=t;}
  const d=this;let page=1,pages=1,size=16,font='helvetica',style='normal',ink='0,0,0',draw='0,0,0';
  d.log={text:[],rect:[],line:[],pages:1,saved:null};
  d.internal={pageSize:{getWidth:()=>W,getHeight:()=>H}};
  d.addPage=()=>{pages++;page=pages;d.log.pages=pages;return d;};
  d.setPage=p=>{page=p;return d;};
  d.getNumberOfPages=()=>pages;
  d.setFont=(f,s)=>{font=f;style=s||'normal';return d;};
  d.setFontSize=s=>{size=s;return d;};
  d.setTextColor=(r,g,b)=>{ink=[r,g,b].join(',');return d;};
  d.setDrawColor=(r,g,b)=>{draw=[r,g,b].join(',');return d;};
  ['setLineWidth','setFillColor','addFileToVFS','addFont','addImage','roundedRect'].forEach(k=>{d[k]=function(){return d;};});
  d.getTextWidth=t=>String(t).length*size*0.5;
  d.splitTextToSize=(t,w)=>{const out=[];String(t).split('\\n').forEach(par=>{let cur='';par.split(' ').forEach(wd=>{const nx=cur?cur+' '+wd:wd;if(cur&&nx.length*size*0.5>w){out.push(cur);cur=wd;}else cur=nx;});out.push(cur);});return out;};
  d.text=(t,x,y,o)=>{(Array.isArray(t)?t:[t]).forEach((s,i)=>{if(__throwOn&&String(s).indexOf(__throwOn)>=0)throw new Error('drawing failed on '+__throwOn);
    d.log.text.push({t:String(s),x,y:y+i*size*1.15,page,size,font,style,ink,align:o&&o.align||'left'});});return d;};
  d.rect=(x,y,w,h,st)=>{d.log.rect.push({x,y,w,h,st:st||'',page,draw});return d;};
  d.line=(x1,y1,x2,y2)=>{d.log.line.push({x1,y1,x2,y2,page,draw});return d;};
  d.output=()=>({size:4096,fake:true});
  d.save=f=>{d.log.saved=f;};
  __docs.push(d);
};
window.jspdf={jsPDF:FakePDF};
__wins=[];
window.open=u=>{__open++;if(u)return null;const w={closed:false,location:null,document:{open(){},write(){},close(){}},close(){this.closed=true;}};__wins.push(w);return w;};
__clicks=[];
const __mkEl=document.createElement;
document.createElement=function(t){const n=__mkEl.call(document,t);if(String(t).toLowerCase()==='a')n.click=function(){__clicks.push({href:n.href,download:n.download});};return n;};`;

/* Each engine gets its OWN URL: Node's refuses anything but a real Blob, and
   another suite in this same process stubs the process-wide one. `o.URL`
   hands out blob: URLs the way a browser does, with a clock that never fires
   the 60-second revoke — so the old path runs whole without holding the run
   open for a minute. */
function engine(o){
  o=o||{};
  const warns=[];
  const globals={console:{log(){},info(){},error(){},warn:(...a)=>warns.push(a.join(' '))},
    URL:o.URL||{createObjectURL(){throw new TypeError('The "obj" argument must be an instance of Blob.');},revokeObjectURL(){}}};
  if(o.URL)globals.setTimeout=(fn,ms)=>ms>=60000?0:setTimeout(fn,ms);
  const e=harness.loadApp({files:['js/print-engine.js'],currentPage:'ma-ledger',globals});
  e.run(FAKE);
  e.warns=warns;
  return e;
}
/* Print once; hand back what printDocument returned and the doc it drew. */
async function print(e,type,data,extra){
  const n=e.run('__docs.length');
  const w=e.warns.length;
  const r=await e.run('window.printDocument('+J(Object.assign({type,data,filename:'t.pdf',deliver:'blob'},extra||{}))+')');
  return {r,d:e.run('__docs['+n+']'),made:e.run('__made['+n+']'),warns:e.warns.slice(w)};
}
const texts=d=>d.log.text.map(t=>t.t);
/* Everything drawn, as one string — for a sentence the page wraps. */
const prose=d=>d.log.text.map(t=>t.t).join(' ').replace(/\s+/g,' ');
const count=(d,s)=>d.log.text.filter(t=>t.t===s).length;
const pagesWith=(d,pred)=>{const p=new Set();d.log.text.forEach(t=>{if(pred(t))p.add(t.page);});return [...p].sort((a,b)=>a-b);};

/* ── a book, built and posted by js/ma-core.js ─────────────────────────── */
const S=M.maSettings(null);
const IDX=M.maChartIndex(M.maChart('groovy',[]));
let seq=0;
const meta=u=>({by:u||'afnan',byName:(u||'afnan').replace(/^./,c=>c.toUpperCase()),ts:1790000000000+(++seq)*60000});
function mk(dt,input,u,extra){
  const d=M.maBuildDoc(dt,input,Object.assign(meta(u),extra||{}),IDX,S);
  d.id=dt[0]+seq;d.no=M.maDocNo(dt,d.fy||'FY27',seq);
  return d;
}
const jv=(kind,input,u)=>mk('journal',Object.assign({kind},input),u);
const tr=(input,u)=>mk('transfer',input,u);
const NONE={kind:'none',rate:0,amount:0};
const FROM='2026-10-01',TO='2026-12-31',RANGE={from:FROM,to:TO,label:'Q2 FY27'};
const party={id:'p_asg',kind:'vendor',name:'Asghar Printers',code:'ASG',active:true,contact:{phone:'0300 1234567'},vendor:{terms:{mode:'credit',creditDays:30,from:'2026-07-01'}}};
const opening=jv('opening',{date:'2026-07-01',lines:[{account:'1011',side:'dr',amount:500000},{account:'1020',side:'dr',amount:2000000},
  {account:'1012',side:'dr',amount:300000},{account:'2010',side:'cr',amount:150000,party:'p_asg',memo:'Owed for September'}]});
const cap=jv('capital',{date:'2026-10-01',holder:'1011',owner:'afnan',amount:200000,note:'October wages'});
const wht=jv('money_out',{date:'2026-10-02',holder:'1011',account:'5030',party:'p_asg',amount:100000,tax:{kind:'withholding',rate:4},note:'October printing'});
const pay=jv('money_out',{date:'2026-10-05',holder:'1020',account:'2010',party:'p_asg',amount:50000,tax:NONE,note:'Part payment'});
const trC=tr({date:'2026-10-03',from:'1011',to:'1012',amount:25000,note:'Float'});
Object.assign(trC,M.maConfirmPatch(trC,'ammar',{at:1791000000000}).patch);
const trP=tr({date:'2026-10-06',from:'1011',to:'1012',amount:150000,note:'For the dyer'});
const trD=tr({date:'2026-10-04',from:'1011',to:'1010',amount:10000});
Object.assign(trD,M.maConfirmPatch(trD,'afnan',{at:1791050000000}).patch);   // M1.6a: into the drawer waits; confirmed on paper for Raees
const vOut=M.maApplyVoid(jv('money_out',{date:'2026-10-08',holder:'1011',account:'2010',party:'p_asg',amount:40000,tax:NONE}),{at:1791100000000,by:'afnan',byName:'Afnan',reason:'Entered twice'});
const vTr=M.maApplyVoid(tr({date:'2026-10-09',from:'1011',to:'1012',amount:70000}),{at:1791200000000,by:'ammar',byName:'Ammar',reason:'Wrong day'});
const e0=jv('money_out',{date:'2026-10-07',holder:'1011',account:'6050',payee:'Bilal',amount:12500,tax:{kind:'services',rate:16,inclusive:false}});
const re=(b,amt,reason,by,at)=>M.maApplyEdit(b,M.maBuildDoc('journal',{kind:'money_out',date:'2026-10-07',holder:'1011',account:'6050',payee:'Bilal',amount:amt,tax:{kind:'services',rate:16,inclusive:false}},{by:'afnan'},IDX,S),{at,by,byName:by==='ammar'?'Ammar':'Afnan',reason});
const e2=re(re(e0,13000,'The bill said 13,000','afnan',1791300000000),13500,'And the wire','ammar',1791400000000);
// forty small ones, so the ledger has to break across pages
const many=Array.from({length:40},(_,i)=>jv('money_out',{date:'2026-'+(10+(i%3))+'-'+String(10+(i%18)).padStart(2,'0'),holder:'1011',account:i%2?'6120':'6130',payee:'Shop '+(i+1),amount:1000+i*25,tax:NONE,note:'Item '+(i+1)}));
const docs=[opening,cap,wht,pay,trC,trP,trD,vOut,vTr,e2].concat(many);
const lines=M.maPostAll(docs,IDX,S);
const holders=M.maHolderRows(IDX,lines,docs,{settings:S,mirrorBalances:{'1010':45000}});
const X={idx:IDX,settings:S,lines,docs,parties:[party],commitments:[],holders,people:{afnan:'Afnan',ammar:'Ammar',raees:'Raees'},printedOn:'2026-12-31',printedBy:'Afnan'};
const LEDGER=M.maPdfLedgerData(X,{from:FROM,to:TO,holder:'1011',label:'Q2 FY27'});
const HOLDER=M.maPdfHolderStatementData(X,'1011',RANGE);
const DRAWER=M.maPdfHolderStatementData(X,'1010',RANGE);
const PARTY=M.maPdfPartyStatementData(X,'p_asg',RANGE);
const R_PEND=M.maPdfReceiptData(X,trP);
const R_CONF=M.maPdfReceiptData(X,trC);
const R_VOID=M.maPdfReceiptData(X,vTr);
const V_TAX=M.maPdfVoucherData(X,wht);
const V_NONE=M.maPdfVoucherData(X,pay);
const V_REV=M.maPdfVoucherData(X,e2);
const V_VOID=M.maPdfVoucherData(X,vOut);

/* Every variant that existed before M1.4, with enough data to draw. */
const OLD={
  'generic':{title:'A title',subtitle:'sub',bodyHtml:'<p>Hello</p><p>'+'Long line of body text. '.repeat(300)+'</p>',documentNumber:'X-1',issuedDate:'01/10/2026',issuedBy:'Afnan'},
  'qc-report':{title:'QC',bodyHtml:'<p>body</p>',documentNumber:'Q-1',issuedDate:'01/10/2026',issuedBy:'A'},
  'stock-transfer':{id:'ST-1',documentNumber:'ST-1',poId:'PO-1',poName:'Tee',productCode:'GST001',items:[{size:'S',qty:10},{size:'M',qty:20}],total:30,fromLabel:'Packing',toLabel:'Warehouse',issuedBy:'Afnan',issuedDate:'01/10/2026'},
  'consumable-log':{vendorName:'Amin Gas',monthLabel:'October 2026',unit:'kg',weighed:true,rate:250,rows:Array.from({length:31},(_,i)=>({day:i+1,weekday:'Mon',qty:i%3?12:null,residual:2,net:10,amount:2500,byName:'Raees',note:''})),totalQty:200,totalAmount:50000,daysLogged:20,bill:{amount:50000,date:'31/10/2026',vendorBillAmount:51000,variance:1000},issuedBy:'Raees'},
  'daily-performance':{documentType:'Daily Performance',id:'2026-10-01',date:'2026-10-01',dateLabel:'1 Oct 2026',issuedDate:'1 Oct 2026',issuedBy:'Umair',dispatched:[{courier:'PostEx',shipments:10,amount:25000}],returns:[{courier:'PostEx',shipments:1,amount:2500}],dispatchedTotal:{shipments:10,amount:25000},returnsTotal:{shipments:1,amount:2500}},
  'payslip':{employeeName:'Ali',employeeId:'E1',department:'Stitching',designation:'Tailor',paygrade:'B',monthLabel:'October 2026',basicSalary:30000,grossSalary:32000,netPayable:31000,presentDays:26,lateDays:1,lateAbsentEquivalent:0,actualAbsentDays:0,earnings:[['Basic',30000],['OT',2000]],deductions:[['Advance',1000]]},
  'gate-pass':{documentType:'Gate Pass',documentNumber:'GP-1',id:'GP-1',issuedBy:'Afnan',person:'Driver',destination:'Asghar',gpType:'outward',items:[{name:'Tee',qty:10}],date:'2026-10-01'},
  'po':{documentType:'Production Order',documentNumber:'PO-1',id:'PO-1',poNumber:'PO-1',startDate:'2026-10-01',pattern:'PTN-0001',articleName:'Tee',articleCode:'GST001',sizes:'S-M-L',fabricName:'Jersey',fabricCode:'F1',totalQty:'100',ratio:'1:2:1',issuedBy:'Afnan',issuedDate:'2026-10-01',notes:'Rush'},
  'mood-board':{boardTitle:'Winter',visibility:'team',ownerName:'Afnan',cardCount:3,imageDataUrl:'data:image/jpeg;base64,AAAA',imageW:1600,imageH:900,index:[{kind:'Note',text:'hello'}],indexTruncated:false}
};
const PORTRAIT_ONLY=['stock-transfer','consumable-log','daily-performance','payslip','gate-pass','po','mood-board'];

module.exports=async function(){
  const s=suite('master-accounts-pdf');
  const e=engine();
  const rs=n=>e.run('_prMaRs(null,'+J(n)+')');           // money as drawn in Helvetica (no Aptos in node)
  const day=d=>M.maDayLabel(d,true);

  s.section('the five variants are registered everywhere a variant must be');
  {
    const src=read('js/print-engine.js');
    const known=(/const known = \[([\s\S]*?)\];/.exec(src)||[])[1]||'';
    const fn={'ma-ledger':'_renderMaLedger','ma-statement-party':'_renderMaStatementParty','ma-statement-holder':'_renderMaStatementHolder','ma-receipt':'_renderMaReceipt','ma-voucher':'_renderMaVoucher'};
    MA_TYPES.forEach(t=>{
      s.ok(t+' is in known',known.indexOf("'"+t+"'")>=0);
      s.ok(t+' maps to its own renderer in _VARIANTS',new RegExp("'"+t+"': "+fn[t]+'\\b').test(src)&&e.run('typeof '+fn[t])==='function');
    });
    s.eq('each has a label',J(MA_TYPES.map(t=>e.run('_PRINT_DOC_LABELS['+J(t)+']'))),J(['Ledger','Statement of Account','Holder Statement','Handover Receipt','Payment Voucher']));
    s.eq('each has the plan\'s Urdu level (none · minimal · none · full · full)',J(MA_TYPES.map(t=>e.run('_PRINT_URDU_DEFAULTS['+J(t)+']'))),J(['none','minimal','none','full','full']));
    s.ok('known still ends pattern-label, consumable-log, generic',/'pattern-label', 'consumable-log', 'generic'\]/.test(src));
    for(const [t,data] of [['ma-ledger',LEDGER],['ma-statement-party',PARTY],['ma-statement-holder',HOLDER],['ma-receipt',R_PEND],['ma-voucher',V_TAX]]){
      const p=await print(e,t,data);
      s.ok(t+' draws as itself — no "falling back to generic"',!p.warns.some(w=>/falling back/.test(w)),p.warns.join(' | '));
      s.eq(t+' says what it is in the footer',p.d.log.text.some(x=>x.t.indexOf('GROOVY · '+e.run('_PRINT_DOC_LABELS['+J(t)+']')+' · Internal Use Only')===0),true);
      s.eq(t+' resolves its Urdu level',p.d.__groovyUrduLevel,e.run('_PRINT_URDU_DEFAULTS['+J(t)+']'));
    }
  }

  s.section('the page each asks for — landscape ledger, portrait statements, A5 slips');
  {
    const L=await print(e,'ma-ledger',LEDGER);
    s.eq('ma-ledger constructs A4 LANDSCAPE',J(L.made),J({unit:'pt',format:'a4',orientation:'landscape'}));
    s.eq('…and lays out on the landscape page (842 × 595)',J([L.d.__groovyPage&&L.d.__groovyPage.pageWidth,L.d.__groovyPage&&L.d.__groovyPage.pageHeight,L.d.__groovyPage&&L.d.__groovyPage.contentWidth]),J([842,595,770]));
    s.ok('…every word inside 842 × 595',L.d.log.text.every(t=>t.x>=0&&t.x<=842&&t.y>=0&&t.y<=595));
    s.ok('…and it uses the width: the balance column sits past x = 780',L.d.log.text.some(t=>t.align==='right'&&t.x>780));
    const lp=L.d.log.pages;
    s.ok('…the ledger breaks across pages ('+lp+')',lp>=2);
    s.ok('…the footer is stamped on every landscape page at y = 559, never at 806',
      Array.from({length:lp},(_,i)=>i+1).every(p=>L.d.log.text.some(t=>t.page===p&&t.t==='Page '+p+' of '+lp&&t.y===559))&&!L.d.log.text.some(t=>/^Page \d+ of/.test(t.t)&&t.y===806));
    const G=await print(e,'generic',{title:'x',orientation:'landscape'});
    s.eq('data.orientation:"landscape" works for any landscape-ready type (generic)',J(G.made),J({unit:'pt',format:'a4',orientation:'landscape'}));
    s.ok('…with its footer on the landscape page',G.d.log.text.some(t=>t.t==='Page 1 of 1'&&t.y===559));
    for(const [t,data] of [['ma-statement-party',PARTY],['ma-statement-holder',HOLDER]]){
      const p=await print(e,t,data);
      s.eq(t+' constructs A4 portrait',J(p.made),J({unit:'pt',format:'a4'}));
      s.ok(t+' lays out on the portrait page (no landscape box)',!p.d.__groovyPage);
      s.ok(t+' — every word inside 595 × 842',p.d.log.text.every(x=>x.x>=0&&x.x<=595&&x.y>=0&&x.y<=842));
      s.ok(t+' — the A4 footer on every page at y = 806',Array.from({length:p.d.log.pages},(_,i)=>i+1).every(q=>p.d.log.text.some(x=>x.page===q&&x.t==='Page '+q+' of '+p.d.log.pages&&x.y===806)));
    }
    for(const [t,data,label] of [['ma-receipt',R_PEND,'Handover Receipt'],['ma-voucher',V_TAX,'Payment Voucher']]){
      const p=await print(e,t,data);
      s.eq(t+' constructs A5 (420 × 595)',J(p.made),J({unit:'pt',format:[420,595],orientation:'portrait'}));
      s.ok(t+' — every word inside 420 × 595',p.d.log.text.every(x=>x.x>=0&&x.x<=420&&x.y>=0&&x.y<=595));
      s.ok(t+' — no A4 footer (nothing at y = 806, no "Confidential" line)',!p.d.log.text.some(x=>x.y===806)&&!p.d.log.text.some(x=>/Confidential/.test(x.t)));
      s.ok(t+' — its own footer: the page count and the Internal Use line at y = 575',p.d.log.text.some(x=>x.t==='Page 1 of 1'&&x.y===575)&&p.d.log.text.some(x=>x.t==='GROOVY · '+label+' · Internal Use Only'&&x.y===575&&x.align==='right'));
      const L2=await print(e,t,Object.assign({},data,{orientation:'landscape'}));
      s.eq(t+' stays A5 even when asked landscape',J(L2.made),J({unit:'pt',format:[420,595],orientation:'portrait'}));
    }
  }

  s.section('every variant that existed before M1.4 still constructs A4 portrait');
  {
    for(const t of Object.keys(OLD)){
      const p=await print(e,t,clone(OLD[t]));
      s.eq(t+' → {unit:"pt", format:"a4"}, exactly as before',J(p.made),J({unit:'pt',format:'a4'}));
      s.ok(t+' — the A4 footer at y = 806 on page 1, and no landscape box',p.d.log.text.some(x=>x.t==='Page 1 of '+p.d.log.pages&&x.y===806&&x.page===1)&&!p.d.__groovyPage);
    }
    for(const t of PORTRAIT_ONLY){
      const p=await print(e,t,Object.assign(clone(OLD[t]),{orientation:'landscape'}));
      s.eq(t+' asked for landscape still constructs A4 portrait',J(p.made),J({unit:'pt',format:'a4'}));
      s.ok(t+' …and says so in the console instead of drawing off the page',p.warns.some(w=>w.indexOf(t)>=0&&/landscape/.test(w)),p.warns.join(' | '));
    }
    const lab={page:{w:360,h:432},labels:[{code:'PTN-0001',name:'Tee block',category:'Tops',fit:'Regular',size:'M',sizes:['S','M','L'],hook:3,slot:2,articles:['GST001'],measurements:[{label:'Chest',value:'20'}],qr:[[true,false],[false,true]],url:'https://x',printedOn:'1 Oct',gridUpdated:'1 Oct',tol:0.5}]};
    const pl=await print(e,'pattern-label',lab);
    s.eq('pattern-label is still its own custom page, unchanged',J(pl.made),J({unit:'pt',format:[360,432],orientation:'portrait'}));
    s.ok('…and still gets no A4 footer',!pl.d.log.text.some(x=>/^Page \d+ of/.test(x.t)));
  }

  s.section('the ledger — its head repeats on every page, and it prints what it is handed');
  {
    const {d}=await print(e,'ma-ledger',LEDGER);
    const HEAD=['Date','No.','Kind','Party / holder','Particulars','Debit','Credit','Balance'];
    const rowNos=new Set(LEDGER.rows.map(r=>r.no));
    const rowPages=pagesWith(d,t=>rowNos.has(t.t));
    s.ok('the rows run over '+rowPages.length+' pages',rowPages.length>=2);
    s.ok('the whole head is drawn on every page that carries rows',rowPages.every(p=>HEAD.every(h=>d.log.text.some(t=>t.page===p&&t.t===h))));
    s.eq('…once per page, no more',count(d,'Particulars'),rowPages.length);
    s.ok('…above that page\'s first row',rowPages.every(p=>{const h=d.log.text.find(t=>t.page===p&&t.t==='Debit');return !!h&&d.log.text.filter(t=>t.page===p&&rowNos.has(t.t)).every(t=>t.y>h.y);}));
    s.ok('a continued page names what it continues',rowPages.slice(1).every(p=>d.log.text.some(t=>t.page===p&&/^1011 · Cash — with Afnan .*— continued$/.test(t.t))));
    s.ok('every row\'s number is drawn exactly once',LEDGER.rows.every(r=>count(d,r.no)===1));
    s.ok('its dates are the screen\'s (Tue 20 Oct 2026)',LEDGER.rows.every(r=>d.log.text.some(t=>t.t===day(r.date))));
    s.ok('every running balance is drawn, right-aligned, as handed over',LEDGER.rows.every(r=>d.log.text.some(t=>t.t===rs(r.balance)&&t.align==='right')));
    const X2=d.log.text;
    s.ok('the opening row carries the opening balance',X2.some(t=>t.t==='Opening balance')&&X2.some(t=>t.t===rs(LEDGER.opening)&&t.align==='right'));
    s.ok('the totals row counts the postings',X2.some(t=>t.t==='Period totals · '+LEDGER.totals.count+' postings'));
    s.ok('the closing row carries the closing balance',X2.some(t=>t.t==='Closing balance')&&X2.filter(t=>t.t===rs(LEDGER.closing)).length>=2);
    s.ok('amounts are in lakh grouping (Rs 5,00,000), never thousands (500,000)',X2.some(t=>t.t===rs(500000)&&/5,00,000$/.test(t.t))&&!X2.some(t=>/\b\d{3},\d{3}\b/.test(t.t)));
    s.ok('a void document is not on it',![vOut.no,vTr.no].some(n=>X2.some(t=>t.t===n))&&!X2.some(t=>/VOID/.test(t.t)));
    s.ok('a handover still waiting to be confirmed is not on it',!X2.some(t=>t.t===trP.no));
    // The engine computes nothing: hand it figures that do not add up and it prints them as they are.
    const lie=clone(LEDGER);lie.totals.dr=123;lie.closing=7;lie.rows[0].balance=-75000;
    const {d:d2}=await print(e,'ma-ledger',lie);
    const totRow=d2.log.text.find(t=>/^Period totals · /.test(t.t));
    const totCells=totRow?d2.log.text.filter(t=>t.page===totRow.page&&Math.abs(t.y-totRow.y)<0.01&&t.align==='right'&&t.t).map(t=>t.t):[];
    s.eq('it prints the totals it is handed, not a sum of its own',J(totCells),J([rs(123),rs(LEDGER.totals.cr)]));
    s.ok('…and the closing it is handed',d2.log.text.filter(t=>t.t===rs(7)).length>=2);
    s.ok('a negative balance prints as the screen shows it, with its minus',d2.log.text.some(t=>t.t==='-Rs 75,000'&&t.align==='right'));
    const empty=Object.assign(clone(LEDGER),{rows:[],totals:{dr:0,cr:0,count:0}});
    const {d:d3}=await print(e,'ma-ledger',empty);
    s.ok('an empty period says so instead of an empty table',prose(d3).indexOf('Nothing was posted to this account in the period.')>=0&&d3.log.text.some(t=>t.t==='Period totals · 0 postings'));
  }

  s.section('M1.6b — the ledger draws no running balance when the core hides it (money F4/F5)');
  {
    // Under a narrowing filter: the core hides it, the engine draws none.
    const NAR=M.maPdfLedgerData(X,{from:FROM,to:TO,holder:'1011',party:'p_asg',label:'Q2 FY27'});
    s.eq('(the core hides it under a party filter)',J([NAR.opening,NAR.closing,NAR.balanceHidden&&NAR.balanceHidden.narrow]),J([null,null,['party']]));
    const {d}=await print(e,'ma-ledger',NAR);
    const T=texts(d);
    s.ok('no Balance column, no opening row, no closing row',!T.some(t=>t==='Balance'||t==='Opening balance'||t==='Closing balance'));
    s.ok('no Opening or Closing figure either',!T.some(t=>t==='Opening'||t==='Closing'));
    s.ok('…and it says why, in the words the page uses',prose(d).indexOf('Balance hidden while filtered by party — a balance over some of an account’s lines is not its balance.')>=0,prose(d).slice(0,300));
    s.ok('its rows are drawn, with their debits and credits',NAR.rows.length>0&&NAR.rows.every(r=>count(d,r.no)===1));
    // The drawer: Store Accounts' balance, or "not read".
    const DR=M.maPdfLedgerData(X,{from:FROM,to:TO,holder:'1010',label:'Q2 FY27'});
    s.eq('(the core hides the drawer\'s, and hands over Store Accounts\' figure)',J([DR.opening,DR.closing,DR.balanceHidden&&DR.balanceHidden.mirror,DR.balanceHidden&&DR.balanceHidden.mirrorBalance]),J([null,null,'store',45000]));
    const {d:dd}=await print(e,'ma-ledger',DR);
    const TD=texts(dd);
    s.ok('the drawer\'s ledger: no Balance column and no opening or closing',!TD.some(t=>t==='Balance'||t==='Opening balance'||t==='Closing balance'));
    s.ok('…but Store Accounts\' balance, as a figure',TD.indexOf('Balance in Store Accounts')>=0&&TD.indexOf(rs(45000))>=0);
    const {d:dn}=await print(e,'ma-ledger',Object.assign(clone(DR),{balanceHidden:Object.assign({},DR.balanceHidden,{mirrorBalance:null})}));
    s.ok('…and "not read", never a zero, when that read failed',texts(dn).indexOf('not read')>=0);
    const {d:dw}=await print(e,'ma-ledger',LEDGER);
    s.ok('(a whole account keeps its Balance column and both balances)',['Balance','Opening balance','Closing balance'].every(h=>texts(dw).indexOf(h)>=0));
  }

  s.section('the statements — the holder\'s and the party\'s');
  {
    const {d}=await print(e,'ma-statement-holder',HOLDER);
    const T=texts(d);
    // (a handover is a movement AND a confirmation: it is drawn in both tables)
    const confNos=new Set(HOLDER.confirmations.map(c=>c.no));
    const rowNos=new Set(HOLDER.rows.map(r=>r.no).filter(n=>!confNos.has(n)));
    const rp=pagesWith(d,t=>rowNos.has(t.t));
    s.ok('the holder statement breaks too, and its head repeats ('+rp.length+' pages)',rp.length>=2&&rp.every(p=>['Date','No.','Particulars','In','Out','Balance'].every(h=>d.log.text.some(t=>t.page===p&&t.t===h))),J(rp));
    s.ok('every movement is drawn once (a confirmed handover once more, in Confirmations)',HOLDER.rows.every(r=>count(d,r.no)===(confNos.has(r.no)?2:1)));
    s.ok('opening, money in, money out and closing are the handed-over figures',[HOLDER.opening,HOLDER.totals.in,HOLDER.totals.out,HOLDER.closing].every(n=>T.indexOf(rs(n))>=0));
    s.ok('the confirmations list the waiting and the confirmed handovers',T.some(t=>t===trP.no)&&T.some(t=>t===trC.no)&&T.some(t=>/^Waiting for Ammar/.test(t))&&T.some(t=>/^Confirmed by Ammar/.test(t)));
    s.ok('what is waiting now is said, only the sides that are not zero',T.some(t=>/^Waiting now: Rs 1,50,000 out/.test(t))&&!T.some(t=>/Rs 0 in/.test(t)));
    s.ok('the last count, 500 short',T.some(t=>/^Counted Rs .* short against the book\.$/.test(t))||T.some(t=>/never been counted/.test(t)));
    s.ok('a void handover is not a movement',!T.some(t=>t===vTr.no));
    const {d:dd}=await print(e,'ma-statement-holder',DRAWER);
    const TD=texts(dd);
    s.ok('the mirrored drawer prints no opening, closing or running balance',!TD.some(t=>t==='Opening balance'||t==='Closing balance'||t==='Balance'));
    s.ok('…but Store Accounts\' own balance, as a figure',TD.some(t=>t==='Balance in Store Accounts')&&TD.indexOf(rs(45000))>=0);
    const {d:dn}=await print(e,'ma-statement-holder',Object.assign(clone(DRAWER),{mirrorBalance:null}));
    s.ok('…and "not read" — never a zero — when that read failed',texts(dn).indexOf('not read')>=0);
    const {d:dp}=await print(e,'ma-statement-party',PARTY);
    const TP=texts(dp);
    s.ok('the party statement: name, code, terms and phone under the title',TP.some(t=>t==='Asghar Printers')&&TP.some(t=>/ASG/.test(t)&&/Credit 30 days/.test(t)&&/0300 1234567/.test(t)));
    s.ok('opening and closing say which side (Cr — Groovy owes them)',PARTY.opening>0&&PARTY.closing>0&&TP.indexOf(rs(PARTY.opening)+' Cr')>=0&&TP.indexOf(rs(PARTY.closing)+' Cr')>=0,J([PARTY.opening,PARTY.closing]));
    s.ok('their account and what was paid directly are two sections',TP.indexOf('THEIR ACCOUNT')>=0||TP.some(t=>/their account/i.test(t)));
    s.ok('paid directly: the withholding purchase, at the cash that moved',TP.some(t=>t===wht.no)&&TP.indexOf(rs(96000))>=0);
    s.ok('a void document never reaches it',!TP.some(t=>t===vOut.no));
  }

  s.section('the slips — the receipt and the voucher');
  {
    const {d}=await print(e,'ma-receipt',R_PEND);
    const T=texts(d);
    s.ok('the receipt: its title, number and date',T.indexOf('Handover receipt')>=0&&T.indexOf(trP.no)>=0&&T.indexOf(day(trP.date))>=0);
    s.ok('the amount in figures and in words',T.indexOf(rs(150000))>=0&&T.indexOf('Rupees One Lakh Fifty Thousand Only')>=0);
    s.ok('from and to, with whose hands',T.indexOf('Cash — with Afnan (Afnan)')>=0&&T.indexOf('Cash — with Ammar (Ammar)')>=0);
    s.ok('pending: who it waits for, and that it counts nowhere yet',T.some(t=>/^Waiting for Ammar to confirm/.test(t))&&T.some(t=>/neither holder/.test(t)));
    s.ok('the note',T.indexOf('For the dyer')>=0);
    s.ok('two signature blocks: given by, received by — each under its line',T.indexOf('Given by')>=0&&T.indexOf('Received by')>=0&&d.log.line.filter(l=>l.y1===l.y2&&l.y1===595-24-36-72+28).length===2);
    const {d:dc}=await print(e,'ma-receipt',R_CONF);
    s.ok('confirmed: by whom and how',texts(dc).some(t=>/^Confirmed by Ammar in the app/.test(t)));
    const {d:dv}=await print(e,'ma-voucher',V_TAX);
    const V=texts(dv);
    s.ok('the voucher: title, number, paid to (with code), paid from, for',V.indexOf('Payment voucher')>=0&&V.indexOf(wht.no)>=0&&V.indexOf('Asghar Printers (ASG)')>=0&&V.indexOf('Cash — with Afnan (Afnan)')>=0&&V.indexOf('5030 · Embellishment')>=0);
    s.ok('the figure is the cash paid, with its words',V.indexOf(rs(96000))>=0&&V.indexOf('Rupees Ninety Six Thousand Only')>=0);
    s.ok('the tax block, because its kind is not none',V.indexOf('Tax')>=0&&V.some(t=>/^Withholding 4% on Rs 1,00,000: Rs 4,000 withheld/.test(t)));
    s.ok('one signature: received by — never given by',V.indexOf('Received by')>=0&&V.indexOf('Given by')<0);
    const {d:dn}=await print(e,'ma-voucher',V_NONE);
    s.ok('"No tax" → no tax row at all',texts(dn).indexOf('Tax')<0&&!texts(dn).some(t=>/withheld|on top of|included in/.test(t)));
    const {d:dr}=await print(e,'ma-voucher',V_REV);
    s.ok('tax on top reads as on top',prose(dr).indexOf('Services tax 16% on top of Rs 13,500: Rs 2,160.')>=0);
    s.ok('a payee who is no party is named as typed',texts(dr).indexOf('Bilal')>=0);
  }

  s.section('VOID and "Revised · rev N" — drawn exactly when they are true');
  {
    const red=e.run('_pc(PRINT_COLORS.red).join(",")');
    const {d:v}=await print(e,'ma-receipt',R_VOID);
    const T=texts(v);
    s.ok('a void receipt carries VOID in its stamp and on every page\'s footer',count(v,'VOID')>=2&&v.log.text.some(t=>t.t==='VOID'&&t.size===26));
    s.ok('…with who, when and why',T.some(t=>/^Voided .* by Ammar\.$/.test(t))&&T.indexOf('Reason: Wrong day')>=0&&T.indexOf('It moves no money.')>=0);
    s.ok('…inside a red box',v.log.rect.some(r=>r.st==='S'&&r.draw===red));
    const amt=v.log.text.find(t=>t.t===rs(70000)&&t.size===24);
    s.ok('…and its figure struck through in red, so it can never read as live',!!amt&&v.log.line.some(l=>l.draw===red&&l.y1===l.y2&&l.y1<amt.y&&l.y1>amt.y-20&&l.x1<=amt.x&&l.x2>amt.x));
    const {d:vv}=await print(e,'ma-voucher',V_VOID);
    s.ok('a void voucher the same',count(vv,'VOID')>=2&&texts(vv).indexOf('Reason: Entered twice')>=0);
    for(const [name,data] of [['a pending receipt',R_PEND],['a confirmed receipt',R_CONF],['a live voucher',V_TAX]]){
      const {d:x}=await print(e,name.indexOf('receipt')>=0?'ma-receipt':'ma-voucher',data);
      s.ok(name+' carries no VOID and no red strike',!x.log.text.some(t=>/VOID/.test(t.t))&&!x.log.line.some(l=>l.draw===red));
    }
    const {d:r2}=await print(e,'ma-voucher',V_REV);
    // rev N is maRevOf (edits + 1) — the number the rail shows. Until M1.5b
    // the paper printed the edit count, one less than the screen.
    s.ok('edited twice → "Revised · rev 3", the rail\'s number',texts(r2).indexOf('Revised · rev 3')>=0&&e2.edits.length===2);
    s.ok('… and never the edit count',texts(r2).indexOf('Revised · rev 2')<0);
    s.ok('…with the last edit\'s who and why',texts(r2).some(t=>/by Ammar — And the wire$/.test(t)));
    const {d:r0}=await print(e,'ma-voucher',V_TAX);
    s.ok('never edited → no revision mark at all',!texts(r0).some(t=>/Revised|rev \d/.test(t)));
    const once=M.maPdfVoucherData(X,re(e0,13000,'Typo','afnan',1791300000000));
    const {d:r1}=await print(e,'ma-voucher',once);
    s.ok('edited once → "Revised · rev 2" (rev N = maRevOf: the edits it carries + 1)',texts(r1).indexOf('Revised · rev 2')>=0&&texts(r1).indexOf('Revised · rev 1')<0);
    const {d:led}=await print(e,'ma-ledger',LEDGER);
    s.ok('a ledger never carries a stamp (void documents are simply not on it)',!led.log.text.some(t=>/VOID|Revised/.test(t.t)));
  }

  s.section('Urdu — drawn only by a font that can draw it, never tofu');
  {
    const {d}=await print(e,'ma-receipt',R_PEND);
    s.ok('no Urdu font in node → the receipt asks for "full" and gets clean English',d.__groovyUrduLevel==='full'&&d.__groovyUrdu===false&&!d.log.text.some(t=>ARABIC.test(t.t)));
    const {d:v}=await print(e,'ma-voucher',V_VOID);
    s.ok('…so does a void voucher',!v.log.text.some(t=>ARABIC.test(t.t)));
    const {d:h}=await print(e,'ma-statement-party',PARTY);
    s.ok('a statement never draws Urdu',!h.log.text.some(t=>ARABIC.test(t.t)));
    // A font that CAN draw every character jsPDF will emit, and one that cannot.
    const slip=(glyph,fn,data)=>{
      e.run(`__slip=new FakePDF({unit:'pt',format:[420,595],orientation:'portrait'});
        __slip.__groovyUrdu=true;__slip.__groovyUrduLevel='full';
        __slip.__groovyFonts={[PRINT_FONTS.bodyRegular]:'helvetica',[PRINT_FONTS.display]:'helvetica',[PRINT_FONTS.urdu]:'JNN'};
        __slip.getFont=()=>({metadata:{characterToGlyph:()=>${glyph}}});
        __slip.processArabic=s=>s;`);
      e.run(`__slip.__groovyDocType=${J(fn==='_renderMaReceipt'?'Handover Receipt':'Payment Voucher')};${fn}(__slip,${J(data)})`);
      return e.run('__slip');
    };
    const ok=slip(7,'_renderMaReceipt',R_PEND);
    const ur=ok.log.text.filter(t=>ARABIC.test(t.t));
    s.ok('a font that has the glyphs → the receipt turns bilingual',ur.length>=10);
    s.ok('…its title, labels and signatures in Urdu',['رقم حوالگی کی رسید','رقم','منجانب','بنام','دینے والا','وصول کنندہ'].every(w=>ur.some(t=>t.t===w)));
    s.ok('…and the footer\'s Urdu tail',ur.some(t=>t.t==='رسید — صرف اندرونی استعمال'));
    s.ok('…every Urdu word in the Urdu font, never Helvetica',ur.every(t=>t.font==='JNN'));
    const okV=slip(7,'_renderMaVoucher',V_VOID);
    s.ok('the voucher too, and منسوخ under VOID',okV.log.text.some(t=>t.t==='ادائیگی واؤچر')&&okV.log.text.some(t=>t.t==='منسوخ'));
    const no=slip(0,'_renderMaReceipt',R_PEND);
    s.ok('a font that embedded but lacks the glyphs → no Urdu at all, not boxes',!no.log.text.some(t=>ARABIC.test(t.t)));
    s.ok('…and the English is all still there',['Handover receipt','Amount','From','To','Given by','Received by'].every(w=>no.log.text.some(t=>t.t===w)));
  }

  s.section('deliver:"blob" — no tab, no download, it resolves; a failure rejects');
  {
    const e2x=engine({URL:{createObjectURL:()=>'blob:groovy/1',revokeObjectURL(){}}});
    const toasts=e2x.state.toasts;
    const r=await e2x.run('window.printDocument({type:"ma-receipt",data:'+J(R_PEND)+',filename:"Receipt-TR-27-0006.pdf",deliver:"blob"})');
    s.eq('it resolves {blob, filename}',J(Object.keys(r||{}).sort()),J(['blob','filename']));
    s.eq('…the filename it was given',r&&r.filename,'Receipt-TR-27-0006.pdf');
    s.ok('…and the bytes jsPDF serialised',!!(r&&r.blob&&r.blob.fake===true&&r.blob.size===4096));
    s.eq('no tab was opened',e2x.run('__open'),0);
    s.eq('nothing was downloaded (no link clicked, nothing saved)',J([e2x.run('__clicks.length'),e2x.run('__docs[0].log.saved')]),J([0,null]));
    s.eq('no toast',toasts.length,0);
    const r2=await e2x.run('window.printDocument({type:"ma-receipt",data:'+J(R_PEND)+',filename:"x.pdf"})');
    s.eq('without it, the old path: the preview tab is opened',e2x.run('__open'),1);
    s.eq('…and shows the PDF',e2x.run('__wins[0].location'),'blob:groovy/1');
    s.eq('…the file is downloaded under its name, from the same blob',e2x.run('JSON.stringify(__clicks)'),J([{href:'blob:groovy/1',download:'x.pdf'}]));
    s.ok('…it says so',toasts.some(t=>/PDF generated/.test(t)));
    s.eq('…and resolves nothing, as before',r2,undefined);
    const e3x=engine();
    await e3x.run('window.printDocument({type:"ma-voucher",data:'+J(V_TAX)+',filename:"y.pdf"})');
    s.eq('where a blob: URL cannot be made, the old path still saves the file itself',e3x.run('__docs[0].log.saved'),'y.pdf');
    e2x.run('__throwOn="Rupees One Lakh"');
    let err=null;
    try{await e2x.run('window.printDocument({type:"ma-receipt",data:'+J(R_PEND)+',deliver:"blob"})');}catch(x){err=x;}
    s.ok('a render that fails REJECTS, with the reason',!!err&&/drawing failed/.test(String(err.message)));
    s.eq('…having opened no tab',e2x.run('__open'),1);
    e2x.run('__throwOn=null;window.jspdf=null');
    let err2=null;
    try{await e2x.run('window.printDocument({type:"ma-ledger",data:{},deliver:"blob"})');}catch(x){err2=x;}
    s.ok('no jsPDF → it rejects saying so, instead of a toast',!!err2&&/PDF library not loaded/.test(String(err2.message)));
    const n=toasts.length;
    const r3=await e2x.run('window.printDocument({type:"ma-ledger",data:{}})');
    s.ok('…while the old path still toasts and resolves',r3===undefined&&toasts.length===n+1);
  }

  s.section('money and dates are drawn the way the screen shows them');
  {
    const aptos='({__groovyFonts:{[PRINT_FONTS.bodyRegular]:PRINT_FONTS.bodyRegular,[PRINT_FONTS.display]:PRINT_FONTS.display,[PRINT_FONTS.urdu]:"helvetica"}})';
    const NS=[0,5,999,1000,99999,100000,150000,1234567,9999999,10000000,123456789012,-2500,-150000];
    s.ok('lakh grouping is maGroup\'s, digit for digit',NS.every(n=>e.run('_prMaGroup('+n+')')===M.maGroup(n)));
    s.ok('with Aptos embedded, every amount is maRs\'s exactly (₨, and − for a minus)',NS.every(n=>e.run('_prMaRs('+aptos+','+n+')')===M.maRs(n)));
    s.eq('in Helvetica (no ₨, no −) it falls back to Rs and a hyphen',e.run('_prMaRs(null,-75000)'),'-Rs 75,000');
    s.ok('dates are maDayLabel(day, true)\'s',['2026-07-01','2026-10-20','2026-12-31','2027-02-28','2028-02-29'].every(x=>e.run('_prMaDay('+J(x)+')')===M.maDayLabel(x,true)));
    s.eq('a party balance names its side',J([e.run('_prMaSide(null,140000)'),e.run('_prMaSide(null,-500)'),e.run('_prMaSide(null,0)')]),J(['Rs 1,40,000 Cr','Rs 500 Dr','Rs 0']));
  }

  return s;
};

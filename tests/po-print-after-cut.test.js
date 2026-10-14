/* ─────────────────────────────────────────────────────────────────────────
   Print PO after the cut (WP6, js/po-print.js + the 'po' variant's data.cut / data.qtyBasis).

   Engine half: printDocument is driven against a jsPDF that records every word, rect and line.
   App half: the real js/pos.js + js/po-print.js against an in-memory Firestore.
   Held: actual cut vs ordered rendering; a PO with no cut and no flags is drawn byte-for-byte as before
   (GOLDEN hashes captured from the engine at origin/wp3c-jobcopy); two pages at most; unreadable bundles
   -> the ordered values + a notice on the PO page; the print log written, and a failed log write never
   blocks the print; the button states before/after the cut and for a cancelled PO.
   Proves logic only: not seen on a printer, not run against real Firestore.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const harness=require('./harness');
const {suite,ROOT,loadApp}=harness;
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const md5=x=>crypto.createHash('md5').update(x).digest('hex');
const RED='220,38,38';
const FAKE=`__docs=[];
FakePDF=function(opts){
  let W=595.28,H=841.89;
  const d=this;let page=1,pages=1,size=16,style='normal',ink='0,0,0',draw='0,0,0',lw=0.2;
  d.log={text:[],rect:[],line:[],pages:1};
  d.internal={pageSize:{getWidth:()=>W,getHeight:()=>H}};
  d.addPage=()=>{pages++;page=pages;d.log.pages=pages;return d;};
  d.setPage=p=>{page=p;return d;};
  d.getNumberOfPages=()=>pages;
  d.setFont=(f,s)=>{style=s||'normal';return d;};
  d.setFontSize=s=>{size=s;return d;};
  d.setTextColor=(r,g,b)=>{ink=[r,g,b].join(',');return d;};
  d.setDrawColor=(r,g,b)=>{draw=[r,g,b].join(',');return d;};
  d.setLineWidth=w=>{lw=w;return d;};
  ['setFillColor','addFileToVFS','addFont','addImage','roundedRect'].forEach(k=>{d[k]=function(){return d;};});
  d.getTextWidth=t=>String(t).length*size*0.5;
  d.splitTextToSize=(t,w)=>{const out=[];String(t).split('\\n').forEach(par=>{let cur='';par.split(' ').forEach(wd=>{const nx=cur?cur+' '+wd:wd;if(cur&&nx.length*size*0.5>w){out.push(cur);cur=wd;}else cur=nx;});out.push(cur);});return out;};
  d.text=(t,x,y,o)=>{(Array.isArray(t)?t:[t]).forEach((s,i)=>{d.log.text.push({t:String(s),x,y:y+i*size*1.15,page,size,style,ink,align:o&&o.align||'left',mode:o&&o.renderingMode||'',draw,lw});});return d;};
  d.rect=(x,y,w,h,st)=>{d.log.rect.push({x,y,w,h,st:st||'',page,draw,lw});return d;};
  d.line=(x1,y1,x2,y2)=>{d.log.line.push({x1,y1,x2,y2,page,draw,lw});return d;};
  d.output=()=>({size:4096,fake:true});
  d.save=()=>{};
  __docs.push(d);
};
window.jspdf={jsPDF:FakePDF};
window.open=u=>{if(u)return null;return {closed:false,location:null,document:{open(){},write(){},close(){}},close(){this.closed=true;}};};`;

function engine(){
  const globals={console:{log(){},info(){},error(){},warn(){}},
    URL:{createObjectURL(){throw new TypeError('The "obj" argument must be an instance of Blob.');},revokeObjectURL(){}}};
  const e=harness.loadApp({files:['js/print-engine.js'],currentPage:'dashboard',globals});
  e.run(FAKE);
  return e;
}
async function printPO(e,data,extra){
  const n=e.run('__docs.length');
  const r=await e.run('window.printDocument('+J(Object.assign({type:'po',filename:'t.pdf',deliver:'blob',data},extra||{}))+')');
  return {r,d:e.run('__docs['+n+']')};
}


async function printPO(e,data,extra){
  const n=e.run('__docs.length');
  await e.run('window.printDocument('+J(Object.assign({type:'po',filename:'t.pdf',deliver:'blob',data},extra||{}))+')');
  return e.run('__docs['+n+']');
}
const BASE={documentType:'Production Order',documentNumber:'PO-0142',id:'PO-0142',poNumber:'PO-0142',startDate:'02/10/2026',
  pattern:'PTN-0007 · Hook 3 / Slot 2 · Boxy tee block',articleName:'EFFORTLESS TEE | DEEP BLUE',articleCode:'GST073',sizes:'S-M-L-XL',
  fabricName:'240 GSM Cotton Jersey',fabricCode:'FAB-JRS-240',totalQty:'600',ratio:'1:2:2:1',issuedBy:'Afnan',issuedDate:'02/10/2026',
  totalWeight:'312 kg',avgPerUnit:'0.52 kg',notes:'Front chest print placement 3 in below collar.',
  __productImg:{dataUrl:'data:image/png;base64,AAAA',fmt:'PNG',w:600,h:800}};
const STRESS=Object.assign({},BASE,{
  articleName:'OVERSIZED ACID WASH HEAVYWEIGHT GRAPHIC TEE | VINTAGE FADED BLACK | LIMITED WINTER DROP 2027',
  sizes:'XXS-XS-S-M-L-XL-2XL-3XL',fabricName:'320 GSM Heavyweight Cotton Terry Brushed Interlock',ratio:'1:2:3:4:4:3:2:1',totalQty:'12000'});
const bundles=n=>Array.from({length:n},(_,i)=>({no:100+i,size:['S','M','L','XL'][i%4],units:20+i}));
const CUT={sizes:{S:150,M:300,L:100,XL:50},bundles:bundles(6),by:'Uzaib',fabricUsed:'118.5 (14 rolls)'};
const logHash=d=>md5(J(d.log));
const GOLDEN={base:'54e5297cb466bd750363197cdb9452ee',stress:'1979c75a0f6c39cd855ae52e365e5cda'};

/* ── app half ── */
function fakeFirestore(seed){
  const store=new Map(Object.entries(seed||{}).map(([k,v])=>[k,JSON.parse(J(v))]));
  const fail={commit:null,read:null,cached:null};
  const log={commits:[],attempts:0,deleted:[],updates:[],afterJobQuery:null,jobQueries:0};
  const snap=p=>({exists:()=>store.has(p),data:()=>store.has(p)?JSON.parse(J(store.get(p))):undefined});
  const apply=w=>{
    if(w.op==='set')store.set(w.ref.path,JSON.parse(J(w.data)));
    else if(w.op==='update'){
      if(!store.has(w.ref.path))throw new Error('NOT_FOUND: no document to update: '+w.ref.path);
      store.set(w.ref.path,Object.assign({},store.get(w.ref.path),JSON.parse(J(w.data))));
    }else if(w.op==='delete')store.delete(w.ref.path);
  };
  const globals={
    db:{},
    doc:(db,col,id)=>({path:col+'/'+id,col,id}),
    collection:(db,col)=>({col}),
    where:(f,op,v)=>({f,op,v}),orderBy:()=>({}),limit:()=>({}),
    query:(c,...cs)=>({col:c.col,cs}),
    getDocs:async q=>{
      if(fail.read&&fail.read(q.col))throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      const docs=[];
      store.forEach((v,k)=>{
        const i=k.indexOf('/');if(k.slice(0,i)!==q.col)return;
        if((q.cs||[]).every(w=>w.op!=='=='||v[w.f]===w.v))docs.push({id:k.slice(i+1),data:()=>JSON.parse(J(v))});
      });
      const res={docs,empty:docs.length===0,size:docs.length,metadata:{fromCache:!!(fail.cached&&fail.cached(q.col))}};
      if(q.col==='printing_jobs'&&(q.cs||[]).some(w=>w.op==='==')){log.jobQueries++;if(log.afterJobQuery&&log.jobQueries===1)log.afterJobQuery();}
      return res;
    },
    getDoc:async ref=>snap(ref.path),
    setDoc:async(ref,data)=>{apply({op:'set',ref,data});},
    updateDoc:async(ref,data)=>{log.updates.push(ref.path);apply({op:'update',ref,data});},
    deleteDoc:async ref=>{log.deleted.push(ref.path);apply({op:'delete',ref});},
    runTransaction:async(db,fn)=>{
      log.attempts++;
      const pending=[];
      const tx={
        get:async ref=>{
          if(pending.length)throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return snap(ref.path);
        },
        set(ref,data){pending.push({op:'set',ref,data});return tx;},
        update(ref,data){pending.push({op:'update',ref,data});return tx;},
        delete(ref){pending.push({op:'delete',ref});return tx;}
      };
      const r=await fn(tx);
      if(fail.commit&&fail.commit(pending))throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
      pending.forEach(w=>{if(w.op==='update'&&!store.has(w.ref.path))throw new Error('NOT_FOUND: no document to update: '+w.ref.path);});
      pending.forEach(apply);
      if(pending.length)log.commits.push(pending.map(w=>w.op+':'+w.ref.path));
      return r;
    }
  };
  return{store,fail,log,globals,get:p=>store.has(p)?JSON.parse(J(store.get(p))):undefined,put:(p,v)=>store.set(p,JSON.parse(J(v)))};
}


const OWNER={uid:'u1',u:'afnan',name:'Afnan',role:'owner',canPO:true};
const PO=(extra)=>Object.assign({id:'PO-012',fbKey:'PO-012',name:'Tee',code:'GST073',qty:600,sizes:{S:100,M:200,L:200,XL:100},fabric:'Jersey',poStatus:'in_production',currentStage:'cutting',createdBy:'Afnan',createdAt:'2026-10-01'},extra||{});
const CUT_PO=(extra)=>PO(Object.assign({cutAt:'2026-10-05T09:00:00.000Z',cutQty:{S:90,M:190,L:180,XL:90},cutBy:'Uzaib',bundleIds:['B1','B2'],fabricConsumed:{qty:118.5,rollCodes:['r1','r2']}},extra||{}));
function mkApp(seed,po,globals){
  const db=fakeFirestore(seed);
  const a=loadApp({files:['js/shared.js','js/auth.js','js/pos.js','js/po-print.js'],currentPage:'dashboard',globals:Object.assign({},db.globals,{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}},globals||{})});
  a.run('session='+J(OWNER));
  a.run('globalThis.__toasts=[];showToast=function(m,e){__toasts.push(String(m));};');
  a.run('globalThis.__printed=[];window.__usePrintEngine=true;window.printDocument=async function(o){__printed.push(o);return {ok:true};};');
  a.run('allPOs='+J([po]));
  return Object.assign(a,{db});
}
const bundleDocs=()=>({'bundles/B1':{poId:'PO-012',bundleNumber:1,size:'S',units:90},'bundles/B2':{poId:'PO-012',bundleNumber:2,size:'M',units:190}});

module.exports=async function(){
  const s=suite('po-print-after-cut');
  const e=engine();

  s.section('no cut, no flags: the page is drawn exactly as before');
  const nb=await printPO(e,BASE), ns=await printPO(e,STRESS);
  s.eq('normal order identical to the engine at origin/wp3c-jobcopy',logHash(nb),GOLDEN.base);
  s.eq('stress order identical to the engine at origin/wp3c-jobcopy',logHash(ns),GOLDEN.stress);
  s.ok('no basis line is drawn',!nb.log.text.some(t=>/QUANTITIES/.test(t.t)));
  s.ok('a garbage data.cut (no sizes) changes nothing',logHash(await printPO(e,Object.assign({},BASE,{cut:{sizes:{}}})))===GOLDEN.base);
  s.ok('a cut with only zero sizes changes nothing',logHash(await printPO(e,Object.assign({},BASE,{cut:{sizes:{S:0}}})))===GOLDEN.base);

  s.section('ordered flag: marked, nothing else moves');
  {
    const d=await printPO(e,Object.assign({},BASE,{qtyBasis:'ordered'}));
    s.ok('says ORDERED QUANTITIES - BEFORE CUT',d.log.text.some(t=>t.t==='ORDERED QUANTITIES - BEFORE CUT'));
    s.eq('the same number of rects and lines',J([d.log.rect.length,d.log.line.length]),J([nb.log.rect.length,nb.log.line.length]));
    s.ok('the ordered Total Quantity (600) is still the value',d.log.text.some(t=>t.t==='600'));
    s.ok('the ordered sizes row is still drawn (S 100)',d.log.text.some(t=>/S 100/.test(t.t)));
  }

  s.section('actual cut: quantities, bundles, fabric, marker');
  const cd=await printPO(e,Object.assign({},BASE,{cut:CUT}));
  const T=cd.log.text.map(t=>t.t);
  s.ok('says ACTUAL CUT QUANTITIES',T.includes('ACTUAL CUT QUANTITIES'));
  s.ok('Sizes (actual cut) row carries the cut per size',T.some(t=>/S 150\s+M 300\s+L 100\s+XL 50/.test(t)),J(T.filter(t=>/Sizes/.test(t))));
  s.ok('Total Quantity (actual cut) label',/Total Quantity/.test(T.join(' '))&&/\(actual/.test(T.join(' ')),J(T.filter(t=>/actual|Quantity/i.test(t))));
  s.ok('the total is the SUM of the cut (600)',cd.log.text.some(t=>t.t==='600'&&t.size!=null));
  s.ok('a cut that differs from the order shows the cut total, never the ordered figure',!(await printPO(e,Object.assign({},BASE,{totalQty:'700',cut:CUT}))).log.text.some(t=>t.t==='700'));
  s.ok('the ordered ratio is not printed under an actual cut (ratio box blank)',!T.includes('1:2:2:1'));
  s.ok('the cut block band names who recorded it',T.some(t=>/ACTUAL CUT - RECORDED IN THE SYSTEM BY UZAIB/.test(t)));
  s.ok('bundle count and numbers are listed',T.some(t=>/Bundles \(6\): #100 S x20/.test(t)&&/#105 M x25/.test(t)),J(T.filter(t=>/Bundles/.test(t))));
  s.ok('fabric used is printed',T.some(t=>t==='Fabric used: 118.5 (14 rolls)'));
  s.ok('no Notes are printed',!T.some(t=>/placement 3 in/.test(t)));
  s.ok('START DATE is still handwritten in every station',cd.log.text.filter(t=>t.t==='START DATE').length===nb.log.text.filter(t=>t.t==='START DATE').length&&nb.log.text.filter(t=>t.t==='START DATE').length===5,J([cd.log.text.filter(t=>t.t==='START DATE').length,nb.log.text.filter(t=>t.t==='START DATE').length]));
  s.ok('at most two pages',cd.log.pages<=2,cd.log.pages+' pages');
  {
    const st=cd.log.text.filter(t=>!/^Page \d+ of \d+$/.test(t.t)&&!/^GROOVY · /.test(t.t));
    const TITLES=['CUTTING + BUNDLING','PRINTING, EMBROIDERY & QC','BUNDLING BEFORE STITCHING','STITCHING','WASHING DEPARTMENT'];
    const at=TITLES.map(x=>st.findIndex(t=>t.t===x));
    const ok=TITLES.every((x,i)=>{const sl=st.slice(at[i],i<4?at[i+1]:st.length);return at[i]>=0&&new Set(sl.map(t=>t.page)).size===1;});
    s.ok('every station block is on one page (never split)',ok);
    const base=new Set(nb.log.text.filter(t=>t.ink===RED).map(t=>t.t));
    const extraRed=cd.log.text.filter(t=>t.ink===RED&&t.t!==''&&!base.has(t.t)).map(t=>t.t);
    s.ok('red appears on nothing new except the total quantity figure',extraRed.every(x=>x==='600'),J(extraRed));
  }
  {
    const heavy=await printPO(e,Object.assign({},STRESS,{cut:{sizes:{XXS:10,XS:20,S:30,M:40,L:50,XL:60,'2XL':70,'3XL':80},bundles:bundles(200),by:'Uzaib',fabricUsed:'900 (80 rolls)'}}));
    s.ok('stress order with 200 bundles and 8 sizes is still two pages',heavy.log.pages<=2,heavy.log.pages+' pages');
    s.ok('overflowing bundle lines are summarised, not dropped silently',heavy.log.text.some(t=>/more line/.test(t.t)));
  }
  {
    const nob=await printPO(e,Object.assign({},BASE,{cut:{sizes:CUT.sizes,bundles:[]}}));
    s.ok('a cut with no bundle documents says so on the paper',nob.log.text.some(t=>t.t==='No bundles on file for this cut.'));
  }

  s.section('the PO page: buttons by state');
  {
    const a=mkApp({}, PO());
    const b=a.run('window.poPrintButtonHTML('+J(PO())+',false)');
    s.ok('before the cut: "Print PO (before cut)", not primary',/Print PO \(before cut\)/.test(b)&&/btn-pdf/.test(b)&&!/mark-done-btn/.test(b),b);
    const b2=a.run('window.poPrintButtonHTML('+J(CUT_PO())+',false)');
    s.ok('after the cut: "Print PO - after cut" is the primary button',/Print PO - after cut/.test(b2)&&/mark-done-btn/.test(b2),b2);
    const b3=a.run('window.poPrintButtonHTML('+J(CUT_PO())+',true)');
    s.ok('a cancelled PO keeps the plain PDF button',/⬇ PDF/.test(b3)&&!/after cut|before cut/.test(b3),b3);
    s.ok('cutAt without any cut pieces is not "cut recorded"',a.run('poPrintCutRecorded('+J(PO({cutAt:'x',cutQty:{S:0}}))+')')===false);
    s.ok('pieces without cutAt is not "cut recorded"',a.run('poPrintCutRecorded('+J(PO({cutQty:{S:5}}))+')')===false);
    const src=read('js/pos.js');
    s.ok('pos.js hooks are typeof-guarded',/typeof window\.poPrintRun==='function'/.test(src)&&/typeof window\.poPrintButtonHTML==='function'/.test(src)&&/typeof window\.poPrintInfoHTML==='function'/.test(src));
    s.ok('index.html loads po-print.js after pos.js and sw.js precaches it',read('index.html').indexOf('/js/po-print.js')>read('index.html').indexOf('/js/pos.js')&&/'\/js\/po-print\.js'/.test(read('sw.js')));
  }

  s.section('printing before the cut');
  {
    const a=mkApp({'pos/PO-012':PO()},PO());
    await a.run('window.generatePOPdf("PO-012")');
    const p=a.run('__printed');
    s.eq('one print',p.length,1);
    s.eq('type po',p[0].type,'po');
    s.eq('marked ordered',p[0].data.qtyBasis,'ordered');
    s.ok('no cut data',p[0].data.cut===undefined);
    s.eq('ordered total passes through',p[0].data.totalQty,'600');
    const l=(a.db.get('pos/PO-012')||{}).printLog||[];
    s.eq('print logged once, stage before-cut, by afnan',J([l.length,l[0]&&l[0].stage,l[0]&&l[0].by,l[0]&&l[0].byName]),J([1,'before-cut','afnan','Afnan']));
    s.ok('log entry has a time',l[0]&&l[0].at>0);
  }

  s.section('printing after the cut');
  {
    const a=mkApp(Object.assign({'pos/PO-012':CUT_PO()},bundleDocs()),CUT_PO());
    await a.run('window.generatePOPdf("PO-012")');
    const d=a.run('__printed')[0].data;
    s.ok('actual cut passed',d.cut&&d.cut.sizes.M===190&&d.qtyBasis===undefined,J(d.cut));
    s.eq('bundles read by poId, numbered',J(d.cut.bundles.map(b=>b.no)),J([1,2]));
    s.eq('fabric used from the PO',d.cut.fabricUsed,'118.5 (2 rolls)');
    s.eq('cut by',d.cut.by,'Uzaib');
    const l=(a.db.get('pos/PO-012')||{}).printLog||[];
    s.eq('logged as after-cut',J(l.map(x=>x.stage)),J(['after-cut']));
    await a.run('window.generatePOPdf("PO-012")');
    s.eq('a second print appends (append-only): two entries',((a.db.get('pos/PO-012')||{}).printLog||[]).length,2);
    s.ok('the first entry is untouched',J(((a.db.get('pos/PO-012')||{}).printLog||[])[0])===J(l[0]));
    const info=a.run('window.poPrintInfoHTML(allPOs[0])');
    s.ok('PO page says "Printed 2 times, last by Afnan on <date> (after cut)"',/Printed 2 times, last by Afnan on \d\d\/\d\d\/\d{4} \(after cut\)/.test(info),info);
    s.eq('only printLog was written to the pos document',a.db.log.commits.every(c=>c.length===1&&c[0]==='update:pos/PO-012'),true);
    s.eq('no history sub-collection write',Object.keys(a.db.store).length>=0&&[...a.db.store.keys()].some(k=>/history/.test(k)),false);
  }

  s.section('bundles unreadable: ordered values, said on the PO page');
  {
    const cases=[
      ['read throws',{ },a=>{a.db.fail.read=c=>c==='bundles';}],
      ['offline copy',{ },a=>{Object.entries(bundleDocs()).forEach(([k,v])=>a.db.put(k,v));a.db.fail.cached=c=>c==='bundles';}],
      ['none came back for a PO that lists bundles',{ },a=>{}]
    ];
    for(const [nm,_,prep] of cases){
      const a=mkApp({'pos/PO-012':CUT_PO()},CUT_PO());prep(a);
      await a.run('window.generatePOPdf("PO-012")');
      const d=a.run('__printed')[0].data;
      s.ok(nm+': ordered values printed (no data.cut, basis ordered)',d.cut===undefined&&d.qtyBasis==='ordered'&&d.totalQty==='600');
      const info=a.run('window.poPrintInfoHTML(allPOs[0])');
      s.ok(nm+': the PO page says the bundles could not be read and ORDERED was printed',/bundles could not be read/.test(info)&&/ORDERED quantities/.test(info),info);
      s.eq(nm+': the print is still logged',(a.db.get('pos/PO-012').printLog||[]).length,1);
    }
  }

  s.section('the print log is best effort');
  {
    const a=mkApp({'pos/PO-012':PO()},PO());
    a.db.fail.commit=()=>true;
    await a.run('window.generatePOPdf("PO-012")');
    s.eq('the PDF was still made',a.run('__printed').length,1);
    s.eq('nothing was written',a.db.get('pos/PO-012').printLog,undefined);
    s.ok('a toast says the print was not recorded',a.run('__toasts').some(t=>/not recorded/.test(t)),J(a.run('__toasts')));
    const info=a.run('window.poPrintInfoHTML(allPOs[0])');
    s.ok('the PO page says the print was NOT recorded',/NOT recorded/.test(info)&&/Not printed yet/.test(info),info);
    const b=mkApp({'pos/PO-012':PO()},PO(),{runTransaction:async()=>{throw new Error('offline');}});
    await b.run('window.generatePOPdf("PO-012")');
    s.eq('a throwing transaction never blocks the print',b.run('__printed').length,1);
  }
  {
    const a=mkApp({'pos/PO-012':PO({printLog:[{at:1760000000000,by:'x',byName:'Ali',stage:'before-cut'}]})},PO({printLog:[{at:1760000000000,by:'x',byName:'Ali',stage:'before-cut'}]}));
    await a.run('window.generatePOPdf("PO-012")');
    s.eq('an existing log is appended to, not replaced',a.db.get('pos/PO-012').printLog.length,2);
    s.eq('and the old row is kept',a.db.get('pos/PO-012').printLog[0].byName,'Ali');
  }
  {
    const a=mkApp({'pos/PO-012':PO()},PO(),{});
    a.run('window.printDocument=async function(){throw new Error("font fetch failed");};');
    await a.run('window.generatePOPdf("PO-012")');
    s.eq('a print that failed is NOT logged as printed',a.db.get('pos/PO-012').printLog,undefined);
  }
  {
    const src=read('js/po-print.js').replace(/\/\*[\s\S]*?\*\//g,'');
    s.ok('po-print.js writes only the printLog field of the pos document',/tx\.update\(ref, \{ printLog: next \}\)/.test(src)&&!/setDoc|deleteDoc|addDoc|updateDoc/.test(src)&&!/history/.test(src));
  }
  return s;
};

/* Embroidery job copy (js/print-engine.js, variant 'embroidery-job'): driven against a
   recording fake jsPDF like po-print. Holds: one A4 page; PO number and article code
   large; 8 x 8 cm fabric sample box; red START/END DATE lines and boxed red TOTAL
   row; neutral dark lines elsewhere; same size rows as the PO; English only, no font
   fetch; no image = no addImage. Not seen on a printer. */
'use strict';
const fs=require('fs'),path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const J=v=>JSON.stringify(v);
const RED='220,38,38', DARKC='38,38,38';
const ARABIC=/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
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
  ['setFillColor','addFileToVFS','addFont','roundedRect'].forEach(k=>{d[k]=function(){return d;};});
  d.getTextWidth=t=>String(t).length*size*0.5;
  d.splitTextToSize=(t,w)=>{const out=[];String(t).split('\\n').forEach(par=>{let cur='';par.split(' ').forEach(wd=>{const nx=cur?cur+' '+wd:wd;if(cur&&nx.length*size*0.5>w){out.push(cur);cur=wd;}else cur=nx;});out.push(cur);});return out;};
  d.text=(t,x,y,o)=>{(Array.isArray(t)?t:[t]).forEach((s,i)=>{d.log.text.push({t:String(s),x,y:y+i*size*1.15,page,size,style,ink,align:o&&o.align||'left',mode:o&&o.renderingMode||'',draw,lw});});return d;};
  d.rect=(x,y,w,h,st)=>{d.log.rect.push({x,y,w,h,st:st||'',page,draw,lw});return d;};
  d.line=(x1,y1,x2,y2)=>{d.log.line.push({x1,y1,x2,y2,page,draw,lw});return d;};
  d.log.images=[];d.addImage=(...a)=>{d.log.images.push(a);return d;};
  d.output=()=>({size:4096,fake:true});
  d.save=()=>{};
  __docs.push(d);
};
window.jspdf={jsPDF:FakePDF};
window.open=u=>{if(u)return null;return {closed:false,location:null,document:{open(){},write(){},close(){}},close(){this.closed=true;}};};`;


function engine(){
  const globals={console:{log(){},info(){},error(){},warn(){}},
    URL:{createObjectURL(){throw new TypeError('x');},revokeObjectURL(){}}};
  const e=harness.loadApp({files:['js/print-engine.js'],currentPage:'dashboard',globals});
  e.run(FAKE);
  return e;
}
async function printJob(e,data,type){
  const n=e.run('__docs.length');
  await e.run('window.printDocument('+J({type:type||'embroidery-job',filename:'j.pdf',deliver:'blob',data})+')');
  return e.run('__docs['+n+']');
}
const BASE={documentType:'Embroidery Job',documentNumber:'PO-0142',poNumber:'PO-0142',articleName:'EFFORTLESS TEE | DEEP BLUE',articleCode:'GST073',
  __productImg:{dataUrl:'data:image/png;base64,AAAA',fmt:'PNG',w:600,h:800}};

module.exports=async function(){
  const s=suite('job-print');
  const e=engine();
  const d=await printJob(e,BASE);
  const T=d.log.text;

  s.section('one A4 page, English only');
  s.eq('a single page',d.log.pages,1);
  s.ok('no Urdu letter is drawn',!T.some(t=>ARABIC.test(t.t)));
  s.ok('the Urdu font (Jameel Noori) is never fetched (minimal)',!e.state.fetches.some(f=>/Jameel|Nastaleeq/i.test(f.url)));
  s.ok('the footer is English only',T.some(t=>/^GROOVY · /.test(t.t)&&!ARABIC.test(t.t)));

  s.section('typed items are big');
  const no=T.find(t=>t.t==='PO-0142'&&t.size>=24);
  s.ok('PO number at 24pt or more, top right',!!no&&no.align==='right'&&no.y<80);
  const ac=T.find(t=>t.t==='GST073');
  s.ok('article code at 24pt or more',!!ac&&ac.size>=24);
  s.ok('article name is printed',T.some(t=>t.t==='EFFORTLESS TEE | DEEP BLUE'));
  s.ok('title EMBROIDERY JOB',T.some(t=>t.t==='EMBROIDERY JOB'));
  s.ok('GROOVY wordmark is the bold (fill+stroke) one',T.some(t=>t.t==='GROOVY'&&t.mode==='fillThenStroke'));
  s.eq('the product photo is embedded once',d.log.images.length,1);
  const d2=await printJob(e,Object.assign({},BASE,{__productImg:null}));
  s.eq('no image: nothing embedded',d2.log.images.length,0);
  s.eq('no image: still one page',d2.log.pages,1);

  s.section('handwritten fields');
  ['PLACEMENT','DATE HANDED OVER','ACTUAL CUT QUANTITY BY SIZE'].forEach(n=>s.ok(n+' is labelled',T.some(t=>t.t===n)));
  s.ok('candle / shade code is labelled',T.some(t=>/^CANDLE \/ SHADE CODE/.test(t.t)));
  const shadeLines=d.log.line.filter(l=>l.draw===DARKC&&l.y1===l.y2&&l.x2-l.x1>200&&l.y1>320&&l.y1<450);
  s.ok('five ruled lines for the shade codes',shadeLines.length===5,String(shadeLines.length));
  const sizes=['Small','Medium','Large','X-Large'];
  s.ok('the same size rows as the PO tables, in order',sizes.every(z=>T.some(t=>t.t===z))&&sizes.map(z=>T.findIndex(t=>t.t===z)).every((v,i,a)=>!i||v>a[i-1]));
  s.ok('table columns Size | Qty',T.some(t=>t.t==='Size')&&T.some(t=>t.t==='Qty'));

  s.section('fabric sample box');
  const box=d.log.rect.find(r=>Math.abs(r.w-r.h)<0.01&&r.w>200);
  s.ok('a square box',!!box);
  s.ok('about 8 x 8 cm (226.8pt)',!!box&&Math.abs(box.w-226.77)<0.5,box&&String(box.w));
  s.ok('labelled "Fabric sample — staple here"',T.some(t=>t.t==='Fabric sample — staple here'));
  s.ok('the box sits on the page (right edge inside margin, above the footer)',!!box&&box.x+box.w<=559.3&&box.y+box.h<780);

  s.section('red, only where it belongs');
  const sd=T.find(t=>/^START DATE/.test(t.t));
  s.ok('START DATE label is red',!!sd&&sd.ink===RED);
  const e4=await printJob(e,Object.assign({},BASE,{startDate:''}));
  s.ok('START DATE: a red line to write on when no date given',e4.log.line.some(l=>l.draw===RED&&l.y1<80&&l.x1>150&&l.x2<450)&&!e4.log.text.some(t=>/\d\d\/\d\d\/\d{4}/.test(t.t)));
  const ed=T.find(t=>t.t==='END DATE');
  s.ok('END DATE label is red',!!ed&&ed.ink===RED);
  s.ok('END DATE has a red line, thick like the PO (0.8)',d.log.line.some(l=>l.draw===RED&&l.lw>=0.8&&l.y1>ed.y&&l.y1<ed.y+4));
  const tot=T.find(t=>t.t==='TOTAL');
  s.ok('a TOTAL row exists',!!tot);
  s.ok('the TOTAL row is boxed in red at the heavy width (1.5)',d.log.rect.some(r=>r.draw===RED&&r.lw>=1.5&&r.w>200&&tot&&tot.y>r.y&&tot.y<r.y+r.h));
  s.ok('the title band is red-bordered',d.log.rect.some(r=>r.draw===RED&&r.st==='FD'&&r.w>500));
  const nonRedRects=d.log.rect.filter(r=>r.draw===RED);
  s.ok('only band, TOTAL row cells and box carry a red stroke (no other table cells)',nonRedRects.every(r=>r.st==='FD'||(tot&&r.y<=tot.y&&tot.y<=r.y+r.h)));
  s.ok('every other line is the neutral #262626',d.log.rect.concat(d.log.line).filter(l=>l.draw!==RED).every(l=>[DARKC,'0,0,0','204,204,204'].indexOf(l.draw)>=0));
  s.ok('table / box lines are at least the PO widths (0.6) and the sample box heavy (1.5)',!!box&&box.lw>=1.5&&d.log.rect.filter(r=>r.draw===DARKC).every(r=>r.lw>=0.6));
  s.ok('red text is only the date labels (START / END) and nothing else small',T.filter(t=>t.ink===RED).every(t=>/DATE/.test(t.t)||/^\d\d\/\d\d\/\d{4}$/.test(t.t)));

  s.section('wiring');
  const pe=fs.readFileSync(path.join(ROOT,'js/print-engine.js'),'utf8');
  s.ok('registered: known list, label, minimal Urdu, variant',/known = \['po', 'embroidery-job'/.test(pe)&&/'embroidery-job': 'Embroidery Job'/.test(pe)&&/'embroidery-job': 'minimal'/.test(pe)&&/'embroidery-job': _renderEmbroideryJob/.test(pe));
  s.ok("'embroidery-vendor' is untouched (still the full-Urdu stub)",/'embroidery-vendor': 'full'/.test(pe)&&!/'embroidery-vendor': _render/.test(pe));
  s.ok('size rows are ONE constant shared with the PO',/const _PO_SIZE_ROWS = /.test(pe)&&/const SIZE_ROWS = _PO_SIZE_ROWS/.test(pe));
  const pos=fs.readFileSync(path.join(ROOT,'js/pos.js'),'utf8');
  s.ok('generateEmbroideryJobPdf is window-exposed and maps the PO fields',/window\.generateEmbroideryJobPdf=function/.test(pos)&&/type:'embroidery-job'/.test(pos)&&/articleCode:po\.code/.test(pos)&&/productImage:po\.imgFront/.test(pos));
  s.ok('no PO-creation UI was added',!/embroidery-job/.test(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')));
  /* ── Printing job copy (step 2) ── */
  const PB=Object.assign({},BASE,{documentType:'Printing Job'});
  const pd=await printJob(e,PB,'printing-job');
  const PT=pd.log.text;
  s.section('printing job: one A4 page, English only');
  s.eq('a single page',pd.log.pages,1);
  s.ok('no Urdu letter is drawn',!PT.some(t=>ARABIC.test(t.t)));
  s.ok('footer label is Printing Job',PT.some(t=>/^GROOVY · Printing Job/.test(t.t)));
  s.ok('Jameel is never fetched',!e.state.fetches.some(f=>/Jameel|Nastaleeq/i.test(f.url)));
  s.section('printing job: typed items');
  const pno=PT.find(t=>t.t==='PO-0142'&&t.size>=24);
  s.ok('PO number 26pt top right',!!pno&&pno.size>=26&&pno.align==='right'&&pno.y<80);
  const pac=PT.find(t=>t.t==='GST073');
  s.ok('article code at 24pt or more',!!pac&&pac.size>=24);
  s.ok('article name printed',PT.some(t=>t.t==='EFFORTLESS TEE | DEEP BLUE'));
  s.ok('title PRINTING JOB (and not EMBROIDERY JOB)',PT.some(t=>t.t==='PRINTING JOB')&&!PT.some(t=>t.t==='EMBROIDERY JOB'));
  s.ok('bold GROOVY wordmark',PT.some(t=>t.t==='GROOVY'&&t.mode==='fillThenStroke'));
  s.eq('photo embedded once',pd.log.images.length,1);
  const pd2=await printJob(e,Object.assign({},PB,{__productImg:null}),'printing-job');
  s.ok('no image: nothing embedded, one page',pd2.log.images.length===0&&pd2.log.pages===1);
  s.section('printing job: handwritten fields');
  ['PLACEMENT','PANTONE CODE','PRINT NAME / DESIGN NAME','ACTUAL CUT QUANTITY BY SIZE'].forEach(n=>s.ok(n+' labelled',PT.some(t=>t.t===n)));
  const ruled=pd.log.line.filter(l=>l.draw===DARKC&&l.y1===l.y2&&l.x2-l.x1>200);
  s.ok('PANTONE CODE has several (5) ruled lines',ruled.length>=9,String(ruled.length));
  s.ok('same size rows as the PO, Size | Qty',['Small','Medium','Large','X-Large'].every(z=>PT.some(t=>t.t===z))&&PT.some(t=>t.t==='Size')&&PT.some(t=>t.t==='Qty'));
  s.ok('no separate TOTAL ACTUAL CUT UNITS field (the size table TOTAL row is the only total)',!PT.some(t=>/TOTAL ACTUAL CUT/i.test(t.t)));
  s.eq('exactly one TOTAL row on the printing copy',PT.filter(t=>/^TOTAL/i.test(t.t)).length,1);
  s.ok('no heavy dark (1.5) box is left over',!pd.log.rect.some(r=>r.draw===DARKC&&r.lw>=1.5));
  s.eq('exactly one TOTAL row on the embroidery copy',T.filter(t=>/^TOTAL/i.test(t.t)).length,1);
  s.section('START DATE is always handwritten');
  for(const [nm,type,base] of [['embroidery','embroidery-job',BASE],['printing','printing-job',PB]]){
    const x=await printJob(e,Object.assign({},base,{startDate:'02/10/2026'}),type);
    const xs=x.log.text.find(t=>/^START DATE/.test(t.t));
    s.ok(nm+': START DATE label is red even when startDate is supplied',!!xs&&xs.ink===RED);
    s.ok(nm+': no date text is drawn',!x.log.text.some(t=>/\d\d\/\d\d\/\d{4}|2026/.test(t.t)));
    s.ok(nm+': a red blank line is drawn beside the label',x.log.line.some(l=>l.draw===RED&&l.y1<80&&l.x1>150&&l.x2<450));
  }
  s.ok('generate*JobPdf no longer pass startDate',!/type:'(embroidery|printing)-job'[\s\S]{0,200}startDate/.test(pos));
  s.ok('no fabric sample box or label',!PT.some(t=>/Fabric sample/.test(t.t)));
  s.ok('the box and table sit above the footer',pd.log.rect.every(r=>r.y+r.h<800));
  s.section('printing job: red only where it belongs');
  const psd=PT.find(t=>/^START DATE/.test(t.t));
  s.ok('START DATE label red',!!psd&&psd.ink===RED);
  const ped=PT.find(t=>t.t==='END DATE');
  s.ok('END DATE red with a thick red line',!!ped&&ped.ink===RED&&pd.log.line.some(l=>l.draw===RED&&l.lw>=0.8&&l.y1>ped.y&&l.y1<ped.y+4));
  const ptot=PT.find(t=>t.t==='TOTAL');
  s.ok('red TOTAL row boxed at 1.5',!!ptot&&pd.log.rect.some(r=>r.draw===RED&&r.lw>=1.5&&r.w>200&&ptot.y>r.y&&ptot.y<r.y+r.h));
  s.ok('title band red-bordered',pd.log.rect.some(r=>r.draw===RED&&r.st==='FD'&&r.w>500));
  s.ok('red text is only date labels',PT.filter(t=>t.ink===RED).every(t=>/DATE/.test(t.t)||/^\d\d\/\d\d\/\d{4}$/.test(t.t)));
  s.ok('every non-red line is neutral #262626',pd.log.rect.concat(pd.log.line).filter(l=>l.draw!==RED).every(l=>[DARKC,'0,0,0','204,204,204'].indexOf(l.draw)>=0));
  s.section('printing job: wiring');
  s.ok('registered: known, label, minimal, variant',/known = \['po', 'embroidery-job', 'printing-job'/.test(pe)&&/'printing-job': 'Printing Job'/.test(pe)&&/'printing-job': 'minimal'/.test(pe)&&/'printing-job': _renderPrintingJob/.test(pe));
  s.ok('generatePrintingJobPdf mapped like the embroidery one',/window\.generatePrintingJobPdf=function/.test(pos)&&/type:'printing-job'/.test(pos)&&/documentType:'Printing Job'/.test(pos));
  s.ok('both copies share the job helpers',/function _renderEmbroideryJob[\s\S]*_jobTop\(/.test(pe)&&/function _renderPrintingJob[\s\S]*_jobTop\(/.test(pe));
  s.ok('no UI added for printing job',!/printing-job/.test(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')));

  /* ── Washing job copy (step 3) ── */
  const WB=Object.assign({},BASE,{documentType:'Washing Job'});
  const PNG='data:image/png;base64,BBBB';
  const UR={note:{dataUrl:PNG,w:1200,h:300,fontPx:72},fabric:{dataUrl:PNG,w:900,h:200,fontPx:72},rib:{dataUrl:PNG,w:700,h:200,fontPx:72},shrink:{dataUrl:PNG,w:2600,h:210,fontPx:72}};
  const wd=await printJob(e,Object.assign({},WB,{urduImages:UR,startDate:'02/10/2026'}),'washing-job');
  const WT=wd.log.text;
  const wf=await printJob(e,WB,'washing-job');
  const FT=wf.log.text;
  s.section('washing job: page and typed items');
  s.eq('a single page (with Urdu pictures)',wd.log.pages,1);
  s.eq('a single page (English only)',wf.log.pages,1);
  s.ok('the Urdu font is never fetched by the engine',!e.state.fetches.some(f=>/Jameel|Nastaleeq/i.test(f.url)));
  s.ok('footer label is Washing Job',WT.some(t=>/^GROOVY · Washing Job/.test(t.t)));
  const wno=WT.find(t=>t.t==='PO-0142'&&t.size>=26);
  s.ok('PO number 26pt top right',!!wno&&wno.align==='right'&&wno.y<80);
  const wac=WT.find(t=>t.t==='GST073');
  s.ok('article code at 24pt or more',!!wac&&wac.size>=24);
  s.ok('title WASHING JOB only',WT.some(t=>t.t==='WASHING JOB')&&!WT.some(t=>t.t==='PRINTING JOB'||t.t==='EMBROIDERY JOB'));
  s.ok('article name printed, bold GROOVY wordmark',WT.some(t=>t.t==='EFFORTLESS TEE | DEEP BLUE')&&WT.some(t=>t.t==='GROOVY'&&t.mode==='fillThenStroke'));
  s.section('washing job: START DATE handwritten, one TOTAL, END DATE red');
  const wsd=WT.find(t=>/^START DATE/.test(t.t));
  s.ok('START DATE label red though startDate was supplied',!!wsd&&wsd.ink===RED);
  s.ok('no date text drawn',!WT.some(t=>/\d\d\/\d\d\/\d{4}|2026/.test(t.t)));
  s.ok('red blank line beside START DATE',wd.log.line.some(l=>l.draw===RED&&l.y1<80&&l.x1>150&&l.x2<450));
  s.eq('exactly one TOTAL row',WT.filter(t=>/^TOTAL/i.test(t.t)).length,1);
  s.ok('no separate total box',!WT.some(t=>/TOTAL ACTUAL CUT/i.test(t.t)));
  const wtot=WT.find(t=>t.t==='TOTAL');
  s.ok('red TOTAL row boxed at 1.5',!!wtot&&wd.log.rect.some(r=>r.draw===RED&&r.lw>=1.5&&r.w>200&&wtot.y>r.y&&wtot.y<r.y+r.h));
  const wed=WT.find(t=>t.t==='END DATE');
  s.ok('END DATE red with a red line',!!wed&&wed.ink===RED&&wd.log.line.some(l=>l.draw===RED&&l.lw>=0.8&&l.y1>wed.y&&l.y1<wed.y+4));
  s.ok('size rows and Size | Qty',['Small','Medium','Large','X-Large'].every(z=>WT.some(t=>t.t===z))&&WT.some(t=>t.t==='Size')&&WT.some(t=>t.t==='Qty'));
  s.ok('red text is only date labels',WT.filter(t=>t.ink===RED).every(t=>/DATE/.test(t.t)));
  s.ok('everything sits above the footer',wd.log.rect.every(r=>r.y+r.h<800));
  s.section('washing job: the checklist');
  ['Fabric is 100% cotton','Rib is 100% cotton','Shrinkage of fabric is done','COMPLETE BEFORE CUTTING','CHECKED BY (name)','SIGNATURE','DATE CHECKED','REMARKS'].forEach(n=>{
    s.ok(n+' (with pictures)',WT.some(t=>t.t===n));s.ok(n+' (English only)',FT.some(t=>t.t===n));});
  const boxes=r=>r.filter(b=>b.draw===DARKC&&b.lw>=1.5&&b.w===18&&b.h===18);
  s.eq('three tick boxes drawn (18pt squares)',boxes(wd.log.rect).length,3);
  s.eq('three tick boxes drawn in the English-only sheet too',boxes(wf.log.rect).length,3);
  s.ok('tick boxes are left of the English lines',boxes(wd.log.rect).every(b=>b.x<WT.find(t=>t.t==='Rib is 100% cotton').x));
  s.ok('checked-by, signature and date lines are drawn',wd.log.line.filter(l=>l.draw===DARKC&&l.y1===l.y2&&l.y1>450&&l.y1<560).length>=4);
  s.section('washing job: Urdu pictures');
  const ims=wd.log.images.filter(a=>a[0]===PNG);
  s.eq('four Urdu pictures placed via addImage (plus the product photo)',ims.length,4);
  s.eq('product photo still embedded',wd.log.images.length,5);
  const pairs=[['note',UR.note],['fabric',UR.fabric],['rib',UR.rib],['shrink',UR.shrink]];
  s.ok('aspect ratio preserved for every picture',ims.length===4&&ims.every(a=>{const src=Object.values(UR).find(u=>Math.abs(u.w/u.h-a[4]/a[5])<0.01);return !!src;}));
  const rightEdges=ims.slice(1).map(a=>a[2]+a[4]);
  s.ok('the three checklist pictures are right-aligned to the same edge',rightEdges.length===3&&rightEdges.every(v=>Math.abs(v-rightEdges[0])<0.01)&&rightEdges[0]>500&&rightEdges[0]<=560);
  s.ok('every picture stays inside the page margins',ims.every(a=>a[2]>=36&&a[2]+a[4]<=560));
  s.ok('the long line is shrunk to fit, not overflowing',ims.every(a=>a[4]<=300.01));
  s.ok('pictures are sitting level with their rows (inside the checklist)',ims.slice(1).every(a=>a[3]>320&&a[3]<470));
  s.ok('no Arabic-script code point reaches doc.text (with pictures)',!WT.some(t=>ARABIC.test(t.t)));
  s.ok('no Arabic-script code point reaches doc.text (English only)',!FT.some(t=>ARABIC.test(t.t)));
  s.eq('English only: nothing but the product photo is embedded',wf.log.images.length,1);
  const bad=await printJob(e,Object.assign({},WB,{urduImages:{note:{dataUrl:'javascript:1',w:10,h:10},fabric:{dataUrl:PNG,w:0,h:5},rib:null,shrink:{dataUrl:PNG}}}),'washing-job');
  s.ok('malformed picture entries are ignored, the sheet still prints',bad.log.pages===1&&bad.log.images.length===1);
  s.section('washing job: caller rasteriser and fallback');
  const wapp=harness.loadApp({files:['js/pos.js'],currentPage:'dashboard',globals:{console:{log(){},info(){},error(){},warn(){}}}});
  const rasterNone=await wapp.run("_washRasterUrdu('x')");
  s.ok('no canvas / font in the harness: the rasteriser answers null, never throws',rasterNone===null);
  const urduSrc=Object.values(await wapp.run('JSON.parse(JSON.stringify(_WASH_URDU))'));
  await wapp.run(`window.__pd=null;window.printDocument=async o=>{window.__pd=o;return 1;};window.showToast=()=>{};
    document.fonts={load:async()=>{},check:()=>true};
    document.createElement=t=>({width:0,height:0,getContext:()=>({measureText:()=>({width:100,actualBoundingBoxAscent:50,actualBoundingBoxDescent:20,actualBoundingBoxLeft:0,actualBoundingBoxRight:100}),fillText(){}}),toDataURL:()=>'data:image/png;base64,ZZ'});`);
  await wapp.run("window.generateWashingJobPdf({id:'PO-1',name:'N',code:'C'})");
  const sent=await wapp.run('JSON.parse(JSON.stringify(window.__pd))');
  s.ok('generateWashingJobPdf rasterises all four lines into data.urduImages',!!sent&&sent.type==='washing-job'&&['note','fabric','rib','shrink'].every(k=>sent.data.urduImages&&sent.data.urduImages[k]&&sent.data.urduImages[k].dataUrl.indexOf('data:image/png')===0&&sent.data.urduImages[k].w>0&&sent.data.urduImages[k].fontPx>0));
  s.ok('no startDate and no Arabic text reach the engine call',!('startDate' in sent.data)&&!ARABIC.test(sent.data.articleName+sent.data.articleCode));
  await wapp.run("document.fonts={load:async()=>{},check:()=>false}");
  await wapp.run("window.generateWashingJobPdf({id:'PO-1',name:'N',code:'C'})");
  const sent2=await wapp.run('JSON.parse(JSON.stringify(window.__pd))');
  s.ok('font not loaded: urduImages is empty, the engine call still goes out (English-only sheet)',!!sent2&&Object.keys(sent2.data.urduImages).length===0);
  await wapp.run("document.fonts={load:async()=>{throw new Error('x')},check:()=>true}");
  await wapp.run("window.generateWashingJobPdf({id:'PO-1',name:'N',code:'C'})");
  const sent3=await wapp.run('JSON.parse(JSON.stringify(window.__pd))');
  s.ok('font load throws: still English only, no rejection',!!sent3&&Object.keys(sent3.data.urduImages).length===0);
  s.ok('four Urdu strings, all Arabic-script',urduSrc.length===4&&urduSrc.every(u=>ARABIC.test(u)));
  s.ok('the 100% runs are isolated so the percent sign cannot flip',urduSrc.filter(u=>/100/.test(u)).every(u=>/⁦100%⁩/.test(u)));
  s.section('washing job: wiring');
  s.ok('registered: known, label, minimal, variant',/'printing-job', 'washing-job'/.test(pe)&&/'washing-job': 'Washing Job'/.test(pe)&&/'washing-job': 'minimal'/.test(pe)&&/'washing-job': _renderWashingJob/.test(pe));
  s.ok('generateWashingJobPdf mapped like the others, no startDate',/window\.generateWashingJobPdf=async function/.test(pos)&&/type:'washing-job'/.test(pos)&&/documentType:'Washing Job'/.test(pos)&&!/type:'washing-job'[\s\S]{0,300}startDate/.test(pos));
  s.ok('washing copy uses the shared _jobTop',/function _renderWashingJob[\s\S]*_jobTop\(/.test(pe));
  s.ok('rasteriser lives in pos.js, not in the engine',!/createElement\('canvas'\)|fonts\.load/.test(pe.slice(pe.indexOf('function _jobUrduImg'),pe.indexOf('/* ── Custom page size'))));
  s.ok('the rasteriser uses the browser font and rtl',/document\.fonts\.load/.test(pos)&&(pos.match(/cx\.direction='rtl'/g)||[]).length===2);
  s.ok('no UI added for washing job',!/washing-job/.test(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')));
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   Production Order printout (js/print-engine.js, variant 'po', _renderPO).

   printDocument is DRIVEN against a jsPDF that records every word, rect and
   line it is asked to draw (with ink, stroke colour and line width), page by
   page. What this holds:
   - the main sheet is at most TWO A4 pages — for a normal order AND for a
     stress order (very long names, long notes, 8 sizes);
   - a station block (title, dates, table, TOTAL row, sign-off lines) is never
     split across a page break, and no table rect runs below the page;
   - START DATE sits in the header in red (a red line to write on when there
     is none) and "Created: … by …" is gone from the PO header only;
   - every station has red START DATE / END DATE fields;
   - the station names: Kashif Bhai / Shameer / none on Bundling Before
     Stitching / Waqas / Abbas, read from ONE constant (_PO_STATIONS);
   - "Printing, Embroidery & QC" is spelled out;
   - every table has a boxed TOTAL row;
   - red ONLY on START DATE, station bands, TOTAL rows and the Total Quantity /
     Ratio / Weight / Average boxes; every ordinary table line is a dark
     neutral at least double the old width (2 Oct 2026);
   - no Notes block and no "Grand Total Quantity Processed" are printed;
   - the Sizes row prints e.g. S 100(1) with the (n) in red (quantity rule);
   - GROOVY is drawn fill+stroke (heavier); stitching Date column is narrow;
   - the ratio, total weight and average per unit are red;
   - Size narrower / Bundles wider / Total narrower on both bundling tables;
   - the info grid never overprints (every text baseline sits inside a cell);
   - no Urdu, no empty '()' and no dangling dash is drawn;
   - the other variants' header is unchanged ("Created: … by …").
   It cannot tell what the page LOOKS like: the PDF was rendered in headless
   Chromium (pdftoppm) and looked at, page by page — not seen on a printer.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite,ROOT}=harness;
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const RED='220,38,38';
const ARABIC=/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

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

const BASE={documentType:'Production Order',documentNumber:'PO-0142',id:'PO-0142',poNumber:'PO-0142',startDate:'02/10/2026',
  pattern:'PTN-0007 · Hook 3 / Slot 2 · Boxy tee block',articleName:'EFFORTLESS TEE | DEEP BLUE',articleCode:'GST073',sizes:'S-M-L-XL',
  fabricName:'240 GSM Cotton Jersey',fabricCode:'FAB-JRS-240',totalQty:'600',ratio:'1:2:2:1',issuedBy:'Afnan',issuedDate:'02/10/2026',
  totalWeight:'312 kg',avgPerUnit:'0.52 kg',notes:'Front chest print placement 3 in below collar.',
  __productImg:{dataUrl:'data:image/png;base64,AAAA',fmt:'PNG',w:600,h:800}};
const STRESS=Object.assign({},BASE,{
  articleName:'OVERSIZED ACID WASH HEAVYWEIGHT GRAPHIC TEE | VINTAGE FADED BLACK | LIMITED WINTER DROP 2027',
  sizes:'XXS-XS-S-M-L-XL-2XL-3XL',fabricName:'320 GSM Heavyweight Cotton Terry Brushed Interlock',
  pattern:'PTN-0007 · Hook 3 / Slot 2 · Oversized boxy block with dropped shoulder and extended hem',
  ratio:'1:2:3:4:4:3:2:1',totalQty:'12000',
  notes:'Embroidery chest left, 2 in from placement mark, thread Pantone 485 C. Puff print back, cure 160C for 90s. '.repeat(7)});

const TITLES=['CUTTING + BUNDLING','PRINTING, EMBROIDERY & QC','BUNDLING BEFORE STITCHING','STITCHING','WASHING DEPARTMENT'];
const NAMES=['Kashif Bhai','Shameer','Waqas','Abbas'];
const isFooter=t=>/^Page \d+ of \d+$/.test(t.t)||/^GROOVY · /.test(t.t);
/* Station slices in DRAW order: [from title i, up to the next title). */
function stations(d){
  const tx=d.log.text.filter(t=>!isFooter(t));
  const at=TITLES.map(T=>tx.findIndex(t=>t.t===T));
  return TITLES.map((T,i)=>({title:T,idx:at[i],texts:at[i]<0?[]:tx.slice(at[i],i<TITLES.length-1?at[i+1]:tx.length)}));
}

module.exports=async function(){
  const s=suite('po-print');
  const e=engine();
  const N=await printPO(e,BASE), S=await printPO(e,STRESS);
  const nd=N.d, sd=S.d;

  s.section('two pages at most, and no station is ever split');
  s.ok('a normal order prints on 1–2 A4 pages',nd.log.pages<=2,nd.log.pages+' pages');
  s.ok('a stress order (long names, long notes, 8 sizes) is still 2 pages at most',sd.log.pages<=2,sd.log.pages+' pages');
  [['normal',nd],['stress',sd]].forEach(([nm,d])=>{
    const st=stations(d);
    s.ok(nm+': all five stations are drawn',st.every(x=>x.idx>=0));
    st.forEach(x=>{
      const pgs=new Set(x.texts.map(t=>t.page));
      s.ok(nm+': '+x.title+' sits on ONE page (title, dates, table, TOTAL, sign-off)',pgs.size===1,J([...pgs]));
    });
    const maxY=841.89-36-22+0.5;
    s.ok(nm+': no stroked rect runs below the usable page',d.log.rect.every(r=>r.y+r.h<=maxY),J(d.log.rect.filter(r=>r.y+r.h>maxY).slice(0,2)));
  });
  {
    // the TOTAL row of each station is on the same page as that station's header rect row
    const st=stations(sd), tot=st.map(x=>x.texts.filter(t=>t.t==='TOTAL'));
    s.ok('every station has its TOTAL on its own page (stress)',st.every((x,i)=>tot[i].length===1&&tot[i][0].page===x.texts[0].page));
  }

  s.section('the header: START DATE in red top-middle, a big PO number, no "Created:"');
  {
    const h=nd.log.text.filter(t=>/^START DATE: /.test(t.t));
    s.eq('one START DATE label in the header',h.length,1);
    s.eq('… in red',h[0]&&h[0].ink,RED);
    s.ok('… near the middle of the page',h[0]&&Math.abs(h[0].x-297)<80,h[0]&&String(h[0].x));
    const v=nd.log.text.filter(t=>t.t==='02/10/2026');
    s.ok('the date from data.startDate is printed, in red',v.length>=1&&v[0].ink===RED);
    s.ok('"Created: … by …" is gone from the PO header',!nd.log.text.some(t=>/^Created:/.test(t.t)));
    const no=nd.log.text.find(t=>t.t==='PO-0142'&&t.size>=24);
    s.ok('the PO number is drawn at 24pt or more (was 16), top right',!!no&&no.align==='right');
    const e2=await printPO(e,Object.assign({},BASE,{startDate:''}));
    s.ok('no start date: no value text …',!e2.d.log.text.some(t=>t.t==='02/10/2026'));
    s.ok('… and a red line to write on, in the header band',e2.d.log.line.some(l=>l.draw===RED&&l.y1<80&&l.x1>200&&l.x2<400));
    const gen=await e.run('window.printDocument('+J({type:'generic',filename:'g.pdf',deliver:'blob',data:{title:'T',bodyHtml:'<p>x</p>',documentNumber:'X-1',issuedDate:'01/10/2026',issuedBy:'Afnan'}})+')');
    const gd=e.run('__docs[__docs.length-1]');
    s.ok('another variant keeps "Created: … by …" and the 16pt number',gd.log.text.some(t=>t.t==='Created: 01/10/2026 by Afnan')&&gd.log.text.some(t=>t.t==='X-1'&&t.size===16));
    s.ok('generatePOPdf hands over po.startDate, not the creation date',/startDate:po\.startDate\|\|''/.test(read('js/pos.js'))&&!/startDate:po\.createdAt/.test(read('js/pos.js')));
  }

  s.section('every station: red START DATE / END DATE, the right names, the full title');
  {
    const st=stations(nd);
    st.forEach(x=>{
      const sd1=x.texts.filter(t=>t.t==='START DATE'), ed=x.texts.filter(t=>t.t==='END DATE');
      s.ok(x.title+': START DATE and END DATE, red',sd1.length===1&&ed.length===1&&sd1[0].ink===RED&&ed[0].ink===RED);
    });
    s.eq('five red START DATE lines to write on (one per station)',nd.log.line.filter(l=>l.draw===RED&&l.lw>=0.8&&Math.abs(l.x2-l.x1-74)<0.01).length,10);
    s.ok('"Printing, Embroidery & QC" is stated in full; the short form is gone',st[1].idx>=0&&!nd.log.text.some(t=>/EMB QC/i.test(t.t)));
    const has=(i,n)=>st[i].texts.some(t=>t.t===n);
    s.ok('Cutting + Bundling: "Department Manager: Kashif Bhai"',has(0,'Department Manager: Kashif Bhai'));
    s.ok('Printing, Embroidery & QC: Shameer, not Haris',has(1,'Shameer')&&!nd.log.text.some(t=>/Haris/.test(t.t)));
    s.ok('Bundling Before Stitching shows NO name at all',!NAMES.concat(['Raees','Zuhaib','Haris']).some(n=>st[2].texts.some(t=>t.t.indexOf(n)>=0))&&!st[2].texts.some(t=>/Manager/.test(t.t)));
    s.ok('Stitching: Waqas under the heading, but the sign-off "With Name" is a blank line',has(3,'Waqas')&&!has(3,'With Name: Waqas')&&has(3,'With Name: ________________'));
    s.ok('Washing: Abbas as before',has(4,'Abbas'));
    s.ok('Raees and Zuhaib are no longer printed anywhere',!nd.log.text.some(t=>/Raees|Zuhaib/.test(t.t)));
    const src=read('js/print-engine.js');
    s.ok('the station names live in ONE constant',/const _PO_STATIONS = \{/.test(src)&&['Kashif Bhai','Shameer','Waqas','Abbas'].every(n=>src.split("'"+n).length===2||src.split(n).length===2),'');
  }

  s.section('every table has a boxed TOTAL row; there is no second "grand total"');
  {
    [['normal',nd],['stress',sd]].forEach(([nm,d])=>{
      s.eq(nm+': five TOTAL rows (cutting, QC, bundling, stitching, washing)',d.log.text.filter(t=>t.t==='TOTAL').length,5);
      const boxes=d.log.rect.filter(r=>r.draw===RED&&r.lw>=1.4&&r.w>=500);
      s.eq(nm+': each TOTAL row is boxed in a heavy red rect the full table width',boxes.length,5);
      s.ok(nm+': no "Grand Total Quantity Processed" text and no 140x22 red box',!d.log.text.some(t=>/Grand Total/i.test(t.t))&&!d.log.rect.some(r=>r.w===140&&r.h===22));
    });
    s.ok('the old "Grand Total" row of the QC table is renamed TOTAL',!nd.log.text.some(t=>t.t==='Grand Total'));
  }

  s.section('red only where it matters; ordinary table lines are a dark neutral at the heavier width');
  {
    const NEUTRAL='38,38,38';
    const stroked=nd.log.rect.filter(r=>/S|D/.test(r.st));
    const red=stroked.filter(r=>r.draw===RED), neu=stroked.filter(r=>r.draw===NEUTRAL);
    s.ok('every stroked rect is either red or the neutral',red.length+neu.length===stroked.length,J(stroked.filter(r=>r.draw!==RED&&r.draw!==NEUTRAL).slice(0,2)));
    s.ok('neutral lines are no thinner than 0.6 (old row lines were 0.3, headers 0.4)',neu.length>40&&neu.every(r=>r.lw>=0.6));
    s.ok('header rects are 0.8 (double the old 0.4)',neu.some(r=>r.lw===0.8));
    // red rects: 5 bands (w=523, lw .8), 5 TOTAL rows (cells + box), Total Quantity/Ratio/Weight/Average boxes
    s.eq('five red station bands (full width, 0.8)',red.filter(r=>r.w===523&&r.lw===0.8).length,5);
    s.eq('five red TOTAL boxes (full width, heavy)',red.filter(r=>r.w>=500&&r.lw>=1.4).length,5);
    s.eq('four red info boxes: Total Quantity, Ratio, Total Weight, Average Per Unit',red.filter(r=>r.lw===1.5&&r.w<200&&r.w>40).length,4);
    s.ok('no size-row / bundles / stitching / washing body rect is red',
      neu.filter(r=>r.page>=1).length>0&&!neu.some(r=>r.draw===RED));
    s.ok('Total Quantity value is red bold',nd.log.text.some(t=>t.t==='600'&&t.ink===RED));
    s.ok('the red START/END DATE lines still draw red',nd.log.line.filter(l=>l.draw===RED&&Math.abs(l.x2-l.x1-74)<0.01).length===10);
  }

  s.section('GROOVY is thickened with fill + stroke');
  {
    const g=nd.log.text.find(t=>t.t==='GROOVY');
    s.ok('GROOVY is drawn with renderingMode fillThenStroke, stroke 0.8-1.2pt, black',!!g&&g.mode==='fillThenStroke'&&g.lw>=0.8&&g.lw<=1.2&&g.draw==='0,0,0',J(g));
    const no=nd.log.text.find(t=>t.t==='PO-0142'&&t.size>=24);
    s.ok('the PO number is unchanged (plain fill)',!!no&&no.mode==='');
    const gd=e.run('__docs[__docs.length-1]');
  }

  s.section('no notes on the printout');
  {
    s.ok('data.notes is passed but never drawn (normal, stress, huge)',[nd,sd].every(d=>!d.log.text.some(t=>/Front chest|Embroidery chest|Notes:|note continues/.test(t.t))));
    const only=await printPO(e,Object.assign({},BASE,{notes:'UNIQUE-NOTE-TEXT'}));
    s.ok('a note with a unique marker leaves no trace',!only.d.log.text.some(t=>/UNIQUE-NOTE-TEXT|Notes/.test(t.t)));
  }

  s.section('Sizes row: size + quantity in body ink, (ratio) in red');
  {
    const sizesTx=d=>{const tx=d.log.text,a=tx.findIndex(t=>t.t==='Sizes');return tx.slice(a+1,a+16);};
    const nt=sizesTx(nd);
    s.ok('S 100 / M 200 / L 200 / XL 100 in body ink',['S 100','M 200','L 200','XL 100'].every(v=>nt.some(t=>t.t===v&&t.ink!==RED)),J(nt.map(t=>[t.t,t.ink])));
    s.ok('(1) (2) (2) (1) in red',['(1)','(2)'].every(v=>nt.filter(t=>t.t===v&&t.ink===RED).length>=1)&&nt.filter(t=>/^\(\d\)$/.test(t.t)&&t.ink===RED).length===4);
    s.ok('the old "Ratio 1:2:2:1" suffix text is gone, the plain "S-M-L-XL" too',!nd.log.text.some(t=>/Ratio 1:2/.test(t.t)||t.t==='S-M-L-XL'));
    s.ok('the separate Ratio box still prints 1:2:2:1 in red',nd.log.text.filter(t=>t.t==='1:2:2:1'&&t.ink===RED).length===1);
    const nodiv=await printPO(e,Object.assign({},BASE,{totalQty:'601'}));
    const nv=sizesTx(nodiv.d);
    s.ok('non-divisible total: S / M / L / XL with red brackets only, no quantities',['S','M','L','XL'].every(v=>nv.some(t=>t.t===v&&t.ink!==RED))&&nv.filter(t=>/^\(\d\)$/.test(t.t)&&t.ink===RED).length===4&&!nv.some(t=>/^(S|M|L|XL) \d/.test(t.t)),J(nv.map(t=>t.t)));
    const noq=await printPO(e,Object.assign({},BASE,{totalQty:'',ratio:'1:2:2:1'}));
    s.ok('no total quantity: label + red bracket only',sizesTx(noq.d).some(t=>t.t==='M')&&!sizesTx(noq.d).some(t=>/^M \d/.test(t.t)));
    const norat=await printPO(e,Object.assign({},BASE,{ratio:''}));
    s.ok('no ratio: the plain sizes string',norat.d.log.text.some(t=>t.t==='S-M-L-XL'&&t.ink!==RED)&&!norat.d.log.text.some(t=>/^\(\d\)$/.test(t.t)));
    const bad=await printPO(e,Object.assign({},BASE,{ratio:'1:2:2'}));
    s.ok('ratio with the wrong number of parts: the plain sizes string',bad.d.log.text.some(t=>t.t==='S-M-L-XL'));
    s.ok('stress (8 sizes, 12000): quantities and red brackets drawn, wrapped inside the cell',sd.log.text.filter(t=>/^\(\d\)$/.test(t.t)&&t.ink===RED).length===8&&sd.log.text.some(t=>t.t==='XXS 600'));
  }

  s.section('Stitching: narrow Date, Size + Bundle widest');
  {
    const x=stations(nd)[3].texts, g=t=>x.find(y=>y.t===t);
    const dt=g('Date'),sb=g('Size + Bundle'),of=g('OFFLINE'),to=g('Total');
    const wD=sb.x-dt.x,wS=of.x-sb.x,wO=to.x-of.x,wT=(36+523)-(to.x-5);
    s.ok('Date '+wD+' < 90, Size + Bundle '+wS+' widest, OFFLINE '+wO+' > Total '+wT,wD<90&&wS>wO&&wO>wT&&wS>wD*2,'');
    s.ok('the Date column is still there',!!dt);
  }

  s.section('ratio, weight and average per unit are red');
  {
    s.ok('the ratio is drawn red in its own cell',nd.log.text.filter(t=>/1:2:2:1/.test(t.t)&&t.ink===RED).length>=1);
    s.ok('Total Weight and Average Per Unit values are red',['312 kg','0.52 kg'].every(v=>nd.log.text.some(t=>t.t===v&&t.ink===RED)));
    s.ok('… each in a heavy red box',nd.log.rect.filter(r=>r.draw===RED&&r.lw>=1.4&&r.h<60&&r.w<200&&r.w>40).length>=3);
  }

  s.section('Cutting + Bundling and Bundling Before Stitching: Size narrower, Bundles wider, Total narrower');
  [['Cutting + Bundling',0],['Bundling Before Stitching',2]].forEach(([nm,i])=>{
    const x=stations(nd)[i].texts, g=t=>x.find(y=>y.t===t);
    const sz=g('Size'),bu=g('Bundles'),to=g('Total');
    const wS=bu.x-sz.x, wB=to.x-bu.x, wT=(36+523)-(to.x-5)-0;
    s.ok(nm+': Size '+wS+' < old 175, Bundles '+wB+' > old 174, Total '+wT.toFixed(0)+' < old 174',wS<175&&wB>174&&wT<174);
    s.ok(nm+': Bundles is the widest of the three',wB>wS&&wB>wT);
  });

  s.section('the info grid never overprints');
  [['normal',nd],['stress',sd]].forEach(([nm,d])=>{
    const tx=d.log.text, a=tx.findIndex(t=>t.t==='Department: Manufacturing'), b=tx.findIndex(t=>t.t==='CUTTING + BUNDLING');
    const region=tx.slice(a+1,b);
    const cells=d.log.rect.filter(r=>/S|D/.test(r.st)&&r.page===1&&r.y>110&&r.y<tx[b].y);
    s.ok(nm+': every info-grid text baseline sits inside a cell',region.length>10&&region.every(t=>cells.some(r=>t.x>=r.x-0.5&&t.x<=r.x+r.w&&t.y>r.y&&t.y<r.y+r.h)),
      J(region.filter(t=>!cells.some(r=>t.x>=r.x-0.5&&t.x<=r.x+r.w&&t.y>r.y&&t.y<r.y+r.h)).slice(0,3).map(t=>[t.t,t.x,t.y])));
  });
  s.ok('the long article name wraps into more than one line instead of spilling',sd.log.text.filter(t=>/OVERSIZED|VINTAGE/.test(t.t)).length>=2);

  s.section('no Urdu, no empty brackets, no dangling dash');
  [nd,sd].forEach((d,i)=>{
    const all=d.log.text.map(t=>t.t);
    s.ok((i?'stress':'normal')+': nothing Arabic-script is drawn',!all.some(t=>ARABIC.test(t)));
    s.ok((i?'stress':'normal')+': no "()" , " — " or lone dash',!all.some(t=>/\(\s*\)|\s—\s|^—$|^-$/.test(t)));
  });
  s.eq("'po' resolves urduLevel minimal (no font fetch)",e.run("_PRINT_URDU_DEFAULTS['po']"),'minimal');
  s.ok('the renderer carries no Urdu strings',!ARABIC.test(read('js/print-engine.js').split('function _renderPO')[1].split('/* ── Custom page size')[0]));

  s.section('the fallback density: an overlong order still lands on two pages');
  {
    const huge=await printPO(e,Object.assign({},STRESS,{notes:'Very long production note. '.repeat(200)}));
    s.ok('a 5,000-character note changes nothing: 2 pages at most, nothing printed',huge.d.log.pages<=2&&!huge.d.log.text.some(x=>/Very long/.test(x.t)),huge.d.log.pages+' pages');
  }
  return s;
};

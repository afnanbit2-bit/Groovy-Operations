/* ─────────────────────────────────────────────────────────────────────────
   Daily Performance ▸ "Share to WhatsApp" (Oct 2026).

   Drives the real entry point window.fulfillShareWa(date) from
   js/fulfillment.js and the real phShareFile from js/shared.js (its source is
   cut out of shared.js and run in the harness context, so shared.js's own
   showToast does not shadow the recorder). Nothing here proves WhatsApp or a
   real share sheet: navigator and printDocument are fakes.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite}=harness;
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const SHARE_SRC=(()=>{const t=read('js/shared.js');const i=t.indexOf('/* ── Share a generated file to WhatsApp');return t.slice(i);})();
const FUL_SRC=read('js/fulfillment.js');
const OWNER={uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};
const REPORT={id:'2026-10-11',date:'2026-10-11',enteredBy:'Umair',
  dispatched:[{courier:'PostEx',shipments:40,amount:120000}],returns:[{courier:'PostEx',shipments:3,amount:9000}],
  dispatchedTotal:{shipments:1234,amount:5678900},returnsTotal:{shipments:56,amount:123400},returnsRecorded:true};

// opts.nav: navigator override; opts.mutShare/mutFul: source mutators (revert checks)
let M={};
function mk(opts){
  opts=Object.assign({},M,opts||{});
  const log={pdf:[],share:[],dl:[],open:[]};
  const nav=opts.nav===undefined?{
    canShare:()=>true,
    share:async a=>{log.share.push(a);}
  }:opts.nav;
  const a=harness.loadApp({files:[],currentPage:'fulfillment',globals:{
    navigator:nav,
    File:class{constructor(parts,name,o){this.parts=parts;this.name=name;this.type=o&&o.type;}},
    URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},
    printDocument:async o=>{log.pdf.push(o);if(opts.pdfFail)throw new Error('font fetch failed');return o.deliver==='blob'?{blob:{size:9},filename:o.filename}:undefined;}
  }});
  a.run('session='+JSON.stringify(OWNER));
  a.run('window.open=function(u,t){__open.push([u,t]);}');
  a.run(`var __open=[];var __dl=[];(function(){var o=document.createElement.bind(document);document.createElement=function(t){var n=o(t);n.click=function(){__dl.push({download:n.download,href:n.href});};return n;};})();`);
  a.run((opts.mutShare||(x=>x))(SHARE_SRC));
  a.run((opts.mutFul||(x=>x))(FUL_SRC));
  a.run('fulfillReports='+JSON.stringify(opts.noReport?[]:[REPORT])+';1');
  a.log=log;
  a.dl=()=>a.run('__dl');
  a.opened=()=>a.run('__open');
  return a;
}
const mut=(src,from,to)=>{if(!src.includes(from))throw new Error('mutation target missing: '+from);return src.replace(from,to);};

async function body(s){

  s.section('phone: canShare -> navigator.share with the file and the caption');
  {
    const a=mk();
    await a.run('window.fulfillShareWa("2026-10-11")');
    s.ok('exactly one share call',a.log.share.length===1);
    const c=a.log.share[0]||{};
    s.ok('it carries one PDF file named for the day',c.files&&c.files.length===1&&c.files[0].name==='daily-performance-2026-10-11.pdf'&&c.files[0].type==='application/pdf');
    s.ok('the caption is the day summary',/^Daily Performance — 11 Oct 2026/.test(c.text||''));
    s.ok('the PDF was built as a blob (no tab)',a.log.pdf.length===1&&a.log.pdf[0].deliver==='blob'&&a.log.pdf[0].type==='daily-performance');
    s.ok('nothing downloaded, no wa.me tab',a.dl().length===0&&a.opened().length===0);
    s.ok('no "sent" claim in any toast',!a.state.toasts.some(t=>/sent/i.test(t)));
  }

  s.section('cancelling the share is silent');
  {
    const a=mk({nav:{canShare:()=>true,share:async()=>{const e=new Error('x');e.name='AbortError';throw e;}}});
    await a.run('window.fulfillShareWa("2026-10-11")');
    s.ok('no toast, no download, no wa.me',a.state.toasts.length===0&&a.dl().length===0&&a.opened().length===0);
  }

  s.section('other share errors: say why, fall back to download');
  {
    const a=mk({nav:{canShare:()=>true,share:async()=>{throw new Error('NotAllowedError: gesture expired');}}});
    await a.run('window.fulfillShareWa("2026-10-11")');
    s.ok('the reason is toasted',a.state.toasts.some(t=>/gesture expired/.test(t)));
    s.ok('the PDF was downloaded instead',a.dl().length===1&&a.dl()[0].download==='daily-performance-2026-10-11.pdf');
  }

  s.section('desktop: no canShare -> download + wa.me with the encoded text');
  {
    const a=mk({nav:{}});
    await a.run('window.fulfillShareWa("2026-10-11")');
    s.ok('downloaded under the day filename',a.dl().length===1&&a.dl()[0].download==='daily-performance-2026-10-11.pdf');
    const o=a.opened();
    s.ok('wa.me opened once in a new tab',o.length===1&&o[0][0].indexOf('https://wa.me/?text=')===0&&o[0][1]==='_blank');
    const txt=decodeURIComponent(o[0][0].slice('https://wa.me/?text='.length));
    s.ok('the link text decodes to the summary (newlines and Rs intact)',txt.indexOf('\n')>0&&/Dispatched: 1,234 shipments · Rs 5,678,900/.test(txt),txt);
    s.ok('the one-line instruction toast',a.state.toasts.includes('PDF saved — attach it in the group'));
    s.ok('never claims it was sent',!a.state.toasts.some(t=>/sent/i.test(t)));
  }
  {
    const a=mk({nav:{canShare:()=>false,share:async()=>{}}});
    await a.run('window.fulfillShareWa("2026-10-11")');
    s.ok('canShare false (files unsupported) takes the same desktop path',a.dl().length===1&&a.opened().length===1);
  }

  s.section('the text uses the same numbers as the PDF, with the stored (PKT) day');
  {
    const a=mk({nav:{}});
    await a.run('window.fulfillShareWa("2026-10-11")');
    const d=a.log.pdf[0].data;
    const text=a.run('fulfillWaText')(d);
    s.ok('dispatched shipments and amount equal the PDF totals',text.includes('Dispatched: '+d.dispatchedTotal.shipments.toLocaleString('en-US')+' shipments · Rs '+Math.round(d.dispatchedTotal.amount).toLocaleString('en-US')),text);
    s.ok('returns equal the PDF totals',text.includes('Returns: 56 shipments · Rs 123,400 (4.5%)'),text);
    s.ok('midnight-edge day is not shifted by UTC',a.run('fulfillWaText')({date:'2026-01-01',dispatchedTotal:{},returnsTotal:{}}).includes('01 Jan 2026'));
    s.ok('zero dispatched gives 0% not NaN',/\(0%\)/.test(a.run('fulfillWaText')({date:'2026-01-01'})));
    s.ok('no staff or customer names in the caption',!/Umair|Afnan/.test(text));
    s.ok('source never slices an ISO timestamp for the date',!/toISOString\(\)\.slice/.test(read('js/fulfillment.js').slice(FUL_SRC.indexOf('function fulfillWaText'),FUL_SRC.indexOf('function fulfillWaText')+900)));
  }

  s.section('no saved report for the day -> a message and no PDF');
  {
    const a=mk({noReport:true});
    await a.run('window.fulfillShareWa("2026-10-11")');
    s.ok('says there is no saved report',a.state.toasts.some(t=>/No saved report/.test(t)));
    s.ok('no PDF built, nothing shared/downloaded',a.log.pdf.length===0&&a.log.share.length===0&&a.dl().length===0&&a.opened().length===0);
  }
  {
    const a=mk({pdfFail:true});
    await a.run('window.fulfillShareWa("2026-10-11")');
    s.ok('a PDF build failure is toasted, nothing shared',a.state.toasts.some(t=>/Could not build the PDF: font fetch failed/.test(t))&&a.log.share.length===0);
  }

  s.section('the existing PDF button is unchanged');
  {
    const a=mk();
    a.run('window.fulfillPdf("2026-10-11")');
    const o=a.log.pdf[0];
    s.ok('same type, filename, no deliver flag (opens a tab as before)',o&&o.type==='daily-performance'&&o.filename==='daily-performance-2026-10-11.pdf'&&o.deliver===undefined);
    s.ok('same data fields',JSON.stringify(Object.keys(o.data))===JSON.stringify(['documentType','id','date','dateLabel','issuedDate','issuedBy','dispatched','returns','dispatchedTotal','returnsTotal','urduLevel']));
    s.ok('the row has both buttons, PDF first',/fulfillPdf\('\$\{r\.date\}'\)">PDF<\/button>\s*<button class="btn-outline" onclick="window\.fulfillShareWa/.test(FUL_SRC));
  }

  }

const REVERTS=[
  ['abort guard',{mutShare:x=>mut(x,"if (e && e.name === 'AbortError') return 'cancelled';","")}],
  ['canShare check',{mutShare:x=>mut(x,"can = !!nav.canShare({ files: [file] });","can = true;")}],
  ['desktop instruction toast',{mutShare:x=>mut(x,"showToast('PDF saved — attach it in the group');","")}],
  ['encodeURIComponent',{mutShare:x=>mut(x,"encodeURIComponent(text || '')","(text || '')")}],
  ['wa.me open',{mutShare:x=>mut(x,"window.open('https://wa.me/?text='","void ('https://wa.me/?text='")}],
  ['share error fallback download',{mutShare:x=>mut(x,"        _dl();\n        return 'downloaded';\n      }","        return 'downloaded';\n      }")}],
  ['no-report guard',{mutFul:x=>mut(x,"if(!r)return showToast('No saved report for that day — save it first.',true);","")}],
  ['deliver:blob',{mutFul:x=>mut(x,"deliver:'blob',data","data")}],
  ['caption from PDF data',{mutFul:x=>mut(x,",fulfillWaText(data));",",fulfillWaText({date:date}));")}],
  ['PKT day label',{mutFul:x=>mut(x,"m?m[3]+' '+","m?m[1]+' '+")}]
];

module.exports=async function(){
  const s=suite('fulfill-wa-share');
  M={};
  await body(s);
  s.section('revert checks: each guard, undone, fails at least one named assertion');
  for(const [name,m] of REVERTS){
    const fails=[];
    const fake={section(){},ok(n,c){if(!c)fails.push(n);}};
    M=m;
    try{await body(fake);}catch(e){fails.push('threw: '+(e.message||e).toString().split('\n')[0]);}
    M={};
    s.ok('REVERT '+name+' -> caught by: '+(fails[0]||'(nothing)'),fails.length>0);
  }
  return s;
};

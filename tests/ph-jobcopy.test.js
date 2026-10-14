/* WP3c: typed product instructions on the job copies (js/print-engine.js _renderEmbroideryJob / _renderPrintingJob, fed by js/pos.js
   generate*JobPdf from po.instructions) and the read-only instruction card in Today's Cutting (js/ph-mod-cutting.js phkInstructionsCard).

   Drives the REAL print engine against a recording fake jsPDF (the job-print.test.js one, taken from that file), the REAL generate*JobPdf
   with a recording printDocument, and the REAL card builder over tests/ph-dom.js. Each "break" mutates one source and requires the named
   check to FAIL. Not proven: how the page looks on paper (a recording fake, not a printer), real Firestore, a real screen. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const PE=read('js/print-engine.js'),POS=read('js/pos.js'),CUT=read('js/ph-mod-cutting.js'),UI=read('js/ph-ui.js'),CSS=read('css/main.css');
const J=JSON.stringify;
const ARABIC=/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const TYPED_INK='31,58,138';
const FAKE=new Function('return `'+/const FAKE=`([\s\S]*?)`;\n/.exec(read('tests/job-print.test.js'))[1]+'`')();
const BASE={documentType:'Embroidery Job',documentNumber:'PO-0142',poNumber:'PO-0142',articleName:'EFFORTLESS TEE | DEEP BLUE',articleCode:'GST073',
  __productImg:{dataUrl:'data:image/png;base64,AAAA',fmt:'PNG',w:600,h:800}};
const INS={placements:[{en:'Left chest',ur:'بائیں سینہ',side:'Front'},{en:'Back neck',ur:'',side:'Back'}],
  pantones:[{system:'C',code:'485',name:'Red',hex:'#DA291C',use:'logo'},{system:'TCX',code:'19-1664',name:'True Red',hex:'',use:''}],
  embroidery:[{code:'EMB-12',candle:'C-204',shade:'Navy 3',position:'Left chest',note:'4 cm'}],notes:{en:'Match the sample',ur:'نمونے کے مطابق'}};

function engine(src){
  const globals={console:{log(){},info(){},error(){},warn(){}},URL:{createObjectURL(){throw new TypeError('x');},revokeObjectURL(){}}};
  const e=harness.loadApp({files:[],currentPage:'dashboard',globals});
  vm.runInContext(src||PE,e.ctx,{filename:'print-engine.js'});
  e.run(FAKE);
  return e;
}
async function printJob(e,data,type){
  const n=e.run('__docs.length');
  await e.run('window.printDocument('+J({type,filename:'j.pdf',deliver:'blob',data})+')');
  return e.run('__docs['+n+']');
}
const typedRows=d=>d.log.text.filter(t=>t.ink===TYPED_INK&&t.style==='bold'&&t.size===10);
const geom=d=>J({r:d.log.rect,l:d.log.line,p:d.log.pages});
const plain=d=>J(d.log.text.map(t=>[t.t,t.x,t.y,t.size,t.style,t.ink]));

function cardLoad(src,user){
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:user||{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},currentPage:'dashboard',
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
  const ctx=a.ctx;ctx.phI18nSetLang('en');
  const dom=domkit.install(ctx);
  ctx.console={warn(){},log(){},error(){}};
  vm.runInContext(UI,ctx,{filename:'ph-ui.js'});
  vm.runInContext(src||CUT,ctx,{filename:'ph-mod-cutting.js'});
  return{a,ctx,dom,card:e=>a.run('phkInstructionsCard('+J(e)+')')};
}
// run in the context so the node it returns is the harness's DOM (the card builder itself is called there)
function cardOf(T,entry){T.ctx.__e=entry;return T.ctx.eval?T.ctx.eval('phkInstructionsCard(__e)'):vm.runInContext('phkInstructionsCard(__e)',T.ctx);}
const hasTag=(T,n,re)=>T.dom.all(n,x=>re.test(x.tagName)).length>0;

async function body(pe,pos,cut,only){
  const o={};
  const e=engine(pe);
  /* ── the print engine ── */
  const base=await printJob(e,BASE,'embroidery-job');
  const emb=await printJob(e,Object.assign({},BASE,{instructions:INS}),'embroidery-job');
  const typedE=typedRows(emb).map(t=>t.t);
  o['embroidery: placement and embroidery values are TYPED (Front · Left chest, Back · Back neck; code, candle, shade, position, note)']=
    typedE.indexOf('Front · Left chest')>-1&&typedE.indexOf('Back · Back neck')>-1&&typedE.indexOf('EMB-12 · candle C-204 · shade Navy 3 · Left chest · 4 cm')>-1;
  o['embroidery: typed text has its own style (bold 10pt ink-blue) that no other text on the page uses']=
    typedE.length===3&&emb.log.text.filter(t=>t.ink===TYPED_INK).length===3&&!base.log.text.some(t=>t.ink===TYPED_INK);
  o['embroidery: the typed lines sit ON the ruled lines (just above a drawn line) inside the PLACEMENT / CANDLE boxes']=
    typedRows(emb).every(t=>emb.log.line.some(l=>Math.abs(l.y1-t.y)<=5&&l.y1>t.y&&t.x>=l.x1-1));
  o['embroidery: page count and every box, line and rule are exactly the handwritten sheet (layout unchanged, one A4 page)']=
    emb.log.pages===1&&J({r:emb.log.rect,l:emb.log.line})===J({r:base.log.rect,l:base.log.line});
  o['embroidery: everything that is not typed is the same text in the same place as the handwritten sheet']=
    plain({log:{text:emb.log.text.filter(t=>t.ink!==TYPED_INK)}})===plain(base);
  o['embroidery: START DATE is still handwritten (the label is there, no date is typed, nothing is typed beside it)']=
    emb.log.text.some(t=>/^START DATE/.test(t.t))&&!emb.log.text.some(t=>/\d{4}-\d\d-\d\d|\d\d\/\d\d\/\d{4}/.test(t.t));
  const prn=await printJob(e,Object.assign({},BASE,{instructions:INS}),'printing-job');
  const prb=await printJob(e,BASE,'printing-job');
  const typedP=typedRows(prn).map(t=>t.t);
  o['printing: placement and Pantone codes are TYPED (485 C · Red · logo; 19-1664 TCX · True Red); embroidery codes are not printed on the printing copy']=
    typedP.indexOf('485 C · Red · logo')>-1&&typedP.indexOf('19-1664 TCX · True Red')>-1&&typedP.indexOf('Front · Left chest')>-1&&!typedP.some(t=>/EMB-12/.test(t));
  o['printing: layout unchanged (same rects, lines, one page)']=J({r:prn.log.rect,l:prn.log.line,p:prn.log.pages})===J({r:prb.log.rect,l:prb.log.line,p:prb.log.pages});
  /* empty fields keep their blank lines */
  const partial=await printJob(e,Object.assign({},BASE,{instructions:{placements:[{en:'Left chest',ur:'',side:''}],pantones:[],embroidery:[],notes:{}}}),'printing-job');
  o['empty field: a snapshot with placement only types the placement; the Pantone box prints no text and keeps all five of its ruled lines']=
    typedRows(partial).length===1&&geom(partial)===geom(prb);
  const none=await printJob(e,Object.assign({},BASE,{instructions:{placements:[],pantones:[],embroidery:[],notes:{en:'',ur:''}}}),'embroidery-job');
  o['no values: an empty snapshot prints the same draw calls as no snapshot at all (text, rects and lines identical)']=
    plain(none)===plain(base)&&geom(none)===geom(base);
  o['no snapshot: output has no typed row and no Urdu letter']=typedRows(base).length===0&&!base.log.text.some(t=>ARABIC.test(t.t));
  const junk=await printJob(e,Object.assign({},BASE,{instructions:'oops'}),'embroidery-job');
  const junk2=await printJob(e,Object.assign({},BASE,{instructions:{placements:'x',pantones:[null,3,{code:7}],embroidery:{a:1},notes:null}}),'embroidery-job');
  o['junk: a snapshot that is not a map, or holds junk rows, prints exactly the handwritten sheet and does not throw']=plain(junk)===plain(base)&&plain(junk2)===plain(base)&&geom(junk2)===geom(base);
  /* Urdu never reaches doc.text */
  const urd=await printJob(e,Object.assign({},BASE,{instructions:{placements:[{en:'',ur:'بائیں سینہ',side:'Front'},{en:'جیب Pocket',ur:'',side:''},{en:'Hem',ur:'',side:''}],pantones:[],embroidery:[{code:'EMB',candle:'کینڈل',shade:'',position:'',note:''}],notes:{en:'',ur:'اردو'}}}),'embroidery-job');
  o['urdu: no Arabic-script letter ever reaches doc.text; an Urdu-only placement is skipped, a mixed string is dropped whole, Latin rows still print']=
    !urd.log.text.some(t=>ARABIC.test(t.t))&&typedRows(urd).map(t=>t.t).indexOf('Hem')>-1&&!typedRows(urd).some(t=>/Pocket|Front/.test(t.t));
  /* overflow */
  const many=Array.from({length:12},(_,i)=>({en:'Place '+i,ur:'',side:''}));
  const mn=await printJob(e,Object.assign({},BASE,{instructions:{placements:many,pantones:[],embroidery:[],notes:{}}}),'embroidery-job');
  o['overflow: 12 placements in a 3-line box print 2 rows and "+ 10 more", still one page, same geometry']=
    typedRows(mn).length===3&&typedRows(mn)[2].t==='+ 10 more (see product instructions)'&&mn.log.pages===1&&geom(mn)===geom(base);
  /* hostile */
  const hos=await printJob(e,Object.assign({},BASE,{instructions:{placements:[{en:'<img src=x onerror=alert(1)>',ur:'',side:''}],pantones:[],embroidery:[],notes:{}}}),'embroidery-job');
  o['hostile: markup in a value is drawn as plain text (a doc.text string), nothing is parsed or executed']=typedRows(hos)[0]&&typedRows(hos)[0].t==='<img src=x onerror=alert(1)>';
  /* the callers */
  const cap=harness.loadApp({files:[],currentPage:'dashboard',globals:{allPOs:[]}});
  vm.runInContext(pos,cap.ctx,{filename:'pos.js'});
  cap.run('window.__sent=[];window.printDocument=function(o){window.__sent.push(o);return Promise.resolve();};');
  cap.run('window.generateEmbroideryJobPdf('+J({id:'PO-1',name:'T',code:'GST073',imgFront:'',instructions:INS})+');window.generatePrintingJobPdf('+J({id:'PO-1',name:'T',code:'GST073',imgFront:'',instructions:INS})+');'+
    'window.generateEmbroideryJobPdf('+J({id:'PO-2',name:'T',code:'G',imgFront:''})+');window.generatePrintingJobPdf('+J({id:'PO-2',name:'T',code:'G',imgFront:'',instructions:'x'})+');');
  const sent=cap.run('window.__sent');
  o['callers: the PO snapshot is handed to the engine by the embroidery and printing generators']=sent[0].data.instructions&&sent[0].data.instructions.pantones.length===2&&sent[1].data.instructions&&sent[1].data.instructions.embroidery.length===1;
  o['callers: a PO with no snapshot (or a junk one) sends data with NO instructions key, exactly as before']=!('instructions' in sent[2].data)&&!('instructions' in sent[3].data)&&J(Object.keys(sent[2].data))===J(['documentType','documentNumber','id','poNumber','articleName','articleCode','productImage']);
  /* ── the card ── */
  const T=cardLoad(cut);
  const ok=(extra)=>({state:'ok',data:Object.assign({id:'PO-001',instructions:INS,instructionsRev:3},extra||{})});
  const c1=cardOf(T,ok());
  const txt=c1.textContent;
  o['card: shows placement, Pantone code with its name, embroidery codes, notes and the revision the PO was issued with']=
    /Front · Left chest/.test(txt)&&/485 C · Red · logo/.test(txt)&&/19-1664 TCX · True Red/.test(txt)&&/EMB-12 · candle C-204 · shade Navy 3/.test(txt)&&/Match the sample/.test(txt)&&/revision 3/.test(txt);
  const sw=T.dom.all(c1,n=>/phk-ins-sw/.test(n.className));
  o['card: a Pantone swatch is drawn from the validated stored hex (485 C), none for a code with no known colour']=sw.length===1&&sw[0].style.background==='#DA291C';
  const ur=T.dom.all(c1,n=>n.getAttribute('lang')==='ur'&&/phk-ins-ur/.test(n.className));
  o['card: the Urdu placement and note are on screen as real text with lang="ur" dir="rtl" (the browser shapes it)']=ur.length===2&&ur.every(n=>n.getAttribute('dir')==='rtl')&&/بائیں سینہ/.test(txt);
  o['card: Kashif sees the card and no edit control at all (no button, input, textarea, select, link)']=!hasTag(T,c1,/^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/);
  const none2=cardOf(T,ok({instructions:undefined}));
  o['card: a PO with no snapshot says "No saved instructions for this product." (never blank, never a zero)']=/No saved instructions for this product\./.test(none2.textContent)&&!/\b0\b/.test(none2.textContent);
  const emptyS=cardOf(T,ok({instructions:{placements:[],pantones:[],embroidery:[],notes:{en:'',ur:''}}}));
  o['card: an EMPTY snapshot reads the same as none']=/No saved instructions for this product\./.test(emptyS.textContent);
  const bad=cardOf(T,{state:'error',data:null,text:'pos/PO-001: read failed (permission-denied).'});
  o['card: an unreadable PO says so by name, and does not claim there are no instructions']=/Instructions unavailable: pos\/PO-001: read failed/.test(bad.textContent)&&!/No saved instructions/.test(bad.textContent);
  o['card: while the PO is still loading there is no card (nothing is claimed)']=cardOf(T,{state:'loading'})===null;
  const hc=cardOf(T,ok({instructions:{placements:[{en:'<img src=x onerror=alert(1)>',ur:'',side:'<b>x</b>'}],pantones:[{system:'C',code:'485',name:'"><script>1</script>',hex:'url(javascript:1)',use:''},{system:'C',code:'1795',name:'x',hex:'#GGGGGG',use:''}],embroidery:[],notes:{en:'',ur:''}}}));
  o['card: hostile strings stay text (no element is created from them) and a non-hex colour is never set as a style']=
    /<img src=x onerror=alert\(1\)>/.test(hc.textContent)&&!T.dom.all(hc,n=>/^(IMG|SCRIPT|B)$/.test(n.tagName)).length&&T.dom.all(hc,n=>/phk-ins-sw/.test(n.className)).every(n=>!/javascript/.test(n.style.background||''));
  /* urdu-first for Kashif: the headings come as an Urdu block above the English line */
  T.ctx.phI18nSetLang('ur-first');
  const u1=cardOf(T,ok());
  o['card: Urdu-first for Kashif: the title and headings are Urdu blocks (lang="ur" dir="rtl") above the English line']=
    T.dom.all(u1,n=>n.getAttribute('lang')==='ur'&&n.getAttribute('dir')==='rtl'&&/ہدایات/.test(n.textContent)).length>0&&/Product instructions/.test(u1.textContent);
  T.ctx.phI18nSetLang('en');
  o['i18n: the card keys exist and are flagged for an Urdu reviewer']=['cut.instr_title','cut.instr_none','cut.instr_unread','cut.instr_placement','cut.instr_pantone','cut.instr_embroidery','cut.instr_notes','cut.instr_rev']
    .every(k=>T.a.run('phI18nHas('+J(k)+')')&&T.a.run('phI18nReviewKeys().indexOf('+J(k)+')')>-1);
  /* source scans */
  const cardSrc=/function phkInstructionsCard[\s\S]*?\n}\n/.exec(cut)[0];
  o['read scope: the card reads the PO snapshot only (no ph_article_instructions read, no Firestore call) and has no write or handler']=
    !/ph_article_instructions|getDoc|getDocs|setDoc|updateDoc|addEventListener|onclick/.test(cardSrc)&&/entry\.data\.instructions/.test(cardSrc)&&!/ph_article_instructions/.test(cut);
  o['XSS: neither the engine additions nor the card assign innerHTML']=!/innerHTML|outerHTML|insertAdjacentHTML/.test(cardSrc)&&!/_jobTyped[\s\S]{0,2000}innerHTML/.test(pe);
  o['engine: the typed text goes through doc.text only after the Arabic-script filter']=/const _JOB_TYPED_INK/.test(pe)&&/\\u0600-\\u06FF/.test(/function _jobTypedStr[\s\S]*?\n}/.exec(pe)[0]);
  return o;
}
const NAMES=[];
module.exports=async function(){
  const s=suite('ph-jobcopy');
  const res=await body(PE,POS,CUT);
  Object.keys(res).forEach(k=>{NAMES.push(k);s.ok(k,!!res[k]);});
  s.section('wiring');
  const html=read('index.html'),sw=read('sw.js');
  s.ok('CACHE_VERSION is v323 or later (v325 by WP7)',/CACHE_VERSION = 'v32[345]'/.test(sw));
  const tag=f=>(new RegExp('/'+f.replace(/\./g,'\\.')+'\\?v=([0-9a-z]+)').exec(html)||[])[1];
  const tags=['js/print-engine.js','js/pos.js','js/ph-i18n.js','js/ph-mod-cutting.js','css/main.css'].map(tag);
  s.ok('the five changed files carry distinct ?v tags',tags.every(Boolean)&&new Set(tags).size===5&&true);
  const a=CSS.indexOf('/* ph-mod-jobcopy START */'),b=CSS.indexOf('/* ph-mod-jobcopy END */');
  const blk=CSS.slice(a,b);
  s.ok('one delimited CSS block, at the end of the stylesheet',a>0&&b>a&&CSS.slice(b+'/* ph-mod-jobcopy END */'.length).trim()===''&&CSS.split('/* ph-mod-jobcopy START */').length===2);
  s.ok('tokens only: no literal colour; every selector .phk-ins prefixed',!/#[0-9a-fA-F]{3,8}\b/.test(blk.replace(/\/\*[\s\S]*?\*\//g,''))&&(blk.match(/[^{}]+(?=\{)/g)||[]).filter(x=>!/\/\*/.test(x)||true).every(x=>/\.phk-ins/.test(x)||/START|END|^\s*$/.test(x)));
  s.ok('card text is 13px or more',!/font-size:(?:[0-9]|1[0-2])(?:\.\d+)?px/.test(blk));
  /* breaks */
  s.section('each guard reverted once');
  const brk=async(name,file,from,to,names)=>{
    const src={PE,POS,CUT}[file];
    const fr=[].concat(from),tt=[].concat(to);
    if(fr.some(f=>src.indexOf(f)<0)){s.ok('break "'+name+'" applies',false);return;}
    let m=src;fr.forEach((f,i)=>{m=m.replace(f,tt[i]);});
    let r;try{r=await body(file==='PE'?m:PE,file==='POS'?m:POS,file==='CUT'?m:CUT);}catch(e){r={__threw:false};}
    names.forEach(n=>s.ok('revert '+name+' -> fails: '+n.slice(0,70),!r[n]));
  };
  await brk('typed lines never drawn','PE',"  _jobTypedOn(doc, y, w, n, lineH, typed);\n","",[NAMES[0],NAMES[1]]);
  await brk('typed text in the handwriting ink','PE',"_setFont(doc, PRINT_FONTS.bodyRegular, 'bold', _JOB_TYPED_PT, _JOB_TYPED_INK);","_setFont(doc, PRINT_FONTS.bodyRegular, 'bold', 8, '#262626');",[NAMES[1]]);
  await brk('Arabic filter removed','PE',"if (/[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/.test(t)) return '';","",['urdu: no Arabic-script letter ever reaches doc.text; an Urdu-only placement is skipped, a mixed string is dropped whole, Latin rows still print']);
  await brk('overflow not capped','PE',"typed.length > n ? typed.slice(0, n - 1).concat(['+ ' + (typed.length - (n - 1)) + ' more (see product instructions)']) : typed","typed",['overflow: 12 placements in a 3-line box print 2 rows and "+ 10 more", still one page, same geometry']);
  await brk('junk list trusted','PE',"function _jobArr(x) { return Array.isArray(x) ? x : []; }","function _jobArr(x) { return x; }",['junk: a snapshot that is not a map, or holds junk rows, prints exactly the handwritten sheet and does not throw']);
  await brk('printing copy types embroidery codes','PE',"'PANTONE CODE', 5, 24, _jobTypedFor(data, 'pantone')","'PANTONE CODE', 5, 24, _jobTypedFor(data, 'embroidery')",[NAMES.find(n=>/^printing:/.test(n))]);
  await brk('snapshot not passed to the engine','POS',"productImage:po.imgFront||''\n  ,..._jobInstrData(po)}});\n};\n\n// Printing","productImage:po.imgFront||''\n  }});\n};\n\n// Printing",['callers: the PO snapshot is handed to the engine by the embroidery and printing generators']);
  await brk('junk snapshot passed on','POS',"return(i&&typeof i==='object'&&!Array.isArray(i))?{instructions:i}:{};","return{instructions:i};",['callers: a PO with no snapshot (or a junk one) sends data with NO instructions key, exactly as before']);
  await brk('card reads ph_article_instructions','CUT',"const raw=entry.data.instructions;","const raw=entry.data.instructions;/* ph_article_instructions */",['read scope: the card reads the PO snapshot only (no ph_article_instructions read, no Firestore call) and has no write or handler']);
  await brk('card with no snapshot is blank','CUT',"card.appendChild(_phkE('p','phk-ins-msg',phI18nD('cut.instr_none')));","",['card: a PO with no snapshot says "No saved instructions for this product." (never blank, never a zero)']);
  await brk('unreadable PO reads as none','CUT',"if(entry.state!=='ok'||!entry.data){","if(false){",['card: an unreadable PO says so by name, and does not claim there are no instructions']);
  await brk('hostile text parsed as markup','CUT',"  if(t)li.appendChild(_phkE('span','phk-ins-t',t));\n  if(ur)","  if(t)li.appendChild(_phkE('span','phk-ins-t',t));if(/<img/.test(t))li.appendChild(_phkE('img'));\n  if(ur)",['card: hostile strings stay text (no element is created from them) and a non-hex colour is never set as a style']);
  await brk('swatch trusts a stored string (both layers)','CUT',["return hex&&typeof phHexOk==='function'&&phHexOk(hex)?hex:'';","phInstructionsClean(raw).value:null;"],["return hex||String(p.hex||'');","raw:null;"],['card: hostile strings stay text (no element is created from them) and a non-hex colour is never set as a style']);
  await brk('card gets an edit button','CUT',"  kids.forEach(function(k){card.appendChild(k);});","  kids.forEach(function(k){card.appendChild(k);});card.appendChild(_phkBtn('ph-btn','Edit',function(){}));",['card: Kashif sees the card and no edit control at all (no button, input, textarea, select, link)']);
  await brk('card shown while loading','CUT',"if(!entry||entry.state==='loading')return null;","",['card: while the PO is still loading there is no card (nothing is claimed)']);
  await brk('swatch dropped','CUT',"if(hex){sw=_phkE('i','phk-ins-sw');","if(false){sw=_phkE('i','phk-ins-sw');",['card: a Pantone swatch is drawn from the validated stored hex (485 C), none for a code with no known colour']);
  return s;
};

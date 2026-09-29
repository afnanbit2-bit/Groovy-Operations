/* ─────────────────────────────────────────────────────────────────────────
   Color Library ▸ TCX codes (29 Sept 2026). Afnan supplied the Pantone TCX
   collection (2,800 colours); it is a static file the Color Library shows
   in its own tab, read-only, searchable, with "+ Add" prefilling the
   ordinary Add Color form. The real file is loaded through a fetch stub,
   so what is asserted is what ships.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite}=require('./harness');
const BOOK=JSON.parse(fs.readFileSync(path.join(__dirname,'..','assets','data','pantone-tcx.json'),'utf8'));

module.exports=async function(){
  const s=suite('color-tcx');
  const fetched=[];
  const app=loadApp({files:['js/shared.js','js/auth.js','js/embellishments.js'],
    globals:{fetch:async u=>{fetched.push(String(u));return{ok:true,status:200,json:async()=>BOOK};}}});
  const {run}=app;
  run(`session={uid:'u1',u:'ammar',name:'Ammar',role:'owner'};currentPage='color-library';
    allColors=[{_id:'a',colorName:'True Red',pantoneCode:'19-1664 TCX',hexApprox:'#9E2A2B',status:'active'},
               {_id:'b',colorName:'Old',pantoneCode:'18-1662 TCX',hexApprox:'#C3202F',status:'archived'}];`);

  s.section('the tab');
  run(`window.colorLibTab('library')`);
  const lib=run(`renderColorLibraryPage()`);
  s.ok('the Library tab keeps its page',/Seed Starter Colors/.test(lib)&&/tcx-tab on[^>]*>Library/.test(lib));
  s.ok('a TCX codes tab sits beside it',/colorLibTab\('tcx'\)">TCX codes/.test(lib));
  run(`window.colorLibTab('tcx')`);
  const first=run(`renderColorLibraryPage()`);
  s.ok('opening it says it is loading',/Loading the TCX book/.test(first));
  for(let i=0;i<50&&run(`_tcxState`)!=='ok';i++)await new Promise(r=>setTimeout(r,5));
  s.eq('the shipped file is what it reads',fetched.filter(u=>u==='/assets/data/pantone-tcx.json').length>=1,true);
  s.eq('all 2,800 codes',run(`_tcxBook.length`),2800);
  const tab=run(`renderColorLibraryPage()`);
  s.ok('it lists codes with their names',/11-0002 TCX/.test(tab)&&/Snowfall/.test(tab));
  s.ok('120 at a time, not 2,800 rows at once',(tab.match(/class="tcx-row"/g)||[]).length===120);
  s.ok('and a Show more',/tcxShowMore/.test(tab));
  s.ok('the count says so',/2,800 of 2,800 codes/.test(tab));

  s.section('search');
  const q=v=>run(`_tcxMatches(${JSON.stringify(v)}).map(t=>t.code).slice(0,5).join()`);
  s.eq('by full code',q('19-1664'),'19-1664');
  s.eq('by code without the dash',q('191664'),'19-1664');
  s.ok('by name',/19-1664/.test(q('true red')));
  s.eq('by hex',q('#BF1932'),'19-1664');
  s.eq('nothing found says so, escaped',/No TCX code matches “&lt;b&gt;”/.test((run(`_tcxQuery='<b>';_tcxListHTML()`))),true);
  run(`_tcxQuery=''`);

  s.section('what is in the library already');
  run(`_tcxQuery='19-16';`);
  const h=run(`_tcxListHTML()`);
  s.ok('a code the library holds says so',/19-1664 TCX[\s\S]*?In library/.test(h));
  const h2=run(`_tcxQuery='18-1662';_tcxListHTML()`);
  const row=code=>{const h=h2;const i=h.indexOf(code+' TCX');if(i<0)return'';const e=h.indexOf('class="tcx-row"',i);return h.slice(i,e<0?h.length:e);};
  s.ok('an ARCHIVED library colour does not count',/tcxAddToLibrary\('18-1662'\)/.test(row('18-1662'))&&!/In library/.test(row('18-1662')),row('18-1662'));

  s.section('+ Add prefills the Add Color form');
  run(`window.openColorModal=function(){window.__opened=1;};`);
  run(`window.tcxAddToLibrary('19-1664')`);
  s.eq('the form opens',run(`window.__opened`),1);
  s.eq('with the name, the code and the colour',[app.el('cm-name').value,app.el('cm-pantone').value,app.el('cm-hex').value].join('|'),'True Red|19-1664 TCX|#BF1932');
  run(`session.role='viewer';session.u='x';window.__opened=0;window.tcxAddToLibrary('19-1664')`);
  s.eq('someone who cannot edit the library gets no form',run(`window.__opened`),0);

  s.section('a bad row never reaches the page');
  const bad=JSON.parse(run(`JSON.stringify(_tcxParse({colors:[['19-1664','A','#9E2A2B'],['19-1664','dup','#000000'],['x','B','#FFFFFF'],['11-0601','<img src=x onerror=1>','red;background:url(x)'],['11-0602','C','#fff']]}))`));
  s.eq('only valid, unique rows',bad.map(r=>r.code).join(),'19-1664');
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   js/ph-mod-instructions.js — Production Ops, the Instructions tab (WP3a, 14 Oct 2026)

   The standing product instructions of one article code (placements, Pantone colours, embroidery codes, notes)
   that the handwritten job copies are filled from today. Managers only (afnan, ammar, mustafa); Kashif's rail has no
   such tab. Writes ONLY through phInstructionsSave (js/ph-write.js) -> ph_article_instructions/{CODE} + revisions/{rev}.

   "Import from recipe" COPIES the article's recipe (js/embellishments.js: printing.pantones, placements' visible
   instructions, embroideryCodes) into the form for review; nothing syncs and nothing is saved until Save.
   Every string reaches the page through textContent / .value. Loaded after js/ph-mod-admin.js (it reuses its
   small helpers _pha*). Everything global is prefixed phi / _phi / PHI_.
   ───────────────────────────────────────────────────────────────────────── */

const _phiS={q:'',form:null,hist:null,limit:30,importNote:''};

function _phiLibs(){
  const libs={library:[],builtin:null,tcx:null};
  try{if(typeof allColors!=='undefined'&&Array.isArray(allColors))libs.library=allColors;}catch(e){}
  try{if(typeof COLOR_IMPORT_PANTONE_HEX!=='undefined')libs.builtin=COLOR_IMPORT_PANTONE_HEX;}catch(e){}
  try{
    if(typeof _tcxBook!=='undefined'&&Array.isArray(_tcxBook)){libs.tcx={};_tcxBook.forEach(function(r){if(r&&r.code)libs.tcx[r.code]=r.hex;});}
  }catch(e){}
  return libs;
}
// The recipes of one article code, best first: locked, then active, then anything else with content.
function phiRecipesFor(code,recipes){
  const cd=String(code||'').trim().toUpperCase();
  const rank={locked:0,active:1};
  return(Array.isArray(recipes)?recipes:[]).filter(function(r){return r&&String(r.articleCode||'').trim().toUpperCase()===cd;})
    .map(function(r){const imp=phInstructionsFromRecipe(r,{libs:_phiLibs()});return{recipe:r,imp:imp,empty:phInstructionsEmpty(imp.value)};})
    .filter(function(x){return!x.empty;})
    .sort(function(a,b){const ra=rank[a.recipe.status]===undefined?2:rank[a.recipe.status],rb=rank[b.recipe.status]===undefined?2:rank[b.recipe.status];return ra-rb;});
}
function _phiFormFrom(code,row){
  const v=row?phInstructionsClean(row).value:{placements:[],pantones:[],embroidery:[],notes:{en:'',ur:''}};
  const cp=function(a){return a.map(function(x){return Object.assign({},x);});};
  return{code:code,existing:!!row,rev:row?row.rev:0,placements:cp(v.placements),pantones:cp(v.pantones),embroidery:cp(v.embroidery),notesEn:v.notes.en,notesUr:v.notes.ur,reason:''};
}
function _phiInputOf(f){
  return{placements:f.placements,pantones:f.pantones,embroidery:f.embroidery,notes:{en:f.notesEn,ur:f.notesUr},reason:f.reason};
}
// Resolve the swatch hex once for each Pantone row that has none (library -> built-in C table -> TCX book).
function phiResolveHexes(input){
  const libs=_phiLibs();
  (input.pantones||[]).forEach(function(p){
    if(p&&!phHexOk(String(p.hex||'')))p.hex=phPantoneHex(p.code,p.system,libs);
  });
  return input;
}

/* ── read-only view: a swatch is a chip WITH the code in words, never colour alone ── */
function phInstructionsView(row){
  const box=phEl('div','phi-view');
  const v=phInstructionsClean(row||{}).value;
  if(phInstructionsEmpty(v)){box.appendChild(phEl('p','ph-note','No instructions saved.'));return box;}
  if(v.placements.length){box.appendChild(phEl('h4','pha-sub-title','Placement'));const ul=phEl('ul','ph-lines');
    v.placements.forEach(function(p){ul.appendChild(phEl('li',null,[p.side,p.en,p.ur].filter(Boolean).join(' - ')));});box.appendChild(ul);}
  if(v.pantones.length){box.appendChild(phEl('h4','pha-sub-title','Pantone'));const ul=phEl('ul','ph-lines');
    v.pantones.forEach(function(p){const li=phEl('li','phi-pan');const sw=phEl('i','phi-sw');if(p.hex)sw.style.background=p.hex;li.appendChild(sw);
      li.appendChild(phEl('span',null,p.code+' '+p.system+(p.name?' - '+p.name:'')+(p.hex?' ('+p.hex+')':'')+(p.use?' - '+p.use:'')));ul.appendChild(li);});box.appendChild(ul);}
  if(v.embroidery.length){box.appendChild(phEl('h4','pha-sub-title','Embroidery'));const ul=phEl('ul','ph-lines');
    v.embroidery.forEach(function(e){ul.appendChild(phEl('li',null,[e.code,e.candle&&'candle '+e.candle,e.shade&&'shade '+e.shade,e.position,e.note].filter(Boolean).join(' - ')));});box.appendChild(ul);}
  if(v.notes.en||v.notes.ur){box.appendChild(phEl('h4','pha-sub-title','Notes'));if(v.notes.en)box.appendChild(phEl('p',null,v.notes.en));if(v.notes.ur)box.appendChild(phEl('p',null,v.notes.ur));}
  return box;
}

/* ── the editor ── */
function _phiTxt(label,obj,key,attrs,hint){
  const i=_phaInput('text',obj[key],key,Object.assign({'aria-label':label,maxlength:'300'},attrs||{}));
  const sync=function(){obj[key]=i.value;};
  i.addEventListener('input',sync);i.addEventListener('change',sync);
  return _phaField(label,i,hint);
}
function _phiSection(title,hint,rowsFn,addFn,ctx,max,count){
  const card=_phaCard(title,[]);
  if(hint)card.appendChild(phEl('p','ph-note',hint));
  const host=phEl('div','phi-rows');card.appendChild(host);rowsFn(host);
  const add=_phaBtn('','Add a row',function(){addFn();_phiPaintEditor(ctx);},{'data-act':'add'});
  if(count>=max){add.setAttribute('disabled','');add.setAttribute('title','At most '+max+' rows.');}
  card.appendChild(add);
  return card;
}
let _phiEditHost=null;
function _phiPaintEditor(ctx){
  const host=_phiEditHost;if(!host)return;
  phClear(host);
  const f=_phiS.form;if(!f)return;
  const card=_phaCard((f.existing?'Edit the instructions of ':'Set the instructions of ')+f.code,[],'pha-editor');
  card.appendChild(phEl('p','ph-note',f.existing?'Currently revision '+f.rev+'. Saving makes revision '+(f.rev+1)+' and keeps the old one in the history.':'New. The first save is revision 1.'));
  // import from recipe
  const recs=phiRecipesFor(f.code,(typeof allRecipes!=='undefined')?allRecipes:[]);
  const imp=phEl('div','phi-import');
  if(recs.length){
    const best=recs[0];
    imp.appendChild(_phaBtn('','Import from recipe ('+(best.recipe.status||'draft')+(best.recipe.version?' v'+best.recipe.version:'')+')',function(){
      const v=best.imp.value,cp=function(a){return a.map(function(x){return Object.assign({},x);});};
      f.placements=cp(v.placements);f.pantones=cp(v.pantones);f.embroidery=cp(v.embroidery);f.notesEn=v.notes.en;f.notesUr=v.notes.ur;
      _phiS.importNote='Copied from the recipe. Review it, then save - the recipe is not changed and nothing syncs.';
      _phiPaintEditor(ctx);
    },{'data-act':'import'}));
    imp.appendChild(phEl('span','ph-note',' Replaces what is below with a copy of the recipe.'));
  }else imp.appendChild(phEl('p','ph-note',(typeof allRecipes==='undefined'||!allRecipes.length)?'No recipe is loaded, so there is nothing to import (open Embellishments > Recipes once to load them).':'This article has no recipe with placements, Pantone colours or embroidery codes to import.'));
  card.appendChild(imp);
  if(_phiS.importNote)card.appendChild(phEl('p','ph-note phi-imported',_phiS.importNote));
  const del=function(arr,i){arr.splice(i,1);_phiPaintEditor(ctx);};
  card.appendChild(_phiSection('Placement','Where the print or embroidery goes. English and Urdu text are typed here; the printed copy keeps its ruled lines.',function(h){
    f.placements.forEach(function(p,i){const r=phEl('div','phi-row');
      r.appendChild(_phiTxt('Placement (English)',p,'en'));r.appendChild(_phiTxt('Placement (Urdu, optional)',p,'ur',{dir:'rtl'}));r.appendChild(_phiTxt('Side',p,'side',{maxlength:'40'}));
      r.appendChild(_phaBtn('','Remove',function(){del(f.placements,i);},{'data-act':'remove','aria-label':'Remove placement '+(i+1)}));h.appendChild(r);});
  },function(){f.placements.push({en:'',ur:'',side:'',templateId:''});},ctx,PH_INSTR_PLACEMENTS_MAX,f.placements.length));
  card.appendChild(_phiSection('Pantone colours','The swatch colour is looked up once on save (colour library, built-in C book, TCX book); type #RRGGBB to set it yourself.',function(h){
    f.pantones.forEach(function(p,i){const r=phEl('div','phi-row');
      r.appendChild(_phiTxt('Pantone code',p,'code',{maxlength:'40'}));
      const sys=_phaSelect([{v:'C',t:'C (coated)'},{v:'TCX',t:'TCX (fabric)'}],p.system||'C','system',{'aria-label':'Pantone book'});sys.addEventListener('change',function(){p.system=sys.value;});
      r.appendChild(_phaField('Book',sys));
      r.appendChild(_phiTxt('Name',p,'name',{maxlength:'80'}));r.appendChild(_phiTxt('Colour #RRGGBB',p,'hex',{maxlength:'7'}));r.appendChild(_phiTxt('Used for',p,'use',{maxlength:'60'}));
      r.appendChild(_phaBtn('','Remove',function(){del(f.pantones,i);},{'data-act':'remove','aria-label':'Remove Pantone '+(i+1)}));h.appendChild(r);});
  },function(){f.pantones.push({system:'C',code:'',name:'',hex:'',use:''});},ctx,PH_INSTR_PANTONES_MAX,f.pantones.length));
  card.appendChild(_phiSection('Embroidery codes','Thread-book codes. Candle and shade are separate parts of one entry.',function(h){
    f.embroidery.forEach(function(e,i){const r=phEl('div','phi-row');
      r.appendChild(_phiTxt('Code',e,'code',{maxlength:'40'}));r.appendChild(_phiTxt('Candle',e,'candle',{maxlength:'80'}));r.appendChild(_phiTxt('Shade',e,'shade',{maxlength:'80'}));
      r.appendChild(_phiTxt('Position',e,'position',{maxlength:'80'}));r.appendChild(_phiTxt('Note',e,'note',{maxlength:'200'}));
      r.appendChild(_phaBtn('','Remove',function(){del(f.embroidery,i);},{'data-act':'remove','aria-label':'Remove embroidery row '+(i+1)}));h.appendChild(r);});
  },function(){f.embroidery.push({code:'',candle:'',shade:'',position:'',note:''});},ctx,PH_INSTR_EMB_MAX,f.embroidery.length));
  const nc=_phaCard('Notes',[]);
  const ne=phEl('textarea','pha-in');ne.value=f.notesEn;ne.setAttribute('aria-label','Notes (English)');ne.setAttribute('maxlength','1000');ne.addEventListener('input',function(){f.notesEn=ne.value;});
  const nu=phEl('textarea','pha-in');nu.value=f.notesUr;nu.setAttribute('aria-label','Notes (Urdu, optional)');nu.setAttribute('dir','rtl');nu.setAttribute('maxlength','1000');nu.addEventListener('input',function(){f.notesUr=nu.value;});
  nc.appendChild(_phaField('English',ne));nc.appendChild(_phaField('Urdu (optional)',nu));card.appendChild(nc);
  const rs=_phaInput('text',f.reason,'reason',{maxlength:'300','aria-label':'Reason for this revision'});
  rs.addEventListener('input',function(){f.reason=rs.value;});rs.addEventListener('change',function(){f.reason=rs.value;});
  card.appendChild(_phaField(f.existing?'Reason (required)':'Reason (optional for the first save)',rs,'What changed and why. Kept in the history.'));
  const bar=phEl('div','pha-acts');
  bar.appendChild(_phaBtn('ph-btn-primary',f.existing?'Save revision '+(f.rev+1):'Save instructions',function(e,b){
    const input=phiResolveHexes(_phiInputOf(f));
    const cl=phInstructionsClean(input);
    if(f.existing&&!String(f.reason||'').trim()){_phaFlash={tab:'instructions',kind:'bad',text:'A reason is required for a new revision.'};ctx.repaint();return;}
    if(cl.problems.length){_phaFlash={tab:'instructions',kind:'bad',text:cl.problems.join(' ')};ctx.repaint();return;}
    _phaAct(ctx,'instructions',function(){return phInstructionsSave(f.code,input,{expectedRev:f.existing?f.rev:null});},
      function(r){_phiS.form=null;_phiS.importNote='';return'Saved the instructions of '+f.code+' (revision '+r.rev+').';},b);
  },{'data-act':'save'}));
  bar.appendChild(_phaBtn('','History',function(){_phiLoadHistory(f.code,ctx);},{'data-act':'history'}));
  bar.appendChild(_phaBtn('','Cancel',function(){_phiS.form=null;_phiS.hist=null;_phiS.importNote='';ctx.repaint();},{'data-act':'cancel'}));
  card.appendChild(bar);
  if(_phiS.hist&&_phiS.hist.code===f.code){
    const hc=_phaCard('History of '+f.code,[]);
    if(!_phiS.hist.ok)hc.appendChild(phEl('p','ph-note pha-warn',_phiS.hist.text||'The history could not be read.'));
    else if(!_phiS.hist.rows.length)hc.appendChild(phEl('p','ph-note','No revisions saved yet.'));
    else{const ul=phEl('ul','ph-lines');_phiS.hist.rows.forEach(function(r){
      ul.appendChild(phEl('li',null,'Revision '+r.rev+' - '+(r.byName||r.by||'')+(r.at?' - '+new Date(r.at).toISOString().slice(0,10):'')+(r.reason?' - '+r.reason:'')));});hc.appendChild(ul);}
    card.appendChild(hc);
  }
  host.appendChild(card);
}
async function _phiLoadHistory(code,ctx){
  const r=await phInstructionsHistory(code);
  _phiS.hist=Object.assign({code:code},r);
  try{ctx.repaint();}catch(e){}
}
function _phiOpen(code,ctx){
  const cd=String(code||'').trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(cd)){_phaFlash={tab:'instructions',kind:'bad',text:'Not an article code: '+code+'.'};ctx.repaint();return;}
  const row=typeof phInstructionsFor==='function'?phInstructionsFor(cd):null;
  _phiS.form=_phiFormFrom(cd,row);_phiS.hist=null;_phiS.importNote='';
  if(typeof loadPrintingData==='function'&&typeof allRecipes!=='undefined'&&!allRecipes.length){
    Promise.resolve().then(function(){return loadPrintingData();}).catch(function(){}).then(function(){try{ctx.repaint();}catch(e){}});
  }
  ctx.repaint();
}
function _phiRender(host,ctx){
  if(!_phaGuard(host,ctx,'Instructions'))return;
  host.appendChild(_phaHead('Instructions','The standing instructions per article code: placement, Pantone colours, embroidery codes and notes. Every save is a revision with a reason.',ctx));
  const fl=_phaFlashNode('instructions',ctx);if(fl)host.appendChild(fl);
  const g=ctx.get('instructions');
  if(!g.ok){host.appendChild(_phaFailCard(ctx,'instructions','Product instructions could not be read'));return;}
  const open=_phaCard('Open an article',[]);
  const ci=_phaInput('text',_phiS.q,'code',{placeholder:'Article code, for example GST073','aria-label':'Article code',maxlength:'40'});
  ci.addEventListener('input',function(){_phiS.q=ci.value;});
  ci.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();_phiOpen(ci.value,ctx);}});
  open.appendChild(_phaField('Article code',ci,'Opens the saved instructions, or starts new ones for a code that has none.'));
  open.appendChild(_phaBtn('ph-btn-primary','Open',function(){_phiOpen(ci.value,ctx);},{'data-act':'open'}));
  host.appendChild(open);
  const ed=phEl('div','pha-edhost');host.appendChild(ed);_phiEditHost=ed;_phiPaintEditor(ctx);
  const lc=_phaCard('Saved instructions ('+g.rows.length+')',[]);
  if(!g.rows.length)lc.appendChild(phEl('p','pha-empty','No instructions have been saved yet.'));
  else{
    const rows=g.rows.slice().sort(function(a,b){return a.fbKey<b.fbKey?-1:a.fbKey>b.fbKey?1:0;}).slice(0,_phiS.limit);
    const ul=phEl('ul','ph-lines');
    rows.forEach(function(r){
      const li=phEl('li','phi-line');
      li.appendChild(phEl('strong',null,r.fbKey));
      li.appendChild(phEl('span','ph-note',' revision '+r.rev+' - '+(r.placements||[]).length+' placements, '+(r.pantones||[]).length+' Pantone, '+(r.embroidery||[]).length+' embroidery'));
      li.appendChild(_phaBtn('','Edit',function(){_phiOpen(r.fbKey,ctx);},{'data-act':'edit','aria-label':'Edit instructions of '+r.fbKey}));
      ul.appendChild(li);
    });
    lc.appendChild(ul);
    if(g.rows.length>rows.length)lc.appendChild(_phaBtn('','Show more',function(){_phiS.limit+=30;ctx.repaint();},{'data-act':'more'}));
  }
  host.appendChild(lc);
  if(g.truncated)host.appendChild(phEl('p','ph-note','The list is cut at its read limit.'));
}

(function(){
  if(typeof phRegisterTab!=='function'){
    if(typeof console!=='undefined')console.warn('[ph-mod-instructions] js/ph-ui.js is not loaded, so the Instructions tab was not registered.');
    return;
  }
  // an unknown id appends to PH_TABS: this tab lands LAST in the rail (after Settings), not after Standards
  phRegisterTab('instructions',{label:'Instructions',short:'In',render:_phiRender});
})();

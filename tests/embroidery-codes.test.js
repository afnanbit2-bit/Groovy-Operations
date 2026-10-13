/* Embroidery codes on the article recipe (js/embellishments.js, Ammar's file).
   Field: recipe.embroideryCodes = [{code,candle,shade,position,note}] — an
   array of MAPS (Firestore refuses nested arrays). Absent field = behaves as
   before. These tests DRIVE saveRecipe and the real renderers. */
'use strict';
const {loadApp,suite}=require('./harness');

const FILES=['js/shared.js','js/auth.js','js/pos.js','js/embellishments.js'];
const SESSION={uid:'u1',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op'};
const J=v=>JSON.stringify(v);

function app(){
  const a=loadApp({files:FILES,session:SESSION,currentPage:'recipe-create',
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}}}});
  a.run('session='+J(SESSION));
  a.run('allRecipes=[];allColors=[]');
  return a;
}
/* Fake the form: ids -> values, plus embroidery rows read by querySelectorAll. */
function form(a,vals,rows,checks){
  a.run(`(function(){
    const V=${J(vals)},R=${J(rows||[])},C=${J(checks||[])};
    const orig=document.getElementById.bind(document);
    document.getElementById=function(id){const n=orig(id);
      if(id in V)n.value=V[id]; if(C.includes(id))n.checked=true; return n;};
    document.querySelectorAll=function(sel){
      if(sel==='#rc-emb-rows .emb-code-row')return R.map(r=>({querySelector:s=>({value:r[s.replace('.emb-f-','')]})}));
      return [];};
  })()`);
}
const BASE={'rc-code':'gp020','rc-name':'Bird Patch','rc-rate':'30','rc-tier':'1'};
const lastSet=a=>{const w=a.state.writes.filter(x=>x.op==='set');return w.length?w[w.length-1].data:null;};
const hasNestedArray=v=>Array.isArray(v)?v.some(x=>Array.isArray(x)||hasNestedArray(x)):(v&&typeof v==='object'?Object.values(v).some(hasNestedArray):false);

const _pending=[];
_pending.push((async()=>{
  const s=suite('embroidery-codes');

  // ── pure helper ─────────────────────────────────────────────
  s.section('embRecipeEmbroidery cleans and limits');
  try{
    const a=app();
    const long='x'.repeat(300);
    const out=a.run(`embRecipeEmbroidery({embroideryCodes:[
      {code:'  T-100 ',candle:' c1',shade:'s',position:'chest',note:' n '},
      {code:'',candle:'',shade:'',position:'',note:''},
      null,['nested'],'str',
      {code:'${long}',candle:'${long}',shade:'${long}',position:'${long}',note:'${long}'}]})`);
    s.eq('blank, null, nested-array and string rows dropped',out.length,2);
    s.eq('text trimmed',J(out[0]),J({code:'T-100',candle:'c1',shade:'s',position:'chest',note:'n'}));
    s.eq('code capped at 40',out[1].code.length,40);
    s.eq('candle/shade/position capped at 80',[out[1].candle.length,out[1].shade.length,out[1].position.length].join(),'80,80,80');
    s.eq('note capped at 200',out[1].note.length,200);
    const many=a.run(`embRecipeEmbroidery({embroideryCodes:Array.from({length:45},(_,i)=>({code:'C'+i}))}).length`);
    s.eq('at most 30 rows',many,30);
    s.eq('absent field -> []',J(a.run('embRecipeEmbroidery({})')),'[]');
    s.eq('no recipe -> []',J(a.run('embRecipeEmbroidery(null)')),'[]');
    s.eq('a non-array field -> []',J(a.run('embRecipeEmbroidery({embroideryCodes:"x"})')),'[]');
  }catch(e){s.ok('helper ran',false,e&&e.message);}

  // ── save / load round trip ──────────────────────────────────
  s.section('saveRecipe writes the rows and loads them back');
  try{
    const a=app();
    form(a,BASE,[{code:'  T-100 ',candle:'C1',shade:'Red',position:'Left chest',note:'tight'},{code:'',candle:'',shade:'',position:'',note:''}],['rc-pt-embroidery']);
    await a.run('window.saveRecipe(false)');
    const p=lastSet(a);
    s.ok('a recipe was written',!!p);
    s.eq('rows saved cleaned (blank row dropped)',J(p&&p.embroideryCodes),J([{code:'T-100',candle:'C1',shade:'Red',position:'Left chest',note:'tight'}]));
    s.eq('no nested arrays anywhere in the payload',hasNestedArray(p),false);
    s.eq('embroidery process saved',J(p&&p.printing.processTypes),'["embroidery"]');
    s.eq('history records the change',J(p&&p.changeHistory.slice(-1)[0].changes),'["embroideryCodes"]');
    // load back: the edit form shows them
    a.run('allRecipes=['+J(Object.assign({_id:'r1'},p))+'];viewingRecipe="r1"');
    const html=a.run('renderRecipeCreatePage()');
    s.ok('edit form carries the saved code',html.includes('value="T-100"')&&html.includes('value="Left chest"'));
    s.ok('card visible for an embroidery recipe',html.includes('id="rc-emb-card" style="display:block"'));
  }catch(e){s.ok('round trip ran',false,e&&e.message);}

  // ── validation ──────────────────────────────────────────────
  s.section('validation');
  try{
    const a=app();
    form(a,BASE,[{code:'',candle:'C1',shade:'',position:'',note:''}],['rc-pt-embroidery']);
    await a.run('window.saveRecipe(false)');
    s.eq('a row without a code blocks the save',a.state.writes.filter(x=>x.op==='set').length,0);
    const a2=app();
    form(a2,BASE,[{code:'x'.repeat(41),candle:'',shade:'',position:'',note:''}],['rc-pt-embroidery']);
    await a2.run('window.saveRecipe(false)');
    s.eq('a code over 40 chars blocks the save',a2.state.writes.filter(x=>x.op==='set').length,0);
  }catch(e){s.ok('validation ran',false,e&&e.message);}

  // ── absent field unchanged ──────────────────────────────────
  s.section('a recipe without the field stays without it');
  try{
    const a=app();
    form(a,BASE,[],['rc-pt-rubber']);
    await a.run('window.saveRecipe(false)');
    const p=lastSet(a);
    s.ok('written',!!p);
    s.eq('no embroideryCodes key',p&&'embroideryCodes' in p,false);
    s.eq('no changes marker in history',p&&p.changeHistory.slice(-1)[0].changes,undefined);
    // opening the edit page / detail never writes
    a.run('allRecipes=[{_id:"r2",articleCode:"GP1",articleName:"x",status:"draft",printing:{processTypes:["rubber"],pantones:[],placements:[]}}];viewingRecipe="r2"');
    const before=a.state.writes.length;
    a.run('renderRecipeCreatePage()');
    s.eq('opening the form writes nothing',a.state.writes.length,before);
    s.ok('card hidden for a print-only recipe',a.run('renderRecipeCreatePage()').includes('id="rc-emb-card" style="display:none"'));
  }catch(e){s.ok('absent ran',false,e&&e.message);}

  // ── revision diff ───────────────────────────────────────────
  s.section('the recipe history includes the field');
  try{
    const a=app();
    const rec={_id:'r3',articleCode:'GP020',articleName:'Bird',status:'draft',version:1,createdBy:'Ammar',createdAt:'x',
      printing:{processTypes:['embroidery'],pantones:[],placements:[]},changeHistory:[],
      embroideryCodes:[{code:'T-1',candle:'',shade:'',position:'',note:''}]};
    a.run('allRecipes=['+J(rec)+'];viewingRecipe="r3"');
    form(a,BASE,[{code:'T-2',candle:'',shade:'',position:'',note:''}],['rc-pt-embroidery']);
    await a.run('window.saveRecipe(false)');
    const h=lastSet(a).changeHistory.slice(-1)[0];
    s.eq('edited codes are named',J(h.changes),'["embroideryCodes"]');
    const a2=app();
    a2.run('allRecipes=['+J(rec)+'];viewingRecipe="r3"');
    form(a2,BASE,[{code:'T-1',candle:'',shade:'',position:'',note:''}],['rc-pt-embroidery']);
    await a2.run('window.saveRecipe(false)');
    s.eq('unchanged codes are not named',lastSet(a2).changeHistory.slice(-1)[0].changes,undefined);
    s.eq('diff helper is order/whitespace aware',J(a.run('embRecipeEmbroideryChanges({embroideryCodes:[{code:" A "}]},{embroideryCodes:[{code:"A"}]})')),'[]');
  }catch(e){s.ok('history ran',false,e&&e.message);}

  // ── worker view and detail: only for embroidery recipes ─────
  s.section('worker view and detail show it only for embroidery recipes');
  try{
    const a=app();
    const mk=(id,types)=>({_id:id,articleCode:'GP'+id,articleName:'n',status:'locked',
      printing:{processTypes:types,pantones:[],placements:[],instructionsEn:''},
      embroideryCodes:[{code:'THREAD-77',candle:'CND9',shade:'Navy',position:'Cuff',note:'double'}]});
    a.run('allRecipes=['+J(mk('e1',['embroidery']))+','+J(mk('p1',['rubber']))+']');
    const job=id=>({_id:'j'+id,recipeId:id,currentStage:'po_received',poId:'PO-1',articleCode:'X',totalQty:10,sizeBreakdown:{}});
    const he=a.run('printWorkerCardHTML('+J(job('e1'))+')');
    const hp=a.run('printWorkerCardHTML('+J(job('p1'))+')');
    s.ok('embroidery recipe: worker card shows code, candle, shade, position',['THREAD-77','CND9','Navy','Cuff'].every(t=>he.includes(t)));
    s.ok('print-only recipe: worker card shows none of it',!hp.includes('THREAD-77')&&!hp.includes('Embroidery Codes'));
    a.run('viewingRecipe="e1"');
    s.ok('detail page helper shows rows for embroidery',a.run('_embCodesDetailHTML(allRecipes[0])').includes('THREAD-77'));
    s.eq('detail helper empty for no rows',a.run('_embCodesDetailHTML({})'),'');
    a.run('viewingRecipe="e1";renderRecipeDetailPage()');
    s.ok('detail PAGE shows the section for an embroidery recipe',a.el('main-content').innerHTML.includes('THREAD-77'));
    a.run('viewingRecipe="p1";renderRecipeDetailPage()');
    s.ok('detail PAGE hides it for a print-only recipe',!a.el('main-content').innerHTML.includes('THREAD-77'));
  }catch(e){s.ok('views ran',false,e&&e.message);}

  // ── XSS ─────────────────────────────────────────────────────
  s.section('stored strings are escaped');
  try{
    const a=app();
    const evil='"><img src=x onerror=alert(1)>';
    const rec={_id:'x1',articleCode:'GP9',articleName:'n',status:'locked',
      printing:{processTypes:['embroidery'],pantones:[],placements:[{templateNameEn:evil}]},
      embroideryCodes:[{code:evil,candle:evil,shade:evil,position:evil,note:evil}]};
    a.run('allRecipes=['+J(rec)+'];viewingRecipe="x1"');
    const forms=a.run('renderRecipeCreatePage()');
    const view=a.run('_embCodesDetailHTML(allRecipes[0])');
    const worker=a.run('printWorkerCardHTML('+J({_id:'jx',recipeId:'x1',currentStage:'po_received',totalQty:1,sizeBreakdown:{}})+')');
    const bad=h=>/<img src=x/.test(h);
    s.ok('form escapes (values and datalist)',!bad(forms));
    s.ok('detail escapes',!bad(view));
    s.ok('worker view escapes',!bad(worker.slice(worker.indexOf('Embroidery Codes')>=0?worker.indexOf('Embroidery Codes'):0)));
  }catch(e){s.ok('xss ran',false,e&&e.message);}

  return s;
})());

module.exports=async function(){
  const suites=await Promise.all(_pending);
  return suites[0];
};

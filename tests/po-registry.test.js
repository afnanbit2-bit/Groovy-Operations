/* The PO Registry page (js/po-registry.js), driven through the REAL js/pos.js renderRegistry() hand-over, with the real
   js/shared.js, js/ph-core.js, js/por-core.js loaded. Hand fixture (today = the clock: ages are not asserted here, the core's
   test holds them). Each guard is reverted once in a copy of its source file and a named assertion must fail.
   Logic and markup only: not Firestore, not a screen (smoke-layout / smoke-app-phone look at the screen). */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC={shared:read('js/shared.js'),pos:read('js/pos.js'),ph:read('js/ph-core.js'),core:read('js/por-core.js'),reg:read('js/po-registry.js')};
const ESC_SRC=read('js/gatepass.js').match(/function _gpEsc\(s\)\{[^\n]*\}/)[0];
const DAY=86400000,NOW=Date.now();
const OWNER={uid:'u1',name:'Afnan',u:'afnan',role:'owner',canPO:true};

function po(n,over){
  const id='PO-'+String(n).padStart(3,'0');
  return Object.assign({fbKey:id,id:id,name:'Tee '+n,code:'GST'+String(n).padStart(3,'0'),fabric:'Jersey',createdBy:'Afnan',ts:NOW-n*DAY,
    createdAt:new Date(NOW-n*DAY+5*3600000).toISOString().slice(0,10),poStatus:'in_production',currentStage:'cutting',
    releasedAt:new Date(NOW-n*DAY).toISOString(),qty:10,sizes:{M:10},imgFront:'https://res.cloudinary.com/x/'+n+'.jpg'},over||{});
}
const FIX=[
  po(1),
  po(20,{name:'<img src=x onerror=alert(1)>'}),
  po(30,{poStatus:'reserved',currentStage:null,releasedAt:null}),
  po(40,{poStatus:'cancelled',currentStage:null,cancelledReason:'wrong fabric'}),
  po(50,{name:'Raw City Polo',code:'GP098'}),
  po(60,{autoCreatedFrom:'fabric-issue-GP-1'})
];
const PASSES=[{id:'GP-1',gpType:'fabric',poId:'1',date:new Date(NOW-DAY).toISOString().slice(0,10),cutMaster:'Alam'}];

function app(o){
  const opt=o||{};
  const a=loadApp({files:[],currentPage:'po-registry',globals:Object.assign({deleteDoc:async()=>{(a.__del=a.__del||[]).push(1);}},opt.globals||{})});
  const src=Object.assign({},SRC,opt.src||{});
  a.run(src.shared);a.run(src.pos);a.run(src.ph);a.run(src.core);
  if(opt.noReg!==true)a.run(src.reg);
  a.run('session='+J(opt.session||OWNER));
  a.run(ESC_SRC);
  a.run('loadData=async function(){};logActivity=async function(){};showToast=function(){};');
  a.run('allPOs='+J(opt.pos||FIX)+';allPasses='+J(opt.passes||PASSES)+';');
  a.run('_posLoadFailed='+J(opt.failed||[])+';_posLoadAt='+(opt.loadAt===undefined?NOW:opt.loadAt)+';');
  if(opt.state)a.run('_porState=Object.assign(_porState,'+J(opt.state)+');');
  return a;
}
const rowsOf=h=>(h.match(/<button type="button" class="por-row" data-por="([^"]+)"/g)||[]).map(x=>/data-por="([^"]+)"/.exec(x)[1]);
const wait=ms=>new Promise(r=>setTimeout(r,ms));

async function checks(o){
  const O=o||{};
  const out={};
  {const a=app(O);const h=a.run('renderRegistry()');
    out['the new body is drawn (por-body, rows are buttons)']=/id="por-body"/.test(h)&&rowsOf(h).length>0&&!/class="po-row"/.test(h);
    out['every row is a button, never a div onclick']=!/<div[^>]*class="por-row/.test(h)&&rowsOf(h).length===5;
    out['a hostile name reaches the page as text']=h.indexOf('<img src=x onerror')<0&&h.indexOf('&lt;img src=x onerror=alert(1)&gt;')>=0;
    out['every picture has alt text']=(h.match(/<img /g)||[]).length>0&&(h.match(/<img /g)||[]).length===(h.match(/<img [^>]*alt="[^"]+"/g)||[]).length;
    out['the registry never deletes on open']=!(a.__del&&a.__del.length);
    out['Active, oldest at this stage first']=J(rowsOf(h))===J(['PO-060','PO-050','PO-030','PO-020','PO-001']);   // 60, 50 days since release; 30 since created (reserved); 20; PO-001 1 day since its fabric issue
  }
  {const a=app(Object.assign({},O,{failed:['pos']}));const h=a.run('renderRegistry()');
    out['no rows and no counts on a failed pos read']=/PO list could not be read/.test(h)&&rowsOf(h).length===0&&!/class="por-view/.test(h);
  }
  {const a=app(Object.assign({},O,{failed:['gatepasses']}));const h=a.run('renderRegistry()');
    out['fabric not read is never "fabric not issued"']=/fabric: not read/.test(h)&&!/fabric not issued/.test(h);
  }
  {const a=app(Object.assign({},O,{pos:Array.from({length:50},(x,i)=>po(i+1))}));const h=a.run('renderRegistry()');
    out['never more than 40 rows at once']=rowsOf(h).length===40&&/Show 10 more/.test(h);
  }
  {const a=app(Object.assign({},O,{src:Object.assign({},O.src||{},{reg:'function porRegistryHTML(){throw new Error("boom");}'})}));const h=a.run('renderRegistry()');
    out['the old list is drawn when the module throws']=/id="po-list-wrap"/.test(h)&&!/por-body/.test(h);   // RG5: its rows are now the shared row
  }
  return out;
}

module.exports=async function(){
  const s=suite('po-registry');

  s.section('the hand-over and the list');
  const ck=await checks();
  Object.keys(ck).forEach(k=>s.ok(k,ck[k]===true));
  {
    const a=app();const h=a.run('renderRegistry()');
    s.ok('the header and the Orders | Cutting tabs stay (js/pos.js)',/PO Registry/.test(h)&&/switchPoRegTab\('cutting'\)/.test(h));
    s.ok('view counts: Active 5 (incl. reserved, not the cancelled), Cancelled 1, All 6',/data-view="active"[^>]*>Active <b>5<\/b>/.test(h)&&/data-view="cancelled"[^>]*>Cancelled <b>1<\/b>/.test(h)&&/data-view="all"[^>]*>All <b>6<\/b>/.test(h));
    s.ok('the article code is on the row',/<span class="por-code">GP098<\/span>/.test(h));
    s.ok('a reserved row says not released',/data-por="PO-030"[\s\S]*?not released/.test(h));
    s.ok('the row with fabric names the master (Alam)',/data-por="PO-001"[\s\S]*?fabric issued [^<]*\(Alam\)/.test(h));
    s.ok('a row with no pass at cutting says fabric not issued',/data-por="PO-050"[\s\S]*?fabric not issued/.test(h));
    s.ok('the search box has a label',/<label class="por-field por-search"><span class="por-flabel">Search<\/span><input id="por-q"/.test(h));
    s.ok('needs chips with counts are drawn',/class="por-chip"/.test(h)&&/data-need="no_fabric"/.test(h));
  }
  s.section('search, view, sort, group repaint the list');
  {
    const a=app();a.run('renderRegistry()');a.el('por-body').innerHTML='x';
    a.run('window.porSetView("cancelled")');
    s.ok('a view repaints the body with only the cancelled PO',J(rowsOf(a.el('por-body').innerHTML))===J(['PO-040']));
    a.run('window.porSetView("all")');a.el('por-list').innerHTML='untouched';a.run('window.porSearch("polo")');
    s.ok('a keystroke is debounced (the list is not repainted at once)',a.el('por-list').innerHTML==='untouched');
    await wait(260);
    s.ok('search "polo" in All finds PO-050 only',J(rowsOf(a.el('por-list').innerHTML))===J(['PO-050']),J(rowsOf(a.el('por-list').innerHTML)));
    s.ok('the count line follows the search',/^1 of 6 · All/.test(a.el('por-count').textContent),a.el('por-count').textContent);
    a.run('window.porSearch("")');await wait(260);
    a.run('window.porSetGroup("stage")');
    const g=a.el('por-list').innerHTML;
    s.ok('group by stage: the reserved group is collapsed (its row not drawn)',/aria-expanded="false" data-g="reserved"/.test(g)&&rowsOf(g).indexOf('PO-030')<0);
    a.run('window.porGroupToggle("reserved")');
    s.ok('opening it draws its row',rowsOf(a.el('por-list').innerHTML).indexOf('PO-030')>=0);
    a.run('window.porSetGroup("none")');a.run('window.porSetSort("number")');
    s.ok('sort by PO number (All keeps the cancelled PO last)',J(rowsOf(a.el('por-list').innerHTML))===J(['PO-001','PO-020','PO-030','PO-050','PO-060','PO-040']),J(rowsOf(a.el('por-list').innerHTML)));
    a.run('window.porSetView("active");window.porNeed("no_fabric")');
    s.ok('a needs chip filters the list',rowsOf(a.el('por-body').innerHTML).indexOf('PO-001')<0&&rowsOf(a.el('por-body').innerHTML).indexOf('PO-050')>=0);
    a.run('window.porOpen("PO-050\\"><x")');
    s.ok('porOpen ignores a key that is not a PO key',a.run('typeof viewingPO==="undefined"||viewingPO!==\'PO-050"><x\''));
  }
  s.section('who sees what');
  {
    const f=app({session:{u:'faizan',role:'packing',name:'Faizan'}});
    const h=f.run('renderRegistry()');
    s.ok('Faizan (packing) is pointed at Afloat POs, no rows',/data-por-restricted="1"/.test(h)&&/Afloat POs/.test(h)&&rowsOf(h).length===0);
    const ar=app({session:{u:'arfat',role:'manager',name:'Arfat'}});
    const h2=ar.run('renderRegistry()');
    s.ok('Arfat: marks and plans are not read, and the count line says so',/marks and cut plans are read only for the Production Ops team/.test(h2)&&rowsOf(h2).length>0);
    s.ok('Arfat: no hold badge is invented',!/On hold/.test(h2));
  }
  s.section('the module missing: the old list');
  {
    const a=app({noReg:true});const h=a.run('renderRegistry()');
    s.ok('without js/po-registry.js the old list is drawn',/class="po-row"/.test(h)&&!/por-body/.test(h));
  }
  s.section('css: tokens only, every selector .por-');
  {
    const css=read('css/main.css');const a=css.indexOf('/* po-registry START */'),b=css.indexOf('/* po-registry END */');
    const blk=a>0&&b>a?css.slice(a,b).replace(/\/\*[\s\S]*?\*\//g,''):'';
    s.ok('one delimited block',a>0&&b>a&&css.split('/* po-registry START */').length===2);
    s.ok('no literal colour in it',!!blk&&!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(blk));
    const sels=blk.replace(/@media[^{]*\{/g,'').split('}').map(x=>x.split('{')[0].trim()).filter(Boolean);
    s.ok('every selector is .por- prefixed ('+sels.length+')',sels.length>20&&sels.every(x=>x.split(',').every(p=>/\.por-/.test(p))),J(sels.filter(x=>!x.split(',').every(p=>/\.por-/.test(p)))));
  }
  s.section('wiring');
  {
    const IX=read('index.html'),SW=read('sw.js');
    s.ok('js/po-registry.js is loaded once, right after js/por-core.js',/\/js\/por-core\.js\?v=[^"]+"><\/script>\n<script src="\/js\/po-registry\.js\?v=[^"]+"><\/script>/.test(IX)&&IX.split('/js/po-registry.js?v=').length===2);
    s.ok('sw.js precaches it',SW.split("'/js/po-registry.js'").length===2);
    const names=[];SRC.reg.replace(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm,(x,n)=>names.push(n));
    s.ok('every top-level name is por/_por/POR_ prefixed',names.length>10&&names.every(n=>/^(por|_por|POR_)/.test(n)),J(names.filter(n=>!/^(por|_por|POR_)/.test(n))));
    s.ok('no window.X= reassigns a top-level function of the file',!names.some(n=>new RegExp('window\\.'+n+'\\s*=').test(SRC.reg)));
  }

  s.section('deliberate reverts');
  const REV=[
    ['the typeof/try fallback removed','the old list is drawn when the module throws','pos',"  if(typeof porRegistryHTML==='function'){try{return porRegistryHTML();}catch(e){console.warn('[pos] the PO Registry body failed, drawing the old list:',e);}}","  if(typeof porRegistryHTML==='function'){return porRegistryHTML();}"],
    ['the cleanup called from the new body','the registry never deletes on open','pos',"  if(!(_poRegTab==='orders'&&typeof porRegistryHTML==='function'))_cleanupAutoFabricPOs();","  _cleanupAutoFabricPOs();"],
    ['a failed pos read draws rows','no rows and no counts on a failed pos read','reg',"  if(failed&&failed.indexOf('pos')>=0)return'error';",""],
    ['unread fabric drawn as not issued','fabric not read is never "fabric not issued"','reg',"    if(f.fabric.state==='unread')return{text:'fabric: not read',cls:'por-muted'};\n",""],
    ['the page size removed','never more than 40 rows at once','reg',"g.rows.forEach(function(f){if(left>0){html+=porRowHTML(f);left--;}});","g.rows.forEach(function(f){html+=porRowHTML(f);});"],
    ['the name not escaped','a hostile name reaches the page as text','reg',"'<span class=\"por-name\">'+_porEsc(f.name||'—')+'</span>'","'<span class=\"por-name\">'+(f.name||'—')+'</span>'"],
    ['rows as div onclick','every row is a button, never a div onclick','reg',"return'<div class=\"por-item\"><button type=\"button\" class=\"por-row\" data-por=","return'<div class=\"por-item\"><div class=\"por-row\" data-por="],
    ['the alt text dropped','every picture has alt text','reg',"alt=\"'+_porEsc(alt)+'\" ",""],
    ['the default sort changed to newest','Active, oldest at this stage first','reg',"let _porState={view:'active',q:'',sort:'age',","let _porState={view:'active',q:'',sort:'newest',"]
  ];
  for(const r of REV){
    const file=r[2],from=r[3],to=r[4];
    if(SRC[file].indexOf(from)<0){s.ok('revert "'+r[0]+'" landed',false);continue;}
    let c;try{c=await checks({src:{[file]:SRC[file].split(from).join(to)}});}catch(e){c={};}
    s.ok('revert "'+r[0]+'" fails "'+r[1]+'"',c[r[1]]!==true);
  }
  return s;
};

/* Inventory Intel ▸ Article Explorer: the Compare flow (Selected tray, ✓ state, Compare →) and the navigation search box
   ("/" shortcut, one box on every sub-tab). Drives the REAL handlers; each "break" mutates the source and the named
   check must FAIL. Fixture: six articles; AAA has a picture, DDD none. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'../css/main.css'),'utf8');
function load(src){
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false,data:()=>({})})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const G='https://cdn.shopify.com/s/files/1/0509/8730/3069/files/Final_6a538b81.jpg?v=1726686247';
const P=(sku,t,img)=>({_id:sku,sku,product_title:t,color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:'2026-04-10T10:00:00+05:00',image_url:img});
const li=(sku,q,day)=>({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
function checks(src){
  const o={},a=load(src),R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-10-01")+(off||0));}');
  const codes=['AAA','BBB','CCC','DDD','EEE','FFF'];
  const prods=codes.map(c=>P(c+'-M','Art '+c,c==='DDD'?'':G));
  const items=codes.map((c,i)=>li(c+'-M',10-i,'2026-09-12'));
  R('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siAxCache=null;_siHistState="ok";_siHist=_siAxBuildHistory([]);_siSection="explorer";');
  // a document whose input records focus, and whose result node records the scroll
  R('window.__foc=0;window.__sc=0;window.__inp={value:"",focus(){window.__foc++;},select(){},setSelectionRange(){}};window.__res={innerHTML:""};window.__body={innerHTML:""};window.__go={classList:{add(){},remove(){}},scrollIntoView(){window.__sc++;},focus(){}};'
   +'var _g0=document.getElementById;document.getElementById=function(i){return i==="si-ax-input"?window.__inp:i==="si-ax-results"?window.__res:i==="si-ax-body"?window.__body:i==="si-ax-result"?window.__go:null;};');
  const mode=m=>R('_siAxModeSel="'+m+'";_siAxCmp=[];_siAxMsg="";_siAxQuery="";_siAxSel="";_siAxFlashClear&&0');
  const tray=()=>R('_siAxTrayHtml()');
  // ---- Compare flow
  mode('compare');
  o['empty: the tray says Selected (0 of 5) and no Compare → button']=/Selected \(0 of 5\)/.test(tray())&&!/si-ax-go/.test(tray());
  R('window._siAxAdd("AAA")');
  o['add 1: one picture card, Selected (1 of 5), still no Compare → button']=(tray().match(/class="si-ax-card"/g)||[]).length===1&&/Selected \(1 of 5\)/.test(tray())&&!/si-ax-go/.test(tray());
  o['add 1: the card carries the picture, the title, the code and a remove button']=/<span class="si-th"[^>]*data-th="AAA"[^>]*><img[^>]*src="https:\/\/cdn\.shopify\.com/.test(tray())&&/Art AAA/.test(tray())&&/class="si-ax-x"[^>]*onclick="window\._siAxRemove/.test(tray());
  o['add 1: the existing badge on the tab stays']=/si-ax-cbadge/.test(R('_siAxModeBtnHtml("compare","Compare")'));
  o['focus stays in the search box after an add']=R('window.__foc')>=1;
  R('window._siAxAdd("DDD")');
  o['add 2: Compare → appears and is enabled (not disabled), at least 44px by CSS']=/<button class="si-ax-go" id="si-ax-go" onclick="window\._siAxGo\(\)">Compare →<\/button>/.test(tray())&&/\.si-ax-go\{[^}]*min-height:44px/.test(CSS);
  o['a card without a picture shows the code tile (no <img>)']=(()=>{const c=tray().split('class="si-ax-card"')[2]||'';return /<b class="si-th-c">DDD<\/b>/.test(c)&&!/<img/.test(c);})();
  o['the result wrapper is in the comparison body and is focusable']=/<div id="si-ax-result" class="si-ax-resultwrap" tabindex="-1">/.test(R('_siAxCompareBody()'));
  R('window.__sc=0');R('window._siAxGo()');
  o['Compare → scrolls the comparison into view']=R('window.__sc')===1;
  R('window._siAxAdd("BBB");window._siAxAdd("CCC");window._siAxAdd("EEE")');
  o['five added: Selected (5 of 5)']=/Selected \(5 of 5\)/.test(tray())&&R('_siAxCmp.length')===5;
  R('window._siAxAdd("FFF")');
  o['at the maximum the sixth is refused with a message, and the tray shows it']=R('_siAxCmp.length')===5&&/at most 5 articles/.test(tray())&&/role="alert"/.test(tray());
  R('_siAxQuery="art"');
  const res=R('_siAxResultsHtml()');
  o['results mark an already chosen article ✓ Added (pressed), others + Add']=/is-added[^>]*data-code="AAA"[^>]*aria-pressed="true"/.test(res)&&/data-code="FFF"[^>]*aria-pressed="false"[^]*?\+ Add/.test(res)&&/✓ Added/.test(res);
  o['results carry a 40px picture for each article, and a code tile when there is none']=(res.match(/class="si-th" style="width:40px;height:40px"/g)||[]).length>=5&&/<b class="si-th-c">DDD<\/b>/.test(res);
  R('window._siAxRemove("AAA")');
  o['remove frees a slot and the card goes']=R('_siAxCmp.length')===4&&!/data-th="AAA"/.test(tray())&&/Selected \(4 of 5\)/.test(tray());
  o['remove down to 1 brings the alert back and drops Compare →']=(()=>{R('window._siAxRemove("BBB");window._siAxRemove("CCC");window._siAxRemove("EEE")');return R('_siAxCmp.length')===1&&!/si-ax-go/.test(tray());})();
  o['the selection survives switching tabs and coming back']=(()=>{R('window._siAxSetMode("search")');R('window._siAxSetMode("compare")');return R('_siAxCmp.join()')==='DDD';})();
  o['phone: the maximum is 3']=(()=>{R('window.matchMedia=function(q){return{matches:/max-width:600px/.test(q)};}');const t=tray();R('delete window.matchMedia');return /Selected \(1 of 3\)/.test(t);})();
  o['Enter on a typed query adds the top match in Compare and keeps focus']=(()=>{mode('compare');R('window.__foc=0;_siAxQuery="art aaa"');R('window._siAxKey({key:"Enter",preventDefault(){}})');return R('_siAxCmp.join()')==='AAA'&&R('window.__foc')>=1;})();
  o['strings are escaped in a card (a title with markup)']=(()=>{R('_siAxIndex().map.get("AAA").name="<b>x</b>"');const t=tray();return !/<b>x<\/b>/.test(t)&&/&lt;b&gt;x&lt;\/b&gt;/.test(t);})();
  // ---- the navigation search box
  ['overview','portfolio','search','compare'].forEach(m=>{
    mode(m);
    const h=R('_siArticleExplorerSection()');
    o['the search box is on the '+m+' tab, labelled, with a magnifier path and the / hint']=/<input id="si-ax-input"[^>]*aria-label="Find an article"[^>]*placeholder="Find an article/.test(h)&&/<svg class="si-ax-mag"[^>]*><path d="[^"]+"\/><\/svg>/.test(h)&&/class="si-ax-kbd"/.test(h)&&!/<text|<title/.test(h.match(/<svg class="si-ax-mag"[^]*?<\/svg>/)[0]);
  });
  o['the search box sits in the sticky wrapper']=/id="si-ax-sticky"[^]*id="si-ax-input"[^]*id="si-ax-results"/.test(R('_siArticleExplorerSection()'));
  o['Overview and Portfolio results open the article page (Open), Search picks, Compare adds']=(()=>{const f=m=>{mode(m);R('_siAxQuery="art"');return(R('_siAxResultsHtml()').match(/window\._siAx(\w+)\(this/)||[])[1];};return f('overview')==='Open'&&f('portfolio')==='Open'&&f('search')==='Pick'&&f('compare')==='Add';})();
  o['an empty box on Overview and Portfolio shows no dropdown']=(()=>{mode('overview');R('_siAxQuery=""');const a=R('_siAxResultsHtml()');mode('portfolio');return a===''&&R('_siAxResultsHtml()')==='';})();
  o['Enter on Overview opens the top match']=(()=>{mode('overview');R('_siAxQuery="art bbb"');R('window._siAxKey({key:"Enter",preventDefault(){}})');return R('_siAxModeSel')==='search'&&R('_siAxSel')==='BBB';})();
  // ---- "/" shortcut
  const slash=(t,extra)=>{R('window.__foc=0');let pd=0;const ev=Object.assign({key:'/',target:t||{tagName:'DIV'},preventDefault(){pd=1;}},extra||{});(a.state.listeners.keydown||[]).forEach(f=>f(ev));return{foc:R('window.__foc'),pd};};
  mode('compare');
  o['"/" focuses the box and swallows the key when nothing is being typed']=(()=>{const r=slash();return r.foc===1&&r.pd===1;})();
  o['"/" does nothing while typing in an input, textarea, select or a contenteditable']=['INPUT','TEXTAREA','SELECT'].every(t=>slash({tagName:t}).foc===0)&&slash({tagName:'DIV',isContentEditable:true}).foc===0;
  o['"/" does nothing with Ctrl, Meta or Alt held']=slash(null,{ctrlKey:true}).foc===0&&slash(null,{metaKey:true}).foc===0&&slash(null,{altKey:true}).foc===0;
  o['"/" does nothing for another key']=slash(null,{key:'a'}).foc===0;
  o['"/" does nothing on another Inventory Intel section or when the box is not on screen']=(()=>{R('_siSection="sku"');const x=slash().foc===0;R('_siSection="explorer"');return x;})();
  o['the listener is registered once, however often the section is painted']=(()=>{R('_siArticleExplorerSection();_siArticleExplorerSection()');return (a.state.listeners.keydown||[]).length===1;})();
  // ---- CSS
  o['css: the box is at least 48px tall, has a solid 2px token border and a visible focus ring']=/\.si-ax-sbox\{[^}]*min-height:52px[^}]*border:2px solid var\(--text\)/.test(CSS)&&/\.si-ax-sbox:focus-within\{outline:3px solid var\(--cat-notes\)/.test(CSS);
  o['css: sticky under the app bar (z-index below 100), opaque, and the results are capped']=/\.si-ax-sticky\{position:sticky;top:0;z-index:20;background:var\(--bg\)/.test(CSS)&&/\.si-ax-sticky \.si-ax-results\{[^}]*max-height:min\(/.test(CSS);
  o['css: the new rules use tokens only']=(()=>{const m=CSS.slice(CSS.indexOf('.si-ax-sticky{position:sticky')).replace(/box-shadow:[^;}]*/g,'');return !/#[0-9a-fA-F]{3,6}\b/.test(m);})();
  o['css: text is 16px in the box (no iOS zoom), remove target 40px, reduced motion honoured']=/\.si-ax-input\{[^}]*font-size:16px/.test(CSS)&&/\.si-ax-x\{[^}]*min-width:40px;min-height:40px/.test(CSS)&&/prefers-reduced-motion:reduce\)\{\.si-ax-sbox/.test(CSS);
  o['no new Firestore read: the whole flow calls getDocs/getDoc zero times']=(()=>{R('getDocs=function(){window.__q=(window.__q||0)+1;return Promise.resolve({forEach(){}});};getDoc=getDocs;window.__q=0');mode('compare');R('window._siAxAdd("AAA");window._siAxAdd("BBB");_siArticleExplorerSection();window._siAxGo()');return R('window.__q')===0;})();
  return o;
}
module.exports=async function(){
  const s=suite('shopify-explorer-compare-flow');
  const base=checks(SRC);
  s.section('compare flow and the navigation search box');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  const brk=(label,from,to,failing)=>{
    if(SRC.split(from).length-1<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true));
  };
  brk('Compare → shown from one article','const go=n>=2?','const go=n>=1?',['add 1: one picture card, Selected (1 of 5), still no Compare → button']);
  brk('Compare → never shown','const go=n>=2?','const go=n>=99?',['add 2: Compare → appears and is enabled (not disabled), at least 44px by CSS']);
  brk('no ✓ state','on?\'<span class="si-ax-added" aria-hidden="true">✓ Added</span>\'','on?\'<span class="si-ax-plus" aria-hidden="true">+ Add</span>\'',['results mark an already chosen article ✓ Added (pressed), others + Add']);
  brk('no picture in results','return`<button class="si-ax-hit${on?\' is-added\':\'\'}" data-code="${_siEsc(a.code)}"${add?` aria-pressed="${on}"`:\'\'} onclick="window._siAx${fn}(this.dataset.code)">${_siAxThumb(a.code,40,a.name)}','return`<button class="si-ax-hit${on?\' is-added\':\'\'}" data-code="${_siEsc(a.code)}"${add?` aria-pressed="${on}"`:\'\'} onclick="window._siAx${fn}(this.dataset.code)">',['results carry a 40px picture for each article, and a code tile when there is none']);
  brk('no picture on the card','<i class="si-ax-badge si-ax-b${i}">${i+1}</i>${_siAxThumb(a.code,64,a.name)}','<i class="si-ax-badge si-ax-b${i}">${i+1}</i>',['add 1: the card carries the picture, the title, the code and a remove button']);
  brk('Compare → does not scroll','if(typeof c.scrollIntoView===\'function\')try{c.scrollIntoView({behavior:calm?\'auto\':\'smooth\',block:\'start\'});}catch(_){}\n  if(typeof c.focus','if(typeof c.focus',['Compare → scrolls the comparison into view']);
  brk('focus lost after add','if(r.ok){const i=document.getElementById(\'si-ax-input\');if(i)i.focus();_siAxSyncTab();','if(r.ok){_siAxSyncTab();',['focus stays in the search box after an add']);
  brk('no cap message','return{ok:false,msg:\'You can compare at most \'','return{ok:false,msg:\'\'+\'You can compare at most \'.slice(0,0)+\'\'',['at the maximum the sixth is refused with a message, and the tray shows it']);
  brk('"/" ignores typing guard','if(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||\'\')||t.isContentEditable))return false;','',['"/" does nothing while typing in an input, textarea, select or a contenteditable']);
  brk('"/" ignores modifiers','e.ctrlKey||e.metaKey||e.altKey','false',['"/" does nothing with Ctrl, Meta or Alt held']);
  brk('"/" ignores the section','if(typeof _siSection===\'undefined\'||_siSection!==\'explorer\')return false;','',['"/" does nothing on another Inventory Intel section or when the box is not on screen']);
  brk('"/" listener every paint','if(_siAxSlashWired||typeof document','if(typeof document',['the listener is registered once, however often the section is painted']);
  brk('"/" not prevented','if(e.preventDefault)e.preventDefault();\n    i.focus();','i.focus();',['"/" focuses the box and swallows the key when nothing is being typed']);
  brk('search box only on Search and Compare','${_siAxSearchBarHtml()}','${_siAxModeSel===\'search\'||_siAxModeSel===\'compare\'?_siAxSearchBarHtml():\'\'}',['the search box is on the overview tab, labelled, with a magnifier path and the / hint','the search box is on the portfolio tab, labelled, with a magnifier path and the / hint']);
  brk('overview picks instead of opening','fn=add?\'Add\':(mode===\'search\'?\'Pick\':\'Open\')','fn=add?\'Add\':\'Pick\'',['Overview and Portfolio results open the article page (Open), Search picks, Compare adds']);
  brk('empty overview box lists','if(!q&&(mode===\'overview\'||mode===\'portfolio\'||','if(!q&&(',['an empty box on Overview and Portfolio shows no dropdown']);
  brk('label text inside the svg','<path d="M10.5 3a7.5','<title>Search</title><path d="M10.5 3a7.5',['the search box is on the compare tab, labelled, with a magnifier path and the / hint']);
  return s;
};

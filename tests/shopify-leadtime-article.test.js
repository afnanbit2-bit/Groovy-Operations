/* Inventory Intel ▸ Article Explorer — per-article lead time (override -> category default -> global fallback).
   Drives the real handlers (_siAxSetLtArt, _siAxResetLtArt, _siAxLtKey, _siAxLtEdit) against the 42-article tees
   fixture of shopify-plan5. Hand-computed: P40 cover 2.3 weeks, P30 cover 3.1 weeks; default tees lead time 21 days
   (3 weeks). Reorder needs cover < lead weeks; Stock-out risk needs cover < lead weeks + 2.
   Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
function load(src,store){
  store=store||{};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false,data:()=>({})})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
function checks(src){
  const store={},a=load(src,store),R=c=>a.run(c),o={};
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
  const li=(sku,q,day)=>({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
  const prod=(c,type)=>({_id:c+'-M',sku:c+'-M',product_title:'Art '+c,color:'Blue',size:'M',product_type:type||'Tees',status:'active',published_at:'2025-01-01T10:00:00+05:00'});
  const codes=[];for(let k=1;k<=40;k++)codes.push('P'+k);
  const prods=codes.map(c=>prod(c)).concat([prod('Q'),prod('DD'),prod('GF'),prod('HH','Hoodies')]);
  const items=[li('GF-M',10,'2026-06-01'),li('Q-M',30,'2026-08-05'),li('DD-M',5,'2026-06-10')];
  codes.forEach((c,i)=>items.push(li(c+'-M',i+1,'2026-08-15')));
  R('_siProducts='+J(prods));R('_siLineItems='+J(items));
  const base=R('_siAxDayNum("2026-08-01")'),ds=n=>R('_siAxDayStr('+n+')');
  const snaps=[];
  for(let k=0;k<31;k++){const it={};codes.forEach(c=>{it[c]={sku:c+'-M',available:20};});
    it.Q={sku:'Q-M',available:k<=10?20:0};it.DD={sku:'DD-M',available:20};
    snaps.push({date:ds(base+k),items:it});}
  R('_siHist=_siAxBuildHistory('+J(snaps)+');_siHistState="ok";_siSnapshot='+J(snaps[30])+';_siPrevSnapshot='+J(snaps[23])+';_siAxCache=null');
  const A=c=>R('(()=>{const r=_siAxActionOf(_siAxIndex().map.get("'+c+'"));return{k:r.key,label:r.label,text:r.text,lt:r.lead.days,article:r.lead.article,custom:r.lead.custom,src:r.lead.source,lt_text:r.lead.text};})()');
  const LT=c=>R('(()=>{const l=_siAxLeadTime(_siAxIndex().map.get("'+c+'"));return l.days+","+l.source;})()');
  const ovn=k=>R('_siAxOvRows().filter(r=>_siAxOvIn(r,"'+k+'")).length');
  R('_siAxModeSel="search";_siAxSel="P30";_siAxQuery=""');
  const body=()=>a.el('si-ax-body').innerHTML;

  // before: defaults
  o['default: P30 is Stock-out risk on the 21-day default']=A('P30').k==='risk'&&LT('P30')==='21,default'&&/default lead time, unconfirmed|default, unconfirmed/.test(A('P30').text);
  o['default overview: reorder 11, risk 12']=ovn('reorder')===11&&ovn('risk')===12;
  R('getDocs=function(){window.__fetch=(window.__fetch||0)+1;return Promise.resolve({forEach(){}});};window.scrollY=420;window.__sc=[];window.scrollTo=function(x,y){window.__sc.push(y);};');

  // set an override through the real handler
  o['handler accepts 35 days']=R('window._siAxSetLtArt("P30","35")')===true;
  o['override is stored as CODE -> days']=store['groovy-si-leadtimes-article']==='{"P30":35}';
  o['override beats the category default (35, not 21)']=LT('P30')==='35,article'&&LT('P29')==='21,default';
  const a30=A('P30');
  o['P30 crosses the threshold: 3.1 weeks of cover is under 35 days (5 weeks): Reorder now']=a30.k==='reorder'&&a30.lt===35;
  o['label says it is the article\'s own lead time']=a30.article===true&&a30.lt_text==='your lead time for this article'&&/your lead time for this article/.test(a30.text)&&!/default lead time, unconfirmed/.test(a30.text);
  o['Overview membership follows at once: reorder 12, risk 11']=ovn('reorder')===12&&ovn('risk')===11;
  const b1=body();
  o['verdict body repainted: sentence, action, control and custom chip']=/si-vd-act">Reorder now</.test(b1)&&/against a 35-day lead time/.test(b1)&&/Lead time: 35 days/.test(b1)&&/si-lt-chip">custom</.test(b1);
  o['no data was fetched, scroll position restored']=R('window.__fetch||0')===0&&R('J=JSON.stringify(window.__sc)')==='[420]';
  // other article unaffected
  o['another article keeps the default']=A('P40').k==='reorder'&&A('P40').lt===21&&A('P40').article===false;

  // category default underneath the article override
  R('window._siAxSetLt("tops",7)');
  o['category default applies to articles without an override (7)']=LT('P29')==='7,category'&&A('P29').custom===true&&A('P29').article===false;
  o['article override still beats the category setting']=LT('P30')==='35,article';
  R('window._siAxSetLt("tops","")');
  o['an article with no category still resolves (global fallback 28)']=R('_siAxLeadTime({code:"ZZ",category:""}).days')===28&&R('_siAxLeadTime({}).days')===28;

  // editor: Edit opens it, Enter saves, Escape cancels
  R('window._siAxLtEdit("P30")');
  const b2=body();
  o['Edit opens an inline number input with Save, Reset to default and Cancel']=/data-lt-input="1"/.test(b2)&&/>Save</.test(b2)&&/>Reset to default</.test(b2)&&/>Cancel</.test(b2)&&/value="35"/.test(b2);
  R('window._siAxLtKey({key:"Escape",preventDefault(){}},{dataset:{code:"P30"},value:"99"})');
  o['Escape cancels: nothing saved, editor closed']=store['groovy-si-leadtimes-article']==='{"P30":35}'&&!/data-lt-input/.test(body());
  R('window._siAxLtEdit("P30");window._siAxLtKey({key:"Enter",preventDefault(){}},{dataset:{code:"P30"},value:"7"})');
  o['Enter saves 7 days (1 week): P30 cover 3.1 weeks is above 1 + 2, so No action']=store['groovy-si-leadtimes-article']==='{"P30":7}'&&A('P30').k==='ok';
  // invalid input keeps the editor open with a message and stores nothing
  R('window._siAxLtEdit("P30")');
  const bad=['0','999','abc','-4'].map(v=>R('window._siAxSetLtArt("P30","'+v+'")'));
  o['0, 999, abc, -4 are refused and nothing changes']=bad.every(x=>x===false)&&store['groovy-si-leadtimes-article']==='{"P30":7}';
  o['a refusal says why and keeps the editor open']=/Enter a whole number of days from 1 to 365/.test(body())&&/data-lt-input/.test(body());
  R('window._siAxSetLtArt("P30","12.6")');
  o['12.6 is stored as whole days (13)']=store['groovy-si-leadtimes-article']==='{"P30":13}';
  R('window._siAxSetLtArt("p30","9")');
  o['the code is case-insensitive and stored upper-case']=store['groovy-si-leadtimes-article']==='{"P30":9}';

  // the panel list
  R('window._siAxSetLtArt("P31","40")');
  const panel=R('_siAxLtHtml()');
  o['defaults panel lists articles with their own lead time, each with Reset']=/Articles with their own lead time \(2\)/.test(panel)&&(panel.match(/_siAxResetLtArt\(this\.dataset\.code\)/g)||[]).length===2&&/Art P30/.test(panel);

  // reset
  R('window._siAxResetLtArt("P30")');
  o['Reset removes the override: default is back (21, Stock-out risk)']=store['groovy-si-leadtimes-article']==='{"P31":40}'&&LT('P30')==='21,default'&&A('P30').k==='risk'&&!/si-lt-chip/.test(body().split('si-ax-kpis')[0]);
  R('window._siAxResetLtArt("P31")');
  o['removing the last override removes the key']=store['groovy-si-leadtimes-article']===undefined;
  R('window._siAxSetLtArt("P30","35");window._siAxSetLtArt("P30","")');
  o['an empty value saves as a reset']=store['groovy-si-leadtimes-article']===undefined&&LT('P30')==='21,default';
  o['a fresh panel says none, with the count 0']=/Articles with their own lead time \(0\)/.test(R('_siAxLtHtml()'));

  // corrupt / hostile storage
  const bs=['{bad json','[1,2,3]','null','"x"','{"P30":"x","P31":-3,"P32":500,"P33":true,"P34":"","__proto__":9,"P35":null}'];
  const res=bs.map(v=>{store['groovy-si-leadtimes-article']=v;return R('(()=>{const l=_siAxLeadTime(_siAxIndex().map.get("P30"));return l.days+","+l.source+","+Object.keys(_siAxLtArtStored()).length;})()');});
  o['corrupt, array, null, string and out-of-range storage are ignored']=res.every(r=>r==='21,default,0');
  store['groovy-si-leadtimes-article']='{"P30":"35","P31":-3,"P29":"8"}';
  o['valid entries survive beside junk (string "35" counts, -3 does not)']=LT('P30')==='35,article'&&LT('P31')==='21,default'&&LT('P29')==='8,article';
  delete store['groovy-si-leadtimes-article'];
  o['storage that throws does not break the reader or the handler']=R('(()=>{const g=localStorage;localStorage={getItem(){throw new Error("x");},setItem(){throw new Error("y");},removeItem(){throw new Error("z");}};try{const d=_siAxLeadTime({code:"P30",category:"Tees"}).days;window._siAxSetLtArt("P30","5");window._siAxResetLtArt("P30");return d;}finally{localStorage=g;}})()')===21;

  // escaping
  const evil='A"><img src=x onerror=alert(1)>';
  const ctl=R('_siAxLtCtlHtml({code:'+J(evil)+',name:"N<b>x</b>",color:"",category:"Tees"})');
  o['control escapes the code in every attribute']=!/<img/i.test(ctl)&&/&lt;img/i.test(ctl);
  R('window._siAxLtEdit('+J(evil)+')');
  const ctl2=R('_siAxLtCtlHtml({code:'+J(evil)+',name:"N<b>x</b>",color:"",category:"Tees"})');
  o['editing control escapes code and article name']=!/<img/i.test(ctl2)&&!/N<b>/.test(ctl2);
  R('_siAxLtEdit=null');
  store['groovy-si-leadtimes-article']=J({'<script>x</script>':30});
  o['the defaults panel escapes stored codes']=!/<script>x/.test(R('_siAxLtHtml()'))&&/&lt;SCRIPT&gt;/.test(R('_siAxLtHtml()'));
  delete store['groovy-si-leadtimes-article'];
  // overview rows carry the control
  R('_siAxModeSel="overview";_siAxOvTile="reorder";_siAxOvAll=false;_siAxOvCat=""');
  const ov=R('_siAxOverviewBody()');
  o['every Overview row carries "Lead time: N days" and Edit']=(ov.match(/Lead time: /g)||[]).length===10&&(ov.match(/_siAxLtEdit\(this\.dataset\.code\)/g)||[]).length===10;
  return o;
}
module.exports=async function(){
  const s=suite('shopify-leadtime-article');
  const base=checks(SRC);
  s.section('per-article lead time (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  brk('override ignored','const ad=_siAxLtArtDays(a&&a.code),article=ad!=null;','const ad=null,article=false;',['override beats the category default (35, not 21)','P30 crosses the threshold: 3.1 weeks of cover is under 35 days (5 weeks): Reorder now']);
  brk('category beats article','const days=article?ad:(cat?Math.round(v):','const days=cat?Math.round(v):(article?ad:(',['article override still beats the category setting']);
  brk('reset keeps the value','const map=_siAxLtArtStored();delete map[c];_siAxLtWrite(map);','const map=_siAxLtArtStored();_siAxLtWrite(map);',['Reset removes the override: default is back (21, Stock-out risk)']);
  brk('bounds dropped','n>=1&&n<=365)?Math.round(n):null;}','n>=0&&n<=99999)?Math.round(n):null;}',['0, 999, abc, -4 are refused and nothing changes','corrupt, array, null, string and out-of-range storage are ignored']);
  brk('label shows default wording','const text=article?\'your lead time for this article\'','const text=article?\'default lead time, unconfirmed\'',['label says it is the article\'s own lead time']);
  brk('code not escaped','ec=_siEsc(code)','ec=code',['control escapes the code in every attribute']);
  brk('Escape saves','else if(ev.key===\'Escape\'){if(ev.preventDefault)ev.preventDefault();window._siAxLtCancel(el.dataset.code);}','else if(ev.key===\'Escape\'){if(ev.preventDefault)ev.preventDefault();window._siAxSetLtArt(el.dataset.code,el.value);}',['Escape cancels: nothing saved, editor closed']);
  brk('no repaint after save','if(document.getElementById(\'si-ax-body\'))_siAxRepaintBody();','if(false)_siAxRepaintBody();',['verdict body repainted: sentence, action, control and custom chip']);
  brk('scroll not restored','try{window.scrollTo(0,sy);}catch(_){}','',['no data was fetched, scroll position restored']);
  brk('corrupt JSON crashes','}catch(_){}\n  return out;','}finally{}\n  return out;',['corrupt, array, null, string and out-of-range storage are ignored']);
  brk('codes case-sensitive','const k=String(c==null?\'\':c).trim().toUpperCase();','const k=String(c==null?\'\':c).trim();',['the code is case-insensitive and stored upper-case']);
  brk('list not shown','${_siAxLtArtListHtml()}</div>`;','</div>`;',['defaults panel lists articles with their own lead time, each with Reset']);
  brk('rows lose the control','<div class="lt">${_siAxLtCtlHtml(r.a)}</div>','',['every Overview row carries "Lead time: N days" and Edit']);
  s.ok('breaks run: '+broken,broken>=15);
  return s;
};

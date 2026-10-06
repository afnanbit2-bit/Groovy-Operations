/* Inventory Intel ▸ Type & season fill queue (sub-phase 2 of the product-data work). Every expectation is HAND-COMPUTED on the 9-article fixture below
   (clock FAKE, today 2026-08-31), the checks DRIVE the real handler (_siTsSet) and the real renderers, and each "break" mutates the source (or the
   rules text) and requires the named check to FAIL.
   FIXTURE (title | Shopify product_type | first sale | expectation):
     T1 Classic Tee | Tees | 2026-07-05 | type top (from its Shopify type) | season summer (July)
     T2 Hoodie Black | Hoodies | 2026-11-10 | top | winter (November)
     B1 Cargo Pants | Pants | 2027-01-20 | bottom | winter (January)
     B2 Denim Shorts | Shorts | 2026-05-01 | bottom | summer (May)
     S1 Short Sleeve Tee | (none) | 2026-10-01 | top FROM THE NAME: "short sleeve" is not shorts | winter (1 Oct is the first winter day)
     X1 Hoodie and Joggers Set | Co-ord | 2026-02-28 | no type (a top word AND a bottom word) | summer (28 Feb is summer under the owner map Oct-Jan / Feb-Sep)
     Z1 Mystery Item | (none) | 2026-03-01 | no type | summer
     J1 Bomber Jacket | Jackets | 2026-09-30 | top | summer (30 Sep is the last summer day)
     G1 Ignored Tee | Tees | 2026-06-01 | ignored for good -> not in the live list at all
   Live = 8. Progress with nothing saved: 0 of 8 = 0%, 0 cubes of 20. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/shopify.js'),'utf8');
const RULES=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8').replace(/\r/g,'');
function load(src){
  const store={};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const ART=[['T1','Classic Tee','Tees','2026-07-05'],['T2','Hoodie Black','Hoodies','2026-11-10'],['B1','Cargo Pants','Pants','2027-01-20'],['B2','Denim Shorts','Shorts','2026-05-01'],
  ['S1','Short Sleeve Tee','','2026-10-01'],['X1','Hoodie and Joggers Set','Co-ord','2026-02-28'],['Z1','Mystery Item','','2026-03-01'],['J1','Bomber Jacket','Jackets','2026-09-30'],['G1','Ignored Tee','Tees','2026-06-01']];
function fixture(a){
  const prods=[],items=[];
  ART.forEach(([c,t,pt,day],i)=>{
    prods.push({_id:c+'-M',sku:c+'-M',product_title:t,color:'Blue',size:'M',product_type:pt,status:'active',published_at:''});
    items.push({sku:c+'-M',quantity:10-i,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
  });
  a.run('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siSnapshot=null;_siPrevSnapshot=null;_siAxCache=null;_siNaMemo=null;_siLoaded=true;_siMetaState="ok";_siMeta=new Map([["G1",_siMetaClean("G1",{ignoreForever:true})]]);_siIgVer++;');
}
function stub(a){
  const W={calls:[],fail:null,acts:[]};
  a.run('doc=function(d,c,id){return{c,id}};collection=function(d,n){return{n}};');
  a.ctx.setDoc=(ref,data,opts)=>{W.calls.push({ref,data:JSON.parse(JSON.stringify(data)),opts});return W.fail?Promise.reject(W.fail):Promise.resolve();};
  a.ctx.logActivity=(x,y)=>{W.acts.push([x,y]);};
  return W;
}
function ruleBlock(rules){
  const key='match /inventory_article_meta/{code}',k=rules.indexOf(key);
  if(k<0)return'';
  let d=0,e=rules.indexOf('{',k+key.length);const st=e;
  for(;e<rules.length;e++){if(rules[e]==='{')d++;else if(rules[e]==='}'){d--;if(!d)break;}}
  return rules.slice(st,e+1);
}
async function checks(src,rules){
  rules=rules==null?RULES:rules;
  const a=load(src),R=c=>a.run(c),o={};
  fixture(a);
  const W=stub(a);
  R('_siNow=function(){return '+Date.parse('2026-08-31T12:00:00+05:00')+'};_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));};');
  const live=()=>R('J=JSON.stringify(_siAxLive().map(a=>a.code).sort())'),prog=()=>JSON.parse(R('J=JSON.stringify(_siTsProgress(_siAxLive(),_siMeta,_siMetaState))'));
  const body=()=>R('_siTsBodyHtml()');
  // ── vocab and the rules ──
  const blk=ruleBlock(rules);
  const enumOf=n=>((new RegExp(n+" in \\[([^\\]]*)\\]").exec(blk)||[])[1]||'').split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean).sort().join();
  o['vocab: the types equal the rules enum exactly (top, bottom, other)']=JSON.parse(R('J=JSON.stringify(_SI_TYPES.map(t=>t.k))')).sort().join()===enumOf('type')&&enumOf('type')==='bottom,other,top';
  o['vocab: the seasons equal the rules enum exactly (winter, summer, all)']=JSON.parse(R('J=JSON.stringify(_SI_SEASONS.map(t=>t.k))')).sort().join()===enumOf('season')&&enumOf('season')==='all,summer,winter';
  o['vocab: the loader keeps a stored type and season only when they are on the lists']=(()=>{const m=JSON.parse(R('J=JSON.stringify([_siMetaClean("T1",{type:"top",season:"winter"}),_siMetaClean("T1",{type:"hat",season:"monsoon"})])'));return m[0].type==='top'&&m[0].season==='winter'&&m[1].type===null&&m[1].season===null;})();
  o['rules: the field allow-list still names type and season and the JS list equals it (no rules change was needed)']=(()=>{const f=((/keys\(\)\.hasOnly\(\[([^\]]*)\]\)/.exec(blk)||[])[1]||'').split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean).sort().join();return f===JSON.parse(R('J=JSON.stringify(_SI_META_FIELDS)')).sort().join()&&/'type','season'/.test(blk);})();
  // ── suggestions (pure) ──
  const st=(cat,t)=>R('J=JSON.stringify(_siTsSuggestType('+J(cat)+','+J(t)+'))');
  const sug=(cat,t)=>JSON.parse(st(cat,t));
  o['type suggestion: Tees -> top, Pants -> bottom, Shorts -> bottom, Jackets -> top, from the Shopify type']=sug('Tees','x').k==='top'&&sug('Pants','x').k==='bottom'&&sug('Shorts','x').k==='bottom'&&sug('Jackets','x').k==='top'&&/Shopify type/.test(sug('Tees','x').why);
  o['type suggestion: no Shopify type -> the name decides ("Cargo Pants" bottom, "Classic Tee" top)']=sug('','Cargo Pants').k==='bottom'&&sug('','Classic Tee').k==='top'&&/name/.test(sug('','Classic Tee').why);
  o['type suggestion: "Short Sleeve Tee" is a top, never shorts']=sug('','Short Sleeve Tee').k==='top'&&sug('','Short-sleeved T-Shirt').k==='top';
  o['type suggestion: a top word AND a bottom word in one text (a set) gives no suggestion, and so does an unknown name']=st('Co-ord','Hoodie and Joggers Set')==='null'&&st('','Hoodie and Joggers Set')==='null'&&st('','Mystery Item')==='null';
  o['type suggestion: a Shopify type that decides beats a misleading name']=sug('Pants','Hoodie Black').k==='bottom';
  const ss=(d,t,sib)=>JSON.parse(R('J=JSON.stringify(_siTsSuggestSeason('+J(d)+','+J(t)+','+J(sib||[])+'))'));
  o['season suggestion: winter is Oct to Jan — 2026-10-01, 2026-12-31 and 2027-01-31 winter; 2027-02-01, 2026-09-30 and 2026-03-01 summer']=ss('2026-10-01','',[])[0].k==='winter'&&ss('2026-12-31','',[])[0].k==='winter'&&ss('2027-01-31','',[])[0].k==='winter'&&ss('2027-02-01','',[])[0].k==='summer'&&ss('2026-09-30','',[])[0].k==='summer'&&ss('2026-03-01','',[])[0].k==='summer';
  o['season suggestion: no date -> no date-based suggestion (never a guessed one)']=ss('','',[]).length===0;
  o['season suggestion: siblings need at least 3 and a 60% majority — 4 winter of 5 (80%) is offered, 2 of 3 winter (66%) is, 1 of 2 and 2 of 5 are not']=(()=>{
    const w4=ss('2026-07-05','Top',['winter','winter','winter','winter','summer']),w3=ss('2026-07-05','Top',['winter','winter','summer']),two=ss('2026-07-05','Top',['winter','summer']),spl=ss('2026-11-10','Top',['winter','winter','summer','summer','all']),two2=ss('2026-07-05','Top',['winter','winter']);
    return w4.length===2&&w4[1].k==='winter'&&/4 of 5 other top articles/.test(w4[1].why)&&w3.length===2&&two.length===1&&two2.length===1&&spl.length===1;})();
  o['season suggestion: a sibling answer that equals the date answer is not offered twice']=ss('2026-11-10','Top',['winter','winter','winter']).length===1;
  // ── progress, the queue, ignored articles ──
  o['live list: 8 articles (G1 is ignored for good and is not counted)']=live()===J(['B1','B2','J1','S1','T1','T2','X1','Z1']);
  const p0=prog();
  o['progress, nothing saved: 0 of 8 = 0%, 0 of 20 cubes, 8 without a type, 8 without a season']=p0.ok===true&&p0.total===8&&p0.done===0&&p0.pct===0&&p0.filled===0&&p0.noType===8&&p0.noSeason===8;
  o['progress: the bar markup is a progressbar at 0 with 20 cubes none filled, and the text reads 0%']=(()=>{const h=body();return/role="progressbar"/.test(h)&&/aria-valuenow="0"/.test(h)&&(h.match(/class="si-ts-cube/g)||[]).length===20&&!/si-ts-cube on/.test(h)&&/id="si-ts-pct">0%</.test(h)&&/0 of 8 live articles/.test(h);})();
  R('_siMeta.set("T1",_siMetaClean("T1",{type:"top",season:"summer"}));_siMeta.set("T2",_siMetaClean("T2",{type:"top",season:"winter"}));_siMeta.set("B1",_siMetaClean("B1",{type:"bottom"}));_siIgVer++;');
  const p1=prog();
  o['progress: 2 articles with BOTH (T1, T2), B1 has only a type -> 2 of 8 = 25%, 5 of 20 cubes, 5 without a type, 6 without a season']=p1.done===2&&p1.total===8&&p1.pct===25&&p1.filled===5&&p1.noType===5&&p1.noSeason===6;
  R('_siMeta.set("B2",_siMetaClean("B2",{type:"bottom",season:"summer"}));_siMeta.set("J1",_siMetaClean("J1",{type:"top",season:"summer"}));_siIgVer++;');
  R('_siMeta.set("S1",_siMetaClean("S1",{type:"top",season:"winter"}));_siIgVer++;');
  const p5=prog();
  o['progress rounds DOWN: 5 of 8 = 62.5% reads 62%, and 12 of 20 cubes (floor 12.5)']=p5.done===5&&p5.pct===62&&p5.filled===12;
  R('_siMeta.set("B1",_siMetaClean("B1",{type:"bottom",season:"winter"}));_siMeta.set("X1",_siMetaClean("X1",{type:"other",season:"winter"}));_siMeta.set("Z1",_siMetaClean("Z1",{type:"other",season:"summer"}));_siIgVer++;');
  const p8=prog();
  o['progress reaches 100% only when all 8 are done (7 of 8 reads 87%, never 100%)']=(()=>{R('_siMeta.set("Z1",_siMetaClean("Z1",{type:"other"}));_siIgVer++;');const p7=prog();R('_siMeta.set("Z1",_siMetaClean("Z1",{type:"other",season:"summer"}));_siIgVer++;');return p7.done===7&&p7.pct===87&&p8.done===8&&p8.pct===100&&p8.filled===20;})();
  o['progress follows the ignore list: ignoring an unfinished article would raise it; the ignored article never counts either way']=(()=>{R('_siMeta=new Map([["G1",_siMetaClean("G1",{ignoreForever:true})],["T1",_siMetaClean("T1",{type:"top",season:"summer"})],["T2",_siMetaClean("T2",{type:"top",season:"winter"})]]);_siIgVer++;');const a1=prog();R('_siMeta.set("B1",_siMetaClean("B1",{ignoreForever:true}));_siIgVer++;');const a2=prog();R('_siMeta.delete("B1");_siIgVer++;');return a1.total===8&&a1.pct===25&&a2.total===7&&a2.done===2&&a2.pct===28;})();
  o['next milestone: at 25% the next is 50% and 2 more articles (4 of 8 needed); at 100% there is none']=(()=>{const m=JSON.parse(R('J=JSON.stringify(_siTsNextMilestone(_siTsProgress(_siAxLive(),_siMeta,"ok")))'));return m.pct===50&&m.more===2&&R('_siTsNextMilestone({ok:true,total:8,done:8,pct:100})')===null&&R('_siTsNextMilestone({ok:false})')===null;})();
  o['queue: only articles missing something, most-sold first (units 10-i: B1 8, B2 7, S1 6, X1 5, Z1 4, J1 3), a done article is not in it']=(()=>{
    const q=JSON.parse(R('J=JSON.stringify(_siTsQueue(_siAxLive(),_siMeta,"all").map(a=>a.code))'));
    const qt=JSON.parse(R('J=JSON.stringify(_siTsQueue(_siAxLive(),_siMeta,"type").map(a=>a.code))')),qs=JSON.parse(R('J=JSON.stringify(_siTsQueue(_siAxLive(),_siMeta,"season").map(a=>a.code))'));
    return J(q)===J(['B1','B2','S1','X1','Z1','J1'])&&J(qt)===J(['B1','B2','S1','X1','Z1','J1'])&&J(qs)===J(['B1','B2','S1','X1','Z1','J1']);})();
  R('_siMeta=new Map([["G1",_siMetaClean("G1",{ignoreForever:true})],["T1",_siMetaClean("T1",{type:"top",season:"summer"})],["B1",_siMetaClean("B1",{type:"bottom"})],["B2",_siMetaClean("B2",{season:"summer"})]]);_siIgVer++;');
  o['queue filters: no season = everything but T1 and B2; no type = everything but T1 and B1; either = all but T1 (the filter chips carry the counts)']=(()=>{
    const f=k=>JSON.parse(R('J=JSON.stringify(_siTsQueue(_siAxLive(),_siMeta,'+J(k)+').map(a=>a.code))'));
    return f('all').length===7&&f('type').indexOf('B1')<0&&f('type').indexOf('B2')>=0&&f('season').indexOf('B2')<0&&f('season').indexOf('B1')>=0&&f('type').length===6&&f('season').length===6;})();
  // ── rendering is read-only ──
  o['rendering the tab, a row and the suggestions writes NOTHING (a suggestion is only a button)']=(()=>{const n=W.calls.length;R('_siSection="articles";_siSub="typeseason"');R('_siRenderSection(_siComputeMetrics(),[])');body();return W.calls.length===n&&W.acts.length===0;})();
  // Four-section model: Type & season is a sub-view of Articles (reached from the small bar under the tabs); its old id still deep-links to it.
  o['Type & season is a sub-view of Articles: in the Articles sub-bar, the old id resolves to it, and it renders']=(()=>{R('_siSection="articles";_siSub=""');const bar=R('_siTabBar()');const r=JSON.parse(R('JSON.stringify(_siSecResolve("typeseason"))'));R('_siSection="articles";_siSub="typeseason"');return />Type &amp; season</.test(bar)&&(bar.match(/class="gp-tab[ "]/g)||[]).length===4&&r.sec==='articles'&&r.sub==='typeseason'&&R('_siSecId("typeseason")')==='articles'&&/id="si-ts-body"/.test(R('_siRenderSection(_siComputeMetrics(),[])'));})();
  o['the Type & season sub-button is NOT on the Today sub-bar']=(()=>{R('_siSection="today";_siSub=""');return!/Type &amp; season/.test(R('_siTabBar()'));})();
  o['a row shows picture, code, the Shopify type as a hint, pressed state, suggestion buttons (type from the name, season from the date)']=(()=>{
    R('_siMeta=new Map([["G1",_siMetaClean("G1",{ignoreForever:true})]]);_siIgVer++;_siTsFilter="all";_siTsLimit=20;');
    const h=body();
    const row=(/<div class="si-ts-row" data-code="T1">[\s\S]*?(?=<div class="si-ts-row"|$)/.exec(h)||[''])[0];
    return/si-th/.test(row)&&/T1 · Shopify type: Tees/.test(row)&&/aria-pressed="false"/.test(row)&&/Use Top <span class="why">from its Shopify type &quot;Tees&quot;/.test(row)&&/Use Summer <span class="why">by its first date, 5 Jul 2026/.test(row);})();
  o['a row with a done type shows it pressed and offers no type suggestion']=(()=>{R('_siMeta.set("T1",_siMetaClean("T1",{type:"top"}));_siIgVer++;');const h=body();const row=(/<div class="si-ts-row" data-code="T1">[\s\S]*?(?=<div class="si-ts-row"|$)/.exec(h)||[''])[0];R('_siMeta.delete("T1");_siIgVer++;');return/data-f="type" data-k="top"[^>]*>Top</.test(row)&&/si-ts-opt on" aria-pressed="true"/.test(row)&&!/Use Top/.test(row);})();
  o['paging: 20 rows at a time with "Show more" when there are more']=(()=>{const h=body();return(h.match(/class="si-ts-row"/g)||[]).length===8&&!/Show \d+ more/.test(h);})();
  o['escaping: a hostile article name and Shopify type cannot break out of the row']=(()=>{R('_siProducts[0].product_title="<img src=x onerror=alert(1)>";_siProducts[0].product_type="\\"><b>";_siAxCache=null;_siIgVer++;');const h=body();R('_siProducts[0].product_title="Classic Tee";_siProducts[0].product_type="Tees";_siAxCache=null;_siIgVer++;');return!/<img src=x/.test(h)&&!/<b>"/.test(h)&&/&lt;img/.test(h);})();
  o['touch targets: option, suggestion and filter buttons use the 34px+ shared button class']=(()=>{const css=fs.readFileSync(path.join(ROOT,'css/main.css'),'utf8');return/\.si-ax-btn\{min-height:34px/.test(css)&&/si-ts-opt,\.si-ts-sug,\.si-ts-f\{min-height:40px\}/.test(css);})();
  // ── the writer: driven ──
  R('_siMeta=new Map([["G1",_siMetaClean("G1",{ignoreForever:true})]]);_siIgVer++;');
  o['_siMetaOf: nothing saved -> nulls; saved -> the values']=(()=>{const n=JSON.parse(R('J=JSON.stringify(_siMetaOf("T1"))'));R('_siMeta.set("T1",_siMetaClean("T1",{type:"top"}));');const m=JSON.parse(R('J=JSON.stringify(_siMetaOf("t1"))'));R('_siMeta.delete("T1");');return n.type===null&&n.season===null&&m.type==='top'&&m.season===null;})();
  const n0=W.calls.length;
  const pr=R('window._siTsSet("T1","type","top")');
  o['press: the list changes at once, before the write answers, and the bar moves live']=R('_siMetaOf("T1").type')==='top';
  await pr;
  const w=W.calls[n0]||{};
  o['write: one setDoc to inventory_article_meta/T1 with merge:true']=W.calls.length===n0+1&&w.ref&&w.ref.c==='inventory_article_meta'&&w.ref.id==='T1'&&w.opts&&w.opts.merge===true;
  o['write: only allowed fields, code = id, updatedBy = the username, type top, no season and no ignore fields sent']=(()=>{const k=Object.keys(w.data||{}),f=JSON.parse(R('J=JSON.stringify(_SI_META_FIELDS)'));return k.every(x=>f.includes(x))&&w.data.code==='T1'&&w.data.updatedBy==='afnan'&&w.data.type==='top'&&typeof w.data.updatedAt==='number'&&!('season' in w.data)&&!('ignoredUntil' in w.data)&&!('ignoreForever' in w.data);})();
  o['audit: logActivity "Article type set" with the code and the type']=W.acts.length===1&&W.acts[0][0]==='Article type set'&&/T1/.test(W.acts[0][1])&&/type top/.test(W.acts[0][1]);
  o['no success toast (the bar is the feedback)']=!a.state.toasts.some(t=>/Saved|Ignored/.test(String(t)));
  await R('window._siTsSet("T1","season","summer")');
  o['season write: its own merge write; the first press kept']=W.calls.length===n0+2&&W.calls[n0+1].data.season==='summer'&&!('type' in W.calls[n0+1].data)&&R('_siMetaOf("T1").type')==='top'&&W.acts[1][0]==='Article season set';
  o['the bar moves live in the rendered body: T1 is now done -> 1 of 8 = 12%, 2 of 20 cubes lit']=(()=>{const h=body();return/aria-valuenow="12"/.test(h)&&/id="si-ts-pct">12%</.test(h)&&(h.match(/si-ts-cube on/g)||[]).length===2&&!/data-code="T1"/.test(h.replace(/<div class="si-ts-bar[\s\S]*?<\/div>/,''))&&/1 of 8 live articles/.test(h);})();
  o['pressing the value an article already has clears it (writes null)']=await(async()=>{const n=W.calls.length;await R('window._siTsSet("T1","season","summer")');return W.calls.length===n+1&&W.calls[n].data.season===null&&R('_siMetaOf("T1").season')===null;})();
  o['a value that is not on the list, or a field that is not type/season, writes nothing']=await(async()=>{const n=W.calls.length;const r=await Promise.all([R('window._siTsSet("T1","type","hat")'),R('window._siTsSet("T1","ignoreForever","top")'),R('window._siTsSet("T1","season","monsoon")')]);return r.every(x=>x===false)&&W.calls.length===n;})();
  o['a code that is not a valid id is refused before any write']=await(async()=>{const n=W.calls.length;const r=await R('window._siTsSet("a/b","type","top")');return r===false&&W.calls.length===n;})();
  o['failed write: memory is put back, the bar goes back, and the toast says the type and season list was not saved']=await(async()=>{
    W.fail={code:'permission-denied'};const before=JSON.stringify(R('J=JSON.stringify(_siMetaOf("B1"))'));
    const p=R('window._siTsSet("B1","type","bottom")');const during=R('_siMetaOf("B1").type');const ok=await p;W.fail=null;
    return during==='bottom'&&ok===false&&R('_siMetaOf("B1").type')===null&&before===JSON.stringify(R('J=JSON.stringify(_siMetaOf("B1"))'))&&a.state.toasts.some(t=>/Could not save the type and season list — nothing was changed/.test(String(t))&&/firestore\.rules/.test(String(t)));})();
  o['a failed write that had a previous value restores THAT value']=await(async()=>{
    await R('window._siTsSet("B2","type","bottom")');W.fail={code:'unavailable'};const ok=await R('window._siTsSet("B2","type","other")');W.fail=null;return ok===false&&R('_siMetaOf("B2").type')==='bottom';})();
  o['saving a type keeps an existing ignore: the optimistic copy still hides the article']=await(async()=>{R('_siMeta.set("J1",_siMetaClean("J1",{ignoreForever:true}));_siIgVer++;');await R('window._siTsSet("J1","type","top")');const hid=!JSON.parse(R('J=JSON.stringify(_siAxLive().map(a=>a.code))')).includes('J1');R('_siMeta.delete("J1");_siIgVer++;');return hid;})();
  o['no signed-in username: nothing is written']=await(async()=>{const n=W.calls.length;R('window.__ou=_siIgUser;_siIgUser=function(){return ""}');const r=await R('window._siTsSet("T2","type","top")');R('_siIgUser=window.__ou;');return r===false&&W.calls.length===n;})();
  o['the write opts out of the blocking Saving overlay (held and released)']=await(async()=>{R('window.__s=0;window._gvSilentSaveStart=function(){window.__s++};window._gvSilentSaveStop=function(){window.__s--};');const pr2=R('window._siTsSet("T2","type","top")');const held=R('window.__s');await pr2;return held===1&&R('window.__s')===0;})();
  // ── a failed READ ──
  o['failed read: no percentage is shown (not 0%, not 100%), the bar is greyed, Retry is offered, no rows to save into']=(()=>{
    R('_siMetaState="error";');const h=body();const pr3=JSON.parse(R('J=JSON.stringify(_siTsProgress(_siAxLive(),_siMeta,"error"))'));R('_siMetaState="ok";');
    return pr3.ok===false&&pr3.pct===undefined&&/could not be read/.test(h)&&/_siMetaRetry/.test(h)&&/id="si-ts-pct">—</.test(h)&&!/\d+%/.test(h)&&!/si-ts-cube on/.test(h)&&!/class="si-ts-row"/.test(h);})();
  o['while the list is still being read, the section says so and shows no number']=(()=>{R('_siMetaState="loading";');const h=body();R('_siMetaState="ok";');return/Reading the saved types/.test(h)&&!/\d+%/.test(h);})();
  // ── rules text ──
  o['rules: the block is unchanged in its writes — signedIn(), updatedBy bound to the caller, no delete']=/allow create, update: if signedIn\(\)/.test(blk)&&/updatedBy == userEmail\(\)\.split\('@'\)\[0\]/.test(blk)&&/allow delete: if false;/.test(blk);
  o['sub-phase 3 now reads the saved values, only through _siMetaOf (the Explorer filter, the Portfolio rollups, Needs Attention): the readers exist']=(()=>{const rest=src.replace(/\/\/ ═══ Type & season\n[\s\S]*?window\._siTsSet=function[\s\S]*?\n};\n/,'');return /_siFdBucket\(code,field\)\{return _siMetaOf\(code\)\[field\]/.test(src)&&/_siMetaOf\(a&&a\.code\)\.season/.test(src)&&/metaOf:_siFeedOk\(\)\?_siMetaOf:null/.test(src)&&rest.length>0;})();
  return o;
}
module.exports=async function(){
  const s=suite('shopify-typeseason');
  const base=await checks(SRC);
  s.section('Type & season: vocab = rules, suggestions, the progress bar, the queue, the writer, a failed read (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing,rules)=>{
    const n=rules?RULES.split(from).length-1:SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=rules?await checks(SRC,RULES.split(from).join(to)):await checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f.slice(0,60)+'"',r[f]!==true);});
  };
  const K=k=>Object.keys(base).filter(x=>x.indexOf(k)===0);
  await brk('a fourth type sneaks in',"{k:'other',l:'Other'}]","{k:'other',l:'Other'},{k:'hat',l:'Hat'}]",K('vocab: the types'));
  await brk('a season is renamed',"{k:'all',l:'All-season'}]","{k:'year',l:'All-season'}]",K('vocab: the seasons'));
  await brk('short sleeve read as shorts',"replace(/short[\\s-]*sleeve[d]?/g,' ')","replace(/zzz/g,' ')",K('type suggestion: "Short Sleeve'));
  await brk('a set still gets a suggestion',"if(t&&!b)return{k:'top',why:src};if(b&&!t)return{k:'bottom',why:src};return null;","if(t)return{k:'top',why:src};if(b)return{k:'bottom',why:src};return null;",K('type suggestion: a top word AND'));
  await brk('name beats the Shopify type',"(category&&pick(category,'from its Shopify type \"'+String(category).slice(0,40)+'\"'))||(title&&pick(title,'from its name'))","(title&&pick(title,'from its name'))||(category&&pick(category,'from its Shopify type \"'+String(category).slice(0,40)+'\"'))",K('type suggestion: a Shopify type that decides'));
  await brk('winter runs to February',"return mo>=10||mo<=1;","return mo>=10||mo<=2;",K('season suggestion: winter is Oct'));
  await brk('winter starts in November',"return mo>=10||mo<=1;","return mo>=11||mo<=1;",K('season suggestion: winter is Oct'));
  await brk('siblings need only 2',"sib.length>=3","sib.length>=2",K('season suggestion: siblings need'));
  await brk('majority threshold 50%',"c[top]/sib.length>=0.6","c[top]/sib.length>=0.4",K('season suggestion: siblings need'));
  await brk('sibling suggestion repeated',"&&!out.some(s=>s.k===top)","",K('season suggestion: a sibling answer'));
  await brk('progress rounds to nearest',"pct:total?Math.floor(done*100/total):0","pct:total?Math.round(done*100/total):0",K('progress rounds DOWN').concat(K('progress reaches 100%')));
  await brk('progress counts a type alone as done',"if(t&&s)done++;","if(t||s)done++;",K('progress rounds DOWN'));
  await brk('progress counts ignored articles',"const live=_siAxLive(),p=_siTsProgress(live,_siMeta,_siMetaState);","const live=_siAxIndex().list,p=_siTsProgress(live,_siMeta,_siMetaState);",K('progress: the bar markup'));
  await brk('a failed read shows a number',"if(state!=='ok')return{ok:false,state};","if(state==='loading')return{ok:false,state};",K('failed read: no percentage'));
  await brk('cubes not floored',"filled:total?Math.floor(done*_SI_TS_CUBES/total):0","filled:total?Math.ceil(done*_SI_TS_CUBES/total):0",K('progress rounds DOWN'));
  await brk('queue sorted by code, not sales',"(y.units||0)-(x.units||0)||","",K('queue: only'));
  await brk('queue includes done articles',"filter==='type'?!t:filter==='season'?!s:(!t||!s)","filter==='type'?!t:filter==='season'?!s:true",K('queue: only').concat(K('queue filters')));
  await brk('suggestions are written on render',"const sugT=curT?null:_siTsSuggestType(a.category,a.title);","const sugT=curT?null:_siTsSuggestType(a.category,a.title);if(sugT&&!curT)window._siTsSet(a.code,'type',sugT.k);",K('rendering the tab'));
  await brk('no clear on a second press',"val=cur===k?null:k;","val=k;",K('pressing the value'));
  await brk('any value accepted',"if(!vocab||!vocab.some(v=>v.k===k))return Promise.resolve(false);","if(!vocab)return Promise.resolve(false);",K('a value that is not on the list'));
  await brk('any field accepted',"const vocab=field==='type'?_SI_TYPES:field==='season'?_SI_SEASONS:null;","const vocab=_SI_TYPES;",K('a value that is not on the list'));
  await brk('no rollback on a failed write','if(had)_siMeta.set(code,prev);else _siMeta.delete(code);','',K('failed write'));
  await brk('error text names the ignore list',"showToast('Could not save '+(what||'the ignore list')","showToast('Could not save the ignore list'+(what?'':'')",K('failed write: memory'));
  await brk('write replaces the doc (no merge)','doc0,{merge:true}','doc0',K('write: one setDoc'));
  await brk('write sends an unlisted field','const doc0=Object.assign({code,updatedAt:now,updatedBy:u},fields);','const doc0=Object.assign({code,updatedAt:now,updatedBy:u,note:"x"},fields);',K('write: only allowed'));
  await brk('success toast on every press',"return _siIgWrite(code,{[field]:val},null,","return _siIgWrite(code,{[field]:val},'Saved.',",K('no success toast'));
  await brk('no audit verb on a type',"field==='type'?'Article type set':'Article season set'","'Article changed'",K('audit: logActivity'));
  await brk('row name not escaped','<strong>${_siEsc(a.name)}</strong><div class="si-ax-note" style="margin:0">${_siEsc(a.code)}${hint}','<strong>${a.name}</strong><div class="si-ax-note" style="margin:0">${_siEsc(a.code)}${hint}',K('escaping: a hostile'));
  await brk('tab missing',"  {id:'typeseason',parent:'articles',label:'Type &amp; season',render:()=>_siTsSectionHtml()},\n","",K('Type & season is a sub-view'));
  await brk('rules: type enum widened',"request.resource.data.type in ['top','bottom','other']","request.resource.data.type is string",K('vocab: the types'),true);
  await brk('rules: delete allowed','allow delete: if false;\n    }\n    // ── Pattern Hub','allow delete: if signedIn();\n    }\n    // ── Pattern Hub',K('rules: the block is unchanged'),true);
  s.ok('breaks run: '+broken,broken>=30);
  return s;
};
module.exports._checks=checks;

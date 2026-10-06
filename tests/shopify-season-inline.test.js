/* Inventory Intel ▸ season and type set ON THE ARTICLE (single-article header and the Needs Attention situation header).
   Expectations are HAND-COMPUTED on the typeseason fixture (clock FAKE, today 2026-08-31 = a summer day):
     live articles (G1 is ignored for good): B1 B2 J1 S1 T1 T2 X1 Z1 + the odd-code article = 9, every one with sales.
     nothing saved: season buckets none 9, winter 0. Save winter on T1 -> winter 1, none 8. Clear it -> winter 0, none 9.
     Needs Attention season window: winter saved on T1 and today = 31 Aug -> outside the winter window (Oct-Jan) -> wait true, state "saved";
     cleared -> state "unknown". A saved summer on T1 -> inside the window -> wait false.
   The checks DRIVE the real handler (_siTsSet) and the real renderers; each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/shopify.js'),'utf8');
function load(src){
  const store={};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const ART=[['T1','Classic Tee','Tees','2026-07-05'],['T2','Hoodie Black','Hoodies','2026-11-10'],['B1','Cargo Pants','Pants','2027-01-20'],['B2','Denim Shorts','Shorts','2026-05-01'],
  ['S1','Short Sleeve Tee','','2026-10-01'],['X1','Hoodie and Joggers Set','Co-ord','2026-02-28'],['Z1','Mystery Item','','2026-03-01'],['J1','Bomber Jacket','Jackets','2026-09-30'],['G1','Ignored Tee','Tees','2026-06-01']];
function fixture(a,extra){
  const prods=[],items=[];
  ART.concat(extra||[]).forEach(([c,t,pt,day],i)=>{
    prods.push({_id:c+'-M',sku:c+'-M',product_title:t,color:'Blue',size:'M',product_type:pt,status:'active',published_at:''});
    items.push({sku:c+'-M',quantity:10-i,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
  });
  a.run('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siSnapshot=null;_siPrevSnapshot=null;_siAxCache=null;_siNaMemo=null;_siLoaded=true;_siHist=_siAxBuildHistory([]);_siHistState="ok";_siMetaState="ok";_siMeta=new Map([["G1",_siMetaClean("G1",{ignoreForever:true})]]);_siIgVer++;');
}
function stub(a){
  const W={calls:[],fail:null,toasts:[]};
  a.run('doc=function(d,c,id){return{c,id}};collection=function(d,n){return{n}};');
  a.ctx.setDoc=(ref,data,opts)=>{W.calls.push({ref,data:JSON.parse(JSON.stringify(data)),opts});return W.fail?Promise.reject(W.fail):Promise.resolve();};
  a.ctx.logActivity=()=>{};
  a.ctx.showToast=(m,e)=>{W.toasts.push([m,!!e]);};
  return W;
}
async function checks(src){
  const a=load(src),R=c=>a.run(c),o={};
  fixture(a,[['A/B&"<1>','Odd Code Tee','Tees','2026-07-06']]);
  const W=stub(a);
  R('_siNow=function(){return '+Date.parse('2026-08-31T12:00:00+05:00')+'};_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));};');
  const ctl=c=>R('_siSeasonCtlHtml('+J(c)+')');
  const counts=()=>JSON.parse(R('J=JSON.stringify(_siAxFCounts())'));
  const info=c=>JSON.parse(R('J=JSON.stringify((()=>{const a=_siAxIndex().map.get('+J(c)+');const r=_siNaSeasonInfo(a,"2026-08-31");return{state:r.state,season:r.season,wait:r.wait};})())'));
  const btn=(h,f,k)=>{const m=new RegExp('<button[^>]*data-f="'+f+'" data-k="'+k+'"[^>]*>').exec(h);return m?m[0]:'';};

  // ── the control on both headers ──
  const art=R('_siAxSel="T1";_siAxSearchBody()');
  o['article header: carries the season row (Winter, Summer, All-season) and the type row (Top, Bottom, Other) as pressed-state buttons']=
    ['winter','summer','all'].every(k=>/aria-pressed="false"/.test(btn(art,'season',k)))&&['top','bottom','other'].every(k=>/aria-pressed="false"/.test(btn(art,'type',k)))&&/>All-season</.test(art);
  const sit=R('(()=>{const a=_siAxIndex().map.get("T1");const r=_siNaRow(a);const x=_siNaMk(r,_siNaCtx(),"winner","watch",{at:240000,atKind:"x"});return _siNaDetailHtml(x,{order:[{code:x.code}]});})()');
  o['Needs Attention situation header: carries the same two rows']=/class="si-sc" data-code="T1"/.test(sit)&&['winter','summer','all'].every(k=>btn(sit,'season',k)!=='')&&['top','bottom','other'].every(k=>btn(sit,'type',k)!=='');
  o['vocab: the buttons are exactly the rules enums — winter, summer, all / top, bottom, other (no new values)']=(()=>{const h=ctl('T1');const ks=x=>(h.match(new RegExp('si-ts-opt[^>]*data-f="'+x+'" data-k="([a-z]+)"','g'))||[]).map(m=>/data-k="([a-z]+)"/.exec(m)[1]);return J(ks('season'))===J(['winter','summer','all'])&&J(ks('type'))===J(['top','bottom','other']);})();
  o['the buttons call the shared Type & season writer (_siTsSet), nothing new']=/onclick="window\._siTsSet\(this\.dataset\.code,this\.dataset\.f,this\.dataset\.k\)"/.test(ctl('T1'))&&!/_siSeasonSet/.test(src);
  o['rendering the control writes NOTHING (a suggestion is only a button)']=(()=>{const n=W.calls.length;ctl('T1');ctl('B1');R('_siAxSel="T1";_siAxSearchBody()');return W.calls.length===n;})();

  // ── suggestion hint when nothing saved ──
  o['nothing saved: T1 (first sale 5 Jul) gets a one-tap season suggestion "Use Summer" with its reason, and a type suggestion "Use Top"']=(()=>{const h=ctl('T1');return/data-f="season" data-k="summer"[^>]*>Use Summer <span class="why">by its first date/.test(h)&&/data-f="type" data-k="top"[^>]*>Use Top </.test(h);})();
  o['nothing saved: the suggested season option is dashed (sug) but NOT pressed']=(()=>{const b=btn(ctl('T1'),'season','summer');return/ sug/.test(b)&&/aria-pressed="false"/.test(b);})();
  o['nothing saved: no "saved by" line']=!/saved by/.test(ctl('T1'));
  o['an article with no basis (Z1 type unknown name) gets no type suggestion button']=!/class="si-ax-btn si-ts-sug"[^>]*data-f="type"/.test(ctl('Z1'));

  // ── set winter: write, filter counts, Needs Attention window ──
  const c0=counts(),i0=info('T1');
  o['before: season buckets none 9, winter 0; Needs Attention state for T1 is "unknown"']=c0.season.none===9&&c0.season.winter===0&&i0.state==='unknown';
  o['Portfolio rollup before: Winter 0, Unclassified 9']=(()=>{const m=Object.fromEntries(JSON.parse(R('J=JSON.stringify(_siAxPf().feed.seasons.map(x=>[x.k,x.n]))')));return m.winter===0&&m.none===9;})();
  const memo0=R('_siNaState()===_siNaState()&&(window.__m=_siNaState(),true)');
  const pr=R('window._siTsSet("T1","season","winter")');
  o['optimistic: memory holds winter BEFORE the write resolves']=R('_siMetaOf("T1").season')==='winter';
  await pr;
  const w=W.calls[W.calls.length-1];
  o['write: one merge setDoc of the allowed fields only (code, updatedAt, updatedBy, season)']=!!w&&w.opts&&w.opts.merge===true&&w.data.season==='winter'&&w.ref.id==='T1'&&Object.keys(w.data).sort().join()==='code,season,updatedAt,updatedBy';
  const c1=counts(),i1=info('T1');
  o['Explorer filter counts follow the save without a reload: winter 1, none 8']=c1.season.winter===1&&c1.season.none===8;
  o['Needs Attention: T1 is now "saved" winter and WAITS (31 Aug is outside the winter window)']=i1.state==='saved'&&i1.season==='winter'&&i1.wait===true;
  o['Needs Attention memo is rebuilt after the save (not the stale object)']=R('_siNaState()!==window.__m')&&memo0;
  o['Portfolio rollup (cached) follows the save: Winter 1 article, Unclassified 8']=(()=>{const f=JSON.parse(R('J=JSON.stringify(_siAxPf().feed.seasons.map(x=>[x.k,x.n]))'));const m=Object.fromEntries(f);return m.winter===1&&m.none===8;})();
  o['Explorer filter: Season = Winter now lists exactly T1']=(()=>{R('_siAxFSeason="winter"');const l=JSON.parse(R('J=JSON.stringify(_siAxFLive().map(a=>a.code))'));R('_siAxFSeason=""');return J(l)===J(['T1']);})();
  o['Type & season progress: T1 has a season only -> 0 of 9 live with both, 8 articles... no season missing count falls to 8']=(()=>{const p=JSON.parse(R('J=JSON.stringify(_siTsProgress(_siAxLive(),_siMeta,_siMetaState))'));return p.noSeason===8&&p.noType===9&&p.done===0;})();
  o['after the save the header shows it pressed and "saved by Afnan"']=(()=>{const h=ctl('T1');return/aria-pressed="true"/.test(btn(h,'season','winter'))&&/saved by Afnan, /.test(h);})();
  o['saved by: absent when the stored document holds no updatedBy']=(()=>{R('_siMeta.set("B1",_siMetaClean("B1",{season:"summer"}))');const h=ctl('B1');R('_siMeta.delete("B1")');return!/saved by/.test(h)&&/aria-pressed="true"/.test(btn(h,'season','summer'));})();
  // summer inside the window
  await R('window._siTsSet("T1","season","summer")');
  o['pressing another value replaces it: summer is in the window (wait false)']=info('T1').season==='summer'&&info('T1').wait===false;
  // ── clear ──
  await R('window._siTsSet("T1","season","summer")');
  const wc=W.calls[W.calls.length-1];
  o['pressing the saved value clears it: writes season:null, state "unknown", counts back to none 9']=wc.data.season===null&&info('T1').state==='unknown'&&counts().season.none===9&&counts().season.winter===0&&/aria-pressed="false"/.test(btn(ctl('T1'),'season','summer'));

  // ── a refused write rolls back and says so ──
  W.fail={code:'permission-denied',message:'denied'};const nT=W.toasts.length;
  const prF=R('window._siTsSet("T2","type","top")');
  const during=R('_siMetaOf("T2").type');
  const okF=await prF;W.fail=null;
  o['refused write: shown at once, then rolled back (type null), toast names the failure, returns false']=during==='top'&&okF===false&&R('_siMetaOf("T2").type')===null&&W.toasts.length===nT+1&&W.toasts[nT][1]===true&&/Could not save the type and season list/.test(W.toasts[nT][0])&&/firestore\.rules/.test(W.toasts[nT][0]);
  o['refused write: the button is back to not-pressed and the counts are unchanged']=/aria-pressed="false"/.test(btn(ctl('T2'),'type','top'))&&counts().type.none===9;

  // ── an unreadable / unloaded list ──
  R('_siMeta.set("T1",_siMetaClean("T1",{season:"winter",type:"top",updatedBy:"afnan",updatedAt:1}))');
  R('_siMetaState="error"');
  const bad=ctl('T1');
  o['unreadable list: every option is disabled, the text says "Type/season unavailable — … Retry", no value is pretended']=(()=>{const bs=bad.match(/<button[^>]*data-f=[^>]*>/g)||[];return bs.length===6&&bs.every(b=>/ disabled/.test(b)&&/aria-pressed="false"/.test(b))&&/Type\/season unavailable/.test(bad)&&/_siMetaRetry/.test(bad)&&!/si-ts-sug/.test(bad)&&!/saved by/.test(bad)&&!/aria-pressed="true"/.test(bad);})();
  R('_siMeta.delete("T1")');
  R('_siMetaState="loading"');
  o['list still loading: options disabled with a reading note, no suggestion']=(()=>{const h=ctl('T1');return/Reading the saved/.test(h)&&(h.match(/ disabled/g)||[]).length===6&&!/si-ts-sug/.test(h);})();
  R('_siMetaState="ok"');
  o['Needs Attention treats an unread list as unavailable (legacy window), never as a saved value']=(()=>{R('_siMetaState="error"');const s=info('T1').state;R('_siMetaState="ok"');return s==='unavailable';})();
  o['Needs Attention memo is keyed on the meta state too (an error -> ok flip rebuilds it)']=(()=>{R('_siMetaState="ok"');const m1=R('window.__a=_siNaState(),1');R('_siMetaState="error"');const x=R('_siNaState()!==window.__a');R('_siMetaState="ok"');return m1===1&&x;})();

  // ── a code with special characters travels in data-code, never in a handler string ──
  const odd='A/B&"<1>';
  const oh=ctl(odd);
  o['special code: carried in an escaped data-code attribute, never inside an onclick string']=(()=>{const bs=oh.match(/<button[^>]*data-f=[^>]*>/g)||[];return bs.length>=6&&bs.every(b=>/data-code="A\/B&amp;&quot;&lt;1&gt;"/.test(b)&&!/onclick="[^"]*A\/B/.test(b))&&!/<1>/.test(oh)&&/class="si-sc" data-code="A\/B&amp;&quot;&lt;1&gt;"/.test(oh);})();
  o['special code: the writer refuses a code that is not a valid document id with a toast and writes nothing']=await(async()=>{const n=W.calls.length,t=W.toasts.length;const r=await R('window._siTsSet('+J(odd)+',"season","winter")');return r===false&&W.calls.length===n&&W.toasts.length===t+1&&R('_siMeta.has('+J(odd)+')')===false;})();
  return o;
}

/* WHOLE-PAGE LIVE UPDATE. Fixture (today 2026-08-31, every sale on 2026-08-30 so it is inside the last 7 days; stock = on hand):
     W1 qty 5 hand 10 (no tag)   W2 qty 3 hand 20 (no tag)   S1 qty 2 hand 30 (tag season:summer)   U1 qty 1 hand 40 (tag season:winter)
   Top bar = Winter lets through winter + year-round: W1 W2 U1 -> units7 9, hand 70. Top bar = Summer: W1 W2 S1 -> units7 10, hand 60.
   Save summer on W2 -> Winter: W1 U1 -> 6 units, hand 50. Also save summer on U1 (beats its winter tag) -> Winter: W1 -> 5 units, hand 10; Summer: all four -> 11, hand 100.
   Clear W2 -> back to its tag (none = year-round): Winter: W1 W2 -> 8 units, hand 30. */
function loadWhole(src){
  const a=load(src),R=c=>a.run(c);
  const defs=[['W1',5,10,[]],['W2',3,20,[]],['S1',2,30,['season:summer']],['U1',1,40,['season:winter']]];
  const prods=[],items=[],snap={};
  defs.forEach(([c,q,h,tags])=>{prods.push({_id:'v'+c,sku:c+'-M',product_title:'Tee '+c,color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:'',price:1000,tags});
    items.push({sku:c+'-M',quantity:q,price:1000,order_created_at:'2026-08-30T12:00:00+05:00',financial_status:'paid'});
    snap['i'+c]={sku:c+'-M',variant_id:'v'+c,available:h};});
  R('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siSnapshot={date:"2026-08-31",snapshot_at:"2026-08-31T06:00:00+05:00",items:'+J(snap)+'};_siPrevSnapshot=null;_siAxCache=null;_siNaMemo=null;_siLoaded=true;_siHist=_siAxBuildHistory([]);_siHistState="ok";_siMetaState="ok";_siMeta=new Map();_siIgVer++;_siSeasonMapCache=null;');
  R('_siNow=function(){return '+Date.parse('2026-08-31T12:00:00+05:00')+'};_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));};');
  return a;
}
async function consumers(src){
  const a=loadWhole(src),R=c=>a.run(c),o={},W=stub(a);
  const top=(s)=>{R('_siSeason='+J(s));const m=JSON.parse(R('J=JSON.stringify(_siComputeMetrics())'));return[m.unitsSold7,m.totalOnHand];};
  const sku=(s)=>{R('_siSeason='+J(s));return JSON.parse(R('J=JSON.stringify(_siComputeSkuTable().map(r=>r.sku).sort())'));};
  const fc=()=>JSON.parse(R('J=JSON.stringify(_siAxFCounts().season)'));
  const pf=()=>Object.fromEntries(JSON.parse(R('J=JSON.stringify(_siAxPf().feed.seasons.map(x=>[x.k,x.n]))')));
  const na=c=>JSON.parse(R('J=JSON.stringify((()=>{const r=_siNaSeasonInfo(_siAxIndex().map.get('+J(c)+'),"2026-08-31");return{state:r.state,wait:r.wait};})())'));
  const prog=()=>JSON.parse(R('J=JSON.stringify(_siTsProgress(_siAxLive(),_siMeta,_siMetaState))'));
  o['top bar before any save (old tag rule only): Winter -> 9 units, hand 70; Summer -> 10, hand 60']=J(top('winter'))===J([9,70])&&J(top('summer'))===J([10,60]);
  o['SKU Table before: Winter lists W1 W2 U1; Summer lists W1 W2 S1']=J(sku('winter'))===J(['U1-M','W1-M','W2-M'])&&J(sku('summer'))===J(['S1-M','W1-M','W2-M']);
  o['every other consumer before: filter counts none 4, portfolio Unclassified 4, Needs Attention W2 "unknown", progress noSeason 4']=fc().none===4&&fc().summer===0&&pf().none===4&&na('W2').state==='unknown'&&prog().noSeason===4;
  R('window.__nm=_siNaState()');
  await R('window._siTsSet("W2","season","summer")');
  o['after saving summer on W2 — top bar Today metrics follow: Winter 6 units, hand 50 (W2 left the winter view)']=J(top('winter'))===J([6,50]);
  o['after the save — SKU Table: Winter lists W1 U1 only']=J(sku('winter'))===J(['U1-M','W1-M']);
  o['after the save — Explorer season filter counts: summer 1, none 3']=fc().summer===1&&fc().none===3;
  o['after the save — Portfolio rollup: summer 1, Unclassified 3']=pf().summer===1&&pf().none===3;
  o['after the save — Needs Attention: W2 is "saved" and, in August, in its summer window (wait false); the memo was rebuilt']=na('W2').state==='saved'&&na('W2').wait===false&&R('_siNaState()!==window.__nm');
  o['after the save — Type & season progress: noSeason 3 (done stays 0, no type saved)']=prog().noSeason===3&&prog().done===0;
  await R('window._siTsSet("U1","season","summer")');
  o['saving summer on U1 beats its Shopify winter tag: Winter 5 units, hand 10; Summer 11 units, hand 100']=J(top('winter'))===J([5,10])&&J(top('summer'))===J([11,100]);
  await R('window._siTsSet("W2","season","summer")');
  o['clearing W2 returns it to the old rule (year-round): Winter 8 units, hand 30, lists W1 W2']=J(top('winter'))===J([8,30])&&J(sku('winter'))===J(['W1-M','W2-M']);
  o['the top bar says what it reads: "a saved season wins; 3 of 4 articles have none saved … old tag rule", and names the tabs it applies to']=(()=>{const n=R('_siSeasonNote()');return/a saved season wins; 3 of 4 articles have none saved and use the old tag rule/.test(n)&&/Today and the SKU Table/.test(n);})();
  o['an unread saved list: the bar says so and only the old tag rule applies (Winter 9 units, hand 70 again)']=(()=>{R('_siMetaState="error"');R('_siIgVer++');const n=R('_siSeasonNote()'),t=top('winter');R('_siMetaState="ok"');R('_siIgVer++');return/saved seasons unavailable/.test(n)&&J(t)===J([9,70]);})();
  // repaint: only what is on screen, no new reads
  const els={},writes=[];
  const mk=id=>{const e={_id:id};['innerHTML','outerHTML'].forEach(k=>Object.defineProperty(e,k,{get(){return''},set(v){writes.push(id+'.'+k);}}));return e;};
  ['si-content','si-tab-bar','si-season-bar'].forEach(i=>els[i]=mk(i));
  a.ctx.document.getElementById=id=>els[id]||null;
  R('_siLoadAlive=function(){return true}');
  a.ctx.getDocs=()=>{throw new Error('read')};
  R('_siSection="skutable";_siSub=""');writes.length=0;R('_siIgRepaint()');
  o['repaint on the SKU Table: the content, the tab bar and the top Season bar are repainted, and nothing is read']=writes.indexOf('si-content.innerHTML')>=0&&writes.indexOf('si-tab-bar.outerHTML')>=0&&writes.indexOf('si-season-bar.outerHTML')>=0;
  R('_siSection="today"');writes.length=0;R('_siIgRepaint()');
  o['repaint on Today: the content and the Season bar too']=writes.indexOf('si-content.innerHTML')>=0&&writes.indexOf('si-season-bar.outerHTML')>=0;
  R('_siSection="attention";_siSub=""');writes.length=0;R('_siIgRepaint()');
  o['repaint on Needs Attention: the content (headline, reasons) and the tab pill are repainted']=writes.indexOf('si-content.innerHTML')>=0&&writes.indexOf('si-tab-bar.outerHTML')>=0;
  R('_siSection="articles";_siSub="";_siAxSel="W1"');writes.length=0;R('_siIgRepaint()');
  o['repaint on Articles keeps the open article and repaints the section']=writes.indexOf('si-content.innerHTML')>=0&&R('_siAxSel')==='W1';
  return o;
}
module.exports=async function(){
  const s=suite('shopify-season-inline');
  const base=await checks(SRC);
  s.section('Season and type on the article page and the situation page (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f.slice(0,60)+'"',r[f]!==true);});
  };
  const K=k=>Object.keys(base).filter(x=>x.indexOf(k)===0);
  await brk('article header loses the control',"${_siIgnored(a.code)?`<div style=\"flex-basis:100%\">${_siIgChipHtml(a.code)}</div>`:''}${_siSeasonCtlHtml(a.code)}","${_siIgnored(a.code)?`<div style=\"flex-basis:100%\">${_siIgChipHtml(a.code)}</div>`:''}",K('article header'));
  await brk('situation header loses the control',"</div></div></div>${_siSeasonCtlHtml(i.code)}</div>","</div></div></div></div>",K('Needs Attention situation header'));
  await brk('a new vocab value',"{k:'all',l:'All-season'}]","{k:'all',l:'All-season'},{k:'monsoon',l:'Monsoon'}]",K('vocab: the buttons'));
  await brk('own writer instead of the shared one',"onclick=\"window._siTsSet(this.dataset.code,this.dataset.f,this.dataset.k)\">${_siEsc(v.l)}</button>`;\n  const sug=","onclick=\"window._siSeasonSet(this.dataset.code,this.dataset.f,this.dataset.k)\">${_siEsc(v.l)}</button>`;\n  const sug=",K('the buttons call the shared'));
  await brk('suggestions saved on render',"sugS=curS?[]:_siTsSuggestSeason(_siAxLiveDay(a)||a.firstDay,typeLabel,sibs);\n    }","sugS=curS?[]:_siTsSuggestSeason(_siAxLiveDay(a)||a.firstDay,typeLabel,sibs);if(sugS[0])window._siTsSet(code,'season',sugS[0].k);\n    }",K('rendering the control writes').concat(K('nothing saved: T1')));
  await brk('no suggestion hint',"${sugS.slice(0,1).map(s=>sug('season',s,_SI_SEASONS)).join('')}","",K('nothing saved: T1 (first sale'));
  await brk('suggestion pre-pressed',"aria-pressed=\"${cur===v.k?'true':'false'}\" data-code=\"${c}\"","aria-pressed=\"${cur===v.k||(sug&&sug.k===v.k)?'true':'false'}\" data-code=\"${c}\"",K('nothing saved: the suggested season option'));
  await brk('saved by shown without data',"if(!m||!(m.type||m.season)||!m.updatedBy)return'';","if(!m||!(m.type||m.season))return'saved by someone';",K('saved by: absent'));
  await brk('saved by never shown',"return'saved by '+n+","return''+n+",K('after the save the header'));
  await brk('no rollback',"if(had)_siMeta.set(code,prev);else _siMeta.delete(code);","",K('refused write'));
  await brk('no repaint after a save so caches go stale',"_siMeta.set(code,next);_siIgVer++;_siIgRepaint();","_siMeta.set(code,next);_siIgRepaint();",K('Portfolio rollup (cached)').concat(K('Needs Attention memo is rebuilt')));
  await brk('no clear on second press',"val=cur===k?null:k;","val=k;",K('pressing the saved value clears'));
  await brk('buttons enabled when unreadable',"const ok=_siMetaState==='ok',off=ok?'':' disabled';","const ok=_siMetaState==='ok',off='';",K('unreadable list').concat(K('list still loading')));
  await brk('unreadable list hidden',"Type/season unavailable — the saved list could not be read. <button","Saved list could not be read. <button",K('unreadable list'));
  await brk('error state pretends saved values',"const m=ok?(_siMeta.get(code)||{}):{},","const m=(_siMeta.get(code)||{}),",K('unreadable list'));
  await brk('memo ignores the meta state',"+'|'+_siIgKey()+'|'+_siMetaState;","+'|'+_siIgKey();",K('Needs Attention memo is keyed'));
  await brk('code interpolated into the handler',"onclick=\"window._siTsSet(this.dataset.code,this.dataset.f,this.dataset.k)\">${_siEsc(v.l)}</button>`;\n  const sug=","onclick=\"window._siTsSet('${code}',this.dataset.f,this.dataset.k)\">${_siEsc(v.l)}</button>`;\n  const sug=",K('special code: carried'));
  await brk('code not escaped',"const c=_siEsc(code);\n  const opt=","const c=code;\n  const opt=",K('special code: carried'));
  await brk('the rollback toast loses its text',"showToast('Could not save '+(what||'the ignore list')","showToast('Oops'+(what?'':'')",K('refused write: shown'));
  s.section('whole-page live update: every consumer reflects a save (hand-computed)');
  const cb=await consumers(SRC);
  Object.keys(cb).forEach(k=>s.ok(k,cb[k]===true));
  const brk2=async(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await consumers(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f.slice(0,60)+'"',r[f]!==true);});
  };
  const K2=k=>Object.keys(cb).filter(x=>x.indexOf(k)===0);
  await brk2('saved season ignored by the top bar',"m[p.sku]=_siSavedSeasonOfSku(p.sku)||customSeasons[p.sku]","m[p.sku]=customSeasons[p.sku]",K2('after saving summer on W2').concat(K2('saving summer on U1')));
  await brk2('season map never rebuilt after a save',"_siSeasonMapCache&&_siSeasonMapVer===_siIgVer","_siSeasonMapCache",K2('after saving summer on W2'));
  await brk2('SKU Table row ignores the saved season',"season:_siSavedSeasonOfSku(sku)||_siGetCustomSeasons()[sku]","season:_siGetCustomSeasons()[sku]",K2('after the save — SKU'));
  await brk2('Today on-hand ignores the saved season',"(_siSeasonMap()[prod.sku]||_siSeasonOfTags(prod.tags))","_siSeasonOfTags(prod.tags)",K2('after saving summer on W2'));
  await brk2('saved list read even when unreadable',"if(_siMetaState!=='ok'||!sku)return null;","if(!sku)return null;",K2('an unread saved list'));
  await brk2('top bar caption stale',"const rule=c?'a saved season wins;","const rule=false?'a saved season wins;",K2('the top bar says'));
  await brk2('top bar not repainted after a save',"const sb=document.getElementById('si-season-bar');if(sb)sb.outerHTML=_siSeasonBar();","",K2('repaint on the SKU Table').concat(K2('repaint on Today')));
  await brk2('Needs Attention memo not rebuilt',"+'|'+_siIgKey()+'|'+_siMetaState;","+'|'+_siMetaState;",K2('after the save — Needs Attention'));
  await brk2('Portfolio memo not rebuilt',"+'|'+_siIgKey()+'|'+_siAxFSig()+'|'+_siMetaState;","+'|'+_siAxFSig()+'|'+_siMetaState;",K2('after the save — Portfolio'));
  await brk2('no repaint and no invalidation after a save',"_siMeta.set(code,next);_siIgVer++;_siIgRepaint();","_siMeta.set(code,next);",K2('after saving summer on W2').concat(K2('after the save — Needs Attention'),K2('after the save — Portfolio')));
  await brk2('no repaint on Needs Attention',"if(_siSection==='attention'&&typeof window._siNaRepaint==='function')window._siNaRepaint();","",K2('repaint on Needs Attention'));
  s.ok('breaks run: '+broken,broken>=28);
  return s;
};
module.exports._checks=checks;

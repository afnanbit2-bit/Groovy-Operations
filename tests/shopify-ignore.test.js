/* Inventory Intel ▸ Ignore (sub-phase 1 of the product-data work): ONE shared list, inventory_article_meta/{CODE}. Every expectation is
   HAND-COMPUTED on the Needs Attention fixture (today 2026-08-31; 20 articles with sales or stock; critical 11, act 5, watch 2, action 16,
   total 18; R10 sells 13 a day for 92 days = 1,196 units), the clock is a FAKE clock, and the checks DRIVE the real handlers
   (_siIgApply / _siIgRestore / _siMetaLoad / the tab switch), never only the helpers. Each "break" mutates the source (or the rules text)
   and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/shopify.js'),'utf8');
const RULES=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8').replace(/\r/g,'');
function load(src,store){
  store=store||{};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
/* FIXTURE (today 2026-08-31; first synced order 06-01 from filler GF; every article is a Tee, default lead time 21 days; price 1000;
   stock history Aug 1..31 so 30 measured days; classes use the fixed bands because fewer than 30 articles are classed):
   R1..R10 sell 3+k a day (d = 4..13) with 28 on hand, in stock every day -> cover = 28/d days (7 .. 2.15), all under half of 21 -> CRITICAL run-outs;
        units lost in the gap = d*(21-28/d) = 21d-28 (56 .. 245), so Rs at stake = that x 1000 and R10 ranks first.
   A1 sells 4 a day with 60 on hand -> cover 15 days: under 21 but not under 10.5 -> ACT THIS WEEK, lost 4*(21-15)=24.
   O1 sells 4 a day to Aug 20, stock 0 from Aug 21 -> out 10 of 30 measured days, 76 units over 20 in-stock days = 3.8 a day, class constrained -> CRITICAL stock-out,
        turned away so far round(3.8*10)=38, lost over one lead time 3.8*21=79.8, reorder guide 3.8*0.75*49=139.65 -> 144 .. 3.8*1.25*49=232.75 -> 240.
   V1 sells 1 every other day, 400 on hand -> 400,000 at selling price, cover far above 26 weeks -> OVERSTOCK, act (value over 500k? no, 400k, but cover over 52 weeks).
   D1 / D2 sold 10 units on 06-10 and nothing since, 40 / 200 on hand -> DEAD: 40,000 (watch, under 100k) and 200,000 (act).
   F1 sells 6 a day Jul 7..Aug 3 then 2 a day: 168 then 56 units, z=(112-1)/sqrt(224)=7.4 -> FADING, -66.7%, in stock every day -> act (under -40%).
   T1 sells 1 a day and has 12 voided units: 12/(92+12)=11.5% -> data check, watch.
   H sells S 2/day, M 1/day, L 1/day (4 a day); S has 0 on hand, M and L 100 each -> cover 50 days: S carries 56 of 112 units in 28 days (50%) -> SIZE HOLE, act, lost 56.
   N1 first sold 08-20 (3 units), 500 on hand, no publish date -> only 12 counted days: Too early, never dead or overstocked.
   Counts: critical 11 (R1-R10, O1), act 5 (A1, V1, D2, F1, H), watch 2 (D1, T1); stock 13, cash 3, demand 1, data 1. */
function fixture(a){
  const R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));}');
  const dn=R('_siAxDayNum("2026-06-01")'),last=R('_siAxDayNum("2026-08-31")'),ds=n=>R('_siAxDayStr('+n+')');
  const days=[],D={};for(let n=dn;n<=last;n++){days.push(n);D[n]=ds(n);}
  const items=[],prods=[],defs=[];
  const li=(sku,q,day,st)=>({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:st||'paid'});
  const prod=(c,size,pub)=>({_id:c+'-'+size,sku:c+'-'+size,product_title:'Art '+c,color:'Blue',size,product_type:'Tees',status:'active',published_at:pub===''?'':'2025-01-01T10:00:00+05:00'});
  const art=(c,o)=>{
    const sizes=o.sizes||{M:1};
    Object.keys(sizes).forEach(sz=>{prods.push(prod(c,sz));
      days.forEach(n=>{const q=o.daily(n,sz);if(q>0)items.push(li(c+'-'+sz,q,D[n]));});
      defs.push([c,sz,o.stock]);});
  };
  prods.push(prod('GF','M'));items.push(li('GF-M',10,'2026-06-01'));
  for(let k=1;k<=10;k++)art('R'+k,{daily:()=>3+k,stock:()=>28});
  art('A1',{daily:()=>4,stock:()=>60});
  const aug20=R('_siAxDayNum("2026-08-20")'),aug21=R('_siAxDayNum("2026-08-21")');
  art('O1',{daily:n=>n<=aug20?4:0,stock:n=>n<aug21?50:0});
  art('V1',{daily:n=>n%2===0?1:0,stock:()=>400});
  const jun10=R('_siAxDayNum("2026-06-10")');
  art('D1',{daily:n=>n===jun10?10:0,stock:()=>40});
  art('D2',{daily:n=>n===jun10?10:0,stock:()=>200});
  const jul7=R('_siAxDayNum("2026-07-07")'),aug4=R('_siAxDayNum("2026-08-04")');
  art('F1',{daily:n=>n<jul7?0:(n<aug4?6:2),stock:()=>300});
  art('T1',{daily:()=>1,stock:()=>100});items.push(li('T1-M',12,'2026-07-01','voided'));
  art('H',{sizes:{S:1,M:1,L:1},daily:(n,sz)=>sz==='S'?2:1,stock:(n,sz)=>sz==='S'?0:100});
  prods.push(prod('N1','M',''));items.push(li('N1-M',3,'2026-08-20'));defs.push(['N1','M',()=>500]);
  const base=R('_siAxDayNum("2026-08-01")'),snaps=[];
  for(let k=0;k<31;k++){const n=base+k,it={};let i=0;defs.forEach(([c,sz,fn])=>{it['i'+(i++)]={sku:c+'-'+sz,available:fn(n,sz)};});snaps.push({date:ds(n),items:it});}
  R('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siHist=_siAxBuildHistory('+J(snaps)+');_siHistState="ok";_siSnapshot='+J(snaps[30])+';_siPrevSnapshot='+J(snaps[23])+';_siAxCache=null;_siNaMemo=null;_siLoaded=true');
  return snaps;
}
function ruleBlock(rules){
  const k=rules.indexOf('match /inventory_article_meta/{code}');
  if(k<0)return'';
  let d=0,e=rules.indexOf('{',k+'match /inventory_article_meta/{code}'.length);const st=e;
  for(;e<rules.length;e++){if(rules[e]==='{')d++;else if(rules[e]==='}'){d--;if(!d)break;}}
  return rules.slice(st,e+1);
}
function stub(a){ // writes are recorded; each one can be made to fail
  const W={calls:[],fail:null,acts:[]};
  a.run('doc=function(d,c,id){return{c,id}};collection=function(d,n){return{n}};');
  a.ctx.setDoc=(ref,data,opts)=>{W.calls.push({ref,data:JSON.parse(JSON.stringify(data)),opts});return W.fail?Promise.reject(W.fail):Promise.resolve();};
  a.ctx.logActivity=(x,y)=>{W.acts.push([x,y]);};
  return W;
}
function SRC_LINES(s){return s.split('\n');}
async function checks(src,rules){
  rules=rules==null?RULES:rules;
  const a=load(src,{}),R=c=>a.run(c),o={};
  fixture(a);
  const W=stub(a);
  R('_siNow=function(){return window.__t};window.__t='+Date.parse('2026-08-31T12:00:00+05:00')+';');
  const ST=()=>R('J=JSON.stringify(_siNaState().counts)');
  const C0=JSON.parse(ST());
  const live=()=>R('_siAxLive().length'),codes=()=>R('J=JSON.stringify(_siNaState().issues.map(i=>i.code))');
  o['baseline: critical 11, act 5, watch 2, action 16, total 18; 20 articles with sales or stock']=C0.critical===11&&C0.act===5&&C0.watch===2&&C0.action===16&&C0.total===18&&live()===20;
  const until=(t,k)=>R('_siIgUntil('+J(t)+','+J(k)+')');
  o['periods from 2026-08-31: 1 week 09-07, 2 weeks 09-14, 1 month 09-30 (clamped), 3 months 11-30, 6 months 2027-02-28']=until('2026-08-31','1w')==='2026-09-07'&&until('2026-08-31','2w')==='2026-09-14'&&until('2026-08-31','1m')==='2026-09-30'&&until('2026-08-31','3m')==='2026-11-30'&&until('2026-08-31','6m')==='2027-02-28';
  o['month-end: 31 Jan + 1 month = 28 Feb (2026); 31 Aug 2023 + 6 months = 29 Feb 2024 (leap); 15 Dec + 3 months = 15 Mar next year; 30 Nov + 1 week = 7 Dec']=until('2026-01-31','1m')==='2026-02-28'&&until('2023-08-31','6m')==='2024-02-29'&&until('2026-12-15','3m')==='2027-03-15'&&until('2026-11-30','1w')==='2026-12-07';
  o['an unknown period or a malformed day gives nothing (never a guessed date)']=until('2026-08-31','2y')===null&&until('nope','1w')===null;
  o['the day an ignore returns is the day after its last ignored day (Dec 31 -> Jan 1, Feb 28 -> Mar 1)']=R('_siIgNextDay("2026-12-31")')==='2027-01-01'&&R('_siIgNextDay("2026-02-28")')==='2026-03-01';
  o['choices write what they say: never = forever and no date; restore clears all four ignore fields; a period gives the last day']=(()=>{
    const n=JSON.parse(R('J=JSON.stringify(_siIgFields("never","2026-08-31","afnan",5))')),r=JSON.parse(R('J=JSON.stringify(_siIgFields("restore"))')),p=JSON.parse(R('J=JSON.stringify(_siIgFields("1w","2026-08-31","afnan",5))'));
    return n.ignoreForever===true&&n.ignoredUntil===null&&r.ignoreForever===false&&r.ignoredUntil===null&&r.ignoredAt===null&&r.ignoredBy===null&&p.ignoredUntil==='2026-09-07'&&p.ignoreForever===false&&R('_siIgFields("9y","2026-08-31","a",1)')===null;})();
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum(_siPktDayOf(window.__t))+(off||0));};');
  R('_siMeta=new Map([["R10",{code:"R10",ignoredUntil:"2026-09-07",ignoreForever:false}]]);_siIgVer++;');
  const at=s=>R('window.__t='+Date.parse(s)+';_siIgnored("R10")');
  o['PKT end of day: still ignored at 23:59:59.999 on the last day, back at 00:00:00.000 the next (client clock)']=at('2026-09-07T23:59:59.999+05:00')===true&&at('2026-09-08T00:00:00.000+05:00')===false;
  o['PKT end of day: 2026-09-07T18:59:59.999Z is the last ignored millisecond (it is 23:59:59.999 in Karachi)']=at('2026-09-07T18:59:59.999Z')===true&&at('2026-09-07T19:00:00.000Z')===false;
  R('window.__t='+Date.parse('2026-09-02T10:00:00+05:00')+';');
  o['expiry reappearance: ignored on 09-02 the article is out of the lists; after its last day it is back with nothing written']=(()=>{
    const during=live()===19&&!JSON.parse(codes()).includes('R10')&&JSON.parse(R('J=JSON.stringify(_siAxLive().map(a=>a.code))')).indexOf('R10')<0;
    const n0=W.calls.length;
    R('window.__t='+Date.parse('2026-09-08T00:00:01+05:00')+';');
    return during&&live()===20&&R('_siAxLive().some(a=>a.code==="R10")')===true&&W.calls.length===n0;})();
  o['forever stays ignored ten years on']=(()=>{R('_siMeta=new Map([["R10",{code:"R10",ignoreForever:true,ignoredUntil:null}]]);_siIgVer++;window.__t='+Date.parse('2036-09-08T00:00:01+05:00')+';');const v=R('_siIgnored("R10")')===true;R('_siMeta=new Map();_siIgVer++;window.__t='+Date.parse('2026-08-31T12:00:00+05:00')+';');return v;})();
  o['a stored document is read field by field: junk dates, wrong types and unknown enums are dropped (nothing hides on a bad value)']=(()=>{
    const m=JSON.parse(R('J=JSON.stringify(_siMetaClean("R10",{ignoredUntil:"tomorrow",ignoreForever:"yes",ignoredAt:"x",type:"hat",season:"monsoon",ignoredBy:5}))'));
    return m.ignoredUntil===null&&m.ignoreForever===false&&m.ignoredAt===null&&m.type===null&&m.season===null&&m.ignoredBy===null&&R('(()=>{_siMeta=new Map([["R10",_siMetaClean("R10",{ignoredUntil:"junk"})]]);const v=_siIgnored("R10");_siMeta=new Map();return v;})()')===false;})();
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-08-31")+(off||0));};window.__t='+Date.parse('2026-08-31T12:00:00+05:00')+';_siMeta=new Map();_siIgVer++;');
  const p=R('window._siIgApply("R10","1w")');
  o['optimistic: the list changes at once, before the write answers']=R('_siIgnored("R10")')===true&&live()===19;
  await p;
  const w=W.calls[0]||{};
  o['write: one setDoc to inventory_article_meta/R10 with merge:true']=W.calls.length===1&&w.ref&&w.ref.c==='inventory_article_meta'&&w.ref.id==='R10'&&w.opts&&w.opts.merge===true;
  o['write: only allowed fields, code = id, updatedBy = the username, ignoredUntil 2026-09-07, not forever']=(()=>{const k=Object.keys(w.data||{}),f=JSON.parse(R('J=JSON.stringify(_SI_META_FIELDS)'));return k.every(x=>f.includes(x))&&w.data.code==='R10'&&w.data.updatedBy==='afnan'&&w.data.ignoredBy==='afnan'&&w.data.ignoredUntil==='2026-09-07'&&w.data.ignoreForever===false&&typeof w.data.ignoredAt==='number'&&typeof w.data.updatedAt==='number'&&!('type' in w.data)&&!('season' in w.data);})();
  o['audit: logActivity "Article ignored" with the code and date']=W.acts.length===1&&W.acts[0][0]==='Article ignored'&&/R10/.test(W.acts[0][1])&&/2026-09-07/.test(W.acts[0][1]);
  o['toast says when it comes back']=a.state.toasts.some(t=>/Ignored until/.test(t)&&/Sep/.test(t));
  const C1=JSON.parse(ST());
  o['Needs Attention counts: R10 (critical) gone -> critical 10, action 15, total 17; the pill reads 15']=C1.critical===10&&C1.action===15&&C1.total===17&&R('_siNaBadge()')===15&&/Needs Attention<span class="si-na-pill"[^>]*>15</.test(R('_siTabBar()'));
  o['Needs Attention list and chips: no R10 issue, the ranked list starts at R9, the reason counts follow']=(()=>{const c=JSON.parse(codes());return!c.includes('R10')&&c.includes('R9')&&R('_siNaState().counts.byGroup.stock')===12;})();
  o['Needs Attention rows read the live set: the situation of R10 cannot be found from the list (_siNaFind)']=!R('_siNaFind("R10")');
  o['Overview tiles read the same counts (16 -> 15 need action)']=/<div class="num">15<\/div>/.test(R('_siOverviewAttnTiles()'));
  o['Explorer Overview rows: 19 (R10 gone), the others untouched']=(()=>{const c=JSON.parse(R('J=JSON.stringify(_siAxOvRows().map(r=>r.a.code))'));return c.length===19&&!c.includes('R10')&&c.includes('R9');})();
  o['Explorer Overview situation lists: R10 is in none of them']=['reorder','risk','stuck','winner'].every(k=>!R('_siAxOvRows().filter(r=>_siAxOvIn(r,'+J(k)+')).some(r=>r.a.code==="R10")'));
  o['Portfolio: 19 articles and 1,196 fewer units (R10 sells 13 a day for 92 days)']=(()=>{
    const after=JSON.parse(R('J=JSON.stringify({a:_siAxPf().tot.articles,u:_siAxPf().tot.units})'));
    R('_siMeta=new Map();_siIgVer++;');const bef=JSON.parse(R('J=JSON.stringify({a:_siAxPf().tot.articles,u:_siAxPf().tot.units})'));
    R('_siMeta=new Map([["R10",_siMetaClean("R10",{ignoreForever:true})]]);_siIgVer++;');
    return after.a===19&&bef.a===20&&bef.u-after.u===1196&&R('_siAxIndex().map.get("R10").units')===1196;})();
  o['Class counts (the scorecard line) follow: 19 classed articles, not 20']=R('Object.keys(_siAxClassCounts()).reduce((t,k)=>t+_siAxClassCounts()[k],0)')===19;
  o['Explorer header counts them: "20 articles (1 ignored)"']=/20 articles \(1 ignored\)/.test(R('_siArticleExplorerSection()'));
  o['classification of the OTHER articles is unchanged (the demand pool is not shifted by what somebody ignored)']=(()=>{const a1=R('_siAxClassify(_siAxIndex().map.get("A1")).cls'),r9=R('_siAxClassify(_siAxIndex().map.get("R9")).cls');R('_siMeta=new Map();_siIgVer++;');const a1b=R('_siAxClassify(_siAxIndex().map.get("A1")).cls'),r9b=R('_siAxClassify(_siAxIndex().map.get("R9")).cls');R('_siMeta=new Map([["R10",_siMetaClean("R10",{ignoreForever:true})]]);_siIgVer++;');return a1===a1b&&r9===r9b;})();
  const hits=R('J=JSON.stringify(_siAxSearch("R10",12).hits.map(h=>h.code))');
  o['Search still FINDS the ignored article, and the result row carries an "Ignored for good" chip']=JSON.parse(hits).includes('R10')&&/Ignored for good/.test(R('(()=>{_siAxModeSel="search";_siAxQuery="R10";return _siAxResultsHtml();})()'));
  o['Search result chip for a dated ignore reads "Ignored until <date>"']=(()=>{R('_siMeta=new Map([["R10",_siMetaClean("R10",{ignoredUntil:"2026-09-07"})]]);_siIgVer++;');const h=R('(()=>{_siAxModeSel="search";_siAxQuery="R10";return _siAxResultsHtml();})()');R('_siMeta=new Map([["R10",_siMetaClean("R10",{ignoreForever:true})]]);_siIgVer++;');return/Ignored until [^<]*Sep/.test(h);})();
  o['Compare can still add an ignored article']=R('_siAxCmp=[];_siAxTryAdd("R10").ok')===true;
  o['the article page offers Restore (not Ignore) for an ignored article, and Ignore for the others']=(()=>{R('_siAxSel="R10";_siAxModeSel="search"');const h=R('_siAxSearchBody()');R('_siAxSel="R9"');const h2=R('_siAxSearchBody()');R('_siAxSel="";');return/_siIgRestore/.test(h)&&/Ignored for good/.test(h)&&/_siIgOpen/.test(h2)&&!/_siIgRestore/.test(h2);})();
  o['tab bar: seven tabs with "Ignored" and its count (1) before Advanced']=(()=>{const b=R('_siTabBar()');return(b.match(/class="gp-tab[ "]/g)||[]).length===7&&/Ignored<span class="si-ig-n"[^>]*>1</.test(b)&&b.indexOf('Ignored')<b.indexOf('Advanced');})();
  R('_siMetaState="ok";');
  o['Ignored tab: lists R10 with its picture tile, code, class chip, return date 8 Sep and "by afnan"; Restore button']=(()=>{
    R('_siMeta=new Map([["R10",_siMetaClean("R10",{ignoredUntil:"2026-09-07",ignoredAt:'+Date.parse('2026-08-31T12:00:00+05:00')+',ignoredBy:"afnan"})]]);_siIgVer++;');
    const h=R('_siIgnoredSectionHtml()');return/Art R10/.test(h)&&/R10/.test(h)&&/si-ig-cls/.test(h)&&/8 Sep/.test(h)&&/by afnan/.test(h)&&/_siIgRestore/.test(h)&&/si-th/.test(h);})();
  o['Ignored tab: "never" shows as never, and "never" sorts after dated ones, soonest first']=(()=>{
    R('_siMeta=new Map([["R10",_siMetaClean("R10",{ignoreForever:true})],["R9",_siMetaClean("R9",{ignoredUntil:"2026-12-01"})],["R8",_siMetaClean("R8",{ignoredUntil:"2026-09-10"})]]);_siIgVer++;');
    const order=JSON.parse(R('J=JSON.stringify(_siIgList().map(e=>e.code))')),h=R('_siIgnoredSectionHtml()');
    R('_siMeta=new Map([["R10",_siMetaClean("R10",{ignoredUntil:"2026-09-07",ignoredAt:1,ignoredBy:"afnan"})]]);_siIgVer++;');
    return order.join()==='R8,R9,R10'&&/never/.test(h);})();
  o['Ignored tab: the empty state, and a loading state while the read is in flight']=(()=>{R('_siMeta=new Map();_siIgVer++;');const e=R('_siIgnoredSectionHtml()');R('_siMetaState="loading"');const l=R('_siIgnoredSectionHtml()');R('_siMetaState="ok"');return/Nothing is ignored/.test(e)&&/Reading the ignore list/.test(l);})();
  R('_siMeta=new Map([["R10",_siMetaClean("R10",{ignoredUntil:"2026-09-07",ignoredAt:1,ignoredBy:"afnan"})]]);_siIgVer++;');
  o['the tab switch paints the Ignored section']=(()=>{R('window._siSwitchTab("ignored")');const h=R('document.getElementById("si-content").innerHTML');R('_siSection="overview"');return/Ignored — 1 article/.test(h);})();
  const nW=W.calls.length;
  await R('window._siIgRestore("R10")');
  const rw=W.calls[nW]||{};
  o['restore: a merge write that clears the four ignore fields (no delete), the article is back in the lists and counts']=!!rw.opts&&rw.opts.merge===true&&rw.data.ignoredUntil===null&&rw.data.ignoreForever===false&&rw.data.ignoredAt===null&&rw.data.ignoredBy===null&&!R('_siIgnored("R10")')&&live()===20&&JSON.parse(ST()).total===18;
  o['restore is audited as "Article restored"']=W.acts[W.acts.length-1][0]==='Article restored';
  W.fail=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
  const tN=a.state.toasts.length;
  const pf=R('window._siIgApply("R10","1m")');
  const during=R('_siIgnored("R10")');
  const ok=await pf;
  o['failed write: rolled back (the article is visible again), a toast says nothing was changed and names the rules, no audit row']=during===true&&ok===false&&!R('_siIgnored("R10")')&&live()===20&&a.state.toasts.slice(tN).some(t=>/nothing was changed/.test(t)&&/firestore\.rules/.test(t))&&W.acts[W.acts.length-1][0]==='Article restored';
  o['failed write over an existing ignore puts the previous ignore back (not a blank)']=await(async()=>{
    W.fail=null;await R('window._siIgApply("R10","1w")');W.fail=new Error('boom');
    const ok2=await R('window._siIgApply("R10","never")');
    const m=JSON.parse(R('J=JSON.stringify(_siMeta.get("R10"))'));W.fail=null;
    return ok2===false&&m.ignoredUntil==='2026-09-07'&&m.ignoreForever===false;})();
  await R('window._siIgRestore("R10")');
  o['offline: the write is queued and the toast says "Saved on this device — will sync" (no rollback)']=await(async()=>{
    R('navigator.onLine=false');const t0=a.state.toasts.length;await R('window._siIgApply("R10","2w")');R('navigator.onLine=true');
    const ok3=a.state.toasts.slice(t0).some(t=>/Saved on this device/.test(t))&&R('_siIgnored("R10")')===true;await R('window._siIgRestore("R10")');return ok3;})();
  o['a code the rules would refuse is refused up front (and nothing is written)']=await(async()=>{const n=W.calls.length;const r1=await R('window._siIgApply("a b","1w")');const r2=await R('window._siIgApply("","1w")');return W.calls.length===n&&r1===false&&r2===false;})();
  o['no signed-in username: nothing is written']=await(async()=>{const n=W.calls.length;R('window.__ou=_siIgUser;_siIgUser=function(){return ""}');const r1=await R('window._siIgApply("R10","1w")');R('_siIgUser=window.__ou;');return r1===false&&W.calls.length===n;})();
  o['the write opts out of the blocking Saving overlay (silent-save pair held and released)']=await(async()=>{R('window.__s=0;window._gvSilentSaveStart=function(){window.__s++};window._gvSilentSaveStop=function(){window.__s--};');const pr=R('window._siIgApply("R10","1w")');const held=R('window.__s');await pr;const rel=R('window.__s');await R('window._siIgRestore("R10")');return held===1&&rel===0;})();
  const dh=R('_siIgDlgHtml("R10","<img src=x onerror=alert(1)>")');
  o['dialog: ONE question "Remind me in…" with exactly 1 week, 2 weeks, 1 month, 3 months, 6 months (1 month preselected) and a "Never remind me" tick; no reason field']=(()=>{const v=(dh.match(/type="radio" name="si-ig-p" value="([^"]+)"/g)||[]).map(x=>/value="([^"]+)"/.exec(x)[1]);return v.join()==='1w,2w,1m,3m,6m'&&/value="1m" checked/.test(dh)&&/Remind me in…/.test(dh)&&/Never remind me/.test(dh)&&['1 week','2 weeks','1 month','3 months','6 months'].every(t=>dh.includes('<span>'+t+'</span>'))&&!/<textarea|type="text"|<select|reason/i.test(dh);})();
  o['dialog: a hostile article name is escaped in the title, and the code in the button']=!/<img/i.test(dh)&&/&lt;img/.test(dh)&&/data-code="R10"/.test(dh);
  o['dialog: Ignore with the default writes one month (30 Sep), with "Never remind me" ticked writes forever, with nothing else asked']=await(async()=>{
    const n=W.calls.length;await R('window._siIgGo("R10")');const d1=W.calls[n].data;await R('window._siIgRestore("R10")');
    R('document.getElementById("si-ig-never").checked=true');await R('window._siIgGo("R10")');const d2=W.calls[n+2].data;await R('window._siIgRestore("R10")');
    R('document.getElementById("si-ig-never").checked=false');
    return d1.ignoredUntil==='2026-09-30'&&d1.ignoreForever===false&&d2.ignoreForever===true&&d2.ignoredUntil===null;})();
  // the read
  const B=load(src,{}),BR=c=>B.run(c);fixture(B);
  let reads=0;B.ctx.getDocs=ref=>{if(ref&&ref.n==='inventory_article_meta'){reads++;return Promise.resolve({forEach(f){[{id:'R10',d:{ignoredUntil:'2026-09-07',ignoredBy:'ammar',ignoredAt:1}},{id:'bad id',d:{ignoreForever:true}},{id:'R9',d:{ignoreForever:true}}].forEach(x=>f({id:x.id,data:()=>x.d}));}});}return Promise.resolve({forEach(){}});};
  BR('collection=function(d,n){return{n}};doc=function(d,c,id){return{c,id}};_siNow=function(){return '+Date.parse('2026-09-02T10:00:00+05:00')+'};_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-09-02")+(off||0));};');
  await BR('_siMetaLoad()');await BR('_siMetaLoad()');
  o['read: ONE getDocs of inventory_article_meta per page load (a second call reuses it); an id that is not a code is ignored']=reads===1&&BR('_siMeta.size')===2&&BR('_siMetaState')==='ok';
  o['read: the ignores that came in are applied (R10 until 7 Sep, R9 for good) -> 18 live articles']=BR('_siIgnored("R10")')===true&&BR('_siIgnored("R9")')===true&&BR('_siAxLive().length')===18;
  o['read: an expired ignore that is still stored does not hide anything (clock at 8 Sep -> R10 back)']=BR('(()=>{_siNow=function(){return '+Date.parse('2026-09-08T09:00:00+05:00')+'};_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-09-08")+(off||0));};return _siAxLive().some(a=>a.code==="R10")&&!_siAxLive().some(a=>a.code==="R9");})()');
  o['read: the loader starts it, outside the percentage (no stage for it)']=!JSON.parse(BR('J=JSON.stringify(_SI_STAGES.map(s=>s.id))')).some(x=>/inventory_article/.test(x))&&/_siMetaState==='idle'\)_siMetaLoad\(\)/.test(src);
  const F=load(src,{}),FR=c=>F.run(c);fixture(F);
  F.ctx.getDocs=ref=>{if(ref&&ref.n==='inventory_article_meta')return Promise.reject(Object.assign(new Error('denied'),{code:'permission-denied'}));return Promise.resolve({forEach(){}});};
  FR('collection=function(d,n){return{n}};doc=function(d,c,id){return{c,id}};');
  let threw=false;try{await FR('_siMetaLoad()');}catch(_){threw=true;}
  const cf=JSON.parse(FR('J=JSON.stringify(_siNaState().counts)'));
  o['failed read: never rejects, state "error", EVERY article still visible (counts equal the baseline), nothing hidden']=!threw&&FR('_siMetaState')==='error'&&FR('_siAxLive().length')===20&&cf.total===18&&cf.critical===11;
  o['failed read: a quiet note "Ignore list could not be read" with Retry on Overview, Needs Attention and the Explorer']=(()=>{const n=FR('_siMetaNote()');return/Ignore list could not be read/.test(n)&&/_siMetaRetry/.test(n)&&/Ignore list could not be read/.test(FR('_siOverviewAttnTiles()'))&&/Ignore list could not be read/.test(FR('_siNaListHtml()'))&&/Ignore list could not be read/.test(FR('_siArticleExplorerSection()'));})();
  o['no note when the read worked']=BR('_siMetaNote()')==='';
  o['escaping: a hostile ignoredBy / name never reaches the Ignored tab as markup']=(()=>{
    FR('_siMetaState="ok";_siProducts=_siProducts.map(p=>p.sku==="R9-M"?Object.assign({},p,{product_title:"<img src=x onerror=alert(1)>"}):p);_siAxCache=null;_siMeta=new Map([["R9",{code:"R9",ignoreForever:false,ignoredUntil:"2026-12-01",ignoredBy:"<b>x</b>",ignoredAt:1}]]);_siIgVer++;');
    const h=FR('_siIgnoredSectionHtml()'),chip=FR('_siIgChipHtml("R9")');return!/<img/i.test(h)&&!/<b>x/.test(h)&&/&lt;img/.test(h)&&/&lt;b&gt;x/.test(h)&&!/<img/i.test(chip);})();
  o['escaping: the code in the Ignore/Restore buttons is escaped']=(()=>{const h=FR('_siIgBtnHtml("A\\"><b>")');return!/data-code="A"><b>/.test(h)&&/&quot;&gt;&lt;b&gt;/.test(h);})();
  const hits2=[];SRC_LINES(src).forEach(l=>{if(!/^\s*\/\//.test(l)&&/(idx|_siAxIndex\(\))\.list\b/.test(l))hits2.push(l.replace(/\s/g,''));});
  const allowed=['idx._lv=idx.list.filter(a=>!_siIgnored(a.code))','const list=_siAxIndex().list;','idx.list.forEach(a=>{','${idx.list.length}articles'];
  o['every use of the FULL index list is accounted for: the live-set builder, Search, the demand pool, the header count (4 lines, no other)']=hits2.length===4&&allowed.every(x=>hits2.some(h=>h.includes(x.replace(/\s/g,''))));
  o['every list builder reads _siAxLive(): class counts, Explorer Overview rows and categories, Portfolio rows, Needs Attention rows']=['_siAxLive().forEach(a=>{if(a.units>0||a.hasStock)c[','return _siAxLive().filter(a=>(a.units>0||a.hasStock)&&(!_siAxOvCat','const cats=[...new Set(_siAxLive().filter(','const rows=_siAxLive().filter(a=>a.units>0||a.hasStock).map(a=>({a,m:_siAxStats(a)','const rows=_siAxLive().filter(a=>a.units>0||a.hasStock).map(_siNaRow)'].every(x=>src.includes(x));
  o['the memos are keyed on the ignore state (Needs Attention and Portfolio recompute after an ignore or an expiry)']=(src.match(/\|'\+_siIgKey\(\);/g)||[]).length===2;
  const blk=ruleBlock(rules);
  const fieldsJs=JSON.parse(R('J=JSON.stringify(_SI_META_FIELDS)'));
  const hasOnly=(/keys\(\)\.hasOnly\(\[([^\]]*)\]\)/.exec(blk)||[])[1]||'';
  const fieldsRules=hasOnly.split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean);
  o['rules: the block exists and the field allow-list equals _SI_META_FIELDS exactly']=!!blk&&fieldsRules.slice().sort().join()===fieldsJs.slice().sort().join();
  o['rules: read is isQaRead() || signedIn() (QA can read, guard convention)']=/allow read: if isQaRead\(\) \|\| signedIn\(\);/.test(blk);
  o['rules: writes need signedIn() (which EXCLUDES the QA account) and never authed() / request.auth != null']=/allow create, update: if signedIn\(\)/.test(blk)&&!/authed\(\)|request\.auth != null/.test(blk);
  o['rules: updatedBy and ignoredBy are bound to the caller (the email prefix), code equals the doc id, the id pattern is enforced']=/updatedBy == userEmail\(\)\.split\('@'\)\[0\]/.test(blk)&&/ignoredBy == userEmail\(\)\.split\('@'\)\[0\]/.test(blk)&&/request\.resource\.data\.code == code/.test(blk)&&/code\.matches\('\^\[A-Z0-9\]\[A-Z0-9\._-\]\{1,39\}\$'\)/.test(blk);
  o['rules: enums for the reserved fields (type top/bottom/other, season winter/summer/all) and a YYYY-MM-DD day check']=/type in \['top','bottom','other'\]/.test(blk)&&/season in \['winter','summer','all'\]/.test(blk)&&/ignoredUntil\.matches\('\^20/.test(blk)&&/ignoreForever', false\) is bool/.test(blk);
  o['rules: delete is refused for everyone (Restore is an update)']=/allow delete: if false;/.test(blk);
  o['the JS enums equal the rules enums (type, season)']=/\['top','bottom','other'\]\.includes\(d\.type\)/.test(src)&&/\['winter','summer','all'\]\.includes\(d\.season\)/.test(src);
  return o;
}
module.exports=async function(){
  const s=suite('shopify-ignore');
  const base=await checks(SRC);
  s.section('Ignore: the predicate, every list and count, search, the Ignored tab, writes, the read, the rules text (hand-computed)');
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
  await brk('PKT end of day uses UTC midnight','T23:59:59.999+05:00','T23:59:59.999+00:00',K('PKT end of day'));
  await brk('forever ignored not honoured','if(m.ignoreForever===true)return true;','',K('forever stays'));
  await brk('one-week is 6 days',"d+(k==='1w'?7:14)","d+(k==='1w'?6:14)",K('periods from'));
  await brk('months not clamped','Math.min(d,last)','d',K('month-end'));
  await brk('Needs Attention uses the full list','const rows=_siAxLive().filter(a=>a.units>0||a.hasStock).map(_siNaRow);','const rows=_siAxIndex().list.filter(a=>a.units>0||a.hasStock).map(_siNaRow);',K('Needs Attention counts').concat(K('Overview tiles')));
  await brk('Explorer Overview uses the full list','return _siAxLive().filter(a=>(a.units>0||a.hasStock)&&(!_siAxOvCat','return _siAxIndex().list.filter(a=>(a.units>0||a.hasStock)&&(!_siAxOvCat',K('Explorer Overview rows'));
  await brk('Portfolio uses the full list','const rows=_siAxLive().filter(a=>a.units>0||a.hasStock).map(a=>({a,m:_siAxStats(a)','const rows=_siAxIndex().list.filter(a=>a.units>0||a.hasStock).map(a=>({a,m:_siAxStats(a)',K('Portfolio'));
  await brk('class counts use the full list','_siAxLive().forEach(a=>{if(a.units>0||a.hasStock)c[','_siAxIndex().list.forEach(a=>{if(a.units>0||a.hasStock)c[',K('Class counts'));
  await brk('Search hides ignored articles','const list=_siAxIndex().list;','const list=_siAxLive();',K('Search still FINDS'));
  await brk('no chip on search results','</div>${_siIgChipHtml(a.code)}</span><span class="n">${a.units} sold</span>${tail}','</div></span><span class="n">${a.units} sold</span>${tail}',K('Search still FINDS'));
  await brk('no rollback on a failed write','if(had)_siMeta.set(code,prev);else _siMeta.delete(code);','',K('failed write'));
  await brk('not optimistic (memory set after the write)','_siMeta.set(code,next);_siIgVer++;_siIgRepaint();\n  let stop','let stop',K('optimistic'));
  await brk('write replaces the doc (no merge)','doc0,{merge:true}','doc0',K('write: one setDoc'));
  await brk('write sends an unlisted field','const doc0=Object.assign({code,updatedAt:now,updatedBy:u},fields);','const doc0=Object.assign({code,updatedAt:now,updatedBy:u,note:"x"},fields);',K('write: only allowed'));
  await brk('restore leaves ignoredBy','return{ignoredUntil:null,ignoreForever:false,ignoredAt:null,ignoredBy:null};','return{ignoredUntil:null,ignoreForever:false,ignoredAt:null};',K('restore: a merge'));
  await brk('no audit verb on restore',"'Restored — it is back in the lists.','Article restored'","'Restored — it is back in the lists.','Article changed'",K('restore is audited'));
  await brk('failed read hides things','}catch(_){_siMetaState=\'error\';}\n    _siIgVer++','}catch(_){_siMetaState=\'ok\';_siMeta=new Map([["R10",{code:"R10",ignoreForever:true}]]);}\n    _siIgVer++',K('failed read: never'));
  await brk('read not started by the loader',"if(_siMetaState==='idle')_siMetaLoad();","",K('read: the loader starts'));
  await brk('Ignored name not escaped','<strong>${_siEsc(nm)}</strong>','<strong>${nm}</strong>',K('escaping: a hostile ignoredBy'));
  await brk('dialog title not escaped','Ignore ${_siEsc(name||code)}</div>','Ignore ${name||code}</div>',K('dialog: a hostile'));
  await brk('dialog default is not one month',"pd.k==='1m'?' checked':''","pd.k==='1w'?' checked':''",K('dialog: ONE question'));
  await brk('never tick ignored','const choice=nv&&nv.checked?\'never\':','const choice=',K('dialog: Ignore with the default'));
  await brk('a sixth period sneaks in',"{k:'6m',l:'6 months'}]","{k:'6m',l:'6 months'},{k:'1y',l:'1 year'}]",K('dialog: ONE question'));
  await brk('button code not escaped','data-code="${_siEsc(code)}" onclick="window.${on?','data-code="${code}" onclick="window.${on?',K('escaping: the code in the Ignore'));
  await brk('memo not keyed on ignore (NA)',"+_siHistState+'|'+_siIgKey();\n  if(_siNaMemo","+_siHistState;\n  if(_siNaMemo",K('the memos'));
  await brk('rules: authed() instead of signedIn()','allow create, update: if signedIn()\n        && code.matches','allow create, update: if authed()\n        && code.matches',K('rules: writes need'),true);
  await brk('rules: read without isQaRead','allow read: if isQaRead() || signedIn();\n      allow create, update: if signedIn()\n        && code.matches','allow read: if signedIn();\n      allow create, update: if signedIn()\n        && code.matches',K('rules: read is'),true);
  await brk('rules: updatedBy not bound',"request.resource.data.updatedBy == userEmail().split('@')[0]",'request.resource.data.updatedBy is string',K('rules: updatedBy'),true);
  await brk('rules: delete allowed','allow delete: if false;\n    }\n    // ── Pattern Hub','allow delete: if signedIn();\n    }\n    // ── Pattern Hub',K('rules: delete'),true);
  await brk('rules: season enum widened',"request.resource.data.season in ['winter','summer','all']",'request.resource.data.season is string',K('rules: enums'),true);
  await brk('rules: field list gains a field',"'updatedAt','updatedBy'])\n        && request.resource.data.keys().hasAll","'updatedAt','updatedBy','reason'])\n        && request.resource.data.keys().hasAll",K('rules: the block exists'),true);
  s.ok('breaks run: '+broken,broken>=25);
  return s;
};
module.exports._checks=checks;

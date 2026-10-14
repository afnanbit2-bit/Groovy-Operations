/* Inventory Intel ▸ Restock bell row (WP2). Built on the Needs Attention fixture (see tests/shopify-restock.test.js for the hand computation:
   12 suggestions, 11 critical, top five R10, R9, R8, R7, R6 at 888, 816, 744, 672, 612 pieces, lead 21 days).
   HAND-COMPUTED EXPECTATIONS (today 2026-08-31):
   - three rows, ids restock_2026-08-31_afnan / _ammar / _mustafa, forUser the person, forRole '', priority high (11 critical),
     title "Restock: 12 articles (11 critical)", message "R10 Art R10 — Blue — 888 pcs (cover 1–3 days, lead 21 d); R9 … ; +7 more".
   - at most 3 getDoc and 3 setDoc a run; a known id (allHRMNotifs) costs no read; an id that exists is not written again.
   - a snapshot 36 h old: title ends " — data 36 h old", and the rows are still raised.
   - nothing due (empty), or not computed (history loading): no row, no day key.
   Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=JSON.stringify;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const PHD=fs.readFileSync(path.join(__dirname,'../js/ph-data.js'),'utf8');
const NA=fs.readFileSync(path.join(__dirname,'shopify-needs-attention.test.js'),'utf8');
const FX=eval('('+NA.slice(NA.indexOf('function fixture(a){'),NA.indexOf('async function checks')).replace(/^function fixture/,'function')+')');
function load(src,opt){
  opt=opt||{};
  const store={},c={get:0,set:0,sets:[],gets:[]};
  const existing=opt.existing||new Set();
  const a=harness.loadApp({files:[],session:{uid:'u1',u:opt.user||'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
      getDocs:()=>Promise.resolve({forEach(){}}),db:{},doc:(d,col,id)=>({col,id}),
      getDoc:ref=>{c.get++;c.gets.push(ref.id);if(opt.getThrows)throw new Error('sync boom');return Promise.resolve({exists:()=>existing.has(ref.id)});},
      setDoc:(ref,data)=>{c.set++;if(opt.setFails)return Promise.reject(new Error('denied'));c.sets.push({id:ref.id,col:ref.col,data});return Promise.resolve();}}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  a.store=store;a.c=c;
  return a;
}
async function checks(src){
  const o={};
  const fresh=(opt)=>{const a=load(src,opt);FX(a);return a;};
  const a=fresh(),R=c=>a.run(c);
  let r=await R('_siRestockRaise()');
  const rows=a.c.sets;
  o['raises three rows: afnan, ammar, mustafa, ids restock_2026-08-31_<u>, in the hrm_notifications collection']=r.raised===3&&rows.map(x=>x.id).join()==='restock_2026-08-31_afnan,restock_2026-08-31_ammar,restock_2026-08-31_mustafa'&&rows.every(x=>x.col==='hrm_notifications');
  o['row shape: forUser the person, forRole empty, type restock_daily, unread, priority high, actionUrl #inventory/attention']=rows.every((x,i)=>x.data.forUser===['afnan','ammar','mustafa'][i]&&x.data.forRole===''&&x.data.type==='restock_daily'&&Array.isArray(x.data.readBy)&&x.data.readBy.length===0&&x.data.priority==='high'&&x.data.actionUrl==='#inventory/attention'&&x.data.id===x.id);
  o['title: "Restock: 12 articles (11 critical)"']=rows[0].data.title==='Restock: 12 articles (11 critical)';
  o['message: the top five as "CODE name — pcs (cover, lead)", then "+7 more"']=rows[0].data.message.indexOf('R10 Art R10 — Blue — 888 pcs (cover 1–3 days, lead 21 d); R9 Art R9 — Blue — 816 pcs')===0&&/; \+7 more$/.test(rows[0].data.message)&&rows[0].data.message.split('; ').length===6;
  o['cost: at most 3 getDoc and 3 setDoc (exactly 3 and 3 here)']=a.c.get===3&&a.c.set===3;
  o['the day key is set so a second paint the same day reads nothing']=a.store['groovy-si-restock-day']==='2026-08-31';
  const again=await R('_siRestockRaise()');
  o['a second call in the same page load is skipped (already ran), no further reads or writes']=again.skipped==='already ran'&&a.c.get===3&&a.c.set===3;
  R('_siRestockRan=false');
  const again2=await R('_siRestockRaise()');
  o['a new page load the same day is skipped by the device-day key (ran today)']=again2.skipped==='ran today'&&a.c.get===3;
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-09-01")+(off||0));};_siRestockRan=false');
  const next=await R('_siRestockRaise()');
  o['the next PKT day is a new id: three new rows restock_2026-09-01_<u>']=next.raised===3&&a.c.sets.slice(3).map(x=>x.id).join()==='restock_2026-09-01_afnan,restock_2026-09-01_ammar,restock_2026-09-01_mustafa';
  // only-if-absent
  const b=fresh({existing:new Set(['restock_2026-08-31_ammar'])});
  const rb=await b.run('_siRestockRaise()');
  o['only-if-absent: an id that already exists (maybe dismissed) is not written again; the other two are']=rb.raised===2&&b.c.get===3&&b.c.set===2&&b.c.sets.every(x=>x.id!=='restock_2026-08-31_ammar');
  // known notifications cost no read
  const k=fresh();
  k.run('allHRMNotifs=[{_id:"restock_2026-08-31_afnan"}]');
  const rk=await k.run('_siRestockRaise()');
  o['an id already in allHRMNotifs costs no getDoc and no setDoc (2 and 2 left)']=rk.raised===2&&k.c.get===2&&k.c.set===2&&k.c.gets.indexOf('restock_2026-08-31_afnan')<0;
  // stale
  const s=fresh();
  s.run('_siNaNowMs=Date.parse("2026-08-31T12:00:00Z");_siSnapshot.snapshot_at="2026-08-30T00:00:00Z"');
  await s.run('_siRestockRaise()');
  o['stale data still raises, with "— data 36 h old" in the title']=s.c.set===3&&s.c.sets[0].data.title==='Restock: 12 articles (11 critical) — data 36 h old';
  // nothing due / not computed
  const e=fresh();
  e.run('_siRestockPick=()=>false');
  const re=await e.run('_siRestockRaise()');
  o['nothing due (empty list): no row, no read, no day key']=re.skipped==='empty'&&e.c.set===0&&e.c.get===0&&e.store['groovy-si-restock-day']==null;
  const l=fresh();l.run('_siHistState="loading"');
  const rl=await l.run('_siRestockRaise()');
  o['not computed (history loading): no row and no day key, so a later paint can still raise it']=rl.skipped==='loading'&&l.c.set===0&&l.store['groovy-si-restock-day']==null;
  const nf=fresh();nf.run('_siLinesScope="window"');
  const rnf=await nf.run('_siRestockRaise()');
  o['needs full history: no row']=rnf.skipped==='needs-full'&&nf.c.set===0;
  // only the three
  const u=fresh({user:'raees'});
  const ru=await u.run('_siRestockRaise()');
  o['a non-recipient (raees) raises nothing']=ru.skipped==='not a restock recipient'&&u.c.get===0&&u.c.set===0;
  const mu=fresh({user:'mustafa'});
  const rm=await mu.run('_siRestockRaise()');
  o['any of the three raises for all three (mustafa opens the page: 3 rows)']=rm.raised===3;
  // escaping
  const x=fresh();
  x.run('_siProducts.forEach(p=>{if(p.sku==="R10-M")p.product_title="<img src=x onerror=alert(1)>&"});_siAxCache=null;_siNaMemo=null');
  await x.run('_siRestockRaise()');
  const d=x.c.sets[0].data;
  o['the bell prints title and message raw, so both are escaped: no "<" and the ampersand is &amp;']=d.message.indexOf('<')<0&&d.message.indexOf('&lt;img src=x')>=0&&d.message.indexOf('&amp;')>=0&&d.title.indexOf('<')<0;
  // never throws, never blocks
  const f=fresh({setFails:true});
  let thrown=false,rf=null;try{rf=await f.run('_siRestockRaise()');}catch(_){thrown=true;}
  o['a refused write: resolves, never throws, reports 3 failed and does NOT set the day key (retry on a later visit)']=!thrown&&rf&&rf.failed===3&&rf.raised===0&&f.store['groovy-si-restock-day']==null;
  const g=fresh({getThrows:true});
  let thrown2=false,rg=null;try{rg=await g.run('_siRestockRaise()');}catch(_){thrown2=true;}
  const g2=fresh();g2.run('_siPktDate=function(){throw new Error("clock")}');
  let thrown3=false,rg2=null;try{rg2=await g2.run('_siRestockRaise()');}catch(_){thrown3=true;}
  o['a getDoc that throws synchronously, or an unexpected throw before any read: resolves, never throws']=!thrown2&&rg&&rg.raised===0&&g.c.set===0&&!thrown3&&rg2&&rg2.raised===0&&!!rg2.error;
  const nd=fresh();nd.run('db=undefined;');
  const rnd=await nd.run('_siRestockRaise()').catch(()=>({threw:true}));
  o['no Firestore bridge: skipped, never throws']=rnd&&!rnd.threw&&rnd.raised===0;
  const p=fresh();
  const html=p.run('_siRestockCardHtml()');
  o['painting the card does not block: it returns a string at once and has read and written nothing yet']=typeof html==='string'&&html.indexOf('si-rs')>0&&p.c.set===0&&p.c.get===0;
  await new Promise(r2=>setTimeout(r2,20));
  o['…and the raise runs after the paint (3 rows)']=p.c.set===3;
  // wiring
  const own=/_SI_RESTOCK_USERS=Object\.freeze\(\[([^\]]*)\]\)/.exec(src),ph=/_PH_MANAGE_USERS=Object\.freeze\(\[([^\]]*)\]\)/.exec(PHD);
  const names=m=>m?m[1].split(',').map(t=>t.trim().replace(/'/g,'')).join():null;
  o['recipients equal _PH_MANAGE_USERS (js/ph-data.js): '+names(ph)]=!!own&&!!ph&&names(own)===names(ph);
  const h=fresh();h.run('location.hash="#inventory/attention"');
  const link=h.run('J=JSON.stringify(_siTkParseHash())');
  o['the bell\'s actionUrl #inventory/attention resolves to the Needs Attention section']=link==='{"section":"attention","sub":""}'||(JSON.parse(link||'null')||{}).section==='attention';
  return o;
}
module.exports=async function(){
  const s=suite('shopify-restock-bell');
  const base=await checks(SRC);
  s.section('Restock bell row: id, shape, cost, only-if-absent, stale, escaping, never throws (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const K=Object.keys(base),k=t=>K.find(x=>x.indexOf(t)===0);
  const brk=async(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>{broken++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  await brk('id without the day',"id:'restock_'+day+'_'+u","id:'restock_'+u",[k('raises three rows'),k('the next PKT day')]);
  await brk('id without the person',"id:'restock_'+day+'_'+u","id:'restock_'+day",[k('raises three rows')]);
  await brk('only-if-absent dropped','if(snap&&snap.exists())continue;','',[k('only-if-absent')]);
  await brk('known ids re-read','if(known.has(n.id))continue;','',[k('an id already in allHRMNotifs')]);
  await brk('day key never set',"if(!failed){try{localStorage.setItem(_SI_RESTOCK_DAY_KEY,day);}catch(_){}}",'',[k('the day key is set'),k('a new page load the same day')]);
  await brk('day key set even on failure',"if(!failed){try{localStorage","if(true){try{localStorage",[k('a refused write')]);
  await brk('same-load guard dropped',"if(_siRestockRan&&!o.force)return{raised:0,skipped:'already ran'};",'',[k('a second call in the same page load')]);
  await brk('empty list still raises',"if(st.state!=='ok'||!st.total)return{raised:0,skipped:st.state};",'',[k('nothing due'),k('not computed'),k('needs full history')]);
  await brk('priority always normal',"priority:crit>0?'high':'normal'","priority:'normal'",[k('row shape')]);
  await brk('actionUrl changed',"actionUrl:'#inventory/attention'","actionUrl:'#inventory'",[k('row shape')]);
  await brk('forRole set',"forUser:n.forUser,forRole:''","forUser:n.forUser,forRole:'owner'",[k('row shape')]);
  await brk('title not escaped','title:_siEsc(title),message:_siEsc(message)','title:title,message:message',[k('the bell prints title and message raw')]);
  await brk('message not escaped','message:_siEsc(message)','message:message',[k('the bell prints title and message raw')]);
  await brk('stale hours dropped',"const stale=st.staleH!=null?' — data '+st.staleH+' h old':'';","const stale='';",[k('stale data still raises')]);
  await brk('stale blocks the row',"const st=_siRestockState();\n    if(st.state!=='ok'","const st=_siRestockState();if(st.staleH!=null)return{raised:0,skipped:'stale'};\n    if(st.state!=='ok'",[k('stale data still raises')]);
  await brk('recipient gate dropped',"if(!_siRestockCanSee())return{raised:0,skipped:'not a restock recipient'};",'',[k('a non-recipient')]);
  await brk('recipient widened',"Object.freeze(['afnan','ammar','mustafa']); // held","Object.freeze(['afnan','ammar','mustafa','raees']); // held",[k('recipients equal _PH_MANAGE_USERS'),k('row shape')]);
  await brk('write failure throws',"}catch(e){failed++;}","}catch(e){throw e;}",[k('a refused write')]);
  await brk('outer guard dropped',"}catch(e){return{raised:0,error:String(e&&e.message||e)};}","}finally{}",[k('a getDoc that throws synchronously, or')]);
  await brk('top level awaited in paint',"setTimeout(()=>{_siRestockRaise();},0);","_siRestockRaise();",[k('painting the card does not block')]);
  await brk('raise never scheduled',"setTimeout(()=>{_siRestockRaise();},0);",'',[k('…and the raise runs after the paint')]);
  await brk('too many rows planned',"return _SI_RESTOCK_USERS.map(u=>({id","return _SI_RESTOCK_USERS.concat(_SI_RESTOCK_USERS).map(u=>({id",[k('cost: at most 3')]);
  await brk('message shows all, no more-line',"+(n>st.rows.length?'; +'+(n-st.rows.length)+' more':'')","",[k('message: the top five')]);
  s.ok('breaks run: '+broken,broken>=22);
  return s;
};
module.exports._checks=checks;

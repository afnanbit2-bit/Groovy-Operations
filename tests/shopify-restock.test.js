/* Inventory Intel ▸ Restock card (WP1): a restock suggestion is ONE existing Needs Attention issue that passes _siRestockPick. No second calculator,
   no Firestore read. Built on the Needs Attention fixture (its FIXTURE comment holds the hand computation; today 2026-08-31, lead time 21 days).
   HAND-COMPUTED EXPECTATIONS:
   - Issues of type stockout/runout in bands critical/act: R1..R10 (critical run-outs), O1 (critical stock-out), A1 (act run-out) = 12, 11 of them critical.
     Not suggestions: H (size hole), V1 (overstock), D1/D2 (dead), F1 (demand drop), T1 (data check), N1 (too early).
   - Order = band, then rupees at stake: R10 245,000 > R9 224,000 > R8 203,000 > R7 182,000 > R6 161,000 > R5 140,000 > R4 119,000 > R3 98,000 > O1 79,800 > R2 77,000 > R1 56,000, then A1.
     Top five = R10, R9, R8, R7, R6.
   - Pieces: R-articles are winners (cover target 35 days, span 21+35 = 56). R10 sells 13 a day with 28 on hand:
     hi = ceil((13 x 1.25 x 56 - 28)/12) x 12 = ceil(882/12) x 12 = 888, lo = ceil((13 x 0.75 x 56 - 28)/12) x 12 = ceil(518/12) x 12 = 528.
     R9 (12 a day): hi = ceil(812/12) x 12 = 816. R6 (9 a day): hi = ceil(602/12) x 12 = 612. O1 (constrained, 3.8 a day, target 28, nothing on hand): 144..240.
   - A PO of 240 on O1 covers its guide: it leaves the list (11 left, 10 critical). A PO of 100 reduces O1 to 48..144 (shown, 100 on order).
   Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=JSON.stringify;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const NA=fs.readFileSync(path.join(__dirname,'shopify-needs-attention.test.js'),'utf8');
const FX=eval('('+NA.slice(NA.indexOf('function fixture(a){'),NA.indexOf('async function checks')).replace(/^function fixture/,'function')+')');
function load(src,extra,user){
  const store={},reads={n:0};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:user||'afnan',name:'Afnan',role:'owner'},
    globals:Object.assign({localStorage:{getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}},
      getDocs:()=>{reads.n++;return Promise.resolve({forEach(){}});},getDoc:()=>{reads.n++;return Promise.resolve({exists:()=>false});}},extra||{})});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  a.store=store;a.reads=reads;
  return a;
}
async function checks(src){
  const o={},a=load(src),R=c=>a.run(c);
  FX(a);
  const setPos=(list,state)=>{
    const m={};list.forEach(p=>{(m[p[0]]=m[p[0]]||[]).push({id:p[1],code:p[0],qty:p[2],day:p[3]});});
    R('_siPoByCode=new Map(Object.entries('+J(m)+'));_siPoState='+J(state||'ok')+';_siPoVer++;_siPoMemo=null');
  };
  const st=()=>JSON.parse(R('J=JSON.stringify(_siRestockState())'));
  const card=()=>R('_siRestockCardHtml()');
  a.reads.n=0;
  // ── the pick, on the fixture ──
  let s=st();
  o['fixture: 12 suggestions (R1..R10, O1, A1), 11 critical; the size hole, overstock, dead stock, demand drop, data check and too-early are not']=s.state==='ok'&&s.total===12&&s.critical===11;
  o['top five in rupee order: R10, R9, R8, R7, R6 (R10 245,000 down to R6 161,000)']=s.rows.map(r=>r.code).join()==='R10,R9,R8,R7,R6';
  o['pieces are the HIGH end, hand-computed: R10 888 (guide 528..888), R9 816, R6 612']=s.rows[0].hi===888&&s.rows[0].lo===528&&s.rows[1].hi===816&&s.rows[4].hi===612;
  o['every kept issue is stockout/runout/rising in critical/act: the whole list, not only the top five']=R('_siNaState().issues.filter(_siRestockPick).every(i=>["stockout","runout","rising"].indexOf(i.type)>=0&&(i.band==="critical"||i.band==="act")&&i.n.qty&&i.n.qty.hi>0)')===true&&R('_siNaState().issues.filter(_siRestockPick).map(i=>i.code).sort().join()')==='A1,O1,R1,R10,R2,R3,R4,R5,R6,R7,R8,R9';
  o['O1 (critical stock-out, nothing on hand) is a suggestion with guide 144..240']=JSON.parse(R('J=JSON.stringify(_siRestockRow(_siNaState().issues.find(i=>i.code==="O1")))')).hi===240;
  // ── the pure pick on hand-built issues ──
  const P=i=>R('_siRestockPick('+J(i)+')');
  const base=(o2)=>Object.assign({code:'X1',type:'runout',band:'critical',n:{qty:{lo:12,hi:24},actKey:'reorder'}},o2||{});
  o['pick: runout critical with a guide = yes; stockout = yes; rising in band act = yes']=P(base())===true&&P(base({type:'stockout'}))===true&&P(base({type:'rising',band:'act'}))===true;
  o['pick: band watch = no']=P(base({band:'watch'}))===false;
  o['pick: size hole, dead, overstock, demand drop, data check = no (not a restock)']=['sizehole','dead','overstock','demanddrop','datatrust'].every(t=>P(base({type:t}))===false);
  o['pick: qty null (covered by an open PO) = no; qty with hi 0 = no']=P(base({n:{qty:null,actKey:'reorder'}}))===false&&P(base({n:{qty:{lo:0,hi:0},actKey:'reorder'}}))===false;
  o['pick: the Explorer verdict stuck / hold / markdown = no; reorder = yes']=['stuck','hold','markdown'].every(k=>P(base({n:{qty:{lo:12,hi:24},actKey:k}}))===false);
  o['pick: an ignored article = no']=R('(()=>{const f=_siIgnored;_siIgnored=c=>c==="X1";const r=_siRestockPick('+J(base())+');_siIgnored=f;return r;})()')===false;
  o['pick: malformed input is false and never throws']=R('[null,undefined,{},{code:1},{code:"A",n:null}].every(i=>_siRestockPick(i)===false)')===true;
  // ── on order ──
  setPos([['O1','PO-1',240,'2026-08-25']]);
  s=st();
  o['a PO of 240 covers O1: it leaves the list (11 left, 10 critical)']=s.total===11&&s.critical===10&&R('_siNaState().issues.filter(_siRestockPick).every(i=>i.code!=="O1")')===true;
  setPos([['O1','PO-1',100,'2026-08-25']]);
  const o1=JSON.parse(R('J=JSON.stringify(_siRestockRow(_siNaState().issues.find(i=>i.code==="O1")))'));
  o['a partial PO of 100 shows O1 at the deducted guide 48..144, 100 on order']=o1.lo===48&&o1.hi===144&&o1.onOrder===100&&st().total===12;
  setPos([]);
  o['a read PO list with nothing open: on order 0, the row says "none on order"']=card().indexOf('none on order')>=0;
  setPos([],'error');
  o['PO read failed: rows still show, marked "on-order data unavailable", and the card says so']=st().total===12&&card().indexOf('on-order data unavailable')>=0&&card().indexOf('Open POs could not be read')>=0;
  // ── the size split ──
  R('_siAxSizeSplit=()=>({ok:true,rows:[{size:"S",units:12},{size:"M",units:24},{size:"L",units:0}]})');
  o['size split: "S 12 · M 24" (a size with 0 pieces is left out)']=JSON.parse(R('J=JSON.stringify(_siRestockRow(_siNaState().issues[0]))')).split==='S 12 · M 24';
  R('_siAxSizeSplit=()=>({ok:false,why:"x"})');
  o['size split refused: no split text, the row still shows']=JSON.parse(R('J=JSON.stringify(_siRestockRow(_siNaState().issues[0]))')).split===null;
  R('_siAxSizeSplit=()=>{throw new Error("boom")}');
  o['size split throws: no split, the row is still built']=JSON.parse(R('J=JSON.stringify(_siRestockRow(_siNaState().issues[0]))')).hi===888;
  // ── the card ──
  let h=card();
  o['card: ok state lists five rows, a count of 12 and "+7 more"; each row opens its article']=(h.match(/class="si-rs-row /g)||[]).length===5&&/si-rs-n">12</.test(h)&&/\+7 more/.test(h)&&/data-code="R10"/.test(h);
  o['card: a row shows pieces (the high end), the guide, the band, cover, lead time']=/<strong>888 pcs<\/strong> <span class="si-rs-guide">guide 528–888/.test(h)&&/Critical · 1–3 days · lead 21 d/.test(h);
  o['card: it is part of the Today section']=/id="si-rs"/.test(R('_siOverview({})'));
  R('_siLinesScope="window"');
  o['state needs-full: no number, the "needs full history" cell']=st().state==='needs-full'&&/needs full history/.test(card())&&!/si-rs-row/.test(card());
  R('_siLinesScope="full"');
  R('_siHistState="loading"');
  o['state loading: "Reading the stock history…", no list, no zero']=st().state==='loading'&&/Reading the stock history/.test(card())&&!/Nothing needs a restock/.test(card());
  R('_siHistState="error"');
  o['state error: "Stock history unavailable — cover cannot be judged" with Retry, never "nothing to restock"']=st().state==='error'&&/Stock history unavailable — cover cannot be judged/.test(card())&&/Retry/.test(card())&&!/Nothing needs a restock/.test(card());
  R('_siHistState="ok"');
  R('_siRestockPickKeep=_siRestockPick;_siRestockPick=()=>false');
  o['state empty (computed, nothing passes): "Nothing needs a restock today (20 articles judged; lead times as set on this device)"']=st().state==='empty'&&/Nothing needs a restock today \(20 articles judged; lead times as set on this device\)/.test(card());
  R('_siRestockPick=_siRestockPickKeep');
  // ── stale data ──
  R('_siNaNowMs=Date.parse("2026-08-31T12:00:00Z");_siSnapshot.snapshot_at="2026-08-31T11:00:00Z";_siSyncMeta={}');
  o['fresh snapshot (1 h): no stale line']=st().staleH===null&&!/si-rs-stale/.test(card());
  R('_siSnapshot.snapshot_at="2026-08-30T00:00:00Z"');
  o['snapshot 36 h old (past 26 h): "Data 36 h old" on the card, rows still shown']=st().staleH===36&&/Data 36 h old/.test(card())&&/si-rs-row/.test(card());
  R('_siSnapshot.snapshot_at="2026-08-31T11:00:00Z";_siSyncMeta={orderSync:{last_success_at:"2026-08-31T02:00:00Z"}}');
  o['orders last synced 10 h ago (past 8 h): data 10 h old']=st().staleH===10;
  R('_siSnapshot.snapshot_at="2026-08-30T00:00:00Z"');
  o['both stale: the older one (36 h) is named']=st().staleH===36;
  R('_siSyncMeta={};_siNaNowMs=null');
  // ── audience ──
  const raees=load(src,null,'raees');FX(raees);
  o['audience: raees gets no card (empty string), even with data']=raees.run('_siRestockCardHtml()')===''&&raees.run('_siRestockCanSee()')===false;
  const mus=load(src,null,'mustafa');FX(mus);
  o['audience: mustafa and ammar get the card']=/si-rs/.test(mus.run('_siRestockCardHtml()'))&&load(src,null,'ammar').run('_siRestockCanSee()')===true;
  o['audience: the list is afnan, ammar, mustafa and nobody else']=R('J=JSON.stringify(_SI_RESTOCK_USERS)')==='["afnan","ammar","mustafa"]';
  // ── snapshot (per device) ──
  a.store['groovy-si-restock-last']=undefined;delete a.store['groovy-si-restock-last'];
  R('_siHistState="loading"');card();
  o['snapshot: nothing is written while the state is not computed']=a.store['groovy-si-restock-last']==null;
  R('_siHistState="ok"');card();
  const snap=JSON.parse(a.store['groovy-si-restock-last']||'null');
  o['snapshot: written on compute with the as-of day, the count and the top five rows']=!!snap&&snap.day==='2026-08-31'&&snap.n===12&&snap.critical===11&&snap.rows.length===5&&snap.rows[0].code==='R10'&&snap.rows[0].hi===888;
  // ── escaping ──
  R('_siProducts.forEach(p=>{if(p.sku==="R10-M")p.product_title="<img src=x onerror=alert(1)>"});_siAxCache=null;_siNaMemo=null');
  h=card();
  o['escaping: a hostile article name is text in the card, never markup']=h.indexOf('<img src=x')<0&&h.indexOf('&lt;img src=x')>=0;
  // ── the handlers ──
  R('location.hash=""');
  const opened=R('window._siRestockOpen({getAttribute:()=>"R9"})');
  o['clicking a row opens that article’s situation in Needs Attention']=opened===true&&R('_siSection')==='attention'&&R('_siNaSel')==='R9';
  o['clicking with no code does nothing']=R('window._siRestockOpen({getAttribute:()=>""})')===false;
  const w0=a.ctx.__writes?a.ctx.__writes.length:0;
  const dr=await R('window._siRestockDraft("R10")');
  o['WP3: with Production Ops not loaded (no phCanManage), _siRestockDraft refuses and writes nothing (tests/shopify-restock-draft.test.js drives the real thing)']=dr&&dr.ok===false&&dr.code==='forbidden'&&(a.ctx.__writes?a.ctx.__writes.length:0)===w0;
  // ── no read added ──
  o['no Firestore read: building the state and the card, repeatedly, calls getDocs/getDoc zero times']=a.reads.n===0;
  return o;
}
module.exports=async function(){
  const s=suite('shopify-restock');
  const base=await checks(SRC);
  s.section('Restock card: the pick, the card states, on order, stale data, audience, snapshot (hand-computed)');
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
  await brk('size hole counts','const _SI_RESTOCK_TYPES=Object.freeze([\'stockout\',\'runout\',\'rising\'])','const _SI_RESTOCK_TYPES=Object.freeze([\'stockout\',\'runout\',\'rising\',\'sizehole\'])',[k('pick: size hole, dead')]);
  await brk('rising dropped','[\'stockout\',\'runout\',\'rising\']','[\'stockout\',\'runout\']',[k('pick: runout critical with a guide')]);
  await brk('watch band counts','_SI_RESTOCK_BANDS=Object.freeze([\'critical\',\'act\'])','_SI_RESTOCK_BANDS=Object.freeze([\'critical\',\'act\',\'watch\'])',[k('pick: band watch')]);
  await brk('null qty allowed','const q=i.n.qty;if(!q||!(q.hi>0))return false;','const q=i.n.qty||{hi:1};',[k('pick: qty null'),k('a PO of 240 covers O1')]);
  await brk('verdict ignored','if(_SI_RESTOCK_NOT.indexOf(i.n.actKey)>=0)return false;','',[k('pick: the Explorer verdict')]);
  await brk('ignored articles listed',"if(typeof _siIgnored==='function'&&_siIgnored(i.code))return false;",'',[k('pick: an ignored article')]);
  await brk('no throw guard','if(!i||!i.n||typeof i.code!==\'string\')return false;','',[k('pick: malformed input')]);
  await brk('low end shown','lo:q.lo,hi:q.hi,cover','lo:q.lo,hi:q.lo,cover',[k('pieces are the HIGH end')]);
  await brk('top ten','_SI_RESTOCK_TOP=5','_SI_RESTOCK_TOP=10',[k('top five in rupee order'),k('card: ok state lists five rows')]);
  await brk('on-order unknown shown as none',"onOrder:(oo&&oo.state==='ok')?(oo.qty||0):null","onOrder:(oo&&oo.qty)||0",[k('PO read failed')]);
  await brk('size split dropped','if(s.ok&&s.rows)split=','if(false)split=',[k('size split: "S 12')]);
  await brk('split not guarded','}catch(_){split=null;}','}catch(_){throw _;}',[k('size split throws')]);
  await brk('full-history gate dropped',"if(!_siFullHist())return no('needs-full');",'',[k('state needs-full')]);
  await brk('loading reads as empty',"if(_siHistState==='idle'||_siHistState==='loading')return no('loading');",'',[k('state loading')]);
  await brk('error reads as empty',"if(_siHistState!=='ok')return no('error');",'',[k('state error')]);
  await brk('empty message when unknown','state:all.length?\'ok\':\'empty\'','state:\'empty\'',[k('fixture: 12 suggestions')]);
  await brk('stale line dropped','const stale=st.staleH!=null&&','const stale=false&&',[k('snapshot 36 h old')]);
  await brk('stale threshold 0','now-sm>C.staleSnapHours*3600000','now-sm>0',[k('fresh snapshot (1 h)')]);
  await brk('orders staleness ignored','if(om!=null&&now-om>C.staleOrderHours*3600000)worst=Math.max(worst||0,now-om);','',[k('orders last synced 10 h ago')]);
  await brk('stale takes the newer','worst=Math.max(worst||0,now-om)','worst=Math.min(worst||1e15,now-om)',[k('both stale')]);
  await brk('card shown to everyone',"if(!_siRestockCanSee())return'';\n  const st=_siRestockState();_siRestockSnapshot(st);","\n  const st=_siRestockState();_siRestockSnapshot(st);",[k('audience: raees')]);
  await brk('recipient list widened',"Object.freeze(['afnan','ammar','mustafa']); // held","Object.freeze(['afnan','ammar','mustafa','raees']); // held",[k('audience: the list is afnan')]);
  await brk('snapshot written when loading',"if(st.state!=='ok'&&st.state!=='empty')return;","",[k('snapshot: nothing is written')]);
  await brk('snapshot never written','if(localStorage.getItem(_SI_RESTOCK_SNAP_KEY)!==s)localStorage.setItem(_SI_RESTOCK_SNAP_KEY,s);','',[k('snapshot: written on compute')]);
  await brk('name not escaped','<span class="si-rs-name">${_siEsc(r.label)}</span>','<span class="si-rs-name">${r.label}</span>',[k('escaping')]);
  await brk('card dropped from Today','  ${_siRestockCardHtml()}\n','',[k('card: it is part of the Today section')]);
  await brk('open handler does not switch','window._siSwitchTab(\'attention\');\n  return window._siNaOpen(code);','return window._siNaOpen(code);',[k('clicking a row opens')]);
  await brk('state does a read','let ns,all;','getDocs&&getDocs();let ns,all;',[k('no Firestore read')]);
  await brk('draft refusal dropped',"if(!_siRestockCanDraft()){_siRestockToast('Starting a PO draft is for","if(false){_siRestockToast('Starting a PO draft is for",[k('WP3: with Production Ops not loaded')]);
  s.ok('breaks run: '+broken,broken>=28);
  return s;
};
module.exports._checks=checks;

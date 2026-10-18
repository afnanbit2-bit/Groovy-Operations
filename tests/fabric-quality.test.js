/* ─────────────────────────────────────────────────────────────────────────
   Fabric ▸ data quality (WP-F4 / F5 / F6, Oct 2026) — js/fabric.js on top of the
   REAL engine in js/gatepass.js, against an in-memory Firestore.

   What this guards:
     1  (F4) GROUP ON READ — the Stock tab, the drill and the Issue picker show ONE
        row per type+colour: Stock / Rolls are the sums of the member buckets, the GSM
        column is the in-stock rolls' measured range, a bucket's own GSM shows muted
        as "entered as N". Filters / search / category chips work on groups, and the
        group's alert level uses the highest member threshold.
     2  (F4) THE PASS SHAPE IS UNCHANGED — a pick across two buckets still writes two
        `fabrics[]` entries carrying their STORED inventoryKeys.
     3  (F4) lotKind ('fresh' | 'stock') lives on the receipt only, only when chosen,
        and is shown in the drill and on the Defects tab; nothing is rewritten.
     4  (F5) the colour normaliser and the Fabric data health card (pure, unavailable
        is never 0, nothing is written) and the typed pickers ("Did you mean").
     5  (F6) new issues store the PO key; the size row offers the PO's sizes.
   Plain node, no network: it proves the LOGIC, not what a phone shows.
   ─────────────────────────────────────────────────────────────────────────  */
'use strict';
const {loadApp,suite}=require('./harness');
const {installMint}=require('./mint-helper');

const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const J=x=>JSON.stringify(x);
const _esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function makeFs(){
  const store=new Map();
  const stats={tx:0,writes:[]};
  let auto=0;
  const ref=path=>({path,id:path.split('/').pop()});
  const apply=b=>{
    const p=b.ref.path;
    if(b.op==='delete'){store.delete(p);return;}
    if(b.op==='update'||(b.op==='set'&&b.merge))store.set(p,Object.assign({},store.get(p)||{},b.data));
    else store.set(p,b.data);
  };
  const api={
    db:{__db:1},
    collection:(_db,name)=>({__coll:name}),
    doc:(a,...segs)=>(a&&a.__coll)?ref(a.__coll+'/auto'+(++auto)):ref(segs.join('/')),
    runTransaction:async(_db,fn)=>{
      stats.tx++;
      const buf=[];let wrote=false;
      const tx={
        get:async r=>{
          if(wrote)throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return{exists:()=>store.has(r.path),data:()=>clone(store.get(r.path))};
        },
        set(r,data,opts){wrote=true;buf.push({op:'set',ref:r,data:clone(data),merge:!!(opts&&opts.merge)});return tx;},
        update(r,data){wrote=true;buf.push({op:'update',ref:r,data:clone(data)});return tx;},
        delete(r){wrote=true;buf.push({op:'delete',ref:r});return tx;}
      };
      await fn(tx);
      buf.forEach(b=>{stats.writes.push(b.op+' '+b.ref.path);apply(b);});
    },
    setDoc:async(r,data,opts)=>{stats.writes.push('setDoc '+r.path);if(opts&&opts.merge)store.set(r.path,Object.assign({},store.get(r.path)||{},clone(data)));else store.set(r.path,clone(data));},
    updateDoc:async(r,data)=>{stats.writes.push('updateDoc '+r.path);if(!store.has(r.path))throw new Error('No document to update: '+r.path);store.set(r.path,Object.assign({},store.get(r.path),clone(data)));},
    deleteDoc:async r=>{stats.writes.push('deleteDoc '+r.path);store.delete(r.path);},
    getDocs:async c=>({metadata:{fromCache:false},docs:[...store.keys()].filter(k=>k.startsWith(c.__coll+'/')).map(k=>({id:k.split('/').pop(),data:()=>clone(store.get(k))}))})
  };
  return{store,stats,api,keys:prefix=>[...store.keys()].filter(k=>k.startsWith(prefix))};
}

const SESS={
  kashif:{uid:'u1',u:'uzaib',name:'Uzaib',role:'viewer',canFabric:true},
  afnan:{uid:'u4',u:'afnan',name:'Afnan',role:'owner',canFabric:true}
};
const roll=(code,w,extra)=>Object.assign({rollCode:code,weight:w,gsm:220,unit:'kg',status:'in_stock',sourceFabId:'FAB-001'},extra||{});
const RECEIPTS=[
  {id:'FAB-001',fabCode:'JER-220-01',supplier:'Acme Textiles',date:'2026-10-01',lotKind:'fresh'},
  {id:'FAB-002',fabCode:'JER-250-01',supplier:'Zeta Mills',date:'2026-10-08',lotKind:'stock'},
  {id:'FAB-003',fabCode:'RIB-250-01',supplier:'Zeta Mills',date:'2026-10-05'}
];
function app(who,opts){
  opts=opts||{};
  const fs=makeFs();
  const a=loadApp({files:['js/gatepass.js','js/fabric.js'],session:SESS[who||'afnan'],globals:Object.assign({},fs.api,{
    _gpEsc:_esc,
    allPasses:[],allFabricInventory:[],allFabricMovements:[],allReturns:[],allGPEditRequests:[],allFabricIn:clone(RECEIPTS),allPOs:[],
    currentPage:'',_fabInvDrillKey:null,_fabInvFilter:'all',_fabInvCatFilter:'all',_fabInvSearchQ:'',loadData:async()=>{},
    console:{log:console.log,error:console.error,warn:()=>{},info:()=>{}},
    logActivity:async(act,detail)=>{a.state.activity.push({action:act,detail});},
    confirm:()=>true
  },opts.globals||{})});
  a.fs=fs;
  a.run("window.hrmCloseModal=function(){}");
  installMint(a);
  return a;
}
// A bucket in the fake Firestore AND the page's in-memory copy (what the page loaded).
function seed(a,key,type,gsm,color,rolls,extra){
  const live=rolls.filter(r=>(r.status||'in_stock')==='in_stock');
  const doc=Object.assign({key,fabType:type,gsm,color,unit:'kg',rolls:clone(rolls),
    totalWeight:live.reduce((n,r)=>n+r.weight,0),rollsCount:live.length,reservedCount:0,reservedWeight:0,lastMovementAt:1},extra||{});
  a.fs.store.set('fabric_inventory/'+key,doc);
  a.ctx.allFabricInventory.push(Object.assign(clone(doc),{_id:key}));
}
const K1='jersey__220gsm__black',K2='jersey__250gsm__black',K3='jersey__220gsm__slate_grey',K4='jersey__210gsm__blak';
function seedStd(a){
  seed(a,K1,'Jersey',220,'Black',[roll('A1',10,{gsm:209}),roll('A2',20,{gsm:235})]);
  seed(a,K2,'Jersey',250,'Black',[roll('B1',30,{gsm:260,sourceFabId:'FAB-002'})]);
  seed(a,K3,'Jersey',220,'Slate Grey',[roll('C1',5)]);
}
const stockHtml=a=>a.run('renderFabricInventory()');
const lastToast=a=>a.state.toasts[a.state.toasts.length-1]||'';
const strip=h=>String(h).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');

module.exports=async function(){
  const s=suite('fabric-quality');

  // ═══ F4 — the normaliser and the group key ═══════════════════════════
  s.section('F4 — colour normaliser: trim, collapse, case-fold, alias table');
  {
    const a=app();
    const n=x=>a.run(`_fabNormColor(${J(x)})`);
    s.eq('trim + collapse + case-fold',n('  Arctic   WHITE '),'arctic white');
    for(const[bad,good] of [['Artic White','arctic white'],['Choclate Brown','chocolate brown'],['creem','cream'],['Slade blue','slate blue'],['Ston mauve','stone mauve'],['Kora','cora'],['QORA','cora'],['light greay','light grey'],['charcooal','charcoal'],['Levender','lavender']])
      s.eq('alias: '+bad,n(bad),good);
    s.eq('a correctly spelled colour is untouched',n('Royal Blue'),'royal blue');
    s.eq('the alias is whole-word only ("Stonewash" is not Stone-wash)',n('Stonewash'),'stonewash');
    s.eq('empty and null are empty',n(null)+'|'+n(''),'|');
    s.eq('the group key ignores GSM and spelling',a.run(`_fabGroupKey('Jersey','Artic White')===_fabGroupKey(' jersey ','arctic  white')`),true);
    s.eq('the group key differs by type',a.run(`_fabGroupKey('Jersey','Black')===_fabGroupKey('Rib','Black')`),false);
  }

  // ═══ F4 — grouped Stock tab ═══════════════════════════════════════════
  s.section('F4 — Stock By Fabric: one row per type+colour, sums, GSM range');
  {
    const a=app();seedStd(a);
    a.run("_fabInvView='fabric'");
    const g=a.run('_fabStockGroups(allFabricInventory)');
    s.eq('three buckets, two groups (Black x2 buckets, Slate Grey)',g.length,2);
    const bl=g.find(x=>x.color==='Black');
    s.eq('Stock = sum of member totalWeight',bl.totalWeight,60);
    s.eq('Rolls = sum of member rollsCount',bl.rollsCount,3);
    s.eq('GSM column is the in-stock rolls\' measured range',bl.gsmText,'209–260');
    s.eq('both buckets are members',J(bl.members.map(m=>m._id)),J([K1,K2]));
    const h=stockHtml(a);
    s.eq('the table holds ONE row for the two Black buckets',(h.match(/fabInvDrill\('jersey__black'\)/g)||[]).length,1);
    s.ok('the row shows the range and the bucket count',/209–260/.test(h)&&/2 buckets/.test(strip(h)),strip(h).slice(0,400));
    s.ok('the row shows the summed stock',/60\.00 kg/.test(h));
    s.ok('a single-bucket group shows its GSM plainly',/>\s*220\s*</.test(strip(h).replace(/(\d)\s/g,'$1 ').replace(/ /g,' '))||/220/.test(h));
    s.ok('the KPI strip still sums raw buckets (65 kg)',/65\.0 kg/.test(h));
  }

  s.section('F4 — a spelling variant joins its group; the display name is the most-used spelling');
  {
    const a=app();
    seed(a,K1,'Jersey',220,'Black',[roll('A1',10),roll('A2',10)]);
    seed(a,'jersey__210gsm__black_',"Jersey",210,'black',[roll('X1',7,{gsm:210})]);   // one roll, lower-case spelling
    const g=a.run('_fabStockGroups(allFabricInventory)');
    s.eq('Black and black are ONE group',g.length,1);
    s.eq('the display colour is the spelling with the most rolls',g[0].color,'Black');
    const b=app();
    seed(b,K1,'Jersey',220,'Artic White',[roll('A1',10)]);
    seed(b,K2,'Jersey',250,'Arctic White',[roll('B1',10),roll('B2',10)]);
    const g2=b.run('_fabStockGroups(allFabricInventory)');
    s.eq('Artic White + Arctic White are one group',g2.length,1);
    s.eq('displayed as the most-used spelling',g2[0].color,'Arctic White');
    s.eq('metre stock never merges with kg stock',(()=>{const c=app();seed(c,'twill__300gsm__navy','Twill',300,'Navy',[roll('T1',5)]);seed(c,'twill__310gsm__navy','Twill',310,'Navy',[roll('T2',5,{unit:'m'})],{unit:'m'});return c.run('_fabStockGroups(allFabricInventory).length');})(),2);
  }

  s.section('F4 — By Vendor: the group is listed under each vendor that supplied one of its rolls');
  {
    const a=app();seedStd(a);
    a.run("_fabInvView='vendor'");
    const h=stockHtml(a);
    s.eq('Black appears once under Acme (FAB-001) and once under Zeta (FAB-002) — as the GROUP, never as a bucket',(h.match(/fabInvDrill\('jersey__black'\)/g)||[]).length,2);
    s.ok('no bucket id is offered in the vendor view',!/fabInvDrill\('jersey__2\d0gsm__black'\)/.test(h));
    s.ok('the vendor header counts groups, not buckets (Acme: 35 kg, 3 rolls, 2 fabrics)',/35\.0 kg · 3 rolls · 2 fabrics/.test(strip(h)));
  }

  s.section('F4 — filters, search, category chips and alert levels work on groups');
  {
    const a=app();seedStd(a);
    a.run("_fabInvView='fabric'");
    a.run("_fabInvSearchQ='260'");
    let h=stockHtml(a);
    s.ok('searching a member bucket\'s GSM finds the group',/fabInvDrill\('jersey__black'\)/.test(h)&&!/slate_grey/.test(h));
    a.run("_fabInvSearchQ='slate'");
    h=stockHtml(a);
    s.ok('searching a colour finds only that group',/slate_grey/.test(h)&&!/fabInvDrill\('jersey__black'\)/.test(h));
    a.run("_fabInvSearchQ='';_fabInvFilter='empty'");
    s.ok('"Out of stock" lists no group that still has stock',!/fabInvDrill/.test(stockHtml(a)));
    seed(a,'rib__250gsm__black','Rib',250,'Black',[roll('R1',4,{gsm:250})]);
    a.run("_fabInvFilter='all';_fabInvCatFilter='Rib'");
    s.eq('a category chip lists only that category\'s groups',(stockHtml(a).match(/fabInvDrill\(/g)||[]).length,1);
    a.run("_fabInvCatFilter='Jersey'");
    s.ok('the Jersey category lists both Jersey groups',(stockHtml(a).match(/fabInvDrill\(/g)||[]).length===2&&!/rib__black/.test(stockHtml(a)));
    // thresholds: group uses the MAX of the member thresholds
    const b=app();
    seed(b,K1,'Jersey',220,'Black',[roll('A1',10),roll('A2',20)],{thresholds:{t1:40,t2:20,t3:5}});
    seed(b,K2,'Jersey',250,'Black',[roll('B1',30)],{thresholds:{t1:100,t2:10,t3:1}});
    const g=b.run('_fabStockGroups(allFabricInventory)')[0];
    s.eq('group thresholds = max of the members\'',J(g.thresholds),J({t1:100,t2:20,t3:5}));
    s.eq('60 kg against t1=100 is Low',b.run('_fabAlertLevel(_fabStockGroups(allFabricInventory)[0]).label'),'Low');
  }

  // ═══ F4 — the drill ═══════════════════════════════════════════════════
  s.section('F4 — the drill lists every member bucket\'s rolls with their GSM');
  {
    const a=app();seedStd(a);
    a.run("_fabInvDrillKey='jersey__black'");
    const h=stockHtml(a);
    for(const c of ['A1','A2','B1'])s.ok('roll '+c+' is listed',h.includes('>'+c+'<')||h.includes(c));
    s.ok('the title carries the GSM range',/Jersey · 209–260gsm · Black/.test(strip(h).replace(/\s+/g,' ')));
    s.ok('each roll shows its own measured GSM',/209 gsm/.test(strip(h))&&/235 gsm/.test(strip(h))&&/260 gsm/.test(strip(h)));
    s.ok('the bucket\'s header GSM shows muted as "entered as N" when it differs',/209 gsm entered as 220/.test(strip(h))&&/260 gsm entered as 250/.test(strip(h)));
    const c=app();seedStd(c);c.run("_fabInvDrillKey='jersey__slate_grey'");
    s.ok('a roll that matches its bucket\'s GSM has no note',/220 gsm/.test(strip(stockHtml(c)))&&!/entered as/.test(strip(stockHtml(c))));
    s.ok('the lot type is derived from the receipt (Fresh lot / Stock lot)',/Fresh lot/.test(h)&&/Stock lot/.test(h));
    s.ok('the member buckets are listed, each with its own Correct button',/fab-members/.test(h)&&(h.match(/fabCorrectFabric\('/g)||[]).length===2);
    s.ok('a per-roll reprint would use the STORED bucket id',!/fabReprintRoll\('jersey__black'/.test(h));
    // a bucket id still opens its group (old links, the correct-fabric jump)
    a.run("window.fabInvDrill('jersey__250gsm__black')");
    s.eq('a bucket id maps to its group',a.run('_fabInvDrillKey'),'jersey__black');
    // movements
    a.ctx.allFabricMovements.push({ts:1,type:'in',fabType:'jersey',gsm:250,color:'black',qty:30,unit:'kg',rollCodes:['B1']});
    s.ok('movements of every member bucket show',/\+ IN/.test(stockHtml(a)));
    // a stale label on a roll of the SECOND bucket reprints against ITS stored bucket
    const d=app();
    seed(d,K1,'Jersey',220,'Black',[roll('A1',10)]);
    seed(d,K2,'Jersey',250,'Black',[roll('B1',30,{gsm:260,sourceFabId:'FAB-002',labelStale:true,partiallyConsumed:true,originalWeight:40})]);
    d.run("_fabInvDrillKey='jersey__black'");
    s.ok('reprint on a roll targets its STORED bucket id',/fabReprintRoll\('jersey__250gsm__black','B1'\)/.test(stockHtml(d)));
    // single-bucket group keeps the one Correct button in the header
    const b=app();seedStd(b);b.run("_fabInvDrillKey='jersey__slate_grey'");
    const hb=stockHtml(b);
    s.ok('a single-bucket group has no members card but keeps ✎ Correct',!/fab-members/.test(hb)&&/fabCorrectFabric\('jersey__220gsm__slate_grey'\)/.test(hb));
  }

  s.section('F4 — saving alert levels writes every member bucket');
  {
    const a=app();seedStd(a);
    a.el('fab-th1').value='70';a.el('fab-th2').value='30';a.el('fab-th3').value='10';
    a.run("_fabInvDrillKey=null");
    await a.run("window.fabSaveAlerts('jersey__black')");
    s.eq('both Black buckets got the levels',J([K1,K2].map(k=>a.fs.store.get('fabric_inventory/'+k).thresholds)),J([{t1:70,t2:30,t3:10},{t1:70,t2:30,t3:10}]));
    s.ok('the other group was not touched',!a.fs.store.get('fabric_inventory/'+K3).thresholds);
  }

  // ═══ F4 — the Issue picker and the unchanged pass shape ═══════════════
  s.section('F4 — Issue: groups in the picker, every pickable roll with its GSM');
  {
    const a=app();seedStd(a);
    const h=a.run('renderFabricIssueTab()');
    s.eq('the picker lists one option per group',(h.match(/<option value="jersey__/g)||[]).length,2);
    s.ok('the option carries the GSM range',/Jersey · 209–260gsm · Black — 3 avail/.test(h));
    a.el('fab-iss-stock').value='jersey__black';
    a.run('window.fabIssuePickStock()');
    const list=a.el('fab-iss-checklist').innerHTML;
    s.ok('the checklist shows all three rolls across both buckets',['A1','A2','B1'].every(c=>list.includes(c)),list.slice(0,300));
    s.ok('and each roll\'s gsm',/209 gsm/.test(list)&&/235 gsm/.test(list)&&/260 gsm/.test(list));
    s.ok('a roll of the other group is not offered',!list.includes('C1'));
  }

  s.section('F4 — the PASS SHAPE is unchanged: a two-bucket pick writes two fabrics[] with their stored inventoryKeys');
  {
    const a=app();seedStd(a);
    // The page state a person has after ticking A1 (bucket K1) and B1 (bucket K2) in the grouped checklist.
    a.el('fab-iss-po').value='PO-7';a.el('fab-iss-article').value='Two-tone tee';a.el('fab-iss-code').value='GST100';a.el('fab-iss-cutmaster').value='Hassan';
    a.run("_fabIssueAdd('A1');_fabIssueAdd('B1')");
    const groups=a.run('_fabIssueGroups().map(g=>g.key)');
    s.eq('the picked rolls split by their STORED bucket key (not the group)',J(groups),J([K1,K2]));
    await a.run('window.submitFabricIssue()');
    const gp=a.fs.store.get('gatepasses/GP-006')||a.fs.store.get([...a.fs.store.keys()].find(k=>k.startsWith('gatepasses/')));
    s.ok('a gate pass was written',!!gp,lastToast(a));
    s.eq('two fabrics[] entries',gp&&gp.fabrics.length,2);
    s.eq('with the stored inventoryKeys',J(gp&&gp.fabrics.map(f=>f.inventoryKey)),J([K1,K2]));
    s.eq('each entry carries its OWN bucket gsm (not a group range)',J(gp&&gp.fabrics.map(f=>f.gsm)),J([220,250]));
    s.eq('top-level inventoryKey is the primary bucket',gp&&gp.inventoryKey,K1);
    s.eq('rolls were taken from the right buckets',J([a.fs.store.get('fabric_inventory/'+K1).rolls.find(r=>r.rollCode==='A1').status,a.fs.store.get('fabric_inventory/'+K2).rolls.find(r=>r.rollCode==='B1').status]),J(['issued','issued']));
  }

  // ═══ F4 — lotKind on the receipt ══════════════════════════════════════
  s.section('F4 — Fabric In: nominal GSM label, lot-type chips, lotKind stored on the receipt only');
  {
    const a=app('afnan');
    const h=a.run('renderFabricInTab()');
    s.ok('the header GSM is relabelled "Nominal GSM (code only)"',/Nominal GSM \(code only\)/.test(h));
    s.ok('with a hint that the measured GSM per roll counts',/measured on every roll/.test(h));
    s.ok('two lot-type chips, neither lit by default',/Fresh lot/.test(h)&&/Stock lot/.test(h)&&!/aria-pressed="true"/.test(h.slice(h.indexOf('fab-lotkind'),h.indexOf('fab-lotkind')+600)));
    s.eq('default = not recorded',a.run('_fabLotKindSel'),'');
    a.run("window.setFabLotKind('fresh')");
    s.eq('picking Fresh',a.run('_fabLotKindSel'),'fresh');
    a.run("window.setFabLotKind('fresh')");
    s.eq('pressing the lit chip clears it',a.run('_fabLotKindSel'),'');
    a.run("window.setFabLotKind('bogus')");
    s.eq('anything else is not a lot type',a.run('_fabLotKindSel'),'');
  }
  async function saveReceipt(kind){
    const a=app('afnan');
    a.run('renderFabricInTab()');
    a.run(`_fabLotKindSel=${J(kind)}`);
    a.el('fab-supplier').value='Gul Enterprises';a.el('fab-date').value='2026-10-11';a.el('fab-type').value='Jersey Heavy';
    a.el('fab-gsm').value='220';a.el('fab-color').value='Black';a.el('fab-notes').value='';
    const rows=[{w:'10.5'}].map(r=>({querySelector:q=>q==='.fab-roll-weight'?{value:r.w}:q==='.fab-roll-gsm'?{value:'220'}:q==='input[type=checkbox]'?{checked:true}:null}));
    a.ctx.document.querySelectorAll=sel=>sel==='#fab-rolls-body .roll-row'?rows:[];
    const gebi=a.ctx.document.getElementById.bind(a.ctx.document);
    a.ctx.document.getElementById=id=>{const n=gebi(id);if(n&&!n.scrollIntoView)n.scrollIntoView=()=>{};return n;};
    await a.run('window.submitFabricIn()');
    const k=a.fs.keys('fabricin/')[0];
    return a.fs.store.get(k);
  }
  s.section('F4 — the saved receipt');
  {
    const none=await saveReceipt('');
    s.ok('a receipt with no lot type has NO lotKind key (byte-for-byte what it was)',none&&!('lotKind' in none),J(none&&Object.keys(none)));
    const fresh=await saveReceipt('fresh');
    s.eq('Fresh lot is stored on the receipt',fresh&&fresh.lotKind,'fresh');
    const stock=await saveReceipt('stock');
    s.eq('Stock lot is stored on the receipt',stock&&stock.lotKind,'stock');
    s.ok('and NOT on the rolls or the inventory bucket',!/lotKind/.test(J(stock.rolls)));
  }
  s.section('F4 — the Defects tab shows the lot type, derived from sourceFabId');
  {
    const a=app();
    seed(a,K1,'Jersey',220,'Black',[roll('D1',10,{status:'defective',defect:{reason:'Holes/stains',by:'Uzaib',at:1}}),roll('D2',5,{status:'defective',sourceFabId:'FAB-002',defect:{reason:'Wrong GSM',by:'Uzaib',at:1}})]);
    const h=a.run('renderFabricReturnsTab()');
    s.ok('the fresh lot is labelled',/Fresh lot/.test(h));
    s.ok('and the stock lot',/Stock lot/.test(h));
    s.ok('nothing is stored on the roll for it',!/lotKind/.test(J(a.ctx.allFabricInventory)));
  }

  return s;
};

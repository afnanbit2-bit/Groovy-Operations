/* Inventory Intel ▸ Article Explorer v2 (30 Sept 2026): trust banner and confidence, metric fixes, classes v2,
   Overview, verdict-first article page. Every expected value below is computed BY HAND in a comment next to it.
   The "break" section mutates js/shopify.js, reloads it and requires the named check to FAIL, so each rule bites. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/shopify.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'css/main.css'),'utf8');

function load(src){
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const mk=a=>{
  const day=n=>a.run('_siPktDate('+(-n)+')');
  const at=n=>day(n)+'T12:00:00+05:00';
  // L(code, qty, daysAgo, extra): one paid line item
  const L=(code,q,ago,x)=>Object.assign({sku:code+'-M',quantity:q,price:1000,order_created_at:at(ago),financial_status:'paid'},x||{});
  return{day,at,L};
};
// ── Step 1 fixture. Counted window of an article that sold within 7 days of the first order = from the data start
// (GA's first sale, 99 days ago) to today = 100 days.
function seed1(a,o){
  o=o||{};const {L}=mk(a);const st=o.synced?{status_synced_at:'2026-09-30T00:00:00Z'}:{};
  const lines=[];
  [99,80,60,30,5].forEach(d=>lines.push(L('GA',1,d)));                              // GA: 5 units, 100 days -> Low
  [99,90,80,70,60,50,40,30,20,10,5,2].forEach(d=>lines.push(L('GB',1,d)));          // GB: 12 units, 100 days -> Medium
  [99,90,80,70,60,50,40,30,20,10].forEach(d=>lines.push(L('GC',3,d)));              // GC: 30 units, 100 days -> High (capped)
  for(let d=20;d>=1;d--)lines.push(L('GD',2,d));                                     // GD: 40 units but first sale 20 days ago -> 21 days -> Low
  [99,90,80,70,60,50,40,30,20].forEach(d=>lines.push(L('GE',3,d)));lines.push(L('GE',1,5));lines.push(L('GE',1,4)); // GE: 27+2 = 29 units -> Medium
  for(let i=0;i<10;i++)lines.push(L('GF',1,27-i*2));                                 // GF: 10 units, first sale 27 days ago -> E is 27 days ago => 28 days -> Medium (boundary)
  for(let i=0;i<9;i++)lines.push(L('GG',1,27-i*2));                                  // GG: 9 units, 28 days -> Low (units boundary)
  for(let i=0;i<10;i++)lines.push(L('GH',1,26-i*2));                                 // GH: 10 units, 27 days -> Low (days boundary)
  for(let i=0;i<10;i++)lines.push(L('GI',3,39-i*4));                                 // GI: 30 units, first sale 39 days ago -> 40 days -> Medium (High needs 56 days)
  a.run('_siProducts=[];_siOrders=[];_siWeeklyCloses=[];_siSnapshot={items:{}};_siLineItems='+J(lines.map(l=>Object.assign(l,st))));
}
function seedReturns(a){
  const {L}=mk(a);const st={status_synced_at:'2026-09-30T00:00:00Z',refunded_at:null};
  a.run('_siProducts=[];_siOrders=[];_siWeeklyCloses=[];_siSnapshot={items:{}};_siLineItems='+J([
    L('GA',1,99),                                                                  // anchors the data start, 1 unit
    L('GR',1,99),                                                                  // no return fields at all: counts 1
    L('GR',5,10,Object.assign({refunded_quantity:2},st)),                          // 5 sold, 2 came back: net 3, refunded 2
    L('GR',2,9,Object.assign({refunded_quantity:2},st)),                           // all 2 came back: line leaves, refunded 2
    L('GR',4,8,Object.assign({refunded_quantity:9},st))                            // "9 returned" of 4: capped at 4, line leaves, refunded 4
  ]));
}

// Every rule as a named boolean, so a mutant can be required to flip exactly one.
function checks(a){
  const R=c=>a.run(c),out={};
  // ── 1. Trust banner
  seed1(a);
  out['no banner while returns are unsynced (owner request)']=R('_siAxTrustBanner()')===''&&!/Recent sales are before later returns|class="si-ax-trust/.test(R('_siArticleExplorerSection()'));
  out['quiet grey note in Data quality, not an amber box']=(()=>{const h=R('_siCleanQualityHtml(_siAxIndex().quality)');return /Returns not yet synced/.test(h)&&!/si-ax-trust|amber|<strong>Recent sales/.test(h);})();
  out['unsynced by default (missing fields = unsynced)']=R('_siAxIndex().quality.returns.synced')===false;
  seed1(a,{synced:true});
  out['synced: the ok note shows and the quiet note is gone']=/Returns are synced/.test(R('_siAxTrustBanner()'))&&!/Returns not yet synced/.test(R('_siCleanQualityHtml(_siAxIndex().quality)'));
  out['stamped lines count as synced']=R('_siAxIndex().quality.returns.synced')===true;
  // 95% of the last 60 days: 20 recent lines, 19 stamped -> synced; 18 stamped -> not
  const share=k=>{const {L}=mk(a);const ls=[];for(let i=0;i<20;i++)ls.push(L('GZ',1,5+i,i<k?{status_synced_at:'x'}:{}));a.run('_siProducts=[];_siOrders=[];_siWeeklyCloses=[];_siSnapshot={items:{}};_siLineItems='+J(ls));return R('_siAxIndex().quality.returns.synced');};
  out['19 of 20 recent lines stamped = synced (95%)']=share(19)===true;
  out['18 of 20 recent lines stamped = not synced']=share(18)===false;
  // old lines do not count toward the share
  {const {L}=mk(a);const ls=[L('GZ',1,200),L('GZ',1,190),L('GZ',1,5,{status_synced_at:'x'})];a.run('_siLineItems='+J(ls));a.run('_siAxCache=null');out['only the last 60 days decide']=R('_siAxIndex().quality.returns.synced')===true;}
  // ── returns reduce net units
  seedReturns(a);
  const gr=R('(()=>{const a=_siAxIndex().map.get("GR");const m=_siAxStats(a);return{u:a.units,rf:m.refunded,ru:_siAxIndex().quality.returns.units,lines:_siAxIndex().quality.returns.lines}})()');
  out['net units = 1 + (5-2) = 4']=gr.u===4;
  out['refunded units = 2 + 2 + 4 = 8']=gr.rf===8&&gr.ru===8;
  out['a line returned in full leaves the counted lines (2 lines)']=gr.lines===2;
  out['revenue follows net quantity (4 x 1000)']=R('_siAxIndex().map.get("GR").rev')===4000;
  // ── 2. Confidence
  seed1(a);
  const cf=c=>R('(()=>{const c=_siAxConfidence(_siAxIndex().map.get("'+c+'"));return c.level+"|"+c.lvl+"|"+c.dots+"|"+c.caps.length})()');
  out['5 units / 100 days = Low, one dot']=cf('GA')==='low|0|1|0';
  out['12 units / 100 days = Medium']=cf('GB').startsWith('medium|1|2');
  out['30 units / 100 days unsynced is capped at Medium with 2 reasons']=cf('GC')==='medium|1|2|2';
  out['40 units but 21 days = Low']=cf('GD').startsWith('low');
  out['29 units = Medium, not High']=cf('GE').startsWith('medium');
  out['10 units / 28 days = Medium (boundary)']=cf('GF').startsWith('medium');
  out['9 units / 28 days = Low']=cf('GG').startsWith('low');
  out['10 units / 27 days = Low']=cf('GH').startsWith('low');
  seed1(a,{synced:true});
  out['synced returns but default lead time still caps High at Medium']=cf('GC')==='medium|1|2|1';
  R('_SI_AX_CFG.leadTimeSet=true');
  out['synced returns and a real lead time allow High (3 dots)']=cf('GC')==='high|2|3|0';
  out['30 units but only 40 days is Medium even uncapped']=cf('GI').startsWith('medium');
  out['29 units is never High even when uncapped']=cf('GE').startsWith('medium');
  out['Low never becomes High by uncapping']=cf('GA').startsWith('low');
  seed1(a);R('_SI_AX_CFG.leadTimeSet=false');
  const pz=R('_siAxPoisson(5)');
  out['Poisson interval for 5 is 1.61 to 11.67']=Math.abs(pz.lo-1.61)<0.01&&Math.abs(pz.hi-11.67)<0.01;
  out['Poisson interval for 0 starts at 0']=R('_siAxPoisson(0).lo')===0&&Math.abs(R('_siAxPoisson(0).hi')-3.67)<0.02;
  // 5 units / 100 days: lo 1.61/100*7=0.11 -> 0, hi 11.67/100*7=0.82 -> 1
  out['Low range in words (0 to 1 a week)']=R('_siAxConfidence(_siAxIndex().map.get("GA")).range')==='could be anywhere from 0 to 1 a week';
  out['Medium has no range text']=R('_siAxConfidence(_siAxIndex().map.get("GB")).range')==='';
  out['chip shows word and dots']=/Low confidence/.test(R('_siAxConfChip(_siAxConfidence(_siAxIndex().map.get("GA")))'))&&(R('_siAxConfChip(_siAxConfidence(_siAxIndex().map.get("GC")))').match(/class="on"/g)||[]).length===2;
  out['Low card says too early to tell']=/Too early to tell/.test(R('_siAxReadCard({a:_siAxIndex().map.get("GA"),m:_siAxStats(_siAxIndex().map.get("GA")),c:_siAxClassify(_siAxIndex().map.get("GA"))},0)'));
  return out;
}

module.exports=async function(){
  const s=suite('shopify-explorer-v2');
  const base=checks(load(SRC));
  s.section('step 1 — trust banner, returns, confidence');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));

  s.section('deliberate breaks — each must fail the named check');
  const brk=(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=checks(load(SRC.split(from).join(to)));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true));
  };
  brk('returns never count as synced','q.returns.recentStamped/q.returns.recentTotal>=_SI_AX_CFG.returnsSyncedShare','false',['synced: the ok note shows and the quiet note is gone','stamped lines count as synced']);
  brk('synced share 50%','_SI_AX_CFG.returnsSyncedShare;','0.5;',['18 of 20 recent lines stamped = not synced']);
  brk('refunded_quantity ignored','if(isFinite(qty)&&isFinite(rq)&&rq>0){','if(false){',['net units = 1 + (5-2) = 4','refunded units = 2 + 2 + 4 = 8']);
  brk('return not capped at the line quantity','const cut=Math.min(rq,qty);','const cut=rq;',['refunded units = 2 + 2 + 4 = 8']);
  brk('High without the caps','const capped=lvl===2&&caps.length>0;','const capped=false;',['30 units / 100 days unsynced is capped at Medium with 2 reasons','synced returns but default lead time still caps High at Medium']);
  brk('Low boundary on units','units<C.lowUnits','units<=C.lowUnits',['10 units / 28 days = Medium (boundary)']);
  brk('High ignores the 56-day floor','units>=C.highUnits&&days>=C.highDays','units>=C.highUnits',['30 units but only 40 days is Medium even uncapped']);
  brk('banner restored','return\'\';// owner\'s call (1 Oct 2026)','return\'<div class="si-ax-trust">Recent sales are before later returns</div>\';//',['no banner while returns are unsynced (owner request)']);
  brk('quiet note dropped','(q.returns&&!q.returns.synced)?','false&&',['quiet grey note in Data quality, not an amber box']);
  brk('only last 60 days: all lines count','if(day>=retCut){q.returns.recentTotal++','if(true){q.returns.recentTotal++',['only the last 60 days decide']);
  return s;
};

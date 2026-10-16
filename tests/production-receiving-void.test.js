/* Packing ▸ Receiving history: how a QC-lot VOID reads (QC risk R4, 16 Oct 2026).

   js/ph-qc-write.js `phQcVoidLot` appends NEGATIVE counter entries to pos.packingReceipts
   ({id:'QV-<lot>-<size>', receiptId:'QV-<lot>', size, qty:-n, src:'qc', voidOf:<lot id>}) so the signed sums stay true.
   The old Packing screen (js/production.js `_renderPackDetail`) printed those as "S×-10". It now prints
   "Voided QC lot — S −10" (a real minus sign) and a "−10 pcs" group total.

   This drives the REAL js/shared.js, auth.js, pos.js, gatepass.js (for poReceivedBySize / poFullyReceived / _gpEsc) and
   js/production.js, rendering `_renderPackDetail` over hand-computed fixtures. It asserts the exact text AND that nothing is
   double counted: the Received column, the received figure on the bar and the sum of the history group totals are all the
   same signed sum.
   What it does NOT prove: layout (nothing here measures the screen), a real browser, real Firestore, the other readers of
   packingReceipts (js/pos.js, js/production.js QC/Barcode, js/ph-mod-afloat.js, js/ph-write.js — read, not changed). */
'use strict';
const fs=require('fs'),path=require('path');
const harness=require('./harness');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const PROD=fs.readFileSync(path.join(ROOT,'js/production.js'),'utf8');
const LS={getItem:()=>null,setItem(){},removeItem(){}};
const J=JSON.stringify;
const MINUS='−';

const CUT={S:20,M:40,L:40};
const po=(rcpts,o)=>Object.assign({fbKey:'k1',id:'PO-1',name:'Tee',code:'G1',cutQty:Object.assign({},CUT),packingReceipts:rcpts},o||{});
// hand-built entries, in the shapes the writers produce
const legacy=(rid,size,qty,ts)=>({id:rid+'-'+size,receiptId:rid,size,qty,ts,by:'Faizan'});
const lot=(lid,size,qty,ts)=>({id:'QL-'+lid+'-'+size,receiptId:lid,size,qty,ts,by:'Haris',src:'qc'});
const voidE=(lid,size,qty,ts)=>({id:'QV-'+lid+'-'+size,receiptId:'QV-'+lid,size,qty:-qty,ts,by:'Haris',src:'qc',voidOf:lid});

const D1='2026-10-01T10:00:00.000Z',D2='2026-10-02T10:00:00.000Z',D3='2026-10-03T10:00:00.000Z',D4='2026-10-04T10:00:00.000Z';

// Fixtures: name -> {po, hand-computed expectations}
const FX={
  // A. a normal (old Packing) receipt: S 5, M 10
  normal:{po:po([legacy('RCV-1','S',5,D1),legacy('RCV-1','M',10,D1)]),
    recv:{S:5,M:10,L:0},barRecv:15,groups:[15],texts:['S×5 · M×10']},
  // B. a QC lot S10 M20 and its void (S −10, M −20): net zero
  lotVoid:{po:po([lot('L1','S',10,D1),lot('L1','M',20,D1),voidE('L1','S',10,D2),voidE('L1','M',20,D2)]),
    recv:{S:0,M:0,L:0},barRecv:0,groups:[-30,30],texts:['Voided QC lot — S −10 · M −20','S×10 · M×20'],entries:4},
  // C. a legacy receipt only (no src, no voidOf)
  legacyOnly:{po:po([legacy('RCV-7','L',12,D1)]),
    recv:{S:0,M:0,L:12},barRecv:12,groups:[12],texts:['L×12']},
  // D. mixed: legacy S5; lot L1 S10; void of L1; lot L2 S4 M6.  S = 5+10-10+4 = 9, M = 6
  mixed:{po:po([legacy('RCV-1','S',5,D1),lot('L1','S',10,D2),voidE('L1','S',10,D3),lot('L2','S',4,D4),lot('L2','M',6,D4)]),
    recv:{S:9,M:6,L:0},barRecv:15,groups:[10,-10,10,5],texts:['S×4 · M×6','Voided QC lot — S −10','S×10','S×5'],entries:5},
  // E. a void recognised by voidOf alone (no src), and one by src:'qc' + negative qty alone (no voidOf)
  voidOfOnly:{po:po([legacy('RCV-1','S',10,D1),{id:'x1',receiptId:'V1',size:'S',qty:-4,ts:D2,by:'Haris',voidOf:'LX'}]),
    recv:{S:6,M:0,L:0},barRecv:6,groups:[-4,10],texts:['Voided QC lot — S −4','S×10']},
  qcNegOnly:{po:po([legacy('RCV-1','S',10,D1),{id:'x2',receiptId:'V2',size:'S',qty:-3,ts:D2,by:'Haris',src:'qc'}]),
    recv:{S:7,M:0,L:0},barRecv:7,groups:[-3,10],texts:['Voided QC lot — S −3','S×10']},
  // F. a hand-made group holding BOTH a normal and a void entry: no group prefix, the void entry still reads as one
  mixedGroup:{po:po([{id:'a',receiptId:'G',size:'S',qty:5,ts:D1,by:'X'},{id:'b',receiptId:'G',size:'M',qty:-3,ts:D1,by:'X',src:'qc',voidOf:'LZ'}]),
    recv:{S:5,M:-3,L:0},barRecv:2,groups:[2],texts:['S×5 · M −3']},
  // G. a negative entry that is NOT a QC void (no src, no voidOf): wording unchanged ("S×-3"), the sum still counts it
  plainNeg:{po:po([legacy('RCV-1','S',10,D1),{id:'n',receiptId:'RCV-2',size:'S',qty:-3,ts:D2,by:'Faizan'}]),
    recv:{S:7,M:0,L:0},barRecv:7,groups:[-3,10],texts:['S×-3','S×10']},
  // H. hostile size on a void entry is escaped
  hostile:{po:po([voidE('LH','<img src=x onerror=1>',2,D1)],{cutQty:{S:20}}),
    recv:null,barRecv:null,groups:[-2],texts:['Voided QC lot — &lt;img src=x onerror=1&gt; −2']}
};

function build(src){
  const a=harness.loadApp({files:['js/shared.js','js/auth.js','js/pos.js','js/gatepass.js'],globals:{localStorage:LS}});
  a.run('session='+J({u:'afnan',name:'Afnan',role:'owner'}));
  a.run(src);
  return a;
}
// -> {html, groups:[numbers in render order], texts:[strings], recvCells:{size:n}, barRecv, entries}
function observe(a,p){
  a.run('globalThis.__po='+J(p));
  const html=a.run('_renderPackDetail(__po)');
  const flat=html.replace(/\s+/g,' ');
  const groups=[],texts=[];
  const re=/<span style="font-weight:700">(−?\d+) pcs<\/span>[\s\S]*?<div style="font-size:13px;color:var\(--muted\);margin-top:3px">([^<]*)<\/div>/g;
  let m;while((m=re.exec(html))){groups.push(+m[1].replace(MINUS,'-'));texts.push(m[2]);}
  const recvCells={};
  const rr=/<td style="padding:9px 8px;font-weight:700">([^<]+)<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td style="padding:9px 8px;text-align:center;color:#2563eb;font-weight:600">(-?\d+)<\/td>/g;
  while((m=rr.exec(html)))recvCells[m[1]]=+m[2];
  const bar=/received <b style="color:#2563eb">(-?\d+)<\/b>/.exec(flat);
  const ent=/(\d+) entr(?:y|ies)<\/span>/.exec(flat);
  return {html,groups,texts,recvCells,barRecv:bar?+bar[1]:null,entries:ent?+ent[1]:null};
}

const sum=a=>a.reduce((x,y)=>x+y,0);

// All the named observations, one place, so the revert checks can reuse them.
function checks(src){
  const a=build(src),o={};
  for(const k of Object.keys(FX))o[k]=observe(a,FX[k].po);
  o.api=a.run('({recvLotVoid:poReceivedBySize('+J(FX.lotVoid.po)+'),recvMixed:poReceivedBySize('+J(FX.mixed.po)+'),totMixed:poReceivedTotal('+J(FX.mixed.po)+')})');
  return o;
}

module.exports=async function(){
  const s=suite('production-receiving-void');
  const base=checks(PROD);

  s.section('exact text of the history (hand-computed)');
  for(const k of ['normal','lotVoid','legacyOnly','mixed','voidOfOnly','qcNegOnly','mixedGroup','plainNeg','hostile']){
    const f=FX[k],o=base[k];
    s.eq(k+': history texts, newest first',J(o.texts),J(f.texts));
    s.eq(k+': group totals, newest first',J(o.groups),J(f.groups));
  }
  s.ok('a void group header carries a real minus sign: "'+MINUS+'30 pcs"',base.lotVoid.html.indexOf('>'+MINUS+'30 pcs<')>-1);
  s.ok('the old confusing wording "S×-10" is gone for a QC void',!/S×-10/.test(base.lotVoid.html));
  s.ok('a hyphen-minus never appears in a void group header',!/>-\d+ pcs</.test(base.lotVoid.html));
  s.ok('the lot itself still reads "S×10 · M×20" with a "30 pcs" header',base.lotVoid.html.indexOf('>30 pcs<')>-1&&base.lotVoid.texts.indexOf('S×10 · M×20')>-1);
  s.ok('a normal receipt is rendered exactly as before ("15 pcs", "S×5 · M×10", no "Voided")',base.normal.groups[0]===15&&base.normal.texts[0]==='S×5 · M×10'&&!/Voided/.test(base.normal.html));
  s.ok('a legacy receipt is rendered exactly as before ("12 pcs", "L×12")',base.legacyOnly.texts[0]==='L×12'&&!/Voided/.test(base.legacyOnly.html));
  s.ok('a negative entry that is NOT a QC void keeps its old wording ("S×-3")',base.plainNeg.texts.indexOf('S×-3')>-1&&!/Voided/.test(base.plainNeg.html));
  s.ok('a hand-made group mixing a normal and a void entry gets no "Voided QC lot" prefix',!/Voided QC lot/.test(base.mixedGroup.html)&&base.mixedGroup.texts[0]==='S×5 · M −3');

  s.section('totals add correctly and are not double counted');
  for(const k of ['normal','lotVoid','legacyOnly','mixed','voidOfOnly','qcNegOnly','mixedGroup','plainNeg']){
    const f=FX[k],o=base[k];
    s.eq(k+': Received column per size (S, M, L)',J(o.recvCells),J(f.recv));
    s.eq(k+': received figure on the bar',o.barRecv,f.barRecv);
    s.eq(k+': the sum of the history group totals equals the bar (one signed sum, nothing counted twice)',sum(o.groups),f.barRecv);
    if(f.entries)s.eq(k+': "N entries" counts stored entries',o.entries,f.entries);
  }
  s.eq('a lot and its void net to zero received (S)',base.lotVoid.recvCells.S,0);
  s.eq('a lot and its void net to zero received (M)',base.lotVoid.recvCells.M,0);
  s.eq('mixed: Received S = 5 + 10 − 10 + 4',base.mixed.recvCells.S,9);
  s.eq('mixed: pending S shows cut 20 − 9 = 11 on the row (input max)',/id="pack-in-S" type="number" min="0" max="11"/.test(base.mixed.html),true);
  s.eq('poReceivedBySize(lot + void) is zero per size (the reader pos.js uses)',J(base.api.recvLotVoid),J({S:0,M:0}));
  s.eq('poReceivedBySize(mixed)',J(base.api.recvMixed),J({S:9,M:6}));
  s.eq('poReceivedTotal(mixed)',base.api.totMixed,15);

  s.section('breaks: each rule reverted once must fail its named check');
  const mut=(t,x,y)=>{if(t.indexOf(x)<0)throw new Error('break target missing: '+x.slice(0,70));return t.split(x).join(y);};
  const brk=(label,expectLabel,src,pred)=>{
    let r;try{r=pred(checks(src));}catch(e){r='threw: '+e.message;}
    s.ok('break "'+label+'" fails "'+expectLabel+'"',r===false);
  };
  const voidReads=o=>o.lotVoid.texts[0]==='Voided QC lot — S −10 · M −20';
  brk('void detection always false','the void wording',
    mut(PROD,"function _packIsVoid(e){return !!e&&(!!e.voidOf||(e.src==='qc'&&(Number(e.qty)||0)<0));}","function _packIsVoid(e){return false;}"),voidReads);
  brk('no "Voided QC lot —" group prefix','the void wording',
    mut(PROD,"'Voided QC lot — '+txt","txt"),voidReads);
  brk('hyphen-minus instead of the real minus','a real minus sign',
    mut(PROD,"'\\u2212'+(-n)","'-'+(-n)"),o=>o.lotVoid.texts[0]==='Voided QC lot — S −10 · M −20'&&o.lotVoid.groups[0]===-30&&o.lotVoid.html.indexOf('>'+MINUS+'30 pcs<')>-1);
  brk('void header total made positive (Math.abs)','group totals sum to the bar',
    mut(PROD,"const tot=g.items.reduce((a,e)=>a+(Number(e.qty)||0),0);","const tot=g.items.reduce((a,e)=>a+Math.abs(Number(e.qty)||0),0);"),
    o=>sum(o.lotVoid.groups)===0&&sum(o.mixed.groups)===15);
  brk('void entries left out of the group total','group totals sum to the bar',
    mut(PROD,"const tot=g.items.reduce((a,e)=>a+(Number(e.qty)||0),0);","const tot=g.items.filter(e=>!(Number(e.qty)<0)).reduce((a,e)=>a+(Number(e.qty)||0),0);"),
    o=>sum(o.lotVoid.groups)===0&&sum(o.mixed.groups)===15);
  brk('size not escaped on a void entry','the hostile size is escaped',
    mut(PROD,"`${_gpEsc(e.size)} ${_packSigned(e.qty)}`","`${e.size} ${_packSigned(e.qty)}`"),
    o=>o.hostile.texts[0]==='Voided QC lot — &lt;img src=x onerror=1&gt; −2'&&o.hostile.html.indexOf('<img src=x')<0);
  brk('prefix when SOME (not every) entry is a void','a mixed group gets no prefix',
    mut(PROD,"items.every(_packIsVoid)","items.some(_packIsVoid)"),
    o=>o.mixedGroup.texts[0]==='S×5 · M −3');
  brk('voidOf no longer recognised','a void with voidOf only',
    mut(PROD,"(!!e.voidOf||(e.src==='qc'&&(Number(e.qty)||0)<0))","(e.src==='qc'&&(Number(e.qty)||0)<0)"),
    o=>o.voidOfOnly.texts[0]==='Voided QC lot — S −4');
  brk('every negative entry treated as a QC void','a non-QC negative keeps its wording',
    mut(PROD,"(!!e.voidOf||(e.src==='qc'&&(Number(e.qty)||0)<0))","((Number(e.qty)||0)<0)"),
    o=>o.plainNeg.texts.indexOf('S×-3')>-1);
  brk('void entries skipped in the history list','all entries are listed',
    mut(PROD,"receipts.forEach(e=>{(groups[e.receiptId]","receipts.filter(e=>!e.voidOf).forEach(e=>{(groups[e.receiptId]"),
    o=>o.lotVoid.texts.length===2);

  return s;
};

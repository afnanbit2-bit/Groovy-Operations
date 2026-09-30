/* ─────────────────────────────────────────────────────────────────────────
   netlify/functions/shopify-article-rollup-background.js (+ the -now wrapper)
   — the server-side article rollup for Inventory Intel (plan 10, P0).

   Everything runs against an in-memory Firestore and hand-made fixtures; the
   live Shopify store and Firestore are never touched. Expected values are
   worked out BY HAND in the comments of FIXTURE (today = Wed 30 Sep 2026,
   12:00 PKT; the first counted sale is 25 Sep, so 25 Sep 2026 is day-of-year
   index 267: Jan 31 + Feb 28 + Mar 31 + Apr 30 + May 31 + Jun 30 + Jul 31 +
   Aug 31 = 243 days before 1 Sep, + 25 = the 268th day, index 267).

   What is held: the cleaning rules (voided / refunded / partial refund / tip /
   no-SKU / duplicate SKU / swapped and numeric sizes / negative stock), the
   timing shift (a snapshot before 18:00 PKT is the previous day's close), a
   collision, a partial snapshot, inferred receipts with the max(5, 10%) floor,
   stock-outs, history that starts part-way (null, never zero), the per-size
   arrays, the summary numbers, an idempotent rerun, a nightly recompute that
   picks up a changed status and writes ONLY what changed, the 1 MiB guard, the
   shadow compare (and that it catches a tampered doc), the owner gate on the
   -now wrapper, the schedule and the three rules blocks.
   Cannot prove: that the live line items / snapshots look like these, the
   Netlify run time on 51k rows, or what the Console has published.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {suite,ROOT}=require('./harness');
const {makeAdmin,loadFn,TOKENS,FAKE_SA,withEnv}=require('./ma-fake-admin');
const R=require('../netlify/functions/shopify-article-rollup-background.js');
const J=v=>JSON.stringify(v);
const clone=v=>JSON.parse(J(v));

// ── a small in-memory Firestore with where(>=, ==) and batches ───────────
function makeDb(docs){
  const state={docs:docs||{},writes:[],batches:[],reads:0};
  const guard=(d,p)=>{if(d===undefined)throw new Error('undefined in '+p);if(d&&typeof d==='object')for(const k of Object.keys(d))guard(d[k],p+'.'+k);};
  const ref=(col,id)=>({id,path:col+'/'+id,
    async get(){state.reads++;const d=state.docs[col+'/'+id];return{id,exists:!!d,data:()=>clone(d)};},
    async set(data){guard(data,col+'/'+id);state.docs[col+'/'+id]=clone(data);state.writes.push(col+'/'+id);}});
  const query=(col,filters)=>({
    where(f,op,v){return query(col,filters.concat([[f,op,v]]));},
    async get(){
      const out=Object.keys(state.docs).filter(k=>k.indexOf(col+'/')===0).map(k=>({id:k.slice(col.length+1),d:state.docs[k]}))
        .filter(x=>filters.every(([f,op,v])=>op==='>='?x.d[f]>=v:x.d[f]===v));
      state.reads+=out.length;
      const snaps=out.map(x=>({id:x.id,data:()=>clone(x.d)}));
      return{docs:snaps,size:snaps.length,forEach:cb=>snaps.forEach(cb)};
    }});
  const db={collection(col){const q=query(col,[]);return Object.assign(q,{doc:id=>ref(col,id)});},
    batch(){const ops=[];return{set(r,d){ops.push([r,d]);},async commit(){state.batches.push(ops.length);for(const [r,d] of ops)await r.set(d);}};}};
  return{db,state};
}

// ── FIXTURE ──────────────────────────────────────────────────────────────
const NOW=Date.UTC(2026,8,30,7,0,0);            // 30 Sep 2026 12:00 PKT
const TODAY='2026-09-30';
const I=267;                                    // day-of-year index of 2026-09-25
const P=(sku,color,size,extra)=>Object.assign({sku,product_title:'T '+sku.split('-')[0],color,size,product_type:'Tee'},extra||{});
const PRODUCTS=[
  P('GST001-S','Black','S',{published_at:'2026-09-05T09:00:00+05:00',created_at:'2026-09-01T09:00:00+05:00'}),
  P('GST001-M','Black','M',{published_at:'2026-09-05T09:00:00+05:00'}),
  P('GST001-M','Black','M'),                                    // duplicate SKU (a second variant row)
  P('GST001-L','Black','L'),
  P('GD007-28','28','',{product_type:'Denim',created_at:'2026-08-20T00:00:00+05:00'}),   // waist in the colour option
  P('GD007-30','30','',{product_type:'Denim'}),
  P('GSW001-M','M','Olive',{product_type:'Sweat'}),             // options swapped
  P('GHW001','Green','',{product_type:'Cap'}),
  P('GBIG001-M','Red','M')
];
const L=(day,sku,qty,price,status,extra)=>Object.assign({sku,quantity:qty,price,order_created_at:day+'T14:00:00+05:00',financial_status:status||'paid'},extra||{});
const LINES=[
  L('2026-09-25','GST001-S',2,1000),L('2026-09-25','GST001-S',1,1000),      // duplicate SKU, same day: S = 3
  L('2026-09-25','GST001-M',1,1000),
  L('2026-09-26','GST001-M',3,1000,'voided'),                               // voided 3
  L('2026-09-26','GST001-L',2,1000,'refunded'),                             // refunded 2
  L('2026-09-27','GST001-M',4,1000,'partially_refunded',{refunded_quantity:1}), // net 3, refunded 1
  L('2026-09-27','GST001-S',1,1000),
  L('2026-09-25','TIP',1,0.01),                                             // tip: non-merchandise
  L('2026-09-25','',2,500),L('2026-09-26','NO-SKU',3,500),                  // no SKU
  L('2026-09-28','GD007-28',2,3000),
  L('2026-09-29','GSW001-M',1,2000)
];
const at=(day,h)=>day+'T'+h+':00:00+05:00';
const SNAPS=[
  // 10:00 PKT on 26 Sep = the CLOSE of 25 Sep. Negative L clamped, M has a duplicate entry (8+2), one entry has no SKU.
  {id:'2026-09-26',data:{date:'2026-09-26',snapshot_at:at('2026-09-26','10'),items:{
    a:{sku:'GST001-S',available:10},b:{sku:'GST001-M',available:8},c:{sku:'GST001-L',available:-3},d:{sku:'GD007-28',available:5},
    e:{sku:'GD007-30',available:5},f:{sku:'GST001-M',available:2},g:{sku:'GSW001-M',available:4},h:{sku:'',available:3},
    i:{sku:'GHW001',available:2},j:{sku:'GBIG001-M',available:100}}}},
  // 22:00 on 25 Sep also = close of 25 Sep; the LATER snapshot (A) wins, this one is discarded
  {id:'2026-09-25',data:{date:'2026-09-25',variant_count:10,snapshot_at:at('2026-09-25','22'),items:{a:{sku:'GST001-S',available:99}}}},
  // 22:00 27 Sep = close of 27 Sep. GST001 restocked (L 0 -> 15)
  {id:'2026-09-27',data:{date:'2026-09-27',variant_count:10,snapshot_at:at('2026-09-27','22'),items:{
    a:{sku:'GST001-S',available:7},b:{sku:'GST001-M',available:6},c:{sku:'GST001-L',available:15},d:{sku:'GD007-28',available:5},
    e:{sku:'GD007-30',available:5},g:{sku:'GSW001-M',available:4},i:{sku:'GHW001',available:0},j:{sku:'GBIG001-M',available:108}}}},
  // a truncated snapshot (1 of ~10 variants) must not count as a day of truth
  {id:'2026-09-28',data:{date:'2026-09-28',variant_count:1,snapshot_at:at('2026-09-28','22'),items:{a:{sku:'GST001-S',available:1}}}},
  // 22:00 29 Sep
  {id:'2026-09-29',data:{date:'2026-09-29',variant_count:10,snapshot_at:at('2026-09-29','22'),items:{
    a:{sku:'GST001-S',available:6},b:{sku:'GST001-M',available:6},c:{sku:'GST001-L',available:14},d:{sku:'GD007-28',available:3},
    e:{sku:'GD007-30',available:5},g:{sku:'GSW001-M',available:7},i:{sku:'GHW001',available:0},j:{sku:'GBIG001-M',available:130}}}}
];
function seed(lines,snaps,prods){
  const docs={};
  (lines||LINES).forEach((l,i)=>{docs['shopify_line_items/o'+i+'_'+i]=clone(l);});
  (prods||PRODUCTS).forEach((p,i)=>{docs['shopify_products/'+(1000+i)]=clone(p);});
  (snaps||SNAPS).forEach(s=>{docs['shopify_inventory_snapshots/'+s.id]=clone(s.data);});
  return docs;
}
const slice=(a,from,n)=>a.slice(from,from+n);

module.exports=async function(){
  const s=suite('shopify-article-rollup');

  // ── units ────────────────────────────────────────────────────
  s.section('size estimate (the documented Firestore rule)');
  s.eq('path 3 + 1 + 16 + 32, key x (1+1), array 8 + 1 (null) + 3 (\'ab\')',R.estimateDocSize('a/b',{x:[1,null,'ab']}),66);

  s.section('cleaning rules, one row at a time');
  const C=R.cleanLineItem;
  s.eq('a paid row counts',J([C(L('2026-09-25','GST001-S',2,1000)).net,C(L('2026-09-25','GST001-S',2,1000)).code]),J([2,'GST001']));
  s.eq('a tip (Rs 0.01) is non-merchandise',C(L('2026-09-25','TIP',1,0.01)).rule,'non_merch');
  s.eq('Rs 0.99 is still under Rs 1',C(L('2026-09-25','GST001-S',1,0.99)).rule,'non_merch');
  s.eq('Rs 1 is merchandise',C(L('2026-09-25','GST001-S',1,1)).rule,undefined);
  s.eq('no SKU',C(L('2026-09-25','',1,500)).rule,'no_sku');
  s.eq('NO-SKU',C(L('2026-09-25','no-sku',1,500)).rule,'no_sku');
  s.eq('voided goes to vd, not sold',J([C(L('2026-09-25','GST001-S',3,1000,'voided')).voided,C(L('2026-09-25','GST001-S',3,1000,'voided')).net]),J([3,0]));
  s.eq('a cancelled_at voids it too',C(L('2026-09-25','GST001-S',3,1000,'paid',{cancelled_at:'2026-09-26'})).status,'voided');
  s.eq('refunded goes to rf',J([C(L('2026-09-25','GST001-S',2,1000,'refunded')).refunded,C(L('2026-09-25','GST001-S',2,1000,'refunded')).net]),J([2,0]));
  s.eq('refunded_quantity on a partial refund',J([C(L('2026-09-25','GST001-S',4,1000,'partially_refunded',{refunded_quantity:1})).refunded,C(L('2026-09-25','GST001-S',4,1000,'partially_refunded',{refunded_quantity:1})).net]),J([1,3]));
  s.eq('a partial refund with the field ABSENT is just sold (tolerated)',C(L('2026-09-25','GST001-S',4,1000,'partially_refunded')).net,4);
  s.eq('refunded_quantity above quantity is capped',C(L('2026-09-25','GST001-S',2,1000,'paid',{refunded_quantity:9})).net,0);
  s.eq('a bad date is excluded',C(L('soon','GST001-S',2,1000)).rule,'bad_day');
  s.eq('quantity 0 is excluded',C(L('2026-09-25','GST001-S',0,1000)).rule,'zero_qty');

  s.section('size reader');
  const SF=R.sizeFor;
  s.eq('plain size',SF('GST001-S',{size:'S',color:'Black'}).size,'S');
  s.eq('swapped: size in the colour option',J(SF('GSW001-M',{size:'Olive',color:'M'})),J({size:'M',swapped:true}));
  s.eq('numeric waist in the colour option (only a Size option)',J(SF('GD007-28',{size:'',color:'28'})),J({size:'28',swapped:true}));
  s.eq('numeric waist in the size option',SF('GD007-30',{size:'30',color:'Blue'}).size,'30');
  s.eq('a line item\'s own size is the fallback when there is no product',SF('GST001-XL',null,{size:'xl'}).size,'XL');
  s.eq('SKU suffix when no option is a size',SF('GST009-2XL',{size:'Big',color:'Red'}).size,'2XL');
  s.eq('nothing readable is Unknown',SF('GHW001',{size:'',color:'Green'}).size,'Unknown');

  s.section('timing: before 18:00 PKT is the previous day\'s close');
  const ms=(d,h)=>Date.parse(d+'T'+h+':00:00+05:00');
  s.eq('10:00 on the 26th is the 25th',R.effectiveDay(ms('2026-09-26','10'),'x').day,'2026-09-25');
  s.eq('17:59 is still the day before',R.effectiveDay(ms('2026-09-26','17')+59*60000,'x').day,'2026-09-25');
  s.eq('18:00 is the same day',R.effectiveDay(ms('2026-09-26','18'),'x').day,'2026-09-26');
  s.eq('22:00 is the same day',R.effectiveDay(ms('2026-09-26','22'),'x').day,'2026-09-26');
  s.eq('00:30 on 1 Oct is 30 Sep',R.effectiveDay(ms('2026-10-01','00')+30*60000,'x').day,'2026-09-30');
  s.eq('no time at all falls back to the id and says so',J(R.effectiveDay(null,'2026-09-26')),J({day:'2026-09-26',noTime:true,shifted:false}));

  // ── the full run over the fixture ────────────────────────────
  s.section('a first run with no meta rebuilds in full');
  const {db,state}=makeDb(seed());
  const rep=await R.runRollup({db,nowMs:NOW,triggeredBy:'test'});
  const D=state.docs;
  s.eq('state done',rep.state,'done');
  s.eq('mode full (upgraded — there was no meta)',J([rep.mode,rep.upgraded_to_full]),J(['full',true]));
  s.eq('coverage starts at the first counted sale',rep.coverage_from,'2026-09-25');
  s.eq('5 articles (TIP and the no-SKU rows are not one)',rep.articles,5);
  s.ok('no doc for TIP or for an empty code',!Object.keys(D).some(k=>/shopify_article_daily\/(TIP|_)/.test(k)));
  s.eq('5 year docs, all 2026',J(Object.keys(D).filter(k=>/shopify_article_daily/.test(k)).sort()),
    J(['GBIG001_2026','GD007_2026','GHW001_2026','GSW001_2026','GST001_2026'].map(x=>'shopify_article_daily/'+x).sort().concat([]).filter(x=>true)));
  const g=D['shopify_article_daily/GST001_2026'];

  s.section('GST001 — hand-computed days 25..30 Sep');
  s.eq('n = 273 days so far (idx 0..272)',g.n,273);
  s.eq('every array is n long',J([g.u.length,g.rev.length,g.vd.length,g.rf.length,g.st.length,g.ins.length,g.rc.length]),J([273,273,273,273,273,273,273]));
  s.eq('net units: 25th 4 (dup SKU rows summed 3 S + 1 M), 26th 0, 27th 4 (3 M + 1 S), then 0',J(slice(g.u,I,6)),J([4,0,4,0,0,0]));
  s.eq('revenue = net units x price',J(slice(g.rev,I,6)),J([4000,0,4000,0,0,0]));
  s.eq('voided units on the 26th',J(slice(g.vd,I,6)),J([0,3,0,0,0,0]));
  s.eq('refunded units: 2 on the 26th (whole row), 1 on the 27th (partial)',J(slice(g.rf,I,6)),J([0,2,1,0,0,0]));
  s.eq('stock: only days with a usable snapshot (25, 27, 29); 28th partial snapshot ignored',J(slice(g.st,I,6)),J([20,null,28,null,26,null]));
  s.eq('in-stock flags',J(slice(g.ins,I,6)),J([1,null,1,null,1,null]));
  s.eq('inferred receipt: 28 - 20 + 4 sold = 12 (>= max(5, 10% of 20) = 5) on the 27th; 29th -2 -> 0',J(slice(g.rc,I,6)),J([0,null,12,null,0,null]));
  s.eq('literal index check: u[267] is the 25th',g.u[267],4);
  s.eq('history before the synced sales is null, never zero',J([g.u[I-1],g.rev[I-1],g.vd[I-1],g.rf[I-1],g.st[I-1],g.u[0]]),J([null,null,null,null,null,null]));
  s.eq('sizes kept',J(Object.keys(g.sz).sort()),J(['L','M','S']));
  s.eq('size S units (3 on the 25th, 1 on the 27th)',J(slice(g.sz.S.u,I,6)),J([3,0,1,0,0,0]));
  s.eq('size M units (1, then 3 net of the refund)',J(slice(g.sz.M.u,I,6)),J([1,0,3,0,0,0]));
  s.eq('size L units: the refunded row sold nothing',J(slice(g.sz.L.u,I,6)),J([0,0,0,0,0,0]));
  s.eq('size S stock',J(slice(g.sz.S.st,I,6)),J([10,null,7,null,6,null]));
  s.eq('size M stock: 8 + the duplicate entry 2 = 10',J(slice(g.sz.M.st,I,6)),J([10,null,6,null,6,null]));
  s.eq('size L stock: -3 clamped to 0',J(slice(g.sz.L.st,I,6)),J([0,null,15,null,14,null]));

  s.section('other articles');
  const dn=D['shopify_article_daily/GD007_2026'],sw=D['shopify_article_daily/GSW001_2026'],hw=D['shopify_article_daily/GHW001_2026'],bg=D['shopify_article_daily/GBIG001_2026'];
  s.eq('GD007: waist sizes 28 and 30, from the colour option',J(Object.keys(dn.sz).sort()),J(['28','30']));
  s.eq('GD007 units on the 28th',J(slice(dn.u,I,6)),J([0,0,0,2,0,0]));
  s.eq('GD007 revenue 2 x 3000',dn.rev[I+3],6000);
  s.eq('GD007 stock 10, 10, 8 (5+5, 5+5, 3+5)',J([dn.st[I],dn.st[I+2],dn.st[I+4]]),J([10,10,8]));
  s.eq('GD007: sold 2, closed 2 lower: no receipt',J(slice(dn.rc,I,6)),J([0,null,0,null,0,null]));
  s.eq('GSW001: swapped options read as size M',J(Object.keys(sw.sz)),J(['M']));
  s.eq('GSW001: 7 - 4 + 1 sold = 4, under the floor of 5: not a receipt',sw.rc[I+4],0);
  s.eq('GHW001: stock-out — in stock, then out, out',J(slice(hw.ins,I,6)),J([1,null,0,null,0,null]));
  s.eq('GHW001: a cap has no size',J(Object.keys(hw.sz)),J(['Unknown']));
  s.eq('GBIG001: 100 -> 108 is under 10% of 100 (8 < 10): not a receipt',bg.rc[I+2],0);
  s.eq('GBIG001: 108 -> 130 = 22 >= 10% of 108: a receipt',bg.rc[I+4],22);

  s.section('the summary (compact list)');
  const sum=D['shopify_article_summary/all'];
  const a=sum.articles.find(x=>x.code==='GST001');
  s.eq('header',J([sum.version,sum.as_of,sum.coverage_from,sum.count]),J([1,TODAY,'2026-09-25',5]));
  s.eq('units 7/28/90 and lifetime',J([a.u7,a.u28,a.u90,a.ut]),J([8,8,8,8]));
  s.eq('revenue 28d',a.r28,8000);
  s.eq('stock is the latest snapshot (29th)',a.st,26);
  s.eq('first and last sale, receipt',J([a.fs,a.ll,a.lr]),J(['2026-09-25','2026-09-27','2026-09-27']));
  s.eq('live = published_at, labelled p',J([a.lv,a.ls]),J(['2026-09-05','p']));
  s.eq('in-stock rate over snapshot days 1, stock-out days 0',J([a.ins28,a.so28]),J([1,0]));
  s.eq('cover 26 / (8/28) = 91 days; sell-through 8/34',J([a.cov,a.stp]),J([91,0.235]));
  s.eq('avg price 1000; void rate 3/11; refund rate 3/11',J([a.ap,a.vr,a.rr]),J([1000,0.273,0.273]));
  s.eq('per-size latest stock and 28d units',J([a.ss,a.su]),J([{L:14,M:6,S:6},{M:4,S:4}]));
  s.eq('GD007 live falls back to created_at (c)',J([sum.articles.find(x=>x.code==='GD007').lv,sum.articles.find(x=>x.code==='GD007').ls]),J(['2026-08-20','c']));
  s.eq('GHW001 has no price and no sales: nulls, not zeros',J([sum.articles.find(x=>x.code==='GHW001').ap,sum.articles.find(x=>x.code==='GHW001').cov]),J([null,null]));
  s.eq('sorted by 28-day units, then code',J(sum.articles.map(x=>x.code)),J(['GST001','GD007','GSW001','GBIG001','GHW001']));

  s.section('meta: version, window, counters, data quality by rule');
  const m=D['shopify_rollup_meta/status'];
  s.eq('version and window',J([m.version,m.window.to,m.state]),J([1,TODAY,'done']));
  s.eq('rows read 12 (incl. the excluded ones)',m.counts.line_items_read,12);
  s.eq('excluded rows by rule',J(m.quality.excluded),J({no_sku:2,bad_day:0,zero_qty:0,non_merch:1,voided:1,refunded:1}));
  s.eq('excluded units by rule (no_sku 2+3, tip 1, voided 3, refunded 2 + 1 partial)',J(m.quality.excluded_units),J({no_sku:5,non_merch:1,voided:3,refunded:3}));
  s.eq('one partial-refund row',m.quality.partial_refund_rows,1);
  s.eq('negative stock: 1 entry, min -3',J([m.quality.negative_stock_entries,m.quality.negative_stock_min]),J([1,-3]));
  s.eq('duplicates: 1 product SKU, 1 snapshot entry; 1 stock row without a SKU',J([m.quality.duplicate_sku_products,m.quality.duplicate_sku_snapshot_rows,m.quality.no_sku_stock_rows]),J([1,1,1]));
  s.eq('snapshots: 5 read, 1 partial, 1 shifted, 1 collided',J([m.quality.snapshots_read,m.quality.snapshots_partial,m.quality.snapshots_shifted,m.quality.snapshots_collided]),J([5,1,1,1]));
  s.eq('size read from the colour option on 3 SKUs (GD007-28, GD007-30, GSW001-M)',m.quality.swapped_size_products,3);
  s.eq('sizes measured',J([m.sizes.summary_bytes>0,m.sizes.max_year_doc_bytes>0]),J([true,true]));
  s.eq('shadow compare agrees',J([m.shadow.mismatches,m.shadow.checked>0]),J([0,true]));

  // ── idempotence and the nightly recompute ────────────────────
  s.section('a rerun over the same data writes nothing new');
  const before=clone(D);
  state.writes.length=0;
  const rep2=await R.runRollup({db,nowMs:NOW});
  s.eq('now a nightly run (meta exists)',J([rep2.mode,rep2.upgraded_to_full]),J(['nightly',false]));
  s.eq('0 year docs written, all unchanged',J([rep2.counts.year_docs_written,rep2.counts.year_docs_unchanged]),J([0,5]));
  s.ok('no shopify_article_daily write at all',!state.writes.some(w=>/shopify_article_daily/.test(w)));
  s.ok('the article docs are identical',J(Object.keys(before).filter(k=>/article_daily/.test(k)).map(k=>before[k]))===J(Object.keys(D).filter(k=>/article_daily/.test(k)).map(k=>D[k])));
  s.ok('the summary is identical',J(before['shopify_article_summary/all'])===J(D['shopify_article_summary/all']));
  s.eq('coverage_from is carried, not recomputed from the window',rep2.coverage_from,'2026-09-25');

  s.section('a status change inside the window is picked up, and only that article is rewritten');
  const lines2=clone(LINES);lines2[0].financial_status='refunded';           // GST001-S 2 units, 25 Sep
  Object.keys(D).filter(k=>/shopify_line_items/.test(k)).forEach(k=>delete D[k]);
  lines2.forEach((l,i)=>{D['shopify_line_items/o'+i+'_'+i]=clone(l);});
  state.writes.length=0;
  const rep3=await R.runRollup({db,nowMs:NOW});
  s.eq('one doc changed',J([rep3.counts.year_docs_written,rep3.counts.year_docs_unchanged]),J([1,4]));
  s.eq('it is GST001',J(state.writes.filter(w=>/article_daily/.test(w))),J(['shopify_article_daily/GST001_2026']));
  const g3=D['shopify_article_daily/GST001_2026'];
  s.eq('25 Sep units 4 -> 2, refunded 0 -> 2',J([g3.u[I],g3.rf[I]]),J([2,2]));
  s.eq('days outside the row are untouched',J([g3.u[I+2],g3.st[I+2]]),J([4,28]));

  s.section('an incremental run equals a full rebuild');
  const fresh=makeDb(seed(lines2));
  await R.runRollup({db:fresh.db,nowMs:NOW});
  const fullDocs=Object.keys(fresh.state.docs).filter(k=>/article_daily|article_summary/.test(k)).sort().map(k=>[k,fresh.state.docs[k]]);
  const incDocs=Object.keys(D).filter(k=>/article_daily|article_summary/.test(k)).sort().map(k=>[k,D[k]]);
  s.ok('same docs, byte for byte',J(incDocs)===J(fullDocs));

  s.section('the 1 MiB guard');
  const tiny=makeDb(seed());
  const repBig=await R.runRollup({db:tiny.db,nowMs:NOW,limits:{doc:1000}});
  s.eq('a year doc over the limit: state partial, not done',repBig.state,'partial');
  s.ok('no oversize year doc was written',!Object.keys(tiny.state.docs).some(k=>/article_daily/.test(k)));
  s.ok('the error names the doc and its size',repBig.errors.some(e=>/^year doc GST001_2026 \d+ B exceeds 1000/.test(e)));
  s.eq('the failed run still records itself',tiny.state.docs['shopify_rollup_meta/status'].state,'partial');
  const tiny2=makeDb(seed());
  const repBig2=await R.runRollup({db:tiny2.db,nowMs:NOW,limits:{summary:1000}});
  s.eq('a summary over the limit: partial',repBig2.state,'partial');
  s.ok('the summary was not written, the article docs were',!tiny2.state.docs['shopify_article_summary/all']&&Object.keys(tiny2.state.docs).filter(k=>/article_daily/.test(k)).length===5);
  s.ok('the error names the summary and its size',repBig2.errors.some(e=>/^summary \d+ B exceeds 1000/.test(e)));

  // ── shadow compare ───────────────────────────────────────────
  s.section('shadow compare catches a doc that disagrees with the raw rows');
  const good=new Map([['GST001',[clone(g)]]]);
  const sh0=R.shadowCompare(LINES,'2026-09-24',TODAY,good,dayNum('2026-09-25'));
  s.eq('GST001 alone: only it is checked against the rows that exist for the other codes (they differ: no doc)',sh0.mismatches>0,true);
  const all=new Map();
  Object.keys(D).filter(k=>/article_daily/.test(k)).forEach(k=>{const d=D[k];if(!all.has(d.code))all.set(d.code,[]);all.get(d.code).push(clone(d));});
  const okSh=R.shadowCompare(LINES.map((l,i)=>i===0?lines2[0]:l),'2026-09-24',TODAY,all,dayNum('2026-09-25'));
  s.eq('untouched docs: 0 mismatches',okSh.mismatches,0);
  all.get('GST001')[0].u[I+2]+=7;
  const badSh=R.shadowCompare(LINES.map((l,i)=>i===0?lines2[0]:l),'2026-09-24',TODAY,all,dayNum('2026-09-25'));
  s.eq('a tampered day: 1 mismatch, the code and both totals named',J([badSh.mismatches,badSh.sample[0]]),J([1,{code:'GST001',expected:6,got:13}]));
  all.get('GST001')[0].u[I+2]-=7;
  all.set('GZZ999',[{code:'GZZ999',year:2026,u:[0,0,5]}]);
  const extra=R.shadowCompare(LINES,'2026-01-01',TODAY,all,0);
  s.ok('a doc for an article with no sales rows is a mismatch too',extra.sample.some(x=>x.code==='GZZ999'&&x.expected===0&&x.got===5));

  // ── scale: measured sizes ────────────────────────────────────
  s.section('measured sizes at the real scale (366 articles, 6 sizes, 190 days of sales, 128 snapshots)');
  {
    const SZ=['XS','S','M','L','XL','2XL'],prods=[],lines=[],snaps=[];
    const N=366,DAYS=190,start=Date.UTC(2026,2,26);
    for(let a=0;a<N;a++)for(const z of SZ)prods.push({sku:'GT'+String(a).padStart(3,'0')+'-'+z,product_title:'Article '+a,color:'Black',size:z,product_type:'Tee',published_at:'2026-03-20T00:00:00+05:00'});
    let seq=0;
    for(let d=0;d<DAYS;d++){const day=new Date(start+d*86400000).toISOString().slice(0,10);
      for(let a=0;a<N;a++){const z=SZ[(a+d)%6];lines.push({sku:'GT'+String(a).padStart(3,'0')+'-'+z,quantity:1+(a+d)%3,price:1500,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});seq++;}}
    for(let d=DAYS-128;d<DAYS;d++){const day=new Date(start+d*86400000).toISOString().slice(0,10);const items={};
      for(let a=0;a<N;a++)for(let zi=0;zi<6;zi++)items[a+'_'+zi]={sku:'GT'+String(a).padStart(3,'0')+'-'+SZ[zi],available:(a*7+zi*3+d)%40};
      snaps.push({id:day,data:{date:day,snapshot_at:day+'T22:00:00+05:00',items}});}
    const big=makeDb(seed(lines,snaps,prods));
    const t0=Date.now();
    const repS=await R.runRollup({db:big.db,nowMs:Date.UTC(2026,8,30,7,0,0)});
    const secs=(Date.now()-t0)/1000;
    const yearDocs=Object.keys(big.state.docs).filter(k=>/article_daily/.test(k));
    const sizes=yearDocs.map(k=>R.estimateDocSize(k,big.state.docs[k]));
    const maxY=Math.max(...sizes),sumB=repS.sizes.summary_bytes;
    console.log('    [measured] '+yearDocs.length+' year docs, largest '+(maxY/1024).toFixed(1)+' KB, mean '+(sizes.reduce((x,y)=>x+y,0)/sizes.length/1024).toFixed(1)+' KB; summary '+(sumB/1024).toFixed(1)+' KB; '+lines.length+' rows + '+snaps.length+' snapshots in '+secs.toFixed(1)+' s');
    s.eq('state done at scale',repS.state,'done');
    s.eq('366 year docs',yearDocs.length,366);
    s.ok('every year doc is far under the 700 KB guard (<150 KB)',maxY<150*1024);
    s.ok('the summary is under 900 KB and under 1 MiB (measured '+(sumB/1024).toFixed(0)+' KB)',sumB<900*1024&&sumB<1048576);
    s.eq('shadow agrees over 69k rows',repS.shadow.mismatches,0);
  }

  // ── the wrapper, the schedule, the rules ─────────────────────
  s.section('the -now wrapper: owners only');
  {
    const st={tokens:TOKENS,docs:{}};
    const fn=withEnv({FIREBASE_SERVICE_ACCOUNT:FAKE_SA},()=>loadFn('netlify/functions/shopify-article-rollup-now-background.js',st));
    const core=require('../netlify/functions/shopify-article-rollup-background.js');
    const real=core.runRollup;const calls=[];
    core.runRollup=async(o)=>{calls.push({mode:o.mode,by:o.triggeredBy});return{state:'done',mode:o.mode};};
    const call=(method,token,body)=>withEnv({FIREBASE_SERVICE_ACCOUNT:FAKE_SA},()=>fn.handler({httpMethod:method,headers:token?{authorization:'Bearer '+token}:{},body}));
    try{
      s.eq('GET is refused',(await call('GET','t_afnan')).statusCode,405);
      s.eq('no token: 401',(await call('POST',null,'{}')).statusCode,401);
      s.eq('a manager is refused: 403',(await call('POST','t_mustafa','{}')).statusCode,403);
      s.eq('Raees is refused: 403',(await call('POST','t_raees','{}')).statusCode,403);
      s.eq('a mixed-case owner email is refused (the rules compare exactly)',(await call('POST','t_ammar_mixed','{}')).statusCode,403);
      s.eq('nothing ran for any refusal',calls.length,0);
      s.eq('bad JSON: 400',(await call('POST','t_afnan','{')).statusCode,400);
      const r1=await call('POST','t_afnan','{"mode":"full"}');
      s.eq('an owner gets 200 and mode full',J([r1.statusCode,JSON.parse(r1.body).mode]),J([200,'full']));
      await call('POST','t_ammar','{}');
      s.eq('the runs: full by afnan, nightly by ammar',J(calls),J([{mode:'full',by:'afnan@groovy.op'},{mode:'nightly',by:'ammar@groovy.op'}]));
    }finally{core.runRollup=real;}
  }
  s.section('schedule and rules');
  {
    const toml=fs.readFileSync(path.join(ROOT,'netlify.toml'),'utf8');
    s.ok('scheduled 06:15 UTC',/\[functions\."shopify-article-rollup-background"\]\s*\n\s*schedule = "15 6 \* \* \*"/.test(toml));
    s.ok('after the 04:00 catalog sync and the 05:00 snapshot',/"shopify-catalog-sync"\]\s*\n\s*schedule = "0 4 /.test(toml)&&/"shopify-inventory-snapshot"\]\s*\n\s*schedule = "0 5,17 /.test(toml));
    s.ok('the -now wrapper has no schedule (Netlify answers 403 to a scheduled one)',!/functions\."shopify-article-rollup-now-background"/.test(toml));
    const rules=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
    for(const c of ['shopify_article_daily','shopify_article_summary','shopify_rollup_meta']){
      const mm=new RegExp('match /'+c+'/\\{id\\} \\{([\\s\\S]*?)\\n    \\}').exec(rules);
      s.ok(c+': a match block, read isQaRead() || signedIn(), write false',!!mm&&/allow read: if isQaRead\(\) \|\| \(signedIn\(\)\);/.test(mm[1])&&/allow write: if false;/.test(mm[1]));
    }
  }
  return s;
};
function dayNum(d){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d);return Math.floor(Date.UTC(+m[1],+m[2]-1,+m[3])/86400000);}

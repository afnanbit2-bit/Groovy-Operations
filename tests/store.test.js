/* ─────────────────────────────────────────────────────────────────────────
   js/store.js — the REST read helpers and loadStoreData.

   Written after the Stock Log "vanished": the page showed "0 movements ·
   No records found." while store_transactions was full. js/store.js is the
   one module that talks to Firestore over REST instead of the SDK bridge,
   and none of its read helpers checked `r.ok`. An error body has no
   `documents` key and is not an array, so `d.documents||[]` and
   `Array.isArray(docs)?docs:[]` turned every 401/403/429/500 into an empty
   list — no throw, no toast, no console line. Nothing looked broken; the
   data just wasn't there.

   These assertions are about that distinction: a read that FAILED and a
   collection that is EMPTY must never produce the same screen.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const FILES=['js/store.js'];
const BASE={
  allItems:[],allTransactions:[],allTemplates:[],allRequests:[],allActivePOs:[],
  allStoreCategories:[],allPoIssueRequests:[],allPoEditRequests:[],allPoShortfalls:[],
  auth:{currentUser:{getIdToken:async()=>'tok'}},
  currentPage:'store-log',
  // Page state that lives as top-level `let`s in js/shared.js — a lexical
  // global these classic scripts share. store.js only reads/assigns them.
  _ilPage:1,_ilQ:'',_ilPO:'',_ilDir:'',IL_PER:15,IL_MAX_PAGES:1000,
  _invFilterCat:'all',_invSearchQ:'',_invSort:'category'
};
const res=(status,body)=>({
  ok:status>=200&&status<300,status,statusText:String(status),json:async()=>body
});
const DENIED={error:{code:403,status:'PERMISSION_DENIED',message:'Missing or insufficient permissions.'}};
// A runQuery result row.
const row=(col,id,fields)=>({document:{name:'projects/p/databases/(default)/documents/'+col+'/'+id,fields}});
const num=n=>({integerValue:String(n)});

// Loads store.js with a fetch driven by `plan(url, body)`.
function app(plan,extra){
  return loadApp({files:FILES,globals:Object.assign({},BASE,{
    fetch:async(url,init)=>plan(String(url),init&&init.body?JSON.parse(init.body):null)
  },extra||{})});
}

module.exports=async function(){
  const s=suite('store');

  s.section('a refused read throws instead of reporting an empty collection');
  {
    const a=app(()=>res(403,DENIED));
    let threw=null;
    await a.run("fsList('store_items')").catch(e=>{threw=e;});
    s.ok('fsList throws',!!threw);
    s.ok('and names the collection',/store_items/.test(threw&&threw.message),threw&&threw.message);
    s.ok('and carries the status',threw&&threw.status===403);
    s.ok('and the Firestore code',threw&&threw.code==='PERMISSION_DENIED');

    let t2=null;
    await a.run("fsQueryOrdered('store_transactions','ts',10)").catch(e=>{t2=e;});
    s.ok('fsQueryOrdered throws too',!!t2);
    s.ok('naming its collection',/store_transactions/.test(t2&&t2.message),t2&&t2.message);
  }

  s.section('runQuery answers a failure with an OBJECT, not the results array');
  {
    // This is the exact shape that used to slip through: HTTP 200, but the
    // body is {error:…} rather than [...]. `Array.isArray(...)?...:[]` read
    // it as "no rows".
    const a=app(()=>res(200,DENIED));
    let threw=null;
    await a.run("fsQueryOrdered('store_transactions','ts',10)").catch(e=>{threw=e;});
    s.ok('a 200 carrying {error} still throws',!!threw,'returned quietly');
  }
  {
    // And the array-wrapped form, [{error:…}].
    const a=app(()=>res(200,[DENIED]));
    let threw=null;
    await a.run("fsQueryOrdered('store_transactions','ts',10)").catch(e=>{threw=e;});
    s.ok('[{error}] throws as well',!!threw,'returned quietly');
  }

  s.section('an empty collection is still empty — not an error');
  {
    const a=app(u=>res(200,/runQuery/.test(u)?[]:{documents:[]}));
    s.eq('fsList returns []',(await a.run("fsList('store_items')")).length,0);
    s.eq('fsQueryOrdered returns []',(await a.run("fsQueryOrdered('store_transactions','ts',10)")).length,0);
  }

  s.section('fsList follows nextPageToken');
  {
    // It used to ignore the token, so anything past the first response page
    // silently stopped existing — including, potentially, a whole category
    // of items.
    const urls=[];
    const a=app(u=>{
      urls.push(u);
      return urls.length===1
        ?res(200,{documents:[{name:'x/store_items/A',fields:{}}],nextPageToken:'t2'})
        :res(200,{documents:[{name:'x/store_items/B',fields:{}}]});
    });
    const out=await a.run("fsList('store_items')");
    s.eq('both pages came back',out.length,2);
    s.eq('in two requests',urls.length,2);
    s.ok('the first asks for no page',!/pageToken/.test(urls[0]),urls[0]);
    s.ok('the second sends the token',/pageToken=t2/.test(urls[1]),urls[1]);
  }

  s.section('fsQueryOrdered pages with an exact cursor');
  {
    // Ordering by `ts DESC, __name__ DESC` is what makes the cursor exact:
    // a cursor on the value alone would skip or repeat rows sharing a ts.
    const bodies=[];
    const a=app((u,b)=>{
      bodies.push(b&&b.structuredQuery);
      const n=bodies.length;
      if(n===1)return res(200,[row('store_transactions','a',{ts:num(30)}),
                              row('store_transactions','b',{ts:num(20)})]);
      return res(200,[row('store_transactions','c',{ts:num(20)})]);
    });
    const out=await a.run("fsQueryOrdered('store_transactions','ts',4,2)");
    s.eq('every page is kept',out.length,3);
    const ob=bodies[0].orderBy.map(o=>o.field.fieldPath);
    s.eq('ordered by the field then __name__',ob.join(','),'ts,__name__');
    s.ok('the second request carries a cursor',!!bodies[1].startAt,'no startAt');
    const cur=bodies[1].startAt.values;
    s.eq('cursor holds the ts',cur[0].integerValue,'20');
    s.ok('and a bare resource name, not a URL',
      cur[1].referenceValue==='projects/groovy-gatepass/databases/(default)/documents/store_transactions/b',
      cur[1].referenceValue);
  }

  s.section('one refused read no longer costs the other seven');
  {
    // The old Promise.all meant a single 403 threw away all eight results
    // and the whole store read as empty.
    const a=app(u=>{
      if(/runQuery/.test(u))return res(403,DENIED);            // store_transactions
      if(/store_items/.test(u))return res(200,{documents:[{name:'x/store_items/NL01',fields:{code:{stringValue:'NL01'}}}]});
      if(/store_categories/.test(u))return res(200,{documents:[{name:'x/store_categories/stationary',fields:{key:{stringValue:'stationary'},label:{stringValue:'Stationary'}}}]});
      return res(200,{documents:[]});
    });
    await a.run('loadStoreData()');
    await a.run("loadStoreTransactions('full')");
    s.eq('items still loaded',a.run('allItems.length'),1);
    s.eq('categories still loaded',a.run('allStoreCategories.length'),1);
    s.eq('the refused one is empty',a.run('allTransactions.length'),0);

    s.section('and the failure is NAMED, not silent');
    const t=a.state.toasts.join(' | ');
    s.ok('the toast says which collection',/store_transactions/.test(t),t);
    s.ok('and what to check',/firestore\.rules/.test(t),t);
    s.ok('without blaming the ones that worked',!/store_items/.test(t),t);
    s.ok('the failure is recorded for the page to read',
      a.run("!!_storeLoadFailed('store_transactions')"));
    s.ok('and the ones that worked are not',
      a.run("!_storeLoadFailed('store_items')"));
  }

  s.section('the Log page says "could not load", never "No records found"');
  {
    const a=app(u=>/runQuery/.test(u)?res(403,DENIED):res(200,{documents:[]}));
    await a.run('loadStoreData()');
    await a.run("loadStoreTransactions('full')");   // what opening store-log does
    const head=a.run('renderStoreLog()');
    s.ok('the header does not claim 0 movements',!/0 movements/.test(head),'header still counts a failed read as 0');
    s.ok('it says it could not be loaded',/could not be loaded/.test(head));

    a.run("document.getElementById('il-body');document.getElementById('il-pager');");
    a.run('refreshIssueLog()');
    const body=a.el('il-body').innerHTML;
    s.ok('the body shows the error',/Could not load the movement log/.test(body),'body was: '+body.slice(0,80));
    s.ok('not the empty state',!/No records found/.test(body));
    s.ok('and offers a Retry',/ilRetryLoad/.test(body));
    s.ok('naming firestore.rules for a refused read',/firestore\.rules/.test(body));
  }

  s.section('a genuinely empty log still reads as empty');
  {
    const a=app(u=>res(200,/runQuery/.test(u)?[]:{documents:[]}));
    await a.run('loadStoreData()');
    await a.run("loadStoreTransactions('full')");
    s.ok('header counts 0 movements',/0 movements/.test(a.run('renderStoreLog()')));
    a.run("document.getElementById('il-body');document.getElementById('il-pager');");
    a.run('refreshIssueLog()');
    s.ok('body is the empty state',/No records found/.test(a.el('il-body').innerHTML));
  }

  s.section('a failed store_items read never seeds over the live balances');
  {
    // loadStoreData seeds INITIAL_ITEMS when the item list comes back empty.
    // Before the helpers checked r.ok, a 403 came back as [] — so a refused
    // read would have written 112 zeroed items over the real stock.
    const a=app(u=>/store_items/.test(u)?res(403,DENIED):res(200,/runQuery/.test(u)?[]:{documents:[]}));
    await a.run('loadStoreData()');
    s.eq('nothing was written',a.state.fetches.filter(f=>(f.init.method||'GET')!=='GET').length,0);
    s.ok('and it did not claim to initialise',!/initialis/i.test(a.state.toasts.join(' ')),a.state.toasts.join(' | '));
  }

  s.section('Inventory says when custom categories could not load');
  {
    // Custom categories live in store_categories. When that read fails their
    // chips are simply not drawn — which reads as "the category was
    // deleted", not as "the list did not load".
    const a=app(u=>/store_categories/.test(u)?res(403,DENIED)
      :res(200,/runQuery/.test(u)?[]:{documents:[]}));
    await a.run('loadStoreData()');
    const h=a.run('renderInventory()');
    s.ok('the page says so',/Custom categories could not be loaded/.test(h));
  }
  {
    const a=app(u=>res(200,/runQuery/.test(u)?[]:{documents:[]}));
    await a.run('loadStoreData()');
    s.ok('and stays quiet when they load',
      !/Custom categories could not be loaded/.test(a.run('renderInventory()')));
  }

  s.section('the 3000-doc movement read is NOT on the load-everything path');
  {
    // This is what exhausted the read quota: opening Receive, Issue,
    // Inventory or any PO-issue page pulled thousands of transaction
    // documents that nothing on screen used, and every read afterwards
    // came back 429.
    const urls=[];
    const a=app(u=>{urls.push(u);return res(200,/runQuery/.test(u)?[]:{documents:[]});});
    await a.run('loadStoreData()');
    s.ok('loadStoreData issues no runQuery at all',!urls.some(u=>/runQuery/.test(u)),
      'it still pulls the movement history on every store page');
    s.ok('store_transactions is not one of its jobs',
      a.run("_STORE_LOADS.every(j=>j.name!=='store_transactions')"));

    s.section('and the three pages that need it fetch it on demand, once');
    await a.run("loadStoreTransactions('full')");
    s.eq('one runQuery now',urls.filter(u=>/runQuery/.test(u)).length,1);
    await a.run("loadStoreTransactions('full')");
    s.eq('a second call is a no-op',urls.filter(u=>/runQuery/.test(u)).length,1);
    await a.run("loadStoreTransactions('full',true)");
    s.eq('but Retry forces a re-read',urls.filter(u=>/runQuery/.test(u)).length,2);
  }

  s.section('the Dashboard reads 25 rows, not 3000');
  {
    // It renders allTransactions.slice(0,10) and was reading the whole
    // history to do it — 120x the rows that page has any use for. Blaze
    // makes that a bill rather than an outage; it is still waste.
    const lims=[];
    const a=app((u,b)=>{
      if(b&&b.structuredQuery)lims.push(b.structuredQuery.limit);
      return res(200,/runQuery/.test(u)?[]:{documents:[]});
    });
    await a.run("loadStoreTransactions('recent')");
    s.eq('the shallow read asks for 25',lims[0],25);

    s.eq('and that is the whole read',lims.length,1);
    s.eq('recorded as a shallow depth',a.run('_storeTxnLoadedDepth()'),25);

    s.section('and a deeper page upgrades it');
    await a.run("loadStoreTransactions('full')");
    s.eq('the Log re-reads',lims.length,2);
    s.ok('for far more than 25',lims[1]>25,'asked for '+lims[1]);
    s.eq('at the full depth',a.run('_storeTxnLoadedDepth()'),3000);

    s.section('but never downgrades');
    await a.run("loadStoreTransactions('recent')");
    s.eq('holding the full history satisfies a shallow ask',lims.length,2);
  }

  s.section('a WRITE against the history always demands the full depth');
  {
    // Tiering would otherwise silently break rename: it migrates every row
    // carrying the old code, and scanning the Dashboard's 25 would report a
    // count that looks fine while missing almost everything.
    const lims=[];
    const a=app((u,b)=>{
      if(b&&b.structuredQuery)lims.push(b.structuredQuery.limit);
      return res(200,/runQuery/.test(u)?[]:{documents:[]});
    });
    await a.run("loadStoreTransactions('recent')");
    s.eq('the dashboard depth is shallow',a.run('_storeTxnLoadedDepth()'),25);
    await a.run("_storeEnsureTransactions()");
    s.eq('a write forces the full read',a.run('_storeTxnLoadedDepth()'),3000);
    s.eq('which is a second query',lims.length,2);
    s.ok('for far more than the shallow 25',lims[1]>25,'asked for '+lims[1]);
  }

  s.section('a failed load does not re-run on every navigation');
  {
    // The old guard was `!allItems.length`, so a refused store_items read
    // re-ran all eight jobs on every store page — the last thing an
    // exhausted quota needs.
    const a=app(()=>res(429,{error:{code:429,status:'RESOURCE_EXHAUSTED',message:'Quota exceeded.'}}),{});
    s.ok('nothing is loaded yet',!a.run('_storeDataLoaded()'));
    await a.run('loadStoreData()');
    s.ok('the attempt counts even though it failed',a.run('_storeDataLoaded()'));
  }

  s.section('a 429 is retried with backoff, then reported for what it is');
  {
    const QUOTA={error:{code:429,status:'RESOURCE_EXHAUSTED',message:'Quota exceeded.'}};
    let n=0;
    const a=app(()=>{n++;return n<3?res(429,QUOTA):res(200,{documents:[{name:'x/store_items/A',fields:{}}]});});
    const out=await a.run("fsList('store_items')");
    s.eq('it retried twice and then succeeded',n,3);
    s.eq('and returned the real data',out.length,1);
  }
  {
    const QUOTA={error:{code:429,status:'RESOURCE_EXHAUSTED',message:'Quota exceeded.'}};
    let n=0;
    const a=app(()=>{n++;return res(429,QUOTA);});
    let threw=null;
    await a.run("fsList('store_items')").catch(e=>{threw=e;});
    s.eq('a persistent 429 is bounded at three tries',n,3);
    s.ok('and then throws',!!threw);
    s.ok('flagged as a quota failure',threw&&threw.quota===true);
    s.ok('with a message a human can act on',/quota or rate limit/i.test(threw&&threw.message),threw&&threw.message);
  }
  {
    // A 403 must NOT be retried — it will never succeed and each attempt costs.
    let n=0;
    const a=app(()=>{n++;return res(403,DENIED);});
    await a.run("fsList('store_items')").catch(()=>{});
    s.eq('a refusal is tried exactly once',n,1);
  }

  s.section('the Log names the quota, not a generic failure');
  {
    const QUOTA={error:{code:429,status:'RESOURCE_EXHAUSTED',message:'Quota exceeded.'}};
    const a=app(u=>/runQuery/.test(u)?res(429,QUOTA):res(200,{documents:[]}));
    await a.run('loadStoreData()');
    await a.run("loadStoreTransactions('full')");
    a.run("document.getElementById('il-body');document.getElementById('il-pager');");
    a.run('refreshIssueLog()');
    const body=a.el('il-body').innerHTML;
    s.ok('it says quota',/quota/i.test(body),body.slice(0,160));
    s.ok('and where to look',/Firebase Console/.test(body));
    s.ok('not the firestore.rules answer',!/firestore\.rules/.test(body));
    s.ok('the toast says so too',/quota/i.test(a.state.toasts.join(' ')),a.state.toasts.join(' | '));
  }

  s.section('rename refuses rather than orphaning the history');
  {
    // Rename migrates every transaction carrying the old code. Against an
    // unloaded (lazy) array it would report "0 migrated" and leave the
    // history pointing at a code that no longer exists.
    const a=app(u=>/runQuery/.test(u)?res(403,DENIED):res(200,{documents:[]}));
    await a.run('loadStoreData()');
    let threw=null;
    await a.run("_renameStoreItemCode('NL01','NL02',{code:'NL02'})").catch(e=>{threw=e;});
    s.ok('it aborts',!!threw,'renamed against an unloaded history');
    s.ok('saying why',/movement history/.test(threw&&threw.message),threw&&threw.message);
  }

  s.section('a delete that was refused is not reported as done');
  {
    const a=app(()=>res(403,DENIED));
    let threw=null;
    await a.run("fsDelete('store_items','NL01')").catch(e=>{threw=e;});
    s.ok('fsDelete throws',!!threw,'reported success');
  }

  s.section('the stock rebuild refuses an empty read');
  {
    // _reconstructFromTxns([]) rebuilds every item back to the May-1 seed and
    // the modal offers to Apply it. That must never be reachable from a read
    // that simply did not come back.
    const a=app(u=>res(200,{documents:[]}),{session:{u:'afnan',name:'Afnan',role:'owner'}});
    await a.run('window.reconstructStockPreview()');
    const t=a.state.toasts.join(' | ');
    s.ok('it refuses out loud',/refusing/i.test(t),t);
    s.ok('and opens no modal',!a.el('_recon-modal')||!a.el('_recon-modal').innerHTML);
  }

  s.section('the Log survives dark mode');
  {
    const a=app(()=>res(200,{documents:[]}));
    const h=a.run('renderStoreLog()');
    // #f5f5f5 painted a bright line straight across the card in dark mode,
    // and setILDir wrote a literal #fff background under a themed foreground.
    s.ok('no hardcoded light border',!/#f5f5f5/.test(h),'renderStoreLog still writes #f5f5f5');
    const src=require('fs').readFileSync(require('path').join(__dirname,'..','js/store.js'),'utf8');
    const dir=src.slice(src.indexOf('function setILDir'),src.indexOf('// A refused read and an empty'));
    s.ok('and setILDir uses tokens',!/'#fff'/.test(dir),'setILDir still writes a literal #fff');
  }

  // ── _stockReconcile — the read-only reconciliation reducer ──
  // Pure and synchronous, so no fetch stubbing needed: fixtures go in
  // through `extra` globals and the function is called directly.
  s.section('_stockReconcile — fractional quantities are never truncated (parseFloat, not parseInt)');
  {
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'DS-E2',name:'Elastic 2 inch',unit:'kg',sizeSpecific:false,balance:1.25}],
      FIX_TXNS:[
        {itemCode:'DS-E2',type:'received',qty:0.75,ts:1000},
        {itemCode:'DS-E2',type:'received',qty:0.5,ts:2000}
      ]
    });
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    const row=r.items[0];
    s.eq('0.75 + 0.5 nets to 1.25, not 0 or 1',row.net,1.25);
    s.eq('storedBalance read raw, not truncated by getBalance()',row.storedBalance,1.25);
    s.ok('FRACTIONAL_BALANCE flagged',row.flags.includes('FRACTIONAL_BALANCE'),row.flags);
  }

  s.section('_stockReconcile — a negative net is reported, never clamped at zero');
  {
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'ZP-BS25',name:'Black Silver Zip 25"',unit:'pcs',sizeSpecific:false,balance:0}],
      FIX_TXNS:[{itemCode:'ZP-BS25',type:'issued',qty:400,ts:1000}]
    });
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    const row=r.items[0];
    s.eq('net is -400, not clamped to 0',row.net,-400);
    s.ok('NEGATIVE_NET flagged',row.flags.includes('NEGATIVE_NET'),row.flags);
  }

  s.section('_stockReconcile — zero balance with recorded receipts is the SL6/DS-E2 signature');
  {
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'SL6',name:'Groovy Shirting Flag Label',unit:'pcs',sizeSpecific:false,balance:0}],
      FIX_TXNS:[{itemCode:'SL6',type:'received',qty:6600,ts:1000}]
    });
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    s.ok('ZERO_WITH_RECEIPTS flagged',r.items[0].flags.includes('ZERO_WITH_RECEIPTS'),r.items[0].flags);
  }

  s.section('_stockReconcile — transactions for a code absent from store_items are orphans, never dropped');
  {
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'HT01',name:'Hangtag',unit:'pcs',sizeSpecific:false,balance:100}],
      FIX_TXNS:[{itemCode:'GHOST1',type:'received',qty:50,ts:1000},{itemCode:'ghost1',type:'issued',qty:10,ts:2000}]
    });
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    s.eq('one orphan, not zero',r.orphans.length,1);
    s.eq('code normalised',r.orphans[0].code,'GHOST1');
    s.eq('received carried over',r.orphans[0].received,50);
    s.eq('issued carried over',r.orphans[0].issued,10);
    s.eq('txnCount counts both spellings',r.orphans[0].txnCount,2);
  }

  s.section('_stockReconcile — an unrecognised transaction type is counted, never silently skipped');
  {
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'HT01',name:'Hangtag',unit:'pcs',sizeSpecific:false,balance:10}],
      FIX_TXNS:[{itemCode:'HT01',type:'adjusted',qty:5,ts:1000}]
    });
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    const row=r.items[0];
    s.ok('UNKNOWN_TYPE flagged',row.flags.includes('UNKNOWN_TYPE'),row.flags);
    s.eq('unknownTypeCount is 1',row.unknownTypeCount,1);
    s.eq('the type itself is named',row.unknownTypes.adjusted,1);
    s.eq('received/issued untouched by it',row.received+row.issued,0);
  }

  s.section('_stockReconcile — a sized item gets totals only, never a claimed per-size figure');
  {
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'NL1',name:'Neck Label',unit:'pcs',sizeSpecific:true,sizes:{S:10,M:20}}],
      FIX_TXNS:[]
    });
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    const row=r.items[0];
    s.ok('SIZED_TOTALS_ONLY flagged',row.flags.includes('SIZED_TOTALS_ONLY'),row.flags);
    s.eq('storedBalance is the sum of sizes',row.storedBalance,30);
    s.ok('no per-size breakdown is claimed anywhere on the row',!('sizes'in row)&&!('bySize'in row));
  }

  s.section('_stockReconcile — pre/post seed-date split, and PRE_SEED_TXNS is set');
  {
    // HT01 is a real INITIAL_ITEMS code (seed balance 4600). One receipt
    // lands before the default 2026-05-01 seed date and must be excluded
    // from `expected`; one lands after and must be the only one counted.
    const seedTs=Date.parse('2026-05-01T00:00:00Z');
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'HT01',name:'Hangtag',unit:'pcs',sizeSpecific:false,balance:5000}],
      FIX_TXNS:[
        {itemCode:'HT01',type:'received',qty:1000,ts:seedTs-1000},
        {itemCode:'HT01',type:'received',qty:400,ts:seedTs+1000}
      ]
    });
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    const row=r.items[0];
    s.ok('PRE_SEED_TXNS flagged',row.flags.includes('PRE_SEED_TXNS'),row.flags);
    s.eq('netSinceSeed excludes the pre-seed receipt',row.netSinceSeed,400);
    s.eq('expected = seed value (4600) + net since seed (400)',row.expected,5000);
    s.eq('drift is 0 — the stored balance already agrees',row.drift,0);
    s.eq('report-wide preSeedTxnCount picked it up',r.preSeedTxnCount,1);
  }

  s.section('_stockReconcile — a suspect size key is flagged (H6, the Edit-dialog size parser)');
  {
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'BL2',name:'Belt Label',unit:'pcs',sizeSpecific:true,sizes:{'28" ':100,'30"':50}}],
      FIX_TXNS:[]
    });
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    s.ok('SIZE_KEY_SUSPECT flagged for the whitespace key',r.items[0].flags.includes('SIZE_KEY_SUSPECT'),r.items[0].flags);
  }

  s.section('_stockOverwriteCheck — found vs. not-found are both a result, never a failed lookup');
  {
    const a=app(()=>res(200,{documents:[]}));
    const found=a.run("_stockOverwriteCheck([{action:'⚠ Stock overwritten from master',ts:1000,user:'Afnan',date:'01/05/26'},{action:'Item added via Receive'}])");
    s.eq('found is true',found.found,true);
    s.eq('count is 1',found.count,1);
    const notFound=a.run("_stockOverwriteCheck([{action:'Item added via Receive'},{action:'Item renamed'}])");
    s.eq('found is false',notFound.found,false);
    s.eq('count is 0',notFound.count,0);
  }

  // ── Deliberate breaks — a check nobody has seen fail proves nothing ──
  // These reproduce the two defects `_reconstructFromTxns` has today and
  // confirm `_stockReconcile` would actually catch them if reintroduced.
  s.section('_stockReconcile — verified by breaking it (parseInt instead of parseFloat)');
  {
    const src=require('fs').readFileSync(require('path').join(__dirname,'..','js/store.js'),'utf8');
    const start=src.indexOf('function _stockReconcile(items,txns,opts){');
    const end=src.indexOf('function _stockOverwriteCheck',start);
    const orig=src.slice(start,end);
    const broken=orig.replace('const numOf=v=>{const n=parseFloat(v);','const numOf=v=>{const n=parseInt(v);');
    s.ok('the swap actually changed the source',broken!==orig);
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'DS-E2',name:'Elastic 2 inch',unit:'kg',sizeSpecific:false,balance:1.25}],
      FIX_TXNS:[{itemCode:'DS-E2',type:'received',qty:0.75,ts:1000},{itemCode:'DS-E2',type:'received',qty:0.5,ts:2000}]
    });
    a.run(broken); // redefine _stockReconcile in the sandbox with parseInt
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    s.ok('with parseInt the 0.75+0.5 case fails (net collapses to 0)',r.items[0].net!==1.25,'net came back '+r.items[0].net+' — the parseFloat regression test would now fail as expected');
  }

  s.section('_stockReconcile — verified by breaking it (a Math.max(0,…) clamp)');
  {
    const src=require('fs').readFileSync(require('path').join(__dirname,'..','js/store.js'),'utf8');
    const start=src.indexOf('function _stockReconcile(items,txns,opts){');
    const end=src.indexOf('function _stockOverwriteCheck',start);
    const orig=src.slice(start,end);
    const broken=orig.replace(
      'net:received-issued,unknownCount,unknownTypes,firstTxn,lastTxn,preSeed,',
      'net:Math.max(0,received-issued),unknownCount,unknownTypes,firstTxn,lastTxn,preSeed,'
    );
    s.ok('the clamp actually changed the source',broken!==orig);
    const a=app(()=>res(200,{documents:[]}),{
      FIX_ITEMS:[{code:'ZP-BS25',name:'Black Silver Zip 25"',unit:'pcs',sizeSpecific:false,balance:0}],
      FIX_TXNS:[{itemCode:'ZP-BS25',type:'issued',qty:400,ts:1000}]
    });
    a.run(broken);
    const r=a.run("_stockReconcile(FIX_ITEMS,FIX_TXNS,{seedDate:'2026-05-01'})");
    s.ok('with the clamp the -400 case fails (net floors at 0)',r.items[0].net!==-400,'net came back '+r.items[0].net+' — the no-clamp regression test would now fail as expected');
    s.ok('and NEGATIVE_NET is never set',!r.items[0].flags.includes('NEGATIVE_NET'));
  }

  return s;
};

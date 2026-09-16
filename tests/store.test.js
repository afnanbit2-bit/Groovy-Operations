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

  return s;
};

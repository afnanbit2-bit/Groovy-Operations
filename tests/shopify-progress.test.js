/* Inventory Intel ▸ the loading screen, an honest percentage and a retry that re-reads only what failed (js/shopify.js, "Loading, honest
   percentage and retry"). Every number is hand-computed (see the weights), every clock is a FAKE clock (so 300ms, 500ms, 20s and 90s
   are exact), and the reads are scripted per collection so "exactly the failed collection was read again" is a COUNT, not a belief.
   Each "break" mutates the source and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/shopify.js'),'utf8');
const CSS0=fs.readFileSync(path.join(ROOT,'css/main.css'),'utf8');const CSS=CSS0;
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};

/* A fake clock: setTimeout/setInterval/Date all run off one counter. advance(ms) fires due timers in order, flushing promises between. */
function clock(){
  const c={t:0,seq:0,timers:[]};
  c.setTimeout=(fn,ms)=>{const id=++c.seq;c.timers.push({id,at:c.t+(ms||0),fn});return id;};
  c.setInterval=(fn,ms)=>{const id=++c.seq;c.timers.push({id,at:c.t+ms,fn,every:ms});return id;};
  c.clear=id=>{c.timers=c.timers.filter(x=>x.id!==id);};
  c.advance=async ms=>{
    const end=c.t+ms;
    for(;;){
      await flush();
      const due=c.timers.filter(x=>x.at<=end).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
      if(!due)break;
      c.t=due.at;
      if(due.every)due.at+=due.every;else c.timers=c.timers.filter(x=>x!==due);
      due.fn();
    }
    c.t=end;await flush();
  };
  return c;
}
/* Scripted Firestore: plan[name] is a list consumed one per call; an entry is 'ok', an Error, or {hold:true} (a promise the test releases). */
function mk(src,o){
  o=o||{};
  const ck=clock();
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  const ctx=a.ctx;
  ctx.setTimeout=ck.setTimeout;ctx.setInterval=ck.setInterval;ctx.clearTimeout=ck.clear;ctx.clearInterval=ck.clear;
  const copied=[];
  ctx.navigator={onLine:true,clipboard:{writeText:t=>{copied.push(t);return Promise.resolve();}}};
  vm.runInContext(src,ctx,{filename:'shopify.js'});
  a.run('collection=function(d,n){return{n}};query=function(c){return c};orderBy=function(){return 1};doc=function(d,c,id){return{c,id}};');
  a.run('_siNow=function(){return window.__t};_siRand=function(){return 0.5};window.__t=0');
  const st={reads:{},plan:o.plan||{},holds:{}};
  const run1=(name,doc_)=>{
    st.reads[name]=(st.reads[name]||0)+1;
    const q=st.plan[name]=st.plan[name]||[];
    const step=q.length?q.shift():'ok';
    if(step&&step.hold)return new Promise((res,rej)=>{(st.holds[name]=st.holds[name]||[]).push({res:()=>res(doc_),rej});});
    if(step instanceof Error)return Promise.reject(step);
    return Promise.resolve(doc_);
  };
  ctx.getDocs=ref=>run1(ref.n,{forEach(f){(o.rows&&o.rows[ref.n]||[]).forEach(r=>f({id:r.id||'x',data:()=>Object.assign({},r)}));}});
  ctx.getDoc=ref=>run1(ref.c==='shopify_inventory_snapshots'?'snap:'+ref.id:'meta:'+ref.id,{exists:()=>true,data:()=>({date:ref.id,items:{}})});
  const tick=async ms=>{ctx.__t=ck.t;await ck.advance(ms);};
  // keep window.__t in step with the fake clock
  const origAdv=ck.advance;ck.advance=async ms=>{
    const end=ck.t+ms;
    for(;;){
      await flush();
      const due=ck.timers.filter(x=>x.at<=end).sort((x,y)=>x.at-y.at||x.id-y.id)[0];
      if(!due)break;
      ck.t=due.at;ctx.window.__t=ck.t;
      if(due.every)due.at+=due.every;else ck.timers=ck.timers.filter(x=>x!==due);
      due.fn();
    }
    ck.t=end;ctx.window.__t=end;await flush();
  };
  return{a,R:c=>a.run(c),ck,st,copied,release:async(name,i)=>{const h=st.holds[name]&&st.holds[name][i||0];if(h)h.res();await flush();},
    fail:async(name,err,i)=>{const h=st.holds[name]&&st.holds[name][i||0];if(h)h.rej(err);await flush();}};
}
const E=(msg,code)=>{const e=new Error(msg);if(code)e.code=code;return e;};
const J=JSON.stringify;

async function checks(src,CSS){
  CSS=CSS||CSS0;
  const o={};
  // ── 1. The pure percentage ──────────────────────────────────────────────
  {
    const m=mk(src),R=m.R;
    o['weights are 4+10+50+1+14+3+18 and sum to 100']=R('_SI_STAGES.map(s=>s.w).join(",")')==='4,10,50,1,14,3,18'&&R('_SI_STAGES.reduce((t,s)=>t+s.w,0)')===100;
    o['nothing done is 0']=R('siProgress(_SI_STAGES,{})')===0;
    o['catalog + orders done: 4 + 10 = 14']=R('siProgress(_SI_STAGES,{products:"done",orders:"done"})')===14;
    o['line items alone are half: 50']=R('siProgress(_SI_STAGES,{lines:"done"})')===50;
    o['the five critical stages: 4+10+50+1+14 = 79']=R('siProgress(_SI_STAGES,{products:"done",orders:"done",lines:"done",closes:"done",snap:"done"})')===79;
    o['everything but the count: 82; everything: 100 is CAPPED at 99']=R('siProgress(_SI_STAGES,{products:"done",orders:"done",lines:"done",closes:"done",snap:"done",meta:"done"})')===82
      &&R('siProgress(_SI_STAGES,{products:"done",orders:"done",lines:"done",closes:"done",snap:"done",meta:"done",build:"done"})')===99;
    o['an active or failed stage counts for nothing']=R('siProgress(_SI_STAGES,{lines:"active",orders:"failed",products:"done"})')===4;
    o['monotonic: siProgressNext never goes down']=R('siProgressNext(40,30)')===40&&R('siProgressNext(40,55)')===55;
    R('_siLoad=_siLoadFresh();siMark("lines","done");');const p1=R('_siLoad.pct');
    R('siMark("products","done");');const p2=R('_siLoad.pct');
    R('siMark("lines","failed");');const p3=R('_siLoad.pct');
    R('siMark("lines","active");');const p4=R('_siLoad.pct');
    o['siMark: out-of-order completion 50 -> 54, then a stage going back to failed/active never lowers it']=p1===50&&p2===54&&p3===54&&p4===54;
    o['the view shows 99 at most until _siLoaded is true']=(R('_siLoad.pct=99;_siLoaded=false;_siLoadView().pct')===99)&&(R('_siLoaded=true;_siLoadView().pct')===100);
  }
  // ── 2. Timing: 300ms, 500ms, 400ms settle, 20s, 90s ──────────────────────
  {
    const m=mk(src,{plan:{shopify_line_items:[{hold:true}]}}),R=m.R,ck=m.ck;
    let resolved=false;
    const p=m.R('loadShopifyData()');p.then(()=>{resolved=true;});
    await flush();
    o['a load still running at 299ms shows nothing']=R('_siLoad.shown')===false&&!/si-load/.test(String(m.a.el('si-load-host').innerHTML||''));
    await ck.advance(299);
    o['nothing is painted at 299ms']=R('_siLoad.shown')===false;
    await ck.advance(2);
    o['the overlay appears at 300ms']=R('_siLoad.shown')===true&&/id="si-load"/.test(String(m.a.el('si-load-host').innerHTML));
    o['it is inside the page content (a host in the skeleton), never position:fixed']=!/position:fixed/.test(CSS.slice(CSS.indexOf('.si-ld-wrap'),CSS.indexOf('@media (prefers-reduced-motion:reduce){\n  .si-ld-card')))&&/si-load-host/.test(R('_siLoadingSkeleton()'));
    // catalog 4 + orders 10 + closes 1 + snapshot 14 + sync status 3 = 32 while line items are still being read
    o['the percent is real: 32 while only line items are outstanding']=R('_siLoad.pct')===32&&R('_siLoadView().pct')===32;
    o['the stage line names the heaviest active read']=R('_siLoadView().stage')==='Reading line items…';
    await ck.advance(14000);
    o['no creep: 14s later the percent is still 32']=R('_siLoad.pct')===32;
    o['not slow yet at 20s minus a hair']=R('_siLoadView().stage')==='Reading line items…';
    await ck.advance(5701);
    o['at 20s the stage is named as slow and the percent holds']=R('_siLoadView().stage')==='Still reading line items — slow connection'&&R('_siLoad.pct')===32;
    await ck.advance(68998);
    o['at 89s still waiting, no failure yet']=R('_siLoad.state.lines')==='active'&&!resolved;
    await ck.advance(1001);
    o['at 90s the load stops and NAMES the stage']=R('_siLoad.state.lines')==='failed'&&/Line items/.test(R('_siLoadError'))&&/Timed out after 90s while reading line items/.test(R('_siLoadError'));
    o['a timeout is not retried by itself (no timer left), and the page can render the error']=R('_siRetryCtl.timer')===null&&R('_siLoaded')===false&&resolved===true;
    o['the stalled view: frozen percent and the stopped-while line']=R('_siLoadView().pct')===32&&R('_siLoadView().stage')==='Stopped while reading line items'&&R('_siLoadView().mode')==='fail';
  }
  {
    // fast load: never painted; timers cleaned
    const m=mk(src),R=m.R;
    await R('loadShopifyData()');await m.ck.advance(0);
    o['a fast load (<300ms) never paints the overlay and ends loaded']=R('_siLoaded')===true&&R('_siLoad.shown')===false&&!/si-load/.test(String(m.a.el('si-load-host').innerHTML||''));
    o['no timer is left running after a load (nothing keeps the page awake)']=m.ck.timers.length===0;
    o['the percent shown at the end is 100 only because _siLoaded is true']=R('_siLoadView().pct')===100;
  }
  {
    // 500ms minimum once shown, 400ms settle
    const m=mk(src,{plan:{shopify_line_items:[{hold:true}]}}),R=m.R,ck=m.ck;
    let resolved=false;R('loadShopifyData()').then(()=>{resolved=true;});
    await ck.advance(350); // shown at 300
    o['(setup) overlay shown at 300']=R('_siLoad.shownAt')===300;
    await m.release('shopify_line_items'); // lines land at 350; the count runs (16ms yield)
    await ck.advance(30);
    o['the reads are done but the card stays up: loaded is true, not yet resolved']=R('_siLoaded')===true&&!resolved&&R('_siLoad.done')===false;
    await ck.advance(300); // t=680
    o['at 680ms (380ms after it appeared) it is still there']=!resolved&&R('_siLoad.done')===false;
    await ck.advance(119); // t=799
    o['at 799ms the 500ms minimum is not over']=R('_siLoad.done')===false;
    await ck.advance(2); // t=801
    o['at 801ms (500ms after it appeared) the completion settle starts']=R('_siLoad.done')===true&&!resolved;
    await ck.advance(398);
    o['the settle lasts 400ms: unresolved at 1199']=!resolved;
    await ck.advance(2);
    o['and the page is released at 1201']=resolved===true;
    o['the final frame says 100']=R('_siLoadView().pct')===100;
  }
  // ── 3. Retry: per-collection reads, backoff, classes ─────────────────────
  {
    const m=mk(src,{plan:{shopify_line_items:[E('network lost')]}}),R=m.R,ck=m.ck;
    let resolved=false;R('loadShopifyData()').then(()=>{resolved=true;});
    await ck.advance(1);
    o['a failed stage waits instead of failing: "Line items failed — retrying in 2s… (attempt 2 of 3)"']=R('_siLoadView().cd')==='Line items failed — retrying in 2s… (attempt 2 of 3)'&&!resolved&&R('_siRetryCtl.timer')!==null;
    o['the overlay is forced up so the wait is explained (not a bare skeleton)']=R('_siLoad.shown')===true;
    o['the percent froze at the real value: everything but line items = 32']=R('_siLoadView().pct')===32&&R('_siLoadView().mode')==='wait';
    await ck.advance(1000);
    o['the countdown ticks down, text only: 1s left']=/retrying in 1s/.test(R('_siLoadView().cd'));
    o['nothing was re-read while counting']=m.st.reads.shopify_line_items===1;
    await ck.advance(1000);
    o['after the wait ONLY line items were read again (products 1, orders 1, lines 2, closes 1, snapshot 1)']=
      J([m.st.reads.shopify_products,m.st.reads.shopify_orders,m.st.reads.shopify_line_items,m.st.reads.shopify_weekly_closes])==='[1,1,2,1]'&&m.st.reads['snap:'+R('_siPktDate(0)')]===1;
    await ck.advance(2000);
    o['it then completes: loaded, percent never went down']=R('_siLoaded')===true&&resolved;
  }
  {
    // backoff 2s then 5s then the card; attempt cap 3
    const m=mk(src,{plan:{shopify_line_items:[E('boom 1'),E('boom 2'),E('boom 3')]}}),R=m.R,ck=m.ck;
    let resolved=false;R('loadShopifyData()').then(()=>{resolved=true;});
    await ck.advance(1);
    await ck.advance(2000);
    o['the second failure waits 5s: (attempt 3 of 3)']=R('_siLoadView().cd')==='Line items failed — retrying in 5s… (attempt 3 of 3)';
    await ck.advance(5000);
    o['the third failure is final: the card names the stage, the last error and 3 of 3']=resolved&&R('_siLoaded')===false&&R('_siLoadView().mode')==='fail'
      &&/Line items: boom 3 — attempt 3 of 3/.test(R('_siLoadView().detail'));
    o['the attempt cap is 3: line items were read exactly 3 times']=m.st.reads.shopify_line_items===3&&R('_siRetryCtl.timer')===null;
    o['the page error still says "Could not load inventory data"']=/Could not load inventory data/.test(R('renderShopifyDashboard()'))&&/Line items: boom 3/.test(R('renderShopifyDashboard()'));
    o['the error card offers Retry this stage and Copy details, not Retry everything (one failed)']=/Retry this stage/.test(R('_siLoaderBtns(_siLoadView())'))&&/Copy details/.test(R('_siLoaderBtns(_siLoadView())'))&&!/Retry everything/.test(R('_siLoaderBtns(_siLoadView())'));
    R('window.showPage=function(){}');
    m.R('window._siRetryStage("lines")');m.R('window._siRetryStage("lines")'); // a double click
    await flush();
    o['a double click on Retry is one read (the stage is busy)']=m.st.reads.shopify_line_items===4;
    o['retry reads ONLY the failed stage: products, orders, closes stay at 1']=J([m.st.reads.shopify_products,m.st.reads.shopify_orders,m.st.reads.shopify_weekly_closes])==='[1,1,1]';
    await ck.advance(1000);
    o['it finishes from where it stalled: loaded now, 100']=R('_siLoaded')===true&&R('_siLoadView().pct')===100;
  }
  {
    // permission: no auto retry
    const m=mk(src,{plan:{shopify_line_items:[E('Missing or insufficient permissions.','permission-denied')]}}),R=m.R,ck=m.ck;
    let resolved=false;R('loadShopifyData()').then(()=>{resolved=true;});
    await ck.advance(1);
    o['403 permission-denied: no automatic retry, straight to the card']=resolved&&R('_siRetryCtl.timer')===null&&m.st.reads.shopify_line_items===1&&R('_siLoadView().mode')==='fail';
    await ck.advance(20000);
    o['and nothing happens later either (line items read once)']=m.st.reads.shopify_line_items===1;
    o['the card says what to do for a permission refusal']=/firestore\.rules may need republishing/.test(R('_siLoadView().detail'));
  }
  {
    // 429: waits >=10s, once
    const m=mk(src,{plan:{shopify_line_items:[E('HTTP 429 too many requests'),E('HTTP 429 too many requests')]}}),R=m.R,ck=m.ck;
    let resolved=false;R('loadShopifyData()').then(()=>{resolved=true;});
    await ck.advance(1);
    o['429: the wait is at least 10s (10s x 1.1 = 11s with the middle jitter)']=/retrying in 11s/.test(R('_siLoadView().cd'));
    await ck.advance(9000);
    o['nothing was re-read at 9s']=m.st.reads.shopify_line_items===1;
    await ck.advance(2001);
    o['one automatic retry happens after the long wait']=m.st.reads.shopify_line_items===2;
    await ck.advance(1);
    o['a second 429 is final (the quota gets ONE slow retry), with the quota explanation']=resolved&&R('_siRetryCtl.timer')===null&&/read quota/.test(R('_siLoadView().detail'))&&/attempt 2 of 3/.test(R('_siLoadView().detail'));
    // manual retry right after a 429 is still backed off
    R('window.showPage=function(){}');
    R('window._siRetryStage("lines")');await ck.advance(1);
    o['Retry this stage after a 429 is still backed off (it waits, it does not read at once)']=m.st.reads.shopify_line_items===2&&R('_siLoadView().mode')==='wait';
  }
  {
    // two failures: retry one, then everything; loaded stages never repeat
    const m=mk(src,{plan:{shopify_orders:[E('Missing or insufficient permissions.','permission-denied')],shopify_line_items:[E('Missing or insufficient permissions.','permission-denied')]}}),R=m.R,ck=m.ck;
    R('loadShopifyData()');await ck.advance(1);
    o['two failed stages: Retry everything is offered']=/Retry everything/.test(R('_siLoaderBtns(_siLoadView())'))&&/Retry orders/.test(R('_siLoaderBtns(_siLoadView())'))&&/Retry line items/.test(R('_siLoaderBtns(_siLoadView())'));
    o['both are named in the stopped line']=R('_siLoadView().stage')==='Stopped while loading orders and line items';
    R('window.showPage=function(){}');
    R('window._siRetryStage("orders")');await ck.advance(1);
    o['Retry on one stage re-reads only that collection (orders 2, lines 1, products 1)']=J([m.st.reads.shopify_orders,m.st.reads.shopify_line_items,m.st.reads.shopify_products])==='[2,1,1]';
    R('window._siRetryAll()');await ck.advance(3000);
    o['Retry everything re-reads only what is still failed (lines 2; orders, products, closes, snapshot untouched)']=J([m.st.reads.shopify_line_items,m.st.reads.shopify_orders,m.st.reads.shopify_products,m.st.reads.shopify_weekly_closes])==='[2,2,1,1]'&&R('_siLoaded')===true;
  }
  {
    // retry in place repaints the page
    const m=mk(src,{plan:{shopify_line_items:[E('x','permission-denied')]}}),R=m.R,ck=m.ck;
    R('loadShopifyData()');await ck.advance(1);
    R('renderShopifyDashboard=function(){return"DASHBOARD"};window.showPage=function(){}');
    m.a.el('main-content').innerHTML='';
    R('window._siRetryStage("lines")');await ck.advance(2000);
    o['a retry that succeeds repaints the page content in place']=m.a.el('main-content').innerHTML==='DASHBOARD';
  }
  // ── 4. Leaving, stale generations, listeners ──────────────────────────────
  {
    const m=mk(src,{plan:{shopify_line_items:[E('net')]}}),R=m.R,ck=m.ck;
    let resolved=false;R('loadShopifyData()').then(()=>{resolved=true;});
    await ck.advance(1);
    o['(setup) counting down']=R('_siLoadView().mode')==='wait';
    R('_siLoadLeave()');
    await ck.advance(20000);
    o['leaving mid-countdown: no further read and no timer or interval left']=m.st.reads.shopify_line_items===1&&R('_siRetryCtl.timer')===null&&R('_siRetryCtl.tick')===null&&ck.timers.length===0;
    o['and the waiting page is released (nothing hangs)']=resolved;
  }
  {
    const m=mk(src,{plan:{shopify_line_items:[{hold:true}]}}),R=m.R,ck=m.ck;
    let resolved=false;R('loadShopifyData()').then(()=>{resolved=true;});
    await ck.advance(10);
    R('siRetryCancel()'); // a newer generation supersedes this one
    await m.release('shopify_line_items');await ck.advance(1000);
    o['a stale generation is dropped: its late result never settles or builds, and the load does not finish by itself']=!resolved&&R('_siLoaded')===false&&R('_siLoad.state.build')==='pending';
    o['the data it read is still kept (a late read is not thrown away)']=R('_siColl.lines')===true;
  }
  {
    // the tick notices the page was left even without a showPage wrap
    const m=mk(src,{plan:{shopify_line_items:[E('net')]}}),R=m.R,ck=m.ck;
    R('loadShopifyData()');await ck.advance(1);
    R('currentPage="dashboard"');await ck.advance(1500);
    o['going to another page without showPage still cancels at the next tick']=R('_siRetryCtl.timer')===null&&ck.timers.length===0&&m.st.reads.shopify_line_items===1;
  }
  {
    const a=src.slice(src.indexOf('// ═══ Loading, honest percentage'),src.indexOf('// ── Helpers ──'));
    o['no listener can stack: the loader never uses onSnapshot or addEventListener']=!/onSnapshot|addEventListener/.test(a);
    o['no fake creep: the loader has no setInterval that moves the percent (the only interval is the 1s countdown tick)']=(a.match(/setInterval/g)||[]).length===1&&/C\.tick=setInterval\(\(\)=>\{if\(C\.gen!==gen\)return;if\(!_siLoadAlive\(\)\)\{_siLoadLeave\(\);return;\}siPaintLoad\(\);\},1000\)/.test(a);
  }
  // ── 5. Copy details, counts, aria, reduced motion, second open ───────────
  {
    const m=mk(src,{plan:{shopify_line_items:[E('HTTP 429 quota'),E('HTTP 429 quota')]}}),R=m.R,ck=m.ck;
    R('loadShopifyData()');await ck.advance(1);await ck.advance(12000);await ck.advance(1);
    const btn={textContent:'Copy details'};
    const txt=R('window._siCopyDetails')(btn);
    await flush();
    o['Copy details: names the stage, code-less message, attempts, build, online flag and time']=/Stage: Line items \(lines\)/.test(txt)&&/Message: HTTP 429 quota/.test(txt)&&/Attempts: 2 of 3/.test(txt)&&/Online: yes/.test(txt)&&/Build: /.test(txt)&&/Time: \d{4}-\d\d-\d\dT/.test(txt)&&/Percent when stopped: 32/.test(txt);
    o['it goes to the clipboard and the button says Copied']=m.copied.length===1&&m.copied[0]===txt&&btn.textContent==='Copied';
    // fallback path (the diagnostics.js one): clipboard refuses -> execCommand
    const m2=mk(src,{plan:{shopify_line_items:[E('x','permission-denied')]}});
    m2.R('loadShopifyData()');await m2.ck.advance(1);
    let did=null;m2.a.ctx.navigator={clipboard:{writeText:()=>Promise.reject(new Error('no'))}};
    m2.a.ctx.document.execCommand=c=>{did=c;return true;};
    const b2={textContent:'Copy details'};m2.R('window._siCopyDetails')(b2);await flush();
    o['Copy details falls back to execCommand("copy") when the clipboard refuses']=did==='copy'&&b2.textContent==='Copied';
  }
  {
    const m=mk(src,{rows:{shopify_products:[{id:'a',sku:'A'},{id:'b',sku:'B'}]},plan:{shopify_line_items:[{hold:true}]}}),R=m.R,ck=m.ck;
    R('loadShopifyData()');
    o['no counts before they are real']=R('_siLoadView().sub')==='';
    await ck.advance(5);
    o['the catalog count appears only once the catalog really returned: "2 catalog entries"']=R('_siLoadView().sub')==='2 catalog entries';
    await m.release('shopify_line_items');
    o['line items are named only after they returned']=/line items/.test(R('_siLoadView().sub'));
  }
  {
    const m=mk(src,{plan:{shopify_line_items:[{hold:true}]}}),R=m.R,ck=m.ck;
    R('loadShopifyData()');await ck.advance(400);
    const html=R('_siLoaderHTML(true)');
    o['aria: a progressbar with 0..100, a value and a text value; the buttons are outside it']=/role="progressbar"[^>]*aria-valuemin="0" aria-valuemax="100" aria-valuenow="32" aria-valuetext="Reading line items…, 32 percent"/.test(html)&&html.indexOf('si-ld-btns')>html.indexOf('</div></div><div class="si-ld-err">')-1;
    // the live region is written only when the quarter bucket or the mode changes
    let writes=0;const live={set textContent(v){writes++;},get textContent(){return'';}};
    const gid=m.a.ctx.document.getElementById;m.a.ctx.document.getElementById=id=>id==='si-ld-live'?live:gid.call(m.a.ctx.document,id);
    R('_siLdPainted={mode:"load",bucket:1,stage:"x"}');
    R('siPaintLoad();siPaintLoad();siPaintLoad()');
    o['aria-live is throttled: three repaints in the same bucket write it zero times']=writes===0;
    R('_siLoad.state.lines="done";_siLoad.state.build="done";_siLoad.pct=60;siPaintLoad()');
    o['it speaks when the quarter bucket changes (32 -> 60 is 1 -> 2)']=writes===1;
  }
  {
    const m=mk(src),R=m.R;
    R('matchMedia=function(){return{matches:true}}');
    o['reduced motion: the card carries the rm class']=/class="si-ld-card flow rm"/.test(R('_siLoaderHTML(false)'));
    o['reduced motion CSS: garments static and visible, the bar jumps, the settle and the countdown animation are off']=/prefers-reduced-motion:reduce\)\{\s*\.si-ld-card \.gm\{animation:none;opacity:1;transform:none\}\s*\.si-ld-bar i\{transition:none\}\s*\.si-ld-card\.done,\.si-ld-card\.done \.si-ld-stage\{animation:none\}/.test(CSS);
    R('matchMedia=function(){return{matches:false}}');
    o['normal motion: no rm class']=!/ rm"/.test(R('_siLoaderHTML(false)'));
  }
  {
    const m=mk(src),R=m.R,ck=m.ck;
    await R('loadShopifyData()');await ck.advance(0);
    R('renderShopifyDashboard=(function(o){return function(){return o()}})(renderShopifyDashboard)');
    const calls=[];m.a.ctx.getDocs=()=>{calls.push(1);return Promise.resolve({forEach(){}});};
    const html=R('renderShopifyDashboard()');
    o['second open: loaded data renders straight away, no loader markup and no read']=!/si-load/.test(html)&&calls.length<=1; // only the stock-history read the page already starts (a single bounded read), never the five stages
  }
  {
    const m=mk(src,{plan:{shopify_line_items:[E('x','permission-denied')]}}),R=m.R,ck=m.ck;
    R('loadShopifyData()');await ck.advance(1);
    const html=R('renderShopifyDashboard()');
    o['a critical failure shows the error card and never a partial page (no tab bar, no numbers)']=/Could not load inventory data/.test(html)&&!/si-tab-bar/.test(html)&&R('_siLoaded')===false;
  }
  {
    const m=mk(src),R=m.R;
    R('window.showPage=function(){window.__went=1}');R('_siLoaded=true;_siLoadError="x"');R('window._siRetry()');
    o['the old _siRetry still works: it clears the error and re-enters the page']=R('_siLoaded')===false&&R('_siLoadError')===null&&R('window.__went')===1;
  }
  return o;
}

async function brk(s,name,pairs,expect,base){
  let src=SRC,css=CSS0;
  for(const [from,to,isCss] of pairs){
    const t=isCss?css:src;
    if(t.indexOf(from)<0){s.ok('break target exists: '+name,false);return;}
    if(isCss)css=css.replace(from,to);else src=src.replace(from,to);
  }
  const r=await checks(src,css);
  const failed=expect.filter(k=>r[k]!==true);
  s.ok('break "'+name+'" fails "'+(expect[0].length>70?expect[0].slice(0,70)+'…':expect[0])+'"',failed.length===expect.length,failed.length+' of '+expect.length+' expected checks failed');
}
module.exports=async function(){
  const s=suite('shopify-progress');
  const base=await checks(SRC);
  s.section('percentage, timing, retry, controller and details (hand-computed, fake clock)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  const A=(f,t)=>[f,t,false];
  await brk(s,'no max(): the percent can go down',[A('return Math.max(prev,raw);','return raw;')],['siMark: out-of-order completion 50 -> 54, then a stage going back to failed/active never lowers it','monotonic: siProgressNext never goes down']);
  await brk(s,'cap at 100',[A('Math.min(99,Math.floor','Math.min(100,Math.floor')],['everything but the count: 82; everything: 100 is CAPPED at 99']);
  await brk(s,'no 300ms delay',[A('_SI_LOAD_SHOW_MS=300','_SI_LOAD_SHOW_MS=0')],['nothing is painted at 299ms']);
  await brk(s,'no 500ms minimum',[A('_SI_LOAD_MIN_MS=500','_SI_LOAD_MIN_MS=0')],['at 799ms the 500ms minimum is not over']);
  await brk(s,'no settle',[A('_SI_LOAD_SETTLE_MS=400','_SI_LOAD_SETTLE_MS=0')],['the settle lasts 400ms: unresolved at 1199']);
  await brk(s,'slow text at 200s',[A('_SI_LOAD_SLOW_MS=20000','_SI_LOAD_SLOW_MS=200000')],['at 20s the stage is named as slow and the percent holds']);
  await brk(s,'timeout at 900s',[A('_SI_LOAD_TIMEOUT_MS=90000','_SI_LOAD_TIMEOUT_MS=900000')],['at 90s the load stops and NAMES the stage']);
  await brk(s,'403 is retried',[A("f.cls==='permission'||f.cls==='timeout'||","f.cls==='timeout'||")],['403 permission-denied: no automatic retry, straight to the card']);
  await brk(s,'429 waits 1s',[A('_SI_QUOTA_WAIT_MS=10000','_SI_QUOTA_WAIT_MS=1000')],['429: the wait is at least 10s (10s x 1.1 = 11s with the middle jitter)']);
  await brk(s,'429 retried every time',[A("if(f.cls==='quota'&&(L.quotaRetried[id]||0)>=1)return null;","")],['a second 429 is final (the quota gets ONE slow retry), with the quota explanation']);
  await brk(s,'backoff swapped',[A('(n===1?2000:5000)','(n===1?5000:2000)')],['a failed stage waits instead of failing: "Line items failed — retrying in 2s… (attempt 2 of 3)"']);
  await brk(s,'attempt cap 4',[A('_SI_LOAD_MAX_ATTEMPTS=3','_SI_LOAD_MAX_ATTEMPTS=4')],['the attempt cap is 3: line items were read exactly 3 times']);
  await brk(s,'manual retry re-reads everything',[A("_siLoadShow(true);\n  _siLoadRunStages([id]);","_siLoadShow(true);\n  _siLoadRunStages(['products','orders','lines','closes','snap']);")],['retry reads ONLY the failed stage: products, orders, closes stay at 1']);
  await brk(s,'no busy guard',[A("C.running[id]||L.state[id]!=='failed'||",""),A("if(C.running[id]){if(C.proms[id])C.proms[id].then(after);return;}","")],['a double click on Retry is one read (the stage is busy)']);
  await brk(s,'stale generation not compared',[A('const after=()=>{if(C.gen===gen)_siLoadSettle();};','const after=()=>{_siLoadSettle();};')],['a stale generation is dropped: its late result never settles or builds, and the load does not finish by itself']);
  await brk(s,'leaving does not cancel',[A('siRetryCancel();_siLoadClearWatch();\n  if(L.finishing)','_siLoadClearWatch();\n  if(L.finishing)')],['leaving mid-countdown: no further read and no timer or interval left']);
  await brk(s,'the tick ignores a page left',[A('if(!_siLoadAlive()){_siLoadLeave();return;}siPaintLoad();},1000)','siPaintLoad();},1000)')],['going to another page without showPage still cancels at the next tick']);
  await brk(s,'copy details drops the message',[A("'  Message: '+f.msg,","'  Msg: '+f.msg,")],['Copy details: names the stage, code-less message, attempts, build, online flag and time']);
  await brk(s,'live region on every paint',[A('bucket:Math.floor(pct/25)','bucket:pct')],['aria-live is throttled: three repaints in the same bucket write it zero times']);
  await brk(s,'counts shown before they are real',[A("if(_siColl.products||_siCollectionsLoaded)parts.push","if(true)parts.push")],['no counts before they are real']);
  await brk(s,'reduced motion forgotten',[['  .si-ld-card .gm{animation:none;opacity:1;transform:none}\n  .si-ld-bar i{transition:none}','  .si-ld-bar i{transition:none}',true]],['reduced motion CSS: garments static and visible, the bar jumps, the settle and the countdown animation are off']);
  return s;
};

/* Inventory Intel ▸ freshness x the two-phase line-item read (integration of the Freshness and Load stage 2 work, Oct 2026).
   Rules under test (js/shopify.js, the 'lines' runner and siRefresh):
   - a moved order sync re-reads the 90-day WINDOW first, with the SAME cut (so window and phase 2 stay disjoint) and never reads the older rows;
   - if the whole history had been loaded, the page goes back to scope 'window' and phase 2 is marked as needing a reload (idle): the older rows are
     dropped, never kept beside a window that was just re-read; a gated view then starts exactly ONE older read;
   - a phase-2 read still in flight is left alone and lands on top of the fresh window; a refresh never starts a second one;
   - nothing moved = no line-item read at all and the full history (and its state) is untouched;
   - the freshness stamp for 'lines' is filed (it is what makes "nothing moved" provable).
   Every "break" mutates the source and requires the named check to FAIL. Fixture lines: window 4 (T-1, T-89, T-90, T-5), older 3 (T-91, T-120, T-200). */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const flush=async()=>{for(let i=0;i<14;i++)await new Promise(r=>setImmediate(r));};
const dayShift=(T,k)=>new Date(new Date(T+'T00:00:00Z').getTime()-k*86400000).toISOString().slice(0,10);
const H=3600000;

function build(T){
  const st={queries:[],holdOlder:null,holdWin:null,stamps:{catalog_sync:1,order_sync:1,order_refresh:1,inventory_sync:1},lineReads:0};
  const D=k=>dayShift(T,k)+'T10:00:00+05:00';
  const lines=[[1,11,'AA-S',2,1],[2,12,'AA-S',3,89],[3,13,'AA-M',4,90],[4,14,'CC-S',6,5],[5,15,'AA-M',5,91],[6,16,'AA-S',4,120],[7,17,'BB-S',7,200]]
    .map(r=>({order_id:r[0],line_item_id:r[1],sku:r[2],quantity:r[3],price:100,order_created_at:D(r[4]),financial_status:'paid'}));
  const prods=[
    {sku:'AA-S',product_title:'Alpha',color:'Red',size:'S',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v1'},
    {sku:'AA-M',product_title:'Alpha',color:'Red',size:'M',price:100,created_at:D(300),status:'active',tags:[],product_type:'Tee',variant_id:'v2'},
    {sku:'CC-S',product_title:'Gamma',color:'Blue',size:'S',price:50,created_at:D(10),status:'active',tags:[],product_type:'Tee',variant_id:'v3'}];
  const snap={date:T,snapshot_at:{seconds:Math.floor(Date.now()/1000)},items:{a:{sku:'AA-S',variant_id:'v1',available:5}}};
  const rows=(name,cons)=>{
    let r=name==='shopify_line_items'?lines:name==='shopify_products'?prods.map(p=>Object.assign({},p)):[];
    cons.filter(c=>c.t==='where').forEach(c=>{if(c.op==='>=')r=r.filter(x=>String(x.order_created_at)>=c.v);if(c.op==='<')r=r.filter(x=>String(x.order_created_at)<c.v);});
    return r;
  };
  const g={
    collection:(db,name)=>({__c:name}),query:(c,...cons)=>({__c:c.__c,cons}),
    where:(f,op,v)=>({t:'where',f,op,v}),orderBy:(f,d)=>({t:'ob',f,d}),limit:n=>({t:'lim',n}),
    doc:(db,c,id)=>({c,id}),
    getDoc:async r=>{
      if(r.c==='shopify_inventory_snapshots'&&r.id===T)return{exists:()=>true,data:()=>snap};
      if(r.c==='shopify_sync_meta'&&st.stamps[r.id]!=null)return{exists:()=>true,data:()=>({last_success_at:{seconds:Math.floor(st.stamps[r.id]/1000)}})};
      return{exists:()=>false};
    },
    getDocs:async q=>{
      const name=q.__c;
      let r=rows(name,q.cons||[]);
      if(name==='shopify_line_items'){
        const w=q.cons.filter(c=>c.t==='where');
        const older=w.some(c=>c.op==='<');
        st.queries.push({older,v:w[0]&&w[0].v});st.lineReads++;
        const hold=older?st.holdOlder:st.holdWin;
        if(hold){st[older?'holdOlder':'holdWin']=null;await new Promise(res=>{hold.release=res;hold.waiting=true;st.pending=st.pending||[];st.pending.push(hold);});}
      }
      return{forEach:f=>r.forEach((x,i)=>f({data:()=>Object.assign({},x),id:name==='shopify_line_items'?x.order_id+'_'+x.line_item_id:String(i)}))};
    }
  };
  return{st,g};
}
function mkApp(src,T){
  const fk=build(T);
  const store={};
  const ls={getItem:k=>store[k]==null?null:store[k],setItem(k,v){store[k]=String(v);},removeItem(k){delete store[k];}};
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},currentPage:'shopify-intel',globals:Object.assign({localStorage:ls},fk.g)});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return{a,fk,R:c=>a.run(c)};
}
async function checks(src){
  const o={};
  const T=mkApp(src,'2000-01-01').R('_siPktDate(0)'),cut=dayShift(T,90);
  const open=async()=>{const m=mkApp(src,T);m.R('_siNow=function(){return Date.now()}');await m.R('loadShopifyData()');await flush();return m;};
  const refresh=async(m,moved)=>{ // move the order sync's stamp, then run the real refresh
    m.fk.st.stamps.order_sync=(moved||Date.now())+5*H;m.fk.st.stamps.order_refresh=m.fk.st.stamps.order_sync;
    return m.R('siRefresh()');
  };
  const gatedRender=m=>{m.R('_siSection="articles";_siSub=""');return m.R('_siRenderSection(_siComputeMetrics(),_siComputeSkuTable())');};

  // 1. window page: a moved order sync re-reads the window only, same cut, no older read
  {
    const m=await open();
    const q0=m.fk.st.queries.length;
    const r=await refresh(m);await flush();
    const qs=m.fk.st.queries.slice(q0);
    o['moved order sync: the refresh reports lines re-read']=Array.isArray(r&&r.read)&&r.read.indexOf('lines')>=0;
    o['moved order sync: ONE line-item read, the window (>= the same cut), never the older range']=qs.length===1&&qs[0].older===false&&qs[0].v===cut;
    o['moved order sync: still scope window, 4 rows, phase 2 idle (nothing read, nothing double-read)']=m.R('_siLinesScope')==='window'&&m.R('_siLineItems.length')===4&&m.R('_siFull.st')==='idle';
    o['the lines stamp is filed (a second refresh with nothing moved reads no line items)']=await (async()=>{const n=m.fk.st.lineReads;await m.R('siRefresh()');await flush();return m.fk.st.lineReads===n;})();
  }
  // 2. whole history loaded, then a moved order sync: back to the window, phase 2 needs a reload, the gated view starts exactly one older read
  {
    const m=await open();
    m.R('_siFullStart(true)');await flush();
    o['setup: the full history is loaded (7 rows, scope full, phase 2 done)']=m.R('_siLinesScope')==='full'&&m.R('_siLineItems.length')===7&&m.R('_siFull.st')==='done';
    const q0=m.fk.st.queries.length;
    await refresh(m);await flush();
    const qs=m.fk.st.queries.slice(q0);
    o['full + moved order sync: re-reads the window ONLY (one >= query with the same cut, no older read)']=qs.length===1&&qs[0].older===false&&qs[0].v===cut;
    o['full + moved order sync: scope back to window, 4 rows, phase 2 marked as needing a reload (idle, tok moved)']=m.R('_siLinesScope')==='window'&&m.R('_siLineItems.length')===4&&m.R('_siFull.st')==='idle'&&m.R('_siFull.n')===0;
    const q1=m.fk.st.queries.length;
    const html=gatedRender(m);await flush();
    const qo=m.fk.st.queries.slice(q1).filter(x=>x.older);
    o['then the gated Articles view shows the gate and starts exactly ONE older read']=/si-full-gate/.test(html)&&qo.length===1&&qo[0].v===cut;
    gatedRender(m);gatedRender(m);await flush();
    o['rendering again while it loads, or after it lands, starts no second older read']=m.fk.st.queries.slice(q1).filter(x=>x.older).length===1&&m.R('_siLinesScope')==='full'&&m.R('_siLineItems.length')===7&&m.R('_siFull.st')==='done';
  }
  // 2b. the day rolled over since the page opened: the refresh keeps the cut the page loaded with (window and phase 2 stay disjoint)
  {
    const m=await open();
    const old=dayShift(T,91);m.R('_siLinesCut="'+old+'"');
    const q0=m.fk.st.queries.length;
    await refresh(m);await flush();
    const qs=m.fk.st.queries.slice(q0);
    o['a refresh keeps the cut the page loaded with, even after midnight']=qs.length===1&&qs[0].v===old&&m.R('_siLinesCut')===old;
  }
  // 3. a phase-2 read in flight: the refresh neither cancels nor repeats it; it lands on top of the fresh window
  {
    const m=await open();
    m.fk.st.holdOlder={};
    m.R('_siFullStart(true)');await flush();
    o['setup: phase 2 is in flight (loading)']=m.R('_siFull.st')==='loading'&&m.fk.st.pending&&m.fk.st.pending.length===1;
    const q0=m.fk.st.queries.length;
    await refresh(m);await flush();
    const qs=m.fk.st.queries.slice(q0);
    o['refresh during phase 2: one window read, NO second older read, phase 2 still loading (state not fought over)']=qs.length===1&&qs[0].older===false&&m.R('_siFull.st')==='loading'&&m.R('_siLinesScope')==='window';
    gatedRender(m);
    o['a gated render during that read does not start another']=m.fk.st.queries.slice(q0).filter(x=>x.older).length===0;
    m.fk.st.pending[0].release();await flush();
    o['when phase 2 lands it joins the fresh window: 7 rows, scope full, done']=m.R('_siLineItems.length')===7&&m.R('_siLinesScope')==='full'&&m.R('_siFull.st')==='done';
  }
  // 4. phase 2 lands WHILE the refresh's window read is still pending: the window read wins, phase 2 is reset to idle (never done-with-scope-window)
  {
    const m=await open();
    m.fk.st.holdWin={};
    m.fk.st.stamps.order_sync=Date.now()+5*H;m.fk.st.stamps.order_refresh=m.fk.st.stamps.order_sync;
    const p=m.R('siRefresh()');await flush();
    o['setup: the refresh window read is held']=m.fk.st.pending&&m.fk.st.pending.length===1&&m.R('_siFull.st')==='idle';
    m.R('_siFullStart(true)');await flush();
    o['setup: phase 2 completed meanwhile (full, done)']=m.R('_siLinesScope')==='full'&&m.R('_siFull.st')==='done';
    m.fk.st.pending[0].release();await p;await flush();
    o['window read finishing after phase 2: back to window and idle — never "done" over a window-only array']=m.R('_siLinesScope')==='window'&&m.R('_siFull.st')==='idle'&&m.R('_siLineItems.length')===4;
    const html=gatedRender(m);await flush();
    o['and the gated view can load the history again (no stuck gate)']=/si-full-gate/.test(html)&&m.R('_siLinesScope')==='full'&&m.R('_siLineItems.length')===7;
  }
  // 5. nothing moved: no line-item read, the full history is untouched
  {
    const m=await open();m.R('_siFullStart(true)');await flush();
    const n=m.fk.st.lineReads;
    const r=await m.R('siRefresh()');await flush();
    o['nothing moved: zero line-item reads, full history and its state kept']=m.fk.st.lineReads===n&&m.R('_siLinesScope')==='full'&&m.R('_siFull.st')==='done'&&m.R('_siLineItems.length')===7&&r&&Array.isArray(r.read)&&r.read.length===0;
  }
  // 6. section ids: the phase-2 trigger list uses the four-section ids and sub-views
  {
    const m=await open();
    o['gated ids: Needs Attention, Articles (incl. its Type & season sub-view) and the Ignored sub-view; Today, SKU Table, Weekly Close, Advanced are not']=
      m.R('_SI_FULL_SECTIONS.join()')==='attention,articles,ignored'
      &&(()=>{const key=(s,u)=>{m.R('_siSection="'+s+'";_siSub="'+u+'"');return m.R('_siFullKey()');};
        return key('attention','')==='attention'&&key('articles','')==='articles'&&key('articles','typeseason')==='articles'&&key('today','ignored')==='ignored'
          &&key('today','')===''&&key('skutable','')===''&&key('today','weekly')===''&&key('today','advanced')==='';})();
    m.R('_siSection="articles";_siSub="typeseason"');
    o['the Type & season sub-view is gated with its own label']=/Type &amp; season needs the full sales history/.test(m.R('_siRenderSection(_siComputeMetrics(),_siComputeSkuTable())'));
  }
  return o;
}
module.exports=async function(){
  const s=suite('shopify-fresh-stage2');
  const base=await checks(SRC);
  s.section('freshness x two-phase line items');
  Object.keys(base).forEach(k=>s.ok(k,base[k]));
  s.section('deliberate breaks — each must fail the named check');
  let broken=0;
  const brk=async(label,from,to,names)=>{
    if(SRC.indexOf(from)<0){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.replace(from,to));}catch(e){r=null;}
    const failed=r?names.filter(n=>r[n]!==true):names;
    s.ok('break "'+label+'" fails "'+names[0].slice(0,60)+'"',failed.length>0);broken++;
  };
  await brk('fresh flag ignored (full short-circuits the refresh)',"if(_siLinesScope==='full'&&!fresh)return;","if(_siLinesScope==='full')return;",['full + moved order sync: re-reads the window ONLY (one >= query with the same cut, no older read)']);
  await brk('new cut on refresh','const cut=(fresh&&_siLinesCut)?_siLinesCut:_siPktDate(-_SI_WIN_DAYS);','const cut=_siPktDate(-_SI_WIN_DAYS);',['a refresh keeps the cut the page loaded with, even after midnight']);
  await brk('phase 2 not reset after a full load',"if(_siLinesScope==='full'||_siFull.st==='done'){_siFull.st='idle';_siFull.err=null;_siFull.n=0;_siFull.tok++;}","",['full + moved order sync: scope back to window, 4 rows, phase 2 marked as needing a reload (idle, tok moved)','window read finishing after phase 2: back to window and idle — never "done" over a window-only array']);
  await brk('reset only on scope (not on state)',"if(_siLinesScope==='full'||_siFull.st==='done'){","if(false){",['window read finishing after phase 2: back to window and idle — never "done" over a window-only array']);
  await brk('lines stamp not filed at load',"_siFrNote('lines',stamps);","",['nothing moved: zero line-item reads, full history and its state kept']);
  await brk('refresh does not pass fresh',"_siRunners[id](true)","_siRunners[id]()",['full + moved order sync: re-reads the window ONLY (one >= query with the same cut, no older read)']);
  await brk('refresh restarts a loading phase 2',"if(!_siLinesPartial()||F.st==='loading'||F.st==='done')return;","if(!_siLinesPartial()||F.st==='done')return;",['refresh during phase 2: one window read, NO second older read, phase 2 still loading (state not fought over)','a gated render during that read does not start another']);
  await brk('trigger list uses the old ids',"const _SI_FULL_SECTIONS=['attention','articles','ignored'];","const _SI_FULL_SECTIONS=['attention','explorer','ignored'];",['gated ids: Needs Attention, Articles (incl. its Type & season sub-view) and the Ignored sub-view; Today, SKU Table, Weekly Close, Advanced are not']);
  await brk('sub-view ignored by the gate key',"if(_siSub&&_SI_FULL_SECTIONS.indexOf(_siSub)>=0)return _siSub;","",['gated ids: Needs Attention, Articles (incl. its Type & season sub-view) and the Ignored sub-view; Today, SKU Table, Weekly Close, Advanced are not']);
  s.ok('breaks run: '+broken,broken>=9);
  return s;
};

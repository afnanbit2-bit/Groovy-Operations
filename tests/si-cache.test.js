/* Inventory Intel device copy: js/si-cache.js (window.siCache), the IndexedDB storage half.
   Runs the real file against a hand-written in-memory fake indexedDB (open / transaction / objectStore get put delete clear
   getAll getAllKeys openCursor count, request onsuccess / onerror, tx oncomplete / onabort) and a FAKE clock (setTimeout +
   Date.now), so "bounded by about five seconds" and "oldest first" are numbers, not beliefs. The fake has failure modes:
   open error, open that throws, an open or request that never answers, a QuotaExceededError on put (in the request OR as a
   transaction abort), a throw on put (DataCloneError). The contract (from the brief, not guessed): get never rejects and
   returns null or {value,savedAt,meta}; put never rejects and returns a boolean; no signed-in user = miss / false; a record
   written by another version is a miss; records are keyed <uid>:<key>; quota = evict oldest, retry once, then false with
   lastError; clear removes every user's records. Each "break" mutates the source in a string and requires the named check to
   FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'../js/si-cache.js'),'utf8');
const flush=async()=>{for(let i=0;i<6;i++){await new Promise(r=>setImmediate(r));await new Promise(r=>setTimeout(r,2));}};

/* ── the fake indexedDB ── */
function fakeIdb(clk){
  const f={dbs:{},mode:{},stats:{opens:0,puts:[],gets:[],dels:[],clears:0},quotaLeft:0,quotaStyle:'request'};
  const mkReq=(run)=>{
    const r={onsuccess:null,onerror:null,result:undefined,error:null,_l:{}};
    r.addEventListener=(t,fn)=>{(r._l[t]=r._l[t]||[]).push(fn);};
    r.__fire=(t,ev)=>{const e=Object.assign({target:r,type:t},ev||{});if(r['on'+t])r['on'+t](e);(r._l[t]||[]).forEach(fn=>fn(e));};
    setImmediate(()=>{try{run(r);}catch(e){r.error=e;r.__fire('error');}});
    return r;
  };
  f.open=(name)=>{
    f.stats.opens++;
    if(f.mode.openThrows)throw Object.assign(new Error('SecurityError'),{name:'SecurityError'});
    const req=mkReq(r=>{
      if(f.mode.openNever)return;                       // never answers: only the timeout can save the caller
      if(f.mode.openError){r.error=Object.assign(new Error('open failed'),{name:'UnknownError'});r.__fire('error');return;}
      let db=f.dbs[name];const fresh=!db;
      if(fresh)db=f.dbs[name]={name,stores:{}};
      const handle=dbHandle(db);
      r.result=handle;
      if(fresh){const up=mkReq(()=>{});/* upgrade runs inline */r.__fire('upgradeneeded',{target:r,oldVersion:0});}
      r.__fire('success');
    });
    f.lastOpen=req;
    return req;
  };
  function dbHandle(db){
    const h={name:db.name,objectStoreNames:{contains:n=>!!db.stores[n]},close(){},
      createObjectStore(n,opt){db.stores[n]=db.stores[n]||{opt:opt||{},rows:new Map()};return storeHandle(db,n,null);},
      onversionchange:null,onclose:null,
      transaction(names,mode){
        if(f.mode.txThrows)throw Object.assign(new Error('InvalidStateError'),{name:'InvalidStateError'});
        const nm=Array.isArray(names)?names[0]:names;
        if(!db.stores[nm])throw Object.assign(new Error('NotFoundError'),{name:'NotFoundError'});
        const tx={mode,oncomplete:null,onerror:null,onabort:null,error:null,_l:{},objectStore:()=>storeHandle(db,nm,tx),abort(){}};
        tx.addEventListener=(t,fn)=>{(tx._l[t]=tx._l[t]||[]).push(fn);};
        tx.__fire=(t,src)=>{const e={target:src||tx,type:t};if(tx['on'+t])tx['on'+t](e);(tx._l[t]||[]).forEach(fn=>fn(e));};
        tx._pending=0;tx._idle=()=>{};
        let spins=0;const finish=()=>{if(tx._failed||tx._done)return;if(tx._pending>0){if(++spins<300)setTimeout(finish,1);return;} /* capped: a transaction whose request never answers must not keep the process alive */tx._done=true;tx.__fire('complete');};
        setTimeout(()=>setTimeout(finish,0),0);
        return tx;
      }};
    return h;
  }
  function keyOf(db,n,value,key){const o=db.stores[n].opt;if(o.keyPath)return value[o.keyPath];return key;}
  function storeHandle(db,n,tx){
    const S=()=>db.stores[n].rows;
    // a request keeps its transaction open until it answers (a request that never answers = a transaction that never completes)
    const op=(run)=>{if(tx)tx._pending++;return mkReq(r=>{
      if(f.mode.requestNever)return;
      if(f.mode.requestError){r.error=Object.assign(new Error('request failed'),{name:'UnknownError'});fail(r);return;}
      run(r);if(tx)tx._pending--;
    });};
    // spec order: the request's error event, bubbling to the transaction's onerror (tx.error still NULL there), THEN the abort (tx.error set)
    const fail=(r)=>{if(tx){tx._failed=true;tx._pending--;}r.__fire('error');if(tx){tx.__fire('error',r);tx.error=r.error;/* the abort event is a QUEUED task: microtasks (the caller's .then) run first */setImmediate(()=>tx.__fire('abort'));}};
    const ok=(r,res)=>{r.result=res;r.__fire('success');};
    const s={
      get:(k)=>{f.stats.gets.push(k);return op(r=>ok(r,S().get(k)));},
      getAll:()=>op(r=>ok(r,[...S().values()])),
      getAllKeys:()=>op(r=>ok(r,[...S().keys()])),
      count:()=>op(r=>ok(r,S().size)),
      put:(value,key)=>{
        if(f.mode.putThrows)throw Object.assign(new Error('DataCloneError'),{name:'DataCloneError'});
        const k=keyOf(db,n,value,key);f.stats.puts.push(k);
        return op(r=>{
          if(f.quotaLeft>0){f.quotaLeft--;r.error=Object.assign(new Error('The quota has been exceeded.'),{name:'QuotaExceededError'});
            if(f.quotaStyle==='abort'){/* quota surfaced at commit: only the transaction aborts, with tx.error set */if(tx){tx._failed=true;tx._pending--;tx.error=r.error;tx.__fire('abort');}}else fail(r);return;}
          S().set(k,value);ok(r,k);});
      },
      add:(...a)=>s.put(...a),
      delete:(k)=>{f.stats.dels.push(k);return op(r=>{S().delete(k);ok(r,undefined);});},
      clear:()=>{f.stats.clears++;return op(r=>{S().clear();ok(r,undefined);});},
      openCursor:()=>op(r=>{
        const ents=[...S().entries()];let i=0;
        const step=()=>{
          if(i>=ents.length){r.result=null;r.__fire('success');return;}
          const [k,v]=ents[i];
          r.result={key:k,primaryKey:k,value:v,continue(){i++;setImmediate(step);},delete(){S().delete(k);return mkReq(q=>{q.result=undefined;q.__fire('success');});}};
          r.__fire('success');
        };
        step();})
    };
    return s;
  }
  /* test access: every record currently stored, value only */
  f.rows=()=>{const out=[];Object.keys(f.dbs).forEach(d=>Object.keys(f.dbs[d].stores).forEach(n=>f.dbs[d].stores[n].rows.forEach((v,k)=>out.push({k,v}))));return out;};
  f.keys=()=>f.rows().map(x=>String(x.k)).sort();
  return f;
}

/* ── a context with the fake idb, a signed-in user and a fake clock ── */
function load(src,o){
  o=o||{};
  const clk={t:1790000000000,seq:0,timers:[]};
  const idb=fakeIdb(clk);
  const FakeDate=class extends Date{constructor(...a){if(a.length)super(...a);else super(clk.t);}static now(){return clk.t;}};
  const g={
    indexedDB:o.noIdb?undefined:idb,
    auth:{currentUser:o.noUser?null:{uid:o.uid||'u1'}},
    Date:FakeDate,
    setTimeout:(fn,ms)=>{const id=++clk.seq;clk.timers.push({id,at:clk.t+(ms||0),fn});return id;},
    clearTimeout:id=>{clk.timers=clk.timers.filter(x=>x.id!==id);}
  };
  g.navigator={storage:{estimate:async()=>({usage:idb.rows().reduce((n,x)=>n+JSON.stringify(x.v).length,0)})}};
  const a=harness.loadApp({files:[],globals:g});
  a.ctx.window=a.ctx;                                   // a classic script's window IS its global
  vm.runInContext(src,a.ctx,{filename:'si-cache.js'});
  const adv=async ms=>{
    const end=clk.t+ms;
    for(;;){
      await flush();
      const due=clk.timers.filter(x=>x.at<=end).sort((p,q)=>p.at-q.at||p.id-q.id)[0];
      if(!due)break;
      clk.t=due.at;clk.timers=clk.timers.filter(x=>x!==due);due.fn();
    }
    clk.t=end;await flush();
  };
  const as=uid=>{a.ctx.auth.currentUser=uid?{uid}:null;};
  return{a,idb,clk,adv,as,C:()=>a.ctx.siCache,ctx:a.ctx,tick:ms=>{clk.t+=ms;}};
}
/* settle a promise under the fake clock: {done,value,error} */
function track(p){const s={done:false,value:undefined,error:undefined,rejected:false};p.then(v=>{s.done=true;s.value=v;},e=>{s.done=true;s.rejected=true;s.error=e;});return s;}
const J=JSON.stringify;

async function checks(src){
  const o={};
  const guard=async(label,fn)=>{try{await fn();}catch(e){o[label]=false;o[label+' [threw: '+(e&&e.message||e)+']']=false;}};
  // 1. round trip
  await guard('round trip',async()=>{
    const m=load(src),C=m.C();
    o['siCache exists with the contract surface (VERSION, available, get, put, del, clear, bytesApprox, _recordKey)']=!!C&&['available','get','put','del','clear','bytesApprox','_recordKey'].every(k=>typeof C[k]==='function')&&C.VERSION!=null;
    o['available() is true with a working indexedDB and false without one']=C.available()===true&&load(src,{noIdb:true}).C().available()===false;
    const val={rows:[{a:1,b:[1,2,3]},{a:2,s:'x'}],n:5,nested:{k:'v'}};
    const meta={stamps:{orders:123},cut:'2026-07-10'};
    m.tick(1000);
    const okPut=await C.put('lines',val,meta);
    o['put returns true on success']=okPut===true;
    const got=await C.get('lines');
    o['round trip: value comes back deep-equal']=!!got&&J(got.value)===J(val);
    o['round trip: meta comes back deep-equal']=!!got&&J(got.meta)===J(meta);
    o['round trip: savedAt is the (fake) time of the put, a number']=!!got&&got.savedAt===m.clk.t-0&&typeof got.savedAt==='number';
    o['a key that was never written is a miss (null), not undefined or an error']=(await C.get('nope'))===null;
    await C.put('lines',{replaced:true},{m:2});
    const g2=await C.get('lines');
    o['put on the same key replaces: one record, the new value']=!!g2&&J(g2.value)==='{"replaced":true}'&&m.idb.rows().length===1;
    await C.del('lines');
    o['del removes the record: the next get is null']=(await C.get('lines'))===null&&m.idb.rows().length===0;
    o['_recordKey(uid,key) is "<uid>:<key>"']=C._recordKey('u1','lines')==='u1:lines';
    o['the database is named groovy-si-cache']=Object.keys(m.idb.dbs).join()==='groovy-si-cache';
    o['the stored record is keyed "<uid>:<key>" (the bare auth.currentUser.uid)']=m.idb.keys().join()===''; // after del; checked below with a live record
    await C.put('products',{p:1},{});
    o['the stored record is keyed "<uid>:<key>" (the bare auth.currentUser.uid)']=m.idb.keys().join()==='u1:products';
    o['bytesApprox resolves to a positive number after a write (it reports navigator.storage.estimate().usage, origin-wide)']=await (async()=>{const b=await C.bytesApprox();return typeof b==='number'&&isFinite(b)&&b>0;})();
  });
  // 2. isolation, no user, version
  await guard('isolation',async()=>{
    const m=load(src),C=m.C();
    await C.put('orders',{who:'u1'},{});
    m.as('u2');
    o['per-uid isolation: user 2 does not see user 1\'s record']=(await C.get('orders'))===null;
    await C.put('orders',{who:'u2'},{});
    o['per-uid isolation: both users\' records coexist under different keys']=m.idb.keys().join()==='u1:orders,u2:orders';
    m.as('u1');
    const g1=await C.get('orders');
    o['per-uid isolation: user 1 still reads their own value after user 2 wrote']=!!g1&&g1.value.who==='u1';
    await C.del('orders');
    o['del removes only the signed-in user\'s record']=m.idb.keys().join()==='u2:orders';
    m.as(null);
    o['no signed-in user: get is null']=(await C.get('orders'))===null;
    o['no signed-in user: put is false and writes nothing']=(await C.put('x',{a:1},{}))===false&&m.idb.keys().join()==='u2:orders';
    const n0=m.idb.stats.dels.length;
    await C.del('orders');
    o['no signed-in user: del is a harmless no-op (does not delete another user\'s record)']=m.idb.keys().join()==='u2:orders'&&m.idb.stats.dels.length===n0;
    const m2=load(src,{noUser:true});
    o['no signed-in user from the start: get null, put false']=(await m2.C().get('k'))===null&&(await m2.C().put('k',1,{}))===false;
    const m3=load(src);m3.ctx.auth=undefined;
    o['no auth object at all: get null, put false, never throws']=(await m3.C().get('k'))===null&&(await m3.C().put('k',1,{}))===false;
  });
  await guard('version',async()=>{
    const m=load(src),C=m.C();
    await C.put('closes',{ok:1},{});
    const rows=m.idb.rows();
    const rec=rows[0].v;
    // find the version field by value (do not assume its name): bump every numeric field equal to VERSION
    const vf=Object.keys(rec).filter(k=>rec[k]===C.VERSION);
    o['the record carries the cache VERSION in a field of its own']=vf.length>=1;
    vf.forEach(k=>{rec[k]=C.VERSION+1;});
    o['a record written by another version is a miss (null), not a stale hit']=(await C.get('closes'))===null;
    vf.forEach(k=>{rec[k]=C.VERSION;});
    o['restoring the version makes it a hit again (the miss was the version, not damage)']=!!(await C.get('closes'));
    // a corrupt row (not an object / no value) is a miss, never a throw
    for(const bad of [null,'junk',42,{},{v:'x'}]){
      m.idb.dbs['groovy-si-cache'].stores[Object.keys(m.idb.dbs['groovy-si-cache'].stores)[0]].rows.set('u1:closes',bad);
      const r=track(C.get('closes'));await m.adv(10);
      o['a corrupt stored row ('+J(bad)+') is a miss, never a rejection']=r.done&&!r.rejected&&r.value===null;
    }
  });
  // 3. never rejects, every failure mode
  const modes=[['open throws',{openThrows:true}],['open errors',{openError:true}],['a transaction throws',{txThrows:true}],['a request errors',{requestError:true}],['put throws (DataCloneError)',{putThrows:true}]];
  for(const [name,mode] of modes){
    await guard('mode '+name,async()=>{
      const m=load(src),C=m.C();Object.assign(m.idb.mode,mode);
      const g=track(C.get('k')),p=track(C.put('k',{a:1},{})),d=track(Promise.resolve().then(()=>C.del('k'))),c=track(Promise.resolve().then(()=>C.clear())),b=track(Promise.resolve().then(()=>C.bytesApprox()));
      await m.adv(8000);
      o['never rejects ('+name+'): get resolves null']=g.done&&!g.rejected&&g.value===null;
      o['never rejects ('+name+'): put resolves false']=p.done&&!p.rejected&&p.value===false;
      o['never rejects ('+name+'): del, clear and bytesApprox settle without rejecting']=d.done&&!d.rejected&&c.done&&!c.rejected&&b.done&&!b.rejected;
    });
  }
  await guard('no idb',async()=>{
    const m=load(src,{noIdb:true}),C=m.C();
    const g=track(C.get('k')),p=track(C.put('k',1,{})),c=track(Promise.resolve().then(()=>C.clear()));
    await m.adv(8000);
    o['never rejects (no indexedDB): get null, put false, clear settles']=g.done&&g.value===null&&p.done&&p.value===false&&c.done&&!c.rejected;
  });
  // 4. timeout
  for(const [name,mode] of [['open never answers',{openNever:true}],['a request never answers',{requestNever:true}]]){
    await guard('timeout '+name,async()=>{
      const m=load(src),C=m.C();Object.assign(m.idb.mode,mode);
      const g=track(C.get('k')),p=track(C.put('k',{a:1},{})),c=track(Promise.resolve().then(()=>C.clear()));
      await m.adv(1000);
      o['timeout ('+name+'): still waiting at 1 second (it does not give up early)']=!g.done&&!p.done;
      await m.adv(5000);
      o['timeout ('+name+'): get has resolved null by 6 seconds']=g.done&&!g.rejected&&g.value===null;
      o['timeout ('+name+'): put has resolved false by 6 seconds']=p.done&&!p.rejected&&p.value===false;
      await m.adv(5000);
      o['timeout ('+name+'): clear has settled without rejecting by 11 seconds']=c.done&&!c.rejected;
      // the cache recovers once the store answers again
      m.idb.mode={};
      const ok=track(C.put('k2',{a:1},{}));await m.adv(1000);
      o['timeout ('+name+'): a later call works once indexedDB answers again (a stuck open does not poison the module)']=ok.done&&ok.value===true;
    });
  }
  // 5. quota
  await guard('quota',async()=>{
    for(const style of ['request','abort']){
      const m=load(src),C=m.C();m.idb.quotaStyle=style;
      m.tick(10);await C.put('a',{n:'a'},{});m.tick(10);await C.put('b',{n:'b'},{});m.tick(10);await C.put('c',{n:'c'},{});
      m.idb.quotaLeft=1;m.tick(10);m.idb.stats.puts.length=0;
      const r=track(C.put('d',{n:'d'},{}));await m.adv(500);
      o['quota ('+style+'): one QuotaExceededError then success = put resolves true (evict-oldest-then-retry)']=r.done&&r.value===true;
      o['quota ('+style+'): the OLDEST record (a) was evicted, the newest other record (c) and the new one (d) are kept']=m.idb.keys().indexOf('u1:a')<0&&m.idb.keys().indexOf('u1:c')>=0&&m.idb.keys().indexOf('u1:d')>=0;
      o['quota ('+style+'): the put was attempted exactly twice (retry ONCE, not in a loop)']=m.idb.stats.puts.filter(k=>k==='u1:d').length===2;
    }
    {
      const m=load(src),C=m.C();
      m.tick(10);await C.put('a',{n:'a'},{});m.tick(10);await C.put('b',{n:'b'},{});
      m.idb.quotaLeft=999;m.idb.stats.puts.length=0;
      const r=track(C.put('d',{n:'d'},{}));await m.adv(500);
      o['quota that never clears: put resolves false (does not reject, does not loop)']=r.done&&!r.rejected&&r.value===false;
      o['quota that never clears: the put was attempted at most twice']=m.idb.stats.puts.filter(k=>k==='u1:d').length<=2&&m.idb.stats.puts.filter(k=>k==='u1:d').length>=2;
      const le=C.lastError;
      o['quota that never clears: lastError is set and names the quota']=!!le&&/quota/i.test(String(le&&(le.name||le.message||le)));
      m.idb.quotaLeft=0;
      const ok=track(C.put('e',{n:'e'},{}));await m.adv(500);
      o['after a quota failure a later put on a store with room works']=ok.done&&ok.value===true;
    }
  });
  // 6. clear
  await guard('clear',async()=>{
    const m=load(src),C=m.C();
    await C.put('orders',{a:1},{});await C.put('lines',{a:2},{});
    m.as('u2');await C.put('orders',{a:3},{});m.as('u3');await C.put('snap',{a:4},{});
    o['setup: four records for three users']=m.idb.rows().length===4;
    m.as('u1');
    await C.clear();
    o['clear removes EVERY user\'s records, not only the signed-in one\'s']=m.idb.rows().length===0;
    m.as(null);
    await C.put('x',1,{}); // false, no user
    await C.clear();
    o['clear works with nobody signed in and on an empty store (resolves, no throw)']=true;
    const m2=load(src),C2=m2.C();
    await C2.put('k',{a:1},{});
    o['bytesApprox grows with data and drops after clear']=await (async()=>{const b1=await C2.bytesApprox();await C2.put('k2',{big:'x'.repeat(5000)},{});const b2=await C2.bytesApprox();await C2.clear();const b3=await C2.bytesApprox();return b2>b1&&b3<b2;})();
  });
  return o;
}

module.exports=async function(){
  const s=suite('si-cache');
  s.section('the device copy storage (js/si-cache.js) against a fake indexedDB and a fake clock');
  const base=await checks(SRC);
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks - each must fail the named check');
  const names=Object.keys(base);
  const brk=async(label,from,to,failing)=>{
    if(SRC.indexOf(from)<0){s.ok('break target exists: '+label,false);return;}
    let r;try{r=await checks(SRC.replace(from,to));}catch(e){r=null;}
    const failed=names.filter(k=>!r||r[k]!==true);
    const hit=failing.filter(f=>failed.some(k=>k.indexOf(f)===0));
    s.ok('break "'+label+'" fails "'+failing.join('" and "')+'"',hit.length===failing.length,hit.length===failing.length?undefined:'failed: '+failed.slice(0,4).join(' | '));
  };
  await brk('the 5 second bound is gone',"if (!done) { done = true; _setErr('timeout'); resolve(fallback); }","/* no bound */",['timeout (open never answers): get has resolved null','timeout (a request never answers): put has resolved false']);
  await brk('the key ignores the uid',"return String(uid) + ':' + String(key);","return String(key);",['per-uid isolation: both users','_recordKey(uid,key) is']);
  await brk('the record version is not checked',"rec.v === VERSION &&","true &&",['a record written by another version is a miss']);
  await brk('a missing user writes under an anonymous key',"if (!uid) return Promise.resolve(false);","uid = uid || 'anon';",['no signed-in user: put is false']);
  await brk('quota: no evict-and-retry',"return _evictOldest(uid, rk).then(function () { return _putOnce(rk, uid, key, value, meta); });","return false;",['quota (abort): one QuotaExceededError then success']);
  await brk('clear only removes one key',"st.clear(); set(true);","st.delete('u1:orders'); set(true);",['clear removes EVERY user']);
  await brk('a version-mismatched or corrupt row is returned as a hit',"if (rec && rec.v === VERSION && rec.uid === uid && typeof rec.savedAt === 'number') {","if (rec) {",['a corrupt stored row']);
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   A stand-in for firebase-admin, for the Master Accounts function suites
   (ma-server, ma-attach, ma-share, ma-backup). Not a *.test.js — a helper.

   CI installs nothing, so the real SDK is never loaded: `firebase-admin` is
   replaced through Module._load (the marketing-codes / passkey pattern) with
   an in-memory Firestore that behaves like the real one where it matters to
   these functions:
   - a write carrying `undefined` anywhere is REFUSED (the real SDK's default
     — a function that would crash in production crashes here too);
   - create() — on a ref, a batch or a transaction — refuses a document that
     already exists;
   - FieldValue.increment() adds; transactions apply their writes only after
     the body resolves, and re-run the body when a document they read was
     written meanwhile (optimistic, like the real one); every batch and
     transaction is recorded in order;
   - verifyIdToken records whether checkRevoked was asked for.
   `state.failRead` / `state.failWrite` make the next reads or commits throw;
   `state.reads` counts every read (a get, a query, a transaction's get);
   `state.initError` makes the Admin SDK fail to START (no app yet, and
   credential.cert throws that message — firebase-admin's own shape when a
   service account's key will not parse).
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const path=require('path');
const Module=require('module');
const ROOT=path.join(__dirname,'..');

const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function undefinedAt(v,p){
  if(v===undefined)return p||'(root)';
  if(v&&typeof v==='object'&&!v.__op){
    for(const k of Object.keys(v)){const r=undefinedAt(v[k],(p?p+'.':'')+k);if(r)return r;}
  }
  return null;
}
function guard(data,where){
  const u=undefinedAt(data,'');
  if(u)throw new Error('Cannot use "undefined" as a Firestore value (found in field "'+u+'") — '+where);
}

function makeAdmin(state){
  state.docs=state.docs||{};
  state.batches=state.batches||[];
  state.txs=state.txs||[];
  state.verify=state.verify||[];
  state.tokens=state.tokens||{};
  const INC=n=>({__op:'inc',n});
  const apply=(target,data)=>{
    for(const [k,v] of Object.entries(data)){
      if(v&&v.__op==='inc')target[k]=(Number(target[k])||0)+v.n;
      else target[k]=clone(v);
    }
  };
  const key=(c,id)=>c+'/'+id;
  const snap=(c,id)=>{const d=state.docs[key(c,id)];return{id,exists:d!==undefined,ref:ref(c,id),data:()=>clone(d)};};
  const readFail=()=>{state.reads=(state.reads||0)+1;if(state.failRead){const e=state.failRead;if(!state.failReadSticky)state.failRead=null;throw typeof e==='string'?new Error(e):e;}};
  const writeFail=()=>{if(state.failWrite){const e=state.failWrite;if(!state.failWriteSticky)state.failWrite=null;throw typeof e==='string'?new Error(e):e;}};
  state.ver=state.ver||{};
  const bump=k=>{state.ver[k]=(state.ver[k]||0)+1;};
  const ops={
    set:(c,id,d)=>{guard(d,'set '+key(c,id));state.docs[key(c,id)]=clone(d);bump(key(c,id));},
    create:(c,id,d)=>{guard(d,'create '+key(c,id));if(state.docs[key(c,id)]!==undefined)throw Object.assign(new Error('ALREADY_EXISTS: '+key(c,id)),{code:6});state.docs[key(c,id)]=clone(d);bump(key(c,id));},
    update:(c,id,d)=>{guard(d,'update '+key(c,id));const t=state.docs[key(c,id)];if(t===undefined)throw Object.assign(new Error('NOT_FOUND: '+key(c,id)),{code:5});apply(t,d);bump(key(c,id));}
  };
  function ref(c,id){
    return{
      id,path:key(c,id),
      async get(){readFail();return snap(c,id);},
      async set(d){writeFail();ops.set(c,id,d);},
      async create(d){writeFail();ops.create(c,id,d);},
      async update(d){writeFail();state.updates=(state.updates||[]);state.updates.push({path:key(c,id),data:clone(d)});ops.update(c,id,d);}
    };
  }
  const matches=(d,f,op,v)=>{
    if(op==='==')return d[f]===v;
    if(op==='in')return Array.isArray(v)&&v.indexOf(d[f])>=0;
    throw new Error('the fake supports == and in, not '+op);
  };
  const db={
    collection(c){
      const q=filters=>({
        where(f,op,v){return q(filters.concat([[f,op,v]]));},
        async get(){
          readFail();
          const ids=Object.keys(state.docs).filter(k=>k.indexOf(c+'/')===0&&k.slice(c.length+1).indexOf('/')<0)
            .map(k=>k.slice(c.length+1))
            .filter(id=>filters.every(([f,op,v])=>matches(state.docs[key(c,id)],f,op,v)));
          return{docs:ids.map(id=>snap(c,id)),size:ids.length,empty:!ids.length};
        }
      });
      return Object.assign(q([]),{doc:id=>ref(c,id)});
    },
    batch(){
      const w=[];
      const b={
        set(r,d){w.push(['set',r,clone(d),d]);return b;},
        create(r,d){w.push(['create',r,clone(d),d]);return b;},
        update(r,d){w.push(['update',r,d,d]);return b;},
        async commit(){
          writeFail();
          w.forEach(([op,,,raw])=>guard(raw,'batch '+op));
          // all-or-nothing, like the real commit
          const before=clone(state.docs);
          try{for(const [op,r,d] of w){const [c,id]=r.path.split('/');ops[op](c,id,d);}}
          catch(e){state.docs=before;throw e;}
          state.batches.push(w.map(([op,r,d])=>({op,path:r.path,data:op==='update'?d:clone(d)})));
        }
      };
      return b;
    },
    // Optimistic, like the real one: a document read in the transaction and
    // written by someone else before it commits makes the body run again.
    async runTransaction(fn){
      for(let attempt=0;attempt<5;attempt++){
        const w=[];const seen={};
        const tx={
          get:async r=>{readFail();seen[r.path]=state.ver[r.path]||0;const [c,id]=r.path.split('/');return snap(c,id);},
          set:(r,d)=>{w.push(['set',r,d]);return tx;},
          create:(r,d)=>{w.push(['create',r,d]);return tx;},
          update:(r,d)=>{w.push(['update',r,d]);return tx;}
        };
        const out=await fn(tx);
        if(Object.keys(seen).some(k=>(state.ver[k]||0)!==seen[k])){state.txRetries=(state.txRetries||0)+1;continue;}
        writeFail();
        const before=clone(state.docs);
        try{for(const [op,r,d] of w){const [c,id]=r.path.split('/');ops[op](c,id,d);}}
        catch(e){state.docs=before;throw e;}
        state.txs.push(w.map(([op,r,d])=>({op,path:r.path,data:op==='update'?d:clone(d)})));
        return out;
      }
      throw new Error('ABORTED: too much contention');
    }
  };
  const firestore=Object.assign(()=>db,{FieldValue:{increment:INC}});
  return{
    apps:state.initError?[]:[1],initializeApp(){state.inits=(state.inits||0)+1;},
    credential:{cert:()=>{if(state.initError)throw new Error(state.initError);return {};}},
    app:()=>({options:{credential:{getAccessToken:async()=>{
      state.tokenCalls=(state.tokenCalls||0)+1;
      if(state.tokenError)throw new Error(state.tokenError);
      return{access_token:state.accessToken||'ya29.test-token-not-real',expires_in:3600};
    }}}}),
    firestore,
    auth:()=>({verifyIdToken:async(t,checkRevoked)=>{
      state.verify.push({t,checkRevoked});
      if(!state.tokens[t])throw Object.assign(new Error('Decoding Firebase ID token failed.'),{code:'auth/argument-error'});
      return state.tokens[t];
    }})
  };
}

// Load one function (and the lib and the core it bundles) fresh, with
// firebase-admin replaced. Every call gets its own state.
function loadFn(rel,state){
  const admin=makeAdmin(state);
  const orig=Module._load;
  Module._load=function(req,...rest){if(req==='firebase-admin')return admin;return orig.call(this,req,...rest);};
  const files=[rel,'netlify/lib/ma-server.js'].map(f=>path.join(ROOT,f));
  files.forEach(f=>{delete require.cache[f];});
  try{return require(path.join(ROOT,rel));}finally{Module._load=orig;}
}

const TOKENS={
  t_afnan:{uid:'u-afnan',email:'afnan@groovy.op'},
  t_ammar:{uid:'u-ammar',email:'ammar@groovy.op'},
  // The owners' addresses in another case. firestore.rules compare the
  // token's email EXACTLY (isMasterAccounts: `userEmail() in [...]`), and so
  // does the server since M1.6c — both are refused.
  t_ammar_mixed:{uid:'u-ammar-x',email:'Ammar@groovy.op'},
  t_afnan_caps:{uid:'u-afnan-x',email:'AFNAN@groovy.op'},
  t_mustafa:{uid:'u-must',email:'mustafa@groovy.op'},
  t_raees:{uid:'u-raees',email:'raees@groovy.op'},
  t_noemail:{uid:'u-phone'}
};
// A service account that parses — never a real key.
const FAKE_SA=JSON.stringify({type:'service_account',project_id:'groovy-gatepass',client_email:'backup@groovy-gatepass.iam.gserviceaccount.com',private_key:'not-a-real-key'});

function withEnv(env,fn){
  const saved={};
  Object.keys(env).forEach(k=>{saved[k]=process.env[k];if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];});
  const restore=()=>Object.keys(saved).forEach(k=>{if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});
  let out;
  try{out=fn();}catch(e){restore();throw e;}
  if(out&&typeof out.then==='function')return out.then(v=>{restore();return v;},e=>{restore();throw e;});
  restore();return out;
}

module.exports={makeAdmin,loadFn,TOKENS,FAKE_SA,withEnv,clone,ROOT};

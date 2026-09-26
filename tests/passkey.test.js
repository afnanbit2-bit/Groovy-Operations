/* ─────────────────────────────────────────────────────────────────────────
   Fingerprint sign-in — netlify/functions/passkey.js (+ the client in
   js/auth.js)

   The function is the security boundary: it is the only thing that turns
   "a phone signed something" into "you are signed in as this person". So
   it is exercised with REAL cryptography — node generates actual P-256 and
   RSA key pairs, builds authenticator data and client data byte for byte,
   and signs them — against an in-memory Firestore standing in for
   firebase-admin. Every refusal below is a way an attacker (or a bug) would
   try to get a token it should not have.

   What this cannot prove: that a real phone's authenticator produces what
   the spec says it does. Afnan's phone is the first real test.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const Module=require('module');
const {loadApp,suite,ROOT}=require('./harness');

const HOST='groovyoperations.netlify.app';
const ORIGIN='https://'+HOST;

function makeAdmin(state){
  let auto=0;
  const ref=(col,id)=>({
    id,path:col+'/'+id,
    async get(){const d=state.docs[col+'/'+id];return{id,exists:!!d,ref:ref(col,id),data:()=>d?JSON.parse(JSON.stringify(d)):undefined};},
    async set(d){state.docs[col+'/'+id]=JSON.parse(JSON.stringify(d));},
    async update(d){Object.assign(state.docs[col+'/'+id],d);},
    async delete(){delete state.docs[col+'/'+id];}
  });
  const db={
    collection:col=>({doc:id=>ref(col,id||('c'+(++auto)))}),
    async runTransaction(fn){const dels=[];const out=await fn({get:r=>r.get(),delete:r=>dels.push(r)});for(const r of dels)await r.delete();return out;}
  };
  return{
    apps:[1],initializeApp(){},credential:{cert:()=>({})},
    firestore:()=>db,
    auth:()=>({
      verifyIdToken:async t=>{if(!state.tokens[t])throw new Error('bad');return state.tokens[t];},
      getUser:async uid=>{const u=state.users[uid];if(!u)throw new Error('nf');return u;},
      createCustomToken:async uid=>{state.minted.push(uid);return 'custom:'+uid;}
    })
  };
}
function loadFn(state){
  const admin=makeAdmin(state);
  const orig=Module._load;
  Module._load=function(req,...rest){if(req==='firebase-admin')return admin;return orig.call(this,req,...rest);};
  const f=path.join(ROOT,'netlify','functions','passkey.js');
  delete require.cache[f];
  try{return require(f);}finally{Module._load=orig;}
}
const b64u=b=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sha=b=>crypto.createHash('sha256').update(b).digest();
function authData(rpId,flags,count){
  const b=Buffer.alloc(37);sha(Buffer.from(rpId)).copy(b,0);b[32]=flags;b.writeUInt32BE(count,33);return b;
}
function clientData(type,challenge,origin){return Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false}));}

module.exports=async function(){
  const s=suite('passkey');
  const savedEnv=process.env.FIREBASE_SERVICE_ACCOUNT;process.env.FIREBASE_SERVICE_ACCOUNT='{}';
  try{
    const fresh=()=>({docs:{},minted:[],
      tokens:{t_afnan:{uid:'u-afnan',email:'afnan@groovy.op'},t_ammar:{uid:'u-ammar',email:'ammar@groovy.op'}},
      users:{'u-afnan':{uid:'u-afnan',email:'afnan@groovy.op'},'u-ammar':{uid:'u-ammar',email:'ammar@groovy.op'}}});
    const call=(fn,body,origin)=>fn.handler({httpMethod:'POST',headers:{origin:origin===undefined?ORIGIN:origin},body:JSON.stringify(body)})
      .then(r=>({status:r.statusCode,body:JSON.parse(r.body)}));

    // A phone: a real key pair, and the two ceremonies built byte for byte.
    function phone(kind){
      const kp=kind==='rsa'
        ?crypto.generateKeyPairSync('rsa',{modulusLength:2048})
        :crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
      const id=b64u(crypto.randomBytes(32));
      return{kp,id,alg:kind==='rsa'?-257:-7,count:0,
        spki:kp.publicKey.export({format:'der',type:'spki'}),
        register(opt,o){o=o||{};
          return{id:o.id||id,alg:this.alg,publicKey:b64u(this.spki),
            authenticatorData:b64u(authData(o.rpId||HOST,o.flags==null?0x45:o.flags,0)),
            clientDataJSON:b64u(clientData('webauthn.create',opt.challenge,o.origin||ORIGIN))};},
        assert(opt,o){o=o||{};
          const ad=authData(o.rpId||HOST,o.flags==null?0x05:o.flags,o.count==null?this.count:o.count);
          const cd=clientData(o.type||'webauthn.get',o.challenge||opt.challenge,o.origin||ORIGIN);
          const key=o.signWith||this.kp.privateKey;
          const sig=crypto.sign('sha256',Buffer.concat([ad,sha(cd)]),key);
          return{id:o.id||id,authenticatorData:b64u(ad),clientDataJSON:b64u(cd),signature:b64u(sig)};}};
    }
    async function setup(fn,ph,tok){
      const opt=(await call(fn,{action:'register-options',idToken:tok||'t_afnan'})).body;
      return call(fn,{action:'register',idToken:tok||'t_afnan',challengeId:opt.challengeId,credential:ph.register(opt)});
    }
    async function signIn(fn,ph,o){
      const opt=(await call(fn,{action:'login-options'})).body;
      return call(fn,{action:'login',challengeId:opt.challengeId,assertion:ph.assert(opt,o)});
    }

    for(const kind of ['ec','rsa']){
      const st=fresh();const fn=loadFn(st);const ph=phone(kind);
      s.section('the happy path, '+(kind==='ec'?'ES256 (most phones)':'RS256 (Windows Hello)'));
      const r=await setup(fn,ph);
      s.eq('registering a fingerprint succeeds',r.status,200);
      const k=st.docs['passkeys/'+ph.id];
      s.eq('the key is stored against the uid from the VERIFIED token',k&&k.uid,'u-afnan');
      s.ok('only the PUBLIC key is stored',k&&!/PRIVATE/.test(JSON.stringify(k)));
      s.eq('the registration challenge is used up',Object.keys(st.docs).filter(x=>x.startsWith('passkey_challenges/')).length,0);
      const li=await signIn(fn,ph);
      s.eq('signing in with the fingerprint succeeds',li.status,200);
      s.eq('… and mints a Firebase token for THAT uid',li.body.token,'custom:u-afnan');
      s.ok('the key records when it was used',!!st.docs['passkeys/'+ph.id].lastUsedAt);
    }

    {
      const st=fresh();const fn=loadFn(st);const ph=phone('ec');
      await setup(fn,ph);
      s.section('every way to get a token it should not');
      const opt=(await call(fn,{action:'login-options'})).body;
      const good=ph.assert(opt);
      const first=await call(fn,{action:'login',challengeId:opt.challengeId,assertion:good});
      s.eq('first use of a challenge works',first.status,200);
      const replay=await call(fn,{action:'login',challengeId:opt.challengeId,assertion:good});
      s.ok('a REPLAYED sign-in is refused (the challenge is single-use)',replay.status>=400&&!replay.body.token);
      const imp=phone('ec');   // someone else's phone, claiming Afnan's key id
      const r1=await signIn(fn,ph,{signWith:imp.kp.privateKey});
      s.eq('a signature from ANOTHER key is refused',r1.status,401);
      const r2=await signIn(fn,ph,{flags:0x01});
      s.ok('presence without VERIFICATION (no fingerprint check) is refused',r2.status===401&&/verified/.test(r2.body.error));
      const r3=await signIn(fn,ph,{challenge:b64u(crypto.randomBytes(32))});
      s.ok('a signature over a DIFFERENT challenge is refused',r3.status===401&&/challenge/.test(r3.body.error));
      const r4=await signIn(fn,ph,{origin:'https://evil.test'});
      s.ok('a signature made for ANOTHER site is refused',r4.status===401&&/origin/.test(r4.body.error));
      const r5=await signIn(fn,ph,{rpId:'evil.test'});
      s.ok('a key scoped to ANOTHER site is refused',r5.status===401&&/rpId/.test(r5.body.error));
      const r6=await signIn(fn,ph,{type:'webauthn.create'});
      s.ok('a registration answer is not a sign-in',r6.status===401&&/type/.test(r6.body.error));
      const r7=await call(fn,{action:'login-options'},'https://'+HOST+'.evil.test');
      s.eq('a lookalike origin cannot even ask',r7.status,403);
      const r8=await call(fn,{action:'login-options'},'http://'+HOST);
      s.eq('plain http cannot ask',r8.status,403);
      const r9=await call(fn,{action:'login-options'},'');
      s.eq('no origin, no challenge',r9.status,403);
      const opt2=(await call(fn,{action:'login-options'})).body;
      st.docs['passkey_challenges/'+opt2.challengeId].exp=Date.now()-1;
      const r10=await call(fn,{action:'login',challengeId:opt2.challengeId,assertion:ph.assert(opt2)});
      s.ok('an EXPIRED challenge is refused',r10.status===400&&!r10.body.token);
      const unknown=phone('ec');
      const r11=await signIn(fn,unknown);
      s.eq('a key that was never registered is refused',r11.status,404);
      s.eq('only the first, genuine sign-in minted a token',st.minted.length,1);
    }

    {
      const st=fresh();const fn=loadFn(st);const ph=phone('ec');
      await setup(fn,ph);
      s.section('the signature counter: a copied key');
      s.eq('a counter of 0 every time (most phones) is fine',(await signIn(fn,ph,{count:0})).status,200);
      s.eq('a rising counter is fine',(await signIn(fn,ph,{count:5})).status,200);
      s.eq('… and again',(await signIn(fn,ph,{count:6})).status,200);
      const back=await signIn(fn,ph,{count:6});
      s.ok('a counter that did not rise is refused as a copied key',back.status===401&&/copied/.test(back.body.error));
    }

    {
      const st=fresh();const fn=loadFn(st);const ph=phone('ec');
      await setup(fn,ph);
      st.users['u-afnan'].disabled=true;
      s.section('the account itself');
      s.eq('a DISABLED account gets no token, however good the fingerprint',(await signIn(fn,ph)).status,403);
      delete st.users['u-afnan'];
      s.eq('a deleted account gets no token',(await signIn(fn,ph)).status,404);
    }

    {
      const st=fresh();const fn=loadFn(st);const ph=phone('ec');
      s.section('registering');
      s.eq('no token, no challenge',(await call(fn,{action:'register-options'})).status,401);
      s.eq('a bad token, no challenge',(await call(fn,{action:'register-options',idToken:'forged'})).status,401);
      const opt=(await call(fn,{action:'register-options',idToken:'t_afnan'})).body;
      const other=await call(fn,{action:'register',idToken:'t_ammar',challengeId:opt.challengeId,credential:ph.register(opt)});
      s.eq('one person cannot finish another person\'s set-up',other.status,400);
      const opt2=(await call(fn,{action:'register-options',idToken:'t_afnan'})).body;
      const noUv=await call(fn,{action:'register',idToken:'t_afnan',challengeId:opt2.challengeId,credential:ph.register(opt2,{flags:0x41})});
      s.eq('a set-up without a fingerprint check is refused',noUv.status,400);
      await setup(fn,ph,'t_afnan');
      const opt3=(await call(fn,{action:'register-options',idToken:'t_ammar'})).body;
      const steal=await call(fn,{action:'register',idToken:'t_ammar',challengeId:opt3.challengeId,credential:ph.register(opt3)});
      s.eq('re-registering someone else\'s key id is refused',steal.status,409);
      s.eq('… and it still belongs to its owner',st.docs['passkeys/'+ph.id].uid,'u-afnan');
      s.section('removing');
      s.eq('someone else cannot remove your key',(await call(fn,{action:'remove',idToken:'t_ammar',id:ph.id})).status,403);
      s.ok('… it is still there',!!st.docs['passkeys/'+ph.id]);
      s.eq('you can remove your own',(await call(fn,{action:'remove',idToken:'t_afnan',id:ph.id})).status,200);
      s.ok('… and it is gone',!st.docs['passkeys/'+ph.id]);
      s.eq('a removed key cannot sign in',(await signIn(fn,ph)).status,404);
    }

    {
      s.section('no client can touch the keys');
      const rules=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
      s.ok('firestore.rules has NO match block for passkeys (default deny; Admin SDK only)',!/match\s+\/passkeys\//.test(rules));
      s.ok('… nor for passkey_challenges',!/match\s+\/passkey_challenges\//.test(rules));
      s.ok('… and no catch-all that would open them',!/match\s+\/\{document=\*\*\}/.test(rules));
      const js=fs.readdirSync(path.join(ROOT,'js')).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n');
      s.ok('no browser script reads the collections directly',!/collection\([^)]*['"]passkey/.test(js));
    }

    // ── the client: the login screen's button, end to end with a fake
    //    server and a fake phone ──
    {
      const mem={};const ls={getItem:k=>k in mem?mem[k]:null,setItem:(k,v)=>{mem[k]=String(v);},removeItem:k=>{delete mem[k];}};
      const calls=[];let signedWith=null;
      const app=loadApp({files:['js/auth.js'],USER_DEFS:[{u:'afnan',name:'Afnan',email:'afnan@groovy.op',role:'owner'}],globals:{
        localStorage:ls,sessionStorage:ls,
        btoa:x=>Buffer.from(x,'binary').toString('base64'),atob:x=>Buffer.from(x,'base64').toString('binary'),
        crypto:{getRandomValues:a=>a},Uint8Array,
        fetch:async(u,init)=>{const b=JSON.parse(init.body);calls.push(b);
          const body=b.action==='login-options'?{challengeId:'c1',challenge:'AAAA',rpId:HOST}:b.action==='login'?{token:'custom:u-afnan',email:'afnan@groovy.op'}:{};
          return{ok:true,status:200,json:async()=>body};},
        signInWithCustomToken:async(a,t)=>{signedWith=t;return{user:{uid:'u-afnan',email:'afnan@groovy.op'}};},
        signOut:async()=>{},setPersistence:async()=>{},browserLocalPersistence:'LOCAL',
        navigator:{credentials:{get:async o=>({rawId:new Uint8Array([9,9,9]).buffer,response:{clientDataJSON:new Uint8Array([1]).buffer,authenticatorData:new Uint8Array([2]).buffer,signature:new Uint8Array([3]).buffer},_o:o})}},
        window:{PublicKeyCredential:{isUserVerifyingPlatformAuthenticatorAvailable:async()=>true},isSecureContext:true,addEventListener(){},matchMedia:()=>({matches:false})}
      }});
      app.run('session=null;var __started=0;startApp=function(){__started++}');
      s.section('the login screen button');
      await app.run('window.loginWithFingerprint()');
      s.eq('with nothing set up on this phone, it does not call the server',calls.length,0);
      ls.setItem('groovy-passkey',JSON.stringify({afnan:{id:'CQkJ',name:'Afnan'}}));
      await app.run('window.loginWithFingerprint()');
      s.eq('asks for a challenge, then sends the signed answer',calls.map(c=>c.action).join(','),'login-options,login');
      s.eq('the answer names this phone\'s key',calls[1]&&calls[1].assertion.id,'CQkJ');
      s.eq('signs in to Firebase with the server\'s token',signedWith,'custom:u-afnan');
      s.eq('the session is the account the TOKEN belongs to',app.run('session&&session.u'),'afnan');
      s.eq('the app starts',app.run('__started'),1);
      s.eq('and stays signed in on this phone',mem['groovy-keep-signed-in'],'1');
    }
  }finally{
    if(savedEnv===undefined)delete process.env.FIREBASE_SERVICE_ACCOUNT;else process.env.FIREBASE_SERVICE_ACCOUNT=savedEnv;
  }
  return s;
};

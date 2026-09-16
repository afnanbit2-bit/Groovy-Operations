/* ─────────────────────────────────────────────────────────────────────────
   Marketing M4 — discount codes, server side
   netlify/functions/marketing-discounts.js + marketing-code-rollup.js

   These functions talk to Shopify and the Firebase Admin SDK, neither of
   which is reachable (or installed) here. So `firebase-admin` is replaced
   with a small in-memory Firestore and `fetch` with a scripted Shopify —
   enough to prove the GATE (who may call), the ORDER of writes, the lock
   against double codes, the retry on a taken code, and the arithmetic of
   the rollup. It does NOT prove Shopify accepts the mutation; that was
   checked against the Admin GraphQL schema when this was written, and the
   first real code created is the live test.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const Module=require('module');
const {suite,ROOT}=require('./harness');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=v=>JSON.stringify(v);

// ── a tiny Firestore ─────────────────────────────────────────────────────
function makeAdmin(state){
  const DELETE={__op:'delete'};
  const inc=n=>({__op:'inc',n});
  const apply=(target,data)=>{
    for(const [k,v] of Object.entries(data)){
      if(v===DELETE)delete target[k];
      else if(v&&v.__op==='inc')target[k]=(Number(target[k])||0)+v.n;
      else target[k]=v;
    }
  };
  let auto=0;
  const ref=(col,id)=>({
    id,path:col+'/'+id,
    async get(){const d=state.docs[col+'/'+id];return snap(col,id,d);},
    async update(data){const d=state.docs[col+'/'+id];if(!d)throw new Error('NOT_FOUND '+col+'/'+id);apply(d,data);state.log.push(['update',col+'/'+id,data]);},
    async set(data,opt){state.docs[col+'/'+id]=Object.assign(opt&&opt.merge?(state.docs[col+'/'+id]||{}):{},data);state.log.push(['set',col+'/'+id,data]);}
  });
  const snap=(col,id,d)=>({id,exists:!!d,ref:ref(col,id),data:()=>d?JSON.parse(JSON.stringify(d)):undefined});
  const db={
    collection(col){
      return{
        doc(id){return ref(col,id||('auto'+(++auto)));},
        async get(){return{docs:Object.keys(state.docs).filter(k=>k.indexOf(col+'/')===0).map(k=>snap(col,k.slice(col.length+1),state.docs[k]))};},
        where(field,op,val){return{async get(){
          if(op!=='array-contains')throw new Error('op');
          return{docs:Object.keys(state.docs).filter(k=>k.indexOf(col+'/')===0&&Array.isArray(state.docs[k][field])&&state.docs[k][field].includes(val))
            .map(k=>snap(col,k.slice(col.length+1),state.docs[k]))};
        }};}
      };
    },
    async getAll(...refs){return Promise.all(refs.map(r=>r.get()));},
    async runTransaction(fn){
      const writes=[];
      const out=await fn({get:r=>r.get(),update:(r,d)=>writes.push([r,d])});
      for(const [r,d] of writes)await r.update(d);
      return out;
    },
    batch(){
      const ops=[];
      return{set:(r,d)=>ops.push(['set',r,d]),update:(r,d)=>ops.push(['update',r,d]),
        async commit(){state.batches.push(ops.map(o=>[o[0],o[1].path]));for(const [op,r,d] of ops)await r[op](d);}};
    }
  };
  const admin={
    apps:[1],
    initializeApp(){},credential:{cert:()=>({})},
    firestore:Object.assign(()=>db,{FieldValue:{delete:()=>DELETE,increment:inc}}),
    auth:()=>({verifyIdToken:async t=>{if(!state.tokens[t])throw new Error('bad');return state.tokens[t];}})
  };
  return admin;
}

function loadFns(state){
  const admin=makeAdmin(state);
  const orig=Module._load;
  Module._load=function(req,...rest){if(req==='firebase-admin')return admin;return orig.call(this,req,...rest);};
  const fnDir=path.join(ROOT,'netlify','functions');
  for(const f of ['marketing-discounts.js','marketing-code-rollup.js'])delete require.cache[path.join(fnDir,f)];
  try{
    return{disc:require(path.join(fnDir,'marketing-discounts.js')),roll:require(path.join(fnDir,'marketing-code-rollup.js'))};
  }finally{Module._load=orig;}
}

// A scripted Shopify: token exchange, the scopes query and the create mutation.
function shopify(state,opts){
  const o=Object.assign({scopes:['read_products','read_orders','write_discounts','read_discounts'],taken:0},opts||{});
  return async(url,init)=>{
    state.calls.push(url);
    const body=init&&init.body?JSON.parse(init.body):{};
    if(/oauth\/access_token/.test(url))return{ok:true,status:200,json:async()=>({access_token:'tok',scope:o.scopes.join(',')})};
    if(/graphql\.json/.test(url)){
      if(/currentAppInstallation/.test(body.query))return{ok:true,status:200,json:async()=>({data:{currentAppInstallation:{accessScopes:o.scopes.map(h=>({handle:h}))}}})};
      if(/discountCodeBasicCreate/.test(body.query)){
        state.created.push(body.variables.input);
        if(o.taken>0){o.taken--;return{ok:true,status:200,json:async()=>({data:{discountCodeBasicCreate:{codeDiscountNode:null,userErrors:[{field:['basicCodeDiscount','code'],message:'Code must be unique.',code:'TAKEN'}]}}})};}
        if(o.fail)return{ok:true,status:200,json:async()=>({data:{discountCodeBasicCreate:{codeDiscountNode:null,userErrors:[{field:['x'],message:o.fail,code:'INVALID'}]}}})};
        return{ok:true,status:200,json:async()=>({data:{discountCodeBasicCreate:{codeDiscountNode:{id:'gid://shopify/DiscountCodeNode/1'},userErrors:[]}}})};
      }
    }
    return{ok:false,status:404,json:async()=>({})};
  };
}

function fresh(){
  return{docs:{
    'dispatches/dp_1':{creator_id:'cr_a',type:'paid_pr',has_discount_code:false,discount_code_id:null},
    'dispatches/dp_org':{creator_id:'cr_a',type:'organic',has_discount_code:false,discount_code_id:null},
    'creators/cr_a':{ig_handle:'st4rr.doll',lifetime_codes_issued:0}
  },log:[],batches:[],calls:[],created:[],
  tokens:{t_ammar:{uid:'u1',email:'ammar@groovy.op'},t_daniyal:{uid:'u2',email:'daniyal@groovy.op'},t_mustafa:{uid:'u3',email:'mustafa@groovy.op'}}};
}
const call=(disc,body,method)=>disc.handler({httpMethod:method||'POST',body:JSON.stringify(body)}).then(r=>({status:r.statusCode,body:JSON.parse(r.body)}));

module.exports=async function(){
  const s=suite('marketing-codes');
  const env={SHOPIFY_CLIENT_ID:'id',SHOPIFY_CLIENT_SECRET:'secret',SHOPIFY_STORE_DOMAIN:'shop.myshopify.com',FIREBASE_SERVICE_ACCOUNT:'{}'};
  const savedEnv={};Object.keys(env).forEach(k=>{savedEnv[k]=process.env[k];process.env[k]=env[k];});
  const savedFetch=global.fetch;
  try{
    s.section('the code itself');
    {
      const {disc}=loadFns(fresh());
      const code=disc.buildCode('st4rr.doll',()=>0);
      s.eq('GRVY-<HANDLE>-<RANDOM>, handle upper-cased and stripped to A–Z/0–9',code,'GRVY-ST4RRDOLL-AAAA');
      s.ok('the random part avoids 0/O/1/I',/^[A-HJ-NP-Z2-9]{4}$/.test(disc.buildCode('x').split('-')[2]));
      s.eq('an empty handle still makes a valid code',disc.buildCode('',()=>0),'GRVY-CREATOR-AAAA');
      s.ok('a long handle is capped',disc.buildCode('a'.repeat(40),()=>0).length<=30);
      const input=disc.buildDiscountInput('GRVY-X-AAAA','x','dp_1',Date.parse('2026-09-16T00:00:00Z'));
      s.eq('10% off',input.customerGets.value.percentage,0.1);
      s.eq('on every product',input.customerGets.items.all,true);
      s.eq('for any buyer (context, not the deprecated customerSelection)',J(input.context),J({all:'ALL'}));
      s.ok('customerSelection is not sent',!('customerSelection' in input));
      s.eq('once per customer',input.appliesOncePerCustomer,true);
      s.ok('no total usage cap — many customers may each use it once',!('usageLimit' in input));
      s.eq('ends 20 days after it starts',(Date.parse(input.endsAt)-Date.parse(input.startsAt))/86400000,20);
      s.eq('both discount scopes are required',J(disc.missingScopes(['write_discounts'])),J(['read_discounts']));
      s.eq('nothing missing when both are granted',disc.missingScopes(['read_discounts','write_discounts']).length,0);
    }

    s.section('who may call it');
    {
      const st=fresh();const {disc}=loadFns(st);global.fetch=shopify(st);
      s.eq('GET is refused',(await call(disc,{},'GET')).status,405);
      s.eq('no token is refused',(await call(disc,{action:'status'})).status,400);
      s.eq('a bad token is refused',(await call(disc,{idToken:'nope',action:'status'})).status,401);
      s.eq('a signed-in account without Marketing is refused',(await call(disc,{idToken:'t_mustafa',action:'status'})).status,403);
      s.eq('and Shopify is never contacted for it',st.calls.length,0);
      const ok=await call(disc,{idToken:'t_daniyal',action:'status'});
      s.eq('the lead may check the connection',ok.status,200);
      s.ok('which reports the granted scopes',ok.body.canCreate===true&&ok.body.scopes.includes('write_discounts'));
      s.eq('an unknown action is refused',(await call(disc,{idToken:'t_ammar',action:'drop_tables'})).status,400);
      const rules=read('firestore.rules');
      const lead=((/function isContentOpsLead\(\)\s*\{[^}]*\[([^\]]*)\]/.exec(rules)||['',''])[1].match(/'([^']+)'/g)||[]).map(x=>x.replace(/'/g,''));
      const owners=((/function isOwner\(\)\s*\{[^}]*\[([^\]]*)\]/.exec(rules)||['',''])[1].match(/'([^']+)'/g)||[]).map(x=>x.replace(/'/g,''));
      s.eq('the function\'s list is exactly isMarketing() in the rules',J(disc.MARKETING_EMAILS.slice().sort()),J(owners.concat(lead).sort()));
    }

    s.section('creating a code');
    {
      const st=fresh();const {disc}=loadFns(st);global.fetch=shopify(st);
      const r=await call(disc,{idToken:'t_daniyal',action:'create',dispatchId:'dp_1'});
      s.eq('it succeeds',r.status,200);
      s.ok('with a GRVY code for the creator',/^GRVY-ST4RRDOLL-[A-Z2-9]{4}$/.test(r.body.code.code));
      const code=st.docs['discount_codes/'+r.body.code.id];
      s.ok('the code is recorded',!!code);
      s.eq('against its dispatch',code.dispatch_id,'dp_1');
      s.eq('with the dispatch type, for the Paid PR ROI',code.dispatch_type,'paid_pr');
      s.eq('with the Shopify id',code.shopify_discount_id,'gid://shopify/DiscountCodeNode/1');
      s.eq('by the caller\'s uid',code.created_by_user_id,'u2');
      s.eq('status active, nothing redeemed yet',code.status+'/'+code.redemption_count,'active/0');
      s.eq('the dispatch now points at it',st.docs['dispatches/dp_1'].discount_code_id,r.body.code.id);
      s.ok('and its lock is gone',!('code_lock_at' in st.docs['dispatches/dp_1']));
      s.eq('the creator counts one more code',st.docs['creators/cr_a'].lifetime_codes_issued,1);
      s.eq('code, dispatch and creator are written in ONE batch',J(st.batches[0].map(b=>b[1].split('/')[0])),J(['discount_codes','dispatches','creators']));
      const again=await call(disc,{idToken:'t_ammar',action:'create',dispatchId:'dp_1'});
      s.ok('asking again returns the same code',again.body.already===true&&again.body.code.id===r.body.code.id);
      s.eq('and Shopify creates nothing more',st.created.length,1);
    }
    {
      const st=fresh();st.docs['dispatches/dp_1'].code_lock_at=Date.now();
      const {disc}=loadFns(st);global.fetch=shopify(st);
      const r=await call(disc,{idToken:'t_ammar',action:'create',dispatchId:'dp_1'});
      s.eq('a second click while one is in flight is refused',r.status,409);
      s.eq('without touching Shopify',st.created.length,0);
      st.docs['dispatches/dp_1'].code_lock_at=Date.now()-10*60*1000;
      s.eq('a lock left by a crashed call expires',(await call(disc,{idToken:'t_ammar',action:'create',dispatchId:'dp_1'})).status,200);
    }
    {
      const st=fresh();const {disc}=loadFns(st);global.fetch=shopify(st,{taken:2});
      const r=await call(disc,{idToken:'t_ammar',action:'create',dispatchId:'dp_org'});
      s.eq('a code that is already taken is retried with a new suffix',r.status,200);
      s.eq('up to three attempts',st.created.length,3);
      s.eq('an organic dispatch is recorded as organic',st.docs['discount_codes/'+r.body.code.id].dispatch_type,'organic');
    }
    {
      const st=fresh();const {disc}=loadFns(st);global.fetch=shopify(st,{scopes:['read_products']});
      const r=await call(disc,{idToken:'t_ammar',action:'create',dispatchId:'dp_1'});
      s.eq('without the discount scopes nothing is created',r.status,403);
      s.ok('and the error names what is missing',/write_discounts and read_discounts/.test(r.body.error));
      s.eq('Shopify was not asked to create anything',st.created.length,0);
      s.ok('the dispatch is released for a retry',!('code_lock_at' in st.docs['dispatches/dp_1']));
      s.eq('and has no code',st.docs['dispatches/dp_1'].has_discount_code,false);
    }
    {
      const st=fresh();const {disc}=loadFns(st);global.fetch=shopify(st,{fail:'Ends at must be after starts at'});
      const r=await call(disc,{idToken:'t_ammar',action:'create',dispatchId:'dp_1'});
      s.eq('a Shopify refusal is reported',r.status,502);
      s.ok('with Shopify\'s own reason',/Ends at must be after starts at/.test(r.body.error));
      s.eq('after one attempt — only a taken code is retried',st.created.length,1);
      s.ok('and the lock is released',!('code_lock_at' in st.docs['dispatches/dp_1']));
      s.eq('nothing is recorded',Object.keys(st.docs).filter(k=>k.indexOf('discount_codes/')===0).length,0);
    }
    {
      const st=fresh();const {disc}=loadFns(st);global.fetch=shopify(st);
      s.eq('a dispatch that does not exist',(await call(disc,{idToken:'t_ammar',action:'create',dispatchId:'dp_gone'})).status,404);
      s.eq('a missing dispatch id',(await call(disc,{idToken:'t_ammar',action:'create'})).status,400);
    }

    s.section('the nightly rollup');
    {
      const {roll}=loadFns(fresh());
      const sum=roll.summariseOrders([
        {total_price:1000,financial_status:'paid',created_at:'2026-09-02T12:00:00+05:00'},
        {total_price:2500.5,financial_status:'partially_paid',created_at:'2026-10-01T00:30:00+05:00'},
        {total_price:900,financial_status:'refunded',created_at:'2026-09-03T12:00:00+05:00'},
        {total_price:700,financial_status:'paid',cancelled_at:'2026-09-04',created_at:'2026-09-04T12:00:00+05:00'}
      ]);
      s.eq('cancelled and refunded orders are left out',sum.redemption_count,2);
      s.eq('revenue',sum.revenue_attributed_pkr,3500.5);
      s.eq('by store-local month (00:30 on 1 Oct PKT is October)',J(sum.revenue_by_month),J({'2026-09':1000,'2026-10':2500.5}));
      s.eq('a code past its end is expired',roll.codeStatus({expires_at:100},200),'expired');
      s.eq('one before it is active',roll.codeStatus({expires_at:300},200),'active');
      const t=roll.creatorTotals([{creator_id:'a',redemption_count:2,revenue_attributed_pkr:10},{creator_id:'a',redemption_count:1,revenue_attributed_pkr:5.25},{creator_id:'b'}]);
      s.eq('creator totals add up across codes',J(t.a),J({lifetime_codes_issued:2,lifetime_code_redemptions:3,lifetime_code_revenue_attributed:15.25}));
    }
    {
      const st=fresh();
      const now=Date.parse('2026-10-20T00:00:00Z');
      st.docs['discount_codes/c1']={code:'GRVY-A-AAAA',creator_id:'cr_a',dispatch_type:'paid_pr',expires_at:now-86400000,status:'active'};
      st.docs['discount_codes/c2']={code:'GRVY-GONE-BBBB',creator_id:'cr_deleted',expires_at:now+86400000,status:'active'};
      st.docs['shopify_orders/o1']={total_price:4000,financial_status:'paid',created_at:'2026-10-05T10:00:00+05:00',discount_codes:['GRVY-A-AAAA']};
      st.docs['shopify_orders/o2']={total_price:999,financial_status:'paid',created_at:'2026-10-05T10:00:00+05:00',discount_codes:['OTHER']};
      const {roll}=loadFns(st);
      // runRollup takes the db — an in-memory one over the same documents.
      const admin=makeAdmin(st);
      const res=await roll.runRollup(admin.firestore(),now);
      s.eq('every code is recounted',res.codes_updated,2);
      s.eq('only orders carrying the code count',st.docs['discount_codes/c1'].redemption_count,1);
      s.eq('its revenue',st.docs['discount_codes/c1'].revenue_attributed_pkr,4000);
      s.eq('a code past its end is marked expired',st.docs['discount_codes/c1'].status,'expired');
      s.eq('the creator gets the totals',st.docs['creators/cr_a'].lifetime_code_revenue_attributed,4000);
      s.ok('a deleted creator is not resurrected',!st.docs['creators/cr_deleted']);
      s.eq('and is not counted as updated',res.creators_updated,1);
      s.eq('the run is recorded for the page',st.docs['shopify_sync_meta/marketing_codes'].codes_total,2);
    }

    s.section('wiring');
    {
      const sync=read('netlify/functions/shopify-order-sync.js');
      const back=read('netlify/functions/shopify-order-backfill.js');
      const want=/discount_codes: \(order\.discount_codes \|\| \[\]\)\s*\.map\(\(d\) => String\(\(d && d\.code\) \|\| ""\)\.toUpperCase\(\)\)/;
      s.ok('the order sync records codes, upper-cased',want.test(sync));
      s.ok('so does the backfill',want.test(back));
      const toml=read('netlify.toml');
      s.ok('the rollup is scheduled',/\[functions\."marketing-code-rollup"\]\s*schedule = "30 1 \* \* \*"/.test(toml));
      const rules=read('firestore.rules');
      s.ok('no browser writes a discount code',/match \/discount_codes\/\{id\} \{\s*allow read: if isMarketing\(\);\s*allow write: if false;/.test(rules));
      const blk=(rules.match(/match \/dispatches\/\{id\} \{[\s\S]*?\n    \}/)||[''])[0];
      s.ok('nor attaches one to a dispatch',/has_discount_code', false\) == resource\.data\.get\('has_discount_code', false\)/.test(blk)
        &&/discount_code_id', null\) == resource\.data\.get\('discount_code_id', null\)/.test(blk)
        &&/code_lock_at', null\) == resource\.data\.get\('code_lock_at', null\)/.test(blk));
      const client=read('js/marketing.js');
      s.ok('the app never holds a Shopify credential',!/SHOPIFY_CLIENT_SECRET|X-Shopify-Access-Token|client_secret/.test(client));
      s.ok('and never writes discount_codes itself',!/(setDoc|updateDoc|addDoc)\(\s*doc\(db,'discount_codes'/.test(client));
    }
  }finally{
    global.fetch=savedFetch;
    Object.keys(savedEnv).forEach(k=>{if(savedEnv[k]===undefined)delete process.env[k];else process.env[k]=savedEnv[k];});
  }
  return s;
};

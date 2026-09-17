/* ─────────────────────────────────────────────────────────────────────────
   netlify/functions/shopify-catalog-sync.js — the article rollup (Pattern
   Hub M1)

   The function talks to Shopify and the Firebase Admin SDK, neither reachable
   here, so `firebase-admin` is replaced with a small in-memory Firestore and
   `fetch` with a scripted Shopify. That is enough to prove:
   - the per-variant write now carries the product image;
   - one shopify_articles doc per article code, with the right status,
     size axis and sizes, aggregated across products;
   - products with an empty or foreign SKU are listed as unkeyed with the
     reason, never keyed under a made-up code;
   - a product carrying two codes is recorded, and both codes get a doc;
   - a rollup doc for a code that vanished from Shopify is deleted;
   - the meta doc and the run summary say what happened.
   It does NOT prove Shopify's REST payload shape — that is read from the
   API docs and the existing sync, and the first scheduled run is the test.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const path=require('path');
const Module=require('module');
const {suite,ROOT}=require('./harness');
const J=v=>JSON.stringify(v);

function makeAdmin(state){
  const ref=(col,id)=>({
    id,path:col+'/'+id,
    get ref(){return this;},
    async get(){const d=state.docs[col+'/'+id];return{id,exists:!!d,ref:ref(col,id),data:()=>d};},
    async set(data,opt){state.docs[col+'/'+id]=Object.assign(opt&&opt.merge?(state.docs[col+'/'+id]||{}):{},JSON.parse(J(data)));state.log.push(['set',col+'/'+id]);},
    async delete(){delete state.docs[col+'/'+id];state.log.push(['delete',col+'/'+id]);}
  });
  const db={
    collection(col){return{
      doc(id){return ref(col,id);},
      async get(){return{docs:Object.keys(state.docs).filter(k=>k.indexOf(col+'/')===0).map(k=>{const id=k.slice(col.length+1);return{id,ref:ref(col,id),data:()=>state.docs[k]};})};}
    };},
    batch(){const ops=[];return{
      set(r,d){ops.push(['set',r,d]);},delete(r){ops.push(['delete',r]);},
      async commit(){state.batches.push(ops.length);for(const [op,r,d] of ops){if(op==='set')await r.set(d);else await r.delete();}}
    };}
  };
  return{apps:[1],initializeApp(){},credential:{cert:()=>({})},firestore:Object.assign(()=>db,{FieldValue:{serverTimestamp:()=>'TS'}})};
}
function loadFn(state){
  const admin=makeAdmin(state);
  const orig=Module._load;
  Module._load=function(req,...rest){if(req==='firebase-admin')return admin;return orig.call(this,req,...rest);};
  const f=path.join(ROOT,'netlify','functions','shopify-catalog-sync.js');
  delete require.cache[f];
  try{return require(f);}finally{Module._load=orig;}
}
const V=(id,sku,opt1,opt2)=>({id,sku,option1:opt1||null,option2:opt2||null,option3:null,price:'100.00',inventory_item_id:id*10});
const PRODUCTS=[
  {id:1,title:'Live in Pants | Arctyc White',status:'active',product_type:'Live In Pants',tags:'a,b',created_at:'2026-04-25',image:{src:'https://cdn/img1.jpg'},
   options:[{position:1,name:'Color'},{position:2,name:'Size'}],
   variants:['XS','S','M','L','XL'].map((s,i)=>V(100+i,'GST062-'+s,'Arctyc White',s))},
  {id:2,title:'Jorts | Dark Stone',status:'active',product_type:'Denim',tags:'',created_at:'',image:{src:'https://cdn/img2.jpg'},
   options:[{position:1,name:'Size'}],variants:[V(200,'GJO001-26','26'),V(201,'GJO001-28','28')]},
  {id:3,title:'Carpenter Dark Grey Denim',status:'active',product_type:'Denim',tags:'',created_at:'',image:null,
   options:[],variants:[V(300,'','26'),V(301,null,'28')]},
  {id:4,title:'Kinder Planet Baby Tee',status:'draft',product_type:'Baby Tee',tags:'',created_at:'',image:{src:'https://cdn/img4.jpg'},
   options:[],variants:[V(400,'TOPS-030','Pink','XS'),V(401,'TOPS-031','Pink','S')]},
  {id:5,title:'Chicago Bulls',status:'active',product_type:'Graphic Tee',tags:'',created_at:'',image:{src:'https://cdn/img5.jpg'},
   options:[],variants:[V(500,'GP061-XS','White','XS'),V(501,'GP060-XS','Black','XS')]},
  {id:6,title:'Classic Snapback // Stone',status:'active',product_type:'Headwear',tags:'',created_at:'',image:{src:'https://cdn/img6.jpg'},
   options:[],variants:[V(600,'GHW001')]},
  {id:7,title:'CORE Tees | Stone Grey',status:'archived',product_type:'Basic Tee',tags:'',created_at:'',image:{src:'https://cdn/img7.jpg'},
   options:[],variants:[V(700,'GB010-S','Grey','S')]},
  {id:8,title:'Live in Pants | Arctyc White (copy)',status:'draft',product_type:'Live In Pants',tags:'',created_at:'',image:{src:'https://cdn/img8.jpg'},
   options:[],variants:[V(800,'GST062-XXS','Arctyc White','XXS')]}
];
function shopifyFetch(state){
  return async(url,init)=>{
    state.calls.push(String(url));
    if(/oauth\/access_token/.test(url))return{ok:true,status:200,json:async()=>({access_token:'tok'})};
    if(/products\.json/.test(url))return{ok:true,status:200,headers:{get:()=>null},json:async()=>({products:PRODUCTS})};
    return{ok:false,status:404,text:async()=>'nope',json:async()=>({})};
  };
}

module.exports=async function(){
  const s=suite('catalog-sync');
  const state={docs:{'shopify_articles/GP999':{code:'GP999',status:'active'}},log:[],batches:[],calls:[]};
  const fn=loadFn(state);
  const envKeys=['SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET','SHOPIFY_STORE_DOMAIN','FIREBASE_SERVICE_ACCOUNT'];
  const saved={};envKeys.forEach(k=>{saved[k]=process.env[k];process.env[k]=k==='FIREBASE_SERVICE_ACCOUNT'?'{}':'x';});
  const savedFetch=global.fetch;global.fetch=shopifyFetch(state);
  let res;
  try{res=await fn.handler({});}finally{global.fetch=savedFetch;envKeys.forEach(k=>{if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});}
  const body=JSON.parse(res.body);
  const D=state.docs;

  s.section('the run');
  s.eq('200',res.statusCode,200);
  s.eq('8 products, 16 variants',J([body.products_fetched,body.variants_written]),J([8,16]));
  s.eq('catalog_sync meta says success',D['shopify_sync_meta/catalog_sync'].last_status,'success');

  s.section('per-variant write now carries the product image');
  s.eq('GST062-XS variant has image_url',D['shopify_products/100'].image_url,'https://cdn/img1.jpg');
  s.eq('a product with no image writes an empty string, not undefined',D['shopify_products/300'].image_url,'');

  s.section('one rollup doc per article code');
  const g=D['shopify_articles/GST062'];
  s.ok('GST062 exists',!!g);
  s.eq('status: active wins over the draft copy',g.status,'active');
  s.eq('both statuses recorded',J(g.statuses.slice().sort()),J(['active','draft']));
  s.eq('both products recorded',J(g.product_ids),J(['1','8']));
  s.eq('6 variants across the two',g.variant_count,6);
  s.eq('sizes seen, incl. XXS from the copy',J(g.sizes_seen),J(['XS','S','M','L','XL','XXS']));
  s.eq('size axis alpha',g.size_axis,'alpha');
  s.eq('image from the first product',g.image_url,'https://cdn/img1.jpg');
  s.eq('jorts: waist axis',J([D['shopify_articles/GJO001'].size_axis,D['shopify_articles/GJO001'].sizes_seen]),J(['waist',['26','28']]));
  s.eq('a cap: no size, axis none',J([D['shopify_articles/GHW001'].size_axis,D['shopify_articles/GHW001'].variant_count]),J(['none',1]));
  s.eq('an archived-only code reads archived',D['shopify_articles/GB010'].status,'archived');

  s.section('what cannot be keyed is listed, never guessed');
  const meta=D['shopify_sync_meta/articles_rollup'];
  s.eq('two unkeyed products',meta.unkeyed_count,2);
  const noSku=meta.unkeyed_products.find(u=>u.product_id==='3');
  const foreign=meta.unkeyed_products.find(u=>u.product_id==='4');
  s.eq('empty SKU → no_sku',noSku&&noSku.reason,'no_sku');
  s.eq('TOPS-030 → foreign_sku with the sample',J([foreign&&foreign.reason,foreign&&foreign.sku_sample]),J(['foreign_sku','TOPS-030']));
  s.ok('no rollup doc was minted for a foreign SKU',!Object.keys(D).some(k=>/shopify_articles\/TOPS/.test(k)));
  s.eq('unkeyed carries title, status and image for the reconcile page',J([noSku.title,noSku.status,foreign.image_url]),J(['Carpenter Dark Grey Denim','active','https://cdn/img4.jpg']));

  s.section('two codes on one product');
  s.eq('recorded on the meta doc',J(meta.multi_code_products),J([{product_id:'5',title:'Chicago Bulls',status:'active',codes:['GP061','GP060']}]));
  s.ok('and both codes got their own doc',!!D['shopify_articles/GP061']&&!!D['shopify_articles/GP060']);

  s.section('stale rollup docs are removed');
  s.ok('GP999 (not on Shopify any more) was deleted',!D['shopify_articles/GP999']);
  s.eq('summary counts',J([body.articles_written,body.articles_deleted,body.unkeyed_products,body.multi_code_products]),J([6,1,2,1]));
  s.eq('meta code count matches',meta.codes,6);
  s.ok('rollup docs and deletes went through batches',state.batches.length>=2);

  s.section('run it now — pattern-sync-now-background');
  {
    // The scheduled function refuses HTTP (Netlify 403). This wrapper runs
    // the same handler behind a verified ID token. Loaded through the same
    // firebase-admin stub, with an auth() that knows three tokens.
    const st2={docs:{},log:[],batches:[],calls:[],tokens:{t_afnan:{uid:'u1',email:'afnan@groovy.op'},t_mustafa:{uid:'u3',email:'mustafa@groovy.op'},t_arfat:{uid:'u4',email:'arfat@groovy.op'}}};
    const admin2=makeAdmin(st2);admin2.auth=()=>({verifyIdToken:async t=>{if(!st2.tokens[t])throw new Error('bad');return st2.tokens[t];}});
    const orig=Module._load;
    Module._load=function(req,...rest){if(req==='firebase-admin')return admin2;return orig.call(this,req,...rest);};
    const dir=path.join(ROOT,'netlify','functions');
    ['pattern-sync-now-background.js','shopify-catalog-sync.js'].forEach(f=>delete require.cache[path.join(dir,f)]);
    let now;try{now=require(path.join(dir,'pattern-sync-now-background.js'));}finally{Module._load=orig;}
    const saved2={};envKeys.forEach(k=>{saved2[k]=process.env[k];process.env[k]=k==='FIREBASE_SERVICE_ACCOUNT'?'{}':'x';});
    const savedFetch2=global.fetch;global.fetch=shopifyFetch(st2);
    const call=b=>now.handler({httpMethod:'POST',body:JSON.stringify(b)});
    try{
      s.eq('GET is refused',(await now.handler({httpMethod:'GET'})).statusCode,405);
      s.eq('no token → 400',(await call({})).statusCode,400);
      s.eq('a bad token → 401',(await call({idToken:'nope'})).statusCode,401);
      s.eq('Arfat (manager, not a pattern admin) → 403',(await call({idToken:'t_arfat'})).statusCode,403);
      s.eq('…and nothing was synced for any of those',Object.keys(st2.docs).length,0);
      const r=await call({idToken:'t_mustafa'});
      s.eq('Mustafa runs it',r.statusCode,200);
      const b2=JSON.parse(r.body);
      s.eq('the response is the sync summary plus who ran it',J([b2.ran_by,b2.products_fetched,b2.articles_written]),J(['mustafa@groovy.op',8,6]));
      s.ok('and the rollup landed',!!st2.docs['shopify_articles/GST062']&&!!st2.docs['shopify_sync_meta/catalog_sync']);
    }finally{global.fetch=savedFetch2;envKeys.forEach(k=>{if(saved2[k]===undefined)delete process.env[k];else process.env[k]=saved2[k];});}
    const rules=require('fs').readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
    const owners=(/function isOwner\(\)\s*\{[^}]*\[([^\]]*)\]/.exec(rules)||[,''])[1].match(/'[^']+'/g).map(x=>x.replace(/'/g,''));
    const mustafa=(/function isMustafa\(\)\s*\{[^}]*==\s*'([^']+)'/.exec(rules)||[])[1];
    s.eq('PATTERN_ADMIN_EMAILS mirrors isPatternAdmin() exactly',J(now.PATTERN_ADMIN_EMAILS.slice().sort()),J(owners.concat([mustafa]).sort()));
    s.ok('the sync is never scheduled twice: the wrapper has no schedule in netlify.toml',!/functions\."pattern-sync-now-background"/.test(require('fs').readFileSync(path.join(ROOT,'netlify.toml'),'utf8')));
  }

  s.section('SKU grammar');
  s.eq('GST073-XS → GST073 / XS',J(fn._test.parseArticleSku('GST073-XS')),J({code:'GST073',size:'XS'}));
  s.eq('GD007-28 → waist size',J(fn._test.parseArticleSku('gd007-28')),J({code:'GD007',size:'28'}));
  s.eq('GHW001 → no size',J(fn._test.parseArticleSku('GHW001')),J({code:'GHW001',size:''}));
  s.eq('GCO001-T-M → co-ord top, size M',J(fn._test.parseArticleSku('GCO001-T-M')),J({code:'GCO001-T',size:'M'}));
  s.eq('FOG-02 is not a code',fn._test.parseArticleSku('FOG-02'),null);
  s.eq('CARGO-010 is not a code',fn._test.parseArticleSku('CARGO-010'),null);
  s.eq('empty is not a code',fn._test.parseArticleSku(''),null);
  s.eq('mixed sizes → mixed',fn._test.sizeAxisOf(['S','30']),'mixed');
  return s;
};

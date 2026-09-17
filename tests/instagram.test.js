/* ─────────────────────────────────────────────────────────────────────────
   Marketing — Instagram auto-fetch, server side
   netlify/functions/instagram-business-discovery.js + instagram-token-refresh.js

   Meta's Graph API and firebase-admin are both replaced here: a scripted
   Graph (token exchange, /me/accounts, debug_token, Business Discovery) and
   a tiny in-memory Firestore. That proves the GATE, the averaging, the
   not-found message, the token seeding (user token → Page token), that the
   token never reaches a browser, and the nightly warning. It does NOT prove
   Meta answers these calls this way on GRVY's app — the request shape comes
   from Ammar's Graph API Explorer run and Meta's docs, and the first real
   lookup is the live test.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const Module=require('module');
const {suite,ROOT}=require('./harness');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=v=>JSON.stringify(v);

function makeAdmin(state){
  const ref=(col,id)=>({
    id,path:col+'/'+id,
    async get(){const d=state.docs[col+'/'+id];return{id,exists:!!d,data:()=>d?JSON.parse(JSON.stringify(d)):undefined};},
    async set(data,opt){state.docs[col+'/'+id]=Object.assign(opt&&opt.merge?(state.docs[col+'/'+id]||{}):{},JSON.parse(JSON.stringify(data)));state.log.push(['set',col+'/'+id]);}
  });
  const db={collection:col=>({doc:id=>ref(col,id)})};
  return{
    apps:[1],initializeApp(){},credential:{cert:()=>({})},
    firestore:()=>db,
    auth:()=>({verifyIdToken:async t=>{if(!state.tokens[t])throw new Error('bad');return state.tokens[t];}})
  };
}

function load(state){
  const admin=makeAdmin(state);
  const orig=Module._load;
  Module._load=function(req,...rest){if(req==='firebase-admin')return admin;return orig.call(this,req,...rest);};
  const dir=path.join(ROOT,'netlify','functions');
  for(const f of ['instagram-business-discovery.js','instagram-token-refresh.js','marketing-discounts.js','marketing-code-rollup.js'])delete require.cache[path.join(dir,f)];
  try{
    return{disc:require(path.join(dir,'instagram-business-discovery.js')),tok:require(path.join(dir,'instagram-token-refresh.js'))};
  }finally{Module._load=orig;}
}

const NOT_FOUND={error:{message:'Invalid user id',type:'OAuthException',code:110,error_subcode:2207013,
  error_user_title:'Cannot find User',error_user_msg:'The user with username: _iamaleeba_ cannot be found.'}};

// A scripted Graph API.
function graph(state,opts){
  const o=Object.assign({pageLinked:true,valid:true,expires:0,exchangeFails:false,lookup:null,deadTokens:[]},opts||{});
  return async url=>{
    const u=new URL(url);
    const p=Object.fromEntries(u.searchParams);
    state.calls.push({path:u.pathname,p});
    const ok=b=>({ok:true,status:200,json:async()=>b});
    const bad=(s,b)=>({ok:false,status:s,json:async()=>b});
    if(/\/oauth\/access_token$/.test(u.pathname)){
      if(o.exchangeFails)return bad(400,{error:{message:'nope',code:100}});
      return ok({access_token:'LL_USER',token_type:'bearer',expires_in:5184000});
    }
    if(/\/me\/accounts$/.test(u.pathname)){
      return ok({data:[{id:'p0',name:'Other',access_token:'OTHER_PAGE'},
        {id:'p1',name:'GRVY',access_token:'PAGE_TOKEN',instagram_business_account:o.pageLinked?{id:'17841409780333939'}:{id:'999'}}]});
    }
    if(/\/debug_token$/.test(u.pathname)){
      const t=p.input_token;
      return ok({data:{is_valid:o.valid&&!o.deadTokens.includes(t),type:t==='PAGE_TOKEN'?'PAGE':'USER',
        expires_at:t==='PAGE_TOKEN'?0:o.expires,scopes:['pages_show_list','instagram_basic','instagram_manage_insights']}});
    }
    if(/\/17841409780333939$/.test(u.pathname)){
      if(o.deadTokens.includes(p.access_token))return bad(400,{error:{message:'Session has expired',type:'OAuthException',code:190}});
      if(o.lookup)return o.lookup(p);
      return ok({business_discovery:{username:'st4rr.doll',name:'Starr',followers_count:24500,media_count:120,
        media:{data:[{like_count:500,comments_count:30,view_count:8000},{like_count:700,comments_count:50},{comments_count:40,view_count:10000}]}},id:'17841409780333939'});
    }
    return bad(404,{error:{message:'unknown path',code:2500}});
  };
}

function fresh(){
  return{docs:{},log:[],calls:[],
    tokens:{t_daniyal:{uid:'u2',email:'daniyal@groovy.op'},t_mustafa:{uid:'u3',email:'mustafa@groovy.op'}}};
}
const call=(disc,body,method)=>disc.handler({httpMethod:method||'POST',body:JSON.stringify(body)}).then(r=>({status:r.statusCode,body:JSON.parse(r.body)}));
const ENV={FIREBASE_SERVICE_ACCOUNT:'{}',IG_ACCESS_TOKEN:'SHORT_SEED',META_APP_SECRET:'app-secret'};

module.exports=async function(){
  const s=suite('instagram');
  const saved={};['FIREBASE_SERVICE_ACCOUNT','IG_ACCESS_TOKEN','META_APP_SECRET','META_APP_ID','IG_BUSINESS_ACCOUNT_ID'].forEach(k=>{saved[k]=process.env[k];delete process.env[k];});
  Object.assign(process.env,ENV);
  const savedFetch=global.fetch;
  try{
    s.section('pure pieces');
    {
      const {disc,tok}=load(fresh());
      s.eq('a handle is normalised',disc.normUsername(' @St4rr.Doll '),'st4rr.doll');
      s.eq('a profile URL works too',disc.normUsername('https://www.instagram.com/st4rr.doll/?hl=en'),'st4rr.doll');
      s.eq('anything that could break the field expansion is refused',disc.normUsername('a){id}'),'');
      s.eq('over 30 characters is refused',disc.normUsername('a'.repeat(31)),'');
      s.eq('the fields asked for',disc.discoveryFields('x'),'business_discovery.username(x){username,name,followers_count,media_count,media{like_count,comments_count,view_count}}');
      const sum=disc.summarize({username:'x',followers_count:1000,media_count:3,media:{data:[
        {like_count:10,comments_count:1,view_count:100},{comments_count:3},{like_count:20,comments_count:2}]}});
      s.eq('likes average over posts that show them — hidden likes are not zeros',sum.avg_likes,15);
      s.eq('comments over all three',sum.avg_comments,2);
      s.eq('views only over posts that have them',sum.avg_views,100);
      s.eq('and the sample sizes are reported',J([sum.posts_sampled,sum.likes_sampled,sum.views_sampled]),J([3,2,1]));
      const empty=disc.summarize({username:'x',followers_count:50});
      s.eq('no posts → null averages, not zeros',J([empty.avg_likes,empty.avg_comments,empty.avg_views]),J([null,null,null]));
      s.eq('followers still come through',empty.follower_count,50);
      s.eq('the not-found message is the agreed wording',disc.NOT_FOUND_MESSAGE,"Couldn't find a Business or Creator account with that handle — check the spelling, or use manual/screenshot entry if this is a Personal account.");
      const e=new Error('x');e.graph={code:110,subcode:2207013};
      s.eq('code 110 / 2207013 is not found',tok.classifyGraphError(e),'not_found');
      e.graph={code:190};s.eq('code 190 is a token problem',tok.classifyGraphError(e),'token');
      e.graph={code:4};s.eq('code 4 is a rate limit',tok.classifyGraphError(e),'rate');
      e.graph={code:1};s.eq('anything else is other',tok.classifyGraphError(e),'other');
      s.eq('the pinned Graph version',tok.GRAPH_VERSION,'v26.0');
      s.eq('days left rounds down',tok.daysLeft(Date.parse('2026-09-30T00:00:00Z'),Date.parse('2026-09-16T12:00:00Z')),13);
      s.eq('a token with no expiry has no days left',tok.daysLeft(null,1),null);
    }

    s.section('who may call');
    {
      const st=fresh();global.fetch=graph(st);
      const {disc}=load(st);
      s.eq('GET is refused',(await call(disc,{},'GET')).status,405);
      s.eq('no ID token is refused',(await call(disc,{action:'lookup',username:'x'})).status,400);
      s.eq('a bad ID token is refused',(await call(disc,{idToken:'forged',action:'lookup',username:'x'})).status,401);
      const m=await call(disc,{idToken:'t_mustafa',action:'lookup',username:'x'});
      s.eq('a signed-in account outside Marketing is refused',m.status,403);
      s.eq('and Meta was never called',st.calls.length,0);
    }

    s.section('a lookup');
    {
      const st=fresh();global.fetch=graph(st);
      const {disc}=load(st);
      const r=await call(disc,{idToken:'t_daniyal',action:'lookup',username:'@St4rr.Doll'});
      s.eq('it succeeds',r.status,200);
      s.eq('followers',r.body.follower_count,24500);
      s.eq('avg likes over the two posts showing likes',r.body.avg_likes,600);
      s.eq('avg comments over all three',r.body.avg_comments,40);
      s.eq('avg views over the two with views',r.body.avg_views,9000);
      s.ok('the response carries no token',!/PAGE_TOKEN|LL_USER|SHORT_SEED|app-secret/.test(J(r.body)));
      const disco=st.calls.find(c=>/17841409780333939$/.test(c.path));
      s.eq('it asks GRVY\'s own Business account',disco.path,'/v26.0/17841409780333939');
      s.eq('with the Page token, not the seed',disco.p.access_token,'PAGE_TOKEN');
      s.eq('and an appsecret_proof',disco.p.appsecret_proof,require('crypto').createHmac('sha256','app-secret').update('PAGE_TOKEN').digest('hex'));
      const ex=st.calls.find(c=>/oauth\/access_token$/.test(c.path));
      s.eq('the seed was exchanged for a long-lived token first',ex.p.fb_exchange_token,'SHORT_SEED');
      const stored=st.docs['integration_secrets/instagram'];
      s.eq('the Page token is what is stored',stored.token,'PAGE_TOKEN');
      s.eq('marked as a Page token',stored.kind,'page');
      s.eq('which does not expire',stored.expires_at,null);
      s.ok('the readable status doc never holds the token',!/PAGE_TOKEN|SHORT_SEED/.test(J(st.docs['shopify_sync_meta/instagram'])));
      const before=st.calls.length;
      await call(disc,{idToken:'t_daniyal',action:'lookup',username:'x'});
      s.eq('a second lookup reuses the stored token — no re-seed',st.calls.slice(before).map(c=>c.path.split('/').pop()).join(','),'17841409780333939');
      process.env.IG_ACCESS_TOKEN='NEW_SEED';
      await call(disc,{idToken:'t_daniyal',action:'lookup',username:'x'});
      s.ok('replacing IG_ACCESS_TOKEN re-seeds on the next call',st.calls.some(c=>c.p.fb_exchange_token==='NEW_SEED'));
      process.env.IG_ACCESS_TOKEN=ENV.IG_ACCESS_TOKEN;
      s.eq('a bad handle never reaches Meta',(await call(disc,{idToken:'t_daniyal',action:'lookup',username:'a b'})).status,400);
    }

    s.section('not found, and other failures');
    {
      const st=fresh();global.fetch=graph(st,{lookup:()=>({ok:false,status:400,json:async()=>NOT_FOUND})});
      const {disc}=load(st);
      const r=await call(disc,{idToken:'t_daniyal',action:'lookup',username:'_iamaleeba_'});
      s.eq('not found is a normal answer, not an error',r.status,200);
      s.eq('found:false',r.body.found,false);
      s.eq('with the agreed message',r.body.message,disc.NOT_FOUND_MESSAGE);
      s.ok('never the raw Graph error',!/OAuthException|2207013|Invalid user id/.test(J(r.body)));
    }
    {
      const st=fresh();global.fetch=graph(st,{lookup:()=>({ok:false,status:400,json:async()=>({error:{message:'Too many calls',code:4}})})});
      const {disc}=load(st);
      const r=await call(disc,{idToken:'t_daniyal',action:'lookup',username:'x'});
      s.eq('a rate limit is a 429',r.status,429);
      s.ok('that points at manual entry',/by hand/.test(r.body.error));
    }
    {
      const st=fresh();
      st.docs['integration_secrets/instagram']={token:'STALE',kind:'page',seed_fp:null};
      global.fetch=graph(st,{deadTokens:['STALE']});
      const {disc,tok}=load(st);
      st.docs['integration_secrets/instagram'].seed_fp=tok.fingerprint(ENV.IG_ACCESS_TOKEN);
      const r=await call(disc,{idToken:'t_daniyal',action:'lookup',username:'x'});
      s.eq('an expired stored token is re-seeded and the lookup retried once',r.status,200);
      s.eq('with the fresh token stored',st.docs['integration_secrets/instagram'].token,'PAGE_TOKEN');
    }
    {
      const st=fresh();global.fetch=graph(st,{deadTokens:['PAGE_TOKEN','LL_USER','SHORT_SEED']});
      const {disc}=load(st);
      const r=await call(disc,{idToken:'t_daniyal',action:'lookup',username:'x'});
      s.eq('a seed that is dead too → 503',r.status,503);
      s.ok('saying the connection expired and to enter numbers by hand',/expired[\s\S]*by hand/.test(r.body.error));
      s.eq('and the status doc records it',st.docs['shopify_sync_meta/instagram'].valid,false);
    }
    {
      const st=fresh();global.fetch=graph(st);
      delete process.env.IG_ACCESS_TOKEN;
      const {disc}=load(st);
      const r=await call(disc,{idToken:'t_daniyal',action:'lookup',username:'x'});
      s.eq('not set up → 503',r.status,503);
      s.eq('flagged as not configured',r.body.configured,false);
      s.eq('status says so too',(await call(disc,{idToken:'t_daniyal',action:'status'})).body.configured,false);
      process.env.IG_ACCESS_TOKEN=ENV.IG_ACCESS_TOKEN;
    }

    s.section('seeding without a linked Page');
    {
      const st=fresh();global.fetch=graph(st,{pageLinked:false,expires:Math.floor(Date.now()/1000)+50*86400});
      const {disc}=load(st);
      const r=await call(disc,{idToken:'t_daniyal',action:'status'});
      s.eq('the long-lived user token is used',st.docs['integration_secrets/instagram'].token,'LL_USER');
      s.eq('and status says it is a user token',r.body.kind,'user');
      s.ok('with its days left',r.body.days_left>=49&&r.body.days_left<=50);
      s.ok('status never returns a token',!/LL_USER|PAGE_TOKEN|SHORT_SEED/.test(J(r.body)));
    }
    {
      const st=fresh();global.fetch=graph(st,{exchangeFails:true});
      const {disc}=load(st);
      const r=await call(disc,{idToken:'t_daniyal',action:'lookup',username:'x'});
      s.eq('a seed that will not exchange is still tried as-is',r.status,200);
    }

    s.section('the nightly check');
    {
      const {tok}=load(fresh());
      const now=Date.parse('2026-09-16T00:00:00Z');
      s.eq('a healthy Page token raises nothing',tok.planAlert({configured:true,valid:true,expires_at:null},now),null);
      s.eq('30 days out raises nothing',tok.planAlert({configured:true,valid:true,expires_at:now+30*86400000},now),null);
      const a14=tok.planAlert({configured:true,valid:true,expires_at:now+14*86400000},now);
      s.ok('14 days out warns',a14&&/expires in 14 days/.test(a14.title));
      s.eq('at normal priority',a14.priority,'normal');
      s.eq('3 days out is high priority',tok.planAlert({configured:true,valid:true,expires_at:now+3*86400000},now).priority,'high');
      const dead=tok.planAlert({configured:true,valid:false,error:'x'},now);
      s.ok('a dead token says how to fix it',/stopped working/.test(dead.title)&&/IG_ACCESS_TOKEN/.test(dead.message));
      s.eq('not configured raises nothing (nobody switched it on)',tok.planAlert({configured:false},now),null);
    }
    {
      const st=fresh();global.fetch=graph(st,{pageLinked:false,expires:Math.floor(Date.now()/1000)+5*86400});
      const {tok}=load(st);
      const out=await tok.handler({});
      const body=JSON.parse(out.body);
      s.eq('the scheduled run succeeds',out.statusCode,200);
      s.eq('and alerts',body.alerted,true);
      const bells=Object.keys(st.docs).filter(k=>k.indexOf('hrm_notifications/')===0);
      s.eq('one bell per owner',bells.length,2);
      s.ok('to afnan and ammar',bells.some(k=>/_afnan$/.test(k))&&bells.some(k=>/_ammar$/.test(k)));
      s.eq('pointing at the Reports page',st.docs[bells[0]].actionUrl,'mkt-reports');
      s.ok('never carrying the token',!/LL_USER|SHORT_SEED/.test(J(bells.map(k=>st.docs[k]))));
      await tok.handler({});
      s.eq('a second night does not raise it again',Object.keys(st.docs).filter(k=>k.indexOf('hrm_notifications/')===0).length,2);
      s.eq('the check is recorded for the page',typeof st.docs['shopify_sync_meta/instagram'].checked_at,'number');
    }
    {
      delete process.env.IG_ACCESS_TOKEN;
      const st=fresh();global.fetch=graph(st);
      const {tok}=load(st);
      const body=JSON.parse((await tok.handler({})).body);
      s.eq('unconfigured, the nightly run just says so',body.configured,false);
      s.eq('and calls nobody',st.calls.length,0);
      process.env.IG_ACCESS_TOKEN=ENV.IG_ACCESS_TOKEN;
    }

    s.section('wiring');
    {
      const {disc}=load(fresh());
      const codes=require(path.join(ROOT,'netlify','functions','marketing-discounts.js'));
      s.ok('the gate reuses the discount function\'s Marketing list',/require\("\.\/marketing-discounts\.js"\)/.test(read('netlify/functions/instagram-business-discovery.js'))&&Array.isArray(codes.MARKETING_EMAILS));
      s.ok('the nightly check is scheduled',/\[functions\."instagram-token-refresh"\]\s*schedule = "15 2 \* \* \*"/.test(read('netlify.toml')));
      const rules=read('firestore.rules');
      s.ok('no rule opens the token collection',!/integration_secrets/.test(rules));
      s.ok('and there is no catch-all that would',!/document=\*\*/.test(rules));
      s.ok('no served file holds a Meta credential',!['index.html','js/marketing.js','sw.js'].some(f=>/appsecret_proof|fb_exchange_token|client_secret|graph.facebook.com|process.env/.test(read(f))));
      s.ok('the discovery module loads',typeof disc.handler==='function');
    }
  }finally{
    global.fetch=savedFetch;
    Object.keys(saved).forEach(k=>{if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});
  }
  return s;
};

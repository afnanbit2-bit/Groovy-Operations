/* ─────────────────────────────────────────────────────────────────────────
   Master Accounts share links — netlify/functions/ma-share.js (M1.5a)

   The one PUBLIC door into the books, so most of this suite is about what it
   refuses: an unknown or malformed token, a withdrawn link, an expired one, a
   share document it would not have written itself, and every owner action by
   someone who is not an owner. The live path is held too: the open is
   counted AFTER the file link is minted, a link-preview fetch is counted
   apart, and the redirect target is re-derived here and its signature
   recomputed independently. Cannot prove: what WhatsApp does with the link,
   or that Cloudinary serves the signed URL — the first real share is that
   test.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {suite,ROOT}=require('./harness');
const {loadFn,TOKENS,FAKE_SA,withEnv}=require('./ma-fake-admin');
const J=v=>JSON.stringify(v);

const UNSIGNED=['file','api_key','resource_type','cloud_name','signature'];
function indepSig(p,secret){
  const keys=Object.keys(p).filter(k=>!UNSIGNED.includes(k)&&p[k]!==undefined&&p[k]!==null&&p[k]!=='').sort();
  return crypto.createHash('sha1').update(keys.map(k=>k+'='+String(p[k])).map(x=>x.split('&').join('%26')).join('&')+secret).digest('hex');
}
const SECRET='test-secret-not-real-share';
const KEY='112233445566778';
const DAY=86400000;
const NOW=Date.UTC(2026,9,5,6,30,15,250);          // 5 Oct 2026, 11:30 PKT
const SIGNED_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:KEY,CLOUDINARY_API_SECRET:SECRET,CLOUDINARY_CLOUD_NAME:undefined};
const UNSIGNED_ENV={FIREBASE_SERVICE_ACCOUNT:FAKE_SA,CLOUDINARY_API_KEY:undefined,CLOUDINARY_API_SECRET:undefined,CLOUDINARY_CLOUD_NAME:undefined};
const PID='ma/'+'e'.repeat(64);
const CHROME='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const WHATSAPP='WhatsApp/2.24.19.86 A';

function post(body,token){
  const headers={};if(token!==null)headers.authorization='Bearer '+(token||'t_afnan');
  return{httpMethod:'POST',headers,body:JSON.stringify(body)};
}
function get(t,ua){
  return{httpMethod:'GET',headers:{'user-agent':ua||CHROME},queryStringParameters:t===undefined?{}:{t}};
}
async function run(fn,event,now){
  const r=await fn._handle(event,now||NOW);
  let body=null;try{body=JSON.parse(r.body);}catch(e){}
  return{status:r.statusCode,headers:r.headers||{},raw:r.body,body};
}
const CREATE={action:'create',subject:{type:'journal',id:'JV-27-0001',no:'JV-27-0001'},
  file:{publicId:PID,format:'pdf',type:'authenticated',resourceType:'image'},filename:'JV-27-0001.pdf'};
// A share as ma-share itself would write it, for seeding.
function stored(o){
  return Object.assign({docKind:'journal',docId:'JV-27-0001',docNo:'JV-27-0001',pdfPublicId:PID,format:'pdf',resourceType:'image',
    deliveryType:'authenticated',filename:'JV-27-0001.pdf',to:null,createdBy:'afnan',createdAt:NOW,days:7,expiresAt:NOW+7*DAY,
    revoked:false,revokedAt:null,revokedBy:null,opens:0,lastOpenedAt:null,previews:0,lastPreviewAt:null},o||{});
}
const tok=c=>c.repeat(43);
const audits=st=>Object.keys(st.docs).filter(k=>k.indexOf('ma_audit/')===0).map(k=>st.docs[k]);

module.exports=async function(){
  const s=suite('ma-share');

  await withEnv(SIGNED_ENV,async()=>{
    s.section('create — an owner makes a link');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-share.js',st);
      const r=await run(fn,post(CREATE));
      s.eq('200',r.status,200);
      const t=(r.body||{}).token;
      s.ok('the token is 32 random bytes, base64url',/^[A-Za-z0-9_-]{43}$/.test(t),t);
      s.eq('the answer is a PATH — the client puts its own origin in front',r.body.path,'/.netlify/functions/ma-share?t='+t);
      s.ok('… no host is guessed anywhere in the answer',!/https?:\/\//.test(r.raw.replace(/"url":"[^"]*"/g,'')));
      const d=st.docs['ma_shares/'+t]||{};
      s.ok('ma_shares/<token> is written',!!st.docs['ma_shares/'+t]);
      s.eq('it names the document (the plan\'s docKind, docId)',J([d.docKind,d.docId,d.docNo]),J(['journal','JV-27-0001','JV-27-0001']));
      s.eq('… and the PDF (the plan\'s pdfPublicId)',J([d.pdfPublicId,d.format,d.resourceType,d.deliveryType]),J([PID,'pdf','image','authenticated']));
      s.eq('made by the verified caller, by username — the rules\' createdBy',d.createdBy,'afnan');
      s.eq('born live and unopened — the rules\' create shape',J([d.revoked,d.opens]),J([false,0]));
      s.eq('with no settings document, the core\'s default: 7 days',J([d.days,d.expiresAt-d.createdAt,r.body.expiresAt]),J([7,7*DAY,NOW+7*DAY]));
      s.eq('every other field is there, empty',J([d.revokedAt,d.revokedBy,d.lastOpenedAt,d.previews,d.lastPreviewAt,d.to]),J([null,null,null,0,null,null]));
      s.eq('the share and its audit row went in ONE batch',J(st.batches.map(b=>b.map(w=>w.op+' '+w.path.split('/')[0]))),J([['create ma_shares','set ma_audit']]));
      const a=audits(st);
      s.eq('one audit row: share, the document, who, when',J(a.map(x=>[x.action,x.target.no,x.by,x.at])),J([['share','JV-27-0001','afnan',NOW]]));
      s.ok('… saying what and for how long',/JV-27-0001\.pdf · 7 days/.test((a[0]||{}).detail),(a[0]||{}).detail);
      const r2=await run(fn,post(CREATE));
      s.ok('a second link to the same PDF has its own token',!!(r2.body||{}).token&&(r2.body||{}).token!==t);
    }

    s.section('create — how long a link lives');
    {
      const days=async(body,seed)=>{
        const st={tokens:TOKENS,docs:seed||{}};const fn=loadFn('netlify/functions/ma-share.js',st);
        const r=await run(fn,post(Object.assign({},CREATE,body)));
        return r.status===200?(r.body||{}).days:r.status+' '+(r.body||{}).code;
      };
      s.eq('the owners\' setting share.defaultDays when none is asked for',await days({},{'ma_settings/main':{share:{defaultDays:14}}}),14);
      s.eq('a setting the core would refuse (500) falls back to 7',await days({},{'ma_settings/main':{share:{defaultDays:500}}}),7);
      s.eq('asked for 3 days → 3',await days({days:3}),3);
      s.eq('2.6 days → 3',await days({days:2.6}),3);
      s.eq('120 days is capped at the most the setting allows, 90',await days({days:120}),90);
      s.eq('0 days → 400 days',await days({days:0}),'400 days');
      s.eq('a string → 400 days',await days({days:'7'}),'400 days');
      const st={tokens:TOKENS,docs:{},failRead:'unavailable'};const fn=loadFn('netlify/functions/ma-share.js',st);
      const r=await run(fn,post(CREATE));
      s.eq('an unreadable settings document still gives a 7-day link',J([r.status,(r.body||{}).days]),J([200,7]));
    }

    s.section('create — what is refused');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-share.js',st);
      const c=async(body,token)=>{const r=await run(fn,post(Object.assign({},CREATE,body),token));return r.status+' '+(r.body&&r.body.code);};
      s.eq('no token → 401 auth',await c({},null),'401 auth');
      s.eq('a forged token → 401 auth',await c({},'t_forged'),'401 auth');
      s.eq('Mustafa → 403 forbidden',await c({},'t_mustafa'),'403 forbidden');
      s.eq('Raees → 403 forbidden',await c({},'t_raees'),'403 forbidden');
      s.eq('no subject → 400 subject',await c({subject:undefined}),'400 subject');
      s.eq('a subject type that is not a word → 400 subject',await c({subject:{type:'Journal!',id:'x'}}),'400 subject');
      s.eq('a subject id with a slash → 400 subject',await c({subject:{type:'journal',id:'a/b'}}),'400 subject');
      s.eq('not our file → 400 file',await c({file:{publicId:'profile/x',format:'pdf',type:'upload'}}),'400 file');
      s.eq('a photo is not a PDF → 400 file',await c({file:{publicId:PID,format:'jpg',type:'authenticated'}}),'400 file');
      s.eq('a phone that is not a phone → 400 to',await c({to:{party:'Asghar',phone:'call me'}}),'400 to');
      s.eq('an unknown action → 400 action',await c({action:'list'}),'400 action');
      s.eq('nothing refused left a share or an audit row behind',Object.keys(st.docs).length,0);
      const r=await run(fn,post(Object.assign({},CREATE,{to:{party:'Asghar Printing',phone:'+92 300 1234567'},filename:'  State\u0007ment/\u0000Q1 '})));
      const d=st.docs['ma_shares/'+(r.body||{}).token]||{};
      s.eq('who it is for is kept',J(d.to),J({party:'Asghar Printing',phone:'+92 300 1234567'}));
      s.eq('the file name is cleaned and ends .pdf',d.filename,'State ment- Q1.pdf');
      const r2=await run(fn,post(Object.assign({},CREATE,{filename:undefined})));
      s.eq('no file name → the document number',(st.docs['ma_shares/'+(r2.body||{}).token]||{}).filename,'JV-27-0001.pdf');
    }

    s.section('GET — a live link opens the PDF, and counts');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-share.js',st);
      const t=((await run(fn,post(CREATE))).body||{}).token;
      const at=NOW+3600000;
      const r=await run(fn,get(t),at);
      s.eq('302',r.status,302);
      const u=new URL(r.headers.Location||'https://missing.invalid/');
      s.eq('to Cloudinary\'s download API for THIS PDF',J([u.origin+u.pathname,u.searchParams.get('public_id'),u.searchParams.get('format'),u.searchParams.get('type')]),
        J(['https://api.cloudinary.com/v1_1/deww4lpym/image/download',PID,'pdf','authenticated']));
      const q=Object.fromEntries(u.searchParams);
      s.eq('a link that itself dies 5 minutes after the open',Number(q.expires_at),Math.floor(at/1000)+300);
      s.eq('its signature, recomputed independently, matches',q.signature,indepSig({timestamp:Number(q.timestamp),public_id:PID,format:'pdf',type:'authenticated',expires_at:Number(q.expires_at)},SECRET));
      s.eq('no-store, no-referrer, noindex',J([r.headers['Cache-Control'],r.headers['Referrer-Policy'],/noindex/.test(r.headers['X-Robots-Tag'])]),J(['no-store','no-referrer',true]));
      const d=st.docs['ma_shares/'+t]||{};
      s.eq('the open is counted, with when',J([d.opens,d.lastOpenedAt,d.previews]),J([1,at,0]));
      await run(fn,get(t),at+1000);
      s.eq('a second open → 2',(st.docs['ma_shares/'+t]||{}).opens,2);
      const w=await run(fn,get(t,WHATSAPP),at+2000);
      s.eq('WhatsApp building its preview still gets the file',w.status,302);
      const dw=st.docs['ma_shares/'+t]||{};
      s.eq('… but is counted as a preview, not as the vendor opening it',J([dw.opens,dw.previews,dw.lastPreviewAt]),J([2,1,at+2000]));
      s.eq('opening writes no audit row (the plan audits shares and revokes, not opens)',audits(st).length,1);
      s.ok('the secret is not in the redirect',String(r.headers.Location||'').indexOf(SECRET)<0);
      st.failWrite='deadline exceeded';
      const f=await run(fn,get(t),at+3000);
      s.eq('a count that cannot be written does not stop the file',f.status,302);
    }

    s.section('GET — what is refused, and how it looks');
    {
      const st={tokens:TOKENS,docs:{
        ['ma_shares/'+tok('A')]:stored(),
        ['ma_shares/'+tok('B')]:stored({revoked:true,revokedAt:NOW+5,revokedBy:'ammar',docNo:'<img src=x onerror=alert(1)>'}),
        ['ma_shares/'+tok('C')]:stored({revoked:true,revokedAt:NOW+5,revokedBy:'ammar',expiresAt:NOW+DAY}),
        ['ma_shares/'+tok('D')]:stored({docNo:'Statement "Q1" <Asghar>'})
      }};
      const fn=loadFn('netlify/functions/ma-share.js',st);
      const page=async(t,now,ua)=>run(fn,get(t,ua),now);
      const nf=await page(tok('Z'));
      s.eq('an unknown token → 404',nf.status,404);
      const reads0=st.reads||0;
      const mal=await page('<script>alert(1)</script>');
      s.eq('a malformed token → 404',mal.status,404);
      s.eq('… decided without reading Firestore at all',(st.reads||0)-reads0,0);
      s.ok('… and it is not echoed back',mal.raw.indexOf('<script>alert')<0&&mal.raw.indexOf('alert(1)')<0);
      s.eq('no token at all → 404',(await page(undefined)).status,404);
      s.eq('a live link, one millisecond before it expires → 302',(await page(tok('A'),NOW+7*DAY-1)).status,302);
      const ex=await page(tok('A'),NOW+7*DAY);
      s.eq('at its expiry → 410',ex.status,410);
      s.ok('… "has expired", with the day it closed, in Pakistan time',/has expired/.test(ex.raw)&&/12 Oct 2026/.test(ex.raw));
      const rv=await page(tok('B'));
      s.eq('withdrawn → 410',rv.status,410);
      s.ok('… "has been withdrawn"',/has been withdrawn/.test(rv.raw));
      s.ok('… and what it echoes is ESCAPED',rv.raw.indexOf('&lt;img src=x onerror=alert(1)&gt;')>=0&&rv.raw.indexOf('<img src=x')<0);
      s.ok('withdrawn AND expired says withdrawn',/has been withdrawn/.test((await page(tok('C'),NOW+30*DAY)).raw));
      const q=await page(tok('D'),NOW+8*DAY);
      s.ok('quotes are escaped too',q.raw.indexOf('Statement &quot;Q1&quot; &lt;Asghar&gt;')>=0);
      for(const [label,r] of [['404',nf],['410 expired',ex],['410 withdrawn',rv]]){
        const tags=(r.raw.match(/<[a-z][^>]*>/gi)||[]).map(x=>x.toLowerCase());
        s.ok(label+': a small self-contained page — no script, no stylesheet, nothing loaded',
          /^<!doctype html>/.test(r.raw)&&tags.length>0&&tags.every(x=>!/^<(script|link|img|iframe|object|embed|form|base)\b/.test(x)&&!/\s(src|href|action)=/.test(x))&&!/@import|url\(/i.test(r.raw),
          tags.filter(x=>/^<(script|link|img|iframe|object|embed|form|base)\b/.test(x)||/\s(src|href|action)=/.test(x)).join(' ')||undefined);
        s.eq(label+': html, no-store, no-referrer, noindex, a CSP that allows nothing to load',
          J([r.headers['Content-Type'],r.headers['Cache-Control'],r.headers['Referrer-Policy'],/noindex/.test(r.headers['X-Robots-Tag']),/default-src 'none'/.test(r.headers['Content-Security-Policy'])]),
          J(['text/html; charset=utf-8','no-store','no-referrer',true,true]));
      }
      s.eq('a withdrawn link counts nothing',st.docs['ma_shares/'+tok('B')].opens,0);
      const h=await run(fn,{httpMethod:'HEAD',headers:{},queryStringParameters:{t:tok('A')}});
      s.eq('HEAD → 405, GET or POST only',J([h.status,h.headers.Allow]),J([405,'GET, POST']));
    }

    s.section('GET — a share document it would not have written is unknown');
    {
      const bad={
        'revoked missing':stored({revoked:undefined}),
        'revoked is a string':stored({revoked:'false'}),
        'no expiry':stored({expiresAt:undefined}),
        'a window longer than 90 days':stored({expiresAt:NOW+91*DAY}),
        'made in the future (two days after it is opened)':stored({createdAt:NOW+3*DAY,expiresAt:NOW+4*DAY}),
        'expiring before it was made':stored({expiresAt:NOW-1}),
        'a file that is not ours':stored({pdfPublicId:'profile/abc'}),
        'a photo, not a PDF':stored({format:'jpg'}),
        'a delivery type that is not ours':stored({deliveryType:'private'}),
        'the M1.2 emulator\'s client-written shape (no file)':{createdBy:'afnan',createdAt:NOW,expiresAt:NOW+7*DAY,revoked:false,opens:0,target:{dt:'journal',no:'JV-27-0001'}}
      };
      const docs={};const ids={};let i=0;
      for(const [k,v] of Object.entries(bad)){const t=tok(String.fromCharCode(97+i++));ids[k]=t;const c=JSON.parse(JSON.stringify(v));docs['ma_shares/'+t]=c;}
      const st={tokens:TOKENS,docs};const fn=loadFn('netlify/functions/ma-share.js',st);
      for(const k of Object.keys(bad)){
        const r=await run(fn,get(ids[k]),NOW+DAY);
        s.eq(k+' → 404, nothing served',r.status,404);
      }
      s.ok('and none of them was counted',Object.keys(docs).every(k=>!st.docs[k].opens));
    }

    s.section('revoke — withdrawn for good');
    {
      const st={tokens:TOKENS};const fn=loadFn('netlify/functions/ma-share.js',st);
      const t=((await run(fn,post(CREATE))).body||{}).token;
      const m=await run(fn,post({action:'revoke',token:t},'t_mustafa'));
      s.eq('Mustafa cannot revoke → 403',m.status,403);
      s.eq('… and the link is untouched',(st.docs['ma_shares/'+t]||{}).revoked,false);
      const nt=await run(fn,post({action:'revoke',token:t},null));
      s.eq('nor anyone without a token → 401',nt.status,401);
      const r=await run(fn,post({action:'revoke',token:t},'t_ammar'),NOW+60000);
      s.eq('Ammar revokes Afnan\'s link → 200',J([r.status,(r.body||{}).revoked,(r.body||{}).already]),J([200,true,false]));
      const d=st.docs['ma_shares/'+t]||{};
      s.eq('the rules\' revoke shape: revoked, revokedAt, revokedBy (a username)',J([d.revoked,d.revokedAt,d.revokedBy]),J([true,NOW+60000,'ammar']));
      s.eq('… and nothing else moved',J([d.expiresAt,d.createdBy,d.opens]),J([NOW+7*DAY,'afnan',0]));
      const a=audits(st).filter(x=>x.action==='revoke');
      s.eq('one revoke audit row, by Ammar, naming the document',J(a.map(x=>[x.by,x.target.no,x.at])),J([['ammar','JV-27-0001',NOW+60000]]));
      s.eq('the revoke and its audit row were one transaction',J(st.txs.map(w=>w.map(x=>x.op+' '+x.path.split('/')[0]))),J([['update ma_shares','set ma_audit']]));
      const again=await run(fn,post({action:'revoke',token:t}),NOW+120000);
      const ab=again.body||{};
      s.eq('revoking again is harmless: 200, already',J([again.status,ab.already,ab.revokedAt,ab.revokedBy]),J([200,true,NOW+60000,'ammar']));
      s.eq('… with no second audit row',audits(st).filter(x=>x.action==='revoke').length,1);
      s.eq('a GET now → 410',(await run(fn,get(t),NOW+180000)).status,410);
      const uq=await run(fn,post({action:'revoke',token:tok('Q')}));
      s.eq('an unknown token → 404 not_found',J([uq.status,(uq.body||{}).code]),J([404,'not_found']));
      s.eq('a malformed token → 400 token',((await run(fn,post({action:'revoke',token:'short'}))).body||{}).code,'token');
    }
  });

  await withEnv(UNSIGNED_ENV,async()=>{
    s.section('without the Cloudinary key');
    const st={tokens:TOKENS,docs:{['ma_shares/'+tok('P')]:stored()}};const fn=loadFn('netlify/functions/ma-share.js',st);
    const c=await run(fn,post(CREATE));
    s.eq('a PRIVATE PDF cannot be shared → 503 not_configured',J([c.status,(c.body||{}).code]),J([503,'not_configured']));
    const g=await run(fn,get(tok('P')),NOW+1000);
    s.eq('a private share already made cannot be served → 503 page',J([g.status,/cannot be opened right now/.test(g.raw)]),J([503,true]));
    s.eq('… and that is not counted as an open',st.docs['ma_shares/'+tok('P')].opens,0);
    const pub=Object.assign({},CREATE,{file:{publicId:PID,format:'pdf',type:'upload'}});
    const r=await run(fn,post(pub));
    s.eq('a PUBLIC PDF (the fallback) can be shared',r.status,200);
    const o=await run(fn,get((r.body||{}).token),NOW+1000);
    s.eq('… and opens at its public URL',J([o.status,o.headers.Location]),J([302,'https://res.cloudinary.com/deww4lpym/image/upload/'+PID+'.pdf']));
    s.eq('… counted',(st.docs['ma_shares/'+(r.body||{}).token]||{}).opens,1);
  });

  await withEnv({FIREBASE_SERVICE_ACCOUNT:undefined},async()=>{
    s.section('no service account, or Firestore down — a page, never a crash');
    const fn=loadFn('netlify/functions/ma-share.js',{tokens:TOKENS});
    const g=await run(fn,get(tok('A')));
    s.eq('GET → 503 page',J([g.status,g.headers['Content-Type']]),J([503,'text/html; charset=utf-8']));
    const p=await run(fn,post(CREATE));
    s.eq('POST → 503 not_configured',J([p.status,(p.body||{}).code]),J([503,'not_configured']));
  });
  await withEnv(SIGNED_ENV,async()=>{
    const fn=loadFn('netlify/functions/ma-share.js',{tokens:TOKENS,docs:{['ma_shares/'+tok('A')]:stored()},failRead:'unavailable'});
    const g=await run(fn,get(tok('A')),NOW+1000);
    s.eq('a failed read → 503 page, not a 404 that would call a good link bad',g.status,503);
  });

  s.section('owners read ma_shares under the rules — so there is no list action');
  {
    const rules=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
    const m=/match \/ma_shares\/\{token\}\s*\{([\s\S]*?)\n    \}/.exec(rules);
    s.ok('the ma_shares block lets an owner read',!!m&&/allow read:\s*if isMasterAccounts\(\);/.test(m[1]));
    s.ok('… and never delete',!!m&&/allow delete:\s*if false;/.test(m[1]));
  }
  return s;
};

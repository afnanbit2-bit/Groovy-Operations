/* Inventory Intel: the owners' "Run returns refresh" button (Data checks area). Stubbed fetch and auth only:
   nothing here calls a live endpoint. Checks: shown to owners while returns are unsynced, hidden once synced and for
   anyone else; one POST {idToken,days:365} to the existing endpoint; double-press guard; errors shown. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
function mk(user,fetchImpl){
  const calls=[];
  const a=harness.loadApp({files:[],session:{uid:'u1',u:user,name:user,role:user==='afnan'||user==='ammar'?'owner':'manager'},
    globals:{auth:{currentUser:{getIdToken:async()=>'TOKEN123'}},
      fetch:async(u,i)=>{calls.push({u,i});return fetchImpl(u,i);},
      getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false})}});
  vm.runInContext(SRC,a.ctx,{filename:'shopify.js'});
  return{a,calls};
}
const resp=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
module.exports=async function(){
  const s=harness.suite('shopify-returns-refresh-button');
  const html=(m,synced)=>{m.a.run('_siAxIndex=()=>({quality:{returns:{synced:'+synced+'}}})');return m.a.run('_siRrHtml()');};
  let m=mk('afnan',()=>resp(202,{}));
  s.ok('owner sees the button while returns are unsynced',/Run returns refresh/.test(html(m,false)));
  s.ok('hidden once returns are synced',html(m,true)==='');
  s.ok('Ammar (owner) sees it',/Run returns refresh/.test(html(mk('ammar',()=>resp(202,{})),false)));
  s.ok('Mustafa (not an owner) does not',html(mk('mustafa',()=>resp(202,{})),false)==='');
  m=mk('afnan',()=>resp(202,{}));html(m,false);
  await m.a.run('window._siRrRun()');
  s.eq('one POST',m.calls.length,1);
  s.eq('endpoint',m.calls[0]&&m.calls[0].u,'/.netlify/functions/shopify-order-refresh-now-background');
  s.eq('method',m.calls[0]&&m.calls[0].i.method,'POST');
  const body=JSON.parse(m.calls[0].i.body);
  s.ok('body is {idToken, days:365} and nothing else',body.idToken==='TOKEN123'&&body.days===365&&Object.keys(body).length===2);
  const n=mk('mustafa',()=>resp(202,{}));await n.a.run('window._siRrRun()');
  s.eq('non-owner press makes no request',n.calls.length,0);
  let release;const gate=new Promise(r=>{release=r;});
  const d=mk('afnan',async()=>{await gate;return resp(202,{});});
  const p1=d.a.run('window._siRrRun()');const p2=d.a.run('window._siRrRun()');
  await new Promise(r=>setTimeout(r,5));
  s.eq('double press sends one request',d.calls.length,1);
  release();await p1;await p2;
  s.eq('still one request after it finishes',d.calls.length,1);
  const e=mk('afnan',()=>resp(403,{error:'Only an owner can re-sync order statuses.'}));
  await e.a.run('window._siRrRun()');
  s.ok('server error text is kept for display',e.a.run('_siRrMsg')==='Only an owner can re-sync order statuses.');
  s.ok('and rendered in the block',/Only an owner/.test(html(e,false)));
  s.ok('button usable again after an error',e.a.run('_siRrBusy')===false);
  const x=mk('afnan',()=>{throw new Error('offline');});
  await x.a.run('window._siRrRun()');
  s.ok('network error shown',/Network error: offline/.test(x.a.run('_siRrMsg')));
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   Who sees the Store, and who holds its danger zone (25 Sept 2026).

   Afnan asked which profiles could see Store, and the answer turned up
   Uzaib — a VIEWER — getting the whole section on desktop, because
   buildNav() gated it on !isWorker alone. Then: "remove uzaib and give
   ammar the same access as i do". So:
     - the Store sidebar section is for owners, managers and the store role;
       workers, viewers and every scoped role get none of it;
     - the Store danger zone (full stock overwrite, reconstruct-from-log)
       is Afnan and Ammar by USERNAME — never the owner role.
   Every USER_DEFS account is driven through the real buildNav(), so a new
   account lands here by default rather than by someone remembering.
   The Store Accounts admin tools are held by store-accounts.test.js.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const harness=require('./harness');
const {suite}=harness;
const LS={getItem:()=>null,setItem(){},removeItem(){}};
const loadApp=o=>harness.loadApp(Object.assign({},o,{globals:Object.assign({localStorage:LS},(o&&o.globals)||{})}));
const J=v=>JSON.stringify(v);
// buildNav() reads helpers from each of these (payroll gates, recipe gates,
// the edit inbox, the Accounts gate), so the real nav needs all of them.
const NAV_FILES=['js/shared.js','js/auth.js','js/embellishments.js','js/hrm.js','js/store.js','js/store-accounts.js'];

module.exports=async function(){
  const s=suite('store-access');

  s.section('the Store section in the sidebar, for every account');
  {
    const a=loadApp({files:NAV_FILES,currentPage:'dashboard'});
    const users=JSON.parse(a.run('JSON.stringify(USER_DEFS)'));
    const see={};
    for(const u of users){
      const b=loadApp({files:NAV_FILES,currentPage:'dashboard'});
      b.run('session='+J(Object.assign({uid:'u-'+u.u},u)));
      try{b.run('buildNav()');}catch(e){see[u.u]={threw:e.message};s.ok(u.u+': buildNav() runs',false,e.message);continue;}
      const html=b.el('sidebar').innerHTML||'';
      see[u.u]={store:/nav-store-toggle/.test(html),accounts:/showPage\('acct-ledger'\)/.test(html)};
    }
    const storeUsers=Object.keys(see).filter(k=>see[k]&&see[k].store).sort();
    s.eq('exactly the owners, the managers and Raees see Store',J(storeUsers),J(['afnan','ammar','arfat','mustafa','raees']));
    s.ok('uzaib (a viewer) does not',see.uzaib&&see.uzaib.store===false);
    ['haris','abbas','waqas','asghar','zohaib'].forEach(w=>s.ok(w+' (a worker) does not',see[w]&&see[w].store===false));
    const acct=Object.keys(see).filter(k=>see[k]&&see[k].accounts).sort();
    s.eq('Accounts inside it: the same five',J(acct),J(['afnan','ammar','arfat','mustafa','raees']));
  }

  s.section('the Store danger zone — Afnan and Ammar by username');
  {
    const a=loadApp({files:['js/store.js']});
    const as=u=>{a.run('session='+J(u));return a.run('_storeIsSuper()');};
    s.eq('afnan holds it',as({u:'afnan',role:'owner'}),true);
    s.eq('ammar holds it',as({u:'ammar',role:'owner'}),true);
    s.eq('another owner does not — it is a list, not the role',as({u:'zed',role:'owner'}),false);
    s.eq('a manager does not',as({u:'mustafa',role:'manager'}),false);
    s.eq('raees does not',as({u:'raees',role:'store'}),false);
    s.eq('the list is exactly the two',a.run('JSON.stringify(_STORE_SUPER_USERS)'),'["afnan","ammar"]');
    const src=fs.readFileSync(path.join(__dirname,'..','js/store.js'),'utf8');
    s.eq('no Store gate still names one username',(src.match(/session\.u\s*[!=]==\s*'afnan'/g)||[]).length,0);
    s.eq('all four danger-zone gates read the helper',(src.match(/_storeIsSuper\(\)/g)||[]).length-1,4);
  }

  s.section("Faizan's account: role packing, title 'QC Ops \u00b7 Packing', no password, nav unchanged");
  {
    const a=loadApp({files:NAV_FILES,currentPage:'dashboard'});
    const f=JSON.parse(a.run("JSON.stringify(USER_DEFS.find(d=>d.u==='faizan'))"));
    s.eq("faizan keeps role 'packing'",f&&f.role,'packing');
    s.eq("faizan's title is 'QC Ops \u00b7 Packing' (U+00B7)",f&&f.title,'QC Ops \u00b7 Packing');
    s.ok('faizan has no pass field (and no password-like key)',f&&!('pass' in f)&&!Object.keys(f).some(k=>/pass|pwd/i.test(k)));
    s.eq('faizan: the fields other than title are as before',J(Object.assign({},f,{title:'-'})),
      J({u:'faizan',email:'faizan@groovy.op',name:'Faizan',role:'packing',title:'-',canPO:false,canFabric:false,stages:[]}));
    // His sidebar through the real buildNav(): Packing + B-Stock, plus the QC Ops entry (QC5) when the Production Ops data layer is loaded.
    const nav=(files)=>{const b=loadApp({files:files,currentPage:'dashboard'});b.run('session='+J(Object.assign({uid:'u-faizan'},f)));b.run('buildNav()');
      const h=b.el('sidebar').innerHTML||'';return [...h.matchAll(/showPage\('([^']+)'\)/g)].map(m=>m[1]);};
    s.eq('faizan sidebar (no Production Ops loaded): Packing + B-Stock only',J(nav(NAV_FILES)),J(['packing','bstock']));
    s.eq('faizan sidebar with Production Ops loaded: Packing, B-Stock, and the QC Ops entry (QC5) -- still nothing else',
      J(nav(NAV_FILES.concat(['js/ph-core.js','js/ph-data.js']))),J(['packing','bstock','prod-ops']));
  }

  return s;
};

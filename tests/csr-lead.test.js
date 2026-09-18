/* ─────────────────────────────────────────────────────────────────────────
   CSR Team Lead (Sami) — a scoped, view-only role.

   Guards: the account exists with the right role and title; showPage lets
   it reach exactly its six pages (plus Creative Hub's children and the
   chrome pages) and nothing else; its sidebar lists exactly those pages;
   the dashboard is the limited view; QC Disposition and Fabric Inventory
   offer it no way to write; and the other roles are untouched.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const harness=require('./harness');
const {suite}=harness;
const LS={getItem:()=>null,setItem(){},removeItem(){}};
const loadApp=o=>harness.loadApp(Object.assign({},o,{globals:Object.assign({localStorage:LS},(o&&o.globals)||{})}));
const J=v=>JSON.stringify(v);
const SAMI={uid:'u-sami',u:'sami',name:'Sami',role:'csr_lead',title:'CSR Team Lead',email:'sami@groovy.op',canFabric:true};

module.exports=async function(){
  const s=suite('csr-lead');

  s.section('the account');
  {
    const a=loadApp({files:['js/shared.js','js/auth.js']});
    const d=a.run("USER_DEFS.find(x=>x.u==='sami')");
    s.ok('sami is in USER_DEFS',!!d);
    s.eq('with the csr_lead role',d&&d.role,'csr_lead');
    s.eq('titled CSR Team Lead',d&&d.title,'CSR Team Lead');
    s.eq('on the groovy.op domain every other account uses',d&&d.email,'sami@groovy.op');
    s.ok('and no password field',d&&!('pass' in d));
    s.eq('no PO creation',d&&d.canPO,false);
  }

  s.section('where the role can go');
  {
    const a=loadApp({files:['js/shared.js','js/auth.js'],currentPage:'dashboard'});
    a.run('session='+J(SAMI));
    a.run('renderPage=function(id){globalThis.__got=id;}');
    const go=id=>{a.run('globalThis.__got=null');a.run('window.showPage('+J(id)+')');return a.run('__got');};
    ['dashboard','qc-disposition','bstock','fabric-inventory','shopify-intel','creative-hub','notes','note-detail','boards','boards-all','board-canvas','profile','bug-tracker']
      .forEach(id=>s.eq('reaches '+id,go(id),id));
    ['users','po-registry','po-create','po-detail','gatepass','hrm-payroll','attendance','store-dashboard','mkt-creators','monitor','activity','packing','fulfillment','pattern-hub']
      .forEach(id=>s.eq('is sent home from '+id,go(id),'dashboard'));
    s.eq('the Creative Hub gate includes sami',a.run('_canSeeCreativeHub()'),true);
  }
  {
    const a=loadApp({files:['js/shared.js','js/auth.js'],currentPage:'dashboard'});
    a.run('session='+J(SAMI));
    a.run('buildNav()');
    const html=a.el('sidebar').innerHTML;
    const ids=(html.match(/showPage\('([a-z-]+)'\)/g)||[]).map(x=>x.slice(10,-2));
    s.eq('the sidebar lists exactly the six pages',J(ids),J(['dashboard','qc-disposition','bstock','fabric-inventory','shopify-intel','creative-hub']));
    const mob=a.el('mob-nav').innerHTML;
    s.ok('the phone nav has Home, QC, B-Stock, Fabric and More',/Home[\s\S]*QC[\s\S]*B-Stock[\s\S]*Fabric[\s\S]*More/.test(mob));
  }
  {
    // Nobody else is affected. ARFAT, not Mustafa, is the manager who proves
    // the hub gate is still a LIST rather than the role: Mustafa was added to
    // _CREATIVE_HUB_USERS in Sept 2026 and would now pass either way, which
    // is exactly the shape that makes a role-wide grant look correct.
    const a=loadApp({files:['js/shared.js','js/auth.js'],currentPage:'dashboard'});
    a.run('session='+J({uid:'u',u:'arfat',name:'Arfat',role:'manager',email:'arfat@groovy.op'}));
    a.run('renderPage=function(id){globalThis.__got=id;}');
    a.run("window.showPage('users')");
    s.eq('a manager is not redirected by the CSR scope',a.run('__got'),'users');
    s.eq('and a manager outside the list still cannot see Creative Hub',
      a.run('_canSeeCreativeHub()'),false);
    a.run('session='+J({uid:'u',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'}));
    s.eq('while Mustafa, who is on the list, can',a.run('_canSeeCreativeHub()'),true);
  }

  s.section('view only');
  {
    const a=loadApp({files:['js/shared.js','js/auth.js','js/fabric.js'],currentPage:'fabric-inventory'});
    a.run('session='+J(SAMI));
    const page=a.run('renderFabricPage()');
    s.ok('Fabric Inventory says view only',/View only/.test(page));
    s.ok('and shows Stock, Issue Registry, Reports and Log',['stock','registry','reports','log'].every(t=>page.includes("switchFabTab('"+t+"')")));
    s.ok('but none of the entry tabs',!['fabricin','issue','drawstring','returns'].some(t=>page.includes("switchFabTab('"+t+"')")));
    s.eq('asking for an entry tab lands on Stock',(()=>{try{a.run("window.switchFabTab('issue')");}catch(_){ }return a.run('fabActiveTab');})(),'stock');
    const o=loadApp({files:['js/shared.js','js/auth.js','js/fabric.js'],currentPage:'fabric-inventory'});
    o.run('session='+J({uid:'u',u:'uzaib',name:'Uzaib',role:'viewer',email:'uzaib@groovy.op',canFabric:true}));
    const op=o.run('renderFabricPage()');
    s.ok('the fabric team keeps every tab',['fabricin','issue','drawstring','returns'].every(t=>op.includes("switchFabTab('"+t+"')"))&&!/View only/.test(op));
  }
  {
    const a=loadApp({files:['js/shared.js','js/auth.js','js/production.js'],currentPage:'qc-disposition'});
    a.run('session='+J(SAMI));
    s.eq('QC recording is refused for the role',a.run('_qcCanRecord()'),false);
    // shared.js brings its own showToast, which writes to #toast.
    await a.run("window.qcRecord('x')");
    s.ok('recording refuses before touching anything',/View only/.test(a.el('toast').textContent));
    a.el('toast').textContent='';
    await a.run("window.qcResolveRework('x','barcode')");
    s.ok('so does resolving rework',/View only/.test(a.el('toast').textContent));
    s.eq('and nothing is written',a.state.writes.length,0);
    const h=loadApp({files:['js/shared.js','js/auth.js','js/production.js'],currentPage:'qc-disposition'});
    h.run('session='+J({uid:'u',u:'haris',name:'Haris',role:'worker',email:'haris@groovy.op',stages:['qc']}));
    s.eq('Haris still records QC',h.run('_qcCanRecord()'),true);
  }
  {
    const src=require('fs').readFileSync(require('path').join(__dirname,'..','js','embellishments.js'),'utf8');
    s.ok('the dashboard has a limited view for the role, without the PO list',
      /isCsrLead\(\)\)\{\s*return base\+`<div class="empty"[^`]*Limited view/.test(src));
  }
  return s;
};

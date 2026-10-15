/* ─────────────────────────────────────────────────────────────────────────
   Production Ops ▸ classic pages hosted as rail tabs (WP-15, Oct 2026).

   For the cutting FLOOR user only (Kashif, login uzaib: on the Production Ops audience, not a manager) three pages that used to
   be sidebar items live INSIDE Production Ops as rail tabs: PO Registry, Pattern updates, Fabric Inventory. Managers keep their
   sidebar entries and get no new tabs. The classic pages are NOT rewritten and keep every write they have today: this file only
   asks the existing renderer for its markup and hosts it in the tab's panel. It writes nothing of its own.

   XSS convention: the ONE place this file turns a string into markup is _phclMount(), and the string always comes straight out
   of renderRegistry() / renderPatternHub() / renderFabricPage() (existing code that escapes its own data). No literal, ctx value or
   stored text is ever interpolated here; everything else is built with createElement/textContent through the shell's phEl.

   Direct navigation: openPODetail() sets currentPage and paints the detail page without showPage(), so the takeover (which only
   follows showPage) would stay up over it. One capture-phase click listener on the hosted wrapper asks the shell to re-check the
   page after the click, so ANY direct navigation releases the takeover.
   ───────────────────────────────────────────────────────────────────────── */

const PHCL_NOTE_KEY='classic.snapshot_note';
let _phclSeq=0;

// The audience: on Production Ops but not a manager. Fails CLOSED (a missing data layer shows nobody the tabs).
function phclIsFloor(u){
  try{return typeof phCanSee==='function'&&typeof phCanManage==='function'&&phCanSee(u)===true&&phCanManage(u)!==true;}catch(e){return false;}
}
const PHCL_ROLE=function(u){return phclIsFloor(u);};

// The page-data a classic page needs before it can paint (what renderPage / ptnRenderPage load for it).
function _phclNeedPatterns(){
  const need=[];
  try{
    if(typeof patternsLoaded!=='undefined'&&!patternsLoaded&&typeof loadPatternsData==='function')need.push(loadPatternsData());
    if(typeof _ptnShopifyLoaded!=='undefined'&&!_ptnShopifyLoaded&&typeof loadPatternsShopify==='function')need.push(loadPatternsShopify());
    if(typeof _ptnBlocksLoaded!=='undefined'&&!_ptnBlocksLoaded&&typeof loadPatternsBlocks==='function')need.push(loadPatternsBlocks());
    if(typeof _ptnPomsLoaded!=='undefined'&&!_ptnPomsLoaded&&typeof loadPatternsPoms==='function')need.push(loadPatternsPoms());
    if(typeof _ptnNoticesLoaded!=='undefined'&&!_ptnNoticesLoaded&&typeof loadPatternNotices==='function')need.push(loadPatternNotices());
    if(typeof _ptnSettingsLoaded!=='undefined'&&!_ptnSettingsLoaded&&typeof loadPatternSettings==='function')need.push(loadPatternSettings());
  }catch(e){}
  return need;
}

const PHCL_PAGES={
  registry:{
    lkey:'shell.tab_registry',label:'PO Registry',short:'PR',
    html:function(){
      if(typeof renderRegistry!=='function')throw new Error('the PO Registry page is not available');
      return renderRegistry();
    },
    reload:function(){return typeof loadData==='function'?loadData():null;}
  },
  patterns:{
    lkey:'shell.tab_patterns',label:'Pattern updates',short:'Pu',
    html:function(){
      if(typeof renderPatternHub!=='function')throw new Error('the Pattern updates page is not available');
      return renderPatternHub();   // for a non-manager of patterns this IS the updates list
    },
    need:_phclNeedPatterns,
    reload:function(){return typeof loadPatternNotices==='function'?loadPatternNotices():null;}
  },
  fabric:{
    lkey:'shell.tab_fabric',label:'Fabric Inventory',short:'Fi',
    html:function(){
      if(typeof renderFabricPage!=='function')throw new Error('the Fabric Inventory page is not available');
      try{if(typeof _fabInvDrillKey!=='undefined')_fabInvDrillKey=null;}catch(e){}
      return renderFabricPage();
    },
    after:function(){try{if(typeof window!=='undefined'&&typeof window.switchFabTab==='function')window.switchFabTab('stock');}catch(e){console.warn('[prod-ops] fabric tab start failed:',e);}}
  }
};

// The single place a string becomes markup in this file. The string is a renderer's own output.
function _phclMount(body,rendererHtml){
  body.innerHTML=rendererHtml;
}

function _phclError(ctx,msg){
  return typeof _phUiError==='function'?_phUiError(phI18nD('shell.tab_failed'),String(msg)):ctx.el('div','empty',String(msg));
}

function _phclPaintBody(body,page,ctx){
  const seq=++_phclSeq;body.__phclSeq=seq;
  const stillMine=function(){
    if(body.__phclSeq!==seq)return false;
    try{if(typeof document!=='undefined'&&document.body&&typeof document.body.contains==='function'&&!document.body.contains(body))return false;}catch(e){}
    return true;
  };
  const paint=function(){
    if(!stillMine())return;
    try{
      const html=page.html();
      ctx.clear(body);
      _phclMount(body,html);
      if(page.after)page.after();
    }catch(e){
      ctx.clear(body);
      body.appendChild(_phclError(ctx,e&&e.message||e));
      if(typeof console!=='undefined')console.warn('[prod-ops] hosted page failed:',e);
    }
  };
  let need=[];
  try{need=page.need?page.need():[];}catch(e){need=[];}
  if(need.length){
    ctx.clear(body);
    body.appendChild(ctx.el('div','empty',phI18nD('shell.loading_short')));
    Promise.all(need).then(paint,paint);
  }else paint();
}

// A direct navigation out of the hosted page (e.g. a PO row -> openPODetail, which skips showPage) must release the takeover.
function _phclWire(wrap,body,page,ctx){
  wrap.addEventListener('click',function(ev){
    // The registry's own Orders / Cutting tab buttons rewrite #main-content, which would wipe the Production Ops canvas:
    // repaint inside this panel instead.
    try{
      const t=ev&&ev.target&&ev.target.closest?ev.target.closest('button[onclick*="switchPoRegTab"]'):null;
      if(t&&page===PHCL_PAGES.registry){
        const m=/switchPoRegTab\('([a-z]+)'\)/.exec(t.getAttribute('onclick')||'');
        if(m&&typeof _poRegTab!=='undefined'){
          _poRegTab=m[1];
          if(ev.stopPropagation)ev.stopPropagation();
          if(ev.preventDefault)ev.preventDefault();
          _phclPaintBody(body,page,ctx);
          return;
        }
      }
    }catch(e){console.warn('[prod-ops] registry tab switch failed:',e);}
    setTimeout(function(){
      try{if(typeof currentPage!=='undefined'&&currentPage!=='prod-ops'&&typeof _phTkOnPage==='function')_phTkOnPage();}catch(e){}
    },0);
  },true);
}

function _phclRender(id){
  return function(host,ctx){
    const page=PHCL_PAGES[id];
    ctx.clear(host);
    const wrap=ctx.el('div','ph-cl-wrap');
    const bar=ctx.el('div','ph-cl-bar');
    const note=ctx.el('span','ph-cl-note',phI18nD(PHCL_NOTE_KEY));
    const btn=ctx.el('button','ph-btn ph-cl-refresh',phI18nD('shell.refresh'));
    btn.setAttribute('type','button');
    bar.appendChild(note);bar.appendChild(btn);
    const body=ctx.el('div','ph-cl-body');
    wrap.appendChild(bar);wrap.appendChild(body);host.appendChild(wrap);
    btn.addEventListener('click',function(){
      let p=null;
      try{p=page.reload?page.reload():null;}catch(e){p=null;}
      Promise.resolve(p).then(function(){ctx.repaint();},function(){ctx.repaint();});
    });
    _phclWire(wrap,body,page,ctx);
    _phclPaintBody(body,page,ctx);
  };
}

(function(){
  if(typeof phRegisterTab!=='function'){console.warn('[prod-ops] ph-mod-classic: the shell is not loaded, tabs not registered');return;}
  ['registry','patterns','fabric'].forEach(function(id){
    const p=PHCL_PAGES[id];
    phRegisterTab(id,{label:p.label,lkey:p.lkey,short:p.short,roles:PHCL_ROLE,render:_phclRender(id)});
  });
})();

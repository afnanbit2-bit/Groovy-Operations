/* ─────────────────────────────────────────────────────────────────────────
   Production Ops — the three ADMIN tabs: Masters, Standards, Settings (12 Oct 2026).
   Loaded after js/ph-ui.js; it replaces the placeholder render of three tabs through
   phRegisterTab() and touches nothing else of the shell.

   What it does:
     Masters    the register of cutting masters (add / rename / retire), suggestions from names
                already on fabric issues, and a daily and weekly log per master (units cut).
     Standards  the gross standard per article code (unit, gross per piece, tolerance, size model,
                per-size values), a required reason on every save, and coverage.
     Settings   ph_settings/main: capacity, skip days, off weekdays, delay limits, gross
                tolerances, the cut gate, and the PC-only switch (an OWNER's only).

   Rules held here:
     - managers only (afnan, ammar, mustafa). The shell's tab list already hides these tabs from
       Uzaib; each render re-checks and refuses.
     - every write goes through js/ph-write.js (phMasterAdd / phMasterRename / phMasterSetActive /
       phStandardSave / phSettingsSave) and so lands only in cutting_masters, ph_standards,
       ph_settings (+ its counter document). Nothing else is written; nothing is deleted.
     - a failed read NAMES the collection and shows no list, no coverage and no zero. An empty list
       only ever means "read, and empty". "No data yet" is never drawn as 0.
     - days are PKT strings (ph-core phDay). Stored text only reaches the page through textContent.
     - the master log is built from data other modules already load (allPOs: cutAt + cutQty; the
       gate passes' cutMaster; po_cut_jobs masterName) through ph-core's phMasterLog /
       phMastersSummary. It reads those arrays and writes nothing to them.
   Globals: ph / _pha / PHA_ prefixed; classic scripts share ONE lexical scope with ph-core,
   ph-data, ph-write and ph-ui, none of which uses these names.
   ───────────────────────────────────────────────────────────────────────── */

const PHA_DEFAULT_MASTER_NAMES=Object.freeze(['Hassan','Alam']);   // named on gate passes since the cutting master dropdown existed
const PHA_MONTHS=Object.freeze(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);
const PHA_WD=Object.freeze(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
const PHA_WD_LONG=Object.freeze(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']);
const PHA_KINDS=Object.freeze([{v:'unset',t:'Not set'},{v:'inhouse',t:'In-house'},{v:'outsource',t:'Outsourced'}]);
const PHA_ROWS_SHOWN=60;

let _phaFlash=null;            // {tab,kind:'ok'|'bad',text,stale}: the last action's outcome, shown above the tab
let _phaBusy=false;            // one write at a time: a double press must not send two
let _phaM={mode:'month',month:'',week:'',master:'',showRetired:false,edit:null,newName:'',newKind:'unset'};
let _phaS={q:'',filter:'all',limit:PHA_ROWS_SHOWN,edit:null,form:null};
let _phaT={form:null,sig:null,rev:0};
let _phaArtLoading=false;
let _phaLogHost=null,_phaStdListHost=null,_phaStdEditHost=null;

/* ── small builders (nothing here parses a string as HTML) ─────────────── */
function _phaBtn(cls,text,fn,attrs){
  const b=phEl('button','ph-btn pha-btn'+(cls?' '+cls:''),text);b.setAttribute('type','button');
  if(attrs)Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k]);});
  if(fn)b.addEventListener('click',function(e){if(b.getAttribute('disabled')!==null)return;fn(e,b);});
  return b;
}
function _phaHead(title,blurb,ctx){
  const h=phEl('header','ph-head');
  h.appendChild(phEl('div','ph-head-row',null,[phEl('h2','ph-title',title)]));
  if(blurb)h.appendChild(phEl('p','ph-blurb',blurb));
  return h;
}
function _phaCard(title,kids,cls){
  const c=phEl('section','ph-card pha-card'+(cls?' '+cls:''));
  if(title)c.appendChild(phEl('h3','ph-card-title',title));
  (kids||[]).forEach(function(k){if(k)c.appendChild(k);});
  return c;
}
function _phaField(label,control,hint,cls){
  const f=phEl('label','pha-field'+(cls?' '+cls:''));
  f.appendChild(phEl('span','pha-lab',label));
  f.appendChild(control);
  if(hint)f.appendChild(phEl('span','pha-hint',hint));
  return f;
}
function _phaInput(type,value,f,attrs){
  const i=phEl('input','pha-in');i.setAttribute('type',type);
  i.setAttribute('data-f',f);
  if(attrs)Object.keys(attrs).forEach(function(k){i.setAttribute(k,attrs[k]);});
  i.value=value==null?'':String(value);
  return i;
}
function _phaSelect(opts,val,f,attrs){
  const s=phEl('select','pha-in');s.setAttribute('data-f',f);
  if(attrs)Object.keys(attrs).forEach(function(k){s.setAttribute(k,attrs[k]);});
  opts.forEach(function(o){const op=phEl('option',null,o.t);op.value=o.v;if(o.v===val)op.selected=true;s.appendChild(op);});
  s.value=val;
  return s;
}
function _phaCheck(checked,f,label,disabled){
  const l=phEl('label','pha-check');
  const c=phEl('input','pha-cb');c.setAttribute('type','checkbox');c.setAttribute('data-f',f);
  c.checked=!!checked;if(disabled)c.setAttribute('disabled','');
  l.appendChild(c);l.appendChild(phEl('span','pha-check-t',label));
  return l;
}
// keep an input's value in a plain object as it changes (no repaint: the caret must stay put)
function _phaBind(node,obj,key,isBool){
  const f=function(){obj[key]=isBool?!!node.checked:node.value;};
  node.addEventListener('input',f);node.addEventListener('change',f);
}
function _phaChip(text,cls){return phEl('span','ph-chip'+(cls?' '+cls:''),text);}
function _phaNum(n){return Number(n).toLocaleString('en-US');}
function _phaToday(){return phDay(Date.now());}
function _phaDayLabel(d){
  const w=phWeekday(d);
  return(w===null?'':PHA_WD[w]+' ')+Number(d.slice(8,10))+' '+PHA_MONTHS[Number(d.slice(5,7))-1]+' '+d.slice(0,4);
}
function _phaStampLabel(ms){const d=phDay(ms);return d?_phaDayLabel(d):'';}
function _phaGross(n){return String(Math.round(n*10000)/10000);}

/* ── an action's outcome, shown above the tab; one write at a time ─────── */
function _phaFlashFor(tab){
  if(_phaFlash&&_phaFlash.tab!==tab)_phaFlash=null;
  return _phaFlash;
}
function _phaFlashNode(tab,ctx){
  const f=_phaFlashFor(tab);if(!f)return null;
  const c=phEl('section','ph-card pha-flash '+(f.kind==='ok'?'pha-flash-ok':'ph-card-err'));
  c.setAttribute('role',f.kind==='ok'?'status':'alert');
  c.appendChild(phEl('p','pha-flash-t',f.text));
  if(f.stale){
    c.appendChild(phEl('p','ph-note','Someone else saved first. Reload to see their version, then make your change again - nothing of yours was saved.'));
    c.appendChild(_phaBtn('ph-btn-primary','Reload the data',function(){
      _phaFlash={tab:tab,kind:'ok',text:'Reloaded. These are the current values - make your change again if it is still needed.'};
      _phaS.edit=null;_phaS.form=null;_phaT.form=null;_phaT.sig=null;_phaM.edit=null;
      ctx.reload();
    }));
  }
  return c;
}
// Run one write. fn returns a writer result {ok,...}; okText(result) is the message on success.
function _phaAct(ctx,tab,fn,okText,btn){
  if(_phaBusy)return Promise.resolve(null);
  _phaBusy=true;_phaFlash=null;
  if(btn){try{btn.setAttribute('disabled','');btn.textContent='Saving...';}catch(e){}}
  return Promise.resolve().then(fn).catch(function(e){return{ok:false,code:'failed',error:'Could not save ('+String(e&&e.message||e)+').'};}).then(function(r){
    _phaBusy=false;
    if(!r||typeof r!=='object')r={ok:false,code:'failed',error:'No answer from the save.'};
    _phaFlash={tab:tab,kind:r.ok?'ok':'bad',text:r.ok?String(okText?okText(r):'Saved.'):String(r.error||'Could not save.'),stale:r.code==='stale'};
    try{ctx.repaint();}catch(e){}
    return r;
  });
}
function _phaFailCard(ctx,stage,title){
  const g=ctx.get(stage);
  const c=phEl('section','ph-card ph-card-err');c.setAttribute('role','alert');
  c.appendChild(phEl('h3','ph-card-title',title));
  c.appendChild(phEl('p','ph-note',(g&&g.text)||'This collection was not read.'));
  c.appendChild(phEl('p','ph-note','Nothing is listed or counted for it: a failed read is not an empty list.'));
  c.appendChild(_phaBtn('ph-btn-primary','Retry',function(){ctx.reload();}));
  return c;
}
function _phaGuard(host,ctx,title){
  if(ctx.canManage&&typeof phCanManage==='function'&&phCanManage(ctx.user))return true;
  host.appendChild(_phaHead(title,'',ctx));
  const c=phEl('section','ph-card ph-card-err');c.setAttribute('role','alert');
  c.appendChild(phEl('h3','ph-card-title','Managers only'));
  c.appendChild(phEl('p','ph-note','This tab is for Afnan, Ammar and Mustafa.'));
  host.appendChild(c);
  return false;
}

/* ═══ 1. MASTERS ═══════════════════════════════════════════════════════════ */

// The cut jobs the log is built from: one per PO that has a recorded cut (cutAt + cut quantities). The master
// is the PO's cut job (po_cut_jobs.masterName), else the fabric issue (gate pass) cutMaster for that PO,
// resolved to the registry's current spelling (an old name via its aliases). Pure.
function phaCutJobs(pos,passes,jobRows,masters){
  const byKey=Object.create(null);
  const reg=Array.isArray(masters)?masters:[];
  reg.forEach(function(m){if(m&&m.name){const nm=phNorm(m.name);if(nm)byKey[phMasterKey(nm)]=nm;}});
  reg.forEach(function(m){if(m&&m.name&&Array.isArray(m.aliases)){const nm=phNorm(m.name);m.aliases.forEach(function(a){const k=phMasterKey(a);if(k&&!byKey[k])byKey[k]=nm;});}});
  const jobMaster=Object.create(null);
  (Array.isArray(jobRows)?jobRows:[]).forEach(function(j){
    const n=phNorm(j&&j.masterName),id=String(j&&(j.fbKey||j.poId)||'').trim().toUpperCase();
    if(n&&id)jobMaster[id]=n;
  });
  const passMaster=Object.create(null),passTs=Object.create(null);
  (Array.isArray(passes)?passes:[]).forEach(function(g){
    if(!g||g.gpType!=='fabric')return;
    const id=String(g.poId||'').trim().toUpperCase(),n=phNorm(g.cutMaster),ts=Number(g.ts)||0;
    if(!id||!n)return;
    if(passMaster[id]===undefined||ts>=passTs[id]){passMaster[id]=n;passTs[id]=ts;}
  });
  const out=[];
  (Array.isArray(pos)?pos:[]).forEach(function(po){
    if(!po||typeof po!=='object')return;
    const id=String(po.fbKey||po.id||'').trim();
    if(!id||phMs(po.cutAt)===null)return;
    const units=po.cutQty!=null?po.cutQty:po.cutBySize;
    if(units==null)return;
    const raw=jobMaster[id.toUpperCase()]||passMaster[id.toUpperCase()]||'';
    out.push({id:id,poId:id,master:raw?(byKey[phMasterKey(raw)]||raw):'',cutAt:po.cutAt,cutUnits:units,
      articleCode:po.code!=null?po.code:po.articleCode,sizeModel:po.sizeModel,sizeAxis:po.sizeAxis,poStatus:po.poStatus});
  });
  return out;
}
// Names on fabric issues that are not in the registry (read-only suggestions), newest spelling, most-used first.
// null when the registry was not read (cannot tell what is missing). The two long-standing names are the seed button's.
function phaMasterSuggestions(passes,masters){
  if(!Array.isArray(masters))return null;
  const known=new Set();
  masters.forEach(function(m){
    if(!m)return;
    if(m.name)known.add(phMasterKey(m.name));
    if(m.nameKey)known.add(String(m.nameKey));
    if(Array.isArray(m.aliases))m.aliases.forEach(function(a){known.add(String(a));});
  });
  PHA_DEFAULT_MASTER_NAMES.forEach(function(n){known.add(phMasterKey(n));});
  const seen=new Map();
  (Array.isArray(passes)?passes:[]).forEach(function(g){
    if(!g||g.gpType!=='fabric')return;
    const n=phNorm(g.cutMaster),k=phMasterKey(n);
    if(!n||known.has(k))return;
    const ts=Number(g.ts)||0,e=seen.get(k);
    if(!e)seen.set(k,{key:k,name:n,n:1,ts:ts});
    else{e.n++;if(ts>=e.ts){e.ts=ts;e.name=n;}}
  });
  return Array.from(seen.values()).sort(function(a,b){return(b.n-a.n)||(a.key<b.key?-1:a.key>b.key?1:0);});
}
function _phaMonthRange(m){
  if(typeof m!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))return null;
  const y=Number(m.slice(0,4)),mo=Number(m.slice(5,7)),dim=new Date(Date.UTC(y,mo,0)).getUTCDate();
  return{from:m+'-01',to:m+'-'+(dim<10?'0'+dim:String(dim)),label:PHA_MONTHS[mo-1]+' '+y};
}
function _phaMonthStep(m,d){
  const r=_phaMonthRange(m);if(!r)return m;
  const t=Number(m.slice(0,4))*12+(Number(m.slice(5,7))-1)+d,y=Math.floor(t/12),mo=t-y*12+1;
  return String(y)+'-'+(mo<10?'0'+mo:String(mo));
}
function _phaWeekRange(day){
  if(!phIsDay(day))return null;
  const ws=phWeekStart(day);
  return{from:ws,to:phDayAdd(ws,6),label:'week of '+_phaDayLabel(ws)};
}
// The log, as data. st: {mode:'month'|'week', month, week, master}; env: {pos, passes, jobRows, masters, standards, settings}.
// state: unloaded (no PO list on this device) | badrange | nodata (no PO has a recorded cut at all) | noperiod | ok. Never a zero for "no data".
function phaMasterLogModel(st,env){
  const out={state:'unloaded',range:null,jobsTotal:0,summary:null,log:null,names:[]};
  if(!env||!Array.isArray(env.pos))return out;
  const rg=st.mode==='week'?_phaWeekRange(st.week):_phaMonthRange(st.month);
  if(!rg){out.state='badrange';return out;}
  out.range=rg;
  const jobs=phaCutJobs(env.pos,env.passes,env.jobRows,env.masters);
  out.jobsTotal=jobs.filter(function(j){return j.poStatus!=='cancelled';}).length;   // a cancelled PO's cut is not a cut (the core drops it too)
  if(!out.jobsTotal){out.state='nodata';return out;}
  const stdMap={};
  (Array.isArray(env.standards)?env.standards:[]).forEach(function(r){if(r&&r.fbKey)stdMap[r.fbKey]=r;});
  const opts={standards:stdMap,settings:env.settings||{},pos:env.pos};
  if(Array.isArray(env.masters))opts.masters=env.masters;
  const range={from:rg.from,to:rg.to};
  out.summary=phMastersSummary(jobs,range,opts);
  out.log=phMasterLog(jobs,st.master||'',range,opts);
  const names=new Map();
  (Array.isArray(env.masters)?env.masters:[]).forEach(function(m){if(m&&m.name)names.set(phMasterKey(m.name),phNorm(m.name));});
  jobs.forEach(function(j){if(j.master&&!names.has(phMasterKey(j.master)))names.set(phMasterKey(j.master),phNorm(j.master));});
  out.names=Array.from(names.entries()).map(function(e){return{key:e[0],name:e[1]};}).sort(function(a,b){return a.name<b.name?-1:a.name>b.name?1:0;});
  out.state=(out.summary&&out.summary.rows&&out.summary.rows.length)?'ok':'noperiod';
  return out;
}
function _phaEnv(ctx){
  const gm=ctx.get('masters'),gs=ctx.get('standards'),gj=ctx.get('jobs');
  return{
    pos:typeof allPOs!=='undefined'&&Array.isArray(allPOs)?allPOs:null,
    passes:typeof allPasses!=='undefined'&&Array.isArray(allPasses)?allPasses:[],
    jobRows:gj.ok?gj.rows:[],
    masters:gm.ok?gm.rows:null,
    standards:gs.ok?gs.rows:null,
    settings:typeof phSettingsNow==='function'?phSettingsNow():{}
  };
}

function _phaMasterRow(r,ctx){
  const active=r.active!==false;
  const row=phEl('li','ph-line pha-mrow');
  row.setAttribute('data-master',r.fbKey);
  const top=phEl('div','pha-mtop');
  top.appendChild(phEl('span','ph-line-name pha-mname',r.name));
  top.appendChild(phEl('code','ph-code',r.fbKey));
  const kind=PHA_KINDS.filter(function(k){return k.v===r.kind;})[0];
  if(kind&&kind.v!=='unset')top.appendChild(_phaChip(kind.t));
  top.appendChild(active?_phaChip('Active','ph-chip-ok'):_phaChip('Retired','ph-chip-bad'));
  row.appendChild(top);
  if(!active){
    const why=(r.retiredReason||'')+(r.retiredAt?' ('+_phaStampLabel(r.retiredAt)+')':'');
    if(why.trim())row.appendChild(phEl('div','pha-sub','Retired: '+why));
  }
  const acts=phEl('div','pha-acts');
  acts.appendChild(_phaBtn('','Rename',function(){_phaM.edit={id:r.fbKey,kind:'rename',text:r.name};ctx.repaint();},{'data-act':'rename','aria-label':'Rename '+r.name}));
  acts.appendChild(_phaBtn('','Change kind',function(){_phaM.edit={id:r.fbKey,kind:'kind',text:PHA_KINDS.some(function(k){return k.v===r.kind;})?r.kind:'unset'};ctx.repaint();},{'data-act':'kind','aria-label':'Change the kind of '+r.name}));
  if(active)acts.appendChild(_phaBtn('','Retire',function(){_phaM.edit={id:r.fbKey,kind:'retire',text:''};ctx.repaint();},{'data-act':'retire','aria-label':'Retire '+r.name}));
  else acts.appendChild(_phaBtn('','Reactivate',function(e,b){
    _phaAct(ctx,'masters',function(){return phMasterSetActive(r.fbKey,true,'');},function(){return r.name+' is active again.';},b);
  },{'data-act':'reactivate','aria-label':'Reactivate '+r.name}));
  row.appendChild(acts);
  const ed=_phaM.edit;
  if(ed&&ed.id===r.fbKey){
    const box=phEl('div','pha-edit');
    const bar=phEl('div','pha-acts');
    if(ed.kind==='kind'){
      const ksel=_phaSelect(PHA_KINDS,ed.text,'kind',{'aria-label':'Kind of '+r.name});
      _phaBind(ksel,ed,'text');
      box.appendChild(_phaField('Kind',ksel,'In-house, outsourced, or not set. This only labels the master; nothing else changes.'));
      bar.appendChild(_phaBtn('ph-btn-primary','Save kind',function(e,b){
        const k=String(ed.text||'');
        _phaAct(ctx,'masters',function(){return phMasterSetKind(r.fbKey,k);},
          function(){_phaM.edit=null;return r.name+' is now '+((PHA_KINDS.filter(function(x){return x.v===k;})[0]||{}).t||k)+'.';},b);
      },{'data-act':'save-edit'}));
    }else{
    const inp=_phaInput('text',ed.text,ed.kind==='rename'?'rename':'reason',{maxlength:ed.kind==='rename'?'40':'300','aria-label':ed.kind==='rename'?'New name':'Reason for retiring'});
    _phaBind(inp,ed,'text');
    box.appendChild(_phaField(ed.kind==='rename'?'New name':'Reason for retiring (required)',inp,ed.kind==='rename'?'The old name stays as an alias, so gate passes that carry it still match this master.':'A retired master stays on every past record. It is never deleted.'));
    bar.appendChild(_phaBtn('ph-btn-primary',ed.kind==='rename'?'Save name':'Retire master',function(e,b){
      const text=String(ed.text||'');
      if(ed.kind==='retire'&&!text.trim()){_phaFlash={tab:'masters',kind:'bad',text:'A reason is required to retire a master.'};ctx.repaint();return;}
      if(ed.kind==='rename'&&!phNorm(text)){_phaFlash={tab:'masters',kind:'bad',text:'A master needs a name.'};ctx.repaint();return;}
      _phaAct(ctx,'masters',function(){return ed.kind==='rename'?phMasterRename(r.fbKey,text):phMasterSetActive(r.fbKey,false,text);},
        function(){_phaM.edit=null;return ed.kind==='rename'?'Renamed to '+phNorm(text)+'.':r.name+' is retired.';},b);
    },{'data-act':'save-edit'}));
    }
    bar.appendChild(_phaBtn('','Cancel',function(){_phaM.edit=null;ctx.repaint();},{'data-act':'cancel-edit'}));
    box.appendChild(bar);
    row.appendChild(box);
  }
  return row;
}

function _phaRegistryCard(ctx){
  const g=ctx.get('masters');
  if(!g.ok)return _phaFailCard(ctx,'masters','Cutting masters could not be read');
  const rows=g.rows.slice().sort(function(a,b){return a.fbKey<b.fbKey?-1:a.fbKey>b.fbKey?1:0;});
  const kids=[];
  // seed: only when the owner presses it
  const known=new Set();
  rows.forEach(function(m){known.add(phMasterKey(m.name||''));if(m.nameKey)known.add(String(m.nameKey));(Array.isArray(m.aliases)?m.aliases:[]).forEach(function(a){known.add(String(a));});});
  const missing=PHA_DEFAULT_MASTER_NAMES.filter(function(n){return!known.has(phMasterKey(n));});
  if(missing.length){
    const box=phEl('div','pha-seed');
    box.appendChild(phEl('p','ph-note','Hassan and Alam are already named on gate passes (the cutting master list on a fabric issue) but '+(missing.length===PHA_DEFAULT_MASTER_NAMES.length?'neither is':missing.join(' and ')+(missing.length===1?' is':' are'))+' in this register. Nothing is added until you press the button.'));
    box.appendChild(_phaBtn('ph-btn-primary','Add '+missing.join(' / '),function(e,b){
      _phaAct(ctx,'masters',async function(){
        let last=null;
        for(let i=0;i<missing.length;i++){
          last=await phMasterAdd(missing[i],{kind:'unset'});
          if(!last.ok)return last;
        }
        return last;
      },function(){return'Added '+missing.join(' and ')+' to the register.';},b);
    },{'data-act':'seed'}));
    kids.push(box);
  }
  // suggestions from names on fabric issues (read-only data)
  const sug=phaMasterSuggestions(typeof allPasses!=='undefined'&&Array.isArray(allPasses)?allPasses:[],rows);
  if(sug&&sug.length){
    const box=phEl('div','pha-sug');
    box.appendChild(phEl('h4','pha-sub-title','Names found on fabric issues, not in the register'));
    const ul=phEl('ul','ph-lines');
    sug.forEach(function(s){
      const li=phEl('li','ph-line');
      li.setAttribute('data-suggest',s.key);
      li.appendChild(phEl('span','ph-line-name',s.name));
      li.appendChild(phEl('span','ph-line-txt','on '+s.n+(s.n===1?' fabric issue':' fabric issues')));
      li.appendChild(_phaBtn('','Add to register',function(e,b){
        _phaAct(ctx,'masters',function(){return phMasterAdd(s.name,{kind:'unset'});},function(r){return s.name+' added ('+r.id+').';},b);
      },{'data-act':'suggest','aria-label':'Add '+s.name+' to the register'}));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    kids.push(box);
  }
  // add
  const add=phEl('div','pha-add');
  const nameIn=_phaInput('text',_phaM.newName,'newname',{maxlength:'40',placeholder:'Master name','aria-label':'New master name'});
  _phaBind(nameIn,_phaM,'newName');
  const kindSel=_phaSelect(PHA_KINDS,_phaM.newKind,'newkind',{'aria-label':'Kind'});
  _phaBind(kindSel,_phaM,'newKind');
  add.appendChild(_phaField('Add a cutting master',nameIn));
  add.appendChild(_phaField('Kind',kindSel));
  add.appendChild(_phaBtn('ph-btn-primary','Add master',function(e,b){
    const name=phNorm(_phaM.newName);
    if(!name){_phaFlash={tab:'masters',kind:'bad',text:'A master needs a name.'};ctx.repaint();return;}
    _phaAct(ctx,'masters',function(){return phMasterAdd(name,{kind:_phaM.newKind});},function(r){_phaM.newName='';return name+' added ('+r.id+').';},b);
  },{'data-act':'add'}));
  kids.push(add);
  // the list
  const shown=rows.filter(function(r){return _phaM.showRetired||r.active!==false;});
  const retiredN=rows.filter(function(r){return r.active===false;}).length;
  if(retiredN||_phaM.showRetired){
    const cb=_phaCheck(_phaM.showRetired,'showretired','Show retired ('+retiredN+')');
    cb.firstChild.addEventListener('change',function(){_phaM.showRetired=!!cb.firstChild.checked;ctx.repaint();});
    kids.push(cb);
  }
  if(!rows.length){kids.push(phEl('p','ph-note','The register is empty: read, and nothing is in it yet.'));}
  else{
    const ul=phEl('ul','ph-lines pha-mlist');
    shown.forEach(function(r){ul.appendChild(_phaMasterRow(r,ctx));});
    kids.push(ul);
    if(g.truncated)kids.push(phEl('p','ph-note','The list is cut at its read limit.'));
  }
  return _phaCard('Register ('+rows.filter(function(r){return r.active!==false;}).length+' active)',kids);
}

/* the daily and weekly log */
function _phaLogControls(ctx,model,env){
  const c=phEl('div','pha-ctl');
  const opts=[{v:'',t:'All masters'}].concat(model.names.map(function(n){return{v:n.key,t:n.name};}));
  const sel=_phaSelect(opts,_phaM.master,'logmaster',{'aria-label':'Master'});
  sel.addEventListener('change',function(){_phaM.master=sel.value;_phaPaintLog(ctx);});
  c.appendChild(_phaField('Master',sel));
  const mode=_phaSelect([{v:'month',t:'Month'},{v:'week',t:'Week'}],_phaM.mode,'logmode',{'aria-label':'Period'});
  mode.addEventListener('change',function(){_phaM.mode=mode.value==='week'?'week':'month';_phaPaintLog(ctx);});
  c.appendChild(_phaField('Period',mode));
  const when=phEl('div','pha-when');
  if(_phaM.mode==='week'){
    const ws=phIsDay(_phaM.week)?phWeekStart(_phaM.week):phWeekStart(_phaToday());
    when.appendChild(_phaBtn('','Previous week',function(){_phaM.week=phDayAdd(ws,-7);_phaPaintLog(ctx);},{'data-act':'prev','aria-label':'Previous week'}));
    const di=_phaInput('date',ws,'logweek',{'aria-label':'Any day in the week'});
    di.addEventListener('change',function(){if(phIsDay(di.value)){_phaM.week=di.value;_phaPaintLog(ctx);}});
    when.appendChild(_phaField('A day in the week (weeks start Monday)',di));
    when.appendChild(_phaBtn('','Next week',function(){_phaM.week=phDayAdd(ws,7);_phaPaintLog(ctx);},{'data-act':'next','aria-label':'Next week'}));
  }else{
    const m=_phaMonthRange(_phaM.month)?_phaM.month:_phaToday().slice(0,7);
    when.appendChild(_phaBtn('','Previous month',function(){_phaM.month=_phaMonthStep(m,-1);_phaPaintLog(ctx);},{'data-act':'prev','aria-label':'Previous month'}));
    const mi=_phaInput('month',m,'logmonth',{'aria-label':'Month',placeholder:'YYYY-MM'});
    mi.addEventListener('change',function(){if(_phaMonthRange(mi.value)){_phaM.month=mi.value;_phaPaintLog(ctx);}});
    when.appendChild(_phaField('Month',mi));
    when.appendChild(_phaBtn('','Next month',function(){_phaM.month=_phaMonthStep(m,1);_phaPaintLog(ctx);},{'data-act':'next','aria-label':'Next month'}));
  }
  c.appendChild(when);
  return c;
}
function _phaTable(heads,rows,cls){
  const t=phEl('table','pha-table'+(cls?' '+cls:''));
  const thead=phEl('thead'),hr=phEl('tr');
  heads.forEach(function(h,i){const th=phEl('th',i>0?'pha-num':null,h);th.setAttribute('scope','col');hr.appendChild(th);});
  thead.appendChild(hr);t.appendChild(thead);
  const tb=phEl('tbody');
  rows.forEach(function(r){
    const tr=phEl('tr',r.cls||null);
    r.cells.forEach(function(c,i){
      const td=phEl(i===0?'th':'td',i>0?'pha-num':null);
      if(i===0)td.setAttribute('scope','row');
      if(c&&typeof c==='object'&&c.nodeType)td.appendChild(c);else td.textContent=String(c);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}
function _phaLogBody(ctx){
  const env=_phaEnv(ctx);
  return{model:phaMasterLogModel(_phaM,env),env:env};
}
function _phaPaintLog(ctx){
  const host=_phaLogHost;if(!host)return;
  phClear(host);
  const b=_phaLogBody(ctx),model=b.model,env=b.env;
  host.appendChild(phEl('h3','ph-card-title','Cutting log'));
  host.appendChild(phEl('p','ph-note','Units cut per day and per week, from the purchase orders that have a recorded cut (cut date and cut quantities). The master is the one on the PO\'s cut job, else on its fabric issue. Days and weeks with no cut are left out, not shown as zero.'));
  if(model.state==='unloaded'){
    host.appendChild(phEl('p','pha-empty','No data yet: the purchase order list is not loaded on this device, so nothing can be counted. Open the Dashboard once, then come back.'));
    return;
  }
  if(!Array.isArray(env.masters))host.appendChild(phEl('p','ph-note','The register did not load, so names are shown as written on the PO or fabric issue and not matched to it.'));
  if(model.state==='nodata'){
    host.appendChild(phEl('p','pha-empty','No data yet: none of the '+_phaNum(env.pos.length)+' purchase orders on this device has a recorded cut. The log fills in as cutting is marked done.'));
    return;
  }
  host.appendChild(_phaLogControls(ctx,model,env));
  if(model.state==='badrange'){host.appendChild(phEl('p','pha-empty','Choose a valid period.'));return;}
  host.appendChild(phEl('p','pha-period',model.range.label+' ('+model.range.from+' to '+model.range.to+')'));
  if(model.state==='noperiod'){
    host.appendChild(phEl('p','pha-empty','No cut recorded in this period (there are '+_phaNum(model.jobsTotal)+' cuts on other dates).'));
    return;
  }
  const sum=model.summary;
  host.appendChild(phEl('h4','pha-sub-title','By master'));
  host.appendChild(_phaTable(['Master','POs','Units cut'],sum.rows.map(function(r){
    const nm=phEl('span','pha-cellname',null,[phEl('span',null,r.name)]);
    if(r.registered===false&&r.masterKey!=='')nm.appendChild(_phaChip('Not in register'));
    return{cells:[nm,_phaNum(r.jobs),_phaNum(r.units)]};
  })));
  const lg=model.log;
  const who=_phaM.master?(model.names.filter(function(n){return n.key===_phaM.master;})[0]||{name:_phaM.master}).name:'All masters';
  if(!lg||lg.state!=='ok'){
    host.appendChild(phEl('p','pha-empty','No cut recorded for '+who+' in this period.'));
    return;
  }
  host.appendChild(phEl('h4','pha-sub-title','Daily - '+who));
  host.appendChild(_phaTable(['Day','POs','Units cut'],lg.daily.map(function(d){return{cells:[_phaDayLabel(d.day),_phaNum(d.jobs),_phaNum(d.units)]};}).concat([{cls:'pha-total',cells:['Total',_phaNum(lg.totals.jobs),_phaNum(lg.totals.units)]}])));
  host.appendChild(phEl('h4','pha-sub-title','Weekly - '+who));
  host.appendChild(_phaTable(['Week (Monday to Sunday)','POs','Units cut'],lg.weekly.map(function(w){
    const lab=phEl('span','pha-cellname',null,[phEl('span',null,_phaDayLabel(w.weekStart)+' to '+_phaDayLabel(w.weekEnd))]);
    if(w.partial)lab.appendChild(_phaChip('Part of the week'));
    return{cells:[lab,_phaNum(w.jobs),_phaNum(w.units)]};
  })));
  if(lg.duplicateJobs)host.appendChild(phEl('p','ph-note',_phaNum(lg.duplicateJobs)+' repeated job id(s) were counted once.'));
}

function _phaRenderMasters(host,ctx){
  if(!_phaGuard(host,ctx,'Masters'))return;
  if(!_phaMonthRange(_phaM.month))_phaM.month=_phaToday().slice(0,7);
  if(!phIsDay(_phaM.week))_phaM.week=_phaToday();
  host.appendChild(_phaHead('Masters','The cutting masters register: add, rename and retire. A master is never deleted.',ctx));
  const fl=_phaFlashNode('masters',ctx);if(fl)host.appendChild(fl);
  host.appendChild(_phaRegistryCard(ctx));
  const logCard=_phaCard('',[],'pha-logcard');
  host.appendChild(logCard);
  _phaLogHost=logCard;
  _phaPaintLog(ctx);
}

/* ═══ 2. STANDARDS ═════════════════════════════════════════════════════════ */

// The article registry, as other modules use it (js/patterns.js: tacArticles). Never throws.
function _phaArtState(){
  if(typeof tacArticles==='undefined'||typeof patternsLoaded==='undefined')return{state:'missing',list:null};
  if(typeof _ptnLoadFailed==='function'&&_ptnLoadFailed('articles'))return{state:'failed',list:null};
  if(!patternsLoaded)return{state:'loading',list:null};
  if(!Array.isArray(tacArticles)||!tacArticles.length)return{state:'empty',list:[]};
  return{state:'ok',list:tacArticles.slice()};
}
function _phaArtEnsure(ctx){
  if(_phaArtLoading||typeof loadPatternsData!=='function'||typeof patternsLoaded==='undefined'||patternsLoaded)return;
  _phaArtLoading=true;
  Promise.resolve().then(function(){return loadPatternsData();}).catch(function(){}).then(function(){_phaArtLoading=false;try{ctx.repaint();}catch(e){}});
}
// active GROOVY article (the brand this module cuts); an article with no brand field counts as GROOVY
function _phaIsActiveGroovy(a){return a&&a.active!==false&&(a.brand===undefined||a.brand===null||a.brand==='groovy');}
function _phaCodeOrder(a,b){return String(a.code).localeCompare(String(b.code),'en',{numeric:true});}

// Rows of the list: every active article (with or without a standard) + standards whose code is no article.
// null rows when the standards were not read. coverage null when the article registry is not usable.
function phaStandardsView(artState,stdRows,q,filter){
  const out={rows:null,coverage:null,orphans:0};
  if(!Array.isArray(stdRows))return out;
  const stdBy=Object.create(null);stdRows.forEach(function(s){stdBy[s.fbKey]=s;});
  const list=[];const inReg=new Set();
  const arts=artState&&Array.isArray(artState.list)?artState.list:null;
  if(arts){
    arts.forEach(function(a){
      const code=String(a.code||'').toUpperCase();if(!code)return;
      inReg.add(code);
      list.push({code:code,name:String(a.name||''),std:stdBy[code]||null,orphan:false,active:_phaIsActiveGroovy(a)});
    });
  }
  stdRows.forEach(function(s){if(!inReg.has(s.fbKey))list.push({code:s.fbKey,name:'',std:s,orphan:!!arts,active:false});});
  if(arts){
    const act=list.filter(function(r){return r.active;});
    out.coverage={total:act.length,with:act.filter(function(r){return r.std;}).length};
    out.orphans=list.filter(function(r){return r.orphan;}).length;
  }
  const needle=String(q||'').trim().toLowerCase();
  out.rows=list.filter(function(r){
    if(filter==='with'&&!r.std)return false;
    if(filter==='without'&&r.std)return false;
    if(arts&&!r.std&&!r.active)return false;       // a retired article without a standard is not offered
    if(needle&&r.code.toLowerCase().indexOf(needle)<0&&r.name.toLowerCase().indexOf(needle)<0)return false;
    return true;
  }).sort(function(a,b){return _phaCodeOrder(a,b);});
  return out;
}
function _phaGuessModel(code){return phSizeModel({code:code});}   // {model,keys,source:'prefix'|'default'}
function _phaStdBlank(code,name,std){
  const guess=_phaGuessModel(code);
  const model=std&&std.sizeModel&&Object.prototype.hasOwnProperty.call(PH_SIZE_MODELS,std.sizeModel)?std.sizeModel:guess.model;
  const sizes={};
  if(std&&std.sizes&&typeof std.sizes==='object')Object.keys(std.sizes).forEach(function(k){sizes[k]=String(std.sizes[k]);});
  return{code:code,name:name||'',existing:!!std,rev:std&&typeof std.rev==='number'?std.rev:0,
    unit:std?std.unit:'',gross:std?String(std.grossPerPiece):'',tol:std&&std.tolerancePct!=null?String(std.tolerancePct):'',
    model:model,guess:guess.model,guessSource:guess.source,sizes:sizes,reason:''};
}
// Form -> the writer's input, or {error}. Pure. The reason is REQUIRED on every save.
function phaStandardInput(form){
  const f=form||{};
  const unit=phUnit(f.unit);
  if(unit===null)return{error:'Choose the unit, kg or m.'};
  const g=phNum(f.gross);
  if(g===null||g<=0)return{error:'Gross per piece must be a number above zero.'};
  let tol=null;
  if(String(f.tol==null?'':f.tol).trim()!==''){
    tol=phNum(f.tol);
    if(tol===null||tol<0||tol>100)return{error:'Tolerance must be a percent from 0 to 100, or left blank.'};
  }
  const model=String(f.model||'');
  if(!Object.prototype.hasOwnProperty.call(PH_SIZE_MODELS,model))return{error:'Choose the size model: alpha, waist or free size.'};
  const sizes={};let any=false;
  const raw=f.sizes&&typeof f.sizes==='object'?f.sizes:{};
  for(let i=0;i<PH_SIZE_MODELS[model].keys.length;i++){
    const k=PH_SIZE_MODELS[model].keys[i],v=String(raw[k]==null?'':raw[k]).trim();
    if(v==='')continue;
    const n=phNum(v);
    if(n===null||n<=0)return{error:'Size '+k+': the gross must be a number above zero, or left blank.'};
    sizes[k]=n;any=true;
  }
  const reason=String(f.reason==null?'':f.reason).trim();
  if(!reason)return{error:'A reason is required: say why this standard is being set or changed.'};
  return{input:{unit:unit,grossPerPiece:g,tolerancePct:tol,sizes:any?sizes:null,sizeModel:model,reason:reason.slice(0,300)}};
}
function _phaStdLine(r,ctx){
  const li=phEl('li','ph-line pha-srow');li.setAttribute('data-code',r.code);
  const top=phEl('div','pha-mtop');
  top.appendChild(phEl('code','ph-code',r.code));
  top.appendChild(phEl('span','ph-line-name pha-mname',r.name||(r.orphan?'(not in the article registry)':'')));
  li.appendChild(top);
  const mid=phEl('div','pha-sub');
  if(r.std){
    mid.appendChild(_phaChip('Revision '+(typeof r.std.rev==='number'?r.std.rev:'?'),'ph-chip-ok'));
    mid.appendChild(phEl('span','pha-stdtxt',_phaGross(r.std.grossPerPiece)+' '+r.std.unit+' per piece'+(r.std.tolerancePct!=null?', tolerance '+r.std.tolerancePct+'%':'')+(r.std.sizeModel?', '+PH_SIZE_MODELS[r.std.sizeModel].label.toLowerCase()+' sizes':'')));
  }else mid.appendChild(_phaChip('No standard'));
  if(r.orphan)mid.appendChild(_phaChip('Not an article code','ph-chip-bad'));
  li.appendChild(mid);
  const acts=phEl('div','pha-acts');
  acts.appendChild(_phaBtn('',r.std?'Edit':'Set standard',function(){
    _phaS.edit=r.code;_phaS.form=_phaStdBlank(r.code,r.name,r.std);ctx.repaint();
  },{'data-act':'edit','aria-label':(r.std?'Edit the standard of ':'Set the standard of ')+r.code}));
  li.appendChild(acts);
  return li;
}
function _phaStdPaintList(ctx){
  const host=_phaStdListHost;if(!host)return;
  phClear(host);
  const g=ctx.get('standards');
  if(!g.ok){return;}
  const art=_phaArtState();
  const v=phaStandardsView(art,g.rows,_phaS.q,_phaS.filter);
  const shown=v.rows.slice(0,_phaS.limit);
  if(!v.rows.length){
    host.appendChild(phEl('p','pha-empty',(_phaS.q||_phaS.filter!=='all')?'No article matches this search.':(g.rows.length?'Nothing to list.':'No standard has been saved yet and no article is available to set one for.')));
    return;
  }
  const ul=phEl('ul','ph-lines pha-slist');
  shown.forEach(function(r){ul.appendChild(_phaStdLine(r,ctx));});
  host.appendChild(ul);
  host.appendChild(phEl('p','ph-note','Showing '+shown.length+' of '+v.rows.length+'.'));
  if(v.rows.length>shown.length)host.appendChild(_phaBtn('','Show '+Math.min(PHA_ROWS_SHOWN,v.rows.length-shown.length)+' more',function(){_phaS.limit+=PHA_ROWS_SHOWN;_phaStdPaintList(ctx);},{'data-act':'more'}));
}
function _phaStdPaintEditor(ctx){
  const host=_phaStdEditHost;if(!host)return;
  phClear(host);
  const f=_phaS.form;if(!f)return;
  const card=_phaCard((f.existing?'Edit the standard of ':'Set the standard of ')+f.code+(f.name?' - '+f.name:''),[],'pha-editor');
  if(f.existing)card.appendChild(phEl('p','ph-note','Currently revision '+f.rev+'. Saving makes revision '+(f.rev+1)+'. Only the current standard is kept; there is no version history yet.'));
  const grid=phEl('div','pha-grid');
  const unit=_phaSelect([{v:'',t:'Choose...'},{v:'kg',t:'kg (weight)'},{v:'m',t:'m (length)'}],f.unit,'unit',{'aria-label':'Unit'});
  _phaBind(unit,f,'unit');
  grid.appendChild(_phaField('Unit',unit,'kg and m are never mixed.'));
  const gross=_phaInput('text',f.gross,'gross',{inputmode:'decimal','aria-label':'Gross per piece'});
  _phaBind(gross,f,'gross');
  grid.appendChild(_phaField('Gross per piece',gross,'Fabric used for one finished piece.'));
  const tol=_phaInput('text',f.tol,'tol',{inputmode:'decimal','aria-label':'Tolerance percent'});
  _phaBind(tol,f,'tol');
  grid.appendChild(_phaField('Tolerance % (optional)',tol,'Blank uses the settings\' over and under defaults.'));
  const model=_phaSelect(Object.keys(PH_SIZE_MODELS).map(function(k){return{v:k,t:PH_SIZE_MODELS[k].label};}),f.model,'model',{'aria-label':'Size model'});
  model.addEventListener('change',function(){f.model=model.value;_phaStdPaintEditor(ctx);});
  grid.appendChild(_phaField('Size model',model,'Guessed from the code prefix: '+PH_SIZE_MODELS[f.guess].label+(f.guessSource==='prefix'?' (prefix match)':' (no prefix rule - the default)')+(f.model!==f.guess?'. You have overridden it.':'.')));
  card.appendChild(grid);
  // per-size values for the chosen model
  const keys=PH_SIZE_MODELS[f.model].keys;
  const sz=phEl('div','pha-sizes');
  sz.appendChild(phEl('h4','pha-sub-title','Per-size gross (optional)'));
  sz.appendChild(phEl('p','ph-note','A size left blank uses the gross per piece above.'));
  if(f.model==='free')sz.appendChild(phEl('p','ph-note','A free-size article has one size: the gross per piece is its gross. Leave this blank unless you want it recorded under FREE.'));
  const sg=phEl('div','pha-sizegrid');
  keys.forEach(function(k){
    const i=_phaInput('text',f.sizes[k]==null?'':f.sizes[k],'size-'+k,{inputmode:'decimal','aria-label':'Gross for size '+k});
    i.addEventListener('input',function(){f.sizes[k]=i.value;});i.addEventListener('change',function(){f.sizes[k]=i.value;});
    sg.appendChild(_phaField(k,i,null,'pha-sizefield'));
  });
  sz.appendChild(sg);
  const stray=Object.keys(f.sizes).filter(function(k){return keys.indexOf(k)<0&&String(f.sizes[k]).trim()!=='';});
  if(stray.length)sz.appendChild(phEl('p','ph-note pha-warn','These saved sizes do not belong to the '+PH_SIZE_MODELS[f.model].label.toLowerCase()+' model and will be dropped on save: '+stray.join(', ')+'.'));
  card.appendChild(sz);
  const reason=_phaInput('text',f.reason,'reason',{maxlength:'300','aria-label':'Reason for this standard'});
  _phaBind(reason,f,'reason');
  card.appendChild(_phaField('Reason (required)',reason,'For example: first sample cut, or re-weighed on 12 Oct.'));
  const bar=phEl('div','pha-acts');
  bar.appendChild(_phaBtn('ph-btn-primary',f.existing?'Save revision '+(f.rev+1):'Save standard',function(e,b){
    const built=phaStandardInput(f);
    if(built.error){_phaFlash={tab:'standards',kind:'bad',text:built.error};ctx.repaint();return;}
    _phaAct(ctx,'standards',function(){return phStandardSave(f.code,built.input,{expectedRev:f.rev});},
      function(r){_phaS.edit=null;_phaS.form=null;return'Saved the standard of '+f.code+' (revision '+r.rev+').';},b);
  },{'data-act':'save'}));
  bar.appendChild(_phaBtn('','Cancel',function(){_phaS.edit=null;_phaS.form=null;ctx.repaint();},{'data-act':'cancel'}));
  card.appendChild(bar);
  host.appendChild(card);
}
function _phaRenderStandards(host,ctx){
  if(!_phaGuard(host,ctx,'Standards'))return;
  host.appendChild(_phaHead('Standards','The current gross standard per article code: fabric per finished piece. Every save needs a reason.',ctx));
  const fl=_phaFlashNode('standards',ctx);if(fl)host.appendChild(fl);
  const g=ctx.get('standards');
  if(!g.ok){host.appendChild(_phaFailCard(ctx,'standards','Consumption standards could not be read'));return;}
  _phaArtEnsure(ctx);
  const art=_phaArtState();
  const v=phaStandardsView(art,g.rows,'','all');
  // coverage
  const cov=_phaCard('Coverage',[],'pha-cov');
  if(art.state==='ok'&&v.coverage){
    cov.appendChild(phEl('p','pha-covline',v.coverage.with+' of '+v.coverage.total+' active articles have a standard'));
    const bar=phEl('div','pha-bar');bar.setAttribute('role','img');
    const pct=v.coverage.total?Math.floor(v.coverage.with/v.coverage.total*100):0;
    bar.setAttribute('aria-label',pct+' percent');
    const fill=phEl('i','pha-bar-fill');fill.style.width=pct+'%';bar.appendChild(fill);
    cov.appendChild(bar);
    cov.appendChild(phEl('p','ph-note','Counts the active GROOVY articles in the article registry.'+(v.orphans?' '+v.orphans+' saved standard(s) are for a code that is not in the registry.':'')));
  }else if(art.state==='loading')cov.appendChild(phEl('p','ph-note','Loading the article registry...'));
  else if(art.state==='failed'){
    cov.appendChild(phEl('p','ph-note','Coverage is unavailable: the article registry (articles) could not be read. Saved standards are listed below; new ones need the registry.'));
    cov.appendChild(_phaBtn('','Retry the registry',function(){_phaArtLoading=false;if(typeof loadPatternsData==='function'){_phaArtLoading=true;Promise.resolve().then(function(){return loadPatternsData();}).catch(function(){}).then(function(){_phaArtLoading=false;ctx.repaint();});}},{'data-act':'retry-articles'}));
  }else if(art.state==='empty')cov.appendChild(phEl('p','ph-note','The article registry is empty (not seeded yet), so coverage cannot be counted. Saved standards are listed below.'));
  else cov.appendChild(phEl('p','ph-note','The article registry is not available in this build, so coverage cannot be counted.'));
  host.appendChild(cov);
  // editor + list
  const ed=phEl('div','pha-edhost');host.appendChild(ed);_phaStdEditHost=ed;
  _phaStdPaintEditor(ctx);
  const lc=_phaCard('Articles',[]);
  const ctl=phEl('div','pha-ctl');
  const q=_phaInput('search',_phaS.q,'q',{placeholder:'Search a code or name','aria-label':'Search articles'});
  q.addEventListener('input',function(){_phaS.q=q.value;_phaS.limit=PHA_ROWS_SHOWN;_phaStdPaintList(ctx);});
  ctl.appendChild(_phaField('Find an article',q));
  const fsel=_phaSelect([{v:'all',t:'All'},{v:'without',t:'Without a standard'},{v:'with',t:'With a standard'}],_phaS.filter,'filter',{'aria-label':'Filter'});
  fsel.addEventListener('change',function(){_phaS.filter=fsel.value;_phaS.limit=PHA_ROWS_SHOWN;_phaStdPaintList(ctx);});
  ctl.appendChild(_phaField('Show',fsel));
  lc.appendChild(ctl);
  const lh=phEl('div','pha-listhost');lc.appendChild(lh);_phaStdListHost=lh;
  host.appendChild(lc);
  if(g.truncated)host.appendChild(phEl('p','ph-note','The standards list is cut at its read limit.'));
  _phaStdPaintList(ctx);
}

/* ═══ 3. SETTINGS ══════════════════════════════════════════════════════════ */

const PHA_NUM_FIELDS=Object.freeze([
  {k:'dailyCapacity',label:'Daily cutting capacity (pieces)',hint:'Pieces a day the calendar plans against.'},
  {k:'delayTargetDays',label:'Delay target (working days)',hint:'From issue to cut done.'},
  {k:'stuckDays',label:'Stuck after (days)',hint:'A PO older than this is called stuck. Must be above the delay target.'},
  {k:'grossOverTolPct',label:'Gross over tolerance (%)',hint:'Consumption above the standard by more than this is flagged.'},
  {k:'grossUnderTolPct',label:'Gross under tolerance (%)',hint:'Consumption below the standard by more than this is flagged.'}
]);
function _phaSettingsSig(info){return JSON.stringify(info.raw||null);}
function _phaSetForm(info){
  const S=info.settings;
  const f={sig:_phaSettingsSig(info),skipNew:''};
  PHA_NUM_FIELDS.forEach(function(n){f[n.k]=String(S[n.k]);});
  f.gateLo=String(S.cutGate[0]);f.gateHi=String(S.cutGate[1]);
  f.off=[0,1,2,3,4,5,6].map(function(d){return S.offWeekdays.indexOf(d)>-1;});
  f.skip=S.skipDays.slice();
  f.pcOnlyHard=!!info.pcOnlyHard;
  return f;
}
// Form -> the changed fields only, or {error}. Pure. current: {settings (resolved), pcOnlyHard}.
function phaSettingsPatch(form,current){
  const f=form||{},S=current.settings,patch={};
  const whole=function(k,label,lo,hi){
    const n=phWhole(f[k]);
    if(n===null||n<lo||n>hi)return{error:label+' must be a whole number from '+lo+' to '+hi+'.'};
    return{n:n};
  };
  const cap=whole('dailyCapacity','Daily capacity',1,100000);if(cap.error)return cap;
  const dt=whole('delayTargetDays','The delay target',0,3650);if(dt.error)return dt;
  const sd=whole('stuckDays','The stuck limit',1,3650);if(sd.error)return sd;
  if(sd.n<=dt.n)return{error:'The stuck limit must be above the delay target.'};
  const pct=function(k,label){
    const n=phNum(f[k]);
    if(n===null||n<0||n>100)return{error:label+' must be a percent from 0 to 100.'};
    return{n:n};
  };
  const ov=pct('grossOverTolPct','Gross over tolerance');if(ov.error)return ov;
  const un=pct('grossUnderTolPct','Gross under tolerance');if(un.error)return un;
  const lo=phWhole(f.gateLo),hi=phWhole(f.gateHi);
  if(lo===null||hi===null||lo<50||lo>=100||hi<=100||hi>200)return{error:'The cut gate needs a lower limit from 50 to 99 and an upper limit from 101 to 200 (percent of the planned quantity).'};
  const off=[];(Array.isArray(f.off)?f.off:[]).forEach(function(b,i){if(b)off.push(i);});
  if(off.length>=7)return{error:'All seven weekdays cannot be off: nothing could be cut.'};
  const skip=Array.from(new Set((Array.isArray(f.skip)?f.skip:[]).filter(function(d){return phIsDay(d);}))).sort();
  if(skip.length>5000)return{error:'Too many skip days (the limit is 5000).'};
  if(cap.n!==S.dailyCapacity)patch.dailyCapacity=cap.n;
  if(dt.n!==S.delayTargetDays)patch.delayTargetDays=dt.n;
  if(sd.n!==S.stuckDays)patch.stuckDays=sd.n;
  if(ov.n!==S.grossOverTolPct)patch.grossOverTolPct=ov.n;
  if(un.n!==S.grossUnderTolPct)patch.grossUnderTolPct=un.n;
  if(lo!==S.cutGate[0]||hi!==S.cutGate[1])patch.cutGate=[lo,hi];
  if(JSON.stringify(off)!==JSON.stringify(S.offWeekdays))patch.offWeekdays=off;
  if(JSON.stringify(skip)!==JSON.stringify(S.skipDays))patch.skipDays=skip;
  if(!!f.pcOnlyHard!==!!current.pcOnlyHard)patch.pcOnlyHard=!!f.pcOnlyHard;
  // the delay target and the stuck limit are judged as a PAIR by the core (stuck must be above the target), so the writer refuses
  // one of them alone while the other is not stored yet. Changing either sends both.
  if('delayTargetDays' in patch||'stuckDays' in patch){patch.delayTargetDays=dt.n;patch.stuckDays=sd.n;}
  if(!Object.keys(patch).length)return{error:'Nothing has changed.',nothing:true};
  return{patch:patch};
}
function _phaRenderSettings(host,ctx){
  if(!_phaGuard(host,ctx,'Settings'))return;
  host.appendChild(_phaHead('Settings','Capacity, calendar, limits and the PC-only rule for Production Ops. Saved as one document; a stale save is refused.',ctx));
  const fl=_phaFlashNode('settings',ctx);if(fl)host.appendChild(fl);
  const gs=ctx.get('settings');
  if(!gs.ok){host.appendChild(_phaFailCard(ctx,'settings','Production Ops settings could not be read'));return;}
  const info=phSettingsInfo();
  const raw=info.raw||{};
  if(!_phaT.form||_phaT.sig!==_phaSettingsSig(info)){_phaT.form=_phaSetForm(info);_phaT.sig=_phaSettingsSig(info);}
  _phaT.rev=typeof raw.rev==='number'?raw.rev:0;
  const f=_phaT.form,D=PH_DEFAULT_SETTINGS;
  const isOwner=typeof phIsOwner==='function'&&phIsOwner(ctx.user);
  const saved=function(k){return Object.prototype.hasOwnProperty.call(raw,k);};
  // A saved value can be put back to its default (14 Oct 2026): the key is removed from the document. The delay target and the stuck
  // limit go together (the core judges them as a pair); the hard PC-only rule only an owner can touch.
  const clearBtn=function(keys,label,actKey){
    if(!keys.every(function(k){return k!=='pcOnlyHard'||isOwner;}))return null;
    const b=_phaBtn('pha-clear','Back to default',function(e,btn){
      const patch={};keys.forEach(function(k){patch[k]=null;});
      _phaAct(ctx,'settings',function(){return phSettingsSave(patch,{expectedRev:_phaT.rev});},
        function(r){_phaT.form=null;_phaT.sig=null;return label+' is back to its default (revision '+r.rev+'). Unsaved edits on this page were discarded.';},btn);
    },{'data-act':'clear-'+actKey,'aria-label':'Put '+label+' back to its default','title':'Removes the saved value. Anything typed on this page and not saved is discarded.'});
    return b;
  };
  const CLEAR_PAIR=['delayTargetDays','stuckDays'];
  const status=function(k,defTxt){
    if(!saved(k))return _phaChip('Default '+defTxt+' - defaults, unconfirmed');
    const w=phEl('span','pha-saved');
    w.appendChild(_phaChip('Saved','ph-chip-ok'));
    const label=(PHA_NUM_FIELDS.filter(function(n){return n.k===k;})[0]||{label:k}).label;
    const pair=CLEAR_PAIR.indexOf(k)>-1;
    const cb=clearBtn(pair?CLEAR_PAIR.slice():[k],pair?'The delay target and the stuck limit':label,k);
    if(cb)w.appendChild(cb);
    return w;
  };
  // where we are
  const meta=phEl('p','ph-note',_phaT.rev?'Revision '+_phaT.rev+(raw.updatedBy?', last saved by '+raw.updatedBy:'')+(raw.updatedAt?' on '+_phaStampLabel(raw.updatedAt):'')+'.':'Nothing has been saved yet: every value below is a default, and the defaults are unconfirmed.');
  host.appendChild(meta);
  // numbers
  const nums=_phaCard('Capacity and limits',[]);
  const grid=phEl('div','pha-grid');
  PHA_NUM_FIELDS.forEach(function(n){
    const i=_phaInput('text',f[n.k],n.k,{inputmode:'decimal','aria-label':n.label});
    _phaBind(i,f,n.k);
    const fld=_phaField(n.label,i,n.hint);
    const cell=phEl('div','pha-cell');   // the status (and its button) sit OUTSIDE the label: a button inside a label is invalid
    cell.appendChild(fld);
    cell.appendChild(status(n.k,String(D[n.k])));
    grid.appendChild(cell);
  });
  nums.appendChild(grid);
  host.appendChild(nums);
  // gate
  const gate=_phaCard('Cut gate',[]);
  gate.appendChild(phEl('p','ph-note','The allowed range of the actual cut against the planned quantity, in percent. The shipped value is 70 to 130. The PO cutting screen (js/pos.js) uses its own fixed 70 to 130 gate and does not read this; this is the value Production Ops checks will use.'));
  const gg=phEl('div','pha-grid');
  const lo=_phaInput('text',f.gateLo,'gateLo',{inputmode:'numeric','aria-label':'Cut gate lower limit percent'});_phaBind(lo,f,'gateLo');
  const hi=_phaInput('text',f.gateHi,'gateHi',{inputmode:'numeric','aria-label':'Cut gate upper limit percent'});_phaBind(hi,f,'gateHi');
  gg.appendChild(_phaField('Lower limit (%)',lo,'50 to 99'));
  gg.appendChild(_phaField('Upper limit (%)',hi,'101 to 200'));
  gate.appendChild(gg);
  gate.appendChild(status('cutGate','70 to 130'));
  host.appendChild(gate);
  // calendar
  const cal=_phaCard('Calendar',[]);
  cal.appendChild(phEl('h4','pha-sub-title','Weekdays off'));
  const off=phEl('div','pha-days');
  PHA_WD_LONG.forEach(function(name,d){
    const c=_phaCheck(f.off[d],'off-'+d,name);
    c.firstChild.addEventListener('change',function(){f.off[d]=!!c.firstChild.checked;});
    off.appendChild(c);
  });
  cal.appendChild(off);
  cal.appendChild(status('offWeekdays','none'));
  cal.appendChild(phEl('h4','pha-sub-title','Skip days (no cutting)'));
  const sl=phEl('ul','ph-lines pha-skiplist');
  if(!f.skip.length)sl.appendChild(phEl('li','ph-line',null,[phEl('span','ph-line-txt','No skip days.')]));
  f.skip.forEach(function(d){
    const li=phEl('li','ph-line');li.setAttribute('data-skip',d);
    li.appendChild(phEl('span','ph-line-name',_phaDayLabel(d)));
    li.appendChild(_phaBtn('','Remove',function(){f.skip=f.skip.filter(function(x){return x!==d;});ctx.repaint();},{'data-act':'skip-remove','aria-label':'Remove skip day '+d}));
    sl.appendChild(li);
  });
  cal.appendChild(sl);
  cal.appendChild(status('skipDays','none'));
  const add=phEl('div','pha-add');
  const di=_phaInput('date',f.skipNew,'skipNew',{'aria-label':'Day to skip'});_phaBind(di,f,'skipNew');
  add.appendChild(_phaField('Add a skip day',di));
  add.appendChild(_phaBtn('','Add day',function(){
    const d=String(f.skipNew||'').trim();
    if(!phIsDay(d)){_phaFlash={tab:'settings',kind:'bad',text:'Choose a real day, year-month-day.'};ctx.repaint();return;}
    if(f.skip.length>=5000){_phaFlash={tab:'settings',kind:'bad',text:'Too many skip days (the limit is 5000).'};ctx.repaint();return;}
    if(f.skip.indexOf(d)<0)f.skip=f.skip.concat([d]).sort();
    f.skipNew='';_phaFlash=null;ctx.repaint();
  },{'data-act':'skip-add'}));
  cal.appendChild(add);
  cal.appendChild(phEl('p','ph-note','Skip days and weekdays off are saved with the other settings (press Save below).'));
  host.appendChild(cal);
  // PC-only
  const pc=_phaCard('PC-only rule',[]);
  pc.appendChild(phEl('p','ph-note','When on, entering a PO is meant to be refused on a phone. Today this is only stored: nothing reads it yet, so switching it changes no behaviour.'));
  pc.appendChild(_phaCheck(f.pcOnlyHard,'pcOnlyHard','Hard PC-only rule',!isOwner));
  const pcCb=pc.lastChild.firstChild;pcCb.addEventListener('change',function(){f.pcOnlyHard=!!pcCb.checked;});
  if(!isOwner)pc.appendChild(phEl('p','ph-note pha-reason','Only an owner (Afnan or Ammar) can change this. The database rules enforce it, so it cannot be changed from here.'));
  pc.appendChild(status('pcOnlyHard','off'));
  host.appendChild(pc);
  // save
  const bar=phEl('div','pha-acts pha-savebar');
  bar.appendChild(_phaBtn('ph-btn-primary','Save settings',function(e,b){
    const built=phaSettingsPatch(f,info);
    if(built.error){_phaFlash={tab:'settings',kind:built.nothing?'ok':'bad',text:built.error};ctx.repaint();return;}
    _phaAct(ctx,'settings',function(){return phSettingsSave(built.patch,{expectedRev:_phaT.rev});},
      function(r){_phaT.form=null;_phaT.sig=null;return'Settings saved (revision '+r.rev+'): '+Object.keys(built.patch).join(', ')+'.';},b);
  },{'data-act':'save'}));
  host.appendChild(bar);
}

/* ── register the three tabs (the shell's extension point) ─────────────── */
(function(){
  if(typeof phRegisterTab!=='function'){
    if(typeof console!=='undefined')console.warn('[ph-mod-admin] js/ph-ui.js is not loaded, so the Masters, Standards and Settings tabs were not registered.');
    return;
  }
  phRegisterTab('masters',{render:_phaRenderMasters});
  phRegisterTab('standards',{render:_phaRenderStandards});
  phRegisterTab('settings',{render:_phaRenderSettings});
})();

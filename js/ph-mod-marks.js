/* ─────────────────────────────────────────────────────────────────────────
   Production Ops ▸ manager marks and comments on a PO (WP2, 18 Oct 2026)

   Managers (afnan, ammar, mustafa) place per-PO marks: priority (urgent / high), a hold with a reason, a highlight colour
   from a fixed palette and a short text mark, plus a comment thread. Kashif (login `uzaib`) SEES every mark, on the
   PO Queue tile, the Calendar chip, the Today's Cutting card and the Monitor attention rows, and can never create, edit or remove one:
   the controls are not drawn for him, every entry point here refuses him, and firestore.rules refuses the write.

   Reads: the 'marks' stage of js/ph-data.js (po_marks, one bounded read, never rejects). A failed read is NAMED
   (phMarksState) and prints no badge; it is never "no marks".
   Writes: js/ph-write.js phMarksSave / phMarkComment ONLY -> po_marks/{PO-nnn} and its notes. This file calls no Firestore write API
   itself, and NOTHING here writes a pos document or a pos history row. A hold is a NOTE for everyone: it does not change the delay or
   stuck counts (ph-core is untouched).

   Every mark is drawn with a colour AND a glyph AND a word (never colour alone). Every stored string reaches the page
   through textContent. Strings come from js/ph-i18n.js (marks.*; the Urdu is review:true). Globals are phmk / _phmk / PHMK_ prefixed.
   ───────────────────────────────────────────────────────────────────────── */

const PHMK_COLOURS=Object.freeze(['amber','red','green','blue','purple','teal']);
let _phmkOpen=null;            // the PO id whose manager panel is open (one at a time)
let _phmkDraft=null;           // the form state of the open panel: {po, priority, holdOn, holdReason, highlight, label, note}
let _phmkMsg=null;             // {po, ok, text}
let _phmkNotes={};             // poId -> {state:'idle'|'loading'|'ok'|'error', rows, text}
let _phmkBusy=false;

function _phmkUser(u){
  if(u!==undefined)return typeof u==='string'?u:'';
  return(typeof session!=='undefined'&&session&&typeof session.u==='string')?session.u:'';
}
// May this person place marks? (convenience: the writer and the rules are the boundary)
function phmkCanMark(u){return typeof phCanManage==='function'&&phCanManage(_phmkUser(u))===true;}
function _phmkRow(poId){return typeof phMarkOf==='function'?phMarkOf(poId):null;}
function _phmkMarks(poId){const r=_phmkRow(poId);return r&&r.marks&&typeof r.marks==='object'?r.marks:null;}

/* ── what everybody sees ──────────────────────────────────────────────── */
// One badge: glyph (decorative) + word. The colour is the third cue, never the only one.
function _phmkBadge(b,compact){
  const el=phEl('span','phmk-b phmk-c-'+b.colour+' phmk-k-'+b.kind);
  el.appendChild(phEl('span','phmk-g',b.glyph));
  el.lastChild.setAttribute('aria-hidden','true');
  if(b.kind==='label'){el.appendChild(phEl('span','phmk-w',null));el.lastChild.textContent=b.text;}
  else{
    el.appendChild(phEl('span','phmk-w',phI18nD(b.key)));
  }
  if(b.kind==='hold'&&b.text&&!compact)el.setAttribute('title',phI18nAttr(phI18nD('marks.hold_reason_is',{why:b.text})));
  return el;
}
// The badges of a PO as a span, or null when it has no mark (or marks were not read: the caller says so once, phmkNoteNode).
function phmkBadgesNode(poId,opts){
  if(typeof phMarkBadges!=='function')return null;
  const m=_phmkMarks(poId);
  if(!m)return null;
  const list=phMarkBadges(m);
  const row=_phmkRow(poId);
  const n=row&&typeof row.noteCount==='number'?row.noteCount:0;
  if(!list.length&&!n)return null;
  const compact=!!(opts&&opts.compact);
  const wrap=phEl('span','phmk-badges'+(compact?' phmk-compact':''));
  wrap.setAttribute('data-phmk-po',String(poId));
  list.forEach(function(b){wrap.appendChild(_phmkBadge(b,compact));});
  if(n>0){
    const c=phEl('span','phmk-b phmk-c-blue phmk-k-comments');
    c.appendChild(phEl('span','phmk-g','\u{1F4AC}'));c.lastChild.setAttribute('aria-hidden','true');
    c.appendChild(phEl('span','phmk-w',phI18nD(n===1?'marks.n_comment':'marks.n_comments',{n:n})));
    wrap.appendChild(c);
  }
  return wrap;
}
// Tint a tile / chip / row for a highlight and a hold, and add its badges. Returns true when anything was added.
function phmkApply(node,poId,opts){
  if(!node)return false;
  const m=_phmkMarks(poId);
  const b=phmkBadgesNode(poId,opts);
  if(!m||!b)return false;
  if(PHMK_COLOURS.indexOf(m.highlight)>-1){node.classList.add('phmk-hl');node.classList.add('phmk-hl-'+m.highlight);}
  if(m.hold)node.classList.add('phmk-held');
  if(m.priority==='urgent')node.classList.add('phmk-urgent');
  node.appendChild(b);
  return true;
}
// The full read-only text of the marks (hold reason, text mark, last comment) for a bigger surface (the cutting card).
function phmkSummaryNode(poId){
  const row=_phmkRow(poId),m=_phmkMarks(poId);
  if(!row)return null;
  const box=phEl('div','phmk-summary');
  box.setAttribute('data-phmk-po',String(poId));
  const b=phmkBadgesNode(poId);
  if(!b)return null;
  box.appendChild(b);
  if(m&&m.hold&&m.hold.reason){const p=phEl('p','phmk-line',null);p.textContent=phI18nStr(phI18nD('marks.hold_reason_is',{why:m.hold.reason}));box.appendChild(p);}
  if(row.lastNote){
    const p=phEl('p','phmk-line phmk-last',null);
    p.textContent=phI18nStr(phI18nD('marks.last_comment',{who:row.lastNoteBy||'',text:row.lastNote}));
    box.appendChild(p);
  }
  return box;
}
// One line when the marks could not be read (shown once per screen, never as "no marks").
function phmkNoteNode(){
  if(typeof phMarksState!=='function')return null;
  const st=phMarksState();
  if(!st.failed)return null;
  const p=phEl('p','phmk-unavail',null);
  p.setAttribute('role','status');
  p.textContent=phI18nStr(phI18nD('marks.unavailable',{why:st.text||'po_marks'}));
  return p;
}

/* ── manager panel on a Queue tile ────────────────────────────────────── */
function _phmkSeed(poId){
  const m=_phmkMarks(poId)||{};
  return{po:poId,priority:m.priority||'normal',holdOn:!!m.hold,holdReason:m.hold&&m.hold.reason?m.hold.reason:'',highlight:m.highlight||'',label:m.label||'',note:''};
}
function _phmkInput(d){
  return{priority:d.priority,hold:d.holdOn?{reason:d.holdReason}:null,highlight:d.highlight||null,label:d.label};
}
function phmkTogglePanel(poId,ctx){
  if(!phmkCanMark())return false;
  if(_phmkOpen===poId){_phmkOpen=null;_phmkDraft=null;}
  else{_phmkOpen=poId;_phmkDraft=_phmkSeed(poId);_phmkMsg=null;_phmkLoadNotes(poId,ctx);}
  if(ctx&&typeof ctx.repaint==='function')ctx.repaint();
  return true;
}
async function _phmkLoadNotes(poId,ctx){
  if(typeof phMarkNotesOf!=='function')return;
  _phmkNotes[poId]={state:'loading',rows:null,text:''};
  const r=await phMarkNotesOf(poId);
  _phmkNotes[poId]=r.ok?{state:'ok',rows:r.rows,text:''}:{state:'error',rows:null,text:r.text||''};
  if(_phmkOpen===poId&&ctx&&typeof ctx.repaint==='function')ctx.repaint();
}
// Save the form. Gated again here (the button is not the boundary).
async function phmkSave(ctx){
  if(!phmkCanMark())return{ok:false,code:'forbidden',error:phI18nStr(phI18nD('marks.not_managers'))};
  if(typeof phMarksSave!=='function')return{ok:false,code:'failed',error:'js/ph-write.js is not loaded.'};
  const d=_phmkDraft;if(!d)return{ok:false,code:'invalid',error:'No panel is open.'};
  const st=typeof phMarksState==='function'?phMarksState():{ok:true};
  if(!st.ok)return{ok:false,code:'unread',error:phI18nStr(phI18nD('marks.unread_cannot_edit'))};
  if(_phmkBusy)return{ok:false,code:'busy',error:''};
  _phmkBusy=true;
  const row=_phmkRow(d.po);
  const input=_phmkInput(d);
  const empty=typeof phMarksClean==='function'&&phMarksEmpty(phMarksClean(input).value);
  let r;
  try{r=await phMarksSave(d.po,input,row&&typeof row.rev==='number'?{expectedRev:row.rev}:{});}
  catch(e){r={ok:false,code:'failed',error:String(e&&e.message||e)};}
  finally{_phmkBusy=false;}
  _phmkMsg={po:d.po,ok:!!r.ok,text:r.ok?phI18nStr(phI18nD(empty?'marks.cleared':'marks.saved')):phI18nStr(phI18nD('marks.fail',{why:r.error||r.code||''}))};
  if(r.ok)_phmkDraft=_phmkSeed(d.po);
  if(ctx&&typeof ctx.repaint==='function')ctx.repaint();
  return r;
}
async function phmkAddComment(ctx){
  if(!phmkCanMark())return{ok:false,code:'forbidden',error:phI18nStr(phI18nD('marks.not_managers'))};
  if(typeof phMarkComment!=='function')return{ok:false,code:'failed',error:'js/ph-write.js is not loaded.'};
  const d=_phmkDraft;if(!d)return{ok:false,code:'invalid',error:'No panel is open.'};
  const st=typeof phMarksState==='function'?phMarksState():{ok:true};
  if(!st.ok)return{ok:false,code:'unread',error:phI18nStr(phI18nD('marks.unread_cannot_edit'))};
  if(_phmkBusy)return{ok:false,code:'busy',error:''};
  _phmkBusy=true;
  let r;
  try{r=await phMarkComment(d.po,d.note);}
  catch(e){r={ok:false,code:'failed',error:String(e&&e.message||e)};}
  finally{_phmkBusy=false;}
  _phmkMsg={po:d.po,ok:!!r.ok,text:r.ok?phI18nStr(phI18nD('marks.comment_added')):phI18nStr(phI18nD('marks.fail',{why:r.error||r.code||''}))};
  if(r.ok){d.note='';await _phmkLoadNotes(d.po,ctx);}
  else if(ctx&&typeof ctx.repaint==='function')ctx.repaint();
  return r;
}
function _phmkField(label,child,cls){
  const w=phEl('div','phmk-field'+(cls?' '+cls:''));
  w.appendChild(phEl('div','phmk-lab',label));
  w.appendChild(child);
  return w;
}
// The panel node for one PO (managers only). Inputs write into _phmkDraft as they change; no repaint per keystroke.
function phmkPanelNode(poId,ctx){
  const d=_phmkDraft&&_phmkDraft.po===poId?_phmkDraft:(_phmkDraft=_phmkSeed(poId));
  const box=phEl('div','phmk-panel');
  box.setAttribute('data-phmk-panel',poId);box.setAttribute('role','group');
  box.setAttribute('aria-label',phI18nAttr(phI18nD('marks.panel_title',{po:poId})));
  const st=typeof phMarksState==='function'?phMarksState():{ok:true};
  if(!st.ok){
    const p=phEl('p','phmk-unavail',null);p.setAttribute('role','alert');
    p.textContent=phI18nStr(phI18nD('marks.unavailable',{why:st.text||'po_marks'}))+' '+phI18nStr(phI18nD('marks.unread_cannot_edit'));
    box.appendChild(p);
    return box;
  }
  // priority
  const pri=phEl('select','phmk-sel');pri.setAttribute('aria-label',phI18nAttr(phI18nD('marks.priority')));
  [['normal','marks.pri_normal'],['high','marks.pri_high'],['urgent','marks.pri_urgent']].forEach(function(o){
    const op=document.createElement('option');op.value=o[0];op.textContent=phI18nStr(phI18nD(o[1]),'en');
    if(d.priority===o[0])op.selected=true;pri.appendChild(op);
  });
  pri.addEventListener('change',function(){d.priority=pri.value;});
  box.appendChild(_phmkField(phI18nD('marks.priority'),pri));
  // hold
  const holdBox=phEl('div','phmk-hold');
  const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!d.holdOn;cb.id='phmk-hold-'+poId;
  const lb=phEl('label','phmk-chk',phI18nD('marks.hold_on'));lb.setAttribute('for',cb.id);
  const why=document.createElement('input');why.type='text';why.className='phmk-txt';why.maxLength=200;why.value=d.holdReason||'';
  why.setAttribute('aria-label',phI18nAttr(phI18nD('marks.hold_reason')));why.placeholder=phI18nStr(phI18nD('marks.hold_reason'));
  why.disabled=!d.holdOn;
  cb.addEventListener('change',function(){d.holdOn=cb.checked;why.disabled=!cb.checked;if(cb.checked)why.focus();});
  why.addEventListener('input',function(){d.holdReason=why.value;});
  holdBox.appendChild(cb);holdBox.appendChild(lb);holdBox.appendChild(why);
  box.appendChild(_phmkField(phI18nD('marks.hold'),holdBox));
  // highlight: a swatch AND a word per colour (radio group)
  const sw=phEl('div','phmk-swatches');sw.setAttribute('role','radiogroup');sw.setAttribute('aria-label',phI18nAttr(phI18nD('marks.highlight')));
  [''].concat(PHMK_COLOURS).forEach(function(c){
    const b=phEl('button','phmk-sw'+(c?' phmk-c-'+c:' phmk-none')+((d.highlight||'')===c?' on':''));
    b.setAttribute('type','button');b.setAttribute('role','radio');b.setAttribute('aria-checked',(d.highlight||'')===c?'true':'false');b.setAttribute('data-colour',c);
    b.appendChild(phEl('span','phmk-g',(d.highlight||'')===c?'✓':(c?'◆':'∅')));b.lastChild.setAttribute('aria-hidden','true');
    b.appendChild(phEl('span','phmk-w',phI18nD(c?'marks.col_'+c:'marks.col_none')));
    b.addEventListener('click',function(){d.highlight=c;[].forEach.call(sw.children,function(x){const on=x.getAttribute('data-colour')===c;x.classList.toggle('on',on);x.setAttribute('aria-checked',on?'true':'false');x.firstChild.textContent=on?'✓':(x.getAttribute('data-colour')?'◆':'∅');});});
    sw.appendChild(b);
  });
  box.appendChild(_phmkField(phI18nD('marks.highlight'),sw));
  // text mark
  const lab=document.createElement('input');lab.type='text';lab.className='phmk-txt';lab.maxLength=60;lab.value=d.label||'';
  lab.placeholder=phI18nStr(phI18nD('marks.label_ph'));lab.setAttribute('aria-label',phI18nAttr(phI18nD('marks.label')));
  lab.addEventListener('input',function(){d.label=lab.value;});
  box.appendChild(_phmkField(phI18nD('marks.label'),lab));
  box.appendChild(phEl('p','phmk-note',phI18nD('marks.hold_note')));
  // actions
  const act=phEl('div','phmk-act');
  const save=phEl('button','ph-btn phmk-save',phI18nD('marks.save'));save.setAttribute('type','button');
  save.addEventListener('click',function(){phmkSave(ctx);});
  const clr=phEl('button','ph-btn phmk-clear',phI18nD('marks.clear'));clr.setAttribute('type','button');
  clr.addEventListener('click',function(){_phmkDraft=Object.assign(_phmkSeed(poId),{priority:'normal',holdOn:false,holdReason:'',highlight:'',label:''});phmkSave(ctx);});
  act.appendChild(save);act.appendChild(clr);
  box.appendChild(act);
  if(_phmkMsg&&_phmkMsg.po===poId){const m=phEl('p','phmk-msg '+(_phmkMsg.ok?'ok':'bad'),null);m.setAttribute('role',_phmkMsg.ok?'status':'alert');m.textContent=_phmkMsg.text;box.appendChild(m);}
  // comments
  const cm=phEl('div','phmk-comments');
  cm.appendChild(phEl('div','phmk-lab',phI18nD('marks.comments')));
  const ns=_phmkNotes[poId]||{state:'idle'};
  if(ns.state==='loading')cm.appendChild(phEl('p','phmk-note',phI18nD('marks.comments_loading')));
  else if(ns.state==='error'){const p=phEl('p','phmk-unavail',null);p.setAttribute('role','alert');p.textContent=phI18nStr(phI18nD('marks.comments_failed',{why:ns.text||''}));cm.appendChild(p);}
  else if(ns.state==='ok'){
    if(!ns.rows.length)cm.appendChild(phEl('p','phmk-note',phI18nD('marks.comments_none')));
    const ul=phEl('ul','phmk-thread');
    ns.rows.forEach(function(r){
      const li=phEl('li','phmk-cmt');
      const who=phEl('span','phmk-cmt-who',null);who.textContent=(r.byName||r.by||'')+' · '+(typeof r.at==='number'?new Date(r.at).toLocaleString('en-GB'):'');
      const tx=phEl('span','phmk-cmt-text',null);tx.textContent=r.text||'';
      li.appendChild(who);li.appendChild(tx);ul.appendChild(li);
    });
    cm.appendChild(ul);
  }else{
    const b=phEl('button','ph-btn phmk-load',phI18nD('marks.comments_load'));b.setAttribute('type','button');
    b.addEventListener('click',function(){_phmkLoadNotes(poId,ctx);});cm.appendChild(b);
  }
  const ta=document.createElement('textarea');ta.className='phmk-ta';ta.maxLength=500;ta.rows=2;ta.value=d.note||'';
  ta.placeholder=phI18nStr(phI18nD('marks.comment_ph'));ta.setAttribute('aria-label',phI18nAttr(phI18nD('marks.comment_ph')));
  ta.addEventListener('input',function(){d.note=ta.value;});
  const add=phEl('button','ph-btn phmk-add',phI18nD('marks.comment_add'));add.setAttribute('type','button');
  add.addEventListener('click',function(){phmkAddComment(ctx);});
  cm.appendChild(ta);cm.appendChild(add);
  box.appendChild(cm);
  return box;
}
// What the PO Queue tile calls: the Marks button (managers only) and, when open, the panel. Floor users get nothing here
// (their badges come from phmkApply). Returns the node to append to the tile's action row / tile.
function phmkTileControls(poId,ctx,manage){
  if(!manage||!phmkCanMark())return null;
  const wrap=phEl('span','phmk-ctl');
  const open=_phmkOpen===poId;
  const b=phEl('button','ph-btn phq-btn phmk-btn'+(open?' on':''),phI18nD('marks.btn'));
  b.setAttribute('type','button');b.setAttribute('aria-expanded',open?'true':'false');b.setAttribute('data-act','marks');
  b.setAttribute('aria-label',phI18nAttr(phI18nD('marks.btn_aria',{po:poId})));
  b.addEventListener('click',function(){phmkTogglePanel(poId,ctx);});
  wrap.appendChild(b);
  return wrap;
}
function phmkTilePanel(poId,ctx,manage){
  if(!manage||!phmkCanMark()||_phmkOpen!==poId)return null;
  return phmkPanelNode(poId,ctx);
}
function phmkReset(){_phmkOpen=null;_phmkDraft=null;_phmkMsg=null;_phmkNotes={};_phmkBusy=false;}

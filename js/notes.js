/* Groovy Operations — notes.js
   Plain global JS (NO modules), loaded via <script src> after auth.js.
   Firebase globals (db, getDoc, getDocs, setDoc, updateDoc, addDoc,
   deleteDoc, query, where, collection, doc) are bridged onto window by the
   bootstrap module in index.html — see "File architecture" in CLAUDE.md.

   Phase 1 of the Notion+Milanote module (see CLAUDE.md "Notes / Wiki"):
   Notion-lite block pages. Every signed-in user can create pages, either
   'shared' (team wiki/SOPs, readable by everyone signed in) or 'personal'
   (readable only by the owner — a private notebook). Phase 2 (a Milanote-
   style freeform drag/connector canvas) is a separate future module; it is
   NOT built here.

   Firestore: one doc per page in `notes_pages`, blocks stored as a plain
   array field on the doc (no subcollection) — simplest thing that works at
   this app's scale, and keeps the whole page in one read/write. See
   firestore.rules for the ownerUid-based read/write split. */

// ── State ──
let notesLoaded=false;
let notesPages=[];            // merged list: every 'shared' page + the signed-in user's own pages
let _notesFilter='all';       // 'all' | 'shared' | 'mine'
let _notesSearch='';
let _notesViewingId=null;     // id of the page open in the detail view
let _notesEditPage=null;      // {id,title,icon,visibility,ownerUid,ownerName,ownerUsername,createdAt,updatedAt}
let _notesEditBlocks=[];      // working copy of the open page's blocks
let _notesSaveTimer=null;
let _notesSearchTimer=null;
let _notesBlockSeq=0;

const _NOTES_BLOCK_TYPES=[
  {type:'paragraph',label:'Text'},
  {type:'h1',label:'Heading 1'},
  {type:'h2',label:'Heading 2'},
  {type:'bullet',label:'Bulleted list'},
  {type:'numbered',label:'Numbered list'},
  {type:'checklist',label:'Checklist'},
  {type:'quote',label:'Quote'},
  {type:'divider',label:'Divider'},
  {type:'image',label:'Image'}
];

function _notesEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function _notesRelTime(ts){
  if(!ts)return'';
  const diff=Date.now()-ts,m=Math.floor(diff/60000);
  if(m<1)return'just now';
  if(m<60)return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24)return h+'h ago';
  const d=Math.floor(h/24);
  if(d<30)return d+'d ago';
  return new Date(ts).toLocaleDateString('en-GB');
}

function _notesNewBlock(type){
  return{id:'b'+(++_notesBlockSeq)+'_'+Date.now(),type:type||'paragraph',text:'',checked:false,imageUrl:''};
}

function _notesCanEdit(p){
  return!!(p&&session&&(p.ownerUid===session.uid||session.role==='owner'));
}

// ── Load (list) ──
// Two single-field queries (visibility=='shared', ownerUid==me) merged
// client-side, same "fetch once, filter in memory" approach as Monitor —
// each query maps 1:1 onto a clause of the firestore.rules read condition,
// so it never needs a composite index and never risks the classic Firestore
// gotcha where a broader query gets rejected because a rule can't prove
// every possible result is readable.
async function loadNotesData(){
  const[sharedSnap,mineSnap]=await Promise.all([
    getDocs(query(collection(db,'notes_pages'),where('visibility','==','shared'))),
    getDocs(query(collection(db,'notes_pages'),where('ownerUid','==',session.uid)))
  ]);
  const map={};
  sharedSnap.forEach(d=>{map[d.id]={id:d.id,...d.data()};});
  mineSnap.forEach(d=>{map[d.id]={id:d.id,...d.data()};});
  notesPages=Object.values(map).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  notesLoaded=true;
}

// ── List view ──
function renderNotesPage(){
  const tabs=['all','shared','mine'].map(f=>{
    const on=_notesFilter===f;
    const label=f==='all'?'All':f==='shared'?'👥 Team Wiki':'🔒 Mine';
    return`<button onclick="window.notesSetFilter('${f}')" style="padding:9px 14px;background:none;border:none;border-bottom:2px solid ${on?'#1A1A2E':'transparent'};font-weight:${on?'700':'500'};color:${on?'#1A1A2E':'var(--muted)'};cursor:pointer;font-family:inherit;font-size:13px">${label}</button>`;
  }).join('');
  return`
  <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">📝 Notes</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">Team wiki, SOPs and personal notes</div></div>
    <div style="display:flex;gap:8px">
      <button class="btn-sm" style="background:var(--dark)" onclick="window.notesCreatePage('personal')">+ Personal Page</button>
      <button class="btn-sm" style="background:var(--red)" onclick="window.notesCreatePage('shared')">+ Shared Page</button>
    </div>
  </div>
  <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px">${tabs}</div>
  <input type="text" id="notes-search" placeholder="Search notes…" value="${_notesEsc(_notesSearch)}" oninput="window.notesSearchInput(this.value)" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:9px;font-size:13px;font-family:inherit;margin-bottom:14px;box-sizing:border-box">
  <div id="notes-list">${_notesRenderList()}</div>`;
}

function _notesRenderList(){
  let list=notesPages;
  if(_notesFilter==='shared')list=list.filter(p=>p.visibility==='shared');
  else if(_notesFilter==='mine')list=list.filter(p=>p.ownerUid===session.uid);
  const q=_notesSearch.trim().toLowerCase();
  if(q)list=list.filter(p=>(p.title||'').toLowerCase().includes(q)||(p.blocks||[]).some(b=>(b.text||'').toLowerCase().includes(q)));
  if(!list.length)return'<div class="empty">No notes yet. Create one above.</div>';
  return list.map(p=>{
    const vis=p.visibility==='shared'?'👥 Team Wiki':'🔒 Personal';
    return`<div class="card" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px" onclick="window.notesOpenPage('${p.id}')">
      <div style="min-width:0">
        <div style="font-weight:600;font-size:14px">${_notesEsc(p.icon||'📄')} ${_notesEsc(p.title||'Untitled')}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${vis}${p.ownerName?(' · '+_notesEsc(p.ownerName)):''}${p.updatedAt?(' · updated '+_notesRelTime(p.updatedAt)):''}</div>
      </div>
      <div style="color:var(--muted);font-size:16px;flex-shrink:0">›</div>
    </div>`;
  }).join('');
}

window.notesSetFilter=function(f){_notesFilter=f;document.getElementById('main-content').innerHTML=renderNotesPage();};
window.notesSearchInput=function(val){
  _notesSearch=val;
  clearTimeout(_notesSearchTimer);
  _notesSearchTimer=setTimeout(()=>{const l=document.getElementById('notes-list');if(l)l.innerHTML=_notesRenderList();},180);
};

window.notesCreatePage=async function(visibility){
  try{
    const ref=await addDoc(collection(db,'notes_pages'),{
      title:'Untitled',icon:'📄',
      visibility:visibility==='shared'?'shared':'personal',
      ownerUid:session.uid,ownerName:session.name,ownerUsername:session.u,
      blocks:[_notesNewBlock('paragraph')],
      createdAt:Date.now(),updatedAt:Date.now(),updatedByName:session.name
    });
    notesLoaded=false;
    logActivity('Note page created',`${session.name} created "${visibility==='shared'?'a shared':'a personal'}" note page`);
    _notesViewingId=ref.id;
    window.showPage('note-detail');
  }catch(e){showToast('Could not create page: '+(e.message||e),true);}
};

window.notesOpenPage=function(id){_notesViewingId=id;window.showPage('note-detail');};

window.notesBack=function(){_notesSaveNow();window.showPage('notes');};

// ── Detail view ──
async function _notesOpenDetail(){
  const m=document.getElementById('main-content');
  let p=notesPages.find(x=>x.id===_notesViewingId);
  if(!p){
    m.innerHTML=gvSkeleton(4);
    try{
      const snap=await getDoc(doc(db,'notes_pages',_notesViewingId));
      if(!snap.exists()){m.innerHTML='<div class="empty">Page not found.</div>';return;}
      p={id:snap.id,...snap.data()};
    }catch(e){m.innerHTML='<div class="empty">Could not load page: '+(e.message||e)+'</div>';return;}
  }
  _notesEditPage={id:p.id,title:p.title||'Untitled',icon:p.icon||'📄',visibility:p.visibility||'personal',ownerUid:p.ownerUid,ownerName:p.ownerName,ownerUsername:p.ownerUsername,createdAt:p.createdAt,updatedAt:p.updatedAt};
  _notesEditBlocks=(p.blocks&&p.blocks.length?p.blocks:[_notesNewBlock('paragraph')]).map(b=>({...b}));
  _notesRenderDetailAndHydrate();
}

function _notesRenderDetailAndHydrate(){
  const m=document.getElementById('main-content');
  if(!m)return;
  m.innerHTML=renderNoteDetailPage();
  _notesHydrateBlocks();
}

function renderNoteDetailPage(){
  const p=_notesEditPage;
  if(!p)return'<div class="empty">No page loaded.</div>';
  const canEdit=_notesCanEdit(p);
  const visLabel=p.visibility==='shared'?'👥 Shared (Team Wiki)':'🔒 Personal';
  const updated=p.updatedAt?_notesRelTime(p.updatedAt):'';
  return`
  <button class="back-btn" onclick="window.notesBack()">← Back to Notes</button>
  <div class="card" style="padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:6px">
      <input type="text" id="notes-title-input" value="${_notesEsc(p.title)}" ${canEdit?'':'readonly'} oninput="window.notesTitleInput(this.value)" placeholder="Untitled" style="font-size:24px;font-weight:700;border:none;outline:none;font-family:inherit;flex:1;min-width:180px;background:transparent">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${canEdit?`<button class="btn-sm" onclick="window.notesToggleVisibility()">${visLabel} — change</button>`:`<span style="font-size:11px;color:var(--muted)">${visLabel}</span>`}
        ${canEdit?`<button class="btn-sm" style="background:var(--accent-urgent)" onclick="window.notesDeletePage()">Delete</button>`:''}
      </div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:16px">${p.ownerName?('by '+_notesEsc(p.ownerName)+' · '):''}${updated?('updated '+updated):''}${!canEdit?' · read-only':''}</div>
    <div id="notes-blocks">${_notesRenderBlocksHTML(_notesEditBlocks,canEdit)}</div>
    ${canEdit?`<button class="btn-sm" onclick="window.notesAddBlock()" style="margin-top:10px;background:none;border:1px dashed var(--border);color:var(--muted)">+ Add block</button>`:''}
  </div>`;
}

function _notesPlaceholder(type){
  return{paragraph:"Start typing… ('# ' heading, '- ' bullet, '[] ' checklist, '> ' quote)",
    h1:'Heading 1',h2:'Heading 2',bullet:'List item',numbered:'List item',
    checklist:'To-do',quote:'Quote'}[type]||'';
}

// Renders block STRUCTURE only (empty contenteditable bodies) — text is
// filled in afterwards by _notesHydrateBlocks() via textContent, never by
// interpolating stored text into the HTML string. Blocks are user-authored
// and a 'shared' page's blocks are rendered into every other signed-in
// user's browser, so this is a real stored-XSS boundary, not a hypothetical
// one — keep it this way rather than "simplifying" back to one template string.
function _notesRenderBlocksHTML(blocks,canEdit){
  let numCounter=0;
  return blocks.map((b,i)=>{
    numCounter=b.type==='numbered'?numCounter+1:0;
    return _notesBlockWrapperHTML(b,i,canEdit,numCounter);
  }).join('');
}

function _notesBlockWrapperHTML(b,i,canEdit,numCounter){
  const typeSelect=canEdit?`<select onchange="window.notesChangeBlockType(${i},this.value)" style="font-size:11px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;font-family:inherit">${_NOTES_BLOCK_TYPES.map(t=>`<option value="${t.type}"${t.type===b.type?' selected':''}>${t.label}</option>`).join('')}</select>`:'';
  const toolbar=canEdit?`<div class="note-block-toolbar" style="opacity:0;transition:opacity .12s;display:flex;gap:6px;align-items:center;margin-bottom:2px">
    ${typeSelect}
    <button type="button" onclick="window.notesMoveBlock(${i},-1)" title="Move up" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--muted)">↑</button>
    <button type="button" onclick="window.notesMoveBlock(${i},1)" title="Move down" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--muted)">↓</button>
    <button type="button" onclick="window.notesDeleteBlock(${i})" title="Delete block" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--accent-urgent)">✕</button>
  </div>`:'';

  let bodyHTML;
  if(b.type==='divider'){
    bodyHTML='<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">';
  }else if(b.type==='image'){
    bodyHTML=`<div class="note-image-block">
      ${b.imageUrl?`<img src="${_notesEsc(b.imageUrl)}" style="max-width:100%;border-radius:8px;display:block;margin-bottom:6px">`:''}
      ${canEdit?`<input type="file" accept="image/*" onchange="window.notesUploadBlockImage(${i},this)" style="font-size:11px;margin-bottom:4px">`:''}
      <div id="nb-${i}" contenteditable="${!!canEdit}" data-placeholder="Caption (optional)" class="note-block-body" style="font-size:12px;color:var(--muted)" oninput="window.notesBlockInput(${i},this)" onkeydown="window.notesBlockKeydown(event,${i})"></div>
    </div>`;
  }else{
    const align=b.type==='checklist'?'flex-start':'baseline';
    const prefix=b.type==='bullet'?'<span class="note-bullet">•</span>'
      :b.type==='numbered'?`<span class="note-bullet">${numCounter}.</span>`
      :b.type==='checklist'?`<input type="checkbox" ${b.checked?'checked':''} ${canEdit?'':'disabled'} onchange="window.notesToggleCheck(${i},this.checked)" style="margin-right:6px;margin-top:4px">`
      :'';
    const strike=b.type==='checklist'&&b.checked?'text-decoration:line-through;color:var(--muted)':'';
    bodyHTML=`<div style="display:flex;align-items:${align}">${prefix}<div id="nb-${i}" contenteditable="${!!canEdit}" data-placeholder="${_notesEsc(_notesPlaceholder(b.type))}" class="note-block-body note-type-${b.type}" oninput="window.notesBlockInput(${i},this)" onkeydown="window.notesBlockKeydown(event,${i})" style="flex:1;${strike}"></div></div>`;
  }
  return`<div class="note-block" data-idx="${i}">${toolbar}${bodyHTML}</div>`;
}

function _notesHydrateBlocks(){
  _notesEditBlocks.forEach((b,i)=>{
    const el=document.getElementById('nb-'+i);
    if(el)el.textContent=b.text||'';
  });
}

function _notesRerenderBlocks(){
  const c=document.getElementById('notes-blocks');
  if(!c)return;
  c.innerHTML=_notesRenderBlocksHTML(_notesEditBlocks,_notesCanEdit(_notesEditPage));
  _notesHydrateBlocks();
}

function _notesFocusBlock(idx,atEnd){
  const el=document.getElementById('nb-'+idx);
  if(!el)return;
  el.focus();
  try{
    const range=document.createRange(),sel=window.getSelection();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(range);
  }catch(e){}
}

function _notesCaretAtStart(){
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount)return true;
  const range=sel.getRangeAt(0);
  return range.collapsed&&range.startOffset===0;
}

window.notesTitleInput=function(val){
  if(!_notesEditPage)return;
  _notesEditPage.title=val;
  _notesSaveDebounced();
};

window.notesBlockInput=function(i,el){
  if(!_notesEditBlocks[i])return;
  _notesEditBlocks[i].text=el.textContent;
  _notesCheckMarkdownShortcut(i,el);
  _notesSaveDebounced();
};

// Notion-style typing shortcuts: "# " / "## " / "- " / "1. " / "[] " / "> "
// convert the current (empty-of-content) block's type and clear the typed
// prefix; "---" converts to a divider and opens a fresh paragraph after it.
function _notesCheckMarkdownShortcut(i,el){
  const b=_notesEditBlocks[i];
  if(!b||b.type==='image'||b.type==='divider')return;
  const t=el.textContent;
  const map=[[/^#\s$/,'h1'],[/^##\s$/,'h2'],[/^[-*]\s$/,'bullet'],[/^1\.\s$/,'numbered'],[/^\[\]\s$/,'checklist'],[/^>\s$/,'quote']];
  for(const[re,type]of map){
    if(re.test(t)){
      b.type=type;b.text='';
      _notesRerenderBlocks();
      _notesFocusBlock(i,false);
      _notesSaveDebounced();
      return;
    }
  }
  if(/^---$/.test(t)){
    b.type='divider';b.text='';
    _notesEditBlocks.splice(i+1,0,_notesNewBlock('paragraph'));
    _notesRerenderBlocks();
    _notesFocusBlock(i+1,false);
    _notesSaveDebounced();
  }
}

window.notesBlockKeydown=function(ev,i){
  if(ev.key==='Enter'&&!ev.shiftKey){
    ev.preventDefault();
    const b=_notesEditBlocks[i];
    if(!b||b.type==='divider')return;
    const nextType=(b.type==='h1'||b.type==='h2'||b.type==='quote')?'paragraph':b.type;
    _notesEditBlocks.splice(i+1,0,_notesNewBlock(nextType));
    _notesRerenderBlocks();
    _notesFocusBlock(i+1,false);
    _notesSaveDebounced();
  }else if(ev.key==='Backspace'){
    if(_notesCaretAtStart()&&(ev.target.textContent||'')===''&&_notesEditBlocks.length>1){
      ev.preventDefault();
      _notesEditBlocks.splice(i,1);
      _notesRerenderBlocks();
      _notesFocusBlock(Math.max(0,i-1),true);
      _notesSaveDebounced();
    }
  }
};

window.notesChangeBlockType=function(i,type){
  const b=_notesEditBlocks[i];
  if(!b)return;
  b.type=type;
  if(type==='checklist'&&typeof b.checked!=='boolean')b.checked=false;
  _notesRerenderBlocks();
  _notesFocusBlock(i,true);
  _notesSaveDebounced();
};

window.notesMoveBlock=function(i,dir){
  const j=i+dir;
  if(j<0||j>=_notesEditBlocks.length)return;
  const tmp=_notesEditBlocks[i];_notesEditBlocks[i]=_notesEditBlocks[j];_notesEditBlocks[j]=tmp;
  _notesRerenderBlocks();
  _notesFocusBlock(j,true);
  _notesSaveDebounced();
};

window.notesDeleteBlock=function(i){
  if(_notesEditBlocks.length<=1)return;
  _notesEditBlocks.splice(i,1);
  _notesRerenderBlocks();
  _notesFocusBlock(Math.max(0,i-1),true);
  _notesSaveDebounced();
};

window.notesAddBlock=function(){
  _notesEditBlocks.push(_notesNewBlock('paragraph'));
  _notesRerenderBlocks();
  _notesFocusBlock(_notesEditBlocks.length-1,true);
  _notesSaveDebounced();
};

window.notesToggleCheck=function(i,checked){
  const b=_notesEditBlocks[i];
  if(!b)return;
  b.checked=checked;
  _notesRerenderBlocks();
  _notesSaveNow();
};

window.notesUploadBlockImage=async function(i,inputEl){
  const file=inputEl.files&&inputEl.files[0];
  if(!file)return;
  try{
    const url=await uploadToCloudinary(file);
    if(!_notesEditBlocks[i])return;
    _notesEditBlocks[i].imageUrl=url;
    _notesRerenderBlocks();
    _notesSaveNow();
  }catch(e){showToast('Image upload failed: '+(e.message||e),true);}
};

window.notesToggleVisibility=async function(){
  if(!_notesCanEdit(_notesEditPage))return;
  const next=_notesEditPage.visibility==='shared'?'personal':'shared';
  try{
    await updateDoc(doc(db,'notes_pages',_notesEditPage.id),{visibility:next,updatedAt:Date.now()});
    _notesEditPage.visibility=next;
    notesLoaded=false;
    showToast('Visibility updated');
    _notesRenderDetailAndHydrate();
  }catch(e){showToast('Could not update visibility: '+(e.message||e),true);}
};

window.notesDeletePage=async function(){
  if(!_notesEditPage||!_notesCanEdit(_notesEditPage))return;
  if(!confirm('Delete "'+(_notesEditPage.title||'Untitled')+'"? This cannot be undone.'))return;
  try{
    await deleteDoc(doc(db,'notes_pages',_notesEditPage.id));
    notesPages=notesPages.filter(p=>p.id!==_notesEditPage.id);
    logActivity('Note page deleted',`${session.name} deleted "${_notesEditPage.title||'Untitled'}"`);
    showToast('Page deleted');
    _notesEditPage=null;_notesEditBlocks=[];
    window.showPage('notes');
  }catch(e){showToast('Could not delete: '+(e.message||e),true);}
};

function _notesSaveDebounced(){
  clearTimeout(_notesSaveTimer);
  _notesSaveTimer=setTimeout(_notesSaveNow,900);
}

async function _notesSaveNow(){
  clearTimeout(_notesSaveTimer);
  if(!_notesEditPage||!_notesEditPage.id||!_notesCanEdit(_notesEditPage))return;
  try{
    await updateDoc(doc(db,'notes_pages',_notesEditPage.id),{
      title:_notesEditPage.title,
      blocks:_notesEditBlocks,
      updatedAt:Date.now(),
      updatedByName:session.name
    });
    const idx=notesPages.findIndex(p=>p.id===_notesEditPage.id);
    if(idx>-1){notesPages[idx].title=_notesEditPage.title;notesPages[idx].blocks=_notesEditBlocks;notesPages[idx].updatedAt=Date.now();}
  }catch(e){showToast('Could not save note: '+(e.message||e),true);}
}

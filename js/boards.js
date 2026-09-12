/* Groovy Operations — boards.js
   Plain global JS (NO modules), loaded via <script src> after notes.js.
   Firebase globals (db, getDoc, getDocs, setDoc, updateDoc, addDoc,
   deleteDoc, query, where, collection, doc) are bridged onto window by the
   bootstrap module in index.html — see "File architecture" in CLAUDE.md.

   Mood Boards — Phase 2 of the Notion+Milanote module (the Milanote half),
   reached only through the Creative Hub grid (js/notes.js renderCreativeHub),
   not a separate top-level nav entry. Same TEAM/PRIVATE visibility model and
   firestore.rules pattern as Notes (Phase 1): 'shared' boards readable by
   any signed-in user, 'personal' boards readable only by their owner.

   A board is a freeform canvas of cards (image / text / link) connected by
   lines, with independent pan/zoom. One doc per board in `mood_boards`;
   cards + connectors + pan/zoom state are plain fields on the doc (no
   subcollection), same reasoning as notes_pages: simplest thing that works
   at this app's scale, one read/write per board.

   Link cards are manual entry (URL + title + description typed by the
   user) — deliberately NOT an auto-fetched preview. Fetching another site's
   og:title/og:image needs a server-side call (a browser can't read another
   origin's HTML — CORS), which means a new Netlify Function taking a
   user-submitted URL: real SSRF surface (timeouts, blocking internal/
   private addresses, size caps) for a v1 nice-to-have. If auto-preview is
   wanted later, that function is the missing piece — don't build it
   speculatively here. */

// ── State ──
let boardsLoaded=false;
let moodBoards=[];            // merged list: every 'shared' board + the signed-in user's own boards
let _boardsViewingId=null;    // id of the board open in the canvas view
let _editBoard=null;          // {id,title,visibility,ownerUid,ownerName,ownerUsername,zoom,panX,panY}
let _editCards=[];
let _editConnectors=[];
let _boardsSaveTimer=null;
let _boardsCardSeq=0;
let _boardsSelectedCardId=null;

function _boardsEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function _boardsRelTime(ts){
  if(!ts)return'';
  const m=Math.floor((Date.now()-ts)/60000);
  if(m<1)return'just now';
  if(m<60)return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24)return h+'h ago';
  const d=Math.floor(h/24);
  if(d<30)return d+'d ago';
  return new Date(ts).toLocaleDateString('en-GB');
}
function _boardsCanEdit(b){
  return!!(b&&session&&(b.ownerUid===session.uid||session.role==='owner'));
}
function _boardsNewCard(type){
  const id='c'+(++_boardsCardSeq)+'_'+Date.now();
  const base={id,type,x:80,y:80,w:type==='text'?220:170,h:type==='image'?120:type==='link'?120:100};
  if(type==='image')base.imageUrl='';
  if(type==='text')base.text='';
  if(type==='link'){base.linkUrl='';base.linkTitle='';base.linkDesc='';}
  return base;
}

// ── Load (gallery) ──
// Same two-single-field-query, merge-client-side approach as loadNotesData —
// each query maps 1:1 onto a clause of the firestore.rules read condition
// below, so it's always provably safe and never needs a composite index.
async function loadBoardsData(){
  const[sharedSnap,mineSnap]=await Promise.all([
    getDocs(query(collection(db,'mood_boards'),where('visibility','==','shared'))),
    getDocs(query(collection(db,'mood_boards'),where('ownerUid','==',session.uid)))
  ]);
  const map={};
  sharedSnap.forEach(d=>{map[d.id]={id:d.id,...d.data()};});
  mineSnap.forEach(d=>{map[d.id]={id:d.id,...d.data()};});
  moodBoards=Object.values(map).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  boardsLoaded=true;
}

// ── Gallery ──
function renderBoardsGallery(){
  const team=moodBoards.filter(b=>b.visibility==='shared');
  const priv=moodBoards.filter(b=>b.visibility!=='shared');
  return`
  <button class="back-btn" onclick="window.showPage('creative-hub')">← Back to Creative Hub</button>
  <div class="page-head" style="margin-bottom:10px">
    <div><h2 style="margin:0">Mood Boards</h2><div style="color:var(--muted);font-size:12px;margin-top:2px">Drag, resize and connect reference images, notes and links</div></div>
  </div>
  <div class="notes-section">
    <div class="notes-section-head"><h3>TEAM</h3><button class="btn-sm" onclick="window.boardsCreate('shared')">+ New board</button></div>
    ${team.length?`<div class="board-gallery-grid">${team.map(_boardGalleryCardHTML).join('')}</div>`:'<div class="empty">No team boards yet.</div>'}
  </div>
  <div class="notes-section">
    <div class="notes-section-head"><h3>PRIVATE</h3><button class="btn-sm outline" onclick="window.boardsCreate('personal')">+ New board</button></div>
    ${priv.length?`<div class="board-gallery-grid">${priv.map(_boardGalleryCardHTML).join('')}</div>`:'<div class="empty">No private boards yet.</div>'}
  </div>`;
}
function _boardGalleryCardHTML(b){
  const cards=b.cards||[];
  const xs=cards.map(c=>c.x+c.w),ys=cards.map(c=>c.y+c.h);
  const maxX=xs.length?Math.max(...xs)+20:200,maxY=ys.length?Math.max(...ys)+20:120;
  const scale=Math.min(220/maxX,110/maxY,0.6);
  const vis=b.visibility==='shared'?'TEAM':'PRIVATE';
  return`<div class="board-gallery-card" onclick="window.boardsOpen('${b.id}')">
    <div class="board-gallery-thumb">
      <div style="position:absolute;transform:scale(${scale});transform-origin:top left">
        ${cards.map(_boardMiniCardHTML).join('')}
      </div>
    </div>
    <div class="board-gallery-meta">
      <div style="font-weight:600;font-size:13.5px">${_boardsEsc(b.title||'Untitled board')}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${vis} · ${cards.length} card${cards.length===1?'':'s'} · ${_boardsEsc(b.ownerName||'')} · ${_boardsRelTime(b.updatedAt)}</div>
    </div>
  </div>`;
}
function _boardMiniCardHTML(c){
  const base=`position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;border-radius:6px;overflow:hidden;border:1px solid var(--border)`;
  if(c.type==='image')return c.imageUrl?`<div style="${base}"><img src="${_boardsEsc(c.imageUrl)}" style="width:100%;height:100%;object-fit:cover"></div>`:`<div style="${base};background:var(--soft)"></div>`;
  if(c.type==='link')return`<div style="${base};background:var(--soft)"></div>`;
  return`<div style="${base};background:#fff"></div>`;
}
window.boardsCreate=async function(visibility){
  try{
    const ref=await addDoc(collection(db,'mood_boards'),{
      title:'Untitled board',
      visibility:visibility==='shared'?'shared':'personal',
      ownerUid:session.uid,ownerName:session.name,ownerUsername:session.u,
      cards:[],connectors:[],zoom:1,panX:40,panY:30,
      createdAt:Date.now(),updatedAt:Date.now(),updatedByName:session.name
    });
    boardsLoaded=false;
    logActivity('Mood board created',`${session.name} created "${visibility==='shared'?'a team':'a private'}" mood board`);
    _boardsViewingId=ref.id;
    window.showPage('board-canvas');
  }catch(e){showToast('Could not create board: '+(e.message||e),true);}
};
window.boardsOpen=function(id){_boardsViewingId=id;window.showPage('board-canvas');};
window.boardsBack=function(){_boardsSaveNow();window.showPage('boards');};

// ── Canvas ──
async function _boardsOpenCanvas(){
  const m=document.getElementById('main-content');
  let b=moodBoards.find(x=>x.id===_boardsViewingId);
  if(!b){
    m.innerHTML=gvSkeleton(4);
    try{
      const snap=await getDoc(doc(db,'mood_boards',_boardsViewingId));
      if(!snap.exists()){m.innerHTML='<div class="empty">Board not found.</div>';return;}
      b={id:snap.id,...snap.data()};
    }catch(e){m.innerHTML='<div class="empty">Could not load board: '+(e.message||e)+'</div>';return;}
  }
  _editBoard={id:b.id,title:b.title||'Untitled board',visibility:b.visibility||'personal',ownerUid:b.ownerUid,ownerName:b.ownerName,ownerUsername:b.ownerUsername,zoom:b.zoom||1,panX:b.panX||40,panY:b.panY||30};
  _editCards=(b.cards||[]).map(c=>({...c}));
  _editConnectors=(b.connectors||[]).map(cn=>({...cn}));
  _boardsSelectedCardId=null;
  _boardsRenderCanvasAndWire();
}
function _boardsRenderCanvasAndWire(){
  const m=document.getElementById('main-content');
  if(!m)return;
  m.innerHTML=_renderBoardCanvasHTML();
  _boardsApplyTransform();
  _boardsHydrateTextCards();
  _boardsDrawConnectors();
  _boardsWireStagePan();
}
function _renderBoardCanvasHTML(){
  const b=_editBoard;
  if(!b)return'<div class="empty">No board loaded.</div>';
  const canEdit=_boardsCanEdit(b);
  const visLabel=b.visibility==='shared'?'TEAM':'PRIVATE';
  return`<div class="board-canvas-wrap">
    <div class="board-topbar">
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        <button class="back-btn" style="margin:0" onclick="window.boardsBack()">← Boards</button>
        <input type="text" id="board-title-input" value="${_boardsEsc(b.title)}" ${canEdit?'':'readonly'} oninput="window.boardsTitleInput(this.value)" placeholder="Untitled board" style="font-size:14.5px;font-weight:700;border:none;outline:none;font-family:inherit;background:transparent;max-width:240px">
        <span class="pill">${visLabel}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${canEdit?`<button class="tool-btn" onclick="window.boardsToggleVisibility()">Make ${b.visibility==='shared'?'Private':'Team'}</button>`:''}
        <button class="tool-btn" onclick="window.boardsZoomBy(0.85)">−</button>
        <span class="zoom-readout" id="board-zoom-readout">${Math.round(b.zoom*100)}%</span>
        <button class="tool-btn" onclick="window.boardsZoomBy(${1/0.85})">+</button>
        <button class="tool-btn" onclick="window.boardsResetView()">Reset view</button>
        ${canEdit?`<button class="tool-btn" onclick="window.boardsDelete()" style="color:var(--accent-urgent)">Delete</button>`:''}
      </div>
    </div>
    <div class="board-stage" id="board-stage">
      <div class="board-world" id="board-world">
        <svg class="board-conn-layer" id="board-conn-layer" width="4000" height="3000"></svg>
        ${_editCards.map(c=>_boardCardHTML(c,canEdit)).join('')}
      </div>
      ${canEdit?`<div class="board-add-menu">
        <button onclick="window.boardsAddCard('image')">+ Image</button>
        <button onclick="window.boardsAddCard('text')">+ Text</button>
        <button onclick="window.boardsAddCard('link')">+ Link</button>
      </div>`:''}
    </div>
  </div>`;
}
function _boardCardHTML(c,canEdit){
  let body;
  if(c.type==='image'){
    body=c.imageUrl
      ?`<img src="${_boardsEsc(c.imageUrl)}" style="width:100%;height:100%;object-fit:cover;display:block">`
      :canEdit?`<div class="board-card-empty"><input type="file" accept="image/*" onchange="window.boardsUploadImage('${c.id}',this)" style="font-size:11px"></div>`
              :`<div class="board-card-empty">No image</div>`;
    body=`<div class="board-card-body" style="padding:0">${body}</div>`;
  }else if(c.type==='link'){
    body=canEdit
      ?`<div class="board-card-body board-link-edit">
          <input type="text" value="${_boardsEsc(c.linkUrl)}" placeholder="https://…" oninput="window.boardsLinkInput('${c.id}','linkUrl',this.value)">
          <input type="text" value="${_boardsEsc(c.linkTitle)}" placeholder="Title" oninput="window.boardsLinkInput('${c.id}','linkTitle',this.value)">
          <textarea placeholder="Short description (optional)" oninput="window.boardsLinkInput('${c.id}','linkDesc',this.value)">${_boardsEsc(c.linkDesc)}</textarea>
        </div>`
      :`<div class="board-card-body">
          <div class="link-title">${_boardsEsc(c.linkTitle||'Untitled link')}</div>
          <div class="link-desc">${_boardsEsc(c.linkDesc||'')}</div>
          <div class="link-url">${_boardsEsc(c.linkUrl||'')}</div>
        </div>`;
  }else{
    body=`<div class="board-card-body board-text-body" contenteditable="${!!canEdit}" id="board-txt-${c.id}" data-placeholder="Type a note…" oninput="window.boardsTextInput('${c.id}',this)"></div>`;
  }
  const kind=c.type==='image'?'Image':c.type==='link'?'Link':'Note';
  const sel=c.id===_boardsSelectedCardId?' selected':'';
  return`<div class="board-card-el${sel}" id="board-card-${c.id}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px">
    <div class="board-card-head" ${canEdit?`onpointerdown="window.boardsCardDragStart(event,'${c.id}')"`:''}>
      <span class="board-card-kind">${kind}</span>
      ${canEdit?`<button class="board-card-del" onclick="window.boardsDeleteCard('${c.id}')" title="Delete">✕</button>`:''}
    </div>
    ${body}
    ${canEdit?`<div class="board-link-handle" onpointerdown="window.boardsLinkStart(event,'${c.id}')" title="Drag to connect"></div>
    <div class="board-resize-handle" onpointerdown="window.boardsResizeStart(event,'${c.id}')"><svg viewBox="0 0 16 16"><path d="M14 2L2 14M14 8L8 14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></div>`:''}
  </div>`;
}
function _boardsHydrateTextCards(){
  _editCards.forEach(c=>{if(c.type==='text'){const el=document.getElementById('board-txt-'+c.id);if(el)el.textContent=c.text||'';}});
}

// -- pan/zoom --
function _boardsApplyTransform(){
  const b=_editBoard;if(!b)return;
  const w=document.getElementById('board-world');
  if(w)w.style.transform=`translate(${b.panX}px,${b.panY}px) scale(${b.zoom})`;
  const zr=document.getElementById('board-zoom-readout');
  if(zr)zr.textContent=Math.round(b.zoom*100)+'%';
}
window.boardsZoomBy=function(f){const b=_editBoard;if(!b)return;b.zoom=Math.max(0.4,Math.min(2,b.zoom*f));_boardsApplyTransform();_boardsSaveDebounced();};
window.boardsResetView=function(){const b=_editBoard;if(!b)return;b.zoom=1;b.panX=40;b.panY=30;_boardsApplyTransform();_boardsSaveDebounced();};
function _boardsScreenToWorld(clientX,clientY){
  const b=_editBoard;const stage=document.getElementById('board-stage');
  const rect=stage.getBoundingClientRect();
  return{x:(clientX-rect.left-b.panX)/b.zoom,y:(clientY-rect.top-b.panY)/b.zoom};
}
function _boardsWireStagePan(){
  const stage=document.getElementById('board-stage');
  if(!stage)return;
  stage.addEventListener('pointerdown',e=>{
    if(e.target!==stage&&e.target.id!=='board-world')return;
    const b=_editBoard;
    const startX=e.clientX,startY=e.clientY,origX=b.panX,origY=b.panY;
    stage.classList.add('panning');
    stage.setPointerCapture(e.pointerId);
    function move(ev){b.panX=origX+(ev.clientX-startX);b.panY=origY+(ev.clientY-startY);_boardsApplyTransform();}
    function up(){stage.classList.remove('panning');stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',up);_boardsSaveDebounced();}
    stage.addEventListener('pointermove',move);
    stage.addEventListener('pointerup',up);
  });
}

// -- card drag / resize --
window.boardsCardDragStart=function(e,cardId){
  e.stopPropagation();
  const b=_editBoard;const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  _boardsSelectCard(cardId);
  const head=e.currentTarget;
  const startX=e.clientX,startY=e.clientY,origX=c.x,origY=c.y;
  head.setPointerCapture(e.pointerId);
  function move(ev){
    c.x=origX+(ev.clientX-startX)/b.zoom;
    c.y=origY+(ev.clientY-startY)/b.zoom;
    const el=document.getElementById('board-card-'+cardId);
    if(el){el.style.left=c.x+'px';el.style.top=c.y+'px';}
    _boardsUpdateConnectorsFor(cardId);
  }
  function up(){head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);_boardsSaveDebounced();}
  head.addEventListener('pointermove',move);
  head.addEventListener('pointerup',up);
};
window.boardsResizeStart=function(e,cardId){
  e.stopPropagation();
  const b=_editBoard;const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  const startX=e.clientX,startY=e.clientY,origW=c.w,origH=c.h;
  const handle=e.currentTarget;handle.setPointerCapture(e.pointerId);
  function move(ev){
    c.w=Math.max(90,origW+(ev.clientX-startX)/b.zoom);
    c.h=Math.max(60,origH+(ev.clientY-startY)/b.zoom);
    const el=document.getElementById('board-card-'+cardId);
    if(el){el.style.width=c.w+'px';el.style.height=c.h+'px';}
    _boardsUpdateConnectorsFor(cardId);
  }
  function up(){handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);_boardsSaveDebounced();}
  handle.addEventListener('pointermove',move);
  handle.addEventListener('pointerup',up);
};
function _boardsSelectCard(id){
  _boardsSelectedCardId=id;
  document.querySelectorAll('.board-card-el').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));
}

// -- connectors --
function _boardCardCenter(c){return{x:c.x+c.w/2,y:c.y+c.h/2};}
function _boardsDrawConnectors(){
  const svg=document.getElementById('board-conn-layer');if(!svg)return;
  svg.innerHTML=_editConnectors.map(cn=>{
    const from=_editCards.find(c=>c.id===cn.from),to=_editCards.find(c=>c.id===cn.to);
    if(!from||!to)return'';
    const p1=_boardCardCenter(from),p2=_boardCardCenter(to);
    return`<line data-from="${cn.from}" data-to="${cn.to}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" onclick="window.boardsDeleteConnector('${cn.from}','${cn.to}')"/>`;
  }).join('');
}
function _boardsUpdateConnectorsFor(cardId){
  const svg=document.getElementById('board-conn-layer');if(!svg)return;
  const c=_editCards.find(x=>x.id===cardId);if(!c)return;
  const p=_boardCardCenter(c);
  svg.querySelectorAll('line').forEach(line=>{
    if(line.dataset.from===cardId){line.setAttribute('x1',p.x);line.setAttribute('y1',p.y);}
    if(line.dataset.to===cardId){line.setAttribute('x2',p.x);line.setAttribute('y2',p.y);}
  });
}
window.boardsLinkStart=function(e,cardId){
  e.stopPropagation();
  const from=_editCards.find(x=>x.id===cardId);if(!from)return;
  const svg=document.getElementById('board-conn-layer');
  const temp=document.createElementNS('http://www.w3.org/2000/svg','line');
  temp.setAttribute('class','temp');
  const p1=_boardCardCenter(from);
  temp.setAttribute('x1',p1.x);temp.setAttribute('y1',p1.y);temp.setAttribute('x2',p1.x);temp.setAttribute('y2',p1.y);
  svg.appendChild(temp);
  function move(ev){const wp=_boardsScreenToWorld(ev.clientX,ev.clientY);temp.setAttribute('x2',wp.x);temp.setAttribute('y2',wp.y);}
  function up(ev){
    document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
    temp.remove();
    const el=document.elementFromPoint(ev.clientX,ev.clientY);
    const targetEl=el&&el.closest?el.closest('.board-card-el'):null;
    if(targetEl&&targetEl.dataset.id&&targetEl.dataset.id!==cardId){
      const toId=targetEl.dataset.id;
      const exists=_editConnectors.some(cn=>(cn.from===cardId&&cn.to===toId)||(cn.from===toId&&cn.to===cardId));
      if(!exists){_editConnectors.push({from:cardId,to:toId});_boardsDrawConnectors();_boardsSaveDebounced();}
    }
  }
  document.addEventListener('pointermove',move);
  document.addEventListener('pointerup',up);
};
window.boardsDeleteConnector=function(from,to){
  _editConnectors=_editConnectors.filter(cn=>!(cn.from===from&&cn.to===to));
  _boardsDrawConnectors();
  _boardsSaveDebounced();
};

// -- card content --
window.boardsTitleInput=function(val){if(!_editBoard)return;_editBoard.title=val;_boardsSaveDebounced();};
window.boardsTextInput=function(id,el){const c=_editCards.find(x=>x.id===id);if(!c)return;c.text=el.textContent;_boardsSaveDebounced();};
window.boardsLinkInput=function(id,field,val){const c=_editCards.find(x=>x.id===id);if(!c)return;c[field]=val;_boardsSaveDebounced();};
window.boardsUploadImage=async function(id,inputEl){
  const file=inputEl.files&&inputEl.files[0];
  if(!file)return;
  try{
    const url=await uploadToCloudinary(file);
    const c=_editCards.find(x=>x.id===id);if(!c)return;
    c.imageUrl=url;
    _boardsRenderCanvasAndWire();
    _boardsSaveNow();
  }catch(e){showToast('Image upload failed: '+(e.message||e),true);}
};
window.boardsAddCard=function(type){
  const b=_editBoard;if(!b)return;
  const nc=_boardsNewCard(type);
  nc.x=Math.max(20,60-b.panX/b.zoom+80);
  nc.y=Math.max(20,60-b.panY/b.zoom+80);
  _editCards.push(nc);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsDeleteCard=function(id){
  _editCards=_editCards.filter(c=>c.id!==id);
  _editConnectors=_editConnectors.filter(cn=>cn.from!==id&&cn.to!==id);
  _boardsRenderCanvasAndWire();
  _boardsSaveDebounced();
};
window.boardsToggleVisibility=async function(){
  if(!_boardsCanEdit(_editBoard))return;
  const next=_editBoard.visibility==='shared'?'personal':'shared';
  try{
    await updateDoc(doc(db,'mood_boards',_editBoard.id),{visibility:next,updatedAt:Date.now()});
    _editBoard.visibility=next;
    boardsLoaded=false;
    showToast('Visibility updated');
    _boardsRenderCanvasAndWire();
  }catch(e){showToast('Could not update visibility: '+(e.message||e),true);}
};
window.boardsDelete=async function(){
  if(!_editBoard||!_boardsCanEdit(_editBoard))return;
  if(!confirm('Delete "'+(_editBoard.title||'Untitled board')+'"? This cannot be undone.'))return;
  try{
    await deleteDoc(doc(db,'mood_boards',_editBoard.id));
    moodBoards=moodBoards.filter(b=>b.id!==_editBoard.id);
    logActivity('Mood board deleted',`${session.name} deleted "${_editBoard.title||'Untitled board'}"`);
    showToast('Board deleted');
    _editBoard=null;_editCards=[];_editConnectors=[];
    window.showPage('boards');
  }catch(e){showToast('Could not delete: '+(e.message||e),true);}
};

// -- save --
function _boardsSaveDebounced(){clearTimeout(_boardsSaveTimer);_boardsSaveTimer=setTimeout(_boardsSaveNow,900);}
async function _boardsSaveNow(){
  clearTimeout(_boardsSaveTimer);
  if(!_editBoard||!_editBoard.id||!_boardsCanEdit(_editBoard))return;
  try{
    await updateDoc(doc(db,'mood_boards',_editBoard.id),{
      title:_editBoard.title,
      zoom:_editBoard.zoom,panX:_editBoard.panX,panY:_editBoard.panY,
      cards:_editCards,connectors:_editConnectors,
      updatedAt:Date.now(),updatedByName:session.name
    });
    const idx=moodBoards.findIndex(b=>b.id===_editBoard.id);
    if(idx>-1)moodBoards[idx]={...moodBoards[idx],title:_editBoard.title,cards:_editCards,connectors:_editConnectors,updatedAt:Date.now()};
  }catch(e){showToast('Could not save board: '+(e.message||e),true);}
}

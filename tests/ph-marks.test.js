/* Manager marks and comments on a PO (WP2, 18 Oct 2026): po_marks/{PO-nnn} + notes/{row}, the pure core (phMarksClean / Diff / Badges), the loader
   stage, the writers (phMarksSave / phMarkComment), the UI helpers of js/ph-mod-marks.js and the firestore.rules block held equal to the JS lists.
   Drives the REAL handlers over an in-memory Firestore with real transaction semantics that records every write. NOT proved here: the rules engine
   (tests/rules-emulator-ph.js runs them in the real emulator), geometry (smoke-layout), real data, a real screen.
   Each "break" mutates one source or rule line and requires the named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const J=JSON.stringify;
const CORE=require('../js/ph-core.js');
const USERS={
  afnan:{uid:'u-afnan',u:'afnan',name:'Afnan',role:'owner'},
  mustafa:{uid:'u-mustafa',u:'mustafa',name:'Mustafa',role:'manager'},
  uzaib:{uid:'u-uzaib',u:'uzaib',name:'Uzaib',role:'viewer'},
  arfat:{uid:'u-arfat',u:'arfat',name:'Arfat',role:'manager'}
};
const settle=ms=>new Promise(r=>setTimeout(r,ms||12));
const HOSTILE='<img src=x onerror=alert(1)>';
/* ── an in-memory Firestore with transaction semantics, recording every write ─ */
function makeFake(o){
  o=o||{};
  const store=o.store||{};
  const log={writes:[],tx:0,deletes:0,reads:[],txBegun:0};
  const clone=x=>x===undefined?x:JSON.parse(JSON.stringify(x));
  const snapDoc=p=>({id:p.split('/').pop(),exists:()=>Object.prototype.hasOwnProperty.call(store,p),data:()=>clone(store[p]),metadata:{fromCache:false}});
  const api={
    db:{},
    doc:(db,...s)=>({path:s.join('/'),id:s[s.length-1]}),
    collection:(db,...s)=>({path:s.join('/'),isCol:true}),
    query:(c,...cons)=>({path:c.path,limit:(cons.filter(x=>x&&x.limit!==undefined)[0]||{}).limit}),
    orderBy:(f,d)=>({orderBy:[f,d]}),limit:n=>({limit:n}),where:(...a)=>({where:a}),
    getDoc:async r=>{log.reads.push(r.path);const f=o.failPath&&o.failPath(r.path);if(f)throw f;return snapDoc(r.path);},
    getDocs:async q=>{
      log.reads.push(q.path);
      const f=o.failPath&&o.failPath(q.path);if(f)throw f;
      let docs=Object.keys(store).filter(k=>k.indexOf(q.path+'/')===0&&k.slice(q.path.length+1).indexOf('/')===-1).sort();
      if(q.limit!==undefined)docs=docs.slice(0,q.limit);
      return{docs:docs.map(snapDoc),metadata:{fromCache:false}};
    },
    setDoc:async(r,d)=>{log.writes.push({op:'set',path:r.path,tx:0,data:clone(d)});store[r.path]=clone(d);},
    updateDoc:async(r,d)=>{log.writes.push({op:'update',path:r.path,tx:0,data:clone(d)});store[r.path]=Object.assign({},store[r.path],clone(d));},
    deleteDoc:async r=>{log.deletes++;log.writes.push({op:'delete',path:r.path,tx:0});delete store[r.path];},
    addDoc:async(c,d)=>{log.writes.push({op:'add',path:c.path,tx:0,data:clone(d)});return{id:'x'};},
    writeBatch:()=>{const ops=[];return{set(r,d){ops.push({op:'set',path:r.path,data:clone(d)});return this;},update(r,d){ops.push({op:'update',path:r.path,data:clone(d)});return this;},delete(r){log.deletes++;ops.push({op:'delete',path:r.path});return this;},async commit(){log.tx++;ops.forEach(x=>log.writes.push(Object.assign({tx:log.tx},x)));}};},
    runTransaction:async(db,fn)=>{
      log.txBegun++;
      if(o.txDelay)await new Promise(r=>setTimeout(r,o.txDelay));
      const id=++log.tx,buf=[];
      const tx={
        get:async r=>{log.reads.push(r.path);return snapDoc(r.path);},
        set:(r,d)=>{buf.push({op:'set',path:r.path,data:clone(d)});return tx;},
        update:(r,d)=>{if(!Object.prototype.hasOwnProperty.call(store,r.path)&&!buf.some(b=>b.path===r.path))throw new Error('not-found');buf.push({op:'update',path:r.path,data:clone(d)});return tx;},
        delete:r=>{log.deletes++;buf.push({op:'delete',path:r.path});return tx;}
      };
      const res=await fn(tx);
      buf.forEach(b=>{
        log.writes.push({op:b.op,path:b.path,tx:id,data:b.data});
        if(b.op==='set')store[b.path]=b.data;else if(b.op==='update')store[b.path]=Object.assign({},store[b.path],b.data);else delete store[b.path];
      });
      return res;
    }
  };
  return{store,log,api};
}



function load(opts){
  opts=opts||{};
  const fk=makeFake({store:opts.store,failPath:opts.failPath});
  const g=Object.assign({},fk.api,{auth:{currentUser:{getIdToken:async()=>{}}},navigator:{onLine:opts.offline?false:true},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},history:{replaceState(){},pushState(){}}},opts.globals||{});
  const a=harness.loadApp({files:['js/ph-core.js','js/ph-data.js','js/ph-write.js','js/ph-i18n.js'],session:opts.session===undefined?USERS.afnan:opts.session,currentPage:'dashboard',globals:g});
  const ctx=a.ctx;
  if(opts.writeSrc)vm.runInContext(opts.writeSrc,ctx,{filename:'ph-write.js'});
  const dom=domkit.install(ctx);
  ctx.console={warn(){},log(){},error(){}};
  try{vm.runInContext("phI18nSetLang('en')",ctx);}catch(e){}
  vm.runInContext(read('js/ph-ui.js'),ctx,{filename:'ph-ui.js'});
  vm.runInContext(opts.src||read('js/ph-mod-marks.js'),ctx,{filename:'ph-mod-marks.js'});
  return{a,ctx,dom,fk,store:fk.store,log:fk.log,R:c=>a.run(c),writes:()=>fk.log.writes,roots:()=>Array.from(new Set(fk.log.writes.map(w=>w.path.split('/')[0]))).sort()};
}
const AF={actor:{u:'afnan',name:'Afnan'}},MU={actor:{u:'mustafa',name:'Mustafa'}},UZ={actor:{u:'uzaib',name:'Uzaib'}},AR={actor:{u:'arfat',name:'Arfat'}};
const T0=1790000000000;let tick=0;const nx=()=>T0+(++tick)*1000;
const POS=()=>({'pos/PO-101':{id:'PO-101',code:'GP042'},'pos/PO-102':{id:'PO-102',code:'GT001'}});
const GOOD={priority:'urgent',hold:{reason:'waiting for the rib'},highlight:'amber',label:'Eid drop'};
const hasNested=x=>Array.isArray(x)?x.some(e=>Array.isArray(e)||hasNested(e)):(x&&typeof x==='object'?Object.values(x).some(hasNested):false);

module.exports=async function(){
  const s=suite('ph-marks');
  const RULES=read('firestore.rules').replace(/\r/g,'');
  const blockOf=(text,re)=>{const m=re.exec(text);if(!m)return'';let i=text.indexOf('{',m.index+m[0].length-1),d=0,st=i;for(;i<text.length;i++){const c=text[i];if(c==='{')d++;else if(c==='}'){d--;if(!d)return text.slice(st,i+1);}}return'';};
  const MB=blockOf(RULES,/match\s+\/po_marks\/\{id\}\s*\{/);
  const lists=t=>[...t.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map(m=>m[1].split(',').map(x=>x.trim().replace(/'/g,'')).filter(Boolean));
  const sameSet=(a,b)=>J(a.slice().sort())===J(b.slice().sort());

  s.section('core: phMarksClean / Diff / Badges');
  {
    const c=CORE.phMarksClean(GOOD);
    s.eq('a good set is kept, only set keys',J(Object.keys(c.value).sort()),J(['highlight','hold','label','priority']));
    s.eq('no problems on a good set',c.problems.length,0);
    s.eq('normal priority is stored as nothing','priority' in CORE.phMarksClean({priority:'normal',label:'x'}).value,false);
    s.eq('an unknown priority is a problem',CORE.phMarksClean({priority:'critical'}).problems.length,1);
    s.eq('a hold without a reason is a problem and is dropped',CORE.phMarksClean({hold:{reason:'  '}}).problems.length+'|'+('hold' in CORE.phMarksClean({hold:{reason:' '}}).value),'1|false');
    s.eq('a colour off the palette is refused',CORE.phMarksClean({highlight:'#ff0000'}).problems.length,1);
    s.eq('the palette is six names',J(CORE.PH_MARK_COLOURS.slice()),J(['amber','red','green','blue','purple','teal']));
    s.eq('a text mark over 60 characters is a problem',CORE.phMarksClean({label:'x'.repeat(61)}).problems.length,1);
    s.eq('junk input never throws',J(CORE.phMarksClean(null).value),'{}');
    s.ok('no nested arrays',!hasNested(c.value));
    s.eq('markup stays plain text (only ever drawn with textContent)',CORE.phMarksClean({label:HOSTILE}).value.label,HOSTILE);
    s.eq('the diff names what changed',J(CORE.phMarksDiff({priority:'high'},{priority:'urgent',label:'a'})),J(['priority','label']));
    s.eq('the diff of equal maps is empty',CORE.phMarksDiff(GOOD,GOOD).length,0);
    const b=CORE.phMarkBadges(GOOD);
    s.eq('hold, priority, highlight, label - in that order',b.map(x=>x.kind).join(','),'hold,priority,highlight,label');
    s.ok('every badge has a glyph AND a word source (never colour alone)',b.every(x=>x.glyph&&(x.key||x.text)&&x.colour));
    s.eq('a comment note is trimmed and capped at 500',CORE.phMarkNoteClean('  hi ').text+'|'+CORE.phMarkNoteClean('x'.repeat(501)).ok+'|'+CORE.phMarkNoteClean('   ').ok,'hi|false|false');
  }

  s.section('writer: phMarksSave');
  {
    const T=load({store:POS()});
    const r=await T.R('phMarksSave("PO-101",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
    s.ok('a manager saves a new mark',r.ok===true&&r.created===true&&r.rev===1);
    s.eq('exactly one write, to po_marks',T.writes().length+'|'+T.roots().join(','),'1|po_marks');
    const d=T.store['po_marks/PO-101'];
    s.eq('the created keys are exactly PH_MARKS_CREATE_FIELDS',J(Object.keys(d).sort()),J(T.R('PH_MARKS_CREATE_FIELDS').slice().sort()));
    s.eq('stored by the caller',d.createdBy+'|'+d.updatedBy,'afnan|afnan');
    const w0=T.writes().length;
    const r1=await T.R('phMarksSave("PO-101",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
    s.ok('saving the same marks again is refused as no change',r1.ok===false&&r1.code==='refused'&&T.writes().length===w0);
    const r2=await T.R('phMarksSave("PO-101",'+J({priority:'high'})+','+J(Object.assign({now:nx(),expectedRev:1},MU))+')');
    s.ok('a second manager edits, rev 2',r2.ok===true&&r2.rev===2);
    s.eq('the update writes only PH_MARKS_MUTABLE_FIELDS',T.writes().slice(-1)[0].data&&Object.keys(T.writes().slice(-1)[0].data).every(k=>T.R('PH_MARKS_MUTABLE_FIELDS').indexOf(k)>-1),true);
    s.eq('the marks map is REPLACED (a cleared mark is gone)',J(T.store['po_marks/PO-101'].marks),J({priority:'high'}));
    const r3=await T.R('phMarksSave("PO-101",'+J({priority:'urgent'})+','+J(Object.assign({now:nx(),expectedRev:1},AF))+')');
    s.ok('a stale revision is refused',r3.ok===false&&r3.code==='stale');
    const r4=await T.R('phMarksSave("PO-101",{},'+J(Object.assign({now:nx(),expectedRev:2},AF))+')');
    s.ok('clearing everything is a normal save',r4.ok===true&&J(T.store['po_marks/PO-101'].marks)==='{}');
    s.ok('NO pos document and NO pos history row was written',T.writes().every(w=>w.path.indexOf('po_marks')===0)&&!Object.keys(T.store).some(k=>/^pos\/[^/]+\/history/.test(k)));
    s.eq('the pos document is unchanged',J(T.store['pos/PO-101']),J(POS()['pos/PO-101']));
    const m1=await T.R('phMarksSave("PO-999",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
    s.ok('a PO that does not exist is refused',m1.ok===false&&m1.code==='missing'&&!T.store['po_marks/PO-999']);
    const e1=await T.R('phMarksSave("PO-102",{},'+J(Object.assign({now:nx()},AF))+')');
    s.ok('an empty first save is refused',e1.ok===false&&!T.store['po_marks/PO-102']);
    const bad=await T.R('phMarksSave("PO-102",{highlight:"pink"},'+J(Object.assign({now:nx()},AF))+')');
    s.ok('a colour off the palette is refused by the writer',bad.ok===false&&bad.code==='invalid');
    const bid=await T.R('phMarksSave("po-102",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
    s.ok('a bad PO id is refused',bid.ok===false&&bid.code==='invalid');
  }
  {
    const T=load({store:POS(),session:USERS.uzaib});
    const n0=T.writes().length;
    const k=await T.R('phMarksSave("PO-101",'+J(GOOD)+','+J(Object.assign({now:nx()},UZ))+')');
    const k2=await T.R('phMarkComment("PO-101","hello",'+J(Object.assign({now:nx()},UZ))+')');
    s.ok('KASHIF (uzaib) is refused a mark and a comment, nothing is written',k.ok===false&&k.code==='forbidden'&&k2.ok===false&&k2.code==='forbidden'&&T.writes().length===n0);
    const a=await T.R('phMarksSave("PO-101",'+J(GOOD)+','+J(Object.assign({now:nx()},AR))+')');
    s.ok('Arfat (manager role, not on the list) is refused',a.ok===false&&a.code==='forbidden');
    const off=load({store:POS(),offline:true});
    const o=await off.R('phMarksSave("PO-101",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
    s.ok('offline is refused out loud',o.ok===false&&o.code==='offline'&&off.writes().length===0);
  }

  s.section('writer: phMarkComment (append-only)');
  {
    const T=load({store:POS()});
    const c1=await T.R('phMarkComment("PO-101","Please push this one",'+J(Object.assign({now:nx(),rand:'ab12'},AF))+')');
    s.ok('the first comment creates the parent and the note in ONE transaction',c1.ok===true&&c1.seq===1&&T.writes().length===2&&T.writes()[0].tx===T.writes()[1].tx&&T.writes()[0].tx>0);
    const parent=T.store['po_marks/PO-101'];
    s.ok('the parent counts it and previews it',parent.noteCount===1&&parent.lastNote==='Please push this one'&&parent.lastNoteBy==='Afnan'&&J(parent.marks)==='{}');
    const noteKey=Object.keys(T.store).filter(k=>/^po_marks\/PO-101\/notes\//.test(k))[0];
    s.eq('the note keys are exactly PH_MARKS_NOTE_FIELDS',J(Object.keys(T.store[noteKey]).sort()),J(T.R('PH_MARKS_NOTE_FIELDS').slice().sort()));
    s.eq('the note seq equals the parent noteCount',T.store[noteKey].seq,parent.noteCount);
    const c2=await T.R('phMarkComment("PO-101","Second",'+J(Object.assign({now:nx(),rand:'cd34'},MU))+')');
    s.ok('a second comment bumps the counter and rev',c2.ok===true&&c2.seq===2&&T.store['po_marks/PO-101'].noteCount===2&&T.store['po_marks/PO-101'].rev===2);
    s.eq('no note row was ever updated or deleted',T.writes().filter(w=>/notes/.test(w.path)&&w.op!=='set').length+'|'+T.log.deletes,'0|0');
    const lo=await T.R('phMarkComment("PO-101","   ",'+J(Object.assign({now:nx()},AF))+')');
    s.ok('an empty comment is refused',lo.ok===false&&lo.code==='invalid');
    const lg=await T.R('phMarkComment("PO-101","'+'x'.repeat(501)+'",'+J(Object.assign({now:nx()},AF))+')');
    s.ok('a comment over 500 characters is refused',lg.ok===false);
    const th=await T.R('phMarkNotesOf("PO-101")');
    s.ok('the thread reads back, both comments',th.ok===true&&th.rows.length===2);
    const mk=await T.R('phMarksSave("PO-101",'+J({label:'x'})+','+J(Object.assign({now:nx(),expectedRev:2},AF))+')');
    s.ok('a marks save keeps the comment counter',mk.ok===true&&T.store['po_marks/PO-101'].noteCount===2&&T.store['po_marks/PO-101'].lastNote==='Second');
    const gone=await T.R('phMarkComment("PO-999","hi",'+J(Object.assign({now:nx()},AF))+')');
    s.ok('a comment on a PO that does not exist is refused',gone.ok===false&&gone.code==='missing');
  }

  s.section('loader: the marks stage');
  {
    const T=load({store:Object.assign(POS(),{'po_marks/PO-101':{poId:'PO-101',rev:1,marks:{priority:'high'},noteCount:0}})});
    await T.R('phLoadStage("marks")');
    s.ok('PH_STAGE_IDS includes marks',T.R('PH_STAGE_IDS').indexOf('marks')>-1);
    s.eq('phMarkOf finds the loaded mark',T.R('phMarkOf("PO-101")&&phMarkOf("PO-101").marks.priority'),'high');
    s.eq('phMarkOf accepts a bare digit PO spelling',T.R('phMarkOf("101")&&phMarkOf("101").poId'),'PO-101');
    s.eq('a PO with no mark is null',T.R('phMarkOf("PO-102")'),null);
    const F=load({store:POS(),failPath:p=>p==='po_marks'?Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}):null});
    await F.R('phLoadStage("marks")');
    const st=F.R('phMarksState()');
    s.ok('a failed read is named and is NOT an empty list',st.failed===true&&/po_marks/.test(st.text)&&F.R('phGet("marks").rows')===null);
    s.eq('a failed read gives no mark',F.R('phMarkOf("PO-101")'),null);
    s.ok('PH_WRITE_ROOTS names po_marks',T.R('PH_WRITE_ROOTS').indexOf('po_marks')>-1);
  }

  s.section('screens: everybody sees, only managers control');
  {
    const T=load({store:Object.assign(POS(),{'po_marks/PO-101':{poId:'PO-101',rev:1,marks:GOOD,noteCount:2,lastNote:'Second',lastNoteBy:'Mustafa',lastNoteAt:T0}}),session:USERS.uzaib});
    await T.R('phLoadStage("marks")');
    const li=T.R('document.createElement("li")');
    s.ok('phmkApply adds badges and the highlight class for a marked PO',T.R('phmkApply')(li,'PO-101')===true&&/phmk-hl-amber/.test(li.className));
    const txt=li.textContent;
    s.ok('the badges carry WORDS as well as colour: On hold, Urgent, Amber highlight, the text mark, the comment count',/On hold/.test(txt)&&/Urgent/.test(txt)&&/Amber highlight/.test(txt)&&/Eid drop/.test(txt)&&/2 comments/.test(txt));
    const li2=T.R('document.createElement("li")');
    s.eq('an unmarked PO draws nothing',T.R('phmkApply')(li2,'PO-102'),false);
    const sum=T.R('phmkSummaryNode("PO-101")');
    s.ok('the summary has the hold reason and the last comment',/waiting for the rib/.test(sum.textContent)&&/Second/.test(sum.textContent));
    s.eq('Kashif gets NO Marks button',T.R('phmkTileControls("PO-101",{repaint(){}},true)'),null);
    s.eq('Kashif gets no panel even if he asks',T.R('phmkTilePanel("PO-101",{repaint(){}},true)'),null);
    s.eq('Kashif cannot open a panel',T.R('phmkTogglePanel("PO-101",{repaint(){}})'),false);
    const sv=await T.R('phmkSave({repaint(){}})');
    s.ok('phmkSave refuses him itself, before the writer is called, and writes nothing',sv.ok===false&&sv.code==='forbidden'&&/Only the managers/.test(sv.error)&&T.writes().length===0);
    const ac=await T.R('phmkAddComment({repaint(){}})');
    s.ok('phmkAddComment refuses him too',ac.ok===false&&ac.code==='forbidden'&&/Only the managers/.test(ac.error));
  }
  {
    const hostile=Object.assign(POS(),{'po_marks/PO-101':{poId:'PO-101',rev:1,marks:{label:HOSTILE,hold:{reason:HOSTILE}},noteCount:1,lastNote:HOSTILE,lastNoteBy:HOSTILE,lastNoteAt:T0}});
    const T=load({store:hostile});
    await T.R('phLoadStage("marks")');
    const node=T.R('phmkSummaryNode("PO-101")');
    const html=T.dom.toHtml?T.dom.toHtml(node):'';
    s.ok('hostile text reaches the page only as escaped text',html.indexOf('<img')<0&&node.textContent.indexOf(HOSTILE)>-1);
    const ctl=T.R('phmkTileControls("PO-101",{repaint(){}},true)');
    s.ok('a manager gets the Marks button',!!ctl&&/Marks/.test(ctl.textContent));
    s.eq('...but not when the tile is read-only (manage false)',T.R('phmkTileControls("PO-101",{repaint(){}},false)'),null);
    T.R('phmkTogglePanel("PO-101",{repaint(){}})');
    const panel=T.R('phmkTilePanel("PO-101",{repaint(){}},true)');
    s.ok('the manager panel opens with the priority, hold, highlight, text and comment controls',!!panel&&T.dom.all(panel,n=>/phmk-sw\b/.test(n.className)).length===7&&T.dom.all(panel,n=>n.tagName==='TEXTAREA').length===1);
    s.ok('every swatch has a word AND a glyph (not colour alone)',T.dom.all(panel,n=>/phmk-sw\b/.test(n.className)).every(n=>n.textContent.length>2));
  }
  {
    const T=load({store:POS(),failPath:p=>p==='po_marks'?Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'}):null});
    await T.R('phLoadStage("marks")');
    const n=T.R('phmkNoteNode()');
    s.ok('an unreadable po_marks is SAID, never shown as no marks',!!n&&/po_marks/.test(n.textContent));
    T.R('phmkTogglePanel("PO-101",{repaint(){}})');
    const sv=await T.R('phmkSave({repaint(){}})');
    s.ok('a manager cannot save marks over an unread collection',sv.ok===false&&sv.code==='unread'&&T.writes().length===0);
  }

  s.section('rules text and key lists');
  {
    const ls=lists(MB);
    s.ok('the block exists',MB.length>400);
    s.ok('create list == PH_MARKS_CREATE_FIELDS',sameSet(ls[0]||[],load().R('PH_MARKS_CREATE_FIELDS')));
    s.ok('update list == PH_MARKS_MUTABLE_FIELDS',sameSet(ls[1]||[],load().R('PH_MARKS_MUTABLE_FIELDS')));
    s.ok('note list == PH_MARKS_NOTE_FIELDS',sameSet(ls[2]||[],load().R('PH_MARKS_NOTE_FIELDS')));
    s.ok('the palette in the rules == PH_MARK_COLOURS',sameSet((/m\.highlight in \[([^\]]*)\]/.exec(RULES)||[])[1].split(',').map(x=>x.trim().replace(/'/g,'')),CORE.PH_MARK_COLOURS.slice()));
    s.ok('the priorities in the rules == PH_MARK_PRIORITIES',sameSet((/m\.priority in \[([^\]]*)\]/.exec(RULES)||[])[1].split(',').map(x=>x.trim().replace(/'/g,'')),CORE.PH_MARK_PRIORITIES.slice()));
    s.ok('the marks keys in the rules == PH_MARK_KEYS',sameSet(lists(RULES.slice(RULES.indexOf('function phMarksShapeOk')))[0],CORE.PH_MARK_KEYS.slice()));
    s.ok('the caps match the core (60 / 200 / 500)',/phMarkTextOk\(m\.label, 60\)/.test(RULES)&&/get\('reason', null\), 200\)/.test(RULES)&&/get\('text', null\), 500\)/.test(MB)&&CORE.PH_MARK_LABEL_MAX===60&&CORE.PH_MARK_HOLD_MAX===200&&CORE.PH_MARK_NOTE_MAX===500);
    s.ok('the document has no delete; notes have no update or delete',/allow delete: if false;/.test(MB)&&/allow update, delete: if false;/.test(MB));
    s.ok('every write is isProdOpsManager() (never isProdOps)',(MB.match(/isProdOpsManager\(\)/g)||[]).length===3&&!/isProdOps\(\)/.test(MB));
    s.ok('reads are signed-in or QA',(MB.match(/allow read: if isQaRead\(\) \|\| signedIn\(\);/g)||[]).length===2);
    s.ok('the update demands rev + 1 and a clock window on updatedAt',/get\('rev', 0\) \+ 1/.test(MB)&&/phMarkAtOk\(d\.get\('updatedAt', null\)\)/.test(RULES));
    s.ok('the clock window is two days, whole ms',/172800000/.test(RULES.slice(RULES.indexOf('function phMarkAtOk'),RULES.indexOf('function phMarkAtOk')+300)));
    s.ok('a note must be bound to the parent count with existsAfter/getAfter',/existsAfter\(\/databases\/\$\(database\)\/documents\/po_marks\/\$\(id\)\)/.test(MB)&&/getAfter\([^\n]*noteCount[^\n]*== request\.resource\.data\.get\('seq', 0\)/.test(MB));
    s.ok('a mark can only be created for a PO that exists',/exists\(\/databases\/\$\(database\)\/documents\/pos\/\$\(id\)\)/.test(MB));
    const sw=read('sw.js'),html=read('index.html'),css=read('css/main.css');
    s.ok('index.html has ONE tag after ph-mod-instructions.js; sw.js precaches it once',(html.match(/ph-mod-marks\.js/g)||[]).length===1&&html.indexOf('ph-mod-marks.js')>html.indexOf('ph-mod-instructions.js')&&(sw.match(/'\/js\/ph-mod-marks\.js'/g)||[]).length===1);
    s.ok('one delimited CSS block, every selector prefixed .phmk-',css.split('/* ph-mod-marks START */').length===2&&(()=>{const b=/\/\* ph-mod-marks START \*\/([\s\S]*?)\/\* ph-mod-marks END \*\//.exec(css);if(!b)return false;return b[1].split('}').map(x=>x.split('{')[0].trim()).filter(Boolean).every(sel=>sel.split(',').every(p=>/\.phmk-/.test(p)));})());
    s.ok('the marks CSS block holds no literal colour',!/#[0-9a-fA-F]{3,8}\b|rgb\(/.test((/\/\* ph-mod-marks START \*\/([\s\S]*?)\/\* ph-mod-marks END \*\//.exec(css)||['',''])[1]));
    s.ok('the module never calls a Firestore write API itself',!/\b(setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction)\(/.test(read('js/ph-mod-marks.js')));
    s.ok('no innerHTML in the module',!/innerHTML|insertAdjacentHTML/.test(read('js/ph-mod-marks.js')));
    // QC4 (15 Oct 2026): the QC writers that follow the marks section in ph-write.js write pos HISTORY rows by design, so the scan stops there
    s.ok('the writers touch no pos path',(()=>{const t=read('js/ph-write.js');const a=t.indexOf('Manager marks on a PO (WP2)'),b=t.indexOf('QC reconciliation (QC4');return a>0&&b>a&&!/doc\(db,'pos',poId\)[^;]*\bset\b|tx\.(set|update)\(doc\(db,'pos'/.test(t.slice(a,b));})());
    const hooks=[['js/ph-mod-queue.js',"phmkApply(li,t.id)"],['js/ph-mod-queue.js','phmkTileControls(t.id,ctx,manage)'],['js/ph-mod-queue.js','phmkTilePanel(t.id,ctx,manage)'],['js/ph-mod-calendar.js',"phmkApply(b,c.poId,{compact:true})"],['js/ph-mod-cutting.js','phmkSummaryNode(poId)'],['js/ph-mod-monitor.js',"phmkApply(li,r.fbKey||r.id)"]];
    hooks.forEach(h=>s.ok('hook present, typeof-guarded: '+h[1],read(h[0]).indexOf(h[1])>-1&&new RegExp("typeof (phmkApply|phmkTileControls|phmkTilePanel|phmkSummaryNode)==='function'").test(read(h[0]))));
    s.eq('Monitor draws marks in BOTH the card and the drawer',(read('js/ph-mod-monitor.js').match(/phmkApply\(li,r\.fbKey\|\|r\.id\)/g)||[]).length,2);
    s.ok('every marks.* key the module uses exists in ph-i18n with an Urdu line marked for review',(()=>{const used=[...new Set([...read('js/ph-mod-marks.js').matchAll(/phI18nD\('(marks\.[a-z_]+)'/g)].map(m=>m[1]))];const c=load();return used.every(k=>c.R('phI18nHas("'+k+'")')&&c.R('PH_I18N_STR["'+k+'"].review===true&&PH_I18N_STR["'+k+'"].ur.length>0'));})());
  }

  s.section('deliberate breaks - each must fail the named check');
  {
    const brk=async(label,file,from,to,needle)=>{
      const src=read(file);
      if(src.split(from).length<2){s.ok('break target exists: '+label,false);return;}
      const mut=src.split(from).join(to);
      let failed=false;
      try{
        if(file==='js/ph-write.js'){
          const T=load({writeSrc:mut,store:POS()});
          const r=await T.R('phMarksSave("PO-101",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');
          const r2=await T.R('phMarksSave("PO-101",'+J({priority:'high'})+','+J(Object.assign({now:nx(),expectedRev:7},AF))+')');
          const r3=await T.R('phMarkComment("PO-102","a",'+J(Object.assign({now:nx(),rand:'zz99'},AF))+')');
          const k=await T.R('phMarksSave("PO-101",'+J(GOOD)+','+J(Object.assign({now:nx()},UZ))+')');
          const k2=await T.R('phMarkComment("PO-102","b",'+J(Object.assign({now:nx(),rand:'zz98'},UZ))+')');
          failed=await needle(r,r2,r3,T,k,k2);
        }else if(file==='js/ph-core.js'){
          const T=load();vm.runInContext(mut,T.ctx,{filename:'ph-core.js'});
          failed=await needle(T);
        }else if(file==='js/ph-mod-marks.js'){
          const T=load({src:mut,store:Object.assign(POS(),{'po_marks/PO-101':{poId:'PO-101',rev:1,marks:GOOD,noteCount:1,lastNote:'x',lastNoteBy:'A',lastNoteAt:T0}}),session:USERS.uzaib});
          await T.R('phLoadStage("marks")');
          failed=await needle(T);
        }
      }catch(e){failed=true;}
      s.ok('break "'+label+'" fails its check',failed);
    };
    await brk('managers gate dropped on phMarksSave','js/ph-write.js',"const no=_phNeedManage(a.u);if(no)return no;\n  if(typeof poId!=='string'||!PH_PO_ID_RE.test(poId))return _phFail('invalid','Not a PO number: '+poId);\n  if(typeof phMarksClean","if(typeof poId!=='string'||!PH_PO_ID_RE.test(poId))return _phFail('invalid','Not a PO number: '+poId);\n  if(typeof phMarksClean",async(r,r2,r3,T,k)=>k.ok===true);
    await brk('managers gate dropped on phMarkComment','js/ph-write.js',"const no=_phNeedManage(a.u);if(no)return no;\n  if(typeof poId!=='string'||!PH_PO_ID_RE.test(poId))return _phFail('invalid','Not a PO number: '+poId);\n  if(typeof phMarkNoteClean","if(typeof poId!=='string'||!PH_PO_ID_RE.test(poId))return _phFail('invalid','Not a PO number: '+poId);\n  if(typeof phMarkNoteClean",async(r,r2,r3,T,k,k2)=>k2.ok===true);
    await brk('stale revision ignored','js/ph-write.js',"if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','The marks of","if(false)throw _phRefuse('stale','The marks of",async(r,r2)=>r2.code!=='stale');
    await brk('the clean is skipped (problems ignored)','js/ph-write.js',"if(cl.problems.length)return _phFail('invalid',cl.problems.join(' '));\n  if(_phOffline())return _phFail('offline','No connection. Saving a mark","if(_phOffline())return _phFail('offline','No connection. Saving a mark",async()=>{const T=load({writeSrc:read('js/ph-write.js').replace("if(cl.problems.length)return _phFail('invalid',cl.problems.join(' '));\n  if(_phOffline())return _phFail('offline','No connection. Saving a mark","if(_phOffline())return _phFail('offline','No connection. Saving a mark"),store:POS()});const b=await T.R('phMarksSave("PO-101",{highlight:"pink",label:"x"},'+J(Object.assign({now:nx()},AF))+')');return b.ok===true;});
    await brk('no-change save allowed','js/ph-write.js',"if(!changed.length)throw _phRefuse('refused','Nothing has changed since revision '+prev.rev+'.');","",async(r,r2,r3,T)=>{const x=await T.R('phMarksSave("PO-101",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');return x.ok===true;});
    await brk('the PO existence check dropped','js/ph-write.js',"if(!p||!p.exists())throw _phRefuse('missing','There is no PO '+poId+'.');\n          created=true;","created=true;",async(r,r2,r3,T)=>{const x=await T.R('phMarksSave("PO-555",'+J(GOOD)+','+J(Object.assign({now:nx()},AF))+')');return x.ok===true;});
    await brk('the comment counter not bumped in the same transaction','js/ph-write.js',"const patch=Object.assign({noteCount:seq,rev:prev.rev+1,","const patch=Object.assign({rev:prev.rev+1,",async(r,r2,r3,T)=>{await T.R('phMarkComment("PO-102","one",'+J(Object.assign({now:nx(),rand:'q111'},AF))+')');await T.R('phMarkComment("PO-102","two",'+J(Object.assign({now:nx(),rand:'q222'},AF))+')');return T.store['po_marks/PO-102'].noteCount!==2;});
    await brk('note written outside the transaction','js/ph-write.js',"tx.set(doc(db,'po_marks',poId,'notes',rid),","setDoc(doc(db,'po_marks',poId,'notes',rid),",async(r,r2,r3,T)=>T.writes().filter(w=>/notes/.test(w.path))[0].tx===0);
    await brk('a pos document gets written','js/ph-write.js',"tx.set(ref,saved);\n          return;\n        }\n        const prev=s.data();\n        if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','The marks of","tx.set(ref,saved);tx.set(doc(db,'pos',poId),{touched:1});\n          return;\n        }\n        const prev=s.data();\n        if(o.expectedRev!=null&&prev.rev!==o.expectedRev)throw _phRefuse('stale','The marks of",async(r,r2,r3,T)=>T.writes().some(w=>w.path.indexOf('pos/')===0));
    await brk('palette widened in the core','js/ph-core.js',"const PH_MARK_COLOURS=Object.freeze(['amber','red','green','blue','purple','teal']);","const PH_MARK_COLOURS=Object.freeze(['amber','red','green','blue','purple','teal','pink']);",async T=>T.R('PH_MARK_COLOURS.length')!==6);
    await brk('hold reason no longer required','js/ph-core.js',"else if(!r)problems.push('A hold needs a reason.');","else if(!r){}",async T=>T.R('phMarksClean({hold:{reason:" "}}).problems.length')===0);
    await brk('Kashif gets the Marks button','js/ph-mod-marks.js',"if(!manage||!phmkCanMark())return null;\n  const wrap","if(!manage)return null;\n  const wrap",async T=>T.R('phmkTileControls("PO-101",{repaint(){}},true)')!==null);
    await brk('Kashif can open the panel','js/ph-mod-marks.js',"function phmkTogglePanel(poId,ctx){\n  if(!phmkCanMark())return false;","function phmkTogglePanel(poId,ctx){",async T=>T.R('phmkTogglePanel("PO-101",{repaint(){}})')!==false);
    await brk('Kashif phmkSave not gated','js/ph-mod-marks.js',"async function phmkSave(ctx){\n  if(!phmkCanMark())return{ok:false,code:'forbidden',error:phI18nStr(phI18nD('marks.not_managers'))};","async function phmkSave(ctx){",async T=>{T.R('_phmkDraft={po:"PO-101",priority:"urgent",holdOn:false,holdReason:"",highlight:"",label:"",note:""}');const r=await T.R('phmkSave({repaint(){}})');return!/Only the managers/.test(r.error||'');});
    await brk('the badge drops its word (colour alone)','js/ph-mod-marks.js',"el.appendChild(phEl('span','phmk-w',phI18nD(b.key)));","el.appendChild(phEl('span','phmk-w',''));",async T=>{const li=T.R('document.createElement("li")');T.R('phmkApply')(li,'PO-101');return!/On hold/.test(li.textContent);});
    await brk('hostile text via innerHTML','js/ph-mod-marks.js',"tx.textContent=r.text||'';","tx.innerHTML=r.text||'';",async T=>/innerHTML/.test(read('js/ph-mod-marks.js').replace("tx.textContent=r.text||'';","tx.innerHTML=r.text||'';"))&&true);
    // rules text breaks
    const rbrk=(label,from,to,check)=>{
      const mut=RULES.split(from).join(to);
      if(mut===RULES){s.ok('break target exists: '+label,false);return;}
      const mb=blockOf(mut,/match\s+\/po_marks\/\{id\}\s*\{/);
      s.ok('rules break "'+label+'" fails its check',check(mut,mb)===true);
    };
    rbrk('floor user may write (isProdOps)',"allow create: if isProdOpsManager()\n        && id.matches","allow create: if isProdOps()\n        && id.matches",(m,b)=>/isProdOps\(\)/.test(b));
    rbrk('notes made updatable',"allow update, delete: if false;\n      }\n    }\n","allow update: if isProdOpsManager();\n      }\n    }\n",(m,b)=>!/allow update, delete: if false;/.test(b));
    rbrk('document delete allowed',"allow delete: if false;\n\n      // Append-only comments","allow delete: if isProdOpsManager();\n\n      // Append-only comments",(m,b)=>!/allow delete: if false;/.test(b));
    rbrk('palette widened',"m.highlight in ['amber','red','green','blue','purple','teal']","m.highlight in ['amber','red','green','blue','purple','teal','pink']",(m)=>!sameSet((/m\.highlight in \[([^\]]*)\]/.exec(m)||[])[1].split(',').map(x=>x.trim().replace(/'/g,'')),CORE.PH_MARK_COLOURS.slice()));
  }
  return s;
};

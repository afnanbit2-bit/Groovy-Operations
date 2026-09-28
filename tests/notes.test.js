/* ─────────────────────────────────────────────────────────────────────────
   Notes — the "/" menu, the block gutter, and the placeholder rule
   (Sept 2026 revamp). The per-block type <select> and the ↑ ↓ ✕ toolbar are
   gone; typing "/" lists the block types, "+" adds below, and a small menu
   holds Turn into / Move / Duplicate / Delete.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');
const fs=require('fs');
const path=require('path');

module.exports=async function(){
  const s=suite('notes');
  const app=loadApp({files:['js/notes.js']});
  const {run}=app;
  const eq=(label,a,b)=>s.eq(label,JSON.stringify(a),JSON.stringify(b));
  const J=x=>JSON.parse(run('JSON.stringify('+x+')'));
  run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
    _notesEditPage={id:'P',title:'T',visibility:'personal',ownerUid:'u1'};
    window._gvSilentSaveStart=()=>{};window._gvSilentSaveStop=()=>{};`);
  const setBlocks=b=>run('_notesEditBlocks='+JSON.stringify(b));
  const blk=(type,text)=>({id:'x'+Math.random(),type:type||'paragraph',text:text||'',checked:false,imageUrl:''});
  // Type into block i the way the browser would, then fire the real handler.
  const type=(i,text)=>{const el=app.el('nb-'+i);el.textContent=text;run(`window.notesBlockInput(${i},document.getElementById('nb-${i}'))`);};
  const key=(i,k)=>JSON.parse(run(`(function(){let p=false;window.notesBlockKeydown({key:${JSON.stringify(k)},shiftKey:false,target:document.getElementById('nb-${i}'),preventDefault(){p=true;}},${i});return JSON.stringify({p:p})})()`)).p;
  const types=()=>J('_notesEditBlocks.map(b=>b.type)');

  s.section('what opens the menu');
  const m=t=>J(`_notesSlashMatch(${JSON.stringify(t)})`);
  eq('"/" alone opens it with an empty query',m('/'),'');
  eq('"/head" narrows to "head"',m('/head'),'head');
  eq('the query is lower-cased',m('/HEAD'),'head');
  eq('a slash mid-sentence is just a slash',m('and/or'),null);
  eq('a space ends it',m('/a b'),null);
  eq('plain text does not open it',m('hello'),null);
  eq('an empty block does not open it',m(''),null);

  s.section('what it lists');
  const names=(q,o)=>J(`_notesSlashItems(${JSON.stringify(q)},${JSON.stringify(o||{})}).map(t=>t.type)`);
  eq('every type with no query',names('').length,9);
  eq('a label prefix ranks first',names('head'),['h1','h2']);
  eq('an alias finds Checklist ("todo")',names('todo'),['checklist']);
  eq('an alias finds Divider ("line")',names('line')[0],'divider');
  eq('"list" finds all three list types',names('list').sort(),['bullet','checklist','numbered'].sort().filter(x=>names('list').includes(x)));
  eq('nothing matches nonsense',names('zzzz'),[]);
  eq('Turn into on a block with words hides Divider',names('',{hasText:true}).includes('divider'),false);
  eq('and keeps every other type',names('',{hasText:true}).length,8);

  s.section('typing "/" in a block, then choosing');
  setBlocks([blk('paragraph','')]);
  type(0,'/head');
  eq('the menu is open on that block',J('_notesSlash&&_notesSlash.idx'),0);
  eq('narrowed to two headings',J('_notesSlash.items.map(t=>t.type)'),['h1','h2']);
  eq('the popover carries those rows',J('_notesPopState.rows.map(r=>r.label)'),['Heading 1','Heading 2']);
  eq('ArrowDown is taken by the menu',key(0,'ArrowDown'),true);
  eq('and moves the highlight',J('_notesSlash.sel'),1);
  eq('Enter is taken by the menu',key(0,'Enter'),true);
  eq('the block became a Heading 2',types(),['h2']);
  eq('the typed "/head" is not left in the block',J('_notesEditBlocks[0].text'),'');
  eq('and no extra block was made by that Enter',J('_notesEditBlocks.length'),1);
  eq('the menu is closed afterwards',J('_notesSlash'),null);

  s.section('Enter with the menu open must not also split the block');
  setBlocks([blk('paragraph','')]);
  type(0,'/');
  key(0,'Enter');
  eq('choosing the first item (Text) added no block',J('_notesEditBlocks.length'),1);

  s.section('Escape closes it and keeps the typing');
  setBlocks([blk('paragraph','')]);
  type(0,'/che');
  eq('open',J('!!_notesSlash'),true);
  eq('Escape is taken',key(0,'Escape'),true);
  eq('closed',J('_notesSlash'),null);
  eq('the typed text stays',J('_notesEditBlocks[0].text'),'/che');
  eq('and the block is unchanged',types(),['paragraph']);

  s.section('no match: the menu steps aside and Enter is an ordinary Enter');
  setBlocks([blk('paragraph','')]);
  type(0,'/zzzz');
  eq('no menu when nothing matches',J('_notesSlash'),null);
  eq('Enter is left to the editor',key(0,'Enter'),true);   // its own handler prevents default too
  eq('and it split the block as usual',J('_notesEditBlocks.length'),2);

  s.section('Divider opens a fresh paragraph after it');
  setBlocks([blk('paragraph','')]);
  type(0,'/divider');
  key(0,'Enter');
  eq('divider, then a paragraph',types(),['divider','paragraph']);

  s.section('Checklist gets a checked flag');
  setBlocks([blk('paragraph','')]);
  type(0,'/todo');
  key(0,'Enter');
  eq('a checklist',types(),['checklist']);
  eq('unticked',J('_notesEditBlocks[0].checked'),false);

  s.section('an image or divider block never opens it');
  setBlocks([blk('image','')]);
  type(0,'/');
  eq('caption text starting with "/" is just text',J('_notesSlash'),null);

  s.section('the + button');
  setBlocks([blk('paragraph','hello')]);
  run(`window.notesAddBelow(0,null)`);
  eq('adds a block below a block with words',types(),['paragraph','paragraph']);
  eq('and opens the menu on the new one',J('_notesSlash&&_notesSlash.idx'),1);
  eq('in insert mode, so nothing typed is cleared',J('_notesSlash.mode'),'insert');
  setBlocks([blk('paragraph','')]);
  run(`window.notesAddBelow(0,null)`);
  eq('an empty paragraph is reused, not stacked',J('_notesEditBlocks.length'),1);

  s.section('the block menu');
  setBlocks([blk('paragraph','a'),blk('paragraph','b'),blk('paragraph','c')]);
  run(`window.notesOpenBlockMenu(1,null)`);
  eq('a middle block offers everything',J('_notesPopState.rows.map(r=>r.label)'),['Turn into…','Move up','Move down','Duplicate','Delete']);
  run(`window.notesOpenBlockMenu(0,null)`);
  eq('the first block cannot move up',J('_notesPopState.rows.map(r=>r.label).includes("Move up")'),false);
  run(`window.notesOpenBlockMenu(2,null)`);
  eq('the last block cannot move down',J('_notesPopState.rows.map(r=>r.label).includes("Move down")'),false);
  setBlocks([blk('paragraph','only')]);
  run(`window.notesOpenBlockMenu(0,null)`);
  eq('a lone block cannot be deleted',J('_notesPopState.rows.map(r=>r.label).includes("Delete")'),false);
  setBlocks([blk('paragraph','a'),blk('paragraph','b')]);
  run(`window.notesOpenBlockMenu(0,null);_notesPopState.rows.find(r=>r.label==='Move down').run()`);
  eq('Move down swaps',J('_notesEditBlocks.map(b=>b.text)'),['b','a']);
  run(`window.notesOpenBlockMenu(0,null);_notesPopState.rows.find(r=>r.label==='Duplicate').run()`);
  eq('Duplicate inserts a copy after',J('_notesEditBlocks.map(b=>b.text)'),['b','b','a']);
  eq('with its own id',J('_notesEditBlocks[0].id!==_notesEditBlocks[1].id'),true);
  run(`window.notesOpenBlockMenu(0,null);_notesPopState.rows.find(r=>r.label==='Turn into…').run()`);
  eq('Turn into opens the type list in turn mode',J('_notesSlash.mode'),'turn');
  eq('without Divider, since the block has words',J('_notesSlash.items.some(t=>t.type==="divider")'),false);
  run(`_notesSlashChoose('h1')`);
  eq('turning keeps the words',J('_notesEditBlocks[0].text'),'b');
  eq('and changes the type',types()[0],'h1');

  s.section('markup');
  const html=(canEdit)=>run(`_notesBlockWrapperHTML({id:'q',type:'paragraph',text:'<img src=x onerror=alert(1)>',checked:false},0,${canEdit},0,false)`);
  eq('an editor gets the gutter',/note-gutter/.test(html(true)),true);
  eq('a read-only viewer does not',/note-gutter/.test(html(false)),false);
  eq('both gutter buttons are named',(html(true).match(/aria-label="(Add a block below|Block options)"/g)||[]).length,2);
  eq('the body is a named textbox',/role="textbox"[^>]*aria-label="Text"/.test(html(true)),true);
  eq('block text is never in the markup (hydrated with textContent)',/onerror/.test(html(true)),false);
  eq('a lone empty block is marked for the always-on hint',/note-only/.test(run(`_notesBlockWrapperHTML({id:'q',type:'paragraph',text:''},0,true,0,true)`)),true);
  eq('a block among others is not',/note-only/.test(run(`_notesBlockWrapperHTML({id:'q',type:'paragraph',text:''},0,true,0,false)`)),false);
  eq('the old per-block <select> is gone',/<select/.test(html(true)),false);
  eq('the paragraph hint teaches the menu',run(`_notesPlaceholder('paragraph')`),"Type '/' for commands");

  s.section('the popover is built without HTML strings');
  const src=fs.readFileSync(path.join(__dirname,'..','js','notes.js'),'utf8');
  const popFn=src.slice(src.indexOf('function _notesPopShow'),src.indexOf('function _notesPopClose'));
  eq('labels go in through textContent',/textContent=r\.label/.test(popFn),true);
  eq('and never through innerHTML',/innerHTML\s*=\s*[^'"\s]/.test(popFn.replace("p.innerHTML=''","")),false);
  eq('its document listeners are registered once',/__notesPopWired/.test(src),true);

  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   Mood Boards — the address bar names the open board (GitHub #97, bug 9).
   A reload used to drop you on the app's first page: nothing but a pasted
   link ever put a board in the URL. Opening a board now writes
   #board=<id> (replaceState — no history entry, no hashchange) and leaving
   the canvas clears it, so the existing deep-link consumer brings a reload
   straight back to the board.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

module.exports=async function(){
  const s=suite('board-hash');
  const app=loadApp({files:['js/boards.js']});
  const {run}=app;
  run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner'};
    history={calls:[],replaceState(a,b,u){this.calls.push(u);const i=u.indexOf('#');location.hash=i<0?'':u.slice(i);}};
    location.search='';`);
  const hash=()=>run(`location.hash`);
  const calls=()=>run(`history.calls.length`);

  s.section('writing and clearing');
  run(`_boardsSetHash('B1')`);
  s.eq('opening a board names it',hash(),'#board=B1');
  run(`_boardsSetHash('B1')`);
  s.eq('the same board again writes nothing',calls(),1);
  s.eq('what is written is what the reload reads back',run(`JSON.stringify(_boardsParseHash())`),JSON.stringify({board:'B1',card:null}));
  run(`_boardsSetHash('a b/c')`);
  s.eq('an id is encoded',hash(),'#board=a%20b%2Fc');
  s.eq('and read back intact',run(`_boardsParseHash().board`),'a b/c');
  run(`_boardsSetHash(null)`);
  s.eq('leaving clears it',hash(),'');
  run(`location.hash='#pattern=P7';history.calls=[]`);
  run(`_boardsSetHash(null)`);
  s.eq('another module\'s hash is never cleared',hash(),'#pattern=P7');
  s.eq('and nothing was written',calls(),0);

  s.section('leaving the canvas by any route clears it');
  run(`location.hash='#board=B1';currentPage='board-canvas';_editBoard=null;`);
  await run(`window.showPage('dashboard')`);
  s.eq('the hash is gone',hash(),'');
  run(`location.hash='#board=B1';currentPage='boards';`);
  await run(`window.showPage('dashboard')`);
  s.eq('a page that is not the canvas leaves a pasted link alone',hash(),'#board=B1');

  s.section('the open path writes it');
  const src=require('fs').readFileSync(require('path').join(__dirname,'..','js','boards.js'),'utf8');
  const open=(src.match(/async function _boardsOpenCanvas\(\)\{[\s\S]*?\n\}/)||[''])[0];
  s.ok('_boardsOpenCanvas names the board it opens',/_boardsSetHash\(b\.id\)/.test(open));
  s.ok('a board that is gone clears it, or every reload would say "not found"',/snap\.exists\(\)\)\{_boardsSetHash\(null\)/.test(open));
  return s;
};

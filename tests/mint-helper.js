/* Test helper (not a suite): puts the REAL mintNextIdInTx / createWithNextId from
   js/shared.js into an app that loads js/gatepass.js and js/fabric.js WITHOUT
   shared.js (loading shared.js would shadow the harness's showToast, so
   state.toasts would stay empty — see CLAUDE.md, "The Board" Phase 2). The source
   is sliced out of the real file, never re-typed, so a test exercises production
   code. A missing function is a loud error, not a silent no-op. */
'use strict';
const fs=require('fs'),path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','js','shared.js'),'utf8');

function fnSource(name){
  const start=SRC.indexOf('async function '+name+'(');
  if(start<0)throw new Error('mint-helper: '+name+' not found in js/shared.js');
  const open=SRC.indexOf('{',SRC.indexOf(')',start));
  let depth=0;
  for(let i=open;i<SRC.length;i++){
    const c=SRC[i];
    if(c==='{')depth++;
    else if(c==='}'){depth--;if(depth===0)return SRC.slice(start,i+1);}
  }
  throw new Error('mint-helper: unbalanced braces in '+name);
}

function installMint(app){
  app.run(fnSource('mintNextIdInTx')+'\n'+fnSource('createWithNextId')+'\nglobalThis.mintNextIdInTx=mintNextIdInTx;globalThis.createWithNextId=createWithNextId;');
  return app;
}
module.exports={installMint,fnSource};

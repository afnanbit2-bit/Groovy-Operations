/* ─────────────────────────────────────────────────────────────────────────
   js/env.js — which Firebase does this page talk to? (QA debug access)

   Loaded right after js/diagnostics.js, BEFORE everything else, because the
   module bootstrap in index.html and the REST base in js/store.js both read
   window.__GV_ENV at load time.

   THE RULES, and they are deliberately narrow:
   · The emulator is an OPT-IN, and it only exists on a LOCAL hostname
     (localhost / 127.0.0.1 / ::1). On groovyoperations.netlify.app the
     switch is inert whatever the query string says, so nobody can be
     diverted to a dead localhost by a pasted link, and nothing shipped to
     production changes behaviour.
   · Turn it on with  http://localhost:8000/?env=emulator  and off with
     ?env=live. The choice lasts for the TAB (sessionStorage) so navigating
     inside the app keeps it; a new tab starts on live, exactly as local
     development always did.
   · Emulator mode uses a demo- project id and a fake API key. There is no
     credential in it that means anything to groovy-gatepass, so a mistake
     here fails closed instead of reaching live.
   · A red bar says so, on every page, for as long as it is on.
   Emulator ports match firebase.json (firestore 8080, auth 9099, database
   9000). Start them with:  npm run emulators
   ───────────────────────────────────────────────────────────────────────── */
(function(){
  var LIVE_PROJECT='groovy-gatepass';
  var EMU_PROJECT='demo-groovy-ops';
  var host=(location&&location.hostname)||'';
  var local=host==='localhost'||host==='127.0.0.1'||host==='::1'||host==='[::1]';
  var asked=null,kept=null;
  try{var m=/[?&]env=(emulator|live)(?:&|#|$)/.exec(location.search||'');if(m)asked=m[1];}catch(e){}
  try{kept=window.sessionStorage.getItem('gv-env');}catch(e){}
  var want=asked||kept;
  var emulator=local&&want==='emulator';
  // Remember the choice for this tab only, and only on a local host.
  if(local&&asked){try{window.sessionStorage.setItem('gv-env',asked);}catch(e){}}
  var E={
    mode:emulator?'emulator':'live',
    projectId:emulator?EMU_PROJECT:LIVE_PROJECT,
    firestore:{host:'127.0.0.1',port:8080},
    auth:{url:'http://127.0.0.1:9099'},
    rtdb:{host:'127.0.0.1',port:9000}
  };
  // The Firestore REST base js/store.js uses (it talks REST, not the SDK).
  E.restBase=emulator
    ?'http://'+E.firestore.host+':'+E.firestore.port+'/v1/projects/'+EMU_PROJECT+'/databases/(default)/documents'
    :'https://firestore.googleapis.com/v1/projects/'+LIVE_PROJECT+'/databases/(default)/documents';
  window.__GV_ENV=E;

  if(emulator){
    var bar=function(){
      if(!document.body||document.getElementById('gv-env-bar'))return;
      var d=document.createElement('div');
      d.id='gv-env-bar';
      d.textContent='EMULATOR — '+EMU_PROJECT+' — nothing here touches the live database';
      d.setAttribute('style','position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#b91c1c;color:#fff;font:600 12px/18px system-ui,sans-serif;text-align:center;padding:1px 8px;pointer-events:none');
      document.body.appendChild(d);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bar);else bar();
  }
})();

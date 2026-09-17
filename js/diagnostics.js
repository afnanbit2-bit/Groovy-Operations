/* ─────────────────────────────────────────────────────────────────────────
   Diagnostics — never show a blank screen again (Sept 2026)

   This exists because of a real incident: a white screen after login on a
   phone. The app was broken and the only thing on screen was a topbar. On
   Android there is no console without a cable and a laptop, so the only way
   to find out what happened was to reproduce it somewhere else.

   Three things, all defensive, all dependency-free:

   1. EVERY uncaught error and rejection is recorded (the earliest ones by a
      tiny inline snippet in index.html's <head>, which runs before any
      script tag — including before this file, so a script that fails to
      LOAD is still captured).
   2. A WATCHDOG. If the app shell is up but the page body is still empty
      after _GV_DIAG_STALL ms, something has hung and the user is looking at
      nothing. Rather than leave them there, show what happened.
   3. A RESET button. A phone stuck on a bad cached build cannot be fixed by
      reloading — the service worker keeps serving the old files. This
      clears every cache, unregisters the worker and reloads.

   The panel is deliberately plain HTML with inline styles: it has to work
   when css/main.css itself might be the thing that failed.
   ───────────────────────────────────────────────────────────────────────── */
(function(){
  'use strict';

  var _GV_DIAG_STALL=12000;      // how long an empty page is allowed to sit
  var _gvDiagShown=false;

  // The inline snippet in <head> seeds this. If it is missing (an old cached
  // index.html), start one here so nothing below has to check.
  window.__gvErrors=window.__gvErrors||[];

  function note(kind,msg,extra){
    try{
      window.__gvErrors.push({
        kind:kind,msg:String(msg==null?'':msg).slice(0,500),
        at:new Date().toISOString(),extra:extra?String(extra).slice(0,300):''
      });
      if(window.__gvErrors.length>40)window.__gvErrors.shift();
    }catch(e){}
  }

  window.addEventListener('error',function(e){
    // A failed <script>/<img>/<link> fires an error event on the ELEMENT and
    // carries no message — that is how a missing vendored library shows up.
    if(e&&e.target&&e.target!==window&&(e.target.src||e.target.href)){
      note('load-failed',(e.target.tagName||'?')+' failed to load',e.target.src||e.target.href);
      return;
    }
    note('error',e&&e.message,(e&&e.filename?String(e.filename).split('/').pop()+':'+e.lineno:''));
  },true);

  window.addEventListener('unhandledrejection',function(e){
    var r=e&&e.reason;
    note('rejection',r&&r.message?r.message:r,r&&r.code?r.code:'');
  });

  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g,function(c){
      return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function swState(){
    try{
      if(!('serviceWorker' in navigator))return 'unsupported';
      return navigator.serviceWorker.controller?'active':'none';
    }catch(e){return 'unknown';}
  }

  function details(){
    var lines=[];
    lines.push('app: '+(window.__GV_BUILD||'unknown'));
    lines.push('sw: '+swState());
    lines.push('online: '+(navigator.onLine?'yes':'no'));
    lines.push('signed in as: '+(typeof session!=='undefined'&&session?(session.u||'?'):'not signed in'));
    lines.push('screen: '+(window.innerWidth||'?')+'x'+(window.innerHeight||'?'));
    lines.push('page: '+(typeof currentPage!=='undefined'?currentPage:'?'));
    lines.push('ua: '+String(navigator.userAgent||'').slice(0,160));
    lines.push('');
    if(!window.__gvErrors.length)lines.push('No JavaScript errors were recorded.');
    else window.__gvErrors.forEach(function(e,i){
      lines.push((i+1)+'. ['+e.kind+'] '+e.msg+(e.extra?'  ('+e.extra+')':''));
    });
    return lines.join('\n');
  }

  // ── the panel ──
  function show(reason){
    if(_gvDiagShown)return;
    _gvDiagShown=true;
    var txt=details();
    var el=document.createElement('div');
    el.id='gv-diag';
    el.setAttribute('style','position:fixed;inset:0;z-index:99999;background:#fff;color:#111;'+
      'font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:18px;'+
      'overflow:auto;-webkit-overflow-scrolling:touch');
    el.innerHTML=
      '<div style="max-width:620px;margin:0 auto">'+
      '<div style="font-size:19px;font-weight:700;margin-bottom:6px">Groovy Operations didn’t finish loading</div>'+
      '<div style="color:#6B6B6B;margin-bottom:16px">'+esc(reason)+'</div>'+
      '<button id="gv-diag-retry" style="width:100%;padding:13px;margin-bottom:8px;border:1px solid #111;'+
        'background:#111;color:#fff;border-radius:10px;font:inherit;font-weight:600;cursor:pointer">Reload the page</button>'+
      '<button id="gv-diag-reset" style="width:100%;padding:13px;margin-bottom:8px;border:1px solid #111;'+
        'background:#fff;color:#111;border-radius:10px;font:inherit;font-weight:600;cursor:pointer">Clear the app cache and reload</button>'+
      '<div style="font-size:13px;color:#6B6B6B;margin-bottom:16px">Use the second button if reloading doesn’t help — '+
        'your phone may be holding an old copy of the app. Nothing you’ve saved is affected.</div>'+
      '<button id="gv-diag-copy" style="width:100%;padding:11px;margin-bottom:14px;border:1px solid #D9D9D9;'+
        'background:#fff;color:#111;border-radius:10px;font:inherit;cursor:pointer">Copy details to send to Claude</button>'+
      '<div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6B6B6B;margin-bottom:6px">Details</div>'+
      '<pre id="gv-diag-pre" style="white-space:pre-wrap;word-break:break-word;background:#F4F4F4;border:1px solid #D9D9D9;'+
        'border-radius:10px;padding:12px;font-size:12.5px;margin:0"></pre>'+
      '</div>';
    document.body.appendChild(el);
    // The details are written in as TEXT, never interpolated — an error
    // message can contain anything, including markup from a failed URL.
    var pre=document.getElementById('gv-diag-pre');
    if(pre)pre.textContent=txt;

    var r=document.getElementById('gv-diag-retry');
    if(r)r.onclick=function(){location.reload();};

    var c=document.getElementById('gv-diag-copy');
    if(c)c.onclick=function(){
      try{
        navigator.clipboard.writeText(txt).then(function(){c.textContent='Copied';},function(){fallbackCopy(txt,c);});
      }catch(e){fallbackCopy(txt,c);}
    };

    var rs=document.getElementById('gv-diag-reset');
    if(rs)rs.onclick=function(){
      rs.textContent='Clearing…';rs.disabled=true;
      resetApp().then(function(){location.reload(true);},function(){location.reload(true);});
    };
  }

  function fallbackCopy(txt,btn){
    try{
      var ta=document.createElement('textarea');
      ta.value=txt;ta.setAttribute('style','position:fixed;left:-9999px');
      document.body.appendChild(ta);ta.select();
      document.execCommand('copy');ta.remove();
      btn.textContent='Copied';
    }catch(e){btn.textContent='Select the text below and copy it';}
  }

  // A phone stuck on a bad cached build cannot be fixed by reloading: the
  // service worker keeps serving the old precache. This is the escape hatch.
  // It touches caches and the worker only — never Firestore's IndexedDB, so
  // nothing queued offline is thrown away.
  function resetApp(){
    var jobs=[];
    try{
      if(window.caches&&caches.keys)jobs.push(caches.keys().then(function(keys){
        return Promise.all(keys.map(function(k){return caches.delete(k);}));
      }));
    }catch(e){}
    try{
      if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){
        jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){
          return Promise.all(rs.map(function(r){return r.unregister();}));
        }));
      }
    }catch(e){}
    return Promise.all(jobs).catch(function(){});
  }
  window.__gvResetApp=resetApp;
  // Reachable from the console too, for anyone who does have one.
  window.__gvDiagnostics=function(){_gvDiagShown=false;show('Opened manually.');};

  // ── the watchdog ──
  // The app shell is up (we are past login) but nothing has been rendered
  // into it. Either a load hung or a render threw. Either way the user is
  // staring at white.
  function stalled(){
    try{
      var app=document.getElementById('scr-app');
      if(!app||app.style.display==='none')return false;      // still on login
      var main=document.getElementById('main-content');
      if(!main)return true;
      if(main.innerHTML.replace(/\s/g,'').length>0)return false;
      // A board takes over the whole viewport instead of filling
      // #main-content, so treat its presence as "something rendered".
      if(document.querySelector('.board-canvas-wrap'))return false;
      return true;
    }catch(e){return false;}
  }

  function watch(){
    if(_gvDiagShown)return;
    if(stalled())show('It got stuck while loading your pages. This is a fault in the app, not something you did.');
  }

  function arm(){
    setTimeout(watch,_GV_DIAG_STALL);
    // And once more later, for a slow connection that eventually recovers
    // on its own — if it did, stalled() is false and nothing is shown.
    setTimeout(watch,_GV_DIAG_STALL*2.5);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',arm);
  else arm();
})();

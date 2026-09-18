/* ─────────────────────────────────────────────────────────────────────────
   Test harness for Groovy Operations.

   These tests run in plain node with no dependencies — same zero-new-deps
   policy as the app itself. There is no jsdom, so this file provides a
   deliberately small stub of the handful of browser APIs the app's modules
   actually touch, plus a stub of the window-bridged Firebase globals.

   WHAT THIS CAN AND CANNOT TEST — read this before trusting a green run:

   ✅ Pure logic: validators, sanitisers, maths, state machines, which
      actions a menu offers, what gets written to Firestore, whether a
      loader rejects.
   ✅ The stored-XSS boundary: that a module renders STRUCTURE only and
      never interpolates user text into an HTML string.
   ✅ Project invariants (tests/invariants.test.js) — the documented
      three-places-or-it-breaks footguns in CLAUDE.md.

   ❌ Anything visual. Layout, CSS, z-index, whether a button is reachable
      with a thumb. The board's entire top bar was invisible for weeks
      behind a wrong z-index and no test here would have caught it.
   ❌ Real browser behaviour: touch gestures, pointer capture, the
      keyboard, execCommand, DOMParser's real parsing, IndexedDB.
   ❌ Anything requiring the network. The build sandbox cannot reach
      gstatic/cdnjs/jsdelivr, so the app cannot boot in a browser there.

   A green run means "the logic still holds". It does not mean "it works".
   Real UI verification still needs a human, a phone, or Claude in Chrome.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.join(__dirname,'..');

// ── A very small DOM ────────────────────────────────────────────────────
// Enough for getElementById/createElement/classList/textContent/innerHTML
// and the handful of geometry reads the board code makes. Nodes are created
// on demand, so a test can read back whatever the code under test wrote to
// an element without having to build a tree first.
function makeDom(state){
  const nodes={};
  function el(id){
    const node={
      id,tagName:'DIV',style:{},dataset:{},
      innerHTML:'',textContent:'',value:'',files:null,
      isContentEditable:true,children:[],childNodes:[],
      classList:{
        _s:new Set(),
        add(c){this._s.add(c);},remove(c){this._s.delete(c);},
        toggle(c,v){if(v===undefined)v=!this._s.has(c);v?this._s.add(c):this._s.delete(c);return v;},
        contains(c){return this._s.has(c);}
      },
      getBoundingClientRect:()=>({left:0,top:0,width:state.viewportW,height:state.viewportH}),
      getAttribute(k){return this['attr_'+k]!==undefined?this['attr_'+k]:null;},
      setAttribute(k,v){this['attr_'+k]=v;},
      removeAttribute(k){delete this['attr_'+k];},
      querySelector:()=>null,querySelectorAll:()=>[],
      closest:()=>null,
      appendChild(n){this.children.push(n);this.childNodes.push(n);return n;},
      // Element listeners are RECORDED, not discarded: the board's wheel
      // handler lives on the stage element, and a test that can't fire it
      // can only assert the source text, which proves nothing about what
      // the handler does. `fire(el,type,event)` in the harness API calls
      // them.
      _ls:{},
      addEventListener(t,fn,opts){(this._ls[t]=this._ls[t]||[]).push({fn,opts});},
      removeEventListener(t,fn){if(this._ls[t])this._ls[t]=this._ls[t].filter(x=>x.fn!==fn);},
      dispatchEvent(){},
      setPointerCapture(){},releasePointerCapture(){},
      focus(){state.activeElement=this;},blur(){if(state.activeElement===this)state.activeElement=null;},
      // A synthetic <a> is how a blob download is triggered; without this
      // the download path cannot be exercised at all.
      click(){},
      select(){},setSelectionRange(){},
      remove(){delete nodes[this.id];state.body=state.body.filter(x=>x!==this);}
    };
    return node;
  }
  const document={
    getElementById(id){return nodes[id]||(nodes[id]=el(id));},
    // A node created here is NOT registered by id until it is appended, so
    // that code which creates a host and appends it can then find it again.
    createElement(tag){const n=el('__new'+(state.seq++));n.tagName=String(tag).toUpperCase();return n;},
    createTextNode(v){return{nodeType:3,nodeValue:v,childNodes:[]};},
    createRange(){return{selectNodeContents(){}};},
    createElementNS(){return el('__svg'+(state.seq++));},
    body:{appendChild(n){state.body.push(n);if(n.id)nodes[n.id]=n;return n;}},
    // The real <html> element. Tests stamp data-theme on it (js/profile.js),
    // so it needs the attribute pair as well as classList.
    documentElement:(()=>{const h=el('html');return{
      classList:h.classList,
      setAttribute:(k,v)=>{h.__attrs=h.__attrs||{};h.__attrs[k]=String(v);},
      getAttribute:k=>(h.__attrs&&k in h.__attrs)?h.__attrs[k]:null
    };})(),
    querySelector:()=>null,querySelectorAll:()=>[],
    addEventListener(t,fn){(state.listeners[t]=state.listeners[t]||[]).push(fn);},
    removeEventListener(){},
    execCommand(){state.execCommands.push([].slice.call(arguments));return true;},
    get activeElement(){return state.activeElement;}
  };
  return{document,nodes};
}

// ── An HTML parser, for code that calls DOMParser ───────────────────────
// node has no DOMParser. This is a tag-soup parser: good enough to exercise
// an allow-list walk, NOT a stand-in for the real thing. Anything asserting
// on parsing itself (rather than on the walk) is testing this file.
function makeDomParser(){
  function mk(){
    const doc={};
    const ser=n=>n.childNodes.map(c=>{
      if(c.nodeType===3)return String(c.nodeValue).replace(/&/g,'&amp;').replace(/</g,'&lt;');
      const t=c.tagName.toLowerCase();
      const a=Object.keys(c.attrs).map(k=>` ${k}="${c.attrs[k]}"`).join('');
      return t==='br'?'<br>':`<${t}${a}>${ser(c)}</${t}>`;
    }).join('');
    const txt=n=>n.childNodes.map(c=>c.nodeType===3?String(c.nodeValue):txt(c)).join('');
    function node(tag){
      return{nodeType:1,tagName:String(tag).toUpperCase(),childNodes:[],attrs:{},style:{},
        appendChild(n){this.childNodes.push(n);return n;},
        setAttribute(k,v){this.attrs[k]=v;
          if(k==='style'){const m=/color:\s*([^;]+)/.exec(v);if(m)this.style.color=m[1].trim();}},
        getAttribute(k){return this.attrs[k]!==undefined?this.attrs[k]:null;},
        get innerHTML(){return ser(this);},
        get textContent(){return txt(this);}};
    }
    doc.createElement=node;
    doc.createTextNode=v=>({nodeType:3,nodeValue:v,childNodes:[]});
    doc.body=node('body');
    return doc;
  }
  return class DOMParser{
    parseFromString(html){
      const doc=mk();
      const stack=[doc.body];
      const re=/<\/?([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+\s*=\s*"[^"]*")*)\s*\/?>|([^<]+)/g;
      let m;
      while((m=re.exec(html))){
        if(m[3]!==undefined){stack[stack.length-1].appendChild(doc.createTextNode(m[3]));continue;}
        const tag=m[1].toLowerCase();
        if(m[0][1]==='/'){if(stack.length>1)stack.pop();continue;}
        const n=doc.createElement(tag);
        (m[2]||'').replace(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g,(_,k,v)=>{n.setAttribute(k,v);return'';});
        stack[stack.length-1].appendChild(n);
        if(['br','img','input','hr','meta','link'].indexOf(tag)===-1)stack.push(n);
      }
      return doc;
    }
  };
}

/**
 * Build a sandbox and load one or more of the app's classic scripts into it.
 *
 * @param {object} opts
 *   files       — array of repo-relative js paths, loaded in order
 *   session     — the signed-in user (defaults to an owner, "Afnan")
 *   phone       — what matchMedia reports (drives _boardsIsPhone etc.)
 *   globals     — extra values merged into the sandbox before loading
 * @returns {object} an API over the sandbox
 */
function loadApp(opts){
  opts=opts||{};
  const state={
    viewportW:opts.viewportW||1000,viewportH:opts.viewportH||600,
    seq:1,body:[],listeners:{},activeElement:null,execCommands:[],
    toasts:[],activity:[],vibrations:[],writes:[],batches:[],confirms:[],prompts:[],
    fetches:[],
    txCount:0,plainWriteCount:0
  };
  const {document,nodes}=makeDom(state);

  const ctx={
    console,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
    // js/boards.js coalesces renders through it (_boardsRenderSoon), so a
    // test that reaches any batching path needs it to exist. Deferred like
    // the real thing rather than run inline: a synchronous callback would
    // re-enter the render in the middle of the call being tested.
    requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:id=>clearTimeout(id),
    Date,Math,JSON,Set,Map,Object,Array,String,Number,Promise,URL,RegExp,Error,isNaN,parseInt,parseFloat,
    Event:class{constructor(t){this.type=t;}},
    DOMParser:makeDomParser(),
    document,
    window:{
      addEventListener(t,fn){(state.listeners['window:'+t]=state.listeners['window:'+t]||[]).push(fn);},
      removeEventListener(){},
      showPage(){},open(){},
      innerWidth:opts.viewportW||1400,innerHeight:opts.viewportH||900,
      matchMedia:()=>({matches:!!opts.phone}),
      getSelection:()=>({removeAllRanges(){},addRange(){}}),
      _gvSilentSaveStart(){},_gvSilentSaveStop(){}
    },
    navigator:{
      onLine:true,
      vibrate(v){state.vibrations.push(v);return true;},
      storage:{persisted:async()=>true,persist:async()=>true},
      clipboard:{writeText:async()=>{}}
    },
    location:{origin:'https://groovyoperations.netlify.app',pathname:'/',hash:''},
    getComputedStyle:()=>({getPropertyValue:()=>'',fontFamily:'sans-serif'}),
    localStorage:undefined,   // the app already guards every access in try/catch

    // ── app globals normally provided by other classic scripts ──
    session:opts.session||{uid:'u1',name:'Afnan',u:'afnan',title:'Co-Founder',role:'owner',email:'afnan@groovy.op'},
    USER_DEFS:opts.USER_DEFS||[
      {u:'afnan',name:'Afnan',title:'Co-Founder',role:'owner'},
      {u:'ammar',name:'Ammar',title:'Co-Founder',role:'owner'},
      {u:'mustafa',name:'Mustafa',title:'Manager',role:'manager'},
      {u:'uzaib',name:'Uzaib',title:'Supervisor',role:'worker'}
    ],
    currentPage:opts.currentPage||'board-canvas',
    moodBoards:[],_boardsTrash:[],
    showToast(m){state.toasts.push(String(m));},
    // The app's two blocking dialogs. Recorded so a test can assert an
    // action ASKED, and answered "yes" by default — a test that wants the
    // cancel path overrides confirm through `globals`.
    confirm(m){state.confirms.push(String(m));return true;},
    prompt(m,d){state.prompts.push(String(m));return d===undefined?'':d;},
    logActivity(a,d){state.activity.push({action:a,detail:d});},
    uploadToCloudinary:async()=>'https://res.cloudinary.com/deww4lpym/image/upload/v1/up.jpg',
    gvSkeleton:()=>'<div class="skeleton"></div>',
    auth:{currentUser:null},

    // ── the window-bridged Firebase API ──
    db:{},
    doc:()=>({}),collection:()=>({}),query:()=>({}),
    where:()=>({}),orderBy:()=>({}),limit:()=>({}),
    getDoc:async()=>({exists:()=>false,data:()=>({})}),
    getDocs:async()=>({docs:[]}),
    setDoc:async(r,p)=>{state.writes.push({op:'set',data:p});},
    updateDoc:async(r,p)=>{state.plainWriteCount++;state.writes.push({op:'update',data:p});},
    addDoc:async(r,p)=>{state.writes.push({op:'add',data:p});return{id:'new'};},
    deleteDoc:async()=>{state.writes.push({op:'delete'});},
    runTransaction:async(db,fn)=>{
      state.txCount++;
      return fn({get:async()=>({exists:()=>true,data:()=>({cards:[],connectors:[]})}),update(){}});
    },
    // Batched writes land in state.writes like any other, tagged with the
    // batch they belonged to, so a test can assert BOTH what was written
    // and that it went in one round trip.
    writeBatch:()=>{
      const ops=[];
      state.batches.push(ops);
      return{
        set(r,p){ops.push({op:'set',data:p});return this;},
        update(r,p){ops.push({op:'update',data:p});return this;},
        delete(r){ops.push({op:'delete'});return this;},
        async commit(){ops.forEach(o=>state.writes.push(o));}
      };
    },
    onSnapshot:()=>()=>{},

    // js/store.js is the one module that talks to Firestore over REST rather
    // than through the SDK bridge, so it needs a fetch. Every call is
    // recorded; by default each answers 200 with an empty document list. A
    // test drives real responses by overriding `fetch` through `globals`.
    fetch:async(url,init)=>{
      state.fetches.push({url:String(url),init:init||{}});
      return{ok:true,status:200,statusText:'OK',json:async()=>({documents:[]})};
    },
    // Convenience for building those responses in a test.
    _res:(status,body)=>({
      ok:status>=200&&status<300,status,statusText:String(status),
      json:async()=>body
    })
  };
  Object.assign(ctx,opts.globals||{});
  ctx.globalThis=ctx;
  vm.createContext(ctx);

  (opts.files||[]).forEach(f=>{
    const p=path.join(ROOT,f);
    vm.runInContext(fs.readFileSync(p,'utf8'),ctx,{filename:path.basename(p)});
  });

  return{
    ctx,state,nodes,
    /** Evaluate an expression inside the sandbox. */
    run:code=>vm.runInContext(code,ctx),
    /** An element by id, created on demand. */
    el:id=>ctx.document.getElementById(id),
    /**
     * Fire a listener the code under test registered on an element.
     * Returns the event object, so a test can assert preventDefault was
     * called — which for a wheel handler IS the behaviour: without it the
     * browser page-zooms no matter what else the handler does.
     */
    fire(elementOrId,type,ev){
      const node=typeof elementOrId==='string'?ctx.document.getElementById(elementOrId):elementOrId;
      const e=Object.assign({
        type,defaultPrevented:false,deltaX:0,deltaY:0,
        ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,
        clientX:0,clientY:0,target:node,currentTarget:node,
        preventDefault(){this.defaultPrevented=true;},
        stopPropagation(){}
      },ev||{});
      ((node&&node._ls&&node._ls[type])||[]).forEach(l=>l.fn(e));
      return e;
    },
    /** Listener registration options for an element, e.g. {passive:false}. */
    listenerOpts(elementOrId,type){
      const node=typeof elementOrId==='string'?ctx.document.getElementById(elementOrId):elementOrId;
      const l=node&&node._ls&&node._ls[type];
      return l&&l.length?l[0].opts:undefined;
    },
    /** innerHTML of the last node with this id appended to document.body. */
    bodyHtml(id){
      const m=state.body.filter(x=>x.id===id);
      return m.length?m[m.length-1].innerHTML:'';
    },
    bodyCount(id){return state.body.filter(x=>x.id===id).length;}
  };
}

// ── assertions ──────────────────────────────────────────────────────────
function suite(name){
  const s={name,pass:0,fail:0,failures:[]};
  s.section=t=>{s._section=t;console.log('\n  '+t);};
  s.ok=(label,cond,detail)=>{
    if(cond){s.pass++;console.log('    ok   '+label+(detail!==undefined?'   → '+detail:''));}
    else{s.fail++;s.failures.push((s._section?s._section+' / ':'')+label+(detail!==undefined?'   → '+detail:''));
      console.log('    FAIL '+label+(detail!==undefined?'   → '+detail:''));}
  };
  s.eq=(label,actual,expected)=>s.ok(label,actual===expected,
    actual===expected?undefined:'got '+JSON.stringify(actual)+', expected '+JSON.stringify(expected));
  return s;
}

module.exports={loadApp,suite,ROOT};

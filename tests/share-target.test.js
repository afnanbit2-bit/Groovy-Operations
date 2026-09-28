/* ─────────────────────────────────────────────────────────────────────────
   Phone share — manifest.json share_target → sw.js → js/boards.js

   Three halves have to agree, and each is driven for real here:
   - manifest.json names the action, the method, the encoding and the file
     field the service worker reads;
   - sw.js's fetch handler, run in a vm with a fake Cache Storage, parks the
     POSTed share and redirects to #share=<id>;
   - js/boards.js reads that same cache back, offers the boards the person
     can add to, and files the share into the chosen board's Unsorted.

   What this cannot prove: that Android actually offers the app in its
   Share menu (that needs an installed PWA on a real phone) and what Chrome
   really POSTs. The first real share is that test.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {loadApp,suite,ROOT}=require('./harness');

// A Cache Storage good enough for both sides: entries keyed by pathname.
function fakeCaches(){
  const buckets={};
  const keyOf=k=>{const u=typeof k==='string'?k:k.url;try{return new URL(u,'https://x').pathname;}catch(e){return u;}};
  const api={
    buckets,
    async open(name){
      const m=buckets[name]=buckets[name]||new Map();
      return{
        async put(k,res){m.set(keyOf(k),res);},
        async match(k){return m.get(keyOf(k))||undefined;},
        async keys(){return[...m.keys()].map(p=>({url:'https://x'+p}));},
        async delete(k){return m.delete(keyOf(k));}
      };
    },
    async keys(){return Object.keys(buckets);}
  };
  return api;
}
class FakeResponse{
  constructor(body,init){this.body=body;this.headers=(init&&init.headers)||{};this.status=(init&&init.status)||200;}
  async json(){return JSON.parse(typeof this.body==='string'?this.body:'null');}
  async blob(){return this.body;}
  static redirect(url,status){const r=new FakeResponse(null,{status});r.location=url;return r;}
}
class FakeFile{constructor(parts,name,opts){this.parts=parts;this.name=name;this.type=(opts&&opts.type)||'';this.size=(parts[0]&&parts[0].size)||1;}}

function loadSw(caches){
  const listeners={};
  const ctx={
    self:{addEventListener(t,fn){(listeners[t]=listeners[t]||[]).push(fn);},skipWaiting(){},clients:{claim(){}}},
    caches,Response:FakeResponse,URL,console:{warn(){},log(){}},Date,Math,JSON,Promise,Set,Map,fetch:async()=>{throw new Error('offline');}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8'),ctx);
  return{listeners,ctx};
}
function form(fields,files){
  return{
    get:k=>fields[k]!==undefined?fields[k]:null,
    getAll:k=>k==='files'?(files||[]):[]
  };
}
async function postShare(sw,fields,files){
  let responded=null;
  const ev={request:{method:'POST',url:'https://groovyoperations.netlify.app/share-target',formData:async()=>form(fields,files)},
    respondWith(p){responded=p;}};
  sw.listeners.fetch.forEach(fn=>fn(ev));
  return responded?await responded:null;
}

module.exports=async function(){
  const s=suite('share-target');

  // ── manifest + netlify ───────────────────────────────────────────────
  {
    s.section('the manifest puts the app in the phone\'s Share menu');
    const m=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));
    const t=m.share_target||{};
    s.eq('action',t.action,'/share-target');
    s.eq('POST — files cannot travel in a GET',t.method,'POST');
    s.eq('multipart',t.enctype,'multipart/form-data');
    const f=(t.params&&t.params.files)||[];
    s.eq('the file field sw.js reads is "files"',f[0]&&f[0].name,'files');
    s.ok('photos are accepted',f[0]&&f[0].accept.indexOf('image/*')>=0);
    s.ok('title, text and url are named',t.params&&t.params.title==='title'&&t.params.text==='text'&&t.params.url==='url');

    const toml=fs.readFileSync(path.join(ROOT,'netlify.toml'),'utf8');
    const a=toml.indexOf('from = "/share-target"'),b=toml.indexOf('from = "/*"');
    s.ok('Netlify has a fallback for a share with no service worker, above the SPA catch-all',a>0&&a<b);
  }

  // ── the service worker ───────────────────────────────────────────────
  {
    const caches=fakeCaches();
    const sw=loadSw(caches);
    s.section('sw.js parks the share and redirects to it');
    const pic={size:1234,type:'image/jpeg',name:'IMG_1.jpg'};
    const res=await postShare(sw,{title:'Look',text:'Nice fit https://pinterest.com/pin/1',url:''},[pic,'not a file',{size:0,name:'empty'}]);
    s.ok('it answered the POST',!!res);
    s.eq('with a 303',res&&res.status,303);
    const id=res&&(res.location.match(/#share=([a-z0-9]+)$/)||[])[1];
    s.ok('to /index.html#share=<id>',!!id&&res.location.indexOf('/index.html#share=')===0,res&&res.location);
    const bucket=caches.buckets['groovy-share-inbox'];
    s.ok('in a bucket the activate handler never deletes (not groovy-ops-*)',!!bucket&&!Object.keys(caches.buckets).some(n=>n.indexOf('groovy-ops-')===0));
    const meta=bucket&&JSON.parse(bucket.get('/__share/'+id+'/meta').body);
    s.eq('the text is kept',meta&&meta.text,'Nice fit https://pinterest.com/pin/1');
    s.eq('only the real file is kept (a string and an empty part are dropped)',meta&&meta.files.length,1);
    s.eq('with its name',meta&&meta.files[0].name,'IMG_1.jpg');
    s.ok('and the file itself is stored under its key',!!(meta&&bucket.get(meta.files[0].key)));

    s.section('a GET is not treated as a share, and a POST elsewhere is not intercepted');
    let r2=null;
    sw.listeners.fetch.forEach(fn=>fn({request:{method:'POST',url:'https://x/api/other'},respondWith(p){r2=p;}}));
    s.ok('another POST is left to the network',r2===null);

    s.section('an abandoned share is swept after a day');
    bucket.set('/__share/old/meta',new FakeResponse(JSON.stringify({id:'old',at:Date.now()-25*3600*1000,files:[{key:'/__share/old/f0'}]})));
    bucket.set('/__share/old/f0',new FakeResponse({size:1}));
    await postShare(sw,{text:'hello'},[]);
    s.ok('the old meta is gone',!bucket.has('/__share/old/meta'));
    s.ok('and its file with it',!bucket.has('/__share/old/f0'));
    s.ok('the fresh share survives',bucket.has('/__share/'+id+'/meta'));

    s.section('a broken form still lands somewhere readable');
    let r3=null;
    sw.listeners.fetch.forEach(fn=>fn({request:{method:'POST',url:'https://x/share-target',formData:async()=>{throw new Error('bad');}},respondWith(p){r3=p;}}));
    const r3v=await r3;
    s.eq('#share=failed',r3v&&r3v.location,'/index.html#share=failed');
  }

  // ── what the share becomes ───────────────────────────────────────────
  {
    const app=loadApp({files:['js/boards.js']});
    const {run}=app;
    s.section('_boardsSharePlan — one decision');
    const plan=o=>JSON.parse(run(`JSON.stringify(_boardsSharePlan(${JSON.stringify(o)}))`));
    s.eq('a url field is a link',plan({url:'https://a.com/x'}).url,'https://a.com/x');
    s.eq('Android puts the link inside text — found there',plan({title:'Pin',text:'Nice https://pin.it/abc).'}).url,'https://pin.it/abc');
    s.eq('with a link there is no note',plan({text:'Nice https://pin.it/abc'}).note,'');
    s.eq('plain text becomes a note',plan({text:'call the vendor'}).note,'call the vendor');
    s.eq('a title with other text is kept on top',plan({title:'Idea',text:'wide sleeves'}).note,'Idea\nwide sleeves');
    s.eq('a title alone is the note',plan({title:'Idea'}).note,'Idea');
    s.eq('javascript: is not a link',plan({url:'javascript:alert(1)'}).url,'');
    s.eq('files without a key are ignored',plan({files:[{key:'/__share/a/f0'},{name:'x'}]}).files.length,1);
    s.eq('and junk never throws',plan(null).url,'');
    s.eq('the summary counts photos, files and the link',
      run(`_boardsShareSummary({url:'https://a'},[{type:'image/png'},{type:'image/jpeg'},{type:'application/pdf'}])`),'2 photos · 1 file · a link');

    s.section('the picker offers only boards you can add to, recent first');
    run(`session={uid:'u1',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op'};
      moodBoards=[
        {id:'H',title:'Home',isHome:true,ownerUid:'u1',visibility:'personal'},
        {id:'T',title:'Tmpl',isTemplate:true,ownerUid:'u1',visibility:'personal'},
        {id:'P',title:'Someone private',ownerUid:'u9',visibility:'personal'},
        {id:'A',title:'Winter Drop',ownerUid:'u1',visibility:'personal',updatedAt:1},
        {id:'B',title:'Team denim',ownerUid:'u9',visibility:'shared',updatedAt:5}];`);
    const ids=q=>run(`_boardsShareTargets(${JSON.stringify(q||'')}).map(b=>b.id).join(',')`);
    s.eq('Home, templates and other people\'s private boards are left out; newest first',ids(),'B,A');
    s.eq('search narrows by name',ids('winter'),'A');
    s.ok('a board title is escaped in the row',
      (run(`moodBoards.push({id:'X',title:'<img src=x onerror=1>',ownerUid:'u1',visibility:'personal'});_boardsShareListHTML('img')`)).indexOf('<img src=x')<0);
  }

  // ── end to end in the page ───────────────────────────────────────────
  {
    const caches=fakeCaches();
    const sw=loadSw(caches);
    const res=await postShare(sw,{title:'Pin',text:'Nice https://pin.it/abc'},[{size:9,type:'image/jpeg',name:'a.jpg'}]);
    const id=res.location.split('#share=')[1];
    const app=loadApp({files:['js/boards.js'],globals:{caches,File:FakeFile,history:{replaceState(){}},
      _canSeeCreativeHub:()=>true,
      // the upload itself is not what is under test — keep it pending
      fetch:()=>new Promise(()=>{})}});
    const {run,state}=app;
    run(`session={uid:'u1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'};boardsLoaded=true;
      moodBoards=[{id:'A',title:'Winter Drop',ownerUid:'u1',visibility:'personal',cards:[],connectors:[],unsorted:[]}];
      _editBoard=moodBoards[0];_editUnsorted=[];currentPage='board-canvas';location.hash='#share=${id}';`);

    s.section('opening #share=<id> asks which board');
    s.ok('the hash is read as a share',run(`JSON.stringify(_boardsParseHash())`)===JSON.stringify({share:id}));
    run(`_boardsConsumeDeepLink()`);
    await new Promise(r=>setTimeout(r,20));
    s.ok('the share is pending',run(`!!_boardsPendingShare`));
    s.eq('with a summary of what came',run(`_boardsPendingShare.summary`),'1 photo · a link');
    s.ok('and the picker lists the board',app.bodyHtml('board-sheet').indexOf('boardsShareTo(\'A\')')>=0);

    s.section('picking the open board files it into Unsorted');
    run(`window.boardsShareTo('A')`);
    const kinds=run(`_editUnsorted.map(u=>u.kind).join(',')`);
    s.eq('a link item and the photo, in that order',kinds,'link,image');
    s.eq('the link is the one from the text',run(`_editUnsorted[0].linkUrl`),'https://pin.it/abc');
    s.ok('Unsorted is opened so the result is on screen',run(`_boardsTrayOpen`)===true);
    s.ok('the toast names the board',state.toasts.some(t=>t.indexOf('Saved to Unsorted in Winter Drop')===0),state.toasts.join(' | '));
    await new Promise(r=>setTimeout(r,20));
    s.ok('and the share is forgotten once delivered',!caches.buckets['groovy-share-inbox'].has('/__share/'+id+'/meta'));
    s.ok('nothing is pending',run(`_boardsPendingShare===null`));

    s.section('a share that is gone, or that failed, says so');
    state.toasts.length=0;
    await run(`_boardsShareStart('${id}')`);
    s.ok('already saved',state.toasts.some(t=>/already saved|expired/.test(t)),state.toasts.join(' | '));
    state.toasts.length=0;
    await run(`_boardsShareStart('failed')`);
    s.ok('failed',state.toasts.some(t=>/could not be received/.test(t)),state.toasts.join(' | '));

    s.section('an account without the hub is told, and the share is not kept');
    const res2=await postShare(sw,{text:'hello'},[]);
    const id2=res2.location.split('#share=')[1];
    run(`_canSeeCreativeHub=()=>false;location.hash='#share=${id2}';`);
    state.toasts.length=0;
    run(`_boardsConsumeDeepLink()`);
    await new Promise(r=>setTimeout(r,20));
    s.ok('told',state.toasts.some(t=>/not open to your account/.test(t)),state.toasts.join(' | '));
    s.ok('forgotten',!caches.buckets['groovy-share-inbox'].has('/__share/'+id2+'/meta'));
  }

  return s;
};

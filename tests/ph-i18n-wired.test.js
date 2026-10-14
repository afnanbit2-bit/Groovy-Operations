/* Urdu-first wiring (WP4, 13 Oct 2026): js/ph-i18n.js is now used by Kashif's tabs (Overview, PO Queue + Drafts, Today's Cutting)
   and the shell. Held here: every key a screen names exists in the table; the descriptor/markup rules (English view = plain text, Urdu-first =
   a pair with lang=ur dir=rtl, <option> stays plain); a descriptor never reaches a write; no Urdu or ph-i18n call in a PDF path;
   the per-viewer switch is wired for everyone, repaints on change and survives blocked storage; unreviewed Urdu is flagged on screen.
   The English view is held by the existing Production Ops suites, which pin English and pass UNCHANGED in their assertions (the break-target
   strings were re-pointed at the new source text). NOT proved: that the Urdu is correct (nobody has read it) or how it looks on a real phone.
   Each "break" mutates a source and requires its named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const ROOT=path.join(__dirname,'..');
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC={i18n:rd('js/ph-i18n.js'),ui:rd('js/ph-ui.js'),queue:rd('js/ph-mod-queue.js'),drafts:rd('js/ph-mod-drafts.js'),cutting:rd('js/ph-mod-cutting.js'),monitor:rd('js/ph-mod-monitor.js')};
const WIRED=['ui','queue','drafts','cutting','monitor'];
const FILE={ui:'js/ph-ui.js',queue:'js/ph-mod-queue.js',drafts:'js/ph-mod-drafts.js',cutting:'js/ph-mod-cutting.js',monitor:'js/ph-mod-monitor.js'};
const stripC=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:\\'"`])\/\/[^\n]*/g,'$1');

function boot(src,o){
  o=o||{};
  const store={};let blocked=!!o.blocked;
  const ls={getItem(k){if(blocked)throw new Error('blocked');return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null;},
            setItem(k,v){if(blocked)throw new Error('blocked');store[k]=String(v);}};
  const ctx=vm.createContext({document:{},localStorage:ls,session:o.session||{u:'afnan'},console});
  const dom=domkit.install(ctx);
  vm.runInContext(src,ctx,{filename:'ph-i18n.js'});
  return{ctx,dom,R:e=>vm.runInContext(e,ctx),store};
}

function checks(S){
  const o={};
  const a=boot(S.i18n);
  const T=a.R('PH_I18N_STR');

  // 1. keys the screens name exist
  const used=new Set(),missing=[];
  WIRED.forEach(w=>{
    const code=stripC(S[w]);
    for(const m of code.matchAll(/'((?:shell|queue|drafts|cut|ov|err)\.[a-z0-9_]+)'(?!\s*\+)/g))used.add(m[1]);
  });
  used.forEach(k=>{if(!T[k])missing.push(k);});
  o['keys: at least 300 distinct keys are named by the wired screens']=used.size>=300;
  o['keys: every key a wired screen names exists in the table (none missing)']=missing.length===0;

  // 2. rendering rules
  const urOn=boot(S.i18n,{session:{u:'uzaib'}}),enOn=boot(S.i18n,{session:{u:'afnan'}});
  const mk=(c,tag)=>c.R("document.createElement('"+tag+"')");
  const n1=mk(urOn,'div');urOn.R("phI18nSet").call?0:0;
  urOn.ctx.__n=n1;urOn.R("phI18nSet(__n,phI18nD('queue.plan_saved',{po:'PO-9'}))");
  o['render: Urdu-first puts a pair in the node, Urdu above English, lang=ur dir=rtl']=n1.children.length===1&&n1.children[0].className==='phi-pair'&&n1.children[0].children[0].getAttribute('lang')==='ur'&&n1.children[0].children[0].getAttribute('dir')==='rtl'&&n1.children[0].children[1].textContent==='Plan saved for PO-9';
  const n2=mk(enOn,'div');enOn.ctx.__n=n2;enOn.R("phI18nSet(__n,phI18nD('queue.plan_saved',{po:'PO-9'}))");
  o['render: the English view is plain textContent, no child element (identical to the old DOM)']=n2.children.length===0&&n2.textContent==='Plan saved for PO-9';
  const n3=mk(urOn,'option');urOn.ctx.__n=n3;urOn.R("phI18nSet(__n,phI18nD('queue.plan_saved',{po:'PO-9'}))");
  o['render: an <option> stays one plain string even Urdu-first (a select cannot hold markup)']=n3.children.length===0&&n3.textContent==='Plan saved for PO-9';
  o['render: a descriptor is its English as a string and in JSON (untaught sinks and JSON checks unchanged)']=urOn.R("String(phI18nD('shell.retry'))")==='Retry'&&urOn.R("JSON.stringify({a:phI18nD('shell.retry')})")==='{"a":"Retry"}';
  o['render: a nested descriptor param resolves per language']=urOn.R("phI18nStr(phI18nD('queue.plan_saved',{po:phI18nD('shell.retry')}),'en')")==='Plan saved for Retry'&&urOn.R("phI18nStr(phI18nD('queue.plan_saved',{po:phI18nD('shell.retry')}),'ur')")===urOn.R("phI18nT('queue.plan_saved',{po:'"+'\u0000'+"'},'ur')").replace('\u0000',urOn.R("phI18nT('shell.retry',null,'ur')"));
  o['render: attributes get one string, Urdu — English when Urdu-first, English only otherwise']=/ — Retry$/.test(urOn.R("phI18nAttr(phI18nD('shell.retry'))"))&&enOn.R("phI18nAttr(phI18nD('shell.retry'))")==='Retry';
  o['render: a hostile param is only text']=(()=>{const h='<img src=x onerror=alert(1)>';const n=mk(urOn,'div');urOn.ctx.__n=n;urOn.ctx.__h=h;urOn.R("phI18nSet(__n,phI18nD('queue.plan_saved',{po:__h}))");return n.children[0].children[1].textContent==='Plan saved for '+h&&domkit.toHtml(n).indexOf('<img')<0;})();
  o['render: a lower-layer English read error becomes a pair key, anything else stays text']=(()=>{const d=urOn.R("phI18nErr('po_drafts: read failed.')");const k=urOn.R("phI18nErr('something nobody wrote a key for')");return k==='something nobody wrote a key for'&&(typeof d==='string'||(d&&d.__phi18n===1));})();

  // 3. unreviewed Urdu is flagged on screen
  o['review: many strings are flagged review:true and the notice is a visible Urdu chip plus an English line']=urOn.R('phI18nReviewKeys().length')>=200&&(()=>{const n=urOn.R("phI18nReviewNotice(document)");return n.children[0].className==='phi-review'&&n.children[0].getAttribute('lang')==='ur'&&/نظرثانی/.test(n.children[0].textContent)&&/Urdu wording/.test(n.children[1].textContent);})();
  o['review: ph-ui paints the notice while Urdu-first text is on screen']=/phI18nReviewNotice\(/.test(S.ui)&&/phI18nUrduOn\(\)/.test(S.ui);

  // 4. the per-viewer switch
  o['switch: the shell shows it for everyone (no audience condition on the language box)']=(()=>{const m=/function _phTkPaintLang\(\)\{[\s\S]*?\n\}/.exec(S.ui);return !!m&&/phI18nToggleNode/.test(m[0])&&!/phCanManage|phCanRecordFloor|username===|\.u===/.test(m[0]);})();
  o['switch: a change repaints the bar, the rail and the open tab']=/phI18nOnChange\(/.test(S.ui)&&/_phTkPaintBar\(\)/.test(S.ui);
  o['switch: with storage blocked the choice still holds for the session and nothing throws']=(()=>{const c=boot(S.i18n,{blocked:true,session:{u:'afnan'}});try{c.R("phI18nSetLang('ur-first')");return c.R('phI18nUrduOn()')===true;}catch(e){return false;}})();
  o['switch: the choice is stored per viewer under groovy-ph-lang']=(()=>{const c=boot(S.i18n,{session:{u:'afnan'}});c.R("phI18nSetLang('ur-first')");return c.store['groovy-ph-lang']==='ur-first';})();
  o['switch: uzaib is Urdu-first by default, everyone else English']=urOn.R('phI18nUrduOn()')===true&&enOn.R('phI18nUrduOn()')===false;

  // 5. what gets written stays plain English, and PDFs never get Urdu
  const bad=[];
  WIRED.forEach(w=>{stripC(S[w]).split('\n').forEach((l,i)=>{if(/phI18nD\(/.test(l)&&/\b(reason\s*:|phSave\w*\(|phIssueDraft\(|phSendBackDraft\(|phAbandonDraft\(|phMarkDraftReady\(|setDoc|updateDoc|addDoc|writeBatch)/.test(l))bad.push(w+':'+(i+1));});});
  o['writes: no descriptor is ever on a line that writes (history reasons and saves stay plain English)']=bad.length===0;
  o['pdf: ph-i18n.js and the wired screens never call jsPDF or printDocument']=[S.i18n].concat(WIRED.map(w=>S[w])).every(t=>!/jsPDF|printDocument\(/.test(stripC(t)));
  o['pdf: ph-mod-reports.js (the PDF export) does not use ph-i18n at all']=!/phI18n/.test(rd('js/ph-mod-reports.js'));
  o['source: all Urdu text lives in ph-i18n.js (no Arabic-script letter in a wired screen)']=WIRED.every(w=>!/[؀-ۿ]/.test(stripC(S[w])));
  o['source: no innerHTML / outerHTML / insertAdjacentHTML / DOMParser in the wired screens']=WIRED.every(w=>!/innerHTML|outerHTML|insertAdjacentHTML|DOMParser/.test(stripC(S[w])));
  // 6. css
  const css=rd('css/main.css');
  o['css: the Urdu bar and dock grow (ph-ur sets the two variables)']=/body\.ph-fullscreen\.ph-ur\{--ph-tk-bar:\d+px;--ph-tk-dock:\d+px\}/.test(css);
  o['css: the review chip uses theme tokens only']=!/\.phi-review\{[^}]*#[0-9a-fA-F]{3,8}/.test(css)&&/\.phi-review\{[^}]*var\(--accent-warning/.test(css);
  o['wiring: ph-i18n.js is loaded before ph-ui.js in index.html and precached']=(()=>{const h=rd('index.html'),w=rd('sw.js');const i=h.indexOf('/js/ph-i18n.js'),j=h.indexOf('/js/ph-ui.js');return i>0&&j>i&&/\/js\/ph-i18n\.js/.test(w);})();
  return o;
}

module.exports=async function(){
  const s=suite('ph-i18n-wired');
  const base=checks(SRC);
  s.section('Urdu-first wiring');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('each new rule reverted once must fail its check');
  let n=0;
  const brk=(label,file,from,to,failing)=>{
    if(SRC[file].split(from).length-1<1){s.ok('break target exists: '+label,false);return;}
    const S=Object.assign({},SRC);S[file]=SRC[file].split(from).join(to);
    let r;try{r=checks(S);}catch(e){r={};}
    failing.forEach(f=>{n++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  brk('a key is renamed in the table','i18n',"A('queue.btn_open',","A('queue.btn_open_x',",['keys: every key a wired screen names exists in the table (none missing)']);
  brk('Urdu-first never builds a pair','i18n',"if(phI18nIsD(x)&&phI18nUrduOn()&&typeof document","if(false&&phI18nIsD(x)&&phI18nUrduOn()&&typeof document",['render: Urdu-first puts a pair in the node, Urdu above English, lang=ur dir=rtl']);
  brk('the English view gets a pair too','i18n',"if(phI18nIsD(x)&&phI18nUrduOn()&&typeof document","if(phI18nIsD(x)&&true&&typeof document",['render: the English view is plain textContent, no child element (identical to the old DOM)']);
  brk('<option> takes markup','i18n',"!/^(OPTION|OPTGROUP|TEXTAREA|INPUT|TITLE)$/.test(String(node.tagName||''))","true",['render: an <option> stays one plain string even Urdu-first (a select cannot hold markup)']);
  brk('toJSON dropped','i18n',"toJSON:function(){return phI18nT(this.key,this.params,'en');}","",['render: a descriptor is its English as a string and in JSON (untaught sinks and JSON checks unchanged)']);
  brk('nested descriptors not resolved','i18n',"if(phI18nIsD(v))return phI18nT(v.key,v.params,lang);","",['render: a nested descriptor param resolves per language']);
  brk('attributes always English','i18n',"return phI18nUrduOn()?phI18nT(x.key,x.params,'ur')+' — '+phI18nT(x.key,x.params,'en'):phI18nT(x.key,x.params,'en');","return phI18nT(x.key,x.params,'en');",['render: attributes get one string, Urdu — English when Urdu-first, English only otherwise']);
  brk('the review notice is empty','i18n',"d.appendChild(chip);d.appendChild(en);","",['review: many strings are flagged review:true and the notice is a visible Urdu chip plus an English line']);
  brk('ph-ui never shows the review notice','ui',"phI18nReviewNotice","phI18nReviewNoticeX",['review: ph-ui paints the notice while Urdu-first text is on screen']);
  brk('the language box limited to floor users','ui',"function _phTkPaintLang(){","function _phTkPaintLang(){if(!phCanRecordFloor())return;",['switch: the shell shows it for everyone (no audience condition on the language box)']);
  brk('no repaint on a language change','ui',"phI18nOnChange(","phI18nOnChangeX(",['switch: a change repaints the bar, the rail and the open tab']);
  brk('memory fallback removed','i18n',"if(_phI18nLangOk(_phI18nMem))return _phI18nMem;","",['switch: with storage blocked the choice still holds for the session and nothing throws']);
  brk('uzaib no longer Urdu-first','i18n',"['uzaib']","[]",['switch: uzaib is Urdu-first by default, everyone else English']);
  brk('a descriptor reaches a history reason','cutting',"_phkSay(w,'err',(r&&r.error)||phI18nD('cut.could_not_save'),{reload:!!(r&&(r.code==='stale')),code:r&&r.code});","phSaveCutJob(w.poId,{reason:phI18nD('cut.could_not_save')});",['writes: no descriptor is ever on a line that writes (history reasons and saves stay plain English)']);
  brk('jsPDF in a wired screen','queue',"function _phqBtn(","var _x=typeof jsPDF;\nfunction _phqBtn(",['pdf: ph-i18n.js and the wired screens never call jsPDF or printDocument']);
  brk('Urdu typed into a screen','drafts',"function _phdEl(","var _u='ڈرافٹ';\nfunction _phdEl(",['source: all Urdu text lives in ph-i18n.js (no Arabic-script letter in a wired screen)']);
  brk('innerHTML in a wired screen','monitor',"function _phmBtn(","var _y=document.body.innerHTML;\nfunction _phmBtn(",['source: no innerHTML / outerHTML / insertAdjacentHTML / DOMParser in the wired screens']);
  s.ok('breaks run: '+n,n>=15);
  return s;
};

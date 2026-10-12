/* Production Ops Urdu/English strings (13 Oct 2026): js/ph-i18n.js. Not wired into any screen yet.
   Drives the REAL helpers in a vm context with tests/ph-dom.js's small DOM and a fake localStorage.
   Held: every key has non-empty ur and en; every {token} of en is in ur (and back); fallbacks; the language rules (default per user,
   stored preference wins, blocked storage, change callback once); node structure; the switch markup; hostile params are text;
   no innerHTML-style call in the file. NOT proved: that the Urdu is good (nobody who reads Urdu has checked it) or that it looks right.
   Each "break" mutates the source and requires its named check to FAIL. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const domkit=require('./ph-dom');
const {suite}=harness;
const SRC=fs.readFileSync(path.join(__dirname,'..','js','ph-i18n.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'..','css-ph-i18n-block.css'),'utf8');

function boot(src,o){
  o=o||{};
  const store={};let blocked=!!o.blocked;
  const ls={getItem(k){if(blocked)throw new Error('blocked');return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null;},
            setItem(k,v){if(blocked)throw new Error('blocked');store[k]=String(v);}};
  const ctx=vm.createContext({document:{},localStorage:o.noLS?undefined:ls,session:o.session||{u:'afnan'},console});
  const dom=domkit.install(ctx);
  vm.runInContext(src,ctx,{filename:'ph-i18n.js'});
  const R=e=>vm.runInContext(e,ctx);
  return{ctx,dom,R,store,block(b){blocked=b;},doc:ctx.document};
}
const J=JSON.stringify;
const tokens=s=>(String(s).match(/\{[A-Za-z_][A-Za-z0-9_]*\}/g)||[]).sort();

function checks(src){
  const o={};
  let a;try{a=boot(src);}catch(e){return{boot:false};}
  const T=a.R('PH_I18N_STR'),keys=Object.keys(T);
  o['table: at least 400 strings']=keys.length>=400;
  o['table: every key has non-empty ur and en']=keys.every(k=>typeof T[k].ur==='string'&&T[k].ur.trim()&&typeof T[k].en==='string'&&T[k].en.trim());
  o['table: every {token} of en is in ur, and the reverse']=keys.every(k=>J(tokens(T[k].en))===J(tokens(T[k].ur)));
  o['table: Urdu uses Western digits only']=keys.every(k=>!/[٠-٩۰-۹]/.test(T[k].ur));
  o['table: every ur contains Arabic-script letters']=keys.every(k=>/[؀-ۿ]/.test(T[k].ur));
  o['table: review flags are booleans true only']=keys.every(k=>T[k].review===undefined||T[k].review===true);
  o['table: the three rail names exist in both languages']=['shell.tab_overview','shell.tab_queue','shell.tab_cutting'].every(k=>T[k]&&T[k].ur&&T[k].en);

  // T()
  o['T: fills params in en and ur']=a.R("phI18nT('queue.plan_saved',{po:'PO-9'},'en')")==='Plan saved for PO-9'&&/PO-9/.test(a.R("phI18nT('queue.plan_saved',{po:'PO-9'},'ur')"));
  o['T: ur-first reads as ur']=a.R("phI18nT('shell.retry',null,'ur-first')")===T['shell.retry'].ur;
  o['T: default language is en']=a.R("phI18nT('shell.retry')")==='Retry';
  o['T: unknown key returns the key']=a.R("phI18nT('no.such.key',{a:1},'ur')")==='no.such.key';
  o['T: missing ur falls back to en']=a.R("(function(){PH_I18N_STR['t.x']={en:'Hello {n}'};return phI18nT('t.x',{n:2},'ur');})()")==='Hello 2';
  o['T: missing param leaves the token, never throws']=a.R("phI18nT('queue.plan_saved',{},'en')")==='Plan saved for {po}';
  o['T: hostile inputs never throw']=(()=>{try{return a.R("[phI18nT(null),phI18nT(undefined,undefined,undefined),phI18nT('shell.retry',5,'zz'),phI18nT('constructor'),phI18nT('__proto__',{}),phI18nT('queue.plan_saved',{po:{toString(){throw new Error('x')}}},'en')].length")===6;}catch(e){return false;}})();
  o['T: a param value containing a token is not re-expanded']=a.R("phI18nT('queue.plan_saved',{po:'{po}{x}'},'en')")==='Plan saved for {po}{x}';
  o['Pair: both languages']=(p=>p.en==='Retry'&&p.ur===T['shell.retry'].ur)(a.R("phI18nPair('shell.retry')"));

  // language rules
  o['lang: uzaib defaults to ur-first']=a.R("phI18nLangFor('uzaib')")==='ur-first'&&a.R("phI18nGetLang('uzaib')")==='ur-first';
  o['lang: everyone else defaults to en']=['afnan','ammar','mustafa','raees','','x'].every(u=>a.R("phI18nLangFor("+J(u)+")")==='en'&&a.R("phI18nGetLang("+J(u)+")")==='en');
  o['lang: the urdu-first list is exactly uzaib']=J(a.R('PH_I18N_URDU_FIRST_USERS'))===J(['uzaib']);
  const b=boot(src);
  b.R("phI18nSetLang('en')");
  o['lang: a stored preference beats the default (uzaib -> en)']=b.R("phI18nLangFor('uzaib')")==='en'&&b.store['groovy-ph-lang']==='en';
  b.R("phI18nSetLang('ur-first')");
  o['lang: a stored preference beats the default (afnan -> ur-first)']=b.R("phI18nLangFor('afnan')")==='ur-first'&&b.R("phI18nGetLang('afnan')")==='ur-first';
  o['lang: a value already in storage (another tab, an earlier visit) wins over the default']=(()=>{const c=boot(src);c.store['groovy-ph-lang']='en';const d=boot(src);d.store['groovy-ph-lang']='ur-first';return c.R("phI18nLangFor('uzaib')")==='en'&&d.R("phI18nGetLang('afnan')")==='ur-first';})();
  o['lang: an invalid setLang is refused and stores nothing']=(()=>{const c=boot(src);return c.R("phI18nSetLang('fr')")===false&&c.store['groovy-ph-lang']===undefined;})();
  o['lang: a garbage stored value is ignored']=(()=>{const c=boot(src);c.store['groovy-ph-lang']='klingon';return c.R("phI18nLangFor('uzaib')")==='ur-first'&&c.R("phI18nLangFor('afnan')")==='en';})();
  o['lang: storage blocked -> default, no throw']=(()=>{const c=boot(src,{blocked:true});try{return c.R("phI18nLangFor('uzaib')")==='ur-first'&&c.R("phI18nLangFor('afnan')")==='en';}catch(e){return false;}})();
  o['lang: storage blocked -> setLang still works for the session and does not throw']=(()=>{const c=boot(src,{blocked:true});try{c.R("phI18nSetLang('en')");return c.R("phI18nLangFor('uzaib')")==='en';}catch(e){return false;}})();
  o['lang: no localStorage object at all -> default']=(()=>{const c=boot(src,{noLS:true});try{c.R("phI18nSetLang('ur-first')");return c.R("phI18nLangFor('afnan')")==='ur-first';}catch(e){return false;}})();
  o['lang: with no argument it uses the signed-in session']=(()=>{const c=boot(src,{session:{u:'uzaib'}});return c.R('phI18nLangFor()')==='ur-first';})();
  o['change: the callback fires once per change with the language']=(()=>{
    const c=boot(src);c.R("globalThis.__n=[];phI18nOnChange(function(l){__n.push(l);})");c.R("phI18nSetLang('en')");
    return J(c.R('__n'))===J(['en']);})();
  o['change: unsubscribe works, a throwing listener does not block the others']=(()=>{
    const c=boot(src);c.R("globalThis.__n=0;var off=phI18nOnChange(function(){__n++;});phI18nOnChange(function(){throw new Error('x');});phI18nOnChange(function(){__n+=10;});");
    c.R("phI18nSetLang('en')");c.R('off()');c.R("phI18nSetLang('ur-first')");return c.R('__n')===(1+10+10);})();
  o['change: an invalid setLang fires nothing']=(()=>{const c=boot(src);c.R("globalThis.__n=0;phI18nOnChange(function(){__n++;});phI18nSetLang('zz')");return c.R('__n')===0;})();

  // nodes
  const D=a.doc;
  const urNode=a.R("phI18nNode(document,'queue.plan_saved',{po:'PO-9'},{lang:'ur-first'})");
  const kids=urNode.children;
  o['node: ur-first is a block of Urdu span then English span']=kids.length===2&&kids[0].className==='phi-ur'&&kids[1].className==='phi-en'&&urNode.className==='phi-pair';
  o['node: ur span has lang=ur dir=rtl, en span lang=en dir=ltr']=kids[0].getAttribute('lang')==='ur'&&kids[0].getAttribute('dir')==='rtl'&&kids[1].getAttribute('lang')==='en'&&kids[1].getAttribute('dir')==='ltr';
  o['node: texts are the filled strings']=kids[1].textContent==='Plan saved for PO-9'&&/PO-9/.test(kids[0].textContent);
  const enNode=a.R("phI18nNode(document,'queue.plan_saved',{po:'PO-9'},{lang:'en'})");
  o['node: en is a single English span with no Urdu']=enNode.children.length===0&&enNode.textContent==='Plan saved for PO-9'&&enNode.getAttribute('lang')==='en';
  o['node: the default follows the person (uzaib ur-first, afnan en)']=(()=>{
    const u=boot(src,{session:{u:'uzaib'}}),f=boot(src,{session:{u:'afnan'}});
    return u.R("phI18nNode(document,'shell.retry').children.length")===2&&f.R("phI18nNode(document,'shell.retry').children.length")===0;})();
  o['node: opts.tag picks the wrapper element']=a.R("phI18nNode(document,'shell.retry',null,{lang:'ur-first',tag:'div'}).tagName")==='DIV';
  const evil='<img src=x onerror=alert(1)>"&';
  const hn=a.R("phI18nNode(document,'queue.plan_saved',{po:"+J(evil)+"},{lang:'ur-first'})");
  o['XSS: a hostile param is only ever text content']=hn.children[1].textContent==='Plan saved for '+evil&&hn.children[1].children.length===0&&hn.children[0].children.length===0&&!/onerror=alert/.test(domkit.toHtml(hn).replace(/&lt;img src=x onerror=alert\(1\)&gt;/g,''));
  o['XSS: toHtml shows the hostile string escaped']=domkit.toHtml(hn).indexOf('<img')<0;

  // toggle
  const tg=a.R("phI18nToggleNode(document,'uzaib')");
  const bt=tg.children;
  o['toggle: a group with two buttons, اردو then English']=tg.getAttribute('role')==='group'&&bt.length===2&&bt[0].textContent==='اردو'&&bt[1].textContent==='English'&&bt.every?true:false;
  o['toggle: bilingual aria-label']=/Language/.test(tg.getAttribute('aria-label'))&&/زبان/.test(tg.getAttribute('aria-label'));
  o['toggle: buttons are type=button with lang/dir and aria-pressed']=bt.every(x=>x.getAttribute('type')==='button'&&x.getAttribute('aria-pressed')!==null&&x.getAttribute('lang')&&x.getAttribute('dir'));
  o['toggle: uzaib starts with Urdu pressed']=bt[0].getAttribute('aria-pressed')==='true'&&bt[1].getAttribute('aria-pressed')==='false';
  o['toggle: afnan starts with English pressed']=(()=>{const t=a.R("phI18nToggleNode(document,'afnan')");return t.children[1].getAttribute('aria-pressed')==='true'&&t.children[0].getAttribute('aria-pressed')==='false';})();
  o['toggle: clicking sets the language, updates aria-pressed and fires the callback once']=(()=>{
    const c=boot(src);c.R("globalThis.__n=0;phI18nOnChange(function(){__n++;})");
    const t=c.R("phI18nToggleNode(document,'afnan')");c.dom.click(t.children[0]);
    return c.R("phI18nLangFor('afnan')")==='ur-first'&&t.children[0].getAttribute('aria-pressed')==='true'&&t.children[1].getAttribute('aria-pressed')==='false'&&c.R('__n')===1;})();
  o['toggle: works with storage blocked']=(()=>{const c=boot(src,{blocked:true});const t=c.R("phI18nToggleNode(document,'afnan')");try{c.dom.click(t.children[0]);return c.R("phI18nLangFor('afnan')")==='ur-first';}catch(e){return false;}})();
  o['toggle: a hostile username is not put in the markup']=!/onerror/.test(domkit.toHtml(a.R("phI18nToggleNode(document,"+J(evil)+")")));

  // source scans
  const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:\\'"`])\/\/[^\n]*/g,'$1');
  o['source: no innerHTML / outerHTML / insertAdjacentHTML / document.write / DOMParser']=!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|\beval\s*\(|new Function/.test(code);
  o['source: every global is phI18n/_phI18n/PH_I18N_ prefixed']=(()=>{const g=[...code.matchAll(/^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m=>m[1]);return g.length>5&&g.every(n=>/^(phI18n|_phI18n|PH_I18N_)/.test(n));})();
  o['source: no PDF / jsPDF reference (Urdu must never reach a PDF)']=!/jsPDF|printDocument/.test(code);
  // css
  o['css: no literal colour in the block']=!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(CSS.replace(/\/\*[\s\S]*?\*\//g,''));
  o['css: status classes use only theme tokens']=['phi-ok','phi-warn','phi-bad','phi-info'].every(c=>new RegExp('\\.'+c+'\\{[^}]*var\\(--(accent|cat)-').test(CSS));
  o['css: .phi-ur has the spec (1.25em, 1.9, right, rtl, Jameel stack)']=/\.phi-ur\{[^}]*Jameel Noori Nastaleeq[^}]*font-size:1\.25em[^}]*line-height:1\.9[^}]*text-align:right[^}]*direction:rtl/.test(CSS);
  o['css: .phi-en is .8em muted']=/\.phi-en\{[^}]*font-size:\.8em[^}]*var\(--muted\)/.test(CSS);
  o['css: switch targets are 44px']=/\.phi-switch-btn\{[^}]*min-width:44px;min-height:44px/.test(CSS);
  o['css: the block is delimited and brace-balanced']=/ph-i18n START/.test(CSS)&&/ph-i18n END/.test(CSS)&&(CSS.match(/\{/g)||[]).length===(CSS.match(/\}/g)||[]).length;
  return o;
}

module.exports=async function(){
  const s=suite('ph-i18n');
  const base=checks(SRC);
  s.section('ph-i18n: strings, language rules, nodes');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('ph-i18n: each guard reverted once must fail its check');
  let n=0;
  const brk=(label,from,to,failing,srcOverride)=>{
    const base0=srcOverride||SRC;
    if(base0.split(from).length-1<1){s.ok('break target exists: '+label,false);return;}
    const mut=base0.split(from).join(to);
    let r;try{r=checks(mut);}catch(e){r={};}
    failing.forEach(f=>{n++;s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true);});
  };
  brk('fill ignores params','return Object.prototype.hasOwnProperty.call(params,k)?_phI18nStr(params[k]):m;','return m;',['T: fills params in en and ur']);
  brk('fallback to key removed',"if(!e)return _phI18nStr(key);","if(!e)return '';",['T: unknown key returns the key']);
  brk('fallback to en removed',"const raw=(want==='ur'&&e.ur)?e.ur:(e.en||_phI18nStr(key));","const raw=e[want];",['T: missing ur falls back to en']);
  brk('T can throw',"}catch(x){return _phI18nStr(key);}\n}\nfunction phI18nPair","}catch(x){throw x;}\n}\nfunction phI18nPair",['T: hostile inputs never throw']);
  brk('uzaib list widened',"['uzaib']","['uzaib','afnan']",['lang: everyone else defaults to en','lang: the urdu-first list is exactly uzaib']);
  brk('stored preference ignored',"if(_phI18nLangOk(v))return v;\n  }catch(e){}\n  if(_phI18nLangOk(_phI18nMem))","if(false)return v;\n  }catch(e){}\n  if(_phI18nLangOk(_phI18nMem))",['lang: a value already in storage (another tab, an earlier visit) wins over the default']);
  brk('storage errors not caught on read',"}catch(e){}\n  if(_phI18nLangOk(_phI18nMem))return _phI18nMem;","}finally{}\n  if(_phI18nLangOk(_phI18nMem))return _phI18nMem;",['lang: storage blocked -> default, no throw']);
  brk('storage errors not caught on write',"try{const st=_phI18nStore();if(st)st.setItem(PH_I18N_LANG_KEY,lang);}catch(e){}","{const st=_phI18nStore();if(st)st.setItem(PH_I18N_LANG_KEY,lang);}",['lang: storage blocked -> setLang still works for the session and does not throw']);
  brk('memory fallback removed',"if(_phI18nLangOk(_phI18nMem))return _phI18nMem;","",['lang: storage blocked -> setLang still works for the session and does not throw']);
  brk('invalid lang accepted',"if(!_phI18nLangOk(lang))return false;","",['lang: an invalid setLang is refused and stores nothing','change: an invalid setLang fires nothing']);
  brk('callback fires twice',"_phI18nListeners.slice().forEach(function(fn){try{fn(lang);}catch(e){}});","_phI18nListeners.slice().forEach(function(fn){try{fn(lang);fn(lang);}catch(e){}});",['change: the callback fires once per change with the language']);
  brk('a throwing listener blocks the rest',"try{fn(lang);}catch(e){}","fn(lang);",['change: unsubscribe works, a throwing listener does not block the others']);
  brk('node uses innerHTML',"s.textContent=text;","s.innerHTML=text;",['source: no innerHTML / outerHTML / insertAdjacentHTML / document.write / DOMParser']);
  brk('Urdu line dropped',"wrap.appendChild(_phI18nSpan(doc,'phi-ur','ur','rtl',pair.ur));","",['node: ur-first is a block of Urdu span then English span']);
  brk('rtl dropped',"_phI18nSpan(doc,'phi-ur','ur','rtl',pair.ur)","_phI18nSpan(doc,'phi-ur','ur','ltr',pair.ur)",['node: ur span has lang=ur dir=rtl, en span lang=en dir=ltr']);
  brk('node ignores the person',"const lang=_phI18nLangOk(o.lang)?o.lang:phI18nLangFor(o.username);","const lang=_phI18nLangOk(o.lang)?o.lang:'en';",['node: the default follows the person (uzaib ur-first, afnan en)']);
  brk('toggle aria-pressed dropped',"b.setAttribute('aria-pressed',cur===d[0]?'true':'false');","",['toggle: buttons are type=button with lang/dir and aria-pressed']);
  brk('toggle label not bilingual',"'Language / زبان'","'Language'",['toggle: bilingual aria-label']);
  brk('toggle click does not store',"phI18nSetLang(d[0]);\n      const kids","const kids",['toggle: clicking sets the language, updates aria-pressed and fires the callback once']);
  brk('Urdu token dropped from one string',"'{po} کھولیں'","'کھولیں'",['table: every {token} of en is in ur, and the reverse']);
  brk('an empty Urdu string',"A('shell.retry','Retry','دوبارہ کوشش');","A('shell.retry','Retry','');",['table: every key has non-empty ur and en']);
  brk('Eastern digits in Urdu',"A('queue.age_here','{n}d here','{n} دن سے یہاں');","A('queue.age_here','{n}d here','٣ دن سے یہاں {n}');",['table: Urdu uses Western digits only']);
  brk('a jsPDF reference',"const PH_I18N_LANGS=","const _phI18nX=typeof jsPDF;const PH_I18N_LANGS=",['source: no PDF / jsPDF reference (Urdu must never reach a PDF)']);
  s.ok('breaks run: '+n,n>=20);
  return s;
};

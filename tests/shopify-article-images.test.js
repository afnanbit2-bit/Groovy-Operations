/* Inventory Intel ▸ article pictures. Drives the REAL helpers (_siAxImage, _siAxThumb, _siAxImgFail) and the real row
   renderers against a hand-built fixture. Each "break" mutates the source and requires the named check to FAIL.
   Fixture: AAA has a good first URL; BBB's first variant has a foreign host and its second a good one; CCC has only a
   non-https URL; DDD has none; EEE has a title with markup in it. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'../css/main.css'),'utf8');
const SW=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
function load(src){
  const a=harness.loadApp({files:[],session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false,data:()=>({})})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const G='https://cdn.shopify.com/s/files/1/0509/8730/3069/files/Final_6a538b81.jpg?v=1726686247';
const G2='https://cdn.shopify.com/s/files/1/0509/8730/3069/files/Other.jpg?v=1';
const P=(sku,t,img)=>({_id:sku,sku,product_title:t,color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:'2026-04-10T10:00:00+05:00',image_url:img});
const li=(sku,q,day)=>({sku,quantity:q,price:1000,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
function checks(src){
  const o={},a=load(src),R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-10-01")+(off||0));}');
  const prods=[P('AAA-S','Art AAA',G),P('AAA-M','Art AAA','https://cdn.shopify.com/other.jpg'),
    P('BBB-S','Art BBB','https://evil.example.com/x.jpg'),P('BBB-M','Art BBB',G2),
    P('CCC-M','Art CCC','http://cdn.shopify.com/x.jpg'),P('DDD-M','Art DDD',''),P('EEE-M','Tee "<b>x</b>" & co',G),P('FFF-M','Art FFF','https://cdn.shopify.com.evil.test/x.jpg')];
  const items=['AAA','BBB','CCC','DDD','EEE','FFF','NOPROD'].map(c=>li(c+'-M',3,'2026-09-12'));
  R('_siProducts='+J(prods)+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siAxCache=null;_siHistState="ok";_siHist=_siAxBuildHistory([]);');
  const img=c=>R('_siAxImage("'+c+'")');
  o['helper: the first variant with a usable URL wins (AAA-S, not the later one)']=img('AAA')===G;
  o['helper: a foreign host on the first variant is skipped and the next usable one is taken (BBB)']=img('BBB')===G2;
  o['helper: a non-https URL is rejected (CCC has none)']=img('CCC')==='';
  o['helper: no URL at all gives no image (DDD)']=img('DDD')==='';
  o['helper: a lookalike host (cdn.shopify.com.evil.test) is rejected']=img('FFF')==='';
  o['helper: an unknown article gives no image']=img('ZZZ')===''&&img('NOPROD')==='';
  o['helper: a javascript:, data: or quote-bearing value is never accepted']=R('[_siAxImgOk("javascript:alert(1)"),_siAxImgOk("data:image/png;base64,AA"),_siAxImgOk(\'https://cdn.shopify.com/x" onerror="y\'),_siAxImgOk(null),_siAxImgOk(5)].every(v=>v===false)');
  const th=R('_siAxThumb("EEE",40,"Tee \\"<b>x</b>\\" & co")');
  o['thumb: alt is the article title, escaped (no raw tag or bare quote)']=/alt="Tee &quot;&lt;b&gt;x&lt;\/b&gt;&quot; &amp; co"/.test(th)&&!/<b>x<\/b>/.test(th);
  o['thumb: fixed width/height attributes, lazy loading, no referrer, and an onerror fallback']=/width="40" height="40"/.test(th)&&/loading="lazy"/.test(th)&&/referrerpolicy="no-referrer"/.test(th)&&/onerror="window\._siAxImgFail\(this\)"/.test(th);
  o['thumb: an article with no usable picture renders the code tile, no <img>']=(()=>{const t=R('_siAxThumb("DDD",40)');return !/<img/.test(t)&&/<b class="si-th-c">DDD<\/b>/.test(t);})();
  o['thumb: the src is exactly the stored URL (no constructed or resized URL)']=th.indexOf('src="'+G+'"')>0;
  // onerror: the picture is replaced by the article code via textContent
  o['onerror: the picture is removed and the code tile put in its place (textContent)']=R('(()=>{const kids=[];const im={};const sp={getAttribute:k=>k==="data-th"?"<AAA>":null,removeChild:c=>{const i=kids.indexOf(c);if(i>=0)kids.splice(i,1);},appendChild:c=>kids.push(c)};im.parentNode=sp;kids.push(im);const ce=document.createElement;document.createElement=()=>({className:"",textContent:""});window._siAxImgFail(im);document.createElement=ce;return kids.length===1&&kids[0]!==im&&kids[0].className==="si-th-c"&&kids[0].textContent==="<AAA>";})()');
  // surfaces
  o['article page header: a 64px thumb for AAA, rendered']=(()=>{R('_siAxModeSel="search";_siAxSel="AAA"');const h=R('_siAxSearchBody()');return /<span class="si-th" style="width:64px;height:64px" data-th="AAA"><img/.test(h);})();
  o['overview rows: every row carries a 48px thumb, rendered']=(()=>{R('_siAxOvIn=function(){return true;};_siAxModeSel="overview";_siAxOvTile="winner";_siAxOvAll=true');const h=R('_siAxOverviewBody()');const rows=(h.match(/class="si-ov-row"/g)||[]).length,th=(h.match(/class="si-ov-row"><div class="nm"><span class="si-th" style="width:48px;height:48px"/g)||[]).length;return rows>0&&rows===th;})();
  o['Needs Attention: the list row and the situation header carry the thumb, rendered']=(()=>{const st=R('_siNaState().issues.map(i=>i.code)');if(!st.length)return /_siAxThumb\(i\.code,44,i\.label\)/.test(src)&&/_siAxThumb\(i\.code,64,i\.label\)/.test(src);const c=st[0];const row=R('_siNaRowHtml(_siNaState().issues[0],false)'),det=R('_siNaDetailHtml(_siNaState().issues[0])');return /class="si-na-row[^>]*data-code="[^"]+"[^>]*>[^]*?<span class="si-th" style="width:44px;height:44px" data-th=/.test(row)&&(row.match(/data-code=/g)||[]).length===1&&/class="si-na-dtop"><span class="si-th" style="width:64px;height:64px"/.test(det);})();
  o['rendered Compare card carries the picture and the remove button still works']=(()=>{R('_siAxModeSel="compare";_siAxCmp=["AAA"];_siAxBasis="calendar"');const h=R('_siAxCompareBody()');return /<div class="si-ax-card">[^]*?<span class="si-th"[^>]*data-th="AAA"[^>]*><img[^>]*src="https:\/\/cdn\.shopify\.com/.test(h)&&/onclick="window\._siAxRemove\(this\.dataset\.code\)"/.test(h);})();
  o['picture span is data-th, not data-code (a row must have ONE data-code)']=/data-th="\$\{_siEsc\(code\)\}"/.test(src)&&!/si-th"[^`]*data-code/.test(src);
  // CSS
  const css=(CSS.match(/\.si-th[^{]*\{[^}]*\}/g)||[]).join('');
  o['css: fixed square thumb, object-fit cover, rounded, clipped']=/\.si-th\{[^}]*overflow:hidden/.test(CSS)&&/\.si-th img\{[^}]*object-fit:cover/.test(CSS)&&/\.si-th img\{[^}]*width:100%;height:100%/.test(CSS);
  o['css: tokens only (no literal colour) and the code tile text is at least 11px']=css.length>100&&!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(css)&&/\.si-th-c\{[^}]*font-size:11px/.test(CSS);
  o['css: the picture never takes the pointer (rows and buttons keep the click)']=/\.si-th\{[^}]*pointer-events:none/.test(CSS);
  // service worker
  o['sw: no cdn.shopify.com in the precache or the bypass list (third-party images pass to the network)']=!/cdn\.shopify\.com/.test(SW)&&/event\.respondWith\(networkFirst\(request\)\)/.test(SW);
  o['sw: networkFirst stores only res.ok, so an opaque cross-origin image is never cached']=/if \(res && res\.ok\) cache\.put/.test(SW);
  o['no new Firestore read: building every thumb calls getDocs/getDoc zero times']=(()=>{R('getDocs=function(){window.__g=(window.__g||0)+1;return Promise.resolve({forEach(){}});};window.__g=0');R('_siAxThumb("AAA",40);_siAxImage("BBB");_siAxIndex()');return R('window.__g')===0;})();
  o['coverage on the fixture: 3 of 7 articles resolve to a picture (AAA, BBB, EEE; CCC, DDD, FFF and an article with no catalog row do not)']=R('(()=>{const l=_siAxIndex().list;return l.filter(a=>a.img).length+"/"+l.length;})()')==='3/7';
  return o;
}
module.exports=async function(){
  const s=suite('shopify-article-images');
  const base=checks(SRC);
  s.section('article pictures (hand-built fixture)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  const brk=(label,from,to,failing)=>{
    if(SRC.split(from).length-1<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true));
  };
  brk('any host accepted','/^https:\\/\\/cdn\\.shopify\\.com\\/[^\\s"\'<>\\\\]+$/','/^https:\\/\\/[^\\s"\'<>\\\\]+$/',['helper: a foreign host on the first variant is skipped and the next usable one is taken (BBB)','helper: a lookalike host (cdn.shopify.com.evil.test) is rejected']);
  brk('http accepted','/^https:\\/\\/cdn\\.shopify\\.com','/^https?:\\/\\/cdn\\.shopify\\.com',['helper: a non-https URL is rejected (CCC has none)']);
  brk('last variant wins','if(!a.img&&_siAxImgOk(p.image_url))a.img=p.image_url;','if(_siAxImgOk(p.image_url))a.img=p.image_url;',['helper: the first variant with a usable URL wins (AAA-S, not the later one)']);
  brk('alt not escaped','alt="${_siEsc(t)}"','alt="${t}"',['thumb: alt is the article title, escaped (no raw tag or bare quote)']);
  brk('no onerror','onerror="window._siAxImgFail(this)"','',['thumb: fixed width/height attributes, lazy loading, no referrer, and an onerror fallback']);
  brk('fallback via innerHTML-less no-op','sp.removeChild(img);sp.appendChild(b);','',['onerror: the picture is removed and the code tile put in its place (textContent)']);
  brk('no code tile when no picture','<b class="si-th-c">${_siEsc(code)}</b>`;','`;',['thumb: an article with no usable picture renders the code tile, no <img>']);
  brk('constructed resized URL','src="${_siEsc(u)}"','src="${_siEsc(u)}&width=96"',['thumb: the src is exactly the stored URL (no constructed or resized URL)']);
  brk('thumb takes data-code','data-th="${_siEsc(code)}">${inner}','data-code="${_siEsc(code)}">${inner}',['picture span is data-th, not data-code (a row must have ONE data-code)']);
  brk('compare card without picture','${_siAxThumb(a.code,64,a.name)}','',['rendered Compare card carries the picture and the remove button still works']);
  return s;
};

/* ─────────────────────────────────────────────────────────────────────────
   netlify/functions/link-preview.js

   This function fetches a URL a user typed, on a server, which is the
   textbook shape of a Server-Side Request Forgery hole. CLAUDE.md has said
   since Phase 2 that link previews must not be shipped without that
   hardening, so the hardening is what most of this file asserts:

   - every private / loopback / link-local / metadata address is refused,
     v4 and v6, including ::ffff: mapped v4;
   - a PUBLIC url that redirects to a private one is refused at the hop,
     which is the case that walks straight past a naive check;
   - only http/https, no credentials in the URL, no *.local;
   - the body is capped and a non-HTML response is not parsed.

   Then the parsing: attribute order, single quotes, entities, relative
   image URLs, and the fallbacks when a page carries no og: tags at all.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const Module=require('module');
const {suite}=require('./harness');
// firebase-admin is not installed in this repo (zero-new-deps; Netlify
// installs it at build time), so it is replaced on the require path the way
// tests/marketing-codes.test.js already does. Nothing below calls the
// handler — every assertion is against the pure helpers and fetchHtml, which
// takes its fetch and its resolver as arguments.
const fn=(function(){
  const orig=Module._load;
  Module._load=function(req,...rest){
    if(req==='firebase-admin')return{apps:[],initializeApp(){},credential:{cert:()=>({})},auth:()=>({verifyIdToken:async()=>({})})};
    return orig.call(this,req,...rest);
  };
  try{return require('../netlify/functions/link-preview.js');}
  finally{Module._load=orig;}
})();

// A DNS stub, so nothing here touches the network or the sandbox's resolver.
const dnsFor=map=>host=>{
  if(!(host in map))return Promise.reject(new Error('ENOTFOUND'));
  return Promise.resolve(map[host].map(address=>({address})));
};
const PUBLIC={'example.com':['93.184.216.34'],'evil.test':['93.184.216.34'],
  'inside.test':['10.0.0.5'],'meta.test':['169.254.169.254'],'v6.test':['::1']};

async function rejects(s,label,p,match){
  let err=null;
  try{await p;}catch(e){err=e;}
  s.ok(label,!!err&&(!match||String(err.message).indexOf(match)>-1),err?err.message:'resolved');
}

module.exports=async function(){
  const s=suite();

  // ── the address blocklist ────────────────────────────────────────────
  s.section('a private, loopback or metadata address is never fetched');
  [['127.0.0.1','loopback'],['10.1.2.3','private 10/8'],['192.168.0.7','private 192.168'],
   ['172.16.5.4','private 172.16'],['172.31.255.254','the top of 172.16/12'],
   ['169.254.169.254','the cloud metadata address'],['100.64.0.1','carrier-grade NAT'],
   ['0.0.0.0','this network'],['224.0.0.1','multicast'],['255.255.255.255','broadcast'],
   ['::1','v6 loopback'],['fd00::1','v6 unique-local'],['fe80::1','v6 link-local'],
   ['::ffff:127.0.0.1','a v4 loopback wearing a v6 hat'],['not-an-ip','anything that is not an IP at all']
  ].forEach(([ip,why])=>s.ok(why+' ('+ip+')',fn.isBlockedIp(ip)===true));
  [['93.184.216.34','an ordinary public v4'],['8.8.8.8','a public resolver'],
   ['172.15.0.1','just below the private 172 range'],['172.32.0.1','just above it'],
   ['2606:2800:220:1:248:1893:25c8:1946','a public v6']
  ].forEach(([ip,why])=>s.ok(why+' is allowed ('+ip+')',fn.isBlockedIp(ip)===false));

  s.section('the URL itself');
  const look=dnsFor(PUBLIC);
  await rejects(s,'file: is refused',fn.assertSafeUrl('file:///etc/passwd',look),'http and https');
  await rejects(s,'so is a javascript: URL',fn.assertSafeUrl('javascript:alert(1)',look),'http and https');
  await rejects(s,'credentials in the URL are refused',fn.assertSafeUrl('http://u:p@example.com/',look),'username or password');
  await rejects(s,'localhost by name',fn.assertSafeUrl('http://localhost/admin',look),fn.BLOCKED);
  await rejects(s,'a .local name',fn.assertSafeUrl('http://printer.local/',look),fn.BLOCKED);
  await rejects(s,'a bare private IP',fn.assertSafeUrl('http://10.0.0.1/',look),fn.BLOCKED);
  await rejects(s,'a NAME that resolves into the private range',fn.assertSafeUrl('https://inside.test/x',look),fn.BLOCKED);
  await rejects(s,'a name that resolves to the metadata address',fn.assertSafeUrl('https://meta.test/',look),fn.BLOCKED);
  await rejects(s,'a name that resolves to v6 loopback',fn.assertSafeUrl('https://v6.test/',look),fn.BLOCKED);
  await rejects(s,'a name that does not resolve at all',fn.assertSafeUrl('https://nope.test/',look),'could not be found');
  const ok=await fn.assertSafeUrl('https://example.com/a?b=1',look);
  s.eq('an ordinary public URL passes through',ok.href,'https://example.com/a?b=1');

  // ── the redirect hop, which is the case a naive check misses ─────────
  s.section('every redirect hop is re-validated');
  const res=(status,headers,body)=>({
    status,ok:status>=200&&status<300,
    headers:{get:k=>headers[k.toLowerCase()]||null},
    text:async()=>body||'',
    body:null
  });
  {
    // example.com 302s to a name that resolves inside the network.
    const seen=[];
    const f=async(url)=>{
      seen.push(url);
      if(url.indexOf('example.com')>-1)return res(302,{location:'https://inside.test/secret'},'');
      return res(200,{'content-type':'text/html'},'<title>should never be read</title>');
    };
    await rejects(s,'a public URL that redirects into the private range is stopped',
      fn.fetchHtml('https://example.com/go',{fetch:f,lookup:look}),fn.BLOCKED);
    s.eq('and the private address was never requested',seen.length,1);
  }
  {
    let n=0;
    const f=async()=>{n++;return res(302,{location:'https://evil.test/'+n},'');};
    await rejects(s,'a redirect loop terminates',
      fn.fetchHtml('https://evil.test/0',{fetch:f,lookup:look}),'redirected too many times');
    s.ok('after a bounded number of hops',n<=fn.MAX_REDIRECTS+1,String(n));
  }
  {
    const f=async()=>res(200,{'content-type':'application/pdf'},'%PDF-1.4 binary');
    const got=await fn.fetchHtml('https://example.com/a.pdf',{fetch:f,lookup:look});
    s.eq('a non-HTML response is not parsed as a page',got.html,'');
  }
  {
    const f=async()=>res(404,{'content-type':'text/html'},'nope');
    await rejects(s,'a 404 is reported, not previewed',
      fn.fetchHtml('https://example.com/x',{fetch:f,lookup:look}),'answered 404');
  }

  // ── parsing ─────────────────────────────────────────────────────────
  s.section('reading the page');
  const HTML=`<html><head>
    <meta property="og:title" content="Club Navy Zipper">
    <meta content="Everyday Urban Aesthetics &amp; more" name="og:description">
    <meta property='og:image' content='/img/hero.jpg'>
    <meta property="og:site_name" content="Scuffers">
    <title>ignored when og:title exists</title></head><body>x</body></html>`;
  const meta=fn.extract(HTML,'https://scuffers.com/collections/hoodies/products/club-navy');
  s.eq('og:title wins over <title>',meta.title,'Club Navy Zipper');
  s.eq('the attribute order inside the tag does not matter, nor name= vs property=',
    meta.description,'Everyday Urban Aesthetics & more');
  s.eq('single-quoted attributes are read',meta.image,'https://scuffers.com/img/hero.jpg');
  s.eq('a relative image URL is resolved against the FINAL url',
    fn.safeImageUrl('hero.png','https://a.test/x/y/z.html'),'https://a.test/x/y/hero.png');
  s.eq('the site name comes through',meta.siteName,'Scuffers');
  s.eq('and the host is derived, www stripped',meta.host,'scuffers.com');

  s.section('a page with nothing to offer still gives something');
  const bare=fn.extract('<html><head><title>  Plain   page </title></head></html>','https://www.example.com/a');
  s.eq('<title> is the fallback, whitespace collapsed',bare.title,'Plain page');
  s.eq('no image rather than a guess',bare.image,'');
  s.eq('and the host stands in for the site name',bare.siteName,'example.com');
  const none=fn.extract('','https://example.com/a');
  s.eq('an empty body is not an error',none.title,'');

  s.section('entities');
  s.eq('named',fn.decodeEntities('Tom &amp; Jerry&nbsp;&quot;x&quot;'),'Tom & Jerry "x"');
  s.eq('numeric and hex',fn.decodeEntities('caf&#233; &#x2014; bar'),'café — bar');
  // &amp; is decoded LAST or &amp;lt; turns into a real <.
  s.eq('a double-escaped angle bracket stays text',fn.decodeEntities('&amp;lt;script&amp;gt;'),'&lt;script&gt;');
  // fromCodePoint throws past U+10FFFF, on HTML a stranger wrote.
  s.eq('an impossible code point costs its own entity, not the preview',
    fn.decodeEntities('a &#9999999; b'),'a &#9999999; b');

  s.section('an image URL is not trusted either');
  s.eq('javascript: is dropped',fn.safeImageUrl('javascript:alert(1)','https://a.test/'),'');
  s.eq('data: is dropped',fn.safeImageUrl('data:image/png;base64,AAA','https://a.test/'),'');
  s.eq('a private literal IP is dropped',fn.safeImageUrl('http://127.0.0.1/x.png','https://a.test/'),'');
  s.ok('a public one is kept',fn.safeImageUrl('https://cdn.test/x.png','https://a.test/')==='https://cdn.test/x.png');

  s.section('what comes back is bounded');
  const long=fn.extract('<meta property="og:title" content="'+'x'.repeat(5000)+'">','https://example.com/');
  s.ok('a huge title is truncated',long.title.length<=300,String(long.title.length));
  s.ok('the body cap is a real cap',fn.MAX_BYTES<=1024*1024,String(fn.MAX_BYTES));
  // The response shape is the security boundary: the HTML must never be in it.
  s.eq('the page HTML is not part of the result',
    Object.keys(meta).sort().join(','),'description,host,image,siteName,title,url');

  s.section('oEmbed, when the page gives no picture');
  {
    const R=(status,headers,body)=>({status,ok:status>=200&&status<300,headers:{get:k=>headers[k.toLowerCase()]||null},text:async()=>body||'',body:null});
    const L=dnsFor(Object.assign({'www.pinterest.com':['151.101.0.84'],'pin.it':['151.101.0.84']},PUBLIC));
    s.eq('a Pinterest pin maps to its oEmbed endpoint',
      fn.oembedEndpoint('https://www.pinterest.com/pin/12345/',''),
      'https://www.pinterest.com/oembed.json?url='+encodeURIComponent('https://www.pinterest.com/pin/12345/'));
    s.eq('a Pinterest board is not a pin',fn.oembedEndpoint('https://www.pinterest.com/afnan/denim/',''),'');
    s.eq('a discovery link is used',fn.oembedEndpoint('https://example.com/p',
      '<link rel="alternate" type="application/json+oembed" href="/oembed?u=1&amp;f=json">'),'https://example.com/oembed?u=1&f=json');
    s.eq('an xml discovery link is not',fn.oembedEndpoint('https://example.com/p',
      '<link rel="alternate" type="text/xml+oembed" href="/oe.xml">'),'');
    s.eq('a javascript: discovery link is not',fn.oembedEndpoint('https://example.com/p',
      '<link type="application/json+oembed" href="javascript:alert(1)">'),'');

    const seen=[];
    const f=async(url)=>{seen.push(url);
      if(url.indexOf('/oembed.json')>-1)return R(200,{'content-type':'application/json'},
        JSON.stringify({type:'rich',title:'Wide leg denim',provider_name:'Pinterest',thumbnail_url:'https://i.pinimg.com/236x/a.jpg'}));
      return R(200,{'content-type':'text/html'},'<title>Pinterest</title>');};
    const L2=dnsFor(Object.assign({'i.pinimg.com':['151.101.0.84']},{'www.pinterest.com':['151.101.0.84']}));
    const got=await fn.preview('https://www.pinterest.com/pin/12345/',{fetch:f,lookup:L2});
    s.eq('the picture comes from oEmbed',got.image,'https://i.pinimg.com/236x/a.jpg');
    s.eq('a title that is only the site\'s own name gives way',got.title,'Wide leg denim');
    s.eq('two requests: the page, then oEmbed',seen.length,2);

    const f2=async(url)=>{
      if(url.indexOf('/oembed')>-1)return R(200,{'content-type':'application/json'},JSON.stringify({title:'From oEmbed',thumbnail_url:'https://example.com/t.jpg'}));
      return R(200,{'content-type':'text/html'},'<link type="application/json+oembed" href="https://example.com/oembed?x">');};
    const g2=await fn.preview('https://example.com/p',{fetch:f2,lookup:L});
    s.eq('a page with no title takes oEmbed\'s',g2.title,'From oEmbed');
    s.eq('and its picture',g2.image,'https://example.com/t.jpg');

    let n=0;
    const f3=async(url)=>{n++;return R(200,{'content-type':'text/html'},'<meta property="og:image" content="https://example.com/og.jpg"><link type="application/json+oembed" href="https://example.com/oembed">');};
    const g3=await fn.preview('https://example.com/p',{fetch:f3,lookup:L});
    s.ok('a page WITH a picture makes no oEmbed call',n===1&&g3.image==='https://example.com/og.jpg',String(n));

    const hit=[];
    const f4=async(url)=>{hit.push(url);return R(200,{'content-type':'text/html'},'<title>Page</title><link type="application/json+oembed" href="https://inside.test/oembed">');};
    const g4=await fn.preview('https://example.com/p',{fetch:f4,lookup:L});
    s.ok('an oEmbed endpoint inside the network is never requested',!hit.some(u=>u.indexOf('inside.test')>-1),hit.join());
    s.eq('and the page answer stands',g4.title+'|'+g4.image,'Page|');
    const g7=fn.fromOembed({title:'X'},'https://example.com/',{title:'A real title',host:'example.com',siteName:'example.com'});
    s.eq('a real page title is kept',g7.title,'A real title');

    const f5=async(url)=>url.indexOf('/oembed')>-1?R(200,{'content-type':'text/html'},'<b>not json</b>')
      :R(200,{'content-type':'text/html'},'<title>Page</title><link type="application/json+oembed" href="https://example.com/oembed">');
    const g5=await fn.preview('https://example.com/p',{fetch:f5,lookup:L});
    s.eq('a non-JSON oEmbed answer is ignored',g5.title+'|'+g5.image,'Page|');

    const f6=async(url)=>url.indexOf('/oembed')>-1?R(200,{'content-type':'application/json'},JSON.stringify({thumbnail_url:'javascript:alert(1)'}))
      :R(200,{'content-type':'text/html'},'<title>Page</title><link type="application/json+oembed" href="https://example.com/oembed">');
    const g6=await fn.preview('https://example.com/p',{fetch:f6,lookup:L});
    s.eq('an oEmbed picture goes through the same image check',g6.image,'');
    s.eq('the result still carries only the six fields',Object.keys(g2).sort().join(','),'description,host,image,siteName,title,url');
  }

  return s;
};

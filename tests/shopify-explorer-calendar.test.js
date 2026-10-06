/* Inventory Intel ▸ Article Explorer — attention cues, SKU-table entrance, the Calendar fix, previous year, winter and month tiles.
   Drives the REAL handlers (_siAxSetMode, _siAxAdd, _siAxRemove, _siAxSetBasis, _siSkuOpen, _siAxTogglePrev, _siAxSetWin ...)
   against a small hand-computed fixture, with a fake clock for the 1.5 s alert. Each "break" mutates the source and requires
   the named check to FAIL.

   Fixture A (today 2026-10-01, first synced order 2026-04-02): AAA live 2026-04-10, sold 10 in Apr, 20 in May ... see sales().
   Fixture B (today 2026-12-15, data from 2025-10-01): AAA sold 10/20/30 in Oct/Nov/Dec 2025 and 15/25/35 in Oct/Nov/Dec 2026;
   BBB went live 2026-06-01 (no year-earlier data by construction). */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=require('./harness');
const {suite}=harness;
const J=v=>JSON.stringify(v);
const SRC=fs.readFileSync(path.join(__dirname,'../js/shopify.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'../css/main.css'),'utf8');
function load(src,opts){
  opts=opts||{};
  const a=harness.loadApp({files:[],phone:!!opts.phone,session:{uid:'u1',u:'afnan',name:'Afnan',role:'owner'},
    globals:{localStorage:{getItem:()=>null,setItem(){},removeItem(){}},getDocs:()=>Promise.resolve({forEach(){}}),getDoc:()=>Promise.resolve({exists:()=>false,data:()=>({})})}});
  vm.runInContext(src,a.ctx,{filename:'shopify.js'});
  return a;
}
const li=(sku,q,day,price)=>({sku,quantity:q,price:price==null?1000:price,order_created_at:day+'T12:00:00+05:00',financial_status:'paid'});
const prod=(c,t,pub)=>({_id:c+'-M',sku:c+'-M',product_title:t||('Art '+c),color:'Blue',size:'M',product_type:'Tees',status:'active',published_at:pub||'2026-04-10T10:00:00+05:00'});
const HIST=(d1,d2)=>{const sn=[d1,d2].map(d=>({date:d,items:{a:{sku:'AAA-M',available:5},b:{sku:'BBB-M',available:5},c:{sku:'CCC-M',available:5}}}));return '_siHist=_siAxBuildHistory('+J(sn)+');_siHistState="ok";_siSnapshot='+J(sn[1])+';_siPrevSnapshot='+J(sn[0])+';_siAxCache=null;';};
// Fake timers inside the app's context.
const CLOCK='var __q=[],__now=0,__id=0;setTimeout=function(f,ms){__q.push({id:++__id,at:__now+(ms||0),f});return __id;};clearTimeout=function(i){__q=__q.filter(t=>t.id!==i);};'+
  'function __tick(ms){const end=__now+ms;for(;;){const d=__q.filter(t=>t.at<=end).sort((x,y)=>x.at-y.at||x.id-y.id)[0];if(!d)break;__q=__q.filter(t=>t!==d);__now=d.at;d.f();}__now=end;}';
function fixA(a){
  const R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-10-01")+(off||0));}');
  const items=[li('AAA-M',10,'2026-04-12'),li('AAA-M',20,'2026-05-12'),li('AAA-M',30,'2026-06-12'),li('AAA-M',40,'2026-07-12'),li('AAA-M',50,'2026-08-12'),li('AAA-M',60,'2026-09-12'),
    li('BBB-M',5,'2026-04-03'),li('BBB-M',7,'2026-09-05'),li('CCC-M',4,'2026-10-01'),li('ZZZ-M',1,'2026-04-02')];
  R('_siProducts='+J([prod('AAA'),prod('BBB','Art BBB','2026-04-01T10:00:00+05:00'),prod('CCC','Art CCC','2026-10-01T09:00:00+05:00'),prod('ZZZ','Art ZZZ','2026-04-01T10:00:00+05:00')])+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siAxCache=null;'+HIST('2026-09-29','2026-09-30'));
  R(CLOCK);
}
function fixB(a){
  const R=c=>a.run(c);
  R('_siPktDate=function(off){return _siAxDayStr(_siAxDayNum("2026-12-15")+(off||0));}');
  const items=[li('AAA-M',10,'2025-10-15'),li('AAA-M',20,'2025-11-15'),li('AAA-M',30,'2025-12-15'),li('AAA-M',15,'2026-10-15'),li('AAA-M',25,'2026-11-15'),li('AAA-M',35,'2026-12-10'),
    li('BBB-M',3,'2026-07-01'),li('BBB-M',6,'2026-11-20'),li('ZZZ-M',1,'2025-10-01')];
  R('_siProducts='+J([prod('AAA','Art AAA','2025-09-01T10:00:00+05:00'),prod('BBB','Art BBB','2026-06-01T10:00:00+05:00'),prod('ZZZ','Art ZZZ','2025-09-01T10:00:00+05:00')])+';_siLineItems='+J(items)+';_siOrders=[];_siWeeklyCloses=[];_siAxCache=null;'+HIST('2026-12-13','2026-12-14'));
  R(CLOCK);
}
function checks(src){
  const o={};
  const a=load(src),R=c=>a.run(c);
  fixA(a);
  const body=()=>a.el('si-ax-body').innerHTML,live=()=>a.el('si-ax-live').innerHTML;
  const flashes=()=>(live().match(/si-ax-flash/g)||[]).length;
  o['the fixture indexes AAA and sees data from 2026-04-02']=R('_siAxIndex().cov')==='2026-04-02'&&R('_siAxIndex().map.has("AAA")');

  // ── 1. the Compare hint ──
  R('_siAxModeSel="search";_siAxSel="AAA";_siAxCmpSeen=false;_siAxCmp=[]');
  const page=R('_siArticleExplorerSection()');
  const hints=(page.match(/si-ax-hint/g)||[]).length;
  o['hint: on the article page both "+ Compare" and the Compare tab pulse (2)']=hints===2&&/id="si-ax-tab-compare" class="si-ax-btn si-ax-hint"/.test(page);
  R('_siAxModeSel="overview"');
  o['hint: not on the Overview']=!/si-ax-hint/.test(R('_siArticleExplorerSection()'));
  R('_siAxModeSel="search";_siAxSel=""');
  o['hint: not in Search before an article is picked']=!/si-ax-hint/.test(R('_siArticleExplorerSection()'));
  R('_siAxSel="AAA"');
  R('window._siAxSetMode("compare")');
  o['hint: opening Compare ends it for this visit']=R('_siAxCmpSeen')===true;
  R('window._siAxSetMode("search")');
  o['hint: back on the article page it does not return']=!/si-ax-hint/.test(R('_siArticleExplorerSection()'));
  o['hint: the animation runs a few cycles, not forever, and reduced motion gets a still ring']=/\.si-ax-hint\{[^}]*animation:si-hint 1\.5s ease-in-out 3\}/.test(CSS)&&!/\.si-ax-hint\{[^}]*infinite/.test(CSS)&&/prefers-reduced-motion:reduce\)\{[^]*\.si-ax-hint\{animation:none;box-shadow:0 0 0 2px/.test(CSS);

  // ── 2/3. the badge and the transient alert ──
  R('_siAxModeSel="compare";_siAxCmp=[];_siAxQuery="";window.matchMedia=function(){return{matches:false};}');
  R('_siAxRepaintAll()');
  const badge=()=>R('_siAxModeBtnHtml("compare","Compare")');
  o['badge: none with 0 chosen']=!/si-ax-cbadge/.test(badge());
  R('window._siAxAdd("AAA")');
  o['badge: exactly 1 chosen shows the red "1"']=/si-ax-cbadge[^>]*>1</.test(badge())&&/aria-label="Compare — 1 article chosen/.test(badge());
  o['badge: the tab itself was repainted in place (so it shows without a full repaint)']=/si-ax-cbadge/.test(a.el('si-ax-tab-compare').outerHTML||'');
  o['alert: VISIBLE AT ONCE (t=0, nothing ticked) when the first article is chosen']=flashes()===1&&/Choose another product to compare — add up to 5/.test(live())&&R('_siAxFlashState')==='in';
  o['alert: the host is a polite live region that persists, the alert has no focusable parts']=/id="si-ax-live" class="si-ax-live" role="status" aria-live="polite"/.test(R('_siArticleExplorerSection()'))&&!/tabindex|<button|<a /.test(live());
  R('__tick(1400)');
  o['alert: still visible at 1.4 s']=flashes()===1&&R('_siAxFlashState')==='in';
  R('__tick(100)');
  o['alert: fade starts at 1.5 s (state out) and it is still in the DOM while fading']=R('_siAxFlashState')==='out'&&flashes()===1;
  R('__tick(249)');
  o['alert: still fading at 1.749 s']=flashes()===1;
  R('__tick(1)');
  o['alert: removed from the DOM at 1.5 s + the 250 ms fade']=flashes()===0&&live()===''&&R('_siAxFlashState')===''&&R('__q.length')===0;
  // no stacking
  R('window._siAxRemove("AAA")');
  o['alert: nothing at 0 chosen, no badge']=flashes()===0&&!/si-ax-cbadge/.test(badge());
  R('window._siAxAdd("AAA")');R('__tick(500)');R('_siAxFlash()');R('_siAxFlash()');
  o['alert: repeated triggers never stack (one element, one pending timer pair)']=flashes()===1&&R('__q.length')===1;
  R('__tick(2000)');
  // does not take focus
  R('document.__marker={};');
  const focusBefore=a.state.activeElement;
  R('_siAxFlash()');
  o['alert: showing it does not move focus']=a.state.activeElement===focusBefore&&!/focus\(/.test(R('_siAxFlash.toString()'));
  R('__tick(2000)');
  // second article: badge and alert go; dropping back to 1 brings them back
  R('window._siAxAdd("BBB")');
  o['two chosen: no badge, no alert']=!/si-ax-cbadge/.test(badge())&&flashes()===0;
  R('window._siAxRemove("BBB")');
  o['dropping back to 1: the alert reappears at once, with the badge']=flashes()===1&&/si-ax-cbadge/.test(badge());
  R('__tick(2000)');
  // opening the tab with 1 already chosen
  R('window._siAxSetMode("search");window._siAxSetMode("compare")');
  o['opening Compare with exactly 1 chosen shows the alert; with 2 it does not']=flashes()===1&&(()=>{R('__tick(2000);window._siAxAdd("BBB");window._siAxSetMode("search");window._siAxSetMode("compare")');return flashes()===0;})();
  R('window._siAxRemove("BBB");__tick(2000)');
  // adding from the Overview "+ Compare": badge yes, alert no
  R('window._siAxRemove("AAA");_siAxModeSel="overview";_siAxRepaintAll();window._siAxOvCompare("CCC")');
  o['"+ Compare" from elsewhere: badge on the tab, no alert there']=/si-ax-cbadge/.test(badge())&&flashes()===0;
  R('_siAxCmp=[];_siAxModeSel="compare"');
  // phone cap
  const ph=load(src,{phone:true});fixA(ph);
  ph.run('_siAxModeSel="compare";_siAxCmp=[];_siAxRepaintAll();window._siAxAdd("AAA")');
  o['phone: the alert says up to 3 (the existing cap function)']=/add up to 3/.test(ph.el('si-ax-live').innerHTML)&&!/add up to 5/.test(ph.el('si-ax-live').innerHTML);
  o['badge/alert CSS: red is the non-inverting token, literal white ink, still ring under reduced motion']=/\.si-ax-cbadge\{[^}]*background:var\(--count-accent\);color:#fff/.test(CSS)&&/\.si-ax-flash\{[^}]*border:1px solid var\(--count-accent\)/.test(CSS)&&!/dark"\][^{]*\{[^}]*--count-accent/.test(CSS)&&/\.si-ax-cbadge,\.si-ax-enter\{animation:none\}/.test(CSS);

  // ── SKU table → Article Explorer ──
  R('_siSection="skutable";_siSkuSort="s7";_siSkuDir=-1;_siSkuSearch="art";_siSkuCatFilter="";_siSkuExpanded=new Set(["Art AAA|||Blue"]);_siSkuLimit=200;_siSkuTypeFilter=""');
  R('window.scrollY=730;window.__sc=[];window.scrollTo=function(x,y){window.__sc.push(y);};');
  const rows=R('_siComputeSkuTable()');
  const html=R('_siGroupedBodyHtml(_siSkuFiltered(_siComputeSkuTable()))');
  o['SKU table: every product row carries its article code and opens it']=/data-gkey="Art AAA\|\|\|Blue" data-code="AAA"[^>]*onclick="window\._siSkuOpen\(this\.dataset\.code\)"/.test(html)&&/data-code="BBB"/.test(html);
  o['SKU table: the arrow still expands and does not open (stops the click)']=/class="si-sku-chev"[^>]*onclick="event\.stopPropagation\(\);window\._siToggleGroup\(this\.dataset\.gkey\)"/.test(html);
  o['SKU table: an expanded size row also opens its article']=/<tr class="si-sku-open"[^>]*data-code="AAA"/.test(html);
  o['SKU table: a group resolves through the ONE SKU-prefix rule (case and spaces)']=R('_siSkuArticleCode([{sku:"  aaa-m "}])')==='AAA'&&R('_siSkuArticleCode([{sku:""},{sku:"bbb-l"}])')==='BBB'&&R('_siSkuArticleCode([])')==='';
  const ok=R('window._siSkuOpen("aaa")');
  o['SKU click: returns true and lands on the article page (search mode, that article, explorer tab)']=ok===true&&R('_siSection')==='articles'&&R('_siAxModeSel')==='search'&&R('_siAxSel')==='AAA'&&/Art AAA/.test(a.el('si-content').innerHTML);
  o['SKU click: scroll goes to the top']=R('J=JSON.stringify(window.__sc)')==='[0]';
  o['SKU click: the entrance class is set, then removed after it ends']=a.el('si-content').classList.contains('si-ax-enter')&&(R('__tick(300)'),a.el('si-content').classList.contains('si-ax-enter'))===true&&(R('__tick(200)'),!a.el('si-content').classList.contains('si-ax-enter'));
  o['SKU click: the SKU table kept its sort, search, filters and expanded group']=R('_siSkuSort')==='s7'&&R('_siSkuDir')===-1&&R('_siSkuSearch')==='art'&&R('_siSkuExpanded.has("Art AAA|||Blue")')===true;
  R('window.__sc=[];window._siSwitchTab("skutable")');
  o['coming back restores the scroll position it left, once']=R('J=JSON.stringify(window.__sc)')==='[730]'&&R('_siSkuReturnY')===0;
  o['coming back shows the same sort and search value']=/value="art"/.test(a.el('si-content').innerHTML);
  R('_siSection="skutable"');
  const bad=R('window._siSkuOpen("NOSUCH")');
  o['SKU click: an unknown code is refused with a message and nothing navigates']=bad===false&&R('_siSection')==='skutable'&&a.state.toasts.some(t=>/NOSUCH/.test(t));
  o['SKU click: an empty code is refused']=R('window._siSkuOpen("")')===false&&R('_siSection')==='skutable';
  o['SKU click CSS: a 250 ms fade-and-rise, off under reduced motion']=/\.si-ax-enter\{animation:si-ax-enter \.25s ease-out both\}/.test(CSS)&&/\.si-ax-cbadge,\.si-ax-enter\{animation:none\}/.test(CSS);

  // ── 4. the Calendar fix: the chart is first, a click is acknowledged, one lone point says so ──
  R('_siAxModeSel="compare";_siAxCmp=["AAA"];_siAxBasis="launch";_siAxMetric="units_week";_siAxWin="all";_siAxPrev=false');
  R('_siAxRepaintAll()');
  R('document.getElementById("si-ax-chartcard").scrollIntoView=function(o){window.__sv=o;}');
  R('window.__sv=null;window._siAxSetBasis("calendar")');
  const b1=body();
  o['calendar: pressing Calendar switches the basis and the chart draws a line (1 article)']=R('_siAxBasis')==='calendar'&&/<path class="si-ax-line s0"/.test(b1);
  o['calendar: the chart card comes BEFORE the scorecard and the Read-this block (it was below both)']=b1.indexOf('id="si-ax-chartcard"')>-1&&b1.indexOf('id="si-ax-chartcard"')<b1.indexOf('Performance scorecard');
  o['calendar: the press is acknowledged — scrolled into view smoothly and the card gets the pop outline']=!!R('window.__sv')&&R('window.__sv.behavior')==='smooth'&&a.el('si-ax-chartcard').classList.contains('si-ax-pop');
  R('__tick(1200)');
  o['calendar: the outline is removed again']=!a.el('si-ax-chartcard').classList.contains('si-ax-pop');
  const mets=['units_week','units_month','revenue_week','revenue_month','cum_week','rate_day','roll4','st_build'];
  const many=mets.map(m=>{try{R('_siAxMetric="'+m+'";_siAxCmp=["AAA"];window._siAxSetBasis("calendar")');const x1=body();R('_siAxCmp=["AAA","BBB"];window._siAxSetBasis("launch");window._siAxSetBasis("calendar")');const x2=body();return/si-ax-line/.test(x1)&&/si-ax-line/.test(x2)&&!/NaN|undefined/.test(x1+x2);}catch(e){return false;}});
  o['calendar: with 1 and with 2 articles, in all 8 metrics, it renders lines and never throws']=many.every(Boolean);
  // a lone point
  R('_siAxMetric="units_month";_siAxCmp=["CCC"];window._siAxSetBasis("calendar")');
  o['calendar: an article with a single month of sales draws a dot and says why (not a silent blank)']=/data-sparse="1"/.test(body())&&/Only one point so far/.test(body())&&!/<path class="si-ax-line/.test(body());
  R('_siAxMetric="units_week";_siAxCmp=[]');

  // ── 5a/b. pure window arithmetic ──
  o['winter window: 2026 = 1 Oct 2026 to 28 Feb 2027, labelled']=R('J=JSON.stringify(_siAxWinterWindow(2026))')===J({startYear:2026,from:'2026-10-01',to:'2027-02-28',label:'Winter 2026–27'});
  o['winter window: leap Februaries (2023–24, 2027–28) end on the 29th']=R('_siAxWinterWindow(2023).to')==='2024-02-29'&&R('_siAxWinterWindow(2027).to')==='2028-02-29';
  o['winter window: non-leap Februaries (2025–26) and 2099–2100 end on the 28th, 2399–2400 on the 29th']=R('_siAxWinterWindow(2025).to')==='2026-02-28'&&R('_siAxWinterWindow(2099).to')==='2100-02-28'&&R('_siAxWinterWindow(2399).to')==='2400-02-29';
  o['winter of a day: Oct–Dec start that year, Jan–Feb belong to the winter before, Mar–Sep to the latest ended one']=['2026-10-01:2026','2026-12-31:2026','2027-01-01:2026','2027-02-28:2026','2027-03-01:2026','2026-09-30:2025'].every(x=>{const[d,y]=x.split(':');return R('_siAxWinterOf("'+d+'")')===+y;});
  o['month arithmetic: clips the day (31 Mar +1 = 30 Apr), crosses years, Feb 29 +12 months = Feb 28']=R('_siAxAddMonths("2026-03-31",1)')==='2026-04-30'&&R('_siAxAddMonths("2026-11-01",3)')==='2027-02-01'&&R('_siAxAddMonths("2028-02-29",12)')==='2029-02-28'&&R('_siAxAddMonths("2026-01-15",-13)')==='2024-12-15'&&R('_siAxAddYears("2024-02-29",1)')==='2025-02-28';
  o['winter months are exactly Oct, Nov, Dec, Jan, Feb']=[1,2,3,4,5,6,7,8,9,10,11,12].filter(m=>R('_siAxIsWinterMonth('+m+')')).join(',')==='1,2,10,11,12';

  // ── previous year, data starts 2026-04-02: none can exist yet ──
  R('_siAxModeSel="compare";_siAxCmp=["AAA","BBB"];_siAxBasis="calendar";_siAxMetric="units_month";_siAxWin="all";_siAxPrev=false;_siAxRepaintAll()');
  R('window._siAxTogglePrev()');
  const nb=body();
  o['previous year (data from 2 Apr 2026): nothing is plotted, nothing is zero, and the page says when it can first exist']=R('_siAxPrev')===true&&/data-prev-note="all"/.test(nb)&&/no data a year earlier/.test(nb)&&/from 2 Apr 2027/.test(nb)&&!/ — previous year/.test(nb.split('si-ax-legend')[1].split('si-ax-wrap')[0]);
  o['previous year: the toggle is a pressed button']=/aria-pressed="true"[^>]*onclick="window\._siAxTogglePrev\(\)">Compare with previous year/.test(nb)||/Compare with previous year<\/button>/.test(nb)&&/si-ax-btn on" aria-pressed="true"/.test(nb);
  R('window._siAxTogglePrev()');
  o['previous year: off again removes the note']=!/data-prev-note/.test(body());

  // ── Fixture B: a real previous year ──
  const b=load(src);fixB(b);const RB=c=>b.run(c);
  RB('_siAxModeSel="compare";_siAxCmp=["AAA","BBB"];_siAxBasis="calendar";_siAxMetric="units_month";_siAxWin="winter";_siAxWinYear=null;_siAxPrev=true;_siAxRepaintAll()');
  const dB=RB('(()=>{const d=_siAxCompareData();return JSON.stringify({win:d.ser.win,labels:d.ser.xLabels,cur:d.ser.series.map(s=>s.values),prev:d.ser.prev.map(p=>({any:p.any,v:p.values})),noPrev:d.noPrev,chart:d.chartSeries.map(s=>({n:s.name,prev:!!s.prev,ci:s.ci==null?null:s.ci,v:s.values}))});})()');
  const D=JSON.parse(dB);
  o['winter window default: the latest winter, Oct 2026–Feb 2027, five monthly keys']=D.win&&D.win.from==='2026-10-01'&&D.win.to==='2027-02-28'&&D.labels.join('|')==='Oct 2026|Nov 2026|Dec 2026|Jan 2027|Feb 2027';
  o['winter window: months not yet reached are empty (null), never 0']=D.cur[0].join(',')==='15,25,35,,'.replace(/,,$/,',,')||(D.cur[0][0]===15&&D.cur[0][1]===25&&D.cur[0][2]===35&&D.cur[0][3]===null&&D.cur[0][4]===null);
  o['previous year: AAA one year earlier is 10, 20, 30, then 0 and 0 (covered months with no sale are a real zero)']=D.prev[0].any===true&&J(D.prev[0].v)===J([10,20,30,0,0]);
  o['previous year: BBB was not live a year earlier, so its twin is "no data" (all null), not zeros']=D.prev[1].any===false&&D.prev[1].v.every(v=>v===null)&&J(D.noPrev)===J(['Art BBB — Blue']);
  o['previous year: the chart gets AAA\'s twin only — same colour index, labelled, marked prev']=D.chart.length===3&&D.chart[2].prev===true&&D.chart[2].ci===0&&/previous year/.test(D.chart[2].n);
  RB('_siAxRepaintBody()');
  const bb=b.el('si-ax-body').innerHTML;
  o['previous year: the page names BBB as having no data a year earlier']=/data-prev-note="some"/.test(bb)&&/Art BBB — Blue/.test(bb.split('data-prev-note="some"')[1].split('</div>')[0]);
  o['previous year: the dashed twin is drawn (class prev, dash 2 5) and listed in the legend']=/si-ax-line s0 prev" style="stroke-dasharray:2 5"/.test(bb)&&/Art AAA — Blue — previous year/.test(bb);
  // previous winter and the navigator
  RB('window._siAxWinStep(-1)');
  o['winter navigator: one step back is Winter 2025–26, and it stops at the first winter that touches the data']=RB('_siAxWinYearNow()')===2025&&(RB('window._siAxWinStep(-1)'),RB('_siAxWinYearNow()')===2025)&&/Winter 2025–26/.test(RB('_siAxCalOptsHtml()'));
  RB('window._siAxWinStep(1);window._siAxWinStep(1);window._siAxWinStep(1)');
  o['winter navigator: cannot go past the latest winter']=RB('_siAxWinYearNow()')===2026;
  // weekly previous year keeps Monday
  RB('_siAxWin="all";_siAxMetric="units_week";_siAxCmp=["AAA"]');
  const wk=JSON.parse(RB('(()=>{const d=_siAxCompareData();const k=d.ser.calKeys;const i=k.indexOf("2026-10-12");return JSON.stringify({i,prevAt:d.ser.prev[0].values[i],cur:d.ser.series[0].values[i],key:k[i],back:_siAxDayStr(_siAxDayNum(k[i])-364)});})()'));
  o['weekly previous year: 52 weeks back lands on the matching Monday (12 Oct 2026 -> 13 Oct 2025) and reads its sales (10)']=wk.back==='2025-10-13'&&wk.prevAt===10&&wk.cur===15;

  // ── month tiles with frost ──
  RB('_siAxWin="months";_siAxWinYear=null;_siAxMetric="units_month";_siAxCmp=["AAA","BBB"];_siAxPrev=true');
  const mh=RB('_siAxMonthsHtml(_siAxCompareData().arts,_siAxCompareData().M)');
  const tiles=mh.match(/<div class="si-ax-mtile[^"]*" data-month="[^"]+"/g)||[];
  const frost=tiles.filter(t=>/ frost"/.test(t)).map(t=>/data-month="([^"]+)"/.exec(t)[1]);
  o['month tiles: a rolling window of twelve ending at the CURRENT month (Jan–Dec 2026 on 15 Dec 2026), oldest first']=tiles.length===12&&/data-month="2026-01"/.test(tiles[0])&&/data-month="2026-12"/.test(tiles[11]);
  o['month tiles: the frost class is on exactly the winter months inside the window (Jan, Feb, Oct, Nov, Dec 2026)']=frost.join(',')==='2026-01,2026-02,2026-10,2026-11,2026-12';
  o['month tiles: values 15 / 25 / 35 for AAA in Oct–Dec 2026 and "last year" 10 / 20 / 30; BBB last year "no data"']=/data-month="2026-11"[^]*?<strong>25<\/strong>[^]*?last year 20/.test(mh)&&/last year no data/.test(mh);
  o['month tiles: no future month is drawn at all (nothing after the current month, no "not yet" tile)']=!/data-month="2027-/.test(mh)&&!/not yet/.test(mh);
  o['month tiles: the current month says "so far"']=/data-month="2026-12"[^]*?so far/.test(mh);
  o['month tiles: with 15 months of history only 12 show and the stepper offers earlier months']=/aria-label="Earlier months"/.test(RB('_siAxCalOptsHtml()'))&&!/aria-label="Earlier months" disabled/.test(RB('_siAxCalOptsHtml()'))&&/aria-label="Later months" disabled/.test(RB('_siAxCalOptsHtml()'));
  RB('window._siAxMonStep(-1);window._siAxMonStep(-1);window._siAxMonStep(-1);window._siAxMonStep(-1)');
  const mhB=RB('_siAxMonthsHtml(_siAxCompareData().arts,_siAxCompareData().M)');
  const tB=mhB.match(/<div class="si-ax-mtile[^"]*" data-month="[^"]+"/g)||[];
  o['month stepper: stops at the first synced month (Oct 2025 – Sep 2026), 12 tiles, frost on Oct–Dec 2025 and Jan–Feb 2026']=tB.length===12&&/data-month="2025-10"/.test(tB[0])&&/data-month="2026-09"/.test(tB[11])&&tB.filter(x=>/ frost"/.test(x)).map(x=>/data-month="([^"]+)"/.exec(x)[1]).join(',')==='2025-10,2025-11,2025-12,2026-01,2026-02';
  o['month stepper: Later months works back to the current month, and cannot go past it']=(()=>{RB('window._siAxMonStep(1);window._siAxMonStep(1);window._siAxMonStep(1);window._siAxMonStep(1);window._siAxMonStep(1);window._siAxMonStep(1)');return RB('_siAxMonthList().shift')===0&&/data-month="2026-12"/.test(RB('_siAxMonthsHtml(_siAxCompareData().arts,_siAxCompareData().M)'));})();
  RB('_siAxMonShift=0');
  o['month tiles: the winter tiles say so in words as well as colour']=(mh.match(/<span class="w">/g)||[]).length===5;
  o['month tiles: a winter window card is frosted too, the all-data card is not']=(()=>{RB('_siAxWin="winter"');const w=RB('_siAxCompareBody()');RB('_siAxWin="all"');const n=RB('_siAxCompareBody()');return/class="card si-ax-frost" id="si-ax-chartcard"/.test(w)&&!/si-ax-frost/.test(n);})();
  // fixture A: data from 2 Apr 2026, today 1 Oct 2026 -> Apr..Oct, seven tiles, no empty future, no stepper
  const ma=load(src);fixA(ma);ma.run('_siAxModeSel="compare";_siAxCmp=["AAA"];_siAxBasis="calendar";_siAxWin="months";_siAxMonShift=0;_siAxPrev=false');
  const mh2=ma.run('_siAxMonthsHtml(_siAxCompareData().arts,_siAxCompareData().M)');
  const tA=mh2.match(/<div class="si-ax-mtile[^"]*" data-month="[^"]+"/g)||[];
  o['month tiles: from the first synced month to the current one — Apr..Oct 2026 is seven tiles, none before the data, none after today']=tA.length===7&&/data-month="2026-04"/.test(tA[0])&&/data-month="2026-10"/.test(tA[6]);
  o['month tiles: the first month says it starts from the first synced order, the last says so far; frost only on Oct']=/data-month="2026-04"[^]*?from 2 Apr/.test(mh2)&&/data-month="2026-10"[^]*?so far/.test(mh2)&&tA.filter(x=>/ frost"/.test(x)).length===1;
  o['month tiles: nothing is zero-filled before the article was live or before the data (no <strong>0</strong> ahead of its first sale month)']=!/<strong>0<\/strong>/.test(mh2.split('data-month="2026-04"')[1].split('data-month="2026-05"')[0]);
  o['month tiles: under twelve months there is no stepper']=!/Earlier months/.test(ma.run('_siAxCalOptsHtml()'));
  o['month tiles: the caption describes the rolling window (no "twelve months from October")']=/every month from the first synced orders up to the current one/.test(ma.run('_siAxCompareBody()'))&&!/twelve months from October/.test(ma.run('_siAxCompareBody()'));

  // ── CSS: tokens only, a dark partner, contrast floor, reduced motion ──
  const root=CSS.slice(0,CSS.indexOf('html[data-theme="dark"]{'));
  const dark=CSS.slice(CSS.indexOf('html[data-theme="dark"]{'),CSS.indexOf('html[data-theme="dark"]{')+9000);
  o['frost tokens exist in :root AND in the dark block']=/--si-frost-a:#/.test(root)&&/--si-frost-b:#/.test(root)&&/--si-frost-edge:#/.test(root)&&/--si-frost-a:#/.test(dark.slice(0,dark.indexOf('}'))+dark.slice(0,3000))&&/--si-frost-edge:#/.test(dark);
  const fr=(CSS.match(/\.si-ax-(?:mtile\.frost|frost)[^{]*\{[^}]*\}/g)||[]).join('');
  o['frost rules use only tokens (no literal colour) and keep --text ink']=fr.length>100&&!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(fr)&&/color:var\(--text\)/.test(CSS.match(/\.si-ax-frost\{[^}]*\}/)[0]);
  o['frost has a solid background-color floor under its gradient (the probe reads the floor)']=/\.si-ax-mtile\.frost\{[^}]*background-color:var\(--si-frost-b\)[^}]*background-image:linear-gradient/.test(CSS);
  o['phone: the arrow in a SKU row is a 34px touch target']=/@media \(max-width:600px\)\{\.si-sku-chev\{width:34px;min-height:34px\}\}/.test(CSS);
  o['no new Firestore read was added (getDocs/getDoc/onSnapshot not called by any new handler)']=(()=>{let n=0;a.run('getDocs=function(){window.__g=(window.__g||0)+1;return Promise.resolve({forEach(){}});};window.__g=0');R('_siAxModeSel="compare";_siAxCmp=["AAA"];_siAxBasis="calendar";window._siAxSetWin("winter");window._siAxSetWin("months");window._siAxTogglePrev();window._siAxWinStep(-1);window._siAxSetWin("all")');return R('window.__g')===0;})();
  return o;
}
module.exports=async function(){
  const s=suite('shopify-explorer-calendar');
  const base=checks(SRC);
  s.section('attention cues, SKU entrance, calendar fix, previous year, winter (hand-computed)');
  Object.keys(base).forEach(k=>s.ok(k,base[k]===true));
  s.section('deliberate breaks — each must fail the named check');
  const brk=(label,from,to,failing)=>{
    const n=SRC.split(from).length-1;
    if(n<1){s.ok('break target exists: '+label,false);return;}
    let r;try{r=checks(SRC.split(from).join(to));}catch(e){r={};failing.forEach(f=>r[f]=false);}
    failing.forEach(f=>s.ok('break "'+label+'" fails "'+f+'"',r[f]!==true));
  };
  brk('hint never ends','if(_siAxModeSel===\'compare\')_siAxCmpSeen=true;','',['hint: opening Compare ends it for this visit','hint: back on the article page it does not return']);
  brk('hint on every page','function _siAxHintOn(){return !_siAxCmpSeen&&_siAxModeSel===\'search\'&&!!_siAxSel;}','function _siAxHintOn(){return !_siAxCmpSeen;}',['hint: not on the Overview']);
  brk('badge for any count','const one=_siAxCmp.length===1;','const one=_siAxCmp.length>=1;',['two chosen: no badge, no alert']);
  brk('alert delayed by 1.5 s',"  h.innerHTML='<div class=\"si-ax-flash\">Choose another product to compare — add up to '+_siAxMaxCmp()+'</div>';\n  _siAxFlashState='in';","  setTimeout(()=>{h.innerHTML='<div class=\"si-ax-flash\">Choose another product to compare — add up to '+_siAxMaxCmp()+'</div>';_siAxFlashState='in';},1500);",['alert: VISIBLE AT ONCE (t=0, nothing ticked) when the first article is chosen']);
  brk('alert never removed','_siAxFlashT2=setTimeout(_siAxFlashClear,_SI_AX_FADE_MS);','',['alert: removed from the DOM at 1.5 s + the 250 ms fade']);
  brk('alert gone early','const _SI_AX_FLASH_MS=1500','const _SI_AX_FLASH_MS=900',['alert: still visible at 1.4 s']);
  brk('alert stacks','function _siAxFlash(){\n  _siAxFlashClear();','function _siAxFlash(){',['alert: repeated triggers never stack (one element, one pending timer pair)']);
  brk('alert ignores the phone cap','add up to \'+_siAxMaxCmp()+\'</div>','add up to 5</div>',['phone: the alert says up to 3 (the existing cap function)']);
  brk('alert steals focus','_siAxFlashState=\'in\';\n','_siAxFlashState=\'in\';h.focus&&h.focus();\n',['alert: showing it does not move focus']);
  brk('no alert when dropping back to 1','  if(_siAxCmp.length===1)_siAxFlash();else _siAxFlashClear();\n};','  _siAxFlashClear();\n};',['dropping back to 1: the alert reappears at once, with the badge']);
  brk('SKU row does not open','onclick="window._siSkuOpen(this.dataset.code)">\n      <td style="padding:4px 8px" onclick="event.stopPropagation()"><input type="checkbox" ${groupAllSel','onclick="window._siToggleGroup(this.dataset.gkey)">\n      <td style="padding:4px 8px" onclick="event.stopPropagation()"><input type="checkbox" ${groupAllSel',['SKU table: every product row carries its article code and opens it']);
  brk('chevron lets the click through','onclick="event.stopPropagation();window._siToggleGroup(this.dataset.gkey)"','onclick="window._siToggleGroup(this.dataset.gkey)"',['SKU table: the arrow still expands and does not open (stops the click)']);
  brk('own SKU parser','const c=_siAxCode(v&&v.sku);if(c)return c;','const c=String(v&&v.sku||"").split("-")[0];if(c)return c;',['SKU table: a group resolves through the ONE SKU-prefix rule (case and spaces)']);
  brk('state lost on open','_siSkuReturnY=(typeof window.scrollY===\'number\'?window.scrollY:0)||0;','_siSkuReturnY=0;_siSkuSort=\'title\';',['SKU click: the SKU table kept its sort, search, filters and expanded group','coming back restores the scroll position it left, once']);
  brk('no entrance class','  el.classList.add(\'si-ax-enter\');','',['SKU click: the entrance class is set, then removed after it ends']);
  brk('chart below the scorecard','+sel+chartCard+_siAxCoverage(d.arts)+_siAxHistBanner()+_siAxScorecardHtml(d.arts)+_siAxReadBlock(d.arts)+`','+sel+_siAxCoverage(d.arts)+_siAxHistBanner()+_siAxScorecardHtml(d.arts)+_siAxReadBlock(d.arts)+chartCard+`',['calendar: the chart card comes BEFORE the scorecard and the Read-this block (it was below both)']);
  brk('basis press not acknowledged','window._siAxSetBasis=function(v){_siAxBasis=v===\'launch\'?\'launch\':\'calendar\';_siAxRepaintBody();_siAxRevealChart();};','window._siAxSetBasis=function(v){_siAxBasis=v===\'launch\'?\'launch\':\'calendar\';_siAxRepaintBody();};',['calendar: the press is acknowledged — scrolled into view smoothly and the card gets the pop outline']);
  brk('lone point not explained','const sparse=live.length&&live.every(s=>pts(s)<=1)?','const sparse=false?',['calendar: an article with a single month of sales draws a dot and says why (not a silent blank)']);
  brk('leap February ignored','function _siAxLeap(y){return(y%4===0&&y%100!==0)||y%400===0;}','function _siAxLeap(y){return false;}',['winter window: leap Februaries (2023–24, 2027–28) end on the 29th','winter window: non-leap Februaries (2025–26) and 2099–2100 end on the 28th, 2399–2400 on the 29th']);
  brk('winter of January','return(+m[2]>=10)?+m[1]:+m[1]-1;','return(+m[2]>=10)?+m[1]:+m[1];',['winter of a day: Oct–Dec start that year, Jan–Feb belong to the winter before, Mar–Sep to the latest ended one']);
  brk('winter months wrong (Mar in, Feb out)','const _SI_AX_WINTER_MONTHS=[10,11,12,1,2];','const _SI_AX_WINTER_MONTHS=[10,11,12,1,3];',['winter months are exactly Oct, Nov, Dec, Jan, Feb','month tiles: the frost class is on EXACTLY the five winter months (Oct, Nov, Dec, Jan, Feb)']);
  brk('previous year zero-filled','if(!pb||pb<cov||!L||_siAxBucketEnd(pb,bucket)<L)return null;','if(!pb)return null;',['previous year: BBB was not live a year earlier, so its twin is "no data" (all null), not zeros','previous year (data from 2 Apr 2026): nothing is plotted, nothing is zero, and the page says when it can first exist']);
  brk('previous year off by 52 weeks+1','_siAxDayStr(_siAxDayNum(b)-364)','_siAxDayStr(_siAxDayNum(b)-365)',['weekly previous year: 52 weeks back lands on the matching Monday (12 Oct 2026 -> 13 Oct 2025) and reads its sales (10)']);
  brk('window starts in October again','const first=cov.slice(0,7)+\'-01\';','const first=today.slice(0,4)+\'-10-01\';',['month tiles: from the first synced month to the current one — Apr..Oct 2026 is seven tiles, none before the data, none after today']);
  brk('window runs into the future','if(m>last)break;','if(m>_siAxAddMonths(last,5))break;',['month tiles: no future month is drawn at all (nothing after the current month, no "not yet" tile)','month tiles: from the first synced month to the current one — Apr..Oct 2026 is seven tiles, none before the data, none after today']);
  brk('more than twelve shown','const endIdx=all.length-1-shift,startIdx=Math.max(0,endIdx-(_SI_AX_MONTHS_MAX-1));','const endIdx=all.length-1-shift,startIdx=0;',['month tiles: a rolling window of twelve ending at the CURRENT month (Jan–Dec 2026 on 15 Dec 2026), oldest first']);
  brk('stepper can pass the data start','const maxShift=Math.max(0,all.length-_SI_AX_MONTHS_MAX);','const maxShift=Math.max(0,all.length-_SI_AX_MONTHS_MAX+3);',['month stepper: stops at the first synced month (Oct 2025 – Sep 2026), 12 tiles, frost on Oct–Dec 2025 and Jan–Feb 2026']);
  brk('future months zero-filled','if(win&&b>today)return null;','',['winter window: months not yet reached are empty (null), never 0']);
  brk('winter window ends in January','to:e+\'-02-\'+String(_siAxMonthLen(e,2)).padStart(2,\'0\')','to:e+\'-01-31\'',['winter window: 2026 = 1 Oct 2026 to 28 Feb 2027, labelled']);
  brk('frost on every tile','frost:_siAxIsWinterMonth(mm)','frost:true',['month tiles: the frost class is on EXACTLY the five winter months (Oct, Nov, Dec, Jan, Feb)']);
  brk('future month shown as 0','if(st>today)return null;                      // has not happened yet','',['month tiles: a month still ahead says "no data — not yet", never 0']);
  return s;
};

/* Groovy Operations — fulfillment.js
   Daily Performance (Dispatch & Returns) tracker + analytics.

   Plain global CLASSIC script (NO import/export) — same convention as every
   other /js/*.js file. Firebase globals (db, collection, doc, getDocs,
   setDoc, query, orderBy, limit, …) are bridged onto window by the bootstrap
   module in index.html before this runs. Shared utils (showToast,
   logActivity, session, currentPage, gvSkeleton) live in shared.js and are
   visible here through the single shared global lexical scope.

   Data model — one Firestore doc per calendar day:
     collection: fulfillment_reports
     doc id:     'YYYY-MM-DD'  (= the report date)
     {
       date, dispatched:[{brand,courier,shipments,amount}, …],
       returns:[{brand,courier,shipments,amount}, …],
       dispatchedTotal:{shipments,amount}, returnsTotal:{shipments,amount},
       enteredBy, enteredByU, enteredAt, updatedAt
     }
   This mirrors the two daily reports Umair (fulfilment) posts — a Dispatched
   sheet and a Returns sheet, both keyed to the same date. */

// ── Fixed brand/courier row templates (match Umair's report layout) ──
const FULFILL_DISPATCH_ROWS=[
  {brand:'GROOVY',            courier:'POST-EX'},
  {brand:'AGAINST',           courier:'POST-EX'},
  {brand:'Cultured Legacy',   courier:'BLUE-EX'},
  {brand:'Groovy/Against/Culture', courier:'TCS'},
];
const FULFILL_RETURN_ROWS=[
  {brand:'GROOVY',          courier:'POST-EX'},
  {brand:'AGAINST',         courier:'POST-EX'},
  {brand:'Cultured Legacy', courier:'BLUE-EX'},
  {brand:'GROOVY',          courier:'BLUE-EX'},
  {brand:'Groovy/Culture',  courier:'TCS'},
];
// The brand/courier rows currently rendered in the entry form — the fixed
// template for a new day, or a saved record's own rows when editing (imported
// days can carry a different return layout). Recalc + save read from here so
// the labels shown always match what gets written.
let _fulfillActiveRows={d:FULFILL_DISPATCH_ROWS,r:FULFILL_RETURN_ROWS};

// ── Module state ──
let fulfillReports=[];          // cached docs, newest first
let fulfillReportsLoaded=false;
let _fulfillTab='analytics';    // 'analytics' | 'entry'
let _fulfillRangeKey='30d';     // active range preset key (or 'custom')
let _fulfillFrom=null;          // custom-range start (ISO) — used when key==='custom'
let _fulfillTo=null;            // custom-range end   (ISO)
let _fulfillTrend='daily';      // trend bucket: 'daily' | 'weekly' | 'monthly'
let _fulfillMetric='shipments'; // chart metric: 'shipments' | 'value'
let _fulfillCalMetric='volume'; // calendar colouring: 'volume' | 'rate'
let _fulfillEntryDate=null;     // ISO date currently in the entry form
let _fulfillLogSearch='';       // Log tab search query
let _fulfillLogPage=1;          // Log tab current page (1-based)
let _fulfillLogPerPage=10;      // Log tab entries per page

// ── Small helpers ──
function _fnum(n){return Number(n||0).toLocaleString('en-US');}
function _fRs(n){return 'Rs '+_fnum(Math.round(Number(n||0)));}
function _fulfillToday(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _fulfillFmtDate(iso){
  if(!iso)return '—';
  const d=new Date(iso+'T00:00:00');
  return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'});
}
function _fulfillCutoff(days){
  const d=new Date();d.setDate(d.getDate()-(days-1));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _fulfillISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function _fulfillAddDays(iso,n){const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return _fulfillISO(d);}
function _fulfillDaysBetween(a,b){return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000)+1;}
// Resolve a preset key → {from,to} (inclusive ISO bounds; null = open/all-time).
function _fulfillPreset(key){
  const today=_fulfillToday();
  const now=new Date(today+'T00:00:00');
  switch(key){
    case 'today':     return {from:today,to:today};
    case 'yesterday': {const y=_fulfillAddDays(today,-1);return {from:y,to:y};}
    case '7d':        return {from:_fulfillAddDays(today,-6),to:today};
    case '30d':       return {from:_fulfillAddDays(today,-29),to:today};
    case '90d':       return {from:_fulfillAddDays(today,-89),to:today};
    case 'thismonth': return {from:_fulfillISO(new Date(now.getFullYear(),now.getMonth(),1)),to:today};
    case 'lastmonth': return {from:_fulfillISO(new Date(now.getFullYear(),now.getMonth()-1,1)),to:_fulfillISO(new Date(now.getFullYear(),now.getMonth(),0))};
    case 'all':       return {from:null,to:null};
    default:          return null;
  }
}
// The active [from,to] for the current selection.
function _fulfillRange(){
  if(_fulfillRangeKey==='custom')return {from:_fulfillFrom,to:_fulfillTo};
  return _fulfillPreset(_fulfillRangeKey)||_fulfillPreset('30d');
}
function _fulfillDayName(iso,long){
  const d=new Date(iso+'T00:00:00');
  return isNaN(d)?'':d.toLocaleDateString('en-GB',{weekday:long?'long':'short'});
}
function _fulfillFmtDateShort(iso){
  const d=new Date(iso+'T00:00:00');
  return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}
// Monday (ISO week start) of the week containing `iso`, as YYYY-MM-DD.
function _fulfillMonday(iso){
  const d=new Date(iso+'T00:00:00');
  const off=(d.getDay()+6)%7; // 0=Mon … 6=Sun
  d.setDate(d.getDate()-off);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _niceCeil(v){
  if(v<=5)return 5;
  const p=Math.pow(10,Math.floor(Math.log10(v)));
  const n=v/p;const m=n<=1?1:n<=2?2:n<=5?5:10;
  return m*p;
}
// Aggregate a list of daily reports into totals + per-brand / per-courier maps.
function _sumFulfill(list){
  let dShip=0,dAmt=0,rShip=0,rAmt=0;const brand={},courier={};
  const bump=(map,key,f)=>{const o=map[key]||(map[key]={dShip:0,dAmt:0,rShip:0,rAmt:0});f(o);};
  for(const rep of list){
    for(const row of (rep.dispatched||[])){
      dShip+=row.shipments||0;dAmt+=row.amount||0;
      bump(brand,row.brand,o=>{o.dShip+=row.shipments||0;o.dAmt+=row.amount||0;});
      bump(courier,row.courier,o=>{o.dShip+=row.shipments||0;o.dAmt+=row.amount||0;});
    }
    for(const row of (rep.returns||[])){
      rShip+=row.shipments||0;rAmt+=row.amount||0;
      bump(brand,row.brand,o=>{o.rShip+=row.shipments||0;o.rAmt+=row.amount||0;});
      bump(courier,row.courier,o=>{o.rShip+=row.shipments||0;o.rAmt+=row.amount||0;});
    }
  }
  return {dShip,dAmt,rShip,rAmt,brand,courier};
}
// Group daily reports into ISO weeks (Mon start), sorted oldest first.
function _fulfillWeekly(reps){
  const map={};
  for(const r of reps){
    const wk=_fulfillMonday(r.date);
    const m=map[wk]||(map[wk]={week:wk,dShip:0,dAmt:0,rShip:0,rAmt:0,days:0,recDisp:0});
    const dS=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    m.dShip+=dS;
    m.dAmt+=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
    m.rShip+=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    m.rAmt+=(r.returnsTotal&&r.returnsTotal.amount)||0;
    if(r.returnsRecorded!==false)m.recDisp+=dS; // dispatched on days whose returns were recorded
    m.days++;
  }
  return Object.values(map).sort((a,b)=>a.week.localeCompare(b.week));
}
// Group daily reports into calendar months, sorted oldest first.
function _fulfillMonthly(reps){
  const map={};
  for(const r of reps){
    const k=r.date.slice(0,7); // YYYY-MM
    const m=map[k]||(map[k]={month:k,dShip:0,dAmt:0,rShip:0,rAmt:0,days:0,recDisp:0});
    const dS=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    m.dShip+=dS;
    m.dAmt+=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
    m.rShip+=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    m.rAmt+=(r.returnsTotal&&r.returnsTotal.amount)||0;
    if(r.returnsRecorded!==false)m.recDisp+=dS;
    m.days++;
  }
  return Object.values(map).sort((a,b)=>a.month.localeCompare(b.month));
}
function _fulfillMonthLabel(ym){
  const d=new Date(ym+'-01T00:00:00');
  return isNaN(d)?ym:d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'});
}
// Small ▲/▼ % change chip. invert=true → "up" is bad (returns, return-rate).
function _deltaChip(cur,prev,invert){
  if(prev==null)return '';
  if(prev===0)return cur>0?'<span style="font-size:12px;color:var(--muted)"> · new</span>':'';
  const pct=Math.round(100*(cur-prev)/prev);
  const arrow=pct>0?'▲':pct<0?'▼':'▬';
  const good=pct===0?null:(invert?pct<0:pct>0);
  const color=good===null?'var(--muted)':(good?'var(--accent-success)':'var(--accent-urgent)');
  return `<span style="font-size:12px;font-weight:600;color:${color}"> ${arrow} ${Math.abs(pct)}%</span>`;
}
// Series-driven inline SVG line chart. Every chart uses ONE y-axis (never a
// dual axis — measures of different scale get their own chart). points carry
// named keys; `series`=[{key,color,label,area,dash,width}]. Per-point <title>
// gives a native hover tooltip; a legend shows for ≥2 series (a single series
// is named by the panel title). points:[{label, <key>:num, …}].
function _fulfillLineChart(points,series,opts){
  opts=opts||{};
  const W=960,H=opts.height||230,padL=54,padR=18,padT=18,padB=44;
  const n=points.length;
  const keys=series.map(s=>s.key);
  const maxV=Math.max(opts.minMax||1,...points.reduce((a,p)=>{keys.forEach(k=>{if(p[k]!=null)a.push(p[k]);});return a;},[]));
  const top=_niceCeil(maxV);
  const suf=opts.ySuffix||'';
  const X=i=>n<=1?padL+(W-padL-padR)/2:padL+(i*(W-padL-padR)/(n-1));
  const Y=v=>H-padB-((v/top)*(H-padT-padB));
  let grid='';
  for(let t=0;t<=4;t++){const gv=top*t/4,gy=Y(gv);
    grid+=`<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W-padR}" y2="${gy.toFixed(1)}" stroke="#ececec" stroke-width="1"/>`
        +`<text x="${padL-8}" y="${(gy+4).toFixed(1)}" text-anchor="end" font-size="12" fill="#999">${_fnum(Math.round(gv))}${suf}</text>`;}
  const step=Math.max(1,Math.ceil(n/12));
  let xlab='';points.forEach((p,i)=>{if(i%step!==0&&i!==n-1)return;xlab+=`<text x="${X(i).toFixed(1)}" y="${H-padB+18}" text-anchor="middle" font-size="12" fill="#777">${p.label}</text>`;});
  let body='';
  for(const s of series){
    // Only plot points that have a value; null (e.g. a not-recorded day) breaks
    // the line and draws no dot rather than dropping to a misleading zero.
    const valid=points.map((p,i)=>({i,v:p[s.key]})).filter(o=>o.v!=null);
    const pts=valid.map(o=>`${X(o.i).toFixed(1)},${Y(o.v).toFixed(1)}`);
    if(s.area&&valid.length>1)body+=`<polygon points="${X(valid[0].i).toFixed(1)},${Y(0).toFixed(1)} ${pts.join(' ')} ${X(valid[valid.length-1].i).toFixed(1)},${Y(0).toFixed(1)}" fill="${s.color}" fill-opacity="0.07"/>`;
    if(valid.length>1)body+=`<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width||2.5}"${s.dash?` stroke-dasharray="${s.dash}"`:''}/>`;
    body+=valid.map(o=>`<circle cx="${X(o.i).toFixed(1)}" cy="${Y(o.v).toFixed(1)}" r="${n<=16?3.5:2.5}" fill="${s.color}"><title>${points[o.i].label} · ${s.label}: ${_fnum(o.v)}${suf}</title></circle>`).join('');
  }
  const legend=series.length>1?`<div style="display:flex;gap:20px;justify-content:center;margin-top:8px;font-size:13px">${series.map(s=>`<span style="display:inline-flex;align-items:center;gap:7px"><span style="width:18px;height:3px;background:${s.color};display:inline-block;border-radius:2px"></span>${s.label}</span>`).join('')}</div>`:'';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="height:${H}px;display:block;max-width:100%">${grid}${body}${xlab}</svg>${legend}`;
}
// Average dispatched shipments by weekday (Mon…Sun) — reveals the weekly rhythm.
function _fulfillWeekdayPattern(reps){
  const names=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const sum=[0,0,0,0,0,0,0],cnt=[0,0,0,0,0,0,0];
  for(const r of reps){const d=new Date(r.date+'T00:00:00');if(isNaN(d))continue;const wd=(d.getDay()+6)%7;sum[wd]+=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;cnt[wd]++;}
  return names.map((nm,i)=>({label:nm,value:cnt[i]?Math.round(sum[i]/cnt[i]):0,days:cnt[i]}));
}
// Simple vertical bar chart (magnitude by category). 4px rounded tops, direct labels.
function _fulfillBarChart(bars,color){
  color=color||'#111111';
  const max=Math.max(1,...bars.map(b=>b.value));
  return `<div style="display:flex;align-items:flex-end;gap:10px;height:170px;padding-top:6px">
    ${bars.map(b=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end" title="${b.label}: ${_fnum(b.value)} avg${b.days!=null?' · '+b.days+' day'+(b.days===1?'':'s'):''}">
      <div style="font-size:12px;font-weight:600">${_fnum(b.value)}</div>
      <div style="width:72%;max-width:46px;background:${b.value?color:'#e5e5e5'};border-radius:4px 4px 0 0;height:${Math.round((b.value/max)*120)}px;min-height:${b.value?2:0}px"></div>
      <div style="font-size:12px;color:var(--muted)">${b.label}</div>
    </div>`).join('')}
  </div>`;
}
// Inline magnitude bar + status-coloured % label for the brand/courier tables.
function _fulfillRateBar(rr,rrColor){
  return `<div style="display:flex;align-items:center;gap:7px;justify-content:flex-end">
    <div style="width:52px;height:6px;background:#eee;border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.min(100,rr)}%;background:${rrColor(rr)}"></div></div>
    <span style="font-weight:600;min-width:34px;text-align:right;color:${rrColor(rr)}">${rr}%</span>
  </div>`;
}

// Fixed colour per courier (colour follows the entity, never its rank).
const _FULFILL_COURIER_COLORS={'POST-EX':'#7B1F2A','BLUE-EX':'#185FA5','TCS':'#B47512'};

// GitHub-style month calendar heat-map of daily dispatched volume. Sequential
// single-hue green ramp (light→dark = more). Independent of the trend toggle.
function _fulfillCalendarHeatmap(reps,metric){
  metric=metric==='rate'?'rate':'volume';
  const byV={},byRate={},has={},rec={};let maxV=0;
  for(const r of reps){
    const v=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    const rs=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    byV[r.date]=v;byRate[r.date]=v?Math.round(100*rs/v):0;has[r.date]=true;
    rec[r.date]=r.returnsRecorded!==false; // returns recorded that day?
    if(v>maxV)maxV=v;
  }
  const months=[...new Set(reps.map(r=>r.date.slice(0,7)))].sort();
  const ramp=['#EDEDED','#D6E8DC','#A9CDB4','#5E9A73','#14532D'];
  const lvl=v=>{if(!v)return 0;const q=v/(maxV||1);return q<=0.25?1:q<=0.5?2:q<=0.75?3:4;};
  // Highlighted day: busiest (volume mode) or worst return rate (rate mode,
  // recorded days only).
  let bestDate=null,bestVal=-1;
  for(const d in has){if(metric==='rate'&&!rec[d])continue;const val=metric==='rate'?byRate[d]:byV[d];if(val>bestVal){bestVal=val;bestDate=d;}}
  const cellStyle=(h,v,rate,recorded)=>{
    if(!h)return {bg:'#F1F1F1',fg:'#bdbdbd'};
    // In rate mode a day whose returns were never recorded is shown as no-data,
    // not a misleading green 0%.
    if(metric==='rate')return recorded?{bg:_fulfillRateColor(rate),fg:'#fff'}:{bg:'#F1F1F1',fg:'#bdbdbd'};
    const L=lvl(v);return {bg:ramp[L],fg:L>=3?'#fff':'#3a3a3a'};
  };
  const wd=['Mo','Tu','We','Th','Fr','Sa','Su'];
  const grids=months.map(ym=>{
    const y=+ym.slice(0,4),m=+ym.slice(5,7);
    const startOff=(new Date(y,m-1,1).getDay()+6)%7;
    const days=new Date(y,m,0).getDate();
    let mV=0,mRw=0,mRecDisp=0;
    for(let d=1;d<=days;d++){const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if(has[iso]){mV+=byV[iso];if(rec[iso]){mRw+=(byRate[iso]/100)*byV[iso];mRecDisp+=byV[iso];}}}
    const mRate=mRecDisp?Math.round(100*mRw/mRecDisp):0;
    const totalTxt=metric==='rate'?mRate+'% avg':_fnum(mV)+' disp';
    let cells=wd.map(w=>`<div style="font-size:10px;color:var(--muted);text-align:center;line-height:16px">${w}</div>`).join('');
    for(let i=0;i<startOff;i++)cells+='<div style="width:28px;height:28px"></div>';
    for(let d=1;d<=days;d++){
      const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const h=!!has[iso],v=byV[iso]||0,rate=byRate[iso]||0,recorded=rec[iso]!==false,st=cellStyle(h,v,rate,recorded);
      const ring=iso===bestDate?'box-shadow:0 0 0 2px #111;':'';
      const tip=`${_fulfillFmtDate(iso)}${h?': '+_fnum(v)+' dispatched · '+(recorded?rate+'% return':'returns not recorded'):' · no data'}`;
      cells+=`<div title="${tip}" style="width:28px;height:28px;border-radius:5px;background:${st.bg};color:${st.fg};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;${ring}">${d}</div>`;
    }
    return `<div style="display:inline-block;vertical-align:top;margin:0 26px 12px 0">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:6px">
        <span style="font-size:13px;font-weight:700">${_fulfillMonthLabel(ym)}</span>
        <span style="font-size:11px;color:var(--muted)">${totalTxt}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,28px);gap:4px">${cells}</div>
    </div>`;
  }).join('');
  const sw=(c,l)=>`<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:14px;border-radius:3px;background:${c};display:inline-block"></span>${l}</span>`;
  const legend=metric==='rate'
    ? `<div style="display:flex;align-items:center;gap:14px;margin-top:8px;font-size:11px;color:var(--muted);flex-wrap:wrap">${sw('#14532D','≤8%')}${sw('#B47512','8–15%')}${sw('#7B1F2A','>15%')}${sw('#F1F1F1','no data')}<span style="margin-left:auto">□ ring = worst day</span></div>`
    : `<div style="display:flex;align-items:center;gap:5px;margin-top:8px;font-size:11px;color:var(--muted);flex-wrap:wrap">Less ${ramp.map(c=>`<span style="width:14px;height:14px;border-radius:3px;background:${c};display:inline-block"></span>`).join('')} More <span style="margin-left:12px">□ ring = busiest day (${_fnum(maxV)})</span></div>`;
  return `<div style="overflow-x:auto;white-space:nowrap;padding:2px 0 4px">${grids}</div>${legend}`;
}

// Net-revenue waterfall: Dispatched value → minus Returns → Net.
function _fulfillWaterfall(dAmt,rAmt){
  const net=dAmt-rAmt,max=Math.max(1,dAmt),h=v=>Math.round((Math.max(0,v)/max)*130);
  const col=(label,inner,valTxt,color)=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px">
    <div style="font-size:12px;font-weight:700;color:${color}">${valTxt}</div>${inner}
    <div style="font-size:12px;color:var(--muted)">${label}</div></div>`;
  const bar=(height,color)=>`<div style="width:64%;max-width:76px;height:${height}px;background:${color};border-radius:4px 4px 0 0"></div>`;
  // Returns segment hangs from the Dispatched height down to Net.
  const retInner=`<div style="width:64%;max-width:76px;height:${h(dAmt)}px;display:flex;flex-direction:column;justify-content:flex-start" title="Returns ${_fRs(rAmt)}">
    <div style="height:${h(rAmt)}px;background:var(--accent-urgent);border-radius:4px 4px 0 0;width:100%"></div></div>`;
  return `<div style="display:flex;align-items:flex-end;gap:14px;height:170px;padding-top:6px">
    ${col('Dispatched',bar(h(dAmt),'var(--accent-success)'),_fRs(dAmt),'var(--accent-success)')}
    ${col('− Returns',retInner,'− '+_fRs(rAmt),'var(--accent-urgent)')}
    ${col('= Net',bar(h(net),'#111'),_fRs(net),'#111')}
  </div>`;
}

// Weekly return-rate % per courier — "is a courier getting worse?" One line per
// courier (colour = entity). Returns {points, series, weeks}.
function _fulfillCourierTrend(reps){
  const weeks={};
  for(const r of reps){
    const wk=_fulfillMonday(r.date);const w=weeks[wk]||(weeks[wk]={});
    for(const row of (r.dispatched||[]))(w[row.courier]=w[row.courier]||{d:0,r:0}).d+=row.shipments||0;
    for(const row of (r.returns||[]))(w[row.courier]=w[row.courier]||{d:0,r:0}).r+=row.shipments||0;
  }
  const wkKeys=Object.keys(weeks).sort();
  const totals={};for(const wk of wkKeys)for(const c in weeks[wk])totals[c]=(totals[c]||0)+weeks[wk][c].d;
  const couriers=Object.entries(totals).filter(([,d])=>d>0).sort((a,b)=>b[1]-a[1]).map(([c])=>c);
  const points=wkKeys.map(wk=>{const p={label:_fulfillFmtDateShort(wk)};couriers.forEach(c=>{const cc=weeks[wk][c]||{d:0,r:0};p[c]=cc.d?Math.round(100*cc.r/cc.d):0;});return p;});
  const series=couriers.map(c=>({key:c,color:_FULFILL_COURIER_COLORS[c]||'#6B6B6B',label:c}));
  return {points,series,weeks:wkKeys.length};
}

// Return-rate → status colour (hex, for SVG fills). green ≤8 · amber 8–15 · red >15.
function _fulfillRateColor(rr){return rr>=15?'#7B1F2A':rr>=8?'#B47512':'#14532D';}

// Primary volume chart — stacked "cap on top" bars: delivered (light) + returned
// (coloured by return-rate severity). Value on top, colour-coded rate % under each
// bar, and a dashed average line. points:[{label,d,r,rate}]. opts.value → Rs labels.
function _fulfillVolumeBars(points,opts){
  opts=opts||{};
  const isVal=!!opts.value,fmt=v=>isVal?_fRs(v):_fnum(v);
  const n=points.length,dense=n>18;
  const W=960,H=opts.height||255,padL=54,padR=16,padT=28,padB=dense?40:54;
  const top=_niceCeil(Math.max(1,...points.map(p=>p.d||0)));
  const Y=v=>H-padB-((v/top)*(H-padT-padB));
  const slot=(W-padL-padR)/Math.max(1,n),cx=i=>padL+slot*i+slot/2;
  const bw=Math.min(slot*0.6,48);
  let grid='';
  for(let t=0;t<=4;t++){const gv=top*t/4,gy=Y(gv);
    grid+=`<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W-padR}" y2="${gy.toFixed(1)}" stroke="#eee"/><text x="${padL-8}" y="${(gy+4).toFixed(1)}" text-anchor="end" font-size="12" fill="#aaa">${_fnum(Math.round(gv))}</text>`;}
  const avg=points.reduce((s,p)=>s+(p.d||0),0)/Math.max(1,n),ay=Y(avg);
  const avgLine=`<line x1="${padL}" y1="${ay.toFixed(1)}" x2="${W-padR}" y2="${ay.toFixed(1)}" stroke="#111" stroke-width="1" stroke-dasharray="4 4" opacity="0.45"/><text x="${W-padR}" y="${(ay-5).toFixed(1)}" text-anchor="end" font-size="11" fill="#666">avg ${fmt(Math.round(avg))}</text>`;
  const step=Math.max(1,Math.ceil(n/14));
  let bars='';
  points.forEach((p,i)=>{
    const c=cx(i),d=p.d||0,r=p.r||0,net=Math.max(0,d-r),rateNA=p.rate==null,col=rateNA?'#999':_fulfillRateColor(p.rate);
    const tip=`${p.label} · Dispatched ${fmt(d)} · ${rateNA?'returns not recorded':'Returns '+fmt(r)+' ('+p.rate+'%) · Net '+fmt(net)}`;
    bars+=`<rect x="${(c-bw/2).toFixed(1)}" y="${Y(net).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0)-Y(net)).toFixed(1)}" fill="#EAEAEA"><title>${tip}</title></rect>`;
    if(d>0&&r>0)bars+=`<rect x="${(c-bw/2).toFixed(1)}" y="${Y(d).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,Y(net)-Y(d)-2).toFixed(1)}" rx="3" fill="${col}"><title>${tip}</title></rect>`;
    if(!dense){
      bars+=`<text x="${c.toFixed(1)}" y="${(Y(d)-6).toFixed(1)}" text-anchor="middle" font-size="11" fill="#222" font-weight="700">${fmt(d)}</text>`;
      bars+=`<text x="${c.toFixed(1)}" y="${(H-padB+17).toFixed(1)}" text-anchor="middle" font-size="11" fill="#777">${p.label}</text>`;
      bars+=`<text x="${c.toFixed(1)}" y="${(H-padB+32).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${col}">${rateNA?'—':p.rate+'%'}</text>`;
    }else if(i%step===0||i===n-1){
      bars+=`<text x="${c.toFixed(1)}" y="${(H-padB+17).toFixed(1)}" text-anchor="middle" font-size="11" fill="#777">${p.label}</text>`;
    }
  });
  const key=(c,l)=>`<span style="display:inline-flex;align-items:center;gap:7px"><span style="width:16px;height:12px;border-radius:3px;background:${c};display:inline-block"></span>${l}</span>`;
  const legend=`<div style="display:flex;gap:16px;justify-content:center;margin-top:8px;font-size:13px;flex-wrap:wrap">${key('#EAEAEA','Delivered')}${key('#14532D','Returned ≤8%')}${key('#B47512','8–15%')}${key('#7B1F2A','>15%')}</div>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="height:${H}px;display:block;max-width:100%">${grid}${avgLine}${bars}</svg>${legend}`;
}
// Owners, managers, and the dedicated fulfilment account (Umair) may view
// and record daily performance.
function _canViewFulfillment(){return session&&(session.role==='owner'||session.role==='manager'||session.role==='fulfillment');}
function _canEditFulfillment(){return _canViewFulfillment();}

// Jump straight to a tab (used by Umair's mobile nav).
window.showFulfillTab=function(tab){_fulfillTab=(['entry','log'].includes(tab)?tab:'analytics');window.showPage('fulfillment');};

// ── Data loading ──
async function loadFulfillmentData(){
  try{
    const q=query(collection(db,'fulfillment_reports'),orderBy('date','desc'),limit(400));
    const snap=await getDocs(q);
    fulfillReports=snap.docs.map(d=>({id:d.id,...d.data()}));
    fulfillReportsLoaded=true;
  }catch(e){
    console.warn('[fulfillment] load failed',e);
    fulfillReports=[];fulfillReportsLoaded=true;
  }
}

// ── Page shell + tab switch ──
function _fulfillBody(){
  return _fulfillTab==='entry'?_renderFulfillEntry()
        :_fulfillTab==='log'?_renderFulfillLog()
        :_renderFulfillAnalytics();
}

// Is the most recent working day (yesterday, skipping Sunday) still unrecorded?
function _fulfillMissedInfo(){
  let day=_fulfillAddDays(_fulfillToday(),-1);
  if(new Date(day+'T00:00:00').getDay()===0)day=_fulfillAddDays(day,-1); // skip Sunday
  return {date:day,missed:!fulfillReports.some(r=>r.date===day)};
}
function _fulfillMissedBanner(){
  if(!fulfillReports.length)return '';
  const mi=_fulfillMissedInfo();
  if(!mi.missed)return '';
  return `<div style="background:var(--accent-warning-soft);border:1px solid var(--accent-warning);border-radius:10px;padding:11px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <span style="font-size:13px;font-weight:600;color:var(--accent-warning)">⚠ ${_fulfillDayName(mi.date,true)}, ${_fulfillFmtDate(mi.date)} isn't recorded yet.</span>
    <button class="btn-sm" onclick="window.fulfillEditDate('${mi.date}')">Record it now</button>
  </div>`;
}

function renderFulfillmentPage(){
  if(!_canViewFulfillment())
    return '<div class="empty">Daily Performance is restricted to owners and managers.</div>';
  const tab=(id,label)=>`<button class="tab-btn${_fulfillTab===id?' active':''}" onclick="window.switchFulfillTab('${id}')">${label}</button>`;
  return `<div class="page-head">
    <div class="page-title">Daily Performance</div>
    <div class="page-sub">Dispatch &amp; returns — recorded per day, analysed over time</div>
  </div>
  ${_fulfillMissedBanner()}
  <div class="tab-bar">
    ${tab('analytics','Analytics')}${tab('entry','Record Day')}${tab('log','Log')}
  </div>
  <div id="fulfill-body">${_fulfillBody()}</div>`;
}

// Owner/manager dashboard widget — injected at the top of #main-content on the
// main dashboard (all logic here so shared.js only needs a one-line hook).
async function _fulfillDashboardInject(){
  if(!session||!(session.role==='owner'||session.role==='manager'))return;
  if(typeof currentPage!=='undefined'&&currentPage!=='dashboard')return;
  if(!fulfillReportsLoaded){try{await loadFulfillmentData();}catch(e){return;}}
  if(typeof currentPage!=='undefined'&&currentPage!=='dashboard')return;
  const m=document.getElementById('main-content');
  if(!m||document.getElementById('fulfill-dash-card'))return;
  const latest=[...fulfillReports].sort((a,b)=>b.date.localeCompare(a.date))[0];
  const mi=_fulfillMissedInfo();
  let lat='No days recorded yet';
  if(latest){
    const ds=(latest.dispatchedTotal&&latest.dispatchedTotal.shipments)||0;
    const rate=(latest.returnsRecorded!==false&&ds)?Math.round(100*((latest.returnsTotal&&latest.returnsTotal.shipments)||0)/ds):null;
    lat=`${_fulfillFmtDate(latest.date)} · ${_fnum(ds)} dispatched${rate!=null?' · '+rate+'% return':''}`;
  }
  const accent=mi.missed?'var(--accent-warning)':'var(--accent-success)';
  const right=mi.missed
    ? `<span style="font-size:13px;font-weight:600;color:var(--accent-warning);white-space:nowrap">⚠ ${_fulfillFmtDate(mi.date)} not recorded ›</span>`
    : `<span style="font-size:13px;color:var(--muted);white-space:nowrap">View analytics ›</span>`;
  const div=document.createElement('div');
  div.id='fulfill-dash-card';
  div.innerHTML=`<div onclick="window.showPage('fulfillment')" style="cursor:pointer;background:#fff;border:1px solid var(--border);border-left:4px solid ${accent};border-radius:12px;padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Daily Performance</div>
    <div style="font-size:15px;font-weight:700;margin-top:2px">${lat}</div></div>${right}</div>`;
  m.insertBefore(div,m.firstChild);
}

window.switchFulfillTab=function(tab){
  _fulfillTab=tab;
  const body=document.getElementById('fulfill-body');
  document.querySelectorAll('#main-content .tab-bar .tab-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.querySelector(`#main-content .tab-bar .tab-btn[onclick*="'${tab}'"]`);
  if(btn)btn.classList.add('active');
  if(!body)return;
  body.innerHTML=_fulfillBody();
  if(tab==='entry')window._fulfillRecalc();
};

// ══════════════════════════════════════════════════════════════════════
//  ENTRY — record / edit a single day
// ══════════════════════════════════════════════════════════════════════
function _renderFulfillEntry(){
  if(!_canEditFulfillment())
    return '<div class="empty">Recording is restricted to owners and managers.</div>';
  const date=_fulfillEntryDate||_fulfillToday();
  _fulfillEntryDate=date;
  const existing=fulfillReports.find(r=>r.date===date);
  // Editing a saved day reuses its own brand/courier layout (imported days can
  // differ from the default template); a new day uses the fixed template.
  _fulfillActiveRows={
    d:(existing&&existing.dispatched&&existing.dispatched.length)?existing.dispatched:FULFILL_DISPATCH_ROWS,
    r:(existing&&existing.returns&&existing.returns.length)?existing.returns:FULFILL_RETURN_ROWS
  };

  // Clear a lone "0" on focus and select the contents so the first keystroke
  // overwrites — no more deleting the placeholder zero before typing.
  const _focusJS="this.value==='0'&&(this.value='');this.select()";
  const rowInputs=(rows,section,saved)=>rows.map((r,i)=>{
    const s=(saved&&saved[i])||{};
    return `<tr>
      <td style="padding:9px 8px;font-size:14px;font-weight:600">${r.brand}</td>
      <td style="padding:9px 8px;font-size:13px;color:var(--muted)">${r.courier}</td>
      <td style="padding:5px 6px"><input type="number" min="0" inputmode="numeric" id="fd-${section}-${i}-ship"
        value="${s.shipments!=null?s.shipments:''}" placeholder="0" oninput="window._fulfillRecalc()" onfocus="${_focusJS}"
        style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;font-size:15px;text-align:right;background:#FAFAFA;font-family:inherit;outline:none"></td>
      <td style="padding:5px 6px"><input type="number" min="0" inputmode="numeric" id="fd-${section}-${i}-amt"
        value="${s.amount!=null?s.amount:''}" placeholder="0" oninput="window._fulfillRecalc()" onfocus="${_focusJS}"
        style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;font-size:15px;text-align:right;background:#FAFAFA;font-family:inherit;outline:none"></td>
    </tr>`;
  }).join('');

  const tbl=(title,rows,section,saved,accent)=>`<div class="card" style="margin-bottom:12px">
    <div class="card-title" style="border-bottom:none;margin-bottom:6px;color:${accent};font-size:13px">${title}</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:340px">
      <thead><tr style="text-align:left">
        <th style="padding:6px 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Brand</th>
        <th style="padding:6px 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Courier</th>
        <th style="padding:6px 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right">Shipments</th>
        <th style="padding:6px 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:right">Amount (Rs)</th>
      </tr></thead>
      <tbody>${rowInputs(rows,section,saved)}</tbody>
      <tfoot><tr style="border-top:2px solid var(--border)">
        <td colspan="2" style="padding:9px;font-size:14px;font-weight:700">GRAND TOTAL</td>
        <td id="fd-${section}-tot-ship" style="padding:9px;font-size:16px;font-weight:700;text-align:right">0</td>
        <td id="fd-${section}-tot-amt" style="padding:9px;font-size:16px;font-weight:700;text-align:right">Rs 0</td>
      </tr></tfoot>
    </table></div>
  </div>`;

  return `<div class="card" style="margin-bottom:12px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:180px">
        <label>Report date</label>
        <input type="date" id="fd-date" value="${date}" max="${_fulfillToday()}" onchange="window.loadFulfillDate()">
      </div>
      <div style="font-size:14px;font-weight:600;color:${existing?'var(--accent-warning)':'var(--text)'};padding-bottom:10px">
        ${existing?'✎ Editing ':''}${_fulfillDayName(date,true)}, ${_fulfillFmtDate(date)}
      </div>
    </div>
    ${tbl('DISPATCHED',_fulfillActiveRows.d,'d',existing&&existing.dispatched,'var(--accent-success)')}
    ${tbl('RETURNS',_fulfillActiveRows.r,'r',existing&&existing.returns,'var(--accent-urgent)')}
    <label style="display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted);margin:-4px 2px 12px;cursor:pointer">
      <input type="checkbox" id="fd-ret-na" ${existing&&existing.returnsRecorded===false?'checked':''} onchange="window._fulfillToggleRetNA()" style="width:16px;height:16px;cursor:pointer">
      Returns not recorded for this day — exclude from return-rate averages (don't count as 0%)
    </label>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-primary" id="fd-save-btn" style="flex:1;min-width:160px" onclick="window.saveFulfillReport()">${existing?'Update record':'Save record'}</button>
      <button class="btn-outline" style="flex:1;min-width:160px;font-size:14px;font-weight:600" onclick="window.saveFulfillReport(true)">${existing?'Update':'Save'} &amp; download PDF</button>
    </div>`;
}

window.loadFulfillDate=function(){
  const el=document.getElementById('fd-date');
  if(!el||!el.value)return;
  _fulfillEntryDate=el.value;
  const body=document.getElementById('fulfill-body');
  if(body){body.innerHTML=_renderFulfillEntry();window._fulfillRecalc();}
};

function _fulfillReadSection(section,rows){
  const out=[];
  let tShip=0,tAmt=0;
  for(let i=0;i<rows.length;i++){
    const ship=parseInt((document.getElementById(`fd-${section}-${i}-ship`)||{}).value)||0;
    const amt=parseFloat((document.getElementById(`fd-${section}-${i}-amt`)||{}).value)||0;
    out.push({brand:rows[i].brand,courier:rows[i].courier,shipments:ship,amount:amt});
    tShip+=ship;tAmt+=amt;
  }
  return {rows:out,totShip:tShip,totAmt:tAmt};
}

// Toggle the "returns not recorded" state — grey out + clear the returns inputs.
window._fulfillToggleRetNA=function(){
  const na=!!(document.getElementById('fd-ret-na')||{}).checked;
  _fulfillActiveRows.r.forEach((_,i)=>['ship','amt'].forEach(k=>{
    const el=document.getElementById('fd-r-'+i+'-'+k);
    if(el){el.disabled=na;el.style.opacity=na?0.4:1;if(na)el.value='';}
  }));
  window._fulfillRecalc();
};
window._fulfillRecalc=function(){
  const d=_fulfillReadSection('d',_fulfillActiveRows.d);
  const r=_fulfillReadSection('r',_fulfillActiveRows.r);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('fd-d-tot-ship',_fnum(d.totShip));set('fd-d-tot-amt',_fRs(d.totAmt));
  set('fd-r-tot-ship',_fnum(r.totShip));set('fd-r-tot-amt',_fRs(r.totAmt));
};

window.saveFulfillReport=async function(alsoPdf){
  if(!_canEditFulfillment())return showToast('Not allowed.',true);
  const date=(document.getElementById('fd-date')||{}).value;
  if(!date)return showToast('Pick a date first.',true);
  const d=_fulfillReadSection('d',_fulfillActiveRows.d);
  const r=_fulfillReadSection('r',_fulfillActiveRows.r);
  if(d.totShip===0&&d.totAmt===0&&r.totShip===0&&r.totAmt===0)
    return showToast('Enter at least one shipment or amount.',true);

  const retNA=!!(document.getElementById('fd-ret-na')||{}).checked;
  const btn=document.getElementById('fd-save-btn');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  const existing=fulfillReports.find(x=>x.date===date);
  const payload={
    date,
    dispatched:d.rows, returns:r.rows,
    dispatchedTotal:{shipments:d.totShip,amount:d.totAmt},
    returnsTotal:{shipments:r.totShip,amount:r.totAmt},
    returnsRecorded:!retNA,
    updatedAt:Date.now(),
    updatedBy:session.name, updatedByU:session.u,
  };
  if(!existing){payload.enteredBy=session.name;payload.enteredByU=session.u;payload.enteredAt=Date.now();}
  else{payload.enteredBy=existing.enteredBy||session.name;payload.enteredByU=existing.enteredByU||session.u;payload.enteredAt=existing.enteredAt||Date.now();}

  try{
    await setDoc(doc(db,'fulfillment_reports',date),payload);
    // Upsert into cache (keep newest-first order)
    const rec={id:date,...payload};
    const idx=fulfillReports.findIndex(x=>x.date===date);
    if(idx>-1)fulfillReports[idx]=rec;else fulfillReports.push(rec);
    fulfillReports.sort((a,b)=>b.date.localeCompare(a.date));
    logActivity('Fulfilment report',`${existing?'Updated':'Recorded'} ${date} — ${_fnum(d.totShip)} dispatched / ${_fnum(r.totShip)} returned`);
    showToast(`Saved ${_fulfillFmtDate(date)} ✓`);
    if(alsoPdf===true)window.fulfillPdf(date);
    _fulfillTab='log';
    const m=document.getElementById('main-content');
    if(m)m.innerHTML=renderFulfillmentPage();
  }catch(e){
    console.warn('[fulfillment] save failed',e);
    showToast('Save failed: '+(e.message||'permission denied'),true);
    if(btn){btn.disabled=false;btn.textContent=existing?'Update record':'Save record';}
  }
};

// ══════════════════════════════════════════════════════════════════════
//  ANALYTICS
// ══════════════════════════════════════════════════════════════════════
window.setFulfillRange=function(key){
  _fulfillRangeKey=key;
  if(key!=='custom'){const p=_fulfillPreset(key);if(p){_fulfillFrom=p.from;_fulfillTo=p.to;}}
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};
window.applyFulfillCustom=function(){
  let f=(document.getElementById('fr-from')||{}).value;
  let t=(document.getElementById('fr-to')||{}).value;
  if(!f||!t)return showToast('Pick both a From and To date.',true);
  if(f>t){const tmp=f;f=t;t=tmp;}
  _fulfillRangeKey='custom';_fulfillFrom=f;_fulfillTo=t;
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};
window.setFulfillTrend=function(mode){
  _fulfillTrend=(['weekly','monthly'].includes(mode)?mode:'daily');
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};
window.setFulfillMetric=function(m){
  _fulfillMetric=(m==='value'?'value':'shipments');
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};
window.setFulfillCal=function(m){
  _fulfillCalMetric=(m==='rate'?'rate':'volume');
  const body=document.getElementById('fulfill-body');
  if(body)body.innerHTML=_renderFulfillAnalytics();
};

function _renderFulfillAnalytics(){
  if(!fulfillReports.length)
    return `<div class="empty">No daily reports yet.<br><br>
      <button class="btn-outline" onclick="window.switchFulfillTab('entry')">Record the first day</button></div>`;

  const rng=_fulfillRange();const from=rng.from,to=rng.to;
  const reps=fulfillReports.filter(r=>(from==null||r.date>=from)&&(to==null||r.date<=to));
  if(!reps.length)
    return `${_fulfillRangeBar(from,to)}<div class="empty">No reports in this date range.</div>`;

  const repsAsc=[...reps].sort((a,b)=>a.date.localeCompare(b.date));
  const cur=_sumFulfill(reps);
  const days=reps.length;
  const avgPerDay=days?Math.round(cur.dShip/days):0;
  const best=repsAsc.reduce((m,r)=>{const v=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;return v>m.val?{val:v,date:r.date}:m;},{val:0,date:null});
  // Return rate over RECORDED days only — days whose returns were never entered
  // (returnsRecorded===false) are excluded so the rate isn't optimistically diluted.
  const _recRate=list=>{const rec=list.filter(r=>r.returnsRecorded!==false);const d=rec.reduce((s,r)=>s+((r.dispatchedTotal&&r.dispatchedTotal.shipments)||0),0);const rr=rec.reduce((s,r)=>s+((r.returnsTotal&&r.returnsTotal.shipments)||0),0);return d?100*rr/d:0;};
  const retRate=_recRate(reps);
  const naDays=reps.filter(r=>r.returnsRecorded===false).length;

  // ── Compare: the immediately-preceding window of equal length ──
  let prev=null,prevRate=null,prevFrom=null,prevTo=null;
  if(from&&to){
    const len=_fulfillDaysBetween(from,to);
    prevTo=_fulfillAddDays(from,-1);
    prevFrom=_fulfillAddDays(prevTo,-(len-1));
    const prevReps=fulfillReports.filter(r=>r.date>=prevFrom&&r.date<=prevTo);
    if(prevReps.length){prev=_sumFulfill(prevReps);prevRate=_recRate(prevReps);}
  }

  const kpi=(label,val,sub,color)=>`<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px 14px;text-align:center">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">${label}</div>
    <div style="font-size:26px;font-weight:800;color:${color||'var(--text)'}">${val}</div>
    ${sub?`<div style="font-size:12px;color:var(--muted);margin-top:3px">${sub}</div>`:''}
  </div>`;
  const sec=(title,body,extra)=>`<div class="card" style="margin-bottom:14px"><div class="card-title" style="font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px">${title}${extra||''}</div>${body}</div>`;
  const th=(t,align)=>`<th style="padding:8px 6px;border-bottom:2px solid var(--border);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;text-align:${align||'left'}">${t}</th>`;
  const td=(v,align,extra)=>`<td style="padding:9px 6px;text-align:${align||'left'};${extra||''}">${v}</td>`;
  const rrColor=rr=>rr>=15?'var(--accent-urgent)':rr>=8?'var(--accent-warning)':'var(--accent-success)';

  // ── Trend chart + breakdown (daily / weekly / monthly) ──
  const mode=_fulfillTrend;
  const isValue=_fulfillMetric==='value';
  // Normalise the chosen mode into a common bucket shape.
  let buckets,firstCol,firstColHdr,daily=false;
  if(mode==='weekly'){
    buckets=_fulfillWeekly(repsAsc).map(w=>({...w,label:'Wk of '+_fulfillFmtDateShort(w.week),chart:_fulfillFmtDateShort(w.week)}));
    firstColHdr=th('Week of');firstCol=b=>td(b.label,'left','font-weight:600;white-space:nowrap');
  }else if(mode==='monthly'){
    buckets=_fulfillMonthly(repsAsc).map(m=>({...m,label:_fulfillMonthLabel(m.month),chart:_fulfillMonthLabel(m.month)}));
    firstColHdr=th('Month');firstCol=b=>td(b.label,'left','font-weight:600;white-space:nowrap');
  }else{
    daily=true;
    buckets=repsAsc.slice(-31).map(r=>{const dS=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;const recd=r.returnsRecorded!==false;return {
      date:r.date,label:_fulfillFmtDate(r.date),chart:_fulfillFmtDateShort(r.date),days:1,rec:recd,recDisp:recd?dS:0,
      dShip:dS,dAmt:(r.dispatchedTotal&&r.dispatchedTotal.amount)||0,
      rShip:(r.returnsTotal&&r.returnsTotal.shipments)||0,rAmt:(r.returnsTotal&&r.returnsTotal.amount)||0
    };});
    firstColHdr=th('Date')+th('Day');firstCol=b=>td(_fulfillFmtDate(b.date),'left','font-weight:600;white-space:nowrap')+td(_fulfillDayName(b.date),'left','color:var(--muted)');
  }
  // Return rate per bucket, honouring not-recorded days (recDisp), → null when unknown.
  const bucketRate=b=>{const rd=b.recDisp!=null?b.recDisp:(b.rec===false?0:b.dShip);return rd?Math.round(100*b.rShip/rd):(b.rec===false||(b.recDisp===0)?null:0);};
  const unit=buckets.length+' '+(mode==='weekly'?'week':mode==='monthly'?'month':'day')+(buckets.length===1?'':'s');
  const trendLabel=(daily?'last ':'')+unit;

  // Chart points — metric toggle plots shipment counts or Rs value (value =
  // net-revenue trend: gap between the two lines is the net). `rate` is the
  // shipment-based return rate for its own (separate-axis) chart.
  const points=buckets.map(b=>({label:b.chart,d:isValue?b.dAmt:b.dShip,r:isValue?b.rAmt:b.rShip,rate:bucketRate(b)}));

  const breakdownHead=`${firstColHdr}${th('Days','right')}${th('Dispatched','right')}${th('Value','right')}${th('Returns','right')}${th('Net','right')}${th('Ret %','right')}${th('vs prev','right')}`;
  const cmpKey=isValue?'dAmt':'dShip';
  const breakdownRows=buckets.map((b,i)=>({b,prev:i>0?buckets[i-1][cmpKey]:null})).reverse().map(({b,prev})=>{
    const rr=bucketRate(b);
    const net=b.dAmt-b.rAmt;
    const rrCell=rr==null?'<span style="color:var(--muted)">—</span>':`<span style="font-weight:600;color:${rrColor(rr)}">${rr}%</span>`;
    return `<tr style="border-bottom:1px solid #f5f5f5;font-size:14px">
      ${firstCol(b)}
      ${td(b.days,'right','color:var(--muted)')}
      ${td(_fnum(b.dShip),'right','font-weight:600')}
      ${td(_fRs(b.dAmt),'right','color:var(--muted)')}
      ${td(rr==null?'<span style="color:var(--muted)">n/a</span>':_fnum(b.rShip),'right')}
      ${td(_fRs(net),'right','font-weight:600')}
      ${td(rrCell,'right')}
      ${td(_deltaChip(b[cmpKey],prev,false)||'<span style="color:var(--muted)">—</span>','right')}
    </tr>`;
  }).join('');

  const tBtn=(m,l)=>`<button class="filter-chip${mode===m?' active':''}" style="padding:4px 11px" onclick="window.setFulfillTrend('${m}')">${l}</button>`;
  const mBtn=(m,l)=>`<button class="filter-chip${_fulfillMetric===m?' active':''}" style="padding:4px 11px" onclick="window.setFulfillMetric('${m}')">${l}</button>`;
  const trendToggle=`<span style="display:inline-flex;gap:10px;flex-wrap:wrap">
    <span style="display:inline-flex;gap:4px">${tBtn('daily','Daily')}${tBtn('weekly','Weekly')}${tBtn('monthly','Monthly')}</span>
    <span style="display:inline-flex;gap:4px">${mBtn('shipments','Shipments')}${mBtn('value','Value')}</span>
  </span>`;

  const rankRows=map=>Object.entries(map).sort((a,b)=>b[1].dShip-a[1].dShip).map(([name,v])=>{
    const rr=v.dShip?Math.round(100*v.rShip/v.dShip):0;
    return `<tr style="border-bottom:1px solid #f5f5f5;font-size:14px">
      ${td(name,'left','font-weight:600')}${td(_fnum(v.dShip),'right')}${td(_fRs(v.dAmt),'right','color:var(--muted)')}${td(_fnum(v.rShip),'right')}${td(_fulfillRateBar(rr,rrColor),'right')}
    </tr>`;
  }).join('');
  const brandRows=rankRows(cur.brand);
  const courierRows=rankRows(cur.courier);
  const weekday=_fulfillWeekdayPattern(reps);
  const calendar=_fulfillCalendarHeatmap(reps,_fulfillCalMetric);
  const calToggle=`<span style="display:inline-flex;gap:4px">
    <button class="filter-chip${_fulfillCalMetric==='volume'?' active':''}" style="padding:4px 11px" onclick="window.setFulfillCal('volume')">Volume</button>
    <button class="filter-chip${_fulfillCalMetric==='rate'?' active':''}" style="padding:4px 11px" onclick="window.setFulfillCal('rate')">Return rate</button>
  </span>`;
  const ct=_fulfillCourierTrend(reps);
  const courierTrend=ct.weeks>=2&&ct.series.length
    ? _fulfillLineChart(ct.points,ct.series,{ySuffix:'%',minMax:10,height:220})
    : '<div class="empty" style="padding:1.6rem">Need at least 2 weeks of data for a courier trend.</div>';

  const rateSub=naDays
    ? `${naDays} day${naDays===1?'':'s'} not recorded`
    : (prevRate!=null
      ? `${(retRate-prevRate>=0?'+':'')}${(retRate-prevRate).toFixed(1)}pp vs prev`
      : 'returns ÷ dispatched');
  const cmpNote=prev
    ? `<span style="font-size:12px;color:var(--muted);font-weight:500">▲▼ vs ${_fulfillFmtDate(prevFrom)} → ${_fulfillFmtDate(prevTo)}</span>`
    : '';
  const netVal=cur.dAmt-cur.rAmt;
  const modeCap=mode.charAt(0).toUpperCase()+mode.slice(1);

  return `${_fulfillRangeBar(from,to)}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
    ${kpi('Dispatched',_fnum(cur.dShip),_fRs(cur.dAmt)+' value'+(prev?_deltaChip(cur.dShip,prev.dShip,false):''),'var(--accent-success)')}
    ${kpi('Returns',_fnum(cur.rShip),_fRs(cur.rAmt)+' value'+(prev?_deltaChip(cur.rShip,prev.rShip,true):''),'var(--accent-urgent)')}
    ${kpi('Net value',_fRs(netVal),(prev?_deltaChip(netVal,prev.dAmt-prev.rAmt,false)+' ':'')+'after returns','var(--text)')}
    ${kpi('Return rate',retRate.toFixed(1)+'%',rateSub,rrColor(retRate))}
    ${kpi('Avg / day',_fnum(avgPerDay),days+' day'+(days===1?'':'s')+' recorded')}
    ${kpi('Best day',_fnum(best.val),best.date?_fulfillFmtDate(best.date):'—')}
  </div>

  ${sec(modeCap+' volume — '+trendLabel+(isValue?' · value (Rs)':' · shipments'),
    _fulfillVolumeBars(points,{value:isValue}),trendToggle)}

  <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:14px">
    ${sec('Return rate over time (%)',_fulfillLineChart(points,[{key:'rate',color:'#B47512',label:'Return rate',area:true}],{ySuffix:'%',minMax:10,height:200}))}
    ${sec('Avg dispatched by weekday',_fulfillBarChart(weekday))}
  </div>

  ${sec('Dispatch calendar — '+(_fulfillCalMetric==='rate'?'return rate':'daily volume'),calendar,calToggle)}

  ${sec(modeCap+' breakdown',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:580px">
    <thead><tr>${breakdownHead}</tr></thead><tbody>${breakdownRows}</tbody></table></div>`,cmpNote)}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
    ${sec('By brand · return rate',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:320px">
      <thead><tr>${th('Brand')}${th('Disp','right')}${th('Value','right')}${th('Ret','right')}${th('Ret %','right')}</tr></thead>
      <tbody>${brandRows}</tbody></table></div>`)}
    ${sec('By courier · return rate',`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:320px">
      <thead><tr>${th('Courier')}${th('Disp','right')}${th('Value','right')}${th('Ret','right')}${th('Ret %','right')}</tr></thead>
      <tbody>${courierRows}</tbody></table></div>`)}
  </div>

  <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:14px">
    ${sec('Courier return-rate trend (weekly)',courierTrend)}
    ${sec('Net revenue build-up',_fulfillWaterfall(cur.dAmt,cur.rAmt))}
  </div>`;
}

// Date-range control: preset chips + a From/To calendar for a custom range,
// an Excel export button, and a label showing the active range and the
// comparison window (the equal-length period immediately before it).
function _fulfillRangeBar(from,to){
  const presets=[['today','Today'],['yesterday','Yesterday'],['7d','Last 7 Days'],['30d','Last 30 Days'],['90d','Last 90 Days'],['thismonth','This Month'],['lastmonth','Last Month'],['all','All']];
  const chips=presets.map(([k,l])=>`<button class="filter-chip${_fulfillRangeKey===k?' active':''}" onclick="window.setFulfillRange('${k}')">${l}</button>`).join('');
  const today=_fulfillToday();
  let label,cmp='';
  if(from&&to){
    label=`${_fulfillFmtDate(from)} → ${_fulfillFmtDate(to)} · ${_fulfillDaysBetween(from,to)} days`;
    const len=_fulfillDaysBetween(from,to);
    const pTo=_fulfillAddDays(from,-1),pFrom=_fulfillAddDays(pTo,-(len-1));
    cmp=`<span style="color:var(--muted)"> · vs ${_fulfillFmtDate(pFrom)} → ${_fulfillFmtDate(pTo)}</span>`;
  }else{
    label='All time';
  }
  return `<div style="margin-bottom:14px">
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chips}</div>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="width:150px"><label>From</label><input type="date" id="fr-from" value="${from||''}" max="${today}"></div>
      <div class="field" style="width:150px"><label>To</label><input type="date" id="fr-to" value="${to||''}" max="${today}"></div>
      <button class="btn-outline" onclick="window.applyFulfillCustom()">Apply range</button>
      <button class="btn-pdf" onclick="window.fulfillExport()" title="Export all days to Excel" style="margin-left:auto">⤓ Excel</button>
    </div>
    <div style="font-size:12px;color:var(--text);font-weight:600;margin-top:8px">${label}${cmp}</div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════
//  LOG — date-wise list of every saved report, with PDF + edit
// ══════════════════════════════════════════════════════════════════════
function _fulfillLogRow(r){
  const ds=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
  const da=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
  const rs=(r.returnsTotal&&r.returnsTotal.shipments)||0;
  const ra=(r.returnsTotal&&r.returnsTotal.amount)||0;
  const rr=ds?Math.round(100*rs/ds):0;
  const who=r.enteredBy||r.updatedBy||'—';
  return `<div class="po-row" style="cursor:default">
    <div class="po-info">
      <div class="po-num" style="font-size:13px">${_fulfillDayName(r.date,true)}, ${_fulfillFmtDate(r.date)}</div>
      <div class="po-name" style="font-size:15px">${_fnum(ds)} dispatched · ${_fRs(da)}</div>
      <div class="po-meta" style="font-size:13px">Returns ${_fnum(rs)} · ${_fRs(ra)} · Ret ${rr}% · by ${who}</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button class="btn-pdf" onclick="window.fulfillPdf('${r.date}')">PDF</button>
      <button class="btn-outline" onclick="window.fulfillEditDate('${r.date}')">Edit</button>
    </div>
  </div>`;
}

// Rows + pagination only — re-rendered on search / page / per-page change so
// the search box keeps focus (the shell around it is not re-rendered).
function _fulfillLogResults(){
  const q=_fulfillLogSearch.trim().toLowerCase();
  let list=[...fulfillReports].sort((a,b)=>b.date.localeCompare(a.date));
  if(q)list=list.filter(r=>{
    const hay=`${_fulfillFmtDate(r.date)} ${_fulfillDayName(r.date,true)} ${r.date} ${r.enteredBy||r.updatedBy||''}`.toLowerCase();
    return hay.includes(q);
  });
  const total=list.length;
  const per=_fulfillLogPerPage;
  const pages=Math.max(1,Math.ceil(total/per));
  if(_fulfillLogPage>pages)_fulfillLogPage=pages;
  if(_fulfillLogPage<1)_fulfillLogPage=1;
  const start=(_fulfillLogPage-1)*per;
  const slice=list.slice(start,start+per);
  const from=total?start+1:0,to=Math.min(start+per,total);

  const pager=`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0 12px;flex-wrap:wrap">
    <div style="font-size:13px;color:var(--muted)">Showing ${from}–${to} of ${total}${q?' matching':' days'}</div>
    <div style="display:flex;gap:4px;align-items:center">
      <button class="btn-outline" ${_fulfillLogPage<=1?'disabled style="opacity:.4;cursor:not-allowed"':''} onclick="window.fulfillLogGoto(${_fulfillLogPage-1})">‹ Prev</button>
      <span style="font-size:13px;padding:0 8px;white-space:nowrap">Page ${_fulfillLogPage} / ${pages}</span>
      <button class="btn-outline" ${_fulfillLogPage>=pages?'disabled style="opacity:.4;cursor:not-allowed"':''} onclick="window.fulfillLogGoto(${_fulfillLogPage+1})">Next ›</button>
    </div>
  </div>`;

  const rows=slice.length?slice.map(_fulfillLogRow).join(''):'<div class="empty">No days match your search.</div>';
  return pager+rows;
}

function _renderFulfillLog(){
  if(!fulfillReports.length)
    return `<div class="empty">No days recorded yet.<br><br>
      <button class="btn-outline" onclick="window.switchFulfillTab('entry')">Record the first day</button></div>`;
  const sv=String(_fulfillLogSearch).replace(/"/g,'&quot;');
  const perOpts=[10,25,50,100].map(n=>`<option value="${n}"${_fulfillLogPerPage===n?' selected':''}>${n} / page</option>`).join('');
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="fl-search" value="${sv}" placeholder="Search date, day, or person…" oninput="window.fulfillLogSearch(this.value)"
          style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#FAFAFA;font-family:inherit;outline:none;min-width:230px">
        <select onchange="window.fulfillLogPerPage(this.value)" style="padding:9px 8px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;font-family:inherit">${perOpts}</select>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${(session.role==='owner'||session.role==='manager')?`<label class="btn-pdf" style="cursor:pointer" title="Import a Dispatch/Returns Excel workbook">⤒ Import Excel<input type="file" accept=".xlsx,.xls" style="display:none" onchange="window.fulfillImport(this)"></label>`:''}
        <button class="btn-pdf" onclick="window.fulfillExport()" title="Export all days to Excel">⤓ Export Excel</button>
      </div>
    </div>
    <div id="fl-results">${_fulfillLogResults()}</div>`;
}

// Parse a 3-sheet Dispatch/Returns workbook (same shape as the export) into
// per-day rows. Mirrors the server-side importer: strict date rows only, brand
// normalisation, GRAND-TOTAL rows skipped.
function _fulfillParseWorkbook(wb){
  const MON={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const isDate=s=>/^\d{1,2}-[A-Za-z]{3}-\d{2}$/.test(String(s).trim());
  const pdate=s=>{const p=String(s).trim().split('-');return `20${p[2]}-${MON[p[1].toLowerCase()]}-${String(p[0]).padStart(2,'0')}`;};
  const canon=b=>{const s=String(b).trim().toLowerCase();return ({'groovy':'GROOVY','against':'AGAINST','cultured legacy':'Cultured Legacy','groovy/against/culture':'Groovy/Against/Culture','groovy/culture':'Groovy/Culture'})[s]||String(b).trim();};
  const findSheet=name=>wb.SheetNames.find(n=>n.toLowerCase().indexOf(name)>-1);
  const grid=n=>n?XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:''}):[];
  const parseLines=nm=>{const rows=grid(findSheet(nm)).slice(1);const by={};for(const r of rows){if(!isDate(r[0]))continue;const date=pdate(r[0]);const brand=String(r[1]).trim();if(brand.toUpperCase()==='GRAND TOTAL'||!brand)continue;(by[date]=by[date]||{rows:[]}).rows.push({brand:canon(r[1]),courier:String(r[2]).trim(),shipments:parseInt(r[3])||0,amount:parseFloat(r[4])||0});}return by;};
  const disp=parseLines('dispatch'),ret=parseLines('return');
  return {dates:[...new Set(Object.keys(disp))].sort(),disp,ret};
}

// Read the chosen workbook, confirm, and bulk-write one doc per day. A day with
// no returns rows is saved returnsRecorded:false (not a fake 0%).
window.fulfillImport=async function(input){
  if(!(session.role==='owner'||session.role==='manager'))return showToast('Import is restricted to owners and managers.',true);
  const file=input&&input.files&&input.files[0];if(!file)return;
  if(typeof XLSX==='undefined'){input.value='';return showToast('Excel library not loaded — retry in a moment.',true);}
  try{
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(new Uint8Array(buf),{type:'array'});
    const p=_fulfillParseWorkbook(wb);
    if(!p.dates.length){input.value='';return showToast('No dated rows found — expected a Dispatched sheet.',true);}
    const overwrite=p.dates.filter(d=>fulfillReports.some(r=>r.date===d)).length;
    const msg=`Import ${p.dates.length} day(s), ${_fulfillFmtDate(p.dates[0])} → ${_fulfillFmtDate(p.dates[p.dates.length-1])}?`+(overwrite?`\n\n${overwrite} existing day(s) will be overwritten.`:'');
    if(!confirm(msg)){input.value='';return;}
    showToast('Importing…');
    const now=Date.now();const batch=writeBatch(db);
    for(const date of p.dates){
      const dRows=(p.disp[date]&&p.disp[date].rows)||[];
      const rRec=!!p.ret[date];
      const rRows=(p.ret[date]&&p.ret[date].rows)||[];
      const dS=dRows.reduce((s,x)=>s+x.shipments,0),dA=dRows.reduce((s,x)=>s+x.amount,0);
      const rS=rRows.reduce((s,x)=>s+x.shipments,0),rA=rRows.reduce((s,x)=>s+x.amount,0);
      batch.set(doc(db,'fulfillment_reports',date),{
        date,dispatched:dRows,returns:rRows,
        dispatchedTotal:{shipments:dS,amount:dA},returnsTotal:{shipments:rS,amount:rA},
        returnsRecorded:rRec,
        enteredBy:session.name,enteredByU:session.u,enteredAt:now,
        updatedBy:session.name,updatedByU:session.u,updatedAt:now,source:'excel-import'
      });
    }
    await batch.commit();
    logActivity('Fulfilment import',`Imported ${p.dates.length} days from Excel (${p.dates[0]}…${p.dates[p.dates.length-1]})`);
    await loadFulfillmentData();
    _fulfillTab='log';
    const m=document.getElementById('main-content');if(m)m.innerHTML=renderFulfillmentPage();
    showToast(`Imported ${p.dates.length} day(s) ✓`);
  }catch(e){
    console.warn('[fulfillment] import failed',e);
    showToast('Import failed: '+(e.message||'could not read file'),true);
  }finally{if(input)input.value='';}
};

window.fulfillLogSearch=function(v){_fulfillLogSearch=v;_fulfillLogPage=1;const el=document.getElementById('fl-results');if(el)el.innerHTML=_fulfillLogResults();};
window.fulfillLogPerPage=function(v){_fulfillLogPerPage=parseInt(v)||10;_fulfillLogPage=1;const el=document.getElementById('fl-results');if(el)el.innerHTML=_fulfillLogResults();};
window.fulfillLogGoto=function(p){_fulfillLogPage=p;const el=document.getElementById('fl-results');if(el){el.innerHTML=_fulfillLogResults();const m=document.getElementById('main-content');if(m)m.scrollTop=0;}};

window.fulfillEditDate=function(date){
  _fulfillEntryDate=date;
  _fulfillTab='entry';
  const m=document.getElementById('main-content');
  if(m){m.innerHTML=renderFulfillmentPage();window._fulfillRecalc();}
};

// Export every recorded day to an Excel workbook (SheetJS, loaded globally).
// Two sheets: a per-day summary and a per-line-item detail.
window.fulfillExport=function(){
  if(typeof XLSX==='undefined')return showToast('Excel library not loaded — retry in a moment.',true);
  const reps=[...fulfillReports].sort((a,b)=>a.date.localeCompare(b.date));
  if(!reps.length)return showToast('Nothing to export yet.',true);
  const summary=reps.map(r=>{
    const ds=(r.dispatchedTotal&&r.dispatchedTotal.shipments)||0;
    const da=(r.dispatchedTotal&&r.dispatchedTotal.amount)||0;
    const rs=(r.returnsTotal&&r.returnsTotal.shipments)||0;
    const ra=(r.returnsTotal&&r.returnsTotal.amount)||0;
    return {
      Date:r.date, Day:_fulfillDayName(r.date,true),
      'Dispatched Shipments':ds, 'Dispatched Value':da,
      'Returns Shipments':rs, 'Returns Value':ra,
      'Net Value':da-ra, 'Return %':ds?Math.round(100*rs/ds):0,
      'Entered By':r.enteredBy||r.updatedBy||''
    };
  });
  const detail=[];
  for(const r of reps){
    (r.dispatched||[]).forEach(row=>detail.push({Date:r.date,Day:_fulfillDayName(r.date,true),Type:'Dispatched',Brand:row.brand,Courier:row.courier,Shipments:row.shipments||0,Amount:row.amount||0}));
    (r.returns||[]).forEach(row=>detail.push({Date:r.date,Day:_fulfillDayName(r.date,true),Type:'Return',Brand:row.brand,Courier:row.courier,Shipments:row.shipments||0,Amount:row.amount||0}));
  }
  try{
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),'Daily Summary');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),'Detail');
    XLSX.writeFile(wb,`daily-performance-${_fulfillToday()}.xlsx`);
    showToast(`Exported ${reps.length} day${reps.length===1?'':'s'} ✓`);
  }catch(e){
    console.warn('[fulfillment] export failed',e);
    showToast('Export failed: '+(e.message||'unknown'),true);
  }
};

// Generate (open + download) the one-day PDF via the shared print engine.
window.fulfillPdf=function(date){
  const r=fulfillReports.find(x=>x.date===date);
  if(!r)return showToast('Report not found.',true);
  if(typeof printDocument!=='function')return showToast('Print engine not loaded yet — retry in a moment.',true);
  printDocument({
    type:'daily-performance',
    filename:`daily-performance-${date}.pdf`,
    data:{
      documentType:'Daily Performance',
      id:date,
      date:date,
      dateLabel:_fulfillFmtDate(date),
      issuedDate:_fulfillFmtDate(date),
      issuedBy:r.enteredBy||r.updatedBy||'—',
      dispatched:r.dispatched||[],
      returns:r.returns||[],
      dispatchedTotal:r.dispatchedTotal||{shipments:0,amount:0},
      returnsTotal:r.returnsTotal||{shipments:0,amount:0},
      urduLevel:'minimal'
    }
  });
};

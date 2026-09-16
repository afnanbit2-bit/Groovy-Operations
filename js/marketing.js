/* Groovy Operations — marketing.js
   The Sales Team ▸ Marketing. Replaces the Content Tracker 2026 Google
   Sheet. Plain global JS (NO modules), loaded via <script src> like every
   other domain file; Firebase globals come from the bootstrap in index.html.

   M1 (Sept 2026): the Creator Database and the scoring engine.
   M2 (Sept 2026): the Dispatch Log — organic dispatches, the Shopify
   product picker, the Day-7 performance capture and creator rollups.
   M3 (Sept 2026): Paid PR requests, the approval gate, payment logging.
   M5 (Sept 2026): SLA / Day-7 reminders in the bell, the dashboard card.
   M6 (Sept 2026): Reports.
   M7 (Sept 2026): the importer for the Content Tracker 2026 sheet.
   M4 (Sept 2026): Shopify discount codes — created server-side by
   netlify/functions/marketing-discounts.js, counted nightly by
   marketing-code-rollup.js —
   see "The Sales Team ▸ Marketing" in CLAUDE.md.

   Who can reach it is decided by canAccessMarketing() in js/auth.js (owners
   + the creator_content_ops_lead role) and, for real, by isMarketing() in
   firestore.rules. The two must agree.

   Every "who did this" field stores a Firebase uid and is resolved to a
   name at render time — never a stored name, so a renamed or reassigned
   person never leaves stale records behind. */

// ── Constants ───────────────────────────────────────────────────────────

// Canonical city spellings — the "Pakistan Cities" column of the Content
// Tracker 2026 sheet's Lists tab, verbatim and in its order. The migration
// (M7) normalises every legacy spelling onto this list.
const MKT_PK_CITIES=["Islamabad","Rawalpindi","Lahore","Faisalabad","Multan","Gujranwala","Sialkot","Bahawalpur","Sargodha","Sahiwal","Sheikhupura","Rahim Yar Khan","Jhang","Gujrat","Kasur","Okara","Dera Ghazi Khan","Muzaffargarh","Vehari","Chiniot","Kamoke","Hafizabad","Mianwali","Layyah","Pakpattan","Khanewal","Jhelum","Attock","Chakwal","Narowal","Toba Tek Singh","Nankana Sahib","Bhakkar","Khushab","Lodhran","Mandi Bahauddin","Wazirabad","Kot Addu","Karachi","Hyderabad","Sukkur","Larkana","Nawabshah","Mirpur Khas","Jacobabad","Shikarpur","Khairpur","Dadu","Thatta","Badin","Tando Adam","Tando Allahyar","Ghotki","Umerkot","Sanghar","Peshawar","Mardan","Mingora (Swat)","Kohat","Abbottabad","Mansehra","Dera Ismail Khan","Bannu","Swabi","Nowshera","Charsadda","Haripur","Chitral","Batagram","Buner","Hangu","Karak","Lakki Marwat","Tank","Quetta","Gwadar","Turbat","Khuzdar","Sibi","Chaman","Hub","Dera Murad Jamali","Zhob","Loralai","Panjgur","Mastung","Gilgit","Skardu","Hunza","Muzaffarabad","Mirpur (AJK)","Rawalakot","Bagh","Kotli"];
// Common short forms seen in the sheet. Only unambiguous ones.
const _MKT_CITY_ALIASES={pindi:'Rawalpindi',rwp:'Rawalpindi',isb:'Islamabad',isl:'Islamabad',lhr:'Lahore',khi:'Karachi',
  swat:'Mingora (Swat)',di_khan:'Dera Ismail Khan','d.i khan':'Dera Ismail Khan','d.g khan':'Dera Ghazi Khan',
  // Seen in the Master List: a misspelling and an area of a listed city.
  abottabad:'Abbottabad','lahore cantt':'Lahore'};

// Niche tags the sheet already uses. The picker also offers every tag any
// creator carries (derived, never stored — same rule as board labels).
const MKT_NICHE_SEED=['Content Creator','Fashion Creator','Blogger','Meme/Comedy','Fitness','Public Figure'];

const MKT_STATUSES=[
  {k:'active',label:'Active'},
  {k:'do_not_use',label:'Do not use'},
  {k:'blacklisted',label:'Blacklisted'}
];
const MKT_TIERS=['A','B','C','below_threshold'];

// Section 4 of the spec. These are only the DEFAULTS — the live values sit
// in scoring_config/current and are edited in the app, because they will be
// retuned once there is real data. Nothing below reads these directly
// except _mktConfig(), which fills gaps in whatever is stored.
const MKT_DEFAULT_SCORING={
  // A creator scores the band whose max_followers they are BELOW; the last
  // band (max_followers:null) catches everyone else. "<10k: 5 · 10k–25k: 15"
  // means exactly 10,000 followers is 15.
  reach_bands:[
    {max_followers:10000,points:5},
    {max_followers:25000,points:15},
    {max_followers:50000,points:25},
    {max_followers:100000,points:33},
    {max_followers:null,points:40}
  ],
  // The highest band whose min_rate the engagement rate reaches.
  engagement_bands:[
    {min_rate:0,points:0},
    {min_rate:0.01,points:10},
    {min_rate:0.02,points:20},
    {min_rate:0.03,points:30},
    {min_rate:0.05,points:40}
  ],
  // avg_views / followers. No view data scores 0 — not the lowest band.
  view_through_bands:[
    {min_ratio:0,points:5},
    {min_ratio:0.5,points:10},
    {min_ratio:1,points:15},
    {min_ratio:2,points:20}
  ],
  tier_thresholds:{A:75,B:50,C:25},
  // Below this engagement rate the tier is forced to below_threshold
  // whatever the score — the guard against bought followers.
  engagement_floor_override:0.01
};

const _MKT_PAGE_SIZE=50;
const _MKT_TIERING_FIELDS=['follower_count','avg_views','avg_likes','avg_comments'];
const _MKT_COMPLETION_FIELDS=[
  ['phone','phone'],['address','address'],['top_size','top size'],['bottom_size','bottom size'],
  ['follower_count','followers'],['avg_views','avg views'],['avg_likes','avg likes'],['avg_comments','avg comments']
];

// ── State ───────────────────────────────────────────────────────────────
let mktCreators=[];
let mktCreatorsLoaded=false;
let _mktLoadErr=null;          // names what failed, or null
let mktScoringConfig=null;     // the stored doc, or null when never saved
let _mktScoringMeta=null;      // {updated_at, updated_by_user_id}
let _mktFilter={q:'',view:'all',tier:'all',status:'all',page:1};
let _mktSearchTimer=null;
let _mktSaving=false;
let _mktCfgDraft=null;
// M2 — Dispatch Log
let mktDispatches=[];
let mktDispatchesLoaded=false;
let _mktDispFilter={q:'',status:'all',month:'all',since:'',page:1};
let _mktDispSearchTimer=null;
let _mktCatalog=null;          // [{variant_id,product_id,product_title,variant_title,sku,status}]
let _mktCatalogMeta=null;      // {syncedAt:ms|null}
let _mktCatalogErr=null;
let _mktCatalogLoading=null;   // the in-flight promise, so two opens share one read
let _mktDraft=null;            // the dispatch being edited: {creatorId, products:[]}
let _mktPickTimer=null;
// M3 — Paid PR approvals
let mktPaidPRs=[];
let mktPaidPRsLoaded=false;
let _mktPrFilter={q:'',status:'pending'};
let _mktPrSearchTimer=null;

// ── Pure helpers (tests/marketing.test.js) ──────────────────────────────

function _mktEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function _mktTrim(v,max){return String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max||200);}

/** An IG handle as the system keys it: no @, no URL, lower case. '' if invalid. */
function mktNormHandle(raw){
  let h=String(raw==null?'':raw).trim().toLowerCase();
  h=h.replace(/^https?:\/\/(www\.)?instagram\.com\//,'').replace(/[/?#].*$/,'').replace(/^@+/,'');
  return /^[a-z0-9._]{1,30}$/.test(h)?h:'';
}

/** A city onto its canonical spelling, or '' when it is not on the list. */
function mktCanonCity(raw){
  const s=String(raw==null?'':raw).trim().replace(/\s+/g,' ');
  if(!s)return'';
  const low=s.toLowerCase();
  const hit=MKT_PK_CITIES.find(c=>c.toLowerCase()===low);
  if(hit)return hit;
  return _MKT_CITY_ALIASES[low]||_MKT_CITY_ALIASES[low.replace(/\s+/g,'_')]||'';
}

/** Niche as a clean array: split a comma string, canonical casing, no dupes. */
function mktNormNiche(raw,known){
  const list=Array.isArray(raw)?raw:String(raw==null?'':raw).split(',');
  const pool=(known||[]).concat(MKT_NICHE_SEED);
  const out=[];
  list.forEach(t=>{
    const v=_mktTrim(t,40);
    if(!v)return;
    const canon=pool.find(p=>p.toLowerCase()===v.toLowerCase())||v;
    if(!out.some(o=>o.toLowerCase()===canon.toLowerCase()))out.push(canon);
  });
  return out.slice(0,12);
}

/** A count from a form or a sheet: '', null, junk → null. Accepts 12,500 / 12.5k / 1.2m. */
function mktNum(v){
  if(v===null||v===undefined)return null;
  if(typeof v==='number')return isFinite(v)&&v>=0?v:null;
  let s=String(v).trim().toLowerCase().replace(/,/g,'');
  if(!s)return null;
  let mult=1;
  if(/k$/.test(s)){mult=1e3;s=s.slice(0,-1);}
  else if(/m$/.test(s)){mult=1e6;s=s.slice(0,-1);}
  if(!/^\d+(\.\d+)?$/.test(s))return null;
  return Math.round(parseFloat(s)*mult);
}

function _mktFinite(v,dflt){return typeof v==='number'&&isFinite(v)?v:dflt;}

/** The stored config with every gap filled from the defaults, bands sorted. */
function _mktConfig(raw){
  const d=MKT_DEFAULT_SCORING;
  const r=raw&&typeof raw==='object'?raw:{};
  const reach=(Array.isArray(r.reach_bands)&&r.reach_bands.length?r.reach_bands:d.reach_bands)
    .map(b=>({max_followers:b.max_followers==null?null:_mktFinite(Number(b.max_followers),null),points:_mktFinite(Number(b.points),0)}))
    .sort((a,b)=>(a.max_followers==null?Infinity:a.max_followers)-(b.max_followers==null?Infinity:b.max_followers));
  const eng=(Array.isArray(r.engagement_bands)&&r.engagement_bands.length?r.engagement_bands:d.engagement_bands)
    .map(b=>({min_rate:_mktFinite(Number(b.min_rate),0),points:_mktFinite(Number(b.points),0)}))
    .sort((a,b)=>a.min_rate-b.min_rate);
  const vt=(Array.isArray(r.view_through_bands)&&r.view_through_bands.length?r.view_through_bands:d.view_through_bands)
    .map(b=>({min_ratio:_mktFinite(Number(b.min_ratio),0),points:_mktFinite(Number(b.points),0)}))
    .sort((a,b)=>a.min_ratio-b.min_ratio);
  const t=r.tier_thresholds||{};
  return{
    reach_bands:reach,engagement_bands:eng,view_through_bands:vt,
    tier_thresholds:{A:_mktFinite(Number(t.A),d.tier_thresholds.A),B:_mktFinite(Number(t.B),d.tier_thresholds.B),C:_mktFinite(Number(t.C),d.tier_thresholds.C)},
    engagement_floor_override:_mktFinite(Number(r.engagement_floor_override),d.engagement_floor_override)
  };
}

/** What is wrong with a config draft, as sentences; [] when it can be saved. */
function mktValidateConfig(cfg){
  const errs=[];
  const c=cfg||{};
  const reach=c.reach_bands||[],eng=c.engagement_bands||[],vt=c.view_through_bands||[];
  if(!reach.length||!eng.length||!vt.length)errs.push('Every component needs at least one band.');
  const num=v=>typeof v==='number'&&isFinite(v)&&v>=0;
  if(reach.some(b=>!num(b.points)))errs.push('Reach points must be numbers of 0 or more.');
  if(reach.filter(b=>b.max_followers==null).length!==1)errs.push('Reach needs exactly one open-ended band (no follower maximum) for the biggest accounts.');
  if(reach.some(b=>b.max_followers!=null&&!(num(b.max_followers)&&b.max_followers>0)))errs.push('Reach follower maximums must be above 0.');
  const maxes=reach.filter(b=>b.max_followers!=null).map(b=>b.max_followers);
  if(new Set(maxes).size!==maxes.length)errs.push('Two reach bands share the same follower maximum.');
  if(eng.some(b=>!num(b.points)||!num(b.min_rate)))errs.push('Engagement bands need a minimum rate and points of 0 or more.');
  if(vt.some(b=>!num(b.points)||!num(b.min_ratio)))errs.push('View-through bands need a minimum ratio and points of 0 or more.');
  const t=c.tier_thresholds||{};
  if(![t.A,t.B,t.C].every(num))errs.push('Tier thresholds must be numbers.');
  else if(!(t.A>t.B&&t.B>t.C))errs.push('Tier thresholds must go down from A to B to C.');
  if(!num(c.engagement_floor_override)||c.engagement_floor_override>=1)errs.push('The engagement floor is a rate between 0 and 1 (1% = 0.01).');
  return errs;
}

/**
 * The 100-point weighted score. Returns nulls — not a guessed tier — when
 * the inputs needed to calculate one are missing (spec §10: nothing lands
 * in a tier it has no calculable basis for). avg_views is optional; no view
 * data scores 0 on that component.
 */
function mktScore(c,rawCfg){
  const cfg=_mktConfig(rawCfg);
  const f=mktNum(c&&c.follower_count),l=mktNum(c&&c.avg_likes),cm=mktNum(c&&c.avg_comments),v=mktNum(c&&c.avg_views);
  if(!(f>0)||l==null||cm==null)return{score:null,tier:null,engagement_rate:null,view_through:null,parts:null};
  // Rounded so 0.0099999999 can't slip under a 1% floor it actually meets.
  const er=Math.round((l+cm)/f*1e6)/1e6;
  const vtRatio=v==null?null:Math.round(v/f*1e6)/1e6;
  const reachBand=cfg.reach_bands.find(b=>b.max_followers==null||f<b.max_followers);
  const reach=reachBand?reachBand.points:0;
  let eng=0;cfg.engagement_bands.forEach(b=>{if(er>=b.min_rate)eng=b.points;});
  let vt=0;if(vtRatio!=null)cfg.view_through_bands.forEach(b=>{if(vtRatio>=b.min_ratio)vt=b.points;});
  const score=Math.max(0,Math.min(100,Math.round(reach+eng+vt)));
  const th=cfg.tier_thresholds;
  let tier=score>=th.A?'A':score>=th.B?'B':score>=th.C?'C':'below_threshold';
  if(er<cfg.engagement_floor_override)tier='below_threshold';
  return{score,tier,engagement_rate:er,view_through:vtRatio,parts:{reach,engagement:eng,view_through:vt},floored:er<cfg.engagement_floor_override};
}

/**
 * The computed fields to write for a creator. A manual override keeps its
 * tier through every recalculation — only the score and the formula's own
 * answer move — so the badge can say what the formula WOULD have given.
 */
function mktScoreFields(c,cfg,now){
  const r=mktScore(c,cfg);
  return{
    engagement_rate:r.engagement_rate,
    score:r.score,
    tier_formula:r.tier,
    tier:c&&c.tier_is_override?(c.tier||null):r.tier,
    tier_calculated_at:now
  };
}

/** Which fields a creator is still missing — the "Needs Completion" queue. */
function mktMissingFields(c){
  return _MKT_COMPLETION_FIELDS.filter(([k])=>{
    const v=c?c[k]:null;
    if(_MKT_TIERING_FIELDS.indexOf(k)>=0)return mktNum(v)==null;
    return !_mktTrim(v,500);
  }).map(([,label])=>label);
}

/** Every niche tag already in use, for the picker. Derived, never stored. */
function mktNicheLibrary(list){
  const seen=new Map();
  MKT_NICHE_SEED.concat(...(list||[]).map(c=>Array.isArray(c.niche)?c.niche:[])).forEach(t=>{
    const k=String(t).toLowerCase();if(t&&!seen.has(k))seen.set(k,t);
  });
  return Array.from(seen.values());
}

function _mktNewId(){return'cr_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}

/**
 * Turn the form into what gets written. Pure apart from the id it mints for
 * a new creator, so tests can drive it directly.
 * @returns {{error:string}|{id,handle,oldHandle,data,isNew}}
 */
function mktBuildCreatorPayload(form,existing,rawCfg,now,uid){
  const f=form||{};
  const handle=mktNormHandle(f.ig_handle);
  if(!handle)return{error:'Enter a valid Instagram handle — letters, numbers, dots and underscores only.'};
  const status=MKT_STATUSES.some(s=>s.k===f.status)?f.status:'active';
  let tiktok=String(f.tiktok_handle||'').trim();
  if(tiktok){tiktok=tiktok.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i,'').replace(/[/?#].*$/,'').replace(/^@+/,'').toLowerCase();
    if(!/^[a-z0-9._]{1,40}$/.test(tiktok))return{error:'That TikTok handle has characters TikTok does not allow.'};}
  const city=f.city?mktCanonCity(f.city):'';
  if(f.city&&!city&&!(existing&&existing.city===f.city))return{error:'Pick the city from the list.'};
  const override=MKT_TIERS.indexOf(f.tier_override)>=0?f.tier_override:'';
  const reason=_mktTrim(f.tier_override_reason,300);
  if(override&&!reason)return{error:'A manual tier needs a reason — it is shown wherever the tier is.'};
  const nums={};
  for(const k of _MKT_TIERING_FIELDS){
    const raw=f[k];
    const n=mktNum(raw);
    if(raw!==undefined&&raw!==null&&String(raw).trim()!==''&&n==null)return{error:'"'+String(raw).trim()+'" is not a number ('+k.replace(/_/g,' ')+').'};
    nums[k]=n;
  }
  const old=existing||{};
  const data={
    name:_mktTrim(f.name,80),
    ig_handle:handle,
    tiktok_handle:tiktok,
    niche:mktNormNiche(f.niche,mktNicheLibrary(typeof mktCreators!=='undefined'?mktCreators:[])),
    city:city||(existing&&existing.city===f.city?f.city:''),
    address:_mktTrim(f.address,300),
    phone:_mktTrim(f.phone,30),
    top_size:_mktTrim(f.top_size,20),
    bottom_size:_mktTrim(f.bottom_size,20),
    status,
    follower_count:nums.follower_count,
    avg_views:nums.avg_views,
    avg_likes:nums.avg_likes,
    avg_comments:nums.avg_comments,
    tier_is_override:!!override,
    tier_override_reason:override?reason:''
  };
  if(override)data.tier=override;
  // Input timestamps move only when the input did — so "followers as of"
  // stays honest when someone edits an address.
  data.follower_count_updated_at=(nums.follower_count!==(old.follower_count==null?null:old.follower_count))?now:(old.follower_count_updated_at||null);
  const metricsChanged=['avg_views','avg_likes','avg_comments'].some(k=>nums[k]!==(old[k]==null?null:old[k]));
  data.metrics_updated_at=metricsChanged?now:(old.metrics_updated_at||null);
  Object.assign(data,mktScoreFields(Object.assign({},data,{tier:override||null}),rawCfg,now));
  if(!override)data.tier=data.tier_formula;
  data.updated_at=now;
  data.updated_by_user_id=uid||null;
  const isNew=!existing;
  if(isNew){
    Object.assign(data,{
      date_added:now,added_by_user_id:uid||null,
      lifetime_organic_dispatches:0,lifetime_paid_prs:0,lifetime_pkr_spent:0,
      lifetime_content_delivered:0,lifetime_fulfillment_rate:null,
      lifetime_codes_issued:0,lifetime_code_redemptions:0,lifetime_code_revenue_attributed:0,
      first_dispatch_date:null,last_dispatch_date:null
    });
  }
  return{id:isNew?_mktNewId():existing.id,handle,oldHandle:isNew?null:(existing.ig_handle||null),data,isNew};
}

/** The list as the filters see it. */
function mktFilteredCreators(list,flt){
  const f=flt||{};
  const q=String(f.q||'').trim().toLowerCase().replace(/^@/,'');
  return (list||[]).filter(c=>{
    if(f.view==='incomplete'&&!mktMissingFields(c).length)return false;
    if(f.status&&f.status!=='all'&&(c.status||'active')!==f.status)return false;
    if(f.tier&&f.tier!=='all'){
      if(f.tier==='unscored'){if(c.tier)return false;}
      else if(c.tier!==f.tier)return false;
    }
    if(q){
      const hay=[c.name,c.ig_handle,c.tiktok_handle,c.city,(c.niche||[]).join(' ')].join(' ').toLowerCase();
      if(hay.indexOf(q)<0)return false;
    }
    return true;
  }).sort((a,b)=>{
    const ta=a.tier?MKT_TIERS.indexOf(a.tier):9,tb=b.tier?MKT_TIERS.indexOf(b.tier):9;
    if(ta!==tb)return ta-tb;
    const sa=a.score==null?-1:a.score,sb=b.score==null?-1:b.score;
    if(sa!==sb)return sb-sa;
    return String(a.ig_handle||'').localeCompare(String(b.ig_handle||''));
  });
}

// ── Nav ─────────────────────────────────────────────────────────────────
// js/shared.js builds "The Sales Team ▸" from this list, so later
// milestones add their pages here and nowhere else.
function mktNavItems(){
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())return[];
  return[
    {id:'mkt-creators',label:'Creator Database',iconName:'people'},
    {id:'mkt-dispatches',label:'Dispatch Log',iconName:'box'},
    {id:'mkt-paid-pr',label:'Paid PR Approvals',iconName:'money'},
    {id:'mkt-reports',label:'Reports',iconName:'activity'}
  ];
}

// One entry point for every Marketing page, so js/shared.js dispatches all
// of them with a single `id.startsWith('mkt-')` line and never needs
// touching again when a milestone adds a page.
const _MKT_PAGES={'mkt-creators':()=>renderMarketingCreators(),'mkt-dispatches':()=>renderMarketingDispatches(),'mkt-paid-pr':()=>renderMarketingPaidPR(),'mkt-reports':()=>renderMarketingReports(),'mkt-import':()=>renderMarketingImport()};
function mktPageHTML(id){return(_MKT_PAGES[id]||_MKT_PAGES['mkt-creators'])();}
function mktRenderPage(id){
  const m=document.getElementById('main-content');
  if(!m)return;
  if(!mktCreatorsLoaded){
    m.innerHTML=typeof gvSkeleton==='function'?gvSkeleton(6):'';
    loadMarketingCreators().then(()=>{if(typeof currentPage==='undefined'||currentPage===id)m.innerHTML=mktPageHTML(id);});
  }else m.innerHTML=mktPageHTML(id);
}

// ── People ──────────────────────────────────────────────────────────────
function _mktUserName(uid){
  if(!uid)return'—';
  const me=typeof session!=='undefined'&&session;
  if(me&&me.uid===uid)return'you';
  const profs=typeof userProfiles!=='undefined'?userProfiles:[];
  const p=profs.find(x=>x&&x.uid===uid);
  if(p){
    if(p.displayName)return p.displayName;
    const d=(typeof USER_DEFS!=='undefined'?USER_DEFS:[]).find(u=>u.u===p.username);
    if(d)return d.name;
  }
  return'a teammate';
}
function _mktWhen(ms){
  if(!ms)return'—';
  const d=new Date(ms);
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}
function _mktFmtNum(n){
  if(n==null)return'—';
  if(n>=1e6)return(Math.round(n/1e5)/10)+'M';
  if(n>=1e4)return(Math.round(n/100)/10)+'K';
  return Number(n).toLocaleString('en-US');
}
function _mktPct(r){return r==null?'—':(Math.round(r*1000)/10)+'%';}

// ── Loading ─────────────────────────────────────────────────────────────
// Called from renderPage with no .catch, so it must never reject (CLAUDE.md,
// "Loading must never hang"). Each read settles on its own.
async function loadMarketingCreators(){
  _mktLoadErr=null;
  const [cr,cfg,dsp,prq,cod,cmeta]=await Promise.allSettled([
    getDocs(collection(db,'creators')),
    getDoc(doc(db,'scoring_config','current')),
    getDocs(collection(db,'dispatches')),
    getDocs(collection(db,'paid_pr_requests')),
    getDocs(collection(db,'discount_codes')),
    getDoc(doc(db,'shopify_sync_meta','marketing_codes'))
  ]);
  const failed=[];
  if(cr.status==='fulfilled'){
    mktCreators=cr.value.docs.map(d=>Object.assign({id:d.id},d.data()));
  }else{failed.push('creators');console.warn('[marketing] creators load failed',cr.reason);}
  if(cfg.status==='fulfilled'){
    const s=cfg.value;
    const ex=s&&typeof s.exists==='function'?s.exists():false;
    const data=ex?s.data():null;
    mktScoringConfig=data;
    _mktScoringMeta=data?{updated_at:data.updated_at||null,updated_by_user_id:data.updated_by_user_id||null}:null;
  }else{failed.push('scoring_config');console.warn('[marketing] scoring config load failed',cfg.reason);}
  if(dsp.status==='fulfilled'){
    mktDispatches=dsp.value.docs.map(d=>Object.assign({id:d.id},d.data()));
    mktDispatchesLoaded=true;
  }else{mktDispatchesLoaded=false;failed.push('dispatches');console.warn('[marketing] dispatches load failed',dsp.reason);}
  if(prq.status==='fulfilled'){
    mktPaidPRs=prq.value.docs.map(d=>Object.assign({id:d.id},d.data()));
    mktPaidPRsLoaded=true;
  }else{mktPaidPRsLoaded=false;failed.push('paid_pr_requests');console.warn('[marketing] paid PR requests load failed',prq.reason);}
  if(cod.status==='fulfilled'){
    mktCodes=cod.value.docs.map(d=>Object.assign({id:d.id},d.data()));
    mktCodesLoaded=true;
  }else{mktCodesLoaded=false;failed.push('discount_codes');console.warn('[marketing] discount codes load failed',cod.reason);}
  if(cmeta.status==='fulfilled'){const m=cmeta.value;_mktCodesMeta=m&&typeof m.exists==='function'&&m.exists()?m.data():null;}
  if(failed.length)_mktLoadErr=failed;
  mktCreatorsLoaded=cr.status==='fulfilled';
  // Names for "added by" — the directory is small and its loader cannot reject.
  if(typeof loadProfiles==='function'&&typeof profilesLoaded!=='undefined'&&!profilesLoaded){
    loadProfiles().then(()=>{if(typeof currentPage!=='undefined'&&String(currentPage).startsWith('mkt-'))_mktRerenderPage();}).catch(()=>{});
  }
}

window.mktRetryLoad=function(){
  mktCreatorsLoaded=false;
  const pg=typeof currentPage!=='undefined'&&String(currentPage).startsWith('mkt-')?currentPage:'mkt-creators';
  if(typeof window.showPage==='function')window.showPage(pg);
};

// ── Page ────────────────────────────────────────────────────────────────
function _mktTierChip(c){
  const t=c&&c.tier;
  const label=t==='below_threshold'?'Below':t||'Unscored';
  const cls=t==='A'?'a':t==='B'?'b':t==='C'?'c':t==='below_threshold'?'low':'none';
  const ov=c&&c.tier_is_override?`<span class="mkt-override" title="Manually set. Formula says ${_mktEsc(c.tier_formula==='below_threshold'?'Below':c.tier_formula||'unscored')}. Reason: ${_mktEsc(c.tier_override_reason||'')}">manual</span>`:'';
  return`<span class="mkt-tier mkt-tier-${cls}">${_mktEsc(label)}</span>${ov}`;
}
function _mktStatusLabel(k){const s=MKT_STATUSES.find(x=>x.k===k);return s?s.label:'Active';}

function renderMarketingCreators(){
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())
    return'<div class="empty">The Creator Database is limited to the owners and the Creator &amp; Content Operations Lead.</div>';
  if(!mktCreatorsLoaded){
    return`<div class="page-head"><div class="page-title">Creator Database</div></div>
      <div class="card"><div style="font-weight:600;margin-bottom:6px">The creator list could not be loaded.</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.5">The database refused the read (${_mktEsc((_mktLoadErr||[]).join(', ')||'unknown')}). If this is the first visit since the Marketing module shipped, the Firestore rules in the Firebase Console probably have not been republished yet.</div>
      <button class="btn-outline" style="margin-top:12px" onclick="window.mktRetryLoad()">Retry</button></div>`;
  }
  const cfgFailed=(_mktLoadErr||[]).indexOf('scoring_config')>=0;
  const warn=cfgFailed?`<div class="mkt-warn">Scoring settings could not be read, so the default bands are in use until they load. <button class="btn-outline" onclick="window.mktRetryLoad()">Retry</button></div>`:'';
  return`<div class="page-head mkt-head">
      <div><div class="page-title">Creator Database</div>
      <div class="page-sub">The Sales Team ▸ Marketing</div></div>
      <div class="mkt-actions">
        <button class="btn-outline" onclick="window.showPage('mkt-import')">Import from sheet</button>
        <button class="btn-outline" onclick="window.mktOpenScoring()">Scoring settings</button>
        <button class="btn-outline mkt-primary" onclick="window.mktOpenCreator('')">+ Add creator</button>
      </div>
    </div>
    ${warn}
    <div id="mkt-stats">${_mktStatsHTML()}</div>
    <div class="mkt-filters">
      <input id="mkt-search" class="mkt-search" type="search" placeholder="Search name, @handle, city, niche" value="${_mktEsc(_mktFilter.q)}" oninput="window.mktSearchInput(this.value)" aria-label="Search creators">
      <div class="mkt-chiprow">
        <button class="filter-chip${_mktFilter.view==='all'?' active':''}" onclick="window.mktSetFilter('view','all')">All</button>
        <button class="filter-chip${_mktFilter.view==='incomplete'?' active':''}" onclick="window.mktSetFilter('view','incomplete')">Needs completion</button>
      </div>
      <select id="mkt-f-tier" class="mkt-select" onchange="window.mktSetFilter('tier',this.value)" aria-label="Tier">
        ${[['all','All tiers'],['A','Tier A'],['B','Tier B'],['C','Tier C'],['below_threshold','Below threshold'],['unscored','Unscored']].map(([k,l])=>`<option value="${k}"${_mktFilter.tier===k?' selected':''}>${l}</option>`).join('')}
      </select>
      <select id="mkt-f-status" class="mkt-select" onchange="window.mktSetFilter('status',this.value)" aria-label="Status">
        <option value="all"${_mktFilter.status==='all'?' selected':''}>Any status</option>
        ${MKT_STATUSES.map(s=>`<option value="${s.k}"${_mktFilter.status===s.k?' selected':''}>${s.label}</option>`).join('')}
      </select>
    </div>
    <div id="mkt-list">${_mktListHTML()}</div>
    <div style="height:80px"></div>`;
}

function _mktStatsHTML(){
  const all=mktCreators;
  const n=t=>all.filter(c=>c.tier===t).length;
  const incomplete=all.filter(c=>mktMissingFields(c).length).length;
  const unscored=all.filter(c=>!c.tier).length;
  const tile=(label,val,sub,onclick)=>`<button class="mkt-stat" onclick="${onclick}"><span class="mkt-stat-label">${label}</span><span class="mkt-stat-val">${val}</span><span class="mkt-stat-sub">${sub}</span></button>`;
  return`<div class="mkt-stats">
    ${tile('Creators',all.length,`${all.filter(c=>(c.status||'active')==='active').length} active`,"window.mktSetFilter('reset')")}
    ${tile('Tier A · B · C',`${n('A')} · ${n('B')} · ${n('C')}`,`${n('below_threshold')} below threshold`,"window.mktSetFilter('tier','A')")}
    ${tile('Unscored',unscored,'no tiering inputs yet',"window.mktSetFilter('tier','unscored')")}
    ${tile('Needs completion',incomplete,'missing contact, sizes or metrics',"window.mktSetFilter('view','incomplete')")}
  </div>`;
}

function _mktListHTML(){
  const rows=mktFilteredCreators(mktCreators,_mktFilter);
  if(!mktCreators.length)return`<div class="card empty">No creators yet. Add the first one, or run the Master List migration.</div>`;
  if(!rows.length)return`<div class="card empty">No creators match these filters.</div>`;
  const pages=Math.max(1,Math.ceil(rows.length/_MKT_PAGE_SIZE));
  if(_mktFilter.page>pages)_mktFilter.page=pages;
  const slice=rows.slice((_mktFilter.page-1)*_MKT_PAGE_SIZE,_mktFilter.page*_MKT_PAGE_SIZE);
  const incompleteView=_mktFilter.view==='incomplete';
  const body=slice.map(c=>{
    const missing=mktMissingFields(c);
    const dim=(c.status||'active')!=='active';
    return`<tr class="mkt-row${dim?' mkt-dim':''}" data-id="${_mktEsc(c.id)}" onclick="window.mktOpenCreator(this.dataset.id)" tabindex="0" onkeydown="if(event.key==='Enter')window.mktOpenCreator(this.dataset.id)">
      <td class="mkt-c-who"><div class="mkt-name">${_mktEsc(c.name||'—')}</div><div class="mkt-handle">@${_mktEsc(c.ig_handle)}</div></td>
      <td class="mkt-c-tier">${_mktTierChip(c)}</td>
      <td class="num" data-label="Score">${c.score==null?'—':c.score}</td>
      <td class="num" data-label="Followers">${_mktFmtNum(c.follower_count)}</td>
      <td class="num" data-label="Engagement">${_mktPct(c.engagement_rate)}</td>
      <td data-label="City">${_mktEsc(c.city||'—')}</td>
      <td class="mkt-niche">${(c.niche||[]).map(t=>`<span class="mkt-tag-chip">${_mktEsc(t)}</span>`).join('')||'—'}</td>
      <td class="mkt-c-last">${incompleteView?`<span class="mkt-missing">${_mktEsc(missing.join(', '))}</span>`:`<span class="mkt-status mkt-status-${_mktEsc(c.status||'active')}">${_mktStatusLabel(c.status||'active')}</span>`}</td>
    </tr>`;
  }).join('');
  const pager=pages>1?`<div class="mkt-pager">
      <button class="btn-outline" ${_mktFilter.page<=1?'disabled':''} onclick="window.mktPage(-1)">Previous</button>
      <span>Page ${_mktFilter.page} of ${pages}</span>
      <button class="btn-outline" ${_mktFilter.page>=pages?'disabled':''} onclick="window.mktPage(1)">Next</button>
    </div>`:'';
  return`<div class="card mkt-card">
    <div class="mkt-count">${rows.length} of ${mktCreators.length} creators</div>
    <div class="mkt-tablewrap"><table class="mkt-table">
      <thead><tr><th>Creator</th><th>Tier</th><th class="num">Score</th><th class="num">Followers</th><th class="num">Engagement</th><th>City</th><th>Niche</th><th>${incompleteView?'Missing':'Status'}</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    ${pager}
  </div>`;
}

// Filters repaint the stats and the list only — never the search box, so
// typing never loses focus and no refocus dance is needed.
function _mktRepaint(){
  const l=document.getElementById('mkt-list');
  if(l)l.innerHTML=_mktListHTML();
  const s=document.getElementById('mkt-stats');
  if(s)s.innerHTML=_mktStatsHTML();
}
function _mktRerenderPage(){
  const m=document.getElementById('main-content');
  if(m&&typeof currentPage!=='undefined'&&String(currentPage).startsWith('mkt-'))m.innerHTML=mktPageHTML(currentPage);
}

window.mktSearchInput=function(v){
  clearTimeout(_mktSearchTimer);
  _mktSearchTimer=setTimeout(()=>{_mktFilter.q=String(v||'');_mktFilter.page=1;_mktRepaint();},180);
};
window.mktSetFilter=function(key,val){
  if(key==='reset'){_mktFilter={q:'',view:'all',tier:'all',status:'all',page:1};_mktRerenderPage();return;}
  if(['view','tier','status'].indexOf(key)<0)return;
  _mktFilter[key]=val;_mktFilter.page=1;
  // The chips and selects live outside the repainted region.
  _mktRerenderPage();
};
window.mktPage=function(d){_mktFilter.page=Math.max(1,_mktFilter.page+d);_mktRepaint();};

// ── Create / edit ───────────────────────────────────────────────────────
function _mktCloseModal(){document.getElementById('mkt-modal-back')?.remove();}
window.mktCloseModal=_mktCloseModal;

function _mktOpenModal(html,wide){
  _mktCloseModal();
  const back=document.createElement('div');
  back.className='hrm-modal-back';back.id='mkt-modal-back';
  back.onclick=ev=>{if(ev.target===back)_mktCloseModal();};
  back.innerHTML=`<div class="hrm-modal mkt-modal${wide?' mkt-modal-wide':''}" onclick="event.stopPropagation()" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(back);
  return back;
}

window.mktOpenCreator=function(id){
  const c=id?mktCreators.find(x=>x.id===id):null;
  if(id&&!c){showToast('That creator is no longer in the list — refresh the page.',true);return;}
  const v=k=>_mktEsc(c&&c[k]!=null?c[k]:'');
  const lib=mktNicheLibrary(mktCreators);
  const has=t=>!!(c&&(c.niche||[]).some(x=>x.toLowerCase()===t.toLowerCase()));
  const cityKnown=!c||!c.city||MKT_PK_CITIES.indexOf(c.city)>=0;
  const cityOpts=['<option value="">—</option>']
    .concat(cityKnown?[]:[`<option value="${v('city')}" selected>${v('city')} (not on the list)</option>`])
    .concat(MKT_PK_CITIES.map(ct=>`<option value="${_mktEsc(ct)}"${c&&c.city===ct?' selected':''}>${_mktEsc(ct)}</option>`)).join('');
  const ovTier=c&&c.tier_is_override?c.tier:'';
  const lifetime=c?`<div class="mkt-section">
      <div class="mkt-section-title">Lifetime</div>
      <div class="mkt-lifetime">
        ${[['Organic dispatches',c.lifetime_organic_dispatches],['Paid PRs',c.lifetime_paid_prs],['PKR spent',c.lifetime_pkr_spent],['Content delivered',c.lifetime_content_delivered],['Codes issued',c.lifetime_codes_issued],['Code redemptions',c.lifetime_code_redemptions]]
          .map(([l,n])=>`<div><span>${l}</span><b>${n==null?'—':Number(n).toLocaleString('en-US')}</b></div>`).join('')}
      </div>
      <div class="mkt-note">Organic counts and dates come from the Dispatch Log; Paid PR and discount-code figures arrive with those pages.</div>
    </div>
    ${_mktCreatorDispatchesHTML(c)}
    <div class="mkt-prov">Added by ${_mktEsc(_mktUserName(c.added_by_user_id))} · ${_mktWhen(c.date_added)}${c.updated_at?` · last edited by ${_mktEsc(_mktUserName(c.updated_by_user_id))} · ${_mktWhen(c.updated_at)}`:''}</div>`:'';
  _mktOpenModal(`
    <h3>${c?_mktEsc(c.name||'@'+c.ig_handle):'Add creator'}</h3>
    <div class="sub">${c?'@'+_mktEsc(c.ig_handle)+' · '+_mktStatusLabel(c.status||'active'):'Only the Instagram handle is required. Everything else can be filled in later from Needs completion.'}</div>
    <input type="hidden" id="mkt-f-id" value="${c?_mktEsc(c.id):''}">
    <div class="mkt-section">
      <div class="mkt-section-title">Identity</div>
      <div class="form-grid">
        <div class="field"><label for="mkt-f-handle">Instagram handle *</label><input id="mkt-f-handle" value="${v('ig_handle')}" placeholder="handle, without @" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="mkt-f-name">Name</label><input id="mkt-f-name" value="${v('name')}" autocomplete="off"></div>
        <div class="field"><label for="mkt-f-tiktok">TikTok handle</label><input id="mkt-f-tiktok" value="${v('tiktok_handle')}" placeholder="optional" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="mkt-f-status">Status</label><select id="mkt-f-status">${MKT_STATUSES.map(s=>`<option value="${s.k}"${(c?c.status||'active':'active')===s.k?' selected':''}>${s.label}</option>`).join('')}</select></div>
      </div>
      <div class="field" style="margin-top:10px"><label>Niche</label>
        <div class="mkt-tags" id="mkt-f-niche">${lib.map((t,i)=>`<label class="mkt-tag"><input type="checkbox" id="mkt-f-niche-${i}" value="${_mktEsc(t)}"${has(t)?' checked':''}><span>${_mktEsc(t)}</span></label>`).join('')}</div>
        <input id="mkt-f-niche-other" placeholder="Other tags, comma-separated" autocomplete="off" style="margin-top:8px">
      </div>
    </div>
    <div class="mkt-section">
      <div class="mkt-section-title">Shipping</div>
      <div class="form-grid">
        <div class="field"><label for="mkt-f-city">City</label><select id="mkt-f-city">${cityOpts}</select></div>
        <div class="field"><label for="mkt-f-phone">Phone</label><input id="mkt-f-phone" value="${v('phone')}" inputmode="tel" autocomplete="off"></div>
        <div class="field" style="grid-column:1/-1"><label for="mkt-f-address">Address</label><input id="mkt-f-address" value="${v('address')}" autocomplete="off"></div>
        <div class="field"><label for="mkt-f-top">Top size</label><input id="mkt-f-top" value="${v('top_size')}" autocomplete="off"></div>
        <div class="field"><label for="mkt-f-bottom">Bottom size</label><input id="mkt-f-bottom" value="${v('bottom_size')}" autocomplete="off"></div>
      </div>
    </div>
    <div class="mkt-section">
      <div class="mkt-section-title">Tiering inputs</div>
      <div class="form-grid mkt-grid-4">
        <div class="field"><label for="mkt-f-followers">Followers</label><input id="mkt-f-followers" value="${v('follower_count')}" inputmode="numeric" placeholder="e.g. 24500 or 24.5k" oninput="window.mktPreviewScore()"></div>
        <div class="field"><label for="mkt-f-views">Avg views</label><input id="mkt-f-views" value="${v('avg_views')}" inputmode="numeric" oninput="window.mktPreviewScore()"></div>
        <div class="field"><label for="mkt-f-likes">Avg likes</label><input id="mkt-f-likes" value="${v('avg_likes')}" inputmode="numeric" oninput="window.mktPreviewScore()"></div>
        <div class="field"><label for="mkt-f-comments">Avg comments</label><input id="mkt-f-comments" value="${v('avg_comments')}" inputmode="numeric" oninput="window.mktPreviewScore()"></div>
      </div>
      <div id="mkt-score-preview" class="mkt-preview" aria-live="polite"></div>
      ${c?`<div class="mkt-note">Followers as of ${_mktWhen(c.follower_count_updated_at)} · metrics as of ${_mktWhen(c.metrics_updated_at)}</div>`:''}
    </div>
    <div class="mkt-section">
      <div class="mkt-section-title">Manual tier</div>
      <div class="form-grid">
        <div class="field"><label for="mkt-f-override">Tier</label><select id="mkt-f-override" onchange="window.mktPreviewScore()">
          <option value="">Use the formula</option>
          ${[['A','A'],['B','B'],['C','C'],['below_threshold','Below threshold']].map(([k,l])=>`<option value="${k}"${ovTier===k?' selected':''}>${l}</option>`).join('')}
        </select></div>
        <div class="field"><label for="mkt-f-reason">Reason (required for a manual tier)</label><input id="mkt-f-reason" value="${v('tier_override_reason')}" autocomplete="off"></div>
      </div>
      <div class="mkt-note">A manual tier is marked "manual" everywhere it appears, so it is never mistaken for the formula.</div>
    </div>
    ${lifetime}
    <div id="mkt-f-error" class="mkt-error" hidden></div>
    <div class="mkt-modal-actions">
      <button class="btn-outline" onclick="window.mktCloseModal()">Cancel</button>
      <button class="btn-primary" id="mkt-f-save" onclick="window.mktSaveCreator()">${c?'Save changes':'Add creator'}</button>
    </div>`,true);
  window.mktPreviewScore();
  document.getElementById(c?'mkt-f-name':'mkt-f-handle')?.focus();
};

function _mktVal(id){const e=document.getElementById(id);return e?e.value:'';}

function _mktReadForm(){
  const niche=[];
  document.querySelectorAll('#mkt-f-niche input[type=checkbox]').forEach(cb=>{if(cb.checked)niche.push(cb.value);});
  _mktVal('mkt-f-niche-other').split(',').forEach(t=>{if(t.trim())niche.push(t);});
  return{
    ig_handle:_mktVal('mkt-f-handle'),name:_mktVal('mkt-f-name'),tiktok_handle:_mktVal('mkt-f-tiktok'),
    status:_mktVal('mkt-f-status'),niche,city:_mktVal('mkt-f-city'),phone:_mktVal('mkt-f-phone'),
    address:_mktVal('mkt-f-address'),top_size:_mktVal('mkt-f-top'),bottom_size:_mktVal('mkt-f-bottom'),
    follower_count:_mktVal('mkt-f-followers'),avg_views:_mktVal('mkt-f-views'),
    avg_likes:_mktVal('mkt-f-likes'),avg_comments:_mktVal('mkt-f-comments'),
    tier_override:_mktVal('mkt-f-override'),tier_override_reason:_mktVal('mkt-f-reason')
  };
}

window.mktPreviewScore=function(){
  const el=document.getElementById('mkt-score-preview');
  if(!el)return;
  const f=_mktReadForm();
  const r=mktScore({follower_count:f.follower_count,avg_views:f.avg_views,avg_likes:f.avg_likes,avg_comments:f.avg_comments},mktScoringConfig);
  if(r.score==null){el.innerHTML='<span class="mkt-muted">Enter followers, avg likes and avg comments to calculate a score. Avg views is optional.</span>';return;}
  const tierLabel=r.tier==='below_threshold'?'Below threshold':'Tier '+r.tier;
  const ov=f.tier_override?` · shown as <b>${_mktEsc(f.tier_override==='below_threshold'?'Below threshold':'Tier '+f.tier_override)}</b> (manual)`:'';
  el.innerHTML=`<b>${r.score}/100 · ${tierLabel}</b>${ov}<span class="mkt-muted"> — reach ${r.parts.reach} + engagement ${r.parts.engagement} (${_mktPct(r.engagement_rate)}) + view-through ${r.parts.view_through}${r.view_through==null?' (no view data)':' ('+_mktPct(r.view_through)+')'}${r.floored?' · engagement is under the floor, so the tier is forced to Below threshold':''}</span>`;
};

function _mktFormError(msg){
  const e=document.getElementById('mkt-f-error');
  if(!e){showToast(msg,true);return;}
  e.textContent=msg;e.hidden=false;
}

window.mktSaveCreator=async function(){
  if(_mktSaving)return;
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing()){_mktFormError('Your account cannot edit creators.');return;}
  const id=_mktVal('mkt-f-id');
  const existing=id?mktCreators.find(x=>x.id===id):null;
  const now=Date.now();
  const built=mktBuildCreatorPayload(_mktReadForm(),existing,mktScoringConfig,now,session&&session.uid);
  if(built.error){_mktFormError(built.error);return;}
  const btn=document.getElementById('mkt-f-save');
  _mktSaving=true;if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await mktWriteCreator(built);
    const merged=Object.assign({},existing||{},built.data,{id:built.id});
    if(existing)mktCreators=mktCreators.map(x=>x.id===built.id?merged:x);
    else mktCreators=mktCreators.concat([merged]);
    _mktCloseModal();
    showToast(existing?'Saved @'+built.handle:'Added @'+built.handle);
    if(typeof logActivity==='function')logActivity(existing?'Creator updated':'Creator added','@'+built.handle+(built.data.tier?' · tier '+built.data.tier:''));
    _mktRerenderPage();
  }catch(e){
    if(e&&e.code==='mkt/duplicate'){
      const other=mktCreators.find(x=>x.id===e.otherId);
      _mktFormError('@'+built.handle+' is already in the database'+(other&&other.name?' ('+other.name+')':'')+'. Open that record instead of adding it again.');
    }else if(typeof navigator!=='undefined'&&navigator.onLine===false){
      _mktFormError('Saving a creator checks the handle is unique, which needs a connection. Try again when you are back online.');
    }else{
      console.error('[marketing] save failed',e);
      _mktFormError('Could not save: '+((e&&e.message)||'unknown error')+'. Nothing was changed.');
    }
  }finally{
    _mktSaving=false;
    if(btn){btn.disabled=false;btn.textContent=existing?'Save changes':'Add creator';}
  }
};

/**
 * IG handle uniqueness is enforced at WRITE time: creator_handles/{handle}
 * is a lock document naming the creator that owns the handle, written in
 * the same transaction as the creator. firestore.rules refuses to
 * overwrite a lock, and refuses a creator whose lock does not point back
 * at it — so two people adding the same handle at the same moment cannot
 * both succeed, whatever the client does.
 */
async function mktWriteCreator(built){
  const creatorRef=doc(db,'creators',built.id);
  const lockRef=doc(db,'creator_handles',built.handle);
  await runTransaction(db,async tx=>{
    const lock=await tx.get(lockRef);
    const owner=lock&&lock.exists()?(lock.data()||{}).creatorId:null;
    if(owner&&owner!==built.id){const err=new Error('duplicate handle');err.code='mkt/duplicate';err.otherId=owner;throw err;}
    if(!owner)tx.set(lockRef,{creatorId:built.id,handle:built.handle,created_at:Date.now()});
    if(built.oldHandle&&built.oldHandle!==built.handle)tx.delete(doc(db,'creator_handles',built.oldHandle));
    if(built.isNew)tx.set(creatorRef,built.data);
    else tx.update(creatorRef,built.data);
  });
}

// ── Scoring settings ────────────────────────────────────────────────────
window.mktOpenScoring=function(){
  _mktCfgDraft=JSON.parse(JSON.stringify(_mktConfig(mktScoringConfig)));
  _mktRenderScoring();
};

function _mktRenderScoring(){
  const d=_mktCfgDraft;
  const row=(comp,i,fields)=>`<div class="mkt-band">${fields.map(([k,label,step,pct])=>{
      const raw=d[comp][i][k];
      const shown=raw==null?'':pct?Math.round(raw*10000)/100:raw;
      return`<label class="field"><span class="mkt-band-label">${label}</span><input id="mkt-c-${comp}-${i}-${k}" type="number" min="0" step="${step}" value="${shown}" ${k==='max_followers'&&raw==null?'placeholder="no limit"':''} onchange="window.mktCfgSet('${comp}',${i},'${k}',this.value,${pct?'true':'false'})"></label>`;
    }).join('')}<button class="mkt-band-x" aria-label="Remove band" onclick="window.mktCfgBand('${comp}',${i})">×</button></div>`;
  const block=(comp,title,help,fields)=>`<div class="mkt-section">
      <div class="mkt-section-title">${title}</div><div class="mkt-note" style="margin:-4px 0 8px">${help}</div>
      ${d[comp].map((_,i)=>row(comp,i,fields)).join('')}
      <button class="btn-outline" onclick="window.mktCfgBand('${comp}',-1)">Add band</button>
    </div>`;
  const meta=_mktScoringMeta&&_mktScoringMeta.updated_at?`Last changed by ${_mktEsc(_mktUserName(_mktScoringMeta.updated_by_user_id))} · ${_mktWhen(_mktScoringMeta.updated_at)}`:'Using the default bands from the spec — never changed.';
  _mktOpenModal(`
    <h3>Scoring settings</h3>
    <div class="sub">${meta}</div>
    ${block('reach_bands','Reach — followers','Points for a creator with FEWER followers than the maximum. Leave one band with no maximum for the largest accounts.',[['max_followers','Followers below','1',false],['points','Points','1',false]])}
    ${block('engagement_bands','Engagement — (avg likes + avg comments) ÷ followers','The highest band the rate reaches.',[['min_rate','Rate at least (%)','0.1',true],['points','Points','1',false]])}
    ${block('view_through_bands','View-through — avg views ÷ followers','The highest band the ratio reaches. A creator with no view data scores 0 here.',[['min_ratio','Ratio at least (%)','1',true],['points','Points','1',false]])}
    <div class="mkt-section">
      <div class="mkt-section-title">Tiers</div>
      <div class="form-grid mkt-grid-4">
        ${['A','B','C'].map(t=>`<div class="field"><label for="mkt-c-th-${t}">Tier ${t} from</label><input id="mkt-c-th-${t}" type="number" min="0" max="100" value="${d.tier_thresholds[t]}" onchange="window.mktCfgTier('${t}',this.value)"></div>`).join('')}
        <div class="field"><label for="mkt-c-floor">Engagement floor (%)</label><input id="mkt-c-floor" type="number" min="0" step="0.1" value="${Math.round(d.engagement_floor_override*10000)/100}" onchange="window.mktCfgFloor(this.value)"></div>
      </div>
      <div class="mkt-note">Below the floor a creator is Below threshold whatever the score.</div>
    </div>
    <div class="mkt-note">Saving recalculates every creator's score. Manual tiers stay as they are.</div>
    <div id="mkt-f-error" class="mkt-error" hidden></div>
    <div class="mkt-modal-actions">
      <button class="btn-outline" onclick="window.mktCfgReset()">Restore defaults</button>
      <button class="btn-outline" onclick="window.mktCloseModal()">Cancel</button>
      <button class="btn-primary" id="mkt-c-save" onclick="window.mktSaveScoring()">Save and recalculate</button>
    </div>`,true);
}

window.mktCfgSet=function(comp,i,k,val,pct){
  if(!_mktCfgDraft||!_mktCfgDraft[comp]||!_mktCfgDraft[comp][i])return;
  const s=String(val).trim();
  if(s===''){_mktCfgDraft[comp][i][k]=k==='max_followers'?null:NaN;return;}
  const n=Number(s);
  _mktCfgDraft[comp][i][k]=pct?Math.round(n*100)/10000:n;
};
window.mktCfgBand=function(comp,i){
  if(!_mktCfgDraft||!_mktCfgDraft[comp])return;
  if(i<0){
    const tmpl=comp==='reach_bands'?{max_followers:0,points:0}:comp==='engagement_bands'?{min_rate:0,points:0}:{min_ratio:0,points:0};
    _mktCfgDraft[comp].push(tmpl);
  }else _mktCfgDraft[comp].splice(i,1);
  _mktRenderScoring();
};
window.mktCfgTier=function(t,val){if(_mktCfgDraft)_mktCfgDraft.tier_thresholds[t]=val===''?NaN:Number(val);};
window.mktCfgFloor=function(val){if(_mktCfgDraft)_mktCfgDraft.engagement_floor_override=val===''?NaN:Math.round(Number(val)*100)/10000;};
window.mktCfgReset=function(){_mktCfgDraft=JSON.parse(JSON.stringify(MKT_DEFAULT_SCORING));_mktRenderScoring();};

/** Which creators a config change actually moves, and the fields to write. */
function mktRecalcAll(list,cfg,now){
  const out=[];
  (list||[]).forEach(c=>{
    const f=mktScoreFields(c,cfg,now);
    if(f.score!==(c.score==null?null:c.score)||f.tier!==(c.tier||null)||f.tier_formula!==(c.tier_formula||null)||f.engagement_rate!==(c.engagement_rate==null?null:c.engagement_rate))
      out.push({id:c.id,fields:f});
  });
  return out;
}

window.mktSaveScoring=async function(){
  if(_mktSaving||!_mktCfgDraft)return;
  const errs=mktValidateConfig(_mktCfgDraft);
  if(errs.length){_mktFormError(errs.join(' '));return;}
  const cfg=_mktConfig(_mktCfgDraft);
  const now=Date.now();
  const btn=document.getElementById('mkt-c-save');
  _mktSaving=true;if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const stored=Object.assign({},cfg,{updated_at:now,updated_by_user_id:session&&session.uid||null});
    await setDoc(doc(db,'scoring_config','current'),stored);
    mktScoringConfig=stored;
    _mktScoringMeta={updated_at:now,updated_by_user_id:stored.updated_by_user_id};
    const changes=mktRecalcAll(mktCreators,cfg,now);
    // Firestore caps a batch at 500 writes.
    for(let i=0;i<changes.length;i+=400){
      const b=writeBatch(db);
      changes.slice(i,i+400).forEach(ch=>b.update(doc(db,'creators',ch.id),ch.fields));
      await b.commit();
    }
    const byId=new Map(changes.map(ch=>[ch.id,ch.fields]));
    mktCreators=mktCreators.map(c=>byId.has(c.id)?Object.assign({},c,byId.get(c.id)):c);
    _mktCloseModal();
    showToast('Scoring saved — '+changes.length+' creator'+(changes.length===1?'':'s')+' recalculated.');
    if(typeof logActivity==='function')logActivity('Creator scoring updated',changes.length+' creators recalculated');
    _mktRerenderPage();
  }catch(e){
    console.error('[marketing] scoring save failed',e);
    _mktFormError('Could not save the scoring settings: '+((e&&e.message)||'unknown error')+'.');
  }finally{
    _mktSaving=false;
    if(btn){btn.disabled=false;btn.textContent='Save and recalculate';}
  }
};

// ════════════════════════════════════════════════════════════════════════
// M2 — Dispatch Log
// ════════════════════════════════════════════════════════════════════════
// Organic dispatches only in M2; a Paid PR dispatch is created by its
// approval in M3 and then runs through the same status flow. Every dispatch
// points at a creator by id (never a retyped handle) and at Shopify
// variants by id (never free text).

const MKT_DISPATCH_STATUSES=[
  {k:'confirmed',label:'Confirmed'},
  {k:'in_transit',label:'In transit'},
  {k:'shipped',label:'Shipped'},
  {k:'content_received',label:'Content received'}
];
const _MKT_DAY_MS=86400000;
// A catalog older than this is called out on the picker — the sync is
// scheduled daily (netlify.toml, 04:00 UTC), so anything past ~30h means a
// run was missed.
const _MKT_CATALOG_STALE_MS=30*3600000;

function _mktStatusIdx(k){return MKT_DISPATCH_STATUSES.findIndex(x=>x.k===k);}
function _mktDispStatusLabel(k){const x=MKT_DISPATCH_STATUSES.find(s=>s.k===k);return x?x.label:'—';}

/** A Firestore Timestamp, a millisecond number or an ISO string → ms, else null. */
function _mktMs(v){
  if(v==null||v==='')return null;
  if(typeof v==='number')return isFinite(v)?v:null;
  if(typeof v.toMillis==='function')return v.toMillis();
  if(typeof v.seconds==='number')return v.seconds*1000;
  const t=Date.parse(v);return isNaN(t)?null:t;
}
function _mktIsoDay(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';}
function _mktDayStr(ms){const d=new Date(ms);const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
function _mktDayLabel(iso){
  if(!iso)return'—';
  const [y,m,d]=iso.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

/** A Shopify variant as the dispatch stores it. */
function mktVariantFromDoc(id,d){
  const o=d||{};
  const vt=[o.color,o.size,o.option3].map(x=>String(x||'').trim()).filter(x=>x&&x.toLowerCase()!=='default title').join(' / ');
  return{
    variant_id:String(id),
    product_id:o.product_id==null?'':String(o.product_id),
    product_title:String(o.product_title||''),
    variant_title:vt,
    sku:String(o.sku||''),
    status:String(o.status||'')
  };
}

/** Catalog search: every word must match. Archived products are left out. */
function mktCatalogSearch(catalog,q,limit){
  const words=String(q||'').toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length)return[];
  const out=[];
  for(const v of catalog||[]){
    if(v.status==='archived')continue;
    const hay=(v.product_title+' '+v.variant_title+' '+v.sku).toLowerCase();
    if(words.every(w=>hay.indexOf(w)>=0)){out.push(v);if(out.length>=(limit||30))break;}
  }
  return out;
}

/**
 * Turn the dispatch form into what gets written.
 * @returns {{error:string}|{id,isNew,data,autoAdvanced}}
 */
function mktBuildDispatchPayload(form,existing,creators,now,uid){
  const f=form||{};
  const old=existing||null;
  const creatorId=old?old.creator_id:String(f.creator_id||'');
  const creator=(creators||[]).find(c=>c.id===creatorId);
  if(!creatorId)return{error:'Pick the creator this went to.'};
  if(!creator&&!old)return{error:'That creator is not in the database.'};
  if(!old&&(creator.status||'active')!=='active')
    return{error:'@'+creator.ig_handle+' is marked "'+_mktStatusLabel(creator.status)+'". Change their status first if this dispatch is intended.'};
  const date=_mktIsoDay(f.date_of_dispatch);
  if(!old&&!date)return{error:'Enter the dispatch date.'};
  if(f.date_of_dispatch&&!date)return{error:'That dispatch date is not a valid date.'};
  const seen=new Set();
  const products=(Array.isArray(f.products)?f.products:[]).filter(p=>p&&p.variant_id).map(p=>({
    product_id:String(p.product_id||''),variant_id:String(p.variant_id),
    product_title:_mktTrim(p.product_title,120),variant_title:_mktTrim(p.variant_title,120),
    sku:_mktTrim(p.sku,60)
  })).filter(p=>seen.has(p.variant_id)?false:(seen.add(p.variant_id),true));
  if(!products.length&&!(old&&old.products_note))return{error:'Add at least one product from the catalog.'};
  let status=MKT_DISPATCH_STATUSES.some(x=>x.k===f.status)?f.status:(old?old.status:'confirmed');
  const link=String(f.link_to_post||'').trim();
  if(link&&!/^https?:\/\/\S+$/i.test(link))return{error:'The post link must start with https://'};
  if(link.length>500)return{error:'That link is too long.'};
  // A posted link IS content received — recording one and leaving the
  // dispatch "shipped" would keep the no-post reminder firing.
  let autoAdvanced=false;
  if(link&&_mktStatusIdx(status)<_mktStatusIdx('content_received')){status='content_received';autoAdvanced=true;}
  const data={
    date_of_dispatch:date||(old?old.date_of_dispatch||'':''),
    collection_sent:_mktTrim(f.collection_sent,80),
    products,
    status,
    link_to_post:link,
    updated_at:now,
    updated_by_user_id:uid||null
  };
  if(status!==(old?old.status:null)){
    data.status_updated_at=now;
    // The FIRST time a stage is reached is what the SLA reminders and the
    // Day-7 capture count from; moving back and forward does not reset it.
    if(_mktStatusIdx(status)>=_mktStatusIdx('shipped')&&!(old&&old.shipped_at))data.shipped_at=now;
    if(status==='content_received'&&!(old&&old.content_received_at))data.content_received_at=now;
  }
  if(!old){
    Object.assign(data,{
      creator_id:creatorId,type:'organic',logged_by_user_id:uid||null,created_at:now,
      paid_pr_request_id:null,has_discount_code:false,discount_code_id:null,
      shipped_at:data.shipped_at||null,content_received_at:data.content_received_at||null,
      performance_captured_at:null,performance_views:null,performance_likes:null,
      performance_comments:null,performance_saves:null,performance_story_replies:null
    });
  }
  return{id:old?old.id:'dp_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),isNew:!old,data,autoAdvanced};
}

const _MKT_PERF_FIELDS=[
  ['performance_views','Views'],['performance_likes','Likes'],['performance_comments','Comments'],
  ['performance_saves','Saves'],['performance_story_replies','Story replies']
];
/** The Day-7 snapshot. Whole numbers; views are required, the rest may be blank. */
function mktBuildPerformance(form,now,uid){
  const out={};
  for(const [k,label] of _MKT_PERF_FIELDS){
    const raw=form?form[k]:null;
    const n=mktNum(raw);
    if(raw!==undefined&&raw!==null&&String(raw).trim()!==''&&n==null)return{error:label+': "'+String(raw).trim()+'" is not a number.'};
    out[k]=n;
  }
  if(out.performance_views==null)return{error:'Enter the views — the snapshot is not useful without them.'};
  out.performance_captured_at=now;
  out.performance_captured_by_user_id=uid||null;
  return{data:out};
}

/**
 * When the Day-7 snapshot is due. Only once there IS a post (a link, or
 * Content received). Counted from content received; a posted dispatch with
 * no content-received time falls back to shipped, and that fallback is
 * reported as such (spec §8: it is a data-quality signal in itself).
 */
function mktDay7(d,nowMs){
  if(!d)return{state:'none'};
  if(d.performance_captured_at)return{state:'captured'};
  // No post, nothing to measure: the no-post reminder covers that case.
  const posted=d.status==='content_received'||!!String(d.link_to_post||'').trim();
  if(!posted)return{state:'none'};
  const cr=_mktMs(d.content_received_at),sh=_mktMs(d.shipped_at);
  const anchor=cr!=null?cr:sh;
  if(anchor==null)return{state:'none'};
  const due=anchor+7*_MKT_DAY_MS;
  return{state:nowMs>=due?'due':'waiting',due,basis:cr!=null?'content_received':'shipped'};
}

/**
 * A creator's rollups, recomputed from every dispatch (and, when given,
 * every Paid PR request) held for them. Absolute, not incremental: an
 * edited dispatch date can move first/last in either direction, and an
 * increment cannot tell. The Paid PR fields are only returned when the
 * requests are passed in — a failed requests read must never zero them.
 * lifetime_pkr_spent is APPROVED spend (what was committed), not what has
 * been paid out; payment is tracked separately and by hand.
 * Discount-code rollups belong to M4 and are not touched.
 */
function mktCreatorRollups(creatorId,dispatches,requests){
  const mine=(dispatches||[]).filter(d=>d.creator_id===creatorId);
  const days=mine.map(d=>_mktIsoDay(d.date_of_dispatch)).filter(Boolean).sort();
  const delivered=mine.filter(d=>String(d.link_to_post||'').trim()).length;
  const out={
    lifetime_organic_dispatches:mine.filter(d=>(d.type||'organic')==='organic').length,
    lifetime_content_delivered:delivered,
    lifetime_fulfillment_rate:mine.length?Math.round(delivered/mine.length*1000)/1000:null,
    first_dispatch_date:days[0]||null,
    last_dispatch_date:days[days.length-1]||null
  };
  if(Array.isArray(requests)){
    const approved=requests.filter(r=>r.creator_id===creatorId&&r.status==='approved');
    out.lifetime_paid_prs=approved.length;
    out.lifetime_pkr_spent=approved.reduce((n,r)=>n+(Number(r.proposed_amount_pkr)||0),0);
  }
  return out;
}

function mktFilteredDispatches(list,creators,flt){
  const f=flt||{};
  const byId=new Map((creators||[]).map(c=>[c.id,c]));
  const q=String(f.q||'').trim().toLowerCase().replace(/^@/,'');
  const now=f.now||Date.now();
  return (list||[]).filter(d=>{
    if(f.status&&f.status!=='all'){
      if(f.status==='day7'){if(mktDay7(d,now).state!=='due')return false;}
      else if(f.status==='awaiting'){if(d.status!=='shipped'&&d.status!=='in_transit')return false;}
      else if(d.status!==f.status)return false;
    }
    if(f.month&&f.month!=='all'&&String(d.date_of_dispatch||'').slice(0,7)!==f.month)return false;
    if(f.since&&!(String(d.date_of_dispatch||'')>=f.since))return false;
    if(q){
      const c=byId.get(d.creator_id)||{};
      const hay=[c.name,c.ig_handle,d.collection_sent,d.products_note,(d.products||[]).map(p=>p.product_title+' '+p.variant_title).join(' ')].join(' ').toLowerCase();
      if(hay.indexOf(q)<0)return false;
    }
    return true;
  }).sort((a,b)=>{
    const da=a.date_of_dispatch||'',db2=b.date_of_dispatch||'';
    if(da!==db2){if(!da)return 1;if(!db2)return -1;return da<db2?1:-1;}
    return (_mktMs(b.created_at)||0)-(_mktMs(a.created_at)||0);
  });
}

// ── Catalog ─────────────────────────────────────────────────────────────
// Reuses Inventory Intel's copy when that page already loaded it; otherwise
// reads shopify_products once per visit. Either way it is what the daily
// catalog sync wrote — never a live Shopify call — and the picker says so.
function _mktLoadCatalog(){
  if(_mktCatalog)return Promise.resolve();
  if(_mktCatalogLoading)return _mktCatalogLoading;
  _mktCatalogErr=null;
  _mktCatalogLoading=(async()=>{
    try{
      if(typeof _siCollectionsLoaded!=='undefined'&&_siCollectionsLoaded&&typeof _siProducts!=='undefined'&&_siProducts.length){
        _mktCatalog=_siProducts.map(p=>mktVariantFromDoc(p._id,p));
      }else{
        const snap=await getDocs(collection(db,'shopify_products'));
        _mktCatalog=snap.docs.map(d=>mktVariantFromDoc(d.id,d.data()));
      }
      _mktCatalog.sort((a,b)=>(a.product_title+a.variant_title).localeCompare(b.product_title+b.variant_title));
    }catch(e){_mktCatalogErr=(e&&e.message)||'could not read the catalog';console.warn('[marketing] catalog load failed',e);}
    try{
      const m=await getDoc(doc(db,'shopify_sync_meta','catalog_sync'));
      const md=m&&typeof m.exists==='function'&&m.exists()?m.data():{};
      _mktCatalogMeta={syncedAt:_mktMs(md.last_success_at)};
    }catch(_){_mktCatalogMeta={syncedAt:null};}
    _mktCatalogLoading=null;
  })();
  return _mktCatalogLoading;
}

function _mktCatalogNoteHTML(){
  if(_mktCatalogErr)return`<div class="mkt-error">The product catalog could not be loaded (${_mktEsc(_mktCatalogErr)}). Products cannot be added until it loads — close and reopen to retry.</div>`;
  if(!_mktCatalog)return`<div class="mkt-note">Loading the product catalog…</div>`;
  const at=_mktCatalogMeta&&_mktCatalogMeta.syncedAt;
  if(!at)return`<div class="mkt-note">Catalog: ${_mktCatalog.length} variants. The time of the last sync is not recorded.</div>`;
  const stale=Date.now()-at>_MKT_CATALOG_STALE_MS;
  const when=new Date(at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  return`<div class="${stale?'mkt-warn':'mkt-note'}">Catalog as of ${_mktEsc(when)}. It is copied from Shopify once a day, so a product added since then is not here yet.${stale?' This copy is more than a day old — the daily sync may have missed a run.':''}</div>`;
}

// ── Dispatch Log page ───────────────────────────────────────────────────
function _mktCreatorById(id){return mktCreators.find(c=>c.id===id)||null;}

function _mktDispChip(d){
  const k=d.status||'';
  if(!k)return`<span class="mkt-dstatus mkt-dstatus-none">Not recorded</span>`;
  return`<span class="mkt-dstatus mkt-dstatus-${_mktEsc(k)}">${_mktDispStatusLabel(k)}</span>`;
}
function _mktDay7Chip(d,now){
  const r=mktDay7(d,now);
  if(r.state==='captured')return`<span class="mkt-d7 mkt-d7-done">Captured</span>`;
  if(r.state==='due')return`<span class="mkt-d7 mkt-d7-due" title="${r.basis==='shipped'?'Counted from shipping — no content-received date recorded':'Counted from content received'}">Due${r.basis==='shipped'?' *':''}</span>`;
  if(r.state==='waiting')return`<span class="mkt-d7 mkt-d7-wait">${_mktDayLabel(_mktDayStr(r.due))}</span>`;
  return'<span class="mkt-muted">—</span>';
}

function renderMarketingDispatches(){
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())
    return'<div class="empty">The Dispatch Log is limited to the owners and the Creator &amp; Content Operations Lead.</div>';
  if(!mktDispatchesLoaded){
    return`<div class="page-head"><div class="page-title">Dispatch Log</div></div>
      <div class="card"><div style="font-weight:600;margin-bottom:6px">The dispatch log could not be loaded.</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.5">The database refused the read (${_mktEsc((_mktLoadErr||[]).join(', ')||'unknown')}). The Firestore rules in the Firebase Console probably have not been republished since this page shipped.</div>
      <button class="btn-outline" style="margin-top:12px" onclick="window.mktRetryLoad()">Retry</button></div>`;
  }
  const months=Array.from(new Set(mktDispatches.map(d=>String(d.date_of_dispatch||'').slice(0,7)).filter(Boolean))).sort().reverse();
  const monthLabel=m=>{const [y,mo]=m.split('-').map(Number);return new Date(y,mo-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});};
  const f=_mktDispFilter;
  return`<div class="page-head mkt-head">
      <div><div class="page-title">Dispatch Log</div>
      <div class="page-sub">The Sales Team ▸ Marketing</div></div>
      <div class="mkt-actions">
        <button class="btn-outline mkt-primary" onclick="window.mktOpenDispatch('')">+ Log dispatch</button>
      </div>
    </div>
    <div id="mkt-dstats">${_mktDispStatsHTML()}</div>
    <div class="mkt-filters">
      <input id="mkt-dsearch" class="mkt-search" type="search" placeholder="Search creator, collection, product" value="${_mktEsc(f.q)}" oninput="window.mktDispSearch(this.value)" aria-label="Search dispatches">
      <select id="mkt-df-status" class="mkt-select" onchange="window.mktDispFilter('status',this.value)" aria-label="Status">
        <option value="all"${f.status==='all'?' selected':''}>Any status</option>
        ${MKT_DISPATCH_STATUSES.map(x=>`<option value="${x.k}"${f.status===x.k?' selected':''}>${x.label}</option>`).join('')}
        <option value="awaiting"${f.status==='awaiting'?' selected':''}>Awaiting content</option>
        <option value="day7"${f.status==='day7'?' selected':''}>Day-7 capture due</option>
      </select>
      <select id="mkt-df-month" class="mkt-select" onchange="window.mktDispFilter('month',this.value)" aria-label="Month">
        <option value="all"${f.month==='all'?' selected':''}>All months</option>
        ${f.since?`<option value="week" selected>Last 7 days</option>`:''}
        ${months.map(m=>`<option value="${m}"${f.month===m?' selected':''}>${monthLabel(m)}</option>`).join('')}
      </select>
    </div>
    <div id="mkt-dlist">${_mktDispListHTML()}</div>
    <div style="height:80px"></div>`;
}

function _mktWeekStart(now){return _mktDayStr(now-6*_MKT_DAY_MS);}

function _mktDispStatsHTML(){
  const now=Date.now();
  const since=_mktWeekStart(now);
  const thisWeek=mktDispatches.filter(d=>(d.date_of_dispatch||'')>=since).length;
  const out=mktDispatches.filter(d=>d.status==='shipped'||d.status==='in_transit').length;
  const due=mktDispatches.filter(d=>mktDay7(d,now).state==='due').length;
  const recv=mktDispatches.filter(d=>d.status==='content_received').length;
  const tile=(label,val,sub,onclick)=>`<button class="mkt-stat" onclick="${onclick}"><span class="mkt-stat-label">${label}</span><span class="mkt-stat-val">${val}</span><span class="mkt-stat-sub">${sub}</span></button>`;
  return`<div class="mkt-stats">
    ${tile('Dispatched this week',thisWeek,'last 7 days, today included',"window.mktDispFilter('month','week')")}
    ${tile('Awaiting content',out,'in transit or shipped',"window.mktDispFilter('status','awaiting')")}
    ${tile('Day-7 capture due',due,'snapshot not entered',"window.mktDispFilter('status','day7')")}
    ${tile('Content received',recv,`of ${mktDispatches.length} dispatches`,"window.mktDispFilter('status','content_received')")}
  </div>`;
}

function _mktDispListHTML(){
  if(!mktDispatches.length)return`<div class="card empty">No dispatches logged yet.</div>`;
  const now=Date.now();
  const rows=mktFilteredDispatches(mktDispatches,mktCreators,Object.assign({},_mktDispFilter,{now}));
  if(!rows.length)return`<div class="card empty">No dispatches match these filters.</div>`;
  const pages=Math.max(1,Math.ceil(rows.length/_MKT_PAGE_SIZE));
  if(_mktDispFilter.page>pages)_mktDispFilter.page=pages;
  const slice=rows.slice((_mktDispFilter.page-1)*_MKT_PAGE_SIZE,_mktDispFilter.page*_MKT_PAGE_SIZE);
  const body=slice.map(d=>{
    const c=_mktCreatorById(d.creator_id);
    const prods=d.products||[];
    const prodTxt=prods.length?prods.slice(0,2).map(p=>p.product_title+(p.variant_title?' — '+p.variant_title:'')).join(', ')+(prods.length>2?` +${prods.length-2} more`:''):(d.products_note||'—');
    return`<tr class="mkt-row" data-id="${_mktEsc(d.id)}" onclick="window.mktOpenDispatch(this.dataset.id)" tabindex="0" onkeydown="if(event.key==='Enter')window.mktOpenDispatch(this.dataset.id)">
      <td class="mkt-c-date">${_mktDayLabel(d.date_of_dispatch)}</td>
      <td class="mkt-c-who"><div class="mkt-name">${_mktEsc(c?(c.name||'@'+c.ig_handle):'Unknown creator')}</div><div class="mkt-handle">${c?'@'+_mktEsc(c.ig_handle):''}${d.type==='paid_pr'?' · Paid PR':''}</div></td>
      <td data-label="Collection">${_mktEsc(d.collection_sent||'—')}</td>
      <td class="mkt-c-prod">${_mktEsc(prodTxt)}</td>
      <td class="mkt-c-tier">${_mktDispChip(d)}</td>
      <td data-label="Post">${d.link_to_post?`<a href="${_mktEsc(d.link_to_post)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">View post</a>`:'<span class="mkt-muted">—</span>'}</td>
      <td data-label="Day 7">${_mktDay7Chip(d,now)}</td>
    </tr>`;
  }).join('');
  const pager=pages>1?`<div class="mkt-pager">
      <button class="btn-outline" ${_mktDispFilter.page<=1?'disabled':''} onclick="window.mktDispPage(-1)">Previous</button>
      <span>Page ${_mktDispFilter.page} of ${pages}</span>
      <button class="btn-outline" ${_mktDispFilter.page>=pages?'disabled':''} onclick="window.mktDispPage(1)">Next</button>
    </div>`:'';
  return`<div class="card mkt-card">
    <div class="mkt-count">${rows.length} of ${mktDispatches.length} dispatches · Day-7 "Due *" is counted from shipping because no content-received date was recorded</div>
    <div class="mkt-tablewrap"><table class="mkt-table">
      <thead><tr><th>Date</th><th>Creator</th><th>Collection</th><th>Products</th><th>Status</th><th>Post</th><th>Day 7</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    ${pager}
  </div>`;
}

function _mktDispRepaint(){
  const l=document.getElementById('mkt-dlist');if(l)l.innerHTML=_mktDispListHTML();
  const s=document.getElementById('mkt-dstats');if(s)s.innerHTML=_mktDispStatsHTML();
}
window.mktDispSearch=function(v){
  clearTimeout(_mktDispSearchTimer);
  _mktDispSearchTimer=setTimeout(()=>{_mktDispFilter.q=String(v||'');_mktDispFilter.page=1;_mktDispRepaint();},180);
};
window.mktDispFilter=function(key,val){
  if(key==='reset')_mktDispFilter={q:'',status:'all',month:'all',since:'',page:1};
  else if(key==='status'){_mktDispFilter.status=val;_mktDispFilter.page=1;}
  else if(key==='month'){
    // "Last 7 days" is a rolling window, not a calendar month.
    if(val==='week'){_mktDispFilter.month='all';_mktDispFilter.since=_mktWeekStart(Date.now());}
    else{_mktDispFilter.month=val;_mktDispFilter.since='';}
    _mktDispFilter.page=1;
  }
  else return;
  _mktRerenderPage();
};
window.mktDispPage=function(d){_mktDispFilter.page=Math.max(1,_mktDispFilter.page+d);_mktDispRepaint();};

// ── The creator's own history, inside the creator form ──────────────────
function _mktCreatorDispatchesHTML(c){
  if(!c||!mktDispatchesLoaded)return'';
  const mine=mktFilteredDispatches(mktDispatches.filter(d=>d.creator_id===c.id),mktCreators,{});
  const add=`<button class="btn-outline" data-id="${_mktEsc(c.id)}" onclick="window.mktOpenDispatch('',this.dataset.id)">Log a dispatch to them</button> <button class="btn-outline" data-id="${_mktEsc(c.id)}" onclick="window.mktOpenPaidPR('',this.dataset.id)">Request a Paid PR</button>`;
  if(!mine.length)return`<div class="mkt-section"><div class="mkt-section-title">Dispatches</div><div class="mkt-note" style="margin-bottom:8px">Nothing sent to this creator yet.</div>${(c.status||'active')==='active'?add:''}</div>`;
  return`<div class="mkt-section"><div class="mkt-section-title">Dispatches (${mine.length})</div>
    <div class="mkt-hist">${mine.slice(0,8).map(d=>`<button class="mkt-hist-row" data-id="${_mktEsc(d.id)}" onclick="window.mktOpenDispatch(this.dataset.id)">
      <span>${_mktDayLabel(d.date_of_dispatch)}</span><span>${_mktEsc(d.collection_sent||'—')}</span>${_mktDispChip(d)}</button>`).join('')}</div>
    ${mine.length>8?`<div class="mkt-note">Showing the latest 8 — search the Dispatch Log for the rest.</div>`:''}
    ${(c.status||'active')==='active'?`<div style="margin-top:8px">${add}</div>`:''}
  </div>`;
}

// ── Log / edit a dispatch ───────────────────────────────────────────────
window.mktOpenDispatch=function(id,creatorId){
  const d=id?mktDispatches.find(x=>x.id===id):null;
  if(id&&!d){showToast('That dispatch is no longer in the list — refresh the page.',true);return;}
  _mktDraft={creatorId:d?d.creator_id:(creatorId||''),products:d?JSON.parse(JSON.stringify(d.products||[])):[]};
  const collections=Array.from(new Set(mktDispatches.map(x=>x.collection_sent).filter(Boolean))).sort();
  const perf=d&&d.performance_captured_at;
  const d7=d?mktDay7(d,Date.now()):{state:'none'};
  const stamps=d?[d.shipped_at?'Shipped '+_mktWhen(_mktMs(d.shipped_at)):'',d.content_received_at?'content received '+_mktWhen(_mktMs(d.content_received_at)):''].filter(Boolean).join(' · '):'';
  _mktOpenModal(`
    <h3>${d?'Dispatch':'Log a dispatch'}</h3>
    <div class="sub">${d?`${d.type==='paid_pr'?'Paid PR':'Organic'} · logged by ${_mktEsc(_mktUserName(d.logged_by_user_id))} · ${_mktWhen(_mktMs(d.created_at))}`:'Organic dispatch — no approval needed.'}</div>
    <input type="hidden" id="mkt-d-id" value="${d?_mktEsc(d.id):''}">
    <div class="mkt-section">
      <div class="mkt-section-title">Creator</div>
      <div id="mkt-d-creator">${_mktDraftCreatorHTML(!!d)}</div>
    </div>
    <div class="mkt-section">
      <div class="mkt-section-title">Shipment</div>
      <div class="form-grid">
        <div class="field"><label for="mkt-d-date">Dispatch date *</label><input id="mkt-d-date" type="date" value="${_mktEsc(d?d.date_of_dispatch||'':_mktDayStr(Date.now()))}"></div>
        <div class="field"><label for="mkt-d-coll">Collection sent</label><input id="mkt-d-coll" list="mkt-d-coll-list" value="${_mktEsc(d?d.collection_sent||'':'')}" autocomplete="off" placeholder="e.g. Lowkey Heat">
          <datalist id="mkt-d-coll-list">${collections.map(x=>`<option value="${_mktEsc(x)}"></option>`).join('')}</datalist></div>
        <div class="field"><label for="mkt-d-status">Status</label><select id="mkt-d-status">${d&&!d.status?'<option value="" selected>Not recorded (from the sheet)</option>':''}${MKT_DISPATCH_STATUSES.map(x=>`<option value="${x.k}"${(d?d.status:'confirmed')===x.k?' selected':''}>${x.label}</option>`).join('')}</select></div>
        <div class="field"><label for="mkt-d-link">Link to post</label><input id="mkt-d-link" value="${_mktEsc(d?d.link_to_post||'':'')}" placeholder="https://www.instagram.com/p/…" autocomplete="off" inputmode="url"></div>
      </div>
      <div class="mkt-note">${stamps?_mktEsc(stamps)+'. ':''}Adding a post link marks the dispatch Content received.</div>
    </div>
    <div class="mkt-section">
      <div class="mkt-section-title">Products</div>
      <div id="mkt-d-cat">${_mktCatalogNoteHTML()}</div>
      <input id="mkt-d-psearch" class="mkt-search mkt-wide" type="search" placeholder="Type a product name, colour or SKU" autocomplete="off" oninput="window.mktPickSearch(this.value)" aria-label="Search products">
      <div id="mkt-d-presults" class="mkt-picks"></div>
      <div id="mkt-d-products">${_mktDraftProductsHTML(d)}</div>
    </div>
    ${d?_mktCodeSectionHTML(d):''}
    ${d?`<div class="mkt-section">
      <div class="mkt-section-title">Day-7 performance</div>
      ${perf?`<div class="mkt-perf">${_MKT_PERF_FIELDS.map(([k,l])=>`<div><span>${l}</span><b>${d[k]==null?'—':Number(d[k]).toLocaleString('en-US')}</b></div>`).join('')}</div>
        <div class="mkt-note">Captured by ${_mktEsc(_mktUserName(d.performance_captured_by_user_id))} · ${_mktWhen(_mktMs(d.performance_captured_at))}</div>`
      :`<div class="mkt-note">${d7.state==='due'?'Due now'+(d7.basis==='shipped'?' — counted from shipping, because no content-received date was recorded.':'.'):d7.state==='waiting'?'Due '+_mktDayLabel(_mktDayStr(d7.due))+'.':'Due 7 days after the content is received.'}</div>`}
      <button class="btn-outline" style="margin-top:8px" data-id="${_mktEsc(d.id)}" onclick="window.mktOpenPerformance(this.dataset.id)">${perf?'Correct the snapshot':'Capture Day-7 performance'}</button>
    </div>`:''}
    <div id="mkt-f-error" class="mkt-error" hidden></div>
    <div class="mkt-modal-actions">
      <button class="btn-outline" onclick="window.mktCloseModal()">Cancel</button>
      <button class="btn-primary" id="mkt-d-save" onclick="window.mktSaveDispatch()">${d?'Save changes':'Log dispatch'}</button>
    </div>`,true);
  _mktLoadCatalog().then(()=>{const n=document.getElementById('mkt-d-cat');if(n)n.innerHTML=_mktCatalogNoteHTML();});
  if(!d&&!_mktDraft.creatorId)document.getElementById('mkt-d-csearch')?.focus();
};

function _mktDraftCreatorHTML(locked){
  const c=_mktDraft&&_mktDraft.creatorId?_mktCreatorById(_mktDraft.creatorId):null;
  if(c){
    const sizes=[c.top_size,c.bottom_size].filter(Boolean).join(' / ');
    return`<div class="mkt-pick-chosen"><div><div class="mkt-name">${_mktEsc(c.name||'@'+c.ig_handle)}</div>
      <div class="mkt-handle">@${_mktEsc(c.ig_handle)}${c.city?' · '+_mktEsc(c.city):''}${sizes?' · sizes '+_mktEsc(sizes):''}</div>
      ${c.address||c.phone?`<div class="mkt-note" style="margin-top:2px">${_mktEsc([c.address,c.phone].filter(Boolean).join(' · '))}</div>`:''}</div>
      ${locked?'<span class="mkt-note">A dispatch stays with its creator.</span>':'<button class="btn-outline" onclick="window.mktPickCreator(\'\')">Change</button>'}</div>`;
  }
  if(locked)return`<div class="mkt-note">This dispatch's creator is no longer in the database.</div>`;
  return`<input id="mkt-d-csearch" class="mkt-search mkt-wide" type="search" placeholder="Search name or @handle" autocomplete="off" oninput="window.mktPickCreatorSearch(this.value)" aria-label="Search creators">
    <div id="mkt-d-cresults" class="mkt-picks"></div>`;
}
window.mktPickCreatorSearch=function(v){
  const box=document.getElementById('mkt-d-cresults');if(!box)return;
  const q=String(v||'').trim().toLowerCase().replace(/^@/,'');
  if(!q){box.innerHTML='';return;}
  const hits=mktCreators.filter(c=>((c.name||'')+' '+c.ig_handle).toLowerCase().indexOf(q)>=0).slice(0,8);
  box.innerHTML=hits.length?hits.map(c=>`<button class="mkt-pick" data-id="${_mktEsc(c.id)}" onclick="window.mktPickCreator(this.dataset.id)">
      <span><b>${_mktEsc(c.name||'@'+c.ig_handle)}</b> <span class="mkt-muted">@${_mktEsc(c.ig_handle)}</span></span>
      <span>${(c.status||'active')!=='active'?`<span class="mkt-status mkt-status-${_mktEsc(c.status)}">${_mktStatusLabel(c.status)}</span>`:_mktTierChip(c)}</span></button>`).join('')
    :`<div class="mkt-note">No creator matches. Add them in the Creator Database first.</div>`;
};
window.mktPickCreator=function(id){
  if(!_mktDraft)return;
  _mktDraft.creatorId=id||'';
  const box=document.getElementById('mkt-d-creator');
  if(box)box.innerHTML=_mktDraftCreatorHTML(false);
  if(!id)document.getElementById('mkt-d-csearch')?.focus();
};

function _mktDraftProductsHTML(d){
  const list=_mktDraft?_mktDraft.products:[];
  const legacy=d&&d.products_note?`<div class="mkt-note">From the old sheet: ${_mktEsc(d.products_note)}</div>`:'';
  if(!list.length)return legacy+`<div class="mkt-note">No products added yet.</div>`;
  return legacy+`<div class="mkt-chosen">${list.map((p,i)=>`<div class="mkt-chosen-row"><span><b>${_mktEsc(p.product_title)}</b>${p.variant_title?` <span class="mkt-muted">${_mktEsc(p.variant_title)}</span>`:''}</span>
    <button class="mkt-band-x" aria-label="Remove ${_mktEsc(p.product_title)}" onclick="window.mktRemoveProduct(${i})">×</button></div>`).join('')}</div>`;
}
function _mktRepaintDraftProducts(){
  const id=_mktVal('mkt-d-id');
  const box=document.getElementById('mkt-d-products');
  if(box)box.innerHTML=_mktDraftProductsHTML(id?mktDispatches.find(x=>x.id===id):null);
  const inp=document.getElementById('mkt-d-psearch');
  if(inp&&inp.value)window.mktPickSearch(inp.value,true);
}
window.mktPickSearch=function(v,now){
  clearTimeout(_mktPickTimer);
  const run=()=>{
    const box=document.getElementById('mkt-d-presults');if(!box)return;
    const q=String(v||'').trim();
    if(!q){box.innerHTML='';return;}
    if(!_mktCatalog){box.innerHTML='<div class="mkt-note">The catalog is still loading…</div>';return;}
    const hits=mktCatalogSearch(_mktCatalog,q,30);
    const chosen=new Set((_mktDraft?_mktDraft.products:[]).map(p=>p.variant_id));
    box.innerHTML=hits.length?hits.map(p=>`<button class="mkt-pick" data-vid="${_mktEsc(p.variant_id)}" ${chosen.has(p.variant_id)?'disabled':''} onclick="window.mktAddProduct(this.dataset.vid)">
        <span><b>${_mktEsc(p.product_title)}</b>${p.variant_title?` <span class="mkt-muted">${_mktEsc(p.variant_title)}</span>`:''}</span>
        <span class="mkt-muted">${chosen.has(p.variant_id)?'added':_mktEsc(p.sku||'')}${p.status==='draft'?' · draft':''}</span></button>`).join('')
      :'<div class="mkt-note">Nothing in the catalog matches. A product created in Shopify today appears after the next daily sync.</div>';
  };
  if(now)run();else _mktPickTimer=setTimeout(run,120);
};
window.mktAddProduct=function(vid){
  if(!_mktDraft||!_mktCatalog)return;
  const v=_mktCatalog.find(x=>x.variant_id===vid);
  if(!v||_mktDraft.products.some(p=>p.variant_id===vid))return;
  _mktDraft.products.push({product_id:v.product_id,variant_id:v.variant_id,product_title:v.product_title,variant_title:v.variant_title,sku:v.sku});
  _mktRepaintDraftProducts();
};
window.mktRemoveProduct=function(i){
  if(!_mktDraft)return;
  _mktDraft.products.splice(i,1);
  _mktRepaintDraftProducts();
};

/**
 * One batch: the dispatch, and the creator's recomputed rollups. A batch
 * rather than a transaction on purpose — it queues offline like every
 * other write in the app, and nothing here needs a read-before-write.
 */
async function mktWriteDispatch(built,rollups,creatorId){
  const b=writeBatch(db);
  const ref=doc(db,'dispatches',built.id);
  if(built.isNew)b.set(ref,built.data);else b.update(ref,built.data);
  if(creatorId&&rollups)b.update(doc(db,'creators',creatorId),rollups);
  await b.commit();
}

window.mktSaveDispatch=async function(){
  if(_mktSaving||!_mktDraft)return;
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing()){_mktFormError('Your account cannot log dispatches.');return;}
  const id=_mktVal('mkt-d-id');
  const existing=id?mktDispatches.find(x=>x.id===id):null;
  const now=Date.now();
  const built=mktBuildDispatchPayload({
    creator_id:_mktDraft.creatorId,date_of_dispatch:_mktVal('mkt-d-date'),
    collection_sent:_mktVal('mkt-d-coll'),status:_mktVal('mkt-d-status'),
    link_to_post:_mktVal('mkt-d-link'),products:_mktDraft.products
  },existing,mktCreators,now,session&&session.uid);
  if(built.error){_mktFormError(built.error);return;}
  const creatorId=existing?existing.creator_id:built.data.creator_id;
  const merged=Object.assign({},existing||{},built.data,{id:built.id});
  const nextList=existing?mktDispatches.map(x=>x.id===built.id?merged:x):mktDispatches.concat([merged]);
  const rollups=_mktCreatorById(creatorId)?mktCreatorRollups(creatorId,nextList,mktPaidPRsLoaded?mktPaidPRs:null):null;
  const btn=document.getElementById('mkt-d-save');
  _mktSaving=true;if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await mktWriteDispatch(built,rollups,creatorId);
    mktDispatches=nextList;
    if(rollups)mktCreators=mktCreators.map(c=>c.id===creatorId?Object.assign({},c,rollups):c);
    _mktDraft=null;
    _mktCloseModal();
    const c=_mktCreatorById(creatorId);
    showToast((existing?'Dispatch updated':'Dispatch logged')+(c?' for @'+c.ig_handle:'')+(built.autoAdvanced?' — marked Content received because a post link was added':''));
    if(typeof logActivity==='function')logActivity(existing?'Dispatch updated':'Dispatch logged',(c?'@'+c.ig_handle+' · ':'')+_mktDispStatusLabel(built.data.status));
    _mktRerenderPage();
  }catch(e){
    console.error('[marketing] dispatch save failed',e);
    _mktFormError('Could not save: '+((e&&e.message)||'unknown error')+'. Nothing was changed.');
  }finally{
    _mktSaving=false;
    if(btn){btn.disabled=false;btn.textContent=existing?'Save changes':'Log dispatch';}
  }
};

// ── Day-7 capture: one screen, every field, one save ────────────────────
window.mktOpenPerformance=function(id){
  const d=mktDispatches.find(x=>x.id===id);
  if(!d)return;
  const c=_mktCreatorById(d.creator_id);
  _mktOpenModal(`
    <h3>Day-7 performance</h3>
    <div class="sub">${c?'@'+_mktEsc(c.ig_handle)+' · ':''}${_mktEsc(d.collection_sent||'Dispatch')} · ${_mktDayLabel(d.date_of_dispatch)}${d.link_to_post?` · <a href="${_mktEsc(d.link_to_post)}" target="_blank" rel="noopener noreferrer">open the post</a>`:''}</div>
    <input type="hidden" id="mkt-p-id" value="${_mktEsc(d.id)}">
    <div class="form-grid mkt-grid-5">
      ${_MKT_PERF_FIELDS.map(([k,l],i)=>`<div class="field"><label for="mkt-p-${i}">${l}${k==='performance_views'?' *':''}</label><input id="mkt-p-${i}" inputmode="numeric" value="${d[k]==null?'':_mktEsc(d[k])}" autocomplete="off" onkeydown="if(event.key==='Enter')window.mktSavePerformance()"></div>`).join('')}
    </div>
    <div class="mkt-note">Read these off the post itself. 12,500 and 12.5k both work.</div>
    <div id="mkt-f-error" class="mkt-error" hidden></div>
    <div class="mkt-modal-actions">
      <button class="btn-outline" data-id="${_mktEsc(d.id)}" onclick="window.mktOpenDispatch(this.dataset.id)">Back</button>
      <button class="btn-primary" id="mkt-p-save" onclick="window.mktSavePerformance()">Save snapshot</button>
    </div>`);
  document.getElementById('mkt-p-0')?.focus();
};
window.mktSavePerformance=async function(){
  if(_mktSaving)return;
  const id=_mktVal('mkt-p-id');
  const d=mktDispatches.find(x=>x.id===id);
  if(!d)return;
  const form={};
  _MKT_PERF_FIELDS.forEach(([k],i)=>{form[k]=_mktVal('mkt-p-'+i);});
  const built=mktBuildPerformance(form,Date.now(),session&&session.uid);
  if(built.error){_mktFormError(built.error);return;}
  const btn=document.getElementById('mkt-p-save');
  _mktSaving=true;if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'dispatches',id),built.data);
    mktDispatches=mktDispatches.map(x=>x.id===id?Object.assign({},x,built.data):x);
    _mktCloseModal();
    showToast('Day-7 snapshot saved');
    if(typeof logActivity==='function'){const c=_mktCreatorById(d.creator_id);logActivity('Dispatch performance captured',(c?'@'+c.ig_handle+' · ':'')+built.data.performance_views+' views');}
    _mktRerenderPage();
  }catch(e){
    console.error('[marketing] performance save failed',e);
    _mktFormError('Could not save: '+((e&&e.message)||'unknown error')+'.');
  }finally{
    _mktSaving=false;
    if(btn){btn.disabled=false;btn.textContent='Save snapshot';}
  }
};

// ════════════════════════════════════════════════════════════════════════
// M3 — Paid PR approvals
// ════════════════════════════════════════════════════════════════════════
// A Paid PR is a REQUEST first and a dispatch only once approved. Anyone
// with Marketing access can submit one; only an account carrying
// canApprovePaidPR can decide it — and firestore.rules enforces that on its
// own (isPaidPRApprover), so hiding the buttons is courtesy, not the gate.
// Approval writes three things in one batch: the decision, the linked
// paid_pr dispatch, and the creator's recomputed rollups. The discount code
// the spec attaches to an approval arrives with M4.

const MKT_PR_STATUSES=[
  {k:'pending',label:'Pending'},
  {k:'approved',label:'Approved'},
  {k:'rejected',label:'Rejected'}
];
const MKT_PAY_METHODS=['Bank transfer','JazzCash','Easypaisa','Cash','Other'];
// The only fields a payment log may touch — mirrored by the affectedKeys()
// list in firestore.rules, and asserted equal in tests/marketing.test.js.
const MKT_PAYMENT_FIELDS=['payment_status','payment_method','payment_reference','payment_date','payment_logged_by_user_id','payment_logged_at','updated_at'];
// And the only fields a still-pending request may have edited.
const MKT_PR_EDIT_FIELDS=['deliverable','proposed_amount_pkr','timeline','rationale','updated_at','updated_by_user_id'];

function _mktPKR(n){return n==null||!isFinite(n)?'—':'PKR '+Math.round(n).toLocaleString('en-US');}
function _mktPrStatusLabel(k){const x=MKT_PR_STATUSES.find(s=>s.k===k);return x?x.label:'—';}

/** A new or edited request. @returns {{error}|{id,isNew,data}} */
function mktBuildPaidPRRequest(form,existing,creators,now,uid){
  const f=form||{};
  const old=existing||null;
  if(old&&old.status!=='pending')return{error:'A request that has been decided can no longer be edited.'};
  const creatorId=old?old.creator_id:String(f.creator_id||'');
  const creator=(creators||[]).find(c=>c.id===creatorId);
  if(!creatorId)return{error:'Pick the creator this request is for.'};
  if(!old&&!creator)return{error:'That creator is not in the database.'};
  if(!old&&(creator.status||'active')!=='active')
    return{error:'@'+creator.ig_handle+' is marked "'+_mktStatusLabel(creator.status)+'" — a Paid PR cannot be requested for them.'};
  const deliverable=_mktTrim(f.deliverable,200);
  if(!deliverable)return{error:'Describe the deliverable — e.g. "1 Reel + 3 story frames".'};
  const amount=mktNum(f.proposed_amount_pkr);
  if(amount==null||amount<=0)return{error:'Enter the proposed amount in PKR.'};
  if(amount>10000000)return{error:'That amount looks wrong — check the number of zeros.'};
  const data={
    deliverable,
    proposed_amount_pkr:amount,
    timeline:_mktTrim(f.timeline,120),
    rationale:_mktTrim(f.rationale,1000),
    updated_at:now,
    updated_by_user_id:uid||null
  };
  if(!old){
    Object.assign(data,{
      creator_id:creatorId,requested_by_user_id:uid||null,created_at:now,
      status:'pending',decided_by_user_id:null,decided_at:null,rejection_reason:'',
      dispatch_id:null,payment_status:'unpaid',payment_method:'',payment_reference:'',payment_date:''
    });
  }
  return{id:old?old.id:'pr_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),isNew:!old,data};
}

/** The decision. Approval mints the linked dispatch's id; rejection needs a reason. */
function mktBuildDecision(req,decision,reason,now,uid){
  if(!req)return{error:'That request is no longer in the list.'};
  if(req.status!=='pending')return{error:'This request was already '+_mktPrStatusLabel(req.status).toLowerCase()+'.'};
  if(decision==='rejected'){
    const r=_mktTrim(reason,500);
    if(!r)return{error:'Say why it is being rejected — the requester sees this.'};
    return{data:{status:'rejected',decided_by_user_id:uid||null,decided_at:now,rejection_reason:r,updated_at:now}};
  }
  if(decision!=='approved')return{error:'Unknown decision.'};
  const dispatchId='dp_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
  return{
    data:{status:'approved',decided_by_user_id:uid||null,decided_at:now,rejection_reason:'',dispatch_id:dispatchId,updated_at:now},
    dispatch:{id:dispatchId,data:{
      creator_id:req.creator_id,type:'paid_pr',paid_pr_request_id:req.id,
      date_of_dispatch:'',collection_sent:'',products:[],status:'confirmed',link_to_post:'',
      logged_by_user_id:uid||null,created_at:now,updated_at:now,updated_by_user_id:uid||null,
      status_updated_at:now,shipped_at:null,content_received_at:null,
      has_discount_code:false,discount_code_id:null,
      performance_captured_at:null,performance_views:null,performance_likes:null,
      performance_comments:null,performance_saves:null,performance_story_replies:null
    }}
  };
}

/** A payment against an approved request. Touches payment fields only. */
function mktBuildPayment(req,form,now,uid){
  if(!req||req.status!=='approved')return{error:'Only an approved request can be paid.'};
  const f=form||{};
  const status=f.payment_status==='paid'?'paid':'unpaid';
  const data={payment_status:status,payment_logged_by_user_id:uid||null,payment_logged_at:now,updated_at:now};
  if(status==='paid'){
    const method=MKT_PAY_METHODS.indexOf(f.payment_method)>=0?f.payment_method:'';
    if(!method)return{error:'Pick how it was paid.'};
    const date=_mktIsoDay(f.payment_date);
    if(!date)return{error:'Enter the payment date.'};
    data.payment_method=method;
    data.payment_reference=_mktTrim(f.payment_reference,120);
    data.payment_date=date;
  }else{
    data.payment_method='';data.payment_reference='';data.payment_date='';
  }
  return{data};
}

/** Requests as the page lists them: pending first (oldest waiting longest), then newest decisions. */
function mktFilteredPaidPRs(list,creators,flt){
  const f=flt||{};
  const byId=new Map((creators||[]).map(c=>[c.id,c]));
  const q=String(f.q||'').trim().toLowerCase().replace(/^@/,'');
  return (list||[]).filter(r=>{
    if(f.status&&f.status!=='all'){
      if(f.status==='unpaid'){if(!(r.status==='approved'&&r.payment_status!=='paid'))return false;}
      else if(r.status!==f.status)return false;
    }
    if(q){
      const c=byId.get(r.creator_id)||{};
      if([c.name,c.ig_handle,r.deliverable,r.rationale].join(' ').toLowerCase().indexOf(q)<0)return false;
    }
    return true;
  }).sort((a,b)=>{
    const pa=a.status==='pending'?0:1,pb=b.status==='pending'?0:1;
    if(pa!==pb)return pa-pb;
    if(pa===0)return (_mktMs(a.created_at)||0)-(_mktMs(b.created_at)||0);
    return (_mktMs(b.decided_at)||0)-(_mktMs(a.decided_at)||0);
  });
}

/** Approved spend for the calendar month a timestamp falls in. */
function mktApprovedInMonth(list,nowMs){
  const d=new Date(nowMs);
  return (list||[]).filter(r=>{
    if(r.status!=='approved')return false;
    const t=_mktMs(r.decided_at);if(t==null)return false;
    const x=new Date(t);return x.getFullYear()===d.getFullYear()&&x.getMonth()===d.getMonth();
  }).reduce((n,r)=>n+(Number(r.proposed_amount_pkr)||0),0);
}

// ── Page ────────────────────────────────────────────────────────────────
function _mktPrChip(r){
  return`<span class="mkt-prstatus mkt-prstatus-${_mktEsc(r.status||'pending')}">${_mktPrStatusLabel(r.status||'pending')}</span>`;
}
function _mktPayChip(r){
  if(r.status!=='approved')return'<span class="mkt-muted">—</span>';
  return r.payment_status==='paid'?`<span class="mkt-pay mkt-pay-paid">Paid</span>`:`<span class="mkt-pay mkt-pay-unpaid">Unpaid</span>`;
}

function renderMarketingPaidPR(){
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())
    return'<div class="empty">Paid PR Approvals are limited to the owners and the Creator &amp; Content Operations Lead.</div>';
  if(!mktPaidPRsLoaded){
    return`<div class="page-head"><div class="page-title">Paid PR Approvals</div></div>
      <div class="card"><div style="font-weight:600;margin-bottom:6px">Paid PR requests could not be loaded.</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.5">The database refused the read (${_mktEsc((_mktLoadErr||[]).join(', ')||'unknown')}). The Firestore rules in the Firebase Console probably have not been republished since this page shipped.</div>
      <button class="btn-outline" style="margin-top:12px" onclick="window.mktRetryLoad()">Retry</button></div>`;
  }
  const approver=typeof canApprovePaidPR==='function'&&canApprovePaidPR();
  const f=_mktPrFilter;
  const tabs=[['pending','Pending'],['approved','Approved'],['unpaid','Approved, unpaid'],['rejected','Rejected'],['all','All']];
  return`<div class="page-head mkt-head">
      <div><div class="page-title">Paid PR Approvals</div>
      <div class="page-sub">The Sales Team ▸ Marketing · ${approver?'you approve these':'approved by the account that holds the approval right'}</div></div>
      <div class="mkt-actions">
        <button class="btn-outline mkt-primary" onclick="window.mktOpenPaidPR('')">+ Request Paid PR</button>
      </div>
    </div>
    <div id="mkt-prstats">${_mktPrStatsHTML()}</div>
    <div class="mkt-filters">
      <input id="mkt-prsearch" class="mkt-search" type="search" placeholder="Search creator or deliverable" value="${_mktEsc(f.q)}" oninput="window.mktPrSearch(this.value)" aria-label="Search requests">
      <div class="mkt-chiprow mkt-wrap">${tabs.map(([k,l])=>`<button class="filter-chip${f.status===k?' active':''}" onclick="window.mktPrFilter('${k}')">${l}</button>`).join('')}</div>
    </div>
    <div id="mkt-prlist">${_mktPrListHTML()}</div>
    <div style="height:80px"></div>`;
}

function _mktPrStatsHTML(){
  const now=Date.now();
  const pending=mktPaidPRs.filter(r=>r.status==='pending');
  const unpaid=mktPaidPRs.filter(r=>r.status==='approved'&&r.payment_status!=='paid');
  const month=new Date(now).toLocaleDateString('en-GB',{month:'long'});
  const tile=(label,val,sub,onclick)=>`<button class="mkt-stat" onclick="${onclick}"><span class="mkt-stat-label">${label}</span><span class="mkt-stat-val">${val}</span><span class="mkt-stat-sub">${sub}</span></button>`;
  return`<div class="mkt-stats">
    ${tile('Awaiting approval',pending.length,_mktPKR(pending.reduce((n,r)=>n+(Number(r.proposed_amount_pkr)||0),0))+' requested',"window.mktPrFilter('pending')")}
    ${tile('Approved in '+_mktEsc(month),_mktPKR(mktApprovedInMonth(mktPaidPRs,now)),'by decision date',"window.mktPrFilter('approved')")}
    ${tile('Approved, not paid',unpaid.length,_mktPKR(unpaid.reduce((n,r)=>n+(Number(r.proposed_amount_pkr)||0),0))+' outstanding',"window.mktPrFilter('unpaid')")}
    ${tile('Rejected',mktPaidPRs.filter(r=>r.status==='rejected').length,`of ${mktPaidPRs.length} requests`,"window.mktPrFilter('rejected')")}
  </div>`;
}

function _mktPrListHTML(){
  if(!mktPaidPRs.length)return`<div class="card empty">No Paid PR requests yet.</div>`;
  const rows=mktFilteredPaidPRs(mktPaidPRs,mktCreators,_mktPrFilter);
  if(!rows.length)return`<div class="card empty">Nothing here.</div>`;
  const body=rows.map(r=>{
    const c=_mktCreatorById(r.creator_id);
    return`<tr class="mkt-row" data-id="${_mktEsc(r.id)}" onclick="window.mktOpenPaidPR(this.dataset.id)" tabindex="0" onkeydown="if(event.key==='Enter')window.mktOpenPaidPR(this.dataset.id)">
      <td class="mkt-c-who"><div class="mkt-name">${_mktEsc(c?(c.name||'@'+c.ig_handle):'Unknown creator')}</div><div class="mkt-handle">${c?'@'+_mktEsc(c.ig_handle):''}</div></td>
      <td class="mkt-c-prod">${_mktEsc(r.deliverable)}</td>
      <td class="num" data-label="Amount">${_mktPKR(r.proposed_amount_pkr)}</td>
      <td data-label="Requested">${_mktEsc(_mktUserName(r.requested_by_user_id))} · ${_mktWhen(_mktMs(r.created_at))}</td>
      <td class="mkt-c-tier">${_mktPrChip(r)}</td>
      <td data-label="Payment">${_mktPayChip(r)}</td>
    </tr>`;
  }).join('');
  return`<div class="card mkt-card">
    <div class="mkt-count">${rows.length} of ${mktPaidPRs.length} requests</div>
    <div class="mkt-tablewrap"><table class="mkt-table">
      <thead><tr><th>Creator</th><th>Deliverable</th><th class="num">Amount</th><th>Requested</th><th>Status</th><th>Payment</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </div>`;
}

window.mktPrSearch=function(v){
  clearTimeout(_mktPrSearchTimer);
  _mktPrSearchTimer=setTimeout(()=>{_mktPrFilter.q=String(v||'');const l=document.getElementById('mkt-prlist');if(l)l.innerHTML=_mktPrListHTML();},180);
};
window.mktPrFilter=function(k){
  if(!['pending','approved','unpaid','rejected','all'].includes(k))return;
  _mktPrFilter.status=k;
  _mktRerenderPage();
};

// ── Request / view / decide ─────────────────────────────────────────────
window.mktOpenPaidPR=function(id,creatorId){
  const r=id?mktPaidPRs.find(x=>x.id===id):null;
  if(id&&!r){showToast('That request is no longer in the list — refresh the page.',true);return;}
  const approver=typeof canApprovePaidPR==='function'&&canApprovePaidPR();
  const editable=!r||r.status==='pending';
  _mktDraft={creatorId:r?r.creator_id:(creatorId||''),products:[]};
  const v=k=>_mktEsc(r&&r[k]!=null?r[k]:'');
  const disp=r&&r.dispatch_id?mktDispatches.find(d=>d.id===r.dispatch_id):null;
  const decided=r&&r.status!=='pending'?`<div class="mkt-section">
      <div class="mkt-section-title">Decision</div>
      <div>${_mktPrChip(r)} by ${_mktEsc(_mktUserName(r.decided_by_user_id))} · ${_mktWhen(_mktMs(r.decided_at))}</div>
      ${r.status==='rejected'?`<div class="mkt-note">Reason: ${_mktEsc(r.rejection_reason||'—')}</div>`:''}
      ${r.status==='approved'?(disp?`<button class="btn-outline" style="margin-top:8px" data-id="${_mktEsc(disp.id)}" onclick="window.mktOpenDispatch(this.dataset.id)">Open its dispatch (${_mktDispStatusLabel(disp.status)})</button>`:`<div class="mkt-note">Its dispatch is not in the loaded list — refresh the page.</div>`):''}
    </div>`:'';
  const payment=r&&r.status==='approved'?`<div class="mkt-section">
      <div class="mkt-section-title">Payment</div>
      <div class="form-grid mkt-grid-4">
        <div class="field"><label for="mkt-pay-status">Status</label><select id="mkt-pay-status"><option value="unpaid"${r.payment_status!=='paid'?' selected':''}>Unpaid</option><option value="paid"${r.payment_status==='paid'?' selected':''}>Paid</option></select></div>
        <div class="field"><label for="mkt-pay-method">Method</label><select id="mkt-pay-method"><option value="">—</option>${MKT_PAY_METHODS.map(m=>`<option${r.payment_method===m?' selected':''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label for="mkt-pay-ref">Reference</label><input id="mkt-pay-ref" value="${v('payment_reference')}" autocomplete="off"></div>
        <div class="field"><label for="mkt-pay-date">Paid on</label><input id="mkt-pay-date" type="date" value="${v('payment_date')}"></div>
      </div>
      ${r.payment_logged_at?`<div class="mkt-note">Last logged by ${_mktEsc(_mktUserName(r.payment_logged_by_user_id))} · ${_mktWhen(_mktMs(r.payment_logged_at))}. Approved ≠ paid: this is tracked by hand.</div>`:'<div class="mkt-note">Approved ≠ paid: log the payment here once it has gone out.</div>'}
      <button class="btn-outline" style="margin-top:8px" id="mkt-pay-save" onclick="window.mktSavePayment()">Save payment</button>
    </div>`:'';
  const gate=r&&r.status==='pending'?(approver?`<div class="mkt-section">
      <div class="mkt-section-title">Your decision</div>
      <div class="field"><label for="mkt-pr-reason">Reason (required to reject)</label><input id="mkt-pr-reason" autocomplete="off"></div>
      <div class="mkt-note">Approving creates the Paid PR dispatch straight away; its products and date are filled in from the Dispatch Log.</div>
      <div class="mkt-modal-actions" style="justify-content:flex-start">
        <button class="btn-outline mkt-danger" id="mkt-pr-reject" onclick="window.mktDecidePaidPR('rejected')">Reject</button>
        <button class="btn-outline mkt-primary" id="mkt-pr-approve" onclick="window.mktDecidePaidPR('approved')">Approve ${_mktPKR(r.proposed_amount_pkr)}</button>
      </div></div>`
    :`<div class="mkt-section"><div class="mkt-note">Waiting for approval. Only the approver can approve or reject a Paid PR.</div></div>`):'';
  _mktOpenModal(`
    <h3>${r?'Paid PR request':'Request a Paid PR'}</h3>
    <div class="sub">${r?`Requested by ${_mktEsc(_mktUserName(r.requested_by_user_id))} · ${_mktWhen(_mktMs(r.created_at))} · ${_mktPrStatusLabel(r.status)}`:'Goes to the approver. Nothing is sent or paid until it is approved.'}</div>
    <input type="hidden" id="mkt-pr-id" value="${r?_mktEsc(r.id):''}">
    <div class="mkt-section">
      <div class="mkt-section-title">Creator</div>
      <div id="mkt-d-creator">${_mktDraftCreatorHTML(!!r)}</div>
    </div>
    <div class="mkt-section">
      <div class="mkt-section-title">Request</div>
      <div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label for="mkt-pr-deliv">Deliverable *</label><input id="mkt-pr-deliv" value="${v('deliverable')}" placeholder="1 Reel + 3 story frames" autocomplete="off" ${editable?'':'disabled'}></div>
        <div class="field"><label for="mkt-pr-amount">Proposed amount (PKR) *</label><input id="mkt-pr-amount" value="${v('proposed_amount_pkr')}" inputmode="numeric" placeholder="e.g. 45000 or 45k" autocomplete="off" ${editable?'':'disabled'}></div>
        <div class="field"><label for="mkt-pr-timeline">Timeline</label><input id="mkt-pr-timeline" value="${v('timeline')}" placeholder="Posts within 10 days of receipt" autocomplete="off" ${editable?'':'disabled'}></div>
        <div class="field" style="grid-column:1/-1"><label for="mkt-pr-why">Rationale</label><textarea id="mkt-pr-why" rows="3" ${editable?'':'disabled'}>${v('rationale')}</textarea></div>
      </div>
    </div>
    ${gate}${decided}${payment}
    <div id="mkt-f-error" class="mkt-error" hidden></div>
    <div class="mkt-modal-actions">
      <button class="btn-outline" onclick="window.mktCloseModal()">${editable?'Cancel':'Close'}</button>
      ${editable?`<button class="btn-primary" id="mkt-pr-save" onclick="window.mktSavePaidPR()">${r?'Save changes':'Submit for approval'}</button>`:''}
    </div>`,true);
  if(!r&&!_mktDraft.creatorId)document.getElementById('mkt-d-csearch')?.focus();
};

window.mktSavePaidPR=async function(){
  if(_mktSaving||!_mktDraft)return;
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing()){_mktFormError('Your account cannot request Paid PRs.');return;}
  const id=_mktVal('mkt-pr-id');
  const existing=id?mktPaidPRs.find(x=>x.id===id):null;
  const built=mktBuildPaidPRRequest({
    creator_id:_mktDraft.creatorId,deliverable:_mktVal('mkt-pr-deliv'),proposed_amount_pkr:_mktVal('mkt-pr-amount'),
    timeline:_mktVal('mkt-pr-timeline'),rationale:_mktVal('mkt-pr-why')
  },existing,mktCreators,Date.now(),session&&session.uid);
  if(built.error){_mktFormError(built.error);return;}
  const btn=document.getElementById('mkt-pr-save');
  _mktSaving=true;if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const ref=doc(db,'paid_pr_requests',built.id);
    if(built.isNew)await setDoc(ref,built.data);else await updateDoc(ref,built.data);
    const merged=Object.assign({},existing||{},built.data,{id:built.id});
    mktPaidPRs=existing?mktPaidPRs.map(x=>x.id===built.id?merged:x):mktPaidPRs.concat([merged]);
    _mktDraft=null;_mktCloseModal();
    const c=_mktCreatorById(merged.creator_id);
    showToast(existing?'Request updated':'Paid PR submitted for approval'+(c?' — @'+c.ig_handle:''));
    if(typeof logActivity==='function')logActivity(existing?'Paid PR request updated':'Paid PR requested',(c?'@'+c.ig_handle+' · ':'')+_mktPKR(merged.proposed_amount_pkr));
    _mktRerenderPage();
  }catch(e){
    console.error('[marketing] paid PR save failed',e);
    _mktFormError('Could not save: '+((e&&e.message)||'unknown error')+'.');
  }finally{
    _mktSaving=false;
    if(btn){btn.disabled=false;btn.textContent=existing?'Save changes':'Submit for approval';}
  }
};

/**
 * One batch: the decision; on approval also the paid_pr dispatch and the
 * creator's rollups. firestore.rules checks the dispatch against the
 * request AS THE BATCH LEAVES IT (getAfter), so the two cannot disagree.
 */
async function mktWriteDecision(reqId,decision,rollups,creatorId){
  const b=writeBatch(db);
  b.update(doc(db,'paid_pr_requests',reqId),decision.data);
  if(decision.dispatch)b.set(doc(db,'dispatches',decision.dispatch.id),decision.dispatch.data);
  if(rollups&&creatorId)b.update(doc(db,'creators',creatorId),rollups);
  await b.commit();
}

window.mktDecidePaidPR=async function(which){
  if(_mktSaving)return;
  if(typeof canApprovePaidPR!=='function'||!canApprovePaidPR()){_mktFormError('Only the approver can decide a Paid PR.');return;}
  const id=_mktVal('mkt-pr-id');
  const req=mktPaidPRs.find(x=>x.id===id);
  const now=Date.now();
  const decision=mktBuildDecision(req,which,_mktVal('mkt-pr-reason'),now,session&&session.uid);
  if(decision.error){_mktFormError(decision.error);return;}
  if(which==='approved'&&typeof confirm==='function'&&!confirm('Approve '+_mktPKR(req.proposed_amount_pkr)+' for this Paid PR? This creates its dispatch.'))return;
  const nextReqs=mktPaidPRs.map(x=>x.id===id?Object.assign({},x,decision.data):x);
  const nextDisp=decision.dispatch?mktDispatches.concat([Object.assign({id:decision.dispatch.id},decision.dispatch.data)]):mktDispatches;
  const rollups=which==='approved'&&_mktCreatorById(req.creator_id)?mktCreatorRollups(req.creator_id,nextDisp,nextReqs):null;
  const btns=['mkt-pr-approve','mkt-pr-reject'].map(x=>document.getElementById(x)).filter(Boolean);
  _mktSaving=true;btns.forEach(b=>{b.disabled=true;});
  try{
    await mktWriteDecision(id,decision,rollups,req.creator_id);
    mktPaidPRs=nextReqs;mktDispatches=nextDisp;
    if(rollups)mktCreators=mktCreators.map(c=>c.id===req.creator_id?Object.assign({},c,rollups):c);
    _mktCloseModal();
    const c=_mktCreatorById(req.creator_id);
    showToast(which==='approved'?'Approved — the Paid PR dispatch is in the Dispatch Log, waiting for its products and date':'Rejected');
    // A Paid PR always gets a code (spec §6). The approval stands whatever
    // happens here; a failure is said out loud and retried from the dispatch.
    if(which==='approved'&&decision.dispatch){
      mktCreateCode(decision.dispatch.id).then(r=>{
        if(r.error)showToast('Approved, but the discount code was not created: '+r.error+' Open the dispatch to retry.',true);
        else{
          showToast('Discount code created: '+r.code.code);
          if(typeof logActivity==='function')logActivity('Discount code created',(c?'@'+c.ig_handle+' · ':'')+r.code.code);
        }
        _mktRerenderPage();
      });
    }
    if(typeof logActivity==='function')logActivity(which==='approved'?'Paid PR approved':'Paid PR rejected',(c?'@'+c.ig_handle+' · ':'')+_mktPKR(req.proposed_amount_pkr));
    _mktRerenderPage();
  }catch(e){
    console.error('[marketing] paid PR decision failed',e);
    _mktFormError('Could not record the decision: '+((e&&e.message)||'unknown error')+'. Nothing was changed.');
  }finally{
    _mktSaving=false;btns.forEach(b=>{b.disabled=false;});
  }
};

window.mktSavePayment=async function(){
  if(_mktSaving)return;
  const id=_mktVal('mkt-pr-id');
  const req=mktPaidPRs.find(x=>x.id===id);
  const built=mktBuildPayment(req,{payment_status:_mktVal('mkt-pay-status'),payment_method:_mktVal('mkt-pay-method'),
    payment_reference:_mktVal('mkt-pay-ref'),payment_date:_mktVal('mkt-pay-date')},Date.now(),session&&session.uid);
  if(built.error){_mktFormError(built.error);return;}
  const btn=document.getElementById('mkt-pay-save');
  _mktSaving=true;if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await updateDoc(doc(db,'paid_pr_requests',id),built.data);
    mktPaidPRs=mktPaidPRs.map(x=>x.id===id?Object.assign({},x,built.data):x);
    _mktCloseModal();
    showToast(built.data.payment_status==='paid'?'Payment logged':'Marked unpaid');
    if(typeof logActivity==='function'){const c=_mktCreatorById(req.creator_id);logActivity('Paid PR payment logged',(c?'@'+c.ig_handle+' · ':'')+(built.data.payment_status==='paid'?'paid '+_mktPKR(req.proposed_amount_pkr):'unpaid'));}
    _mktRerenderPage();
  }catch(e){
    console.error('[marketing] payment save failed',e);
    _mktFormError('Could not save the payment: '+((e&&e.message)||'unknown error')+'.');
  }finally{
    _mktSaving=false;
    if(btn){btn.disabled=false;btn.textContent='Save payment';}
  }
};

// ════════════════════════════════════════════════════════════════════════
// M5 — SLA reminders and the dashboard card
// ════════════════════════════════════════════════════════════════════════
// Reminders go to the same bell every other module uses (hrm_notifications)
// and are addressed by forUser. Recipients are resolved at the moment a
// reminder is raised — by ROLE for the lead, by the canApprovePaidPR FLAG
// for the approver — so nothing names a person and a reassignment needs no
// data change.
//
// They are raised by whichever Marketing account opens the app (at most
// once a day per device), the same client-side pattern as the HRM
// increment-due check. Nothing fires while nobody has the app open; the
// first person to open it raises everything that is due. Every reminder has
// a DETERMINISTIC id, so any number of devices raising it produce one
// notification, and a dismissed one is never raised again.

const MKT_SLA_LEAD_DAYS=7;       // no post N days after shipping → the lead
const MKT_SLA_APPROVER_DAYS=14;  // … and at this point → the approver too
const _MKT_REMINDER_KEY='groovy-mkt-reminders-day';
const _MKT_REMINDER_CAP=60;      // per run — a backlog cannot flood the bell
let _mktRemindersRan=false;

function mktLeadUsernames(){
  return (typeof USER_DEFS!=='undefined'?USER_DEFS:[]).filter(u=>u.role==='creator_content_ops_lead').map(u=>u.u);
}
function mktApproverUsernames(){
  return (typeof USER_DEFS!=='undefined'?USER_DEFS:[]).filter(u=>u.canApprovePaidPR===true).map(u=>u.u);
}

/** Whole days since a timestamp. */
function _mktDaysSince(ms,nowMs){return ms==null?null:Math.floor((nowMs-ms)/_MKT_DAY_MS);}

/**
 * Every reminder that should exist right now, as the bell will store it.
 * Pure: the caller decides which ones are new.
 */
function mktPlanReminders(dispatches,creators,nowMs,leads,approvers){
  const byId=new Map((creators||[]).map(c=>[c.id,c]));
  const who=d=>{const c=byId.get(d.creator_id);return c?'@'+_mktEsc(c.ig_handle):'a creator';};
  const out=[];
  (dispatches||[]).forEach(d=>{
    const shipped=_mktMs(d.shipped_at);
    const noPost=!String(d.link_to_post||'').trim()&&d.status!=='content_received';
    const days=_mktDaysSince(shipped,nowMs);
    if(noPost&&days!=null&&days>=MKT_SLA_LEAD_DAYS){
      (leads||[]).forEach(u=>out.push({id:'mkt_sla7_'+d.id+'_'+u,forUser:u,type:'mkt_sla_7',priority:'normal',
        title:'No post yet — '+days+' days since shipping',
        message:who(d)+' has not posted '+_mktEsc(d.collection_sent||'the dispatch')+' shipped '+days+' days ago.',
        relatedTo:d.id}));
    }
    if(noPost&&days!=null&&days>=MKT_SLA_APPROVER_DAYS){
      (approvers||[]).forEach(u=>out.push({id:'mkt_sla14_'+d.id+'_'+u,forUser:u,type:'mkt_sla_14',priority:'high',
        title:'Creator overdue — '+days+' days, no post',
        message:who(d)+' still has not posted '+_mktEsc(d.collection_sent||'the dispatch')+' ('+(d.type==='paid_pr'?'Paid PR':'organic')+'), shipped '+days+' days ago.',
        relatedTo:d.id}));
    }
    const d7=mktDay7(d,nowMs);
    if(d7.state==='due'){
      (leads||[]).forEach(u=>out.push({id:'mkt_d7_'+d.id+'_'+u,forUser:u,type:'mkt_day7',priority:'normal',
        title:'Day-7 performance due',
        message:'Capture the Day-7 numbers for '+who(d)+'’s post'+(d7.basis==='shipped'?' — counted from shipping, because no content-received date was recorded.':'.'),
        relatedTo:d.id}));
    }
  });
  return out;
}

function _mktTodayKey(){return _mktDayStr(Date.now());}

/**
 * Raise whatever is due and not yet raised. Reads only what it needs —
 * shipped dispatches and uncaptured ones — never the whole log.
 */
async function mktRunReminders(opts){
  const o=opts||{};
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())return{raised:0,skipped:'no access'};
  if(_mktRemindersRan&&!o.force)return{raised:0,skipped:'already ran'};
  if(!o.force){
    try{if(localStorage.getItem(_MKT_REMINDER_KEY)===_mktTodayKey())return{raised:0,skipped:'ran today'};}catch(_){}
  }
  _mktRemindersRan=true;
  const now=o.now||Date.now();
  let list;
  if(mktDispatchesLoaded)list=mktDispatches;
  else{
    const [a,b]=await Promise.allSettled([
      getDocs(query(collection(db,'dispatches'),where('status','==','shipped'))),
      getDocs(query(collection(db,'dispatches'),where('performance_captured_at','==',null)))
    ]);
    const seen=new Map();
    [a,b].forEach(r=>{if(r.status==='fulfilled')r.value.docs.forEach(d=>seen.set(d.id,Object.assign({id:d.id},d.data())));});
    if(a.status!=='fulfilled'&&b.status!=='fulfilled')return{raised:0,skipped:'reads refused'};
    list=Array.from(seen.values());
  }
  // Names for the messages — only the creators actually involved.
  let creators=mktCreators;
  if(!mktCreatorsLoaded){
    const ids=Array.from(new Set(list.map(d=>d.creator_id).filter(Boolean))).slice(0,80);
    const snaps=await Promise.allSettled(ids.map(id=>getDoc(doc(db,'creators',id))));
    creators=snaps.map((s,i)=>s.status==='fulfilled'&&s.value&&s.value.exists()?Object.assign({id:ids[i]},s.value.data()):null).filter(Boolean);
  }
  const plan=mktPlanReminders(list,creators,now,mktLeadUsernames(),mktApproverUsernames()).slice(0,_MKT_REMINDER_CAP);
  const known=new Set((typeof allHRMNotifs!=='undefined'?allHRMNotifs:[]).map(n=>n._id||n.id));
  let raised=0;
  for(const n of plan){
    if(known.has(n.id))continue;
    try{
      const ref=doc(db,'hrm_notifications',n.id);
      const snap=await getDoc(ref);
      if(snap&&snap.exists())continue;   // raised before — maybe dismissed; never raise it again
      const data={id:n.id,type:n.type,title:n.title,message:n.message,forUser:n.forUser,forRole:'',
        relatedTo:n.relatedTo,createdAt:now,readBy:[],priority:n.priority,actionRequired:false,actionUrl:'mkt-dispatches'};
      await setDoc(ref,data);
      raised++;
      if(typeof allHRMNotifs!=='undefined')allHRMNotifs.unshift(Object.assign({},data,{_id:n.id}));
    }catch(e){console.warn('[marketing] reminder failed',n.id,e&&e.message);}
  }
  try{localStorage.setItem(_MKT_REMINDER_KEY,_mktTodayKey());}catch(_){}
  if(raised&&typeof _renderHRMNotifBadge==='function')_renderHRMNotifBadge();
  return{raised,planned:plan.length};
}

/**
 * Called from startApp and NEVER awaited — nothing on the path to the first
 * render may wait on the network (CLAUDE.md, "Diagnostics"). Gives the lead
 * the bell's contents (the lead never opens the dashboard that normally
 * loads them) and raises today's reminders.
 */
function mktBootstrap(){
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())return;
  setTimeout(()=>{
    (async()=>{
      try{
        if(typeof hrmS4DataLoaded!=='undefined'&&!hrmS4DataLoaded&&typeof loadHRMSession4Data==='function')await loadHRMSession4Data();
      }catch(_){}
      try{await mktRunReminders();}catch(e){console.warn('[marketing] reminders skipped',e&&e.message);}
    })();
  },1500);
}

// ── Dashboard card (owners) ─────────────────────────────────────────────
// Passive visibility only — it reports, it asks nothing. Same placeholder +
// async populate shape as the Monitor and HRM widgets.
function renderMarketingDashboardWidget(){
  if(!session||session.role!=='owner'||typeof canAccessMarketing!=='function'||!canAccessMarketing())return'';
  return`<div class="card" id="mkt-dash-widget" style="margin-bottom:14px;cursor:pointer" onclick="window.showPage('mkt-dispatches')">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="font-weight:700;font-size:11px;letter-spacing:.07em;text-transform:uppercase">Marketing</div>
      <div style="font-size:11px;color:var(--muted)">Dispatch Log ›</div>
    </div>
    <div id="mkt-dash-body" style="font-size:13px;color:var(--muted);margin-top:6px">Loading…</div>
  </div>`;
}

/** The card's sentence, from counts. Pure. */
function mktDashboardLine(weekCount,pendingCount,pendingPkr,codes){
  const parts=[
    `<b style="color:var(--text)">${weekCount}</b> dispatched this week`,
    `<b style="color:${pendingCount?'var(--accent-warning)':'var(--text)'}">${pendingCount}</b> Paid PR pending approval${pendingCount?' ('+_mktPKR(pendingPkr)+')':''}`,
    codes&&codes.live!=null
      ?`<b style="color:var(--text)">${codes.live}</b> discount codes live, ${_mktPKR(codes.redeemedPkr)} redeemed this month`
      :'discount-code figures unavailable'
  ];
  return parts.join(' · ');
}

function _mktWithTimeout(p,ms){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);}

async function _mktPopulateDashboard(){
  const body=document.getElementById('mkt-dash-body');
  if(!body)return;
  try{
    const since=_mktWeekStart(Date.now());
    const codesRead=getDocs(collection(db,'discount_codes')).then(s=>mktCodesSummary(s.docs.map(d=>d.data()),Date.now())).catch(()=>null);
    const [wk,pend,codes]=await _mktWithTimeout(Promise.all([
      getDocs(query(collection(db,'dispatches'),where('date_of_dispatch','>=',since))),
      getDocs(query(collection(db,'paid_pr_requests'),where('status','==','pending'))),
      codesRead
    ]),12000);
    const pending=pend.docs.map(d=>d.data());
    body.innerHTML=mktDashboardLine(wk.docs.length,pending.length,pending.reduce((n,r)=>n+(Number(r.proposed_amount_pkr)||0),0),codes);
  }catch(e){
    body.innerHTML=e&&e.message==='timeout'
      ?'Taking too long. <a href="#" onclick="event.preventDefault();event.stopPropagation();_mktPopulateDashboard();" style="color:inherit;text-decoration:underline">Retry</a>'
      :'Could not load the Marketing figures.';
  }
}

// ════════════════════════════════════════════════════════════════════════
// M6 — Reports
// ════════════════════════════════════════════════════════════════════════
// Four reports, each saying plainly what it can and cannot claim:
//   · Monthly PR spend — approved and paid side by side (approved ≠ paid).
//   · Top ROI — Paid PR only (ROI needs a cost; organic has none). Revenue
//     comes from discount-code redemptions, which arrive with M4, so until
//     then the table ranks spend and says ROI is not yet measurable.
//   · Best performing (organic) — Day-7 captures, never called ROI.
//   · Sales lift — two lines that are never added together: attributed
//     (coded, M4) and directional (uncoded: units of the dispatched SKU in
//     the N days after vs before; correlation, not attribution).

let _mktReportLiftDays=14;
let _mktOrganicSort='views';
let _mktLineItems=null;       // [{sku, quantity, created:ms, refunded:bool}]
let _mktLineItemsErr=null;
let _mktLineItemsLoading=null;

/** Approved requests grouped by the month they were decided in. */
function mktMonthlySpend(requests){
  const byMonth=new Map();
  (requests||[]).forEach(r=>{
    if(r.status!=='approved')return;
    const t=_mktMs(r.decided_at);if(t==null)return;
    const key=_mktDayStr(t).slice(0,7);
    const m=byMonth.get(key)||{month:key,count:0,approved:0,paid:0,unpaid:0};
    const amt=Number(r.proposed_amount_pkr)||0;
    m.count++;m.approved+=amt;
    if(r.payment_status==='paid')m.paid+=amt;else m.unpaid+=amt;
    byMonth.set(key,m);
  });
  return Array.from(byMonth.values()).sort((a,b)=>a.month<b.month?1:-1);
}

/**
 * Paid PR creators with their spend and, once codes exist, attributed
 * revenue. revenueByCreator is null until M4 — then ROI is null too, and
 * the list is ranked by spend instead of pretending.
 */
function mktPaidRoi(requests,creators,revenueByCreator){
  const byId=new Map((creators||[]).map(c=>[c.id,c]));
  const rows=new Map();
  (requests||[]).forEach(r=>{
    if(r.status!=='approved')return;
    const row=rows.get(r.creator_id)||{creator_id:r.creator_id,creator:byId.get(r.creator_id)||null,paidPrs:0,spend:0,revenue:null,roi:null};
    row.paidPrs++;row.spend+=Number(r.proposed_amount_pkr)||0;
    rows.set(r.creator_id,row);
  });
  const list=Array.from(rows.values());
  if(revenueByCreator){
    list.forEach(x=>{x.revenue=Number(revenueByCreator[x.creator_id])||0;x.roi=x.spend>0?Math.round(x.revenue/x.spend*100)/100:null;});
    return list.sort((a,b)=>(b.roi==null?-1:b.roi)-(a.roi==null?-1:a.roi));
  }
  return list.sort((a,b)=>b.spend-a.spend);
}

/** Organic creators ranked from their Day-7 captures. */
function mktOrganicPerformance(dispatches,creators,sortBy){
  const byId=new Map((creators||[]).map(c=>[c.id,c]));
  const rows=new Map();
  (dispatches||[]).forEach(d=>{
    if((d.type||'organic')!=='organic'||!d.performance_captured_at)return;
    const v=Number(d.performance_views);
    if(!isFinite(v)||v<=0)return;
    const eng=(Number(d.performance_likes)||0)+(Number(d.performance_comments)||0)+(Number(d.performance_saves)||0);
    const row=rows.get(d.creator_id)||{creator_id:d.creator_id,creator:byId.get(d.creator_id)||null,posts:0,views:0,engagements:0};
    row.posts++;row.views+=v;row.engagements+=eng;
    rows.set(d.creator_id,row);
  });
  const list=Array.from(rows.values()).map(r=>Object.assign(r,{
    avgViews:Math.round(r.views/r.posts),
    engagementRate:Math.round(r.engagements/r.views*10000)/10000
  }));
  return list.sort(sortBy==='engagement'
    ?(a,b)=>b.engagementRate-a.engagementRate||b.avgViews-a.avgViews
    :(a,b)=>b.avgViews-a.avgViews||b.engagementRate-a.engagementRate);
}

/** Line items as the lift report needs them. */
function mktLineItemFromDoc(o){
  const d=o||{};
  return{sku:String(d.sku||'').trim(),quantity:Number(d.quantity)||0,created:_mktMs(d.order_created_at),
    refunded:/refund|void/i.test(String(d.financial_status||''))};
}

/**
 * Directional lift for UNCODED dispatches: for each dispatched SKU, units
 * sold in the N days after the dispatch date against the N days before.
 * A window still running is reported as such, never as a finished number.
 */
function mktSalesLift(dispatches,lineItems,skuByVariant,days,nowMs,creators){
  const N=days||14;
  const byId=new Map((creators||[]).map(c=>[c.id,c]));
  const bySku=new Map();
  (lineItems||[]).forEach(li=>{
    if(!li.sku||li.refunded||li.created==null)return;
    (bySku.get(li.sku)||bySku.set(li.sku,[]).get(li.sku)).push(li);
  });
  const rows=[];
  (dispatches||[]).forEach(d=>{
    if(d.has_discount_code)return;               // coded → the attributed line
    const day=_mktIsoDay(d.date_of_dispatch);
    if(!day)return;
    const [y,m,dd]=day.split('-').map(Number);
    const start=new Date(y,m-1,dd).getTime();
    const before=start-N*_MKT_DAY_MS,after=start+N*_MKT_DAY_MS;
    (d.products||[]).forEach(p=>{
      const sku=String(p.sku||(skuByVariant&&skuByVariant[p.variant_id])||'').trim();
      const row={dispatch_id:d.id,creator:byId.get(d.creator_id)||null,date:day,product:p.product_title+(p.variant_title?' — '+p.variant_title:''),
        sku,before:null,after:null,change:null,open:nowMs<after};
      if(sku){
        const items=bySku.get(sku)||[];
        row.before=items.filter(li=>li.created>=before&&li.created<start).reduce((n,li)=>n+li.quantity,0);
        row.after=items.filter(li=>li.created>=start&&li.created<Math.min(after,nowMs)).reduce((n,li)=>n+li.quantity,0);
        row.change=row.after-row.before;
      }
      rows.push(row);
    });
  });
  return rows.sort((a,b)=>a.date<b.date?1:-1);
}

function _mktLoadLineItems(){
  if(_mktLineItems)return Promise.resolve();
  if(_mktLineItemsLoading)return _mktLineItemsLoading;
  _mktLineItemsErr=null;
  _mktLineItemsLoading=(async()=>{
    try{
      if(typeof _siCollectionsLoaded!=='undefined'&&_siCollectionsLoaded&&typeof _siLineItems!=='undefined')
        _mktLineItems=_siLineItems.map(mktLineItemFromDoc);
      else{
        const snap=await getDocs(collection(db,'shopify_line_items'));
        _mktLineItems=snap.docs.map(d=>mktLineItemFromDoc(d.data()));
      }
    }catch(e){_mktLineItemsErr=(e&&e.message)||'could not read Shopify orders';}
    _mktLineItemsLoading=null;
  })();
  return _mktLineItemsLoading;
}

function _mktMonthLabel(key){const [y,m]=key.split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});}
function _mktWhoCell(c){return c?`<div class="mkt-name">${_mktEsc(c.name||'@'+c.ig_handle)}</div><div class="mkt-handle">@${_mktEsc(c.ig_handle)}</div>`:'<span class="mkt-muted">Unknown creator</span>';}

function renderMarketingReports(){
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())
    return'<div class="empty">Reports are limited to the owners and the Creator &amp; Content Operations Lead.</div>';
  const missing=[!mktDispatchesLoaded&&'dispatches',!mktPaidPRsLoaded&&'paid_pr_requests'].filter(Boolean);
  const warn=missing.length?`<div class="mkt-warn">Some data could not be read (${_mktEsc(missing.join(', '))}), so the reports below are incomplete. <button class="btn-outline" onclick="window.mktRetryLoad()">Retry</button></div>`:'';
  // Line items and the catalog load on first visit; the lift section repaints when they land.
  if(!_mktLineItems&&!_mktLineItemsErr)Promise.all([_mktLoadLineItems(),_mktLoadCatalog()]).then(()=>{const el=document.getElementById('mkt-rep-lift');if(el)el.innerHTML=_mktLiftHTML();});
  return`<div class="page-head mkt-head">
      <div><div class="page-title">Reports</div>
      <div class="page-sub">The Sales Team ▸ Marketing</div></div>
    </div>
    ${warn}
    <div class="card"><div class="card-title">Monthly PR spend</div>${_mktSpendHTML()}</div>
    <div class="card"><div class="card-title">Top ROI creators — Paid PR only</div>${_mktRoiHTML()}</div>
    <div class="card"><div class="card-title">Best performing — organic</div>${_mktOrganicHTML()}</div>
    <div class="card"><div class="card-title">Sales lift on dispatched products</div><div id="mkt-rep-lift">${_mktLiftHTML()}</div></div>
    <div class="card"><div class="card-title">Shopify connection</div><div id="mkt-rep-shopify">${_mktShopifyHTML()}</div></div>
    <div style="height:80px"></div>`;
}

function _mktSpendHTML(){
  const rows=mktMonthlySpend(mktPaidPRs);
  if(!rows.length)return'<div class="mkt-note">No approved Paid PRs yet.</div>';
  const tot=rows.reduce((t,r)=>({count:t.count+r.count,approved:t.approved+r.approved,paid:t.paid+r.paid,unpaid:t.unpaid+r.unpaid}),{count:0,approved:0,paid:0,unpaid:0});
  return`<div class="mkt-tablewrap"><table class="mkt-table mkt-rep">
    <thead><tr><th>Month approved</th><th class="num">Paid PRs</th><th class="num">Approved</th><th class="num">Paid out</th><th class="num">Not yet paid</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${_mktMonthLabel(r.month)}</td><td class="num" data-label="Paid PRs">${r.count}</td><td class="num" data-label="Approved">${_mktPKR(r.approved)}</td><td class="num" data-label="Paid out">${_mktPKR(r.paid)}</td><td class="num" data-label="Not yet paid">${r.unpaid?`<span class="mkt-pay-unpaid">${_mktPKR(r.unpaid)}</span>`:_mktPKR(0)}</td></tr>`).join('')}
    <tr class="mkt-total"><td>Total</td><td class="num" data-label="Paid PRs">${tot.count}</td><td class="num" data-label="Approved">${_mktPKR(tot.approved)}</td><td class="num" data-label="Paid out">${_mktPKR(tot.paid)}</td><td class="num" data-label="Not yet paid">${_mktPKR(tot.unpaid)}</td></tr></tbody>
  </table></div><div class="mkt-note">Grouped by the month each request was approved. Approved is what was committed; paid out is what has been logged as paid.</div>`;
}

function _mktRoiHTML(){
  const haveCodes=mktCodesLoaded&&mktCodes.some(c=>c.dispatch_type==='paid_pr');
  const rows=mktPaidRoi(mktPaidPRs,mktCreators,haveCodes?mktRevenueByCreator(mktCodes,'paid_pr'):null);
  if(!rows.length)return'<div class="mkt-note">No approved Paid PRs yet.</div>';
  if(haveCodes)return`<div class="mkt-tablewrap"><table class="mkt-table mkt-rep">
    <thead><tr><th>Creator</th><th class="num">Paid PRs</th><th class="num">Spend</th><th class="num">Attributed revenue</th><th class="num">ROI</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td class="mkt-c-who">${_mktWhoCell(r.creator)}</td><td class="num" data-label="Paid PRs">${r.paidPrs}</td><td class="num" data-label="Spend">${_mktPKR(r.spend)}</td><td class="num" data-label="Revenue">${_mktPKR(r.revenue)}</td><td class="num" data-label="ROI">${r.roi==null?'—':`<b class="${r.roi>=1?'mkt-up':'mkt-down'}">${r.roi}×</b>`}</td></tr>`).join('')}</tbody>
  </table></div><div class="mkt-note">ROI = revenue from orders that used the creator's Paid PR codes ÷ approved Paid PR spend. Revenue is recounted nightly${_mktCodesMeta&&_mktCodesMeta.last_run_at?' (last: '+_mktWhen(_mktCodesMeta.last_run_at)+')':''}; a refund made after an order was synced is not deducted.</div>`;
  return`<div class="mkt-warn">ROI needs the revenue from each creator's Paid PR discount code, and no Paid PR has a code yet. Until one does, this ranks creators by Paid PR spend — it is not an ROI ranking.</div>
  <div class="mkt-tablewrap"><table class="mkt-table mkt-rep">
    <thead><tr><th>Creator</th><th class="num">Paid PRs</th><th class="num">Spend</th><th class="num">Attributed revenue</th><th class="num">ROI</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td class="mkt-c-who">${_mktWhoCell(r.creator)}</td><td class="num" data-label="Paid PRs">${r.paidPrs}</td><td class="num" data-label="Spend">${_mktPKR(r.spend)}</td><td class="num" data-label="Revenue"><span class="mkt-muted">not measurable yet</span></td><td class="num" data-label="ROI"><span class="mkt-muted">—</span></td></tr>`).join('')}</tbody>
  </table></div>`;
}

function _mktOrganicHTML(){
  const rows=mktOrganicPerformance(mktDispatches,mktCreators,_mktOrganicSort);
  const toggle=`<div class="mkt-chiprow" style="margin-bottom:10px"><button class="filter-chip${_mktOrganicSort==='views'?' active':''}" onclick="window.mktOrganicSort('views')">By reach (avg views)</button><button class="filter-chip${_mktOrganicSort==='engagement'?' active':''}" onclick="window.mktOrganicSort('engagement')">By engagement</button></div>`;
  if(!rows.length)return toggle+'<div class="mkt-note">No Day-7 captures on organic dispatches yet.</div>';
  return toggle+`<div class="mkt-tablewrap"><table class="mkt-table mkt-rep">
    <thead><tr><th>#</th><th>Creator</th><th class="num">Posts captured</th><th class="num">Avg views</th><th class="num">Engagement</th></tr></thead>
    <tbody>${rows.slice(0,25).map((r,i)=>`<tr><td class="num">${i+1}</td><td class="mkt-c-who">${_mktWhoCell(r.creator)}</td><td class="num" data-label="Posts">${r.posts}</td><td class="num" data-label="Avg views">${_mktFmtNum(r.avgViews)}</td><td class="num" data-label="Engagement">${_mktPct(r.engagementRate)}</td></tr>`).join('')}</tbody>
  </table></div><div class="mkt-note">From the Day-7 snapshots. Engagement = (likes + comments + saves) ÷ views. Organic dispatches carry no cost, so this is performance, not ROI.</div>`;
}
window.mktOrganicSort=function(k){if(k==='views'||k==='engagement'){_mktOrganicSort=k;_mktRerenderPage();}};

function _mktLiftHTML(){
  const aRows=mktCodesLoaded?mktAttributedRows(mktCodes,mktDispatches,mktCreators):null;
  const coded=`<div class="mkt-lift-line"><div class="mkt-section-title">Attributed — dispatches with a discount code</div>
    ${aRows===null?'<div class="mkt-error">Discount codes could not be read.</div>'
      :!aRows.length?'<div class="mkt-note">No discount codes yet. Each code’s Shopify revenue appears here once it has been used.</div>'
      :`<div class="mkt-tablewrap"><table class="mkt-table mkt-rep">
        <thead><tr><th>Code</th><th>Creator</th><th>Dispatch</th><th class="num">Redemptions</th><th class="num">Revenue</th></tr></thead>
        <tbody>${aRows.slice(0,60).map(r=>`<tr><td><span class="mkt-code-text">${_mktEsc(r.code)}</span>${r.status==='expired'?' <span class="mkt-muted">expired</span>':''}</td><td class="mkt-c-who">${_mktWhoCell(r.creator)}</td>
          <td data-label="Dispatch">${r.dispatch?_mktDayLabel(r.dispatch.date_of_dispatch)+' · '+(r.type==='paid_pr'?'Paid PR':'organic'):'—'}</td>
          <td class="num" data-label="Redemptions">${r.redemptions}</td><td class="num" data-label="Revenue">${_mktPKR(r.revenue)}</td></tr>`).join('')}</tbody>
      </table></div><div class="mkt-note">A hard number: Shopify orders placed with the code, cancelled and refunded-at-sync orders excluded. Recounted nightly.</div>`}
  </div>`;
  const days=_mktReportLiftDays;
  const picker=`<div class="mkt-chiprow" style="margin:6px 0 10px">${[7,14,30].map(n=>`<button class="filter-chip${days===n?' active':''}" onclick="window.mktLiftDays(${n})">${n} days</button>`).join('')}</div>`;
  let body;
  if(_mktLineItemsErr)body=`<div class="mkt-error">Shopify order data could not be read (${_mktEsc(_mktLineItemsErr)}).</div>`;
  else if(!_mktLineItems)body='<div class="mkt-note">Loading Shopify orders…</div>';
  else{
    const skuByVariant={};(_mktCatalog||[]).forEach(v=>{if(v.sku)skuByVariant[v.variant_id]=v.sku;});
    const rows=mktSalesLift(mktDispatches,_mktLineItems,skuByVariant,days,Date.now(),mktCreators);
    body=!rows.length?'<div class="mkt-note">No dated dispatches with products yet.</div>'
      :`<div class="mkt-tablewrap"><table class="mkt-table mkt-rep">
        <thead><tr><th>Dispatched</th><th>Creator</th><th>Product</th><th class="num">${days}d before</th><th class="num">${days}d after</th><th class="num">Change</th></tr></thead>
        <tbody>${rows.slice(0,60).map(r=>`<tr><td class="mkt-c-date">${_mktDayLabel(r.date)}</td><td class="mkt-c-who">${_mktWhoCell(r.creator)}</td><td class="mkt-c-prod">${_mktEsc(r.product)}${r.sku?'':' <span class="mkt-muted">(no SKU match)</span>'}</td>
          <td class="num" data-label="Before">${r.before==null?'—':r.before}</td><td class="num" data-label="After">${r.after==null?'—':r.after}${r.open?' <span class="mkt-muted">so far</span>':''}</td>
          <td class="num" data-label="Change">${r.change==null?'—':`<span class="${r.change>0?'mkt-up':r.change<0?'mkt-down':''}">${r.change>0?'+':''}${r.change}</span>`}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }
  return coded+`<div class="mkt-lift-line"><div class="mkt-section-title">Directional — dispatches without a code</div>
    <div class="mkt-warn">Correlational estimate, not attribution. Units of the dispatched SKU in the ${days} days after the dispatch against the ${days} days before — ads, other creators and seasonality are not controlled for. Refunded orders are left out.</div>
    ${picker}${body}</div>`;
}
window.mktLiftDays=function(n){if([7,14,30].indexOf(n)>=0){_mktReportLiftDays=n;const el=document.getElementById('mkt-rep-lift');if(el)el.innerHTML=_mktLiftHTML();}};

// ════════════════════════════════════════════════════════════════════════
// M7 — Migration from the Content Tracker 2026 sheet
// ════════════════════════════════════════════════════════════════════════
// An in-app importer rather than a script with a service account: the
// Excel file is read in the browser with the vendored SheetJS, every row is
// shown before anything is written, duplicate handles must be resolved by a
// person, and the writes go through the same rules and the same
// handle-lock transaction as a creator added by hand. Re-running it is
// safe — a handle already in the database is skipped, and a sheet dispatch
// row has a fixed id.
//
// Rules from the spec, all enforced below:
//   · rows import as-is; a missing field stays EMPTY, never a placeholder;
//   · niche strings are split into arrays;
//   · city casing is normalised onto the Lists tab; a city that matches
//     nothing is kept as typed and flagged, not guessed;
//   · duplicate handles are held back for review;
//   · score and tier stay null — the sheet's A/B/C column is ignored;
//   · monthly-tab rows become dispatches with date and status left BLANK
//     when the sheet has none, and their product text kept as a note.

const MKT_IMPORT_SOURCE='content_tracker_2026';
const _MKT_MONTH_TABS=/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}$/i;
let _mktImport=null;   // {fileName, creators:{...plan}, dispatches:[...], choices:{handle:rowNo|''}, running, log}

/** A header cell to the key the importer uses. */
function _mktHeaderKey(h){
  const k=String(h||'').toLowerCase().replace(/[^a-z]/g,'');
  return({tier:'tier',name:'name',ighandle:'ig_handle',handle:'ig_handle',instagram:'ig_handle',niche:'niche',city:'city',
    address:'address',phone:'phone',phoneno:'phone',topsize:'top_size',bottomsize:'bottom_size',
    dateofdispatch:'date',date:'date',collectionsent:'collection',collection:'collection',
    productssent:'products',products:'products',status:'status',linktopost:'link',link:'link'})[k]||'';
}

/** Rows (arrays, first row = header) → objects keyed by importer keys. */
function mktRowsToRecords(rows){
  if(!rows||!rows.length)return[];
  const keys=(rows[0]||[]).map(_mktHeaderKey);
  const out=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i]||[];
    const rec={_row:i+1};
    let any=false;
    keys.forEach((k,j)=>{if(!k)return;const v=r[j];if(v!==undefined&&v!==null&&String(v).trim()!==''){rec[k]=v;any=true;}});
    if(any)out.push(rec);
  }
  return out;
}

function _mktTitleCase(s){return String(s||'').trim().replace(/\s+/g,' ').toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());}

/** One Master List row → what would be imported, with its problems named. */
function mktParseMasterRecord(rec){
  const raw=String(rec.ig_handle==null?'':rec.ig_handle).trim();
  const handle=mktNormHandle(raw);
  const cityRaw=String(rec.city==null?'':rec.city).trim();
  const city=mktCanonCity(cityRaw);
  const out={
    row:rec._row,handleRaw:raw,handle,
    name:_mktTrim(rec.name,80),
    niche:mktNormNiche(rec.niche),
    city:city||(cityRaw?_mktTitleCase(cityRaw):''),
    cityUnmatched:!!(cityRaw&&!city),cityRaw,
    address:_mktTrim(rec.address,300),
    phone:_mktTrim(rec.phone,30),
    top_size:_mktTrim(rec.top_size,20),
    bottom_size:_mktTrim(rec.bottom_size,20),
    sheetTier:_mktTrim(rec.tier,20)
  };
  out.problem=!raw?'no handle':!handle?'not a valid Instagram handle':'';
  if(!raw){
    // Seven Master List rows carry the handle in the NAME column and nothing
    // in IG Handle. That is offered as a correction for a person to accept —
    // never applied on its own.
    const n=String(rec.name==null?'':rec.name).trim();
    const sug=/\s/.test(n)?'':mktNormHandle(n);
    if(sug){out.problem='handle is in the Name column';out.suggestedHandle=sug;}
    // A row holding nothing but the old tier letter has nothing to import.
    const content=['name','niche','city','address','phone','top_size','bottom_size'].some(k=>String(rec[k]==null?'':rec[k]).trim());
    if(!content){out.problem='empty apart from the old tier letter';out.empty=true;}
  }
  return out;
}

/**
 * Sort the Master List into what will happen to each row. Nothing with a
 * doubt attached is imported without a person choosing.
 */
function mktPlanCreatorImport(records,existingCreators){
  const parsed=(records||[]).map(mktParseMasterRecord);
  const existing=new Set((existingCreators||[]).map(c=>c.ig_handle));
  const groups=new Map();
  const invalid=[],already=[],swapped=[],empty=[];
  parsed.forEach(p=>{
    if(p.empty){empty.push(p);return;}
    if(p.suggestedHandle){
      if(existing.has(p.suggestedHandle))already.push(Object.assign({},p,{handle:p.suggestedHandle}));
      else swapped.push(p);
      return;
    }
    if(p.problem){invalid.push(p);return;}
    if(existing.has(p.handle)){already.push(p);return;}
    (groups.get(p.handle)||groups.set(p.handle,[]).get(p.handle)).push(p);
  });
  const ready=[],duplicates=[];
  groups.forEach((rows,handle)=>{if(rows.length===1)ready.push(rows[0]);else duplicates.push({handle,rows});});
  // A swapped row whose handle also appears correctly elsewhere is a duplicate, not a correction.
  const readyHandles=new Set(ready.map(r=>r.handle).concat(...duplicates.map(g=>[g.handle])));
  const swappedFree=swapped.filter(p=>!readyHandles.has(p.suggestedHandle));
  swapped.filter(p=>readyHandles.has(p.suggestedHandle)).forEach(p=>invalid.push(Object.assign({},p,{problem:'handle is in the Name column, and @'+p.suggestedHandle+' is already in this sheet'})));
  return{total:parsed.length,ready,duplicates,invalid,already,swapped:swappedFree,empty,
    unmatchedCities:parsed.filter(p=>p.cityUnmatched&&!p.problem)};
}

/** A sheet date cell (Excel serial, Date, or text) → YYYY-MM-DD, or '' — never a guess. */
function mktSheetDate(v){
  if(v===undefined||v===null||v==='')return'';
  if(v instanceof Date&&!isNaN(v))return _mktDayStr(v.getTime());
  if(typeof v==='number'&&v>20000&&v<80000){
    const ms=Math.round((v-25569)*_MKT_DAY_MS);          // Excel epoch → Unix
    const d=new Date(ms);
    return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
  }
  const s=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const m=/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);   // the sheet's day-first format
  if(m){const dd=+m[1],mm=+m[2];if(mm>=1&&mm<=12&&dd>=1&&dd<=31)return m[3]+'-'+String(mm).padStart(2,'0')+'-'+String(dd).padStart(2,'0');}
  return'';
}
/** A sheet status → one of ours, or '' when it names none of them. */
function mktSheetStatus(v){
  const k=String(v||'').toLowerCase().replace(/[^a-z]/g,'');
  return({confirmed:'confirmed',intransit:'in_transit',transit:'in_transit',shipped:'shipped',dispatched:'shipped',
    contentreceived:'content_received',received:'content_received',posted:'content_received'})[k]||'';
}

/** A monthly tab's rows → dispatches to create, matched to creators by handle. */
function mktPlanDispatchImport(tabName,records,creators,existingDispatches){
  const byHandle=new Map((creators||[]).map(c=>[c.ig_handle,c]));
  const have=new Set((existingDispatches||[]).map(d=>d.id));
  const tabKey=String(tabName).toLowerCase().replace(/[^a-z0-9]+/g,'');
  return (records||[]).map(rec=>{
    const handle=mktNormHandle(rec.ig_handle);
    const c=handle?byHandle.get(handle):null;
    const id='dp_mig_'+tabKey+'_r'+rec._row;
    const link=String(rec.link||'').trim();
    const row={id,tab:tabName,row:rec._row,handle,handleRaw:String(rec.ig_handle||'').trim(),creator_id:c?c.id:'',
      date:mktSheetDate(rec.date),status:mktSheetStatus(rec.status),collection:_mktTrim(rec.collection,80),
      productsNote:_mktTrim(String(rec.products||'').replace(/,\s*$/,''),500),link:/^https?:\/\/\S+$/i.test(link)?link:'',
      linkRejected:!!(link&&!/^https?:\/\/\S+$/i.test(link))};
    row.problem=!handle?'no valid handle':!c?'creator not in the database':have.has(id)?'already imported':'';
    return row;
  });
}

/** What a sheet dispatch row is written as. */
function mktImportDispatchData(r,now,uid){
  return{
    creator_id:r.creator_id,type:'organic',date_of_dispatch:r.date,collection_sent:r.collection,
    products:[],products_note:r.productsNote,status:r.status,link_to_post:r.link,
    logged_by_user_id:uid||null,created_at:now,updated_at:now,updated_by_user_id:uid||null,
    status_updated_at:null,shipped_at:null,content_received_at:null,
    paid_pr_request_id:null,has_discount_code:false,discount_code_id:null,
    performance_captured_at:null,performance_views:null,performance_likes:null,
    performance_comments:null,performance_saves:null,performance_story_replies:null,
    imported_from:MKT_IMPORT_SOURCE,import_ref:r.tab+' row '+r.row
  };
}

// ── Page ────────────────────────────────────────────────────────────────
function renderMarketingImport(){
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())
    return'<div class="empty">The importer is limited to the owners and the Creator &amp; Content Operations Lead.</div>';
  if(!mktCreatorsLoaded||!mktDispatchesLoaded)
    return`<div class="page-head"><div class="page-title">Import from the sheet</div></div><div class="card">The creator list and dispatch log have to load first, so nothing already imported is imported twice. <button class="btn-outline" onclick="window.mktRetryLoad()">Retry</button></div>`;
  const back=`<button class="btn-outline" onclick="window.showPage('mkt-creators')">← Creator Database</button>`;
  const head=`<div class="page-head mkt-head"><div><div class="page-title">Import from the sheet</div>
    <div class="page-sub">Content Tracker 2026 → The Sales Team ▸ Marketing · safe to run again</div></div><div class="mkt-actions">${back}</div></div>`;
  const pick=`<div class="card">
    <div class="card-title">1 · Choose the file</div>
    <div class="mkt-note" style="margin-bottom:10px">The Excel export of the Content Tracker 2026 sheet (File → Download → Microsoft Excel). It is read here in the browser; nothing is written until you press Import.</div>
    <input type="file" id="mkt-imp-file" accept=".xlsx,.xls" onchange="window.mktImportRead(this)" ${_mktImport&&_mktImport.running?'disabled':''}>
    ${_mktImport&&_mktImport.error?`<div class="mkt-error">${_mktEsc(_mktImport.error)}</div>`:''}
  </div>`;
  if(!_mktImport||!_mktImport.plan)return head+pick;
  const p=_mktImport.plan;
  const choices=_mktImport.choices;
  const dupChosen=p.duplicates.filter(g=>choices[g.handle]).length;
  const accepted=p.swapped.filter(x=>_mktImport.accept[x.row]).length;
  const toAdd=_mktImportCreatorsToWrite().length;
  const disp=_mktImport.dispatches;
  const dReady=disp.filter(r=>!r.problem);
  const list=(rows,fmt)=>rows.length?`<div class="mkt-implist">${rows.slice(0,200).map(fmt).join('')}</div>${rows.length>200?`<div class="mkt-note">…and ${rows.length-200} more.</div>`:''}`:'<div class="mkt-note">None.</div>';
  const rowLabel=r=>`<div class="mkt-improw"><span class="mkt-muted">row ${r.row}</span><span>${_mktEsc(r.handle?'@'+r.handle:r.handleRaw||'(blank)')}</span><span>${_mktEsc(r.name||'')}</span><span class="mkt-muted">${_mktEsc([r.city,r.phone].filter(Boolean).join(' · '))}</span></div>`;
  return head+pick+`
    <div class="card">
      <div class="card-title">2 · Check what will happen — ${_mktEsc(_mktImport.fileName)}</div>
      <div class="mkt-stats">
        <div class="mkt-stat"><span class="mkt-stat-label">Master List rows</span><span class="mkt-stat-val">${p.total}</span><span class="mkt-stat-sub">with any content</span></div>
        <div class="mkt-stat"><span class="mkt-stat-label">Will be added</span><span class="mkt-stat-val">${toAdd}</span><span class="mkt-stat-sub">score and tier left empty</span></div>
        <div class="mkt-stat"><span class="mkt-stat-label">Needs your decision</span><span class="mkt-stat-val">${p.duplicates.length-dupChosen+p.swapped.length-accepted}</span><span class="mkt-stat-sub">duplicates · handles in the Name column</span></div>
        <div class="mkt-stat"><span class="mkt-stat-label">Skipped</span><span class="mkt-stat-val">${p.already.length+p.invalid.length+p.empty.length}</span><span class="mkt-stat-sub">${p.already.length} already in · ${p.invalid.length} unusable · ${p.empty.length} empty</span></div>
      </div>
      <div class="mkt-section"><div class="mkt-section-title">Duplicate handles — pick the row to keep (${p.duplicates.length})</div>
        ${p.duplicates.length?p.duplicates.map((g,gi)=>`<div class="mkt-dupe"><div class="mkt-name">@${_mktEsc(g.handle)}</div>
          ${g.rows.map(r=>`<label class="mkt-dupe-opt"><input type="radio" name="mkt-dupe-${gi}" data-h="${_mktEsc(g.handle)}" value="${r.row}" ${String(choices[g.handle])===String(r.row)?'checked':''} onchange="window.mktImportChoose(this.dataset.h,this.value)">
            <span>Row ${r.row}: ${_mktEsc([r.name,r.niche.join(', '),r.city,r.phone,r.address,[r.top_size,r.bottom_size].filter(Boolean).join('/')].filter(Boolean).join(' · ')||'(nothing but the handle)')}</span></label>`).join('')}
          <label class="mkt-dupe-opt"><input type="radio" name="mkt-dupe-${gi}" data-h="${_mktEsc(g.handle)}" value="" ${!choices[g.handle]?'checked':''} onchange="window.mktImportChoose(this.dataset.h,'')"><span>Don't import this handle yet</span></label>
        </div>`).join(''):'<div class="mkt-note">None — every handle in the sheet is unique.</div>'}
      </div>
      <div class="mkt-section"><div class="mkt-section-title">Handle typed in the Name column — confirm each (${p.swapped.length})</div>
        ${p.swapped.length?`<div class="mkt-implist">${p.swapped.map(r=>`<label class="mkt-dupe-opt" style="padding:6px 10px"><input type="checkbox" data-row="${r.row}" ${_mktImport.accept[r.row]?'checked':''} onchange="window.mktImportAccept(this.dataset.row,this.checked)">
          <span>Row ${r.row}: import <b>@${_mktEsc(r.suggestedHandle)}</b> (the Name cell reads "${_mktEsc(r.name)}"), with the name left empty</span></label>`).join('')}</div>`:'<div class="mkt-note">None.</div>'}
      </div>
      <div class="mkt-section"><div class="mkt-section-title">Rows that cannot be imported (${p.invalid.length})</div>
        ${list(p.invalid,r=>`<div class="mkt-improw"><span class="mkt-muted">row ${r.row}</span><span>${_mktEsc(r.handleRaw||'(blank)')}</span><span class="mkt-pay-unpaid">${_mktEsc(r.problem)}</span><span>${_mktEsc(r.name)}</span></div>`)}
        <div class="mkt-note">Fix these in the sheet or add them by hand.${p.empty.length?' Also skipped: '+p.empty.length+' rows holding nothing but the old tier letter (rows '+p.empty.map(r=>r.row).join(', ')+').':''}</div></div>
      <div class="mkt-section"><div class="mkt-section-title">Cities not on the list — kept as typed (${p.unmatchedCities.length})</div>
        ${list(p.unmatchedCities,r=>`<div class="mkt-improw"><span class="mkt-muted">row ${r.row}</span><span>@${_mktEsc(r.handle)}</span><span>"${_mktEsc(r.cityRaw)}"</span><span class="mkt-muted">pick the right one later in the creator form</span></div>`)}</div>
      <div class="mkt-section"><div class="mkt-section-title">Will be added (${p.ready.length})</div>${list(p.ready,rowLabel)}</div>
      <div class="mkt-section"><div class="mkt-section-title">Monthly tabs → dispatches (${disp.length} rows)</div>
        ${list(disp,r=>`<div class="mkt-improw"><span class="mkt-muted">${_mktEsc(r.tab)} · row ${r.row}</span><span>${_mktEsc(r.handle?'@'+r.handle:r.handleRaw||'(blank)')}</span><span>${_mktEsc(r.collection||'—')}</span><span class="${r.problem?'mkt-pay-unpaid':'mkt-muted'}">${_mktEsc(r.problem||[r.date?'dated '+r.date:'no date',r.status?_mktDispStatusLabel(r.status):'no status'].join(' · '))}</span></div>`)}
        <div class="mkt-note">Date and status stay blank where the sheet has none. The product text is kept as a note; pick the real products from the catalog when editing the dispatch. A dispatch whose creator is imported in this same run is matched after the creators land.</div></div>
    </div>
    <div class="card">
      <div class="card-title">3 · Import</div>
      ${_mktImport.running?`<div class="mkt-improgress" id="mkt-imp-progress" aria-live="polite">${_mktEsc(_mktImport.progress||'Working…')}</div>`:''}
      ${_mktImport.log||_mktImport.running?`<div class="mkt-implog">${_mktImport.log||''}</div>`:''}
      <button class="btn-outline mkt-primary" id="mkt-imp-go" ${_mktImport.running?'disabled':''} onclick="window.mktImportRun()">${_mktImport.running?'Importing…':'Import '+toAdd+' creator'+(toAdd===1?'':'s')+', then their dispatches'}</button>
    </div>
    <div style="height:80px"></div>`;
}

window.mktImportRead=function(input){
  const f=input&&input.files&&input.files[0];
  if(!f)return;
  if(typeof XLSX==='undefined'){_mktImport={error:'The spreadsheet reader did not load — refresh the page and try again.'};_mktRerenderPage();return;}
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array',cellDates:true});
      mktImportFromWorkbook(wb,f.name);
    }catch(e){_mktImport={error:'That file could not be read as a spreadsheet: '+((e&&e.message)||e)};}
    _mktRerenderPage();
  };
  reader.onerror=()=>{_mktImport={error:'The file could not be opened.'};_mktRerenderPage();};
  reader.readAsArrayBuffer(f);
};

/** Build the preview from a parsed workbook. Separate from the file reading so it can be tested. */
function mktImportFromWorkbook(wb,fileName){
  const sheetRows=name=>XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:''});
  const master=(wb.SheetNames||[]).find(n=>/^master\s*list$/i.test(n.trim()));
  if(!master){_mktImport={error:'No "Master List" tab in that file. Found: '+(wb.SheetNames||[]).join(', ')};return;}
  const masterRecords=mktRowsToRecords(sheetRows(master));
  const monthTabs=(wb.SheetNames||[]).filter(n=>_MKT_MONTH_TABS.test(n.trim()));
  _mktImport={fileName,masterRecords,plan:null,choices:{},accept:{},monthTabs,
    monthRecords:monthTabs.map(t=>({tab:t,records:mktRowsToRecords(sheetRows(t))})),running:false,log:''};
  _mktImportReplan();
}

// The plan is always rebuilt from the sheet's records and the database as
// it stands, so it can never drift from either — before a run and after.
// Dispatches are planned against the creators that exist PLUS the ones this
// import is about to add, so a Sep row for a new creator is shown as ready.
function _mktImportReplan(){
  if(!_mktImport||!_mktImport.masterRecords)return;
  const p=mktPlanCreatorImport(_mktImport.masterRecords,mktCreators);
  _mktImport.plan=p;
  Object.keys(_mktImport.choices).forEach(h=>{if(!p.duplicates.some(g=>g.handle===h))delete _mktImport.choices[h];});
  Object.keys(_mktImport.accept).forEach(r=>{if(!p.swapped.some(x=>String(x.row)===r))delete _mktImport.accept[r];});
  const incoming=_mktImportCreatorsToWrite().map(r=>({id:'(new)',ig_handle:r.handle}));
  const pool=mktCreators.concat(incoming);
  const heldBack=new Set(p.duplicates.map(g=>g.handle).filter(h=>!_mktImport.choices[h])
    .concat(p.swapped.filter(x=>!_mktImport.accept[x.row]).map(x=>x.suggestedHandle)));
  _mktImport.dispatches=[].concat(..._mktImport.monthRecords.map(m=>mktPlanDispatchImport(m.tab,m.records,pool,mktDispatches)))
    .map(r=>r.problem==='creator not in the database'&&heldBack.has(r.handle)?Object.assign(r,{problem:'creator is held back above — resolve it first'}):r);
}
function _mktImportCreatorsToWrite(){
  const p=_mktImport.plan;
  const chosen=p.duplicates.map(g=>{const row=_mktImport.choices[g.handle];return row?g.rows.find(r=>String(r.row)===String(row)):null;}).filter(Boolean);
  // An accepted correction imports the Name cell as the handle and leaves the
  // name EMPTY — that cell held a handle, not a name.
  const fixed=p.swapped.filter(x=>_mktImport.accept[x.row]).map(x=>Object.assign({},x,{handle:x.suggestedHandle,name:'',problem:''}));
  return p.ready.concat(chosen,fixed);
}
window.mktImportChoose=function(handle,row){
  if(!_mktImport||_mktImport.running)return;
  if(row)_mktImport.choices[handle]=row;else delete _mktImport.choices[handle];
  _mktImportReplan();
  _mktRerenderPage();
};
window.mktImportAccept=function(row,on){
  if(!_mktImport||_mktImport.running)return;
  if(on)_mktImport.accept[row]=true;else delete _mktImport.accept[row];
  _mktImportReplan();
  _mktRerenderPage();
};

// Creators are written 100 at a time: each batch holds the creator AND its
// handle lock, which firestore.rules checks together (getAfter), so a batch
// is exactly as safe as the one-by-one transaction. It is also ~100× fewer
// round trips — the first live run wrote one transaction per creator, and
// 245 of them behind the app's blocking "Saving…" box looked like a hang.
// If a batch is refused (a handle taken meanwhile, a rules problem), that
// batch alone falls back to one transaction per creator, so the rest still
// land and each failure is named.
const _MKT_IMPORT_CHUNK=100;
async function mktImportWriteCreators(list,onStep){
  let added=0,skipped=0,failed=0;
  const errors=[];
  for(let i=0;i<list.length;i+=_MKT_IMPORT_CHUNK){
    const chunk=list.slice(i,i+_MKT_IMPORT_CHUNK);
    let batchOk=false;
    try{
      const b=writeBatch(db);
      chunk.forEach(x=>{
        b.set(doc(db,'creator_handles',x.built.handle),{creatorId:x.built.id,handle:x.built.handle,created_at:x.built.data.date_added});
        b.set(doc(db,'creators',x.built.id),x.built.data);
      });
      await b.commit();
      batchOk=true;
      chunk.forEach(x=>{x.ok=true;});
      added+=chunk.length;
    }catch(e){console.warn('[marketing] import batch refused, retrying one by one',e&&e.message);}
    if(!batchOk){
      for(const x of chunk){
        try{await mktWriteCreator(x.built);x.ok=true;added++;}
        catch(e){
          if(e&&e.code==='mkt/duplicate'){skipped++;errors.push('row '+x.row+' @'+x.built.handle+': already in the database — skipped');}
          else{failed++;errors.push('row '+x.row+' @'+x.built.handle+': '+((e&&e.message)||'failed'));}
        }
        if(onStep)onStep(added,skipped,failed);
      }
    }
    if(onStep)onStep(added,skipped,failed);
  }
  return{added,skipped,failed,errors};
}

window.mktImportRun=async function(){
  if(!_mktImport||_mktImport.running)return;
  if(typeof canAccessMarketing!=='function'||!canAccessMarketing())return;
  const rows=_mktImportCreatorsToWrite();
  if(typeof confirm==='function'&&!confirm('Import '+rows.length+' creator'+(rows.length===1?'':'s')+' into the live database? Handles already there are skipped.'))return;
  _mktImport.running=true;
  _mktImport.log='Starting — '+rows.length+' creator'+(rows.length===1?'':'s')+' to add.<br>';
  _mktImport.progress='';
  _mktRerenderPage();
  // The import reports its own progress; the app's blocking "Saving…" box
  // would only hide it.
  if(typeof window._gvSilentSaveStart==='function')window._gvSilentSaveStart();
  const uid=session&&session.uid;
  const say=t=>{_mktImport.log+=_mktEsc(t)+'<br>';const el=document.querySelector('.mkt-implog');if(el)el.innerHTML=_mktImport.log;};
  const progress=t=>{_mktImport.progress=t;const el=document.getElementById('mkt-imp-progress');if(el)el.textContent=t;};
  let added=0,skipped=0,failed=0,dAdded=0;
  try{
    const list=[];
    for(const r of rows){
      const now=Date.now();
      const built=mktBuildCreatorPayload({ig_handle:r.handle,name:r.name,niche:r.niche,city:r.cityUnmatched?'':r.city,
        address:r.address,phone:r.phone,top_size:r.top_size,bottom_size:r.bottom_size,status:'active'},null,mktScoringConfig,now,uid);
      if(built.error){failed++;say('row '+r.row+' @'+r.handle+': '+built.error);continue;}
      if(r.cityUnmatched)built.data.city=r.city;
      built.data.imported_from=MKT_IMPORT_SOURCE;
      built.data.import_ref='Master List row '+r.row;
      list.push({row:r.row,built});
    }
    progress('Creators: 0 of '+list.length+'…');
    const res=await mktImportWriteCreators(list,(a,sk,f)=>progress('Creators: '+(a+sk+f)+' of '+list.length+'…'));
    added=res.added;skipped=res.skipped;failed+=res.failed;
    res.errors.forEach(say);
    mktCreators=mktCreators.concat(list.filter(x=>x.ok).map(x=>Object.assign({id:x.built.id},x.built.data)));
    say('Creators: '+added+' added, '+skipped+' skipped, '+failed+' failed.');
    // Dispatches, now that every creator this run could add is in.
    const plan=[].concat(..._mktImport.monthRecords.map(m=>mktPlanDispatchImport(m.tab,m.records,mktCreators,mktDispatches)));
    const todo=plan.filter(x=>!x.problem);
    let dFailed=0;
    for(const r of todo){
      progress('Dispatches: '+(dAdded+dFailed)+' of '+todo.length+'…');
      const now=Date.now();
      const data=mktImportDispatchData(r,now,uid);
      const next=mktDispatches.concat([Object.assign({id:r.id},data)]);
      try{
        await mktWriteDispatch({id:r.id,isNew:true,data},mktCreatorRollups(r.creator_id,next,mktPaidPRsLoaded?mktPaidPRs:null),r.creator_id);
        mktDispatches=next;
        mktCreators=mktCreators.map(c=>c.id===r.creator_id?Object.assign({},c,mktCreatorRollups(r.creator_id,next,mktPaidPRsLoaded?mktPaidPRs:null)):c);
        dAdded++;
      }catch(e){dFailed++;say(r.tab+' row '+r.row+': '+((e&&e.message)||'failed'));}
    }
    const notMatched=plan.filter(x=>x.problem&&x.problem!=='already imported').length;
    say('Dispatches: '+dAdded+' added'+(dFailed?', '+dFailed+' failed':'')+(notMatched?', '+notMatched+' not matched to a creator':'')+'.');
    if(typeof logActivity==='function')logActivity('Creators imported','Content Tracker 2026: '+added+' creators, '+dAdded+' dispatches');
  }catch(e){
    console.error('[marketing] import failed',e);
    say('The import stopped: '+((e&&e.message)||'unknown error')+'. What was saved stays saved; run it again to finish.');
  }finally{
    if(typeof window._gvSilentSaveStop==='function')window._gvSilentSaveStop();
    _mktImport.running=false;
    _mktImport.progress='';
    const log=_mktImport.log;
    // Re-plan against the new state, so the preview now shows everything as done.
    _mktImport.choices={};_mktImport.accept={};
    _mktImportReplan();
    _mktImport.log=log;
    _mktRerenderPage();
  }
  showToast('Import finished — '+added+' creators, '+dAdded+' dispatches');
};

// ════════════════════════════════════════════════════════════════════════
// M4 — discount codes
// ════════════════════════════════════════════════════════════════════════
// Codes are created ONLY by netlify/functions/marketing-discounts.js — it
// holds the Shopify secret and is the only writer of discount_codes and of a
// dispatch's has_discount_code / discount_code_id (firestore.rules deny the
// client all three). The page asks; the server checks the caller and does it.
//
// Paid PR: a code is created as part of approval — no opt-out. If that call
// fails, the approval still stands and the dispatch offers "Create the code"
// to retry. Organic: the lead's call, per dispatch, from the same button.
// Redemptions and revenue are filled in by the nightly rollup
// (marketing-code-rollup.js) and can be refreshed on demand from Reports.

const MKT_CODE_ENDPOINT='/.netlify/functions/marketing-discounts';
let mktCodes=[];
let mktCodesLoaded=false;
let _mktCodesMeta=null;        // {last_run_at}
let _mktShopifyStatus=null;    // {scopes, missing, canCreate} | {error}
let _mktCodeBusy={};           // dispatchId → true while a create is in flight

/** Codes live now, and PKR redeemed in the current calendar month. Pure. */
function mktCodesSummary(codes,nowMs){
  const d=new Date(nowMs);
  const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  const live=(codes||[]).filter(c=>c.status!=='expired'&&!(Number(c.expires_at)&&nowMs>=Number(c.expires_at))).length;
  const redeemedPkr=(codes||[]).reduce((n,c)=>n+(Number(c.revenue_by_month&&c.revenue_by_month[key])||0),0);
  return{live,redeemedPkr:Math.round(redeemedPkr)};
}
/** Attributed revenue per creator from the codes on one kind of dispatch. Pure. */
function mktRevenueByCreator(codes,type){
  const out={};
  (codes||[]).forEach(c=>{if(type&&c.dispatch_type!==type)return;out[c.creator_id]=(out[c.creator_id]||0)+(Number(c.revenue_attributed_pkr)||0);});
  return out;
}
/** The attributed sales-lift line: one row per coded dispatch. Pure. */
function mktAttributedRows(codes,dispatches,creators){
  const dById=new Map((dispatches||[]).map(d=>[d.id,d]));
  const cById=new Map((creators||[]).map(c=>[c.id,c]));
  return (codes||[]).map(c=>({code:c.code,dispatch:dById.get(c.dispatch_id)||null,creator:cById.get(c.creator_id)||null,
    type:c.dispatch_type,redemptions:Number(c.redemption_count)||0,revenue:Number(c.revenue_attributed_pkr)||0,
    expires:Number(c.expires_at)||null,status:c.status})).sort((a,b)=>b.revenue-a.revenue||b.redemptions-a.redemptions);
}
function _mktCodeFor(d){return d&&d.discount_code_id?mktCodes.find(c=>c.id===d.discount_code_id)||null:null;}

async function mktCallDiscounts(action,extra){
  if(typeof auth==='undefined'||!auth||!auth.currentUser)throw new Error('You are signed out — sign in again.');
  const idToken=await auth.currentUser.getIdToken();
  const res=await fetch(MKT_CODE_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({idToken,action},extra||{}))});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){const e=new Error(data.error||('Request failed ('+res.status+')'));e.status=res.status;e.missing=data.missing;throw e;}
  return data;
}

/** Ask the server for a code; merge the result in. Resolves {code}|{error}, never rejects. */
async function mktCreateCode(dispatchId){
  if(_mktCodeBusy[dispatchId])return{error:'Already creating a code for this dispatch.'};
  _mktCodeBusy[dispatchId]=true;
  try{
    const r=await mktCallDiscounts('create',{dispatchId});
    const code=r.code;
    if(code){
      if(!mktCodes.some(c=>c.id===code.id))mktCodes=mktCodes.concat([code]);
      mktDispatches=mktDispatches.map(d=>d.id===dispatchId?Object.assign({},d,{has_discount_code:true,discount_code_id:code.id}):d);
      if(!r.already)mktCreators=mktCreators.map(c=>c.id===code.creator_id?Object.assign({},c,{lifetime_codes_issued:(Number(c.lifetime_codes_issued)||0)+1}):c);
    }
    return{code,already:!!r.already};
  }catch(e){
    console.warn('[marketing] code create failed',e);
    return{error:(e&&e.message)||'The code could not be created.',status:e&&e.status};
  }finally{delete _mktCodeBusy[dispatchId];}
}

function _mktCodeSectionHTML(d){
  const c=_mktCodeFor(d);
  let body;
  if(c){
    const exp=Number(c.expires_at);
    const expired=c.status==='expired'||(exp&&Date.now()>=exp);
    body=`<div class="mkt-code"><span class="mkt-code-text">${_mktEsc(c.code)}</span>
        <button class="btn-outline" data-code="${_mktEsc(c.code)}" onclick="window.mktCopyCode(this.dataset.code)">Copy</button></div>
      <div class="mkt-perf" style="margin-top:8px">
        <div><span>Status</span><b class="${expired?'mkt-muted':'mkt-up'}">${expired?'Expired':'Live'}</b></div>
        <div><span>${expired?'Ended':'Ends'}</span><b>${_mktWhen(exp)}</b></div>
        <div><span>Redemptions</span><b>${Number(c.redemption_count)||0}</b></div>
        <div><span>Revenue</span><b>${_mktPKR(Number(c.revenue_attributed_pkr)||0)}</b></div>
      </div>
      <div class="mkt-note">${c.value_percent||10}% off, once per customer. Redemptions and revenue update overnight${_mktCodesMeta&&_mktCodesMeta.last_run_at?' — last counted '+_mktWhen(_mktCodesMeta.last_run_at):''}.</div>`;
  }else if(d.has_discount_code){
    body=`<div class="mkt-note">This dispatch has a code, but it is not in the loaded list — refresh the page.</div>`;
  }else{
    const paid=d.type==='paid_pr';
    body=`<div class="mkt-note">${paid?'A Paid PR always gets a code. It is created at approval — if that did not happen, create it here.':'Optional for an organic dispatch: 10% off for the creator’s audience, once per customer, for 20 days.'}</div>
      <button class="btn-outline" style="margin-top:8px" id="mkt-code-btn" data-id="${_mktEsc(d.id)}" ${_mktCodeBusy[d.id]?'disabled':''} onclick="window.mktCreateCodeFor(this.dataset.id)">${_mktCodeBusy[d.id]?'Creating…':paid?'Create the Paid PR code':'Create discount code'}</button>`;
  }
  return`<div class="mkt-section"><div class="mkt-section-title">Discount code</div><div id="mkt-code-box">${body}</div></div>`;
}

window.mktCreateCodeFor=async function(id){
  const d=mktDispatches.find(x=>x.id===id);
  if(!d)return;
  const c=_mktCreatorById(d.creator_id);
  if(typeof confirm==='function'&&!confirm('Create a live Shopify discount code for '+(c?'@'+c.ig_handle:'this creator')+'? 10% off, once per customer, ends in 20 days.'))return;
  const btn=document.getElementById('mkt-code-btn');
  if(btn){btn.disabled=true;btn.textContent='Creating…';}
  const r=await mktCreateCode(id);
  if(r.error){
    _mktFormError('The code was not created: '+r.error);
    if(btn){btn.disabled=false;btn.textContent=d.type==='paid_pr'?'Create the Paid PR code':'Create discount code';}
    return;
  }
  showToast((r.already?'This dispatch already had a code: ':'Code created: ')+r.code.code);
  if(typeof logActivity==='function'&&!r.already)logActivity('Discount code created',(c?'@'+c.ig_handle+' · ':'')+r.code.code);
  const box=document.getElementById('mkt-code-box');
  const nd=mktDispatches.find(x=>x.id===id);
  if(box&&nd)box.parentElement.outerHTML=_mktCodeSectionHTML(nd);
  _mktDispRepaint();
};
window.mktCopyCode=function(code){
  const done=()=>showToast('Copied '+code);
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(code).then(done,()=>showToast('Copy failed — select the code and copy it by hand',true));return;}
  }catch(_){}
  showToast('Copy failed — select the code and copy it by hand',true);
};

// ── Shopify connection (Reports) ────────────────────────────────────────
function _mktShopifyHTML(){
  const s=_mktShopifyStatus;
  let line='<div class="mkt-note">Checks what Shopify has actually granted the app. Codes need <b>write_discounts</b> and <b>read_discounts</b>.</div>';
  if(s&&s.checking)line='<div class="mkt-note">Checking…</div>';
  else if(s&&s.error)line=`<div class="mkt-error">${_mktEsc(s.error)}</div>`;
  else if(s&&s.canCreate)line=`<div class="mkt-note"><b class="mkt-up">Ready</b> — Shopify has granted the discount permissions. Granted: ${_mktEsc((s.scopes||[]).join(', '))}</div>`;
  else if(s)line=`<div class="mkt-error">Missing: ${_mktEsc((s.missing||[]).join(', '))}. Release an app version with these scopes in the Shopify dev dashboard and approve it on the store. Granted now: ${_mktEsc((s.scopes||[]).join(', ')||'none')}</div>`;
  const last=_mktCodesMeta&&_mktCodesMeta.last_run_at?'Redemptions last counted '+_mktWhen(_mktCodesMeta.last_run_at)+'.':'Redemptions have not been counted yet.';
  return`${line}<div class="mkt-note">${last} They are recounted every night at 6:30am.</div>
    <div class="mkt-actions" style="margin-top:8px"><button class="btn-outline" id="mkt-shop-check" onclick="window.mktCheckShopify()">Check Shopify access</button>
    <button class="btn-outline" id="mkt-shop-roll" onclick="window.mktRollupNow()">Recount redemptions now</button></div>`;
}
function _mktShopifyRepaint(){const el=document.getElementById('mkt-rep-shopify');if(el)el.innerHTML=_mktShopifyHTML();}
window.mktCheckShopify=async function(){
  _mktShopifyStatus={checking:true};_mktShopifyRepaint();
  try{_mktShopifyStatus=await mktCallDiscounts('status');}
  catch(e){_mktShopifyStatus={error:'Could not check: '+((e&&e.message)||'unknown error')};}
  _mktShopifyRepaint();
};
window.mktRollupNow=async function(){
  const b=document.getElementById('mkt-shop-roll');if(b){b.disabled=true;b.textContent='Counting…';}
  try{
    const r=await mktCallDiscounts('rollup');
    showToast('Recounted '+r.codes_updated+' code'+(r.codes_updated===1?'':'s'));
    mktCreatorsLoaded=false;
    if(typeof window.showPage==='function')window.showPage(typeof currentPage!=='undefined'?currentPage:'mkt-reports');
  }catch(e){
    showToast('Recount failed: '+((e&&e.message)||'unknown error'),true);
    if(b){b.disabled=false;b.textContent='Recount redemptions now';}
  }
};

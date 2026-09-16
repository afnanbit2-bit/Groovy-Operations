/* Groovy Operations — marketing.js
   The Sales Team ▸ Marketing. Replaces the Content Tracker 2026 Google
   Sheet. Plain global JS (NO modules), loaded via <script src> like every
   other domain file; Firebase globals come from the bootstrap in index.html.

   M1 (Sept 2026): the Creator Database and the scoring engine.
   M2 (Sept 2026): the Dispatch Log — organic dispatches, the Shopify
   product picker, the Day-7 performance capture and creator rollups.
   Paid PR approvals, discount codes and reports land in later milestones —
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
const _MKT_CITY_ALIASES={pindi:'Rawalpindi',isb:'Islamabad',isl:'Islamabad',lhr:'Lahore',khi:'Karachi',swat:'Mingora (Swat)',di_khan:'Dera Ismail Khan','d.i khan':'Dera Ismail Khan','d.g khan':'Dera Ghazi Khan'};

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
    {id:'mkt-dispatches',label:'Dispatch Log',iconName:'box'}
  ];
}

// One entry point for every Marketing page, so js/shared.js dispatches all
// of them with a single `id.startsWith('mkt-')` line and never needs
// touching again when a milestone adds a page.
const _MKT_PAGES={'mkt-creators':()=>renderMarketingCreators(),'mkt-dispatches':()=>renderMarketingDispatches()};
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
  const [cr,cfg,dsp]=await Promise.allSettled([
    getDocs(collection(db,'creators')),
    getDoc(doc(db,'scoring_config','current')),
    getDocs(collection(db,'dispatches'))
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
    product_title:_mktTrim(p.product_title,120),variant_title:_mktTrim(p.variant_title,120)
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
 * When the Day-7 snapshot is due. Counted from content received; a dispatch
 * with no content-received time falls back to shipped, and that fallback is
 * reported as such (spec §8: it is a data-quality signal in itself).
 */
function mktDay7(d,nowMs){
  if(!d)return{state:'none'};
  if(d.performance_captured_at)return{state:'captured'};
  const cr=_mktMs(d.content_received_at),sh=_mktMs(d.shipped_at);
  const anchor=cr!=null?cr:sh;
  if(anchor==null)return{state:'none'};
  const due=anchor+7*_MKT_DAY_MS;
  return{state:nowMs>=due?'due':'waiting',due,basis:cr!=null?'content_received':'shipped'};
}

/**
 * A creator's dispatch rollups, recomputed from every dispatch held for
 * them. Absolute, not incremental: an edited dispatch date can move
 * first/last in either direction, and an increment cannot tell. Paid PR
 * spend and discount-code rollups belong to M3/M4 and are not touched.
 */
function mktCreatorRollups(creatorId,dispatches){
  const mine=(dispatches||[]).filter(d=>d.creator_id===creatorId);
  const days=mine.map(d=>_mktIsoDay(d.date_of_dispatch)).filter(Boolean).sort();
  const delivered=mine.filter(d=>String(d.link_to_post||'').trim()).length;
  return{
    lifetime_organic_dispatches:mine.filter(d=>(d.type||'organic')==='organic').length,
    lifetime_content_delivered:delivered,
    lifetime_fulfillment_rate:mine.length?Math.round(delivered/mine.length*1000)/1000:null,
    first_dispatch_date:days[0]||null,
    last_dispatch_date:days[days.length-1]||null
  };
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
  const k=d.status||'confirmed';
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
  const add=`<button class="btn-outline" data-id="${_mktEsc(c.id)}" onclick="window.mktOpenDispatch('',this.dataset.id)">Log a dispatch to them</button>`;
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
        <div class="field"><label for="mkt-d-status">Status</label><select id="mkt-d-status">${MKT_DISPATCH_STATUSES.map(x=>`<option value="${x.k}"${(d?d.status:'confirmed')===x.k?' selected':''}>${x.label}</option>`).join('')}</select></div>
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
  _mktDraft.products.push({product_id:v.product_id,variant_id:v.variant_id,product_title:v.product_title,variant_title:v.variant_title});
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
  const rollups=_mktCreatorById(creatorId)?mktCreatorRollups(creatorId,nextList):null;
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

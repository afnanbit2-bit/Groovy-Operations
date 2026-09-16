/* Groovy Operations — marketing.js
   The Sales Team ▸ Marketing. Replaces the Content Tracker 2026 Google
   Sheet. Plain global JS (NO modules), loaded via <script src> like every
   other domain file; Firebase globals come from the bootstrap in index.html.

   M1 (this file, Sept 2026): the Creator Database and the scoring engine.
   Dispatch Log, Paid PR approvals, discount codes and reports land in later
   milestones — see "Marketing module" in CLAUDE.md.

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
  return[{id:'mkt-creators',label:'Creator Database',iconName:'people'}];
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
  const [cr,cfg]=await Promise.allSettled([
    getDocs(collection(db,'creators')),
    getDoc(doc(db,'scoring_config','current'))
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
  if(failed.length)_mktLoadErr=failed;
  mktCreatorsLoaded=cr.status==='fulfilled';
  // Names for "added by" — the directory is small and its loader cannot reject.
  if(typeof loadProfiles==='function'&&typeof profilesLoaded!=='undefined'&&!profilesLoaded){
    loadProfiles().then(()=>{if(typeof currentPage!=='undefined'&&currentPage==='mkt-creators')_mktRepaint();}).catch(()=>{});
  }
}

window.mktRetryLoad=function(){
  mktCreatorsLoaded=false;
  if(typeof window.showPage==='function')window.showPage('mkt-creators');
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
  const warn=_mktLoadErr&&_mktLoadErr.length?`<div class="mkt-warn">Scoring settings could not be read, so the default bands are in use until they load. <button class="btn-outline" onclick="window.mktRetryLoad()">Retry</button></div>`:'';
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
  if(m&&typeof currentPage!=='undefined'&&currentPage==='mkt-creators')m.innerHTML=renderMarketingCreators();
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
      <div class="mkt-note">Filled in by the Dispatch Log and Paid PR pages as they ship.</div>
    </div>
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

/* ─────────────────────────────────────────────────────────────────────────
   The Sales Team ▸ Marketing — js/marketing.js (M1: Creator Database)

   What is worth guarding here:
   - the scoring engine, band edge by band edge, because "10k–25k: 15"
     means exactly 10,000 followers scores 15 and an off-by-one there
     silently re-tiers real creators;
   - the engagement floor, which must beat any score;
   - that nothing gets a tier it has no calculable basis for;
   - IG-handle uniqueness at WRITE time, not in the form;
   - who can reach the module, and that the lead role is scoped to it;
   - that firestore.rules and USER_DEFS agree on who the lead is.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {loadApp,suite,ROOT}=require('./harness');

const LS={getItem:()=>null,setItem(){},removeItem(){}};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

function app(opts){
  const o=opts||{};
  return loadApp(Object.assign({
    files:['js/auth.js','js/marketing.js'],
    currentPage:'mkt-creators',
    session:o.session||{uid:'uid-ammar',u:'ammar',name:'Ammar',role:'owner',email:'ammar@groovy.op',canApprovePaidPR:true}
  },o,{globals:Object.assign({localStorage:LS},o.globals||{})}));
}
const J=v=>JSON.stringify(v);

module.exports=async function(){
  const s=suite('marketing');
  const a=app();
  const score=(c,cfg)=>a.run('mktScore('+J(c)+','+J(cfg||null)+')');

  // ── Scoring bands ─────────────────────────────────────────────────────
  s.section('reach bands — a creator scores the band they are BELOW');
  // engagement 0 floor → use likes that give exactly 1% so tier logic is not in play
  const reach=f=>score({follower_count:f,avg_likes:f*0.001,avg_comments:0}).parts.reach;
  s.eq('9,999 followers → 5',reach(9999),5);
  s.eq('exactly 10,000 → 15 (10k–25k)',reach(10000),15);
  s.eq('24,999 → 15',reach(24999),15);
  s.eq('25,000 → 25',reach(25000),25);
  s.eq('50,000 → 33',reach(50000),33);
  s.eq('99,999 → 33',reach(99999),33);
  s.eq('100,000 → 40 (100k+)',reach(100000),40);
  s.eq('2,000,000 → 40',reach(2000000),40);

  s.section('engagement bands — (likes + comments) / followers');
  const eng=(l,c)=>score({follower_count:10000,avg_likes:l,avg_comments:c});
  s.eq('0.9% → 0',eng(80,10).parts.engagement,0);
  s.eq('exactly 1% → 10',eng(80,20).parts.engagement,10);
  s.eq('comments count too: 150 likes + 50 comments = 2% → 20',eng(150,50).parts.engagement,20);
  s.eq('2.99% → 20',eng(299,0).parts.engagement,20);
  s.eq('3% → 30',eng(300,0).parts.engagement,30);
  s.eq('5% → 40',eng(500,0).parts.engagement,40);
  s.eq('engagement_rate is stored as a fraction',eng(150,50).engagement_rate,0.02);

  s.section('view-through bands — avg views / followers');
  const vt=v=>score({follower_count:10000,avg_likes:300,avg_comments:0,avg_views:v});
  s.eq('no view data → 0, not the lowest band',vt(null).parts.view_through,0);
  s.eq('and view_through is null, not 0',vt(null).view_through,null);
  s.eq('0 views is data → 5',vt(0).parts.view_through,5);
  s.eq('49% → 5',vt(4900).parts.view_through,5);
  s.eq('50% → 10',vt(5000).parts.view_through,10);
  s.eq('100% → 15',vt(10000).parts.view_through,15);
  s.eq('200% → 20',vt(20000).parts.view_through,20);

  s.section('tiers and the engagement floor');
  // 120k followers (40) + 5% (40) + 200% views (20) = 100
  const top=score({follower_count:120000,avg_likes:6000,avg_comments:0,avg_views:240000});
  s.eq('a maxed creator scores 100',top.score,100);
  s.eq('and is tier A',top.tier,'A');
  // 10k (15) + 5% (40) + 200% views (20) = exactly 75
  const edge=score({follower_count:10000,avg_likes:500,avg_comments:0,avg_views:20000});
  s.eq('a creator on exactly 75…',edge.score,75);
  s.eq('…is A (A is ≥75)',edge.tier,'A');
  // 30k (25) + 3% (30) + 50% (10) = 65 → B
  s.eq('65 is B',score({follower_count:30000,avg_likes:900,avg_comments:0,avg_views:15000}).tier,'B');
  // 12k (15) + 2% (20) + no views = 35 → C
  s.eq('35 is C',score({follower_count:12000,avg_likes:240,avg_comments:0}).tier,'C');
  // 5k (5) + 1% (10) + 0 = 15 → below
  s.eq('15 is below threshold',score({follower_count:5000,avg_likes:50,avg_comments:0}).tier,'below_threshold');
  // 500k (40) + 0.5% (0) + 300% views (20) = 60 → would be B, floored
  const bought=score({follower_count:500000,avg_likes:2500,avg_comments:0,avg_views:1500000});
  s.eq('a 60-point account under 1% engagement…',bought.score,60);
  s.eq('…is forced to below_threshold',bought.tier,'below_threshold');
  s.ok('and says why',bought.floored===true);
  s.eq('exactly 1% is not floored',score({follower_count:7,avg_likes:0.07,avg_comments:0}).floored,false);

  s.section('no calculable basis → no tier (spec §10)');
  s.eq('an empty creator has no score',score({}).score,null);
  s.eq('and no tier',score({}).tier,null);
  s.eq('followers alone is not enough',score({follower_count:5000}).tier,null);
  s.eq('zero followers cannot divide',score({follower_count:0,avg_likes:1,avg_comments:1}).tier,null);
  s.eq('0 likes and 0 comments IS data (scores, then floors)',score({follower_count:5000,avg_likes:0,avg_comments:0}).tier,'below_threshold');

  s.section('the bands come from scoring_config, not the code');
  const tuned={tier_thresholds:{A:30,B:20,C:10},engagement_floor_override:0};
  s.eq('lowering thresholds re-tiers the same creator',score({follower_count:12000,avg_likes:240,avg_comments:0},tuned).tier,'A');
  s.eq('a stored reach table replaces the default',
    score({follower_count:5000,avg_likes:500,avg_comments:0},{reach_bands:[{max_followers:null,points:7}]}).parts.reach,7);
  s.eq('bands are sorted before use, whatever order they were saved in',
    score({follower_count:12000,avg_likes:0,avg_comments:0},{reach_bands:[{max_followers:null,points:40},{max_followers:50000,points:25},{max_followers:10000,points:5}]}).parts.reach,25);

  s.section('config validation');
  s.eq('the spec defaults are valid',a.run('mktValidateConfig(MKT_DEFAULT_SCORING).length'),0);
  const bad=(patch)=>a.run('mktValidateConfig(Object.assign(JSON.parse(JSON.stringify(MKT_DEFAULT_SCORING)),'+J(patch)+')).length');
  s.ok('thresholds out of order are refused',bad({tier_thresholds:{A:50,B:60,C:25}})>0);
  s.ok('no open-ended reach band is refused',bad({reach_bands:[{max_followers:10000,points:5}]})>0);
  s.ok('two open-ended reach bands are refused',bad({reach_bands:[{max_followers:null,points:5},{max_followers:null,points:9}]})>0);
  s.ok('a blank (NaN) points value is refused',a.run('mktValidateConfig(Object.assign(JSON.parse(JSON.stringify(MKT_DEFAULT_SCORING)),{engagement_bands:[{min_rate:0,points:NaN}]})).length')>0);
  s.ok('a floor of 100% or more is refused',bad({engagement_floor_override:1})>0);

  // ── Normalisers ───────────────────────────────────────────────────────
  s.section('normalisers used by the form and the migration');
  const h=v=>a.run('mktNormHandle('+J(v)+')');
  s.eq('@ and case are stripped',h('@Night_Flarz'),'night_flarz');
  s.eq('a profile URL is reduced to the handle',h('https://www.instagram.com/saritasangrez/?hl=en'),'saritasangrez');
  s.eq('spaces are refused',h('two words'),'');
  s.eq('empty is refused',h(''),'');
  const city=v=>a.run('mktCanonCity('+J(v)+')');
  s.eq('karachi → Karachi',city('karachi'),'Karachi');
  s.eq('KARACHI → Karachi',city('KARACHI'),'Karachi');
  s.eq('pindi → Rawalpindi',city('pindi'),'Rawalpindi');
  s.eq('extra spaces are tolerated',city('  rahim   yar khan '),'Rahim Yar Khan');
  s.eq('a city not on the list is not invented',city('Atlantis'),'');
  s.eq('the list is the sheet\'s 94 cities',a.run('MKT_PK_CITIES.length'),94);
  const niche=v=>J(a.run('mktNormNiche('+J(v)+')'));
  s.eq('a comma string becomes an array',niche('Fashion Creator, Content Creator'),J(['Fashion Creator','Content Creator']));
  s.eq('casing is canonicalised and duplicates dropped',niche('content creator, Content Creator ,BLOGGER'),J(['Content Creator','Blogger']));
  s.eq('an empty string is an empty array',niche(''),J([]));
  const num=v=>a.run('mktNum('+J(v)+')');
  s.eq('12,500 → 12500',num('12,500'),12500);
  s.eq('24.5k → 24500',num('24.5k'),24500);
  s.eq('1.2M → 1200000',num('1.2M'),1200000);
  s.eq('blank → null',num(''),null);
  s.eq('junk → null',num('lots'),null);
  s.eq('negative → null',num(-4),null);

  // ── Payload ───────────────────────────────────────────────────────────
  s.section('building what gets written');
  const build=(form,existing,now)=>a.run('mktBuildCreatorPayload('+J(form)+','+J(existing||null)+',null,'+(now||1000)+',"uid-ammar")');
  s.ok('a handle is required',!!build({name:'X'}).error);
  s.ok('a manual tier needs a reason',/reason/.test(build({ig_handle:'x',tier_override:'A'}).error||''));
  s.ok('a non-number in a metric is refused, not zeroed',/not a number/.test(build({ig_handle:'x',follower_count:'lots'}).error||''));
  s.ok('a city off the list is refused',/city/.test(build({ig_handle:'x',city:'Atlantis'}).error||''));
  const fresh=build({ig_handle:'@New.Creator',name:' Ayesha  K ',niche:['fashion creator','Other'],city:'lahore',follower_count:'12k',avg_likes:'240',avg_comments:'0'});
  s.eq('the handle is normalised',fresh.handle,'new.creator');
  s.ok('a new creator gets a generated id',/^cr_/.test(fresh.id));
  s.eq('who added it is a uid, not a name',fresh.data.added_by_user_id,'uid-ammar');
  s.ok('and no name of the adder is stored anywhere',!/Ammar/.test(J(fresh.data)));
  s.eq('it is scored on the way in',fresh.data.score,35);
  s.eq('and tiered',fresh.data.tier,'C');
  s.eq('lifetime rollups start at zero',fresh.data.lifetime_organic_dispatches,0);
  s.eq('city is stored canonically',fresh.data.city,'Lahore');
  s.eq('name whitespace is tidied',fresh.data.name,'Ayesha K');
  s.eq('niche is canonical',J(fresh.data.niche),J(['Fashion Creator','Other']));
  s.eq('input timestamps are set',fresh.data.follower_count_updated_at,1000);
  const blank=build({ig_handle:'nobody'});
  s.eq('no tiering inputs → tier stays null',blank.data.tier,null);
  s.eq('and score stays null',blank.data.score,null);

  const existing=Object.assign({id:'cr_1'},fresh.data);
  const addrOnly=build(Object.assign({},existing,{address:'House 1',niche:existing.niche,tier_override:''}),existing,2000);
  s.eq('editing an address does not move "followers as of"',addrOnly.data.follower_count_updated_at,1000);
  s.eq('nor "metrics as of"',addrOnly.data.metrics_updated_at,1000);
  s.eq('it keeps its id',addrOnly.id,'cr_1');
  s.ok('and does not reset lifetime rollups',!('lifetime_organic_dispatches' in addrOnly.data));
  s.ok('nor rewrite who added it',!('added_by_user_id' in addrOnly.data));
  const newFollowers=build(Object.assign({},existing,{follower_count:'30000'}),existing,3000);
  s.eq('changing followers moves its timestamp',newFollowers.data.follower_count_updated_at,3000);
  s.eq('and recalculates immediately',newFollowers.data.tier_calculated_at,3000);
  const renamed=build(Object.assign({},existing,{ig_handle:'renamed'}),existing,4000);
  s.eq('a renamed handle remembers the old one, to release its lock',renamed.oldHandle,'new.creator');

  const ov=build(Object.assign({},existing,{tier_override:'A',tier_override_reason:'Strong past sales'}),existing,5000);
  s.eq('a manual tier is what is shown',ov.data.tier,'A');
  s.eq('the formula answer is kept beside it',ov.data.tier_formula,'C');
  s.ok('and it is flagged',ov.data.tier_is_override===true);
  const cleared=build(Object.assign({},existing,ov.data,{tier_override:'',tier_override_reason:''}),Object.assign({id:'cr_1'},ov.data),6000);
  s.eq('clearing the override returns to the formula',cleared.data.tier,'C');
  s.eq('and drops the reason',cleared.data.tier_override_reason,'');

  s.section('recalculating everyone after a scoring change');
  const list=[
    Object.assign({id:'a'},fresh.data),
    Object.assign({id:'b'},ov.data),
    {id:'c',ig_handle:'c',tier:null,score:null,tier_formula:null,engagement_rate:null}
  ];
  const changes=a.run('mktRecalcAll('+J(list)+','+J(tuned)+',9000)');
  const byId={};changes.forEach(c=>byId[c.id]=c.fields);
  s.eq('a formula tier moves with the config',byId.a&&byId.a.tier,'A');
  s.eq('a manual tier does not',byId.b?byId.b.tier:'A','A');
  s.ok('an unscorable creator is not written at all',!byId.c);
  s.eq('re-running with the same config changes nothing',
    a.run('mktRecalcAll(mktRecalcAll('+J(list)+','+J(tuned)+',1).map((c,i)=>Object.assign({},'+J(list)+'.find(x=>x.id===c.id),c.fields)),'+J(tuned)+',2).length'),0);

  s.section('Needs Completion');
  s.eq('a bare import misses all eight',a.run('mktMissingFields({ig_handle:"x"}).length'),8);
  s.eq('0 followers is a value, not a gap',a.run('mktMissingFields({phone:"1",address:"a",top_size:"M",bottom_size:"32",follower_count:0,avg_views:0,avg_likes:0,avg_comments:0}).length'),0);
  const fl=a.run('mktFilteredCreators('+J([{id:'1',ig_handle:'full',phone:'1',address:'a',top_size:'M',bottom_size:'32',follower_count:1,avg_views:1,avg_likes:1,avg_comments:1,tier:'A'},{id:'2',ig_handle:'gap',tier:null}])+',{view:"incomplete"}).map(c=>c.id)');
  s.eq('the view lists only incomplete records',J(fl),J(['2']));
  const tierSort=a.run('mktFilteredCreators('+J([{id:'u',ig_handle:'u'},{id:'c',ig_handle:'c',tier:'C',score:30},{id:'a',ig_handle:'a',tier:'A',score:80}])+',{}).map(c=>c.id)');
  s.eq('the list sorts A first and unscored last',J(tierSort),J(['a','c','u']));
  s.eq('search ignores a leading @',J(a.run('mktFilteredCreators([{id:"1",ig_handle:"night_flarz"},{id:"2",ig_handle:"other"}],{q:"@night"}).map(c=>c.id)')),J(['1']));

  // ── Uniqueness at write time ──────────────────────────────────────────
  s.section('IG-handle uniqueness is enforced in the transaction');
  function txApp(lockOwner){
    const ops=[];
    const t=app({globals:{
      doc:(db,col,id)=>({path:col+'/'+id}),
      runTransaction:async(db,fn)=>{
        const tx={
          get:async ref=>({exists:()=>lockOwner!==null&&ref.path.startsWith('creator_handles/'),data:()=>({creatorId:lockOwner})}),
          set(ref,d){ops.push(['set',ref.path,d]);},
          update(ref,d){ops.push(['update',ref.path,d]);},
          delete(ref){ops.push(['delete',ref.path]);}
        };
        const staged=[];
        await fn(tx);
        return staged;
      }
    }});
    return{t,ops};
  }
  {
    const {t,ops}=txApp('cr_other');
    let err=null;
    await t.run('mktWriteCreator({id:"cr_new",handle:"taken",oldHandle:null,isNew:true,data:{ig_handle:"taken"}})').catch(e=>{err=e;});
    s.eq('a handle owned by another creator throws mkt/duplicate',err&&err.code,'mkt/duplicate');
    s.eq('naming the owner',err&&err.otherId,'cr_other');
    s.eq('and nothing is written',ops.length,0);
  }
  {
    const {t,ops}=txApp(null);
    await t.run('mktWriteCreator({id:"cr_new",handle:"free",oldHandle:null,isNew:true,data:{ig_handle:"free"}})');
    s.eq('a free handle writes the lock and the creator together',J(ops.map(o=>o[0]+' '+o[1])),J(['set creator_handles/free','set creators/cr_new']));
    s.eq('the lock names its creator',ops[0][2].creatorId,'cr_new');
  }
  {
    const {t,ops}=txApp('cr_1');
    await t.run('mktWriteCreator({id:"cr_1",handle:"same",oldHandle:"same",isNew:false,data:{ig_handle:"same"}})');
    s.eq('re-saving with its own handle does not touch the lock',J(ops.map(o=>o[0]+' '+o[1])),J(['update creators/cr_1']));
  }
  {
    const {t,ops}=txApp(null);
    await t.run('mktWriteCreator({id:"cr_1",handle:"newname",oldHandle:"oldname",isNew:false,data:{ig_handle:"newname"}})');
    s.eq('a rename takes the new lock and releases the old one',J(ops.map(o=>o[0]+' '+o[1])),J(['set creator_handles/newname','delete creator_handles/oldname','update creators/cr_1']));
  }

  // ── Loading and rendering ─────────────────────────────────────────────
  s.section('the loader never rejects');
  {
    const t=app({globals:{getDocs:async()=>{throw new Error('Missing or insufficient permissions');}}});
    let threw=false;
    await t.run('loadMarketingCreators()').catch(()=>{threw=true;});
    s.ok('a refused read resolves',!threw);
    const html=t.run('renderMarketingCreators()');
    s.ok('and renders an error card that names the rules',/rules/.test(html));
    s.ok('with a Retry',/mktRetryLoad/.test(html));
  }
  {
    const t=app({globals:{getDoc:async()=>{throw new Error('denied');},getDocs:async()=>({docs:[{id:'cr_1',data:()=>({ig_handle:'ok',tier:'A'})}]})}});
    await t.run('loadMarketingCreators()');
    const html=t.run('renderMarketingCreators()');
    s.ok('a failed config read still shows the creators',/@ok/.test(html));
    s.ok('with a warning that defaults are in use',/default bands/.test(html));
  }

  s.section('stored text is escaped');
  {
    const t=app({globals:{getDocs:async()=>({docs:[{id:'cr_x',data:()=>({ig_handle:'x',name:'<img src=x onerror=alert(1)>',city:'<b>',niche:['<script>'],tier:'A',tier_is_override:true,tier_override_reason:'"><script>'})}]})}});
    await t.run('loadMarketingCreators()');
    const html=t.run('renderMarketingCreators()');
    s.ok('no raw tag from a creator reaches the page',!/<img src=x|<script>|<b>/.test(html));
    s.ok('the name is shown escaped',/&lt;img src=x/.test(html));
    s.ok('a manual tier is visibly marked',/mkt-override/.test(html));
  }

  // ── Permissions ───────────────────────────────────────────────────────
  s.section('who can reach the module');
  const as=(sess)=>app({session:sess});
  s.ok('an owner can',as({uid:'1',u:'afnan',role:'owner'}).run('canAccessMarketing()'));
  s.ok('the lead role can',as({uid:'2',u:'daniyal',role:'creator_content_ops_lead'}).run('canAccessMarketing()'));
  s.ok('a manager cannot',!as({uid:'3',u:'mustafa',role:'manager'}).run('canAccessMarketing()'));
  s.ok('a worker cannot',!as({uid:'4',u:'haris',role:'worker'}).run('canAccessMarketing()'));
  s.ok('a manager sees no Marketing nav',as({uid:'3',u:'mustafa',role:'manager'}).run('mktNavItems().length')===0);
  s.ok('and the page refuses them',/limited to/.test(as({uid:'3',u:'mustafa',role:'manager'}).run('renderMarketingCreators()')));

  s.section('Paid PR approval is a flag on the account, not a name or a role');
  {
    const defs=a.run('USER_DEFS');
    const approvers=defs.filter(d=>d.canApprovePaidPR===true).map(d=>d.u);
    s.eq('exactly one account carries it today',J(approvers),J(['ammar']));
    const ownerNoFlag=as({uid:'1',u:'afnan',role:'owner'});
    s.ok('the other owner does not approve',!ownerNoFlag.run('canApprovePaidPR()'));
    s.ok('the flag, not the username, is what counts',as({uid:'9',u:'someone',role:'owner',canApprovePaidPR:true}).run('canApprovePaidPR()'));
    s.ok('the lead does not approve',!as({uid:'2',u:'daniyal',role:'creator_content_ops_lead'}).run('canApprovePaidPR()'));
    s.ok('no approval check reads a username',!/canApprovePaidPR[^\n]*session\.u\b/.test(read('js/auth.js')));
  }

  s.section('USER_DEFS and firestore.rules agree on the lead');
  {
    const defs=a.run('USER_DEFS');
    const leads=defs.filter(d=>d.role==='creator_content_ops_lead');
    s.eq('Daniyal holds the role',J(leads.map(d=>d.u)),J(['daniyal']));
    s.eq('with the confirmed login email',leads[0]&&leads[0].email,'daniyaltufail59@gmail.com');
    const rules=read('firestore.rules');
    const m=/function isContentOpsLead\(\)\s*\{[^}]*\[([^\]]*)\]/.exec(rules);
    const ruleEmails=m?(m[1].match(/'([^']+)'/g)||[]).map(x=>x.replace(/'/g,'')).sort():[];
    s.eq('every lead email is in isContentOpsLead(), and nothing else is',J(ruleEmails),J(leads.map(d=>d.email).sort()));
    s.ok('a creator write needs its handle lock to point back at it',/getAfter\(creatorHandlePath\(request\.resource\.data\.ig_handle\)\)\.data\.creatorId == id/.test(rules));
    s.ok('a handle lock can never be taken over',/match \/creator_handles\/\{handle\}[\s\S]*?allow update: if false;/.test(rules));
    s.ok('only owners delete creators',/match \/creators\/\{id\}[\s\S]*?allow delete: if isOwner\(\);/.test(rules));
  }

  // ── Nav + scoping (needs the real router) ─────────────────────────────
  s.section('the lead is scoped to the Sales Team and Inventory Intel');
  {
    const full=loadApp({files:['js/shared.js','js/auth.js','js/marketing.js'],currentPage:'mkt-creators',globals:{localStorage:LS,
      // buildNav's owner path asks helpers that live in hrm.js/embellishments.js.
      _canViewPayroll:()=>false,_canViewHRMOps:()=>false,isPrintWorker:()=>false,canManageRecipes:()=>false,isQCWorker:()=>false}});
    const go=(sess,ids)=>{
      full.run('session='+J(sess));
      full.run('renderPage=function(id){globalThis.__got=id;}');
      const out={};
      ids.forEach(id=>{full.run('globalThis.__got=null');full.run('window.showPage('+J(id)+')');out[id]=full.run('__got');});
      return out;
    };
    const lead={uid:'2',u:'daniyal',name:'Daniyal Tufail',role:'creator_content_ops_lead',email:'daniyaltufail59@gmail.com'};
    const r=go(lead,['dashboard','hrm-payroll','po-registry','mkt-creators','shopify-intel','profile','bug-tracker']);
    s.eq('the dashboard is scoped away',r['dashboard'],'mkt-creators');
    s.eq('so is payroll',r['hrm-payroll'],'mkt-creators');
    s.eq('so is the PO registry',r['po-registry'],'mkt-creators');
    s.eq('the Creator Database opens',r['mkt-creators'],'mkt-creators');
    s.eq('Inventory Intel opens (view-only page)',r['shopify-intel'],'shopify-intel');
    s.eq('the avatar still reaches Profile',r['profile'],'profile');
    s.eq('and the bug tracker',r['bug-tracker'],'bug-tracker');
    const o=go({uid:'1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op'},['dashboard','mkt-creators','hrm-payroll']);
    s.ok('an owner is redirected nowhere',Object.keys(o).every(k=>o[k]===k),J(o));

    full.run('session='+J(lead));full.run('buildNav()');
    const side=full.el('sidebar').innerHTML;
    s.ok('the lead sidebar has The Sales Team',/The Sales Team/.test(side));
    s.ok('with Marketing ▸ Creator Database',/Marketing[\s\S]*Creator Database/.test(side));
    s.ok('and Inventory Intel',/Inventory Intel/.test(side));
    s.ok('and nothing else',!/Dashboard|PO Registry|Gate Pass|Payroll/.test(side));
    const mob=full.el('mob-nav').innerHTML;
    s.ok('the phone nav has Creators and Intel',/mkt-creators/.test(mob)&&/shopify-intel/.test(mob));

    full.run('session='+J({uid:'1',u:'afnan',name:'Afnan',role:'owner',email:'afnan@groovy.op',canPO:true}));
    full.run('buildNav()');
    s.ok('an owner sidebar also gets The Sales Team',/The Sales Team[\s\S]*Creator Database/.test(full.el('sidebar').innerHTML));
    full.run('session='+J({uid:'3',u:'mustafa',name:'Mustafa',role:'manager',email:'mustafa@groovy.op',canPO:true}));
    full.run('buildNav()');
    s.ok('a manager sidebar does not',!/The Sales Team/.test(full.el('sidebar').innerHTML));
    s.ok('renderPage dispatches mkt-creators',/id==='mkt-creators'/.test(read('js/shared.js')));
    s.ok('startApp lands the lead on it',/MKT_LEAD_ROLE\)\{[\s\S]{0,200}showPage\('mkt-creators'\)/.test(read('js/auth.js')));
  }

  return s;
};

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
    s.ok('renderPage hands every mkt-* page to mktRenderPage',/id\.startsWith\('mkt-'\)\)\{if\(typeof mktRenderPage==='function'\)mktRenderPage\(id\)/.test(read('js/shared.js')));
    s.ok('the lead phone nav has Dispatches',/mkt-dispatches/.test(mob));
    s.ok('startApp lands the lead on it',/MKT_LEAD_ROLE\)\{[\s\S]{0,200}showPage\('mkt-creators'\)/.test(read('js/auth.js')));
  }

  // ════════════════════════════════════════════════════════════════════
  // M2 — Dispatch Log
  // ════════════════════════════════════════════════════════════════════
  const creators=[
    {id:'cr_a',ig_handle:'st4rr.doll',name:'Starr',status:'active'},
    {id:'cr_b',ig_handle:'benched',status:'do_not_use'}
  ];
  const prod={product_id:'9',variant_id:'101',product_title:'Effortless Tee',variant_title:'Rust / M'};
  const dsp=(form,existing,now)=>a.run('mktBuildDispatchPayload('+J(form)+','+J(existing||null)+','+J(creators)+','+(now||1000)+',"uid-daniyal")');

  s.section('logging a dispatch');
  s.ok('a creator is required',/creator/.test(dsp({date_of_dispatch:'2026-09-16',products:[prod]}).error||''));
  s.ok('an unknown creator is refused',/not in the database/.test(dsp({creator_id:'cr_x',date_of_dispatch:'2026-09-16',products:[prod]}).error||''));
  s.ok('a creator marked Do not use is refused, and says why',/Do not use/.test(dsp({creator_id:'cr_b',date_of_dispatch:'2026-09-16',products:[prod]}).error||''));
  s.ok('a date is required',/date/.test(dsp({creator_id:'cr_a',products:[prod]}).error||''));
  s.ok('a malformed date is refused',/date/.test(dsp({creator_id:'cr_a',date_of_dispatch:'16/09/2026',products:[prod]}).error||''));
  s.ok('at least one catalog product is required',/product/.test(dsp({creator_id:'cr_a',date_of_dispatch:'2026-09-16',products:[]}).error||''));
  s.ok('a product without a variant id (free text) does not count',/product/.test(dsp({creator_id:'cr_a',date_of_dispatch:'2026-09-16',products:[{product_title:'typed by hand'}]}).error||''));
  s.ok('a javascript: link is refused',/https/.test(dsp({creator_id:'cr_a',date_of_dispatch:'2026-09-16',products:[prod],link_to_post:'javascript:alert(1)'}).error||''));
  const nd=dsp({creator_id:'cr_a',date_of_dispatch:'2026-09-16',collection_sent:' Lowkey  Heat ',products:[prod,prod]});
  s.eq('a new dispatch is organic',nd.data.type,'organic');
  s.eq('it points at the creator by id',nd.data.creator_id,'cr_a');
  s.eq('it starts Confirmed',nd.data.status,'confirmed');
  s.eq('who logged it is a uid',nd.data.logged_by_user_id,'uid-daniyal');
  s.ok('the dispatch id is generated',/^dp_/.test(nd.id));
  s.eq('a product picked twice is stored once',nd.data.products.length,1);
  s.eq('products keep their Shopify ids',nd.data.products[0].variant_id,'101');
  s.eq('collection text is tidied',nd.data.collection_sent,'Lowkey Heat');
  s.eq('no discount code by default',nd.data.has_discount_code,false);
  s.eq('performance starts empty',nd.data.performance_views,null);
  s.eq('not shipped yet',nd.data.shipped_at,null);

  s.section('status timestamps');
  const ex=Object.assign({id:nd.id},nd.data);
  const shipped=dsp({status:'shipped',products:[prod]},ex,2000);
  s.eq('reaching Shipped stamps shipped_at',shipped.data.shipped_at,2000);
  s.eq('and status_updated_at',shipped.data.status_updated_at,2000);
  s.ok('an edit never re-writes creator or type (rules keep them immutable)',!('creator_id' in shipped.data)&&!('type' in shipped.data));
  const ex2=Object.assign({},ex,shipped.data);
  const back=dsp({status:'in_transit',products:[prod]},ex2,3000);
  const again=dsp({status:'shipped',products:[prod]},Object.assign({},ex2,back.data),4000);
  s.ok('going back and forward does not reset the first shipped time',!('shipped_at' in again.data));
  const linked=dsp({status:'shipped',products:[prod],link_to_post:'https://www.instagram.com/p/abc/'},ex2,5000);
  s.eq('a post link moves the dispatch to Content received',linked.data.status,'content_received');
  s.ok('and says it did',linked.autoAdvanced===true);
  s.eq('stamping content_received_at',linked.data.content_received_at,5000);
  const skip=dsp({status:'content_received',products:[prod]},ex,6000);
  s.eq('jumping straight to Content received also records shipped',skip.data.shipped_at,6000);
  const unchanged=dsp({status:'confirmed',products:[prod],collection_sent:'x'},ex,7000);
  s.ok('an edit that keeps the status does not touch status_updated_at',!('status_updated_at' in unchanged.data));
  const legacy=dsp({status:'confirmed',products:[]},Object.assign({},ex,{products:[],products_note:'rust effortless, love hurts'}),8000);
  s.ok('a migrated row with only a text note can still be edited',!legacy.error);

  s.section('Day-7 capture');
  const DAY=86400000;
  const d7=(d,now)=>a.run('mktDay7('+J(d)+','+now+')');
  s.eq('nothing shipped → nothing due',d7({status:'confirmed'},10*DAY).state,'none');
  s.eq('counted from content received',d7({content_received_at:DAY,shipped_at:0},8*DAY).basis,'content_received');
  s.eq('due exactly 7 days after',d7({content_received_at:DAY},8*DAY).state,'due');
  s.eq('not a moment before',d7({content_received_at:DAY},8*DAY-1).state,'waiting');
  const fb=d7({shipped_at:0},7*DAY);
  s.eq('no content-received date falls back to shipped',fb.basis,'shipped');
  s.eq('and is still due',fb.state,'due');
  s.eq('a captured snapshot is never due',d7({shipped_at:0,performance_captured_at:5},99*DAY).state,'captured');
  s.eq('a Firestore Timestamp is understood',d7({content_received_at:{seconds:1}},7*DAY+1000).state,'due');
  const perf=f=>a.run('mktBuildPerformance('+J(f)+',9000,"uid-daniyal")');
  s.ok('views are required',/views/.test(perf({performance_likes:'10'}).error||''));
  s.ok('junk is refused, not zeroed',/not a number/.test(perf({performance_views:'100',performance_saves:'lots'}).error||''));
  const pv=perf({performance_views:'12.5k',performance_likes:'1,200',performance_comments:'40',performance_saves:'',performance_story_replies:'0'});
  s.eq('12.5k views → 12500',pv.data.performance_views,12500);
  s.eq('1,200 likes → 1200',pv.data.performance_likes,1200);
  s.eq('a blank field stays blank',pv.data.performance_saves,null);
  s.eq('0 is kept as 0',pv.data.performance_story_replies,0);
  s.eq('capture time and person are stamped',pv.data.performance_captured_by_user_id,'uid-daniyal');

  s.section('creator rollups are recomputed, not incremented');
  const rlist=[
    {id:'1',creator_id:'cr_a',type:'organic',date_of_dispatch:'2026-09-01',link_to_post:'https://x'},
    {id:'2',creator_id:'cr_a',type:'organic',date_of_dispatch:'2026-09-10',link_to_post:''},
    {id:'3',creator_id:'cr_a',type:'organic',date_of_dispatch:'',link_to_post:''},
    {id:'4',creator_id:'cr_other',type:'organic',date_of_dispatch:'2026-01-01',link_to_post:'https://y'}
  ];
  const r=a.run('mktCreatorRollups("cr_a",'+J(rlist)+')');
  s.eq('three dispatches',r.lifetime_organic_dispatches,3);
  s.eq('one delivered',r.lifetime_content_delivered,1);
  s.eq('fulfillment rate 1/3',r.lifetime_fulfillment_rate,0.333);
  s.eq('first date ignores the undated row',r.first_dispatch_date,'2026-09-01');
  s.eq('last date',r.last_dispatch_date,'2026-09-10');
  const moved=rlist.map(d=>d.id==='2'?Object.assign({},d,{date_of_dispatch:'2026-08-20'}):d);
  s.eq('an edited date moves last_dispatch_date BACK',a.run('mktCreatorRollups("cr_a",'+J(moved)+')').last_dispatch_date,'2026-09-01');
  s.eq('a creator with nothing sent has no rate',a.run('mktCreatorRollups("cr_z",[])').lifetime_fulfillment_rate,null);

  s.section('the dispatch list');
  const now=Date.parse('2026-09-16T12:00:00');
  const dl=[
    {id:'old',creator_id:'cr_a',date_of_dispatch:'2026-08-02',status:'content_received',products:[{product_title:'Tinted Denim',variant_title:'Blue'}]},
    {id:'new',creator_id:'cr_a',date_of_dispatch:'2026-09-15',status:'shipped',shipped_at:now-8*DAY,products:[]},
    {id:'nodate',creator_id:'cr_b',date_of_dispatch:'',status:'confirmed',products:[]},
    {id:'transit',creator_id:'cr_b',date_of_dispatch:'2026-09-14',status:'in_transit',products:[]}
  ];
  const fd=f=>a.run('mktFilteredDispatches('+J(dl)+','+J(creators)+','+J(Object.assign({now},f))+').map(d=>d.id)');
  s.eq('newest first, undated last',J(fd({})),J(['new','transit','old','nodate']));
  s.eq('awaiting content = in transit or shipped',J(fd({status:'awaiting'})),J(['new','transit']));
  s.eq('Day-7 due',J(fd({status:'day7'})),J(['new']));
  s.eq('a month',J(fd({month:'2026-08'})),J(['old']));
  s.eq('a rolling window',J(fd({since:'2026-09-10'})),J(['new','transit']));
  s.eq('search reaches product titles',J(fd({q:'tinted'})),J(['old']));
  s.eq('and creator handles',J(fd({q:'@benched'})),J(['transit','nodate']));

  s.section('the catalog picker');
  const v=a.run('mktVariantFromDoc(101,{product_id:9,product_title:"Effortless Tee",color:"Rust",size:"M",option3:"",sku:"GP01-R-M",status:"active"})');
  s.eq('a variant title is colour / size',v.variant_title,'Rust / M');
  s.eq('ids are strings',v.variant_id,'101');
  s.eq('the "Default Title" placeholder is not shown as a variant',a.run('mktVariantFromDoc(1,{product_title:"Cap",color:"Default Title"})').variant_title,'');
  const cat=[
    {variant_id:'1',product_title:'Effortless Tee',variant_title:'Rust / M',sku:'A',status:'active'},
    {variant_id:'2',product_title:'Effortless Tee',variant_title:'Blue / M',sku:'B',status:'draft'},
    {variant_id:'3',product_title:'Old Tee',variant_title:'Rust / M',sku:'C',status:'archived'}
  ];
  const cs=q=>J(a.run('mktCatalogSearch('+J(cat)+','+J(q)+',30).map(x=>x.variant_id)'));
  s.eq('every word must match',cs('effortless rust'),J(['1']));
  s.eq('archived products are left out',cs('rust'),J(['1']));
  s.eq('drafts are offered',cs('blue'),J(['2']));
  s.eq('an empty query lists nothing',cs('  '),J([]));
  {
    const t=app({globals:{getDocs:async()=>{throw new Error('denied');},getDoc:async()=>({exists:()=>false})}});
    await t.run('_mktLoadCatalog()');
    s.ok('a failed catalog read says so on the picker',/could not be loaded/.test(t.run('_mktCatalogNoteHTML()')));
    const t2=app({globals:{getDocs:async()=>({docs:[{id:'1',data:()=>({product_title:'Tee',status:'active'})}]}),
      getDoc:async()=>({exists:()=>true,data:()=>({last_success_at:{seconds:Math.floor((Date.now()-40*3600000)/1000)}})})}});
    await t2.run('_mktLoadCatalog()');
    const note=t2.run('_mktCatalogNoteHTML()');
    s.ok('the picker always says how old its catalog is',/Catalog as of/.test(note));
    s.ok('and flags a copy older than a day',/more than a day old/.test(note));
  }

  s.section('writing a dispatch is one batch with the creator rollups');
  {
    const t=app({globals:{doc:(db,col,id)=>({path:col+'/'+id})}});
    await t.run('mktWriteDispatch({id:"dp_1",isNew:true,data:{type:"organic"}},{lifetime_organic_dispatches:1},"cr_a")');
    const b=t.state.batches;
    s.eq('one batch',b.length,1);
    s.eq('holding the dispatch and the creator',J(b[0].map(o=>o.op)),J(['set','update']));
    await t.run('mktWriteDispatch({id:"dp_1",isNew:false,data:{status:"shipped"}},null,"cr_a")');
    s.eq('an edit updates rather than overwrites',t.state.batches[1][0].op,'update');
  }

  s.section('loading and rendering the log');
  {
    const t=app({globals:{getDocs:async()=>{throw new Error('denied');}}});
    await t.run('loadMarketingCreators()');
    s.ok('a refused dispatch read shows the rules card',/could not be loaded/.test(t.run('renderMarketingDispatches()')));
  }
  {
    const t=app({globals:{collection:(db,name)=>({name}),getDocs:async(ref)=>{if(ref.name==='dispatches')throw new Error('denied');return{docs:[{id:'cr_1',data:()=>({ig_handle:'ok'})}]};}}});
    await t.run('loadMarketingCreators()');
    const html=t.run('renderMarketingCreators()');
    s.ok('a refused dispatch read does not take the Creator Database down',/@ok/.test(html));
    s.ok('nor raise the scoring-settings warning',!/default bands/.test(html));
  }
  {
    const docs={
      creators:[{id:'cr_a',data:()=>({ig_handle:'st4rr.doll',name:'<b>Starr</b>'})}],
      dispatches:[{id:'dp_1',data:()=>({creator_id:'cr_a',type:'organic',date_of_dispatch:'2026-09-15',status:'shipped',collection_sent:'<img src=x onerror=1>',link_to_post:'https://www.instagram.com/p/a"onmouseover="x',products:[{product_title:'<script>',variant_title:''}]})}]
    };
    const t=app({globals:{collection:(db,name)=>({name}),getDocs:async(ref)=>({docs:docs[ref.name]||[]})}});
    await t.run('loadMarketingCreators()');
    const html=t.run('renderMarketingDispatches()');
    s.ok('the log renders the dispatch',/st4rr\.doll/.test(html));
    s.ok('and escapes everything stored',!/<b>Starr|<img src=x|<script>|"onmouseover/.test(html));
    s.ok('a post link opens in a new tab without an opener',/rel="noopener noreferrer"/.test(html));
    s.eq('every Marketing page is listed in the nav',J(t.run('mktNavItems().map(i=>i.id)')),J(['mkt-creators','mkt-dispatches','mkt-paid-pr']));
    t.run('_mktFilter={q:"",view:"all",tier:"all",status:"all",page:1}');
    const cm=t.run('_mktCreatorDispatchesHTML(mktCreators[0])');
    s.ok('a creator shows their own dispatch history',/Dispatches \(1\)/.test(cm));
  }

  s.section('dispatch rules');
  {
    const rules=read('firestore.rules');
    const blk=(rules.match(/match \/dispatches\/\{id\} \{[\s\S]*?\n    \}/)||[''])[0];
    s.ok('any Marketing account can create an organic dispatch',/allow create: if isMarketing\(\)[\s\S]*type == 'organic'/.test(blk));
    s.ok('against a creator that exists',/exists\(\/databases\/\$\(database\)\/documents\/creators\//.test(blk));
    s.ok('an update cannot move a dispatch to another creator',/creator_id == resource\.data\.creator_id/.test(blk));
    s.ok('or change its type',/type == resource\.data\.type/.test(blk));
    s.ok('only owners delete',/allow delete: if isOwner\(\);/.test(blk));
    const js=read('js/marketing.js');
    const statusesJs=((js.match(/const MKT_DISPATCH_STATUSES=\[([\s\S]*?)\];/)||['',''])[1].match(/k:'([a-z_]+)'/g)||[]).map(x=>x.slice(3,-1));
    const statusesRules=((blk.match(/status in \[([^\]]*)\]/)||['',''])[1].match(/'([a-z_]+)'/g)||[]).map(x=>x.replace(/'/g,''));
    s.ok('the statuses were found',statusesJs.length===4,J(statusesJs));
    s.eq('rules and the app agree on the statuses',J(statusesRules),J(statusesJs));
  }

  // ════════════════════════════════════════════════════════════════════
  // M3 — Paid PR approvals
  // ════════════════════════════════════════════════════════════════════
  const prc=[
    {id:'cr_a',ig_handle:'st4rr.doll',status:'active'},
    {id:'cr_b',ig_handle:'benched',status:'blacklisted'}
  ];
  const prq=(form,existing,now)=>a.run('mktBuildPaidPRRequest('+J(form)+','+J(existing||null)+','+J(prc)+','+(now||1000)+',"uid-daniyal")');

  s.section('requesting a Paid PR');
  s.ok('a creator is required',/creator/.test(prq({deliverable:'1 Reel',proposed_amount_pkr:'45000'}).error||''));
  s.ok('a blacklisted creator is refused',/Blacklisted/.test(prq({creator_id:'cr_b',deliverable:'1 Reel',proposed_amount_pkr:'45000'}).error||''));
  s.ok('a deliverable is required',/deliverable/.test(prq({creator_id:'cr_a',proposed_amount_pkr:'45000'}).error||''));
  s.ok('an amount is required',/amount/.test(prq({creator_id:'cr_a',deliverable:'1 Reel'}).error||''));
  s.ok('zero is not an amount',/amount/.test(prq({creator_id:'cr_a',deliverable:'1 Reel',proposed_amount_pkr:'0'}).error||''));
  s.ok('a runaway amount is questioned',/zeros/.test(prq({creator_id:'cr_a',deliverable:'1 Reel',proposed_amount_pkr:'450000000'}).error||''));
  const nr=prq({creator_id:'cr_a',deliverable:' 1 Reel + 3 story frames ',proposed_amount_pkr:'45k',timeline:'10 days',rationale:'Strong Lowkey Heat fit'});
  s.eq('45k is PKR 45,000',nr.data.proposed_amount_pkr,45000);
  s.eq('a request starts pending',nr.data.status,'pending');
  s.eq('unpaid',nr.data.payment_status,'unpaid');
  s.eq('undecided',nr.data.decided_by_user_id,null);
  s.eq('with no dispatch yet',nr.data.dispatch_id,null);
  s.eq('requested by a uid',nr.data.requested_by_user_id,'uid-daniyal');
  s.ok('the id is generated',/^pr_/.test(nr.id));
  const pending=Object.assign({id:nr.id},nr.data);
  const edit=prq({deliverable:'2 Reels',proposed_amount_pkr:'60000'},pending,2000);
  s.eq('a pending request can be edited',edit.data.proposed_amount_pkr,60000);
  {
    const ed=a.run('(function(){const k=Object.keys('+J(edit.data)+');return k.filter(x=>MKT_PR_EDIT_FIELDS.indexOf(x)<0);})()');
    s.eq('an edit writes only the fields the rules allow',J(ed),J([]));
  }
  s.ok('a decided request cannot be edited',/decided/.test(prq({deliverable:'x',proposed_amount_pkr:'1'},Object.assign({},pending,{status:'approved'})).error||''));

  s.section('deciding — the hard gate');
  const dec=(req,which,reason)=>a.run('mktBuildDecision('+J(req)+','+J(which)+','+J(reason||'')+',3000,"uid-ammar")');
  s.ok('a rejection needs a reason',/why/.test(dec(pending,'rejected','').error||''));
  const rj=dec(pending,'rejected','Budget is spent this month');
  s.eq('a rejection records it',rj.data.rejection_reason,'Budget is spent this month');
  s.ok('and creates no dispatch',!rj.dispatch);
  const ap=dec(pending,'approved');
  s.eq('an approval is recorded',ap.data.status,'approved');
  s.eq('by the approver\'s uid',ap.data.decided_by_user_id,'uid-ammar');
  s.ok('and mints the dispatch it links to',ap.dispatch&&ap.data.dispatch_id===ap.dispatch.id);
  s.eq('a paid_pr dispatch',ap.dispatch.data.type,'paid_pr');
  s.eq('pointing back at the request',ap.dispatch.data.paid_pr_request_id,pending.id);
  s.eq('for the same creator',ap.dispatch.data.creator_id,'cr_a');
  s.eq('entering the flow at Confirmed',ap.dispatch.data.status,'confirmed');
  s.ok('a decided request cannot be decided again',/already/.test(dec(Object.assign({},pending,{status:'approved'}),'rejected','x').error||''));
  {
    const keys=a.run('Object.keys('+J(ap.data)+')');
    const rules=read('firestore.rules');
    const m=/request\.resource\.data\.status in \['approved','rejected'\][\s\S]*?hasOnly\(\[([^\]]*)\]\)/.exec(rules);
    const allowed=m?(m[1].match(/'([a-z_]+)'/g)||[]).map(x=>x.replace(/'/g,'')):[];
    s.ok('the decision rule was found',allowed.length>0,J(allowed));
    s.eq('an approval writes only what the rules allow',J(keys.filter(k=>allowed.indexOf(k)<0)),J([]));
    s.eq('so does a rejection',J(a.run('Object.keys('+J(rj.data)+')').filter(k=>allowed.indexOf(k)<0)),J([]));
  }
  // The client gate follows the flag; the rules gate follows the email.
  {
    const lead=app({session:{uid:'2',u:'daniyal',role:'creator_content_ops_lead',email:'daniyaltufail59@gmail.com'}});
    lead.run("mktPaidPRs=[{id:'pr_1',creator_id:'cr_a',status:'pending',proposed_amount_pkr:1000,deliverable:'x'}];mktCreators=[{id:'cr_a',ig_handle:'a'}];mktDispatches=[];mktPaidPRsLoaded=true");
    lead.run("window.mktOpenPaidPR('pr_1')");
    const html=lead.bodyHtml('mkt-modal-back');
    s.ok('the lead sees no Approve button',!/mktDecidePaidPR/.test(html));
    s.ok('and is told only the approver can decide',/Only the approver/.test(html));
    lead.el('mkt-pr-id').value='pr_1';
    await lead.run("window.mktDecidePaidPR('approved')");
    s.eq('and calling the decision directly writes nothing',lead.state.batches.length,0);
    const own=app();
    own.run("mktPaidPRs=[{id:'pr_1',creator_id:'cr_a',status:'pending',proposed_amount_pkr:1000,deliverable:'x'}];mktCreators=[{id:'cr_a',ig_handle:'a'}];mktDispatches=[];mktPaidPRsLoaded=true");
    own.run("window.mktOpenPaidPR('pr_1')");
    s.ok('the approver does see Approve and Reject',/mktDecidePaidPR\('approved'\)/.test(own.bodyHtml('mkt-modal-back'))&&/mktDecidePaidPR\('rejected'\)/.test(own.bodyHtml('mkt-modal-back')));
    const other=app({session:{uid:'1',u:'afnan',role:'owner',email:'afnan@groovy.op'}});
    other.run("mktPaidPRs=[{id:'pr_1',creator_id:'cr_a',status:'pending',proposed_amount_pkr:1000,deliverable:'x'}];mktCreators=[{id:'cr_a',ig_handle:'a'}];mktDispatches=[];mktPaidPRsLoaded=true");
    other.run("window.mktOpenPaidPR('pr_1')");
    s.ok('the other owner does not',!/mktDecidePaidPR/.test(other.bodyHtml('mkt-modal-back')));
  }
  {
    const t=app({globals:{doc:(db,col,id)=>({path:col+'/'+id})}});
    t.run("mktPaidPRs=[{id:'pr_1',creator_id:'cr_a',status:'pending',proposed_amount_pkr:45000,deliverable:'x'}];mktCreators=[{id:'cr_a',ig_handle:'a'}];mktDispatches=[];mktPaidPRsLoaded=true;mktDispatchesLoaded=true");
    t.el('mkt-pr-id').value='pr_1';
    await t.run("window.mktDecidePaidPR('approved')");
    const b=t.state.batches[0]||[];
    s.eq('approval is ONE batch: decision, dispatch, creator',J(b.map(o=>o.op)),J(['update','set','update']));
    s.eq('the creator gets the paid PR counted',b[2]&&b[2].data.lifetime_paid_prs,1);
    s.eq('and the approved PKR',b[2]&&b[2].data.lifetime_pkr_spent,45000);
    s.eq('the new dispatch is in the log straight away',t.run("mktDispatches.filter(d=>d.type==='paid_pr').length"),1);
    s.ok('and the toast says what happens next',/products and date/.test(t.state.toasts.join(' ')));
    s.eq('an approval asks first',t.state.confirms.length,1);
  }

  s.section('paying — approved is not paid');
  const apr=Object.assign({},pending,ap.data);
  const pay=f=>a.run('mktBuildPayment('+J(apr)+','+J(f)+',4000,"uid-daniyal")');
  s.ok('a pending request cannot be paid',/approved/.test(a.run('mktBuildPayment('+J(pending)+',{payment_status:"paid"},1,"u")').error||''));
  s.ok('paid needs a method',/how/.test(pay({payment_status:'paid',payment_date:'2026-09-16'}).error||''));
  s.ok('paid needs a date',/date/.test(pay({payment_status:'paid',payment_method:'JazzCash'}).error||''));
  const pd=pay({payment_status:'paid',payment_method:'JazzCash',payment_reference:' TXN-1 ',payment_date:'2026-09-16'});
  s.eq('a payment is recorded',pd.data.payment_status,'paid');
  s.eq('with its reference',pd.data.payment_reference,'TXN-1');
  s.eq('and who logged it',pd.data.payment_logged_by_user_id,'uid-daniyal');
  s.eq('marking it unpaid clears the details',pay({payment_status:'unpaid',payment_method:'Cash'}).data.payment_method,'');
  {
    const rules=read('firestore.rules');
    const m=/resource\.data\.status == 'approved'\s*&& request\.resource\.data\.status == 'approved'[\s\S]*?hasOnly\(\[([^\]]*)\]\)/.exec(rules);
    const allowed=m?(m[1].match(/'([a-z_]+)'/g)||[]).map(x=>x.replace(/'/g,'')).sort():[];
    s.eq('the payment fields in the app and the rules are the same list',J(allowed),J(a.run('MKT_PAYMENT_FIELDS.slice().sort()')));
    const e=/resource\.data\.status == 'pending'\s*&& request\.resource\.data\.status == 'pending'[\s\S]*?hasOnly\(\[([^\]]*)\]\)/.exec(rules);
    const eAllowed=e?(e[1].match(/'([a-z_]+)'/g)||[]).map(x=>x.replace(/'/g,'')).sort():[];
    s.eq('and so are the editable request fields',J(eAllowed),J(a.run('MKT_PR_EDIT_FIELDS.slice().sort()')));
    s.ok('an approved amount is not in either list',eAllowed.indexOf('proposed_amount_pkr')>=0&&allowed.indexOf('proposed_amount_pkr')<0);
  }

  s.section('the approval list');
  const now2=Date.parse('2026-09-16T12:00:00');
  const rl=[
    {id:'p_old',creator_id:'cr_a',status:'pending',created_at:100,deliverable:'Reel',proposed_amount_pkr:10000},
    {id:'p_new',creator_id:'cr_a',status:'pending',created_at:200,deliverable:'Story',proposed_amount_pkr:5000},
    {id:'a_sep',creator_id:'cr_a',status:'approved',decided_at:Date.parse('2026-09-02'),payment_status:'unpaid',proposed_amount_pkr:40000,deliverable:'Reel'},
    {id:'a_aug',creator_id:'cr_a',status:'approved',decided_at:Date.parse('2026-08-20'),payment_status:'paid',proposed_amount_pkr:30000,deliverable:'Reel'},
    {id:'r_1',creator_id:'cr_b',status:'rejected',decided_at:Date.parse('2026-09-10'),proposed_amount_pkr:99000,deliverable:'Takeover'}
  ];
  const fl2=f=>J(a.run('mktFilteredPaidPRs('+J(rl)+','+J(prc)+','+J(f)+').map(r=>r.id)'));
  s.eq('pending first, longest-waiting on top, then newest decisions',fl2({}),J(['p_old','p_new','r_1','a_sep','a_aug']));
  s.eq('approved but unpaid',fl2({status:'unpaid'}),J(['a_sep']));
  s.eq('search by deliverable',fl2({q:'takeover'}),J(['r_1']));
  s.eq('approved this month counts by decision date only',a.run('mktApprovedInMonth('+J(rl)+','+now2+')'),40000);
  const rr=a.run('mktCreatorRollups("cr_a",[],'+J(rl)+')');
  s.eq('rollups count approved Paid PRs only',rr.lifetime_paid_prs,2);
  s.eq('and sum their approved PKR',rr.lifetime_pkr_spent,70000);
  s.ok('without the requests, the Paid PR rollups are left alone',!('lifetime_paid_prs' in a.run('mktCreatorRollups("cr_a",[])')));

  s.section('Paid PR rules');
  {
    const rules=read('firestore.rules');
    const approver=(/function isPaidPRApprover\(\)\s*\{[^}]*\[([^\]]*)\]/.exec(rules)||['',''])[1].match(/'([^']+)'/g)||[];
    const defs=a.run('USER_DEFS').filter(d=>d.canApprovePaidPR===true).map(d=>d.email).sort();
    s.eq('isPaidPRApprover() lists exactly the flagged accounts',J(approver.map(x=>x.replace(/'/g,'')).sort()),J(defs));
    const blk=(rules.match(/match \/paid_pr_requests\/\{id\} \{[\s\S]*?\n    \}/)||[''])[0];
    s.ok('a request is created pending, by its requester',/status == 'pending'[\s\S]*requested_by_user_id == request\.auth\.uid/.test(blk));
    s.ok('only the approver decides',/\|\| \(isPaidPRApprover\(\)[\s\S]*status in \['approved','rejected'\]/.test(blk));
    s.ok('only from pending',/isPaidPRApprover\(\)\s*&& resource\.data\.status == 'pending'/.test(blk));
    s.ok('a decided request is never deleted',/allow delete: if isOwner\(\) && resource\.data\.status == 'pending';/.test(blk));
    const dblk=(rules.match(/match \/dispatches\/\{id\} \{[\s\S]*?\n    \}/)||[''])[0];
    s.ok('a paid_pr dispatch can only be created by the approver',/type == 'paid_pr'\s*&& isPaidPRApprover\(\)/.test(dblk));
    s.ok('for a request the same batch approves and links to it',/getAfter\(paidPRPath[\s\S]*status == 'approved'[\s\S]*dispatch_id == id/.test(dblk));
    s.ok('a dispatch cannot be re-pointed at another request',/get\('paid_pr_request_id', null\) == resource\.data\.get\('paid_pr_request_id', null\)/.test(dblk));
  }
  {
    const docs={
      creators:[{id:'cr_a',data:()=>({ig_handle:'st4rr.doll'})}],
      paid_pr_requests:[{id:'pr_x',data:()=>({creator_id:'cr_a',status:'pending',deliverable:'<script>x</script>',proposed_amount_pkr:45000,created_at:1})}]
    };
    const t=app({globals:{collection:(db,name)=>({name}),getDocs:async ref=>({docs:docs[ref.name]||[]})}});
    await t.run('loadMarketingCreators()');
    const html=t.run('renderMarketingPaidPR()');
    s.ok('the page lists the request',/PKR 45,000/.test(html));
    s.ok('and escapes the deliverable',!/<script>x/.test(html));
    const t2=app({globals:{collection:(db,name)=>({name}),getDocs:async ref=>{if(ref.name==='paid_pr_requests')throw new Error('denied');return{docs:docs[ref.name]||[]};}}});
    await t2.run('loadMarketingCreators()');
    s.ok('a refused read shows the rules card',/could not be loaded/.test(t2.run('renderMarketingPaidPR()')));
    s.ok('without taking the Creator Database down',/@st4rr\.doll/.test(t2.run('renderMarketingCreators()')));
  }

  return s;
};

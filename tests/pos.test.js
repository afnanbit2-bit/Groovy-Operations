/* ─────────────────────────────────────────────────────────────────────────
   loadData — js/pos.js

   The app's oldest loader, and the one that still had the failure mode
   CLAUDE.md records under "Loading must never hang": four un-caught queries
   inside a Promise.all, so ONE refused read threw away all seven results and
   the dashboard showed zeros with a toast that named no collection.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {loadApp,suite}=require('./harness');

const FILES=['js/pos.js'];

// getDocs is called with whatever query()/collection() returned. The harness
// stubs those as {}, so the only way to tell the calls apart is to count
// them — loadData runs its jobs in the fixed order of _POS_LOADS.
function loaderWith(plan){
  let i=0;
  return loadApp({files:FILES,globals:{
    currentPage:'',
    // allPOs and friends are top-level `let`s in js/shared.js — a lexical
    // global these classic scripts share. pos.js only ASSIGNS to them, so
    // they are seeded here rather than loading the whole of shared.js.
    allPOs:[],allPasses:[],allReturns:[],allFabricIn:[],
    allGPEditRequests:[],allFabricInventory:[],allFabricMovements:[],
    getDocs:async()=>{
      const step=plan[i++];
      if(step&&step.fail){const e=new Error(step.message||'boom');if(step.code)e.code=step.code;throw e;}
      return{docs:(step&&step.docs)||[]};
    }
  }});
}
const doc=v=>({id:v,data:()=>({n:v})});

module.exports=function(){
  const s=suite('pos');

  s.section('one refused read no longer costs the other six');
  {
    // pos is job 0. Everything after it must still land.
    const app=loaderWith([
      {fail:true,code:'permission-denied',message:'Missing or insufficient permissions.'},
      {docs:[doc('gp')]},{docs:[doc('ret')]},{docs:[doc('fab')]},
      {docs:[]},{docs:[]},{docs:[]}
    ]);
    return app.run('loadData()').then(()=>{
      s.eq('the refused collection is empty',app.run('allPOs.length'),0);
      s.eq('but gate passes loaded',app.run('allPasses.length'),1);
      s.eq('and returns',app.run('allReturns.length'),1);
      s.eq('and fabric-in',app.run('allFabricIn.length'),1);

      s.section('and the toast NAMES it');
      // "Missing or insufficient permissions" alone is unreportable — it is
      // the same message whichever read was refused.
      const t=app.state.toasts.join(' | ');
      s.ok('says which collection',/pos/.test(t),t);
      s.ok('and what to check',/firestore\.rules/.test(t));
      s.ok('without claiming everything failed',!/gatepasses/.test(t));

      s.section('an optional read failing is silent');
      const app2=loaderWith([
        {docs:[doc('po')]},{docs:[]},{docs:[]},{docs:[]},
        {fail:true,code:'permission-denied'},   // gatepass_edit_requests
        {fail:true,code:'permission-denied'},   // fabric_inventory
        {fail:true,code:'permission-denied'}    // fabric_movements
      ]);
      return app2.run('loadData()').then(()=>{
        s.eq('the required data is there',app2.run('allPOs.length'),1);
        s.eq('and nothing was reported',app2.state.toasts.length,0);

        s.section('a permission failure is retried ONCE, behind a token refresh');
        let refreshed=0,atRefresh=-1;
        let i=0;
        // Entry 7 is the retry of `pos`. EVERYTHING after it fails — so if
        // the retry re-ran all seven queries instead of just the failed one,
        // the other six would be refused and reported. "Nothing is reported"
        // below is what proves it retried narrowly.
        const plan=[
          {fail:true,code:'permission-denied'},{docs:[]},{docs:[]},{docs:[]},
          {docs:[]},{docs:[]},{docs:[]},
          {docs:[doc('po')]}
        ];
        const app3=loadApp({files:FILES,globals:{
          currentPage:'',
          allPOs:[],allPasses:[],allReturns:[],allFabricIn:[],
          allGPEditRequests:[],allFabricInventory:[],allFabricMovements:[],
          auth:{currentUser:{getIdToken:async()=>{refreshed++;atRefresh=i;return 't';}}},
          getDocs:async()=>{
            const step=plan[i++];
            if(!step||step.fail){const e=new Error('denied');e.code='permission-denied';throw e;}
            return{docs:step.docs||[]};
          }
        }});
        return app3.run('loadData()').then(()=>{
          s.eq('the token was refreshed once',refreshed,1);
          s.eq('after all seven had run',atRefresh,7);
          s.eq('and the retry succeeded',app3.run('allPOs.length'),1);
          // If it had re-run all seven, the six behind the retry would have
          // been refused (every plan entry past 7 fails) and named in a toast.
          s.eq('only the failed query was retried',app3.state.toasts.length,0);
          return s;
        });
      });
    });
  }
};

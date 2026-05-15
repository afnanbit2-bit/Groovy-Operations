/* Groovy Operations — hrm.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

const EMPLOYEES_SEED=[
  { name:"Abbas Akhlaq", username:"abbas", designation:"Washing/Rider", department:"Washing", paygrade:"P1", basicSalary:30000, k40UserId:"9", advanceBalance:10000, loanBalance:0, loanMonthlyDeduction:0 },
  { name:"Rehan Ahmed", username:"rehan", designation:"Cutting/Printing Ops", department:"Cutting", paygrade:"P3", basicSalary:50000, k40UserId:"27", advanceBalance:0, loanBalance:0 },
  { name:"Umair", username:"umair", designation:"Fulfillment Manager", department:"Operations", paygrade:"P3", basicSalary:60000, k40UserId:"8", advanceBalance:5000, loanBalance:50000, loanMonthlyDeduction:5000 },
  { name:"Imran Masi", username:"imran", designation:"Office Boy", department:"Operations", paygrade:"P2", basicSalary:40000, k40UserId:"7", advanceBalance:5000, loanBalance:25000, loanMonthlyDeduction:0 },
  { name:"Shahid Qureshi", username:"shahid", designation:"Stitching Manager", department:"Stitching", paygrade:"P3", basicSalary:65000, k40UserId:"14", advanceBalance:15000, loanBalance:10000 },
  { name:"Waqas Ahmed", username:"waqas", designation:"Stitching QC", department:"Stitching", paygrade:"P2", basicSalary:55000, k40UserId:"13", advanceBalance:0, loanBalance:50000, loanMonthlyDeduction:0 },
  { name:"Ayaz", username:"ayaz", designation:"Loader", department:"Operations", paygrade:"P1", basicSalary:32000, k40UserId:"28", advanceBalance:5000, loanBalance:10000 },
  { name:"Jawad", username:"jawad", designation:"QC Ops", department:"QC", paygrade:"P1", basicSalary:30000, k40UserId:"20", advanceBalance:0, loanBalance:3000 },
  { name:"Noman Jameel", username:"noman", designation:"QC Final Manager", department:"QC", paygrade:"P3", basicSalary:50000, k40UserId:"23", advanceBalance:20000, loanBalance:50000 },
  { name:"Usman", username:"usman", designation:"QC Ops", department:"QC", paygrade:"P2", basicSalary:35000, k40UserId:"21", advanceBalance:0, loanBalance:3000 },
  { name:"Faizan", username:"faizan", designation:"QC Final Packing", department:"QC", paygrade:"P1", basicSalary:32000, k40UserId:"17", advanceBalance:0, loanBalance:0 },
  { name:"Haris Basheer", username:"haris", designation:"QC Manager", department:"QC", paygrade:"P2", basicSalary:40000, k40UserId:"19", advanceBalance:22000, loanBalance:14000 },
  { name:"Hamza", username:"hamza", designation:"CSR", department:"Operations", paygrade:"P3", basicSalary:65000, k40UserId:"4", advanceBalance:0, loanBalance:2000 },
  { name:"Faisal Mehar", username:"faisal", designation:"Return Management", department:"Operations", paygrade:"P3", basicSalary:50000, k40UserId:"12", advanceBalance:0, loanBalance:0 },
  { name:"Kashif", username:"kashif", designation:"Loader", department:"Operations", paygrade:"P2", basicSalary:40000, k40UserId:"25", advanceBalance:20000, loanBalance:0 },
  { name:"Daniyal Tufail", username:"daniyal", designation:"Marketing Ops", department:"Marketing", paygrade:"P3", basicSalary:50000, k40UserId:"3", advanceBalance:0, loanBalance:20000 },
  { name:"Abdul Basit", username:"abdulbasit", designation:"QC Final Packing", department:"QC", paygrade:"P2", basicSalary:35000, k40UserId:"31", advanceBalance:0, loanBalance:15000 },
  { name:"Gulam Mustafa", username:"mustafa", designation:"Ecom Manager", department:"Operations", paygrade:"P5", basicSalary:145000, k40UserId:"2", advanceBalance:0, loanBalance:0 },
  { name:"Fawad", username:"fawad", designation:"Fulfillment Ops", department:"Operations", paygrade:"P2", basicSalary:35000, k40UserId:"10", advanceBalance:2000, loanBalance:5000 },
  { name:"Raees", username:"raees", designation:"Store Manager", department:"Store", paygrade:"P3", basicSalary:50000, k40UserId:"16", advanceBalance:0, loanBalance:18000 },
  { name:"Umar", username:"umar", designation:"Rider", department:"Delivery", paygrade:"P1", basicSalary:40000, k40UserId:"8", advanceBalance:0, loanBalance:0 },
  { name:"Abdul Rafay", username:"rafay", designation:"Fulfillment Ops", department:"Operations", paygrade:"P1", basicSalary:30000, k40UserId:"29", advanceBalance:0, loanBalance:0 },
  { name:"AbdulSami", username:"abdulsami", designation:"CSR", department:"Operations", paygrade:"P3", basicSalary:50000, k40UserId:"5", advanceBalance:0, loanBalance:0 },
  { name:"Ayaan", username:"ayaan", designation:"Fulfillment Ops", department:"Operations", paygrade:"P1", basicSalary:25000, k40UserId:"33", advanceBalance:0, loanBalance:0 },
  { name:"Zohaib", username:"zohaib", designation:"Cutting & Bundling", department:"Cutting", paygrade:"P1", basicSalary:25000, k40UserId:"34", advanceBalance:5000, loanBalance:0 },
  { name:"Hassan", username:"hassan", designation:"CSR", department:"Operations", paygrade:"P1", basicSalary:26000, k40UserId:"26", advanceBalance:0, loanBalance:0 },
  { name:"Noreen", username:"noreen", designation:"QC Ops", department:"QC", paygrade:"P2", basicSalary:35000, k40UserId:"18", advanceBalance:0, loanBalance:0 },
  { name:"Asghar Ali", username:"asghar", designation:"Printing Manager", department:"Printing", paygrade:"P2", basicSalary:40000, k40UserId:"6", advanceBalance:0, loanBalance:0 },
  { name:"Afnan", username:"afnan", designation:"Co-Founder", department:"Management", paygrade:"P5", basicSalary:0, k40UserId:"", advanceBalance:0, loanBalance:0 },
  { name:"Ammar", username:"ammar", designation:"Co-Founder", department:"Management", paygrade:"P5", basicSalary:0, k40UserId:"", advanceBalance:0, loanBalance:0 },
  { name:"Arfat", username:"arfat", designation:"Advisory", department:"Management", paygrade:"P4", basicSalary:0, k40UserId:"", advanceBalance:0, loanBalance:0 }
];

const HRM_DEFAULT_POLICIES={
  workingDaysPerMonth:30,
  defaultShiftStart:"09:00",
  defaultShiftEnd:"17:00",
  lateGraceMinutes:30,
  lateCountBeforeAbsent:3,
  halfDayCountsAs:"full",
  absentDeductionFormula:"salary_div_workingdays",
  paygrades:{
    P1:{label:"P1",salaryMin:0,     salaryMax:35000,  incrementPercent:8, active:false},
    P2:{label:"P2",salaryMin:35001, salaryMax:50000,  incrementPercent:10,active:false},
    P3:{label:"P3",salaryMin:50001, salaryMax:70000,  incrementPercent:12,active:false},
    P4:{label:"P4",salaryMin:70001, salaryMax:100000, incrementPercent:15,active:false},
    P5:{label:"P5",salaryMin:100001,salaryMax:999999, incrementPercent:20,active:false}
  },
  autoIncrementActive:false
};

async function seedEmployeesIfEmpty(){
  try{
    const snap=await getDocs(collection(db,'employees'));
    if(!snap.empty)return false;
    const today=new Date().toISOString().split('T')[0];
    const batch=writeBatch(db);
    for(const e of EMPLOYEES_SEED){
      const docRef=doc(collection(db,'employees'));
      batch.set(docRef,{
        id:docRef.id,
        name:e.name,
        username:e.username,
        designation:e.designation,
        department:e.department,
        paygrade:e.paygrade,
        basicSalary:e.basicSalary||0,
        joinDate:e.joinDate||today,
        phone:e.phone||'',
        cnic:e.cnic||'',
        address:e.address||'',
        bankAccount:e.bankAccount||'',
        status:'active',
        k40UserId:e.k40UserId||'',
        advanceBalance:e.advanceBalance||0,
        loanBalance:e.loanBalance||0,
        loanMonthlyDeduction:e.loanMonthlyDeduction||0,
        purchasingDeduction:e.purchasingDeduction||0,
        notes:e.notes||'',
        createdBy:(session&&session.name)||'system',
        createdAt:Date.now(),
        updatedAt:Date.now()
      });
    }
    await batch.commit();
    return true;
  }catch(e){console.warn('seedEmployees failed:',e.message);return false;}
}

async function seedHRMPoliciesIfEmpty(){
  try{
    const ref=doc(db,'hrm_policies','main');
    const snap=await getDoc(ref);
    if(snap.exists())return false;
    await setDoc(ref,{...HRM_DEFAULT_POLICIES,lastUpdatedBy:(session&&session.name)||'system',lastUpdatedAt:Date.now()});
    return true;
  }catch(e){console.warn('seedHRMPolicies failed:',e.message);return false;}
}

async function loadHRMData(){
  try{
    await seedEmployeesIfEmpty();
    await seedHRMPoliciesIfEmpty();
    const[empSnap,polSnap,incSnap]=await Promise.all([
      getDocs(collection(db,'employees')),
      getDoc(doc(db,'hrm_policies','main')),
      getDocs(collection(db,'increment_logs')).catch(()=>({docs:[]}))
    ]);
    allEmployees=empSnap.docs.map(d=>({...d.data(),_id:d.id}));
    hrmPolicies=polSnap.exists()?polSnap.data():{...HRM_DEFAULT_POLICIES};
    allIncrementLogs=incSnap.docs.map(d=>({...d.data(),_id:d.id}));
    hrmDataLoaded=true;
    // Background-load payroll data (used by worker payslip cue + owner Pending Payroll KPI)
    if(typeof loadPayrollData==='function'&&!payrollDataLoaded){loadPayrollData().then(()=>{ if(currentPage==='dashboard'||currentPage==='my-work'||currentPage==='me'){const m=document.getElementById('main-content');if(m&&typeof renderPage==='function')renderPage(currentPage);} });}
    // Background-load Session 4 data (HRM notifications, advances, loans, policy log)
    if(typeof loadHRMSession4Data==='function'&&!hrmS4DataLoaded){loadHRMSession4Data().then(()=>{ if(currentPage==='dashboard'||currentPage==='my-work'||currentPage==='me'){const m=document.getElementById('main-content');if(m&&typeof renderPage==='function')renderPage(currentPage);} });}
    // Attach paygrade/employee record onto session if not yet attached
    if(session&&!session.employee){
      const me=allEmployees.find(x=>x.username===session.u);
      if(me){session.employee=me;session.paygrade=me.paygrade;session.k40UserId=me.k40UserId||'';}
    }
  }catch(e){console.warn('loadHRMData failed:',e.message);}
}

// ── HRM attendance helpers (Realtime DB) ─────────────────────
async function getMyAttendanceToday(k40UserId){
  if(!k40UserId)return null;
  try{
    const today=new Date().toISOString().split('T')[0];
    const snap=await rtdbGet(rtdbRef(rtdb,`attendance/${today}/${k40UserId}`));
    if(!snap.exists())return null;
    const punches=Object.values(snap.val()).sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''));
    const firstIn=punches.find(p=>p.type==='in')||punches[0];
    const lastPunch=punches[punches.length-1];
    return{firstIn,lastPunch,punches};
  }catch(e){return null;}
}

async function getMyMonthSummary(k40UserId){
  const k40=String(k40UserId==null?'':k40UserId).trim();
  if(!k40)return{present:0,late:0,absent:0,lateCount:0};
  try{
    const now=new Date();
    const yyyy=now.getFullYear(),mm=String(now.getMonth()+1).padStart(2,'0');
    const dayOfMonth=now.getDate();
    // Resolve the employee so late cutoff respects their per-employee shiftStart.
    const emp=allEmployees.find(e=>String(e.k40UserId||'').trim()===k40)||null;
    let present=0,late=0,absent=0;
    for(let d=1;d<=dayOfMonth;d++){
      const dd=String(d).padStart(2,'0');
      const date=`${yyyy}-${mm}-${dd}`;
      const dayOfWeek=new Date(date+'T00:00:00').getDay(); // 0=Sun ... 6=Sat
      const isSunday=dayOfWeek===0;
      const snap=await rtdbGet(rtdbRef(rtdb,`attendance/${date}/${k40}`));
      if(snap.exists()){
        // Any punch on the day = present (regardless of IN or OUT type)
        const punches=Object.values(snap.val()||{}).sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''));
        if(punches.length){
          present++;
          const firstIn=punches.find(p=>p.type==='in')||punches[0];
          if(_isLatePunch(firstIn,emp))late++;
        } else if(!isSunday){
          absent++;
        }
      } else if(!isSunday){
        // Absent only counts on working days (Mon–Sat); Sundays are off
        absent++;
      }
    }
    return{present,late,absent,lateCount:late};
  }catch(e){return{present:0,late:0,absent:0,lateCount:0};}
}

async function getFactoryNowCounts(){
  try{
    const snap=await rtdbGet(rtdbRef(rtdb,'attendance/live'));
    if(!snap.exists())return{inCount:0,outCount:0};
    const live=snap.val();
    let inCount=0,outCount=0;
    Object.values(live).forEach(rec=>{
      if(rec&&rec.status==='in')inCount++;
      else outCount++;
    });
    return{inCount,outCount};
  }catch(e){return{inCount:0,outCount:0};}
}

function _hrmGreetingTime(){
  const h=new Date().getHours();
  if(h<12)return'morning';
  if(h<17)return'afternoon';
  return'evening';
}
function _hrmFmtPKR(n){return'PKR '+(Number(n)||0).toLocaleString('en-PK');}
// ── Payroll permission helpers ──
// Mustafa can view payroll. Only Afnan + Ammar can process / edit / mark paid.
function _canViewPayroll(){ return session&&['afnan','ammar','mustafa'].includes(session.u); }
function _canProcessPayroll(){ return session&&['afnan','ammar'].includes(session.u); }
// Session 4 — Advances / Loans / Policy: same view tier as Payroll, owner-only for write.
function _canViewHRMOps(){ return session&&['afnan','ammar','mustafa'].includes(session.u); }
function _canApproveHRMOps(){ return session&&['afnan','ammar'].includes(session.u); }
function _canEditPolicy(){ return session&&['afnan','ammar'].includes(session.u); }
function _hrmEstSalary(emp,monthSummary){
  if(!emp||!emp.basicSalary)return 0;
  const policies=hrmPolicies||HRM_DEFAULT_POLICIES;
  const wd=policies.workingDaysPerMonth||30;
  const dailyRate=emp.basicSalary/wd;
  const absent=monthSummary?monthSummary.absent:0;
  const advance=emp.advanceBalance||0;
  const loanDed=emp.loanMonthlyDeduction||0;
  const purchDed=emp.purchasingDeduction||0;
  return Math.max(0,Math.round(emp.basicSalary-(absent*dailyRate)-loanDed-purchDed));
}

function renderHRMStub(title,iconName,msg){
  // Backwards compat: if old signature renderHRMStub(title,msg) was used,
  // shift parameters so it still works.
  if(typeof iconName==='string'&&msg===undefined){msg=iconName;iconName='gear';}
  const head=`<div class="page-head"><div class="page-title"><span class="page-title-icon">${_icon(iconName,22)}</span> ${title}</div><div class="page-sub">HRM module</div></div>`;
  return head+`<div class="card" style="text-align:center;padding:36px 18px"><div style="display:inline-flex;align-items:center;justify-content:center;color:var(--muted);margin-bottom:10px">${_icon(iconName,40)}</div><div style="font-weight:700;margin-bottom:6px">${title}</div><div style="color:var(--muted);font-size:13px;max-width:480px;margin:0 auto">${msg}</div></div>`;
}

function renderMePage(){
  // Personal page for workers — attendance widget + quick links
  if(!session)return'<div class="empty">Not logged in.</div>';
  const widget=typeof renderWorkerHRMWidget==='function'?renderWorkerHRMWidget():'';
  const sublink=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
    <button class="btn-outline" onclick="window.showPage('my-work')" style="font-size:12px">← My Work</button>
    <button class="btn-outline" onclick="window.showPage('gatepass')" style="font-size:12px">Gate Pass</button>
  </div>`;
  return widget+sublink;
}

function renderHRMDashboardWidget(){
  if(!session)return'';
  const role=session.role;
  const emp=session.employee||(allEmployees.find(e=>e.username===session.u))||null;
  const paygrade=(emp&&emp.paygrade)||session.paygrade||'';
  const k40=session.k40UserId||(emp&&emp.k40UserId)||'';
  const isOwner=role==='owner';
  const isManager=role==='manager';
  const isWorker=role==='worker';
  const greeting=_hrmGreetingTime();
  const nowStr=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const designation=(emp&&emp.designation)||session.title||'';
  const pgClass=paygrade?paygrade.toLowerCase():'';
  const pgBadge=paygrade?`<span class="paygrade-badge ${pgClass}">${paygrade}</span>`:'';

  const greetingHTML=`<div class="hrm-greeting">
    <div class="greeting-left">
      <div class="greeting-name">Good ${greeting}, ${session.name} 👋</div>
      <div class="greeting-sub">${designation}${pgBadge?' · '+pgBadge:''}</div>
    </div>
    <div class="greeting-time" id="hrm-clock">${nowStr}</div>
  </div>`;

  // Owner KPI strip — populated async
  if(isOwner){
    return`${greetingHTML}
    <div id="owner-bug-banner"></div>
    <div id="owner-payroll-alert"></div>
    <div class="owner-kpi-strip" id="owner-kpi-strip">
      <div class="kpi-card"><div class="kpi-icon">${_icon('people',22)}</div><div class="kpi-num" id="owner-kpi-in">—</div><div class="kpi-label">Staff IN today</div></div>
      <div class="kpi-card amber"><div class="kpi-icon">${_icon('clock',22)}</div><div class="kpi-num" id="owner-kpi-late">—</div><div class="kpi-label">Late today</div></div>
      <div class="kpi-card"><div class="kpi-icon">${_icon('box',22)}</div><div class="kpi-num">${allPOs.filter(p=>p.currentStage&&p.currentStage!=='completed').length}</div><div class="kpi-label">Active POs</div></div>
      <div class="kpi-card amber" style="cursor:pointer" onclick="window.showPage('hrm-payroll')"><div class="kpi-icon">${_icon('money',22)}</div><div class="kpi-num" id="owner-kpi-payroll">—</div><div class="kpi-label">Pending Payroll</div></div>
      <div class="kpi-card red"><div class="kpi-icon">${_icon('list',22)}</div><div class="kpi-num" id="owner-kpi-notif">${(typeof storeNotifications!=='undefined'?storeNotifications.length:0)}</div><div class="kpi-label">Notifications</div></div>
    </div>`;
  }

  if(isManager){
    return`${greetingHTML}
    <div class="mgr-stats-row" id="mgr-stats-row">
      <div class="card stat-card mgr">
        <div class="stat-label">Factory Now</div>
        <div class="stat-big green" id="mgr-fac-in">—</div>
        <div class="stat-sub" id="mgr-fac-sub">loading…</div>
      </div>
      <div class="card stat-card mgr">
        <div class="stat-label">My Month</div>
        <div class="stat-big" id="mgr-my-month">—</div>
        <div class="stat-sub" id="mgr-my-month-sub">loading…</div>
      </div>
      <div class="card stat-card mgr">
        <div class="stat-label">My Salary Est.</div>
        <div class="stat-big" id="mgr-my-salary">—</div>
        <div class="stat-sub">After deductions</div>
      </div>
    </div>`;
  }

  if(isWorker){
    const advRow=(emp&&emp.advanceBalance>0)?`<div class="advance-row">Advance balance: <span class="text-red">${_hrmFmtPKR(emp.advanceBalance)}</span></div>`:'';
    return`${greetingHTML}
    <div class="card hrm-attendance-card" id="hrm-att-card">
      <div class="card-title">Today's Attendance · حاضری</div>
      <div class="att-status in-no" id="hrm-att-status"><span>⏳</span><span>Loading…</span></div>
      <div class="att-hours" id="hrm-att-hours"></div>
    </div>
    <div class="card hrm-month-card" id="hrm-month-card">
      <div class="card-title">This Month · اس مہینے</div>
      <div class="month-grid">
        <div class="month-stat green"><div class="stat-num" id="hrm-m-present">—</div><div class="stat-label">Present</div></div>
        <div class="month-stat amber"><div class="stat-num" id="hrm-m-late">—</div><div class="stat-label">Late</div></div>
        <div class="month-stat red"><div class="stat-num" id="hrm-m-absent">—</div><div class="stat-label">Absent</div></div>
      </div>
      <div class="salary-preview">Est. salary this month: <strong id="hrm-est-salary">${emp?_hrmFmtPKR(emp.basicSalary):'PKR —'}</strong></div>
      ${advRow}
    </div>`;
  }
  return greetingHTML;
}

// Async populator — runs after dashboard render to fill live attendance
async function _hrmPopulateDashboard(){
  if(!session)return;
  const emp=session.employee||(allEmployees.find(e=>e.username===session.u))||null;
  const k40=session.k40UserId||(emp&&emp.k40UserId)||'';
  const role=session.role;

  if(role==='owner'){
    // Subscribe to live attendance + today's punches; KPIs update in real-time
    if(typeof _ensureOwnerDashboardLive==='function')_ensureOwnerDashboardLive();
    if(typeof _populateOwnerPayrollKPI==='function')_populateOwnerPayrollKPI();
    if(typeof _populateOwnerBugBanner==='function')_populateOwnerBugBanner();
    return;
  }

  if(role==='manager'){
    try{
      const fac=await getFactoryNowCounts();
      const elIn=document.getElementById('mgr-fac-in');if(elIn)elIn.textContent=fac.inCount+' IN';
      const elSub=document.getElementById('mgr-fac-sub');if(elSub)elSub.textContent=`${fac.outCount} out`;
      if(k40){
        const m=await getMyMonthSummary(k40);
        const eM=document.getElementById('mgr-my-month');if(eM)eM.textContent=m.present+' days';
        const eMS=document.getElementById('mgr-my-month-sub');if(eMS)eMS.textContent=`${m.late} late · ${m.absent} absent`;
        const eS=document.getElementById('mgr-my-salary');if(eS&&emp)eS.textContent=_hrmFmtPKR(_hrmEstSalary(emp,m));
      } else {
        const eMS=document.getElementById('mgr-my-month-sub');if(eMS)eMS.textContent='No K40 ID';
        const eS=document.getElementById('mgr-my-salary');if(eS&&emp)eS.textContent=_hrmFmtPKR(emp.basicSalary||0);
      }
    }catch(e){}
    return;
  }

  if(role==='worker'){
    if(!k40){
      const st=document.getElementById('hrm-att-status');
      if(st){st.className='att-status in-no';st.innerHTML='<span>—</span><span>K40 ID not set</span>';}
      return;
    }
    try{
      const att=await getMyAttendanceToday(k40);
      const st=document.getElementById('hrm-att-status');
      const hr=document.getElementById('hrm-att-hours');
      if(att&&att.firstIn){
        if(st){st.className='att-status in-yes';st.innerHTML=`<span class="pulse-dot"></span><span>Punched in at <strong>${formatTime12hr(att.firstIn.time)||'—'}</strong></span>`;}
        if(hr){
          const start=att.firstIn.time||'';
          const end=att.lastPunch?.time||'';
          if(start&&end&&end>start){
            const[h1,m1]=start.split(':').map(Number),[h2,m2]=end.split(':').map(Number);
            const mins=(h2*60+m2)-(h1*60+m1);
            hr.textContent=`Hours worked: ${Math.floor(mins/60)}h ${mins%60}m`;
          } else {
            hr.textContent=`Punches today: ${att.punches.length}`;
          }
        }
      } else {
        if(st){st.className='att-status in-no';st.innerHTML='<span>⏳</span><span>Not punched yet</span>';}
        if(hr)hr.textContent='';
      }
      const m=await getMyMonthSummary(k40);
      const e1=document.getElementById('hrm-m-present');if(e1)e1.textContent=m.present;
      const e2=document.getElementById('hrm-m-late');if(e2)e2.textContent=m.late;
      const e3=document.getElementById('hrm-m-absent');if(e3)e3.textContent=m.absent;
      const eS=document.getElementById('hrm-est-salary');if(eS&&emp)eS.textContent=_hrmFmtPKR(_hrmEstSalary(emp,m));
    }catch(e){}
  }
}

// Dashboard widget population is triggered explicitly via renderPage('dashboard').

// ── HRM Employees page ──
function _hrmDepartments(){
  const set=new Set();
  allEmployees.forEach(e=>{ if(e.department)set.add(e.department); });
  return Array.from(set).sort();
}

// Detect placeholder/seeded join dates: any joinDate value shared by 5+ employees
// is almost certainly the batch-seed default, not a real joining date.
function _provisionalJoinDateValue(){
  const counts={};
  allEmployees.forEach(e=>{ if(e.joinDate)counts[e.joinDate]=(counts[e.joinDate]||0)+1; });
  let best=null,n=0;
  Object.entries(counts).forEach(([d,c])=>{ if(c>n){best=d;n=c;} });
  return n>=5?best:null;
}
function _isProvisionalJoinDate(emp,seedDate){
  if(!emp.joinDate)return true;
  if(seedDate===undefined)seedDate=_provisionalJoinDateValue();
  return seedDate!=null&&emp.joinDate===seedDate;
}

function renderHRMEmployeesPage(){
  if(!session||!['owner','manager'].includes(session.role)){
    return'<div class="empty">Owners and managers only.</div>';
  }
  const depts=_hrmDepartments();
  const paygrades=['P1','P2','P3','P4','P5'];
  const activeStaff=allEmployees.filter(e=>e.status!=='inactive');
  const total=activeStaff.length;
  const trackedCount=activeStaff.filter(e=>String(e.k40UserId||'').trim()).length;
  const subText=trackedCount===total?`${total} active staff`:`${total} active · ${total-trackedCount} not tracked by attendance`;
  const seedDate=_provisionalJoinDateValue();
  const pendingCount=seedDate?activeStaff.filter(e=>_isProvisionalJoinDate(e,seedDate)).length:0;
  const dupeGroups=_hrmFindDuplicateEmployees();
  const dupeExtras=dupeGroups.reduce((s,g)=>s+(g.list.length-1),0);
  const banner=(pendingCount>0)?`<div class="card" style="border-left:3px solid var(--accent-warning);background:var(--accent-warning-soft);padding:12px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--accent-warning);font-weight:700">📌 Mustafa &middot; Job Item #1</div>
      <div style="font-size:14px;font-weight:600;margin-top:2px">Set join dates &mdash; ${pendingCount} employee${pendingCount===1?'':'s'} pending</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">Records seeded with a placeholder date. Edit each person and set their real joining date.</div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-outline" style="font-size:12px;padding:6px 12px" onclick="window.hrmShowPendingJoin()">${_empFilterPending?'Show all':'Show pending'}</button>
    </div>
  </div>`:'';
  const dupeBanner=(dupeExtras>0&&session.role==='owner')?`<div class="card" style="border-left:3px solid var(--accent-urgent);background:var(--accent-urgent-soft);padding:12px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--accent-urgent);font-weight:700">⚠ Duplicate records detected</div>
      <div style="font-size:14px;font-weight:600;margin-top:2px">${dupeExtras} duplicate employee record${dupeExtras===1?'':'s'} (${dupeGroups.length} username${dupeGroups.length===1?'':'s'} appear more than once)</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">Seed must have run twice. Click below to deactivate duplicates &mdash; the best record per username is kept (one with K40 ID + join date), the rest are flipped to <code>status: inactive</code> (reversible).</div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-primary" style="width:auto;font-size:12px;padding:6px 12px;margin-top:0" onclick="window.hrmDeactivateDuplicates()">Deactivate ${dupeExtras} duplicate${dupeExtras===1?'':'s'}</button>
    </div>
  </div>`:'';
  return`<div class="page-head">
    <div class="page-title"><span class="page-title-icon">${_icon('people',22)}</span> Employees</div>
    <div class="page-sub" title="Staff with no K40 device ID don't appear in attendance — typically co-founders/advisors who don't punch.">${subText}</div>
  </div>
  ${dupeBanner}
  ${banner}
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <input id="emp-search" placeholder="Search name, username, designation…" oninput="window.hrmFilterEmployees()" value="${_empFilterQ}" style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
    <select id="emp-dept" onchange="window.hrmFilterEmployees()" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
      <option value="">All departments</option>
      ${depts.map(d=>`<option value="${d}" ${_empFilterDept===d?'selected':''}>${d}</option>`).join('')}
    </select>
    <select id="emp-pay" onchange="window.hrmFilterEmployees()" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
      <option value="">All paygrades</option>
      ${paygrades.map(p=>`<option value="${p}" ${_empFilterPay===p?'selected':''}>${p}</option>`).join('')}
    </select>
    <button class="btn-primary" onclick="window.hrmAddEmployee()" style="font-size:13px;width:auto;padding:8px 16px;margin-top:0">+ Add Employee</button>
  </div>
  <div id="emp-grid-wrap">${_renderEmpGrid()}</div>`;
}

function _renderEmpGrid(){
  let list=allEmployees.filter(e=>e.status!=='inactive');
  const q=(_empFilterQ||'').toLowerCase().trim();
  if(q)list=list.filter(e=>(e.name||'').toLowerCase().includes(q)||(e.username||'').toLowerCase().includes(q)||(e.designation||'').toLowerCase().includes(q));
  if(_empFilterDept)list=list.filter(e=>e.department===_empFilterDept);
  if(_empFilterPay)list=list.filter(e=>e.paygrade===_empFilterPay);
  if(_empFilterPending){
    const seed=_provisionalJoinDateValue();
    list=list.filter(e=>_isProvisionalJoinDate(e,seed));
  }
  list.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if(!list.length)return'<div class="empty">No employees match.</div>';
  const seed=_provisionalJoinDateValue();
  return`<div class="emp-grid">${list.map(e=>_empCardHTML(e,seed)).join('')}</div>`;
}

function _empCardHTML(e,seedDate){
  const pgClass=(e.paygrade||'').toLowerCase();
  const provisional=_isProvisionalJoinDate(e,seedDate);
  const join=(e.joinDate&&!provisional)?new Date(e.joinDate).toLocaleDateString('en-GB',{month:'short',year:'numeric'}):'—';
  const k40=String(e.k40UserId||'').trim();
  const k40Line=k40
    ?`K40 ID: ${k40}`
    :`K40 ID: <span style="display:inline-block;background:#F0F0F0;color:#555;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;letter-spacing:.04em" title="No K40 device ID — not tracked by attendance.">NOT TRACKED</span>`;
  const shiftStart=String(e.shiftStart||'').trim();
  const shiftEnd=String(e.shiftEnd||'').trim();
  const shiftLine=k40&&(shiftStart||shiftEnd)
    ?`<br>Shift: ${shiftStart||'default'}–${shiftEnd||'default'}`
    :'';
  return`<div class="emp-card">
    <div class="emp-row">
      <div>
        <div class="emp-name">${e.name||'—'}</div>
        <div class="emp-desg">${e.designation||'—'} · ${e.department||'—'}</div>
      </div>
      <span class="paygrade-badge ${pgClass}">${e.paygrade||'—'}</span>
    </div>
    <div class="emp-meta">
      Basic: <strong>${_hrmFmtPKR(e.basicSalary)}</strong><br>
      Joined: ${join}<br>
      ${k40Line}${shiftLine}
    </div>
    <div class="emp-actions">
      <button class="btn-outline" onclick="window.hrmViewEmployee('${e._id}')">View Profile</button>
      <button class="btn-outline" onclick="window.hrmEditEmployee('${e._id}')">Edit</button>
    </div>
  </div>`;
}

// Group active employees by username (case-insensitive). Returns groups with >1 entry.
function _hrmFindDuplicateEmployees(){
  const byUser={};
  for(const e of allEmployees){
    if(e.status==='inactive')continue;
    const key=String(e.username||'').trim().toLowerCase();
    if(!key)continue;
    (byUser[key]=byUser[key]||[]).push(e);
  }
  const groups=[];
  for(const[username,list]of Object.entries(byUser)){
    if(list.length>1)groups.push({username,list});
  }
  return groups;
}

// Pick the "keeper" from a duplicate group: prefer ones with k40UserId set,
// then with a real (non-provisional) joinDate, then the most recently updated.
function _hrmRankEmployeeForKeep(seedDate){
  return(a,b)=>{
    const ak=(a.k40UserId&&String(a.k40UserId).trim())?1:0;
    const bk=(b.k40UserId&&String(b.k40UserId).trim())?1:0;
    if(ak!==bk)return bk-ak;
    const aj=(a.joinDate&&!_isProvisionalJoinDate(a,seedDate))?1:0;
    const bj=(b.joinDate&&!_isProvisionalJoinDate(b,seedDate))?1:0;
    if(aj!==bj)return bj-aj;
    return(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0);
  };
}

window.hrmDeactivateDuplicates=async function(){
  if(!session||session.role!=='owner'){showToast('Owners only.',true);return;}
  const groups=_hrmFindDuplicateEmployees();
  if(!groups.length){showToast('No duplicates found.');return;}
  const seedDate=_provisionalJoinDateValue();
  const rank=_hrmRankEmployeeForKeep(seedDate);
  const toDeactivate=[];
  for(const g of groups){
    const sorted=g.list.slice().sort(rank);
    for(let i=1;i<sorted.length;i++)toDeactivate.push(sorted[i]);
  }
  if(!confirm(`Deactivate ${toDeactivate.length} duplicate employee record${toDeactivate.length===1?'':'s'}?\n\nThe best record per username is kept; the rest are flipped to status: inactive (reversible — you can edit them later to re-activate).`))return;
  try{
    const batch=writeBatch(db);
    for(const e of toDeactivate){
      batch.update(doc(db,'employees',e._id),{status:'inactive',deactivatedReason:'duplicate cleanup',deactivatedAt:Date.now(),updatedAt:Date.now()});
      e.status='inactive';
    }
    await batch.commit();
    await logActivity('Employees deduped',`${toDeactivate.length} duplicate record(s) deactivated`);
    showToast(`Deactivated ${toDeactivate.length} duplicate${toDeactivate.length===1?'':'s'} ✓`);
    const m=document.getElementById('main-content');
    if(m&&currentPage==='hrm-employees')m.innerHTML=renderHRMEmployeesPage();
  }catch(err){showToast('Dedupe failed: '+err.message,true);}
};

window.hrmFilterEmployees=function(){
  _empFilterQ=document.getElementById('emp-search')?.value||'';
  _empFilterDept=document.getElementById('emp-dept')?.value||'';
  _empFilterPay=document.getElementById('emp-pay')?.value||'';
  const wrap=document.getElementById('emp-grid-wrap');
  if(wrap)wrap.innerHTML=_renderEmpGrid();
};

window.hrmShowPendingJoin=function(){
  _empFilterPending=!_empFilterPending;
  const m=document.getElementById('main-content');
  if(m)m.innerHTML=renderHRMEmployeesPage();
};

window.hrmViewEmployee=function(id){
  _empViewingId=id;
  const e=allEmployees.find(x=>x._id===id);
  if(!e){showToast('Employee not found.',true);return;}
  const logs=allIncrementLogs.filter(l=>l.employeeId===id).sort((a,b)=>(b.effectiveFrom||'').localeCompare(a.effectiveFrom||''));
  const isOwner=session.role==='owner';
  const pgClass=(e.paygrade||'').toLowerCase();
  const back=document.createElement('div');
  back.className='hrm-modal-back';
  back.id='hrm-modal-back';
  back.onclick=ev=>{ if(ev.target===back)window.hrmCloseModal(); };
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div>
        <h3>${e.name}</h3>
        <div class="sub">${e.designation||'—'} · ${e.department||'—'} · <span class="paygrade-badge ${pgClass}">${e.paygrade||'—'}</span></div>
      </div>
      <button onclick="window.hrmCloseModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--muted);line-height:1">×</button>
    </div>
    <div class="hrm-section-title">Personal</div>
    <div class="hrm-grid-2">
      <div class="hrm-kv"><span class="k">Username</span><span class="v">${e.username||'—'}</span></div>
      <div class="hrm-kv"><span class="k">Status</span><span class="v">${e.status||'active'}</span></div>
      <div class="hrm-kv"><span class="k">Phone</span><span class="v">${e.phone||'—'}</span></div>
      <div class="hrm-kv"><span class="k">CNIC</span><span class="v">${e.cnic||'—'}</span></div>
      <div class="hrm-kv"><span class="k">Address</span><span class="v">${e.address||'—'}</span></div>
      <div class="hrm-kv"><span class="k">Bank Account</span><span class="v">${e.bankAccount||'—'}</span></div>
      <div class="hrm-kv"><span class="k">K40 ID</span><span class="v">${e.k40UserId||'—'}</span></div>
      <div class="hrm-kv"><span class="k">Join Date</span><span class="v">${(e.joinDate&&!_isProvisionalJoinDate(e))?e.joinDate:'<em style="color:var(--muted);font-weight:500">— not set</em>'}</span></div>
    </div>
    <div class="hrm-section-title">Salary</div>
    <div class="hrm-grid-2">
      <div class="hrm-kv"><span class="k">Basic Salary</span><span class="v">${_hrmFmtPKR(e.basicSalary)}</span></div>
      <div class="hrm-kv"><span class="k">Paygrade</span><span class="v">${e.paygrade||'—'}</span></div>
      <div class="hrm-kv"><span class="k">Advance Balance</span><span class="v">${_hrmFmtPKR(e.advanceBalance)}</span></div>
      <div class="hrm-kv"><span class="k">Loan Balance</span><span class="v">${_hrmFmtPKR(e.loanBalance)}</span></div>
      <div class="hrm-kv"><span class="k">Loan Monthly Ded.</span><span class="v">${_hrmFmtPKR(e.loanMonthlyDeduction)}</span></div>
      <div class="hrm-kv"><span class="k">Purchasing Ded.</span><span class="v">${_hrmFmtPKR(e.purchasingDeduction)}</span></div>
    </div>
    <div class="hrm-section-title">Increment History</div>
    <div>${logs.length?logs.map(_hrmIncLogRow).join(''):'<div class="empty" style="padding:14px">No increments recorded yet.</div>'}</div>
    ${e.notes?`<div class="hrm-section-title">Notes</div><div style="font-size:13px;color:var(--text);background:#fafafa;padding:10px;border-radius:8px;border:1px solid var(--border)">${e.notes}</div>`:''}
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;flex-wrap:wrap">
      ${isOwner?`<button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.hrmShowAddIncrement('${e._id}')">+ Add Increment</button>`:''}
      <button class="btn-outline" onclick="window.hrmEditEmployee('${e._id}')">Edit</button>
      <button class="btn-outline" onclick="window.hrmCloseModal()">Close</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

function _hrmIncLogRow(l){
  const dir=l.incrementAmount>=0?'+':'';
  return`<div class="inc-log-row">
    <strong>${l.effectiveFrom||'—'}</strong> · ${l.type||'annual'} · ${_hrmFmtPKR(l.oldSalary)} → ${_hrmFmtPKR(l.newSalary)} (${dir}${_hrmFmtPKR(l.incrementAmount)} · ${dir}${(l.incrementPercent||0).toFixed(1)}%)
    <div style="margin-top:3px;color:var(--muted);font-size:11px">Approved by ${l.approvedBy||'—'}${l.reason?' · '+l.reason:''}${l.wasOverridden?' · <em>overridden</em>':''}</div>
  </div>`;
}

window.hrmCloseModal=function(){
  document.getElementById('hrm-modal-back')?.remove();
};

window.hrmAddEmployee=function(){
  if(!['owner','manager'].includes(session.role))return showToast('Owners and managers only.',true);
  _hrmShowEmployeeForm(null);
};

window.hrmEditEmployee=function(id){
  if(!['owner','manager'].includes(session.role))return showToast('Owners and managers only.',true);
  const e=allEmployees.find(x=>x._id===id);
  if(!e)return showToast('Employee not found.',true);
  _hrmShowEmployeeForm(e);
};

function _hrmShowEmployeeForm(e){
  const isEdit=!!e;
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';
  back.id='hrm-modal-back';
  back.onclick=ev=>{ if(ev.target===back)window.hrmCloseModal(); };
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()">
    <h3>${isEdit?'Edit Employee':'Add Employee'}</h3>
    <div class="sub">${isEdit?e.name:'New staff member'}</div>
    <div class="hrm-grid-2">
      <div class="field"><label>Full name *</label><input id="ef-name" value="${e?.name||''}"></div>
      <div class="field"><label>Username *</label><input id="ef-username" value="${e?.username||''}"></div>
      <div class="field"><label>Designation</label><input id="ef-designation" value="${e?.designation||''}"></div>
      <div class="field"><label>Department</label><input id="ef-department" value="${e?.department||''}"></div>
      <div class="field"><label>Paygrade</label>
        <select id="ef-paygrade">${['P1','P2','P3','P4','P5'].map(p=>`<option value="${p}" ${e?.paygrade===p?'selected':''}>${p}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Basic Salary</label><input id="ef-salary" type="number" value="${e?.basicSalary||0}"></div>
      <div class="field"><label>Join Date</label><input id="ef-join" type="date" value="${e&&e.joinDate&&!_isProvisionalJoinDate(e)?e.joinDate:''}"></div>
      <div class="field"><label>K40 User ID</label><input id="ef-k40" value="${e?.k40UserId||''}"></div>
      <div class="field"><label>Phone</label><input id="ef-phone" value="${e?.phone||''}"></div>
      <div class="field"><label>Shift Start <span style="font-weight:400;color:var(--muted)">(blank → ${(hrmPolicies&&hrmPolicies.defaultShiftStart)||HRM_DEFAULT_POLICIES.defaultShiftStart})</span></label><input id="ef-shift-start" type="time" value="${e?.shiftStart||''}"></div>
      <div class="field"><label>Shift End <span style="font-weight:400;color:var(--muted)">(blank → ${(hrmPolicies&&hrmPolicies.defaultShiftEnd)||HRM_DEFAULT_POLICIES.defaultShiftEnd})</span></label><input id="ef-shift-end" type="time" value="${e?.shiftEnd||''}"></div>
      <div class="field"><label>CNIC</label><input id="ef-cnic" value="${e?.cnic||''}"></div>
      <div class="field"><label>Bank Account</label><input id="ef-bank" value="${e?.bankAccount||''}"></div>
      <div class="field"><label>Status</label>
        <select id="ef-status">${['active','inactive'].map(s=>`<option value="${s}" ${e?.status===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Advance Balance</label><input id="ef-adv" type="number" value="${e?.advanceBalance||0}"></div>
      <div class="field"><label>Loan Balance</label><input id="ef-loan" type="number" value="${e?.loanBalance||0}"></div>
      <div class="field"><label>Loan Monthly Ded.</label><input id="ef-loanmd" type="number" value="${e?.loanMonthlyDeduction||0}"></div>
      <div class="field"><label>Purchasing Ded.</label><input id="ef-purch" type="number" value="${e?.purchasingDeduction||0}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Address</label><input id="ef-address" value="${e?.address||''}"></div>
    <div class="field"><label>Notes</label><textarea id="ef-notes" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px">${e?.notes||''}</textarea></div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <div>${isEdit&&session.role==='owner'?`<button class="btn-outline" style="color:var(--accent-urgent);border-color:var(--accent-urgent);font-size:13px;width:auto;padding:8px 14px;margin-top:0" onclick="window.hrmDeleteEmployee('${e._id}')">Delete employee</button>`:''}</div>
      <div style="display:flex;gap:8px">
        <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
        <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.hrmSaveEmployee('${e?._id||''}')">${isEdit?'Save Changes':'Create Employee'}</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(back);
}

window.hrmSaveEmployee=async function(id){
  if(!['owner','manager'].includes(session.role))return showToast('Owners and managers only.',true);
  const v=k=>document.getElementById(k)?.value?.trim()||'';
  const num=k=>Number(document.getElementById(k)?.value||0);
  const data={
    name:v('ef-name'),
    username:v('ef-username'),
    designation:v('ef-designation'),
    department:v('ef-department'),
    paygrade:v('ef-paygrade'),
    basicSalary:num('ef-salary'),
    joinDate:v('ef-join'),
    k40UserId:v('ef-k40'),
    shiftStart:v('ef-shift-start'),
    shiftEnd:v('ef-shift-end'),
    phone:v('ef-phone'),
    cnic:v('ef-cnic'),
    bankAccount:v('ef-bank'),
    status:v('ef-status')||'active',
    advanceBalance:num('ef-adv'),
    loanBalance:num('ef-loan'),
    loanMonthlyDeduction:num('ef-loanmd'),
    purchasingDeduction:num('ef-purch'),
    address:v('ef-address'),
    notes:v('ef-notes'),
    updatedAt:Date.now()
  };
  if(!data.name||!data.username)return showToast('Name and username are required.',true);
  try{
    if(id){
      await updateDoc(doc(db,'employees',id),data);
      const i=allEmployees.findIndex(e=>e._id===id);
      if(i>=0)allEmployees[i]={...allEmployees[i],...data};
      showToast('Employee updated ✓');
    } else {
      data.createdBy=session.name;
      data.createdAt=Date.now();
      const ref=doc(collection(db,'employees'));
      data.id=ref.id;
      await setDoc(ref,data);
      allEmployees.push({...data,_id:ref.id});
      showToast('Employee created ✓');
    }
    window.hrmCloseModal();
    if(currentPage==='hrm-employees'){const w=document.getElementById('emp-grid-wrap');if(w)w.innerHTML=_renderEmpGrid();}
  }catch(e){showToast('Save failed: '+e.message,true);}
};

window.hrmDeleteEmployee=async function(id){
  if(!session||session.role!=='owner')return showToast('Owners only.',true);
  const e=allEmployees.find(x=>x._id===id);
  if(!e)return showToast('Employee not found.',true);
  const msg=`Permanently delete ${e.name}?\n\n` +
    `This removes the employee record from Firestore. Their historical attendance ` +
    `(keyed by K40 ID ${e.k40UserId||'—'}) and any payslips already issued will remain, ` +
    `but they'll disappear from the Employees list, payroll runs, and dashboards.\n\n` +
    `If you might rehire them, hit Cancel and just set Status → inactive instead.\n\n` +
    `Type DELETE in the next prompt to confirm.`;
  if(!confirm(msg))return;
  const typed=prompt(`To confirm deletion of ${e.name}, type DELETE`);
  if(typed!=='DELETE'){showToast('Deletion cancelled.');return;}
  try{
    await deleteDoc(doc(db,'employees',id));
    allEmployees=allEmployees.filter(x=>x._id!==id);
    await logActivity('Employee deleted',`${e.name} (${e.username})`);
    showToast(`${e.name} deleted ✓`);
    window.hrmCloseModal();
    if(currentPage==='hrm-employees'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderHRMEmployeesPage();}
  }catch(err){showToast('Delete failed: '+err.message,true);}
};

window.hrmShowAddIncrement=function(empId){
  if(session.role!=='owner')return showToast('Owners only.',true);
  const e=allEmployees.find(x=>x._id===empId);if(!e)return;
  const policies=hrmPolicies||HRM_DEFAULT_POLICIES;
  const pg=policies.paygrades?.[e.paygrade];
  const suggestedPct=pg?.incrementPercent||10;
  const suggestedAmt=Math.round((e.basicSalary||0)*suggestedPct/100);
  const suggestedNew=(e.basicSalary||0)+suggestedAmt;
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';
  back.id='hrm-modal-back';
  back.onclick=ev=>{ if(ev.target===back)window.hrmCloseModal(); };
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:520px">
    <h3>Add Increment — ${e.name}</h3>
    <div class="sub">Current basic: <strong>${_hrmFmtPKR(e.basicSalary)}</strong> · Paygrade: <span class="paygrade-badge ${(e.paygrade||'').toLowerCase()}">${e.paygrade||'—'}</span></div>
    <div class="field"><label>Increment Type</label>
      <select id="inc-type">${['annual','performance','promotion','probation'].map(t=>`<option value="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>New Salary (PKR) *</label><input id="inc-new" type="number" value="${suggestedNew}"></div>
    <div style="font-size:12px;color:var(--muted);background:#fafafa;padding:8px;border-radius:6px;border:1px dashed var(--border);margin:6px 0">
      <strong>${e.paygrade}</strong> recommended: <strong>+${suggestedPct}%</strong> = ${_hrmFmtPKR(suggestedAmt)} → ${_hrmFmtPKR(suggestedNew)} <em>(reference only)</em>
    </div>
    <div class="field"><label>Effective From</label><input id="inc-eff" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
    <div class="field"><label>Reason / Notes</label><textarea id="inc-reason" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px"></textarea></div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.hrmSubmitIncrement('${empId}',${suggestedPct})">Submit Increment</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window.hrmSubmitIncrement=async function(empId,suggestedPct){
  if(session.role!=='owner')return showToast('Owners only.',true);
  const e=allEmployees.find(x=>x._id===empId);if(!e)return;
  const newSalary=Number(document.getElementById('inc-new')?.value||0);
  const type=document.getElementById('inc-type')?.value||'annual';
  const effectiveFrom=document.getElementById('inc-eff')?.value||new Date().toISOString().split('T')[0];
  const reason=document.getElementById('inc-reason')?.value?.trim()||'';
  if(!newSalary||newSalary<=0)return showToast('Enter a valid new salary.',true);
  const oldSalary=e.basicSalary||0;
  const incrementAmount=newSalary-oldSalary;
  const incrementPercent=oldSalary?(incrementAmount/oldSalary*100):0;
  const wasOverridden=Math.abs(incrementPercent-suggestedPct)>0.5;
  try{
    const logRef=doc(collection(db,'increment_logs'));
    const log={
      id:logRef.id,
      employeeId:empId,
      employeeName:e.name,
      oldSalary,
      newSalary,
      incrementAmount,
      incrementPercent:Number(incrementPercent.toFixed(2)),
      paygrade:e.paygrade,
      paygradeSuggestedPercent:suggestedPct,
      wasOverridden,
      reason,
      approvedBy:session.name,
      approvedAt:Date.now(),
      effectiveFrom,
      type
    };
    await setDoc(logRef,log);
    await updateDoc(doc(db,'employees',empId),{basicSalary:newSalary,updatedAt:Date.now()});
    e.basicSalary=newSalary;
    allIncrementLogs.push({...log,_id:logRef.id});
    await logActivity('Increment approved',`${e.name}: ${_hrmFmtPKR(oldSalary)} → ${_hrmFmtPKR(newSalary)}`);
    showToast('Increment recorded ✓');
    window.hrmCloseModal();
    window.hrmViewEmployee(empId);
  }catch(err){showToast('Save failed: '+err.message,true);}
};

// ── HRM Session 2: Worker my-work HRM widget + Attendance page ──

// Resolve an employee's effective late cutoff = (shiftStart || policyDefault) + graceMinutes.
// Returns "HH:MM" or null when the global lateCutoffActive toggle is OFF.
function _attLateCutoffFor(emp){
  const policies=hrmPolicies||HRM_DEFAULT_POLICIES;
  if(policies.lateCutoffActive===false)return null;
  const start=String((emp&&emp.shiftStart)||policies.defaultShiftStart||HRM_DEFAULT_POLICIES.defaultShiftStart).trim();
  if(!/^\d{2}:\d{2}$/.test(start))return null;
  const grace=Math.max(0,Number(policies.lateGraceMinutes!=null?policies.lateGraceMinutes:HRM_DEFAULT_POLICIES.lateGraceMinutes)||0);
  if(!grace)return start;
  const[h,m]=start.split(':').map(Number);
  const total=h*60+m+grace;
  const hh=String(Math.floor(total/60)%24).padStart(2,'0');
  const mm=String(total%60).padStart(2,'0');
  return`${hh}:${mm}`;
}
function _isLatePunch(p,emp){
  if(!p||!p.time)return false;
  const cut=_attLateCutoffFor(emp);
  return!!(cut&&p.time>cut);
}
function _attDateLabel(iso){
  if(!iso)return'';
  const d=new Date(iso+'T00:00:00');
  return d.toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}
function _attTodayDelta(iso){
  const today=new Date().toISOString().split('T')[0];
  if(iso===today)return'Today';
  const a=new Date(iso+'T00:00:00'), b=new Date(today+'T00:00:00');
  const days=Math.round((b-a)/(1000*60*60*24));
  if(days===1)return'Yesterday';
  if(days>0)return`${days} days ago`;
  if(days===-1)return'Tomorrow';
  return`in ${-days} days`;
}
function _attMinutesBetween(start,end){
  if(!start||!end||end<=start)return 0;
  const[h1,m1]=start.split(':').map(Number),[h2,m2]=end.split(':').map(Number);
  return(h2*60+m2)-(h1*60+m1);
}
function _attHoursLabel(start,end){
  const mins=_attMinutesBetween(start,end);
  if(!mins)return'—';
  return`${Math.floor(mins/60)}h ${mins%60}m`;
}
function _attLateMinutes(time,emp){
  if(!time)return 0;
  const cut=_attLateCutoffFor(emp);
  if(!cut)return 0;
  return _attMinutesBetween(cut,time);
}
// Convert "HH:MM" / "HH:MM:SS" / ISO timestamp to 12-hour with AM/PM (e.g. "20:06" → "8:06 PM").
// Returns the input unchanged when it can't be parsed (so "—" / "" pass through).
function formatTime12hr(timeString){
  if(timeString==null)return'';
  const s=String(timeString).trim();
  if(!s||/[ap]m\b/i.test(s))return s;
  let h,m;
  const hm=s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if(hm){h=parseInt(hm[1],10);m=hm[2];}
  else{
    const d=new Date(s);
    if(isNaN(d.getTime()))return s;
    h=d.getHours();m=String(d.getMinutes()).padStart(2,'0');
  }
  if(isNaN(h)||h<0||h>23)return s;
  const period=h>=12?'PM':'AM';
  let h12=h%12;if(h12===0)h12=12;
  return`${h12}:${m} ${period}`;
}

// Compose punches keyed by k40UserId from a snapshot of attendance/{date}
function _attPunchesByUser(dayData){
  const out={};
  if(!dayData)return out;
  Object.entries(dayData).forEach(([uid,punchMap])=>{
    const punches=Object.values(punchMap||{}).sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''));
    const firstIn=punches.find(p=>p.type==='in')||punches[0];
    const lastPunch=punches[punches.length-1];
    out[String(uid)]={punches,firstIn,lastPunch};
  });
  return out;
}

// ── Worker my-work HRM widget ──
function renderWorkerHRMWidget(){
  if(!session)return'';
  const emp=session.employee||(allEmployees.find(e=>e.username===session.u))||null;
  const greeting=_hrmGreetingTime();
  const nowStr=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const dateStr=new Date().toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'});
  const designation=(emp&&emp.designation)||session.title||'';
  const paygrade=(emp&&emp.paygrade)||session.paygrade||'';
  const pgClass=paygrade?paygrade.toLowerCase():'';
  const pgBadge=paygrade?`<span class="paygrade-badge ${pgClass}">${paygrade}</span>`:'';
  const advance=(emp&&emp.advanceBalance)||0;
  const basic=(emp&&emp.basicSalary)||0;
  const advanceRow=advance>0?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid #E5E5E7;font-size:12px;color:#E94560">Advance balance: ${_hrmFmtPKR(advance)}</div>`:'';
  return`<div class="hrm-greeting" style="margin-bottom:16px">
    <div class="greeting-left" style="min-width:0">
      <div class="greeting-name">Good ${greeting}, ${session.name} 👋</div>
      <div class="greeting-sub">${designation}${pgBadge?' · '+pgBadge:''}</div>
    </div>
    <div style="text-align:right;color:rgba(255,255,255,.6);font-size:12px" id="wrk-clock">${nowStr}<br>${dateStr}</div>
  </div>
  <div class="wrk-hrm-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
    <div class="card" style="padding:16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:10px">Today · آج</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px" id="wrk-att-row">
        <span class="pulse-dot" id="wrk-att-dot" style="display:none"></span>
        <span style="font-size:14px;font-weight:600;color:var(--accent-warning)" id="wrk-att-label">Loading…</span>
      </div>
      <div style="font-size:12px;color:#6B7280" id="wrk-att-hours">Hours: —</div>
    </div>
    <div class="card" style="padding:16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:10px">This Month · اس مہینے</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;text-align:center">
        <div style="background:#EAF3DE;border-radius:6px;padding:6px"><div style="font-size:18px;font-weight:700;color:#3B6D11" id="wrk-m-present">—</div><div style="font-size:9px;color:#6B7280">Present</div></div>
        <div style="background:var(--accent-warning-soft);border-radius:6px;padding:6px"><div style="font-size:18px;font-weight:700;color:var(--accent-warning)" id="wrk-m-late">—</div><div style="font-size:9px;color:#6B7280">Late</div></div>
        <div style="background:var(--accent-urgent-soft);border-radius:6px;padding:6px"><div style="font-size:18px;font-weight:700;color:var(--accent-urgent)" id="wrk-m-absent">—</div><div style="font-size:9px;color:#6B7280">Absent</div></div>
      </div>
    </div>
  </div>
  <div class="card" style="padding:16px;margin-bottom:16px;border-left:3px solid #1A1A2E">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">Estimated Salary · تخمینہ تنخواہ</div>
        <div style="font-size:22px;font-weight:700;color:#1A1A2E;margin-top:4px" id="wrk-est-salary">${_hrmFmtPKR(basic)}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px" id="wrk-est-breakdown">Basic ${_hrmFmtPKR(basic)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:#6B7280">3 lates = 1 absent</div>
        <div id="wrk-late-badges" style="margin-top:4px"></div>
      </div>
    </div>
    <div id="wrk-advance-row">${advanceRow}</div>
    <div id="wrk-payslip-cue"></div>
  </div>
  <div id="wrk-notif-banner"></div>
  <div id="wrk-extra-cards"></div>`;
}

async function _populateWorkerHRMWidget(){
  if(!session||session.role!=='worker')return;
  const emp=session.employee||(allEmployees.find(e=>e.username===session.u))||null;
  if(!emp){ const lbl=document.getElementById('wrk-att-label'); if(lbl)lbl.textContent='Loading employee profile…'; return; }
  const k40=emp.k40UserId||session.k40UserId||'';
  if(!k40){
    const lbl=document.getElementById('wrk-att-label'); if(lbl){lbl.textContent='K40 ID not set';lbl.style.color='var(--accent-warning)';}
    return;
  }
  try{
    const att=await getMyAttendanceToday(k40);
    const dot=document.getElementById('wrk-att-dot');
    const lbl=document.getElementById('wrk-att-label');
    const hrs=document.getElementById('wrk-att-hours');
    if(att&&att.firstIn){
      if(dot)dot.style.display='inline-block';
      if(lbl){lbl.textContent=`Punched in at ${formatTime12hr(att.firstIn.time)||'—'}`;lbl.style.color='var(--accent-success)';}
      if(hrs){
        const start=att.firstIn.time||'';
        const end=att.lastPunch?.time||'';
        hrs.textContent=`Hours: ${_attHoursLabel(start,end)}`;
      }
    } else {
      if(dot)dot.style.display='none';
      if(lbl){lbl.textContent='Not punched yet';lbl.style.color='var(--accent-warning)';}
      if(hrs)hrs.textContent='Hours: —';
    }
    const m=await getMyMonthSummary(k40);
    const e1=document.getElementById('wrk-m-present');if(e1)e1.textContent=m.present;
    const e2=document.getElementById('wrk-m-late');if(e2)e2.textContent=m.late;
    const e3=document.getElementById('wrk-m-absent');if(e3)e3.textContent=m.absent;

    // Salary calc per spec: 3 lates = 1 absent equivalent
    const basic=emp.basicSalary||0;
    const dailyRate=basic/30;
    const lateAbsentEquiv=Math.floor((m.late||0)/3);
    const totalDeductionDays=(m.absent||0)+lateAbsentEquiv;
    const advance=emp.advanceBalance||0;
    const loanDed=emp.loanMonthlyDeduction||0;
    const purchDed=emp.purchasingDeduction||0;
    const deductionAmt=Math.round(totalDeductionDays*dailyRate);
    const estimated=Math.max(0,Math.round(basic-deductionAmt-advance-loanDed-purchDed));
    const eS=document.getElementById('wrk-est-salary');if(eS)eS.textContent=_hrmFmtPKR(estimated);
    const eB=document.getElementById('wrk-est-breakdown');
    if(eB){
      const parts=[`Basic ${_hrmFmtPKR(basic)}`];
      if(deductionAmt>0)parts.push(`− ${_hrmFmtPKR(deductionAmt)} (${totalDeductionDays}d)`);
      if(advance>0)parts.push(`− advance ${_hrmFmtPKR(advance)}`);
      if(loanDed>0)parts.push(`− loan ${_hrmFmtPKR(loanDed)}`);
      eB.textContent=parts.join(' ');
    }
    const badgeWrap=document.getElementById('wrk-late-badges');
    if(badgeWrap){
      const lc=m.late||0;
      const badges=[];
      if(lc>=2)badges.push(`<span style="display:inline-block;background:var(--accent-warning-soft);color:var(--accent-warning);font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;margin-top:4px">⚠ ${lc} lates this month</span>`);
      if(lc>=3)badges.push(`<span style="display:inline-block;background:var(--accent-urgent-soft);color:var(--accent-urgent);font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;margin-top:4px;margin-left:4px">🔴 Absent deducted</span>`);
      badgeWrap.innerHTML=badges.join('');
    }
    const advRow=document.getElementById('wrk-advance-row');
    if(advRow)advRow.innerHTML=advance>0?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid #E5E5E7;font-size:12px;color:#E94560">Advance balance: ${_hrmFmtPKR(advance)}</div>`:'';
    // Last-month payslip cue
    const cue=document.getElementById('wrk-payslip-cue');
    if(cue&&payrollDataLoaded){
      const last=_myLastPayslip();
      if(last){
        const status=(last.status||'draft').toUpperCase();
        const badgeBg=last.status==='paid'?'var(--accent-success-soft)':'var(--accent-warning-soft)';
        const badgeFg=last.status==='paid'?'var(--accent-success)':'var(--accent-warning)';
        cue.innerHTML=`<div style="margin-top:10px;padding-top:10px;border-top:1px solid #E5E5E7;display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer" onclick="window.openPayslip('${last._id}','${last.employeeId}')">
          <div>
            <div style="font-size:12px;color:var(--muted)">${_payrollMonthLabel(last.month)} payslip available</div>
            <div style="font-size:14px;font-weight:700;color:#1A1A2E">${_hrmFmtPKR(last.netPayable)} <span style="font-size:10px;font-weight:600;background:${badgeBg};color:${badgeFg};padding:2px 8px;border-radius:8px;margin-left:6px">${status}</span></div>
          </div>
          <span style="font-size:18px;color:var(--muted)">›</span>
        </div>`;
      } else {
        cue.innerHTML='';
      }
    }
    // Rich cards: advance / loan / last payslip
    const extra=document.getElementById('wrk-extra-cards');
    if(extra){
      const cards=[];
      if((emp.advanceBalance||0)>0){
        cards.push(`<div class="card" style="padding:12px;margin-top:8px;border-left:3px solid var(--accent-urgent)">
          <div style="font-size:11px;text-transform:uppercase;color:var(--accent-urgent);letter-spacing:.06em">Advance Balance</div>
          <div style="font-size:18px;font-weight:700;margin-top:2px">${_hrmFmtPKR(emp.advanceBalance)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Will be deducted next payroll</div>
        </div>`);
      }
      if((emp.loanBalance||0)>0){
        cards.push(`<div class="card" style="padding:12px;margin-top:8px;border-left:3px solid var(--accent-warning)">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div><div style="font-size:11px;text-transform:uppercase;color:var(--accent-warning);letter-spacing:.06em">Loan Balance</div><div style="font-size:18px;font-weight:700;margin-top:2px">${_hrmFmtPKR(emp.loanBalance)}</div></div>
            <div style="text-align:right"><div style="font-size:11px;color:var(--muted)">Monthly</div><div style="font-size:13px;font-weight:600">${_hrmFmtPKR(emp.loanMonthlyDeduction)}</div></div>
          </div>
        </div>`);
      }
      if(typeof _myLastPayslip==='function'){
        const last=_myLastPayslip();
        if(last&&last.status==='paid'){
          cards.push(`<div class="card" style="padding:12px;margin-top:8px;cursor:pointer" onclick="window.openPayslip('${last._id}','${last.employeeId}')">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><div style="font-size:11px;text-transform:uppercase;color:var(--accent-success);letter-spacing:.06em">Last Payslip</div><div style="font-size:14px;font-weight:600;margin-top:2px">${_payrollMonthLabel(last.month)}</div><div style="font-size:11px;color:var(--muted);margin-top:2px">${_hrmFmtPKR(last.netPayable)} · Paid ${last.paidOn||'—'}</div></div><span style="color:var(--muted)">›</span></div>
          </div>`);
        }
      }
      extra.innerHTML=cards.join('');
    }
    // HRM notif banner (at top, above content)
    if(typeof _renderWorkerNotifBanner==='function')_renderWorkerNotifBanner();
  }catch(e){console.warn('worker HRM populate failed',e);}
}

// ── Attendance page ──
function renderAttendancePage(){
  if(!session||!['owner','manager'].includes(session.role)){
    return'<div class="empty">Owners and managers only.</div>';
  }
  const tabBtn=(id,label)=>`<button class="att-tab ${attendanceTab===id?'active':''}" onclick="window.attendanceSetTab('${id}')" style="padding:8px 18px;border:1px solid var(--border);border-bottom:${attendanceTab===id?'2px solid #1A1A2E':'1px solid var(--border)'};background:${attendanceTab===id?'#fff':'#fafafa'};font-weight:${attendanceTab===id?'700':'500'};font-size:13px;cursor:pointer;font-family:inherit;color:${attendanceTab===id?'#1A1A2E':'var(--muted)'};border-radius:8px 8px 0 0;margin-right:4px">${label}</button>`;
  const tabs=`<div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap">${tabBtn('daily','Daily')}${tabBtn('monthly','Monthly')}</div>`;
  const activeStaff=allEmployees.filter(e=>e.status!=='inactive');
  const activeCount=activeStaff.length;
  const trackedCount=activeStaff.filter(e=>String(e.k40UserId||'').trim()).length;
  const subText=trackedCount===activeCount?`${trackedCount} tracked staff`:`${trackedCount} tracked · ${activeCount-trackedCount} not tracked`;
  const head=`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><div class="page-title"><span class="page-title-icon">${_icon('clock',22)}</span> Attendance · حاضری</div><div class="page-sub" title="Staff with no K40 device ID are not tracked by the clock and don't appear in attendance.">${subText}</div></div><div id="att-sync-pill" style="font-size:12px;color:var(--muted);padding:6px 10px;border:1px solid var(--border);border-radius:20px;background:#fafafa;display:flex;align-items:center;gap:6px;cursor:default" title="ZKTeco sync status">⏳ Sync: checking…</div></div>`;
  const body=attendanceTab==='monthly'?renderAttendanceMonthly():renderAttendanceDaily();
  return head+tabs+`<div id="att-body">${body}</div>`;
}

function renderAttendanceDaily(){
  const today=new Date().toISOString().split('T')[0];
  const isToday=attendanceDate===today;
  return`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:8px;flex-wrap:wrap">
    <button onclick="window.attendancePrevDay()" class="btn-outline">← Previous</button>
    <div style="text-align:center;flex:1;min-width:140px">
      <div style="font-size:18px;font-weight:600">${_attDateLabel(attendanceDate)}</div>
      <div style="font-size:12px;color:#6B7280">${_attTodayDelta(attendanceDate)}</div>
    </div>
    <button onclick="window.attendanceNextDay()" class="btn-outline" ${isToday?'disabled style="opacity:.4;cursor:not-allowed"':''}>Next →</button>
  </div>
  <div class="att-summary-strip" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px" id="att-summary-strip">
    <div class="card" style="padding:16px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--accent-success)" id="att-tot-in">—</div><div style="font-size:11px;color:#6B7280;margin-top:4px">Punched IN</div></div>
    <div class="card" style="padding:16px;text-align:center"><div style="font-size:28px;font-weight:700;color:var(--accent-urgent)" id="att-tot-absent">—</div><div style="font-size:11px;color:#6B7280;margin-top:4px">Absent</div></div>
    <div class="card" style="padding:16px;text-align:center;background:var(--accent-warning-soft)"><div style="font-size:28px;font-weight:700;color:var(--accent-warning)" id="att-tot-late">—</div><div style="font-size:11px;color:#6B7280;margin-top:4px">Late Arrivals</div></div>
    <div class="card" style="padding:16px;text-align:center" title="Active employees with a K40 device ID. Only these are tracked by attendance."><div style="font-size:28px;font-weight:700;color:#1A1A2E">${allEmployees.filter(e=>e.status!=='inactive'&&String(e.k40UserId||'').trim()).length}</div><div style="font-size:11px;color:#6B7280;margin-top:4px">Tracked Staff</div></div>
  </div>
  <div class="section-title">Staff Presence</div>
  <div id="att-grid-wrap"><div class="empty">Loading attendance…</div></div>
  ${session.role==='owner'?`<div id="att-log-wrap" style="margin-top:20px"></div><div id="att-late-wrap" style="margin-top:16px"></div>`:''}`;
}

function _attendanceAfterRender(){
  if(currentPage!=='attendance')return;
  _attendanceSubscribeMeta();
  if(attendanceTab==='daily'){
    _attendanceSubscribeDaily(attendanceDate);
    _attendanceSubscribeLive();
  } else {
    _attendanceUnsubscribeDayAndLive();
    _renderAttendanceMonthly();
  }
}

function _attendanceUnsubscribeDayAndLive(){
  try{ if(_attLiveUnsub){const r=rtdbRef(rtdb,'attendance/live');rtdbOff(r);_attLiveUnsub=null;} }catch(_){}
  try{ if(_attDayUnsub){const r=rtdbRef(rtdb,`attendance/${_attDayUnsub}`);rtdbOff(r);_attDayUnsub=null;} }catch(_){}
}
function _attendanceUnsubscribeAll(){
  _attendanceUnsubscribeDayAndLive();
  try{ if(_attMetaUnsub){const r=rtdbRef(rtdb,'attendance/_meta');rtdbOff(r);_attMetaUnsub=false;} }catch(_){}
}

// Subscribe to /attendance/_meta — written by the ZKTeco sync script on every
// attempt (success or failure). Lets the page show "last synced N min ago"
// and surface errors when the script is alive but failing.
let _attMetaUnsub=false,_attMetaTickInt=null;
function _attendanceSubscribeMeta(){
  if(!_attMetaUnsub){
    const r=rtdbRef(rtdb,'attendance/_meta');
    rtdbOnValue(r,snap=>{
      const meta=snap.exists()?snap.val():null;
      _renderAttSyncPill(meta);
    });
    _attMetaUnsub=true;
  }
  // Tick every 30s so the "X min ago" stays current even without new pushes.
  if(_attMetaTickInt)clearInterval(_attMetaTickInt);
  _attMetaTickInt=setInterval(()=>{
    if(currentPage!=='attendance'){clearInterval(_attMetaTickInt);_attMetaTickInt=null;return;}
    rtdbGet(rtdbRef(rtdb,'attendance/_meta')).then(s=>_renderAttSyncPill(s.exists()?s.val():null)).catch(()=>{});
  },30000);
}

function _renderAttSyncPill(meta){
  const el=document.getElementById('att-sync-pill');
  if(!el)return;
  if(!meta||!meta.lastSyncAt){
    el.style.background='#FAEEDA';el.style.borderColor='#E5C07B';el.style.color='#854F0B';
    el.innerHTML='⚠️ Sync: never ran';
    el.title='No heartbeat from the ZKTeco sync script. Check the factory PC.';
    return;
  }
  const ageMin=(Date.now()-new Date(meta.lastSyncAt).getTime())/60000;
  const ago=ageMin<1?'just now':ageMin<60?`${Math.round(ageMin)}m ago`:ageMin<1440?`${Math.round(ageMin/60)}h ago`:`${Math.round(ageMin/1440)}d ago`;
  if(meta.lastSyncOk===false){
    el.style.background='#FBE7E9';el.style.borderColor='#E94560';el.style.color='#9B1B2D';
    el.innerHTML=`🔴 Sync error · ${ago}`;
    el.title=`Last error: ${meta.lastError||'(unknown)'}\nHost: ${meta.host||'?'}`;
  } else if(ageMin>5){
    el.style.background='#FAEEDA';el.style.borderColor='#E5C07B';el.style.color='#854F0B';
    el.innerHTML=`🟠 Sync stale · ${ago}`;
    el.title=`Sync hasn't run for ${ago}. Check the factory PC.\nHost: ${meta.host||'?'}`;
  } else {
    el.style.background='#EAF3DE';el.style.borderColor='#7FA85C';el.style.color='#3B6D11';
    el.innerHTML=`🟢 Sync OK · ${ago}`;
    el.title=`Last sync: ${new Date(meta.lastSyncAt).toLocaleString()}\nRecords: ${meta.recordsPushed||0}\nCursor: ${meta.cursor||'—'}\nHost: ${meta.host||'?'}`;
  }
}

function _attendanceSubscribeDaily(date){
  // Re-subscribe if date changed
  if(_attDayUnsub&&_attDayUnsub!==date){
    try{rtdbOff(rtdbRef(rtdb,`attendance/${_attDayUnsub}`));}catch(_){}
    _attDayUnsub=null;
  }
  if(_attDayUnsub===date){
    // Already subscribed (e.g. dashboard owner-KPI listener took it first).
    // The freshly rendered DOM is still on "Loading…" — render now from cache.
    if(currentPage==='attendance'&&attendanceTab==='daily')_renderAttendanceDailyContent();
    return;
  }
  const r=rtdbRef(rtdb,`attendance/${date}`);
  rtdbOnValue(r,snap=>{
    dailyAttendanceData=snap.exists()?snap.val():{};
    if(currentPage==='attendance'&&attendanceTab==='daily')_renderAttendanceDailyContent();
  });
  _attDayUnsub=date;
}

function _attendanceSubscribeLive(){
  if(_attLiveUnsub){
    // Already subscribed — make sure the just-rendered attendance DOM gets the
    // cached live state (otherwise OUT statuses don't appear until next push).
    if(currentPage==='attendance'&&attendanceTab==='daily'&&attendanceDate===new Date().toISOString().split('T')[0]){
      _renderAttendanceDailyContent();
    }
    return;
  }
  const r=rtdbRef(rtdb,'attendance/live');
  rtdbOnValue(r,snap=>{
    liveAttendanceData=snap.exists()?snap.val():{};
    // Re-render owner KPI cards on dashboard if we're there
    if(currentPage==='dashboard'&&session&&session.role==='owner'){_updateOwnerLiveKPIs();}
    // Re-render today's attendance (only useful if viewing today)
    if(currentPage==='attendance'&&attendanceTab==='daily'&&attendanceDate===new Date().toISOString().split('T')[0]){
      _renderAttendanceDailyContent();
    }
  });
  _attLiveUnsub=true;
}

function _renderAttendanceDailyContent(){
  const punchesByUser=_attPunchesByUser(dailyAttendanceData);
  const today=new Date().toISOString().split('T')[0];
  const isToday=attendanceDate===today;

  let totalIn=0,totalLate=0,totalAbsent=0;
  // Only show K40-tracked active employees. Co-founders/advisors without a
  // device ID don't punch in and shouldn't be flagged absent.
  const emps=allEmployees.slice().filter(e=>e.status!=='inactive'&&String(e.k40UserId||'').trim());
  const rows=emps.map(emp=>{
    const k40=String(emp.k40UserId).trim();
    const data=punchesByUser[k40];
    let status='absent';
    if(data&&data.firstIn){
      status='in';
      if(_isLatePunch(data.firstIn,emp))status='late';
      // If today and live data says they punched out, show 'out'
      if(isToday&&liveAttendanceData[k40]&&liveAttendanceData[k40].status==='out')status='out';
    }
    if(status==='absent')totalAbsent++;
    else{totalIn++; if(status==='late')totalLate++;}
    return{emp,data,status};
  });

  const order={in:0,late:1,out:2,absent:3};
  rows.sort((a,b)=>(order[a.status]-order[b.status])||(a.emp.name||'').localeCompare(b.emp.name||''));

  // Update summary cards
  const eIn=document.getElementById('att-tot-in');if(eIn)eIn.textContent=totalIn;
  const eL=document.getElementById('att-tot-late');if(eL)eL.textContent=totalLate;
  const eA=document.getElementById('att-tot-absent');if(eA)eA.textContent=totalAbsent;

  // Render staff grid
  const wrap=document.getElementById('att-grid-wrap');
  if(wrap){
    wrap.innerHTML=rows.length?`<div class="attendance-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">${rows.map(r=>_attEmpCardHTML(r)).join('')}</div>`:'<div class="empty">No employees configured.</div>';
  }

  if(session.role==='owner'){
    // Punch log table
    const allPunches=[];
    Object.entries(punchesByUser).forEach(([uid,d])=>{
      const emp=emps.find(e=>String(e.k40UserId)===String(uid));
      const empName=emp?emp.name:`User${uid}`;
      d.punches.forEach(p=>allPunches.push({...p,empName,k40:uid,_emp:emp||null}));
    });
    allPunches.sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
    const logWrap=document.getElementById('att-log-wrap');
    if(logWrap){
      logWrap.innerHTML=`<div class="card"><div class="card-title" style="padding:14px 16px 8px;font-weight:700">Punch Log · حاضری لاگ</div>
        <table class="punch-log-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#1A1A2E;color:white">
            <th style="padding:10px;text-align:left">Time</th>
            <th style="padding:10px;text-align:left">Name</th>
            <th style="padding:10px;text-align:left">Type</th>
            <th style="padding:10px;text-align:left">Status</th>
          </tr></thead>
          <tbody>${allPunches.length?allPunches.map(_attPunchRow).join(''):'<tr><td colspan="4" style="padding:14px;color:var(--muted);text-align:center">No punches yet on this day.</td></tr>'}</tbody>
        </table></div>`;
    }
    // Late list
    const lates=rows.filter(r=>r.status==='late');
    const lateWrap=document.getElementById('att-late-wrap');
    if(lateWrap){
      lateWrap.innerHTML=lates.length?_attLateBlockHTML(lates):'';
    }
  }
}

function _attEmpCardHTML(row){
  const{emp,data,status}=row;
  const pgClass=(emp.paygrade||'').toLowerCase();
  const pgBadge=`<span class="paygrade-badge ${pgClass}">${emp.paygrade||'—'}</span>`;
  if(status==='absent'){
    return`<div class="card" style="padding:14px;border-left:3px solid #E5E5E7;opacity:0.75">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="min-width:0"><div style="font-weight:600;font-size:14px">${emp.name}</div><div style="font-size:11px;color:#6B7280">${emp.designation||'—'}</div></div>${pgBadge}</div>
      <div style="margin-top:10px;font-size:13px;color:#9CA3AF">Not punched</div>
    </div>`;
  }
  const firstIn=data.firstIn;
  const lastPunch=data.lastPunch;
  const start=firstIn?.time||'';
  const end=lastPunch?.time||'';
  const hours=_attHoursLabel(start,end);
  const isOut=status==='out';
  const isLate=status==='late';
  const borderColor=isLate?'var(--accent-warning)':(isOut?'#9CA3AF':'var(--accent-success)');
  const statusLabel=isLate?'LATE':(isOut?'OUT':'IN');
  const statusColor=isLate?'var(--accent-warning)':(isOut?'#555':'var(--accent-success)');
  const dot=isOut?'':`<span class="pulse-dot"></span>`;
  const lateBadge=isLate?`<span style="display:inline-block;background:var(--accent-warning-soft);color:var(--accent-warning);font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;margin-top:6px">LATE</span>`:'';
  return`<div class="card" style="padding:14px;border-left:3px solid ${borderColor}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="min-width:0"><div style="font-weight:600;font-size:14px">${emp.name}</div><div style="font-size:11px;color:#6B7280">${emp.designation||'—'}</div>${lateBadge}</div>
      ${pgBadge}
    </div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:6px">${dot}<span style="font-size:13px;font-weight:500;color:${statusColor}">${statusLabel}</span><span style="font-size:12px;color:#6B7280">${isOut?`out at ${formatTime12hr(end)}`:`since ${formatTime12hr(start)}`}</span></div>
    <div style="font-size:12px;color:#6B7280;margin-top:4px">Hours: ${hours}</div>
  </div>`;
}

function _attPunchRow(p){
  const isIn=(p.type||'in').toLowerCase()==='in';
  const tint=isIn?'#F4FAEC':'#fff';
  const typeBg=isIn?'#EAF3DE':'#F0F0F0';
  const typeFg=isIn?'#3B6D11':'#555';
  const emp=p._emp||null;
  const lateLabel=(isIn&&_isLatePunch(p,emp))?`<span style="background:var(--accent-warning-soft);color:var(--accent-warning);font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px">LATE +${_attLateMinutes(p.time,emp)}m</span>`:'<span style="color:var(--muted);font-size:12px">—</span>';
  return`<tr style="background:${tint};border-bottom:1px solid #E5E5E7">
    <td style="padding:10px;font-weight:600">${formatTime12hr(p.time)}</td>
    <td style="padding:10px">${p.empName||p.name||'—'}</td>
    <td style="padding:10px"><span style="background:${typeBg};color:${typeFg};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600">${isIn?'IN':'OUT'}</span></td>
    <td style="padding:10px">${lateLabel}</td>
  </tr>`;
}

function _attLateBlockHTML(lates){
  // Compute simple per-employee monthly late count from the cached month if available
  const monthByEmp=_attMonthSummary?_attMonthSummary.byEmp:null;
  const items=lates.map(({emp,data})=>{
    const time=data.firstIn?.time||'';
    const lateMins=_attLateMinutes(time,emp);
    const monthly=monthByEmp?(monthByEmp[emp._id]?.late||0):'—';
    const monthlyNum=typeof monthly==='number'?monthly:0;
    const badgeBg=monthlyNum>=3?'var(--accent-urgent-soft)':(monthlyNum>=2?'var(--accent-warning-soft)':'#F0F0F0');
    const badgeFg=monthlyNum>=3?'var(--accent-urgent)':(monthlyNum>=2?'var(--accent-warning)':'#555');
    const triggered=monthlyNum>=3?' 🔴 Absent triggered':'';
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #E5E5E7;gap:10px;flex-wrap:wrap">
      <div style="min-width:0"><div style="font-weight:600">${emp.name}</div><div style="font-size:12px;color:#6B7280">${emp.designation||'—'}</div></div>
      <div style="text-align:right"><div style="color:var(--accent-warning);font-weight:600">Arrived ${formatTime12hr(time)}</div><div style="font-size:12px;color:#6B7280">Late by ${lateMins} mins</div></div>
      <span style="background:${badgeBg};color:${badgeFg};padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${monthly} lates this month${triggered}</span>
    </div>`;
  }).join('');
  return`<div class="card" style="border:1px solid #EF9F27;padding:0">
    <div class="card-title" style="color:var(--accent-warning);padding:14px 16px 6px;font-weight:700">⚠ Late Arrivals · دیر سے آنے والے</div>
    ${items}
  </div>`;
}

// ── Monthly view ──
function renderAttendanceMonthly(){
  const months=[];
  const now=new Date();
  for(let i=0;i<12;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const lbl=d.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    months.push({key,lbl});
  }
  const selectHTML=`<select id="att-month-pick" onchange="window.attendanceSetMonth(this.value)" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">${months.map(m=>`<option value="${m.key}" ${m.key===attendanceMonth?'selected':''}>${m.lbl}</option>`).join('')}</select>`;
  return`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:8px;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:13px;color:var(--muted)">Month:</span>${selectHTML}
    </div>
    <div style="font-size:12px;color:var(--muted)">Late→Absent rule: 3 lates count as 1 absent</div>
  </div>
  <div id="att-month-wrap"><div class="empty">Loading monthly attendance…</div></div>`;
}

async function _renderAttendanceMonthly(){
  const wrap=document.getElementById('att-month-wrap');
  if(wrap)wrap.innerHTML='<div class="empty">Loading monthly attendance…</div>';
  const summary=await _computeMonthlyAttendance(attendanceMonth);
  _attMonthSummary=summary;
  const policies=hrmPolicies||HRM_DEFAULT_POLICIES;
  const wd=policies.workingDaysPerMonth||30;
  const rows=allEmployees.slice().filter(e=>e.status!=='inactive'&&String(e.k40UserId||'').trim()).map(e=>{
    const s=summary.byEmp[e._id]||{present:0,late:0,absent:0};
    const lateAbsentEquiv=Math.floor((s.late||0)/3);
    const totalDeductDays=(s.absent||0)+lateAbsentEquiv;
    const dailyRate=(e.basicSalary||0)/wd;
    const deduction=Math.round(totalDeductDays*dailyRate);
    const advance=e.advanceBalance||0;
    const loanDed=e.loanMonthlyDeduction||0;
    const netEst=Math.max(0,Math.round((e.basicSalary||0)-deduction-advance-loanDed));
    let rowBg='';
    if((s.absent||0)>3)rowBg='background:var(--accent-urgent-soft)';
    else if((s.late||0)>=2)rowBg='background:var(--accent-warning-soft)';
    return{e,s,lateAbsentEquiv,totalDeductDays,deduction,netEst,rowBg};
  }).sort((a,b)=>(a.e.name||'').localeCompare(b.e.name||''));

  const html=`<div class="card" style="padding:0;overflow:auto">
    <table class="att-month-table" style="width:100%;border-collapse:collapse;font-size:13px;min-width:720px">
      <thead><tr style="background:#1A1A2E;color:white">
        <th style="padding:10px;text-align:left">Employee</th>
        <th style="padding:10px;text-align:center">Grade</th>
        <th style="padding:10px;text-align:center">Present</th>
        <th style="padding:10px;text-align:center">Late</th>
        <th style="padding:10px;text-align:center">Late→Absent</th>
        <th style="padding:10px;text-align:center">Absent</th>
        <th style="padding:10px;text-align:center">Deduction</th>
        <th style="padding:10px;text-align:center">Net Est.</th>
      </tr></thead>
      <tbody>${rows.map(r=>{
        const pgClass=(r.e.paygrade||'').toLowerCase();
        return`<tr style="${r.rowBg};border-bottom:1px solid #E5E5E7">
          <td style="padding:10px"><div style="font-weight:600">${r.e.name}</div><div style="font-size:11px;color:var(--muted)">${r.e.designation||'—'}</div></td>
          <td style="padding:10px;text-align:center"><span class="paygrade-badge ${pgClass}">${r.e.paygrade||'—'}</span></td>
          <td style="padding:10px;text-align:center;font-weight:600;color:var(--accent-success)">${r.s.present}</td>
          <td style="padding:10px;text-align:center;color:var(--accent-warning)">${r.s.late}</td>
          <td style="padding:10px;text-align:center;color:var(--accent-warning)">${r.lateAbsentEquiv}</td>
          <td style="padding:10px;text-align:center;color:var(--accent-urgent)">${r.s.absent}</td>
          <td style="padding:10px;text-align:center">${_hrmFmtPKR(r.deduction)}</td>
          <td style="padding:10px;text-align:center;font-weight:700">${_hrmFmtPKR(r.netEst)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
  if(wrap)wrap.innerHTML=html;
}

async function _computeMonthlyAttendance(monthKey){
  // monthKey = YYYY-MM
  const[yyyy,mm]=monthKey.split('-').map(Number);
  const today=new Date();
  const isCurrent=(today.getFullYear()===yyyy&&(today.getMonth()+1)===mm);
  // Don't cache the current month — it changes throughout the day
  if(!isCurrent&&monthlyAttendanceCache[monthKey])return monthlyAttendanceCache[monthKey];
  const lastDay=isCurrent?today.getDate():new Date(yyyy,mm,0).getDate();
  const byEmp={};
  allEmployees.forEach(e=>{ byEmp[e._id]={present:0,late:0,absent:0}; });

  // Read each day in parallel via .get (one network call per day; bounded ≤31)
  const days=[];
  for(let d=1;d<=lastDay;d++)days.push(`${monthKey}-${String(d).padStart(2,'0')}`);
  const snaps=await Promise.all(days.map(date=>rtdbGet(rtdbRef(rtdb,`attendance/${date}`)).catch(()=>null)));

  // ── Diagnostic: surface K40 ID mismatches ──
  const firstWithData=snaps.find(s=>s&&s.exists());
  if(firstWithData){
    const sampleKeys=Object.keys(firstWithData.val()||{}).map(k=>`"${k}"`);
    const empIds=allEmployees.map(e=>({name:e.name,k40:e.k40UserId,type:typeof e.k40UserId})).filter(x=>x.k40);
    const empKeys=empIds.map(x=>String(x.k40).trim());
    const matched=sampleKeys.filter(k=>empKeys.includes(k.replace(/^"|"$/g,'')));
    const unmatchedFB=sampleKeys.filter(k=>!empKeys.includes(k.replace(/^"|"$/g,'')));
    const unmatchedEmp=empIds.filter(x=>!sampleKeys.includes(`"${String(x.k40).trim()}"`));
    console.log('[Monthly Att]',monthKey,'sample day Firebase keys:',sampleKeys.join(', '));
    console.log('[Monthly Att] Employee K40 IDs:',empIds);
    console.log('[Monthly Att] Matched:',matched.length,'Unmatched in Firebase:',unmatchedFB,'Employees with no Firebase data:',unmatchedEmp.map(x=>`${x.name}(${x.k40})`));
  } else {
    console.log('[Monthly Att]',monthKey,'no attendance data found for any day in month');
  }

  snaps.forEach((snap,idx)=>{
    const date=days[idx];
    const dayOfWeek=new Date(date+'T00:00:00').getDay(); // 0=Sun ... 6=Sat
    const isSunday=dayOfWeek===0;
    const data=snap&&snap.exists()?snap.val():null;
    const punchesByUser=_attPunchesByUser(data);

    allEmployees.forEach(e=>{
      // Robust K40 lookup: trim + stringify both sides
      const k40=String(e.k40UserId==null?'':e.k40UserId).trim();
      // Skip employees with no K40 device ID (typically management — not tracked by clock)
      if(!k40)return;
      const u=punchesByUser[k40];
      // Present if there is at least one punch record (any type) for the day
      const hasAnyPunch=u&&Array.isArray(u.punches)&&u.punches.length>0;
      if(hasAnyPunch){
        byEmp[e._id].present++;
        if(u.firstIn&&_isLatePunch(u.firstIn,e))byEmp[e._id].late++;
      } else if(!isSunday){
        // Absent only on working days (Mon–Sat). Sundays are off and not counted.
        byEmp[e._id].absent++;
      }
    });
  });

  const result={byEmp,monthKey};
  if(!isCurrent)monthlyAttendanceCache[monthKey]=result;
  return result;
}

// Update owner dashboard KPIs from live data (real-time)
function _updateOwnerLiveKPIs(){
  if(!session||session.role!=='owner')return;
  let inCount=0;
  Object.values(liveAttendanceData||{}).forEach(rec=>{ if(rec&&rec.status==='in')inCount++; });
  const elIn=document.getElementById('owner-kpi-in');if(elIn)elIn.textContent=inCount;
  // Late count today
  const today=new Date().toISOString().split('T')[0];
  if(_attDayUnsub===today&&dailyAttendanceData){
    let lateCount=0;
    const punchesByUser=_attPunchesByUser(dailyAttendanceData);
    const empByK40={};
    allEmployees.forEach(e=>{const k=String(e.k40UserId||'').trim();if(k)empByK40[k]=e;});
    Object.entries(punchesByUser).forEach(([uid,d])=>{
      if(!d.firstIn)return;
      const emp=empByK40[String(uid)];
      if(emp&&_isLatePunch(d.firstIn,emp))lateCount++;
    });
    const elLate=document.getElementById('owner-kpi-late');if(elLate)elLate.textContent=lateCount;
  }
}

// ── Owner dashboard live subscription (kicks in on dashboard render) ──
function _ensureOwnerDashboardLive(){
  if(!session||session.role!=='owner')return;
  // Subscribe to live presence
  if(!_attLiveUnsub){
    const r=rtdbRef(rtdb,'attendance/live');
    rtdbOnValue(r,snap=>{
      liveAttendanceData=snap.exists()?snap.val():{};
      _updateOwnerLiveKPIs();
    });
    _attLiveUnsub=true;
  }
  // Subscribe to today's attendance (for late count)
  const today=new Date().toISOString().split('T')[0];
  if(_attDayUnsub!==today){
    if(_attDayUnsub){try{rtdbOff(rtdbRef(rtdb,`attendance/${_attDayUnsub}`));}catch(_){}_attDayUnsub=null;}
    const r=rtdbRef(rtdb,`attendance/${today}`);
    rtdbOnValue(r,snap=>{
      dailyAttendanceData=snap.exists()?snap.val():{};
      _updateOwnerLiveKPIs();
    });
    _attDayUnsub=today;
  }
}

// ── Window-exposed handlers ──
window.attendanceSetTab=function(tab){
  attendanceTab=tab;
  const m=document.getElementById('main-content');
  if(m){m.innerHTML=renderAttendancePage();_attendanceAfterRender();}
};
window.attendancePrevDay=function(){
  const d=new Date(attendanceDate+'T00:00:00');d.setDate(d.getDate()-1);
  attendanceDate=d.toISOString().split('T')[0];
  const m=document.getElementById('main-content');
  if(m){m.innerHTML=renderAttendancePage();_attendanceAfterRender();}
};
window.attendanceNextDay=function(){
  const today=new Date().toISOString().split('T')[0];
  if(attendanceDate>=today)return;
  const d=new Date(attendanceDate+'T00:00:00');d.setDate(d.getDate()+1);
  attendanceDate=d.toISOString().split('T')[0];
  const m=document.getElementById('main-content');
  if(m){m.innerHTML=renderAttendancePage();_attendanceAfterRender();}
};
window.attendanceSetMonth=function(key){
  attendanceMonth=key;
  _renderAttendanceMonthly();
};

// ───────────────────────────────────────────────────────────
// HRM Session 3 — Payroll Engine
// ───────────────────────────────────────────────────────────

async function loadPayrollData(){
  try{
    const[runsSnap,slipsSnap]=await Promise.all([
      getDocs(query(collection(db,'payroll_runs'),orderBy('month','desc'))).catch(()=>({docs:[]})),
      getDocs(collection(db,'payslips')).catch(()=>({docs:[]}))
    ]);
    allPayrollRuns=runsSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allPayslips=slipsSnap.docs.map(d=>({...d.data(),_id:d.id}));
    payrollDataLoaded=true;
  }catch(e){console.warn('loadPayrollData failed:',e.message);}
}

function _payrollMonthLabel(monthKey){
  if(!monthKey)return'—';
  const[y,m]=monthKey.split('-').map(Number);
  return new Date(y,m-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
}

function _payrollRunFor(monthKey){
  return allPayrollRuns.find(r=>r.month===monthKey)||null;
}

function _payslipsFor(monthKey){
  return allPayslips.filter(s=>s.month===monthKey).sort((a,b)=>(a.employeeName||'').localeCompare(b.employeeName||''));
}

// Calculate a payroll row for a single employee given attendance summary.
function _computeOneRow(emp,att,policies){
  const wd=(policies&&policies.workingDaysPerMonth)||30;
  const present=att?(att.present||0):0;
  const late=att?(att.late||0):0;
  const actualAbsent=att?(att.absent||0):0;
  const lateAbsentEquivalent=Math.floor(late/3);
  const effectiveAbsentDays=actualAbsent+lateAbsentEquivalent;
  const dailyRate=(emp.basicSalary||0)/wd;
  const absentDeduction=Math.round(effectiveAbsentDays*dailyRate);
  const grossSalary=Math.max(0,Math.round((emp.basicSalary||0)-absentDeduction));
  const advanceDeduction=Math.max(0,Math.round(emp.advanceBalance||0));
  const loanDeduction=Math.max(0,Math.round(emp.loanMonthlyDeduction||0));
  const purchasingDeduction=Math.max(0,Math.round(emp.purchasingDeduction||0));
  const otherDeductions=0;
  const totalDeductions=advanceDeduction+loanDeduction+purchasingDeduction+otherDeductions;
  const netPayable=Math.max(0,Math.round(grossSalary-totalDeductions));
  return{
    employeeId:emp._id,
    employeeName:emp.name,
    designation:emp.designation||'',
    department:emp.department||'',
    paygrade:emp.paygrade||'',
    basicSalary:emp.basicSalary||0,
    workingDays:wd,
    presentDays:present,
    lateDays:late,
    lateAbsentEquivalent,
    effectiveAbsentDays,
    actualAbsentDays:actualAbsent,
    dailyRate:Math.round(dailyRate),
    absentDeduction,
    grossSalary,
    advanceDeduction,
    loanDeduction,
    purchasingDeduction,
    otherDeductions,
    totalDeductions,
    netPayable,
    k40UserId:emp.k40UserId||''
  };
}

// Compute live preview rows for a month (no DB writes). Reuses
// _computeMonthlyAttendance from the attendance module.
async function _computePayrollForMonth(monthKey){
  const policies=hrmPolicies||HRM_DEFAULT_POLICIES;
  const summary=await _computeMonthlyAttendance(monthKey);
  const rows=allEmployees.filter(e=>e.status!=='inactive').map(e=>{
    const att=summary&&summary.byEmp&&summary.byEmp[e._id];
    return _computeOneRow(e,att,policies);
  }).sort((a,b)=>(a.employeeName||'').localeCompare(b.employeeName||''));
  const totals=rows.reduce((acc,r)=>({
    basic:acc.basic+r.basicSalary,
    gross:acc.gross+r.grossSalary,
    advance:acc.advance+r.advanceDeduction,
    loan:acc.loan+r.loanDeduction,
    other:acc.other+r.otherDeductions+r.purchasingDeduction,
    deductions:acc.deductions+r.totalDeductions,
    net:acc.net+r.netPayable
  }),{basic:0,gross:0,advance:0,loan:0,other:0,deductions:0,net:0});
  return{rows,totals,monthKey};
}

function renderPayrollPage(){
  if(!_canViewPayroll())return'<div class="empty">Payroll is restricted to Afnan, Ammar and Mustafa.</div>';
  const months=[];
  const now=new Date();
  for(let i=0;i<12;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push({key,lbl:d.toLocaleDateString('en-GB',{month:'long',year:'numeric'})});
  }
  const run=_payrollRunFor(_payrollMonth);
  const status=run?run.status:'draft';
  const statusBadgeBg=status==='paid'?'var(--accent-success-soft)':status==='processed'?'var(--accent-warning-soft)':'#F0F0F0';
  const statusBadgeFg=status==='paid'?'var(--accent-success)':status==='processed'?'var(--accent-warning)':'#555';
  const statusLabel=status==='paid'?'Paid':status==='processed'?'Processed':'Draft';
  const canProcess=_canProcessPayroll();
  const head=`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <div>
      <div class="page-title"><span class="page-title-icon">${_icon('money',22)}</span> Payroll · تنخواہ</div>
      <div class="page-sub">Process and manage monthly salaries</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="payroll-month" onchange="window.payrollSetMonth(this.value)" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:#fff;font-size:13px">
        ${months.map(m=>`<option value="${m.key}" ${m.key===_payrollMonth?'selected':''}>${m.lbl}</option>`).join('')}
      </select>
      ${canProcess&&(!run||run.status!=='paid')?`<button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.processPayroll()">${run?'Re-process Month':'Process Month'}</button>`:''}
      ${canProcess&&run&&run.status==='paid'?`<span style="font-size:11px;color:var(--muted);background:var(--soft);border:1px solid var(--border);padding:8px 12px;border-radius:8px;display:inline-flex;align-items:center;gap:6px">🔒 Locked &mdash; paid ${run.paidAt?new Date(run.paidAt).toLocaleDateString('en-GB'):''}</span>`:''}
    </div>
  </div>`;
  const summary=`<div id="payroll-summary" class="payroll-summary-strip" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:#6B7280;letter-spacing:.06em">Employees</div><div style="font-size:24px;font-weight:700;margin-top:4px" id="pr-sum-count">—</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:#6B7280;letter-spacing:.06em">Gross Salary</div><div style="font-size:18px;font-weight:700;margin-top:4px" id="pr-sum-gross">—</div></div>
    <div class="card" style="padding:14px;background:var(--accent-urgent-soft)"><div style="font-size:10px;text-transform:uppercase;color:var(--accent-urgent);letter-spacing:.06em">Total Deductions</div><div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--accent-urgent)" id="pr-sum-deduct">—</div></div>
    <div class="card" style="padding:14px;background:var(--accent-success-soft)"><div style="font-size:10px;text-transform:uppercase;color:var(--accent-success);letter-spacing:.06em">Net Payable</div><div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--accent-success)" id="pr-sum-net">—</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:#6B7280;letter-spacing:.06em">Status</div><div style="font-size:14px;font-weight:600;margin-top:4px"><span style="background:${statusBadgeBg};color:${statusBadgeFg};padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">${statusLabel}</span></div>${run&&run.processedAt?`<div style="font-size:10px;color:var(--muted);margin-top:6px">Processed by ${run.processedBy||'—'}<br>${new Date(run.processedAt).toLocaleString('en-GB')}</div>`:''}</div>
  </div>`;
  const tableShell=`<div class="card" style="padding:0;overflow:auto">
    <table class="payroll-table" style="width:100%;border-collapse:collapse;font-size:12px;min-width:1000px">
      <thead>
        <tr style="background:#1A1A2E;color:white">
          <th style="padding:10px 8px;text-align:left">#</th>
          <th style="padding:10px 8px;text-align:left">Employee</th>
          <th style="padding:10px 8px;text-align:left">Department</th>
          <th style="padding:10px 8px;text-align:center">Grade</th>
          <th style="padding:10px 8px;text-align:right">Basic</th>
          <th style="padding:10px 8px;text-align:center">Days</th>
          <th style="padding:10px 8px;text-align:center" title="Days present">Present</th>
          <th style="padding:10px 8px;text-align:center" title="Effective absent (incl. late→absent)">Absent</th>
          <th style="padding:10px 8px;text-align:right">Gross</th>
          <th style="padding:10px 8px;text-align:right">Advance</th>
          <th style="padding:10px 8px;text-align:right">Loan</th>
          <th style="padding:10px 8px;text-align:right">Other</th>
          <th style="padding:10px 8px;text-align:right;background:var(--accent-success);color:#fff">Net Salary</th>
          <th style="padding:10px 8px;text-align:center"></th>
        </tr>
      </thead>
      <tbody id="payroll-tbody"><tr><td colspan="14" style="padding:18px;text-align:center;color:var(--muted)">Loading payroll…</td></tr></tbody>
      <tfoot id="payroll-tfoot"></tfoot>
    </table>
  </div>`;
  const actions=canProcess?`<div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;flex-wrap:wrap">
    <button class="btn-outline" onclick="window.exportPayrollPDF()" style="font-size:13px">📄 Export PDF</button>
    <button class="btn-outline" onclick="window.exportPayrollExcel()" style="font-size:13px">📊 Export Excel</button>
    ${run&&run.status==='processed'?`<button class="btn-primary" style="width:auto;padding:8px 18px;margin-top:0" onclick="window.markAllPaid()">Mark Month as Paid</button>`:''}
  </div>`:'';
  return head+summary+tableShell+actions;
}

async function _payrollAfterRender(){
  if(currentPage!=='hrm-payroll')return;
  const tbody=document.getElementById('payroll-tbody');
  if(!tbody)return;
  const run=_payrollRunFor(_payrollMonth);
  let rows,totals;
  if(run){
    // Use saved payslips
    const slips=_payslipsFor(_payrollMonth);
    rows=slips.map(s=>({
      ...s,
      employeeId:s.employeeId,
      employeeName:s.employeeName,
      designation:s.designation,
      department:s.department||'',
      paygrade:s.paygrade,
      _payslipId:s._id,
      _status:s.status||'draft'
    }));
    totals=rows.reduce((a,r)=>({
      basic:a.basic+(r.basicSalary||0),
      gross:a.gross+(r.grossSalary||0),
      advance:a.advance+(r.advanceDeduction||0),
      loan:a.loan+(r.loanDeduction||0),
      other:a.other+((r.otherDeductions||0)+(r.purchasingDeduction||0)),
      deductions:a.deductions+(r.totalDeductions||0),
      net:a.net+(r.netPayable||0)
    }),{basic:0,gross:0,advance:0,loan:0,other:0,deductions:0,net:0});
  } else {
    // Live preview from current attendance + employee state
    const calc=await _computePayrollForMonth(_payrollMonth);
    rows=calc.rows;
    totals=calc.totals;
  }
  _payrollComputed={rows,totals,monthKey:_payrollMonth};
  // Summary KPI cards
  const eC=document.getElementById('pr-sum-count');if(eC)eC.textContent=rows.length;
  const eG=document.getElementById('pr-sum-gross');if(eG)eG.textContent=_hrmFmtPKR(totals.gross);
  const eD=document.getElementById('pr-sum-deduct');if(eD)eD.textContent=_hrmFmtPKR(totals.deductions);
  const eN=document.getElementById('pr-sum-net');if(eN)eN.textContent=_hrmFmtPKR(totals.net);
  // Body rows
  tbody.innerHTML=rows.map((r,idx)=>_payrollRowHTML(r,idx+1,!!run)).join('');
  // Footer totals
  const tfoot=document.getElementById('payroll-tfoot');
  if(tfoot){
    tfoot.innerHTML=`<tr style="background:#1A1A2E;color:white;font-weight:700">
      <td colspan="4" style="padding:12px 8px">TOTAL</td>
      <td style="padding:12px 8px;text-align:right">${_hrmFmtPKR(totals.basic)}</td>
      <td colspan="3"></td>
      <td style="padding:12px 8px;text-align:right">${_hrmFmtPKR(totals.gross)}</td>
      <td style="padding:12px 8px;text-align:right">- ${_hrmFmtPKR(totals.advance)}</td>
      <td style="padding:12px 8px;text-align:right">- ${_hrmFmtPKR(totals.loan)}</td>
      <td style="padding:12px 8px;text-align:right">- ${_hrmFmtPKR(totals.other)}</td>
      <td style="padding:12px 8px;text-align:right;background:var(--accent-success);color:#fff">${_hrmFmtPKR(totals.net)}</td>
      <td></td>
    </tr>`;
  }
}

function _payrollRowHTML(r,idx,saved){
  const pgClass=(r.paygrade||'').toLowerCase();
  let rowBg='';
  if((r.lateAbsentEquivalent||0)>=1&&(r.actualAbsentDays||0)>=2)rowBg='background:var(--accent-urgent-soft)';
  else if((r.advanceDeduction||0)>0&&(r.loanDeduction||0)>0)rowBg='background:var(--accent-warning-soft)';
  else if(idx%2===0)rowBg='background:#FAFAFA';
  const statusBadge=saved&&r._status==='paid'?`<span style="background:var(--accent-success-soft);color:var(--accent-success);padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;letter-spacing:.04em">PAID</span>`:'';
  return`<tr style="${rowBg};border-bottom:1px solid var(--border)">
    <td style="padding:10px 8px">${idx}</td>
    <td style="padding:10px 8px"><div style="font-weight:600">${r.employeeName||'—'}</div><div style="font-size:11px;color:var(--muted)">${r.designation||'—'}</div></td>
    <td style="padding:10px 8px;color:var(--muted)">${r.department||'—'}</td>
    <td style="padding:10px 8px;text-align:center"><span class="paygrade-badge ${pgClass}">${r.paygrade||'—'}</span></td>
    <td style="padding:10px 8px;text-align:right">${_hrmFmtPKR(r.basicSalary)}</td>
    <td style="padding:10px 8px;text-align:center">${r.workingDays||30}</td>
    <td style="padding:10px 8px;text-align:center;color:var(--accent-success);font-weight:600">${r.presentDays||0}</td>
    <td style="padding:10px 8px;text-align:center;color:var(--accent-urgent);font-weight:600">${r.effectiveAbsentDays||0}</td>
    <td style="padding:10px 8px;text-align:right;font-weight:600">${_hrmFmtPKR(r.grossSalary)}</td>
    <td style="padding:10px 8px;text-align:right;color:var(--accent-urgent)">${(r.advanceDeduction||0)>0?'- ':''}${_hrmFmtPKR(r.advanceDeduction)}</td>
    <td style="padding:10px 8px;text-align:right">${(r.loanDeduction||0)>0?'- ':''}${_hrmFmtPKR(r.loanDeduction)}</td>
    <td style="padding:10px 8px;text-align:right">${((r.otherDeductions||0)+(r.purchasingDeduction||0))>0?'- ':''}${_hrmFmtPKR((r.otherDeductions||0)+(r.purchasingDeduction||0))}</td>
    <td style="padding:10px 8px;text-align:right;font-weight:700;background:var(--accent-success-soft);color:var(--accent-success)">${_hrmFmtPKR(r.netPayable)}</td>
    <td style="padding:10px 8px;text-align:center;white-space:nowrap">${statusBadge} <button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="window.openPayslip('${r._payslipId||''}','${r.employeeId}')">View</button></td>
  </tr>`;
}

window.payrollSetMonth=function(key){
  _payrollMonth=key;
  const m=document.getElementById('main-content');
  if(m){m.innerHTML=renderPayrollPage();_payrollAfterRender();}
};

window.processPayroll=async function(){
  if(!_canProcessPayroll())return showToast('Only Afnan or Ammar can process payroll.',true);
  const monthKey=_payrollMonth;
  const monthLabel=_payrollMonthLabel(monthKey);
  const existing=_payrollRunFor(monthKey);
  // #1B — paid lock: refuse to recompute a month that has been marked paid.
  if(existing&&existing.status==='paid'){
    showToast('This month is already paid and locked. Re-processing is disabled.',true);
    return;
  }
  // #3 — mid-month guard: warn before processing the current month early,
  // since un-elapsed weekdays would all count as absent.
  const todayKey=new Date().toISOString().slice(0,7);
  if(monthKey===todayKey){
    const now=new Date();
    const lastDayOfMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    const daysRemaining=lastDayOfMonth-now.getDate();
    if(daysRemaining>0){
      if(!confirm(`${monthLabel} isn't over yet — ${daysRemaining} day${daysRemaining===1?'':'s'} remaining.\n\nProcessing now will count those un-elapsed days as absent for everyone, leading to over-deductions.\n\nAre you sure you want to process anyway?`))return;
    }
  }
  const verb=existing?'Re-process':'Process';
  if(!confirm(`${verb} payroll for ${monthLabel}?\n\nThis will calculate salaries from current attendance data and create draft payslips. No money is moved until you 'Mark Month as Paid'.`))return;
  showToast('Processing payroll…');
  try{
    const calc=await _computePayrollForMonth(monthKey);
    // Wipe any existing payslips for this month
    if(existing){
      const existingSlips=allPayslips.filter(s=>s.month===monthKey);
      for(const s of existingSlips){
        try{await deleteDoc(doc(db,'payslips',s._id));}catch(_){}
      }
      allPayslips=allPayslips.filter(s=>s.month!==monthKey);
    }
    // Create payroll_runs doc
    const runRef=existing?doc(db,'payroll_runs',existing._id):doc(collection(db,'payroll_runs'));
    const[yyyy,mm]=monthKey.split('-').map(Number);
    const runData={
      id:runRef.id,
      month:monthKey,
      year:yyyy,
      monthName:new Date(yyyy,mm-1,1).toLocaleDateString('en-GB',{month:'long'}),
      status:'processed',
      processedBy:session.name,
      processedAt:Date.now(),
      totalEmployees:calc.rows.length,
      totalGrossSalary:calc.totals.gross,
      totalDeductions:calc.totals.deductions,
      totalNetPayable:calc.totals.net,
      totalAdvanceCleared:0,
      totalLoanCleared:0,
      notes:''
    };
    await setDoc(runRef,runData);
    // Create payslips
    const batch=writeBatch(db);
    const newSlips=[];
    for(const r of calc.rows){
      const slipRef=doc(collection(db,'payslips'));
      const slipData={
        id:slipRef.id,
        payrollRunId:runRef.id,
        month:monthKey,
        employeeId:r.employeeId,
        employeeName:r.employeeName,
        designation:r.designation,
        department:r.department,
        paygrade:r.paygrade,
        basicSalary:r.basicSalary,
        workingDays:r.workingDays,
        presentDays:r.presentDays,
        lateDays:r.lateDays,
        lateAbsentEquivalent:r.lateAbsentEquivalent,
        effectiveAbsentDays:r.effectiveAbsentDays,
        actualAbsentDays:r.actualAbsentDays,
        dailyRate:r.dailyRate,
        absentDeduction:r.absentDeduction,
        grossSalary:r.grossSalary,
        advanceDeduction:r.advanceDeduction,
        loanDeduction:r.loanDeduction,
        purchasingDeduction:r.purchasingDeduction,
        otherDeductions:r.otherDeductions,
        totalDeductions:r.totalDeductions,
        netPayable:r.netPayable,
        status:'draft',
        paidVia:'',
        paidOn:'',
        paidBy:'',
        notes:'',
        manualAdjustments:[]
      };
      batch.set(slipRef,slipData);
      newSlips.push({...slipData,_id:slipRef.id});
    }
    await batch.commit();
    // Update local state
    if(existing){
      const i=allPayrollRuns.findIndex(x=>x._id===existing._id);
      if(i>=0)allPayrollRuns[i]={...runData,_id:runRef.id};
    } else {
      allPayrollRuns.unshift({...runData,_id:runRef.id});
    }
    allPayslips=allPayslips.concat(newSlips);
    await logActivity('Payroll processed',`${monthLabel} — ${calc.rows.length} employees · ${_hrmFmtPKR(calc.totals.net)} net`);
    showToast(`Payroll processed for ${monthLabel} · ${calc.rows.length} employees · ${_hrmFmtPKR(calc.totals.net)} net`);
    const m=document.getElementById('main-content');
    if(m){m.innerHTML=renderPayrollPage();_payrollAfterRender();}
  }catch(e){showToast('Payroll error: '+e.message,true);}
};

window.markAllPaid=async function(){
  if(!_canProcessPayroll())return showToast('Only Afnan or Ammar can mark payroll paid.',true);
  const monthKey=_payrollMonth;
  const run=_payrollRunFor(monthKey);
  if(!run||run.status!=='processed')return showToast('Process the month first.',true);
  const slips=_payslipsFor(monthKey);
  if(!slips.length)return showToast('No payslips to mark paid.',true);
  const totalNet=slips.reduce((s,x)=>s+(x.netPayable||0),0);
  const totalAdv=slips.reduce((s,x)=>s+(x.advanceDeduction||0),0);
  const totalLoan=slips.reduce((s,x)=>s+(x.loanDeduction||0),0);
  if(!confirm(`Mark all ${slips.length} employees paid for ${_payrollMonthLabel(monthKey)}?\n\n• Each payslip status → paid\n• Advance balances cleared (− ${_hrmFmtPKR(totalAdv)})\n• Loan balances reduced (− ${_hrmFmtPKR(totalLoan)})\n• Net disbursed: ${_hrmFmtPKR(totalNet)}\n• Payroll for this month is then locked.`))return;
  showToast('Marking payroll paid…');
  try{
    const paidAt=Date.now();
    const paidOn=new Date().toISOString().split('T')[0];
    const batch=writeBatch(db);
    // Update payslips
    for(const s of slips){
      batch.update(doc(db,'payslips',s._id),{status:'paid',paidOn,paidBy:session.name,paidAt});
    }
    // Update employee balances
    for(const s of slips){
      const emp=allEmployees.find(e=>e._id===s.employeeId);
      if(!emp)continue;
      const newAdvance=Math.max(0,(emp.advanceBalance||0)-(s.advanceDeduction||0));
      const newLoan=Math.max(0,(emp.loanBalance||0)-(s.loanDeduction||0));
      batch.update(doc(db,'employees',emp._id),{advanceBalance:newAdvance,loanBalance:newLoan,updatedAt:paidAt});
    }
    // Update payroll_runs
    batch.update(doc(db,'payroll_runs',run._id),{status:'paid',totalAdvanceCleared:totalAdv,totalLoanCleared:totalLoan,paidAt,paidBy:session.name});
    await batch.commit();
    // Local state
    slips.forEach(s=>{ s.status='paid';s.paidOn=paidOn;s.paidBy=session.name;s.paidAt=paidAt; });
    slips.forEach(s=>{
      const emp=allEmployees.find(e=>e._id===s.employeeId);
      if(emp){emp.advanceBalance=Math.max(0,(emp.advanceBalance||0)-(s.advanceDeduction||0));emp.loanBalance=Math.max(0,(emp.loanBalance||0)-(s.loanDeduction||0));}
    });
    const i=allPayrollRuns.findIndex(x=>x._id===run._id);
    if(i>=0){allPayrollRuns[i]={...allPayrollRuns[i],status:'paid',totalAdvanceCleared:totalAdv,totalLoanCleared:totalLoan,paidAt,paidBy:session.name};}
    await logActivity('Payroll paid',`${_payrollMonthLabel(monthKey)} — ${slips.length} employees · ${_hrmFmtPKR(totalNet)} net`);
    showToast(`${slips.length} employees marked paid · ${_hrmFmtPKR(totalNet)}`);
    const m=document.getElementById('main-content');
    if(m){m.innerHTML=renderPayrollPage();_payrollAfterRender();}
  }catch(e){showToast('Mark-paid failed: '+e.message,true);}
};

window.openPayslip=function(slipId,employeeId){
  // For unprocessed months, slipId is empty — build a virtual preview from _payrollComputed
  let slip=null;
  if(slipId){
    slip=allPayslips.find(s=>s._id===slipId);
  } else if(_payrollComputed){
    const r=_payrollComputed.rows.find(x=>x.employeeId===employeeId);
    if(r)slip={...r,month:_payrollMonth,status:'preview',_id:''};
  }
  if(!slip)return showToast('Payslip not found.',true);
  _payslipViewingId=slip._id||employeeId;
  const monthLabel=_payrollMonthLabel(slip.month||_payrollMonth);
  const pgClass=(slip.paygrade||'').toLowerCase();
  const isPreview=slip.status==='preview';
  const isPaid=slip.status==='paid';
  const canEdit=_canProcessPayroll()&&!isPreview;
  const canMarkPaid=_canProcessPayroll()&&!isPaid&&!isPreview;
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';
  back.id='hrm-modal-back';
  back.onclick=ev=>{ if(ev.target===back)window.hrmCloseModal(); };
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:520px;padding:0;overflow:hidden">
    <div style="background:#1A1A2E;color:white;padding:20px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div style="min-width:0">
          <div style="font-size:11px;letter-spacing:.06em;opacity:.6">PAYSLIP · سلپ${isPreview?' · PREVIEW':''}</div>
          <div style="margin:4px 0 0;font-size:20px;font-weight:700">${slip.employeeName||'—'}</div>
          <div style="font-size:13px;opacity:.8">${slip.designation||'—'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;opacity:.7">${monthLabel}</div>
          <span class="paygrade-badge ${pgClass}" style="margin-top:6px;display:inline-block">${slip.paygrade||'—'}</span>
        </div>
      </div>
    </div>
    <div style="padding:20px">
      <div style="font-size:11px;text-transform:uppercase;color:var(--accent-success);letter-spacing:.06em;margin-bottom:8px;font-weight:700">EARNINGS · آمدنی</div>
      <table style="width:100%;font-size:14px">
        <tr><td style="padding:4px 0">Basic Salary</td><td style="text-align:right;padding:4px 0">${_hrmFmtPKR(slip.basicSalary)}</td></tr>
      </table>
    </div>
    <div style="padding:0 20px 20px">
      <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em;margin-bottom:8px;font-weight:700">ATTENDANCE · حاضری</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        <div style="background:var(--accent-success-soft);padding:8px;border-radius:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:var(--accent-success)">${slip.presentDays||0}</div><div style="font-size:10px;color:#6B7280">Present</div></div>
        <div style="background:var(--accent-warning-soft);padding:8px;border-radius:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:var(--accent-warning)">${slip.lateDays||0}</div><div style="font-size:10px;color:#6B7280">Late</div></div>
        <div style="background:var(--accent-warning-soft);padding:8px;border-radius:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:var(--accent-warning)">${slip.lateAbsentEquivalent||0}</div><div style="font-size:10px;color:#6B7280">Late→Abs</div></div>
        <div style="background:var(--accent-urgent-soft);padding:8px;border-radius:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:var(--accent-urgent)">${slip.actualAbsentDays||((slip.effectiveAbsentDays||0)-(slip.lateAbsentEquivalent||0))||0}</div><div style="font-size:10px;color:#6B7280">Absent</div></div>
      </div>
    </div>
    <div style="padding:0 20px 20px">
      <div style="font-size:11px;text-transform:uppercase;color:var(--accent-urgent);letter-spacing:.06em;margin-bottom:8px;font-weight:700">DEDUCTIONS · کٹوتیاں</div>
      <table style="width:100%;font-size:14px;color:var(--accent-urgent)">
        <tr><td style="padding:4px 0">Absent Deduction (${slip.effectiveAbsentDays||0} days × ${_hrmFmtPKR(slip.dailyRate)})</td><td style="text-align:right;padding:4px 0">- ${_hrmFmtPKR(slip.absentDeduction)}</td></tr>
        <tr><td style="padding:4px 0">Advance Deduction</td><td style="text-align:right;padding:4px 0">- ${_hrmFmtPKR(slip.advanceDeduction)}</td></tr>
        <tr><td style="padding:4px 0">Loan Deduction</td><td style="text-align:right;padding:4px 0">- ${_hrmFmtPKR(slip.loanDeduction)}</td></tr>
        <tr><td style="padding:4px 0">Other / Purchasing</td><td style="text-align:right;padding:4px 0">- ${_hrmFmtPKR((slip.purchasingDeduction||0)+(slip.otherDeductions||0))}</td></tr>
      </table>
    </div>
    <div style="background:var(--accent-success-soft);padding:18px 20px;border-top:2px solid var(--accent-success)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div>
          <div style="font-size:11px;text-transform:uppercase;color:var(--accent-success);letter-spacing:.06em;font-weight:700">NET PAYABLE</div>
          <div style="font-size:11px;color:#6B7280;margin-top:2px">صافی قابل ادائیگی</div>
        </div>
        <div style="font-size:26px;font-weight:700;color:var(--accent-success)">${_hrmFmtPKR(slip.netPayable)}</div>
      </div>
      ${isPaid?`<div style="margin-top:8px;font-size:11px;color:var(--muted)">Paid on ${slip.paidOn||'—'} by ${slip.paidBy||'—'}</div>`:''}
    </div>
    <div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-outline" style="flex:1;font-size:12px" onclick="window.downloadPayslipPDF('${slip._id||''}','${employeeId||slip.employeeId}')">📄 Download</button>
      ${canEdit?`<button class="btn-outline" style="flex:1;font-size:12px" onclick="window.editPayslip('${slip._id}')">✏ Edit</button>`:''}
      ${canMarkPaid?`<button class="btn-primary" style="flex:1;width:auto;padding:8px 16px;margin-top:0;font-size:12px" onclick="window.markPayslipPaid('${slip._id}')">Mark Paid</button>`:''}
      <button class="btn-outline" style="flex:1;font-size:12px" onclick="window.hrmCloseModal()">Close</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window.markPayslipPaid=async function(slipId){
  if(!_canProcessPayroll())return showToast('Owners only.',true);
  const slip=allPayslips.find(s=>s._id===slipId);
  if(!slip)return;
  if(slip.status==='paid')return showToast('Already paid.');
  if(!confirm(`Mark ${slip.employeeName} paid for ${_payrollMonthLabel(slip.month)}?\nNet: ${_hrmFmtPKR(slip.netPayable)}\nAdvance cleared: ${_hrmFmtPKR(slip.advanceDeduction)}\nLoan cleared: ${_hrmFmtPKR(slip.loanDeduction)}`))return;
  try{
    const paidOn=new Date().toISOString().split('T')[0];
    const paidAt=Date.now();
    const batch=writeBatch(db);
    batch.update(doc(db,'payslips',slipId),{status:'paid',paidOn,paidBy:session.name,paidAt});
    const emp=allEmployees.find(e=>e._id===slip.employeeId);
    if(emp){
      const newAdv=Math.max(0,(emp.advanceBalance||0)-(slip.advanceDeduction||0));
      const newLoan=Math.max(0,(emp.loanBalance||0)-(slip.loanDeduction||0));
      batch.update(doc(db,'employees',emp._id),{advanceBalance:newAdv,loanBalance:newLoan,updatedAt:paidAt});
      emp.advanceBalance=newAdv;emp.loanBalance=newLoan;
    }
    await batch.commit();
    Object.assign(slip,{status:'paid',paidOn,paidBy:session.name,paidAt});
    await logActivity('Payslip paid',`${slip.employeeName} · ${_hrmFmtPKR(slip.netPayable)}`);
    showToast(`${slip.employeeName} marked paid ✓`);
    window.hrmCloseModal();
    if(currentPage==='hrm-payroll'){const m=document.getElementById('main-content');if(m){m.innerHTML=renderPayrollPage();_payrollAfterRender();}}
  }catch(e){showToast('Mark paid failed: '+e.message,true);}
};

window.editPayslip=function(slipId){
  if(!_canProcessPayroll())return showToast('Owners only.',true);
  const s=allPayslips.find(x=>x._id===slipId);
  if(!s)return;
  document.getElementById('hrm-modal-back')?.remove();
  const back=document.createElement('div');
  back.className='hrm-modal-back';
  back.id='hrm-modal-back';
  back.onclick=ev=>{ if(ev.target===back)window.hrmCloseModal(); };
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:520px">
    <h3>Edit Payslip — ${s.employeeName}</h3>
    <div class="sub">${_payrollMonthLabel(s.month)} · Manual override (logs original values)</div>
    <div class="hrm-grid-2">
      <div class="field"><label>Present Days</label><input id="ps-present" type="number" value="${s.presentDays||0}"></div>
      <div class="field"><label>Late Days</label><input id="ps-late" type="number" value="${s.lateDays||0}"></div>
      <div class="field"><label>Effective Absent Days</label><input id="ps-absent" type="number" value="${s.effectiveAbsentDays||0}"></div>
      <div class="field"><label>Advance Deduction</label><input id="ps-adv" type="number" value="${s.advanceDeduction||0}"></div>
      <div class="field"><label>Loan Deduction</label><input id="ps-loan" type="number" value="${s.loanDeduction||0}"></div>
      <div class="field"><label>Other Deductions</label><input id="ps-other" type="number" value="${(s.otherDeductions||0)+(s.purchasingDeduction||0)}"></div>
      <div class="field"><label>Bonus / Add-back</label><input id="ps-bonus" type="number" value="0"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Reason / Notes *</label><textarea id="ps-reason" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px"></textarea></div>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.savePayslipEdit('${slipId}')">Save Override</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window.savePayslipEdit=async function(slipId){
  if(!_canProcessPayroll())return showToast('Owners only.',true);
  const s=allPayslips.find(x=>x._id===slipId);
  if(!s)return;
  const reason=document.getElementById('ps-reason')?.value?.trim()||'';
  if(!reason)return showToast('Reason is required for manual override.',true);
  const num=k=>Number(document.getElementById(k)?.value||0);
  const newPresent=num('ps-present');
  const newLate=num('ps-late');
  const newAbsent=num('ps-absent');
  const newAdv=num('ps-adv');
  const newLoan=num('ps-loan');
  const newOther=num('ps-other');
  const bonus=num('ps-bonus');
  const wd=s.workingDays||30;
  const dailyRate=Math.round((s.basicSalary||0)/wd);
  const newAbsentDed=Math.round(newAbsent*dailyRate);
  const newGross=Math.max(0,Math.round((s.basicSalary||0)-newAbsentDed+bonus));
  const newTotalDed=newAdv+newLoan+newOther;
  const newNet=Math.max(0,newGross-newTotalDed);
  const adjustments=Array.isArray(s.manualAdjustments)?s.manualAdjustments.slice():[];
  const diff={};
  ['presentDays','lateDays','effectiveAbsentDays','advanceDeduction','loanDeduction'].forEach((k,i)=>{
    const newVal=[newPresent,newLate,newAbsent,newAdv,newLoan][i];
    if(newVal!==s[k])diff[k]={old:s[k],new:newVal};
  });
  if(((s.otherDeductions||0)+(s.purchasingDeduction||0))!==newOther)diff.other={old:(s.otherDeductions||0)+(s.purchasingDeduction||0),new:newOther};
  if(bonus)diff.bonus={old:0,new:bonus};
  adjustments.push({by:session.name,at:Date.now(),reason,changes:diff});
  const update={
    presentDays:newPresent,
    lateDays:newLate,
    effectiveAbsentDays:newAbsent,
    lateAbsentEquivalent:Math.floor(newLate/3),
    actualAbsentDays:Math.max(0,newAbsent-Math.floor(newLate/3)),
    absentDeduction:newAbsentDed,
    grossSalary:newGross,
    advanceDeduction:newAdv,
    loanDeduction:newLoan,
    otherDeductions:newOther,
    purchasingDeduction:0,
    totalDeductions:newTotalDed,
    netPayable:newNet,
    manualAdjustments:adjustments
  };
  try{
    await updateDoc(doc(db,'payslips',slipId),update);
    Object.assign(s,update);
    // Recompute the run-level totals
    const run=_payrollRunFor(s.month);
    if(run){
      const slips=_payslipsFor(s.month);
      const newTotals={
        gross:slips.reduce((a,x)=>a+(x.grossSalary||0),0),
        deductions:slips.reduce((a,x)=>a+(x.totalDeductions||0),0),
        net:slips.reduce((a,x)=>a+(x.netPayable||0),0)
      };
      await updateDoc(doc(db,'payroll_runs',run._id),{totalGrossSalary:newTotals.gross,totalDeductions:newTotals.deductions,totalNetPayable:newTotals.net});
      Object.assign(run,{totalGrossSalary:newTotals.gross,totalDeductions:newTotals.deductions,totalNetPayable:newTotals.net});
    }
    await logActivity('Payslip override',`${s.employeeName} · ${reason}`);
    showToast('Override saved ✓');
    window.hrmCloseModal();
    if(currentPage==='hrm-payroll'){const m=document.getElementById('main-content');if(m){m.innerHTML=renderPayrollPage();_payrollAfterRender();}}
  }catch(e){showToast('Save failed: '+e.message,true);}
};

// ── Exports ──
window.exportPayrollExcel=function(){
  if(!_payrollComputed||!_payrollComputed.rows.length)return showToast('Process the month first.',true);
  if(typeof XLSX==='undefined')return showToast('Excel library not loaded yet, retry in a moment.',true);
  const monthLabel=_payrollMonthLabel(_payrollComputed.monthKey);
  const header=['#','Employee','Designation','Department','Grade','Basic','Days','Present','Late','Late→Abs','Effective Absent','Daily Rate','Absent Deduction','Gross','Advance','Loan','Other','Total Deductions','Net Salary'];
  const data=[
    [`Groovy Operations — Salary Sheet ${monthLabel}`],
    [],
    header
  ];
  _payrollComputed.rows.forEach((r,i)=>{
    data.push([
      i+1,r.employeeName,r.designation,r.department,r.paygrade,r.basicSalary,r.workingDays,
      r.presentDays,r.lateDays,r.lateAbsentEquivalent,r.effectiveAbsentDays,r.dailyRate,
      r.absentDeduction,r.grossSalary,r.advanceDeduction,r.loanDeduction,
      (r.otherDeductions||0)+(r.purchasingDeduction||0),r.totalDeductions,r.netPayable
    ]);
  });
  const t=_payrollComputed.totals;
  data.push([]);
  data.push(['','TOTAL','','','','','','','','','','','',t.gross,t.advance,t.loan,t.other,t.deductions,t.net]);
  const ws=XLSX.utils.aoa_to_sheet(data);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Salary');
  XLSX.writeFile(wb,`Groovy-Salary-${_payrollComputed.monthKey}.xlsx`);
};

window.exportPayrollPDF=function(){
  if(!_payrollComputed||!_payrollComputed.rows.length)return showToast('Process the month first.',true);
  if(!window.jspdf)return showToast('PDF library not loaded yet, retry in a moment.',true);
  const{jsPDF}=window.jspdf;
  const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'landscape'});
  const monthLabel=_payrollMonthLabel(_payrollComputed.monthKey);
  pdf.setFont('helvetica','bold');pdf.setFontSize(14);
  pdf.text('Groovy Operations — Salary Sheet',14,14);
  pdf.setFont('helvetica','normal');pdf.setFontSize(10);
  pdf.text(monthLabel,14,20);
  pdf.text(`Prepared by: ${session.name}`,14,25);
  pdf.text(`Generated: ${new Date().toLocaleString('en-GB')}`,14,30);
  // Table
  const cols=['#','Employee','Grade','Basic','Days','P','A','Gross','Advance','Loan','Other','Net'];
  const colWidths=[8,52,12,20,10,10,10,22,22,18,18,24];
  let x=14,y=40;
  pdf.setFillColor(26,26,46);pdf.setTextColor(255);pdf.setFont('helvetica','bold');pdf.setFontSize(9);
  pdf.rect(14,y-5,colWidths.reduce((a,b)=>a+b,0),7,'F');
  cols.forEach((c,i)=>{pdf.text(c,x+1,y);x+=colWidths[i];});
  y+=4;pdf.setTextColor(0);pdf.setFont('helvetica','normal');pdf.setFontSize(8);
  _payrollComputed.rows.forEach((r,idx)=>{
    if(y>195){pdf.addPage();y=20;}
    x=14;
    const cells=[String(idx+1),(r.employeeName||'').slice(0,28),r.paygrade||'',_hrmFmtPKR(r.basicSalary).replace('PKR ',''),String(r.workingDays||30),String(r.presentDays||0),String(r.effectiveAbsentDays||0),_hrmFmtPKR(r.grossSalary).replace('PKR ',''),_hrmFmtPKR(r.advanceDeduction).replace('PKR ',''),_hrmFmtPKR(r.loanDeduction).replace('PKR ',''),_hrmFmtPKR((r.otherDeductions||0)+(r.purchasingDeduction||0)).replace('PKR ',''),_hrmFmtPKR(r.netPayable).replace('PKR ','')];
    if(idx%2===0){pdf.setFillColor(248,248,248);pdf.rect(14,y-3,colWidths.reduce((a,b)=>a+b,0),5,'F');}
    cells.forEach((c,i)=>{pdf.text(c,x+1,y);x+=colWidths[i];});
    y+=5;
  });
  // Totals
  const t=_payrollComputed.totals;
  if(y>190){pdf.addPage();y=20;}
  x=14;y+=2;
  pdf.setFillColor(26,26,46);pdf.setTextColor(255);pdf.setFont('helvetica','bold');pdf.setFontSize(9);
  pdf.rect(14,y-3,colWidths.reduce((a,b)=>a+b,0),6,'F');
  const totals=['','TOTAL','','','','','',_hrmFmtPKR(t.gross).replace('PKR ',''),_hrmFmtPKR(t.advance).replace('PKR ',''),_hrmFmtPKR(t.loan).replace('PKR ',''),_hrmFmtPKR(t.other).replace('PKR ',''),_hrmFmtPKR(t.net).replace('PKR ','')];
  totals.forEach((c,i)=>{pdf.text(c,x+1,y);x+=colWidths[i];});
  y+=14;pdf.setTextColor(0);pdf.setFont('helvetica','normal');pdf.setFontSize(9);
  pdf.text('Approved by: __________________________',14,y);
  pdf.text(`Date: __________________`,200,y);
  pdf.save(`Groovy-Salary-${_payrollComputed.monthKey}.pdf`);
};

window.downloadPayslipPDF=function(slipId,employeeId){
  if(!window.jspdf)return showToast('PDF library not loaded yet.',true);
  let slip=null;
  if(slipId)slip=allPayslips.find(s=>s._id===slipId);
  else if(_payrollComputed){
    const r=_payrollComputed.rows.find(x=>x.employeeId===employeeId);
    if(r)slip={...r,month:_payrollMonth};
  }
  if(!slip)return showToast('Payslip not found.',true);
  const{jsPDF}=window.jspdf;
  const pdf=new jsPDF({unit:'mm',format:'a4'});
  const monthLabel=_payrollMonthLabel(slip.month||_payrollMonth);
  // Header band
  pdf.setFillColor(26,26,46);pdf.rect(0,0,210,30,'F');
  pdf.setTextColor(255);pdf.setFont('helvetica','bold');pdf.setFontSize(10);
  pdf.text('PAYSLIP · سلپ',14,12);
  pdf.setFontSize(16);pdf.text(slip.employeeName||'—',14,21);
  pdf.setFont('helvetica','normal');pdf.setFontSize(9);
  pdf.text(slip.designation||'',14,27);
  pdf.setFontSize(10);pdf.text(monthLabel,196,12,{align:'right'});
  pdf.text(`Grade ${slip.paygrade||'—'}`,196,21,{align:'right'});
  // Body
  pdf.setTextColor(0);pdf.setFont('helvetica','bold');pdf.setFontSize(10);
  pdf.text('EARNINGS · آمدنی',14,42);
  pdf.setFont('helvetica','normal');
  pdf.text('Basic Salary',14,49);
  pdf.text(_hrmFmtPKR(slip.basicSalary),196,49,{align:'right'});
  pdf.setFont('helvetica','bold');pdf.text('ATTENDANCE · حاضری',14,60);
  pdf.setFont('helvetica','normal');
  const att=`Present ${slip.presentDays||0}    Late ${slip.lateDays||0}    Late→Abs ${slip.lateAbsentEquivalent||0}    Absent ${slip.actualAbsentDays||0}`;
  pdf.text(att,14,67);
  pdf.setFont('helvetica','bold');pdf.text('DEDUCTIONS · کٹوتیاں',14,78);
  pdf.setFont('helvetica','normal');
  let yy=85;
  const ded=[
    ['Absent Deduction',slip.absentDeduction],
    ['Advance',slip.advanceDeduction],
    ['Loan',slip.loanDeduction],
    ['Other / Purchasing',(slip.otherDeductions||0)+(slip.purchasingDeduction||0)]
  ];
  ded.forEach(([lbl,v])=>{ pdf.text(lbl,14,yy);pdf.text('- '+_hrmFmtPKR(v),196,yy,{align:'right'});yy+=6; });
  // Net payable band
  pdf.setFillColor(230,239,233);pdf.rect(0,yy+4,210,18,'F');
  pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.setTextColor(20,83,45);
  pdf.text('NET PAYABLE · صافی قابل ادائیگی',14,yy+15);
  pdf.setFontSize(16);
  pdf.text(_hrmFmtPKR(slip.netPayable),196,yy+15,{align:'right'});
  // Signature line
  pdf.setTextColor(0);pdf.setFont('helvetica','normal');pdf.setFontSize(9);
  pdf.text('Employee signature: __________________________',14,260);
  pdf.text('Date: __________________',150,260);
  pdf.save(`Payslip-${(slip.employeeName||'employee').replace(/\s+/g,'-')}-${slip.month||_payrollMonth}.pdf`);
};

// ── Worker dashboard cue: last-month payslip availability ──
function _myLastPayslip(){
  if(!session)return null;
  const me=session.employee||(allEmployees.find(e=>e.username===session.u))||null;
  if(!me)return null;
  const mine=allPayslips.filter(s=>s.employeeId===me._id).sort((a,b)=>(b.month||'').localeCompare(a.month||''));
  return mine[0]||null;
}

// Returns array of YYYY-MM keys for the last N months that have no
// processed/paid payroll_run.
function _pendingPayrollMonths(lookbackMonths){
  lookbackMonths=lookbackMonths||3;
  const out=[];
  const today=new Date();
  for(let i=1;i<=lookbackMonths;i++){
    const d=new Date(today.getFullYear(),today.getMonth()-i,1);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const run=_payrollRunFor(key);
    if(!run||run.status==='draft')out.push(key);
  }
  return out;
}

function _populateOwnerPayrollKPI(){
  if(!session||session.role!=='owner')return;
  if(!payrollDataLoaded){
    // Background load + rerun once data lands
    if(typeof loadPayrollData==='function'){loadPayrollData().then(()=>_populateOwnerPayrollKPI());}
    return;
  }
  const pending=_pendingPayrollMonths(3);
  const el=document.getElementById('owner-kpi-payroll');
  if(el)el.textContent=pending.length;
  // Banner: previous month not yet processed
  const alert=document.getElementById('owner-payroll-alert');
  if(!alert)return;
  const today=new Date();
  const prev=new Date(today.getFullYear(),today.getMonth()-1,1);
  const prevKey=`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;
  const prevRun=_payrollRunFor(prevKey);
  if(!prevRun||prevRun.status==='draft'){
    alert.innerHTML=`<div class="card" style="border-left:3px solid var(--accent-warning);background:var(--accent-warning-soft);padding:12px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer" onclick="window.showPage('hrm-payroll')">
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--accent-warning);font-weight:700">📌 Payroll ready to process</div>
        <div style="font-size:14px;font-weight:600;margin-top:2px">${_payrollMonthLabel(prevKey)} payroll has not been processed yet.</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Tap to open the Payroll page and run it.</div>
      </div>
      <span style="font-size:18px;color:var(--muted)">›</span>
    </div>`;
  } else { alert.innerHTML=''; }
}

// ───────────────────────────────────────────────────────────
// HRM Session 4 — Advances + Loans + Policy Engine + Notifications
// ───────────────────────────────────────────────────────────

async function loadHRMSession4Data(){
  try{
    const[advSnap,loanSnap,polSnap,notifSnap]=await Promise.all([
      getDocs(query(collection(db,'advance_requests'),orderBy('requestedAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'loans'),orderBy('approvedAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'policy_change_log'),orderBy('changedAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'hrm_notifications'),orderBy('createdAt','desc'))).catch(()=>({docs:[]}))
    ]);
    allAdvances=advSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allLoans=loanSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allPolicyChanges=polSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allHRMNotifs=notifSnap.docs.map(d=>({...d.data(),_id:d.id}));
    hrmS4DataLoaded=true;
    // Async housekeeping (non-blocking)
    if(typeof _scheduleIncrementDueChecks==='function')_scheduleIncrementDueChecks().catch(()=>{});
    if(typeof _renderHRMNotifBadge==='function')_renderHRMNotifBadge();
  }catch(e){console.warn('loadHRMSession4Data failed:',e.message);}
}

function _hrmTimeAgo(ts){
  if(!ts)return'';
  const diff=Date.now()-ts;
  if(diff<60000)return'just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  return Math.floor(diff/86400000)+'d ago';
}

// ── HRM Notifications ─────────────────────────────────────
async function _hrmNotify(payload){
  try{
    const ref=doc(collection(db,'hrm_notifications'));
    const data={
      id:ref.id,
      type:payload.type||'info',
      title:payload.title||'',
      message:payload.message||'',
      forUser:payload.forUser||'',
      forRole:payload.forRole||'',
      relatedTo:payload.relatedTo||'',
      createdAt:Date.now(),
      readBy:[],
      priority:payload.priority||'normal',
      actionRequired:!!payload.actionRequired,
      actionUrl:payload.actionUrl||''
    };
    await setDoc(ref,data);
    allHRMNotifs.unshift({...data,_id:ref.id});
    if(typeof _renderHRMNotifBadge==='function')_renderHRMNotifBadge();
    return data;
  }catch(e){console.warn('hrmNotify failed:',e.message);}
}

function _myHRMNotifs(){
  if(!session)return[];
  return allHRMNotifs.filter(n=>{
    if((n.readBy||[]).includes(session.u))return false;
    if(n.forUser&&n.forUser===session.u)return true;
    if(n.forRole==='all')return true;
    if(n.forRole==='owner'&&session.role==='owner')return true;
    if(n.forRole==='manager'&&session.role==='manager')return true;
    if(n.forRole==='owner_manager'&&['owner','manager'].includes(session.role))return true;
    if(n.forRole==='store'&&session.role==='store')return true;
    if(n.forRole==='worker'&&session.role==='worker')return true;
    return false;
  });
}

window.hrmDismissNotif=async function(id){
  const n=allHRMNotifs.find(x=>x._id===id);if(!n)return;
  const readBy=Array.isArray(n.readBy)?n.readBy.slice():[];
  if(!readBy.includes(session.u))readBy.push(session.u);
  try{
    await updateDoc(doc(db,'hrm_notifications',id),{readBy});
    n.readBy=readBy;
    _renderHRMNotifBadge();
    _renderHRMNotifPanel();
    _renderWorkerNotifBanner();
  }catch(e){showToast('Dismiss failed: '+e.message,true);}
};

function _renderHRMNotifBadge(){
  // Combined unread count: HRM notifs + legacy storeNotifications
  const hrm=_myHRMNotifs().length;
  const store=Array.isArray(storeNotifications)?storeNotifications.filter(n=>n.status==='unread').length:0;
  const total=hrm+store;
  const badge=document.getElementById('notif-badge');
  if(badge){badge.style.display=total>0?'flex':'none';badge.textContent=total>99?'99+':String(total);}
}

function _renderHRMNotifPanel(){
  // Inject HRM notifs ahead of any existing store-notif content in the panel.
  const list=document.getElementById('notif-list');
  if(!list)return;
  const my=_myHRMNotifs();
  const storeUnread=Array.isArray(storeNotifications)?storeNotifications.filter(n=>n.status==='unread'):[];
  if(!my.length&&!storeUnread.length){list.innerHTML='<div style="padding:24px 16px;text-align:center;color:var(--muted);font-size:13px">No new notifications.</div>';return;}
  const hrmHTML=my.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(n=>_hrmNotifCardHTML(n)).join('');
  // For store notifs, fall back to existing renderer if available
  let storeHTML='';
  if(typeof renderNotifList==='function'&&storeUnread.length){
    // existing function rewrites the panel; we'll just call it after our HRM block
  }
  list.innerHTML=hrmHTML+(storeUnread.length?'<div style="padding:8px 16px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;background:#fafafa">Store</div>':'');
  // Append store notif rendering manually so both lists coexist
  if(storeUnread.length){
    const wrap=document.createElement('div');
    storeUnread.forEach(n=>{
      const div=document.createElement('div');
      div.style.cssText='padding:14px 16px;border-bottom:1px solid #f5f5f5';
      div.innerHTML=`<div style="font-weight:600;font-size:13px">${n.action==='edit'?'✏️ Edited':'🗑️ Deleted'}: ${n.itemCode||''} ${n.itemName||''}</div><div style="font-size:11px;color:var(--muted);margin-top:5px">by ${n.changedBy||'—'}</div><button onclick="window.dismissNotif('${n._id}')" style="margin-top:10px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;font-size:11px;color:var(--muted)">Dismiss</button>`;
      wrap.appendChild(div);
    });
    list.appendChild(wrap);
  }
}

function _hrmNotifCardHTML(n){
  const priColor=n.priority==='high'?'var(--accent-urgent)':n.priority==='low'?'var(--muted)':'#1A1A2E';
  const priBg=n.priority==='high'?'var(--accent-urgent-soft)':n.priority==='low'?'#fafafa':'#fff';
  const actionBtn=n.actionUrl?`<button onclick="window.showPage('${n.actionUrl}');window.toggleNotifPanel()" style="margin-top:8px;margin-right:6px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;font-size:11px">View</button>`:'';
  return`<div style="padding:14px 16px;border-bottom:1px solid #f5f5f5;border-left:3px solid ${priColor};background:${priBg}">
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;color:${priColor}">${n.title||''}</div>
        <div style="font-size:12px;color:var(--text);margin-top:3px;line-height:1.45">${n.message||''}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px">${_hrmTimeAgo(n.createdAt)}</div>
        ${actionBtn}<button onclick="window.hrmDismissNotif('${n._id}')" style="margin-top:8px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;font-size:11px;color:var(--muted)">Dismiss</button>
      </div>
    </div>
  </div>`;
}

// Inject the notification bell on app start for everyone (was owner-only before).
function _ensureNotifBell(){
  const topbarUser=document.querySelector('.topbar-user');
  if(!topbarUser||document.getElementById('notif-bell-wrap'))return;
  const bell=document.createElement('div');
  bell.id='notif-bell-wrap';
  bell.style.cssText='position:relative;cursor:pointer;margin-right:4px;display:flex;align-items:center';
  bell.onclick=()=>window.toggleNotifPanel();
  bell.innerHTML=`<span style="font-size:18px;line-height:1">🔔</span><span id="notif-badge" style="display:none;position:absolute;top:-5px;right:-5px;background:var(--accent-urgent);color:#fff;border-radius:50%;width:17px;height:17px;font-size:9px;font-weight:700;align-items:center;justify-content:center">0</span>`;
  topbarUser.insertBefore(bell,topbarUser.firstChild);
  if(!document.getElementById('notif-panel')){
    const panel=document.createElement('div');
    panel.id='notif-panel';
    panel.style.cssText='display:none;position:fixed;top:52px;right:12px;width:360px;max-height:70vh;overflow-y:auto;background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);z-index:1000';
    panel.innerHTML=`<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff"><span style="font-weight:700;font-size:14px">Notifications</span><button onclick="window.toggleNotifPanel()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);line-height:1">×</button></div><div id="notif-list"></div>`;
    document.body.appendChild(panel);
  }
}

// Override the existing toggle so it renders the merged panel.

// ── Increment-due detector — runs after HRM data load ──
async function _scheduleIncrementDueChecks(){
  if(!session||!_canViewHRMOps())return;
  const now=new Date();
  for(const e of allEmployees){
    if(!e.joinDate||e.status==='inactive')continue;
    const join=new Date(e.joinDate+'T00:00:00');
    if(isNaN(join.getTime()))continue;
    // Find the next anniversary
    const nextAnniv=new Date(now.getFullYear(),join.getMonth(),join.getDate());
    if(nextAnniv<now)nextAnniv.setFullYear(now.getFullYear()+1);
    const daysToAnniv=Math.ceil((nextAnniv-now)/(1000*60*60*24));
    if(daysToAnniv>30)continue;
    // Check we haven't already created a notification for this anniversary
    const annivKey=`increment_due_${e._id}_${nextAnniv.getFullYear()}`;
    if(allHRMNotifs.some(n=>n.relatedTo===annivKey))continue;
    await _hrmNotify({
      type:'increment_due',
      title:'Annual increment due',
      message:`${e.name} joined ${nextAnniv.getFullYear()-join.getFullYear()-1+1} year${nextAnniv.getFullYear()-join.getFullYear()>1?'s':''} ago. Annual increment review recommended.`,
      forRole:'owner_manager',
      relatedTo:annivKey,
      priority:'normal',
      actionRequired:false,
      actionUrl:'hrm-employees'
    });
  }
}

// ── Worker dashboard HRM banner: show unread HRM notifs above content ──
function _renderWorkerNotifBanner(){
  const wrap=document.getElementById('wrk-notif-banner');
  if(!wrap)return;
  const my=_myHRMNotifs().filter(n=>['policy_change','advance_approved','advance_rejected','loan_added'].includes(n.type)).slice(0,2);
  if(!my.length){wrap.innerHTML='';return;}
  wrap.innerHTML=my.map(n=>`<div style="background:var(--accent-warning-soft);border-radius:8px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
    <span style="font-size:18px">📢</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600">${n.title||''}</div>
      <div style="font-size:11px;color:var(--accent-warning);margin-top:2px">${n.message||''}</div>
    </div>
    <button onclick="window.hrmDismissNotif('${n._id}')" style="background:none;border:none;color:var(--accent-warning);font-size:16px;cursor:pointer">✕</button>
  </div>`).join('');
}

// ───────────────────────────────────────────────────────────
// ADVANCES PAGE
// ───────────────────────────────────────────────────────────

function _advanceMonthBucket(ts){
  if(!ts)return'';
  const d=new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function renderAdvancesPage(){
  if(!_canViewHRMOps())return'<div class="empty">Restricted.</div>';
  const all=allAdvances.slice();
  const pending=all.filter(a=>a.status==='pending');
  const thisMonth=new Date().toISOString().slice(0,7);
  const approvedThisMonth=all.filter(a=>a.status==='approved'&&_advanceMonthBucket(a.approvedAt)===thisMonth).length;
  const activeAdvancesTotal=allEmployees.reduce((s,e)=>s+(e.advanceBalance||0),0);
  const clearedYTD=all.filter(a=>a.status==='paid'&&_advanceMonthBucket(a.paidOn?new Date(a.paidOn).getTime():a.approvedAt).startsWith(String(new Date().getFullYear()))).reduce((s,a)=>s+(a.amount||0),0);
  const stats=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px" class="advances-stats-strip">
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Pending Requests</div><div style="font-size:24px;font-weight:700;color:var(--accent-warning);margin-top:4px">${pending.length}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Approved This Month</div><div style="font-size:24px;font-weight:700;color:var(--accent-success);margin-top:4px">${approvedThisMonth}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Active Advances</div><div style="font-size:18px;font-weight:700;margin-top:4px">${_hrmFmtPKR(activeAdvancesTotal)}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Cleared YTD</div><div style="font-size:18px;font-weight:700;color:var(--accent-success);margin-top:4px">${_hrmFmtPKR(clearedYTD)}</div></div>
  </div>`;
  const tabs=['pending','approved','rejected','paid','all'];
  const tabBtns=tabs.map(t=>{
    const lbl=t==='all'?'All History':t.charAt(0).toUpperCase()+t.slice(1);
    const active=_advTab===t;
    return`<button onclick="window.advSetTab('${t}')" style="padding:8px 16px;border:1px solid var(--border);border-bottom:${active?'2px solid #1A1A2E':'1px solid var(--border)'};background:${active?'#fff':'#fafafa'};font-weight:${active?'700':'500'};font-size:13px;cursor:pointer;font-family:inherit;color:${active?'var(--text)':'var(--muted)'};border-radius:8px 8px 0 0;margin-right:4px">${lbl}</button>`;
  }).join('');
  return`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <div>
      <div class="page-title"><span class="page-title-icon">${_icon('list',22)}</span> Advances</div>
      <div class="page-sub">Salary advance requests and approvals</div>
    </div>
    <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.advNewRequest()">+ New Advance Request</button>
  </div>
  ${stats}
  <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap">${tabBtns}</div>
  <div id="adv-list">${_renderAdvList()}</div>`;
}

function _renderAdvList(){
  let list=allAdvances.slice();
  if(_advTab!=='all')list=list.filter(a=>a.status===_advTab);
  list.sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));
  if(!list.length)return'<div class="empty">No advance requests in this category.</div>';
  return list.map(a=>_advCardHTML(a)).join('');
}

function _advCardHTML(a){
  const emp=allEmployees.find(e=>e._id===a.employeeId);
  const pgClass=(emp?.paygrade||'').toLowerCase();
  const stColor={pending:'var(--accent-warning)',approved:'var(--accent-success)',rejected:'var(--accent-urgent)',paid:'var(--text)'}[a.status]||'var(--muted)';
  const stBg={pending:'var(--accent-warning-soft)',approved:'var(--accent-success-soft)',rejected:'var(--accent-urgent-soft)',paid:'#F0F0F0'}[a.status]||'#F0F0F0';
  const planLabel=a.monthDeductionPlan>1?`Split over ${a.monthDeductionPlan} months`:'Full deduction next month';
  const canApprove=_canApproveHRMOps()&&a.status==='pending';
  const canMarkPaid=_canApproveHRMOps()&&a.status==='approved'&&!a.paidOn;
  const actions=canApprove?`<div style="display:flex;gap:6px;flex-direction:column">
      <button class="btn-primary" style="width:auto;padding:8px 14px;margin-top:0;background:var(--accent-success)" onclick="window.advApprove('${a._id}')">✓ Approve</button>
      <button class="btn-outline" style="color:var(--accent-urgent);border-color:var(--accent-urgent)" onclick="window.advReject('${a._id}')">✗ Reject</button>
    </div>`:canMarkPaid?`<button class="btn-primary" style="width:auto;padding:8px 14px;margin-top:0" onclick="window.advMarkPaid('${a._id}')">Mark Paid</button>`:`<span style="background:${stBg};color:${stColor};padding:4px 10px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;align-self:flex-start">${a.status}</span>`;
  return`<div class="card" style="padding:16px;margin-bottom:10px;border-left:3px solid ${stColor}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div style="font-weight:700;font-size:15px">${a.employeeName||'—'}</div>${pgClass?`<span class="paygrade-badge ${pgClass}">${emp.paygrade}</span>`:''}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${emp?.designation||'—'}</div>
        <div style="margin-top:10px;font-size:14px">Requesting: <strong style="color:#1A1A2E;font-size:18px">${_hrmFmtPKR(a.amount)}</strong></div>
        <div style="font-size:13px;color:var(--muted);margin-top:6px">Reason: ${a.reason||'—'}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:8px">Requested by ${a.requestedBy||'—'} · ${_hrmTimeAgo(a.requestedAt)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Repayment: ${planLabel}</div>
        ${a.rejectionReason?`<div style="font-size:12px;color:var(--accent-urgent);margin-top:6px">Rejection: ${a.rejectionReason}</div>`:''}
        ${a.paidVia?`<div style="font-size:11px;color:var(--muted);margin-top:6px">Paid via ${a.paidVia} on ${a.paidOn||'—'} by ${a.paidBy||'—'}</div>`:''}
      </div>
      <div>${actions}</div>
    </div>
  </div>`;
}

window.advSetTab=function(t){_advTab=t;const w=document.getElementById('adv-list');if(w)w.innerHTML=_renderAdvList();const m=document.getElementById('main-content');if(m)m.innerHTML=renderAdvancesPage();};

window.advNewRequest=function(){
  if(!_canViewHRMOps())return;
  document.getElementById('hrm-modal-back')?.remove();
  const empOptions=allEmployees.filter(e=>e.status!=='inactive').sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(e=>`<option value="${e._id}">${e.name} (${e.paygrade})</option>`).join('');
  const back=document.createElement('div');back.className='hrm-modal-back';back.id='hrm-modal-back';back.onclick=ev=>{if(ev.target===back)window.hrmCloseModal();};
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:480px">
    <h3>New Advance Request</h3>
    <div class="sub">${_canApproveHRMOps()?'Will be auto-approved (you are an owner).':'Submitted to owners for approval.'}</div>
    <div class="field"><label>Employee *</label><select id="adv-emp">${empOptions}</select></div>
    <div class="field"><label>Amount (PKR) *</label><input id="adv-amt" type="number" min="0"></div>
    <div class="field"><label>Repayment Plan</label>
      <select id="adv-plan">
        <option value="1">Full deduction next month</option>
        <option value="2">Split over 2 months</option>
        <option value="3">Split over 3 months</option>
        <option value="4">Split over 4 months</option>
        <option value="6">Split over 6 months</option>
      </select>
    </div>
    <div class="field"><label>Reason *</label><textarea id="adv-reason" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px"></textarea></div>
    <div class="field"><label>Notes</label><input id="adv-notes"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.advSubmitRequest()">Submit</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window.advSubmitRequest=async function(){
  const empId=document.getElementById('adv-emp')?.value;
  const amount=Number(document.getElementById('adv-amt')?.value||0);
  const reason=document.getElementById('adv-reason')?.value?.trim()||'';
  const plan=Number(document.getElementById('adv-plan')?.value||1);
  const notes=document.getElementById('adv-notes')?.value?.trim()||'';
  if(!empId||!amount||!reason)return showToast('Employee, amount and reason are required.',true);
  const emp=allEmployees.find(e=>e._id===empId);if(!emp)return;
  const autoApprove=_canApproveHRMOps();
  try{
    const ref=doc(collection(db,'advance_requests'));
    const data={
      id:ref.id,employeeId:empId,employeeName:emp.name,amount,reason,
      requestedBy:session.name,requestedAt:Date.now(),
      status:autoApprove?'approved':'pending',
      approvedBy:autoApprove?session.name:'',
      approvedAt:autoApprove?Date.now():0,
      rejectionReason:'',paidVia:'',paidOn:'',paidBy:'',
      notes,monthDeductionPlan:plan,remainingBalance:amount
    };
    await setDoc(ref,data);
    allAdvances.unshift({...data,_id:ref.id});
    if(autoApprove){
      const newBal=(emp.advanceBalance||0)+amount;
      await updateDoc(doc(db,'employees',empId),{advanceBalance:newBal,updatedAt:Date.now()});
      emp.advanceBalance=newBal;
    }
    await logActivity(autoApprove?'Advance auto-approved':'Advance requested',`${emp.name} · ${_hrmFmtPKR(amount)}`);
    if(!autoApprove){
      await _hrmNotify({type:'advance_request',title:`Advance request: ${emp.name}`,message:`${session.name} requested ${_hrmFmtPKR(amount)} for ${reason}.`,forRole:'owner',relatedTo:ref.id,priority:'high',actionRequired:true,actionUrl:'hrm-advances'});
    } else {
      await _hrmNotify({type:'advance_approved',title:'Advance approved',message:`${_hrmFmtPKR(amount)} approved. Will be deducted from your next payroll.`,forUser:emp.username,relatedTo:ref.id,priority:'normal'});
    }
    showToast(autoApprove?'Advance approved ✓':'Request sent to owners');
    window.hrmCloseModal();
    if(currentPage==='hrm-advances'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderAdvancesPage();}
  }catch(e){showToast('Submit failed: '+e.message,true);}
};

window.advApprove=async function(id){
  if(!_canApproveHRMOps())return showToast('Owners only.',true);
  const a=allAdvances.find(x=>x._id===id);if(!a||a.status!=='pending')return;
  const via=prompt('Payment method (cash / bank / easypaisa):','cash');
  if(!via)return;
  try{
    const update={status:'approved',approvedBy:session.name,approvedAt:Date.now(),paidVia:via.trim().toLowerCase()};
    await updateDoc(doc(db,'advance_requests',id),update);
    Object.assign(a,update);
    const emp=allEmployees.find(e=>e._id===a.employeeId);
    if(emp){
      const newBal=(emp.advanceBalance||0)+(a.amount||0);
      await updateDoc(doc(db,'employees',emp._id),{advanceBalance:newBal,updatedAt:Date.now()});
      emp.advanceBalance=newBal;
    }
    await _hrmNotify({type:'advance_approved',title:'Advance approved',message:`${_hrmFmtPKR(a.amount)} approved. Will be deducted from your next payroll.`,forUser:emp?.username,relatedTo:id,priority:'normal'});
    await logActivity('Advance approved',`${a.employeeName} · ${_hrmFmtPKR(a.amount)} via ${via}`);
    showToast('Advance approved ✓');
    if(currentPage==='hrm-advances'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderAdvancesPage();}
  }catch(e){showToast('Approve failed: '+e.message,true);}
};

window.advReject=async function(id){
  if(!_canApproveHRMOps())return showToast('Owners only.',true);
  const a=allAdvances.find(x=>x._id===id);if(!a||a.status!=='pending')return;
  const reason=prompt('Rejection reason:','');
  if(!reason||!reason.trim())return;
  try{
    const update={status:'rejected',rejectionReason:reason.trim(),approvedBy:session.name,approvedAt:Date.now()};
    await updateDoc(doc(db,'advance_requests',id),update);
    Object.assign(a,update);
    const emp=allEmployees.find(e=>e._id===a.employeeId);
    await _hrmNotify({type:'advance_rejected',title:'Advance rejected',message:`Your advance request for ${_hrmFmtPKR(a.amount)} was rejected. Reason: ${reason.trim()}`,forUser:emp?.username,relatedTo:id,priority:'high'});
    await logActivity('Advance rejected',`${a.employeeName} · ${_hrmFmtPKR(a.amount)} · ${reason.trim()}`);
    showToast('Advance rejected.');
    if(currentPage==='hrm-advances'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderAdvancesPage();}
  }catch(e){showToast('Reject failed: '+e.message,true);}
};

window.advMarkPaid=async function(id){
  if(!_canApproveHRMOps())return showToast('Owners only.',true);
  const a=allAdvances.find(x=>x._id===id);if(!a||a.status!=='approved')return;
  if(!confirm(`Mark advance for ${a.employeeName} as paid (${_hrmFmtPKR(a.amount)})?`))return;
  try{
    const update={status:'paid',paidOn:new Date().toISOString().split('T')[0],paidBy:session.name};
    await updateDoc(doc(db,'advance_requests',id),update);
    Object.assign(a,update);
    await logActivity('Advance paid',`${a.employeeName} · ${_hrmFmtPKR(a.amount)}`);
    showToast('Marked paid ✓');
    if(currentPage==='hrm-advances'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderAdvancesPage();}
  }catch(e){showToast('Mark paid failed: '+e.message,true);}
};

// ───────────────────────────────────────────────────────────
// LOANS PAGE
// ───────────────────────────────────────────────────────────

function renderLoansPage(){
  if(!_canViewHRMOps())return'<div class="empty">Restricted.</div>';
  const all=allLoans.slice();
  const active=all.filter(l=>l.status==='active');
  const totalOutstanding=active.reduce((s,l)=>s+(l.remainingBalance||0),0);
  const ytd=all.filter(l=>l.status==='completed'&&l.endMonth&&l.endMonth.startsWith(String(new Date().getFullYear()))).reduce((s,l)=>s+(l.totalAmount||0),0);
  const completingThisMonth=active.filter(l=>l.endMonth===new Date().toISOString().slice(0,7)).length;
  const stats=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px" class="advances-stats-strip">
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Active Loans</div><div style="font-size:24px;font-weight:700;margin-top:4px">${active.length}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Total Outstanding</div><div style="font-size:18px;font-weight:700;color:var(--accent-urgent);margin-top:4px">${_hrmFmtPKR(totalOutstanding)}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Cleared YTD</div><div style="font-size:18px;font-weight:700;color:var(--accent-success);margin-top:4px">${_hrmFmtPKR(ytd)}</div></div>
    <div class="card" style="padding:14px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em">Completing This Month</div><div style="font-size:24px;font-weight:700;color:var(--accent-warning);margin-top:4px">${completingThisMonth}</div></div>
  </div>`;
  const filterBtns=['active','completed','paused','all'].map(t=>{
    const lbl=t.charAt(0).toUpperCase()+t.slice(1);
    const a=_loanFilter===t;
    return`<button onclick="window.loanSetFilter('${t}')" style="padding:8px 16px;border:1px solid var(--border);border-bottom:${a?'2px solid #1A1A2E':'1px solid var(--border)'};background:${a?'#fff':'#fafafa'};font-weight:${a?'700':'500'};font-size:13px;cursor:pointer;font-family:inherit;color:${a?'var(--text)':'var(--muted)'};border-radius:8px 8px 0 0;margin-right:4px">${lbl}</button>`;
  }).join('');
  return`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <div>
      <div class="page-title"><span class="page-title-icon">${_icon('money',22)}</span> Loans</div>
      <div class="page-sub">Long-term loan tracking with monthly deductions</div>
    </div>
    ${_canApproveHRMOps()?`<button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.loanNew()">+ New Loan</button>`:''}
  </div>
  ${stats}
  <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap">${filterBtns}</div>
  <div id="loan-list">${_renderLoanList()}</div>`;
}

function _renderLoanList(){
  let list=allLoans.slice();
  if(_loanFilter!=='all')list=list.filter(l=>l.status===_loanFilter);
  list.sort((a,b)=>(b.approvedAt||0)-(a.approvedAt||0));
  if(!list.length)return'<div class="empty">No loans in this filter.</div>';
  return list.map(l=>_loanCardHTML(l)).join('');
}

function _loanCardHTML(l){
  const emp=allEmployees.find(e=>e._id===l.employeeId);
  const pgClass=(emp?.paygrade||'').toLowerCase();
  const total=l.totalAmount||0;
  const remaining=l.remainingBalance||0;
  const paidAmt=Math.max(0,total-remaining);
  const pct=total?Math.min(100,Math.round(paidAmt/total*100)):0;
  const monthsPaid=Array.isArray(l.paymentHistory)?l.paymentHistory.length:0;
  const totalMonths=l.totalMonths||(l.monthlyDeduction?Math.ceil(total/l.monthlyDeduction):0);
  return`<div class="card" style="padding:16px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="font-weight:700">${l.employeeName||'—'}</div>
        <div style="font-size:12px;color:var(--muted)">${emp?.designation||'—'}${pgClass?` · <span class="paygrade-badge ${pgClass}">${emp.paygrade}</span>`:''}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">REMAINING</div>
        <div style="font-size:20px;font-weight:700;color:var(--accent-urgent)">${_hrmFmtPKR(remaining)}</div>
      </div>
    </div>
    <div style="margin-top:14px;background:#F3F4F6;height:8px;border-radius:4px;overflow:hidden"><div style="background:var(--accent-success);height:100%;width:${pct}%"></div></div>
    <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--muted);flex-wrap:wrap;gap:6px">
      <span>Paid ${_hrmFmtPKR(paidAmt)}</span>
      <span>${monthsPaid} of ${totalMonths} months</span>
      <span>Total ${_hrmFmtPKR(total)}</span>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--muted)">Monthly deduction: ${_hrmFmtPKR(l.monthlyDeduction)} · Started ${l.startMonth||'—'} · Ends ${l.endMonth||'—'}</div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-outline" style="font-size:11px;padding:6px 12px" onclick="window.loanShowHistory('${l._id}')">View Payment History</button>
      ${_canApproveHRMOps()&&l.status==='active'?`<button class="btn-outline" style="font-size:11px;padding:6px 12px" onclick="window.loanPause('${l._id}')">Pause Loan</button>`:''}
      ${_canApproveHRMOps()&&l.status==='paused'?`<button class="btn-outline" style="font-size:11px;padding:6px 12px" onclick="window.loanResume('${l._id}')">Resume</button>`:''}
    </div>
  </div>`;
}

window.loanSetFilter=function(t){_loanFilter=t;const m=document.getElementById('main-content');if(m)m.innerHTML=renderLoansPage();};

window.loanNew=function(){
  if(!_canApproveHRMOps())return showToast('Owners only.',true);
  document.getElementById('hrm-modal-back')?.remove();
  const empOptions=allEmployees.filter(e=>e.status!=='inactive').sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(e=>`<option value="${e._id}">${e.name} (${e.paygrade})</option>`).join('');
  const startMonth=new Date().toISOString().slice(0,7);
  const back=document.createElement('div');back.className='hrm-modal-back';back.id='hrm-modal-back';back.onclick=ev=>{if(ev.target===back)window.hrmCloseModal();};
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:480px">
    <h3>New Loan</h3>
    <div class="sub">Long-term loan with monthly payroll deduction</div>
    <div class="field"><label>Employee *</label><select id="ln-emp">${empOptions}</select></div>
    <div class="field"><label>Total Loan Amount (PKR) *</label><input id="ln-total" type="number" min="0" oninput="window._loanCalcMonths()"></div>
    <div class="field"><label>Monthly Deduction (PKR) *</label><input id="ln-monthly" type="number" min="0" oninput="window._loanCalcMonths()"></div>
    <div style="font-size:12px;color:var(--muted);margin:6px 0;padding:8px;background:#fafafa;border-radius:6px" id="ln-calc">Total months: —</div>
    <div class="field"><label>Start Month</label><input id="ln-start" type="month" value="${startMonth}"></div>
    <div class="field"><label>Reason / Notes</label><textarea id="ln-reason" rows="2" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.loanSubmit()">Create Loan</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window._loanCalcMonths=function(){
  const t=Number(document.getElementById('ln-total')?.value||0);
  const m=Number(document.getElementById('ln-monthly')?.value||0);
  const calc=document.getElementById('ln-calc');
  if(!t||!m){calc.textContent='Total months: —';return;}
  const months=Math.ceil(t/m);
  calc.textContent=`Total months: ${months} (${_hrmFmtPKR(m)}/mo for ${months} months = ${_hrmFmtPKR(months*m)})`;
};

window.loanSubmit=async function(){
  if(!_canApproveHRMOps())return showToast('Owners only.',true);
  const empId=document.getElementById('ln-emp')?.value;
  const total=Number(document.getElementById('ln-total')?.value||0);
  const monthly=Number(document.getElementById('ln-monthly')?.value||0);
  const startMonth=document.getElementById('ln-start')?.value;
  const reason=document.getElementById('ln-reason')?.value?.trim()||'';
  if(!empId||!total||!monthly||!startMonth)return showToast('All required fields needed.',true);
  const emp=allEmployees.find(e=>e._id===empId);if(!emp)return;
  const totalMonths=Math.ceil(total/monthly);
  const[sy,sm]=startMonth.split('-').map(Number);
  const endDate=new Date(sy,sm-1+totalMonths-1,1);
  const endMonth=`${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}`;
  try{
    const ref=doc(collection(db,'loans'));
    const data={
      id:ref.id,employeeId:empId,employeeName:emp.name,
      totalAmount:total,monthlyDeduction:monthly,startMonth,endMonth,totalMonths,
      reason,approvedBy:session.name,approvedAt:Date.now(),
      status:'active',paidVia:'',paidOn:'',
      remainingBalance:total,paymentHistory:[],notes:''
    };
    await setDoc(ref,data);
    allLoans.unshift({...data,_id:ref.id});
    await updateDoc(doc(db,'employees',empId),{loanBalance:(emp.loanBalance||0)+total,loanMonthlyDeduction:monthly,updatedAt:Date.now()});
    emp.loanBalance=(emp.loanBalance||0)+total;
    emp.loanMonthlyDeduction=monthly;
    await _hrmNotify({type:'loan_added',title:'New loan added',message:`A loan of ${_hrmFmtPKR(total)} has been recorded. ${_hrmFmtPKR(monthly)}/month for ${totalMonths} months starting ${startMonth}.`,forUser:emp.username,relatedTo:ref.id,priority:'normal'});
    await logActivity('Loan created',`${emp.name} · ${_hrmFmtPKR(total)} over ${totalMonths} months`);
    showToast('Loan created ✓');
    window.hrmCloseModal();
    if(currentPage==='hrm-loans'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderLoansPage();}
  }catch(e){showToast('Submit failed: '+e.message,true);}
};

window.loanShowHistory=function(id){
  const l=allLoans.find(x=>x._id===id);if(!l)return;
  document.getElementById('hrm-modal-back')?.remove();
  const hist=Array.isArray(l.paymentHistory)?l.paymentHistory.slice().reverse():[];
  const back=document.createElement('div');back.className='hrm-modal-back';back.id='hrm-modal-back';back.onclick=ev=>{if(ev.target===back)window.hrmCloseModal();};
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:520px">
    <h3>Payment History — ${l.employeeName}</h3>
    <div class="sub">Total ${_hrmFmtPKR(l.totalAmount)} · Remaining ${_hrmFmtPKR(l.remainingBalance)} · ${l.monthlyDeduction?_hrmFmtPKR(l.monthlyDeduction)+' /month':''}</div>
    ${hist.length?`<table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:8px">
      <thead><tr style="background:#1A1A2E;color:#fff"><th style="padding:8px;text-align:left">Month</th><th style="padding:8px;text-align:right">Deducted</th><th style="padding:8px;text-align:right">Remaining</th></tr></thead>
      <tbody>${hist.map(h=>`<tr style="border-bottom:1px solid #E5E5E7"><td style="padding:8px">${h.month}</td><td style="padding:8px;text-align:right">${_hrmFmtPKR(h.amountDeducted)}</td><td style="padding:8px;text-align:right">${_hrmFmtPKR(h.remainingAfter)}</td></tr>`).join('')}</tbody>
    </table>`:'<div class="empty">No payments deducted yet.</div>'}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn-outline" onclick="window.hrmCloseModal()">Close</button></div>
  </div>`;
  document.body.appendChild(back);
};

window.loanPause=async function(id){
  if(!_canApproveHRMOps())return showToast('Owners only.',true);
  const l=allLoans.find(x=>x._id===id);if(!l)return;
  if(!confirm(`Pause loan for ${l.employeeName}? No deductions will be taken until resumed.`))return;
  try{
    await updateDoc(doc(db,'loans',id),{status:'paused'});
    l.status='paused';
    const emp=allEmployees.find(e=>e._id===l.employeeId);
    if(emp){await updateDoc(doc(db,'employees',emp._id),{loanMonthlyDeduction:0,updatedAt:Date.now()});emp.loanMonthlyDeduction=0;}
    await logActivity('Loan paused',`${l.employeeName} · ${_hrmFmtPKR(l.remainingBalance)} remaining`);
    showToast('Loan paused.');
    if(currentPage==='hrm-loans'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderLoansPage();}
  }catch(e){showToast('Pause failed: '+e.message,true);}
};

window.loanResume=async function(id){
  if(!_canApproveHRMOps())return showToast('Owners only.',true);
  const l=allLoans.find(x=>x._id===id);if(!l)return;
  try{
    await updateDoc(doc(db,'loans',id),{status:'active'});
    l.status='active';
    const emp=allEmployees.find(e=>e._id===l.employeeId);
    if(emp){await updateDoc(doc(db,'employees',emp._id),{loanMonthlyDeduction:l.monthlyDeduction,updatedAt:Date.now()});emp.loanMonthlyDeduction=l.monthlyDeduction;}
    await logActivity('Loan resumed',`${l.employeeName} · ${_hrmFmtPKR(l.monthlyDeduction)}/month`);
    showToast('Loan resumed.');
    if(currentPage==='hrm-loans'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderLoansPage();}
  }catch(e){showToast('Resume failed: '+e.message,true);}
};

// ───────────────────────────────────────────────────────────
// POLICY ENGINE PAGE
// ───────────────────────────────────────────────────────────

const POLICY_DEFS=[
  {key:'workingDaysPerMonth',label:'Working Days Per Month',desc:'Used for daily rate calculation: salary ÷ working days',type:'number',def:30},
  {key:'defaultShiftStart',label:'Default Shift Start',desc:'Used when an employee has no per-employee Shift Start',type:'time',def:'09:00'},
  {key:'defaultShiftEnd',label:'Default Shift End',desc:'Used when an employee has no per-employee Shift End',type:'time',def:'17:00'},
  {key:'lateGraceMinutes',label:'Late Grace Minutes',desc:'Punch-in after (Shift Start + grace) is marked late',type:'number',def:30},
  {key:'lateCountBeforeAbsent',label:'Lates Before Absent',desc:'How many lates collapse into one absent day',type:'number',def:3},
  {key:'halfDayCountsAs',label:'Half Day Counts As',desc:'When an employee leaves early',type:'select',options:['full','half','none'],def:'full'},
  {key:'absentDeductionFormula',label:'Absent Deduction Method',desc:'Formula for calculating absent-day deduction',type:'select',options:['salary_div_workingdays','fixed_amount'],def:'salary_div_workingdays'},
  {key:'autoIncrementActive',label:'Auto-Increment Active',desc:'When ON, system auto-applies paygrade increments on anniversaries',type:'toggle',def:false},
  {key:'lateCutoffActive',label:'Late Cutoff Active',desc:'When OFF, no one is ever marked late',type:'toggle',def:true}
];

function _policyValue(key){
  const p=hrmPolicies||{};
  if(p[key]!==undefined)return p[key];
  const def=POLICY_DEFS.find(d=>d.key===key);
  return def?def.def:'';
}

function renderPolicyEnginePage(){
  if(!_canViewHRMOps())return'<div class="empty">Restricted.</div>';
  const canEdit=_canEditPolicy();
  const policyCards=POLICY_DEFS.map(d=>{
    const v=_policyValue(d.key);
    let input='';
    if(d.type==='number')input=`<input type="number" id="pol-${d.key}" value="${v}" ${canEdit?'':'disabled'} style="width:80px;padding:6px;text-align:center;border:1px solid var(--border);border-radius:6px;font-weight:600">`;
    else if(d.type==='time')input=`<input type="time" id="pol-${d.key}" value="${v}" ${canEdit?'':'disabled'} style="padding:6px;border:1px solid var(--border);border-radius:6px;font-weight:600">`;
    else if(d.type==='select')input=`<select id="pol-${d.key}" ${canEdit?'':'disabled'} style="padding:6px;border:1px solid var(--border);border-radius:6px;font-weight:600">${d.options.map(o=>`<option value="${o}" ${o===v?'selected':''}>${o}</option>`).join('')}</select>`;
    else if(d.type==='toggle')input=`<select id="pol-${d.key}" ${canEdit?'':'disabled'} style="padding:6px;border:1px solid var(--border);border-radius:6px;font-weight:600;background:${v?'var(--accent-success-soft)':'#fafafa'};color:${v?'var(--accent-success)':'var(--muted)'}"><option value="true" ${v?'selected':''}>ON</option><option value="false" ${!v?'selected':''}>OFF</option></select>`;
    const saveBtn=canEdit?`<button class="btn-outline" style="font-size:12px;padding:6px 12px" onclick="window.policySave('${d.key}')">Save</button>`:'';
    return`<div class="card" style="padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:14px">${d.label}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${d.desc}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">${input}${saveBtn}</div>
      </div>
    </div>`;
  }).join('');
  // Paygrade table
  const grades=['P1','P2','P3','P4','P5'];
  const pg=(hrmPolicies&&hrmPolicies.paygrades)||{};
  const paygradeRows=grades.map(g=>{
    const row=pg[g]||{};
    const dis=canEdit?'':'disabled';
    return`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px"><span class="paygrade-badge ${g.toLowerCase()}">${g}</span></td>
      <td style="padding:8px;text-align:right"><input type="number" id="pg-${g}-min" value="${row.salaryMin||0}" ${dis} style="width:100px;text-align:right;padding:4px"></td>
      <td style="padding:8px;text-align:right"><input type="number" id="pg-${g}-max" value="${row.salaryMax||0}" ${dis} style="width:100px;text-align:right;padding:4px"></td>
      <td style="padding:8px;text-align:center"><input type="number" id="pg-${g}-pct" value="${row.incrementPercent||0}" ${dis} style="width:60px;text-align:center;padding:4px">%</td>
      <td style="padding:8px;text-align:center"><select id="pg-${g}-active" ${dis} style="padding:4px"><option value="true" ${row.active?'selected':''}>ON</option><option value="false" ${!row.active?'selected':''}>OFF</option></select></td>
    </tr>`;
  }).join('');
  const paygradeTable=`<div class="card" style="padding:16px;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-weight:700">Paygrade Configuration · پے گریڈ</div>${canEdit?`<button class="btn-outline" style="font-size:12px;padding:6px 12px" onclick="window.policySavePaygrades()">Save Paygrades</button>`:''}</div>
    <table style="width:100%;font-size:13px;margin-top:6px;border-collapse:collapse">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left">Grade</th><th style="padding:8px;text-align:right">Salary Min</th><th style="padding:8px;text-align:right">Salary Max</th><th style="padding:8px;text-align:center">Annual %</th><th style="padding:8px;text-align:center">Active</th></tr></thead>
      <tbody>${paygradeRows}</tbody>
    </table>
    ${!hrmPolicies?.autoIncrementActive?`<div style="margin-top:12px;padding:10px;background:var(--accent-warning-soft);border-radius:6px;font-size:12px;color:var(--accent-warning)">⚠ Auto-increments are currently INACTIVE. Toggle "Auto-Increment Active" above to enable system-wide.</div>`:''}
  </div>`;
  // Mustafa banner
  const banner=!canEdit?`<div class="card" style="padding:12px 14px;margin-bottom:14px;border-left:3px solid var(--accent-warning);background:var(--accent-warning-soft);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div><strong>🔒 Read-only</strong><div style="font-size:12px;color:var(--muted);margin-top:2px">Only Afnan and Ammar can change policies. You can request a change.</div></div>
    <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.policyRequestChange()">Request a change</button>
  </div>`:'';
  // Change log
  const log=allPolicyChanges.slice(0,50).map(c=>`<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:8px;color:var(--muted);font-size:11px">${_hrmTimeAgo(c.changedAt)}</td>
    <td style="padding:8px">${c.policyKey||'—'}</td>
    <td style="padding:8px;font-size:12px"><span style="color:var(--muted)">${JSON.stringify(c.oldValue)}</span> → <strong>${JSON.stringify(c.newValue)}</strong></td>
    <td style="padding:8px">${c.changedBy||'—'}</td>
    <td style="padding:8px;text-align:center">${c.affectedEmployees||0}</td>
  </tr>`).join('');
  const logCard=`<div class="card" style="padding:0;overflow:hidden;margin-top:16px">
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);font-weight:700">Recent Policy Changes</div>
    <table style="width:100%;font-size:13px;border-collapse:collapse">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left">When</th><th style="padding:8px;text-align:left">Policy</th><th style="padding:8px;text-align:left">Old → New</th><th style="padding:8px;text-align:left">Changed By</th><th style="padding:8px;text-align:center">Affected</th></tr></thead>
      <tbody>${log||'<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--muted)">No changes recorded yet.</td></tr>'}</tbody>
    </table>
  </div>`;
  return`<div class="page-head">
    <div class="page-title"><span class="page-title-icon">${_icon('gear',22)}</span> Policy Engine · پالیسی</div>
    <div class="page-sub">Configurable HR rules. Changes are logged and notify affected employees.</div>
  </div>
  ${banner}
  ${policyCards}
  ${paygradeTable}
  ${logCard}`;
}

async function _persistPolicyChange(key,oldValue,newValue,reason){
  const affected=allEmployees.filter(e=>e.status!=='inactive').length;
  await updateDoc(doc(db,'hrm_policies','main'),{[key]:newValue,lastUpdatedBy:session.name,lastUpdatedAt:Date.now()});
  if(!hrmPolicies)hrmPolicies={};
  hrmPolicies[key]=newValue;
  // Log
  const logRef=doc(collection(db,'policy_change_log'));
  const logData={id:logRef.id,policyKey:key,oldValue,newValue,changedBy:session.name,changedAt:Date.now(),reason:reason||'',affectedEmployees:affected,notificationsSent:[]};
  await setDoc(logRef,logData);
  allPolicyChanges.unshift({...logData,_id:logRef.id});
  // Notify all affected
  await _hrmNotify({type:'policy_change',title:'Policy updated',message:`${key} changed from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}. ${reason||''}`.trim(),forRole:'all',relatedTo:logRef.id,priority:'normal'});
  await logActivity('Policy changed',`${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
}

window.policySave=async function(key){
  if(!_canEditPolicy())return showToast('Owners only.',true);
  const def=POLICY_DEFS.find(d=>d.key===key);if(!def)return;
  const el=document.getElementById('pol-'+key);if(!el)return;
  let newVal;
  if(def.type==='number')newVal=Number(el.value);
  else if(def.type==='toggle')newVal=el.value==='true';
  else newVal=el.value;
  const oldVal=_policyValue(key);
  if(JSON.stringify(oldVal)===JSON.stringify(newVal))return showToast('No change.');
  const reason=prompt(`Change ${def.label}?\n${JSON.stringify(oldVal)} → ${JSON.stringify(newVal)}\n\nThis will notify all employees. Reason:`,'');
  if(!reason||!reason.trim())return;
  try{
    await _persistPolicyChange(key,oldVal,newVal,reason.trim());
    showToast('Policy saved ✓');
    if(currentPage==='hrm-policy'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderPolicyEnginePage();}
  }catch(e){showToast('Save failed: '+e.message,true);}
};

window.policySavePaygrades=async function(){
  if(!_canEditPolicy())return showToast('Owners only.',true);
  const grades=['P1','P2','P3','P4','P5'];
  const old=hrmPolicies?.paygrades||{};
  const updated={};
  grades.forEach(g=>{
    updated[g]={
      label:g,
      salaryMin:Number(document.getElementById('pg-'+g+'-min')?.value||0),
      salaryMax:Number(document.getElementById('pg-'+g+'-max')?.value||0),
      incrementPercent:Number(document.getElementById('pg-'+g+'-pct')?.value||0),
      active:document.getElementById('pg-'+g+'-active')?.value==='true'
    };
  });
  if(JSON.stringify(old)===JSON.stringify(updated))return showToast('No change.');
  const reason=prompt('Reason for paygrade change:','');
  if(!reason||!reason.trim())return;
  try{
    await _persistPolicyChange('paygrades',old,updated,reason.trim());
    showToast('Paygrades saved ✓');
    if(currentPage==='hrm-policy'){const m=document.getElementById('main-content');if(m)m.innerHTML=renderPolicyEnginePage();}
  }catch(e){showToast('Save failed: '+e.message,true);}
};

window.policyRequestChange=function(){
  if(!_canViewHRMOps()||_canEditPolicy())return;
  document.getElementById('hrm-modal-back')?.remove();
  const opts=POLICY_DEFS.map(d=>`<option value="${d.key}">${d.label}</option>`).join('');
  const back=document.createElement('div');back.className='hrm-modal-back';back.id='hrm-modal-back';back.onclick=ev=>{if(ev.target===back)window.hrmCloseModal();};
  back.innerHTML=`<div class="hrm-modal" onclick="event.stopPropagation()" style="max-width:480px">
    <h3>Request a Policy Change</h3>
    <div class="sub">Sent to owners for review</div>
    <div class="field"><label>Policy *</label><select id="pcr-key">${opts}</select></div>
    <div class="field"><label>Suggested New Value *</label><input id="pcr-val"></div>
    <div class="field"><label>Reason *</label><textarea id="pcr-reason" rows="3" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn-outline" onclick="window.hrmCloseModal()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.policySubmitRequest()">Submit Request</button>
    </div>
  </div>`;
  document.body.appendChild(back);
};

window.policySubmitRequest=async function(){
  const key=document.getElementById('pcr-key')?.value;
  const val=document.getElementById('pcr-val')?.value?.trim()||'';
  const reason=document.getElementById('pcr-reason')?.value?.trim()||'';
  if(!key||!val||!reason)return showToast('All fields required.',true);
  try{
    await _hrmNotify({
      type:'policy_change_request',
      title:`Policy change request from ${session.name}`,
      message:`Suggested ${key} → "${val}". Reason: ${reason}`,
      forRole:'owner',priority:'high',actionRequired:true,actionUrl:'hrm-policy'
    });
    await logActivity('Policy change requested',`${key} → ${val} · ${reason}`);
    showToast('Request sent to owners');
    window.hrmCloseModal();
  }catch(e){showToast('Submit failed: '+e.message,true);}
};

// ───────────────────────────────────────────────────────────
// Bug Tracker — internal report-a-bug pipeline
// ───────────────────────────────────────────────────────────


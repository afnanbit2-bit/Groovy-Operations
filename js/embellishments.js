/* Groovy Operations — embellishments.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

let allRecipes=[], allPrintingJobs=[], allQCReports=[], allPrintBilling=[], allSLAEvents=[], allCommNotes=[];
let allColors=[], colorLibLoaded=false, pendingColorImport=[];
let _poEmbellishment=null; // set during PO create when recipe is detected
let printingDataLoaded=false;
let viewingRecipe=null, viewingPrintJob=null, viewingQCReport=null;
let _recipeTab='all', _jobTab='active';

// ── Permission helpers ────────────────────────────────────────────────
function _pu(){ return session&&session.u; }
function canManageRecipes(){    return _pu()&&['ammar','afnan','arfat'].includes(session.u); }
function canLockRecipe(){       return _pu()&&session.u==='ammar'; }
function canApproveNewPP(){     return _pu()&&['ammar','afnan','arfat'].includes(session.u); }
function canApproveRepeatPP(){  return _pu()&&['ammar','afnan','arfat','mustafa','haris'].includes(session.u); }
function canApproveUrgentBypass(){ return _pu()&&['ammar','afnan','arfat','mustafa'].includes(session.u); }
function canApproveBilling(){   return _pu()&&['ammar','afnan','arfat','mustafa'].includes(session.u); }
function isObserver(){          return session&&(session.role==='owner'||session.role==='manager'); }
function isPrintWorker(){       return _pu()&&session.u==='asghar'; }
function isBundleWorker(){      return _pu()&&session.u==='zohaib'; }
function isStitchWorker(){      return _pu()&&session.u==='waqas'; }
function isQCWorker(){          return _pu()&&session.u==='haris'; }
function canSeePrinting(){      return session&&(isObserver()||isPrintWorker()||isBundleWorker()||isStitchWorker()||isQCWorker()||session.u==='ammar'); }
function canViewQCReport(){     return session&&(isObserver()||isQCWorker()||session.u==='haris'); }

// ── Constants ─────────────────────────────────────────────────────────
const PROCESS_TYPES={
  rubber:      {label:'Rubber Print',        icon:'🖨️', dept:'inhouse'},
  plastisol:   {label:'Screen / Plastisol',  icon:'🎨', dept:'inhouse'},
  puff:        {label:'Puff Print',           icon:'✨', dept:'inhouse'},
  sublimation: {label:'Sublimation',          icon:'🔥', dept:'external'},
  embroidery:  {label:'Embroidery',           icon:'🪡', dept:'external'}
};
const GROOVY_SEED_COLORS=[
  {id:'clr-001',colorName:'Brown',pantoneCode:'PANTONE 438 C',hexApprox:'#5C3317',localInkName:'Camlin Brown 01',inkType:'rubber',supplierName:'Camlin',mixingNotes:''},
  {id:'clr-002',colorName:'Brown 2',pantoneCode:'PANTONE 7615 C',hexApprox:'#7A4020',localInkName:'Camlin Brown 02',inkType:'rubber',supplierName:'Camlin',mixingNotes:'Slightly warmer tone'},
  {id:'clr-003',colorName:'Cool Grey',pantoneCode:'PANTONE Cool Grey 1 C',hexApprox:'#BBBCBD',localInkName:'Camlin Grey 01',inkType:'rubber',supplierName:'Camlin',mixingNotes:''},
  {id:'clr-004',colorName:'Deep Red Orange',pantoneCode:'PANTONE 7620 C',hexApprox:'#C0392B',localInkName:'Camlin Red-Orange',inkType:'rubber',supplierName:'Camlin',mixingNotes:'Mix red + orange 3:1'},
  {id:'clr-005',colorName:'Orange',pantoneCode:'PANTONE 172 C',hexApprox:'#F4623A',localInkName:'Camlin Orange 01',inkType:'rubber',supplierName:'Camlin',mixingNotes:''},
  {id:'clr-006',colorName:'Orange 2',pantoneCode:'PANTONE 1575 C',hexApprox:'#F7965A',localInkName:'Camlin Orange 02',inkType:'rubber',supplierName:'Camlin',mixingNotes:'Lighter, peachy orange'},
  {id:'clr-007',colorName:'Navy Blue',pantoneCode:'PANTONE 289 C',hexApprox:'#1B2A4A',localInkName:'Camlin Navy 01',inkType:'rubber',supplierName:'Camlin',mixingNotes:''},
  {id:'clr-008',colorName:'White',pantoneCode:'PANTONE 11-0601 TCX',hexApprox:'#FFFFFF',localInkName:'Camlin White',inkType:'rubber',supplierName:'Camlin',mixingNotes:'Use opaque base'},
  {id:'clr-009',colorName:'Black',pantoneCode:'PANTONE Black C',hexApprox:'#2B2B2B',localInkName:'Camlin Black',inkType:'rubber',supplierName:'Camlin',mixingNotes:''},
  {id:'clr-010',colorName:'Forest Green',pantoneCode:'PANTONE 357 C',hexApprox:'#215732',localInkName:'Camlin Green 01',inkType:'rubber',supplierName:'Camlin',mixingNotes:''}
];
const TIER_INFO={
  1:{label:'Tier 1 — Basic',        css:'tier-1', desc:'1 color, 1 placement, low risk'},
  2:{label:'Tier 2 — Standard',     css:'tier-2', desc:'2–3 colors, single-sided'},
  3:{label:'Tier 3 — Advanced',     css:'tier-3', desc:'4–5 colors, double-sided, oversized'},
  4:{label:'Tier 4 — Complex',      css:'tier-4', desc:'Puff/foil/metallic, 6+ colors, all-over'}
};
// ── Printing Rate Master (seeded from current quarter rate list) ───────
// Structure matches printing_rate_master Firestore collection if migrated later.
// Keys: articleCode (uppercase), ratePerPiece, complexityTier, vendor, active
const PRINTING_RATE_MASTER=[
  {articleCode:'GB003',ratePerPiece:20,complexityTier:1},{articleCode:'GB002',ratePerPiece:20,complexityTier:1},
  {articleCode:'GB016',ratePerPiece:20,complexityTier:1},{articleCode:'GB021',ratePerPiece:20,complexityTier:1},
  {articleCode:'GB020',ratePerPiece:20,complexityTier:1},{articleCode:'GB014',ratePerPiece:20,complexityTier:1},
  {articleCode:'GB019',ratePerPiece:20,complexityTier:1},{articleCode:'GB015',ratePerPiece:20,complexityTier:1},
  {articleCode:'GB017',ratePerPiece:20,complexityTier:1},{articleCode:'GB010',ratePerPiece:15,complexityTier:1},
  {articleCode:'GB012',ratePerPiece:15,complexityTier:1},{articleCode:'GB011',ratePerPiece:15,complexityTier:1},
  {articleCode:'GB009',ratePerPiece:15,complexityTier:1},{articleCode:'GB008',ratePerPiece:15,complexityTier:1},
  {articleCode:'GB013',ratePerPiece:15,complexityTier:1},{articleCode:'GB004',ratePerPiece:15,complexityTier:1},
  {articleCode:'GB007',ratePerPiece:15,complexityTier:1},{articleCode:'GB006',ratePerPiece:15,complexityTier:1},
  {articleCode:'GB005',ratePerPiece:15,complexityTier:1},{articleCode:'GB001',ratePerPiece:20,complexityTier:1},
  {articleCode:'GB018',ratePerPiece:20,complexityTier:1},{articleCode:'GP044',ratePerPiece:50,complexityTier:1},
  {articleCode:'GP050',ratePerPiece:50,complexityTier:1},{articleCode:'GH017',ratePerPiece:70,complexityTier:2},
  {articleCode:'GH004',ratePerPiece:80,complexityTier:3},{articleCode:'GP047',ratePerPiece:70,complexityTier:2},
  {articleCode:'GP014',ratePerPiece:55,complexityTier:2},{articleCode:'GP041',ratePerPiece:60,complexityTier:2},
  {articleCode:'GP051',ratePerPiece:80,complexityTier:3},{articleCode:'GP049',ratePerPiece:50,complexityTier:2},
  {articleCode:'GP027',ratePerPiece:80,complexityTier:3},{articleCode:'GP030',ratePerPiece:60,complexityTier:2},
  {articleCode:'GP015',ratePerPiece:70,complexityTier:3},{articleCode:'GP005',ratePerPiece:35,complexityTier:2},
  {articleCode:'GP048',ratePerPiece:70,complexityTier:2},{articleCode:'AP011',ratePerPiece:60,complexityTier:2},
  {articleCode:'GP036',ratePerPiece:70,complexityTier:2},{articleCode:'GP006',ratePerPiece:15,complexityTier:1},
  {articleCode:'GP010',ratePerPiece:40,complexityTier:2},{articleCode:'GP012',ratePerPiece:40,complexityTier:2},
  {articleCode:'GP009',ratePerPiece:40,complexityTier:2},{articleCode:'GP011',ratePerPiece:40,complexityTier:2},
  {articleCode:'GP039',ratePerPiece:70,complexityTier:3},{articleCode:'GP008',ratePerPiece:70,complexityTier:3},
  {articleCode:'GP013',ratePerPiece:100,complexityTier:4},{articleCode:'GP035',ratePerPiece:50,complexityTier:2},
  {articleCode:'GP037',ratePerPiece:70,complexityTier:2},{articleCode:'GP016',ratePerPiece:70,complexityTier:2},
  {articleCode:'GP026',ratePerPiece:70,complexityTier:3},{articleCode:'GP017',ratePerPiece:45,complexityTier:2},
  {articleCode:'GP046',ratePerPiece:70,complexityTier:3},{articleCode:'GP043',ratePerPiece:60,complexityTier:2},
  {articleCode:'GP025',ratePerPiece:80,complexityTier:4},{articleCode:'GP024',ratePerPiece:100,complexityTier:4},
  {articleCode:'GP033',ratePerPiece:80,complexityTier:3},{articleCode:'GP001',ratePerPiece:80,complexityTier:3},
  {articleCode:'GP021',ratePerPiece:70,complexityTier:3},{articleCode:'GP029',ratePerPiece:70,complexityTier:3},
  {articleCode:'GP019',ratePerPiece:60,complexityTier:3},{articleCode:'GP002',ratePerPiece:60,complexityTier:2},
  {articleCode:'GP038',ratePerPiece:50,complexityTier:2},{articleCode:'GP042',ratePerPiece:55,complexityTier:2},
  {articleCode:'GP020',ratePerPiece:70,complexityTier:3},{articleCode:'GP034',ratePerPiece:60,complexityTier:2},
  {articleCode:'GP023',ratePerPiece:100,complexityTier:4},{articleCode:'GP031',ratePerPiece:100,complexityTier:3},
  {articleCode:'GP007',ratePerPiece:70,complexityTier:3},{articleCode:'GP040',ratePerPiece:40,complexityTier:2},
  {articleCode:'GP032',ratePerPiece:40,complexityTier:2},{articleCode:'GP018',ratePerPiece:40,complexityTier:2},
  {articleCode:'GP003',ratePerPiece:40,complexityTier:1},{articleCode:'GP060',ratePerPiece:40,complexityTier:1},
  {articleCode:'GP022',ratePerPiece:80,complexityTier:1},{articleCode:'GJ001',ratePerPiece:70,complexityTier:2},
  {articleCode:'GJ004',ratePerPiece:70,complexityTier:2},{articleCode:'GS004',ratePerPiece:70,complexityTier:2},
  {articleCode:'GS001',ratePerPiece:15,complexityTier:1},{articleCode:'GS002',ratePerPiece:15,complexityTier:1},
  {articleCode:'GS003',ratePerPiece:15,complexityTier:1},{articleCode:'GTT003',ratePerPiece:40,complexityTier:1},
  {articleCode:'GTT002',ratePerPiece:55,complexityTier:2},{articleCode:'GTT001',ratePerPiece:60,complexityTier:2},
  {articleCode:'GTT004',ratePerPiece:60,complexityTier:3},{articleCode:'GO001',ratePerPiece:150,complexityTier:4},
  {articleCode:'GD004',ratePerPiece:70,complexityTier:3},{articleCode:'GJ008',ratePerPiece:50,complexityTier:1},
  {articleCode:'GH021',ratePerPiece:50,complexityTier:2},{articleCode:'GH012',ratePerPiece:55,complexityTier:2},
  {articleCode:'GSH002',ratePerPiece:65,complexityTier:2},{articleCode:'GHZ001',ratePerPiece:150,complexityTier:4},
  {articleCode:'GHZ002',ratePerPiece:65,complexityTier:3},{articleCode:'GHZ006',ratePerPiece:65,complexityTier:3},
  {articleCode:'GH013',ratePerPiece:65,complexityTier:3},{articleCode:'GH023',ratePerPiece:50,complexityTier:2},
  {articleCode:'GH019',ratePerPiece:65,complexityTier:2},{articleCode:'GH022',ratePerPiece:80,complexityTier:3},
  {articleCode:'GH014',ratePerPiece:65,complexityTier:2},{articleCode:'GH015',ratePerPiece:65,complexityTier:2},
  {articleCode:'GH024',ratePerPiece:65,complexityTier:2},{articleCode:'GH016',ratePerPiece:70,complexityTier:2},
  {articleCode:'GH017',ratePerPiece:80,complexityTier:3},{articleCode:'GH018',ratePerPiece:60,complexityTier:2},
  {articleCode:'GH020',ratePerPiece:80,complexityTier:3},{articleCode:'GST019',ratePerPiece:15,complexityTier:1},
  {articleCode:'GST009',ratePerPiece:20,complexityTier:1},{articleCode:'GST010',ratePerPiece:20,complexityTier:1},
  {articleCode:'GST001',ratePerPiece:20,complexityTier:1},{articleCode:'GST004',ratePerPiece:20,complexityTier:1},
  {articleCode:'GST002',ratePerPiece:20,complexityTier:1},{articleCode:'GST003',ratePerPiece:20,complexityTier:1},
  {articleCode:'GST005',ratePerPiece:20,complexityTier:1},{articleCode:'GST015',ratePerPiece:20,complexityTier:1},
  {articleCode:'GST014',ratePerPiece:20,complexityTier:1},{articleCode:'GST013',ratePerPiece:35,complexityTier:3},
  {articleCode:'GST017',ratePerPiece:20,complexityTier:1},{articleCode:'GST016',ratePerPiece:20,complexityTier:1},
  {articleCode:'CP018',ratePerPiece:80,complexityTier:3},{articleCode:'CP002',ratePerPiece:80,complexityTier:3},
  {articleCode:'CP003',ratePerPiece:60,complexityTier:2},{articleCode:'CP004',ratePerPiece:65,complexityTier:2},
  {articleCode:'CP005',ratePerPiece:50,complexityTier:2},{articleCode:'CP006',ratePerPiece:50,complexityTier:2},
  {articleCode:'CP007',ratePerPiece:50,complexityTier:2},{articleCode:'CP008',ratePerPiece:50,complexityTier:2},
  {articleCode:'CP009',ratePerPiece:60,complexityTier:2},{articleCode:'CP010',ratePerPiece:60,complexityTier:2},
  {articleCode:'CP011',ratePerPiece:50,complexityTier:2},{articleCode:'CP012',ratePerPiece:50,complexityTier:2},
  {articleCode:'CP013',ratePerPiece:50,complexityTier:2},{articleCode:'CP014',ratePerPiece:50,complexityTier:2},
  {articleCode:'CP015',ratePerPiece:70,complexityTier:3},{articleCode:'CP016',ratePerPiece:60,complexityTier:2},
  {articleCode:'CP017',ratePerPiece:65,complexityTier:2},{articleCode:'CP001',ratePerPiece:80,complexityTier:3},
  {articleCode:'CS002',ratePerPiece:60,complexityTier:3},{articleCode:'CS001',ratePerPiece:60,complexityTier:3},
  {articleCode:'CD002',ratePerPiece:100,complexityTier:4},{articleCode:'AP016',ratePerPiece:60,complexityTier:2},
  {articleCode:'AP019',ratePerPiece:70,complexityTier:2},{articleCode:'AP017',ratePerPiece:80,complexityTier:3},
  {articleCode:'AP002',ratePerPiece:40,complexityTier:2},{articleCode:'AP001',ratePerPiece:55,complexityTier:2},
  {articleCode:'AP003',ratePerPiece:50,complexityTier:2},{articleCode:'AP007',ratePerPiece:50,complexityTier:2},
  {articleCode:'AP015',ratePerPiece:60,complexityTier:2},{articleCode:'AP008',ratePerPiece:55,complexityTier:2},
  {articleCode:'AP004',ratePerPiece:50,complexityTier:2},{articleCode:'AP010',ratePerPiece:65,complexityTier:2},
  {articleCode:'AP009',ratePerPiece:60,complexityTier:2},{articleCode:'AP005',ratePerPiece:70,complexityTier:2},
  {articleCode:'AP013',ratePerPiece:65,complexityTier:2},{articleCode:'AP012',ratePerPiece:60,complexityTier:2},
  {articleCode:'AP006',ratePerPiece:60,complexityTier:2},{articleCode:'AP018',ratePerPiece:40,complexityTier:2},
  {articleCode:'ATT001',ratePerPiece:40,complexityTier:2},{articleCode:'ATT002',ratePerPiece:55,complexityTier:2},
  {articleCode:'ATT003',ratePerPiece:50,complexityTier:2},{articleCode:'AP014',ratePerPiece:65,complexityTier:3},
  {articleCode:'GHZ007',ratePerPiece:80,complexityTier:3},{articleCode:'GHZ012',ratePerPiece:25,complexityTier:2},
  {articleCode:'GHZ013',ratePerPiece:25,complexityTier:2},{articleCode:'GHZ014',ratePerPiece:25,complexityTier:2},
  {articleCode:'GHZ015',ratePerPiece:25,complexityTier:2},{articleCode:'GHZ019',ratePerPiece:25,complexityTier:2},
  {articleCode:'GHZ022',ratePerPiece:100,complexityTier:4},{articleCode:'GST022',ratePerPiece:25,complexityTier:2},
  {articleCode:'GST023',ratePerPiece:25,complexityTier:2},{articleCode:'GST024',ratePerPiece:25,complexityTier:2},
  {articleCode:'GST025',ratePerPiece:25,complexityTier:2},{articleCode:'GST026',ratePerPiece:20,complexityTier:2},
  {articleCode:'GST030',ratePerPiece:25,complexityTier:2},{articleCode:'GST029',ratePerPiece:20,complexityTier:2},
  {articleCode:'GST032',ratePerPiece:20,complexityTier:2},{articleCode:'GST033',ratePerPiece:50,complexityTier:2},
  {articleCode:'GST034',ratePerPiece:50,complexityTier:2},{articleCode:'GST035',ratePerPiece:50,complexityTier:2},
  {articleCode:'GST049',ratePerPiece:70,complexityTier:3},{articleCode:'GST053',ratePerPiece:50,complexityTier:2},
  {articleCode:'GST054',ratePerPiece:50,complexityTier:2},{articleCode:'GSO016',ratePerPiece:50,complexityTier:2},
  {articleCode:'GP068',ratePerPiece:40,complexityTier:2},{articleCode:'GP069',ratePerPiece:40,complexityTier:2},
  {articleCode:'GP070',ratePerPiece:40,complexityTier:2}
].map(r=>({...r,source:'printing_rate_list',active:true}));
function _lookupRate(code){
  if(!code)return null;
  return PRINTING_RATE_MASTER.find(r=>r.articleCode===code.toUpperCase().trim())||null;
}
const JOB_STAGES=[
  'po_received','pp_sample','pp_approval','bulk_printing','final_qc','rework','qc_bundling','stitching','final_qc_post_stitch','closed'
];
const JOB_STAGE_LABELS={
  po_received:'PO Received',       pp_sample:'PP Sample',        pp_approval:'Awaiting PP Approval',
  bulk_printing:'Bulk Printing',   final_qc:'Final QC',         rework:'Rework',
  qc_bundling:'QC Bundling',       stitching:'Stitching',       final_qc_post_stitch:'Final QC (Post-Stitch)',
  closed:'Closed'
};
const PRIORITY_COLORS={urgent:'#000000', normal:'#111111', flexible:'#6B6B6B'};
const JOB_TYPES={
  printing:    {label:'Printing',    icon:'🖨️', hasPP:true,  stages:['awaiting_pp','printing','final_qc','rework','closed'], stageLabels:{awaiting_pp:'Awaiting PP', printing:'Printing', final_qc:'Final QC', rework:'Rework', closed:'Closed'}},
  embroidery:  {label:'Embroidery', icon:'🧵',     hasPP:true,  stages:['awaiting_pp','printing','final_qc','rework','closed'], stageLabels:{awaiting_pp:'Awaiting PP', printing:'Embroidery Job', final_qc:'Final QC', rework:'Rework', closed:'Closed'}},
  sublimation: {label:'Sublimation',icon:'🎨',     hasPP:false, stages:['printing','final_qc','rework','closed'],               stageLabels:{printing:'Sublimation Job', final_qc:'Final QC', rework:'Rework', closed:'Closed'}}
};
const JOB_TYPE_KEYS=['printing','embroidery','sublimation'];
function inferJobType(j){
  if(j&&j.jobType&&JOB_TYPES[j.jobType])return j.jobType;
  var pt=j&&j.processType;
  if(pt==='embroidery')return 'embroidery';
  if(pt==='sublimation')return 'sublimation';
  return 'printing';
}
// Map an underlying stage key to its swimlane bucket for the Observer Tower
function towerLaneStage(j){
  var s=j&&j.currentStage;
  if(s==='closed')return 'closed';
  if(s==='rework')return 'rework';
  if(s==='final_qc'||s==='final_qc_post_stitch')return 'final_qc';
  if(s==='po_received'||s==='pp_sample'||s==='pp_approval')return 'awaiting_pp';
  // bulk_printing, qc_bundling, stitching → execution column
  return 'printing';
}
const PLACEMENT_TEMPLATES=[
  {id:'front_center',      nameEn:'Front Center',          nameUr:'فرنٹ سینٹر',           side:'front',        anchorType:'hps',            defaultMeasLabel:'Drop from HPS',      defaultTol:'±0.5 inch', workerEn:'Print centered on front, measure down from HPS.',        workerUr:'سامنے سینٹر میں پرنٹ کریں، HPS سے ناپیں۔'},
  {id:'front_chest',       nameEn:'Front Chest',           nameUr:'فرنٹ چیسٹ',            side:'front',        anchorType:'hps',            defaultMeasLabel:'Drop from HPS',      defaultTol:'±0.5 inch', workerEn:'Print on chest area, measure from HPS.',                 workerUr:'چیسٹ پر پرنٹ کریں، HPS سے ناپ لیں۔'},
  {id:'front_left_chest',  nameEn:'Front Left Chest',      nameUr:'فرنٹ لیفٹ چیسٹ',      side:'front',        anchorType:'shoulder_seam',  defaultMeasLabel:'From shoulder seam', defaultTol:'±0.5 inch', workerEn:'Print on left chest, measure from shoulder seam.',        workerUr:'بائیں چیسٹ پر پرنٹ کریں۔'},
  {id:'front_right_chest', nameEn:'Front Right Chest',     nameUr:'فرنٹ رائٹ چیسٹ',      side:'front',        anchorType:'shoulder_seam',  defaultMeasLabel:'From shoulder seam', defaultTol:'±0.5 inch', workerEn:'Print on right chest, measure from shoulder seam.',       workerUr:'دائیں چیسٹ پر پرنٹ کریں۔'},
  {id:'full_front',        nameEn:'Full Front',            nameUr:'فل فرنٹ',              side:'front',        anchorType:'center_chest',   defaultMeasLabel:'Centered on front',  defaultTol:'±1 inch',   workerEn:'Full front print — center the artwork horizontally.',     workerUr:'پورے سامنے پرنٹ کریں — آرٹ ورک سینٹر میں ہو۔'},
  {id:'back_center',       nameEn:'Back Center',           nameUr:'بیک سینٹر',            side:'back',         anchorType:'hps',            defaultMeasLabel:'Drop from HPS',      defaultTol:'±0.5 inch', workerEn:'Print centered on back, measure from HPS.',              workerUr:'پیچھے سینٹر میں پرنٹ کریں۔'},
  {id:'back_neck',         nameEn:'Back Neck',             nameUr:'بیک نیک',              side:'back',         anchorType:'neck_rib',       defaultMeasLabel:'From neck rib',      defaultTol:'±0.5 inch', workerEn:'Print just below the neck rib at back.',                 workerUr:'پیچھے گلے کی پٹی کے نیچے پرنٹ کریں۔'},
  {id:'full_back',         nameEn:'Full Back',             nameUr:'فل بیک',               side:'back',         anchorType:'center_chest',   defaultMeasLabel:'Centered on back',   defaultTol:'±1 inch',   workerEn:'Full back print — center the artwork.',                  workerUr:'پورے پیچھے پرنٹ کریں — سینٹر میں ہو۔'},
  {id:'left_sleeve',       nameEn:'Left Sleeve',           nameUr:'لیفٹ سلیو',            side:'left_sleeve',  anchorType:'shoulder_seam',  defaultMeasLabel:'From shoulder seam', defaultTol:'±0.5 inch', workerEn:'Print on left sleeve, measure from shoulder seam.',       workerUr:'بائیں آستین پر پرنٹ کریں۔'},
  {id:'right_sleeve',      nameEn:'Right Sleeve',          nameUr:'رائٹ سلیو',            side:'right_sleeve', anchorType:'shoulder_seam',  defaultMeasLabel:'From shoulder seam', defaultTol:'±0.5 inch', workerEn:'Print on right sleeve, measure from shoulder seam.',      workerUr:'دائیں آستین پر پرنٹ کریں۔'},
  {id:'left_leg',          nameEn:'Left Leg',              nameUr:'لیفٹ لیگ',             side:'left_leg',     anchorType:'side_seam',      defaultMeasLabel:'From side seam',     defaultTol:'±0.5 inch', workerEn:'Print on left leg, measure from side seam.',             workerUr:'بائیں ٹانگ پر پرنٹ کریں۔'},
  {id:'right_leg',         nameEn:'Right Leg',             nameUr:'رائٹ لیگ',             side:'right_leg',    anchorType:'side_seam',      defaultMeasLabel:'From side seam',     defaultTol:'±0.5 inch', workerEn:'Print on right leg, measure from side seam.',            workerUr:'دائیں ٹانگ پر پرنٹ کریں۔'},
  {id:'hps_based',         nameEn:'HPS Based Placement',   nameUr:'HPS پلیسمنٹ',         side:'front',        anchorType:'hps',            defaultMeasLabel:'Drop from HPS',      defaultTol:'±0.5 inch', workerEn:'Measure carefully from HPS before placing.',             workerUr:'HPS سے ناپ کر پلیسمنٹ کریں۔'},
  {id:'seam_based',        nameEn:'Seam Based Placement',  nameUr:'سیم بیسڈ پلیسمنٹ',    side:'custom',       anchorType:'side_seam',      defaultMeasLabel:'From seam',          defaultTol:'±0.5 inch', workerEn:'Measure from the seam as specified.',                    workerUr:'سیم سے ناپ کر پلیسمنٹ کریں۔'},
  {id:'custom',            nameEn:'Custom Measured',       nameUr:'کسٹم ناپ والی',        side:'custom',       anchorType:'custom',         defaultMeasLabel:'Custom measurement', defaultTol:'±0.5 inch', workerEn:'Follow exact measurement specified in recipe.',          workerUr:'ریسیپی میں دی گئی ناپ فالو کریں۔'},
];
const SLA_HOURS={
  urgent:{pp_sample:4,  pp_approval:2,  bulk_printing:8,  final_qc:4,  rework:12, qc_bundling:4, stitching:24},
  normal:{pp_sample:8,  pp_approval:4,  bulk_printing:16, final_qc:8,  rework:24, qc_bundling:8, stitching:48},
  flexible:{pp_sample:24,pp_approval:8, bulk_printing:32, final_qc:16, rework:48, qc_bundling:16,stitching:72}
};

// ── Defect master list ────────────────────────────────────────────────
const DEFECT_CATS=[
  {cat:'Placement',           nameUr:'جگہ کا مسئلہ',     types:['Wrong placement','Print too high','Print too low','Shifted left','Shifted right','Not centered','Tilted print','Front/back mismatch','Size-wise mismatch']},
  {cat:'Color / Pantone',     nameUr:'رنگ / Pantone',    types:['Wrong Pantone','Shade mismatch','Color too dull','Color too bright','Wrong ink','Color registration mismatch','Color variation across lot']},
  {cat:'Print Quality',       nameUr:'پرنٹ کوالٹی',       types:['Ink bleeding','Print cracking','Smudging','Poor coverage','Patchy print','Blurry edges','Uneven pressure','Misregistration','Detail loss','Peeling','Sticky/tacky print','Overcured','Undercured']},
  {cat:'Puff Print',          nameUr:'پف پرنٹ',           types:['Puff not raised','Puff uneven','Puff cracked','Puff over-expanded','Puff too flat','Puff missing in areas']},
  {cat:'Rubber Print',        nameUr:'ربر پرنٹ',          types:['Too hard','Too sticky','Uneven layer','Rubber cracking','Too thick','Too thin']},
  {cat:'Plastisol/Screen',    nameUr:'پلاسٹیسول',         types:['Ink not cured','Heavy hand feel','Screen mark','Ink buildup','Rough surface','Gloss/matte mismatch']},
  {cat:'Sublimation',         nameUr:'سبلیمیشن',          types:['Ghosting','Blurred transfer','Color fade','Heat press mark','Transfer patchiness','Wrong position']},
  {cat:'Embroidery',          nameUr:'کڑھائی',            types:['Wrong thread color','Thread break','Loose thread','Wrong placement','Puckering','Stitch density issue','Backing issue']},
  {cat:'Material / Garment',  nameUr:'کپڑے کا مسئلہ',    types:['Stain','Ink mark','Oil mark','Heat mark','Burn mark','Fabric damage','Shade issue','Dust mark','Distortion/stretching','White material quality issue']}
];

// ── Data loader ───────────────────────────────────────────────────────
async function loadPrintingData(){
  if(printingDataLoaded)return;
  try{
    const[recSnap,jobSnap,qcSnap,bilSnap,slaSnap,comSnap,clrSnap]=await Promise.all([
      getDocs(query(collection(db,'article_recipes'),orderBy('createdAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'printing_jobs'),orderBy('createdAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'qc_reports'),orderBy('createdAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'printing_billing'),orderBy('createdAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'sla_events'),orderBy('startAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'communication_notes'),orderBy('createdAt','desc'))).catch(()=>({docs:[]})),
      getDocs(query(collection(db,'color_library'),orderBy('createdAt','desc'))).catch(()=>({docs:[]}))
    ]);
    allRecipes       = recSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allPrintingJobs  = jobSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allQCReports     = qcSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allPrintBilling  = bilSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allSLAEvents     = slaSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allCommNotes     = comSnap.docs.map(d=>({...d.data(),_id:d.id}));
    allColors        = clrSnap.docs.map(d=>({...d.data(),_id:d.id}));
    colorLibLoaded=true;
    printingDataLoaded=true;
  }catch(e){ showToast('Printing data load error: '+e.message,true); }
}
async function refreshPrintingData(){ printingDataLoaded=false; await loadPrintingData(); }

// ── Utility helpers ───────────────────────────────────────────────────
function prntId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function nowIso(){ return new Date().toISOString(); }
function tsLabel2(ts){ if(!ts)return'—'; const d=new Date(typeof ts==='number'?ts:ts); return d.toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }
function slaStatus(dueAt){
  if(!dueAt)return'ok';
  const rem=(new Date(dueAt)-Date.now())/60000;
  if(rem<0&&rem>-120)return'over';
  if(rem<=-120)return'critical';
  if(rem<60)return'near';
  return'ok';
}
function slaColor(s){ return{ok:'var(--green)',near:'var(--amber)',over:'#dc2626',critical:'#7f1d1d'}[s]||'var(--muted)'; }
function slaChipClass(s){ return{ok:'sla-ok-chip',near:'sla-near-chip',over:'sla-over-chip',critical:'sla-critical-chip'}[s]||'sla-ok-chip'; }
function remainLabel(dueAt){
  if(!dueAt)return'No SLA set';
  const rem=Math.round((new Date(dueAt)-Date.now())/60000);
  if(rem<0){ const a=Math.abs(rem); return a<60?`${a}m overdue`:`${Math.floor(a/60)}h ${a%60}m overdue`; }
  return rem<60?`${rem}m left`:`${Math.floor(rem/60)}h ${rem%60}m left`;
}
function calcDue(stage,priority){ const h=SLA_HOURS[priority||'normal'][stage]||8; return new Date(Date.now()+h*3600000).toISOString(); }
function recipeBadgeHTML(status){ const map={locked:'<span style="color:var(--green);font-weight:700">🔒 Locked</span>',active:'<span style="color:var(--green);font-weight:700">✅ Active</span>',pending_review:'<span style="color:#854F0B;font-weight:700;background:#FEF3C7;padding:2px 8px;border-radius:6px">⏳ Pending Review</span>',revision:'<span style="color:#9B1B2D;font-weight:700;background:#FBE7E9;padding:2px 8px;border-radius:6px">↩️ Revision</span>',draft:'<span style="color:var(--amber);font-weight:700">✏️ Draft</span>',archived:'<span style="color:var(--muted);font-weight:700">📦 Archived</span>'}; return map[status]||map.draft; }
function tierBadge(t){ const ti=TIER_INFO[t]||TIER_INFO[1]; return`<span class="tier-badge ${ti.css}">${ti.label}</span>`; }
function processBadge(pt){ const p=PROCESS_TYPES[pt]; return p?`<span class="process-badge">${p.icon} ${p.label}</span>`:'<span class="process-badge">—</span>'; }

// ════════════════════════════════════════════
// COLOR LIBRARY HELPERS
// ════════════════════════════════════════════

function _swatchDot(hex,size){
  size=size||16;
  return'<span style="display:inline-block;width:'+size+'px;height:'+size+'px;border-radius:50%;background:'+(hex||'#ddd')+';border:1px solid rgba(0,0,0,.12);vertical-align:middle;flex-shrink:0"></span>';
}

function _colorChipHTML(p){
  var hex=p.hexApprox||'#ddd';
  var isLegacy=!p.colorLibraryId&&!p._id;
  return'<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);margin-bottom:6px">'+
    _swatchDot(hex,20)+
    '<div style="flex:1;min-width:0">'+
      '<div style="font-size:13px;font-weight:600;color:var(--dark)">'+(p.colorName||'—')+'</div>'+
      '<div style="font-size:11px;color:var(--muted)">'+(p.pantoneCode||'')+(p.localInkName?' · '+p.localInkName:'')+'</div>'+
      (isLegacy?'<div style="font-size:10px;color:var(--amber);font-weight:600;margin-top:1px">Legacy — not linked to Color Library</div>':'')+
    '</div>'+
  '</div>';
}

function _colorCardFull(c){
  var hex=c.hexApprox||'#ddd';
  var INK_LABELS={rubber:'Rubber',plastisol:'Plastisol',puff:'Puff',sublimation:'Sublimation',embroidery_thread:'Embroidery Thread',other:'Other'};
  var canEdit=canManageRecipes();
  return'<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start">'+
    '<div style="width:44px;height:44px;border-radius:10px;background:'+hex+';border:1px solid rgba(0,0,0,.12);flex-shrink:0"></div>'+
    '<div style="flex:1;min-width:0">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px">'+
        '<div>'+
          '<div style="font-size:14px;font-weight:700;color:var(--dark)">'+(c.colorName||'—')+'</div>'+
          '<div style="font-size:12px;color:var(--muted);margin-top:1px">'+(c.pantoneCode||'No Pantone code')+'</div>'+
        '</div>'+
        (canEdit?'<div style="display:flex;gap:6px">'+
          '<button class="btn-sm" onclick="window.openColorModal(\''+c._id+'\')">Edit</button>'+
          '<button class="btn-sm" style="background:'+(c.status==='archived'?'var(--green)':'#dc2626')+'" onclick="window.toggleColorArchive(\''+c._id+'\',\''+(c.status||'active')+'\')">'+
            (c.status==='archived'?'Restore':'Archive')+'</button>'+
        '</div>':'')+
      '</div>'+
      '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">'+
        (c.localInkName?'<span style="font-size:11px;padding:2px 8px;background:#f5f5f5;border-radius:6px">'+c.localInkName+'</span>':'')+
        (c.inkType?'<span style="font-size:11px;padding:2px 8px;background:#f0f0f0;border-radius:6px;text-transform:capitalize">'+(INK_LABELS[c.inkType]||c.inkType)+'</span>':'')+
        (c.supplierName?'<span style="font-size:11px;padding:2px 8px;background:#f5f5f5;border-radius:6px">'+c.supplierName+'</span>':'')+
      '</div>'+
      (c.mixingNotes?'<div style="font-size:11px;color:var(--muted);margin-top:4px;font-style:italic">'+c.mixingNotes+'</div>':'')+
    '</div>'+
  '</div>';
}

function _ptDetailChipHTML(p){
  var hex=p.hexApprox||'#ddd';
  var isLegacy=!p.colorLibraryId;
  var showTechnical=canManageRecipes();
  var showWorker=isPrintWorker();
  return'<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f5f5f5">'+
    '<div style="width:32px;height:32px;border-radius:7px;background:'+hex+';border:1px solid rgba(0,0,0,.12);flex-shrink:0;margin-top:2px"></div>'+
    '<div style="flex:1;min-width:0">'+
      '<div style="font-size:13px;font-weight:700;color:var(--dark)">'+(p.colorName||'—')+'</div>'+
      (!showWorker?'<div style="font-size:11px;color:var(--muted)">'+(p.pantoneCode||'')+(p.localInkName?' · '+p.localInkName:'')+'</div>':'')+
      (showWorker?'<div style="font-size:12px;color:var(--muted)">'+(p.localInkName||p.pantoneCode||'')+'</div>':'')+
      (p.usage?'<div style="font-size:11px;padding:1px 7px;background:#f0f0f0;border-radius:5px;display:inline-block;margin-top:3px">'+p.usage+'</div>':'')+
      ((p.articleSpecificNotes||p.notes)?'<div style="font-size:12px;color:var(--dark);margin-top:3px;font-style:italic">'+(p.articleSpecificNotes||p.notes)+'</div>':'')+
      (isLegacy?'<div style="font-size:10px;color:var(--amber);font-weight:600;margin-top:2px">Legacy — not linked to Color Library</div>':'')+
    '</div>'+
  '</div>';
}

// ════════════════════════════════════════════
// COLOR LIBRARY PAGE
// ════════════════════════════════════════════

function renderColorLibraryPage(){
  if(!canSeePrinting()){return'<div class="empty">Not authorized.</div>';}
  var active=allColors.filter(function(c){return c.status!=='archived';});
  var archived=allColors.filter(function(c){return c.status==='archived';});
  var canEdit=canManageRecipes();
  return'<div class="page-head">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">'+
      '<div><div class="page-title">Color Library</div><div class="page-sub">'+active.length+' active color'+(active.length!==1?'s':'')+' · '+archived.length+' archived</div></div>'+
      (canEdit?'<div style="display:flex;gap:8px;flex-wrap:wrap">'+
        '<button class="btn-outline" onclick="window.seedColorLibrary()">Seed Starter Colors</button>'+
        '<button class="btn-primary" style="width:auto;padding:8px 16px" onclick="window.openColorModal(null)">+ Add Color</button>'+
      '</div>':'')+
    '</div>'+
  '</div>'+
  '<div style="font-size:11px;color:var(--muted);margin-bottom:12px;padding:8px 12px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a">Digital swatches are for reference only. Final approval must match physical Pantone / ink sample.</div>'+
  (canEdit?_renderColorImporterBlock():'')+
  (active.length?'<div style="display:grid;gap:8px;margin-bottom:12px">'+active.map(function(c){return _colorCardFull(c);}).join('')+'</div>':'<div class="empty" style="margin-bottom:12px">No colors in library yet. Add colors or seed starter set.</div>')+
  (archived.length?'<details style="margin-bottom:16px"><summary style="font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;padding:8px 0">Archived ('+archived.length+')</summary><div style="display:grid;gap:8px;margin-top:8px;opacity:.65">'+archived.map(function(c){return _colorCardFull(c);}).join('')+'</div></details>':'')+
  '<div id="color-modal-container"></div>';
}

window.openColorModal=function(id){
  var c=id?allColors.find(function(x){return x._id===id;}):null;
  var INK_TYPES=['rubber','plastisol','puff','sublimation','embroidery_thread','other'];
  var INK_LABELS={rubber:'Rubber',plastisol:'Plastisol',puff:'Puff',sublimation:'Sublimation',embroidery_thread:'Embroidery Thread',other:'Other'};
  var container=document.getElementById('color-modal-container');
  if(!container)return;
  container.innerHTML='<div id="color-modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:flex-end;justify-content:center" onclick="if(event.target.id===\'color-modal-overlay\')window.closeColorModal()">'+
    '<div style="background:var(--surface);width:100%;max-width:520px;border-radius:16px 16px 0 0;padding:20px;max-height:90vh;overflow-y:auto">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'+
        '<div style="font-size:16px;font-weight:700">'+(c?'Edit Color':'Add New Color')+'</div>'+
        '<button onclick="window.closeColorModal()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--amber);margin-bottom:12px;padding:7px 10px;background:#fffbeb;border-radius:8px">Digital swatch is only an approximation. Confirm with physical Pantone/ink sample.</div>'+
      '<div class="form-grid">'+
        '<div class="field"><label>Color Name *</label><input id="cm-name" value="'+(c&&c.colorName?c.colorName:'')+'" placeholder="e.g. Brown"></div>'+
        '<div class="field"><label>Pantone Code</label><input id="cm-pantone" value="'+(c&&c.pantoneCode?c.pantoneCode:'')+'" placeholder="e.g. PANTONE 438 C"></div>'+
        '<div class="field"><label>HEX Approximation</label>'+
          '<div style="display:flex;gap:8px;align-items:center">'+
            '<input id="cm-hex" value="'+(c&&c.hexApprox?c.hexApprox:'')+'" placeholder="#5C3317" style="flex:1" oninput="window._updateSwatchPreview()">'+
            '<div id="cm-swatch-preview" style="width:36px;height:36px;border-radius:8px;background:'+(c&&c.hexApprox?c.hexApprox:'#ddd')+';border:1px solid var(--border);flex-shrink:0"></div>'+
          '</div>'+
        '</div>'+
        '<div class="field"><label>Local Ink Name</label><input id="cm-ink" value="'+(c&&c.localInkName?c.localInkName:'')+'" placeholder="e.g. Camlin Brown 01"></div>'+
        '<div class="field"><label>Ink Type</label>'+
          '<select id="cm-type" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">'+
            INK_TYPES.map(function(t){return'<option value="'+t+'"'+(c&&c.inkType===t?' selected':'')+'>'+INK_LABELS[t]+'</option>';}).join('')+
          '</select>'+
        '</div>'+
        '<div class="field"><label>Supplier Name</label><input id="cm-supplier" value="'+(c&&c.supplierName?c.supplierName:'')+'" placeholder="e.g. Camlin"></div>'+
        '<div class="field" style="grid-column:1/-1"><label>Mixing Notes</label><input id="cm-mixing" value="'+(c&&c.mixingNotes?c.mixingNotes:'')+'" placeholder="e.g. Mix red + orange 3:1"></div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-top:16px">'+
        '<button class="btn-outline" onclick="window.closeColorModal()" style="flex:1">Cancel</button>'+
        '<button class="btn-primary" style="flex:1" onclick="window.saveColor(\''+(id||'')+'\')">Save Color</button>'+
      '</div>'+
    '</div>'+
  '</div>';
};
window.closeColorModal=function(){var el=document.getElementById('color-modal-container');if(el)el.innerHTML='';};
window._updateSwatchPreview=function(){
  var hex=(document.getElementById('cm-hex')||{}).value||'#ddd';
  var prev=document.getElementById('cm-swatch-preview');
  if(prev)prev.style.background=hex;
};
window.saveColor=async function(existingId){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  var name=((document.getElementById('cm-name')||{}).value||'').trim();
  if(!name){showToast('Color name required.',true);return;}
  var existing=existingId?allColors.find(function(c){return c._id===existingId;}):null;
  var payload={
    colorName:name,
    pantoneCode:((document.getElementById('cm-pantone')||{}).value||'').trim(),
    hexApprox:((document.getElementById('cm-hex')||{}).value||'').trim(),
    localInkName:((document.getElementById('cm-ink')||{}).value||'').trim(),
    inkType:(document.getElementById('cm-type')||{}).value||'rubber',
    supplierName:((document.getElementById('cm-supplier')||{}).value||'').trim(),
    mixingNotes:((document.getElementById('cm-mixing')||{}).value||'').trim(),
    status:'active',
    createdBy:existingId?(existing&&existing.createdBy||session.name):session.name,
    createdAt:existingId?(existing&&existing.createdAt||nowIso()):nowIso(),
    updatedAt:nowIso(),
    approvedBy:null,
    approvedAt:null
  };
  try{
    var id=existingId||prntId();
    await setDoc(doc(db,'color_library',id),payload);
    var idx=allColors.findIndex(function(c){return c._id===id;});
    if(idx>=0)allColors[idx]=Object.assign({},payload,{_id:id});
    else allColors.unshift(Object.assign({},payload,{_id:id}));
    showToast('Color saved.');
    window.closeColorModal();
    var mc=document.getElementById('main-content');
    if(mc)mc.innerHTML=renderColorLibraryPage();
  }catch(e){showToast('Save error: '+e.message,true);}
};
window.toggleColorArchive=async function(id,currentStatus){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  var newStatus=currentStatus==='archived'?'active':'archived';
  try{
    await updateDoc(doc(db,'color_library',id),{status:newStatus,updatedAt:nowIso()});
    var c=allColors.find(function(x){return x._id===id;});
    if(c)c.status=newStatus;
    var mc=document.getElementById('main-content');
    if(mc)mc.innerHTML=renderColorLibraryPage();
    showToast(newStatus==='archived'?'Archived.':'Restored.');
  }catch(e){showToast('Error: '+e.message,true);}
};
window.seedColorLibrary=async function(){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  if(!confirm('Seed '+GROOVY_SEED_COLORS.length+' starter colors into the Color Library? Existing colors will not be overwritten.'))return;
  var added=0;
  var now=nowIso();
  for(var i=0;i<GROOVY_SEED_COLORS.length;i++){
    var sc=GROOVY_SEED_COLORS[i];
    if(allColors.find(function(c){return c.pantoneCode===sc.pantoneCode;}))continue;
    var payload=Object.assign({},sc,{status:'active',createdBy:session.name,createdAt:now,updatedAt:now,approvedBy:null,approvedAt:null});
    var newId=prntId();
    await setDoc(doc(db,'color_library',newId),payload).catch(function(){});
    allColors.unshift(Object.assign({},payload,{_id:newId}));
    added++;
  }
  showToast(added+' color'+(added!==1?'s':'')+' added.');
  var mc=document.getElementById('main-content');
  if(mc)mc.innerHTML=renderColorLibraryPage();
};

// ── XLSX → Color Library importer ──
var COLOR_IMPORT_PANTONE_NAMES={'109 C':'Bright Yellow','116 C':'Yellow','165 C':'Orange','172 C':'Red Orange','185 C':'Bright Red','187 C':'Crimson Red','278 C':'Sky Blue','285 C':'Royal Blue','289 C':'Navy Blue','298 C':'Light Blue','307 C':'Ocean Blue','357 C':'Forest Green','375 C':'Lime Green','410 C':'Warm Grey','429 C':'Light Cool Grey','430 C':'Cool Grey','438 C':'Brown','447 C':'Dark Olive','485 C':'Fire Red','518 C':'Plum','573 C':'Mint Green','660 C':'Cobalt Blue','680 C':'Magenta','877 C':'Metallic Silver','1575 C':'Light Orange','2289 C':'Spring Green','2310 C':'Light Pink','2655 C':'Lavender','2945 C':'Royal Blue 2','2955 C':'Dark Navy','4058 C':'Tan','4143 C':'Olive Green','4165 C':'Pale Yellow','4268 C':'Khaki','5435 C':'Pale Blue','7410 C':'Peach','7458 C':'Powder Blue','7596 C':'Tan Brown','7615 C':'Brown 2','7620 C':'Deep Red Orange','7628 C':'Burgundy','7686 C':'Slate Blue','7688 C':'Cobalt Blue 2','7689 C':'Steel Blue','7732 C':'Forest Green 2','7739 C':'Bright Green','Cool Grey 1 C':'Cool Grey 1','Cool Grey 3 C':'Cool Grey 3','Cool Grey 5 C':'Cool Grey 5','Cool Grey 8 C':'Cool Grey 8','Cool Grey 10 C':'Cool Grey 10','Pantone Red 032 C':'Bright Red','White':'White','Black':'Black','Base':'Clear Base'};
var COLOR_IMPORT_PANTONE_HEX={'109 C':'#ffd100','116 C':'#ffcd00','165 C':'#ff671f','172 C':'#fa4616','185 C':'#e4002b','187 C':'#a6192e','278 C':'#8dc8e8','285 C':'#0072ce','289 C':'#0c2340','298 C':'#41b6e6','307 C':'#006298','357 C':'#2d5016','375 C':'#97d700','410 C':'#888b8d','429 C':'#a2aaad','430 C':'#7c878e','438 C':'#5c3317','447 C':'#3e3f2e','485 C':'#da291c','518 C':'#6e3667','573 C':'#b5e3d8','660 C':'#1f65bc','680 C':'#893b67','877 C':'#8a8d8f','1575 C':'#ff8f1c','2028 C':'#ffa382','2289 C':'#94e337','2310 C':'#ffc9dd','2655 C':'#9678d3','2945 C':'#00549a','2955 C':'#003f72','4058 C':'#b6885f','4143 C':'#4f5b2d','4165 C':'#c7c99b','4268 C':'#6f6f4d','5435 C':'#b5c5c9','7410 C':'#ffb57f','7458 C':'#6baed6','7596 C':'#a48a6f','7615 C':'#7a4020','7620 C':'#c0392b','7628 C':'#6f2c2d','7686 C':'#2d6ca2','7688 C':'#1a6fbe','7689 C':'#2c7bb6','7732 C':'#2b7339','7739 C':'#43b02a','61220 C':'#cccccc','Cool Grey 1 C':'#c8c8c8','Cool Grey 3 C':'#b8b8b8','Cool Grey 5 C':'#989898','Cool Grey 8 C':'#6f7271','Cool Grey 10 C':'#53565a','Pantone Red 032 C':'#e31c23','White':'#ffffff','Black':'#000000','Base':'#f0f0f0'};
var COLOR_IMPORT_HEX_FALLBACK='#cccccc';
var COLOR_IMPORT_PATTERNS=[/\bPantone\s+Red\s+\d{3}\s*C\b/gi,/\b(?:Cool|Warm)\s+Grey\s+\d{1,2}\s*C\b/gi,/\b\d{3,5}\s*C\b/gi,/\bWhite\b/gi,/\bBlack\b/gi,/\bBASE\b/gi];
function _canonPantone(raw){
  var s=raw.trim().replace(/\s+/g,' ');
  if(/^white$/i.test(s))return'White';
  if(/^black$/i.test(s))return'Black';
  if(/^base$/i.test(s))return'Base';
  s=s.replace(/^pantone\s+red\s+(\d{3})\s*c$/i,'Pantone Red $1 C');
  s=s.replace(/^cool\s+grey\s+(\d{1,2})\s*c$/i,'Cool Grey $1 C');
  s=s.replace(/^warm\s+grey\s+(\d{1,2})\s*c$/i,'Warm Grey $1 C');
  s=s.replace(/^(\d{3,5})\s*c$/i,'$1 C');
  return s;
}
function _slugPantone(c){return c.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function _suggestPantoneName(code){return COLOR_IMPORT_PANTONE_NAMES[code]||('Pantone '+code);}
function _suggestPantoneHex(code){return COLOR_IMPORT_PANTONE_HEX[code]||COLOR_IMPORT_HEX_FALLBACK;}
function _extractPantonesFromText(text){
  var found={};
  for(var i=0;i<COLOR_IMPORT_PATTERNS.length;i++){
    var m=text.match(COLOR_IMPORT_PATTERNS[i])||[];
    for(var j=0;j<m.length;j++)found[_canonPantone(m[j])]=true;
  }
  return Object.keys(found);
}
function _ensureSheetJS(){
  if(window.XLSX)return Promise.resolve(window.XLSX);
  return new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';
    s.onload=function(){resolve(window.XLSX);};
    s.onerror=function(){reject(new Error('Failed to load SheetJS'));};
    document.head.appendChild(s);
  });
}
function _ciEsc(s){return String(s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});}
function _renderColorImporterBlock(){
  return '<details id="color-import-details" style="margin-bottom:14px;background:var(--surface);border:1px solid var(--border);border-radius:12px">'+
    '<summary style="padding:12px 14px;cursor:pointer;font-size:13px;font-weight:700;list-style:none;display:flex;justify-content:space-between;align-items:center">'+
      '<span>Bulk import from XLSX</span>'+
      '<span style="font-size:11px;color:var(--muted);font-weight:500">Click to expand</span>'+
    '</summary>'+
    '<div style="padding:0 14px 14px;border-top:1px solid var(--border)">'+
      '<div style="font-size:11px;color:var(--muted);margin:10px 0">Upload an XLSX. Pantone codes (e.g. "357 C", "Cool Grey 1C", "Pantone Red 032 C", "White", "Black", "Base") are extracted from any cell. Existing codes are skipped.</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'+
        '<input type="file" id="color-xlsx-file" accept=".xlsx,.xls" style="font-size:12px;flex:1;min-width:180px">'+
        '<button class="btn-outline" onclick="window.parseColorXlsx()">Parse file</button>'+
      '</div>'+
      '<div id="color-import-preview"></div>'+
      '<div id="color-import-progress" style="margin-top:8px"></div>'+
    '</div>'+
  '</details>';
}
function _renderColorImportPreview(){
  var preview=document.getElementById('color-import-preview');
  if(!preview)return;
  if(!pendingColorImport.length){
    preview.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px 0">No Pantone codes detected in this file.</div>';
    return;
  }
  var n=pendingColorImport.length;
  var rows='';
  for(var i=0;i<n;i++){
    var p=pendingColorImport[i];
    rows+='<div style="width:24px;height:24px;border-radius:5px;background:'+_ciEsc(p.hex)+';border:1px solid rgba(0,0,0,.12);align-self:center"></div>'+
          '<div style="align-self:center">'+
            '<div style="font-family:ui-monospace,monospace;font-size:11px;line-height:1.2">'+_ciEsc(p.code)+'</div>'+
            '<div style="font-family:ui-monospace,monospace;font-size:10px;color:var(--muted);line-height:1.2">'+_ciEsc(p.hex)+'</div>'+
          '</div>'+
          '<input type="text" data-i="'+i+'" class="ci-name-edit" value="'+_ciEsc(p.name)+'" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff">'+
          '<div id="ci-row-'+i+'" style="font-size:10px;color:var(--muted);align-self:center">pending</div>';
  }
  preview.innerHTML='<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:8px">'+
    '<div style="font-size:12px;font-weight:600;margin-bottom:8px">'+n+' unique pantone code'+(n!==1?'s':'')+' detected</div>'+
    '<div style="display:grid;grid-template-columns:28px auto 1fr auto;gap:6px 10px;max-height:280px;overflow-y:auto;padding-right:6px;align-items:center">'+rows+'</div>'+
    '<button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:10px" onclick="window.runColorImport()">Import to Color Library</button>'+
  '</div>';
  preview.querySelectorAll('.ci-name-edit').forEach(function(el){
    el.addEventListener('input',function(e){
      var idx=+e.target.dataset.i;
      if(pendingColorImport[idx])pendingColorImport[idx].name=e.target.value;
    });
  });
}
window.parseColorXlsx=async function(){
  var fi=document.getElementById('color-xlsx-file');
  var file=fi&&fi.files&&fi.files[0];
  if(!file){showToast('Choose an XLSX file first.',true);return;}
  var preview=document.getElementById('color-import-preview');
  var prog=document.getElementById('color-import-progress');
  if(preview)preview.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px 0">Parsing…</div>';
  if(prog)prog.innerHTML='';
  try{
    var XLSX=await _ensureSheetJS();
    var buf=await file.arrayBuffer();
    var wb=XLSX.read(buf,{type:'array'});
    var allText='';
    for(var i=0;i<wb.SheetNames.length;i++){
      var sheet=wb.Sheets[wb.SheetNames[i]];
      allText+='\n'+XLSX.utils.sheet_to_csv(sheet,{FS:'\n'});
    }
    var codes=_extractPantonesFromText(allText);
    codes.sort(function(a,b){return a.localeCompare(b,undefined,{numeric:true});});
    pendingColorImport=codes.map(function(c){return{code:c,name:_suggestPantoneName(c),hex:_suggestPantoneHex(c),slug:_slugPantone(c)};});
    _renderColorImportPreview();
  }catch(e){
    if(preview)preview.innerHTML='<div style="font-size:12px;color:#dc2626;padding:6px 0">Parse error: '+e.message+'</div>';
  }
};
window.runColorImport=async function(){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  if(!pendingColorImport.length){showToast('Parse a file first.',true);return;}
  var prog=document.getElementById('color-import-progress');
  var ok=0,skip=0,err=0;
  var total=pendingColorImport.length;
  for(var i=0;i<total;i++){
    var p=pendingColorImport[i];
    var rowEl=document.getElementById('ci-row-'+i);
    try{
      var dupe=allColors.find(function(c){return(c.pantoneCode||'').trim().toLowerCase()===p.code.toLowerCase();});
      if(dupe){
        skip++;
        if(rowEl){rowEl.textContent='skipped';rowEl.style.color='#7a5c1a';}
      }else{
        var ref=doc(db,'color_library',p.slug);
        var snap=await getDoc(ref);
        if(snap.exists()){
          skip++;
          if(rowEl){rowEl.textContent='skipped';rowEl.style.color='#7a5c1a';}
        }else{
          var payload={
            colorName:p.name,
            pantoneCode:p.code,
            hexApprox:p.hex||null,
            supplierName:'',
            mixingNotes:'',
            status:'active',
            createdBy:'ammar',
            createdAt:nowIso(),
            updatedAt:null,
            approvedBy:null,
            approvedAt:null
          };
          await setDoc(ref,payload);
          allColors.unshift(Object.assign({},payload,{_id:p.slug}));
          ok++;
          if(rowEl){rowEl.textContent='imported';rowEl.style.color='#1d6f3a';}
        }
      }
    }catch(e){
      err++;
      if(rowEl){rowEl.textContent='failed';rowEl.style.color='#9a1f1f';rowEl.title=e.message;}
    }
    if(prog){
      prog.innerHTML='<div style="font-size:11px;color:var(--muted);padding:4px 0">'+(i+1)+'/'+total+' processed · '+ok+' imported · '+skip+' skipped · '+err+' failed</div>';
    }
  }
  showToast(ok+' added, '+skip+' skipped'+(err?', '+err+' failed':''));
  pendingColorImport=[];
  var mc=document.getElementById('main-content');
  if(mc)mc.innerHTML=renderColorLibraryPage();
};

// ════════════════════════════════════════════
// RECIPE DIRECTORY
// ════════════════════════════════════════════

function renderRecipeDirectory(){
  const canCreate=canManageRecipes()&&!isPrintWorker();
  const canDraft=(isQCWorker()||canManageRecipes())&&!isPrintWorker();
  const isOM=canManageRecipes();
  const isAsghar=isPrintWorker();
  const q=(document.getElementById('recipe-q')||{}).value||'';

  const pendingDrafts=allRecipes.filter(r=>r.status==='pending_review');
  const myRevisions=isQCWorker()?allRecipes.filter(r=>r.status==='revision'&&r.submittedBy===session.u):[];

  const list=allRecipes.filter(r=>{
    if(isAsghar) return r.status==='active'&&(!q||(r.articleCode||'').toLowerCase().includes(q.toLowerCase())||(r.articleName||'').toLowerCase().includes(q.toLowerCase()));
    if(r.status==='pending_review'||r.status==='revision')return false;
    if(!q)return true;
    return(r.articleCode||'').toLowerCase().includes(q.toLowerCase())||(r.articleName||'').toLowerCase().includes(q.toLowerCase());
  });

  const missingWarnings=allRecipes.filter(r=>r.status!=='pending_review'&&r.status!=='revision'&&(!r.printing?.ratePerPiece||!r.printing?.processTypes?.length||!r.images?.frontUrl));
  const approvedCount=allRecipes.filter(r=>r.status==='active'||r.status==='locked').length;

  return`<div class="page-head">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div><div class="page-title">Recipe Directory</div><div class="page-sub">${allRecipes.length} articles · ${approvedCount} approved</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-outline" style="padding:9px 14px" onclick="window.printBlankRecipeSheet()">🖨️ Print Blank Sheet</button>
        ${canDraft?`<button class="btn-outline" style="padding:9px 14px" onclick="window.openNewRecipeDraft()">+ New Recipe Draft</button>`:''}
        ${canCreate?`<button class="btn-primary" style="width:auto;padding:10px 18px" onclick="window.showPage('recipe-create')">+ New Recipe</button>`:''}
      </div>
    </div>
  </div>

  ${isOM&&pendingDrafts.length?`<div class="card" style="border-left:3px solid #F59E0B;margin-bottom:12px;padding:0">
    <div style="display:flex;align-items:center;gap:8px;padding:14px 16px 8px;font-weight:700"><span style="color:#854F0B">⏳ Drafts Pending Review</span><span style="background:#F59E0B;color:#fff;font-size:11px;padding:2px 9px;border-radius:10px">${pendingDrafts.length}</span></div>
    ${pendingDrafts.map(r=>`<div onclick="window.openRecipeDraftReview('${r._id}')" style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-top:1px solid #f0f0f0;cursor:pointer" onmouseenter="this.style.background='#fafafa'" onmouseleave="this.style.background=''">
      <div style="min-width:0">
        <div style="font-weight:600;font-size:14px">${r.articleName||'Untitled'}</div>
        <div style="font-size:11px;color:var(--muted)">${r.articleCode||'—'} · PO ${r.poNumber||'—'} · by ${r.submittedBy||r.createdBy||'—'}${r.submittedAt?' · '+new Date(r.submittedAt).toLocaleString('en-GB'):''} · ${(r.draftPlacements||[]).length} placement${(r.draftPlacements||[]).length===1?'':'s'}</div>
      </div>
      <div style="font-size:18px;color:var(--muted)">›</div>
    </div>`).join('')}
  </div>`:''}

  ${myRevisions.length?`<div class="card" style="border-left:3px solid #E94560;margin-bottom:12px;padding:0">
    <div style="display:flex;align-items:center;gap:8px;padding:14px 16px 8px;font-weight:700;color:#9B1B2D">↩️ Sent Back for Revision</div>
    ${myRevisions.map(r=>`<div onclick="window.openRecipeDraftEdit('${r._id}')" style="padding:10px 16px;border-top:1px solid #f0f0f0;cursor:pointer" onmouseenter="this.style.background='#fafafa'" onmouseleave="this.style.background=''">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="min-width:0">
          <div style="font-weight:600;font-size:14px">${r.articleName||'Untitled'}</div>
          <div style="font-size:11px;color:var(--muted)">${r.articleCode||'—'} · PO ${r.poNumber||'—'}</div>
        </div>
        <div style="font-size:18px;color:var(--muted)">›</div>
      </div>
      ${r.revisionNote?`<div style="font-size:12px;color:#9B1B2D;margin-top:6px;padding:6px 10px;background:#FBE7E9;border-radius:6px">"${r.revisionNote}"</div>`:''}
    </div>`).join('')}
  </div>`:''}

  ${missingWarnings.length?`<div class="alert-banner alert-amber" style="margin-bottom:12px">⚠ ${missingWarnings.length} recipe${missingWarnings.length>1?'s':''} missing rate, process type, or front image</div>`:''}

  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <input id="recipe-q" placeholder="Search article code or name…" oninput="window._filterRecipes(this.value)" value="${q}"
      style="flex:1;min-width:160px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
    ${!isAsghar?`<select onchange="window._filterRecipeStatus(this.value)" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
      <option value="">All status</option><option value="active">Active</option><option value="locked">Locked</option><option value="draft">Draft</option><option value="archived">Archived</option>
    </select>`:''}
    <select onchange="window._filterRecipeTier(this.value)" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
      <option value="">All tiers</option>${[1,2,3,4].map(t=>`<option value="${t}">Tier ${t}</option>`).join('')}
    </select>
  </div>

  <div id="recipe-list-wrap">
    ${list.length?list.map(r=>recipeCardHTML(r)).join(''):'<div class="empty">No recipes yet.'+(canDraft?' Click + New Recipe Draft to start.':'')+'</div>'}
  </div>`;
}
window._filterRecipes=function(q){
  const isAsghar=isPrintWorker();
  const list=allRecipes.filter(r=>{
    if(isAsghar) return r.status==='active'&&(!q||(r.articleCode||'').toLowerCase().includes(q.toLowerCase())||(r.articleName||'').toLowerCase().includes(q.toLowerCase()));
    return !q||(r.articleCode||'').toLowerCase().includes(q.toLowerCase())||(r.articleName||'').toLowerCase().includes(q.toLowerCase());
  });
  const w=document.getElementById('recipe-list-wrap'); if(w)w.innerHTML=list.length?list.map(r=>recipeCardHTML(r)).join(''):'<div class="empty">No results.</div>';
};
window._filterRecipeStatus=function(s){
  const list=s?allRecipes.filter(r=>r.status===s):allRecipes;
  const w=document.getElementById('recipe-list-wrap'); if(w)w.innerHTML=list.length?list.map(r=>recipeCardHTML(r)).join(''):'<div class="empty">No results.</div>';
};
window._filterRecipeTier=function(t){
  const list=t?allRecipes.filter(r=>String(r.printing?.complexityTier||'')===t):allRecipes;
  const w=document.getElementById('recipe-list-wrap'); if(w)w.innerHTML=list.length?list.map(r=>recipeCardHTML(r)).join(''):'<div class="empty">No results.</div>';
};

function recipeCardHTML(r){
  const tier=r.printing?.complexityTier||1;
  const hasImg=!!r.images?.frontUrl;
  const hasRate=!!r.printing?.ratePerPiece;
  const hasPantone=(r.printing?.pantones||[]).length>0;
  const warnings=[];
  if(!hasImg)warnings.push('No image');
  if(!hasRate)warnings.push('No rate');
  if(!hasPantone)warnings.push('No Pantones');
  if(!(r.printing?.processTypes||[]).length)warnings.push('No process');
  return`<div class="recipe-card" onclick="window.openRecipeDetail('${r._id}')">
    <div style="display:flex;gap:12px;align-items:flex-start">
      <div style="width:56px;height:70px;flex-shrink:0;background:#f0f0f0;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center">
        ${hasImg?`<img src="${r.images.frontUrl}" style="width:100%;height:100%;object-fit:cover">`:'<span style="font-size:9px;color:#ccc;text-align:center;padding:4px">No img</span>'}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
          <span style="font-size:11px;font-weight:700;color:var(--red)">${r.articleCode||'—'}</span>
          ${recipeBadgeHTML(r.status||'draft')}
          ${tierBadge(tier)}
        </div>
        <div style="font-size:14px;font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.articleName||'Untitled'}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${(r.printing?.processTypes||[]).map(pt=>processBadge(pt)).join(' ')}</div>
        ${r.printing?.ratePerPiece?`<div style="font-size:12px;font-weight:600;color:var(--dark)">Rs. ${r.printing.ratePerPiece}/pc</div>`:''}
        ${warnings.length?`<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${warnings.map(w=>`<span style="font-size:10px;background:#f0f0f0;color:#111;padding:2px 6px;border-radius:6px;font-weight:600">⚠ ${w}</span>`).join('')}</div>`:''}
      </div>
      <div style="font-size:18px;color:var(--muted)">›</div>
    </div>
  </div>`;
}
window.openRecipeDetail=function(id){ viewingRecipe=id; currentPage='recipe-detail'; document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('on')); document.getElementById('nav-recipe-directory')?.classList.add('on'); renderRecipeDetailPage(); };

// ── Two-Tier Recipe Draft Flow (Haris submits → Ammar approves) ───────────
const RD_PLACEMENT_TYPES=['Front Center / فرنٹ سینٹر','Front Chest / فرنٹ چیسٹ','Front Left Chest / فرنٹ لیفٹ چیسٹ','Front Right Chest / فرنٹ رائٹ چیسٹ','Full Front / فل فرنٹ','Back Center / بیک سینٹر','Back Neck / بیک نیک','Full Back / فل بیک','Left Sleeve / لیفٹ سلیو','Right Sleeve / رائٹ سلیو','Left Leg / لیفٹ لیگ','Right Leg / رائٹ لیگ','HPS Based Placement / HPS شمارت','Seam Based Placement / سیم بیسڈ شمارت','Custom Measured / کسٹم ناپ والی'];
const RD_TECHNIQUES=['Screen Print','Puff Print','Sublimation','Embroidery'];
let _rdIdx=0;

function _rdEsc(s){ return String(s==null?'':s).replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _draftTypeToTemplateId(placementType){
  const nameEn=(placementType||'').split('/')[0].trim();
  const tpl=PLACEMENT_TEMPLATES.find(t=>t.nameEn.toLowerCase()===nameEn.toLowerCase());
  return tpl?tpl.id:'custom';
}

function _rdPlacementRowHTML(i,p={}){
  return`<div class="rd-pl-row" data-idx="${i}" style="display:grid;grid-template-columns:1.2fr 1.4fr 1fr 1.4fr auto;gap:8px;margin-bottom:8px;align-items:end">
    <div class="field" style="margin:0"><label style="font-size:11px">Placement Type</label>
      <select id="rd-pl-type-${i}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
        <option value="">Select…</option>
        ${RD_PLACEMENT_TYPES.map(t=>`<option value="${t}" ${p.placementType===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="margin:0"><label style="font-size:11px">Position &amp; Size (inches)</label>
      <input id="rd-pl-pos-${i}" placeholder='e.g. 4&quot; x 3&quot; centered' value="${_rdEsc(p.positionSize)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
    </div>
    <div class="field" style="margin:0"><label style="font-size:11px">Technique</label>
      <select id="rd-pl-tech-${i}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
        <option value="">Select…</option>
        ${RD_TECHNIQUES.map(t=>`<option value="${t}" ${p.technique===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="margin:0"><label style="font-size:11px">Notes</label>
      <input id="rd-pl-notes-${i}" value="${_rdEsc(p.notes)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
    </div>
    <button type="button" onclick="window._rdRemovePlacement(${i})" style="padding:8px 10px;border:1px solid #fecaca;background:#fff5f5;color:#dc2626;border-radius:8px;font-size:12px;cursor:pointer;height:36px">Remove</button>
  </div>`;
}

function _rdCollectPlacements(){
  const out=[];
  document.querySelectorAll('#rd-placements .rd-pl-row').forEach(row=>{
    const i=row.getAttribute('data-idx');
    const placementType=document.getElementById('rd-pl-type-'+i)?.value||'';
    const positionSize=document.getElementById('rd-pl-pos-'+i)?.value?.trim()||'';
    const technique=document.getElementById('rd-pl-tech-'+i)?.value||'';
    const notes=document.getElementById('rd-pl-notes-'+i)?.value?.trim()||'';
    if(placementType||positionSize||technique||notes){
      out.push({placementType,positionSize,technique,notes,pantones:[]});
    }
  });
  return out;
}

window.openNewRecipeDraft=function(){ viewingRecipe=null; _rdIdx=0; window.showPage('recipe-draft'); };
window.openRecipeDraftEdit=function(id){ viewingRecipe=id; window.showPage('recipe-draft'); };
window.openRecipeDraftReview=function(id){ viewingRecipe=id; currentPage='recipe-draft-review'; document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('on')); document.getElementById('nav-recipe-directory')?.classList.add('on'); renderRecipeDraftReviewPage(); };

window._rdSearch=function(qRaw){
  const dd=document.getElementById('rd-search-dd'); if(!dd)return;
  const q=(qRaw||'').trim().toLowerCase();
  if(q.length<2){dd.style.display='none';dd.innerHTML='';return;}
  // Search the master article catalog (PRODUCT_CATALOG) — the permanent
  // directory of every article/code ever defined, independent of any PO.
  // It's a module-level constant always in memory; no fetch needed.
  const cat=(typeof PRODUCT_CATALOG!=='undefined'?PRODUCT_CATALOG:[]);
  const results=cat.filter(p=>(p.code||'').toLowerCase().includes(q)||(p.name||'').toLowerCase().includes(q)).slice(0,15);
  if(!results.length){dd.innerHTML='<div style="padding:10px 12px;color:var(--muted);font-size:13px">Article not found — contact Ammar</div>';dd.style.display='block';return;}
  dd.innerHTML=results.map(p=>{
    const m={articleName:p.name||'',articleCode:p.code||''};
    const data=encodeURIComponent(JSON.stringify(m));
    return`<div onclick="window._rdPick('${data}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:13px" onmouseenter="this.style.background='#f5f5f5'" onmouseleave="this.style.background=''">
      <div style="font-weight:600">${p.name||'(no name)'}</div>
      <div style="font-size:11px;color:var(--muted)">${p.code||'—'}</div>
    </div>`;
  }).join('');
  dd.style.display='block';
};

window._rdPick=function(encoded){
  let m; try{ m=JSON.parse(decodeURIComponent(encoded)); }catch(e){return;}
  const setVal=(id,v)=>{ const el=document.getElementById(id); if(el)el.value=v==null?'':v; };
  // The master catalog only carries name+code. Best-effort enrich the extra
  // read-only fields from already-loaded data (no fetch) so they populate when
  // the article also has an active PO or existing recipe.
  const code=(m.articleCode||'').toUpperCase().trim();
  let po=m.poNumber||'',qty=m.totalQty||'',fab=m.fabricType||'';
  if(code){
    const poHit=(typeof allPOs!=='undefined'?allPOs:[]).find(p=>(p.code||'').toUpperCase().trim()===code);
    if(poHit){ po=po||poHit.id||''; qty=qty||poHit.qty||''; fab=fab||poHit.fabric||''; }
    if(!po||!qty||!fab){
      const rHit=(typeof allRecipes!=='undefined'?allRecipes:[]).find(r=>(r.articleCode||'').toUpperCase().trim()===code);
      if(rHit){ po=po||rHit.poNumber||''; qty=qty||rHit.totalQty||''; fab=fab||rHit.fabricType||''; }
    }
  }
  setVal('rd-articleName',m.articleName);
  setVal('rd-articleCode',m.articleCode);
  setVal('rd-poNumber',po);
  setVal('rd-totalQty',qty);
  setVal('rd-fabricType',fab);
  setVal('rd-search-q','');
  const dd=document.getElementById('rd-search-dd'); if(dd){dd.style.display='none';dd.innerHTML='';}
  const fields=document.getElementById('rd-fields'); if(fields)fields.style.display='block';
};

window._rdClear=function(){
  ['rd-articleName','rd-articleCode','rd-poNumber','rd-totalQty','rd-fabricType','rd-search-q'].forEach(id=>{
    const el=document.getElementById(id); if(el)el.value='';
  });
  const dd=document.getElementById('rd-search-dd'); if(dd){dd.style.display='none';dd.innerHTML='';}
  const fields=document.getElementById('rd-fields'); if(fields)fields.style.display='none';
  const sq=document.getElementById('rd-search-q'); if(sq)sq.focus();
};

window._rdAddPlacement=function(){
  const c=document.getElementById('rd-placements'); if(!c)return;
  const i=_rdIdx++;
  const tmp=document.createElement('div');
  tmp.innerHTML=_rdPlacementRowHTML(i);
  c.appendChild(tmp.firstChild);
};
window._rdRemovePlacement=function(i){
  document.querySelector('.rd-pl-row[data-idx="'+i+'"]')?.remove();
};

function renderRecipeDraftPage(){
  if(!isQCWorker()&&!canManageRecipes())return'<div class="empty">Not authorized.</div>';
  const editing=viewingRecipe?allRecipes.find(r=>r._id===viewingRecipe):null;
  const isResubmit=!!(editing&&(editing.status==='revision'||editing.status==='pending_review'));
  const initialPlacements=(editing&&(editing.draftPlacements||[]).length)?editing.draftPlacements:[{}];
  _rdIdx=initialPlacements.length;
  return`<button class="back-btn" onclick="window.showPage('recipe-directory')">← Back to Recipe Directory</button>
  <div class="page-head"><div class="page-title">${isResubmit?'Edit Draft':'New Recipe Draft'}</div><div class="page-sub">${isResubmit?'Update fields and resubmit for review':'Search the article, list placements, submit for review'}</div></div>

  ${isResubmit&&editing.revisionNote?`<div class="alert-banner alert-amber" style="margin-bottom:12px"><strong>Revision requested:</strong> ${_rdEsc(editing.revisionNote)}</div>`:''}

  <div class="card"><div class="card-title">Article</div>
    <div style="position:relative;margin-bottom:8px">
      <input id="rd-search-q" placeholder="Search by article name or code…" oninput="window._rdSearch(this.value)" autocomplete="off" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <div id="rd-search-dd" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:8px;margin-top:4px;max-height:280px;overflow-y:auto;z-index:10;box-shadow:0 4px 14px rgba(0,0,0,0.08)"></div>
    </div>
    <div id="rd-fields" style="display:${editing?'block':'none'}">
      <div class="form-grid">
        <div class="field"><label>Article Name</label><input id="rd-articleName" readonly value="${_rdEsc(editing?.articleName)}" style="background:#fafafa"></div>
        <div class="field"><label>Article Code</label><input id="rd-articleCode" readonly value="${_rdEsc(editing?.articleCode)}" style="background:#fafafa"></div>
        <div class="field"><label>PO Number</label><input id="rd-poNumber" readonly value="${_rdEsc(editing?.poNumber)}" style="background:#fafafa"></div>
        <div class="field"><label>Total Qty</label><input id="rd-totalQty" readonly value="${_rdEsc(editing?.totalQty)}" style="background:#fafafa"></div>
        <div class="field"><label>Fabric Type</label><input id="rd-fabricType" readonly value="${_rdEsc(editing?.fabricType)}" style="background:#fafafa"></div>
      </div>
      <button type="button" class="btn-outline" style="margin-top:8px;padding:6px 14px" onclick="window._rdClear()">Clear &amp; Search Again</button>
    </div>
  </div>

  <div class="card"><div class="card-title">Placements</div>
    <div id="rd-placements">
      ${initialPlacements.map((p,i)=>_rdPlacementRowHTML(i,p)).join('')}
    </div>
    <button type="button" class="btn-outline" style="width:100%;margin-top:8px" onclick="window._rdAddPlacement()">+ Add Placement</button>
  </div>

  <div style="display:flex;gap:8px;margin-top:4px">
    <button class="btn-primary" style="flex:1" onclick="window.submitRecipeDraft('${editing?._id||''}')">${isResubmit?'Resubmit for Review':'Submit Draft'}</button>
  </div>
  <div style="height:80px"></div>`;
}

window.submitRecipeDraft=async function(existingId){
  const articleName=document.getElementById('rd-articleName')?.value?.trim()||'';
  const articleCode=document.getElementById('rd-articleCode')?.value?.trim()||'';
  if(!articleName||!articleCode){showToast('Search and select an article first.',true);return;}
  const placements=_rdCollectPlacements();
  if(!placements.length){showToast('Add at least one placement.',true);return;}
  const editing=existingId?allRecipes.find(r=>r._id===existingId):null;
  const id=existingId||prntId();
  const now=nowIso();
  const payload={
    articleName,articleCode,
    poNumber:document.getElementById('rd-poNumber')?.value?.trim()||'',
    totalQty:parseInt(document.getElementById('rd-totalQty')?.value)||0,
    fabricType:document.getElementById('rd-fabricType')?.value?.trim()||'',
    status:'pending_review',
    submittedBy:session.u,
    submittedAt:now,
    createdBy:editing?.createdBy||session.name,
    createdAt:editing?.createdAt||now,
    updatedAt:now,
    version:(editing?.version||0)+1,
    draftPlacements:placements,
    revisionNote:'',
    recipeNotes:editing?.recipeNotes||'',
    approvedBy:editing?.approvedBy||null,
    approvedAt:editing?.approvedAt||null,
    images:editing?.images||{frontUrl:'',backUrl:'',placementGuideUrl:'',approvedPpSampleUrl:'',closeupUrls:[]},
    printing:editing?.printing||{required:true,processTypes:[],complexityTier:1,ratePerPiece:0,rateSource:'manual',rateMasterMatched:false,rateOverrideNote:'',rateEffectiveQuarter:'Q2-2025',vendorName:'',placements:[],pantones:[],instructionsEn:'',instructionsUr:''},
    qcSuggestions:editing?.qcSuggestions||[],
    changeHistory:[...(editing?.changeHistory||[]),{by:session.name,at:now,action:existingId?'resubmitted':'submitted_for_review',note:''}]
  };
  try{
    await setDoc(doc(db,'article_recipes',id),payload);
    if(editing){const i=allRecipes.findIndex(r=>r._id===id); if(i>=0)allRecipes[i]={...payload,_id:id}; else allRecipes.unshift({...payload,_id:id});}
    else allRecipes.unshift({...payload,_id:id});
    await logActivity(existingId?'Recipe draft resubmitted':'Recipe draft submitted',`${articleCode} — ${articleName}`);
    if(typeof _hrmNotify==='function'){
      await _hrmNotify({
        type:'info',priority:'normal',
        title:existingId?'Recipe draft resubmitted':'New recipe draft submitted',
        message:`${existingId?'Resubmitted':'New'} draft for ${articleName} (${articleCode}) by ${session.name} — review required`,
        forUser:'ammar', relatedTo:id, actionRequired:true, actionUrl:'recipe-directory'
      });
    }
    showToast(existingId?'Resubmitted ✓':'Draft submitted ✓');
    viewingRecipe=null; _rdIdx=0;
    window.showPage('recipe-directory');
  }catch(e){showToast('Submit error: '+e.message,true);}
};

// ── Draft review (Ammar) ──
function _rdrPantoneChipHTML(i,j,pn){
  return`<span class="rdr-pn-chip" data-pi="${i}" data-pj="${j}" data-color-id="${_rdEsc(pn.colorLibraryId)}" data-color-name="${_rdEsc(pn.colorName)}" data-pantone-code="${_rdEsc(pn.pantoneCode)}" data-hex-approx="${_rdEsc(pn.hexApprox)}" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:#f0f0f0;border-radius:14px;font-size:12px">
    <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${pn.hexApprox||'#ccc'};border:1px solid #ddd"></span>
    <span>${_rdEsc(pn.colorName)||'—'}${pn.pantoneCode?' · '+_rdEsc(pn.pantoneCode):''}</span>
    <button type="button" onclick="window._rdrRemovePantone(${i},${j})" style="border:none;background:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0;line-height:1">×</button>
  </span>`;
}

function _rdrPlacementRowHTML(i,p={}){
  const colorOpts=(typeof allColors!=='undefined'?allColors:[]).filter(c=>c.status!=='archived')
    .map(c=>`<option value="${c._id}">${_rdEsc(c.colorName)||'—'}${c.pantoneCode?' · '+_rdEsc(c.pantoneCode):''}</option>`).join('');
  return`<div class="rdr-pl-row" data-idx="${i}" style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:10px;background:#fcfcfd">
    <div style="display:grid;grid-template-columns:1.2fr 1.4fr 1fr auto;gap:8px;align-items:end">
      <div class="field" style="margin:0"><label style="font-size:11px">Placement Type</label>
        <select id="rdr-pl-type-${i}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
          <option value="">Select…</option>
          ${RD_PLACEMENT_TYPES.map(t=>`<option value="${t}" ${p.placementType===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0"><label style="font-size:11px">Position &amp; Size (inches)</label>
        <input id="rdr-pl-pos-${i}" value="${_rdEsc(p.positionSize)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      </div>
      <div class="field" style="margin:0"><label style="font-size:11px">Technique</label>
        <select id="rdr-pl-tech-${i}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
          <option value="">Select…</option>
          ${RD_TECHNIQUES.map(t=>`<option value="${t}" ${p.technique===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <button type="button" onclick="window._rdrRemovePlacement(${i})" style="padding:8px 10px;border:1px solid #fecaca;background:#fff5f5;color:#dc2626;border-radius:8px;font-size:12px;cursor:pointer;height:36px">Remove</button>
    </div>
    <div class="field" style="margin:8px 0 0"><label style="font-size:11px">Notes</label>
      <input id="rdr-pl-notes-${i}" value="${_rdEsc(p.notes)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
    </div>
    <div style="margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Pantone Colors</div>
      <div id="rdr-pl-pantones-${i}" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
        ${(p.pantones||[]).map((pn,j)=>_rdrPantoneChipHTML(i,j,pn)).join('')}
      </div>
      <select onchange="window._rdrAddPantone(${i},this.value);this.value='';" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff;outline:none;max-width:280px">
        <option value="">+ Add color from library…</option>
        ${colorOpts}
      </select>
    </div>
  </div>`;
}

window._rdrAddPlacement=function(){
  const c=document.getElementById('rdr-placements'); if(!c)return;
  const i=_rdIdx++;
  const tmp=document.createElement('div');
  tmp.innerHTML=_rdrPlacementRowHTML(i);
  c.appendChild(tmp.firstChild);
};
window._rdrRemovePlacement=function(i){
  document.querySelector('.rdr-pl-row[data-idx="'+i+'"]')?.remove();
};
window._rdrAddPantone=function(plIdx,colorId){
  if(!colorId)return;
  const c=(typeof allColors!=='undefined'?allColors:[]).find(x=>x._id===colorId); if(!c)return;
  const wrap=document.getElementById('rdr-pl-pantones-'+plIdx); if(!wrap)return;
  const j=wrap.querySelectorAll('.rdr-pn-chip').length;
  const pn={colorLibraryId:c._id,colorName:c.colorName||'',pantoneCode:c.pantoneCode||'',hexApprox:c.hexApprox||''};
  const tmp=document.createElement('div');
  tmp.innerHTML=_rdrPantoneChipHTML(plIdx,j,pn);
  wrap.appendChild(tmp.firstChild);
};
window._rdrRemovePantone=function(plIdx,j){
  const wrap=document.getElementById('rdr-pl-pantones-'+plIdx); if(!wrap)return;
  const chip=wrap.querySelector('.rdr-pn-chip[data-pj="'+j+'"]');
  if(chip)chip.remove();
};

function _rdrCollectPlacements(){
  const out=[];
  document.querySelectorAll('#rdr-placements .rdr-pl-row').forEach(row=>{
    const i=row.getAttribute('data-idx');
    const placementType=document.getElementById('rdr-pl-type-'+i)?.value||'';
    const positionSize=document.getElementById('rdr-pl-pos-'+i)?.value?.trim()||'';
    const technique=document.getElementById('rdr-pl-tech-'+i)?.value||'';
    const notes=document.getElementById('rdr-pl-notes-'+i)?.value?.trim()||'';
    const pantones=[];
    document.querySelectorAll('#rdr-pl-pantones-'+i+' .rdr-pn-chip').forEach(chip=>{
      pantones.push({
        colorLibraryId:chip.dataset.colorId||'',
        colorName:chip.dataset.colorName||'',
        pantoneCode:chip.dataset.pantoneCode||'',
        hexApprox:chip.dataset.hexApprox||''
      });
    });
    if(placementType||positionSize||technique||notes||pantones.length){
      out.push({placementType,positionSize,technique,notes,pantones});
    }
  });
  return out;
}

function _rdrCollectPayload(){
  return{
    articleName:document.getElementById('rdr-articleName')?.value?.trim()||'',
    articleCode:document.getElementById('rdr-articleCode')?.value?.trim()||'',
    poNumber:document.getElementById('rdr-poNumber')?.value?.trim()||'',
    totalQty:parseInt(document.getElementById('rdr-totalQty')?.value)||0,
    fabricType:document.getElementById('rdr-fabricType')?.value?.trim()||'',
    recipeNotes:document.getElementById('rdr-notes')?.value?.trim()||'',
    draftPlacements:_rdrCollectPlacements()
  };
}

function renderRecipeDraftReviewPage(){
  const m=document.getElementById('main-content'); if(!m)return;
  if(!canManageRecipes()){m.innerHTML='<div class="empty">Not authorized.</div>';return;}
  const r=allRecipes.find(x=>x._id===viewingRecipe);
  if(!r){window.showPage('recipe-directory');return;}
  const pt=r.printing||{};
  const imgs=r.images||{};
  const draftPls=r.draftPlacements||[];
  // Map draft placements to full placement format; if Ammar already saved full placements, use those
  const placements=(pt.placements&&pt.placements.length)?pt.placements:draftPls.map(dp=>({
    placementTemplateId:_draftTypeToTemplateId(dp.placementType),
    measurementText:dp.positionSize||'',
    measurementUnit:'inch',
    toleranceText:'',toleranceUnit:'inch',
    production:{referenceImageUrl:'',visibleInstructionEn:dp.notes||'',visibleInstructionUr:''},
    technical:{artworkSize:'',artworkFileUrl:'',printDimensionNotes:''}
  }));
  _plIdx=placements.length; _ptIdx=0;
  const rm=_lookupRate(r.articleCode||'');
  m.innerHTML=`<button class="back-btn" onclick="window.showPage('recipe-directory')">← Back to Recipe Directory</button>
  <div class="page-head">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700;color:var(--red)">${_rdEsc(r.articleCode)||'—'}</span>
          ${recipeBadgeHTML(r.status||'pending_review')}
        </div>
        <div class="page-title" style="margin-top:4px">Review Draft — ${_rdEsc(r.articleName)||'Untitled'}</div>
        <div class="page-sub">Submitted by ${_rdEsc(r.submittedBy||r.createdBy||'—')}${r.submittedAt?' · '+new Date(r.submittedAt).toLocaleString('en-GB'):''} · ${draftPls.length} placement${draftPls.length===1?'':'s'} from Haris</div>
      </div>
    </div>
  </div>

  <div class="card"><div class="card-title">Article Identity</div>
    <div class="form-grid">
      <div class="field"><label>Article Code *</label><input id="rc-code" placeholder="e.g. GP020" value="${_rdEsc(r.articleCode)}" oninput="window._rcLookupRate(this.value)" onchange="window._rcLookupRate(this.value)"></div>
      <div class="field"><label>Article Name *</label><input id="rc-name" value="${_rdEsc(r.articleName)}"></div>
      <div class="field"><label>Brand</label><input id="rc-brand" value="${_rdEsc(r.brand||'')}"></div>
      <div class="field"><label>Category</label>
        <select id="rc-cat"><option value="">Select…</option>${['T-Shirt','Shirt','Hoodie','Zipper','Sweatshirt','Cargo','Trouser','Jersey','Babytee','Set','Jacket','Denim','Shorts'].map(c=>`<option value="${c}" ${r.category===c?'selected':''}>${c}</option>`).join('')}</select>
      </div>
      <div class="field"><label>PO Number</label><input id="rc-po" value="${_rdEsc(r.poNumber||'')}" style="background:#fafafa" readonly></div>
      <div class="field"><label>Total Qty</label><input id="rc-qty" value="${r.totalQty||''}" style="background:#fafafa" readonly></div>
      <div class="field"><label>Fabric Type</label><input id="rc-fabric" value="${_rdEsc(r.fabricType||'')}" style="background:#fafafa" readonly></div>
    </div>
  </div>

  <div class="card"><div class="card-title">Embellishment Details</div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1">
        <label>Process Types (select all that apply)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          ${Object.entries(PROCESS_TYPES).map(([k,v])=>`<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:#fafafa">
            <input type="checkbox" id="rc-pt-${k}" ${(pt.processTypes||[]).includes(k)?'checked':''} style="accent-color:var(--dark)"> ${v.icon} ${v.label}
          </label>`).join('')}
        </div>
      </div>
      <div id="rc-rate-status" style="grid-column:1/-1">${rm?`<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px"><span style="color:var(--green);font-weight:700">Rate found from Printing Rate List ✅</span><span style="color:var(--muted)">Rs. ${rm.ratePerPiece}/pc · Tier ${rm.complexityTier}</span></div>`:''}</div>
      <div class="field"><label>Complexity Tier *</label>
        <select id="rc-tier" onchange="window._rcMarkOverride()">${[1,2,3,4].map(t=>`<option value="${t}" ${(pt.complexityTier||1)==t?'selected':''}>${TIER_INFO[t].label} — ${TIER_INFO[t].desc}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Rate per Piece (Rs.) *</label><input id="rc-rate" type="number" min="0" step="0.5" placeholder="0.00" value="${pt.ratePerPiece||''}" oninput="window._rcMarkOverride()"></div>
      <div id="rc-override-row" style="grid-column:1/-1;display:none"></div>
      <div class="field" style="grid-column:1/-1"><label>Instructions (English)</label><textarea id="rc-instr-en" rows="3" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:100%;font-family:inherit;resize:vertical;outline:none">${_rdEsc(pt.instructionsEn||'')}</textarea></div>
      <div class="field" style="grid-column:1/-1"><label>ہدایات (اردو)</label><textarea id="rc-instr-ur" rows="3" dir="rtl" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:100%;font-family:inherit;resize:vertical;outline:none;text-align:right">${_rdEsc(pt.instructionsUr||'')}</textarea></div>
    </div>
  </div>

  <div class="card"><div class="card-title">Placements${draftPls.length&&!pt.placements?.length?' (pre-filled from Haris\'s draft)':''}</div>
    <div id="rc-placements">
      ${placements.map((pl,i)=>placementRowHTML(i,pl)).join('')}
    </div>
    <button type="button" class="btn-outline" style="width:100%;margin-top:6px" onclick="window.addPlacementRow()">+ Add Placement</button>
  </div>

  <div class="card"><div class="card-title">Pantone / Ink Colors</div>
    <div id="rc-pantones">
      ${(pt.pantones||[]).map((p,i)=>pantoneRowHTML(i,p)).join('')}
    </div>
    <button type="button" class="btn-outline" style="width:100%;margin-top:6px" onclick="window.addPantoneRow()">+ Add Color</button>
  </div>

  <div class="card"><div class="card-title">Product Images</div>
    <div class="form-grid">
      <div class="field"><label>Front Image URL</label><input id="rc-img-front" placeholder="https://…" value="${_rdEsc(imgs.frontUrl||'')}"></div>
      <div class="field"><label>Back Image URL</label><input id="rc-img-back" placeholder="https://…" value="${_rdEsc(imgs.backUrl||'')}"></div>
      <div class="field" style="grid-column:1/-1"><label>Placement Guide URL</label><input id="rc-img-place" placeholder="https://…" value="${_rdEsc(imgs.placementGuideUrl||'')}"></div>
    </div>
  </div>

  <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
    <button class="btn-outline" style="flex:1;min-width:140px" onclick="window.saveDraftReview('${r._id}')">Save Changes</button>
    <button class="btn-primary" style="flex:1;min-width:140px;background:var(--green)" onclick="window.approveRecipeDraft('${r._id}')">Approve &amp; Publish Recipe ✅</button>
    <button class="btn-outline" style="flex:1;min-width:140px;color:#9B1B2D;border-color:#E94560" onclick="window.revisionRecipeDraft('${r._id}')">Send Back for Revision ↩️</button>
  </div>
  <div style="height:80px"></div>`;
}

window.saveDraftReview=async function(id){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  const r=allRecipes.find(x=>x._id===id); if(!r)return;
  const code=(document.getElementById('rc-code')?.value||'').trim().toUpperCase();
  const name=(document.getElementById('rc-name')?.value||'').trim();
  if(!code||!name){showToast('Article code and name required.',true);return;}
  const now=nowIso();
  const rm=_lookupRate(code);
  const tier=parseInt(document.getElementById('rc-tier')?.value)||1;
  const rate=parseFloat(document.getElementById('rc-rate')?.value)||0;
  const processTypes=Object.keys(PROCESS_TYPES).filter(k=>document.getElementById('rc-pt-'+k)?.checked);
  const updates={
    articleCode:code,articleName:name,
    brand:document.getElementById('rc-brand')?.value.trim()||'',
    category:document.getElementById('rc-cat')?.value||'',
    updatedAt:now,
    images:{frontUrl:document.getElementById('rc-img-front')?.value.trim()||'',backUrl:document.getElementById('rc-img-back')?.value.trim()||'',placementGuideUrl:document.getElementById('rc-img-place')?.value.trim()||'',approvedPpSampleUrl:r.images?.approvedPpSampleUrl||'',closeupUrls:r.images?.closeupUrls||[]},
    printing:{...(r.printing||{}),processTypes,complexityTier:tier,ratePerPiece:rate,placements:collectPlacements(),pantones:collectPantones(),instructionsEn:document.getElementById('rc-instr-en')?.value.trim()||'',instructionsUr:document.getElementById('rc-instr-ur')?.value.trim()||'',rateSource:rm?((rate!==rm.ratePerPiece||tier!==rm.complexityTier)?'override':'printing_rate_list'):'manual',rateMasterMatched:!!rm},
    changeHistory:[...(r.changeHistory||[]),{by:session.name,at:now,action:'edited_in_review',note:''}]
  };
  try{
    await updateDoc(doc(db,'article_recipes',id),updates);
    Object.assign(r,updates);
    showToast('Saved ✓');
    renderRecipeDraftReviewPage();
  }catch(e){showToast('Error: '+e.message,true);}
};

window.approveRecipeDraft=async function(id){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  if(!confirm('Approve and publish this recipe?'))return;
  const r=allRecipes.find(x=>x._id===id); if(!r)return;
  const code=(document.getElementById('rc-code')?.value||'').trim().toUpperCase();
  const name=(document.getElementById('rc-name')?.value||'').trim();
  if(!code||!name){showToast('Article code and name required.',true);return;}
  const now=nowIso();
  const rm=_lookupRate(code);
  const tier=parseInt(document.getElementById('rc-tier')?.value)||1;
  const rate=parseFloat(document.getElementById('rc-rate')?.value)||0;
  const processTypes=Object.keys(PROCESS_TYPES).filter(k=>document.getElementById('rc-pt-'+k)?.checked);
  const updates={
    articleCode:code,articleName:name,
    brand:document.getElementById('rc-brand')?.value.trim()||'',
    category:document.getElementById('rc-cat')?.value||'',
    status:'active',approvedBy:session.u,approvedAt:now,revisionNote:'',updatedAt:now,
    images:{frontUrl:document.getElementById('rc-img-front')?.value.trim()||'',backUrl:document.getElementById('rc-img-back')?.value.trim()||'',placementGuideUrl:document.getElementById('rc-img-place')?.value.trim()||'',approvedPpSampleUrl:r.images?.approvedPpSampleUrl||'',closeupUrls:r.images?.closeupUrls||[]},
    printing:{...(r.printing||{}),processTypes,complexityTier:tier,ratePerPiece:rate,placements:collectPlacements(),pantones:collectPantones(),instructionsEn:document.getElementById('rc-instr-en')?.value.trim()||'',instructionsUr:document.getElementById('rc-instr-ur')?.value.trim()||'',rateSource:rm?((rate!==rm.ratePerPiece||tier!==rm.complexityTier)?'override':'printing_rate_list'):'manual',rateMasterMatched:!!rm},
    changeHistory:[...(r.changeHistory||[]),{by:session.name,at:now,action:'approved',note:''}]
  };
  try{
    await updateDoc(doc(db,'article_recipes',id),updates);
    Object.assign(r,updates);
    await logActivity('Recipe approved',`${code} — ${name}`);
    if(typeof _hrmNotify==='function'&&r.submittedBy){
      await _hrmNotify({type:'info',priority:'normal',title:'Recipe approved',message:`Recipe for ${name} (${code}) has been approved and published by ${session.name}`,forUser:r.submittedBy,relatedTo:id,actionUrl:'recipe-directory'});
    }
    showToast('Recipe approved ✓');
    viewingRecipe=null; _plIdx=0; _ptIdx=0;
    window.showPage('recipe-directory');
  }catch(e){showToast('Error: '+e.message,true);}
};

window.revisionRecipeDraft=async function(id){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  const reason=(prompt('Reason for sending back for revision:')||'').trim();
  if(!reason){showToast('Reason is required.',true);return;}
  const r=allRecipes.find(x=>x._id===id); if(!r)return;
  const code=(document.getElementById('rc-code')?.value||r.articleCode||'').trim().toUpperCase();
  const name=(document.getElementById('rc-name')?.value||r.articleName||'').trim();
  const now=nowIso();
  const updates={status:'revision',revisionNote:reason,updatedAt:now,changeHistory:[...(r.changeHistory||[]),{by:session.name,at:now,action:'sent_for_revision',note:reason}]};
  try{
    await updateDoc(doc(db,'article_recipes',id),updates);
    Object.assign(r,updates);
    await logActivity('Recipe sent for revision',`${code} — ${reason}`);
    if(typeof _hrmNotify==='function'&&r.submittedBy){
      await _hrmNotify({type:'info',priority:'high',title:'Recipe needs revision',message:`Recipe for ${name} (${code}) needs revision — ${reason}`,forUser:r.submittedBy,relatedTo:id,actionRequired:true,actionUrl:'recipe-directory'});
    }
    showToast('Sent for revision ✓');
    viewingRecipe=null;
    window.showPage('recipe-directory');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Printable Blank Placement Sheet ──
window.printBlankRecipeSheet=function(){
  const win=window.open('','_blank');
  if(!win){showToast('Popup blocked. Please allow popups.',true);return;}
  const block=()=>`<div class="block">
    <div class="meta">
      <div class="meta-item"><span>Date:</span><span class="meta-line"></span></div>
      <div class="meta-item" style="flex:2.2"><span>Article Name:</span><span class="meta-line"></span></div>
      <div class="meta-item" style="flex:1.5"><span>Article Code:</span><span class="meta-line"></span></div>
    </div>
    <table>
      <thead><tr><th class="col-num">#</th><th class="col-type">Placement Type</th><th>Placement (inches)</th></tr></thead>
      <tbody>
        ${Array.from({length:5}).map((_,i)=>`<tr><td class="col-num row-cell">${i+1}</td><td class="row-cell"></td><td class="row-cell"></td></tr>`).join('')}
      </tbody>
    </table>
  </div>`;
  win.document.write(`<!DOCTYPE html><html><head><title>Placement Recipe Sheet — Blank</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;color:#000;background:#fff;font-size:9px;line-height:1.2;padding:5mm}
    .sheet{width:100%}
    .head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;padding-bottom:2px;margin-bottom:4px}
    .brand{font-size:16px;font-weight:900;letter-spacing:2px}
    .subtitle{font-size:10px;font-weight:600;letter-spacing:.5px}
    .block{margin-bottom:4px;padding-bottom:4px;border-bottom:1px dashed #000}
    .block:last-of-type{border-bottom:none;margin-bottom:0;padding-bottom:0}
    .meta{display:flex;gap:6px;font-size:9px;font-weight:600;margin-bottom:2px}
    .meta-item{flex:1;display:flex;align-items:flex-end;gap:3px}
    .meta-line{flex:1;border-bottom:1px solid #000;display:inline-block;height:12px}
    table{border-collapse:collapse;width:100%;font-size:9px;table-layout:fixed}
    th,td{border:1px solid #000;padding:1px 4px;text-align:left;vertical-align:middle}
    th{background:#eee;font-weight:700;font-size:8px;text-transform:uppercase;letter-spacing:.4px;height:13px}
    th.col-num,td.col-num{width:20px;text-align:center}
    th.col-type{width:38%}
    td.row-cell{height:14px}
    .footer{margin-top:4px;padding-top:4px;border-top:2px solid #000;display:flex;gap:14px;font-size:9px}
    .footer-item{flex:1;display:flex;align-items:flex-end;gap:5px}
    .footer-label{font-weight:700;white-space:nowrap}
    .footer-line{flex:1;border-bottom:1px solid #000;height:12px}
    .no-print{margin-top:8px;text-align:center}
    .no-print button{padding:7px 16px;background:#1A1A2E;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit}
    @media print{
      @page{size:A4 portrait;margin:5mm}
      html,body{height:auto}
      body{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .no-print{display:none}
      .block,table,.footer{page-break-inside:avoid}
      .sheet{page-break-after:avoid}
    }
  </style></head><body>
  <div class="sheet">
    <div class="head">
      <span class="brand">GROOVY</span>
      <span class="subtitle">Placement Recipe Sheet</span>
    </div>
    ${block()}${block()}${block()}${block()}${block()}${block()}
    <div class="footer">
      <div class="footer-item"><span class="footer-label">Prepared by:</span><span class="footer-line"></span></div>
      <div class="footer-item"><span class="footer-label">Signature:</span><span class="footer-line"></span></div>
    </div>
    <div class="no-print"><button onclick="window.print()">Print Sheet 🖨️</button></div>
  </div>
  <script>setTimeout(function(){window.print();},350);<\/script>
  </body></html>`);
  win.document.close();
};

// ── Recipe Create / Edit ───────────────────────────────────────────────
function renderRecipeCreatePage(){
  if(!canManageRecipes())return'<div class="empty">Not authorized to create recipes.</div>';
  const editing=viewingRecipe?allRecipes.find(r=>r._id===viewingRecipe):null;
  const e=editing||{};
  const pt=e.printing||{};
  const imgs=e.images||{};
  return`<button class="back-btn" onclick="window.showPage('recipe-directory')">← Back to Recipe Directory</button>
  <div class="page-head"><div class="page-title">${editing?'Edit Recipe':'New Recipe'}</div><div class="page-sub">Article code is the master key</div></div>

  <div class="card"><div class="card-title">Article Identity</div>
    <div class="form-grid">
      <div class="field"><label>Article Code *</label><input id="rc-code" placeholder="e.g. GP020" value="${e.articleCode||''}" oninput="window._rcLookupRate(this.value)" onchange="window._rcLookupRate(this.value)"></div>
      <div class="field"><label>Article Name *</label><input id="rc-name" placeholder="e.g. GRVYBirds | Puff Printed" value="${e.articleName||''}"></div>
      <div class="field"><label>Brand</label><input id="rc-brand" placeholder="e.g. GROOVY" value="${e.brand||''}"></div>
      <div class="field"><label>Category</label>
        <select id="rc-cat"><option value="">Select…</option>${['T-Shirt','Shirt','Hoodie','Zipper','Sweatshirt','Cargo','Trouser','Jersey','Babytee','Set','Jacket','Denim','Shorts'].map(c=>`<option value="${c}" ${e.category===c?'selected':''}>${c}</option>`).join('')}</select>
      </div>
    </div>
  </div>

  <div class="card"><div class="card-title">Embellishment Details</div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1">
        <label>Process Types (select all that apply)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          ${Object.entries(PROCESS_TYPES).map(([k,v])=>`<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:#fafafa">
            <input type="checkbox" id="rc-pt-${k}" ${(pt.processTypes||[]).includes(k)?'checked':''} style="accent-color:var(--dark)"> ${v.icon} ${v.label}
          </label>`).join('')}
        </div>
      </div>
      <div id="rc-rate-status" style="grid-column:1/-1">${(()=>{
        const rm=_lookupRate(e.articleCode||'');
        if(!e.articleCode)return'';
        if(rm)return`<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px">
          <span style="color:var(--green);font-weight:700">Rate found from Printing Rate List ✅</span>
          <span style="color:var(--muted)">Rs. ${rm.ratePerPiece}/pc · Tier ${rm.complexityTier}</span>
          <span style="color:var(--muted);margin-left:auto">Source: Current Quarter Rate List</span>
        </div>`;
        return`<div style="padding:8px 12px;background:#f5f5f5;border:1px solid #D9D9D9;border-radius:8px;font-size:12px;color:#555">
          Rate not found in Printing Rate List ⚠️ — Enter manually for now.
        </div>`;
      })()}</div>
      <div class="field"><label>Complexity Tier *</label>
        <select id="rc-tier" onchange="window._rcMarkOverride()">${[1,2,3,4].map(t=>`<option value="${t}" ${(pt.complexityTier||1)==t?'selected':''}>${TIER_INFO[t].label} — ${TIER_INFO[t].desc}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Rate per Piece (Rs.) *</label><input id="rc-rate" type="number" min="0" step="0.5" placeholder="0.00" value="${pt.ratePerPiece||''}" oninput="window._rcMarkOverride()"></div>
      <div id="rc-override-row" style="grid-column:1/-1;display:${(()=>{const rm=_lookupRate(e.articleCode||'');return(rm&&(pt.ratePerPiece!==rm.ratePerPiece||pt.complexityTier!==rm.complexityTier))?'block':'none';})()}">
        <div style="padding:7px 12px;background:#f5f5f5;border:1px solid #D9D9D9;border-radius:8px;font-size:12px;color:#555;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span>Values differ from Rate List.</span>
          <button type="button" onclick="window._rcUseRateList()" style="font-size:12px;padding:3px 10px;border:1px solid #f97316;border-radius:6px;background:none;color:#ea580c;cursor:pointer">Use Rate List Values</button>
          <span style="margin-left:auto">Override reason: <input id="rc-override-note" placeholder="optional…" style="font-size:12px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;width:180px;outline:none" value="${pt.rateOverrideNote||''}"></span>
        </div>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Instructions (English)</label><textarea id="rc-instr-en" rows="3" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:100%;font-family:inherit;resize:vertical;outline:none">${pt.instructionsEn||''}</textarea></div>
      <div class="field" style="grid-column:1/-1"><label>ہدایات (اردو)</label><textarea id="rc-instr-ur" rows="3" dir="rtl" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:100%;font-family:inherit;resize:vertical;outline:none;text-align:right">${pt.instructionsUr||''}</textarea></div>
    </div>
  </div>

  <div class="card"><div class="card-title">Placements</div>
    <div id="rc-placements">
      ${(pt.placements||[]).map((pl,i)=>placementRowHTML(i,pl)).join('')}
    </div>
    <button type="button" class="btn-outline" style="width:100%;margin-top:6px" onclick="window.addPlacementRow()">+ Add Placement</button>
  </div>

  <div class="card"><div class="card-title">Pantone / Ink Colors</div>
    <div id="rc-pantones">
      ${(pt.pantones||[]).map((p,i)=>pantoneRowHTML(i,p)).join('')}
    </div>
    <button type="button" class="btn-outline" style="width:100%;margin-top:6px" onclick="window.addPantoneRow()">+ Add Color</button>
  </div>

  <div class="card"><div class="card-title">Product Images</div>
    <div class="form-grid">
      <div class="field"><label>Front Image URL</label><input id="rc-img-front" placeholder="https://…" value="${imgs.frontUrl||''}"></div>
      <div class="field"><label>Back Image URL</label><input id="rc-img-back" placeholder="https://…" value="${imgs.backUrl||''}"></div>
      <div class="field" style="grid-column:1/-1"><label>Placement Guide URL</label><input id="rc-img-place" placeholder="https://…" value="${imgs.placementGuideUrl||''}"></div>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--muted)">Tip: upload images to Cloudinary or use direct links. Approved PP sample URL can be added after first approval.</div>
  </div>

  <div style="display:flex;gap:8px;margin-top:4px">
    <button class="btn-primary" style="flex:1" onclick="window.saveRecipe(false)">${editing?'Save Changes':'Save as Draft'}</button>
    ${canLockRecipe()?`<button class="btn-primary" style="flex:1;background:var(--green)" onclick="window.saveRecipe(true)">Save & Lock Recipe 🔒</button>`:''}
  </div>
  <div style="height:80px"></div>`;
}

let _plIdx=0,_ptIdx=0;
function placementRowHTML(i,pl={}){
  _plIdx=Math.max(_plIdx,i+1);
  const tplId=pl.placementTemplateId||'custom';
  const tpl=PLACEMENT_TEMPLATES.find(t=>t.id===tplId)||PLACEMENT_TEMPLATES[PLACEMENT_TEMPLATES.length-1];
  const measText=pl.measurementText||(pl.measurementDescriptionEn?pl.measurementDescriptionEn+(pl.measurementValue?' ('+pl.measurementValue+(pl.measurementUnit?' '+pl.measurementUnit:'')+')'  :''):'');
  const mUnit=pl.measurementUnit||'inch';
  // Parse legacy tolerance: "±0.5 inch" → text="±0.5", unit="inch"
  const rawTol=pl.toleranceText||pl.toleranceValue||pl.tolerance||'';
  const tolMatch=rawTol.match(/^(.*?)\s*(inch|cm|mm)?\s*$/i);
  const tolText=tolMatch?tolMatch[1].trim():rawTol;
  const tolUnit=pl.toleranceUnit||(tolMatch&&tolMatch[2]?tolMatch[2].toLowerCase():'inch');
  const refImg=pl.production?.referenceImageUrl||pl.imageUrl||'';
  return`<div id="pl-row-${i}" class="placement-row">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-size:11px;font-weight:700;color:var(--muted)">PLACEMENT ${i+1}</span>
      <button type="button" onclick="document.getElementById('pl-row-${i}').remove()" style="background:none;border:none;color:#ccc;font-size:18px;cursor:pointer">×</button>
    </div>
    <div class="field">
      <label>Placement Template *</label>
      <select id="pl-${i}-tpl" onchange="window._onPlTplChange(${i})">
        ${PLACEMENT_TEMPLATES.map(t=>`<option value="${t.id}" ${tplId===t.id?'selected':''}>${t.nameEn} / ${t.nameUr}</option>`).join('')}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 130px;gap:10px;align-items:end;margin-top:8px">
      <div class="field" style="margin-bottom:0">
        <label>Measurement / Position</label>
        <input id="pl-${i}-mtext" placeholder="Add measurement here" value="${measText}" style="width:100%">
        <div style="font-size:11px;color:var(--muted);margin-top:3px">مثلاً HPS سے 3 انچ نیچے</div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Unit</label>
        <select id="pl-${i}-munit" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;width:100%">
          <option value="inch" ${mUnit==='inch'?'selected':''}>inch</option>
          <option value="cm" ${mUnit==='cm'?'selected':''}>cm</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 130px;gap:10px;align-items:end;margin-top:8px">
      <div class="field" style="margin-bottom:0">
        <label>Tolerance</label>
        <input id="pl-${i}-tol" placeholder="e.g. ±0.5" value="${tolText}" style="width:100%">
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Unit</label>
        <select id="pl-${i}-tolunit" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;width:100%">
          <option value="inch" ${tolUnit==='inch'?'selected':''}>inch</option>
          <option value="cm" ${tolUnit==='cm'?'selected':''}>cm</option>
        </select>
      </div>
    </div>
    <div class="field" style="margin-top:8px">
      <label>Placement Reference Image / پلیسمنٹ ریفرنس تصویر</label>
      <div id="pl-${i}-img-preview" style="${refImg?'':'display:none'}margin-bottom:8px;position:relative">
        <img id="pl-${i}-img-thumb" src="${refImg}" style="width:100%;max-height:160px;object-fit:contain;border-radius:8px;border:1px solid var(--border);background:#f9f9f9;cursor:zoom-in" onclick="this.src&&window.open(this.src)">
        <button type="button" onclick="window._plRemoveImg(${i})" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:14px;cursor:pointer;line-height:1">×</button>
      </div>
      <div id="pl-${i}-img-controls" style="${refImg?'display:none':''}">
        <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:2px dashed var(--border);border-radius:10px;cursor:pointer;background:#fafafa;margin-bottom:6px">
          <span style="font-size:18px">🖼️</span>
          <span style="font-size:13px;color:var(--muted)">Upload image<br><span style="font-size:11px">Click to choose file from computer</span></span>
          <input type="file" id="pl-${i}-img-file" accept="image/*" style="display:none" onchange="window._plUploadImg(${i},this)">
        </label>
        <input id="pl-${i}-img-url" type="url" placeholder="or paste image URL…" value="${refImg}" style="font-size:12px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;outline:none;width:100%" oninput="window._plUrlPreview(${i},this.value)">
      </div>
      <div id="pl-${i}-img-uploading" style="display:none;font-size:12px;color:var(--muted);padding:6px 0">Uploading…</div>
      <input type="hidden" id="pl-${i}-img" value="${refImg}">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
      <div class="field"><label>Worker Instruction (EN)</label><input id="pl-${i}-wk-en" placeholder="${tpl.workerEn||'e.g. Print on chest, measure from HPS'}" value="${pl.production?.visibleInstructionEn||pl.notesEn||''}"></div>
      <div class="field"><label>ہدایت (اردو)</label><input id="pl-${i}-wk-ur" dir="rtl" style="text-align:right" placeholder="${tpl.workerUr||'مثلاً چیسٹ پر پرنٹ کریں'}" value="${pl.production?.visibleInstructionUr||pl.notesUr||''}"></div>
    </div>
    <details style="margin-top:4px">
      <summary style="font-size:11px;font-weight:600;color:var(--muted);cursor:pointer;padding:6px 0">Technical Setup ▾</summary>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <div class="field"><label>Artwork Size</label><input id="pl-${i}-asize" placeholder="e.g. 25cm × 30cm" value="${pl.technical?.artworkSize||pl.artworkSize||''}"></div>
        <div class="field"><label>Artwork File URL</label><input id="pl-${i}-afile" placeholder="https://…" value="${pl.technical?.artworkFileUrl||''}"></div>
        <div class="field" style="grid-column:1/-1"><label>Print Dimension Notes</label><input id="pl-${i}-pdnotes" placeholder="Any technical print dimension notes…" value="${pl.technical?.printDimensionNotes||''}"></div>
      </div>
    </details>
  </div>`;
}
window._plUploadImg=async function(i,input){
  const file=input?.files?.[0];
  if(!file)return;
  const upEl=document.getElementById('pl-'+i+'-img-uploading');
  const ctrlEl=document.getElementById('pl-'+i+'-img-controls');
  const prevEl=document.getElementById('pl-'+i+'-img-preview');
  const thumbEl=document.getElementById('pl-'+i+'-img-thumb');
  const hidEl=document.getElementById('pl-'+i+'-img');
  if(upEl)upEl.style.display='block';
  if(ctrlEl)ctrlEl.style.display='none';
  try{
    const url=await uploadToCloudinary(file);
    if(hidEl)hidEl.value=url;
    if(thumbEl){thumbEl.src=url;}
    if(prevEl)prevEl.style.display='block';
    if(upEl)upEl.style.display='none';
  }catch(e){
    if(upEl)upEl.style.display='none';
    if(ctrlEl)ctrlEl.style.display='block';
    showToast('Image upload failed: '+e.message,true);
  }
};
window._plUrlPreview=function(i,url){
  const hidEl=document.getElementById('pl-'+i+'-img');
  if(hidEl)hidEl.value=url;
  if(!url)return;
  const thumbEl=document.getElementById('pl-'+i+'-img-thumb');
  const prevEl=document.getElementById('pl-'+i+'-img-preview');
  const ctrlEl=document.getElementById('pl-'+i+'-img-controls');
  if(thumbEl)thumbEl.src=url;
  if(prevEl)prevEl.style.display='block';
  if(ctrlEl)ctrlEl.style.display='none';
};
window._plRemoveImg=function(i){
  const hidEl=document.getElementById('pl-'+i+'-img');
  const prevEl=document.getElementById('pl-'+i+'-img-preview');
  const ctrlEl=document.getElementById('pl-'+i+'-img-controls');
  const urlEl=document.getElementById('pl-'+i+'-img-url');
  if(hidEl)hidEl.value='';
  if(urlEl)urlEl.value='';
  if(prevEl)prevEl.style.display='none';
  if(ctrlEl)ctrlEl.style.display='block';
};
window._onPlTplChange=function(i){
  const tplId=document.getElementById('pl-'+i+'-tpl')?.value;
  const tpl=PLACEMENT_TEMPLATES.find(t=>t.id===tplId);
  if(!tpl)return;
  const mtextEl=document.getElementById('pl-'+i+'-mtext');
  const wkEn=document.getElementById('pl-'+i+'-wk-en');
  const wkUr=document.getElementById('pl-'+i+'-wk-ur');
  const tolEl=document.getElementById('pl-'+i+'-tol');
  if(mtextEl&&!mtextEl.value)mtextEl.placeholder='Add measurement here';
  if(wkEn&&!wkEn.value)wkEn.placeholder=tpl.workerEn||'';
  if(wkUr&&!wkUr.value)wkUr.placeholder=tpl.workerUr||'';
  if(tolEl&&!tolEl.value)tolEl.placeholder=tpl.defaultTol||'±0.5 inch';
};
function pantoneRowHTML(i,p={}){
  _ptIdx=Math.max(_ptIdx,i+1);
  var isLegacy=!!(p.colorName&&!p.colorLibraryId);
  var linked=p.colorLibraryId?allColors.find(function(c){return c._id===p.colorLibraryId;}):null;
  var displayHex=(linked&&linked.hexApprox)||p.hexApprox||'#ddd';
  var USAGE_OPTIONS=['front graphic','back print','outline','fill','highlight','shadow','text','logo','background','other'];
  return'<div id="pt-row-'+i+'" style="background:#fafafa;border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px">'+
    '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">'+
      '<div id="pt-swatch-'+i+'" style="width:36px;height:36px;border-radius:8px;background:'+displayHex+';border:1px solid rgba(0,0,0,.12);flex-shrink:0;margin-top:4px"></div>'+
      '<div style="flex:1;min-width:0">'+
        (isLegacy?'<div style="font-size:10px;color:var(--amber);font-weight:600;margin-bottom:4px">Legacy color — not linked to Color Library</div>':'')+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
          '<input id="pt-search-'+i+'" type="text" placeholder="Search color by name or Pantone code…"'+
            ' value="'+(p.colorName||'')+'"'+
            ' style="flex:1;min-width:160px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none"'+
            ' oninput="window._ptSearch('+i+')"'+
            ' onfocus="window._ptSearch('+i+')"'+
            ' autocomplete="off">'+
          '<button type="button" onclick="document.getElementById(\'pt-row-'+i+'\').remove()" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;padding:2px 4px;flex-shrink:0">×</button>'+
        '</div>'+
        '<div id="pt-dropdown-'+i+'" style="position:relative;z-index:100"></div>'+
        '<input type="hidden" id="pt-lib-id-'+i+'" value="'+(p.colorLibraryId||'')+'">'+
        '<input type="hidden" id="pt-hex-'+i+'" value="'+displayHex+'">'+
        '<input type="hidden" id="pt-pantone-'+i+'" value="'+(p.pantoneCode||(linked&&linked.pantoneCode)||'')+'">'+
        '<input type="hidden" id="pt-local-ink-'+i+'" value="'+(p.localInkName||(linked&&linked.localInkName)||'')+'">'+
        '<input type="hidden" id="pt-ink-type-'+i+'" value="'+(p.inkType||(linked&&linked.inkType)||'')+'">'+
      '</div>'+
    '</div>'+
    '<div style="margin-top:6px">'+
      '<div class="field" style="margin-bottom:0"><label style="font-size:11px">Article Notes</label>'+
        '<input id="pt-note-'+i+'" placeholder="e.g. Do not make too bright" value="'+(p.articleSpecificNotes||p.notes||'')+'" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none;width:100%">'+
      '</div>'+
    '</div>'+
    (canManageRecipes()&&!p.colorLibraryId?'<div style="margin-top:6px"><button type="button" onclick="window.openColorModal(null)" style="font-size:11px;color:var(--red);background:none;border:none;cursor:pointer;padding:0;text-decoration:underline">+ Add new color to library</button></div>':'')+
  '</div>';
}
window._ptSearch=function(i){
  var q=((document.getElementById('pt-search-'+i)||{}).value||'').toLowerCase().trim();
  var dd=document.getElementById('pt-dropdown-'+i);
  if(!dd)return;
  if(!q){dd.innerHTML='';return;}
  var matches=allColors.filter(function(c){
    return c.status!=='archived'&&(
      c.colorName.toLowerCase().includes(q)||
      (c.pantoneCode||'').toLowerCase().includes(q)||
      (c.localInkName||'').toLowerCase().includes(q)
    );
  }).slice(0,8);
  if(!matches.length){
    dd.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px 0">No matches. '+(canManageRecipes()?'<button type="button" onclick="window.openColorModal(null)" style="color:var(--red);background:none;border:none;cursor:pointer;font-size:12px;text-decoration:underline">Add to library</button>':'')+'</div>';
    return;
  }
  dd.innerHTML='<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);margin-top:4px;overflow:hidden">'+
    matches.map(function(c){
      return'<div onclick="window._ptSelectColor('+i+',\''+c._id+'\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-bottom:1px solid #f5f5f5" onmouseover="this.style.background=\'#f9f9f9\'" onmouseout="this.style.background=\'\'">'+
        '<div style="width:24px;height:24px;border-radius:5px;background:'+(c.hexApprox||'#ddd')+';border:1px solid rgba(0,0,0,.1);flex-shrink:0"></div>'+
        '<div><div style="font-size:13px;font-weight:600">'+c.colorName+'</div><div style="font-size:11px;color:var(--muted)">'+(c.pantoneCode||'')+(c.localInkName?' · '+c.localInkName:'')+'</div></div>'+
      '</div>';
    }).join('')+
  '</div>';
};
window._ptSelectColor=function(i,colorId){
  var c=allColors.find(function(x){return x._id===colorId;});
  if(!c)return;
  var s=document.getElementById('pt-search-'+i);if(s)s.value=c.colorName;
  var l=document.getElementById('pt-lib-id-'+i);if(l)l.value=c._id;
  var h=document.getElementById('pt-hex-'+i);if(h)h.value=c.hexApprox||'';
  var pt=document.getElementById('pt-pantone-'+i);if(pt)pt.value=c.pantoneCode||'';
  var li=document.getElementById('pt-local-ink-'+i);if(li)li.value=c.localInkName||'';
  var it=document.getElementById('pt-ink-type-'+i);if(it)it.value=c.inkType||'';
  var sw=document.getElementById('pt-swatch-'+i);if(sw)sw.style.background=c.hexApprox||'#ddd';
  var dd=document.getElementById('pt-dropdown-'+i);if(dd)dd.innerHTML='';
};
window.addPlacementRow=function(){ document.getElementById('rc-placements')?.insertAdjacentHTML('beforeend',placementRowHTML(_plIdx)); _plIdx++; };
window.addPantoneRow=function(){ document.getElementById('rc-pantones')?.insertAdjacentHTML('beforeend',pantoneRowHTML(_ptIdx)); _ptIdx++; };

function collectPlacements(){
  return Array.from(document.querySelectorAll('[id^="pl-row-"]')).map(row=>{
    const i=row.id.replace('pl-row-','');
    const tplId=document.getElementById('pl-'+i+'-tpl')?.value||'custom';
    const tpl=PLACEMENT_TEMPLATES.find(t=>t.id===tplId)||PLACEMENT_TEMPLATES.find(t=>t.id==='custom');
    const tolVal=(document.getElementById('pl-'+i+'-tol')?.value||'').trim();
    const tolUnit=document.getElementById('pl-'+i+'-tolunit')?.value||'inch';
    return{
      placementTemplateId:tplId,
      name:tpl?.nameEn||tplId,
      templateNameEn:tpl?.nameEn||'',
      templateNameUr:tpl?.nameUr||'',
      side:tpl?.side||'front',
      anchorType:tpl?.anchorType||'custom',
      measurementText:document.getElementById('pl-'+i+'-mtext')?.value||'',
      measurementUnit:document.getElementById('pl-'+i+'-munit')?.value||'inch',
      toleranceText:tolVal,
      toleranceUnit:tolUnit,
      toleranceValue:tolVal?(tolVal+' '+tolUnit):'',
      production:{
        referenceImageUrl:document.getElementById('pl-'+i+'-img')?.value||'',
        visibleInstructionEn:document.getElementById('pl-'+i+'-wk-en')?.value||(tpl?.workerEn||''),
        visibleInstructionUr:document.getElementById('pl-'+i+'-wk-ur')?.value||(tpl?.workerUr||'')
      },
      technical:{
        artworkSize:document.getElementById('pl-'+i+'-asize')?.value||'',
        artworkFileUrl:document.getElementById('pl-'+i+'-afile')?.value||'',
        printDimensionNotes:document.getElementById('pl-'+i+'-pdnotes')?.value||''
      }
    };
  }).filter(p=>p.placementTemplateId);
}
function collectPantones(){
  return Array.from(document.querySelectorAll('[id^="pt-row-"]')).map(function(row){
    var i=row.id.replace('pt-row-','');
    var colorName=((document.getElementById('pt-search-'+i)||{}).value||'').trim();
    var libId=(document.getElementById('pt-lib-id-'+i)||{}).value||'';
    var lib=libId?allColors.find(function(c){return c._id===libId;}):null;
    return{
      colorLibraryId:libId,
      colorName:colorName||(lib&&lib.colorName)||'',
      pantoneCode:(document.getElementById('pt-pantone-'+i)||{}).value||(lib&&lib.pantoneCode)||'',
      hexApprox:(document.getElementById('pt-hex-'+i)||{}).value||(lib&&lib.hexApprox)||'',
      localInkName:(document.getElementById('pt-local-ink-'+i)||{}).value||(lib&&lib.localInkName)||'',
      inkType:(document.getElementById('pt-ink-type-'+i)||{}).value||(lib&&lib.inkType)||'',
      usage:(document.getElementById('pt-usage-'+i)||{}).value||'',
      articleSpecificNotes:(document.getElementById('pt-note-'+i)||{}).value||'',
      visibleToWorker:true
    };
  }).filter(function(p){return p.colorName;});
}

window._rcLookupRate=function(rawCode){
  const code=(rawCode||'').trim().toUpperCase();
  const rm=_lookupRate(code);
  const statusEl=document.getElementById('rc-rate-status');
  const overEl=document.getElementById('rc-override-row');
  const tierEl=document.getElementById('rc-tier');
  const rateEl=document.getElementById('rc-rate');
  if(!code){if(statusEl)statusEl.innerHTML='';return;}
  if(rm){
    if(statusEl)statusEl.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px">'+
      '<span style="color:var(--green);font-weight:700">Rate found from Printing Rate List ✅</span>'+
      '<span style="color:var(--muted)">Rs. '+rm.ratePerPiece+'/pc · Tier '+rm.complexityTier+'</span>'+
      '<span style="color:var(--muted);margin-left:auto">Source: Current Quarter Rate List</span>'+
      '</div>';
    // Auto-fill if fields are empty or match current rate list values
    const curTier=parseInt(tierEl?.value)||1;
    const curRate=parseFloat(rateEl?.value)||0;
    if(!curRate||curRate===rm.ratePerPiece){if(rateEl)rateEl.value=rm.ratePerPiece;}
    if(curTier===1||curTier===rm.complexityTier){if(tierEl)tierEl.value=rm.complexityTier;}
    window._rcCheckOverride();
  }else{
    if(statusEl)statusEl.innerHTML='<div style="padding:8px 12px;background:#f5f5f5;border:1px solid #D9D9D9;border-radius:8px;font-size:12px;color:#555">Rate not found in Printing Rate List ⚠️ — Enter manually for now.</div>';
    if(overEl)overEl.style.display='none';
  }
};
window._rcCheckOverride=function(){
  const code=(document.getElementById('rc-code')?.value||'').trim().toUpperCase();
  const rm=_lookupRate(code);
  const overEl=document.getElementById('rc-override-row');
  if(!rm||!overEl)return;
  const curTier=parseInt(document.getElementById('rc-tier')?.value)||1;
  const curRate=parseFloat(document.getElementById('rc-rate')?.value)||0;
  const differs=(curRate&&curRate!==rm.ratePerPiece)||(curTier!==rm.complexityTier);
  overEl.style.display=differs?'block':'none';
};
window._rcMarkOverride=function(){window._rcCheckOverride();};
window._rcUseRateList=function(){
  const code=(document.getElementById('rc-code')?.value||'').trim().toUpperCase();
  const rm=_lookupRate(code);
  if(!rm)return;
  const tierEl=document.getElementById('rc-tier');
  const rateEl=document.getElementById('rc-rate');
  if(tierEl)tierEl.value=rm.complexityTier;
  if(rateEl)rateEl.value=rm.ratePerPiece;
  const overEl=document.getElementById('rc-override-row');
  if(overEl)overEl.style.display='none';
};
window.saveRecipe=async function(lock=false){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  const code=(document.getElementById('rc-code')?.value||'').trim().toUpperCase();
  const name=(document.getElementById('rc-name')?.value||'').trim();
  if(!code||!name){showToast('Article code and name required.',true);return;}
  const processTypes=Object.keys(PROCESS_TYPES).filter(k=>document.getElementById('rc-pt-'+k)?.checked);
  const tier=parseInt(document.getElementById('rc-tier')?.value)||1;
  const rate=parseFloat(document.getElementById('rc-rate')?.value)||0;
  if(lock&&session.u!=='ammar'){showToast('Only Ammar can lock a recipe.',true);return;}
  if(lock&&(!rate||!processTypes.length)){showToast('Rate and process type required before locking.',true);return;}
  const editing=viewingRecipe?allRecipes.find(r=>r._id===viewingRecipe):null;
  const now=nowIso();
  const payload={
    articleCode:code, articleName:name,
    brand:document.getElementById('rc-brand')?.value.trim()||'',
    category:document.getElementById('rc-cat')?.value||'',
    status:lock?'locked':(editing?.status||'draft'),
    version:(editing?.version||0)+1,
    recipeOwner:'ammar',
    lockedBy:lock?session.name:editing?.lockedBy||null,
    lockedAt:lock?(editing?.lockedAt||now):editing?.lockedAt||null,
    createdBy:editing?.createdBy||session.name,
    createdAt:editing?.createdAt||now,
    updatedAt:now,
    images:{
      frontUrl:document.getElementById('rc-img-front')?.value.trim()||'',
      backUrl:document.getElementById('rc-img-back')?.value.trim()||'',
      placementGuideUrl:document.getElementById('rc-img-place')?.value.trim()||'',
      approvedPpSampleUrl:editing?.images?.approvedPpSampleUrl||'',
      closeupUrls:editing?.images?.closeupUrls||[]
    },
    printing:(()=>{
      const rm=_lookupRate(code);
      const overrideNote=(document.getElementById('rc-override-note')?.value||'').trim();
      let rateSource='manual', rateMasterMatched=false, rateOverrideNote='';
      if(rm){
        rateMasterMatched=true;
        const differs=(rate&&rate!==rm.ratePerPiece)||(tier!==rm.complexityTier);
        rateSource=differs?'override':'printing_rate_list';
        if(differs&&overrideNote)rateOverrideNote=overrideNote;
      }
      return{
        required:processTypes.length>0,
        processTypes, complexityTier:tier, ratePerPiece:rate,
        rateSource, rateMasterMatched, rateOverrideNote,
        rateEffectiveQuarter:'Q2-2025',
        vendorName:rm?.vendor||editing?.printing?.vendorName||'',
        placements:collectPlacements(),
        pantones:collectPantones(),
        instructionsEn:document.getElementById('rc-instr-en')?.value.trim()||'',
        instructionsUr:document.getElementById('rc-instr-ur')?.value.trim()||''
      };
    })(),
    trimsStore:{enabled:false,requiredItems:[]},
    threadLogic:{enabled:false,items:[]},
    labelsLogic:{enabled:false,items:[]},
    rawMaterialLogic:{enabled:false,fabricType:'',consumption:'',notes:''},
    qcSuggestions:editing?.qcSuggestions||[],
    changeHistory:[...(editing?.changeHistory||[]),{by:session.name,at:now,action:lock?'locked':'saved',note:''}]
  };
  try{
    const id=editing?editing._id:prntId();
    await setDoc(doc(db,'article_recipes',id),payload);
    await logActivity(lock?'Recipe locked':'Recipe saved',`${code} — ${name}`);
    if(editing){ const i=allRecipes.findIndex(r=>r._id===id); if(i>=0)allRecipes[i]={...payload,_id:id}; else allRecipes.unshift({...payload,_id:id}); }
    else{ allRecipes.unshift({...payload,_id:id}); }
    showToast(lock?'Recipe locked ✓':'Recipe saved ✓');
    viewingRecipe=null; _plIdx=0; _ptIdx=0;
    window.showPage('recipe-directory');
  }catch(e){ showToast('Save error: '+e.message,true); }
};

// ── Recipe Detail View ────────────────────────────────────────────────
function _recPlacementHTML(pl,idx){
  const tpl=PLACEMENT_TEMPLATES.find(t=>t.id===(pl.placementTemplateId||'custom'))||PLACEMENT_TEMPLATES.find(t=>t.id==='custom');
  const plName=pl.templateNameEn||pl.name||tpl?.nameEn||pl.placementTemplateId||'—';
  const plNameUr=pl.templateNameUr||tpl?.nameUr||'';
  const meas=pl.measurementText||(pl.measurementDescriptionEn||'')+(pl.measurementValue?' · '+pl.measurementValue+(pl.measurementUnit?' '+pl.measurementUnit:''):'');
  const mUnit=pl.measurementUnit||'';
  // Tolerance: prefer toleranceText+toleranceUnit, fall back to toleranceValue/tolerance string
  const tolText=pl.toleranceText||'';
  const tolUnit=pl.toleranceUnit||'';
  const tol=tolText?(tolText+(tolUnit?' '+tolUnit:'')):(pl.toleranceValue||pl.tolerance||'—');
  const refImg=pl.production?.referenceImageUrl||pl.imageUrl||'';
  const instrEn=pl.production?.visibleInstructionEn||pl.notesEn||'';
  const instrUr=pl.production?.visibleInstructionUr||pl.notesUr||'';
  const techArtSize=pl.technical?.artworkSize||pl.artworkSize||'';
  const techAFile=pl.technical?.artworkFileUrl||'';
  const techPDNotes=pl.technical?.printDimensionNotes||'';
  const imgBlock=refImg
    ?`<img src="${refImg}" onclick="window.open('${refImg}')" style="width:100%;border-radius:8px;max-height:180px;object-fit:contain;margin-top:8px;background:#f9f9f9;border:1px solid var(--border);cursor:zoom-in">`
    :`<div style="font-size:12px;color:var(--muted);margin-top:6px;padding:10px;background:#f9f9f9;border-radius:8px;text-align:center">No placement image uploaded / پلیسمنٹ تصویر موجود نہیں</div>`;
  const wrap=c=>`<div class="placement-row" style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #f0f0f0">${c}</div>`;
  const header=`<div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px">PLACEMENT ${idx+1}</div>
    <div class="info-row"><span class="info-label">Placement</span><span style="font-weight:600">${plName}${plNameUr?' / '+plNameUr:''}</span></div>`;
  const techCollapsible=techArtSize?`<details style="margin-top:6px"><summary style="font-size:11px;color:var(--muted);cursor:pointer">Technical Details</summary><div class="info-row" style="margin-top:4px"><span class="info-label">Artwork Size</span><span>${techArtSize}</span></div></details>`:'';
  if(isPrintWorker()){
    return wrap(`${header}
      ${meas?`<div class="info-row"><span class="info-label">Measurement</span><span>${meas}${mUnit?' ('+mUnit+')':''}</span></div>`:''}
      ${instrEn?`<div style="background:#f7f7f9;padding:8px 10px;border-radius:8px;font-size:13px;margin-top:4px"><strong>Instruction:</strong> ${instrEn}</div>`:''}
      ${instrUr?`<div style="background:#fffbeb;padding:8px 10px;border-radius:8px;font-size:14px;direction:rtl;text-align:right;margin-top:4px">${instrUr}</div>`:''}
      ${imgBlock}
      ${techCollapsible}`);
  }
  if(isQCWorker()){
    return wrap(`${header}
      ${meas?`<div class="info-row"><span class="info-label">Measurement</span><span>${meas}${mUnit?' ('+mUnit+')':''}</span></div>`:''}
      <div class="info-row"><span class="info-label">Tolerance</span><span style="font-weight:700;color:var(--red)">${tol}</span></div>
      ${imgBlock}
      ${techCollapsible}`);
  }
  return wrap(`${header}
    ${meas?`<div class="info-row"><span class="info-label">Measurement</span><span>${meas}${mUnit?' ('+mUnit+')':''}</span></div>`:''}
    <div class="info-row"><span class="info-label">Tolerance</span><span>${tol}</span></div>
    ${instrEn?`<div class="info-row"><span class="info-label">Worker Instruction</span><span>${instrEn}</span></div>`:''}
    ${instrUr?`<div class="info-row"><span class="info-label">ہدایت</span><span dir="rtl">${instrUr}</span></div>`:''}
    ${imgBlock}
    ${techArtSize||techAFile||techPDNotes?`<details style="margin-top:8px"><summary style="font-size:11px;font-weight:700;color:var(--muted);cursor:pointer;padding:4px 0">Technical Setup ▾</summary>
      <div style="margin-top:6px">
        ${techArtSize?`<div class="info-row"><span class="info-label">Artwork Size</span><span style="font-weight:600">${techArtSize}</span></div>`:''}
        ${techAFile?`<div class="info-row"><span class="info-label">Artwork File</span><span style="word-break:break-all;font-size:11px">${techAFile}</span></div>`:''}
        ${techPDNotes?`<div class="info-row"><span class="info-label">Print Dim Notes</span><span>${techPDNotes}</span></div>`:''}
      </div>
    </details>`:''}`);
}
function renderRecipeDetailPage(){
  const m=document.getElementById('main-content');
  const r=allRecipes.find(x=>x._id===viewingRecipe);
  if(!r){window.showPage('recipe-directory');return;}
  const pt=r.printing||{};
  const imgs=r.images||{};
  const roView=isPrintWorker();
  const canEdit=canManageRecipes()&&r.status!=='locked'&&!roView;
  const canUnlock=session.u==='ammar'&&r.status==='locked'&&!roView;
  const isLocked=r.status==='locked';

  // QC Suggestion form (for QC worker)
  const qcSugForm=isQCWorker()&&r.status!=='archived'&&!roView?`
    <div class="card"><div class="card-title">Submit QC Suggestion</div>
      <div class="field" style="margin-bottom:8px"><textarea id="qc-sug-text" rows="3" placeholder="Describe the recipe change or quality observation…" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;outline:none"></textarea></div>
      <button class="btn-outline" onclick="window.submitQCSuggestion('${r._id}')">Submit Suggestion</button>
    </div>`:'';

  m.innerHTML=`<button class="back-btn" onclick="window.showPage('recipe-directory')">← Back to Recipe Directory</button>
  <div class="page-head">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700;color:var(--red)">${r.articleCode||'—'}</span>
          ${recipeBadgeHTML(r.status||'draft')}
          ${tierBadge(pt.complexityTier||1)}
        </div>
        <div class="page-title" style="margin-top:4px">${r.articleName||'Untitled'}</div>
        <div class="page-sub">v${r.version||1} · By ${r.createdBy||'—'} · Updated ${tsLabel2(r.updatedAt)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${canEdit?`<button class="btn-outline" onclick="window.editRecipe('${r._id}')">Edit Recipe</button>`:''}
        ${canUnlock?`<button class="btn-outline" onclick="window.unlockRecipe('${r._id}')">🔓 Unlock</button>`:''}
        ${canManageRecipes()&&r.status==='draft'&&session.u==='ammar'&&!roView?`<button class="btn-primary" style="width:auto;padding:8px 16px;background:var(--green)" onclick="window.lockRecipe('${r._id}')">Lock Recipe 🔒</button>`:''}
        ${isObserver()&&!roView?`<button class="btn-outline" onclick="window.archiveRecipe('${r._id}')">Archive</button>`:''}
        ${session.u==='ammar'&&!roView?`<button class="btn-outline" style="color:#dc2626;border-color:#dc2626" onclick="window.deleteRecipe('${r._id}')">Delete</button>`:''}
      </div>
    </div>
  </div>

  ${isLocked?`<div class="alert-banner alert-green">🔒 This recipe is locked. Only Ammar can unlock or edit it.</div>`:''}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
    ${imgs.frontUrl||imgs.backUrl?`<div class="card" style="margin-bottom:0"><div class="card-title">Product Images</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${imgs.frontUrl?`<div><div style="font-size:10px;color:var(--muted);margin-bottom:4px;font-weight:600">FRONT</div><img src="${imgs.frontUrl}" style="width:100%;border-radius:8px;max-height:200px;object-fit:cover"></div>`:''}
        ${imgs.backUrl?`<div><div style="font-size:10px;color:var(--muted);margin-bottom:4px;font-weight:600">BACK</div><img src="${imgs.backUrl}" style="width:100%;border-radius:8px;max-height:200px;object-fit:cover"></div>`:''}
      </div>
      ${imgs.approvedPpSampleUrl?`<div style="margin-top:8px"><div style="font-size:10px;color:var(--green);font-weight:600;margin-bottom:4px">✓ APPROVED PP SAMPLE</div><img src="${imgs.approvedPpSampleUrl}" style="width:100%;border-radius:8px;max-height:140px;object-fit:cover"></div>`:''}
    </div>`:''}
    <div class="card" style="margin-bottom:0"><div class="card-title">Printing Details</div>
      <div class="info-row"><span class="info-label">Process</span><span>${(pt.processTypes||[]).map(p=>processBadge(p)).join(' ')||'—'}</span></div>
      <div class="info-row"><span class="info-label">Tier</span><span>${tierBadge(pt.complexityTier||1)}</span></div>
      <div class="info-row"><span class="info-label">Rate</span><span style="font-weight:700;color:var(--dark)">${pt.ratePerPiece?'Rs. '+pt.ratePerPiece+'/pc':'Not set'}</span></div>
      <div class="info-row"><span class="info-label">Rate Source</span><span style="font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600;background:#f0f0f0;color:#111">${pt.rateSource==='printing_rate_list'?'Rate List ✅':pt.rateSource==='override'?'Override ⚠️':'Manual'}</span>${pt.rateOverrideNote?`<span style="font-size:11px;color:var(--muted);margin-left:6px">${pt.rateOverrideNote}</span>`:''}</div>
      <div class="info-row"><span class="info-label">Placements</span><span>${(pt.placements||[]).length}</span></div>
      <div class="info-row"><span class="info-label">Pantones</span><span>${(pt.pantones||[]).length}</span></div>
    </div>
  </div>

  ${(pt.placements||[]).length?`<div class="card"><div class="card-title">Placements (${pt.placements.length})</div>
    ${pt.placements.map((pl,i)=>_recPlacementHTML(pl,i)).join('')}
  </div>`:''}

  ${(pt.pantones||[]).length?`<div class="card">
    <div class="card-title">Colors / Ink (${pt.pantones.length})</div>
    ${pt.pantones.map(p=>_ptDetailChipHTML(p)).join('')}
  </div>`:''}

  ${(r.draftPlacements||[]).length?`<div class="card"><div class="card-title">Placements (${r.draftPlacements.length})</div>
    ${r.draftPlacements.map((p,i)=>`<div style="padding:10px 0;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
        <span style="font-size:11px;font-weight:700;color:var(--muted)">${i+1}.</span>
        <span style="font-weight:600;font-size:14px">${_rdEsc(p.placementType)||'—'}</span>
        ${p.technique?`<span style="font-size:11px;background:#f0f0f0;padding:2px 8px;border-radius:10px">${_rdEsc(p.technique)}</span>`:''}
      </div>
      ${p.positionSize?`<div style="font-size:13px;color:#1A1A2E;margin-bottom:3px"><span style="color:var(--muted);font-size:11px">Position &amp; Size:</span> ${_rdEsc(p.positionSize)}</div>`:''}
      ${p.notes?`<div style="font-size:12px;color:var(--muted);margin-bottom:4px">${_rdEsc(p.notes)}</div>`:''}
      ${(p.pantones||[]).length?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${p.pantones.map(pn=>`<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;background:#f7f7f9;border:1px solid #eee;border-radius:14px;font-size:12px">
        <span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${pn.hexApprox||'#ccc'};border:1px solid #ddd"></span>
        ${_rdEsc(pn.colorName)||'—'}${pn.pantoneCode?' · '+_rdEsc(pn.pantoneCode):''}
      </span>`).join('')}</div>`:''}
    </div>`).join('')}
  </div>`:''}

  ${r.recipeNotes?`<div class="card"><div class="card-title">Recipe Notes</div><div style="font-size:13px;line-height:1.7">${_rdEsc(r.recipeNotes)}</div></div>`:''}

  ${pt.instructionsEn||pt.instructionsUr?`<div class="card"><div class="card-title">Instructions / ہدایات</div>
    ${pt.instructionsEn?`<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:4px">ENGLISH</div><div style="font-size:13px;line-height:1.7">${pt.instructionsEn}</div></div>`:''}
    ${pt.instructionsUr?`<div><div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:4px">اردو</div><div style="font-size:14px;line-height:2;direction:rtl;text-align:right">${pt.instructionsUr}</div></div>`:''}
  </div>`:''}

  ${(r.qcSuggestions||[]).length?`<div class="card"><div class="card-title">QC Suggestions (${r.qcSuggestions.length})</div>
    ${r.qcSuggestions.map(s=>`<div style="padding:8px 0;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1"><div style="font-size:12px;font-weight:600">${s.by||'—'} <span style="color:var(--muted);font-weight:400">· ${tsLabel2(s.date)}</span></div>
          <div style="font-size:13px;margin-top:3px">${s.note||'—'}</div>
        </div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${s.status==='rejected'?'#111':'#f0f0f0'};color:${s.status==='rejected'?'#fff':'#111'}">${(s.status||'open').toUpperCase()}</span>
      </div>
      ${canManageRecipes()&&s.status==='open'&&!roView?`<div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn-sm" style="background:var(--green)" onclick="window.resolveQCSug('${r._id}','${s.suggestionId}','accepted')">Accept</button>
        <button class="btn-sm" style="background:#dc2626" onclick="window.resolveQCSug('${r._id}','${s.suggestionId}','rejected')">Reject</button>
      </div>`:''}
    </div>`).join('')}
  </div>`:''}

  ${qcSugForm}

  <div style="height:80px"></div>`;
}

window.editRecipe=function(id){ viewingRecipe=id; _plIdx=0; _ptIdx=0; window.showPage('recipe-create'); };
window.lockRecipe=async function(id){
  if(session.u!=='ammar'){showToast('Only Ammar can lock recipes.',true);return;}
  if(!confirm('Lock this recipe? Ammar will need to unlock it for future edits.'))return;
  try{
    await updateDoc(doc(db,'article_recipes',id),{status:'locked',lockedBy:session.name,lockedAt:nowIso(),updatedAt:nowIso()});
    const r=allRecipes.find(x=>x._id===id); if(r){r.status='locked';r.lockedBy=session.name;}
    await logActivity('Recipe locked',allRecipes.find(x=>x._id===id)?.articleCode||id);
    showToast('Recipe locked 🔒'); renderRecipeDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};
window.unlockRecipe=async function(id){
  if(session.u!=='ammar'){showToast('Only Ammar can unlock.',true);return;}
  if(!confirm('Unlock recipe for editing?'))return;
  try{
    await updateDoc(doc(db,'article_recipes',id),{status:'draft',updatedAt:nowIso()});
    const r=allRecipes.find(x=>x._id===id); if(r)r.status='draft';
    showToast('Recipe unlocked ✓'); renderRecipeDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};
window.archiveRecipe=async function(id){
  if(!isObserver()){showToast('Not authorized.',true);return;}
  if(!confirm('Archive this recipe?'))return;
  try{
    await updateDoc(doc(db,'article_recipes',id),{status:'archived',updatedAt:nowIso()});
    const r=allRecipes.find(x=>x._id===id); if(r)r.status='archived';
    showToast('Archived'); renderRecipeDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};
window.deleteRecipe=async function(id){
  if(session.u!=='ammar'){showToast('Only Ammar can delete recipes.',true);return;}
  const r=allRecipes.find(x=>x._id===id);
  if(!r)return;
  if(!confirm('Delete recipe "'+r.articleCode+' — '+r.articleName+'"?\n\nThis cannot be undone.'))return;
  if(!confirm('Are you sure? This permanently deletes the recipe from the database.'))return;
  try{
    await deleteDoc(doc(db,'article_recipes',id));
    allRecipes=allRecipes.filter(x=>x._id!==id);
    showToast('Recipe deleted.');
    window.showPage('recipe-directory');
  }catch(e){showToast('Error: '+e.message,true);}
};
window.submitQCSuggestion=async function(recipeId){
  if(!isQCWorker()){showToast('QC only.',true);return;}
  const note=(document.getElementById('qc-sug-text')?.value||'').trim();
  if(!note){showToast('Write a suggestion first.',true);return;}
  const sug={suggestionId:prntId(),by:session.name,date:nowIso(),note,status:'open',resolvedBy:null,resolvedAt:null};
  try{
    const r=allRecipes.find(x=>x._id===recipeId); if(!r)return;
    const updated=[...(r.qcSuggestions||[]),sug];
    await updateDoc(doc(db,'article_recipes',recipeId),{qcSuggestions:updated,updatedAt:nowIso()});
    r.qcSuggestions=updated;
    showToast('Suggestion submitted ✓'); renderRecipeDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};
// ════════════════════════════════════════════════════════════════════
// CHUNK 2 — PRINTING JOBS LIST · CREATE FROM PO · ASGHAR WORKER UI
//            PP SAMPLE FLOW · PP APPROVAL / REJECTION
// ════════════════════════════════════════════════════════════════════

window.resolveQCSug=async function(recipeId,sugId,status){
  if(!canManageRecipes()){showToast('Not authorized.',true);return;}
  try{
    const r=allRecipes.find(x=>x._id===recipeId); if(!r)return;
    const updated=(r.qcSuggestions||[]).map(s=>s.suggestionId===sugId?{...s,status,resolvedBy:session.name,resolvedAt:nowIso()}:s);
    await updateDoc(doc(db,'article_recipes',recipeId),{qcSuggestions:updated,updatedAt:nowIso()});
    r.qcSuggestions=updated;
    showToast('Suggestion '+status+' ✓'); renderRecipeDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};

// ════════════════════════════════════════════════════════════════════
// CHUNK 2 — PRINTING JOBS LIST · CREATE FROM PO · ASGHAR WORKER UI
//            PP SAMPLE FLOW · PP APPROVAL / REJECTION
// ════════════════════════════════════════════════════════════════════

// ── Printing Jobs Page ────────────────────────────────────────────────
function renderPrintingJobsPage(){
  if(!canSeePrinting())return'<div class="empty">Not authorized.</div>';

  // Worker view: Asghar only sees his assigned jobs
  if(isPrintWorker()){
    const myJobs=allPrintingJobs.filter(j=>j.assignedTo===session.u&&j.currentStage!=='closed');
    return`<div class="page-head"><div class="page-title">Printing Jobs / پرنٹنگ جاب</div><div class="page-sub">${myJobs.length} active job${myJobs.length!==1?'s':''} in your queue</div></div>
    ${myJobs.length?myJobs.map(j=>printWorkerCardHTML(j)).join(''):'<div class="empty">No printing jobs in your queue right now.</div>'}`;
  }

  // Zohaib: bundling view
  if(isBundleWorker()){
    const myJobs=allPrintingJobs.filter(j=>['qc_bundling'].includes(j.currentStage));
    return`<div class="page-head"><div class="page-title">QC Bundling Queue / بنڈلنگ قطار</div><div class="page-sub">${myJobs.length} lots to bundle</div></div>
    ${myJobs.map(j=>bundlingWorkerCardHTML(j)).join('')||'<div class="empty">No bundling tasks right now.</div>'}`;
  }

  // Waqas: stitching view
  if(isStitchWorker()){
    const myJobs=allPrintingJobs.filter(j=>['stitching'].includes(j.currentStage));
    return`<div class="page-head"><div class="page-title">Stitching Queue / سلائی قطار</div><div class="page-sub">${myJobs.length} lots to stitch</div></div>
    ${myJobs.map(j=>stitchingWorkerCardHTML(j)).join('')||'<div class="empty">No stitching tasks right now.</div>'}`;
  }

  // Manager / QC / Owner: full list
  const tabs=['active','awaiting_pp','printing','qc','done'];
  const tabLabels={active:'All Active',awaiting_pp:'Awaiting PP',printing:'Printing',qc:'At QC',done:'Closed'};
  const tabFilter={
    active:  j=>j.currentStage!=='closed',
    awaiting_pp: j=>j.currentStage==='pp_approval',
    printing:j=>j.currentStage==='bulk_printing',
    qc:      j=>['final_qc','rework','final_qc_post_stitch'].includes(j.currentStage),
    done:    j=>j.currentStage==='closed'
  };
  const current=_jobTab||'active';
  const list=(allPrintingJobs.filter(tabFilter[current]||tabFilter.active));

  return`<div class="page-head">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div><div class="page-title">Embellishment Jobs</div><div class="page-sub">${allPrintingJobs.length} total jobs</div></div>
      ${isObserver()?`<button class="btn-outline" style="font-size:11px;padding:6px 12px;color:var(--muted)" onclick="window.showCreateJobModal()">Admin: Link Missing Job</button>`:''}
    </div>
  </div>

  <div class="tab-bar">
    ${tabs.map(t=>`<button class="tab-btn ${current===t?'active':''}" onclick="window._setJobTab('${t}')">${tabLabels[t]}</button>`).join('')}
  </div>

  <div id="job-list-wrap">
    ${list.length?list.map(j=>jobListCardHTML(j)).join(''):'<div class="empty">No jobs in this filter.</div>'}
  </div>

  <div id="create-job-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500;overflow-y:auto;padding:2rem 1rem">
    ${renderCreateJobModal()}
  </div>`;
}
window._setJobTab=function(t){ _jobTab=t; document.getElementById('main-content').innerHTML=renderPrintingJobsPage(); };
window.showCreateJobModal=function(){
  const modal=document.getElementById('create-job-modal');
  if(modal){modal.style.display='block';}
};
window.closeJobModal=function(){
  const modal=document.getElementById('create-job-modal');
  if(modal)modal.style.display='none';
};

function renderCreateJobModal(){
  return`<div style="background:#fff;border-radius:16px;padding:1.5rem;width:100%;max-width:560px;margin:0 auto">
    <div style="font-size:17px;font-weight:700;margin-bottom:16px">Create Embellishment Job from PO</div>

    <div class="form-grid">
      <div class="field" style="grid-column:1/-1"><label>Job Type *</label>
        <select id="cj-job-type" onchange="window._cjOnJobTypeChange()">
          ${JOB_TYPE_KEYS.map(k=>`<option value="${k}">${JOB_TYPES[k].icon} ${JOB_TYPES[k].label}</option>`).join('')}
        </select>
        <div id="cj-job-type-hint" style="margin-top:4px;font-size:11px;color:var(--muted)">In-house rubber/screen/puff print. Pipeline: Awaiting PP → Printing → Final QC.</div>
      </div>
      <div class="field" style="grid-column:1/-1"><label>PO Number *</label>
        <input id="cj-po-num" placeholder="e.g. PO-041" list="cj-po-list">
        <datalist id="cj-po-list">${allPOs.filter(p=>p.currentStage!=='completed').map(p=>`<option value="${p.id}">${p.id} — ${p.name}</option>`).join('')}</datalist>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Article Code / Recipe</label>
        <input id="cj-article-code" placeholder="e.g. GP020" oninput="window._lookupRecipe(this.value)">
        <div id="cj-recipe-preview" style="margin-top:6px;font-size:12px;color:var(--muted)">Enter article code to auto-link recipe</div>
      </div>
      <div class="field" id="cj-process-wrap"><label>Process Type *</label>
        <select id="cj-process">${Object.entries(PROCESS_TYPES).map(([k,v])=>`<option value="${k}">${v.icon} ${v.label}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Priority *</label>
        <select id="cj-priority"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="flexible">Flexible</option></select>
      </div>
      <div class="field"><label>Total Qty *</label><input id="cj-qty" type="number" min="1" placeholder="500"></div>
      <div class="field"><label>Complexity Tier</label>
        <select id="cj-tier">${[1,2,3,4].map(t=>`<option value="${t}">Tier ${t} — ${TIER_INFO[t].label.split('—')[1].trim()}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Rate/Piece (Rs.)</label><input id="cj-rate" type="number" min="0" step="0.5" placeholder="auto from recipe"></div>
      <div class="field"><label>Assigned To</label>
        <select id="cj-assigned"><option value="asghar">Asghar Ali — Printing</option><option value="external">External Vendor</option></select>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Vendor Name (if external)</label><input id="cj-vendor" placeholder="Vendor name (leave blank for in-house)"></div>
      <div class="field" style="grid-column:1/-1"><label>Size Breakdown (XS:S:M:L:XL:2XL)</label><input id="cj-sizes" placeholder="auto from PO or enter: 0:50:100:100:50:0"></div>
      <div class="field" style="grid-column:1/-1"><label>Bundle Details</label><input id="cj-bundles" placeholder="e.g. 10 bundles, 50pcs each"></div>
    </div>

    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn-primary" onclick="window.createPrintingJob()">Create Job</button>
      <button class="btn-outline" onclick="window.closeJobModal()">Cancel</button>
    </div>
  </div>`;
}
window._cjOnJobTypeChange=function(){
  var jt=(document.getElementById('cj-job-type')||{}).value||'printing';
  var procWrap=document.getElementById('cj-process-wrap');
  var procSel=document.getElementById('cj-process');
  var hint=document.getElementById('cj-job-type-hint');
  var hints={
    printing:'In-house rubber/screen/puff print. Pipeline: Awaiting PP → Printing → Final QC.',
    embroidery:'Outsourced. Pipeline: Awaiting PP → Embroidery Job → Final QC. Print job sheet for vendor.',
    sublimation:'Outsourced. Pipeline: Sublimation Job → Final QC. No PP step (rectified during sampling).'
  };
  if(hint)hint.textContent=hints[jt]||'';
  if(jt==='embroidery'){
    if(procSel)procSel.value='embroidery';
    if(procWrap)procWrap.style.display='none';
  }else if(jt==='sublimation'){
    if(procSel)procSel.value='sublimation';
    if(procWrap)procWrap.style.display='none';
  }else{
    if(procWrap)procWrap.style.display='';
    if(procSel&&(procSel.value==='embroidery'||procSel.value==='sublimation'))procSel.value='rubber';
  }
};
window._lookupRecipe=function(code){
  const el=document.getElementById('cj-recipe-preview'); if(!el)return;
  const r=allRecipes.find(x=>x.articleCode&&x.articleCode.toLowerCase()===code.trim().toLowerCase());
  if(!r){el.innerHTML='<span style="color:var(--amber);font-weight:600">⚠ Recipe Missing — printing will be blocked until recipe is created/locked</span>';return;}
  const pt=r.printing||{};
  el.innerHTML=`<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px">
    <div style="font-weight:700;color:var(--green)">✓ Recipe found — ${r.status==='locked'?'🔒 Locked':'✏️ Draft'}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:4px">${(pt.processTypes||[]).map(p=>PROCESS_TYPES[p]?.label||p).join(', ')||'No process'} · Tier ${pt.complexityTier||1} · Rs.${pt.ratePerPiece||'—'}/pc</div>
  </div>`;
  if(pt.complexityTier){const s=document.getElementById('cj-tier');if(s)s.value=String(pt.complexityTier);}
  if(pt.ratePerPiece){const r2=document.getElementById('cj-rate');if(r2)r2.value=pt.ratePerPiece;}
  if(pt.processTypes?.length){const s=document.getElementById('cj-process');if(s)s.value=pt.processTypes[0];}
};

window.createPrintingJob=async function(){
  const poNum=(document.getElementById('cj-po-num')?.value||'').trim().toUpperCase();
  const articleCode=(document.getElementById('cj-article-code')?.value||'').trim().toUpperCase();
  const jobType=(document.getElementById('cj-job-type')?.value)||'printing';
  let processType=document.getElementById('cj-process')?.value||'rubber';
  if(jobType==='embroidery')processType='embroidery';
  if(jobType==='sublimation')processType='sublimation';
  const priority=document.getElementById('cj-priority')?.value||'normal';
  const qty=parseInt(document.getElementById('cj-qty')?.value)||0;
  if(!poNum||!qty){showToast('PO number and quantity required.',true);return;}

  const recipe=allRecipes.find(r=>r.articleCode&&r.articleCode.toLowerCase()===articleCode.toLowerCase());
  const tier=parseInt(document.getElementById('cj-tier')?.value)||recipe?.printing?.complexityTier||1;
  const rate=parseFloat(document.getElementById('cj-rate')?.value)||recipe?.printing?.ratePerPiece||0;
  const assignedTo=document.getElementById('cj-assigned')?.value||'asghar';
  const vendor=(document.getElementById('cj-vendor')?.value||'').trim();
  const dept=PROCESS_TYPES[processType]?.dept==='external'?('external_'+processType):'inhouse_printing';
  const sizesRaw=(document.getElementById('cj-sizes')?.value||'').trim();
  const sizeBreakdown=parseSizeBreakdown(sizesRaw);
  const now=nowIso();
  const ppMode=recipe?.status==='locked'?'repeat_article':'new_article';
  const skipPP=(JOB_TYPES[jobType]&&JOB_TYPES[jobType].hasPP===false);
  const initialStage=skipPP?'bulk_printing':'po_received';
  const initialNote=skipPP?'Job created (PP skipped — sublimation)':'Job created';

  const payload={
    poId:prntId(), poNumber:poNum, articleCode, articleName:recipe?.articleName||articleCode,
    recipeId:recipe?._id||null, jobType, processType, departmentType:dept, vendorName:vendor||null,
    totalQty:qty, sizeBreakdown, bundleDetails:document.getElementById('cj-bundles')?.value.trim()||'',
    complexityTier:tier, ratePerPiece:rate,
    priority, currentStage:initialStage, status:'active',
    assignedTo, qcIncharge:'haris',
    createdBy:session.name, createdAt:now, updatedAt:now,
    ppRequired:!skipPP, ppMode, ppAttempts:[], ppApprovalStatus:skipPP?'approved':'pending',
    ppApprovedBy:skipPP?session.name:null, ppApprovedAt:skipPP?now:null,
    bulkStartedAt:skipPP?now:null, bulkCompletedAt:null, finalQcStatus:null,
    recipeWarning:!recipe?'Recipe missing — PP blocked':recipe.status!=='locked'?'Recipe not locked yet':'',
    handoff:{forwardedToBundlingBy:null,forwardedToBundlingAt:null,acceptedByZohaibAt:null,forwardedToStitchingBy:null,forwardedToStitchingAt:null,acceptedByWaqasAt:null,stitchingForwardedToQcAt:null},
    stageHistory:[{stage:initialStage,by:session.name,at:now,note:initialNote}]
  };

  try{
    const id=prntId();
    await setDoc(doc(db,'printing_jobs',id),payload);
    allPrintingJobs.unshift({...payload,_id:id});
    // Create initial SLA event
    await addSLAEvent(id,poNum,'pp_sample',priority,'asghar',dueAt);
    await logActivity('Printing job created',`${poNum} — ${articleCode} (${PROCESS_TYPES[processType]?.label})`);
    showToast('Printing job created ✓');
    window.closeJobModal();
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

function parseSizeBreakdown(raw){
  if(!raw)return{XS:0,S:0,M:0,L:0,XL:0,'2XL':0};
  const parts=raw.split(':').map(v=>parseInt(v)||0);
  const keys=['XS','S','M','L','XL','2XL'];
  const out={};keys.forEach((k,i)=>out[k]=parts[i]||0);
  return out;
}

async function addSLAEvent(jobId,poNumber,stage,priority,assignedTo,dueAt){
  const now=nowIso();
  const ev={printingJobId:jobId,poId:poNumber,stage,priority,assignedTo,startAt:now,dueAt,completedAt:null,status:'on_time',missedByMinutes:0,reasonRequired:false,delayReasonText:'',voiceNoteUrl:'',monetaryWithholdSuggested:0,monetaryWithholdApproved:0,approvedBy:null,notes:'',createdAt:now};
  try{const id=prntId();await setDoc(doc(db,'sla_events',id),ev);allSLAEvents.unshift({...ev,_id:id});}catch(_){}
}

// ── Auto-create embellishment job from PO (triggered on cutting completion) ──
async function autoCreateEmbJob(po){
  if(!po.embellishment?.required)return;
  if(!printingDataLoaded)await loadPrintingData().catch(()=>{});
  // Avoid duplicates
  if(allPrintingJobs.find(j=>j.poNumber===po.id))return;
  // Find recipe
  const emb=po.embellishment;
  const recipe=emb.recipeId?allRecipes.find(r=>r._id===emb.recipeId):
    allRecipes.find(r=>(r.articleCode||'').toLowerCase()===(emb.articleCode||'').toLowerCase());
  const processType=emb.processType||(recipe?.printing?.processTypes||[])[0]||'rubber';
  const dept=PROCESS_TYPES[processType]?.dept==='external'?('external_'+processType):'inhouse_printing';
  const priority='normal';
  const now=nowIso();
  const id=prntId();
  const jobPayload={
    poId:id,poNumber:po.id,
    articleCode:emb.articleCode||po.code,
    articleName:emb.articleName||po.name,
    recipeId:recipe?._id||emb.recipeId||null,
    processType,departmentType:dept,vendorName:null,
    totalQty:po.qty||0,sizeBreakdown:po.sizes||{},bundleDetails:'',
    complexityTier:recipe?.printing?.complexityTier||emb.complexityTier||1,
    ratePerPiece:recipe?.printing?.ratePerPiece||emb.ratePerPiece||0,
    priority,currentStage:'po_received',status:'active',
    assignedTo:'asghar',qcIncharge:'haris',
    createdBy:'System (auto-PO)',createdAt:now,updatedAt:now,
    ppRequired:true,ppMode:recipe?.status==='locked'?'repeat_article':'new_article',
    ppAttempts:[],ppApprovalStatus:'pending',
    ppApprovedBy:null,ppApprovedAt:null,
    bulkStartedAt:null,bulkCompletedAt:null,finalQcStatus:null,
    recipeWarning:!recipe?'Recipe missing — PP blocked':recipe.status!=='locked'?'Recipe not locked yet':'',
    handoff:{forwardedToBundlingBy:null,forwardedToBundlingAt:null,acceptedByZohaibAt:null,forwardedToStitchingBy:null,forwardedToStitchingAt:null,acceptedByWaqasAt:null,stitchingForwardedToQcAt:null},
    stageHistory:[{stage:'po_received',by:'System',at:now,note:`Auto-created when PO ${po.id} cutting completed`}]
  };
  try{
    await setDoc(doc(db,'printing_jobs',id),jobPayload);
    allPrintingJobs.unshift({...jobPayload,_id:id});
    await addSLAEvent(id,po.id,'pp_sample',priority,'asghar',calcDue('pp_sample',priority));
    await logActivity('Embellishment job created',`${po.id} — ${jobPayload.articleCode} (auto from PO)`);
  }catch(e){console.warn('autoCreateEmbJob failed:',e);}
}

// ── Job list card (manager/QC view) ──────────────────────────────────
function jobListCardHTML(j){
  const sl=slaStatus(j.slaCurrentDue||null);
  const recipe=allRecipes.find(r=>r._id===j.recipeId);
  const jt=inferJobType(j);
  const isOutsourced=(jt==='embroidery'||jt==='sublimation');
  return`<div class="job-card sla-${sl}" onclick="window.openPrintingJob('${j._id}')">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="width:48px;height:60px;flex-shrink:0;background:#f0f0f0;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center">
        ${recipe?.images?.frontUrl?`<img src="${recipe.images.frontUrl}" style="width:100%;height:100%;object-fit:cover">`:'<span style="font-size:9px;color:#ccc;text-align:center;padding:2px">No img</span>'}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px">
          <span style="font-size:11px;font-weight:700;color:var(--red)">${j.poNumber||'—'}</span>
          <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;background:${PRIORITY_COLORS[j.priority]+'20'};color:${PRIORITY_COLORS[j.priority]}">${(j.priority||'normal').toUpperCase()}</span>
          ${tierBadge(j.complexityTier||1)}
          <span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:8px;background:#f0f0f0;color:var(--dark)">${JOB_TYPES[jt].icon} ${jt}</span>
        </div>
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">${j.articleCode||'—'} — ${j.articleName||'—'}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${processBadge(j.processType)} · ${j.totalQty||'?'} pcs · ${j.assignedTo||'—'}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">
          <span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;background:#f0f0f0;color:var(--dark)">${JOB_STAGE_LABELS[j.currentStage]||j.currentStage}</span>
          ${j.slaCurrentDue?`<span class="sla-chip ${slaChipClass(sl)}">${remainLabel(j.slaCurrentDue)}</span>`:'<span style="font-size:11px;color:var(--muted)">No SLA</span>'}
        </div>
        ${j.recipeWarning?`<div style="font-size:10px;color:var(--amber);margin-top:4px;font-weight:600">⚠ ${j.recipeWarning}</div>`:''}
        ${j.ppApprovalStatus==='rejected'?`<div style="font-size:10px;color:#dc2626;margin-top:3px;font-weight:700">✗ PP Rejected — new sample required</div>`:''}
        ${isOutsourced?`<button class="btn-outline" style="width:auto;padding:5px 10px;font-size:11px;margin-top:6px" onclick="event.stopPropagation();window.generateJobSheetPDF('${j._id}')">📄 Print Job Sheet</button>`:''}
      </div>
    </div>
  </div>`;
}
window.openPrintingJob=function(id){ viewingPrintJob=id; currentPage='printing-job-detail'; document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('on')); document.getElementById('nav-printing-jobs')?.classList.add('on'); renderPrintingJobDetailPage(); };

// ── Asghar worker card (simple bilingual view) ────────────────────────
function printWorkerCardHTML(j){
  const recipe=allRecipes.find(r=>r._id===j.recipeId);
  const stage=j.currentStage;
  const ppStatus=j.ppApprovalStatus;
  const sl=slaStatus(j.slaCurrentDue||null);
  const hasRecipe=!!recipe;
  const recipeLocked=recipe?.status==='locked';
  const canPPSample=(stage==='po_received')||(!hasRecipe&&false);
  const ppRejected=ppStatus==='rejected'&&stage==='pp_sample';
  const awaitingApproval=stage==='pp_approval'&&ppStatus==='pending';
  const canStartBulk=stage==='pp_approval'&&ppStatus==='approved';
  const alreadyPrinting=stage==='bulk_printing';

  // ── SLA block ──
  const slaColors={ok:'#EFEFEF',near:'#f0f0f0',over:'#fee2e2',critical:'#fecaca'};
  const slaText={ok:'var(--green)',near:'var(--amber)',over:'#dc2626',critical:'#7f1d1d'};
  const slaBg=slaColors[sl]||'#f4f4f6';
  const slaFg=slaText[sl]||'var(--muted)';
  const slaBlock=j.slaCurrentDue?`
    <div style="background:${slaBg};border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:11px;font-weight:700;color:${slaFg};text-transform:uppercase;letter-spacing:.06em">وقت / Time Remaining</div>
        <div style="font-size:20px;font-weight:800;color:${slaFg};margin-top:2px">${remainLabel(j.slaCurrentDue)}</div>
      </div>
      <div style="text-align:right;font-size:11px;color:${slaFg};font-weight:600">${sl==='ok'?'On Time / وقت پر':sl==='near'?'Near Due / وقت قریب ہے':sl==='over'?'OVERDUE / لیٹ':'CRITICAL / فوری'}</div>
    </div>`:'';

  // ── Current Step hero block ──
  const stepInstructions={
    po_received:{
      en:'Make PP Sample First',ur:'پہلے پی پی سیمپل بنائیں',
      steps:['Check front placement / فرنٹ پلیسمنٹ چیک کریں','Check back placement / بیک پلیسمنٹ چیک کریں','Match all colors / تمام کلر میچ کریں','Print one PP sample piece / ایک پی پی سیمپل پیس پرنٹ کریں','Send physical sample to Haris (QC) / پی پی سیمپل حارث کو دیں']
    },
    pp_approval:{
      en: ppStatus==='approved'?'PP Approved — Start Lot Printing':'Waiting for PP Approval',
      ur: ppStatus==='approved'?'پی پی منظور — لاٹ پرنٹنگ شروع کریں':'پی پی منظوری کا انتظار کریں',
      steps: ppStatus==='approved'?['PP is approved — you can start full lot / پی پی منظور ہو گیا — لاٹ شروع کریں','Follow recipe exactly / ریسیپی بالکل ویسے ہی فالو کریں','Count pieces carefully / پیس گنتے رہیں']:['Physical sample is with Haris / فزیکل سیمپل حارث کے پاس ہے','Wait for approval / منظوری کا انتظار کریں','Do not start lot printing yet / ابھی لاٹ شروع نہ کریں']
    },
    bulk_printing:{
      en:'Lot Printing in Progress',ur:'لاٹ پرنٹنگ جاری ہے',
      steps:['Print all pieces as per recipe / تمام پیس ریسیپی کے مطابق پرنٹ کریں','Count total printed pieces / کل پرنٹ پیس گنیں','Count any damaged pieces / خراب پیس الگ رکھیں','Press Complete when done / مکمل ہونے پر بٹن دبائیں']
    }
  };
  const ppRejStep={en:'PP Rejected — New Sample Required',ur:'پی پی ریجیکٹ — نیا پی پی سیمپل بنائیں',steps:['See rejection reason below / نیچے وجہ پڑھیں','Fix the issue in new sample / مسئلہ ٹھیک کریں','Print a new PP sample / نیا پی پی سیمپل پرنٹ کریں','Send to Haris (QC) again / دوبارہ حارث کو دیں']};
  const curStep=ppRejected?ppRejStep:(stepInstructions[stage]||{en:JOB_STAGE_LABELS[stage]||stage,ur:'',steps:[]});
  const stepBlock=`
    <div style="background:var(--dark);border-radius:12px;padding:14px;margin-bottom:12px;color:#fff">
      <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:rgba(255,255,255,.5);margin-bottom:4px">موجودہ مرحلہ / CURRENT STEP</div>
      <div style="font-size:17px;font-weight:800">${curStep.en}</div>
      ${curStep.ur?`<div style="font-size:15px;font-weight:700;direction:rtl;text-align:right;margin-top:2px;color:rgba(255,255,255,.85)">${curStep.ur}</div>`:''}
      ${curStep.steps.length?`<ol style="margin:10px 0 0 0;padding-left:18px;font-size:12px;line-height:2;color:rgba(255,255,255,.8)">${curStep.steps.map(s=>`<li>${s}</li>`).join('')}</ol>`:''}
    </div>`;

  // ── Images ──
  const frontUrl=recipe?.images?.frontUrl||'';
  const backUrl=recipe?.images?.backUrl||'';
  const guideUrl=recipe?.images?.placementGuideUrl||'';
  const imagesBlock=(frontUrl||backUrl||guideUrl)?`
    <div style="display:flex;gap:8px;margin-bottom:12px;overflow-x:auto">
      ${frontUrl?`<div style="flex-shrink:0"><div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:3px">FRONT / سامنے</div><img src="${frontUrl}" onclick="window.open('${frontUrl}')" style="height:110px;width:90px;object-fit:cover;border-radius:8px;cursor:zoom-in;border:1px solid var(--border)"></div>`:''}
      ${backUrl?`<div style="flex-shrink:0"><div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:3px">BACK / پیچھے</div><img src="${backUrl}" onclick="window.open('${backUrl}')" style="height:110px;width:90px;object-fit:cover;border-radius:8px;cursor:zoom-in;border:1px solid var(--border)"></div>`:''}
      ${guideUrl?`<div style="flex-shrink:0"><div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:3px">PLACEMENT GUIDE</div><img src="${guideUrl}" onclick="window.open('${guideUrl}')" style="height:110px;width:90px;object-fit:cover;border-radius:8px;cursor:zoom-in;border:1px solid var(--border)"></div>`:''}
    </div>`:'';

  // ── Qty + size breakdown ──
  const sizes=j.sizeBreakdown||{};
  const sizeKeys=Object.keys(sizes).filter(k=>sizes[k]>0);
  const qtyBlock=`
    <div style="background:#f8f8f8;border-radius:10px;padding:10px 12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;font-weight:700;color:var(--muted)">کل مقدار / TOTAL QTY</span>
        <span style="font-size:20px;font-weight:800;color:var(--dark)">${j.totalQty||'?'} <span style="font-size:12px;font-weight:500">pcs</span></span>
      </div>
      ${sizeKeys.length?`<div style="display:flex;gap:5px;flex-wrap:wrap">${sizeKeys.map(k=>`<span style="padding:3px 8px;background:#fff;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:700">${k}: ${sizes[k]}</span>`).join('')}</div>`:'<div style="font-size:11px;color:var(--muted)">Size details not available</div>'}
    </div>`;

  // ── Recipe placements as cards ──
  const recipeLockBanner=recipeLocked?`<div style="background:#111;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:700;color:#fff;margin-bottom:10px;text-align:center">Recipe Locked — Follow Exactly / ریسیپی لاک ہے — بالکل یہی فالو کریں</div>`:`<div style="background:#f5f5f5;border:1px solid #D9D9D9;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:700;color:#555;margin-bottom:10px;text-align:center">Draft Recipe — Not yet locked / ریسیپی ابھی لاک نہیں</div>`;
  const pantones=recipe?.printing?.pantones||[];
  const placements=recipe?.printing?.placements||[];
  const recipeSection=hasRecipe?`
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">ریسیپی / Recipe Summary</div>
      ${recipeLockBanner}
      ${placements.map(pl=>`
        <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:7px">
          <div style="font-size:13px;font-weight:700;margin-bottom:4px">${pl.templateNameEn||pl.name||'Placement'}${pl.templateNameUr?' / '+pl.templateNameUr:''}</div>
          ${(pl.measurementText||pl.measurementDescriptionEn)?`<div style="font-size:12px;color:var(--dark);margin-bottom:2px">${pl.measurementText||pl.measurementDescriptionEn}${pl.measurementUnit?' ('+pl.measurementUnit+')':''}</div>`:''}
          ${(pl.toleranceText||pl.toleranceValue||pl.tolerance)?`<div style="font-size:11px;color:var(--muted)">Tolerance: ${pl.toleranceText?(pl.toleranceText+(pl.toleranceUnit?' '+pl.toleranceUnit:'')):(pl.toleranceValue||pl.tolerance)}</div>`:''}
          ${(pl.production?.referenceImageUrl||pl.imageUrl)?`<img src="${pl.production?.referenceImageUrl||pl.imageUrl}" style="width:100%;max-height:120px;object-fit:contain;border-radius:8px;margin-top:6px;background:#f9f9f9;border:1px solid var(--border)">`:''}
          ${pantones.length?`<div style="margin-top:6px">${pantones.map(p=>'<div style="display:flex;align-items:center;gap:7px;padding:3px 0"><div style="width:16px;height:16px;border-radius:4px;background:'+(p.hexApprox||'#ddd')+';border:1px solid rgba(0,0,0,.1);flex-shrink:0"></div><span style="font-size:12px;font-weight:600">'+(p.colorName||'—')+'</span>'+(p.localInkName?'<span style="font-size:11px;color:var(--muted)">· '+p.localInkName+'</span>':'')+'</div>').join('')}</div>`:''}
        </div>`).join('')}
      ${!placements.length&&pantones.length?`<div style="margin-top:4px">${pantones.map(p=>'<div style="display:flex;align-items:center;gap:7px;padding:4px 0"><div style="width:18px;height:18px;border-radius:4px;background:'+(p.hexApprox||'#ddd')+';border:1px solid rgba(0,0,0,.1);flex-shrink:0"></div><span style="font-size:12px;font-weight:600">'+(p.colorName||'—')+'</span>'+(p.localInkName?'<span style="font-size:11px;color:var(--muted)">· '+p.localInkName+'</span>':'')+'</div>').join('')}</div>`:''}
      ${recipe.printing?.instructionsUr?`<div style="margin-top:8px;font-size:14px;line-height:2;direction:rtl;text-align:right;color:var(--dark);background:#f9f9f9;padding:8px 10px;border-radius:8px">${recipe.printing.instructionsUr}</div>`:''}
      ${recipe.printing?.instructionsEn?`<div style="margin-top:6px;font-size:12px;color:var(--dark);line-height:1.6">${recipe.printing.instructionsEn}</div>`:''}
      ${pantones.length?`<div style="margin-top:10px;padding-top:10px;border-top:1px solid #f0f0f0">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px">رنگ / Colors to Use</div>
        ${pantones.map(p=>'<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#f9f9f9;border-radius:8px;margin-bottom:5px"><div style="width:28px;height:28px;border-radius:6px;background:'+(p.hexApprox||'#ddd')+';border:1px solid rgba(0,0,0,.12);flex-shrink:0"></div><div><div style="font-size:13px;font-weight:700">'+(p.colorName||'—')+'</div><div style="font-size:11px;color:var(--muted)">'+(p.localInkName||p.pantoneCode||'')+'</div>'+(p.articleSpecificNotes||p.notes?'<div style="font-size:11px;color:var(--dark);font-style:italic">'+(p.articleSpecificNotes||p.notes)+'</div>':'')+'</div></div>').join('')}
      </div>`:''}
    </div>`:'';

  // ── No recipe warning ──
  const noRecipeWarn=!hasRecipe?`<div style="background:#fee2e2;border-radius:10px;padding:12px;color:#dc2626;font-weight:700;font-size:13px;margin-bottom:12px;text-align:center">ریسیپی موجود نہیں<br><span style="font-size:11px;font-weight:500;margin-top:4px;display:block">Recipe Missing — PP sample cannot start. Contact Ammar.</span></div>`:'';

  // ── PP photo upload (file input, no URL shown to worker) ──
  const ppPhotoInput=`
    <div style="margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--dark);margin-bottom:6px">تصویر لگائیں / Attach PP Sample Photo</div>
      <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:2px dashed var(--border);border-radius:10px;cursor:pointer;background:#fafafa">
        <span style="font-size:20px">📷</span>
        <span style="font-size:13px;color:var(--muted)">تصویر لیں یا اپلوڈ کریں<br><span style="font-size:11px">Take Photo / Upload Photo</span></span>
        <input type="file" id="pp-file-${j._id}" accept="image/*" capture="environment" style="display:none" onchange="window._ppPhotoSelected('${j._id}',this)">
      </label>
      <div id="pp-photo-preview-${j._id}" style="margin-top:6px;display:none"><img id="pp-photo-img-${j._id}" style="width:100%;max-height:160px;object-fit:contain;border-radius:8px;border:1px solid var(--border)"><div style="font-size:11px;color:var(--green);font-weight:600;margin-top:3px">Photo selected / تصویر منتخب</div></div>
      <input type="hidden" id="pp-photo-${j._id}" value="">
    </div>`;

  // ── PP note ──
  const ppNoteInput=`
    <div style="margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--dark);margin-bottom:5px">نوٹ لکھیں / Sample Notes <span style="font-size:11px;font-weight:400;color:var(--muted)">(optional)</span></div>
      <textarea id="pp-note-${j._id}" rows="2" placeholder="کوئی بات لکھیں… / Any notes…" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;resize:none;outline:none"></textarea>
    </div>`;

  // ── Action area ──
  const handoffNote=`<div style="background:#f0f9ff;border-radius:8px;padding:8px 10px;font-size:12px;color:#0369a1;margin-top:8px;font-weight:500;line-height:1.6">یہ بٹن دبانے کے بعد فزیکل پی پی سیمپل QC / حارث کو دیں۔<br><span style="font-size:11px;font-style:italic">After pressing this, send the physical PP sample to Haris (QC).</span></div>`;

  let actionArea='';
  if(hasRecipe&&(canPPSample||ppRejected)){
    actionArea=`
      ${ppRejected?`<div style="background:#fee2e2;border-radius:10px;padding:12px;margin-bottom:12px;color:#dc2626;font-weight:700;font-size:13px">پی پی ریجیکٹ — نیا پی پی سیمپل بنائیں<br><span style="font-size:12px;font-weight:500;margin-top:4px;display:block">وجہ: ${j.ppAttempts?.[j.ppAttempts.length-1]?.rejectionReason||'—'}</span></div>`:''}
      ${ppNoteInput}
      ${ppPhotoInput}
      <button class="worker-btn worker-btn-amber" onclick="window.submitPPSample('${j._id}')">
        پی پی سیمپل تیار ہے / PP Sample Ready
      </button>
      ${handoffNote}`;
  } else if(awaitingApproval){
    actionArea=`<div style="background:#f0f9ff;border:1px solid #7dd3fc;border-radius:10px;padding:14px;color:#0369a1;font-weight:700;font-size:14px;text-align:center">
      منظوری کا انتظار / Waiting for Approval<br>
      <span style="font-size:12px;font-weight:500;margin-top:4px;display:block">پی پی سیمپل حارث کے پاس ہے — منظوری آنے پر لاٹ شروع ہوگا</span>
    </div>`;
  } else if(canStartBulk){
    actionArea=`<div class="pp-approved-banner">پی پی منظور — لاٹ چلانے کی اجازت ہے<br><span style="font-size:11px;font-weight:400">PP Approved — Lot Run Allowed</span></div>
    <button class="worker-btn worker-btn-green" onclick="window.startBulkPrinting('${j._id}')">
      لاٹ پرنٹنگ شروع کریں / Start Lot Printing
    </button>`;
  } else if(alreadyPrinting){
    actionArea=`<div class="pp-approved-banner" style="margin-bottom:10px">پی پی منظور — لاٹ جاری ہے<br><span style="font-size:11px;font-weight:400">PP Approved — Printing in Progress</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="field"><label>پرنٹ شدہ پیس / Printed Qty</label><input id="bulk-qty-${j._id}" type="number" min="0" placeholder="${j.totalQty||0}" style="width:100%"></div>
      <div class="field"><label>خراب پیس / Damaged Qty</label><input id="bulk-dmg-${j._id}" type="number" min="0" placeholder="0" style="width:100%"></div>
    </div>
    <div class="field" style="margin-bottom:10px"><label>نوٹ / Notes</label><textarea id="bulk-note-${j._id}" rows="2" placeholder="کوئی بات لکھیں…" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;resize:none;outline:none"></textarea></div>
    <button class="worker-btn worker-btn-green" onclick="window.completeBulkPrinting('${j._id}')">
      پرنٹنگ مکمل ہو گئی / Printing Complete
    </button>`;
  } else if(!hasRecipe){
    actionArea=noRecipeWarn;
  }

  // ── Secondary: delay + voice note ──
  const secondaryActions=`
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-outline" style="flex:1;font-size:12px;padding:8px 0;color:#6B7280;border-color:#e0e0e0" onclick="window.showDelayForm('${j._id}')">تاخیر کی وجہ لکھیں<br><span style="font-size:10px">Add Delay Reason</span></button>
      <button class="btn-outline" style="flex:1;font-size:12px;padding:8px 0;color:#6B7280;border-color:#e0e0e0" onclick="window._voiceNoteWorker('${j._id}')">وائس نوٹ<br><span style="font-size:10px">Add Voice Note</span></button>
    </div>
    <div id="delay-form-${j._id}" style="display:none;margin-top:8px">
      <textarea id="delay-text-${j._id}" rows="2" placeholder="تاخیر کی وجہ بتائیں… / Explain delay…" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;resize:none;outline:none;margin-bottom:6px;direction:rtl"></textarea>
      <button class="btn-outline" style="width:100%" onclick="window.submitDelayReason('${j._id}')">جمع کروائیں / Submit</button>
    </div>`;

  return`<div class="work-card" style="border-radius:14px;overflow:hidden;padding:0">
    <!-- Header -->
    <div style="padding:14px 14px 12px;border-bottom:2px solid var(--border);background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-size:14px;font-weight:800;color:var(--red)">${j.poNumber||'—'}</span>
            <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:8px;background:${(PRIORITY_COLORS[j.priority]||'#888')+'22'};color:${PRIORITY_COLORS[j.priority]||'#888'}">${(j.priority||'normal').toUpperCase()}</span>
            ${tierBadge(j.complexityTier||1)}
          </div>
          <div style="font-size:16px;font-weight:800;line-height:1.25;margin-bottom:2px">${j.articleCode||'—'}</div>
          <div style="font-size:13px;color:var(--muted)">${j.articleName||'—'}</div>
          <div style="margin-top:4px">${processBadge(j.processType)}</div>
        </div>
        ${frontUrl?`<img src="${frontUrl}" onclick="window.open('${frontUrl}')" style="width:64px;height:80px;object-fit:cover;border-radius:8px;flex-shrink:0;cursor:zoom-in;border:1px solid var(--border)">`:''}
      </div>
    </div>

    <!-- Body -->
    <div style="padding:14px">
      ${slaBlock}
      ${stepBlock}
      ${imagesBlock}
      ${qtyBlock}
      ${recipeSection}
      ${actionArea}
      ${secondaryActions}
      <div style="margin-top:10px;text-align:center">
        <button style="background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;font-family:inherit" onclick="window.openPrintingJob('${j._id}')">Full Details / تفصیل دیکھیں →</button>
      </div>
    </div>
  </div>`;
}
window.showDelayForm=function(id){ const f=document.getElementById('delay-form-'+id); if(f)f.style.display=f.style.display==='none'?'block':'none'; };
window._ppPhotoSelected=async function(jobId,input){
  const file=input.files?.[0]; if(!file)return;
  const preview=document.getElementById('pp-photo-preview-'+jobId);
  const img=document.getElementById('pp-photo-img-'+jobId);
  const hidden=document.getElementById('pp-photo-'+jobId);
  if(img){img.src=URL.createObjectURL(file);preview.style.display='block';}
  try{
    showToast('Uploading photo…');
    const url=await uploadToCloudinary(file);
    if(hidden)hidden.value=url;
    showToast('Photo uploaded ✓');
  }catch(e){showToast('Photo upload failed: '+e.message,true);if(preview)preview.style.display='none';}
};
window._voiceNoteWorker=function(jobId){
  showToast('Voice note upload coming soon — use text note for now.',false);
  const f=document.getElementById('delay-form-'+jobId);
  if(f)f.style.display='block';
};

// ── Bundling / Stitching worker cards ─────────────────────────────────
function bundlingWorkerCardHTML(j){
  return`<div class="work-card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><div style="display:flex;gap:6px;align-items:center"><span style="font-size:12px;font-weight:700;color:var(--red)">${j.poNumber||'—'}</span>${tierBadge(j.complexityTier||1)}</div>
        <div style="font-size:14px;font-weight:600;margin-top:3px">${j.articleCode||'—'} — ${j.articleName||'—'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${j.totalQty||'?'} pcs · ${processBadge(j.processType)}</div>
      </div>
    </div>
    ${j.handoff?.acceptedByZohaibAt?`<div class="pp-approved-banner" style="margin-top:10px">✓ Lot accepted · Bundling in progress</div>`:''}
    ${!j.handoff?.acceptedByZohaibAt?`<button class="worker-btn worker-btn-green" onclick="window.acceptByZohaib('${j._id}')">Accept Lot / لاٹ قبول کریں</button>`:''}
    ${j.handoff?.acceptedByZohaibAt&&!j.handoff?.forwardedToStitchingAt?`
      <div class="field" style="margin-top:10px"><label>Bundle Count</label><input id="bundle-count-${j._id}" type="number" min="1" placeholder="no. of bundles" style="width:100%"></div>
      <div class="field" style="margin:8px 0"><label>Notes</label><input id="bundle-notes-${j._id}" placeholder="any notes…" style="width:100%"></div>
      <button class="worker-btn" onclick="window.forwardToStitching('${j._id}')">Forward to Stitching / سلائی کو بھیجیں</button>`:''}
    ${j.handoff?.forwardedToStitchingAt?`<div style="font-size:12px;color:var(--green);margin-top:8px;font-weight:600">✓ Forwarded to Stitching at ${tsLabel2(j.handoff.forwardedToStitchingAt)}</div>`:''}
  </div>`;
}
function stitchingWorkerCardHTML(j){
  return`<div class="work-card">
    <div><div style="display:flex;gap:6px;align-items:center"><span style="font-size:12px;font-weight:700;color:var(--red)">${j.poNumber||'—'}</span>${tierBadge(j.complexityTier||1)}</div>
      <div style="font-size:14px;font-weight:600;margin-top:3px">${j.articleCode||'—'} — ${j.articleName||'—'}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${j.totalQty||'?'} pcs</div>
    </div>
    ${!j.handoff?.acceptedByWaqasAt?`<button class="worker-btn worker-btn-green" style="margin-top:10px" onclick="window.acceptByWaqas('${j._id}')">Accept Stitching / سلائی قبول کریں</button>`:''}
    ${j.handoff?.acceptedByWaqasAt&&!j.handoff?.stitchingForwardedToQcAt?`
      <div class="pp-approved-banner" style="margin:10px 0">✓ Stitching in progress</div>
      <div class="field"><label>Notes</label><input id="stitch-notes-${j._id}" placeholder="notes…" style="width:100%"></div>
      <button class="worker-btn" onclick="window.completeStitching('${j._id}')">Stitching Complete → Return to QC / فائنل QC کو بھیجیں</button>`:''}
    ${j.handoff?.stitchingForwardedToQcAt?`<div style="font-size:12px;color:var(--green);margin-top:8px;font-weight:600">✓ Returned to Final QC at ${tsLabel2(j.handoff.stitchingForwardedToQcAt)}</div>`:''}
  </div>`;
}

// ── Full Job Detail Page (manager / QC) ───────────────────────────────
function renderPrintingJobDetailPage(){
  const m=document.getElementById('main-content');
  const j=allPrintingJobs.find(x=>x._id===viewingPrintJob);
  if(!j){window.showPage('printing-jobs');return;}
  const recipe=allRecipes.find(r=>r._id===j.recipeId);
  const qcRep=allQCReports.find(q=>q.printingJobId===j._id);
  const billing=allPrintBilling.find(b=>b.printingJobId===j._id);
  const commNotes=allCommNotes.filter(c=>c.linkedId===j._id);
  const slaEvts=allSLAEvents.filter(s=>s.printingJobId===j._id);
  const sl=slaStatus(j.slaCurrentDue||null);
  const isExt=j.departmentType?.startsWith('external');

  m.innerHTML=`<button class="back-btn" onclick="window.showPage('printing-jobs')">← Back to Jobs</button>
  <div class="page-head">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700;color:var(--red)">${j.poNumber||'—'}</span>
          <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;background:${PRIORITY_COLORS[j.priority]+'20'};color:${PRIORITY_COLORS[j.priority]}">${(j.priority||'').toUpperCase()}</span>
          ${tierBadge(j.complexityTier||1)}
          ${processBadge(j.processType)}
        </div>
        <div class="page-title" style="margin-top:4px">${j.articleCode||'—'} — ${j.articleName||'—'}</div>
        <div class="page-sub">Created by ${j.createdBy||'—'} · ${tsLabel2(j.createdAt)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${isExt?`<button class="btn-pdf" onclick="window.printVendorJobCard('${j._id}')">🖨 Vendor Job Card</button>`:''}
        ${(inferJobType(j)==='embroidery'||inferJobType(j)==='sublimation')?`<button class="btn-outline" style="width:auto;padding:8px 14px" onclick="window.generateJobSheetPDF('${j._id}')">📄 Print Job Sheet (PDF)</button>`:''}
        ${(j.currentStage==='final_qc'||j.currentStage==='rework')&&isQCWorker()?`<button class="btn-primary" style="width:auto;padding:8px 16px" onclick="window.openQCReport('${j._id}')">Enter QC Report</button>`:''}
        ${j.currentStage==='pp_approval'&&canApproveNewPP()?`<div style="display:flex;gap:6px">
          <button class="btn-primary" style="width:auto;padding:8px 14px;background:var(--green)" onclick="window.approvePP('${j._id}')">✓ Approve PP</button>
          <button class="btn-primary" style="width:auto;padding:8px 14px;background:#dc2626" onclick="window.rejectPP('${j._id}')">✗ Reject PP</button>
        </div>`:''}
        ${j.currentStage==='pp_approval'&&j.ppMode==='repeat_article'&&isQCWorker()&&!canApproveNewPP()?`<div style="display:flex;gap:6px">
          <button class="btn-primary" style="width:auto;padding:8px 14px;background:var(--green)" onclick="window.approvePP('${j._id}')">✓ Approve PP (Repeat)</button>
          <button class="btn-primary" style="width:auto;padding:8px 14px;background:#dc2626" onclick="window.rejectPP('${j._id}')">✗ Reject PP</button>
        </div>`:''}
      </div>
    </div>
  </div>

  ${j.recipeWarning?`<div class="alert-banner alert-amber">⚠️ ${j.recipeWarning}</div>`:''}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
    <div class="card" style="margin-bottom:0"><div class="card-title">Job Details</div>
      <div class="info-row"><span class="info-label">Stage</span><span style="font-weight:700">${JOB_STAGE_LABELS[j.currentStage]||j.currentStage}</span></div>
      <div class="info-row"><span class="info-label">PP Mode</span><span>${j.ppMode==='new_article'?'New Article (high approval)':'Repeat Article (QC approval ok)'}</span></div>
      <div class="info-row"><span class="info-label">Assigned</span><span>${j.assignedTo||'—'}</span></div>
      <div class="info-row"><span class="info-label">Total Qty</span><span style="font-weight:700">${j.totalQty||'?'} pcs</span></div>
      <div class="info-row"><span class="info-label">Rate</span><span>Rs. ${j.ratePerPiece||'—'}/pc</span></div>
      ${j.vendorName?`<div class="info-row"><span class="info-label">Vendor</span><span>${j.vendorName}</span></div>`:''}
      ${j.bulkStartedAt?`<div class="info-row"><span class="info-label">Print Started</span><span>${tsLabel2(j.bulkStartedAt)}</span></div>`:''}
      ${j.bulkCompletedAt?`<div class="info-row"><span class="info-label">Print Done</span><span>${tsLabel2(j.bulkCompletedAt)}</span></div>`:''}
    </div>
    <div class="card" style="margin-bottom:0"><div class="card-title">Size Breakdown</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${Object.entries(j.sizeBreakdown||{}).filter(([,v])=>v>0).map(([k,v])=>`<div style="text-align:center;min-width:42px;padding:6px 8px;background:#f4f4f6;border-radius:6px"><div style="font-size:9px;color:var(--muted)">${k}</div><div style="font-size:16px;font-weight:700">${v}</div></div>`).join('')||'<span style="font-size:12px;color:var(--muted)">No breakdown set</span>'}
      </div>
      ${j.slaCurrentDue?`<div style="margin-top:10px;padding:8px;border-radius:8px;background:${sl==='ok'?'#EFEFEF':sl==='near'?'#f0f0f0':'#fee2e2'}">
        <div style="font-size:10px;font-weight:700;color:var(--muted)">CURRENT SLA</div>
        <div style="font-size:15px;font-weight:700;color:${slaColor(sl)}">${remainLabel(j.slaCurrentDue)}</div>
      </div>`:''}
    </div>
  </div>

  ${renderPPAttemptsCard(j)}
  ${renderJobTimeline(j)}
  ${renderJobComms(j,commNotes)}
  ${renderSLACard(j,slaEvts)}

  <div style="height:80px"></div>`;
}

function renderPPAttemptsCard(j){
  const attempts=j.ppAttempts||[];
  if(!attempts.length)return`<div class="card"><div class="card-title">PP Sample History</div><div style="font-size:12px;color:var(--muted)">No PP sample submitted yet.</div></div>`;
  return`<div class="card"><div class="card-title">PP Sample History (${attempts.length} attempt${attempts.length>1?'s':''})</div>
    ${attempts.map((a,i)=>`<div style="padding:10px;background:${a.status==='approved'?'#f0fdf4':a.status==='rejected'?'#fef2f2':'#f8f8f8'};border-radius:8px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:12px;font-weight:700">Attempt #${i+1} <span style="font-weight:400;color:var(--muted)">by ${a.submittedBy||'—'} · ${tsLabel2(a.submittedAt)}</span></div>
          ${a.note?`<div style="font-size:12px;color:var(--dark);margin-top:3px">${a.note}</div>`:''}
        </div>
        <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;background:${a.status==='rejected'?'#111':'#f0f0f0'};color:${a.status==='rejected'?'#fff':'#111'}">${(a.status||'pending').toUpperCase()}</span>
      </div>
      ${a.photoUrl?`<img src="${a.photoUrl}" style="width:100%;max-height:180px;object-fit:contain;border-radius:6px;margin-top:8px;background:#f0f0f0">`:''}
      ${a.reviewedBy?`<div style="font-size:11px;color:var(--muted);margin-top:6px">${a.status==='approved'?'✓ Approved':'✗ Rejected'} by ${a.reviewedBy} · ${tsLabel2(a.reviewedAt)}</div>`:''}
      ${a.rejectionReason?`<div style="font-size:12px;color:#dc2626;margin-top:4px">Reason: ${a.rejectionReason}</div>`:''}
    </div>`).join('')}
  </div>`;
}

function renderJobTimeline(j){
  const history=j.stageHistory||[];
  return`<div class="card"><div class="card-title">Job Timeline</div>
    ${history.map((h,i)=>`<div class="stage-item">
      <div class="stage-dot ${i===history.length-1?'dot-active':'dot-done'}"></div>
      <div class="stage-content">
        <div class="stage-label">${JOB_STAGE_LABELS[h.stage]||h.stage}</div>
        <div class="stage-meta">${h.by||'—'} · ${tsLabel2(h.at)}${h.note?' · '+h.note:''}</div>
      </div>
    </div>${i<history.length-1?'<div class="stage-connector"></div>':''}`).join('')}
  </div>`;
}

function renderJobComms(j,notes){
  return`<div class="card"><div class="card-title">Notes & Communication</div>
    <div style="margin-bottom:10px">
      ${notes.length?notes.slice(0,10).map(n=>`<div class="comm-note ${n.type==='ping'?'comm-ping':''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="font-size:11px;font-weight:700">${n.fromUser||'—'} ${n.toUser?'→ '+n.toUser:''} <span style="font-weight:400;color:var(--muted)">· ${tsLabel2(n.createdAt)}</span></div>
          <span style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:6px;background:#f0f0f0">${(n.type||'text').toUpperCase()}</span>
        </div>
        <div style="font-size:13px;margin-top:4px">${n.message||'—'}</div>
      </div>`).join(''):'<div style="font-size:12px;color:var(--muted)">No notes yet.</div>'}
    </div>
    <div style="display:flex;gap:8px">
      <input id="comm-msg-${j._id}" placeholder="Add note or ping…" style="flex:1;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;outline:none">
      <select id="comm-type-${j._id}" style="padding:9px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:#fff;outline:none">
        <option value="text">Note</option><option value="ping">Ping</option>
      </select>
      <button class="btn-sm" onclick="window.addCommNote('${j._id}')">Send</button>
    </div>
  </div>`;
}

function renderSLACard(j,evts){
  if(!evts.length)return'';
  return`<div class="card"><div class="card-title">SLA Events</div>
    ${evts.map(e=>{const sl2=slaStatus(e.dueAt);return`<div style="padding:8px 0;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px">
        <div><div style="font-size:12px;font-weight:600">${JOB_STAGE_LABELS[e.stage]||e.stage}</div>
          <div style="font-size:11px;color:var(--muted)">Assigned: ${e.assignedTo||'—'} · Due: ${tsLabel2(e.dueAt)}</div>
          ${e.delayReasonText?`<div style="font-size:11px;color:var(--amber);margin-top:2px">Delay reason: ${e.delayReasonText}</div>`:''}
        </div>
        <span class="sla-chip ${slaChipClass(e.completedAt?'ok':sl2)}">${e.completedAt?'Completed':remainLabel(e.dueAt)}</span>
      </div>
    </div>`;}).join('')}
  </div>`;
}

// ── PP Sample Actions ──────────────────────────────────────────────────
window.submitPPSample=async function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const note=(document.getElementById('pp-note-'+jobId)?.value||'').trim();
  const photoUrl=(document.getElementById('pp-photo-'+jobId)?.value||'').trim();
  const now=nowIso();
  const attempt={attemptNum:(j.ppAttempts||[]).length+1,submittedBy:session.name,submittedAt:now,note,photoUrl,status:'pending',reviewedBy:null,reviewedAt:null,rejectionReason:''};
  const newAttempts=[...(j.ppAttempts||[]),attempt];
  const history=[...(j.stageHistory||[]),{stage:'pp_approval',by:session.name,at:now,note:`PP sample #${attempt.attemptNum} submitted`}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{ppAttempts:newAttempts,currentStage:'pp_approval',ppApprovalStatus:'pending',stageHistory:history,updatedAt:now,slaCurrentDue:calcDue('pp_approval',j.priority)});
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0){allPrintingJobs[ji]={...allPrintingJobs[ji],ppAttempts:newAttempts,currentStage:'pp_approval',ppApprovalStatus:'pending',stageHistory:history,slaCurrentDue:calcDue('pp_approval',j.priority)};}
    await addSLAEvent(jobId,j.poNumber,'pp_approval',j.priority,'haris',calcDue('pp_approval',j.priority));
    await logActivity('PP sample submitted',`${j.poNumber} — Attempt #${attempt.attemptNum}`);
    showToast('PP sample submitted ✓ — awaiting approval');
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

window.approvePP=async function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  if(j.ppMode==='new_article'&&!canApproveNewPP()){showToast('New article PP requires Ammar/Afnan/Arfat approval.',true);return;}
  if(j.ppMode==='repeat_article'&&!canApproveRepeatPP()){showToast('Not authorized to approve PP.',true);return;}
  // Gate: recipe must be locked before PP can be approved
  if(j.recipeWarning&&j.recipeWarning.includes('missing')){showToast('Recipe missing — PP cannot be approved until Ammar locks the recipe.',true);return;}
  if(j.recipeWarning&&j.recipeWarning.includes('not locked')){showToast('Recipe not locked — Ammar must lock the recipe before PP approval.',true);return;}
  const reason=prompt('Approval note (optional):');
  const now=nowIso();
  const updated=(j.ppAttempts||[]).map((a,i)=>i===j.ppAttempts.length-1?{...a,status:'approved',reviewedBy:session.name,reviewedAt:now,approvalNote:reason||''}:a);
  const history=[...(j.stageHistory||[]),{stage:'bulk_printing',by:session.name,at:now,note:'PP approved — lot run authorized'}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{ppAttempts:updated,ppApprovalStatus:'approved',ppApprovedBy:session.name,ppApprovedAt:now,currentStage:'pp_approval',stageHistory:history,updatedAt:now,slaCurrentDue:calcDue('bulk_printing',j.priority)});
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],ppAttempts:updated,ppApprovalStatus:'approved',ppApprovedBy:session.name,ppApprovedAt:now,currentStage:'pp_approval'};
    await logActivity('PP approved',`${j.poNumber} by ${session.name}`);
    showToast('PP Approved ✓ — Asghar can now start lot printing'); renderPrintingJobDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};

window.rejectPP=async function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  if(j.ppMode==='new_article'&&!canApproveNewPP()){showToast('Not authorized.',true);return;}
  if(j.ppMode==='repeat_article'&&!canApproveRepeatPP()){showToast('Not authorized.',true);return;}
  const reason=prompt('Rejection reason (required):');
  if(!reason){showToast('Rejection reason is required.',true);return;}
  const now=nowIso();
  const updated=(j.ppAttempts||[]).map((a,i)=>i===j.ppAttempts.length-1?{...a,status:'rejected',reviewedBy:session.name,reviewedAt:now,rejectionReason:reason}:a);
  const history=[...(j.stageHistory||[]),{stage:'pp_sample',by:session.name,at:now,note:'PP rejected: '+reason}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{ppAttempts:updated,ppApprovalStatus:'rejected',currentStage:'po_received',stageHistory:history,updatedAt:now,slaCurrentDue:calcDue('pp_sample',j.priority)});
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],ppAttempts:updated,ppApprovalStatus:'rejected',currentStage:'po_received'};
    await logActivity('PP rejected',`${j.poNumber} — ${reason}`);
    showToast('PP Rejected — new sample required'); renderPrintingJobDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Bulk Printing Actions ─────────────────────────────────────────────
window.startBulkPrinting=async function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  if(j.ppApprovalStatus!=='approved'){showToast('PP must be approved first.',true);return;}
  const now=nowIso();
  const history=[...(j.stageHistory||[]),{stage:'bulk_printing',by:session.name,at:now,note:'Lot printing started'}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{currentStage:'bulk_printing',bulkStartedAt:now,stageHistory:history,updatedAt:now,slaCurrentDue:calcDue('bulk_printing',j.priority)});
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],currentStage:'bulk_printing',bulkStartedAt:now};
    await addSLAEvent(jobId,j.poNumber,'bulk_printing',j.priority,'asghar',calcDue('bulk_printing',j.priority));
    await logActivity('Bulk printing started',j.poNumber);
    showToast('Lot printing started / لاٹ پرنٹنگ شروع ✓');
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

window.completeBulkPrinting=async function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const printedQty=parseInt(document.getElementById('bulk-qty-'+jobId)?.value)||j.totalQty;
  const damagedQty=parseInt(document.getElementById('bulk-dmg-'+jobId)?.value)||0;
  const note=(document.getElementById('bulk-note-'+jobId)?.value||'').trim();
  if(!printedQty){showToast('Enter printed quantity.',true);return;}
  const now=nowIso();
  const history=[...(j.stageHistory||[]),{stage:'final_qc',by:session.name,at:now,note:`Printing complete: ${printedQty} pcs printed${damagedQty?' ('+damagedQty+' damaged)':''}. ${note}`}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{currentStage:'final_qc',bulkCompletedAt:now,printedQty,damagedQty,bulkNotes:note,stageHistory:history,updatedAt:now,slaCurrentDue:calcDue('final_qc',j.priority)});
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],currentStage:'final_qc',bulkCompletedAt:now,printedQty,damagedQty};
    await addSLAEvent(jobId,j.poNumber,'final_qc',j.priority,'haris',calcDue('final_qc',j.priority));
    await logActivity('Bulk printing complete',`${j.poNumber} — ${printedQty} pcs`);
    showToast('Printing complete ✓ — Waiting for Final QC / فائنل QC کا انتظار');
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

window.submitDelayReason=async function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const reason=(document.getElementById('delay-text-'+jobId)?.value||'').trim();
  if(!reason){showToast('Write a reason before submitting.',true);return;}
  try{
    const slaEv=allSLAEvents.find(s=>s.printingJobId===jobId&&!s.completedAt);
    if(slaEv){await updateDoc(doc(db,'sla_events',slaEv._id),{delayReasonText:reason,reasonRequired:false});}
    await addDoc(collection(db,'communication_notes'),{linkedType:'printing_job',linkedId:jobId,fromUser:session.name,toUser:null,toRole:'manager',type:'text',message:'DELAY REASON: '+reason,voiceNoteUrl:'',createdAt:nowIso(),readBy:[]});
    await logActivity('Delay reason submitted',`${j.poNumber}: ${reason}`);
    showToast('Delay reason submitted ✓');
    const f=document.getElementById('delay-form-'+jobId); if(f)f.style.display='none';
  }catch(e){showToast('Error: '+e.message,true);}
};

window.addCommNote=async function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const msg=(document.getElementById('comm-msg-'+jobId)?.value||'').trim();
  const type=document.getElementById('comm-type-'+jobId)?.value||'text';
  if(!msg){showToast('Write a message first.',true);return;}
  const note={linkedType:'printing_job',linkedId:jobId,fromUser:session.name,toUser:null,toRole:'all',type,message:msg,voiceNoteUrl:'',createdAt:nowIso(),readBy:[session.u]};
  try{
    const id=prntId();
    await setDoc(doc(db,'communication_notes',id),note);
    allCommNotes.unshift({...note,_id:id});
    showToast('Note sent ✓'); renderPrintingJobDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};

window.openQCReport=function(jobId){ viewingPrintJob=jobId; currentPage='qc-report-page'; renderQCReportPage(); };

// ════════════════════════════════════════════════════════════════════
// CHUNK 3 — QC REPORT PAGE · DEFECT ENTRY · REWORK · REJECTION BOX
//            FINAL QC OUTCOMES · FORWARD TO QC BUNDLING
// ════════════════════════════════════════════════════════════════════

let _defectRows=0;

function renderQCReportPage(){
  const m=document.getElementById('main-content');
  if(!canViewQCReport()){m.innerHTML='<div class="empty">Not authorized.</div>';return;}
  const j=allPrintingJobs.find(x=>x._id===viewingPrintJob);
  if(!j){window.showPage('printing-jobs');return;}
  const existing=allQCReports.find(q=>q.printingJobId===j._id&&q.reportType==='final_qc');

  m.innerHTML=`<button class="back-btn" onclick="window.openPrintingJob('${j._id}')">← Back to Job Detail</button>
  <div class="page-head">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div><div class="page-title">QC Report — ${j.poNumber}</div>
        <div class="page-sub">${j.articleCode||'—'} · ${j.articleName||'—'} · ${j.printedQty||j.totalQty||'?'} pcs received</div>
      </div>
      ${existing?`<div style="display:flex;gap:6px"><span style="font-size:12px;font-weight:700;color:${existing.final?.totalCleared>0?'var(--green)':'#dc2626'};padding:8px 14px;border:1px solid ${existing.final?.totalCleared>0?'var(--green)':'#dc2626'};border-radius:8px">Report Submitted</span></div>`:''}
    </div>
  </div>

  ${existing?renderExistingQCReport(existing,j):renderQCReportForm(j)}
  <div style="height:80px"></div>`;
}

function renderExistingQCReport(rep,j){
  const f=rep.final||{};
  return`<div class="alert-banner alert-green">✓ QC Report submitted by ${rep.submittedBy||'—'} at ${tsLabel2(rep.submittedAt)}</div>

  <div class="card"><div class="card-title">QC Summary</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-bottom:12px">
      ${[['Received',rep.firstPass?.checkedQty||0,'var(--dark)'],['Clear ✓',rep.firstPass?.clearQty||0,'var(--green)'],['Rework',rep.firstPass?.reworkQty||0,'var(--amber)'],['Minor',rep.firstPass?.minorQty||0,'var(--amber)'],['Rejected',rep.firstPass?.rejectedQty||0,'#dc2626']].map(([l,v,c])=>`<div style="text-align:center;padding:10px;background:#f4f4f6;border-radius:8px"><div style="font-size:9px;color:var(--muted)">${l}</div><div style="font-size:22px;font-weight:800;color:${c}">${v}</div></div>`).join('')}
    </div>
    <div class="info-row"><span class="info-label">Final Approved Qty</span><span style="font-size:18px;font-weight:800;color:var(--green)">${f.totalCleared||0} pcs</span></div>
    <div class="info-row"><span class="info-label">Total Rejected</span><span style="font-weight:700;color:#dc2626">${f.totalRejected||0} pcs</span></div>
    <div class="info-row"><span class="info-label">Billing Approved Qty</span><span style="font-weight:700">${f.billingApprovedQty||0} pcs</span></div>
    ${f.remarks?`<div class="info-row"><span class="info-label">Remarks</span><span>${f.remarks}</span></div>`:''}
  </div>

  ${(rep.defects||[]).length?`<div class="card"><div class="card-title">Defects Logged (${rep.defects.length})</div>
    ${rep.defects.map(d=>`<div style="padding:8px;background:#fafafa;border-radius:8px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><div style="font-size:12px;font-weight:700">${d.category} — ${d.type}</div>
          <div style="font-size:11px;color:var(--muted)">${d.affectedQty||0} pcs · Sizes: ${(d.affectedSizes||[]).join(',')||'—'} · Resp: ${d.responsibleDepartment||'—'}</div>
        </div>
        <div style="text-align:right">
          <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;background:${d.severity==='critical'?'#111':d.severity==='major'?'#555':'#f0f0f0'};color:${d.severity==='critical'||d.severity==='major'?'#fff':'#111'}">${(d.severity||'minor').toUpperCase()}</span>
          <div style="font-size:10px;font-weight:700;color:${d.action==='accept'?'var(--green)':d.action==='reject'?'#dc2626':'var(--amber)'};margin-top:2px">${(d.action||'').toUpperCase()}</div>
        </div>
      </div>
      ${d.affectsBilling?'<div style="font-size:10px;color:#dc2626;margin-top:3px;font-weight:700">⚠ Affects billing</div>':''}
    </div>`).join('')}
  </div>`:''}

  ${rep.rework?.sentQty?`<div class="card"><div class="card-title">Rework</div>
    <div class="info-row"><span class="info-label">Sent for Rework</span><span>${rep.rework.sentQty} pcs → ${rep.rework.sentTo||'—'}</span></div>
    <div class="info-row"><span class="info-label">Min SLA</span><span>${tsLabel2(rep.rework.minSlaDeadline)}</span></div>
    ${rep.rework.returnedQty?`<div class="info-row"><span class="info-label">Returned</span><span>${rep.rework.returnedQty} pcs (Passed: ${rep.rework.passedAfterRework||0})</span></div>`:''}
  </div>`:''}

  ${rep.rejection?.totalRejectedQty?`<div class="card" style="border:1px solid #fca5a5"><div class="card-title" style="color:#dc2626">Rejection Box</div>
    <div class="info-row"><span class="info-label">Box No.</span><span style="font-weight:700">${rep.rejection.rejectionBoxNo||'—'}</span></div>
    <div class="info-row"><span class="info-label">Rejected Qty</span><span style="color:#dc2626;font-weight:700">${rep.rejection.totalRejectedQty} pcs</span></div>
    <div class="info-row"><span class="info-label">Responsible</span><span>${rep.rejection.responsibleDept||'—'}</span></div>
    ${rep.rejection.notes?`<div class="info-row"><span class="info-label">Notes</span><span>${rep.rejection.notes}</span></div>`:''}
  </div>`:''}

  ${isQCWorker()&&(j.currentStage==='final_qc'||j.currentStage==='rework')&&!rep.handoff?.forwardedToBundlingAt?`
    <button class="btn-primary" style="background:var(--green)" onclick="window.forwardToQCBundling('${j._id}')">
      ✓ Forward to QC Bundling / QC بنڈلنگ کو بھیجیں
    </button>`:''}`;
}

function renderQCReportForm(j){
  const sizes=['XS','S','M','L','XL','2XL'];
  const received=j.printedQty||j.totalQty||0;
  _defectRows=0;
  return`<div class="card"><div class="card-title">Quantity Entry / مقدار درج کریں</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin-bottom:12px">
      ${sizes.map(sz=>`<div class="field"><label>${sz} Received</label><input id="qc-recv-${sz}" type="number" min="0" value="0" style="width:100%"></div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
      <div class="field"><label>Total Received</label><input id="qc-total-recv" type="number" min="0" value="${received}" style="width:100%"></div>
      <div class="field"><label>Checked Qty</label><input id="qc-checked" type="number" min="0" value="${received}" style="width:100%"></div>
      <div class="field"><label>Clear / Approved ✓</label><input id="qc-clear" type="number" min="0" value="0" style="width:100%" oninput="window._calcQCTotals()"></div>
      <div class="field"><label>Minor (Accept as-is)</label><input id="qc-minor" type="number" min="0" value="0" style="width:100%" oninput="window._calcQCTotals()"></div>
      <div class="field"><label>Rework Required</label><input id="qc-rework" type="number" min="0" value="0" style="width:100%" oninput="window._calcQCTotals()"></div>
      <div class="field"><label>Rejected / No Use</label><input id="qc-rejected" type="number" min="0" value="0" style="width:100%" oninput="window._calcQCTotals()"></div>
    </div>
    <div id="qc-total-display" style="margin-top:10px;font-size:13px;color:var(--muted)">Fill quantities above</div>
  </div>

  <div class="card"><div class="card-title">Bundle Records / بنڈل ریکارڈ</div>
    <div style="overflow-x:auto">
      <table class="cut-table"><thead><tr>
        <th>Bundle No</th><th>Recv Qty</th><th>Date</th><th>XS</th><th>S</th><th>M</th><th>L</th><th>XL</th><th>2XL</th><th>Forwarded</th>
      </tr></thead>
      <tbody id="bundle-tbody">
        <tr id="brow-1">
          <td><input type="number" value="1" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>
          <td><input type="number" value="0" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>
          <td><input type="date" value="${new Date().toISOString().slice(0,10)}" style="width:110px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>
          ${sizes.map(()=>`<td><input type="number" min="0" value="0" style="width:50px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>`).join('')}
          <td><input type="number" min="0" value="0" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>
        </tr>
      </tbody></table>
    </div>
    <button class="btn-outline" style="margin-top:8px" onclick="window._addBundleRow()">+ Add Bundle Row</button>
  </div>

  <div class="card"><div class="card-title">Defects Log / عیب ریکارڈ</div>
    <div id="defect-rows-wrap"></div>
    <button class="btn-outline" style="width:100%;margin-top:6px" onclick="window.addDefectRow()">+ Add Defect</button>
  </div>

  <div class="card"><div class="card-title">Rework (if any)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="field"><label>Rework Qty</label><input id="rw-qty" type="number" min="0" value="0" style="width:100%"></div>
      <div class="field"><label>Send To</label>
        <select id="rw-to"><option value="">Not required</option><option value="printing">Printing</option><option value="rafu">Rafu / Repair</option><option value="washing">Washing</option><option value="alteration">Alteration</option><option value="other">Other</option></select>
      </div>
      <div class="field"><label>Rework Deadline</label><input id="rw-deadline" type="datetime-local" style="width:100%"></div>
      <div class="field"><label>Rework Cost Mode</label>
        <select id="rw-cost-mode"><option value="absorbed">Absorbed Internally</option><option value="printing_billed">Billed to Printing</option><option value="manual_review">Manual Review</option></select>
      </div>
      <div class="field"><label>Rework Cost Amount (Rs.)</label><input id="rw-cost" type="number" min="0" value="0" style="width:100%"></div>
    </div>
  </div>

  <div class="card"><div class="card-title">Rejection Box / ریجیکشن باکس</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="field"><label>Rejection Box No.</label><input id="rej-box" placeholder="e.g. RB-041" style="width:100%"></div>
      <div class="field"><label>Responsible Dept.</label>
        <select id="rej-dept"><option value="printing">Printing</option><option value="fabric">Fabric / Cutting</option><option value="washing">Washing</option><option value="stitching">Stitching</option><option value="vendor">External Vendor</option><option value="unknown">Unknown / Review</option></select>
      </div>
      <div class="field"><label>Material Cost/pc (Rs.)</label><input id="rej-mat-cost" type="number" min="0" value="0" style="width:100%"></div>
      <div class="field" style="grid-column:1/-1"><label>Rejection Notes</label><textarea id="rej-notes" rows="2" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;resize:none;outline:none" placeholder="Describe rejection reason in detail…"></textarea></div>
    </div>
  </div>

  <div class="card"><div class="card-title">QC Outcome / نتیجہ</div>
    <div class="field" style="margin-bottom:10px"><label>Final Outcome</label>
      <select id="qc-outcome">
        <option value="approved">✓ Approved for QC Bundling</option>
        <option value="partial">⚡ Partial Approved + Rework</option>
        <option value="rejected">✗ Rejected Full Lot</option>
        <option value="manager_review">⚠ Needs Manager Review</option>
      </select>
    </div>
    <div class="field" style="margin-bottom:10px"><label>QC Remarks</label>
      <textarea id="qc-remarks" rows="2" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;outline:none" placeholder="Overall QC remarks…"></textarea>
    </div>
    <button class="btn-primary" onclick="window.submitQCReport('${j._id}')">Submit QC Report</button>
  </div>`;
}

window._calcQCTotals=function(){
  const cl=parseInt(document.getElementById('qc-clear')?.value)||0;
  const mn=parseInt(document.getElementById('qc-minor')?.value)||0;
  const rw=parseInt(document.getElementById('qc-rework')?.value)||0;
  const rj=parseInt(document.getElementById('qc-rejected')?.value)||0;
  const total=cl+mn+rw+rj;
  const el=document.getElementById('qc-total-display');
  if(el)el.innerHTML=`Total accounted: <strong>${total}</strong> pcs — Clear: <span style="color:var(--green);font-weight:700">${cl}</span> · Minor: <span style="color:var(--amber);font-weight:700">${mn}</span> · Rework: <span style="color:var(--amber);font-weight:700">${rw}</span> · Rejected: <span style="color:#dc2626;font-weight:700">${rj}</span>`;
};

let _bundleRowCount=1;
window._addBundleRow=function(){
  _bundleRowCount++;
  const sizes=['XS','S','M','L','XL','2XL'];
  const row=document.createElement('tr');row.id='brow-'+_bundleRowCount;
  row.innerHTML=`
    <td><input type="number" value="${_bundleRowCount}" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>
    <td><input type="number" value="0" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>
    <td><input type="date" value="${new Date().toISOString().slice(0,10)}" style="width:110px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>
    ${sizes.map(()=>`<td><input type="number" min="0" value="0" style="width:50px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>`).join('')}
    <td><input type="number" min="0" value="0" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:12px;outline:none"></td>`;
  document.getElementById('bundle-tbody')?.appendChild(row);
};

window.addDefectRow=function(){
  _defectRows++;
  const i=_defectRows;
  const deptOpts=['Printing','Fabric','Cutting','Washing','Stitching','External Vendor','Unknown'];
  const wrap=document.getElementById('defect-rows-wrap'); if(!wrap)return;
  const div=document.createElement('div');div.id='def-row-'+i;div.style.cssText='padding:12px;background:#f8f8f8;border-radius:10px;margin-bottom:10px';
  div.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--muted)">DEFECT #${i}</span>
      <button type="button" onclick="document.getElementById('def-row-${i}').remove()" style="background:none;border:none;color:#ccc;font-size:18px;cursor:pointer">×</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="field"><label>Category</label>
        <select id="def-cat-${i}" onchange="window._updateDefectTypes(${i},this.value)">
          ${DEFECT_CATS.map(c=>`<option value="${c.cat}">${c.cat} / ${c.nameUr}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Type</label>
        <select id="def-type-${i}">${(DEFECT_CATS[0]?.types||[]).map(t=>`<option value="${t}">${t}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Severity</label>
        <select id="def-sev-${i}"><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select>
      </div>
      <div class="field"><label>Affected Qty</label><input id="def-qty-${i}" type="number" min="0" value="0" style="width:100%"></div>
      <div class="field"><label>Affected Sizes</label><input id="def-sizes-${i}" placeholder="e.g. M,L,XL" style="width:100%"></div>
      <div class="field"><label>Bundle Nos.</label><input id="def-bundles-${i}" placeholder="e.g. 1,2,5" style="width:100%"></div>
      <div class="field"><label>Responsible Dept.</label>
        <select id="def-dept-${i}">${deptOpts.map(d=>`<option value="${d}">${d}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Action</label>
        <select id="def-action-${i}"><option value="accept">Accept</option><option value="rework">Rework</option><option value="reject">Reject</option></select>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Notes</label><input id="def-notes-${i}" placeholder="describe defect…" style="width:100%"></div>
      <div class="field" style="grid-column:1/-1;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="def-billing-${i}" checked style="accent-color:#dc2626">
        <label for="def-billing-${i}" style="font-size:12px;cursor:pointer">Affects billing / billing impact</label>
      </div>
    </div>`;
  wrap.appendChild(div);
};

window._updateDefectTypes=function(i,cat){
  const sel=document.getElementById('def-type-'+i); if(!sel)return;
  const found=DEFECT_CATS.find(c=>c.cat===cat);
  sel.innerHTML=(found?.types||[]).map(t=>`<option value="${t}">${t}</option>`).join('');
};

function collectDefects(){
  const defs=[];
  document.querySelectorAll('[id^="def-row-"]').forEach(row=>{
    const i=row.id.replace('def-row-','');
    defs.push({
      defectId:prntId(),
      category:document.getElementById('def-cat-'+i)?.value||'',
      type:document.getElementById('def-type-'+i)?.value||'',
      severity:document.getElementById('def-sev-'+i)?.value||'minor',
      affectedQty:parseInt(document.getElementById('def-qty-'+i)?.value)||0,
      affectedSizes:(document.getElementById('def-sizes-'+i)?.value||'').split(',').map(s=>s.trim()).filter(Boolean),
      affectedBundles:(document.getElementById('def-bundles-'+i)?.value||'').split(',').map(s=>s.trim()).filter(Boolean),
      responsibleDepartment:document.getElementById('def-dept-'+i)?.value||'Printing',
      action:document.getElementById('def-action-'+i)?.value||'rework',
      affectsBilling:!!document.getElementById('def-billing-'+i)?.checked,
      notes:document.getElementById('def-notes-'+i)?.value.trim()||'',
      photoUrls:[]
    });
  });
  return defs.filter(d=>d.category&&d.affectedQty>0);
}

function collectBundleRows(){
  const rows=[];
  document.querySelectorAll('[id^="brow-"]').forEach(row=>{
    const inputs=row.querySelectorAll('input');
    rows.push({
      bundleNo:parseInt(inputs[0]?.value)||0,
      receivingQty:parseInt(inputs[1]?.value)||0,
      date:inputs[2]?.value||'',
      XS:parseInt(inputs[3]?.value)||0,S:parseInt(inputs[4]?.value)||0,
      M:parseInt(inputs[5]?.value)||0,L:parseInt(inputs[6]?.value)||0,
      XL:parseInt(inputs[7]?.value)||0,'2XL':parseInt(inputs[8]?.value)||0,
      totalUnitsForwarded:parseInt(inputs[9]?.value)||0
    });
  });
  return rows.filter(r=>r.bundleNo>0);
}

window.submitQCReport=async function(jobId){
  if(!canViewQCReport()){showToast('Not authorized.',true);return;}
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;

  const totalRecv=parseInt(document.getElementById('qc-total-recv')?.value)||0;
  const checkedQty=parseInt(document.getElementById('qc-checked')?.value)||0;
  const clearQty=parseInt(document.getElementById('qc-clear')?.value)||0;
  const minorQty=parseInt(document.getElementById('qc-minor')?.value)||0;
  const reworkQty=parseInt(document.getElementById('qc-rework')?.value)||0;
  const rejectedQty=parseInt(document.getElementById('qc-rejected')?.value)||0;

  const rwQty=parseInt(document.getElementById('rw-qty')?.value)||0;
  const rwTo=document.getElementById('rw-to')?.value||'';
  const rwDeadline=document.getElementById('rw-deadline')?.value||calcDue('rework',j.priority);
  const rwCostMode=document.getElementById('rw-cost-mode')?.value||'absorbed';
  const rwCost=parseFloat(document.getElementById('rw-cost')?.value)||0;

  const rejBoxNo=document.getElementById('rej-box')?.value.trim()||'';
  const rejDept=document.getElementById('rej-dept')?.value||'Printing';
  const rejMatCost=parseFloat(document.getElementById('rej-mat-cost')?.value)||0;
  const rejNotes=document.getElementById('rej-notes')?.value.trim()||'';

  const outcome=document.getElementById('qc-outcome')?.value||'approved';
  const remarks=document.getElementById('qc-remarks')?.value.trim()||'';

  const defects=collectDefects();
  const bundleRows=collectBundleRows();

  // Sizes received
  const sizeWiseReceived={};
  ['XS','S','M','L','XL','2XL'].forEach(sz=>{sizeWiseReceived[sz]=parseInt(document.getElementById('qc-recv-'+sz)?.value)||0;});

  const finalApproved=clearQty+minorQty;
  const now=nowIso();

  const report={
    printingJobId:jobId, poId:j.poId||jobId, poNumber:j.poNumber, lotNo:j.poNumber,
    articleCode:j.articleCode, articleName:j.articleName, processType:j.processType,
    reportType:'final_qc', reportNum:(j.ppAttempts?.length||0),
    receivedQty:totalRecv, sizeWiseReceived, bundleRows,
    firstPass:{checkedQty,clearQty,reworkQty,rejectedQty,minorQty},
    defects,
    rework:{sentQty:rwQty,sentTo:rwTo,sentAt:rwQty>0?now:null,minSlaDeadline:rwDeadline,returnedQty:0,passedAfterRework:0,rejectedAfterRework:0,costMode:rwCostMode,costAmount:rwCost},
    rejection:{totalRejectedQty:rejectedQty,rejectionBoxNo:rejBoxNo,materialCostPerPiece:rejMatCost,totalMaterialCostImpact:rejMatCost*rejectedQty,responsibleDept:rejDept,notes:rejNotes},
    final:{totalReceived:totalRecv,totalCleared:finalApproved,totalRejected:rejectedQty,billingApprovedQty:finalApproved,checkedBy:session.name,checkedAt:now,remarks,outcome},
    submittedBy:session.name, submittedAt:now, createdAt:now
  };

  // Determine next stage
  const nextStage=outcome==='approved'?'qc_bundling':outcome==='partial'?'rework':outcome==='rejected'?'closed':'final_qc';
  const history=[...(j.stageHistory||[]),{stage:nextStage,by:session.name,at:now,note:`QC: ${outcome} — ${finalApproved} approved, ${rejectedQty} rejected`}];

  try{
    const repId=prntId();
    await setDoc(doc(db,'qc_reports',repId),report);
    allQCReports.unshift({...report,_id:repId});

    await updateDoc(doc(db,'printing_jobs',jobId),{currentStage:nextStage,finalQcStatus:outcome,stageHistory:history,updatedAt:now,qcReportId:repId,slaCurrentDue:nextStage==='rework'?rwDeadline:null});
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],currentStage:nextStage,finalQcStatus:outcome,qcReportId:repId};

    // Create billing record automatically
    await createBillingRecord(j,report,repId);

    // SLA for rework
    if(rwQty>0&&rwTo){ await addSLAEvent(jobId,j.poNumber,'rework',j.priority,'asghar',rwDeadline); }

    await logActivity('QC Report submitted',`${j.poNumber} — ${outcome} — ${finalApproved} approved`);
    showToast('QC Report submitted ✓ — '+outcome.replace('_',' '));
    currentPage='printing-job-detail'; renderPrintingJobDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};

async function createBillingRecord(j,report,qcReportId){
  const ratePerPiece=j.ratePerPiece||0;
  const firstPassApproved=report.final?.totalCleared||0;
  const reworkPassed=report.rework?.passedAfterRework||0;
  const finalApproved=firstPassApproved+reworkPassed;
  const grossBill=finalApproved*ratePerPiece;
  const rejQty=report.rejection?.totalRejectedQty||0;
  const matImpact=report.rejection?.totalMaterialCostImpact||0;

  // Billing deductions from defects marked affectsBilling
  const deductions=(report.defects||[]).filter(d=>d.affectsBilling&&d.action==='rework').map(d=>({
    type:'rework_cost',amount:0,reason:'Defect rework: '+d.type,linkedDefectId:d.defectId,approvedBy:null,status:'pending'
  }));

  const billing={
    printingJobId:j._id, qcReportId, poId:j.poId||j._id, poNumber:j.poNumber,
    articleCode:j.articleCode, articleName:j.articleName, processType:j.processType,
    ratePerPiece, poQty:j.totalQty||0,
    printedQty:j.printedQty||j.totalQty||0,
    firstPassApprovedQty:firstPassApproved, reworkPassedQty:reworkPassed,
    rejectedQty:rejQty, finalApprovedQty:finalApproved,
    grossBill, deductions, materialCostImpact:matImpact,
    monetaryWithhold:0, netPayable:grossBill-matImpact,
    status:firstPassApproved>0?'ready':'pending_qc',
    approvedBy:null, approvedAt:null, notes:'Auto-generated on QC report submission',
    createdAt:nowIso(), updatedAt:nowIso()
  };
  try{
    const id=prntId();
    await setDoc(doc(db,'printing_billing',id),billing);
    allPrintBilling.unshift({...billing,_id:id});
  }catch(_){}
}

// ── Forward to QC Bundling ────────────────────────────────────────────
window.forwardToQCBundling=async function(jobId){
  if(!isQCWorker()&&!isObserver()){showToast('QC only.',true);return;}
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const now=nowIso();
  const history=[...(j.stageHistory||[]),{stage:'qc_bundling',by:session.name,at:now,note:'Forwarded to QC Bundling'}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{
      currentStage:'qc_bundling',
      'handoff.forwardedToBundlingBy':session.name,
      'handoff.forwardedToBundlingAt':now,
      stageHistory:history,updatedAt:now,
      slaCurrentDue:calcDue('qc_bundling',j.priority)
    });
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],currentStage:'qc_bundling','handoff.forwardedToBundlingAt':now};
    await logActivity('Forwarded to QC Bundling',j.poNumber);
    showToast('Forwarded to QC Bundling / بنڈلنگ کو بھیج دیا ✓');
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

function renderBillingDetailPage(){
  const m=document.getElementById('main-content');
  const j=allPrintingJobs.find(x=>x._id===viewingPrintJob);
  const billing=j?allPrintBilling.find(b=>b.printingJobId===j._id):null;
  if(!billing){m.innerHTML=`<button class="back-btn" onclick="window.openPrintingJob('${viewingPrintJob||''}')">← Back</button><div class="empty">Billing not generated yet.</div>`;return;}

  const deductTotal=(billing.deductions||[]).filter(d=>d.status==='approved').reduce((s,d)=>s+d.amount,0);
  const net=billing.grossBill-deductTotal-(billing.materialCostImpact||0)-(billing.monetaryWithhold||0);

  m.innerHTML=`<button class="back-btn" onclick="window.openPrintingJob('${j._id}')">← Back to Job</button>
  <div class="page-head"><div class="page-title">Billing — ${billing.poNumber}</div><div class="page-sub">${billing.articleCode} · ${billing.processType}</div></div>

  <div class="card"><div class="card-title">Billing Calculation</div>
    <div class="billing-row"><span>PO Quantity</span><span>${billing.poQty} pcs</span></div>
    <div class="billing-row"><span>Printed Quantity</span><span>${billing.printedQty} pcs</span></div>
    <div class="billing-row"><span>First Pass Approved</span><span style="color:var(--green);font-weight:700">${billing.firstPassApprovedQty} pcs</span></div>
    <div class="billing-row"><span>Rework Passed</span><span style="color:var(--green)">${billing.reworkPassedQty} pcs</span></div>
    <div class="billing-row"><span style="font-weight:700">Final Approved Qty</span><span style="font-size:18px;font-weight:800;color:var(--dark)">${billing.finalApprovedQty} pcs</span></div>
    <div class="billing-row"><span>Rate / Piece</span><span>Rs. ${billing.ratePerPiece}</span></div>
    <div class="billing-row"><span style="font-weight:600">Gross Bill</span><span style="font-size:16px;font-weight:700">Rs. ${billing.grossBill?.toFixed(0)||0}</span></div>
    ${billing.materialCostImpact?`<div class="billing-row"><span style="color:#dc2626">Material Cost Impact (rejected)</span><span style="color:#dc2626;font-weight:700">− Rs. ${billing.materialCostImpact}</span></div>`:''}
    ${billing.monetaryWithhold?`<div class="billing-row"><span style="color:#dc2626">SLA Monetary Withhold</span><span style="color:#dc2626;font-weight:700">− Rs. ${billing.monetaryWithhold}</span></div>`:''}
    ${deductTotal?`<div class="billing-row"><span style="color:#dc2626">Approved Deductions</span><span style="color:#dc2626;font-weight:700">− Rs. ${deductTotal}</span></div>`:''}
    <div class="billing-row" style="border-top:2px solid var(--dark);padding-top:12px;margin-top:4px">
      <span style="font-size:15px;font-weight:800">NET PAYABLE</span>
      <span style="font-size:22px;font-weight:900;color:var(--green)">Rs. ${net.toFixed(0)}</span>
    </div>
    <div class="billing-row"><span class="info-label">Status</span>
      <span style="font-weight:700;padding:3px 10px;border-radius:8px;background:#f0f0f0">${(billing.status||'pending').replace('_',' ').toUpperCase()}</span>
    </div>
  </div>

  ${(billing.deductions||[]).length?`<div class="card"><div class="card-title">Deductions</div>
    ${billing.deductions.map(d=>`<div class="billing-row">
      <div><div style="font-size:12px;font-weight:600">${d.type.replace('_',' ')}</div><div style="font-size:11px;color:var(--muted)">${d.reason}</div></div>
      <div style="text-align:right"><div style="font-weight:600">Rs. ${d.amount||0}</div>
        <div style="font-size:10px;font-weight:700;color:${d.status==='approved'?'var(--green)':d.status==='waived'?'var(--amber)':'var(--muted)'}">${d.status?.toUpperCase()}</div>
      </div>
    </div>`).join('')}
  </div>`:''}

  ${canApproveBilling()&&billing.status==='ready'?`<div style="display:flex;gap:8px;margin-top:4px">
    <button class="btn-primary" style="flex:1;background:var(--green)" onclick="window.approveBilling('${billing._id}')">Approve Billing ✓</button>
    <button class="btn-outline" style="flex:1" onclick="window.disputeBilling('${billing._id}')">Dispute / Adjust</button>
  </div>`:''}
  <div style="height:80px"></div>`;
}

window.approveBilling=async function(billingId){
  if(!canApproveBilling()){showToast('Not authorized.',true);return;}
  const b=allPrintBilling.find(x=>x._id===billingId); if(!b)return;
  try{
    await updateDoc(doc(db,'printing_billing',billingId),{status:'approved',approvedBy:session.name,approvedAt:nowIso(),updatedAt:nowIso()});
    b.status='approved';b.approvedBy=session.name;
    await logActivity('Billing approved',`${b.poNumber} — Rs.${b.netPayable?.toFixed(0)||0}`);
    showToast('Billing approved ✓'); renderBillingDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};
window.disputeBilling=async function(billingId){
  const note=prompt('Dispute reason / adjustment note:'); if(!note)return;
  try{
    await updateDoc(doc(db,'printing_billing',billingId),{status:'disputed',notes:note,updatedAt:nowIso()});
    const b=allPrintBilling.find(x=>x._id===billingId); if(b){b.status='disputed';b.notes=note;}
    showToast('Billing disputed — marked for review'); renderBillingDetailPage();
  }catch(e){showToast('Error: '+e.message,true);}
};

// ════════════════════════════════════════════════════════════════════
// CHUNK 4 — OBSERVER CONTROL TOWER · SLA MANAGEMENT · WITHHOLD SYSTEM
//            BILLING OVERVIEW · COMMUNICATION DASHBOARD
// ════════════════════════════════════════════════════════════════════

function renderObserverTower(){
  if(!isObserver())return'<div class="empty">Observer access only.</div>';

  // ── KPI Calculations ──
  const active=allPrintingJobs.filter(j=>j.currentStage!=='closed');
  const overdue=allPrintingJobs.filter(j=>j.slaCurrentDue&&slaStatus(j.slaCurrentDue)!=='ok'&&j.currentStage!=='closed');
  const totalRejected=allQCReports.reduce((s,r)=>s+(r.final?.totalRejected||0),0);
  const billingPending=allPrintBilling.filter(b=>['ready','pending_approval'].includes(b.status));
  const withholdPending=allSLAEvents.filter(e=>e.monetaryWithholdSuggested>0&&!e.monetaryWithholdApproved);
  const recipeMissing=allPrintingJobs.filter(j=>j.recipeWarning&&j.currentStage!=='closed');

  // Per job-type breakdown
  const byType=JOB_TYPE_KEYS.reduce((acc,k)=>{acc[k]={active:[],overdue:[]};return acc;},{});
  active.forEach(j=>{ const t=inferJobType(j); if(byType[t])byType[t].active.push(j); });
  overdue.forEach(j=>{ const t=inferJobType(j); if(byType[t])byType[t].overdue.push(j); });

  return`<div class="page-head">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div><div class="page-title">Observer Control Tower</div>
        <div class="page-sub">Real-time view of all decoration & printing jobs · ${active.length} active</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-outline" onclick="window.refreshCurrentPage()">↻ Refresh</button>
      </div>
    </div>
  </div>

  <!-- KPI Grid: per-type active + overdue, plus global -->
  <div class="kpi-grid" style="margin-bottom:16px">
    ${JOB_TYPE_KEYS.map(k=>{
      const meta=JOB_TYPES[k];
      return `<div class="kpi-card"><div class="kpi-val">${byType[k].active.length}</div><div class="kpi-label">${meta.icon} ${k} active</div></div>`;
    }).join('')}
    ${JOB_TYPE_KEYS.map(k=>{
      return `<div class="kpi-card"><div class="kpi-val">${byType[k].overdue.length}</div><div class="kpi-label">${k} overdue</div></div>`;
    }).join('')}
    ${[
      ['Total Active',    active.length],
      ['Total Overdue',   overdue.length],
      ['Rejected Pcs',    totalRejected],
      ['Bill Pending',    billingPending.length],
      ['Withhold Q',      withholdPending.length],
      ['Recipe Missing',  recipeMissing.length]
    ].map(([l,v])=>`<div class="kpi-card"><div class="kpi-val">${v}</div><div class="kpi-label">${l}</div></div>`).join('')}
  </div>

  <!-- Tab bar -->
  <div class="tab-bar" style="margin-bottom:16px">
    ${[['board','Job Board'],['sla','SLA / Delays'],['billing','Billing'],['recipes','Recipes'],['comms','Communications']].map(([t,l])=>`<button class="tab-btn ${(document.getElementById('tower-tab-state')?.dataset.tab||'board')===t?'active':''}" onclick="window._towerTab('${t}')">${l}</button>`).join('')}
  </div>
  <div id="tower-tab-state" data-tab="${(document.getElementById('tower-tab-state')?.dataset.tab||'board')}" style="display:none"></div>

  <div id="tower-body">
    ${renderTowerBoard(allPrintingJobs)}
  </div>`;
}

window._refreshTower=async function(){
  await refreshPrintingData();
  document.getElementById('main-content').innerHTML=renderObserverTower();
};

window.refreshCurrentPage=async function(){
  const page=currentPage;
  if(!page){await loadData();return;}
  try{
    if(page==='observer-tower'||page.startsWith('printing-')||page.startsWith('recipe-')||page==='color-library'||page==='qc-report-page'||page==='billing-detail'){
      await refreshPrintingData();
    }else if(page.startsWith('store-')){
      if(typeof loadStoreData==='function')await loadStoreData();
    }else if(page==='hrm-employees'||page==='attendance'){
      if(typeof loadHRMData==='function')await loadHRMData();
    }else if(page==='hrm-payroll'||page==='hrm-payslips'){
      if(typeof loadPayrollData==='function')await loadPayrollData();
    }else if(page==='hrm-advances'||page==='hrm-loans'||page==='hrm-policy'){
      if(typeof loadHRMSession4Data==='function')await loadHRMSession4Data();
    }else if(page==='bug-tracker'){
      if(typeof loadBugReports==='function')await loadBugReports();
    }else if(page==='my-work'||page==='me'){
      // Workers: refresh PO data + printing data (their cards use both)
      const tasks=[loadData()];
      if(session&&session.role==='worker'&&typeof refreshPrintingData==='function')tasks.push(refreshPrintingData());
      if(session&&session.role==='worker'&&typeof loadHRMData==='function')tasks.push(loadHRMData());
      await Promise.all(tasks);
    }else{
      await loadData();
    }
  }catch(e){showToast('Refresh error: '+e.message,true);}
  await window.showPage(page);
};

window._towerTab=function(tab){
  document.getElementById('main-content').innerHTML=renderObserverTower();
  // After render, switch tab
  const state=document.getElementById('tower-tab-state'); if(state)state.dataset.tab=tab;
  const tabs=document.querySelectorAll('.tab-btn');
  tabs.forEach(b=>{b.classList.toggle('active',b.textContent.toLowerCase().replace(/[^a-z]/g,'').includes(tab.replace(/[^a-z]/g,'')));});
  const body=document.getElementById('tower-body');
  if(!body)return;
  if(tab==='board')body.innerHTML=renderTowerBoard(allPrintingJobs);
  else if(tab==='sla')body.innerHTML=renderTowerSLA();
  else if(tab==='billing')body.innerHTML=renderTowerBilling();
  else if(tab==='recipes')body.innerHTML=renderTowerRecipes();
  else if(tab==='comms')body.innerHTML=renderTowerComms();
};

// ── Board View: 3 type-tagged swimlanes ────────────────────────────────
function renderTowerBoard(jobs){
  return JOB_TYPE_KEYS.map(jt=>renderTowerSwimlane(jt,jobs)).join('');
}

function renderTowerSwimlane(jobType,jobs){
  const meta=JOB_TYPES[jobType];
  const laneJobs=jobs.filter(j=>inferJobType(j)===jobType);
  const stageColor={awaiting_pp:'#555',printing:'#111111',final_qc:'#111111',rework:'#dc2626',closed:'var(--green)'};
  const cols=meta.stages.map(stage=>({
    key:stage,
    label:meta.stageLabels[stage]||stage,
    color:stageColor[stage]||'#111111',
    jobs:laneJobs.filter(j=>towerLaneStage(j)===stage)
  }));
  return`<div style="margin-bottom:18px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:10px">
      <div style="font-size:14px;font-weight:700">${meta.icon} ${meta.label}</div>
      <div style="font-size:11px;color:var(--muted)">${laneJobs.filter(j=>j.currentStage!=='closed').length} active · ${laneJobs.length} total</div>
    </div>
    <div class="tower-cols">
      ${cols.map(col=>`<div class="tower-col">
        <div class="tower-col-head" style="border-bottom:2px solid ${col.color};padding-bottom:6px;margin-bottom:8px">
          ${col.label} <span style="font-size:12px;font-weight:400;color:var(--muted)">(${col.jobs.length})</span>
        </div>
        ${col.jobs.map(j=>towerJobMini(j)).join('')||'<div style="font-size:11px;color:var(--muted);padding:8px;text-align:center">—</div>'}
      </div>`).join('')}
    </div>
  </div>`;
}

function towerJobMini(j){
  const sl=slaStatus(j.slaCurrentDue||null);
  const recipe=allRecipes.find(r=>r._id===j.recipeId);
  const jt=inferJobType(j);
  const isOutsourced=(jt==='embroidery'||jt==='sublimation');
  return`<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:6px;cursor:pointer;border-left:3px solid ${slaColor(sl)}" onclick="window.openPrintingJob('${j._id}')">
    <div style="font-size:10px;font-weight:700;color:var(--red)">${j.poNumber||'—'}</div>
    <div style="font-size:12px;font-weight:600;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${j.articleCode||'—'}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap">
      <span style="font-size:10px;color:var(--muted)">${j.totalQty||0} pcs</span>
      ${tierBadge(j.complexityTier||1)}
    </div>
    ${j.slaCurrentDue?`<div style="font-size:9px;font-weight:700;color:${slaColor(sl)};margin-top:3px">${remainLabel(j.slaCurrentDue)}</div>`:''}
    ${j.ppApprovalStatus==='rejected'?'<div style="font-size:9px;color:#dc2626;font-weight:700">PP Rejected</div>':''}
    ${j.recipeWarning?'<div style="font-size:9px;color:var(--amber);font-weight:700">⚠ Recipe Missing</div>':''}
    <div style="font-size:9px;color:var(--muted);margin-top:2px">${j.assignedTo||'—'} · ${processBadge(j.processType)}</div>
    ${isOutsourced?`<button style="margin-top:5px;padding:3px 8px;font-size:10px;background:#fff;border:1px solid var(--border);border-radius:5px;cursor:pointer;color:var(--dark);font-family:inherit;width:100%" onclick="event.stopPropagation();window.generateJobSheetPDF('${j._id}')">📄 Job Sheet</button>`:''}
  </div>`;
}

// ── SLA View ──────────────────────────────────────────────────────────
function renderTowerSLA(){
  const evts=allSLAEvents.filter(e=>!e.completedAt).sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));
  const proposed=allSLAEvents.filter(e=>e.monetaryWithholdSuggested>0&&!e.monetaryWithholdApproved);

  return`<div class="card"><div class="card-title">Active SLA Events (${evts.length})</div>
    ${evts.length?evts.map(e=>{
      const sl=slaStatus(e.dueAt);
      return`<div style="padding:10px;background:${sl==='ok'?'#f8f8f8':sl==='near'?'#fef9e7':sl==='over'?'#fef2f2':'#7f1d1d10'};border-radius:8px;margin-bottom:8px;border-left:3px solid ${slaColor(sl)}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
          <div>
            <div style="font-size:11px;font-weight:700">${e.poId||'—'} · ${JOB_STAGE_LABELS[e.stage]||e.stage}</div>
            <div style="font-size:11px;color:var(--muted)">Assigned: ${e.assignedTo||'—'} · Priority: ${e.priority||'—'}</div>
            <div style="font-size:11px;color:var(--muted)">Due: ${tsLabel2(e.dueAt)}</div>
            ${e.delayReasonText?`<div style="font-size:11px;color:var(--amber);margin-top:3px">📝 ${e.delayReasonText}</div>`:''}
          </div>
          <div style="text-align:right">
            <span class="sla-chip ${slaChipClass(sl)}">${remainLabel(e.dueAt)}</span>
            ${sl!=='ok'&&!e.delayReasonText?`<div style="font-size:9px;color:#dc2626;font-weight:700;margin-top:4px">⚠ No delay reason</div>`:''}
          </div>
        </div>
        ${(sl==='over'||sl==='critical')&&isObserver()?`<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-sm" style="font-size:10px" onclick="window._proposeWithhold('${e._id}','${e.poId||''}')">Propose Withhold</button>
          <button class="btn-sm" style="font-size:10px;background:#6B7280" onclick="window._markSLADone('${e._id}')">Mark Resolved</button>
        </div>`:''}
      </div>`;
    }).join(''):'<div class="empty" style="padding:1rem">No open SLA events.</div>'}
  </div>

  ${proposed.length?`<div class="card" style="border:1px solid #fcd34d"><div class="card-title">Monetary Withhold Proposals (${proposed.length})</div>
    ${proposed.map(e=>`<div class="withhold-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><div style="font-size:12px;font-weight:700">${e.poId||'—'} · ${JOB_STAGE_LABELS[e.stage]||e.stage}</div>
          <div style="font-size:11px;color:var(--muted)">Responsible: ${e.assignedTo||'—'} · Delay: ${e.missedByMinutes||0} min</div>
          ${e.delayReasonText?`<div style="font-size:11px;margin-top:3px">"${e.delayReasonText}"</div>`:''}
        </div>
        <div style="text-align:right"><div style="font-size:16px;font-weight:800;color:#111">Rs. ${e.monetaryWithholdSuggested||0}</div><div style="font-size:10px;color:var(--muted)">Proposed</div></div>
      </div>
      ${isObserver()?`<div style="display:flex;gap:6px;margin-top:8px">
        <input id="wh-amt-${e._id}" type="number" value="${e.monetaryWithholdSuggested||0}" style="width:80px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none">
        <button class="btn-sm" style="background:var(--green);font-size:11px" onclick="window._approveWithhold('${e._id}')">Approve</button>
        <button class="btn-sm" style="background:#6B7280;font-size:11px" onclick="window._waiveWithhold('${e._id}')">Waive</button>
      </div>`:''}
    </div>`).join('')}
  </div>`:''}`;
}

window._proposeWithhold=async function(slaId,poNum){
  const amt=prompt('Suggested withhold amount (Rs.):'); if(!amt||isNaN(amt))return;
  try{
    await updateDoc(doc(db,'sla_events',slaId),{monetaryWithholdSuggested:parseFloat(amt),missedByMinutes:Math.round((Date.now()-new Date(allSLAEvents.find(e=>e._id===slaId)?.dueAt).getTime())/60000)});
    const ev=allSLAEvents.find(e=>e._id===slaId); if(ev)ev.monetaryWithholdSuggested=parseFloat(amt);
    showToast('Withhold proposed — Rs.'+amt); window._towerTab('sla');
  }catch(e){showToast('Error: '+e.message,true);}
};
window._approveWithhold=async function(slaId){
  const amtEl=document.getElementById('wh-amt-'+slaId);
  const amt=parseFloat(amtEl?.value)||0;
  try{
    await updateDoc(doc(db,'sla_events',slaId),{monetaryWithholdApproved:amt,approvedBy:session.name,status:'completed',completedAt:nowIso()});
    const ev=allSLAEvents.find(e=>e._id===slaId); if(ev){ev.monetaryWithholdApproved=amt;ev.approvedBy=session.name;}
    // Reflect on billing if job linked
    const ev2=allSLAEvents.find(e=>e._id===slaId);
    if(ev2?.printingJobId){const b=allPrintBilling.find(x=>x.printingJobId===ev2.printingJobId);if(b){b.monetaryWithhold=(b.monetaryWithhold||0)+amt;b.netPayable=(b.netPayable||0)-amt;}}
    await logActivity('Withhold approved','Rs.'+amt+' — '+slaId);
    showToast('Withhold approved Rs.'+amt+' ✓'); window._towerTab('sla');
  }catch(e){showToast('Error: '+e.message,true);}
};
window._waiveWithhold=async function(slaId){
  try{
    await updateDoc(doc(db,'sla_events',slaId),{monetaryWithholdSuggested:0,status:'completed',completedAt:nowIso()});
    const ev=allSLAEvents.find(e=>e._id===slaId); if(ev){ev.monetaryWithholdSuggested=0;}
    showToast('Withhold waived'); window._towerTab('sla');
  }catch(e){showToast('Error: '+e.message,true);}
};
window._markSLADone=async function(slaId){
  try{
    await updateDoc(doc(db,'sla_events',slaId),{status:'completed',completedAt:nowIso()});
    const ev=allSLAEvents.find(e=>e._id===slaId); if(ev)ev.completedAt=nowIso();
    showToast('SLA marked resolved'); window._towerTab('sla');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Billing Overview ──────────────────────────────────────────────────
function renderTowerBilling(){
  const totalGross=allPrintBilling.reduce((s,b)=>s+(b.grossBill||0),0);
  const totalNet=allPrintBilling.reduce((s,b)=>s+(b.netPayable||0),0);
  const totalApproved=allPrintBilling.filter(b=>b.status==='approved').reduce((s,b)=>s+(b.netPayable||0),0);
  const pending=allPrintBilling.filter(b=>['ready','pending_approval'].includes(b.status));

  return`<div class="stats-row" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));margin-bottom:16px">
    ${[['Total Gross',`Rs. ${Math.round(totalGross).toLocaleString()}`],['Net Payable',`Rs. ${Math.round(totalNet).toLocaleString()}`],['Approved',`Rs. ${Math.round(totalApproved).toLocaleString()}`],['Pending',pending.length+' bills']].map(([l,v])=>`<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-val" style="font-size:18px">${v}</div></div>`).join('')}
  </div>

  <div class="card"><div class="card-title">All Billing Records</div>
    ${allPrintBilling.length?allPrintBilling.map(b=>`<div style="padding:10px 0;border-bottom:1px solid #f5f5f5;cursor:pointer" onclick="window._openBilling('${b._id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
        <div><div style="font-size:12px;font-weight:700">${b.poNumber||'—'} — ${b.articleCode||'—'}</div>
          <div style="font-size:11px;color:var(--muted)">${processBadge(b.processType)} · ${b.finalApprovedQty||0} pcs approved</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:15px;font-weight:700">Rs. ${Math.round(b.netPayable||0).toLocaleString()}</div>
          <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:${b.status==='disputed'?'#111':'#f0f0f0'};color:${b.status==='disputed'?'#fff':'#111'}">${(b.status||'').replace('_',' ').toUpperCase()}</span>
        </div>
      </div>
    </div>`).join(''):'<div class="empty">No billing records yet.</div>'}
  </div>`;
}
window._openBilling=function(billingId){
  const b=allPrintBilling.find(x=>x._id===billingId); if(!b)return;
  viewingPrintJob=b.printingJobId;
  currentPage='billing-detail';
  renderBillingDetailPage();
};

// ── Recipes Overview ──────────────────────────────────────────────────
function renderTowerRecipes(){
  const locked=allRecipes.filter(r=>r.status==='locked');
  const draft=allRecipes.filter(r=>r.status==='draft');
  const missing=allPrintingJobs.filter(j=>j.recipeWarning&&j.currentStage!=='closed');
  return`<div class="stats-row" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
    <div class="stat-card"><div class="stat-label">Total Recipes</div><div class="stat-val">${allRecipes.length}</div></div>
    <div class="stat-card"><div class="stat-label">Locked 🔒</div><div class="stat-val">${locked.length}</div></div>
    <div class="stat-card"><div class="stat-label">Draft ✏️</div><div class="stat-val">${draft.length}</div></div>
    <div class="stat-card"><div class="stat-label">Jobs No Recipe</div><div class="stat-val">${missing.length}</div></div>
  </div>
  ${missing.length?`<div class="card" style="border:1px solid #fca5a5"><div class="card-title" style="color:#dc2626">⚠ Jobs with Missing Recipe</div>
    ${missing.map(j=>`<div class="info-row"><span style="font-weight:600">${j.poNumber} — ${j.articleCode||'No code'}</span><button class="btn-sm" onclick="window.showPage('recipe-create')">Create Recipe</button></div>`).join('')}
  </div>`:''}
  <div class="card"><div class="card-title">All Recipes</div>
    ${allRecipes.slice(0,20).map(r=>recipeCardHTML(r)).join('')||'<div class="empty">No recipes.</div>'}
  </div>`;
}

// ── Communications Overview ───────────────────────────────────────────
function renderTowerComms(){
  const recent=allCommNotes.slice(0,30);
  const pings=allCommNotes.filter(n=>n.type==='ping'&&!(n.readBy||[]).includes(session.u));
  return`${pings.length?`<div class="card" style="border:1px solid #7dd3fc"><div class="card-title">🔔 Unread Pings (${pings.length})</div>
    ${pings.map(n=>`<div class="comm-note comm-ping">
      <div style="font-size:12px;font-weight:700">${n.fromUser||'—'} → ${n.toUser||n.toRole||'All'}</div>
      <div style="font-size:13px;margin-top:3px">${n.message||'—'}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px">${tsLabel2(n.createdAt)}</div>
    </div>`).join('')}
  </div>`:''}
  <div class="card"><div class="card-title">All Communications (last 30)</div>
    ${recent.length?recent.map(n=>`<div class="comm-note ${n.type==='ping'?'comm-ping':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="font-size:11px;font-weight:700;color:var(--dark)">${n.fromUser||'—'} ${n.toUser?'→ '+n.toUser:''}</div>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:6px;background:#f0f0f0">${(n.type||'text').toUpperCase()}</span>
          <span style="font-size:10px;color:var(--muted)">${tsLabel2(n.createdAt)}</span>
        </div>
      </div>
      ${n.linkedId?`<div style="font-size:10px;color:var(--muted);margin:1px 0">Job: ${allPrintingJobs.find(j=>j._id===n.linkedId)?.poNumber||n.linkedId}</div>`:''}
      <div style="font-size:13px;margin-top:4px">${n.message||'—'}</div>
    </div>`).join(''):'<div class="empty">No communications yet.</div>'}
  </div>`;
}

// ── SLA update helper when advancing stages ───────────────────────────
async function updateJobSLA(jobId,newStage,priority){
  const dueAt=calcDue(newStage,priority);
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{slaCurrentDue:dueAt,updatedAt:nowIso()});
    const ji=allPrintingJobs.findIndex(j=>j._id===jobId);
    if(ji>=0)allPrintingJobs[ji].slaCurrentDue=dueAt;
  }catch(_){}
}

// ════════════════════════════════════════════════════════════════════
// CHUNK 5 — HANDOFF FLOW · VENDOR JOB CARD · MY-WORK INTEGRATION
//            REWORK RETURN FLOW · FINAL POLISH
// ════════════════════════════════════════════════════════════════════

// ── Zohaib: Accept lot from QC Bundling ──────────────────────────────
window.acceptByZohaib=async function(jobId){
  if(!isBundleWorker()&&!isObserver()){showToast('Bundling team only.',true);return;}
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const now=nowIso();
  const history=[...(j.stageHistory||[]),{stage:'qc_bundling',by:session.name,at:now,note:'Lot accepted by '+session.name+' for bundling'}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{
      'handoff.acceptedByZohaibAt':now,
      stageHistory:history,updatedAt:now
    });
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0){allPrintingJobs[ji]={...allPrintingJobs[ji],stageHistory:history};allPrintingJobs[ji].handoff={...allPrintingJobs[ji].handoff,acceptedByZohaibAt:now};}
    await logActivity('Lot accepted for bundling',j.poNumber+' — '+session.name);
    showToast('Lot accepted / لاٹ قبول کر لیا ✓');
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Zohaib: Forward bundled lot to Stitching ─────────────────────────
window.forwardToStitching=async function(jobId){
  if(!isBundleWorker()&&!isObserver()){showToast('Bundling team only.',true);return;}
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const bundleCount=parseInt(document.getElementById('bundle-count-'+jobId)?.value)||0;
  const notes=(document.getElementById('bundle-notes-'+jobId)?.value||'').trim();
  const now=nowIso();
  const history=[...(j.stageHistory||[]),{stage:'stitching',by:session.name,at:now,note:`Forwarded to stitching — ${bundleCount} bundles. ${notes}`}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{
      currentStage:'stitching',
      'handoff.forwardedToStitchingBy':session.name,
      'handoff.forwardedToStitchingAt':now,
      bundleCount,bundleNotes:notes,
      stageHistory:history,updatedAt:now,
      slaCurrentDue:calcDue('stitching',j.priority)
    });
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],currentStage:'stitching',stageHistory:history,slaCurrentDue:calcDue('stitching',j.priority)};
    await addSLAEvent(jobId,j.poNumber,'stitching',j.priority,'waqas',calcDue('stitching',j.priority));
    await logActivity('Forwarded to stitching',`${j.poNumber} — ${bundleCount} bundles`);
    showToast('Forwarded to stitching / سلائی کو بھیج دیا ✓');
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Waqas: Accept stitching lot ───────────────────────────────────────
window.acceptByWaqas=async function(jobId){
  if(!isStitchWorker()&&!isObserver()){showToast('Stitching team only.',true);return;}
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const now=nowIso();
  const history=[...(j.stageHistory||[]),{stage:'stitching',by:session.name,at:now,note:'Stitching accepted by '+session.name}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{
      'handoff.acceptedByWaqasAt':now,
      stageHistory:history,updatedAt:now
    });
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0){allPrintingJobs[ji].stageHistory=history;if(!allPrintingJobs[ji].handoff)allPrintingJobs[ji].handoff={};allPrintingJobs[ji].handoff.acceptedByWaqasAt=now;}
    await logActivity('Stitching accepted',j.poNumber+' — '+session.name);
    showToast('Stitching accepted / سلائی قبول کر لی ✓');
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Waqas: Complete stitching, return to Final QC ─────────────────────
window.completeStitching=async function(jobId){
  if(!isStitchWorker()&&!isObserver()){showToast('Stitching team only.',true);return;}
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const notes=(document.getElementById('stitch-notes-'+jobId)?.value||'').trim();
  const now=nowIso();
  const history=[...(j.stageHistory||[]),{stage:'final_qc_post_stitch',by:session.name,at:now,note:'Stitching complete — forwarded to Final QC. '+notes}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{
      currentStage:'final_qc_post_stitch',
      'handoff.stitchingForwardedToQcAt':now,
      stitchingNotes:notes,
      stageHistory:history,updatedAt:now,
      slaCurrentDue:calcDue('final_qc',j.priority)
    });
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],currentStage:'final_qc_post_stitch',stageHistory:history};
    await addSLAEvent(jobId,j.poNumber,'final_qc',j.priority,'haris',calcDue('final_qc',j.priority));
    await logActivity('Stitching complete — returned to QC',j.poNumber);
    showToast('Stitching complete / فائنل QC کو بھیج دیا ✓');
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Rework return: QC logs rework pass/fail after return ──────────────
window.recordReworkReturn=async function(jobId){
  if(!isQCWorker()&&!isObserver()){showToast('QC only.',true);return;}
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const passed=parseInt(prompt('Rework PASSED quantity:')||'0');
  const failed=parseInt(prompt('Rework FAILED/rejected quantity:')||'0');
  if(passed+failed===0){showToast('Enter quantities.',true);return;}
  const now=nowIso();
  // Update QC report rework fields
  const rep=allQCReports.find(r=>r.printingJobId===jobId);
  if(rep){
    try{
      await updateDoc(doc(db,'qc_reports',rep._id),{
        'rework.returnedQty':passed+failed,
        'rework.passedAfterRework':passed,
        'rework.rejectedAfterRework':failed,
        'final.totalCleared':(rep.final?.totalCleared||0)+passed,
        'final.totalRejected':(rep.final?.totalRejected||0)+failed,
        'final.billingApprovedQty':(rep.final?.billingApprovedQty||0)+passed,
        updatedAt:now
      });
      // Update billing
      const b=allPrintBilling.find(x=>x.printingJobId===jobId);
      if(b){
        const newFinal=(b.finalApprovedQty||0)+passed;
        const newGross=newFinal*(b.ratePerPiece||0);
        await updateDoc(doc(db,'printing_billing',b._id),{
          reworkPassedQty:(b.reworkPassedQty||0)+passed,
          finalApprovedQty:newFinal,
          grossBill:newGross,
          netPayable:newGross-(b.materialCostImpact||0)-(b.monetaryWithhold||0),
          updatedAt:now
        });
        b.reworkPassedQty=(b.reworkPassedQty||0)+passed;b.finalApprovedQty=newFinal;b.grossBill=newGross;
      }
    }catch(_){}
  }
  // Advance to qc_bundling if any passed
  const nextStage=passed>0?'qc_bundling':'closed';
  const history=[...(j.stageHistory||[]),{stage:nextStage,by:session.name,at:now,note:`Rework return: ${passed} passed, ${failed} rejected`}];
  try{
    await updateDoc(doc(db,'printing_jobs',jobId),{currentStage:nextStage,stageHistory:history,updatedAt:now});
    const ji=allPrintingJobs.findIndex(x=>x._id===jobId);
    if(ji>=0)allPrintingJobs[ji]={...allPrintingJobs[ji],currentStage:nextStage,stageHistory:history};
    await logActivity('Rework returned',`${j.poNumber} — ${passed} passed, ${failed} rejected`);
    showToast(`Rework recorded: ${passed} passed ✓`);
    window.showPage('printing-jobs');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Vendor Job Card (printable) ───────────────────────────────────────
window.printVendorJobCard=function(jobId){
  const j=allPrintingJobs.find(x=>x._id===jobId); if(!j)return;
  const recipe=allRecipes.find(r=>r._id===j.recipeId);
  const pt=recipe?.printing||{};
  const sizes=j.sizeBreakdown||{};
  const qr='VJC-'+j.poNumber+'-'+jobId.slice(0,6).toUpperCase();
  const sizeTable=Object.entries(sizes).filter(([,v])=>v>0).map(([k,v])=>`<td style="text-align:center;padding:6px 10px;border:1px solid #ddd">${k}<br><strong>${v}</strong></td>`).join('');

  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Vendor Job Card — ${j.poNumber}</title>
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter','Segoe UI',sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#1A1A2E}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #E94560;padding-bottom:16px;margin-bottom:20px}
  .logo{font-size:22px;font-weight:800;color:#1A1A2E}.logo span{color:#E94560}
  .qr-box{text-align:right;font-size:12px;color:#6B7280;font-weight:700}
  .section{margin-bottom:16px;border:1px solid #E5E5E7;border-radius:8px;padding:14px}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#6B7280;margin-bottom:10px}
  .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f5f5f5;font-size:13px}
  .row:last-child{border-bottom:none}
  .label{color:#6B7280;font-weight:500}.val{font-weight:600}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th{background:#1A1A2E;color:rgba(255,255,255,.7);padding:8px 10px;font-size:10px;font-weight:600;text-align:left}
  td{padding:6px 10px;border:1px solid #eee}
  .banner{background:#1A1A2E;color:#fff;padding:12px 16px;border-radius:8px;margin-top:16px;font-size:12px;line-height:1.8}
  .footer{margin-top:24px;border-top:1px solid #E5E5E7;padding-top:12px;font-size:11px;color:#6B7280;display:flex;justify-content:space-between}
  @media print{.no-print{display:none}body{margin:0;padding:16px}}</style></head><body>

  <div class="header">
    <div><div class="logo">Groovy <span>Operations</span></div>
      <div style="font-size:12px;color:#6B7280;margin-top:4px">Internal ERP — Vendor Job Card</div>
    </div>
    <div class="qr-box">
      <div style="font-size:18px;font-weight:900;color:#E94560">${j.poNumber}</div>
      <div style="margin-top:4px">${qr}</div>
      <div>${new Date().toLocaleDateString('en-GB')}</div>
    </div>
  </div>

  <div class="section"><div class="section-title">Job Information</div>
    <div class="row"><span class="label">Article Code</span><span class="val">${j.articleCode||'—'}</span></div>
    <div class="row"><span class="label">Article Name</span><span class="val">${j.articleName||'—'}</span></div>
    <div class="row"><span class="label">Process Type</span><span class="val">${PROCESS_TYPES[j.processType]?.label||j.processType}</span></div>
    <div class="row"><span class="label">Complexity Tier</span><span class="val">${TIER_INFO[j.complexityTier||1]?.label||'—'}</span></div>
    <div class="row"><span class="label">Total Quantity</span><span class="val">${j.totalQty||'—'} pcs</span></div>
    <div class="row"><span class="label">Priority</span><span class="val">${(j.priority||'normal').toUpperCase()}</span></div>
    <div class="row"><span class="label">Vendor</span><span class="val">${j.vendorName||'In-house'}</span></div>
    <div class="row"><span class="label">Job Reference</span><span class="val">${qr}</span></div>
    <div class="row"><span class="label">Issue Date</span><span class="val">${new Date().toLocaleDateString('en-GB')}</span></div>
  </div>

  <div class="section"><div class="section-title">Size Breakdown</div>
    <table><tr>${sizeTable||'<td colspan="6" style="text-align:center;color:#6B7280">No size breakdown set</td>'}</tr></table>
  </div>

  ${(pt.placements||[]).length?`<div class="section"><div class="section-title">Placements (${pt.placements.length})</div>
    ${pt.placements.map((pl,i)=>`<div class="row"><span class="label">${i+1}. ${pl.name||'—'}</span><span class="val">${pl.measurementText||pl.measurementDescriptionEn||pl.placementMeasurement||'—'} · tol: ${pl.toleranceValue||pl.tolerance||'—'}</span></div>${(pl.production?.visibleInstructionEn||pl.notesEn)?`<div style="font-size:11px;color:#6B7280;padding:3px 0">${pl.production?.visibleInstructionEn||pl.notesEn}</div>`:''}`).join('')}
  </div>`:''}

  ${(pt.pantones||[]).length?`<div class="section"><div class="section-title">Colors / Pantones</div>
    <table><thead><tr><th>Color Name</th><th>Pantone Code</th><th>Local Ink</th><th>Usage</th><th>Notes</th></tr></thead>
    <tbody>${pt.pantones.map(p=>`<tr><td>${p.colorName||'—'}</td><td>${p.pantoneCode||'—'}</td><td>${p.localInkName||'—'}</td><td>${p.usage||'—'}</td><td>${p.articleSpecificNotes||p.notes||'—'}</td></tr>`).join('')}</tbody></table>
  </div>`:''}

  ${pt.instructionsEn?`<div class="section"><div class="section-title">Instructions</div><div style="font-size:13px;line-height:1.8">${pt.instructionsEn}</div>
    ${pt.instructionsUr?`<div style="direction:rtl;text-align:right;font-size:14px;line-height:2;margin-top:8px;border-top:1px solid #f5f5f5;padding-top:8px">${pt.instructionsUr}</div>`:''}</div>`:''}

  <div class="banner">
    <strong>Important:</strong> This job card must accompany the lot at all times.<br>
    Vendor is responsible for following all placement, color, and process specifications.<br>
    All pieces must be returned with this job card attached. Gate pass required for entry/exit.
  </div>

  <div class="footer">
    <span>Authorized by: ${session.name} — ${session.title}</span>
    <span>Groovy Operations ERP · ${new Date().toLocaleString('en-GB')}</span>
  </div>

  <div style="margin-top:16px;border:2px dashed #E5E5E7;border-radius:8px;padding:14px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#6B7280;margin-bottom:8px">VENDOR ACKNOWLEDGEMENT</div>
    <div style="display:flex;gap:40px">
      <div><div style="font-size:11px;color:#6B7280">Received by (Vendor)</div><div style="border-bottom:1px solid #1A1A2E;width:160px;height:28px;margin-top:8px"></div></div>
      <div><div style="font-size:11px;color:#6B7280">Date</div><div style="border-bottom:1px solid #1A1A2E;width:120px;height:28px;margin-top:8px"></div></div>
      <div><div style="font-size:11px;color:#6B7280">Stamp</div><div style="border:1px dashed #ddd;width:80px;height:60px;margin-top:4px;border-radius:4px"></div></div>
    </div>
  </div>

  <div class="no-print" style="margin-top:16px;text-align:center">
    <button onclick="window.print()" style="padding:10px 24px;background:#1A1A2E;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-family:inherit">Print Job Card 🖨️</button>
  </div>
  </body></html>`);
  win.document.close();
};

// ── My Work: unified for all roles including printing workers ─────────
function renderMyWork(){
  // Worker HRM widget — shown above all worker content. Triggers HRM load if not yet loaded.
  if(session.role==='worker'&&!hrmDataLoaded&&typeof loadHRMData==='function'){
    loadHRMData().then(()=>{ if(currentPage==='my-work'){const m=document.getElementById('main-content');if(m){m.innerHTML=renderMyWork();if(typeof _populateWorkerHRMWidget==='function')setTimeout(_populateWorkerHRMWidget,0);} } });
  }
  const hrmHeader=session.role==='worker'&&session.u!=='asghar'&&typeof renderWorkerHRMWidget==='function'?renderWorkerHRMWidget():'';
  return hrmHeader+_renderMyWorkInner();
}
function _renderMyWorkInner(){
  const stages=session.stages||[];
  const base='';

  // Asghar: printing jobs
  if(isPrintWorker()){
    if(!printingDataLoaded){loadPrintingData().then(()=>{const m=document.getElementById('main-content');if(m&&currentPage==='my-work')m.innerHTML=renderMyWork();});}
    const myJobs=allPrintingJobs.filter(j=>j.assignedTo===session.u&&j.currentStage!=='closed');
    if(!myJobs.length)return base||'<div class="empty">No orders in your queue right now.</div>';
    return`<div class="page-head"><div class="page-title">Printing Work / پرنٹنگ کام</div><div class="page-sub" style="direction:rtl;text-align:right;font-size:14px">اسغر کا پرنٹنگ کام · ${myJobs.length} کام باقی ہے</div></div>
    ${myJobs.map(j=>printWorkerCardHTML(j)).join('')}`;
  }

  // Zohaib: bundling tasks
  if(isBundleWorker()){
    if(!printingDataLoaded){loadPrintingData().then(()=>{const m=document.getElementById('main-content');if(m&&currentPage==='my-work')m.innerHTML=renderMyWork();});}
    const myJobs=allPrintingJobs.filter(j=>j.currentStage==='qc_bundling');
    if(myJobs.length){
      return`<div class="page-head"><div class="page-title">My Work</div><div class="page-sub">${myJobs.length} bundling task${myJobs.length!==1?'s':''}</div></div>
      ${myJobs.map(j=>bundlingWorkerCardHTML(j)).join('')}`;
    }
  }

  // Waqas: stitching tasks
  if(isStitchWorker()){
    if(!printingDataLoaded){loadPrintingData().then(()=>{const m=document.getElementById('main-content');if(m&&currentPage==='my-work')m.innerHTML=renderMyWork();});}
    const myJobs=allPrintingJobs.filter(j=>j.currentStage==='stitching');
    if(myJobs.length){
      return`<div class="page-head"><div class="page-title">My Work</div><div class="page-sub">${myJobs.length} stitching task${myJobs.length!==1?'s':''}</div></div>
      ${myJobs.map(j=>stitchingWorkerCardHTML(j)).join('')}`;
    }
  }

  // Haris: QC reports needed
  if(isQCWorker()){
    if(!printingDataLoaded){loadPrintingData().then(()=>{const m=document.getElementById('main-content');if(m&&currentPage==='my-work')m.innerHTML=renderMyWork();});}
    const qcJobs=allPrintingJobs.filter(j=>['final_qc','rework','final_qc_post_stitch'].includes(j.currentStage));
    const ppJobs=allPrintingJobs.filter(j=>j.currentStage==='pp_approval'&&j.ppApprovalStatus==='pending');
    const hasExtra=qcJobs.length||ppJobs.length;
    if(hasExtra){
      const baseContent=base||'';
      return`${baseContent}<div class="page-head" style="margin-top:16px"><div class="page-title">Printing QC Queue</div><div class="page-sub">${ppJobs.length} PP pending · ${qcJobs.length} lot QC pending</div></div>
      ${ppJobs.map(j=>`<div class="work-card">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><span class="po-num">${j.poNumber||'—'}</span><span style="font-size:10px;font-weight:700;color:#111;background:#f0f0f0;padding:2px 7px;border-radius:8px">AWAITING PP APPROVAL</span></div>
        <div style="font-size:14px;font-weight:600">${j.articleCode||'—'} — ${j.articleName||'—'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${j.totalQty||'?'} pcs · ${j.ppMode==='repeat_article'?'Repeat Article (QC can approve)':'New Article (needs owner)'}</div>
        <button class="mark-done-btn" style="width:auto;padding:8px 16px;margin-top:8px" onclick="window.openPrintingJob('${j._id}')">Review PP Sample</button>
      </div>`).join('')}
      ${qcJobs.map(j=>`<div class="work-card">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><span class="po-num">${j.poNumber||'—'}</span><span style="font-size:10px;font-weight:700;color:#111;background:#EFEFEF;padding:2px 7px;border-radius:8px">QC REQUIRED</span></div>
        <div style="font-size:14px;font-weight:600">${j.articleCode||'—'} — ${j.articleName||'—'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${j.printedQty||j.totalQty||'?'} pcs received</div>
        <button class="mark-done-btn" style="width:auto;padding:8px 16px;margin-top:8px" onclick="window.openQCReport('${j._id}')">Enter QC Report</button>
      </div>`).join('')}`;
    }
  }

  // Default: run original
  if(stages.length){
    const myPOs=allPOs.filter(p=>stages.includes(p.currentStage));
    const stageLabel={cutting:'Enter Cut Data',bundling:'Mark Bundles',stitching:'Mark Stitched',printing:'Mark Complete',washing:'Mark Complete',qc:'Perform QC'};
    return`<div class="page-head"><div class="page-title">My Work</div><div class="page-sub">${myPOs.length} order${myPOs.length!==1?'s':''} in your queue</div></div>
    ${myPOs.map(p=>`<div class="work-card">
      <div style="display:flex;gap:14px;align-items:flex-start">
        <div style="width:80px;height:104px;flex-shrink:0;background:#f0f0f0;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="window.openPODetail('${p.fbKey}')">
          ${p.imgFront?`<img src="${p.imgFront}" style="width:100%;height:100%;object-fit:cover">`:'<span style="font-size:10px;color:#aaa;text-align:center;padding:4px">No image</span>'}
        </div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span class="po-num">${p.id}</span>
            <span class="stage-badge" style="background:#f0f0f0;color:#111">${STAGES.find(s=>s.key===p.currentStage)?.label||p.currentStage}</span></div>
          <div style="font-size:15px;font-weight:700;margin-bottom:3px">${p.name||'—'}</div>
          <div style="font-size:12px;color:var(--muted)">${p.qty||'?'} pcs · ${p.fabric||''}</div>
          <button class="mark-done-btn" style="background:${p.currentStage==='cutting'||p.currentStage==='bundling'||p.currentStage==='stitching'||p.currentStage==='qc'?'var(--dark)':'var(--green)'}" onclick="window.openStageWork('${p.fbKey}','${p.currentStage}')">${stageLabel[p.currentStage]||'Mark Done'}</button>
        </div>
      </div>
    </div>`).join('')||'<div class="empty">No orders in your queue right now.<br>You\'re all caught up!</div>'}`;
  }
  const active=allPOs.filter(p=>p.currentStage!=='completed');
  return`<div class="page-head"><div class="page-title">All Active Orders</div><div class="page-sub">${active.length} in progress</div></div>${active.map(p=>poRowHTML(p)).join('')||'<div class="empty">No active orders.</div>'}`;
}

// ── Printing nav active state helper (called from showPage) ───────────

// ── Quick access: open rework return from job detail ──────────────────
window.openReworkReturn=function(jobId){ viewingPrintJob=jobId; window.recordReworkReturn(jobId); };

// ── Dashboard ──
function renderDashboard(){
  const total=allPOs.length,active=allPOs.filter(p=>p.currentStage&&p.currentStage!=='completed').length,done=allPOs.filter(p=>p.currentStage==='completed').length,todayCount=allPOs.filter(p=>p.createdAt===new Date().toISOString().slice(0,10)).length;

  // Embellishment job counts
  const ALL_EMB=['po_received','pp_sample','pp_approval','bulk_printing','final_qc','rework','qc_bundling','stitching','final_qc_post_stitch'];
  const EMB_EXEC=['po_received','pp_sample','bulk_printing']; // active execution, not in QC gate
  const EMB_QC  =['pp_approval','final_qc','rework','final_qc_post_stitch'];
  const activeJobs=isObserver()?allPrintingJobs.filter(j=>ALL_EMB.includes(j.currentStage)):[];
  const embExecCount=activeJobs.filter(j=>EMB_EXEC.includes(j.currentStage)).length;
  const embQCCount  =activeJobs.filter(j=>EMB_QC.includes(j.currentStage)).length;
  const inPrinting  =activeJobs.filter(j=>['rubber','plastisol','puff'].includes(j.processType)||j.departmentType==='inhouse_printing').length;
  const inSubl      =activeJobs.filter(j=>j.processType==='sublimation'||j.departmentType==='external_sublimation').length;
  const inEmbr      =activeJobs.filter(j=>j.processType==='embroidery'||j.departmentType==='external_embroidery').length;
  const inRework    =activeJobs.filter(j=>j.currentStage==='rework').length;
  const overdue     =activeJobs.filter(j=>j.slaCurrentDue&&['over','critical'].includes(slaStatus(j.slaCurrentDue))).length;
  const hasAlert    =overdue>0||inRework>0||activeJobs.some(j=>j.priority==='urgent'&&['near','over','critical'].includes(slaStatus(j.slaCurrentDue||null)));

  // ── Stage overview with correct production order ──
  // Cutting → Embellishments → Embellishment QC → Bundling → Stitching → Washing → Final QC
  function stageCard(label,count,color,flagged,alert){
    const borderStyle=alert?`border:2px solid #111`:`border:1px solid var(--border)`;
    return`<div style="flex:1;min-width:0;padding:10px 8px;background:#fff;${borderStyle};border-radius:8px;text-align:center">
      <div style="font-size:16px;font-weight:700;color:#111">${count}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px;word-break:break-word;overflow-wrap:break-word;line-height:1.3">${label}</div>
      ${flagged?`<div style="font-size:9px;color:#dc2626;font-weight:700;margin-top:2px">⚠ ${flagged} flagged</div>`:''}
    </div>`;
  }
  // PO-based stages
  const poByStage=k=>allPOs.filter(p=>p.currentStage===k);
  const stageCards=[
    stageCard('Cutting',      poByStage('cutting').length,  '#185FA5', poByStage('cutting').filter(p=>p.damageFlagged).length, false),
    ...(isObserver()?[
      stageCard('Embellishments', embExecCount, '#854F0B', 0, hasAlert&&embExecCount>0),
      stageCard('Embellishment QC', embQCCount, '#D97706', 0, embQCCount>0&&(overdue>0||inRework>0)),
    ]:[stageCard('Embellishment QC', poByStage('printing').length, '#854F0B', 0, false)]),
    stageCard('Bundling',     poByStage('bundling').length,  '#534AB7', 0, false),
    stageCard('Stitching',    poByStage('stitching').length, '#0F6E56', 0, false),
    stageCard('Washing',      poByStage('washing').length,   '#72243E', 0, false),
    stageCard('Final QC',     poByStage('qc').length,        '#3B6D11', 0, false),
  ].join('');

  // ── Collapsible Embellishments Overview (observers only) ──
  const embSummaryText=`${activeJobs.length} active · ${embQCCount} QC · ${overdue} overdue`;
  const embDefaultOpen=activeJobs.length>0;
  const embOverviewSection=isObserver()?`
  <div style="margin-bottom:16px;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;cursor:pointer" onclick="window._toggleEmbOverview()">
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Embellishments Overview</div>
        <div style="font-size:12px;color:var(--dark);margin-top:1px">${embSummaryText}</div>
      </div>
      <span id="emb-ov-arrow" style="font-size:12px;color:var(--muted);transition:transform .2s">${embDefaultOpen?'▾':'▸'}</span>
    </div>
    <div id="emb-ov-body" style="overflow:hidden;transition:max-height .25s;max-height:${embDefaultOpen?'200px':'0'};border-top:${embDefaultOpen?'1px solid var(--border)':'none'}">
      <div style="display:flex;gap:6px;flex-wrap:wrap;padding:12px 14px">
        ${[['Printing',inPrinting,'#111'],['Sublimation',inSubl,'#111'],['Embroidery',inEmbr,'#111'],['Rework Pending',inRework,'#111'],['Overdue',overdue,overdue>0?'#000':'var(--muted)']].map(([label,val,color])=>`<div style="flex:1;min-width:0;padding:9px 8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;text-align:center"><div style="font-size:16px;font-weight:700;color:${color}">${val}</div><div style="font-size:10px;color:var(--muted);margin-top:2px">${label}</div></div>`).join('')}
      </div>
    </div>
  </div>`:'';

  const hrmBanner=(typeof renderHRMDashboardWidget==='function')?renderHRMDashboardWidget():'';
  const base=`${hrmBanner}<div class="stats-row">
    <div class="stat-card"><div class="stat-label">Total POs</div><div class="stat-val">${total}</div></div>
    <div class="stat-card"><div class="stat-label">Active</div><div class="stat-val">${active}</div></div>
    <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-val">${done}</div></div>
    <div class="stat-card"><div class="stat-label">Today</div><div class="stat-val">${todayCount}</div></div>
  </div>
  <div style="margin-bottom:16px">
    <div class="section-title">Stage overview</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${stageCards}</div>
  </div>
  ${embOverviewSection}`;

  if(!isObserver()){
    return base+`<div class="section-title">Recent production orders</div>${allPOs.slice(0,10).map(p=>poRowHTML(p)).join('')||'<div class="empty">No POs yet.</div>'}`;
  }

  // ── Quick View (up to 5 jobs) ──
  function embJobNextAction(j){
    const m={'po_received':'Submit PP Sample','pp_sample':'Awaiting Approval','pp_approval':'Approve / Reject PP Sample','bulk_printing':'Mark Bulk Printing Complete','final_qc':'Enter QC Report','rework':'Complete Rework','qc_bundling':'Accept Handoff (Zohaib)','stitching':'Complete Stitching','final_qc_post_stitch':'Final QC Review'};
    return m[j.currentStage]||j.currentStage;
  }
  function holderLabel(j){
    if(j.currentStage==='pp_approval')return'Haris (QC)';
    if(j.currentStage==='qc_bundling')return j.handoff?.acceptedByZohaibAt?'Zohaib':'Pending Zohaib';
    if(j.currentStage==='stitching')return j.handoff?.acceptedByWaqasAt?'Waqas':'Pending Waqas';
    if(['final_qc','rework','final_qc_post_stitch'].includes(j.currentStage))return'Haris (QC)';
    return j.vendorName||j.assignedTo||'Asghar';
  }
  const qvJobs=activeJobs.slice(0,5);
  const jobRows=qvJobs.length?qvJobs.map(j=>{
    const sl=slaStatus(j.slaCurrentDue||null);
    const slaBg={ok:'#EFEFEF',near:'#f0f0f0',over:'#fee2e2',critical:'#fecaca'}[sl]||'#f4f4f6';
    const slaFg={ok:'var(--green)',near:'var(--amber)',over:'#dc2626',critical:'#7f1d1d'}[sl]||'var(--muted)';
    const procInfo=PROCESS_TYPES[j.processType]||{icon:'•',label:j.processType||'—'};
    const po=allPOs.find(p=>p.id===j.poNumber);
    return`<div class="po-row" style="cursor:pointer;align-items:flex-start" onclick="window._openEmbJob('${j._id}')">
      <div class="po-img">${po?.imgFront?`<img src="${po.imgFront}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`:'<span style="font-size:9px;color:#ccc">No img</span>'}</div>
      <div class="po-info" style="min-width:0">
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:2px">
          <span class="po-num">${j.poNumber||'—'}</span>
          <span class="process-badge">${procInfo.label}</span>
          <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;background:${(PRIORITY_COLORS[j.priority]||'#888')+'22'};color:${PRIORITY_COLORS[j.priority]||'#888'}">${(j.priority||'normal').toUpperCase()}</span>
        </div>
        <div class="po-name" style="word-break:break-word;overflow-wrap:break-word">${j.articleCode||'—'} — ${j.articleName||'—'}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.6;word-break:break-word;overflow-wrap:break-word">
          Stage: ${JOB_STAGE_LABELS[j.currentStage]||j.currentStage}<br>
          Holder: ${holderLabel(j)}<br>
          ${j.slaCurrentDue?`SLA: <span style="font-weight:700;color:${slaFg}">${remainLabel(j.slaCurrentDue)}</span><br>`:''}
          Next: ${embJobNextAction(j)}
        </div>
      </div>
      <div class="po-arrow">›</div>
    </div>`;
  }).join(''):'<div class="empty">No active embellishment jobs.</div>';

  return base+`
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
    <div class="section-title" style="margin-bottom:0;word-break:break-word;overflow-wrap:break-word">Embellishments — Quick View</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${activeJobs.length>5?`<button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="window.showPage('printing-jobs')">View all ${activeJobs.length} →</button>`:''}
      <button class="btn-outline" style="font-size:11px;padding:5px 10px" onclick="window.showPage('observer-tower')">Observer Tower →</button>
    </div>
  </div>
  ${jobRows}
  <div class="section-title" style="margin-top:16px">Recent production orders</div>
  ${allPOs.slice(0,10).map(p=>poRowHTML(p)).join('')||'<div class="empty">No POs yet.</div>'}`;
}
window._openEmbJob=function(id){const j=allPrintingJobs.find(x=>x._id===id);if(!j)return;viewingPrintJob=id;currentPage='printing-job-detail';document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('on'));renderPrintingJobDetailPage();};
window._toggleEmbOverview=function(){
  const body=document.getElementById('emb-ov-body');
  const arrow=document.getElementById('emb-ov-arrow');
  if(!body)return;
  const open=body.style.maxHeight!=='0px'&&body.style.maxHeight!=='0';
  body.style.maxHeight=open?'0':'200px';
  body.style.borderTop=open?'none':'1px solid var(--border)';
  if(arrow)arrow.textContent=open?'▸':'▾';
};

// ── Printing data is loaded on demand via showPage override above ─────
// For observers landing on the dashboard, we lazy-load printing data
// so the KPI strip updates shortly after page load.
// This is triggered via the existing loadData callback below.
function _maybeLoadPrintingData(){
  if(session&&isObserver()&&!printingDataLoaded){
    loadPrintingData().then(()=>{
      if(currentPage==='dashboard'){ const m=document.getElementById('main-content'); if(m)m.innerHTML=renderDashboard(); }
    }).catch(()=>{});
  }
}


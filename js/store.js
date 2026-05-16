/* Groovy Operations — store.js
   Plain global JS (NO modules). Loaded via <script src>. Firebase globals
   (db, auth, rtdb, setDoc, doc, collection, query, ...) are provided on
   window by the bootstrap module in index.html before __bootApp() runs.
   Code is byte-identical to the original single-file index.html. */

const INITIAL_ITEMS=[
  // ── NECK LABELS ──
  {code:'NL1',  name:'Groovy Top Label Black',          category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{XXS:424,XS:330,S:452,M:1400,L:572,XL:1880},                                        lowStockThreshold:500},
  {code:'NL2',  name:'Groovy Tops Label Cream',         category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{XS:0,S:4,M:1500,L:3000,XL:2910},                                                   lowStockThreshold:500},
  {code:'NL3',  name:'AAO Tops Label Red',              category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{XS:500,S:600,M:1136,L:1800,XL:1304},                                               lowStockThreshold:500},
  {code:'NL4',  name:'AAO Tops Label Black',            category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{S:3000,M:0,L:0,XL:0},                                                              lowStockThreshold:500},
  {code:'NL5',  name:'CLTRD Tops Label B/W',            category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{XS:4276,S:5680,M:4930,L:6184,XL:11194,XXL:1000},                                  lowStockThreshold:500},
  {code:'NL6',  name:'CLTRD Tops Label Red',            category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{XS:5280,S:7200,M:5560,L:9900,XL:21732,XXL:400},                                   lowStockThreshold:500},
  {code:'NL7',  name:'GRVY Babytee/Woman Cream',        category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{S:0,M:0,L:0,XL:0},                                                                lowStockThreshold:200},
  {code:'NL8',  name:'GRVY Babytee/Woman Black',        category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{S:0,M:0,L:0,XL:0},                                                                lowStockThreshold:200},
  {code:'NL9',  name:'GRVY Shirting Cream Label',       category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{S:340,M:464,L:500,XL:280},                                                        lowStockThreshold:200},
  {code:'NL10', name:'Groovy Outerwear Jacket Black',   category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{S:150,M:400,L:500,XL:308},                                                        lowStockThreshold:500},
  {code:'NL13', name:'Groovy Tops Label V1 Black',      category:'neck_labels',  unit:'pcs', sizeSpecific:false, balance:3000,                                                                              lowStockThreshold:500},
  {code:'NL13-2',name:'GROOVY Oversized Black Canvas',  category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{S:4880,M:4400,L:3660,XL:5520},                                                    lowStockThreshold:500},
  {code:'NL14', name:'GRVY Babytee Black V1',           category:'neck_labels',  unit:'pcs', sizeSpecific:true,  sizes:{XS:2000,S:2800,M:1700,L:2290},                                                    lowStockThreshold:500},
  // ── SLEEVE & HEM LABELS ──
  {code:'SL1',  name:'GRVY BTM Hem Label',              category:'sleeve_labels',unit:'pcs', sizeSpecific:false, balance:4100, lowStockThreshold:500},
  {code:'SL2',  name:'CLTRD Cargo Side Label',          category:'sleeve_labels',unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:500},
  {code:'SL3',  name:'GRVY Cargo V2 Iron-On Label',     category:'sleeve_labels',unit:'pcs', sizeSpecific:false, balance:3600, lowStockThreshold:500},
  {code:'SL4',  name:'AAO Hoodie Bottom Hem Label Red', category:'sleeve_labels',unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:500},
  {code:'SL5',  name:'AAO Hoodie Bottom Hem Label Black',category:'sleeve_labels',unit:'pcs',sizeSpecific:false, balance:0,    lowStockThreshold:500},
  {code:'SL6',  name:'Groovy Shirting Flag Label',      category:'sleeve_labels',unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  // ── HANGTAGS & CAP LABELS ──
  {code:'HT01', name:'GRVY All Product Hangtag',        category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:4600, lowStockThreshold:500},
  {code:'HT03', name:'GRVY Hangtag Essentials',         category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:2900, lowStockThreshold:500},
  {code:'HT04', name:'GRVY Hangtag Headwear',           category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:2900, lowStockThreshold:300},
  {code:'HT05', name:'GRVY Hangtag Shirt',              category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:3100, lowStockThreshold:500},
  {code:'HT06', name:'GRVY Hangtag Denim',              category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:2200, lowStockThreshold:500},
  {code:'HW01', name:'GRVY Headwear Snap Label',        category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:7100, lowStockThreshold:300},
  {code:'HW02', name:'GRVY Headwear Inner Label Black', category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:3600, lowStockThreshold:300},
  {code:'HW04', name:'GRVY Headwear Care Label Satin',  category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:2700, lowStockThreshold:300},
  {code:'TS-01',name:'Tag String',                      category:'hangtags',     unit:'pcs', sizeSpecific:false, balance:6600, lowStockThreshold:500},
  // ── PATCHES ──
  {code:'SP1',      name:'Hoodie Emblem Black',             category:'patches',  unit:'pcs', sizeSpecific:false, balance:2640, lowStockThreshold:500},
  {code:'SP2',      name:'Hoodie Emblem White',             category:'patches',  unit:'pcs', sizeSpecific:false, balance:1115, lowStockThreshold:500},
  {code:'SP3',      name:'Combat Hoodie Black Badge',       category:'patches',  unit:'pcs', sizeSpecific:false, balance:145,  lowStockThreshold:200},
  {code:'SL8',      name:'GRVY Trousers/Cargos Logo Black', category:'patches',  unit:'pcs', sizeSpecific:false, balance:900,  lowStockThreshold:500},
  {code:'PL1-BLU',  name:'Patch Label For Shirt (Blue)',    category:'patches',  unit:'pcs', sizeSpecific:false, balance:800,  lowStockThreshold:200},
  {code:'AAO-PL01', name:'AAO Patch Label',                 category:'patches',  unit:'pcs', sizeSpecific:false, balance:1020, lowStockThreshold:200},
  {code:'SPW',      name:'White Groovy Size Patch',         category:'patches',  unit:'pcs', sizeSpecific:true,  sizes:{XS:600,S:400,M:1600,L:1400,XL:600},          lowStockThreshold:500},
  {code:'SPB',      name:'Black Groovy Size Patch',         category:'patches',  unit:'pcs', sizeSpecific:true,  sizes:{XS:600,S:240,M:1800,L:1540,XL:500},          lowStockThreshold:500},
  // ── BOTTOM LABELS ──
  {code:'BL1',  name:'GRVY Trousers/Cargos New',        category:'bottom_labels',unit:'pcs', sizeSpecific:true,  sizes:{XXXS:1440,XXS:1940,XS:1900,S:6500,M:5700,L:6640,XL:1920,XXL:670},                lowStockThreshold:500},
  {code:'BL2',  name:'CLTRD Denim Belt B/W',            category:'bottom_labels',unit:'pcs', sizeSpecific:true,  sizes:{'26"':980,'28"':400,'30"':1650,'32"':1816,'34"':1000,'36"':1088},                 lowStockThreshold:500},
  {code:'BL3',  name:'GRVY Denim Belt Cream',           category:'bottom_labels',unit:'pcs', sizeSpecific:true,  sizes:{'26"':200,'28"':340,'30"':40,'32"':6,'34"':294,'36"':304,'38"':200},              lowStockThreshold:500},
  {code:'BL4',  name:'GRVY Denim Belt Black',           category:'bottom_labels',unit:'pcs', sizeSpecific:true,  sizes:{GrvyStudio:9600,Baggy:9000,'26"':800,'28"':1000,'30"':2000,'32"':3000,'34"':3200,'36"':1620,'38"':1600}, lowStockThreshold:500},
  {code:'BL5',  name:'CLTRD Trousers/Cargos Black',     category:'bottom_labels',unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  {code:'BL6',  name:'AAO Denim Belt Red',              category:'bottom_labels',unit:'pcs', sizeSpecific:true,  sizes:{'26"':0,'28"':0,'30"':714,'32"':452,'34"':360,'36"':834,'38"':800},               lowStockThreshold:200},
  {code:'BL7',  name:'AAO Denim Belt Black',            category:'bottom_labels',unit:'pcs', sizeSpecific:true,  sizes:{'26"':0,'28"':0,'30"':0,'32"':0,'34"':0,'36"':0,'38"':0},                        lowStockThreshold:200},
  {code:'BL8',  name:'AAO Trousers/Cargos Red',         category:'bottom_labels',unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  {code:'BL9',  name:'AAO Trousers/Cargos Black',       category:'bottom_labels',unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  {code:'BL10', name:'GRVY Denim Label V1',             category:'bottom_labels',unit:'pcs', sizeSpecific:true,  sizes:{'26"':0,'28"':0,'30"':0,'32"':0,'34"':952,'36"':3062,'38"':3160},                lowStockThreshold:500},
  {code:'BL11', name:'GRVY Trouser/Cargo Label V1',     category:'bottom_labels',unit:'pcs', sizeSpecific:true,  sizes:{S:0,M:0,L:0,XL:100},                                                             lowStockThreshold:200},
  // ── METAL TRIMS ──
  {code:'BT1',   name:'GRVY Denim Main Button',         category:'metal_trims',  unit:'pcs', sizeSpecific:false, balance:4714, lowStockThreshold:500},
  {code:'BT4',   name:'GRVY Main Rivett',               category:'metal_trims',  unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:500},
  {code:'BT-SQ', name:'GRVY Square Batch',              category:'metal_trims',  unit:'pcs', sizeSpecific:false, balance:900,  lowStockThreshold:500},
  {code:'BT5',   name:'CLTRD Closed Star Eyelets',      category:'metal_trims',  unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  {code:'BT6',   name:'CLTRD Puller/Zips',              category:'metal_trims',  unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  {code:'BT7',   name:'GRVY Puller/Zip',                category:'metal_trims',  unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  {code:'BT8',   name:'GRVY Closed Coin Eyelet',        category:'metal_trims',  unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  {code:'BT9',   name:'GRVY Trouser/Hoodie Eyelet #2',  category:'metal_trims',  unit:'pcs', sizeSpecific:false, balance:0,    lowStockThreshold:200},
  // ── TWILL TAPE ──
  {code:'TT1',   name:'GRVY Twill Tape',                category:'twill_tape',   unit:'meters',sizeSpecific:false,balance:2213,lowStockThreshold:100},
  {code:'TT2',   name:'CLTR Twill Tape',                category:'twill_tape',   unit:'meters',sizeSpecific:false,balance:200, lowStockThreshold:50},
  {code:'TT3',   name:'AAO Twill Tape',                 category:'twill_tape',   unit:'meters',sizeSpecific:false,balance:0,   lowStockThreshold:50},
  {code:'TT-WG', name:'White Twill Tape (grams)',       category:'twill_tape',   unit:'grams', sizeSpecific:true, sizes:{regular:4000,bold:5400,'off-white':4100},    lowStockThreshold:500},
  {code:'TT-BK', name:'Black Twill Tape',               category:'twill_tape',   unit:'kg',    sizeSpecific:false,balance:18,  lowStockThreshold:5},
  {code:'TT-WP', name:'White Twill Tape Packets (Yasir Bros)',category:'twill_tape',unit:'kg', sizeSpecific:false,balance:8,   lowStockThreshold:2},
  // ── PACKAGING ──
  {code:'IP1',   name:'GROOVY Inner Polythene',         category:'packaging',    unit:'pcs',   sizeSpecific:false,balance:16300,lowStockThreshold:1000},
  {code:'IP2',   name:'Cultured Inner Polythene',       category:'packaging',    unit:'packets',sizeSpecific:false,balance:3,   lowStockThreshold:1},
  {code:'IP3',   name:'AAO Inner Polythene',            category:'packaging',    unit:'pcs',   sizeSpecific:false,balance:94,  lowStockThreshold:100},
  {code:'PF1',   name:'Plane Flyer',                   category:'packaging',    unit:'packets',sizeSpecific:false,balance:0,   lowStockThreshold:1},
  {code:'OP1',   name:'GROOVY Outer Pkg SMALL',         category:'packaging',    unit:'packets',sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'OP2',   name:'GROOVY Outer Pkg MEDIUM',        category:'packaging',    unit:'packets',sizeSpecific:false,balance:2400,lowStockThreshold:100},
  {code:'OP3',   name:'GROOVY Outer Pkg LARGE',         category:'packaging',    unit:'packets',sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'OP4',   name:'CULTURED Outer Pkg MEDIUM',      category:'packaging',    unit:'packets',sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'OP5',   name:'AAO Outer Pkg MEDIUM',           category:'packaging',    unit:'packets',sizeSpecific:false,balance:0,   lowStockThreshold:100},
  // ── DRAWSTRING & ELASTIC ──
  {code:'DS1-T', name:'Black Drawstring Trouser',       category:'drawstring',   unit:'100pc bundles',sizeSpecific:false,balance:608,  lowStockThreshold:5},
  {code:'DS1-H', name:'Black Drawstring Hoodie',        category:'drawstring',   unit:'100pc bundles',sizeSpecific:false,balance:8,    lowStockThreshold:2},
  {code:'DS-E15',name:'Elastic 1.5 inch',               category:'drawstring',   unit:'kg',    sizeSpecific:false,balance:43,  lowStockThreshold:5},
  {code:'DS-E2', name:'Elastic 2 inch',                 category:'drawstring',   unit:'kg',    sizeSpecific:false,balance:0,   lowStockThreshold:5},
  {code:'DS-DP', name:'Dori Pipin',                     category:'drawstring',   unit:'pcs',   sizeSpecific:false,balance:21,  lowStockThreshold:5},
  {code:'DC-01', name:'Topper and Dori (DC-01)',        category:'drawstring',   unit:'pcs',   sizeSpecific:true, sizes:{toppers:1000,dori:7}, lowStockThreshold:100},
  // ── NECK RIB ──
  {code:'NR-MB-BL',name:'Mid Black Blue',               category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:356, lowStockThreshold:100},
  {code:'NR-MB-Y', name:'Mid Black Yellow',             category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:40,  lowStockThreshold:50},
  {code:'NR-PB',   name:'Plane Black',                  category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:2818,lowStockThreshold:200},
  {code:'NR-MB-DY',name:'Mid Black Dark Yellow',        category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:740, lowStockThreshold:100},
  {code:'NR-PBL',  name:'Plane Blue',                   category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'NR-OW',   name:'Mid Orange White',             category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:1472,lowStockThreshold:100},
  {code:'NR-GB',   name:'Mid Gray Blue',                category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:1250,lowStockThreshold:100},
  {code:'NR-NB',   name:'Navy Rib Set',                 category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:60,  lowStockThreshold:50},
  {code:'NR-WCM',  name:'White Collar Mid Black',       category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:400, lowStockThreshold:100},
  {code:'NR-RC',   name:'Red Collar Rib Set',           category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:240, lowStockThreshold:50},
  {code:'NR-MBO',  name:'Mid Black Orange',             category:'neck_rib',     unit:'pcs',   sizeSpecific:false,balance:800, lowStockThreshold:100},
  // ── BUNDLE TAGS ──
  {code:'BND-TAG', name:'Bundle Tag',                   category:'bundle_tag',   unit:'pcs',   sizeSpecific:false,balance:5032,lowStockThreshold:500},
  // ── ZIPS ──
  {code:'ZP-BS25', name:'Black Silver Zip 25"',         category:'zips',         unit:'pcs',   sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'ZP-PW25', name:'Plain White Zip 25"',          category:'zips',         unit:'pcs',   sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'ZP-CRM',  name:'Cream Zip',                    category:'zips',         unit:'pcs',   sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'ZP-BG',   name:'Black Golden Zip',             category:'zips',         unit:'pcs',   sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'ZP-SM',   name:'Small Zip',                    category:'zips',         unit:'pcs',   sizeSpecific:false,balance:0,   lowStockThreshold:100},
  {code:'ZP-NB',   name:'Navy Blue Zip',                category:'zips',         unit:'pcs',   sizeSpecific:false,balance:0,   lowStockThreshold:100},
  // ── THREADS ──
  {code:'THR-W',   name:'Thread White',                 category:'threads',      unit:'cones', sizeSpecific:false,balance:144, lowStockThreshold:20},
  {code:'THR-B',   name:'Thread Black',                 category:'threads',      unit:'cones', sizeSpecific:false,balance:314, lowStockThreshold:20},
  {code:'THR-C',   name:'Thread Cream',                 category:'threads',      unit:'cones', sizeSpecific:false,balance:254, lowStockThreshold:20},
  {code:'THR-SG',  name:'Thread Slate Gray',            category:'threads',      unit:'cones', sizeSpecific:false,balance:124, lowStockThreshold:20},
  {code:'THR-SB',  name:'Thread Slate Blue (40/2)',     category:'threads',      unit:'cones', sizeSpecific:false,balance:0,   lowStockThreshold:20},
  {code:'THR-CB',  name:'Thread Chocolate Brown',       category:'threads',      unit:'cones', sizeSpecific:false,balance:0,   lowStockThreshold:20},
  {code:'THR-LB',  name:'Thread Light Brown',           category:'threads',      unit:'cones', sizeSpecific:false,balance:0,   lowStockThreshold:20},
  {code:'THR-DB',  name:'Thread Dark Brown',            category:'threads',      unit:'cones', sizeSpecific:false,balance:0,   lowStockThreshold:20},
  {code:'THR-MR',  name:'Thread Maroon',                category:'threads',      unit:'cones', sizeSpecific:false,balance:0,   lowStockThreshold:20},
  {code:'THR-LG',  name:'Thread Light Gray',            category:'threads',      unit:'cones', sizeSpecific:false,balance:101, lowStockThreshold:20},
  {code:'THR-DG',  name:'Thread Dark Gray',             category:'threads',      unit:'cones', sizeSpecific:false,balance:198, lowStockThreshold:20},
  {code:'THR-CC',  name:'Thread Cora Color',            category:'threads',      unit:'cones', sizeSpecific:false,balance:226, lowStockThreshold:20},
  {code:'THR-FG',  name:'Thread Forest Green',          category:'threads',      unit:'cones', sizeSpecific:false,balance:101, lowStockThreshold:20},
  {code:'THR-GR',  name:'Thread Green',                 category:'threads',      unit:'cones', sizeSpecific:false,balance:138, lowStockThreshold:20},
  {code:'THR-MG',  name:'Thread Military Green',        category:'threads',      unit:'cones', sizeSpecific:false,balance:53,  lowStockThreshold:20},
  {code:'THR-NB',  name:'Thread Navy Blue',             category:'threads',      unit:'cones', sizeSpecific:false,balance:129, lowStockThreshold:20},
  {code:'THR-BG',  name:'Thread Burgundy',              category:'threads',      unit:'cones', sizeSpecific:false,balance:217, lowStockThreshold:20},
  {code:'THR-WN',  name:'Thread Water Nylon Cone',      category:'threads',      unit:'cones', sizeSpecific:false,balance:93,  lowStockThreshold:20},
];
const CAT_LABELS={
  neck_labels:'Neck Labels',sleeve_labels:'Sleeve & Hem Labels',hangtags:'Hangtags & Cap Labels',
  patches:'Patches',bottom_labels:'Bottom Labels',metal_trims:'Metal Trims',twill_tape:'Twill Tape',
  packaging:'Packaging',drawstring:'Drawstring & Elastic',neck_rib:'Neck Rib',
  bundle_tag:'Bundle Tags',zips:'Zips',threads:'Threads',
};
const CAT_ORDER=['neck_labels','sleeve_labels','hangtags','patches','bottom_labels','metal_trims','twill_tape','packaging','drawstring','neck_rib','bundle_tag','zips','threads'];
const CAT_PREFIX={
  neck_labels:'NL',sleeve_labels:'SL',hangtags:'HT',patches:'PT',bottom_labels:'BL',
  metal_trims:'BT',twill_tape:'TT',packaging:'PKG',drawstring:'DS',neck_rib:'NR',
  bundle_tag:'BG',zips:'ZP',threads:'TH'
};
function _allCats(){
  const dyn=allStoreCategories.map(c=>c.key).filter(k=>!CAT_LABELS[k]);
  return[...CAT_ORDER,...dyn];
}
function _catLabel(key){
  if(CAT_LABELS[key])return CAT_LABELS[key];
  const c=allStoreCategories.find(x=>x.key===key);
  return c?c.label:key;
}
function _catPrefix(key){
  if(CAT_PREFIX[key])return CAT_PREFIX[key];
  const c=allStoreCategories.find(x=>x.key===key);
  if(c&&c.prefix)return c.prefix;
  return(key||'').split('_').map(w=>w.slice(0,1)).join('').toUpperCase()||'IT';
}
function _slugifyCat(s){return(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40);}
function _suggestNextCode(prefix){
  if(!prefix)return'';
  const re=new RegExp('^'+prefix.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')+'(\\d+)','i');
  let max=0;
  for(const it of allItems){const m=(it.code||'').match(re);if(m){const n=parseInt(m[1],10);if(n>max)max=n;}}
  return prefix+String(max+1).padStart(2,'0');
}

// ── Helpers ──
function renderInventory(){
  const lowStock=allItems.filter(i=>getStatus(i)!=='green');
  const cats=_allCats();
  const catCounts={};
  for(const c of cats)catCounts[c]=0;
  for(const it of allItems)if(it.category&&catCounts[it.category]!=null)catCounts[it.category]++;
  let h=`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><div class="page-title">Inventory</div><div class="page-sub">${allItems.length} items across ${cats.length} categories</div></div>
    <button class="btn-primary" style="width:auto;padding:10px 18px" onclick="window.showAddItemForm()">+ Add Item</button>
  </div>`;
  if(lowStock.length){
    h+=`<div class="card" style="border-left:3px solid #dc2626;margin-bottom:16px">
      <div class="card-title">⚠ Low / Out of Stock (${lowStock.length} items)</div>
      ${lowStock.map(i=>`<div class="info-row"><span><strong>${i.code}</strong> — ${i.name}</span><span class="badge badge-${getStatus(i)}">${getBalance(i)} ${i.unit}</span></div>`).join('')}
    </div>`;
  }
  const chip=(key,label,count,active)=>`<button onclick="window.invSetCat('${key}')" style="padding:6px 12px;border:1px solid ${active?'var(--dark)':'var(--border)'};border-radius:999px;background:${active?'var(--dark)':'#fff'};color:${active?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit;font-weight:${active?'600':'500'}">${label}${count!=null?` <span style="opacity:.7;font-weight:400">${count}</span>`:''}</button>`;
  let chipsHTML=chip('all','All',allItems.length,_invFilterCat==='all');
  for(const c of cats){
    if(!catCounts[c])continue;
    chipsHTML+=chip(c,_catLabel(c),catCounts[c],_invFilterCat===c);
  }
  h+=`<div class="card" style="margin-bottom:14px;padding:12px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:0">${chipsHTML}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="inv-search" placeholder="Search code or name…" value="${_invSearchQ.replace(/"/g,'&quot;')}" oninput="window.invSetSearch(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;outline:none;min-width:180px">
        <select onchange="window.invSetSort(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;outline:none;background:#fff">
          ${[['category','Sort: by category'],['az','A → Z'],['za','Z → A'],['low','Stock low → high'],['recent','Recently added']].map(([v,l])=>`<option value="${v}"${_invSort===v?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>`;
  let list=allItems.slice();
  if(_invFilterCat!=='all')list=list.filter(i=>i.category===_invFilterCat);
  if(_invSearchQ){const q=_invSearchQ.toLowerCase();list=list.filter(i=>(i.code||'').toLowerCase().includes(q)||(i.name||'').toLowerCase().includes(q));}
  if(_invSort==='az')list.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  else if(_invSort==='za')list.sort((a,b)=>(b.name||'').localeCompare(a.name||''));
  else if(_invSort==='low')list.sort((a,b)=>getBalance(a)-getBalance(b));
  else if(_invSort==='recent')list.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const cardHTML=(item)=>{const s=getStatus(item),b=getBalance(item);const img=item.imageUrl?`<div onclick="window._invImgPreview('${item.imageUrl}','${(item.code||'').replace(/'/g,'')}')" style="width:42px;height:42px;border-radius:6px;background:url('${item.imageUrl}') center/cover no-repeat,#fafafa;border:1px solid var(--border);flex-shrink:0;cursor:zoom-in"></div>`:'';return`<div class="item-card status-${s}">
    <div style="display:flex;gap:8px;align-items:flex-start">
      ${img}
      <div style="min-width:0;flex:1">
        <div class="item-code">${item.code}</div>
        <div class="item-name">${item.name}</div>
      </div>
    </div>
    <div class="item-bal ${s}">${b} <span style="font-size:12px;font-weight:400">${item.unit}</span></div>
    ${item.sizeSpecific?`<div class="item-sizes">${formatSizes(item)}</div>`:''}
    <div style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span class="badge badge-${s}">${s==='green'?'In Stock':s==='amber'?'Low Stock':'Out of Stock'}</span>
      <button onclick="window.editStoreItem('${item.code}')" style="padding:3px 8px;background:none;border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--muted)" onmouseenter="this.style.borderColor='var(--dark)'" onmouseleave="this.style.borderColor='var(--border)'">Edit</button>
      <button onclick="window.deleteStoreItem('${item.code}')" class="btn-danger" style="padding:3px 8px;font-size:11px">Delete</button>
    </div>
  </div>`;};
  if(!list.length){
    h+=`<div class="empty" style="padding:24px;text-align:center">No items match this filter.</div>`;
  }else if(_invSort==='category'){
    for(const cat of cats){
      const items=list.filter(i=>i.category===cat);
      if(!items.length)continue;
      h+=`<div class="section-title">${_catLabel(cat)}</div><div class="item-grid">${items.map(cardHTML).join('')}</div>`;
    }
    const orphans=list.filter(i=>!cats.includes(i.category));
    if(orphans.length){
      h+=`<div class="section-title">Uncategorised</div><div class="item-grid">${orphans.map(cardHTML).join('')}</div>`;
    }
  }else{
    h+=`<div class="item-grid">${list.map(cardHTML).join('')}</div>`;
  }
  return h+'<div style="height:80px"></div>';
}

window._invImgPreview=function(url,code){
  document.getElementById('_inv-img-lb')?.remove();
  const lb=document.createElement('div');
  lb.id='_inv-img-lb';
  lb.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2400;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
  lb.onclick=()=>lb.remove();
  lb.innerHTML=`<div style="max-width:90vw;max-height:85vh;display:flex;flex-direction:column;align-items:center;gap:8px"><img src="${url}" style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:8px;background:#fff"><div style="color:#fff;font-size:12px">${code||''}</div></div>`;
  document.body.appendChild(lb);
};
window.invSetCat=function(c){_invFilterCat=c;const m=document.getElementById('main-content');if(m)m.innerHTML=renderInventory();};
window.invSetSearch=function(v){
  _invSearchQ=v||'';
  clearTimeout(window._invSearchTo);
  window._invSearchTo=setTimeout(()=>{
    const m=document.getElementById('main-content');if(m){m.innerHTML=renderInventory();const i=document.getElementById('inv-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}}
  },180);
};
window.invSetSort=function(v){_invSort=v;const m=document.getElementById('main-content');if(m)m.innerHTML=renderInventory();};

// ── Fabric Inventory page ──
function renderFabricInventory(){
  if(_fabInvDrillKey){return _renderFabInvDrill(_fabInvDrillKey);}
  const aggregates=allFabricInventory.filter(s=>s);
  const totalKg=aggregates.filter(s=>(s.unit||'kg')==='kg').reduce((a,s)=>a+(s.totalWeight||0),0);
  const totalM=aggregates.filter(s=>(s.unit||'kg')==='meters'||(s.unit||'kg')==='m').reduce((a,s)=>a+(s.totalWeight||0),0);
  const totalRolls=aggregates.reduce((a,s)=>a+(s.rollsCount||0),0);
  const filtered=aggregates.filter(s=>{
    if(_fabInvFilter==='in_stock'&&!(s.totalWeight>0))return false;
    if(_fabInvFilter==='empty'&&(s.totalWeight>0))return false;
    if(_fabInvSearchQ){
      const q=_fabInvSearchQ.toLowerCase();
      const hay=`${s.fabType||''} ${s.color||''} ${s.gsm||''}`.toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  }).sort((a,b)=>(b.lastMovementAt||0)-(a.lastMovementAt||0));
  let h=`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><div class="page-title">Fabric Inventory</div><div class="page-sub">${aggregates.length} stock rows · ${totalRolls} rolls · ${totalKg.toFixed(1)} kg${totalM?' · '+totalM.toFixed(1)+' m':''}</div></div>
  </div>`;
  h+=`<div class="card" style="margin-bottom:14px;padding:12px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${[['in_stock','In stock'],['empty','Out of stock'],['all','All']].map(([k,l])=>`<button onclick="window.fabInvSetFilter('${k}')" style="padding:6px 12px;border:1px solid ${_fabInvFilter===k?'var(--dark)':'var(--border)'};border-radius:999px;background:${_fabInvFilter===k?'var(--dark)':'#fff'};color:${_fabInvFilter===k?'#fff':'var(--text)'};font-size:12px;cursor:pointer;font-family:inherit">${l}</button>`).join('')}
      </div>
      <input id="finv-search" placeholder="Search fabric type / color / GSM…" value="${_fabInvSearchQ.replace(/"/g,'&quot;')}" oninput="window.fabInvSetSearch(this.value)" style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;outline:none;flex:1;min-width:200px">
    </div>
  </div>`;
  if(!filtered.length){
    h+=`<div class="empty" style="padding:24px;text-align:center">No fabric inventory rows match.</div>`;
  }else{
    h+=`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff">
      <thead><tr style="background:#fafafa;border-bottom:1px solid var(--border)">
        <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Fabric</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">GSM</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Color</th>
        <th style="padding:10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Stock</th>
        <th style="padding:10px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Rolls</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.04em">Last move</th>
        <th></th>
      </tr></thead>
      <tbody>${filtered.map(s=>{
        const empty=!(s.totalWeight>0);
        return`<tr style="border-bottom:1px solid #f5f5f5${empty?';opacity:.55':''}">
          <td style="padding:10px;font-weight:600">${_gpEsc(s.fabType||'—')}</td>
          <td style="padding:10px">${s.gsm||'—'}</td>
          <td style="padding:10px">${_gpEsc(s.color||'—')}</td>
          <td style="padding:10px;text-align:right;font-weight:700;color:${empty?'#dc2626':'var(--text)'}">${(s.totalWeight||0).toFixed(2)} ${s.unit||'kg'}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${s.rollsCount||0}</td>
          <td style="padding:10px;font-size:11px;color:var(--muted)">${s.lastMovementAt?new Date(s.lastMovementAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}):'—'}</td>
          <td style="padding:10px;text-align:right"><button onclick="window.fabInvDrill('${s._id}')" style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px;cursor:pointer;font-family:inherit">Open</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }
  return h+'<div style="height:80px"></div>';
}

function _renderFabInvDrill(key){
  const s=allFabricInventory.find(x=>x._id===key);
  if(!s){return`<div class="page-head"><div class="page-title">Not found</div></div><button class="btn-outline" onclick="window.fabInvDrill(null)">← Back</button>`;}
  const movements=allFabricMovements.filter(m=>_fabInvKey(m.fabType,m.gsm,m.color)===key).slice(0,80);
  const rolls=(s.rolls||[]).slice().sort((a,b)=>(a.status==='in_stock'?-1:1)-(b.status==='in_stock'?-1:1));
  return`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><div class="page-title">${_gpEsc(s.fabType||'—')} · ${s.gsm||0}gsm · ${_gpEsc(s.color||'—')}</div>
      <div class="page-sub">${(s.totalWeight||0).toFixed(2)} ${s.unit||'kg'} in stock · ${s.rollsCount||0} rolls · ${rolls.length} total rolls ever received</div></div>
    <button class="btn-outline" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.fabInvDrill(null)">← Back to Fabric Inventory</button>
  </div>
  <div class="card" style="margin-bottom:14px"><div class="card-title">Rolls</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Roll Code</th><th style="padding:8px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Weight</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Status</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Source</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Issued to / used by</th></tr></thead>
      <tbody>${rolls.length?rolls.map(r=>{
        const stColor=r.status==='in_stock'?'var(--green)':r.status==='issued'?'#dc2626':r.status==='consumed'?'#92400e':'var(--muted)';
        return`<tr style="border-bottom:1px solid #f5f5f5"><td style="padding:8px;font-weight:700;letter-spacing:.04em">${_gpEsc(r.rollCode||'—')}</td><td style="padding:8px;text-align:right">${r.weight||0} ${r.unit||s.unit||'kg'}</td><td style="padding:8px;color:${stColor};font-weight:600;text-transform:capitalize">${(r.status||'in_stock').replace('_',' ')}</td><td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(r.sourceFabId||'—')}</td><td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(r.issuedTo||r.consumedBy||'—')}</td></tr>`;
      }).join(''):'<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--muted)">No rolls yet.</td></tr>'}</tbody>
    </table></div>
  </div>
  <div class="card"><div class="card-title">Movements (${movements.length})</div>
    ${movements.length?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">When</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Type</th><th style="padding:8px;text-align:right;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Qty</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Rolls</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Source</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">By</th><th style="padding:8px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted)">Note</th></tr></thead>
      <tbody>${movements.map(m=>{
        const tColor=m.type==='in'?'var(--green)':m.type==='out'?'#dc2626':m.type==='consume'?'#92400e':'var(--muted)';
        return`<tr style="border-bottom:1px solid #f5f5f5">
          <td style="padding:8px">${new Date(m.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
          <td style="padding:8px;color:${tColor};font-weight:700;text-transform:uppercase">${m.type==='in'?'+ IN':m.type==='out'?'− OUT':m.type==='consume'?'− CONSUME':m.type==='return'?'+ RETURN':m.type}</td>
          <td style="padding:8px;text-align:right;font-weight:600">${(m.qty||0).toFixed(2)} ${m.unit||'kg'}</td>
          <td style="padding:8px;font-size:11px;letter-spacing:.04em">${(m.rollCodes||[]).slice(0,3).map(_gpEsc).join(', ')}${(m.rollCodes||[]).length>3?` +${m.rollCodes.length-3}`:''}</td>
          <td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(m.sourceCollection||'')}/${_gpEsc(m.sourceId||'')}</td>
          <td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(m.by||'')}</td>
          <td style="padding:8px;font-size:11px;color:var(--muted)">${_gpEsc(m.note||'')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`:'<div class="empty" style="padding:16px">No movements logged for this fabric yet.</div>'}
  </div>
  <div style="height:80px"></div>`;
}

window.fabInvSetFilter=function(f){_fabInvFilter=f;const m=document.getElementById('main-content');if(m)m.innerHTML=renderFabricInventory();};
window.fabInvSetSearch=function(v){
  _fabInvSearchQ=v||'';
  clearTimeout(window._fabInvSearchTo);
  window._fabInvSearchTo=setTimeout(()=>{
    const m=document.getElementById('main-content');if(m){m.innerHTML=renderFabricInventory();const i=document.getElementById('finv-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}}
  },180);
};
window.fabInvDrill=function(key){_fabInvDrillKey=key;const m=document.getElementById('main-content');if(m)m.innerHTML=renderFabricInventory();};

function renderStoreReceive(){
  _rcvNewMode=false;
  const opts=`<option value="__new__" style="font-weight:700;color:#16a34a">+ New item — not in inventory yet</option>`+
    allItems.map(i=>`<option value="${i.code}">${i.code} — ${i.name}</option>`).join('');
  return`<div class="page-head"><div class="page-title">Receive Stock</div></div>
  <div class="card">
    <div class="card-title">Record received stock</div>
    <div class="form-grid">
      <div class="field"><label>Item *</label><select id="rcv-item" onchange="window.onRcvItemChange()">${opts}</select></div>
      <div class="field"><label>Supplier</label><input id="rcv-supplier" placeholder="Supplier name"></div>
      <div class="field"><label>Date</label><input id="rcv-date" type="date" value="${todayStr()}"></div>
      <div class="field"><label>Received By</label><input value="${session.name}" readonly></div>
      <div class="field" style="grid-column:1/-1"><label>Notes</label>
        <textarea id="rcv-notes" rows="2" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#FAFAFA;font-family:inherit;outline:none;width:100%;resize:vertical" placeholder="Optional"></textarea>
      </div>
    </div>
    <div id="rcv-new-wrap" style="margin-top:12px"></div>
    <div id="rcv-qty-wrap" style="margin-top:12px"></div>
    <button class="btn-primary" style="margin-top:12px" onclick="window.submitReceive()">Save Receipt</button>
  </div><div style="height:80px"></div>`;
}

function _rcvCatOptions(selected){
  const items=_allCats().map(k=>`<option value="${k}"${k===selected?' selected':''}>${_catLabel(k)}</option>`).join('');
  return`<option value="">— pick category —</option>${items}<option value="__new_cat__" style="font-weight:700;color:#16a34a">+ New category…</option>`;
}

function _rcvUnitOptions(selected){
  const units=['pcs','meters','kg','grams','cones','packets','100pc bundles'];
  const opts=units.map(u=>`<option value="${u}"${u===selected?' selected':''}>${u}</option>`).join('');
  return`<option value="">— pick unit —</option>${opts}<option value="__custom__">Custom…</option>`;
}

function _renderRcvNewForm(){
  return`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:6px">
    <div style="font-weight:700;font-size:13px;color:#065f46;margin-bottom:10px">New item — will be added to Inventory</div>
    <div class="form-grid">
      <div class="field"><label>Category *</label>
        <select id="rcvn-cat" onchange="window.onRcvNewCatChange()">${_rcvCatOptions('')}</select>
      </div>
      <div class="field"><label>Code *</label>
        <input id="rcvn-code" placeholder="Pick category first" style="text-transform:uppercase">
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Auto-suggested from category. Edit if needed.</div>
      </div>
      <div class="field" style="grid-column:1/-1"><label>Item Name *</label>
        <input id="rcvn-name" placeholder="e.g. New Patch Label Black">
      </div>
      <div class="field" style="grid-column:1/-1">
        <label>Image <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <div style="display:flex;gap:10px;align-items:center">
          <div id="rcvn-img-preview" style="width:54px;height:54px;border:1px solid var(--border);border-radius:8px;background:#fafafa;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:10px">No image</div>
          <input type="file" id="rcvn-img-file" accept="image/*" style="font-size:11px;font-family:inherit" onchange="window._rcvOnImgPick(this)">
          <input type="hidden" id="rcvn-img-url" value="">
          <input type="hidden" id="rcvn-img-status" value="ready">
        </div>
      </div>
      <div class="field"><label>Unit *</label>
        <select id="rcvn-unit" onchange="window.onRcvNewUnitChange()">${_rcvUnitOptions('pcs')}</select>
      </div>
      <div class="field" id="rcvn-custom-unit-wrap" style="display:none"><label>Custom unit</label>
        <input id="rcvn-custom-unit" placeholder="e.g. rolls">
      </div>
      <div class="field"><label>Low-stock threshold</label>
        <input id="rcvn-thresh" type="number" min="0" value="200">
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Default 200 — change anytime in Inventory.</div>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:8px;padding-top:22px">
        <input type="checkbox" id="rcvn-sized" onchange="window.onRcvSizedToggle()" style="width:auto;margin:0">
        <label for="rcvn-sized" style="margin:0;cursor:pointer;font-size:13px">Size-specific item</label>
      </div>
      <div class="field" id="rcvn-sizes-wrap" style="grid-column:1/-1;display:none"><label>Sizes (comma-separated, e.g. XS,S,M,L,XL)</label>
        <input id="rcvn-sizes-list" placeholder="XS,S,M,L,XL" oninput="window.onRcvSizedListChange()">
      </div>
    </div>
  </div>`;
}

window._rcvOnImgPick=async function(input){
  const file=input.files&&input.files[0];if(!file)return;
  const status=document.getElementById('rcvn-img-status');
  const preview=document.getElementById('rcvn-img-preview');
  const urlField=document.getElementById('rcvn-img-url');
  if(status)status.value='uploading';
  if(preview){preview.style.background='#fafafa';preview.textContent='Uploading…';preview.style.color='#999';}
  try{
    const url=await uploadToCloudinary(file);
    if(urlField)urlField.value=url;
    if(preview){preview.textContent='';preview.style.backgroundImage=`url('${url}')`;preview.style.backgroundSize='cover';preview.style.backgroundPosition='center';}
    if(status)status.value='ready';
  }catch(e){
    if(status)status.value='error';
    if(preview){preview.textContent='Failed';preview.style.color='#dc2626';}
    showToast('Upload failed: '+e.message,true);
  }
};

function onRcvItemChange(){
  const code=document.getElementById('rcv-item')?.value;
  const newWrap=document.getElementById('rcv-new-wrap');
  const wrap=document.getElementById('rcv-qty-wrap');
  if(!wrap||!newWrap)return;
  if(code==='__new__'){
    _rcvNewMode=true;
    newWrap.innerHTML=_renderRcvNewForm();
    wrap.innerHTML=`<div class="field"><label>Qty received · Pick category & unit first</label>
      <input type="number" id="rcv-flat" min="0" placeholder="0" disabled style="background:#f5f5f5"></div>`;
    return;
  }
  _rcvNewMode=false;
  newWrap.innerHTML='';
  const item=allItems.find(i=>i.code===code);if(!item)return;
  if(item.sizeSpecific){
    wrap.innerHTML=`<div class="field"><label>Qty received per size (${item.unit})</label>
      <div class="size-grid">${Object.keys(item.sizes||{}).map(sz=>`<div class="size-field"><label>${sz}</label>
        <input type="number" min="0" placeholder="0" id="rcv-${safeId(sz)}">
        <div class="stk">Stk: ${item.sizes[sz]||0}</div></div>`).join('')}</div></div>`;
  }else{
    wrap.innerHTML=`<div class="field"><label>Qty received (${item.unit}) · Current stock: ${getBalance(item)}</label>
      <input type="number" id="rcv-flat" min="0" placeholder="0"></div>`;
  }
}

window.onRcvNewCatChange=function(){
  const sel=document.getElementById('rcvn-cat');
  if(!sel)return;
  const v=sel.value;
  if(v==='__new_cat__'){
    sel.value='';
    window.openNewCategoryDialog((newKey)=>{
      const sel2=document.getElementById('rcvn-cat');
      if(!sel2)return;
      sel2.innerHTML=_rcvCatOptions(newKey);
      sel2.value=newKey;
      window.onRcvNewCatChange();
    });
    return;
  }
  if(!v)return;
  const codeEl=document.getElementById('rcvn-code');
  if(codeEl&&!codeEl.dataset.userTouched){
    codeEl.value=_suggestNextCode(_catPrefix(v));
  }
  if(codeEl){codeEl.addEventListener('input',()=>{codeEl.dataset.userTouched='1';},{once:true});}
  _refreshRcvNewQty();
};

window.onRcvNewUnitChange=function(){
  const sel=document.getElementById('rcvn-unit');if(!sel)return;
  const wrap=document.getElementById('rcvn-custom-unit-wrap');
  if(wrap)wrap.style.display=sel.value==='__custom__'?'block':'none';
  _refreshRcvNewQty();
};

window.onRcvSizedToggle=function(){
  const cb=document.getElementById('rcvn-sized');
  const sw=document.getElementById('rcvn-sizes-wrap');
  if(sw)sw.style.display=cb&&cb.checked?'block':'none';
  _refreshRcvNewQty();
};

window.onRcvSizedListChange=function(){_refreshRcvNewQty();};

function _rcvNewUnit(){
  const u=document.getElementById('rcvn-unit')?.value||'';
  if(u==='__custom__')return(document.getElementById('rcvn-custom-unit')?.value||'').trim();
  return u;
}

function _refreshRcvNewQty(){
  const wrap=document.getElementById('rcv-qty-wrap');
  if(!wrap||!_rcvNewMode)return;
  const unit=_rcvNewUnit()||'units';
  const sized=document.getElementById('rcvn-sized')?.checked;
  if(sized){
    const list=(document.getElementById('rcvn-sizes-list')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(!list.length){wrap.innerHTML=`<div class="field"><label>Qty received · enter size list above</label><input type="number" disabled style="background:#f5f5f5" placeholder="0"></div>`;return;}
    wrap.innerHTML=`<div class="field"><label>Qty received per size (${_gpEsc(unit)})</label>
      <div class="size-grid">${list.map(sz=>`<div class="size-field"><label>${_gpEsc(sz)}</label>
        <input type="number" min="0" placeholder="0" id="rcv-${safeId(sz)}">
        <div class="stk">New</div></div>`).join('')}</div></div>`;
  }else{
    wrap.innerHTML=`<div class="field"><label>Qty received (${_gpEsc(unit)})</label>
      <input type="number" id="rcv-flat" min="0" placeholder="0"></div>`;
  }
}

async function _rcvCreateNewItem(){
  const v=k=>(document.getElementById(k)?.value||'').trim();
  const cat=v('rcvn-cat');
  const code=v('rcvn-code').toUpperCase();
  const name=v('rcvn-name');
  const unit=_rcvNewUnit();
  const thresh=parseInt(document.getElementById('rcvn-thresh')?.value)||200;
  const sized=document.getElementById('rcvn-sized')?.checked;
  const imgStatus=document.getElementById('rcvn-img-status')?.value;
  const imageUrl=document.getElementById('rcvn-img-url')?.value||'';
  if(imgStatus==='uploading')throw new Error('Image still uploading…');
  if(!cat||cat==='__new_cat__')throw new Error('Pick a category for the new item.');
  if(!code)throw new Error('New item code is required.');
  if(!name)throw new Error('New item name is required.');
  if(!unit)throw new Error('Pick a unit for the new item.');
  if(allItems.some(i=>(i.code||'').toUpperCase()===code))throw new Error('Code '+code+' already exists.');
  const item={code,name,category:cat,unit,lowStockThreshold:thresh,sizeSpecific:!!sized,imageUrl,createdBy:session.name,createdAt:Date.now()};
  let totalQty=0;
  if(sized){
    const list=(document.getElementById('rcvn-sizes-list')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(!list.length)throw new Error('List sizes for the new item.');
    const sizes={};let any=false;
    for(const sz of list){
      const qv=parseFloat(document.getElementById('rcv-'+safeId(sz))?.value)||0;
      sizes[sz]=qv;if(qv){any=true;totalQty+=qv;}
    }
    if(!any)throw new Error('Enter qty for at least one size.');
    item.sizes=sizes;
  }else{
    const qv=parseFloat(document.getElementById('rcv-flat')?.value)||0;
    if(!qv)throw new Error('Enter quantity received.');
    item.balance=qv;totalQty=qv;
  }
  await fsSet('store_items',code,item);
  allItems.push({...item,_id:code});
  await logActivity('Item added via Receive',`${code} — ${name} (${_catLabel(cat)})`);
  return{item,totalQty};
}

async function submitReceive(){
  const supplier=(document.getElementById('rcv-supplier')?.value||'').trim();
  const date=document.getElementById('rcv-date')?.value||todayStr();
  const notes=(document.getElementById('rcv-notes')?.value||'').trim();
  if(_rcvNewMode){
    try{
      const{item,totalQty}=await _rcvCreateNewItem();
      const txId=await fsAdd('store_transactions',{type:'received',itemCode:item.code,itemName:item.name,supplier,date,notes,by:session.name,ts:Date.now(),qty:totalQty,unit:item.unit,firstReceipt:true});
      allTransactions.unshift({type:'received',itemCode:item.code,itemName:item.name,supplier,date,notes,by:session.name,ts:Date.now(),qty:totalQty,unit:item.unit,firstReceipt:true,_id:txId});
      showToast(`${item.code} created & received ✓`);
      renderStoreSection('receive');
    }catch(e){showToast(e.message||'Error',true);}
    return;
  }
  const code=document.getElementById('rcv-item')?.value;
  const item=allItems.find(i=>i.code===code);
  if(!item){showToast('Select an item.',true);return;}
  const updated={...item};let totalQty=0;
  if(item.sizeSpecific){
    const newSizes={...item.sizes};let any=false;
    for(const sz of Object.keys(item.sizes||{})){
      const v=parseFloat(document.getElementById('rcv-'+safeId(sz))?.value)||0;
      if(v){newSizes[sz]=(parseInt(newSizes[sz])||0)+v;any=true;totalQty+=v;}
    }
    if(!any){showToast('Enter qty for at least one size.',true);return;}
    updated.sizes=newSizes;
  }else{
    const v=parseFloat(document.getElementById('rcv-flat')?.value)||0;
    if(!v){showToast('Enter quantity received.',true);return;}
    updated.balance=(parseInt(item.balance)||0)+v;totalQty=v;
  }
  try{
    await fsSet('store_items',item.code,updated);
    const txId=await fsAdd('store_transactions',{type:'received',itemCode:item.code,itemName:item.name,supplier,date,notes,by:session.name,ts:Date.now(),qty:totalQty,unit:item.unit});
    const idx=allItems.findIndex(i=>i.code===code);
    if(idx>=0)allItems[idx]={...updated,_id:item.code};
    allTransactions.unshift({type:'received',itemCode:item.code,itemName:item.name,supplier,date,notes,by:session.name,ts:Date.now(),qty:totalQty,unit:item.unit,_id:txId});
    showToast('Stock received ✓');
    _checkShortfallsOnReceive(item.code).catch(()=>{});
    renderStoreSection('receive');
  }catch(e){showToast('Error: '+e.message,true);}
}

// ── New category dialog ──
window.openNewCategoryDialog=function(onCreated){
  document.getElementById('_cat-modal')?.remove();
  const modal=document.createElement('div');
  modal.id='_cat-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2200;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML=`<div style="background:#fff;border-radius:14px;width:100%;max-width:380px;box-shadow:0 12px 48px rgba(0,0,0,.25)">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700;font-size:15px">New category</span>
      <button onclick="document.getElementById('_cat-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
    </div>
    <div style="padding:16px;display:grid;gap:10px">
      <div class="field"><label>Display label *</label>
        <input id="_cat-label" placeholder="e.g. Cardboard Boxes" oninput="window._catLabelChanged()">
      </div>
      <div class="field"><label>Code prefix *</label>
        <input id="_cat-prefix" placeholder="e.g. CB" maxlength="6" style="text-transform:uppercase">
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Used to auto-generate item codes (CB01, CB02…).</div>
      </div>
      <div class="field"><label>Internal key</label>
        <input id="_cat-key" placeholder="auto" disabled style="background:#f5f5f5;color:var(--muted)">
      </div>
    </div>
    <div style="padding:0 16px 16px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-outline" onclick="document.getElementById('_cat-modal').remove()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" id="_cat-save">Create</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('_cat-save').onclick=async()=>{
    const label=(document.getElementById('_cat-label')?.value||'').trim();
    const prefix=(document.getElementById('_cat-prefix')?.value||'').trim().toUpperCase();
    const key=_slugifyCat(label);
    if(!label)return showToast('Label is required.',true);
    if(!prefix)return showToast('Code prefix is required.',true);
    if(!key)return showToast('Could not derive a key from the label.',true);
    if(_allCats().includes(key))return showToast('That category already exists.',true);
    try{
      const payload={key,label,prefix,createdBy:session.name,createdAt:Date.now()};
      await fsSet('store_categories',key,payload);
      allStoreCategories.push(payload);
      document.getElementById('_cat-modal').remove();
      showToast('Category added ✓');
      if(typeof onCreated==='function')onCreated(key);
    }catch(e){showToast('Save failed: '+e.message,true);}
  };
};

window._catLabelChanged=function(){
  const lbl=document.getElementById('_cat-label')?.value||'';
  const keyEl=document.getElementById('_cat-key');
  const prefEl=document.getElementById('_cat-prefix');
  if(keyEl)keyEl.value=_slugifyCat(lbl);
  if(prefEl&&!prefEl.dataset.userTouched){
    const words=lbl.trim().split(/\s+/).filter(Boolean);
    let p='';
    if(words.length>=2)p=(words[0][0]+words[1][0]).toUpperCase();
    else if(words.length===1)p=words[0].slice(0,2).toUpperCase();
    prefEl.value=p;
  }
  if(prefEl)prefEl.addEventListener('input',()=>{prefEl.dataset.userTouched='1';},{once:true});
};

function _miRowCells(l,idx){
  const item=allItems.find(i=>i.code===l.itemCode);
  const stock=item?getBalance(item):0;
  const opts=allItems.map(i=>`<option value="${i.code}"${i.code===l.itemCode?' selected':''}>${i.code} — ${i.name}</option>`).join('');
  return`<td><select style="width:100%;padding:5px;border:1px solid var(--border);border-radius:6px;font-size:12px" onchange="window._miChangeItem(${idx},this.value)">
    <option value="">— select —</option>${opts}</select></td>
  <td style="text-align:center;font-size:12px;color:${stock>0?'var(--green)':'var(--red)'}">${l.itemCode?stock:'—'}</td>
  <td><input type="number" min="1" value="${l.qty}" placeholder="0" style="width:80px;padding:5px;border:1px solid var(--border);border-radius:6px;font-size:12px" onchange="window._miChangeQty(${idx},this.value)"></td>
  <td><button onclick="window._miRemoveRow(${idx})" style="background:none;border:none;font-size:18px;color:var(--muted);cursor:pointer;padding:2px 6px">×</button></td>`;
}
function _miSubmitLabel(){
  const valid=_miLines.filter(l=>l.itemCode&&parseInt(l.qty)>0);
  if(!valid.length)return'Issue Stock';
  const total=valid.reduce((s,l)=>s+(parseInt(l.qty)||0),0);
  return`Issue ${valid.length} item${valid.length>1?'s':''} (${total} pcs)`;
}
function _miUpdateSubmitBtn(){const btn=document.getElementById('mi-submit-btn');if(btn)btn.textContent=_miSubmitLabel();}
window._miAddRow=function(){
  _miLines.push({itemCode:'',qty:''});
  const tbody=document.getElementById('mi-tbody');if(!tbody)return;
  const tr=document.createElement('tr');tr.id='mi-row-'+(_miLines.length-1);
  tr.innerHTML=_miRowCells(_miLines[_miLines.length-1],_miLines.length-1);
  tbody.appendChild(tr);_miUpdateSubmitBtn();
};
window._miRemoveRow=function(idx){
  if(_miLines.length<=1){showToast('At least one row required.',true);return;}
  _miLines.splice(idx,1);
  const tbody=document.getElementById('mi-tbody');if(!tbody)return;
  tbody.querySelectorAll('tr').forEach(r=>r.remove());
  _miLines.forEach((l,i)=>{const tr=document.createElement('tr');tr.id='mi-row-'+i;tr.innerHTML=_miRowCells(l,i);tbody.appendChild(tr);});
  _miUpdateSubmitBtn();
};
window._miChangeItem=function(idx,code){
  _miLines[idx].itemCode=code;
  const item=allItems.find(i=>i.code===code);
  const row=document.getElementById('mi-row-'+idx);if(!row)return;
  const tds=row.querySelectorAll('td');if(tds[1]){const s=item?getBalance(item):0;tds[1].textContent=code?s:'—';tds[1].style.color=s>0?'var(--green)':'var(--red)';}
  _miUpdateSubmitBtn();
};
window._miChangeQty=function(idx,v){_miLines[idx].qty=v;_miUpdateSubmitBtn();};

function renderStoreIssue(){
  const pirs=allPoIssueRequests.filter(r=>r.status!=='fully_issued');
  const pirBanner=pirs.length?`<div class="alert-banner alert-amber" style="cursor:pointer" onclick="window.showPage('po-issue-list')">
    <strong>${pirs.length} PO issue request(s) pending.</strong> <span style="text-decoration:underline">Review →</span>
  </div>`:'';
  return`<div class="page-head"><div class="page-title">Issue Stock</div></div>
  ${pirBanner}
  <div class="card">
    <div class="card-title">Issue against PO <span style="font-size:11px;font-weight:500;color:var(--amber);background:#FEF3C7;padding:2px 8px;border-radius:10px;margin-left:6px">Work in Progress</span></div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1;position:relative"><label>PO Number</label>
        <input id="iss-po" placeholder="Type PO number or pick from list…" autocomplete="off"
          oninput="window.filterPODropMain(this.value)" onfocus="window.filterPODropMain(this.value)" onblur="setTimeout(()=>window.hidePODropMain(),200)">
        <div id="iss-po-drop-main" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:300;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.13);max-height:220px;overflow-y:auto;margin-top:3px"></div>
        <div id="iss-po-status" style="font-size:12px;color:var(--muted);margin-top:4px"></div>
      </div>
    </div>
    <div id="iss-po-body"></div>
  </div>
  <div class="card">
    <div class="card-title">Manual issue <span style="font-size:11px;font-weight:600;color:#111;background:#EFEFEF;padding:2px 8px;border-radius:10px;margin-left:6px">● Live</span></div>
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1;position:relative"><label>PO Number *</label>
        <input id="iss-po-ref" placeholder="Type PO number or pick from list…" autocomplete="off"
          oninput="window.filterPODrop(this.value)" onfocus="window.filterPODrop(this.value)" onblur="setTimeout(()=>window.hidePODrop(),200)">
        <div id="iss-po-drop" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:300;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.13);max-height:220px;overflow-y:auto;margin-top:3px"></div>
        <div id="iss-po-preview" style="margin-top:8px"></div>
      </div>
      <div class="field"><label>Issued To</label><input id="iss-to" value="Waqas (Stitching)" placeholder="Issued to…"></div>
      <div class="field"><label>Purpose / Notes</label><input id="iss-purpose" placeholder="Reason for issue"></div>
      <div class="field"><label>Date</label><input id="iss-date" type="date" value="${todayStr()}"></div>
    </div>
    <div style="margin-top:12px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>
          <th style="text-align:left;padding:6px 4px;border-bottom:2px solid var(--border);font-size:11px;color:var(--muted)">Item</th>
          <th style="padding:6px 4px;border-bottom:2px solid var(--border);font-size:11px;color:var(--muted);text-align:center">Stock</th>
          <th style="padding:6px 4px;border-bottom:2px solid var(--border);font-size:11px;color:var(--muted);text-align:center">Qty</th>
          <th style="padding:6px 4px;border-bottom:2px solid var(--border);width:36px"></th>
        </tr></thead>
        <tbody id="mi-tbody">${_miLines.map((l,i)=>`<tr id="mi-row-${i}">${_miRowCells(l,i)}</tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <button class="btn-outline" onclick="window._miAddRow()">+ Add item</button>
      <button class="btn-primary" id="mi-submit-btn" style="margin-top:0" onclick="window.submitIssueManual()">${_miSubmitLabel()}</button>
    </div>
  </div><div style="height:80px"></div>`;
}
function filterPODropMain(val){
  const dd=document.getElementById('iss-po-drop-main');if(!dd)return;
  const q=normPO(val);
  const matches=allActivePOs.filter(p=>normPO(p.id).includes(q)||(p.name||'').toLowerCase().includes(q));
  if(!matches.length||!val){dd.style.display='none';return;}
  dd.style.display='block';
  dd.innerHTML=matches.slice(0,10).map(p=>`<div onclick="window.selectPOMain('${p.id}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:13px" onmouseenter="this.style.background='#f5f5f5'" onmouseleave="this.style.background=''">
    <span style="font-weight:700;color:var(--red)">${p.id}</span>
    <span style="color:var(--muted);margin-left:6px;font-size:12px">${p.name||'—'} · ${p.currentStage||'—'}</span>
  </div>`).join('');
}
function hidePODropMain(){const dd=document.getElementById('iss-po-drop-main');if(dd)dd.style.display='none';}
function selectPOMain(poId){
  const inp=document.getElementById('iss-po');if(inp)inp.value=poId;
  hidePODropMain();
  onIssPoInput(poId.trim().toUpperCase().replace(/^PO[\s\-]?0*(\d+)$/,'PO-$1'));
}
async function onIssPoInput(raw){
  const normalized=raw.trim().toUpperCase().replace(/^PO[\s\-]?0*(\d+)$/,'PO-$1').replace(/^0*(\d+)$/,'PO-$1')||raw.trim().toUpperCase();
  const statusEl=document.getElementById('iss-po-status');
  const bodyEl=document.getElementById('iss-po-body');
  _poIssueData=null;
  if(!raw.trim()){statusEl.innerHTML='';bodyEl.innerHTML='';return;}
  statusEl.innerHTML='<span class="spinner"></span>';
  try{
    const matches=await fsQueryWhere('pos','id',normalized,1);
    if(!matches.length){statusEl.innerHTML='<span style="color:var(--muted)">PO not found</span>';bodyEl.innerHTML='';return;}
    const po=matches[0];
    statusEl.innerHTML=`<span style="color:var(--green);font-weight:600">✓ ${po.name||po.id} · ${po.qty||0} pcs</span>`;
    const tpl=allTemplates.find(t=>t.productCode&&po.code&&po.code===t.productCode)||(allTemplates.find(t=>t.productType&&po.name&&po.name.toLowerCase().includes(t.productType.toLowerCase())));
    if(!tpl||!tpl.items?.length){bodyEl.innerHTML=`<div class="alert-banner alert-amber">No trim template found for this product. Use manual issue below or create a template first.</div>`;return;}
    _poIssueData={po,tpl};renderPoIssueBody(po,tpl);
  }catch(e){statusEl.innerHTML=`<span style="color:#dc2626">Error: ${e.message}</span>`;}
}
function renderPoIssueBody(po,tpl){
  const qty=parseInt(po.qty)||1;
  const bodyEl=document.getElementById('iss-po-body');
  let rows='';
  for(const req of tpl.items){
    const item=allItems.find(i=>i.code===req.itemCode);if(!item)continue;
    const needed=Math.ceil((req.qtyPerPiece||req.qtyPerUnit||1)*qty);
    const bal=getBalance(item);const ok=bal>=needed;
    rows+=`<div class="issue-row">
      <div style="flex:1;min-width:0"><div><strong>${item.code}</strong> — ${item.name}</div>
        <div style="font-size:11px;color:var(--muted)">Need: ${needed} ${item.unit} · Stock: <span class="${ok?'stock-ok':'stock-low'}">${bal}</span></div></div>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;flex-shrink:0">
        <input type="checkbox" id="iss-chk-${safeId(item.code)}" ${ok?'checked':''} ${ok?'':'disabled'}> Issue</label>
    </div>`;
  }
  bodyEl.innerHTML=rows+`<button class="btn-primary" style="margin-top:10px" onclick="window.submitPoIssue()">Confirm issue for ${po.id}</button>`;
}
async function submitPoIssue(){
  if(!_poIssueData){showToast('No PO loaded.',true);return;}
  const{po,tpl}=_poIssueData;const qty=parseInt(po.qty)||1;
  const toIssue=tpl.items.filter(req=>document.getElementById('iss-chk-'+safeId(req.itemCode))?.checked);
  if(!toIssue.length){showToast('No items selected.',true);return;}
  try{
    for(const req of toIssue){
      const item=allItems.find(i=>i.code===req.itemCode);if(!item)continue;
      const needed=Math.ceil((req.qtyPerPiece||req.qtyPerUnit||1)*qty);
      const updated={...item};
      if(item.sizeSpecific){
        const szKeys=Object.keys(item.sizes||{});const perSz=Math.floor(needed/szKeys.length);
        const newSizes={...item.sizes};
        for(const sz of szKeys)newSizes[sz]=Math.max(0,(parseInt(newSizes[sz])||0)-perSz);
        updated.sizes=newSizes;
      }else{updated.balance=Math.max(0,(parseInt(item.balance)||0)-needed);}
      await fsSet('store_items',item.code,updated);
      await fsAdd('store_transactions',{type:'issued',itemCode:item.code,itemName:item.name,issuedTo:'Production',purpose:`PO ${po.id}`,date:todayStr(),by:session.name,ts:Date.now(),qty:needed,unit:item.unit,poId:po.id});
      const idx=allItems.findIndex(i=>i.code===item.code);if(idx>=0)allItems[idx]={...updated,_id:item.code};
    }
    showToast(`Items issued for ${po.id} ✓`);_poIssueData=null;
    document.getElementById('iss-po').value='';
    document.getElementById('iss-po-status').innerHTML='';
    document.getElementById('iss-po-body').innerHTML='';
  }catch(e){showToast('Error: '+e.message,true);}
}
function onIssItemChange(){}
async function loadActivePOs(){
  try{
    const snap=await fsList('pos',200);
    allActivePOs=snap.filter(p=>p.currentStage&&p.currentStage!=='completed').sort((a,b)=>b.ts-a.ts);
  }catch(e){}
}
function filterPODrop(val){
  const dd=document.getElementById('iss-po-drop');if(!dd)return;
  const q=normPO(val);
  const matches=allActivePOs.filter(p=>normPO(p.id).includes(q)||(p.name||'').toLowerCase().includes(q));
  if(!matches.length||!val){dd.style.display='none';return;}
  dd.style.display='block';
  dd.innerHTML=matches.slice(0,10).map(p=>`<div onclick="window.selectPO('${p.id}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:13px" onmouseenter="this.style.background='#f5f5f5'" onmouseleave="this.style.background=''">
    <span style="font-weight:700;color:var(--red)">${p.id}</span>
    <span style="color:var(--muted);margin-left:6px;font-size:12px">${p.name||'—'} · ${p.currentStage||'—'}</span>
  </div>`).join('');
}
function hidePODrop(){const dd=document.getElementById('iss-po-drop');if(dd)dd.style.display='none';}
function selectPO(poId){
  const inp=document.getElementById('iss-po-ref');if(inp)inp.value=poId;
  hidePODrop();lookupManualPO(poId);
}
async function lookupManualPO(raw){
  const el=document.getElementById('iss-po-preview');if(!el)return;
  const q=normPO(raw);if(!q){el.innerHTML='';return;}
  const normalized=raw.trim().toUpperCase().replace(/^PO[\s\-]?0*(\d+)$/,'PO-$1').replace(/^0*(\d+)$/,'PO-$1');
  el.innerHTML='<span style="font-size:12px;color:var(--muted)">Looking up…</span>';
  try{
    let po=allActivePOs.find(p=>normPO(p.id)===q||normPO(p.id)===normPO(normalized));
    if(!po){const matches=await fsQueryWhere('pos','id',normalized,1);if(!matches.length){el.innerHTML='<span style="font-size:12px;color:#dc2626">PO not found</span>';return;}po=matches[0];}
    const szs=['XS','S','M','L','XL','2XL'];
    const hasCut=po.cutQty&&szs.some(s=>po.cutQty[s]>0);
    const hasSizes=po.sizes&&szs.some(s=>po.sizes[s]>0);
    const stageLabel=po.currentStage?po.currentStage.charAt(0).toUpperCase()+po.currentStage.slice(1):'—';
    el.innerHTML=`<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px 14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:4px">
        <span style="font-weight:700;color:var(--green);font-size:13px">✓ ${po.name||po.id}</span>
        <span style="font-size:11px;background:#f0f0f0;color:#111;padding:2px 8px;border-radius:10px;font-weight:600">${stageLabel}</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">${po.qty||0} pcs total · ${po.fabric||'—'}</div>
      ${hasCut?`<div style="margin-bottom:6px"><div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Cut Qty</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${szs.filter(s=>po.cutQty[s]>0).map(s=>`<div style="text-align:center;min-width:38px;padding:5px 8px;background:#fff;border-radius:6px;border:1px solid #86efac"><div style="font-size:9px;color:var(--muted)">${s}</div><div style="font-size:14px;font-weight:700;color:var(--dark)">${po.cutQty[s]}</div></div>`).join('')}</div></div>`:''}
      ${hasSizes&&!hasCut?`<div><div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Order Qty (not yet cut)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${szs.filter(s=>po.sizes[s]>0).map(s=>`<div style="text-align:center;min-width:38px;padding:5px 8px;background:#fff;border-radius:6px;border:1px solid #d1d5db"><div style="font-size:9px;color:var(--muted)">${s}</div><div style="font-size:14px;font-weight:700;color:var(--muted)">${po.sizes[s]}</div></div>`).join('')}</div></div>`:''}
      ${!hasCut&&!hasSizes?`<div style="font-size:12px;color:var(--muted)">No size/cut data available yet.</div>`:''}
    </div>`;
  }catch(e){el.innerHTML=`<span style="font-size:12px;color:#dc2626">Error: ${e.message}</span>`;}
}
async function submitIssueManual(){
  const poRefRaw=(document.getElementById('iss-po-ref')?.value||'').trim().toUpperCase();
  const poRef=poRefRaw.replace(/^PO[\s\-]?0*(\d+)$/,'PO-$1').replace(/^0*(\d+)$/,'PO-$1')||poRefRaw;
  if(!poRef){showToast('PO Number is required.',true);document.getElementById('iss-po-ref')?.focus();return;}
  const issuedTo=(document.getElementById('iss-to')?.value||'').trim();
  const purpose=(document.getElementById('iss-purpose')?.value||'').trim();
  const date=document.getElementById('iss-date')?.value||todayStr();
  const codes=new Set();
  for(let i=0;i<_miLines.length;i++){
    const l=_miLines[i];
    if(!l.itemCode){showToast(`Row ${i+1}: select an item.`,true);return;}
    if(codes.has(l.itemCode)){showToast(`Row ${i+1}: duplicate item (${l.itemCode}).`,true);return;}
    codes.add(l.itemCode);
    const qty=parseFloat(l.qty)||0;
    if(!qty){showToast(`Row ${i+1}: quantity must be > 0.`,true);return;}
    const it=allItems.find(x=>x.code===l.itemCode);
    if(!it){showToast(`Row ${i+1}: item ${l.itemCode} not found.`,true);return;}
    if(!it.sizeSpecific&&qty>getBalance(it)){showToast(`Row ${i+1}: insufficient stock for ${l.itemCode} (have ${getBalance(it)}).`,true);return;}
  }
  const btn=document.getElementById('mi-submit-btn');if(btn){btn.disabled=true;btn.textContent='Issuing…';}
  const rollback=[];
  try{
    for(const l of _miLines){
      const item=allItems.find(x=>x.code===l.itemCode);
      const qty=parseFloat(l.qty);
      const updated={...item};
      const oldBalance=item.sizeSpecific?{...item.sizes}:item.balance;
      if(item.sizeSpecific){
        const ns={...item.sizes};const keys=Object.keys(ns);const per=Math.floor(qty/keys.length);
        keys.forEach(sz=>{ns[sz]=Math.max(0,(parseInt(ns[sz])||0)-per);});
        updated.sizes=ns;
      }else{updated.balance=Math.max(0,(parseInt(item.balance)||0)-qty);}
      await fsSet('store_items',item.code,updated);
      rollback.push({item,oldBalance});
      const txData={type:'issued',itemCode:item.code,itemName:item.name,issuedTo,purpose,date,by:session.name,ts:Date.now(),qty,unit:item.unit,poRef};
      const txId=await fsAdd('store_transactions',txData);
      const idx=allItems.findIndex(x=>x.code===item.code);if(idx>=0)allItems[idx]={...updated,_id:item.code};
      allTransactions.unshift({...txData,_id:txId});
    }
    _miLines=[{itemCode:'',qty:''}];
    showToast(`${rollback.length} item(s) issued ✓`);renderStoreSection('issue');
  }catch(e){
    for(const{item,oldBalance}of rollback){
      const idx=allItems.findIndex(x=>x.code===item.code);
      if(idx>=0){if(item.sizeSpecific)allItems[idx].sizes=oldBalance;else allItems[idx].balance=oldBalance;}
    }
    showToast('Error: '+e.message,true);
    if(btn){btn.disabled=false;btn.textContent=_miSubmitLabel();}
  }
}

function renderStoreTemplates(){
  const canEdit=session.role==='owner'||session.role==='manager'||session.role==='store';
  const total=allTemplates.length;
  const maxPages=Math.ceil(total/TPL_PER)||1;
  if(_tplPage>maxPages)_tplPage=maxPages;
  const slice=allTemplates.slice((_tplPage-1)*TPL_PER,_tplPage*TPL_PER);
  const editLabel=_tplEditId?'Update Template':'Save Template';
  const editBanner=_tplEditId?`<div style="font-size:12px;background:#FEF3C7;color:#92400e;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-weight:600">✏️ Editing template — make changes then click Update Template. <button onclick="window.cancelTplEdit()" style="background:none;border:none;color:#92400e;cursor:pointer;font-size:12px;text-decoration:underline;font-family:inherit">Cancel</button></div>`:'';
  return`<div class="page-head"><div class="page-title">Trim Templates</div><div class="page-sub">Auto-deducts trims from store when a PO is created</div></div>
  <div class="card" id="tpl-form-card">
    <div class="card-title">Create template</div>
    ${editBanner}
    <div class="form-grid">
      <div class="field" style="grid-column:1/-1;position:relative"><label>Product *</label>
        <input id="tpl-prod-search" placeholder="Type product code or name e.g. GH001 or Black Hoodie…" autocomplete="off"
          onblur="setTimeout(()=>{const d=document.getElementById('tpl-prod-dd');if(d)d.style.display='none'},300)">
        <div id="tpl-prod-dd" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:300;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.13);max-height:220px;overflow-y:auto;margin-top:3px"></div>
        <div id="tpl-prod-sel" style="margin-top:6px;font-size:12px;color:var(--green);font-weight:600"></div>
      </div>
    </div>
    <div style="margin-top:12px">
      <div class="section-title" style="margin-bottom:8px">Trim requirements <span style="font-size:11px;font-weight:400;color:var(--muted)">(qty per piece × PO qty = auto-issued)</span></div>
      <div id="tpl-rows"></div>
      <button class="btn-outline" style="width:100%;margin-top:6px" onclick="window.addTplRow()">+ Add trim item</button>
    </div>
    <button class="btn-primary" style="margin-top:10px" onclick="window.submitTemplate()">${editLabel}</button>
  </div>
  ${total?`<div class="card">
    <div class="card-title">Saved templates (${total})</div>
    ${slice.map(t=>`<div style="padding:12px 0;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-weight:700;color:var(--dark);font-size:13px">${t.productCode||'—'}</span>
            <span style="font-size:12px;color:var(--muted)">${t.productName||t.productType||'—'}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;display:flex;flex-wrap:wrap;gap:6px">
            ${(t.items||[]).map(i=>`<span style="background:#f0f0f0;padding:2px 8px;border-radius:8px">${i.itemCode} × ${i.qtyPerPiece||i.qtyPerUnit||1}/pc${i.pricePerUnit?` @ Rs.${i.pricePerUnit}`:''}</span>`).join('')||'No items'}
          </div>
          ${(()=>{const tot=(t.items||[]).reduce((s,i)=>s+(i.pricePerUnit||0)*(i.qtyPerPiece||1),0);return tot?`<div style="font-size:11px;color:var(--dark);font-weight:600;margin-top:4px">Cost/pc: Rs.${tot.toFixed(2)}</div>`:''})()}
          <div style="font-size:10px;color:var(--green);margin-top:4px">⚡ Auto-deducts on PO creation</div>
        </div>
        ${canEdit?`<div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn-outline" style="font-size:12px;padding:5px 10px" onclick="window.editTemplate('${t._id}')">Edit</button>
          <button class="btn-danger" style="font-size:12px;padding:5px 10px" onclick="window.deleteTemplate('${t._id}')">Delete</button>
        </div>`:''}
      </div>
    </div>`).join('')}
    ${maxPages>1?`<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding-top:12px;border-top:1px solid #f5f5f5;margin-top:4px">
      <button onclick="window.tplPagePrev()" ${_tplPage===1?'disabled':''} style="padding:5px 14px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit">← Prev</button>
      <span style="font-size:12px;color:var(--muted)">Page ${_tplPage} of ${maxPages}</span>
      <button onclick="window.tplPageNext()" ${_tplPage===maxPages?'disabled':''} style="padding:5px 14px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit">Next →</button>
    </div>`:''}
  </div>`:'<div class="card"><div class="empty">No templates yet. Create one above.</div></div>'}
  <div style="height:80px"></div>`;
}
function filterTplProd(q){
  const dd=document.getElementById('tpl-prod-dd');if(!dd)return;
  if(!q){dd.style.display='none';return;}
  const ql=q.toLowerCase();
  const matches=PRODUCT_CATALOG.filter(p=>p.code.toLowerCase().includes(ql)||p.name.toLowerCase().includes(ql));
  if(!matches.length){dd.style.display='none';return;}
  dd.style.display='block';
  dd.innerHTML=matches.slice(0,12).map(p=>`<div onclick="window.selectTplProd('${p.code}','${p.name.replace(/'/g,'&#39;')}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:13px" onmouseenter="this.style.background='#f5f5f5'" onmouseleave="this.style.background=''">
    <span style="font-weight:700;color:var(--red)">${p.code}</span>
    <span style="color:var(--muted);margin-left:8px;font-size:12px">${p.name}</span>
  </div>`).join('');
}
function selectTplProd(code,name){
  _tplProdCode=code;_tplProdName=name;
  const inp=document.getElementById('tpl-prod-search');if(inp)inp.value=code+' — '+name;
  const dd=document.getElementById('tpl-prod-dd');if(dd)dd.style.display='none';
  const sel=document.getElementById('tpl-prod-sel');if(sel)sel.textContent='✓ '+code+' — '+name;
}
function _tplItemRowHTML(rowId,itemCode='',itemName='',qty=1,price=''){
  return`
    <div class="field" style="flex:2;min-width:150px;position:relative"><label>Trim item</label>
      <input class="tpl-item-search" placeholder="Search item code or name…" autocomplete="off"
        value="${itemCode?(itemCode+(itemName?' — '+itemName:'')):''}">
      <div class="tpl-item-dd" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:400;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;margin-top:2px"></div>
      <input type="hidden" class="tpl-item-code" value="${itemCode}">
      <input type="hidden" class="tpl-item-name" value="${itemName}">
    </div>
    <div class="field" style="width:80px"><label>Qty / pc</label>
      <input type="number" min="0.01" step="0.01" value="${qty}" placeholder="1" class="tpl-qty"></div>
    <div class="field" style="width:90px"><label>Price / unit</label>
      <input type="number" min="0" step="0.01" value="${price}" placeholder="Rs." class="tpl-price"></div>
    <button onclick="document.getElementById('${rowId}').remove()" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;align-self:flex-end;padding:0 4px;margin-bottom:2px">×</button>`;
}
function _attachTplItemSearch(div){
  const inp=div.querySelector('.tpl-item-search');
  const dd=div.querySelector('.tpl-item-dd');
  const codeH=div.querySelector('.tpl-item-code');
  const nameH=div.querySelector('.tpl-item-name');
  if(!inp||!dd)return;
  function doFilter(q){
    const ql=q.toLowerCase();
    const matches=allItems.filter(i=>i.code.toLowerCase().includes(ql)||i.name.toLowerCase().includes(ql));
    if(!q||!matches.length){dd.style.display='none';return;}
    dd.style.display='block';
    dd.innerHTML=matches.slice(0,15).map(i=>`<div data-code="${i.code}" data-name="${i.name.replace(/"/g,'&quot;')}" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:13px" onmouseenter="this.style.background='#f5f5f5'" onmouseleave="this.style.background=''">
      <span style="font-weight:700;color:var(--red);font-size:12px">${i.code}</span>
      <span style="color:var(--muted);margin-left:8px;font-size:12px">${i.name}</span>
    </div>`).join('');
    dd.querySelectorAll('[data-code]').forEach(el=>{
      el.addEventListener('mousedown',e=>{
        e.preventDefault();
        inp.value=el.dataset.code+' — '+el.dataset.name;
        codeH.value=el.dataset.code;
        nameH.value=el.dataset.name;
        dd.style.display='none';
      });
    });
  }
  inp.addEventListener('input',()=>doFilter(inp.value));
  inp.addEventListener('focus',()=>doFilter(inp.value));
  inp.addEventListener('blur',()=>setTimeout(()=>{dd.style.display='none';},200));
}
function addTplRow(){
  _tplRowIdx++;const rowId='tpl-row-'+_tplRowIdx;
  const div=document.createElement('div');div.id=rowId;div.className='tpl-item-row';
  div.innerHTML=_tplItemRowHTML(rowId);
  document.getElementById('tpl-rows')?.appendChild(div);
  _attachTplItemSearch(div);
}
async function submitTemplate(){
  if(!_tplProdCode){showToast('Select a product from the search.',true);document.getElementById('tpl-prod-search')?.focus();return;}
  const rows=document.querySelectorAll('#tpl-rows .tpl-item-row');
  if(!rows.length){showToast('Add at least one trim item.',true);return;}
  const items=[];let _missingPrice=false;
  rows.forEach(row=>{
    const codeH=row.querySelector('.tpl-item-code');const nameH=row.querySelector('.tpl-item-name');
    const qtyInp=row.querySelector('.tpl-qty');const priceInp=row.querySelector('.tpl-price');
    const pricePerUnit=parseFloat(priceInp?.value)||0;
    if(!pricePerUnit){_missingPrice=true;priceInp?.focus();}
    if(codeH?.value)items.push({itemCode:codeH.value,itemName:nameH?.value||codeH.value,qtyPerPiece:parseFloat(qtyInp?.value)||1,pricePerUnit});
  });
  if(_missingPrice){showToast('Price per unit is required for all items.',true);return;}
  if(!confirm(`${_tplEditId?'Update':'Save'} trim template for ${_tplProdCode} — ${_tplProdName}?\n\n${items.map(i=>`${i.itemCode} × ${i.qtyPerPiece}/pc @ Rs.${i.pricePerUnit||'—'}`).join('\n')}`))return;
  try{
    if(_tplEditId){
      // Edit mode: update in-place
      const payload={productCode:_tplProdCode,productName:_tplProdName,productType:_tplProdName,items,updatedBy:session.name,updatedAt:Date.now()};
      await fsSet('trim_templates',_tplEditId,payload);
      const idx=allTemplates.findIndex(t=>t._id===_tplEditId);
      if(idx>-1)allTemplates[idx]={...allTemplates[idx],...payload};
      showToast('Template updated ✓');
    }else{
      // Create mode: check duplicate
      const existing=allTemplates.find(t=>t.productCode===_tplProdCode);
      if(existing&&!confirm(`A template for ${_tplProdCode} already exists. Replace it?`))return;
      if(existing){await fsDelete('trim_templates',existing._id);allTemplates=allTemplates.filter(t=>t._id!==existing._id);}
      const id=await fsAdd('trim_templates',{productCode:_tplProdCode,productName:_tplProdName,productType:_tplProdName,items,createdBy:session.name,createdAt:Date.now()});
      allTemplates.push({productCode:_tplProdCode,productName:_tplProdName,productType:_tplProdName,items,createdBy:session.name,createdAt:Date.now(),_id:id});
      showToast('Template saved ✓');
    }
    _tplRowIdx=0;_tplProdCode='';_tplProdName='';_tplEditId=null;
    renderStoreSection('templates');
  }catch(e){showToast('Error: '+e.message,true);}
}
function editTemplate(id){
  const t=allTemplates.find(x=>x._id===id);if(!t)return;
  _tplEditId=id;_tplProdCode=t.productCode||'';_tplProdName=t.productName||t.productType||'';
  renderStoreSection('templates');
  // Pre-fill product search
  const inp=document.getElementById('tpl-prod-search');
  const sel=document.getElementById('tpl-prod-sel');
  if(inp)inp.value=_tplProdCode+(_tplProdName?' — '+_tplProdName:'');
  if(sel)sel.textContent='✓ '+_tplProdCode+' — '+_tplProdName;
  // Pre-fill trim rows
  const container=document.getElementById('tpl-rows');if(!container)return;
  container.innerHTML='';_tplRowIdx=0;
  (t.items||[]).forEach(item=>{
    _tplRowIdx++;const rowId='tpl-row-'+_tplRowIdx;
    const div=document.createElement('div');div.id=rowId;div.className='tpl-item-row';
    div.innerHTML=_tplItemRowHTML(rowId,item.itemCode||'',item.itemName||'',item.qtyPerPiece||1,item.pricePerUnit||'');
    container.appendChild(div);
    _attachTplItemSearch(div);
  });
  // Scroll to form
  document.getElementById('tpl-form-card')?.scrollIntoView({behavior:'smooth',block:'start'});
}
window.cancelTplEdit=function(){_tplEditId=null;_tplProdCode='';_tplProdName='';_tplRowIdx=0;renderStoreSection('templates');};
window.tplPagePrev=function(){if(_tplPage>1){_tplPage--;renderStoreSection('templates');}};
window.tplPageNext=function(){_tplPage++;renderStoreSection('templates');};
async function deleteTemplate(id){
  if(!confirm('Delete this template? This cannot be undone.'))return;
  try{
    await fsDelete('trim_templates',id);allTemplates=allTemplates.filter(t=>t._id!==id);
    showToast('Template deleted');renderStoreSection('templates');
  }catch(e){showToast('Error: '+e.message,true);}
}

function renderStoreLog(){
  return`<div class="page-head"><div class="page-title">Log</div><div class="page-sub">${allTransactions.length} movements</div></div>
  <div class="card">
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;flex-shrink:0">
        <button id="il-all"  onclick="window.setILDir('')"          style="padding:8px 14px;font-size:12px;font-weight:600;font-family:inherit;border:none;cursor:pointer;background:var(--dark);color:#fff">All</button>
        <button id="il-in"   onclick="window.setILDir('received')"  style="padding:8px 14px;font-size:12px;font-weight:600;font-family:inherit;border:none;cursor:pointer;background:#fff;color:var(--muted)">▲ Inbound</button>
        <button id="il-out"  onclick="window.setILDir('issued')"    style="padding:8px 14px;font-size:12px;font-weight:600;font-family:inherit;border:none;cursor:pointer;background:#fff;color:var(--muted)">▼ Outbound</button>
      </div>
      <input id="il-q"  placeholder="Search item, person…" oninput="window.setILQ(this.value)"  style="flex:1;min-width:120px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
      <input id="il-po" placeholder="Filter PO…"           oninput="window.setILPO(this.value)" style="width:100px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none">
    </div>
    <div id="il-body"></div>
    <div id="il-pager" style="display:flex;align-items:center;justify-content:center;gap:10px;padding-top:12px;border-top:1px solid #f5f5f5;margin-top:4px"></div>
  </div><div style="height:80px"></div>`;
}
function setILDir(dir){
  _ilDir=dir;_ilPage=1;
  ['il-all','il-in','il-out'].forEach(id=>{
    const btn=document.getElementById(id);if(!btn)return;
    const active=(id==='il-all'&&dir==='')||(id==='il-in'&&dir==='received')||(id==='il-out'&&dir==='issued');
    btn.style.background=active?'var(--dark)':'#fff';btn.style.color=active?'#fff':'var(--muted)';
  });refreshIssueLog();
}
function refreshIssueLog(){
  const ql=_ilQ.toLowerCase();const poq=normPO(_ilPO);
  let list=allTransactions;
  if(_ilDir)list=list.filter(t=>t.type===_ilDir);
  if(ql)list=list.filter(t=>(t.itemName||'').toLowerCase().includes(ql)||(t.itemCode||'').toLowerCase().includes(ql)||(t.issuedTo||'').toLowerCase().includes(ql)||(t.supplier||'').toLowerCase().includes(ql));
  if(poq)list=list.filter(t=>normPO(t.poRef||t.poId||'').includes(poq));
  const total=list.length;const maxPages=Math.min(IL_MAX_PAGES,Math.ceil(total/IL_PER)||1);
  if(_ilPage>maxPages)_ilPage=maxPages;
  const slice=list.slice((_ilPage-1)*IL_PER,_ilPage*IL_PER);
  const body=document.getElementById('il-body');const pager=document.getElementById('il-pager');if(!body)return;
  if(!slice.length){body.innerHTML='<div class="empty">No records found.</div>';if(pager)pager.innerHTML='';return;}
  body.innerHTML=slice.map(tx=>{
    const isIn=tx.type==='received';
    return`<div class="tx-row">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:700;color:${isIn?'var(--green)':'var(--red)'}">${isIn?'▲ INBOUND':'▼ OUTBOUND'}</span>
          <span style="font-size:11px;font-weight:700">${tx.itemCode||'—'}</span>
          ${tx.poRef||tx.poId?`<span style="font-size:10px;font-weight:700;background:#f0f0f0;color:#111;padding:2px 7px;border-radius:8px">${tx.poRef||tx.poId}</span>`:''}
        </div>
        <div style="font-size:13px;font-weight:500;margin-top:2px">${tx.itemName||'—'}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:1px">${isIn?`From: ${tx.supplier||'—'}`:`To: ${tx.issuedTo||'—'}`}${tx.purpose?` · ${tx.purpose}`:''}${tx.notes?` · ${tx.notes}`:''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:16px;font-weight:700;color:${isIn?'var(--green)':'var(--red)'}">${isIn?'+':'−'}${tx.qty||0} <span style="font-size:11px;font-weight:400;color:var(--muted)">${tx.unit||'pcs'}</span></div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${tx.date||''}</div>
        <div style="font-size:10px;color:var(--muted)">${tx.by||'—'}</div>
      </div>
    </div>`;
  }).join('');
  if(pager){
    if(maxPages<=1){pager.innerHTML='';return;}
    pager.innerHTML=`
      <button onclick="window.ilPagePrev()" ${_ilPage===1?'disabled':''} style="padding:5px 14px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit">← Prev</button>
      <span style="font-size:12px;color:var(--muted)">Page ${_ilPage} of ${maxPages}</span>
      <button onclick="window.ilPageNext()" ${_ilPage===maxPages?'disabled':''} style="padding:5px 14px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-family:inherit">Next →</button>`;
  }
}

function renderStoreDashboard(){
  const lowStock=allItems.filter(i=>getStatus(i)!=='green');
  const pendingPirs=allPoIssueRequests.filter(r=>r.status!=='fully_issued');
  const recent=allTransactions.slice(0,10);
  return`<div class="page-head"><div class="page-title">Store Dashboard</div><div class="page-sub">Welcome, ${session.name}</div></div>
  ${pendingPirs.length?`<div class="card" style="border-left:3px solid var(--red)">
    <div class="card-title">Pending PO Issue Requests (${pendingPirs.length})</div>
    ${pendingPirs.slice(0,5).map(r=>`<div class="req-card">
      <div class="req-head">
        <div><div style="font-weight:700;color:var(--red);font-size:13px">${r.poId||'—'}</div>
          <div style="font-size:11px;color:var(--muted)">${r.poName||'—'} · ${r.poQty||0} pcs</div></div>
        <button class="btn-sm" onclick="window.openPoIssueDetail('${r.id}')">Issue →</button>
      </div>
      <div style="font-size:11px;color:var(--muted)">${(r.snapshot||[]).filter(l=>l.issued<l.required).length} item(s) remaining</div>
    </div>`).join('')}
    ${pendingPirs.length>5?`<div style="text-align:center;margin-top:6px"><button class="btn-sm" onclick="window.showPage('po-issue-list')">View all ${pendingPirs.length} requests</button></div>`:''}
  </div>`:`<div class="card"><div class="card-title">PO Issue Requests</div><div class="empty" style="padding:1rem">No pending requests ✓</div></div>`}
  ${lowStock.length?`<div class="card" style="border-left:3px solid var(--amber)">
    <div class="card-title">⚠ Low / Out of Stock (${lowStock.length})</div>
    ${lowStock.slice(0,10).map(i=>`<div class="info-row">
      <span><strong>${i.code}</strong> — ${i.name}</span>
      <span class="badge badge-${getStatus(i)}">${getBalance(i)} ${i.unit}</span>
    </div>`).join('')}
    ${lowStock.length>10?`<div style="font-size:11px;color:var(--muted);padding-top:6px">+${lowStock.length-10} more items below threshold</div>`:''}
  </div>`:'<div class="alert-banner alert-green">All items are in stock ✓</div>'}
  ${(session.u==='afnan')?`<div class="card" style="border-left:3px solid #dc2626">
    <div class="card-title">⚠ Admin — Danger Zone</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Overwrites ALL live balances with the hardcoded master list (${INITIAL_ITEMS.length} items). Wipes any unrecorded updates Raees has made. Use only after a verified full physical count.</div>
    <button class="btn-primary" onclick="window.syncStoreItems()">⟳ Apply Stock Update</button>
    <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--border)">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">One-shot recovery: replays every receive/issue in <code>store_transactions</code> on top of the May-1 seed and shows you a current-vs-reconstructed comparison before any write.</div>
      <button class="btn-sm" onclick="window.reconstructStockPreview()">↺ Preview Reconstruction</button>
    </div>
  </div>`:''}
  <div class="card">
    <div class="card-title">Recent Activity (last 10)</div>
    ${recent.length?recent.map(tx=>{const isIn=tx.type==='received';return`<div class="tx-row">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:700;color:${isIn?'var(--green)':'var(--red)'}">${isIn?'▲ IN':'▼ OUT'}</span>
          <span style="font-size:11px;font-weight:700">${tx.itemCode||'—'}</span>
        </div>
        <div style="font-size:13px;margin-top:1px">${tx.itemName||'—'}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-weight:700;color:${isIn?'var(--green)':'var(--red)'}">${isIn?'+':'−'}${tx.qty||0} ${tx.unit||'pcs'}</div>
        <div style="font-size:10px;color:var(--muted)">${tx.date||''}</div>
      </div>
    </div>`;}).join(''):'<div class="empty" style="padding:1rem">No transactions yet.</div>'}
  </div>
  <div style="height:80px"></div>`;
}

async function syncStoreItems(){
  if(!session||session.u!=='afnan'){showToast('Only Afnan can run a full stock overwrite.',true);return;}
  const phrase=prompt(`⚠ DANGER — Full Stock Overwrite\n\nThis REPLACES all live balances for ${INITIAL_ITEMS.length} items with the hardcoded master list. Any of Raees's recent updates that are not in the master list will be permanently lost.\n\nType OVERWRITE STOCK (in caps) to confirm:`);
  if(phrase!=='OVERWRITE STOCK'){showToast('Cancelled — phrase did not match.',true);return;}
  if(!confirm(`Last chance. Overwrite ${INITIAL_ITEMS.length} items with master values now?`))return;
  showToast('Syncing inventory…');
  try{
    await Promise.all(INITIAL_ITEMS.map(item=>fsSet('store_items',item.code,item).catch(e=>console.warn('Sync fail:',item.code,e))));
    const items=await fsList('store_items');
    allItems=items;
    await logActivity('⚠ Stock overwritten from master',`${INITIAL_ITEMS.length} items reset to seed values by ${session.name}`).catch(()=>{});
    showToast(`Inventory synced ✓ — ${INITIAL_ITEMS.length} items updated`);
    window.showPage('store-inventory');
  }catch(e){showToast('Sync error: '+e.message,true);}
}
window.syncStoreItems=syncStoreItems;

// ══════════════════════════════════════════
// ONE-SHOT RECONSTRUCTION FROM TRANSACTION LOG
// Replays every store_transactions row on top of INITIAL_ITEMS (May-1
// seed) so afnan can recover from the accidental Apply-Stock-Update
// overwrite. Direct edits via the Edit-item dialog are NOT in the log,
// so reconstructed totals are approximations — preview before applying.
// ══════════════════════════════════════════
async function _fsListAll(col,batchSize=1000){
  const tok=await getStoreToken();
  const out=[];let pageToken='';
  do{
    const url=`${_FS_BASE}/${col}?pageSize=${batchSize}${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`;
    const r=await fetch(url,{headers:{Authorization:`Bearer ${tok}`}});
    const d=await r.json();
    if(d.documents)out.push(...d.documents.map(fromFsDoc));
    pageToken=d.nextPageToken||'';
  }while(pageToken);
  return out;
}

function _reconstructFromTxns(txns){
  const seed=new Map();
  for(const it of INITIAL_ITEMS)seed.set(it.code,JSON.parse(JSON.stringify(it)));
  const recon=new Map();
  for(const[k,v]of seed)recon.set(k,JSON.parse(JSON.stringify(v)));
  const sorted=[...txns].sort((a,b)=>(a.ts||0)-(b.ts||0));
  for(const tx of sorted){
    const code=tx.itemCode;if(!code)continue;
    const sign=tx.type==='received'?+1:tx.type==='issued'?-1:0;
    if(!sign)continue;
    let item=recon.get(code);
    if(!item){
      const cur=allItems.find(i=>i.code===code);if(!cur)continue;
      item=JSON.parse(JSON.stringify(cur));
      if(item.sizeSpecific&&item.sizes){for(const sz of Object.keys(item.sizes))item.sizes[sz]=0;}
      else item.balance=0;
      recon.set(code,item);
    }
    const qty=parseInt(tx.qty)||0;
    if(item.sizeSpecific&&item.sizes){
      const keys=Object.keys(item.sizes);if(!keys.length)continue;
      const per=Math.floor(qty/keys.length);
      for(const k of keys)item.sizes[k]=Math.max(0,(parseInt(item.sizes[k])||0)+sign*per);
    }else{
      item.balance=Math.max(0,(parseInt(item.balance)||0)+sign*qty);
    }
  }
  return recon;
}

window.reconstructStockPreview=async function(){
  if(!session||session.u!=='afnan'){showToast('Restricted to Afnan',true);return;}
  showToast('Loading all transactions…');
  let txns;
  try{txns=await _fsListAll('store_transactions');}
  catch(e){showToast('Load failed: '+e.message,true);return;}
  const recon=_reconstructFromTxns(txns);
  const rows=[];
  for(const cur of allItems){
    const r=recon.get(cur.code);
    const curBal=getBalance(cur);
    const reconBal=r?getBalance(r):null;
    const delta=reconBal===null?null:reconBal-curBal;
    rows.push({code:cur.code,name:cur.name,unit:cur.unit||'pcs',current:curBal,reconstructed:reconBal,delta,sized:!!cur.sizeSpecific,curSizes:cur.sizes||null,reconSizes:r?.sizes||null,inSeed:!!INITIAL_ITEMS.find(s=>s.code===cur.code)});
  }
  rows.sort((a,b)=>{
    if(a.delta===null&&b.delta===null)return a.code.localeCompare(b.code);
    if(a.delta===null)return 1;if(b.delta===null)return -1;
    return Math.abs(b.delta)-Math.abs(a.delta);
  });
  _showReconstructionModal(rows,recon,txns.length);
};

function _showReconstructionModal(rows,recon,txCount){
  document.getElementById('_recon-modal')?.remove();
  const changed=rows.filter(r=>r.delta!==null&&r.delta!==0).length;
  const noBaseline=rows.filter(r=>r.reconstructed===null).length;
  const m=document.createElement('div');
  m.id='_recon-modal';
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2300;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML=`<div style="background:#fff;border-radius:14px;width:100%;max-width:880px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 16px 56px rgba(0,0,0,.3)">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:700;font-size:15px">Reconstruction Preview</div>
        <div style="font-size:11px;color:var(--muted)">${txCount} transactions replayed · ${changed} items would change · ${noBaseline} item(s) not in May-1 seed</div>
      </div>
      <button onclick="document.getElementById('_recon-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
    </div>
    <div style="padding:10px 14px;background:#fff7ed;border-bottom:1px solid #fed7aa;font-size:12px;color:#7c2d12">
      ⚠ This rebuild does not capture direct balance edits done via the per-item Edit dialog (those don't write to <code>store_transactions</code>). Compare numbers with Raees before hitting Apply.
    </div>
    <div style="overflow:auto;flex:1;padding:0 14px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="position:sticky;top:0;background:#fff;border-bottom:2px solid #111">
          <tr><th style="text-align:left;padding:8px 6px">Code</th><th style="text-align:left;padding:8px 6px">Name</th><th style="text-align:right;padding:8px 6px">Current</th><th style="text-align:right;padding:8px 6px">Reconstructed</th><th style="text-align:right;padding:8px 6px">Δ</th></tr>
        </thead>
        <tbody>
        ${rows.map(r=>{
          const dStyle=r.delta===null?'color:var(--muted)':r.delta>0?'color:#16a34a;font-weight:700':r.delta<0?'color:#dc2626;font-weight:700':'color:var(--muted)';
          const dTxt=r.delta===null?'no seed':(r.delta>0?'+':'')+r.delta;
          return`<tr style="border-bottom:1px solid #f0f0f0">
            <td style="padding:6px;font-weight:700">${r.code}</td>
            <td style="padding:6px">${r.name}${r.sized?' <span style="font-size:10px;color:var(--muted)">(sized)</span>':''}${r.inSeed?'':' <span style="font-size:10px;color:#7c2d12">[not in seed]</span>'}</td>
            <td style="padding:6px;text-align:right">${r.current} ${r.unit}</td>
            <td style="padding:6px;text-align:right">${r.reconstructed===null?'—':r.reconstructed+' '+r.unit}</td>
            <td style="padding:6px;text-align:right;${dStyle}">${dTxt}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end;align-items:center">
      <button class="btn-sm" onclick="window._exportReconCsv()">Download CSV</button>
      <button class="btn-sm" onclick="document.getElementById('_recon-modal').remove()">Close</button>
      <button class="btn-primary" onclick="window._applyReconstruction()">Apply Reconstruction</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  window._reconRows=rows;window._reconMap=recon;
}

window._exportReconCsv=function(){
  const rows=window._reconRows||[];if(!rows.length)return;
  const lines=['code,name,unit,current,reconstructed,delta,in_seed'];
  for(const r of rows)lines.push([r.code,JSON.stringify(r.name),r.unit,r.current,r.reconstructed===null?'':r.reconstructed,r.delta===null?'':r.delta,r.inSeed?'yes':'no'].join(','));
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`stock-reconstruction-${todayStr()}.csv`;a.click();
  URL.revokeObjectURL(url);
};

window._applyReconstruction=async function(){
  if(!session||session.u!=='afnan'){showToast('Restricted to Afnan',true);return;}
  const recon=window._reconMap;if(!recon||!recon.size){showToast('Nothing to apply.',true);return;}
  const phrase=prompt(`⚠ APPLY RECONSTRUCTION\n\nThis will overwrite the live balances of ${recon.size} items with the reconstructed values. Items missing from the seed are left untouched.\n\nType APPLY RECONSTRUCTION (in caps) to confirm:`);
  if(phrase!=='APPLY RECONSTRUCTION'){showToast('Cancelled — phrase did not match.',true);return;}
  showToast('Applying reconstruction…');
  let ok=0,fail=0;
  for(const cur of allItems){
    const r=recon.get(cur.code);if(!r)continue;
    const updated={...cur};
    if(cur.sizeSpecific&&r.sizes)updated.sizes=r.sizes;
    else if(!cur.sizeSpecific&&typeof r.balance==='number')updated.balance=r.balance;
    else continue;
    delete updated._id;
    try{await fsSet('store_items',cur.code,updated);ok++;
      const idx=allItems.findIndex(i=>i.code===cur.code);if(idx>=0)allItems[idx]={...updated,_id:cur.code};
    }catch(e){fail++;console.warn('Recon write fail',cur.code,e);}
  }
  await logActivity('Stock reconstructed from transactions',`${ok} updated, ${fail} failed (by ${session.name})`).catch(()=>{});
  document.getElementById('_recon-modal')?.remove();
  showToast(`Reconstruction applied ✓ — ${ok} updated${fail?', '+fail+' failed':''}`);
  window.showPage('store-inventory');
};

// ══════════════════════════════════════════
const _FS_BASE=`https://firestore.googleapis.com/v1/projects/groovy-gatepass/databases/(default)/documents`;

async function getStoreToken(){
  if(!auth.currentUser)throw new Error('Not signed in');
  return await auth.currentUser.getIdToken(false);
}
function fsVal(v){
  if(v===null||v===undefined)return{nullValue:null};
  if(typeof v==='boolean')return{booleanValue:v};
  if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(typeof v==='string')return{stringValue:v};
  if(Array.isArray(v))return{arrayValue:{values:v.map(fsVal)}};
  if(typeof v==='object')return{mapValue:{fields:toFsFields(v)}};
  return{nullValue:null};
}
function toFsFields(obj){
  const f={};
  for(const[k,v]of Object.entries(obj))f[k]=fsVal(v);
  return f;
}
function fromFsVal(v){
  if('nullValue'in v)return null;
  if('booleanValue'in v)return v.booleanValue;
  if('integerValue'in v)return parseInt(v.integerValue);
  if('doubleValue'in v)return v.doubleValue;
  if('stringValue'in v)return v.stringValue;
  if('arrayValue'in v)return(v.arrayValue.values||[]).map(fromFsVal);
  if('mapValue'in v)return fromFsDoc({fields:v.mapValue.fields||{}});
  return null;
}
function fromFsDoc(doc){
  const obj={};
  if(!doc||!doc.fields)return obj;
  for(const[k,v]of Object.entries(doc.fields))obj[k]=fromFsVal(v);
  if(doc.name)obj._id=doc.name.split('/').pop();
  return obj;
}
async function fsList(col,pageSize=300){
  const tok=await getStoreToken();
  const r=await fetch(`${_FS_BASE}/${col}?pageSize=${pageSize}`,{headers:{Authorization:`Bearer ${tok}`}});
  const d=await r.json();
  return(d.documents||[]).map(fromFsDoc);
}
async function fsSet(col,id,data){
  const tok=await getStoreToken();
  const r=await fetch(`${_FS_BASE}/${col}/${encodeURIComponent(id)}`,{
    method:'PATCH',
    headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({fields:toFsFields(data)})
  });
  if(!r.ok){const e=await r.json();throw new Error(e.error?.message||'Write failed');}
  return true;
}
async function fsAdd(col,data){
  const id=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  await fsSet(col,id,data);
  return id;
}
async function fsDelete(col,id){
  const tok=await getStoreToken();
  await fetch(`${_FS_BASE}/${col}/${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Bearer ${tok}`}});
}
async function fsQueryWhere(col,field,value,limit=50){
  const tok=await getStoreToken();
  const r=await fetch(`${_FS_BASE}:runQuery`,{
    method:'POST',
    headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:fsVal(value)}},limit}})
  });
  const docs=await r.json();
  return(Array.isArray(docs)?docs:[]).filter(d=>d.document).map(d=>fromFsDoc(d.document));
}
async function fsQueryOrdered(col,orderField,limit=100){
  const tok=await getStoreToken();
  const r=await fetch(`${_FS_BASE}:runQuery`,{
    method:'POST',
    headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({structuredQuery:{from:[{collectionId:col}],orderBy:[{field:{fieldPath:orderField},direction:'DESCENDING'}],limit}})
  });
  const docs=await r.json();
  return(Array.isArray(docs)?docs:[]).filter(d=>d.document).map(d=>fromFsDoc(d.document));
}
// ── Store utilities ──
function getBalance(item){
  if(item.sizeSpecific)return Object.values(item.sizes||{}).reduce((s,v)=>s+(parseInt(v)||0),0);
  return parseInt(item.balance)||0;
}
function getStatus(item){
  const b=getBalance(item);
  if(b<=0)return'red';
  if(b<(item.lowStockThreshold||500))return'amber';
  return'green';
}
function formatSizes(item){return Object.entries(item.sizes||{}).map(([k,v])=>`${k}: ${v}`).join(' · ');}
function todayStr(){return new Date().toISOString().split('T')[0];}
function tsLabel(ts){return ts?new Date(ts).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';}
function safeId(str){return(str||'').replace(/[^a-zA-Z0-9]/g,'_');}
function normPO(s){return s.replace(/[\s\-]/g,'').toLowerCase();}
// ── Store data loader (lazy — called on first store page visit) ──
async function loadStoreData(){
  try{
    const[items,txns,templates,requests,cats,pirs,edits,shortfalls]=await Promise.all([
      fsList('store_items'),
      fsQueryOrdered('store_transactions','ts',300),
      fsList('trim_templates'),
      fsList('store_requests'),
      fsList('store_categories').catch(()=>[]),
      fsList('po_issue_requests').catch(()=>[]),
      fsList('po_edit_requests').catch(()=>[]),
      fsList('po_shortfalls').catch(()=>[]),
    ]);
    allItems=items;allTransactions=txns;allTemplates=templates;allRequests=requests;
    allStoreCategories=Array.isArray(cats)?cats:[];
    allPoIssueRequests=Array.isArray(pirs)?pirs:[];
    allPoEditRequests=Array.isArray(edits)?edits:[];
    allPoShortfalls=Array.isArray(shortfalls)?shortfalls:[];
    if(!allItems.length){
      showToast('Initialising store items…');
      await Promise.all(INITIAL_ITEMS.map(item=>fsSet('store_items',item.code,item).catch(()=>{})));
      allItems=INITIAL_ITEMS.map(i=>({...i,_id:i.code}));
      showToast('Store initialised ✓');
    }
  }catch(e){showToast('Store load error: '+e.message,true);}
}
// Internal store navigation (maps store section IDs back to showPage)
function renderStoreSection(id){window.showPage('store-'+id);}

// ══════════════════════════════════════════════════════════════════════
// PO ISSUE REQUESTS · EDIT REQUESTS · SHORTFALLS · APPROVER INBOX
// ══════════════════════════════════════════════════════════════════════
const _EDIT_APPROVERS=['ammar','arfat','mustafa'];
function _canApproveEdits(){return _EDIT_APPROVERS.includes(session&&session.u);}
function _findItem(code){return allItems.find(i=>i.code===code);}
function _itemStockOf(code){const it=_findItem(code);return it?getBalance(it):0;}
function _lineId(){return 'L'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function _pirLineHasOpenEdit(reqId,lineId){return allPoEditRequests.some(r=>r.issueRequestId===reqId&&r.lineId===lineId&&r.status==='pending');}
function _pirLine(req,lineId){return(req.snapshot||[]).find(l=>l.lineId===lineId);}
async function _notifyStoreRole(payload){
  if(typeof _hrmNotify==='function')return _hrmNotify({forRole:'store',...payload});
}
async function _notifyApprovers(payload){
  if(typeof _hrmNotify!=='function')return;
  for(const u of _EDIT_APPROVERS){await _hrmNotify({forUser:u,...payload});}
}

async function _createPoIssueRequest(po,tpl){
  if(!Array.isArray(allItems)||!allItems.length){try{await loadStoreData();}catch(_){}}
  const snapshot=(tpl.items||[]).map(ti=>{
    const needed=Math.ceil((ti.qtyPerPiece||1)*(parseInt(po.qty)||1));
    const stock=_itemStockOf(ti.itemCode);
    return{lineId:_lineId(),itemCode:ti.itemCode,itemName:ti.itemName||ti.itemCode,qtyPerPiece:ti.qtyPerPiece||1,required:needed,pricePerUnit:ti.pricePerUnit||0,issued:0,shortfall:Math.max(0,needed-stock)};
  });
  const pirId='PIR-'+po.id;
  const pirDoc={id:pirId,poId:po.id,poName:po.name||po.id,productCode:po.code||'',poQty:parseInt(po.qty)||0,templateId:tpl._id||'',templateName:tpl.productName||tpl.productType||po.code,snapshot,status:'pending',createdBy:session.name,createdAt:Date.now()};
  await fsSet('po_issue_requests',pirId,pirDoc);
  allPoIssueRequests=allPoIssueRequests.filter(r=>r.id!==pirId);
  allPoIssueRequests.unshift(pirDoc);
  const shortLines=snapshot.filter(l=>l.shortfall>0);
  await _notifyStoreRole({
    type:'po_issue_request',priority:'high',
    title:`Trim issue needed — ${po.id}`,
    message:`${po.name||po.id} (${po.qty} pcs). ${snapshot.length} items to issue.`+(shortLines.length?` ⚠ ${shortLines.length} shortfall(s).`:''),
    relatedTo:pirId,actionUrl:`po-issue-detail:${pirId}`
  });
  return pirId;
}

function renderPoIssueList(){
  const pirs=allPoIssueRequests.filter(r=>r.status!=='fully_issued').sort((a,b)=>b.createdAt-a.createdAt);
  return`<div class="page-head"><div class="page-title">PO Issue Requests</div></div>
  ${!pirs.length?'<div class="card"><div class="empty" style="padding:1rem">No pending PO issue requests.</div></div>':''}
  ${pirs.map(r=>{
    const open=r.snapshot?r.snapshot.filter(l=>l.issued<l.required).length:0;
    const short=r.snapshot?r.snapshot.filter(l=>l.shortfall>0).length:0;
    const status=r.status==='partial'?'partial':'pending';
    const statusColor=status==='partial'?'var(--amber)':'var(--red)';
    const statusBg=status==='partial'?'#FEF3C7':'#FEE2E2';
    return`<div class="card" style="border-left:3px solid ${statusColor};cursor:pointer" onclick="window.openPoIssueDetail('${r.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px">
        <div>
          <div style="font-weight:700;font-size:14px">${r.poId||'—'}</div>
          <div style="font-size:12px;color:var(--muted)">${r.poName||'—'} · ${r.poQty||0} pcs</div>
        </div>
        <span style="font-size:11px;font-weight:700;color:${statusColor};background:${statusBg};padding:2px 10px;border-radius:10px">${status==='partial'?'Partially Issued':'Pending'}</span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--muted)">${open} item(s) pending${short?' · '+short+' shortfall(s)':''}</div>
    </div>`;
  }).join('')}
  <div style="height:80px"></div>`;
}

window.openPoIssueDetail=function(reqId){_issueViewingId=reqId;window.showPage('po-issue-detail');};

function renderPoIssuePickList(){
  const req=allPoIssueRequests.find(r=>r.id===_issueViewingId);
  if(!req)return`<button class="back-btn" onclick="window.showPage('po-issue-list')">← Back</button><div class="empty">Request not found.</div>`;
  const editReqs=allPoEditRequests.filter(e=>e.issueRequestId===req.id&&e.status==='pending');
  return`<button class="back-btn" onclick="window.showPage('po-issue-list')">← PO Issue Requests</button>
  <div class="page-head"><div class="page-title">${req.poId}</div><div class="page-sub">${req.poName||'—'} · ${req.poQty||0} pcs</div></div>
  ${editReqs.length?`<div class="alert-banner alert-amber">⚠ ${editReqs.length} edit request(s) pending approval. Affected lines are frozen.</div>`:''}
  <div class="card">
    <div class="card-title">Items to Issue</div>
    ${(req.snapshot||[]).map(l=>{
      const item=_findItem(l.itemCode);
      const stock=item?getBalance(item):0;
      const willIssue=Math.min(l.required-l.issued,stock);
      const short=Math.max(0,(l.required-l.issued)-stock);
      const frozen=_pirLineHasOpenEdit(req.id,l.lineId);
      const done=l.issued>=l.required;
      return`<div style="padding:10px 0;border-bottom:1px solid var(--border);${frozen?'opacity:.6;pointer-events:none':''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px">
          <div><div style="font-weight:600;font-size:13px">${l.itemCode} — ${l.itemName}</div>
            <div style="font-size:11px;color:var(--muted)">Needed: ${l.required} · Issued: ${l.issued} · Stock: ${stock}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
            ${frozen?'<span style="font-size:10px;color:var(--amber);font-weight:700">⏸ EDIT PENDING</span>':done?'<span style="font-size:10px;color:var(--green);font-weight:700">✓ DONE</span>':short?`<span style="font-size:10px;color:var(--amber);font-weight:700">Short ${short}</span>`:''}
            ${!done&&!frozen&&_canApproveEdits()?`<button class="btn-sm" onclick="window.openLineEditModal('${req.id}','${l.lineId}')">Edit</button>`:''}
          </div>
        </div>
        ${!done&&!frozen&&willIssue>0?`<div style="font-size:12px;margin-top:4px">Will issue: <strong>${willIssue}</strong></div>`:''}
        ${short&&!done&&!frozen?`<div style="font-size:12px;color:var(--amber);margin-top:2px">Short ${short} pcs — shortfall recorded</div>`:''}
      </div>`;
    }).join('')}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn-primary" onclick="window.submitPoBatchIssue('${req.id}')">Issue All Available Stock</button>
      ${_canApproveEdits()?`<button class="btn-outline" onclick="window.openAddLineModal('${req.id}')">+ Add Line</button>`:''}
    </div>
  </div>
  <div style="height:80px"></div>`;
}

window.submitPoBatchIssue=async function(reqId){
  const req=allPoIssueRequests.find(r=>r.id===reqId);
  if(!req){showToast('Request not found.',true);return;}
  const toIssue=(req.snapshot||[]).filter(l=>l.issued<l.required&&!_pirLineHasOpenEdit(reqId,l.lineId));
  if(!toIssue.length){showToast('Nothing to issue (all done or frozen).',true);return;}
  const newShortfalls=[];
  const updatedLines=req.snapshot.map(l=>({...l}));
  try{
    for(const l of toIssue){
      const item=_findItem(l.itemCode);if(!item)continue;
      const stock=getBalance(item);
      const qty=Math.min(l.required-l.issued,stock);
      if(qty<=0){
        if(l.required-l.issued>0)newShortfalls.push({poId:req.poId,issueRequestId:reqId,lineId:l.lineId,itemCode:l.itemCode,itemName:l.itemName,shortfall:l.required-l.issued,createdAt:Date.now(),status:'open'});
        continue;
      }
      const updated={...item};
      if(item.sizeSpecific){
        const ns={...item.sizes};const keys=Object.keys(ns);const per=Math.floor(qty/keys.length);
        keys.forEach(sz=>{ns[sz]=Math.max(0,(parseInt(ns[sz])||0)-per);});
        updated.sizes=ns;
      }else{updated.balance=Math.max(0,(parseInt(item.balance)||0)-qty);}
      await fsSet('store_items',item.code,updated);
      await fsAdd('store_transactions',{type:'issued',itemCode:item.code,itemName:item.name,issuedTo:'PO: '+req.poId,purpose:'PO trim issue',date:todayStr(),by:session.name,ts:Date.now(),qty,unit:item.unit||'pcs',poRef:req.poId});
      const idx=allItems.findIndex(i=>i.code===item.code);if(idx>=0)allItems[idx]={...updated,_id:item.code};
      const ul=updatedLines.find(x=>x.lineId===l.lineId);if(ul)ul.issued=ul.issued+qty;
      const remaining=l.required-(l.issued+qty);
      if(remaining>0)newShortfalls.push({poId:req.poId,issueRequestId:reqId,lineId:l.lineId,itemCode:l.itemCode,itemName:l.itemName,shortfall:remaining,createdAt:Date.now(),status:'open'});
    }
    const allDone=updatedLines.every(l=>l.issued>=l.required);
    const newStatus=allDone?'fully_issued':'partial';
    await fsSet('po_issue_requests',reqId,{...req,snapshot:updatedLines,status:newStatus});
    const ri=allPoIssueRequests.findIndex(r=>r.id===reqId);
    if(ri>=0)allPoIssueRequests[ri]={...req,snapshot:updatedLines,status:newStatus};
    for(const sf of newShortfalls){
      const sfId=await fsAdd('po_shortfalls',sf);
      allPoShortfalls.push({...sf,_id:sfId});
    }
    showToast(allDone?'All items issued ✓':'Partial issue complete — shortfalls recorded');
    window.showPage('po-issue-detail');
  }catch(e){showToast('Error: '+e.message,true);}
};

async function _checkShortfallsOnReceive(itemCode){
  const open=allPoShortfalls.filter(sf=>sf.itemCode===itemCode&&sf.status==='open');
  if(!open.length)return;
  const item=_findItem(itemCode);if(!item)return;
  const stock=getBalance(item);
  const byPO={};
  for(const sf of open){if(!byPO[sf.poId])byPO[sf.poId]=[];byPO[sf.poId].push(sf);}
  for(const[poId,sfs]of Object.entries(byPO)){
    const total=sfs.reduce((s,sf)=>s+sf.shortfall,0);
    if(stock>=total){
      await _notifyStoreRole({type:'shortfall_resolved',priority:'normal',title:`Stock available for ${poId}`,message:`${itemCode} is back in stock. ${total} pcs needed for ${poId}. Review PO issue request.`,actionUrl:`po-issue-detail:PIR-${poId}`});
    }
  }
}

window.openLineEditModal=function(reqId,lineId){
  const req=allPoIssueRequests.find(r=>r.id===reqId);
  const line=req?_pirLine(req,lineId):null;
  if(!line){showToast('Line not found.',true);return;}
  document.getElementById('_pe-modal')?.remove();
  const opts=allItems.map(i=>`<option value="${i.code}"${i.code===line.itemCode?' selected':''}>${i.code} — ${i.name}</option>`).join('');
  const modal=document.createElement('div');
  modal.id='_pe-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2200;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML=`<div style="background:#fff;border-radius:14px;width:100%;max-width:420px;box-shadow:0 12px 48px rgba(0,0,0,.25)">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700;font-size:15px">Request Line Edit</span>
      <button onclick="document.getElementById('_pe-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
    </div>
    <div style="padding:16px;display:grid;gap:10px">
      <div style="font-size:13px;color:var(--muted)">Current: <strong>${line.itemCode}</strong> — ${line.itemName} · Required: ${line.required}</div>
      <div class="field"><label>Change type</label>
        <select id="_pe-type" onchange="window._peTypeChange()">
          <option value="qty">Change quantity</option>
          <option value="swap">Swap item</option>
          <option value="remove">Remove line</option>
        </select>
      </div>
      <div id="_pe-qty-row" class="field"><label>New quantity</label><input id="_pe-qty" type="number" min="1" value="${line.required}"></div>
      <div id="_pe-swap-row" class="field" style="display:none"><label>New item</label><select id="_pe-swap-item">${opts}</select></div>
      <div class="field"><label>Reason *</label><input id="_pe-reason" placeholder="Why is this change needed?"></div>
    </div>
    <div style="padding:0 16px 16px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-outline" onclick="document.getElementById('_pe-modal').remove()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.submitLineEditRequest('${reqId}','${lineId}')">Submit Request</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
};

window._peTypeChange=function(){
  const t=document.getElementById('_pe-type')?.value;
  document.getElementById('_pe-qty-row').style.display=(t==='qty')?'block':'none';
  document.getElementById('_pe-swap-row').style.display=(t==='swap')?'block':'none';
};

window.submitLineEditRequest=async function(reqId,lineId){
  const req=allPoIssueRequests.find(r=>r.id===reqId);
  const line=req?_pirLine(req,lineId):null;
  if(!line){showToast('Line not found.',true);return;}
  const type=document.getElementById('_pe-type')?.value||'qty';
  const reason=(document.getElementById('_pe-reason')?.value||'').trim();
  if(!reason){showToast('Reason is required.',true);return;}
  const payload={issueRequestId:reqId,poId:req.poId,lineId,type,reason,requestedBy:session.name,createdAt:Date.now(),status:'pending',currentItemCode:line.itemCode,currentItemName:line.itemName,currentRequired:line.required};
  if(type==='qty'){const nq=parseInt(document.getElementById('_pe-qty')?.value)||0;if(!nq){showToast('Enter quantity.',true);return;}payload.newQty=nq;}
  if(type==='swap'){const ni=document.getElementById('_pe-swap-item')?.value;if(!ni){showToast('Select item.',true);return;}payload.newItemCode=ni;payload.newItemName=allItems.find(i=>i.code===ni)?.name||ni;}
  try{
    const id=await fsAdd('po_edit_requests',payload);
    allPoEditRequests.push({...payload,_id:id});
    await _notifyApprovers({type:'edit_request',priority:'high',title:`Edit request — ${req.poId}`,message:`${session.name} requested ${type==='qty'?'quantity change':type==='swap'?'item swap':'line removal'} for ${line.itemCode}. Reason: ${reason}`,actionUrl:`po-edit-inbox`});
    document.getElementById('_pe-modal')?.remove();
    showToast('Edit request submitted ✓');window.showPage('po-issue-detail');
  }catch(e){showToast('Error: '+e.message,true);}
};

window.openAddLineModal=function(reqId){
  const req=allPoIssueRequests.find(r=>r.id===reqId);
  if(!req){showToast('Request not found.',true);return;}
  document.getElementById('_pa-modal')?.remove();
  const opts=allItems.map(i=>`<option value="${i.code}">${i.code} — ${i.name}</option>`).join('');
  const modal=document.createElement('div');
  modal.id='_pa-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2200;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML=`<div style="background:#fff;border-radius:14px;width:100%;max-width:420px;box-shadow:0 12px 48px rgba(0,0,0,.25)">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700;font-size:15px">Add Line Request</span>
      <button onclick="document.getElementById('_pa-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
    </div>
    <div style="padding:16px;display:grid;gap:10px">
      <div class="field"><label>Item *</label><select id="_pa-item">${opts}</select></div>
      <div class="field"><label>Quantity *</label><input id="_pa-qty" type="number" min="1" placeholder="0"></div>
      <div class="field"><label>Reason *</label><input id="_pa-reason" placeholder="Why is this item needed?"></div>
    </div>
    <div style="padding:0 16px 16px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-outline" onclick="document.getElementById('_pa-modal').remove()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.submitAddLineRequest('${reqId}')">Submit Request</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
};

window.submitAddLineRequest=async function(reqId){
  const req=allPoIssueRequests.find(r=>r.id===reqId);
  if(!req){showToast('Request not found.',true);return;}
  const code=document.getElementById('_pa-item')?.value;
  const qty=parseInt(document.getElementById('_pa-qty')?.value)||0;
  const reason=(document.getElementById('_pa-reason')?.value||'').trim();
  if(!code||!qty){showToast('Item and quantity required.',true);return;}
  if(!reason){showToast('Reason is required.',true);return;}
  const item=allItems.find(i=>i.code===code);
  const payload={issueRequestId:reqId,poId:req.poId,lineId:_lineId(),type:'add',reason,requestedBy:session.name,createdAt:Date.now(),status:'pending',newItemCode:code,newItemName:item?.name||code,newQty:qty};
  try{
    const id=await fsAdd('po_edit_requests',payload);
    allPoEditRequests.push({...payload,_id:id});
    await _notifyApprovers({type:'edit_request',priority:'high',title:`Add-line request — ${req.poId}`,message:`${session.name} wants to add ${code} (${qty} pcs). Reason: ${reason}`,actionUrl:`po-edit-inbox`});
    document.getElementById('_pa-modal')?.remove();
    showToast('Add-line request submitted ✓');window.showPage('po-issue-detail');
  }catch(e){showToast('Error: '+e.message,true);}
};

function renderPoEditInbox(){
  if(!_canApproveEdits())return`<div class="empty">Access restricted.</div>`;
  const pending=allPoEditRequests.filter(r=>r.status==='pending').sort((a,b)=>b.createdAt-a.createdAt);
  const typeColor={qty:'#2563eb',swap:'#7c3aed',add:'#16a34a',remove:'#dc2626'};
  const typeBg={qty:'#eff6ff',swap:'#f5f3ff',add:'#f0fdf4',remove:'#fef2f2'};
  return`<div class="page-head"><div class="page-title">Edit Inbox</div><div class="page-sub">Review and approve line-item change requests</div></div>
  ${!pending.length?'<div class="card"><div class="empty" style="padding:1rem">No pending edit requests.</div></div>':''}
  ${pending.map(r=>{
    const tc=typeColor[r.type]||'#111';const bg=typeBg[r.type]||'#f9f9f9';
    return`<div class="card" style="border-left:3px solid ${tc}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px">
        <div>
          <div style="font-weight:700;font-size:14px">${r.poId||'—'}</div>
          <div style="font-size:12px;color:var(--muted)">Requested by ${r.requestedBy||'—'}</div>
        </div>
        <span style="font-size:11px;font-weight:700;color:${tc};background:${bg};padding:2px 10px;border-radius:10px;text-transform:uppercase">${r.type}</span>
      </div>
      <div style="margin-top:6px;font-size:13px">
        ${r.type==='add'?`Add <strong>${r.newItemCode}</strong> × ${r.newQty}`:
          r.type==='remove'?`Remove <strong>${r.currentItemCode}</strong>`:
          r.type==='swap'?`Swap <strong>${r.currentItemCode}</strong> → <strong>${r.newItemCode}</strong>`:
          `Change qty <strong>${r.currentItemCode}</strong>: ${r.currentRequired} → ${r.newQty}`}
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">Reason: ${r.reason||'—'}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn-sm" onclick="window.openReviewModal('${r._id}')">Review</button>
        <button class="btn-sm" style="color:#dc2626;border-color:#fca5a5" onclick="window.rejectEditRequest('${r._id}')">Reject</button>
      </div>
    </div>`;
  }).join('')}
  <div style="height:80px"></div>`;
}

window.openReviewModal=function(editId){
  const er=allPoEditRequests.find(r=>r._id===editId);
  if(!er){showToast('Request not found.',true);return;}
  document.getElementById('_rv-modal')?.remove();
  const req=allPoIssueRequests.find(r=>r.id===er.issueRequestId);
  const tplUpdate=req&&req.templateId?`<label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-top:8px;cursor:pointer"><input type="checkbox" id="_rv-update-tpl"> Also update master trim template for future POs</label>`:'';
  let detailHTML='';
  if(er.type==='qty')detailHTML=`<div class="field"><label>Approve qty</label><input id="_rv-qty" type="number" value="${er.newQty}" min="1"></div>`;
  if(er.type==='swap'){const opts=allItems.map(i=>`<option value="${i.code}"${i.code===er.newItemCode?' selected':''}>${i.code} — ${i.name}</option>`).join('');detailHTML=`<div class="field"><label>Confirm swap to</label><select id="_rv-swap">${opts}</select></div>`;}
  if(er.type==='add'){const opts2=allItems.map(i=>`<option value="${i.code}"${i.code===er.newItemCode?' selected':''}>${i.code} — ${i.name}</option>`).join('');detailHTML=`<div class="field"><label>Item</label><select id="_rv-add-item">${opts2}</select></div><div class="field"><label>Qty</label><input id="_rv-add-qty" type="number" value="${er.newQty}" min="1"></div>`;}
  const modal=document.createElement('div');
  modal.id='_rv-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2200;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML=`<div style="background:#fff;border-radius:14px;width:100%;max-width:460px;box-shadow:0 12px 48px rgba(0,0,0,.25)">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700;font-size:15px">Review Edit Request</span>
      <button onclick="document.getElementById('_rv-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
    </div>
    <div style="padding:16px;display:grid;gap:10px">
      <div style="font-size:13px;background:#f5f5f5;padding:10px;border-radius:8px">
        <div><strong>${er.poId}</strong> — ${er.type} request by ${er.requestedBy}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px">Reason: ${er.reason}</div>
      </div>
      ${detailHTML}
      <div class="field"><label>Approval note (optional)</label><input id="_rv-note" placeholder="Optional note to requestor"></div>
      ${tplUpdate}
    </div>
    <div style="padding:0 16px 16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      <button class="btn-outline" onclick="document.getElementById('_rv-modal').remove()">Cancel</button>
      <button class="btn-outline" style="color:#2563eb;border-color:#93c5fd" onclick="window.decideEditRequest('${editId}',true)">Modify & Approve</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;margin-top:0" onclick="window.decideEditRequest('${editId}',false)">Approve As-Is</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
};

window.rejectEditRequest=async function(editId){
  const er=allPoEditRequests.find(r=>r._id===editId);
  if(!er){showToast('Request not found.',true);return;}
  const reason=prompt('Rejection reason (required):');
  if(!reason)return;
  try{
    await fsSet('po_edit_requests',editId,{...er,status:'rejected',rejectedBy:session.name,rejectedAt:Date.now(),rejectionReason:reason});
    const i=allPoEditRequests.findIndex(r=>r._id===editId);if(i>=0)allPoEditRequests[i]={...er,status:'rejected'};
    if(typeof _hrmNotify==='function')await _hrmNotify({forUser:er.requestedBy||'',type:'edit_rejected',title:`Edit request rejected — ${er.poId}`,message:`Your ${er.type} request for ${er.currentItemCode||er.newItemCode} was rejected. Reason: ${reason}`});
    await logActivity('Edit request rejected',`${er.poId} — ${er.type} on ${er.currentItemCode||er.newItemCode} by ${session.name}`);
    showToast('Request rejected');window.showPage('po-edit-inbox');
  }catch(e){showToast('Error: '+e.message,true);}
};

window.decideEditRequest=async function(editId,isModify){
  const er=allPoEditRequests.find(r=>r._id===editId);
  if(!er){showToast('Request not found.',true);return;}
  const req=allPoIssueRequests.find(r=>r.id===er.issueRequestId);
  if(!req){showToast('PO request not found.',true);return;}
  const note=(document.getElementById('_rv-note')?.value||'').trim();
  const updateTpl=document.getElementById('_rv-update-tpl')?.checked&&req.templateId;
  let finalItemCode=er.newItemCode,finalItemName=er.newItemName,finalQty=er.newQty;
  if(isModify){
    if(er.type==='qty'){finalQty=parseInt(document.getElementById('_rv-qty')?.value)||er.newQty;}
    if(er.type==='swap'){finalItemCode=document.getElementById('_rv-swap')?.value||er.newItemCode;finalItemName=allItems.find(i=>i.code===finalItemCode)?.name||finalItemCode;}
    if(er.type==='add'){finalItemCode=document.getElementById('_rv-add-item')?.value||er.newItemCode;finalItemName=allItems.find(i=>i.code===finalItemCode)?.name||finalItemCode;finalQty=parseInt(document.getElementById('_rv-add-qty')?.value)||er.newQty;}
  }
  const newSnapshot=req.snapshot.map(l=>({...l}));
  if(er.type==='remove'){const idx=newSnapshot.findIndex(l=>l.lineId===er.lineId);if(idx>=0)newSnapshot.splice(idx,1);}
  else if(er.type==='add'){newSnapshot.push({lineId:_lineId(),itemCode:finalItemCode,itemName:finalItemName,required:finalQty,issued:0,shortfall:0,qtyPerPiece:0,pricePerUnit:0});}
  else{const l=newSnapshot.find(x=>x.lineId===er.lineId);if(l){if(er.type==='qty')l.required=finalQty;if(er.type==='swap'){l.itemCode=finalItemCode;l.itemName=finalItemName;}}}
  try{
    await fsSet('po_issue_requests',req.id,{...req,snapshot:newSnapshot});
    const ri=allPoIssueRequests.findIndex(r=>r.id===req.id);if(ri>=0)allPoIssueRequests[ri]={...req,snapshot:newSnapshot};
    await fsSet('po_edit_requests',editId,{...er,status:'approved',approvedBy:session.name,approvedAt:Date.now(),note});
    const i=allPoEditRequests.findIndex(r=>r._id===editId);if(i>=0)allPoEditRequests[i]={...er,status:'approved'};
    if(updateTpl){
      const tpl=allTemplates.find(t=>t._id===req.templateId);
      if(tpl){
        const newItems=(tpl.items||[]).map(ti=>({...ti}));
        if(er.type==='remove'){const idx=newItems.findIndex(ti=>ti.itemCode===er.currentItemCode);if(idx>=0)newItems.splice(idx,1);}
        else if(er.type==='add')newItems.push({itemCode:finalItemCode,itemName:finalItemName,qtyPerPiece:req.poQty?finalQty/req.poQty:0,pricePerUnit:0});
        else{const ti=newItems.find(ti=>ti.itemCode===er.currentItemCode);if(ti){if(er.type==='qty')ti.qtyPerPiece=req.poQty?finalQty/req.poQty:ti.qtyPerPiece;if(er.type==='swap'){ti.itemCode=finalItemCode;ti.itemName=finalItemName;}}}
        await fsSet('trim_templates',tpl._id,{...tpl,items:newItems});
        const ti2=allTemplates.findIndex(t=>t._id===tpl._id);if(ti2>=0)allTemplates[ti2]={...tpl,items:newItems};
      }
    }
    if(typeof _hrmNotify==='function')await _hrmNotify({forUser:er.requestedBy||'',type:'edit_approved',title:`Edit approved — ${er.poId}`,message:`Your ${er.type} request for ${er.currentItemCode||er.newItemCode} was approved.${note?' Note: '+note:''}`});
    await logActivity('Edit request approved',`${er.poId} — ${er.type} on ${er.currentItemCode||er.newItemCode} by ${session.name}`);
    document.getElementById('_rv-modal')?.remove();
    showToast('Edit approved ✓');window.showPage('po-edit-inbox');
  }catch(e){showToast('Error: '+e.message,true);}
};

// ── Auto-open printing subnav helpers (no-op placeholders) ──
window._printNavOpen=function(){};

// ══════════════════════════════════════════════════════════════════════
// CHUNK 1 — PRINTING / DECORATION ERP: STATE · PERMISSIONS · CONSTANTS
//            DATA LOADER · RECIPE DIRECTORY
// ══════════════════════════════════════════════════════════════════════

// ── Module state ──────────────────────────────────────────────────────
// ── Expose store functions to global scope (required for inline HTML handlers in module scope) ──
window.onRcvItemChange=onRcvItemChange;
window.submitReceive=submitReceive;
window.filterPODropMain=filterPODropMain;
window.hidePODropMain=hidePODropMain;
window.selectPOMain=selectPOMain;
window.submitPoIssue=submitPoIssue;
window.onIssItemChange=onIssItemChange;
window.loadActivePOs=loadActivePOs;
window.filterPODrop=filterPODrop;
window.hidePODrop=hidePODrop;
window.selectPO=selectPO;
window.submitIssueManual=submitIssueManual;
window.filterTplProd=filterTplProd;
window.renderPoIssueList=renderPoIssueList;
window.renderPoIssuePickList=renderPoIssuePickList;
window.renderPoEditInbox=renderPoEditInbox;
window._createPoIssueRequest=_createPoIssueRequest;
window.selectTplProd=selectTplProd;
window.addTplRow=addTplRow;
window.submitTemplate=submitTemplate;
window.deleteTemplate=deleteTemplate;
window.editTemplate=editTemplate;
window.setILDir=setILDir;
window.refreshIssueLog=refreshIssueLog;
window.setILQ=function(v){_ilQ=v;_ilPage=1;refreshIssueLog();};
window.setILPO=function(v){_ilPO=v;_ilPage=1;refreshIssueLog();};
window.ilPagePrev=function(){if(_ilPage>1){_ilPage--;refreshIssueLog();}};
window.ilPageNext=function(){_ilPage++;refreshIssueLog();};

// ── Store notification state ──
let storeNotifications=[];

// ── Inventory CRUD helpers ──
function _parseSizesInput(str){
  const out={};
  str.trim().split(/[\s,]+/).forEach(part=>{const m=part.match(/^(.+):(\d+)$/);if(m)out[m[1]]=parseInt(m[2]);});
  return out;
}
function _buildItemModal(title,item,onSave){
  let existing=document.getElementById('_item-modal');if(existing)existing.remove();
  const cats=_allCats().map(c=>`<option value="${c}"${item&&item.category===c?' selected':''}>${_catLabel(c)}</option>`).join('')+`<option value="__new_cat__" style="font-weight:700;color:#16a34a">+ New category…</option>`;
  const units=['pcs','meters','kg','grams','cones','packets','100pc bundles'];
  const unitOpts=units.map(u=>`<option${item&&item.unit===u?' selected':''}>${u}</option>`).join('');
  const sizesStr=item&&item.sizeSpecific&&item.sizes?Object.entries(item.sizes).map(([k,v])=>`${k}:${v}`).join(' '):'';
  const imgUrl=item&&item.imageUrl||'';
  const modal=document.createElement('div');
  modal.id='_item-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML=`<div style="background:#fff;border-radius:14px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,.25)">
    <div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700;font-size:15px">${title}</span>
      <button onclick="document.getElementById('_item-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
    </div>
    <div style="padding:18px;display:grid;gap:12px">
      <div class="field">
        <label>Image <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <div style="display:flex;gap:10px;align-items:center">
          <div id="_im-img-preview" style="width:64px;height:64px;border:1px solid var(--border);border-radius:8px;background:#fafafa center/cover no-repeat;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:10px;${imgUrl?`background-image:url('${imgUrl}')`:''}">${imgUrl?'':'No image'}</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <input type="file" id="_im-img-file" accept="image/*" style="font-size:11px;font-family:inherit" onchange="window._imOnImgPick(this)">
            ${imgUrl?`<button type="button" onclick="window._imClearImg()" style="padding:4px 10px;background:#fff;border:1px solid #fca5a5;color:#dc2626;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;align-self:flex-start">Remove image</button>`:''}
          </div>
        </div>
        <input type="hidden" id="_im-img-url" value="${imgUrl}">
        <input type="hidden" id="_im-img-status" value="ready">
      </div>
      <div class="field"><label>Code *${item?` <span style="font-weight:400;color:var(--muted)">(rename will migrate transactions)</span>`:''}</label><input id="_im-code" value="${item?item.code:''}" placeholder="e.g. NL5" style="text-transform:uppercase"><input type="hidden" id="_im-orig-code" value="${item?item.code:''}"></div>
      <div class="field"><label>Name *</label><input id="_im-name" value="${item?item.name:''}"></div>
      <div class="field"><label>Category *</label><select id="_im-cat" onchange="window._imCatChange()">${cats}</select></div>
      <div class="field"><label>Unit *</label><select id="_im-unit">${unitOpts}</select></div>
      <div class="field"><label>Low Stock Threshold</label><input id="_im-thresh" type="number" value="${item?item.lowStockThreshold||200:200}"></div>
      <div style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="_im-sized" ${item&&item.sizeSpecific?'checked':''} onchange="document.getElementById('_im-sized-row').style.display=this.checked?'block':'none';document.getElementById('_im-bal-row').style.display=this.checked?'none':'block'"><label for="_im-sized" style="cursor:pointer;font-size:13px">Size-specific</label></div>
      <div id="_im-sized-row" style="display:${item&&item.sizeSpecific?'block':'none'}">
        <div class="field"><label>Sizes (e.g. XS:100 S:200 M:300)</label><input id="_im-sizes" value="${sizesStr}" placeholder="XS:100 S:200 M:300 L:400"></div>
      </div>
      <div id="_im-bal-row" style="display:${item&&item.sizeSpecific?'none':'block'}">
        <div class="field"><label>Balance</label><input id="_im-bal" type="number" value="${item&&!item.sizeSpecific?item.balance||0:0}"></div>
      </div>
    </div>
    <div style="padding:0 18px 18px"><button class="btn-primary" id="_im-save" style="width:100%">Save</button></div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('_im-save').onclick=onSave;
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
}

window._imOnImgPick=async function(input){
  const file=input.files&&input.files[0];if(!file)return;
  const status=document.getElementById('_im-img-status');
  const preview=document.getElementById('_im-img-preview');
  const urlField=document.getElementById('_im-img-url');
  if(status)status.value='uploading';
  if(preview){preview.style.background='#fafafa';preview.textContent='Uploading…';preview.style.color='#999';}
  try{
    const url=await uploadToCloudinary(file);
    if(urlField)urlField.value=url;
    if(preview){preview.textContent='';preview.style.backgroundImage=`url('${url}')`;preview.style.backgroundSize='cover';preview.style.backgroundPosition='center';}
    if(status)status.value='ready';
  }catch(e){
    if(status)status.value='error';
    if(preview){preview.textContent='Failed';preview.style.color='#dc2626';}
    showToast('Upload failed: '+e.message,true);
  }
};

window._imClearImg=function(){
  const urlField=document.getElementById('_im-img-url');
  const preview=document.getElementById('_im-img-preview');
  const fileInp=document.getElementById('_im-img-file');
  if(urlField)urlField.value='';
  if(preview){preview.style.backgroundImage='';preview.textContent='No image';preview.style.color='#bbb';}
  if(fileInp)fileInp.value='';
};

window._imCatChange=function(){
  const sel=document.getElementById('_im-cat');
  if(!sel||sel.value!=='__new_cat__')return;
  sel.value='';
  window.openNewCategoryDialog((newKey)=>{
    const sel2=document.getElementById('_im-cat');
    if(!sel2)return;
    const cats=_allCats().map(c=>`<option value="${c}"${c===newKey?' selected':''}>${_catLabel(c)}</option>`).join('')+`<option value="__new_cat__" style="font-weight:700;color:#16a34a">+ New category…</option>`;
    sel2.innerHTML=cats;
    sel2.value=newKey;
  });
};

window.showAddItemForm=function(){
  _buildItemModal('Add New Item',null,async()=>{
    if(document.getElementById('_im-img-status')?.value==='uploading')return showToast('Image still uploading…',true);
    const code=document.getElementById('_im-code').value.trim().toUpperCase();
    const name=document.getElementById('_im-name').value.trim();
    if(!code||!name){showToast('Code and name are required.',true);return;}
    if(allItems.some(i=>(i.code||'').toUpperCase()===code))return showToast('Code '+code+' already exists.',true);
    const sized=document.getElementById('_im-sized').checked;
    const imageUrl=document.getElementById('_im-img-url')?.value||'';
    const item={code,name,category:document.getElementById('_im-cat').value,unit:document.getElementById('_im-unit').value,lowStockThreshold:parseInt(document.getElementById('_im-thresh').value)||200,sizeSpecific:sized,imageUrl};
    if(sized){item.sizes=_parseSizesInput(document.getElementById('_im-sizes').value);}
    else{item.balance=parseInt(document.getElementById('_im-bal').value)||0;}
    try{
      await fsSet('store_items',code,item);
      const existing=allItems.findIndex(i=>i.code===code);
      if(existing>=0)allItems[existing]={...item,_id:code};else allItems.push({...item,_id:code});
      document.getElementById('_item-modal').remove();
      showToast('Item added ✓');
      window.showPage('store-inventory');
    }catch(e){showToast('Save failed: '+e.message,true);}
  });
};

async function _renameStoreItemCode(oldCode,newCode,newDoc){
  await fsSet('store_items',newCode,newDoc);
  let txCount=0;
  for(const tx of allTransactions){
    if((tx.itemCode||'').toUpperCase()===oldCode.toUpperCase()){
      tx.itemCode=newCode;
      try{if(tx._id)await fsSet('store_transactions',tx._id,tx);}catch(_){}
      txCount++;
    }
  }
  let tplCount=0;
  for(const t of allTemplates){
    let touched=false;
    if(Array.isArray(t.items)){
      for(const it of t.items){
        if((it.code||'').toUpperCase()===oldCode.toUpperCase()){it.code=newCode;touched=true;}
      }
    }
    if(touched){tplCount++;try{if(t._id)await fsSet('trim_templates',t._id,t);}catch(_){}}
  }
  await fsDelete('store_items',oldCode);
  return{txCount,tplCount};
}

window.editStoreItem=function(code){
  const item=allItems.find(i=>i.code===code);if(!item)return;
  const snap={...item};
  _buildItemModal('Edit Item — '+code,item,async()=>{
    if(document.getElementById('_im-img-status')?.value==='uploading')return showToast('Image still uploading…',true);
    const name=document.getElementById('_im-name').value.trim();
    const newCode=(document.getElementById('_im-code')?.value||'').trim().toUpperCase();
    const origCode=(document.getElementById('_im-orig-code')?.value||code).toUpperCase();
    if(!name){showToast('Name is required.',true);return;}
    if(!newCode){showToast('Code is required.',true);return;}
    const renaming=newCode!==origCode;
    if(renaming){
      if(allItems.some(i=>(i.code||'').toUpperCase()===newCode))return showToast('Code '+newCode+' already exists.',true);
      if(!confirm(`Rename ${origCode} → ${newCode}?\n\nAll matching transactions and trim templates will be updated to the new code, and the old document will be removed. This can take a few seconds for items with lots of history.`))return;
    }
    const sized=document.getElementById('_im-sized').checked;
    const imageUrl=document.getElementById('_im-img-url')?.value||'';
    const updated={...item,code:newCode,name,category:document.getElementById('_im-cat').value,unit:document.getElementById('_im-unit').value,lowStockThreshold:parseInt(document.getElementById('_im-thresh').value)||200,sizeSpecific:sized,imageUrl};
    if(sized){updated.sizes=_parseSizesInput(document.getElementById('_im-sizes').value);delete updated.balance;}
    else{updated.balance=parseInt(document.getElementById('_im-bal').value)||0;delete updated.sizes;}
    try{
      if(renaming){
        const{txCount,tplCount}=await _renameStoreItemCode(origCode,newCode,updated);
        const idx=allItems.findIndex(i=>(i.code||'').toUpperCase()===origCode);
        if(idx>=0)allItems[idx]={...updated,_id:newCode};
        await logActivity('Item renamed',`${origCode} → ${newCode} (${txCount} tx, ${tplCount} tpl)`);
        if(session.role==='store')await _notifyInventoryChange('edit',snap,updated);
        document.getElementById('_item-modal').remove();
        showToast(`Renamed ✓ ${txCount} transactions migrated.`);
      }else{
        await fsSet('store_items',newCode,updated);
        const idx=allItems.findIndex(i=>i.code===origCode);
        if(idx>=0)allItems[idx]={...updated,_id:newCode};
        if(session.role==='store')await _notifyInventoryChange('edit',snap,updated);
        document.getElementById('_item-modal').remove();
        showToast('Item updated ✓');
      }
      window.showPage('store-inventory');
    }catch(e){showToast('Save failed: '+e.message,true);}
  });
};

window.deleteStoreItem=async function(code){
  const item=allItems.find(i=>i.code===code);if(!item)return;
  if(!confirm(`Delete ${code} — ${item.name}?\n\nThis cannot be undone.`))return;
  try{
    await fsDelete('store_items',code);
    if(session.role==='store')await _notifyInventoryChange('delete',item,null);
    allItems=allItems.filter(i=>i.code!==code);
    showToast('Item deleted');
    window.showPage('store-inventory');
  }catch(e){showToast('Delete failed: '+e.message,true);}
};

async function _notifyInventoryChange(action,oldItem,newItem){
  const changes={};
  if(action==='edit'){
    ['name','category','unit','balance','sizeSpecific','sizes','lowStockThreshold'].forEach(f=>{
      if(JSON.stringify(oldItem[f])!==JSON.stringify(newItem[f]))changes[f]={old:oldItem[f],new:newItem[f]};
    });
  }else{changes.deletedItem=oldItem;}
  await fsAdd('store_notifications',{
    type:action==='edit'?'inventory_edit':'inventory_delete',
    itemCode:oldItem.code,itemName:oldItem.name,action,
    changedBy:session.name,changedAt:Date.now(),changes,
    status:'unread',dismissedBy:null,dismissedAt:null,
  });
}

// ── Notification system (owners only) ──
async function loadStoreNotifications(){
  if(session.role!=='owner')return;
  try{
    const docs=await fsQueryWhere('store_notifications','status','unread',50);
    storeNotifications=docs;renderNotifBadge();
  }catch(_){}
}
function renderNotifBadge(){
  const badge=document.getElementById('notif-badge');if(!badge)return;
  const count=storeNotifications.filter(n=>n.status==='unread').length;
  if(count>0){badge.style.display='flex';badge.textContent=count>9?'9+':count;}
  else{badge.style.display='none';}
}
function _timeAgo(ts){
  const d=Date.now()-ts;
  if(d<60000)return'just now';if(d<3600000)return Math.floor(d/60000)+'m ago';
  if(d<86400000)return Math.floor(d/3600000)+'h ago';return Math.floor(d/86400000)+'d ago';
}
function renderNotifList(){
  const el=document.getElementById('notif-list');if(!el)return;
  const list=storeNotifications.filter(n=>n.status==='unread');
  if(!list.length){el.innerHTML='<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">No pending notifications ✓</div>';return;}
  el.innerHTML=list.map(n=>{
    let changesHTML='';
    if(n.action==='edit'&&n.changes){
      const parts=Object.entries(n.changes).map(([f,v])=>`<span style="font-size:11px;background:#f5f5f5;padding:2px 6px;border-radius:4px">${f}: <span style="color:#dc2626">${JSON.stringify(v.old)}</span> → <span style="color:var(--green)">${JSON.stringify(v.new)}</span></span>`);
      if(parts.length)changesHTML=`<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">${parts.join('')}</div>`;
    }else if(n.action==='delete'){
      changesHTML=`<div style="font-size:11px;color:var(--muted);margin-top:3px">Item snapshot saved</div>`;
    }
    return`<div style="padding:14px 16px;border-bottom:1px solid #f5f5f5">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:20px;flex-shrink:0">${n.action==='edit'?'✏️':'🗑️'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">${n.action==='edit'?'Edited':'Deleted'}: ${n.itemCode} — ${n.itemName}</div>
          ${changesHTML}
          <div style="font-size:11px;color:var(--muted);margin-top:5px">${_timeAgo(n.changedAt)} · by ${n.changedBy}</div>
        </div>
      </div>
      <button onclick="window.dismissNotif('${n._id}')" style="margin-top:10px;width:100%;padding:7px;border:1px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;font-size:12px;color:var(--muted);font-family:inherit">Dismiss</button>
    </div>`;
  }).join('');
}
window.toggleNotifPanel=function(){
  const p=document.getElementById('notif-panel');if(!p)return;
  const open=p.style.display==='none'||!p.style.display;
  p.style.display=open?'block':'none';
  if(open)renderNotifList();
};
window.dismissNotif=async function(id){
  const n=storeNotifications.find(x=>x._id===id);if(!n)return;
  const{_id,...data}=n;
  try{
    await fsSet('store_notifications',id,{...data,status:'read',dismissedBy:session.name,dismissedAt:Date.now()});
    storeNotifications=storeNotifications.filter(x=>x._id!==id);
    renderNotifBadge();renderNotifList();
  }catch(e){showToast('Dismiss failed: '+e.message,true);}
};

// ── HRM: Dashboard widgets, Employees page, increment workflow ──

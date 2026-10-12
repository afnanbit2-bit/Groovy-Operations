/* Shared fixture for the Production Ops Monitor / Overview tests and their layout fragment (not a *.test.js; the runner skips it).
   NOW = Mon 12 Oct 2026, 09:00 PKT. Fifteen POs, hand-designed so that every number on the tiles can be worked out on paper (see
   tests/ph-mod-monitor.test.js, where each expected value is written next to the arithmetic that gives it). The saved settings are
   {dailyCapacity:300, offWeekdays:[0]}: everything else (stuck after 7 days, delay target 3 days, cut gate 70-130 %) is a ph-core default. */
'use strict';
const NOW=Date.UTC(2026,9,12,4,0);                    // 2026-10-12 09:00 PKT, a Monday
const ms=(y,m,d,h)=>Date.UTC(y,m-1,d,(h===undefined?5:h)-5,0);   // PKT hour (default 05:00 PKT = 00:00 UTC)
const POS=[
  {id:'PO-101',name:'Tee A',code:'GST073',qty:400,poStatus:'in_production',currentStage:'cutting',releasedAt:'2026-10-10T09:00:00+05:00',ts:ms(2026,10,9),season:'winter',seasonYear:2026},
  {id:'PO-102',name:'Tee B',code:'GST074',qty:300,poStatus:'in_production',currentStage:'cutting',releasedAt:'2026-10-08T09:00:00+05:00',ts:ms(2026,10,7)},
  {id:'PO-103',name:'Hoodie',code:'GHD001',qty:200,poStatus:'in_production',currentStage:'cutting',releasedAt:'2026-10-02T09:00:00+05:00',ts:ms(2026,9,30)},
  {id:'PO-104',name:'Cargo',code:'GCA001',qty:150,poStatus:'in_production',currentStage:'cutting',ts:ms(2026,10,5,10)},
  {id:'PO-105',name:'Tee C',code:'GST075',qty:500,poStatus:'in_production',currentStage:'bundling',releasedAt:'2026-10-03T09:00:00+05:00',ts:ms(2026,10,2),
    cutQty:{S:100,M:200,L:150},cutAt:'2026-10-06T10:00:00+05:00',stages:{cutting:{done:true,doneAt:'2026-10-06T10:00:00+05:00'}}},
  {id:'PO-106',name:'Tee D',code:'GST076',qty:300,poStatus:'in_production',currentStage:'stitching',releasedAt:'2026-09-28T09:00:00+05:00',ts:ms(2026,9,27),
    cutQty:{M:100,L:100},cutAt:'2026-10-01T10:00:00+05:00',stages:{bundling:{done:true,doneAt:'2026-10-03T09:00:00+05:00'}}},
  {id:'PO-107',name:'Tee E',code:'GST077',qty:250,poStatus:'in_production',currentStage:'printing',releasedAt:'2026-10-07T09:00:00+05:00',ts:ms(2026,10,6),season:'summer',seasonYear:2026,
    cutQty:{M:130,L:130},cutAt:'2026-10-09T09:00:00+05:00',stages:{stitching:{done:true,doneAt:'2026-10-11T09:00:00+05:00'}}},
  {id:'PO-108',name:'Tee F',code:'GST078',qty:100,poStatus:'in_production',currentStage:'qc',releasedAt:'2026-10-04T09:00:00+05:00',ts:ms(2026,10,3),
    cutQty:{M:150},cutOverride:{by:'afnan',byName:'Afnan',reason:'approved'},cutAt:'2026-10-05T11:00:00+05:00',stages:{washing:{done:true,doneAt:'2026-10-10T09:00:00+05:00'}}},
  {id:'PO-109',name:'Tee G',code:'GST079',qty:200,poStatus:'complete',currentStage:'completed',releasedAt:'2026-09-15T09:00:00+05:00',ts:ms(2026,9,14),
    cutQty:{M:200},cutAt:'2026-09-20T10:00:00+05:00'},
  {id:'PO-110',name:'Reserve A',code:'GST080',qty:600,poStatus:'reserved',currentStage:null,ts:ms(2026,10,11)},
  {id:'PO-111',name:'Reserve B',code:'GST081',qty:100,poStatus:'reserved',currentStage:null,ts:ms(2026,10,11)},
  {id:'PO-112',name:'Cancelled',code:'GST082',qty:999,poStatus:'cancelled',currentStage:null,ts:ms(2026,10,1)},
  {id:'PO-113',name:'No quantity',code:'GST083',poStatus:'in_production',currentStage:'cutting',releasedAt:'2026-10-11T09:00:00+05:00',ts:ms(2026,10,10)},
  {id:'PO-114',name:'Odd stage',code:'GST084',qty:80,poStatus:'in_production',currentStage:'embroidery',ts:ms(2026,10,8)},
  {id:'PO-115',name:'Tee H',code:'GST085',qty:60,poStatus:'in_production',currentStage:'bundling',ts:ms(2026,10,6),cutQty:{M:50},cutAt:'2026-10-08T10:00:00+05:00'}
];
const JOBS=[
  {id:'PO-102',poId:'PO-102',status:'open',plannedCutDate:'2026-10-09',masterName:'Hassan'},
  {id:'PO-105',poId:'PO-105',status:'done',plannedCutDate:'2026-10-05',masterName:'Alam'},
  {id:'PO-107',poId:'PO-107',status:'done',plannedCutDate:'2026-10-09',masterName:'Alam'},
  {id:'PO-108',poId:'PO-108',status:'done',plannedCutDate:'2026-10-06',masterName:'Hassan'}
];
const SETTINGS={dailyCapacity:300,offWeekdays:[0],rev:2};
const clone=x=>JSON.parse(JSON.stringify(x));
/** pos rows as the data layer returns them (fbKey = the document id) */
const posRows=()=>clone(POS).map(p=>Object.assign(p,{fbKey:p.id}));
const jobRows=()=>clone(JOBS).map(j=>Object.assign(j,{fbKey:j.id}));
/** the same data as a fake Firestore keyed by collection path (every doc keeps its own `id` field, as the real PO documents do) */
const dbData=()=>({
  pos:clone(POS),po_cut_jobs:clone(JOBS),po_drafts:[],cutting_masters:[{id:'CM-001',name:'Hassan'},{id:'CM-002',name:'Alam'}],ph_standards:[],
  'ph_settings/main':clone(SETTINGS)
});
module.exports={NOW,POS,JOBS,SETTINGS,posRows,jobRows,dbData,clone};

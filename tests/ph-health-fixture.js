/* Real documents trimmed from the 10 Oct 2026 production backup (QA read-only export): the shapes the Production Ops checks must handle.
   Passes store the PO as 'PO-061' (prefixed), '090' / '125' (bare digits), '538' (a number with no PO) and 'Sample' (free text). */
'use strict';
module.exports={
 "pos": [
  {
   "pattern": "Baggy Shorts U",
   "qty": 90,
   "createdAt": "2026-07-24",
   "name": "MF Shorts - Arctyc White",
   "ratio": "0:1:2:2:1:0",
   "code": "GSO015",
   "currentStage": "cutting",
   "createdBy": "Afnan",
   "totalRoll": "2",
   "id": "PO-017",
   "fabrics": [
    {
     "fabType": "Terry Fresh",
     "fabricCode": "ARCTRY245",
     "rolls": 1,
     "color": "Arctic White",
     "gsm": 245,
     "stockKey": "terry_fresh__245gsm__arctic_white",
     "rollCodes": [
      "ARCTRY245-01-R08"
     ]
    },
    {
     "rollCodes": [
      "GRYTRY235-01-R02"
     ],
     "fabType": "Terry Stock",
     "fabricCode": "GRYTRY235",
     "stockKey": "terry_stock__235gsm__graphite_grey",
     "color": "Graphite Grey",
     "gsm": 235,
     "rolls": 1
    }
   ],
   "store": "",
   "fabric": "Terry Fresh, Terry Stock",
   "fabricCode": "ARCTRY245, GRYTRY235",
   "ts": 1784891095206,
   "sizes": {
    "XL": 15,
    "XS": 0,
    "2XL": 0,
    "L": 30,
    "M": 30,
    "S": 15
   },
   "stages": {
    "cutting": {
     "done": false,
     "doneAt": null
    }
   }
  },
  {
   "ratio": "0:1:2:2:1:0",
   "releasedAt": "2026-08-01T09:02:18.685Z",
   "currentStage": "cutting",
   "createdBy": "Afnan",
   "code": "GB001",
   "pattern": "Oversized Tee",
   "qty": 120,
   "name": "CORE Tees | ACID Washed Blank",
   "totalRoll": "",
   "ts": 1785574931060,
   "store": "",
   "sizes": {
    "XS": 0,
    "S": 20,
    "XL": 20,
    "M": 40,
    "L": 40,
    "2XL": 0
   },
   "releasedBy": "Afnan",
   "fabric": "Cora Jersey",
   "fabrics": [],
   "id": "PO-030",
   "fabricCode": "",
   "poStatus": "in_production",
   "createdAt": "2026-08-01",
   "stages": {
    "cutting": {
     "done": false,
     "doneAt": null
    }
   }
  },
  {
   "releasedAt": "2026-08-10T11:18:57.187Z",
   "store": "",
   "currentStage": "cutting",
   "name": "Live in Pants | Military Green",
   "sizes": {
    "S": 2,
    "XS": 0,
    "2XL": 0,
    "M": 0,
    "L": 0,
    "XL": 0
   },
   "poStatus": "in_production",
   "createdAt": "2026-08-07",
   "pattern": "Essential 2",
   "code": "GST063",
   "fabric": "Terry Fresh",
   "fabricCode": "GRNTRY280",
   "id": "PO-048",
   "ratio": "0:1:0:0:0:0",
   "fabrics": [
    {
     "stockKey": "terry_fresh__280gsm__military_green",
     "fabType": "Terry Fresh",
     "gsm": 280,
     "fabricCode": "GRNTRY280",
     "color": "Military green",
     "rolls": 1,
     "rollCodes": [
      "GRNTRY280-01-R13"
     ]
    }
   ],
   "qty": 20,
   "createdBy": "Afnan",
   "releasedBy": "Afnan",
   "ts": 1786101343379,
   "totalRoll": "1",
   "stages": {
    "cutting": {
     "done": false,
     "doneAt": null
    }
   }
  },
  {
   "store": "",
   "fabric": "Jersey Heavy",
   "sizes": {
    "M": 40,
    "L": 40,
    "2XL": 0,
    "S": 20,
    "XL": 20,
    "XS": 0
   },
   "name": "EFFORTLESS TEE | BLACK",
   "createdAt": "2026-08-10",
   "code": "GP090",
   "pattern": "Effortless",
   "fabricCode": "BLKJRS251, WHTJRS257",
   "qty": 120,
   "id": "PO-061",
   "ratio": "0:1:2:2:1:0",
   "currentStage": null,
   "fabrics": [
    {
     "color": "Black",
     "rollCodes": [
      "BLKJRS251-01-R02"
     ],
     "gsm": 251,
     "rolls": 1,
     "stockKey": "jersey_heavy__251gsm__black",
     "fabType": "Jersey Heavy",
     "fabricCode": "BLKJRS251"
    },
    {
     "gsm": 257,
     "rolls": 1,
     "color": "White",
     "stockKey": "jersey_heavy__257gsm__white",
     "rollCodes": [
      "WHTJRS257-01-R05"
     ],
     "fabType": "Jersey Heavy",
     "fabricCode": "WHTJRS257"
    }
   ],
   "totalRoll": "2",
   "ts": 1786375278229,
   "poStatus": "reserved",
   "createdBy": "Afnan",
   "stages": {
    "cutting": {
     "done": false,
     "doneAt": null
    }
   }
  },
  {
   "ts": 1787227897354,
   "fabrics": [
    {
     "fabricCode": "BLKSUB260",
     "color": "Black",
     "rolls": 1,
     "fabType": "100% Poly Sublimation Jersey",
     "stockKey": "100_poly_sublimation_jersey__260gsm__black",
     "rollCodes": [
      "BLKSUB260-01-R01"
     ],
     "gsm": 260
    }
   ],
   "currentStage": "cutting",
   "fabric": "100% Poly Sublimation Jersey",
   "id": "PO-088",
   "store": "",
   "releasedAt": "2026-08-20T13:50:27.052Z",
   "sizes": {
    "M": 30,
    "L": 30,
    "XL": 20,
    "XS": 0,
    "S": 0,
    "2XL": 0
   },
   "qty": 60,
   "createdAt": "2026-08-20",
   "pattern": "Oversized V-Neck",
   "poStatus": "in_production",
   "fabricCode": "BLKSUB260",
   "ratio": "0:0:2:2:1:0",
   "createdBy": "Afnan",
   "code": "GJ004",
   "releasedBy": "Afnan",
   "totalRoll": "1",
   "name": "Outlaw Mesh Jersey",
   "stages": {
    "cutting": {
     "done": false,
     "doneAt": null
    }
   }
  },
  {
   "qty": 120,
   "id": "PO-090",
   "fabric": "Jersey Heavy",
   "releasedBy": "Afnan",
   "currentStage": "cutting",
   "createdAt": "2026-08-20",
   "ts": 1787229634044,
   "sizes": {
    "S": 20,
    "2XL": 0,
    "XS": 0,
    "M": 40,
    "L": 40,
    "XL": 20
   },
   "fabrics": [
    {
     "gsm": 248,
     "fabricCode": "GRYJRS248",
     "stockKey": "jersey_heavy__248gsm__slate_grey",
     "fabType": "Jersey Heavy",
     "rolls": 1,
     "rollCodes": [
      "GRYJRS248-01-R02"
     ],
     "color": "Slate Grey"
    }
   ],
   "store": "",
   "poStatus": "in_production",
   "fabricCode": "GRYJRS248",
   "name": "RAW CITY POLO",
   "code": "GP098",
   "releasedAt": "2026-08-20T13:44:42.531Z",
   "totalRoll": "1",
   "ratio": "0:1:2:2:1:0",
   "pattern": "CITY POLO",
   "createdBy": "Afnan",
   "stages": {
    "cutting": {
     "done": false,
     "doneAt": null
    }
   }
  },
  {
   "sizes": {
    "M": 40,
    "L": 40,
    "XL": 20,
    "XS": 0,
    "S": 20,
    "2XL": 0
   },
   "ts": 1788523403979,
   "releasedAt": "2026-09-04T12:03:40.914Z",
   "code": "GST074",
   "currentStage": "cutting",
   "store": "",
   "name": "The Heritage Pants | Black (Summer)",
   "pattern": "Heritage",
   "id": "PO-125",
   "createdAt": "2026-09-04",
   "ratio": "0:1:2:2:1:0",
   "poStatus": "in_production",
   "releasedBy": "Afnan",
   "createdBy": "Afnan",
   "fabrics": [],
   "qty": 120,
   "totalRoll": "",
   "fabric": "Terry Fresh Black",
   "fabricCode": "",
   "stages": {
    "cutting": {
     "done": false,
     "doneAt": null
    }
   }
  }
 ],
 "passes": [
  {
   "poId": "538",
   "boras": "0",
   "article": "Terry Fresh 310gsm Black",
   "totalBundles": 8,
   "rollsCount": 1,
   "dest": "Factory",
   "ts": 1783081606732,
   "id": "GP-108",
   "inventoryKey": "terry_fresh__310gsm__black",
   "totalWeight": 30.3,
   "gpType": "fabric",
   "totalUnits": 108,
   "name": "Uzaib",
   "fabricQty": 30.3,
   "fabricType": "Terry Fresh",
   "date": "2026-07-03",
   "fabricUsed": 30.3,
   "avgConsumption": 0.2806,
   "spec": "PO 538 · GSO006 · 1 rolls",
   "consumptionUnit": "kg",
   "rollCodes": [
    "BLKTRY310-01-R01"
   ],
   "regIncomplete": false,
   "cutQty": 108,
   "totalLength": 0,
   "articleCode": "GSO006",
   "plannedQty": 108,
   "fabricUnit": "kg",
   "issuer": "Uzaib",
   "articleName": "Aim Shorts | Black",
   "fabricGsm": 310,
   "fabricColor": "Black"
  },
  {
   "consumptionUnit": "kg",
   "totalUnits": 34,
   "fabricColor": "Brown",
   "articleName": "Baggy Trousers | Mocha Brown",
   "fabricUsed": 26.5,
   "articleCode": "GST004",
   "totalLength": 0,
   "inventoryKey": "terry_fresh__260gsm__brown",
   "id": "GP-109",
   "fabricType": "Terry Fresh",
   "dest": "Factory",
   "ts": 1783082816370,
   "plannedQty": 34,
   "avgConsumption": 0.7794,
   "boras": "0",
   "totalBundles": 1,
   "fabricUnit": "kg",
   "poId": "533",
   "totalWeight": 26.5,
   "rollCodes": [
    "BRNTRY260-01-R13"
   ],
   "cutQty": 34,
   "rollsCount": 1,
   "issuer": "Uzaib",
   "fabricGsm": 260,
   "spec": "PO 533 · GST004 · 1 rolls",
   "regIncomplete": false,
   "date": "2026-07-03",
   "name": "Uzaib",
   "gpType": "fabric",
   "article": "Terry Fresh 260gsm Brown",
   "fabricQty": 26.5
  },
  {
   "totalUnits": 60,
   "gpType": "fabric",
   "consumptionUnit": "kg",
   "totalWeight": 21.1,
   "fabricUsed": 21.1,
   "partialCount": 1,
   "name": "Uzaib",
   "ts": 1789367402788,
   "date": "2026-09-14",
   "boras": "0",
   "fabricType": "Jersey Heavy",
   "spec": "PO 090 · GP098 · 1 rolls",
   "plannedQty": 60,
   "cutQty": 60,
   "articleName": "RAW CITY POLO",
   "fabricColor": "Slate Grey",
   "id": "GP-343",
   "cutMaster": "Alam",
   "article": "Jersey Heavy 248gsm Slate Grey",
   "issuer": "Uzaib",
   "fabricUnit": "kg",
   "totalLength": 0,
   "articleCode": "GP098",
   "poId": "090",
   "fabrics": [
    {
     "gsm": 248,
     "avgConsumption": 0.3517,
     "fabType": "Jersey Heavy",
     "rollCodes": [
      "GRYJRS248-01-R05"
     ],
     "weight": 21.1,
     "color": "Slate Grey",
     "rollsCount": 1,
     "unit": "kg",
     "inventoryKey": "jersey_heavy__248gsm__slate_grey"
    }
   ],
   "fabricQty": 21.1,
   "totalBundles": 4,
   "rollsCount": 1,
   "dest": "Factory",
   "fabricGsm": 248,
   "avgConsumption": 0.3517,
   "fabricCount": 1,
   "inventoryKey": "jersey_heavy__248gsm__slate_grey",
   "rollCodes": [
    "GRYJRS248-01-R05"
   ],
   "partialRolls": [
    {
     "usedWeight": 21.1,
     "unit": "kg",
     "rollCode": "GRYJRS248-01-R05",
     "weightAfter": 8.8,
     "weightBefore": 29.9
    }
   ]
  },
  {
   "plannedQty": 131,
   "cutQty": 131,
   "spec": "PO 125 · GST074",
   "fabricCount": 1,
   "fabricQty": 61.9,
   "editedAt": 1789728766568,
   "partialCount": 0,
   "issuer": "Uzaib",
   "fabricUnit": "kg",
   "totalUnits": 131,
   "fabricGsm": 290,
   "article": "Terry Fresh 290gsm Black",
   "gpType": "fabric",
   "name": "Uzaib",
   "fabricUsed": 61.9,
   "rollCodes": [
    "BLKTRY290-01-R05",
    "BLKTRY290-01-R06"
   ],
   "fabricType": "Terry Fresh",
   "boras": "0",
   "date": "2026-09-14",
   "articleName": "The Heritage Pants | Black",
   "fabricColor": "Black",
   "totalBundles": 7,
   "id": "GP-345",
   "fabrics": [
    {
     "inventoryKey": "terry_fresh__290gsm__black",
     "color": "Black",
     "weight": 61.9,
     "rollsCount": 2,
     "fabType": "Terry Fresh",
     "gsm": 290,
     "avgConsumption": 0.8891,
     "rollCodes": [
      "BLKTRY290-01-R05",
      "BLKTRY290-01-R06"
     ],
     "unit": "kg"
    }
   ],
   "editedBy": "Mustafa",
   "articleCode": "GST074",
   "totalLength": 0,
   "poId": "125",
   "avgConsumption": 0.4725,
   "inventoryKey": "terry_fresh__290gsm__black",
   "ts": 1789368525625,
   "totalWeight": 61.9,
   "rollsCount": 2,
   "cutMaster": "Alam",
   "dest": "Factory",
   "consumptionUnit": "kg",
   "partialRolls": []
  },
  {
   "partialCount": 0,
   "name": "Uzaib",
   "cutQty": 0,
   "ts": 1784358080584,
   "cutMaster": "Hassan",
   "date": "2026-07-18",
   "issuer": "Uzaib",
   "fabricCount": 1,
   "fabrics": [
    {
     "fabType": "Jersey Heavy",
     "avgConsumption": 0,
     "inventoryKey": "jersey_heavy__245gsm__white",
     "weight": 33.9,
     "color": "White",
     "unit": "kg",
     "rollsCount": 1,
     "rollCodes": [
      "WHTJRS245-01-R01"
     ],
     "gsm": 245
    }
   ],
   "boras": "0",
   "rollsCount": 1,
   "gpType": "fabric",
   "id": "GP-172",
   "spec": "PO Sample · Sample · 1 rolls",
   "consumptionUnit": "kg",
   "rollCodes": [
    "WHTJRS245-01-R01"
   ],
   "articleCode": "Sample",
   "totalLength": 0,
   "fabricUnit": "kg",
   "dest": "Factory",
   "poId": "Sample",
   "plannedQty": 0,
   "fabricColor": "White",
   "totalBundles": 0,
   "articleName": "Sample",
   "fabricGsm": 245,
   "fabricUsed": 33.9,
   "avgConsumption": 0,
   "article": "Jersey Heavy 245gsm White",
   "partialRolls": [],
   "fabricType": "Jersey Heavy",
   "totalWeight": 33.9,
   "fabricQty": 33.9,
   "totalUnits": 0,
   "inventoryKey": "jersey_heavy__245gsm__white"
  },
  {
   "ribRolls": 1,
   "inventoryKey": "jersey_heavy__251gsm__black",
   "poId": "PO-061",
   "fabricQty": 51.98,
   "totalLength": 0,
   "articleCode": "GP090",
   "dest": "Factory",
   "avgConsumption": 0.4332,
   "partialRolls": [
    {
     "usedWeight": 12.2,
     "unit": "kg",
     "weightAfter": 21.4,
     "rollCode": "BLKJRS251-01-R04",
     "weightBefore": 33.6
    },
    {
     "usedWeight": 14.38,
     "unit": "kg",
     "weightBefore": 28.8,
     "weightAfter": 14.42,
     "rollCode": "WHTJRS257-01-R07"
    }
   ],
   "articleName": "EFFORTLESS TEE | BLACK",
   "fabricColor": "Black",
   "fabricGsm": 251,
   "ribGsm": 406,
   "ribType": "Rib 2x2",
   "totalWeight": 51.98,
   "totalBundles": 8,
   "rollsCount": 3,
   "article": "Jersey Heavy 251gsm Black + Jersey Heavy 257gsm White",
   "ribWeight": 6.2,
   "rollCodes": [
    "BLKJRS251-01-R05",
    "BLKJRS251-01-R04",
    "WHTJRS257-01-R07"
   ],
   "boras": "0",
   "consumptionUnit": "kg",
   "plannedQty": 120,
   "fabrics": [
    {
     "weight": 37.6,
     "fabType": "Jersey Heavy",
     "color": "Black",
     "unit": "kg",
     "gsm": 251,
     "rollCodes": [
      "BLKJRS251-01-R05",
      "BLKJRS251-01-R04"
     ],
     "avgConsumption": 0.3133,
     "rollsCount": 2,
     "inventoryKey": "jersey_heavy__251gsm__black"
    },
    {
     "inventoryKey": "jersey_heavy__257gsm__white",
     "avgConsumption": 0.1198,
     "unit": "kg",
     "rollsCount": 1,
     "gsm": 257,
     "weight": 14.38,
     "rollCodes": [
      "WHTJRS257-01-R07"
     ],
     "fabType": "Jersey Heavy",
     "color": "White"
    }
   ],
   "ts": 1787038753668,
   "cutQty": 120,
   "ribRollCodes": [
    "WHTR22406-01-R01"
   ],
   "ribPct": 4,
   "date": "2026-08-18",
   "fabricCount": 2,
   "name": "Uzaib",
   "ribColor": "White",
   "issuer": "Uzaib",
   "fabricUnit": "kg",
   "regIncomplete": false,
   "totalUnits": 120,
   "gpType": "fabric",
   "spec": "PO PO-061 · GP090 · 3 rolls · 2 fabrics",
   "cutMaster": "Alam",
   "fabricUsed": 51.98,
   "fabricType": "Jersey Heavy",
   "partialCount": 2,
   "id": "GP-264"
  },
  {
   "plannedQty": 120,
   "ts": 1785754120231,
   "regIncomplete": false,
   "fabricCount": 2,
   "totalBundles": 8,
   "fabricUnit": "kg",
   "cutMaster": "Alam",
   "spec": "PO PO-017 · GSO015 · 2 rolls · 2 fabrics",
   "date": "2026-08-03",
   "totalUnits": 120,
   "partialRolls": [],
   "name": "Uzaib",
   "article": "Terry Fresh 245gsm Arctic White + Terry Stock 235gsm Graphite Grey",
   "consumptionUnit": "kg",
   "fabricUsed": 48.5,
   "inventoryKey": "terry_fresh__245gsm__arctic_white",
   "id": "GP-220",
   "fabricType": "Terry Fresh",
   "articleName": "MF Shorts - Arctyc White",
   "boras": "0",
   "partialCount": 0,
   "fabricGsm": 245,
   "fabricColor": "Arctic White",
   "rollCodes": [
    "ARCTRY245-01-R08",
    "GRYTRY235-01-R02"
   ],
   "fabrics": [
    {
     "rollsCount": 1,
     "rollCodes": [
      "ARCTRY245-01-R08"
     ],
     "avgConsumption": 0.2358,
     "color": "Arctic White",
     "gsm": 245,
     "unit": "kg",
     "fabType": "Terry Fresh",
     "weight": 28.3,
     "inventoryKey": "terry_fresh__245gsm__arctic_white"
    },
    {
     "gsm": 235,
     "unit": "kg",
     "rollCodes": [
      "GRYTRY235-01-R02"
     ],
     "color": "Graphite Grey",
     "inventoryKey": "terry_stock__235gsm__graphite_grey",
     "fabType": "Terry Stock",
     "rollsCount": 1,
     "weight": 20.2,
     "avgConsumption": 0.1683
    }
   ],
   "gpType": "fabric",
   "totalLength": 0,
   "articleCode": "GSO015",
   "dest": "Factory",
   "fabricQty": 48.5,
   "issuer": "Uzaib",
   "rollsCount": 2,
   "totalWeight": 48.5,
   "poId": "PO-017",
   "cutQty": 120,
   "avgConsumption": 0.4042
  }
 ]
};

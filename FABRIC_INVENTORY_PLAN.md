# Fabric Inventory — Plan & Acceptance Spec

> Draft of **what the new Fabric Inventory module must achieve**, written as
> testable workflows so we can hunt bugs against it phase by phase.
> Status legend: ☐ not built · ◐ in progress · ☑ done.

## 0. Goal in one line
Move all fabric handling out of **Store** and **Gate Pass** into a single
top-level **Fabric Inventory** tab that tracks every roll by barcode from
supplier → stock → (reserved to PO) → issued to vendor → returned, with
wastage and low-stock alerts.

## 1. Decisions locked (from planning Q&A)
- **Access:** owners + managers only.
- **Migration:** full move — remove from Store and Gate Pass (one home).
- **Returns:** both directions — Vendor→Stock (in) and To Supplier (out).
- **Partial returns:** allowed → mint a remnant roll (`…-A`) with its own barcode.
- **Picking:** scanner-first (scan field), on-screen list as fallback.
- **Issue:** must be linked to a PO (required).
- **Reservation:** created in the **New PO** tab (pick fabric → pick rolls →
  reserved to that PO), manual override; reserved rolls stay **in stock**
  until a gate pass issues them.
- **Approvals:** none — movements apply immediately, fully audit-logged.
- **Stock view:** Option A rows = Color+Type+GSM, **supplier shown per row**,
  expandable to lots → rolls; full lifecycle visible with status badges.
- **Code scheme:** `COLOR+TYPE+GSM-LOT-Rnn` (e.g. `BLKTRY220-01-R03`),
  remnant `…-R03-A`. Linear **CODE128** barcode encodes this string.
- **QC:** warn only, never blocks issue/reserve.
- **Label:** 4.8 cm × 2.3 cm — supplier name, weight, roll number, barcode.
- **Low stock:** per-fabric custom thresholds, 3 alert stages, colour-coded.
- **Wastage:** track consumed weight per roll → per-PO wastage report.
- **Exports:** Excel + PDF (stock, movements, wastage).

## 2. Glossary / data model
- **Roll** — one physical fabric roll. Unique `rollCode`. Statuses:
  `in_stock` → `reserved` → `issued` → (`in_stock` via return | `returned_supplier`).
  Remnant = `in_stock` roll with `remnant:true` + `parentRollCode`.
- **Lot** — one receipt/delivery of a Color+Type+GSM combo (`-01`, `-02`…).
- **`fabric_inventory/{key}`** — key = Color+Type+GSM; holds `rolls[]` + totals.
- **`fabric_movements/{id}`** — `type:in|out` + `subtype:receipt|reserve|release|issue|return_in|return_out`.
- **Consumed** — issued weight minus returned remnant weight.

## 3. End-to-end workflow the module must support
```
Supplier delivers ─▶ [Fabric In] generate code, barcode each roll ─▶ STOCK(in_stock)
STOCK ─▶ [New PO: reserve rolls] ─▶ reserved (still physically in stock)
reserved ─▶ [Issue: scan rolls, PO required] ─▶ issued ─▶ vendor
issued  ─▶ [Returns ▸ Vendor→Stock] whole ─▶ in_stock
        └▶ partial ─▶ remnant roll (new barcode) + consumed logged
STOCK   ─▶ [Returns ▸ To Supplier] reason ─▶ returned_supplier (leaves stock)
any movement ─▶ fabric_movements + activity log ; Reports read these
```

## 4. Acceptance criteria (the bug-hunt checklist)

### 4.1 Navigation & access
- ☐ "Fabric Inventory" appears in main nav for owners + managers only;
  hidden for workers / store / viewer.
- ☐ No "Fabric Inventory" under Store; no "Fabric In" tab under Gate Pass
  (after their phases land).
- ☐ Page opens with sub-tabs: Stock · Fabric In · Issue · Returns · Reports.

### 4.2 Stock tab
- ☐ One row per Color+Type+GSM; shows rolls count, total weight, supplier(s),
  alert colour, last-move date.
- ☐ Expand a row → its lots → individual rolls with status badges.
- ☐ Search by type/color/GSM and filter (in-stock / out / all) work.
- ☐ Reprint label button on any roll.
- ☐ Totals in the header reconcile with the sum of rows.

### 4.3 Fabric In
- ☐ Generates `COLOR+TYPE+GSM-LOT` code; lot auto-increments per combo.
- ☐ Each roll gets `-Rnn` + scannable CODE128; per-roll weight + GSM + QC.
- ☐ Save writes `fabricin` + upserts `fabric_inventory` + logs `receipt` move.
- ☐ Rolls land as `in_stock`; totals update without reload.

### 4.4 Reservation (New PO tab)
- ☐ New PO lets you pick a fabric then specific rolls → status `reserved`,
  tagged with the PO; rolls stay counted as physically in stock.
- ☐ Manual override to reserve/free any roll.
- ☐ Deleting/closing the PO releases its reservations back to `in_stock`.

### 4.5 Issue
- ☐ Scan field adds rolls by code; rejects unknown / already-issued codes.
- ☐ PO selector is required; reserved-for-PO rolls surface first.
- ☐ Save flips rolls `→ issued`, deducts weight, logs `issue` move + activity.
- ☐ Non-QC rolls warn but can still be issued.

### 4.6 Returns
- ☐ Vendor→Stock, whole roll: `issued → in_stock`, weight restored, `return_in`.
- ☐ Vendor→Stock, partial: mint remnant `…-A` (`in_stock`, own barcode),
  parent stays issued, consumed weight = issued − returned, logged.
- ☐ To Supplier: pick in-stock rolls, reason (preset list **or** free note),
  `→ returned_supplier`, weight deducted, `return_out` logged, transit doc.

### 4.7 Alerts
- ☐ Per-fabric 3 thresholds editable; Stock row shows the matching colour;
  out-of-stock distinct from low.

### 4.8 Reports
- ☐ Stock-on-hand, movement history, per-PO wastage — each exportable to
  Excel and PDF (via the print engine).

## 5. Known edge cases to test (likely bug sources)
- Duplicate scan of the same roll in one issue/return batch.
- Returning more weight than was issued (partial > issued).
- Two remnants off the same parent (`-A`, `-B`) must not collide.
- Same Color+Type+GSM from two suppliers in one stock row (supplier display).
- Re-order of an identical fabric → new lot, not merged into the old one.
- Reserved roll that someone then tries to issue against a *different* PO.
- Code collision when color/type abbreviations clash (override path).
- Unit mix (kg vs meters) within reports and totals.

## 6. Build phases (each shippable)
1. ☐ `js/fabric.js` + nav + **Stock** tab (move from `store.js`).
2. ☐ New code scheme + **Fabric In** moved in; removed from Gate Pass.
3. ☐ **Issue** tab (scanner-first, PO-required); remove GP fabric-outward.
4. ☐ **Returns** — vendor whole → partial/remnant + consumed → supplier-out.
5. ☐ **Reservation** in New PO (`pos.js`).
6. ☐ **Alerts** (3-stage) + **Reports** (Excel/PDF).
7. ☐ Remove Store entry point; cleanup + label sizing.

*This doc is the contract; update the ☐/☑ marks as each phase is verified.*

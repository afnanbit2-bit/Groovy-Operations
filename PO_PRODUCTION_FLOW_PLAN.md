# PO ↔ Fabric ↔ Production ↔ Fulfilment — Master Flow Plan

> Status: **PLANNING ONLY — no code written yet.** This document is the single
> source of truth for the PO Registry / Fabric Inventory redesign. It captures
> the complete journey agreed with Afnan across the planning conversation.
> Open decisions are marked **[DECISION NEEDED]**. Nothing here is built until
> the decisions are locked.

## 0. Guiding principle

- **PO Registry = a grand-scale process wired to Fabric Inventory**, not a flat
  list. A PO moving through the factory *is* a series of fabric + quantity
  events.
- **The PO number is the golden thread** end-to-end. Every mile — cutting,
  packing receipt, QC disposition, B-stock, barcoding/transfer, pickup — is
  keyed and identified by the PO.
- **Managers observe the whole journey** (Afnan, Ammar, Arfat, Mustafa) from a
  **tabbed PO Registry = mission control**. Every PO is identifiable at
  whatever mile it currently sits.

## 1. Actors / accounts

| User | Role | Responsibility in this flow | Change |
|------|------|-----------------------------|--------|
| Afnan, Ammar | owner | Full monitoring; create POs | — |
| Mustafa, Arfat | manager | Full monitoring; create POs | — |
| **Uzaib** | (cutting/fabric) | **Cutting + Fabric Inventory** — records cut output | **MOVED from Zohaib → Uzaib** |
| Waqas | worker | Stitching | — |
| Abbas | worker | **Garment washing / dyeing** (a real production process — NOT Haris's QC washing) | — |
| **Faizan** | **NEW — packing/dispatch** | (a) Packing **receipt** of finished pieces in batches; (b) **Ready-to-Barcode** scan → **Stock Transfer Receipt** | **NEW ACCOUNT** |
| Haris | worker (QC) | **QC disposition** of received batches | expanded role |
| Umair | fulfilment | Receives transfer notification → picks up | — |

## 2. PO lifecycle — the complete journey

```
[Manager] Create PO (digital + printable PDF) ─▶ PO Registry: RESERVED
        │  reserve fabric rolls → add/select more until PO qty is fully covered
        ▼
[Uzaib]  Release to production → CUTTING (consumes reserved fabric; records cut qty per size)
        │        (+ embellishment / stitching / garment-wash per the PO's needs)
        ▼
[Faizan] PACKING RECEIPT — finished pieces received in BATCHES
        │   per size · dated/timestamped · entered-by recorded · cumulative
        │   bar:  cut 80 · received 20 · yet-to-receive 60
        ▼
[Haris]  QC DISPOSITION of each received batch
        │   passed + rafu + washing(QC) + alteration + bstock = received  (conservation)
        │   ├─ QC passed ─────────────▶ back to Faizan "Ready to Barcode"
        │   ├─ rafu / washing / alteration ─(rework)─▶ Barcoding (fixed)  or  B-stock (fails)
        │   └─ B-stock ─▶ carton-assigned B-STOCK INVENTORY
        ▼
[Faizan] READY TO BARCODE — scan barcoded pieces → STOCK TRANSFER RECEIPT (PDF + summary) → BOOK
        │   bar:  cut 80 · transferred 50 · balance 30
        ▼
[Umair]  Notification "ready to pick from Faizan" → picks up
        ▼
   PO COMPLETE  (only when every size: received == cut AND fully dispositioned & transferred)
```

## 3. Core data model — the per-size quantity ledger

The biggest shift: a PO is no longer a chain of done/not-done stage booleans. It
carries a **per-size ledger** that every mile writes into, and the registry
reconciles. Conceptual shape (per PO, per size):

```
size M:
  cut:            10          # from Uzaib cutting output
  received:        8          # Σ Faizan packing batches
  qc: { passed: 6, rafu: 1, washing: 1, alteration: 1, bstock: 1 }
  reworkResolved: { toBarcode: 2, toBstock: 1 }   # rafu/wash/alt outcomes
  transferred:     5          # Σ booked stock transfers
  balance:  cut - transferred # 5
```

**Conservation invariants (must always hold):**
- `qc.passed + qc.rafu + qc.washing + qc.alteration + qc.bstock == received`
- `cut == transferred + bstock + inRework(unresolved) + notYetReceived`
- PO closes only when, for **every size**: `received == cut` AND `inRework == 0`
  (every received piece is either transferred/barcoded or B-stock).

Append-only sub-logs (each entry: qty, size, timestamp, user):
- `packingReceipts[]` — Faizan's batch receipts
- `qcDispositions[]` — Haris's splits
- `stockTransfers[]` — Faizan's booked transfers

## 4. Mile-by-mile detail

### 4.1 PO creation + Reserve
- `submitPO` no longer sets `currentStage:'cutting'`. A new PO enters as
  **RESERVED** (a reserve order — an intention, not yet on the factory floor).
- **[DECISION NEEDED]** Model "reserved" as a new `poStatus` field
  (`reserved | in_production | complete`) sitting *above* `currentStage`, vs. a
  new `reserved` pseudo-stage. Recommendation: a `poStatus` field, leaving the
  existing `STAGES` for physical production.
- PDF: printable physical copy for the factory — routed through the
  **print-engine** `po` variant (already `urduLevel:'full'`).

### 4.2 Fabric reservation + coverage
- Reuse existing `reserved` roll state + `reservedPO` tag (`fabPoReserveCommit`,
  `fabReleaseForPO`).
- **NEW: coverage logic** — compare reserved fabric (weight/rolls) against the
  PO's fabric requirement; allow **add more / select required rolls** until the
  PO is "covered". Surfaced in create-PO and/or the Reserved tab.
- **DECIDED:** Fabric reservation is **optional (warn only)** — a PO can be
  released without full coverage, but the Release action shows a clear warning
  when reserved fabric doesn't cover the required qty. Keeps flexibility for
  fabric handled outside the app.

### 4.3 Release to production → Cutting (Uzaib)
- **DECIDED:** RESERVED → CUTTING is triggered by an explicit **"Release to
  production"** action clicked by a **manager**. The Release action checks
  fabric coverage and warns (does not block — see §4.2) if under-covered. This
  is the moment a reserve order becomes a real factory job (audit-stamped:
  who released, when).
- Uzaib records **cut output per size** ("this PO cut qty = 80"). Consumes the
  reserved fabric (existing `markCuttingDone` consumption path).
- **[DECISION NEEDED]** "Cutting enters output in the Fabric Inventory tab" —
  reconcile against the existing cutting stage-work screen so we don't build two
  competing cutting-entry UIs. Likely: keep one entry point, surfaced from both
  the Fabric Inventory tab and the PO.

### 4.4 Packing receipt — Faizan (batches)
- Faizan sees POs whose lots have been cut; **search to identify which PO** a
  received lot belongs to.
- Enters **received qty per size, in batches** over multiple days. Each batch:
  `{ size, qty, timestamp, enteredBy }`. Cumulative, append-only.
- The whole lot is rarely completed in one go — **PO cannot close until every
  size is fully received.** UI must look **factory-grade / professional**:
  clean per-size rows, pending vs. complete, timestamped batch history.
- Live bar: `cut 80 · received 20 · yet-to-receive 60`.

### 4.5 QC disposition — Haris
- Each Faizan batch is **forwarded to Haris**; Haris sees the same bar
  (`cut · received · yet-to-receive`).
- Haris accounts for **every received piece** into:
  `passed → barcoding` · `rafu` · `washing (QC clean, NOT Abbas)` ·
  `alteration` · `bstock`. Enforced sum == received.
- **Rework buckets (rafu / washing / alteration) are intermediate** — each
  reworked piece resolves to **Barcoding (fixed)** or **B-stock (fails)**.
- Only two terminal destinations for any cut piece: **Barcoding (good)** or
  **B-stock (seconds)**.

### 4.6 B-stock carton inventory
- B-stock is its own managed inventory (new collection, e.g. `bstock_items`).
- Each piece: **PO · product · article · size**, **assigned to a Box/carton
  (carton number)**.
- Tracks which PO/product/size/article sits in which carton + totals.
- **Viewable by all managers.**

### 4.7 Ready-to-Barcode + Stock Transfer — Faizan
- QC-passed quantity appears in Faizan's **Ready to Barcode** section.
- Faizan **scans the already-barcoded pieces** → generates a **Stock Transfer
  Receipt**: **printable PDF with a summary page** (print-engine — likely a new
  `stock-transfer` variant).
- **Booking** the transfer records `stockTransfers[]` and fires Umair's
  notification.
- Barcoding here = **proof of work only**. Finished-goods stock still lives in
  the **local ERP** for now; Groovy Operations will absorb it later. **No ERP
  integration in this phase.**
- Bar: `cut 80 · transferred 50 · balance 30`.

### 4.8 Umair pickup
- On transfer booking, a **notification on Umair's tab**: "these products, these
  sizes, ready to pick from Faizan."
- Umair sees the same completion bar. Pickup advances the PO toward COMPLETE.

### 4.9 Manager PO Registry — mission control (tabbed)
- Central observatory for Afnan / Ammar / Arfat / Mustafa: **every PO's full
  journey**, each mile in its own tab for identification.
- **DECIDED: tabs organised by journey mile:**
  `Reserved · In Production (Cutting…) · Packing (receiving) · QC & Disposition ·
  B-stock · Ready/Transfer · With Umair · Completed` — find any PO by where it
  sits. Each PO card shows its live per-size bars (cut / received / transferred /
  balance) and both the cutting entry and Faizan's packing entry side by side.

## 5. Stage / status ordering

Existing `STAGES` (shared.js): `cutting · printing(Embellishment QC) · bundling ·
stitching · washing · qc`.

Proposed new spine (**[DECISION NEEDED]** — confirm ordering, esp. where garment
washing and packing sit):

```
RESERVED (status)
  → cutting (Uzaib) → [printing/embellishment] → bundling → stitching
  → [garment washing (Abbas) — when the PO needs it]
  → packing-receipt (Faizan)
  → qc-disposition (Haris)
  → ready-to-barcode / stock-transfer (Faizan)
  → with-umair (pickup)
  → COMPLETE
```

Note: **Faizan appears twice** (receiving, then transfer) — two sub-views in his
window, not two stages necessarily.

## 6. New collections / schema (draft)

- `pos` — extend with `poStatus`, per-size `ledger`, `packingReceipts[]`,
  `qcDispositions[]`, `stockTransfers[]`.
- `bstock_items` (or `bstock_cartons` + items) — B-stock inventory + carton map.
- `stock_transfers` — booked transfer receipts (or embed in `pos`).
- Notifications — reuse existing notification pattern for Umair's alert.
- `firestore.rules` — add read/write scoping for the new collections + roles.

## 7. New print-engine variants

- `po` (exists) — factory physical copy at PO creation.
- **`stock-transfer`** (new) — Faizan's transfer receipt, PDF + summary page.
- Possibly a **B-stock carton label**.

## 8. New roles / permissions

- Add **Faizan** to `USER_DEFS` (packing/dispatch role) + nav + `renderPage`
  dispatch + a permission helper (e.g. `isPacking()`).
- Move cutting/fabric ownership to **Uzaib** (`STAGES` cutting owner; fabric).
- Extend Haris (QC) with the disposition view.
- Umair (fulfilment) gets the pickup/transfer-notification view.

## 9. Open decisions (consolidated)

**Resolved:**
- ✅ RESERVED → CUTTING trigger: **explicit manager "Release to production"**.
- ✅ Fabric reservation before release: **optional (warn only)**.
- ✅ Manager overview: **tabs by journey mile** (§4.9).

**Still open:**
1. `reserved` as a `poStatus` field vs. a pseudo-stage. *(rec: field — will
   default to this unless told otherwise.)*
2. Single cutting-output entry point (Fabric tab vs. existing stage-work screen).
3. Stage/status **ordering** incl. garment washing + packing placement (§5).
4. Does Haris hand rafu/alteration to other workers (own views) or work them
   himself?

## 10. Proposed build sequencing (once decisions locked)

1. Data model + `poStatus` + per-size ledger (no UI behaviour change yet).
2. Reserve-order state at PO creation + fabric coverage + Release action.
3. Uzaib ownership move + cutting-output entry.
4. Faizan account + packing-receipt (batch) view + completion bars.
5. Haris QC disposition + conservation enforcement.
6. B-stock carton inventory + manager view.
7. Faizan Ready-to-Barcode + Stock Transfer PDF + booking.
8. Umair notification + pickup + PO completion.
9. Manager tabbed PO Registry mission-control.
10. `firestore.rules` update + publish.
```

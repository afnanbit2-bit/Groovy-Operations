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
| ~~Abbas~~ | — | Garment washing/dyeing — **OUT of this flow.** ("Washing" here is only a Haris QC label, see §4.5.) | excluded |
| **Faizan** | **NEW — packing/dispatch** | (a) Packing **receipt** of finished pieces in batches; (b) **Ready-to-Barcode** scan → **Stock Transfer Receipt** | **NEW ACCOUNT** |
| Haris | manager (QC) | **QC disposition** of received batches; records rework himself | expanded role |
| Umair | fulfilment | Receives transfer notification → picks up | — |

> Haris, Faizan and Uzaib each manage their own teams and report to Mustafa;
> Afnan observes. Individual workers are **not** modelled — only the named
> managers. The only new account to create is **Faizan**.

## 2. PO lifecycle — the complete journey

**Tracked spine = Cutting → Packing → QC → Transfer → Pickup.** Stitching (and
any embellishment) happen physically but are **not tracked as stages** in this
flow — after cutting, the next tracked event is Faizan receiving pieces.

```
[Manager] Create PO (digital + printable PDF) ─▶ PO Registry: RESERVED
        │  reserve fabric rolls → add/select more until PO qty is covered (optional, warn-only)
        ▼
[Manager] "Release to production" ─▶ poStatus: in_production, currentStage: cutting
        ▼
[Uzaib]  Issue fabric to production (Issue Registry) + record ACTUAL cut qty per size  ← anchor "cut" number
        │        (stitching etc. happen physically, untracked)
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
- **Entry point = "Issue fabric to production"** in the existing Fabric **Issue
  Registry** (Uzaib). Consumes reserved fabric (existing consumption path). That
  issue data is **mirrored as a duplicate tab in the PO Registry** (+ overview +
  tags). No second cutting-entry UI.
- **Uzaib records the ACTUAL cut pieces per size** — this is the **anchor `cut`
  number** every downstream bar reconciles against (may differ from the PO's
  ordered qty). Received / transferred / balance are all measured against it.

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
- **B-stock also moves onward later** — it gets its **own transfer / pickup**
  (to a B-stock destination), not just parked forever. So B-stock has two
  states: *in carton inventory* → *transferred out*. Mirrors the good-goods
  transfer mechanism (§4.7) on a separate B-stock track.

### 4.7 Ready-to-Barcode + Stock Transfer — Faizan
- QC-passed quantity appears in Faizan's **Ready to Barcode** section.
- **Barcodes come from the ERP / product SKU** — pieces already carry the
  existing product barcode. Groovy Ops **does not generate barcodes**; Faizan
  simply **scans the existing barcode** to build the transfer.
- Faizan **scans the barcoded pieces** → generates a **Stock Transfer Receipt**:
  **printable PDF with a summary page** (print-engine — new `stock-transfer`
  variant).
- **Booking** the transfer records `stockTransfers[]` and fires Umair's
  notification.
- The scan/transfer here = **proof of work only**. Finished-goods stock still
  lives in the **local ERP** for now; Groovy Operations will absorb it later.
  **No ERP integration in this phase.**
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

## 5. Stage / status ordering — **the lean spine (DECIDED)**

Existing `STAGES` (shared.js) stay as-is for anything that still uses them, but
**this flow tracks only the lean spine below.** Stitching / bundling /
embellishment / garment-washing happen physically but are **not tracked as
stages here.**

```
poStatus: RESERVED
  → [manager Release] → poStatus: IN_PRODUCTION
      → cutting (Uzaib: issue fabric + record actual cut/size)   ← anchor "cut"
      → packing-receipt (Faizan: batches)
      → qc-disposition (Haris)
      → ready-to-barcode / stock-transfer (Faizan: scan ERP barcode → PDF → book)
      → with-umair (pickup)
  → poStatus: COMPLETE   (every size: received == cut AND fully dispositioned & transferred)
```

Notes:
- **Faizan appears twice** (receiving, then transfer) — two sub-views in his
  window, not two stages.
- **B-stock** runs a parallel terminal track: QC → carton inventory →
  (later) its own transfer/pickup (§4.6).

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
- ✅ `reserved` modelled as a **`poStatus` field**, not a pseudo-stage (keeps it
   out of the factory-stage machinery).
- ✅ **Cutting entry = "Issue fabric to production"** via the existing Fabric
   **Issue Registry** (Uzaib). That same issue data is **mirrored as a duplicate
   tab inside the PO Registry** + overview + tags. No separate competing
   cutting-entry UI is built.
- ✅ **Abbas / garment-washing is OUT of this system.** The "washing" bucket is
   **only a label Haris records** at QC disposition — not a production stage,
   not Abbas's dyeing/washing.
- ✅ **Workers are not individually modelled.** Haris, Faizan and Uzaib are each
   reporting managers over their own teams; all report to Mustafa; Afnan
   observes. We model only the named managers. Rework (rafu / alteration /
   washing) is **recorded by Haris himself** — no separate worker accounts or
   views. The **only NEW account is Faizan**; Uzaib/Haris/Umair already exist.

- ✅ **Cut quantity** = **Uzaib enters actual cut pieces per size** (the anchor
   number; may differ from ordered qty).
- ✅ **Tracked stages** = **lean spine**: Cutting → Packing → QC → Transfer →
   Pickup. Stitching/embellishment untracked (§5).
- ✅ **Barcodes** = **from the ERP / product SKU** — Faizan scans existing
   barcodes; Groovy Ops does not generate them.
- ✅ **B-stock** = **also transferred later** (own transfer/pickup), not a pure
   dead-end (§4.6).

**All planning decisions are now resolved.** Ready to convert §10 into a
phased, file-by-file build proposal on request.

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

## 11. Phased build proposal — file-by-file (for review, NOT yet built)

Grounded in the current code. Each phase is independently shippable and leaves
the app working. Real function/line anchors are noted.

**File-placement recommendation:** put the new spine (packing, QC disposition,
B-stock, transfer) in **one new classic script `js/production.js`**, loaded in
`index.html` right after `js/fabric.js`. That is **one edit to `index.html`** —
a cross-track file (coordinate with Ammar per CLAUDE.md) — and avoids bloating
`pos.js` further. PO-registry and PO-create changes stay in `pos.js`; fabric
issue changes stay in `js/fabric.js`.

### Phase 0 — Foundation: roles + data model (no visible change)
- `js/auth.js` (`USER_DEFS`, line 7): add **Faizan** `{u:'faizan', role:'packing',
  canPO:false, canFabric:false, stages:[]}`; add helper `isPacking()`.
- `js/shared.js` (`STAGES`, line 11): change cutting **owner Zohaib → Uzaib**.
  (Uzaib already `canFabric:true`.)
- `js/pos.js`: pure helpers for the **per-size ledger** + conservation math
  (no UI). Define `poStatus` values (`reserved|in_production|complete`).
- `firestore.rules`: pre-add `bstock_items`, `stock_transfers` (read: signedIn;
  write: signedIn) so later phases don't 403.
- **Acceptance:** app unchanged; Faizan can log in to an empty shell.

### Phase 1 — Reserve orders + Release
- `js/pos.js` `submitPO()` (line 577): set `poStatus:'reserved'`, **stop
  auto-setting `currentStage:'cutting'`** (leave null until release). Keep the
  PDF (print-engine `po`).
- `js/pos.js` `renderPOCreate()` (line 422): surface the existing reserve picker
  (`fabPoReservePick`, fabric.js:2714) + a **coverage meter** (reserved vs
  required) with warn-only.
- `js/pos.js`: new `window.releaseToProduction(poId)` — manager-only; sets
  `poStatus:'in_production'`, `currentStage:'cutting'`, audit stamp; warns if
  under-covered.
- `js/pos.js` `renderRegistry()` (line 282): show reserved POs with a **Release**
  button for managers.
- **Acceptance:** new PO = reserved; manager Release → cutting.

### Phase 2 — Uzaib cutting: issue-to-production + actual cut, mirrored tab
- `js/fabric.js` `renderFabricIssueRegistry()` (line 1606) / issue flow: on
  issue-to-production, consume reserved rolls **and record Uzaib's actual cut
  pieces per size** onto the PO ledger (`cut{}`).
- `js/pos.js` `renderRegistry()`: add an **"In Production" tab that mirrors the
  Issue Registry** data (+ overview + tags).
- **Acceptance:** Uzaib issues fabric + enters cut/size; anchor `cut` shows on
  the PO and both registries.

### Phase 3 — Faizan packing receipt (batches) + bars
- `js/production.js` (new): `renderPacking()` — Faizan's view; **search POs by
  number**, per-size **batch entry** (`{size,qty,ts,by}` → `packingReceipts[]`),
  recompute `received`. Reusable **completion-bar** component
  (cut / received / yet-to-receive).
- `js/shared.js` `buildNav()` (line 608): add a **packing** nav branch (mirror
  the `fulfillment` special-case at line 610) + `renderPage()` (line 970) case
  `'packing'`.
- **Acceptance:** Faizan enters dated batches per size; bars update; PO can't
  close until `received==cut` for every size.

### Phase 4 — Haris QC disposition + conservation
- `js/production.js`: `renderQCDisposition()` — Haris; per received batch, split
  **passed / rafu / washing / alteration / bstock**, enforce
  `sum == received`; write `qcDispositions[]`; rework resolution →
  `toBarcode | toBstock`. Passed → feeds Faizan Ready-to-Barcode; bstock →
  carton inventory.
- Nav/route for Haris (he already has nav via printing items; add a QC tab).
- **Acceptance:** conservation enforced; passed & bstock flow correctly.

### Phase 5 — B-stock carton inventory (+ later transfer)
- `js/production.js`: `bstock_items` collection; **carton assignment**
  (PO·product·size·article·carton); manager-viewable page/tab; a **B-stock
  transfer/pickup** track mirroring §4.7.
- **Acceptance:** every bstock piece carries its identity + carton; managers
  view; can transfer later.

### Phase 6 — Faizan Ready-to-Barcode + Stock Transfer PDF
- `js/production.js`: Ready-to-Barcode sub-view — **scan ERP/SKU barcode**,
  build transfer, **book** → `stock_transfers` (+ `stockTransfers[]`).
- `js/print-engine.js`: new **`stock-transfer`** variant in the `_VARIANTS`
  registry (model on `_renderGatePass`) — PDF + **summary page**.
- **Acceptance:** booking prints a receipt PDF; `transferred` bar updates.

### Phase 7 — Umair notification + pickup + completion
- `js/production.js`: on booking, `_hrmNotify({forUser:'umair', ...})` (pattern
  at store.js:1562) — "ready to pick from Faizan".
- `js/fulfillment.js` / `buildNav` fulfillment branch (line 610): add Umair's
  **ready-to-pick** view + pickup action; PO → `complete` when every size
  `received==cut` and fully dispositioned & transferred.
- **Acceptance:** Umair notified; pickup; PO completes.

### Phase 8 — Manager tabbed PO Registry (mission-control polish)
- `js/pos.js` `renderRegistry()`: full **tab set by journey mile** (Reserved ·
  In Production · Packing · QC & Disposition · B-stock · Ready/Transfer · With
  Umair · Completed); per-PO cards with all live bars + tags.
- **Acceptance:** managers find any PO by its mile.

### Phase 9 — Rules publish
- `firestore.rules`: finalize + note the existing "rules not yet published"
  caveat (CLAUDE.md). Publish step is manual in Firebase Console.

### Cross-track / coordination notes
- **`index.html`** (add `js/production.js` script tag) and **`js/shared.js`**
  (`buildNav`, `renderPage`) are **cross-track files** — coordinate with Ammar
  before pushing (CLAUDE.md §Shared touchpoints).
- New nav/pages must be added to both desktop sidebar and mobile nav
  (`_renderMobNav`).
- Reuse existing infra: notifications (`_hrmNotify`), print-engine, barcode
  render (`_renderRollBarcode`), reserve/release (`fabPoReserveCommit`,
  `fabReleaseForPO`).

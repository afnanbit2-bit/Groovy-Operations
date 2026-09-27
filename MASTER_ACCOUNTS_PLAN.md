# Master Accounts — Master Plan v2 (a full ledger, first mile to last mile)

> Status: **PLANNING ONLY — nothing built.** Afnan, 27 Sept 2026: *"I want
> accounts but just for me and ammar, in short master accounts … plan all
> the logics of build first so we have a good foundation … plan the UI … our
> charts, pie chart, how the app will learn with the data."* Then, on v1:
> *"This should be a complete build … a proper end to end app which
> validates what you feed to it … making a vendor — fabric, washing,
> stitching — what is it for, what does he do, what does he provide, at what
> term and what rate; manage a proper credit/debit ledger with history, edit
> terms, assigning purchase orders. It's a first-to-last-mile logic. It has
> to be built right; you thought like baby accounts."*
>
> **v1 was a reporting layer over other people's entries. v2 is the system
> of record**: a general ledger with a chart of accounts, a party master
> (every vendor, customer, courier, employee, owner and bank), documents with
> a lifecycle (purchase order → receipt → bill → payment; sale → collection;
> payroll; journals), a validation engine that refuses or flags every
> document before it posts, per-party credit/debit ledgers with running
> balances and full history, costing per production PO, and the reports,
> charts and learning on top. Today's modules become entry surfaces onto it
> (§9), not sources it reads from a distance.
>
> Every decision is Claude's call, tabled to be overruled **here** (§3, §15).
> Companion: the UI specimen https://claude.ai/artifact/9bmhjEuaZMisWLb2TiQNyZ
> (`scratchpad/master-accounts-specimen.html`), private until shared.
> `ACCOUNTS_PLAN.md` is Raees's Store Accounts and Umair's warehouse sales,
> both of which this plan absorbs in a named phase.

## 0. First mile to last mile, in one picture

```
 SETUP            chart of accounts · parties (vendor / customer / courier / employee / owner / bank)
                  · what each vendor provides (items and services) · terms · rate cards with history
                  · money accounts · tax settings · opening balances · period calendar
     │
 PROCUREMENT      purchase order to a vendor ──► receipt (fabric arrived, garments back from stitching
 (money out)      or washing, embellishment done, trims on the shelf) ──► vendor bill, matched to the
                  order and the receipt ──► payment, allocated to bills ──► vendor ledger
     │
 PRODUCTION       every production PO collects its cost: fabric issued at receipt rate, stitching and
 (cost)           washing bills per piece, embellishment, trims issued at rate ──► cost per piece
                  ──► finished goods at cost ──► cost of goods sold when a piece sells
     │
 SALES            Shopify orders · warehouse sales · fabric and garment sales at the gate ──► customer
 (money in)       and courier ledgers ──► collections and remittances ──► receivables aged
     │
 MONEY            cash drawer · banks · wallets · runner floats · owner capital and drawings · loans
                  ──► transfers · bank statement import · reconciliation
     │
 PEOPLE           payroll accrued and paid · advances and loans as employee ledgers
     │
 PERIOD           month close · locks · audit trail · exports
     │
 REPORTS          trial balance · P&L · balance sheet · cash flow · aging · statements · cost sheets
 CHARTS           HTML, validated palette, a table twin for every chart
 LEARNING         baselines · anomalies · forecasts · budgets · rate drift · margins · data quality
```

**Every arrow is a document, every document is validated before it posts,
and every posting is balanced.** That is the whole discipline. A vendor bill
that names no order is allowed but flagged; a bill for more pieces than came
back from the vendor is refused; a payment larger than what is owed is an
advance and says so; a rate off the vendor's card needs a reason; a date in a
closed month is refused. The ledger is never a place where "something went
in" — it is a place where something checked went in.

## 1. Verified findings this plan rests on (read from the code, 27 Sept 2026)

Each row was read with file:line references and the load-bearing ones
re-checked by grep in this session.

| Source | What exists today | What is missing (the gap v2 closes) | Where |
|---|---|---|---|
| **Store Accounts** `acct_entries`, `acct_vendors` | One ledger shape, nine types, integer rupees, local dates, `status posted/pending/void`, purchase `lines[]` with rates, FIFO aging, vendor terms `cash/credit/monthly/weekly`, a rate card derived from lines, `edits[]` history, month close checkpoints. Effects in one function `_acctEffect`. | Vendors are STORE vendors only (`goods/service/utility/consumable`); no purchase orders; no receipt matching; no allocation of a payment to a bill (FIFO only); the client loads only months after the last close (one request capped at 5,000); Reset deletes the ledger. | `js/store-accounts.js:71-82, 223-246, 257, 311-336, 1363, 2908` |
| **Gate passes and returns** | A pass carries `dest` (free-text vendor; chips for FebKnit, Al-Hamd, Al-Nisa, Aqib Sublimation, JR Traders, Rahim Gul Enterprise, Khursheed Enterprise), `gpReason process/return_vendor/sale/other`, sizes and units sent; `returns` record `sentQty, returnedQty, cumulative, shortage, status` per pass. | **No vendor record, no rate, no bill** for stitching, washing, dyeing or embroidery anywhere; the vendor is a string that can be typed differently each time. | `js/gatepass.js:98-106, 550-623, 664-666` |
| **Fabric in** `fabricin` | Supplier (free text), type, gsm, colour, rolls, kg or metres, QC per roll. | **No rate, cost, invoice or purchase order.** | `js/fabric.js:794` |
| **Production** `pos.*`, `bstock_*`, `stock_transfers` | Pieces by PO, article and size at every mile (cut → received → QC → barcode-ready → transferred → B-stock). | **No money anywhere**; no cost per PO or per piece. | `js/production.js:155-180, 284-295, 636-664` |
| **Embellishment** `printing_billing`, `printing_jobs` | `netPayable = finalApprovedQty × ratePerPiece − materialCostImpact`, per-piece rate master for 183 article codes. | A payable with **no payee field** (join to the job's `vendorName/assignedTo`); in-house work billed the same way; SLA withholds never saved; more than one billing doc per job possible; no paid state. | `js/embellishments.js:59-152, 3368-3400, 3716` |
| **Warehouse sales** `wh_sales` | One doc per ERP order, lines snapshotted with price, 20% discount cap held by the rules, pay-later with due date, collection fields, Raees's confirmation as a `cash_in` with `src:'wh'`. | A sale is one document but not one ledger: collection, confirmation and the sale live in two collections. | `js/warehouse-sales.js:309-385, 412-420`; `js/store-accounts.js:1464-1478` |
| **Shopify** `shopify_orders`, `shopify_line_items` | Order total, status at first sync, line SKU/qty/price, discount codes. | **Written once, never updated** (refunds invisible); no gateway, no COD-vs-prepaid, no payouts. | `netlify/functions/shopify-order-sync.js:87-88, 111-175` |
| **PostEx** `postex_orders` | Per parcel COD, fees and tax, reversal fees, `upfrontPayment(+Date)`, `reservePayment`, CPR numbers and `settle`. | The only remittance data in the app and nothing posts it; the COD tab and the CPR tab compute "net" differently. | `netlify/lib/postex-core.js:92-121, 251-259`; `js/fulfillment.js:902-919, 961-986` |
| **Payroll** `payroll_runs`, `payslips`, `advance_requests`, `loans`, `employees` | Run totals, per-slip net, deductions for advances and loans, mark-paid per month or per person. | **Nothing records how a salary was paid**; loans never updated after creation; UTC-day dates; mark-all-paid decrements already-paid slips again. | `js/hrm.js:1908-1963, 1958, 1983-2027, 2810` |
| **Marketing** `paid_pr_requests` | Approved amount (frozen at decision), one set of payment fields. | No partial payment; the discount given on a code is not stored. | `js/marketing.js:2476-2537` |
| **Store** `store_items`, `store_transactions`, `trim_templates` | Quantities; a `rate` only on rows posted by a Store Accounts purchase; a planned `pricePerUnit` per trim on a template. | Trims can be valued only partially. | `js/store.js:506, 532, 1074-1078` |

Two facts about the app's shape: **no owner-only READ exists in
`firestore.rules` today** (every owner-gated collection still reads
`signedIn()` or `isOM()`); and **the chart guard covers `js/marketing.js`
only** — the app's one line chart is the scaled-SVG-text pattern Marketing
rejected.

**What v1 got wrong, stated so it is not repeated:** it treated the ledger as
a view. A view cannot refuse a bad bill, cannot hold a vendor's terms, cannot
allocate a payment, and cannot cost a PO. Those are the job.

## 2. Principles

| Principle | Meaning here |
|---|---|
| **The ledger validates what it is fed** | Every document passes `maValidate(doc, context)` before it posts; the outcome is `refuse` (with the rule named), `flag` (posts, marked for review) or `ok`. §6 is the rule table. |
| **A document has a lifecycle, a posting does not** | Draft → posted → (partly) settled → void. A void keeps the document, struck through, with who/when/why. Editing a posted document is an owner action that appends `edits[]` and re-posts under the same key. |
| **One party master** | A vendor, customer, courier, employee, owner or bank is ONE record with a kind, what it provides, terms, a rate card and a ledger. A vendor typed as a string anywhere (gate-pass `dest`, `fabricin.supplier`) is a defect the migration ends. |
| **Balances derived, never stored** | A party's balance, an account's balance and a PO's cost are computed from postings; closes store checkpoints; rollups are a rebuildable cache. |
| **Double entry underneath, plain words on top** | Every posting balances; the UI says money in, money out, owed to us, we owe. The trial balance is a test invariant and a nightly check. |
| **Nothing typed twice** | A gate pass that sends 400 pieces to Al-Hamd IS the work-order dispatch; the return IS the receipt; the bill is matched to it, not retyped. |
| **Warn, never block — except where the books would lie** | A refusal is reserved for a document that cannot be true (more returned than sent, a bill for a closed month, an allocation over the outstanding). Everything else flags. |
| **One decision, one function** | `maPost`, `maValidate`, `maAllocate`, `maCost`, `maAging`, `maBaseline` exist once, in `js/ma-core.js`, shared by the browser, the nightly function and the tests. |
| **Reads are bounded; failures are named** | The client reads the party master, open documents, the live window and rollups; a source that could not be read is an alert, never a zero. |
| **By username, mirrored by email** | `_MA_USERS=['afnan','ammar']` and `isMasterAccounts()`; a test holds them equal. |
| **Every learned number carries its basis** | `basis:{method, window, n}` on every insight. |

## 3. Decisions taken (overrule here)

| # | Question | Decision | Why | Overrule by |
|---|---|---|---|---|
| 1 | Who | Afnan and Ammar by username, `ma_*` owner-only to read and write; Raees and Umair keep their entry surfaces, which post into the ledger under their own rules (§9). | The books are the most sensitive data in the app. | editing both lists and the test |
| 2 | System of record | **The master ledger is the record; every module posts into it.** Store Accounts and warehouse sales are absorbed in a named phase (M7) with their data migrated, not read from a distance. | A second ledger beside the first is two truths. | keeping Store Accounts as a separate book and importing it |
| 3 | Party master | One `ma_parties` collection for every kind; a vendor declares **what it provides** as a list of item and service kinds, each with a unit; the gate-pass destination and the fabric supplier become party picks. | "What is it for, what does he provide, at what term and what rate." | — |
| 4 | Rate cards | Per party, per item or service: rate, unit, valid-from, minimum, negotiated by, note; **history kept, never overwritten**; the current rate is the newest valid one. A document using another rate needs a reason and is flagged. | Rates move; a bill checked against last month's rate is how overbilling hides. | — |
| 5 | Terms | Per party: `cash`, `credit N days` (limit optional), `monthly` (bill day), `weekly` (bill weekdays), plus **advance allowed**, **retention %** for stitching (held back until QC), pay days. **Editing terms keeps history** (`termsHistory[]`) and applies from the edit date; older bills keep the terms they were raised under. | "Edit terms" was asked for by name; a bill's due date must not move because a term changed later. | — |
| 6 | Purchase orders | `ma_po`: a document to a vendor for goods (fabric kg/m, trims) or services (stitching, washing, dyeing, embroidery, printing, sublimation per piece), with lines (item/service, article when per-piece, qty, unit, rate from the card, expected date), optionally **assigned to production POs** (`pos` ids). States draft → sent → partly received → received → closed/cancelled. A receipt or a bill can reference it; a bill without one is allowed and flagged. | "Assigning purchase orders." | requiring a PO for every bill |
| 7 | Receipts | Goods: a fabric-in (`fabricin`) gains `poRef`, `rate` and `invoiceRef` and becomes the receipt; a store receive likewise. Services: **the vendor return on a gate pass IS the receipt** (pieces back, shortage recorded); embellishment QC approval is the receipt for external printers. | The app already records what came back; it just never priced it. | — |
| 8 | Bills | `ma_bill`: vendor, date, due date (from terms), lines, amount, tax, attachments, `poRef`, `receiptRefs[]`, `matchStatus` (three-way: ordered · received · billed, with variances by qty and rate), `invoiceNo` **unique per vendor**. Posts cost/inventory ↔ payable. | The three-way match is what "validates what you feed it" means for money out. | two-way (PO · bill) |
| 9 | Payments | `ma_payment`: from an account (cash, bank, wallet, owner "other"), to a party, **allocated** to bills (owner picks, default FIFO), partial allowed, an unallocated remainder is an advance on the party's ledger; **retention** released by a separate payment when QC clears. | A payment that does not say which bills it settles cannot age anything. | FIFO only |
| 10 | Sales | Warehouse sales become `ma_invoice` (customer party, lines, discount, terms) with `ma_receipt` collections; Shopify orders become invoices per order with the courier as the receivable party on delivery; a gate sale is an invoice + receipt in one. | Customers and couriers need ledgers as much as vendors do. | — |
| 11 | Costing | **Standard-then-actual per production PO**: fabric issued × receipt rate, service bills per piece, trims issued × rate, an optional overhead % (setting); cost per piece = PO cost ÷ pieces transferred; finished goods at cost; COGS when a SKU sells (Shopify line → article → the latest PO cost for that article, FIFO across POs). Where a rate is missing the cost sheet **says which leg is missing**, never zero. | Margin by article is the question the business runs on; it needs every leg priced. | average cost instead of FIFO |
| 12 | Store Accounts and warehouse sales | **Absorbed in M7**: `acct_vendors` → parties, `acct_entries` → bills/payments/receipts/journals with the same ids kept as `legacyId`, Raees's forms re-pointed at `ma_*` with his rules carried over (own entries, edit with history, review by owners); `wh_sales` → invoices. Until M7 they keep posting into the ledger through adapters. | One vendor master and one ledger, without stopping Raees or Umair for a day. | keeping them separate for good |
| 13 | Payroll | `payroll_runs` accrue salaries (expense ↔ payable); a **payroll payment document** in the master pays them from an account; HRM gains `paidVia` on the slip (Afnan's file, one field). Advances and loans are employee-ledger entries with schedules. | Payroll's how-paid gap is a master-side document, not an HRM guess. | — |
| 14 | Couriers | A courier is a party with a rate card (fee, tax, reversal) and a ledger: COD receivable on delivery, fees as cost, remittances as receipts matched to CPRs and to the bank line. | PostEx is a debtor that also charges; both belong on one ledger. | — |
| 15 | Owners | Capital and drawings accounts per owner; a vendor "paid from Other" settles against the owner's capital with the note as the record; an owner's personal spend on company money is a drawing. | The "Other" flow already exists and had nowhere to land. | — |
| 16 | Chart of accounts | Seeded (§4.1), typed, codes never reused, names editable, sub-accounts allowed under a parent; Store Accounts categories map to accounts with learned suggestions; unmapped lands in suspense and counts against data quality. | — | — |
| 17 | Periods and locks | Calendar months, fiscal year from 1 July (setting); a month close locks every document dated in it (refused, not flagged), snapshots balances, requires bank reconciliation to the month end or an acknowledged exception; reopen by an owner with a reason. | "Built right" means a closed month stays closed. | — |
| 18 | History everywhere | Every master record (party, terms, rate card, account) and every document keeps `history[]` / `edits[]` with who, when, what changed and why; the audit page lists them all. | Asked for by name. | — |
| 19 | Derivation runs twice from one file | `js/ma-core.js` in the browser (live window) and in the nightly rollup (history), and in the tests. | Posting and validation rules must exist once. | — |
| 20 | Charts and learning | As v1 (§10, §11): HTML charts with a validated `--chart-*` palette and a table twin; deterministic statistics with a stated basis; owner feedback the only memory; **margins and cost variance join the learning once M6 prices the legs**. | — | — |
| 21 | Not built, named | Multi-currency; tax filing; bank API feeds; an accountant role; AI Q&A; consolidation; forecasting beyond 90 days; a vendor portal. | Each is a phase. | — |

## 4. Master data

### 4.1 `ma_accounts/{code}` — the chart of accounts (seeded, editable, typed)

`{code, name, type (asset|liability|equity|revenue|cogs|expense|suspense),
kind, parent?, owner?, active, order, history[]}`. Assets: 1010 Cash drawer ·
1020 MCB · 1030… other banks and wallets · 1040 Warehouse till (Umair) ·
1050 Runner floats · 1110 Receivable — customers · 1120 Receivable —
couriers (COD) · 1140 Receivable — employees · 1150 Vendor advances · 1210
Inventory — fabric · 1220 Inventory — trims · 1230 Work in progress (open
production POs) · 1240 Finished goods · 1310 Fixed assets. Liabilities: 2010
Payable — vendors · 2020 Retention held · 2040 Payable — salaries · 2050
Payable — runners · 2060 Payable — creators · 2070 Customer deposits · 2110
Loans · 2120 Tax payable. Equity: 3010/3011 Capital per owner · 3020/3021
Drawings per owner · 3090 Retained result. Revenue: 4010 Online · 4020
Warehouse · 4030 Fabric & garment sales · 4040 Discounts given · 4050
Refunds & returns · 4090 Other income. Cost of goods: 5010 Fabric · 5020
Stitching · 5030 Embellishment · 5040 Trims · 5050 Washing & dyeing · 5060
Courier · 5070 Returns & reversals · 5080 Packaging · 5090 Cost variance.
Expenses: 6010 Salaries · 6020 Marketing & PR · 6030 Utilities · 6040 Rent ·
6050 Maintenance · 6060 Fuel & transport · 6070 Office · 6080 Bank charges ·
6090 Depreciation · 6100 Other. Suspense: 9010 Unclassified in · 9020
Unclassified out · 9030 Reconciliation differences.

### 4.2 `ma_parties/{id}` — one record per vendor, customer, courier, employee, owner, bank

```
{ kind: vendor|customer|courier|employee|owner|bank,
  name, code (short, unique), active,
  vendor: {
    roles: [fabric_mill|stitching|washing|dyeing|embroidery|printing|sublimation|trims|packaging|
            service|utility|consumable|transport|other],
    provides: [{itemKind, unit, note}],        // fabric kg/m; garments pcs per article; trims by code; kWh…
    terms: {mode:cash|credit|monthly|weekly, creditDays, creditLimit, billDay, billWeekdays[],
            advanceAllowed, retentionPct, payDays[], from},
    termsHistory: [{...terms, from, to, by, at, reason}],
    rateCard: [{id, itemKind, article?, unit, rate, min?, validFrom, validTo?, by, at, note}],
    tax: {ntn?, withholdingPct?}, bank: {title, iban?}, contact: {person, phone, address},
    meter?: {type:count|weighed, unit, rate}          // the consumable vendors, unchanged
  },
  customer: {terms:{mode, creditDays, creditLimit}, phone, address},
  courier:  {rateCard:[{kind:delivery|reversal|tax, rate|pct, validFrom}], remitCycleDays},
  employee: {employeeId (HRM), schedules:[{kind:advance|loan, monthly, from, balance}]},
  owner:    {username}, bank: {accountCode},
  openingBalance, openingDate, notes, createdAt/By, updatedAt/By, history[] }
```

The vendor's page (specimen: *Vendors*) shows what he provides, the current
terms with the button to edit them (history below), the rate card with the
history of every rate, open purchase orders, the credit/debit ledger with a
running balance, the statement by date range, aging, and every attachment.

### 4.3 `ma_items/{key}` — items and services

`{key, kind (fabric|trim|garment_service|embellishment|packaging|consumable|
utility|other), name, unit, article? (for per-piece services), storeCode?
(links a trim to `store_items`), active}`. Fabric keys follow the inventory
key `type__gsm__colour`; services are `stitch:<article>`, `wash:<article>`,
`emb:<article>:<process>`.

### 4.4 `ma_settings/main`

`{fiscalYearStart, goLive, categoryMap, budgets, bankRules, overheadPct,
matchTolerance:{qtyPct, ratePct}, refuseAbove:{...}, flagAbove:{...},
learning:{...}, payDays}` — every threshold the validation engine reads is
here and shown on the settings page.

## 5. Documents and their lifecycle

| Document | Collection | Made from | States | Posts |
|---|---|---|---|---|
| Purchase order | `ma_po` | the form; a production PO's needs (fabric per `fabrics[]`, stitching per size); a reorder from a rate card | draft → sent → partly received → received → closed · cancelled | nothing (a commitment; shown as "on order") |
| Receipt | `ma_receipt` | fabric-in (`fabricin` + rate) · vendor return on a gate pass (`returns`) · embellishment QC approval · store receive | posted · void | goods: inventory ↔ accrued payable; services: WIP of the linked production PO ↔ accrued payable |
| Vendor bill | `ma_bill` | the form (invoice photo/PDF required above a threshold); a metered vendor's month; Store Accounts purchase (until M7) | draft → posted → partly paid → paid · void | accrued payable ↔ vendor payable (matched), or cost/inventory ↔ payable (unmatched, flagged) |
| Vendor payment | `ma_payment` | the form; a pay-day run | posted · void | vendor payable (allocations) ↔ cash/bank/owner; unallocated → vendor advance |
| Retention release | `ma_payment` kind `retention` | QC cleared | posted · void | retention held ↔ cash/bank |
| Customer invoice | `ma_invoice` | warehouse sale · Shopify order · gate sale | posted → partly collected → collected · void | receivable (customer or courier) ↔ revenue (net of discount) |
| Customer receipt | `ma_receipt_in` | collection · Raees's confirmation · courier remittance (CPR) · Shopify payout | posted · void | cash/bank/till ↔ receivable |
| Payroll accrual | from `payroll_runs` | HRM processing | mirrors HRM | salaries ↔ payable; deductions ↔ employee receivable |
| Payroll payment | `ma_payment` kind `payroll` | the form | posted · void | salaries payable ↔ cash/bank |
| Employee advance / loan | `ma_journal` kind | HRM approval + the account it left | posted | employee receivable ↔ cash/bank |
| Float out / in / settle | `ma_journal` kinds | Raees's forms (M7) | posted · void | floats ↔ cash; runner payable |
| Journal | `ma_journal` | the form: bank charge, capital, drawing, loan, asset, tax, opening, reclass | posted · void | its lines |
| Month close | `ma_closes` | the checklist | closed · reopened | nothing; locks |

Every document carries `{no (per-type running number), date, month, party,
account?, amount, lines[], refs{po,receipts,invoiceNo,gpId,fabId,jobId,
legacyId}, attachments[], status, flags[], validated:{at,rules[]},
by,byName,ts, voidedAt/By/Reason, edits[]}`. Numbers are minted in the same
transaction as the document (the Pattern Hub lesson: a number spent on a
refused write is a defect).

## 6. The validation engine — `maValidate(doc, ctx)`

`ctx` holds the party, its terms and rate card, the referenced PO and
receipts, the period calendar, the settings and the party's current
balance. The result is a list of `{rule, level: refuse|flag|ok, message,
field}`; one `refuse` stops the write; `flag`s post and mark the document
for the owners' review queue. **Every rule is a test.**

| Rule | Level | Applies to |
|---|---|---|
| Party exists, is active, and is of the right kind for the document | refuse | all |
| Date is a real local day, not in the future, not in a closed month | refuse | all |
| Amount = Σ lines, whole rupees, > 0 (adjustments signed) | refuse | all |
| A line's item is on the vendor's `provides` list | flag ("Al-Hamd is not listed as providing washing") | PO, bill |
| A line's rate equals the current card rate for that item (± `ratePct` tolerance) | flag with the card rate shown; **refuse if no reason is given** when the difference exceeds the tolerance | PO, bill |
| A rate with no card entry at all | flag ("no rate card for this item — add it?") | PO, bill |
| Receipt qty ≤ ordered qty × (1 + `qtyPct`) on the referenced PO line | refuse | receipt |
| Returned pieces ≤ pieces sent on the gate pass (the app's own `shortage` rule) | refuse | service receipt |
| Bill qty ≤ received qty on the referenced receipts | refuse | bill |
| Bill rate vs PO rate (three-way match); variance by qty and by rate shown | flag; refuse above `refuseAbove.matchVariance` | bill |
| `invoiceNo` unique per vendor | refuse | bill |
| Invoice attachment present above `flagAbove.noInvoice` | flag; refuse above `refuseAbove.noInvoice` | bill, payment |
| A bill in a closed month, or dated before go-live | refuse | bill |
| Payment allocation ≤ each bill's outstanding; Σ allocations ≤ payment; remainder becomes an advance only if the terms allow advances | refuse | payment |
| Payment exceeds the vendor's balance with advances not allowed | refuse | payment |
| Credit limit exceeded after this bill | flag ("Nishat: ₨8.4 lac of a ₨7.5 lac limit") | bill |
| Retention: a stitching bill posts `retentionPct` to Retention held; the release needs the QC disposition of the linked PO to show no open rework | refuse release otherwise | payment |
| Duplicate document (same vendor, amount, date, invoiceNo within 7 days) | flag | bill, payment |
| A payment from an account with insufficient balance (cash drawer, floats) | flag (drawer) — cash cannot go negative, so refuse when the account kind is `cash` | payment |
| Customer invoice discount ≤ the cap (warehouse 20%) | refuse | invoice |
| Pay-later invoice for a customer over their credit limit | flag | invoice |
| Collection ≤ outstanding on the invoice | refuse | receipt in |
| Courier remittance matches the CPR's net within tolerance | flag with the difference | receipt in |
| Journal balanced; suspense lines named as such | refuse if unbalanced | journal |
| Edit of a posted document: reason required, `edits[]` grows by one, no change of party or type | refuse otherwise | all |
| Void: reason required; a document with allocations against it cannot be voided until they are unallocated | refuse | bill, invoice |

The engine never silently changes a value. Where it can help, it offers the
value (the card rate, the outstanding amount, the due date from terms) and
records that the person accepted it.

## 7. The ledger — postings and party sub-ledgers

Postings are balanced pairs keyed by `(document kind, id, version)`; a void
or an edit re-emits under the same key and the rollup replaces. The v1 table
of source-record postings survives as the **adapter set** for records that
are not yet master documents (Shopify orders, PostEx parcels, payroll runs,
Paid PR, embellishment billing, and Store Accounts until M7): it lives in
`js/ma-core.js` beside the document postings and follows the same rules.

**Party ledger** (the credit/debit view Afnan asked for): every posting that
touches a party's control account is a row on that party's ledger: date ·
document · debit · credit · running balance · state (matched, flagged,
partly paid, overdue) · attachment; a statement by date range; aging from
open items with FIFO where the payment did not allocate. Balances are never
stored; a close checkpoints them.

**Allocation** (`maAllocate`): a payment's allocations are the record; the
ledger's open items are bills minus allocations; an unallocated remainder is
an advance that the next bill offers to consume.

## 8. Costing — the production PO cost sheet

`maCost(po)` reads the production PO's fabric issues (× the receipt rate of
the rolls issued, FIFO by roll), the service receipts and bills linked to it
(stitching, washing, embellishment, per piece), the trims issued (× the rated
row's rate) and the overhead % setting, and returns `{legs:{fabric,
stitching, washing, embellishment, trims, overhead}, pieces:{cut, received,
passed, transferred, bstock}, perPiece, missing:[legs with no rate]}`. WIP
carries the cost while the PO is open; on transfer to the warehouse the cost
moves to finished goods per article; a Shopify or warehouse sale of that
article posts COGS at the latest completed PO's cost (FIFO across POs).
B-stock is valued at the same cost and written down on the owners' decision.
The cost sheet is a page and a print-engine variant; **a missing leg is
printed as missing, never as zero.**

## 9. How today's modules become entry surfaces

| Today | Phase | Becomes |
|---|---|---|
| Store Accounts (`acct_vendors`, `acct_entries`) | until M7: adapters read it; **M7: migrated** | vendors → parties; purchases → bills (+ receipts for stock lines); payments, cash-ins, floats, settlements, adjustments → their documents; closes → checkpoints; Raees's forms post into `ma_*` under rules that keep his own-entry edit right and the owners' review |
| Warehouse sales (`wh_sales`) | M4 adapters; M7 migrated | invoices and receipts; Umair's form unchanged on the surface |
| Gate pass to a vendor (`dest`) | M2 | `dest` becomes a party pick (chips from the party master); the pass is the work-order dispatch; the return is the receipt |
| Fabric in (`fabricin`) | M2 | gains `poRef`, `rate`, `invoiceRef`; the supplier is a party |
| Store receive | M2 | gains `rate` and `poRef` |
| Embellishment billing | M4 adapter | external printers' approved bills become `ma_bill` with the job as the receipt; in-house stays informational |
| Payroll | M5 | accrual adapter + payroll payment document; `paidVia` proposed on the slip |
| Shopify / PostEx | M4 | invoices per order; courier ledger; remittances as receipts matched to CPRs |
| Production (`pos.*`) | M6 | units for costing; no change to the screens |

`js/shared.js` gains the nav entries and one `renderPage` line;
`js/gatepass.js` and `js/fabric.js` gain party picks and rate fields
(cross-track, coordinated); `js/store-accounts.js` is re-pointed in M7.

## 10. The UI — pages `ma-*`

| Page | What is on it |
|---|---|
| `ma-overview` | cash & bank (hero), in/out this month, owed to us, we owe, runway; the alert strip (pay day, flags awaiting review, unmatched bank lines, source failures); cash in/out by week; balance and the 30-day projection; where the money went (donut ≤ 6); revenue by channel; biggest vendors; aging both ways |
| `ma-ledger` | every posting, one line shape, filters by document kind, party and account; a line opens its document |
| `ma-parties` | vendors · customers · couriers · employees · owners · banks; search; balances; flags |
| `ma-party` | the party page: what it provides · terms (edit, with history) · rate card (edit, with history) · open POs · the credit/debit ledger with running balance · statement by range · aging · attachments · history |
| `ma-purchasing` | purchase orders (draft/sent/received), receipts, bills with their match status, the review queue of flagged documents; + Purchase order · + Bill · + Receipt |
| `ma-payments` | the pay-day list (due by pay day from terms), pay runs, allocations, retention releases, advances |
| `ma-sales` | invoices by channel, collections, courier remittances against CPRs, pay-later reminders |
| `ma-money` | one page per money account: statement, running balance, bank import, reconciliation queue, transfers, floats |
| `ma-costing` | production PO cost sheets, cost per piece by article, margin by article and channel, missing legs |
| `ma-people` | payroll accruals and payments, employee ledgers (advances, loans) |
| `ma-pnl`, `ma-balance`, `ma-cashflow`, `ma-aging`, `ma-reports` | the statements, exports (Excel, PDF through the print engine) |
| `ma-budgets`, `ma-insights` | the learning layer |
| `ma-close` | the checklist, close, reopen, the audit trail |
| `ma-settings` | chart of accounts, items, tolerances and thresholds, category map, fiscal year, go-live, source toggles |

The specimen shows Overview, Ledger, P&L, Insights, and now **Vendors** (a
vendor page) and **Purchasing** (orders, receipts, bills with match status and
the validation flags). Charts follow v1 §8: HTML/CSS, the validated
`--chart-*` palette (light on `#fff`, dark on `#17171A`; worst adjacent
colour-blind ΔE 9.1/8.4, normal 19.6/19.3), a table twin, one filter row.

## 11. Learning — what the app learns once every leg is priced

As v1: baselines (median/MAD, 6 months; seasonality once 24 months exist),
anomalies (3·MAD and a minimum amount, explained by their lines), cash
forecast 30/60/90 from the due calendar and expected inflows with a band,
runway, budget suggestions the owner accepts, collection and courier
behaviour, category-mapping suggestions, data quality. New with v2:
**vendor rate drift against the rate card and against other vendors for the
same service**, **cost variance per PO** (actual per-piece vs the previous
PO of the same article; which leg moved), **margin by article and channel**,
**vendor reliability** (shortage rate on returns, days late vs expected
date, bill-vs-receipt variance rate), and **which validation flags recur by
vendor** (the vendor whose bills never match is a finding, not a nuisance).
Every card carries its basis; feedback (`expected` / `investigate`) is the
only stored memory; nothing is written by the layer on its own.

## 12. Rules and server functions

- `isMasterAccounts()` = afnan@groovy.op, ammar@groovy.op. `ma_parties`,
  `ma_items`, `ma_accounts`, `ma_settings`, `ma_feedback`: owner read/write.
  Documents (`ma_po`, `ma_receipt`, `ma_bill`, `ma_payment`, `ma_invoice`,
  `ma_receipt_in`, `ma_journal`): owner create; **entry roles create their own
  kinds under their own rules after M7** (Raees: bills, payments, cash-ins,
  floats, own edits with history; Umair: invoices, collections); update
  limited by `hasOnly` to state transitions, allocations and `edits[]` growth
  naming the changed fields; delete never. `ma_daily`/`ma_month`: server
  only. `ma_closes`: append, reopen by owners. Every block run in the
  emulator before the paste.
- `ma-rollup` scheduled 03:45 UTC after PostEx payments and the Marketing
  rollup; `ma-rollup-now-background` on demand behind an ID-token check;
  both require `js/ma-core.js`. Proposals to their owners: the Shopify sync
  refreshes 14 days of orders (Ammar); HRM records `paidVia` (Afnan).

## 13. Milestones — each shippable and reviewable alone

| M | Ships | Cross-track |
|---|---|---|
| **M0** | this plan, the specimen, §15 answered | — |
| **M1 Foundation** | chart of accounts, party master with terms/rate cards/history, items, `js/ma-core.js` (postings, validation, allocation, balances, trial balance), journals, `ma-overview` (live), `ma-ledger`, `ma-parties`/`ma-party`, `ma-settings`, rules, dashboard widget | `index.html`, `sw.js`, `shared.js` (nav + one line), `css/main.css` tokens + `.ma-` block, rules republish |
| **M2 Procurement** | `ma-purchasing`: purchase orders (assignable to production POs), receipts from fabric-in and vendor returns, bills with three-way match, the review queue; `ma-payments` with allocation, pay-day runs, retention | `js/gatepass.js` (party pick), `js/fabric.js` (party pick, rate, poRef), `js/store.js` (rate on receive) |
| **M3 Money** | banks and wallets, statement import, reconciliation, transfers, floats, owner capital and drawings, loans, `ma-money`, `ma-balance` | — |
| **M4 Sales & couriers** | invoices from warehouse sales, Shopify and gate sales; courier ledger from PostEx; remittances vs CPRs; `ma-sales`, `ma-aging`; nightly rollup + `ma-pnl` charts | `netlify.toml`; proposal to Ammar |
| **M5 People** | payroll accrual + payment documents, employee ledgers | proposal on `paidVia` |
| **M6 Costing** | `ma-costing`, WIP and finished goods at cost, COGS on sale, margin by article | — |
| **M7 Absorb Store Accounts and warehouse sales** | migration (idempotent by `legacyId`), forms re-pointed, rules carried over, the Reset retired | `js/store-accounts.js`, `js/warehouse-sales.js` |
| **M8 Reports & exports** | `ma-cashflow`, `ma-reports`, Excel, print-engine variants (statement, cost sheet) | `js/print-engine.js` |
| **M9 Learning** | `ma-insights`, `ma-budgets`, all of §11 | bell for pay day and an unfunded day |
| **M10 Close & audit** | `ma-close`, locks, the audit trail | — |

Every milestone ends with the standing caveat: nobody can look at it in a
browser from a session; Afnan's first open is the visual test.

## 14. Tests

`tests/master-accounts.test.js`: every validation rule both ways (a document
that should be refused is; one that should flag posts with the flag; one
that is clean posts clean); every posting per document kind and state; the
trial-balance invariant on a seeded month; allocation (partial, FIFO
default, advance remainder, over-allocation refused); rate-card history
(the current rate is the newest valid one; an older bill keeps its rate);
terms history (a due date does not move when terms change later); the cost
sheet (a missing leg is reported, never zero; FIFO across POs); the party
ledger's running balance; the audience; the nav order. `tests/ma-rollup.test.js`
against an in-memory Firestore. `tests/rules-emulator-ma.js` for every
block, including that Raees's post-M7 rules cannot touch an owner's
document. `tests/invariants.test.js` gains the chart guard for
`js/master-accounts.js`, the purity of `js/ma-core.js`, and the tokens.
`tests/smoke-layout.js` fragments for every page at three widths and both
themes.

## 15. Open questions — with the default each takes until answered

The ten put to Afnan on 27 Sept, plus the party-model ones v2 raises:

1. Which bank accounts and wallets exist besides MCB (JazzCash, Easypaisa
   appear in Paid PR payments)? Default: MCB, two placeholders.
2. How online customers pay and how the money reaches you (PostEx COD only;
   prepaid; other couriers' COD)? Default: COD via PostEx; the rest by
   journal.
3. Who records and pays fabric mills, stitching, washing and embroidery
   bills today, and on what terms? Default: owners, through M2's documents.
4. Salaries: drawer, bank, both; by whom; may HRM record `paidVia`?
   Default: a payroll payment document per run.
5. In-house printing billing (Asghar): real money or a piece-rate record?
   Default: informational.
6. Owner capital and drawings per owner? Default: yes.
7. Go-live date and the balances on that day? Default: 1 October 2026.
8. Monthly close by either owner; dual control above a threshold; fiscal
   year from 1 July? Default: either owner, no dual control, 1 July.
9. Sales tax registration and withholding? Default: none in phase 1.
10. What the books must answer first, and alerts on the page only or also
    the bell? Default: pay-day funding and runway; bell for those two.
11. **Retention on stitching**: is a percentage held back until QC, and how
    much? Default: 0% (the mechanism ships, off).
12. **Match tolerance**: how far may a bill differ from the order before it
    is refused rather than flagged? Default: 2% by qty, 0% by rate with a
    reason.
13. **Purchase orders for services**: raised before the gate pass goes out,
    or is the gate pass itself the order? Default: the gate pass can create
    the PO with one tap; a formal PO first is optional.
14. **Should Raees see the vendor rate cards of production vendors** after
    M7, or only his store vendors? Default: only his.
15. Nav label, the Reset, Mustafa's access, the Shopify refresh, the
    overview layout: as v1 (defaults: "Master Accounts", retire the Reset at
    M7, no, proposed, the specimen).

## 16. What cannot be verified from a session

What the Console publishes; what Shopify's totals and PostEx's dates mean in
every case; the bank's CSV shape (send one statement before M3); anything
visual — the specimen was rendered in headless Chromium and looked at; the
live module needs Afnan's first open, as always.

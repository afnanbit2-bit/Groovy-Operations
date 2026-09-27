# Master Accounts — Master Plan (the owners' books: Afnan and Ammar)

> Status: **PLANNING ONLY — nothing built.** Afnan, 27 Sept 2026: *"I want
> accounts but just for me and ammar, in short master accounts. I want to
> plan all the logics of build first so we have a good foundation. I want to
> plan the UI of the accounts as well, our charts, pie chart, how the app
> will learn with the data — it has to be the grand scheme of things. We are
> just planning at this stage."* ("hour charts" in the message is read as
> "our charts"; if hourly charts were meant, say so — nothing below depends
> on it.)
>
> Every decision below is Claude's call, tabled so there is something
> concrete to overrule. Overrule it **here**, in §3 and §14, not in code
> review. `ACCOUNTS_PLAN.md` is Raees's Store Accounts and Umair's warehouse
> sales; `PERMISSIONS_PLAN.md` is *user* accounts. This document is the
> owners' consolidated books, which read both and replace neither.
>
> **The UI specimen** (every screen, desktop and phone, light and dark, with
> sample figures): https://claude.ai/artifact/9bmhjEuaZMisWLb2TiQNyZ — the
> file is `scratchpad/master-accounts-specimen.html`. It is private to the
> artifact's owner until shared; Ammar needs it shared to open it.

## 0. The system in one picture

```
 SOURCES (already recorded, by other people, in their own modules)
 ┌──────────────┬────────────┬───────────┬──────────┬──────────┬───────────┬──────────────┐
 │ Store        │ Warehouse  │ Shopify   │ PostEx   │ Payroll  │ Marketing │ Embellishment│
 │ Accounts     │ sales      │ orders    │ parcels  │ HRM      │ Paid PR   │ billing      │
 │ acct_entries │ wh_sales   │ shopify_* │ postex_* │ payslips │ paid_pr_* │ printing_bill│
 └──────┬───────┴─────┬──────┴─────┬─────┴────┬─────┴─────┬────┴─────┬─────┴──────┬───────┘
        │             │            │          │           │          │            │
        ▼             ▼            ▼          ▼           ▼          ▼            ▼
   FEED ADAPTERS — pure functions in js/ma-core.js: record → balanced postings, keyed
   by (source, id, version). The same file runs in the browser and in the nightly
   function, so a posting rule exists exactly once.
        │
        ├──────────────► MANUAL JOURNALS (ma_journal) — what no module records: bank
        │                movements, owner capital and drawings, mill and stitching bills,
        │                loans, assets, tax, opening balances. Void, never edit.
        ▼
   POSTINGS against ONE CHART OF ACCOUNTS (ma_accounts) — double entry underneath,
   plain words on top (money in / money out / owed to us / we owe).
        │
        ├── live window, in the browser: today, this month, the ledger drill-down
        └── history, materialised nightly: ma_daily/{day} and ma_month/{month}
                                    │
        ┌───────────────────────────┼─────────────────────────────┐
        ▼                           ▼                             ▼
   THE BOOKS                    THE CHARTS                    THE LEARNING
   trial balance · P&L ·        HTML/CSS, validated palette,  baselines · anomalies ·
   balance sheet · cash flow ·  a table twin for every one    forecasts · budgets ·
   aging · bank reconciliation                                rate drift · data quality
                                                              — every number with its basis
```

Three sentences that hold the whole plan:

1. **Nothing is typed twice.** A Store Accounts entry, a warehouse sale, a
   payslip, a Shopify order or a PostEx parcel is read from where it lives
   and shown as the posting it implies. Only a **journal** is the ledger's
   own record, and only for money no module records.
2. **Balances are derived, never stored.** A month close stores a checkpoint
   (the Store Accounts rule, kept), and the nightly rollups are a cache that
   can be rebuilt from the sources at any time.
3. **Every learned number says how it was worked out.** The app never guesses
   at the owners any more than a session is allowed to guess at Afnan.

## 1. Verified findings this plan rests on (read from the code, 27 Sept 2026)

Each row was read by an agent with file:line references and the load-bearing
ones were re-checked by grep in this session. "Gap" means the master module
must supply it by journal or live without it.

| Source | What it holds | What it lacks (the gap) | Where |
|---|---|---|---|
| **Store Accounts** `acct_entries` | One ledger shape, nine types (`purchase, payment, cash_in, transfer, float_out, float_in, runner_pay, adjust, opening`), whole-rupee integer `amount`, local `date`/`month`, `status posted/pending/void`, `lines[]` with rates, `category`, `vendorId`, `src:'wh'` confirmations, `saleRef` fabric sales, `edits[]` history. Effects are ONE function, `_acctEffect(e)`. | The client loads only months **after the last close** (range query, one request capped at **5,000**); floats and runner debt are not checkpointed; **Reset Store Accounts deletes `acct_entries`, `acct_meter_logs`, `acct_closes`** outright. | `js/store-accounts.js:223-246` (`_acctEffect`), `:257` (`_acctLive`), `:174-195` (loader), `:1363` (close doc), `:2908` (`_ACCT_RESET_COLS`) |
| **Warehouse sales** `wh_sales` | Id = ERP order number; `total = subtotal − discount` (20% cap, held by the rules); `terms paid/later`, `paidVia cash/bank`, `dueDate`; collection fields (`collectedVia/collectedDate`); `priorVoids[]`; Raees's confirmation is an ordinary `cash_in` with `src:'wh'`, dated the day he confirms. Loader capped at **1,000** newest. | The discount is stored (good); no cost; the confirmation's money is the SAME money as the sale, so a naive feed double-counts it (see §5). | `js/warehouse-sales.js:309-385` (`whsBuildSale`), `:412-420` (`whsMoneyIn`), `:1166-1178`; `js/store-accounts.js:1464-1478` (`_acctWhEntry`) |
| **Shopify** `shopify_orders`, `shopify_line_items` | Per order: `order_number, created_at` (ISO with the store's `+05:00`), `currency, total_price` (float), `financial_status, fulfillment_status, cancelled_at, discount_codes[]`. Per line: `sku, quantity, price, product_type`. | **An order is written once and never updated** (the sync skips ids it already has), so a refund or cancellation after the first 4-hour sync is invisible. No gateway, no COD-vs-prepaid, no subtotal/tax/shipping/discount amount, no refunds, **no payouts**. | `netlify/functions/shopify-order-sync.js:87-88, 111-126, 134-175` |
| **PostEx** `postex_orders` | Per parcel: `orderRefNumber` (= Shopify order number), `statusCategory pending/in_transit/delivered/returned/cancelled`, `cod`, `transactionFee/Tax`, `reversalFee/Tax`, `upfrontPayment(+Date)`, `reservePayment`, `balancePayment`, and after enrichment `settle, settlementDate, cprNumber_1/2`. Synced every 4 h over a 14-day window; payments enriched daily 03:00 UTC. | The only remittance data in the app, and nothing posts it anywhere; the COD tab and the CPR tab compute "net" differently (returns charged in one, zeroed in the other); a parcel outside the 14-day window keeps stale values; `balancePayment`/`invoiceDivision` meaning unclear; date strings' timezone unclear (the app slices `YYYY-MM-DD`). | `netlify/lib/postex-core.js:92-121, 251-259`; `js/fulfillment.js:902-919, 961-986` |
| **Payroll** `payroll_runs`, `payslips`, `employees`, `advance_requests`, `loans` | Run totals (`totalGrossSalary, totalDeductions, totalNetPayable`), per slip `netPayable`, `advanceDeduction`, `loanDeduction`, `status draft/paid`, `paidOn`; advances `amount`, `status pending/approved/rejected/paid`; loans `totalAmount, monthlyDeduction`. | **Nothing records HOW a salary was paid** — `paidVia:''` is created and never written for payslips; only an advance approval records a free-text method. `loans` docs are never updated after creation (recovery lives only on `employees.loanBalance`). `paidOn` is a UTC-day string. `markAllPaid` decrements balances again for slips already paid one by one. | `js/hrm.js:1908-1963, 1958, 1983-2027, 2109-2134, 2810, 2983-2989` |
| **Marketing** `paid_pr_requests`, `discount_codes` | `proposed_amount_pkr` (frozen at decision = the approved amount), `payment_status/method/reference/date`; codes carry `revenue_attributed_pkr` by month (a rollup over `shopify_orders`, not a separate revenue). | No paid-amount field (paid = full amount); no partial payments; the discount **given** is not stored (Shopify orders carry no discount amount). | `js/marketing.js:2476-2537`; `netlify/functions/marketing-code-rollup.js:32-52` |
| **Embellishment** `printing_billing`, `printing_jobs`, `sla_events` | `netPayable = finalApprovedQty × ratePerPiece − materialCostImpact`, `status ready/pending_qc/approved/disputed`, ISO UTC dates. | It is **money the company PAYS** (page says NET PAYABLE), but the doc carries **no payee** — join `printingJobId → printing_jobs.vendorName/assignedTo`; in-house (Asghar, also on payroll) is billed the same way; an approved SLA withhold changes only the in-memory copy; a job can get more than one billing doc; no paid state. | `js/embellishments.js:3368-3400, 3448, 3716` |
| **Fabric & gate passes** `fabricin`, `gatepasses`, `returns`, `fabric_inventory` | Fabric arrivals by supplier, kg/m, rolls; a gate pass with `gpReason:'sale'` carries `sale{customer, rate, amount, account}` and posts a `cash_in` (`category:'Fabric sale'`) — only when the issuer can write Store Accounts. | **No rate, cost or invoice on fabric arrivals**; **no stitching, washing or dyeing rate or bill anywhere**; deleting a sale gate pass does not void its `cash_in`; a garment sale is still categorised "Fabric sale". | `js/fabric.js:794`; `js/gatepass.js:550-623, 596-616, 1235` |
| **Store** `store_items`, `store_transactions`, `trim_templates` | Quantities; a `rate` **only on rows posted by a Store Accounts purchase**; a planned `pricePerUnit` on trim templates. | Receipts through the Store's own form and all opening balances carry no rate, so trims can be valued at cost only partially. | `js/store.js:506, 532, 1074-1078`; `js/store-accounts.js:1853-1858` |
| **Production** `pos.packingReceipts/qcDispositions/stockTransfers`, `bstock_*`, `stock_transfers` | Pieces by PO, article and size at every mile: cut → received → QC → barcode-ready → transferred; B-stock cartons. | **No money anywhere in production**; `stock_transfers` is written and never read; no per-unit cost exists in the app (no CMT, no fabric cost, no target cost). | `js/production.js:155-180, 284-295, 636-664`; `js/pos.js:776` |
| **Daily Performance** `fulfillment_reports` | Per day, per courier: shipments and an `amount` for dispatches and returns, typed by hand from Umair's report. | The meaning of `amount` is not stated (COD? order value?). | `js/fulfillment.js:11-21, 1369-1379` |

Two facts about the app's shape, also verified:

- **No owner-only READ exists anywhere in `firestore.rules` today.** Every
  owner-gated collection still reads `signedIn()` or `isOM()`. The master
  books would be the first, and they should be: the consolidated books are
  the most sensitive data in the app.
- **The "no SVG text in charts" invariant covers `js/marketing.js` only**,
  and the only line chart in the app (`_fulfillLineChart`) is the
  scaled-SVG-text pattern Marketing rejected. There is no donut, pie or HTML
  line chart to reuse; the specimen's are the first.

## 2. Principles the codebase already holds, applied here

| Principle | Where it comes from | What it means for Master Accounts |
|---|---|---|
| Effects derived, balances never stored | `_acctEffect`, `whsHandovers`, frame membership | Postings are a function of the source record; rollups are a cache with a Rebuild button |
| One decision, one function | `_acctEffect`, `_acctEditBlock`, `_boardsFaceOf` | `maPost(record)` per source; `maBalances`, `maAging`, `maBaseline` each exist once in `js/ma-core.js`, shared by browser, server and tests |
| Void, never edit; history when an owner must edit | Store Accounts, warehouse sales | Journals void with who/when/why; an owner's edit appends `edits[]` |
| Warn, never block | recipe gate, pattern warning, review queue | Anomalies, missing bills and unreconciled lines are flags on a page, not refused writes |
| A failed read and an empty collection never look the same | the Store 429 lesson | Every source feed reports "could not be read" as a named alert; a zero is never silently painted |
| Reads are bounded | the Store read-quota outage | The client reads rollups and the live window only; Shopify and PostEx are never read whole by the client |
| By username, mirrored by email | `_acctIsSuper` / `isAcctSuper()` | `_MA_USERS=['afnan','ammar']` and `isMasterAccounts()`, with a test holding them equal |
| Nothing on the first render waits on the network | the white-screen incident | `maRenderPage` paints from cache, then fills |
| Charts in HTML, tokens only, text never in a series colour | Marketing's chart rounds | A validated `--chart-*` palette; a table twin per chart; the Marketing invariant duplicated for `js/master-accounts.js` |
| Every learned number carries its basis | CLAUDE.md's ground rule | `basis:{method, window, n}` on every insight, printed in words on the card |

## 3. Decisions taken (overrule here)

| # | Question | Decision | Why | Overrule by |
|---|---|---|---|---|
| 1 | Who sees it | **Afnan and Ammar, by username** (`_MA_USERS`), mirrored as `isMasterAccounts()` by email; `ma_*` collections are **owner-only to READ** — the first such rule in the app. Managers see nothing, not even the nav item. A read-only accountant role is a later phase. | The consolidated books carry salaries, margins and bank balances; `signedIn()` reads would hand them to every worker with a login. | editing both lists together and the test that holds them equal |
| 2 | Double entry or a dashboard | **Double entry underneath, plain words on top.** Every posting is balanced; "the trial balance is zero" is a test invariant and a nightly check. The UI never says debit or credit: it says money in, money out, owed to us, we owe. | It is the only model from which P&L, balance sheet and cash flow all fall out consistently, and it makes "does this add up" a computable question. | a cash-basis-only dashboard (loses the balance sheet) |
| 3 | Feeds | **Derived adapters, not copies.** `maPost(sourceKind, record) → postings[]`, pure, idempotent by `(source, id, version)`. Nothing is written per source record. | A copy drifts the first time an entry is voided or edited (the warehouse-handover lesson, twice). | — |
| 4 | Where derivation runs | **Both, from one file.** `js/ma-core.js` runs in the browser (the live window) and in the nightly function (history), and is required by the tests. It carries no Firebase and no DOM. | A posting rule that exists twice will disagree by Christmas. Precedent: `scripts/board-seed-plan.js` is pure and shared by a function and the tests. | — |
| 5 | History | **Materialised nightly** into `ma_daily/{day}` and `ma_month/{month}` by `ma-rollup` (Admin SDK reads every source in full), with **Rebuild** on demand. The client reads ≤ 24 months + 90 days of rollups, never the raw Shopify or PostEx collections. | The Store Accounts client keeps only months after the last close; Shopify is thousands of docs; the read-quota outage is on record. | — |
| 6 | Journals | **`ma_journal`** is the ledger's own record, for what no module records: bank movements, PostEx remittances landing in the bank, owner capital and drawings, mill and stitching bills, loans, assets, tax, opening balances, reclassifications. Void, never edit; an owner's edit keeps `edits[]`. Attachments through Cloudinary like every bill in the app. | The P&L must be complete from the first month even where the operational modules are not, or it is a report nobody trusts. | — |
| 7 | Bank accounts | Chart-of-accounts entries of kind `bank`. **MCB in Store Accounts and MCB here are the same account**: its master balance = Raees's MCB effects + master journals against it. Other banks as Afnan names them (§14 Q1). Statement import (CSV) and reconciliation per account. | Raees records what passes through his hands; payouts, remittances and loan instalments do not. Reconciling the union against the real statement is what proves the books complete. | — |
| 8 | Revenue recognition | Shopify: on the order's day, `total_price`, net of cancellations and refunds the sync knows about; the COD receivable moves to PostEx on **delivery** and to the bank on the CPR/remittance. Warehouse: on the sale day; pay-later is a receivable until collected. Fabric and garment sales from a gate pass: on the day, from the `cash_in`. | It is what the records carry. Prepaid gateways are an open question (§14 Q2). | cash basis for online sales (recognise on remittance) |
| 9 | Cost recognition | Accrual where an invoice exists: a credit purchase is an expense (or inventory) when recorded, a payable until paid; payroll is an expense of the month it pays for, a payable until marked paid; Paid PR is an expense on approval; printing is an expense on billing approval. Cash-basis where nothing else exists (a runner's fuel). | Matches how Store Accounts already ages payables (FIFO on `creditDays`). | — |
| 10 | Trims and consumables | **Expensed on purchase in phase 1**; the balance sheet shows trims **at cost from rated rows only**, labelled as such. Perpetual costing is a later phase. | Only Store Accounts purchases carry a rate; the Store's own receipts and openings do not. A partial perpetual system reads as a wrong number, not a partial one. | — |
| 11 | Cost of goods sold | **Not per piece.** COGS on the P&L is what was bought in the period (fabric, stitching, embellishment, trims, courier). The page says so, beside the stock-at-cost figure. | No CMT rate, fabric cost or unit cost exists in the app (§1). Inventing one would be a guess. | building per-PO costing first (a module of its own) |
| 12 | Payroll disbursement | **A journal per payroll run** ("paid ₨X from MCB / ₨Y from the drawer"), until HRM records `paidVia` on payslips — a one-field proposal for `js/hrm.js` (§14 Q4). | Nothing in HRM says how salaries were paid. | — |
| 13 | Printing billing | **External** vendor billing is a payable when approved; **in-house** (Asghar) billing is informational, never a payable — he is on payroll (§14 Q5). | The doc has no payee; the join to `printing_jobs.assignedTo` decides. | — |
| 14 | Fabric mills, stitching, washing | **Vendor bills as journals** (vendor from `acct_vendors` or the journal's own list), until the fabric-in flow carries a rate and an invoice. The adapter for `fabricin.rate` is written now and dormant. | The biggest costs in a garment business are recorded nowhere (§1). | asking Raees to record mill bills in Store Accounts (works today, no code) |
| 15 | Chart of accounts | **Seeded, small, typed** (§4.1). Names and categories editable; types (`asset/liability/equity/revenue/cogs/expense`) fixed; a code is never reused. Store Accounts categories map to accounts through a table with learned suggestions; unmapped lands in `9020 Unclassified` and counts against data quality. | A free-form chart is how a P&L grows forty near-duplicate lines. | — |
| 16 | Periods | Calendar months, **fiscal year starting 1 July** (Pakistan's tax year) as a setting (§14 Q6). A master month close (`ma_closes`) freezes that month's rollup and snapshots balances; it never blocks Raees's close, and Raees's close never blocks it. | Two closes, two purposes: the drawer count is his; the books are theirs. | — |
| 17 | Learning | **Deterministic statistics over the rollups**, in `js/ma-core.js`, every output with `basis`; owner feedback ("expected", "investigate") is the one thing stored (`ma_feedback`) and it silences and labels. **No AI in scope**; a natural-language "ask the books" is named in §12 as later, server-side, aggregates only. | Testable, explainable, zero dependencies; the books never leave the project. | — |
| 18 | Charts | HTML/CSS bars and donuts, SVG **geometry** only for lines with every label in HTML; a validated series palette as tokens (§8); ≤ 6 donut segments; one filter row per screen; a table twin per chart; hover tooltips. | The Marketing rounds already proved scaled-SVG text wrong in both directions. | — |
| 19 | Nav | Sidebar item **"Master Accounts"** third, after The Board and Dashboard (both pinned by `tests/theboard.test.js`); in the phone More sheet second, after The Board; pages `ma-*` through **one `renderPage` line**; a dashboard widget in the two-half pattern. Store Accounts keeps its "Accounts" label inside the Store group (§14 Q10). | The `mkt-`/`pattern-`/`acct-`/`tb-` routing rule; the owner opens money daily. | — |
| 20 | Units and dates | Whole rupees (integers) in every posting; Shopify and PostEx floats rounded at the adapter. Dates are **local `YYYY-MM-DD`** days; UTC-day strings from HRM and ISO UTC from embellishments are converted at the adapter, never trusted. | Store Accounts' rule, and the `toISOString` bug class recorded three times in CLAUDE.md. | — |
| 21 | Reset Store Accounts | Once the master ledger is live, the Reset **requires a master-side confirmation** and the rollups keep history; drill-down to a deleted entry says "the source was reset on <date>". | Today it deletes the ledger the master feeds from. | retiring the Reset outright |
| 22 | Not built, named so nobody files them as missed | Multi-currency; tax filing; per-piece costing; bank API feeds; an accountant role; AI Q&A; per-invoice allocation beyond FIFO; consolidation across companies; forecasting beyond 90 days. | Each is a phase, not a variant. | — |

## 4. Data model

All `ma_*` collections: `read: if isMasterAccounts()`. Writers per block in §10.

### 4.1 `ma_accounts/{code}` — the chart of accounts (seeded, editable)

`{code, name, type (asset|liability|equity|revenue|cogs|expense|suspense), kind
(cash|bank|till|float|receivable|inventory|fixed|payable|loan|tax|capital|
drawings|sales|contra|cost|opex|suspense), owner? (for capital/drawings),
mirrors? ('acct:cash'|'acct:mcb'), active, order, createdAt, updatedAt}`

The seed (codes are stable identifiers; names are the owners' to change):

| Code | Name | Type · kind | Fed by |
|---|---|---|---|
| 1010 | Cash drawer (Raees) | asset · cash | `acct_entries` (`account:'cash'`) |
| 1020 | MCB current | asset · bank | `acct_entries` (`account:'mcb'`) + journals |
| 1030… | Other banks | asset · bank | journals, statement import (§14 Q1) |
| 1040 | Umair's till | asset · till | `wh_sales` money in hand, minus Raees's confirmations |
| 1050 | Runner floats | asset · float | `float_out/float_in` |
| 1110 | Receivable — warehouse customers | asset · receivable | pay-later `wh_sales` until collected |
| 1120 | Receivable — PostEx COD | asset · receivable | delivered parcels until the CPR |
| 1130 | Receivable — other couriers | asset · receivable | journals (Blue-Ex, TCS, Bykia have no data) |
| 1140 | Receivable — employees | asset · receivable | advances and loans, recovered by payslip deductions |
| 1150 | Receivable — Shopify prepaid | asset · receivable | journals until a gateway feed exists (§14 Q2) |
| 1210 | Inventory — fabric | asset · inventory | memo (quantities) until `fabricin` carries a rate |
| 1220 | Inventory — trims (rated) | asset · inventory | rated `store_transactions` rows only, labelled partial |
| 1230 | Inventory — finished goods | asset · inventory | memo units from production, unvalued |
| 1310 | Fixed assets | asset · fixed | journals |
| 2010 | Payable — vendors | liability · payable | credit purchases, payments, FIFO aging (Store Accounts' own rule) |
| 2020 | Payable — mills & stitching | liability · payable | vendor-bill journals |
| 2030 | Payable — printers | liability · payable | approved external `printing_billing` |
| 2040 | Payable — salaries | liability · payable | `payroll_runs` processed, cleared when paid |
| 2050 | Payable — runners | liability · payable | over-the-float debt (`_acctRunnerOwed` rule) |
| 2060 | Payable — creators (Paid PR) | liability · payable | approved, unpaid `paid_pr_requests` |
| 2070 | Customer deposits | liability | journals |
| 2110 | Bank loans | liability · loan | journals |
| 2120 | Tax payable | liability · tax | journals (§14 Q9) |
| 3010/3011 | Capital — Afnan / Ammar | equity · capital | journals |
| 3020/3021 | Drawings — Afnan / Ammar | equity · drawings | journals |
| 3090 | Retained result | equity | derived (never posted) |
| 4010 | Online sales (Shopify) | revenue · sales | orders |
| 4020 | Warehouse sales | revenue · sales | `wh_sales` |
| 4030 | Fabric & garment sales | revenue · sales | gate-pass sale `cash_in` |
| 4040 | Discounts given | revenue · contra | `wh_sales.discount` (Shopify's is not stored) |
| 4050 | Refunds & cancellations | revenue · contra | Shopify, as far as the sync sees them |
| 4090 | Other income | revenue | journals |
| 5010 | Fabric & mills | cogs · cost | journals now; `fabricin` later |
| 5020 | Stitching | cogs · cost | journals |
| 5030 | Embellishment | cogs · cost | `printing_billing` (external) |
| 5040 | Trims & consumables | cogs · cost | Store Accounts stock purchases |
| 5050 | Washing & dyeing | cogs · cost | journals |
| 5060 | Courier & delivery | cogs · cost | PostEx fees + tax on delivered parcels |
| 5070 | Returns & reversals | cogs · cost | PostEx reversal fees + tax |
| 5080 | Packaging | cogs · cost | Store Accounts category map |
| 6010 | Salaries & wages | expense · opex | payroll + Store Accounts "Wages" |
| 6020 | Marketing & PR | expense · opex | Paid PR |
| 6030 | Utilities | expense · opex | consumable bills, "Utilities" |
| 6040 | Rent | expense · opex | journals |
| 6050 | Maintenance & repairs | expense · opex | category map |
| 6060 | Fuel & transport | expense · opex | category map, runner floats |
| 6070 | Office & stationery | expense · opex | category map |
| 6080 | Bank charges | expense · opex | statement lines |
| 6090 | Depreciation | expense · opex | journals |
| 6100 | Other expenses | expense · opex | "Other" |
| 9010 | Unclassified money in | suspense | owner `cash_in` with no category, unmatched bank credits |
| 9020 | Unclassified money out | suspense | unmapped categories, unmatched bank debits |
| 9030 | Reconciliation differences | suspense | month-close variances that cannot be explained |

### 4.2 `ma_journal/{id}` — the ledger's own records

`{kind (bank|remittance|vendor_bill|vendor_pay|payroll_pay|capital|drawing|
loan|asset|tax|opening|reclass|other), date (local YYYY-MM-DD), month, ts,
amount (int), lines:[{account, dr, cr, memo}] (balanced), party (vendor id or
free text), bank (account code), ref, note, photo, status (posted|void),
voidedAt/By/Reason, edits:[{at,by,reason,fields,before,after}], by, byName}`

Every journal is a balanced set of lines; the form offers the plain-words
shapes (Money in from…, Paid … from …, Owner put in, Owner took out, Bill
from …) and writes the lines. `kind:'opening'` is dated the go-live day and is
the only journal allowed before it.

### 4.3 `ma_daily/{YYYY-MM-DD}` and `ma_month/{YYYY-MM}` — the rollups (server-written)

`{day|month, v (schema), computedAt, balanced (bool), acct:{[code]:{dr,cr}},
cat:{[account]:{[category]:amount}}, src:{[source]:{n,in,out,failed?}},
vend:{[vendorId]:{purchased,paid}}, chan:{online,warehouse,fabric,other},
courier:{cod,fees,reversals,released}, payroll:{gross,net}, quality:
{uncategorised,noPhoto,pendingHandover,unmatchedBank,unmappedCats}}`

A month doc is the sum of its days plus `closed:true` when `ma_closes` holds
it. A balance on any day = the opening journal + Σ `ma_daily` up to that day.
`balanced:false` on a day is shown on the overview, never hidden.

### 4.4 `ma_bank_lines/{bank}_{hash}` — imported statement lines

`{bank, date, amount (signed int), narration, ref, hash (of date+amount+
narration+running balance), matchedTo (posting key|journal id|null),
matchedAt/By, ignored (bool), importedAt/By}`

A line is matched to a posting by amount and date window (±3 days), then by
narration keywords the owner taught (`ma_settings.bankRules`). Unmatched lines
are the reconciliation queue; "Make a journal from this line" is one click.

### 4.5 `ma_closes/{YYYY-MM}`, `ma_settings/main`, `ma_feedback/{key}`

- `ma_closes`: `{month, closedAt/By, balances:{[code]:amount}, reconciledTo:
  {[bank]:date}, note}`. Append-only; delete (reopen) by the owners.
- `ma_settings/main`: `{fiscalYearStart (7), goLive (YYYY-MM-DD), categoryMap:
  {[acctCategory]:code}, budgets:{[YYYY-MM]:{[code]:amount}}, bankRules:[…],
  learning:{anomalySigma:3, minAmount:20000, baselineMonths:6}, sources:
  {shopify:true, postex:true, payroll:true, marketing:true, embellishment:
  true}}`
- `ma_feedback/{kind}_{key}`: `{kind (anomaly|mapping|forecast), key, verdict
  (expected|investigate|seasonal), note, by, at, until}`.

## 5. The posting rules — one row per record type (the logic of the build)

Plain words in the table; the adapter writes the two accounts. **Key** is the
idempotency key; a record voided or edited re-emits under the same key and the
rollup replaces it.

| Source record | Condition | Posting (money words) | Accounts | Date | Key |
|---|---|---|---|---|---|
| acct `purchase` | `source:'credit'` | Bought on credit: cost up, vendor payable up | Dr 5xxx/6xxx by category map (or 1220 for a rated stock line) / Cr 2010 | `date` | `acct:<id>:buy` |
| acct `purchase` | `source:'cash'|'mcb'` | Bought and paid: cost up, drawer/MCB down | Dr cost / Cr 1010 or 1020 | `date` | same |
| acct `purchase` | `source:'float'` | Bought from a runner's float: cost up, float down | Dr cost / Cr 1050 | `date` | same |
| acct `payment` | `account:'cash'|'mcb'` | Paid a vendor: payable down, drawer/MCB down | Dr 2010 / Cr 1010 or 1020 | `date` | `acct:<id>:pay` |
| acct `payment` | `account:'other'` | Settled outside the books: payable down, owner funds in | Dr 2010 / Cr 3010 (the owner who settled; note is required, so it names them) | `date` | same |
| acct `cash_in` | `src:'wh'` | **Raees received warehouse money**: drawer/MCB up, Umair's till down (**never revenue** — the sale already was) | Dr 1010/1020 / Cr 1040 | `date` (confirm day) | `acct:<id>:whin` |
| acct `cash_in` | `saleRef` or `category:'Fabric sale'` | Sold fabric or garments at the gate: drawer/MCB up, revenue up | Dr 1010/1020 / Cr 4030 | `date` | `acct:<id>:sale` |
| acct `cash_in` | manual, `status:'posted'` | Money put into the drawer/MCB by an owner: drawer up, **unclassified in** until the owner classifies (capital, loan, other income) | Dr 1010/1020 / Cr 9010 | `date` | `acct:<id>:in` |
| acct `cash_in` | `status:'pending'` | Nothing (not in the books until Raees confirms) — counted as "waiting" on the overview | — | — | — |
| acct `transfer` | | Drawer ↔ MCB | Dr to / Cr from | `date` | `acct:<id>:xfer` |
| acct `float_out` | | Float given: runner float up, drawer/MCB down | Dr 1050 / Cr 1010/1020 | `date` | `acct:<id>:fo` |
| acct `float_in` | | Change back: drawer/MCB up, float down | Dr 1010/1020 / Cr 1050 | `date` | `acct:<id>:fi` |
| acct `runner_pay` | | Settled with a runner: runner payable down, drawer/MCB down (or owner funds for `other`) | Dr 2050 / Cr 1010/1020/3010 | `date` | `acct:<id>:rp` |
| derived per float | `used+back > out` | Over the float: cost already posted; the excess is owed to the runner | Dr 1050 / Cr 2050 for the excess (so the float returns to zero) | day of the bill that overspent | `acct:float:<floatId>:over` |
| acct `adjust` | signed | Month-close count difference: drawer up/down, reconciliation differences | Dr/Cr 1010 / Cr/Dr 9030 | `date` | `acct:<id>:adj` |
| acct `opening` | vendor opening balance | Owed before the books: payable up, opening equity | Dr 3090 / Cr 2010 | `date` | `acct:<id>:open` |
| `wh_sales` active | any terms | Sold at the warehouse: revenue up, discount contra, and either Umair's till up (`paid`) or customer receivable up (`later`) | Dr 1040 or 1110 (total) + Dr 4040 (discount) / Cr 4020 (subtotal) | `date` | `wh:<order>#<v>:sale` |
| `wh_sales` collected | `collectedVia` set | Pay-later collected: till up, receivable down | Dr 1040 / Cr 1110 | `collectedDate` | `wh:<order>#<v>:coll` |
| `wh_sales` void | | Both postings withdrawn (the key re-emits empty); a confirmation that already exists stays (the owners' orphan rule) | — | — | same keys |
| `shopify_orders` | not cancelled, not refunded at sync | Sold online: COD receivable-in-transit is a **memo** until delivery; revenue on the order day. Posting: Dr 1120 (as "in flight", flagged) / Cr 4010 | `created_at` local day | `shop:<id>:order` |
| `shopify_orders` | `cancelled_at` or `financial_status` refunded/voided at sync | Withdrawn or reversed: Dr 4050 / Cr 1120 | order day | `shop:<id>:rev` |
| `postex_orders` | `statusCategory:'delivered'` | Delivered: the receivable is now PostEx's to remit; courier fee and tax are a cost | Dr 5060 (fee+tax) / Cr 1120 — the receivable's remainder is the net PostEx owes | `orderDeliveryDate` day | `px:<tracking>:del` |
| `postex_orders` | `statusCategory:'returned'` | Returned: revenue reversed, reversal fee a cost | Dr 4050 (cod) / Cr 1120 (cod); Dr 5070 (reversal fee+tax) / Cr 2010-PostEx or 1120 | return day | `px:<tracking>:ret` |
| `postex_orders` | `upfrontPayment` with `upfrontPaymentDate` | PostEx released money: **bank up, PostEx receivable down** — posted as a journal candidate, confirmed by the bank line | Dr 1020 / Cr 1120 | `upfrontPaymentDate` | `px:<tracking>:rel` |
| `payroll_runs` | `status` processed or paid | Salaries of the month: expense up, salaries payable up | Dr 6010 (`totalNetPayable` + deductions recovered) / Cr 2040 (net) + Cr 1140 (advance and loan deductions) | last day of `month` | `pay:<runId>:accrue` |
| `payslips` | `status:'paid'` | Salary paid: payable down, bank/drawer down **by the journal for that run** (§3 D12) | Dr 2040 / Cr 1020 or 1010 | `paidOn` → local day | `pay:<slipId>:paid` + `journal` |
| `advance_requests` | `status` approved or paid, owner-approved | Advance given: employee receivable up, drawer/bank down (`paidVia` when present, else unclassified out) | Dr 1140 / Cr 1010/1020/9020 | `approvedAt` day | `adv:<id>` |
| `loans` | created | Loan given: employee receivable up, unclassified out until the owner names the account | Dr 1140 / Cr 9020 | `approvedAt` day | `loan:<id>` |
| `paid_pr_requests` | `status:'approved'` | Paid PR committed: marketing expense up, creator payable up | Dr 6020 / Cr 2060 (`proposed_amount_pkr`) | `decided_at` day | `pr:<id>:ok` |
| `paid_pr_requests` | `payment_status:'paid'` | Creator paid: payable down, bank down (method → account) | Dr 2060 / Cr 1020 (or 1010 for Cash, 9020 for Other) | `payment_date` | `pr:<id>:paid` |
| `printing_billing` | `status:'approved'`, external vendor | Embellishment billed: cost up, printer payable up | Dr 5030 / Cr 2030 (`netPayable`) | `approvedAt` → local day | `emb:<id>:ok` |
| `printing_billing` | in-house | Memo only (shown as "in-house billing ₨X", never posted) | — | — | — |
| `ma_journal` | posted | As written | its lines | `date` | `jr:<id>` |

Rules the adapters hold, each a test:

- **Every posting balances**; the trial balance of any day is zero.
- **A `src:'wh'` cash_in never touches revenue**; the sale did.
- **A pending entry, a void entry and a void sale post nothing.**
- **An edited source record re-emits under the same key** (the rollup
  replaces, never appends).
- **A record dated before go-live posts nothing**; the opening journal
  carries those balances.
- **An unmapped category posts to 9020**, never to a guessed account, and
  raises a mapping suggestion.
- **Floats never go negative on the books**: the over-the-float excess moves
  to the runner payable on the day it happens, matching `_acctRunnerOwed`.
- **Amounts are integers**; Shopify and PostEx floats are rounded at the
  adapter, once.

## 6. The books — what each page computes

- **Trial balance**: Σ dr − Σ cr per account over a range; zero in total.
- **Balance sheet (a day)**: opening journal + Σ daily to that day; assets =
  liabilities + equity + result to date, checked and shown.
- **P&L (a range)**: revenue (4xxx net of 40x0 contras) − cost of goods (5xxx)
  = gross margin; − operating expenses (6xxx) = net result; a **budget**
  column from `ma_settings.budgets`; a **previous period** column.
- **Cash flow (a range)**: movements on cash/bank/till/float accounts,
  grouped by kind (from sales, to vendors, salaries, courier, owners, banks).
- **Aging**: receivables by customer (`wh_sales` pay-later, FIFO by
  collection), PostEx by CPR status, employees by loan schedule; payables by
  vendor (Store Accounts' FIFO reused, same `creditDays`), by printer, by
  creator, salaries by month. Buckets current / 1–30 / 31–60 / over 60.
- **Runway**: (cash + banks) ÷ median weekly net burn over 12 weeks, only when
  burn is positive; and the 30/60/90-day projection of §9.
- **Data quality**: §9, on the overview and the insights page.

## 7. The UI — pages `ma-*`, one `renderPage` line

The specimen shows Overview, Ledger, P&L and Insights at desktop and phone
width in both themes; the rest follow its chrome. Every page: a one-row filter
bar (date range first: This month · Last month · Quarter · Year · Custom),
tiles before charts, charts before tables, a table twin behind every chart,
Excel and PDF where a report is printed.

| Page | What is on it | Charts |
|---|---|---|
| `ma-overview` | Six tiles (Cash & bank as the hero with a 30-day sparkline · In this month · Out this month vs the 6-month median · Owed to us · We owe · Runway) · the alert strip (pay day, anomalies, waiting handovers, reconciliation state, source read failures) · the charts · biggest vendors · aging both ways | Cash in/out by week (grouped bars, 2 series) · Cash balance with the next 30 days (line + projection band) · Where the money went (donut ≤ 6) · Revenue by channel (stacked columns, 3 series) · Aging (ordinal bars) |
| `ma-ledger` | Every posting, newest first, one line shape: date · source chip · what · account · in · out · balance · state (auto, journal, void, edited, to reconcile); filters by source and account; a line opens its source record; + Journal entry | — |
| `ma-pnl` | The statement (revenue by channel, cost of goods, gross margin, operating expenses by account, net) with previous-period and budget columns; drill into an account for the month | Revenue vs expenses, 12 months (2 lines, one axis) · Net result by month (diverging bars) |
| `ma-balance` | Assets, liabilities, equity on a chosen day; stock at cost labelled partial; the check line | Composition bars (assets · liabilities) |
| `ma-cashflow` | Movements by kind for the range; the 30/60/90 calendar of what is due and expected | Waterfall as HTML columns (opening → kinds → closing) |
| `ma-aging` | Receivables and payables, by party, bucketed; the pay-day list (Wednesday, Saturday, from `acct_settings.payDays`); collection reminders | Bucket bars (ordinal ramp) per side |
| `ma-accounts` | One page per money account: statement, running balance, reconciliation queue (imported lines, matched/unmatched), import CSV, opening balance | Balance line for the account |
| `ma-budgets` | Per account per month: suggested (learned) · accepted · actual · variance; Accept all / Edit | Actual vs budget bars per account |
| `ma-insights` | §9, each card with its basis and its feedback buttons; the data-quality meter with the list behind it | Small multiples where a trend explains a flag |
| `ma-close` | Month-end checklist (bank reconciled to, Raees's close, warehouse handovers confirmed, unclassified cleared), Close, the audit trail of journals, voids, edits and overrides; Reopen | — |
| `ma-settings` | Chart of accounts editor, category map, fiscal year, go-live, source toggles, learning thresholds, bank rules | — |

Phone: two-column tiles, charts stacked, the ledger as a horizontally
scrolling table inside its wrapper, filters wrapping — measured in the
specimen at 390 px. The dashboard widget (owners only): cash & bank, due
today, the alert count, one line each, click-through.

## 8. Charts — the rules and the palette

- **Built like Marketing's**: pure `maChart*` builders returning HTML, in
  `js/master-accounts.js`; the "no `<svg>`, no `viewBox`, no `<text>`"
  invariant duplicated for that file; a line chart is an SVG `<path>` with
  `vector-effect:non-scaling-stroke` and **every label in HTML**.
- **The app's own tokens fail as series colours** — validated with the
  dataviz six checks on the app's surfaces: `--sw-*`/`--cat-*` fail chroma
  and colour-blind separation in both themes (the palette is monochrome by
  design). So charts get their own tokens, added to `:root` and the dark
  block of `css/main.css` (an additive change to a cross-track file):

  | Token | Light (on `#fff`) | Dark (on `#17171A`) |
  |---|---|---|
  | `--chart-1` | `#2a78d6` | `#3987e5` |
  | `--chart-2` | `#eb6834` | `#d95926` |
  | `--chart-3` | `#1baf7a` | `#199e70` |
  | `--chart-4` | `#eda100` | `#c98500` |
  | `--chart-5` | `#e87ba4` | `#d55181` |
  | `--chart-6` | `#4a3aa7` | `#9085e9` |
  | `--chart-other` | `#898781` | `#898781` |
  | `--chart-neg` | `#e34948` | `#e66767` |
  | `--seq-1…4` (ordinal ramp) | `#86b6ef #3987e5 #1c5cab #0d366b` | `#184f95 #2a78d6 #5598e7 #9ec5f4` |

  Measured: worst adjacent colour-blind ΔE 9.1 light / 8.4 dark (≥ 8
  target), normal-vision 19.6 / 19.3 (≥ 15 floor); the first three slots
  pass all-pairs (for a donut). Three light slots sit under 3:1 on white
  (`--chart-3/4/5`), so every chart carries visible values or its legend
  with figures — the relief rule, already the specimen's shape.
- **Status colours are the app's `--accent-*`**, always with an icon and a
  word, never as a series. Text never wears a series colour.
- Marks: bars ≤ 24 px with a 4 px rounded data end and a 2 px surface gap;
  lines 2 px; markers ≥ 8 px with a surface ring; gridlines solid hairlines;
  a legend for ≥ 2 series; direct labels only on the endpoint or the extreme;
  a tooltip on every mark and a crosshair on every line; tabular figures in
  columns only.
- **A donut only for a part-to-whole glance, ≤ 6 segments, "Other" folding
  the tail**; a ranking is bars; a single number is a tile.

## 9. The learning layer — what "the app learns with the data" means here

All in `js/ma-core.js`, pure, over `ma_month`/`ma_daily` plus the live
window. Every output is `{value, basis:{method, window, n, from, to},
explain:[…lines that contributed]}` and the card prints the basis in words.
Thresholds live in `ma_settings.learning` and are shown on the page.

| Capability | Input | Method | Output | What the owner can say back |
|---|---|---|---|---|
| **Baselines** | monthly totals per account, vendor and channel | median and MAD over the trailing 6 months (n ≥ 3); seasonality index by month of year **only once 24 months exist**, and the card says "no seasonality yet" before that | typical month per line, with the range | — |
| **Anomalies** | this month vs its baseline | flag when \|x − median\| > 3·MAD **and** > `minAmount`; the explanation lists the largest lines that make the difference | an alert with the lines behind it | **Expected** (silences this key, labels it; if the same key was expected in the same month last year it becomes *seasonal*) · **Investigate** (opens the lines) |
| **Vendor rate drift** | the rate card derived from purchase lines | latest rate vs the median of the last 5 purchases of that item from that vendor; compared with other vendors supplying the same item code | "Star Trims' thread +18%; Zain last supplied at ₨1,020" | Expected / Investigate |
| **Cash forecast (30/60/90)** | today's balances; the due calendar (vendor terms and pay days from `acct_settings`, payroll on the 1st, pay-later `dueDate`s, unpaid Paid PR, loan instalments); expected inflows (PostEx delivered-not-remitted × the median remit lag; pay-later × per-customer median collection days; Shopify 4-week median daily net × day-of-week factor) | a daily projected balance with a band = ±1 MAD of the residuals of the last 12 weeks' projections against what happened | the line's dashed half, the low point, and "nothing due is unfunded" or the day it is | — |
| **Runway** | cash + banks, 12 weeks of net burn | median weekly burn; only shown when burn > 0 | "11 weeks at the median burn" | — |
| **Budget suggestions** | 6 months per account | median, nudged by the last-3 vs prior-3 trend, capped ±20% | a suggested figure per account for next month | **Accept** (writes `budgets`) · **Edit** · ignore — **the app never sets a budget on its own** |
| **Collection behaviour** | pay-later `wh_sales` collection dates | per-customer median days to collect (n ≥ 3) | "Ahmed Traders averages 31 days; two accounts are slower" and a suggested reminder day | — |
| **Courier behaviour** | `postex_orders` | remit lag (delivery → `upfrontPaymentDate`), return rate and its cost, fee per parcel trend | "9-day cycle; returns cost ₨X this month" | — |
| **Category mapping** | a new Store Accounts category | keyword match against the map and the history of how similar names were mapped | a suggested account, applied only on Accept | Accept / pick another |
| **Data quality** | the sources | 100 − penalties: uncategorised %, bills missing above the threshold, handovers waiting > 2 days, unmatched bank lines, unmapped categories, source read failures | a score with the list behind it | each item opens the thing to fix |

What it must never do: write a budget or reclassify a posting on its own;
hide a source read failure behind a zero; send the books to a third party;
present a number without its basis.

## 10. `firestore.rules` — the blocks (a draft; publish with the milestone)

```
function isMasterAccounts() { return signedIn() && userEmail() in ['afnan@groovy.op','ammar@groovy.op']; }

match /ma_accounts/{code}   { allow read, write: if isMasterAccounts(); }
match /ma_settings/{doc}    { allow read, write: if isMasterAccounts(); }
match /ma_feedback/{doc}    { allow read, write: if isMasterAccounts(); }
match /ma_journal/{doc} {
  allow read:   if isMasterAccounts();
  allow create: if isMasterAccounts() && maJournalValid();          // balanced lines, int amount, YYYY-MM-DD, by == caller
  allow update: if isMasterAccounts() && (maVoid() || maOwnerEdit()); // void fields only; or edits[] grows by one naming the changed fields
  allow delete: if false;
}
match /ma_bank_lines/{doc} {
  allow read:   if isMasterAccounts();
  allow create: if isMasterAccounts();
  allow update: if isMasterAccounts() && affectedKeys().hasOnly(['matchedTo','matchedAt','matchedBy','ignored']);
  allow delete: if false;
}
match /ma_closes/{doc}      { allow read, create, delete: if isMasterAccounts(); allow update: if false; }
match /ma_daily/{doc}       { allow read: if isMasterAccounts(); allow write: if false; }   // server only
match /ma_month/{doc}       { allow read: if isMasterAccounts(); allow write: if false; }   // server only
```

`isMasterAccounts()` is the same pair as `isAcctSuper()` today and is kept
separate on purpose: one is the repair tools of Raees's ledger, the other is
the books; a test holds `_MA_USERS` equal to the rule's emails, and nothing
holds the two rules to each other. Every block is run in the emulator
(`tests/rules-emulator-ma.js`, the `tests/rules-emulator.js` shape) before
the paste. **No other module's rules change** in phase 1; the master reads
`acct_entries`, `wh_sales` (owners already may), `payslips`, `paid_pr_requests`
and `printing_billing` under the rules they have.

## 11. Server functions

- **`ma-rollup`** — scheduled **`45 3 * * *`** (08:45 PKT), after PostEx
  payments (03:00) and the Marketing rollup (01:30). Same shape as
  `marketing-code-rollup.js`: `getDb()` from `FIREBASE_SERVICE_ACCOUNT`, pure
  work exported for tests, writes in batches of 400, a run summary in
  `shopify_sync_meta/ma_rollup`. It requires `js/ma-core.js` (relative path,
  bundled by esbuild) so the posting rules are the browser's. Each run
  recomputes: every day of every month **not closed in `ma_closes`** (an
  open month is editable in Store Accounts and HRM), plus the trailing 45
  days, plus any day flagged by a Rebuild request; a closed month is
  recomputed only with `force`.
- **`ma-rollup-now-background`** — on demand, the `pattern-sync-now-background`
  pattern: verifies the caller's ID token against `MASTER_ACCOUNTS_EMAILS`
  (a test holds it equal to the rule), answers 202, the client polls
  `shopify_sync_meta/ma_rollup.last_run_at`. Rebuild-all takes a `from`
  day.
- **Unchanged but proposed to their owners**: `shopify-order-sync.js` should
  **refresh orders from the last 14 days** (merge `financial_status`,
  `cancelled_at`, `current_total_price`) instead of skipping ids it has —
  Ammar's function, one loop; without it refunds never reach the books.
  `js/hrm.js` should record `paidVia` on payslips when a month is marked
  paid — Afnan's file, one prompt. Both are named in §14.

## 12. Milestones — each shippable and reviewable alone

| M | Ships | Verified how | Cross-track touches |
|---|---|---|---|
| **M0** | This plan, the specimen, the answers to §14 | Afnan overrules in this file | — |
| **M1 Foundation** | `js/ma-core.js` (chart seed, adapters for `acct_entries` and `wh_sales`, journals, balances, trial balance); `js/master-accounts.js` (nav, `ma-overview` tiles and alerts from the live window, `ma-ledger`, `+ Journal entry`, `ma-settings` with the chart and category map); rules; the dashboard widget | `tests/master-accounts.test.js` drives every posting rule and the trial-balance invariant; emulator run; `smoke-layout` fragments for the overview and the ledger at 1900/1280/420 | `index.html` two script tags, `sw.js` two precache lines + bump, `js/shared.js`: one `mainItems` push, one `groups` line, one More-sheet entry, one `renderPage` line, `BUG_PAGE_NAMES`; `css/main.css` tokens + `.ma-` block; `firestore.rules` republish |
| **M2 History** | `ma-rollup` + `ma_daily`/`ma_month`; Rebuild; the four overview charts and the aging cards from rollups; `ma-pnl` with the 12-month charts | rollup idempotence and balance tests against an in-memory Firestore (the `marketing-codes.test.js` shape); chart builders under the duplicated no-SVG-text invariant | `netlify.toml` schedule |
| **M3 Revenue feeds** | Shopify and PostEx adapters in the rollup (COD receivable, fees, returns, releases as journal candidates); revenue by channel; the courier card | adapters tested on scripted orders and parcels; the two PostEx "net" definitions reconciled to one and stated | proposal to Ammar on the order refresh |
| **M4 Cost feeds** | Payroll, advances, loans, Paid PR, external printing billing; vendor-bill journals for mills and stitching; `ma-aging` | each adapter tested per status; the in-house/external split tested | proposal on `paidVia` |
| **M5 Banks** | `ma-accounts`: statement CSV import, matching, the reconciliation queue, opening balances, capital/drawings/loans/assets journals; `ma-balance` | matching tested on scripted statements; the balance-sheet check | — |
| **M6 Reports** | `ma-cashflow`, Excel workbooks (the `_acctXlsx` shape), PDF through a print-engine `accounts-statement` variant (the four-place registration) | print-engine variant test with the recording fake jsPDF | `js/print-engine.js` (four places) |
| **M7 Learning** | `ma-insights`, `ma-budgets`, baselines, anomalies, forecasts, rate drift, collection and courier behaviour, mapping suggestions, data quality, feedback | every statistic tested on synthetic series with known answers; the "never on its own" rules asserted | bell notifications only for pay day and an unfunded day (§14 Q15) |
| **M8 Close & audit** | `ma-close`, period locks, the audit trail, the Reset gate | emulator: a closed month refuses a journal; the gate tested | `js/store-accounts.js` Reset gate (one check) |

Every milestone ends with the standing caveat: **nobody can look at it in a
browser from a session** — the sandbox cannot sign in. Afnan's first open is
the visual test, the same as every module before it.

## 13. Tests

- `tests/master-accounts.test.js` — the adapters (every source type × every
  status, driven through `maPost`, never the helpers), the trial-balance
  invariant on a seeded month, journals (balanced, void, edit history), the
  category map and its suggestions, the learning statistics on synthetic
  series (a flat series raises nothing; a 4× month raises one anomaly naming
  its lines; a budget suggestion never writes), the audience (`_MA_USERS` ≡
  the rule's emails; a third owner is NOT on it), the nav (The Board still
  first, Dashboard second, Master Accounts third; the More sheet), the
  dashboard widget's two halves.
- `tests/ma-rollup.test.js` — the function against an in-memory Firestore:
  idempotent on a re-run, replaces a voided entry's day, skips a closed month
  unless forced, writes `balanced:false` rather than a wrong total, records
  its run.
- `tests/rules-emulator-ma.js` — every `ma_*` block, with the app's own
  writers; a manager cannot read `ma_daily`.
- `tests/invariants.test.js` gains: the `maChart*` builders emit no SVG text
  and their palette is all tokens; `js/ma-core.js` has no `document`, no
  `window` write and no Firebase call; the `--chart-*` tokens exist in both
  theme blocks.
- `tests/smoke-layout.js` fragments: overview (tiles, alerts, all five
  charts, the donut legend), ledger, P&L, insights, at all three widths and
  both themes — the contrast check is what holds the palette's relief rule.
- `tests/smoke-app-phone.js` `OWNER_PAGES` gains the `ma-*` ids.

## 14. Open questions — Afnan's, with the default each takes until answered

1. **Which bank accounts exist besides MCB** (name, purpose)? Default: MCB
   only, with placeholders for two more.
2. **How are online orders paid** — COD through PostEx only, or also prepaid
   (Payfast, Safepay, bank transfer)? Where do prepaid payouts land? Default:
   COD via PostEx; anything prepaid is a journal until a feed exists.
3. **Fabric mills, stitching, washing** — who records those bills today, and
   how are they paid? Default: owner journals in the master; Raees could
   record them in Store Accounts instead, with no code change.
4. **Salaries** — paid from the drawer, by bank transfer, or both; may HRM
   record `paidVia` when a month is marked paid? Default: one journal per
   payroll run.
5. **In-house printing** (Asghar) — is `printing_billing` for him a real
   payable, or a piece-rate record beside his salary? Default: informational.
6. **Fiscal year** — 1 July, or calendar? Default: 1 July.
7. **Go-live date for opening balances**? Default: 1 October 2026.
8. **Owner capital and drawings per owner**? Default: yes, one account each.
9. **Sales tax / withholding** tracked here? Default: no (a later phase).
10. **Nav label** — "Master Accounts" beside the Store group's "Accounts", or
    rename the Store one? Default: "Master Accounts".
11. **Reset Store Accounts** — gate it behind the master, or retire it?
    Default: gate.
12. **The overview's lead** — the six tiles and four charts of the specimen,
    or profit first? Default: the specimen.
13. **Should anyone else ever see any part** (Mustafa as Ecom manager)?
    Default: no.
14. **May the order sync refresh recent orders** (Ammar's function)?
    Default: proposed, not assumed.
15. **Notifications** — the bell for pay day and an unfunded day, or the page
    only? Default: bell for those two, page for everything else.

## 15. What cannot be verified from a session

- What the Console publishes (rules) — the human confirms every republish.
- What Shopify's `total_price` and PostEx's dates mean in every case — the
  first real month is the test; the plan reads them as the code does.
- Whether the bank's CSV export matches the import's expectations — Afnan
  sends one statement file before M5 is built.
- Anything visual: the specimen was rendered in headless Chromium at 1280 and
  390 px, light and dark, and looked at; the live module will need Afnan's
  first open, as always.

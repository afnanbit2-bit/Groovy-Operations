# Master Accounts — Master Plan v3 (cash first · terms are the key · the money speaks)

> Status: **PLANNING ONLY — nothing built.** Afnan, 27 Sept 2026: *"I want
> accounts but just for me and ammar, in short master accounts … plan all
> the logics of build first so we have a good foundation … plan the UI … our
> charts, pie chart, how the app will learn with the data."* On v1: *"you
> thought like baby accounts."* On v2, answering its questions: *"the build
> should be cash logic based, every rupee is precious … Terms are the key as
> we manage debt on our end so it's the most important logic … we are
> dealing with 20 million of cash a month … quarter to quarter, monthly is
> too soon … tax option inside the build … the money should speak to me
> visually."*
>
> **v3 folds in what Afnan told us about how the money actually moves** (§0a):
> 90% of it arrives as PostEx cash on Tuesdays and Fridays and is collected
> by hand; most dealings are cash, not bank; four couriers in four different
> states; Payfast money goes to the owners' savings, which need a book of
> their own; about ₨15 lac is borrowed from those savings and paid back
> slowly; Asghar's printing unit is neither a vendor nor an employee; every
> entry may or may not carry tax; the books close by the quarter. **v2's
> skeleton stands** — the party master, terms with history, rate cards,
> documents with a lifecycle, the validation engine, per-party ledgers,
> costing — and v3 puts the cash under it, the couriers in front of it, a
> Savings book beside it and the owners' loan between the two.
>
> Every decision is Claude's call, tabled to be overruled **here** (§3, §23).
> Companion: the UI specimen https://claude.ai/artifact/9bmhjEuaZMisWLb2TiQNyZ
> (`scratchpad/master-accounts-specimen.html`), private until shared.
> `ACCOUNTS_PLAN.md` is Raees's Store Accounts and Umair's warehouse sales,
> both absorbed here in a named milestone (M8).

## 0. First mile to last mile, in one picture

```
 MONEY IN         PostEx delivers COD ──► CPR issued Tue / Fri ──► collected IN CASH (a day later,
 (first mile)     or the same day) by a named holder ──► the drawer, a vendor, or MCB
                  TCS delivers ──► credited to the TCS account after 90 days ──► drawn out
                  Blue-Ex (legacy) ──► balances still owed, collected against a statement
                  Bykea ──► transferred to Raees ──► the drawer (manual until a feed exists)
                  Payfast (prepaid web orders) ──► paid out to the OWNERS' SAVINGS ──► the loan
                  Warehouse customers ──► Umair's till ──► Raees confirms ──► the drawer
     │
 CASH HOLDERS     every rupee has a holder: the drawer (Raees) · cash with Afnan · cash with
                  Ammar · MCB · the warehouse till · runner floats · the TCS account
                  ──► transfers between holders are documents the receiver confirms
     │
 TERMS            every vendor has terms — cash, credit N days, monthly, weekly — and pay days
 (the key)        Wed / Sat ──► the pay-day list is what the cash calendar is built to fund
     │
 PROCUREMENT      purchase order ──► receipt (fabric in, garments back on a gate pass, printing
 (money out)      approved) ──► bill matched three ways, with its tax ──► payment from a holder,
                  allocated to bills ──► the vendor's credit/debit ledger with history
     │
 PRODUCTION       every production PO collects its cost, leg by leg ──► cost per piece ──► COGS
     │
 PEOPLE           payroll (3–4 months imported from the Excel sheet) · advances · loans · Asghar's
                  unit as an affiliate with its own account from day one
     │
 SAVINGS          the owners' own book: Payfast payouts, spend by category, subscriptions per
 (second book)    owner, targets (the marriage, the car), assets and liabilities, net worth,
                  reconciliation with attachments · the loan to Groovy, two-sided
     │
 PERIOD           quarter close with locks (fiscal year from 1 July) · month close where needed
 REPORTS          trial balance · P&L · balance sheet · cash flow · aging · tax · statements
 THE MONEY SPEAKS every line of spend says fine / watch / concern, with a sentence and its basis;
                  a spend map and a 30-day cash calendar on the overview
 LEARNING         baselines · anomalies · the CPR rhythm · rate drift · margins · data quality
```

**Every arrow is a document, every document is validated before it posts,
every posting is balanced, and every rupee has a holder.** A CPR collected
twice is refused; a transfer that would take a holder below zero is
refused; a bill at a rate off the card needs a reason; a payment names
which bills it settles; a date in a closed quarter is refused. The ledger
is never a place where "something went in" — it is a place where something
checked went in.

## 0a. How the money moves today — as Afnan stated it (27 Sept 2026)

**Owner's account, not code-verified.** Nothing in the repo records any of
this (§1 says what the code holds instead). Each row says what the plan
does with the fact.

| # | What Afnan said | What the plan does with it | Where |
|---|---|---|---|
| 1 | *"Groovy gets paid mostly from PostEx, 90% of cash flow. The CPR generated in PostEx is the money we get every Tuesday and Friday, but I mostly collect it a day later, or the same day when needed urgently. Most dealings are in cash, not account-managed."* | Couriers are the **first mile of money in**, built before purchasing. A CPR is a document derived nightly from `postex_orders`; a **collection** records the cash physically received from it — by whom, when, how much against the CPR's net, with the receipt attached. Cash is modelled by **holder**: the drawer, cash with Afnan, cash with Ammar, MCB, the till, floats, the TCS account. Every payment names the holder it left. A 30-day cash calendar puts Tue/Fri inflows against Wed/Sat pay days. | §8, §4.1, §17 |
| 2 | *"Blue-Ex was our previous vendor; we don't use it, but there are balances that need to be collected, so it holds importance until dues are cleared. TCS payment gets credited to my TCS account after 90 days. Bykea payments are usually transferred to Raees; there is no module to connect currently — keep it in the plan, least priority."* | Four couriers, four terms on the courier party: PostEx `cpr` (Tue/Fri, collected in cash); TCS `account` (delivered → receivable → **the TCS account, an asset**, credited at 90 days → drawn to cash or MCB); Blue-Ex `legacy` (an opening receivable from their statement, aged, collected against, never dispatched to); Bykea `manual` (a statement typed in, collected **into the drawer and confirmed by Raees**, a feed later). | §8 |
| 3 | *"Ammar receives online payments from PAYFAST, an online gateway on the website; we use that money for personal saving. I want that money in a savings section of the accounts module: where the money sits, with clear attachment plus recon method, plus how that money is spent; a logic for how we manage our savings — expense calculation, save-for-a-target, recurring cost such as subscriptions for me and Ammar both. A build better than what I said. Ammar is currently funding the marriage and our new car, so it should have a calculation of assets and liabilities too."* | A **second book, the Savings book**, with the same two-person audience and its own chart of accounts: accounts (the Payfast payout account, each owner's bank, cash), inflows, spend by category, a **subscriptions register per owner** (next due, annualised cost, detected from history), **targets** (amount, saved so far, monthly need, ETA at the current pace, funded by whom), an **assets and liabilities register** with valuations → net worth per owner and joint, reconciliation with attachments. Payfast money is Groovy revenue first (a prepaid web order), a Payfast receivable, then a **payout that posts on both books** in one document. | §9, §10 |
| 4 | *"Nothing — all done on paper, no logic to it. The build should be cash-logic based; every rupee is precious. Terms are the key, as we manage debt on our end, so it's the most important logic."* (vendors, terms, who pays) | Terms live on the party with history and drive three things: the due date on every bill, the **pay-day list** (Wed/Sat) and the cash calendar's outflows. Credit limits, overdue and an unfunded pay day are the first three lines of the concern logic. Every payment is from a named holder and the holder cannot go below zero. | §4.2, §6, §17 |
| 5 | *"We have payroll records of the past 3–4 months on Excel: advances + loans + salary + deductions."* | A **payroll importer** reads that sheet in the browser (vendored SheetJS, the Marketing M7 pattern), previews, and writes accruals, payments and the employee ledgers' openings, idempotent by employee + month. | §14, M6 |
| 6 | *"Asghar is not an employee, he gets no salary. He is part of Groovy: he costs us less to print from him because we helped him build his own printing unit, but we consider it our own. He needs proper accounts from day one."* | A party kind **`affiliate`**: his approved printing bills become real payables at his rate card, his payments are real payments, what Groovy put into the unit is an **investment asset** with its own ledger, and his statement exists from the first entry. | §11 |
| 7 | *"We both manage the factory; if I don't have cash Ammar steps in. Groovy vs savings have a relationship: around 1.5 million is borrowed from savings when the business required it; it is paid back, at slow speed."* | **Cash with Afnan / cash with Ammar are company holders.** The ₨15 lac is a **loan from the owners' savings**: one document per draw or repayment posts a liability on Groovy's book and an asset on the Savings book; the outstanding shows on both overviews; a Payfast payout repays it first (default, tabled). | §4.1, §10 |
| 8 | *"It has to be something I build with logic, then a one-go print. Proper vendor management with entry logic set up from day one, so I can do it at my own pace and the build does not slow me down. Well calculated — 20 million of cash a month to be accounted for."* | **Entry at your own pace**: history can be entered back to 1 July 2026 until the owners close that quarter; a vendor is created inline from any form; a PO is optional; quick forms for the four daily documents; importers for payroll, Store Accounts and PostEx; refusals only for what cannot be true. Statements print in one go for any range. Whole rupees, bounded reads, rollups. | §14, §2 |
| 9 | *"Quarter to quarter; monthly is too soon. Three months is the closing period, but monthly closing where it is required."* | **Quarterly hard close** on a fiscal year from 1 July (Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun) with locks; **monthly soft close** on demand (a checkpoint and a warning on backdating, no lock) for payroll months and monthly-billed vendors. | §20 |
| 10 | *"Tax option inside the build: a lot of entries do have taxes, some don't."* | A **tax block on every document** — kind (sales, services, withholding, none), rate, amount, inclusive or exclusive — defaulted from the party and the item, confirmed by the person; "no tax" is a choice, never an absence. Tax accounts, a quarterly tax page. Rates are settings the accountant fills; the plan invents none. | §12 |
| 11 | *"It should communicate with me with money: how much is spent where, and should I be concerned spending this much here or not. The money should speak to me visually."* | **The concern logic** (§17): every line of spend — category, vendor, courier cost, salaries, subscriptions — carries a state (fine / watch / concern) from three tests (its own baseline, its budget, its terms) and a sentence in plain words with the basis. A **spend map** sized by rupees and tinted by state, the **cash calendar**, and "of every ₨100 in, where it went". | §17, §16 |

## 1. Verified findings this plan rests on (read from the code)

Each row was read with file:line references and the load-bearing ones
re-checked by grep in this session (27 Sept 2026).

| Source | What exists today | What is missing (the gap v3 closes) | Where |
|---|---|---|---|
| **PostEx** `postex_orders` | Per parcel COD, fees and tax, reversal fees, `upfrontPayment(+Date)`, `reservePayment`, **two CPR numbers per parcel — `cprNumber_1` is the upfront receipt, `cprNumber_2` the reserve receipt** — with `cpr1Date`/`cpr2Date`, `settle` and `settlementDate`. The CPR tab already groups parcels by `cprNumber_1||cprNumber_2` and dates a group `settlementDate||cpr1Date||cpr2Date`. | **Nothing records that the CPR's cash was collected, by whom, or when**; the COD tab and the CPR tab compute "net" differently; no courier ledger. | `netlify/lib/postex-core.js:112-114, 199-262`; `js/fulfillment.js:958-989` |
| **Other couriers** | Fixed courier rows for `BLUE-EX`, `TCS`, `BYKIA` (per brand) on the Daily Performance page, with a colour each. | No data feed, no statement, no receivable for any of the three; **Blue-Ex and TCS balances exist only in Afnan's head and their statements.** | `js/fulfillment.js:27-37, 249` |
| **Payfast** | **Zero occurrences of "payfast" in `js/`, `netlify/` or `index.html`.** | The gateway that pays the owners is invisible to the app. | grep, 27 Sept 2026 |
| **Shopify** `shopify_orders` | Order total, `financial_status` (at first sync), line SKU/qty/price, discount codes. **Written once, never updated.** | **No `gateway` field** (COD vs Payfast cannot be told apart), refunds after the first sync invisible, no payouts. | `netlify/functions/shopify-order-sync.js:87-88, 111-175, 139` |
| **Store Accounts** `acct_entries`, `acct_vendors` | One ledger shape, nine types, integer rupees, local dates, `posted/pending/void`, purchase `lines[]` with rates, FIFO aging, vendor terms `cash/credit/monthly/weekly`, a rate card derived from lines, `edits[]` history, month-close checkpoints, effects in one function `_acctEffect`. Two money accounts only: `cash` and `mcb`. | Store vendors only; no purchase orders, no receipt matching, no allocation of a payment to a bill; the client loads only months after the last close (capped at 5,000); Reset deletes the ledger. | `js/store-accounts.js:71-82, 223-246, 257, 311-336, 1363, 2908` |
| **Gate passes and returns** | `dest` free text (chips for FebKnit, Al-Hamd, Al-Nisa, Aqib Sublimation, JR Traders, Rahim Gul, Khursheed), `gpReason`, sizes and units sent; `returns` record `sentQty, returnedQty, cumulative, shortage`. | **No vendor record, no rate, no bill** for stitching, washing, dyeing or embroidery. | `js/gatepass.js:98-106, 550-623, 664-666` |
| **Fabric in** `fabricin` | Supplier (free text), type, gsm, colour, rolls, kg or metres, QC per roll. | **No rate, cost, invoice or purchase order.** | `js/fabric.js:794` |
| **Production** `pos.*`, `bstock_*`, `stock_transfers` | Pieces by PO, article and size at every mile. | **No money anywhere**; no cost per PO or per piece. | `js/production.js:155-180, 284-295, 636-664` |
| **Embellishment** `printing_billing`, `printing_jobs` | `netPayable = finalApprovedQty × ratePerPiece − materialCostImpact`; a per-piece rate master for 183 article codes. | A payable with **no payee field**; in-house work (Asghar's unit) billed the same way with nothing owed to anyone; no paid state. | `js/embellishments.js:59-152, 3368-3400, 3716` |
| **Warehouse sales** `wh_sales` | One doc per ERP order, lines snapshotted, the 20% cap in the rules, pay-later, collection fields, Raees's confirmation as a `cash_in` with `src:'wh'`. | The sale, its collection and its confirmation live in two collections. | `js/warehouse-sales.js:309-385, 412-420`; `js/store-accounts.js:1464-1478` |
| **Payroll** `payroll_runs`, `payslips`, `advance_requests`, `loans`, `employees` | Run totals, per-slip net, deductions for advances and loans, mark-paid per month or per person. | **Nothing records how a salary was paid**; loans never updated after creation; UTC-day dates; the last 3–4 months live in Excel, not here. | `js/hrm.js:1908-1963, 1958, 1983-2027, 2810` |
| **Marketing** `paid_pr_requests` | Approved amount (frozen at decision), one set of payment fields. | No partial payment; the discount given on a code is not stored. | `js/marketing.js:2476-2537` |
| **Store** `store_items`, `store_transactions`, `trim_templates` | Quantities; a `rate` only on rows posted by a Store Accounts purchase. | Trims can be valued only partially. | `js/store.js:506, 532, 1074-1078` |

Two facts about the app's shape: **no owner-only READ exists in
`firestore.rules` today** (every owner-gated collection still reads
`signedIn()` or `isOM()`); and **the chart guard covers `js/marketing.js`
only**.

## 2. Principles

| Principle | Meaning here |
|---|---|
| **Cash first: every rupee has a holder** | Money is never "in the company"; it is in the drawer, with Afnan, with Ammar, in MCB, in the till, out as a float, or at TCS. Every collection, payment and transfer names the holder, and a holder cannot go below zero. |
| **Terms are the key** | A vendor's terms drive the due date, the pay-day list and the calendar; editing them keeps history and never moves an existing bill's due date. |
| **The ledger validates what it is fed** | Every document passes `maValidate(doc, ctx)` before it posts: `refuse` (with the rule named), `flag` (posts, marked for review) or `ok`. §6 is the rule table. |
| **A document has a lifecycle, a posting does not** | Draft → posted → (partly) settled → void. A void keeps the document struck through with who/when/why; an edit appends `edits[]` and re-posts under the same key. |
| **One party master** | Vendor, customer, courier, employee, owner, bank, affiliate: ONE record with a kind, what it provides, terms, a rate card and a ledger. A vendor typed as a string anywhere is a defect the migration ends. |
| **Two books, one audience** | Groovy's book and the Savings book are separate ledgers with separate charts of accounts; the loan and the Payfast payout are the only documents that post on both, and each is ONE document. Nothing from Savings reaches Groovy's P&L. |
| **Balances derived, never stored** | Party, account, holder, target and loan balances are computed from postings; closes store checkpoints; rollups are a rebuildable cache. |
| **Double entry underneath, plain words on top** | Every posting balances; the UI says money in, money out, owed to us, we owe, saved so far. The trial balance is a test invariant and a nightly check on both books. |
| **Nothing typed twice** | A gate pass to Al-Hamd IS the dispatch; the return IS the receipt; a PostEx CPR is derived, never typed; a payroll month is imported, not re-keyed. |
| **Entry at your own pace** | History back to 1 July 2026 stays enterable until the owners close that quarter; a vendor is made inline; a PO is optional; quick forms; importers. The engine refuses only what cannot be true. |
| **The money speaks** | Every line of spend carries a state and a sentence; the overview leads with the three that matter today. |
| **One decision, one function** | `maPost`, `maValidate`, `maAllocate`, `maCost`, `maAging`, `maCalendar`, `maConcern`, `maBaseline` exist once, in `js/ma-core.js`, shared by the browser, the nightly function and the tests. |
| **Reads are bounded; failures are named** | The client reads the master, the open quarter's documents and the rollups; a source that could not be read is an alert, never a zero. ₨20M a month is ~1,000 documents; the open quarter is paged. |
| **By username, mirrored by email** | `_MA_USERS=['afnan','ammar']` and `isMasterAccounts()`; a test holds them equal. |
| **Every learned number carries its basis** | `basis:{method, window, n}` on every insight and every concern. |

## 3. Decisions taken (overrule here)

| # | Question | Decision | Why | Overrule by |
|---|---|---|---|---|
| 1 | Who | Afnan and Ammar by username; `ma_*` owner-only to read and write. Raees and Umair keep their entry surfaces, which post into the ledger under their own rules after M8. | The books are the most sensitive data in the app. | editing both lists and the test |
| 2 | System of record | The master ledger is the record; every module posts into it. Store Accounts and warehouse sales are absorbed in M8 with their data migrated. | A second ledger beside the first is two truths. | keeping Store Accounts separate |
| 3 | **Cash holders** | Money accounts are **holders**: 1010 drawer (Raees), 1011 cash with Afnan, 1012 cash with Ammar, 1020 MCB, 1040 warehouse till (Umair), 1050 runner floats, 1060 TCS account. A payment, collection or transfer names one. A transfer between two people is **pending until the receiver confirms** (the warehouse handover pattern); pending never counts. | "Most dealings are in cash"; the cash in Afnan's pocket after a CPR is company money with a name on it. | merging 1011/1012 into one "owners' cash" |
| 4 | **Couriers first** | M2 builds the courier ledgers before purchasing: CPRs derived from `postex_orders`, collections with holder and attachment, COD in transit, TCS's 90-day account, Blue-Ex's legacy balance, Bykea by hand. | 90% of the cash arrives this way. | — |
| 5 | **A CPR is derived, a collection is typed** | `ma_cpr` is written nightly by the rollup from `postex_orders` grouped by CPR number (upfront and reserve are two CPRs); the owner types only the **collection**: which CPRs, the amount received, the holder, the date, the receipt. A difference from the CPR's net is shown and needs a reason. | The app already holds every parcel's CPR number; typing the CPR again would be the second truth. | typing CPRs by hand |
| 6 | **TCS** | Delivered parcels → 1122 Receivable — TCS; **90 days after delivery** (setting `tcsCreditDays`) the expected credit moves to **1060 TCS account**, an asset held at TCS, confirmed against TCS's own statement; withdrawals from it are transfers to cash or MCB. | "Credited to my TCS account after 90 days." | treating the TCS account as a receivable rather than money |
| 7 | **Blue-Ex** | A `legacy` courier party: an opening receivable from their last statement (attached), aged from that date, collections against it, nothing dispatched to it. Its open balance is on the overview until zero. | "Holds importance until dues cleared." | — |
| 8 | **Bykea** | A `manual` courier: a statement typed in as a CPR-shaped document (attachment), collected **into the drawer, pending Raees's confirmation**. A feed is a later milestone. | "Transferred to Raees; no module; least priority." | — |
| 9 | **Payfast** | Prepaid web orders are Groovy revenue (4011) and a **1125 Receivable — Payfast**; a payout is ONE document (`ma_payout`) that clears the receivable on Groovy's book and lands in the Savings book's Payfast payout account. On Groovy's side the payout is **loan repayment first** (2110), then drawings per owner. Payfast's fee is a line on the payout. | "That money is used for personal saving" — but it is sales revenue first, and taking it out is either repaying what savings lent or a drawing. | drawings first; a fixed split; a different receiving account |
| 10 | **The Savings book** | A second ledger (`ma_sv_*`) with its own chart (§4.5), accounts, inflows, spend by category, a subscriptions register per owner, targets, an assets-and-liabilities register with valuation history, net worth per owner and joint, reconciliation with attachments. One shared book; every entry tagged `afnan`, `ammar` or `joint`. | "A build better than what I said." | two separate books, one per owner |
| 11 | **The loan** | `ma_loan`: opening (~₨15 lac, split tabled), draws (savings → a Groovy holder) and repayments (a Groovy holder → a savings account), each ONE document posting 2110 on Groovy's book and S1040 on the Savings book; no interest by default; the outstanding on both overviews; a repayment pace on the Savings page. | "Around 1.5 million is borrowed … paid back at slow speed." | interest; per-owner sub-loans |
| 12 | **Asghar's unit** | Party kind `affiliate`: a rate card seeded from the printing rate master; an approved `printing_billing` for a job assigned to his unit becomes an `ma_bill` (qty ≤ `finalApprovedQty`, refused otherwise); payments as any vendor; **1170 Investment — Asghar's unit** for what Groovy put in, with its own ledger; his statement from the first entry. His unit's own P&L is not kept. | "Not an employee … we consider it our own … proper accounts from day one." | recovering the investment from his rate |
| 13 | **Tax on every document** | `tax:{kind: sales\|services\|withholding\|none, rate, amount, inclusive, ref?}`; defaults from the party (`tax.regime`, `withholdingPct`, NTN/filer) and the item; the form shows the block and the person confirms; accounts 2120 sales tax payable, 1160 input tax, 2130 withholding payable; a quarterly tax page. **Rates are blank settings until the accountant fills them.** | "A lot of entries do have taxes, some don't." | — |
| 14 | **Periods** | Fiscal year from 1 July; **quarter close = hard lock**; **month close = soft** (checkpoint, warning on backdating, no lock), taken where a month matters (payroll, monthly-billed vendors, the Store's month). Reopen by an owner with a reason. | "Three months is the closing period, monthly where required." | monthly hard close |
| 15 | **Go-live and history** | Live from **1 Oct 2026** (Q2). Q1 (1 Jul–30 Sep 2026) stays open for **backfill at your own pace**, documents dated in it marked `historical`, until the owners close it. Openings on 1 July 2026. | "Entry logic from day one so I can do it at my own pace." | opening balances on 1 Oct and no history |
| 16 | **Payroll import** | The Excel sheet is read in the browser (vendored SheetJS), previewed, and written as accruals + payments + employee-ledger openings, idempotent by employee + month; unknown employees are offered, never invented. | "3–4 months on Excel." | typing them |
| 17 | Party master | One `ma_parties` for every kind; a vendor declares what it provides; gate-pass destination and fabric supplier become party picks. | v2 §3.3. | — |
| 18 | Rate cards, terms, history | Per party, per item or service, history kept; terms with `termsHistory[]`, older bills keep their terms; `history[]`/`edits[]` on every record and document. | v2 §3.4–5, 18. | — |
| 19 | Purchase orders, receipts, bills, payments | As v2 §3.6–9: PO optional and assignable to production POs; fabric-in and gate-pass returns are receipts; bills matched three ways with `invoiceNo` unique per vendor; payments allocated (owner picks, default FIFO), from a named holder; retention. | — | — |
| 20 | Sales | Warehouse sales → invoices + collections; Shopify orders → invoices per order **with the gateway deciding the receivable** (COD → the courier; Payfast → 1125); gate sales → invoice + receipt. Needs `gateway` on the order sync (proposal to Ammar). | — | — |
| 21 | Costing | Standard-then-actual per production PO, FIFO across POs, a missing leg named; Asghar's printing is the embellishment leg at his card rate. | v2 §3.11. | average cost |
| 22 | Chart of accounts | Seeded (§4.1), typed, codes never reused; the Savings book has its own (§4.5). | — | — |
| 23 | Charts and learning | HTML charts, validated `--chart-*` palette, table twins; deterministic statistics with a basis; the concern logic is rule-based from M3 and learned from M10. | — | — |
| 24 | Not built, named | Multi-currency; tax filing; bank or gateway API feeds; an accountant role; AI Q&A; consolidation; forecasting beyond 90 days; a vendor portal; Asghar's own P&L; interest on the owners' loan. | Each is a phase. | — |

## 4. Master data

### 4.1 `ma_accounts/{code}` — Groovy's chart of accounts (seeded, editable, typed)

`{code, name, type (asset|liability|equity|revenue|cogs|expense|suspense),
kind, holder?, parent?, owner?, active, order, history[]}`. `kind:'money'`
accounts are the **holders**; `holder` names the person or place.

| Range | Accounts |
|---|---|
| Money (holders) | **1010 Cash — store drawer (Raees)** · **1011 Cash — with Afnan** · **1012 Cash — with Ammar** · **1020 MCB current** · 1030… other banks and wallets (placeholders) · **1040 Warehouse till (Umair, not yet handed over)** · **1050 Runner floats** · **1060 TCS account (credited at 90 days)** |
| Receivables | 1110 Customers (warehouse pay-later) · **1120 PostEx — delivered, not yet on a CPR** · **1121 PostEx — CPRs issued, not yet collected** · **1122 TCS — delivered, inside 90 days** · **1123 Blue-Ex (legacy)** · **1124 Bykea** · **1125 Payfast (prepaid, not yet paid out)** · 1140 Employees (advances, loans) · 1150 Vendor advances · **1160 Input tax** · **1170 Investment — Asghar's unit** |
| Stock and assets | 1210 Fabric · 1220 Trims · 1230 Work in progress · 1240 Finished goods · 1310 Fixed assets |
| Liabilities | 2010 Payable — vendors · **2011 Payable — Asghar's unit** · 2020 Retention held · 2040 Payable — salaries · 2050 Payable — runners · 2060 Payable — creators · 2070 Customer deposits · **2110 Loan from owners' savings** · **2120 Sales tax payable** · **2130 Withholding tax payable** · 2140 Other loans |
| Equity | 3010/3011 Capital — Afnan / Ammar · 3020/3021 Drawings — Afnan / Ammar · 3090 Retained result |
| Revenue | **4010 Online — COD** (sub-accounts per courier) · **4011 Online — prepaid (Payfast)** · 4020 Warehouse · 4030 Fabric & garment sales · 4040 Discounts given · 4050 Refunds & returns · 4090 Other income |
| Cost of goods | 5010 Fabric · 5020 Stitching · 5030 Embellishment (**5031 Asghar's unit**) · 5040 Trims · 5050 Washing & dyeing · **5060 Courier fees & tax** · **5070 Reversals & returns** · 5080 Packaging · 5090 Cost variance |
| Expenses | 6010 Salaries · 6020 Marketing & PR · 6030 Utilities · 6040 Rent · 6050 Maintenance · 6060 Fuel & transport · 6070 Office · **6080 Bank & gateway charges** · 6090 Depreciation · **6100 Subscriptions (company)** · **6110 Taxes & levies (non-recoverable)** · 6190 Other |
| Suspense | 9010 Unclassified in · 9020 Unclassified out · 9030 Reconciliation differences |

### 4.2 `ma_parties/{id}` — one record per vendor, customer, courier, employee, owner, bank, affiliate

```
{ kind: vendor|customer|courier|employee|owner|bank|affiliate,
  name, code (short, unique), active,
  vendor: {
    roles: [fabric_mill|stitching|washing|dyeing|embroidery|printing|sublimation|trims|packaging|
            service|utility|consumable|transport|other],
    provides: [{itemKind, unit, note}],
    terms: {mode:cash|credit|monthly|weekly, creditDays, creditLimit, billDay, billWeekdays[],
            advanceAllowed, retentionPct, payDays[], from},
    termsHistory: [{...terms, from, to, by, at, reason}],
    rateCard: [{id, itemKind, article?, unit, rate, min?, validFrom, validTo?, by, at, note}],
    tax: {regime: none|sales|services, rate?, ntn?, filer?, withholdingPct?},
    bank: {title, iban?}, contact: {person, phone, address},
    meter?: {type:count|weighed, unit, rate} },
  customer: {terms:{mode, creditDays, creditLimit}, phone, address},
  courier:  {cycle: cpr|account|legacy|manual,
             cprDays?: [2,5],            // PostEx: Tuesday, Friday
             collectBy?: 'afnan',        // who usually collects, in cash
             collectLagDays?: 1,
             creditDays?: 90,            // TCS: delivery → the TCS account
             confirmBy?: 'raees',        // Bykea: lands in the drawer
             tolerancePct, feeCard:[{kind:delivery|reversal|tax|cod_fee, rate|pct, validFrom}],
             openingStatement?: {date, amount, attachment}},   // Blue-Ex
  employee: {employeeId (HRM), schedules:[{kind:advance|loan, monthly, from, balance}]},
  owner:    {username, holderAccount: 1011|1012},
  bank:     {accountCode},
  affiliate:{rateCard:[...], investment:{account:1170, openingAmount, openingDate, attachment},
             billsFrom: 'printing_billing'},
  openingBalance, openingDate, notes, createdAt/By, updatedAt/By, history[] }
```

The vendor's page (specimen: *Vendor*) shows what he provides, the current
terms with the button to edit them (history below), the rate card with the
history of every rate, open purchase orders, the credit/debit ledger with a
running balance, the statement by date range, aging, and every attachment.
A courier's page (specimen: *Couriers*) shows its CPRs or statements, the
collections against them, what is in transit, and its fee card.

### 4.3 `ma_items/{key}` — items and services

`{key, kind (fabric|trim|garment_service|embellishment|packaging|consumable|
utility|courier_fee|subscription|other), name, unit, article?, storeCode?,
tax:{regime, rate?}, active}`. Fabric keys follow the inventory key
`type__gsm__colour`; services are `stitch:<article>`, `wash:<article>`,
`emb:<article>:<process>`.

### 4.4 `ma_settings/main`

`{fiscalYearStart:'07-01', goLive:'2026-10-01', historyFrom:'2026-07-01',
payDays:[3,6], cprDays:[2,5], tcsCreditDays:90, courierTolerancePct,
holderFloor:{1010:…}, categoryMap, budgets, bankRules, overheadPct,
matchTolerance:{qtyPct, ratePct}, refuseAbove:{…}, flagAbove:{…},
tax:{defaults per kind, rates (blank until set)}, payout:{rule:
'repay_then_draw', drawSplit:{afnan:50, ammar:50}}, concern:{madWatch:2,
madConcern:3, minAmount, budgetWatchPct:90}, learning:{…}}` — every
threshold the validation engine or the concern logic reads is here and on
the settings page.

### 4.5 `ma_sv_accounts/{code}` — the Savings book's chart

Assets: **S1010 Cash — Afnan** · **S1011 Cash — Ammar** · **S1020 Payfast
payout account** · S1030/S1031 Bank — Afnan / Ammar · **S1040 Loan to
Groovy** · S1050 Vehicles · S1060 Property · S1070 Investments · S1080
Other receivables. Liabilities: S2010 Vehicle finance · S2020 Borrowed ·
S2030 Cards · S2040 Other. Equity: S3010 Afnan · S3011 Ammar · S3012
Joint. Inflows: **S4010 From Groovy — loan repayment** · **S4011 From
Groovy — drawings** · S4020 Other income · S4030 Gifts and transfers in.
Spend: **S5010 Marriage** · **S5020 Car** · S5030 Household · S5040
Subscriptions (per owner via tag) · S5050 Travel · S5060 Family · S5090
Other. Targets are **envelopes** (tags on entries and on assets), not
accounts, so saving toward one never leaves the account the money sits in.

## 5. Documents and their lifecycle

| Document | Collection | Made from | States | Posts |
|---|---|---|---|---|
| **Courier statement (CPR)** | `ma_cpr` | **derived nightly** from `postex_orders` (one per CPR number; `kind: upfront\|reserve`); typed for TCS, Blue-Ex, Bykea with an attachment | issued → collected → reconciled · disputed | 1121 CPRs issued ↔ 1120 delivered (PostEx); fees and tax ↔ 5060; reversals ↔ 5070 |
| **Collection** | `ma_collection` | the form: CPRs, amount, holder, date, receipt photo; who collected | pending (another person's hands) → posted · void | holder ↔ 1121 (or 1122/1123/1124); a difference ↔ 9030 with a reason |
| **TCS credit** | `ma_cpr` kind `account` | TCS's statement (typed, attached); the calendar expects it at delivery + 90 days | expected → credited · disputed | 1060 TCS account ↔ 1122 |
| **Transfer between holders** | `ma_transfer` | the form; a bank withdrawal or deposit; a TCS withdrawal | pending (until the receiver confirms) → posted · void | to-holder ↔ from-holder |
| **Payfast payout** | `ma_payout` | the form with Payfast's statement attached | posted · void | Groovy: 2110 then 3020/3021 ↔ 1125; 6080 fee. Savings: S1020 ↔ S1040 then S4011 |
| **Owner loan draw / repayment** | `ma_loan` | the form | posted · void | Groovy: a holder ↔ 2110. Savings: S1040 ↔ a savings account |
| Purchase order | `ma_po` | the form; a production PO's needs; a gate pass | draft → sent → partly received → received → closed · cancelled | nothing (a commitment) |
| Receipt | `ma_receipt` | fabric-in + rate · vendor return on a gate pass · printing QC approval · store receive | posted · void | inventory or WIP ↔ accrued payable |
| Vendor bill | `ma_bill` | the form (invoice required above a threshold); a metered vendor's month; **Asghar's approved billing**; Store Accounts purchase (until M8) | draft → posted → partly paid → paid · void | accrued payable ↔ 2010/2011; tax ↔ 1160/2130 |
| Vendor payment | `ma_payment` | the form; a pay-day run; from a named holder | posted · void | 2010 (allocations) ↔ holder; unallocated → 1150; withholding ↔ 2130 |
| Retention release | `ma_payment` kind `retention` | QC cleared | posted · void | 2020 ↔ holder |
| Customer invoice | `ma_invoice` | warehouse sale · Shopify order (gateway → COD courier or Payfast) · gate sale | posted → partly collected → collected · void | 1110/1120/1122/1124/1125 ↔ 4010/4011/4020/4030; tax ↔ 2120 |
| Customer receipt | `ma_receipt_in` | collection · Raees's confirmation | posted · void | holder ↔ 1110 |
| Payroll accrual | `payroll_runs` + **the importer** | HRM processing; the Excel sheet | mirrors HRM | 6010 ↔ 2040; deductions ↔ 1140 |
| Payroll payment | `ma_payment` kind `payroll` | the form; the importer | posted · void | 2040 ↔ holder |
| Employee advance / loan | `ma_journal` kind | HRM approval + the holder it left; the importer | posted | 1140 ↔ holder |
| Float out / in / settle | `ma_journal` kinds | Raees's forms (M8) | posted · void | 1050 ↔ 1010; 2050 |
| Journal | `ma_journal` | the form: bank charge, capital, drawing, asset, tax, opening, reclass | posted · void | its lines |
| **Savings entry** | `ma_sv_entries` | the form; the payout; the loan; statement import | posted · void | its Savings lines; tags: owner, target, subscription |
| **Savings valuation** | `ma_sv_assets/{id}.valuations[]` | the form | — | S1050–S1070 / S2xxx ↔ S30xx (a revaluation, never income) |
| Quarter / month close | `ma_closes` | the checklist | closed · reopened | nothing; locks (quarter) or checkpoints (month) |

Every document carries `{no, date, month, quarter, historical, party,
holder?, amount, lines[], tax:{kind, rate, amount, inclusive}, refs{po,
receipts, invoiceNo, gpId, fabId, jobId, cprNos[], legacyId}, attachments[],
status, flags[], validated:{at, rules[]}, by, byName, ts, confirmedBy/At,
voidedAt/By/Reason, edits[]}`. Numbers are minted in the same transaction
as the document (the Pattern Hub lesson).

## 6. The validation engine — `maValidate(doc, ctx)`

`ctx` holds the party, its terms, rate card and courier terms, the
referenced PO, receipts and CPRs, the holders' current balances, the
period calendar, the settings and the party's balance. The result is a
list of `{rule, level: refuse|flag|ok, message, field}`; one `refuse` stops
the write; `flag`s post and mark the document for the owners' review
queue. **Every rule is a test.**

| Rule | Level | Applies to |
|---|---|---|
| Party exists, is active, and is of the right kind for the document | refuse | all |
| Date is a real local day, not in the future, not in a **closed quarter** | refuse | all |
| Date in a **soft-closed month** | flag ("September is soft-closed — this changes a reviewed month") | all |
| Amount = Σ lines + tax as declared, whole rupees, > 0 (adjustments signed) | refuse | all |
| **Tax block present with a kind** (`none` is a kind); `amount = rate × base` ± 1 rupee; inclusive/exclusive consistent; withholding ≤ amount | refuse | all |
| Tax kind or rate differs from the party's or item's default | flag with the default shown | bill, invoice, payment |
| **A holder is named on every collection, payment and transfer, and is a money account** | refuse | collection, payment, transfer, payout, loan |
| **A holder cannot go below zero** (or below its floor setting) | refuse (cash) · flag (MCB, where the bank's own overdraft is the truth) | payment, transfer, loan draw |
| **A transfer or collection into another person's hands is pending until they confirm**; pending never counts | — | transfer, collection, Bykea |
| **One live collection per CPR** | refuse | collection |
| Collection date ≥ the CPR's date; amount within `courierTolerancePct` of the CPRs' net | refuse · flag with the difference (a reason required) | collection |
| A collection needs its receipt attached | refuse | collection |
| A typed CPR or statement (TCS, Blue-Ex, Bykea) needs an attachment and its parcel count | refuse | ma_cpr (manual) |
| A parcel on two upfront CPRs or two reserve CPRs in the derivation | flag as a data issue, never doubled | ma_cpr (derived) |
| A TCS credit before delivery + `tcsCreditDays` − 7 | flag ("earlier than the 90 days") | TCS credit |
| Payout amount ≤ Payfast receivable outstanding (+ tolerance); the fee named; the repayment part ≤ the loan outstanding | flag · refuse | payout |
| Loan repayment ≤ outstanding; a draw names the savings account it left and the holder it reached | refuse | loan |
| A line's item is on the vendor's `provides` list | flag | PO, bill |
| A line's rate equals the current card rate (± `ratePct`) | flag with the card rate; refuse if no reason when over the tolerance | PO, bill |
| A rate with no card entry at all | flag ("no rate card for this item — add it?") | PO, bill |
| Receipt qty ≤ ordered × (1 + `qtyPct`) | refuse | receipt |
| Returned pieces ≤ pieces sent on the gate pass | refuse | service receipt |
| Bill qty ≤ received qty on the referenced receipts | refuse | bill |
| **Asghar's bill qty ≤ `finalApprovedQty` on the billing; rate = his card** | refuse · flag | affiliate bill |
| Bill vs PO (three-way match); variances by qty and rate shown | flag; refuse above `refuseAbove.matchVariance` | bill |
| `invoiceNo` unique per vendor | refuse | bill |
| Invoice attached above `flagAbove.noInvoice` | flag; refuse above `refuseAbove.noInvoice` | bill, payment |
| Payment allocation ≤ each bill's outstanding; Σ allocations ≤ payment; the remainder an advance only if terms allow | refuse | payment |
| Credit limit exceeded after this bill | flag ("Nishat: ₨8.4 lac of a ₨7.5 lac limit") | bill |
| Due date from the terms **in force on the bill's date** (`termsHistory`) | offered, recorded | bill |
| Retention posts `retentionPct`; release needs QC with no open rework | refuse release otherwise | payment |
| Duplicate (same party, amount, date, invoiceNo within 7 days) | flag | bill, payment, collection |
| Customer invoice discount ≤ the cap (warehouse 20%) | refuse | invoice |
| Pay-later invoice over the customer's credit limit | flag | invoice |
| Collection ≤ outstanding on the invoice | refuse | receipt in |
| **Payroll import: employee known** (else offered), month unique per employee (a re-import skips), net = gross − deductions | flag · refuse | importer |
| Journal balanced; suspense lines named | refuse if unbalanced | journal |
| **Savings: an entry tagged to a target is a spend or a transfer into its envelope; a subscription payment matches its register row (payee, amount ± 5%, cadence window); a payout in Savings has a Groovy side; a valuation is a revaluation, never income** | flag · refuse (valuation as income) | savings |
| Edit of a posted document: reason required, `edits[]` +1, no change of party or type | refuse otherwise | all |
| Void: reason required; a document with allocations or a collection against it cannot be voided first | refuse | bill, invoice, cpr |

The engine never silently changes a value. It offers (the card rate, the
due date from terms, the CPR's net, the outstanding to allocate, the tax
default) and records that the person accepted it.

## 7. The ledger — postings, holders and party sub-ledgers

Postings are balanced pairs keyed by `(document kind, id, version)`; a
void or an edit re-emits under the same key and the rollup replaces. Adapters
for records that are not yet master documents (Shopify orders, PostEx
parcels, payroll runs, Paid PR, embellishment billing, Store Accounts until
M8) live in `js/ma-core.js` beside the document postings.

**Holder ledger**: every money account has a statement — date · document ·
in · out · running balance · confirmed by — and a reconciliation queue
(MCB against its statement; the drawer against Raees's count; the TCS
account against TCS's statement; cash with Afnan or Ammar against a count
the owner records). **A holder's balance is what the calendar funds from.**

**Party ledger** (the credit/debit view): every posting touching a party's
control account is a row — date · document · debit · credit · running
balance · state (matched, flagged, partly paid, overdue, pending) ·
attachment; a statement by range; aging from open items with FIFO where a
payment did not allocate. A courier's ledger reads: delivered (owed to us)
· on a CPR · collected · fees; a customer's: invoiced · collected; an
affiliate's: billed · paid · investment.

**Allocation** (`maAllocate`): a payment's allocations are the record; open
items are bills minus allocations; an unallocated remainder is an advance
the next bill offers to consume.

## 8. Money in, first mile — couriers and cash collection

**PostEx (`cycle: cpr`).** The nightly rollup reads `postex_orders`, groups
delivered and returned parcels by `cprNumber_1` (the upfront receipt) and
separately by `cprNumber_2` (the reserve receipt), and writes one `ma_cpr`
per number: `{courier:'postex', no, kind, date (cpr1Date|cpr2Date|
settlementDate), parcels:[trackingNumber…], cod, fees, tax, reversals,
net, status}`. **Net is derived from the parcels' own fields**, the same
way for the COD tab and the CPR tab — one definition, `maCprNet`, ending
the two-nets defect in §1. A parcel delivered but on no CPR yet is **COD in
transit** (1120): the overview's "owed to us" names it. A CPR issued but
not collected sits in 1121 with its day (Tuesday, Friday) and who usually
collects (`collectBy`), and the calendar expects the cash `collectLagDays`
later. The **collection** is the owner's document: the CPRs it covers (one
or several), the amount counted, the holder it went into (1011 by default
for Afnan, 1012 for Ammar, 1010 when handed straight to Raees, 1020 when
deposited), the date, the receipt photo; the difference from the CPRs' net
is shown, needs a reason, and posts to 9030 until explained. **Reconciled**
means the parcels' `settle` flags agree with the collection; a parcel that
later reverses after its CPR is a reversal line on the next CPR, which the
derivation already sees.

**TCS (`cycle: account`).** No feed. A delivered TCS parcel (from the
Shopify order's courier once the sync carries it, or typed) is a receivable
in 1122; the calendar expects its credit on delivery + `tcsCreditDays`;
TCS's statement is typed as an `ma_cpr` kind `account` with the attachment,
moving the amount to **1060 TCS account — money that is ours and sits at
TCS**; a withdrawal from it is an `ma_transfer` to cash or MCB. What that
account is exactly is §23 Q4.

**Blue-Ex (`cycle: legacy`).** An opening receivable (1123) from their last
statement, attached and dated; aged from that date on the overview until
zero; collections against it like any CPR; nothing new is dispatched to it,
and a document naming Blue-Ex as the courier of a new order is refused.

**Bykea (`cycle: manual`).** Their statement typed as an `ma_cpr` with an
attachment; the money reaches Raees, so the collection is into **1010 and
pending until Raees confirms** (his Store Accounts cash-in form is the
confirmation surface after M8; until then the owner records it and the
document waits). A Bykea feed is a later milestone; nothing here prevents it.

**The courier page** (`ma-couriers`, specimen *Couriers*): tiles (in
transit with PostEx · CPRs waiting to be collected · collected this month ·
TCS due inside 90 days and the TCS account · Blue-Ex still owed), the CPR
table (no · day · parcels · COD · fees · net · collected by / when ·
state), the Tue/Fri collection rhythm with the next expected amounts, fees
and reversals by month, and one card per courier with its terms.

## 9. Savings — the owners' book

A second ledger with the same two readers and writers, its own chart
(§4.5), and nothing in common with Groovy's book except the two documents
that post on both (§10). Pages `ma-savings` (overview), `ma-savings-targets`,
`ma-savings-recurring`, `ma-savings-networth`, `ma-savings-accounts`.

- **Accounts and where the money sits.** S1020 Payfast payout account (the
  account Payfast pays into — §23 Q1), each owner's bank and cash. Each has
  a statement, a running balance, an import (CSV/PDF attached, lines
  matched to entries) and a reconciliation queue, exactly like MCB on
  Groovy's side. **Every inflow carries an attachment** (the Payfast
  statement, the bank line).
- **Spend by category** (S5xxx), tagged `afnan` / `ammar` / `joint`, with
  the same concern logic as Groovy's spend (§17): a category that runs
  above its own baseline says so.
- **Subscriptions register** (`ma_sv_recurring`): `{name, owner, amount,
  cadence: monthly|yearly|weekly, nextDue, account, category, active,
  lastMatchedEntry}`. The app **detects** recurring lines from history
  (same payee, amount ± 5%, a regular gap) and offers them; an owner
  confirms. Each row shows the annualised cost; the page totals per owner
  ("Ammar's subscriptions cost ₨X a month, ₨Y a year") and flags a
  subscription paid twice, one not paid on its due day, and one whose
  amount moved.
- **Targets** (`ma_sv_targets`): `{name, amount, by (date)?, fundedBy,
  envelope tag, notes}` — *the marriage*, *the car* — with **saved so far**
  (entries and asset valuations tagged to the envelope), **spent so far**
  against it, **remaining**, **monthly need** to reach the date, **ETA at
  the current pace** (the last 3 months' pace), and what one change would
  do ("₨25,000 more a month brings the car to March"). Nothing is moved
  between accounts to fund a target; the envelope is a tag.
- **Assets and liabilities** (`ma_sv_assets`): `{kind: cash|bank|vehicle|
  property|investment|loan_to_groovy|receivable | vehicle_finance|
  borrowed|card|other, owner, account?, valuations:[{date, amount, by,
  note}]}`. Money accounts are valued by their ledger; everything else by
  its latest valuation. **Net worth** per owner and joint, with the loan to
  Groovy (S1040) as an asset whose value is the loan ledger's outstanding.
- **Reconciliation**: per account, statement lines vs entries, unexplained
  differences to a Savings suspense, an "unreconciled since" tile.
- **Rules**: `ma_sv_*` owner-only read and write, like `ma_*`.

## 10. The Groovy ↔ Savings loan, and the Payfast payout

Two documents post on both books, and each is ONE document so the two books
cannot disagree:

- **`ma_loan`** `{kind: opening|draw|repayment, date, amount, lender
  (afnan|ammar|joint), groovyHolder, savingsAccount, note, attachment}`.
  Groovy: draw = holder ↔ 2110; repayment = 2110 ↔ holder. Savings: draw =
  S1040 ↔ savings account; repayment = savings account ↔ S1040. The opening
  (~₨15 lac, split §23 Q3) is dated at go-live with its evidence. No
  interest by default. **Outstanding on both overviews**; the Savings page
  shows the repayment pace ("₨1.2 lac a month over the last quarter — clear
  by August 2027 at this pace").
- **`ma_payout`** `{date, gross, fee, net, receivingAccount (S1020), split:
  {repayment, drawAfnan, drawAmmar}, attachment}`. Groovy: 1125 Payfast
  receivable is cleared by `gross`; `fee` → 6080; `repayment` → 2110;
  the draws → 3020/3021. Savings: S1020 ↔ S1040 (repayment) and S4011
  (drawings). The split follows `settings.payout.rule` (**repay first**,
  then draws by `drawSplit`) and can be overridden on the document with a
  reason. **A payout larger than the Payfast receivable is flagged** — it
  means orders the sync has not seen, or refunds, and the sentence says so.

## 11. Asghar's unit — the affiliate

- Party kind `affiliate`, with a rate card seeded from the printing rate
  master (`PRINTING_RATE_MASTER`, Ammar's file — read, not edited) and
  editable with history like any card.
- **An approved `printing_billing` for a job assigned to his unit becomes an
  `ma_bill`** on his ledger (adapter in M6, the payee join through the job's
  `vendorName/assignedTo`), qty refused above `finalApprovedQty`, rate
  flagged off his card, `materialCostImpact` as a negative line. Payments
  to him are `ma_payment` from a named holder. His ledger reads billed ·
  paid · balance, with a statement and aging like a vendor's.
- **1170 Investment — Asghar's unit**: what Groovy put in (amount, dates,
  materials — §23 Q10), with its own ledger and attachments; further
  support is a document on it; nothing is deducted from his bills unless an
  owner decides so (a setting, off).
- His unit's own P&L, stock or payroll are **not kept** — Groovy's book
  records what Groovy owes him, paid him and invested in him. If that ever
  changes, it is a third book, not lines in this one.
- The specimen shows him as a party row and a ledger; page `ma-party`.

## 12. Tax on every document

`tax:{kind: sales|services|withholding|none, rate, amount, inclusive,
ref?}` on every document, never absent. Defaults come from the party
(`tax.regime`, `withholdingPct`, filer status) and the item; the form shows
the block filled and the person confirms or changes it (a change is
flagged against the default). Postings: sales tax charged on an invoice →
2120; sales tax paid on a bill → 1160 where claimable, else into the cost
(a party/item flag); withholding deducted from a vendor payment → 2130,
the vendor's ledger showing gross, withheld and net. Page `ma-tax`: per
quarter, output tax, input tax, withholding by vendor with a certificate
list, and the net position — **a report to hand to the accountant, not a
filing**. **Rates are blank settings**; until the accountant fills them
every default is `none` and the block still has to be confirmed, so no
document is ever written without a tax decision.

## 13. Costing — the production PO cost sheet

`maCost(po)` reads the production PO's fabric issues (× the receipt rate of
the rolls issued, FIFO by roll), the service receipts and bills linked to it
(stitching, washing, embellishment — Asghar's at his card rate, external
printers at theirs — per piece), the trims issued (× rate) and the overhead
% setting, and returns `{legs:{fabric, stitching, washing, embellishment,
trims, overhead}, pieces:{cut, received, passed, transferred, bstock},
perPiece, missing:[legs with no rate]}`. WIP carries the cost while the PO
is open; on transfer to the warehouse it moves to finished goods per
article; a sale of that article posts COGS at the latest completed PO's
cost (FIFO across POs). B-stock is valued at the same cost and written down
on the owners' decision. **A missing leg is printed as missing, never as
zero.**

## 14. Entry at your own pace

- **History is open.** Documents dated from `historyFrom` (1 July 2026) to
  go-live are `historical:true`, accepted with every check except the
  period lock, listed on `ma-close` as "Q1 backfill: N documents, last
  entered …", and locked only when the owners close Q1.
- **A vendor from any form.** "+ New party" inline: name, kind, what it
  provides, terms; the rest later. A bill can name a party whose rate card
  is empty (flagged: "no rate card — add it?").
- **A PO is optional**; a bill without one is flagged, not refused; a gate
  pass can raise the PO in one tap.
- **Quick forms** for the four daily documents: collect a CPR, pay a
  vendor, hand cash over, record a bill; each prefilled from the calendar
  (today's CPR, today's pay-day list) and keyboard-first on desktop,
  thumb-first on the phone.
- **Importers**: the payroll Excel (M6); Store Accounts (M8, idempotent by
  `legacyId`); PostEx CPRs (derived, nothing to import); a bank CSV (M3,
  once a statement is seen); a Payfast statement (M4).
- **The unfinished queue**: documents flagged, pending confirmation,
  missing an attachment or a reason, in one list with one button each.
- **Statements in one go**: any party, holder or account, any range, Excel
  or PDF through the print engine.

## 15. How today's modules become entry surfaces

| Today | Phase | Becomes |
|---|---|---|
| PostEx (`postex_orders`, the CPR tab) | M2 | `ma_cpr` derived nightly; the CPR tab links to its collection state; nothing typed twice |
| Daily Performance courier rows | M2 | TCS, Blue-Ex, Bykea as courier parties; the page's numbers unchanged |
| Store Accounts (`acct_vendors`, `acct_entries`) | until M8 adapters; **M8 migrated** | vendors → parties; purchases → bills (+ receipts); payments, cash-ins, floats, settlements → their documents; the drawer = holder 1010; Raees's confirmation = the receiver's confirmation on a transfer |
| Warehouse sales (`wh_sales`) | M5 adapters; M8 migrated | invoices and receipts; the till = holder 1040; Umair's form unchanged |
| Gate pass to a vendor (`dest`) | M3 | `dest` becomes a party pick; the pass is the dispatch; the return is the receipt |
| Fabric in (`fabricin`) | M3 | gains `poRef`, `rate`, `invoiceRef`, tax; the supplier is a party |
| Store receive | M3 | gains `rate`, `poRef` |
| Embellishment billing | M6 adapter | Asghar's approved bills → `ma_bill` on the affiliate; external printers' → `ma_bill` on the vendor |
| Payroll (`payroll_runs`, the Excel sheet) | M6 | the importer; accrual adapter; payroll payment documents; `paidVia` proposed on the slip |
| Shopify | M5 | invoices per order, the receivable by gateway; proposals to Ammar: `gateway` on the sync, a 14-day refresh |
| Production (`pos.*`) | M7 | units for costing; no change to the screens |

`js/shared.js` gains the nav entries and one `renderPage` line;
`js/gatepass.js` and `js/fabric.js` gain party picks and rate fields
(cross-track, coordinated); `js/store-accounts.js` and
`js/warehouse-sales.js` are re-pointed in M8; `netlify.toml` gains the
rollup schedule.

## 16. The UI — pages `ma-*`

| Page | What is on it |
|---|---|
| `ma-overview` | cash by holder (hero, with who holds what), in/out this month, owed to us (in transit · CPRs to collect · TCS · Blue-Ex · customers), we owe, runway; **the concern strip** (the three sentences that matter today); **the 30-day cash calendar**; **the spend map**; cash in/out by week; balance and projection; where the money went; revenue by channel; aging both ways; the loan outstanding |
| `ma-couriers` | §8: tiles, the CPR table, the Tue/Fri rhythm, collections, fees and reversals, a card per courier |
| `ma-ledger` | every posting, one line shape, filters by document kind, party, holder and account |
| `ma-parties` / `ma-party` | vendors · customers · couriers · employees · owners · banks · affiliates; the party page with what it provides, terms (history), rate card (history), open POs, the credit/debit ledger, statement, aging, attachments |
| `ma-purchasing` | purchase orders, receipts, bills with match status, the review queue; + PO · + Bill · + Receipt |
| `ma-payments` | the pay-day list (Wed/Sat, from terms), pay runs by holder, allocations, retention, advances |
| `ma-money` | one page per holder: statement, running balance, confirmations pending, reconciliation, transfers, floats; MCB import |
| `ma-sales` | invoices by channel and gateway, collections, pay-later reminders |
| `ma-savings`, `-targets`, `-recurring`, `-networth`, `-accounts` | §9 |
| `ma-loan` | the loan ledger on both books, draws, repayments, pace, the payout rule |
| `ma-costing` | cost sheets, cost per piece, margin by article and channel, missing legs |
| `ma-people` | payroll accruals and payments, the importer, employee ledgers, Asghar's page |
| `ma-tax` | §12 |
| `ma-pnl`, `ma-balance`, `ma-cashflow`, `ma-aging`, `ma-reports` | the statements, exports |
| `ma-budgets`, `ma-insights` | the learning layer |
| `ma-close` | the quarter checklist, the month soft close, the Q1 backfill count, locks, reopen, the audit trail |
| `ma-settings` | chart of accounts (both books), items, holders, tolerances, tax defaults, pay days, CPR days, the payout rule, fiscal year, go-live |

The specimen shows Overview (with the concern strip, the calendar and the
spend map), Ledger, Purchasing, a Vendor page, **Couriers**, **Savings**,
P&L and Insights. Charts: HTML/CSS, the validated `--chart-*` palette
(light on `#fff`, dark on `#17171A`; worst adjacent colour-blind ΔE
9.1/8.4, normal 19.6/19.3), a table twin, one filter row. **Concern states
are painted with the app's semantic accents** (`--accent-warning-soft`,
`--accent-urgent-soft`), never with a series colour, and their text stays
`var(--text)`.

## 17. The money speaks — the concern logic and the visuals

**`maConcern(line, ctx)`** runs over every line of spend — a category, a
vendor, a courier's fees, salaries, a subscription — and over every
commitment, and returns `{state: fine|watch|concern, sentence, basis,
action}`. Three tests, the worst wins:

| Test | watch | concern |
|---|---|---|
| **Against its own history** (median and MAD of the last 6 months; a minimum amount so ₨2,000 never shouts) | above median + 2·MAD | above median + 3·MAD |
| **Against its budget** (the accepted one; none → no test) | past `budgetWatchPct` (90%) with days left in the month | over the budget |
| **Against its terms and commitments** (the rule-based half, live from M3) | a vendor past 80% of the credit limit; a bill due inside 3 days with the pay-day holder short; a CPR two days past its collection lag; a subscription due tomorrow with the account short | overdue; a pay day the holders cannot fund; a CPR a week uncollected; a holder below its floor; a loan repayment missed |

The sentence is plain words with the number and the comparison — *"Fabric
is ₨21.3 lac this month against a usual ₨13.9 lac; two Al-Karam bills carry
₨6.1 lac of it"*; *"Wednesday's pay day needs ₨5.2 lac; the drawer and
Afnan's cash hold ₨3.1 lac; Friday's CPR (about ₨9.8 lac) lands after it"*
— and every one carries its basis and one action (open the lines, move the
bill, transfer, mark expected). **An owner's answer is remembered**: *"this
is the drop"* silences that line for that month and teaches the baseline
(the feedback store, §18).

Visuals, all HTML with the page's own text sizes:

- **The concern strip** at the top of the overview: at most three
  sentences, worst first, each with its state chip and action; "nothing to
  worry about today" when there is none — said, not blank.
- **The spend map**: one rectangle per category this month, area by
  rupees, tinted by state (`--accent-urgent-soft` for concern,
  `--accent-warning-soft` for watch, `--surface-2` for fine), the label and
  the amount inside, the comparison on hover; a click opens the lines. Rows
  by kind (cost of goods · people · running the business) so the eye reads
  it in three strokes.
- **The cash calendar**: 30 days from today, one cell a day, **inflows**
  (Tuesday and Friday CPRs at their expected net, TCS credits at day 90,
  pay-later customers on their due date, the usual Payfast payout) and
  **outflows** (Wednesday and Saturday pay-day totals from the terms,
  salaries on the payroll day, subscriptions, the loan repayment) with the
  projected holders' balance under it; a day the holders cannot fund is
  marked and named in the strip.
- **Of every ₨100 that came in** this month: fabric, stitching,
  embellishment, couriers, salaries, everything else, saved — one row of
  proportional boxes with the numbers inside.
- Every visual has its table twin and says its window and basis.

## 18. Learning — what the app learns

Baselines (median/MAD over 6 months; seasonality once 24 months exist),
anomalies (3·MAD with a minimum amount, explained by their lines), cash
forecast 30/60/90 from the calendar and expected inflows with a band,
runway, budget suggestions the owner accepts, category-mapping suggestions,
data quality. New in v3: **the CPR rhythm** (median CPR net by weekday,
the lag from CPR to collection, what a Tuesday and a Friday usually bring,
so the calendar's expected inflows are learned, not typed), **courier
behaviour** (reversal rate and fee per parcel per courier; TCS's real days
to credit vs the 90), **collection reliability** (difference between CPR
net and cash counted, by collector), **subscription creep** (annualised
cost per owner over time), **saving pace** per target, **vendor rate
drift**, **cost variance per PO**, **margin by article and channel**,
**vendor reliability**, and **which flags recur by vendor**. Every card
carries its basis; feedback (`expected` / `investigate` / `this is the
drop`) is the only stored memory (`ma_feedback`); nothing is written by the
layer on its own.

## 19. Rules and server functions

- `isMasterAccounts()` = afnan@groovy.op, ammar@groovy.op. `ma_parties`,
  `ma_items`, `ma_accounts`, `ma_settings`, `ma_feedback`, `ma_sv_*`,
  `ma_loan`, `ma_payout`, `ma_cpr` (manual kinds), `ma_collection`,
  `ma_transfer`: owner read/write. Documents (`ma_po`, `ma_receipt`,
  `ma_bill`, `ma_payment`, `ma_invoice`, `ma_receipt_in`, `ma_journal`):
  owner create; **entry roles create their own kinds under their own rules
  after M8** (Raees: bills, payments, cash-ins, floats, own edits with
  history, confirmations of transfers into the drawer; Umair: invoices,
  collections); update limited by `hasOnly` to state transitions,
  confirmations, allocations and `edits[]` growth naming the changed
  fields; delete never. `ma_cpr` derived kinds, `ma_daily`, `ma_month`,
  `ma_quarter`: server only. `ma_closes`: append, reopen by owners. Every
  block run in the emulator before the paste; the first owner-only read
  rules in the app.
- `ma-rollup` scheduled 03:45 UTC after PostEx payments and the Marketing
  rollup: derives `ma_cpr` from `postex_orders`, recomputes rollups and the
  trial balance on both books, writes the calendar's learned inflows;
  `ma-rollup-now-background` on demand behind an ID-token check; both
  require `js/ma-core.js`. Proposals to their owners: the Shopify sync
  carries `gateway` and refreshes 14 days of orders (Ammar); HRM records
  `paidVia` (Afnan).

## 20. Periods — quarterly close, monthly where required

Fiscal year from 1 July (setting). Quarters: Q1 Jul–Sep, Q2 Oct–Dec, Q3
Jan–Mar, Q4 Apr–Jun. **Quarter close**: the checklist (every holder
reconciled to the quarter end or an acknowledged exception; no pending
confirmations; no unexplained 9030; every flagged document reviewed; the
tax page produced; the trial balance on both books zero), then a hard lock
— a document dated in it is refused, an edit or void of one is refused,
reopen by an owner with a reason and a log line. **Month close** on demand:
a checkpoint of balances and a soft flag on any later document dated in it;
taken where a month is a real boundary (payroll, monthly-billed vendors,
Raees's Store month after M8). The current quarter (Q1, Jul–Sep 2026) is
the backfill quarter and closes when the owners say so, not on 30 September.

## 21. Milestones — each shippable and reviewable alone

| M | Ships | Cross-track |
|---|---|---|
| **M0** | this plan, the specimen, §23 answered | — |
| **M1 Foundation & cash positions** | both charts of accounts, holders, party master with terms/rate cards/history, items, `js/ma-core.js` (postings, validation, allocation, balances, trial balance, the tax block), journals, **transfers between holders with confirmation**, the calendar (rule-based), `ma-overview` (live: cash by holder, calendar), `ma-ledger`, `ma-parties`/`ma-party`, `ma-money`, `ma-settings`, rules (the app's first owner-only reads), the dashboard widget | `index.html`, `sw.js`, `shared.js` (nav + one line), `css/main.css` tokens + `.ma-` block, rules republish |
| **M2 Couriers & collections** | `ma_cpr` derived from `postex_orders` (the rollup), manual statements for TCS/Blue-Ex/Bykea, collections with holder and attachment, COD in transit, the TCS account and its 90-day expectation, Blue-Ex's opening, Bykea pending Raees, `ma-couriers`, the Tue/Fri calendar entries, courier fees and reversals in the P&L | `netlify.toml` (the rollup schedule) |
| **M3 Procurement, terms & pay days** | `ma-purchasing`: purchase orders (assignable to production POs), receipts from fabric-in and vendor returns, bills matched three ways with tax, the review queue; `ma-payments` with allocation from a holder, the Wed/Sat pay-day list, retention, credit limits; `ma-aging`; **the concern strip's rule-based half**; a bank CSV import once a statement is seen | `js/gatepass.js` (party pick), `js/fabric.js` (party pick, rate, poRef), `js/store.js` (rate on receive) |
| **M4 Savings & the loan** | the Savings book: accounts, entries, statement import and reconciliation, spend by category, the subscriptions register with detection, targets, assets and liabilities, net worth; `ma_loan`, `ma_payout` with the repay-then-draw rule; `ma-savings*`, `ma-loan`; the loan on both overviews | — |
| **M5 Sales** | invoices from Shopify orders by gateway, warehouse sales (adapter) and gate sales; the Payfast receivable; customer ledgers; `ma-sales`; revenue by channel and gateway | proposal to Ammar (`gateway`, refresh) |
| **M6 People & the affiliate** | the payroll Excel importer, accrual and payment documents, employee ledgers (advances, loans with schedules), `ma-people`; Asghar's unit: the affiliate party, bills from approved billing, the investment ledger, his statement | proposal on `paidVia`; read of the printing rate master |
| **M7 Costing** | `ma-costing`, WIP and finished goods at cost, COGS on sale, margin by article | — |
| **M8 Absorb Store Accounts & warehouse sales** | migration (idempotent by `legacyId`), forms re-pointed, Raees's and Umair's rules carried over (own entries, edits with history, review, confirmations), the Reset retired | `js/store-accounts.js`, `js/warehouse-sales.js` |
| **M9 Reports, exports & tax** | `ma-pnl`, `ma-balance`, `ma-cashflow`, `ma-reports`, `ma-tax`; Excel; print-engine variants (party statement, holder statement, cost sheet, collection receipt, savings statement) | `js/print-engine.js` |
| **M10 Learning & the money speaks** | baselines, anomalies, forecasts, budgets, the learned half of the concern logic, the spend map, "of every ₨100", `ma-insights`, `ma-budgets`, feedback | bell for an unfunded day and an uncollected CPR |
| **M11 Close & audit** | the quarter checklist and lock, the month soft close, reopen, the audit trail, `ma-close` | — |

Every milestone ends with the standing caveat: nobody can look at it in a
browser from a session; Afnan's first open is the visual test.

## 22. Tests

`tests/master-accounts.test.js`: every validation rule both ways (refused,
flagged-and-posted, clean); every posting per document kind and state on
**both books**; the trial-balance invariant on a seeded quarter, both books;
a holder refused below zero and a pending transfer counting nothing;
**one collection per CPR**, the variance to 9030, the derivation of CPRs
from a scripted `postex_orders` set (a parcel on an upfront and a reserve
CPR is two rows, never doubled); the TCS 90-day expectation; the Blue-Ex
opening; the payout split (repay first, then draws; over the receivable
flagged); the loan on both books and the outstanding never negative; the
tax block (absent refused, `none` accepted, amount = rate × base, inclusive
vs exclusive, withholding on the vendor's ledger); Asghar's qty ceiling;
allocation (partial, FIFO default, advance remainder, over-allocation
refused); rate-card and terms history; the cost sheet; the party ledger's
running balance; the calendar (Tue/Fri inflows, Wed/Sat outflows, an
unfunded day named); the concern logic against a scripted history (the
three tests, the worst wins, the minimum amount, feedback silencing one
line); the subscriptions detection and a duplicate payment flagged; a
target's monthly need and ETA; the payroll importer's idempotence; the
quarter lock refusing and the month soft close flagging; the audience; the
nav order. `tests/ma-rollup.test.js` against an in-memory Firestore.
`tests/rules-emulator-ma.js` for every block, including that the first
owner-only reads refuse a manager. `tests/invariants.test.js` gains the
chart guard for `js/master-accounts.js`, the purity of `js/ma-core.js`,
the tokens, and that no `ma_sv_*` posting reaches a Groovy account.
`tests/smoke-layout.js` fragments for every page at three widths and both
themes, the spend map and the calendar included.

## 23. Open questions — with the default each takes until answered

The seven answers of 27 Sept 2026 resolved v2's questions 2, 3, 4, 5, 6,
8, 9 and 10 (see §0a). What they opened:

1. **Payfast**: which account receives the payouts (Ammar's personal bank?
   a joint account?), Payfast's fee and settlement cycle; send one
   statement. Default: the Savings account "Payfast payout account", fee
   from the statement, cycle learned.
2. **The payout rule**: repay the loan first, then drawings — and drawings
   split how? Default: repay first; then 50/50 unless the document says
   otherwise.
3. **The loan's opening**: the amount per lender (Afnan's savings, Ammar's,
   joint) and the evidence, as of go-live. Default: ₨15,00,000 joint, dated
   1 Oct 2026, editable with history.
4. **The TCS account**: what it is (a merchant wallet at TCS? a bank account
   TCS pays into?), how its balance is seen, whether TCS deducts fees before
   crediting. Default: an asset held at TCS, its statement typed in, fees
   per the statement.
5. **Blue-Ex**: the balance still owed, the last statement, anything
   disputed. Default: the opening receivable from the statement, aged from
   its date.
6. **Bykea**: how the money reaches Raees (transfer to MCB? cash?), how
   often, whether a statement exists. Default: a typed statement, collected
   into the drawer, pending Raees; a feed later.
7. **Company cash held by an owner**: is the PostEx cash you collect kept
   apart from your own money until it reaches Raees, a vendor or MCB?
   Default: yes — 1011/1012 are company money; mixing is a drawing or a
   capital journal.
8. **Subscriptions**: the list per owner (name, amount, cadence, account),
   or let the app detect them from the statements. Default: detect, then
   confirm.
9. **Targets**: the marriage and the car — amounts, dates, funded by whom,
   already paid. Default: two targets with placeholder amounts.
10. **Asghar's unit**: what Groovy put in (amount, dates, materials), whether
    any of it is recovered from his rate, whether he bills at the printing
    rate master's rates. Default: the investment at the stated amount, no
    recovery, his card seeded from the master.
11. **Tax**: which taxes actually apply (sales tax on goods, provincial
    sales tax on services, withholding on vendor payments), the rates, and
    Groovy's registration and filer status — the accountant's call. Default:
    the block exists, rates blank, `none` until set.
12. **Payroll**: send the Excel sheet (its real columns are what the
    importer is written to), and how salaries are paid (cash from which
    holder, bank). Default: cash from the drawer.
13. **Go-live and history**: live from 1 Oct 2026 with Q1 (Jul–Sep) entered
    at your own pace, or open the whole fiscal year? Default: Q1 open for
    backfill until you close it.
14. **Retention, match tolerance, PO-for-services, Raees's view of
    production rate cards, nav label, Mustafa's access, the Reset**: as v2
    (0% retention with the mechanism shipped; 2% qty, 0% rate with a reason;
    the gate pass can raise the PO; only his; "Master Accounts"; no; retired
    at M8).
15. **Whole rupees everywhere** (no paisa) and one currency. Default: yes.

## 24. What cannot be verified from a session

What the Console publishes; what a PostEx CPR's net really is on the
receipt PostEx prints (the derivation is from the parcels' fields; send one
CPR PDF before M2); what Shopify's `financial_status` means for a Payfast
order; the shape of the TCS, Blue-Ex, Bykea, Payfast and MCB statements
(send one of each before the milestone that reads it); the payroll sheet's
columns; anything visual — the specimen was rendered in headless Chromium
and looked at; the live module needs Afnan's first open, as always.

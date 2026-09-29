# Master Accounts — Master Plan v4 (cash first · terms are the key · every rupee labelled · the money speaks)

> Status (29 Sept 2026): **M1 BUILT, and merged into `main` from the branch
> `claude/master-accounts-planning-udoiw9` (Afnan's go-ahead, 29 Sept 2026;
> whether Netlify built it is unconfirmed until its deploy list is read); its
> FINAL rules are not yet published — two other publishes were reported that
> day and the Console's state is unknown; nobody has seen it on a real
> screen.** §21a says what M1 delivered against §21, what
> it changed in this plan, and what is still open. Everything from §22 on is
> still the plan. Afnan, 27 Sept 2026: *"I want
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
> slowly; Asghar, who prints for Groovy, is a vendor with agreed terms like
> any other (Afnan, later the same day, overruling the plan's first
> "affiliate" idea); every entry may or may not carry tax; the books close
> by the quarter. **v2's
> skeleton stands** — the party master, terms with history, rate cards,
> documents with a lifecycle, the validation engine, per-party ledgers,
> costing — and v3 puts the cash under it, the couriers in front of it, a
> Savings book beside it and the owners' loan between the two.
>
> **v4 (28 Sept 2026) answers the brief in §0b — *"a whole world of my
> money … you're 5% there"*.** It maps every rupee the app can see today,
> module by module and from the code (§25); lists every line the factory
> spends on, fixed and variable, rent to food to advances, with the state
> each is in (§26); puts a label on every posting (§27); turns every
> broken or missing flow into a build item with a milestone (§28); turns
> every former open question into a rule with a default (§23); and adds
> security, backup, print, edit and send-by-link as foundations rather
> than features (§29–§31). The UI is remapped desktop-first — ten pages,
> one Record button, a page map of what each tab reads — with the visual
> rules taken from a measured audit of the v3 specimen and from the
> Polaris, Carbon and Primer design systems (§16).
>
> Every decision is Claude's call, tabled to be overruled **here** (§3;
> §23 is no longer a list of questions but of rules with defaults).
> Companion: the UI specimen https://claude.ai/artifact/9bmhjEuaZMisWLb2TiQNyZ
> (`scratchpad/master-accounts-specimen.html`), private until shared,
> rebuilt to §16 in this version.
> `ACCOUNTS_PLAN.md` is Raees's Store Accounts and Umair's warehouse sales,
> both absorbed here in a named milestone (M8).
## 0. First mile to last mile, in one picture

```
 MONEY IN         PostEx delivers COD ──► CPR issued Tue / Fri ──► collected IN CASH (a day later,
 (first mile)     or the same day) by a named holder ──► the drawer, a vendor, or MCB
                  TCS delivers ──► credited to the TCS account after 90 days ──► drawn out
                  Blue-Ex (legacy) ──► balances still owed, collected against a statement
                  Bykea ──► transferred to Raees ──► the drawer (manual until a feed exists)
                  Payfast (prepaid web orders) ──► paid out on WEEKDAYS, daily, some days skipped
                  ──► the OWNERS' SAVINGS ──► the loan
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
 PEOPLE           payroll (3–4 months imported from the Excel sheet) · advances and loans as
                  employee ledgers with schedules
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
| 3 | *"Ammar receives online payments from PAYFAST, an online gateway on the website; we use that money for personal saving. I want that money in a savings section of the accounts module: where the money sits, with clear attachment plus recon method, plus how that money is spent; a logic for how we manage our savings — expense calculation, save-for-a-target, recurring cost such as subscriptions for me and Ammar both. A build better than what I said. Ammar is currently funding the marriage and our new car, so it should have a calculation of assets and liabilities too."* | A **second book, the Savings book**, with the same two-person audience and its own chart of accounts: accounts (the Payfast payout account, each owner's bank, cash), inflows, spend by category, a **subscriptions register per owner** (next due, annualised cost, detected from history), **targets** (amount, saved so far, monthly need, ETA at the current pace, funded by whom), an **assets and liabilities register** with valuations → net worth per owner and joint, reconciliation with attachments. Payfast money is Groovy revenue first (a prepaid web order), a Payfast receivable, then a **payout that posts on both books** in one document. **Later the same day, on the payouts:** *"the payment comes in on weekdays, daily; sometimes days are skipped."* So a payout is ONE document per payout day, a weekday with none is a normal state, and the calendar and the concern logic learn the rhythm — a gap past the usual is a watch, then a concern. | §8, §9, §10, §17 |
| 4 | *"Nothing — all done on paper, no logic to it. The build should be cash-logic based; every rupee is precious. Terms are the key, as we manage debt on our end, so it's the most important logic."* (vendors, terms, who pays) | Terms live on the party with history and drive three things: the due date on every bill, the **pay-day list** (Wed/Sat) and the cash calendar's outflows. Credit limits, overdue and an unfunded pay day are the first three lines of the concern logic. Every payment is from a named holder and the holder cannot go below zero. | §4.2, §6, §17 |
| 5 | *"We have payroll records of the past 3–4 months on Excel: advances + loans + salary + deductions."* | A **payroll importer** reads that sheet in the browser (vendored SheetJS, the Marketing M7 pattern), previews, and writes accruals, payments and the employee ledgers' openings, idempotent by employee + month. | §14, M6 |
| 6 | *"Asghar is not an employee, he gets no salary. He is part of Groovy: he costs us less to print from him because we helped him build his own printing unit, but we consider it our own. He needs proper accounts from day one."* | **Overruled the same day** — Afnan: *"Asghar is the same as other vendors, he has terms we agree on, treat him the same, no special demand for Asghar."* So he is a `vendor` with role `printing`, the terms agreed with him, a rate card seeded from the printing rate master, and his approved printing bills become `ma_bill` on his ledger exactly as an external printer's do. No affiliate kind, no investment account, nothing special. | §3 #12, §11 |
| 7 | *"We both manage the factory; if I don't have cash Ammar steps in. Groovy vs savings have a relationship: around 1.5 million is borrowed from savings when the business required it; it is paid back, at slow speed."* | **Cash with Afnan / cash with Ammar are company holders.** The ₨15 lac is a **loan from the owners' savings**: one document per draw or repayment posts a liability on Groovy's book and an asset on the Savings book; the outstanding shows on both overviews; a Payfast payout repays it first (default, tabled). | §4.1, §10 |
| 8 | *"It has to be something I build with logic, then a one-go print. Proper vendor management with entry logic set up from day one, so I can do it at my own pace and the build does not slow me down. Well calculated — 20 million of cash a month to be accounted for."* | **Entry at your own pace**: history can be entered back to 1 July 2026 until the owners close that quarter; a vendor is created inline from any form; a PO is optional; quick forms for the four daily documents; importers for payroll, Store Accounts and PostEx; refusals only for what cannot be true. Statements print in one go for any range. Whole rupees, bounded reads, rollups. | §14, §2 |
| 9 | *"Quarter to quarter; monthly is too soon. Three months is the closing period, but monthly closing where it is required."* | **Quarterly hard close** on a fiscal year from 1 July (Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun) with locks; **monthly soft close** on demand (a checkpoint and a warning on backdating, no lock) for payroll months and monthly-billed vendors. | §20 |
| 10 | *"Tax option inside the build: a lot of entries do have taxes, some don't."* | A **tax block on every document** — kind (sales, services, withholding, none), rate, amount, inclusive or exclusive — defaulted from the party and the item, confirmed by the person; "no tax" is a choice, never an absence. Tax accounts, a quarterly tax page. Rates are settings the accountant fills; the plan invents none. | §12 |
| 11 | *"It should communicate with me with money: how much is spent where, and should I be concerned spending this much here or not. The money should speak to me visually."* | **The concern logic** (§17): every line of spend — category, vendor, courier cost, salaries, subscriptions — carries a state (fine / watch / concern) from three tests (its own baseline, its budget, its terms) and a sentence in plain words with the basis. A **spend map** sized by rupees and tinted by state, the **cash calendar**, and "of every ₨100 in, where it went". | §17, §16 |

## 0b. The brief of 28 Sept 2026 — a whole world of money, not a module

Afnan, after seeing the specimen (verbatim, two messages): *"All the
questions you are asking should not be questions but logics that should be
answers inside the build; the model should be logical enough to do proper
accounts with variable situations; keep data stored in this account tab
secure; the data should be backed up; PDF logic wherever it is a must;
logic to print ledger, edit them, send them by link; this should be the
best well-calculated build of Groovy Operations with the most
sophistication in it."* And: *"This is not a plain old accounting module,
it is a whole world of my money … I think you're 5% there … a complete
working section which feeds on countless amounts of money logic connected
to Groovy Ops … study, understand the situation, document it > understand
what Groovy Ops can actually do > where actual money sits > label money
with everything > let's calculate this whole Groovy factory > fixed costs
> rent > food > vendor > petty > transport > advances > everything that is
there; if something is broken or is not currently in the phase to collect
money data we plan it inside the build."* On the UI: *"too bulky, not
clean … logical things should be mapped correctly, what goes where … 80%
on desktop … I don't want everything on the main view."*

What v4 does with each sentence:

| Ask | Where |
|---|---|
| No open questions — logic with a default and a path for the other case | §23, rewritten: every former question is a rule |
| Proper accounts under variable situations | §6 (the engine refuses only the impossible), §26 (commitments), §27 (labels), §28 (the coverage register names what is not captured yet) |
| Secure | §29 |
| Backed up | §30 |
| PDF everywhere; print the ledger; edit; send by link | §31 |
| Study what Groovy Ops can do; where money sits | §25 (the money map, module by module, from the code) |
| Label money with everything | §27 |
| Calculate the whole factory: fixed, rent, food, vendors, petty, transport, advances | §26 (the cost register) |
| Plan the gaps inside the build | §28 |
| The UI: what goes where, desktop first | §16, rewritten as a page map |

Method, in the order he set it: the code was read for money (§25), the
holders were listed (§4.1), the labels were defined (§27), the factory's
costs were listed line by line with the state each is in today (§26), and
every gap became a build item with a milestone (§28).

## 1. Verified findings this plan rests on (read from the code)

Each row was read with file:line references and the load-bearing ones
re-checked by grep in this session (27 Sept 2026).

| Source | What exists today | What is missing (the gap v3 closes) | Where |
|---|---|---|---|
| **PostEx** `postex_orders` | Per parcel COD, fees and tax, reversal fees, `upfrontPayment(+Date)`, `reservePayment`, **two CPR numbers per parcel — `cprNumber_1` is the upfront receipt, `cprNumber_2` the reserve receipt** — with `cpr1Date`/`cpr2Date`, `settle` and `settlementDate`. The CPR tab already groups parcels by `cprNumber_1\|\|cprNumber_2` and dates a group `settlementDate\|\|cpr1Date\|\|cpr2Date`. | **Nothing records that the CPR's cash was collected, by whom, or when**; the COD tab and the CPR tab compute "net" differently; no courier ledger. | `netlify/lib/postex-core.js:112-114, 199-262`; `js/fulfillment.js:958-989` |
| **Other couriers** | Fixed courier rows for `BLUE-EX`, `TCS`, `BYKIA` (per brand) on the Daily Performance page, with a colour each. | No data feed, no statement, no receivable for any of the three; **Blue-Ex and TCS balances exist only in Afnan's head and their statements.** | `js/fulfillment.js:27-37, 249` |
| **Payfast** | **Zero occurrences of "payfast" in `js/`, `netlify/` or `index.html`.** | The gateway that pays the owners is invisible to the app. | grep, 27 Sept 2026 |
| **Shopify** `shopify_orders` | Order total, `financial_status` (at first sync), line SKU/qty/price, discount codes. **Written once, never updated.** | **No `gateway` field** (COD vs Payfast cannot be told apart), refunds after the first sync invisible, no payouts. | `netlify/functions/shopify-order-sync.js:87-88, 111-175, 139` |
| **Store Accounts** `acct_entries`, `acct_vendors` | One ledger shape, nine types, integer rupees, local dates, `posted/pending/void`, purchase `lines[]` with rates, FIFO aging, vendor terms `cash/credit/monthly/weekly`, a rate card derived from lines, `edits[]` history, month-close checkpoints, effects in one function `_acctEffect`. Two money accounts only: `cash` and `mcb`. | Store vendors only; no purchase orders, no receipt matching, no allocation of a payment to a bill; the client loads only months after the last close (capped at 5,000); Reset deletes the ledger. | `js/store-accounts.js:71-82, 223-246, 257, 311-336, 1363, 2908` |
| **Gate passes and returns** | `dest` free text (chips for FebKnit, Al-Hamd, Al-Nisa, Aqib Sublimation, JR Traders, Rahim Gul, Khursheed), `gpReason`, sizes and units sent; `returns` record `sentQty, returnedQty, cumulative, shortage`. | **No vendor record, no rate, no bill** for stitching, washing, dyeing or embroidery. | `js/gatepass.js:98-106, 550-623, 664-666` |
| **Fabric in** `fabricin` | Supplier (free text), type, gsm, colour, rolls, kg or metres, QC per roll. | **No rate, cost, invoice or purchase order.** | `js/fabric.js:794` |
| **Production** `pos.*`, `bstock_*`, `stock_transfers` | Pieces by PO, article and size at every mile. | **No money anywhere**; no cost per PO or per piece. | `js/production.js:155-180, 284-295, 636-664` |
| **Embellishment** `printing_billing`, `printing_jobs` | `netPayable = finalApprovedQty × ratePerPiece − materialCostImpact`; a per-piece rate master for 183 article codes. | A payable with **no payee field**; a bill for Asghar's printing is computed the same way as an external printer's, with nothing recording what is owed to him or paid; no paid state. | `js/embellishments.js:59-152, 3368-3400, 3716` |
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
| **One party master** | Vendor, customer, courier, gateway, employee, owner, bank: ONE record with a kind, what it provides, terms, a rate card and a ledger. A vendor typed as a string anywhere is a defect the migration ends. |
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
| **Every rupee labelled** | A posting carries the labels of §27 — holder, party, category, cost centre, kind, PO, channel, source, who — or it goes to suspense and the Unlabelled queue, which must be empty before a close. |
| **Nothing is deleted, everything is backed up, everything prints** | No client delete on any `ma_*` collection (void only); a nightly export, PITR and the owners' own copy (§30); an append-only audit trail (§29); a PDF of every document and page, edits with history, and a share link that expires (§31). |

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
| 9 | **Payfast** | Prepaid web orders are Groovy revenue (4011) and a **1125 Receivable — Payfast**; a payout is ONE document (`ma_payout`) that clears the receivable on Groovy's book and lands in the Savings book's Payfast payout account. On Groovy's side the payout is **loan repayment first** (2110), then drawings per owner. Payfast's fee is a line on the payout. **Payouts arrive on weekdays, daily, with some days skipped** (Afnan), so `ma_payout` is one document per payout day (`payfast_<date>`), a weekday with none is normal until the gap passes the learned usual, and the calendar expects one every weekday at the learned median. | "That money is used for personal saving" — but it is sales revenue first, and taking it out is either repaying what savings lent or a drawing. | drawings first; a fixed split; a different receiving account |
| 10 | **The Savings book** | A second ledger (`ma_sv_*`) with its own chart (§4.5), accounts, inflows, spend by category, a subscriptions register per owner, targets, an assets-and-liabilities register with valuation history, net worth per owner and joint, reconciliation with attachments. One shared book; every entry tagged `afnan`, `ammar` or `joint`. | "A build better than what I said." | two separate books, one per owner |
| 11 | **The loan** | `ma_loan`: opening (~₨15 lac, split tabled), draws (savings → a Groovy holder) and repayments (a Groovy holder → a savings account), each ONE document posting 2110 on Groovy's book and S1040 on the Savings book; no interest by default; the outstanding on both overviews; a repayment pace on the Savings page. | "Around 1.5 million is borrowed … paid back at slow speed." | interest; per-owner sub-loans |
| 12 | **Asghar** | **A vendor like any other**: kind `vendor`, role `printing`, the terms agreed with him, a rate card seeded from the printing rate master (Ammar's file — read, not edited), his approved `printing_billing` becoming an `ma_bill` on his ledger exactly as an external printer's does (qty ≤ `finalApprovedQty`, rate flagged off his card), payments from a named holder, a statement and aging like every vendor's. No affiliate kind, no investment account, no deduction from his rate. | Afnan, 27 Sept, overruling the first draft: "Asghar is the same as other vendors, he has terms we agree on, treat him the same, no special demand for Asghar." | — |
| 13 | **Tax on every document** | `tax:{kind: sales\|services\|withholding\|none, rate, amount, inclusive, ref?}`; defaults from the party (`tax.regime`, `withholdingPct`, NTN/filer) and the item; the form shows the block and the person confirms; accounts 2120 sales tax payable, 1160 input tax, 2130 withholding payable; a quarterly tax page. **Rates are blank settings until the accountant fills them.** | "A lot of entries do have taxes, some don't." | — |
| 14 | **Periods** | Fiscal year from 1 July; **quarter close = hard lock**; **month close = soft** (checkpoint, warning on backdating, no lock), taken where a month matters (payroll, monthly-billed vendors, the Store's month). Reopen by an owner with a reason. | "Three months is the closing period, monthly where required." | monthly hard close |
| 15 | **Go-live and history** | Live from **1 Oct 2026** (Q2). Q1 (1 Jul–30 Sep 2026) stays open for **backfill at your own pace**, documents dated in it marked `historical`, until the owners close it. Openings on 1 July 2026. | "Entry logic from day one so I can do it at my own pace." | opening balances on 1 Oct and no history |
| 16 | **Payroll import** | The Excel sheet is read in the browser (vendored SheetJS), previewed, and written as accruals + payments + employee-ledger openings, idempotent by employee + month; unknown employees are offered, never invented. | "3–4 months on Excel." | typing them |
| 17 | Party master | One `ma_parties` for every kind; a vendor declares what it provides; gate-pass destination and fabric supplier become party picks. | v2 §3.3. | — |
| 18 | Rate cards, terms, history | Per party, per item or service, history kept; terms with `termsHistory[]`, older bills keep their terms; `history[]`/`edits[]` on every record and document. | v2 §3.4–5, 18. | — |
| 19 | Purchase orders, receipts, bills, payments | As v2 §3.6–9: PO optional and assignable to production POs; fabric-in and gate-pass returns are receipts; bills matched three ways with `invoiceNo` unique per vendor; payments allocated (owner picks, default FIFO), from a named holder; retention. | — | — |
| 20 | Sales | Warehouse sales → invoices + collections; Shopify orders → invoices per order **with the gateway deciding the receivable** (COD → the courier; Payfast → 1125); gate sales → invoice + receipt. Needs `gateway` on the order sync (proposal to Ammar). | — | — |
| 21 | Costing | Standard-then-actual per production PO, FIFO across POs, a missing leg named; each printing vendor's bill is the embellishment leg at that vendor's card rate. | v2 §3.11. | average cost |
| 22 | Chart of accounts | Seeded (§4.1), typed, codes never reused; the Savings book has its own (§4.5). | — | — |
| 23 | Charts and learning | HTML charts, validated `--chart-*` palette, table twins; deterministic statistics with a basis; the concern logic is rule-based from M3 and learned from M10. | — | — |
| 24 | Not built, named | Multi-currency; tax filing; bank or gateway API feeds; an accountant role; AI Q&A; consolidation; forecasting beyond 90 days; a vendor portal; interest on the owners' loan. | Each is a phase. | — |

## 4. Master data

### 4.1 `ma_accounts/{code}` — Groovy's chart of accounts (seeded, editable, typed)

`{code, name, type (asset|liability|equity|revenue|cogs|expense|suspense),
kind, holder?, parent?, owner?, active, order, history[]}`. `kind:'money'`
accounts are the **holders**; `holder` names the person or place.

| Range | Accounts |
|---|---|
| Money (holders) | **1010 Cash — store drawer (Raees)** · **1011 Cash — with Afnan** · **1012 Cash — with Ammar** · **1020 MCB current** · 1030… other banks and wallets (placeholders) · **1040 Warehouse till (Umair, not yet handed over)** · **1050 Runner floats** · **1060 TCS account (credited at 90 days)** |
| Receivables | 1110 Customers (warehouse pay-later) · **1120 PostEx — delivered, not yet on a CPR** · **1121 PostEx — CPRs issued, not yet collected** · **1122 TCS — delivered, inside 90 days** · **1123 Blue-Ex (legacy)** · **1124 Bykea** · **1125 Payfast (prepaid, not yet paid out)** · 1140 Employees (advances, loans) · 1150 Vendor advances · **1160 Input tax**  · **1170 Security deposits (rent, utilities)** |
| Stock and assets | 1210 Fabric · 1220 Trims · 1230 Work in progress · 1240 Finished goods · 1310 Fixed assets |
| Liabilities | 2010 Payable — vendors · 2020 Retention held · 2040 Payable — salaries · 2050 Payable — runners · 2060 Payable — creators · 2070 Customer deposits · **2110 Loan from owners' savings** · **2120 Sales tax payable** · **2130 Withholding tax payable** · 2140 Other loans |
| Equity | 3010/3011 Capital — Afnan / Ammar · 3020/3021 Drawings — Afnan / Ammar · 3090 Retained result |
| Revenue | **4010 Online — COD** (sub-accounts per courier) · **4011 Online — prepaid (Payfast)** · 4020 Warehouse · 4030 Fabric & garment sales · 4040 Discounts given · 4050 Refunds & returns · 4090 Other income |
| Cost of goods | 5010 Fabric · 5020 Stitching · 5030 Embellishment · 5040 Trims · 5050 Washing & dyeing · **5060 Courier fees & tax** · **5070 Reversals & returns** · 5080 Packaging · 5090 Cost variance |
| Expenses | 6010 Salaries · 6020 Marketing & PR · 6030 Utilities · 6040 Rent · 6050 Maintenance · 6060 Fuel & transport · 6070 Office · **6080 Bank & gateway charges** · 6090 Depreciation · **6100 Subscriptions (company)** · **6110 Taxes & levies (non-recoverable)** · **6120 Food & refreshments** · **6130 Staff welfare & medical** · **6140 Licences & professional fees** · **6150 Insurance** · 6190 Other |
| Suspense | 9010 Unclassified in · 9020 Unclassified out · 9030 Reconciliation differences |

### 4.2 `ma_parties/{id}` — one record per vendor, customer, courier, gateway, employee, owner, bank

```
{ kind: vendor|customer|courier|gateway|employee|owner|bank,
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
  courier|gateway: {cycle: cpr|account|legacy|manual|weekdays,
             cprDays?: [2,5],            // PostEx: Tuesday, Friday
             weekdaySkips?: true,        // Payfast: daily on weekdays, some days none
             payoutAccount?: 'S1020',    // Payfast: lands in the Savings book
             collectBy?: 'afnan',        // who usually collects, in cash
             collectLagDays?: 1,
             creditDays?: 90,            // TCS: delivery → the TCS account
             confirmBy?: 'raees',        // Bykea: lands in the drawer
             tolerancePct, feeCard:[{kind:delivery|reversal|tax|cod_fee, rate|pct, validFrom}],
             openingStatement?: {date, amount, attachment}},   // Blue-Ex
  employee: {employeeId (HRM), schedules:[{kind:advance|loan, monthly, from, balance}]},
  owner:    {username, holderAccount: 1011|1012},
  bank:     {accountCode},
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
madConcern:3, minAmount, budgetWatchPct:90, payoutGapWatch:3, payoutGapConcern:5}, learning:{…}}` — every
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

### 4.6 `ma_commitments/{id}` — the cost register (§26)

`{kind: fixed|variable|running|people|financing|one_off|tax, name,
party?, account, costCentre, cadence: monthly|weekly|quarterly|yearly|
per_parcel|per_piece|variable, dueDay?, dueWeekday?, amountExpected,
amountLearned:{median, n, window}, holder, evidenceRequired, active, from,
to?, history[], lastDoc:{kind, id, date}}`. The calendar and the concern
logic read it; the month checklist lists every active commitment without
a document by its due day.

### 4.7 `ma_assets/{id}` — Groovy's asset register

`{name, kind: machine|computer|fixture|vehicle|deposit|other, cost, date,
party?, life (months), method: straight_line, salvage, costCentre, active,
disposedAt?, valuations[]}`; the close posts the month's depreciation
(6090 ↔ 1310); a deposit (1170) is returned by a receipt.

### 4.8 System collections

`ma_audit` (append-only, §29) · `ma_backups` (one row per nightly run,
§30) · `ma_shares` (share links, §31) · `ma_counts` (a holder's count:
counted, book, difference, by, at) · `ma_feedback` (§18).

## 5. Documents and their lifecycle

| Document | Collection | Made from | States | Posts |
|---|---|---|---|---|
| **Courier statement (CPR)** | `ma_cpr` | **derived nightly** from `postex_orders` (one per CPR number; `kind: upfront\|reserve`); typed for TCS, Blue-Ex, Bykea with an attachment | issued → collected → reconciled · disputed | 1121 CPRs issued ↔ 1120 delivered (PostEx); fees and tax ↔ 5060; reversals ↔ 5070 |
| **Collection** | `ma_collection` | the form: CPRs, amount, holder, date, receipt photo; who collected | pending (another person's hands) → posted · void | holder ↔ 1121 (or 1122/1123/1124); a difference ↔ 9030 with a reason |
| **TCS credit** | `ma_cpr` kind `account` | TCS's statement (typed, attached); the calendar expects it at delivery + 90 days | expected → credited · disputed | 1060 TCS account ↔ 1122 |
| **Transfer between holders** | `ma_transfer` | the form; a bank withdrawal or deposit; a TCS withdrawal | pending (until the receiver confirms) → posted · void | to-holder ↔ from-holder |
| **Payfast payout** | `ma_payout` | the form, one per payout day, with Payfast's statement line attached (weekdays, daily; a skipped day is normal) | posted · void | Groovy: 2110 then 3020/3021 ↔ 1125; 6080 fee. Savings: S1020 ↔ S1040 then S4011 |
| **Owner loan draw / repayment** | `ma_loan` | the form | posted · void | Groovy: a holder ↔ 2110. Savings: S1040 ↔ a savings account |
| Purchase order | `ma_po` | the form; a production PO's needs; a gate pass | draft → sent → partly received → received → closed · cancelled | nothing (a commitment) |
| Receipt | `ma_receipt` | fabric-in + rate · vendor return on a gate pass · printing QC approval · store receive | posted · void | inventory or WIP ↔ accrued payable |
| Vendor bill | `ma_bill` | the form (invoice required above a threshold); a metered vendor's month; **an approved printing billing (Asghar's or an external printer's)**; Store Accounts purchase (until M8) | draft → posted → partly paid → paid · void | accrued payable ↔ 2010; tax ↔ 1160/2130 |
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
From v4 a document also carries the labels its postings inherit
(`category`, `costCentre`, `kind`, `channel`, `tags[]`, §27), and a
**Count** (`ma_counts`) and a **Commitment** (`ma_commitments`) are
documents in their own right (§4.6, §4.8).

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
| **One payout per Payfast payout day** (a second for the same date is refused unless the first is void); a payout dated on a weekend is flagged, never refused — they arrive on weekdays | refuse · flag | payout |
| Loan repayment ≤ outstanding; a draw names the savings account it left and the holder it reached | refuse | loan |
| A line's item is on the vendor's `provides` list | flag | PO, bill |
| A line's rate equals the current card rate (± `ratePct`) | flag with the card rate; refuse if no reason when over the tolerance | PO, bill |
| A rate with no card entry at all | flag ("no rate card for this item — add it?") | PO, bill |
| Receipt qty ≤ ordered × (1 + `qtyPct`) | refuse | receipt |
| Returned pieces ≤ pieces sent on the gate pass | refuse | service receipt |
| Bill qty ≤ received qty on the referenced receipts | refuse | bill |
| **A printing bill's qty ≤ `finalApprovedQty` on the billing; rate = that printer's card** | refuse · flag | printing bill (Asghar's or an external printer's) |
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
· on a CPR · collected · fees; a customer's: invoiced · collected.

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

**Payfast (`cycle: weekdays`, a `gateway` party).** Afnan: *"the payment
comes in on weekdays, daily; sometimes days are skipped."* A prepaid web
order is revenue and a receivable in 1125 the day the sync sees it; a
payout is an `ma_payout` per payout day, matched to Payfast's statement
line, clearing the receivable and landing in the Savings book (§10). **A
weekday with no payout is a normal state, not a missing document** — the
rollup learns the median payout per weekday, the share of weekdays skipped
and the longest gap seen, the calendar expects a payout every weekday at
that median with the skip rate widening the band, and the concern logic
speaks only when a gap passes the usual (`payoutGapWatch` 3 weekdays →
watch, `payoutGapConcern` 5 → concern: *"No Payfast payout since Tuesday —
four weekdays; the usual gap is one. ₨2.4 lac is waiting in the
receivable."*). Weekends are never expected and never alarmed.

**The courier page** (`ma-couriers`, specimen *Couriers*): tiles (in
transit with PostEx · CPRs waiting to be collected · collected this month ·
TCS due inside 90 days and the TCS account · Blue-Ex still owed), the CPR
table (no · day · parcels · COD · fees · net · collected by / when ·
state), the Tue/Fri collection rhythm with the next expected amounts, fees
and reversals by month, and one card per courier with its terms, Payfast's weekday rhythm beside them.

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
  One document per payout day: Payfast pays on weekdays, daily, and skips
  some, so a weekday with no payout is normal until the gap passes the
  learned usual (§8, §17) — never a missing document to chase.

## 11. Asghar — a vendor like any other

The first draft of v3 gave Asghar a party kind of his own (`affiliate`,
with an investment account for what Groovy put into his unit). **Afnan
overruled it the same day:** *"Asghar is the same as other vendors, he has
terms we agree on, treat him the same, no special demand for Asghar."*
So:

- He is a `vendor` party with role `printing`, the terms agreed with him
  (mode, days, pay days — edited with history like anyone's), and a rate
  card seeded from the printing rate master (`PRINTING_RATE_MASTER`, Ammar's
  file — read, not edited) and editable with history like any card.
- **An approved `printing_billing` becomes an `ma_bill` on the printing
  vendor's ledger** — his or an external printer's, the same adapter (M3),
  the payee joined through the job's `vendorName/assignedTo` — with qty
  refused above `finalApprovedQty`, the rate flagged off the card, and
  `materialCostImpact` as a negative line. Payments to him are `ma_payment`
  from a named holder. His ledger, statement and aging are a vendor's.
- **Nothing else is built for him.** No affiliate kind, no investment
  account, no deduction from his rate. If what Groovy contributed to his
  unit is ever to be on the books, it is a journal an owner writes on the
  day (a loan to a vendor, or a gift), not a structure in the party master.

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
(stitching, washing, embellishment — each printing vendor at its own card rate, Asghar
included — per piece), the trims issued (× rate) and the overhead
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
| Embellishment billing | M3 adapter | an approved billing → `ma_bill` on the printing vendor's ledger (Asghar's or an external printer's), the payee joined through the job's `vendorName/assignedTo` |
| Payroll (`payroll_runs`, the Excel sheet) | M6 | the importer; accrual adapter; payroll payment documents; `paidVia` proposed on the slip |
| Shopify | M5 | invoices per order, the receivable by gateway; proposals to Ammar: `gateway` on the sync, a 14-day refresh |
| Production (`pos.*`) | M7 | units for costing; no change to the screens |

`js/shared.js` gains the nav entries and one `renderPage` line;
`js/gatepass.js` and `js/fabric.js` gain party picks and rate fields
(cross-track, coordinated); `js/store-accounts.js` and
`js/warehouse-sales.js` are re-pointed in M8; `netlify.toml` gains the
rollup schedule.

## 16. The UI — what goes where, and why (desktop first; 28 Sept 2026)

Afnan: *"too bulky, not clean; logical things should be mapped correctly
— what goes where; 80% on desktop; I don't want everything on the main
view."* This section is the page map. The specimen
(`scratchpad/master-accounts-specimen.html`, the artifact) is rebuilt to
it; the visual rules at the end are what the rebuild follows, and §16.5
says where they came from.

### 16.1 The navigation — ten pages, one Record button

| Page (`ma-*`) | The one question it answers | Above the fold (desktop) | Below, or a drill-down |
|---|---|---|---|
| **Today** `ma-overview` | *Where is the money right now, and what needs me?* | four figures in one row — **cash in hand** (the hero), in this month, out this month, owed to us less we owe; **Needs attention** — three lines, worst first, or *nothing to worry about*; then, side by side, **cash by holder** as ONE table with its total and the balance line with its 30-day projection | the 30 days as a seven-column strip, one row per week, only event days carrying text (pay days, CPR days, a short day as a dot); the spend list; aging both ways as two short tables. Nothing else — revenue by channel, the biggest vendors and "of every ₨100" live on Reports. |
| **Money** `ma-money` | *What does each holder hold, and is it reconciled?* | the holders table: balance · last count · pending confirmations | a holder's page: statement, transfers in and out, confirm, count, the MCB import and reconciliation |
| **Money in** `ma-in` | *What is owed to us, and what came in?* | tabs — **Couriers** (CPRs to collect, in transit, TCS, Blue-Ex, Bykea) · **Online** (orders by gateway, Payfast payouts) · **Warehouse & gate** (sales, pay-later, collections) · **Customers** (aging) | a CPR, a collection, a payout, an invoice; a courier's fee card |
| **Money out** `ma-out` | *What do we owe, what is due, what did we pay?* | tabs — **Pay days** (the Wed/Sat list) · **Bills** (match status, the review queue) · **Purchase orders & receipts** · **Commitments** (rent, utilities, subscriptions, insurance — §26) · **Payroll & people** · **Petty & floats** | a bill, a payment, a PO, a commitment, a pay run |
| **Parties** `ma-parties` | *Who do we deal with, and where do we stand with each?* | one list, filterable by kind; balance and last activity per row | the party page: terms (history), rate card (history), open POs, the ledger with a running balance, statement, aging, attachments, share links |
| **Ledger** `ma-ledger` | *Every posting, one shape* | the ledger table with filters (range, book, holder, account, party, category, cost centre, PO, source, status) | a document; its edit history; journals; the Unlabelled queue |
| **Costing** `ma-costing` | *What does a piece cost, and what do we make on it?* | cost per PO (legs: fabric, CMT, wash, embellishment, trims, packaging, courier, overhead) | a cost sheet; margin by article and channel; missing legs named |
| **Savings** `ma-savings` | *The owners' book* | the accounts and the loan outstanding; targets with their ETA | spend by category, subscriptions per owner, assets and liabilities, net worth, reconciliation, the loan ledger |
| **Reports** `ma-reports` | *The statements* | the P&L for the period against the last one and the budget | balance sheet, cash flow, aging both ways, revenue by channel, "of every ₨100", tax, budgets, insights, exports |
| **Close & audit** `ma-close` | *Is the period done, and who did what?* | the quarter checklist; the month soft close; backups (the last run) | reopen; the audit trail; Download the books; settings (the charts of accounts, holders, pay days, tolerances, tax rates, the payout rule, cost centres, thresholds) |

**Record** — one button in the page header on every page — opens the
document picker: Collection · Transfer · Bill · Payment · Purchase order ·
Receipt · Journal · Payout · Loan draw or repayment · Savings entry ·
Commitment · Count. Each form is the same on every page; the page only
prefills (a party page prefills the party). There is no "+ Journal entry"
on the overview and no button per page.

Retired from the v3 sidebar: Payments, Sales, People, Loan, Tax, Budgets,
Insights and Settings as top-level pages — each is a tab or a drill-down
above. Twenty entries became ten.

### 16.2 The page map — tab → what it shows → what feeds it → where the detail is

| Page | Shows | Reads | Writes (through Record) | Detail |
|---|---|---|---|---|
| Today | holders, concerns, this week | `ma_postings` (balances), `ma_commitments`, `ma_cpr`, `ma_bill`, `ma_payout`, `ma_backups`, `ma_feedback`, the rollups | nothing directly | every line links to its page |
| Money | holders, confirmations, counts | `ma_postings` by holder, `ma_transfer` (pending), `ma_counts` | transfer, count, MCB import, confirm | a holder |
| Money in | CPRs, collections, payouts, invoices, customers | `ma_cpr`, `ma_collection`, `ma_payout`, `ma_invoice`, `ma_receipt_in`, `postex_orders` (linked), `wh_sales` (adapter) | collection, statement, payout, invoice, receipt | a CPR, a collection, an invoice |
| Money out | pay days, bills, POs, receipts, commitments, payroll, petty | `ma_bill`, `ma_payment`, `ma_po`, `ma_receipt`, `ma_commitments`, `payroll_runs` (adapter), `acct_entries` (adapter until M8) | bill, payment, PO, receipt, commitment, pay run, float | a bill, a payment, a PO |
| Parties | the list | `ma_parties`, balances from the postings | a party (inline from any form), terms, a rate | a party |
| Ledger | the postings | `ma_postings`, every document by reference | journal, edit, void | a document |
| Costing | cost sheets | `ma_postings` by PO, `pos`, `ma_receipt`, `ma_bill`, `ma_settings.overheadPct` | nothing | a cost sheet |
| Savings | the Savings book | `ma_sv_*`, `ma_loan`, `ma_payout` | savings entry, valuation, target, subscription, loan | a target, an account |
| Reports | the statements | the rollups, `ma_postings`, `ma_budgets`, `ma_insights` | budget accept, feedback | a report |
| Close & audit | periods, backups, audit, settings | `ma_closes`, `ma_backups`, `ma_audit`, `ma_settings`, `ma_shares` | close, reopen, settings, export | — |

Where a document is **stored** is §5 (one collection per document kind,
the id minted with the number); where its **postings** are is §7
(`ma_postings`, one line per account movement, labelled per §27); balances
are never stored (§2). A page never reads a collection the table above
does not name — that is "the logic to how data is stored and how a tab
results" in one place.

### 16.3 The phone rule

The five buttons: **Today · Money in · Money out · Ledger · More** (Money,
Parties, Costing, Savings, Reports, Close under More). Phone-first
actions, each one screen: record a collection at the counter (the camera
for the receipt), confirm a transfer, pay a vendor, snap a bill, count a
holder. Desktop-only depth: the ledger's full filter row, costing, reports,
settings, the calendar grid (a list on the phone).

### 16.4 The visual rules the rebuild follows

- **Spacing**: 4 · 8 · 12 · 16 · 24 · 32 · 48, nothing between the steps
  (Polaris and Carbon both stop there); page gutter 32 (24 under 1200px);
  sections 32 apart; title to content 12; rows 8; content
  `max-width:1100px`; table cell padding 6 (Polaris's own token).
- **Type**: page title 22/600; section title 15/600, sentence case, no
  rule under it; body and table text 14/400/1.4 — the app's own body size,
  which the v3 specimen never rendered once; the hero number 28/600 with
  `tabular-nums` and `letter-spacing:-.01em`; secondary numbers 20/600;
  money in a table 14/500; labels 12/500 `--muted`, sentence case — **no
  uppercase and no letter-spacing anywhere in the module** (the v3 overview
  carried 49 uppercase labels); meta 13/400 `--muted`; 11px for axis ticks
  only; nothing under 11.
- **Figures**: `font-variant-numeric:tabular-nums` on every money column
  and tile; the unit once, in the head; right-aligned; whole rupees.
- **Stat tiles**: only on Today and on a party page; at most **four**, in
  one row, `repeat(4,1fr)` and never `auto-fill` (the v3 grid left three
  empty cells); unbordered — a stat row on the surface, stats divided by a
  1px `--border` left rule with 24px padding; label, number, one sub-line
  of at most eight words; no tints, no sparkline. A list is a table.
- **Concerns are lines**: under *Needs attention · N* an 8px dot in
  `--accent-urgent` or `--accent-warning`, one 14px sentence with its
  numbers at 500, the action as a trailing `--link-accent` link; no box,
  no icon disc, no bold lead, no fill; three shown, *and N more* opens the
  rail; **fine is silent**, and a reconciled state is header meta. In a
  table a state is the dot or a 12px word in the state colour; a filled
  pill only for `void`. **One banner or none** on a page, only for what
  needs action now — never a stack.
- **Tables**: 40px rows (36 compact); header 12/500 `--muted`, sentence
  case, over one 1px `--border`; `--soft` separators and a hover row; the
  date `white-space:nowrap` at 88px; money right-aligned in fixed widths,
  the balance at 500; only the description wraps — wrap, never truncate;
  the source as 13px muted text, not a pill; totals 600 over a top rule; a
  sticky header and a fixed first column on a wide table; paginate past 50
  and say the scope (*2,184 postings · 6 sources*); a full-width table
  sits on the surface under a section title, **never inside a card**.
- **Charts**: one per section, at most two per page above the drill-down,
  full width or two-thirds with the numbers beside; plot 240px (200 min);
  bars 32–48px with gaps of at least half a bar; four gridlines, 11px
  ticks; no legend for one series, an inline legend for two; data labels
  **or** a y-axis, never both; *Show as table* as a text link beneath;
  `--chart-*` only inside a plot, marks at 3:1 against the surface or
  better; no grids of charts, and never two charts of one dataset.
- **Colour**: one accent — `--dark` for the primary button and the
  selected control, `--link-accent` for links; semantic colours as dots
  and words only, never a fill, never on money except a negative;
  everything else the neutral tokens.
- **Borders, shadows, radius**: no shadows; one 1px `--border` on an
  outer container only and nothing bordered inside it (a row takes a
  `--soft` hairline; a cell takes `--surface-2` or a border, never both);
  containers 8px, controls 6px, pills only for the period segment. The
  default is **no container** — sections sit on `--bg`; a card only for a
  thing lifted as a unit: the rail, a form, an error.
- **The page header**: one sticky 56px row — the title at 22 with a 13px
  meta line (*Sun 27 Sep · MCB reconciled to 25 Sep · 41/41*) · the period
  segment (This month / Last month / Quarter / Year / a date range) ·
  **Record**, the one primary · a ⋯ overflow (Excel, PDF, settings). No
  explanatory sentences on any page.
- **Detail is a right rail**: 380px, `position:sticky`, full height, a
  `--border` on its left, the main column `minmax(0,1fr)`; it opens on a
  row, a stat, a day or a spend line and holds the detail — the basis
  text, six-month bars, terms history, the receipt. Whatever explains
  lives there or in a tooltip, never on the page. Under 1200px a
  slide-over (built up to 1440px — F27, 29 Sept 2026); on the phone a
  bottom sheet.
- **Empty, loading, failed**: loading is the app's `.gv-skel` shimmer in
  the section's shape, never a spinner; empty is one 14px muted line with
  the action as a link (*No CPR waiting · the next lands Tuesday*); a
  refused read is the app's error card naming the collection, with Retry —
  never an empty list (the Store lesson).
- **Phone**: the same order, stacked; the stat row 2×2 without borders;
  charts 180px; the calendar a list of days; tables as the app's flex-card
  rows with money right-aligned and the totals row kept; the rail a bottom
  sheet; the header's actions roll into ⋯; a cell that would truncate
  becomes a list row.

### 16.5 Where the rules came from — the outside design input

Afnan asked for *"a UI/UX expert … an agent or something from GitHub open
source"*. Two reports were produced on 28 Sept 2026, both committed beside
the specimen in `scratchpad/` and both model output, to be read as such:

- **`scratchpad/master-accounts-visual-audit.md`** — the v3 specimen **measured** in
  headless Chromium at 1440px and at a true 390px frame, not eyeballed:
  the overview's main column was **2,532px** tall (the phone's 4,356px),
  540 elements, **8 font sizes**, **82% of its text at 12px or under** and
  31 elements at 10px, 49 uppercase labels, **66 bordered boxes of which
  41 were nested**, 12 background colours, and the first chart at
  y = 1,183 — under six tiles and four alert bars. The report names the
  ten worst offenders (the six-tile grid with three empty cells; four
  alert bars; thirty 78px calendar cells with ellipsised amounts; the
  four-part card chrome; the spend map's 58px slivers beside a second
  chart of the same money; a 24-item sidebar; 190px plots in 457px cards;
  pills on the normal state; five static courier cards; two-line
  subtitles) and gives the specification above.
- **`scratchpad/master-accounts-design-systems.md`** — the rules of Shopify **Polaris**, IBM
  **Carbon** and GitHub **Primer**, read from their repositories over
  `raw.githubusercontent.com` (the API listing is gated here): the space
  scales, table cell padding 6, row heights 24–64 with 32–40 as finance
  density, tabular numbers on money, units in the header, wrap instead of
  truncate, one banner or none, one primary action in the page header,
  title metadata for the as-of line, skeletons rather than spinners, the
  empty-state copy rule, and the breakpoints.

Where the two disagreed — Carbon's table header at 14/600 against the
audit's 12/500 muted; the column at 1,100 against v3's 1,180 — the audit's
number stands, because it was measured against this module.

**The rebuilt specimen was measured the same way before the plan claimed
the rules** (headless Chromium, the same kind of probe, 28 Sept 2026;
v3's figure in brackets): Today's main column **2,299px** (2,532);
**6** bordered boxes (66); **0** uppercase labels (49); **0** text under
11px (31); the first chart at **y = 422** (1,183); **0** shadows; no text
under 2.2:1 in either theme on any of the ten pages; nothing laid out
past the right edge at 390px. Text at 12px or under is still about half
of Today's text elements — table heads, meta lines and axis ticks are
12px by the rules above — down from 82%. Every page was looked at in a
screenshot at 1440px, and Today, Money in and Money out at 390px, in
both themes. What that cannot say is how it feels in the hand; Afnan's
open is the visual test, as ever.

## 17. The money speaks — the concern logic and the visuals

**`maConcern(line, ctx)`** runs over every line of spend — a category, a
vendor, a courier's fees, salaries, a subscription — and over every
commitment, and returns `{state: fine|watch|concern, sentence, basis,
action}`. Three tests, the worst wins:

| Test | watch | concern |
|---|---|---|
| **Against its own history** (median and MAD of the last 6 months; a minimum amount so ₨2,000 never shouts) | above median + 2·MAD | above median + 3·MAD |
| **Against its budget** (the accepted one; none → no test) | past `budgetWatchPct` (90%) with days left in the month | over the budget |
| **Against its terms and commitments** (the rule-based half, live from M3) | a vendor past 80% of the credit limit; a bill due inside 3 days with the pay-day holder short; a CPR two days past its collection lag; no Payfast payout for `payoutGapWatch` (3) weekdays; a subscription due tomorrow with the account short | overdue; a pay day the holders cannot fund; a CPR a week uncollected; no Payfast payout for `payoutGapConcern` (5) weekdays; a holder below its floor; a loan repayment missed |

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
- **The spend list**: one row per category this month — the name, the
  amount, a proportional bar, the state dot, the comparison in words —
  sorted by rupees, grouped by kind (cost of goods · people · running the
  business · fixed) so the eye reads it in strokes; a click opens the
  lines. v3's area-tinted map is retired: at real sizes the small
  categories became unreadable slivers (58px, measured in the specimen
  audit, §16.5), and it sat beside a second chart of the same money.
- **The cash calendar**: 30 days from today, one cell a day, **inflows**
  (Tuesday and Friday CPRs at their expected net, TCS credits at day 90,
  pay-later customers on their due date, a Payfast payout on every weekday
  at its learned median with the learned skip rate widening the band) and
  **outflows** (Wednesday and Saturday pay-day totals from the terms,
  salaries on the payroll day, subscriptions, the loan repayment) with the
  projected holders' balance under it; a day the holders cannot fund is
  marked and named in the strip.
- **Of every ₨100 that came in** this month (on Reports, not Today): fabric, stitching,
  embellishment, couriers, salaries, everything else, saved — one row of
  proportional boxes with the numbers inside.
- Every visual has its table twin and says its window and basis.

## 18. Learning — what the app learns

Baselines (median/MAD over 6 months; seasonality once 24 months exist),
anomalies (3·MAD with a minimum amount, explained by their lines), cash
forecast 30/60/90 from the calendar and expected inflows with a band,
runway, budget suggestions the owner accepts, category-mapping suggestions,
data quality. New in v3: **the Payfast rhythm** (median payout per
weekday, the share of weekdays skipped, the longest gap seen — the
calendar's daily inflow and the gap alarm are built on it), **the CPR
rhythm** (median CPR net by weekday,
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

- New in v4: `ma_commitments`, `ma_assets`, `ma_counts`, `ma_shares`:
  owner read/write; `ma_audit` and `ma_backups`: owner read, **server
  append only** (`allow update, delete: if false`; the client writes an
  audit row through the same engine call that posts, never directly).
  Functions: **`ma-backup`** (scheduled 03:30 UTC, `exportDocuments` to
  the bucket, §30), **`ma-attach`** (authenticated Cloudinary uploads and
  signed delivery, §29), **`ma-share`** (the link endpoint, §31),
  **`ma-import`** (the owners' copy back in, §30). Every one verifies the
  caller's ID token against `isMasterAccounts()`'s two emails; the share
  endpoint alone is public, and it serves one PDF per valid token.

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
| **M0** | this plan (v4), the specimen rebuilt to §16, the two design reports (§16.5) | — |
| **M1 Foundation, cash positions & the frame** | both charts of accounts (§4.1 with 1170, 6120–6150; §4.5), holders, the party master with terms, rate cards and history, items, **`ma_commitments` entered at go-live** (§26) and `ma_counts`, `js/ma-core.js` (postings with every label of §27, validation, allocation, balances, the trial balance, the tax block, the Unlabelled queue), journals, **transfers between holders with confirmation**, the calendar (rule-based, from the commitments and the terms), **the Record picker** (§16.1), the pages Today, Money, Parties, Ledger and Close & audit (with settings), **the app's first owner-only reads** with every `ma_*` block run in the emulator, **the audit trail** (`ma_audit`), **`ma-backup` nightly + PITR + Download the books** (§30), **`ma-attach`** and **`ma-share`** with the re-lock (§29, §31), the first print variants (`ma-ledger`, `ma-statement-party`, `ma-statement-holder`, `ma-receipt`, `ma-voucher`), Excel on every table, the dashboard widget | `index.html`, `sw.js`, `shared.js` (nav + one line), `css/main.css` tokens + `.ma-` block, `netlify.toml` (the backup schedule), the bucket and PITR in the Console, rules republish |
| **M2 Couriers & collections** | `ma_cpr` derived from `postex_orders` (the rollup), manual statements for TCS, Blue-Ex and Bykea, collections with holder, attachment and the receipt PDF, COD in transit, the TCS account and its 90-day expectation, Blue-Ex's opening, Bykea pending Raees, **Money in → Couriers**, the Tue/Fri calendar entries, courier fees and reversals in the P&L | `netlify.toml` (the rollup schedule) |
| **M3 Procurement, terms, pay days & the bank** | **Money out**: purchase orders (assignable to production POs), receipts from fabric-in and vendor returns, bills matched three ways with tax, printing bills from approved `printing_billing` (Asghar's and every external printer's, each at its own card rate), **the commitments' bills** (rent, utilities, subscriptions, insurance — a commitment posting its own bill on its due day, confirmed by the payment), the review queue; payments with allocation from a holder, the Wed/Sat pay-day list, retention, credit limits; **the MCB import** with rules, charges posted, reconciliation and **subscription detection**; **the concern logic's rule-based half**; the rates on fabric-in, the gate pass and the Store receive | `js/gatepass.js` (party pick, rate), `js/fabric.js` (party pick, rate, poRef), `js/store.js` (rate on receive); the printing rate master read from `js/embellishments.js` |
| **M4 Savings & the loan** | the Savings book: accounts, entries, statement import and reconciliation, spend by category, the subscriptions register with detection, targets, assets and liabilities, net worth; `ma_loan`, `ma_payout` with the repay-then-draw rule; **Savings** (one page, the loan on it); the loan on both overviews | — |
| **M5 Sales** | invoices from Shopify orders by gateway, warehouse sales (adapter) and gate sales; the Payfast receivable; refunds; customer ledgers; **Money in → Online, Warehouse & gate, Customers**; revenue by channel and gateway on Reports | proposal to Ammar (`gateway`, a 14-day refresh) |
| **M6 People** | the payroll Excel importer, accrual and payment documents naming the holder, payslip adjustments (overtime, bonus, festival money), `wages` documents, employee ledgers (advances, loans with schedules); **Money out → Payroll & people** | proposal on `paidVia` |
| **M7 Costing** | **Costing**: cost sheets per PO with the missing legs named, WIP and finished goods at cost, COGS on sale, margin by article and channel, creators' product at cost; `ma-cost-sheet` | — |
| **M8 Absorb Store Accounts & warehouse sales** | migration (idempotent by `legacyId`), forms re-pointed, Raees's and Umair's rules carried over (own entries, edits with history, review, confirmations), the meter logic intact, the Reset retired | `js/store-accounts.js`, `js/warehouse-sales.js` |
| **M9 Reports, exports, assets & tax** | **Reports**: P&L, balance sheet, cash flow, aging both ways, "of every ₨100", the tax page; **`ma_assets` with depreciation posted at the close** (§4.7); the remaining print variants (§31) and the quarter pack | `js/print-engine.js` (the landscape option, the A5 page) |
| **M10 Learning & the money speaks** | baselines, anomalies, forecasts, budgets, the learned half of the concern logic, the spend list, insights on Reports, feedback | bell for an unfunded day and an uncollected CPR |
| **M11 Close** | the quarter checklist and lock, the month soft close, reopen, the restore drill (§30), **Close & audit** complete | — |

Every milestone ends with the standing caveat: nobody can look at it in a
browser from a session; Afnan's first open is the visual test.

## 21a. M1 as built (28–29 Sept 2026)

Nine commits: `bf09235` M1.1 the core (`js/ma-core.js`) · `1d8b3c5` M1.2
the rules · `06b9256` M1.3 the pages (`js/master-accounts.js`) · `7b4aa30`
M1.4 the PDFs · `6f2e152` M1.5a the functions (`ma-attach`, `ma-share`,
`ma-backup`, `netlify/lib/ma-server.js`) · `4057303` M1.5b their client ·
`704056b` M1.6a edits and confirmations held at the rules · `20260a0`
M1.6b the screens, the idle re-lock and the device cache · `7735410`
M1.6c the server tightening (attachments fail closed), whose client half
is `8e5fe0b`. Then the verification round's two fixes (29 Sept):
`0a0df4b` (security — V1, V2, V3, V5, V7, V8, V9, V11) and `44166f3`
(money and screens — V4, V6, V10 and the visual QA's F01–F24), then
`22cfd3e` and `c836de2` (Afnan's three calls: F26 and F27, F25). `main` has
been merged into the branch eleven times (`1dc7fa9`, `feca515`, `be22046`,
`d159f83`, `1ae7e71`, `5a36efe`, `672cf4f`, `69f5c72`, `ef7eabb`, `51cf6c3`,
`a436e8b` — the last `main` commit taken is `11bd681`); `8573391` keeps the
`ma_*` collections owner-only against main's QA-read work, which made every
other read rule admit the QA account. On 29 Sept 2026 the branch was merged
into `main` as a fast-forward, with Afnan's go-ahead. `efb75ce` names the
nightly backup in the audit trail.
CLAUDE.md "Master Accounts" is the engineering record; this section is the
plan's side of it.

### What §21's M1 row asked for, and what exists

The table is a snapshot at `704056b` (M1.6a); what M1.6b changed is in
its cells and in refinements 13 and 15 below.

| §21 M1 item | At `704056b` | Where, and how it differs |
|---|---|---|
| Both charts (§4.1 with 1170, 6120–6150; §4.5) | built | `MA_CHART`, `MA_SV_CHART`. The Savings chart is seeded; its pages are M4. Holders whose feed comes later ship switched off (1030; 1040 M5; 1050 M8; 1060 M2). |
| Holders | built | a money account IS a holder. The drawer (1010) is Store Accounts' balance until M8 (`mirrors`). |
| Party master, terms, rate cards, history | built | `ma_parties`; terms and rates changed only through `maTermsChange` / `maRateChange`, which keep history. |
| Items | built | `ma_items`, on Close & audit. |
| `ma_commitments` at go-live (§26) | built | Money out is the cost register in M1; *Record payment* prefills a Money out. |
| `ma_counts` | built | a count's book is fixed when it is recorded (M1.6a). |
| `js/ma-core.js` — postings with the §27 labels, validation, allocation, balances, trial balance, tax block, Unlabelled queue | built | `maValidate`: 56 distinct rule names (counting the unknown-document guard; M1.6b added `commitment.period` and `commitment.period_shape`). FIFO allocation exists; nothing uses it until M3. |
| Journals | built | six kinds: money out, money in, capital, drawing, opening, general. |
| Transfers between holders with confirmation | built | changed in M1.6a — refinement 1 below. |
| The calendar (rule-based) | built | Today's 30 days, from the commitments and the pay days; CPR inflows arrive with M2. |
| The Record picker (§16.1) | built | nine live kinds; Collection (M2), Bill, Payment, PO, Receipt (M3), Payout, Loan, Savings entry (M4) shown as coming. |
| Pages Today, Money, Parties, Ledger, Close & audit | built, plus Money out | eight page ids: `ma-overview`, `ma-money`, `ma-holder`, `ma-out`, `ma-parties`, `ma-party`, `ma-ledger`, `ma-close`. |
| First owner-only reads, every block in the emulator | built | `tests/rules-emulator-ma.js`, 209 checks at `704056b`; 241 at `1ae7e71`, with V3's shape checks. |
| The audit trail | built | a client row with every write; server rows for share, revoke and backup. |
| `ma-backup` nightly + PITR + Download the books | code built; the bucket and PITR are not (Console steps) | refinements 4 and 11. |
| `ma-attach`, `ma-share`, the re-lock | built | the re-lock had an open finding (security F5): M1.6b asks for the lock everywhere on an `ma-*` page, not only on navigation, and `0a0df4b` (V5) swaps a Dashboard card's figures for the locked line on every relock check. The public fallback failed open; M1.6c (`7735410`, `8e5fe0b`) makes attachments fail closed — refinement 9. |
| The first print variants | built | all five; refinement 10 (the Urdu). |
| Excel on every table | from each page's ⋯ menu | Today, holders, a holder, parties, a party, commitments, ledger, documents, audit. |
| The dashboard widget | built | owners only: cash in hand, how many need attention. |
| Cross-track | done, with differences | no `:root` tokens were added (the `.ma-` block uses the existing ones); `js/shared.js` took several touch points (the nav section, the More sheet, the `renderPage` line, the dashboard `setTimeout`, the phone `groups` map, `BUG_PAGE_NAMES`, the sub-nav in `showPage`), not "nav + one line"; `index.html` has no Firebase-bridge change as of `704056b`; M1.6b (`20260a0`) bridges three (`terminate`, `clearIndexedDbPersistence`, `waitForPendingWrites`), and `js/auth.js`'s `doLogout` and `lockUsePassword` call `window.maBooksOffDevice()` behind `typeof`. |

### Where the build changed the plan — each with its reason

1. **§3 #3 and §5 (transfers), REFINED — and M1.3 REVERSED by M1.6a.**
   M1.3 posted a transfer into the drawer at once (`via:'store'`). M1.6a
   makes the drawer Raees's hands in BOTH directions: into the drawer waits
   for Raees; out of it, the receiver confirms if the receiver is a person
   (an owner in the app — even one who recorded it — Umair on paper), and
   Raees confirms if the receiver is a holder nobody holds (MCB). Raees and
   Umair cannot sign in to the books, so "on paper" means an owner holding
   the signed receipt. Confirming a drawer handover asks first whether
   Raees has recorded it in Store Accounts. *Reason:* the drawer's balance
   is read from Store Accounts until M8, so a handover posted here before
   he books it there counts the money twice, or not at all (money review
   F9). A transfer that waits for or was confirmed by someone keeps its
   route, amount and date — void and record again (money F6). Since
   `44166f3` every cash total takes a handover waiting to go INTO the
   drawer out of the drawer's figure, through one rule (`maHolderCash`,
   V4), and says so beside the total.
2. **§7 and §16.2 (`ma_postings`), NOT BUILT, deliberately.** Postings are
   computed in the browser from the documents on every render; no
   collection holds them, and the rules refuse `ma_postings` even to an
   owner. *Reason:* §2's "balances derived, never stored", and M1's volume
   is small enough to read every document whole. The nightly rollup (M2)
   may bring a rebuildable cache; `js/master-accounts.js` records the plan
   to read from the last close onward once quarters lock.
3. **§31 (edit) and §29 (writes bound to the caller), TIGHTENED.** An edit
   never moves a status, a confirmation, a review or a void; it names
   `amount` and `tax` when it moves them; `month` and `fy` stay bound to
   its date; it stores its own live flags and clears the review when a
   figure moved; a count keeps its book unless its day or count moves, and
   its holder cannot change. *Reason:* the security review (F1) moved
   money through the rules behind an edit row that said "note", and the
   money review (F2, F6, F8) moved balances and dropped flags the same
   way.
4. **§30 (backup) — the schedule.** `ma-backup` wakes every hour at :30
   and starts ONE export a day at the first wake at or after 03:30 UTC.
   *Reason:* an export takes minutes and a scheduled function gets
   seconds, and Today reads only the latest `ma_backups` row — resolved
   once a day, a failure would be buried by the next night's row the
   moment it was found. "Not set up" is its own state and its own concern.
5. **§19 (`ma_shares` owner read/write), NARROWED.** Owners read; only the
   `ma-share` function writes. *Reason:* an owner writing one directly
   could pick the token and skip the audit row (security F3).
6. **§19 (`ma_closes` "append, reopen by owners"), EXTENDED.** A close is
   born locked; a reopened quarter is re-locked through an audited path
   (`maCloseRelock`, rules `maRelockOk`). *Reason:* a close born unlocked,
   or reopened, could otherwise never be locked again (security F3b). **No
   M1 screen writes `ma_closes`** — the quarter lock is M11 — so this is
   ready but unused.
7. **§29 (audit) — bound to time and to `by`.** An audit row must be
   stamped within five minutes of the server's clock, and the trail shows
   the name derived from `by`, never the stored `byName` (security F3). The
   app writes one with every change, so a device clock more than five
   minutes off blocks every write once the rules are published.
8. **§6 (journals) — the controls other kinds enforce, now on journals
   too, in the client only.** A general journal between two holders is
   refused (record a transfer); a journal payout with no file or no payee
   is flagged; a second opening for an account is flagged (money F12). The
   rules language cannot loop over a document's lines, so the rules do not
   hold this.
9. **§29 (attachments)** — built as planned (`type:'authenticated'`,
   5-minute signed links, a server-minted `ma/<64 hex>` name, Settings says
   which mode is in force), with one finding against the fallback: without
   the Cloudinary key it went public silently, and a file uploaded that way
   stays public after the key is set (security F7). **M1.6c closed it:**
   attachments FAIL CLOSED. Without both keys, attachments and share links
   are OFF (`sign` and share creation answer 503 not_configured, saying
   what is missing and both ways out), and the public fallback is taken
   only when the owners set `MA_ALLOW_PUBLIC_ATTACH` to exactly 1. Signed
   uploads carry `overwrite:0` inside the signature (the Cloudinary Node
   SDK 2.11.0's form of `overwrite:false`). Settings says "Attachments are
   off — not set up." when that is the state. *Reason:* a file that is
   public by accident cannot be made private again. Whether the live
   account accepts `overwrite=0` on authenticated uploads is unverifiable
   from a session — the first real upload is the test.
10. **§31 (print variants) — the slips, and the Urdu.** `ma-receipt` is a
    transfer's handover slip (the plan's collection receipt needs M2's
    collections); `ma-voucher` is a Money-out voucher (bills and
    allocation are M3). Both were planned in full Urdu; **the embedded
    Urdu font cannot draw what jsPDF emits** (measured: CLAUDE.md "Print
    design system"), so they ask the font first (`_prMaUrduOk`) and print
    English. `ma-ledger` is A4 landscape as planned — the engine gained
    `data.orientation` for it, and `deliver:'blob'` for sending a PDF by
    link; every earlier variant draws exactly as before (verified call for
    call, on the Helvetica path).
11. **§30 (Download the books) — narrower.** A JSON of every `ma_*`
    collection and one Excel workbook (the postings, the trial balance,
    every collection as a sheet); a failed collection is named in both;
    the download is an audit row. It does not bundle per-statement
    workbooks or the PDF pack (the ledger, a holder and a party each have
    their own Excel on their page; the P&L, balance sheet, aging and tax
    are M9's), and `ma-import` is NOT built — the JSON is shaped for it
    (idempotent by document id).
12. **§31 (send by link)** — as planned, plus: link-preview fetches are
    counted apart (`previews`), so "opened" means a person; a link's life
    is capped at 90 days (the setting's range); the client puts its own
    origin in front of the path the function returns.
13. **§29 (re-lock) — by device capability, not by form factor.** The
    fingerprint where this device has the app lock, else the password —
    not "a phone asks for the fingerprint, a computer for the password".
    Since M1.6b the lock is asked everywhere, not only on navigation: a
    tap or a key on an `ma-*` page while it is due shows the lock without
    resetting the clock, every repaint asks first, and coming back to the
    tab or a 30-second check swaps an open page for it (security F5); since
    `0a0df4b` the same checks swap a Dashboard card's figures for the
    locked line (V5), and the fingerprint opens the books only when one
    was really checked (V9).
14. **§16.3 (the phone) and §23 #13 (the nav label).** The phone has no
    five-button Master Accounts bar: its pages sit behind "Master Accounts
    ›" in the owner's More sheet. The label is "Master Accounts", not
    "Accounts" — the Store section already carries an "Accounts" item.
15. **§29 (the device) — an owner's sign-out takes the books off it**
    (M1.6b, security F6, which reproduced — with a newer SDK than the
    app's pinned 10.12.2 — a non-owner on the same browser profile reading
    an owner's journal from the offline cache). The app
    waits up to 5 seconds for pending writes, then terminates Firestore and
    clears its IndexedDB cache; if writes are still pending it signs out
    but KEEPS the copy and says so, and while another Groovy Ops tab holds
    the cache it does not sign out at all. The verification round found
    two blockers in this, both fixed at `0a0df4b`: the lock's "Use
    password instead" now always signs out, and the lock stays up until it
    has (V1); and the copy is kept whenever anyone's writes are still
    waiting in Firestore's own queue — another person's included — or the
    queue cannot be read (V2). The ledger also stopped
    printing a running balance where it would not be the account's — under
    a narrowing filter, or for the drawer (money F4, F5).

### Moved on, or not built in M1

- Pages: Money in (M2, M5), Costing (M7), Savings (M4), Reports (M9) —
  their tiles in the Record picker name the milestone.
- The quarter close and its checklist (M11): the rules and the core's
  re-lock are ready; no screen closes a quarter.
- `ma-import` and the restore drill (`tests/ma-restore.js`), the PDF pack
  and the quarter pack — §30's layers 3 and 4 beyond the JSON and one
  workbook.
- `ma-rollup` and `ma_cpr` (M2).

### The review round, and what is still open

Two adversarial reviews ran against `4057303` — money and data integrity,
security and privacy — each finding reproduced by a script or a probe
(their reports are session scratch files, not in the repo). The posting
engine held: 20,000 fuzzed documents balanced (reported). The boundary
against non-owners held. M1.6a closed the rules-side findings (security
F1, F2, F3, F3b, F4; money F2, F6, F7, F8, F9, F11, F12, M4). Still open at
`704056b`, read from the code at that commit: money F1, F3, F4, F5, F10,
F13 and M1–M3 (the screens), security F5 (the idle re-lock), F6 (the books
left in IndexedDB after sign-out) and F7 (the attachment fallback).
**M1.6b (`20260a0`) closed**, per a verification round that re-checked
every finding against that commit: money F1, F3, F4, F5, F10, F13, M1, M2
and N1–N3, and security F6 — "with two new problems", V1 and V2. Still
partly open by the same round: money F9 (V4) and M3, security F2 (V3) and
F5 (V5). Security F7 and the server nits were the server round's:
**M1.6c (`7735410`) closed F7** (refinement 9) and, by its author's
account, the server nits. The verification round's own findings,
V1–V12 (V1 and V2 blockers), and the visual QA's F01–F27: **V1, V2, V3,
V5, V7, V8, V9 and V11 are fixed at `0a0df4b`; V4, V6, V10 and F01–F24 at
`44166f3`** (CLAUDE.md "The review round" has what each changed). Each fix
was undone once and caught by a named assertion — 27 and 62 reverts,
re-run on the combined tree. **Still open:** an edit can still store forged
flags, and an edit row's before/after values are not bound to the document
(C1, C2 — owner-forgery only); V12 and C4 are recorded only; the period
lock still covers documents only; a few races are reasoned about, not
reproduced; iOS, `:has()` and `overflow:clip` are unverified on real
devices; V4 rests on Raees booking a handover before an owner confirms it.
**Afnan decided the three judgement calls on 29 Sept 2026, and all three
are built** (`22cfd3e`, `c836de2`): F26 folds the Record picker's later
kinds behind one "Coming later · 8" line; F27 keeps the rail a slide-over
up to 1440px (below 1441px an open rail covers the header's Record and ⋯,
and Year and All at 1024px; its × closes it); F25 — this plan had recorded
"keep the alert, no change", but there was no such alert, only the QA's
suggestion. Afnan chose to have it: while the book has no opening balance
(`maIsOpening`: any journal of kind opening that is not void), Needs
attention leads with the concern "No opening balance yet — the books start
when one is recorded.", and Record it opens the Opening balance form.

### What only the humans can do before this is live

The backup bucket and the service account's roles on it, PITR, three
Netlify env vars and a redeploy, a check of the Cloudinary plan's upload
cap, a publish of the FINAL `firestore.rules`, and a
first look on a real screen — each listed, with what is verified and what
is not, in CLAUDE.md "Master Accounts" → "Set-up only a human can do"; the
full steps are handed to Afnan in chat. The merge into `main` is done
(29 Sept 2026, with his go-ahead; the Netlify deploy is unconfirmed). The
publish is NOT: two publishes were reported that day, neither is the final
file, and the Console's state is unknown.

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
vs exclusive, withholding on the vendor's ledger); the printing bill's qty ceiling;
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

## 23. Former open questions — resolved as logic (28 Sept 2026)

Afnan: *"All the questions you are asking should not be questions but
logics that should be answers inside the build."* Each item below is
therefore a rule with a default, a setting where the default lives, and
the path the build takes when the situation turns out otherwise. Nothing
waits on an answer; the first real document teaches the app.

| # | Was the question | The rule now | Default | If it is otherwise |
|---|---|---|---|---|
| 1 | Which account receives Payfast's payouts; the fee | the payout form carries **Lands in** (a Savings account) and **Fee**, both remembered from the last payout | S1020 "Payfast payout account"; the fee = the last fee learned, else 0 | pick another account on the form and the setting `payout.landsIn` moves with it; a fee typed once becomes the learned default |
| 2 | Repay the loan first, then draw — split how | `payout.rule = repay_then_draw`; the draw split is `payout.drawSplit` | 50 / 50 | any payout overrides its own split with a reason; the setting changes future payouts; the loan can be put on hold so payouts only draw |
| 3 | The loan's opening per lender | the Loan page opens with an **Opening** document: amount per lender (Afnan, Ammar, joint), date, evidence optional | ₨15,00,000 joint, 1 Oct 2026 | edit it with history; a lender's share changes freely until the first repayment posts, then by a journal with a reason |
| 4 | What the TCS account is; fees | 1060 is a holder of kind `courier_wallet`; its balance is what TCS's statement says; fees are lines on the statement | a statement typed monthly, fees per line | if TCS pays into MCB the credit is a transfer 1060 → 1020 from the same form; if TCS deducts fees before crediting, the net is what the statement shows and the fee line is 5060 |
| 5 | Blue-Ex's balance | an opening-statement document (with the attachment) starts the receivable | opening 0 until a statement is entered; the row reads "no opening statement yet" | a collection with no opening posts to 1123 and is flagged "recovered before its opening"; a later opening reconciles it |
| 6 | How Bykea's money arrives | a typed statement; the collection names the holder it reached | the drawer, pending Raees | any holder; a feed later replaces the typing, not the document |
| 7 | Company cash held by an owner | 1011 and 1012 are **company money**; a monthly count per owner reconciles them; personal use is a drawing journal | a count on the last day of each month, prompted | mixing is caught by the count; a drawing is posted, never an expense |
| 8 | The subscriptions list | detected from imports (the same payee, the same amount ± 5 %, twice at a monthly or yearly interval) → proposed → confirmed; or typed | detect, then confirm | delete a false detection; it is remembered and never proposed again |
| 9 | The targets' amounts | a target is created with its amount on first open; until then the page reads "no target yet", never a placeholder number | none | edit at any time; the ETA recomputes |
| 10 | Which taxes apply, the rates, filer status | the tax block is on every document; `none` is a valid kind; rates are settings | every rate blank; the tax page reads "rates not set — the accountant fills them" | the accountant sets rates with a start date; documents from that date default to them; earlier ones are untouched |
| 11 | The payroll sheet's columns; how salaries are paid | the importer maps columns by header and by hand, previews, and is idempotent by employee + month; a pay run names its holder | the drawer | per run or per slip a different holder; an unknown employee is offered, never invented |
| 12 | Go-live and history | live from 1 Oct 2026; Q1 open for backfill until closed | as stated | reopen with a reason (§20) |
| 13 | Retention, tolerances, a PO for services, Raees's view, the nav label, Mustafa, the Reset | 0 % retention with the mechanism shipped; 2 % qty and 0 % rate with a reason; the gate pass can raise the PO; Raees sees his own; "Accounts"; no; retired at M8 | as stated | each is a setting on Close & audit → Settings |
| 14 | Whole rupees, one currency | yes | — | — |
| 15 | *(new)* How the data is kept safe and backed up | §29 and §30 | a nightly export kept 90 days; PITR on | a failed nightly is a concern line the next morning |
| 16 | *(new)* Printing, editing, sending | §31 | every document has a PDF; edits keep history; a share link lives 7 days | the link's life is a setting; a link can be revoked |

What still has to arrive from outside, and how the app behaves until it
does: the statements (TCS, Blue-Ex, Bykea, Payfast, MCB) — each page reads
"no statement yet" with the button that takes one; the payroll sheet — the
importer accepts any sheet; the accountant's rates — the tax page says so.
None of it blocks entry.

## 24. What cannot be verified from a session

What the Console publishes; what a PostEx CPR's net really is on the
receipt PostEx prints (the derivation is from the parcels' fields; send one
CPR PDF before M2); what Shopify's `financial_status` means for a Payfast
order; the shape of the TCS, Blue-Ex, Bykea, Payfast and MCB statements
(send one of each before the milestone that reads it); the payroll sheet's
columns; anything visual — the specimen was rendered in headless Chromium
and looked at; the live module needs Afnan's first open, as always.
New in v4, and also unverifiable from here: whether the Cloudinary
account allows authenticated uploads and signed delivery on its plan
(§29, §31 — the sandbox cannot reach Cloudinary at all), the service
account's roles on the backup bucket and the bucket itself (§30), what
WhatsApp does with the link, and every number in §16.4 — the audit measured the v3
specimen and the rebuilt one is measured the same way, but the module
inside the real app has not been seen by anyone.

## 25. The money map of Groovy Ops — what the app can actually do today (read from the code, 28 Sept 2026)

Every row was read in this session; line numbers are from the files as
they stand on `main`. The "state" column is the coverage register's
vocabulary (§28): **live** (amount, date, party and a person are
recorded), **partial** (some of those), **missing** (nothing), **broken**
(recorded in a way the ledger cannot use).

### 25.1 Money in

| Flow | What the app holds | State | File |
|---|---|---|---|
| **Online COD via PostEx** (90% of cash) | Per parcel: `cod` (invoicePayment), `transactionFee`, `transactionTax`, `reversalFee`, `reversalTax`, `upfrontPayment` (+date), `reservePayment`, `balancePayment`, `invoiceDivision`; synced every 4 h over a 14-day window; the CPR receipt numbers `cprNumber_1` (upfront) and `cprNumber_2` (reserve) with `cpr1Date`/`cpr2Date`, `settle`, `settlementDate`, enriched daily at 8 am PKT, one API call per parcel | **partial** — every rupee PostEx owes is known per parcel; **who collected the CPR's cash, when, and how much** is nowhere | `netlify/lib/postex-core.js:100-121, 190-262`; `netlify.toml:32-38` |
| Online prepaid via **Payfast** | Nothing. `financial_status` on the Shopify order is written once; no gateway field | **missing** | `netlify/functions/shopify-order-sync.js:130-145`; grep "payfast" = 0 |
| **Shopify orders** | `order_number, created_at, total_price, financial_status, fulfillment_status, cancelled_at, discount_codes, line_item_count`; line items with `sku, quantity, price`; written once, never refreshed; the weekly close counts units only | **partial** — revenue per order is known at sync; refunds after sync, the gateway and payouts are not | `shopify-order-sync.js:130-175`; `shopify-weekly-close.js:48-134` |
| TCS · Blue-Ex · Bykea | Three fixed courier rows on Daily Performance with a colour each; no statement, no receivable | **missing** | `js/fulfillment.js:27-37` |
| **Warehouse sales** | One document per ERP order: customer, phone, lines with price and catalog price, `subtotal`, `discount` (≤ 20%), `total`, `terms` paid/later, `paidVia`, `dueDate`; collection fields; Raees's confirmation as a Store Accounts `cash_in` (`src:'wh'`) | **live** | `js/warehouse-sales.js:309-385` |
| **Gate sales** (fabric or garments sold at the gate) | Rate per kg or piece, `amount`, `account`, customer, phone; posts a `cash_in` under "Fabric sale" | **live** | `js/gatepass.js:158-165, 597-605` |
| Creator discount codes | Redemptions and revenue per code, nightly | live (as analytics, not money) | `netlify/functions/marketing-code-rollup.js` |

### 25.2 Money out

| Flow | What the app holds | State | File |
|---|---|---|---|
| **Store purchases, petty cash, floats, runners, consumables** | One ledger (`acct_entries`): `purchase · payment · cash_in · transfer · float_out · float_in · runner_pay · adjust · opening`; two money accounts, **cash** (the drawer) and **mcb**, plus "other"; vendors with terms `cash/credit/monthly/weekly` and a rate card derived from purchase lines; categories *Store purchase · Maintenance & repairs · Wages · Advances · Office & stationery · Fuel & transport · Utilities · Other*; runners (Noman); pay days Wednesday and Saturday; a receipt required above ₨2,000 (₨1,000 with no vendor); metered gas and water logged daily and billed monthly; edits with history; a month close | **live** — for what passes through the drawer | `js/store-accounts.js:48-106, 223-246` |
| **Salaries** | Employees with `basicSalary` (seed values ₨25,000–₨145,000), paygrades P1–P5, the policy (30 working days, 09:00–17:00, 30 min grace, 3 lates = 1 absent, absent deduction = salary ÷ working days); payslips `basic, gross, net, deductions, absentDeduction, advanceDeduction, loanDeduction, workingDays`; mark-paid writes `status, paidOn, paidBy, paidAt` and the run's `totalAdvanceCleared` / `totalLoanCleared` | **partial** — the accrual is exact; **which holder the cash left** is not recorded | `js/hrm.js:40-56, 1983-2027, 2109-2128` |
| **Advances and loans to staff** | Advance requests approved with `paidVia`, marked paid with `paidOn/paidBy`; loans with `totalAmount, monthlyDeduction, remainingBalance, paymentHistory[]`, pause and resume | **live** as HRM records — no holder, never posted | `js/hrm.js:2810, 2848, 2987-3039` |
| **Fabric** | Fabric-in: supplier (chips: Gul Enterprises, JR Trader, Akhlaq Sublimation, Khursheed Enterprise, Daniyal Twill), type, gsm, colour, rolls, kg or m, QC per roll. **No rate, no bill** | **broken** — the biggest cost has no money on it | `js/fabric.js:605-660` |
| **Stitching, washing, dyeing, embroidery, sublimation by vendors** | A gate pass to a destination (chips: FebKnit, Al-Hamd, Al-Nisa, Aqib Sublimation, JR Traders, Rahim Gul, Khursheed), reason `process / return_vendor / sale / other`, sizes and units; returns with `sentQty, returnedQty, cumulative, shortage`. **No rate, no bill** | **broken** | `js/gatepass.js:20, 98-106, 550-623` |
| **Printing** (Asghar's unit and external printers) | `PRINTING_RATE_MASTER` (article → rate per piece, tier); billing `netPayable = finalApprovedQty × ratePerPiece − materialCostImpact`; jobs carry `vendorName` / `assignedTo`. **No payee, no paid state** | **partial** | `js/embellishments.js:58-152, 3368-3400` |
| **Trims and packaging** | Store items in 13 categories (threads, neck labels, neck rib, bottom labels, packaging, hangtags, patches, metal trims, zips, twill tape, sleeve labels, drawstring, bundle tag); a plain Store receive records supplier and quantity **without a rate**; a Store Accounts purchase records the rate | **partial** | `js/store.js:500-507`; `js/store-accounts.js` |
| **Courier fees, tax and reversals** | Per parcel (above); never posted anywhere | **partial** | `postex-core.js:110-114` |
| **Paid PR** (creators) | `proposed_amount_pkr` frozen at approval; `payment_status, payment_method, payment_reference, payment_date`; no holder | **partial** | `js/marketing.js:2436-2534` |
| **Product given to creators** (organic dispatches) | Products by variant on each dispatch; no cost | **missing** — a marketing cost at cost of goods | `js/marketing.js` (M2) |
| Rent, electricity, internet, phones, food and refreshments, insurance, licences, the accountant, bank charges, Payfast's fee, company subscriptions, machinery, deposits, taxes | Nothing — unless paid from the drawer, where it is a Store Accounts purchase under *Utilities / Other / Maintenance & repairs* | **missing** | grep: no rent, refreshment, kitchen, insurance, subscription, withholding or depreciation in `js/` (28 Sept 2026) |
| Owner drawings, capital, the loan from savings | Nothing | **missing** | grep "drawing", "capital": UI words only |

### 25.3 Where money sits today, per the code

| Place | Evidence in the app | Balance known to the app? |
|---|---|---|
| The store drawer (Raees) | Store Accounts `cash` | yes, derived |
| MCB current | Store Accounts `mcb` | yes, derived — from the drawer's side only |
| Cash with Afnan / with Ammar (collected CPRs, personal fronting) | nothing | **no** |
| The warehouse till (Umair) | `wh_sales` paid-now sales until Raees confirms | partly (what is waiting) |
| Runner floats | Store Accounts `float_out` / `float_in` | yes |
| With PostEx (delivered, not yet on a CPR; on a CPR, not yet collected) | per-parcel fields | derivable — never derived |
| At TCS (the 90-day account), with Blue-Ex, with Bykea | nothing | **no** |
| With Payfast (prepaid, not paid out) and in the owners' savings | nothing | **no** |
| With customers (warehouse pay-later) | `wh_sales` terms `later` | yes |
| With staff (advances, loans) | HRM | yes |
| With vendors (advances paid ahead) | Store Accounts payments beyond the payable | partly |

### 25.4 The people the money moves through

Sixteen accounts in `USER_DEFS` (`js/auth.js`): Afnan and Ammar (owners);
Mustafa (operations manager) and Arfat (advisory); Raees (store — the
drawer); Umair (fulfilment — the till); Haris (QC), Abbas (washing, a
rider), Waqas (stitching), Asghar (printing), Zohaib (bundling), Uzaib
(cutting and fabric), Faizan (packing), Daniyal (creators), Sami (CSR),
Saim (design). Money is entered today by Raees (Store Accounts), Umair
(sales), the owners (pay runs, approvals, Paid PR) and the functions
(PostEx, Shopify). Only Afnan and Ammar read the master books (§29).

### 25.5 What the functions already do on a schedule — the feeds the ledger inherits

Catalog 9 am PKT · inventory snapshot 10 am and 10 pm · orders every 4 h ·
PostEx parcels every 4 h · PostEx CPR enrichment 8 am · code redemptions
6:30 am · Instagram token 7:15 am · Board reminder 8 am · weekly close
Saturday 7 am (`netlify.toml:17-57`). The accounts rollups (§19) and the
nightly backup (§30) join this list; nothing new is polled by the browser.

## 26. The cost register — every line the factory spends on, and the state each is in

The register is a table in the settings (`ma_commitments`, §4.6) with one
row per line of cost the factory carries. A row says what the cost is, who
is paid, how often, from which holder, what evidence is required, and
**what captures it today**. Amounts are entered at go-live or learned from
the first bills; the plan invents none. A commitment with no document by
its due day is a **gap the app names** (§17: *"Rent for October — no bill
recorded; usually ₨X by the 5th"*), which is how "not yet collecting money
data" becomes a line on the screen rather than silence.

**Kinds:** `fixed` (the same whether or not production runs) · `variable`
(per piece, per parcel, per kg) · `running` (petty, semi-variable) ·
`people` · `financing` · `one_off` · `tax`.

### 26.1 Fixed — every month whether or not a piece is cut

| Line | Payee | Cadence · due | Holder (default) | Account | Captured today | The build |
|---|---|---|---|---|---|---|
| Rent — factory, warehouse, office, any godown | the landlord (a vendor, role `rent`) | monthly · a due day | MCB | 6040 | nothing | one commitment per premises; the bill is one form, or none — a rent commitment can post its own bill on the due day, confirmed by the payment; a security deposit is an asset (1170) |
| Electricity | the utility | monthly · the bill date | MCB or the drawer | 6030 | nothing, unless paid from the drawer as *Utilities* | a `utility` vendor; the bill photo is the document; units and rate learned; a missing month named |
| Gas · water (metered) | the vendors | a daily log → one bill per month | the drawer | 6030 | **live** — `acct_meter_logs`, one bill per vendor-month | absorbed in M8 with its meter logic intact |
| Internet · phones · mobile packages | the providers | monthly | MCB or the drawer | 6030 | nothing | commitments; a subscription-shaped bill |
| Company subscriptions (the Shopify plan, the domain, hosting, design tools, the Meta business tools, Cloudinary and Firebase if billed) | the providers | monthly or yearly | MCB or a card | 6100 | nothing | the same subscriptions register the Savings book has (§9), on Groovy's side; detection from the MCB import |
| Insurance · licences · registrations · the accountant | as named | yearly or quarterly | MCB | 6150 · 6140 | nothing | commitments with a yearly cadence; the calendar shows them a month ahead |
| Depreciation of machines, computers, fixtures | — | monthly, computed | — | 6090 | nothing | the asset register (`ma_assets`, §4.7): cost, date, life, method; the month's depreciation is a journal the close posts |
| Bank charges · Payfast's fee · PostEx's fees | MCB · Payfast · PostEx | per statement · per payout · per parcel | MCB · netted · netted | 6080 · 6080 · 5060 | fee fields exist per parcel; nothing else | the MCB import posts charges; the payout carries its fee; the CPR carries its fees |

### 26.2 People

| Line | Captured today | The build |
|---|---|---|
| Salaries — basic, deductions for lates, absences, advances, loans | **live** in HRM: the accrual per month, the net per slip | M6: the accrual mirrors into 6010 ↔ 2040; a **payroll payment** names the holder the cash left (default the drawer; per run, per slip override); the Excel months imported |
| Advances to staff | **live** in HRM (`paidVia`) | posted 1140 ↔ holder when approved and paid; recovered through the slip |
| Loans to staff (schedules) | **live** in HRM | posted 1140 ↔ holder; the schedule drives the deduction; a paused loan pauses the deduction |
| Overtime, bonuses, Eid advances, festival gifts | **not in HRM** — no overtime or bonus in the pay logic (grep, 28 Sept) | a payslip **adjustment** on the accrual adapter (plus or minus, with a reason), so a month's people cost is the real one |
| Wages to daily-wage or piece-rate workers (a cutting master, helpers) | *Wages* in Store Accounts when paid from the drawer | a `wages` document naming the person (an employee party without a payslip); the cutting master on a fabric issue is the hook for piece-rate |
| Runners' floats and settlements (Noman, Abbas) | **live** in Store Accounts | absorbed in M8; a float is holder 1050, a settlement 2050 |
| Food and refreshments — the kitchen, tea, staff meals, guests | a purchase under *Other* if paid from the drawer | its own account **6120** and category, so it is never hidden in Other; a daily or weekly commitment learned from history |
| Staff welfare, medical, uniforms | nothing | account **6130**; a `wages`-style document naming the person |

### 26.3 Variable — per production PO, per sale, per parcel

| Line | Captured today | The build |
|---|---|---|
| Fabric — the largest cost | fabric-in with no rate | M3: rate, invoice and PO ref on fabric-in; the supplier a party; receipts → bills matched three ways; FIFO cost per PO (§13) |
| Stitching (CMT), washing, dyeing, embroidery, sublimation by vendors | a gate pass with no rate | M3: the gate pass **is** the dispatch and the return is the receipt; the vendor's rate card (per piece by article) prices the bill; shortage and damage on the return become the vendor's debit |
| Printing — Asghar's unit and external printers | billing computed, no payee | M3 adapter: an approved billing → a bill on the printer's ledger at his card rate |
| Trims, labels, packaging, threads, hangtags, polybags, cartons | a Store receive without a rate; a Store Accounts purchase with one | M3: a rate on every receive; issue-to-PO consumption prices the trims leg of the cost sheet |
| Courier delivery fee, tax, reversal fee per parcel | per parcel | M2: posted per CPR to 5060 / 5070 |
| Returns and refunds online | reversal fees only | M5: a refund is a document; a returned parcel's cost stays on the PO's cost sheet |
| Discounts (codes, warehouse) | on the order and on the sale | M5: 4040, per channel |
| Creators' product (organic dispatches) and Paid PR | dispatches by variant; Paid PR amounts | M5 / M7: product at cost of goods to 6020; Paid PR approved → a bill on the creator party (2060), paid → a payment from a holder |
| Samples, wastage, damage | a damage rate on cutting (`js/pos.js:1205`); nothing in money | M7: costed from the PO's actuals; wastage is the cost-variance line (5090) |

### 26.4 Running — petty, transport, upkeep

| Line | Captured today | The build |
|---|---|---|
| Petty cash — the drawer | **live** (Store Accounts) | holder 1010 with a floor; the count and close it already has |
| Fuel, transport, Bykea rides, courier pickups | the *Fuel & transport* category; runners' floats | account 6060; a `transport` category on any document; a per-PO transport cost where a gate pass names it |
| Maintenance and repairs, a paint job, machine servicing | *Maintenance & repairs* | 6050; above the asset threshold it is an asset instead (§26.6) |
| Office and stationery, cleaning, paper | *Office & stationery* | 6070 |
| Generator fuel, water tankers | nothing | 6030 with a `generator` sub-category |
| Entertainment, guests, gifts | *Other* | 6120 |

### 26.5 Financing and the owners

| Line | Captured today | The build |
|---|---|---|
| The loan from the owners' savings (about ₨15 lac) | nothing | §10 |
| Drawings and capital (Afnan, Ammar) | nothing | journals 3010–3021; money moved from a company holder to personal use is a drawing, never an expense |
| Vehicle finance, family borrowings (the owners') | nothing | the Savings book's liabilities (§9) |
| Customer deposits, vendor advances, retention held | Store Accounts payments beyond the payable | 2070 · 1150 · 2020 |

### 26.6 One-off and tax

| Line | Captured today | The build |
|---|---|---|
| Machinery, computers, fixtures, renovation | nothing | an asset when above `assetThreshold` (a setting, default ₨50,000), else 6050; `ma_assets` with depreciation |
| Security deposits (rent, utilities) | nothing | 1170, returned as a receipt |
| Sales tax, services tax, withholding, income-tax advances, levies | nothing | §12: the tax block on every document; 2120 · 2130 · 1160; 6110 for the non-recoverable |
| Fines, penalties, disputes with a courier | nothing | 6190 with a `dispute` tag; a disputed CPR keeps its own state |

### 26.7 What the register makes possible

- **The whole month on the P&L**: cost of goods (5010–5090), people
  (6010, 6120, 6130), running (6030–6070), fixed (6040, 6090, 6100, 6140,
  6150), financing (6080), tax (6110) — every line either a document or a
  named gap.
- **Runway and the calendar** (§17) read the commitments, so a month's
  fixed outflow is known before any bill arrives.
- **Cost per piece** (§13) reads the variable lines per PO and allocates
  the fixed ones by `overheadPct` (a setting) — a piece costs what it costs
  to make *and* to keep the lights on.
- **"Of every ₨100 in"** (§17) is the register's kinds in one row.

## 27. Every rupee labelled — the dimensions on every posting

A posting is a line in `ma_postings` (§7). Nothing reaches the ledger
without the labels below; the engine (§6) refuses a document missing a
required one, and a value it cannot classify goes to suspense (9010 /
9020) **and into the Unlabelled queue**, which must be empty before a month
is soft-closed and a quarter is locked.

| Label | Values | Required | Comes from |
|---|---|---|---|
| `book` | `groovy` · `savings` | always | the document kind |
| `date`, `month`, `quarter`, `fy` | a local day; `2026-10`; `2027-Q2`; `FY27` (July–June) | always | the document's date (§20) |
| `holder` | 1010 … 1060 (§4.1), or none for an accrual | on every money movement | the form; the adapter's default |
| `account` | the chart (§4.1 or §4.5) | always | the document kind plus the item or category |
| `party` / `partyKind` | an `ma_parties` id · vendor, customer, courier, gateway, employee, owner, bank | on bills, payments, receipts, invoices, collections, payroll | the form; a party created inline |
| `payee` | free text | when there is no party (a one-off) | the form |
| `category` | the human tree: Cost of goods → Fabric, Stitching, …; People → Salaries, Food, …; Running → …; Fixed → …; Financing; Tax | always on spend | the account's default, editable per line |
| `costCentre` | `factory` · `warehouse` · `office` · `online` · `owners` | always on spend | the party's or the item's default; the settings list |
| `kind` | `fixed` · `variable` · `running` · `people` · `financing` · `one_off` · `tax` · `transfer` | always | the commitment or the account default |
| `po` / `article` | a production PO id; an article code | on cost of goods where known | the gate pass, the fabric issue, the printing job, the store issue |
| `channel` | `online_cod` · `online_prepaid` · `warehouse` · `gate` · `other` | on revenue and its costs | the invoice's source |
| `doc` | `{kind, no, id}` | always | the posting document |
| `evidence` | attachment count; `required` from the rule | as the rule says (§6) | the document |
| `tax` | `{kind, rate, amount}` | always (`none` is a kind) | §12 |
| `source` | `manual` · `import` · `postex` · `shopify` · `store` · `warehouse` · `hrm` · `printing` · `gatepass` · `fabric` · `rollup` | always | the writer |
| `by`, `confirmedBy`, `reviewedBy` | usernames | `by` always | the session; the receiver; an owner |
| `status` | `posted` · `pending` · `void` · `historical` | always | the lifecycle (§5) |
| `tags[]` | free: `drop:winter27`, `dispute`, `sample`, `eid` | optional | the form; learned suggestions |

What the labels buy: the spend map by category and state; the P&L by cost
centre; the cost sheet by PO; revenue and its costs by channel; the courier
ledger per courier; who entered what on every line; the tax page by kind;
and a search that answers *"everything Al-Karam this quarter"*,
*"everything for PO 0412"*, *"everything Abbas took as a float"*. A label
is never typed twice: the party carries the default cost centre, the item
the default account, the commitment the kind, and the adapter the source.

## 28. The coverage register — broken or missing today, planned inside the build

One row per flow, in the state vocabulary of §25. A **missing** or
**broken** row is not a question: its "build" cell is a form, an import,
a rollup or a rule, with the milestone that ships it. Until that milestone
the app shows the gap as a named line (the commitment logic), never as a
zero.

| # | Flow | State today | What the build adds | Entry surface | M |
|---|---|---|---|---|---|
| 1 | PostEx COD → CPR → cash in a holder | partial | `ma_cpr` derived nightly; the **collection** form (CPRs, amount, holder, receipt); a difference → 9030 with a reason; the in-transit receivable; fees posted | Money in → Couriers; the CPR tab links to it | M2 |
| 2 | The TCS 90-day account | missing | a courier party `account`; a typed statement per month with the attachment; the expected credit at delivery + 90; the TCS account a holder | Money in → Couriers | M2 |
| 3 | Blue-Ex's legacy balance | missing | an opening statement; collections against it; aged | Money in → Couriers | M2 |
| 4 | Bykea | missing | a typed statement; collected into the drawer pending Raees | Money in → Couriers | M2 |
| 5 | Payfast prepaid orders and payouts | missing | `gateway` on the order sync (proposal to Ammar); the 1125 receivable; the payout form, one per weekday; the Savings side | Money in → Online; Savings | M4 / M5 |
| 6 | Shopify refunds after the first sync | missing | a 14-day refresh of `financial_status` (proposal); a refund document | Money in → Online | M5 |
| 7 | Warehouse sales, collections, confirmations | live | invoices and receipts from `wh_sales`; the till a holder | unchanged for Umair | M5, M8 |
| 8 | Gate sales | live | an invoice and a receipt from the gate pass | unchanged | M5 |
| 9 | Fabric purchases | **broken** | rate, PO ref and invoice on fabric-in; the supplier a party; receipt → bill | Fabric in (a cross-track field) | M3 |
| 10 | Vendor processing (CMT, wash, dye, embroidery, sublimation) | **broken** | the gate pass = the dispatch, the return = the receipt; the rate card prices the bill; a shortage = the vendor's debit | Gate pass (a party pick) | M3 |
| 11 | Printing bills (Asghar, external) | partial | an approved billing → a bill on the printer's ledger | none new | M3 |
| 12 | Trims and packaging at cost | partial | a rate on every Store receive; consumption to the PO | Store receive (a cross-track field) | M3 |
| 13 | Store purchases, petty, floats, runners, gas and water meters | live | absorbed with history and Raees's rules; the drawer = 1010 | unchanged for Raees | M8 |
| 14 | Rent, electricity, internet, phones, insurance, licences, the accountant | missing | `ma_commitments` and bills; the calendar and the gap line | Money out → Commitments | M1 (the register), M3 (the bills) |
| 15 | Company subscriptions | missing | the subscriptions register on Groovy's side; detection from the MCB import | Money out → Commitments | M3 / M4 |
| 16 | Salaries — the payment holder | partial | payroll payment documents; `paidVia` / holder proposed on the slip; the Excel importer | HRM (adapter) | M6 |
| 17 | Advances and loans to staff | live in HRM | posted with the holder | HRM (adapter) | M6 |
| 18 | Overtime, bonuses, festival money, daily wages | missing | payslip adjustments; a `wages` document | Money out → Payroll & people | M6 |
| 19 | Food and refreshments, welfare, guests | partial (Other) | accounts 6120 / 6130; categories; a learned commitment | Money out | M1 (the chart), M3 |
| 20 | Fuel, transport, maintenance, office | partial (drawer categories) | labels and accounts; a per-PO transport cost | Money out | M3 |
| 21 | MCB — every line the bank sees | missing | a CSV or statement import with rules; charges posted; reconciliation | Money → MCB | M3 |
| 22 | Cash with Afnan, cash with Ammar | missing | holders 1011 and 1012; transfers pending confirmation; a monthly count | Money | M1 |
| 23 | The loan from savings; drawings; capital | missing | `ma_loan`; journals | Savings; Ledger | M1 / M4 |
| 24 | Machinery, deposits, depreciation | missing | `ma_assets`; the close posts depreciation | Reports → Assets | M9 |
| 25 | Taxes | missing | the tax block; 2120 · 2130 · 1160; the tax page | every form | M1 / M9 |
| 26 | Creators' product cost; Paid PR payments | partial | product at cost to 6020; Paid PR → a bill and a payment | Marketing (adapter) | M5 / M7 |
| 27 | Cost per piece; margin by article and channel | missing | the cost sheet | Costing | M7 |
| 28 | Backups, the audit trail, share links, PDFs of everything | missing | §29 – §31 | everywhere | M1 |

Rows 9 and 10 are the two that matter most for *"calculate the whole
factory"*: without a rate on fabric and on vendor processing, the cost of
a garment cannot be known. Both are cross-track fields on Afnan's own pages
(`js/fabric.js`, `js/gatepass.js`), one input each, and the ledger refuses
nothing while they are empty — it names the leg as missing on the cost
sheet (§13).

## 29. Security — the books are the most sensitive data in the app

Threats, in order: another signed-in account reading the books; a client
writing what the rules allow rather than what the form allows; an
attachment reachable by anyone who has its URL; a lost phone that is
signed in; a mistaken or malicious edit with no trail; a share link that
lives forever.

| Layer | Rule | Where |
|---|---|---|
| **Audience** | `_MA_USERS = ['afnan','ammar']` by username; `isMasterAccounts()` by email in the rules; a test holds them equal. Managers, Raees and Umair see no `ma-*` page and read no `ma_*` document. | `js/master-accounts.js`, `firestore.rules`, `tests/master-accounts.test.js` |
| **The first owner-only READ in the app** | every `ma_*` and `ma_sv_*` block: `allow read: if isMasterAccounts()`. Today no collection has an owner-only read (§1); this module is where it starts, and the emulator test proves a manager is refused. | `firestore.rules`; `tests/rules-emulator-ma.js` |
| **Writes bound to the caller** | `by == username(email)`; a posted document changes only through `edits[]` growing by one with `editedBy == caller` and the row naming exactly the changed fields (the Store Accounts `acctOwnEdit` shape); a void is a transition, never a rewrite; **no client delete on any `ma_*` collection, ever** — void only; the Reset retired at M8. | rules |
| **Periods** | the rules read `ma_closes`: a write dated in a locked quarter is refused at the boundary, not only in the form. | rules |
| **Adapters** | Raees's and Umair's surfaces keep their own collections and rules (own entries, edits with history, review); the **rollup** (the Admin SDK) is what turns them into postings — a store login never writes `ma_postings`. | §15, §19 |
| **Attachments** | today every upload is an unsigned upload to a public Cloudinary path, reachable by URL. Accounts attachments go through **`ma-attach`** — a Netlify function holding `CLOUDINARY_API_SECRET`, a new env var — as `type:'authenticated'`, and are read through **signed delivery URLs** with an expiry the function issues to a signed-in owner. The client never holds the secret. *Unverified from the sandbox: whether the account's plan allows authenticated delivery (the sandbox cannot reach Cloudinary at all) — if it does not, the fallback is an unguessable `public_id` of 32 random bytes behind the same function, and the settings page says which one is in force.* | `netlify/functions/ma-attach.js` |
| **Re-lock** | opening an `ma-*` page after `relockMinutes` (15) idle asks for the fingerprint or passkey again on a phone (`_lockShow` / `lockUnlock` in `js/auth.js`) and for the password on a computer (`reauthenticateWithCredential`, already bridged for Change password). No re-lock, no page. | `js/master-accounts.js` |
| **Audit trail** | `ma_audit`, append-only (`allow update, delete: if false`): every post, edit, void, close, reopen, export, share link made or revoked, backup run, and every entry into the accounts pages; shown on Close & audit and on each document. | rules; §16 |
| **Exports and links** | an export is logged with who and what; a share link carries `expiresAt` and `revoked` and is served by a function that checks both (§31). | §31 |
| **Secrets** | nothing new in client code; every token stays in `process.env` (the standing rule). | CLAUDE.md |
| **Tests** | every rule both ways in the emulator, including a manager reading, Raees writing a posting, an owner deleting, a write into a locked quarter, an edit naming a field it did not change, and an audit row being updated. | `tests/rules-emulator-ma.js` |

## 30. Backup and recovery — three layers, and a drill

| Layer | What | When | Where it lands | Restore |
|---|---|---|---|---|
| **1. The nightly export** | `ma-backup`, a scheduled function calling the Firestore Admin API `exportDocuments` for every `ma_*` and `ma_sv_*` collection and the feeders (`postex_orders`, `wh_sales`, `acct_*`, `payroll_runs`, `payslips`, `shopify_orders`) | 03:30 UTC daily | a Cloud Storage bucket `groovy-books-backups` (created once in the Console), a 90-day lifecycle; the run written to `ma_backups` with the size and the collections | `importDocuments` into the same or a fresh project; the procedure is a page in the plan and an item on the close checklist |
| **2. Point-in-time recovery** | Firestore PITR, seven days | continuous | Google's | any minute of the last seven days, from the Console |
| **3. The owners' own copy** | **Download the books**: every collection as JSON, the Excel workbooks (ledger, statements, P&L, balance, aging, tax) and the PDF pack; a button on Close & audit | on demand, and prompted at every quarter close | the owner's machine | the JSON re-imports through `ma-import` (idempotent by document id) |
| **4. The quarter pack** | the PDFs of a closed quarter (statements, P&L, balance sheet, tax) stored as attachments on the close record | at each quarter close | attachments | evidence, not restore |

- **A missed backup is a concern line** the next morning (*"last backup
  2 days ago"*) — the concern logic reads `ma_backups`.
- **The human steps, named:** create the bucket and give the service
  account *Cloud Datastore Import Export Admin* and *Storage Object Admin*
  on it; switch PITR on. These are the only Console steps and they are on
  the M1 checklist. *Unverified from the sandbox: the service account's
  roles and the bucket cannot be checked from here; the first nightly run
  is the test, and it writes its own result.*
- **A restore drill each quarter**: import last night's export into the
  `demo-` emulator project (`tests/ma-restore.js`) and compare its trial
  balance with the live one; the close checklist records the result.
- Offline persistence (IndexedDB) is a cache, not a backup; the plan never
  counts it as one.

## 31. Print, PDF, edit, and send by link

**PDF is not a feature; it is how every document leaves the app.** Every
page has *Print* and *Excel*; every document has *PDF*; every PDF has
*Share*. All of it through `js/print-engine.js` (the standing rule), with
these variants added:

| Variant | What | Page | Urdu |
|---|---|---|---|
| `ma-ledger` | the ledger as filtered (any range, party, holder, account, category) with opening, closing and totals | A4 landscape — the engine gains an orientation option; portrait stays the default for every other variant | none |
| `ma-statement-party` | a vendor's or customer's statement by range: opening, every bill, payment and credit, a running balance, aging at the foot | A4 | minimal |
| `ma-statement-holder` | a holder's statement: every movement, confirmations, the count | A4 | none |
| `ma-receipt` | a collection receipt (which CPRs, the cash counted, the holder, who collected) with two signature lines | A5 — the engine's custom page size | **full** — a runner or a vendor signs it |
| `ma-voucher` | a payment voucher (the bills allocated, the holder, tax withheld) with a signature line | A5 | full |
| `ma-bill`, `ma-po`, `ma-invoice` | the document itself | A4 | minimal |
| `ma-cost-sheet` | a PO's cost sheet, legs named | A4 | none |
| `ma-pnl`, `ma-balance`, `ma-cashflow`, `ma-aging`, `ma-tax` | the statements for any period | A4 | none |
| `ma-quarter-pack` | the statements of a closed quarter in one PDF | A4 | none |
| `ma-savings-statement`, `ma-networth` | the Savings book | A4 | none |

**Edit.** Every document is editable by an owner through the same form it
was made with, prefilled — the Store Accounts edit (CLAUDE.md, *"Raees can
EDIT"*) generalised:

- in an open period only; a locked quarter refuses; a soft-closed month
  warns and records the edit on the close;
- a reason is required; `edits[]` grows by `{at, by, reason, fields,
  before, after}`; a PDF regenerated afterwards carries *revised* and the
  revision number;
- the engine **re-validates and re-posts** under the same key; allocations
  that no longer fit are unwound and named; a reconciled document loses
  its reconciled mark and says so;
- a void is the same path with every posting reversed; a document another
  one points at (a bill a payment allocates) cannot be voided until the
  pointer is answered;
- the party's ledger and the Ledger page show the history inline (who,
  when, why, what).

**Send by link.** *Share* on any PDF:

1. the PDF is generated in the browser and uploaded through `ma-attach`
   (§29) as an authenticated asset;
2. `ma_shares/{token}` is written: `{docKind, docId, pdfPublicId,
   createdBy, createdAt, expiresAt (default 7 days, the setting
   share.defaultDays), revoked:false, opens:0, to?: {party, phone}}`;
3. the link is `https://groovyoperations.netlify.app/.netlify/functions/ma-share?t=<token>`
   — the function checks expiry and revocation, counts the open, and
   answers with a 302 to a signed Cloudinary URL that itself expires in
   minutes; after expiry or revocation it answers 410 with a plain page;
4. the buttons: **WhatsApp** (`https://wa.me/<phone>?text=<message and
   link>`, the party's phone prefilled; on a phone `navigator.share`
   offers the PDF file itself), **Copy link**, **Email** (`mailto:`);
5. the document lists its live links with opens and expiry, and
   **Revoke**; every share and revoke is an audit row.

A vendor sees one PDF and nothing else. *Unverified from the sandbox:*
WhatsApp's handling of the link and Cloudinary's signed delivery — the
first real share is the test, and the function logs what it served.

**Excel** for every table (the vendored SheetJS), with the filters in the
filename — the Store Accounts convention.

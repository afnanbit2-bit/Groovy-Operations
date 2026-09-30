# How units should be measured (Inventory Intel ▸ Article Explorer)

Raw units per week cannot compare a product live since 2025 with one live since Apr 2026, and cannot tell "selling well"
from "had more stock" or "was out of stock". Definitions below are from general merchandising practice (vendor
sources, unverified; no external figure is used as a threshold). Code: `_siAxStats`, `_siAxExposure`, `_siAxClassify` in `js/shopify.js`.

## 1. What the app holds (verified: code read and live read-only checks, 30 Sept 2026)

| Source | Holds | Does NOT hold |
|---|---|---|
| `shopify_line_items` (`shopify-order-sync.js:153-176`) | sku, title, size, `quantity`, unit `price` (before discounts), `order_created_at`, `financial_status` at sync time | discount amounts, per-line refunds, cancellations |
| `shopify_products` (`shopify-catalog-sync.js:170-190`) | per variant sku, price, status, `created_at`, `published_at` | inventory. **`published_at` is missing on all 2,126 live docs** (live check), `created_at` is Shopify creation (2021+), not a launch date |
| `shopify_inventory_snapshots` (`shopify-inventory-snapshot.js:128-153`, schedule `0 5,17 * * *`) | one doc per PKT day (the 22:00 run overwrites the 10:00 one): `items[inventoryItemId]={available,variant_id,sku}`, one location | receipts. Live: **128 docs, 2026-05-26..2026-09-30, no gaps**, 1,713 to 2,056 items each (QA read, 30 Sept). Stock history starts two months after sales history |
| `shopify_weekly_closes` | top SKU / category totals | anything per article |

Live-data findings handled in code: financial_status `voided` (3,261 rows) is excluded with `refunded`; negative `available`
(11,031 entries) is clamped to 0; items with no SKU are skipped; duplicate SKUs are summed per article; a snapshot with under 80% of
the median item count is dropped as truncated (none seen: counts only ever rose except 2026-09-25, 2018 to 2014).

**Cost of the history:** `_siAxEnsureHistory` does ONE `getDocs(query(orderBy('date','desc'), limit(150)))` when the Explorer opens, cached for
the session, never rejects (named error state + Retry). Today that is 128 document reads per session (each ~2k items; payload size is a hypothesis, not measured).
Other Inventory Intel tables still exclude `refunded` only, so their totals differ from the Explorer by the voided orders.

## 2. The ten metrics (each: formula, use, how to read, limit)

Counted window = from max(publish date, first synced order) to today. With no publish date (today: all products) an article that sold within 7 days of the
first synced order is treated as live at the data start, otherwise as launched on its first sale (labelled "first sale"). Missing inputs show "—", never 0.
Stock figures use only snapshot days; a day is **measurable** when snapshots of D-1 and D both exist, **in stock** if stock > 0 at the end of D-1 or D,
a **stock-out day** if both were 0.

| # | Metric | Formula | Use it for | Low / high | Limit |
|---|---|---|---|---|---|
| 1 | Net units | non-refunded, non-voided units in the counted window | volume | low can just be few live days | later refunds/cancels unseen |
| 2 | Units per live week | units ÷ counted days × 7 | compare ages; reorder or stop | low slow or under-exposed | needs 7+ counted days |
| 3 | Sell-through % | sold ÷ (opening stock + received) over the longest contiguous measured span | reorder vs markdown | low: not moving; high: short of stock | needs 7+ contiguous snapshot days; span printed; fallback is the two loaded snapshots (labelled) |
| 4 | In-stock rate | in-stock days ÷ measurable days | separate "not selling" from "not available" | low: sales capped by supply | needs 7+ measurable days |
| 5 | Units per in-stock day | units on in-stock days ÷ in-stock days | true demand; size a reorder | well above per live day: often out | needs 7+ in-stock days |
| 6 | Stock-out days | measurable days with no stock | restock review; lost-sales risk | high: availability limits sales | counted, never extrapolated |
| 7 | Weeks of cover | on hand ÷ weekly pace (in-stock pace of last 28 d, else 28-day pace) | when to reorder, overstock | < ~2 reorder, > ~26 overstock | assumes pace continues; sensitive to August (units 2× other months, cause unverified) |
| 8 | Momentum | last 28 d pace ÷ previous 28 d − 1 | rising or fading | negative fading | needs 56 counted days and prior sales |
| 9 | Share of category | units ÷ counted units of same product_type | range planning | new articles start low | mixes ages |
| 10 | Age-normalised curve | cumulative units by weeks since launch (Compare ▸ Since launch) + first-28-days units | compare launches | steeper early = stronger | launch proxy is first sale until `published_at` exists |

**Received stock is inferred**, not recorded: per day max(0, stock change + units sold), counted only when ≥ max(5, 10% of opening). Live data: most residuals are ±1–2 units (noise).
Supporting figures: last-28-day pace, sizes in stock, lost-sales risk (0-stock size that sold in 28 d; a flag, not a quantity), selling weeks, peak week, average price (before discounts).

**Definition choices vs. an independent oracle** (`scratchpad/oracle`, 5 hand-computed fixtures; every difference is a deliberate definition, none a bug): counted window starts at the first synced
order (oracle: live date); in-stock day = stock > 0 at either end of the day (oracle: end of day); 7-day minimum for rates and stock figures (oracle computes from 4–6 days); momentum uses rolling 28-day windows and needs 56 counted days
(oracle: complete Monday weeks); weeks of cover uses the in-stock pace; receipt noise floor. Net units, category share, age curve, weekly counts agree exactly.

## 3. Scorecard (defaults, not facts)
Order: Too early (< 28 counted days, no class) · Dead stock (no sale in 28 d with stock on hand, or sell-through < 5%) · Stock-constrained (in stock < 60% of days and ≥ 0.55 units per in-stock day) ·
Winner (sell-through ≥ 60% and in stock ≥ 80%) · Healthy (sell-through ≥ 20% and cover ≤ 26 w) · Slow (other). Constants `_SI_AX_SCORE`, derived from this store's own distributions, not validated with the business.
A clause whose metric is "—" is skipped and the row says "partly unverified". Not classed: no stock data ("Not rated").

## 4. NOT offered
Refund/return rate (later refunds never synced, it would read as zero); discount depth (no discount fields); margin; true receipts (no receipt log); per-size in-stock rate (article level only).

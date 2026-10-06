# Returns refresh runbook (Inventory Intel)

Written 6 Oct 2026 from the code only. **Nothing here was run against live Shopify or Firestore.**
Every statement is tagged **[verified: file:line]** (read in this checkout) or **[hypothesis]**.

## 1. What the refresh is

- `shopify-order-sync` skips an order it already holds, so a refund or cancellation after the first sync never reached Firestore
  (the app reads about 22% high). **[verified: netlify/lib/shopify-order-refresh.js:4-6]** The "22%" figure is quoted from that comment; it was not re-measured.
- The refresh lives in `netlify/lib/shopify-order-refresh.js` and has two callers:
  - `shopify-order-refresh-background`: scheduled `20 */4 * * *` (every 4 hours at :20). **[verified: netlify.toml:33-34]**
    Window = last complete run's start minus 48 h (env `SHOPIFY_REFRESH_OVERLAP_HOURS`); the first run covers 7 days. Meta doc `order_refresh`. **[verified: shopify-order-refresh-background.js:1-8,19-21]**
  - `shopify-order-refresh-now-background`: owners' on-demand twin, no schedule. Meta doc `order_refresh_now`. **[verified: netlify.toml:32; shopify-order-refresh-now-background.js:1-8,43]**
- **Whether the scheduled one has ever run live is unknown from here** [hypothesis]. The task brief says "never run live"; the schedule exists in `netlify.toml`, but a skipped or never-deployed build would look identical (see CLAUDE.md, the 21 Sept skipped-deploy note). The meta docs below settle it.

## 2. What it writes

For each order Shopify returns in the window (REST `orders.json`, API `2026-04`, `status=any`, `updated_at_min`, 100 per page): **[verified: refresh.js:29-30,87]**

- Only orders that **already exist** in `shopify_orders` are touched; it never creates an order or line item. **[verified: refresh.js:128-129,150]**
- Order doc fields: `financial_status`, `cancelled_at`, `refunded_at`. Line doc fields: `financial_status`, `cancelled_at`, `refunded_quantity`, `refunded_at`. **[verified: netlify/lib/shopify-order-status.js:34-49]**
- Plus `status_synced_at` (server timestamp). **It is written only when at least one status value actually differs** from what is stored. **[verified: refresh.js:141-155]**
- A line's `refunded_quantity` is the sum of `refunds[].refund_line_items[].quantity` for that line; a line with no refund gets `0`. **[verified: status.js:13-31,41]**
- It never touches title, sku, price, quantity, `synced_at`. **[verified: refresh.js:15-17]**
- Idempotent: a second run over the same data writes nothing. **[verified: refresh.js:12-13]**

## 3. Auth gate for the on-demand endpoint

`POST /.netlify/functions/shopify-order-refresh-now-background` **[verified: shopify-order-refresh-now-background.js:19-37]**

- Body JSON: `{ "idToken": "<Firebase ID token>", "days": 365 }`. `idToken` required (400 if missing); `days` optional, a whole number 1 to 365 (default 60), else 400.
- The server verifies the token with the Admin SDK and compares the email with `OWNER_EMAILS = ["afnan@groovy.op","ammar@groovy.op"]`; anyone else gets 403, a bad token 401. GET gets 405.
- Netlify answers a background function **202 at once and ignores the return value**; the result is in the meta doc. **[verified: header comment lines 4-7]**
- Env needed on Netlify: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_STORE_DOMAIN`, `FIREBASE_SERVICE_ACCOUNT`; missing ones give a 500 that the 202 hides. **[verified: refresh.js:203]**

## 4. Time budget, resume, Shopify cost

- Budget 12 minutes per run; it stops "partial" when under 3 s remain. **[verified: refresh.js:57,103]**
- Progress is checkpointed every page (`resume_url`, `window_start`). A `partial` meta doc is resumed by the next run: for the manual run only if the same `days` is sent again; a scheduled run resumes any partial. **[verified: refresh.js:73-78,163]**
- A finished run records `last_complete_at` = when it started; the next scheduled window starts 48 h before that. **[verified: refresh.js:81-82,171]**
- Shopify limits: plain REST list calls, 100 orders a page, one page per loop. On HTTP 429 it waits `Retry-After` (else 2, 4, 8 s), up to 3 retries, then stops `partial` with `stopped_because: "rate_limited"`. **[verified: refresh.js:105-116]** Exact Shopify rate-limit numbers for this store are not in the repo [hypothesis: REST leaky bucket, well within it at one sequential request at a time].
- Firestore cost: per page, one `getAll` for the orders plus one for all their line items, then writes only the changed docs. **[verified: refresh.js:126-158]** [hypothesis] A year of orders is on the order of tens of thousands of line-item reads plus writes of every line that lacks `refunded_quantity`; this is billable on Blaze but small. The order count is not known from here.
- **Window caveat [hypothesis]:** `updated_at_min` returns only orders Shopify has updated inside the window, so an old order that was refunded long before the window is not reached. `days: 365` is the maximum the endpoint accepts. Orders older than 60 days may also need the Shopify `read_all_orders` scope; no repo file mentions it, so whether the app has it is unknown.
- Expected duration [hypothesis]: a few minutes to tens of minutes for 365 days; may need two or three presses ("partial"). Not measured.

## 5. What changes in the UI once it has run

All in `js/shopify.js`.

- **The switch.** `quality.returns.synced` is true when at least **95%** of the line items dated in the last 60 days carry `status_synced_at` (`recentStamped / recentTotal >= 0.95`). **[verified: shopify.js:1889, 2401]** Everything below keys on that one boolean.
- **Quiet note disappears:** "Returns not yet synced: recent units and revenue are before later returns and cancellations..." in Data quality (line 1900) and in Data checks (line 4763).
- **Units drop:** each line with `refunded_quantity > 0` has min(refunded, quantity) taken off net units and counted as refunded; a fully refunded line is left out. **[verified: shopify.js:1844-1853]** These counts are applied whenever the field exists, even before the 95% switch, so figures already move for lines the refresh has touched. The note stays until the share reaches 95%.
- **Trust banner:** when synced, the Explorer shows "Returns are synced: N units already returned or cancelled are taken off the totals" (line ~2449). While unsynced, no banner (owner's call, 1 Oct).
- **"High return rate" chip activates:** `_siNaReturnsPlan` returns "waiting" while unsynced (lines 4636-4640; waiting text at line 5004). Once synced it lists articles with 20+ units in 90 days, rate 15%+ and at least 2x the catalogue median and a gap bigger than chance. **[verified: shopify.js:4433, 4636-4655]**
- The pace-reads-high wording in the Needs Attention headline also drops when `returnsSynced === true`. **[verified: shopify.js:4796]**
- A new owner-only button (section 6) disappears at the same moment.

### Important risk: the 95% test may not be reachable [hypothesis, from the code]

Only the refresh writes `status_synced_at`, and only when something differs. **[verified: grep `status_synced_at` in netlify/ finds only refresh.js:13,143,153]** `shopify-order-sync` and the backfill now write the status fields on new docs (refund count `0`) but not the stamp. **[verified: shopify-order-sync.js:140]**
So after the refresh, lines created before that change (they lack `refunded_quantity`, so they differ and get stamped) will count; lines the sync wrote **after** the status fields were added (about 30 Sept 2026, `git log` d476f23) already match Shopify, differ in nothing, and **stay unstamped**. If those are more than 5% of the last 60 days' lines (about 6 of 60 days is roughly 10% at a flat order rate), the share stays under 95% and the note and chip never switch even though the numbers are right. Confirm with the before/after check in section 7 (stamped share, below). If it stalls, the fix is a small code change (stamp on every touched line, or count `refunded_quantity != null` as synced); it is **not** made here.

## 6. How an owner runs it

**No in-app button existed before this branch.** [verified: no `order-refresh` reference in js/ or index.html at branch start.]
This branch adds one: **Inventory Intel > Needs Attention > Data checks area, "Returns refresh" block, button "Run returns refresh"**. It is shown only while returns are unsynced and only to `afnan` or `ammar` (session username; the server re-checks the token email). It sends exactly `{ idToken, days: 365 }` to the endpoint above, ignores a second press while the first is in flight, and shows the server's error text. A 202 shows "Started... reload this page in a few minutes". Tests: `tests/shopify-returns-refresh-button.test.js` (stubbed fetch only).

Steps:

1. Sign in as Afnan or Ammar. Open Inventory Intel, Needs Attention.
2. Before: note the numbers in section 7.
3. Press **Run returns refresh** once. Expect "Started."
4. Wait 5 to 10 minutes, then check progress (below). Press again only if the meta doc says `partial`.
5. Reload the page and re-read the numbers.

Alternative without the button [hypothesis, not exercised]: any request that POSTs the same JSON with a valid owner ID token (for example from the browser console while signed in: `fetch('/.netlify/functions/shopify-order-refresh-now-background',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:await auth.currentUser.getIdToken(),days:365})})`). Never paste the token anywhere.

## 7. Watching progress and verifying

Firestore `shopify_sync_meta` documents (read in the Firebase Console or as a signed-in reader): **[verified: refresh.js:96-99,163-172]**

| Doc | Meaning |
|---|---|
| `order_refresh_now` | the on-demand run. `status` = `partial` or `complete`; `last_status` `partial`/`success`/`error`; `last_error`; `stopped_because` (`time_budget`, `rate_limited`); `window_start`; counters `orders_seen`, `orders_missing`, `orders_changed`, `line_items_changed`, `line_items_missing`, `pages`, `retries_429`; `last_run_at`. |
| `order_refresh` | the scheduled run (same fields, window from `last_complete_at`). |

Healthy finish: `status: "complete"`, `last_status: "success"`, `last_error: null`, `orders_changed` and `line_items_changed` well above 0 on the first run. A second press right after should show both near 0.

Concrete before/after to compare (same page, same day):

1. **Data quality** summary in the Article Explorer: the "returns" figures, and the quiet note present before, gone after (if the 95% switch is reached).
2. Need Attention "High return rate" chip: "waiting for returns sync" before; a count (possibly 0) after.
3. Total net units for a fixed recent window (for example the last 30 days on Overview) versus Shopify's net units for the same days (Shopify Analytics, "Units sold" net of returns). The goal is that the gap of about 22% closes. [hypothesis] Shopify's own net definition can differ slightly (for example exchanges, timezone), so expect a close match, not an exact one.
4. Optional, with Firestore access: share of `shopify_line_items` with `status_synced_at` among lines whose `order_created_at` is in the last 60 days; the app needs 95%.

## 8. If it fails, rollback

- It is additive and idempotent: it updates five status fields and one timestamp on existing docs and nothing else, so there is no data to restore. Re-run to continue.
- `last_status: "error"` with `last_error` `"Shopify 401/403..."` means the Shopify token or scopes; `"Token exchange failed"` means client id/secret; a 500 that the 202 hid shows only in the Netlify function log. **[verified: refresh.js:117-120,192]**
- `rate_limited`: wait a few minutes and press again (resumes from `resume_url` if the same `days`).
- If the numbers look wrong afterwards, the original line values (title, sku, price, quantity) are untouched; only `refunded_quantity`, `refunded_at`, `financial_status`, `cancelled_at` changed. There is no per-field backup; Firestore point-in-time recovery, if enabled on the project, is the only undo [hypothesis: not verified here].

## 9. What NOT to do

- Do not run it from a non-owner token, a script that stores the token, or any loop. One press, wait, check.
- Do not press repeatedly while the status is not `partial`/`complete`; the button already blocks a second press in the same page, a second tab does not.
- Do not run `shopify-order-backfill` or edit `shopify_line_items` by hand to "fix" numbers.
- Do not read the 22% as proven or the 95% switch as guaranteed (section 5 risk).
- Do not change `firestore.rules` or lead-time logic for this.
